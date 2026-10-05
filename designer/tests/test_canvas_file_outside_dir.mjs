// test_canvas_file_outside_dir.mjs — --file living outside --dir must still
// serve for the iterate-mode canvas server (designer/canvas/canvas-server.mjs).
//
// Closes a silent-403 gap: serveFile() checked containment against CANVAS_DIR
// (the --dir control dir), so a --file whose page lives in a different folder
// than --dir (e.g. --dir is a shared review root above several page folders)
// got rejected on GET /__canvas/file with no visible explanation. The fix
// splits the two roots — ASSET_DIR (path.dirname(--file), for sibling
// assets) vs CANVAS_DIR (--dir, control dir only) — and always serves the
// canvas file itself regardless of containment.
//
// Pattern: test_canvas_liveness.mjs (spawn on a reserved loopback port, drive
// via fetch; reservePort/waitForServer/terminateChild helpers copied verbatim).
//
// Run: node --test designer/tests/test_canvas_file_outside_dir.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
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

test('--file outside --dir: served unconditionally, sibling assets resolve from the page folder, traversal outside it still 403s', async (t) => {
  const MARKER = 'GROUNDWORK-OUTSIDE-DIR-MARKER-3f9a';
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-canvas-page-'));
  const ctrlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-canvas-ctrl-'));
  t.after(() => {
    fs.rmSync(pageDir, { recursive: true, force: true });
    fs.rmSync(ctrlDir, { recursive: true, force: true });
  });

  const pageFile = path.join(pageDir, 'page.html');
  fs.writeFileSync(pageFile, `<!doctype html><html><body><p>${MARKER}</p></body></html>`);
  fs.writeFileSync(path.join(pageDir, 'asset.css'), 'body{color:red}');

  const port = await reservePort();
  const child = spawn(process.execPath, [
    SERVER, '--file', pageFile, '--dir', ctrlDir,
    '--title', 'Outside-dir test', '--port', String(port),
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const base = 'http://127.0.0.1:' + port;
  await waitForServer(base, child, () => logs);
  t.after(() => terminateChild(child, 'canvas server'));

  // The canvas file itself must serve even though --dir (ctrlDir) is a
  // wholly separate directory from the page's own folder (pageDir).
  const fileResponse = await fetch(base + '/__canvas/file');
  assert.equal(fileResponse.status, 200, 'expected /__canvas/file to serve despite --dir living elsewhere: ' + logs);
  const fileBody = await fileResponse.text();
  assert.ok(fileBody.includes(MARKER), 'served canvas file should contain the page marker');

  // Sibling assets resolve from the page's own folder (ASSET_DIR), not --dir.
  const assetResponse = await fetch(base + '/asset.css');
  assert.equal(assetResponse.status, 200, 'expected sibling asset.css to serve from the page folder');
  const assetBody = await assetResponse.text();
  assert.ok(assetBody.includes('color:red'));

  // Traversal outside the page folder (ASSET_DIR) is still rejected.
  const traversalResponse = await fetch(base + '/..%2F..%2Fetc%2Fpasswd');
  assert.equal(traversalResponse.status, 403, 'expected traversal outside the asset root to 403');

  // --dir still gets its .canvas control dir created, independent of ASSET_DIR.
  assert.ok(fs.existsSync(path.join(ctrlDir, '.canvas')), 'expected .canvas control dir under --dir');
});
