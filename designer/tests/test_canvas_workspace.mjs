// Stateful iterate workspace regressions. Fixtures are synthetic.
import test from 'node:test';
import { waitUntil, connectCdp } from './support/browser.js';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
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
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

test('workspace navigation preserves draft attribution; preview/apply, Hold and narrow layout stay truthful', async (t) => {
  const chrome = chromeExecutable();
  assert.ok(chrome, 'Chrome or Chromium is required');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-workspace-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-workspace-browser-'));
  const page = path.join(dir, 'home.html');
  const statusPath = path.join(dir, '.canvas', 'status.json');
  fs.mkdirSync(path.dirname(statusPath));
  fs.writeFileSync(page, '<!doctype html><html><head></head><body><main data-component="header" data-datain="Fixture source">Original preview</main></body></html>');
  fs.writeFileSync(path.join(dir, 'activity.html'), '<!doctype html><html><body><main data-component="activity">Activity preview</main><script>window.__activityScriptRan=true;</script></body></html>');
  const status = {
    decided: Object.fromEntries(Array.from({ length: 35 }, (_, i) => ['preference.' + i, 'An intentionally long saved preference value ' + i])),
    fork: { dim: 'header.style', question: 'Which header should this preview use?',
      a: { label: 'A compact header with a long label that must wrap on a narrow screen', preview: { component: 'header', addClass: 'compact' } },
      b: { label: 'A spacious header that retains detailed context', preview: { component: 'header', addClass: 'spacious' } } },
  };
  fs.writeFileSync(statusPath, JSON.stringify(status));
  const port = await reservePort();
  const base = 'http://127.0.0.1:' + port;
  fs.writeFileSync(path.join(dir, 'canvas-nav.json'), JSON.stringify({ title: 'Synthetic review', groups: [{ label: 'Screens', items: [
    { label: 'Home preview', url: 'http://localhost:' + port + '/' },
    { label: 'Activity preview', url: 'http://localhost:' + port + '/activity.html' },
  ] }, { label: 'Flows', items: [{ label: 'Overview', url: base + '/flow.html' }, { label: 'Data connections', url: base + '/connections.html' }] }] }));
  fs.writeFileSync(path.join(dir, 'flow.html'), '<!doctype html><html><body>Flow overview</body></html>');
  fs.writeFileSync(path.join(dir, 'connections.html'), '<!doctype html><html><body>Data connections</body></html>');
  const server = spawn(process.execPath, [SERVER, '--file', page, '--dir', dir, '--title', 'Workspace test', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stdout.on('data', (c) => logs += c); server.stderr.on('data', (c) => logs += c);
  let browser, cdp;
  t.after(async () => { if (cdp) cdp.close(); await terminate(browser); await terminate(server); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  await waitUntil(async () => { try { return (await fetch(base, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } }, 'server did not start: ' + logs);
  const debugPort = await reservePort();
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let target;
  await waitUntil(async () => { try { target = (await (await fetch('http://127.0.0.1:' + debugPort + '/json/list', { signal: AbortSignal.timeout(2000) })).json()).find((x) => x.type === 'page'); return !!target; } catch { return false; } }, 'browser did not start');
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'const RealEventSource = window.EventSource; window.EventSource = class extends RealEventSource { constructor(...args) { super(...args); window.__workspaceEvents = this; } };' });
  await cdp.send('Page.navigate', { url: base });
  await waitUntil(() => evaluate(cdp, "!!document.querySelector('.ab button') && !document.getElementById('gwnav').hidden && document.getElementById('frame').contentDocument?.body.textContent.includes('Original preview')").catch(() => false), 'workspace did not render');
  const rows = () => { const file = path.join(dir, '.canvas', 'feedback.jsonl'); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; };
  const run = (code) => evaluate(cdp, code);
  assert.equal(await run("document.getElementById('frame').contentDocument.querySelectorAll('[data-gw-io-chip]').length"), 0, 'annotations are opt-in');
  await run("document.getElementById('inspectSources').checked = true; document.getElementById('inspectSources').dispatchEvent(new Event('change'))");
  assert.equal(await run("document.getElementById('frame').contentDocument.querySelectorAll('[data-gw-io-chip]').length"), 1);
  await run("document.querySelector('.ab button').click()");
  await delay(150);
  assert.equal(rows().length, 0, 'preview must never append durable feedback');
  assert.equal(await run("document.getElementById('applyChoice').disabled"), false);
  await run("document.getElementById('applyChoice').click(); document.getElementById('applyChoice').click()");
  await waitUntil(() => rows().length === 1, 'choice did not save');
  assert.equal(rows()[0].kind, 'decide'); assert.equal(rows()[0].dim, 'header.style'); assert.equal(rows()[0].value, 'a');
  await waitUntil(() => run("document.getElementById('ack').textContent.includes('Choice saved')"), 'choice acknowledgement missing');
  assert.equal(await run("document.getElementById('nextBtn').hidden"), false);
  await run("document.querySelectorAll('.ab button')[1].click()");
  assert.equal(await run("document.getElementById('nextBtn').hidden"), true, 'unsaved preview cannot ask Next');
  await run("document.getElementById('nextBtn').click()");
  await delay(50);
  assert.equal(rows().length, 1, 'Next must not post an unsaved choice');
  await run("document.querySelector('.ab button').click()");
  assert.equal(await run("document.getElementById('nextBtn').hidden"), false, 'returning to saved choice restores Next');
  assert.match(await run("document.getElementById('thread').textContent"), /saved · awaiting agent/);
  assert.equal(await run("document.getElementById('applyChoice').disabled"), true, 'saved choice cannot resubmit until changed');
  await run("{ const comment = document.getElementById('comment'); comment.value = 'Keep this home note while browsing'; comment.dispatchEvent(new Event('input')); document.getElementById('workspaceScreenSelect').value = location.origin + '/activity.html'; document.getElementById('workspaceScreenSelect').dispatchEvent(new Event('change')) }");
  await waitUntil(() => run("document.getElementById('frame').contentDocument?.body.textContent.includes('Activity preview')").catch(() => false), 'activity did not load');
  assert.equal(await run("document.getElementById('frame').contentWindow.__activityScriptRan"), true, 'explicit canvas open runs application scripts');
  assert.equal(await run('location.href'), base + '/', 'shell navigation must not replace workspace');
  assert.equal(await run("document.getElementById('comment').value"), 'Keep this home note while browsing');
  assert.match(await run("document.getElementById('holdHint').textContent"), /paused while your note is unsent/, 'auto-Hold must be visible');
  assert.match(await run("document.getElementById('pinbar').textContent"), /Workspace test/);
  assert.equal(await run("document.getElementById('decide').hidden"), true, 'home fork must not act on a sibling page');
  assert.match(await run("document.getElementById('progress').textContent"), /35 decisions carried forward/);
  await run("document.querySelector('.chip.send[data-kind]').click()");
  await waitUntil(() => rows().length === 2, 'note did not save');
  assert.equal(rows()[1].canvasUrl, base + '/', 'retained draft must reference its original page');
  assert.equal(rows()[1].kind, 'comment');
  await run("document.getElementById('workspaceBack').click()");
  await waitUntil(() => run("!document.getElementById('decide').hidden && document.getElementById('frame').contentDocument?.body.textContent.includes('Original preview')").catch(() => false), 'Back did not restore home');
  assert.equal(await run("document.querySelector('.ab button').getAttribute('aria-pressed')"), 'true', 'choice survives navigation');
  assert.equal(await run("document.getElementById('frame').contentDocument.querySelector('[data-component=header]').classList.contains('compact')"), true, 'selected preview survives navigation');
  await run("document.querySelector('[data-mode=hold]').click()");
  await waitUntil(() => {
    // The server writes this file asynchronously; retry an in-progress write.
    try { return JSON.parse(fs.readFileSync(path.join(dir, '.canvas', 'mode.json'))).mode === 'hold'; }
    catch (error) { if (error instanceof SyntaxError || error.code === 'ENOENT') return false; throw error; }
  }, 'Hold not saved');
  fs.writeFileSync(page, '<!doctype html><html><body><main data-component="header">Updated preview</main></body></html>');
  await waitUntil(() => run("document.getElementById('pending').classList.contains('show')"), 'held update not signalled');
  await run("document.dispatchEvent(new Event('click')); window.dispatchEvent(new Event('focus'))");
  await delay(250);
  assert.match(await run("document.getElementById('frame').contentDocument.body.textContent"), /Original preview/, 'focus/click cannot override explicit Hold');
  await run("document.getElementById('pending').click()");
  await waitUntil(() => run("document.getElementById('frame').contentDocument?.body.textContent.includes('Updated preview')").catch(() => false), 'explicit refresh did not apply');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.canvas', 'mode.json'))).mode, 'hold', 'refresh preserves Hold');
  for (const width of [1280, 390, 320]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    await delay(50);
    if (width < 860) await run("document.body.classList.remove('feedback-open', 'pages-open')");
    const rect = await run(`(() => { const frame = document.getElementById('frame').getBoundingClientRect(); return { width:frame.width, height:frame.height, overflow:document.documentElement.scrollWidth > innerWidth, railVisible:document.querySelector('.rail').checkVisibility() }; })()`);
    assert.equal(rect.overflow, false, 'viewport overflow at ' + width);
    assert.ok(rect.width > (width < 860 ? width - 2 : 400), 'canvas visible at ' + width + ': ' + JSON.stringify(rect));
    assert.ok(rect.height > (width < 860 ? 760 : 600), 'canvas is primary at ' + width + ': ' + JSON.stringify(rect));
    if (width < 860) {
      assert.equal(rect.railVisible, false);
      await run("window.__workspaceEvents.onerror();");
      assert.equal(await run("document.getElementById('connBanner').checkVisibility()"), true, 'connection state visible with phone drawer closed');
      assert.match(await run("document.getElementById('connBanner').textContent"), /Disconnected/);
      await run("window.__workspaceEvents.onopen();");
      await waitUntil(() => run("!document.getElementById('connBanner').classList.contains('show')"), 'connection did not recover');
      await run("document.getElementById('feedbackToggle').click(); document.getElementById('feedbackPanel').scrollTop = 0");
      const firstOpen = await run(`(() => {
        const rail = document.getElementById('feedbackPanel');
        const note = document.getElementById('comment');
        const send = rail.querySelector('[data-kind="comment"]').getBoundingClientRect();
        return { frameHeight:document.getElementById('frame').getBoundingClientRect().height,
          sendVisible:send.top >= rail.getBoundingClientRect().top && send.bottom <= rail.getBoundingClientRect().bottom,
          noteFirst:!!(note.compareDocumentPosition(document.getElementById('decide')) & Node.DOCUMENT_POSITION_FOLLOWING),
          previewClosed:!document.getElementById('previewTools').open,
          directionClosed:!document.getElementById('decide').open };
      })()`);
      const savedHistory = await run("(() => {const section=document.getElementById('recent').getBoundingClientRect();const thread=document.getElementById('thread').getBoundingClientRect();return {sectionBottom:section.bottom,threadBottom:thread.bottom}})()");
      assert.ok(savedHistory.sectionBottom >= savedHistory.threadBottom, 'saved feedback stays readable in the main rail scroll: ' + JSON.stringify(savedHistory));
      t.diagnostic('Feedback first-open ' + width + ': ' + JSON.stringify(firstOpen));
      assert.equal(firstOpen.frameHeight, rect.height, 'feedback overlays without resizing the preview');
      assert.equal(await run("document.querySelector('.stage').inert && document.getElementById('feedbackPanel').getAttribute('aria-modal') === 'true' && document.activeElement.id === 'feedbackClose'"), true, 'mobile feedback has modal focus');
      await cdp.send('Input.dispatchKeyEvent', {type:'keyDown', key:'Escape', code:'Escape'});
      assert.equal(await run("!document.body.classList.contains('feedback-open') && !document.querySelector('.stage').inert && document.activeElement.id === 'feedbackToggle'"), true, 'Escape closes and restores focus');
      await run("document.getElementById('feedbackToggle').click()");
      await cdp.send('Input.dispatchKeyEvent', {type:'keyDown', key:'Tab', code:'Tab', modifiers:8});
      assert.equal(await run("document.getElementById('feedbackPanel').contains(document.activeElement)"), true, 'reverse Tab remains in feedback');
      assert.equal(firstOpen.sendVisible, true, 'Send is visible without hunting in the rail');
      assert.equal(firstOpen.noteFirst, true);
      assert.equal(firstOpen.previewClosed, true);
      assert.equal(firstOpen.directionClosed, true);
      await run("document.querySelector('#previewTools > summary').focus()");
      await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', text:'\r' });
      await cdp.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter' });
      assert.equal(await run("document.getElementById('previewTools').open && document.querySelector('[data-mode=hold]').checkVisibility()"), true, 'secondary controls open with keyboard');
      await run("document.getElementById('decisionLog').open = true; document.getElementById('decide').open = true");
      assert.ok(await run("document.getElementById('frame').getBoundingClientRect().height") === rect.height, 'expanded tools cannot consume the preview');
      const panel = await run("(() => { const rail = document.querySelector('.rail'); return { visible:rail.checkVisibility(), overflow:document.documentElement.scrollWidth > innerWidth, targets:[...rail.querySelectorAll('button, summary')].filter(x=>x.checkVisibility()).map(x=>x.getBoundingClientRect().height) }; })()");
      assert.equal(panel.visible, true); assert.equal(panel.overflow, false);
      assert.ok(panel.targets.every((height) => height >= 44), 'targets >=44px at ' + width + ': ' + panel.targets);
      await run("{ document.getElementById('previewTools').open = false; document.getElementById('decide').open = false; const note=document.getElementById('comment'); note.value='Keep this feedback draft — café 👩🏽‍💻'; note.dispatchEvent(new Event('input')); document.getElementById('feedbackToggle').click(); document.getElementById('feedbackToggle').click(); }");
      assert.equal(await run("document.getElementById('comment').value"), 'Keep this feedback draft — café 👩🏽‍💻', 'closing feedback must preserve exact draft');
      assert.match(await run("document.getElementById('previewMode').textContent"), /Hold/, 'collapsed preview controls retain explicit update state');
      if (width === 390) {
        fs.writeFileSync(page, '<!doctype html><html><body><main data-component="header">Pending while reviewing feedback</main></body></html>');
        await waitUntil(() => run("document.getElementById('pending').classList.contains('show')"), 'pending update not shown while feedback is open');
        await run("document.getElementById('previewTools').open = true; document.getElementById('decide').open = true");
        const pendingBounds = await run("(() => {const f=document.getElementById('frame').getBoundingClientRect();const p=document.getElementById('pending').getBoundingClientRect();return {height:f.height,noOverlap:f.bottom<=p.top,pendingHeight:p.height}})()");
        t.diagnostic('Feedback pending ' + width + ': ' + JSON.stringify(pendingBounds));
        assert.ok(pendingBounds.height >= 690, 'pending update and feedback still leave a useful preview: ' + JSON.stringify(pendingBounds));
        assert.equal(pendingBounds.noOverlap, true); assert.ok(pendingBounds.pendingHeight >= 44);
        await run("document.getElementById('pending').click()");
        assert.equal(await run("document.getElementById('comment').value"), 'Keep this feedback draft — café 👩🏽‍💻', 'refresh must retain the unsent feedback draft');
      }
      await run("document.getElementById('previewTools').open = false; document.getElementById('decide').open = false; document.getElementById('comment').value=''; document.getElementById('comment').dispatchEvent(new Event('input')); document.getElementById('feedbackClose').click()");
      await run("document.getElementById('frame').contentDocument.querySelector('[data-component]').click()");
      assert.equal(await run("document.querySelector('.stage').inert && document.getElementById('feedbackPanel').getAttribute('aria-modal') === 'true' && document.activeElement.id === 'comment'"), true, 'component pin uses the modal entry path');
      assert.match(await run("document.getElementById('pinbar').textContent"), /header/);
      await run("document.getElementById('feedbackClose').click()");
      assert.equal(await run("!document.querySelector('.stage').inert && document.activeElement.id === 'feedbackToggle'"), true, 'component modal returns to preview');
      assert.equal(await run("!document.querySelector('#workspaceTools .view-tabs').checkVisibility() && document.getElementById('workspaceScreenSelect').checkVisibility()"), true, 'screen selector is visible and advanced views start collapsed');
      await run("document.querySelector('#workspaceTools > summary').click()");
      assert.equal(await run("document.getElementById('workspaceHome').checkVisibility() && document.getElementById('sectionViews').checkVisibility() && document.getElementById('gwnav').checkVisibility()"), true, 'More exposes navigation and preview modes');
      await run("document.getElementById('workspaceHome').click()");
      assert.equal(await run("document.getElementById('workspaceTools').open"), false, 'navigation returns to unobstructed canvas');
    }
  }
  // The accepted workspace has one section rail and views within each section.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await run("document.body.classList.remove('feedback-open', 'pages-open'); document.querySelector('[data-section=\"1\"]').click()");
  await waitUntil(() => run("document.getElementById('frame').contentDocument?.body.textContent.includes('Flow overview')").catch(() => false), 'section did not open its page');
  assert.deepEqual(await run("[...document.querySelectorAll('#sectionViews button')].map(x=>x.textContent)"), ['Overview', 'Data connections']);
  await run("document.querySelectorAll('#sectionViews button')[1].click()");
  await waitUntil(() => run("document.getElementById('frame').contentDocument?.body.textContent.includes('Data connections')").catch(() => false), 'section view did not navigate');
  await run("document.getElementById('gwnavToggle').click()");
  assert.equal(await run("document.body.classList.contains('nav-collapsed')"), true);
  assert.equal(await run("[...document.querySelectorAll('.section-link')].every(x=>x.checkVisibility() && x.getBoundingClientRect().height>=44)"), true, 'compact rail keeps every destination');
  await run("document.querySelector('[data-section=\"0\"]').click(); document.querySelector('[data-view=previews]').click()");
  await waitUntil(() => run("document.querySelectorAll('.screen-card').length===2 && document.querySelectorAll('.screen-thumbnail iframe')[1].contentDocument?.body.textContent.includes('Activity preview')").catch(() => false), 'real screen previews did not load');
  assert.equal(await run("[...document.querySelectorAll('.screen-thumbnail iframe')].every(x=>!x.sandbox.contains('allow-scripts'))"), true, 'static thumbnails cannot execute canvas scripts');
  assert.equal(await run("document.getElementById('frame').hidden"), true);
  assert.equal(await run("document.querySelectorAll('.screen-thumbnail iframe')[1].contentWindow.__activityScriptRan===undefined"), true, 'thumbnail script did not execute');
  await run("document.querySelectorAll('.screen-card')[1].querySelector('[data-rating=revise]').click()");
  await waitUntil(() => rows().some(row=>row.source==='screen-preview'), 'quick rating did not save');
  const rating = rows().find(row=>row.source==='screen-preview');
  assert.equal(rating.canvasUrl, base + '/activity.html'); assert.equal(rating.kind, 'comment'); assert.equal(rating.reviewRating, 'revise');
  await run("{ const note=document.querySelectorAll('.screen-card textarea')[1]; note.value='Tighten this screen'; note.dispatchEvent(new Event('input')); }");
  await waitUntil(() => rows().some(row=>row.reviewNote==='Tighten this screen'), 'quick note did not save');
  await run("{ const note=document.getElementById('comment'); note.value='Reload-safe home draft'; note.dispatchEvent(new Event('input')); }");
  await cdp.send('Page.reload');
  await waitUntil(() => run("document.getElementById('comment').value==='Reload-safe home draft' && document.querySelector('[data-view=previews]') && document.body.classList.contains('nav-collapsed')").catch(() => false), 'browser preferences and draft did not restore');
  await run("document.querySelector('[data-view=previews]').click()");
  await waitUntil(() => run("document.querySelectorAll('.screen-card textarea')[1]?.value==='Tighten this screen'").catch(() => false), 'saved screen note did not rehydrate');
  assert.equal(await run("document.querySelectorAll('.screen-card')[1].querySelector('[data-rating=revise]').getAttribute('aria-pressed')"), 'true');
  assert.match(await run("document.getElementById('thread').textContent"), /Tighten this screen/);
  for (const width of [390, 320]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    await delay(50);
    assert.equal(await run("document.documentElement.scrollWidth > innerWidth"), false, 'preview grid fits ' + width);
    assert.equal(await run("[...document.querySelectorAll('.screen-card button')].every(x=>!x.checkVisibility() || x.getBoundingClientRect().height>=44)"), true);
  }
  // The cursor is host-owned: reads never advance it, and only the exact
  // committed ID acknowledges review. The latest screen row determines status.
  const cursor = path.join(dir, '.canvas', 'cursor.json');
  const cardStatus = () => run("document.querySelectorAll('.screen-card')[1]?.querySelector('.screen-save-status').textContent || ''");
  await waitUntil(async () => (await cardStatus()).includes('Saved · awaiting agent review'), 'saved feedback must await review');
  assert.equal(fs.existsSync(cursor), false, 'GET must not create a host checkpoint');
  const commit = () => {
    const saved = rows();
    execFileSync('python3', ['-m', 'designer.canvas.feedback_cursor', 'commit', '--dir', dir, '--last-id', saved.at(-1).id, '--count', String(saved.length)], { cwd: ROOT });
  };
  commit();
  const committedBytes = fs.readFileSync(cursor, 'utf8');
  await waitUntil(async () => (await cardStatus()).includes('Reviewed by agent'), 'SSE did not acknowledge committed feedback');
  const threadCount = await run("document.querySelectorAll('#thread .item').length");
  for (let i=0;i<3;i++) await run("window.__workspaceEvents.onopen()");
  await delay(300);
  assert.equal(await run("document.querySelectorAll('#thread .item').length"), threadCount, 'background refresh must not duplicate the journal');
  assert.equal(fs.readFileSync(cursor, 'utf8'), committedBytes, 'read projection preserves cursor bytes');
  await cdp.send('Page.reload');
  await waitUntil(() => run("!!document.querySelector('[data-view=previews]')").catch(() => false), 'reviewed reload did not render');
  await run("document.querySelector('[data-view=previews]').click()");
  await waitUntil(async () => (await cardStatus()).includes('Reviewed by agent'), 'reviewed status did not survive reload');
  fs.writeFileSync(cursor, '{torn checkpoint');
  await waitUntil(async () => (await cardStatus()).includes('review status unavailable'), 'invalid checkpoint must not claim review');
  assert.equal(await run("document.querySelectorAll('.screen-card textarea')[1].value"), 'Tighten this screen');
  fs.writeFileSync(cursor, JSON.stringify({last_id:'fb-old-server-0',count:999999}));
  await waitUntil(async () => (await cardStatus()).includes('awaiting agent review'), 'stale checkpoint count must not establish review');
  commit();
  await waitUntil(async () => (await cardStatus()).includes('Reviewed by agent'), 'checkpoint did not recover');
  await run("document.querySelectorAll('.screen-card')[1].querySelector('[data-rating=keep]').click()");
  await waitUntil(() => rows().at(-1).reviewRating==='keep', 'new rating did not save');
  await waitUntil(async () => (await cardStatus()).includes('awaiting agent review'), 'new row must await its own acknowledgment');
  // A save and refresh racing newer typing retain the newer draft and focus.
  await run("{ window.__realFetch=window.fetch; window.fetch=async (...args)=>{ if(String(args[0]).includes('/__canvas/feedback') && args[1]?.method==='POST') await new Promise(r=>setTimeout(r,400)); return window.__realFetch(...args); }; const note=document.querySelectorAll('.screen-card textarea')[1]; note.focus(); note.value='First in-flight note'; note.dispatchEvent(new Event('input')); document.querySelectorAll('.screen-card')[1].querySelector('[data-rating=revise]').click(); }");
  await waitUntil(async () => (await cardStatus()).includes('Saving'), 'save did not start');
  await run("{ const note=document.querySelectorAll('.screen-card textarea')[1]; note.value='Newer focused note'; note.dispatchEvent(new Event('input')); window.__workspaceEvents.onopen(); }");
  await waitUntil(() => rows().at(-1).reviewNote==='Newer focused note', 'newer draft did not complete after in-flight save');
  assert.equal(await run("document.querySelectorAll('.screen-card textarea')[1].value"), 'Newer focused note');
  assert.equal(await run("document.activeElement===document.querySelectorAll('.screen-card textarea')[1]"), true);
  await run("window.fetch=window.__realFetch");
  const beforeFailure = rows().length;
  await run("window.__realFetch=window.fetch; window.fetch=async (...args)=>String(args[0]).includes('/__canvas/feedback') && args[1]?.method==='POST' ? {ok:false} : window.__realFetch(...args); const note=document.querySelectorAll('.screen-card textarea')[1]; note.value='Retry this screen'; note.dispatchEvent(new Event('input'));");
  await waitUntil(() => run("!document.querySelectorAll('.screen-card')[1].querySelector('.screen-save-status button').hidden"), 'quick save failure did not offer retry');
  assert.equal(rows().length, beforeFailure);
  await cdp.send('Page.reload');
  await waitUntil(() => run("document.querySelector('[data-view=previews]') && document.getElementById('comment').value==='Reload-safe home draft'").catch(() => false), 'failed-save reload lost composer draft');
  await run("document.querySelector('[data-view=previews]').click()");
  await waitUntil(() => run("document.querySelectorAll('.screen-card textarea')[1]?.value==='Retry this screen'").catch(() => false), 'failed-save reload lost quick note');
  await run("document.querySelectorAll('.screen-card')[1].querySelector('.screen-save-status button').click()");
  await waitUntil(() => rows().some(row=>row.reviewNote==='Retry this screen'), 'retained quick draft could not be retried');
  const savedCount = rows().length;
  await run("{ window.fetch = async () => ({ ok: false }); const comment = document.getElementById('comment'); comment.value = 'Retry me'; comment.dispatchEvent(new Event('input')); document.querySelector('.chip.send[data-kind]').click() }");
  await waitUntil(() => run("document.getElementById('sendAck').classList.contains('warn')"), 'failed send must be visible');
  assert.equal(await run("document.getElementById('comment').value"), 'Retry me', 'failed post retains draft');
  assert.equal(rows().length, savedCount, 'failed POST writes no row');
  const journal = path.join(dir, '.canvas', 'feedback.jsonl');
  fs.appendFileSync(journal, '{malformed row\nnull\n');
  const projection = await (await fetch(base + '/__canvas/feedback')).json();
  assert.equal(projection.invalidRows, 2); assert.equal(projection.rows.length, savedCount);
  assert.match(projection.rows.find(row=>row.reviewNote==='Retry this screen').text, /Retry this screen/);

});
