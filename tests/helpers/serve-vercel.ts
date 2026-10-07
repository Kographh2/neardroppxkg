import { createServer } from 'node:http';
import next from 'next';
import { testPostgres } from './postgres';

// Run the real Next route handlers against isolated PostgreSQL. There is no
// custom API interception and no connection to the user's configured database.
await testPostgres();
process.env.APP_ORIGIN='http://localhost:3118';
const app=next({dev:true,hostname:'localhost',port:3118});
await app.prepare();
const handle=app.getRequestHandler();
const server=createServer((request,response)=>{void handle(request,response);});
server.on('upgrade',(request,socket,head)=>{void app.getUpgradeHandler()(request,socket,head);});
server.listen(3118,'localhost');
