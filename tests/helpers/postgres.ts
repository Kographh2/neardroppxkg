import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { mock } from 'node:test';
import pg from 'pg';

/** Real PostgreSQL SQL engine, isolated from DATABASE_URL and production data. */
export async function testPostgres() {
  const db = new PGlite();
  for (const name of ['001_platform.sql', '002_http_signaling.sql'])
    await db.exec(await readFile(new URL(`../../migrations/${name}`,import.meta.url),'utf8'));
  let tail=Promise.resolve();
  async function acquire() {
    const previous=tail;let release!:()=>void;
    tail=new Promise<void>(resolve=>{release=resolve;});await previous;return release;
  }
  async function query(sql: string, values?: unknown[]) {
    const result=await db.query(sql,values);
    return {rows:result.rows,rowCount:result.affectedRows || result.rows.length};
  }
  const connect=mock.method(pg.Pool.prototype,'connect',async()=>{
    const release=await acquire();return {query,release};
  });
  const poolQuery=mock.method(pg.Pool.prototype,'query',async(sql:string,values?:unknown[])=>{
    const release=await acquire();try{return await query(sql,values);}finally{release();}
  });
  process.env.DATABASE_URL='postgresql://isolated-test/unused';
  return {db,async close(){connect.mock.restore();poolQuery.mock.restore();await db.close();}};
}
