import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
export function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function secret() { return randomBytes(32).toString('base64url'); }
export function pairingCode() { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
export function equalSecret(a: string, b: string) { const aa = Buffer.from(hash(a)); const bb = Buffer.from(hash(b)); return timingSafeEqual(aa, bb); }
export class RateLimiter {
  private entries = new Map<string, { count: number; reset: number }>();
  allow(key: string, max: number, windowMs = 60_000, now = Date.now()) {
    let entry = this.entries.get(key);
    if (!entry || entry.reset <= now) { entry = { count: 0, reset: now + windowMs }; this.entries.set(key, entry); }
    entry.count++;
    return entry.count <= max;
  }
  sweep(now = Date.now()) { for (const [key, entry] of this.entries) if (entry.reset <= now) this.entries.delete(key); }
}
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function assert(condition: unknown, status: number, message: string): asserts condition { if (!condition) throw new ApiError(status, message); }
