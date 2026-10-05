// test_survey_rehearsal.mjs — C6 REHEARSAL (whole-plan acceptance, automated).
//
// A scripted end-to-end walk where a FIXTURE host agent long-polls the survey
// contract and fixture "browser" answers drive a complete EXISTING-APP survey,
// persists the shipped observation batch, then a fixture assembler (standing in
// for the remaining general Spec reasoning) emits a real design packet. Asserts:
//   1. emitted .designdoc set exists and the emitter exits 0
//   2. OBSERVED pre-fill count > 0 (inspection actually seeded)
//   4. ≤ ~12 on-screen questions to reach done; tradeoff allocation completed
//      via rounds (sum-100, carried into the Spec as an ADR)
//   5. provenance tags present in the emitted Spec
//
// NOT covered here (the REAL interactive dogfood, handed off): sub-check 3's U1
// platform-mismatch ADR and the subjective "is this my intent" check.
//
// Run: node --test designer/tests/test_survey_rehearsal.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER = path.join(ROOT, 'designer', 'server', 'survey-server.mjs');
const EMITTER = path.join(ROOT, 'engine', 'dist', 'cli.js');

function reservePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
const post = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const getj = (base, p) => fetch(base + p).then((r) => r.json());

// The fixture "browser" answer for a live question, by answerKind.
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

// FIXTURE assembler standing in for the host agent's Spec reasoning (NOT shipped
// mapping code). Maps survey-state provenance → evidence + assumptions, and the
// tradeoff allocation → an ADR (tradeoffWeights is a ProductState field, not a
// Spec field, so it reaches the emitted docs via ADRSchema.cites).
function assembleSpec(state) {
  const statusOf = { DECIDED: 'decided', ASSUMED: 'assumed', OBSERVED: 'observed' };
  const str = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  const evidence = state.answers.map((a, i) => ({ id: `ev-${i + 1}`, status: statusOf[a.provenance], statement: `${a.feedsField}: ${str(a.value)}`, sourceRefs: [a.nodeId] }));
  const assumptions = state.answers.filter((a) => a.provenance === 'ASSUMED').map((a, i) => ({ id: `as-${i + 1}`, text: `${a.feedsField}: ${str(a.value)}`, confidence: 'low' }));
  const alloc = state.answers.find((a) => a.nodeId === 'tradeoff-allocation');
  const adrs = alloc ? [{
    id: 'adr-tradeoffs', title: 'Build tradeoff allocation',
    context: `100-point allocation ${JSON.stringify(alloc.value.weights)}; never sacrifice ${alloc.value.unacceptable_tradeoff}.`,
    decision: `Optimize per the allocation and protect ${alloc.value.unacceptable_tradeoff}.`,
    reversibility: 'medium', cites: Object.keys(alloc.value.weights),
  }] : [];
  const jobs = state.answers.find((a) => a.nodeId === 'top-jobs');
  return {
    schemaVersion: 2, id: 'c6-rehearsal', productName: 'C6 Rehearsal App',
    productDescription: 'Existing-app requirements captured via the Groundwork: Requirements survey.',
    platformTarget: state.platformTarget || 'web',
    projectContext: { startingPoint: 'existing-app', evidence },
    assumptions, adrs,
    personas: [{ id: 'p1', name: 'Primary user', jobs: jobs ? [str(jobs.value)] : [] }],
    scenarios: [{ id: 's1', context: 'existing app', goal: 'accomplish the core job', successSignal: 'the job gets done' }],
  };
}

test('C6 rehearsal: fixture agent drives a full existing-app walk and emits a Spec', async (t) => {
  const port = await reservePort();
  const designdoc = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-c6-designdoc-'));
  const child = spawn(process.execPath, [SERVER, '--out', designdoc, '--project', 'spectra-rehearsal', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/state')).ok) break; } catch { /* boot */ } await delay(50); }
  t.after(() => { if (child.exitCode == null) child.kill('SIGTERM'); fs.rmSync(designdoc, { recursive: true, force: true }); });

  // 1. Existing-app inspection seed (OBSERVED). Two facts inspection established.
  let s = await getj(base, '/api/state');
  const seed = await post(base, '/api/agent/ask', {
    seq: s.seq,
    action: 'seed',
    specId: 'spec-spectra',
    startingPoint: 'existing-app',
    platformTarget: 'macos',
    sourcePaths: ['src/SpectraApp.swift', 'Package.swift'],
    platformSurfaces: [
      {
        id: 'surface-macos', platform: 'macos', role: 'primary', name: 'Spectra Studio',
        interactionModes: ['pointer', 'keyboard'], featureIds: [], provenance: 'observed',
      },
      {
        id: 'surface-web', platform: 'web', role: 'companion', name: 'Spectra Web',
        interactionModes: ['pointer'], featureIds: [], provenance: 'observed',
      },
    ],
    observed: [
      { nodeId: 'platform', feedsField: 'platformTarget', value: 'macos' },
      { nodeId: 'jtbd', feedsField: 'scenarios[0].goal', value: 'draft and organize writing faster' },
      { nodeId: 'primary-user-pain', feedsField: 'personas[0]', value: 'a writer drowning in scattered notes' },
    ],
  });
  assert.equal(seed.ok, true);
  const observedCount = seed.observedFields.length;

  // 2. Drive the walk with the UNIFIED driver (auto-advance aware): poll /api/state;
  //    answer any live question (agent-asked OR server-auto-served); when it is the
  //    agent's turn, ask the deterministic next DYNAMIC node the contract hands back.
  //    Static nodes are served by the server with no /api/agent/ask — so agentAsks
  //    counts only the LLM-composed turns. Cap at 12 on-screen questions.
  let questionCount = 0; // total on-screen questions answered (agent-asked + auto-served)
  let agentAsks = 0;     // /api/agent/ask calls == the LLM-composed dynamic turns
  for (let guard = 0; guard < 60; guard++) {
    const st = await getj(base, '/api/state');
    if (st.done || st.phase === 'done') break;
    if (st.phase === 'await_user' && st.question) {
      const ans = await post(base, '/api/answer', { seq: st.seq, ...browserAnswer(st.question) });
      assert.equal(ans.ok, true, `answer ${st.question.nodeId}: ${JSON.stringify(ans)}`);
      questionCount += 1;
      continue;
    }
    // await_agent: the server hands back the deterministic next node to compose.
    const contract = await getj(base, '/api/agent/contract');
    if (contract.done || contract.complete || !contract.nextNode) {
      const current = await getj(base, '/api/state');
      const recorded = await post(base, '/api/agent/ask', {
        seq: current.seq,
        action: 'record',
        sourceAnswerNodeIds: ['feature-priority'],
        structuredObservations: [{
          id: 'obs-proposed-workbench',
          target: { field: 'changeSet.proposed', entityId: 'change-workbench' },
          value: {
            id: 'change-workbench', targetType: 'surface', targetId: 'surface-macos',
            summary: 'Adapt the Requirements Studio to the inspected Spectra macOS workbench.', featureIds: [],
          },
        }],
      });
      assert.equal(recorded.ok, true, `record decided topology: ${JSON.stringify(recorded)}`);
      await post(base, '/api/done', { coverage: { gaps: [] } });
      break;
    }
    const ask = await post(base, '/api/agent/ask', { seq: contract.seq, action: 'ask', question: { nodeId: contract.nextNode.id } });
    assert.equal(ask.ok, true, `ask ${contract.nextNode.id}: ${JSON.stringify(ask)}`);
    agentAsks += 1;
  }

  const finalState = JSON.parse(fs.readFileSync(path.join(designdoc, 'survey-state.json'), 'utf8'));
  const observationBatch = await getj(base, '/api/observations');

  // ── sub-check 2: OBSERVED pre-fill count > 0 ──
  assert.ok(observedCount > 0, 'inspection seeded at least one OBSERVED fact');
  assert.ok(finalState.answers.some((a) => a.provenance === 'OBSERVED'), 'OBSERVED answers present in state');
  const surfaceObservations = observationBatch.observations.filter((item) => item.target.field === 'platformSurfaces');
  assert.deepEqual(surfaceObservations.map((item) => item.value.platform), ['macos', 'web'], 'inspected native primary + web companion are preserved');
  assert.ok(surfaceObservations.every((item) => item.provenance === 'observed'));
  const proposed = observationBatch.observations.find((item) => item.id === 'obs-proposed-workbench');
  assert.equal(proposed.provenance, 'decided', 'the user-approved change is DECIDED');
  assert.deepEqual(proposed.sourceRefs, [{ kind: 'survey', nodeId: 'feature-priority' }]);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(designdoc, 'observation-batch.json'), 'utf8')),
    observationBatch,
    'live handoff and persisted observation batch match',
  );

  // ── sub-check 4a: bounded question count ──
  assert.ok(questionCount <= 12, `on-screen questions ${questionCount} must be ≤ ~12`);
  assert.ok(questionCount >= 1, 'the walk asked at least one on-screen question');

  // ── sub-check 4b: tradeoff allocation completed via rounds, sum-100 ──
  const alloc = finalState.answers.find((a) => a.nodeId === 'tradeoff-allocation');
  assert.ok(alloc, 'tradeoff allocation was completed');
  const sum = Object.values(alloc.value.weights).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100, 'allocation weights sum to exactly 100');
  assert.ok(alloc.value.unacceptable_tradeoff, 'unacceptable_tradeoff captured');

  // ── sub-checks 1 & 5: emitter exits 0 into the .designdoc; provenance in Spec ──
  const spec = assembleSpec(finalState);
  const specFile = path.join(designdoc, 'assembled-spec.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  const r = spawnSync(process.execPath, [EMITTER, specFile, '--out', designdoc], { encoding: 'utf8' });
  assert.equal(r.status, 0, `emitter must exit 0: ${r.stderr}`);
  for (const f of ['spec.json', 'requirements.md', 'design.md', 'tasks.md', 'builder-handoff.md', 'traceability.json']) {
    assert.ok(fs.existsSync(path.join(designdoc, f)), `emitted set includes ${f}`);
  }
  const emitted = JSON.parse(fs.readFileSync(path.join(designdoc, 'spec.json'), 'utf8'));
  const statuses = new Set((emitted.projectContext.evidence || []).map((e) => e.status));
  assert.ok(statuses.has('observed'), 'OBSERVED provenance survived into the emitted Spec');
  assert.ok(statuses.has('decided'), 'DECIDED provenance survived into the emitted Spec');
  // the tradeoff allocation reached the Spec as an ADR (sum-100 encoded there)
  assert.ok((emitted.adrs || []).some((a) => a.id === 'adr-tradeoffs' && /"security":15/.test(a.context)), 'tradeoff allocation carried into the Spec as an ADR');

  // ── auto-advance: the server served the static tail with no agent turn ──
  const autoServed = finalState.turnLog.filter((e) => e.action === 'auto-advance').length;
  assert.ok(agentAsks < questionCount, `hybrid: agent asks (${agentAsks}) < on-screen questions (${questionCount}) — statics auto-advanced`);
  assert.ok(autoServed > 0, 'at least one static node was auto-advanced server-side');
  assert.equal(agentAsks + autoServed, questionCount, 'every on-screen question was either agent-asked or server-auto-served');

  console.log(`  rehearsal: ${observedCount} OBSERVED seeds, ${questionCount} on-screen questions `
    + `(${agentAsks} agent turns + ${autoServed} auto-advanced), allocation sum=${sum}, emitter exit 0`);
});
