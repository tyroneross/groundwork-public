// JS project store: C1 scenarios run against designer/project/project-store.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  projectStore, StoreError, canonical, decisionSummary, projectRoot, SLUG_RE, SECTIONS,
  validateFeedbackInput, validatePreferenceInput, SCHEMA,
} from '../project/project-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, '..', 'decisions', 'fixtures', 'compare-demo', 'decisions.json');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-store-')));
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function clock() { let n = 0; return () => new Date(Date.UTC(2026, 9, 6, 12, 0, 0, 0) + (n++) * 1000).toISOString(); }
function ids() { let n = 0; return (p) => `${p}${String(++n).padStart(32, '0')}`; }
function make(root, extra = {}) { return projectStore(root, { now: clock(), newId: ids(), ...extra }); }
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof StoreError && e.code === code);

test('import has no side effects and exports are present', () => {
  assert.equal(typeof projectStore, 'function');
  assert.ok(SLUG_RE.test('a.b-c_1'));
  assert.ok(!SLUG_RE.test('.hidden'));
  assert.ok(SECTIONS.includes('decisions'));
  assert.equal(typeof validateFeedbackInput, 'function');
  assert.equal(typeof validatePreferenceInput, 'function');
});

test('canonical and projectRoot', () => {
  assert.equal(canonical({ a: [1] }), '{\n  "a": [\n    1\n  ]\n}\n');
  const r = tmp(); fs.mkdirSync(path.join(r, '.designdoc'));
  assert.equal(projectRoot(path.join(r, '.designdoc')), r);
  assert.equal(projectRoot(r), r);
});

test('init is idempotent and writes .gitignore "*"', () => {
  const r = tmp(); const s = make(r);
  const d1 = s.init();
  assert.equal(d1.schema, SCHEMA); assert.equal(d1.rev, 0);
  const pj = path.join(r, '.groundwork', 'project.json');
  const before = fs.readFileSync(pj); const m1 = fs.statSync(pj).mtimeMs;
  assert.equal(fs.readFileSync(path.join(r, '.groundwork', '.gitignore'), 'utf8'), '*\n');
  const d2 = s.init();
  assert.equal(d2.rev, 0);
  assert.ok(Buffer.compare(before, fs.readFileSync(pj)) === 0);
  assert.equal(fs.statSync(pj).mtimeMs, m1);
  assert.ok(!fs.existsSync(path.join(r, '.groundwork', 'write.lock')));
  assert.equal(fs.readFileSync(pj, 'utf8'), canonical(d1));
});

test('lock: live holder times out, never broken', () => {
  const r = tmp(); const s = make(r, { lockTimeoutMs: 150 }); s.init();
  const lock = path.join(r, '.groundwork', 'write.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), tool: 'test', acquiredAt: 'x' }));
  const t0 = Date.now();
  throwsCode(() => s.upsertDraft({ section: 'general', text: 'hi' }), 'lock-timeout');
  assert.ok(Date.now() - t0 >= 140);
  assert.ok(fs.existsSync(lock));
  assert.equal(s.warnings.length, 0);
});

test('lock: foreign host holder is never broken', () => {
  const r = tmp(); const s = make(r, { lockTimeoutMs: 100 }); s.init();
  const lock = path.join(r, '.groundwork', 'write.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 2147483646, host: 'other-host.invalid', tool: 'test', acquiredAt: 'x' }));
  throwsCode(() => s.upsertDraft({ section: 'general', text: 'hi' }), 'lock-timeout');
  assert.ok(fs.existsSync(lock));
});

test('lock: stale dead-pid lock is broken with a warning', () => {
  const r = tmp(); const s = make(r, { lockTimeoutMs: 100 }); s.init();
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  const lock = path.join(r, '.groundwork', 'write.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: dead, host: os.hostname(), tool: 'test', acquiredAt: 'x' }));
  const item = s.upsertDraft({ section: 'general', text: 'after stale' });
  assert.equal(item.status, 'draft');
  assert.ok(!fs.existsSync(lock));
  assert.ok(s.snapshot().warnings.some(w => w.code === 'lock-stale-broken'));
});

test('feedback status machine: draft -> submitted -> processed, no backward move', () => {
  const r = tmp(); const s = make(r); s.init();
  const d = s.upsertDraft({ section: 'spec', text: '  first  ', target: 'x' });
  assert.equal(d.text, 'first'); assert.match(d.id, /^fb_/);
  const d2 = s.upsertDraft({ id: d.id, section: 'spec', text: 'second' });
  assert.equal(d2.text, 'second'); assert.equal(d2.createdAt, d.createdAt);
  assert.deepEqual(s.acknowledge([d.id]).refused, [{ id: d.id, reason: 'draft' }]);
  const sub = s.submitFeedback(d.id);
  assert.equal(sub.status, 'submitted'); assert.ok(sub.submittedAt);
  const rev = s.readProject().rev;
  assert.equal(s.submitFeedback(d.id).status, 'submitted');            // idempotent
  assert.equal(s.submitFeedback(d.id, 'second').status, 'submitted');  // same text
  assert.equal(s.readProject().rev, rev);
  throwsCode(() => s.submitFeedback(d.id, 'changed'), 'state');
  throwsCode(() => s.upsertDraft({ id: d.id, section: 'spec', text: 'edit' }), 'state');
  throwsCode(() => s.deleteDraft(d.id), 'state');
  const ack = s.acknowledge([d.id, 'fb_nope', 'canvas:fb-1-1']);
  assert.deepEqual(ack.acknowledged, [d.id]);
  assert.deepEqual(ack.refused, [{ id: 'fb_nope', reason: 'unknown' }, { id: 'canvas:fb-1-1', reason: 'canvas-cursor-owned' }]);
  assert.equal(s.listFeedback({ status: 'processed' })[0].processedAt !== null, true);
  throwsCode(() => s.submitFeedback(d.id), 'state');
  const d3 = s.upsertDraft({ section: 'general', text: 'to delete' });
  s.deleteDraft(d3.id);
  throwsCode(() => s.deleteDraft(d3.id), 'not-found');
  throwsCode(() => s.upsertDraft({ section: 'bogus', text: 'x' }), 'invalid');
  throwsCode(() => s.upsertDraft({ section: 'general', text: '   ' }), 'invalid');
  throwsCode(() => s.upsertDraft({ section: 'general', text: 'x', id: 'bad' }), 'invalid');
  const added = s.addFeedback({ section: 'memory', text: 'agent note', origin: { kind: 'agent', ref: null } });
  assert.equal(added.status, 'submitted');
  assert.equal(s.addFeedback({ section: 'memory', text: 'agent note', id: added.id }).id, added.id);
});

test('preferences: supersede is atomic and refuses unknown or already superseded', () => {
  const r = tmp(); const s = make(r); s.init();
  const a = s.addPreference({ text: 'one' });
  const b = s.addPreference({ text: 'two', supersedes: a.id });
  const prefs = s.listPreferences({ includeSuperseded: true });
  assert.equal(prefs[0].id, b.id);
  assert.equal(prefs[1].status, 'superseded'); assert.equal(prefs[1].supersededBy, b.id);
  assert.equal(s.listPreferences().length, 1);
  throwsCode(() => s.addPreference({ text: 'x', supersedes: a.id }), 'state');
  throwsCode(() => s.addPreference({ text: 'x', supersedes: 'pref_nope' }), 'not-found');
  throwsCode(() => s.addPreference({ text: 'x', scope: 'nope' }), 'invalid');
});

test('100 reads leave project.json bytes and rev unchanged', () => {
  const r = tmp(); const s = make(r); s.init();
  s.addFeedback({ section: 'general', text: 'seed' });
  const pj = path.join(r, '.groundwork', 'project.json');
  const before = fs.readFileSync(pj); const rev = s.readProject().rev;
  for (let i = 0; i < 100; i++) { s.readProject(); s.snapshot(); s.agentContract(); s.listFeedback(); s.listPreferences(); s.listBoards(); }
  assert.ok(Buffer.compare(before, fs.readFileSync(pj)) === 0);
  assert.equal(s.readProject().rev, rev);
  assert.equal(s.agentContract().readConsumes, false);
});

test('unchanged mutation skips the write (no rev bump)', () => {
  const r = tmp(); const s = make(r); s.init();
  s.mutate(() => {});
  assert.equal(s.readProject().rev, 0);
  s.mutate((d) => { d.preferences = []; });
  assert.equal(s.readProject().rev, 0);
  s.addPreference({ text: 'a' });
  assert.equal(s.readProject().rev, 1);
});

test('symlinked .groundwork is refused; symlinked written file is refused', () => {
  const r = tmp(); const other = tmp();
  fs.symlinkSync(other, path.join(r, '.groundwork'));
  throwsCode(() => make(r).init(), 'symlink');
  const r2 = tmp(); const s2 = make(r2); s2.init();
  const target = path.join(r2, 'elsewhere.json'); fs.writeFileSync(target, '{}');
  fs.rmSync(path.join(r2, '.groundwork', 'workspace.json'), { force: true });
  fs.symlinkSync(target, path.join(r2, '.groundwork', 'workspace.json'));
  throwsCode(() => s2.readWorkspace(), 'symlink');
  assert.equal(fs.readFileSync(target, 'utf8'), '{}');
  const r3 = tmp(); fs.mkdirSync(path.join(r3, '.groundwork-workspace'));
  const real = path.join(r3, 'real.json'); fs.writeFileSync(real, JSON.stringify({ version: 1, notes: [], alternatives: [], sources: [] }));
  fs.symlinkSync(real, path.join(r3, '.groundwork-workspace', 'workspace.json'));
  throwsCode(() => make(r3).readWorkspace(), 'symlink');
});

test('workspace: empty default, legacy fallback, first change migrates', () => {
  const r = tmp(); const s = make(r); s.init();
  const empty = s.readWorkspace();
  assert.equal(empty.legacy, false);
  assert.deepEqual(empty.value, { version: 1, notes: [], alternatives: [], selectedId: null, sources: [], review: { suggestions: true, optionCount: 3, layout: 'compare', fidelity: 'low' } });
  assert.ok(!fs.existsSync(path.join(r, '.groundwork', 'workspace.json')));

  const legacyDir = path.join(r, '.designdoc', '.groundwork-workspace'); fs.mkdirSync(legacyDir, { recursive: true });
  const legacyFile = path.join(legacyDir, 'workspace.json');
  const legacyVal = {
    version: 1, notes: [{ id: 'n1', text: 'note one', status: 'received', createdAt: '2026-01-01T00:00:00.000Z' }],
    alternatives: [{ id: 'alt1', mockup: { html: '<p/>' }, rationale: 'why', createdAt: '2026-01-02T00:00:00.000Z' }], selectedId: null, sources: [],
  };
  fs.writeFileSync(legacyFile, JSON.stringify(legacyVal));            // deliberately non-canonical bytes
  const legacyBytes = fs.readFileSync(legacyFile);
  const rd = s.readWorkspace();
  assert.equal(rd.legacy, true); assert.equal(rd.value.notes[0].id, 'n1');
  s.snapshot(); s.listFeedback();
  assert.ok(!fs.existsSync(path.join(r, '.groundwork', 'workspace.json')));  // reads never write
  assert.equal(s.snapshot().sections.savedWork.legacy, true);

  s.selectDesign('alt1');
  const newFile = path.join(r, '.groundwork', 'workspace.json');
  assert.ok(fs.existsSync(newFile));
  assert.equal(JSON.parse(fs.readFileSync(newFile, 'utf8')).selectedId, 'alt1');
  assert.ok(Buffer.compare(legacyBytes, fs.readFileSync(legacyFile)) === 0);
  const m = s.readProject().migrations;
  assert.equal(m.length, 1);
  assert.equal(m[0].kind, 'workspace'); assert.equal(m[0].status, 'migrated');
  assert.equal(m[0].source, '.designdoc/.groundwork-workspace/workspace.json');
  assert.equal(m[0].sourceSha256, crypto.createHash('sha256').update(legacyBytes).digest('hex'));
  assert.equal(m[0].destSha256, sha(newFile));
  assert.equal(s.readWorkspace().legacy, false);
  throwsCode(() => s.selectDesign('nope'), 'not-found');

  // workspace note appears in the unified list and is acknowledged into the workspace file
  const fb = s.listFeedback({ section: 'saved-work' });
  assert.equal(fb[0].id, 'n1'); assert.equal(fb[0].status, 'submitted'); assert.equal(fb[0].origin.kind, 'workspace');
  assert.deepEqual(s.acknowledge(['n1']).acknowledged, ['n1']);
  assert.equal(s.listFeedback({ section: 'saved-work' })[0].status, 'processed');
});

test('workspace legacy second path (R/.groundwork-workspace) is read', () => {
  const r = tmp(); const d = path.join(r, '.groundwork-workspace'); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'workspace.json'), JSON.stringify({ version: 1, notes: [], alternatives: [], sources: [], selectedId: 'z' }));
  const rd = make(r).readWorkspace();
  assert.equal(rd.legacy, true); assert.equal(rd.value.selectedId, 'z');
});

test('decisionSummary on compare-demo equals decision_record lanes', () => {
  const rec = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const py = spawnSync('python3', ['-c', 'import json,sys;from designer.decisions import decision_record as d;l=d.lanes(json.load(open(sys.argv[1])));print(json.dumps({k:len(v) for k,v in l.items()}))', FIXTURE], { cwd: path.join(HERE, '..', '..'), encoding: 'utf8' });
  const sum = decisionSummary(rec);
  assert.equal(py.status, 0, py.stderr);
  const lanes = JSON.parse(py.stdout);
  assert.equal(sum.open, lanes.open); assert.equal(sum.ruled, lanes.ruled);
  assert.equal(sum.items.length, sum.open + sum.ruled);
  assert.deepEqual(Object.keys(sum.items[0]), ['id', 'source', 'title', 'lane', 'ruling', 'note', 'ruledAt']);
});

test('decisionSummary mirrors Python truthiness (false/0 rule; ""/[]/{}/null do not; addressed closes)', () => {
  const rec = {
    axes: [{ id: 'a1', title: 'T', selected: false }, { id: 'a2', selected: 0 }, { id: 'a3', selected: '' }, { id: 'a4', selected: ['x'] }, { id: 'a5', selected: '  ' }],
    openItems: [{ id: 'o1', question: 'Q', ruling: [] }, { id: 'o2', ruling: {} }, { id: 'o3', ruling: 'yes', rulingText: 'because', ruledAt: 'now' }, { id: 'o4', addressed: 1 }, { id: 'o5', addressed: false }, { id: 'o6', addressed: '' }],
    compares: [{ id: 'c1', question: 'CQ', ruling: 'approve-b' }, { id: 'c2', ruling: null }],
  };
  const lane = Object.fromEntries(decisionSummary(rec).items.map(i => [i.id, i.lane]));
  assert.deepEqual(lane, { a1: 'ruled', a2: 'ruled', a3: 'open', a4: 'ruled', a5: 'open', o1: 'open', o2: 'open', o3: 'ruled', o4: 'ruled', o5: 'open', o6: 'open', c1: 'ruled', c2: 'open' });
  const items = decisionSummary(rec).items;
  assert.equal(items.find(i => i.id === 'a1').ruling, false);
  assert.equal(items.find(i => i.id === 'a2').title, 'a2');           // falsy title falls back to id
  assert.equal(items.find(i => i.id === 'o3').note, 'because');
});

test('boards: write verbatim bytes, list, read, validation, legacy listing', () => {
  const r = tmp(); const s = make(r); s.init();
  const bytes = fs.readFileSync(FIXTURE);
  s.writeBoard('demo', bytes);
  assert.ok(Buffer.compare(s.readBoard('demo'), bytes) === 0);
  const boards = s.listBoards();
  assert.equal(boards.length, 1);
  assert.equal(boards[0].legacy, false); assert.equal(boards[0].valid, true); assert.equal(boards[0].path, '.groundwork/decisions/demo');
  assert.equal(boards[0].open + boards[0].ruled, boards[0].items.length);
  throwsCode(() => s.writeBoard('../x', bytes), 'invalid');
  throwsCode(() => s.writeBoard('bad', Buffer.from('{"schema":"other"}')), 'invalid');
  throwsCode(() => s.writeBoard('bad', Buffer.from('nope')), 'invalid');
  throwsCode(() => s.readBoard('missing'), 'not-found');
  const dir = path.join(r, '.designdoc', 'old'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.json'), bytes);
  const snap = s.snapshot();
  const legacy = snap.sections.decisions.find(b => b.slug === 'old');
  assert.equal(legacy.legacy, true);
  assert.ok(snap.warnings.some(w => w.code === 'legacy-unmigrated'));
  // AM-6: contract decisions carry items (rulings + notes)
  assert.deepEqual(s.agentContract().decisions, snap.sections.decisions);
});

test('canvas projection: directory order, cursor, toggle skip, malformed rows, never writes', () => {
  const r = tmp();
  const alt = path.join(r, 'mockups', '.canvas'); fs.mkdirSync(alt, { recursive: true });
  const dir = path.join(r, '.designdoc', 'mockups', '.canvas'); fs.mkdirSync(dir, { recursive: true });
  const rows = [
    { ts: '2026-01-01T00:00:01.000Z', id: 'fb-1-1', kind: 'comment', text: 'hello', component: 'nav' },
    { ts: '2026-01-01T00:00:02.000Z', id: 'fb-2-1', kind: 'toggle', mode: 'hold' },
    { ts: '2026-01-01T00:00:03.000Z', id: 'fb-3-1', kind: 'decide', dim: 'color', value: 'a', text: '' },
    { ts: '2026-01-01T00:00:04.000Z', id: 'fb-4-1', kind: 'lock', text: '' },
  ];
  fs.writeFileSync(path.join(dir, 'feedback.jsonl'), rows.map(x => JSON.stringify(x)).join('\n') + '\n{"ts": broken\n[1]\n');
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>x</p>');
  fs.writeFileSync(path.join(alt, 'feedback.jsonl'), JSON.stringify({ ts: 't', id: 'wrong', kind: 'comment', text: 'x' }) + '\n');
  fs.writeFileSync(path.join(dir, 'cursor.json'), JSON.stringify({ last_id: 'fb-3-1', count: 3 }));
  const s = make(r);
  const snap = s.snapshot();
  assert.equal(snap.sections.canvas.dir, '.designdoc/mockups/.canvas');
  assert.equal(snap.sections.canvas.htmlFile, '.designdoc/mockups/.canvas/index.html');
  assert.equal(snap.sections.canvas.rows, 3); assert.equal(snap.sections.canvas.invalidRows, 2);
  assert.ok(snap.warnings.some(w => w.code === 'canvas-invalid-rows'));
  const fb = s.listFeedback({ section: 'canvas' });
  assert.deepEqual(fb.map(f => [f.id, f.text, f.status, f.target]), [
    ['canvas:fb-1-1', 'hello', 'processed', 'nav'],
    ['canvas:fb-3-1', '[decide] color=a', 'processed', null],
    ['canvas:fb-4-1', '[lock]', 'submitted', null],
  ]);
  assert.equal(fb[0].origin.ref, '.designdoc/mockups/.canvas/feedback.jsonl');
  const before = fs.readdirSync(dir).sort();
  s.recordArtifact('canvas', '.designdoc/mockups/.canvas');
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
  fs.rmSync(path.join(dir, 'cursor.json'));
  assert.ok(s.listFeedback({ section: 'canvas' }).every(f => f.status === 'submitted'));
  fs.writeFileSync(path.join(dir, 'cursor.json'), JSON.stringify({ last_id: 'gone' }));
  assert.ok(s.listFeedback({ section: 'canvas' }).every(f => f.status === 'submitted'));
  assert.equal(s.agentContract().pending.length, 3);
});

test('artifacts and migrations upsert by id; unchanged is a no-op', () => {
  const r = tmp(); const s = make(r); s.init();
  fs.mkdirSync(path.join(r, '.designdoc')); fs.writeFileSync(path.join(r, '.designdoc', 'spec.json'), '{"a":1}');
  const a = s.recordArtifact('spec', '.designdoc/spec.json');
  assert.equal(a.id, 'spec:.designdoc/spec.json'); assert.equal(a.bytes, 7);
  assert.deepEqual(Object.keys(a), ['id', 'kind', 'path', 'sha256', 'bytes', 'mtime', 'recordedAt', 'meta']);
  const rev = s.readProject().rev;
  const a2 = s.recordArtifact('spec', '.designdoc/spec.json');
  assert.equal(a2.recordedAt, a.recordedAt); assert.equal(s.readProject().rev, rev);
  throwsCode(() => s.recordArtifact('spec', '../x'), 'invalid');
  throwsCode(() => s.recordArtifact('spec', 'nope.json'), 'not-found');
  throwsCode(() => s.recordArtifact('bogus', '.designdoc/spec.json'), 'invalid');
  s.recordMigration({ id: 'decisions:x', kind: 'decision-board', source: 'a', dest: 'b', status: 'conflict' });
  s.recordMigration({ id: 'decisions:x', kind: 'decision-board', source: 'a', dest: 'b', status: 'conflict' });
  assert.equal(s.readProject().migrations.length, 1);
  assert.ok(s.snapshot().warnings.some(w => w.code === 'conflict'));
  assert.equal(s.snapshot().sections.spec.artifacts.length, 1);
});

test('snapshot key shapes', () => {
  const r = tmp(); const s = make(r); s.init();
  const snap = s.snapshot();
  assert.deepEqual(Object.keys(snap), ['schema', 'root', 'rev', 'generatedAt', 'sections', 'feedback', 'migrations', 'warnings']);
  assert.deepEqual(Object.keys(snap.sections), ['decisions', 'canvas', 'savedWork', 'spec', 'memory']);
  assert.deepEqual(Object.keys(s.agentContract()), ['schema', 'root', 'rev', 'readConsumes', 'pending', 'preferences', 'decisions', 'ack']);
});

test('no temp files left behind after writes', () => {
  const r = tmp(); const s = make(r); s.init(); s.addFeedback({ section: 'general', text: 'x' }); s.writeBoard('demo', fs.readFileSync(FIXTURE));
  const left = [];
  (function walk(d) { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (n.endsWith('.tmp')) left.push(p); } })(path.join(r, '.groundwork'));
  assert.deepEqual(left, []);
  throwsCode(() => s.writeBytes('x.bin', Buffer.from('a')), 'state');   // lock required
});

// ------------------------------------------------- C3 reconciliation (AM-4..AM-16)
const WS = { version: 1, notes: [], alternatives: [{ id: 'a1', rationale: 'r', createdAt: '2026-10-01T00:00:00.000Z' }], selectedId: null, sources: [], review: { suggestions: true, optionCount: 3, layout: 'compare', fidelity: 'low' } };
function writeFile(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }

test('AM-8: projectRoot strips a .groundwork ancestor; the store uses it', () => {
  const r = tmp(); fs.mkdirSync(path.join(r, '.groundwork', 'decisions', 'x'), { recursive: true });
  assert.equal(projectRoot(path.join(r, '.groundwork')), r);
  assert.equal(projectRoot(path.join(r, '.groundwork', 'decisions', 'x')), r);
  assert.equal(projectStore(path.join(r, '.groundwork', 'decisions')).root, r);
});

test('P1: one clock stamp per outermost lock', () => {
  const r = tmp(); const s = make(r); s.init();
  const d = s.upsertDraft({ id: 'fb_a', section: 'general', text: 'x' });
  assert.equal(d.createdAt, '2026-10-06T12:00:01.000Z'); assert.equal(d.updatedAt, d.createdAt);
  s.withLock(() => { s.addPreference({ text: 'p' }); s.submitFeedback('fb_a'); });
  const doc = s.readProject();
  assert.equal(doc.preferences[0].createdAt, '2026-10-06T12:00:02.000Z');
  assert.equal(doc.feedback[0].submittedAt, doc.preferences[0].createdAt);
  assert.equal(doc.updatedAt, doc.preferences[0].createdAt);
  const rev = doc.rev;
  s.upsertDraft({ id: 'fb_b', section: 'general', text: 'same' });
  const before = fs.readFileSync(path.join(r, '.groundwork', 'project.json'));
  s.upsertDraft({ id: 'fb_b', section: 'general', text: ' same ' });   // AM-3: same text -> no change
  assert.ok(Buffer.compare(before, fs.readFileSync(path.join(r, '.groundwork', 'project.json'))) === 0);
  assert.equal(s.readProject().rev, rev + 1);
});

test('AM-4: readWorkspace normalizes review; differing legacy pair is a conflict', () => {
  const r = tmp();
  writeFile(path.join(r, '.designdoc/.groundwork-workspace/workspace.json'), JSON.stringify({ ...WS, review: { optionCount: '9', layout: 'single' } }));
  writeFile(path.join(r, '.groundwork-workspace/workspace.json'), JSON.stringify({ ...WS, review: null }));
  const s = make(r);
  const { value, legacy } = s.readWorkspace();
  assert.equal(legacy, true);
  assert.deepEqual(value.review, { suggestions: true, optionCount: 5, layout: 'single', fidelity: 'low' });
  assert.ok(s.snapshot().warnings.some(w => w.code === 'conflict' && w.detail === '.designdoc/.groundwork-workspace/workspace.json and .groundwork-workspace/workspace.json differ'));
  throwsCode(() => s.selectDesign('a1'), 'conflict');
  throwsCode(() => s.addFeedback({ section: 'saved-work', text: 'x' }), 'conflict');
  assert.equal(fs.existsSync(path.join(r, '.groundwork', 'workspace.json')), false);
});

test('AM-5: saved-work submit mirrors a workspace note; projection dedupes; ack marks both', () => {
  const r = tmp(); const s = make(r);
  s.upsertDraft({ id: 'fb_s', section: 'saved-work', text: 'keep the header' });
  const sub = s.submitFeedback('fb_s');
  s.submitFeedback('fb_s');
  let ws = s.readWorkspace().value;
  assert.deepEqual(ws.notes, [{ id: 'fb_s', text: 'keep the header', review: ws.review, status: 'received', createdAt: sub.submittedAt }]);
  assert.deepEqual(s.listFeedback().map(f => f.id), ['fb_s']);
  assert.deepEqual(s.acknowledge(['fb_s']), { acknowledged: ['fb_s'], refused: [] });
  ws = s.readWorkspace().value;
  assert.equal(ws.notes[0].status, 'processed'); assert.equal(Object.keys(ws.notes[0]).at(-1), 'processedAt');
  assert.equal(s.readProject().feedback[0].status, 'processed');
  throwsCode(() => s.submitFeedback('fb_s'), 'state');                  // processed: no backward move
});

test('AM-6/AM-7: contract carries items; preferences active first then createdAt; empty id/title -> null', () => {
  const r = tmp(); const s = make(r);
  s.writeBoard('demo', fs.readFileSync(FIXTURE));
  const p1 = s.addPreference({ text: 'one' }); s.addPreference({ text: 'two' });
  s.addPreference({ text: 'three', supersedes: p1.id });
  assert.deepEqual(s.listPreferences({ includeSuperseded: true }).map(p => p.text), ['two', 'three', 'one']);
  const c = s.agentContract();
  assert.ok(c.decisions[0].items.length > 0);
  const sm = decisionSummary({ axes: [{ title: '' }, { id: '', title: 'T' }] });
  assert.deepEqual(sm.items.map(i => [i.id, i.title]), [[null, null], [null, 'T']]);
});

test('AM-15: workspace migration entry id and shas; legacy bytes unchanged', () => {
  const r = tmp(); const legacyFile = path.join(r, '.groundwork-workspace/workspace.json');
  writeFile(legacyFile, JSON.stringify(WS));
  const before = fs.readFileSync(legacyFile);
  const s = make(r); s.selectDesign('a1');
  const [m] = s.readProject().migrations;
  assert.deepEqual([m.id, m.kind, m.source, m.dest, m.status], ['workspace:workspace.json', 'workspace', '.groundwork-workspace/workspace.json', '.groundwork/workspace.json', 'migrated']);
  assert.equal(m.sourceSha256, crypto.createHash('sha256').update(before).digest('hex'));
  assert.equal(m.destSha256, sha(path.join(r, '.groundwork', 'workspace.json')));
  assert.ok(Buffer.compare(before, fs.readFileSync(legacyFile)) === 0);
});

test('P11: readBoard falls back to the legacy board', () => {
  const r = tmp(); writeFile(path.join(r, '.designdoc', 'old', 'decisions.json'), fs.readFileSync(FIXTURE));
  assert.ok(Buffer.compare(make(r).readBoard('old'), fs.readFileSync(FIXTURE)) === 0);
});

test('canvas page is found beside the .canvas control dir', async () => {
  const { projectStore } = await import('../project/project-store.mjs');
  const R = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-canvas-'));
  try {
    fs.mkdirSync(path.join(R, 'mockups', '.canvas'), { recursive: true });
    fs.writeFileSync(path.join(R, 'mockups', '.canvas', 'feedback.jsonl'), '');
    fs.writeFileSync(path.join(R, 'mockups', 'home.html'), '<p>canvas</p>');
    const c = projectStore(R).snapshot().sections.canvas;
    assert.equal(c.available, true);
    assert.equal(c.htmlFile, 'mockups/home.html');
  } finally { fs.rmSync(R, { recursive: true, force: true }); }
});

test('release never removes a lock that is no longer ours (audit f2)', async () => {
  const { projectStore } = await import('../project/project-store.mjs');
  const R = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-lock-'));
  try {
    const s = projectStore(R);
    const lock = path.join(R, '.groundwork', 'write.lock');
    const other = JSON.stringify({ pid: process.pid, host: os.hostname(), tool: 'other', acquiredAt: 'x', token: 'theirs' });
    s.withLock(() => {
      const mine = JSON.parse(fs.readFileSync(lock, 'utf8'));
      assert.deepEqual(Object.keys(mine), ['pid', 'host', 'tool', 'acquiredAt', 'token']);
      fs.writeFileSync(lock, other);
    });
    assert.equal(fs.readFileSync(lock, 'utf8'), other);
  } finally { fs.rmSync(R, { recursive: true, force: true }); }
});
