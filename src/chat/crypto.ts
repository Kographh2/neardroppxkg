import { deriveTransferKey, generateIdentity, toBase64, fromBase64, type Identity } from '../transfer/crypto';
import type { PublicKey } from '../shared/protocol';
import type { ChatMessage } from '../shared/chat';

export interface Vault { version: 1; salt: string; iv: string; ciphertext: string; publicKey: PublicKey }
const encoder = new TextEncoder();
async function passwordKey(code: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function wrapIdentity(identity: Identity, code: string): Promise<Vault> {
  if (code.length < 12 || code.length > 200) throw new Error('Use a private code of 12–200 characters. A long passphrase is best.');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('neardrop-chat-vault-v1') }, await passwordKey(code, salt), encoder.encode(JSON.stringify(identity)));
  return { version: 1, salt: toBase64(salt.buffer), iv: toBase64(iv.buffer), ciphertext: toBase64(ciphertext), publicKey: identity.publicKey };
}
export async function createVault(code: string) { return wrapIdentity(await generateIdentity(), code); }
export async function unlockVault(vault: Vault, code: string): Promise<Identity> {
  try {
    if (vault.version !== 1) throw new Error('Invalid vault');
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(vault.iv), additionalData: encoder.encode('neardrop-chat-vault-v1') }, await passwordKey(code, fromBase64(vault.salt)), fromBase64(vault.ciphertext));
    return JSON.parse(new TextDecoder().decode(raw)) as Identity;
  } catch { throw new Error('Incorrect private code, or this device’s chat key is unavailable.'); }
}
function context(id: string, senderId: string, receiverId: string) { return `neardrop-chat-v1:${id}:${senderId}:${receiverId}`; }
export async function sealMessage(identity: Identity, senderId: string, receiverId: string, receiverKey: PublicKey, text: string) {
  const bytes = encoder.encode(text); if (!bytes.length || bytes.length > 16000) throw new Error('Write a message up to 16 KB.');
  const id = crypto.randomUUID(), iv = crypto.getRandomValues(new Uint8Array(12)), aad = context(id, senderId, receiverId);
  const key = await deriveTransferKey(identity, receiverKey, aad);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, bytes);
  return { id, receiverId, receiverKey, senderKey: identity.publicKey, iv: toBase64(iv.buffer), ciphertext: toBase64(ciphertext) };
}
export async function openMessage(identity: Identity, deviceId: string, message: ChatMessage) {
  if (deviceId !== message.senderId && deviceId !== message.receiverId) throw new Error('This message belongs to another device.');
  const peer = deviceId === message.senderId ? message.receiverKey : message.senderKey;
  const aad = context(message.id, message.senderId, message.receiverId);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(message.iv), additionalData: encoder.encode(aad) }, await deriveTransferKey(identity, peer, aad), fromBase64(message.ciphertext));
  return new TextDecoder().decode(raw);
}
export function binaryPreview(ciphertext: string) { return [...fromBase64(ciphertext).slice(0, 24)].map(b => b.toString(2).padStart(8, '0')).join(' '); }
