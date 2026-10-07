import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, CHUNK_SIZE, formatBytes, joinSchema, metadataSchema, registerSchema, safeLink, sanitizeFilename, signalSchema } from '../src/shared/protocol';
import { pairingCode, RateLimiter, hash } from '../server/security';
import { Store } from '../server/store';
import { ProgressMeter } from '../src/transfer/progress';
import { generateIdentity, deriveTransferKey, encryptChunk, decryptChunk } from '../src/transfer/crypto';
import { capabilities } from '../src/transfer/capabilities';
test('pairing codes use unambiguous random symbols and normalization', () => {
  const codes = new Set(Array.from({length:1000}, pairingCode));
  assert.equal(codes.size, 1000);
  for (const code of codes) assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(joinSchema.parse({code:' n7k4-p2 '}).code, 'N7K4P2');
  assert.equal(joinSchema.safeParse({code:'111111'}).success, false);
  assert.notEqual(hash('N7K4P2'), 'N7K4P2');
});
test('rate limits cannot be bypassed inside a window and expire correctly', () => {
  const limits = new RateLimiter(); assert.equal(limits.allow('device',2,100,0),true); assert.equal(limits.allow('device',2,100,1),true); assert.equal(limits.allow('device',2,100,2),false); assert.equal(limits.allow('device',2,100,100),true);
});
test('device relationships are explicit and symmetric', () => {
  const store = new Store(); assert.equal(store.related('alice','bob'),false);
  store.relationships.set(store.relationshipKey('alice','bob'),{a:'alice',b:'bob',trustedBy:[]});
  assert.equal(store.related('bob','alice'),true); assert.equal(store.related('alice','mallory'),false);
});
test('transfer transitions reject false success and terminal mutation', () => {
  assert.equal(canTransition('waiting','completed'),false); assert.equal(canTransition('transferring','completed'),true);
  assert.equal(canTransition('failed','completed'),false); assert.equal(canTransition('completed','transferring'),false); assert.equal(canTransition('waiting','rejected'),true);
});
test('unsafe filenames and links remain inert', () => {
  assert.equal(sanitizeFilename('../../bad<script>.svg'), '_.._bad_script_.svg');
  assert.equal(sanitizeFilename(''), 'untitled'); assert.equal(safeLink('javascript:alert(1)'),null); assert.equal(safeLink('data:text/html,hi'),null); assert.equal(safeLink('https://example.com'), 'https://example.com/');
});
test('API schemas bound file sizes and reject malformed payloads', () => {
  assert.equal(metadataSchema.safeParse({name:'file',size:-1,mime:'',kind:'file'}).success,false);
  assert.equal(metadataSchema.safeParse({name:'file',size:9*1024**3,mime:'',kind:'file'}).success,false);
  assert.equal(registerSchema.safeParse({name:'',type:'phone',publicKey:{}}).success,false);
  assert.equal(signalSchema.safeParse({type:'transfer.chunk',transferId:crypto.randomUUID(),sequence:-1,data:'aGVsbG8='}).success,false);
  assert.equal(signalSchema.safeParse({type:'ping',admin:true}).success,false);
});
test('progress derives from acknowledged bytes and smooths speed', () => {
  const meter = new ProgressMeter(0); const first = meter.update(500,1000,1000); assert.equal(first.percent,50); assert.equal(first.speed,500); assert.equal(first.eta,1);
  const second = meter.update(1000,1000,2000); assert.equal(second.percent,100); assert.equal(second.eta,0);
  assert.equal(formatBytes(1024),'1 KB'); assert.equal(formatBytes(0),'0 B'); assert.equal(formatBytes(NaN),'0 B');
});
test('capability detection tolerates server and missing browser APIs', () => {
  const c = capabilities({crypto:{},navigator:{}} as typeof globalThis); assert.equal(c.camera,false); assert.equal(c.webrtc,false); assert.equal(c.crypto,false); assert.equal(c.filePicker,false);
});
test('ECDH and HKDF derive compatible AES-GCM keys; changed ordering and transfer IDs fail', async () => {
  const alice = await generateIdentity(); const bob = await generateIdentity(); const id = crypto.randomUUID();
  const a = await deriveTransferKey(alice,bob.publicKey,id); const b = await deriveTransferKey(bob,alice.publicKey,id);
  const original = crypto.getRandomValues(new Uint8Array(CHUNK_SIZE)); const encrypted = await encryptChunk(a,0,original.buffer,id);
  assert.deepEqual(new Uint8Array(await decryptChunk(b,0,encrypted,id)),original);
  await assert.rejects(decryptChunk(b,1,encrypted,id)); await assert.rejects(decryptChunk(b,0,encrypted,crypto.randomUUID()));
  const other = await deriveTransferKey(bob,alice.publicKey,crypto.randomUUID()); await assert.rejects(decryptChunk(other,0,encrypted,id));
});
