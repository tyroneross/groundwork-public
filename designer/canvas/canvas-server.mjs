#!/usr/bin/env node
// canvas-server.mjs — Groundwork's live, iterable design canvas.
//
// WHAT: serves ONE living mockup (the "canvas") in a side-rail shell where the
// user comments, decides, and watches the design converge — the surface for the
// iterate/canvas loop. Unlike the mockup-gallery (review 4 frozen options),
// this is convergence-by-conversation on a single evolving frame.
//
// This file also serves a second, distinct surface — GALLERY MODE
// (`--mode gallery`) — Groundwork's OWN divergence/compare surface for the
// mockups flow's manifest.json slots (screen x mode). It does NOT fork or
// launch the separate mockup-gallery plugin; it is a sibling, Groundwork-owned
// implementation of the same idea (rate N options per screen, pick a winner).
// Default mode is `iterate` and its behavior is byte-compatible with the
// pre-gallery version of this file (see runIterate()).
//
// OWNERSHIP: Groundwork owns this. It does NOT fork mockup-gallery's
// gallery-server.mjs — that plugin stays a separate divergence/review surface;
// this file's gallery mode is Groundwork's own, entirely independent
// implementation. Same zero-dependency stdlib style as
// designer/server/designer-server.mjs (http + fs only, no deps).
//
// TRANSPORT (file-based — server relays, the host agent reads/writes):
//   canvas file  <canvas>            the agent EDITS this HTML; server watches
//                                    its mtime and live-reloads the iframe.
//   status.json  <dir>/.canvas/status.json
//                                    the agent WRITES elicit.py's status here;
//                                    server serves it + pushes an SSE ping on
//                                    change so the rail re-renders decide/meter.
//   feedback.jsonl <dir>/.canvas/feedback.jsonl
//                                    the rail APPENDS the user's comments /
//                                    decisions / toggles; the agent reads new
//                                    lines each turn and acts.
//   mode.json    <dir>/.canvas/mode.json   {"mode":"live"|"hold"}
//
// So the browser never talks to the model directly: user acts -> file -> agent
// reads between turns -> edits canvas / updates session -> file -> browser.
//
// Usage:
//   node designer/canvas/canvas-server.mjs --file <canvas.html> [--port 8930]
//        [--title "Daily Planner"] [--dir <canvas-dir>] [--nav <canvas-nav.json>]
//   --dir defaults to the canvas file's directory. The .canvas/ control dir is
//   created under --dir.
//
//   node designer/canvas/canvas-server.mjs --mode gallery --dir <mockups-dir>
//        [--title T] [--port 8930] [--no-profile]
//   --dir MUST contain manifest.json (designer/mockups/manifest.schema.json).
//   The .canvas/ control dir is created under --dir.
//
// GALLERY TASTE PROFILE (gallery mode only): a pick / yay / nay / new annotation
// also compounds into Groundwork's EXISTING cross-session taste profile
// (designer/decide/profile.py, store ~/dev/designs/.groundwork-profile.json),
// so preference accumulates across projects and over time instead of dying with
// the design dir. Mode ids and component names ONLY — never comment text, note
// text, paths, project names, or slot filenames. Opt out with --no-profile or
// GROUNDWORK_PROFILE=off; point it elsewhere with GROUNDWORK_PROFILE_STORE.
//
// Endpoints (iterate mode):
//   GET  /                     the rail + iframe shell
//   GET  /__canvas/file        the active canvas HTML (iframe src)
//   GET  /__canvas/status      status.json  (or {} )
//   GET  /__canvas/events      SSE: {type:"reload"|"status"|"preview"|"preview-clear"|"ping", ...}
//                              "ping" fires every ~10s so the rail can detect
//                              a half-dead connection (server killed, tab
//                              left open) instead of silently hanging.
//   GET  /__canvas/nav         optional cross-canvas navigation (canvas-nav.json)
//                              or {} — read fresh per request. Source: --nav
//                              <file>, else canvas-nav.json in --dir, else in
//                              its parent (one review folder, one file per page).
//   POST /__canvas/feedback    append a feedback row -> feedback.jsonl
//   POST /__canvas/preview     relay-only, transient decision preview: hover/focus
//                              on a fork option -> {component,addClass,removeClass}
//                              or {clear:true}; re-broadcast over SSE. NEVER
//                              writes canvas/status/feedback — purely visual.
//   GET  /<asset>              sibling static assets for the canvas
//
// Endpoints (gallery mode):
//   GET  /                     the gallery shell (grouped by screen)
//   GET  /__gallery/health     launcher readiness/ownership identity
//   GET  /__gallery/manifest   manifest.json (or {})
//   GET  /__gallery/slot       ?path=<flat-filename> -> that slot's HTML verbatim
//   GET  /__gallery/selections gallery-selections.json (server-owned state)
//   GET  /__gallery/profile    read-only view of the cross-session taste profile
//                              -> {enabled, store, profile:{schema,dimensions}}
//   GET  /__gallery/archive    ?slot=<flat-filename> -> {slot, versions:[...]}
//                              ?…&version=<id>       -> that one version payload
//                              ?…&version=<id>&file=html -> the archived HTML
//   GET  /__canvas/events      SSE: {type:"reload", path:"<flat-filename>"}
//                              and {type:"archived", path, version} when a slot
//                              rewrite retired the annotations made against the
//                              version it replaced
//   POST /__canvas/feedback    append a feedback row -> feedback.jsonl; also
//                              updates gallery-selections.json
//                              (rate/pick/note/element annotation), and folds
//                              revealed preference into the taste profile
//   GET  /<asset>              sibling static assets for slot HTML

import { workspaceStyles, workspaceMarkup, installWorkspace } from './workspace.mjs';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
// The archive engine (gallery mode only). Its decision policy lives in a pure
// decide() over there so it can be unit-tested without booting this server —
// this file only supplies I/O, HTTP and the live overlay.
import {
  SLOT_RE, VERSION_RE, readVersions, writeVersions, syncSlot, syncAllSlots,
  listArchive, readArchivedHtml,
} from './gallery-archive.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
function flag(name, dflt = null) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : dflt;
}

const MODE = flag('--mode', 'iterate');

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// =============================================================================
// ITERATE MODE (default) — the original canvas: rail + one live iframe.
// Unchanged behavior vs the pre-gallery version of this file.
// =============================================================================
function runIterate() {
  const CANVAS_FILE_ARG = flag('--file', '');
  if (!CANVAS_FILE_ARG) {
    // Guard omission explicitly: path.resolve('') is cwd, which exists as a dir,
    // so an existsSync-only check would silently boot cwd as the canvas.
    console.error('canvas-server: --file <canvas.html> is required');
    process.exit(2);
  }
  const CANVAS_FILE = path.resolve(CANVAS_FILE_ARG);
  if (!fs.existsSync(CANVAS_FILE) || !fs.statSync(CANVAS_FILE).isFile()) {
    console.error('canvas-server: --file must exist and be a file');
    process.exit(2);
  }
  const CANVAS_DIR = path.resolve(flag('--dir', path.dirname(CANVAS_FILE)));
  // Sibling assets (css/js/images next to the canvas page) resolve relative to
  // the page's own folder, not --dir — --dir only ever hosts the .canvas/
  // control dir and may point somewhere else entirely (e.g. a shared review
  // root above several page folders).
  const ASSET_DIR = path.dirname(CANVAS_FILE);
  const CTRL_DIR = path.join(CANVAS_DIR, '.canvas');
  const STATUS_FILE = path.join(CTRL_DIR, 'status.json');
  const FEEDBACK_FILE = path.join(CTRL_DIR, 'feedback.jsonl');
  const CURSOR_FILE = path.join(CTRL_DIR, 'cursor.json');
  const MODE_FILE = path.join(CTRL_DIR, 'mode.json');
  const PORT_START = parseInt(flag('--port', '8930'), 10);
  const TITLE = flag('--title', path.basename(CANVAS_FILE, '.html'));
  // Cross-canvas navigation (owner request 2026-09-14: move between pages and
  // decisions from inside the canvas). Optional; absent means no nav pane.
  const NAV_FLAG = flag('--nav', '');
  function navFile() {
    const candidates = NAV_FLAG
      ? [path.resolve(NAV_FLAG)]
      : [path.join(CANVAS_DIR, 'canvas-nav.json'), path.join(path.dirname(CANVAS_DIR), 'canvas-nav.json')];
    return candidates.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || null;
  }
  // Only http(s) links with a label survive; anything else (javascript:, data:,
  // missing label) is dropped so the pane can never render a live script URL.
  function readNav() {
    const file = navFile();
    if (!file) return {};
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; }
    const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : '');
    const groups = (Array.isArray(raw && raw.groups) ? raw.groups : []).map((g) => ({
      label: text(g && g.label),
      items: (Array.isArray(g && g.items) ? g.items : []).map((it) => {
        let url = '';
        try { const parsed = new URL(String(it && it.url)); if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed.href; } catch { /* dropped */ }
        return { label: text(it && it.label), url, hint: text(it && it.hint) };
      }).filter((it) => it.label && it.url),
    })).filter((g) => g.items.length);
    return groups.length ? { title: text(raw.title), groups } : {};
  }

  fs.mkdirSync(CTRL_DIR, { recursive: true });
  if (!fs.existsSync(MODE_FILE)) fs.writeFileSync(MODE_FILE, JSON.stringify({ mode: 'live' }));

  // ---------------------------------------------------------------------------
  // SSE client registry + mtime watcher (poll, not fs.watch — reliable on macOS)
  // ---------------------------------------------------------------------------
  const clients = new Set();
  let feedbackSeq = 0;
  function broadcast(obj) {
    const line = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of clients) { try { res.write(line); } catch { /* dropped */ } }
  }
  function mtime(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }
  let lastCanvas = mtime(CANVAS_FILE);
  let lastStatus = mtime(STATUS_FILE);
  let lastFeedback = mtime(FEEDBACK_FILE);
  let lastCursor = mtime(CURSOR_FILE);
  setInterval(() => {
    const c = mtime(CANVAS_FILE);
    if (c !== lastCanvas) { lastCanvas = c; broadcast({ type: 'reload', mtime: c }); }
    const s = mtime(STATUS_FILE);
    if (s !== lastStatus) { lastStatus = s; broadcast({ type: 'status', mtime: s }); }
    const f = mtime(FEEDBACK_FILE), r = mtime(CURSOR_FILE);
    if (f !== lastFeedback || r !== lastCursor) {
      lastFeedback = f; lastCursor = r; broadcast({ type: 'feedback' });
    }
  }, 400);

  // Liveness heartbeat — a half-dead connection (process killed, network
  // partition) leaves the browser's EventSource looking connected with no
  // signal until a real reload/status frame happens to be due, which may be
  // never. A periodic {type:'ping'} gives the rail something to time out on
  // (§ rail SSE state below) so a dead server is detectable within ~25s
  // instead of silently forever. On process shutdown the SSE sockets close
  // naturally (no explicit teardown needed) — this just makes the healthy
  // case observably healthy too.
  setInterval(() => broadcast({ type: 'ping', ts: Date.now() }), 10000);

  // ---------------------------------------------------------------------------
  // Static file helper (canvas + sibling assets only; no traversal)
  // ---------------------------------------------------------------------------
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2',
  };
  function serveFile(res, filePath) {
    // The canvas file itself always serves, even when --dir points elsewhere
    // (its own containment check below would otherwise 403 it silently).
    if (path.resolve(filePath) !== CANVAS_FILE) {
      const rel = path.relative(ASSET_DIR, filePath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        console.error(`canvas-server: forbidden path "${filePath}" outside asset root "${ASSET_DIR}"`);
        res.writeHead(403).end('forbidden');
        return;
      }
    }
    fs.readFile(filePath, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(buf);
    });
  }
  function readJSON(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return dflt; } }

  // ---------------------------------------------------------------------------
  // Server
  // ---------------------------------------------------------------------------
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;

    if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(SHELL()); return; }
    if (p === '/__canvas/file') { serveFile(res, CANVAS_FILE); return; }
    if (p === '/__canvas/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readJSON(STATUS_FILE, {})));
      return;
    }
    if (p === '/__canvas/mode') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readJSON(MODE_FILE, { mode: 'live' })));
      return;
    }
    if (p === '/__canvas/nav') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(readNav()));
      return;
    }
    if (p === '/__canvas/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 1000\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/__canvas/feedback' && req.method === 'GET') {
      try {
        const raw = fs.existsSync(FEEDBACK_FILE) ? fs.readFileSync(FEEDBACK_FILE, 'utf8') : '';
        const rows = []; let invalidRows = 0;
        for (const line of raw.split('\n').filter(line => line.trim())) {
          try { const row = JSON.parse(line); if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('invalid row'); rows.push(row); }
          catch { invalidRows++; }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        // Only project the agent's exact checkpoint; never mutate its cursor or
        // expose private engine state. An unknown ID reviews no current rows.
        let reviewedThroughId = null, reviewStatusAvailable = true;
        try {
          const cursor = JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf8'));
          if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) ||
              (cursor.last_id !== null && typeof cursor.last_id !== 'string')) throw new Error('invalid checkpoint');
          if (cursor.last_id && rows.some(row => row.id === cursor.last_id)) reviewedThroughId = cursor.last_id;
        } catch (error) { if (error.code !== 'ENOENT') reviewStatusAvailable = false; }
        res.end(JSON.stringify({ rows, invalidRows, reviewedThroughId, reviewStatusAvailable }));
      } catch { res.writeHead(500).end('feedback journal unavailable'); }
      return;
    }
    if (p === '/__canvas/feedback' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let row;
        try { row = JSON.parse(body || '{}'); } catch { res.writeHead(400).end('bad json'); return; }
        row.ts = new Date().toISOString();
        row.id = `fb-${Date.now()}-${feedbackSeq++}`;
        // A toggle also updates mode.json so the agent sees Live/Hold state.
        if (row.kind === 'toggle' && (row.mode === 'live' || row.mode === 'hold')) {
          fs.writeFileSync(MODE_FILE, JSON.stringify({ mode: row.mode }));
        }
        fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(row) + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: row.id }));
      });
      return;
    }
    // Decision preview relay: hover/focus on a fork option in the rail POSTs
    // here; the server does nothing but re-broadcast over SSE (§4 preview /
    // preview-clear). Purely transient — NEVER writes canvas file,
    // feedback.jsonl, or status.json. Committing a decision is unchanged
    // (still POST /__canvas/feedback {kind:'decide',...}); this endpoint only
    // ever affects what the iframe LOOKS like until the next real reload.
    if (p === '/__canvas/preview' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let row;
        try { row = JSON.parse(body || '{}'); } catch { res.writeHead(400).end('bad json'); return; }
        if (row && row.clear) {
          broadcast({ type: 'preview-clear' });
        } else if (row && typeof row.component === 'string' && row.component) {
          broadcast({
            type: 'preview',
            component: row.component,
            addClass: typeof row.addClass === 'string' ? row.addClass : null,
            removeClass: typeof row.removeClass === 'string' ? row.removeClass : null,
          });
        } else {
          res.writeHead(400).end('bad request: need {component} or {clear:true}');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    // sibling static assets for the canvas
    serveFile(res, path.join(ASSET_DIR, decodeURIComponent(p.replace(/^\/+/, ''))));
  });

  let PORT = PORT_START;
  function listen() {
    server.listen(PORT, '127.0.0.1', () => {   // loopback only — a local design tool, never LAN-exposed
      console.log(`canvas-server: ${TITLE}`);
      console.log(`  canvas : ${CANVAS_FILE}`);
      console.log(`  control: ${CTRL_DIR}`);
      // --dir and the page's own folder diverge (e.g. --dir is a shared
      // review root) — surface the asset root separately so it's never a
      // silent mismatch.
      if (ASSET_DIR !== CANVAS_DIR) console.log(`  assets : ${ASSET_DIR}`);
      console.log(`  open   : http://localhost:${PORT}`);
    });
  }
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && PORT < PORT_START + 40) { PORT += 1; listen(); }
    else { console.error(e); process.exit(1); }
  });
  listen();

  // ---------------------------------------------------------------------------
  // The shell: side rail + canvas iframe. Calm-precision styling — luminance
  // hierarchy, left-border accents (no boxes on rows), content >= chrome,
  // reduced-motion honored, theme-aware. Self-contained, no external fetches.
  // ---------------------------------------------------------------------------
  function SHELL() {
    return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(TITLE)} · Groundwork canvas</title>
<style>
  :root{
    /* --ink-3 was #727880 (4.0:1 on the panel), under the 4.5:1 floor for the
       rail's labels and hints; #8b919a is 5.7:1. */
    --bg:#0e0f11; --panel:#15171a; --ink:#f2f3f5; --ink-2:#aeb4bd; --ink-3:#8b919a;
    --line:#23262b; --accent:#6ea8fe; --on-accent:#001; --accent-warm:#e0a26a; --ok:#5bbf8a; --warn:#d8a24a;
    /* Was a fixed 340px, which clipped the Live/Hold toggle and the Send button
       in a narrow window. Flexes with the viewport, never below readable. */
    --rail: clamp(300px, 33vw, 420px);
  }
  @media (prefers-color-scheme: light){
    :root{ --bg:#f6f7f9; --panel:#ffffff; --ink:#14161a; --ink-2:#454b54; --ink-3:#6b717a;
           --line:#e4e7eb; --accent:#2b6cf0; --on-accent:#fff; --accent-warm:#b5702f; }
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{display:grid;grid-template-columns:var(--nav,0px) minmax(0,1fr) var(--rail);height:100vh}
  /* Groundwork frame: an indigo edge around the whole window so a page shown
     here is never mistaken for the live site (owner request, 2026-09-14). */
  .gw-frame{position:fixed;inset:0;border:3px solid #6366f1;pointer-events:none;z-index:70}
  /* Navigation pane: pages and decisions of this review, collapsible. */
  body.has-nav{--nav:232px}
  body.has-nav.nav-collapsed{--nav:48px}
  /* Columns are pinned by index (not left to grid auto-placement) because a
     hidden nav (before /__canvas/nav resolves with no groups) drops out of
     flow entirely — auto-placement then shifts .stage into the nav column
     and .rail into the stage column, collapsing #frame to 0 width. */
  .gwnav{grid-column:1;background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0;overflow:hidden}
  .gwnav[hidden]{display:none}
  .gwnav-head{display:flex;align-items:center;gap:8px;padding:12px 10px 10px 14px;border-bottom:1px solid var(--line)}
  .gwnav-mark{display:inline-flex;align-items:center;gap:7px;font-weight:700;font-size:13px;white-space:nowrap}
  .gwnav-mark i{width:10px;height:10px;border-radius:3px;background:linear-gradient(135deg,#6366f1,#a855f7);display:inline-block}
  .gwnav-toggle{margin-left:auto;min-width:32px;min-height:32px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink-2);font:inherit;cursor:pointer}
  .gwnav-toggle:hover{color:var(--ink);border-color:#6366f1}
  .gwnav-toggle:focus-visible,.gwnav a:focus-visible{outline:2px solid #6366f1;outline-offset:2px}
  .gwnav-title{padding:10px 14px 0;font-size:12px;color:var(--ink-3)}
  .gwnav-body{flex:1 1 auto;overflow:auto;padding:4px 0 12px}
  .gwnav-group{margin:12px 0 0}
  .gwnav-group p{margin:0 0 4px;padding:0 14px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
  .gwnav a{display:block;padding:7px 12px;margin:0 8px 0 0;border-left:2px solid transparent;color:var(--ink-2);text-decoration:none;font-size:13px;line-height:1.35;border-radius:0 8px 8px 0}
  .gwnav a:hover{color:var(--ink);background:color-mix(in srgb,#6366f1 8%,transparent)}
  .gwnav a[aria-current="page"]{color:var(--ink);font-weight:600;border-left-color:#6366f1;background:color-mix(in srgb,#6366f1 12%,transparent)}
  .gwnav a small{display:block;color:var(--ink-3);font-size:11px;font-weight:400}
  body.nav-collapsed .gwnav-mark span,body.nav-collapsed .gwnav-title,body.nav-collapsed .gwnav-body{display:none}
  body.nav-collapsed .gwnav-head{flex-direction:column;padding:12px 8px;border-bottom:0}
  body.nav-collapsed .gwnav-toggle{margin-left:0}
  /* canvas */
  .stage{grid-column:2;min-width:0;position:relative;overflow:hidden;background:var(--bg);display:flex;flex-direction:column}
  #frame{width:100%;height:100%;min-height:0;flex:1;border:0;background:#fff;display:block}
  .pending{display:none;flex-shrink:0;align-self:flex-start;max-width:calc(100% - 32px);min-height:44px;margin:8px 16px 16px;padding:7px 12px;border-radius:8px;
    background:var(--accent);color:var(--on-accent);box-shadow:0 4px 14px rgba(0,0,0,.3);
    font-weight:600;font-size:12px;opacity:0;transform:translateY(6px);
    transition:opacity .18s,transform .18s;pointer-events:none}
  .pending.show{display:block;opacity:1;transform:none;pointer-events:auto;cursor:pointer}
  @media (prefers-reduced-motion:reduce){.pending{transition:none}}
  /* rail */
  .rail{grid-column:3;background:var(--panel);border-left:1px solid var(--line);
    display:flex;flex-direction:column;min-height:0;overflow-x:hidden;overflow-y:auto}
  .rail button:focus-visible,.rail textarea:focus-visible,.rail summary:focus-visible{
    outline:2px solid var(--accent);outline-offset:2px}
  /* Names the canvas block this decision changes, directly under the question. */
  .affects{margin:-6px 0 12px;font-size:12px;color:var(--ink-3)}
  .affects b{color:var(--accent);font-weight:600}
  .rail section{padding:14px 16px;border-bottom:1px solid var(--line)}
  .rail > section,.rail > details{flex-shrink:0}
  .rail-tools{border-bottom:1px solid var(--line);padding:0 16px}
  .rail-tools > summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;font-weight:600;padding:10px 0;min-height:44px}
  .rail-tools > summary::before{content:"›";display:inline-block}
  .rail-tools[open] > summary::before{transform:rotate(90deg)}
  .rail-tools > summary::-webkit-details-marker{display:none}
  .tool-state{margin-left:auto;font-weight:400;font-size:12px;color:var(--ink-3)}
  .tool-content{padding-bottom:14px}
  .feedback-heading{padding-bottom:8px!important}
  .composer .ack:empty{display:none}
  .rail .grow{flex:0 0 auto;overflow:visible;min-height:0}
  .eyebrow{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin:0 0 8px}
  /* toggle */
  .toprow{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .brand{font-weight:600}
  .brand small{display:block;color:var(--ink-3);font-weight:400;font-size:11px}
  .toggle{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .toggle button{background:transparent;color:var(--ink-2);border:0;padding:6px 12px;
    font:inherit;font-size:12px;cursor:pointer}
  .toggle button.on{background:var(--accent);color:var(--on-accent);font-weight:600}
  /* decide */
  .qtext{font-size:13px;font-weight:600;margin:2px 0 10px;color:var(--ink-2)}
  .ab{display:grid;grid-template-columns:1fr;gap:10px}
  .ab button{background:transparent;color:var(--ink);border:1px solid var(--line);
    border-left:3px solid var(--accent);border-radius:8px;padding:8px 10px;text-align:left;
    font:inherit;font-size:13px;cursor:pointer}
  .ab button:hover{border-color:var(--accent)}
  .ab button:active{transform:translateY(1px)}
  .ab button.selected{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent);
    border-left-width:3px}
  .ab button.selected .lbl::after{content:" ✓";color:var(--accent)}
  .ab .lbl{font-weight:600;display:block}
  .ab .sub{color:var(--ink-3);font-size:12px}
  .noq{color:var(--ink-3);font-size:13px}
  @media (prefers-reduced-motion:reduce){.ab button:active{transform:none}}
  /* comment — the rail's one primary action (owner report, 2026-09-23: "couldn't
     tell where to make updates or add input"). It sits first under the title,
     carries a real label and a pinning hint; the decision fork below it is
     secondary. */
  .composer{border-left:3px solid var(--accent)}
  .composer-title{display:block;font-size:15px;font-weight:600;color:var(--ink);margin:0 0 2px}
  .composer textarea{width:100%;min-height:96px;resize:vertical;background:var(--bg);
    color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:9px 10px;font:inherit}
  .composer textarea:focus{border-color:var(--accent)}
  .pinbar{font-size:12px;color:var(--ink-3);margin:0 0 8px}
  .pinbar b{color:var(--accent)}
  .chips{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
  /* The three decision chips act on the A/B above them, so they sit with it —
     not below the comment box, which separated a control from its object. */
  .decide-chips{margin-top:12px}
  .send-row{justify-content:flex-end}
  /* Send only ever submits a comment, so it cannot double as "I answered this
     question". Next is the explicit advance, and it stays disabled until there
     is actually something to advance — a dead-looking button beats a live one
     that silently does nothing. */
  .chip.next{margin-left:auto;background:var(--accent);color:var(--on-accent);border-color:var(--accent);font-weight:600}
  .chip.next:disabled{background:transparent;color:var(--ink-3);border-color:var(--line);
    font-weight:400;cursor:not-allowed}
  .chip.next.sending{opacity:.6;pointer-events:none}
  /* A transient toast is not enough confirmation for a decision: it can be
     missed entirely. This line persists until the next action replaces it. */
  [hidden]{display:none!important}
  .ack{margin:10px 0 0;font-size:12px;color:var(--ok);min-height:1em}
  .ack.warn{color:var(--warn)}
  .chip{background:transparent;border:1px solid var(--line);border-radius:20px;
    color:var(--ink-2);padding:6px 12px;font:inherit;font-size:12px;cursor:pointer}
  .chip.lock{border-left:3px solid var(--ok)} .chip.lean{border-left:3px solid var(--accent)}
  .chip.never{border-left:3px solid var(--warn)} .chip.send{margin-left:auto;background:var(--accent);color:var(--on-accent);border-color:var(--accent);font-weight:600;
    font-size:13px;padding:8px 18px}
  .chip.send.sending{opacity:.6;pointer-events:none}
  .item .q{display:inline-block;margin-left:8px;font-size:10px;letter-spacing:.04em;
    text-transform:uppercase;color:var(--accent);border:1px solid var(--accent);
    border-radius:10px;padding:1px 7px;vertical-align:middle}
  .item .q.applied{color:var(--ok);border-color:var(--ok)}
  .toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,12px);
    background:var(--panel);color:var(--ink);border:1px solid var(--line);
    border-left:3px solid var(--accent);border-radius:10px;padding:10px 14px;
    box-shadow:0 8px 26px rgba(0,0,0,.35);font-size:13px;opacity:0;pointer-events:none;
    transition:opacity .18s,transform .18s;z-index:50;max-width:min(520px,80vw)}
  .toast.show{opacity:1;transform:translate(-50%,0)}
  .toast b{color:var(--accent)}
  @media (prefers-reduced-motion:reduce){.toast{transition:none}}
  /* thread + meter */
  .item{padding:8px 0 8px 10px;border-left:2px solid var(--line)}
  .item.lock{border-color:var(--ok)} .item.lean{border-color:var(--accent)} .item.never{border-color:var(--warn)}
  .item .k{font-size:11px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em}
  .item .t{font-size:13px}
  .meter .row{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--ink-2)}
  .meter .row span{white-space:nowrap}
  .decision-log{margin-top:8px;font-size:12px;color:var(--ink-2)}
  .decision-log summary{cursor:pointer;list-style:none;padding:4px 0;min-height:24px}
  .decision-log summary::-webkit-details-marker{display:none}
  .decision-log summary::after{content:"›";display:inline-block;margin-left:6px;transition:transform .15s}
  .decision-log[open] summary::after{transform:rotate(90deg)}
  @media (prefers-reduced-motion:reduce){.decision-log summary::after{transition:none}}
  .locked{font-size:12px;color:var(--ink-3);margin-top:6px}
  .decision-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
  .decision-badge{border:1px solid var(--line);border-radius:999px;padding:3px 7px;font-size:11px;font-weight:700;color:var(--ink-2);background:var(--surface)}
  .rigidity-locked{border-style:solid}.rigidity-leaning{border-style:dashed}.rigidity-open{font-weight:500}.rigidity-experimental{border-style:dotted}.rigidity-superseded{text-decoration:line-through}
  .done{color:var(--ok);font-weight:600}
  /* connection state — a half-dead SSE must be visible, never a silent hang */
  .conn-banner{display:none;margin:0;padding:8px 16px;font-size:12px;font-weight:600;
    color:var(--warn);border-bottom:1px solid var(--line);border-left:3px solid var(--warn);
    background:color-mix(in srgb,var(--warn) 14%,transparent)}
  .conn-banner.show{display:block}
  .conn-banner,.ack.warn{color:var(--ink)}
  body.gw-disconnected .chip,
  body.gw-disconnected .ab button{opacity:.55;cursor:not-allowed}
  .workspace-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--line);flex:none;flex-wrap:wrap}
  .workspace-bar button{background:transparent;color:var(--ink-2);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font:inherit;cursor:pointer;min-height:44px}
  .workspace-bar button:disabled,.chip:disabled{opacity:.6;cursor:not-allowed}
  #workspaceTitle{flex:1;min-width:0;font-size:13px;font-weight:600;overflow-wrap:anywhere}
  #feedbackToggle,#pagesToggle,#feedbackClose{display:none}
  .mobile-tools{display:contents}.mobile-tools > summary{display:none}.mobile-tools-body{display:contents}
  .rail,.gwnav,.rail section{min-width:0;overflow-wrap:anywhere}
  .rail button,.rail summary,.gwnav a,.gwnav-toggle{min-height:44px}
  .ab button,.chip{white-space:normal;overflow-wrap:anywhere}
  .preference-tools{margin-top:12px;font-size:12px;color:var(--ink-2)}
  .preference-tools summary{cursor:pointer;padding:10px 0}
  .inspect-label{display:flex;align-items:center;gap:8px;min-height:44px}
  .choice-status{color:var(--ink-2);font-size:12px;margin:8px 0}
  .chip.next{margin-left:0;background:transparent;color:var(--ink-2);font-weight:400}
  @media(max-width:860px){
    .wrap{display:flex;flex-direction:column;height:100dvh;min-width:0}
    .stage{flex:1;min-height:0;width:100%;order:0}
    .workspace-bar{padding:8px;gap:6px}
    #workspaceTitle{display:none}
    #feedbackToggle,#feedbackClose{display:block}
    #pagesToggle{display:none!important}
    .workspace-bar{flex-wrap:nowrap;position:relative}
    .mobile-tools{display:block;order:3}.mobile-tools > summary{display:block;cursor:pointer;min-height:44px;padding:12px 8px}
    .mobile-tools-body{display:flex;flex-wrap:wrap;gap:8px;position:absolute;z-index:10;top:100%;left:0;right:0;max-height:75dvh;overflow:auto;padding:12px;background:var(--panel);border-bottom:1px solid var(--line)}
    .mobile-tools:not([open]) .mobile-tools-body{display:none}
    .mobile-tools .gwnav{position:static;display:flex;max-height:none;border:0;order:0}
    .mobile-tools .gwnav[hidden]{display:none}
    .mobile-tools .view-tabs{width:100%}
    .feedback-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
    #feedbackClose{min-width:44px;min-height:44px;background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:8px;font:inherit}
    .rail{display:none;position:fixed;z-index:20;inset:0;width:100%;height:100dvh;max-height:none;border-left:0}
    body.feedback-open .rail{display:flex}
    .gwnav{display:none;width:100%;max-height:50dvh;flex:none;order:1;border-right:0;border-top:1px solid var(--line)}
    body.pages-open .gwnav:not([hidden]){display:flex}
    .gwnav-head{display:none}
    body.nav-collapsed .gwnav-title,body.nav-collapsed .gwnav-body{display:block}
    .gwnav a{padding:12px}
    .rail section{padding:10px 12px}
    .rail-tools{padding:0 12px}
    .toast{bottom:12px;max-width:calc(100vw - 24px)}
  }
${workspaceStyles}
</style></head><body>
<div class="gw-frame" aria-hidden="true"></div>
<div class="wrap">
  <nav class="gwnav" id="gwnav" aria-label="Groundwork pages and decisions" hidden>
    <div class="gwnav-head">
      <span class="gwnav-mark"><i aria-hidden="true"></i><span>Groundwork</span></span>
      <button type="button" class="gwnav-toggle" id="gwnavToggle" aria-controls="gwnavBody" aria-expanded="true" aria-label="Collapse navigation">&laquo;</button>
    </div>
    <div class="gwnav-title" id="gwnavTitle"></div>
    <div class="gwnav-body" id="gwnavBody"></div>
  </nav>
  <div class="stage">
    <div class="workspace-bar">
      <details class="mobile-tools" id="workspaceTools"><summary>More</summary><div class="mobile-tools-body">
      <button type="button" id="workspaceBack" disabled aria-label="Back to previous preview">Back</button>
      <button type="button" id="workspaceHome">Home</button>
      </div></details>
      <span id="workspaceTitle">${escapeHtml(TITLE)}</span>
      <button type="button" id="pagesToggle" hidden aria-controls="gwnavBody" aria-expanded="false">Pages</button>
      <button type="button" id="feedbackToggle" aria-controls="feedbackPanel" aria-expanded="false">Feedback</button>
    </div>
    ${workspaceMarkup}
    <div class="conn-banner" id="connBanner" role="status" aria-live="polite">Disconnected — reconnecting…</div>
    <iframe id="frame" src="/__canvas/file" title="canvas"></iframe>
    <button type="button" class="pending" id="pending">Preview update available · refresh</button>
  </div>
  <div class="toast" id="toast"></div>
  <aside class="rail" id="feedbackPanel" aria-label="Feedback and decisions">
    <section class="feedback-heading">
      <div class="brand">Feedback<small id="reviewContext">Reviewing this preview</small></div>
      <button type="button" id="feedbackClose">Close</button>
    </section>
    <section class="composer">
      <label class="composer-title" for="comment">Tell Groundwork what to change</label>
      <div class="pinbar" id="pinbar">Click any part of the design (it outlines on hover) to attach your note to it</div>
      <textarea id="comment" placeholder="e.g. the header feels heavy; tighten the rows"></textarea>
      <div class="chips send-row">
        <button class="chip send"  data-kind="comment">Send note</button>
      </div>
      <p class="ack" id="sendAck" role="status" aria-live="polite"></p>
    </section>
    <details class="rail-tools" id="decide" hidden>
      <summary>Review a design direction <span class="tool-state">Optional</span></summary>
      <div class="tool-content">
      <div id="decide-body"><p class="noq">Waiting for the first question…</p></div>
      <p class="noq" id="choiceHint">Preview a choice, then apply it.</p>
      <div class="chips decide-chips">
        <button type="button" class="chip send" id="applyChoice" disabled>Apply choice</button>
        <button type="button" class="chip next" id="nextBtn" hidden>Ask next question</button>
      </div>
      <details class="preference-tools">
        <summary>Set a lasting preference</summary>
        <p class="noq">Use the selected choice or your note.</p>
        <div class="chips">
          <button class="chip lock" data-kind="lock">Keep this choice</button>
          <button class="chip lean" data-kind="lean">Prefer this choice</button>
          <button class="chip never" data-kind="never">Avoid this choice</button>
        </div>
      </details>
      <p class="ack" id="ack" role="status" aria-live="polite"></p>
      </div>
    </details>
    <section class="grow" id="recent" hidden>
      <p class="eyebrow">Saved feedback</p>
      <div id="thread"></div>
    </section>
    <details class="rail-tools meter" id="previewTools">
      <summary>Preview controls <span class="tool-state" id="previewMode">Live</span></summary>
      <div class="tool-content">
      <div class="toggle" id="toggle" role="group" aria-label="Preview updates">
        <button data-mode="live" class="on">Live</button>
        <button data-mode="hold">Hold</button>
      </div>
      <p class="pinbar" id="holdHint" role="status" hidden></p>
      <div class="row"><span id="progress">No decisions carried forward yet</span></div>
      <details class="decision-log" id="decisionLog" hidden>
        <summary id="decisionSummary">0 decisions</summary>
        <div class="locked" id="lockedlist"></div>
        <div class="decision-badges" id="decisionBadges" aria-label="Decision status"></div>
      </details>
      <details class="preference-tools">
        <summary>Inspect data sources</summary>
        <label class="inspect-label"><input type="checkbox" id="inspectSources"> Show source annotations on preview</label>
      </details>
      </div>
    </details>
  </aside>
</div>
<script>
(() => {
  // Navigation replaces only the iframe. Drafts retain their original page context.
  const homeUrl = new URL('/', location.href).href;
  let activeCanvas = { url: homeUrl, label: ${JSON.stringify(TITLE).replaceAll('<', '\\u003c')} };
  let navigationHistory = [];
  let draftCanvas = null;
  let workspaceController = null;
  const homeTitle = ${JSON.stringify(TITLE).replaceAll('<', '\\u003c')};
  function workspaceUrl(url) {
    const target = new URL(url, location.href);
    const local = ['localhost', '127.0.0.1', '[::1]'];
    if (target.protocol === location.protocol && target.port === location.port && local.includes(target.hostname) && local.includes(location.hostname)) target.hostname = location.hostname;
    return target.href;
  }
  function isHome(url) { const target = new URL(workspaceUrl(url)); return target.origin === location.origin && target.pathname === '/'; }
  function frameUrl(url) { return isHome(url) ? '/__canvas/file' : url; }
  function updateWorkspace() {
    document.getElementById('workspaceTitle').textContent = activeCanvas.label;
    document.getElementById('reviewContext').textContent = 'Reviewing ' + activeCanvas.label;
    document.getElementById('workspaceBack').disabled = !navigationHistory.length;
    workspaceController?.sync();

  }
  function navigateCanvas(url, label, push = true) {
    if (matchMedia('(max-width:860px)').matches) document.getElementById('workspaceTools').open = false;
    url = workspaceUrl(url);
    if (url === activeCanvas.url) return;
    clearPreview(); clearSpotlight(); pendingSpotlight = null;
    if (push) navigationHistory.push(activeCanvas);
    activeCanvas = { url, label };
    frame.src = frameUrl(url);
    if (isHome(url)) { dirtyWhileHeld = false; pending.classList.remove('show'); }
    updateWorkspace();
    if (lastStatus) renderDecide(lastStatus);
    document.body.classList.remove('pages-open');
    document.getElementById('pagesToggle').setAttribute('aria-expanded', 'false');
  }
  document.getElementById('workspaceHome').addEventListener('click', () => navigateCanvas(homeUrl, homeTitle));
  document.getElementById('workspaceBack').addEventListener('click', () => {
    const previous = navigationHistory.pop();
    if (previous) navigateCanvas(previous.url, previous.label, false);
  });
  const mobileFeedback = matchMedia('(max-width:860px)');
  const feedbackPanel = document.getElementById('feedbackPanel');
  const feedbackToggle = document.getElementById('feedbackToggle');
  const stage = document.querySelector('.stage');
  function setFeedbackOpen(open, restoreFocus = true) {
    document.body.classList.toggle('feedback-open', open);
    feedbackToggle.setAttribute('aria-expanded', String(open));
    const modal = open && mobileFeedback.matches;
    stage.inert = modal;
    if (modal) {
      feedbackPanel.setAttribute('role', 'dialog');
      feedbackPanel.setAttribute('aria-modal', 'true');
      document.getElementById('workspaceTools').open = false;
      document.getElementById('feedbackClose').focus();
    } else {
      feedbackPanel.removeAttribute('role'); feedbackPanel.removeAttribute('aria-modal');
      if (restoreFocus && mobileFeedback.matches) feedbackToggle.focus();
    }
  }
  feedbackToggle.addEventListener('click', () => setFeedbackOpen(!document.body.classList.contains('feedback-open')));
  document.getElementById('feedbackClose').addEventListener('click', () => setFeedbackOpen(false));
  mobileFeedback.addEventListener('change', () => setFeedbackOpen(false, false));
  document.addEventListener('keydown', (event) => {
    if (!mobileFeedback.matches) return;
    if (event.key === 'Escape') {
      if (document.body.classList.contains('feedback-open')) { event.preventDefault(); setFeedbackOpen(false); }
      else if (document.getElementById('workspaceTools').open) { document.getElementById('workspaceTools').open = false; document.querySelector('#workspaceTools > summary').focus(); }
    }
    if (event.key === 'Tab' && document.body.classList.contains('feedback-open')) {
      const controls = [...feedbackPanel.querySelectorAll('button,textarea,input,select,summary,a[href]')].filter(el => !el.disabled && el.checkVisibility());
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  document.getElementById('pagesToggle').addEventListener('click', (event) => {
    const open = document.body.classList.toggle('pages-open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });

  const frame = document.getElementById('frame');
  const pending = document.getElementById('pending');
  let mode = 'live';        // live | hold
  let autoHeld = false;     // hold auto-engaged because the user is typing
  let dirtyWhileHeld = false;
  const thread = document.getElementById('thread');
  let pinnedComponent = null;
  let forkChoice = {};       // {dim: 'a'|'b'} — sticky A/B selection, resets when the fork changes
  // The fork currently on screen. Without it, a bare Lock it / Lean this way /
  // Never do X posts a row with no dim and no value — it records THAT the user
  // acted but not on WHAT, which the agent cannot route into the engine.
  let currentFork = null;
  let lastStatus = null;
  let savedChoices = {};
  let sendingChoice = false;
  const applyChoiceBtn = document.getElementById('applyChoice');
  let inspectSources = false;
  document.getElementById('inspectSources').addEventListener('change', (e) => { inspectSources = e.target.checked; applyIoChips(); });
  let activePreview = null;  // {el, addClass, removeClass} — the one live hover-preview, if any
  let lastIoAnnotations = null; // status.json.ioAnnotations map (component -> {in,out}), if the agent supplied one
  const toastEl = document.getElementById('toast');
  let toastT = null;
  // Build the toast via DOM nodes, never innerHTML — the optional bold prefix
  // is the only markup, and both parts go in as text so no call site can ever
  // inject HTML (removes the A03/LLM02 innerHTML sink at the source).
  function toast(bold, rest) {
    toastEl.textContent = '';
    if (bold) { const b = document.createElement('b'); b.textContent = bold; toastEl.appendChild(b); }
    if (rest) toastEl.appendChild(document.createTextNode(rest));
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  // A 2.6s toast is the only confirmation a decision used to get, and it is
  // easy to miss entirely — the user then cannot tell whether their click
  // registered. This line sits under the decision and persists until the next
  // action replaces it. Text node only, same no-innerHTML rule as toast().
  // The confirmation lands where the user just acted: under the question when
  // one is on screen, otherwise under Send. With no question the decide
  // section is hidden, so a line written there was invisible and Send looked
  // like it did nothing (owner report, 2026-09-14).
  const ackEl = document.getElementById('ack');
  const sendAckEl = document.getElementById('sendAck');
  const decideSection = document.getElementById('decide');
  // A comment's confirmation belongs directly under its Send control.
  function setAck(msg, isWarn, forceSend) {
    for (const el of [ackEl, sendAckEl]) { if (el) { el.textContent = ''; el.classList.remove('warn'); } }
    const target = !forceSend && decideSection && !decideSection.hidden ? ackEl : sendAckEl;
    if (!target) return;
    target.textContent = msg || '';
    target.classList.toggle('warn', !!isWarn);
  }

  // --- Next: the explicit "this question is answered, move on" advance ---
  const nextBtn = document.getElementById('nextBtn');
  let answeredThisFork = false;
  // Next exists only when there is a question on screen AND it has an answer
  // to advance from. A disabled or dead Next with nothing after it read as a
  // broken button (owner report, 2026-09-14), so it is hidden, not disabled.
  function setNextEnabled(on) {
    const dim = currentFork && currentFork.dim;
    answeredThisFork = !!on && !!dim && !!savedChoices[dim] && savedChoices[dim] === forkChoice[dim];
    if (nextBtn) { nextBtn.hidden = !answeredThisFork; nextBtn.disabled = !answeredThisFork; }
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      if (!connected) { setAck('Not connected — nothing was sent. Retry once the canvas reconnects.', true); return; }
      const dim = currentFork ? currentFork.dim : undefined;
      const picked = dim ? savedChoices[dim] : undefined;
      if (!picked || picked !== forkChoice[dim]) { setNextEnabled(false); return; }
      nextBtn.classList.add('sending');
      const ok = await post({ kind: 'next', dim, value: picked });
      nextBtn.classList.remove('sending');
      if (!ok) { setAck('Could not confirm the save. Your input is retained; retry when connected.', true); return; }
      addLocal('next', 'Answered ' + (dim || 'this question') + ' — asked for the next one', null, true);
      setAck('Answered — asking the next question. The rail updates when it arrives.');
      setNextEnabled(false);
    });
  }

  // --- reload with scroll preservation (soft, no flash of position loss) ---
  function reloadCanvas() {
    workspaceController?.refreshPreviews();
    // A fresh document replaces every node in the iframe — any element a
    // preview was touching is about to go stale. The file on disk IS the
    // committed truth, so a reload is itself the "revert to committed state".
    activePreview = null;
    let y = 0;
    try { y = frame.contentWindow.scrollY || 0; } catch {}
    frame.addEventListener('load', function once() {
      frame.removeEventListener('load', once);
      try { frame.contentWindow.scrollTo(0, y); } catch {}
      wireCanvasClicks();
    });
    const url = new URL(frameUrl(activeCanvas.url), location.href);
    url.searchParams.set('t', Date.now());
    frame.src = url.href;
  }
  function applyPending() {
    // Clear the user-visible stale state before replacing the iframe. A canvas
    // or third-party annotation may throw while reacting to its load event;
    // that must not leave the rail claiming that an update is still pending.
    dirtyWhileHeld = false;
    pending.classList.remove('show');
    requestAnimationFrame(() => {
      if (!isHome(activeCanvas.url)) navigateCanvas(homeUrl, homeTitle);
      else reloadCanvas();
    });
  }
  pending.addEventListener('click', applyPending);
  // Explicit Hold and an unsent draft remain frozen until the user requests
  // a refresh or returns to Live. Focus and navigation never discard Hold.
  function wakePending() {
    if (!dirtyWhileHeld || held() || !isHome(activeCanvas.url) || document.visibilityState !== 'visible') return;
    applyPending();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wakePending();
  });
  window.addEventListener('focus', wakePending);
  // Capture pointer intent before option-specific handlers or injected canvas
  // tooling run. This makes a real tap/click a reliable wake boundary even
  // when later handlers fail, while the dirty guard keeps ordinary input inert.
  document.addEventListener('pointerdown', wakePending, { capture: true, passive: true });
  document.addEventListener('click', wakePending);
  document.addEventListener('keydown', wakePending);

  // --- decision preview: hover/focus a fork option -> live class toggle on
  // the spotlighted [data-component] inside the iframe. Purely visual, never
  // touches the canvas file. clearPreview() exactly UNDOES the one active
  // preview (add<->remove), which is what reverts the DOM to what the file
  // on disk actually says — no snapshotting needed.
  function applyPreview(component, addClass, removeClass) {
    clearPreview();
    if (!isHome(activeCanvas.url)) return;
    let doc; try { doc = frame.contentDocument; } catch { return; }
    if (!doc || !component) return;
    let el;
    try { el = doc.querySelector('[data-component="' + CSS.escape(component) + '"]'); } catch { return; }
    if (!el) return;
    const hadAdd = addClass ? el.classList.contains(addClass) : false;
    const hadRemove = removeClass ? el.classList.contains(removeClass) : false;
    if (addClass) el.classList.add(addClass);
    if (removeClass) el.classList.remove(removeClass);
    activePreview = { el, addClass, removeClass, hadAdd, hadRemove };
    // Hovering an option must also put the affected block on screen, or the
    // preview changes something the user cannot see.
    const r = el.getBoundingClientRect();
    const vh = (frame.contentWindow && frame.contentWindow.innerHeight) || 0;
    if (vh && (r.top < 0 || r.bottom > vh)) {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); } catch { /* detached */ }
    }
  }
  // --- spotlight: show WHICH part of the canvas a decision is about ---
  // A question about the board is useless if the board is scrolled off screen.
  // Scroll the affected [data-component] into view and outline it, so the user
  // is always looking at the thing they are being asked about.
  let activeSpotlight = null;
  // status.json can arrive before the iframe finishes loading, and it can be
  // replaced by a canvas reload. Remember what should be lit and re-apply it
  // on every load, or the first question spotlights nothing.
  let pendingSpotlight = null;
  function clearSpotlight() {
    if (!activeSpotlight) return;
    try {
      activeSpotlight.el.style.outline = activeSpotlight.prevOutline;
      activeSpotlight.el.style.outlineOffset = activeSpotlight.prevOffset;
    } catch { /* element detached on canvas reload — nothing to revert */ }
    activeSpotlight = null;
  }
  function spotlight(component, doScroll) {
    clearSpotlight();
    pendingSpotlight = component ? { component, doScroll } : null;
    let doc; try { doc = frame.contentDocument; } catch { return; }
    // Not loaded yet — frame 'load' re-runs this from pendingSpotlight.
    if (doc && doc.readyState === 'loading') return;
    if (!doc || !component) return;
    let el;
    try { el = doc.querySelector('[data-component="' + CSS.escape(component) + '"]'); } catch { return; }
    if (!el) return;
    activeSpotlight = { el, prevOutline: el.style.outline, prevOffset: el.style.outlineOffset };
    el.style.outline = '2px solid ' + SPOTLIGHT_COLOR;
    el.style.outlineOffset = '4px';
    if (!doScroll) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); }
    catch { try { el.scrollIntoView(); } catch { /* detached */ } }
  }
  const SPOTLIGHT_COLOR = '#e0a94a';
  // Re-light after every canvas load (first paint, and every hot reload — a
  // reload replaces the document and discards the inline outline).
  frame.addEventListener('load', () => {
    if (!pendingSpotlight) return;
    activeSpotlight = null;                       // old element is gone with the old document
    const { component, doScroll } = pendingSpotlight;
    spotlight(component, doScroll);
  });

  function clearPreview() {
    if (!activePreview) return;
    const { el, addClass, removeClass, hadAdd, hadRemove } = activePreview;
    try {
      if (addClass) el.classList.toggle(addClass, hadAdd);
      if (removeClass) el.classList.toggle(removeClass, hadRemove);
    } catch { /* element detached (canvas reloaded mid-hover) — nothing to revert */ }
    activePreview = null;
  }
  function restoreChoicePreview() {
    if (!currentFork || !isHome(activeCanvas.url)) return;
    const option = currentFork[forkChoice[currentFork.dim]];
    const preview = option && option.preview;
    if (preview && preview.component) applyPreview(preview.component, preview.addClass, preview.removeClass);
  }
  frame.addEventListener('load', restoreChoicePreview);
  async function postPreview(row) {
    try {
      await fetch('/__canvas/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row), signal: AbortSignal.timeout(4000) });
    } catch { /* preview is best-effort; a dropped hover event is not user-visible harm */ }
  }

  // Effective hold = user chose Hold, OR is mid-comment (auto-hold).
  function held() { return mode === 'hold' || autoHeld; }
  function updateHoldHint() {
    const hint = document.getElementById('holdHint');
    hint.hidden = !held();
    document.getElementById('previewMode').textContent = mode === 'hold' ? 'Hold' : autoHeld ? 'Paused · unsent note' : 'Live';
    hint.textContent = mode === 'hold' ? 'Preview updates are on Hold. Refresh a pending update or choose Live.' : 'Preview updates paused while your note is unsent.';
  }

  // --- connection liveness: the rail must NEVER look "Live" while the SSE
  // channel is actually dead (server killed, tab left open — the recurring
  // bug this closes). connected gates Send/decide so a POST into a dead
  // server surfaces immediately instead of hanging or silently no-op'ing.
  let connected = true;
  let statusUnavailable = false;
  let lastAlive = Date.now();
  const connBanner = document.getElementById('connBanner');
  function updateConnectionBanner() {
    connBanner.textContent = !connected ? 'Disconnected — reconnecting. Your draft is retained.' : 'Decision status unavailable. Existing preview and draft are retained.';
    connBanner.classList.toggle('show', !connected || statusUnavailable);
  }
  function setConnected(next) {
    if (connected === next) return;
    connected = next;
    document.body.classList.toggle('gw-disconnected', !connected);
    updateConnectionBanner();
  }
  // Heartbeat watchdog: even if the browser never fires onerror (e.g. a
  // network partition with no clean close), a stale connection is still
  // caught within ~25s of the last frame of ANY kind (ping included).
  setInterval(() => {
    if (connected && Date.now() - lastAlive > 25000) setConnected(false);
  }, 5000);

  // --- SSE ---
  const es = new EventSource('/__canvas/events');
  es.onopen = () => { lastAlive = Date.now(); setConnected(true); loadStatus(); workspaceController?.refreshFeedback(); };
  es.onerror = () => { setConnected(false); };
  es.onmessage = (e) => {
    lastAlive = Date.now();
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'reload') {
      if (held() || !isHome(activeCanvas.url)) {
        dirtyWhileHeld = true; pending.textContent = isHome(activeCanvas.url) ? 'Preview update available · refresh' : 'Home updated · return to review'; pending.classList.add('show');
      }
      else reloadCanvas();
    } else if (m.type === 'status') {
      loadStatus();
    } else if (m.type === 'feedback') {
      workspaceController?.refreshFeedback();
    } else if (m.type === 'preview') {
      applyPreview(m.component, m.addClass, m.removeClass);
    } else if (m.type === 'preview-clear') {
      clearPreview(); restoreChoicePreview();
    } else if (m.type === 'ping') {
      // liveness only — lastAlive already bumped above, nothing to render.
      if (!connected) setConnected(true);
    }
  };

  // --- Live/Hold toggle ---
  document.getElementById('toggle').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const nextMode = b.dataset.mode;
    if (!connected || !await post({ kind: 'toggle', mode: nextMode })) { setAck('Could not save Live/Hold. Your current mode is unchanged.', true, true); return; }
    mode = nextMode; updateHoldHint();
    for (const btn of document.getElementById('toggle').children) btn.classList.toggle('on', btn === b);
    if (!held() && dirtyWhileHeld) applyPending();
  });

  // --- comment auto-hold: freeze the canvas while the user is composing ---
  const comment = document.getElementById('comment');
  const draftKey = 'gw-workspace:' + homeUrl + ':composer';
  function persistComposer() {
    try {
      if (comment.value) localStorage.setItem(draftKey, JSON.stringify({ text: comment.value, canvas: draftCanvas || activeCanvas, component: pinnedComponent }));
      else localStorage.removeItem(draftKey);
    } catch {}
  }
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey));
    if (saved && typeof saved.text === 'string' && saved.canvas && typeof saved.canvas.url === 'string') {
      comment.value = saved.text; draftCanvas = saved.canvas; pinnedComponent = saved.component || null;
      autoHeld = !!comment.value; setPin(); updateHoldHint();
    }
  } catch {}

  comment.addEventListener('focus', () => { autoHeld = true; updateHoldHint(); });
  comment.addEventListener('input', () => {
    if (comment.value && !draftCanvas) draftCanvas = { ...activeCanvas };
    if (!comment.value && !pinnedComponent) draftCanvas = null;
    autoHeld = !!comment.value; updateHoldHint();
    setPin(); persistComposer();
  });
  comment.addEventListener('blur', () => {
    autoHeld = !!comment.value; updateHoldHint();
    if (!held() && dirtyWhileHeld) applyPending();
  });

  // --- chips send feedback ---
  // [data-kind] only — Next carries no kind and has its own handler below.
  for (const chip of document.querySelectorAll('.chip[data-kind]')) {
    chip.addEventListener('click', async () => {
      if (chip.disabled) return;
      // Never let Send/lock/lean/never queue into a dead connection and go
      // quiet — the user must SEE the action didn't land, immediately, with
      // no network round-trip that could itself hang.
      if (!connected) { setAck('Not connected — nothing was sent. Retry once the canvas reconnects.', true, chip.dataset.kind === 'comment'); toast('', 'Not connected — reconnecting. Nothing was sent; try again once the canvas reconnects.'); return; }
      const kind = chip.dataset.kind;
      const originalDraft = comment.value;
      const text = originalDraft.trim();
      // An empty Send used to focus the box and return with no message at all,
      // which reads as a dead button. Say why nothing was sent.
      if (!text && kind === 'comment') {
        setAck('Type a note first, then send it.', true, true);
        comment.focus();
        return;
      }
      const pinnedAtSend = pinnedComponent;
      // Attach what the chip is ACTING ON. A lock/lean/never with no text and
      // no pin used to post an empty row; carrying the on-screen fork's dim and
      // the currently selected option makes "Lean this way" mean "lean toward
      // the option I just picked", which is what the click plainly intends.
      const dim = (kind !== 'comment' && currentFork) ? currentFork.dim : undefined;
      const picked = dim ? forkChoice[dim] : undefined;
      if (kind !== 'comment' && !text && !dim && !pinnedAtSend) {
        setAck('Nothing to attach this to — pick an option above, pin a block on the canvas, or type a note first.', true);
        return;
      }
      chip.classList.add('sending'); chip.disabled = true;
      const source = draftCanvas || activeCanvas;
      const ok = await post({ kind, text, component: pinnedAtSend, dim, value: picked, canvasUrl: source.url, canvasLabel: source.label });
      chip.classList.remove('sending'); chip.disabled = false;
      if (!ok) { setAck('Could not confirm the save. Your input is retained; retry when connected.', true, kind === 'comment'); toast('', 'Could not reach the canvas server — is it still running?'); return; }
      addLocal(kind, text || '(no note)', pinnedAtSend, true);
      const label = { comment: 'Comment sent', lock: 'Locked', lean: 'Noted a lean', never: 'Set a hard rule' }[kind] || 'Sent';
      const onWhat = picked && currentFork
        ? ' on ' + ((picked === 'a' ? currentFork.a.label : currentFork.b.label) || picked)
        : (pinnedAtSend ? ' on ' + pinnedAtSend : '');
      if (kind !== 'comment') setNextEnabled(true);
      if (currentFork && kind !== 'comment') {
        setAck(label + onWhat + ' · saved. Waiting for the agent to apply it.');
      } else {
        setAck(label + onWhat + ' · saved for ' + source.label + '. Waiting for the agent to apply it.', false, kind === 'comment');
      }
      toast(label, ' · saved' + (pinnedAtSend ? ' · ' + pinnedAtSend : ''));
      if (comment.value === originalDraft) { comment.value = ''; pinnedComponent = null; draftCanvas = null; }
      setPin(); persistComposer(); autoHeld = !!comment.value; updateHoldHint();
      if (!held() && dirtyWhileHeld) applyPending();
    });
  }

  // --- DOM builder: no innerHTML anywhere in the rail, so typed/imported text
  // can never become executable HTML. Every value goes in as a text node.
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === 'class') e.className = props[k];
      else if (k === 'dataset') Object.assign(e.dataset, props[k]);
      else if (k.slice(0, 2) === 'on' && typeof props[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else e.setAttribute(k, props[k]);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // --- decide A/B ---
  function renderDecide(st) {
    const body = document.getElementById('decide-body');
    clear(body);
    applyChoiceBtn.disabled = true;
    applyChoiceBtn.hidden = false;
    currentFork = null;
    if (!isHome(activeCanvas.url)) { decideSection.hidden = true; return; }
    // Show the decide section only when the agent has put something in it:
    // a converged state, an A/B fork, or a named next question. Otherwise its
    // "Waiting for the first question" copy and chips promise an exchange that
    // is not happening.
    const hasFork = !!(st && !st.ready && st.fork && st.fork.a && st.fork.b);
    document.getElementById('choiceHint').hidden = !hasFork;
    applyChoiceBtn.hidden = !hasFork;
    if (decideSection) decideSection.hidden = !(st && (st.ready || hasFork || st.next_question));
    if (st && st.ready) { applyChoiceBtn.hidden = true; setNextEnabled(false); body.append(h('p', { class: 'noq done' }, 'Direction saved. Add a note to keep refining.')); return; }
    const fork = st && st.fork;
    const prevDim = body.dataset.dim;
    body.dataset.dim = fork && fork.dim || '';
    currentFork = (fork && fork.a && fork.b) ? fork : null;
    // A newly-arrived question is unanswered: Next goes back to disabled unless
    // this fork already carries a sticky selection.
    if (!currentFork) setNextEnabled(false);
    else setNextEnabled(savedChoices[currentFork.dim] === forkChoice[currentFork.dim] && !!forkChoice[currentFork.dim]);
    if (fork && fork.a && fork.b) {
      body.append(h('p', { class: 'qtext' }, fork.question || 'Which direction?'));
      applyChoiceBtn.disabled = !forkChoice[fork.dim] || savedChoices[fork.dim] === forkChoice[fork.dim] || sendingChoice;
      if (savedChoices[fork.dim]) body.append(h('p', { class: 'choice-status' }, 'Current choice: ' + ((fork[savedChoices[fork.dim]] || {}).label || savedChoices[fork.dim]) + ' · saved, awaiting agent'));
      // Name the part of the canvas this question changes, and put it on screen.
      // Without this the user is asked about a section they cannot see.
      const affectsComp = (fork.a.preview && fork.a.preview.component)
        || (fork.b.preview && fork.b.preview.component) || null;
      if (affectsComp) {
        body.append(h('p', { class: 'affects' },
          'Changes ', h('b', {}, fork.affectsLabel || affectsComp), ' — outlined on the canvas'));
        if (currentFork && currentFork.dim !== prevDim) spotlight(affectsComp, true);
      }
      const mkBtn = (opt, o) => {
        const btn = h('button', { dataset: { opt } },
          h('span', { class: 'lbl' }, o.label || opt.toUpperCase()),
          h('span', { class: 'sub' }, o.sub || ''));
        btn.setAttribute('aria-pressed', String(forkChoice[fork.dim] === opt));
        if (forkChoice[fork.dim] === opt) btn.classList.add('selected');
        // Live decision preview — additive, backward-compatible: only wired
        // when this option carries a preview.component (status.json fork.*.preview).
        // Options with no preview field behave exactly as before (no listeners).
        const preview = o && o.preview && typeof o.preview === 'object' ? o.preview : null;
        if (preview && preview.component) {
          const start = () => postPreview({ component: preview.component, addClass: preview.addClass || null, removeClass: preview.removeClass || null });
          const stop = () => postPreview({ clear: true });
          btn.addEventListener('mouseenter', start);
          btn.addEventListener('focus', start);       // keyboard users get the same preview
          btn.addEventListener('mouseleave', stop);
          btn.addEventListener('blur', stop);
        }
        btn.addEventListener('click', () => {
          forkChoice[fork.dim] = opt;
          for (const b of body.querySelectorAll('.ab button')) { b.classList.toggle('selected', b === btn); b.setAttribute('aria-pressed', String(b === btn)); }
          if (preview && preview.component) applyPreview(preview.component, preview.addClass, preview.removeClass);
          applyChoiceBtn.disabled = savedChoices[fork.dim] === opt;
          setNextEnabled(savedChoices[fork.dim] === opt);
          setAck('Previewing ' + (o.label || opt.toUpperCase()) + '. Apply choice to save it.');
        });
        return btn;
      };
      body.append(h('div', { class: 'ab' }, mkBtn('a', fork.a), mkBtn('b', fork.b)));
    } else if (st && st.next_question) {
      body.append(
        h('p', { class: 'qtext' }, labelFor(st.next_question)),
        h('p', { class: 'noq' }, 'Send a note above to answer this question.'));
      applyChoiceBtn.hidden = true;
    } else {
      body.append(h('p', { class: 'noq' }, 'Waiting for the first question…'));
    }
  }
  function labelFor(dim) {
    return 'Next: ' + dim.replace(/\\./g, ' · ').replace(/_/g, ' ') + '?';
  }

  applyChoiceBtn.addEventListener('click', async () => {
    if (sendingChoice || !currentFork) return;
    if (!connected) { setAck('Not connected. Your preview is retained; retry when connected.', true); return; }
    const fork = currentFork;
    const opt = forkChoice[fork.dim];
    if (!opt) return;
    sendingChoice = true; applyChoiceBtn.disabled = true;
    const ok = await post({ kind: 'decide', dim: fork.dim, value: opt, canvasUrl: homeUrl, canvasLabel: homeTitle });
    sendingChoice = false;
    if (!ok) { applyChoiceBtn.disabled = false; setAck('Could not confirm this choice was saved. Your preview is retained; retry when connected.', true); return; }
    savedChoices[fork.dim] = opt;
    addLocal('decide', (fork.question || fork.dim) + ' → ' + (fork[opt].label || opt), null, true);
    if (currentFork && currentFork.dim === fork.dim) {
      setNextEnabled(true); renderDecide(lastStatus);
      setAck('Choice saved. Waiting for the agent to apply it.');
    }
  });

  // Decisions carried forward are concrete status, not an inferred confidence score.
  function renderMeter(st) {
    const decided = st && st.decided ? Object.keys(st.decided).length : 0;
    document.getElementById('progress').textContent = decided ? decided + ' decision' + (decided === 1 ? '' : 's') + ' carried forward' : 'No decisions carried forward yet';
    const ll = document.getElementById('lockedlist');
    clear(ll);
    if (st && st.decided) {
      const entries = Object.entries(st.decided);
      entries.forEach(([k, v], i) => {
        ll.append(k.split('.').pop() + ': ', h('b', null, String(v)));
        if (i < entries.length - 1) ll.append(' · ');
      });
    }
    const badges = document.getElementById('decisionBadges');
    clear(badges);
    const tally = {};
    if (st && st.decisionMeta && typeof st.decisionMeta === 'object') {
      for (const [id, meta] of Object.entries(st.decisionMeta)) {
        if (!meta || !['locked', 'leaning', 'open', 'experimental', 'superseded'].includes(meta.rigidity)) continue;
        const label = meta.label || id;
        tally[meta.rigidity] = (tally[meta.rigidity] || 0) + 1;
        badges.append(h('span', {
          class: 'decision-badge rigidity-' + meta.rigidity,
          role: 'status',
          'aria-label': label + ': ' + meta.rigidity + (meta.scope ? '; scope ' + meta.scope : ''),
          title: meta.note || ''
        }, meta.rigidity + ' · ' + label));
      }
    }
    // Collapsed summary: the count plus a per-rigidity breakdown in words, so
    // status never rides on color and the list opens only on demand.
    const logEl = document.getElementById('decisionLog');
    const summaryEl = document.getElementById('decisionSummary');
    const badgeCount = badges.childElementCount;
    const decidedCount = st && st.decided ? Object.keys(st.decided).length : 0;
    const shown = badgeCount || decidedCount;
    if (logEl) logEl.hidden = shown === 0;
    if (summaryEl) {
      const parts = ['locked', 'leaning', 'open', 'experimental', 'superseded']
        .filter((r) => tally[r]).map((r) => tally[r] + ' ' + r);
      summaryEl.textContent = shown + ' decision' + (shown === 1 ? '' : 's') + (parts.length ? ' · ' + parts.join(', ') : '');
    }
  }

  // --- pinning: click a labelled block inside the canvas ---
  function wireCanvasClicks() {
    let doc; try { doc = frame.contentDocument; } catch { return; }
    if (!doc) return;
    // Pinnable blocks outline on hover, so the rail's "click any part of the
    // design" hint points at something visible. Stylesheet rule, not inline
    // style: the decision spotlight's inline outline still wins over it.
    try {
      if (doc.head && !doc.querySelector('style[data-gw-pin-hover]')) {
        const st = doc.createElement('style');
        st.setAttribute('data-gw-pin-hover', '1');
        st.textContent = '[data-component]:hover{outline:1px dashed #6ea8fe;outline-offset:2px}';
        doc.head.appendChild(st);
      }
    } catch { /* canvas without a head — pinning still works */ }
    for (const el of doc.querySelectorAll('[data-component]')) {
      el.style.cursor = 'crosshair';
      el.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        pinnedComponent = el.getAttribute('data-component'); draftCanvas = { ...activeCanvas }; setPin();
        setFeedbackOpen(true); comment.focus();
      }, { capture: true });
    }
    renderIoChips(doc);
  }

  // --- per-element data-I/O annotation (feat-io-annotation-ui) ---------------
  // Optional, non-destructive display of an element's data contract. Two
  // sources, either or both may be present, inline attrs win:
  //   1. inline data-datain / data-dataout attributes the agent wrote
  //      directly onto a [data-component] element in the canvas HTML.
  //   2. status.json's optional ioAnnotations map, keyed by the same
  //      data-component name, e.g. {"logRunButton": {"in": "...", "out": "..."}}.
  // A canvas with neither source produces zero chips — same DOM as before
  // this feature landed. Same direct-DOM parent-script technique as the
  // decide-target preview above: never writes the canvas file, purely visual.
  function renderIoChips(doc) {
    if (!doc) return;
    for (const el of doc.querySelectorAll('[data-component]')) {
      // Idempotent: drop any chip from a prior call before deciding whether to
      // (re)add one. Safe against the double wireCanvasClicks() fire on
      // reload and lets a chip disappear if its wire is later removed.
      const old = el.querySelector(':scope > [data-gw-io-chip]');
      if (old) old.remove();

      const name = el.getAttribute('data-component');
      const fromMap = lastIoAnnotations && name ? lastIoAnnotations[name] : null;
      const inText = el.getAttribute('data-datain') || (fromMap && fromMap.in) || '';
      const outText = el.getAttribute('data-dataout') || (fromMap && fromMap.out) || '';
      if (!inspectSources || (!inText && !outText)) continue; // backward-compatible: nothing declared, nothing rendered

      const parts = [];
      if (inText) parts.push('in: ' + inText);
      if (outText) parts.push('out: ' + outText);
      const chip = doc.createElement('span');
      chip.setAttribute('data-gw-io-chip', '1');
      chip.textContent = parts.join(' · ');
      Object.assign(chip.style, {
        display: 'inline-block', marginLeft: '6px', padding: '1px 7px', borderRadius: '999px',
        font: '600 10px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        letterSpacing: '.01em', verticalAlign: 'middle', pointerEvents: 'none',
        background: 'rgba(110,168,254,.16)', color: '#2b6cf0', border: '1px solid rgba(110,168,254,.4)',
      });
      el.appendChild(chip);
    }
  }
  function applyIoChips() {
    let doc; try { doc = frame.contentDocument; } catch { return; }
    renderIoChips(doc);
  }
  function setPin() {
    const bar = document.getElementById('pinbar');
    clear(bar);
    if (pinnedComponent) bar.append('Attached to ', h('b', null, pinnedComponent), ' on ' + (draftCanvas || activeCanvas).label);
    else if (draftCanvas) bar.append('Note for ', h('b', null, draftCanvas.label), ' · draft retained while browsing');
    else bar.append('Click any part of the design (it outlines on hover) to attach your note to it');
  }

  // --- feedback thread (local echo; source of truth is feedback.jsonl) ---
  function addLocal(kind, text, component, queued) {
    const k = h('div', { class: 'k' }, kind + (component ? ' · ' + component : ''));
    if (queued) k.append(h('span', { class: 'q' }, 'saved · awaiting agent'));
    thread.prepend(h('div', { class: 'item ' + kind }, k, h('div', { class: 't' }, text)));
    // Recent stays hidden until it has something in it.
    const recent = document.getElementById('recent');
    if (recent) recent.hidden = false;
  }

  async function post(row) {
    try {
      const r = await fetch('/__canvas/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row), signal: AbortSignal.timeout(4000) });
      return r.ok;
    } catch { return false; }
  }
  async function loadStatus() {
    try {
      const response = await fetch('/__canvas/status?t=' + Date.now());
      if (!response.ok) throw new Error('status unavailable');
      const st = await response.json();
      statusUnavailable = false; updateConnectionBanner();
      lastStatus = st;
      renderDecide(st); renderMeter(st);
      lastIoAnnotations = st && st.ioAnnotations && typeof st.ioAnnotations === 'object' ? st.ioAnnotations : null;
      applyIoChips();
    } catch { statusUnavailable = true; updateConnectionBanner(); }
  }

  // --- mode rehydrate: on load, mode.json is the source of truth (server-
  // owned, PROTOCOL.md §6). A page refresh must reflect a Hold set from a
  // prior tab, not silently reset the toggle back to Live.
  async function loadMode() {
    try {
      const m = await (await fetch('/__canvas/mode?t=' + Date.now())).json();
      if (m && (m.mode === 'live' || m.mode === 'hold')) {
        mode = m.mode; updateHoldHint();
        const toggle = document.getElementById('toggle');
        for (const btn of toggle.children) btn.classList.toggle('on', btn.dataset.mode === mode);
      }
    } catch {}
  }

  workspaceController = (${installWorkspace.toString()})({ h, homeUrl, homeTitle, workspaceUrl, frameUrl, isHome, navigateCanvas, getActiveCanvas: () => activeCanvas, post, addLocal });
  frame.addEventListener('load', wireCanvasClicks);
  updateWorkspace();
  loadMode();
  loadStatus();
})();
</script>
</body></html>`;
  }
}

// =============================================================================
// GALLERY MODE (`--mode gallery`) — Groundwork's own divergence/compare
// surface: renders every slot in designer/mockups' manifest.json grouped by
// screen, side by side, each rateable (yay/ok/nay), with a per-screen winner
// pick and a per-slot note. This is the divergence counterpart to iterate's
// convergence-by-conversation loop above. Entirely separate HTTP server,
// separate control-dir state file (gallery-selections.json) — does not touch
// or import the external mockup-gallery plugin.
// =============================================================================
function runGallery() {
  const GALLERY_DIR_ARG = flag('--dir', '');
  if (!GALLERY_DIR_ARG) {
    console.error('canvas-server: --dir <mockups-dir> is required in gallery mode');
    process.exit(2);
  }
  const GALLERY_DIR = path.resolve(GALLERY_DIR_ARG);
  const REAL_GALLERY_DIR = fs.realpathSync(GALLERY_DIR);
  const MANIFEST_FILE = path.join(GALLERY_DIR, 'manifest.json');
  if (!fs.existsSync(MANIFEST_FILE) || !fs.statSync(MANIFEST_FILE).isFile()) {
    console.error('canvas-server: --dir must contain manifest.json (designer/mockups/manifest.schema.json)');
    process.exit(2);
  }
  const CTRL_DIR = path.join(GALLERY_DIR, '.canvas');
  const FEEDBACK_FILE = path.join(CTRL_DIR, 'feedback.jsonl');
  const SELECTIONS_FILE = path.join(CTRL_DIR, 'gallery-selections.json');
  const PORT_START = parseInt(flag('--port', '8930'), 10);
  const TITLE = flag('--title', path.basename(GALLERY_DIR));
  const GALLERY_STARTED_AT = new Date().toISOString();
  const GALLERY_INSTANCE = flag('--gallery-instance', '');

  fs.mkdirSync(CTRL_DIR, { recursive: true });

  function readJSON(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return dflt; } }
  function writeJSONAtomic(p, obj) {
    const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(obj));
      fs.renameSync(tmp, p);
    } catch (err) {
      // A failed write (full disk, read-only control dir, a rename across a
      // boundary) used to leave its .tmp-<pid>-<ts> file behind forever, and
      // the name is unique per attempt — so a repeatedly-failing write silently
      // littered the control dir the user is told to read. Clean up, then
      // rethrow unchanged: the caller still decides what a failure means.
      try { fs.unlinkSync(tmp); } catch { /* never written, or already gone */ }
      throw err;
    }
  }
  function defaultSelections() {
    return {
      schema: 'groundwork.gallery-selections/v2',
      ratings: {},
      picks: {},
      notes: {},
      annotations: {},
      reviewArchive: {},
      reviewReopen: {},
    };
  }
  function normalizeSelections(value) {
    const sel = value && typeof value === 'object' ? value : {};
    sel.schema = 'groundwork.gallery-selections/v2';
    if (!sel.ratings || typeof sel.ratings !== 'object') sel.ratings = {};
    if (!sel.picks || typeof sel.picks !== 'object') sel.picks = {};
    if (!sel.notes || typeof sel.notes !== 'object') sel.notes = {};
    if (!sel.annotations || typeof sel.annotations !== 'object') sel.annotations = {};
    if (!sel.reviewArchive || typeof sel.reviewArchive !== 'object') sel.reviewArchive = {};
    if (!sel.reviewReopen || typeof sel.reviewReopen !== 'object') sel.reviewReopen = {};
    return sel;
  }
  function cleanText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }
  function finiteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function clamp01(value) { return Math.min(1, Math.max(0, finiteNumber(value))); }
  function normalizeAnnotation(raw, existing, now) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const target = source.target && typeof source.target === 'object' ? source.target : {};
    const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {};
    const documentSize = source.document && typeof source.document === 'object' ? source.document : {};
    const bounds = source.bounds && typeof source.bounds === 'object' ? source.bounds : {};
    const suppliedId = cleanText(source.id, 120);
    const id = /^[A-Za-z0-9._:-]+$/.test(suppliedId)
      ? suppliedId
      : `ann-${Date.now()}-${feedbackSeq}`;
    const boundsX = clamp01(bounds.x);
    const boundsY = clamp01(bounds.y);
    // "archived" is accepted ONLY with the provenance that makes it meaningful:
    // an archivedAt that parses as a date AND an archivedFrom naming a real
    // version id. The status is what hides an annotation from the live overlay,
    // so a bare status:"archived" — from a hand-edited file or a POST — would
    // otherwise make critique disappear with nothing recoverable behind it.
    // Unaccompanied, it collapses to "open" like every other unknown status.
    const archivedFrom = cleanText(source.archivedFrom, 40);
    const archivedAtMs = Date.parse(cleanText(source.archivedAt, 40));
    const isArchived = source.status === 'archived'
      && Number.isFinite(archivedAtMs) && VERSION_RE.test(archivedFrom);
    const record = {
      id,
      marker: source.marker === 'box' || source.marker === 'square' ? 'box' : 'dot',
      x: clamp01(source.x),
      y: clamp01(source.y),
      bounds: {
        x: boundsX,
        y: boundsY,
        width: Math.min(clamp01(bounds.width), 1 - boundsX),
        height: Math.min(clamp01(bounds.height), 1 - boundsY),
      },
      target: {
        selector: cleanText(target.selector, 500),
        component: cleanText(target.component, 160),
        tag: cleanText(target.tag, 80).toLowerCase(),
        role: cleanText(target.role, 120),
        label: cleanText(target.label, 240),
        text: cleanText(target.text, 500),
      },
      viewport: {
        width: Math.max(0, Math.round(finiteNumber(viewport.width))),
        height: Math.max(0, Math.round(finiteNumber(viewport.height))),
      },
      document: {
        width: Math.max(0, Math.round(finiteNumber(documentSize.width))),
        height: Math.max(0, Math.round(finiteNumber(documentSize.height))),
      },
      comment: cleanText(source.comment, 4000),
      // resolved semantics are untouched by the widened enum: it is still a
      // deliberate user disposition, and it is never produced or consumed here.
      status: source.status === 'resolved' ? 'resolved' : (isArchived ? 'archived' : 'open'),
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now,
    };
    // ADDED, not emitted as undefined keys. The published schema is
    // additionalProperties:false and this record is embedded verbatim into the
    // builder packet, so an open annotation must carry exactly the fields an
    // open annotation had before "archived" existed.
    if (isArchived) {
      record.archivedAt = new Date(archivedAtMs).toISOString();
      record.archivedFrom = archivedFrom;
    }
    return record;
  }
  function loadManifest() { return readJSON(MANIFEST_FILE, {}); }
  function slotPaths() {
    const m = loadManifest();
    const slots = Array.isArray(m.slots) ? m.slots : [];
    return slots.map((s) => s && s.html_path).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // CROSS-SESSION TASTE PROFILE — the gallery's compounding layer
  //
  // WHAT: a pick (the decisive act), a yay, a nay, and a new element annotation
  // are revealed preference. They already land in this design's
  // gallery-selections.json; here they ALSO fold into Groundwork's existing
  // cross-session profile (designer/decide/profile.py) so taste compounds
  // globally — across projects and over time — and the next run starts warmer.
  //
  // NOT A SECOND STORE: every write goes through `profile.py record-dims`, the
  // same record_session() the elicit/iterate path uses. The compounding math
  // lives in exactly one place, in one language.
  //
  // PRIVACY BOUNDARY: mode ids and component names ONLY. Annotation comment
  // text, note text, file paths, project names, and slot filenames never leave
  // this design dir. Enforced by SAFE_TOKEN below — a structural guard, not a
  // promise in a comment.
  //
  // NEVER BREAKS THE GALLERY: the record is enqueued AFTER the feedback response
  // is written and drained on a later tick, one child at a time. A missing
  // python3 or a failing write logs once and recording stops; serving does not.
  const PROFILE_SCHEMA = 'groundwork.decide.profile/v1';   // mirrors profile.py SCHEMA
  const PROFILE_STORE = process.env.GROUNDWORK_PROFILE_STORE
    || path.join(os.homedir(), 'dev', 'designs', '.groundwork-profile.json');  // mirrors profile.py DEFAULT_STORE
  const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
  const PROFILE_QUEUE_MAX = 200;   // bounded: an external-input-fed queue never grows without a cap

  // Only a well-formed identifier may become global cross-project state. No
  // slashes, quotes, newlines, or sentences — so a path, a project name, or a
  // free-text comment structurally cannot be recorded even if a hand-edited
  // manifest or a hostile page supplies one.
  const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,79}$/;
  function safeToken(value) {
    const s = typeof value === 'string' ? value.trim() : '';
    return SAFE_TOKEN.test(s) ? s : '';
  }
  // A slot's design mode, per manifest.json slots[]. An unknown slot (or a mode
  // that fails the guard) yields '' — and no record is made.
  function slotMode(slot) {
    const manifestSlots = loadManifest().slots;
    const slots = Array.isArray(manifestSlots) ? manifestSlots : [];
    const hit = slots.find((s) => s && s.html_path === slot);
    return hit ? safeToken(hit.mode) : '';
  }

  // ONE GALLERY SESSION IS ONE CONFIRMATION per dimension+value. The profile
  // counts SESSIONS — three settle a dimension into "auto-kept, never re-asked"
  // taste — and this server process is one review session. Comparing against the
  // stored value (below) catches a repeated click but NOT a toggle: yay -> ok ->
  // yay -> ok -> yay re-arms it every time, which is ordinary behavior while
  // comparing options and would manufacture settled taste out of a single
  // sitting. This set is what actually makes the guarantee hold. It doubles as
  // the cardinality bound on how much one server can add to the global store.
  const profileRecorded = new Set();
  const PROFILE_DISTINCT_MAX = 200;
  const PROFILE_CHILD_TIMEOUT_MS = 10000;
  const PROFILE_MAX_FAILURES = 3;

  // The gallery is served on loopback at the port this process actually bound
  // (PORT is reassigned on EADDRINUSE, so read it at request time, not at boot).
  // Every loopback spelling that actually reaches this server is allowed —
  // rejecting one the user happened to type would 403 their every click.
  const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1', '[::]']);
  function isGalleryOrigin(origin) {
    try {
      const u = new URL(origin);
      return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname) && u.port === String(PORT);
    } catch { return false; }   // an unparseable Origin is not the gallery
  }

  // Read token for GET /__gallery/profile. Printed on the launch banner and
  // NEVER embedded in any served HTML — which is precisely what makes it work
  // here: slot HTML runs same-origin and could fetch the shell, so a token
  // baked into the shell would be no boundary at all. Nothing in the browser
  // consumes this endpoint (the host agent uses `profile show`, the user reads
  // the banner), so keeping the token out of the page costs nothing and keeps
  // the machine-global store out of reach of an unsandboxed mockup.
  const PROFILE_TOKEN = randomUUID();

  const profileQueue = [];
  let profileDraining = false;
  let profileDisabled = process.env.GROUNDWORK_PROFILE === 'off' || argv.includes('--no-profile');
  let profileFailures = 0;
  let profileWarned = false;
  let profileStopNoticed = false;
  function profileWarn(what, { stop = false } = {}) {
    // Transient trouble is logged once and then stays quiet. The moment
    // recording actually STOPS is worth its own single line — otherwise the
    // gallery would silently discard taste for the rest of the session.
    if (stop ? profileStopNoticed : profileWarned) return;
    if (stop) profileStopNoticed = true; else profileWarned = true;
    console.error(`canvas-server: taste-profile recording ${what}. The gallery is unaffected; `
      + 'silence this permanently with --no-profile or GROUNDWORK_PROFILE=off.');
  }
  function profileStop(why) {
    profileDisabled = true;
    profileQueue.length = 0;
    profileWarn(why, { stop: true });
  }
  function recordProfileDims(dims) {
    if (profileDisabled || !dims) return;
    if (profileQueue.length >= PROFILE_QUEUE_MAX) {
      profileWarn('dropped a record (queue full)');
      return;
    }
    const fresh = {};
    for (const [dim, value] of Object.entries(dims)) {
      const key = JSON.stringify([dim, value]);   // unambiguous: no separator can collide
      if (profileRecorded.has(key)) continue;      // already this session's one confirmation
      if (profileRecorded.size >= PROFILE_DISTINCT_MAX) {
        profileStop('stopped: this session hit its limit of distinct recorded preferences');
        return;
      }
      profileRecorded.add(key);
      fresh[dim] = value;
    }
    if (!Object.keys(fresh).length) return;
    profileQueue.push(fresh);
    setImmediate(drainProfileQueue);   // next tick — never inside the response path
  }
  function drainProfileQueue() {
    if (profileDraining || profileDisabled) return;
    const dims = profileQueue.shift();
    if (!dims) return;
    profileDraining = true;
    let child;
    try {
      child = spawn('python3', [
        '-m', 'designer.decide.profile', 'record-dims',
        '--dims', JSON.stringify(dims), '--store', PROFILE_STORE,
      ], {
        // cwd + PYTHONPATH are pinned to the plugin root ON PURPOSE. The
        // documented gallery launch (references/mockups.md §4) runs from an
        // arbitrary cwd with no PYTHONPATH set, so inheriting either would make
        // `-m designer.decide.profile` fail with ModuleNotFoundError in real
        // use while passing under scripts/check.sh (which exports PYTHONPATH) —
        // a green gate certifying a dead feature.
        cwd: PLUGIN_ROOT,
        env: { ...process.env, PYTHONPATH: PLUGIN_ROOT },
        stdio: 'ignore',
      });
    } catch (e) {
      profileDraining = false;
      profileStop(`stopped: could not start python3 (${e.code || e.message})`);
      return;
    }
    // A child that never exits would pin profileDraining forever and silently
    // swallow every later record. Nothing about recording is worth a stuck
    // queue, so give it a hard deadline. unref()'d: this timer must never be
    // the reason the process stays alive.
    const watchdog = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } },
      PROFILE_CHILD_TIMEOUT_MS);
    watchdog.unref();
    child.on('error', (e) => {
      clearTimeout(watchdog);
      profileDraining = false;
      // A missing or unrunnable interpreter will not start working later; a
      // transient resource shortage (EAGAIN/EMFILE) might, so let it use a
      // strike rather than killing recording for the whole session.
      if (['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR'].includes(e.code)) {
        profileStop(`stopped: python3 is not available (${e.code})`);
        return;
      }
      profileFailures += 1;
      profileWarn(`skipped a record (${e.code || e.message})`);
      if (profileFailures >= PROFILE_MAX_FAILURES) {
        profileStop(`stopped after ${profileFailures} failed records (${e.code || e.message})`);
        return;
      }
      if (profileQueue.length) setImmediate(drainProfileQueue);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(watchdog);
      profileDraining = false;
      if (profileDisabled) return;
      if (code === 0) {
        profileFailures = 0;
        if (profileQueue.length) setImmediate(drainProfileQueue);
        return;
      }
      // Keep the reported state honest: a recorder that keeps failing must stop
      // and say so, rather than leaving /__gallery/profile claiming enabled:true
      // while every act is discarded.
      profileFailures += 1;
      profileWarn(`skipped a record (profile.py ${signal ? `killed by ${signal}` : `exited ${code}`})`);
      if (profileFailures >= PROFILE_MAX_FAILURES) {
        profileStop(`stopped after ${profileFailures} failed records`);
        return;
      }
      if (profileQueue.length) setImmediate(drainProfileQueue);
    });
  }

  // ---------------------------------------------------------------------------
  // SSE client registry + per-slot mtime watcher (poll, not fs.watch)
  // ---------------------------------------------------------------------------
  const clients = new Set();
  let feedbackSeq = 0;
  function broadcast(obj) {
    const line = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of clients) { try { res.write(line); } catch { /* dropped */ } }
  }
  // Liveness heartbeat — gallery mode was missing canvas mode's ping (identical
  // interval in the canvas section above). The shared client rail declares the
  // server dead after 25s without ANY frame and then BLOCKS rating sends, so
  // without this every gallery viewer disconnected and drop-rated ~25s in.
  setInterval(() => broadcast({ type: 'ping', ts: Date.now() }), 10000);
  function mtime(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

  // ---------------------------------------------------------------------------
  // archiveSlot — one slot's change, handled the same way whether it happened
  // live (the poller below) or while the server was down (the startup sweep).
  //
  // It NEVER calls recordProfileDims and NEVER touches FEEDBACK_FILE. Those
  // belong to the user's own acts; an archive is bookkeeping the server does on
  // its own, and counting it as revealed preference would re-fire critique_focus
  // for a component the user annotated once, days ago. That is a structural
  // guarantee, not a promise (V6/I2) — this function has no call to either one,
  // full stop — even though it DOES share ordinary I/O helpers (readJSON,
  // normalizeSelections, writeJSONAtomic) with the kind:'annotation' POST branch;
  // sharing those is what makes it bookkeeping, not what makes it safe.
  //
  // Returns the syncSlot result, or null when the archive failed — failure is
  // logged once and never propagates: the gallery keeps serving.
  function archiveSlot(rel) {
    try {
      const selections = normalizeSelections(readJSON(SELECTIONS_FILE, defaultSelections()));
      const versions = readVersions(CTRL_DIR);
      const result = syncSlot({
        galleryDir: GALLERY_DIR, ctrlDir: CTRL_DIR, slot: rel,
        selections, versions, nowIso: new Date().toISOString(),
      });
      // Conditional on the flags, not unconditional: `seed` reports both false
      // and must leave gallery-selections.json exactly as it found it (I1).
      if (result.selectionsChanged) writeJSONAtomic(SELECTIONS_FILE, selections);
      if (result.versionsChanged) writeVersions(CTRL_DIR, versions);
      // The durable snapshot advances LAST, after both records are on disk. A
      // crash before this point re-detects the same change on the next start;
      // a crash before the versions write, with the snapshot already advanced,
      // would instead archive the NEW bytes as the prior version.
      if (result.commitSnapshot) result.commitSnapshot();
      return result;
    } catch (err) {
      console.error(`canvas-server: gallery archive failed for "${rel}" (${err && err.message}); `
        + 'annotations were left as they are and the gallery is unaffected.');
      return null;
    }
  }

  // One wording for both the startup sweep and the live poller. A version with
  // nothing to retire is still worth a line -- it is the history entry a later
  // annotation is attributed to -- but calling it "archived 0 annotation(s)"
  // reads like a failure rather than the bookkeeping it is.
  function archiveLine(count, slot, version) {
    return count > 0
      ? `canvas-server: archived ${count} annotation(s) on ${slot} -> ${version}`
      : `canvas-server: recorded version ${version} of ${slot} (no open annotations to retire)`;
  }

  let lastMtimes = {};
  for (const rel of slotPaths()) lastMtimes[rel] = mtime(path.join(GALLERY_DIR, rel));
  setInterval(() => {
    const paths = slotPaths();
    for (const rel of paths) {
      const full = path.join(GALLERY_DIR, rel);
      const t = mtime(full);
      if (lastMtimes[rel] !== t) {
        lastMtimes[rel] = t;
        const result = archiveSlot(rel);
        // The archived frame goes out BEFORE reload, on purpose (D8): reload
        // only resets the iframe src, so a client that reloaded first would
        // redraw the retired markers over the new frame. The reload frame
        // itself is unchanged, so every existing SSE consumer keeps working.
        if (result && result.action === 'archive') {
          // The startup sweep logs every archive it performs. A live archive
          // moves a user's annotations off-screen just as permanently, so it
          // owes the same line — otherwise the only record of it is the
          // silent disappearance the user is watching.
          console.log(archiveLine(result.archivedIds.length, rel, result.version));
          broadcast({ type: 'archived', path: rel, version: result.version });
        } else if (result && result.selectionsChanged) {
          // A proven hash change can invalidate a rating/winner even when the
          // prior byte snapshot is unavailable, so there is no archive event.
          // Tell open clients to refetch the server-owned rollup before reload.
          broadcast({ type: 'selections', path: rel });
        }
        broadcast({ type: 'reload', path: rel });
      }
    }
    for (const k of Object.keys(lastMtimes)) { if (!paths.includes(k)) delete lastMtimes[k]; }
  }, 400);

  // ---------------------------------------------------------------------------
  // Static file helper (slot HTML + sibling assets only; no traversal)
  // ---------------------------------------------------------------------------
  const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2',
  };
  function withinDir(filePath) {
    const rel = path.relative(GALLERY_DIR, filePath);
    return !(rel.startsWith('..') || path.isAbsolute(rel));
  }
  function serveFile(res, filePath) {
    if (!withinDir(filePath)) { res.writeHead(403).end('forbidden'); return; }
    fs.realpath(filePath, (realError, realPath) => {
      if (realError) { res.writeHead(404).end('not found'); return; }
      const realRel = path.relative(REAL_GALLERY_DIR, realPath);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        res.writeHead(403).end('forbidden'); return;
      }
      fs.readFile(realPath, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(realPath)] || 'application/octet-stream' });
      res.end(buf);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Server
  // ---------------------------------------------------------------------------
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;

    if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(GALLERY_SHELL(TITLE)); return; }

    if (p === '/__gallery/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({
        ok: true, mode: 'gallery', pid: process.pid, port: PORT,
        startedAt: GALLERY_STARTED_AT, instance: GALLERY_INSTANCE || null,
      }));
      return;
    }

    if (p === '/__gallery/manifest') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(loadManifest()));
      return;
    }

    if (p === '/__gallery/slot') {
      const rel = u.searchParams.get('path') || '';
      const full = path.join(GALLERY_DIR, rel);
      if (!withinDir(full)) { res.writeHead(403).end('forbidden'); return; }
      serveFile(res, full);
      return;
    }

    if (p === '/__gallery/selections') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(normalizeSelections(readJSON(SELECTIONS_FILE, defaultSelections()))));
      return;
    }

    if (p === '/__gallery/archive') {
      // UNGATED, like /__gallery/selections — deliberately NOT token-gated like
      // /__gallery/profile (D6). The token exists on that route because it alone
      // serves MACHINE-GLOBAL, cross-project taste plus the user's home path,
      // and slot HTML runs same-origin in an unsandboxed iframe. This route
      // serves strictly this design dir's own annotations and this design dir's
      // own prior HTML — the same data class /__gallery/selections already
      // serves ungated to that same origin. Gating it would be stricter than the
      // live data it mirrors while protecting nothing. No Origin check either:
      // that guard sits on POST /__canvas/feedback because a CORS-simple POST is
      // state-changing; this is GET and read-only.
      //
      // Traversal is blocked STRUCTURALLY by SLOT_RE/VERSION_RE and deliberately
      // does NOT consult slotPaths(): the archive is the recovery path for a
      // mtime-bootstrap false positive (D3) — normally just the first time a
      // slot is seen, but not one-time: it recurs whenever no usable snapshot
      // exists (snapshot lost, or failing its own integrity check) — and
      // recovery must not stop working the moment a slot is dropped from
      // manifest.json.
      const slot = u.searchParams.get('slot') || '';
      if (!SLOT_RE.test(slot)) { res.writeHead(400).end('bad slot'); return; }
      const version = u.searchParams.get('version') || '';
      if (version && !VERSION_RE.test(version)) { res.writeHead(400).end('bad version'); return; }

      if (u.searchParams.get('file') === 'html') {
        if (!version) { res.writeHead(400).end('version is required for file=html'); return; }
        const html = readArchivedHtml(CTRL_DIR, slot, version);
        // Absent on every mtime-bootstrap version (the prior bytes were never
        // captured) AND on a content-hash version archived with no open
        // annotations (nothing to retire, so no copy was kept) — the
        // payload's html:null says so honestly either way. A 404 here is
        // not proof of bootstrap provenance.
        if (!html) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      const versions = listArchive(CTRL_DIR, slot);
      if (version) {
        const hit = versions.find((entry) => entry.version === version);
        if (!hit) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(hit));
        return;
      }
      // A slot with no history answers 200 with an empty list, not 404: "this
      // slot has never been rewritten" is a true answer, and the client's
      // "Prior versions" disclosure needs to distinguish it from an error.
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ slot, versions }));
      return;
    }

    if (p === '/__gallery/profile') {
      // Read-only window onto the cross-session profile, so what Groundwork
      // believes about the user's taste is inspectable rather than buried in a
      // dotfile. Nothing in the gallery shell fetches this yet — today's readers
      // are the host agent and the user. Never writes.
      //
      // TOKEN-GATED because this is the one route that serves MACHINE-GLOBAL,
      // cross-project data. Slot HTML is served from this same origin into an
      // unsandboxed iframe (element annotation needs same-origin contentDocument
      // access), so without a gate any mockup's script could read every project's
      // taste and the user's home path. The token is only ever printed to the
      // server's own stdout, so a mockup cannot obtain it by fetching the shell.
      // Validation mirrors profile.py's
      // load_profile() exactly (schema match AND dimensions is an object) —
      // profile.py owns the shape; this only reads it. A missing, corrupt, or
      // wrong-schema store yields an empty profile, never an error.
      const supplied = u.searchParams.get('token') || req.headers['x-groundwork-token'] || '';
      if (supplied !== PROFILE_TOKEN) { res.writeHead(403).end('forbidden'); return; }
      const raw = readJSON(PROFILE_STORE, null);
      const valid = raw && typeof raw === 'object' && raw.schema === PROFILE_SCHEMA
        && raw.dimensions && typeof raw.dimensions === 'object';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        enabled: !profileDisabled,
        store: PROFILE_STORE,
        profile: valid ? raw : { schema: PROFILE_SCHEMA, dimensions: {} },
      }));
      return;
    }

    if (p === '/__canvas/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      res.write(`retry: 1000\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (p === '/__canvas/feedback' && req.method === 'POST') {
      // Cross-site write guard. This POST now also feeds the machine-global
      // taste profile, and it is a CORS-"simple" request (no preflight), so any
      // page open in the user's browser could otherwise drive it by guessing the
      // port. The gallery's own requests carry a loopback Origin; non-browser
      // clients (the flow's curl, the test suite) send none. Anything else is
      // not the gallery.
      const origin = req.headers.origin;
      if (origin && !isGalleryOrigin(origin)) { res.writeHead(403).end('forbidden'); return; }
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let row;
        try { row = JSON.parse(body || '{}'); } catch { res.writeHead(400).end('bad json'); return; }
        row.ts = new Date().toISOString();
        row.id = `fb-${Date.now()}-${feedbackSeq++}`;
        // Server-owned selections file — the single source the agent reads to
        // write selection.json — updated BEFORE the feedback row is appended.
        const sel = normalizeSelections(readJSON(SELECTIONS_FILE, defaultSelections()));
        let responseData = null;
        // Dimensions this act reveals about the person's taste, if any. Recorded
        // AFTER the response is sent (see the end of this handler). Every branch
        // that leaves it null is a deliberate non-signal.
        let profileDims = null;
        if (row.kind === 'rate' && row.slot && (row.rating === 'yay' || row.rating === 'ok' || row.rating === 'nay')) {
          // Only a CHANGE of mind is a new confirmation. Re-clicking the rating
          // already stored restates one opinion; the profile counts each record
          // as an independent confirmation (3 settle a dimension), so counting
          // repeat clicks would let one sitting masquerade as settled taste.
          const changed = sel.ratings[row.slot] !== row.rating;
          sel.ratings[row.slot] = row.rating;
          delete sel.reviewReopen[row.slot];
          writeJSONAtomic(SELECTIONS_FILE, sel);
          const mode = (changed && !profileDisabled) ? slotMode(row.slot) : '';
          // 'ok' is a deliberate neutral/non-signal; it does not claim a
          // durable preference.
          if (mode && row.rating === 'yay') profileDims = { design_mode_liked: mode };
          else if (mode && row.rating === 'nay') profileDims = { design_mode_disliked: mode };
        } else if (row.kind === 'pick' && row.screen && row.slot) {
          const changed = sel.picks[row.screen] !== row.slot;
          sel.picks[row.screen] = row.slot;
          delete sel.reviewReopen[row.slot];
          writeJSONAtomic(SELECTIONS_FILE, sel);
          const mode = (changed && !profileDisabled) ? slotMode(row.slot) : '';
          if (mode) profileDims = { design_mode: mode };   // the decisive act
        } else if (row.kind === 'note' && row.slot && typeof row.text === 'string') {
          // Note text is the user's own words about THIS design. It stays here:
          // free text never enters the global cross-project profile.
          sel.notes[row.slot] = row.text;
          if (row.text.trim()) delete sel.reviewReopen[row.slot];
          writeJSONAtomic(SELECTIONS_FILE, sel);
        } else if (row.kind === 'archive-review') {
          if (!slotPaths().includes(row.slot)) {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'unknown gallery slot' }));
            return;
          }
          if (typeof row.text !== 'string' || row.text.length > 4000) {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'review note must be a string of at most 4000 characters' }));
            return;
          }
          const items = Array.isArray(sel.annotations[row.slot]) ? sel.annotations[row.slot] : [];
          const isPicked = Object.values(sel.picks).includes(row.slot);
          const hasFeedback = Object.prototype.hasOwnProperty.call(sel.ratings, row.slot)
            || isPicked
            || row.text.trim().length > 0
            || items.some((item) => item && item.status === 'open');
          if (!hasFeedback) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'record feedback before archiving this review' }));
            return;
          }
          // The visible note draft and lifecycle state commit in one atomic
          // selections-file rename. The card never disappears with its latest
          // words stranded only in the browser.
          sel.notes[row.slot] = row.text;
          const archived = { archivedAt: row.ts };
          sel.reviewArchive[row.slot] = archived;
          delete sel.reviewReopen[row.slot];
          responseData = { reviewArchive: archived };
          writeJSONAtomic(SELECTIONS_FILE, sel);
          broadcast({ type: 'selections', path: row.slot });
        } else if (row.kind === 'restore-review') {
          if (!slotPaths().includes(row.slot)) {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'unknown gallery slot' }));
            return;
          }
          delete sel.reviewArchive[row.slot];
          const reopened = { reopenedAt: row.ts };
          sel.reviewReopen[row.slot] = reopened;
          responseData = { reviewReopen: reopened };
          writeJSONAtomic(SELECTIONS_FILE, sel);
          broadcast({ type: 'selections', path: row.slot });
        } else if (row.kind === 'annotation' && slotPaths().includes(row.slot) && row.annotation && typeof row.annotation === 'object') {
          if (!cleanText(row.annotation.comment, 4000)) {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'annotation comment is required' }));
            return;
          }
          const items = Array.isArray(sel.annotations[row.slot]) ? sel.annotations[row.slot] : [];
          const existingIndex = items.findIndex((item) => item && item.id === row.annotation.id);
          const existing = existingIndex >= 0 ? items[existingIndex] : null;
          const annotation = normalizeAnnotation(row.annotation, existing, row.ts);
          // A live archive can land while the user has an editor open: the
          // client then Saves the copy it loaded, which still says
          // status:"open", and merging by id would flip a retired record back
          // onto the new design — the exact defect this build closes, now
          // arriving through the front door. The STORED disposition wins
          // unless the incoming record carries its own valid archived triple
          // (normalizeAnnotation only emits one when it does).
          if (existing && existing.status === 'archived' && annotation.status !== 'archived'
            && VERSION_RE.test(existing.archivedFrom || '') && Number.isFinite(Date.parse(existing.archivedAt))) {
            annotation.status = 'archived';
            annotation.archivedAt = existing.archivedAt;
            annotation.archivedFrom = existing.archivedFrom;
          }
          if (existingIndex >= 0) items[existingIndex] = annotation;
          else items.push(annotation);
          sel.annotations[row.slot] = items;
          if (annotation.status === 'open') delete sel.reviewReopen[row.slot];
          row.annotation = annotation;
          responseData = { annotation };
          writeJSONAtomic(SELECTIONS_FILE, sel);
          // A NEW annotation is a fresh critique of a component; editing an
          // existing one restates the same critique, so only the new one counts.
          // The COMPONENT NAME is the signal; the comment text never is.
          if (existingIndex < 0 && !profileDisabled) {
            const component = safeToken(annotation.target && annotation.target.component);
            if (component) profileDims = { critique_focus: component };
          }
        } else if (row.kind === 'annotation-delete' && slotPaths().includes(row.slot) && typeof row.annotationId === 'string') {
          const items = Array.isArray(sel.annotations[row.slot]) ? sel.annotations[row.slot] : [];
          sel.annotations[row.slot] = items.filter((item) => item && item.id !== row.annotationId);
          row.annotationId = cleanText(row.annotationId, 120);
          writeJSONAtomic(SELECTIONS_FILE, sel);
        }
        fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(row) + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: row.id, ...responseData }));
        // Deliberately after res.end(): the taste record is enqueued, and the
        // python child is spawned on a later tick. The feedback response never
        // waits on it, and a profile failure can never turn into a failed POST.
        recordProfileDims(profileDims);
      });
      return;
    }

    // sibling static assets referenced by slot HTML (css/img/etc.)
    serveFile(res, path.join(GALLERY_DIR, decodeURIComponent(p.replace(/^\/+/, ''))));
  });

  let PORT = PORT_START;
  function listen() {
    server.listen(PORT, '127.0.0.1', () => {   // loopback only — a local design tool, never LAN-exposed
      console.log(`canvas-server: ${TITLE} (gallery)`);
      console.log(`  mockups: ${GALLERY_DIR}`);
      console.log(`  control: ${CTRL_DIR}`);
      console.log(`  open   : http://localhost:${PORT}`);
      console.log(`  profile: ${profileDisabled ? 'recording off' : PROFILE_STORE}`);
      console.log(`  profile read: http://localhost:${PORT}/__gallery/profile?token=${PROFILE_TOKEN}`);
    });
  }
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && PORT < PORT_START + 40) { PORT += 1; listen(); }
    else { console.error(e); process.exit(1); }
  });

  // ---------------------------------------------------------------------------
  // Startup archive sweep (D2/D3). A mockup rewritten while the server was DOWN
  // is the common case for this defect — the mtime poller never saw it, so
  // without this the annotations made against the old markup keep rendering over
  // the new one forever. Runs BEFORE listen() so the first /__gallery/selections
  // a browser ever fetches is already correct.
  //
  // Wrapped whole: the archive is bookkeeping, and bookkeeping must never cost
  // the user their gallery. One line on stderr, then serve as normal.
  try {
    const selections = normalizeSelections(readJSON(SELECTIONS_FILE, defaultSelections()));
    const versions = readVersions(CTRL_DIR);
    const swept = syncAllSlots({
      galleryDir: GALLERY_DIR, ctrlDir: CTRL_DIR, slots: slotPaths(),
      selections, versions, nowIso: new Date().toISOString(),
    });
    // I1: both writes are CONDITIONAL. `seed` reports selectionsChanged:false,
    // so a first boot where every slot seeds leaves gallery-selections.json
    // absent — which test_gallery_archive.mjs V9 asserts directly (and which
    // test_gallery_profile.mjs's CSRF test also happens to assert, for an
    // unrelated reason), and which is also just correct: seeding archives
    // nothing, so there is nothing to write.
    if (swept.selectionsChanged) writeJSONAtomic(SELECTIONS_FILE, selections);
    if (swept.versionsChanged) writeVersions(CTRL_DIR, versions);
    // Snapshots last, for the same crash-ordering reason as the live path
    // above: the recorded hash must never be older than the bytes beside it.
    swept.commitSnapshots();
    for (const event of swept.events) {
      console.log(archiveLine(event.count, event.slot, event.version));
    }
  } catch (err) {
    console.error(`canvas-server: gallery archive sweep failed (${err && err.message}); `
      + 'annotations were left as they are and the gallery is unaffected.');
  }

  listen();

  // ---------------------------------------------------------------------------
  // The gallery shell: static skeleton only. All slot/screen content is
  // rendered client-side from /__gallery/manifest + /__gallery/selections via
  // the same h()/clear() DOM-builder pattern as the iterate rail — no
  // innerHTML anywhere, so no manifest/slot/note text can ever become
  // executable HTML. Calm-precision styling: luminance hierarchy, left-border
  // accents (no boxes), theme-aware, reduced-motion honored.
  // ---------------------------------------------------------------------------
  function GALLERY_SHELL(title) {
    return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Groundwork gallery</title>
<style>
  :root{
    --bg:#0e0f11; --panel:#15171a; --ink:#f2f3f5; --ink-2:#aeb4bd; --ink-3:#727880;
    --line:#23262b; --accent:#6ea8fe; --ok:#5bbf8a; --warn:#d8a24a;
    --preview-bed:#25282e; --preview-line:#737c88;
    --rate-yay:#247a50; --rate-ok:#7a5b00; --rate-nay:#a13d4a;
  }
  @media (prefers-color-scheme: light){
    :root{ --bg:#f6f7f9; --panel:#ffffff; --ink:#14161a; --ink-2:#454b54; --ink-3:#8a9099;
      --line:#e4e7eb; --accent:#2b6cf0; --preview-bed:#e7eaee; --preview-line:#747d88; }
  }
  *{box-sizing:border-box}
  html,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink);
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;
    gap:12px;padding:14px 20px;background:var(--panel);border-bottom:1px solid var(--line)}
  .brand{font-weight:600}
  .brand small{display:block;color:var(--ink-3);font-weight:400;font-size:11px}
  .summary{font-size:13px;color:var(--ink-2);white-space:nowrap}
  .connection-alert{padding:10px 20px;background:color-mix(in srgb,var(--rate-nay) 18%,var(--panel));
    border-bottom:1px solid var(--rate-nay);color:var(--ink);font-size:13px;font-weight:600;text-align:center}
  .connection-alert[hidden]{display:none}
  main{padding:20px;max-width:1400px;margin:0 auto}
  .empty{color:var(--ink-3);font-size:13px;padding:24px 0}
  .screen{margin-bottom:32px}
  .screen-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
    padding-left:12px;border-left:3px solid var(--accent);margin-bottom:12px}
  .screen-head h2{font-size:16px;margin:0}
  .screen-status{font-size:12px;color:var(--ink-3)}
  .slots{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
  .card{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--line);
    border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
  .card.picked{border-left-color:var(--ok)}
  .card-head{display:flex;justify-content:space-between;gap:8px;padding:8px 12px;font-size:11px;
    text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);border-bottom:1px solid var(--line)}
  .card-head-main{display:flex;align-items:center;gap:8px;min-width:0}
  .slot-delta{padding:10px 12px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--accent) 7%,transparent)}
  .slot-delta strong{display:block;margin-bottom:2px;color:var(--accent);font-size:11px;letter-spacing:.04em;text-transform:uppercase}
  .slot-delta span{display:block;color:var(--ink);font-size:13px;line-height:1.4}
  .expand-btn{min-height:32px;background:transparent;border:1px solid var(--line);border-radius:6px;
    color:var(--ink-2);padding:4px 10px;font:inherit;font-size:12px;text-transform:none;letter-spacing:0;cursor:pointer}
  .expand-btn:hover,.expand-btn:focus-visible{border-color:var(--accent);color:var(--accent)}
  .preview-shell{position:relative;height:240px;margin:10px 12px 0;overflow:hidden;background:var(--preview-bed);
    border:1px solid var(--preview-line);border-radius:7px;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--panel) 55%,transparent)}
  .preview{position:absolute;display:block;border:1px solid rgba(20,24,30,.38);background:#fff;
    transform-origin:top left;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.28)}
  .rate-row{display:flex;align-items:center;gap:8px;padding:12px;border-top:1px solid var(--line);flex-wrap:wrap;min-height:60px}
  .rate-prompt{color:var(--ink-2);font-size:12px;font-weight:600;margin-right:2px}
  .rate-btn{background:transparent;border:1px solid var(--line);border-radius:20px;color:var(--ink-2);
    min-height:36px;padding:6px 15px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
  .rate-btn:hover,.rate-btn:focus-visible{border-color:var(--accent);color:var(--ink)}
  .rate-btn.on{color:#fff;font-weight:700;border-width:2px;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
  .rate-btn.on[data-rating="yay"]{background:var(--rate-yay);border-color:var(--rate-yay)}
  .rate-btn.on[data-rating="ok"]{background:var(--rate-ok);border-color:var(--rate-ok)}
  .rate-btn.on[data-rating="nay"]{background:var(--rate-nay);border-color:var(--rate-nay)}
  .rate-btn.chosen{min-width:128px}
  .rating-change{background:transparent;border:0;color:var(--accent);min-height:36px;padding:6px 8px;
    font:inherit;font-size:12px;font-weight:600;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
  .rating-change:hover,.rating-change:focus-visible{color:var(--ink)}
  .pick-btn{margin-left:auto;background:transparent;border:1px solid var(--line);border-left:3px solid var(--accent);
    border-radius:6px;color:var(--ink);padding:5px 12px;font:inherit;font-size:12px;cursor:pointer}
  .pick-btn.on{background:color-mix(in srgb,var(--ok) 16%,transparent);border-color:var(--ok);
    border-left-color:var(--ok);color:var(--ok);font-weight:600}
  .note-row{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line)}
  .note{flex:1;min-height:40px;resize:vertical;background:var(--bg);color:var(--ink);
    border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit;font-size:12px}
  .note-save{background:transparent;border:1px solid var(--line);border-radius:6px;color:var(--ink-2);
    padding:6px 10px;font:inherit;font-size:12px;cursor:pointer;align-self:flex-start}
  .review-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px 12px}
  .archive-review-btn,.restore-review-btn{min-height:36px;background:transparent;border:1px solid var(--line);
    border-radius:6px;color:var(--ink-2);padding:6px 11px;font:inherit;font-size:12px;font-weight:600;cursor:pointer}
  .archive-review-btn:hover,.archive-review-btn:focus-visible,.restore-review-btn:hover,.restore-review-btn:focus-visible{
    border-color:var(--accent);color:var(--accent)}
  .archive-review-btn:disabled,.restore-review-btn:disabled{cursor:not-allowed;opacity:.42;border-color:var(--line);color:var(--ink-3)}
  .archive-help{color:var(--ink-3);font-size:11px}
  .archived-section{margin-top:32px;border-top:1px solid var(--line);padding-top:14px}
  .archived-section > summary{min-height:44px;display:flex;align-items:center;gap:8px;color:var(--ink-2);
    font-size:14px;font-weight:600;cursor:pointer;list-style:none}
  .archived-section > summary::-webkit-details-marker{display:none}
  .archived-section > summary::before{content:'›';color:var(--accent);font-size:20px;line-height:1;transition:transform .15s ease}
  .archived-section[open] > summary::before{transform:rotate(90deg)}
  .archived-list{display:flex;flex-direction:column;border-top:1px solid var(--line)}
  .archived-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;
    padding:14px 0;border-bottom:1px solid var(--line)}
  .archived-card h3{margin:0;font-size:14px}
  .archived-meta{margin:3px 0 0;color:var(--ink-3);font-size:12px}
  .archived-note{margin:5px 0 0;color:var(--ink-2);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .archived-actions{display:flex;align-items:center;gap:8px}
  .viewer[hidden]{display:none}
  .viewer{position:fixed;inset:0;z-index:100;background:var(--bg);display:flex;flex-direction:column}
  .viewer-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 14px;
    min-height:56px;background:var(--panel);border-bottom:1px solid var(--line)}
  .viewer-title{min-width:0}
  .viewer-title strong{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .viewer-title span{display:block;color:var(--ink-3);font-size:11px}
  .viewer-tools{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
  .viewer-nav{display:flex;align-items:center;gap:6px}
  .tool-btn,.shape-btn,.viewer-nav-btn{min-height:36px;background:transparent;border:1px solid var(--line);border-radius:7px;
    color:var(--ink-2);padding:6px 11px;font:inherit;font-size:12px;cursor:pointer}
  .tool-btn:hover,.tool-btn:focus-visible,.shape-btn:hover,.shape-btn:focus-visible,
  .viewer-nav-btn:hover,.viewer-nav-btn:focus-visible{border-color:var(--accent);color:var(--accent)}
  .tool-btn.on,.shape-btn.on{border-color:var(--accent);color:var(--accent);font-weight:600}
  .tool-btn:disabled,.viewer-nav-btn:disabled{cursor:not-allowed;opacity:.42;border-color:var(--line);color:var(--ink-3)}
  .shape-group{display:flex;align-items:center;border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .shape-group[hidden]{display:none}
  .shape-btn{border:0;border-radius:0;min-width:58px;padding-inline:10px}
  .shape-btn + .shape-btn{border-left:1px solid var(--line)}
  .viewer-body{min-height:0;flex:1;display:grid;grid-template-columns:minmax(0,1fr) clamp(300px,24vw,420px)}
  .viewer-stage{min-width:0;min-height:0;background:#fff}
  .viewer-frame{width:100%;height:100%;border:0;background:#fff;display:block}
  .annotation-rail{min-height:0;overflow:auto;background:var(--panel);border-left:1px solid var(--line);padding:16px}
  .annotation-rail h2{font-size:14px;margin:0 0 4px}
  .viewer-feedback{border-bottom:1px solid var(--line);margin-bottom:16px;padding-bottom:16px}
  .viewer-delta{border-bottom:1px solid var(--line);margin-bottom:16px;padding-bottom:16px}
  .viewer-delta h2{color:var(--accent)}
  .viewer-delta p{margin:5px 0 0;color:var(--ink);font-size:13px;line-height:1.45}
  .viewer-delta-status{display:block;margin-top:7px;color:var(--ink-3);font-size:11px;line-height:1.35}
  .viewer-feedback-section + .viewer-feedback-section{border-top:1px solid var(--line);margin-top:14px;padding-top:14px}
  .viewer-rating-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
  .viewer-rating-row .rate-btn{flex:1;min-width:72px}
  .viewer-comment-label{display:block;font-size:12px;font-weight:600;margin:9px 0 6px}
  .viewer-comment{width:100%;min-height:104px;resize:vertical;background:var(--bg);color:var(--ink);
    border:1px solid var(--line);border-radius:8px;padding:9px;font:inherit;font-size:13px}
  .viewer-comment-actions{display:flex;align-items:center;gap:8px;margin-top:8px}
  .viewer-feedback-status{color:var(--ink-3);font-size:11px;line-height:1.35}
  .viewer-pick-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}
  .viewer-pick-row .pick-btn{margin-left:0;min-height:36px}
  .viewer-archive-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;
    padding-top:12px;border-top:1px solid var(--line)}
  .annotation-help{margin:0 0 14px;color:var(--ink-2);font-size:12px}
  .annotation-empty{padding:14px 0;color:var(--ink-3);font-size:12px}
  .annotation-list{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
  .annotation-item{display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px;width:100%;text-align:left;
    border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--ink);padding:8px;cursor:pointer}
  .annotation-item.on{border-color:var(--accent)}
  .annotation-marker{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--accent);
    color:#fff;font-size:11px;font-weight:700}
  .annotation-marker.square{border-radius:5px}
  .annotation-copy strong{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .annotation-copy span{display:block;color:var(--ink-3);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .annotation-editor{border-top:1px solid var(--line);padding-top:14px}
  .annotation-editor.priority{border-top:0;border-bottom:1px solid var(--line);margin-bottom:14px;padding:0 0 14px}
  .annotation-editor label{display:block;font-size:12px;font-weight:600;margin-bottom:6px}
  .annotation-context{color:var(--ink-3);font-size:11px;margin:0 0 8px;overflow-wrap:anywhere}
  .annotation-comment{width:100%;min-height:104px;resize:vertical;background:var(--bg);color:var(--ink);
    border:1px solid var(--line);border-radius:8px;padding:9px;font:inherit;font-size:13px}
  .annotation-actions{display:flex;align-items:center;gap:8px;margin-top:8px}
  .annotation-actions .primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
  .annotation-actions .danger{margin-left:auto;color:#e46d72}
  /* Progressive disclosure (Hick): retired critique is history, not the work in
     front of you, so it collapses to one line at the foot of the rail. Text
     weight and luminance carry the hierarchy — no badge, no box. */
  .prior-versions{border-top:1px solid var(--line);margin-top:14px;padding-top:12px}
  .prior-versions-toggle{background:transparent;border:0;padding:4px 0;min-height:32px;
    color:var(--ink-2);font:inherit;font-size:12px;cursor:pointer;text-align:left}
  .prior-versions-toggle:hover,.prior-versions-toggle:focus-visible{color:var(--accent)}
  .prior-versions-body[hidden]{display:none}
  .prior-version{padding:8px 0 8px 10px;border-left:2px solid var(--line);margin-top:8px}
  .prior-version strong{display:block;font-size:12px;font-weight:600}
  .prior-version > span{display:block;color:var(--ink-3);font-size:11px}
  .prior-comments{margin:6px 0 0;padding-left:16px;color:var(--ink-2);font-size:12px}
  .prior-comments li{margin-bottom:4px;overflow-wrap:anywhere}
  .prior-html{display:inline-block;margin-top:4px;color:var(--accent);font-size:11px}
  .viewer-hint{display:none;color:var(--accent);font-size:11px;font-weight:600}
  .viewer.annotating .viewer-hint{display:block}
  .toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,12px);
    background:var(--panel);color:var(--ink);border:1px solid var(--line);border-left:3px solid var(--accent);
    border-radius:10px;padding:10px 14px;box-shadow:0 8px 26px rgba(0,0,0,.35);font-size:13px;
    opacity:0;pointer-events:none;transition:opacity .18s,transform .18s;z-index:200;max-width:min(520px,80vw)}
  .toast.show{opacity:1;transform:translate(-50%,0)}
  .toast b{color:var(--accent)}
  @media (max-width:760px){
    .viewer-head{align-items:flex-start;flex-direction:column}
    .viewer-tools{width:100%;justify-content:flex-start}
    .viewer-body{grid-template-columns:1fr;grid-template-rows:minmax(0,56fr) minmax(0,44fr)}
    .annotation-rail{border-left:0;border-top:1px solid var(--line)}
    .tool-btn,.shape-btn,.viewer-nav-btn,.expand-btn,.prior-versions-toggle,
    .viewer-rating-row .rate-btn{min-height:44px}
    .annotation-comment,.viewer-comment{font-size:16px}
    .archived-card{grid-template-columns:1fr}
    .archived-actions{justify-content:flex-start}
  }
  @media (prefers-reduced-motion:reduce){.toast{transition:none}}
</style></head><body>
<header class="topbar">
  <div class="brand">${escapeHtml(title)}<small>Groundwork gallery</small></div>
  <div class="summary" id="summary">Review summary</div>
</header>
<div class="connection-alert" id="connection-alert" role="status" hidden>
  Gallery connection lost. Ratings, notes, and annotations cannot be saved until it reconnects.
</div>
<main id="gallery"></main>
<section class="viewer" id="viewer" role="dialog" aria-modal="true" aria-label="Expanded mockup" hidden></section>
<div class="toast" id="toast"></div>
<script>
(() => {
  const galleryEl = document.getElementById('gallery');
  const topbarEl = document.querySelector('.topbar');
  const summaryEl = document.getElementById('summary');
  const toastEl = document.getElementById('toast');
  const viewerEl = document.getElementById('viewer');
  const connectionAlertEl = document.getElementById('connection-alert');
  let toastT = null;
  let manifest = { screens: [], slots: [] };
  let selections = { ratings: {}, picks: {}, notes: {}, annotations: {}, reviewArchive: {}, reviewReopen: {} };
  let activeSlot = null;
  let activeScreen = null;
  let activeFrame = null;
  let activeAnnotationId = null;
  let pendingAnnotation = null;
  let annotationMode = false;
  let markerShape = 'dot';
  let annotationRail = null;
  let archivedVersions = [];
  let priorVersionsOpen = false;
  let annotateButton = null;
  let shapeGroup = null;
  let dotButton = null;
  let squareButton = null;
  let viewerOpener = null;
  let viewerSlotPaths = null;
  let viewerOpenedReviewed = false;
  let viewerGeneration = 0;
  let viewerRatingDraft = null;
  let viewerRatingSaved = null;
  let viewerRatingSavePromise = null;
  let viewerRatingSaveFailed = false;
  let viewerRatingButtons = [];
  let viewerRatingStatusEl = null;
  let viewerCommentDraft = '';
  let viewerCommentSaved = '';
  let viewerCommentSavePending = false;
  let viewerCommentSavePromise = null;
  let viewerCommentSaveTimer = null;
  let viewerCommentStatusEl = null;
  let viewerArchiveButton = null;
  let viewerLifecycleSavePending = false;
  let viewerDeltaStatusEl = null;
  let viewerDeltaHighlightState = 'none';
  let galleryStateDirty = false;
  let archivedSectionOpen = false;
  const ratingEditing = new Set();

  // Same no-innerHTML DOM builder as the iterate rail: every dynamic value
  // (screen names, mode ids, note text) goes in as a text node.
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === 'class') e.className = props[k];
      else if (k === 'dataset') Object.assign(e.dataset, props[k]);
      else if (k.slice(0, 2) === 'on' && typeof props[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else e.setAttribute(k, props[k]);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function setGalleryConnected(connected) {
    connectionAlertEl.hidden = !!connected;
    document.body.classList.toggle('gw-disconnected', !connected);
  }

  function fitPreviewFrame(frame) {
    const shell = frame && frame.parentElement;
    const doc = frame && frame.contentDocument;
    if (!shell || !doc || !doc.documentElement) return;
    const root = doc.documentElement;
    const body = doc.body;
    const documentWidth = Math.max(1, 1280, root.scrollWidth, root.offsetWidth,
      body ? body.scrollWidth : 0, body ? body.offsetWidth : 0);
    frame.style.width = documentWidth + 'px';
    const documentHeight = Math.max(1, root.scrollHeight, root.offsetHeight,
      body ? body.scrollHeight : 0, body ? body.offsetHeight : 0);
    frame.style.height = documentHeight + 'px';
    const inset = 14;
    const scale = Math.min(1,
      Math.max(1, shell.clientWidth - inset * 2) / documentWidth,
      Math.max(1, shell.clientHeight - inset * 2) / documentHeight);
    const renderedWidth = documentWidth * scale;
    const renderedHeight = documentHeight * scale;
    frame.style.left = Math.max(inset, (shell.clientWidth - renderedWidth) / 2) + 'px';
    frame.style.top = Math.max(inset, (shell.clientHeight - renderedHeight) / 2) + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    frame.dataset.fitScale = String(scale);
  }

  const previewResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      for (const entry of entries) {
        const frame = entry.target.querySelector('iframe.preview');
        if (frame) fitPreviewFrame(frame);
      }
    })
    : null;

  function previewForSlot(screenId, slot) {
    const slotPath = slot.html_path;
    const label = screenLabel(screenId) + ' · ' + modeLabel(slot) + ' full-page preview';
    const frame = h('iframe', {
      class: 'preview', src: '/__gallery/slot?path=' + encodeURIComponent(slotPath),
      dataset: { slot: slotPath }, title: label, loading: 'lazy', tabindex: '-1',
      'aria-hidden': 'true',
    });
    // Establish a desktop-size same-origin viewport before the document loads;
    // fitPreviewFrame then measures the whole rendered document and scales it
    // into the bordered letterbox. The miniature is intentionally inert.
    frame.style.width = '1280px';
    frame.style.height = '800px';
    frame.addEventListener('load', () => {
      fitPreviewFrame(frame);
      requestAnimationFrame(() => fitPreviewFrame(frame));
      const fonts = frame.contentDocument && frame.contentDocument.fonts;
      if (fonts && fonts.ready) fonts.ready.then(() => fitPreviewFrame(frame)).catch(() => {});
    });
    const shell = h('div', { class: 'preview-shell', role: 'img', 'aria-label': label }, frame);
    if (previewResizeObserver) previewResizeObserver.observe(shell);
    return shell;
  }

  function cardForSlot(slotPath) {
    return Array.from(galleryEl.querySelectorAll('.card'))
      .find((card) => card.dataset.slot === slotPath) || null;
  }

  function focusRating(slotPath, rating, collapsed) {
    const card = cardForSlot(slotPath);
    if (!card) return;
    const controls = Array.from(card.querySelectorAll('.rate-btn'));
    const target = collapsed
      ? controls.find((button) => button.classList.contains('chosen'))
      : controls.find((button) => button.dataset.rating === rating);
    if (target) target.focus();
  }

  function revealRatingChoices(slotPath, rating) {
    ratingEditing.add(slotPath);
    render();
    focusRating(slotPath, rating, false);
  }

  function toast(bold, rest) {
    toastEl.textContent = '';
    if (bold) { const b = document.createElement('b'); b.textContent = bold; toastEl.appendChild(b); }
    if (rest) toastEl.appendChild(document.createTextNode(rest));
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  async function post(row) {
    try {
      const r = await fetch('/__canvas/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  function screenIds() {
    if (Array.isArray(manifest.screens) && manifest.screens.length) return manifest.screens.map((s) => s.id);
    const seen = new Set(); const out = [];
    for (const s of manifest.slots || []) { if (s && s.screen_id && !seen.has(s.screen_id)) { seen.add(s.screen_id); out.push(s.screen_id); } }
    return out;
  }
  function screenLabel(screenId) {
    const s = (manifest.screens || []).find((x) => x.id === screenId);
    if (s && s.name) return s.name;
    const slot = (manifest.slots || []).find((x) => x.screen_id === screenId);
    return (slot && slot.screen_name) || screenId;
  }
  function modeLabel(slot) {
    const modeId = slot && slot.mode;
    const mode = (manifest.modes || []).find((item) => item && item.id === modeId);
    return (mode && mode.name) || modeId || (slot && slot.html_path) || '';
  }
  function slotsForScreen(screenId) {
    return (manifest.slots || []).filter((s) => s.screen_id === screenId);
  }
  function slotForPath(slotPath) {
    return (manifest.slots || []).find((slot) => slot && slot.html_path === slotPath) || null;
  }
  function slotDelta(slot) {
    if (!slot || !slot.delta || typeof slot.delta !== 'object') return null;
    const summary = typeof slot.delta.summary === 'string' ? slot.delta.summary.trim() : '';
    if (!summary) return null;
    const selector = typeof slot.delta.selector === 'string' ? slot.delta.selector.trim() : '';
    return { summary, selector };
  }
  function allViewerSlots() {
    return screenIds().flatMap((screenId) => slotsForScreen(screenId))
      .filter((slot) => slot && slot.html_path);
  }
  function isReviewArchived(slotPath) {
    if (selections.reviewReopen && selections.reviewReopen[slotPath]) return false;
    return !!(selections.reviewArchive && selections.reviewArchive[slotPath]) || hasReviewFeedback(slotPath);
  }
  function activeReviewSlots() {
    return allViewerSlots().filter((slot) => !isReviewArchived(slot.html_path));
  }
  function archivedReviewSlots() {
    return allViewerSlots().filter((slot) => isReviewArchived(slot.html_path));
  }
  function viewerSlots() {
    if (Array.isArray(viewerSlotPaths)) {
      return viewerSlotPaths.map(slotForPath).filter(Boolean);
    }
    const archivedContext = !!(activeSlot && isReviewArchived(activeSlot));
    return allViewerSlots().filter((slot) => isReviewArchived(slot.html_path) === archivedContext);
  }
  function expandButtonForSlot(slotPath) {
    const card = Array.from(galleryEl.querySelectorAll('.card[data-slot], .archived-card[data-slot]'))
      .find((item) => item.dataset.slot === slotPath);
    return card ? card.querySelector('.expand-btn') : null;
  }

  function focusAfterReview() {
    const nextActive = galleryEl.querySelector('.card .expand-btn');
    const reviewedSummary = galleryEl.querySelector('.archived-section > summary');
    const target = nextActive || reviewedSummary;
    if (target && typeof target.focus === 'function') target.focus();
  }

  function renderSummary() {
    const active = activeReviewSlots();
    const archived = archivedReviewSlots();
    const picked = screenIds().filter((id) => selections.picks && selections.picks[id]).length;
    summaryEl.textContent = active.length + ' to review · ' + archived.length + ' reviewed'
      + ' · ' + picked + ' winner' + (picked === 1 ? '' : 's') + ' selected';
  }

  // RAW — every record the server holds for this slot, archived and resolved
  // included. The save/delete merge paths use this one: they rewrite the
  // client's copy of the list, and filtering here would silently drop archived
  // records out of the client's copy on the next save.
  function annotationsForSlot(slotPath) {
    const items = selections.annotations && selections.annotations[slotPath];
    return Array.isArray(items) ? items : [];
  }

  // What actually RENDERS. The test is positive — status === 'open' — because
  // the enum has three values now: a negative test (!== 'resolved') would keep
  // drawing archived critique over the new design, which is the exact defect
  // this exists to fix, and the same one engine/src/cli.ts had to fix in its
  // own count.
  function openAnnotationsForSlot(slotPath) {
    return annotationsForSlot(slotPath).filter((item) => item && item.status === 'open');
  }

  function hasReviewFeedback(slotPath, noteOverride) {
    const note = typeof noteOverride === 'string'
      ? noteOverride
      : ((selections.notes && selections.notes[slotPath]) || '');
    const picked = selections.picks && Object.values(selections.picks).includes(slotPath);
    return !!(selections.ratings && Object.prototype.hasOwnProperty.call(selections.ratings, slotPath))
      || picked
      || note.trim().length > 0
      || openAnnotationsForSlot(slotPath).length > 0;
  }

  async function archiveReview(slotPath, note) {
    const result = await post({ kind: 'archive-review', slot: slotPath, text: note });
    if (!result || !result.reviewArchive) return false;
    if (!selections.notes) selections.notes = {};
    if (!selections.reviewArchive) selections.reviewArchive = {};
    if (!selections.reviewReopen) selections.reviewReopen = {};
    selections.notes[slotPath] = note;
    selections.reviewArchive[slotPath] = result.reviewArchive;
    delete selections.reviewReopen[slotPath];
    ratingEditing.delete(slotPath);
    return true;
  }

  async function restoreReview(slotPath) {
    const result = await post({ kind: 'restore-review', slot: slotPath });
    if (!result || !result.reviewReopen) return false;
    if (selections.reviewArchive) delete selections.reviewArchive[slotPath];
    if (!selections.reviewReopen) selections.reviewReopen = {};
    selections.reviewReopen[slotPath] = result.reviewReopen;
    return true;
  }

  // Refetch the server-owned rollup. The archive mutates it behind the client's
  // back, so redrawing from the in-memory copy after an "archived" frame would
  // re-render the very records that were just retired.
  async function refreshSelections() {
    try {
      const next = await (await fetch('/__gallery/selections?t=' + Date.now())).json();
      if (next && typeof next === 'object') selections = next;
    } catch { /* keep the copy we have — a stale rail beats a blank one */ }
    if (!selections.ratings) selections.ratings = {};
    if (!selections.picks) selections.picks = {};
    if (!selections.notes) selections.notes = {};
    if (!selections.annotations) selections.annotations = {};
    if (!selections.reviewArchive) selections.reviewArchive = {};
    if (!selections.reviewReopen) selections.reviewReopen = {};
  }

  // archivedVersions is shared state and this is a network round-trip, so a
  // response is only allowed to land while its own viewer generation is open.
  // Open A then B before A's fetch returns and an unguarded assignment leaves
  // B's rail listing A's history — with an "Open the version this was written
  // against" link into A's archive.
  async function loadArchivedVersions(slotPath, generation = viewerGeneration) {
    if (!slotPath) {
      if (generation === viewerGeneration) archivedVersions = [];
      return false;
    }
    let list = [];
    try {
      const data = await (await fetch('/__gallery/archive?slot=' + encodeURIComponent(slotPath))).json();
      if (Array.isArray(data && data.versions)) list = data.versions;
    } catch { /* no history is the honest fallback for a failed fetch */ }
    if (slotPath !== activeSlot || generation !== viewerGeneration) return false;
    archivedVersions = list.slice().reverse();   // version ids sort chronologically; newest first reads better
    return true;
  }

  function annotationId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return 'ann-' + globalThis.crypto.randomUUID();
    return 'ann-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  async function saveViewerFeedback() {
    const ratingSaved = await saveViewerRating(true);
    const commentSaved = await saveViewerComment(true);
    return ratingSaved && commentSaved;
  }

  function canLeaveViewerSlot() {
    const hasAnnotationDraft = !!(pendingAnnotation && pendingAnnotation.comment && pendingAnnotation.comment.trim());
    if (hasAnnotationDraft && !globalThis.confirm('Discard this unsaved annotation?')) return false;
    if (viewerRatingSavePromise || viewerRatingDraft !== viewerRatingSaved
      || viewerCommentSavePending || viewerCommentDraft !== viewerCommentSaved) return saveViewerFeedback();
    return true;
  }

  function closeViewer() {
    const canLeave = canLeaveViewerSlot();
    if (canLeave && typeof canLeave.then === 'function') {
      canLeave.then((allowed) => { if (allowed) finishCloseViewer(); });
      return;
    }
    if (!canLeave) return;
    finishCloseViewer();
  }

  function finishCloseViewer() {
    if (activeFrame && typeof activeFrame.__gwAnnotationCleanup === 'function') activeFrame.__gwAnnotationCleanup();
    const restoreSlot = activeSlot;
    activeSlot = null;
    activeScreen = null;
    activeFrame = null;
    activeAnnotationId = null;
    pendingAnnotation = null;
    annotationMode = false;
    annotationRail = null;
    archivedVersions = [];
    priorVersionsOpen = false;
    annotateButton = null;
    shapeGroup = null;
    dotButton = null;
    squareButton = null;
    viewerRatingDraft = null;
    viewerRatingSaved = null;
    viewerRatingSavePromise = null;
    viewerRatingSaveFailed = false;
    viewerRatingButtons = [];
    viewerRatingStatusEl = null;
    viewerCommentDraft = '';
    viewerCommentSaved = '';
    viewerCommentSavePending = false;
    viewerCommentSavePromise = null;
    clearTimeout(viewerCommentSaveTimer);
    viewerCommentSaveTimer = null;
    viewerCommentStatusEl = null;
    viewerArchiveButton = null;
    viewerLifecycleSavePending = false;
    viewerEl.hidden = true;
    galleryEl.inert = false;
    topbarEl.inert = false;
    viewerEl.classList.remove('annotating');
    clear(viewerEl);
    document.body.style.overflow = '';
    if (galleryStateDirty) {
      archivedSectionOpen = false;
      render();
      galleryStateDirty = false;
    }
    const reviewedSummary = galleryEl.querySelector('.archived-section > summary');
    viewerOpener = isReviewArchived(restoreSlot)
      ? (reviewedSummary || viewerOpener)
      : (expandButtonForSlot(restoreSlot) || viewerOpener);
    if (viewerOpener && typeof viewerOpener.focus === 'function') viewerOpener.focus();
    viewerOpener = null;
    viewerSlotPaths = null;
    viewerOpenedReviewed = false;
  }

  function selectorForElement(el, doc) {
    const escapeValue = (value) => {
      if (doc.defaultView.CSS && typeof doc.defaultView.CSS.escape === 'function') return doc.defaultView.CSS.escape(value);
      return String(value).replace(/[^A-Za-z0-9_-]/g, (character) => String.fromCharCode(92) + character);
    };
    if (el.id) return '#' + escapeValue(el.id);
    for (const attr of ['data-testid', 'data-component', 'aria-label', 'name']) {
      const value = el.getAttribute && el.getAttribute(attr);
      if (!value) continue;
      const candidate = '[' + attr + '="' + escapeValue(String(value)) + '"]';
      try { if (doc.querySelectorAll(candidate).length === 1) return candidate; } catch { /* use structural path */ }
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== doc.body && parts.length < 7) {
      let part = node.tagName.toLowerCase();
      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter((child) => child.tagName === node.tagName)
        : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function describeElement(el, doc) {
    const component = el.closest && el.closest('[data-component]');
    const rawText = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    return {
      selector: selectorForElement(el, doc),
      component: component ? (component.getAttribute('data-component') || '') : '',
      tag: (el.tagName || '').toLowerCase(),
      role: el.getAttribute ? (el.getAttribute('role') || '') : '',
      label: el.getAttribute ? (el.getAttribute('aria-label') || el.getAttribute('title') || '') : '',
      text: rawText.slice(0, 500),
    };
  }

  function selectedAnnotation() {
    if (pendingAnnotation) return pendingAnnotation;
    return openAnnotationsForSlot(activeSlot).find((item) => item && item.id === activeAnnotationId) || null;
  }

  function drawAnnotationMarkers() {
    if (!activeFrame || !activeFrame.contentDocument) return;
    const doc = activeFrame.contentDocument;
    const oldLayer = doc.getElementById('groundwork-annotation-layer');
    if (oldLayer) oldLayer.remove();
    const layer = doc.createElement('div');
    layer.id = 'groundwork-annotation-layer';
    layer.setAttribute('aria-label', 'Groundwork annotations');
    const width = Math.max(doc.documentElement.scrollWidth, doc.body ? doc.body.scrollWidth : 0, 1);
    const height = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0, 1);
    Object.assign(layer.style, {
      position: 'absolute', left: '0', top: '0', width: width + 'px', height: height + 'px',
      zIndex: '2147483646', pointerEvents: 'none',
    });
    const saved = openAnnotationsForSlot(activeSlot);
    const visible = pendingAnnotation ? saved.concat([pendingAnnotation]) : saved;
    visible.forEach((annotation, index) => {
      if (!annotation) return;
      const isBox = annotation.marker === 'box' || annotation.marker === 'square';
      const bounds = annotation.bounds && typeof annotation.bounds === 'object' ? annotation.bounds : null;
      const hasBounds = isBox && bounds && Number(bounds.width) > 0 && Number(bounds.height) > 0;
      const marker = doc.createElement('button');
      marker.type = 'button';
      marker.dataset.gwAnnotationId = annotation.id;
      marker.title = annotation.comment || 'Groundwork annotation';
      const markerLabel = pendingAnnotation && annotation.id === pendingAnnotation.id ? '+' : String(index + 1);
      Object.assign(marker.style, {
        position: 'absolute', left: (Number(annotation.x) * 100) + '%', top: (Number(annotation.y) * 100) + '%',
        transform: 'translate(-50%,-50%)', width: '28px', height: '28px', padding: '0',
        border: '2px solid white', borderRadius: '50%',
        background: '#2b6cf0', color: 'white', boxShadow: '0 2px 8px rgba(0,0,0,.35)',
        font: '700 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        cursor: 'pointer', pointerEvents: 'auto',
      });
      if (hasBounds) {
        Object.assign(marker.style, {
          left: (Number(bounds.x) * 100) + '%', top: (Number(bounds.y) * 100) + '%',
          transform: 'none', width: (Number(bounds.width) * 100) + '%', height: (Number(bounds.height) * 100) + '%',
          minWidth: '12px', minHeight: '12px', border: '3px solid #2b6cf0', borderRadius: '7px',
          background: 'rgba(43,108,240,.08)', boxShadow: '0 0 0 1px rgba(255,255,255,.8)',
          pointerEvents: 'none',
        });
        const badge = doc.createElement('span');
        badge.textContent = markerLabel;
        Object.assign(badge.style, {
          position: 'absolute', left: '-11px', top: '-11px', display: 'grid', placeItems: 'center',
          width: '22px', height: '22px', borderRadius: '5px', background: '#2b6cf0', color: 'white',
          border: '2px solid white', boxShadow: '0 2px 6px rgba(0,0,0,.3)', pointerEvents: 'auto',
        });
        marker.appendChild(badge);
      } else {
        marker.textContent = markerLabel;
        if (isBox) marker.style.borderRadius = '6px';
      }
      if (annotation.id === activeAnnotationId || (pendingAnnotation && annotation.id === pendingAnnotation.id)) {
        marker.style.outline = '3px solid rgba(110,168,254,.5)';
        marker.style.outlineOffset = '2px';
      }
      marker.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        pendingAnnotation = pendingAnnotation && pendingAnnotation.id === annotation.id ? pendingAnnotation : null;
        activeAnnotationId = annotation.id;
        renderAnnotationRail();
        drawAnnotationMarkers();
      }, true);
      layer.appendChild(marker);
    });
    doc.documentElement.appendChild(layer);
  }

  function setAnnotationMode(enabled) {
    annotationMode = !!enabled;
    viewerEl.classList.toggle('annotating', annotationMode);
    if (annotateButton) {
      annotateButton.classList.toggle('on', annotationMode);
      annotateButton.setAttribute('aria-pressed', annotationMode ? 'true' : 'false');
      annotateButton.textContent = annotationMode ? 'End annotation' : 'Annotate';
    }
    if (shapeGroup) shapeGroup.hidden = !annotationMode;
    if (activeFrame && activeFrame.contentDocument) {
      activeFrame.contentDocument.documentElement.style.cursor = annotationMode ? 'crosshair' : '';
    }
    if (!annotationMode) setMarkerShape('dot');
    renderAnnotationRail();
  }

  function setMarkerShape(shape) {
    markerShape = shape === 'box' || shape === 'square' ? 'box' : 'dot';
    if (dotButton) { dotButton.classList.toggle('on', markerShape === 'dot'); dotButton.setAttribute('aria-pressed', markerShape === 'dot' ? 'true' : 'false'); }
    if (squareButton) { squareButton.classList.toggle('on', markerShape === 'box'); squareButton.setAttribute('aria-pressed', markerShape === 'box' ? 'true' : 'false'); }
  }

  // --- per-element data-I/O annotation (feat-io-annotation-ui, gallery half)
  // Same display-only chip as the iterate rail (canvas-server.mjs runIterate,
  // PROTOCOL.md §5a), inline-attribute source only: gallery slots have no
  // per-slot status.json, so there is no ioAnnotations map to read here.
  // Non-destructive: an element with neither attribute renders no chip.
  function renderIoChips(doc) {
    if (!doc) return;
    for (const el of doc.querySelectorAll('[data-component]')) {
      const old = el.querySelector(':scope > [data-gw-io-chip]');
      if (old) old.remove();
      const inText = el.getAttribute('data-datain') || '';
      const outText = el.getAttribute('data-dataout') || '';
      if (!inText && !outText) continue;
      const parts = [];
      if (inText) parts.push('in: ' + inText);
      if (outText) parts.push('out: ' + outText);
      const chip = doc.createElement('span');
      chip.setAttribute('data-gw-io-chip', '1');
      chip.textContent = parts.join(' · ');
      Object.assign(chip.style, {
        display: 'inline-block', marginLeft: '6px', padding: '1px 7px', borderRadius: '999px',
        font: '600 10px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        letterSpacing: '.01em', verticalAlign: 'middle', pointerEvents: 'none',
        background: 'rgba(110,168,254,.16)', color: '#2b6cf0', border: '1px solid rgba(110,168,254,.4)',
      });
      el.appendChild(chip);
    }
  }

  function deltaHighlightStatusText(delta) {
    if (!delta || !delta.selector) return 'Text summary only.';
    if (viewerDeltaHighlightState === 'highlighted') return 'The changed region is outlined in the mockup.';
    if (viewerDeltaHighlightState === 'unavailable') return 'The highlight target is unavailable; use the summary above.';
    return 'The changed region will be outlined when the mockup loads.';
  }

  function setViewerDeltaHighlightState(state, delta) {
    viewerDeltaHighlightState = state;
    if (viewerDeltaStatusEl) viewerDeltaStatusEl.textContent = deltaHighlightStatusText(delta);
  }

  function applyActiveDeltaHighlight(doc) {
    const delta = slotDelta(slotForPath(activeSlot));
    if (!delta || !delta.selector || !doc) {
      setViewerDeltaHighlightState(delta ? 'text-only' : 'none', delta);
      return () => {};
    }
    let target = null;
    try { target = doc.querySelector(delta.selector); } catch { /* invalid optional selector */ }
    if (!target) {
      setViewerDeltaHighlightState('unavailable', delta);
      return () => {};
    }
    const style = doc.createElement('style');
    style.setAttribute('data-gw-review-delta-style', '1');
    style.textContent = '[data-gw-review-delta="true"]{outline:3px solid var(--gw-review-delta-color)!important;outline-offset:4px!important;box-shadow:0 0 0 8px color-mix(in srgb,var(--gw-review-delta-color) 22%,transparent)!important}';
    (doc.head || doc.documentElement).appendChild(style);
    const priorMarker = target.getAttribute('data-gw-review-delta');
    const priorColor = target.style.getPropertyValue('--gw-review-delta-color');
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    target.setAttribute('data-gw-review-delta', 'true');
    target.style.setProperty('--gw-review-delta-color', accent || 'currentColor');
    setViewerDeltaHighlightState('highlighted', delta);
    return () => {
      style.remove();
      if (priorMarker == null) target.removeAttribute('data-gw-review-delta');
      else target.setAttribute('data-gw-review-delta', priorMarker);
      if (priorColor) target.style.setProperty('--gw-review-delta-color', priorColor);
      else target.style.removeProperty('--gw-review-delta-color');
    };
  }

  function wireViewerFrame() {
    if (!activeFrame || !activeFrame.contentDocument || !activeFrame.contentWindow) return;
    if (typeof activeFrame.__gwAnnotationCleanup === 'function') activeFrame.__gwAnnotationCleanup();
    if (typeof activeFrame.__gwDeltaCleanup === 'function') activeFrame.__gwDeltaCleanup();
    const doc = activeFrame.contentDocument;
    const win = activeFrame.contentWindow;
    doc.documentElement.style.cursor = annotationMode ? 'crosshair' : '';
    renderIoChips(doc);
    activeFrame.__gwDeltaCleanup = applyActiveDeltaHighlight(doc);
    const focusableComponents = Array.from(doc.querySelectorAll('[data-component]:not([tabindex])'));
    for (const component of focusableComponents) component.setAttribute('tabindex', '0');
    const placeAnnotation = (target, clientX, clientY) => {
      if (target && target.nodeType !== 1) target = target.parentElement;
      if (!target || target === doc.documentElement || target === doc.body) return;
      const width = Math.max(doc.documentElement.scrollWidth, doc.body ? doc.body.scrollWidth : 0, 1);
      const height = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0, 1);
      const rect = target.getBoundingClientRect();
      const isBox = markerShape === 'box';
      pendingAnnotation = {
        id: annotationId(), marker: markerShape,
        x: Math.min(1, Math.max(0, ((isBox ? rect.left + rect.width / 2 : clientX) + win.scrollX) / width)),
        y: Math.min(1, Math.max(0, ((isBox ? rect.top + rect.height / 2 : clientY) + win.scrollY) / height)),
        bounds: {
          x: Math.min(1, Math.max(0, (rect.left + win.scrollX) / width)),
          y: Math.min(1, Math.max(0, (rect.top + win.scrollY) / height)),
          width: Math.min(1, Math.max(0, rect.width / width)),
          height: Math.min(1, Math.max(0, rect.height / height)),
        },
        target: describeElement(target, doc),
        viewport: { width: win.innerWidth, height: win.innerHeight },
        document: { width: width, height: height },
        comment: '', status: 'open',
      };
      activeAnnotationId = pendingAnnotation.id;
      renderAnnotationRail();
      drawAnnotationMarkers();
    };
    const onClick = (event) => {
      const marker = event.target && event.target.closest ? event.target.closest('[data-gw-annotation-id]') : null;
      if (marker) return;
      if (!annotationMode) return;
      let target = event.target;
      if (target && target.nodeType !== 1) target = target.parentElement;
      if (!target || target === doc.documentElement || target === doc.body) return;
      event.preventDefault();
      event.stopPropagation();
      placeAnnotation(target, event.clientX, event.clientY);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeViewer();
        return;
      }
      if (!annotationMode || (event.key !== 'Enter' && event.key !== ' ')) return;
      let target = event.target;
      if (target && target.nodeType !== 1) target = target.parentElement;
      if (!target || target === doc.documentElement || target === doc.body) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = target.getBoundingClientRect();
      placeAnnotation(target, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKeyDown, true);
    activeFrame.__gwAnnotationCleanup = () => {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      for (const component of focusableComponents) component.removeAttribute('tabindex');
    };
    drawAnnotationMarkers();
  }

  // "Prior versions (N)" — the recovery surface for archived critique, and the
  // only place it is reachable in the UI. It lives at the FOOT OF THE ANNOTATION
  // RAIL, in full view only: the comparison grid stays a comparison grid, and
  // the viewer toolbar keeps holding exactly the three tools it held before.
  // Rendered only when N > 0 — a disclosure that opens onto nothing is chrome.
  // It is a plain button, so the viewer's focus trap picks it up with no
  // special-casing (a <summary> would not match the trap's selector).
  function appendPriorVersions() {
    if (!annotationRail || !archivedVersions.length) return;
    const body = h('div', { class: 'prior-versions-body' });
    for (const entry of archivedVersions) {
      const items = Array.isArray(entry.annotations) ? entry.annotations : [];
      const when = entry.archivedAt ? String(entry.archivedAt).slice(0, 16).replace('T', ' ') + ' UTC' : entry.version;
      const noHtmlNote = entry.provenance === 'mtime-bootstrap'
        ? ' · prior HTML was never captured'
        : ' · nothing to retire, so no copy was kept';
      const detail = items.length + (items.length === 1 ? ' annotation' : ' annotations')
        + (entry.html ? '' : noHtmlNote);
      const version = h('div', { class: 'prior-version' },
        h('strong', null, when),
        h('span', null, detail),
        h('ul', { class: 'prior-comments' }, items.map((item) => h('li', null, (item && item.comment) || 'No comment'))));
      if (entry.html) {
        version.append(h('a', {
          class: 'prior-html',
          href: '/__gallery/archive?slot=' + encodeURIComponent(entry.slot || activeSlot)
            + '&version=' + encodeURIComponent(entry.version) + '&file=html',
          target: '_blank', rel: 'noopener',
        }, 'Open the version this was written against'));
      }
      body.append(version);
    }
    body.hidden = !priorVersionsOpen;
    const toggle = h('button', {
      class: 'prior-versions-toggle', type: 'button',
      'aria-expanded': priorVersionsOpen ? 'true' : 'false',
    }, 'Prior versions (' + archivedVersions.length + ')');
    toggle.addEventListener('click', () => {
      priorVersionsOpen = !priorVersionsOpen;
      body.hidden = !priorVersionsOpen;
      toggle.setAttribute('aria-expanded', priorVersionsOpen ? 'true' : 'false');
    });
    annotationRail.append(h('div', { class: 'prior-versions' }, toggle, body));
  }

  function ratingLabel(rating) {
    return rating === 'yay' ? 'Yay' : (rating === 'nay' ? 'Nay' : 'OK');
  }

  async function persistRating(slotPath, rating) {
    const result = await post({ kind: 'rate', slot: slotPath, rating });
    if (!result) return false;
    if (!selections.ratings) selections.ratings = {};
    selections.ratings[slotPath] = rating;
    if (selections.reviewReopen) delete selections.reviewReopen[slotPath];
    return true;
  }

  function setViewerRatingStatus(text) {
    if (viewerRatingStatusEl) viewerRatingStatusEl.textContent = text;
  }

  function syncViewerRatingControls() {
    const displayed = viewerRatingSavePromise || viewerRatingSaveFailed
      ? viewerRatingDraft : viewerRatingSaved;
    for (const button of viewerRatingButtons) {
      const selected = button.dataset.rating === displayed;
      button.disabled = !!viewerRatingSavePromise;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
    syncViewerArchiveButton();
  }

  async function saveViewerRating(force = false) {
    if (!activeSlot) return true;
    if (viewerRatingSavePromise) {
      const priorSaved = await viewerRatingSavePromise;
      if (!priorSaved) return false;
      if (force && viewerRatingDraft !== viewerRatingSaved) return saveViewerRating(true);
      return true;
    }
    if (viewerRatingDraft === viewerRatingSaved) {
      viewerRatingSaveFailed = false;
      setViewerRatingStatus(viewerRatingSaved
        ? ratingLabel(viewerRatingSaved) + ' saved'
        : 'No Yay/Nay decision saved');
      syncViewerRatingControls();
      return true;
    }
    if (viewerRatingDraft !== 'yay' && viewerRatingDraft !== 'nay') return true;

    const slotPath = activeSlot;
    const generation = viewerGeneration;
    const rating = viewerRatingDraft;
    viewerRatingSaveFailed = false;
    setViewerRatingStatus('Saving ' + ratingLabel(rating) + '…');
    viewerRatingSavePromise = (async () => {
      const saved = await persistRating(slotPath, rating);
      if (saved) {
        galleryStateDirty = true;
        ratingEditing.delete(slotPath);
      }
      const isCurrentView = activeSlot === slotPath && viewerGeneration === generation;
      if (isCurrentView) {
        viewerRatingSavePromise = null;
        if (saved) {
          viewerRatingSaved = rating;
          viewerRatingSaveFailed = false;
          setViewerRatingStatus(ratingLabel(rating) + ' saved');
        } else {
          viewerRatingSaveFailed = true;
          setViewerRatingStatus(ratingLabel(rating) + ' not saved');
          toast('Decision not saved', ' — check that the gallery server is running, then retry.');
        }
        syncViewerRatingControls();
      }
      return saved;
    })();
    syncViewerRatingControls();
    const saved = await viewerRatingSavePromise;
    if (force && saved && viewerRatingDraft !== viewerRatingSaved) return saveViewerRating(true);
    return saved;
  }

  function setViewerCommentStatus(text) {
    if (viewerCommentStatusEl) viewerCommentStatusEl.textContent = text;
  }

  async function saveViewerComment(force = false) {
    clearTimeout(viewerCommentSaveTimer);
    viewerCommentSaveTimer = null;
    if (!activeSlot) return true;
    if (viewerCommentSavePromise) {
      const priorSaved = await viewerCommentSavePromise;
      if (!priorSaved) return false;
      if (force && viewerCommentDraft !== viewerCommentSaved) return saveViewerComment(true);
      return true;
    }
    if (viewerCommentDraft === viewerCommentSaved) return true;

    const slotPath = activeSlot;
    const generation = viewerGeneration;
    const text = viewerCommentDraft;
    viewerCommentSavePending = true;
    setViewerCommentStatus('Saving…');
    viewerCommentSavePromise = (async () => {
      const result = await post({ kind: 'note', slot: slotPath, text });
      if (result) {
        if (!selections.notes) selections.notes = {};
        selections.notes[slotPath] = text;
        if (text.trim() && selections.reviewReopen) delete selections.reviewReopen[slotPath];
        galleryStateDirty = true;
      }
      const isCurrentView = activeSlot === slotPath && viewerGeneration === generation;
      if (isCurrentView) {
        viewerCommentSavePending = false;
        viewerCommentSavePromise = null;
        if (!result) {
          setViewerCommentStatus('Not saved');
          toast('Comment not saved', ' — check that the gallery server is running, then retry.');
        } else {
          viewerCommentSaved = text;
          setViewerCommentStatus(viewerCommentDraft === text ? 'Saved automatically' : 'Saving latest edit…');
        }
        syncViewerArchiveButton();
      }
      return !!result;
    })();
    const saved = await viewerCommentSavePromise;
    if (force && saved && viewerCommentDraft !== viewerCommentSaved) return saveViewerComment(true);
    if (!force && saved && viewerCommentDraft !== viewerCommentSaved) scheduleViewerCommentSave();
    return saved;
  }

  function scheduleViewerCommentSave() {
    clearTimeout(viewerCommentSaveTimer);
    viewerCommentSaveTimer = setTimeout(() => { void saveViewerComment(false); }, 450);
  }

  function syncViewerArchiveButton() {
    if (!viewerArchiveButton) return;
    const archived = !!(activeSlot && viewerOpenedReviewed);
    const hasDraft = !!(pendingAnnotation && pendingAnnotation.comment && pendingAnnotation.comment.trim());
    const saveBusy = !!(viewerLifecycleSavePending || viewerRatingSavePromise || viewerCommentSavePromise);
    viewerArchiveButton.disabled = !activeSlot || saveBusy || hasDraft
      || (!archived && !hasReviewFeedback(activeSlot, viewerCommentDraft));
  }

  async function changeViewerReviewLifecycle() {
    const slotPath = activeSlot;
    if (!slotPath || !viewerArchiveButton) return;
    const restoring = viewerOpenedReviewed;
    viewerLifecycleSavePending = true;
    viewerArchiveButton.disabled = true;
    viewerArchiveButton.textContent = restoring ? 'Reopening…' : 'Archiving…';

    let changed = false;
    if (restoring) {
      changed = await restoreReview(slotPath);
    } else {
      clearTimeout(viewerCommentSaveTimer);
      viewerCommentSaveTimer = null;
      const ratingSaved = await saveViewerRating(true);
      if (ratingSaved && viewerCommentSavePromise) await viewerCommentSavePromise;
      if (ratingSaved) changed = await archiveReview(slotPath, viewerCommentDraft);
    }

    if (!changed || activeSlot !== slotPath) {
      if (activeSlot === slotPath && viewerArchiveButton) {
        viewerLifecycleSavePending = false;
        viewerArchiveButton.textContent = restoring ? 'Review again' : 'Archive reviewed';
        syncViewerArchiveButton();
      }
      toast(restoring ? 'Reopen failed' : 'Archive failed',
        ' — your feedback is still here. Check the gallery connection and retry.');
      return;
    }

    galleryStateDirty = true;
    if (!restoring) viewerCommentSaved = viewerCommentDraft;
    finishCloseViewer();
    toast(restoring ? 'Reopened' : 'Moved to Reviewed',
      restoring ? ' — returned to the active queue.' : ' — feedback preserved.');
  }

  function appendViewerFeedback() {
    let ratingStatusText = 'No Yay/Nay decision saved';
    if (viewerRatingSavePromise) ratingStatusText = 'Saving ' + ratingLabel(viewerRatingDraft) + '…';
    else if (viewerRatingSaveFailed) ratingStatusText = ratingLabel(viewerRatingDraft) + ' not saved';
    else if (viewerRatingSaved) ratingStatusText = ratingLabel(viewerRatingSaved) + ' saved';
    viewerRatingStatusEl = h('span', {
      class: 'viewer-feedback-status', role: 'status', 'aria-live': 'polite',
    }, ratingStatusText);
    const ratingRow = h('div', {
      class: 'viewer-rating-row', role: 'group', 'aria-label': 'Quick decision for this mockup',
    });
    viewerRatingButtons = [
      ['yay', 'Yay'], ['nay', 'Nay'],
    ].map(([rating, label]) => {
      const displayed = viewerRatingSavePromise || viewerRatingSaveFailed
        ? viewerRatingDraft : viewerRatingSaved;
      const selected = displayed === rating;
      const button = h('button', {
        class: 'rate-btn' + (selected ? ' on' : ''), type: 'button',
        dataset: { rating }, 'aria-pressed': selected ? 'true' : 'false',
      }, label);
      button.disabled = !!viewerRatingSavePromise;
      button.addEventListener('click', () => {
        viewerRatingDraft = rating;
        viewerRatingSaveFailed = false;
        syncViewerArchiveButton();
        void saveViewerRating(false);
      });
      return button;
    });
    ratingRow.append(...viewerRatingButtons);

    const winnerSelected = !!(selections.picks && selections.picks[activeScreen] === activeSlot);
    const winnerStatus = h('span', { class: 'viewer-feedback-status' }, winnerSelected
      ? 'Selected for this screen' : 'Choose after reviewing the full mockup');
    const winnerButton = h('button', {
      class: 'pick-btn viewer-pick-btn' + (winnerSelected ? ' on' : ''), type: 'button',
      'aria-pressed': winnerSelected ? 'true' : 'false',
    }, winnerSelected ? 'Winner ✓' : 'Select winner');
    winnerButton.addEventListener('click', async () => {
      if (winnerButton.getAttribute('aria-pressed') === 'true') return;
      const slotPath = activeSlot;
      const screenId = activeScreen;
      const generation = viewerGeneration;
      winnerButton.disabled = true;
      winnerButton.textContent = 'Selecting…';
      const ok = await post({ kind: 'pick', screen: screenId, slot: slotPath });
      const isCurrentView = activeSlot === slotPath && activeScreen === screenId && viewerGeneration === generation;
      // Annotation/archive loading can replace the rail during the request.
      // Resolve current controls only after the view identity fence; do not
      // rebuild the rail here because it contains the user's feedback draft.
      const currentWinnerRow = isCurrentView ? annotationRail.querySelector('.viewer-pick-row') : null;
      const currentWinnerButton = currentWinnerRow?.querySelector('.viewer-pick-btn');
      const currentWinnerStatus = currentWinnerRow?.querySelector('.viewer-feedback-status');
      if (!ok) {
        if (currentWinnerButton && currentWinnerStatus) {
          currentWinnerButton.disabled = false;
          currentWinnerButton.textContent = 'Select winner';
          currentWinnerStatus.textContent = 'Winner not saved';
          toast('', 'Could not reach the gallery server — is it still running?');
        }
        return;
      }
      if (!selections.picks) selections.picks = {};
      selections.picks[screenId] = slotPath;
      if (selections.reviewReopen) delete selections.reviewReopen[slotPath];
      galleryStateDirty = true;
      if (!currentWinnerButton || !currentWinnerStatus) return;
      currentWinnerButton.disabled = false;
      currentWinnerButton.classList.add('on');
      currentWinnerButton.setAttribute('aria-pressed', 'true');
      currentWinnerButton.textContent = 'Winner ✓';
      currentWinnerStatus.textContent = 'Selected for this screen';
      syncViewerArchiveButton();
      toast('Winner selected', ' — expanded review stays open.');
    });

    const commentId = 'viewer-general-comment';
    viewerCommentStatusEl = h('span', {
      class: 'viewer-feedback-status', role: 'status', 'aria-live': 'polite',
    }, viewerCommentDraft === viewerCommentSaved
      ? (viewerCommentSaved ? 'Saved automatically' : 'Saves automatically')
      : 'Unsaved changes');
    const comment = h('textarea', {
      id: commentId, class: 'viewer-comment', placeholder: 'What works, what does not, or what should change next…',
    });
    comment.value = viewerCommentDraft;
    comment.addEventListener('input', () => {
      viewerCommentDraft = comment.value;
      setViewerCommentStatus(viewerCommentDraft === viewerCommentSaved
        ? (viewerCommentSaved ? 'Saved automatically' : 'Saves automatically')
        : 'Unsaved changes');
      if (viewerCommentDraft !== viewerCommentSaved) scheduleViewerCommentSave();
      else clearTimeout(viewerCommentSaveTimer);
      syncViewerArchiveButton();
    });

    const reviewingArchived = viewerOpenedReviewed;
    viewerArchiveButton = h('button', {
      class: reviewingArchived ? 'restore-review-btn' : 'archive-review-btn',
      type: 'button',
    }, reviewingArchived ? 'Review again' : 'Archive reviewed');
    viewerArchiveButton.addEventListener('click', () => { void changeViewerReviewLifecycle(); });

    annotationRail.append(h('div', { class: 'viewer-feedback' },
      h('section', { class: 'viewer-feedback-section', 'aria-labelledby': 'viewer-decision-heading' },
        h('h2', { id: 'viewer-decision-heading' }, 'Keep this direction?'),
        h('p', { class: 'annotation-help' }, 'Choose Yay or Nay. The decision saves immediately.'),
        ratingRow,
        viewerRatingStatusEl,
        h('div', { class: 'viewer-pick-row' }, winnerStatus, winnerButton)),
      h('section', { class: 'viewer-feedback-section', 'aria-labelledby': 'viewer-comment-heading' },
        h('h2', { id: 'viewer-comment-heading' }, 'Overall comment'),
        h('p', { class: 'annotation-help' }, 'Use Annotate only when a recommendation belongs to a specific spot.'),
        h('label', { class: 'viewer-comment-label', for: commentId }, 'Comment on this mockup'),
        comment,
        h('div', { class: 'viewer-comment-actions' }, viewerCommentStatusEl)),
      h('div', { class: 'viewer-archive-row' },
        h('span', { class: 'archive-help' }, reviewingArchived
          ? 'Feedback stays attached when reopened.'
          : 'Saves this note, then removes the mockup from active review.'),
        viewerArchiveButton)));
    syncViewerArchiveButton();
  }

  function appendViewerDelta() {
    const delta = slotDelta(slotForPath(activeSlot));
    viewerDeltaStatusEl = null;
    if (!delta) return;
    viewerDeltaStatusEl = h('span', { class: 'viewer-delta-status', role: 'status' }, deltaHighlightStatusText(delta));
    annotationRail.append(h('section', { class: 'viewer-delta', 'aria-labelledby': 'viewer-delta-heading' },
      h('h2', { id: 'viewer-delta-heading' }, 'What changes'),
      h('p', null, delta.summary),
      viewerDeltaStatusEl));
  }

  function renderAnnotationRail() {
    if (!annotationRail || !activeSlot) return;
    clear(annotationRail);
    const prioritizeAnnotationEntry = annotationMode;
    if (!prioritizeAnnotationEntry) {
      appendViewerDelta();
      appendViewerFeedback();
    }
    const saved = openAnnotationsForSlot(activeSlot);
    annotationRail.append(
      h('h2', null, 'Annotations'),
      h('p', { class: 'annotation-help' }, annotationMode
        ? (markerShape === 'box' ? 'Select content to draw a box around it.' : 'Select an exact point or element for a dot.')
        : 'Turn on Annotate, then choose a dot or content box.'));

    const list = h('div', { class: 'annotation-list' });
    saved.forEach((annotation, index) => {
      const item = h('button', {
        class: 'annotation-item' + (activeAnnotationId === annotation.id ? ' on' : ''),
        type: 'button',
      },
      h('span', { class: 'annotation-marker' + (annotation.marker === 'box' || annotation.marker === 'square' ? ' square' : '') }, String(index + 1)),
      h('span', { class: 'annotation-copy' },
        h('strong', null, annotation.comment || 'Annotation ' + (index + 1)),
        h('span', null, annotation.target && (annotation.target.component || annotation.target.selector || annotation.target.tag) || 'Selected element')));
      item.addEventListener('click', () => {
        pendingAnnotation = null;
        activeAnnotationId = annotation.id;
        renderAnnotationRail();
        drawAnnotationMarkers();
      });
      list.appendChild(item);
    });
    annotationRail.appendChild(list);

    const current = selectedAnnotation();
    if (!current) {
      annotationRail.append(h('p', { class: 'annotation-empty' }, saved.length
        ? 'Select a marker to edit its comment.'
        : 'No annotations yet. Expand review stays uncluttered until you add one.'));
      if (prioritizeAnnotationEntry) {
        appendViewerDelta();
        appendViewerFeedback();
      }
      appendPriorVersions();
      return;
    }

    const context = current.target || {};
    const contextText = context.component
      ? 'Component: ' + context.component + (context.selector ? ' · ' + context.selector : '')
      : (context.selector || context.tag || 'Selected element');
    const comment = h('textarea', { class: 'annotation-comment', placeholder: 'Describe what should change and why…' });
    comment.value = current.comment || '';
    if (pendingAnnotation) {
      comment.addEventListener('input', () => {
        pendingAnnotation.comment = comment.value;
        syncViewerArchiveButton();
      });
    }
    const saveLabel = pendingAnnotation && annotationMode ? 'Save & continue' : (pendingAnnotation ? 'Save comment' : 'Update comment');
    const save = h('button', { class: 'tool-btn primary', type: 'button' }, saveLabel);
    save.addEventListener('click', async () => {
      const draft = Object.assign({}, current, { comment: comment.value });
      if (!draft.comment.trim()) { toast('', 'Add a comment before saving.'); comment.focus(); return; }
      const slotPath = activeSlot;
      const generation = viewerGeneration;
      const result = await post({ kind: 'annotation', slot: slotPath, annotation: draft });
      const isCurrentView = activeSlot === slotPath && viewerGeneration === generation;
      if (!result || !result.annotation) {
        if (isCurrentView) toast('Annotation not saved', ' — check that the gallery server is running, then retry.');
        return;
      }
      if (!selections.annotations) selections.annotations = {};
      const items = annotationsForSlot(slotPath).slice();
      const index = items.findIndex((item) => item && item.id === result.annotation.id);
      if (index >= 0) items[index] = result.annotation; else items.push(result.annotation);
      selections.annotations[slotPath] = items;
      if (result.annotation.status === 'open' && selections.reviewReopen) delete selections.reviewReopen[slotPath];
      galleryStateDirty = true;
      if (!isCurrentView) return;
      pendingAnnotation = null;
      activeAnnotationId = annotationMode ? null : result.annotation.id;
      renderAnnotationRail();
      drawAnnotationMarkers();
      if (annotationMode && activeFrame) activeFrame.focus();
      toast('Annotation saved', annotationMode ? ' — select another element.' : ' for Groundwork and UI agents');
    });
    const cancel = h('button', { class: 'tool-btn', type: 'button' }, pendingAnnotation ? 'Cancel' : 'Close editor');
    cancel.addEventListener('click', () => {
      pendingAnnotation = null;
      activeAnnotationId = null;
      renderAnnotationRail();
      drawAnnotationMarkers();
    });
    const actions = h('div', { class: 'annotation-actions' }, save, cancel);
    if (!pendingAnnotation) {
      const remove = h('button', { class: 'tool-btn danger', type: 'button' }, 'Delete');
      remove.addEventListener('click', async () => {
        const slotPath = activeSlot;
        const generation = viewerGeneration;
        const result = await post({ kind: 'annotation-delete', slot: slotPath, annotationId: current.id });
        const isCurrentView = activeSlot === slotPath && viewerGeneration === generation;
        if (!result) {
          if (isCurrentView) toast('Annotation not deleted', ' — check that the gallery server is running, then retry.');
          return;
        }
        selections.annotations[slotPath] = annotationsForSlot(slotPath).filter((item) => item && item.id !== current.id);
        if (!isCurrentView) return;
        activeAnnotationId = null;
        renderAnnotationRail();
        drawAnnotationMarkers();
        toast('Annotation deleted', '');
      });
      actions.appendChild(remove);
    }
    const editor = h('div', { class: 'annotation-editor' + (prioritizeAnnotationEntry ? ' priority' : '') },
      h('label', null, pendingAnnotation ? 'New comment' : 'Edit comment'),
      h('p', { class: 'annotation-context' }, contextText),
      comment,
      actions);
    if (prioritizeAnnotationEntry) annotationRail.insertBefore(editor, list);
    else annotationRail.append(editor);
    if (prioritizeAnnotationEntry) {
      appendViewerDelta();
      appendViewerFeedback();
    }
    appendPriorVersions();
    comment.focus();
  }

  function navigateViewer(delta) {
    const slots = viewerSlots();
    const index = slots.findIndex((slot) => slot.html_path === activeSlot);
    const target = slots[index + delta];
    if (!target) return;
    const canLeave = canLeaveViewerSlot();
    if (canLeave && typeof canLeave.then === 'function') {
      canLeave.then((allowed) => { if (allowed) finishNavigateViewer(target, delta); });
      return;
    }
    if (!canLeave) return;
    finishNavigateViewer(target, delta);
  }

  function finishNavigateViewer(target, delta) {
    const preservedAnnotationMode = annotationMode;
    const preservedMarkerShape = markerShape;
    if (activeFrame && typeof activeFrame.__gwAnnotationCleanup === 'function') activeFrame.__gwAnnotationCleanup();
    openViewer(target.screen_id, target, {
      preserveOpener: true,
      focusAction: delta < 0 ? 'previous' : 'next',
      annotationMode: preservedAnnotationMode,
      markerShape: preservedMarkerShape,
    });
  }

  function openViewer(screenId, slot, options = {}) {
    if (!options.preserveOpener) {
      viewerOpener = document.activeElement;
      viewerOpenedReviewed = isReviewArchived(slot.html_path);
      viewerSlotPaths = allViewerSlots()
        .filter((item) => isReviewArchived(item.html_path) === viewerOpenedReviewed)
        .map((item) => item.html_path);
    }
    viewerGeneration += 1;
    activeScreen = screenId;
    activeSlot = slot.html_path;
    activeAnnotationId = null;
    pendingAnnotation = null;
    const storedRating = selections.ratings && selections.ratings[activeSlot];
    viewerRatingSaved = storedRating === 'yay' || storedRating === 'nay' ? storedRating : null;
    viewerRatingDraft = viewerRatingSaved;
    viewerRatingSavePromise = null;
    viewerRatingSaveFailed = false;
    viewerRatingButtons = [];
    viewerRatingStatusEl = null;
    viewerCommentSaved = (selections.notes && selections.notes[activeSlot]) || '';
    viewerCommentDraft = viewerCommentSaved;
    viewerCommentSavePending = false;
    viewerCommentSavePromise = null;
    clearTimeout(viewerCommentSaveTimer);
    viewerCommentSaveTimer = null;
    viewerCommentStatusEl = null;
    viewerArchiveButton = null;
    viewerLifecycleSavePending = false;
    viewerDeltaStatusEl = null;
    viewerDeltaHighlightState = 'pending';
    annotationMode = !!options.annotationMode;
    markerShape = options.markerShape === 'box' ? 'box' : 'dot';
    archivedVersions = [];
    priorVersionsOpen = false;
    clear(viewerEl);

    const slots = viewerSlots();
    const slotIndex = slots.findIndex((item) => item.html_path === activeSlot);
    const previous = h('button', { class: 'viewer-nav-btn', type: 'button', dataset: { action: 'previous' } }, '← Previous');
    previous.disabled = slotIndex <= 0;
    if (!previous.disabled) {
      const target = slots[slotIndex - 1];
      previous.setAttribute('aria-label', 'Previous mockup: ' + screenLabel(target.screen_id) + ' · ' + modeLabel(target));
    }
    previous.addEventListener('click', () => navigateViewer(-1));
    const next = h('button', { class: 'viewer-nav-btn', type: 'button', dataset: { action: 'next' } }, 'Next →');
    next.disabled = slotIndex < 0 || slotIndex >= slots.length - 1;
    if (!next.disabled) {
      const target = slots[slotIndex + 1];
      next.setAttribute('aria-label', 'Next mockup: ' + screenLabel(target.screen_id) + ' · ' + modeLabel(target));
    }
    next.addEventListener('click', () => navigateViewer(1));
    annotateButton = h('button', { class: 'tool-btn', type: 'button', dataset: { action: 'annotate' }, 'aria-pressed': 'false' }, 'Annotate');
    annotateButton.addEventListener('click', () => setAnnotationMode(!annotationMode));
    dotButton = h('button', { class: 'shape-btn on', type: 'button', title: 'Place a dot', 'aria-label': 'Use dot marker', 'aria-pressed': 'true' }, '● Dot');
    dotButton.addEventListener('click', () => setMarkerShape('dot'));
    squareButton = h('button', { class: 'shape-btn', type: 'button', title: 'Box selected content', 'aria-label': 'Use content box', 'aria-pressed': 'false' }, '□ Box');
    squareButton.addEventListener('click', () => setMarkerShape('box'));
    shapeGroup = h('div', {
      class: 'shape-group', role: 'group', 'aria-label': 'Annotation marker shape', hidden: 'hidden',
    }, dotButton, squareButton);
    const close = h('button', { class: 'tool-btn', type: 'button', dataset: { action: 'close' } }, 'Exit full view');
    close.addEventListener('click', closeViewer);
    activeFrame = h('iframe', {
      class: 'viewer-frame', src: '/__gallery/slot?path=' + encodeURIComponent(activeSlot),
      dataset: { slot: activeSlot }, title: activeSlot,
    });
    activeFrame.addEventListener('load', wireViewerFrame);
    annotationRail = h('aside', { class: 'annotation-rail', 'aria-label': 'Mockup review' });

    viewerEl.append(
      h('header', { class: 'viewer-head' },
        h('div', { class: 'viewer-title', 'aria-live': 'polite', 'aria-atomic': 'true' },
          h('strong', null, screenLabel(screenId) + ' · ' + modeLabel(slot)),
          h('span', null, 'Full mockup view · ' + (slotIndex + 1) + ' of ' + slots.length),
          h('span', { class: 'viewer-hint' }, 'Annotation mode stays on until you end it')),
        h('div', { class: 'viewer-tools' },
          slots.length > 1
            ? h('div', { class: 'viewer-nav', role: 'group', 'aria-label': 'Expanded mockup navigation' }, previous, next)
            : null,
          annotateButton,
          shapeGroup,
          close)),
      h('div', { class: 'viewer-body' },
        h('div', { class: 'viewer-stage' }, activeFrame),
        annotationRail));
    viewerEl.hidden = false;
    galleryEl.inert = true;
    topbarEl.inert = true;
    document.body.style.overflow = 'hidden';
    setMarkerShape(markerShape);
    setAnnotationMode(annotationMode);
    const focusTarget = options.focusAction === 'previous'
      ? (previous.disabled ? next : previous)
      : options.focusAction === 'next'
        ? (next.disabled ? previous : next)
        : close;
    focusTarget.focus();
    // Fetched after the rail is already usable: prior versions are secondary,
    // and the rail must never wait on a network round-trip to appear.
    const openedSlot = activeSlot;
    const openedGeneration = viewerGeneration;
    loadArchivedVersions(openedSlot, openedGeneration).then((loaded) => {
      if (loaded) renderAnnotationRail();
    });
  }

  function reloadSlotFrame(slotPath) {
    for (const frame of galleryEl.querySelectorAll('iframe[data-slot]')) {
      if (frame.dataset.slot === slotPath) {
        frame.src = '/__gallery/slot?path=' + encodeURIComponent(slotPath) + '&t=' + Date.now();
      }
    }
    if (activeFrame && activeSlot === slotPath) {
      activeFrame.src = '/__gallery/slot?path=' + encodeURIComponent(slotPath) + '&t=' + Date.now();
    }
  }

  function renderSlotCard(screenId, slot) {
    const slotPath = slot.html_path;
    const rating = selections.ratings && selections.ratings[slotPath];
    const isPicked = !!(selections.picks && selections.picks[screenId] === slotPath);
    const noteVal = (selections.notes && selections.notes[slotPath]) || '';
    const delta = slotDelta(slot);

    const mkRateBtn = (val, label) => {
      const selected = rating === val;
      const btn = h('button', {
        class: 'rate-btn' + (selected ? ' on' : ''), type: 'button',
        dataset: { rating: val }, 'aria-pressed': selected ? 'true' : 'false',
      }, label);
      btn.addEventListener('click', async () => {
        const ok = await persistRating(slotPath, val);
        if (ok) {
          ratingEditing.delete(slotPath);
          archivedSectionOpen = false;
          render();
          focusAfterReview();
          toast('Moved to Reviewed', ' — ' + label + ' feedback saved.');
        }
        else toast('', 'Could not reach the gallery server — is it still running?');
      });
      return btn;
    };

    const ratingRow = h('div', {
      class: 'rate-row', role: 'group', 'aria-label': 'Rate this direction',
    });
    if (rating && !ratingEditing.has(slotPath)) {
      const label = ratingLabel(rating);
      ratingRow.append(
        h('button', {
          class: 'rate-btn on chosen', type: 'button', dataset: { rating },
          'aria-pressed': 'true', 'aria-label': label + ' selected',
          onclick: () => revealRatingChoices(slotPath, rating),
        }, label + ' selected'),
        h('button', {
          class: 'rating-change', type: 'button',
          'aria-label': 'Change ' + label + ' rating',
          onclick: () => revealRatingChoices(slotPath, rating),
        }, 'Change'),
      );
    } else {
      ratingRow.append(
        h('span', { class: 'rate-prompt' }, rating ? 'Change rating:' : 'Rate:'),
        mkRateBtn('yay', 'Yay'), mkRateBtn('ok', 'OK'), mkRateBtn('nay', 'Nay'),
      );
    }

    const pickBtn = h('button', {
      class: 'pick-btn' + (isPicked ? ' on' : ''), type: 'button',
      'aria-pressed': isPicked ? 'true' : 'false',
    }, isPicked ? 'Winner ✓' : 'Pick winner');
    pickBtn.addEventListener('click', async () => {
      const ok = await post({ kind: 'pick', screen: screenId, slot: slotPath });
      if (ok) {
        if (!selections.picks) selections.picks = {};
        selections.picks[screenId] = slotPath;
        if (selections.reviewReopen) delete selections.reviewReopen[slotPath];
        archivedSectionOpen = false;
        render();
        focusAfterReview();
        toast('Winner selected', ' — moved to Reviewed.');
      }
      else toast('', 'Could not reach the gallery server — is it still running?');
    });
    ratingRow.append(pickBtn);

    const noteArea = h('textarea', { class: 'note', placeholder: 'Notes on this slot…', maxlength: '4000' });
    noteArea.value = noteVal;
    const saveNote = h('button', { class: 'note-save' }, 'Save note');
    saveNote.addEventListener('click', async () => {
      const text = noteArea.value;
      const ok = await post({ kind: 'note', slot: slotPath, text });
      if (ok) {
        if (!selections.notes) selections.notes = {};
        selections.notes[slotPath] = text;
        if (text.trim() && selections.reviewReopen) delete selections.reviewReopen[slotPath];
        archivedSectionOpen = false;
        render();
        focusAfterReview();
        toast(text.trim() ? 'Moved to Reviewed' : 'Note cleared', text.trim() ? ' — comment saved.' : '');
      }
      else toast('', 'Could not reach the gallery server — is it still running?');
    });

    const archiveButton = h('button', {
      class: 'archive-review-btn', type: 'button',
    }, 'Archive reviewed');
    const syncArchiveButton = () => {
      archiveButton.disabled = !hasReviewFeedback(slotPath, noteArea.value);
    };
    noteArea.addEventListener('input', syncArchiveButton);
    archiveButton.addEventListener('click', async () => {
      archiveButton.disabled = true;
      archiveButton.textContent = 'Archiving…';
      const archived = await archiveReview(slotPath, noteArea.value);
      if (!archived) {
        archiveButton.textContent = 'Archive reviewed';
        syncArchiveButton();
        toast('Archive failed', ' — your feedback is still here. Check the gallery connection and retry.');
        return;
      }
      archivedSectionOpen = false;
      render();
      const archivedSummary = galleryEl.querySelector('.archived-section > summary');
      if (archivedSummary) archivedSummary.focus();
      toast('Moved to Reviewed', ' — feedback preserved.');
    });
    syncArchiveButton();

    const expand = h('button', { class: 'expand-btn', type: 'button' }, 'Expand');
    expand.addEventListener('click', () => openViewer(screenId, slot));

    return h('div', {
      class: 'card' + (isPicked ? ' picked' : ''), dataset: { slot: slotPath },
    },
      h('div', { class: 'card-head' },
        h('div', { class: 'card-head-main' }, h('span', null, modeLabel(slot)), h('span', null, slot.status || '')),
        expand),
      delta ? h('div', { class: 'slot-delta' },
        h('strong', null, 'What changes'),
        h('span', null, delta.summary)) : null,
      previewForSlot(screenId, slot),
      ratingRow,
      h('div', { class: 'note-row' }, noteArea, saveNote),
      h('div', { class: 'review-actions' },
        h('span', { class: 'archive-help' }, 'Save feedback and remove from active review.'),
        archiveButton));
  }

  function archivedFeedbackSummary(slotPath) {
    const parts = [];
    const rating = selections.ratings && selections.ratings[slotPath];
    if (rating) parts.push(ratingLabel(rating));
    const picked = selections.picks && Object.values(selections.picks).includes(slotPath);
    if (picked) parts.push('Winner selected');
    const openCount = openAnnotationsForSlot(slotPath).length;
    if (openCount) parts.push(openCount + ' ' + (openCount === 1 ? 'annotation' : 'annotations'));
    const note = (selections.notes && selections.notes[slotPath]) || '';
    if (note.trim()) parts.push('note saved');
    return parts.join(' · ') || 'Feedback preserved';
  }

  function archivedAtLabel(slotPath) {
    const value = selections.reviewArchive && selections.reviewArchive[slotPath];
    const parsed = value && Date.parse(value.archivedAt);
    if (!Number.isFinite(parsed)) return 'Reviewed from saved feedback';
    return 'Reviewed ' + new Date(parsed).toLocaleString([], {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  function renderArchivedCard(slot) {
    const slotPath = slot.html_path;
    const note = ((selections.notes && selections.notes[slotPath]) || '').trim();
    const expand = h('button', { class: 'expand-btn', type: 'button' }, 'Expand');
    expand.addEventListener('click', () => openViewer(slot.screen_id, slot));
    const restore = h('button', { class: 'restore-review-btn', type: 'button' }, 'Review again');
    restore.addEventListener('click', async () => {
      restore.disabled = true;
      restore.textContent = 'Reopening…';
      const restored = await restoreReview(slotPath);
      if (!restored) {
        restore.textContent = 'Review again';
        restore.disabled = false;
        toast('Reopen failed', ' — the reviewed mockup is unchanged.');
        return;
      }
      render();
      const card = cardForSlot(slotPath);
      const target = card && card.querySelector('.expand-btn');
      if (target) target.focus();
      toast('Reopened', ' — returned to the active queue.');
    });
    return h('article', { class: 'archived-card', dataset: { slot: slotPath } },
      h('div', null,
        h('h3', null, screenLabel(slot.screen_id) + ' · ' + modeLabel(slot)),
        h('p', { class: 'archived-meta' }, archivedFeedbackSummary(slotPath) + ' · ' + archivedAtLabel(slotPath)),
        note ? h('p', { class: 'archived-note' }, note) : null),
      h('div', { class: 'archived-actions' }, expand, restore));
  }

  function renderArchivedSection(slots) {
    const details = h('details', { class: 'archived-section' },
      h('summary', null, 'Reviewed (' + slots.length + ')'),
      h('div', { class: 'archived-list' }, slots.map(renderArchivedCard)));
    details.open = archivedSectionOpen;
    details.addEventListener('toggle', () => { archivedSectionOpen = details.open; });
    return details;
  }

  function render() {
    if (previewResizeObserver) previewResizeObserver.disconnect();
    clear(galleryEl);
    const ids = screenIds();
    if (!ids.length) { galleryEl.append(h('p', { class: 'empty' }, 'No screens in manifest.json yet.')); renderSummary(); return; }
    let activeScreenCount = 0;
    for (const screenId of ids) {
      const slots = slotsForScreen(screenId).filter((slot) => !isReviewArchived(slot.html_path));
      if (!slots.length) continue;
      activeScreenCount += 1;
      const picked = selections.picks && selections.picks[screenId];
      galleryEl.append(h('section', { class: 'screen' },
        h('div', { class: 'screen-head' },
          h('h2', null, screenLabel(screenId)),
          h('span', { class: 'screen-status' }, picked ? 'Picked: ' + picked : 'No pick yet')),
        h('div', { class: 'slots' }, slots.map((slot) => renderSlotCard(screenId, slot)))));
    }
    const archived = archivedReviewSlots();
    if (!activeScreenCount && archived.length) {
      galleryEl.append(h('p', { class: 'empty' }, 'Every current mockup has feedback. Use Review again below to revisit one.'));
    }
    if (archived.length) galleryEl.append(renderArchivedSection(archived));
    renderSummary();
  }

  const es = new EventSource('/__canvas/events');
  es.onopen = () => setGalleryConnected(true);
  es.onerror = () => setGalleryConnected(false);
  es.onmessage = (e) => {
    setGalleryConnected(true);
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    // The slot's content changed and the annotations made against the previous
    // version were archived. A "reload" alone only resets the iframe src — it
    // never refetches selections — so without this the retired markers would
    // redraw over the brand-new frame, which is the whole defect. The reload
    // frame still arrives right behind this one and is handled as before.
    if (m.type === 'archived' && m.path) {
      const archivedGeneration = viewerGeneration;
      refreshSelections().then(() => {
        if (viewerEl.hidden) render();
        else galleryStateDirty = true;
        if (m.path !== activeSlot || viewerGeneration !== archivedGeneration) return;
        return loadArchivedVersions(activeSlot, archivedGeneration).then((loaded) => {
          if (!loaded) return;
          renderAnnotationRail();
          drawAnnotationMarkers();
        });
      });
      return;
    }
    if (m.type === 'selections' && m.path) {
      refreshSelections().then(() => {
        if (viewerEl.hidden) render();
        else galleryStateDirty = true;
      });
      return;
    }
    if (m.type === 'reload' && m.path) reloadSlotFrame(m.path);
  };

  async function boot() {
    try { manifest = await (await fetch('/__gallery/manifest?t=' + Date.now())).json(); } catch { manifest = {}; }
    if (!manifest || typeof manifest !== 'object') manifest = {};
    await refreshSelections();
    render();
  }
  document.addEventListener('keydown', (event) => {
    if (viewerEl.hidden) return;
    if (event.key === 'Escape') { closeViewer(); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(viewerEl.querySelectorAll(
      'button:not([disabled]), textarea:not([disabled]), iframe, [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); viewerEl.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  boot();
})();
</script>
</body></html>`;
  }
}

// =============================================================================
// Dispatch
// =============================================================================
if (MODE === 'gallery') runGallery(); else runIterate();
