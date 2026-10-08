import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testPostgres } from './helpers/postgres';
import { handleHttp } from '../server/http-platform';
import { generateIdentity } from '../src/transfer/crypto';
import type { Device, ServerEvent, Transfer } from '../src/shared/protocol';

test('Vercel HTTP API persists pairing and enforces sessions, CSRF, transfer consent and receiver completion',async()=>{
  const database=await testPostgres();process.env.APP_ORIGIN='http://localhost';
  async function request<T>(path:string,token?:string,body?:unknown,method?:string,origin='http://localhost') {
    const response=await handleHttp(new Request(`http://localhost/api/v1${path}`,{method:method||(body===undefined?'GET':'POST'),headers:{Origin:origin,'Content-Type':'application/json','x-neardrop-client':'native',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)}));
    return {status:response.status,body:await response.json() as T};
  }
  const makeDevice=async(name:string)=>{
    const r=await request<{device:Device;token:string;signaling:string}>('/devices/register',undefined,{name,type:'android',publicKey:(await generateIdentity()).publicKey});
    assert.equal(r.status,201);assert.equal(r.body.signaling,'http');assert.ok(r.body.token);assert.equal('tokenHash' in r.body.device,false);return r.body;
  };
  try {
    assert.equal((await request('/health')).status,200);
    assert.equal((await request('/devices')).status,401);
    const a=await makeDevice('Alice'),b=await makeDevice('Bob'),c=await makeDevice('Other');
    const sessionA=(await request<{connectionId:string;cursor:number}>('/session/connect',a.token,{})).body;
    const sessionB=(await request<{connectionId:string;cursor:number}>('/session/connect',b.token,{})).body;
    assert.equal((await request('/pairing/create',a.token,{},undefined,'https://evil.example')).status,403);
    assert.equal((await request(`/devices/${b.device.id}`,a.token,{name:'Hacked'},'PATCH')).status,404);
    const p=await request<{id:string;code:string}>('/pairing/create',a.token,{});assert.equal(p.status,200);
    const stored=await database.db.query<{code_hash:string}>('SELECT code_hash FROM nd_pairings WHERE id=$1',[p.body.id]);assert.notEqual(stored.rows[0].code_hash,p.body.code);
    assert.equal((await request('/pairing/join',b.token,{code:p.body.code})).status,200);
    const pending=await request<{events:ServerEvent[];cursor:number}>(`/events?connectionId=${sessionA.connectionId}&cursor=${sessionA.cursor}`,a.token);
    assert.equal(pending.status,200);assert.ok(pending.body.events.some(e=>e.type==='pairing.request'));
    assert.equal((await request('/pairing/confirm',c.token,{id:p.body.id})).status,400);
    const metadata={receiverId:b.device.id,item:{name:'hello.txt',size:12,mime:'text/plain',kind:'file'}};
    assert.equal((await request('/transfers',a.token,metadata)).status,403);
    assert.equal((await request('/pairing/confirm',a.token,{id:p.body.id})).status,200);
    assert.equal((await request('/pairing/join',c.token,{code:p.body.code})).status,400);
    assert.equal((await request(`/devices/${b.device.id}/trust`,a.token,{trusted:true})).status,403);
    const transfer=await request<{transfer:Transfer}>('/transfers',a.token,metadata);assert.equal(transfer.status,201);const id=transfer.body.transfer.id;
    assert.equal((await request('/transfers',a.token,metadata)).status,409);
    assert.equal((await request(`/transfers/${id}`,c.token)).status,404);
    assert.equal((await request(`/transfers/${id}/accept`,a.token,{})).status,403);
    const event=(who:typeof a,connectionId:string,message:unknown)=>request('/events',who.token,{connectionId,event:message});
    assert.equal((await event(a,sessionA.connectionId,{type:'signal',transferId:id,description:{type:'offer',sdp:'before consent'}})).status,409);
    assert.equal((await request(`/transfers/${id}/accept`,b.token,{})).status,200);
    assert.equal((await event(a,sessionA.connectionId,{type:'transfer.transport',transferId:id,transport:'relay'})).status,503);
    assert.equal((await event(a,sessionA.connectionId,{type:'transfer.transport',transferId:id,transport:'direct'})).status,200);
    assert.equal((await event(a,sessionA.connectionId,{type:'transfer.complete',transferId:id})).status,409);
    assert.equal((await event(b,sessionB.connectionId,{type:'transfer.complete',transferId:id})).status,409);
    assert.equal((await event(b,sessionB.connectionId,{type:'transfer.ack',transferId:id,sequence:0,bytes:13})).status,400);
    assert.equal((await event(b,sessionB.connectionId,{type:'transfer.ack',transferId:id,sequence:0,bytes:12})).status,200);
    assert.equal((await event(b,sessionB.connectionId,{type:'transfer.complete',transferId:id})).status,200);
    assert.equal((await request<{transfer:Transfer}>(`/transfers/${id}`,a.token)).body.transfer.status,'completed');
    const expired=await request<{id:string;code:string}>('/pairing/create',a.token,{});
    await database.db.query("UPDATE nd_pairings SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.body.id]);
    assert.equal((await request('/pairing/join',b.token,{code:expired.body.code})).status,400);
    await request('/session/connect',a.token,{});
    const replaced=await request<{code:string}>(`/events?connectionId=${sessionA.connectionId}&cursor=0`,a.token);
    assert.equal(replaced.status,409);assert.equal(replaced.body.code,'CONNECTION_REPLACED');
    const newSession=(await request<{connectionId:string;cursor:number}>('/session/connect',a.token,{})).body;
    const interrupted=await request<{transfer:Transfer}>('/transfers',a.token,metadata);
    assert.equal(interrupted.status,201);
    await database.db.query("UPDATE nd_presence SET expires_at=now()-interval '1 second' WHERE device_id=$1",[b.device.id]);
    const afterDisconnect=await request<{events:ServerEvent[]}>(`/events?connectionId=${newSession.connectionId}&cursor=${newSession.cursor}`,a.token);
    assert.ok(afterDisconnect.body.events.some(event=>event.type==='transfer.updated' && event.transfer.id===interrupted.body.transfer.id && event.transfer.status==='failed'));
    const devices=await request<{devices:Device[]}>('/devices',a.token);assert.equal(devices.body.devices[0].online,false);
    assert.equal((await request('/transfers',a.token,metadata)).status,409);
    // Denied pairing attempts count even when their mutation transaction rolls back.
    for(let n=0;n<12;n++)await request('/pairing/join',c.token,{code:'ABCDEF'});
    assert.equal((await request('/pairing/join',c.token,{code:'ABCDEF'})).status,429);
    await request('/auth/sign-out',a.token,{});
    assert.equal((await request('/devices',a.token)).status,401);
  } finally {await database.close();}
});

test('production registration tolerates the reported HTTP APP_ORIGIN and keeps secure cookies and origin checks',async()=>{
  const db=await testPostgres();
  const previous={NODE_ENV:process.env.NODE_ENV,APP_ORIGIN:process.env.APP_ORIGIN,VERCEL:process.env.VERCEL,VERCEL_PROJECT_PRODUCTION_URL:process.env.VERCEL_PROJECT_PRODUCTION_URL};
  Object.assign(process.env,{NODE_ENV:'production',APP_ORIGIN:'http://neardrops.vercel.app',VERCEL:'1',VERCEL_PROJECT_PRODUCTION_URL:'neardrops.vercel.app'});
  try {
    const input={name:'Production browser',type:'phone',publicKey:(await generateIdentity()).publicKey};
    const register=(origin:string)=>handleHttp(new Request('https://neardrops.vercel.app/api/v1/devices/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)}));
    const response=await register('https://neardrops.vercel.app');
    assert.equal(response.status,201);assert.match(response.headers.get('set-cookie')||'',/; Secure/);
    assert.equal((await register('https://attacker.example')).status,403);
    assert.equal((await register('http://neardrops.vercel.app')).status,403);
    const health=await handleHttp(new Request('https://neardrops.vercel.app/api/v1/health'));assert.equal(health.status,200);
    const result=await health.json();assert.equal(result.origin,'https://neardrops.vercel.app');
    await db.db.exec('DROP TABLE nd_rate_limits');
    const missing=await register('https://neardrops.vercel.app');assert.equal(missing.status,503);
    const problem=await missing.json();assert.equal(problem.code,'DATABASE_SCHEMA_MISSING');assert.equal(problem.retryable,false);
  } finally {
    for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await db.close();
  }
});
