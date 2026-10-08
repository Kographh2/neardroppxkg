import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { iceConfiguration } from '../server/ice';
test('Cloudflare secret remains server-only; temporary credentials validated; failures safe', async () => {
  const previous = { key: process.env.CLOUDFLARE_TURN_KEY_ID, token: process.env.CLOUDFLARE_TURN_API_TOKEN };
  process.env.CLOUDFLARE_TURN_KEY_ID = 'test-key'; process.env.CLOUDFLARE_TURN_API_TOKEN = 'server-secret';
  const fetcher = mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer server-secret');
    return Response.json({ iceServers: [{ urls: ['turns:turn.cloudflare.com:443?transport=tcp', 'turn:turn.cloudflare.com:53'], username: 'temporary-user', credential: 'temporary-password' }] });
  });
  try {
    const result = await iceConfiguration('device'); assert.equal(result.turnConfigured, true);
    assert.equal(JSON.stringify(result).includes('server-secret'), false);
    assert.equal(result.iceServers[0].urls.length, 1);
    fetcher.mock.mockImplementation(async () => Response.json({ error: 'secret failure' }, { status: 401 }));
    await assert.rejects(iceConfiguration('device'), /secure connection service/);
  } finally {
    fetcher.mock.restore();
    if (previous.key === undefined) delete process.env.CLOUDFLARE_TURN_KEY_ID; else process.env.CLOUDFLARE_TURN_KEY_ID = previous.key;
    if (previous.token === undefined) delete process.env.CLOUDFLARE_TURN_API_TOKEN; else process.env.CLOUDFLARE_TURN_API_TOKEN = previous.token;
  }
});
