import type { PublicKey } from '../shared/protocol';
export interface Identity { privateKey: JsonWebKey; publicKey: PublicKey }
export async function generateIdentity(): Promise<Identity> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: { kty: 'EC', crv: 'P-256', x: pub.x!, y: pub.y! } };
}
export async function deriveTransferKey(identity: Identity, peer: PublicKey, transferId: string) {
  const privateKey = await crypto.subtle.importKey('jwk', identity.privateKey, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const publicKey = await crypto.subtle.importKey('jwk', peer, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(transferId), info: new TextEncoder().encode('neardrop-v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function nonce(sequence: number) { const result = new Uint8Array(12); new DataView(result.buffer).setUint32(8, sequence, false); return result; }
export function toBase64(bytes: ArrayBuffer) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
export function fromBase64(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export async function encryptChunk(key: CryptoKey, sequence: number, bytes: ArrayBuffer, transferId: string) {
  return toBase64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(sequence), additionalData: new TextEncoder().encode(transferId) }, key, bytes));
}
export async function decryptChunk(key: CryptoKey, sequence: number, data: string, transferId: string) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(sequence), additionalData: new TextEncoder().encode(transferId) }, key, fromBase64(data));
}
