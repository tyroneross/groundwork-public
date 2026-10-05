// test_stale_seq.mjs — f1 closure: stale-seq rejection at the live endpoints.
//
// Boots the real zero-dep designer-server in adaptive mode on an ephemeral port,
// drives the agent handshake to advance TURN.seq, then POSTs a STALE seq to both
// mutating endpoints (/api/agent/answer and /api/pick) and asserts:
//   - the response is { ok:false, stale:true, seq:<live> }
//   - the persisted history length is UNCHANGED (no delta re-merged, no dup row)
//
// Zero new deps: node:test + node:http + child_process, all stdlib (Node 22).
// Run: node --test designer/tests/test_stale_seq.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // the UI Guidance repo
const SERVER = path.join(ROOT, 'designer', 'server', 'designer-server.mjs');

const PORT = 8917; // ephemeral-ish; loopback only

// Each spawned server below gets its OWN state file in a fresh temp dir via
// GROUNDWORK_DESIGNER_STATE_FILE (f4 closure) — the server never writes to
// ROOT/.designer-state.json (its default is <TARGET>/.designer-state.json,
// and TARGET here is the scratch output dir), so a hardcoded shared path
// made readHistoryLen() read a file the server never touched, and every
// "history unchanged" assertion passed vacuously against an always-empty
// read. CURRENT_STATE_FILE is reassigned per test (tests run sequentially,
// --test-concurrency=1) so readHistoryLen() always reads the file the
// currently-running test's server actually owns.
let CURRENT_STATE_FILE = null;

function tempStateFile(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });
  return path.join(dir, 'state.json');
}

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: urlPath,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, json: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, json: null, raw: buf });
          }
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await req('GET', '/api/init');
      if (res.status && res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start in time');
}

function readHistoryLen(stateFile = CURRENT_STATE_FILE) {
  try {
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return Array.isArray(st.history) ? st.history.length : 0;
  } catch {
    return 0;
  }
}

function ownerPidOf(stateFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return parsed.groundwork_server?.owner?.pid ?? null;
  } catch {
    return null;
  }
}

// Generic request helper bound to a specific port — used by the f4/n2
// concurrent-owner tests, which each run two servers on two ports at once.
function httpCall(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {},
    }, (res) => {
      let buf = '';
      res.on('data', (chunk) => (buf += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null }); }
        catch { resolve({ status: res.statusCode, json: null, raw: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// `--port 0` (ephemeral, OS-assigned) rather than a hardcoded port: a fixed
// port in this range can collide with an unrelated long-running process on a
// shared dev machine (reproduced locally against a stray canvas-server
// instance), which looks exactly like this test's own false negative. Port
// is parsed from the server's own startup line.
function spawnOnStateFile(t, args, stateFile) {
  let stdoutBuf = '';
  let stderrBuf = '';
  const proc = spawn('node', [SERVER, ...args, '--port', '0'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GROUNDWORK_DESIGNER_STATE_FILE: stateFile },
  });
  proc.stdout.on('data', (b) => { stdoutBuf += b; });
  proc.stderr.on('data', (b) => { stderrBuf += b; });
  t.after(() => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } });
  const exited = new Promise((resolve) => { proc.once('exit', (code, signal) => resolve({ code, signal })); });
  const port = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start in time:\n${stdoutBuf}${stderrBuf}`)), 8000);
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${stderrBuf}`)); });
    const onData = () => {
      const m = stdoutBuf.match(/running at http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
      if (m) { clearTimeout(timer); proc.stdout.off('data', onData); resolve(Number(m[1])); }
    };
    proc.stdout.on('data', onData);
    onData();
  });
  return { proc, port, exited, stdout: () => stdoutBuf, stderr: () => stderrBuf };
}

test('stale seq is rejected at /api/pick and /api/agent/answer; history unchanged', async (t) => {
  CURRENT_STATE_FILE = tempStateFile(t, 'groundwork-stale-seq-');

  // Boot the server in adaptive mode.
  const proc = spawn(
    'node',
    [SERVER, '--drive', 'adaptive', '--context', 'a productivity dashboard', '--port', String(PORT)],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GROUNDWORK_DESIGNER_STATE_FILE: CURRENT_STATE_FILE },
    },
  );
  t.after(() => {
    proc.kill('SIGKILL');
  });

  await waitForServer();

  // Arm adaptive + get the opening contract (phase becomes await_agent, seq=0).
  const contract = await req('GET', '/api/agent/contract');
  assert.equal(contract.status, 200);
  assert.match(contract.headers['content-security-policy'], /script-src 'self'/);
  assert.match(contract.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(contract.headers['x-frame-options'], 'DENY');
  const pickerSource = fs.readFileSync(path.join(ROOT, 'designer', 'server', 'picker.js'), 'utf8');
  assert.equal(pickerSource.includes('.innerHTML'), false, 'dynamic HTML must pass through the sanitizer');
  assert.match(pickerSource, /function setSanitizedHtml/);
  assert.match(pickerSource, /function setIsolatedMockup/);
  assert.match(pickerSource, /iframe\.setAttribute\('sandbox', ''\)/);
  assert.match(pickerSource, /default-src \\'none\\'/);
  assert.equal(contract.json.phase, 'await_agent');
  const seq0 = contract.json.seq;
  assert.equal(typeof seq0, 'number');

  // Agent answers "ask" for the first candidate -> phase await_user, seq advances.
  const cand = contract.json.contract.candidates[0];
  const answer = {
    ...contract.json.contract,
    answer: { action: 'ask', chosen_category_id: cand.id, rationale: 'stale-seq test' },
    seq: seq0,
  };
  const asked = await req('POST', '/api/agent/answer', answer);
  assert.equal(asked.status, 200);
  assert.equal(asked.json.ok, true, JSON.stringify(asked.json));
  const liveSeq = asked.json.seq; // = seq0 + 1
  assert.equal(liveSeq, seq0 + 1);

  const histBefore = readHistoryLen();

  // 1) STALE /api/pick with the OLD seq must be rejected, not applied.
  const stalePick = await req('POST', '/api/pick', {
    category: cand.id,
    option: cand.options ? (cand.options[0] && cand.options[0].id) : undefined,
    seq: liveSeq - 1,
  });
  assert.equal(stalePick.status, 200);
  assert.equal(stalePick.json.stale, true, 'stale pick must be flagged');
  assert.equal(stalePick.json.ok, false);
  assert.equal(stalePick.json.seq, liveSeq, 'response echoes the live seq');

  // 2) STALE /api/agent/answer with the OLD seq must be rejected too.
  const staleAnswer = await req('POST', '/api/agent/answer', {
    ...answer,
    answer: { action: 'infer', rationale: 'stale infer' },
    seq: liveSeq - 1,
  });
  assert.equal(staleAnswer.status, 200);
  assert.equal(staleAnswer.json.stale, true, 'stale answer must be flagged');
  assert.equal(staleAnswer.json.ok, false);
  assert.equal(staleAnswer.json.seq, liveSeq);

  // History must be UNCHANGED — neither stale mutation re-merged a delta or
  // appended a duplicate history row.
  const histAfter = readHistoryLen();
  assert.equal(histAfter, histBefore, 'history length must not change on stale rejection');

  // Control: a CURRENT-seq pick is accepted (proves the guard is seq-specific,
  // not a blanket reject).
  const freshPick = await req('POST', '/api/pick', {
    category: cand.id,
    option: cand.options ? (cand.options[0] && cand.options[0].id) : undefined,
    seq: liveSeq,
  });
  assert.equal(freshPick.status, 200);
  assert.notEqual(freshPick.json.stale, true, 'current-seq pick must NOT be flagged stale');
  // Non-vacuous check that CURRENT_STATE_FILE is the file the server is
  // actually writing to: the accepted pick above must append exactly one
  // history row on top of the unchanged-by-stale-rejections baseline.
  assert.equal(readHistoryLen(), histBefore + 1, 'an accepted pick must append exactly one history row');
});

test('a successful infer advances seq; a replayed infer is rejected (no re-merge)', async (t) => {
  // Closure for the infer-no-bump gap: infer MUTATES state (records an inferred
  // pick), so it must advance TURN.seq, and a duplicate/late re-delivery of the
  // SAME infer answer (now carrying a stale seq) must be rejected — otherwise it
  // re-merges the inferred delta over an already-determined dimension.
  const PORT2 = 8918;
  CURRENT_STATE_FILE = tempStateFile(t, 'groundwork-stale-seq-infer-');
  const proc = spawn(
    'node',
    [SERVER, '--drive', 'adaptive', '--context', 'a productivity dashboard', '--port', String(PORT2)],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GROUNDWORK_DESIGNER_STATE_FILE: CURRENT_STATE_FILE },
    },
  );
  t.after(() => proc.kill('SIGKILL'));

  // Local request helper bound to PORT2.
  const req2 = (method, urlPath, body) =>
    new Promise((resolve, reject) => {
      const data = body !== undefined ? JSON.stringify(body) : null;
      const r = http.request(
        {
          host: '127.0.0.1',
          port: PORT2,
          path: urlPath,
          method,
          headers: data
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            : {},
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null }));
        },
      );
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });

  // Wait for boot.
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      const res = await req2('GET', '/api/init');
      if (res.status && res.status < 500) break;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const contract = await req2('GET', '/api/agent/contract');
  const seq0 = contract.json.seq;
  const fullContract = contract.json.contract;

  // Successful infer: engine auto-applies a pick and (post-fix) advances seq.
  const inferAnswer = { ...fullContract, answer: { action: 'infer', rationale: 'first infer' }, seq: seq0 };
  const inferred = await req2('POST', '/api/agent/answer', inferAnswer);
  assert.equal(inferred.json.ok, true, JSON.stringify(inferred.json));
  assert.equal(inferred.json.action, 'infer');
  assert.equal(typeof inferred.json.seq, 'number', 'infer response must carry a seq');
  assert.equal(inferred.json.seq, seq0 + 1, 'infer must advance seq monotonically');

  const histBefore = readHistoryLen();

  // Replay the SAME infer at the now-stale seq — must be rejected.
  const replay = await req2('POST', '/api/agent/answer', { ...inferAnswer, seq: seq0 });
  assert.equal(replay.json.stale, true, 'replayed infer at stale seq must be rejected');
  assert.equal(replay.json.ok, false);
  assert.equal(replay.json.seq, seq0 + 1, 'response echoes the live seq');

  const histAfter = readHistoryLen();
  assert.equal(histAfter, histBefore, 'replayed infer must not re-merge / append history');
});

test('existing-product mode separates inspected repo from .designdoc output', async (t) => {
  const port = 8919;
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-existing-product-'));
  const proc = spawn(
    'node',
    [SERVER, '--context', 'evolve an existing product', '--port', String(port)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  t.after(() => {
    proc.kill('SIGKILL');
    fs.rmSync(repo, { recursive: true, force: true });
  });

  const request = (method, urlPath, body) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const r = http.request({
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      }, (res) => {
        let buf = '';
        res.on('data', (chunk) => (buf += chunk));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(buf) }));
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });

  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await request('GET', '/api/init');
      if (response.status < 500) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const mode = await request('POST', '/api/mode', {
    mode: 'product',
    repoPath: repo,
    context: 'preserve the current app and evolve its UI',
  });
  assert.equal(mode.status, 200);
  assert.equal(mode.json.repoPath, repo);
  assert.equal(mode.json.target, path.join(repo, '.designdoc'));

  const escapedOutput = await request('POST', '/api/mode', {
    mode: 'product',
    repoPath: repo,
    outDir: repo,
  });
  assert.equal(escapedOutput.status, 400);
  assert.match(escapedOutput.json.error, /\.designdoc/);

  await request('POST', '/api/mode', {
    mode: 'product',
    repoPath: repo,
    context: 'preserve the current app and evolve its UI',
  });

  const initialized = await request('GET', '/api/init');
  assert.equal(initialized.json.repoPath, repo);
  assert.equal(initialized.json.out, path.join(repo, '.designdoc'));
  const emitted = await request('POST', '/api/emit', {});
  assert.equal(emitted.status, 200);
  assert.equal(fs.existsSync(path.join(repo, '.designdoc', 'design-tokens.md')), true);
  assert.equal(fs.existsSync(path.join(repo, 'DESIGN.md')), false);
});

// ── f4: concurrent owners of the same state file ────────────────────────────

test('a fresh state path has one owner before any walk is saved', async (t) => {
  const stateFile = tempStateFile(t, 'groundwork-fresh-owner-');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-fresh-owner-out-'));
  t.after(() => { try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best-effort */ } });
  const args = ['--context', 'a fresh owner test', '--out', outDir, '--drive', 'adaptive'];

  const first = spawnOnStateFile(t, args, stateFile);
  await first.port;
  assert.equal(fs.existsSync(stateFile), false);

  const second = spawnOnStateFile(t, args, stateFile);
  await assert.rejects(second.port, /server exited 2/);
  assert.match(second.stderr(), /another server owns/);

  first.proc.kill('SIGKILL');
  await first.exited;
  const restarted = spawnOnStateFile(t, args, stateFile);
  await restarted.port;
});

test('a competing launch cannot erase a posted turn after the first owner exits', async (t) => {
  const stateFile = tempStateFile(t, 'groundwork-concurrent-owner-');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-concurrent-owner-out-'));
  t.after(() => { try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* best-effort */ } });
  const sameArgs = ['--context', 'a concurrent owner test', '--out', outDir, '--drive', 'adaptive'];

  const call = (port, method, urlPath, body) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const r = http.request({
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      }, (res) => {
        let buf = '';
        res.on('data', (chunk) => (buf += chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null }); }
          catch { resolve({ status: res.statusCode, json: null, raw: buf }); }
        });
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });

  // `--port 0` (ephemeral, OS-assigned) rather than a hardcoded port: a
  // fixed port in this range can collide with an unrelated long-running
  // process on a shared dev machine (reproduced locally against a stray
  // canvas-server instance), which looks exactly like this test's own
  // false negative. Port is parsed from the server's own startup line.
  function spawnServerOnStateFile(t2) {
    let stdoutBuf = '';
    let stderrBuf = '';
    const proc = spawn('node', [SERVER, ...sameArgs, '--port', '0'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GROUNDWORK_DESIGNER_STATE_FILE: stateFile },
    });
    proc.stdout.on('data', (b) => { stdoutBuf += b; });
    proc.stderr.on('data', (b) => { stderrBuf += b; });
    t2.after(() => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } });
    const port = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start in time:\n${stdoutBuf}${stderrBuf}`)), 8000);
      proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${stderrBuf}`)); });
      const onData = () => {
        const m = stdoutBuf.match(/running at http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        if (m) { clearTimeout(timer); proc.stdout.off('data', onData); resolve(Number(m[1])); }
      };
      proc.stdout.on('data', onData);
      onData();
    });
    return { proc, port, stdout: () => stdoutBuf, stderr: () => stderrBuf };
  }

  // A posts a decision and owns the durable state file.
  const a = spawnServerOnStateFile(t);
  const portA = await a.port;
  await call(portA, 'GET', '/api/init');
  const contractA = await call(portA, 'GET', '/api/agent/contract');
  const candidate = contractA.json.contract.candidates[0];
  const asked = await call(portA, 'POST', '/api/agent/answer', {
    ...contractA.json.contract,
    seq: contractA.json.seq,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'keep this turn' },
  });
  assert.equal(asked.json.seq, 1);

  // B must exit instead of opening a fresh walk against A's state file.
  const b = spawnServerOnStateFile(t);
  await assert.rejects(b.port, /server exited 2/);
  assert.equal(ownerPidOf(stateFile), a.proc.pid);
  assert.match(b.stderr(), /Not starting: another server owns/);

  const aExited = new Promise((resolve) => a.proc.once('exit', resolve));
  a.proc.kill('SIGKILL');
  await aExited;
  const resumed = spawnServerOnStateFile(t);
  const step = await call(await resumed.port, 'GET', '/api/step');
  assert.equal(step.json.action, 'ask');
  assert.equal(step.json.seq, 1);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).groundwork_server.turn.phase, 'await_user');
});
