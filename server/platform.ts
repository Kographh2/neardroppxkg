import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WebSocket } from 'ws';
import { CHUNK_SIZE, PAIRING_TTL, createTransferSchema, joinSchema, registerSchema, signalSchema, terminalStates, type ServerEvent, type Transfer } from '../src/shared/protocol';
import { ApiError, assert, hash, pairingCode, RateLimiter, secret } from './security';
import { Store, type StoredDevice } from './store';

export class Platform {
  sockets = new Map<string, WebSocket>();
  limits = new RateLimiter();
  tickets = new Map<string, { deviceId: string; expiresAt: number }>();
  relaySequence = new Map<string, { sent: number; acked: number }>();
  private transferLocks = new Set<string>();
  constructor(public store: Store, public origin: string) {}
  emit(id: string, event: ServerEvent) {
    const socket = this.sockets.get(id);
    if (socket?.readyState === WebSocket.OPEN) {
      if (socket.bufferedAmount > 1024 * 1024) { socket.close(1013, 'Receiver is too slow'); return; }
      socket.send(JSON.stringify(event));
    }
  }
  presence() { for (const id of this.sockets.keys()) this.emit(id, { type: 'devices', devices: this.store.listDevices(id) }); }
  transferUpdate(t: Transfer) { const event = { type: 'transfer.updated' as const, transfer: t }; this.emit(t.senderId, event); this.emit(t.receiverId, event); }
  authenticate(req: IncomingMessage) {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    const cookie = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('nd_session='))?.slice(11);
    const token = bearer || cookie;
    const tokenHash = token ? hash(token) : null;
    const device = tokenHash && [...this.store.devices.values()].find(d => d.tokenHash === tokenHash && d.expiresAt > Date.now());
    assert(device, 401, 'Your device session expired. Reload NearDrop to reconnect.');
    return device;
  }
  private async body(req: IncomingMessage): Promise<unknown> {
    const parts: Buffer[] = []; let size = 0;
    for await (const chunk of req) { const data = Buffer.from(chunk); size += data.length; assert(size <= 65536, 413, 'Request is too large.'); parts.push(data); }
    try { return JSON.parse(Buffer.concat(parts).toString() || '{}'); } catch { throw new ApiError(400, 'Invalid request.'); }
  }
  async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const path = new URL(req.url!, this.origin).pathname.replace('/api/v1', '');
      const method = req.method;
      const ip = process.env.TRUST_PROXY === 'true' ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress || 'unknown';
      assert(this.limits.allow(`http:${ip}`, 240), 429, 'Too many requests. Try again in a minute.');
      if (method !== 'GET') {
        const native = !req.headers.origin && req.headers['x-neardrop-client'] === 'native';
        assert(req.headers.origin === this.origin || native, 403, 'Request origin is not allowed.');
        assert(req.headers['content-type']?.startsWith('application/json'), 415, 'Use application/json.');
      }
      const respond = (data: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(data)); };
      if (method === 'GET' && path === '/health') return respond({ status: 'ok', version: 1, persistent: !!this.store.pool });
      if (method === 'POST' && path === '/devices/register') {
        const input = registerSchema.parse(await this.body(req));
        try { const existing = this.authenticate(req); if (JSON.stringify(existing.publicKey) === JSON.stringify(input.publicKey)) return respond({ device: this.store.publicDevice(existing) }); } catch { /* A missing session creates a new guest identity. */ }
        assert(this.limits.allow(`register:${ip}`, 12), 429, 'Please wait before registering another device.');
        assert(this.store.devices.size < 10000, 503, 'NearDrop is at capacity. Try again later.');
        const token = secret();
        const device: StoredDevice = { id: randomUUID(), ...input, userId: null, online: false, lastSeen: new Date().toISOString(), tokenHash: hash(token), expiresAt: Date.now() + 30 * 86400000 };
        await this.store.saveDevice(device);
        res.setHeader('Set-Cookie', `nd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${this.origin.startsWith('https:') ? '; Secure' : ''}`);
        return respond({ device: this.store.publicDevice(device), ...(req.headers['x-neardrop-client'] === 'native' ? { token } : {}) }, 201);
      }
      const device = this.authenticate(req);
      if (method === 'GET' && path === '/devices') return respond({ device: this.store.publicDevice(device), devices: this.store.listDevices(device.id) });
      if (method === 'POST' && path === '/ws-ticket') {
        const ticket = secret(); this.tickets.set(hash(ticket), { deviceId: device.id, expiresAt: Date.now() + 30000 }); return respond({ ticket });
      }
      if (method === 'GET' && path === '/ice') {
        const iceServers: { urls: string[]; username?: string; credential?: string }[] = [];
        const stun = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').filter(Boolean);
        if (stun.length) iceServers.push({ urls: stun });
        if (process.env.TURN_URLS && process.env.TURN_SECRET) {
          const username = `${Math.floor(Date.now() / 1000) + 3600}:${device.id}`;
          iceServers.push({ urls: process.env.TURN_URLS.split(','), username, credential: createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64') });
        }
        return respond({ iceServers });
      }
      if (method === 'PATCH' && path === `/devices/${device.id}`) {
        const { name } = z.object({ name: z.string().trim().min(1).max(48) }).strict().parse(await this.body(req));
        await this.store.saveDevice({ ...device, name }); this.presence(); return respond({ device: this.store.publicDevice(this.store.devices.get(device.id)!) });
      }
      const relationMatch = path.match(/^\/devices\/([a-f0-9-]{36})(\/trust)?$/);
      if (relationMatch && method === 'DELETE') {
        await this.store.deleteRelationship(device.id, relationMatch[1]);
        for (const t of this.store.transfers.values()) if (!terminalStates.includes(t.status) && [t.senderId, t.receiverId].includes(device.id) && [t.senderId, t.receiverId].includes(relationMatch[1])) {
          const cancelled: Transfer = { ...t, status: 'cancelled', updatedAt: new Date().toISOString() }; await this.store.saveTransfer(cancelled); this.transferUpdate(cancelled);
        }
        this.presence(); return respond({ ok: true });
      }
      if (relationMatch?.[2] && method === 'POST') {
        const peer = this.store.devices.get(relationMatch[1]);
        assert(device.userId && peer?.userId === device.userId, 403, 'Sign in to the same account on both devices to enable trust.');
        const relation = this.store.relationships.get(this.store.relationshipKey(device.id, peer.id)); assert(relation, 403, 'Pair this device first.');
        const { trusted } = z.object({ trusted: z.boolean() }).strict().parse(await this.body(req));
        await this.store.saveRelationship({ ...relation, trustedBy: trusted ? [...new Set([...relation.trustedBy, device.id])] : relation.trustedBy.filter(d => d !== device.id) });
        this.presence(); return respond({ ok: true });
      }
      if (method === 'POST' && path === '/auth/associate') {
        assert(this.limits.allow(`auth:${device.id}`, 10), 429, 'Please wait before trying again.');
        const { accessToken } = z.object({ accessToken: z.string().min(20).max(8192) }).parse(await this.body(req));
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        assert(supabaseUrl && apiKey, 503, 'Accounts are not configured on this server.');
        const result = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000) });
        assert(result.ok, 401, 'Please sign in again.');
        const user = z.object({ id: z.uuid(), email_confirmed_at: z.string().nullable().optional() }).parse(await result.json());
        assert(user.email_confirmed_at, 403, 'Verify your email before linking this device.');
        assert(!device.userId || device.userId === user.id, 409, 'Sign out of this device before switching accounts.');
        await this.store.saveDevice({ ...device, userId: user.id });
        this.presence(); return respond({ device: this.store.publicDevice(this.store.devices.get(device.id)!) });
      }
      if (method === 'POST' && path === '/auth/sign-out') {
        for (const relationship of [...this.store.relationships.values()]) if ([relationship.a, relationship.b].includes(device.id)) await this.store.deleteRelationship(relationship.a, relationship.b);
        await this.store.saveDevice({ ...device, userId: null, expiresAt: Date.now(), online: false });
        this.sockets.get(device.id)?.close(4001, 'Signed out');
        res.setHeader('Set-Cookie', 'nd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); this.presence(); return respond({ ok: true });
      }
      if (method === 'POST' && path === '/pairing/create') {
        assert(this.limits.allow(`create:${device.id}`, 12), 429, 'Please wait before refreshing again.');
        for (const [id, p] of this.store.pairings) if (p.initiatorId === device.id && p.status === 'open') this.store.pairings.delete(id);
        let code = pairingCode(); while ([...this.store.pairings.values()].some(p => p.codeHash === hash(code))) code = pairingCode();
        const pairing = { id: randomUUID(), initiatorId: device.id, joinerId: null, codeHash: hash(code), status: 'open' as const, expiresAt: Date.now() + PAIRING_TTL };
        this.store.pairings.set(pairing.id, pairing); return respond({ id: pairing.id, code, expiresAt: pairing.expiresAt });
      }
      if (method === 'POST' && path === '/pairing/join') {
        assert(this.limits.allow(`join:${ip}`, 10, 5 * 60000) && this.limits.allow(`join-device:${device.id}`, 10, 5 * 60000), 429, 'Too many pairing attempts. Wait five minutes.');
        const { code } = joinSchema.parse(await this.body(req));
        const pairing = [...this.store.pairings.values()].find(p => p.codeHash === hash(code));
        assert(pairing && pairing.expiresAt > Date.now() && pairing.status === 'open', 400, 'This pairing code is invalid or expired. Ask for a new code.');
        assert(pairing.initiatorId !== device.id, 400, 'Enter the code shown on your other device.');
        const initiator = this.store.devices.get(pairing.initiatorId)!;
        assert(initiator?.online, 409, 'The other device is offline. Open NearDrop there and try again.');
        pairing.joinerId = device.id; pairing.status = 'pending';
        this.emit(initiator.id, { type: 'pairing.request', id: pairing.id, device: this.store.publicDevice(device), expiresAt: pairing.expiresAt });
        return respond({ id: pairing.id, device: this.store.publicDevice(initiator) });
      }
      if (method === 'POST' && ['/pairing/confirm', '/pairing/reject'].includes(path)) {
        const { id } = z.object({ id: z.uuid() }).strict().parse(await this.body(req));
        const pairing = this.store.pairings.get(id);
        assert(pairing && pairing.initiatorId === device.id && pairing.joinerId && pairing.status === 'pending' && pairing.expiresAt > Date.now(), 400, 'This connection request has expired.');
        const peer = this.store.devices.get(pairing.joinerId); assert(peer, 404, 'Device no longer available.');
        if (path.endsWith('/confirm')) {
          pairing.status = 'accepted';
          await this.store.saveRelationship({ a: device.id, b: peer.id, trustedBy: [] });
          this.emit(device.id, { type: 'pairing.accepted', device: this.store.publicDevice(peer) }); this.emit(peer.id, { type: 'pairing.accepted', device: this.store.publicDevice(device) }); this.presence();
        } else { pairing.status = 'rejected'; this.emit(peer.id, { type: 'pairing.rejected', id }); }
        return respond({ ok: true });
      }
      if (method === 'GET' && path === '/transfer-history') return respond({ transfers: this.store.history(device) });
      if (method === 'POST' && path === '/transfers') {
        assert(this.limits.allow(`transfer:${device.id}`, 60), 429, 'Please wait before sending more items.');
        const input = createTransferSchema.parse(await this.body(req));
        const receiver = this.store.devices.get(input.receiverId);
        assert(receiver && this.store.related(device.id, receiver.id), 403, 'Pair this device before sending.');
        assert(receiver.online, 409, 'The receiving device is offline.');
        assert(![...this.store.transfers.values()].some(t => !terminalStates.includes(t.status) && [t.senderId, t.receiverId].some(d => d === device.id || d === receiver.id)), 409, 'Finish the current transfer before sending another.');
        if (input.item.kind !== 'file') assert(input.item.size <= 65536, 400, 'Text must be smaller than 64 KB.');
        const transfer: Transfer = { id: randomUUID(), senderId: device.id, receiverId: receiver.id, senderName: device.name, receiverName: receiver.name, item: input.item, status: 'waiting', transport: null, bytes: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await this.store.saveTransfer(transfer); this.transferUpdate(transfer); return respond({ transfer }, 201);
      }
      const match = path.match(/^\/transfers\/([a-f0-9-]{36})(?:\/(accept|reject|cancel))?$/);
      if (match) {
        const transfer = this.store.transfers.get(match[1]);
        assert(transfer && [transfer.senderId, transfer.receiverId].includes(device.id), 404, 'Transfer not found.');
        if (method === 'GET' && !match[2]) return respond({ transfer });
        if (method === 'POST' && match[2]) {
          assert(!this.transferLocks.has(transfer.id), 409, 'Transfer is being updated.');
          this.transferLocks.add(transfer.id);
          try {
            assert(!terminalStates.includes(transfer.status), 409, 'This transfer has already ended.');
            if (match[2] !== 'cancel') assert(transfer.receiverId === device.id && transfer.status === 'waiting', 403, 'Only the receiver can respond to this request.');
            const status = match[2] === 'accept' ? 'preparing' : match[2] === 'reject' ? 'rejected' : 'cancelled';
            const updated: Transfer = { ...transfer, status, updatedAt: new Date().toISOString() };
            await this.store.saveTransfer(updated); this.transferUpdate(updated); return respond({ transfer: updated });
          } finally { this.transferLocks.delete(transfer.id); }
        }
      }
      throw new ApiError(404, 'This endpoint does not exist.');
    } catch (error) {
      const status = error instanceof ApiError ? error.status : error instanceof z.ZodError ? 400 : 500;
      if (status === 500) console.error('API request failed', error instanceof Error ? error.message : 'Unknown error');
      res.statusCode = status; res.end(JSON.stringify({ error: error instanceof ApiError ? error.message : status === 400 ? 'Check the information and try again.' : 'Something went wrong. Please try again.' }));
    }
  }
  connect(device: StoredDevice, socket: WebSocket) {
    this.sockets.get(device.id)?.close(4001, 'NearDrop opened in another tab');
    this.sockets.set(device.id, socket); device.online = true; device.lastSeen = new Date().toISOString();
    this.emit(device.id, { type: 'ready', device: this.store.publicDevice(device), devices: this.store.listDevices(device.id), transfers: this.store.history(device), requests: [...this.store.pairings.values()].filter(p => p.initiatorId === device.id && p.status === 'pending' && p.expiresAt > Date.now() && p.joinerId).map(p => ({ id: p.id, device: this.store.publicDevice(this.store.devices.get(p.joinerId!)!), expiresAt: p.expiresAt })) });
    this.presence();
    let chain = Promise.resolve(); let pending = 0;
    socket.on('message', data => {
      if (++pending > 32) { socket.close(1008, 'Too many pending messages'); return; }
      chain = chain.then(async () => { const current = this.store.devices.get(device.id); if (!current || current.expiresAt <= Date.now()) { socket.close(4001, 'Session expired'); return; } await this.message(current, data.toString()); }).catch(() => this.emit(device.id, { type: 'error', message: 'Could not process the transfer. Please try again.' })).finally(() => { pending--; });
    });
    socket.on('error', () => socket.close());
    socket.on('close', () => {
      if (this.sockets.get(device.id) !== socket) return;
      this.sockets.delete(device.id); const current = this.store.devices.get(device.id); if (current) { current.online = false; current.lastSeen = new Date().toISOString(); void this.store.saveDevice(current).catch(() => console.error('Could not persist device presence')); } this.presence();
      for (const t of this.store.transfers.values()) if ([t.senderId, t.receiverId].includes(device.id) && !terminalStates.includes(t.status)) {
        const failed = { ...t, status: 'failed' as const, updatedAt: new Date().toISOString() };
        this.store.saveTransfer(failed).then(() => this.transferUpdate(failed)).catch(() => console.error('Could not persist disconnected transfer'));
      }
    });
  }
  async message(device: StoredDevice, raw: string) {
    if (!this.limits.allow(`ws:${device.id}`, 10000)) { this.sockets.get(device.id)?.close(1008, 'Rate limit exceeded'); return; }
    let input: unknown; try { input = JSON.parse(raw); } catch { return; }
    const parsed = signalSchema.safeParse(input); if (!parsed.success) { this.emit(device.id, { type: 'error', message: 'Unsupported transfer message.' }); return; }
    const event = parsed.data;
    if (event.type === 'ping') { this.emit(device.id, { type: 'pong' }); return; }
    const t = this.store.transfers.get(event.transferId);
    if (!t || ![t.senderId, t.receiverId].includes(device.id) || !this.store.related(t.senderId, t.receiverId) || terminalStates.includes(t.status) || t.status === 'waiting') return;
    const sender = device.id === t.senderId; const peer = sender ? t.receiverId : t.senderId;
    if (event.type === 'transfer.transport') {
      if (!sender || !['preparing', 'connecting'].includes(t.status)) return;
      t.transport = event.transport; t.status = 'transferring'; this.relaySequence.set(t.id, { sent: -1, acked: -1 }); await this.store.saveTransfer(t); this.transferUpdate(t);
    } else if (event.type === 'transfer.chunk') {
      if (!sender || t.transport !== 'relay' || t.status !== 'transferring') return;
      const sequence = this.relaySequence.get(t.id)!;
      if (event.sequence !== sequence.sent + 1 || sequence.sent > sequence.acked || event.sequence >= Math.ceil(t.item.size / CHUNK_SIZE)) return;
      const expected = Math.min(CHUNK_SIZE, t.item.size - event.sequence * CHUNK_SIZE) + 16;
      if (Buffer.from(event.data, 'base64').length !== expected) return;
      sequence.sent = event.sequence; this.emit(peer, event);
    } else if (event.type === 'transfer.ack') {
      if (sender || t.status !== 'transferring' || event.bytes > t.item.size || event.bytes < t.bytes) return;
      if (t.transport === 'relay') { const sequence = this.relaySequence.get(t.id)!; if (event.sequence !== sequence.sent || event.sequence !== sequence.acked + 1 || event.bytes !== Math.min((event.sequence + 1) * CHUNK_SIZE, t.item.size)) return; sequence.acked = event.sequence; }
      t.bytes = event.bytes; t.updatedAt = new Date().toISOString(); this.emit(peer, event);
    } else if (event.type === 'transfer.complete') {
      if (sender || t.status !== 'transferring' || t.bytes !== t.item.size) return;
      t.status = 'completed'; t.updatedAt = new Date().toISOString(); await this.store.saveTransfer(t); this.relaySequence.delete(t.id); this.transferUpdate(t);
    } else if (event.type === 'transfer.fail') {
      t.status = 'failed'; t.updatedAt = new Date().toISOString(); await this.store.saveTransfer(t); this.relaySequence.delete(t.id); this.transferUpdate(t);
    } else if (event.type === 'transfer.end') { if (sender && t.status === 'transferring') this.emit(peer, event); }
    else if (event.type === 'signal') this.emit(peer, event);
  }
  async sweep() {
    this.limits.sweep();
    for (const [key, ticket] of this.tickets) if (ticket.expiresAt < Date.now()) this.tickets.delete(key);
    for (const t of this.store.transfers.values()) if (!terminalStates.includes(t.status) && Date.parse(t.updatedAt) < Date.now() - 120000) { t.status = 'failed'; await this.store.saveTransfer(t); this.transferUpdate(t); }
    for (const id of this.relaySequence.keys()) if (!this.store.transfers.has(id) || terminalStates.includes(this.store.transfers.get(id)!.status)) this.relaySequence.delete(id);
    await this.store.cleanup();
  }
}
