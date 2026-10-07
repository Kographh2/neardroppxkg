import { CHUNK_SIZE, signalSchema, terminalStates, type ClientEvent, type Device, type Transfer } from '../shared/protocol';
import { deriveTransferKey, decryptChunk, encryptChunk, type Identity } from './crypto';
import { createSink, type ReceiveSink, type ReceivedContent } from './receive-sink';
import { ProgressMeter } from './progress';
import { api } from '../lib/api';

interface Session {
  transfer: Transfer; key: Promise<CryptoKey>; pc?: RTCPeerConnection; channel?: RTCDataChannel;
  sink?: ReceiveSink; sequence: number; bytes: number; meter: ProgressMeter;
  candidates: RTCIceCandidateInit[]; aborted: boolean; started: boolean;
  ack?: { sequence: number; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
  chain: Promise<void>;
}
interface EngineCallbacks {
  send(event: ClientEvent): void;
  progress(id: string, value: ReturnType<ProgressMeter['update']>): void;
  received(id: string, content: ReceivedContent): void;
  error(message: string): void;
}
export class TransferEngine {
  private sessions = new Map<string, Session>();
  private files = new Map<string, Blob>();
  private disposers = new Map<string, () => Promise<void>>();
  constructor(private identity: Identity, private deviceId: string, private peers: () => Device[], private callbacks: EngineCallbacks) {}
  private session(t: Transfer) {
    let session = this.sessions.get(t.id);
    if (!session) {
      const peer = this.peers().find(d => d.id === (t.senderId === this.deviceId ? t.receiverId : t.senderId));
      if (!peer) throw new Error('The other device is no longer paired.');
      session = { transfer: t, key: deriveTransferKey(this.identity, peer.publicKey, t.id), sequence: 0, bytes: 0, meter: new ProgressMeter(), candidates: [], aborted: false, started: false, chain: Promise.resolve() };
      this.sessions.set(t.id, session);
    }
    session.transfer = t; return session;
  }
  attachFile(id: string, file: Blob) { this.files.set(id, file); }
  async accept(t: Transfer) {
    const session = this.session(t);
    try {
      session.sink = await createSink(t.item, t.id); await session.key;
      await api(`/transfers/${t.id}/accept`, {});
    } catch (error) { await session.sink?.abort(); this.sessions.delete(t.id); throw error; }
  }
  update(t: Transfer) {
    if (terminalStates.includes(t.status)) { this.stop(t.id, t.status !== 'completed'); return; }
    if (t.status === 'waiting') return;
    const session = this.session(t);
    if (t.transport === 'relay' && t.receiverId === this.deviceId) { session.pc?.close(); session.pc = undefined; session.channel = undefined; }
    if (t.senderId === this.deviceId && t.status === 'preparing' && !session.started) {
      session.started = true; void this.start(session).catch(error => this.fail(session, error));
    }
  }
  private async peerConnection(session: Session) {
    if (session.pc) return session.pc;
    const { iceServers } = await api<{ iceServers: RTCIceServer[] }>('/ice');
    if (session.aborted) throw new Error('Transfer cancelled.');
    const pc = new RTCPeerConnection({ iceServers }); session.pc = pc;
    pc.onicecandidate = event => { if (event.candidate && !session.aborted) this.callbacks.send({ type: 'signal', transferId: session.transfer.id, candidate: { ...event.candidate.toJSON(), candidate: event.candidate.candidate } }); };
    pc.ondatachannel = event => this.bindChannel(session, event.channel);
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState) && ['direct', 'turn'].includes(session.transfer.transport || '') && !session.aborted) this.fail(session, new Error('Connection lost. Retry this transfer.')); };
    return pc;
  }
  private bindChannel(session: Session, channel: RTCDataChannel) {
    session.channel = channel; channel.bufferedAmountLowThreshold = CHUNK_SIZE * 2;
    channel.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 65536) { this.fail(session, new Error('Invalid transfer data.')); return; }
      try {
        const parsed = signalSchema.parse(JSON.parse(event.data));
        if (!('transferId' in parsed) || parsed.transferId !== session.transfer.id || !['transfer.chunk', 'transfer.ack'].includes(parsed.type)) throw new Error('Unexpected data message.');
        this.handle(parsed);
      } catch { this.fail(session, new Error('Invalid transfer data.')); }
    };
    channel.onerror = () => { if (session.transfer.transport && session.transfer.transport !== 'relay') this.fail(session, new Error('Connection interrupted. Retry this transfer.')); };
  }
  private async start(session: Session) {
    await session.key; const file = this.files.get(session.transfer.id); if (!file) throw new Error('Select the file again to retry.');
    let transport: 'direct' | 'turn' | 'relay' = 'relay';
    if ('RTCPeerConnection' in globalThis) {
      try {
        const pc = await this.peerConnection(session);
        const channel = pc.createDataChannel('neardrop-v1', { ordered: true }); this.bindChannel(session, channel);
        const opened = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { cleanup(); reject(new Error('Connection timeout')); }, 8000);
          const onOpen = () => { cleanup(); resolve(); }; const onError = () => { cleanup(); reject(new Error('Connection failed')); };
          const cleanup = () => { clearTimeout(timeout); channel.removeEventListener('open', onOpen); channel.removeEventListener('error', onError); };
          channel.addEventListener('open', onOpen); channel.addEventListener('error', onError);
        });
        // Attach rejection immediately while SDP is being prepared.
        void opened.catch(() => undefined);
        await pc.setLocalDescription(await pc.createOffer());
        this.callbacks.send({ type: 'signal', transferId: session.transfer.id, description: { type: 'offer', sdp: pc.localDescription!.sdp } });
        await opened;
        transport = 'direct';
        const stats = await pc.getStats();
        stats.forEach(report => { if (report.type === 'transport' && report.selectedCandidatePairId) { const pair = stats.get(report.selectedCandidatePairId); const candidate = pair && stats.get(pair.localCandidateId); const remote = pair && stats.get(pair.remoteCandidateId); if (candidate?.candidateType === 'relay' || remote?.candidateType === 'relay') transport = 'turn'; } });
      } catch { session.pc?.close(); session.pc = undefined; session.channel = undefined; }
    }
    if (session.aborted) return;
    session.transfer = { ...session.transfer, transport, status: 'transferring' };
    this.callbacks.send({ type: 'transfer.transport', transferId: session.transfer.id, transport });
    for (let offset = 0, sequence = 0; offset < file.size; offset += CHUNK_SIZE, sequence++) {
      if (session.aborted) return;
      const data = await encryptChunk(await session.key, sequence, await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer(), session.transfer.id);
      if (session.aborted) return;
      const acknowledged = new Promise<void>((resolve, reject) => { session.ack = { sequence, resolve, reject, timer: setTimeout(() => reject(new Error('The other device stopped responding. Retry this transfer.')), 20000) }; });
      const event: ClientEvent = { type: 'transfer.chunk', transferId: session.transfer.id, sequence, data };
      if (transport !== 'relay' && session.channel?.readyState === 'open') session.channel.send(JSON.stringify(event)); else if (transport === 'relay') this.callbacks.send(event); else throw new Error('Connection lost. Retry this transfer.');
      await acknowledged;
      session.bytes = Math.min(offset + CHUNK_SIZE, file.size);
      this.callbacks.progress(session.transfer.id, session.meter.update(session.bytes, file.size));
    }
    // End travels over the ordered signaling stream after the final acknowledgement.
    this.callbacks.send({ type: 'transfer.end', transferId: session.transfer.id });
  }
  handle(event: ClientEvent) {
    if (!('transferId' in event)) return;
    const session = this.sessions.get(event.transferId); if (!session || session.aborted) return;
    if (event.type === 'transfer.ack' && session.transfer.senderId === this.deviceId) {
      if (session.ack?.sequence === event.sequence && event.bytes === Math.min((event.sequence + 1) * CHUNK_SIZE, session.transfer.item.size)) { clearTimeout(session.ack.timer); session.ack.resolve(); session.ack = undefined; }
      return;
    }
    session.chain = session.chain.then(async () => {
      if (session.aborted) return;
      if (event.type === 'signal') {
        if (!('RTCPeerConnection' in globalThis) || session.transfer.transport === 'relay') return;
        const pc = await this.peerConnection(session);
        if (event.description) {
          if ((session.transfer.senderId === this.deviceId && event.description.type !== 'answer') || (session.transfer.receiverId === this.deviceId && event.description.type !== 'offer')) throw new Error('Invalid connection negotiation.');
          await pc.setRemoteDescription(event.description);
          for (const candidate of session.candidates) await pc.addIceCandidate(candidate); session.candidates = [];
          if (event.description.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); this.callbacks.send({ type: 'signal', transferId: session.transfer.id, description: { type: 'answer', sdp: pc.localDescription!.sdp } }); }
        }
        if (event.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(event.candidate); else session.candidates.push(event.candidate); }
      }
      if (event.type === 'transfer.chunk' && session.transfer.receiverId === this.deviceId) {
        if (!session.sink || event.sequence !== session.sequence) throw new Error('File chunks arrived out of order. Retry this transfer.');
        const bytes = await decryptChunk(await session.key, event.sequence, event.data, session.transfer.id);
        if (bytes.byteLength !== Math.min(CHUNK_SIZE, session.transfer.item.size - session.bytes)) throw new Error('File size verification failed.');
        await session.sink.write(bytes); session.bytes += bytes.byteLength; session.sequence++;
        // Acknowledgements mean bytes have been written, not merely put in a send buffer.
        this.callbacks.send({ type: 'transfer.ack', transferId: session.transfer.id, sequence: event.sequence, bytes: session.bytes });
        this.callbacks.progress(session.transfer.id, session.meter.update(session.bytes, session.transfer.item.size));
      }
      if (event.type === 'transfer.end' && session.transfer.receiverId === this.deviceId) {
        if (!session.sink || session.bytes !== session.transfer.item.size) throw new Error('The file was incomplete. Retry this transfer.');
        const content = await session.sink.finish();
        if (session.sink.dispose) this.disposers.set(session.transfer.id, session.sink.dispose);
        this.callbacks.received(session.transfer.id, content);
        this.callbacks.send({ type: 'transfer.complete', transferId: session.transfer.id });
      }
    }).catch(error => this.fail(session, error));
  }
  private fail(session: Session, error: unknown) {
    if (session.aborted) return;
    const message = error instanceof Error ? error.message : 'Transfer interrupted. Please retry.';
    this.callbacks.send({ type: 'transfer.fail', transferId: session.transfer.id, reason: 'Transfer interrupted' });
    this.callbacks.error(message); this.stop(session.transfer.id, true);
  }
  stop(id: string, abort: boolean) {
    const session = this.sessions.get(id); if (!session) return;
    session.aborted = true;
    if (session.ack) { clearTimeout(session.ack.timer); session.ack.reject(new Error('Transfer stopped.')); }
    session.channel?.close(); session.pc?.close();
    if (abort) void session.sink?.abort().catch(() => undefined);
    this.sessions.delete(id); this.files.delete(id);
  }
  stopAll() { for (const id of this.sessions.keys()) this.stop(id, true); }
  async dispose(id: string) { await this.disposers.get(id)?.(); this.disposers.delete(id); }
}
