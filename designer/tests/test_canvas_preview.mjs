// test_canvas_preview.mjs — decision-preview relay for the iterate-mode canvas
// server (designer/canvas/canvas-server.mjs). Pattern: test_gallery_server.mjs
// (spawn on a reserved loopback port, drive via fetch + a raw SSE reader).
//
// Covers PROTOCOL.md §4a / schemas/status.schema.json forkOption.preview:
//   - hover/focus intent (POST /__canvas/preview) relays a `preview` SSE frame
//     with the component/addClass/removeClass verbatim
//   - clear intent ({clear:true}) relays a `preview-clear` SSE frame
//   - a bad request (neither component nor clear) is rejected with 400
//   - the relay is non-destructive: no feedback.jsonl row, no status.json or
//     canvas-file mutation as a side effect of preview traffic
//   - the rail shell wires hover AND focus/blur (keyboard-accessible) on fork
//     options that carry a `preview`, and the injected script parses as JS
//
// Run: node --test designer/tests/test_canvas_preview.mjs

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
    const read = nodeReader.read();
    const result = await Promise.race([read, timeout]);
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
    '--title', 'Preview test', '--port', String(port),
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const base = 'http://127.0.0.1:' + port;
  await waitForServer(base, child, () => logs);
  return { child, base, logs: () => logs };
}

test('decision preview: hover/focus intent relays over SSE and reverts on clear', async (t) => {
  const canvasDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-canvas-preview-'));
  t.after(() => fs.rmSync(canvasDir, { recursive: true, force: true }));
  const canvasFile = path.join(canvasDir, 'canvas.html');
  fs.writeFileSync(canvasFile, '<!doctype html><html><body><header data-component="Header">Hairline</header></body></html>');

  const { child, base, logs } = await bootServer(canvasDir, canvasFile);
  t.after(() => terminateChild(child, 'canvas server'));

  const ctrlDir = path.join(canvasDir, '.canvas');
  const statusFile = path.join(ctrlDir, 'status.json');
  const feedbackFile = path.join(ctrlDir, 'feedback.jsonl');
  fs.writeFileSync(statusFile, JSON.stringify({
    confidence: 0.5, info_gain: 0.2, ready: false, round: 1, next_question: null, decided: {},
    fork: {
      dim: 'header.style', question: 'Hairline or whitespace?',
      a: { label: 'Hairline', preview: { component: 'Header', addClass: 'gw-preview-hairline', removeClass: 'gw-preview-whitespace' } },
      b: { label: 'Whitespace' }, // intentionally no preview -> backward-compat path
    },
  }));

  const sseResponse = await fetch(base + '/__canvas/events', { headers: { Accept: 'text/event-stream' } });
  assert.equal(sseResponse.status, 200);
  const sse = sseReader(sseResponse);
  t.after(() => sse.close());

  const retryFrame = await sse.next();
  assert.ok(retryFrame && retryFrame.raw.includes('retry:'), 'expected a retry: directive first');
  const helloFrame = await sse.next();
  assert.equal(helloFrame && helloFrame.data && helloFrame.data.type, 'hello');

  const canvasMtimeBefore = fs.statSync(canvasFile).mtimeMs;
  const feedbackExistedBefore = fs.existsSync(feedbackFile);

  // --- hover intent: option A carries a preview ---
  const previewResponse = await fetch(base + '/__canvas/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ component: 'Header', addClass: 'gw-preview-hairline', removeClass: 'gw-preview-whitespace' }),
  });
  assert.equal(previewResponse.status, 200);
  assert.deepEqual(await previewResponse.json(), { ok: true });

  const previewFrame = await sse.next();
  assert.ok(previewFrame, 'expected an SSE frame within 2s of POST /__canvas/preview');
  assert.equal(previewFrame.data.type, 'preview');
  assert.equal(previewFrame.data.component, 'Header');
  assert.equal(previewFrame.data.addClass, 'gw-preview-hairline');
  assert.equal(previewFrame.data.removeClass, 'gw-preview-whitespace');

  // --- clear intent: mouseleave/blur ---
  const clearResponse = await fetch(base + '/__canvas/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear: true }),
  });
  assert.equal(clearResponse.status, 200);
  const clearFrame = await sse.next();
  assert.ok(clearFrame, 'expected a preview-clear SSE frame within 2s');
  assert.equal(clearFrame.data.type, 'preview-clear');

  // --- bad request: neither component nor clear ---
  const badResponse = await fetch(base + '/__canvas/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addClass: 'x' }),
  });
  assert.equal(badResponse.status, 400);

  // --- non-destructive: preview traffic must not touch any protocol file ---
  assert.equal(fs.statSync(canvasFile).mtimeMs, canvasMtimeBefore, 'preview POSTs must not touch the canvas file');
  assert.equal(fs.existsSync(feedbackFile), feedbackExistedBefore, 'preview POSTs must not create/append feedback.jsonl');
  const statusAfter = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
  assert.equal(statusAfter.fork.dim, 'header.style', 'preview POSTs must not mutate status.json');

  // --- rail shell: hover-only is not enough — focus/blur must be wired too
  // (keyboard accessibility), and only when a preview field is present.
  const shell = await (await fetch(base)).text();
  assert.match(shell, /postPreview/);
  assert.match(shell, /mouseenter/);
  assert.match(shell, /addEventListener\('focus', start\)/);
  assert.match(shell, /addEventListener\('blur', stop\)/);
  assert.match(shell, /preview-clear/);
  const scriptBlocks = Array.from(shell.matchAll(/<script>([\s\S]*?)<\/script>/g));
  assert.ok(scriptBlocks.length > 0, 'canvas shell must contain a client script');
  try {
    new vm.Script(scriptBlocks.at(-1)[1], { filename: 'groundwork-canvas-client.js' });
  } catch (error) {
    assert.fail('rail script failed to parse: ' + (error.stack || error.message) + '\n\nserver logs:\n' + logs());
  }
});
