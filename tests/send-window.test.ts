import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SendWindow } from '../src/transfer/send-window';
test('bounded send window waits for receiver acknowledgement and rejects interruption', async () => {
  const window = new SendWindow(2, 1000);
  window.track(0); window.track(1);
  let released = false; const room = window.room().then(() => { released = true; });
  await Promise.resolve(); assert.equal(released, false);
  assert.equal(window.acknowledge(99), false);
  assert.equal(window.acknowledge(0), true); await room; assert.equal(released, true);
  assert.equal(window.acknowledge(0), false);
  const drained = window.drain(); window.cancel(); await assert.rejects(drained, /stopped/);
});
test('send window times out missing acknowledgements', async () => {
  const window = new SendWindow(1, 10); window.track(0);
  await assert.rejects(window.drain(), /stopped responding/); window.cancel();
});
