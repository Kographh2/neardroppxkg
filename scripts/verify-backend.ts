import nextEnv from '@next/env';
import { generateIdentity } from '../src/transfer/crypto';
import { handleHttp } from '../server/http-platform';
import { database } from '../server/http-store';
import type { Device } from '../src/shared/protocol';
nextEnv.loadEnvConfig(process.cwd());

// Exercise the actual server code and configured DB, creating only isolated
// verification guests. Cleanup is restricted to IDs created by this invocation.
const created:string[]=[];
const verification: {sender?:{device:Device;token:string};receiver?:{device:Device;token:string}} = {};
async function call<T>(path:string,token?:string,body?:unknown):Promise<T> {
  const response=await handleHttp(new Request(`https://neardrops.vercel.app/api/v1${path}`,{
    method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-neardrop-client':'native',...(token?{Authorization:`Bearer ${token}`}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  }));
  if(!response.ok)throw new Error(`Verification failed at ${path}: HTTP ${response.status}`);
  return await response.json() as T;
}
try {
  const health=await call<{status:string;signaling:string}>('/health');
  for(const name of ['NearDrop verification sender','NearDrop verification receiver']) {
    const result=await call<{device:Device;token:string}>('/devices/register',undefined,{name,type:'unknown',publicKey:(await generateIdentity()).publicKey});
    created.push(result.device.id);
    await call('/session/connect',result.token,{});
    // Tokens stay in memory and are never printed or written to a file.
    if(created.length===1)verification.sender=result;else verification.receiver=result;
  }
  const {sender,receiver}=verification;
  if(!sender || !receiver)throw new Error('Verification devices were not created.');
  const pairing=await call<{id:string;code:string}>('/pairing/create',sender.token,{});
  await call('/pairing/join',receiver.token,{code:pairing.code});
  await call('/pairing/confirm',sender.token,{id:pairing.id});
  const result=await call<{devices:Device[]}>('/devices',sender.token);
  if(!result.devices.some(device=>device.id===receiver.device.id && device.online))throw new Error('Paired device was not online.');
  console.log(JSON.stringify({database:health.status,signaling:health.signaling,registration:'passed',pairing:'passed',presence:'passed'}));
} finally {
  try {
    if(created.length)await database().query('DELETE FROM devices WHERE id=ANY($1::uuid[])',[created]);
  } finally {await database().end();}
}
