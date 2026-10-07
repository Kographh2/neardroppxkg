import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, HttpError } from '../src/lib/api';
import { disconnectedStatus } from '../src/lib/connection-status';

test('network offline and unavailable backend are distinct',()=>{
  assert.equal(disconnectedStatus(false),'offline');
  assert.equal(disconnectedStatus(true),'server-unavailable');
});
test('HTML 404/503 responses retain meaningful HTTP errors rather than JSON parse errors',async t=>{
  const fetchMock=t.mock.method(globalThis,'fetch',async()=>new Response('<html>Not found</html>',{status:404}));
  await assert.rejects(()=>api('/devices/register',{}),e=>e instanceof HttpError && e.status===404 && /API is missing/.test(e.message));
  fetchMock.mock.mockImplementation(async()=>new Response('<html>Unavailable</html>',{status:503}));
  await assert.rejects(()=>api('/devices/register',{}),e=>e instanceof HttpError && e.status===503 && /not ready/.test(e.message));
  fetchMock.mock.mockImplementation(async()=>new Response(JSON.stringify({error:'Database is not configured.'}),{status:503}));
  await assert.rejects(()=>api('/devices/register',{}),/Database is not configured/);
});
