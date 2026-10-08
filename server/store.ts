import pg from 'pg';
import { databasePoolOptions } from './database-config';
import type { Device, Pairing, Transfer } from '../src/shared/protocol';
export interface StoredDevice extends Device { tokenHash: string; expiresAt: number }
export interface Relationship { a: string; b: string; trustedBy: string[] }
export class Store {
  devices = new Map<string, StoredDevice>();
  pairings = new Map<string, Pairing & { codeHash: string }>();
  relationships = new Map<string, Relationship>();
  transfers = new Map<string, Transfer>();
  pool: pg.Pool | null = null;
  relationshipKey(a: string, b: string) { return [a, b].sort().join(':'); }
  related(a: string, b: string) { return this.relationships.has(this.relationshipKey(a, b)); }
  async init() {
    if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
      if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production. Run npm run db:migrate first.');
      console.info('NearDrop: development guest state is ephemeral. Configure DATABASE_URL for persistence.');
      return;
    }
    this.pool = new pg.Pool({ ...databasePoolOptions(), max: 10 });
    const devices = await this.pool.query<{ data: StoredDevice }>('select data from devices where expires_at > now()');
    for (const { data } of devices.rows) this.devices.set(data.id, { ...data, online: false });
    const relationships = await this.pool.query<{ data: Relationship }>('select data from device_relationships');
    for (const { data } of relationships.rows) if (this.devices.has(data.a) && this.devices.has(data.b)) this.relationships.set(this.relationshipKey(data.a, data.b), data);
    const transfers = await this.pool.query<{ data: Transfer }>("select data from transfer_sessions where created_at > now() - interval '30 days' order by created_at desc limit 10000");
    for (const { data } of transfers.rows) this.transfers.set(data.id, data);
  }
  async saveDevice(device: StoredDevice) {
    if (this.pool) await this.pool.query('insert into devices(id, user_id, expires_at, data) values($1,$2,$3,$4) on conflict(id) do update set user_id=$2, expires_at=$3, data=$4', [device.id, device.userId, new Date(device.expiresAt), JSON.stringify({ ...device, online: false })]);
    this.devices.set(device.id, device);
  }
  async saveRelationship(relation: Relationship) {
    const key = this.relationshipKey(relation.a, relation.b);
    if (this.pool) await this.pool.query('insert into device_relationships(id, device_a, device_b, data) values($1,$2,$3,$4) on conflict(id) do update set data=$4', [key, relation.a, relation.b, JSON.stringify(relation)]);
    this.relationships.set(key, relation);
  }
  async deleteRelationship(a: string, b: string) {
    const key = this.relationshipKey(a, b);
    if (this.pool) await this.pool.query('delete from device_relationships where id=$1', [key]);
    this.relationships.delete(key);
  }
  async saveTransfer(transfer: Transfer) {
    const previous = this.transfers.get(transfer.id);
    this.transfers.set(transfer.id, transfer);
    try {
      if (this.pool) await this.pool.query('insert into transfer_sessions(id, sender_id, receiver_id, created_at, data) values($1,$2,$3,$4,$5) on conflict(id) do update set data=$5', [transfer.id, transfer.senderId, transfer.receiverId, transfer.createdAt, JSON.stringify(transfer)]);
    } catch (error) { if (previous) this.transfers.set(transfer.id, previous); else this.transfers.delete(transfer.id); throw error; }
  }
  publicDevice(device: StoredDevice, forDevice?: string): Device {
    const { tokenHash: _token, expiresAt: _expires, ...visible } = device;
    return { ...visible, trusted: forDevice ? this.relationships.get(this.relationshipKey(device.id, forDevice))?.trustedBy.includes(forDevice) : false };
  }
  listDevices(forDevice: string) {
    return [...this.devices.values()].filter(d => d.id !== forDevice && this.related(d.id, forDevice)).map(d => this.publicDevice(d, forDevice));
  }
  history(device: StoredDevice) {
    const ownedIds = new Set([...this.devices.values()].filter(d => d.id === device.id || (device.userId && d.userId === device.userId)).map(d => d.id));
    return [...this.transfers.values()].filter(t => ownedIds.has(t.senderId) || ownedIds.has(t.receiverId)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }
  async cleanup() {
    const now = Date.now();
    for (const [id, pairing] of this.pairings) if (pairing.expiresAt < now) this.pairings.delete(id);
    for (const [id, device] of this.devices) if (device.expiresAt < now && !device.online) this.devices.delete(id);
    for (const [id, transfer] of this.transfers) if (Date.parse(transfer.createdAt) < now - 30 * 86400000) this.transfers.delete(id);
    for (const [id, relation] of this.relationships) if (!this.devices.has(relation.a) || !this.devices.has(relation.b)) this.relationships.delete(id);
    if (this.pool) { await this.pool.query('delete from devices where expires_at < now()'); await this.pool.query("delete from transfer_sessions where created_at < now() - interval '30 days'"); }
  }
}
