import pg from 'pg';
import type { Device, Pairing, ServerEvent, Transfer } from '../src/shared/protocol';
import type { Relationship, StoredDevice } from './store';
import { assert } from './security';
import { databasePoolOptions } from './database-config';

let pool: pg.Pool | undefined;
export function database() {
  const options = databasePoolOptions();
  if (!pool) {
    pool = new pg.Pool({ ...options, max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000 });
    pool.on('error', () => console.error('NearDrop database connection closed. A new connection will be requested.'));
  }
  return pool;
}

export async function transaction<T>(work: (store: HttpStore) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '8s'");
    const result = await work(new HttpStore(client));
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function rateLimit(key: string, maximum: number, duration = 60000) {
  // Separate transaction: rejected attempts must still count.
  const result = await database().query<{ hits: number }>(`INSERT INTO nd_rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2::int*interval '1 millisecond')
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN nd_rate_limits.expires_at<now() THEN 1 ELSE nd_rate_limits.hits+1 END,
    expires_at=CASE WHEN nd_rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE nd_rate_limits.expires_at END RETURNING hits`, [key, duration]);
  assert(result.rows[0].hits <= maximum, 429, 'Too many attempts. Please wait before trying again.');
}

export type StoredPairing = Pairing & { codeHash: string };
export class HttpStore {
  constructor(public sql: pg.PoolClient) {}
  async authenticate(tokenHash: string) {
    const r = await this.sql.query<{ data: StoredDevice }>("SELECT data FROM devices WHERE data->>'tokenHash'=$1 AND expires_at>now()", [tokenHash]);
    assert(r.rows[0], 401, 'Your device session expired. Reconnect to continue.'); return r.rows[0].data;
  }
  async device(id: string) {
    const r = await this.sql.query<{ data: StoredDevice; online: boolean }>(`SELECT d.data,coalesce(p.expires_at>now(),false) AS online FROM devices d
      LEFT JOIN nd_presence p ON p.device_id=d.id WHERE d.id=$1 AND d.expires_at>now()`, [id]);
    return r.rows[0] ? { ...r.rows[0].data, online: r.rows[0].online } : undefined;
  }
  visible(d: StoredDevice, trusted = false): Device {
    const { tokenHash: _token, expiresAt: _expires, ...device } = d; return { ...device, trusted };
  }
  async lockDevices(ids: string[]) {
    // Every mutation uses the same order, including event producers and polls.
    await this.sql.query('SELECT id FROM devices WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[...new Set(ids)].sort()]);
  }
  async saveDevice(d: StoredDevice) {
    await this.sql.query(`INSERT INTO devices(id,user_id,expires_at,data) VALUES($1,$2,$3,$4)
      ON CONFLICT(id) DO UPDATE SET user_id=$2,expires_at=$3,data=$4`, [d.id,d.userId,new Date(d.expiresAt),JSON.stringify({ ...d,online:false })]);
  }
  async related(a: string, b: string) {
    const r = await this.sql.query<{ data: Relationship }>('SELECT data FROM device_relationships WHERE id=$1', [[a,b].sort().join(':')]); return r.rows[0]?.data;
  }
  async saveRelationship(r: Relationship) {
    await this.sql.query(`INSERT INTO device_relationships(id,device_a,device_b,data) VALUES($1,$2,$3,$4)
      ON CONFLICT(id) DO UPDATE SET data=$4`, [[r.a,r.b].sort().join(':'),r.a,r.b,JSON.stringify(r)]);
  }
  async devices(id: string) {
    const rows = await this.sql.query<{ data: StoredDevice; relation: Relationship; online: boolean }>(`SELECT d.data,r.data AS relation,coalesce(p.expires_at>now(),false) AS online
      FROM device_relationships r JOIN devices d ON d.id=CASE WHEN r.device_a=$1 THEN r.device_b ELSE r.device_a END
      LEFT JOIN nd_presence p ON p.device_id=d.id WHERE (r.device_a=$1 OR r.device_b=$1) AND d.expires_at>now()`, [id]);
    return rows.rows.map(r => this.visible({ ...r.data,online:r.online }, r.relation.trustedBy.includes(id)));
  }
  async history(device: StoredDevice) {
    const r = await this.sql.query<{ data: Transfer }>(`SELECT data FROM transfer_sessions WHERE created_at>now()-interval '30 days' AND (sender_id IN
      (SELECT id FROM devices WHERE id=$1 OR ($2::uuid IS NOT NULL AND user_id=$2)) OR receiver_id IN
      (SELECT id FROM devices WHERE id=$1 OR ($2::uuid IS NOT NULL AND user_id=$2))) ORDER BY created_at DESC LIMIT 100`, [device.id,device.userId]); return r.rows.map(r=>r.data);
  }
  async transfer(id: string, lock = false) {
    const r = await this.sql.query<{ data: Transfer }>(`SELECT data FROM transfer_sessions WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]); return r.rows[0]?.data;
  }
  async saveTransfer(t: Transfer) {
    await this.sql.query(`INSERT INTO transfer_sessions(id,sender_id,receiver_id,created_at,data) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(id) DO UPDATE SET data=$5`, [t.id,t.senderId,t.receiverId,t.createdAt,JSON.stringify(t)]);
  }
  async emit(id: string, event: ServerEvent) {
    // A per-recipient sequence is incremented under a row lock in the same
    // transaction as INSERT. Polling cannot skip a lower, uncommitted sequence.
    const r = await this.sql.query<{ next_event: string }>('UPDATE nd_presence SET next_event=next_event+1 WHERE device_id=$1 RETURNING next_event', [id]);
    if (r.rows[0]) await this.sql.query("INSERT INTO nd_events(device_id,sequence,data,expires_at) VALUES($1,$2,$3,now()+interval '2 minutes')", [id,r.rows[0].next_event,JSON.stringify(event)]);
  }
  async publish(t: Transfer) { for (const id of [t.senderId,t.receiverId].sort()) await this.emit(id, { type:'transfer.updated',transfer:t }); }
  async pairing(where: 'id' | 'code_hash', value: string, lock = false): Promise<StoredPairing | undefined> {
    const r = await this.sql.query<{ id:string; initiator_id:string; joiner_id:string|null; expires_at:Date; status:Pairing['status']; code_hash:string }>(`SELECT * FROM nd_pairings WHERE ${where}=$1${lock ? ' FOR UPDATE' : ''}`, [value]);
    const p=r.rows[0]; return p && { id:p.id,initiatorId:p.initiator_id,joinerId:p.joiner_id,expiresAt:p.expires_at.getTime(),status:p.status,codeHash:p.code_hash };
  }
  async requests(id: string) {
    const r=await this.sql.query<{ id:string; expires_at:Date; data:StoredDevice }>(`SELECT p.id,p.expires_at,d.data FROM nd_pairings p JOIN devices d ON d.id=p.joiner_id
      WHERE p.initiator_id=$1 AND p.status='pending' AND p.expires_at>now()`, [id]);
    return r.rows.map(r=>({id:r.id,expiresAt:r.expires_at.getTime(),device:this.visible(r.data)}));
  }
  async cleanup() {
    // Content is never stored by this transport. Expired metadata is also
    // pruned during requests; no cron dependency is needed for file privacy.
    await this.sql.query('DELETE FROM nd_events WHERE expires_at<now()');
    await this.sql.query('DELETE FROM nd_pairings WHERE expires_at<now()');
    await this.sql.query('DELETE FROM nd_rate_limits WHERE expires_at<now()');
    await this.sql.query("DELETE FROM transfer_sessions WHERE created_at<now()-interval '30 days'");
  }
}
