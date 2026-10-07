import { api, HttpError } from './api';
import { disconnectedStatus, type ConnectionStatus } from './connection-status';
import { HttpSignaling } from './http-signaling';
import { preferences } from './local-preferences';
import { generateIdentity, type Identity } from '../transfer/crypto';
import { TransferEngine } from '../transfer/engine';
import { cleanOldIncoming, type ReceivedContent } from '../transfer/receive-sink';
import { capabilities } from '../transfer/capabilities';
import { terminalStates, type ClientEvent, type Device, type DeviceType, type ItemMetadata, type ServerEvent, type Transfer } from '../shared/protocol';
import type { ProgressMeter } from '../transfer/progress';
export interface QueueItem { id: string; file: Blob; item: ItemMetadata; receiverId: string }
export interface Snapshot {
  status: ConnectionStatus;
  device: Device | null; devices: Device[]; transfers: Transfer[]; queue: QueueItem[];
  requests: { id: string; device: Device; expiresAt: number }[]; received: Record<string, ReceivedContent>;
  error: string | null; notice: string | null;
  pairing: { code: string; expiresAt: number } | null;
  pairingRevision: number;
}
const initial: Snapshot = { status: 'starting', device: null, devices: [], transfers: [], queue: [], requests: [], received: {}, error: null, notice: null, pairing: null, pairingRevision: 0 };
export class PlatformClient {
  snapshot: Snapshot = initial;
  private listeners = new Set<() => void>();
  private progressListeners = new Map<string, Set<() => void>>();
  private progress = new Map<string, ReturnType<ProgressMeter['update']>>();
  private progressTime = new Map<string, number>();
  private boot?: Promise<void>;
  private socket?: WebSocket;
  private http?: HttpSignaling;
  private signaling: 'http' | 'websocket' = 'websocket';
  private connecting = false;
  private identity?: Identity;
  private engine?: TransferEngine;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private backoff = 1000;
  private pumping = false;
  private retained = new Map<string, QueueItem>();
  private historyAfter = 0;
  private pairingPromise?: Promise<void>;
  private lifecycleBound = false;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => initial;
  set(patch: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const l of this.listeners) l(); }
  error(error: unknown) { this.set({ error: error instanceof Error ? error.message : String(error) }); }
  notify(message: string) { this.set({ notice: message }); }
  clearMessages() { this.set({ error: null, notice: null }); }
  start() {
    if (!this.lifecycleBound) {
      this.lifecycleBound = true;
      window.addEventListener('online', () => { if (this.snapshot.status !== 'another-tab') this.reconnect(); });
      window.addEventListener('offline', () => {
        clearTimeout(this.retryTimer); this.http?.close(); this.http=undefined; this.socket?.close();
        this.engine?.stopAll(); this.set({status:'offline'});
      });
      window.addEventListener('beforeunload', event => { if (this.snapshot.transfers.some(t => !terminalStates.includes(t.status))) event.preventDefault(); });
    }
    if (!navigator.onLine) { this.set({status:'offline'}); return Promise.resolve(); }
    this.boot ??= this.initialize().catch(error => {
      this.error(error); this.set({ status: disconnectedStatus(navigator.onLine) }); this.boot = undefined;
      clearTimeout(this.retryTimer);
      // A missing deployment route will not recover by flooding it with requests.
      if (!(error instanceof HttpError && error.status === 404)) this.retryTimer = setTimeout(() => { void this.start(); }, 15000);
    }); return this.boot;
  }
  reconnect() {
    clearTimeout(this.retryTimer);
    if (!navigator.onLine) {this.set({status:'offline'});return;}
    this.set({status:'starting',error:null});
    if (!this.boot || !this.engine) {void this.start();return;}
    this.http?.close();this.http=undefined;
    void this.connect();
  }
  private async initialize() {
    if (!capabilities().crypto) { this.set({ status: 'unsupported', error: 'Open NearDrop over HTTPS in a modern browser to connect securely.' }); return; }
    this.historyAfter = Number(preferences.getItem('nd-history-after') || '0');
    const stored = preferences.getItem('nd-identity');
    try { this.identity = stored ? JSON.parse(stored) as Identity : await generateIdentity(); } catch { this.identity = await generateIdentity(); }
    preferences.setItem('nd-identity', JSON.stringify(this.identity));
    const small = matchMedia('(max-width: 700px)').matches;
    const type: DeviceType = small ? 'phone' : 'laptop';
    const name = preferences.getItem('nd-device-name') || (small ? 'My phone' : 'My computer');
    const { device, signaling } = await api<{ device: Device; signaling?: 'http' | 'websocket' }>('/devices/register', { name, type, publicKey: this.identity.publicKey });
    this.signaling = signaling || 'websocket';
    this.set({ device });
    this.engine = new TransferEngine(this.identity, device.id, () => this.snapshot.devices, {
      dataChannelAcks: this.signaling === 'http', relayAvailable: this.signaling !== 'http',
      send: event => this.send(event), error: message => this.error(message),
      received: (id, content) => { this.set({ received: { ...this.snapshot.received, [id]: content } }); this.notification('Transfer complete', 'Your item is ready. Open NearDrop to save it.'); },
      progress: (id, progress) => {
        const now = performance.now(); if (now - (this.progressTime.get(id) || 0) < 150 && progress.percent < 100) return;
        this.progressTime.set(id, now); this.progress.set(id, progress); this.progressListeners.get(id)?.forEach(l => l());
      }
    });
    void cleanOldIncoming();
    await this.connect();
  }
  private async connect() {
    if (!navigator.onLine) {this.set({status:'offline'});return;}
    if (this.connecting || this.http) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(this.retryTimer);
    this.connecting = true;
    try {
      if (this.signaling === 'http') {
        const http = new HttpSignaling(event=>this.onEvent(event),error=>{
          if(this.http!==http)return;
          this.http=undefined;this.engine?.stopAll();this.error(error);
          this.set({status:error instanceof HttpError && error.code==='CONNECTION_REPLACED'?'another-tab':disconnectedStatus(navigator.onLine),transfers:this.snapshot.transfers.map(t=>terminalStates.includes(t.status)?t:{...t,status:'failed'})});
          if(error instanceof HttpError && error.status===401){this.boot=undefined;this.retryTimer=setTimeout(()=>void this.start(),15000);}
          else if(this.snapshot.status!=='another-tab')this.scheduleReconnect();
        });
        this.http=http;
        try {await http.connect();} catch(error){http.close();this.http=undefined;throw error;}
        return;
      }
      const { ticket } = await api<{ ticket: string }>('/ws-ticket', {});
      const url = new URL('/realtime', location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('ticket', ticket);
      const socket = new WebSocket(url); this.socket = socket;
      socket.onopen = () => { clearInterval(this.pingTimer); this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 20000); };
      socket.onmessage = event => { try { this.onEvent(JSON.parse(event.data) as ServerEvent); } catch (error) { this.error(error); } };
      socket.onclose = event => {
        clearInterval(this.pingTimer); this.engine?.stopAll(); this.socket = undefined;
        this.set({ status: event.code === 4001 ? 'another-tab' : disconnectedStatus(navigator.onLine), transfers: this.snapshot.transfers.map(t => terminalStates.includes(t.status) ? t : { ...t, status: 'failed' }), error: event.code === 4001 ? 'NearDrop is active in another tab, or you signed out. Reload here to reconnect.' : null });
        if (event.code !== 4001) this.scheduleReconnect();
      };
      socket.onerror = () => socket.close();
    } catch (error) {
      this.error(error); this.set({ status: disconnectedStatus(navigator.onLine) });
      if (error instanceof HttpError && error.status === 401) { this.boot = undefined; this.engine?.stopAll(); this.retryTimer = setTimeout(() => { void this.start(); }, 15000); }
      else if (!(error instanceof HttpError && error.status === 404)) this.scheduleReconnect();
    } finally {this.connecting=false;}
  }
  private scheduleReconnect() { clearTimeout(this.retryTimer); if(!navigator.onLine)return; this.retryTimer = setTimeout(() => { void this.connect(); }, this.backoff); this.backoff = Math.min(this.backoff * 2, 15000); }
  private send(event: ClientEvent) {
    if(this.http) { const sent=this.http.send(event); void sent.catch(()=>undefined); return sent; }
    if (this.socket?.readyState !== WebSocket.OPEN) { this.error('Connection lost. Keep NearDrop open on both devices and try again.'); return; }
    this.socket.send(JSON.stringify(event));
  }
  private onEvent(event: ServerEvent) {
    if (event.type === 'ready') { this.backoff=1000; this.set({ status:'online',error:null,device: event.device, devices: event.devices, requests: event.requests, transfers: event.transfers }); return; }
    if (event.type === 'devices') { this.set({ devices: event.devices }); return; }
    if (event.type === 'pairing.request') { this.set({ requests: [...this.snapshot.requests.filter(r => r.id !== event.id), event] }); this.notification('Connection request', `${event.device.name} wants to connect.`); return; }
    if (event.type === 'pairing.accepted') { this.set({ requests: this.snapshot.requests.filter(r => r.device.id !== event.device.id), notice: `Connected to ${event.device.name}`, pairing: null, pairingRevision: this.snapshot.pairingRevision + 1 }); return; }
    if (event.type === 'pairing.rejected') { this.error('The connection request was declined.'); return; }
    if (event.type === 'error') { this.error(event.message); return; }
    if (event.type === 'transfer.updated') {
      const t = event.transfer;
      const previous = this.snapshot.transfers.find(x => x.id === t.id);
      this.set({ transfers: [t, ...this.snapshot.transfers.filter(x => x.id !== t.id)].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100) });
      this.engine?.update(t);
      if (!previous && t.status === 'waiting' && t.receiverId === this.snapshot.device?.id) this.notification('Incoming transfer', `${t.senderName} wants to send ${t.item.name}`);
      if (terminalStates.includes(t.status)) { if (t.status === 'completed') this.retained.delete(t.id); void this.pump(); }
      return;
    }
    if (event.type !== 'pong') this.engine?.handle(event);
  }
  private notification(title: string, body: string) {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && preferences.getItem('nd-notifications') === 'true') { try { new Notification(title, { body, icon: '/icon-192.png' }); } catch { /* iOS requires an installed PWA; the in-app request remains visible. */ } }
  }
  async rename(name: string) { const result = await api<{ device: Device }>(`/devices/${this.snapshot.device!.id}`, { name }, 'PATCH'); preferences.setItem('nd-device-name', result.device.name); this.set({ device: result.device }); }
  async pair(code: string) { return api<{ id: string; device: Device }>('/pairing/join', { code }); }
  async refreshPairing(force = false) {
    if (!force && this.snapshot.pairing && this.snapshot.pairing.expiresAt > Date.now()) return;
    this.pairingPromise ??= api<{ code: string; expiresAt: number }>('/pairing/create', {}).then(pairing => { this.set({ pairing }); }).finally(() => { this.pairingPromise = undefined; });
    await this.pairingPromise;
  }
  async respondPair(id: string, accept: boolean) { await api(`/pairing/${accept ? 'confirm' : 'reject'}`, { id }); this.set({ requests: this.snapshot.requests.filter(r => r.id !== id) }); }
  async accept(t: Transfer) { if (!this.engine) throw new Error('Wait for NearDrop to connect.'); await this.engine.accept(t); }
  async action(id: string, action: 'reject' | 'cancel') { await api(`/transfers/${id}/${action}`, {}); }
  enqueue(files: { file: Blob; item: ItemMetadata }[], receiverId: string) {
    if (!this.snapshot.devices.some(d => d.id === receiverId && d.online)) throw new Error('Connect a device before sending.');
    if (files.length + this.snapshot.queue.length > 100) throw new Error('Choose up to 100 files at a time.');
    const queue = files.map(f => ({ ...f, id: crypto.randomUUID(), receiverId })); this.set({ queue: [...this.snapshot.queue, ...queue] }); void this.pump();
  }
  removeQueued(id: string) { this.set({ queue: this.snapshot.queue.filter(q => q.id !== id) }); }
  private async pump() {
    if (this.pumping || !this.snapshot.queue.length || this.snapshot.status !== 'online' || this.snapshot.transfers.some(t => !terminalStates.includes(t.status))) return;
    this.pumping = true; const next = this.snapshot.queue[0];
    try {
      const { transfer } = await api<{ transfer: Transfer }>('/transfers', { receiverId: next.receiverId, item: next.item });
      this.engine?.attachFile(transfer.id, next.file); this.retained.set(transfer.id, next);
      this.set({ queue: this.snapshot.queue.filter(q => q.id !== next.id) });
    } catch (error) { this.error(error); this.set({ queue: this.snapshot.queue.filter(q => q.id !== next.id) }); }
    finally { this.pumping = false; }
  }
  canRetry(id: string) { return this.retained.has(id); }
  retry(id: string) { const q = this.retained.get(id); if (q) { this.retained.delete(id); this.enqueue([{ file: q.file, item: q.item }], q.receiverId); } }
  progressSnapshot = (id: string) => this.progress.get(id);
  subscribeProgress(id: string, listener: () => void) { const listeners = this.progressListeners.get(id) || new Set(); listeners.add(listener); this.progressListeners.set(id, listeners); return () => { listeners.delete(listener); }; }
  visibleHistory() { return this.snapshot.transfers.filter(t => terminalStates.includes(t.status) && Date.parse(t.createdAt) > this.historyAfter); }
  clearHistory() { this.historyAfter = Date.now(); preferences.setItem('nd-history-after', String(this.historyAfter)); this.set({}); }
  async dismissReceived(id: string) { const content = this.snapshot.received[id]; if (content?.url) URL.revokeObjectURL(content.url); await this.engine?.dispose(id); const received = { ...this.snapshot.received }; delete received[id]; this.set({ received }); }
}
export const platform = new PlatformClient();
