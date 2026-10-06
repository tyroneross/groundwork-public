// test_project_pane_browser.mjs — C9 acceptance (T-12): the Groundwork project
// pane in headless Chrome over raw CDP (no Playwright/Puppeteer), at 1280x900
// and 390x844. Missing Chrome FAILS (scripts/check.sh treats skips as failures).
// Every run uses a temp repo with synthetic data and the real project server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { projectStore } from '../project/project-store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER = path.join(ROOT, 'designer', 'project', 'project-server.mjs');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function chromeExecutable() {
  return [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean).find((candidate) => fs.existsSync(candidate));
}

async function waitUntil(check, message, attempts = 120, step = 75) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await delay(step);
  }
  throw new Error(message);
}

async function terminate(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(750)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method && listeners.has(message.method)) for (const fn of listeners.get(message.method)) fn(message.params);
    if (!message.id || !pending.has(message.id)) return;
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, fn) { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); },
    off(method) { listeners.delete(method); },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) {
    throw new Error(`${response.exceptionDetails.text}: ${response.exceptionDetails.exception?.description || ''}`);
  }
  return response.result.value;
}

function pyEnv() { return { ...process.env, PYTHONPATH: ROOT }; }

function py(args) {
  const r = spawnSync('python3', args, { cwd: ROOT, env: pyEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, `python3 ${args.join(' ')} failed: ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function makeRepo() {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-pane-browser-')));
  py(['-m', 'designer.decisions.decisions_build', 'init', repo, '--slug', 'demo', '--template', 'compare']);
  // Workspace with 2 alternatives, written through the JS library.
  const store = projectStore(repo, { tool: 'pane-test' });
  store.changeWorkspace((ws) => {
    ws.alternatives.push(
      { id: 'alt-one', rationale: 'Alternative one rationale', createdAt: '2026-10-01T10:00:00.000Z' },
      { id: 'alt-two', rationale: 'Alternative two rationale', createdAt: '2026-10-01T11:00:00.000Z' },
    );
    ws.selectedId = 'alt-one';
  });
  // Canvas: journal + page in the canvas control dir (the store projects the
  // *.html inside it) and the page the canvas server would serve beside it.
  const canvas = path.join(repo, 'mockups', '.canvas');
  fs.mkdirSync(canvas, { recursive: true });
  const page = '<!doctype html><title>Canvas page</title><h1>Canvas page</h1>';
  fs.writeFileSync(path.join(repo, 'mockups', 'page.html'), page);
  fs.writeFileSync(path.join(canvas, 'page.html'), page);
  fs.writeFileSync(path.join(canvas, 'feedback.jsonl'), [
    { ts: '2026-10-01T09:00:00.000Z', id: 'c1', kind: 'comment', text: 'Canvas note one' },
    { ts: '2026-10-01T09:01:00.000Z', id: 'c2', kind: 'comment', text: 'Canvas note two' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  // Spec file the startup migration records as a pointer.
  fs.mkdirSync(path.join(repo, '.designdoc'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.designdoc', 'spec.json'), '{"name":"synthetic spec"}\n');
  return repo;
}

async function startServer(repo) {
  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER, '--repo', repo, '--port', String(port)], {
    cwd: ROOT, env: pyEnv(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (c) => { logs += c; });
  child.stderr.on('data', (c) => { logs += c; });
  await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`server exited: ${logs}`);
    return /Groundwork project: http:\/\/localhost:\d+\//.test(logs);
  }, 'project server did not start');
  const url = logs.match(/Groundwork project: (http:\/\/localhost:\d+)\//)[1];
  return { child, url, logs: () => logs };
}

const VIEWPORTS = [
  { name: '1280x900', width: 1280, height: 900, mobile: false },
  { name: '390x844', width: 390, height: 844, mobile: true },
];

let chrome;
let profile;
let browser;
let cdp;

test.before(async () => {
  chrome = chromeExecutable();
  assert.ok(chrome, 'Chrome or Chromium is required (set CHROME_BIN); this test must not skip');
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-pane-chrome-'));
  const debugPort = await reservePort();
  browser = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,900', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserLogs = '';
  browser.stderr.on('data', (c) => { browserLogs += c; });
  let target;
  await waitUntil(async () => {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = targets.find((item) => item.type === 'page');
      return Boolean(target);
    } catch { return false; }
  }, `browser did not expose CDP: ${browserLogs}`);
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
});

test.after(async () => {
  if (cdp) {
    try { await cdp.send('Browser.close'); } catch { /* force stop below */ }
    cdp.close();
  }
  await terminate(browser);
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});

const $ = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (sel) => evaluate(cdp, `(${$(sel)} || {}).textContent || ''`);
const click = (sel) => evaluate(cdp, `(() => { const el = ${$(sel)}; if (!el) throw new Error('no ${sel}'); el.click(); return true; })()`);

async function goto(url) {
  await cdp.send('Page.navigate', { url });
  await waitUntil(() => evaluate(cdp, "document.readyState === 'complete' && !!document.querySelector('.section-tab[aria-current=\"page\"]')"), `pane did not render at ${url}`);
}

async function openSection(base, section) {
  await evaluate(cdp, `location.hash = ${JSON.stringify('#' + section)}`);
  await waitUntil(() => evaluate(cdp, `${$('.section-tab[aria-current="page"]')}?.dataset.section === ${JSON.stringify(section)}`), `tab ${section} not current`);
}

async function bodyHas(needle, message, attempts = 120) {
  await waitUntil(() => evaluate(cdp, `document.body.innerText.includes(${JSON.stringify(needle)})`), message || `page never showed ${needle}`, attempts);
}

async function typeInto(sel, value) {
  await evaluate(cdp, `${$(sel)}.focus()`);
  await cdp.send('Input.insertText', { text: value });
}

async function checkLayout(vp, label) {
  const r = await evaluate(cdp, `(() => {
    const small = [];
    for (const el of document.querySelectorAll('button, a, select, textarea')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      if (b.height < 44) small.push((el.id || el.className || el.tagName) + ':' + Math.round(b.height * 10) / 10);
    }
    return { small, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
  })()`);
  assert.deepEqual(r.small, [], `${label} (${vp.name}): targets under 44px`);
  if (vp.mobile) assert.ok(r.scrollWidth <= r.innerWidth, `${label} (${vp.name}): horizontal overflow ${r.scrollWidth} > ${r.innerWidth}`);
}

for (const vp of VIEWPORTS) {
  test(`project pane at ${vp.name}: sections, draft/Done, board, workspace, memory, layout`, async (t) => {
    const repo = makeRepo();
    const srv = await startServer(repo);
    t.after(async () => { await terminate(srv.child); fs.rmSync(repo, { recursive: true, force: true }); });
    const base = srv.url;
    const tag = vp.mobile ? 'mobile' : 'desktop';

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile,
    });

    // ---- 5 sections reachable by hash, each rendering real data ----------
    await goto(`${base}/#decisions`);
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".section-tab").length'), 5);
    await bodyHas('Boards');
    const demoTitle = await evaluate(cdp, `${$('#section-body .row-title')}.textContent`);
    assert.ok(demoTitle.length > 0);
    assert.match(await text('#section-body'), /\d+ open · \d+ ruled/);
    await checkLayout(vp, 'decisions');

    await openSection(base, 'canvas');
    await bodyHas('2 canvas notes');
    assert.equal(await evaluate(cdp, `${$('iframe.frame-canvas')}.getAttribute('src')`), '/canvas/file');
    assert.equal((await fetch(`${base}/canvas/file`)).status, 200);
    await checkLayout(vp, 'canvas');

    await openSection(base, 'saved-work');
    await bodyHas('Alternative one rationale');
    assert.match(await text('#section-body'), /Alternative two rationale/);
    await checkLayout(vp, 'saved-work');

    await openSection(base, 'spec');
    await bodyHas('.designdoc/spec.json');
    await checkLayout(vp, 'spec');

    await openSection(base, 'memory');
    await bodyHas('No preferences recorded.');
    await checkLayout(vp, 'memory');

    // ---- draft: type -> "Draft saved" within 3s, store shows draft ---------
    await openSection(base, 'decisions');
    const draftText = `Pane ${tag} draft comment`;
    await typeInto('#composer-text', draftText);
    await waitUntil(() => evaluate(cdp, `${$('#composer-line')}.textContent.startsWith('Draft saved')`), 'save line never read "Draft saved"', 40, 75);
    let items = (await (await fetch(`${base}/api/feedback`)).json()).items;
    let mine = items.filter((f) => f.text === draftText);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, 'draft');
    assert.equal(mine[0].section, 'decisions');

    // ---- reload: draft restored ---------------------------------------------
    await cdp.send('Page.reload');
    await waitUntil(() => evaluate(cdp, `document.readyState === 'complete' && ${$('#composer-text')}.value === ${JSON.stringify(draftText)}`), 'draft text not restored after reload');
    assert.match(await text('#composer-line'), /^Draft saved/);

    // ---- Done: "Sent", listed under another section with All sections -------
    await click('#composer-done');
    await waitUntil(() => evaluate(cdp, `${$('#composer-line')}.textContent.startsWith('Sent')`), 'save line never read "Sent"');
    await openSection(base, 'memory');
    await waitUntil(() => evaluate(cdp, `${$('.btn-toggle[data-scope="all"]')}.getAttribute('aria-pressed') === 'true'`), 'All sections not pressed');
    await bodyHas(draftText);
    assert.match(await text('#notes-list'), /Decisions/);
    const cli = JSON.parse(py(['-m', 'designer.project', 'read', '--repo', repo, '--json']));
    assert.ok(JSON.stringify(cli).includes(draftText), 'CLI read --json lacks the sent note');
    const sent = (await (await fetch(`${base}/api/feedback`)).json()).items.find((f) => f.text === draftText);
    assert.equal(sent.status, 'submitted');
    // "This section" filter hides it on another section.
    await click('.btn-toggle[data-scope="section"]');
    assert.ok(!(await text('#notes-list')).includes(draftText));
    await click('.btn-toggle[data-scope="all"]');

    // ---- board from Decisions: iframe loads, record.json 200 ------------------
    await openSection(base, 'decisions');
    await click('[data-action="open-board"]');
    await waitUntil(() => evaluate(cdp, `(() => { const f = ${$('iframe.frame-board')}; return !!f && f.contentDocument && f.contentDocument.readyState === 'complete' && f.contentDocument.body && f.contentDocument.body.innerText.length > 20; })()`), 'board iframe did not load', 160);
    assert.equal(await evaluate(cdp, `${$('iframe.frame-board')}.getAttribute('src')`), '/decisions/demo/');
    const recStatus = await evaluate(cdp, `(() => { const e = ${$('iframe.frame-board')}.contentWindow.performance.getEntriesByType('resource').find((r) => r.name.endsWith('/decisions/demo/record.json')); return e ? e.responseStatus : null; })()`);
    assert.ok(recStatus === 200 || recStatus === null, `record.json status ${recStatus}`);
    assert.equal((await fetch(`${base}/decisions/demo/record.json`)).status, 200);
    await checkLayout(vp, 'board open');
    await click('[data-action="close-board"]');
    await bodyHas('Boards');

    // ---- ruling written to the board shows in "Latest answers" after a poll ----
    const rec = await (await fetch(`${base}/decisions/demo/record.json`)).json();
    assert.ok(!(await text('#section-body')).includes('Latest answers'));
    rec.compares[0].ruling = 'approve-b';
    rec.compares[0].ruledAt = new Date().toISOString();
    const put = await fetch(`${base}/decisions/demo/record.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec, null, 2),
    });
    assert.equal(put.status, 200);
    await bodyHas('Latest answers', 'ruling never reached Latest answers after a poll', 160);
    assert.match(await text("#section-body"), /Approve B/);

    // ---- Use this design changes the selection --------------------------------
    await openSection(base, 'saved-work');
    await bodyHas('Use this design');
    await checkLayout(vp, 'saved-work with action');
    await click('[data-action="select-design"]');
    await waitUntil(() => evaluate(cdp, `document.querySelectorAll('.row-title')[1].textContent.includes('selected')`), 'second design never showed as selected');
    const ws = JSON.parse(fs.readFileSync(path.join(repo, '.groundwork', 'workspace.json'), 'utf8'));
    assert.equal(ws.selectedId, 'alt-two');

    // ---- Memory: add a preference ---------------------------------------------
    await openSection(base, 'memory');
    const pref = `Prefer calm density (${tag})`;
    await typeInto('#pref-text', pref);
    await checkLayout(vp, 'memory form');
    await click('#pref-form button[type="submit"]');
    await bodyHas(pref);
    assert.match(await text('#pref-line'), /^Saved/);
    const contract = await (await fetch(`${base}/api/project`)).json();
    assert.ok(contract.sections.memory.preferences.some((p) => p.text === pref));

    // ---- final layout sweep -----------------------------------------------------
    for (const s of ['decisions', 'canvas', 'saved-work', 'spec', 'memory']) {
      await openSection(base, s);
      await checkLayout(vp, `final ${s}`);
    }
  });
}


test('composer and preference form keep what the person typed (review regressions)', async () => {
  const repo = makeRepo();
  const srv = await startServer(repo);
  try {
    const base = srv.url;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await goto(`${base}/#decisions`);

    // 1. An older draft save that lands last must not put old text back.
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/feedback/fb_*', requestStage: 'Request' }] });
    const held = [];
    cdp.on('Fetch.requestPaused', (p) => {
      if (p.request.method === 'PUT' && held.length === 0) { held.push(p.requestId); return; }
      cdp.send('Fetch.continueRequest', { requestId: p.requestId });
    });
    await typeInto('#composer-text', 'first words');
    await waitUntil(() => held.length === 1, 'first draft save never started', 60);
    await typeInto('#composer-text', ' and the newer ending');
    await new Promise((r) => setTimeout(r, 900));
    await cdp.send('Fetch.continueRequest', { requestId: held[0] });
    const want = 'first words and the newer ending';
    await waitUntil(async () => {
      const items = (await (await fetch(`${base}/api/feedback?status=draft`)).json()).items;
      return items.length === 1 && items[0].text === want;
    }, 'the store did not end with the newest draft text', 120);
    await new Promise((r) => setTimeout(r, 400));
    const items = (await (await fetch(`${base}/api/feedback?status=draft`)).json()).items;
    assert.equal(items[0].text, want, 'an older request overwrote newer text');
    await cdp.send('Fetch.disable'); cdp.off('Fetch.requestPaused');

    // 2. Done, then a new comment in another section before the submit returns.
    await waitUntil(() => evaluate(cdp, `${$('#composer-line')}.textContent.startsWith('Draft saved')`), 'draft not saved before Done', 60);
    await click('#composer-done');
    await evaluate(cdp, `location.hash = '#canvas'`);
    await typeInto('#composer-text', 'canvas comment typed meanwhile');
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await evaluate(cdp, `${$('#composer-text')}.value`), 'canvas comment typed meanwhile', 'a finished submit erased the new comment');
    const sent = (await (await fetch(`${base}/api/feedback?status=submitted`)).json()).items;
    assert.ok(sent.some((f) => f.text === want && f.section === 'decisions'));

    // 3. A poll must not wipe a preference being written once focus leaves the textarea.
    await evaluate(cdp, `location.hash = '#memory'`);
    await waitUntil(() => evaluate(cdp, `!!${$('#pref-text')}`), 'memory form missing');
    await typeInto('#pref-text', 'Keep navigation on the left');
    await evaluate(cdp, `${$('#pref-scope')}.focus()`);
    await new Promise((r) => setTimeout(r, 5000));
    assert.equal(await evaluate(cdp, `${$('#pref-text')}.value`), 'Keep navigation on the left', 'a poll wiped the preference text');
  } finally {
    await terminate(srv.child);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
