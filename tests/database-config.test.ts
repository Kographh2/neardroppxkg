import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseConnectionString, databasePoolOptions, normalizeDatabaseUrl } from '../server/database-config';
import { X509Certificate } from 'node:crypto';

test('copied dotenv values are normalized without changing database credentials',()=>{
  const uri='postgresql://postgres.project:p%40ss%23word@pooler.example:6543/postgres?sslmode=verify-full';
  for(const value of [uri,`DATABASE_URL=${uri}`,`DATABASE_URL="${uri}"`,`'DATABASE_URL=${uri}'`,`POSTGRES_URL = '${uri}'`]) {
    assert.equal(normalizeDatabaseUrl(value),uri);
    assert.equal(databaseConnectionString({DATABASE_URL:value}),uri);
  }
  assert.equal(databaseConnectionString({POSTGRES_URL:uri}),uri);
  assert.equal(databaseConnectionString({DATABASE_URL:'  ',POSTGRES_URL:uri}),uri);
});
test('Supabase verifies TLS with the official CA even if URL parameters request weaker SSL',()=>{
  const options=databasePoolOptions({DATABASE_URL:'postgresql://postgres.project:test@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=no-verify&ssl=false&uselibpqcompat=true'});
  assert.equal(options.ssl?.rejectUnauthorized,true);
  assert.ok(options.ssl && 'ca' in options.ssl && options.ssl.ca);
  assert.equal(new X509Certificate(options.ssl.ca).fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.equal(new URL(options.connectionString).search,'');
  assert.equal(new URL(options.connectionString).password,'test');
  assert.equal(databasePoolOptions({DATABASE_URL:'postgresql://user:pass@localhost/db'}).ssl,undefined);
});
test('missing URLs, psql commands and non-PostgreSQL URLs fail without exposing their contents',()=>{
  for(const value of ['https://secret.example','psql postgresql://secret.example','bad secret'])
    assert.throws(()=>databaseConnectionString({DATABASE_URL:value}),e=>e instanceof Error && 'code' in e && e.code==='DATABASE_URL_INVALID' && !e.message.includes('secret'));
  assert.throws(()=>databaseConnectionString({}),e=>e instanceof Error && 'code' in e && e.code==='DATABASE_NOT_CONFIGURED');
});
