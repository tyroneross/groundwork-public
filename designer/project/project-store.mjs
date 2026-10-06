// Groundwork project store (JS twin of project_store.py). Zero dependencies.
// Contract: .build-loop/plans/project-store-plan.md, Frozen Interface A-E + AM-1..AM-16.
// Importing this module has no side effects. The parity harness
// (designer/tests/test_project_parity.py) runs one op script through both libs.
//
// Parity rules chosen under AM-16 (identical comment at the top of project_store.py):
//   P1  Clock: one now() per outermost lock acquisition (the "op stamp"); every
//       record written under that lock, the lock's acquiredAt included, uses it.
//       Outside a lock, a read calls now() only when it needs a value
//       (absent project.json default doc; snapshot generatedAt, which the
//       absent default doc then reuses).
//   P2  writeBytes/writeJson: rel is relative to .groundwork/ (AM-12), the
//       caller must hold the lock (StoreError state), identical bytes are not
//       rewritten. Every outermost lock writes .groundwork/.gitignore if absent.
//   P3  Board entry `valid` = JSON object whose schema is decision-set/v1; errors
//       are language-neutral strings. Full decision_record.validate is not run
//       (the JS side cannot run it).
//   P4  Decision items follow decision_record.Ruleable; id/title that resolve to
//       "" become null (AM-7). A ruleable array field (axes/openItems/compares)
//       that is present, non-null and not a list contributes no items and adds
//       "<field> must be a list" to the summary `errors` and the board entry
//       `errors` (the board stays valid).
//   P5  Workspace notes in the D-02u projection need a string id and string
//       text; non-string createdAt/processedAt read as null; sort key is
//       (createdAt or "", id).
//   P6  upsertDraft with identical fields changes nothing; addFeedback with an
//       existing id is idempotent when text+section match (submits a draft when
//       submit=true), else StoreError state; submit of a submitted item with
//       the same/no text is a no-op, different text -> state; submit of a
//       processed item -> state (no backward move).
//   P7  Saved-work submit (submitFeedback or addFeedback submit=true) mirrors a
//       workspace note in the same lock whenever the item ends "submitted" and
//       no note with that id exists (AM-5).
//   P8  recordMigration with migratedAt null keeps the old migratedAt when the
//       rest of the entry is unchanged, else stamps now.
//   P9  Artifact mtime = the path's own mtime (directory mtime for canvas),
//       floored to ms from the ns stat. Canvas htmlFile tie on mtime -> the
//       smallest name.
//   P10 Snapshot warnings order: lock warnings; per migration (error ->
//       migration-failed, conflict -> conflict); workspace conflict;
//       canvas-invalid-rows; legacy-unmigrated per board.
//   P11 readBoard falls back to the legacy .designdoc/<slug>/decisions.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const SCHEMA = 'groundwork.project/v1';
export const SNAPSHOT_SCHEMA = 'groundwork.project-snapshot/v1';
export const CONTRACT_SCHEMA = 'groundwork.project-agent-contract/v1';
export const DECISION_SET_SCHEMA = 'groundwork.decision-set/v1';
export const SECTIONS = ['decisions', 'canvas', 'saved-work', 'spec', 'memory', 'general'];
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const FEEDBACK_ID_RE = /^fb_[A-Za-z0-9_-]{1,97}$/;
const PREF_SCOPES = ['repo', 'decisions', 'canvas', 'saved-work', 'spec'];
const PREF_SOURCES = ['person', 'agent', 'decision', 'migration'];
const ARTIFACT_KINDS = ['spec', 'designer-state', 'canvas'];
const MIGRATION_KINDS = ['decision-board', 'workspace', 'pointer'];
const MIGRATION_STATUSES = ['migrated', 'unchanged', 'recopied', 'conflict', 'error'];
const LEGACY_WORKSPACES = ['.designdoc/.groundwork-workspace/workspace.json', '.groundwork-workspace/workspace.json'];
const CANVAS_DIRS = ['.designdoc/mockups/.canvas', 'mockups/.canvas'];
const WORKSPACE_MIGRATION_ID = 'workspace:workspace.json';
const WS_ORIGIN_REF = '.groundwork/workspace.json';
const MAX_FEEDBACK = 5000;
const MAX_PREFS = 500;

export class StoreError extends Error {
  constructor(code, message) { super(message); this.name = 'StoreError'; this.code = code; }
}
const fail = (code, message) => { throw new StoreError(code, message); };

export const canonical = (value) => JSON.stringify(value, null, 2) + '\n';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cpLen = (s) => [...s].length;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Python str.strip() whitespace set (differs from JS trim: includes \x1c-\x1f, \x85).
const PY_WS = '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'g');
const pyStrip = (s) => s.replace(PY_STRIP_RE, '');

// Python bool(v) for JSON values.
export function pyTruthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) return Object.keys(v).length > 0;
  return true;
}
const pyOr = (a, b) => (pyTruthy(a) ? a : b);
// Python str()/f-string rendering of a JSON scalar.
const pyStr = (v) => {
  if (typeof v === 'string') return v;
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v === null || v === undefined) return 'None';
  return String(v);
};
// JS template rendering, spelled out so the Python twin can match it.
const jsStr = (v) => (v === undefined || v === null ? 'null' : String(v));

// decision_record._truthy
function rulingPresent(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return pyStrip(v) !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) return Object.keys(v).length > 0;
  return true;
}

// decision_record.ADAPTER (only the fields the summary needs).
const ADAPTER = {
  title: { axes: 'title', openItems: 'question', compares: 'question' },
  chosen: { axes: 'selected', openItems: 'ruling', compares: 'ruling' },
  freeText: { axes: 'note', openItems: 'rulingText', compares: 'rulingText' },
  ruledAt: { axes: 'ruledAt', openItems: 'ruledAt', compares: 'ruledAt' },
};
const RULEABLE_ARRAYS = ['axes', 'openItems', 'compares'];

// P4: only a list contributes items; any other present, non-null value is
// reported in `errors` (Python empties the field before decision_record.ruleables).
export function decisionSummary(record) {
  const items = [];
  let open = 0; let ruled = 0;
  const errors = [];
  const rec = isObj(record) ? record : {};
  for (const source of RULEABLE_ARRAYS) {
    const present = rec[source] !== undefined && rec[source] !== null;
    if (present && !Array.isArray(rec[source])) errors.push(`${source} must be a list`);
    const arr = Array.isArray(rec[source]) ? rec[source] : [];
    for (const raw of arr) {
      if (!isObj(raw)) continue;
      const sid = pyStr(pyOr(raw.id, ''));
      const via = (f) => { const v = raw[ADAPTER[f][source]]; return v === undefined ? null : v; };
      const title = pyOr(via('title'), sid);
      const chosen = via('chosen');
      const note = pyOr(via('freeText'), null);
      const ruledAt = pyOr(via('ruledAt'), null);
      const lane = pyTruthy(raw.addressed) || rulingPresent(chosen) ? 'ruled' : 'open';
      if (lane === 'ruled') ruled++; else open++;
      items.push({ id: sid === '' ? null : sid, source, title: title === '' ? null : title, lane, ruling: chosen, note, ruledAt });
    }
  }
  return { open, ruled, items, errors };
}

// AM-8: realpath; under a .groundwork component -> its parent; .designdoc -> parent.
export function projectRoot(target) {
  let real;
  try { real = fs.realpathSync(target); } catch { real = path.resolve(target); }
  const parts = real.split(path.sep);
  const i = parts.indexOf('.groundwork');
  if (i > 0) return parts.slice(0, i).join(path.sep) || path.sep;
  return path.basename(real) === '.designdoc' ? path.dirname(real) : real;
}

// ---------------------------------------------------------------- validators
function validateText(text, max, label = 'text') {
  if (typeof text !== 'string') fail('invalid', `${label} must be a string`);
  const t = pyStrip(text);
  const n = cpLen(t);
  if (n < 1 || n > max) fail('invalid', `${label} must contain 1-${max} characters`);
  return t;
}

export function validateFeedbackInput(input = {}) {
  const { id = null, section, text, target = null, origin = null } = input || {};
  if (!SECTIONS.includes(section)) fail('invalid', `section must be one of ${SECTIONS.join(', ')}`);
  if (id !== null && id !== undefined && !(typeof id === 'string' && FEEDBACK_ID_RE.test(id))) fail('invalid', 'feedback id must match ^fb_[A-Za-z0-9_-]{1,97}$');
  const t = validateText(text, 4000);
  if (target !== null && target !== undefined && !(typeof target === 'string' && cpLen(target) <= 200)) fail('invalid', 'target must be null or a string of at most 200 characters');
  let o = null;
  if (origin !== null && origin !== undefined) {
    if (!isObj(origin) || !['person', 'agent'].includes(origin.kind)) fail('invalid', 'origin.kind must be person or agent');
    const ref = origin.ref ?? null;
    if (ref !== null && typeof ref !== 'string') fail('invalid', 'origin.ref must be null or a string');
    o = { kind: origin.kind, ref };
  }
  return { id: id ?? null, section, text: t, target: target ?? null, origin: o };
}

const MAX_DRAFT_REVISION = Number.MAX_SAFE_INTEGER; // 2**53-1, the same range as project_store.py

// A draft write's client sequence: null, or a whole number 0..2**53-1.
export function validateDraftRevision(revision) {
  if (revision === null || revision === undefined) return null;
  if (!Number.isInteger(revision) || revision < 0 || revision > MAX_DRAFT_REVISION) fail('invalid', 'revision must be null or a whole number from 0 to 9007199254740991');
  return revision;
}

// A revisioned write must be newer than the revision the draft already holds.
function refuseStaleRevision(cur, revision) {
  const held = cur.draftRevision;
  if (revision === null || !Number.isInteger(held)) return;
  if (revision <= held) fail('stale', `feedback ${cur.id} revision ${revision} is not newer than stored revision ${held}`);
}

export function validatePreferenceInput(input = {}) {
  const { text, scope = 'repo', provenance = null, supersedes = null } = input || {};
  if (!PREF_SCOPES.includes(scope)) fail('invalid', `scope must be one of ${PREF_SCOPES.join(', ')}`);
  let prov = { source: 'person', ref: null };
  if (provenance !== null && provenance !== undefined) {
    if (!isObj(provenance) || !PREF_SOURCES.includes(provenance.source)) fail('invalid', `provenance.source must be one of ${PREF_SOURCES.join(', ')}`);
    const ref = provenance.ref ?? null;
    if (ref !== null && typeof ref !== 'string') fail('invalid', 'provenance.ref must be null or a string');
    prov = { source: provenance.source, ref };
  }
  const t = validateText(text, 2000);
  if (supersedes !== null && supersedes !== undefined && typeof supersedes !== 'string') fail('invalid', 'supersedes must be a preference id');
  return { text: t, scope, provenance: prov, supersedes: supersedes ?? null };
}

// ----------------------------------------------------------------- workspace
// Frozen copy of designer/server/workspace-store.mjs:13-20 (AM-4); a non-object
// review reads as {} instead of throwing.
export function normalizeReview(review = {}) {
  const r = isObj(review) ? review : {};
  return {
    suggestions: r.suggestions !== false,
    optionCount: Math.min(5, Math.max(2, Number(r.optionCount) || 3)),
    layout: r.layout === 'single' ? 'single' : 'compare',
    fidelity: r.fidelity === 'polished' ? 'polished' : 'low',
  };
}

// ------------------------------------------------------------------- helpers
const emptyWorkspace = () => ({ version: 1, notes: [], alternatives: [], selectedId: null, sources: [], review: { suggestions: true, optionCount: 3, layout: 'compare', fidelity: 'low' } });
const isoNow = () => new Date().toISOString();
const defaultNewId = (prefix) => prefix + randomUUID().replaceAll('-', '');
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const prefRank = (p) => [p.status === 'active' ? 0 : 1, p.createdAt || '', p.id || ''];
const cmpPref = (a, b) => { const x = prefRank(a); const y = prefRank(b); return (x[0] - y[0]) || cmpStr(x[1], y[1]) || cmpStr(x[2], y[2]); };
const sortedPrefs = (prefs, includeSuperseded) => clone(prefs.filter(p => isObj(p) && (includeSuperseded || p.status === 'active'))).sort(cmpPref);
const isoFromNs = (ns) => new Date(Number(ns / 1000000n)).toISOString();

function lstat(p) { return fs.lstatSync(p, { throwIfNoEntry: false }); }

function projectDoc(t) {
  return { schema: SCHEMA, rev: 0, createdAt: t, updatedAt: t, feedback: [], preferences: [], artifacts: [], migrations: [] };
}

function checkProjectDoc(doc, file) {
  if (!isObj(doc) || doc.schema !== SCHEMA || !Number.isInteger(doc.rev) || !['feedback', 'preferences', 'artifacts', 'migrations'].every(k => Array.isArray(doc[k]))) {
    fail('invalid', `${file} is not a ${SCHEMA} document`);
  }
  return doc;
}

function checkWorkspace(value, file) {
  if (!isObj(value) || value.version !== 1 || !['notes', 'alternatives', 'sources'].every(k => Array.isArray(value[k]))) fail('invalid', `${file} is not a supported workspace record`);
  return value;
}

export function projectStore(root, { now = isoNow, newId = defaultNewId, tool = 'node', lockTimeoutMs = 2000, lockRetryMs = 25 } = {}) {
  const R = projectRoot(root);
  const G = path.join(R, '.groundwork');
  const lockPath = path.join(G, 'write.lock');
  const projectFile = path.join(G, 'project.json');
  const warnings = [];
  let held = 0;
  let lockBody = null;
  let opStamp = null;

  const rel = (abs) => path.relative(R, abs).split(path.sep).join('/');
  const stamp = () => (held > 0 && opStamp !== null ? opStamp : now());

  // A.3: refuse symlinks along R-relative path (each component below R).
  function refuseSymlinks(abs) {
    const parts = path.relative(R, abs).split(path.sep).filter(Boolean);
    let cur = R;
    for (const part of parts) {
      cur = path.join(cur, part);
      if (lstat(cur)?.isSymbolicLink()) fail('symlink', `refusing symlink: ${cur}`);
    }
  }
  // Resolve a store-relative path (under .groundwork) safely.
  function storePath(relPath) {
    if (typeof relPath !== 'string' || !relPath || path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) fail('invalid', `invalid store path: ${relPath}`);
    return path.join(G, relPath);
  }
  function readFileSafe(abs) {
    refuseSymlinks(abs);
    const st = lstat(abs);
    if (!st) return null;
    if (!st.isFile()) fail('invalid', `not a regular file: ${abs}`);
    return fs.readFileSync(abs);
  }

  // ------------------------------------------------------------------- lock
  function acquire(t) {
    refuseSymlinks(G);
    fs.mkdirSync(G, { recursive: true });
    refuseSymlinks(G);
    const deadline = Date.now() + lockTimeoutMs;
    let broke = false;
    for (;;) {
      const body = JSON.stringify({ pid: process.pid, host: os.hostname(), tool, acquiredAt: t, token: randomUUID().replace(/-/g, '') });
      try {
        const fd = fs.openSync(lockPath, 'wx', 0o600);
        try { fs.writeSync(fd, body); } finally { fs.closeSync(fd); }
        lockBody = body;
        return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
      if (Date.now() < deadline) { sleepSync(lockRetryMs); continue; }
      let holder = null, seen = '';
      try { seen = fs.readFileSync(lockPath, 'utf8'); holder = JSON.parse(seen); } catch { /* unreadable: not provably stale */ }
      if (!broke && isObj(holder) && holder.host === os.hostname() && Number.isInteger(holder.pid) && holder.pid > 0) {
        let dead = false;
        try { process.kill(holder.pid, 0); } catch (err) { dead = err.code === 'ESRCH'; }
        if (dead && breakStale(seen)) {
          warnings.push({ code: 'lock-stale-broken', detail: `removed stale lock ${lockPath} held by dead pid ${holder.pid}` });
          broke = true;
          continue;
        }
      }
      fail('lock-timeout', `write lock ${lockPath} is held by pid ${isObj(holder) ? jsStr(holder.pid) : 'null'}; retry after the other writer finishes`);
    }
  }

  // Remove a dead holder's lock without racing another breaker: rename it
  // aside (atomic), compare with what was judged dead, and put a lock that
  // changed in between back (link never overwrites).
  function breakStale(seen) {
    const aside = path.join(G, `write.lock.${randomUUID()}.stale`);
    try { fs.renameSync(lockPath, aside); } catch (e) { if (e.code === 'ENOENT') return true; throw e; }
    try {
      if (fs.readFileSync(aside, 'utf8') === seen) return true;
      try { fs.linkSync(aside, lockPath); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      return false;
    } finally {
      fs.rmSync(aside, { force: true });
    }
  }

  function withLock(fn) {
    if (held > 0) { held++; try { return fn(); } finally { held--; } }
    const t = now();
    acquire(t);
    held = 1;
    opStamp = t;
    try {
      const gi = path.join(G, '.gitignore');
      if (!lstat(gi)) writeBytesLocked(gi, Buffer.from('*\n'));
      return fn();
    } finally {
      held = 0;
      opStamp = null;
      // Remove the lock only while it is still ours.
      try { if (fs.readFileSync(lockPath, 'utf8') === lockBody) fs.rmSync(lockPath, { force: true }); } catch { /* gone */ }
      lockBody = null;
    }
  }

  // ------------------------------------------------------------------ writes
  function writeBytesLocked(abs, buf) {
    refuseSymlinks(abs);
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    refuseSymlinks(abs);
    const st = lstat(abs);
    if (st && !st.isFile()) fail('invalid', `not a regular file: ${abs}`);
    if (st && Buffer.compare(fs.readFileSync(abs), buf) === 0) return false;
    const tmp = path.join(dir, `.${path.basename(abs)}.${randomUUID()}.tmp`);
    try {
      // fsync before rename, as the Python twin does: a crash after the rename
      // must not leave an empty file in place of a record.
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try { fs.writeSync(fd, buf); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, abs);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return true;
  }
  function writeBytes(relPath, buf) {
    if (held < 1) fail('state', 'writeBytes requires the write lock (use withLock)');
    if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array)) fail('invalid', 'data must be bytes');
    return writeBytesLocked(storePath(relPath), Buffer.from(buf));
  }
  function writeJson(relPath, value) { return writeBytes(relPath, Buffer.from(canonical(value), 'utf8')); }

  // ----------------------------------------------------------------- project
  // `t` is used only when project.json is absent; undefined -> stamp().
  function loadProject(t) {
    const buf = readFileSafe(projectFile);
    if (buf === null) return projectDoc(t ?? stamp());
    let doc;
    try { doc = JSON.parse(buf.toString('utf8')); } catch (e) { fail('invalid', `project.json is not valid JSON: ${e.message}`); }
    return checkProjectDoc(doc, 'project.json');
  }
  function readProject() { return loadProject(); }

  function mutate(fn) {
    return withLock(() => {
      const doc = loadProject();
      const before = canonical(doc);
      const result = fn(doc, stamp());
      if (canonical(doc) === before) return result;
      doc.rev += 1;
      doc.updatedAt = stamp();
      writeJson('project.json', doc);
      return result;
    });
  }

  function init() {
    return withLock(() => {
      if (!lstat(projectFile)) writeJson('project.json', projectDoc(stamp()));
      return loadProject();
    });
  }

  // --------------------------------------------------------------- workspace
  function workspaceSource() {
    refuseSymlinks(G);
    const primary = path.join(G, 'workspace.json');
    const found = [];
    const pbuf = readFileSafe(primary);
    if (pbuf !== null) found.push([primary, pbuf]);
    else {
      for (const p of LEGACY_WORKSPACES) {
        const abs = path.join(R, p);
        const buf = readFileSafe(abs);
        if (buf !== null) found.push([abs, buf]);
      }
    }
    if (!found.length) return { value: emptyWorkspace(), legacy: false, abs: null, buf: null, conflict: false };
    const [abs, buf] = found[0];
    let value;
    try { value = JSON.parse(buf.toString('utf8')); } catch (e) { fail('invalid', `${rel(abs)} is not valid JSON: ${e.message}`); }
    checkWorkspace(value, rel(abs));
    value.review = normalizeReview(value.review);
    const conflict = found.length > 1 && Buffer.compare(found[0][1], found[1][1]) !== 0;
    return { value, legacy: abs !== primary, abs, buf, conflict };
  }
  function readWorkspace() { const s = workspaceSource(); return { value: s.value, legacy: s.legacy }; }

  function changeWorkspace(fn) {
    return withLock(() => {
      const src = workspaceSource();
      if (src.conflict) fail('conflict', 'both legacy workspace files exist and differ; migrate first');
      const value = src.value;
      const before = canonical(value);
      const result = fn(value);
      const after = canonical(value);
      if (after === before) return result;
      checkWorkspace(value, 'workspace');
      const data = Buffer.from(after, 'utf8');
      writeBytes('workspace.json', data);
      if (src.legacy) {
        recordMigration({
          id: WORKSPACE_MIGRATION_ID, kind: 'workspace', source: rel(src.abs), dest: '.groundwork/workspace.json',
          sourceSha256: sha256(src.buf), destSha256: sha256(data), status: 'migrated', migratedAt: null, note: null,
        });
      }
      return result;
    });
  }

  function selectDesign(id) {
    return changeWorkspace(v => {
      if (!v.alternatives.some(a => isObj(a) && a.id === id)) fail('not-found', `unknown design: ${id}`);
      v.selectedId = id;
      return id;
    });
  }

  // ------------------------------------------------------------------ canvas
  function canvasDir() {
    for (const c of CANVAS_DIRS) {
      const abs = path.join(R, c);
      refuseSymlinks(abs);
      if (lstat(abs)?.isDirectory()) return abs;
    }
    return null;
  }
  // The canvas server keeps only control files in .canvas/ and serves the page
  // from the folder above it (canvas-server.mjs CTRL_DIR = <page dir>/.canvas),
  // so look beside .canvas/ when .canvas/ itself holds no page.
  function canvasHtml(ctrl) {
    return canvasHtmlIn(ctrl) || canvasHtmlIn(path.dirname(ctrl));
  }
  function canvasHtmlIn(dir) {
    const files = fs.readdirSync(dir).filter(n => n.endsWith('.html'))
      .map(n => ({ n, st: fs.lstatSync(path.join(dir, n), { bigint: true }) }))
      .filter(x => x.st.isFile());
    if (!files.length) return null;
    files.sort((a, b) => (a.st.mtimeNs > b.st.mtimeNs ? -1 : a.st.mtimeNs < b.st.mtimeNs ? 1 : 0) || cmpStr(a.n, b.n));
    return rel(path.join(dir, files[0].n));
  }
  function canvasProjection() {
    const dir = canvasDir();
    if (!dir) return { available: false, dir: null, htmlFile: null, rows: [], invalidRows: 0, cursorIdx: -1, journal: null };
    const journal = path.join(dir, 'feedback.jsonl');
    const valid = [];
    let invalidRows = 0;
    const jbuf = readFileSafe(journal);
    if (jbuf !== null) {
      for (const line of jbuf.toString('utf8').split('\n')) {
        if (!pyStrip(line)) continue;
        let row;
        try { row = JSON.parse(line); } catch { invalidRows++; continue; }
        if (!isObj(row) || !['ts', 'id', 'kind'].every(k => typeof row[k] === 'string' && row[k].length > 0)) { invalidRows++; continue; }
        valid.push(row);
      }
    }
    let lastId = null;
    const cbuf = readFileSafe(path.join(dir, 'cursor.json'));
    if (cbuf !== null) { try { const c = JSON.parse(cbuf.toString('utf8')); if (isObj(c) && typeof c.last_id === 'string') lastId = c.last_id; } catch { /* absent semantics */ } }
    const cursorIdx = lastId === null ? -1 : valid.findIndex(r => r.id === lastId);
    return { available: true, dir: rel(dir), htmlFile: canvasHtml(dir), rows: valid, invalidRows, cursorIdx, journal: rel(journal) };
  }

  // ---------------------------------------------------------------- feedback
  function unifiedFeedback(doc, ws, canvas) {
    const out = doc.feedback.map(f => clone(f));
    const storeIds = new Set(doc.feedback.filter(isObj).map(f => f.id));
    for (const n of ws.notes) {
      if (!isObj(n) || typeof n.id !== 'string' || typeof n.text !== 'string') continue;
      if (storeIds.has(n.id)) continue; // AM-5: the store item is the record
      const created = typeof n.createdAt === 'string' ? n.createdAt : null;
      const processed = typeof n.processedAt === 'string' ? n.processedAt : null;
      out.push({
        id: n.id, section: 'saved-work', target: null, text: n.text, status: n.status === 'processed' ? 'processed' : 'submitted',
        createdAt: created, updatedAt: processed ?? created, submittedAt: created,
        processedAt: processed, origin: { kind: 'workspace', ref: WS_ORIGIN_REF },
      });
    }
    canvas.rows.forEach((row, i) => {
      if (row.kind === 'toggle') return;
      const text = typeof row.text === 'string' && row.text.length > 0 ? row.text
        : row.kind === 'decide' ? `[${row.kind}] ${pyStr(row.dim)}=${pyStr(row.value)}` : `[${row.kind}]`;
      out.push({
        id: `canvas:${row.id}`, section: 'canvas', target: typeof row.component === 'string' && row.component ? row.component : null, text,
        status: i <= canvas.cursorIdx ? 'processed' : 'submitted',
        createdAt: row.ts, updatedAt: row.ts, submittedAt: row.ts, processedAt: null,
        origin: { kind: 'canvas', ref: canvas.journal },
      });
    });
    out.sort((a, b) => cmpStr(a.createdAt || '', b.createdAt || '') || cmpStr(a.id || '', b.id || ''));
    return out;
  }

  function listFeedback({ section = null, status = null } = {}) {
    const doc = readProject();
    const ws = workspaceSource().value;
    const canvas = canvasProjection();
    return unifiedFeedback(doc, ws, canvas).filter(f => (!section || f.section === section) && (!status || f.status === status));
  }

  function genFeedbackId() {
    const id = newId('fb_');
    if (typeof id !== 'string' || !FEEDBACK_ID_RE.test(id)) fail('invalid', 'generated feedback id is invalid');
    return id;
  }
  function newFeedback(doc, t, v, status) {
    if (doc.feedback.length >= MAX_FEEDBACK) fail('limit', `feedback limit of ${MAX_FEEDBACK} reached`);
    const id = v.id ?? genFeedbackId();
    const item = {
      id, section: v.section, target: v.target, text: v.text, status,
      createdAt: t, updatedAt: t, submittedAt: status === 'submitted' ? t : null, processedAt: null, origin: v.origin,
    };
    if (v.revision !== null && v.revision !== undefined) item.draftRevision = v.revision;
    doc.feedback.push(item);
    return item;
  }

  function upsertDraft(input) {
    const v = { ...validateFeedbackInput(input), revision: validateDraftRevision((input || {}).revision) };
    return mutate((doc, t) => {
      const old = v.id === null ? undefined : doc.feedback.find(f => isObj(f) && f.id === v.id);
      if (!old) return clone(newFeedback(doc, t, v, 'draft'));
      if (old.status !== 'draft') fail('state', `feedback ${old.id} is ${old.status}; only drafts can change`);
      refuseStaleRevision(old, v.revision);
      const next = { ...old, section: v.section, target: v.target, text: v.text, origin: v.origin };
      if (v.revision !== null) next.draftRevision = v.revision;
      if (canonical(next) !== canonical(old)) { Object.assign(old, next); old.updatedAt = t; }
      return clone(old);
    });
  }

  function wsGuard() {
    if (workspaceSource().conflict) fail('conflict', 'both legacy workspace files exist and differ; migrate first');
  }
  // AM-5: a submitted saved-work item appears as a Designer workspace note.
  function mirrorNote(item) {
    if (item.section !== 'saved-work' || item.status !== 'submitted') return;
    changeWorkspace(ws => {
      if (ws.notes.some(n => isObj(n) && n.id === item.id)) return;
      ws.notes.push({ id: item.id, text: item.text, review: normalizeReview(ws.review), status: 'received', createdAt: item.submittedAt });
    });
  }

  function submitFeedback(id, text = null) {
    const nt = text === null || text === undefined ? null : validateText(text, 4000);
    return withLock(() => {
      const pre = loadProject().feedback.find(f => isObj(f) && f.id === id);
      if (pre && pre.section === 'saved-work') wsGuard();
      const item = mutate((doc, t) => {
        const cur = doc.feedback.find(f => isObj(f) && f.id === id);
        if (!cur) fail('not-found', `unknown feedback: ${id}`);
        if (cur.status === 'submitted') {
          if (nt === null || nt === cur.text) return clone(cur);
          fail('state', `feedback ${id} is submitted; its text is immutable`);
        }
        if (cur.status !== 'draft') fail('state', `feedback ${id} is ${cur.status}`);
        if (nt !== null) cur.text = nt;
        cur.status = 'submitted'; cur.submittedAt = t; cur.updatedAt = t;
        return clone(cur);
      });
      mirrorNote(item);
      return item;
    });
  }

  function addFeedback({ section, text, target = null, origin = null, submit = true, id = null } = {}) {
    const v = validateFeedbackInput({ id, section, text, target, origin });
    return withLock(() => {
      if (section === 'saved-work' && submit) wsGuard();
      const item = mutate((doc, t) => {
        const old = v.id === null ? undefined : doc.feedback.find(f => isObj(f) && f.id === v.id);
        if (!old) return clone(newFeedback(doc, t, v, submit ? 'submitted' : 'draft'));
        if (old.text !== v.text || old.section !== v.section) fail('state', `feedback ${old.id} exists with different content`);
        if (submit && old.status === 'draft') { old.status = 'submitted'; old.submittedAt = t; old.updatedAt = t; }
        return clone(old);
      });
      mirrorNote(item);
      return item;
    });
  }

  function deleteDraft(id, revision = null) {
    const rv = validateDraftRevision(revision);
    return mutate((doc) => {
      const i = doc.feedback.findIndex(f => isObj(f) && f.id === id);
      if (i < 0) fail('not-found', `unknown feedback: ${id}`);
      if (doc.feedback[i].status !== 'draft') fail('state', `feedback ${id} is ${doc.feedback[i].status}; only drafts can be deleted`);
      refuseStaleRevision(doc.feedback[i], rv);
      doc.feedback.splice(i, 1);
      return { deleted: id };
    });
  }

  function acknowledge(ids) {
    if (!Array.isArray(ids)) fail('invalid', 'ids must be an array');
    return withLock(() => {
      const acknowledged = []; const refused = []; const wsTargets = new Set();
      const wsNotes = new Set(workspaceSource().value.notes.filter(n => isObj(n) && typeof n.id === 'string').map(n => n.id));
      // Refuse before writing anything, so an ack never lands in project.json
      // and then fails on the workspace half.
      if (ids.some(id => wsNotes.has(id))) wsGuard();
      mutate((doc, t) => {
        for (const id of ids) {
          if (typeof id === 'string' && id.startsWith('canvas:')) { refused.push({ id, reason: 'canvas-cursor-owned' }); continue; }
          const item = doc.feedback.find(f => isObj(f) && f.id === id);
          if (item) {
            if (item.status === 'draft') { refused.push({ id, reason: 'draft' }); continue; }
            if (item.status === 'submitted') { item.status = 'processed'; item.processedAt = t; item.updatedAt = t; }
            acknowledged.push(id);
            if (wsNotes.has(id)) wsTargets.add(id); // AM-5: mark both
          } else if (wsNotes.has(id)) { wsTargets.add(id); acknowledged.push(id); }
          else refused.push({ id, reason: 'unknown' });
        }
      });
      if (wsTargets.size) {
        changeWorkspace(v => {
          for (const n of v.notes) if (isObj(n) && wsTargets.has(n.id) && n.status !== 'processed') { n.status = 'processed'; n.processedAt = stamp(); }
        });
      }
      return { acknowledged, refused };
    });
  }

  // ------------------------------------------------------------- preferences
  function addPreference(input) {
    const v = validatePreferenceInput(input);
    return mutate((doc, t) => {
      if (doc.preferences.length >= MAX_PREFS) fail('limit', `preference limit of ${MAX_PREFS} reached`);
      let old = null;
      if (v.supersedes !== null) {
        old = doc.preferences.find(p => isObj(p) && p.id === v.supersedes);
        if (!old) fail('not-found', `unknown preference: ${v.supersedes}`);
        if (old.status === 'superseded') fail('state', `preference ${old.id} is already superseded`);
      }
      const id = newId('pref_');
      const pref = {
        id, text: v.text, scope: v.scope, provenance: v.provenance, status: 'active',
        supersedes: v.supersedes, supersededBy: null, createdAt: t, updatedAt: t,
      };
      if (old) { old.status = 'superseded'; old.supersededBy = id; old.updatedAt = t; }
      doc.preferences.push(pref);
      return clone(pref);
    });
  }
  function listPreferences({ includeSuperseded = false } = {}) {
    return sortedPrefs(readProject().preferences, includeSuperseded);
  }

  // ----------------------------------------------------------------- boards
  function boardEntry(slug, buf, legacy, migrations) {
    const dirRel = legacy ? `.designdoc/${slug}` : `.groundwork/decisions/${slug}`;
    const e = { slug, path: dirRel, legacy, valid: true, errors: [], open: 0, ruled: 0, conflict: null, items: [] };
    let rec = null;
    try { rec = JSON.parse(buf.toString('utf8')); } catch { e.valid = false; e.errors.push('decisions.json is not valid JSON'); }
    if (e.valid && (!isObj(rec) || rec.schema !== DECISION_SET_SCHEMA)) { e.valid = false; e.errors.push(`schema must be ${DECISION_SET_SCHEMA}`); }
    if (e.valid) { const s = decisionSummary(rec); e.open = s.open; e.ruled = s.ruled; e.items = s.items; e.errors.push(...s.errors); }
    const m = migrations.find(x => isObj(x) && x.id === `decisions:${slug}`);
    if (m && m.status === 'conflict') e.conflict = { source: m.source ?? null, dest: m.dest ?? null, note: m.note ?? null };
    return e;
  }
  function listDirs(abs) {
    refuseSymlinks(abs);
    if (!lstat(abs)?.isDirectory()) return [];
    return fs.readdirSync(abs).sort(cmpStr).filter(n => SLUG_RE.test(n) && lstat(path.join(abs, n))?.isDirectory());
  }
  function listBoards(migrations = null) {
    const mig = migrations ?? readProject().migrations;
    const out = [];
    const seen = new Set();
    for (const slug of listDirs(path.join(G, 'decisions'))) {
      const buf = readFileSafe(path.join(G, 'decisions', slug, 'decisions.json'));
      if (buf === null) continue;
      seen.add(slug);
      out.push(boardEntry(slug, buf, false, mig));
    }
    for (const slug of listDirs(path.join(R, '.designdoc'))) {
      if (seen.has(slug)) continue;
      const buf = readFileSafe(path.join(R, '.designdoc', slug, 'decisions.json'));
      if (buf === null) continue;
      let rec = null;
      try { rec = JSON.parse(buf.toString('utf8')); } catch { continue; }
      if (!isObj(rec) || rec.schema !== DECISION_SET_SCHEMA) continue;
      out.push(boardEntry(slug, buf, true, mig));
    }
    return out.sort((a, b) => cmpStr(a.slug, b.slug));
  }
  function checkSlug(slug) { if (typeof slug !== 'string' || !SLUG_RE.test(slug)) fail('invalid', `invalid slug: ${slug}`); }
  function readBoard(slug) {
    checkSlug(slug);
    for (const abs of [path.join(G, 'decisions', slug, 'decisions.json'), path.join(R, '.designdoc', slug, 'decisions.json')]) {
      const buf = readFileSafe(abs);
      if (buf !== null) return buf;
    }
    return fail('not-found', `no board: ${slug}`);
  }
  function writeBoard(slug, data) {
    checkSlug(slug);
    if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) fail('invalid', 'board data must be bytes');
    const buf = Buffer.from(data);
    let rec;
    try { rec = JSON.parse(buf.toString('utf8')); } catch (e) { fail('invalid', `board is not valid JSON: ${e.message}`); }
    if (!isObj(rec) || rec.schema !== DECISION_SET_SCHEMA) fail('invalid', `board schema must be ${DECISION_SET_SCHEMA}`);
    return withLock(() => writeBytes(`decisions/${slug}/decisions.json`, buf));
  }

  // -------------------------------------------------------------- artifacts
  function recordArtifact(kind, relPath, meta = null) {
    if (!ARTIFACT_KINDS.includes(kind)) fail('invalid', `artifact kind must be one of ${ARTIFACT_KINDS.join(', ')}`);
    if (typeof relPath !== 'string' || !relPath || path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) fail('invalid', `bad relative path: ${relPath}`);
    const abs = path.join(R, relPath);
    refuseSymlinks(abs);
    const st = lstat(abs);
    if (!st) fail('not-found', `artifact not found: ${relPath}`);
    const mtime = isoFromNs(fs.lstatSync(abs, { bigint: true }).mtimeNs);
    let buf; let m = meta;
    if (st.isDirectory()) {
      if (kind !== 'canvas') fail('invalid', `${kind} artifact must be a file`);
      buf = readFileSafe(path.join(abs, 'feedback.jsonl')) ?? Buffer.alloc(0);
      if (m === null || m === undefined) m = { htmlFile: canvasHtml(abs), journal: rel(path.join(abs, 'feedback.jsonl')) };
    } else {
      buf = readFileSafe(abs);
    }
    const relNorm = rel(abs);
    const metaV = clone(m ?? {});
    return mutate((doc, t) => {
      const id = `${kind}:${relNorm}`;
      const entry = { id, kind, path: relNorm, sha256: sha256(buf), bytes: buf.length, mtime, recordedAt: t, meta: metaV };
      const i = doc.artifacts.findIndex(a => isObj(a) && a.id === id);
      if (i >= 0) {
        const o = doc.artifacts[i];
        if (o.sha256 === entry.sha256 && o.bytes === entry.bytes && o.mtime === entry.mtime && canonical(o.meta) === canonical(entry.meta)) entry.recordedAt = o.recordedAt;
        doc.artifacts[i] = entry;
      } else doc.artifacts.push(entry);
      return clone(entry);
    });
  }

  function recordMigration(entry) {
    if (!isObj(entry) || typeof entry.id !== 'string' || !entry.id) fail('invalid', 'migration entry needs an id');
    if (!MIGRATION_KINDS.includes(entry.kind)) fail('invalid', `migration kind must be one of ${MIGRATION_KINDS.join(', ')}`);
    if (!MIGRATION_STATUSES.includes(entry.status)) fail('invalid', `migration status must be one of ${MIGRATION_STATUSES.join(', ')}`);
    return mutate((doc, t) => {
      const e = {
        id: entry.id, kind: entry.kind, source: entry.source ?? null, dest: entry.dest ?? null,
        sourceSha256: entry.sourceSha256 ?? null, destSha256: entry.destSha256 ?? null, status: entry.status,
        migratedAt: entry.migratedAt ?? null, note: entry.note ?? null,
      };
      const i = doc.migrations.findIndex(x => isObj(x) && x.id === e.id);
      if (e.migratedAt === null) {
        const same = i >= 0 && canonical({ ...doc.migrations[i], migratedAt: null }) === canonical(e);
        e.migratedAt = same ? doc.migrations[i].migratedAt : t;
      }
      if (i >= 0) doc.migrations[i] = e; else doc.migrations.push(e);
      return clone(e);
    });
  }

  // --------------------------------------------------------------- snapshot
  function snapshot() {
    const generatedAt = stamp();
    const doc = loadProject(generatedAt);
    const boards = listBoards(doc.migrations);
    const ws = workspaceSource();
    const canvas = canvasProjection();
    const warn = warnings.map(w => clone(w));
    for (const m of doc.migrations) {
      if (m.status === 'error') warn.push({ code: 'migration-failed', detail: `${jsStr(m.id)}: ${m.note != null ? jsStr(m.note) : 'error'}` });
      if (m.status === 'conflict') warn.push({ code: 'conflict', detail: `${jsStr(m.id)}: ${jsStr(m.source)} and ${jsStr(m.dest)} both changed${pyTruthy(m.note) ? `; ${jsStr(m.note)}` : ''}` });
    }
    if (ws.conflict) warn.push({ code: 'conflict', detail: `${LEGACY_WORKSPACES[0]} and ${LEGACY_WORKSPACES[1]} differ` });
    if (canvas.invalidRows > 0) warn.push({ code: 'canvas-invalid-rows', detail: `${canvas.invalidRows} malformed row(s) in ${canvas.journal}` });
    for (const b of boards) if (b.legacy) warn.push({ code: 'legacy-unmigrated', detail: `${b.path} is not migrated to .groundwork/decisions/${b.slug}` });
    const wsv = ws.value;
    return {
      schema: SNAPSHOT_SCHEMA, root: R, rev: doc.rev, generatedAt,
      sections: {
        decisions: boards,
        canvas: { available: canvas.available, dir: canvas.dir, htmlFile: canvas.htmlFile, rows: canvas.rows.filter(r => r.kind !== 'toggle').length, invalidRows: canvas.invalidRows },
        savedWork: {
          available: ws.abs !== null, legacy: ws.legacy, selectedId: wsv.selectedId ?? null,
          alternatives: wsv.alternatives.filter(isObj).map(a => ({ id: a.id ?? null, rationale: a.rationale ?? '', createdAt: a.createdAt ?? null })),
          notes: wsv.notes.length,
        },
        spec: { artifacts: clone(doc.artifacts.filter(a => isObj(a) && (a.kind === 'spec' || a.kind === 'designer-state'))) },
        memory: { preferences: sortedPrefs(doc.preferences, true) },
      },
      feedback: unifiedFeedback(doc, wsv, canvas),
      migrations: clone(doc.migrations),
      warnings: warn,
    };
  }

  function agentContract() {
    const doc = readProject();
    const ws = workspaceSource().value;
    const canvas = canvasProjection();
    return {
      schema: CONTRACT_SCHEMA, root: R, rev: doc.rev, readConsumes: false,
      pending: unifiedFeedback(doc, ws, canvas).filter(f => f.status === 'submitted'),
      preferences: sortedPrefs(doc.preferences, false),
      decisions: listBoards(doc.migrations), // AM-6: items included
      ack: { method: 'POST', path: '/api/agent/ack', body: { ids: ['…'] }, cli: 'groundwork project ack <id>…' },
    };
  }

  return {
    root: R, init, withLock, writeJson, writeBytes, readProject, mutate,
    upsertDraft, submitFeedback, addFeedback, deleteDraft, listFeedback, acknowledge,
    addPreference, listPreferences, readWorkspace, changeWorkspace, selectDesign,
    listBoards: () => listBoards(), readBoard, writeBoard, recordArtifact, recordMigration,
    snapshot, agentContract, get warnings() { return [...warnings]; },
  };
}
