// test_designer_durable_turns.mjs — Chunk 2 closure for the durable-turns plan
// (.build-loop/plans/designer-durable-turns.md): a decision the host posted
// stays visible and answerable regardless of host heartbeat or server
// restart, and a hung server exits non-zero for a supervisor.
//
// Five tests:
//   1. A posted decision is visible on GET /api/step with ZERO host polling
//      (proves the noAgent-hides-a-posted-decision bug is fixed).
//   2. A pick is still accepted after 10 minutes of host idle time — the
//      agent window only gates the "no agent attached" notice.
//   3. A server restart resumes seq + history from STATE_FILE; a different
//      --context on relaunch does NOT resume (fresh walk instead).
//   4. designer/bridge/adaptive_host_driver.py's contract/answer CLIs match
//      the live server's response shapes.
//   5. The event-loop watchdog kills a wedged process; a disabled watchdog
//      (or a transient block) leaves the process running.
//
// Each server gets its own temp dir (state file + --out), --port 0 (the
// bound port is parsed from stdout), cwd = repo root, PYTHONPATH = repo
// root. Zero new deps: node:test + node:http + node:child_process, stdlib
// only, same as test_stale_seq.mjs / test_workspace.mjs.
//
// Run: PYTHONPATH=$PWD node --test designer/tests/test_designer_durable_turns.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { advanceStall } from '../server/event-loop-watchdog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // the UI Guidance repo
const SERVER = path.join(ROOT, 'designer', 'server', 'designer-server.mjs');
const RUN_SUPERVISED = path.join(ROOT, 'designer', 'server', 'run-supervised.sh');
const DRIVER_CLI = path.join(ROOT, 'designer', 'bridge', 'adaptive_host_driver.py');
const CLOCK_SKEW_PRELOAD = path.join(__dirname, 'fixtures', 'clock-skew-preload.cjs');
const BLOCK_LOOP_PRELOAD = path.join(__dirname, 'fixtures', 'block-loop-preload.cjs');

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });
  return dir;
}

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode, json: null, raw: buf });
          }
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// Boots the real designer-server.mjs with an isolated temp dir for its
// STATE_FILE and (unless overridden) --out. Returns port/get/post helpers,
// the resolved state file path, and an `exited` promise for kill/watchdog
// assertions. `t.after` always kills the process, best-effort.
async function spawnServer(t, { args = [], env = {}, preload = null, workDir = null } = {}) {
  const dir = workDir || tempDir(t, 'groundwork-durable-');
  const stateFile = env.GROUNDWORK_DESIGNER_STATE_FILE || path.join(dir, 'state.json');

  const nodeArgs = [];
  if (preload) nodeArgs.push('--require', preload);
  nodeArgs.push(SERVER, '--port', '0', ...args);
  if (!args.includes('--out')) {
    const outDir = path.join(dir, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    nodeArgs.push('--out', outDir);
  }

  const proc = spawn(process.execPath, nodeArgs, {
    cwd: ROOT,
    env: {
      ...process.env,
      PYTHONPATH: ROOT,
      ...env,
      GROUNDWORK_DESIGNER_STATE_FILE: stateFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  proc.stdout.on('data', (b) => { stdoutBuf += b; });
  proc.stderr.on('data', (b) => { stderrBuf += b; });

  const exited = new Promise((resolve) => {
    proc.once('exit', (code, signal) => resolve({ code, signal }));
  });

  t.after(() => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } });

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`server did not start in time:\n${stdoutBuf}${stderrBuf}`));
    }, 10000);
    const onData = () => {
      const m = stdoutBuf.match(/running at http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
      if (m) {
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        resolve(Number(m[1]));
      }
    };
    proc.stdout.on('data', onData);
    onData(); // in case the line already arrived before this listener attached
  });

  return {
    proc,
    port,
    dir,
    stateFile,
    exited,
    stdout: () => stdoutBuf,
    stderr: () => stderrBuf,
    get: (p) => request(port, 'GET', p),
    post: (p, body) => request(port, 'POST', p, body),
  };
}

function historyLength(stateFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return Array.isArray(parsed.history) ? parsed.history.length : 0;
  } catch {
    return 0;
  }
}

// Runs the Python engine CLI's `next-step` (no --answer) directly against a
// STATE_FILE the server wrote — the contract-building path Test 1 uses
// INSTEAD OF GET /api/agent/contract, to prove the decision below is visible
// without the host ever polling the contract endpoint.
function engineNextStep(stateFile) {
  const out = execFileSync('python3', ['-m', 'designer.engine.cli', 'next-step', '--state', stateFile], {
    cwd: ROOT,
    env: { ...process.env, PYTHONPATH: ROOT, PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

// Polls `getText()` (a growing stdout/stderr buffer) until `regex` (with the
// `g` flag) has matched at least `count` times, or rejects on timeout. Used
// to wait for a process's Nth log line (e.g. the Nth "running at" line after
// a supervisor restart) instead of racing a fixed sleep against process I/O.
function waitForMatches(getText, regex, count, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const matches = [...getText().matchAll(regex)];
      if (matches.length >= count) return resolve(matches);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`timed out waiting for ${count} match(es) of ${regex} — got ${matches.length}:\n${getText()}`));
      }
      setTimeout(check, 100);
    };
    check();
  });
}

// Boots designer-server.mjs under designer/server/run-supervised.sh (F2/F3):
// bash, restart-only-on-signal-kill supervisor. Returns the bash process
// handle (its stdout/stderr carry every child instance's own log lines, so
// a restart shows up as a second "running at" line) and does NOT wait for
// the server to come up — callers use waitForMatches for that, since a
// restart test needs to wait for the SECOND occurrence too.
function spawnSupervised(t, { args = [], env = {} } = {}) {
  const dir = tempDir(t, 'groundwork-supervised-');
  const stateFile = env.GROUNDWORK_DESIGNER_STATE_FILE || path.join(dir, 'state.json');
  const fullArgs = args.includes('--port') ? [...args] : ['--port', '0', ...args];
  if (!fullArgs.includes('--out')) {
    const outDir = path.join(dir, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    fullArgs.push('--out', outDir);
  }

  const proc = spawn('bash', [RUN_SUPERVISED, ...fullArgs], {
    cwd: ROOT,
    env: {
      ...process.env,
      PYTHONPATH: ROOT,
      ...env,
      GROUNDWORK_DESIGNER_STATE_FILE: stateFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  proc.stdout.on('data', (b) => { stdoutBuf += b; });
  proc.stderr.on('data', (b) => { stderrBuf += b; });

  const exited = new Promise((resolve) => {
    proc.once('exit', (code, signal) => resolve({ code, signal }));
  });

  t.after(() => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } });

  return {
    proc,
    dir,
    stateFile,
    exited,
    stdout: () => stdoutBuf,
    stderr: () => stderrBuf,
  };
}

// ── F1: advanceStall — pure function, unit-tested directly ─────────────────
// (event-loop-watchdog.mjs embeds this same function into the worker via
// .toString(), so this exercises exactly what the worker runs.)

test('advanceStall: an unchanged beat across a 10-minute gap does not exceed a 1s threshold in one tick', () => {
  const tickMs = 250;
  const thresholdMs = 1000;
  const prev = { lastBeat: 5, lastTickNs: 0n, stalledMs: 0 };
  // hrtime keeps advancing across a real system sleep — simulate a single
  // worker tick that observes a 10-minute jump with the beat unchanged
  // (main thread's own timer also missed its ticks during the sleep).
  const tenMinutesNs = BigInt(10 * 60 * 1000) * 1_000_000n;
  const next = advanceStall(prev, { nowNs: tenMinutesNs, beat: 5, tickMs });
  assert.ok(next.stalledMs <= thresholdMs, `expected a single tick to stay within the threshold, got ${next.stalledMs}ms`);
  assert.equal(next.stalledMs, 2 * tickMs, 'a single unchanged-beat tick is capped at 2*tickMs regardless of the raw gap');
});

test('advanceStall: steady stalls (repeated unchanged-beat ticks) do exceed the threshold', () => {
  const tickMs = 100;
  const thresholdMs = 500;
  let state = { lastBeat: 1, lastTickNs: 0n, stalledMs: 0 };
  let crossed = false;
  for (let i = 1; i <= 10; i++) {
    const nowNs = BigInt(i * tickMs) * 1_000_000n;
    state = advanceStall(state, { nowNs, beat: 1, tickMs }); // beat never changes
    if (state.stalledMs > thresholdMs) { crossed = true; break; }
  }
  assert.equal(crossed, true, 'repeated unchanged-beat ticks must eventually cross the threshold');
});

test('advanceStall: a changed beat resets accumulated stall to zero', () => {
  const tickMs = 100;
  const prev = { lastBeat: 1, lastTickNs: 0n, stalledMs: 900 };
  const next = advanceStall(prev, { nowNs: 100_000_000n, beat: 2, tickMs });
  assert.equal(next.stalledMs, 0, 'a beat that advanced since the last tick must reset the stall');
  assert.equal(next.lastBeat, 2);
});

test('a decision posted without any host poll is visible on GET /api/step', async (t) => {
  // Bug being closed: the pre-fix /api/step adaptive branch returned
  // `noAgent` whenever AGENT_SEEN_AT === 0, even when TURN.phase ===
  // 'await_user' — hiding a decision the host already posted. Manually
  // reproduced against a copy of the pre-fix server for this plan's
  // acceptance run (designer/server/.old-server-check.mjs, deleted after);
  // not re-verified here every run to avoid re-copying that scratch file
  // into the tree on every test pass.
  const server = await spawnServer(t, {
    args: ['--drive', 'adaptive', '--context', 'a durable-turns no-poll test dashboard'],
  });

  const init = await server.get('/api/init');
  assert.equal(init.status, 200);

  // Build the contract from the durable STATE_FILE directly — never GET
  // /api/agent/contract, so AGENT_SEEN_AT stays 0 for this whole test.
  const built = engineNextStep(server.stateFile);
  assert.equal(built.action, 'PENDING_HOST', JSON.stringify(built));
  const candidate = built.contract.candidates[0];

  const answered = await server.post('/api/agent/answer', {
    ...built.contract,
    seq: 0,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'no-poll test' },
  });
  assert.equal(answered.status, 200);
  assert.equal(answered.json.ok, true, JSON.stringify(answered.json));
  assert.equal(answered.json.seq, 1);

  const start = Date.now();
  const step = await server.get('/api/step');
  const elapsedMs = Date.now() - start;
  assert.equal(step.status, 200);
  assert.equal(step.json.action, 'ask', JSON.stringify(step.json));
  assert.equal(step.json.seq, 1);
  assert.ok(elapsedMs < 1000, `expected GET /api/step under 1s, got ${elapsedMs}ms`);
});

test('a pick is still accepted after 10 minutes of host idle time', async (t) => {
  const server = await spawnServer(t, {
    args: ['--drive', 'adaptive', '--context', 'a clock-skew idle test dashboard'],
    preload: CLOCK_SKEW_PRELOAD,
  });

  await server.get('/api/init');
  const contract = await server.get('/api/agent/contract');
  assert.equal(contract.json.phase, 'await_agent');
  const candidate = contract.json.contract.candidates[0];

  const asked = await server.post('/api/agent/answer', {
    ...contract.json.contract,
    seq: contract.json.seq,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'idle test' },
  });
  assert.equal(asked.json.ok, true, JSON.stringify(asked.json));
  const liveSeq = asked.json.seq;

  // Jump the server process's clock forward 10 minutes (default agent
  // window is 120s) without sleeping for real minutes.
  server.proc.kill('SIGUSR2');
  await new Promise((r) => setTimeout(r, 100));

  const stepWhileIdle = await server.get('/api/step');
  assert.equal(stepWhileIdle.json.action, 'ask', JSON.stringify(stepWhileIdle.json));
  assert.equal(stepWhileIdle.json.seq, liveSeq);
  assert.equal(stepWhileIdle.json.agentAttached, false, 'agent window has elapsed');

  const options = candidate.options || [];
  const pick = await server.post('/api/pick', {
    category: candidate.id,
    option: options[0] && options[0].id,
    seq: liveSeq,
  });
  assert.equal(pick.status, 200);
  assert.notEqual(pick.json.stale, true, JSON.stringify(pick.json));
  assert.equal(pick.json.phase, 'await_agent', JSON.stringify(pick.json));

  // Window elapsed and no decision pending now — notice only, never a hide.
  const stepAfterPick = await server.get('/api/step');
  assert.equal(stepAfterPick.json.noAgent, true, JSON.stringify(stepAfterPick.json));
});

test('server restart resumes seq and history; a different --context does not resume', async (t) => {
  const dir = tempDir(t, 'groundwork-restart-');
  const stateFile = path.join(dir, 'state.json');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const context = 'a restart-resume test dashboard';
  const sameLaunchArgs = ['--drive', 'adaptive', '--context', context, '--out', outDir];
  const sameLaunchEnv = { GROUNDWORK_DESIGNER_STATE_FILE: stateFile };

  const first = await spawnServer(t, { args: sameLaunchArgs, env: sameLaunchEnv });
  await first.get('/api/init');

  // Decision 1: contract -> ask (seq 0 -> 1) -> pick (seq 1 -> 2, await_agent).
  let contract = await first.get('/api/agent/contract');
  let candidate = contract.json.contract.candidates[0];
  let asked = await first.post('/api/agent/answer', {
    ...contract.json.contract,
    seq: contract.json.seq,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'first decision' },
  });
  assert.equal(asked.json.ok, true, JSON.stringify(asked.json));
  const picked1 = await first.post('/api/pick', {
    category: candidate.id,
    option: (candidate.options || [])[0].id,
    seq: asked.json.seq,
  });
  assert.equal(picked1.json.phase, 'await_agent', JSON.stringify(picked1.json));

  // Decision 2: contract -> ask (seq 2 -> 3). This decision is left pending
  // (never picked) across the restart below.
  contract = await first.get('/api/agent/contract');
  candidate = contract.json.contract.candidates[0];
  asked = await first.post('/api/agent/answer', {
    ...contract.json.contract,
    seq: contract.json.seq,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'second decision' },
  });
  assert.equal(asked.json.ok, true, JSON.stringify(asked.json));
  assert.equal(asked.json.seq, 3);

  const histBeforeKill = historyLength(stateFile);
  const categoryBeforeKill = candidate.id;

  first.proc.kill('SIGKILL');
  await first.exited;

  // Relaunch with the SAME launch identity (context/out/name/drive/bootstrap)
  // and the same STATE_FILE, on a fresh ephemeral port.
  const resumed = await spawnServer(t, { args: sameLaunchArgs, env: sameLaunchEnv });
  const step = await resumed.get('/api/step');
  assert.equal(step.json.action, 'ask', JSON.stringify(step.json));
  assert.equal(step.json.seq, 3, 'resumed seq must equal the pre-kill live seq');
  assert.equal(step.json.decision.category_id, categoryBeforeKill);
  assert.equal(historyLength(stateFile), histBeforeKill, 'history length must survive the restart unchanged');

  const pickAfterResume = await resumed.post('/api/pick', {
    category: step.json.decision.category_id,
    option: (step.json.decision.options || [])[0].id,
    seq: step.json.seq,
  });
  assert.equal(pickAfterResume.status, 200);
  assert.notEqual(pickAfterResume.json.stale, true, JSON.stringify(pickAfterResume.json));
  assert.equal(historyLength(stateFile), histBeforeKill + 1, 'pick after resume must append exactly one history row');

  resumed.proc.kill('SIGKILL');
  await resumed.exited;

  // After the owner exits, a different --context is a different launch
  // identity and starts fresh. A simultaneous launch is refused separately.
  const differentContextArgs = ['--drive', 'adaptive', '--context', 'a totally different context', '--out', outDir];
  const fresh = await spawnServer(t, { args: differentContextArgs, env: sameLaunchEnv });
  const freshContract = await fresh.get('/api/agent/contract');
  assert.equal(freshContract.json.seq, 0, 'a different launch identity must start a fresh walk, not resume seq 3+');
});

test('adaptive_host_driver.py contract/answer CLIs match the live server response shapes', async (t) => {
  const server = await spawnServer(t, {
    args: ['--drive', 'adaptive', '--context', 'a driver round-trip test'],
  });
  await server.get('/api/init');

  const baseUrl = `http://127.0.0.1:${server.port}`;
  const runDriver = (cmd) => JSON.parse(execFileSync('python3', [DRIVER_CLI, '--url', baseUrl, ...cmd], {
    cwd: ROOT,
    env: { ...process.env, PYTHONPATH: ROOT },
    encoding: 'utf8',
  }));

  const contract = runDriver(['contract']);
  assert.equal(contract.phase, 'await_agent');
  assert.equal(typeof contract.seq, 'number');
  assert.ok(Array.isArray(contract.contract.candidates) && contract.contract.candidates.length > 0, JSON.stringify(contract).slice(0, 200));

  const candidate = contract.contract.candidates[0];
  const answerFile = path.join(server.dir, 'driver-answer.json');
  fs.writeFileSync(answerFile, JSON.stringify({
    ...contract.contract,
    seq: contract.seq,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'driver round trip' },
  }));

  const answered = runDriver(['answer', '--file', answerFile]);
  assert.equal(answered.ok, true, JSON.stringify(answered));
  assert.equal(answered.action, 'ask');
  assert.equal(answered.phase, 'await_user');
  assert.equal(answered.seq, contract.seq + 1);
});

test('watchdog kills a wedged event loop; disabled watchdog survives a transient block', async (t) => {
  // Part A: --watchdog-seconds 1 + a block that never releases -> the
  // process must exit within 10s (SIGTERM, or a non-zero exit code), and
  // log why. Wait for the watchdog's own startup log line before arming the
  // block (SIGUSR2), so the block can never race server startup.
  const blocked = await spawnServer(t, {
    args: ['--watchdog-seconds', '1'],
    preload: BLOCK_LOOP_PRELOAD,
  });
  await waitForMatches(blocked.stdout, /watchdog: \d/g, 1);
  blocked.proc.kill('SIGUSR2');
  const { code, signal } = await Promise.race([
    blocked.exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('did not exit within 10s')), 10000)),
  ]);
  assert.ok(
    signal === 'SIGTERM' || (code !== null && code !== 0),
    `expected SIGTERM or a non-zero exit code, got code=${code} signal=${signal}`,
  );
  assert.match(blocked.stderr(), /watchdog: event loop blocked/);

  // Part B: --watchdog-seconds 0 (disabled) + a block that releases after 3s
  // -> the process must stay up the whole time and keep serving requests.
  const notWatched = await spawnServer(t, {
    args: ['--watchdog-seconds', '0'],
    preload: BLOCK_LOOP_PRELOAD,
    env: { GROUNDWORK_TEST_BLOCK_FOR_MS: '3000' },
  });
  await waitForMatches(notWatched.stdout, /watchdog: off/g, 1);
  notWatched.proc.kill('SIGUSR2');
  let stayedAlive = true;
  notWatched.exited.then(() => { stayedAlive = false; });
  await new Promise((r) => setTimeout(r, 5000));
  assert.equal(stayedAlive, true, 'a disabled watchdog must never kill the process');
  const stillUp = await notWatched.get('/api/init');
  assert.equal(stillUp.status, 200);
});

// ── F2/F3: supervisor (run-supervised.sh) ───────────────────────────────────

test('supervisor restarts after a watchdog kill and the walk resumes', async (t) => {
  const sup = spawnSupervised(t, {
    args: ['--drive', 'adaptive', '--watchdog-seconds', '1', '--context', 'a supervised restart test'],
    env: { NODE_OPTIONS: `--require ${BLOCK_LOOP_PRELOAD}` },
  });

  const pidMatches1 = await waitForMatches(sup.stdout, /block-preload-pid:(\d+)/g, 1);
  const firstChildPid = Number(pidMatches1[0][1]);
  const portMatches1 = await waitForMatches(sup.stdout, /running at http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/g, 1);
  const port1 = Number(portMatches1[0][1]);

  await request(port1, 'GET', '/api/init');
  const contract = await request(port1, 'GET', '/api/agent/contract');
  const candidate = contract.json.contract.candidates[0];
  const asked = await request(port1, 'POST', '/api/agent/answer', {
    ...contract.json.contract,
    seq: contract.json.seq,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'supervised restart test' },
  });
  assert.equal(asked.json.ok, true, JSON.stringify(asked.json));
  assert.equal(asked.json.seq, 1);

  // Wedge the first child's event loop. The watchdog kills it (status > 128);
  // the supervisor must restart it, on a fresh ephemeral port.
  process.kill(firstChildPid, 'SIGUSR2');

  const portMatches2 = await waitForMatches(sup.stdout, /running at http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/g, 2);
  const port2 = Number(portMatches2[1][1]);
  assert.match(sup.stderr(), /watchdog: event loop blocked/);
  assert.match(sup.stderr(), /designer-server exited with status \d+; restarting \(1\)/);

  const pidMatches2 = await waitForMatches(sup.stdout, /block-preload-pid:(\d+)/g, 2);
  const secondChildPid = Number(pidMatches2[1][1]);
  assert.notEqual(secondChildPid, firstChildPid);

  // The restarted process must resume the posted decision at its live seq —
  // the durable-turns guarantee holding across a supervisor-driven restart.
  const step = await request(port2, 'GET', '/api/step');
  assert.equal(step.json.action, 'ask', JSON.stringify(step.json));
  assert.equal(step.json.seq, 1);

  // SIGTERM the supervisor: it must stop the loop AND the running child.
  sup.proc.kill('SIGTERM');
  const { code } = await sup.exited;
  assert.equal(code, 0);
  await new Promise((r) => setTimeout(r, 300));
  let childGone = false;
  try {
    process.kill(secondChildPid, 0);
  } catch (err) {
    childGone = err && err.code === 'ESRCH';
  }
  assert.equal(childGone, true, 'the node child must be gone once the supervisor exits');
});

test('supervisor does not restart on a deterministic failure (EADDRINUSE)', async (t) => {
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const port = holder.address().port;
  t.after(() => new Promise((resolve) => holder.close(resolve)));

  const sup = spawnSupervised(t, { args: ['--port', String(port)] });

  const { code, signal } = await Promise.race([
    sup.exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('supervisor did not exit within 10s')), 10000)),
  ]);
  assert.ok((code !== null && code !== 0) || signal, `expected a non-zero exit, got code=${code} signal=${signal}`);
  assert.doesNotMatch(sup.stderr(), /restarting/);
});

// ── F5: manual (non-bootstrap) session reload ───────────────────────────────

test('manual adaptive session route reflects a walk in progress; a fresh session routes to intro', async (t) => {
  const server = await spawnServer(t, {
    args: ['--drive', 'adaptive', '--context', 'a manual session route test'],
  });

  const freshSession = await server.get('/api/session');
  assert.equal(freshSession.json.route, 'intro', JSON.stringify(freshSession.json));
  assert.deepEqual(
    Object.keys(freshSession.json).sort(),
    ['bootstrapped', 'drive', 'mode', 'route', 'status'],
    'the manual session shape must never carry target/context/name — product paths never cross GET /api/session',
  );

  // GET /api/init alone (the picker's own boot call, or an agent probing the
  // walk) arms TURN at seq 0 / phase await_agent — that must still read as
  // "no walk yet", or every fresh adaptive session skips straight past the
  // intro/setup screen the moment anything polls /api/init.
  await server.get('/api/init');
  const afterInit = await server.get('/api/session');
  assert.equal(afterInit.json.route, 'intro', JSON.stringify(afterInit.json));

  const contract = await server.get('/api/agent/contract');
  const candidate = contract.json.contract.candidates[0];
  const asked = await server.post('/api/agent/answer', {
    ...contract.json.contract,
    seq: contract.json.seq,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'manual route test' },
  });
  assert.equal(asked.json.ok, true, JSON.stringify(asked.json));

  const session = await server.get('/api/session');
  assert.equal(session.json.route, 'next-unresolved', JSON.stringify(session.json));
  assert.deepEqual(
    Object.keys(session.json).sort(),
    ['bootstrapped', 'drive', 'mode', 'route', 'status'],
    'next-unresolved must be the intro shape with only route differing',
  );

  const freshServer = await spawnServer(t, {
    args: ['--drive', 'adaptive', '--context', 'a different manual session'],
  });
  const freshRoute = await freshServer.get('/api/session');
  assert.equal(freshRoute.json.route, 'intro', JSON.stringify(freshRoute.json));
});

// ── n1: GET /api/init must not re-initialize an in-progress walk ──────────

test('manual standard /api/init does not re-initialize a walk that already has picks', async (t) => {
  const server = await spawnServer(t, {
    args: ['--context', 'a manual init idempotence test'],
  });

  const init1 = await server.get('/api/init');
  assert.equal(init1.status, 200);
  const firstDecision = init1.json.step.decision;
  assert.ok(firstDecision, JSON.stringify(init1.json));
  const firstCategoryId = firstDecision.category_id;

  const pick1 = await server.post('/api/pick', {
    category: firstDecision.category_id,
    option: firstDecision.options[0].id,
  });
  assert.equal(pick1.status, 200);
  const secondDecision = pick1.json.step.decision;
  assert.ok(secondDecision, JSON.stringify(pick1.json));

  const pick2 = await server.post('/api/pick', {
    category: secondDecision.category_id,
    option: secondDecision.options[0].id,
  });
  assert.equal(pick2.status, 200);

  const histBeforeReinit = historyLength(server.stateFile);
  assert.equal(histBeforeReinit, 2, 'two accepted picks must append two history rows');

  // The bug: `if (!BOOTSTRAP || !STATE)` re-initialized STATE on every
  // manual-session /api/init call, silently wiping the walk (a page reload,
  // or the picker's own resume-branch boot call).
  const init2 = await server.get('/api/init');
  assert.equal(init2.status, 200);
  assert.equal(historyLength(server.stateFile), histBeforeReinit, 'a second /api/init must not wipe history');
  assert.notEqual(
    init2.json.step.decision?.category_id,
    firstCategoryId,
    'a second /api/init must not restart the walk from its first decision',
  );

  const step = await server.get('/api/step');
  assert.notEqual(
    step.json.decision?.category_id,
    firstCategoryId,
    '/api/step must not return the first decision again after a re-init',
  );
});

test('manual adaptive /api/init does not re-initialize an in-progress walk, across a restart', async (t) => {
  const dir = tempDir(t, 'groundwork-init-idempotence-');
  const stateFile = path.join(dir, 'state.json');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const context = 'a manual adaptive init idempotence test';
  const sameLaunchArgs = ['--drive', 'adaptive', '--context', context, '--out', outDir];
  const sameLaunchEnv = { GROUNDWORK_DESIGNER_STATE_FILE: stateFile };

  const first = await spawnServer(t, { args: sameLaunchArgs, env: sameLaunchEnv });

  // Decision 1: contract -> ask -> pick (accepted, back to await_agent).
  let contract = await first.get('/api/agent/contract');
  let candidate = contract.json.contract.candidates[0];
  let asked = await first.post('/api/agent/answer', {
    ...contract.json.contract,
    seq: contract.json.seq,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'first decision' },
  });
  assert.equal(asked.json.ok, true, JSON.stringify(asked.json));
  const picked1 = await first.post('/api/pick', {
    category: candidate.id,
    option: (candidate.options || [])[0].id,
    seq: asked.json.seq,
  });
  assert.equal(picked1.json.phase, 'await_agent', JSON.stringify(picked1.json));

  // Decision 2: contract -> ask. Left pending (never picked).
  contract = await first.get('/api/agent/contract');
  candidate = contract.json.contract.candidates[0];
  asked = await first.post('/api/agent/answer', {
    ...contract.json.contract,
    seq: contract.json.seq,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'second decision' },
  });
  assert.equal(asked.json.ok, true, JSON.stringify(asked.json));

  const histBeforeInit = historyLength(stateFile);
  assert.equal(histBeforeInit, 1, 'one accepted pick must append one history row');
  const liveSeq = asked.json.seq;

  const init = await first.get('/api/init');
  assert.equal(init.status, 200);
  assert.equal(historyLength(stateFile), histBeforeInit, 'a manual /api/init must not wipe an in-progress adaptive walk');
  const stepAfterInit = await first.get('/api/step');
  assert.equal(stepAfterInit.json.seq, liveSeq, '/api/step after /api/init must still show the live pending decision');

  first.proc.kill('SIGKILL');
  await first.exited;

  const resumed = await spawnServer(t, { args: sameLaunchArgs, env: sameLaunchEnv });
  const resumedInit = await resumed.get('/api/init');
  assert.equal(resumedInit.status, 200);
  assert.equal(historyLength(stateFile), histBeforeInit, 'a restart followed by /api/init must not wipe history either');
  const resumedStep = await resumed.get('/api/step');
  assert.equal(resumedStep.json.seq, liveSeq);
  assert.equal(resumedStep.json.decision.category_id, candidate.id);
});

test('a failed session write returns 503 and stops before acknowledging the walk', async (t) => {
  const stateDirectory = tempDir(t, 'groundwork-unwritable-state-');
  const server = await spawnServer(t, {
    args: ['--context', 'write failure'],
    env: { GROUNDWORK_DESIGNER_STATE_FILE: stateDirectory },
  });
  const init = await server.get('/api/init');
  assert.equal(init.status, 503);
  assert.equal(init.json.ok, false);
  assert.match(init.json.error, /could not save/);
  assert.equal((await server.exited).code, 2);
  assert.equal(fs.statSync(stateDirectory).isDirectory(), true);
});
