import nextEnv from '@next/env';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before migrating.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
try { await pool.query(await readFile(new URL('../migrations/001_platform.sql', import.meta.url), 'utf8')); console.info('NearDrop database migrated.'); } finally { await pool.end(); }
