import nextEnv from '@next/env';
import pg from 'pg';
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL is not configured.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
try {
  const result = await pool.query("select to_regclass('public.devices') is not null as schema_ready, to_regclass('public.nd_presence') is not null as http_signaling_ready");
  console.log(JSON.stringify(result.rows[0]));
} catch (error) {
  console.log(JSON.stringify({ databaseReachable: false, code: error.code || error.name }));
  process.exitCode = 1;
} finally { await pool.end(); }
