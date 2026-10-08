import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './security';

const iceSchema = z.object({ iceServers: z.array(z.object({
  urls: z.union([z.string(), z.array(z.string())]), username: z.string().optional(), credential: z.string().optional()
})).min(1) });
export async function iceConfiguration(deviceId: string) {
  const key = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (key || token) {
    if (!key || !token) throw new ApiError(503, 'Cloudflare TURN configuration is incomplete.');
    try {
      const response = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + encodeURIComponent(key) + '/credentials/generate-ice-servers', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }), signal: AbortSignal.timeout(8000), cache: 'no-store'
      });
      if (!response.ok) throw new Error('TURN provider rejected credentials');
      const result = iceSchema.parse(await response.json());
      const iceServers = result.iceServers.map(server => ({ ...server, urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(url => /^(stun|turn|turns):/.test(url) && !/:53(?:\?|$)/.test(url)) })).filter(server => server.urls.length);
      if (!iceServers.some(s => s.credential && s.urls.some(u => /^turns?:/.test(u)))) throw new Error('Missing TURN credentials');
      return { iceServers, turnConfigured: true };
    } catch { throw new ApiError(503, 'The secure connection service is unavailable. Check Cloudflare TURN credentials and try again.'); }
  }
  const iceServers: { urls: string[]; username?: string; credential?: string }[] = [];
  const stun = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map(s => s.trim()).filter(Boolean);
  if (stun.length) iceServers.push({ urls: stun });
  if (process.env.TURN_URLS && process.env.TURN_SECRET) {
    const username = String(Math.floor(Date.now() / 1000) + 86400) + ':' + deviceId;
    iceServers.push({ urls: process.env.TURN_URLS.split(',').map(s => s.trim()).filter(Boolean), username, credential: createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64') });
  }
  return { iceServers, turnConfigured: iceServers.some(s => s.credential) };
}
