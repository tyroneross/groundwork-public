import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SURVEY_PACKET_ARTIFACTS = [
  'spec.json',
  'requirements.md',
  'design.md',
  'tasks.md',
  'builder-handoff.md',
  'traceability.json',
];

const answer = (state, nodeId) => (state.answers || []).find((item) => item.nodeId === nodeId);
const strings = (value) => Array.isArray(value)
  ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
  : [];
const text = (value) => typeof value === 'string' ? value.trim() : '';
const keptCards = (value) => Array.isArray(value)
  ? value.filter((item) => item && typeof item.label === 'string' && item.label.trim() && item.decision !== 'kill')
  : [];
const idPart = (value, fallback) => {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || fallback;
};

export function assembleSurveySpec(state, project = state.project || 'groundwork-project') {
  const jtbd = text(answer(state, 'jtbd')?.value);
  const pain = text(answer(state, 'primary-user-pain')?.value);
  const topJobs = text(answer(state, 'top-jobs')?.value);
  const features = keptCards(answer(state, 'feature-priority')?.value).map((card, index) => ({
    id: `feature-${idPart(card.label, index + 1)}`,
    title: card.label.trim(),
    surface: 'ui',
    priority: card.priority || 'P1',
    needIds: [],
    acceptanceCriteria: [],
  }));
  const screens = keptCards(answer(state, 'critical-screens')?.value).map((card, index) => ({
    id: `screen-${idPart(card.label, index + 1)}`,
    name: card.label.trim(),
    purpose: 'Support the confirmed primary workflow.',
    featureIds: [],
    states: ['initial', 'loading', 'empty', 'success', 'error'],
  }));
  const evidenceStatus = { DECIDED: 'decided', ASSUMED: 'assumed', OBSERVED: 'observed' };
  const answerEvidence = (state.answers || []).map((item, index) => ({
    id: `evidence-survey-${index + 1}`,
    status: evidenceStatus[item.provenance] || 'assumed',
    statement: `${item.feedsField}: ${typeof item.value === 'string' ? item.value : JSON.stringify(item.value)}${text(item.steering) ? `; steering: ${text(item.steering)}` : ''}`,
    sourceRefs: [item.nodeId],
  }));
  const observationEvidence = (state.structuredObservations || []).map((item, index) => ({
    id: `evidence-observation-${index + 1}`,
    status: item.provenance || 'observed',
    statement: `${item.target?.field || 'structured observation'}:${item.target?.entityId || item.id || index + 1}: ${JSON.stringify(item.value)}`,
    sourceRefs: Array.isArray(item.sourceRefs) && item.sourceRefs.length
      ? item.sourceRefs.map((ref) => JSON.stringify(ref))
      : [item.id || `structured-observation-${index + 1}`],
  }));
  const evidence = [...answerEvidence, ...observationEvidence];
  const assumptions = (state.answers || [])
    .filter((item) => item.provenance === 'ASSUMED')
    .map((item, index) => ({ id: `assumption-${index + 1}`, text: `${item.feedsField}: ${String(item.value)}`, confidence: 'low' }));
  const allocation = answer(state, 'tradeoff-allocation')?.value;
  const adrs = allocation?.weights ? [{
    id: 'adr-build-tradeoffs',
    title: 'Build tradeoff allocation',
    context: `100-point allocation ${JSON.stringify(allocation.weights)}; never sacrifice ${allocation.unacceptable_tradeoff}.`,
    decision: `Use the confirmed allocation and protect ${allocation.unacceptable_tradeoff}.`,
    reversibility: 'medium',
    cites: Object.keys(allocation.weights),
  }] : [];
  const brand = strings(answer(state, 'brand-adjectives')?.value);
  const responsive = strings(answer(state, 'responsive-range')?.value);
  const layout = keptCards(answer(state, 'workspace-layout-preference')?.value).map((item) => item.label.trim());
  const progress = strings(answer(state, 'progress-feedback-preference')?.value);
  const voice = text(answer(state, 'voice')?.value);
  const productName = String(project).split(/[-_]/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') || 'Groundwork Project';

  return {
    schemaVersion: 2,
    id: `requirements-${idPart(project, 'project')}`,
    productName,
    productDescription: jtbd || 'Product direction confirmed through Groundwork Requirements.',
    platformTarget: state.platformTarget || 'web',
    projectContext: { startingPoint: state.startingPoint || 'unspecified', evidence },
    assumptions,
    personas: [{ id: 'persona-primary', name: 'Primary user', jobs: topJobs ? [topJobs] : [], ...(pain ? { trigger: pain } : {}) }],
    scenarios: [{ id: 'scenario-primary', personaId: 'persona-primary', context: 'Primary workflow', goal: jtbd || 'Complete the core product job', successSignal: 'The user produces a usable result.' }],
    needs: [
      ...(jtbd ? [{ id: 'need-core-outcome', title: 'Complete the core outcome', description: jtbd, priority: 'P0', source: 'jtbd' }] : []),
      ...(pain ? [{ id: 'need-reduce-current-pain', title: 'Reduce the current workflow pain', description: pain, priority: 'P0', source: 'primary-user-pain' }] : []),
    ],
    features,
    screens,
    adrs,
    ...(voice ? {
      voiceProfile: {
        principles: [voice],
        examples: [{ context: 'Confirmed product voice', copy: voice }],
      },
    } : {}),
    uiPreferences: {
      informationDensity: strings(answer(state, 'info-density')?.value)[0],
      brandAdjectives: brand,
      accessibilityFloor: strings(answer(state, 'a11y-floor')?.value),
      responsiveTargets: responsive.length ? { deviceClasses: responsive } : undefined,
      mustKeep: layout,
      mayEvolve: progress,
    },
  };
}

export function emitSurveyPacket({ state, out, project, emitterPath }) {
  fs.mkdirSync(out, { recursive: true });
  const stage = fs.mkdtempSync(path.join(out, '.requirements-packet-'));
  try {
    const input = path.join(stage, 'confirmed-spec-input.json');
    fs.writeFileSync(input, `${JSON.stringify(assembleSurveySpec(state, project), null, 2)}\n`);
    const result = spawnSync(process.execPath, [emitterPath, input, '--out', stage], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0) {
      return { ok: false, error: (result.stderr || result.stdout || 'Groundwork emitter failed').trim() };
    }
    const missing = SURVEY_PACKET_ARTIFACTS.filter((name) => !fs.existsSync(path.join(stage, name)));
    if (missing.length) return { ok: false, error: `Emitter did not create: ${missing.join(', ')}` };
    const traceability = JSON.parse(fs.readFileSync(path.join(stage, 'traceability.json'), 'utf8'));
    const coverageGaps = Array.isArray(traceability.coverageGaps) ? traceability.coverageGaps : [];
    for (const name of SURVEY_PACKET_ARTIFACTS) fs.renameSync(path.join(stage, name), path.join(out, name));
    return { ok: true, emitted: [...SURVEY_PACKET_ARTIFACTS], coverageGaps };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
