// test_gallery_archive.mjs — the archive engine WIRED INTO the gallery server.
//
// The defect this covers, observed live: six open annotations written against a
// mockup that was later rewritten kept rendering as active overlays on the new
// design, so the user was shown critique of work already done. The engine's own
// policy is unit-tested in test_gallery_archive_unit.mjs; this suite tests the
// wiring — startup sweep, live poller, HTTP route, and the rendered overlay —
// because every one of those is a place the policy can be correct and still not
// reach the screen.
//
// PROFILE ISOLATION. Every server here gets its own GROUNDWORK_PROFILE_STORE
// under the test's tmpdir, and every test except V6 also boots with
// GROUNDWORK_PROFILE=off. Nothing in this file may touch the developer's real
// ~/dev/designs/.groundwork-profile.json. V6 deliberately runs with recording ON
// (against its isolated store) because that is the ONLY configuration in which
// its mutation — an archive path that calls recordProfileDims — is observable:
// with recording off, recordProfileDims returns immediately and the check would
// be inert while still passing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER = path.join(ROOT, 'designer', 'canvas', 'canvas-server.mjs');

const SLOT = 'planner-warm-craft.html';
const MANIFEST = {
  screens: [{ id: 'planner', name: 'Planner' }],
  slots: [{
    screen_id: 'planner', screen_name: 'Planner', mode: 'warm-craft',
    html_path: SLOT, status: 'authored',
  }],
};

const BODY_A = '<!doctype html><main data-component="PlanInput"><button>ZZPRIORZZ plan today</button></main>';
const BODY_B = '<!doctype html><main data-component="PlanInput"><button>ZZNEXTZZ plan tonight</button></main>';

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url, child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error('gallery server exited early: ' + output());
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* booting */ }
    await delay(50);
  }
  throw new Error('gallery server did not start: ' + output());
}

async function waitUntil(check, message) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(typeof message === 'function' ? message() : message);
}

// Several tests here stop a server mid-test and are ALSO torn down by t.after,
// so this must be idempotent. `exitCode` alone is not enough: a process killed
// by a signal leaves exitCode null forever and reports signalCode instead, so an
// exitCode-only guard re-kills a corpse and then waits for an exit event that
// can never fire again.
async function terminateChild(child, label) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  let exited = false;
  const exit = new Promise((resolve) => {
    child.once('exit', () => { exited = true; resolve(); });
  });
  child.kill('SIGTERM');
  await Promise.race([exit, delay(750)]);
  if (!exited && child.exitCode == null && child.signalCode == null) {
    child.kill('SIGKILL');
    await Promise.race([exit, delay(2000)]);
  }
  if (!exited && child.exitCode == null && child.signalCode == null) throw new Error(label + ' did not exit during test cleanup');
}

/** A gallery dir with one manifest slot holding `body`. */
function makeGalleryDir(t, body = BODY_A) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-archive-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(MANIFEST));
  fs.writeFileSync(path.join(dir, SLOT), body);
  return dir;
}

function makeStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-archive-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'profile.json');
}

/** Boot gallery mode the way the documented launch does: foreign cwd, no
 *  inherited PYTHONPATH, isolated profile store. `recording` defaults to off. */
async function startGallery(t, galleryDir, { store, recording = false } = {}) {
  const port = await reservePort();
  const env = { ...process.env, GROUNDWORK_PROFILE_STORE: store };
  delete env.PYTHONPATH;
  if (recording) delete env.GROUNDWORK_PROFILE; else env.GROUNDWORK_PROFILE = 'off';
  const child = spawn(process.execPath, [
    SERVER, '--mode', 'gallery', '--dir', galleryDir,
    '--title', 'Archive test', '--port', String(port),
  ], { cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; });
  t.after(() => terminateChild(child, 'gallery server'));
  const base = 'http://127.0.0.1:' + port;
  await waitForServer(base, child, () => out + err);
  return { base, child, port, stdout: () => out, stderr: () => err, logs: () => out + err };
}

function post(base, row) {
  return fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
}

/** A fully-populated annotation: every field must survive archiving (V4). */
function richAnnotation(id = 'ann-archive-1') {
  return {
    id,
    marker: 'box',
    x: 0.42,
    y: 0.61,
    bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    target: {
      selector: '[data-component="PlanInput"]', component: 'PlanInput', tag: 'main',
      role: 'region', label: 'Planning input', text: 'ZZPRIORZZ plan today',
    },
    viewport: { width: 1280, height: 800 },
    document: { width: 1280, height: 1600 },
    comment: 'The summary panel should sit on the left and expand.',
    status: 'open',
  };
}

async function postAnnotation(base, annotation = richAnnotation()) {
  const response = await post(base, { kind: 'annotation', slot: SLOT, annotation });
  assert.equal(response.status, 200, 'annotation POST must succeed');
  return (await response.json()).annotation;
}

function selectionsOnDisk(galleryDir) {
  const file = path.join(galleryDir, '.canvas', 'gallery-selections.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function annotationsOnDisk(galleryDir) {
  const sel = selectionsOnDisk(galleryDir);
  return (sel && sel.annotations && sel.annotations[SLOT]) || [];
}

function archiveVersions(galleryDir, slot = SLOT) {
  const dir = path.join(galleryDir, '.canvas', 'archive', slot);
  try { return fs.readdirSync(dir).filter((name) => /^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(name)).sort(); } catch { return []; }
}

function feedbackRowCount(galleryDir) {
  try {
    return fs.readFileSync(path.join(galleryDir, '.canvas', 'feedback.jsonl'), 'utf-8')
      .trim().split('\n').filter(Boolean).length;
  } catch { return 0; }
}

/** Rewrite the slot with a guaranteed-later mtime. */
async function rewriteSlot(galleryDir, body, slot = SLOT) {
  await delay(60);
  fs.writeFileSync(path.join(galleryDir, slot), body);
}

/** Read the SSE stream into an array of frames. */
async function openEvents(t, base) {
  const controller = new AbortController();
  const response = await fetch(base + '/__canvas/events', { signal: controller.signal });
  const frames = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  t.after(() => controller.abort());
  (async () => {
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const line = chunk.split('\n').find((item) => item.startsWith('data: '));
          if (!line) continue;
          try { frames.push(JSON.parse(line.slice(6))); } catch { /* not a frame */ }
        }
      }
    } catch { /* aborted at teardown */ }
  })();
  await waitUntil(
    () => frames.some((frame) => frame && frame.type === 'hello'),
    'the SSE stream did not become ready before the fixture mutation',
  );
  return frames;
}

// ---------------------------------------------------------------------------
// V1 — a change made while the server was DOWN is archived on the next start.
// Falsifying mutation: delete the startup syncAllSlots call.
// ---------------------------------------------------------------------------
test('V1 a slot rewritten while the server was down is archived at next start', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);

  const first = await startGallery(t, galleryDir, { store });
  const created = await postAnnotation(first.base);
  assert.equal(created.status, 'open');
  assert.equal((await post(first.base, { kind: 'rate', slot: SLOT, rating: 'yay' })).status, 200);
  assert.equal((await post(first.base, { kind: 'pick', screen: 'planner', slot: SLOT })).status, 200);
  const feedbackBefore = feedbackRowCount(galleryDir);
  await terminateChild(first.child, 'gallery server');

  // The change happens with nothing watching — the common case for this defect.
  await rewriteSlot(galleryDir, BODY_B);

  const second = await startGallery(t, galleryDir, { store });
  const versions = archiveVersions(galleryDir);
  assert.equal(versions.length, 1, 'the startup sweep did not archive the retired version');

  const live = await (await fetch(second.base + '/__gallery/selections')).json();
  const records = live.annotations[SLOT];
  assert.equal(records.length, 1, 'archiving must not delete the record');
  assert.equal(records[0].status, 'archived');
  assert.equal(records[0].archivedFrom, versions[0]);
  assert.ok(Number.isFinite(Date.parse(records[0].archivedAt)), 'archivedAt must be a real date');
  assert.equal(records.filter((item) => item.status === 'open').length, 0,
    'the retired annotation is still open, so it would still render over the new design');
  assert.equal(live.ratings[SLOT], undefined, 'startup hash sweep kept a rating for superseded bytes');
  assert.equal(live.picks.planner, undefined, 'startup hash sweep kept a winner for superseded bytes');
  assert.equal(feedbackRowCount(galleryDir), feedbackBefore,
    'startup bookkeeping appended synthetic user feedback');

  const index = await (await fetch(second.base + '/__gallery/archive?slot=' + SLOT)).json();
  assert.equal(index.versions.length, 1);
  assert.equal(index.versions[0].provenance, 'content-hash');
  assert.equal(index.versions[0].annotations[0].comment, created.comment);
});

// ---------------------------------------------------------------------------
// V2 — an identical-bytes rewrite does NOT archive.
// Falsifying mutation: make decide() compare mtime instead of hash.
// ---------------------------------------------------------------------------
test('V2 an identical-bytes rewrite archives nothing', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const { base } = await startGallery(t, galleryDir, { store });
  await postAnnotation(base);
  assert.equal((await post(base, { kind: 'rate', slot: SLOT, rating: 'nay' })).status, 200);
  assert.equal((await post(base, { kind: 'pick', screen: 'planner', slot: SLOT })).status, 200);
  const feedbackBefore = feedbackRowCount(galleryDir);

  const frames = await openEvents(t, base);
  await rewriteSlot(galleryDir, BODY_A);   // same bytes, new mtime
  // The reload frame proves the poller actually saw the mtime change — without
  // this the test would pass simply by never having polled.
  await waitUntil(() => frames.some((frame) => frame.type === 'reload' && frame.path === SLOT),
    () => 'the poller never noticed the rewrite: ' + JSON.stringify(frames));
  await delay(200);

  assert.deepEqual(frames.filter((frame) => frame.type === 'archived'), [],
    'an identical-bytes rewrite broadcast an archived frame');
  assert.deepEqual(archiveVersions(galleryDir), [], 'an identical-bytes rewrite created an archive version');
  assert.equal(annotationsOnDisk(galleryDir)[0].status, 'open',
    'an identical-bytes rewrite retired a still-valid annotation');
  const choices = selectionsOnDisk(galleryDir);
  assert.equal(choices.ratings[SLOT], 'nay', 'identical bytes cleared the rating');
  assert.equal(choices.picks.planner, SLOT, 'identical bytes cleared the winner');
  assert.equal(feedbackRowCount(galleryDir), feedbackBefore,
    'the identical rewrite appended a synthetic feedback row');
});

test('V2b a content-hash change resets live choices and preserves append-only feedback', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const { base } = await startGallery(t, galleryDir, { store });

  assert.equal((await post(base, { kind: 'rate', slot: SLOT, rating: 'nay' })).status, 200);
  assert.equal((await post(base, { kind: 'pick', screen: 'planner', slot: SLOT })).status, 200);
  assert.equal((await post(base, { kind: 'note', slot: SLOT, text: 'Keep the old rationale.' })).status, 200);
  const feedbackBefore = feedbackRowCount(galleryDir);
  assert.equal(feedbackBefore, 3);

  const frames = await openEvents(t, base);
  await rewriteSlot(galleryDir, BODY_B);
  await waitUntil(() => {
    const selections = selectionsOnDisk(galleryDir);
    return selections && selections.ratings[SLOT] == null && selections.picks.planner == null;
  }, 'the proven content change did not clear the slot rating and winner');

  const selections = selectionsOnDisk(galleryDir);
  assert.equal(selections.notes[SLOT], 'Keep the old rationale.');
  assert.equal(feedbackRowCount(galleryDir), feedbackBefore,
    'version bookkeeping rewrote the append-only user feedback log');
  await waitUntil(
    () => frames.some((frame) => frame.type === 'archived' && frame.path === SLOT),
    'the live client was not told to refresh server-owned selection state',
  );
});

// ---------------------------------------------------------------------------
// V3 — the rendered overlay. A real headless browser, because "the annotation
// left the JSON" and "the marker left the screen" are different claims and only
// the second one is the defect the user saw.
// Falsifying mutation: point drawAnnotationMarkers back at annotationsForSlot.
// ---------------------------------------------------------------------------
function chromeExecutable() {
  return [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean).find((candidate) => fs.existsSync(candidate));
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('CDP connection closed'));
    pending.clear();
  });
  return {
    send(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }));
      socket.close();
      await Promise.race([closed, delay(500)]);
    },
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

test('V3 archived annotations leave the markers and the rail in a real browser', async (t) => {
  const chrome = chromeExecutable();
  if (!chrome) { t.skip('Chrome or Chromium is required for the rendered-overlay check'); return; }

  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-archive-chrome-'));
  let browser = null;
  let cdp = null;
  t.after(async () => {
    if (cdp) {
      try { await Promise.race([cdp.send('Browser.close'), delay(750)]); } catch { /* force-stop below */ }
      await cdp.close();
    }
    await terminateChild(browser, 'headless browser');
    fs.rmSync(chromeProfile, { recursive: true, force: true });
  });

  const { base } = await startGallery(t, galleryDir, { store });
  await postAnnotation(base);

  const debugPort = await reservePort();
  browser = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + debugPort,
    '--user-data-dir=' + chromeProfile, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserLogs = '';
  browser.stderr.on('data', (chunk) => { browserLogs += chunk; });

  let target;
  await waitUntil(async () => {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
      target = targets.find((item) => item.type === 'page');
      return !!target;
    } catch { return false; }
  }, () => 'headless browser did not expose a page: ' + browserLogs);
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: base });
  await waitUntil(
    async () => evaluate(cdp, "document.readyState === 'complete' && !!document.querySelector('.expand-btn')"),
    'gallery did not render an Expand action',
  );
  await evaluate(cdp, "document.querySelector('.expand-btn').click()");
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.viewer-frame')?.contentDocument?.querySelector('[data-component=PlanInput]')"),
    'expanded mockup iframe did not load',
  );

  // Baseline: the open annotation really is on screen, so its disappearance
  // below means something.
  await waitUntil(async () => await evaluate(cdp, `(() => {
    const frame = document.querySelector('.viewer-frame');
    return frame.contentDocument.querySelectorAll('[data-gw-annotation-id]').length === 1
      && document.querySelectorAll('.annotation-rail .annotation-item').length === 1;
  })()`), 'the open annotation never rendered in the first place');
  assert.equal(await evaluate(cdp, "!!document.querySelector('.prior-versions-toggle')"), false,
    'a slot with no history rendered a Prior versions disclosure');

  await rewriteSlot(galleryDir, BODY_B);
  await waitUntil(() => annotationsOnDisk(galleryDir)[0]?.status === 'archived',
    'the live rewrite never archived the annotation');

  // The claim: the retired critique is off the new design, in both surfaces.
  await waitUntil(async () => await evaluate(cdp, `(() => {
    const frame = document.querySelector('.viewer-frame');
    const doc = frame && frame.contentDocument;
    return !!doc && doc.querySelectorAll('[data-gw-annotation-id]').length === 0
      && document.querySelectorAll('.annotation-rail .annotation-item').length === 0;
  })()`), 'the archived annotation is still drawn over the rewritten design');

  assert.equal(await evaluate(cdp, `(() => {
    const rail = document.querySelector('.annotation-rail');
    const toggle = rail && rail.querySelector('.prior-versions-toggle');
    if (!toggle) return 'no disclosure in the rail';
    if (toggle.classList.contains('tool-btn')) return 'the disclosure took the tool-btn class';
    if (document.querySelector('.viewer-tools .prior-versions-toggle')) return 'the disclosure landed in the toolbar';
    if (document.querySelector('#gallery .prior-versions')) return 'the disclosure leaked into the compare grid';
    if (!/^Prior versions \\(1\\)$/.test(toggle.textContent)) return 'unexpected label: ' + toggle.textContent;
    const first = document.querySelector('.viewer-tools .tool-btn');
    if (first.textContent !== 'Annotate') return 'the first toolbar button is no longer Annotate';
    toggle.click();
    const comments = Array.from(rail.querySelectorAll('.prior-comments li')).map((li) => li.textContent);
    if (comments.length !== 1) return 'the disclosure listed ' + comments.length + ' comments';
    return comments[0];
  })()`), 'The summary panel should sit on the left and expand.');

  // The focus trap still cycles, with the disclosure inside it.
  assert.equal(await evaluate(cdp, `(() => {
    const viewer = document.getElementById('viewer');
    const focusable = Array.from(viewer.querySelectorAll(
      'button:not([disabled]), textarea:not([disabled]), iframe, [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (!focusable.includes(document.querySelector('.prior-versions-toggle'))) return 'disclosure outside the trap';
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    return document.activeElement === first ? 'wraps' : 'no wrap';
  })()`), 'wraps');

  const empty = await evaluate(cdp, "document.querySelector('.annotation-empty').textContent");
  assert.match(empty, /No annotations yet/, 'an archived-only slot must read as the existing empty state');
});

// ---------------------------------------------------------------------------
// V4 — every archived field is recoverable, byte-equal to the original.
// Falsifying mutation: drop `bounds` from the archive payload.
// ---------------------------------------------------------------------------
test('V4 archived annotations are recoverable field-for-field', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const { base } = await startGallery(t, galleryDir, { store });
  const created = await postAnnotation(base);

  await rewriteSlot(galleryDir, BODY_B);
  await waitUntil(() => annotationsOnDisk(galleryDir)[0]?.status === 'archived',
    'the live rewrite never archived the annotation');

  const version = archiveVersions(galleryDir)[0];
  const payload = await (await fetch(
    base + '/__gallery/archive?slot=' + SLOT + '&version=' + version)).json();
  assert.equal(payload.schema, 'groundwork.gallery-archive/v1');
  assert.equal(payload.slot, SLOT);
  assert.equal(payload.annotations.length, 1);

  // Everything the user gave us survives: only the three archive-status fields
  // may differ from the record as it stood before the rewrite.
  const archived = { ...payload.annotations[0] };
  assert.equal(archived.status, 'archived');
  assert.equal(archived.archivedFrom, version);
  delete archived.status; delete archived.archivedAt; delete archived.archivedFrom;
  const original = { ...created };
  delete original.status;
  assert.deepEqual(archived, original);
  // Named explicitly, because the falsifying mutation drops exactly this.
  assert.deepEqual(payload.annotations[0].bounds, created.bounds);
  assert.deepEqual(payload.annotations[0].target, created.target);
});

// ---------------------------------------------------------------------------
// V4b — the archived HTML is the TRUE PRIOR bytes, not the current ones.
// Falsifying mutation: write the snapshot from current bytes at archive time.
// This is the only check that catches it: every other row here is satisfied by
// an archive that stores whatever happens to be on disk when it runs.
// ---------------------------------------------------------------------------
test('V4b the archived HTML is the content the annotation was written against', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const { base } = await startGallery(t, galleryDir, { store });
  await postAnnotation(base);

  const priorBytes = fs.readFileSync(path.join(galleryDir, SLOT));
  const priorHash = sha256(priorBytes);
  await rewriteSlot(galleryDir, BODY_B);
  await waitUntil(() => annotationsOnDisk(galleryDir)[0]?.status === 'archived',
    'the live rewrite never archived the annotation');

  const version = archiveVersions(galleryDir)[0];
  const payload = await (await fetch(
    base + '/__gallery/archive?slot=' + SLOT + '&version=' + version)).json();
  assert.equal(payload.provenance, 'content-hash');
  assert.equal(payload.html, SLOT, 'the payload must name the archived HTML file');
  assert.equal(payload.hash, priorHash, 'the recorded hash is not the prior content hash');
  assert.equal(payload.supersededByHash, sha256(Buffer.from(BODY_B)));

  const htmlResponse = await fetch(
    base + '/__gallery/archive?slot=' + SLOT + '&version=' + version + '&file=html');
  assert.equal(htmlResponse.status, 200);
  const served = Buffer.from(await htmlResponse.arrayBuffer());
  assert.ok(served.includes('ZZPRIORZZ'), 'the archived HTML is missing the prior version sentinel');
  assert.ok(!served.includes('ZZNEXTZZ'), 'the archived HTML is the CURRENT content, not the prior version');
  assert.equal(sha256(served), priorHash);
  assert.equal(sha256(served), payload.hash);
});

// ---------------------------------------------------------------------------
// V5 — re-detecting the SAME content-hash change is idempotent, and
// re-archiving never truncates. Scope: the content-hash path only —
// findVersionForHash keys off the payload's `hash` field, which is null on
// an mtime-bootstrap archive, so a re-detected bootstrap is NOT covered by
// this guarantee and can create a second directory (see the plan's D5 note).
// Restores the exact crash window D5 describes: commitArchive completed, then
// the process died before the snapshot and version record were updated. The
// next start re-detects the SAME change and must find its own version already
// present rather than duplicating it.
// Falsifying mutation: remove findVersionForHash.
// ---------------------------------------------------------------------------
test('V5 re-detecting the same content-hash change is idempotent and loses nothing', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const ctrlDir = path.join(galleryDir, '.canvas');

  const first = await startGallery(t, galleryDir, { store });
  await postAnnotation(first.base);
  const priorBytes = fs.readFileSync(path.join(galleryDir, SLOT));
  const priorVersions = JSON.parse(fs.readFileSync(path.join(ctrlDir, 'slot-versions.json'), 'utf-8'));

  await rewriteSlot(galleryDir, BODY_B);
  await waitUntil(() => annotationsOnDisk(galleryDir)[0]?.status === 'archived',
    'the live rewrite never archived the annotation');
  const version = archiveVersions(galleryDir)[0];
  await terminateChild(first.child, 'gallery server');

  // Rewind the two files the crash window leaves stale.
  fs.writeFileSync(path.join(ctrlDir, 'slot-versions.json'), JSON.stringify(priorVersions));
  fs.writeFileSync(path.join(ctrlDir, 'current', SLOT), priorBytes);

  const second = await startGallery(t, galleryDir, { store });
  assert.deepEqual(archiveVersions(galleryDir), [version],
    're-detecting the same change created a second version directory');

  const payload = await (await fetch(
    second.base + '/__gallery/archive?slot=' + SLOT + '&version=' + version)).json();
  const ids = payload.annotations.map((item) => item.id);
  assert.deepEqual(ids, ['ann-archive-1'],
    'the recovery pass duplicated or truncated the archived annotations: ' + JSON.stringify(ids));

  const live = await (await fetch(second.base + '/__gallery/selections')).json();
  assert.equal(live.annotations[SLOT].length, 1);
  assert.equal(live.annotations[SLOT][0].status, 'archived');
});

// ---------------------------------------------------------------------------
// V5b — the continuation of the live case, which is where the bootstrap's
// version NAME becomes a hazard. A mtime-bootstrap has no prior bytes, so it
// names itself after the SUPERSEDING content (H2) — the only hash it has. The
// next real rewrite archives those same H2 bytes, so its candidate name ends in
// the same 8 hex. Resolving that by name hands the H2-era annotations to the
// bootstrap record: two versions' critique in one payload, the H2 bytes never
// written even though the snapshot holds them, and every live archivedFrom
// pointing at a directory that does not exist.
// Falsifying mutation: drop the payload-hash check in findVersionForHash.
// ---------------------------------------------------------------------------
test('V5b a bootstrap is not mistaken for the archive of the content it names', async (t) => {
  const galleryDir = makeGalleryDir(t, BODY_A);
  const store = makeStore(t);

  // A design dir that predates this feature: annotations on disk, written
  // before the file's mtime, and no .canvas bookkeeping at all.
  fs.mkdirSync(path.join(galleryDir, '.canvas'), { recursive: true });
  const stale = ['ann-stale-1', 'ann-stale-2'].map((id, index) => ({
    ...richAnnotation(id),
    comment: 'stale critique ' + index,
    createdAt: '2026-07-22T05:08:32.000Z', updatedAt: '2026-07-22T05:08:32.000Z',
  }));
  fs.writeFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), JSON.stringify({
    schema: 'groundwork.gallery-selections/v2', ratings: {}, picks: {}, notes: {}, annotations: { [SLOT]: stale },
  }));
  const after = new Date(Date.parse('2026-07-22T05:38:32.000Z'));
  fs.utimesSync(path.join(galleryDir, SLOT), after, after);

  const { base } = await startGallery(t, galleryDir, { store });
  const bootstrapVersions = archiveVersions(galleryDir);
  assert.equal(bootstrapVersions.length, 1, 'the pre-existing dir did not bootstrap');

  // The user annotates the design they are now looking at (BODY_A), then the
  // agent rewrites it again.
  const live = await postAnnotation(base, richAnnotation('ann-live'));
  assert.equal(live.status, 'open');
  await rewriteSlot(galleryDir, BODY_B);
  await waitUntil(() => annotationsOnDisk(galleryDir).find((item) => item.id === 'ann-live')?.status === 'archived',
    'the second rewrite never archived the live annotation');

  const versions = archiveVersions(galleryDir);
  assert.equal(versions.length, 2,
    'the content-hash archive was merged into the bootstrap dir instead of getting its own: ' + JSON.stringify(versions));

  const index = await (await fetch(base + '/__gallery/archive?slot=' + SLOT)).json();
  const bootstrap = index.versions.find((v) => v.provenance === 'mtime-bootstrap');
  const content = index.versions.find((v) => v.provenance === 'content-hash');
  assert.ok(bootstrap && content, 'expected one bootstrap and one content-hash version');

  // Disjoint: neither version claims the other's critique.
  assert.deepEqual(bootstrap.annotations.map((a) => a.id).sort(), ['ann-stale-1', 'ann-stale-2']);
  assert.deepEqual(content.annotations.map((a) => a.id), ['ann-live']);

  // The bytes ann-live was written against really are in the archive — the
  // snapshot held them, so "unrecoverable" would have been a lie.
  assert.equal(bootstrap.html, null, 'the bootstrap never saw the prior bytes and must say so');
  assert.equal(content.html, SLOT);
  assert.equal(content.hash, sha256(Buffer.from(BODY_A)));
  const served = await fetch(base + '/__gallery/archive?slot=' + SLOT + '&version=' + content.version + '&file=html');
  assert.equal(served.status, 200, 'the version link a user would click 404s');
  const bytes = Buffer.from(await served.arrayBuffer());
  assert.ok(bytes.includes('ZZPRIORZZ'), 'the archived HTML is not the content ann-live was written against');
  assert.equal(sha256(bytes), content.hash);

  // No live record may point at a directory that does not exist.
  for (const record of annotationsOnDisk(galleryDir)) {
    assert.equal(record.status, 'archived');
    assert.ok(fs.existsSync(path.join(galleryDir, '.canvas', 'archive', SLOT, record.archivedFrom)),
      `archivedFrom "${record.archivedFrom}" on ${record.id} names no directory`);
  }
  // ... and each record points at the version that actually holds it.
  const holder = (id) => index.versions.find((v) => v.annotations.some((a) => a.id === id)).version;
  for (const record of annotationsOnDisk(galleryDir)) {
    assert.equal(record.archivedFrom, holder(record.id), 'a live record points at the wrong version');
  }
});

// ---------------------------------------------------------------------------
// V5c — an archived record must not resurrect through the feedback route.
// A live archive can land while the user has an annotation editor open; their
// Save then carries the copy they loaded, which still says status:"open".
// ---------------------------------------------------------------------------
test('V5c re-saving an archived annotation does not flip it back to open', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const { base, stdout } = await startGallery(t, galleryDir, { store });
  const created = await postAnnotation(base);

  await rewriteSlot(galleryDir, BODY_B);
  await waitUntil(() => annotationsOnDisk(galleryDir)[0]?.status === 'archived',
    'the live rewrite never archived the annotation');
  const archived = annotationsOnDisk(galleryDir)[0];

  // A live archive moves a user's annotations off-screen as permanently as the
  // startup sweep does, so it owes the same one line on stdout.
  // Persistence and the child's stdout pipe arrive on separate event turns.
  await waitUntil(() => stdout().split('\n').includes(`canvas-server: archived 1 annotation(s) on ${SLOT} -> ${archived.archivedFrom}`),
    'the live archive left no server-side record');
  assert.equal(
    stdout().split('\n').filter((line) => line === `canvas-server: archived 1 annotation(s) on ${SLOT} -> ${archived.archivedFrom}`).length,
    1, 'the live archive left no server-side record: ' + JSON.stringify(stdout()));

  // Exactly what the client holds: the record as it was BEFORE the archive.
  const response = await post(base, { kind: 'annotation', slot: SLOT, annotation: { ...created, comment: 'edited while stale' } });
  assert.equal(response.status, 200);
  const echoed = (await response.json()).annotation;
  assert.equal(echoed.status, 'archived', 'the response resurrected a retired annotation');
  assert.equal(echoed.archivedFrom, archived.archivedFrom);
  assert.equal(echoed.archivedAt, archived.archivedAt);

  const onDisk = annotationsOnDisk(galleryDir);
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0].status, 'archived', 'a retired annotation is drawing over the new design again');
  assert.equal(onDisk[0].archivedFrom, archived.archivedFrom);

  const stillOpen = await (await fetch(base + '/__gallery/selections')).json();
  assert.equal(stillOpen.annotations[SLOT].filter((item) => item.status === 'open').length, 0);
});

// ---------------------------------------------------------------------------
// V6 — archiving is NOT a revealed preference: critique_focus must not re-fire,
// and feedback.jsonl must not gain a row (I2).
//
// Runs with recording ON against an isolated store, because recordProfileDims
// returns immediately when recording is off — with GROUNDWORK_PROFILE=off the
// mutation "call recordProfileDims from the archive path" is invisible and the
// check passes for the wrong reason. The rate POST at the end is a POSITIVE
// CONTROL proving the recorder really was alive and draining during the window
// the archive ran in; without it, a broken recorder would also "pass".
// ---------------------------------------------------------------------------
test('V6 archiving records no taste and appends no feedback row', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);

  // The annotation itself IS a revealed preference (critique_focus), so it is
  // made with recording off. Anything in the store afterwards can only have come
  // from the archive path.
  const first = await startGallery(t, galleryDir, { store });
  await postAnnotation(first.base);
  await terminateChild(first.child, 'gallery server');
  assert.equal(fs.existsSync(store), false, 'the setup boot recorded taste with recording off');

  const { base } = await startGallery(t, galleryDir, { store, recording: true });
  const rowsBefore = feedbackRowCount(galleryDir);

  await rewriteSlot(galleryDir, BODY_B);
  await waitUntil(() => annotationsOnDisk(galleryDir)[0]?.status === 'archived',
    'the live rewrite never archived the annotation');

  // The guarantee is stronger than "critique_focus specifically didn't
  // re-fire": no dimension of any kind was recorded. With recording on the
  // whole time, the profile store would already exist if archiving had
  // written ANYTHING to it — it does not yet, because nothing has.
  assert.equal(fs.existsSync(store), false,
    'archiving wrote to the profile store before any real profile event fired');

  // I2: the archive is derived from the rollup, never replayed as an event.
  assert.equal(feedbackRowCount(galleryDir), rowsBefore,
    'archiving appended a row to feedback.jsonl');

  // Positive control + drain barrier: this act DOES record, and the queue drains
  // in order, so once it has landed any archive-triggered record would have too.
  assert.equal((await post(base, { kind: 'rate', slot: SLOT, rating: 'yay' })).status, 200);
  await waitUntil(() => {
    try { return !!JSON.parse(fs.readFileSync(store, 'utf-8')).dimensions.design_mode_liked; }
    catch { return false; }
  }, 'the profile recorder never wrote anything, so this check could not observe a leak');

  const dimensions = JSON.parse(fs.readFileSync(store, 'utf-8')).dimensions;
  assert.equal(dimensions.critique_focus, undefined,
    'archiving re-fired critique_focus for an annotation the user made once, days ago');
  assert.ok(!fs.readFileSync(store, 'utf-8').includes(SLOT), 'a slot filename leaked into the profile');
});

// ---------------------------------------------------------------------------
// V7 — an archive that cannot be written costs a log line, never the gallery.
// Two failures, one per try/catch this chunk added, because each is the only
// thing standing between that failure and an exiting server:
//   (a) the live poller  — syncSlot throws; only archiveSlot's catch is in play
//   (b) the startup sweep — writeVersions throws OUTSIDE syncAllSlots' own
//       per-slot catch, so only the sweep's catch is in play
// ---------------------------------------------------------------------------
test('V7a a failing live archive logs once and keeps serving', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const { base, child, stderr } = await startGallery(t, galleryDir, { store });
  await postAnnotation(base);

  // A FILE where the archive engine needs a directory: the next commit throws.
  fs.mkdirSync(path.join(galleryDir, '.canvas', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(galleryDir, '.canvas', 'archive', SLOT), 'not a directory');

  const frames = await openEvents(t, base);
  await rewriteSlot(galleryDir, BODY_B);
  await waitUntil(() => frames.some((frame) => frame.type === 'reload' && frame.path === SLOT),
    'the poller stopped running after the archive failed');
  await delay(200);

  assert.equal(child.exitCode, null, 'the gallery server exited when an archive failed');
  const complaints = stderr().split('\n').filter((line) => line.includes('gallery archive failed'));
  assert.equal(complaints.length, 1, 'expected exactly one failure line, got: ' + JSON.stringify(complaints));

  // Nothing is lost and nothing is silently retired when the archive fails.
  const live = await (await fetch(base + '/__gallery/selections')).json();
  assert.equal(live.annotations[SLOT][0].status, 'open');

  assert.equal((await fetch(base)).status, 200);
  const feedback = await post(base, { kind: 'rate', slot: SLOT, rating: 'yay' });
  assert.equal(feedback.status, 200);
  assert.equal((await feedback.json()).ok, true);
});

test('V7b a failing startup archive logs once and keeps serving', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const ctrlDir = path.join(galleryDir, '.canvas');

  const first = await startGallery(t, galleryDir, { store });
  await postAnnotation(first.base);
  await terminateChild(first.child, 'gallery server');

  // slot-versions.json as a DIRECTORY: the sweep's own writeVersions call fails
  // after syncAllSlots has already returned, which is the one failure the
  // engine's per-slot try/catch cannot absorb.
  fs.rmSync(path.join(ctrlDir, 'slot-versions.json'), { force: true });
  fs.mkdirSync(path.join(ctrlDir, 'slot-versions.json', 'occupied'), { recursive: true });
  await rewriteSlot(galleryDir, BODY_B);

  const second = await startGallery(t, galleryDir, { store });
  const complaints = second.stderr().split('\n').filter((line) => line.includes('archive sweep failed'));
  assert.equal(complaints.length, 1, 'expected exactly one failure line, got: ' + JSON.stringify(complaints));

  assert.equal(second.child.exitCode, null, 'the gallery server exited when the startup sweep failed');
  assert.equal((await fetch(second.base)).status, 200);
  const selections = await (await fetch(second.base + '/__gallery/selections')).json();
  assert.equal(selections.annotations[SLOT].length, 1, 'the failed sweep lost an annotation');

  const feedback = await post(second.base, { kind: 'rate', slot: SLOT, rating: 'yay' });
  assert.equal(feedback.status, 200);
  assert.equal((await feedback.json()).ok, true);
});

// ---------------------------------------------------------------------------
// V8 — the read route rejects traversal in both slot and version.
// Falsifying mutation: loosen SLOT_RE to allow '/'.
// ---------------------------------------------------------------------------
test('V8 the archive route rejects traversal in slot and version', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const { base } = await startGallery(t, galleryDir, { store });
  await postAnnotation(base);
  await rewriteSlot(galleryDir, BODY_B);
  await waitUntil(() => annotationsOnDisk(galleryDir)[0]?.status === 'archived',
    'the live rewrite never archived the annotation');
  const version = archiveVersions(galleryDir)[0];

  for (const slot of ['', '..', '../manifest.json', 'a/b.html', '/etc/passwd', '.hidden',
    '..%2Fmanifest.json', 'slot name.html']) {
    const url = base + '/__gallery/archive?slot=' + encodeURIComponent(slot);
    assert.equal((await fetch(url)).status, 400, 'slot was accepted: ' + JSON.stringify(slot));
  }
  for (const bad of ['..', '../../etc', '20260722T051056Z-3f9a1c2', '20260722T051056Z-3F9A1C2B',
    'latest', version + '/../..']) {
    const url = base + '/__gallery/archive?slot=' + SLOT + '&version=' + encodeURIComponent(bad);
    assert.equal((await fetch(url)).status, 400, 'version was accepted: ' + JSON.stringify(bad));
    const htmlUrl = url + '&file=html';
    assert.equal((await fetch(htmlUrl)).status, 400, 'version was accepted for file=html: ' + JSON.stringify(bad));
  }

  // Well-formed but absent is 404, not 400 and not a leak.
  assert.equal((await fetch(base + '/__gallery/archive?slot=' + SLOT + '&version=20260101T000000Z-deadbeef')).status, 404);
  assert.equal((await fetch(base + '/__gallery/archive?slot=' + SLOT + '&version=' + version + '&file=html')).status, 200);
  // A slot with no history is a valid, empty answer — and the route deliberately
  // does not require the slot to be in manifest.json (D6).
  const unknown = await fetch(base + '/__gallery/archive?slot=never-seen.html');
  assert.equal(unknown.status, 200);
  assert.deepEqual((await unknown.json()).versions, []);
});

// ---------------------------------------------------------------------------
// V9 — a startup that only SEEDS writes no selections file (invariant I1).
// Falsifying mutation: write selections unconditionally at startup.
// ---------------------------------------------------------------------------
test('V9 a seeding startup writes no selections file', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const store = makeStore(t);
  const { base } = await startGallery(t, galleryDir, { store });

  assert.equal(fs.existsSync(path.join(galleryDir, '.canvas', 'gallery-selections.json')), false,
    'the startup sweep created gallery-selections.json on a boot that only seeded');
  assert.deepEqual(archiveVersions(galleryDir), [], 'a seeding boot archived something');

  // It did record the bookkeeping it needs to detect the NEXT change, though —
  // "wrote nothing" would be a different bug wearing the same green check.
  const versions = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'slot-versions.json'), 'utf-8'));
  assert.equal(versions.slots[SLOT].hash, sha256(Buffer.from(BODY_A)));
  assert.equal(fs.readFileSync(path.join(galleryDir, '.canvas', 'current', SLOT), 'utf-8'), BODY_A);

  const live = await (await fetch(base + '/__gallery/selections')).json();
  assert.deepEqual(live.annotations, {});
});

// ---------------------------------------------------------------------------
// E2E — the observed defect, reproduced in shape: six open annotations written
// minutes before a rewrite, on a design dir that predates this feature (so
// there is no recorded hash and no snapshot — the mtime-bootstrap path, D3).
//
// A replica rather than a copy of the real design dir on purpose: the live
// repro lives outside this repo and carries the user's own words, and a suite
// that reads a personal absolute path is not a test, it is a local ritual. Shape
// preserved exactly: slot name, six status:"open" records, updatedAt minutes
// before the file mtime, no prior bytes recoverable.
// ---------------------------------------------------------------------------
test('E2E six annotations against a since-rewritten mockup archive on first sight', async (t) => {
  const slot = 'daily-digest-warm-craft.html';
  const galleryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-archive-e2e-'));
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  const store = makeStore(t);

  fs.writeFileSync(path.join(galleryDir, 'manifest.json'), JSON.stringify({
    screens: [{ id: 'daily-digest', name: 'Daily Digest' }],
    slots: [{ screen_id: 'daily-digest', screen_name: 'Daily Digest', mode: 'warm-craft', html_path: slot, status: 'authored' }],
  }));
  fs.writeFileSync(path.join(galleryDir, slot), '<!doctype html><main data-component="LeadStory">rewritten</main>');

  // SYNTHETIC, deliberately. The shape is what this test needs — six comments,
  // the same rough lengths, the same apostrophes and lowercase-start
  // irregularities a person actually types — so the byte-identity assertion
  // below still means something. The real critique that produced this defect is
  // the user's own product writing and does not belong in a committed fixture.
  const comments = [
    'The summary panel should sit on the left and expand when opened.',
    'Audio player belongs at the top',
    'Related items can go on the right or below',
    'these cards should keep the lead item and then list focus areas',
    "Drop this, it doesn't earn space",
    "The section heading doesn't need to be repeated twice in one column",
  ];
  const base0 = Date.parse('2026-07-22T05:08:32.000Z');
  fs.mkdirSync(path.join(galleryDir, '.canvas'), { recursive: true });
  fs.writeFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), JSON.stringify({
    schema: 'groundwork.gallery-selections/v2', ratings: {}, picks: {}, notes: {},
    annotations: {
      [slot]: comments.map((comment, index) => ({
        ...richAnnotation('ann-' + index), comment,
        createdAt: new Date(base0 + index * 20000).toISOString(),
        updatedAt: new Date(base0 + index * 20000).toISOString(),
      })),
    },
  }));
  // The rewrite happened after every annotation — which is the only evidence
  // available on a first run, and exactly what D3 keys off.
  const after = new Date(base0 + 30 * 60 * 1000);
  fs.utimesSync(path.join(galleryDir, slot), after, after);

  const { base } = await startGallery(t, galleryDir, { store });

  const live = await (await fetch(base + '/__gallery/selections')).json();
  const records = live.annotations[slot];
  assert.equal(records.length, 6, 'archiving deleted a record');
  assert.equal(records.filter((item) => item.status === 'open').length, 0,
    'stale annotations still render as open over the rewritten design');

  const index = await (await fetch(base + '/__gallery/archive?slot=' + slot)).json();
  assert.equal(index.versions.length, 1);
  const payload = index.versions[0];
  assert.equal(payload.provenance, 'mtime-bootstrap');
  assert.equal(payload.html, null, 'the prior bytes were never captured and the payload must say so');
  assert.equal(payload.hash, null);
  assert.deepEqual(payload.annotations.map((item) => item.comment), comments,
    'a comment was altered or lost on the way into the archive');
  // No prior HTML to serve on this path, and the route must say 404 rather than
  // serve the current file as though it were the archived one.
  assert.equal((await fetch(base + '/__gallery/archive?slot=' + slot
    + '&version=' + payload.version + '&file=html')).status, 404);
});
