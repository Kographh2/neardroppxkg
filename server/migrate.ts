import nextEnv from '@next/env';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { databasePoolOptions } from './database-config';
nextEnv.loadEnvConfig(process.cwd());
const pool = new pg.Pool({ ...databasePoolOptions(), connectionTimeoutMillis: 10000 });
try {
  for (const name of ['001_platform.sql', '002_http_signaling.sql']) await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  console.info('NearDrop database migrated.');
} finally { await pool.end(); }
