import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVault, unlockVault, wrapIdentity, sealMessage, openMessage, binaryPreview } from '../src/chat/crypto';
import { generateIdentity } from '../src/transfer/crypto';

test('private codes wrap separate chat keys; messages authenticate content and participants', async () => {
  const vault = await createVault('safe-private-code-one');
  assert.equal(JSON.stringify(vault).includes('privateKey'), false);
  await assert.rejects(unlockVault(vault, 'wrong-private-code'));
  const alice = await unlockVault(vault, 'safe-private-code-one'), bob = await generateIdentity();
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  const envelope = await sealMessage(alice, a, b, bob.publicKey, 'Secret message A = 01000001');
  const again = await sealMessage(alice, a, b, bob.publicKey, 'Secret message A = 01000001');
  assert.notEqual(envelope.ciphertext, again.ciphertext);
  const message = { ...envelope, senderId: a, createdAt: new Date().toISOString() };
  assert.match(binaryPreview(message.ciphertext), /^[01 ]+$/);
  assert.equal(await openMessage(bob, b, message), 'Secret message A = 01000001');
  assert.equal(await openMessage(alice, a, message), 'Secret message A = 01000001');
  await assert.rejects(openMessage(bob, b, { ...message, senderId: crypto.randomUUID() }));
  await assert.rejects(openMessage(bob, b, { ...message, ciphertext: (message.ciphertext[0] === 'A' ? 'B' : 'A') + message.ciphertext.slice(1) }));
  await assert.rejects(openMessage(await generateIdentity(), b, message));
  const changed = await wrapIdentity(alice, 'new-private-code-two');
  await assert.rejects(unlockVault(changed, 'safe-private-code-one'));
  assert.equal(await openMessage(await unlockVault(changed, 'new-private-code-two'), a, message), 'Secret message A = 01000001');
});
