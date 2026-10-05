// test_canvas_rail_layout.mjs — the iterate rail puts the comment box first.
//
// Owner report (2026-09-23): the rail was "way too cluttered" and it was not
// clear where to add input. This drives the real shell in headless Chrome and
// checks the layout contract that fix established:
//   - the labelled comment box is first under the current-screen attribution;
//   - optional direction and preview controls are accessible disclosures below it;
//   - Recent stays hidden until something is sent;
//   - decisionMeta badges fold behind a "N decisions" summary that names each
//     rigidity in words and expands on demand.
//
// Run: node --test designer/tests/test_canvas_rail_layout.mjs

import test from 'node:test';
import { waitUntil, connectCdp } from './support/browser.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER = path.join(ROOT, 'designer', 'canvas', 'canvas-server.mjs');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
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

async function terminate(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(750)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

test('iterate rail leads with labelled feedback and discloses directions, preview controls and decision badges', async (t) => {
  const chrome = chromeExecutable();
  assert.ok(chrome, 'Chrome or Chromium is required; set CHROME_BIN');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-rail-layout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const canvasFile = path.join(dir, 'canvas.html');
  fs.writeFileSync(canvasFile, '<!doctype html><html><head></head><body><header data-component="header">Header</header></body></html>');
  fs.mkdirSync(path.join(dir, '.canvas'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.canvas', 'status.json'), JSON.stringify({
    confidence: 0.38,
    decided: { 'platform.target': 'macos' },
    fork: { dim: 'motion.status', question: 'Move or stay still?', a: { label: 'Subtle' }, b: { label: 'Still' } },
    decisionMeta: {
      platform: { rigidity: 'locked', label: 'macOS app' },
      composer: { rigidity: 'locked', label: 'One message box' },
      motion: { rigidity: 'open', label: 'Status motion' },
    },
  }));

  const port = await reservePort();
  const debugPort = await reservePort();
  const server = spawn(process.execPath, [SERVER, '--file', canvasFile, '--dir', dir, '--title', 'Rail test', '--port', String(port)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLogs = '';
  server.stdout.on('data', (c) => { serverLogs += c; });
  server.stderr.on('data', (c) => { serverLogs += c; });
  t.after(() => terminate(server));
  await waitUntil(async () => {
    if (server.exitCode !== null) throw new Error(serverLogs);
    try { return (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
  }, 'canvas server did not start: ' + serverLogs);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-rail-chrome-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const browser = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1920,1080', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  t.after(() => terminate(browser));
  let target;
  await waitUntil(async () => {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
      target = targets.find((item) => item.type === 'page');
      return Boolean(target);
    } catch { return false; }
  }, 'browser did not expose CDP');
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  t.after(() => cdp.close());
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await waitUntil(
    () => evaluate(cdp, "document.readyState === 'complete' && !document.getElementById('decide').hidden && !document.getElementById('decisionLog').hidden").catch(() => false),
    'rail did not render status.json',
  );

  const rail = await evaluate(cdp, `(() => {
    const sections = Array.from(document.querySelectorAll('.rail > section, .rail > details')).filter((s) => !s.hidden);
    const composer = document.querySelector('.composer');
    const decide = document.getElementById('decide');
    const textarea = document.getElementById('comment');
    const label = document.querySelector('label[for="comment"]');
    const log = document.getElementById('decisionLog');
    const firstBadge = document.querySelector('#decisionBadges .decision-badge');
    return {
      order: sections.map((s) => s.id || s.className),
      composerAboveDecide: composer.getBoundingClientRect().top < decide.getBoundingClientRect().top,
      directionClosed: !decide.open,
      previewClosed: !document.getElementById('previewTools').open,
      label: label && label.textContent,
      labelled: textarea.labels.length,
      hint: document.getElementById('pinbar').textContent,
      recentHidden: document.getElementById('recent').hidden,
      logOpen: log.open,
      summary: document.getElementById('decisionSummary').textContent,
      badgeVisibleCollapsed: !!(firstBadge && firstBadge.checkVisibility()),
      badgeAria: firstBadge && firstBadge.getAttribute('aria-label'),
    };
  })()`);

  assert.equal(rail.composerAboveDecide, true, 'comment box must precede optional directions: ' + rail.order.join(' > '));
  assert.equal(rail.order[1], 'composer', 'comment must be first under the current-screen attribution: ' + rail.order.join(' > '));
  assert.equal(rail.directionClosed, true, 'optional directions start collapsed');
  assert.equal(rail.previewClosed, true, 'secondary preview tools start collapsed');
  assert.equal(rail.label, 'Tell Groundwork what to change');
  assert.equal(rail.labelled, 1, 'textarea needs an accessible name from its label');
  assert.match(rail.hint, /Click any part of the design/);
  assert.equal(rail.recentHidden, true, 'Recent must stay hidden while empty');
  assert.equal(rail.logOpen, false, 'decision badges start collapsed');
  assert.equal(rail.summary, '3 decisions · 2 locked, 1 open');
  assert.equal(rail.badgeVisibleCollapsed, false, 'badges must not render while collapsed');
  assert.equal(rail.badgeAria, 'macOS app: locked', 'badge keeps a text accessible name');

  const expanded = await evaluate(cdp, `(() => {
    document.querySelector('#previewTools > summary').click();
    document.getElementById('decisionSummary').click();
    const badge = document.querySelector('#decisionBadges .decision-badge');
    return { open: document.getElementById('decisionLog').open, visible: badge.checkVisibility() };
  })()`);
  assert.deepEqual(expanded, { open: true, visible: true });
});
