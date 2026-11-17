import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, rateLimit, transaction, type HttpStore } from '../../server/http-store';
import { deploymentOrigins } from '../../server/deployment-origin';
import { ApiError, assert, hash, pairingCode, secret } from '../../server/security';
import { backendFailure } from '../../server/backend-error';
import { callSchema, contactSchema, messageSchema, numberSchema, profileSchema, roomSchema, statusSchema, type CallState, type Contact, type Message, type Profile, type StatusItem } from './shared';

const json = (body: unknown, status = 200, headers: Record<string,string> = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const cookie = (r: Request, name: string) => r.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name+'='))?.slice(name.length+1);
const profile = (row: { id: string; username: string; display_name: string; phone?: string|null; avatar?: string|null; about?: string|null; read_receipts?: boolean }): Profile => ({ id: row.id, username: row.username, displayName: row.display_name, phone: row.phone ?? null, avatar: row.avatar ?? null, about: row.about ?? 'Hey there! I am using NearChat.', readReceipts: row.read_receipts ?? true });
type Session = { id: string; user_id: string; name: string };
const now = () => new Date();
async function session(store: HttpStore, request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /,'') || cookie(request,'nc_session');
  assert(token,401,'Sign in to NearChat to continue.');
  const result = await store.sql.query<Session>('SELECT id,user_id,name FROM nc_sessions WHERE token_hash=$1 AND expires_at>now()', [hash(token)]);
  assert(result.rows[0],401,'Your NearChat session expired. Sign in again.'); return result.rows[0];
}
async function createSession(store: HttpStore, userId: string, name: string) {
  const token=secret(),id=randomUUID();
  await store.sql.query("INSERT INTO nc_sessions(id,token_hash,user_id,name,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 days')",[id,hash(token),userId,name]);return token;
}
async function member(store: HttpStore, userId: string, roomId: string) {
  const r=await store.sql.query('SELECT user_id,last_read FROM nc_members WHERE room_id=$1 AND user_id=$2',[roomId,userId]);assert(r.rows[0],404,'Conversation not found.');return r.rows[0] as {user_id:string;last_read:number};
}
async function input(request: Request) {
  const reader=request.body?.getReader();if(!reader)return {};
  const parts: Uint8Array[]=[];let count=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;assert(count<=6_500_000,413,'Request is too large.');parts.push(value);}return JSON.parse(Buffer.concat(parts).toString()||'{}') as unknown;}
  catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'Invalid request.');}
  finally {await reader.cancel();reader.releaseLock();}
}
function pickPhone(country: string, dial: string) {
  const clean = dial.replace(/[^\d+]/g,'') || '+62';
  const prefix = clean.startsWith('+') ? clean : ('+'+clean.replace(/^0+/,''));
  if (country === 'ID') { const n = '8' + String(Math.floor(100000000 + Math.random()*899999999)); return '+62'+n; }
  const tail = String(Math.floor(100000000 + Math.random()*899999999));
  return prefix + tail.slice(0, Math.max(6, 12 - prefix.replace('+','').length));
}
function linkifyRoom(roomId: string, self: string, row: any) {
  return { id: row.id, name: row.name, kind: row.kind, ownerId: row.ownerId, updatedAt: row.updatedAt, unread: Number(row.unread||0), members: row.members||[] };
}
export async function nearChatApi(request: Request) {
  try {
    const url=new URL(request.url),path=url.pathname.replace('/api/near-chat',''),method=request.method;
    const origins=deploymentOrigins(request.url);
    if(method!=='GET'){
      assert(origins.allowed.includes(request.headers.get('origin')||''),403,'Request origin is not allowed.');
      assert(request.headers.get('content-type')?.startsWith('application/json'),415,'Use application/json.');
    }
    const ip=process.env.VERCEL?request.headers.get('x-vercel-forwarded-for')||'unknown':'local';
    const data=method==='GET'?undefined:await input(request);
    const sessionCookie=(token:string)=>`nc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?2592000:0}${origins.secure?'; Secure':''}`;
    const pendingCookie=(userId:string)=>`nc_pending=${userId}; HttpOnly; SameSite=Strict; Path=/api/near-chat; Max-Age=${userId?1800:0}${origins.secure?'; Secure':''}`;

    if(path==='/session' && method==='POST') {
      await rateLimit(`nc-login:${hash(ip)}`,30,300000);
      const parsed=z.object({accessToken:z.string().min(20).max(8192),name:z.string().trim().min(1).max(48),phone:z.string().optional()}).strict().parse(data);
      const base=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      assert(base&&key,503,'Account sign-in is not configured.');
      const result=await fetch(`${base}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${parsed.accessToken}`},signal:AbortSignal.timeout(8000)});
      assert(result.ok,401,'Sign in again to continue.');
      const user=z.object({id:z.uuid(),email_confirmed_at:z.string().nullable().optional()}).parse(await result.json());
      assert(user.email_confirmed_at,403,'Verify your email before signing in to NearChat.');
      return await transaction(async store=>{
        await store.sql.query('INSERT INTO nc_profiles(id,username,display_name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[user.id,'near_'+user.id.replaceAll('-','').slice(0,16),'New member']);
        if(parsed.phone && /^\+\d{6,15}$/.test(parsed.phone)) await store.sql.query('UPDATE nc_profiles SET phone=COALESCE(phone,$2) WHERE id=$1',[user.id,parsed.phone]);
        const r=await store.sql.query<{phone:string|null}>('SELECT phone FROM nc_profiles WHERE id=$1',[user.id]);
        if(!r.rows[0]?.phone) return json({needsPhone:true},200,{'Set-Cookie':pendingCookie(user.id)});
        return json({ok:true},200,{'Set-Cookie':sessionCookie(await createSession(store,user.id,parsed.name))+', '+pendingCookie('')});
      });
    }

    if(path==='/number' && method==='POST') {
      await rateLimit(`nc-number:${hash(ip)}`,60,300000);
      const pending=cookie(request,'nc_pending');assert(pending,401,'Sign in again to choose a number.');
      const p=numberSchema.parse(data);
      return await transaction(async store=>{
        for(let i=0;i<12;i++){
          const phone=pickPhone(p.country,p.dial);
          try{
            await store.sql.query('INSERT INTO nc_numbers(phone,country,owner_id,claimed_at) VALUES($1,$2,$3,now())',[phone,p.country==='ID'?'Indonesia':p.country,pending]);
            await store.sql.query('UPDATE nc_profiles SET phone=$2 WHERE id=$1',[pending,phone]);
            return json({phone},201,{'Set-Cookie':sessionCookie(await createSession(store,pending,'My phone'))+', '+pendingCookie('')});
          }catch(e){ if(!(e && typeof e==='object' && 'code' in e && e.code==='23505')) throw e; }
        }
        throw new ApiError(503,'Could not generate a number. Try again.');
      });
    }

    if(path==='/link' && method==='POST') {
      await rateLimit(`nc-link:${hash(ip)}`,10,300000);
      const {name}=z.object({name:z.string().trim().min(1).max(48)}).strict().parse(data);
      const id=randomUUID(),code=pairingCode(),poll=secret(),expiresAt=Date.now()+300000;
      await database().query('DELETE FROM nc_links WHERE expires_at<now()');
      await database().query('INSERT INTO nc_links(id,code_hash,poll_hash,name,expires_at) VALUES($1,$2,$3,$4,$5)',[id,hash(code),hash(poll),name,new Date(expiresAt)]);
      return json({id,code,expiresAt},201,{'Set-Cookie':`nc_link=${poll}; HttpOnly; SameSite=Strict; Path=/api/near-chat; Max-Age=300${origins.secure?'; Secure':''}`});
    }
    if(path==='/link/status' && method==='GET') {
      const id=z.uuid().parse(url.searchParams.get('id')),poll=cookie(request,'nc_link');assert(poll,401,'Start a new login code.');
      await rateLimit(`nc-poll:${hash(poll)}`,120);
      return await transaction(async store=>{
        const r=await store.sql.query<{user_id:string|null;name:string}>('SELECT user_id,name FROM nc_links WHERE id=$1 AND poll_hash=$2 AND expires_at>now() AND NOT consumed FOR UPDATE',[id,hash(poll)]);
        assert(r.rows[0],410,'This login code expired. Create a new one.');
        if(!r.rows[0].user_id)return json({status:'waiting'});
        const token=await createSession(store,r.rows[0].user_id,r.rows[0].name);
        await store.sql.query('UPDATE nc_links SET consumed=true WHERE id=$1',[id]);
        return json({status:'approved'},200,{'Set-Cookie':sessionCookie(token)});
      });
    }

    const current=await transaction(store=>session(store,request));
    await rateLimit(`nc-user:${current.user_id}`,400);
    if(path==='/link/approve')await rateLimit(`nc-approve:${current.user_id}`,10,300000);
    if(Math.random()<0.02){await database().query('DELETE FROM nc_sessions WHERE expires_at<now()');await database().query('DELETE FROM nc_statuses WHERE expires_at<now()');await database().query("DELETE FROM nc_calls WHERE updated_at<now()-interval '2 days'");}

    return await transaction(async store=>{
      const verified=await session(store,request),userId=verified.user_id;
      const meRow = async()=> (await store.sql.query('SELECT id,username,display_name,phone,avatar,about,read_receipts FROM nc_profiles WHERE id=$1',[userId])).rows[0];

      if(path==='/me' && method==='GET') return json({profile:profile(await meRow())});
      if(path==='/me' && method==='PATCH') {
        const p=profileSchema.parse(data);
        await store.sql.query('UPDATE nc_profiles SET username=$2,display_name=$3,about=COALESCE($4,about),avatar=COALESCE($5,avatar),read_receipts=COALESCE($6,read_receipts),updated_at=now() WHERE id=$1',[userId,p.username,p.displayName,p.about??null,p.avatar===undefined?null:p.avatar,p.readReceipts??null]);
        if(p.avatar===null) await store.sql.query('UPDATE nc_profiles SET avatar=NULL WHERE id=$1',[userId]);
        return json({profile:profile(await meRow())});
      }
      if(path==='/sessions' && method==='GET') {
        const r=await store.sql.query<{id:string;name:string;createdAt:string}>('SELECT id,name,created_at AS "createdAt" FROM nc_sessions WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC',[userId]);return json({sessions:r.rows.map(s=>({...s,current:s.id===verified.id}))});
      }
      const revoke=path.match(/^\/sessions\/([a-f0-9-]{36})$/);
      if(revoke && method==='DELETE'){await store.sql.query('DELETE FROM nc_sessions WHERE id=$1 AND user_id=$2',[revoke[1],userId]);return json({ok:true});}
      if(path==='/sign-out' && method==='POST'){await store.sql.query('DELETE FROM nc_sessions WHERE id=$1',[verified.id]);return json({ok:true},200,{'Set-Cookie':sessionCookie('')});}

      if(path==='/contacts' && method==='GET'){
        const r=await store.sql.query(`SELECT p.id,p.username,p.display_name,p.phone,p.avatar,p.about,c.alias FROM nc_contacts c JOIN nc_profiles p ON p.id=c.contact_id WHERE c.owner_id=$1 ORDER BY lower(coalesce(nullif(c.alias,''),p.display_name))`,[userId]);
        return json({contacts:r.rows.map(x=>({id:x.id,username:x.username,displayName:x.display_name,phone:x.phone,avatar:x.avatar,about:x.about,alias:x.alias}))});
      }
      if(path==='/contacts' && method==='POST'){
        const p=contactSchema.parse(data); const q=p.value.trim().toLowerCase().replace(/\s+/g,'');
        const r=await store.sql.query('SELECT id,username,display_name,phone,avatar,about FROM nc_profiles WHERE lower(username)=$1 OR phone=$2 LIMIT 1',[q.startsWith('@')?q.slice(1):q, p.value.trim()]);
        assert(r.rows[0] && r.rows[0].id!==userId,404,'No account found for that username or number.');
        await store.sql.query('INSERT INTO nc_contacts(owner_id,contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,r.rows[0].id]);
        const c=r.rows[0]; return json({contact:{id:c.id,username:c.username,displayName:c.display_name,phone:c.phone,avatar:c.avatar,about:c.about}},201);
      }

      if(path==='/statuses' && method==='GET'){
        await store.sql.query('DELETE FROM nc_statuses WHERE expires_at<now()');
        const r=await store.sql.query(`SELECT s.*,p.display_name,p.avatar FROM nc_statuses s JOIN nc_profiles p ON p.id=s.user_id WHERE s.expires_at>now() AND (s.user_id=$1 OR s.user_id IN (SELECT contact_id FROM nc_contacts WHERE owner_id=$1)) ORDER BY s.created_at DESC LIMIT 200`,[userId]);
        const items:StatusItem[]=r.rows.map(x=>({id:x.id,userId:x.user_id,displayName:x.display_name,avatar:x.avatar,kind:x.kind,body:x.body,caption:x.caption||'',bg:x.bg||'#177d69',createdAt:x.created_at,expiresAt:x.expires_at,mine:x.user_id===userId}));
        return json({statuses:items});
      }
      if(path==='/statuses' && method==='POST'){
        const p=statusSchema.parse(data); const id=randomUUID();
        await store.sql.query(`INSERT INTO nc_statuses(id,user_id,kind,body,caption,bg) VALUES($1,$2,$3,$4,$5,$6)`,[id,userId,p.kind,p.body,p.caption,p.bg||'#177d69']);
        return json({id},201);
      }
      const statusPath=path.match(/^\/statuses\/([a-f0-9-]{36})$/);
      if(statusPath && method==='DELETE'){ await store.sql.query('DELETE FROM nc_statuses WHERE id=$1 AND user_id=$2',[statusPath[1],userId]); return json({ok:true}); }

      if(path==='/link/approve' && method==='POST') {
        const {code,approve}=z.object({code:z.string().transform(s=>s.toUpperCase().replace(/[-\s]/g,'')).pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/)),approve:z.boolean()}).strict().parse(data);
        const r=await store.sql.query<{id:string;name:string}>('SELECT id,name FROM nc_links WHERE code_hash=$1 AND expires_at>now() AND user_id IS NULL AND NOT consumed FOR UPDATE',[hash(code)]);
        assert(r.rows[0],410,'This login code is invalid or expired.');
        if(approve)await store.sql.query('UPDATE nc_links SET user_id=$2 WHERE id=$1',[r.rows[0].id,userId]);return json({name:r.rows[0].name,approved:approve});
      }

      if(path==='/rooms' && method==='GET') {
        const r=await store.sql.query(`SELECT r.id,r.name,r.kind,r.owner_id AS "ownerId",r.updated_at AS "updatedAt",
          (SELECT count(*)::int FROM nc_messages x WHERE x.room_id=r.id AND x.sequence>m.last_read AND x.sender_id<>$1 AND NOT x.deleted) AS unread,
          (SELECT jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'displayName',p.display_name,'phone',p.phone,'avatar',p.avatar,'about',p.about)) FROM nc_members mm JOIN nc_profiles p ON p.id=mm.user_id WHERE mm.room_id=r.id) AS members
          FROM nc_rooms r JOIN nc_members m ON m.room_id=r.id WHERE m.user_id=$1 ORDER BY r.updated_at DESC LIMIT 100`,[userId]);
        return json({rooms:r.rows.map(row=>linkifyRoom(row.id,userId,row))});
      }
      if(path==='/rooms' && method==='POST') {
        const p=roomSchema.parse(data),names=[...new Set(p.members.map(x=>x.trim().toLowerCase()))];
        assert(p.kind==='group'||names.length===1,400,'Choose one person for a direct chat.');
        assert(p.kind!=='group'||p.name.length>0,400,'Give this group a name.');
        const users=await store.sql.query<{id:string,username:string}>("SELECT id,username FROM nc_profiles WHERE lower(username)=ANY($1::text[]) OR phone=ANY($1::text[])",[names.map(n=>n.replace(/^@/,''))]);
        assert(users.rows.length>=1 && users.rows.every(u=>u.id!==userId),400,'One of these usernames or numbers was not found. Check with your friend.');
        const uniq=[...new Map(users.rows.map(u=>[u.id,u])).values()];
        assert(p.kind==='group'||uniq.length===1,400,'Choose one person for a direct chat.');
        const ids=[userId,...uniq.map(u=>u.id)].sort(),direct=p.kind==='direct'?ids.join(':'):null,id=randomUUID();
        const room=await store.sql.query<{id:string}>(`INSERT INTO nc_rooms(id,kind,name,owner_id,direct_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(direct_key) DO UPDATE SET direct_key=EXCLUDED.direct_key RETURNING id`,[id,p.kind,p.name,userId,direct]);
        for(const memberId of ids)await store.sql.query('INSERT INTO nc_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[room.rows[0].id,memberId]);return json({id:room.rows[0].id},201);
      }

      const roomPath=path.match(/^\/rooms\/([a-f0-9-]{36})(?:\/(messages|read|leave|messages\/([a-f0-9-]{36})))?$/);
      if(roomPath){
        const roomId=z.uuid().parse(roomPath[1]);const mem=await member(store,userId,roomId);
        if(roomPath[2]==='messages' && method==='GET') {
          const before=z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).parse(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
          const r=await store.sql.query(`SELECT x.id,x.room_id AS "roomId",x.sender_id AS "senderId",CASE WHEN x.deleted THEN '' ELSE x.body END AS body,x.kind,x.attachment,x.reply_to AS "replyTo",x.forwarded,x.deleted,x.sequence::float8 AS sequence,x.created_at AS "createdAt",p.display_name AS "senderName" FROM nc_messages x JOIN nc_profiles p ON p.id=x.sender_id WHERE x.room_id=$1 AND x.sequence<$2 ORDER BY x.sequence DESC LIMIT 80`,[roomId,before]);
          const msgs=r.rows.reverse() as Message[];
          const me=await meRow();
          let otherRead=0; if(me.read_receipts){ const o=await store.sql.query('SELECT coalesce(max(last_read),0) AS v FROM nc_members WHERE room_id=$1 AND user_id<>$2',[roomId,userId]); otherRead=Number(o.rows[0]?.v||0); }
          for(const m of msgs) m.read = !!(me.read_receipts && m.senderId===userId && m.sequence<=otherRead);
          return json({messages:msgs,hasMore:r.rows.length===80});
        }
        if(roomPath[2]==='messages' && method==='POST') {
          const p=messageSchema.parse(data);await store.sql.query('SELECT id FROM nc_rooms WHERE id=$1 FOR UPDATE',[roomId]);await member(store,userId,roomId);
          const existing=await store.sql.query<{sender_id:string;room_id:string;body:string}>('SELECT sender_id,room_id,body FROM nc_messages WHERE id=$1',[p.id]);
          if(existing.rows[0]){assert(existing.rows[0].sender_id===userId&&existing.rows[0].room_id===roomId&&(existing.rows[0].body===p.body||p.kind!=='text'),409,'Message ID already used.');return json({ok:true});}
          if(p.replyTo){ const rr=await store.sql.query('SELECT id FROM nc_messages WHERE id=$1 AND room_id=$2',[p.replyTo,roomId]); assert(rr.rows[0],400,'Reply target not found.'); }
          await store.sql.query('INSERT INTO nc_messages(id,room_id,sender_id,body,kind,attachment,reply_to,forwarded) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.id,roomId,userId,p.body,p.kind,p.attachment||null,p.replyTo||null,!!p.forwarded]);
          await store.sql.query('UPDATE nc_rooms SET updated_at=now() WHERE id=$1',[roomId]);return json({ok:true},201);
        }
        if(roomPath[2]==='messages/'+(roomPath[3]||'') && method==='DELETE' && roomPath[3]) {
          await store.sql.query("UPDATE nc_messages SET deleted=true, body='', attachment=NULL WHERE id=$1 AND room_id=$2 AND sender_id=$3",[roomPath[3],roomId,userId]);
          return json({ok:true});
        }
        if(roomPath[2]==='read' && method==='POST') {
          const {sequence}=z.object({sequence:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict().parse(data);
          await store.sql.query('UPDATE nc_members SET last_read=GREATEST(last_read,LEAST($3,COALESCE((SELECT max(sequence) FROM nc_messages WHERE room_id=$1),0))) WHERE room_id=$1 AND user_id=$2',[roomId,userId,sequence]);return json({ok:true});
        }
        if(roomPath[2]==='leave' && method==='POST') {
          const r=await store.sql.query<{kind:string;owner_id:string}>('SELECT kind,owner_id FROM nc_rooms WHERE id=$1 FOR UPDATE',[roomId]);
          assert(r.rows[0].kind==='group',400,'Direct chats stay in your conversation list.');
          if(r.rows[0].owner_id===userId){await store.sql.query('DELETE FROM nc_rooms WHERE id=$1',[roomId]);}
          else await store.sql.query('DELETE FROM nc_members WHERE room_id=$1 AND user_id=$2',[roomId,userId]);return json({ok:true});
        }
      }

      if(path==='/calls' && method==='POST'){
        const p=callSchema.parse(data);
        if(p.action==='start'){
          assert(p.roomId,400,'Room required.'); await member(store,userId,p.roomId);
          const room=await store.sql.query("SELECT kind FROM nc_rooms WHERE id=$1",[p.roomId]); assert(room.rows[0]?.kind==='direct',400,'Calls are available in direct chats.');
          const other=await store.sql.query('SELECT user_id FROM nc_members WHERE room_id=$1 AND user_id<>$2 LIMIT 1',[p.roomId,userId]); assert(other.rows[0],404,'No one to call.');
          const id=p.callId||randomUUID();
          await store.sql.query(`INSERT INTO nc_calls(id,room_id,caller_id,callee_id,kind,status) VALUES($1,$2,$3,$4,'audio','ringing') ON CONFLICT(id) DO NOTHING`,[id,p.roomId,userId,other.rows[0].user_id]);
          return json({id},201);
        }
        assert(p.callId,400,'callId required.');
        const c=await store.sql.query('SELECT * FROM nc_calls WHERE id=$1 FOR UPDATE',[p.callId]); assert(c.rows[0],404,'Call not found.'); const call=c.rows[0];
        assert(call.caller_id===userId || call.callee_id===userId,403,'Not allowed.');
        if(p.action==='offer'){await store.sql.query("UPDATE nc_calls SET offer=$2,status='ringing',updated_at=now() WHERE id=$1",[p.callId,p.payload||'']);}
        else if(p.action==='answer'){await store.sql.query("UPDATE nc_calls SET answer=$2,status='active',updated_at=now() WHERE id=$1",[p.callId,p.payload||'']);}
        else if(p.action==='ice'){const col=call.caller_id===userId?'caller_ice':'callee_ice'; await store.sql.query(`UPDATE nc_calls SET ${col}=COALESCE(${col},'[]'::jsonb) || $2::jsonb,updated_at=now() WHERE id=$1`,[p.callId,JSON.stringify([p.payload||''])]);}
        else if(p.action==='decline'){await store.sql.query("UPDATE nc_calls SET status='declined',updated_at=now() WHERE id=$1",[p.callId]);}
        else if(p.action==='end'){await store.sql.query("UPDATE nc_calls SET status='ended',updated_at=now() WHERE id=$1",[p.callId]);}
        return json({ok:true});
      }
      if(path==='/calls' && method==='GET'){
        const roomId=url.searchParams.get('roomId'); assert(roomId,400,'roomId required.'); await member(store,userId,roomId);
        const r=await store.sql.query("SELECT id,room_id AS \"roomId\",caller_id AS \"callerId\",callee_id AS \"calleeId\",kind,status,offer,answer,caller_ice AS \"callerIce\",callee_ice AS \"calleeIce\",created_at AS \"createdAt\",updated_at AS \"updatedAt\" FROM nc_calls WHERE room_id=$1 AND updated_at>now()-interval '2 hours' ORDER BY updated_at DESC LIMIT 1",[roomId]);
        return json({call:(r.rows[0]||null) as CallState|null});
      }

      throw new ApiError(404,'NearChat endpoint not found.');
    });
  } catch(error) {
    if(error instanceof ApiError)return json({error:error.message},error.status);
    if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Check the information and try again.'},400);
    if(error && typeof error==='object' && 'code' in error && error.code==='23505')return json({error:'That username or number is already taken.'},409);
    return json({error:backendFailure(error).message},503);
  }
}
