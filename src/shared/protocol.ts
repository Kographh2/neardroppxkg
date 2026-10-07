import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const CHUNK_SIZE = 16 * 1024;
export const MAX_FILE_SIZE = 8 * 1024 ** 3;
export const MEMORY_RECEIVE_LIMIT = 100 * 1024 ** 2;
export const PAIRING_TTL = 5 * 60_000;
export const id = z.uuid();
export const deviceType = z.enum(['desktop', 'laptop', 'phone', 'tablet', 'android', 'unknown']);
export const publicKeySchema = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().regex(/^[A-Za-z0-9_-]{43}$/), y: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const registerSchema = z.object({ name: z.string().trim().min(1).max(48), type: deviceType, publicKey: publicKeySchema }).strict();
export const metadataSchema = z.object({
  name: z.string().min(1).max(255).transform(sanitizeFilename),
  size: z.number().int().min(0).max(MAX_FILE_SIZE),
  mime: z.string().max(128), kind: z.enum(['file', 'text', 'link'])
}).strict();
export const createTransferSchema = z.object({ receiverId: id, item: metadataSchema }).strict();
export const joinSchema = z.object({ code: z.string().transform(s => s.toUpperCase().replace(/[-\s]/g, '')).pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/)) }).strict();
export const signalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('signal'), transferId: id, description: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(32000) }).optional(), candidate: z.object({ candidate: z.string().max(4096), sdpMid: z.string().nullable().optional(), sdpMLineIndex: z.number().int().nullable().optional(), usernameFragment: z.string().nullable().optional() }).optional() }).strict(),
  z.object({ type: z.literal('transfer.transport'), transferId: id, transport: z.enum(['direct', 'relay', 'turn']) }).strict(),
  z.object({ type: z.literal('transfer.chunk'), transferId: id, sequence: z.number().int().nonnegative(), data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(22000) }).strict(),
  z.object({ type: z.literal('transfer.ack'), transferId: id, sequence: z.number().int().nonnegative(), bytes: z.number().int().nonnegative().max(MAX_FILE_SIZE) }).strict(),
  z.object({ type: z.literal('transfer.end'), transferId: id }).strict(),
  z.object({ type: z.literal('transfer.complete'), transferId: id }).strict(),
  z.object({ type: z.literal('transfer.fail'), transferId: id, reason: z.string().max(160) }).strict(),
  z.object({ type: z.literal('ping') }).strict()
]);
export type ClientEvent = z.infer<typeof signalSchema>;
export type DeviceType = z.infer<typeof deviceType>;
export type PublicKey = z.infer<typeof publicKeySchema>;
export type ItemMetadata = z.infer<typeof metadataSchema>;
export interface Device { id: string; name: string; type: DeviceType; publicKey: PublicKey; userId: string | null; online: boolean; lastSeen: string; trusted?: boolean }
export type TransferState = 'queued' | 'waiting' | 'preparing' | 'connecting' | 'transferring' | 'completed' | 'cancelled' | 'rejected' | 'failed';
export interface Transfer { id: string; senderId: string; receiverId: string; senderName: string; receiverName: string; item: ItemMetadata; status: TransferState; transport: 'direct' | 'relay' | 'turn' | null; bytes: number; createdAt: string; updatedAt: string }
export interface Pairing { id: string; initiatorId: string; joinerId: string | null; expiresAt: number; status: 'open' | 'pending' | 'accepted' | 'rejected'; }
export type ServerEvent =
  | { type: 'ready'; device: Device; devices: Device[]; transfers: Transfer[]; requests: { id: string; device: Device; expiresAt: number }[] }
  | { type: 'devices'; devices: Device[] }
  | { type: 'pairing.request'; id: string; device: Device; expiresAt: number }
  | { type: 'pairing.accepted'; device: Device }
  | { type: 'pairing.rejected'; id: string }
  | { type: 'transfer.updated'; transfer: Transfer }
  | { type: 'error'; message: string }
  | { type: 'pong' }
  | ClientEvent;

export const terminalStates: TransferState[] = ['completed', 'cancelled', 'rejected', 'failed'];
export function canTransition(from: TransferState, to: TransferState): boolean {
  const transitions: Record<TransferState, TransferState[]> = {
    queued: ['waiting', 'cancelled', 'failed'], waiting: ['preparing', 'rejected', 'cancelled', 'failed'],
    preparing: ['connecting', 'transferring', 'cancelled', 'failed'], connecting: ['transferring', 'cancelled', 'failed'],
    transferring: ['completed', 'cancelled', 'failed'], completed: [], cancelled: [], rejected: [], failed: []
  };
  return transitions[from].includes(to);
}
export function sanitizeFilename(name: string): string {
  return name.replace(/[\x00-\x1f\x7f/\\<>:"|?*\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^\.+/, '').trim().slice(0, 255) || 'untitled';
}
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1).replace(/\.0$/, '')} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
export function safeLink(value: string): string | null {
  try { const url = new URL(value.trim()); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
