// test_survey_graph.mjs — walks the executable question graph (survey-graph.json)
// with the SAME skip evaluator the server enforces (imported isNodeSkipped), and
// proves the scratch-emit stop rule reacts to a real coverage gap.
//
// Run: node --test designer/tests/test_survey_graph.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURVEY_GRAPH, isNodeSkipped, isNodeDynamic, computeNextNode } from '../server/survey-server.mjs';
import { OBSERVATION_BATCH_CONTRACT, OBSERVATION_FIELDS } from '../server/observation-batch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EMITTER = path.join(ROOT, 'engine', 'dist', 'cli.js');

const node = (id) => SURVEY_GRAPH.nodes.find((n) => n.id === id);
const facts = (o = {}) => ({
  platformTarget: o.platformTarget ?? null,
  startingPoint: o.startingPoint ?? 'unspecified',
  observedFields: new Set(o.observed || []),
});

test('greenfield web app IS asked the critical-screens node', () => {
  const f = facts({ platformTarget: 'web', startingPoint: 'initial-idea' });
  assert.equal(isNodeSkipped(node('critical-screens'), f).skipped, false);
  // ...and the allocation preference is always asked.
  assert.equal(isNodeSkipped(node('tradeoff-allocation'), f).skipped, false);
});

test('agent-system is NEVER asked screens or responsive-range', () => {
  const f = facts({ platformTarget: 'agent-system', startingPoint: 'initial-idea' });
  assert.equal(isNodeSkipped(node('critical-screens'), f).skipped, true);
  assert.equal(isNodeSkipped(node('responsive-range'), f).skipped, true);
  // but jtbd is still asked (no skip rule, not observed)
  assert.equal(isNodeSkipped(node('jtbd'), f).skipped, false);
});

test('responsive range explains viewport language and offers discrete Mac choices', () => {
  const responsive = node('responsive-range');
  assert.equal(responsive.answerKind, 'chips');
  assert.match(responsive.help, /usable size of the app window/i);
  assert.deepEqual(responsive.chipsByPlatform.macos, [
    'Compact Mac window (about 900×600)',
    'Standard laptop window (about 1200×800)',
    'Large desktop window (1440px+ wide)',
    'Full screen',
    'All of these',
  ]);
});

test('existing-app never asks a node whose feedsField is OBSERVED', () => {
  // Inspection pre-filled platformTarget and the JTBD goal.
  const f = facts({
    platformTarget: 'claude-plugin',
    startingPoint: 'existing-app',
    observed: ['platformTarget', 'scenarios[0].goal'],
  });
  assert.equal(isNodeSkipped(node('platform'), f).skipped, true, 'platform is OBSERVED → skipped');
  assert.equal(isNodeSkipped(node('jtbd'), f).skipped, true, 'jtbd feedsField OBSERVED → skipped');
  // a preference cannot be observed even if listed — skipWhenObserved:false wins
  const f2 = facts({ startingPoint: 'existing-app', observed: ['tradeoffWeights'] });
  assert.equal(isNodeSkipped(node('tradeoff-allocation'), f2).skipped, false);
});

test('every P0 node is reachable for a greenfield web app (visited-or-skip-with-reason)', () => {
  const f = facts({ platformTarget: 'web', startingPoint: 'initial-idea' });
  const p0 = SURVEY_GRAPH.nodes.filter((n) => n.p0);
  assert.ok(p0.length >= 5, 'graph declares P0 nodes');
  for (const n of p0) {
    const skip = isNodeSkipped(n, f);
    // P0 nodes for a web greenfield app must all be askable (none skipped).
    assert.equal(skip.skipped, false, `${n.id} should be asked for a web greenfield app`);
  }
});

// ── static / dynamic split: the server auto-advances static nodes ────────────────
test('exactly the user-word-derived nodes are dynamic; the rest are static', () => {
  const dynamicIds = SURVEY_GRAPH.nodes.filter((n) => isNodeDynamic(n)).map((n) => n.id).sort();
  assert.deepEqual(dynamicIds, ['critical-screens', 'feature-priority', 'jtbd', 'primary-user-pain', 'top-jobs'],
    'only agent-composed, user-word-derived nodes are dynamic:true');
  // every other node is static (dynamic:false / omitted) and must carry renderable
  // content in the graph so the server can serve it with NO agent turn.
  for (const n of SURVEY_GRAPH.nodes) {
    if (isNodeDynamic(n)) continue;
    assert.ok(typeof n.prompt === 'string' && n.prompt.length, `static ${n.id} carries a prompt`);
    if (n.answerKind === 'chips') {
      assert.ok(Array.isArray(n.chips) && n.chips.length, `static chips node ${n.id} carries default chips`);
      assert.ok(n.chips.length <= 8, `static ${n.id} respects the ≤8 chips wire contract`);
    }
    // text/allocation/cards static nodes need only the prompt (allocation axes are
    // the frozen TRADEOFF_AXES; cards are user-filled).
  }
});

test('revealed-preference rounds use concrete choices and include a low-fidelity mockup comparison', () => {
  const preferenceNodes = SURVEY_GRAPH.nodes.filter((n) => n.elicitation === 'revealed-preference');
  assert.deepEqual(preferenceNodes.map((n) => n.id), ['workspace-layout-preference', 'progress-feedback-preference']);
  assert.ok(preferenceNodes.every((n) => n.optional === true), 'revealed-preference checks remain skippable by the adaptive host');
  const workspace = node('workspace-layout-preference');
  assert.equal(workspace.cardMode, 'single');
  assert.equal(workspace.cards.length, 3);
  assert.ok(workspace.cards.every((card) => card.mockup && card.mockup.regions.length >= 1));
  assert.equal(node('progress-feedback-preference').chips.length, 4);
});

test('every DYNAMIC node carries static FALLBACK content (never a hard stall without an agent)', () => {
  const dyn = SURVEY_GRAPH.nodes.filter((n) => isNodeDynamic(n));
  assert.equal(dyn.length, 5, 'the five user-word-derived nodes are dynamic');
  for (const n of dyn) {
    assert.ok(n.fallback && typeof n.fallback === 'object', `${n.id} carries a fallback object`);
    assert.ok(typeof n.fallback.prompt === 'string' && n.fallback.prompt.length,
      `${n.id} fallback carries a usable prompt`);
    if (n.answerKind === 'cards') {
      assert.ok(Array.isArray(n.fallback.cards) && n.fallback.cards.length,
        `${n.id} (cards) fallback carries a default card set`);
      for (const c of n.fallback.cards) {
        assert.ok(c && typeof c.label === 'string' && c.label.length, `${n.id} fallback card has a label`);
      }
    }
    if (n.answerKind === 'chips') {
      assert.ok(Array.isArray(n.fallback.chips) && n.fallback.chips.length && n.fallback.chips.length <= 8,
        `${n.id} (chips) fallback carries ≤8 default chips`);
    }
  }
});

test('computeNextNode is a deterministic, skip-aware, graph-order walk', () => {
  const web = facts({ platformTarget: 'web', startingPoint: 'initial-idea' });
  // fresh: the first node is the first dynamic node (jtbd)
  assert.equal(computeNextNode(SURVEY_GRAPH, web, new Set()).id, 'jtbd');
  // after the four leading dynamics are answered, the next node is the first STATIC
  // one; the tail auto-advances EXCEPT the trailing dynamic feature-priority node,
  // which the agent must compose (app-specific feature cards).
  const answered = new Set(['jtbd', 'primary-user-pain', 'top-jobs', 'critical-screens']);
  let n = computeNextNode(SURVEY_GRAPH, web, answered);
  assert.equal(n.id, 'platform');
  const tail = [];
  while (n) { tail.push(n.id); answered.add(n.id); n = computeNextNode(SURVEY_GRAPH, web, answered); }
  assert.ok(tail.every((id) => id === 'feature-priority' || !isNodeDynamic(SURVEY_GRAPH.nodes.find((x) => x.id === id))),
    'every tail node auto-advances (is static) except feature-priority, which is dynamic');
  assert.ok(isNodeDynamic(SURVEY_GRAPH.nodes.find((x) => x.id === 'feature-priority')),
    'feature-priority is the one dynamic tail node');
  assert.equal(computeNextNode(SURVEY_GRAPH, web, new Set(SURVEY_GRAPH.nodes.map((x) => x.id))), null,
    'a fully-answered walk returns null (complete)');
});

test('graph publishes the complete observation handoff and explicit provenance writers', () => {
  const contract = SURVEY_GRAPH.observationContract;
  assert.equal(contract.contract, OBSERVATION_BATCH_CONTRACT);
  assert.deepEqual(contract.requiredFields, OBSERVATION_FIELDS);
  assert.match(contract.writers.observed, /seed/);
  assert.match(contract.writers.decided, /record/);
  assert.match(contract.writers.assumed, /infer/);
  assert.match(contract.unresolvedPolicy, /must not synthesize architecture/);
});

// ── stop rule: scratch-emit surfaces a real coverage gap, and closing it clears ──
function emit(spec) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-stop-'));
  const specFile = path.join(out, 'in.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  const r = spawnSync(process.execPath, [EMITTER, specFile, '--out', out], { encoding: 'utf8' });
  let gaps = null;
  const trace = path.join(out, 'traceability.json');
  if (fs.existsSync(trace)) gaps = JSON.parse(fs.readFileSync(trace, 'utf8')).coverageGaps;
  fs.rmSync(out, { recursive: true, force: true });
  return { status: r.status, gaps };
}

const baseSpec = () => ({
  schemaVersion: 2,
  id: 'stop-fixture',
  productName: 'Stop Rule Fixture',
  productDescription: 'A fixture whose coverage gap the scratch-emit must surface.',
  platformTarget: 'web',
  needs: [{ id: 'need-1', title: 'A need with no feature yet' }],
  features: [],
});

test('scratch-emit stop rule: an uncovered need is a gap; covering it flips done', () => {
  const withGap = emit(baseSpec());
  assert.equal(withGap.status, 0, 'emitter exits 0 (no schema blocker)');
  assert.ok(
    withGap.gaps.some((g) => g.kind === 'need' && g.id === 'need-1' && g.missing === 'feature'),
    'coverageGaps surfaces the uncovered need',
  );

  // The "done" condition is the FULL chain: a covered need needs a feature, and
  // that feature's implementation task needs a test (the emitter's task→test gap
  // rule). A fully-linked need→feature→test fixture clears every gap.
  const closed = baseSpec();
  closed.features = [{ id: 'feat-1', title: 'Covers the need', surface: 'headless', needIds: ['need-1'] }];
  closed.tests = [{ id: 'test-1', description: 'verifies feat-1', featureIds: ['feat-1'], kind: 'unit', testFramework: 'vitest' }];
  const noGap = emit(closed);
  assert.equal(noGap.status, 0);
  assert.equal(noGap.gaps.length, 0, 'closing the full chain empties coverageGaps → done condition met');
});
