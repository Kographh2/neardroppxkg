import { z } from 'zod';
import { publicKeySchema } from '../src/shared/protocol';
import { chatEnvelopeSchema, type ChatMessage } from '../src/shared/chat';
import type { HttpStore } from './http-store';
import { assert, ApiError } from './security';

export async function chatRequest(store: HttpStore, deviceId: string, url: URL, method: string, input: unknown) {
  const path = url.pathname.replace('/api/v1', '');
  if (path === '/chat/key' && method === 'POST') {
    const { publicKey } = z.object({ publicKey: publicKeySchema }).strict().parse(input);
    await store.lockDevices([deviceId]);
    const previous = await store.sql.query<{ public_key: unknown }>('SELECT public_key FROM nd_chat_keys WHERE device_id=$1', [deviceId]);
    if (previous.rows[0]) assert(JSON.stringify(publicKeySchema.parse(previous.rows[0].public_key)) === JSON.stringify(publicKey), 409, 'This device already has a private chat key. Use its original private code.');
    else await store.sql.query('INSERT INTO nd_chat_keys(device_id,public_key) VALUES($1,$2)', [deviceId, JSON.stringify(publicKey)]);
    return { ok: true };
  }
  const peerId = z.uuid().parse(method === 'GET' ? url.searchParams.get('peer') : chatEnvelopeSchema.parse(input).receiverId);
  assert(peerId !== deviceId && await store.related(deviceId, peerId), 403, 'Pair this device before chatting.');
  if (path === '/chat/messages' && method === 'GET') {
    const keys = await store.sql.query<{ public_key: unknown }>('SELECT public_key FROM nd_chat_keys WHERE device_id=$1', [peerId]);
    const messages = await store.sql.query<{ data: ChatMessage }>(`SELECT data FROM nd_chat_messages WHERE ((sender_id=$1 AND receiver_id=$2) OR (sender_id=$2 AND receiver_id=$1)) AND expires_at>now() ORDER BY created_at DESC,id DESC LIMIT 100`, [deviceId, peerId]);
    return { peerKey: keys.rows[0]?.public_key || null, messages: messages.rows.map(r => r.data).reverse() };
  }
  if (path === '/chat/messages' && method === 'POST') {
    const envelope = chatEnvelopeSchema.parse(input);
    await store.lockDevices([deviceId, peerId]);
    assert(await store.related(deviceId, peerId), 403, 'Pair this device before chatting.');
    const keys = await store.sql.query<{ device_id: string; public_key: unknown }>('SELECT device_id,public_key FROM nd_chat_keys WHERE device_id=ANY($1::uuid[])', [[deviceId, peerId]]);
    for (const [id, key] of [[deviceId, envelope.senderKey], [peerId, envelope.receiverKey]] as const) {
      const registered = keys.rows.find(k => k.device_id === id);
      assert(registered && JSON.stringify(publicKeySchema.parse(registered.public_key)) === JSON.stringify(key), 409, 'Both devices must set up private chat before sending.');
    }
    const message: ChatMessage = { ...envelope, senderId: deviceId, createdAt: new Date().toISOString() };
    const previous = await store.sql.query<{ data: ChatMessage }>('SELECT data FROM nd_chat_messages WHERE id=$1', [envelope.id]);
    if (previous.rows[0]) {
      const existing = previous.rows[0].data;
      assert(existing.senderId === deviceId && existing.receiverId === peerId && existing.ciphertext === message.ciphertext && existing.iv === message.iv, 409, 'Message ID already used.');
      return { message: existing };
    }
    await store.sql.query('INSERT INTO nd_chat_messages(id,sender_id,receiver_id,data) VALUES($1,$2,$3,$4)', [message.id, deviceId, peerId, JSON.stringify(message)]);
    return { message };
  }
  throw new ApiError(404, 'Chat endpoint not found.');
}
