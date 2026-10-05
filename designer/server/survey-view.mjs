/* Pure view-model builders for the Requirements Studio browser.
 *
 * No DOM globals and no fetch at module scope: survey.js imports this in the
 * browser (served at /survey-view.js), and the node tests import it directly and
 * drive it with fixture state. Same contract as survey-alloc.mjs — the browser
 * logic that can actually be WRONG lives here, where it is testable, rather than
 * tangled into the DOM callbacks.
 *
 * renderDone takes `doc` (a document) by injection instead of reaching for a
 * global, so a test can paint it into a stub document and assert real output.
 */

const SUMMARY_MAX = 72;
const NAMES_MAX = 44;

export const WORKFLOW_STAGES = Object.freeze([
  { id: 'requirements', title: 'Define requirements', shortTitle: 'Requirements', description: 'Confirm the goals, users, constraints, and priorities that every later stage must preserve.', output: 'Captured decisions' },
  { id: 'direction', title: 'Confirm product direction', shortTitle: 'Product direction', description: 'Review the decisions together and create the local planning packet.', output: 'Planning packet' },
  { id: 'interface', title: 'Shape interface', shortTitle: 'Interface', description: 'Turn the confirmed product direction into navigation, flows, states, and low-fidelity mockups.', output: 'Flows and low-fi mockups' },
  { id: 'architecture', title: 'Define architecture', shortTitle: 'Architecture', description: 'Define data inputs and outputs, entities, components, contracts, failure paths, and security boundaries.', output: 'Architecture and traceability' },
  { id: 'build', title: 'Prepare the build', shortTitle: 'Build handoff', description: 'Resolve build-blocking gaps and produce tasks, acceptance tests, and the Build Loop handoff.', output: 'Build-ready handoff' },
]);

/**
 * Derive the five-stage workflow from persisted evidence. Navigation never
 * declares a later stage complete merely because its file name appeared in an
 * older output directory: only this survey's reported `emitted` list and its
 * measured traceability gaps are used.
 */
export function buildWorkflowModel(state = {}, graph = null) {
  const emitted = Array.isArray(state.emitted) ? state.emitted.filter(Boolean) : [];
  const hasPacket = emitted.length > 0;
  const gapCount = Array.isArray(state.coverage?.gaps) ? state.coverage.gaps.length : null;
  const requestedStageId = WORKFLOW_STAGES.some((stage) => stage.id === state.workflowRequest?.stageId)
    ? state.workflowRequest.stageId
    : null;
  const completedStageIds = new Set(
    (Array.isArray(state.workflowHistory) ? state.workflowHistory : [])
      .filter((entry) => entry?.status === 'complete')
      .map((entry) => entry.stageId),
  );
  const interfaceComplete = completedStageIds.has('interface');
  const architectureComplete = completedStageIds.has('architecture');
  const buildComplete = completedStageIds.has('build');
  const currentStageId = requestedStageId
    || (!hasPacket ? (state.done ? 'direction' : 'requirements')
      : !interfaceComplete ? 'interface'
        : !architectureComplete ? 'architecture'
          : 'build');
  const readback = buildReadback(state.answers, graph);

  const stages = WORKFLOW_STAGES.map((stage, index) => {
    let status = 'upcoming';
    let available = false;
    let actionLabel = null;
    let reason = null;
    if (stage.id === 'requirements') {
      status = state.done ? 'complete' : 'current';
      available = true;
      actionLabel = state.done ? 'Review captured requirements' : 'Continue requirements';
    } else if (stage.id === 'direction') {
      status = hasPacket ? 'complete' : state.done ? 'current' : 'upcoming';
      available = !!state.done;
      actionLabel = hasPacket ? 'Review planning packet' : 'Confirm and build planning packet';
      if (!state.done) reason = 'Complete the requirements decisions first.';
    } else if (stage.id === 'interface') {
      status = interfaceComplete ? 'complete' : currentStageId === stage.id ? 'current' : hasPacket ? 'ready' : 'upcoming';
      available = hasPacket;
      actionLabel = interfaceComplete ? 'Review interface decisions' : 'Continue shaping the interface';
      if (!hasPacket) reason = 'Create the planning packet first.';
    } else if (stage.id === 'architecture') {
      status = architectureComplete ? 'complete' : currentStageId === stage.id ? 'current' : interfaceComplete ? 'ready' : 'upcoming';
      available = interfaceComplete;
      actionLabel = architectureComplete ? 'Review architecture decisions' : 'Continue defining architecture';
      if (!hasPacket) reason = 'Create the planning packet first.';
      else if (!interfaceComplete) reason = 'Finish the interface flows and states first.';
    } else {
      const noKnownGaps = architectureComplete && gapCount === 0;
      status = buildComplete ? 'complete' : currentStageId === stage.id ? 'current' : noKnownGaps ? 'ready' : 'blocked';
      available = noKnownGaps;
      actionLabel = buildComplete ? 'Review build handoff' : 'Continue to the build handoff';
      reason = !hasPacket
        ? 'Create the planning packet first.'
        : !architectureComplete
          ? 'Finish the architecture and failure paths first.'
        : gapCount == null
          ? 'Measure the architecture and acceptance gaps first.'
          : gapCount > 0
            ? `Resolve ${gapCount} definition gap${gapCount === 1 ? '' : 's'} first.`
            : null;
    }
    return { ...stage, index: index + 1, status, available, actionLabel, reason };
  });

  return {
    currentStageId,
    requestedStageId,
    completedStageIds: [...completedStageIds],
    hasPacket,
    gapCount,
    readback,
    stages,
  };
}

/** Collapse whitespace and clip to n chars with an ellipsis. */
export function truncate(s, n = SUMMARY_MAX) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/** Human label for a node: the graph's authored `readbackLabel`, else a
 *  title-cased id ("top-jobs" → "Top jobs"). The graph owns the copy — every
 *  other user-facing string in this survey is authored there too. */
export function labelForNode(nodeId, graph = null) {
  const node = graph && Array.isArray(graph.nodes)
    ? graph.nodes.find((n) => n.id === nodeId)
    : null;
  if (node && typeof node.readbackLabel === 'string' && node.readbackLabel.trim()) {
    return node.readbackLabel.trim();
  }
  const id = String(nodeId ?? '').trim();
  if (!id) return 'Answer';
  const words = id.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Compact human summary of ONE recorded answer, by answerKind. Returns null when
 * the answer carries nothing worth reading back (so the caller can skip the row
 * rather than render an empty one).
 *
 * This is a READBACK of state the survey already holds — it never invents data.
 */
export function summarizeAnswer(a) {
  if (!a || a.value == null) return null;
  const v = a.value;

  if (a.answerKind === 'allocation') {
    const weights = (v && typeof v === 'object' && v.weights) || null;
    if (!weights) return null;
    const ranked = Object.entries(weights)
      .filter(([, n]) => Number.isFinite(n))
      .sort((x, y) => y[1] - x[1]);
    if (!ranked.length) return null;
    const [topAxis, topWeight] = ranked[0];
    const never = v.unacceptable_tradeoff;
    if (never && never === topAxis) return `${topAxis} ${topWeight} (never sacrifice)`;
    if (never) return `${topAxis} ${topWeight} · never sacrifice: ${never}`;
    return `${topAxis} ${topWeight}`;
  }

  if (a.answerKind === 'cards') {
    const cards = Array.isArray(v) ? v.filter((c) => c && typeof c === 'object') : [];
    if (!cards.length) return null;
    // `kill` is an explicit cut; anything else counts as kept (the browser only
    // ever sends keep|kill, and a seeded card with no decision is a keep).
    const kept = cards.filter((c) => c.decision !== 'kill');
    if (!kept.length) return `0 kept of ${cards.length}`;
    const tally = {};
    for (const c of kept) if (typeof c.priority === 'string' && c.priority) tally[c.priority] = (tally[c.priority] || 0) + 1;
    const priorities = Object.keys(tally).sort().map((p) => `${tally[p]}× ${p}`);
    const cut = cards.length - kept.length;
    const detail = priorities.length
      ? priorities.join(', ')
      : truncate(kept.map((c) => c.label).filter(Boolean).join(', '), NAMES_MAX);
    let s = detail ? `${kept.length} (${detail})` : String(kept.length);
    if (cut > 0) s += ` · ${cut} cut`;
    return s;
  }

  if (a.answerKind === 'chips') {
    const chosen = Array.isArray(v) ? v.filter((c) => typeof c === 'string' && c.trim()) : [];
    return chosen.length ? truncate(chosen.join(', ')) : null;
  }

  // text (and anything else recorded as a plain value)
  if (typeof v === 'string') return truncate(v) || null;
  if (Array.isArray(v)) return truncate(v.join(', ')) || null;
  return truncate(JSON.stringify(v)) || null;
}

/**
 * The answered-node readback: what the user actually told us, in walk order.
 * Non-DECIDED provenance is carried through so the done screen can mark what was
 * ASSUMED by the agent or OBSERVED from the repo rather than decided by the user
 * — the user should be able to see what was inferred on their behalf.
 */
export function buildReadback(answers = [], graph = null) {
  const rows = [];
  for (const a of Array.isArray(answers) ? answers : []) {
    const summary = summarizeAnswer(a);
    if (!summary) continue;
    rows.push({
      nodeId: a.nodeId,
      label: labelForNode(a.nodeId, graph),
      summary,
      provenance: typeof a.provenance === 'string' ? a.provenance : null,
    });
  }
  return rows;
}

/**
 * Render a coverage counter. `null`/absent means the number is UNKNOWN — not
 * measured and not derivable from the answers — and shows as an em dash.
 *
 * The bug this closes: the bar rendered `?? 0`, so "never measured" and
 * "measured zero" looked identical. A fully-answered survey read "0 needs · 0
 * features · 0 screens · 0 non-goals". "—" says "we don't know yet", which is
 * both true and useful; a 0 is a confident falsehood.
 */
export function formatCount(v) {
  if (Array.isArray(v)) return String(v.length);
  return Number.isFinite(v) ? String(v) : '—';
}

/** "45s" / "2m 05s" — an elapsed counter, not a countdown: we cannot honestly
 *  predict how long the agent will take, so we report time spent, not remaining. */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

/**
 * The done-screen view model. Three states, each claiming only what the server
 * has evidence for:
 *
 *   complete  — the agent REPORTED artifacts via POST /api/done { emitted }.
 *               Only this may say a packet was written.
 *   working   — the walk is over and no files are reported yet. Says only that we
 *               are WAITING — it must not assert the agent is assembling anything,
 *               because we cannot know that, and an agent that finalized and then
 *               vanished would otherwise leave a permanent false claim.
 *               (`agentAttached` looks like the missing signal but is not: once the
 *               walk is done /api/agent/contract short-circuits to {done:true}, so
 *               an agent that is legitimately assembling stops polling and goes
 *               stale within the window. Keying the copy off it would announce "no
 *               design packet" during a healthy slow assembly — the inverse error.)
 *   no-packet — the SERVER finalized the walk (`doneBy: 'server'`) because no
 *               agent was ever attached. Nothing is assembling. Saying "the host
 *               agent is assembling your design packet" here would be a fake
 *               in-progress claim — the mirror of the fake completion this
 *               screen replaced, and the server already knows it is false.
 */
export function buildDoneModel(state = {}) {
  const emitted = Array.isArray(state.emitted)
    ? state.emitted.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim())
    : [];
  const outDir = typeof state.out === 'string' && state.out.trim() ? state.out.trim() : null;
  const gapCount = Array.isArray(state.coverage?.gaps) ? state.coverage.gaps.length : null;
  const status = emitted.length ? 'complete' : ((state.done || state.doneBy) ? 'no-packet' : 'working');
  const HEADLINE = {
    complete: `Planning draft created — ${emitted.length} file${emitted.length === 1 ? '' : 's'}`,
    working: 'Requirements captured',
    'no-packet': 'Review and confirm your requirements',
  };
  const NOTE = {
    complete: gapCount == null
      ? 'The planning draft exists, but its traceability gap count is unavailable. Review the traceability report before treating the architecture or acceptance plan as complete.'
      : gapCount > 0
      ? `Groundwork found ${gapCount} open definition gap${gapCount === 1 ? '' : 's'} in the generated traceability report. Next: shape the interface and mockups, then resolve the architecture and acceptance gaps before building.`
      : 'Your requirements are confirmed and the local Groundwork draft is ready. Next: shape the interface and mockups, then refine the architecture before building.',
    working: 'Waiting for the host agent to report the design packet. This screen updates itself when the files land.',
    'no-packet': 'All decisions are captured. Review them below, then confirm to create the requirements, design, architecture trace, tasks, and Build Loop handoff locally.',
  };
  return {
    status,
    outDir,
    emitted,
    gapCount,
    readback: buildReadback(state.answers, state.graph || null),
    headline: HEADLINE[status],
    note: NOTE[status],
  };
}

// ── rendering ─────────────────────────────────────────────────────────────────
// `doc` is injected so this runs against a stub document under test.

const mk = (doc, tag, cls, text) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Paint the done screen into `host` from a model. Returns handles the caller can
 * update without a full re-render (the elapsed counter ticks once a second).
 *
 * Reduced motion: the spinner's `animation: none` fallback already lives in
 * survey.css under prefers-reduced-motion, and the elapsed counter is text — it
 * conveys progress without motion, so the working state stays legible either way.
 */
export function renderDone(doc, host, model, actions = {}) {
  host.innerHTML = '';
  // Only a genuinely in-flight assembly spins and ticks. `no-packet` is a settled
  // state — nothing is working, so a spinner there would animate a false claim.
  const working = model.status === 'working';
  const complete = model.status === 'complete';

  const head = mk(doc, 'div', 'done-head');
  if (working) head.appendChild(mk(doc, 'span', 'spinner'));
  head.appendChild(mk(doc, 'h1', 'q-prompt', complete ? `✅ ${model.headline}` : model.headline));
  host.appendChild(head);
  host.appendChild(mk(doc, 'p', 'q-note', model.note));

  if (model.status === 'no-packet') {
    const actionRow = mk(doc, 'div', 'done-actions');
    const generate = mk(doc, 'button', 'btn-primary done-generate', 'Confirm and build planning packet');
    generate.type = 'button';
    const actionStatus = mk(doc, 'p', 'done-action-status');
    actionStatus.setAttribute('role', 'status');
    actionStatus.setAttribute('aria-live', 'polite');
    generate.addEventListener('click', async () => {
      generate.disabled = true;
      generate.textContent = 'Building planning packet…';
      actionStatus.textContent = '';
      try {
        const result = actions.onGenerate ? await actions.onGenerate() : { ok: false, error: 'Generation is unavailable.' };
        if (!result?.ok) {
          actionStatus.textContent = result?.error || 'Could not build the planning packet.';
          generate.disabled = false;
          generate.textContent = 'Try building the planning packet again';
        }
      } catch {
        actionStatus.textContent = 'Could not build the planning packet. Your confirmed answers are still saved.';
        generate.disabled = false;
        generate.textContent = 'Try building the planning packet again';
      }
    });
    actionRow.appendChild(generate);
    actionRow.appendChild(actionStatus);
    host.appendChild(actionRow);
  }

  // Working status: an elapsed counter, live-announced.
  let elapsedNode = null;
  if (working) {
    const status = mk(doc, 'p', 'done-working');
    status.setAttribute('aria-live', 'polite');
    status.appendChild(mk(doc, 'span', null, 'Working — '));
    elapsedNode = mk(doc, 'span', 'done-elapsed', formatElapsed(model.elapsedMs || 0));
    status.appendChild(elapsedNode);
    status.appendChild(mk(doc, 'span', null, ' elapsed'));
    host.appendChild(status);
  }

  // Readback: what we captured.
  if (model.readback.length) {
    const sec = mk(doc, 'section', 'readback');
    sec.appendChild(mk(doc, 'h2', 'readback-title', 'What we captured'));
    const list = mk(doc, 'dl', 'readback-list');
    for (const row of model.readback) {
      const dt = mk(doc, 'dt', 'readback-key', row.label);
      if (row.provenance && row.provenance !== 'DECIDED') {
        // Mark what the user did NOT decide themselves, so an inference is never
        // silently presented back as their own answer.
        dt.appendChild(mk(doc, 'span', 'readback-prov', row.provenance.toLowerCase()));
      }
      list.appendChild(dt);
      list.appendChild(mk(doc, 'dd', 'readback-val', row.summary));
    }
    sec.appendChild(list);
    host.appendChild(sec);
  }

  // Output location: the real --out the server was launched with.
  if (model.outDir) {
    const sec = mk(doc, 'section', 'outdir');
    // Only `complete` may say "Written to" — the other two states have no
    // evidence anything was written there.
    sec.appendChild(mk(doc, 'h2', 'outdir-title', complete ? 'Created in' : working ? 'Writing to' : 'Will be created in'));
    const row = mk(doc, 'div', 'outdir-row');
    const code = mk(doc, 'code', 'outdir-path', model.outDir);
    row.appendChild(code);
    const copy = mk(doc, 'button', 'outdir-copy', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await doc.defaultView.navigator.clipboard.writeText(model.outDir);
        copy.textContent = 'Copied';
      } catch {
        // Clipboard blocked: the path is selectable text, so say so rather than
        // failing silently or claiming a copy that did not happen.
        copy.textContent = 'Select to copy';
      }
    });
    row.appendChild(copy);
    sec.appendChild(row);

    if (model.emitted.length) {
      const files = mk(doc, 'ul', 'outdir-files');
      for (const f of model.emitted) files.appendChild(mk(doc, 'li', 'outdir-file', f));
      sec.appendChild(files);
    }
    host.appendChild(sec);
  }

  return { elapsedNode };
}
