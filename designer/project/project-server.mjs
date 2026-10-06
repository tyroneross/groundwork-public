#!/usr/bin/env node
// project-server.mjs — Groundwork: one loopback server per repo for the
// integrated project pane (Decisions · Canvas · Saved work · Spec · Memory).
//
// Contract: .build-loop/plans/project-store-plan.md §Frozen Interface F
// (+ Amendments). Zero dependencies (Node stdlib). Every write goes through the
// project store library (designer/project/project-store.mjs) under the ONE
// shared lock `.groundwork/write.lock`. The server never writes outside
// `<repo>/.groundwork/` and never writes under any `.canvas/` directory.
//
// Usage:
//   node designer/project/project-server.mjs --repo <R> [--port N] \
//        [--proxy <origin>] [--no-migrate]
//
// Environment:
//   GROUNDWORK_PYTHON  executable used instead of `python3` for the two
//                      Python CLI calls this server makes
//                      (`-m designer.project migrate|snapshot --repo R --json`).
//                      Tests point it at a stub; normal use leaves it unset.
//
// Importing this module has no side effects (main() is guarded below).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { projectStore, projectRoot, StoreError, SCHEMA, SLUG_RE, DECISION_SET_SCHEMA } from './project-store.mjs';
import {
  STATIC_ROUTES, VISUAL_TYPES, VISUAL_HTML_HEADERS, utcCompactStamp, gitInfo,
} from '../decisions/decisions-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const INSTALL_ROOT = path.resolve(__dirname, '..', '..');
const PANE_DIR = path.join(INSTALL_ROOT, 'designer', 'project', 'app');
const BOARD_APP_DIR = path.join(INSTALL_ROOT, 'designer', 'decisions', 'app');

const PANE_ROUTES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/pane.js': { file: 'pane.js', type: 'application/javascript; charset=utf-8' },
  '/pane.css': { file: 'pane.css', type: 'text/css; charset=utf-8' },
};

const BODY_CAP = 64 * 1024;
const RECORD_CAP = 8 * 1024 * 1024;
const PY_TIMEOUT_MS = 30_000;
const PORT_BASE = 41000;
const PORT_SPAN = 2000;
const PORT_FALLBACKS = 20;

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** F: deterministic per-repo port. */
export function defaultPort(root) {
  let real;
  try { real = fs.realpathSync(root); } catch { real = path.resolve(root); }
  const h = createHash('sha256').update(real).digest('hex');
  return PORT_BASE + (parseInt(h.slice(0, 8), 16) % PORT_SPAN);
}

export function pythonExecutable(env = process.env) {
  return env.GROUNDWORK_PYTHON || 'python3';
}

function pyEnv() {
  return { ...process.env, PYTHONPATH: INSTALL_ROOT };
}

/** Run `python3 -m designer.project migrate --repo R --json` synchronously. */
export function runMigration(root) {
  const r = spawnSync(pythonExecutable(), ['-m', 'designer.project', 'migrate', '--repo', root, '--json'], {
    cwd: INSTALL_ROOT, env: pyEnv(), timeout: PY_TIMEOUT_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const fail = (detail) => ({ ok: false, warning: { code: 'migration-failed', detail } });
  if (r.error) return fail(`could not run ${pythonExecutable()}: ${r.error.message}`);
  if (r.status !== 0) {
    const tail = String(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ');
    return fail(`migrate exited ${r.status ?? r.signal}: ${tail}`.slice(0, 500));
  }
  try { return { ok: true, result: JSON.parse(r.stdout) }; } catch { return fail('migrate printed no JSON'); }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, message, code = null) { super(message); this.status = status; this.code = code; }
}

const STATUS_BY_CODE = { invalid: 400, 'not-found': 404, state: 409, conflict: 409, limit: 413, 'lock-timeout': 423 };

function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > cap) {
      req.resume();
      reject(new HttpError(413, `body exceeds ${cap} bytes`));
      return;
    }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > cap) { over = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => (over ? reject(new HttpError(413, `body exceeds ${cap} bytes`)) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req, BODY_CAP);
  if (raw.length === 0) return {};
  let v;
  try { v = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'body is not valid JSON', 'invalid'); }
  if (!isObj(v)) throw new HttpError(400, 'body must be a JSON object', 'invalid');
  return v;
}

// lstat-based regular-file check under `base`: no symlink at the file or at
// any component between base and the file. Returns abs path or null.
function regularFileUnder(base, ...parts) {
  let cur = base;
  for (const part of parts) {
    cur = path.join(cur, part);
    const st = fs.lstatSync(cur, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink()) return null;
  }
  return fs.lstatSync(cur).isFile() ? cur : null;
}

function decodeSegment(s) {
  try { return decodeURIComponent(s); } catch { return null; }
}

/**
 * Build the http.Server WITHOUT listening (tests may drive it via listen(0)).
 * opts: { repo, proxy?, warnings?: [] (startup warnings shown in /api/project),
 *         log?: (line) => void }
 */
export function makeServer(opts) {
  const R = projectRoot(opts.repo);
  const G = path.join(R, '.groundwork');
  const PROXY_ORIGIN = opts.proxy || null;
  const startupWarnings = opts.warnings || [];
  const log = opts.log || ((line) => console.log(line));
  const store = projectStore(R, { tool: 'project-server' });

  let server;
  const boundPort = () => { const a = server.address(); return a && typeof a === 'object' ? a.port : null; };

  const sendJSON = (res, status, obj, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(JSON.stringify(obj));
  };
  const sendBytes = (res, buf, type, extra = {}) => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
    res.end(buf);
  };
  const notFound = () => new HttpError(404, 'not found', 'not-found');
  const sendStatic = (res, dir, file, type) => {
    let data;
    try { data = fs.readFileSync(path.join(dir, file)); } catch { throw notFound(); }
    sendBytes(res, data, type);
  };

  // Origin + content-type guard for every mutating route.
  function requireLocalJson(req, { anyType = false } = {}) {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const port = boundPort();
      if (origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) {
        throw new HttpError(403, `cross-origin request refused (Origin ${origin})`);
      }
    }
    if (!anyType) {
      const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (ct !== 'application/json') throw new HttpError(403, 'mutating requests require Content-Type: application/json');
    }
  }

  // Resolve a board slug: store board (writable) or unmigrated legacy board
  // (read-only). Anything else is 404 — the slug never builds a path unless it
  // matches SLUG_RE and names an existing regular decisions.json.
  function resolveBoard(slug) {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
    const storeFile = regularFileUnder(R, '.groundwork', 'decisions', slug, 'decisions.json');
    if (storeFile) return { slug, legacy: false, dir: path.dirname(storeFile), file: storeFile };
    const legacyFile = regularFileUnder(R, '.designdoc', slug, 'decisions.json');
    if (!legacyFile) return null;
    try {
      const rec = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
      if (!isObj(rec) || rec.schema !== DECISION_SET_SCHEMA) return null;
    } catch { return null; }
    return { slug, legacy: true, dir: path.dirname(legacyFile), file: legacyFile };
  }

  async function proxyTo(res, method, pathAndQuery) {
    const target = PROXY_ORIGIN.replace(/\/+$/, '') + pathAndQuery;
    try {
      const upstream = await fetch(target, { method });
      const headers = { 'Cache-Control': 'no-store' };
      const ct = upstream.headers.get('content-type');
      if (ct) headers['Content-Type'] = ct;
      res.writeHead(upstream.status, headers);
      if (method === 'HEAD') return res.end();
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      return sendJSON(res, 502, { error: `proxy target unreachable: ${PROXY_ORIGIN}`, code: null });
    }
  }

  function runSnapshotCli() {
    return new Promise((resolve, reject) => {
      execFile(pythonExecutable(), ['-m', 'designer.project', 'snapshot', '--repo', R, '--json'], {
        cwd: INSTALL_ROOT, env: pyEnv(), timeout: PY_TIMEOUT_MS, maxBuffer: 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr || '').trim().split('\n').slice(-3).join(' | ');
          return reject(new HttpError(500, `snapshot failed: ${err.message}${tail ? ` (${tail})` : ''}`));
        }
        let out;
        try { out = JSON.parse(stdout); } catch { return reject(new HttpError(500, 'snapshot printed no JSON')); }
        if (!isObj(out) || typeof out.path !== 'string' || !out.path) return reject(new HttpError(500, 'snapshot output has no path'));
        resolve(out.path);
      });
    });
  }

  function projectSnapshot() {
    const snap = store.snapshot();
    snap.warnings = [...startupWarnings, ...snap.warnings];
    return snap;
  }

  // ── route table ─────────────────────────────────────────────────────────────
  async function route(req, res, url) {
    const p = url.pathname;
    const method = req.method;

    if (method === 'GET' && has(PANE_ROUTES, p)) {
      const e = PANE_ROUTES[p];
      return sendStatic(res, PANE_DIR, e.file, e.type);
    }

    if (p === '/api/health' && method === 'GET') {
      return sendJSON(res, 200, { ok: true, root: R, pid: process.pid, port: boundPort(), schema: SCHEMA });
    }
    if (p === '/api/project' && method === 'GET') return sendJSON(res, 200, projectSnapshot());
    if (p === '/api/feedback' && method === 'GET') {
      const section = url.searchParams.get('section') || null;
      const status = url.searchParams.get('status') || null;
      return sendJSON(res, 200, { items: store.listFeedback({ section, status }) });
    }
    if (p === '/api/agent/contract' && method === 'GET') return sendJSON(res, 200, store.agentContract());

    const fb = p.match(/^\/api\/feedback\/([^/]+)(\/submit)?$/);
    if (fb) {
      const id = decodeSegment(fb[1]);
      if (id === null) throw new HttpError(400, 'bad feedback id', 'invalid');
      if (fb[2]) {
        if (method !== 'POST') throw notFound();
        requireLocalJson(req);
        const body = await readJson(req);
        const item = store.submitFeedback(id, body.text ?? null);
        return sendJSON(res, 200, { ok: true, item });
      }
      if (method === 'PUT') {
        requireLocalJson(req);
        const body = await readJson(req);
        const item = store.upsertDraft({
          id, section: body.section, text: body.text, target: body.target ?? null, origin: { kind: 'person', ref: null },
        });
        return sendJSON(res, 200, { ok: true, item, savedAt: item.updatedAt });
      }
      if (method === 'DELETE') {
        requireLocalJson(req);
        await readBody(req, BODY_CAP);
        store.deleteDraft(id);
        return sendJSON(res, 200, { ok: true });
      }
      throw notFound();
    }

    if (p === '/api/preferences' && method === 'POST') {
      requireLocalJson(req);
      const body = await readJson(req);
      const preference = store.addPreference({
        text: body.text, scope: body.scope ?? 'repo', provenance: { source: 'person', ref: null }, supersedes: body.supersedes ?? null,
      });
      return sendJSON(res, 200, { ok: true, preference });
    }
    if (p === '/api/workspace/select' && method === 'POST') {
      requireLocalJson(req);
      const body = await readJson(req);
      if (typeof body.id !== 'string' || !body.id) throw new HttpError(400, 'id must be a design id', 'invalid');
      const selectedId = store.selectDesign(body.id);
      return sendJSON(res, 200, { ok: true, selectedId });
    }
    if (p === '/api/snapshot' && method === 'POST') {
      requireLocalJson(req);
      await readJson(req);
      const snapPath = await runSnapshotCli();
      return sendJSON(res, 200, { ok: true, path: snapPath });
    }
    if (p === '/api/agent/ack' && method === 'POST') {
      requireLocalJson(req);
      const body = await readJson(req);
      return sendJSON(res, 200, store.acknowledge(body.ids));
    }

    // ── decision boards ──────────────────────────────────────────────────────
    const bm = p.match(/^\/decisions\/([^/]+)(\/.*)?$/);
    if (bm) {
      const slug = decodeSegment(bm[1]);
      const board = resolveBoard(slug);
      if (!board) throw notFound();
      const rest = bm[2];
      if (rest === undefined) {
        if (method !== 'GET' && method !== 'HEAD') throw notFound();
        res.writeHead(301, { Location: `/decisions/${encodeURIComponent(slug)}/`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (method === 'GET' && has(STATIC_ROUTES, rest)) {
        const e = STATIC_ROUTES[rest];
        return sendStatic(res, BOARD_APP_DIR, e.file, e.type);
      }
      if (rest === '/record.json') {
        if (method === 'GET') {
          const data = board.legacy ? fs.readFileSync(board.file) : store.readBoard(slug);
          return sendBytes(res, data, 'application/json');
        }
        if (method === 'PUT') {
          requireLocalJson(req, { anyType: true });
          if (board.legacy) {
            await readBody(req, RECORD_CAP).catch(() => null);
            throw new HttpError(409, `board ${slug} is a legacy board (.designdoc/${slug}); run: groundwork project migrate`, 'state');
          }
          const raw = await readBody(req, RECORD_CAP);
          let parsed;
          try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'body is not valid JSON', 'invalid'); }
          if (!isObj(parsed) || parsed.schema !== DECISION_SET_SCHEMA) {
            throw new HttpError(400, `body must be an object with "schema": ${JSON.stringify(DECISION_SET_SCHEMA)}`, 'invalid');
          }
          store.writeBoard(slug, raw);
          return sendJSON(res, 200, { ok: true, savedAt: utcCompactStamp(), bytes: raw.length });
        }
        throw notFound();
      }
      if (method === 'GET' && rest.startsWith('/visuals/')) {
        const decoded = decodeSegment(rest.slice('/visuals/'.length));
        if (decoded === null) throw notFound();
        const leaf = path.basename(decoded);
        if (!leaf || leaf === '.' || leaf === '..' || leaf !== decoded) throw notFound();
        const file = regularFileUnder(board.dir, 'visuals', leaf);
        if (!file) throw notFound();
        const ext = path.extname(leaf).toLowerCase();
        return sendBytes(res, fs.readFileSync(file), VISUAL_TYPES[ext] || 'application/octet-stream',
          ext === '.html' ? VISUAL_HTML_HEADERS : {});
      }
      if (method === 'GET' && rest === '/live-status.json') {
        const info = gitInfo(R);
        return sendJSON(res, 200, { origin: PROXY_ORIGIN, branch: info.branch, sha: info.sha, committedAt: info.committedAt });
      }
      throw notFound();
    }

    if ((method === 'GET' || method === 'HEAD') && (p === '/__live' || p.startsWith('/__live/'))) {
      if (!PROXY_ORIGIN) throw new HttpError(404, 'no --proxy origin configured', 'not-found');
      return proxyTo(res, method, (p.slice('/__live'.length) || '/') + (url.search || ''));
    }

    // ── canvas (read-only projection; never written) ─────────────────────────
    if (p === '/canvas/file' && method === 'GET') {
      const rel = store.snapshot().sections.canvas.htmlFile;
      if (!rel) throw new HttpError(404, 'no canvas HTML file found', 'not-found');
      const file = regularFileUnder(R, ...rel.split('/'));
      if (!file) throw notFound();
      return sendBytes(res, fs.readFileSync(file), 'text/html; charset=utf-8', VISUAL_HTML_HEADERS);
    }
    if (p === '/canvas/feedback' && method === 'GET') {
      const snap = store.snapshot();
      const rows = snap.feedback.filter((f) => f.origin && f.origin.kind === 'canvas');
      return sendJSON(res, 200, { rows, invalidRows: snap.sections.canvas.invalidRows });
    }

    throw notFound();
  }

  server = http.createServer(async (req, res) => {
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { url = new URL('http://localhost/'); }
    try {
      await route(req, res, url);
    } catch (err) {
      let status = 500; let code = null; let message = String((err && err.message) || err);
      if (err instanceof HttpError) { status = err.status; code = err.code; } else if (err instanceof StoreError) {
        code = err.code; status = STATUS_BY_CODE[err.code] || 500;
      }
      if (!res.headersSent) sendJSON(res, status, { error: message, code });
      else res.end();
    } finally {
      if (mutating) log(`[project-server] ${req.method} ${url.pathname} -> ${res.statusCode}`);
    }
  });
  return server;
}

// ── startup ────────────────────────────────────────────────────────────────
function parseFlags(argv) {
  const at = (name) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; };
  const port = at('--port');
  return {
    repo: at('--repo') || process.cwd(),
    port: port === null ? null : parseInt(port, 10),
    proxy: at('--proxy') || null,
    migrate: !argv.includes('--no-migrate'),
  };
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Return the running server's URL for root R, or null. */
export async function runningInstance(R) {
  let info;
  try { info = JSON.parse(fs.readFileSync(path.join(R, '.groundwork', 'server.json'), 'utf8')); } catch { return null; }
  if (!isObj(info) || !pidAlive(info.pid) || !Number.isInteger(info.port)) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const h = await r.json();
    if (h && h.ok && h.root === R) return `http://localhost:${info.port}/`;
  } catch { /* not ours / not answering */ }
  return null;
}

function listenFrom(server, port, tries) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const onError = (err) => {
      if (err && err.code === 'EADDRINUSE' && attempt < tries) { attempt += 1; server.listen(port + attempt, '127.0.0.1'); } else {
        server.removeListener('error', onError); reject(err);
      }
    };
    server.on('error', onError);
    server.once('listening', () => { server.removeListener('error', onError); resolve(server.address().port); });
    server.listen(port, '127.0.0.1');
  });
}

async function main() {
  const opts = parseFlags(process.argv.slice(2));
  if (!fs.existsSync(opts.repo) || !fs.statSync(opts.repo).isDirectory()) {
    console.error(`project-server: --repo ${opts.repo} is not a directory`);
    process.exit(2);
  }
  const R = projectRoot(opts.repo);

  const existing = await runningInstance(R);
  if (existing) {
    console.log(`Groundwork project: ${existing}`);
    process.exit(0);
  }

  const warnings = [];
  if (opts.migrate) {
    const m = runMigration(R);
    if (!m.ok) {
      warnings.push(m.warning);
      console.error(`project-server: warning migration-failed: ${m.warning.detail}`);
    }
  }

  const server = makeServer({ repo: R, proxy: opts.proxy, warnings });
  const port = await listenFrom(server, Number.isInteger(opts.port) ? opts.port : defaultPort(R), PORT_FALLBACKS);
  const url = `http://localhost:${port}/`;
  const store = projectStore(R, { tool: 'project-server' });
  store.withLock(() => store.writeJson('server.json', {
    pid: process.pid, port, url, repo: R, startedAt: new Date().toISOString(),
  }));

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    try {
      store.withLock(() => {
        const file = path.join(R, '.groundwork', 'server.json');
        let mine = false;
        try { mine = JSON.parse(fs.readFileSync(file, 'utf8')).pid === process.pid; } catch { /* absent */ }
        if (mine) fs.rmSync(file, { force: true });
      });
    } catch (err) {
      console.error(`project-server: could not remove server.json: ${err.message}`);
    }
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`Groundwork project: ${url}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(`project-server: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}
