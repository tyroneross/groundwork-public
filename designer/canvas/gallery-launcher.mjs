#!/usr/bin/env node
// Durable process wrapper for Groundwork gallery mode.
//
// A shell background job started by a short-lived host can be reaped when that
// host exits. This wrapper starts the gallery in a detached process group,
// waits for the server's own health endpoint, and records enough local state to
// check or stop the exact process later. Node stdlib only.

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, 'canvas-server.mjs');
const STATE_SCHEMA = 'groundwork.gallery-launcher/v1';

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args.shift() : 'start';
const jsonOutput = args.includes('--json');

function flag(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function emit(value) {
  if (jsonOutput) {
    process.stdout.write(JSON.stringify(value) + '\n');
    return;
  }
  const lines = [];
  if (value.message) lines.push(value.message);
  for (const key of ['url', 'pid', 'log', 'health', 'stop']) {
    if (value[key] != null) lines.push(`  ${key.padEnd(6)}: ${value[key]}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function fail(message, details = {}) {
  emit({ ok: false, message, ...details });
  process.exitCode = 1;
}

const dirArg = flag('--dir', '');
if (!dirArg) {
  fail('gallery-launcher: --dir <mockups-dir> is required');
} else {
  await main();
}

async function main() {
  const resolvedDir = path.resolve(dirArg);
  let galleryDir;
  try { galleryDir = fs.realpathSync(resolvedDir); } catch {
    fail(`gallery-launcher: gallery directory does not exist: ${resolvedDir}`);
    return;
  }
  const manifest = path.join(galleryDir, 'manifest.json');
  if (!fs.existsSync(manifest) || !fs.statSync(manifest).isFile()) {
    fail(`gallery-launcher: --dir must contain manifest.json: ${galleryDir}`);
    return;
  }

  const ctrlDir = path.join(galleryDir, '.canvas');
  const statePath = path.join(ctrlDir, 'gallery-server.json');
  const pidPath = path.join(ctrlDir, 'gallery-server.pid');
  const logPath = path.join(ctrlDir, 'gallery-server.log');
  const lockPath = path.join(ctrlDir, 'gallery-launcher.lock');
  fs.mkdirSync(ctrlDir, { recursive: true });

  const context = { galleryDir, ctrlDir, statePath, pidPath, logPath, lockPath };
  if (command === 'start') await withLock(context, () => start(context));
  else if (command === 'health' || command === 'status') await health(context);
  else if (command === 'stop') await withLock(context, () => stop(context));
  else fail(`gallery-launcher: unknown command "${command}" (use start, health, or stop)`);
}

function readState(statePath) {
  try {
    const value = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return value && value.schema === STATE_SCHEMA ? value : null;
  } catch { return null; }
}

function writeAtomic(file, data) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, data, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* absent */ }
    throw error;
  }
}

function removeIfPresent(file) {
  try { fs.unlinkSync(file); } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function withLock(context, operation) {
  let descriptor;
  try {
    try {
      descriptor = fs.openSync(context.lockPath, 'wx', 0o600);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      const lockPid = Number.parseInt(fs.readFileSync(context.lockPath, 'utf8'), 10);
      if (pidAlive(lockPid)) throw new Error(`another gallery launcher is active (pid ${lockPid})`);
      removeIfPresent(context.lockPath);
      descriptor = fs.openSync(context.lockPath, 'wx', 0o600);
    }
    fs.writeFileSync(descriptor, String(process.pid));
    await operation();
  } catch (error) {
    fail(`gallery-launcher: ${error && error.message ? error.message : error}`);
  } finally {
    // Only the process that successfully created the lock may remove it. A
    // competing launcher must leave the active owner's lock intact.
    if (descriptor != null) {
      fs.closeSync(descriptor);
      removeIfPresent(context.lockPath);
    }
  }
}

function requestHealth(port, timeoutMs = 350) {
  return new Promise((resolve) => {
    const request = http.get({
      host: '127.0.0.1', port, path: '/__gallery/health', timeout: timeoutMs,
      headers: { Accept: 'application/json' },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { if (body.length < 65536) body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) { resolve(null); return; }
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

function healthOwnsState(result, state, context) {
  return !!(result && result.ok === true && result.mode === 'gallery'
    && result.pid === state.pid && result.instance === state.instance
    && typeof state.instance === 'string' && state.instance.length > 0
    && state.galleryDir === context.galleryDir);
}

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(port)));
  });
}

async function availablePort(start) {
  for (let port = start; port < start + 40; port += 1) {
    try { return await reservePort(port); } catch (error) {
      if (!error || error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`no free loopback port from ${start} through ${start + 39}`);
}

async function readyHealth(port, pid, instance, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null || child.signalCode != null) return null;
    const result = await requestHealth(port);
    if (result && result.ok === true && result.mode === 'gallery'
      && result.pid === pid && result.instance === instance) return result;
    await delay(75);
  }
  return null;
}

function stopCommand(galleryDir) {
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(fileURLToPath(import.meta.url))} stop --dir ${JSON.stringify(galleryDir)}`;
}

async function start(context) {
  const prior = readState(context.statePath);
  if (prior) {
    const existing = await requestHealth(prior.port);
    if (healthOwnsState(existing, prior, context)) {
      emit({
        ok: true, alreadyRunning: true, message: 'Groundwork gallery is already running.',
        url: prior.url, pid: prior.pid, log: context.logPath,
        health: `${prior.url}/__gallery/health`, stop: stopCommand(context.galleryDir),
      });
      return;
    }
    // Stale metadata never authorizes a kill. It is safe to replace after the
    // health endpoint fails to prove that the recorded PID owns this gallery.
    removeIfPresent(context.statePath);
    removeIfPresent(context.pidPath);
  }

  const requestedPort = Number.parseInt(flag('--port', '8930'), 10);
  if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
    throw new Error('--port must be an integer from 1024 through 65535');
  }
  const port = await availablePort(requestedPort);
  const title = flag('--title', path.basename(context.galleryDir));
  const instance = randomUUID();
  const launchArgs = [
    SERVER, '--mode', 'gallery', '--dir', context.galleryDir,
    '--title', title, '--port', String(port), '--gallery-instance', instance,
  ];
  if (args.includes('--no-profile')) launchArgs.push('--no-profile');

  fs.appendFileSync(context.logPath, `\n[${new Date().toISOString()}] launching gallery\n`, { mode: 0o600 });
  const logDescriptor = fs.openSync(context.logPath, 'a', 0o600);
  let child;
  try {
    child = spawn(process.execPath, launchArgs, {
      cwd: context.galleryDir,
      env: process.env,
      detached: true,
      stdio: ['ignore', logDescriptor, logDescriptor],
    });
  } finally {
    fs.closeSync(logDescriptor);
  }
  child.unref();

  const ready = await readyHealth(port, child.pid, instance, child);
  if (!ready) {
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* already exited */ }
    throw new Error(`gallery failed readiness on port ${port}; inspect ${context.logPath}`);
  }

  const url = `http://localhost:${port}`;
  const state = {
    schema: STATE_SCHEMA,
    pid: child.pid,
    port,
    url,
    galleryDir: context.galleryDir,
    instance,
    log: context.logPath,
    startedAt: ready.startedAt || new Date().toISOString(),
  };
  writeAtomic(context.statePath, JSON.stringify(state));
  writeAtomic(context.pidPath, String(child.pid) + '\n');
  emit({
    ok: true, message: 'Groundwork gallery started and passed readiness.',
    url, pid: child.pid, log: context.logPath,
    health: `${url}/__gallery/health`, stop: stopCommand(context.galleryDir),
  });
}

async function health(context) {
  const state = readState(context.statePath);
  if (!state) {
    fail('Groundwork gallery is not running: no launcher state.', { running: false });
    return;
  }
  const result = await requestHealth(state.port);
  const running = healthOwnsState(result, state, context);
  if (!running) {
    fail('Groundwork gallery did not pass health.', {
      running: false, pid: state.pid, log: context.logPath,
    });
    return;
  }
  emit({
    ok: true, running: true, message: 'Groundwork gallery is healthy.',
    url: state.url, pid: state.pid, log: context.logPath,
    health: `${state.url}/__gallery/health`, stop: stopCommand(context.galleryDir),
  });
}

async function stop(context) {
  const state = readState(context.statePath);
  if (!state) {
    removeIfPresent(context.pidPath);
    emit({ ok: true, running: false, message: 'Groundwork gallery is already stopped.', log: context.logPath });
    return;
  }
  const result = await requestHealth(state.port);
  const owned = healthOwnsState(result, state, context);
  if (!owned && pidAlive(state.pid)) {
    throw new Error(`refusing to stop unverified pid ${state.pid}; recorded health ownership no longer matches`);
  }
  if (owned) {
    process.kill(state.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const live = await requestHealth(state.port, 150);
      if (!live || live.pid !== state.pid) break;
      await delay(75);
    }
    const live = await requestHealth(state.port, 150);
    if (live && live.pid === state.pid) throw new Error(`gallery pid ${state.pid} did not stop after SIGTERM`);
  }
  removeIfPresent(context.statePath);
  removeIfPresent(context.pidPath);
  emit({ ok: true, running: false, message: 'Groundwork gallery stopped.', pid: state.pid, log: context.logPath });
}
