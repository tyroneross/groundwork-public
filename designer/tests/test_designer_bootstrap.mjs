import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'designer', 'server', 'designer-server.mjs');
const FIXTURE = path.join(ROOT, 'docs', 'contracts', 'fixtures', 'spectra-visual-bootstrap.json');

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function request(port, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* return raw */ }
        resolve({ status: res.statusCode, json, raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitForServer(port, proc, logs, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (proc.exitCode !== null) throw new Error(`server exited early: ${logs()}`);
    try {
      const response = await request(port, 'GET', '/api/session');
      if (response.status === 200) return response;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start: ${logs()}`);
}

function makeBootstrap() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-bootstrap-'));
  const repoInput = path.join(temp, 'Spectra');
  fs.mkdirSync(repoInput);
  const repo = fs.realpathSync(repoInput);
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"spectra"}\n');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'App.tsx'), 'export const App = () => null;\n');
  const payload = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  payload.product.repoPath = repo;
  payload.product.outputPath = path.join(repo, '.designdoc');
  payload.product.runningUrl = 'http://127.0.0.1:4173';
  payload.context.designBaseline.rationale = `Preserve the baseline; never expose ${repo}.`;
  const bootstrap = path.join(temp, 'bootstrap.json');
  fs.writeFileSync(bootstrap, JSON.stringify(payload));
  return { temp, repo, bootstrap };
}

function mockupsDir(fixture) {
  const directory = path.join(fixture.repo, '.designdoc', 'mockups');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function writeSelection(fixture, selection, files = {}) {
  const directory = mockupsDir(fixture);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), content);
  }
  fs.writeFileSync(path.join(directory, 'selection.json'), JSON.stringify(selection));
  return directory;
}

function launch(t, port, bootstrap) {
  let logs = '';
  const proc = spawn(process.execPath, [SERVER, '--bootstrap', bootstrap, '--port', String(port)], {
    cwd: ROOT,
    env: { ...process.env, GROUNDWORK_DESIGNER_STATE_FILE: path.join(path.dirname(bootstrap), 'designer-state.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (chunk) => { logs += chunk; });
  proc.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(() => proc.kill('SIGKILL'));
  return { proc, logs: () => logs };
}

test('bootstrap opens a redacted baseline and resumes without resetting state', async (t) => {
  const fixture = makeBootstrap();
  t.after(() => fs.rmSync(fixture.temp, { recursive: true, force: true }));
  const port = await reservePort();
  const running = launch(t, port, fixture.bootstrap);
  const started = await waitForServer(port, running.proc, running.logs);
  const session = started.json;

  assert.equal(session.status, 'loaded');
  assert.equal(session.route, 'baseline');
  assert.equal(session.drive, 'adaptive');
  assert.equal(session.product.name, 'Spectra');
  assert.deepEqual(session.surfaces.map(({ platform, role }) => ({ platform, role })), [
    { platform: 'macos', role: 'primary' },
    { platform: 'web', role: 'companion' },
  ]);
  assert.equal(session.facts.some((fact) => fact.categoryId === 'nav-structure' && fact.provenance === 'OBSERVED'), true);
  assert.equal(session.designBaseline.tokenSetId, 'tokens-spectra-observed');
  assert.ok(session.nextDecision.categoryId, 'baseline must expose the next decision identity');
  assert.notEqual(session.nextDecision.categoryId, 'platform-target');
  assert.notEqual(session.nextDecision.categoryId, 'nav-structure');
  assert.equal(JSON.stringify(session).includes(fixture.repo), false, 'session must redact absolute repo paths');
  assert.equal(JSON.stringify(session).includes('127.0.0.1:4173'), false, 'session must not disclose running URLs');
  assert.equal(Object.hasOwn(session.product, 'repoPath'), false);
  assert.equal(Object.hasOwn(session.product, 'outputPath'), false);
  assert.equal(Object.hasOwn(session.product, 'runningUrl'), false);

  const initOne = await request(port, 'GET', '/api/init');
  const initTwo = await request(port, 'GET', '/api/init');
  assert.equal(initOne.status, 200);
  assert.equal(initTwo.status, 200);
  assert.deepEqual(initTwo.json.step.state.history, initOne.json.step.state.history, 'refresh must not duplicate bootstrap observations');

  const contract = await request(port, 'GET', '/api/agent/contract');
  assert.equal(contract.status, 200);
  const candidateIds = contract.json.contract.candidates.map((candidate) => candidate.id);
  assert.equal(candidateIds.includes('platform-target'), false, 'known platform must not be asked again');
  assert.equal(candidateIds.includes('nav-structure'), false, 'known navigation must not be asked again');

  const override = await request(port, 'POST', '/api/pick', {
    category: 'platform-target', option: 'platform-web', seq: contract.json.seq,
  });
  assert.deepEqual(override.json.picked, { category: 'platform-target', option: 'platform-web' });
  const changed = (await request(port, 'GET', '/api/session')).json;
  assert.equal(changed.surfaces.find((surface) => surface.role === 'primary').platform, 'web');
  assert.equal(changed.surfaces.some((surface) => surface.role === 'companion' && surface.id === 'surface-web'), true,
    'primary override must preserve companion topology');
  const platformFact = changed.facts.find((fact) => fact.categoryId === 'platform-target');
  assert.equal(platformFact.provenance, 'DECIDED');
  assert.equal(platformFact.observedOptionId, 'platform-macos');
  assert.equal(platformFact.currentOptionId, 'platform-web');
  assert.equal(changed.decisions.some((decision) =>
    decision.categoryId === 'platform-target' && decision.optionId === 'platform-web' && decision.status === 'changed'), true);

  const modeGuard = await request(port, 'POST', '/api/mode', { mode: 'general', drive: 'standard' });
  assert.equal(modeGuard.status, 409);
  assert.equal(modeGuard.json.confirmationRequired, true);
  const setupPrompt = await request(port, 'POST', '/api/baseline/change-setup', {});
  assert.equal(setupPrompt.json.confirmationRequired, true);
  const setupOpen = await request(port, 'POST', '/api/baseline/change-setup', { confirm: true });
  assert.deepEqual(setupOpen.json, { ok: true, route: 'setup', reset: false });

  const continued = await request(port, 'POST', '/api/baseline/continue', {});
  assert.equal(continued.json.route, 'next-unresolved');
  const resumed = (await request(port, 'GET', '/api/session')).json;
  assert.equal(resumed.route, 'next-unresolved');
});

test('only answering the posted decision marks the baseline reviewed', async (t) => {
  const fixture = makeBootstrap();
  t.after(() => fs.rmSync(fixture.temp, { recursive: true, force: true }));
  const port = await reservePort();
  const running = launch(t, port, fixture.bootstrap);
  await waitForServer(port, running.proc, running.logs);

  // No decision has been posted, so nothing on the baseline screen can be
  // answered. A pick arriving from anywhere else must leave the review standing.
  const beforePost = (await request(port, 'GET', '/api/session')).json;
  assert.equal(beforePost.route, 'baseline');
  assert.equal(beforePost.pendingDecision, null);
  const strayPick = await request(port, 'POST', '/api/pick', { category: 'platform-target', option: 'platform-web' });
  assert.deepEqual(strayPick.json.picked, { category: 'platform-target', option: 'platform-web' });
  assert.equal((await request(port, 'GET', '/api/session')).json.route, 'baseline',
    'a pick the baseline screen could not have made must not mark the review complete');

  // Post a decision, then answer it: that IS the baseline screen's own action.
  const contract = await request(port, 'GET', '/api/agent/contract');
  const candidate = contract.json.contract.candidates[0];
  const answer = await request(port, 'POST', '/api/agent/answer', {
    ...contract.json.contract,
    answer: { action: 'ask', chosen_category_id: candidate.id, rationale: 'Posted before the user arrived.' },
    seq: contract.json.seq,
  });
  assert.equal(answer.json.ok, true, JSON.stringify(answer.json));

  const posted = (await request(port, 'GET', '/api/session')).json;
  assert.equal(posted.route, 'baseline');
  assert.equal(posted.pendingDecision.categoryId, candidate.id);
  assert.equal(posted.pendingDecision.seq, answer.json.seq);
  assert.ok(posted.pendingDecision.decision.options.length > 0);

  // A valid pick for a DIFFERENT category is not an answer to what the user was
  // shown, so it must not dismiss the review either — with or without a seq.
  const unrelated = await request(port, 'POST', '/api/pick', { category: 'platform-target', option: 'platform-macos' });
  assert.equal(unrelated.status, 200, JSON.stringify(unrelated.json));
  assert.equal((await request(port, 'GET', '/api/session')).json.route, 'baseline',
    'a pick for another category must not mark the baseline reviewed');

  // That unrelated pick handed the turn back, so the host posts again. Answering
  // THAT decision is the baseline screen's own action, and it does continue.
  const reposted = await request(port, 'GET', '/api/agent/contract');
  const nextCandidate = reposted.json.contract.candidates[0];
  const reanswer = await request(port, 'POST', '/api/agent/answer', {
    ...reposted.json.contract,
    answer: { action: 'ask', chosen_category_id: nextCandidate.id, rationale: 'Ask again after the stray pick.' },
    seq: reposted.json.seq,
  });
  assert.equal(reanswer.json.ok, true, JSON.stringify(reanswer.json));
  const live = (await request(port, 'GET', '/api/session')).json;
  assert.equal(live.route, 'baseline');
  assert.equal(live.pendingDecision.categoryId, nextCandidate.id);

  const answered = await request(port, 'POST', '/api/pick', {
    category: live.pendingDecision.categoryId,
    option: live.pendingDecision.decision.options[0].id,
    seq: live.pendingDecision.seq,
  });
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  const resumed = (await request(port, 'GET', '/api/session')).json;
  assert.equal(resumed.route, 'next-unresolved');
  assert.equal(resumed.pendingDecision, null);
});

test('invalid bootstrap fails visibly without falling back to generic setup', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-invalid-bootstrap-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bootstrap = path.join(temp, 'invalid.json');
  fs.writeFileSync(bootstrap, '{"contract":"wrong"}');
  const port = await reservePort();
  const running = launch(t, port, bootstrap);
  const started = await waitForServer(port, running.proc, running.logs);

  assert.equal(started.json.status, 'invalid');
  assert.equal(started.json.bootstrapped, true);
  assert.equal(started.json.route, 'error');
  assert.match(started.json.error.message, /invalid|unavailable/i);
  assert.equal(JSON.stringify(started.json).includes(temp), false);
  const init = await request(port, 'GET', '/api/init');
  assert.equal(init.status, 409);
});

test('baseline snapshot accepts deterministic perScreen and selections records, then rejects unsafe files', async (t) => {
  const fixture = makeBootstrap();
  t.after(() => fs.rmSync(fixture.temp, { recursive: true, force: true }));
  const port = await reservePort();
  const running = launch(t, port, fixture.bootstrap);
  await waitForServer(port, running.proc, running.logs);

  writeSelection(fixture, {
    perScreen: [
      { screen_id: 'beta', html_path: 'beta.html', note: 'Beta direction' },
      { screen_id: 'alpha', html_path: 'alpha.html', note: 'Alpha direction' },
    ],
  }, {
    'alpha.html': '<main>alpha</main>',
    'beta.html': '<main>beta</main>',
  });
  let snapshot = await request(port, 'GET', '/api/baseline/snapshot');
  assert.deepEqual(snapshot.json, { available: true, label: 'Beta direction', html: '<main>beta</main>' });

  writeSelection(fixture, {
    selections: {
      zeta: { html_path: 'zeta.html', note: 'Zeta direction' },
      alpha: { html_path: 'alpha.html', note: 'Alpha direction' },
    },
  }, {
    'zeta.html': '<main>zeta</main>',
  });
  snapshot = await request(port, 'GET', '/api/baseline/snapshot');
  assert.deepEqual(snapshot.json, { available: true, label: 'Alpha direction', html: '<main>alpha</main>' });

  writeSelection(fixture, { perScreen: [{ html_path: '../outside.html' }] });
  fs.writeFileSync(path.join(fixture.repo, '.designdoc', 'outside.html'), '<main>outside</main>');
  snapshot = await request(port, 'GET', '/api/baseline/snapshot');
  assert.deepEqual(snapshot.json, { available: false }, 'traversal must not be read');

  const directory = mockupsDir(fixture);
  const outside = path.join(fixture.temp, 'outside.html');
  fs.writeFileSync(outside, '<main>outside</main>');
  fs.symlinkSync(outside, path.join(directory, 'linked.html'));
  writeSelection(fixture, { perScreen: [{ html_path: 'linked.html' }] });
  snapshot = await request(port, 'GET', '/api/baseline/snapshot');
  assert.deepEqual(snapshot.json, { available: false }, 'symlinked snapshots must not be read');

  fs.writeFileSync(path.join(directory, 'large.html'), Buffer.alloc((2 * 1024 * 1024) + 1, 0x20));
  writeSelection(fixture, { perScreen: [{ html_path: 'large.html' }] });
  snapshot = await request(port, 'GET', '/api/baseline/snapshot');
  assert.deepEqual(snapshot.json, { available: false }, 'oversize snapshots must not be read');
});

test('baseline comments validate input and deliver a trimmed pending_chat to the adaptive host', async (t) => {
  const fixture = makeBootstrap();
  t.after(() => fs.rmSync(fixture.temp, { recursive: true, force: true }));
  const port = await reservePort();
  const running = launch(t, port, fixture.bootstrap);
  await waitForServer(port, running.proc, running.logs);

  for (const [body, reason] of [
    [{ text: null }, 'invalid-text'],
    [{ text: '   ' }, 'empty-text'],
    [{ text: 'x'.repeat(4001) }, 'text-too-long'],
  ]) {
    const response = await request(port, 'POST', '/api/chat', body);
    assert.equal(response.status, 400);
    assert.deepEqual(response.json, { ok: false, reason });
  }

  const sent = await request(port, 'POST', '/api/chat', { text: '  Show the selected snapshot before I decide.  ' });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.ok, true);
  const contract = await request(port, 'GET', '/api/agent/contract');
  assert.equal(contract.json.phase, 'await_agent');
  assert.equal(contract.json.contract.pending_chat.text, 'Show the selected snapshot before I decide.');
  const replay = await request(port, 'GET', '/api/agent/contract');
  assert.deepEqual(replay.json.contract.pending_chat, contract.json.contract.pending_chat, 'polling must retain the note until a valid answer acknowledges it');
});

test('manual launch retains the existing intro route', async (t) => {
  const port = await reservePort();
  let logs = '';
  const proc = spawn(process.execPath, [SERVER, '--port', String(port)], {
    cwd: ROOT,
    env: { ...process.env, GROUNDWORK_DESIGNER_STATE_FILE: path.join(os.tmpdir(), `groundwork-manual-${port}.json`) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (chunk) => { logs += chunk; });
  proc.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(() => proc.kill('SIGKILL'));
  const started = await waitForServer(port, proc, () => logs);
  assert.deepEqual(started.json, {
    status: 'manual', bootstrapped: false, route: 'intro', mode: 'general', drive: 'standard',
  });
});
