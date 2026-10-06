#!/usr/bin/env node
// decisions-server.mjs — Groundwork: guided-decisions surface host.
//
// A zero-dependency Node stdlib server (mirrors survey-server.mjs's pattern:
// http + fs only, no deps, loopback-only bind) that serves the guided-decision
// static app plus ONE project's decision record (decision_record.py's
// `groundwork.decision-set/v1` schema). It is a thin host — the record's shape
// is validated only enough to refuse overwriting it with something that is not
// a decision record; the record's semantics (axes/openItems, lanes) live in
// decision_record.py and the browser, not here.
//
// Usage:
//   node decisions-server.mjs --record <abs path to decisions.json> \
//        [--app <dir>] [--port 8920] [--proxy <origin>]
//
//   --record  required. The decisions.json this server reads/writes.
//   --app     the static app directory (default: ./app next to this file).
//   --port    preferred loopback port; a free-port fallback scan (mirrors
//             survey-server.mjs's listenWithFallback) walks upward if busy.
//   --proxy   OPT-IN, OFF BY DEFAULT. When set, any GET/HEAD to a path this
//             server does not itself serve is relayed to <origin><path> so the
//             app can inspect a live dev build same-origin. Without it, such a
//             path is a plain 404 — no outbound connection is ever made unless
//             a project explicitly asks for one.
//
// Loopback-only bind (127.0.0.1): single-user local tool, no LAN surface.

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { projectStore, StoreError } from '../project/project-store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The schema decision_record.py (SCHEMA) requires; a write with any other
// value — or a body that is not an object at all — is refused rather than
// silently replacing a project's decision record with something else.
const SCHEMA_ID = 'groundwork.decision-set/v1';

// Per-decision screenshots. Images only: this directory is served by leaf name,
// so it must not become a way to hand out arbitrary file types.
const VISUAL_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.json': 'application/json',
  // A compare's option B may be an HTML wireframe. It is served with a sandbox
  // CSP (see VISUAL_HTML_HEADERS), so even opened directly -- outside the
  // page's sandboxed iframe -- it runs no script and gets an opaque origin,
  // and so can never reach the one writable path, PUT /record.json.
  '.html': 'text/html',
};

const VISUAL_HTML_HEADERS = {
  'Content-Security-Policy': "sandbox; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
};

// The ONLY files this server will ever hand out from --app. Serving by an
// explicit allowlist (rather than resolving the request path against the app
// directory) means a request path can never escape into arbitrary-file
// serving or directory traversal — there is no filesystem join of untrusted
// input to defend, because untrusted input is never used to build a path.
const STATIC_ROUTES = {
  '/': { file: 'index.html', type: 'text/html' },
  '/index.html': { file: 'index.html', type: 'text/html' },
  '/decisions.css': { file: 'decisions.css', type: 'text/css' },
  '/decisions.js': { file: 'decisions.js', type: 'application/javascript' },
};

function parseFlags(argv) {
  const at = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : null;
  };
  return {
    record: at('--record'),
    app: at('--app') || path.join(__dirname, 'app'),
    port: parseInt(at('--port') || '8920', 10),
    proxy: at('--proxy') || null,
  };
}

// UTC compact ISO basic, e.g. "20260914T031500Z" — the client's savedAt field.
function utcCompactStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// The `.groundwork` directory that contains `file`, or null.
function groundworkDirOf(file) {
  let dir = path.dirname(path.resolve(file));
  while (true) {
    if (path.basename(dir) === '.groundwork') return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Best-effort git facts for the record's directory. Never throws: git absence
// or an unrelated directory are informational (nulls), not failures — this
// endpoint must not be the reason a save flow breaks.
function gitInfo(dir) {
  const run = (args) => {
    try {
      const out = execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return out || null;
    } catch {
      return null;
    }
  };
  return {
    branch: run(['branch', '--show-current']),
    sha: run(['rev-parse', '--short', 'HEAD']),
    committedAt: run(['log', '-1', '--format=%cI']),
  };
}

/**
 * Build the http.Server WITHOUT listening, so tests can drive it via
 * server.listen(0). Guarded behind the import.meta.url check below so
 * importing this module has no side effects.
 */
function makeServer(opts) {
  const RECORD_PATH = path.resolve(opts.record);
  const APP_DIR = path.resolve(opts.app);
  const PROXY_ORIGIN = opts.proxy || null;
  // Screenshots live beside the record, in the project's own .designdoc/<slug>/.
  const RECORD_DIR = path.dirname(RECORD_PATH);

  // One proxy implementation, used by both /__live/* and the catch-all below.
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
      // Never a silent empty 200 on a proxy failure — name the unreachable
      // origin so the failure is diagnosable from the response alone.
      return sendText(res, 502, `Bad Gateway: proxy target unreachable: ${PROXY_ORIGIN}`);
    }
  }

  const sendJSON = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const sendText = (res, status, text) => {
    res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end(text);
  };
  const sendFile = (res, filePath, type, extra = {}) => {
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
      res.end(data);
    } catch {
      sendJSON(res, 404, { error: 'not found' });
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      const method = req.method;

      // ── static app (explicit allowlist only) ──────────────────────────────
      if (method === 'GET' && Object.prototype.hasOwnProperty.call(STATIC_ROUTES, p)) {
        const entry = STATIC_ROUTES[p];
        return sendFile(res, path.join(APP_DIR, entry.file), entry.type);
      }

      // ── GET /visuals/<file> ────────────────────────────────────────────────
      // The one place a request path names a file. It is resolved with
      // path.basename() so only a leaf name survives: `../`, absolute paths and
      // nested segments all collapse to their last component, which keeps the
      // "no untrusted path join" property the static allowlist has.
      if (method === 'GET' && p.startsWith('/visuals/')) {
        const leaf = path.basename(decodeURIComponent(p.slice('/visuals/'.length)));
        if (!leaf || leaf === '.' || leaf === '..') return sendJSON(res, 404, { error: 'not found' });
        const file = path.join(RECORD_DIR, 'visuals', leaf);
        if (!fs.existsSync(file)) return sendJSON(res, 404, { error: 'not found' });
        const ext = path.extname(leaf).toLowerCase();
        return sendFile(res, file, VISUAL_TYPES[ext] || 'application/octet-stream',
          ext === '.html' ? VISUAL_HTML_HEADERS : {});
      }

      // ── GET /__live/* — the proxied origin, reserved so the preview iframe
      // has a path that is NOT the decisions app's own index. Pointing it at
      // "/" rendered this surface inside itself.
      if ((method === 'GET' || method === 'HEAD') && p.startsWith('/__live')) {
        if (!PROXY_ORIGIN) return sendJSON(res, 404, { error: 'no --proxy origin configured' });
        const rest = p.slice('/__live'.length) || '/';
        return proxyTo(res, method, rest + (url.search || ''));
      }

      // ── GET /record.json ───────────────────────────────────────────────────
      if (method === 'GET' && p === '/record.json') {
        try {
          const data = fs.readFileSync(RECORD_PATH);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          return res.end(data);
        } catch {
          return sendJSON(res, 404, { error: 'record not found', path: RECORD_PATH });
        }
      }

      // ── PUT — exactly /record.json; anywhere else is 405 ──────────────────
      if (method === 'PUT') {
        if (p !== '/record.json') {
          return sendJSON(res, 405, { error: `PUT is only allowed on /record.json (got ${p})` });
        }
        const raw = await readRawBody(req);
        let parsed;
        try {
          parsed = JSON.parse(raw.toString('utf8'));
        } catch {
          return sendJSON(res, 400, { error: 'body is not valid JSON' });
        }
        if (
          !parsed
          || typeof parsed !== 'object'
          || Array.isArray(parsed)
          || parsed.schema !== SCHEMA_ID
        ) {
          return sendJSON(res, 400, {
            error: `body must be an object with "schema": ${JSON.stringify(SCHEMA_ID)}`,
          });
        }
        // A record inside a per-repo Groundwork store (<repo>/.groundwork/) is
        // written through the store library so this server honours the one
        // lock every other Groundwork writer takes.
        const storeDir = groundworkDirOf(RECORD_PATH);
        if (storeDir) {
          const store = projectStore(path.dirname(storeDir), { tool: 'decisions-server' });
          try {
            store.withLock(() => store.writeBytes(path.relative(storeDir, RECORD_PATH).split(path.sep).join('/'), raw));
          } catch (err) {
            if (err instanceof StoreError && err.code === 'lock-timeout') {
              return sendJSON(res, 423, { error: err.message, code: err.code });
            }
            throw err;
          }
          return sendJSON(res, 200, { ok: true, savedAt: utcCompactStamp(), bytes: raw.length });
        }
        // Atomic write: temp file in the SAME directory, then rename. A
        // half-written record must never be readable — a crash mid-write
        // leaves the temp file orphaned, never the real path corrupted.
        const dir = path.dirname(RECORD_PATH);
        fs.mkdirSync(dir, { recursive: true });
        const tmp = path.join(
          dir,
          `.record.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`,
        );
        try {
          fs.writeFileSync(tmp, raw);
          fs.renameSync(tmp, RECORD_PATH);
        } catch (err) {
          // Without this the temp file survives in the project's own
          // .designdoc/ directory, where the person can see it and cannot tell
          // it from their record. The Python writers in this module already
          // cleaned up; this one did not.
          try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best effort */ }
          throw err;
        }
        return sendJSON(res, 200, { ok: true, savedAt: utcCompactStamp(), bytes: raw.length });
      }

      // ── GET /live-status.json ───────────────────────────────────────────────
      if (method === 'GET' && p === '/live-status.json') {
        const info = gitInfo(path.dirname(RECORD_PATH));
        return sendJSON(res, 200, {
          origin: PROXY_ORIGIN,
          branch: info.branch,
          sha: info.sha,
          committedAt: info.committedAt,
        });
      }

      // ── proxy: OPT-IN, OFF BY DEFAULT ────────────────────────────────────────
      if ((method === 'GET' || method === 'HEAD') && PROXY_ORIGIN) {
        return proxyTo(res, method, p + (url.search || ''));
      }

      // No proxy configured (or an unsupported method): a plain 404. This is
      // the "no accidental egress" guarantee — the server never reaches
      // outward unless a project explicitly opted in with --proxy.
      return sendJSON(res, 404, { error: 'not found' });
    } catch (err) {
      sendJSON(res, 500, { error: String((err && err.message) || err) });
    }
  });

  return server;
}

// ── Free-port fallback scan (mirrors survey-server.mjs's listenWithFallback) ──
function listenWithFallback(server, port, host, tries, cb) {
  let attempt = 0;
  const onError = (err) => {
    if (err && err.code === 'EADDRINUSE' && attempt < tries) {
      attempt += 1;
      setImmediate(() => server.listen(port + attempt, host));
    } else {
      throw err;
    }
  };
  server.on('error', onError);
  server.once('listening', () => {
    server.removeListener('error', onError);
    cb(server.address().port);
  });
  server.listen(port, host);
}

// ── main (guarded so tests can import the pure exports side-effect-free) ──────
function main() {
  const opts = parseFlags(process.argv.slice(2));
  if (!opts.record) {
    console.error('decisions-server: --record <path to decisions.json> is required');
    process.exit(1);
  }
  const server = makeServer(opts);
  listenWithFallback(server, opts.port, '127.0.0.1', 50, (boundPort) => {
    console.log(`Groundwork: decisions server running at http://localhost:${boundPort}`);
    console.log(`  record: ${path.resolve(opts.record)}`);
    console.log(`  app: ${path.resolve(opts.app)}`);
    console.log(`  proxy: ${opts.proxy || '(none — no outbound requests)'}`);
  });
}

export { makeServer, listenWithFallback, SCHEMA_ID, STATIC_ROUTES, VISUAL_TYPES, VISUAL_HTML_HEADERS, utcCompactStamp, gitInfo, readRawBody };

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
