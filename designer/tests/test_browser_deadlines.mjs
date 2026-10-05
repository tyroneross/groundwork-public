import test from 'node:test';
import assert from 'node:assert/strict';
import { waitUntil, connectCdp } from './support/browser.js';

class Socket extends EventTarget {
  static current;
  constructor() { super(); Socket.current = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
  send() {}
  close() { this.dispatchEvent(new Event('close')); }
}

test('polling bounds a stuck predicate and cancels its signal', async () => {
  let signal;
  const start = performance.now();
  await assert.rejects(waitUntil(s => { signal = s; return new Promise(() => {}); }, 'renderer stalled', 80), /renderer stalled.*deadline 80ms/);
  assert.ok(performance.now() - start < 1000, 'stuck callback must not exceed the total budget');
  assert.equal(signal.aborted, true);
});

test('CDP closure immediately rejects pending commands and future sends', async () => {
  const cdp = await connectCdp('fixture:', { Socket, timeoutMs: 5000 });
  const start = performance.now();
  const pending = cdp.send('Runtime.evaluate');
  Socket.current.close();
  await assert.rejects(pending, /transport closed/);
  await assert.rejects(cdp.send('Page.enable'), /transport closed/);
  assert.ok(performance.now() - start < 1000, 'closure must not wait for the command deadline');
});

test('CDP bounds a silent command and a socket that never opens', async () => {
  const cdp = await connectCdp('fixture:', { Socket, timeoutMs: 80 });
  await assert.rejects(cdp.send('Runtime.evaluate'), /Runtime.evaluate deadline 80ms/);
  cdp.close();
  class SilentSocket extends EventTarget { close() {} }
  await assert.rejects(connectCdp('fixture:', { Socket: SilentSocket, timeoutMs: 80 }), /socket open deadline 80ms/);
});
