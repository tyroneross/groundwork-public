// test_project_server.mjs — C8 acceptance (T-08, T-11) for
// designer/project/project-server.mjs. Every test spawns the real server
// against a temp repo with synthetic data. Python CLI calls are redirected via
// GROUNDWORK_PYTHON (path to an executable used instead of python3) to a stub
// script that records its argv/cwd/PYTHONPATH, because the real
// `python3 -m designer.project migrate|snapshot` CLI ships in a later chunk.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { defaultPort } from '../project/project-server.mjs';

const INSTALL = path.resolve(import.meta.dirname, '../..');
const SERVER = path.join(INSTALL, 'designer/project/project-server.mjs');
const DEMO = path.join(INSTALL, 'designer/decisions/fixtures/compare-demo/decisions.json');

function tempRepo(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-project-server-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function addBoard(repo, slug, { legacy = false } = {}) {
  const dir = legacy ? path.join(repo, '.designdoc', slug) : path.join(repo, '.groundwork', 'decisions', slug);
  fs.mkdirSync(path.join(dir, 'visuals'), { recursive: true });
  fs.copyFileSync(DEMO, path.join(dir, 'decisions.json'));
  fs.writeFileSync(path.join(dir, 'visuals', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, 'visuals', 'wire.html'), '<p>wire</p>');
  return dir;
}

// Stub for GROUNDWORK_PYTHON: logs argv/cwd/PYTHONPATH as one JSON line, then
// prints `out` and exits `code`.
function pyStub(dir, { code = 0, out = '{}' } = {}) {
  const log = path.join(dir, 'stub-calls.jsonl');
  const file = path.join(dir, `py-stub-${code}.mjs`);
  fs.writeFileSync(file, `#!${process.execPath}
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({argv: process.argv.slice(2), cwd: process.cwd(), pythonpath: process.env.PYTHONPATH}) + '\\n');
process.stdout.write(${JSON.stringify(out)});
process.exit(${code});
`, { mode: 0o755 });
  return { file, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []) };
}

function run(repo, { args = ['--no-migrate'], env = {} } = {}) {
  const child = spawn(process.execPath, [SERVER, '--repo', repo, ...args], {
    cwd: INSTALL, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; let err = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { err += b; });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', () => {
      const m = out.match(/Groundwork project: (http:\/\/localhost:(\d+)\/)/);
      if (m) resolve({ url: m[1], port: Number(m[2]) });
    });
    exited.then(({ code }) => reject(new Error(`server exited ${code}: ${out}${err}`)));
    setTimeout(() => reject(new Error(`server did not start: ${out}${err}`)), 15000).unref();
  });
  return { child, ready, exited, output: () => out + err };
}

async function start(t, repo, opts) {
  const s = run(repo, opts);
  t.after(() => { if (s.child.exitCode === null && s.child.signalCode === null) s.child.kill('SIGKILL'); });
  const { url, port } = await s.ready;
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, route, body, headers = {}) => {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
      if (!has(init.headers, 'Content-Type')) init.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(base + route, { ...init, redirect: 'manual' });
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, buf, json };
  };
  return { ...s, url, port, base, call };
}
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = ''; res.on('data', (b) => { body += b; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function treeHashes(dir, skip = new Set(['server.json', 'write.lock'])) {
  const out = {};
  const walk = (d, rel) => {
    for (const n of fs.readdirSync(d).sort()) {
      if (rel === '' && skip.has(n)) continue;
      const abs = path.join(d, n); const r = rel ? `${rel}/${n}` : n;
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) walk(abs, r);
      else out[r] = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out;
}

// ── T-08 ─────────────────────────────────────────────────────────────────────

test('defaultPort is deterministic, in range, and keyed on the realpath', (t) => {
  const repo = tempRepo(t);
  const p = defaultPort(repo);
  assert.equal(p, defaultPort(repo));
  assert.ok(p >= 41000 && p < 43000);
  const h = createHash('sha256').update(fs.realpathSync(repo)).digest('hex');
  assert.equal(p, 41000 + (parseInt(h.slice(0, 8), 16) % 2000));
  const link = path.join(tempRepo(t), 'link');
  fs.symlinkSync(repo, link);
  assert.equal(defaultPort(link), p);
});

test('health, deterministic port, single instance, server.json lifecycle', async (t) => {
  const repo = tempRepo(t);
  const s = await start(t, repo);
  assert.equal(s.port, defaultPort(repo));
  const h = await s.call('GET', '/api/health');
  assert.deepEqual(h.json, { ok: true, root: repo, pid: s.child.pid, port: s.port, schema: 'groundwork.project/v1' });
  const info = JSON.parse(fs.readFileSync(path.join(repo, '.groundwork/server.json'), 'utf8'));
  assert.equal(info.pid, s.child.pid); assert.equal(info.port, s.port); assert.equal(info.repo, repo);
  assert.equal(fs.existsSync(path.join(repo, '.groundwork/write.lock')), false);

  // Second serve on the same repo: prints the same URL, exits 0, no second listener.
  const second = run(repo);
  const { url } = await second.ready;
  assert.equal(url, s.url);
  assert.deepEqual(await second.exited, { code: 0, signal: null });
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, '.groundwork/server.json'), 'utf8')).pid, s.child.pid);

  // Pane static allowlist from the install; nothing else.
  const idx = await s.call('GET', '/');
  assert.equal(idx.status, 200);
  assert.equal(idx.buf.toString(), fs.readFileSync(path.join(INSTALL, 'designer/project/app/index.html'), 'utf8'));
  assert.equal((await s.call('GET', '/pane.js')).status, 200);
  assert.equal((await s.call('GET', '/pane.css')).status, 200);
  assert.equal((await s.call('GET', '/../project-store.mjs')).status, 404);
  assert.equal((await s.call('GET', '/app/pane.js')).status, 404);

  // SIGTERM removes server.json.
  s.child.kill('SIGTERM');
  await s.exited;
  assert.equal(fs.existsSync(path.join(repo, '.groundwork/server.json')), false);
});

test('board record round-trips bytes with the decisions-server PUT contract; app served under /decisions/<slug>/', async (t) => {
  const repo = tempRepo(t);
  addBoard(repo, 'demo');
  const s = await start(t, repo);

  const redirect = await s.call('GET', '/decisions/demo');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/decisions/demo/');
  const app = await s.call('GET', '/decisions/demo/');
  assert.equal(app.buf.toString(), fs.readFileSync(path.join(INSTALL, 'designer/decisions/app/index.html'), 'utf8'));
  assert.equal((await s.call('GET', '/decisions/demo/decisions.js')).status, 200);
  assert.equal((await s.call('GET', '/decisions/demo/decisions.css')).status, 200);

  const got = await s.call('GET', '/decisions/demo/record.json');
  assert.deepEqual(got.buf, fs.readFileSync(DEMO));

  const rec = JSON.parse(got.buf.toString());
  rec.compares[0].ruling = 'approve-b';
  const raw = Buffer.from(JSON.stringify(rec, null, 3) + '\n  ');
  const put = await s.call('PUT', '/decisions/demo/record.json', raw, { 'Content-Type': 'text/plain' });
  assert.equal(put.status, 200);
  assert.deepEqual(Object.keys(put.json), ['ok', 'savedAt', 'bytes']);
  assert.equal(put.json.ok, true);
  assert.match(put.json.savedAt, /^\d{8}T\d{6}Z$/);
  assert.equal(put.json.bytes, raw.length);
  assert.deepEqual(fs.readFileSync(path.join(repo, '.groundwork/decisions/demo/decisions.json')), raw);
  assert.deepEqual((await s.call('GET', '/decisions/demo/record.json')).buf, raw);

  const bad = await s.call('PUT', '/decisions/demo/record.json', { schema: 'other' });
  assert.equal(bad.status, 400);
  assert.equal((await s.call('PUT', '/decisions/demo/record.json', '{nope')).status, 400);
  assert.deepEqual(fs.readFileSync(path.join(repo, '.groundwork/decisions/demo/decisions.json')), raw);

  const png = await s.call('GET', '/decisions/demo/visuals/shot.png');
  assert.equal(png.status, 200); assert.equal(png.headers.get('content-type'), 'image/png');
  const html = await s.call('GET', '/decisions/demo/visuals/wire.html');
  assert.match(html.headers.get('content-security-policy'), /^sandbox/);

  const live = await s.call('GET', '/decisions/demo/live-status.json');
  assert.deepEqual(Object.keys(live.json), ['origin', 'branch', 'sha', 'committedAt']);
  assert.equal((await s.call('GET', '/__live/x')).status, 404);
});

test('traversal on slug and visuals returns 404', async (t) => {
  const repo = tempRepo(t);
  const boardDir = addBoard(repo, 'demo');
  fs.writeFileSync(path.join(repo, 'secret.txt'), 'secret');
  fs.symlinkSync(path.join(repo, 'secret.txt'), path.join(boardDir, 'visuals', 'link.png'));
  const otherDir = path.join(repo, 'elsewhere');
  fs.mkdirSync(otherDir); fs.copyFileSync(DEMO, path.join(otherDir, 'decisions.json'));
  fs.symlinkSync(otherDir, path.join(repo, '.groundwork/decisions/linked'));
  const s = await start(t, repo);

  const probes = [
    '/decisions/..%2F..%2Fsecret.txt/record.json',
    '/decisions/%2e%2e/record.json',
    '/decisions/..%2Fdecisions%2Fdemo/record.json',
    '/decisions/nope/record.json',
    '/decisions/linked/record.json',
    '/decisions/.hidden/record.json',
    '/decisions/demo/visuals/..%2F..%2F..%2F..%2Fsecret.txt',
    '/decisions/demo/visuals/%2e%2e%2fdecisions.json',
    '/decisions/demo/visuals/link.png',
    '/decisions/demo/visuals/%E0%A4%A',
    '/decisions/demo/visuals/sub/shot.png',
  ];
  for (const probe of probes) {
    const r = await s.call('GET', probe);
    assert.equal(r.status, 404, probe);
    assert.ok(!r.buf.toString().includes('secret'), probe);
  }
  // Raw paths (fetch would normalize dot segments client-side).
  for (const raw of ['/decisions/demo/../../secret.txt', '/../secret.txt', '/decisions/demo/visuals/../../../../secret.txt']) {
    const r = await rawGet(s.port, raw);
    assert.equal(r.status, 404, raw);
    assert.ok(!r.body.includes('secret'), raw);
  }
  const put = await s.call('PUT', '/decisions/..%2Fdecisions%2Fdemo/record.json', fs.readFileSync(DEMO));
  assert.equal(put.status, 404);
});

test('foreign Origin and non-JSON content type are refused with 403; body caps give 413', async (t) => {
  const repo = tempRepo(t);
  addBoard(repo, 'demo');
  const s = await start(t, repo);
  const evil = { Origin: 'http://evil.example' };
  const cases = [
    ['PUT', '/api/feedback/fb_x', { section: 'general', text: 'hi' }],
    ['POST', '/api/preferences', { text: 'p' }],
    ['POST', '/api/agent/ack', { ids: [] }],
    ['PUT', '/decisions/demo/record.json', fs.readFileSync(DEMO)],
  ];
  for (const [m, r, b] of cases) {
    const res = await s.call(m, r, b, evil);
    assert.equal(res.status, 403, `${m} ${r}`);
    assert.equal(typeof res.json.error, 'string');
  }
  assert.equal((await s.call('PUT', '/api/feedback/fb_x', { section: 'general', text: 'hi' }, { Origin: `http://localhost:${s.port}` })).status, 200);
  assert.equal((await s.call('PUT', '/api/feedback/fb_y', { section: 'general', text: 'hi' }, { Origin: `http://127.0.0.1:${s.port}` })).status, 200);
  assert.equal((await s.call('PUT', '/api/feedback/fb_z', JSON.stringify({ section: 'general', text: 'hi' }), { 'Content-Type': 'text/plain' })).status, 403);
  assert.equal((await s.call('PUT', '/api/feedback/fb_big', { section: 'general', text: 'x'.repeat(70 * 1024) })).status, 413);
  assert.equal((await s.call('PUT', '/decisions/demo/record.json', Buffer.alloc(8 * 1024 * 1024 + 1, 0x20))).status, 413);
  const items = (await s.call('GET', '/api/feedback')).json.items.map((f) => f.id);
  assert.deepEqual(items.sort(), ['fb_x', 'fb_y']);
});

test('feedback draft, submit, delete and error mapping', async (t) => {
  const repo = tempRepo(t);
  const s = await start(t, repo);
  const put = await s.call('PUT', '/api/feedback/fb_one', { section: 'canvas', text: 'Make the header calmer', target: null });
  assert.equal(put.status, 200);
  assert.equal(put.json.ok, true);
  assert.equal(put.json.item.status, 'draft');
  assert.equal(put.json.savedAt, put.json.item.updatedAt);
  assert.ok(!Number.isNaN(Date.parse(put.json.savedAt)));
  assert.equal((await s.call('GET', '/api/feedback?status=draft')).json.items.length, 1);

  const sub = await s.call('POST', '/api/feedback/fb_one/submit', { text: 'Make the header calmer, please' });
  assert.equal(sub.status, 200);
  assert.equal(sub.json.item.status, 'submitted');
  assert.equal(sub.json.item.text, 'Make the header calmer, please');
  assert.equal((await s.call('PUT', '/api/feedback/fb_one', { section: 'canvas', text: 'edit' })).status, 409);
  assert.equal((await s.call('DELETE', '/api/feedback/fb_one', {})).status, 409);

  await s.call('PUT', '/api/feedback/fb_two', { section: 'general', text: 'scratch' });
  const del = await s.call('DELETE', '/api/feedback/fb_two', {});
  assert.deepEqual(del.json, { ok: true });
  assert.equal((await s.call('DELETE', '/api/feedback/fb_two', {})).status, 404);

  const bad = await s.call('PUT', '/api/feedback/fb_bad', { section: 'nowhere', text: 'x' });
  assert.equal(bad.status, 400); assert.equal(bad.json.code, 'invalid');
  assert.equal((await s.call('PUT', '/api/feedback/not_fb', { section: 'general', text: 'x' })).status, 400);
  assert.equal((await s.call('PUT', '/api/feedback/fb_j', '{bad')).status, 400);
  assert.equal((await s.call('POST', '/api/feedback/fb_missing/submit', {})).json.code, 'not-found');

  const pref = await s.call('POST', '/api/preferences', { text: 'Prefer plain copy', scope: 'repo' });
  assert.equal(pref.json.ok, true);
  assert.deepEqual(pref.json.preference.provenance, { source: 'person', ref: null });
  const ack = await s.call('POST', '/api/agent/ack', { ids: ['fb_one', 'fb_nope'] });
  assert.deepEqual(ack.json, { acknowledged: ['fb_one'], refused: [{ id: 'fb_nope', reason: 'unknown' }] });
  assert.equal((await s.call('POST', '/api/workspace/select', { id: 'alt-missing' })).status, 404);
});

test('workspace select and canvas file/feedback are served read-only from their sources', async (t) => {
  const repo = tempRepo(t);
  fs.mkdirSync(path.join(repo, '.groundwork'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.groundwork/workspace.json'), JSON.stringify({
    version: 1, notes: [], alternatives: [{ id: 'alt-a', rationale: 'A', createdAt: '2026-10-01T00:00:00.000Z' }], selectedId: null, sources: [],
    review: { suggestions: true, optionCount: 3, layout: 'compare', fidelity: 'low' },
  }, null, 2) + '\n');
  const canvas = path.join(repo, 'mockups/.canvas');
  fs.mkdirSync(canvas, { recursive: true });
  fs.writeFileSync(path.join(canvas, 'board.html'), '<html><script>alert(1)</script>canvas</html>');
  fs.writeFileSync(path.join(canvas, 'feedback.jsonl'),
    JSON.stringify({ id: 'r1', ts: '2026-10-01T00:00:00.000Z', kind: 'comment', text: 'Tighten spacing' }) + '\n{"truncated');
  const canvasBefore = treeHashes(canvas, new Set());
  const s = await start(t, repo);

  const sel = await s.call('POST', '/api/workspace/select', { id: 'alt-a' });
  assert.deepEqual(sel.json, { ok: true, selectedId: 'alt-a' });
  assert.equal((await s.call('GET', '/api/project')).json.sections.savedWork.selectedId, 'alt-a');

  const file = await s.call('GET', '/canvas/file');
  assert.equal(file.status, 200);
  assert.deepEqual(file.buf, fs.readFileSync(path.join(canvas, 'board.html')));
  assert.match(file.headers.get('content-security-policy'), /^sandbox; script-src 'none'/);
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  const fbk = await s.call('GET', '/canvas/feedback');
  assert.equal(fbk.json.invalidRows, 1);
  assert.deepEqual(fbk.json.rows.map((r) => [r.id, r.text]), [['canvas:r1', 'Tighten spacing']]);
  assert.deepEqual(treeHashes(canvas, new Set()), canvasBefore);

  const empty = await start(t, tempRepo(t));
  assert.equal((await empty.call('GET', '/canvas/file')).status, 404);
});

// ── T-11 ─────────────────────────────────────────────────────────────────────

test('cross-section: submitted feedback and a board ruling appear in /api/project and the agent contract', async (t) => {
  const repo = tempRepo(t);
  addBoard(repo, 'demo');
  const s = await start(t, repo);

  await s.call('PUT', '/api/feedback/fb_cross', { section: 'spec', text: 'Spec needs an error state' });
  await s.call('POST', '/api/feedback/fb_cross/submit', {});
  const rec = JSON.parse(fs.readFileSync(DEMO, 'utf8'));
  rec.compares[1].ruling = 'approve-a';
  rec.compares[1].rulingText = 'Keep the current layout';
  assert.equal((await s.call('PUT', '/decisions/demo/record.json', JSON.stringify(rec))).status, 200);

  const snap = (await s.call('GET', '/api/project')).json;
  assert.equal(snap.schema, 'groundwork.project-snapshot/v1');
  const fb = snap.feedback.find((f) => f.id === 'fb_cross');
  assert.equal(fb.status, 'submitted'); assert.equal(fb.section, 'spec');
  const board = snap.sections.decisions.find((b) => b.slug === 'demo');
  const item = board.items.find((i) => i.id === rec.compares[1].id);
  assert.equal(item.lane, 'ruled'); assert.equal(item.ruling, 'approve-a'); assert.equal(item.note, 'Keep the current layout');
  assert.equal(board.ruled, 1);

  const contract = (await s.call('GET', '/api/agent/contract')).json;
  assert.equal(contract.schema, 'groundwork.project-agent-contract/v1');
  assert.ok(contract.pending.some((f) => f.id === 'fb_cross'));
  const cb = contract.decisions.find((b) => b.slug === 'demo');
  assert.equal(cb.ruled, 1);
  if (cb.items) assert.equal(cb.items.find((i) => i.id === rec.compares[1].id).ruling, 'approve-a'); // AM-6

  // Reading the contract (twice) never changes the store.
  const before = treeHashes(path.join(repo, '.groundwork'));
  const c1 = (await s.call('GET', '/api/agent/contract')).json;
  const c2 = (await s.call('GET', '/api/agent/contract')).json;
  await s.call('GET', '/api/project'); await s.call('GET', '/api/feedback');
  assert.deepEqual(c1, c2);
  assert.deepEqual(treeHashes(path.join(repo, '.groundwork')), before);
});

test('legacy board is readable but PUT is refused with 409', async (t) => {
  const repo = tempRepo(t);
  const dir = addBoard(repo, 'old', { legacy: true });
  const before = fs.readFileSync(path.join(dir, 'decisions.json'));
  const s = await start(t, repo);
  assert.deepEqual((await s.call('GET', '/decisions/old/record.json')).buf, before);
  assert.equal((await s.call('GET', '/decisions/old/visuals/shot.png')).status, 200);
  const put = await s.call('PUT', '/decisions/old/record.json', before);
  assert.equal(put.status, 409); assert.equal(put.json.code, 'state');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'decisions.json')), before);
  const snap = (await s.call('GET', '/api/project')).json;
  assert.equal(snap.sections.decisions[0].legacy, true);
  assert.equal(fs.existsSync(path.join(repo, '.groundwork/decisions/old')), false);
});

test('concurrency: 20 parallel feedback PUTs + board PUT + a concurrent Python writer (25 writes) lose nothing and never 500', async (t) => {
  const repo = tempRepo(t);
  addBoard(repo, 'demo');
  const s = await start(t, repo);
  const py = spawn('python3', ['-c', `
import sys
from designer.project.project_store import ProjectStore
st = ProjectStore(sys.argv[1], tool="python-test")
print("ready", flush=True)
for i in range(25):
    st.add_feedback("general", "python note %d" % i, id="fb_py%d" % i, origin={"kind": "agent", "ref": None})
print("done")
`, repo], { cwd: INSTALL, env: { ...process.env, PYTHONPATH: INSTALL }, stdio: ['ignore', 'pipe', 'pipe'] });
  let pyOut = '';
  py.stdout.on('data', (b) => { pyOut += b; }); py.stderr.on('data', (b) => { pyOut += b; });
  const pyDone = new Promise((resolve) => py.once('exit', resolve));
  await new Promise((resolve) => { const on = () => { if (pyOut.includes('ready')) { py.stdout.off('data', on); resolve(); } }; py.stdout.on('data', on); });

  const rec = JSON.parse(fs.readFileSync(DEMO, 'utf8'));
  rec.compares[0].ruling = 'approve-b';
  const boardRaw = JSON.stringify(rec, null, 2) + '\n';
  const reqs = [];
  for (let i = 0; i < 20; i++) reqs.push(s.call('PUT', `/api/feedback/fb_http${i}`, { section: 'decisions', text: `http note ${i}` }));
  reqs.push(s.call('PUT', '/decisions/demo/record.json', boardRaw));
  const results = await Promise.all(reqs);
  assert.equal(await pyDone, 0, pyOut);
  for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.json));

  const ids = new Set((await s.call('GET', '/api/feedback')).json.items.map((f) => f.id));
  for (let i = 0; i < 20; i++) assert.ok(ids.has(`fb_http${i}`), `fb_http${i}`);
  for (let i = 0; i < 25; i++) assert.ok(ids.has(`fb_py${i}`), `fb_py${i}`);
  assert.equal(ids.size, 45);
  assert.equal(fs.readFileSync(path.join(repo, '.groundwork/decisions/demo/decisions.json'), 'utf8'), boardRaw);
  const doc = JSON.parse(fs.readFileSync(path.join(repo, '.groundwork/project.json'), 'utf8'));
  assert.equal(doc.rev, 45);
  assert.equal(fs.existsSync(path.join(repo, '.groundwork/write.lock')), false);
});

test('restart after kill: .groundwork bytes (minus server.json) and API reads are identical', async (t) => {
  const repo = tempRepo(t);
  addBoard(repo, 'demo');
  let s = await start(t, repo);
  await s.call('PUT', '/api/feedback/fb_d', { section: 'memory', text: 'draft stays a draft' });
  await s.call('PUT', '/api/feedback/fb_s', { section: 'general', text: 'submitted' });
  await s.call('POST', '/api/feedback/fb_s/submit', {});
  await s.call('PUT', '/api/feedback/fb_a', { section: 'general', text: 'acked' });
  await s.call('POST', '/api/feedback/fb_a/submit', {});
  await s.call('POST', '/api/agent/ack', { ids: ['fb_a'] });
  await s.call('POST', '/api/preferences', { text: 'Keep it calm' });
  const rec = JSON.parse(fs.readFileSync(DEMO, 'utf8')); rec.compares[2].ruling = 'approve-a';
  await s.call('PUT', '/decisions/demo/record.json', JSON.stringify(rec));

  const strip = (snap) => ({ ...snap, generatedAt: null });
  const snapBefore = strip((await s.call('GET', '/api/project')).json);
  const contractBefore = (await s.call('GET', '/api/agent/contract')).json;
  const bytesBefore = treeHashes(path.join(repo, '.groundwork'));
  s.child.kill('SIGKILL');
  await s.exited;

  s = await start(t, repo);
  assert.equal(s.port, defaultPort(repo));
  assert.deepEqual(treeHashes(path.join(repo, '.groundwork')), bytesBefore);
  assert.deepEqual(strip((await s.call('GET', '/api/project')).json), snapBefore);
  assert.deepEqual((await s.call('GET', '/api/agent/contract')).json, contractBefore);
});

test('startup migration: runs the CLI from the install root; failure is a warning and the server still serves', async (t) => {
  const repo = tempRepo(t);
  const stubDir = tempRepo(t);
  const ok = pyStub(stubDir, { code: 0, out: JSON.stringify({ root: repo, dryRun: false, entries: [], changed: false }) });
  const s1 = await start(t, repo, { args: [], env: { GROUNDWORK_PYTHON: ok.file } });
  const call = ok.calls()[0];
  assert.deepEqual(call.argv, ['-m', 'designer.project', 'migrate', '--repo', repo, '--json']);
  assert.equal(call.cwd, INSTALL); assert.equal(call.pythonpath, INSTALL);
  assert.ok(!(await s1.call('GET', '/api/project')).json.warnings.some((w) => w.code === 'migration-failed'));
  s1.child.kill('SIGTERM'); await s1.exited;

  const bad = pyStub(stubDir, { code: 1, out: '' });
  const s2 = await start(t, repo, { args: [], env: { GROUNDWORK_PYTHON: bad.file } });
  const w = (await s2.call('GET', '/api/project')).json.warnings.find((x) => x.code === 'migration-failed');
  assert.ok(w, 'migration-failed warning present');
  assert.equal((await s2.call('PUT', '/api/feedback/fb_after', { section: 'general', text: 'still serves' })).status, 200);
  s2.child.kill('SIGTERM'); await s2.exited;

  const s3 = await start(t, repo, { args: [], env: { GROUNDWORK_PYTHON: path.join(stubDir, 'missing-python') } });
  assert.ok((await s3.call('GET', '/api/project')).json.warnings.some((x) => x.code === 'migration-failed'));

  const n = ok.calls().length;
  const s4 = await start(t, tempRepo(t), { args: ['--no-migrate'], env: { GROUNDWORK_PYTHON: ok.file } });
  assert.equal((await s4.call('GET', '/api/health')).status, 200);
  assert.equal(ok.calls().length, n);
});

test('POST /api/snapshot spawns the snapshot CLI and returns its path', async (t) => {
  const repo = tempRepo(t);
  const stubDir = tempRepo(t);
  const ok = pyStub(stubDir, { code: 0, out: JSON.stringify({ path: '/abs/.groundwork/snapshots/20261006T120000Z' }) });
  const s = await start(t, repo, { env: { GROUNDWORK_PYTHON: ok.file } });
  const r = await s.call('POST', '/api/snapshot', {});
  assert.deepEqual(r.json, { ok: true, path: '/abs/.groundwork/snapshots/20261006T120000Z' });
  assert.deepEqual(ok.calls().at(-1).argv, ['-m', 'designer.project', 'snapshot', '--repo', repo, '--json']);
  assert.equal(ok.calls().at(-1).cwd, INSTALL);
  assert.equal((await s.call('POST', '/api/snapshot', {}, { Origin: 'http://evil.example' })).status, 403);

  const bad = pyStub(stubDir, { code: 1, out: '' });
  const s2 = await start(t, tempRepo(t), { env: { GROUNDWORK_PYTHON: bad.file } });
  const f = await s2.call('POST', '/api/snapshot', {});
  assert.equal(f.status, 500); assert.equal(typeof f.json.error, 'string');
});
