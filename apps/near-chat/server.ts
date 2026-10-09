import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, rateLimit, transaction, type HttpStore } from '../../server/http-store';
import { deploymentOrigins } from '../../server/deployment-origin';
import { ApiError, assert, hash, pairingCode, secret } from '../../server/security';
import { backendFailure } from '../../server/backend-error';
import { messageSchema, profileSchema, roomSchema, type Profile } from './shared';

const json = (body: unknown, status = 200, headers: Record<string,string> = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const cookie = (r: Request, name: string) => r.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name+'='))?.slice(name.length+1);
const profile = (row: { id: string; username: string; display_name: string }): Profile => ({ id: row.id, username: row.username, displayName: row.display_name });
type Session = { id: string; user_id: string; name: string };
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
  const r=await store.sql.query('SELECT user_id FROM nc_members WHERE room_id=$1 AND user_id=$2',[roomId,userId]);assert(r.rowCount,404,'Conversation not found.');
}
async function input(request: Request) {
  const reader=request.body?.getReader();if(!reader)return {};
  const parts: Uint8Array[]=[];let count=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;assert(count<=32768,413,'Request is too large.');parts.push(value);}return JSON.parse(Buffer.concat(parts).toString()||'{}') as unknown;}
  catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'Invalid request.');}
  finally {await reader.cancel();reader.releaseLock();}
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
    if(path==='/session' && method==='POST') {
      await rateLimit(`nc-login:${hash(ip)}`,20,300000);
      const parsed=z.object({accessToken:z.string().min(20).max(8192),name:z.string().trim().min(1).max(48)}).strict().parse(data);
      const base=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      assert(base&&key,503,'Account sign-in is not configured.');
      const result=await fetch(`${base}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${parsed.accessToken}`},signal:AbortSignal.timeout(8000)});
      assert(result.ok,401,'Sign in again to continue.');
      const user=z.object({id:z.uuid(),email_confirmed_at:z.string().nullable().optional()}).parse(await result.json());
      assert(user.email_confirmed_at,403,'Verify your email before signing in to NearChat.');
      return await transaction(async store=>{
        await store.sql.query('INSERT INTO nc_profiles(id,username,display_name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[user.id,'near_'+user.id.replaceAll('-','').slice(0,16),'New member']);
        return json({ok:true},200,{'Set-Cookie':sessionCookie(await createSession(store,user.id,parsed.name))});
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
    await rateLimit(`nc-user:${current.user_id}`,300);
    if(path==='/link/approve')await rateLimit(`nc-approve:${current.user_id}`,10,300000);
    if(Math.random()<0.02)await database().query('DELETE FROM nc_sessions WHERE expires_at<now()');
    return await transaction(async store=>{
      const verified=await session(store,request),userId=verified.user_id;
      if(path==='/me' && method==='GET') {
        const r=await store.sql.query<{id:string;username:string;display_name:string}>('SELECT id,username,display_name FROM nc_profiles WHERE id=$1',[userId]);return json({profile:profile(r.rows[0])});
      }
      if(path==='/me' && method==='PATCH') {
        const p=profileSchema.parse(data);
        await store.sql.query('UPDATE nc_profiles SET username=$2,display_name=$3 WHERE id=$1',[userId,p.username,p.displayName]);return json({profile:{id:userId,...p}});
      }
      if(path==='/sessions' && method==='GET') {
        const r=await store.sql.query<{id:string;name:string;createdAt:string}>('SELECT id,name,created_at AS "createdAt" FROM nc_sessions WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC',[userId]);return json({sessions:r.rows.map(s=>({...s,current:s.id===verified.id}))});
      }
      const revoke=path.match(/^\/sessions\/([a-f0-9-]{36})$/);
      if(revoke && method==='DELETE'){await store.sql.query('DELETE FROM nc_sessions WHERE id=$1 AND user_id=$2',[revoke[1],userId]);return json({ok:true});}
      if(path==='/sign-out' && method==='POST'){await store.sql.query('DELETE FROM nc_sessions WHERE id=$1',[verified.id]);return json({ok:true},200,{'Set-Cookie':sessionCookie('')});}
      if(path==='/link/approve' && method==='POST') {
        const {code,approve}=z.object({code:z.string().transform(s=>s.toUpperCase().replace(/[-\s]/g,'')).pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/)),approve:z.boolean()}).strict().parse(data);
        const r=await store.sql.query<{id:string;name:string}>('SELECT id,name FROM nc_links WHERE code_hash=$1 AND expires_at>now() AND user_id IS NULL AND NOT consumed FOR UPDATE',[hash(code)]);
        assert(r.rows[0],410,'This login code is invalid or expired.');
        if(approve)await store.sql.query('UPDATE nc_links SET user_id=$2 WHERE id=$1',[r.rows[0].id,userId]);return json({name:r.rows[0].name,approved:approve});
      }
      if(path==='/rooms' && method==='GET') {
        const r=await store.sql.query(`SELECT r.id,r.name,r.kind,r.owner_id AS "ownerId",r.updated_at AS "updatedAt",
          (SELECT count(*)::int FROM nc_messages x WHERE x.room_id=r.id AND x.sequence>m.last_read AND x.sender_id<>$1) AS unread,
          (SELECT jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'displayName',p.display_name)) FROM nc_members mm JOIN nc_profiles p ON p.id=mm.user_id WHERE mm.room_id=r.id) AS members
          FROM nc_rooms r JOIN nc_members m ON m.room_id=r.id WHERE m.user_id=$1 ORDER BY r.updated_at DESC LIMIT 100`,[userId]);return json({rooms:r.rows});
      }
      if(path==='/rooms' && method==='POST') {
        const p=roomSchema.parse(data),names=[...new Set(p.members)];
        assert(p.kind==='group'||names.length===1,400,'Choose one person for a direct chat.');
        assert(p.kind!=='group'||p.name.length>0,400,'Give this group a name.');
        const users=await store.sql.query<{id:string}>('SELECT id FROM nc_profiles WHERE username=ANY($1::text[])',[names]);
        assert(users.rows.length===names.length && users.rows.every(u=>u.id!==userId),400,'One of these usernames was not found. Check with your friend.');
        const ids=[userId,...users.rows.map(u=>u.id)].sort(),direct=p.kind==='direct'?ids.join(':'):null,id=randomUUID();
        const room=await store.sql.query<{id:string}>(`INSERT INTO nc_rooms(id,kind,name,owner_id,direct_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(direct_key) DO UPDATE SET direct_key=EXCLUDED.direct_key RETURNING id`,[id,p.kind,p.name,userId,direct]);
        for(const memberId of ids)await store.sql.query('INSERT INTO nc_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[room.rows[0].id,memberId]);return json({id:room.rows[0].id},201);
      }
      const roomPath=path.match(/^\/rooms\/([a-f0-9-]{36})(?:\/(messages|read|leave))?$/);
      if(roomPath){
        const roomId=z.uuid().parse(roomPath[1]);await member(store,userId,roomId);
        if(roomPath[2]==='messages' && method==='GET') {
          const before=z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).parse(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
          const r=await store.sql.query('SELECT x.id,x.room_id AS "roomId",x.sender_id AS "senderId",x.body,x.sequence::float8 AS sequence,x.created_at AS "createdAt",p.display_name AS "senderName" FROM nc_messages x JOIN nc_profiles p ON p.id=x.sender_id WHERE x.room_id=$1 AND x.sequence<$2 ORDER BY x.sequence DESC LIMIT 50',[roomId,before]);return json({messages:r.rows.reverse(),hasMore:r.rows.length===50});
        }
        if(roomPath[2]==='messages' && method==='POST') {
          const p=messageSchema.parse(data);await store.sql.query('SELECT id FROM nc_rooms WHERE id=$1 FOR UPDATE',[roomId]);await member(store,userId,roomId);
          const existing=await store.sql.query<{sender_id:string;room_id:string;body:string}>('SELECT sender_id,room_id,body FROM nc_messages WHERE id=$1',[p.id]);
          if(existing.rows[0]){assert(existing.rows[0].sender_id===userId&&existing.rows[0].room_id===roomId&&existing.rows[0].body===p.body,409,'Message ID already used.');return json({ok:true});}
          await store.sql.query('INSERT INTO nc_messages(id,room_id,sender_id,body) VALUES($1,$2,$3,$4)',[p.id,roomId,userId,p.body]);
          await store.sql.query('UPDATE nc_rooms SET updated_at=now() WHERE id=$1',[roomId]);return json({ok:true},201);
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
      throw new ApiError(404,'NearChat endpoint not found.');
    });
  } catch(error) {
    if(error instanceof ApiError)return json({error:error.message},error.status);
    if(error instanceof z.ZodError)return json({error:'Check the information and try again.'},400);
    if(error && typeof error==='object' && 'code' in error && error.code==='23505')return json({error:'That username is already taken.'},409);
    return json({error:backendFailure(error).message},503);
  }
}
