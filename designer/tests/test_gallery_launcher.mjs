import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LAUNCHER = path.join(ROOT, 'designer', 'canvas', 'gallery-launcher.mjs');

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

function makeGallery(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-launcher-'));
  const galleryDir = path.join(root, 'gallery with spaces');
  fs.mkdirSync(galleryDir);
  fs.writeFileSync(path.join(galleryDir, 'manifest.json'), JSON.stringify({
    screens: [{ id: 'planner', name: 'Planner' }],
    slots: [{
      screen_id: 'planner', screen_name: 'Planner', mode: 'calm',
      html_path: 'planner.html', status: 'authored',
    }],
  }));
  fs.writeFileSync(path.join(galleryDir, 'planner.html'), '<!doctype html><main>Planner</main>');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return galleryDir;
}

function runLauncher(command, galleryDir, extra = []) {
  const result = spawnSync(process.execPath, [
    LAUNCHER, command, '--dir', galleryDir, '--json', ...extra,
  ], {
    cwd: os.tmpdir(),
    env: { ...process.env, GROUNDWORK_PROFILE: 'off' },
    encoding: 'utf8',
    timeout: 15000,
  });
  let payload = null;
  try { payload = JSON.parse(result.stdout.trim()); } catch { /* asserted by caller */ }
  return { ...result, payload };
}

async function waitForStopped(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await fetch(url); } catch { return; }
    await delay(50);
  }
  throw new Error('detached gallery still answered after stop');
}

test('gallery launcher detaches, verifies readiness, reports health, and stops its PID', async (t) => {
  const galleryDir = makeGallery(t);
  const port = await reservePort();
  let startedPid = null;
  t.after(() => {
    if (!startedPid) return;
    const state = path.join(galleryDir, '.canvas', 'gallery-server.json');
    if (fs.existsSync(state)) runLauncher('stop', galleryDir);
  });

  const started = runLauncher('start', galleryDir, [
    '--title', 'Launcher test', '--port', String(port), '--no-profile',
  ]);
  assert.equal(started.status, 0, started.stderr || started.stdout);
  assert.equal(started.payload?.ok, true);
  assert.equal(started.payload?.alreadyRunning, undefined);
  assert.equal(started.payload?.url, 'http://localhost:' + port);
  assert.ok(Number.isSafeInteger(started.payload?.pid));
  startedPid = started.payload.pid;

  const ctrlDir = path.join(galleryDir, '.canvas');
  const canonicalCtrlDir = path.join(fs.realpathSync(galleryDir), '.canvas');
  const statePath = path.join(ctrlDir, 'gallery-server.json');
  const pidPath = path.join(ctrlDir, 'gallery-server.pid');
  const logPath = path.join(ctrlDir, 'gallery-server.log');
  assert.equal(Number.parseInt(fs.readFileSync(pidPath, 'utf8'), 10), startedPid);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.pid, startedPid);
  assert.equal(state.port, port);
  assert.equal(state.log, path.join(canonicalCtrlDir, 'gallery-server.log'));
  assert.equal(fs.existsSync(logPath), true);
  assert.equal(fs.existsSync(path.join(ctrlDir, 'gallery-launcher.lock')), false);

  // The launcher process has already exited; the detached server must remain.
  await delay(150);
  const endpoint = 'http://127.0.0.1:' + port + '/__gallery/health';
  const directHealth = await (await fetch(endpoint)).json();
  assert.equal(directHealth.ok, true);
  assert.equal(directHealth.pid, startedPid);
  assert.equal(directHealth.instance, state.instance);

  const duplicate = runLauncher('start', galleryDir, ['--port', String(port), '--no-profile']);
  assert.equal(duplicate.status, 0, duplicate.stderr || duplicate.stdout);
  assert.equal(duplicate.payload?.alreadyRunning, true);
  assert.equal(duplicate.payload?.pid, startedPid);

  const health = runLauncher('health', galleryDir);
  assert.equal(health.status, 0, health.stderr || health.stdout);
  assert.equal(health.payload?.running, true);
  assert.equal(health.payload?.pid, startedPid);

  const stopped = runLauncher('stop', galleryDir);
  assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);
  assert.equal(stopped.payload?.running, false);
  await waitForStopped(endpoint);
  assert.equal(fs.existsSync(statePath), false);
  assert.equal(fs.existsSync(pidPath), false);
  assert.equal(fs.existsSync(logPath), true, 'the diagnostic log should survive stop');
  startedPid = null;
});

test('gallery launcher refuses to signal a live PID without matching health ownership', async (t) => {
  const galleryDir = makeGallery(t);
  const ctrlDir = path.join(galleryDir, '.canvas');
  fs.mkdirSync(ctrlDir, { recursive: true });
  const port = await reservePort();
  fs.writeFileSync(path.join(ctrlDir, 'gallery-server.json'), JSON.stringify({
    schema: 'groundwork.gallery-launcher/v1',
    pid: process.pid,
    port,
    url: 'http://localhost:' + port,
    galleryDir,
    log: path.join(ctrlDir, 'gallery-server.log'),
    startedAt: new Date().toISOString(),
  }));
  fs.writeFileSync(path.join(ctrlDir, 'gallery-server.pid'), String(process.pid));

  const stopped = runLauncher('stop', galleryDir);
  assert.notEqual(stopped.status, 0);
  assert.equal(stopped.payload?.ok, false);
  assert.match(stopped.payload?.message || '', /refusing to stop unverified pid/);
  assert.equal(fs.existsSync(path.join(ctrlDir, 'gallery-server.json')), true,
    'refused ownership should leave evidence for manual inspection');
});

test('a competing launcher cannot remove the active launcher lock', (t) => {
  const galleryDir = makeGallery(t);
  const lockPath = path.join(galleryDir, '.canvas', 'gallery-launcher.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, String(process.pid), { mode: 0o600 });

  const started = runLauncher('start', galleryDir, ['--no-profile']);
  assert.notEqual(started.status, 0);
  assert.equal(started.payload?.ok, false);
  assert.match(started.payload?.message || '', /another gallery launcher is active/);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), String(process.pid),
    'a failed competitor must preserve the live owner lock');
});

test('launcher state cannot authorize a different gallery directory', async (t) => {
  const galleryA = makeGallery(t);
  const galleryB = makeGallery(t);
  const portA = await reservePort();
  const portB = await reservePort();
  let pidA = null;
  let pidB = null;
  t.after(() => {
    if (pidB && fs.existsSync(path.join(galleryB, '.canvas', 'gallery-server.json'))) {
      runLauncher('stop', galleryB);
    }
    if (pidA && fs.existsSync(path.join(galleryA, '.canvas', 'gallery-server.json'))) {
      runLauncher('stop', galleryA);
    }
  });

  const startedA = runLauncher('start', galleryA, ['--port', String(portA), '--no-profile']);
  assert.equal(startedA.status, 0, startedA.stderr || startedA.stdout);
  pidA = startedA.payload.pid;

  const ctrlA = path.join(galleryA, '.canvas');
  const ctrlB = path.join(galleryB, '.canvas');
  fs.mkdirSync(ctrlB, { recursive: true });
  fs.copyFileSync(path.join(ctrlA, 'gallery-server.json'), path.join(ctrlB, 'gallery-server.json'));
  fs.copyFileSync(path.join(ctrlA, 'gallery-server.pid'), path.join(ctrlB, 'gallery-server.pid'));

  const refusedStop = runLauncher('stop', galleryB);
  assert.notEqual(refusedStop.status, 0);
  assert.match(refusedStop.payload?.message || '', /refusing to stop unverified pid/);
  assert.equal((await (await fetch('http://127.0.0.1:' + portA + '/__gallery/health')).json()).pid, pidA,
    'cross-gallery stop terminated the original gallery');

  const startedB = runLauncher('start', galleryB, ['--port', String(portB), '--no-profile']);
  assert.equal(startedB.status, 0, startedB.stderr || startedB.stdout);
  assert.equal(startedB.payload.url, 'http://localhost:' + portB);
  assert.notEqual(startedB.payload.pid, pidA);
  pidB = startedB.payload.pid;

  assert.equal(runLauncher('stop', galleryB).status, 0);
  pidB = null;
  assert.equal(runLauncher('stop', galleryA).status, 0);
  pidA = null;
});
