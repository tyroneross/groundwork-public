// test_gallery_profile.mjs — the gallery's revealed preference must compound
// into Groundwork's EXISTING cross-session taste profile (designer/decide/
// profile.py), across projects and over time, without ever slowing, breaking,
// or leaking out of the gallery.
//
// Every server here is booted the way the DOCUMENTED launch boots it
// (references/mockups.md §4): from a foreign cwd, with PYTHONPATH stripped from
// the environment. scripts/check.sh exports PYTHONPATH, so a test that inherited
// it would pass while `python3 -m designer.decide.profile` failed with
// ModuleNotFoundError in real use — a green gate certifying a dead feature.
//
// Every server here also gets an isolated GROUNDWORK_PROFILE_STORE. Nothing in
// this file may touch the developer's real ~/dev/designs/.groundwork-profile.json.

import test from 'node:test';
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

/** How long a bare python3 interpreter takes to boot on this machine. The
 *  reference for the non-blocking proof: recording spawns exactly this. */
function pythonBootMs() {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('python3', ['-c', 'pass'], { stdio: 'ignore' });
    child.on('error', () => resolve(null));
    child.on('exit', () => resolve(Date.now() - started));
  });
}

const MANIFEST = {
  screens: [{ id: 'planner', name: 'Planner' }, { id: 'review', name: 'Review' }],
  slots: [
    { screen_id: 'planner', screen_name: 'Planner', mode: 'warm-craft', html_path: 'planner-warm-craft.html', status: 'authored' },
    { screen_id: 'planner', screen_name: 'Planner', mode: 'glass-workspace', html_path: 'planner-glass-workspace.html', status: 'authored' },
    { screen_id: 'review', screen_name: 'Review', mode: 'data-narrative', html_path: 'review-data-narrative.html', status: 'authored' },
  ],
};

function makeGalleryDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-profile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(MANIFEST));
  for (const slot of MANIFEST.slots) {
    fs.writeFileSync(path.join(dir, slot.html_path),
      '<!doctype html><main data-component="PlanInput"><button>Plan today</button></main>');
  }
  return dir;
}

/** Boot gallery mode the way the documented launch does: foreign cwd, no
 *  PYTHONPATH, isolated profile store. */
async function startGallery(t, galleryDir, { store, env = {}, args = [] } = {}) {
  const port = await reservePort();
  const childEnv = { ...process.env, ...env };
  delete childEnv.PYTHONPATH;              // the production launch has none
  if (store) childEnv.GROUNDWORK_PROFILE_STORE = store;
  const child = spawn(process.execPath, [
    SERVER, '--mode', 'gallery', '--dir', galleryDir,
    '--title', 'Profile test', '--port', String(port), ...args,
  ], { cwd: os.tmpdir(), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(() => { if (child.exitCode == null) child.kill('SIGTERM'); });
  const base = 'http://127.0.0.1:' + port;
  await waitForServer(base, child, () => logs);
  // The profile read token is printed on the launch banner and NEVER served in
  // any HTML — that is what keeps the machine-global store out of reach of
  // same-origin slot script. Reading it from stdout is exactly how the user and
  // the host agent get it.
  await waitUntil(() => /__gallery\/profile\?token=/.test(logs),
    'the launch banner never printed a profile read token: ' + logs);
  const token = logs.match(/__gallery\/profile\?token=([\w-]+)/)[1];
  const profileUrl = `${base}/__gallery/profile?token=${token}`;
  return { base, child, token, profileUrl, logs: () => logs };
}

function post(base, row) {
  return fetch(base + '/__canvas/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
}

function readStore(store) {
  try { return JSON.parse(fs.readFileSync(store, 'utf-8')); } catch { return null; }
}

function countOf(store, dim, value) {
  const entry = readStore(store)?.dimensions?.[dim];
  return entry ? (entry.value_counts[JSON.stringify(value)] || 0) : 0;
}

const ANNOTATION_COMMENT = 'ZZSECRETZZ this comment text must never reach the global profile';

test('gallery picks, ratings and annotations compound into the cross-session profile', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-store-'));
  t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
  const store = path.join(storeDir, 'profile.json');

  const { base, profileUrl } = await startGallery(t, galleryDir, { store });

  // --- the four revealed-preference acts -----------------------------------
  const acts = [
    { kind: 'pick', screen: 'planner', slot: 'planner-warm-craft.html' },
    { kind: 'rate', slot: 'planner-glass-workspace.html', rating: 'yay' },
    { kind: 'rate', slot: 'review-data-narrative.html', rating: 'nay' },
    {
      kind: 'annotation', slot: 'planner-warm-craft.html',
      annotation: {
        id: 'ann-1', marker: 'dot', x: 0.4, y: 0.4,
        target: { selector: '[data-component="PlanInput"]', component: 'PlanInput', tag: 'MAIN' },
        comment: ANNOTATION_COMMENT,
      },
    },
  ];
  for (const act of acts) {
    const response = await post(base, act);
    assert.equal(response.status, 200, 'feedback POST must succeed: ' + act.kind);
    assert.equal((await response.json()).ok, true, 'feedback POST must return ok:true');
  }

  await waitUntil(
    () => countOf(store, 'design_mode', 'warm-craft') === 1
      && countOf(store, 'design_mode_liked', 'glass-workspace') === 1
      && countOf(store, 'design_mode_disliked', 'data-narrative') === 1
      && countOf(store, 'critique_focus', 'PlanInput') === 1,
    'the four gallery acts did not reach the profile store: ' + JSON.stringify(readStore(store)),
  );

  // --- existing behavior is untouched ---------------------------------------
  const selections = await (await fetch(base + '/__gallery/selections')).json();
  assert.equal(selections.schema, 'groundwork.gallery-selections/v2');
  assert.equal(selections.picks.planner, 'planner-warm-craft.html');
  assert.equal(selections.ratings['planner-glass-workspace.html'], 'yay');
  assert.equal(selections.ratings['review-data-narrative.html'], 'nay');
  assert.equal(selections.annotations['planner-warm-craft.html'].length, 1);
  const selectionsOnDisk = JSON.parse(
    fs.readFileSync(path.join(galleryDir, '.canvas', 'gallery-selections.json'), 'utf-8'));
  assert.equal(selectionsOnDisk.schema, 'groundwork.gallery-selections/v2');
  const feedbackLines = fs.readFileSync(path.join(galleryDir, '.canvas', 'feedback.jsonl'), 'utf-8')
    .trim().split('\n');
  assert.equal(feedbackLines.length, acts.length, 'feedback.jsonl must still get every row');

  // --- GET /__gallery/profile reads it back ---------------------------------
  assert.equal((await fetch(base + '/__gallery/profile')).status, 403,
    'the global profile must not be readable without the banner token');
  const view = await (await fetch(profileUrl)).json();
  assert.equal(view.enabled, true);
  assert.equal(view.store, store);
  assert.equal(view.profile.schema, 'groundwork.decide.profile/v1');
  assert.equal(view.profile.dimensions.design_mode.value_counts['"warm-craft"'], 1);
  assert.equal(view.profile.dimensions.critique_focus.value_counts['"PlanInput"'], 1);

  // A corrupt or wrong-schema store degrades to an empty profile, never a 500 —
  // the same two conditions profile.py's load_profile() applies.
  const goodBytes = fs.readFileSync(store, 'utf-8');
  for (const bad of ['{not json', '{"schema":"someone-elses/v9","dimensions":{}}', '{"schema":"groundwork.decide.profile/v1"}']) {
    fs.writeFileSync(store, bad);
    const degraded = await fetch(profileUrl);
    assert.equal(degraded.status, 200, 'a corrupt store must not error the endpoint');
    assert.deepEqual((await degraded.json()).profile,
      { schema: 'groundwork.decide.profile/v1', dimensions: {} });
  }
  fs.writeFileSync(store, goodBytes);

  // --- PRIVACY BOUNDARY: mode ids and component names only ------------------
  const storeBytes = fs.readFileSync(store, 'utf-8');
  assert.ok(!storeBytes.includes('ZZSECRETZZ'), 'annotation comment text leaked into the profile');
  assert.ok(!storeBytes.includes('.html'), 'a slot filename leaked into the profile');
  assert.ok(!storeBytes.includes(galleryDir), 'a file path leaked into the profile');
  assert.ok(!storeBytes.includes('planner'), 'a screen id / project name leaked into the profile');

  // --- deliberate non-signals must NOT add confirmations --------------------
  // A profile confirmation is meant to be a distinct revealed preference; three
  // of them settle a dimension. Repeat clicks, "ok", notes, annotation edits,
  // and unknown slots must all leave the counts exactly where they are.
  const before = JSON.stringify(readStore(store));
  const boot = await pythonBootMs();
  for (const act of [
    { kind: 'rate', slot: 'planner-glass-workspace.html', rating: 'yay' },   // same rating again
    { kind: 'rate', slot: 'planner-warm-craft.html', rating: 'ok' },         // "fine", not "I want this"
    { kind: 'note', slot: 'planner-warm-craft.html', text: 'ZZSECRETZZ note text' },
    { kind: 'pick', screen: 'planner', slot: 'planner-warm-craft.html' },    // same pick again
    {                                                                        // edit of an existing annotation
      kind: 'annotation', slot: 'planner-warm-craft.html',
      annotation: {
        id: 'ann-1', marker: 'dot', x: 0.5, y: 0.5,
        target: { component: 'PlanInput' }, comment: ANNOTATION_COMMENT + ' (edited)',
      },
    },
    { kind: 'rate', slot: 'not-in-manifest.html', rating: 'yay' },           // unknown slot
  ]) {
    assert.equal((await post(base, act)).status, 200);
  }
  await delay(Math.max(500, (boot ?? 100) * 4));   // ample time for any record to land
  assert.equal(JSON.stringify(readStore(store)), before,
    'a non-signal act changed the profile');
  assert.ok(!fs.readFileSync(store, 'utf-8').includes('ZZSECRETZZ'), 'note text leaked into the profile');
});

test('one review session contributes at most one confirmation per preference', async (t) => {
  // Three confirmations mark a dimension as SETTLED taste (profile.py
  // _SETTLED_AT), which the host agent is then told to lead with. Toggling
  // between ratings while comparing options is ordinary review behavior, and it
  // must not be able to manufacture settled taste inside a single sitting.
  const galleryDir = makeGalleryDir(t);
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-store-'));
  t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
  const store = path.join(storeDir, 'profile.json');

  const { base } = await startGallery(t, galleryDir, { store });
  const boot = await pythonBootMs();

  const slot = 'planner-warm-craft.html';
  for (const rating of ['yay', 'ok', 'yay', 'ok', 'yay', 'nay', 'yay']) {
    assert.equal((await post(base, { kind: 'rate', slot, rating })).status, 200);
  }
  // The same winner picked on every screen is also one preference, not three.
  for (const screen of ['planner', 'review', 'planner']) {
    assert.equal((await post(base, { kind: 'pick', screen, slot })).status, 200);
  }
  await waitUntil(() => countOf(store, 'design_mode', 'warm-craft') >= 1,
    'no record ever landed: ' + JSON.stringify(readStore(store)));
  await delay(Math.max(500, (boot ?? 100) * 4));

  assert.equal(countOf(store, 'design_mode_liked', 'warm-craft'), 1,
    'toggling ratings manufactured extra confirmations');
  assert.equal(countOf(store, 'design_mode_disliked', 'warm-craft'), 1);
  assert.equal(countOf(store, 'design_mode', 'warm-craft'), 1,
    'picking one mode on several screens counted more than once');
  const liked = readStore(store).dimensions.design_mode_liked;
  assert.ok(liked.sessions < 3, `one sitting reached settled taste (sessions=${liked.sessions})`);
});

test('a cross-site page cannot write into the global profile', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-store-'));
  t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
  const store = path.join(storeDir, 'profile.json');

  const { base } = await startGallery(t, galleryDir, { store });
  const boot = await pythonBootMs();

  // A CORS-simple POST from any page the user has open, if it guesses the port.
  const evil = await fetch(base + '/__canvas/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' },
    body: JSON.stringify({ kind: 'pick', screen: 'planner', slot: 'planner-warm-craft.html' }),
  });
  assert.equal(evil.status, 403, 'a foreign Origin must not be able to write');
  await delay(Math.max(400, (boot ?? 100) * 3));
  assert.equal(fs.existsSync(store), false, 'a cross-site POST reached the profile store');
  assert.equal(fs.existsSync(path.join(galleryDir, '.canvas', 'gallery-selections.json')), false,
    'a cross-site POST reached the selections file');

  // The gallery's own requests carry a loopback Origin and must still work.
  const port = new URL(base).port;
  for (const origin of [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://0.0.0.0:${port}`]) {
    const ok = await fetch(base + '/__canvas/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ kind: 'rate', slot: 'planner-warm-craft.html', rating: 'yay' }),
    });
    assert.equal(ok.status, 200, `the gallery's own Origin ${origin} was rejected`);
  }
});

test('recording never blocks the feedback response', async (t) => {
  const galleryDir = makeGalleryDir(t);
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-store-'));
  t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
  const store = path.join(storeDir, 'profile.json');

  const { base } = await startGallery(t, galleryDir, { store });

  // Reference: one bare python3 boot. Recording spawns exactly this, so if the
  // response were stalled on the subprocess, THREE responses could not come back
  // in less time than ONE boot.
  const boot = await pythonBootMs();
  assert.ok(boot != null, 'python3 must be available for this test to mean anything');

  const started = Date.now();
  for (const slot of MANIFEST.slots) {
    assert.equal((await post(base, { kind: 'rate', slot: slot.html_path, rating: 'yay' })).status, 200);
  }
  const elapsed = Date.now() - started;

  // Ordering proof (the discriminating one): all three responses are already in
  // hand while the profile store does not yet hold all three records.
  const dimsAtResponse = Object.keys(readStore(store)?.dimensions ?? {}).length;
  const likedAtResponse = readStore(store)?.dimensions?.design_mode_liked?.sessions ?? 0;
  assert.ok(likedAtResponse < 3,
    `responses waited on the recorder (${likedAtResponse}/3 records already written, ${dimsAtResponse} dims)`);

  // Margin proof: 3 round-trips beat 1 interpreter boot.
  assert.ok(elapsed < boot,
    `3 feedback round-trips took ${elapsed}ms vs a single python3 boot of ${boot}ms — the response is being stalled`);

  await waitUntil(
    () => (readStore(store)?.dimensions?.design_mode_liked?.sessions ?? 0) === 3,
    'the queued records never drained: ' + JSON.stringify(readStore(store)),
  );
});

for (const [label, options] of [
  ['GROUNDWORK_PROFILE=off', { env: { GROUNDWORK_PROFILE: 'off' } }],
  ['--no-profile', { args: ['--no-profile'] }],
]) {
  test(`${label} records nothing at all`, async (t) => {
    const galleryDir = makeGalleryDir(t);
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-store-'));
    t.after(() => fs.rmSync(storeDir, { recursive: true, force: true }));
    const store = path.join(storeDir, 'profile.json');

    const { base, profileUrl } = await startGallery(t, galleryDir, { store, ...options });
    const boot = await pythonBootMs();

    for (const act of [
      { kind: 'pick', screen: 'planner', slot: 'planner-warm-craft.html' },
      { kind: 'rate', slot: 'planner-glass-workspace.html', rating: 'yay' },
      { kind: 'rate', slot: 'review-data-narrative.html', rating: 'nay' },
      {
        kind: 'annotation', slot: 'planner-warm-craft.html',
        annotation: {
          id: 'ann-off', marker: 'dot', x: 0.4, y: 0.4,
          target: { component: 'PlanInput' }, comment: 'off-mode annotation',
        },
      },
    ]) {
      assert.equal((await post(base, act)).status, 200);
    }
    await delay(Math.max(500, (boot ?? 100) * 4));

    assert.equal(fs.existsSync(store), false, `${label} still wrote the profile store`);
    assert.equal(fs.readdirSync(storeDir).length, 0, `${label} wrote something into the store dir`);

    // ...and the gallery behaves exactly as it does without the profile.
    const selections = await (await fetch(base + '/__gallery/selections')).json();
    assert.equal(selections.picks.planner, 'planner-warm-craft.html');
    assert.equal(selections.ratings['planner-glass-workspace.html'], 'yay');
    assert.equal(selections.annotations['planner-warm-craft.html'].length, 1);
    assert.equal(fs.readFileSync(path.join(galleryDir, '.canvas', 'feedback.jsonl'), 'utf-8')
      .trim().split('\n').length, 4);

    const view = await (await fetch(profileUrl)).json();
    assert.equal(view.enabled, false, `${label} must report recording as off`);
    assert.deepEqual(view.profile, { schema: 'groundwork.decide.profile/v1', dimensions: {} });
  });
}
