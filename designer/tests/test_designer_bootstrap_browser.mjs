import test from 'node:test';
import { workspaceStore } from '../server/workspace-store.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER = path.join(ROOT, 'designer', 'server', 'designer-server.mjs');
const FIXTURE = path.join(ROOT, 'docs', 'contracts', 'fixtures', 'spectra-visual-bootstrap.json');

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

async function waitUntil(check, message, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await delay(75);
  }
  throw new Error(message);
}

async function terminate(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(750),
  ]);
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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
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
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

function makeBootstrap() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-bootstrap-browser-'));
  const repoInput = path.join(temp, 'Spectra');
  fs.mkdirSync(repoInput);
  const repo = fs.realpathSync(repoInput);
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"spectra"}\n');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'App.tsx'), 'export const App = () => null;\n');
  const payload = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  payload.product.repoPath = repo;
  payload.product.outputPath = path.join(repo, '.designdoc');
  const mockups = path.join(payload.product.outputPath, 'mockups');
  fs.mkdirSync(mockups, { recursive: true });
  fs.writeFileSync(path.join(mockups, 'selected.html'),
    '<style>h1{font-family:Arial,sans-serif;color:rgb(195,78,32)}main{display:flex;gap:25px}</style><main><h1>Selected direction</h1><script>window.__unsafe = true</script><button onclick="window.__unsafe=true">Keep</button></main>');
  fs.writeFileSync(path.join(mockups, 'selection.json'), JSON.stringify({
    perScreen: [{ screen_id: 'planner', html_path: 'selected.html', note: 'Selected planner direction' }],
  }));
  const store = workspaceStore(payload.product.outputPath);
  store.addAlternative({ html: '<style>main{color:#c34e20}</style><main>Direction A</main>', label: 'Direction A' });
  store.addAlternative({ html: '<main>Direction B</main>', label: 'Direction B' });
  const bootstrap = path.join(temp, 'bootstrap.json');
  fs.writeFileSync(bootstrap, JSON.stringify(payload));
  return { temp, bootstrap };
}

test('browser reviews baseline, expands evidence, continues, and receives the adaptive next decision', async (t) => {
  const chrome = chromeExecutable();
  if (!chrome) { t.skip('Chrome or Chromium is required for the browser interaction check'); return; }

  const fixture = makeBootstrap();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-bootstrap-chrome-'));
  const port = await reservePort();
  const debugPort = await reservePort();
  let server;
  let browser;
  let cdp;
  t.after(async () => {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch { /* force stop below */ }
      cdp.close();
    }
    await terminate(browser);
    await terminate(server);
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(fixture.temp, { recursive: true, force: true });
  });

  server = spawn(process.execPath, [SERVER, '--bootstrap', fixture.bootstrap, '--port', String(port)], {
    cwd: ROOT,
    env: { ...process.env, GROUNDWORK_DESIGNER_STATE_FILE: path.join(fixture.temp, 'designer-state.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLogs = '';
  server.stdout.on('data', (chunk) => { serverLogs += chunk; });
  server.stderr.on('data', (chunk) => { serverLogs += chunk; });
  await waitUntil(async () => {
    if (server.exitCode !== null) throw new Error(serverLogs);
    try { return (await fetch(`http://127.0.0.1:${port}/api/session`)).ok; } catch { return false; }
  }, 'designer server did not start');

  browser = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,1000', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserLogs = '';
  browser.stderr.on('data', (chunk) => { browserLogs += chunk; });
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await waitUntil(
    () => evaluate(cdp, "document.readyState === 'complete' && !document.getElementById('baseline-screen').hidden && !!document.querySelector('.baseline-summary')"),
    'baseline review did not render',
  );

  const initial = await evaluate(cdp, `(() => ({
    introHidden: document.getElementById('intro').hidden,
    kicker: document.querySelector('#baseline-screen .baseline-kicker').textContent,
    heading: document.querySelector('#baseline-screen h1').textContent,
    topology: document.querySelector('.baseline-topology').textContent,
    contextOpen: document.querySelector('.baseline-context').open,
    statuses: Array.from(document.querySelectorAll('.baseline-status')).map((node) => node.textContent),
    primaryActions: document.querySelectorAll('.baseline-actions .btn-primary').length,
  }))()`);
  assert.equal(initial.introHidden, true);
  assert.match(initial.kicker, /^Spectra · /);
  assert.equal(initial.heading, 'Continue with Spectra?');
  assert.match(initial.topology, /macOS \(Primary\).*Web \(Companion\)/);
  assert.equal(initial.contextOpen, false);
  assert.equal(initial.statuses.includes('Observed current'), true);
  assert.equal(initial.primaryActions, 1);

  await waitUntil(
    () => evaluate(cdp, "!!document.querySelector('.baseline-snapshot:not([hidden]) iframe')"),
    'selected snapshot did not render',
  );
  const snapshot = await evaluate(cdp, `(() => {
    const details = document.querySelector('.baseline-snapshot');
    const frame = details.querySelector('iframe');
    return {
      open: details.open,
      label: document.querySelector('.baseline-snapshot-label').textContent,
      sandbox: frame.getAttribute('sandbox'),
      unsafeScript: frame.srcdoc.includes('<script'),
      unsafeHandler: frame.srcdoc.includes('onclick'),
      heading: frame.srcdoc.includes('Selected direction'),
      authoredStyles: frame.srcdoc.includes('font-family:Arial,sans-serif'),
      layoutStyles: frame.srcdoc.includes('display:flex;gap:25px'),
    };
  })()`);
  assert.equal(snapshot.open, false);
  assert.equal(snapshot.label, 'Selected planner direction');
  assert.equal(snapshot.sandbox, '');
  assert.equal(snapshot.unsafeScript, false);
  assert.equal(snapshot.unsafeHandler, false);
  assert.equal(snapshot.heading, true);
  assert.equal(snapshot.authoredStyles, true);
  assert.equal(snapshot.layoutStyles, true);

  // A failed comment remains editable and retryable without navigating away.
  // Feedback never expands the supporting snapshot by surprise.
  await evaluate(cdp, `(() => {
    document.querySelector('.baseline-comment').open = true;
    const input = document.querySelector('.baseline-comment-input');
    input.value = 'x'.repeat(4001);
    document.querySelector('.baseline-comment-send').click();
  })()`);
  await waitUntil(
    () => evaluate(cdp, "document.querySelector('.baseline-comment-status').textContent === 'text-too-long'"),
    'failed baseline comment did not report a retryable error',
  );
  const failedComment = await evaluate(cdp, `(() => ({
    draftLength: document.querySelector('.baseline-comment-input').value.length,
    retryEnabled: !document.querySelector('.baseline-comment-send').disabled,
    baselineVisible: !document.getElementById('baseline-screen').hidden,
    snapshotOpen: document.querySelector('.baseline-snapshot').open,
  }))()`);
  assert.equal(failedComment.draftLength, 4001);
  assert.equal(failedComment.retryEnabled, true);
  assert.equal(failedComment.baselineVisible, true);
  assert.equal(failedComment.snapshotOpen, false);

  await evaluate(cdp, `(() => {
    const input = document.querySelector('.baseline-comment-input');
    input.value = 'Keep the source health summary visible while I review the plan.';
    document.querySelector('.baseline-comment-send').click();
  })()`);
  await waitUntil(
    () => evaluate(cdp, "document.querySelector('.baseline-comment-status').textContent.includes('Waiting for the connected designer.')"),
    'successful baseline comment did not report waiting status',
  );
  const sentComment = await evaluate(cdp, `(() => ({
    draft: document.querySelector('.baseline-comment-input').value,
    retryEnabled: !document.querySelector('.baseline-comment-send').disabled,
    baselineVisible: !document.getElementById('baseline-screen').hidden,
    snapshotOpen: document.querySelector('.baseline-snapshot').open,
  }))()`);
  assert.equal(sentComment.draft, '');
  assert.equal(sentComment.retryEnabled, true);
  assert.equal(sentComment.baselineVisible, true);
  assert.equal(sentComment.snapshotOpen, false);
  const feedbackContract = await (await fetch(`http://127.0.0.1:${port}/api/agent/contract`)).json();
  assert.equal(feedbackContract.contract.pending_chat.text, 'Keep the source health summary visible while I review the plan.');

  assert.equal(await evaluate(cdp, `(() => {
    const evidence = document.querySelector('.baseline-evidence');
    evidence.querySelector('summary').click();
    return evidence.open && evidence.textContent.includes('src/App.tsx') && evidence.textContent.includes('OBSERVED');
  })()`), true);

  const evidencePath = process.env.GROUNDWORK_VISUAL_EVIDENCE;
  if (evidencePath) {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(evidencePath, Buffer.from(screenshot.data, 'base64'));
  }

  await evaluate(cdp, "document.querySelector('.baseline-actions .btn-primary').click()");
  const contractResponse = await fetch(`http://127.0.0.1:${port}/api/agent/contract`);
  const contract = await contractResponse.json();
  const candidate = contract.contract.candidates[0];
  assert.notEqual(candidate.id, 'platform-target');
  assert.notEqual(candidate.id, 'nav-structure');
  const answerResponse = await fetch(`http://127.0.0.1:${port}/api/agent/answer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...contract.contract,
      answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'Next unresolved browser regression.' },
      seq: contract.seq,
    }),
  });
  const answer = await answerResponse.json();
  assert.equal(answer.ok, true, JSON.stringify(answer));
  await waitUntil(
    () => evaluate(cdp, "!document.getElementById('decision').hidden && document.getElementById('decision-title').textContent.length > 0"),
    'adaptive next decision did not reach the browser',
    180,
  );
  assert.match(await evaluate(cdp, "document.getElementById('agent-strip-text').textContent"), /Next unresolved browser regression\./);
  await evaluate(cdp, "document.getElementById('rail-saved').click()");
  assert.equal(await evaluate(cdp, "!document.getElementById('workspace-screen').hidden && document.getElementById('rail-saved').getAttribute('aria-current') === 'page'"), true);
  await waitUntil(() => evaluate(cdp, "document.querySelectorAll('.workspace-card').length === 2"), 'saved alternatives missing');
  await evaluate(cdp, "document.querySelectorAll('.workspace-card button')[1].click()");
  await waitUntil(() => evaluate(cdp, "document.querySelectorAll('.workspace-card button')[1].getAttribute('aria-pressed') === 'true'"), 'selection not saved');
  await cdp.send('Page.reload');
  await waitUntil(() => evaluate(cdp, "document.querySelectorAll('.workspace-card button')[1]?.getAttribute('aria-pressed') === 'true'"), 'selection lost on reload');
  const exported = await (await fetch(`http://127.0.0.1:${port}/api/workspace/export`)).json();
  assert.equal(exported.selected.mockup.label, 'Direction B');
  assert.equal(exported.feedback[0].status, 'processed');

});

test('baseline opens on one action, shows the posted decision in place, and the rail switches destinations', async (t) => {
  const chrome = chromeExecutable();
  if (!chrome) { t.skip('Chrome or Chromium is required for the browser interaction check'); return; }

  const fixture = makeBootstrap();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-one-panel-chrome-'));
  const port = await reservePort();
  const debugPort = await reservePort();
  let server;
  let browser;
  let cdp;
  t.after(async () => {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch { /* force stop below */ }
      cdp.close();
    }
    await terminate(browser);
    await terminate(server);
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(fixture.temp, { recursive: true, force: true });
  });

  server = spawn(process.execPath, [SERVER, '--bootstrap', fixture.bootstrap, '--port', String(port)], {
    cwd: ROOT,
    env: { ...process.env, GROUNDWORK_DESIGNER_STATE_FILE: path.join(fixture.temp, 'designer-state.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLogs = '';
  server.stdout.on('data', (chunk) => { serverLogs += chunk; });
  server.stderr.on('data', (chunk) => { serverLogs += chunk; });
  await waitUntil(async () => {
    if (server.exitCode !== null) throw new Error(serverLogs);
    try { return (await fetch(`http://127.0.0.1:${port}/api/session`)).ok; } catch { return false; }
  }, 'designer server did not start');

  // The host posts the next decision BEFORE the user opens the browser — the
  // case that previously left the pending decision invisible behind a click.
  const contract = await (await fetch(`http://127.0.0.1:${port}/api/agent/contract`)).json();
  const candidate = contract.contract.candidates[0];
  const answer = await (await fetch(`http://127.0.0.1:${port}/api/agent/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...contract.contract,
      answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'Posted before the user arrived.' },
      seq: contract.seq,
    }),
  })).json();
  assert.equal(answer.ok, true, JSON.stringify(answer));

  const posted = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json();
  assert.equal(posted.route, 'baseline');
  assert.ok(posted.pendingDecision, 'session must expose the decision the host already posted');
  assert.equal(posted.pendingDecision.categoryId, candidate.id);
  assert.ok(posted.pendingDecision.decision.options.length > 0);

  browser = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,1000', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserLogs = '';
  browser.stderr.on('data', (chunk) => { browserLogs += chunk; });
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await waitUntil(
    () => evaluate(cdp, "document.readyState === 'complete' && !document.getElementById('baseline-screen').hidden && !!document.querySelector('.baseline-summary')"),
    'baseline review did not render',
  );

  const layout = await evaluate(cdp, `(() => {
    const screen = document.getElementById('baseline-screen');
    const buttons = Array.from(screen.querySelectorAll('button'));
    const headline = screen.querySelector('h1');
    return {
      firstButtonId: buttons[0]?.id || '',
      firstButtonText: buttons[0]?.textContent || '',
      headlineBeforeAction: Boolean(headline) &&
        (headline.compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      actionBeforeSummary:
        (document.getElementById('baseline-continue')
          .compareDocumentPosition(screen.querySelector('.baseline-summary')) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      actionBeforeComment:
        (document.getElementById('baseline-continue')
          .compareDocumentPosition(screen.querySelector('.baseline-comment')) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      primaryCount: screen.querySelectorAll('.btn-primary').length,
      commentSendQuiet: document.getElementById('baseline-comment-send').classList.contains('btn-quiet'),
      pendingOptions: screen.querySelectorAll('.baseline-pending .option').length,
      pendingHidden: screen.querySelector('.baseline-pending').hidden,
      contextOpen: screen.querySelector('.baseline-context').open,
      nextLabel: screen.querySelector('.baseline-next-label')?.textContent || '',
      savedWorkInside: Boolean(screen.querySelector('#workspace-screen')),
    };
  })()`);

  assert.equal(layout.firstButtonId, 'baseline-continue', 'the real next action must be the first control');
  assert.equal(layout.firstButtonText, 'Continue');
  assert.ok(layout.nextLabel.includes(posted.pendingDecision.title), 'quiet next-step context must name the pending decision');
  assert.equal(layout.headlineBeforeAction, true);
  assert.equal(layout.actionBeforeSummary, true);
  assert.equal(layout.actionBeforeComment, true);
  assert.equal(layout.primaryCount, 1, 'only one control on this screen may carry primary weight');
  assert.equal(layout.commentSendQuiet, true);
  assert.equal(layout.pendingHidden, false);
  assert.equal(layout.contextOpen, false, 'source context must not compete with the primary decision');
  assert.ok(layout.pendingOptions > 0, 'a posted decision must show its options without a second click');
  assert.equal(layout.savedWorkInside, false, 'saved work must not precede the task on this screen');

  // The rail is the navigation model: Designer is one destination among the
  // components Groundwork ships.
  const rail = await evaluate(cdp, `(() => ({
    destinations: Array.from(document.querySelectorAll('button.rail-item')).map((item) => item.dataset.destination),
    staticEntries: document.querySelectorAll('.rail-item--static').length,
    staticButtons: document.querySelectorAll('button.rail-item--static').length,
    staticNotes: Array.from(document.querySelectorAll('.rail-item--static .rail-item-note')).every((note) => note.textContent.trim().length > 0),
    designerSelected: document.getElementById('rail-designer').getAttribute('aria-current') === 'page',
  }))()`);
  assert.deepEqual(rail.destinations, ['designer', 'saved', 'output']);
  assert.ok(rail.staticEntries >= 4, 'chat-only components must still be listed');
  assert.equal(rail.staticButtons, 0, 'a component with no surface here must not look clickable');
  assert.equal(rail.staticNotes, true);
  assert.equal(rail.designerSelected, true);

  await evaluate(cdp, "document.getElementById('rail-output').click()");
  const output = await evaluate(cdp, `(() => ({
    doneVisible: !document.getElementById('done').hidden,
    emptyVisible: !document.getElementById('done-empty').hidden,
    bodyHidden: document.getElementById('done-body').hidden,
    baselineHidden: document.getElementById('baseline-screen').hidden,
    selected: document.getElementById('rail-output').getAttribute('aria-current') === 'page',
  }))()`);
  assert.equal(output.doneVisible, true);
  assert.equal(output.emptyVisible, true, 'design output must state that nothing is emitted yet');
  assert.equal(output.bodyHidden, true, 'no emit controls before there is anything to emit');
  assert.equal(output.baselineHidden, true);
  assert.equal(output.selected, true);

  await evaluate(cdp, "document.getElementById('rail-designer').click()");
  assert.equal(await evaluate(cdp, "!document.getElementById('baseline-screen').hidden"), true,
    'returning to Designer must resume the same step, not restart');

  // Picking the posted decision in place records the pick and moves the turn on.
  await evaluate(cdp, "document.querySelector('.baseline-pending .option').click()");
  await waitUntil(async () => {
    const state = await (await fetch(`http://127.0.0.1:${port}/api/current`)).json();
    return (state.state?.history || []).some((entry) => entry.category_id === candidate.id);
  }, 'picking from the baseline screen did not record the decision');
  const afterPick = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json();
  assert.equal(afterPick.route, 'next-unresolved', 'answering the decision moves past baseline review');
  assert.equal(afterPick.pendingDecision, null);

  // The walk advances on its own timers. A destination the user selected must
  // survive that, and the rail must say Designer moved rather than silently
  // pulling the view back.
  await waitUntil(() => evaluate(cdp, "!document.getElementById('await-pane').hidden"),
    'the poll loop did not take the view after the pick');
  await evaluate(cdp, "document.getElementById('rail-saved').click()");

  // The host posts the next decision while the user is reading Saved work.
  const nextContract = await (await fetch(`http://127.0.0.1:${port}/api/agent/contract`)).json();
  const nextCandidate = nextContract.contract.candidates[0];
  const nextAnswer = await (await fetch(`http://127.0.0.1:${port}/api/agent/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...nextContract.contract,
      answer: { action: 'ask', chosen_category_id: nextCandidate.id, rationale: 'Posted while the user was elsewhere.' },
      seq: nextContract.seq,
    }),
  })).json();
  assert.equal(nextAnswer.ok, true, JSON.stringify(nextAnswer));

  await waitUntil(
    () => evaluate(cdp, "document.querySelector('#rail-designer .rail-item-note').textContent.includes('updated')"),
    'the rail never reported that Designer moved on',
  );
  const stayed = await evaluate(cdp, `(() => ({
    workspaceVisible: !document.getElementById('workspace-screen').hidden,
    decisionHidden: document.getElementById('decision').hidden,
    awaitHidden: document.getElementById('await-pane').hidden,
    savedSelected: document.getElementById('rail-saved').getAttribute('aria-current') === 'page',
  }))()`);
  assert.equal(stayed.workspaceVisible, true, 'the walk pulled the user off the destination they chose');
  assert.equal(stayed.decisionHidden, true);
  assert.equal(stayed.awaitHidden, true);
  assert.equal(stayed.savedSelected, true);

  // Returning to Designer lands on the step the walk reached, not a restart.
  await evaluate(cdp, "document.getElementById('rail-designer').click()");
  const resumed = await evaluate(cdp, `(() => ({
    decisionVisible: !document.getElementById('decision').hidden,
    title: document.getElementById('decision-title').textContent,
    note: document.querySelector('#rail-designer .rail-item-note').textContent,
  }))()`);
  assert.equal(resumed.decisionVisible, true, 'returning to Designer must show the step the walk reached');
  assert.ok(resumed.title.length > 0);
  assert.match(resumed.note, /running here/);

  // A finished walk has no live decision. Returning to Designer must not reopen
  // the answered one, because a second pick would re-merge an already-decided
  // dimension. Completing the walk must also respect the destination the user
  // is on — it is the one transition that could still move them.
  // Hand the turn back to the host so it can close the walk.
  await evaluate(cdp, "document.querySelector('#options .option').click()");
  await waitUntil(() => evaluate(cdp, "!document.getElementById('await-pane').hidden"),
    'the pick did not hand the turn back to the host');
  await evaluate(cdp, "document.getElementById('rail-saved').click()");
  const doneContract = await (await fetch(`http://127.0.0.1:${port}/api/agent/contract`)).json();
  const doneAnswer = await (await fetch(`http://127.0.0.1:${port}/api/agent/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...doneContract.contract,
      answer: { action: 'done', rationale: 'Enough for this session.' },
      seq: doneContract.seq,
    }),
  })).json();
  assert.equal(doneAnswer.ok, true, JSON.stringify(doneAnswer));
  await waitUntil(
    () => evaluate(cdp, "document.querySelector('#rail-designer .rail-item-note').textContent.includes('complete')"),
    'the rail never reported the walk complete',
  );
  const completedElsewhere = await evaluate(cdp, `(() => ({
    workspaceVisible: !document.getElementById('workspace-screen').hidden,
    doneHidden: document.getElementById('done').hidden,
    savedSelected: document.getElementById('rail-saved').getAttribute('aria-current') === 'page',
  }))()`);
  assert.equal(completedElsewhere.workspaceVisible, true,
    'completing the walk pulled the user off the destination they chose');
  assert.equal(completedElsewhere.doneHidden, true);
  assert.equal(completedElsewhere.savedSelected, true);

  await evaluate(cdp, "document.getElementById('rail-output').click()");
  assert.equal(await evaluate(cdp, "!document.getElementById('done-body').hidden"), true,
    'Design output must hold the finished result');
  await evaluate(cdp, "document.getElementById('rail-designer').click()");
  const terminal = await evaluate(cdp, `(() => ({
    completeVisible: !document.getElementById('walk-complete').hidden,
    liveOptions: document.querySelectorAll('#options .option').length,
    decisionHidden: document.getElementById('decision').hidden,
    designerNote: document.querySelector('#rail-designer .rail-item-note').textContent,
  }))()`);
  assert.equal(terminal.completeVisible, true, 'Designer must land on a terminal screen after the walk completes');
  assert.equal(terminal.liveOptions, 0, 'an answered decision must not stay clickable');
  assert.equal(terminal.decisionHidden, true);
  assert.match(terminal.designerNote, /complete/);
});
