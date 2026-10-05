import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER = path.join(ROOT, 'designer', 'canvas', 'canvas-server.mjs');

// Gallery mode compounds picks/ratings/annotations into the CROSS-SESSION taste
// profile at ~/dev/designs/.groundwork-profile.json. This suite POSTs several
// annotations on fixture components, and three confirmations settle a dimension
// (profile.py _SETTLED_AT) — so without this opt-out, running the test suite
// would write fake taste into the developer's real, global profile. Recording
// itself is covered by designer/tests/test_gallery_profile.mjs, against an
// isolated store.
const GALLERY_TEST_ENV = { ...process.env, GROUNDWORK_PROFILE: 'off' };

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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(message);
}

async function terminateChild(child, label) {
  if (!child || child.exitCode != null) return;
  let exited = false;
  const exit = new Promise((resolve) => {
    child.once('exit', () => { exited = true; resolve(); });
  });
  child.kill('SIGTERM');
  await Promise.race([exit, delay(750)]);
  if (!exited && child.exitCode == null) {
    child.kill('SIGKILL');
    await Promise.race([exit, delay(2000)]);
  }
  if (!exited && child.exitCode == null) throw new Error(label + ' did not exit during test cleanup');
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
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
  const response = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

test('gallery exposes full-view tools and persists element annotations', async (t) => {
  const galleryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-gallery-'));
  t.after(() => fs.rmSync(galleryDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(galleryDir, 'manifest.json'), JSON.stringify({
    screens: [{ id: 'planner', name: 'Planner' }],
    slots: [{
      screen_id: 'planner', screen_name: 'Planner', mode: 'glass-workspace',
      html_path: 'planner-glass-workspace.html', status: 'authored',
    }],
  }));
  fs.writeFileSync(
    path.join(galleryDir, 'planner-glass-workspace.html'),
    '<!doctype html><main data-component="PlanInput"><button>Plan today</button></main>',
  );

  const port = await reservePort();
  const child = spawn(process.execPath, [
    SERVER, '--mode', 'gallery', '--dir', galleryDir,
    '--title', 'Gallery test', '--port', String(port),
  ], { cwd: ROOT, env: GALLERY_TEST_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(() => { if (child.exitCode == null) child.kill('SIGTERM'); });

  const base = 'http://127.0.0.1:' + port;
  await waitForServer(base, child, () => logs);

  const shell = await (await fetch(base)).text();
  assert.match(shell, /'Expand'/);
  assert.match(shell, /'Annotate'/);
  assert.match(shell, /← Previous/);
  assert.match(shell, /Next →/);
  assert.match(shell, /Exit full view/);
  assert.match(shell, /Mockup review/);
  assert.match(shell, /Keep this direction/);
  assert.match(shell, /Comment on this mockup/);
  assert.match(shell, /Select winner/);
  assert.match(shell, /Saved automatically/);
  assert.match(shell, /Archive reviewed/);
  assert.match(shell, /Reviewed \(/);
  assert.match(shell, /Review again/);
  assert.match(shell, /Gallery connection lost/);
  assert.match(shell, /preview-shell/);
  const health = await (await fetch(base + '/__gallery/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'gallery');
  assert.equal(health.pid, child.pid);
  assert.equal(health.port, port);
  assert.equal(health.instance, null, 'direct gallery starts have no launcher instance');
  const scriptBlocks = Array.from(shell.matchAll(/<script>([\s\S]*?)<\/script>/g));
  assert.ok(scriptBlocks.length > 0, 'gallery shell must contain a client script');
  try {
    new vm.Script(scriptBlocks.at(-1)[1], { filename: 'groundwork-gallery-client.js' });
  } catch (error) {
    assert.fail(error.stack);
  }

  const initial = await (await fetch(base + '/__gallery/selections')).json();
  assert.equal(initial.schema, 'groundwork.gallery-selections/v2');
  assert.deepEqual(initial.annotations, {});
  assert.deepEqual(initial.reviewArchive, {});
  assert.deepEqual(initial.reviewReopen, {});

  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-gallery-outside-'));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outsideDir, 'private.html'), 'outside gallery root');
  fs.symlinkSync(path.join(outsideDir, 'private.html'), path.join(galleryDir, 'linked.html'));
  const linkedResponse = await fetch(base + '/__gallery/slot?path=linked.html');
  assert.equal(linkedResponse.status, 403);

  const emptyCommentResponse = await fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'annotation', slot: 'planner-glass-workspace.html',
      annotation: { id: 'ann-empty', marker: 'dot', x: 0.5, y: 0.5, comment: '  ' },
    }),
  });
  assert.equal(emptyCommentResponse.status, 422);

  const annotation = {
    id: 'ann-test', marker: 'box', x: 2, y: -1,
    bounds: { x: 0.75, y: 0.25, width: 2, height: 1 },
    target: {
      selector: '[data-component="PlanInput"]', component: 'PlanInput',
      tag: 'SECTION', role: 'region', label: 'Planning input', text: 'Plan today',
    },
    viewport: { width: 1280, height: 800 },
    document: { width: 1280, height: 1600 },
    comment: '  Make this the single dominant action.  ', status: 'open',
  };
  const createdResponse = await fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'annotation', slot: 'planner-glass-workspace.html', annotation }),
  });
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();
  assert.equal(created.annotation.id, 'ann-test');
  assert.equal(created.annotation.marker, 'box');
  assert.equal(created.annotation.x, 1);
  assert.equal(created.annotation.y, 0);
  assert.deepEqual(created.annotation.bounds, { x: 0.75, y: 0.25, width: 0.25, height: 0.75 });
  assert.equal(created.annotation.target.tag, 'section');
  assert.equal(created.annotation.comment, 'Make this the single dominant action.');
  assert.ok(created.annotation.createdAt);

  const updatedResponse = await fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'annotation', slot: 'planner-glass-workspace.html',
      annotation: { ...created.annotation, x: 0.5, comment: 'Use one clear voice or text input.' },
    }),
  });
  const updated = await updatedResponse.json();
  assert.equal(updated.annotation.createdAt, created.annotation.createdAt);
  assert.equal(updated.annotation.comment, 'Use one clear voice or text input.');

  const persisted = await (await fetch(base + '/__gallery/selections')).json();
  assert.equal(persisted.annotations['planner-glass-workspace.html'].length, 1);
  assert.equal(persisted.annotations['planner-glass-workspace.html'][0].x, 0.5);

  const deleteResponse = await fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'annotation-delete', slot: 'planner-glass-workspace.html', annotationId: 'ann-test',
    }),
  });
  assert.equal(deleteResponse.status, 200);
  const afterDelete = await (await fetch(base + '/__gallery/selections')).json();
  assert.deepEqual(afterDelete.annotations['planner-glass-workspace.html'], []);

  const emptyArchiveResponse = await fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'archive-review', slot: 'planner-glass-workspace.html', text: '' }),
  });
  assert.equal(emptyArchiveResponse.status, 409);
  const invalidArchiveResponse = await fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'archive-review', slot: '../outside.html', text: 'reviewed' }),
  });
  assert.equal(invalidArchiveResponse.status, 422);

  const rateResponse = await fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'rate', slot: 'planner-glass-workspace.html', rating: 'yay' }),
  });
  assert.equal(rateResponse.status, 200);
  const archiveResponse = await fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'archive-review', slot: 'planner-glass-workspace.html', text: 'Reviewed and done.',
    }),
  });
  assert.equal(archiveResponse.status, 200);
  const archivedResult = await archiveResponse.json();
  assert.ok(archivedResult.reviewArchive.archivedAt);
  const afterArchive = await (await fetch(base + '/__gallery/selections')).json();
  assert.equal(afterArchive.notes['planner-glass-workspace.html'], 'Reviewed and done.');
  assert.deepEqual(afterArchive.reviewArchive['planner-glass-workspace.html'], archivedResult.reviewArchive);

  const restoreResponse = await fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'restore-review', slot: 'planner-glass-workspace.html' }),
  });
  assert.equal(restoreResponse.status, 200);
  const afterRestore = await (await fetch(base + '/__gallery/selections')).json();
  assert.equal(afterRestore.reviewArchive['planner-glass-workspace.html'], undefined);
  assert.equal(afterRestore.ratings['planner-glass-workspace.html'], 'yay');
  assert.equal(afterRestore.notes['planner-glass-workspace.html'], 'Reviewed and done.');
  assert.ok(afterRestore.reviewReopen['planner-glass-workspace.html'].reopenedAt);

  const rerateResponse = await fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'rate', slot: 'planner-glass-workspace.html', rating: 'nay' }),
  });
  assert.equal(rerateResponse.status, 200);
  const afterNewFeedback = await (await fetch(base + '/__gallery/selections')).json();
  assert.equal(afterNewFeedback.reviewReopen['planner-glass-workspace.html'], undefined);
  assert.equal(afterNewFeedback.ratings['planner-glass-workspace.html'], 'nay');

  const feedbackRows = fs.readFileSync(path.join(galleryDir, '.canvas', 'feedback.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(feedbackRows.map((row) => row.kind), [
    'annotation', 'annotation', 'annotation-delete', 'rate', 'archive-review', 'restore-review', 'rate',
  ]);
});

test('browser can navigate expanded views, keyboard-annotate, save, exit, and restore focus', async (t) => {
  const chrome = chromeExecutable();
  if (!chrome) { t.skip('Chrome or Chromium is required for the browser interaction check'); return; }

  const galleryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-gallery-browser-'));
  const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-chrome-'));
  let server = null;
  let browser = null;
  let cdp = null;
  t.after(async () => {
    if (cdp) {
      try { await Promise.race([cdp.send('Browser.close'), delay(750)]); } catch { /* force-stop below */ }
      await cdp.close();
    }
    await terminateChild(browser, 'headless browser');
    await terminateChild(server, 'gallery server');
    fs.rmSync(galleryDir, { recursive: true, force: true });
    fs.rmSync(chromeProfile, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(galleryDir, 'manifest.json'), JSON.stringify({
    screens: [{ id: 'planner', name: 'Planner' }, { id: 'review', name: 'Review' }],
    slots: [
      {
        screen_id: 'planner', screen_name: 'Planner', mode: 'calm', html_path: 'planner.html', status: 'authored',
        delta: { summary: 'Moves the primary planning action into one focused panel.', selector: '[data-component="PlanInput"]' },
      },
      {
        screen_id: 'review', screen_name: 'Review', mode: 'focused', html_path: 'review.html', status: 'authored',
        delta: { summary: 'Keeps review visible beside the working context.', selector: '[broken' },
      },
    ],
  }));
  fs.writeFileSync(
    path.join(galleryDir, 'planner.html'),
    '<!doctype html><style>body{margin:0}main{min-height:900px}section{min-height:700px}</style>'
      + '<main data-component="PlanInput"><button>Plan today</button></main>'
      + '<section data-component="PlanPreview">Plan preview</section>',
  );
  fs.writeFileSync(path.join(galleryDir, 'review.html'), '<!doctype html><main data-component="ReviewPane">Review next</main>');
  fs.mkdirSync(path.join(galleryDir, '.canvas'), { recursive: true });
  fs.writeFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), JSON.stringify({
    schema: 'groundwork.gallery-selections/v2', ratings: {}, picks: {}, notes: {},
    annotations: {
      'review.html': [{
        id: 'ann-prior', marker: 'dot', x: 0.5, y: 0.5,
        target: { selector: 'main', component: 'ReviewPane', tag: 'main', role: '', label: '', text: 'Review next' },
        viewport: { width: 1200, height: 800 }, document: { width: 1200, height: 800 },
        comment: 'Feedback on the replaced revision.', status: 'archived',
        archivedAt: '2026-08-16T00:00:00.000Z', archivedFrom: '20260816T000000Z-1234abcd',
        createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
      }],
    },
    reviewArchive: {}, reviewReopen: {},
  }));

  const galleryPort = await reservePort();
  const debugPort = await reservePort();
  server = spawn(process.execPath, [
    SERVER, '--mode', 'gallery', '--dir', galleryDir,
    '--title', 'Browser test', '--port', String(galleryPort),
  ], { cwd: ROOT, env: GALLERY_TEST_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLogs = '';
  server.stdout.on('data', (chunk) => { serverLogs += chunk; });
  server.stderr.on('data', (chunk) => { serverLogs += chunk; });
  const base = 'http://127.0.0.1:' + galleryPort;
  await waitForServer(base, server, () => serverLogs);

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
  }, 'headless browser did not expose a page: ' + browserLogs);
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1200, height: 800, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Page.navigate', { url: base });
  await waitUntil(
    async () => evaluate(cdp, "document.readyState === 'complete' && !!document.querySelector('.expand-btn')"),
    'gallery did not render an Expand action',
  );
  assert.equal(await evaluate(cdp, "document.getElementById('summary').textContent"),
    '2 to review · 0 reviewed · 0 winners selected',
    'gallery summary did not separate active review work from completed feedback');
  assert.deepEqual(await evaluate(cdp, `(() => ({
    label: document.querySelector('.slot-delta strong')?.textContent,
    summary: document.querySelector('.slot-delta span')?.textContent,
  }))()`), {
    label: 'What changes', summary: 'Moves the primary planning action into one focused panel.',
  }, 'comparison card did not explain the option delta');

  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('iframe.preview')?.dataset.fitScale"),
    'gallery did not fit the thumbnail document',
  );
  assert.deepEqual(await evaluate(cdp, `(() => {
    const shell = document.querySelector('.preview-shell');
    const frame = shell.querySelector('iframe.preview');
    const shellRect = shell.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return {
      bordered: getComputedStyle(shell).borderTopStyle === 'solid',
      inert: getComputedStyle(frame).pointerEvents === 'none' && frame.tabIndex === -1,
      scaled: Number(frame.dataset.fitScale) > 0 && Number(frame.dataset.fitScale) < 1,
      wholeDocumentSized: parseFloat(frame.style.height) >= frame.contentDocument.documentElement.scrollHeight,
      contained: frameRect.left >= shellRect.left && frameRect.top >= shellRect.top
        && frameRect.right <= shellRect.right + 1 && frameRect.bottom <= shellRect.bottom + 1,
    };
  })()`), {
    bordered: true, inert: true, scaled: true, wholeDocumentSized: true, contained: true,
  });

  assert.equal(await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('.rate-btn'))
      .find((candidate) => candidate.dataset.rating === 'ok');
    button.focus();
    button.click();
    return true;
  })()`), true);
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.archived-card[data-slot=\"planner.html\"]')"),
    'selected OK did not move the mockup into Reviewed',
  );
  assert.equal(await evaluate(cdp,
    "document.querySelector('.archived-card[data-slot=\"planner.html\"] .archived-meta').textContent.includes('OK')"), true);
  await evaluate(cdp, `(() => {
    const details = document.querySelector('.archived-section');
    details.open = true;
    details.querySelector('.archived-card[data-slot="planner.html"] .expand-btn').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.viewer-frame')?.contentDocument?.querySelector('[data-component=PlanInput]')"),
    'OK-rated mockup did not open in Expanded View',
  );
  assert.deepEqual(await evaluate(cdp, `(() => ({
    pressed: Array.from(document.querySelectorAll('.viewer-rating-row .rate-btn'))
      .filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent),
    status: document.querySelector('#viewer-decision-heading + .annotation-help')
      .parentElement.querySelector('.viewer-feedback-status').textContent,
  }))()`), {
    pressed: [], status: 'No Yay/Nay decision saved',
  }, 'compact OK must remain neutral rather than becoming a binary Expanded decision');
  await evaluate(cdp, "document.querySelector('[data-action=close]').click()");
  await waitUntil(
    async () => evaluate(cdp, "document.getElementById('viewer').hidden"),
    'Expanded View did not close after the neutral-rating check',
  );
  await evaluate(cdp, `document.querySelector('.archived-card[data-slot="planner.html"] .restore-review-btn').click()`);
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.card[data-slot=\"planner.html\"]')"),
    'Review again did not return the neutral-rated mockup to the active queue',
  );
  assert.equal(await evaluate(cdp, `(() => {
    const card = document.querySelector('.card[data-slot="planner.html"]');
    card.querySelector('.rating-change')?.click();
    const button = Array.from(document.querySelectorAll('.card[data-slot="planner.html"] .rate-btn'))
      .find((candidate) => candidate.dataset.rating === 'nay');
    button.click();
    return true;
  })()`), true);
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.archived-card[data-slot=\"planner.html\"]')"),
    'selected Nay did not return the mockup to Reviewed',
  );
  await evaluate(cdp, `(() => {
    const details = document.querySelector('.archived-section');
    details.open = true;
    details.querySelector('.archived-card[data-slot="planner.html"] .restore-review-btn').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.card[data-slot=\"planner.html\"] .rate-btn.chosen')?.dataset.rating === 'nay'"),
    'Review again did not expose the saved Nay decision for editing',
  );
  assert.deepEqual(await evaluate(cdp, `(() => {
    const chosen = document.querySelector('.rate-btn.chosen');
    chosen.focus();
    const group = chosen.closest('.rate-row');
    return {
      visibleRatingButtons: group.querySelectorAll('.rate-btn').length,
      label: chosen.textContent,
      pressed: chosen.getAttribute('aria-pressed'),
      hasChange: !!group.querySelector('.rating-change'),
      groupLabel: group.getAttribute('aria-label'),
      groupRole: group.getAttribute('role'),
      focused: document.activeElement === chosen,
    };
  })()`), {
    visibleRatingButtons: 1, label: 'Nay selected', pressed: 'true', hasChange: true,
    groupLabel: 'Rate this direction', groupRole: 'group', focused: true,
  });
  assert.equal(await evaluate(cdp, `(() => {
    const change = document.querySelector('.rating-change');
    change.focus();
    change.click();
    const buttons = Array.from(document.querySelector('.card .rate-row').querySelectorAll('.rate-btn'));
    return buttons.length === 3
      && buttons.find((button) => button.dataset.rating === 'nay')?.getAttribute('aria-pressed') === 'true'
      && document.activeElement === buttons.find((button) => button.dataset.rating === 'nay');
  })()`), true);

  assert.equal(await evaluate(cdp, `(() => {
    const expand = document.querySelector('.expand-btn');
    expand.focus();
    expand.click();
    return !document.getElementById('viewer').hidden && document.getElementById('gallery').inert;
  })()`), true);
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.viewer-frame')?.contentDocument?.querySelector('[data-component=PlanInput]')"),
    'expanded mockup iframe did not load',
  );

  assert.deepEqual(await evaluate(cdp, `(() => {
    const stage = document.querySelector('.viewer-stage').getBoundingClientRect();
    const rail = document.querySelector('.annotation-rail').getBoundingClientRect();
    const buttons = Array.from(document.querySelectorAll('.viewer-rating-row .rate-btn'));
    const comment = document.querySelector('.viewer-comment');
    return {
      railOnRight: Math.abs(stage.right - rail.left) <= 1,
      railWidth: Math.round(rail.width),
      labels: buttons.map((button) => button.textContent),
      pressed: buttons.filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent),
      commentLabel: document.querySelector('label[for="viewer-general-comment"]').textContent,
      commentVisible: !!comment && comment.getClientRects().length > 0,
      asideLabel: document.querySelector('.annotation-rail').getAttribute('aria-label'),
    };
  })()`), {
    railOnRight: true, railWidth: 300, labels: ['Yay', 'Nay'], pressed: ['Nay'],
    commentLabel: 'Comment on this mockup', commentVisible: true, asideLabel: 'Mockup review',
  });
  assert.deepEqual(await evaluate(cdp, `(() => {
    const target = document.querySelector('.viewer-frame').contentDocument.querySelector('[data-component=PlanInput]');
    return {
      heading: document.getElementById('viewer-delta-heading')?.textContent,
      summary: document.querySelector('.viewer-delta p')?.textContent,
      status: document.querySelector('.viewer-delta-status')?.textContent,
      highlighted: target?.getAttribute('data-gw-review-delta'),
      outline: target ? getComputedStyle(target).outlineStyle : '',
    };
  })()`), {
    heading: 'What changes',
    summary: 'Moves the primary planning action into one focused panel.',
    status: 'The changed region is outlined in the mockup.',
    highlighted: 'true',
    outline: 'solid',
  }, 'expanded review did not pair the option summary with its changed-region outline');

  assert.equal(await evaluate(cdp, `(() => {
    const yay = Array.from(document.querySelectorAll('.viewer-rating-row .rate-btn'))
      .find((button) => button.textContent === 'Yay');
    yay.click();
    const comment = document.querySelector('.viewer-comment');
    comment.value = 'Keep the clear hierarchy, but reduce the chrome.';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-action="annotate"]').click();
    document.querySelector('[data-action="annotate"]').click();
    return document.querySelector('.viewer-frame').dataset.slot === 'planner.html'
      && document.querySelector('.viewer-comment').value === 'Keep the clear hierarchy, but reduce the chrome.';
  })()`), true, 'a general comment draft did not survive an annotation-state rerender');

  await waitUntil(() => {
    const file = path.join(galleryDir, '.canvas', 'gallery-selections.json');
    if (!fs.existsSync(file)) return false;
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return saved.ratings?.['planner.html'] === 'yay';
  }, 'expanded Yay rating was not persisted');
  await waitUntil(() => {
    const file = path.join(galleryDir, '.canvas', 'gallery-selections.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return saved.notes?.['planner.html'] === 'Keep the clear hierarchy, but reduce the chrome.';
  }, 'expanded general comment was not persisted through the existing note store');
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.viewer-comment-actions .viewer-feedback-status')?.textContent === 'Saved automatically'"),
    'expanded general comment did not show its automatic saved state',
  );

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 700, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.annotation-rail').getBoundingClientRect().top >= document.querySelector('.viewer-stage').getBoundingClientRect().bottom - 1"),
    'narrow expanded view did not stack the review rail below the mockup',
  );
  assert.deepEqual(await evaluate(cdp, `(() => {
    const rail = document.querySelector('.annotation-rail').getBoundingClientRect();
    const stage = document.querySelector('.viewer-stage').getBoundingClientRect();
    const button = document.querySelector('.viewer-rating-row .rate-btn');
    const comment = document.querySelector('.viewer-comment');
    return {
      stacked: rail.top >= stage.bottom - 1,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      ratingTarget: Math.round(button.getBoundingClientRect().height),
      commentFont: getComputedStyle(comment).fontSize,
    };
  })()`), {
    stacked: true, noHorizontalOverflow: true, ratingTarget: 44, commentFont: '16px',
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1200, height: 800, deviceScaleFactor: 1, mobile: false,
  });

  assert.deepEqual(await evaluate(cdp, `(() => {
    const previous = document.querySelector('[data-action="previous"]');
    const next = document.querySelector('[data-action="next"]');
    return { previousDisabled: previous.disabled, nextDisabled: next.disabled,
      position: document.querySelector('.viewer-title span').textContent,
      firstToolAction: document.querySelector('.viewer-tools .tool-btn').dataset.action };
  })()`), {
    previousDisabled: true, nextDisabled: false,
    position: 'Full mockup view · 1 of 2', firstToolAction: 'annotate',
  });
  await evaluate(cdp, `(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    let failedOnce = false;
    globalThis.__gwRestoreFetch = function () { globalThis.fetch = originalFetch; delete globalThis.__gwRestoreFetch; };
    globalThis.fetch = function (input, init) {
      let row = {};
      try { row = JSON.parse(init && init.body || '{}'); } catch { /* non-feedback fetch */ }
      if (!failedOnce && row.kind === 'note') {
        failedOnce = true;
        return Promise.resolve(new Response('', { status: 503 }));
      }
      return originalFetch(input, init);
    };
    const comment = document.querySelector('.viewer-comment');
    comment.value = 'Keep the hierarchy and reduce the chrome.';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-action=next]').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.viewer-comment-actions .viewer-feedback-status')?.textContent === 'Not saved'"),
    'failed automatic comment save was not shown',
  );
  assert.deepEqual(await evaluate(cdp, `(() => ({
    slot: document.querySelector('.viewer-frame').dataset.slot,
    draft: document.querySelector('.viewer-comment').value,
  }))()`), {
    slot: 'planner.html', draft: 'Keep the hierarchy and reduce the chrome.',
  }, 'a failed comment flush navigated away or discarded the draft');
  await evaluate(cdp, "document.querySelector('[data-action=next]').click()");
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.viewer-frame')?.contentDocument?.querySelector('[data-component=ReviewPane]')"),
    'Next did not replace the expanded mockup',
  );
  await evaluate(cdp, "globalThis.__gwRestoreFetch && globalThis.__gwRestoreFetch()");
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return saved.notes?.['planner.html'] === 'Keep the hierarchy and reduce the chrome.';
  }, 'Next did not flush the latest general comment before moving');
  assert.deepEqual(await evaluate(cdp, `(() => ({
    open: !document.getElementById('viewer').hidden,
    slot: document.querySelector('.viewer-frame').dataset.slot,
    previousDisabled: document.querySelector('[data-action="previous"]').disabled,
    nextDisabled: document.querySelector('[data-action="next"]').disabled,
    focusedAction: document.activeElement.dataset.action,
    position: document.querySelector('.viewer-title span').textContent,
  }))()`), {
    open: true, slot: 'review.html', previousDisabled: false, nextDisabled: true,
    focusedAction: 'previous', position: 'Full mockup view · 2 of 2',
  });
  await evaluate(cdp, `(() => {
    const comment = document.querySelector('.viewer-comment');
    comment.value = 'Keep review detail subordinate to the current item.';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-action=previous]').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.viewer-frame')?.contentDocument?.querySelector('[data-component=PlanInput]')"),
    'Previous did not replace the expanded mockup',
  );
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return saved.notes?.['review.html'] === 'Keep review detail subordinate to the current item.';
  }, 'Previous did not flush the latest general comment before moving');
  assert.equal(await evaluate(cdp, "document.activeElement.dataset.action"), 'next');
  assert.equal(await evaluate(cdp, "document.querySelector('.viewer-comment').value"),
    'Keep the hierarchy and reduce the chrome.',
    'saved general comment did not reopen on the original mockup');

  await evaluate(cdp, `(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    let failedOnce = false;
    globalThis.__gwRestoreFetch = function () { globalThis.fetch = originalFetch; delete globalThis.__gwRestoreFetch; };
    globalThis.fetch = function (input, init) {
      let row = {};
      try { row = JSON.parse(init && init.body || '{}'); } catch { /* non-feedback fetch */ }
      if (!failedOnce && row.kind === 'rate') {
        failedOnce = true;
        return Promise.resolve(new Response('', { status: 503 }));
      }
      return originalFetch(input, init);
    };
    const nay = Array.from(document.querySelectorAll('.viewer-rating-row .rate-btn'))
      .find((button) => button.dataset.rating === 'nay');
    nay.click();
    document.querySelector('[data-action=next]').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.viewer-feedback-status')?.textContent === 'Nay not saved'"),
    'failed immediate decision save was not shown',
  );
  assert.equal(await evaluate(cdp, "document.querySelector('.viewer-frame').dataset.slot"), 'planner.html',
    'failed immediate decision save allowed navigation');
  assert.deepEqual(await evaluate(cdp, `(() => {
    document.querySelector('[data-action="annotate"]').click();
    document.querySelector('[data-action="annotate"]').click();
    return {
      status: document.querySelector('.viewer-feedback-status').textContent,
      pressed: Array.from(document.querySelectorAll('.viewer-rating-row .rate-btn'))
        .filter((button) => button.getAttribute('aria-pressed') === 'true')
        .map((button) => button.textContent),
    };
  })()`), {
    status: 'Nay not saved', pressed: ['Nay'],
  }, 'failed decision intent disappeared during a review-rail rerender');
  await evaluate(cdp, "document.querySelector('[data-action=next]').click()");
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.viewer-frame')?.dataset.slot === 'review.html'"),
    'retrying the pending decision did not resume navigation',
  );
  await evaluate(cdp, "globalThis.__gwRestoreFetch && globalThis.__gwRestoreFetch()");
  await evaluate(cdp, "document.querySelector('[data-action=previous]').click()");
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.viewer-frame')?.dataset.slot === 'planner.html'"),
    'Previous did not return after the decision-save retry',
  );
  await evaluate(cdp, `Array.from(document.querySelectorAll('.viewer-rating-row .rate-btn'))
    .find((button) => button.dataset.rating === 'yay').click()`);
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return saved.ratings?.['planner.html'] === 'yay';
  }, 'restored Yay decision was not persisted after the failure-path check');
  await evaluate(cdp, `(() => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    let failedOnce = false;
    globalThis.__gwRestoreFetch = function () { globalThis.fetch = originalFetch; delete globalThis.__gwRestoreFetch; };
    globalThis.fetch = function (input, init) {
      let row = {};
      try { row = JSON.parse(init && init.body || '{}'); } catch { /* non-feedback fetch */ }
      if (!failedOnce && row.kind === 'rate') {
        failedOnce = true;
        return Promise.resolve(new Response('', { status: 503 }));
      }
      return originalFetch(input, init);
    };
    Array.from(document.querySelectorAll('.viewer-rating-row .rate-btn'))
      .find((button) => button.dataset.rating === 'nay').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.viewer-feedback-status')?.textContent === 'Nay not saved'"),
    'second failed decision save was not shown before cancellation',
  );
  assert.deepEqual(await evaluate(cdp, `(() => {
    Array.from(document.querySelectorAll('.viewer-rating-row .rate-btn'))
      .find((button) => button.dataset.rating === 'yay').click();
    return {
      status: document.querySelector('.viewer-feedback-status').textContent,
      pressed: Array.from(document.querySelectorAll('.viewer-rating-row .rate-btn'))
        .filter((button) => button.getAttribute('aria-pressed') === 'true')
        .map((button) => button.textContent),
    };
  })()`), {
    status: 'Yay saved', pressed: ['Yay'],
  }, 'choosing the saved decision did not cancel and reconcile a failed pending decision');
  await evaluate(cdp, "globalThis.__gwRestoreFetch && globalThis.__gwRestoreFetch()");

  assert.equal(await evaluate(cdp,
    "document.querySelector('.shape-group').hidden && document.querySelectorAll('.shape-btn').length === 2"), true);

  assert.equal(await evaluate(cdp, `(() => {
    const viewer = document.getElementById('viewer');
    const focusable = Array.from(viewer.querySelectorAll('button:not([disabled]), textarea:not([disabled]), iframe'))
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    const wrappedForward = document.activeElement === first;
    first.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    return wrappedForward && document.activeElement === last;
  })()`), true);

  assert.equal(await evaluate(cdp, `(() => {
    document.querySelector('[data-action="annotate"]').click();
    if (document.querySelector('.shape-group').hidden) return false;
    Array.from(document.querySelectorAll('.shape-btn')).find((button) => button.textContent.includes('Box')).click();
    const frame = document.querySelector('.viewer-frame');
    const component = frame.contentDocument.querySelector('[data-component=PlanInput]');
    component.focus();
    component.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }));
    const comment = document.querySelector('.annotation-comment');
    if (!comment) return false;
    const editor = document.querySelector('.annotation-editor.priority');
    const feedback = document.querySelector('.viewer-feedback');
    if (!editor || !feedback || editor.getBoundingClientRect().top >= feedback.getBoundingClientRect().top) return false;
    comment.value = 'Keep one clear planning input.';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(document.querySelectorAll('.annotation-actions button'))
      .find((button) => button.textContent.includes('Save')).click();
    return true;
  })()`), true);
  await waitUntil(() => {
    const file = path.join(galleryDir, '.canvas', 'gallery-selections.json');
    if (!fs.existsSync(file)) return false;
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const annotation = saved.annotations?.['planner.html']?.[0];
    return annotation?.comment === 'Keep one clear planning input.'
      && annotation.marker === 'box' && annotation.bounds?.width > 0 && annotation.bounds?.height > 0;
  }, 'keyboard content-box annotation was not persisted');

  assert.equal(await evaluate(cdp, `(() => {
    const frame = document.querySelector('.viewer-frame');
    const savedBox = frame.contentDocument.querySelector('[data-gw-annotation-id]');
    const preview = frame.contentDocument.querySelector('[data-component=PlanPreview]');
    const modeStayedOn = document.querySelector('[data-action="annotate"]').textContent === 'End annotation'
      && document.querySelector('[data-action="annotate"]').getAttribute('aria-pressed') === 'true';
    const boxIsVisible = savedBox && savedBox.style.width !== '28px' && savedBox.style.borderRadius === '7px';
    preview.focus();
    preview.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', {
      key: ' ', bubbles: true, cancelable: true,
    }));
    const comment = document.querySelector('.annotation-comment');
    if (!comment) return false;
    comment.value = 'Keep the plan preview aligned.';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(document.querySelectorAll('.annotation-actions button'))
      .find((button) => button.textContent.includes('Save')).click();
    return modeStayedOn && boxIsVisible;
  })()`), true);
  await waitUntil(() => {
    const file = path.join(galleryDir, '.canvas', 'gallery-selections.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const annotations = saved.annotations?.['planner.html'];
    return annotations?.length === 2 && annotations[1].comment === 'Keep the plan preview aligned.';
  }, 'annotation mode did not continue after the first save');

  assert.equal(await evaluate(cdp, `(() => {
    const end = document.querySelector('[data-action="annotate"]');
    end.click();
    return end.textContent === 'Annotate' && end.getAttribute('aria-pressed') === 'false'
      && document.querySelector('.shape-group').hidden;
  })()`), true);

  assert.equal(await evaluate(cdp, `(() => {
    document.querySelector('[data-action="annotate"]').click();
    Array.from(document.querySelectorAll('.shape-btn')).find((button) => button.textContent.includes('Box')).click();
    const frame = document.querySelector('.viewer-frame');
    const component = frame.contentDocument.querySelector('[data-component=PlanInput]');
    component.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }));
    const comment = document.querySelector('.annotation-comment');
    comment.value = 'Do not discard this yet.';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    globalThis.confirm = () => false;
    document.querySelector('[data-action="next"]').click();
    component.focus();
    component.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true,
    }));
    return !document.getElementById('viewer').hidden
      && document.querySelector('.viewer-frame').dataset.slot === 'planner.html'
      && document.querySelector('.annotation-comment').value === 'Do not discard this yet.';
  })()`), true);

  await evaluate(cdp, `(() => {
    globalThis.confirm = () => true;
    document.querySelector('[data-action="next"]').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.viewer-frame')?.contentDocument?.querySelector('[data-component=ReviewPane]')"),
    'confirmed discard did not navigate to the next expanded mockup',
  );
  assert.deepEqual(await evaluate(cdp, `(() => ({
    summary: document.querySelector('.viewer-delta p')?.textContent,
    status: document.querySelector('.viewer-delta-status')?.textContent,
    viewerOpen: !document.getElementById('viewer').hidden,
  }))()`), {
    summary: 'Keeps review visible beside the working context.',
    status: 'The highlight target is unavailable; use the summary above.',
    viewerOpen: true,
  }, 'an invalid optional delta selector did not degrade to a usable text summary');
  assert.equal(await evaluate(cdp, `(() => {
    const frame = document.querySelector('.viewer-frame');
    return document.querySelector('[data-action="annotate"]').getAttribute('aria-pressed') === 'true'
      && Array.from(document.querySelectorAll('.shape-btn')).find((button) => button.textContent.includes('Box')).getAttribute('aria-pressed') === 'true'
      && frame.contentDocument.documentElement.style.cursor === 'crosshair';
  })()`), true);

  assert.equal(await evaluate(cdp, `(() => {
    const comment = document.querySelector('.viewer-comment');
    comment.value = 'Keep the expanded review available on demand.';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    const frame = document.querySelector('.viewer-frame');
    const component = frame.contentDocument.querySelector('[data-component=ReviewPane]');
    component.focus();
    component.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true,
    }));
    return true;
  })()`), true);
  await waitUntil(
    async () => evaluate(cdp, "document.getElementById('viewer').hidden"),
    'iframe Escape did not wait for the automatic comment save before closing',
  );
  assert.equal(await evaluate(cdp, `(() => {
    return !document.getElementById('gallery').inert
      && document.activeElement === document.querySelector('.archived-section > summary');
  })()`), true);
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return saved.notes?.['review.html'] === 'Keep the expanded review available on demand.';
  }, 'iframe Escape did not persist the latest general comment');
  assert.equal(await evaluate(cdp,
    "document.querySelector('.archived-card[data-slot=\"planner.html\"] .archived-meta').textContent.includes('Yay')"),
  true, 'expanded decision did not reconcile into the Reviewed summary');
  assert.deepEqual(await evaluate(cdp, `(() => {
    const details = document.querySelector('.archived-section');
    return {
      collapsed: !details.open,
      summary: details.querySelector('summary').textContent,
      activeCards: document.querySelectorAll('.card').length,
      topSummary: document.getElementById('summary').textContent,
    };
  })()`), {
    collapsed: true, summary: 'Reviewed (2)', activeCards: 0,
    topSummary: '0 to review · 2 reviewed · 0 winners selected',
  }, 'Reviewed disclosure did not separate feedback from unfinished work');
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return !saved.reviewArchive?.['review.html']
      && !saved.reviewReopen?.['review.html']
      && saved.notes?.['review.html'] === 'Keep the expanded review available on demand.';
  }, 'saved feedback did not derive Reviewed state without a manual archive marker');

  await evaluate(cdp, `(() => {
    const details = document.querySelector('.archived-section');
    details.open = true;
    details.querySelector('.archived-card[data-slot="review.html"] .restore-review-btn').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.card[data-slot=\"review.html\"]')"),
    'Review again did not return the reviewed mockup to the active section',
  );
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return !!saved.reviewReopen?.['review.html']
      && saved.notes?.['review.html'] === 'Keep the expanded review available on demand.';
  }, 'Review again did not preserve feedback with a reopen override');
  await evaluate(cdp, `document.querySelector('.card[data-slot="review.html"] .archive-review-btn').click()`);
  await waitUntil(
    async () => evaluate(cdp, "!document.querySelector('.card[data-slot=\"review.html\"]')"),
    'explicit Archive reviewed did not return the reopened mockup to Reviewed',
  );
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return !!saved.reviewArchive?.['review.html']
      && !saved.reviewReopen?.['review.html']
      && saved.notes?.['review.html'] === 'Keep the expanded review available on demand.';
  }, 'archive did not preserve the review note and lifecycle state together');

  await evaluate(cdp, `(() => {
    const details = document.querySelector('.archived-section');
    details.querySelector('summary').click();
    details.querySelector('.archived-card[data-slot="review.html"] .expand-btn').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.viewer-frame')?.dataset.slot === 'review.html'"),
    'archived review did not remain expandable',
  );
  assert.equal(await evaluate(cdp, "document.querySelector('.viewer-archive-row .restore-review-btn')?.textContent"),
    'Review again');
  await evaluate(cdp, "document.querySelector('.viewer-archive-row .restore-review-btn').click()");
  await waitUntil(
    async () => evaluate(cdp, "document.getElementById('viewer').hidden && !!document.querySelector('.card[data-slot=\"review.html\"]')"),
    'expanded Review again did not return the review to the active queue',
  );
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return !saved.reviewArchive?.['review.html']
      && !!saved.reviewReopen?.['review.html']
      && saved.notes?.['review.html'] === 'Keep the expanded review available on demand.';
  }, 'Review again changed or lost preserved feedback');

  await evaluate(cdp, `document.querySelector('.card[data-slot="review.html"] .pick-btn').click()`);
  await waitUntil(
    async () => evaluate(cdp, "!document.querySelector('.card[data-slot=\"review.html\"]') && document.getElementById('summary').textContent.includes('1 winner selected')"),
    'winner selection did not move the selected view back to Reviewed',
  );
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return saved.picks?.review === 'review.html' && !saved.reviewReopen?.['review.html'];
  }, 'winner selection did not clear the temporary reopen override');

  await evaluate(cdp, `(() => {
    const details = document.querySelector('.archived-section');
    details.open = true;
    details.querySelector('.archived-card[data-slot="planner.html"] .restore-review-btn').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "!!document.querySelector('.card[data-slot=\"planner.html\"]')"),
    'planner Review again did not return the mockup to the active queue',
  );
  await evaluate(cdp, `document.querySelector('.card[data-slot="planner.html"] .expand-btn').click()`);
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.viewer-frame')?.dataset.slot === 'planner.html'"),
    'active review did not reopen before expanded archive',
  );
  await evaluate(cdp, "document.querySelector('.viewer-archive-row .archive-review-btn').click()");
  await waitUntil(
    async () => evaluate(cdp, "document.getElementById('viewer').hidden && !document.querySelector('.card[data-slot=\"planner.html\"]')"),
    'expanded Archive reviewed did not close the viewer and remove the active card',
  );
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return !!saved.reviewArchive?.['planner.html']
      && !saved.reviewReopen?.['planner.html']
      && saved.notes?.['planner.html'] === 'Keep the hierarchy and reduce the chrome.';
  }, 'expanded archive did not preserve the latest review feedback');

  await evaluate(cdp, `(() => {
    const details = document.querySelector('.archived-section');
    details.open = true;
    details.querySelector('.archived-card[data-slot="planner.html"] .expand-btn').click();
  })()`);
  await waitUntil(
    async () => evaluate(cdp, "document.querySelector('.viewer-frame')?.dataset.slot === 'planner.html'"),
    'reviewed planner did not reopen for expanded winner selection',
  );
  assert.deepEqual(await evaluate(cdp, `(() => {
    const button = document.querySelector('.viewer-pick-btn');
    return { label: button.textContent, pressed: button.getAttribute('aria-pressed') };
  })()`), { label: 'Select winner', pressed: 'false' });
  // Hold a real pick request across the same-view rail rebuild that previously
  // left completion updating a detached button. Exercise failure and retry.
  await evaluate(cdp, `(() => {
    window.holdWinnerRequest = (fail) => {
      const originalFetch = window.fetch;
      window.fetch = (url, options) => {
        if (url === '/__canvas/feedback' && JSON.parse(options?.body || '{}').kind === 'pick') {
          return new Promise((resolve) => {
            window.releaseWinnerRequest = () => {
              window.fetch = originalFetch;
              resolve(fail ? new Response('{}', { status: 503 }) : originalFetch(url, options));
            };
          });
        }
        return originalFetch(url, options);
      };
      window.clickedWinnerButton = document.querySelector('.viewer-pick-btn');
      window.clickedWinnerButton.click();
      document.querySelector('[data-action="annotate"]').click();
      document.querySelector('[data-action="annotate"]').click();
    };
    window.holdWinnerRequest(true);
  })()`);
  assert.equal(await evaluate(cdp, '!window.clickedWinnerButton.isConnected'), true,
    'regression must replace the clicked winner button while its request is pending');
  await evaluate(cdp, 'window.releaseWinnerRequest()');
  await waitUntil(async () => evaluate(cdp, `(() => {
    const row = document.querySelector('.viewer-pick-row');
    return row.querySelector('.viewer-feedback-status').textContent === 'Winner not saved'
      && row.querySelector('button').textContent === 'Select winner'
      && !row.querySelector('button').disabled;
  })()`), 'failed pick did not update the replacement rail with retry feedback');
  await evaluate(cdp, `(() => {
    // Keep note transport pending so this is an unsaved draft at completion.
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (url === '/__canvas/feedback' && JSON.parse(options?.body || '{}').kind === 'note') {
        return new Promise(() => {});
      }
      return originalFetch(url, options);
    };
    window.holdWinnerRequest(false);
    window.winnerDraftField = document.querySelector('.viewer-comment');
    window.winnerDraftField.value = 'Unsaved winner feedback — keep this exact draft.';
    window.winnerDraftField.dispatchEvent(new Event('input', { bubbles: true }));
    window.releaseWinnerRequest();
  })()`);
  await waitUntil(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf8'));
    return saved.picks?.planner === 'planner.html';
  }, 'expanded winner selection was not persisted');
  await waitUntil(
    async () => evaluate(cdp, `(() => {
      const button = document.querySelector('.viewer-pick-btn');
      return !document.getElementById('viewer').hidden
        && button?.textContent === 'Winner ✓'
        && button?.getAttribute('aria-pressed') === 'true';
    })()`),
    'expanded winner selection did not update the open viewer',
  );
  assert.deepEqual(await evaluate(cdp, `(() => ({
    viewerOpen: !document.getElementById('viewer').hidden,
    label: document.querySelector('.viewer-pick-btn').textContent,
    pressed: document.querySelector('.viewer-pick-btn').getAttribute('aria-pressed'),
    status: document.querySelector('.viewer-pick-row .viewer-feedback-status').textContent,
    sameDraftField: window.winnerDraftField === document.querySelector('.viewer-comment'),
    draft: document.querySelector('.viewer-comment').value,
  }))()`), {
    viewerOpen: true, label: 'Winner ✓', pressed: 'true', status: 'Selected for this screen',
    sameDraftField: true, draft: 'Unsaved winner feedback — keep this exact draft.',
  });
});
