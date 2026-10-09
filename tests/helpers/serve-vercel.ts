import { createServer } from 'node:http';
import next from 'next';
import { testPostgres } from './postgres';
import { hash } from '../../server/security';

// Run the real Next route handlers against isolated PostgreSQL. There is no
// custom API interception and no connection to the user's configured database.
const fixture=await testPostgres();
// Isolated browser fixtures only. This entrypoint is never used by production.
for(const [id,username,name,token] of [
  ['10000000-0000-4000-8000-000000000001','alice_test','Alice Test','near-chat-alice-test'],
  ['10000000-0000-4000-8000-000000000002','bob_test','Bob Test','near-chat-bob-test']
]) {
  await fixture.db.query('INSERT INTO nc_profiles(id,username,display_name) VALUES($1,$2,$3)',[id,username,name]);
  await fixture.db.query("INSERT INTO nc_sessions(id,token_hash,user_id,name,expires_at) VALUES($1,$2,$1,$3,now()+interval '1 day')",[id,hash(token),'Test phone']);
}
process.env.APP_ORIGIN='http://localhost:3118';
// Local API tests exercise P2P without spending production TURN allocations.
process.env.CLOUDFLARE_TURN_KEY_ID='';process.env.CLOUDFLARE_TURN_API_TOKEN='';
process.env.TURN_URLS='';process.env.TURN_SECRET='';
const app=next({dev:true,webpack:true,hostname:'localhost',port:3118});
await app.prepare();
const handle=app.getRequestHandler();
const server=createServer((request,response)=>{void handle(request,response);});
server.on('upgrade',(request,socket,head)=>{void app.getUpgradeHandler()(request,socket,head);});
server.listen(3118,'localhost');
