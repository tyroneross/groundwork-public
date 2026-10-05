// test_canvas_shell_layout.mjs — grid layout regression for the iterate-mode
// canvas shell (designer/canvas/canvas-server.mjs SHELL()).
//
// Bug: .wrap{display:grid;grid-template-columns:var(--nav,0px) minmax(0,1fr)
// var(--rail)} relies on DOM order for auto-placement across its three
// columns (nav / stage / rail). The nav is only un-hidden by client JS when
// GET /__canvas/nav returns groups; with no canvas-nav.json it stays
// `hidden`, drops out of layout, and the grid auto-places .stage into the
// 0px nav column and .rail into the 1fr column — #frame renders 0px wide
// and only the rail is visible. Repro: serve any HTML via canvas-server.mjs
// in a temp dir with no canvas-nav.json anywhere on its lookup path.
//
// Pattern: test_gallery_server.mjs (headless-Chrome CDP: CHROME_BIN
// resolution, WebSocket CDP helper, launch flags, cleanup/terminate) +
// test_canvas_preview.mjs (iterate-mode server spawn / reservePort /
// waitForServer). Two cases:
//   A. no canvas-nav.json anywhere on the lookup path -> nav stays hidden,
//      #frame must still render at (near) full stage width.
//   B. canvas-nav.json present -> nav renders, and column order holds
//      nav < stage < rail.
//
// Run: node --test designer/tests/test_canvas_shell_layout.mjs

import test from 'node:test';
import { waitUntil, connectCdp } from './support/browser.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
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
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url, child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) throw new Error('canvas server exited early: ' + output());
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch { /* booting */ }
    await delay(50);
  }
  throw new Error('canvas server did not start: ' + output());
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

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function bootServer(canvasDir, canvasFile, extraArgs = []) {
  const port = await reservePort();
  const child = spawn(process.execPath, [
    SERVER, '--file', canvasFile, '--dir', canvasDir,
    '--title', 'Shell layout test', '--port', String(port), ...extraArgs,
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const base = 'http://127.0.0.1:' + port;
  await waitForServer(base, child, () => logs);
  return { child, base, logs: () => logs };
}

test('canvas shell: no nav json -> stage/frame still get full width', async (t) => {
  const chrome = chromeExecutable();
  if (!chrome) { assert.fail('Chrome or Chromium is required for the shell layout check (set CHROME_BIN)'); return; }

  // Fresh mkdtemp SUBDIR as --dir, so neither it nor its parent (also fresh)
  // can contain a stray canvas-nav.json from another temp dir on the system.
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-canvas-shell-'));
  const canvasDir = path.join(outer, 'canvas');
  fs.mkdirSync(canvasDir);
  t.after(() => fs.rmSync(outer, { recursive: true, force: true }));
  const canvasFile = path.join(canvasDir, 'canvas.html');
  fs.writeFileSync(canvasFile, '<!doctype html><html><body><main>hello</main></body></html>');
  assert.ok(!fs.existsSync(path.join(canvasDir, 'canvas-nav.json')));
  assert.ok(!fs.existsSync(path.join(outer, 'canvas-nav.json')));

  const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-chrome-shell-'));
  let server = null;
  let browser = null;
  let cdp = null;
  t.after(async () => {
    if (cdp) {
      try { await Promise.race([cdp.send('Browser.close'), delay(750)]); } catch { /* force-stop below */ }
      await cdp.close();
    }
    await terminateChild(browser, 'headless browser');
    await terminateChild(server, 'canvas server');
    // Chrome helpers may finish profile writes just after the parent exits.
    fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const booted = await bootServer(canvasDir, canvasFile);
  server = booted.child;
  const base = booted.base;

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
  }, 'headless browser did not expose a page: ' + browserLogs);
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Page.navigate', { url: base });
  await waitUntil(
    async () => evaluate(cdp, "document.readyState === 'complete' && !!document.getElementById('frame')"),
    'canvas shell did not finish loading',
  );
  // The nav fetch (/__canvas/nav) is an async IIFE in the shipped script; give
  // it time to settle (there is no groups-arrived signal to wait on when the
  // expected outcome is "nav stays hidden").
  await delay(1000);

  const rects = await evaluate(cdp, `(() => {
    const plain = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
    const nav = document.getElementById('gwnav');
    const stage = document.querySelector('.stage');
    const frame = document.getElementById('frame');
    const rail = document.querySelector('.rail');
    return {
      navHidden: nav.hidden,
      navWidth: nav.getBoundingClientRect().width,
      stage: plain(stage.getBoundingClientRect()),
      frame: plain(frame.getBoundingClientRect()),
      rail: plain(rail.getBoundingClientRect()),
    };
  })()`);

  console.log('CASE A (no nav) measured rects:', JSON.stringify(rects));

  assert.equal(rects.navHidden, true, 'nav should stay hidden with no canvas-nav.json');
  assert.ok(rects.frame.width > 600, `frame width should be substantially large at 1440px viewport, got ${rects.frame.width}`);
  assert.ok(rects.stage.left < rects.rail.left, 'stage must be left of the rail');
  assert.ok(rects.frame.width > 0, 'frame must have nonzero width');
});

test('canvas shell: with nav json -> nav < stage < rail, all nonzero width', async (t) => {
  const chrome = chromeExecutable();
  if (!chrome) { assert.fail('Chrome or Chromium is required for the shell layout check (set CHROME_BIN)'); return; }

  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-canvas-shell-nav-'));
  const canvasDir = path.join(outer, 'canvas');
  fs.mkdirSync(canvasDir);
  t.after(() => fs.rmSync(outer, { recursive: true, force: true }));
  const canvasFile = path.join(canvasDir, 'canvas.html');
  fs.writeFileSync(canvasFile, '<!doctype html><html><body><main>hello</main></body></html>');
  // Schema per canvas-server.mjs readNav(): {title, groups:[{label, items:[{label,url,hint?}]}]}
  fs.writeFileSync(path.join(canvasDir, 'canvas-nav.json'), JSON.stringify({
    title: 'Pages',
    groups: [{ label: 'Screens', items: [{ label: 'Home', url: 'http://localhost:1/home' }] }],
  }));

  const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-chrome-shell-nav-'));
  let server = null;
  let browser = null;
  let cdp = null;
  t.after(async () => {
    if (cdp) {
      try { await Promise.race([cdp.send('Browser.close'), delay(750)]); } catch { /* force-stop below */ }
      await cdp.close();
    }
    await terminateChild(browser, 'headless browser');
    await terminateChild(server, 'canvas server');
    // Chrome helpers may finish profile writes just after the parent exits.
    fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const booted = await bootServer(canvasDir, canvasFile);
  server = booted.child;
  const base = booted.base;

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
  }, 'headless browser did not expose a page: ' + browserLogs);
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Page.navigate', { url: base });
  await waitUntil(
    async () => evaluate(cdp, "document.readyState === 'complete' && !!document.getElementById('frame')"),
    'canvas shell did not finish loading',
  );
  await waitUntil(
    async () => evaluate(cdp, "document.getElementById('gwnav').hidden === false"),
    'nav did not become visible after canvas-nav.json was supplied',
  );
  // Let layout settle one more tick after the class toggle.
  await delay(200);

  const rects = await evaluate(cdp, `(() => {
    const plain = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
    const nav = document.getElementById('gwnav');
    const stage = document.querySelector('.stage');
    const frame = document.getElementById('frame');
    const rail = document.querySelector('.rail');
    return {
      navHidden: nav.hidden,
      nav: plain(nav.getBoundingClientRect()),
      stage: plain(stage.getBoundingClientRect()),
      frame: plain(frame.getBoundingClientRect()),
      rail: plain(rail.getBoundingClientRect()),
    };
  })()`);

  console.log('CASE B (with nav) measured rects:', JSON.stringify(rects));

  assert.equal(rects.navHidden, false, 'nav should be visible when canvas-nav.json supplies groups');
  assert.ok(rects.nav.width > 0, 'nav must have nonzero width');
  assert.ok(rects.frame.width > 0, 'frame must have nonzero width');
  assert.ok(rects.nav.left <= rects.stage.left, 'nav must be left of (or flush with) the stage');
  assert.ok(rects.stage.left < rects.rail.left, 'stage must be left of the rail');
  assert.ok(rects.frame.width > 300, `frame width should be reasonably large, got ${rects.frame.width}`);
});
