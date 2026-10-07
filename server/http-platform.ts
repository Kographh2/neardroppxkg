import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CHUNK_SIZE, PAIRING_TTL, createTransferSchema, joinSchema, registerSchema, signalSchema, terminalStates, type ServerEvent, type Transfer } from '../src/shared/protocol';
import { ApiError, assert, hash, pairingCode, secret } from './security';
import { database, HttpStore, rateLimit, transaction } from './http-store';
import type { StoredDevice } from './store';

const uuid = z.uuid();
const connectionSchema = z.object({ connectionId: uuid, event: signalSchema }).strict();
const activeSql = "data->>'status' NOT IN ('completed','cancelled','rejected','failed')";
class ConnectionError extends ApiError {
  constructor(public code: 'CONNECTION_REPLACED' | 'CONNECTION_EXPIRED') {
    super(409, code==='CONNECTION_REPLACED' ? 'NearDrop is active in another tab. Reload here to reconnect.' : 'This connection expired. Reconnecting to NearDrop…');
  }
}
function token(request: Request) {
  const bearer = request.headers.get('authorization');
  return bearer?.startsWith('Bearer ') ? bearer.slice(7) : request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('nd_session='))?.slice(11);
}
function json(body: unknown, status = 200, headers: Record<string,string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers } });
}
async function body(request: Request): Promise<unknown> {
  const reader=request.body?.getReader(); if (!reader) return {};
  const chunks: Uint8Array[]=[]; let length=0;
  try {
    while (true) { const {done,value}=await reader.read(); if(done) break; length+=value.length; assert(length<=65536,413,'Request is too large.'); chunks.push(value); }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') as unknown; } catch { throw new ApiError(400,'Invalid JSON request.'); }
  } finally { await reader.cancel(); reader.releaseLock(); }
}
function origin(request: Request) {
  const configured=process.env.APP_ORIGIN;
  assert(configured || process.env.NODE_ENV !== 'production',503,'Set APP_ORIGIN to your NearDrop HTTPS address in Vercel.');
  const value=configured || new URL(request.url).origin;
  assert(process.env.NODE_ENV !== 'production' || value.startsWith('https://'),503,'Production APP_ORIGIN must use HTTPS.');
  return new URL(value).origin;
}
async function authorized(store: HttpStore, request: Request) {
  const value=token(request); assert(value,401,'Your device session expired. Reconnect to continue.'); return store.authenticate(hash(value));
}
async function assertConnection(store: HttpStore, device: StoredDevice, connectionId: string) {
  const r=await store.sql.query(`UPDATE nd_presence SET expires_at=now()+interval '45 seconds'
    WHERE device_id=$1 AND connection_id=$2 AND expires_at>now() RETURNING device_id`, [device.id,connectionId]);
  if(!r.rowCount)await checkConnection(store,device.id,connectionId);
}
async function checkConnection(store: HttpStore, deviceId: string, connectionId: string) {
  const r=await store.sql.query<{connection_id:string;valid:boolean}>('SELECT connection_id,expires_at>now() AS valid FROM nd_presence WHERE device_id=$1',[deviceId]);
  if(r.rows[0] && r.rows[0].connection_id!==connectionId)throw new ConnectionError('CONNECTION_REPLACED');
  if(!r.rows[0]?.valid)throw new ConnectionError('CONNECTION_EXPIRED');
}
async function ready(store: HttpStore, device: StoredDevice): Promise<ServerEvent> {
  return {type:'ready',device:store.visible({...device,online:true}),devices:await store.devices(device.id),transfers:await store.history(device),requests:await store.requests(device.id)};
}
async function expireInterruptedTransfers(store: HttpStore, deviceId: string) {
  const stale=await store.sql.query<{data:Transfer}>(`SELECT t.data FROM transfer_sessions t
    LEFT JOIN nd_presence p ON p.device_id=CASE WHEN t.sender_id=$1 THEN t.receiver_id ELSE t.sender_id END
    WHERE (t.sender_id=$1 OR t.receiver_id=$1) AND t.data->>'status' NOT IN ('completed','cancelled','rejected','failed')
    AND ((t.data->>'updatedAt')::timestamptz<now()-interval '2 minutes' OR p.expires_at IS NULL OR p.expires_at<now())`,[deviceId]);
  if(!stale.rows.length)return;
  await store.lockDevices(stale.rows.flatMap(r=>[r.data.senderId,r.data.receiverId]));
  for(const {data:previous} of stale.rows) {
    const t=await store.transfer(previous.id,true);if(!t || terminalStates.includes(t.status))continue;
    const peer=await store.device(t.senderId===deviceId?t.receiverId:t.senderId);
    if(peer?.online && Date.parse(t.updatedAt)>=Date.now()-120000)continue;
    t.status='failed';t.updatedAt=new Date().toISOString();await store.saveTransfer(t);await store.publish(t);
  }
}

async function message(store: HttpStore, device: StoredDevice, input: z.infer<typeof signalSchema>) {
  if(input.type==='ping') return;
  const previous=await store.transfer(input.transferId);
  assert(previous && [previous.senderId,previous.receiverId].includes(device.id),404,'Transfer not found.');
  await store.lockDevices([previous.senderId,previous.receiverId]);
  const t=(await store.transfer(input.transferId,true))!;
  assert(await store.related(t.senderId,t.receiverId),403,'Pair this device before sending.');
  assert(!terminalStates.includes(t.status) && t.status!=='waiting',409,'This transfer is not active.');
  const sender=t.senderId===device.id, peer=sender?t.receiverId:t.senderId;
  if(input.type==='signal') { await store.emit(peer,input); return; }
  if(input.type==='transfer.transport') {
    assert(sender && ['preparing','connecting'].includes(t.status),409,'Cannot change this transfer transport.');
    // HTTP functions carry signaling only. No pretend relay or persistent file uploads.
    assert(input.transport!=='relay',503,'A direct connection could not be established. This deployment needs a TURN service for restricted networks.');
    t.transport=input.transport; t.status='transferring';
  } else if(input.type==='transfer.ack') {
    assert(!sender && t.status==='transferring' && t.transport!=='relay',403,'Only the receiving device can acknowledge this transfer.');
    assert(input.bytes>=t.bytes && input.bytes<=t.item.size && input.bytes===Math.min((input.sequence+1)*CHUNK_SIZE,t.item.size),400,'Invalid transfer progress.');
    t.bytes=input.bytes;
  } else if(input.type==='transfer.complete') {
    assert(!sender && t.status==='transferring' && t.bytes===t.item.size,409,'The transfer is not complete.'); t.status='completed';
  } else if(input.type==='transfer.fail') t.status='failed';
  else if(input.type==='transfer.end') {
    assert(sender && t.status==='transferring',403,'Only the sender can finish sending.'); await store.emit(peer,input); return;
  } else throw new ApiError(400,'File chunks must use the encrypted WebRTC channel on this deployment.');
  t.updatedAt=new Date().toISOString(); await store.saveTransfer(t);
  if(input.type!=='transfer.ack') await store.publish(t);
}

export async function handleHttp(request: Request): Promise<Response> {
  try {
    const url=new URL(request.url), path=url.pathname.replace(/^\/api\/v1/,''), method=request.method;
    const appOrigin=origin(request);
    if(method!=='GET') {
      const native=!request.headers.get('origin') && request.headers.get('x-neardrop-client')==='native' && !!request.headers.get('authorization');
      const registeringNative=path==='/devices/register' && !request.headers.get('origin') && request.headers.get('x-neardrop-client')==='native';
      assert(request.headers.get('origin')===appOrigin || native || registeringNative,403,'Request origin is not allowed.');
      assert(request.headers.get('content-type')?.startsWith('application/json'),415,'Use application/json.');
    }
    if(path==='/health' && method==='GET') {
      await database().query('SELECT device_id FROM nd_presence LIMIT 0');
      return json({status:'ok',version:1,persistent:true,signaling:'http',relay:false});
    }
    // Vercel sets this header; never trust arbitrary forwarding headers elsewhere.
    const ip=process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for') || 'unknown' : 'local';
    if(path==='/devices/register' && method==='POST') {
      const input=registerSchema.parse(await body(request));
      await rateLimit(`register:${hash(ip)}`,60);
      return await transaction(async store=>{
        const value=token(request);
        if(value) {
          const existing=await store.authenticate(hash(value)).catch(error=>{if(error instanceof ApiError && error.status===401)return undefined;throw error;});
          if(existing && existing.publicKey.x===input.publicKey.x && existing.publicKey.y===input.publicKey.y)
            return json({device:store.visible(existing),signaling:'http'});
        }
        const session=secret();
        const device:StoredDevice={id:randomUUID(),...input,userId:null,online:false,lastSeen:new Date().toISOString(),tokenHash:hash(session),expiresAt:Date.now()+30*86400000};
        await store.saveDevice(device);
        return json({device:store.visible(device),signaling:'http',...(request.headers.get('x-neardrop-client')==='native'?{token:session}:{})},201,
          {'Set-Cookie':`nd_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${appOrigin.startsWith('https:')?'; Secure':''}`});
      });
    }
    const device=await transaction(store=>authorized(store,request));
    if(path==='/pairing/join') {await rateLimit(`join-ip:${hash(ip)}`,10,300000);await rateLimit(`join:${device.id}`,10,300000);}
    else if(path==='/pairing/create') await rateLimit(`pair:${device.id}`,12);
    else if(path==='/auth/associate') await rateLimit(`auth:${device.id}`,10);
    else await rateLimit(`http:${device.id}`,600);
    if(path==='/events' && method==='GET')await transaction(store=>expireInterruptedTransfers(store,device.id));
    if(Math.random()<0.02) await transaction(store=>store.cleanup());
    const input=method==='GET'?undefined:await body(request);
    return await transaction(async store=>{
      // Check again inside the mutation transaction after any previous sign-out.
      const current=await authorized(store,request);
      if(path==='/session/connect' && method==='POST') {
        const connectionId=randomUUID();
        const active=await store.sql.query<{data:Transfer}>(`SELECT data FROM transfer_sessions WHERE (sender_id=$1 OR receiver_id=$1) AND ${activeSql}`, [current.id]);
        await store.lockDevices([current.id,...active.rows.flatMap(r=>[r.data.senderId,r.data.receiverId])]);
        for(const {data:t} of active.rows) {
          const latest=await store.transfer(t.id,true); if(!latest || terminalStates.includes(latest.status))continue;
          latest.status='failed';latest.updatedAt=new Date().toISOString();await store.saveTransfer(latest);await store.publish(latest);
        }
        const presence=await store.sql.query<{next_event:string}>(`INSERT INTO nd_presence(device_id,connection_id,expires_at) VALUES($1,$2,now()+interval '45 seconds')
          ON CONFLICT(device_id) DO UPDATE SET connection_id=$2,expires_at=EXCLUDED.expires_at RETURNING next_event`, [current.id,connectionId]);
        await store.sql.query('DELETE FROM nd_events WHERE device_id=$1',[current.id]);
        current.lastSeen=new Date().toISOString();await store.saveDevice(current);
        return json({connectionId,cursor:Number(presence.rows[0].next_event),ready:await ready(store,current)});
      }
      if(path==='/events' && method==='GET') {
        const connectionId=uuid.parse(url.searchParams.get('connectionId'));
        const cursor=z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(url.searchParams.get('cursor'));
        await assertConnection(store,current,connectionId);
        const high=await store.sql.query<{next_event:string}>('SELECT next_event FROM nd_presence WHERE device_id=$1',[current.id]);
        assert(cursor<=Number(high.rows[0].next_event),400,'Invalid event cursor.');
        await store.sql.query('DELETE FROM nd_events WHERE device_id=$1 AND sequence<=$2',[current.id,cursor]);
        const events=await store.sql.query<{sequence:string;data:ServerEvent}>(`SELECT sequence,data FROM nd_events WHERE device_id=$1 AND sequence>$2 AND expires_at>now() ORDER BY sequence LIMIT 100`,[current.id,cursor]);
        return json({events:events.rows.map(r=>r.data),cursor:events.rows.length?Number(events.rows.at(-1)!.sequence):cursor,devices:await store.devices(current.id)});
      }
      if(path==='/events' && method==='POST') {
        const parsed=connectionSchema.parse(input);
        // Validate lease without acquiring a presence lock ahead of device locks.
        await checkConnection(store,current.id,parsed.connectionId);
        await message(store,current,parsed.event);return json({ok:true});
      }
      if(path==='/devices' && method==='GET')return json({device:store.visible(current),devices:await store.devices(current.id)});
      if(path==='/ice' && method==='GET') {
        const iceServers:{urls:string[];username?:string;credential?:string}[]=[];
        const stun=(process.env.STUN_URLS??'stun:stun.l.google.com:19302').split(',').map(s=>s.trim()).filter(Boolean);
        if(stun.length)iceServers.push({urls:stun});
        if(process.env.TURN_URLS && process.env.TURN_SECRET) {
          const username=`${Math.floor(Date.now()/1000)+3600}:${current.id}`;
          iceServers.push({urls:process.env.TURN_URLS.split(',').map(s=>s.trim()).filter(Boolean),username,credential:createHmac('sha1',process.env.TURN_SECRET).update(username).digest('base64')});
        }
        return json({iceServers,relayAvailable:false});
      }
      if(path===`/devices/${current.id}` && method==='PATCH') {
        const {name}=z.object({name:z.string().trim().min(1).max(48)}).strict().parse(input);
        await store.lockDevices([current.id]); const latest=(await store.device(current.id))!;await store.saveDevice({...latest,name});return json({device:store.visible({...latest,name})});
      }
      const relation=path.match(/^\/devices\/([a-f0-9-]{36})(\/trust)?$/);
      if(relation && (method==='DELETE' || (relation[2] && method==='POST'))) {
        const peerId=uuid.parse(relation[1]);await store.lockDevices([current.id,peerId]);
        if(method==='DELETE') {
          await store.sql.query('DELETE FROM device_relationships WHERE id=$1',[[current.id,peerId].sort().join(':')]);
          const transfers=await store.sql.query<{data:Transfer}>(`SELECT data FROM transfer_sessions WHERE ((sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)) AND ${activeSql} FOR UPDATE`,[current.id,peerId]);
          for(const {data:t} of transfers.rows){t.status='cancelled';t.updatedAt=new Date().toISOString();await store.saveTransfer(t);await store.publish(t);}
        } else {
          const {trusted}=z.object({trusted:z.boolean()}).strict().parse(input);
          const self=await store.device(current.id),peer=await store.device(peerId),relationship=await store.related(current.id,peerId);
          assert(self?.userId && self.userId===peer?.userId && relationship,403,'Pair both devices and sign in to the same account to enable trust.');
          await store.saveRelationship({...relationship,trustedBy:trusted?[...new Set([...relationship.trustedBy,current.id])]:relationship.trustedBy.filter(id=>id!==current.id)});
        }
        return json({ok:true});
      }
      if(path==='/auth/associate' && method==='POST') {
        const {accessToken}=z.object({accessToken:z.string().min(20).max(8192)}).strict().parse(input);
        const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL, apiKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        assert(supabaseUrl && apiKey,503,'Accounts are not configured on this server.');
        const result=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:apiKey,Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(8000)});
        assert(result.ok,401,'Please sign in again.');
        const user=z.object({id:uuid,email_confirmed_at:z.string().nullable().optional()}).parse(await result.json());
        assert(user.email_confirmed_at,403,'Verify your email before linking this device.');
        await store.lockDevices([current.id]);const latest=(await store.device(current.id))!;
        assert(!latest.userId || latest.userId===user.id,409,'Sign out before switching accounts.');
        await store.saveDevice({...latest,userId:user.id});return json({device:store.visible({...latest,userId:user.id})});
      }
      if(path==='/auth/sign-out' && method==='POST') {
        await store.lockDevices([current.id]);
        await store.sql.query('DELETE FROM device_relationships WHERE device_a=$1 OR device_b=$1',[current.id]);
        await store.sql.query('DELETE FROM nd_presence WHERE device_id=$1',[current.id]);
        await store.saveDevice({...current,userId:null,expiresAt:Date.now(),online:false});
        return json({ok:true},200,{'Set-Cookie':`nd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${appOrigin.startsWith('https:')?'; Secure':''}`});
      }
      if(path==='/pairing/create' && method==='POST') {
        await store.lockDevices([current.id]);
        await store.sql.query("DELETE FROM nd_pairings WHERE initiator_id=$1 AND status='open'",[current.id]);
        const code=pairingCode(),id=randomUUID(),expiresAt=Date.now()+PAIRING_TTL;
        await store.sql.query("INSERT INTO nd_pairings(id,initiator_id,code_hash,expires_at,status) VALUES($1,$2,$3,$4,'open')",[id,current.id,hash(code),new Date(expiresAt)]);
        return json({id,code,expiresAt});
      }
      if(path==='/pairing/join' && method==='POST') {
        const {code}=joinSchema.parse(input); const initial=await store.pairing('code_hash',hash(code));
        assert(initial,400,'This pairing code is invalid or expired. Ask for a new code.');
        await store.lockDevices([current.id,initial.initiatorId]);
        const p=await store.pairing('id',initial.id,true);
        assert(p && p.status==='open' && p.expiresAt>Date.now(),400,'This pairing code is invalid or expired. Ask for a new code.');
        assert(p.initiatorId!==current.id,400,'Enter the code shown on your other device.');
        const peer=await store.device(p.initiatorId);assert(peer?.online,409,'The other device is offline. Open NearDrop there.');
        await store.sql.query("UPDATE nd_pairings SET joiner_id=$2,status='pending' WHERE id=$1",[p.id,current.id]);
        await store.emit(peer.id,{type:'pairing.request',id:p.id,device:store.visible(current),expiresAt:p.expiresAt});
        return json({id:p.id,device:store.visible(peer)});
      }
      if(['/pairing/confirm','/pairing/reject'].includes(path) && method==='POST') {
        const {id}=z.object({id:uuid}).strict().parse(input);const initial=await store.pairing('id',id);
        assert(initial?.initiatorId===current.id && initial.joinerId,400,'This connection request has expired.');
        await store.lockDevices([current.id,initial.joinerId]);const p=await store.pairing('id',id,true);
        assert(p && p.status==='pending' && p.expiresAt>Date.now() && p.joinerId,400,'This connection request has expired.');
        const peer=await store.device(p.joinerId);assert(peer,404,'Device no longer available.');
        const accepted=path.endsWith('/confirm');await store.sql.query('UPDATE nd_pairings SET status=$2 WHERE id=$1',[id,accepted?'accepted':'rejected']);
        if(accepted) {
          const existing=await store.related(current.id,peer.id);await store.saveRelationship(existing||{a:current.id,b:peer.id,trustedBy:[]});
          for(const recipient of [current,peer].sort((a,b)=>a.id.localeCompare(b.id)))await store.emit(recipient.id,{type:'pairing.accepted',device:store.visible(recipient.id===current.id?peer:current)});
        } else await store.emit(peer.id,{type:'pairing.rejected',id});
        return json({ok:true});
      }
      if(path==='/transfer-history' && method==='GET')return json({transfers:await store.history(current)});
      if(path==='/transfers' && method==='POST') {
        const parsed=createTransferSchema.parse(input);await store.lockDevices([current.id,parsed.receiverId]);
        const receiver=await store.device(parsed.receiverId);assert(receiver && await store.related(current.id,receiver.id),403,'Pair this device before sending.');
        assert(receiver.online,409,'The receiving device is offline.');
        const active=await store.sql.query<{data:Transfer}>(`SELECT data FROM transfer_sessions WHERE (sender_id=ANY($1::uuid[]) OR receiver_id=ANY($1::uuid[])) AND ${activeSql} FOR UPDATE`,[[current.id,receiver.id]]);
        for(const {data:t} of active.rows) {
          assert(Date.parse(t.updatedAt)<Date.now()-120000,409,'Finish the current transfer before sending another.');
          t.status='failed';t.updatedAt=new Date().toISOString();await store.saveTransfer(t);
        }
        assert(parsed.item.kind==='file' || parsed.item.size<=65536,400,'Text must be smaller than 64 KB.');
        const t:Transfer={id:randomUUID(),senderId:current.id,receiverId:receiver.id,senderName:current.name,receiverName:receiver.name,item:parsed.item,status:'waiting',transport:null,bytes:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        await store.saveTransfer(t);await store.publish(t);return json({transfer:t},201);
      }
      const match=path.match(/^\/transfers\/([a-f0-9-]{36})(?:\/(accept|reject|cancel))?$/);
      if(match) {
        const initial=await store.transfer(uuid.parse(match[1]));assert(initial && [initial.senderId,initial.receiverId].includes(current.id),404,'Transfer not found.');
        if(method==='GET' && !match[2])return json({transfer:initial});
        if(method==='POST' && match[2]) {
          await store.lockDevices([initial.senderId,initial.receiverId]);const t=(await store.transfer(initial.id,true))!;
          assert(!terminalStates.includes(t.status),409,'This transfer has already ended.');
          if(match[2]!=='cancel')assert(t.receiverId===current.id && t.status==='waiting',403,'Only the receiver can respond to this request.');
          t.status=match[2]==='accept'?'preparing':match[2]==='reject'?'rejected':'cancelled';t.updatedAt=new Date().toISOString();await store.saveTransfer(t);await store.publish(t);return json({transfer:t});
        }
      }
      throw new ApiError(404,'This endpoint does not exist.');
    });
  } catch(error) {
    if(error instanceof ApiError)return json({error:error.message,...(error instanceof ConnectionError?{code:error.code}:{})},error.status);
    if(error instanceof z.ZodError)return json({error:'Check the information and try again.'},400);
    // Never leak database URLs, credentials, SQL, or stack traces to clients/logs.
    const code=error && typeof error==='object' && 'code' in error?String(error.code):'unknown';
    console.error('NearDrop backend unavailable:', /^[A-Z0-9_]{1,24}$/.test(code)?code:'unknown');
    return json({error:'The NearDrop backend is unavailable. Check DATABASE_URL and run the database migrations, then try again.'},503);
  }
}
