// test_survey_server.mjs — Groundwork: Requirements survey-server HTTP contract.
// Pattern: test_gallery_server.mjs (spawn on a reserved loopback port, drive via
// fetch). Covers the endpoint table (PARSED from the flow doc so the check FIRES,
// not documents), turn guards, persist/resume, deliver-once, allocation
// validation, server-side skip enforcement, and the provenance round-trip
// (survey-state provenance tags → the emitted Spec's evidence + assumptions).
//
// Run: node --test designer/tests/test_survey_server.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  makeServer, listenWithFallback, SURVEY_GRAPH, isNodeDynamic,
  validateQuestionPayload, QUESTION_PAYLOAD_SCHEMA, CARD_PRIORITIES, MAX_CHIPS,
  EMITTED_SHAPE, EMITTED_EXAMPLE, deriveCoverage, mergeCoverage,
  TRADEOFF_AXES, migrateState, SCHEMA_VERSION, MOCKUP_LAYOUTS,
  WORKING_DRAFT_ARTIFACT, buildSurveyProgress, renderWorkingDraft,
} from '../server/survey-server.mjs';
import { weightsFromRanking, neverSacrificeDefault, TRADEOFF_TEMPLATE } from '../server/survey-alloc.mjs';
import { OBSERVATION_BATCH_ARTIFACT, OBSERVATION_BATCH_CONTRACT, OBSERVATION_FIELDS } from '../server/observation-batch.mjs';
import { assembleSurveySpec } from '../server/survey-packet.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER = path.join(ROOT, 'designer', 'server', 'survey-server.mjs');
const DOC = path.join(ROOT, 'references', 'requirements-studio.md');
const EMITTER = path.join(ROOT, 'engine', 'dist', 'cli.js');

function reservePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
async function waitForServer(base, child, out) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode != null) throw new Error('survey server exited early: ' + out());
    try { if ((await fetch(base + '/api/state')).ok) return; } catch { /* booting */ }
    await delay(50);
  }
  throw new Error('survey server did not start: ' + out());
}
async function startServer(t, extraArgs = [], envExtra = {}) {
  const port = await reservePort();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-survey-t-'));
  const child = spawn(process.execPath, [SERVER, '--out', out, '--project', 'test', '--port', String(port), ...extraArgs], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...envExtra } });
  let logs = '';
  child.stdout.on('data', (c) => { logs += c; });
  child.stderr.on('data', (c) => { logs += c; });
  const base = 'http://127.0.0.1:' + port;
  await waitForServer(base, child, () => logs);
  t.after(() => { if (child.exitCode == null) child.kill('SIGTERM'); fs.rmSync(out, { recursive: true, force: true }); });
  return { base, out, child };
}
const post = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const getj = (base, p) => fetch(base + p).then((r) => r.json());

// A fixture "browser" answer for a live question, by answerKind (shared by the
// auto-advance + mixed-walk tests).
function browserAnswer(q) {
  if (q.answerKind === 'allocation') {
    return { weights: { speed_to_alpha: 30, scalability: 10, ux_polish: 20, maintainability: 15, cost: 10, security: 15 }, unacceptable_tradeoff: 'security' };
  }
  if (q.answerKind === 'cards') {
    return { cards: [{ label: q.nodeId === 'feature-priority' ? 'Core capability' : 'Primary screen', decision: 'keep', ...(q.nodeId === 'feature-priority' ? { priority: 'P0' } : {}) }] };
  }
  if (q.answerKind === 'chips') return { chosen: [(q.chips && q.chips[0]) || 'balanced'] };
  return { text: `a concrete answer for ${q.nodeId}` };
}

// Drive one full walk with the unified auto-advance-aware driver. Counts on-screen
// questions and the /api/agent/ask calls (the LLM-composed turns). `firstAsk`
// asks the leading dynamic node to kick a greenfield walk off.
async function driveWalk(base, { onDone } = {}) {
  let onScreen = 0, agentAsks = 0, autoServed = 0, prefetchHits = 0;
  for (let guard = 0; guard < 80; guard++) {
    const st = await getj(base, '/api/state');
    if (st.done || st.phase === 'done') break;
    if (st.phase === 'await_user' && st.question) {
      const r = await post(base, '/api/answer', { seq: st.seq, ...browserAnswer(st.question) });
      assert.equal(r.ok, true, `answer ${st.question.nodeId}: ${JSON.stringify(r)}`);
      onScreen += 1;
      if (r.autoAdvanced && r.autoAdvanceSource === 'auto-advance') autoServed += 1;
      if (r.autoAdvanced && r.autoAdvanceSource === 'prefetch') prefetchHits += 1;
      continue;
    }
    const contract = await getj(base, '/api/agent/contract');
    if (contract.done || contract.complete || !contract.nextNode) {
      if (onDone) await onDone();
      await post(base, '/api/done', { coverage: { gaps: [] } });
      break;
    }
    const ask = await post(base, '/api/agent/ask', { seq: contract.seq, action: 'ask', question: { nodeId: contract.nextNode.id } });
    assert.equal(ask.ok, true, `ask ${contract.nextNode.id}: ${JSON.stringify(ask)}`);
    agentAsks += 1;
  }
  return { onScreen, agentAsks, autoServed, prefetchHits };
}

// Walk forward (answering as we go) until the agent's contract offers a node of
// `kind` to compose. Used to reach a `cards` node, which sits 4th in graph order.
// Polling /api/agent/contract keeps the agent "attached", so no fallback pre-empts.
async function advanceUntilNextNodeKind(base, kind, max = 30) {
  for (let i = 0; i < max; i++) {
    const st = await getj(base, '/api/state');
    if (st.phase === 'await_user' && st.question) {
      const a = await post(base, '/api/answer', { seq: st.seq, ...browserAnswer(st.question) });
      assert.equal(a.ok, true, `answer ${st.question.nodeId}: ${JSON.stringify(a)}`);
      continue;
    }
    const c = await getj(base, '/api/agent/contract');
    if (!c.nextNode) throw new Error(`walk completed without reaching a ${kind} node`);
    if (c.nextNode.answerKind === kind) return c;
    const r = await post(base, '/api/agent/ask', { seq: c.seq, action: 'ask', question: { nodeId: c.nextNode.id } });
    assert.equal(r.ok, true, `ask ${c.nextNode.id}: ${JSON.stringify(r)}`);
  }
  throw new Error(`never reached a ${kind} node within ${max} steps`);
}

// ── the endpoint table is the doc's contract; parse it and assert each responds ──
function docEndpoints() {
  const md = fs.readFileSync(DOC, 'utf8');
  const rows = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*(\/[\w/-]+)\s*\|/);
    if (m) rows.push({ method: m[1], path: m[2] });
  }
  return rows;
}

test('the flow doc endpoint table lists real, responding routes (gate fires)', async (t) => {
  const { base } = await startServer(t);
  const eps = docEndpoints();
  assert.ok(eps.length >= 6, `expected the frozen endpoint table, found ${eps.length} rows`);
  for (const ep of eps) {
    const res = ep.method === 'GET'
      ? await fetch(base + ep.path)
      : await fetch(base + ep.path, { method: ep.method, headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.notEqual(res.status, 404, `${ep.method} ${ep.path} documented but not implemented`);
  }
});

test('init exposes the frozen wire contract (answerKinds superset + axes)', async (t) => {
  const { base } = await startServer(t);
  const init = await getj(base, '/api/init');
  assert.deepEqual(init.wireContract.answerKinds, ['text', 'chips', 'cards', 'allocation']);
  assert.equal(init.wireContract.tradeoffAxes.length, 6);
  assert.equal(init.graph.nodes.length, 14);
  assert.equal(init.wireContract.observationBatch.contract, OBSERVATION_BATCH_CONTRACT);
  assert.deepEqual(init.wireContract.observationBatch.fields, OBSERVATION_FIELDS);
});

test('existing-app seed persists and returns OBSERVED Spectra platform topology', async (t) => {
  const { base, out } = await startServer(t);
  const s = await getj(base, '/api/state');
  const surfaces = [
    {
      id: 'surface-macos', platform: 'macos', role: 'primary', name: 'Spectra Studio',
      interactionModes: ['pointer', 'keyboard'], featureIds: [], provenance: 'observed',
    },
    {
      id: 'surface-web', platform: 'web', role: 'companion', name: 'Spectra Web',
      interactionModes: ['pointer'], featureIds: [], provenance: 'observed',
    },
  ];
  const seeded = await post(base, '/api/agent/ask', {
    seq: s.seq,
    action: 'seed',
    specId: 'spec-spectra',
    startingPoint: 'existing-app',
    platformTarget: 'macos',
    sourcePaths: ['src/app.ts', 'package.json'],
    platformSurfaces: surfaces,
    observed: [{ nodeId: 'platform', feedsField: 'platformTarget', value: 'macos' }],
  });
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  assert.equal(seeded.observationBatch.observations, 2);

  const batch = await getj(base, '/api/observations');
  assert.equal(batch.contract, OBSERVATION_BATCH_CONTRACT);
  assert.equal(batch.specId, 'spec-spectra');
  assert.deepEqual(batch.observations.map((item) => item.value), surfaces);
  assert.ok(batch.observations.every((item) => item.provenance === 'observed'));
  assert.ok(batch.observations.every((item) => item.sourceRefs.some((ref) => ref.kind === 'repo')));
  assert.ok(batch.unresolved.some((item) => item.field === 'architecture.components'), 'unknown architecture stays unresolved');

  const persisted = JSON.parse(fs.readFileSync(path.join(out, OBSERVATION_BATCH_ARTIFACT), 'utf8'));
  assert.deepEqual(persisted, batch, 'the returned contract is the atomically persisted artifact');
});

test('greenfield user decisions and agent inference enter the batch with forced provenance', async (t) => {
  const { base } = await startServer(t);
  let state = await getj(base, '/api/state');
  const asked = await post(base, '/api/agent/ask', {
    seq: state.seq, action: 'ask', question: { nodeId: 'jtbd' },
  });
  await post(base, '/api/answer', { seq: asked.seq, text: 'understand and approve the build topology' });
  state = await getj(base, '/api/state');

  const decided = await post(base, '/api/agent/ask', {
    seq: state.seq,
    action: 'record',
    sourceAnswerNodeIds: ['jtbd'],
    structuredObservations: [
      {
        id: 'obs-component-studio',
        target: { field: 'architecture.components', entityId: 'component-studio' },
        value: { id: 'component-studio', name: 'Studio', kind: 'ui', featureIds: [], owner: 'product' },
        provenance: 'observed',
      },
      {
        id: 'obs-contract-studio-engine',
        target: { field: 'architecture.contracts', entityId: 'contract-studio-engine' },
        value: {
          id: 'contract-studio-engine', name: 'Studio to engine',
          provider: { specId: 'spec-requirements', kind: 'component', id: 'component-studio' },
          consumers: [{ specId: 'spec-requirements', kind: 'component', id: 'component-studio' }],
          ports: [{ id: 'port-observation-batch', name: 'observation batch', type: 'ObservationBatch', direction: 'output' }],
          transport: 'in-process', failureModes: ['invalid batch'], securityNotes: ['local-only'],
        },
      },
      {
        id: 'obs-flow-build',
        target: { field: 'architecture.flows', entityId: 'flow-build' },
        value: {
          id: 'flow-build', name: 'Build handoff', trigger: 'The user approves the captured requirements.',
          exchanges: [{
            id: 'exchange-build', order: 1,
            from: { specId: 'spec-requirements', kind: 'component', id: 'component-studio' },
            to: { specId: 'spec-requirements', kind: 'component', id: 'component-studio' },
            contractRef: { specId: 'spec-requirements', kind: 'contract', id: 'contract-studio-engine' },
            inputRefs: [], outputRefs: [], failurePaths: ['Keep the last valid observation batch.'],
          }],
        },
      },
      {
        id: 'obs-governance-owner',
        target: { field: 'governance.owners', entityId: 'product' },
        value: 'product',
      },
      {
        id: 'obs-proposed-topology',
        target: { field: 'changeSet.proposed', entityId: 'change-topology' },
        value: {
          id: 'change-topology',
          target: { specId: 'spec-requirements', kind: 'component', id: 'component-studio' },
          summary: 'Add the approved Studio topology', evidenceRefs: [],
        },
      },
    ],
  });
  assert.equal(decided.ok, true, JSON.stringify(decided));

  state = await getj(base, '/api/state');
  const inferred = await post(base, '/api/agent/ask', {
    seq: state.seq,
    action: 'infer',
    nodeId: 'info-density',
    value: 'balanced',
    observation: {
      id: 'obs-assumed-constraint',
      target: { field: 'governance.constraints', entityId: 'constraint-local' },
      value: 'Keep the survey local-only until deployment is selected.',
      provenance: 'decided',
    },
  });
  assert.equal(inferred.ok, true, JSON.stringify(inferred));

  const batch = await getj(base, '/api/observations');
  const byId = Object.fromEntries(batch.observations.map((item) => [item.id, item]));
  assert.equal(byId['obs-component-studio'].provenance, 'decided', 'route overrides caller-supplied provenance');
  assert.deepEqual(byId['obs-component-studio'].sourceRefs, [{ kind: 'survey', nodeId: 'jtbd' }]);
  assert.equal(byId['obs-assumed-constraint'].provenance, 'assumed', 'infer cannot self-promote to DECIDED');
  assert.deepEqual(byId['obs-assumed-constraint'].sourceRefs, [{ kind: 'agent', id: 'requirements-host' }]);
  assert.ok(!batch.unresolved.some((item) => item.field === 'architecture.components'));
  assert.ok(batch.unresolved.some((item) => item.field === 'architecture.relationships'), 'unrecorded topology stays unresolved');
});

test('turn guard: stale seq is rejected on both write sides', async (t) => {
  const { base } = await startServer(t);
  const s0 = await getj(base, '/api/state'); // seq 0, await_agent
  // stale ask
  const staleAsk = await post(base, '/api/agent/ask', { seq: 999, action: 'ask', question: { nodeId: 'jtbd' } });
  assert.equal(staleAsk.stale, true);
  // valid ask → await_user, seq 1
  const ask = await post(base, '/api/agent/ask', { seq: s0.seq, action: 'ask', question: { nodeId: 'jtbd' } });
  assert.equal(ask.ok, true);
  // stale answer
  const staleAns = await post(base, '/api/answer', { seq: 999, text: 'x' });
  assert.equal(staleAns.stale, true);
  // valid answer
  const ans = await post(base, '/api/answer', { seq: ask.seq, text: 'ship faster' });
  assert.equal(ans.ok, true);
});

test('deliver-once: the last answer + steering reach the agent exactly once', async (t) => {
  const { base } = await startServer(t);
  const s0 = await getj(base, '/api/state');
  const ask = await post(base, '/api/agent/ask', { seq: s0.seq, action: 'ask', question: { nodeId: 'jtbd' } });
  await post(base, '/api/answer', { seq: ask.seq, text: 'do the job', steering: 'stay minimal' });
  const c1 = await getj(base, '/api/agent/contract');
  assert.equal(c1.lastAnswer.value, 'do the job');
  assert.equal(c1.steering.text, 'stay minimal');
  const c2 = await getj(base, '/api/agent/contract');
  assert.equal(c2.lastAnswer, null, 'answer delivered once');
  assert.equal(c2.steering, null, 'steering delivered once');
});

test('allocation validation: sum≠100 and missing unacceptable_tradeoff rejected; valid accepted', async (t) => {
  const { base } = await startServer(t);
  const s0 = await getj(base, '/api/state');
  const ask = await post(base, '/api/agent/ask', { seq: s0.seq, action: 'ask', question: { nodeId: 'tradeoff-allocation' } });
  const bad = await post(base, '/api/answer', { seq: ask.seq, weights: { speed_to_alpha: 10, scalability: 10, ux_polish: 10, maintainability: 10, cost: 10, security: 10 }, unacceptable_tradeoff: 'security' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /sum to exactly 100/);
  const noAxis = await post(base, '/api/answer', { seq: ask.seq, weights: { speed_to_alpha: 30, scalability: 10, ux_polish: 20, maintainability: 15, cost: 10, security: 15 } });
  assert.equal(noAxis.ok, false);
  assert.match(noAxis.error, /unacceptable_tradeoff/);
  const good = await post(base, '/api/answer', { seq: ask.seq, weights: { speed_to_alpha: 30, scalability: 10, ux_polish: 20, maintainability: 15, cost: 10, security: 15 }, unacceptable_tradeoff: 'security' });
  assert.equal(good.ok, true);
});

test('server-side skip enforcement: a drifting agent cannot ask a skipped node', async (t) => {
  const { base } = await startServer(t);
  let s = await getj(base, '/api/state');
  // infer platform=agent-system so critical-screens must be skipped server-side
  await post(base, '/api/agent/ask', { seq: s.seq, action: 'infer', nodeId: 'platform', value: 'agent-system' });
  s = await getj(base, '/api/state');
  const asked = await post(base, '/api/agent/ask', { seq: s.seq, action: 'ask', question: { nodeId: 'critical-screens' } });
  assert.equal(asked.ok, false);
  assert.match(asked.error, /skipped server-side/);
});

test('persist + resume round-trip: answers and provenance survive a restart', async (t) => {
  const port = await reservePort();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-survey-resume-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  // session 1: record a DECIDED and an ASSUMED answer
  const c1 = spawn(process.execPath, [SERVER, '--out', out, '--project', 'r', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
  const base1 = 'http://127.0.0.1:' + port;
  await waitForServer(base1, c1, () => '');
  let s = await getj(base1, '/api/state');
  const ask = await post(base1, '/api/agent/ask', { seq: s.seq, action: 'ask', question: { nodeId: 'jtbd' } });
  await post(base1, '/api/answer', { seq: ask.seq, text: 'the job to be done' });
  s = await getj(base1, '/api/state');
  await post(base1, '/api/agent/ask', { seq: s.seq, action: 'infer', nodeId: 'info-density', value: 'balanced' });
  c1.kill('SIGTERM');
  await delay(200);
  // session 2: --resume from the same out dir
  const port2 = await reservePort();
  const c2 = spawn(process.execPath, [SERVER, '--out', out, '--project', 'r', '--port', String(port2), '--resume'], { cwd: ROOT, stdio: 'ignore' });
  const base2 = 'http://127.0.0.1:' + port2;
  await waitForServer(base2, c2, () => '');
  t.after(() => c2.kill('SIGTERM'));
  const init = await getj(base2, '/api/init');
  assert.equal(init.resumed, true);
  const byNode = Object.fromEntries(init.state.answers.map((a) => [a.nodeId, a.provenance]));
  assert.equal(byNode.jtbd, 'DECIDED');
  assert.equal(byNode['info-density'], 'ASSUMED');
});

// ── Part A: server auto-advance for STATIC nodes (no agent turn) ─────────────────
test('auto-advance: answering a STATIC node advances server-side with NO agent turn', async (t) => {
  const { base } = await startServer(t);
  // Walk the 4 leading DYNAMIC nodes first (graph order puts them ahead of the
  // statics). Answering the last dynamic (critical-screens) must make the server
  // auto-serve the first STATIC node (platform) with no agent turn.
  for (const id of ['jtbd', 'primary-user-pain', 'top-jobs', 'critical-screens']) {
    const s = await getj(base, '/api/state');
    const ask = await post(base, '/api/agent/ask', { seq: s.seq, action: 'ask', question: { nodeId: id } });
    assert.equal(ask.ok, true, `ask ${id}`);
    const live = await getj(base, '/api/state');
    const ans = await post(base, '/api/answer', { seq: live.seq, ...browserAnswer(live.question) });
    assert.equal(ans.ok, true, `answer ${id}`);
  }
  // The server auto-served the first STATIC node (platform) — no await_agent, no ask.
  let st = await getj(base, '/api/state');
  assert.equal(st.phase, 'await_user', 'the server auto-served the next question');
  assert.equal(st.question.nodeId, 'platform', 'the first static node is live with no agent turn');
  assert.ok(st.question.prompt, 'the auto-served question carries its static prompt');
  // Answering THAT static must itself auto-advance to the next static, no agent turn.
  const ans = await post(base, '/api/answer', { seq: st.seq, chosen: ['web'] });
  assert.equal(ans.ok, true);
  assert.equal(ans.autoAdvanced, true, 'server auto-advanced after a static answer');
  assert.equal(ans.autoAdvanceSource, 'auto-advance', 'served from the graph (static), not the agent');
  assert.equal(ans.phase, 'await_user', 'the next question is live immediately');
  st = await getj(base, '/api/state');
  assert.ok(st.question && st.question.nodeId !== 'platform', 'a different, next node is now live');
  assert.equal(isNodeDynamic(SURVEY_GRAPH.nodes.find((n) => n.id === st.question.nodeId)), false,
    'the auto-served node is static');
});

test('a DYNAMIC node is NOT auto-served — the turn flips to await_agent for the agent to compose', async (t) => {
  const { base } = await startServer(t);
  let s = await getj(base, '/api/state');
  // Answer jtbd (DYNAMIC). The very next graph node (primary-user-pain) is also
  // dynamic, so the server must NOT auto-serve it — it flips to await_agent.
  const ask = await post(base, '/api/agent/ask', { seq: s.seq, action: 'ask', question: { nodeId: 'jtbd' } });
  const ans = await post(base, '/api/answer', { seq: ask.seq, text: 'do the job' });
  assert.equal(ans.ok, true);
  assert.equal(ans.autoAdvanced, false, 'a dynamic next node is not auto-served');
  assert.equal(ans.phase, 'await_agent', 'the turn is handed to the agent');
  // the contract tells the agent WHICH dynamic node to compose next.
  const contract = await getj(base, '/api/agent/contract');
  assert.equal(contract.nextNode.id, 'primary-user-pain');
  assert.equal(contract.nextNode.dynamic, true);
});

// ── graceful degradation: dynamic-node static fallback when no agent is attached ──
// (a) recent agent poll → the dynamic node still flips to await_agent (agent enriches).
test('anti-freeze (a): a dynamic node with a RECENT agent poll flips to await_agent', async (t) => {
  // A comfortable window so a contract-poll-then-answer is unambiguously "recent".
  const { base } = await startServer(t, [], { GW_SURVEY_AGENT_STALE_MS: '10000' });
  await getj(base, '/api/agent/contract'); // agent polls → attached/recent
  const s = await getj(base, '/api/state');
  assert.equal(s.agentAttached, true, 'the agent is attached after polling the contract');
  const ask = await post(base, '/api/agent/ask', { seq: s.seq, action: 'ask', question: { nodeId: 'jtbd' } });
  const ans = await post(base, '/api/answer', { seq: ask.seq, text: 'do the job' });
  assert.equal(ans.ok, true);
  // next node (primary-user-pain) is dynamic; a recent agent poll means the server
  // WAITS for the agent to compose it — it does NOT serve the fallback.
  assert.equal(ans.autoAdvanced, false, 'a recent agent poll suppresses the fallback');
  assert.equal(ans.phase, 'await_agent', 'the turn is handed to the agent to enrich');
  const contract = await getj(base, '/api/agent/contract');
  assert.equal(contract.nextNode.id, 'primary-user-pain');
});

// (b) NO/stale agent poll → the server serves the node's static fallback (no freeze).
test('anti-freeze (b): a dynamic node with NO agent serves its static fallback, await_user', async (t) => {
  const { base } = await startServer(t, [], { GW_SURVEY_AGENT_STALE_MS: '120' });
  // No agent ever polls /api/agent/contract. After the grace window the watchdog
  // serves the FIRST dynamic node (jtbd) from its graph-authored static fallback.
  let st;
  for (let i = 0; i < 100; i++) {
    st = await getj(base, '/api/state');
    if (st.phase === 'await_user' && st.question) break;
    await delay(30);
  }
  assert.equal(st.phase, 'await_user', 'a question is live with no agent attached (no freeze)');
  assert.equal(st.question.nodeId, 'jtbd', 'the first dynamic node was served');
  assert.equal(st.agentAttached, false, 'no agent is attached');
  const jtbd = SURVEY_GRAPH.nodes.find((n) => n.id === 'jtbd');
  assert.equal(st.question.prompt, jtbd.fallback.prompt, 'the STATIC FALLBACK prompt was served, not agent-composed content');
  // answering it must auto-serve the NEXT dynamic node from its fallback too.
  const ans = await post(base, '/api/answer', { seq: st.seq, ...browserAnswer(st.question) });
  assert.equal(ans.ok, true);
  assert.equal(ans.autoAdvanced, true, 'the next node was served with no agent turn');
  assert.equal(ans.autoAdvanceSource, 'fallback', 'served from the static fallback');
});

// (c) THE KEY REGRESSION: a fully self-paced survey (no agent EVER) completes via fallbacks.
test('anti-freeze (c): a self-paced survey can confirm and generate its packet without an agent', async (t) => {
  const { base, out } = await startServer(t, [], { GW_SURVEY_AGENT_STALE_MS: '120' });
  // Drive as a browser ONLY — never poll /api/agent/contract, never /api/agent/ask.
  let onScreen = 0, st;
  for (let guard = 0; guard < 200; guard++) {
    st = await getj(base, '/api/state');
    if (st.done || st.phase === 'done') break;
    if (st.phase === 'await_user' && st.question) {
      const r = await post(base, '/api/answer', { seq: st.seq, ...browserAnswer(st.question) });
      assert.equal(r.ok, true, `answer ${st.question.nodeId}: ${JSON.stringify(r)}`);
      onScreen += 1;
      continue;
    }
    await delay(30); // await_agent with no agent: the watchdog serves a fallback shortly
  }
  assert.equal(st.done, true, 'the self-paced survey reached done with NO agent attached');
  assert.equal(onScreen, 14, 'all 14 questions were answered on-screen (5 dynamic via fallback + 9 static auto-advance)');
  const final = await getj(base, '/api/state');
  assert.ok(final.answers.some((a) => a.nodeId === 'feature-priority'), 'the trailing dynamic node was served via fallback');
  assert.ok(final.answers.every((a) => a.provenance === 'DECIDED'), 'every fallback answer is DECIDED (user-entered)');
  const generated = await post(base, '/api/generate-packet', {});
  assert.equal(generated.ok, true, JSON.stringify(generated));
  assert.deepEqual(generated.emitted, ['spec.json', 'requirements.md', 'design.md', 'tasks.md', 'builder-handoff.md', 'traceability.json']);
  for (const artifact of generated.emitted) assert.ok(fs.existsSync(path.join(out, artifact)), `${artifact} exists`);
  assert.equal(generated.state.doneBy, 'user-confirmed');
  const traceability = JSON.parse(fs.readFileSync(path.join(out, 'traceability.json'), 'utf8'));
  assert.deepEqual(generated.state.coverage.gaps, traceability.coverageGaps, 'the UI reports the emitter\'s actual gaps');
  assert.ok(generated.state.coverage.gaps.length > 0, 'a thin survey draft does not pretend to be build-ready');

  const prematureArchitecture = await post(base, '/api/workflow/continue', { stageId: 'architecture' });
  assert.equal(prematureArchitecture.ok, false);
  assert.match(prematureArchitecture.error, /interface flows/i, 'stage dependencies block continuation but not navigation');

  const requested = await post(base, '/api/workflow/continue', { stageId: 'interface' });
  assert.equal(requested.ok, true, JSON.stringify(requested));
  assert.equal(requested.state.workflowRequest.stageId, 'interface');
  const agentStage = await getj(base, '/api/agent/contract');
  assert.equal(agentStage.phase, 'workflow');
  assert.equal(agentStage.workflowRequest.stageId, 'interface');
  assert.equal(agentStage.answers.length, final.answers.length, 'the next stage receives every prior decision');
  assert.deepEqual(agentStage.emitted, generated.emitted, 'the next stage receives the generated packet evidence');

  const reported = await post(base, '/api/workflow/report', {
    stageId: 'interface', status: 'complete', emitted: ['mockups/selection.json'], summary: 'Navigation and core flows confirmed.',
  });
  assert.equal(reported.ok, true, JSON.stringify(reported));
  assert.equal(reported.state.workflowRequest, null);
  assert.equal(reported.state.workflowHistory[0].status, 'complete');

  const architecture = await post(base, '/api/workflow/continue', { stageId: 'architecture' });
  assert.equal(architecture.ok, true, JSON.stringify(architecture));
  assert.equal(architecture.state.workflowRequest.stageId, 'architecture');
  const blockedBuild = await post(base, '/api/workflow/continue', { stageId: 'build' });
  assert.equal(blockedBuild.ok, false);
  assert.match(blockedBuild.error, /architecture/i);
});

test('planning draft preserves confirmed voice and per-answer steering in the Spec', () => {
  const spec = assembleSurveySpec({
    project: 'test-project',
    answers: [
      { nodeId: 'voice', feedsField: 'voiceProfile', value: 'Plain, direct, and calm.', provenance: 'DECIDED', steering: 'Avoid slogans.' },
    ],
    structuredObservations: [
      { id: 'obs-component', target: { field: 'architecture.components', entityId: 'component-app' }, value: { id: 'component-app', name: 'App' }, provenance: 'observed', sourceRefs: [{ kind: 'repo', path: 'src/app.ts' }] },
    ],
  });
  assert.deepEqual(spec.voiceProfile.principles, ['Plain, direct, and calm.']);
  assert.match(spec.projectContext.evidence[0].statement, /steering: Avoid slogans\./);
  assert.match(spec.projectContext.evidence[1].statement, /architecture\.components:component-app/);
});

test('a full MIXED walk (5 dynamic asks + 9 auto-advanced statics) reaches done', async (t) => {
  const { base } = await startServer(t);
  const r = await driveWalk(base);
  const st = await getj(base, '/api/state');
  assert.equal(st.done, true, 'the walk reaches done');
  // greenfield web: 14 nodes, none skipped. 5 dynamic → agent asks; 9 static → auto.
  assert.equal(r.onScreen, 14, 'all 14 questions were answered on-screen');
  assert.equal(r.agentAsks, 5, 'only the 5 dynamic nodes cost an agent turn');
  assert.equal(r.autoServed, 9, 'the 9 static nodes were auto-advanced server-side');
  assert.equal(r.agentAsks + r.autoServed, r.onScreen, 'every question was agent-asked xor auto-served');
});

// ── quantified reduction: hybrid vs the all-dynamic baseline ─────────────────────
test('MEASURE: hybrid drops agent turns 14 → 5 vs the all-dynamic baseline', async (t) => {
  const { base } = await startServer(t);
  const r = await driveWalk(base);
  // Baseline = the OLD model where every on-screen node costs one /api/agent/ask.
  const baselineAgentTurns = r.onScreen;      // 14
  const hybridAgentTurns = r.agentAsks;       // 5
  assert.equal(baselineAgentTurns, 14);
  assert.equal(hybridAgentTurns, 5);
  const reductionPct = Math.round((1 - hybridAgentTurns / baselineAgentTurns) * 100);
  assert.ok(reductionPct >= 55, `agent-turn reduction ${reductionPct}% must be ≥55%`);
  console.log(`  MEASURE: agent turns ${baselineAgentTurns} → ${hybridAgentTurns} (−${reductionPct}%); ${r.autoServed} static nodes served with zero agent round-trips`);
});

// ── Part B: prefetch queue for DYNAMIC nodes (served instantly, off the critical path) ──
test('prefetch: the agent pre-posts the next dynamic node during think-time; it is served instantly', async (t) => {
  const { base } = await startServer(t);
  let s = await getj(base, '/api/state');
  // Ask jtbd (dynamic). While it is live (await_user), the agent pre-posts the NEXT
  // dynamic node (primary-user-pain) with queue:true — accepted even though it is
  // not the agent's turn.
  const ask = await post(base, '/api/agent/ask', { seq: s.seq, action: 'ask', question: { nodeId: 'jtbd' } });
  const pf = await post(base, '/api/agent/ask', { queue: true, action: 'ask', question: { nodeId: 'primary-user-pain', prompt: 'composed from your words' } });
  assert.equal(pf.ok, true, 'a queued ask is accepted mid-await_user');
  assert.equal(pf.queued, true);
  assert.equal(pf.queueLength, 1);
  // Now answer jtbd. The server must serve the PREFETCHED primary-user-pain instantly
  // (source=prefetch), never flipping to await_agent — the user waits on no LLM turn.
  const ans = await post(base, '/api/answer', { seq: ask.seq, text: 'the job' });
  assert.equal(ans.ok, true);
  assert.equal(ans.autoAdvanced, true);
  assert.equal(ans.autoAdvanceSource, 'prefetch', 'the pre-posted dynamic question was served from the queue');
  const st = await getj(base, '/api/state');
  assert.equal(st.phase, 'await_user');
  assert.equal(st.question.nodeId, 'primary-user-pain');
  assert.equal(st.question.prompt, 'composed from your words', 'the AGENT-composed content was served, not a graph default');
});

test('prefetch is pruned: a queued node that becomes skipped is never served', async (t) => {
  const { base } = await startServer(t);
  let s = await getj(base, '/api/state');
  // Pre-post critical-screens, then infer platform=agent-system (which skips it).
  const pf = await post(base, '/api/agent/ask', { queue: true, action: 'ask', question: { nodeId: 'critical-screens' } });
  assert.equal(pf.ok, true);
  s = await getj(base, '/api/state');
  await post(base, '/api/agent/ask', { seq: s.seq, action: 'infer', nodeId: 'platform', value: 'agent-system' });
  // Drive: critical-screens must NOT appear (skipped for agent-system) despite being queued.
  const r = await driveWalk(base);
  const stAll = await getj(base, '/api/state');
  assert.equal(stAll.done, true);
  assert.ok(!stAll.answers.some((a) => a.nodeId === 'critical-screens'), 'the skipped, queued node was pruned — never served');
});

// ── resume of a MIXED walk (auto-advanced static + agent-driven dynamic) ─────────
test('--resume round-trips a MIXED walk and auto-serves the next static seamlessly', async (t) => {
  const port = await reservePort();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-mixed-resume-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  // session 1: answer the 4 dynamics, then answer ONE auto-served static (platform),
  // leaving the walk mid-static-tail. Kill.
  const c1 = spawn(process.execPath, [SERVER, '--out', out, '--project', 'mix', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
  const base1 = 'http://127.0.0.1:' + port;
  await waitForServer(base1, c1, () => '');
  const seen = [];
  for (let guard = 0; guard < 40; guard++) {
    const st = await getj(base1, '/api/state');
    if (st.phase === 'await_user' && st.question) {
      seen.push(st.question.nodeId);
      await post(base1, '/api/answer', { seq: st.seq, ...browserAnswer(st.question) });
      if (st.question.nodeId === 'platform') break; // stop after the first auto-served static
      continue;
    }
    const contract = await getj(base1, '/api/agent/contract');
    if (!contract.nextNode) break;
    await post(base1, '/api/agent/ask', { seq: contract.seq, action: 'ask', question: { nodeId: contract.nextNode.id } });
  }
  assert.ok(seen.includes('platform'), 'session 1 reached and answered the first auto-served static');
  c1.kill('SIGTERM');
  await delay(200);
  // session 2: --resume. The reloaded state's next node is STATIC (info-density);
  // it must be auto-served immediately with no agent attached.
  const port2 = await reservePort();
  const c2 = spawn(process.execPath, [SERVER, '--out', out, '--project', 'mix', '--port', String(port2), '--resume'], { cwd: ROOT, stdio: 'ignore' });
  const base2 = 'http://127.0.0.1:' + port2;
  await waitForServer(base2, c2, () => '');
  t.after(() => c2.kill('SIGTERM'));
  const init = await getj(base2, '/api/init');
  assert.equal(init.resumed, true);
  // prior answers survived the restart…
  assert.ok(init.state.answers.some((a) => a.nodeId === 'jtbd' && a.provenance === 'DECIDED'), 'dynamic answers survived resume');
  assert.ok(init.state.answers.some((a) => a.nodeId === 'platform'), 'the auto-advanced static answer survived resume');
  // …and the resumed session immediately has the next STATIC question live (seamless).
  assert.equal(init.state.phase, 'await_user', 'resume auto-served the next static with no agent turn');
  assert.equal(isNodeDynamic(SURVEY_GRAPH.nodes.find((n) => n.id === init.state.question.nodeId)), false, 'the auto-served resume question is static');
  // finish the resumed walk to done to prove the mixed walk completes post-resume.
  const r = await driveWalk(base2);
  const fin = await getj(base2, '/api/state');
  assert.equal(fin.done, true, 'the resumed mixed walk reaches done');
});

// ── question-payload shape validation (the blank-card regression) ─────────────
// /api/agent/ask used to accept ANY cards[] shape. An agent posting
// `{ id, title, why }` got ok:true, and the browser's renderCards — which reads
// card.label — painted a column of BLANK inputs: the user saw a survey with "no
// features" and nothing reported an error. These lock that boundary shut.

test('question payload: the REAL blank-card defect ({id,title,why}) is rejected, not silently served', async (t) => {
  const { base } = await startServer(t);
  const c = await getj(base, '/api/agent/contract');
  const r = await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask',
    question: {
      nodeId: 'feature-priority', answerKind: 'cards',
      cards: [{ id: 'f1', title: 'Sync engine', why: 'core' }, { id: 'f2', title: 'Search', why: 'nav' }],
    },
  });
  assert.equal(r.ok, false, 'a card payload the renderer cannot read must be rejected');
  assert.match(r.error, /cards\[0\]/, 'the error names the offending card');
  assert.match(r.error, /label/, 'the error names the field that is missing');
  assert.match(r.error, /id, title, why/, 'the error echoes the keys that WERE posted');
  // The expected shape rides in the structured `expected`/`example` fields rather
  // than the prose — see the self-teaching-rejection test for the full contract.
  assert.deepEqual(r.expected, QUESTION_PAYLOAD_SCHEMA.cards.expected);
  // The decisive assertion: the rejection left NO blank question live.
  const st = await getj(base, '/api/state');
  assert.equal(st.phase, 'await_agent', 'a rejected ask must not advance the turn');
  assert.equal(st.question, null, 'a rejected ask must never become a live question');
  assert.equal(st.seq, c.seq, 'a rejected ask must not burn a seq');
});

test('question payload: valid cards are accepted and reach the browser intact', async (t) => {
  const { base } = await startServer(t);
  const c = await getj(base, '/api/agent/contract');
  const cards = [{ label: 'Sync engine', priority: 'P0' }, { label: 'Search', priority: 'P2' }];
  const r = await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask',
    question: { nodeId: 'feature-priority', answerKind: 'cards', prompt: 'Keep or cut?', cards },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const st = await getj(base, '/api/state');
  assert.equal(st.phase, 'await_user');
  assert.deepEqual(st.question.cards, cards, 'validated cards reach the browser unchanged');
});

test('question payload: a card with a blank label, and a priority outside P0–P3, are both rejected', async (t) => {
  const { base } = await startServer(t);
  const c = await getj(base, '/api/agent/contract');
  const blank = await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask',
    question: { nodeId: 'feature-priority', answerKind: 'cards', cards: [{ label: 'Real' }, { label: '   ' }] },
  });
  assert.equal(blank.ok, false, 'a whitespace-only label renders blank — reject it');
  assert.match(blank.error, /cards\[1\]/, 'the error names the offending card by index');

  const prio = await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask',
    question: { nodeId: 'feature-priority', answerKind: 'cards', cards: [{ label: 'Sync engine', priority: 'HIGH' }] },
  });
  assert.equal(prio.ok, false, 'a priority outside the frozen enum must be rejected');
  assert.match(prio.error, /priority/);
  assert.match(prio.error, /P0\|P1\|P2\|P3/, 'the error states the allowed priorities');
  assert.match(prio.error, /Sync engine/, 'the error names the offending card by label');
});

test('question payload: chips must be ≤8 non-empty strings', async (t) => {
  const { base } = await startServer(t);
  const c = await getj(base, '/api/agent/contract');
  const many = await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask',
    question: { nodeId: 'platform', answerKind: 'chips', chips: Array.from({ length: 9 }, (_, i) => `chip${i}`) },
  });
  assert.equal(many.ok, false, 'the doc freezes chips at ≤8; the validator must enforce it');
  assert.match(many.error, /8/);

  const bad = await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask',
    question: { nodeId: 'platform', answerKind: 'chips', chips: ['web', { label: 'ios' }] },
  });
  assert.equal(bad.ok, false, 'a non-string chip renders as [object Object] — reject it');
  assert.match(bad.error, /chips\[1\]/);
});

test('question payload: text examples are validated and reach the browser intact', async (t) => {
  const { base } = await startServer(t);
  const c = await getj(base, '/api/agent/contract');
  const examples = [
    { label: 'Share a dashboard', text: 'Turn project data into a polished HTML dashboard.' },
    { label: 'Resume the work', text: 'Return to the project with files, history, and AI context intact.' },
  ];
  const r = await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask',
    question: { nodeId: 'jtbd', answerKind: 'text', prompt: 'What outcome matters?', examples },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual((await getj(base, '/api/state')).question.examples, examples);

  const invalid = validateQuestionPayload({ answerKind: 'text', examples: [{ label: 'Missing answer' }] });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /examples\[0\].*text/);
  assert.deepEqual(invalid.expected, QUESTION_PAYLOAD_SCHEMA.text.expected);
});

test('question payload: typed low-fidelity mockups are accepted and malformed layouts are rejected', () => {
  const valid = validateQuestionPayload({
    answerKind: 'cards', cardMode: 'single',
    cards: [{ label: 'Three panes', mockup: { layout: 'three-pane', regions: ['Files', 'Work', 'AI'] } }],
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(MOCKUP_LAYOUTS, ['single-focus', 'sidebar-canvas', 'three-pane']);
  const invalid = validateQuestionPayload({
    answerKind: 'cards', cards: [{ label: 'Mystery', mockup: { layout: 'unknown', regions: ['Work'] } }],
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /mockup\.layout/);
});

test('save + export: unfinished input persists without advancing and writes an honest working brief', async (t) => {
  const { base, out } = await startServer(t);
  const contract = await getj(base, '/api/agent/contract');
  const asked = await post(base, '/api/agent/ask', {
    seq: contract.seq, action: 'ask', question: { nodeId: 'jtbd', prompt: 'What outcome?' },
  });
  const saved = await post(base, '/api/save-draft', {
    seq: asked.seq, payload: { text: 'A useful partial outcome' }, steering: 'Keep it visual',
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  let state = await getj(base, '/api/state');
  assert.equal(state.seq, asked.seq, 'saving does not advance the turn');
  assert.equal(state.answers.length, 0, 'an unfinished draft is not a DECIDED answer');
  assert.equal(state.draft.payload.text, 'A useful partial outcome');
  assert.equal(state.draft.steering, 'Keep it visual');
  const persisted = JSON.parse(fs.readFileSync(path.join(out, 'survey-state.json'), 'utf8'));
  assert.equal(persisted.drafts[0].payload.text, 'A useful partial outcome');

  const exported = await post(base, '/api/export-draft', {});
  assert.equal(exported.ok, true, JSON.stringify(exported));
  assert.equal(exported.artifact, WORKING_DRAFT_ARTIFACT);
  const markdown = fs.readFileSync(path.join(out, WORKING_DRAFT_ARTIFACT), 'utf8');
  assert.match(markdown, /incomplete working draft/i);
  assert.match(markdown, /A useful partial outcome/);
  assert.match(markdown, /up to \d+ remain/);

  const answered = await post(base, '/api/answer', { seq: asked.seq, text: 'The finished outcome' });
  assert.equal(answered.ok, true);
  state = await getj(base, '/api/state');
  assert.equal(state.answers[0].value, 'The finished outcome');
  const after = JSON.parse(fs.readFileSync(path.join(out, 'survey-state.json'), 'utf8'));
  assert.equal(after.drafts.length, 0, 'submission clears the saved draft for that node');
});

test('progress: removes deterministic skips and reports optional revealed-preference questions', () => {
  const progress = buildSurveyProgress(SURVEY_GRAPH, {
    startingPoint: 'existing-app', platformTarget: 'macos', observedFields: ['platformTarget'],
    answers: [{ nodeId: 'platform' }],
  });
  assert.equal(progress.total, 13, 'the observed platform node is excluded from the eligible total');
  assert.equal(progress.answered, 0, 'a skipped observed answer is not counted as an eligible interview decision');
  assert.equal(progress.remaining, 13);
  assert.equal(progress.optionalRemaining, 2);
  assert.equal(progress.estimate, true);
});

test('working draft renderer labels provenance and never claims a validated Spec', () => {
  const progress = { answered: 1, total: 4, remaining: 3 };
  const markdown = renderWorkingDraft({
    state: { project: 'Example', answers: [{ nodeId: 'jtbd', answerKind: 'text', value: 'Ship a useful result', provenance: 'DECIDED' }], drafts: [], structuredObservations: [] },
    graph: SURVEY_GRAPH, progress,
  });
  assert.match(markdown, /Job to be done \(decided\)/);
  assert.match(markdown, /not converted this into a validated Spec/);
});

test('working draft renderer does not turn an untouched single-choice draft into cuts', () => {
  const markdown = renderWorkingDraft({
    state: {
      project: 'Example', answers: [], structuredObservations: [],
      drafts: [{ nodeId: 'workspace-layout-preference', answerKind: 'cards', payload: { cards: [] } }],
    },
    graph: SURVEY_GRAPH,
    progress: { answered: 0, total: 2, remaining: 2 },
    currentQuestion: { nodeId: 'workspace-layout-preference' },
  });
  assert.match(markdown, /No option selected yet/);
  assert.doesNotMatch(markdown, /\[cut\]/);
});

test('question payload: a malformed PREFETCH is rejected too (never served a turn later)', async (t) => {
  const { base } = await startServer(t);
  // The prefetch path bypasses the seq/turn guard by design; it must NOT bypass
  // shape validation, or the blank-card defect simply reappears one turn later.
  const r = await post(base, '/api/agent/ask', {
    action: 'ask', queue: true,
    question: { nodeId: 'feature-priority', answerKind: 'cards', cards: [{ id: 'f1', title: 'Sync engine' }] },
  });
  assert.equal(r.ok, false, 'an unrenderable pre-post must be rejected at queue time');
  assert.match(r.error, /label/);
  assert.match(r.error, /feature-priority/, 'the error names the node');
});

test('validateQuestionPayload: optional fields stay optional (a bare { nodeId } ask is legal)', () => {
  // The graph fills prompt/chips/cards for a bare ask — the common path. The
  // validator must check only what is PRESENT or it breaks every normal walk.
  assert.equal(validateQuestionPayload({}).ok, true);
  assert.equal(validateQuestionPayload({ nodeId: 'feature-priority' }).ok, true);
  assert.equal(validateQuestionPayload({ answerKind: 'cards' }).ok, true, 'cards content is optional — the graph supplies it');
  assert.equal(validateQuestionPayload({ answerKind: 'nonsense' }).ok, false);
  // `axes` is server-owned: rejected outright rather than accepted-then-ignored.
  assert.equal(validateQuestionPayload({ answerKind: 'allocation' }).ok, true);
  assert.equal(validateQuestionPayload({ answerKind: 'allocation', axes: ['velocity'] }).ok, false);
});

test('question payload: a server-owned `axes` is REFUSED, not accepted then silently overwritten', async (t) => {
  // Previously an agent could post a valid subset, get ok:true, and have
  // questionFromNode substitute all six — the agent believed it had shaped the
  // question and the browser showed something else. That is the same silent
  // divergence as the blank cards, so the field is now unrepresentable rather
  // than merely disclaimed in a note.
  const { base } = await startServer(t);
  const c = await getj(base, '/api/agent/contract');
  const r = await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask',
    question: { nodeId: 'tradeoff-allocation', answerKind: 'allocation', axes: ['cost', 'security'] },
  });
  assert.equal(r.ok, false, 'a VALID subset must be refused — accepting it and serving six is a lie by substitution');
  assert.match(r.error, /server owns the tradeoff axes/);
  assert.match(r.error, /remove "axes"/, 'the error tells the agent exactly what to do');
  assert.equal((await getj(base, '/api/state')).question, null, 'the rejected ask never went live');
  // The schema must not advertise the field it refuses.
  assert.deepEqual(QUESTION_PAYLOAD_SCHEMA.allocation.expected, {}, 'allocation advertises no agent-suppliable payload');
  assert.equal(QUESTION_PAYLOAD_SCHEMA.allocation.field, null);
  // And a clean allocation ask still serves all six to the browser.
  const ok = await post(base, '/api/agent/ask', { seq: c.seq, action: 'ask', question: { nodeId: 'tradeoff-allocation' } });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual((await getj(base, '/api/state')).question.axes, [...TRADEOFF_AXES]);
});

// ── the card shape is DISCOVERABLE, not merely enforced ───────────────────────
// The root cause was never "the agent was careless": the cards[] element shape
// lived ONLY in survey.js's renderCards and appeared NOWHERE in the contract the
// agent reads, so an agent following the documented contract still produced an
// unrenderable payload. Validation alone would only turn a silent blank screen
// into a guess-reject-guess loop. These assert the shape is published at the
// moment of use, echoed in rejections, and declared exactly once.

test('discoverability: /api/agent/contract publishes the payload schema for the node it asks the agent to compose', async (t) => {
  const { base } = await startServer(t);
  const c = await advanceUntilNextNodeKind(base, 'cards');
  assert.ok(c.nextNode, 'the walk must reach a cards node');
  assert.equal(c.nextNode.answerKind, 'cards');
  // The decisive assertion: the agent is TOLD the shape on the read side it
  // already polls every turn — it never has to infer it or read survey.js.
  assert.deepEqual(c.nextNode.payloadSchema, QUESTION_PAYLOAD_SCHEMA.cards,
    'nextNode must carry the payload schema for its own answerKind');
  assert.equal(c.nextNode.payloadSchema.expected.label, 'string (required) — non-empty',
    'the required field is named in the schema the agent receives');
  assert.deepEqual(c.nextNode.payloadSchema.example, { label: 'Quick capture', priority: 'P0' },
    'a copyable example ships with the schema');
  // The whole map is available too (an agent composing ahead handles many kinds).
  assert.deepEqual(c.payloadSchemas, QUESTION_PAYLOAD_SCHEMA);
});

test('discoverability: /api/init publishes the same schema map + the priority enum to the browser', async (t) => {
  const { base } = await startServer(t);
  const init = await getj(base, '/api/init');
  assert.deepEqual(init.wireContract.payloadSchemas, QUESTION_PAYLOAD_SCHEMA);
  assert.deepEqual(init.wireContract.cardPriorities, CARD_PRIORITIES);
  assert.equal(init.wireContract.maxChips, MAX_CHIPS);
});

test('self-teaching rejection: the error carries expected + example + the offending field path', async (t) => {
  const { base } = await startServer(t);
  const c = await getj(base, '/api/agent/contract');
  const r = await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask',
    question: { nodeId: 'feature-priority', answerKind: 'cards', cards: [{ id: 'f1', title: 'Sync engine', why: 'core' }] },
  });
  assert.equal(r.ok, false);
  // An agent must be able to self-correct from THIS RESPONSE ALONE — no doc read,
  // no source read, no second request. That means: what was wrong (field path),
  // what is right (expected), and something copyable (example).
  assert.match(r.error, /cards\[0\]/, 'names the offending element by path');
  assert.match(r.error, /id, title, why/, 'echoes the keys that WERE posted');
  assert.deepEqual(r.expected, QUESTION_PAYLOAD_SCHEMA.cards.expected, 'rejection carries the expected shape');
  assert.deepEqual(r.example, QUESTION_PAYLOAD_SCHEMA.cards.example, 'rejection carries a valid example');
  // Re-posting the example's own shape must now succeed: the error is actionable,
  // not just descriptive. (Proves expected/example are TRUE, not decorative.)
  const fixed = await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask',
    question: { nodeId: 'feature-priority', answerKind: 'cards', cards: [r.example] },
  });
  assert.equal(fixed.ok, true, `the example the rejection handed back must itself be accepted: ${JSON.stringify(fixed)}`);
});

test('single source: the schema the contract advertises IS the one the validator enforces and the browser consumes', async (t) => {
  const { base } = await startServer(t);
  const init = await getj(base, '/api/init');
  const c = await getj(base, '/api/agent/contract');
  // 1. Server constant == what /api/init serves == what /api/agent/contract serves.
  assert.deepEqual(init.wireContract.payloadSchemas, QUESTION_PAYLOAD_SCHEMA);
  assert.deepEqual(c.payloadSchemas, QUESTION_PAYLOAD_SCHEMA);
  // 2. The validator's rejection quotes that same object (not a private copy).
  const bad = validateQuestionPayload({ answerKind: 'cards', cards: [{ title: 'x' }] });
  assert.deepEqual(bad.expected, QUESTION_PAYLOAD_SCHEMA.cards.expected);
  // 3. The BROWSER must not re-declare the enum. Re-declaring it is the defect
  //    that caused this bug: survey.js owned the only copy of the card shape.
  const src = fs.readFileSync(path.join(ROOT, 'designer', 'server', 'survey.js'), 'utf8');
  assert.equal(/\[\s*'P0'/.test(src), false, 'survey.js must not hardcode a priority list — read WIRE.cardPriorities');
  assert.match(src, /WIRE\.cardPriorities/, 'survey.js must read the priority enum from the wire contract');
  // 4. The renderer reads the field the schema declares required.
  assert.match(src, /seedCard\.label/, 'renderCards must read the schema-declared required field');
});

test('engine drift gate: the survey\'s enum mirrors match engine/src/spec.ts', () => {
  // The survey may not edit engine/src (standing non-goal), so CARD_PRIORITIES and
  // TRADEOFF_AXES are unavoidable MIRRORS of the engine's Zod schemas. An un-gated
  // mirror is exactly what caused the blank-card bug — a shape defined in two
  // places drifts silently — so the mirror is asserted here instead. Read-only.
  const spec = fs.readFileSync(path.join(ROOT, 'engine', 'src', 'spec.ts'), 'utf8');

  // const Priority = z.enum(["P0", "P1", "P2", "P3"]).optional();
  const prio = spec.match(/const Priority = z\.enum\(\[([^\]]+)\]\)/);
  assert.ok(prio, 'could not find the Priority z.enum in engine/src/spec.ts — this gate must be repaired, not deleted');
  const enginePriorities = [...prio[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(CARD_PRIORITIES, enginePriorities,
    'CARD_PRIORITIES has drifted from engine/src/spec.ts Priority — a card priority the emitter rejects would validate here');

  // Bind to the AUTHORITATIVE declaration — `export const TRADEOFF_AXES` — not to
  // an incidental expression that merely mentions the axes.
  const axesDecl = spec.match(/export const TRADEOFF_AXES = \[([\s\S]*?)\] as const;/);
  assert.ok(axesDecl, 'could not find the TRADEOFF_AXES export in engine/src/spec.ts — repair this gate, do not delete it');
  const engineAxes = [...axesDecl[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(TRADEOFF_AXES, engineAxes,
    'TRADEOFF_AXES has drifted from engine/src/spec.ts — the browser would compute weights the Spec cannot hold');

  // AND the schema's own required weight keys: a 7th key added to
  // TradeoffWeightsSchema leaves the list above untouched while making every
  // six-axis allocation the browser produces fail Zod validation.
  const schemaBody = spec.match(/export const TradeoffWeightsSchema = z\s*\.object\(\{([\s\S]*?)\n  \}\)/);
  assert.ok(schemaBody, 'could not find TradeoffWeightsSchema in engine/src/spec.ts');
  const weightKeys = [...schemaBody[1].matchAll(/(\w+): z\.number\(\)/g)].map((m) => m[1]);
  assert.deepEqual([...TRADEOFF_AXES].sort(), [...weightKeys].sort(),
    'TradeoffWeightsSchema requires a different set of weights than the survey serves axes for');
});

test('flow-doc drift gate: the documented payload schema deep-equals the server constant', () => {
  // The doc is the human mirror of the machine contract. It is asserted, not
  // trusted: change QUESTION_PAYLOAD_SCHEMA without updating the doc block and
  // this fails. That is what stops the doc from drifting back into "cards[]" with
  // no shape — the exact state that shipped the blank-card failure.
  const md = fs.readFileSync(DOC, 'utf8');
  const m = md.match(/<!-- payload-schema:begin[\s\S]*?-->\s*```json\n([\s\S]*?)\n```/);
  assert.ok(m, 'the flow doc must carry a <!-- payload-schema:begin --> json block');
  assert.deepEqual(JSON.parse(m[1]), QUESTION_PAYLOAD_SCHEMA,
    'the flow doc payload-schema block has drifted from QUESTION_PAYLOAD_SCHEMA in survey-server.mjs');
});

test('the graph\'s own authored cards + static fallbacks all satisfy the payload validator', () => {
  // Guards the fallbacks against becoming unrenderable themselves: the anti-freeze
  // path serves these verbatim when no agent is attached, so a `{title}` drift here
  // would reproduce the blank-card failure with no agent involved at all.
  let fallbackCardsChecked = 0;
  for (const node of SURVEY_GRAPH.nodes || []) {
    const authored = validateQuestionPayload({ answerKind: node.answerKind, examples: node.examples ?? null, chips: node.chips ?? null, cards: node.cards ?? null, cardMode: node.cardMode });
    assert.equal(authored.ok, true, `node ${node.id} authored content is unrenderable: ${authored.error}`);
    if (node.fallback) {
      const fb = validateQuestionPayload({ answerKind: node.answerKind, examples: node.fallback.examples ?? null, chips: node.fallback.chips ?? null, cards: node.fallback.cards ?? null, cardMode: node.fallback.cardMode });
      assert.equal(fb.ok, true, `node ${node.id} static fallback is unrenderable: ${fb.error}`);
      if (node.fallback.cards) fallbackCardsChecked += 1;
    }
  }
  // Coverage floor: the assertion above is vacuous if no fallback actually ships
  // cards. critical-screens + feature-priority both do.
  assert.ok(fallbackCardsChecked >= 2, `expected ≥2 card-bearing fallbacks, checked ${fallbackCardsChecked}`);
});

// ── resume across a schema upgrade ────────────────────────────────────────────
// Audit finding f1. --resume used the parsed file raw, so a state written by an
// EARLIER version was missing every field added since, and the first write to one
// crashed the request: POST /api/done → 500 "Cannot read properties of undefined
// (reading 'push')", with STATE.done never set — the walk could never complete via
// the contract the server itself publishes. The real dogfood state file that
// motivated this build is exactly that shape.

/** A survey-state.json exactly as the PRE-upgrade server persisted it. */
const legacyStateV1 = (out) => ({
  schemaVersion: 1, project: 'writers-block', out, startingPoint: 'initial-idea',
  platformTarget: null, observedFields: [],
  answers: [{ nodeId: 'jtbd', feedsField: 'scenarios[0].goal', answerKind: 'text', value: 'capture ideas fast', provenance: 'DECIDED', steering: null, at: '2026-07-16T00:00:00Z' }],
  turnLog: [{ seq: 1, actor: 'server', action: 'auto-advance', nodeId: 'jtbd', at: '2026-07-16T00:00:00Z' }],
  coverage: { needs: 0, features: 0, screens: 0, nonGoals: 0, gaps: [], blockers: 0, done: false },
  done: false,
  // note: no `emitted`, no `doneAt`, no `doneBy` — they did not exist yet.
});

test('resume: a PRE-upgrade state file resumes and can still complete (f1 regression)', async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-legacy-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, 'survey-state.json'), JSON.stringify(legacyStateV1(out), null, 2));

  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER, '--out', out, '--project', 'writers-block', '--port', String(port), '--resume'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', (c) => { logs += c; }); child.stderr.on('data', (c) => { logs += c; });
  const base = 'http://127.0.0.1:' + port;
  await waitForServer(base, child, () => logs);
  t.after(() => { if (child.exitCode == null) child.kill('SIGTERM'); });

  assert.deepEqual((await getj(base, '/api/state')).answers.length, 1, 'the resumed answer survives');
  // The crash: this used to 500 and leave the walk permanently unfinishable.
  const done = await post(base, '/api/done', { emitted: ['requirements.md'] });
  assert.equal(done.ok, true, `a legacy resume must accept the published done contract: ${JSON.stringify(done)}`);
  const st = await getj(base, '/api/state');
  assert.equal(st.done, true, 'the walk reaches done');
  assert.deepEqual(st.emitted, ['requirements.md']);
  // And the legacy zero-seed must not resurrect the misleading-0 bar it predates.
  assert.equal(st.coverage.needs, null, 'a v1 zero-seed was never measured — it must normalize to unknown, not resurrect "0 needs"');
  assert.equal(st.coverage.nonGoals, null);
});

test('migrateState: backfills any field the persisted file predates, and CLI identity wins', () => {
  const fresh = { schemaVersion: SCHEMA_VERSION, project: 'p', out: '/new', answers: [], turnLog: [], observedFields: [], emitted: [], doneAt: null, doneBy: null, done: false, coverage: { needs: null, features: null, screens: null, nonGoals: null, gaps: null, blockers: null, done: false } };
  const m = migrateState(legacyStateV1('/old'), { fresh, out: '/new', project: 'renamed' });
  assert.deepEqual(m.emitted, [], 'a field the file predates is backfilled, not left undefined');
  assert.equal(m.doneBy, null);
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.equal(m.answers.length, 1, 'real state survives');
  // Runtime identity is the CLI's, not the file's: resuming with a different --out
  // must write to and DISPLAY the directory we were launched with.
  assert.equal(m.out, '/new', 'a stale persisted out-dir must not override the launch flag');
  assert.equal(m.project, 'renamed');
  // A v1 zero-seed is unknown; anything else is a real measurement and preserved.
  assert.equal(m.coverage.features, null);
  const measured = migrateState({ ...legacyStateV1('/old'), coverage: { needs: 4, features: 9, screens: 3, nonGoals: 2, gaps: [], blockers: 0 } }, { fresh, out: '/new', project: 'p' });
  assert.equal(measured.coverage.needs, 4, 'a real v1 measurement must NOT be discarded');
  assert.equal(measured.coverage.features, 9);
  // A truncated/foreign file degrades to a usable session rather than crashing.
  const fresh5 = { ...fresh, newThing: [] };
  assert.deepEqual(migrateState({ newThing: null }, { fresh: fresh5, out: '/new', project: 'p' }).newThing, [], 'a NEW array field must be guarded structurally, not by an enumerated list');
  const junk = migrateState({ answers: 'nope', emitted: 42, turnLog: null }, { fresh, out: '/new', project: 'p' });
  assert.deepEqual(junk.answers, []);
  assert.deepEqual(junk.emitted, [], 'a non-array emitted must not reach STATE.emitted.push');
  assert.deepEqual(junk.turnLog, []);
  assert.deepEqual(migrateState(null, { fresh, out: '/new', project: 'p' }).emitted, []);
});

// ── the no-agent terminal state ───────────────────────────────────────────────
// Audit finding f2: the server auto-finalizes a walk when no agent is attached,
// but the done screen still said "The host agent is assembling your design
// packet" and span forever — a fake IN-PROGRESS claim replacing the fake
// completion. The server knows better (agentIsStale is what triggered auto-done).

test('no-agent walk: /api/state reports WHO finalized, so the browser cannot fake progress (f2)', async (t) => {
  const { base } = await startServer(t, [], { GW_SURVEY_AGENT_STALE_MS: '150' });
  const fresh = await getj(base, '/api/state');
  assert.equal(fresh.doneBy, null, 'nothing has finalized yet');

  // Self-paced walk, no agent ever attached: answer everything the server serves.
  for (let i = 0; i < 40; i++) {
    const st = await getj(base, '/api/state');
    if (st.done) break;
    if (st.phase === 'await_user' && st.question) {
      await post(base, '/api/answer', { seq: st.seq, ...browserAnswer(st.question) });
    } else { await delay(120); }
  }
  const st = await getj(base, '/api/state');
  assert.equal(st.done, true, 'the anti-freeze fallback still carries a no-agent walk to done');
  assert.equal(st.doneBy, 'server', 'the server finalized it — no agent was ever attached');
  assert.deepEqual(st.emitted, [], 'and nothing was assembled');
});

test('agent-finalized walks are attributed to the agent', async (t) => {
  const { base } = await startServer(t);
  await post(base, '/api/done', { emitted: ['requirements.md'] });
  assert.equal((await getj(base, '/api/state')).doneBy, 'agent');
});

// ── coverage: no misleading zero ──────────────────────────────────────────────
// The bug: a fully-answered 15-question survey displayed
// "0 needs · 0 features · 0 screens · 0 non-goals · 0 gaps". The counters were fed
// only by an agent-posted `coverage` payload the agent never sent, and freshState
// seeded them with 0 — so "never measured" rendered identically to "measured zero".

test('coverage: a fresh survey reports UNKNOWN, not zero', async (t) => {
  const { base } = await startServer(t);
  const c = (await getj(base, '/api/state')).coverage;
  for (const k of ['needs', 'features', 'screens', 'nonGoals', 'gaps']) {
    assert.equal(c[k], null, `${k} was never measured, so it must be null (renders "—"), not 0`);
    assert.notEqual(c[k], 0, `${k} must not claim a measurement of zero`);
  }
});

test('coverage: counts the answers ESTABLISH are derived live, with no agent turn', async (t) => {
  const { base } = await startServer(t);
  const c = await advanceUntilNextNodeKind(base, 'cards'); // → critical-screens
  await post(base, '/api/agent/ask', { seq: c.seq, action: 'ask', question: { nodeId: 'critical-screens' } });
  const live = await getj(base, '/api/state');
  await post(base, '/api/answer', {
    seq: live.seq,
    cards: [
      { label: 'Editor', decision: 'keep' },
      { label: 'Search', decision: 'keep' },
      { label: 'Settings', decision: 'kill' },
    ],
  });
  const cov = (await getj(base, '/api/state')).coverage;
  assert.equal(cov.screens, 2, 'screens is derived from the kept cards the user just chose (the cut one does not count)');
  // Honest about what it cannot know: no survey node feeds needs/nonGoals — the
  // agent assembles those from prose — and gaps come only from a scratch-emit.
  assert.equal(cov.needs, null, 'no node feeds needs; it must stay unknown rather than be guessed');
  assert.equal(cov.nonGoals, null, 'no node feeds nonGoals; it must stay unknown');
  assert.equal(cov.gaps, null, 'gaps come only from the emitter; unknown until measured');
});

test('coverage: agent-measured counts always win over derived ones', async (t) => {
  const { base } = await startServer(t);
  const c = await getj(base, '/api/agent/contract');
  await post(base, '/api/agent/ask', {
    seq: c.seq, action: 'ask', question: { nodeId: 'jtbd' },
    coverage: { needs: 4, features: 9, screens: 3, nonGoals: 2, gaps: ['personas[0].jobs'] },
  });
  const cov = (await getj(base, '/api/state')).coverage;
  assert.equal(cov.needs, 4);
  assert.equal(cov.features, 9, 'a real measurement is not overwritten by derivation');
  assert.equal(cov.nonGoals, 2);
  assert.deepEqual(cov.gaps, ['personas[0].jobs']);
});

test('coverage: an agent CAN report a genuine zero, and it is distinguishable from unknown', async (t) => {
  const { base } = await startServer(t);
  const c = await getj(base, '/api/agent/contract');
  await post(base, '/api/agent/ask', { seq: c.seq, action: 'ask', question: { nodeId: 'jtbd' }, coverage: { nonGoals: 0, gaps: [] } });
  const cov = (await getj(base, '/api/state')).coverage;
  assert.equal(cov.nonGoals, 0, 'a measured zero is preserved as 0 — this is the case the old code could not express');
  assert.deepEqual(cov.gaps, [], 'a measured empty gap list is real (it is the stop-rule signal)');
  assert.equal(cov.needs, null, 'while an unmeasured counter stays unknown');
});

test('deriveCoverage: only counts what a node feedsField actually establishes', () => {
  // Pure unit: derivation is by feedsField → Spec array, not by guessing.
  assert.deepEqual(deriveCoverage([]), {});
  assert.deepEqual(deriveCoverage([{ nodeId: 'feature-priority', feedsField: 'features', answerKind: 'cards', value: [{ label: 'A' }, { label: 'B', decision: 'kill' }] }]), { features: 1 });
  assert.deepEqual(deriveCoverage([{ nodeId: 'critical-screens', feedsField: 'screens', answerKind: 'cards', value: [{ label: 'A' }] }]), { screens: 1 });
  // A text answer feeding prose establishes no countable array.
  assert.deepEqual(deriveCoverage([{ nodeId: 'top-jobs', feedsField: 'personas[0].jobs', answerKind: 'text', value: 'a, b, c' }]), {},
    'prose must not be counted as coverage — that is guessing');
  assert.deepEqual(deriveCoverage([{ feedsField: 'features', answerKind: 'cards', value: 'not-an-array' }]), {});
});

test('mergeCoverage: posted wins, derived backfills, unknown stays unknown', () => {
  assert.deepEqual(mergeCoverage({ features: 9, needs: null }, { features: 2, screens: 3 }),
    { features: 9, needs: null, screens: 3 });
  assert.deepEqual(mergeCoverage({ nonGoals: 0 }, { nonGoals: 5 }), { nonGoals: 0 }, 'a measured 0 is a measurement and must not be backfilled');
});

test('activation path: every module survey.js imports is really served and really parses', async (t) => {
  // Green unit tests do not prove the PAGE works. survey.js is only ever loaded by
  // a browser, so adding a module and forgetting its static route ships a 404 that
  // no other test here would notice — the done screen would simply never render.
  const { base } = await startServer(t);
  const surveyJs = path.join(ROOT, 'designer', 'server', 'survey.js');
  const src = fs.readFileSync(surveyJs, 'utf8');
  const specs = [...src.matchAll(/^import[^']*'([^']+)'/gm)].map((m) => m[1]);
  assert.ok(specs.length >= 2, `expected survey.js to import its browser modules, found ${specs.length}`);

  for (const spec of specs) {
    assert.match(spec, /^\//, `"${spec}" is a bare specifier — a browser cannot resolve it`);
    const r = await fetch(base + spec);
    assert.equal(r.status, 200, `survey.js imports "${spec}" but no route serves it — the browser would 404`);
    assert.match(r.headers.get('content-type') || '', /javascript/, `${spec} must be served as javascript`);
    assert.ok((await r.text()).trim().length > 0, `${spec} served empty`);
  }
  // The page shell + its stylesheet must serve too.
  for (const asset of ['/', '/survey.js', '/survey.css']) {
    assert.equal((await fetch(base + asset)).status, 200, `${asset} must serve`);
  }
  // And the client sources must actually parse (a syntax error is invisible to
  // every server-side test in this file, but fatal in the browser).
  for (const f of [surveyJs, path.join(ROOT, 'designer', 'server', 'survey-view.mjs'), path.join(ROOT, 'designer', 'server', 'survey-alloc.mjs')]) {
    const chk = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(chk.status, 0, `${path.basename(f)} does not parse: ${chk.stderr}`);
  }
});

// ── POST /api/done { emitted } — the terminal-state evidence contract ─────────
// The done screen may only claim a design packet exists if the agent REPORTED
// the files. These cover the wire half; test_survey_view.mjs covers the render.

test('done contract: reported emitted files reach /api/state and survive a restart', async (t) => {
  const { base, out } = await startServer(t);
  const r = await post(base, '/api/done', { emitted: ['requirements.md', 'design.md'], coverage: { gaps: [] } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.emitted, ['requirements.md', 'design.md']);
  const st = await getj(base, '/api/state');
  assert.equal(st.done, true);
  assert.deepEqual(st.emitted, ['requirements.md', 'design.md']);
  assert.ok(st.doneAt, 'the terminal state is timestamped');
  assert.equal(st.out, path.resolve(out), '/api/state exposes the REAL --out the server was launched with');
  // Durable: a reopened tab after a restart must still see the packet, not a
  // working screen that never resolves.
  const persisted = JSON.parse(fs.readFileSync(path.join(out, 'survey-state.json'), 'utf8'));
  assert.deepEqual(persisted.emitted, ['requirements.md', 'design.md']);
});

test('done contract: /api/done without emitted stays honest — done, but nothing claimed', async (t) => {
  const { base } = await startServer(t);
  const r = await post(base, '/api/done', { coverage: { gaps: [] } });
  assert.equal(r.ok, true);
  const st = await getj(base, '/api/state');
  assert.equal(st.done, true, 'the walk still completes — reporting files is optional');
  assert.deepEqual(st.emitted, [], 'but nothing is claimed, so the browser shows a working state');
});

test('done contract: emitted is validated, and repeated reports merge without duplicates', async (t) => {
  const { base } = await startServer(t);
  const bad = await post(base, '/api/done', { emitted: ['requirements.md', ''], coverage: { needs: 7 } });
  assert.equal(bad.ok, false, 'a blank path would render as an empty row');
  assert.match(bad.error, /emitted\[1\]/, 'names the offending entry');
  assert.deepEqual(bad.expected, EMITTED_SHAPE, 'the rejection teaches the shape');
  assert.deepEqual(bad.example, EMITTED_EXAMPLE);
  const afterReject = await getj(base, '/api/state');
  assert.equal(afterReject.done, false, 'a rejected report must not finalize the walk');
  // f6: a rejected request must mutate NOTHING — validation runs before the
  // coverage merge, so a bad `emitted` cannot rewrite the bar on its way out.
  assert.equal(afterReject.coverage.needs, null, 'a rejected /api/done must not have applied its coverage payload');
  assert.deepEqual(afterReject.emitted, []);

  const notArray = await post(base, '/api/done', { emitted: 'requirements.md' });
  assert.equal(notArray.ok, false, 'a bare string is not a file list');

  // An agent may report progressively as it writes.
  await post(base, '/api/done', { emitted: ['requirements.md'] });
  const second = await post(base, '/api/done', { emitted: ['requirements.md', 'design.md'] });
  assert.deepEqual(second.emitted, ['requirements.md', 'design.md'], 'merged, order preserved, no duplicate');
});

test('done contract: /api/agent/contract publishes what to send on completion', async (t) => {
  const { base } = await startServer(t);
  const c = await getj(base, '/api/agent/contract');
  // Same discoverability rule as the question shapes: an agent that never reports
  // `emitted` strands the user on a working screen, so it must not have to read a
  // doc to learn the terminal-state contract.
  assert.deepEqual(c.doneContract, { expected: EMITTED_SHAPE, example: EMITTED_EXAMPLE });
});

test('browser allocation math (frozen contract): any 6-axis ranking yields sum-100 integer weights', () => {
  const axes = ['speed_to_alpha', 'scalability', 'ux_polish', 'maintainability', 'cost', 'security'];
  // exhaustively check a handful of permutations, incl. reverse + rotations
  const orderings = [axes, [...axes].reverse(), [axes[2], axes[0], axes[5], axes[1], axes[4], axes[3]]];
  for (const ranking of orderings) {
    const w = weightsFromRanking(ranking);
    const sum = axes.reduce((a, ax) => a + w[ax], 0);
    assert.equal(sum, 100, `weights must sum to 100 for ranking ${ranking.join(',')}`);
    for (const ax of axes) assert.ok(Number.isInteger(w[ax]), `${ax} weight is an integer`);
    // the top-ranked axis carries the largest weight (monotonic template)
    assert.equal(w[ranking[0]], Math.max(...axes.map((ax) => w[ax])));
    // "never sacrifice" defaults to the most-important axis, not the least (f1)
    assert.equal(neverSacrificeDefault(ranking), ranking[0]);
  }
  assert.equal(TRADEOFF_TEMPLATE.reduce((a, b) => a + b, 0), 100, 'template sums to 100');
});

test('loopback-only bind (C2 acceptance): the server binds 127.0.0.1, not a routable address', async (t) => {
  const port = await reservePort();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-bind-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const { server } = makeServer({ out, project: 'bind', port, resume: false });
  const addr = await new Promise((resolve) => listenWithFallback(server, port, '127.0.0.1', 50, () => resolve(server.address())));
  t.after(() => server.close());
  assert.equal(addr.address, '127.0.0.1', 'bind address must be loopback');
});

test('free-port fallback (finding-7): walks past occupied ports to the next free one', async (t) => {
  // Occupy two consecutive ports so a correct scan must walk twice.
  const b1 = http.createServer(); const b2 = http.createServer();
  const base = await new Promise((r) => { b1.listen(0, '127.0.0.1', () => r(b1.address().port)); });
  await new Promise((r) => { b2.listen(base + 1, '127.0.0.1', r); });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-fp-'));
  t.after(() => { b1.close(); b2.close(); fs.rmSync(out, { recursive: true, force: true }); });
  const { server } = makeServer({ out, project: 'fp', port: base, resume: false });
  const bound = await new Promise((resolve) => listenWithFallback(server, base, '127.0.0.1', 50, resolve));
  t.after(() => server.close());
  assert.equal(bound, base + 2, 'must bind the next free port, not an occupied one');
});

// ── provenance round-trip (finding-10) ───────────────────────────────────────
// A FIXTURE assembler standing in for the host agent's Spec assembly (the agent
// does this reasoning; this is NOT shipped mapping code). It proves the contract:
// a survey-state's DECIDED/ASSUMED/OBSERVED tags survive into the emitted Spec's
// projectContext.evidence[] and (for ASSUMED) assumptions[].
function assembleSpecFromSurveyState(state) {
  const statusOf = { DECIDED: 'decided', ASSUMED: 'assumed', OBSERVED: 'observed' };
  const evidence = state.answers.map((a, i) => ({
    id: `ev-${i + 1}`,
    status: statusOf[a.provenance],
    statement: `${a.feedsField}: ${typeof a.value === 'string' ? a.value : JSON.stringify(a.value)}`,
    sourceRefs: [a.nodeId],
  }));
  const assumptions = state.answers
    .filter((a) => a.provenance === 'ASSUMED')
    .map((a, i) => ({ id: `as-${i + 1}`, text: `${a.feedsField}: ${a.value}`, confidence: 'low' }));
  return {
    schemaVersion: 2,
    id: 'provenance-roundtrip',
    productName: 'Provenance Round Trip',
    productDescription: 'Proves survey provenance tags reach the emitted Spec.',
    platformTarget: 'web',
    projectContext: { startingPoint: 'existing-app', evidence },
    assumptions,
  };
}

test('provenance round-trip: DECIDED/ASSUMED/OBSERVED reach the emitted Spec', () => {
  const surveyState = {
    answers: [
      { nodeId: 'jtbd', feedsField: 'scenarios[0].goal', value: 'observed goal', provenance: 'OBSERVED' },
      { nodeId: 'platform', feedsField: 'platformTarget', value: 'web', provenance: 'DECIDED' },
      { nodeId: 'info-density', feedsField: 'uiPreferences.informationDensity', value: 'balanced', provenance: 'ASSUMED' },
    ],
  };
  const spec = assembleSpecFromSurveyState(surveyState);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-prov-'));
  const specFile = path.join(outDir, 'in.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  const r = spawnSync(process.execPath, [EMITTER, specFile, '--out', outDir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `emitter must accept the assembled Spec: ${r.stderr}`);
  const emitted = JSON.parse(fs.readFileSync(path.join(outDir, 'spec.json'), 'utf8'));
  const statuses = (emitted.projectContext.evidence || []).map((e) => e.status).sort();
  assert.deepEqual(statuses, ['assumed', 'decided', 'observed'], 'all three provenance tags survive into evidence[]');
  assert.equal(emitted.assumptions.length, 1, 'the ASSUMED answer is mirrored into assumptions[]');
  fs.rmSync(outDir, { recursive: true, force: true });
});
