import { createServer } from 'node:http';
import next from 'next';
import nextEnv from '@next/env';
import { WebSocketServer } from 'ws';
import { Platform } from './platform';
import { Store } from './store';
import { hash } from './security';
nextEnv.loadEnvConfig(process.cwd());
const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT || 3000);
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
if (!dev && !origin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS.');
const store = new Store(); await store.init();
const platform = new Platform(store, origin);
const app = next({ dev, hostname: '0.0.0.0', port }); await app.prepare();
const handler = app.getRequestHandler();
const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/v1/')) void platform.handle(req, res);
  else void handler(req, res);
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
const alive = new WeakMap<import('ws').WebSocket, boolean>();
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url!, origin);
  if (url.pathname !== '/api/v1/events') { void app.getUpgradeHandler()(req, socket, head); return; }
  if (req.headers.origin && req.headers.origin !== origin) { socket.destroy(); return; }
  const ticketHash = hash(url.searchParams.get('ticket') || '');
  const ticket = platform.tickets.get(ticketHash); platform.tickets.delete(ticketHash);
  const device = ticket && ticket.expiresAt > Date.now() ? store.devices.get(ticket.deviceId) : null;
  if (!device || device.expiresAt < Date.now()) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => { alive.set(ws, true); ws.on('pong', () => alive.set(ws, true)); platform.connect(device, ws); });
});
const timer = setInterval(() => { void platform.sweep().catch(error => console.error('Cleanup failed:', error instanceof Error ? error.message : 'unknown')); }, 30000);
const heartbeat = setInterval(() => { for (const socket of wss.clients) { if (!alive.get(socket)) { socket.terminate(); continue; } alive.set(socket, false); if (socket.readyState === socket.OPEN) socket.ping(); } }, 25000);
server.listen(port, '0.0.0.0', () => console.info(`NearDrop ready at ${origin}`));
function shutdown() { clearInterval(timer); clearInterval(heartbeat); for (const ws of wss.clients) ws.close(1001, 'Server restarting'); server.close(() => { void store.pool?.end(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
