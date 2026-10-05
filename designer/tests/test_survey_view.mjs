// test_survey_view.mjs — the Requirements Studio done screen (C3 browser layer).
//
// Pattern: import the browser module directly and drive it with fixture state —
// the same contract test_survey_server.mjs uses for survey-alloc.mjs ("browser
// allocation math"). survey-view.mjs holds the browser logic that can actually be
// WRONG (what to summarize, and whether we may claim a packet exists), so it is
// pure and testable rather than tangled into DOM callbacks.
//
// renderDone takes `doc` by injection, so a ~40-line stub document is enough to
// paint it for real and assert the rendered output — no Chrome, no jsdom.
//
// Run: node --test designer/tests/test_survey_view.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeAnswer, buildReadback, buildDoneModel, renderDone,
  buildWorkflowModel, WORKFLOW_STAGES, formatElapsed, labelForNode, formatCount,
} from '../server/survey-view.mjs';
import { SURVEY_GRAPH } from '../server/survey-server.mjs';

// ── minimal stub document ─────────────────────────────────────────────────────
// Models the DOM semantics renderDone actually relies on: textContent replaces
// children with a text node (so a later appendChild APPENDS rather than clobbers),
// and innerHTML='' clears. Getting this faithful is what makes the assertions real.
function stubDoc(clipboard = null) {
  const makeNode = (tag) => ({
    tagName: String(tag).toUpperCase(),
    className: '',
    type: null,
    children: [],
    attrs: {},
    listeners: {},
    set textContent(v) { this.children = [{ isText: true, textContent: String(v), children: [] }]; },
    get textContent() { return this.children.map((c) => c.textContent).join(''); },
    set innerHTML(v) { if (v === '') this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
  });
  return {
    createElement: makeNode,
    defaultView: { navigator: clipboard ? { clipboard } : {} },
    _host: makeNode('section'),
  };
}
const walk = (node, out = []) => { out.push(node); for (const c of node.children || []) walk(c, out); return out; };
const byClass = (root, cls) => walk(root).filter((n) => String(n.className || '').split(/\s+/).includes(cls));
const oneByClass = (root, cls) => {
  const hits = byClass(root, cls);
  assert.equal(hits.length, 1, `expected exactly one .${cls}, found ${hits.length}`);
  return hits[0];
};

// ── fixture: a completed walk, mirroring the real dogfood run ─────────────────
const OUT_DIR = '/Users/dogfood/ObsidianVault/.obsidian/plugins/writers-block/.designdoc';
const featureCards = [
  { label: 'Quick capture', decision: 'keep', priority: 'P0' },
  { label: 'LinkedIn draft mode', decision: 'keep', priority: 'P0' },
  { label: 'Daily note hook', decision: 'keep', priority: 'P0' },
  { label: 'Tag browser', decision: 'keep', priority: 'P1' },
  { label: 'Search', decision: 'keep', priority: 'P1' },
  { label: 'Templates', decision: 'keep', priority: 'P1' },
  { label: 'Backlinks pane', decision: 'keep', priority: 'P1' },
  { label: 'Export', decision: 'keep', priority: 'P2' },
  { label: 'Themes', decision: 'keep', priority: 'P2' },
  { label: 'Sync status', decision: 'keep', priority: 'P2' },
  { label: 'Kanban board', decision: 'kill', priority: 'P3' },
];
const fixtureState = (over = {}) => ({
  out: OUT_DIR,
  emitted: [],
  graph: SURVEY_GRAPH,
  answers: [
    { nodeId: 'top-jobs', answerKind: 'text', provenance: 'DECIDED', value: 'jot a note the moment it lands, draft LinkedIn posts from old notes, find an idea I half-remember' },
    { nodeId: 'critical-screens', answerKind: 'cards', provenance: 'DECIDED', value: [
      { label: 'Editor', decision: 'keep' }, { label: 'Search', decision: 'keep' }, { label: 'Settings', decision: 'kill' },
    ] },
    { nodeId: 'platform', answerKind: 'chips', provenance: 'OBSERVED', value: ['Obsidian plugin'] },
    { nodeId: 'tradeoff-allocation', answerKind: 'allocation', provenance: 'DECIDED', value: {
      weights: { ux_polish: 30, speed_to_alpha: 25, maintainability: 15, scalability: 12, security: 10, cost: 8 },
      unacceptable_tradeoff: 'ux_polish',
    } },
    { nodeId: 'feature-priority', answerKind: 'cards', provenance: 'DECIDED', value: featureCards },
    { nodeId: 'voice', answerKind: 'text', provenance: 'ASSUMED', value: 'plain and direct' },
  ],
  ...over,
});

// ── summaries ─────────────────────────────────────────────────────────────────

test('summarizeAnswer: each answerKind reads back as a compact human line', () => {
  const s = (nodeId) => summarizeAnswer(fixtureState().answers.find((a) => a.nodeId === nodeId));
  // allocation: the top axis, its weight, and the never-sacrifice call
  assert.equal(s('tradeoff-allocation'), 'ux_polish 30 (never sacrifice)');
  // cards with priorities: kept count + the priority spread + what was cut
  assert.equal(s('feature-priority'), '10 (3× P0, 4× P1, 3× P2) · 1 cut');
  // cards without priorities: names, not just a count
  assert.equal(s('critical-screens'), '2 (Editor, Search) · 1 cut');
  assert.equal(s('platform'), 'Obsidian plugin');
  assert.match(s('top-jobs'), /^jot a note the moment it lands/);
});

test('summarizeAnswer: never invents data — empty/absent answers produce no row', () => {
  assert.equal(summarizeAnswer(null), null);
  assert.equal(summarizeAnswer({ answerKind: 'text', value: null }), null);
  assert.equal(summarizeAnswer({ answerKind: 'text', value: '   ' }), null);
  assert.equal(summarizeAnswer({ answerKind: 'chips', value: [] }), null);
  assert.equal(summarizeAnswer({ answerKind: 'cards', value: [] }), null);
  assert.equal(summarizeAnswer({ answerKind: 'allocation', value: {} }), null);
  // an all-cut card set is a real answer, not an empty one
  assert.equal(summarizeAnswer({ answerKind: 'cards', value: [{ label: 'X', decision: 'kill' }] }), '0 kept of 1');
});

test('summarizeAnswer: long text is truncated, not dumped', () => {
  const long = 'x'.repeat(400);
  const out = summarizeAnswer({ answerKind: 'text', value: long });
  assert.ok(out.length < 80, `summary must stay compact, got ${out.length} chars`);
  assert.match(out, /…$/);
});

test('labelForNode: the graph owns the copy; unknown ids degrade to a readable title', () => {
  assert.equal(labelForNode('feature-priority', SURVEY_GRAPH), 'Features');
  assert.equal(labelForNode('tradeoff-allocation', SURVEY_GRAPH), 'Tradeoffs');
  assert.equal(labelForNode('top-jobs', null), 'Top jobs', 'falls back to a title-cased id');
  assert.equal(labelForNode('', null), 'Answer');
});

test('every graph node authors a readbackLabel (a new node cannot ship unlabelled)', () => {
  for (const node of SURVEY_GRAPH.nodes) {
    assert.equal(typeof node.readbackLabel, 'string', `node ${node.id} has no readbackLabel`);
    assert.ok(node.readbackLabel.trim().length > 0, `node ${node.id} has a blank readbackLabel`);
  }
});

test('buildReadback: rows follow walk order and carry non-DECIDED provenance', () => {
  const rows = buildReadback(fixtureState().answers, SURVEY_GRAPH);
  assert.deepEqual(rows.map((r) => r.label), ['Top jobs', 'Screens', 'Platform', 'Tradeoffs', 'Features', 'Voice']);
  assert.equal(rows.find((r) => r.label === 'Platform').provenance, 'OBSERVED');
  assert.equal(rows.find((r) => r.label === 'Voice').provenance, 'ASSUMED');
  assert.equal(rows.find((r) => r.label === 'Features').provenance, 'DECIDED');
});

test('workflow model: five navigable stages advance only from persisted evidence', () => {
  assert.deepEqual(WORKFLOW_STAGES.map((stage) => stage.id), ['requirements', 'direction', 'interface', 'architecture', 'build']);

  const captured = buildWorkflowModel(fixtureState({ done: true, emitted: [], coverage: { gaps: null } }), SURVEY_GRAPH);
  assert.equal(captured.currentStageId, 'direction');
  assert.equal(captured.stages.find((stage) => stage.id === 'requirements').status, 'complete');
  assert.equal(captured.stages.find((stage) => stage.id === 'direction').available, true);
  assert.equal(captured.stages.find((stage) => stage.id === 'interface').available, false);

  const packet = buildWorkflowModel(fixtureState({ done: true, emitted: ['spec.json'], coverage: { gaps: [{ field: 'screens' }] } }), SURVEY_GRAPH);
  assert.equal(packet.currentStageId, 'interface');
  assert.equal(packet.stages.find((stage) => stage.id === 'direction').status, 'complete');
  assert.equal(packet.stages.find((stage) => stage.id === 'interface').available, true);
  assert.equal(packet.stages.find((stage) => stage.id === 'architecture').available, false);
  assert.ok(packet.readback.length >= 5, 'later stages carry the recorded decisions forward');
});

test('workflow model: reported stage outcomes unlock the next stage and gaps gate the build', () => {
  const base = fixtureState({
    done: true,
    emitted: ['spec.json'],
    coverage: { gaps: [{ field: 'contracts' }] },
    workflowHistory: [{ stageId: 'interface', status: 'complete' }],
  });
  const architecture = buildWorkflowModel(base, SURVEY_GRAPH);
  assert.equal(architecture.currentStageId, 'architecture');
  assert.equal(architecture.stages.find((stage) => stage.id === 'interface').status, 'complete');
  assert.equal(architecture.stages.find((stage) => stage.id === 'architecture').available, true);
  assert.equal(architecture.stages.find((stage) => stage.id === 'build').status, 'blocked');

  const build = buildWorkflowModel({
    ...base,
    coverage: { gaps: [] },
    workflowHistory: [
      { stageId: 'interface', status: 'complete' },
      { stageId: 'architecture', status: 'complete' },
    ],
  }, SURVEY_GRAPH);
  assert.equal(build.currentStageId, 'build');
  assert.equal(build.stages.find((stage) => stage.id === 'build').status, 'current');
  assert.equal(build.stages.find((stage) => stage.id === 'build').available, true);
});

test('workflow model: a durable request becomes the current breadcrumb stage', () => {
  const model = buildWorkflowModel(fixtureState({
    done: true,
    emitted: ['spec.json'],
    coverage: { gaps: [] },
    workflowRequest: { stageId: 'interface', requestedAt: '2026-09-14T20:00:00Z' },
  }), SURVEY_GRAPH);
  assert.equal(model.currentStageId, 'interface');
  assert.equal(model.requestedStageId, 'interface');
  assert.equal(model.stages.find((stage) => stage.id === 'interface').status, 'current');
});

// ── the honesty contract ──────────────────────────────────────────────────────

test('done model: with NO reported files the state is working — it never claims a packet exists', () => {
  const m = buildDoneModel(fixtureState({ emitted: [] }));
  assert.equal(m.status, 'working');
  assert.equal(m.outDir, OUT_DIR, 'the destination is still shown — the user needs to know where');
  assert.deepEqual(m.emitted, []);
  assert.doesNotMatch(m.headline, /written/i, 'a working state must not claim files were written');
  assert.doesNotMatch(m.note, /written/i);
  // It must not assert the AGENT'S state either: we know we are waiting, we do not
  // know that anyone is assembling. An agent that finalized and then vanished would
  // otherwise leave "the host agent is assembling your design packet" up forever.
  assert.doesNotMatch(m.note, /is assembling/i, 'we cannot see the agent working — do not claim it is');
  assert.match(m.note, /^Waiting for the host agent/, 'the honest claim: we are waiting');
});

test('done model: only a REPORTED emitted list flips the screen to complete', () => {
  const m = buildDoneModel(fixtureState({ emitted: ['requirements.md', 'design.md', 'traceability.json'], coverage: { gaps: [{ kind: 'feature' }] } }));
  assert.equal(m.status, 'complete');
  assert.equal(m.headline, 'Planning draft created — 3 files');
  assert.match(m.note, /1 open definition gap/);
  assert.deepEqual(m.emitted, ['requirements.md', 'design.md', 'traceability.json']);
  assert.equal(buildDoneModel(fixtureState({ emitted: ['only.md'] })).headline, 'Planning draft created — 1 file');
});

test('done model: junk emitted entries cannot fake completion', () => {
  // An agent posting blanks must not flip the screen to "written".
  assert.equal(buildDoneModel(fixtureState({ emitted: ['', '   '] })).status, 'working');
  assert.equal(buildDoneModel(fixtureState({ emitted: 'requirements.md' })).status, 'working', 'a bare string is not a file list');
  assert.equal(buildDoneModel(fixtureState({ emitted: null })).status, 'working');
});

test('done model: a server-finalized walk must not claim an agent is assembling anything (f2)', () => {
  // The server auto-finalizes when NO agent is attached. Saying "the host agent is
  // assembling your design packet" there is a fake in-progress claim — the mirror
  // of the fake completion this screen replaced.
  const m = buildDoneModel(fixtureState({ emitted: [], doneBy: 'server' }));
  assert.equal(m.status, 'no-packet');
  assert.equal(m.headline, 'Review and confirm your requirements');
  assert.doesNotMatch(m.note, /assembling/i, 'nothing is assembling — no agent was ever attached');
  assert.doesNotMatch(m.note, /written/i);
  assert.match(m.note, /confirm/i, 'the completed walk must provide the next user action');
  assert.doesNotMatch(m.note, /host agent/i, 'internal orchestration is not useful completion copy');
  assert.equal(m.outDir, OUT_DIR);
  // An agent that attaches later and reports files still wins.
  assert.equal(buildDoneModel(fixtureState({ emitted: ['requirements.md'], doneBy: 'server' })).status, 'complete');
  // An agent-finalized (or unattributed) walk keeps the working state.
  assert.equal(buildDoneModel(fixtureState({ emitted: [], doneBy: 'agent' })).status, 'no-packet', 'an agent-finalized walk still offers the user confirmation action');
  assert.equal(buildDoneModel(fixtureState({ emitted: [] })).status, 'working');
});

test('renderDone (no-packet): offers confirmation without claiming a write', () => {
  const doc = stubDoc();
  const host = doc._host;
  const handles = renderDone(doc, host, buildDoneModel(fixtureState({ emitted: [], doneBy: 'server' })));
  assert.equal(byClass(host, 'spinner').length, 0, 'a settled state must not animate a false in-progress claim');
  assert.equal(byClass(host, 'done-working').length, 0, 'nothing is working, so no elapsed counter');
  assert.equal(handles.elapsedNode, null);
  assert.equal(oneByClass(host, 'q-prompt').textContent, 'Review and confirm your requirements');
  assert.doesNotMatch(oneByClass(host, 'q-prompt').textContent, /✅/, 'no success mark without a packet');
  assert.equal(oneByClass(host, 'outdir-title').textContent, 'Will be created in', 'never "Created in" without evidence of a write');
  assert.equal(oneByClass(host, 'outdir-path').textContent, OUT_DIR);
  assert.equal(byClass(host, 'outdir-file').length, 0);
  // The readback is the whole value of this state: the answers are still there.
  assert.ok(byClass(host, 'readback-val').length >= 5);
  assert.equal(oneByClass(host, 'done-generate').textContent, 'Confirm and build planning packet');
});

test('renderDone confirmation invokes generation and exposes a recoverable error', async () => {
  const doc = stubDoc();
  let calls = 0;
  renderDone(doc, doc._host, buildDoneModel(fixtureState({ emitted: [], doneBy: 'server' })), {
    onGenerate: async () => { calls += 1; return { ok: false, error: 'Emitter unavailable' }; },
  });
  const button = oneByClass(doc._host, 'done-generate');
  await button.listeners.click[0]();
  assert.equal(calls, 1);
  assert.equal(button.disabled, false, 'failure leaves a retry action');
  assert.match(button.textContent, /Try building/);
  assert.equal(oneByClass(doc._host, 'done-action-status').textContent, 'Emitter unavailable');
});

test('done model: a missing --out degrades to no path rather than a fake one', () => {
  const m = buildDoneModel(fixtureState({ out: undefined }));
  assert.equal(m.outDir, null);
  assert.equal(m.status, 'working');
});

test('formatCount: unknown renders as an em dash; only a real number renders as a number', () => {
  // The distinction the old `?? 0` could not express.
  assert.equal(formatCount(null), '—', 'never measured is not zero');
  assert.equal(formatCount(undefined), '—');
  assert.equal(formatCount(0), '0', 'a measured zero is still a real answer');
  assert.equal(formatCount(10), '10');
  assert.equal(formatCount([]), '0', 'a measured empty gap list means zero gaps');
  assert.equal(formatCount(['personas[0].jobs']), '1');
  assert.equal(formatCount(NaN), '—');
});

test('formatElapsed: a counter of time SPENT (we cannot honestly predict the agent)', () => {
  assert.equal(formatElapsed(0), '0s');
  assert.equal(formatElapsed(45_000), '45s');
  assert.equal(formatElapsed(125_000), '2m 05s');
  assert.equal(formatElapsed(-5), '0s');
  assert.equal(formatElapsed(undefined), '0s');
});

// ── the render (driven from fixture state through a stub document) ────────────

test('renderDone (working): renders the readback, the real out-dir, and a live elapsed counter', () => {
  const doc = stubDoc();
  const host = doc._host;
  const model = buildDoneModel(fixtureState({ emitted: [] }));
  model.elapsedMs = 45_000;
  const handles = renderDone(doc, host, model);

  // 1. Working status is visible and honest.
  assert.equal(oneByClass(host, 'q-prompt').textContent, 'Requirements captured');
  assert.equal(byClass(host, 'spinner').length, 1, 'the working state shows the spinner affordance');
  const working = oneByClass(host, 'done-working');
  assert.match(working.textContent, /Working — 45s elapsed/);
  assert.equal(working.getAttribute('aria-live'), 'polite', 'progress must be announced');
  assert.ok(handles.elapsedNode, 'the caller gets a handle to tick the counter without a re-render');

  // 2. The readback shows what was captured, in the user's terms.
  const keys = byClass(host, 'readback-key').map((n) => n.textContent);
  const vals = byClass(host, 'readback-val').map((n) => n.textContent);
  assert.ok(keys.some((k) => k.startsWith('Features')), `readback is missing Features: ${keys}`);
  assert.ok(vals.includes('10 (3× P0, 4× P1, 3× P2) · 1 cut'), `readback is missing the feature summary: ${vals}`);
  assert.ok(vals.includes('ux_polish 30 (never sacrifice)'), `readback is missing the tradeoff summary: ${vals}`);
  assert.ok(vals.some((v) => v.startsWith('jot a note the moment it lands')), 'readback is missing top jobs');
  // Inference is marked, never read back as the user's own decision.
  assert.match(keys.find((k) => k.startsWith('Voice')), /assumed/);
  assert.match(keys.find((k) => k.startsWith('Platform')), /observed/);
  assert.equal(keys.find((k) => k.startsWith('Features')), 'Features', 'a DECIDED row carries no provenance mark');

  // 3. The output location is the REAL --out, shown prominently and copyably.
  assert.equal(oneByClass(host, 'outdir-path').textContent, OUT_DIR);
  assert.equal(oneByClass(host, 'outdir-title').textContent, 'Writing to', 'working state names it a destination, not a result');
  assert.equal(oneByClass(host, 'outdir-copy').listeners.click.length, 1, 'the path is copyable');
  // 4. No file list is claimed while nothing has been reported.
  assert.equal(byClass(host, 'outdir-file').length, 0);
});

test('renderDone (complete): claims the packet only once files are reported, and lists them', () => {
  const doc = stubDoc();
  const host = doc._host;
  const emitted = ['requirements.md', 'design.md', 'traceability.json'];
  const handles = renderDone(doc, host, buildDoneModel(fixtureState({ emitted })));

  assert.equal(oneByClass(host, 'q-prompt').textContent, '✅ Planning draft created — 3 files');
  assert.equal(oneByClass(host, 'outdir-title').textContent, 'Created in');
  assert.equal(oneByClass(host, 'outdir-path').textContent, OUT_DIR);
  assert.deepEqual(byClass(host, 'outdir-file').map((n) => n.textContent), emitted);
  // The terminal state stops working-state signalling.
  assert.equal(byClass(host, 'spinner').length, 0, 'a finished walk must not keep spinning');
  assert.equal(byClass(host, 'done-working').length, 0);
  assert.equal(handles.elapsedNode, null, 'nothing left to tick');
  // The readback survives into the terminal state.
  assert.ok(byClass(host, 'readback-val').length >= 5);
});

test('renderDone: re-rendering replaces the screen rather than stacking duplicates', () => {
  const doc = stubDoc();
  const host = doc._host;
  renderDone(doc, host, buildDoneModel(fixtureState({ emitted: [] })));
  renderDone(doc, host, buildDoneModel(fixtureState({ emitted: ['requirements.md'] })));
  assert.equal(byClass(host, 'q-prompt').length, 1, 'the working headline must be cleared, not appended to');
  assert.equal(byClass(host, 'outdir-path').length, 1);
  assert.equal(byClass(host, 'spinner').length, 0);
});

test('renderDone: the copy button reports the truth when the clipboard is blocked', async () => {
  const denied = stubDoc({ writeText: async () => { throw new Error('blocked'); } });
  const host = denied._host;
  renderDone(denied, host, buildDoneModel(fixtureState({ emitted: [] })));
  const btn = oneByClass(host, 'outdir-copy');
  await btn.listeners.click[0]();
  assert.equal(btn.textContent, 'Select to copy', 'a failed copy must not claim it copied');

  let copied = null;
  const ok = stubDoc({ writeText: async (t) => { copied = t; } });
  renderDone(ok, ok._host, buildDoneModel(fixtureState({ emitted: [] })));
  const okBtn = oneByClass(ok._host, 'outdir-copy');
  await okBtn.listeners.click[0]();
  assert.equal(copied, OUT_DIR, 'the button copies the real out-dir');
  assert.equal(okBtn.textContent, 'Copied');
});

test('renderDone: an empty walk renders a clean screen, not an empty shell', () => {
  const doc = stubDoc();
  const host = doc._host;
  renderDone(doc, host, buildDoneModel({ out: OUT_DIR, emitted: [], answers: [], graph: SURVEY_GRAPH }));
  assert.equal(byClass(host, 'readback-list').length, 0, 'no readback section when there is nothing to read back');
  assert.equal(oneByClass(host, 'outdir-path').textContent, OUT_DIR, 'the destination still shows');
  assert.equal(byClass(host, 'done-working').length, 1);
});
