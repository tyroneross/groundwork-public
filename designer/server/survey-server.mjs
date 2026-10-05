#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────────────
// survey-server.mjs — Groundwork: Requirements (GW-P4).
//
// A zero-dependency Node stdlib server that lets a HOST AGENT adaptively drive a
// browser requirements survey. It is the SAME machine as designer-server.mjs's
// agent-contract mode (host agent = the branching brain; browser = presentation)
// pointed at REQUIREMENTS QUESTIONS instead of design swatches.
//
// There is NO embedded AI backend and NO Python engine bridge here. The host
// agent reads the Spec-so-far, chooses the next material question from the
// executable graph (survey-graph.json), the browser renders it, every answer
// lands in the agent's hands with a provenance tag, and the agent assembles the
// SAME SpecSchema JSON the chat design flow already emits. This server records a
// typed, provenance-bearing observation batch; engine/src/observations.ts owns
// the only deterministic mapping from that batch into Spec v3.
//
// Usage:
//   node designer/server/survey-server.mjs --out <dir> --project <slug> [--port 8901] [--resume]
//
//   --out <dir>      directory that owns survey-state.json (and, later, the Spec)
//   --project <slug> project label surfaced in the header + state file
//   --port <n>       preferred loopback port; a free-port fallback scan (finding-7)
//                    walks upward if it is busy
//   --resume         reload an existing survey-state.json from --out and replay
//                    the coverage bar instead of starting fresh
//
// Loopback-only bind (127.0.0.1): single-user local tool, no LAN surface.
// ───────────────────────────────────────────────────────────────────────

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  OBSERVATION_BATCH_ARTIFACT,
  OBSERVATION_BATCH_CONTRACT,
  OBSERVATION_FIELDS,
  buildObservationBatch,
  normalizeStructuredObservation,
  upsertStructuredObservation,
  writeObservationBatch,
} from './observation-batch.mjs';
import { emitSurveyPacket, SURVEY_PACKET_ARTIFACTS } from './survey-packet.mjs';
import { WORKFLOW_STAGES } from './survey-view.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── FROZEN WIRE CONTRACT (single source of truth) ─────────────────────────────
// The per-turn question payload is a SUPERSET of engine/src/spec.ts OpenQuestionSchema
// (whose answerKind enum is only text|choice). The wire contract keeps `text`,
// renders `choice`+answerChips as `chips`, and ADDS `cards` and `allocation` —
// WITHOUT touching engine/src/spec.ts (extending the engine enum is out of scope;
// no chunk owns engine/). survey.js reads these constants via GET /api/init so the
// browser and the server never drift.
export const ANSWER_KINDS = ['text', 'chips', 'cards', 'allocation'];

// The priority enum a feature card may carry, and the chips cap the flow doc
// freezes. Declared ONCE here; the browser reads them off /api/init (it must not
// re-declare them) and the doc's schema block is asserted against them.
export const CARD_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const MAX_CHIPS = 8;
export const MOCKUP_LAYOUTS = ['single-focus', 'sidebar-canvas', 'three-pane'];
export const WORKING_DRAFT_ARTIFACT = 'requirements-working-draft.md';
export { SURVEY_PACKET_ARTIFACTS } from './survey-packet.mjs';

// The six tradeoff axes a Phase-4 allocation distributes 100 points across, plus
// the required "unacceptable_tradeoff" choice. Mirrors TRADEOFF_AXES /
// TradeoffWeightsSchema in engine/src/spec.ts (:331-366) so the browser-computed
// weights validate against the emitter unchanged.
export const TRADEOFF_AXES = [
  'speed_to_alpha',
  'scalability',
  'ux_polish',
  'maintainability',
  'cost',
  'security',
];

/**
 * ── THE QUESTION PAYLOAD SHAPE, DECLARED ONCE ───────────────────────────────
 *
 * Root cause of the blank-card failure: the `cards[]` element shape existed ONLY
 * inside the browser (survey.js renderCards reads `card.label` / `card.priority`)
 * and NOWHERE in the contract the host agent reads. The flow doc said `cards[]`
 * with no inner shape, so an agent that correctly followed the documented contract
 * STILL produced an unrenderable payload — and the server answered ok:true. That
 * is a CONTRACT defect, not agent carelessness. A validator alone would not fix
 * it either: rejecting a payload whose shape is still undiscoverable just turns a
 * silent blank screen into a guess-reject-guess loop.
 *
 * So this object is the single source, and every consumer reads it:
 *   • the server validator — validateQuestionPayload(), below.
 *   • the AGENT, at the moment of use — GET /api/agent/contract returns the schema
 *     for the very node it is being asked to compose, and GET /api/init returns the
 *     whole map. The agent learns the shape from the machine, never from prose.
 *   • every rejection — the error carries `expected` + `example`, so a wrong guess
 *     is self-correcting from the response alone, with no extra reads.
 *   • the BROWSER — survey.js reads cardPriorities off /api/init instead of
 *     re-declaring the enum. Re-declaring it is what caused this bug.
 *   • the FLOW DOC — references/requirements-studio.md embeds this object verbatim
 *     between <!-- payload-schema:begin/end --> markers; the conformance test parses
 *     that block and deep-equals it against this constant, so the doc cannot drift.
 *
 * `field` names the payload key the kind uses. `element: true` means
 * `expected`/`example` describe ONE ARRAY ELEMENT, not the field itself.
 */
export const QUESTION_PAYLOAD_SCHEMA = {
  text: {
    field: 'examples',
    element: true,
    expected: {
      label: 'string (required) — non-empty short title',
      text: 'string (required) — non-empty answer that can be edited before submission',
    },
    example: {
      label: 'Share a decision-ready dashboard',
      text: 'Turn project files and data into a polished HTML dashboard that teammates can open and use.',
    },
    note: 'The browser always renders a free-form textarea. Optional examples appear as selectable starting points that fill the textarea but never auto-submit.',
  },
  chips: {
    field: 'chips',
    element: false,
    expected: { chips: `string[] (optional) — 1..${MAX_CHIPS} non-empty labels` },
    example: { chips: ['Compact', 'Spacious'] },
    note: 'Rendered as multi-select buttons; a free-text box is always offered alongside.',
  },
  cards: {
    field: 'cards',
    element: true,
    expected: {
      label: 'string (required) — non-empty',
      priority: `${CARD_PRIORITIES.join('|')} (optional)`,
      mockup: `{ layout: ${MOCKUP_LAYOUTS.join('|')}, regions: string[1..6] } (optional)`,
    },
    example: { label: 'Quick capture', priority: 'P0' },
    note: 'The browser renders card.label into the name input and card.priority into the priority select. A card with no non-empty label renders as a BLANK box.',
  },
  allocation: {
    field: null,
    element: false,
    expected: {},
    example: {},
    // Says plainly that there is nothing to supply. The earlier wording ("the
    // agent supplies axes only") advertised a knob the server does not honor:
    // questionFromNode always serves all six, because TradeoffWeightsSchema
    // requires weights for all six summing to 100 — a 3-axis question could not
    // produce a valid Spec. Teaching a field that is validated and then ignored
    // is the same discoverability defect as documenting no shape at all.
    note: `No agent-suppliable payload: the server always serves all six tradeoff axes (${TRADEOFF_AXES.join('|')}), because TradeoffWeightsSchema requires all six summing to 100. The browser derives the weights + unacceptable_tradeoff from the user's best-worst rounds. An "axes" key, if sent, is validated against the six but never substituted.`,
  },
};

/** The agent-facing schema for one answerKind, safe for an unknown kind. */
export function payloadSchemaFor(answerKind) {
  return QUESTION_PAYLOAD_SCHEMA[answerKind] || null;
}

// ── POST /api/done { emitted } — the terminal-state evidence contract ─────────
// Published on /api/init + /api/agent/contract for the same reason the question
// shapes are: an agent should learn what to send from the machine, not from prose.
export const EMITTED_SHAPE = { emitted: 'string[] (optional) — paths of the artifacts you wrote, relative to --out' };
export const EMITTED_EXAMPLE = { emitted: ['requirements.md', 'design.md', 'traceability.json'] };

// ── resume migration ─────────────────────────────────────────────────────────
// `--resume` JSON.parse'd the file and used it raw, so a state written by ANY
// earlier version was missing every field added since — and the first write to
// one crashed the request (`STATE.emitted.push` → TypeError → 500, walk can never
// reach done). Backfilling from freshState() closes the whole class: a field added
// there is automatically defaulted on resume, not just the one that broke.
export const SCHEMA_VERSION = 5;

// The v1 coverage seed. v1 could not express "unknown" — it seeded zeros — so in a
// v1 FILE a coverage object that deep-equals this seed was never measured, and
// resuming it verbatim resurrects the misleading "0 needs · 0 features" bar. It
// normalizes to the unknown seed. Applied only when the file's schemaVersion says
// v1 (see migrateState); from v2 on, null means unknown and 0 means measured, so
// there is nothing to infer and a real all-zero measurement is preserved.
const V1_COVERAGE_SEED = { needs: 0, features: 0, screens: 0, nonGoals: 0, gaps: [], blockers: 0 };
function isV1CoverageSeed(c) {
  if (!c || typeof c !== 'object') return false;
  return Object.entries(V1_COVERAGE_SEED).every(([k, v]) => (
    Array.isArray(v) ? Array.isArray(c[k]) && c[k].length === 0 : c[k] === v
  ));
}

/**
 * Reconcile a persisted survey-state.json against the current schema.
 * `fresh` is freshState(); `out`/`project` are the CURRENT CLI flags.
 * Pure and exported so the resume contract is testable without a server.
 */
export function migrateState(parsed, { fresh, out, project }) {
  const p = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  const state = { ...fresh, ...p };
  // Runtime identity comes from the CLI, never the file: resuming with a
  // different --out must write to, and display, the directory we were LAUNCHED
  // with. Otherwise the done screen shows a path nothing is being written to.
  state.out = out;
  state.project = project;
  // Type-guard every collection, derived STRUCTURALLY from the canonical default
  // rather than an enumerated list: a field the file carries as null (or as the
  // wrong type entirely) must not reach a `.push`. Enumerating the names would rot
  // the moment freshState() gains another array — the same shape of bug this
  // function exists to close.
  for (const key of Object.keys(fresh)) {
    if (Array.isArray(fresh[key]) && !Array.isArray(state[key])) state[key] = [];
  }
  // Normalize the v1 all-zero coverage seed to unknown — but ONLY for a v1 file.
  // schemaVersion is the exact discriminator, so there is no need to infer intent
  // from the value: a v2 agent that genuinely measures all-zeros keeps its
  // measurement. (Read from `p`, the file, before we stamp the current version.)
  const fileVersion = Number.isFinite(p.schemaVersion) ? p.schemaVersion : 1;
  state.coverage = (fileVersion < 2 && isV1CoverageSeed(p.coverage))
    ? { ...fresh.coverage, done: !!(p.coverage && p.coverage.done) }
    : { ...fresh.coverage, ...(p.coverage && typeof p.coverage === 'object' ? p.coverage : {}) };
  state.schemaVersion = SCHEMA_VERSION;
  state.done = !!state.done;
  return state;
}

// ── coverage: derive what the answers ESTABLISH, admit the rest is unknown ────
//
// The bug: freshState seeded coverage with `{ needs: 0, features: 0, screens: 0,
// nonGoals: 0 }`. Those zeros are indistinguishable from "the agent measured zero",
// so a fully-answered 15-question survey displayed "0 needs · 0 features · 0
// screens · 0 non-goals" — a confident lie, because the agent never posted the
// coverage payload that feeds them. `null` now means UNKNOWN and renders as "—".
//
// A count is derived ONLY where a survey node's feedsField directly establishes
// that Spec array. `needs` and `nonGoals` have NO node feeding them (they are
// assembled by the agent from the jtbd/pain/jobs prose), and `gaps` comes only
// from a scratch-emit's traceability. Those stay unknown rather than guessed:
// inventing a plausible number is the same class of error as the original zero.
const FEEDS_TO_COVERAGE = { features: 'features', screens: 'screens' };

/**
 * Live counts implied by the recorded answers. Returns only the keys the survey
 * genuinely establishes; everything else is absent (→ stays unknown).
 */
export function deriveCoverage(answers = []) {
  const derived = {};
  for (const a of Array.isArray(answers) ? answers : []) {
    const key = FEEDS_TO_COVERAGE[a && a.feedsField];
    if (!key || a.answerKind !== 'cards' || !Array.isArray(a.value)) continue;
    // `kill` is an explicit cut; it does not count toward coverage of the array.
    derived[key] = a.value.filter((c) => c && typeof c === 'object' && c.decision !== 'kill').length;
  }
  return derived;
}

/** Agent-measured coverage always wins; derived fills only what is still unknown. */
export function mergeCoverage(posted = {}, derived = {}) {
  const out = { ...posted };
  for (const [k, v] of Object.entries(derived)) if (out[k] == null) out[k] = v;
  return out;
}

/** Validate POST /api/done's `emitted`. Returns { ok, error?, value? }. */
export function validateEmitted(emitted) {
  if (!Array.isArray(emitted)) {
    return { ok: false, error: 'emitted must be an array of artifact path strings' };
  }
  const value = [];
  for (let i = 0; i < emitted.length; i++) {
    const f = emitted[i];
    if (typeof f !== 'string' || !f.trim()) {
      return { ok: false, error: `emitted[${i}] must be a non-empty string (got ${JSON.stringify(f)})` };
    }
    value.push(f.trim());
  }
  return { ok: true, value };
}

// The endpoint table the flow doc (references/requirements-studio.md) freezes and
// test_survey_server.mjs parses. Every entry here must have a live route below.
export const ENDPOINTS = [
  { method: 'GET', path: '/api/init', purpose: 'boot the browser: wire contract + graph + resumed state' },
  { method: 'GET', path: '/api/agent/contract', purpose: 'agent READ side: long-poll for its turn, deliver-once answer + steering' },
  { method: 'POST', path: '/api/agent/ask', purpose: 'agent WRITE side: seed OBSERVED | record DECIDED | infer ASSUMED | ask a node' },
  { method: 'POST', path: '/api/answer', purpose: 'browser submits the user answer (DECIDED); server validates + persists' },
  { method: 'POST', path: '/api/save-draft', purpose: 'persist the unfinished current answer without advancing the walk' },
  { method: 'POST', path: '/api/export-draft', purpose: 'write an explicitly incomplete working brief from captured answers and drafts' },
  { method: 'POST', path: '/api/generate-packet', purpose: 'user confirms completed requirements and creates the local planning packet' },
  { method: 'POST', path: '/api/workflow/continue', purpose: 'request the next Groundwork stage with the saved decisions as context' },
  { method: 'POST', path: '/api/workflow/report', purpose: 'agent reports a requested stage complete or blocked with evidence' },
  { method: 'GET', path: '/api/state', purpose: 'non-mutating: answers + provenance + coverage bar (restart recovery)' },
  { method: 'GET', path: '/api/observations', purpose: 'typed observation batch for deterministic Spec v3 mapping' },
  { method: 'POST', path: '/api/done', purpose: 'agent signals the walk is complete' },
];

// Provenance tags map 1:1 onto engine/src/spec.ts EvidenceStatus (observed|decided|assumed).
export const PROVENANCE = { OBSERVED: 'OBSERVED', DECIDED: 'DECIDED', ASSUMED: 'ASSUMED' };

// ── Agent-attachment staleness window (graceful-degradation control) ──────────
// A host agent is "attached" only while it long-polls /api/agent/contract. This
// is a HUMAN-IN-BROWSER survey: the user may self-pace over hours, and the agent
// may step away. When the walk reaches a DYNAMIC node and no agent has polled
// within this window, the server serves that node's STATIC FALLBACK instead of
// hard-stalling in await_agent (the observed freeze). When an agent HAS polled
// recently, the node still flips to await_agent so the agent can enrich it.
// Overridable via env for fast tests; defaults to 25s in production.
export const AGENT_ATTACH_WINDOW_MS = (() => {
  const v = Number(process.env.GW_SURVEY_AGENT_STALE_MS);
  return Number.isFinite(v) && v > 0 ? v : 25000;
})();

// ── Graph + skip evaluator (shared with the graph tests) ──────────────────────
export const SURVEY_GRAPH = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'survey-graph.json'), 'utf8'),
);

/**
 * Pure, data-driven skip evaluator. The graph JSON carries the rules; this reads
 * them. The SERVER calls this to reject an ask for a skipped node; the graph
 * tests import it and walk survey-graph.json with the same logic (no drift).
 *
 * facts: { platformTarget?:string, startingPoint?:string, observedFields?:Set<string> }
 * returns: { skipped:boolean, reason?:string }
 */
export function isNodeSkipped(node, facts = {}) {
  for (const rule of node.skipWhen || []) {
    if (rule.platformTargetIn && facts.platformTarget && rule.platformTargetIn.includes(facts.platformTarget)) {
      return { skipped: true, reason: `platformTarget=${facts.platformTarget}` };
    }
    if (rule.startingPointIn && facts.startingPoint && rule.startingPointIn.includes(facts.startingPoint)) {
      return { skipped: true, reason: `startingPoint=${facts.startingPoint}` };
    }
  }
  if (
    node.skipWhenObserved !== false &&
    node.feedsField &&
    facts.observedFields &&
    facts.observedFields.has(node.feedsField)
  ) {
    return { skipped: true, reason: 'OBSERVED' };
  }
  return { skipped: false };
}

/**
 * A node is DYNAMIC when its content must be composed by the host agent from the
 * user's own prior answers (chips/cards drawn from what they said). Default false:
 * a STATIC node carries its prompt + chips/cards in survey-graph.json and the
 * server serves it directly (auto-advance) with no agent round-trip.
 */
export function isNodeDynamic(node) {
  return !!(node && node.dynamic === true);
}

/**
 * Deterministic server-side walk order. Returns the first node in graph-declared
 * order that is neither already answered nor skipped (given the current facts),
 * or null when the walk is complete. This is the SAME reachability the graph tests
 * and the agent's contract use — the server owns the ORDER so it can auto-advance
 * static nodes without asking the agent which node comes next.
 *
 * graph:       SURVEY_GRAPH (or a compatible { nodes:[…] })
 * facts:       { platformTarget?, startingPoint?, observedFields:Set }
 * answeredIds: Set<string> of nodeIds already recorded in STATE.answers
 */
export function computeNextNode(graph, facts, answeredIds) {
  for (const node of graph.nodes || []) {
    if (answeredIds.has(node.id)) continue;
    if (isNodeSkipped(node, facts).skipped) continue;
    return node;
  }
  return null;
}

/** Honest walk progress. Remaining is an upper bound because the adaptive host
 * may stop early once further questions would not change the next action. */
export function buildSurveyProgress(graph, state = {}) {
  const answeredIds = new Set((state.answers || []).map((a) => a.nodeId));
  const facts = {
    platformTarget: state.platformTarget || null,
    startingPoint: state.startingPoint || 'unspecified',
    observedFields: new Set(state.observedFields || []),
  };
  const eligible = (graph.nodes || []).filter((node) => !isNodeSkipped(node, facts).skipped);
  const answered = eligible.filter((node) => answeredIds.has(node.id)).length;
  const remaining = Math.max(0, eligible.length - answered);
  const optionalRemaining = eligible.filter((node) => node.optional && !answeredIds.has(node.id)).length;
  return {
    answered,
    total: eligible.length,
    remaining,
    optionalRemaining,
    percent: eligible.length ? Math.round((answered / eligible.length) * 100) : 100,
    estimate: true,
  };
}

export function validateDraft(answerKind, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'draft payload must be an object' };
  }
  const encoded = JSON.stringify(payload);
  if (encoded.length > 65536) return { ok: false, error: 'draft payload exceeds 64 KiB' };
  if (answerKind === 'text' && typeof payload.text !== 'string') {
    return { ok: false, error: 'text draft requires a text string' };
  }
  if (answerKind === 'chips') {
    if (!Array.isArray(payload.chosen) || payload.chosen.some((v) => typeof v !== 'string') || typeof payload.free !== 'string') {
      return { ok: false, error: 'chips draft requires chosen:string[] and free:string' };
    }
  }
  if (answerKind === 'cards' && (!Array.isArray(payload.cards) || payload.cards.some((card) => !card || typeof card.label !== 'string'))) {
    return { ok: false, error: 'cards draft requires cards with string labels' };
  }
  if (answerKind === 'allocation') {
    const lists = ['remaining', 'bestOrder', 'worstOrder'];
    if (lists.some((key) => !Array.isArray(payload[key]) || payload[key].some((axis) => !TRADEOFF_AXES.includes(axis)))) {
      return { ok: false, error: 'allocation draft contains invalid axes' };
    }
  }
  return { ok: true, value: JSON.parse(encoded) };
}

const quoteDraft = (value) => String(value ?? '').split('\n').map((line) => `> ${line}`).join('\n');
function workingDraftValue(answerKind, value) {
  if (answerKind === 'cards' && Array.isArray(value)) return value.length
    ? value.map((c) => `${c.label}${c.priority ? ` (${c.priority})` : ''}${c.decision === 'kill' ? ' [cut]' : ''}`).join(', ')
    : 'No option selected yet.';
  if (answerKind === 'allocation' && value?.weights) return Object.entries(value.weights).map(([k, v]) => `${k}: ${v}`).join(', ');
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

function unfinishedDraftValue(draft) {
  if (draft.answerKind === 'text') return draft.payload?.text ?? '';
  if (draft.answerKind === 'cards') return draft.payload?.cards ?? [];
  if (draft.answerKind === 'chips') return [...(draft.payload?.chosen || []), draft.payload?.free || ''].filter(Boolean);
  if (draft.answerKind === 'allocation') return draft.payload?.finalWeights
    ? { weights: draft.payload.finalWeights }
    : `${(draft.payload?.bestOrder || []).length + (draft.payload?.worstOrder || []).length} tradeoff picks saved`;
  return draft.payload;
}

/** Deterministic, explicitly incomplete readback; this is not a synthesized Spec. */
export function renderWorkingDraft({ state, graph = SURVEY_GRAPH, progress, currentQuestion = null }) {
  const nodeMap = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const lines = [
    `# ${state.project || 'Product'} — working requirements draft`,
    '',
    '> Status: incomplete working draft. Groundwork has not converted this into a validated Spec or build handoff.',
    '',
    `Progress: ${progress.answered} of ${progress.total} eligible decisions captured; up to ${progress.remaining} remain.`,
    '',
    '## Captured decisions',
    '',
  ];
  for (const answer of state.answers || []) {
    const label = nodeMap.get(answer.nodeId)?.readbackLabel || answer.nodeId;
    lines.push(`### ${label} (${String(answer.provenance || 'unknown').toLowerCase()})`, '', quoteDraft(workingDraftValue(answer.answerKind, answer.value)), '');
  }
  if (!(state.answers || []).length) lines.push('_No submitted decisions yet._', '');
  const activeDraft = currentQuestion && (state.drafts || []).find((draft) => draft.nodeId === currentQuestion.nodeId);
  if (activeDraft) {
    const label = nodeMap.get(activeDraft.nodeId)?.readbackLabel || activeDraft.nodeId;
    lines.push('## Saved unfinished answer', '', `### ${label}`, '', quoteDraft(workingDraftValue(activeDraft.answerKind, unfinishedDraftValue(activeDraft))), '');
  }
  if ((state.structuredObservations || []).length) {
    lines.push('## Observed product context', '');
    for (const observation of state.structuredObservations) lines.push(`- ${observation.target?.field || observation.id}: ${quoteDraft(workingDraftValue('text', observation.value)).replace(/^> /, '')}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Validate a browser answer for a given answerKind. Returns { ok, error?, value }. */
export function validateAnswer(answerKind, payload) {
  if (answerKind === 'allocation') {
    const w = payload && payload.weights;
    if (!w || typeof w !== 'object') return { ok: false, error: 'allocation requires a weights object' };
    let sum = 0;
    for (const axis of TRADEOFF_AXES) {
      const v = w[axis];
      if (!Number.isInteger(v) || v < 0 || v > 100) {
        return { ok: false, error: `allocation weight for ${axis} must be an integer 0–100` };
      }
      sum += v;
    }
    if (sum !== 100) return { ok: false, error: `allocation weights must sum to exactly 100 (got ${sum})` };
    if (!TRADEOFF_AXES.includes(payload.unacceptable_tradeoff)) {
      return { ok: false, error: 'allocation requires unacceptable_tradeoff to be one of the six axes' };
    }
    // Rebuild from the six known axes so a caller cannot smuggle extra keys into
    // the persisted/agent-delivered weights (audit finding f2).
    const weights = Object.fromEntries(TRADEOFF_AXES.map((a) => [a, w[a]]));
    return { ok: true, value: { weights, unacceptable_tradeoff: payload.unacceptable_tradeoff } };
  }
  if (answerKind === 'cards') {
    const cards = payload && payload.cards;
    if (!Array.isArray(cards)) return { ok: false, error: 'cards answer requires a cards array' };
    return { ok: true, value: cards };
  }
  if (answerKind === 'chips') {
    // chips answers may be one or many selected chips plus optional free text.
    const chosen = (payload && payload.chosen) ?? payload?.value ?? [];
    return { ok: true, value: chosen };
  }
  // text (and any OpenQuestion `choice` rendered as text)
  const text = payload && (payload.text ?? payload.value);
  if (typeof text !== 'string') return { ok: false, error: 'text answer requires a string value' };
  return { ok: true, value: text };
}

/**
 * Validate an AGENT-SUPPLIED question payload BEFORE it can reach the browser.
 *
 * `validateAnswer` guards the browser→server direction; this is its missing
 * counterpart, the agent→browser direction. It is the LAST line of the
 * blank-card fix, not the fix itself: the fix is that QUESTION_PAYLOAD_SCHEMA
 * now exists and is published to the agent (see that constant). This function
 * only enforces it — and every rejection it returns carries that same schema's
 * `expected` + `example`, so an agent can self-correct from the error alone
 * without reading a doc or the browser source.
 *
 * Scope: the RAW agent payload, not the graph-merged question. The graph's own
 * authored content is trusted at runtime (a graph defect must not surface as an
 * error blaming the agent) and is guarded at test time instead — the tests assert
 * every authored node + static fallback satisfies this validator.
 *
 * Only fields that are PRESENT are checked: a bare `{ nodeId }` ask is legitimate
 * and common (questionFromNode fills the rest from the graph).
 *
 * returns: { ok:true } | { ok:false, error, expected, example }
 */
export function validateQuestionPayload(q = {}) {
  // Every rejection quotes the ONE schema, so the error and the contract the
  // agent polled can never disagree.
  const reject = (answerKind, error) => {
    const schema = payloadSchemaFor(answerKind);
    return {
      ok: false,
      error,
      expected: schema ? schema.expected : undefined,
      example: schema ? schema.example : undefined,
    };
  };

  if (!q || typeof q !== 'object' || Array.isArray(q)) {
    return { ok: false, error: 'question must be an object' };
  }
  if (q.answerKind !== undefined && !ANSWER_KINDS.includes(q.answerKind)) {
    return { ok: false, error: `unknown answerKind: ${JSON.stringify(q.answerKind)}; expected one of: ${ANSWER_KINDS.join('|')}` };
  }

  if (q.cards != null) {
    if (!Array.isArray(q.cards) || q.cards.length === 0) {
      return reject('cards', 'cards must be a non-empty array');
    }
    for (let i = 0; i < q.cards.length; i++) {
      const c = q.cards[i];
      const at = `cards[${i}]`;
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        return reject('cards', `${at} must be an object`);
      }
      if (typeof c.label !== 'string' || !c.label.trim()) {
        // Echo the keys that WERE posted: the observed defect was {id,title,why},
        // and naming those keys next to `expected` is what makes the error a fix.
        const keys = Object.keys(c);
        const got = keys.length ? `got { ${keys.join(', ')} }` : 'got an empty object';
        return reject('cards', `${at} is missing required "label" (${got}) — a card without a non-empty label renders as a blank box`);
      }
      if (c.priority !== undefined && !CARD_PRIORITIES.includes(c.priority)) {
        return reject('cards', `${at} ("${c.label}") has priority ${JSON.stringify(c.priority)}; must be one of ${CARD_PRIORITIES.join('|')}`);
      }
      if (c.mockup !== undefined) {
        if (!c.mockup || typeof c.mockup !== 'object' || Array.isArray(c.mockup)) {
          return reject('cards', `${at}.mockup must be an object`);
        }
        if (!MOCKUP_LAYOUTS.includes(c.mockup.layout)) {
          return reject('cards', `${at}.mockup.layout must be one of ${MOCKUP_LAYOUTS.join('|')}`);
        }
        if (!Array.isArray(c.mockup.regions) || c.mockup.regions.length < 1 || c.mockup.regions.length > 6 || c.mockup.regions.some((r) => typeof r !== 'string' || !r.trim())) {
          return reject('cards', `${at}.mockup.regions must contain 1–6 non-empty strings`);
        }
      }
    }
  }

  if (q.cardMode !== undefined && !['keep-kill', 'single'].includes(q.cardMode)) {
    return reject('cards', 'cardMode must be keep-kill or single');
  }

  if (q.chips != null) {
    if (!Array.isArray(q.chips) || q.chips.length === 0) {
      return reject('chips', 'chips must be a non-empty array of strings');
    }
    if (q.chips.length > MAX_CHIPS) {
      return reject('chips', `chips must hold at most ${MAX_CHIPS} entries (got ${q.chips.length})`);
    }
    for (let i = 0; i < q.chips.length; i++) {
      if (typeof q.chips[i] !== 'string' || !q.chips[i].trim()) {
        return reject('chips', `chips[${i}] must be a non-empty string (got ${JSON.stringify(q.chips[i])})`);
      }
    }
  }

  if (q.examples != null) {
    if (!Array.isArray(q.examples) || q.examples.length === 0) {
      return reject('text', 'examples must be a non-empty array');
    }
    for (let i = 0; i < q.examples.length; i++) {
      const example = q.examples[i];
      const at = `examples[${i}]`;
      if (!example || typeof example !== 'object' || Array.isArray(example)) {
        return reject('text', `${at} must be an object`);
      }
      if (typeof example.label !== 'string' || !example.label.trim()) {
        return reject('text', `${at} is missing required non-empty "label"`);
      }
      if (typeof example.text !== 'string' || !example.text.trim()) {
        return reject('text', `${at} is missing required non-empty "text"`);
      }
    }
  }

  if (q.axes != null) {
    // Reject `axes` OUTRIGHT rather than validating it and then discarding it.
    // questionFromNode always serves all six (TradeoffWeightsSchema requires all
    // six summing to 100, so a subset could not produce a valid Spec). Accepting
    // a subset with ok:true and silently substituting all six is the same
    // silent-divergence defect as the blank cards: the agent believes it shaped
    // the question and the browser shows something else. Making the field
    // unrepresentable beats disclaiming it in a note.
    return reject('allocation', `the server owns the tradeoff axes — remove "axes"; all six are always served (${TRADEOFF_AXES.join('|')})`);
  }

  return { ok: true };
}

// ── CLI flags ─────────────────────────────────────────────────────────────────
function parseFlags(argv) {
  const at = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : null;
  };
  return {
    out: at('--out') || process.cwd(),
    project: at('--project') || 'requirements-studio',
    port: parseInt(at('--port') || '8901', 10),
    resume: argv.includes('--resume'),
  };
}

function projectSpecId(project) {
  const slug = String(project || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `spec-${slug || 'requirements'}`;
}

// ── Per-session state ─────────────────────────────────────────────────────────
function makeServer(opts) {
  const OUT = path.resolve(opts.out);
  const PROJECT = opts.project;
  const STATE_PATH = path.join(OUT, 'survey-state.json');

  // Persisted survey state. Every answer lands here atomically; nothing ever lives
  // only in memory (U2).
  let STATE = freshState();
  let resumed = false;

  function freshState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      specId: projectSpecId(PROJECT),
      project: PROJECT,
      out: OUT,
      startingPoint: 'unspecified', // unspecified | initial-idea | existing-definition | existing-app
      platformTarget: null,
      observedFields: [], // Spec paths pre-filled by inspection → their nodes skip
      answers: [], // { nodeId, feedsField, answerKind, value, provenance, at, steering }
      drafts: [], // unfinished browser answers; saved explicitly, never treated as DECIDED
      // Typed facts that can be deterministically applied to Spec v3. Unknown
      // fields are not invented; buildObservationBatch emits them as unresolved.
      structuredObservations: [],
      turnLog: [], // { seq, actor, action, nodeId?, at }
      // null = UNKNOWN, and the browser renders it as "—". Seeding these with 0
      // is what made a fully-answered survey report "0 needs · 0 features": a
      // measurement that never happened is not a measurement of zero.
      coverage: { needs: null, features: null, screens: null, nonGoals: null, gaps: null, blockers: null, done: false },
      done: false,
      // Artifact paths the host agent REPORTED writing (POST /api/done { emitted }).
      // Empty means "nothing reported", which the done screen renders as a working
      // state — never as a completed one. The browser must not claim files exist
      // that no one reported.
      emitted: [],
      doneAt: null,
      // WHO finalized the walk: 'agent' (it will assemble a packet) or 'server'
      // (auto-done because no agent was ever attached — nothing is assembling, and
      // the done screen must not pretend otherwise).
      doneBy: null,
      // Downstream stages use the same durable shell. A browser request becomes
      // visible to /api/agent/contract with all prior answers and measured gaps;
      // the agent reports its outcome into history instead of losing stage state
      // in chat context.
      workflowRequest: null,
      workflowHistory: [],
    };
  }

  if (opts.resume && fs.existsSync(STATE_PATH)) {
    try {
      // Reconcile against the current schema rather than trusting the file: a
      // state written by an older version is missing every field added since.
      STATE = migrateState(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')), { fresh: freshState(), out: OUT, project: PROJECT });
      resumed = true;
    } catch {
      // No silent failure (audit finding f5c): a corrupt resume file is preserved
      // aside and surfaced, not silently discarded — a recoverable session could
      // otherwise be lost with no signal.
      const aside = `${STATE_PATH}.corrupt-${Date.now()}`;
      try { fs.renameSync(STATE_PATH, aside); } catch { /* best effort */ }
      console.error(`[survey] survey-state.json was unreadable; preserved at ${aside}, starting fresh.`);
      STATE = freshState();
    }
  }

  // Atomic tmp+rename persist. No answer is ever acknowledged before it is durable.
  function persist() {
    fs.mkdirSync(OUT, { recursive: true });
    const tmp = path.join(OUT, `.survey-state.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(STATE, null, 2));
    fs.renameSync(tmp, STATE_PATH);
    writeObservationBatch(
      fs,
      path,
      OUT,
      buildObservationBatch(STATE, SURVEY_GRAPH.observationContract?.requiredFields || OBSERVATION_FIELDS),
    );
  }

  function facts() {
    return {
      platformTarget: STATE.platformTarget,
      startingPoint: STATE.startingPoint,
      observedFields: new Set(STATE.observedFields || []),
    };
  }

  function observationBatch() {
    return buildObservationBatch(
      STATE,
      SURVEY_GRAPH.observationContract?.requiredFields || OBSERVATION_FIELDS,
    );
  }

  function batchSummary() {
    const batch = observationBatch();
    return {
      contract: batch.contract,
      artifact: OBSERVATION_BATCH_ARTIFACT,
      observations: batch.observations.length,
      unresolved: batch.unresolved.length,
    };
  }

  function seedSourceRefs(sourcePaths) {
    if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
      return [{ kind: 'artifact', path: '.visual-bootstrap.json' }];
    }
    return sourcePaths.map((sourcePath) => ({ kind: 'repo', path: sourcePath }));
  }

  // Build a live question payload from a graph node (STATIC content) with optional
  // agent-supplied overrides (a DYNAMIC ask carries composed prompt/chips/cards).
  // Single source for both the agent-ask path and the server auto-advance path so
  // the two never drift.
  function questionFromNode(node, o = {}) {
    const answerKind = o.answerKind || node.answerKind;
    const platformChips = node.chipsByPlatform?.[STATE.platformTarget]
      || node.chipsByPlatform?.default;
    return {
      nodeId: node.id,
      prompt: o.prompt || node.prompt,
      help: o.help || node.help || null,
      answerKind,
      feedsField: o.feedsField || node.feedsField,
      examples: o.examples || node.examples || null,
      chips: o.chips || platformChips || node.chips || null,
      cards: o.cards || node.cards || null,
      cardMode: o.cardMode || node.cardMode || 'keep-kill',
      elicitation: o.elicitation || node.elicitation || null,
      axes: answerKind === 'allocation' ? TRADEOFF_AXES : null,
    };
  }

  // Build a live question for a DYNAMIC node from its graph-authored STATIC
  // FALLBACK (`node.fallback = { prompt, chips?, cards? }`). Served when the walk
  // reaches a dynamic node and no host agent is attached — so a self-paced survey
  // never hard-stalls waiting for agent enrichment.
  function fallbackQuestion(node) {
    const fb = node.fallback || {};
    return questionFromNode(node, { prompt: fb.prompt, help: fb.help, examples: fb.examples, chips: fb.chips, cards: fb.cards, cardMode: fb.cardMode });
  }

  // Grace-aware agent-attachment staleness. An agent is "stale" (treated as absent
  // for fallback purposes) when nothing has polled /api/agent/contract within
  // AGENT_ATTACH_WINDOW_MS. BOOTED_AT is a floor so the FIRST window after boot is
  // a grace period: an agent-driven or existing-app-seed session that attaches
  // within the window is never pre-empted by a premature fallback.
  const agentIsStale = () => Date.now() - Math.max(AGENT_SEEN_AT, BOOTED_AT) >= AGENT_ATTACH_WINDOW_MS;

  // Set a question live (await_user), advance seq, log + persist. `actor`/`action`
  // record WHO served it: 'agent'/'ask' (agent composed), 'server'/'auto-advance'
  // (static, no agent turn), or 'server'/'serve-prefetch' (dynamic, pre-posted).
  function serveQuestion(question, actor, action) {
    TURN.question = question;
    TURN.phase = 'await_user';
    TURN.seq += 1;
    STATE.turnLog.push({ seq: TURN.seq, actor, action, nodeId: question.nodeId, at: new Date().toISOString() });
    persist();
  }

  const answeredIds = () => new Set(STATE.answers.map((a) => a.nodeId));

  // Drop prefetched questions that can no longer be served (already answered, or now
  // skipped because facts changed) so a stale pre-post never resurfaces.
  function prunePrefetch() {
    const answered = answeredIds();
    const f = facts();
    PREFETCH = PREFETCH.filter((q) => {
      if (answered.has(q.nodeId)) return false;
      const node = (SURVEY_GRAPH.nodes || []).find((n) => n.id === q.nodeId);
      return node && !isNodeSkipped(node, f).skipped;
    });
  }

  // The core hybrid engine (Part A + Part B). Called after a user answer (and on a
  // seamless resume). Computes the next non-skipped, unanswered node in graph order:
  //   • none            → walk complete; stay await_agent so the agent assembles the Spec.
  //   • STATIC          → serve it directly (auto-advance), no agent turn.
  //   • DYNAMIC, queued → serve the pre-posted question instantly (prefetch hit).
  //   • DYNAMIC, unqueued → stay await_agent so the agent composes it.
  // Returns a small descriptor for the caller's response + tests.
  function advance() {
    if (STATE.done || TURN.phase !== 'await_agent') return { served: false, phase: TURN.phase };
    prunePrefetch();
    const next = computeNextNode(SURVEY_GRAPH, facts(), answeredIds());
    if (!next) {
      // Walk complete. If an agent is attached, stay await_agent so it assembles
      // the Spec + POST /api/done. If NO agent is attached (self-paced survey),
      // finalize server-side so the walk reaches `done` instead of soft-stalling.
      if (agentIsStale()) {
        STATE.done = true;
        STATE.coverage.done = true;
        // The server finalized this walk precisely BECAUSE no agent is attached,
        // so no packet is being assembled. Record that: the done screen would
        // otherwise show "the host agent is assembling your design packet" and
        // spin forever on a claim the server knows to be false.
        STATE.doneBy = 'server';
        STATE.doneAt = STATE.doneAt || new Date().toISOString();
        TURN.phase = 'done';
        TURN.question = null;
        TURN.seq += 1;
        STATE.turnLog.push({ seq: TURN.seq, actor: 'server', action: 'auto-done', at: new Date().toISOString() });
        persist();
        return { served: false, complete: true, autoDone: true, phase: 'done' };
      }
      return { served: false, complete: true, phase: 'await_agent' };
    }
    if (!isNodeDynamic(next)) {
      serveQuestion(questionFromNode(next), 'server', 'auto-advance');
      return { served: true, source: 'auto-advance', nodeId: next.id, phase: 'await_user' };
    }
    // Dynamic: serve from the prefetch queue if the agent already composed it.
    const idx = PREFETCH.findIndex((q) => q.nodeId === next.id);
    if (idx !== -1) {
      const q = PREFETCH.splice(idx, 1)[0];
      serveQuestion(q, 'server', 'serve-prefetch');
      return { served: true, source: 'prefetch', nodeId: next.id, phase: 'await_user' };
    }
    // Dynamic, unqueued. If a host agent is attached (polled recently), wait for it
    // to compose richer, user-word-derived content (unchanged behavior). If NO agent
    // is attached, serve the node's STATIC FALLBACK immediately so the browser never
    // hard-stalls — the recorded answer is DECIDED either way (no double-serve: once
    // answered the node is in answeredIds and computeNextNode skips it).
    if (agentIsStale()) {
      serveQuestion(fallbackQuestion(next), 'server', 'fallback');
      return { served: true, source: 'fallback', nodeId: next.id, phase: 'await_user' };
    }
    return { served: false, source: 'await_agent', nodeId: next.id, dynamic: true, phase: 'await_agent' };
  }

  // ── Turn guard (U3: REIMPLEMENTED, not copied from designer-server) ──────────
  // designer-server's guard interleaves seq guards with Python-engine bridge calls
  // and taste-walk mutation; that code is not cleanly copyable. This is a fresh,
  // minimal implementation of the SAME PATTERN: a monotonically-increasing seq,
  // stale-turn rejection on both write sides, and deliver-once mailboxes.
  //
  //   phase: 'await_agent' — the agent must POST /api/agent/ask (choose next node)
  //          'await_user'  — a question is live; the browser must POST /api/answer
  //          'done'        — the walk is complete
  let TURN = { phase: 'await_agent', seq: 0, question: null };

  // Deliver-once mailboxes (cleared the first time the recipient reads them).
  let PENDING_ANSWER = null;   // last user answer → delivered once to the agent
  let PENDING_STEERING = null; // free-text steering the user typed → agent, once
  let AGENT_SEEN_AT = 0;       // ms epoch of the last /api/agent/contract poll (0 = never)
  const BOOTED_AT = Date.now(); // grace floor: first AGENT_ATTACH_WINDOW_MS after boot

  // ── Prefetch queue (Part B) ──────────────────────────────────────────────────
  // A small FIFO of DYNAMIC questions the agent pre-composed AHEAD of its turn
  // (while the user was still answering the current node). When the walk reaches a
  // dynamic node whose question is already queued, the server serves it INSTANTLY
  // instead of flipping to await_agent — the agent's LLM composition happened
  // behind the user's think-time, off the critical path. Additive: a normal
  // (non-queued) ask is unchanged.
  let PREFETCH = []; // [{ nodeId, prompt, answerKind, chips, cards, feedsField, axes }]

  function publicState() {
    return {
      project: STATE.project,
      specId: STATE.specId,
      out: STATE.out,
      startingPoint: STATE.startingPoint,
      platformTarget: STATE.platformTarget,
      observedFields: STATE.observedFields,
      observationBatchPath: OBSERVATION_BATCH_ARTIFACT,
      answers: STATE.answers,
      draft: TURN.question ? (STATE.drafts || []).find((draft) => draft.nodeId === TURN.question.nodeId) || null : null,
      walkProgress: buildSurveyProgress(SURVEY_GRAPH, STATE),
      // Agent-measured coverage, backfilled with counts the answers themselves
      // establish (features/screens). Anything neither measured nor derivable
      // stays null and renders as "—" — never a misleading 0.
      coverage: mergeCoverage(STATE.coverage, deriveCoverage(STATE.answers)),
      done: STATE.done,
      // The done screen renders `out` as the real destination and `emitted` as
      // the only evidence a packet was actually written.
      emitted: STATE.emitted || [],
      doneAt: STATE.doneAt || null,
      // Lets the browser distinguish "an agent is assembling the packet" from
      // "the server finalized this walk because no agent was ever attached, so
      // nothing is assembling". Without it the done screen claims the former in
      // both cases.
      doneBy: STATE.doneBy || null,
      workflowRequest: STATE.workflowRequest || null,
      workflowHistory: STATE.workflowHistory || [],
      phase: TURN.phase,
      seq: TURN.seq,
      question: TURN.phase === 'await_user' ? TURN.question : null,
      // Honest empty-state signal: an agent is "attached" only if it actually
      // polled the contract within AGENT_ATTACH_WINDOW_MS (the same window the
      // fallback engine uses, so the browser's state and the server's decision
      // never drift). Lets the browser show a genuine "preparing…" vs a stall.
      agentAttached: AGENT_SEEN_AT > 0 && Date.now() - AGENT_SEEN_AT < AGENT_ATTACH_WINDOW_MS,
    };
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────
  const SECURITY_HEADERS = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
  const sendJSON = (res, status, obj) => {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const sendFile = (res, file, mime) => {
    try {
      const data = fs.readFileSync(file);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': mime });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  };
  const readBody = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Defense-in-depth beyond the 127.0.0.1 bind (audit finding f4): reject a
  // state-mutating POST that carries a cross-origin Origin header, so a malicious
  // page open in the same browser cannot inject survey answers via a simple
  // cross-site request. A same-origin browser POST sends Origin=http://<loopback>
  // (allowed); the host agent (curl/node) sends no Origin (allowed).
  function originAllowed(req) {
    const o = req.headers.origin;
    if (!o) return true;
    try { const h = new URL(o).hostname; return h === '127.0.0.1' || h === 'localhost'; } catch { return false; }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (req.method === 'POST' && !originAllowed(req)) {
        return sendJSON(res, 403, { error: 'cross-origin POST rejected (loopback-only tool)' });
      }
      // ── static UI ──────────────────────────────────────────────────────────
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        return sendFile(res, path.join(__dirname, 'survey.html'), 'text/html');
      }
      if (req.method === 'GET' && p === '/survey.css') {
        return sendFile(res, path.join(__dirname, 'survey.css'), 'text/css');
      }
      if (req.method === 'GET' && p === '/survey.js') {
        return sendFile(res, path.join(__dirname, 'survey.js'), 'application/javascript');
      }
      if (req.method === 'GET' && p === '/survey-alloc.js') {
        // The browser's best-worst → sum-100 module (imported by survey.js).
        return sendFile(res, path.join(__dirname, 'survey-alloc.mjs'), 'application/javascript');
      }
      if (req.method === 'GET' && p === '/survey-view.js') {
        // The browser's pure view-model builders (imported by survey.js; the
        // node tests import the same .mjs directly and drive it with fixtures).
        return sendFile(res, path.join(__dirname, 'survey-view.mjs'), 'application/javascript');
      }

      // ── GET /api/init ────────────────────────────────────────────────────────
      if (req.method === 'GET' && p === '/api/init') {
        return sendJSON(res, 200, {
          wireContract: {
            answerKinds: ANSWER_KINDS,
            tradeoffAxes: TRADEOFF_AXES,
            endpoints: ENDPOINTS,
            provenance: PROVENANCE,
            // The payload shapes, published to BOTH readers of this endpoint.
            // survey.js reads cardPriorities from here rather than re-declaring
            // the enum — a second declaration is the defect that caused the
            // blank-card failure, so the browser must never hold its own copy.
            payloadSchemas: QUESTION_PAYLOAD_SCHEMA,
            cardPriorities: CARD_PRIORITIES,
            mockupLayouts: MOCKUP_LAYOUTS,
            maxChips: MAX_CHIPS,
            observationBatch: {
              contract: OBSERVATION_BATCH_CONTRACT,
              endpoint: '/api/observations',
              artifact: OBSERVATION_BATCH_ARTIFACT,
              fields: OBSERVATION_FIELDS,
            },
          },
          graph: SURVEY_GRAPH,
          project: PROJECT,
          out: OUT,
          resumed,
          state: publicState(),
        });
      }

      // ── GET /api/state ─────────────────────────────────────────────────────
      // Non-mutating live view: coverage bar + restart recovery.
      if (req.method === 'GET' && p === '/api/state') {
        return sendJSON(res, 200, publicState());
      }

      // ── GET /api/observations ──────────────────────────────────────────────
      // The shipped handoff into engine/src/observations.ts. The same object is
      // atomically persisted as observation-batch.json after every state change.
      if (req.method === 'GET' && p === '/api/observations') {
        return sendJSON(
          res,
          200,
          buildObservationBatch(STATE, SURVEY_GRAPH.observationContract?.requiredFields || OBSERVATION_FIELDS),
        );
      }

      // ── GET /api/agent/contract ────────────────────────────────────────────
      // Agent READ side. Long-poll until it is the agent's turn, then hand it the
      // Spec-so-far facts, the graph, coverage, and (deliver-once) the last user
      // answer + any steering text.
      if (req.method === 'GET' && p === '/api/agent/contract') {
        AGENT_SEEN_AT = Date.now();
        if (TURN.phase === 'done' || STATE.done) {
          if (STATE.workflowRequest) {
            return sendJSON(res, 200, {
              phase: 'workflow',
              done: false,
              seq: TURN.seq,
              workflowRequest: STATE.workflowRequest,
              answers: STATE.answers,
              coverage: mergeCoverage(STATE.coverage, deriveCoverage(STATE.answers)),
              emitted: STATE.emitted || [],
              out: STATE.out,
              reportContract: {
                endpoint: '/api/workflow/report',
                expected: { stageId: 'interface|architecture|build', status: 'complete|blocked', emitted: 'string[] (optional)', summary: 'string (optional)' },
              },
            });
          }
          return sendJSON(res, 200, { phase: 'done', done: true, seq: TURN.seq });
        }
        for (let i = 0; i < 100; i++) {
          if (TURN.phase === 'await_agent') break;
          if (TURN.phase === 'done') return sendJSON(res, 200, { phase: 'done', done: true, seq: TURN.seq });
          await sleep(250);
        }
        if (TURN.phase !== 'await_agent') {
          return sendJSON(res, 200, { phase: TURN.phase, seq: TURN.seq, waiting: true });
        }
        const lastAnswer = PENDING_ANSWER; PENDING_ANSWER = null;    // deliver-once
        const steering = PENDING_STEERING; PENDING_STEERING = null;  // deliver-once
        // The server owns the walk ORDER; hand the agent the deterministic next
        // node it should compose (DYNAMIC) — or `complete` when the walk is done
        // and the agent should assemble the Spec + POST /api/done. STATIC nodes are
        // never surfaced here: the server auto-advances them without an agent turn.
        const next = computeNextNode(SURVEY_GRAPH, facts(), answeredIds());
        return sendJSON(res, 200, {
          phase: 'await_agent',
          seq: TURN.seq,
          graph: SURVEY_GRAPH,
          facts: { platformTarget: STATE.platformTarget, startingPoint: STATE.startingPoint, observedFields: STATE.observedFields },
          answers: STATE.answers,
          coverage: STATE.coverage,
          lastAnswer,
          steering,
          // The node the agent must compose, WITH the payload shape it has to
          // produce. Publishing the schema here — on the read side the agent
          // already polls every turn — is the actual fix for the blank-card
          // failure: the shape is now discoverable at the moment of use, so an
          // agent never has to infer it from prose or from survey.js.
          nextNode: next
            ? {
              id: next.id, dynamic: isNodeDynamic(next), feedsField: next.feedsField,
              answerKind: next.answerKind, prompt: next.prompt,
              payloadSchema: payloadSchemaFor(next.answerKind),
            }
            : null,
          // The whole map too, so an agent composing ahead (prefetch) or handling
          // several kinds has every shape without a second request.
          payloadSchemas: QUESTION_PAYLOAD_SCHEMA,
          // What to send when the walk completes. Surfaced on the same read side
          // so the terminal state is as discoverable as the question shapes: an
          // agent that never reports `emitted` leaves the user on a working
          // screen forever, and it should not have to read a doc to learn that.
          doneContract: { expected: EMITTED_SHAPE, example: EMITTED_EXAMPLE },
          observationBatch: {
            contract: OBSERVATION_BATCH_CONTRACT,
            endpoint: '/api/observations',
            artifact: OBSERVATION_BATCH_ARTIFACT,
            fields: OBSERVATION_FIELDS,
          },
          complete: !next,
        });
      }

      // ── POST /api/agent/ask ────────────────────────────────────────────────
      // Agent WRITE side. Body:
      //   { action:'ask',  question:{ nodeId, prompt, answerKind, chips?, cards?, feedsField, seq }, coverage? }
      //   { action:'seed', platformSurfaces?, structuredObservations?, sourcePaths? } → OBSERVED
      //   { action:'record', sourceAnswerNodeIds, structuredObservations }       → DECIDED
      //   { action:'infer', nodeId, feedsField, answerKind, value, observation? } → ASSUMED
      //   { action:'done', coverage? }
      // Stale-seq guard rejects an ask/infer made against a superseded turn.
      if (req.method === 'POST' && p === '/api/agent/ask') {
        const body = await readBody(req);

        // ── Part B: prefetch accept (agent pre-posts the next DYNAMIC question) ──
        // Accepted regardless of whose turn it is — the entire point is to compose
        // during the user's think-time on the CURRENT question — so it is NOT
        // subject to the stale-seq / not-your-turn guards below. It never sets a
        // live question; it only fills the FIFO the `advance()` engine drains.
        if (body.queue === true && (body.action || 'ask') === 'ask') {
          if (STATE.done || TURN.phase === 'done') {
            return sendJSON(res, 200, { ok: false, error: 'walk is done', seq: TURN.seq });
          }
          const q = body.question || {};
          const node = (SURVEY_GRAPH.nodes || []).find((n) => n.id === q.nodeId);
          if (!node) return sendJSON(res, 200, { ok: false, error: `unknown node: ${q.nodeId}`, seq: TURN.seq });
          const skip = isNodeSkipped(node, facts());
          if (skip.skipped) return sendJSON(res, 200, { ok: false, error: `node ${node.id} is skipped server-side (${skip.reason})`, seq: TURN.seq });
          // Shape-validate the pre-post too: a queued question is served to the
          // browser verbatim later, so an unvalidated prefetch reintroduces the
          // exact blank-card failure one turn downstream.
          const qv = validateQuestionPayload(q);
          if (!qv.ok) {
            return sendJSON(res, 200, {
              ok: false, error: `question payload for node ${node.id}: ${qv.error}`,
              expected: qv.expected, example: qv.example, seq: TURN.seq,
            });
          }
          if (answeredIds().has(node.id)) return sendJSON(res, 200, { ok: false, error: `node ${node.id} already answered`, seq: TURN.seq });
          PREFETCH = PREFETCH.filter((x) => x.nodeId !== node.id); // last pre-post per node wins
          PREFETCH.push(questionFromNode(node, q));
          STATE.turnLog.push({ seq: TURN.seq, actor: 'agent', action: 'prefetch', nodeId: node.id, at: new Date().toISOString() });
          persist();
          return sendJSON(res, 200, { ok: true, action: 'prefetch', queued: true, queueLength: PREFETCH.length, seq: TURN.seq });
        }

        if (body.seq !== undefined && body.seq !== TURN.seq) {
          return sendJSON(res, 200, { ok: false, stale: true, seq: TURN.seq });
        }
        if (TURN.phase !== 'await_agent') {
          return sendJSON(res, 200, { ok: false, error: `not the agent's turn (phase=${TURN.phase})`, seq: TURN.seq });
        }
        // The agent may carry its latest scratch-emit coverage on any action.
        if (body.coverage && typeof body.coverage === 'object') {
          STATE.coverage = { ...STATE.coverage, ...body.coverage };
        }
        const action = body.action || 'ask';

        if (action === 'seed') {
          // Existing-app entry: the agent inspected the repo first and posts what
          // it OBSERVED. Each observed fact is recorded with OBSERVED provenance and
          // its feedsField is added to observedFields so its node skips server-side
          // (axis 1 — never ask what is OBSERVED). Sets startingPoint/platformTarget
          // so the skip evaluator keys correctly. Does not consume a user turn.
          const requestedSpecId = body.specId;
          if (requestedSpecId !== undefined && (
            typeof requestedSpecId !== 'string'
            || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(requestedSpecId)
          )) {
            return sendJSON(res, 200, { ok: false, error: 'specId must be a stable ID', seq: TURN.seq });
          }
          const fallbackSourceRefs = seedSourceRefs(body.sourcePaths);
          const candidates = [];
          for (const surface of Array.isArray(body.platformSurfaces) ? body.platformSurfaces : []) {
            candidates.push({
              id: `obs-platform-${surface?.id || 'surface'}`,
              target: { field: 'platformSurfaces', entityId: surface?.id },
              value: surface,
              ...(body.platformConfidence !== undefined ? { confidence: body.platformConfidence } : {}),
            });
          }
          candidates.push(...(Array.isArray(body.structuredObservations) ? body.structuredObservations : []));
          let normalized;
          try {
            normalized = candidates.map((raw) => normalizeStructuredObservation(
              { ...raw, sourceRefs: fallbackSourceRefs },
              { provenance: 'observed', fallbackSourceRefs },
            ));
          } catch (error) {
            return sendJSON(res, 200, { ok: false, error: String(error.message || error), seq: TURN.seq });
          }
          if (requestedSpecId !== undefined) STATE.specId = requestedSpecId;
          if (typeof body.startingPoint === 'string') STATE.startingPoint = body.startingPoint;
          if (typeof body.platformTarget === 'string') STATE.platformTarget = body.platformTarget;
          for (const o of body.observed || []) {
            if (!o || !o.feedsField) continue;
            recordAnswer({ nodeId: o.nodeId || o.feedsField, feedsField: o.feedsField, answerKind: o.answerKind || 'text', value: o.value, provenance: PROVENANCE.OBSERVED, steering: null });
            if (!STATE.observedFields.includes(o.feedsField)) STATE.observedFields.push(o.feedsField);
            if (o.feedsField === 'platformTarget' && typeof o.value === 'string') STATE.platformTarget = o.value;
          }
          for (const observation of normalized) upsertStructuredObservation(STATE, observation);
          TURN.seq += 1;
          STATE.turnLog.push({ seq: TURN.seq, actor: 'agent', action: 'seed', at: new Date().toISOString() });
          persist();
          return sendJSON(res, 200, {
            ok: true,
            action: 'seed',
            startingPoint: STATE.startingPoint,
            observedFields: STATE.observedFields,
            observationBatch: batchSummary(),
            seq: TURN.seq,
          });
        }

        if (action === 'record') {
          // A structured DECIDED fact must point back to one or more answers the
          // user actually supplied. The caller cannot self-assert DECIDED.
          const sourceNodeIds = Array.isArray(body.sourceAnswerNodeIds)
            ? [...new Set(body.sourceAnswerNodeIds)]
            : [];
          const decidedAnswers = new Map(
            STATE.answers
              .filter((answer) => answer?.provenance === PROVENANCE.DECIDED)
              .map((answer) => [answer.nodeId, answer]),
          );
          if (!sourceNodeIds.length || sourceNodeIds.some((nodeId) => !decidedAnswers.has(nodeId))) {
            return sendJSON(res, 200, {
              ok: false,
              error: 'record requires sourceAnswerNodeIds that refer to persisted DECIDED answers',
              seq: TURN.seq,
            });
          }
          const raws = Array.isArray(body.structuredObservations) ? body.structuredObservations : [];
          if (!raws.length) {
            return sendJSON(res, 200, { ok: false, error: 'record requires structuredObservations', seq: TURN.seq });
          }
          let normalized;
          try {
            const sourceRefs = sourceNodeIds.map((nodeId) => ({ kind: 'survey', nodeId }));
            normalized = raws.map((raw) => normalizeStructuredObservation(
              { ...raw, sourceRefs },
              { provenance: 'decided', fallbackSourceRefs: sourceRefs },
            ));
          } catch (error) {
            return sendJSON(res, 200, { ok: false, error: String(error.message || error), seq: TURN.seq });
          }
          for (const observation of normalized) upsertStructuredObservation(STATE, observation);
          TURN.seq += 1;
          STATE.turnLog.push({ seq: TURN.seq, actor: 'agent', action: 'record', at: new Date().toISOString() });
          persist();
          return sendJSON(res, 200, {
            ok: true,
            action: 'record',
            observationBatch: batchSummary(),
            seq: TURN.seq,
          });
        }

        if (action === 'done') {
          STATE.done = true; TURN.phase = 'done'; TURN.question = null; TURN.seq += 1;
          STATE.doneBy = 'agent';
          STATE.doneAt = STATE.doneAt || new Date().toISOString();
          STATE.turnLog.push({ seq: TURN.seq, actor: 'agent', action: 'done', at: new Date().toISOString() });
          persist();
          return sendJSON(res, 200, { ok: true, action: 'done', phase: 'done', seq: TURN.seq });
        }

        if (action === 'infer') {
          // Agent inferred a low-risk gap; record it ASSUMED without a user turn.
          const node = (SURVEY_GRAPH.nodes || []).find((n) => n.id === body.nodeId);
          if (!node) return sendJSON(res, 200, { ok: false, error: `unknown node: ${body.nodeId}`, seq: TURN.seq });
          const skip = isNodeSkipped(node, facts());
          if (skip.skipped) return sendJSON(res, 200, { ok: false, error: `node ${node.id} is skipped (${skip.reason})`, seq: TURN.seq });
          let normalizedObservation = null;
          if (body.observation !== undefined) {
            try {
              const sourceRefs = [{ kind: 'agent', id: 'requirements-host' }];
              normalizedObservation = normalizeStructuredObservation(
                { ...body.observation, sourceRefs },
                { provenance: 'assumed', fallbackSourceRefs: sourceRefs },
              );
            } catch (error) {
              return sendJSON(res, 200, { ok: false, error: String(error.message || error), seq: TURN.seq });
            }
          }
          recordAnswer({ nodeId: node.id, feedsField: body.feedsField || node.feedsField, answerKind: body.answerKind || node.answerKind, value: body.value, provenance: PROVENANCE.ASSUMED, steering: null });
          if (normalizedObservation) upsertStructuredObservation(STATE, normalizedObservation);
          maybeCaptureFacts(node, body.value);
          TURN.seq += 1; // infer MUTATES state → advance seq so a late replay is caught
          STATE.turnLog.push({ seq: TURN.seq, actor: 'agent', action: 'infer', nodeId: node.id, at: new Date().toISOString() });
          persist();
          return sendJSON(res, 200, {
            ok: true,
            action: 'infer',
            phase: 'await_agent',
            observationBatch: batchSummary(),
            seq: TURN.seq,
          });
        }

        // action === 'ask'
        const q = body.question || {};
        const node = (SURVEY_GRAPH.nodes || []).find((n) => n.id === q.nodeId);
        if (!node) return sendJSON(res, 200, { ok: false, error: `unknown node: ${q.nodeId}`, seq: TURN.seq });
        // SERVER-SIDE skip enforcement: a drifting agent cannot ask a skipped node.
        const skip = isNodeSkipped(node, facts());
        if (skip.skipped) {
          return sendJSON(res, 200, { ok: false, error: `node ${node.id} is skipped server-side (${skip.reason})`, seq: TURN.seq });
        }
        // Shape-validate the agent payload BEFORE it becomes the live question.
        // The rejection carries `expected` + `example` (straight from
        // QUESTION_PAYLOAD_SCHEMA) so a wrong guess is self-correcting from this
        // response alone — a bare "invalid" would only start a guess-reject loop.
        const qv = validateQuestionPayload(q);
        if (!qv.ok) {
          return sendJSON(res, 200, {
            ok: false, error: `question payload for node ${node.id}: ${qv.error}`,
            expected: qv.expected, example: qv.example, seq: TURN.seq,
          });
        }
        // serveQuestion advances seq + logs + persists (the turn log is durable per
        // turn, not only after the answer — f5a).
        serveQuestion(questionFromNode(node, q), 'agent', 'ask');
        return sendJSON(res, 200, { ok: true, action: 'ask', phase: 'await_user', seq: TURN.seq });
      }

      // ── POST /api/save-draft ───────────────────────────────────────────────
      if (req.method === 'POST' && p === '/api/save-draft') {
        const body = await readBody(req);
        if (TURN.phase !== 'await_user' || !TURN.question) {
          return sendJSON(res, 200, { ok: false, error: 'no live question', seq: TURN.seq });
        }
        if (body.seq !== undefined && body.seq !== TURN.seq) {
          return sendJSON(res, 200, { ok: false, stale: true, seq: TURN.seq });
        }
        const validated = validateDraft(TURN.question.answerKind, body.payload);
        if (!validated.ok) return sendJSON(res, 200, { ok: false, error: validated.error, seq: TURN.seq });
        const steering = typeof body.steering === 'string' ? body.steering.slice(0, 20000) : '';
        STATE.drafts = (STATE.drafts || []).filter((draft) => draft.nodeId !== TURN.question.nodeId);
        const savedAt = new Date().toISOString();
        STATE.drafts.push({
          nodeId: TURN.question.nodeId,
          answerKind: TURN.question.answerKind,
          payload: validated.value,
          steering,
          savedAt,
        });
        STATE.turnLog.push({ seq: TURN.seq, actor: 'user', action: 'save-draft', nodeId: TURN.question.nodeId, at: savedAt });
        persist();
        return sendJSON(res, 200, { ok: true, savedAt, seq: TURN.seq });
      }

      // ── POST /api/export-draft ─────────────────────────────────────────────
      if (req.method === 'POST' && p === '/api/export-draft') {
        const progress = buildSurveyProgress(SURVEY_GRAPH, STATE);
        const markdown = renderWorkingDraft({ state: STATE, graph: SURVEY_GRAPH, progress, currentQuestion: TURN.question });
        fs.mkdirSync(OUT, { recursive: true });
        const destination = path.join(OUT, WORKING_DRAFT_ARTIFACT);
        const tmp = path.join(OUT, `.${WORKING_DRAFT_ARTIFACT}.${process.pid}.${Date.now()}.tmp`);
        fs.writeFileSync(tmp, markdown);
        fs.renameSync(tmp, destination);
        STATE.turnLog.push({ seq: TURN.seq, actor: 'user', action: 'export-draft', at: new Date().toISOString() });
        persist();
        return sendJSON(res, 200, {
          ok: true,
          artifact: WORKING_DRAFT_ARTIFACT,
          path: destination,
          answers: STATE.answers.length,
          progress,
        });
      }

      // ── POST /api/generate-packet ─────────────────────────────────────────
      // User-confirmed local generation. This creates planning artifacts only;
      // it never changes the target application or claims implementation proof.
      if (req.method === 'POST' && p === '/api/generate-packet') {
        const progress = buildSurveyProgress(SURVEY_GRAPH, STATE);
        if (!STATE.done || progress.remaining !== 0) {
          return sendJSON(res, 200, { ok: false, error: 'Complete the requirements walk before building the planning packet.' });
        }
        const emitted = emitSurveyPacket({
          state: STATE,
          out: OUT,
          project: PROJECT,
          emitterPath: path.resolve(__dirname, '..', '..', 'engine', 'dist', 'cli.js'),
        });
        if (!emitted.ok) return sendJSON(res, 200, emitted);
        STATE.emitted = [...SURVEY_PACKET_ARTIFACTS];
        // The emitted traceability report is the first authoritative gap count.
        // Replace any optimistic survey-time placeholder with what the packet
        // actually contains so the completion bar cannot claim zero gaps.
        STATE.coverage.gaps = emitted.coverageGaps;
        STATE.doneBy = 'user-confirmed';
        STATE.doneAt = new Date().toISOString();
        STATE.turnLog.push({ seq: TURN.seq, actor: 'user', action: 'generate-packet', at: STATE.doneAt });
        persist();
        return sendJSON(res, 200, { ok: true, emitted: STATE.emitted, state: publicState() });
      }

      // ── POST /api/workflow/continue ──────────────────────────────────────
      // Keep the five-stage shell navigable without pretending the browser can
      // perform agent work. This durable request is returned by the existing
      // agent contract together with prior decisions, files, and measured gaps.
      if (req.method === 'POST' && p === '/api/workflow/continue') {
        const body = await readBody(req);
        const stage = WORKFLOW_STAGES.find((candidate) => candidate.id === body.stageId);
        if (!stage || !['interface', 'architecture', 'build'].includes(stage.id)) {
          return sendJSON(res, 200, { ok: false, error: 'stageId must be interface, architecture, or build' });
        }
        const completed = new Set((STATE.workflowHistory || []).filter((entry) => entry.status === 'complete').map((entry) => entry.stageId));
        const gaps = Array.isArray(STATE.coverage?.gaps) ? STATE.coverage.gaps.length : null;
        let blocker = null;
        if (!(STATE.emitted || []).length) blocker = 'Create the planning packet first.';
        else if (stage.id === 'architecture' && !completed.has('interface')) blocker = 'Finish the interface flows and states first.';
        else if (stage.id === 'build' && !completed.has('architecture')) blocker = 'Finish the architecture and failure paths first.';
        else if (stage.id === 'build' && gaps !== 0) blocker = gaps == null
          ? 'Measure the architecture and acceptance gaps first.'
          : `Resolve ${gaps} definition gap${gaps === 1 ? '' : 's'} first.`;
        if (blocker) return sendJSON(res, 200, { ok: false, error: blocker, state: publicState() });

        STATE.workflowRequest = {
          stageId: stage.id,
          title: stage.title,
          requestedAt: new Date().toISOString(),
        };
        STATE.turnLog.push({ seq: TURN.seq, actor: 'user', action: 'continue-workflow', stageId: stage.id, at: STATE.workflowRequest.requestedAt });
        persist();
        return sendJSON(res, 200, { ok: true, request: STATE.workflowRequest, state: publicState() });
      }

      // ── POST /api/workflow/report ────────────────────────────────────────
      // The attached host closes the exact requested stage. `blocked` remains a
      // visible outcome and does not silently advance the workflow.
      if (req.method === 'POST' && p === '/api/workflow/report') {
        const body = await readBody(req);
        if (!STATE.workflowRequest) return sendJSON(res, 200, { ok: false, error: 'no workflow stage is currently requested' });
        if (body.stageId !== STATE.workflowRequest.stageId) return sendJSON(res, 200, { ok: false, error: `expected stageId ${STATE.workflowRequest.stageId}` });
        if (!['complete', 'blocked'].includes(body.status)) return sendJSON(res, 200, { ok: false, error: 'status must be complete or blocked' });
        let emittedValue = [];
        if (body.emitted !== undefined) {
          const validated = validateEmitted(body.emitted);
          if (!validated.ok) return sendJSON(res, 200, { ok: false, error: validated.error });
          emittedValue = validated.value;
        }
        const report = {
          ...STATE.workflowRequest,
          status: body.status,
          summary: typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : null,
          emitted: emittedValue,
          reportedAt: new Date().toISOString(),
        };
        STATE.workflowHistory.push(report);
        STATE.workflowRequest = null;
        STATE.turnLog.push({ seq: TURN.seq, actor: 'agent', action: 'report-workflow', stageId: report.stageId, status: report.status, at: report.reportedAt });
        persist();
        return sendJSON(res, 200, { ok: true, report, state: publicState() });
      }

      // ── POST /api/answer ───────────────────────────────────────────────────
      // Browser submits the user's answer (DECIDED). Body:
      //   { seq, ...answerKind-specific payload, steering? }
      // Stale-seq guard rejects an answer against a superseded question.
      if (req.method === 'POST' && p === '/api/answer') {
        const body = await readBody(req);
        if (TURN.phase !== 'await_user' || !TURN.question) {
          return sendJSON(res, 200, { ok: false, error: 'no live question', seq: TURN.seq });
        }
        if (body.seq !== undefined && body.seq !== TURN.seq) {
          return sendJSON(res, 200, { ok: false, stale: true, seq: TURN.seq });
        }
        const q = TURN.question;
        const v = validateAnswer(q.answerKind, body);
        if (!v.ok) return sendJSON(res, 200, { ok: false, error: v.error, seq: TURN.seq });

        const steering = (typeof body.steering === 'string' && body.steering.trim()) ? body.steering.trim() : null;
        recordAnswer({ nodeId: q.nodeId, feedsField: q.feedsField, answerKind: q.answerKind, value: v.value, provenance: PROVENANCE.DECIDED, steering });
        STATE.drafts = (STATE.drafts || []).filter((draft) => draft.nodeId !== q.nodeId);
        maybeCaptureFacts(q, v.value);

        // Deliver-once mailboxes for the agent.
        PENDING_ANSWER = { nodeId: q.nodeId, feedsField: q.feedsField, answerKind: q.answerKind, value: v.value, provenance: PROVENANCE.DECIDED };
        if (steering) PENDING_STEERING = { text: steering, nodeId: q.nodeId };

        TURN.phase = 'await_agent';
        TURN.question = null;
        TURN.seq += 1;
        STATE.turnLog.push({ seq: TURN.seq, actor: 'user', action: 'answer', nodeId: q.nodeId, at: new Date().toISOString() });
        persist();
        // Part A/B: the server computes the next node and, if it is STATIC (or a
        // DYNAMIC one the agent pre-posted), serves it directly — no agent turn.
        // The browser's poll loop renders it instantly; only a fresh DYNAMIC node
        // or a complete walk leaves the turn in await_agent for the host agent.
        const adv = advance();
        return sendJSON(res, 200, {
          ok: true,
          phase: TURN.phase,
          seq: TURN.seq,
          autoAdvanced: adv.served,
          autoAdvanceSource: adv.source || null,
          nextNodeId: adv.nodeId || null,
        });
      }

      // ── POST /api/done ─────────────────────────────────────────────────────
      // Body: { coverage?, emitted?: string[] }
      // `emitted` is the artifact paths the agent actually wrote. It is the ONLY
      // thing that lets the browser claim a design packet exists: without it the
      // done screen stays in its working state showing the destination directory.
      // Reporting is therefore how a walk reaches a terminal state honestly.
      if (req.method === 'POST' && p === '/api/done') {
        const body = await readBody(req);
        // Validate BEFORE mutating anything: a rejected request must leave the
        // state exactly as it found it, or a bad `emitted` still silently rewrites
        // the coverage bar on its way to being refused.
        let emittedValue = null;
        if (body.emitted !== undefined) {
          const ev = validateEmitted(body.emitted);
          if (!ev.ok) return sendJSON(res, 200, { ok: false, error: ev.error, expected: EMITTED_SHAPE, example: EMITTED_EXAMPLE, seq: TURN.seq });
          emittedValue = ev.value;
        }
        if (body.coverage && typeof body.coverage === 'object') STATE.coverage = { ...STATE.coverage, ...body.coverage };
        if (emittedValue) {
          // Merge across repeated calls: an agent may report files as it writes
          // them. Order preserved, no duplicates.
          const seen = new Set(STATE.emitted);
          for (const f of emittedValue) if (!seen.has(f)) { seen.add(f); STATE.emitted.push(f); }
        }
        STATE.done = true;
        STATE.coverage.done = true;
        STATE.doneBy = 'agent';
        STATE.doneAt = STATE.doneAt || new Date().toISOString();
        TURN.phase = 'done';
        TURN.question = null;
        TURN.seq += 1;
        STATE.turnLog.push({ seq: TURN.seq, actor: 'agent', action: 'done', at: new Date().toISOString() }); // f5b
        persist();
        return sendJSON(res, 200, { ok: true, phase: 'done', seq: TURN.seq, emitted: STATE.emitted });
      }

      res.writeHead(404); res.end('not found');
    } catch (err) {
      sendJSON(res, 500, { error: String((err && err.message) || err) });
    }
  });

  // ── helpers that mutate STATE ────────────────────────────────────────────────
  function recordAnswer({ nodeId, feedsField, answerKind, value, provenance, steering }) {
    // Last write per node wins (a re-answer overwrites), so a resumed walk stays clean.
    STATE.answers = STATE.answers.filter((a) => a.nodeId !== nodeId);
    STATE.answers.push({ nodeId, feedsField, answerKind, value, provenance, steering: steering || null, at: new Date().toISOString() });
  }

  // Capture the two facts the skip evaluator keys on the moment they are answered,
  // so later nodes skip correctly server-side.
  function maybeCaptureFacts(q, value) {
    if (q.nodeId === 'platform' || q.feedsField === 'platformTarget') {
      const pt = Array.isArray(value) ? value[0] : value;
      if (typeof pt === 'string') STATE.platformTarget = pt;
    }
  }

  // Seamless resume: if we reloaded a mid-walk state whose NEXT node is STATIC,
  // serve it immediately so the resumed browser gets its question with no agent
  // round-trip. On a FRESH boot we never auto-serve — the leading graph nodes are
  // dynamic, and an existing-app entry must first `seed` in await_agent.
  if (resumed && !STATE.done) advance();

  // ── Fallback watchdog (anti-freeze safety net) ──────────────────────────────
  // `advance()` runs synchronously after each user answer, so once the agent is
  // known-absent every subsequent dynamic node serves its fallback on the answer
  // response. Two cases have NO triggering answer: (1) the FIRST node on a fresh
  // no-agent boot, and (2) a dynamic node left in await_agent because the agent
  // WAS attached but then stepped away mid-walk. This low-frequency timer covers
  // both: while the walk sits in await_agent, it re-checks staleness and, once the
  // grace window lapses with no agent poll, serves the fallback (or auto-finalizes
  // a completed walk). It never fires while a question is live (advance() no-ops
  // unless phase === await_agent). unref()'d so it never keeps the process alive.
  const watchdogTickMs = Math.max(50, Math.floor(AGENT_ATTACH_WINDOW_MS / 5));
  const fallbackWatchdog = setInterval(() => {
    try {
      if (STATE.done || TURN.phase !== 'await_agent') return;
      advance();
    } catch { /* the watchdog must never throw and wedge the survey */ }
  }, watchdogTickMs);
  if (fallbackWatchdog.unref) fallbackWatchdog.unref();
  server.on('close', () => clearInterval(fallbackWatchdog));

  // Expose a couple of internals for tests that import (not spawn) the module.
  server.__survey = { get state() { return STATE; }, get turn() { return TURN; }, get prefetch() { return PREFETCH; }, statePath: STATE_PATH, publicState, advance };
  return { server, OUT, PROJECT };
}

// ── Free-port fallback scan (finding-7: NEW work — designer-server binds once) ──
// Register the 'listening' and 'error' handlers ONCE (not via a per-attempt listen
// callback). A per-attempt callback is a `once('listening')` that never fires on a
// failed EADDRINUSE bind — it stays pending and then fires when a LATER attempt
// succeeds, reporting the wrong (original) port. Reporting server.address().port
// guarantees the ACTUAL bound port is surfaced no matter how far the scan walked.
function listenWithFallback(server, port, host, tries, cb) {
  let attempt = 0;
  const onError = (err) => {
    if (err && err.code === 'EADDRINUSE' && attempt < tries) {
      attempt += 1;
      setImmediate(() => server.listen(port + attempt, host));
    } else {
      throw err;
    }
  };
  server.on('error', onError);
  server.once('listening', () => {
    server.removeListener('error', onError);
    cb(server.address().port);
  });
  server.listen(port, host);
}

// ── main (guarded so tests can import the pure helpers side-effect-free) ────────
function main() {
  const opts = parseFlags(process.argv.slice(2));
  const { server, OUT, PROJECT } = makeServer(opts);
  listenWithFallback(server, opts.port, '127.0.0.1', 50, (boundPort) => {
    console.log(`Groundwork: Requirements survey running at http://localhost:${boundPort}`);
    console.log(`  project: ${PROJECT}`);
    console.log(`  out: ${OUT}`);
    if (opts.resume) console.log('  (resumed from survey-state.json)');
  });
}

export { makeServer, listenWithFallback };

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
