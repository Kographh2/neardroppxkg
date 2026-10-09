import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { nearChatApi } from '../apps/near-chat/server';
import { testPostgres } from './helpers/postgres';
import type { Message, Profile, Room } from '../apps/near-chat/shared';

test('NearChat requires verified accounts, limits room access and securely consumes QR login',async()=>{
 const db=await testPostgres();process.env.APP_ORIGIN='http://localhost';
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://auth.test';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-key';
 const a=crypto.randomUUID(),b=crypto.randomUUID(),c=crypto.randomUUID();
 const tokens=new Map([[`verified-${a}`,a],[`verified-${b}`,b],[`verified-${c}`,c]]);
 const fetcher=mock.method(globalThis,'fetch',async(_url:string|URL|Request,options?:RequestInit)=>{
  const token=new Headers(options?.headers).get('Authorization')?.slice(7)||'';
  if(token.startsWith('unverified'))return Response.json({id:c,email_confirmed_at:null});
  return tokens.has(token)?Response.json({id:tokens.get(token),email_confirmed_at:new Date().toISOString()}):Response.json({error:'bad token'},{status:401});
 });
 async function req<T=Record<string,unknown>>(path:string,cookie='',data?:unknown,method?:string,origin='http://localhost'){
  const r=await nearChatApi(new Request('http://localhost/api/near-chat'+path,{method:method||(data===undefined?'GET':'POST'),headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}));
  return {status:r.status,body:await r.json() as T,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
 }
 try{
  assert.equal((await req('/me')).status,401);
  assert.equal((await req('/session','',{accessToken:'invalid-token-of-enough-length',name:'PC'})).status,401);
  assert.equal((await req('/session','',{accessToken:'unverified-token-of-enough-length',name:'PC'})).status,403);
  const login=async(id:string,name:string)=>{const r=await req('/session','',{accessToken:`verified-${id}`,name});assert.equal(r.status,200);assert.match(r.cookie,/nc_session=/);return r.cookie;};
  const ca=await login(a,'Alice phone'),cb=await login(b,'Bob phone'),cc=await login(c,'Mallory');
  for(const [cookie,username] of [[ca,'alice'],[cb,'bob'],[cc,'mallory']])assert.equal((await req('/me',cookie,{username,displayName:username},'PATCH')).status,200);
  assert.equal((await req('/me',cc,{username:'alice',displayName:'Fake'},'PATCH')).status,409);
  assert.equal((await req('/rooms',ca,{kind:'direct',members:['bob']},undefined,'https://evil.test')).status,403);
  const direct=await req<{id:string}>('/rooms',ca,{kind:'direct',members:['bob']});assert.equal(direct.status,201);
  assert.equal((await req<{id:string}>('/rooms',cb,{kind:'direct',members:['alice']})).body.id,direct.body.id);
  const room=direct.body.id,path=`/rooms/${room}/messages`;
  assert.equal((await req(path,cc)).status,404);
  const message={id:crypto.randomUUID(),body:'<script>inert text</script>'};
  assert.equal((await req(path,cc,message)).status,404);
  assert.equal((await req(path,ca,message)).status,201);
  assert.equal((await req(path,ca,message)).status,200);
  assert.equal((await req(path,cb,message)).status,409);
  const received=await req<{messages:Message[]}>(path,cb);assert.equal(received.body.messages.length,1);assert.equal(received.body.messages[0].body,message.body);
  assert.equal((await req<{rooms:Room[]}>('/rooms',cb)).body.rooms[0].unread,1);
  await req(`/rooms/${room}/read`,cb,{sequence:received.body.messages[0].sequence});
  assert.equal((await req<{rooms:Room[]}>('/rooms',cb)).body.rooms[0].unread,0);
  const group=(await req<{id:string}>('/rooms',ca,{kind:'group',name:'Friends',members:['bob']})).body.id;
  assert.equal((await req(`/rooms/${group}/leave`,cb,{})).status,200);
  assert.equal((await req(`/rooms/${group}/messages`,cb)).status,404);
  assert.equal((await req(`/rooms/${group}/leave`,ca,{})).status,200);
  const link=await req<{id:string;code:string}>('/link','',{name:'Desktop'});assert.equal(link.status,201);
  const poll=`/link/status?id=${link.body.id}`;
  assert.equal((await req(poll)).status,401);
  assert.equal((await req(poll,'nc_link=wrong')).status,410);
  assert.equal((await req<{status:string}>(poll,link.cookie)).body.status,'waiting');
  assert.equal((await req('/link/approve','',{code:link.body.code,approve:true})).status,401);
  assert.equal((await req('/link/approve',ca,{code:link.body.code,approve:false})).status,200);
  assert.equal((await req<{status:string}>(poll,link.cookie)).body.status,'waiting');
  assert.equal((await req('/link/approve',ca,{code:link.body.code,approve:true})).status,200);
  const approved=await req<{status:string}>(poll,link.cookie);assert.equal(approved.body.status,'approved');
  assert.equal((await req<{profile:Profile}>('/me',approved.cookie)).body.profile.id,a);
  assert.equal((await req(poll,link.cookie)).status,410);
  const sessions=await req<{sessions:{id:string;current:boolean}[]}>('/sessions',ca);
  const desktop=sessions.body.sessions.find(s=>!s.current)!;
  await req(`/sessions/${desktop.id}`,ca,{},'DELETE');assert.equal((await req('/me',approved.cookie)).status,401);
  const expired=await req<{id:string;code:string}>('/link','',{name:'Expired'});
  await db.db.query("UPDATE nc_links SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.body.id]);
  assert.equal((await req('/link/approve',ca,{code:expired.body.code,approve:true})).status,410);
  await req('/sign-out',ca,{});assert.equal((await req('/me',ca)).status,401);
 }finally{fetcher.mock.restore();await db.close();}
});
