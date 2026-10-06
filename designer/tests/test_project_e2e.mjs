// test_project_e2e.mjs — C10 acceptance (T-13): restart persistence of the
// Groundwork project store. Temp repo with legacy sources; start (startup
// migration) -> write in every section over HTTP + the CLI -> hash .groundwork/
// -> kill -9 -> restart -> every hash identical, API returns everything, legacy
// files untouched, and POST /api/snapshot byte-equals the store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER = path.join(ROOT, 'designer', 'project', 'project-server.mjs');
const DEMO_DIR = path.join(ROOT, 'designer', 'decisions', 'fixtures', 'compare-demo');
const SECTIONS = ['decisions', 'canvas', 'saved-work', 'spec', 'memory', 'general'];
const RULING_TEXT = 'Réviser le titre — 日本語のメモ ✓ café';
const BOARD_TEXT = 'Überarbeitet: “Größe” ≠ 大きさ ✓';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const pyEnv = () => ({ ...process.env, PYTHONPATH: ROOT });

function reservePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function waitUntil(check, message, attempts = 200, step = 50) {
  for (let i = 0; i < attempts; i += 1) { if (await check()) return; await delay(step); }
  throw new Error(message);
}

function walk(dir, skip = () => false, base = dir, out = new Map()) {
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (skip(rel)) continue;
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) { out.set(rel + '/', 'dir'); walk(abs, skip, base, out); } else out.set(rel, sha(fs.readFileSync(abs)));
  }
  return out;
}

const storeSkip = (rel) => rel === 'server.json' || rel === 'write.lock' || rel === 'snapshots' || rel.startsWith('snapshots/');
const hashStore = (repo) => walk(path.join(repo, '.groundwork'), (rel) => rel === 'server.json' || rel === 'write.lock');

function legacyHashes(repo) {
  const out = new Map();
  const dd = path.join(repo, '.designdoc');
  for (const [rel, h] of walk(dd)) out.set(`.designdoc/${rel}`, h);
  return out;
}

function py(repo, args) {
  const r = spawnSync('python3', ['-m', 'designer.project', ...args, '--repo', repo], { cwd: ROOT, env: pyEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, `designer.project ${args.join(' ')} failed: ${r.stderr}${r.stdout}`);
  return r.stdout;
}

async function startServer(repo) {
  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER, '--repo', repo, '--port', String(port)], {
    cwd: ROOT, env: pyEnv(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (c) => { logs += c; });
  child.stderr.on('data', (c) => { logs += c; });
  await waitUntil(() => {
    if (child.exitCode !== null) throw new Error(`server exited: ${logs}`);
    return /Groundwork project: http:\/\/localhost:\d+\//.test(logs);
  }, 'project server did not start');
  const url = logs.match(/Groundwork project: (http:\/\/localhost:\d+)\//)[1];
  const call = async (method, p, body) => {
    const init = { method, headers: {} };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = typeof body === 'string' ? body : JSON.stringify(body); }
    const res = await fetch(url + p, init);
    const raw = await res.text();
    let json = null; try { json = JSON.parse(raw); } catch { /* not json */ }
    return { status: res.status, raw, json };
  };
  return { child, url, call, logs: () => logs };
}

function makeRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-project-e2e-')));
  const board = path.join(repo, '.designdoc', 'demo');
  fs.cpSync(DEMO_DIR, board, { recursive: true });
  const rec = JSON.parse(fs.readFileSync(path.join(board, 'decisions.json'), 'utf8'));
  rec.compares[0].ruling = 'revise-b';
  rec.compares[0].rulingText = RULING_TEXT;
  rec.compares[0].ruledAt = '2026-10-01T12:00:00.000Z';
  fs.writeFileSync(path.join(board, 'decisions.json'), JSON.stringify(rec, null, 2) + '\n');
  const wsDir = path.join(repo, '.designdoc', '.groundwork-workspace');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, 'workspace.json'), JSON.stringify({
    version: 1, notes: [{ id: 'legacy-note', text: 'Legacy designer note — ✓', status: 'received', createdAt: '2026-09-30T08:00:00.000Z' }],
    alternatives: [
      { id: 'alt-a', rationale: 'Legacy A', createdAt: '2026-09-30T09:00:00.000Z' },
      { id: 'alt-b', rationale: 'Legacy B', createdAt: '2026-09-30T10:00:00.000Z' },
    ],
    selectedId: 'alt-a', sources: [],
  }, null, 2) + '\n');
  return repo;
}

test('project store survives kill -9 + restart byte-for-byte; snapshot equals the store', async (t) => {
  const repo = makeRepo();
  const legacyBefore = legacyHashes(repo);
  assert.ok(legacyBefore.size >= 4, 'legacy fixture is populated');
  let srv = await startServer(repo);
  t.after(async () => {
    for (const s of [srv]) if (s && s.child.exitCode === null) s.child.kill('SIGKILL');
    fs.rmSync(repo, { recursive: true, force: true });
  });

  // ---- startup migration ran: legacy board + workspace are in the store ----
  let snap = (await srv.call('GET', '/api/project')).json;
  assert.ok(fs.existsSync(path.join(repo, '.groundwork', 'decisions', 'demo', 'decisions.json')), 'board not migrated');
  assert.ok(fs.existsSync(path.join(repo, '.groundwork', 'workspace.json')), 'workspace not migrated');
  assert.ok(snap.sections.decisions.some((b) => b.slug === 'demo' && !b.legacy), 'migrated board still flagged legacy');
  const migratedItem = snap.sections.decisions.find((b) => b.slug === 'demo').items.find((i) => i.ruling === 'revise-b');
  assert.equal(migratedItem.note, RULING_TEXT, 'non-ASCII ruling text lost in migration');

  // ---- write in every section over HTTP: draft + submit ----------------------
  const written = {};
  for (const section of SECTIONS) {
    const id = `fb_e2e_${section.replace('-', '_')}`;
    const draft = `Draft for ${section} — naïve ✓`;
    const put = await srv.call('PUT', `/api/feedback/${id}`, { section, text: draft, target: null });
    assert.equal(put.status, 200, put.raw);
    const sub = await srv.call('POST', `/api/feedback/${id}/submit`, { text: `Sent for ${section} — 日本語 ✓` });
    assert.equal(sub.status, 200, sub.raw);
    written[id] = { section, text: `Sent for ${section} — 日本語 ✓`, status: 'submitted' };
  }
  // One draft left unsent per the pane's draft-then-Done flow.
  assert.equal((await srv.call('PUT', '/api/feedback/fb_e2e_left_draft', { section: 'spec', text: 'Unsent draft ✎', target: null })).status, 200);
  written.fb_e2e_left_draft = { section: 'spec', text: 'Unsent draft ✎', status: 'draft' };

  // preference, workspace select, board PUT
  const pref = await srv.call('POST', '/api/preferences', { text: 'Prefer calm density — ✓', scope: 'repo' });
  assert.equal(pref.status, 200, pref.raw);
  assert.equal((await srv.call('POST', '/api/workspace/select', { id: 'alt-b' })).status, 200);
  const board = (await srv.call('GET', '/decisions/demo/record.json')).json;
  board.compares[0].rulingText = BOARD_TEXT;
  board.compares[0].ruledAt = '2026-10-02T09:30:00.000Z';
  assert.equal((await srv.call('PUT', '/decisions/demo/record.json', JSON.stringify(board, null, 2) + '\n')).status, 200);

  // CLI write (shares the same lock and store)
  py(repo, ['feedback', '--section', 'general', '--text', 'CLI note — ünï ✓', '--json']);
  py(repo, ['feedback', '--section', 'memory', '--text', 'CLI draft ✎', '--draft', '--json']);

  // ---- state before the crash --------------------------------------------------
  const before = hashStore(repo);
  for (const required of ['project.json', 'workspace.json', 'decisions/demo/decisions.json']) {
    assert.ok(before.has(required), `${required} missing from the store`);
  }
  const apiBefore = (await srv.call('GET', '/api/project')).json;
  const boardBytesBefore = (await srv.call('GET', '/decisions/demo/record.json')).raw;
  assert.ok(apiBefore.feedback.some((f) => f.text === 'CLI note — ünï ✓' && f.status === 'submitted'));
  assert.ok(apiBefore.feedback.some((f) => f.text === 'CLI draft ✎' && f.status === 'draft'));

  // ---- kill -9, restart ---------------------------------------------------------
  const killed = srv.child;
  killed.kill('SIGKILL');
  await new Promise((resolve) => (killed.exitCode !== null || killed.signalCode ? resolve() : killed.once('exit', resolve)));
  assert.equal(killed.signalCode, 'SIGKILL');
  srv = await startServer(repo);

  // ---- every hash identical ---------------------------------------------------------
  const after = hashStore(repo);
  assert.deepEqual([...after], [...before], '.groundwork/ changed across kill -9 + restart');

  // ---- the API returns all of it -----------------------------------------------------
  const apiAfter = (await srv.call('GET', '/api/project')).json;
  const strip = (s) => { const c = structuredClone(s); delete c.warnings; delete c.generatedAt; return c; };
  assert.deepEqual(strip(apiAfter), strip(apiBefore), 'GET /api/project changed across restart');
  for (const [id, w] of Object.entries(written)) {
    const f = apiAfter.feedback.find((x) => x.id === id);
    assert.ok(f, `feedback ${id} lost`);
    assert.equal(f.text, w.text);
    assert.equal(f.status, w.status);
    assert.equal(f.section, w.section);
  }
  assert.ok(apiAfter.feedback.some((f) => f.text === 'CLI note — ünï ✓' && f.status === 'submitted'));
  assert.ok(apiAfter.feedback.some((f) => f.text === 'CLI draft ✎' && f.status === 'draft'));
  assert.ok(apiAfter.sections.memory.preferences.some((p) => p.text === 'Prefer calm density — ✓' && p.status === 'active'));
  assert.equal(apiAfter.sections.savedWork.selectedId, 'alt-b');
  assert.equal(apiAfter.sections.savedWork.alternatives.length, 2);
  assert.ok(apiAfter.feedback.some((f) => f.id === 'legacy-note'), 'legacy designer note not projected');
  const demo = apiAfter.sections.decisions.find((b) => b.slug === 'demo');
  assert.equal(demo.items.find((i) => i.ruling === 'revise-b').note, BOARD_TEXT);
  assert.equal((await srv.call('GET', '/decisions/demo/record.json')).raw, boardBytesBefore);
  const cli = JSON.parse(py(repo, ['read', '--json']));
  assert.ok(JSON.stringify(cli).includes('Sent for canvas — 日本語 ✓'), 'CLI read lacks a written note after restart');

  // ---- legacy files byte-unchanged -----------------------------------------------------
  assert.deepEqual([...legacyHashes(repo)], [...legacyBefore], 'a legacy file was modified, added or removed');

  // ---- snapshot dir byte-equals the store ------------------------------------------------
  const snapRes = await srv.call('POST', '/api/snapshot', {});
  assert.equal(snapRes.status, 200, snapRes.raw);
  const snapDir = snapRes.json.path;
  assert.ok(fs.statSync(snapDir).isDirectory());
  assert.ok(snapDir.startsWith(path.join(repo, '.groundwork', 'snapshots')), snapDir);
  const storeNow = walk(path.join(repo, '.groundwork'), storeSkip);
  const snapNow = walk(snapDir);
  assert.deepEqual([...snapNow], [...storeNow], 'snapshot differs from the store');
});
