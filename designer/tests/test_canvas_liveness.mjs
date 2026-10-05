// test_canvas_liveness.mjs — SSE heartbeat + rail disconnect handling for the
// iterate-mode canvas server (designer/canvas/canvas-server.mjs).
//
// Closes a recurring graceful-degradation gap: if the canvas server process
// dies while a browser tab is still open, the rail's SSE silently drops and
// Send/decide POSTs go nowhere with no visible signal — the rail keeps
// showing "Live" and the user's action appears to do nothing. This test
// covers the fix's two halves:
//   1. the server emits a periodic {type:"ping"} heartbeat on
//      /__canvas/events (so a half-dead connection is detectable), and
//   2. the served rail script actually wires that heartbeat into a visible
//      disconnect banner + guards Send/decide so a disconnected POST can
//      never be silent (structural check on the shipped script, same
//      technique as test_canvas_preview.mjs's shell assertions).
//
// Pattern: test_canvas_preview.mjs (spawn on a reserved loopback port, drive
// via fetch + a raw SSE reader).
//
// Run: node --test designer/tests/test_canvas_liveness.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER = path.join(ROOT, 'designer', 'canvas', 'canvas-server.mjs');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url, child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error('canvas server exited early: ' + output());
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* booting */ }
    await delay(50);
  }
  throw new Error('canvas server did not start: ' + output());
}

async function terminateChild(child, label) {
  if (!child || child.exitCode != null) return;
  let exited = false;
  const exit = new Promise((resolve) => {
    child.once('exit', () => { exited = true; resolve(); });
  });
  child.kill('SIGTERM');
  await Promise.race([exit, delay(750)]);
  if (!exited && child.exitCode == null) {
    child.kill('SIGKILL');
    await Promise.race([exit, delay(2000)]);
  }
  if (!exited && child.exitCode == null) throw new Error(label + ' did not exit during test cleanup');
}

// Minimal SSE reader over fetch's streaming body — reads `\n\n`-terminated
// blocks and parses the `data:` line as JSON, same framing as PROTOCOL.md §4.
function sseReader(response) {
  const nodeReader = response.body.getReader();
  let buf = '';
  let closed = false;
  async function fill(timeoutMs) {
    const timeout = delay(timeoutMs).then(() => 'timeout');
    let result;
    try {
      result = await Promise.race([nodeReader.read(), timeout]);
    } catch {
      // An abrupt close (e.g. the server process was SIGKILLed rather than
      // shut down gracefully) rejects the pending read with a socket/fetch
      // error instead of resolving {done:true} — treat both as "closed",
      // since a real browser's EventSource would fire onerror either way.
      closed = true;
      return false;
    }
    if (result === 'timeout') return false;
    if (result.done) { closed = true; return false; }
    buf += Buffer.from(result.value).toString('utf-8');
    return true;
  }
  return {
    async next(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (!buf.includes('\n\n')) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        const got = await fill(remaining);
        if (!got && closed) return null;
        if (!got) return null;
      }
      const idx = buf.indexOf('\n\n');
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) return { raw: block, data: null };
      try { return { raw: block, data: JSON.parse(dataLine.slice(5).trim()) }; } catch { return { raw: block, data: null }; }
    },
    async close() { try { await nodeReader.cancel(); } catch { /* ignore */ } },
  };
}

async function bootServer(canvasDir, canvasFile) {
  const port = await reservePort();
  const child = spawn(process.execPath, [
    SERVER, '--file', canvasFile, '--dir', canvasDir,
    '--title', 'Liveness test', '--port', String(port),
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const base = 'http://127.0.0.1:' + port;
  await waitForServer(base, child, () => logs);
  return { child, base, logs: () => logs };
}

test('SSE heartbeat: a ping frame arrives within ~15s of connecting', async (t) => {
  const canvasDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-canvas-liveness-'));
  t.after(() => fs.rmSync(canvasDir, { recursive: true, force: true }));
  const canvasFile = path.join(canvasDir, 'canvas.html');
  fs.writeFileSync(canvasFile, '<!doctype html><html><body><p>hi</p></body></html>');

  const { child, base } = await bootServer(canvasDir, canvasFile);
  t.after(() => terminateChild(child, 'canvas server'));

  const sseResponse = await fetch(base + '/__canvas/events', { headers: { Accept: 'text/event-stream' } });
  assert.equal(sseResponse.status, 200);
  const sse = sseReader(sseResponse);
  t.after(() => sse.close());

  const retryFrame = await sse.next();
  assert.ok(retryFrame && retryFrame.raw.includes('retry:'), 'expected a retry: directive first');
  const helloFrame = await sse.next();
  assert.equal(helloFrame && helloFrame.data && helloFrame.data.type, 'hello');

  // The server heartbeats every ~10s from process start, and this client may
  // connect at any phase of that cycle, so the next ping could be due almost
  // immediately or nearly a full interval out — a single generous-timeout
  // read covers the whole window (sseReader.next() must be called with its
  // full budget up front; polling it in a tight retry loop orphans earlier
  // pending reads and can silently miss the frame that resolves them).
  const pingFrame = await sse.next(15000);
  assert.ok(pingFrame, 'expected a {type:"ping"} SSE frame within ~15s of connecting');
  assert.equal(pingFrame.data && pingFrame.data.type, 'ping');
  assert.equal(typeof pingFrame.data.ts, 'number', 'ping frame should carry a timestamp');
});

test('SSE stream ends when the server process is killed', async (t) => {
  const canvasDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-canvas-liveness-kill-'));
  t.after(() => fs.rmSync(canvasDir, { recursive: true, force: true }));
  const canvasFile = path.join(canvasDir, 'canvas.html');
  fs.writeFileSync(canvasFile, '<!doctype html><html><body><p>hi</p></body></html>');

  const { child, base } = await bootServer(canvasDir, canvasFile);

  const sseResponse = await fetch(base + '/__canvas/events', { headers: { Accept: 'text/event-stream' } });
  assert.equal(sseResponse.status, 200);
  const sse = sseReader(sseResponse);

  const retryFrame = await sse.next();
  assert.ok(retryFrame && retryFrame.raw.includes('retry:'));
  const helloFrame = await sse.next();
  assert.equal(helloFrame && helloFrame.data && helloFrame.data.type, 'hello');

  // Simulate the recurring bug scenario: the server process dies out from
  // under a still-open tab. The stream must actually close (not hang) so a
  // real browser's EventSource would observe it and flip to reconnecting.
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));

  const frameAfterDeath = await sse.next(3000);
  assert.equal(frameAfterDeath, null, 'SSE stream should end (no more frames) once the server process is killed');
  await sse.close();
});

test('rail shell wires disconnect banner + heartbeat watchdog + guards Send/decide', async (t) => {
  const canvasDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-canvas-liveness-shell-'));
  t.after(() => fs.rmSync(canvasDir, { recursive: true, force: true }));
  const canvasFile = path.join(canvasDir, 'canvas.html');
  fs.writeFileSync(canvasFile, '<!doctype html><html><body><p>hi</p></body></html>');

  const { child, base, logs } = await bootServer(canvasDir, canvasFile);
  t.after(() => terminateChild(child, 'canvas server'));

  const shell = await (await fetch(base)).text();

  // Visible banner markup, hidden by default (CSS-gated via .show).
  assert.match(shell, /id="connBanner"/);
  assert.match(shell, /Disconnected .* reconnecting/);

  // EventSource lifecycle wiring: onopen clears state, onerror sets it,
  // and a heartbeat watchdog independently catches a stale connection.
  assert.match(shell, /es\.onopen/);
  assert.match(shell, /es\.onerror/);
  assert.match(shell, /lastAlive/);
  assert.match(shell, /25000/);

  // Hold deliberately defers canvas reloads in a background/study tab. Once
  // that tab is visible and neither explicitly held nor composing, one
  // pending reload may apply; otherwise a canvas can remain visibly stale
  // behind a permanent “pending update” control. The dirty + visible guard is
  // the no-background-churn invariant.
  assert.match(shell, /function wakePending\(\)/);
  assert.match(shell, /!dirtyWhileHeld \|\| held\(\) \|\| !isHome\(activeCanvas\.url\) \|\| document\.visibilityState !== 'visible'/);
  assert.match(shell, /document\.addEventListener\('visibilitychange'/);
  assert.match(shell, /window\.addEventListener\('focus', wakePending\)/);
  assert.match(shell, /document\.addEventListener\('pointerdown', wakePending, \{ capture: true, passive: true \}\)/);
  assert.match(shell, /document\.addEventListener\('click', wakePending\)/);
  assert.match(shell, /document\.addEventListener\('keydown', wakePending\)/);
  // The visual pending state clears synchronously; the iframe reload is
  // deferred so a late load-time error cannot preserve a false stale banner.
  assert.match(shell, /pending\.classList\.remove\('show'\);[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*reloadCanvas\(\)/);

  // Send (chip) and decide (A/B) must both refuse to POST while
  // disconnected — the invariant is the user always sees the action didn't
  // land, never a silent no-op.
  assert.match(shell, /if \(!connected\)/);
  const disconnectedGuardCount = (shell.match(/if \(!connected\)/g) || []).length;
  assert.ok(disconnectedGuardCount >= 2, 'expected a disconnected guard on both the chip handler and the decide handler');

  const scriptBlocks = Array.from(shell.matchAll(/<script>([\s\S]*?)<\/script>/g));
  assert.ok(scriptBlocks.length > 0, 'canvas shell must contain a client script');
  try {
    new vm.Script(scriptBlocks.at(-1)[1], { filename: 'groundwork-canvas-client.js' });
  } catch (error) {
    assert.fail('rail script failed to parse: ' + (error.stack || error.message) + '\n\nserver logs:\n' + logs());
  }
});
