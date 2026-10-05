/* Requirements Studio client. Vanilla JS ES module, no dependencies.
 *
 * The host agent drives the walk (it polls /api/agent/contract and posts the next
 * question). This browser is the presentation surface: it polls /api/state, and
 * when a question is live it renders one of four answerKind renderers, then POSTs
 * the answer + optional steering. answerKinds and the tradeoff axes are read from
 * the server's frozen wire contract via /api/init — never hardcoded here. */

import { weightsFromRanking, neverSacrificeDefault } from '/survey-alloc.js';
import { buildDoneModel, buildWorkflowModel, renderDone, formatElapsed, formatCount } from '/survey-view.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let WIRE = null;      // wire contract from /api/init
let GRAPH = null;     // question graph from /api/init (readback labels live here)
let renderedSeq = -1; // the seq of the question currently rendered (avoid re-render churn)
let collect = null;   // () => ({ ok, error?, payload }) for the live renderer
let snapshot = null;  // () => partial renderer state; valid even before an answer is complete
let shownPhase = null;
let lastCoverageKey = '';
let lastProgressKey = '';
let lastJourneyKey = '';
let latestState = null;
let workflowModel = null;
let selectedStageId = null;

// Done-screen state. `doneStatus` guards against re-rendering the whole screen on
// every 800ms poll (which would clobber focus and restart the copy button);
// `doneSince`/`doneTimer` drive the elapsed counter while the agent is emitting.
let doneStatus = null;
let doneSince = null;
let doneTimer = null;
let doneElapsedNode = null;

async function boot() {
  const init = await (await fetch('/api/init')).json();
  WIRE = init.wireContract;
  GRAPH = init.graph;
  $('ctx').textContent = init.project + (init.resumed ? ' · resumed' : '');
  selectedStageId = stageFromHash();
  applyState(init.state);
  poll();
}

async function poll() {
  try {
    const s = await (await fetch('/api/state')).json();
    applyState(s);
  } catch { /* transient; keep polling */ }
  setTimeout(poll, 800);
}

function applyState(s) {
  latestState = s;
  const hasPacket = Array.isArray(s.emitted) && s.emitted.length > 0;
  // Before generation, a posted [] only means the decision walk found no open
  // questions. It does not prove the emitted architecture/acceptance trace has
  // zero gaps. Show unknown until traceability.json supplies the real count.
  updateCoverage(s.done && !hasPacket ? { ...s.coverage, gaps: null } : s.coverage);
  updateWalkProgress(s.walkProgress);
  updateJourney(s);
  const stageId = selectedStageId || workflowModel.currentStageId;
  updateBreadcrumbs(stageId, s.project);
  if (stageId !== 'requirements' && !(stageId === 'direction' && !hasPacket)) {
    renderWorkflowStage(stageId, s);
    show('workflow-stage');
    return;
  }
  if (s.done || s.phase === 'done') { applyDone(s); show('done'); return; }
  if (s.phase === 'await_user' && s.question) {
    if (s.seq !== renderedSeq) { renderQuestion(s.question, s.seq, s.draft); renderedSeq = s.seq; }
    show('question');
    return;
  }
  // await_agent — a next question is on the way (agent enriching, or the server is
  // about to serve the static fallback). Never a blank/frozen screen.
  renderedSeq = -1;
  $('waiting-title').textContent = 'Preparing your next question…';
  $('waiting-note').textContent = s.agentAttached
    ? 'The host agent is composing this step from your answers.'
    : 'Setting up the next step — this continues on its own, no need to wait.';
  show('waiting');
}

function show(which) {
  const label = which === 'question' ? 'Your turn'
    : which === 'done' ? (doneStatus === 'complete' ? 'Complete' : doneStatus === 'no-packet' ? 'Ready to confirm' : 'Finishing')
      : which === 'workflow-stage' ? (workflowModel?.stages.find((stage) => stage.id === (selectedStageId || workflowModel.currentStageId))?.shortTitle || 'Planning')
      : 'Waiting';
  if (which === shownPhase && $('phase-label').textContent === label) return;
  for (const id of ['waiting', 'question', 'done', 'workflow-stage']) {
    const shouldHide = id !== which;
    if ($(id).hidden !== shouldHide) $(id).hidden = shouldHide;
  }
  if ($('phase-label').textContent !== label) $('phase-label').textContent = label;
  shownPhase = which;
}

// ── done screen ───────────────────────────────────────────────────────────────
// Two terminal states, and the difference is honest rather than cosmetic:
//   working  — the walk is over but the agent has reported no emitted files, so we
//              show the destination + an elapsed counter and claim nothing.
//   complete — the agent reported artifacts via POST /api/done { emitted }, so we
//              can say the packet was written and list the files.
// Re-render only on a status CHANGE; the elapsed counter ticks on its own so the
// 800ms poll never rebuilds the DOM under the user.
function applyDone(s) {
  const model = buildDoneModel({ done: s.done, answers: s.answers, out: s.out, emitted: s.emitted, doneBy: s.doneBy, coverage: s.coverage, graph: GRAPH });
  if (doneSince == null) doneSince = Date.now();
  if (model.status === doneStatus) return;

  doneStatus = model.status;
  model.elapsedMs = Date.now() - doneSince;
  const handles = renderDone(document, $('done'), model, { onGenerate: generatePacket });
  doneElapsedNode = handles.elapsedNode;

  if (doneTimer) { clearInterval(doneTimer); doneTimer = null; }
  if (model.status === 'working' && doneElapsedNode) {
    // A counter, not a countdown: we cannot honestly predict the agent's finish
    // time, so we report time spent. Text-only, so it reads the same under
    // prefers-reduced-motion (where survey.css stops the spinner animating).
    doneTimer = setInterval(() => {
      if (doneElapsedNode) doneElapsedNode.textContent = formatElapsed(Date.now() - doneSince);
    }, 1000);
  }
}

async function generatePacket() {
  const result = await (await fetch('/api/generate-packet', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })).json();
  if (result.ok && result.state) {
    doneStatus = null;
    applyState(result.state);
  }
  return result;
}

function updateJourney(s) {
  workflowModel = buildWorkflowModel(s, GRAPH);
  const key = JSON.stringify({
    current: workflowModel.currentStageId,
    selected: selectedStageId,
    stages: workflowModel.stages.map((stage) => [stage.id, stage.status, stage.available]),
  });
  if (key === lastJourneyKey) return;
  lastJourneyKey = key;
  const rows = [...document.querySelectorAll('[data-journey-step]')];
  rows.forEach((row) => {
    const button = row.querySelector('[data-stage-id]');
    const stage = workflowModel.stages.find((candidate) => candidate.id === button?.dataset.stageId);
    if (!stage) return;
    row.classList.toggle('complete', stage.status === 'complete');
    row.classList.toggle('current', stage.id === workflowModel.currentStageId);
    row.classList.toggle('selected', stage.id === (selectedStageId || workflowModel.currentStageId));
    row.classList.toggle('blocked', stage.status === 'blocked');
    button.setAttribute('aria-current', stage.id === (selectedStageId || workflowModel.currentStageId) ? 'step' : 'false');
    const status = row.querySelector('.journey-status');
    status.textContent = stage.status;
  });
}

function stageFromHash() {
  const match = window.location.hash.match(/^#\/stage\/([a-z-]+)$/);
  return match ? match[1] : null;
}

function navigateToStage(stageId) {
  if (!workflowModel?.stages.some((stage) => stage.id === stageId)) return;
  window.location.hash = `/stage/${stageId}`;
}

function updateBreadcrumbs(stageId, project) {
  const host = $('breadcrumbs');
  host.innerHTML = '';
  const home = el('button', 'breadcrumb-link', 'Groundwork');
  home.type = 'button';
  home.addEventListener('click', () => navigateToStage(workflowModel.currentStageId));
  const projectLink = el('button', 'breadcrumb-link', project || 'Project');
  projectLink.type = 'button';
  projectLink.addEventListener('click', () => navigateToStage(workflowModel.currentStageId));
  const stage = workflowModel?.stages.find((candidate) => candidate.id === stageId);
  host.appendChild(home);
  host.appendChild(el('span', 'breadcrumb-separator', '/'));
  host.appendChild(projectLink);
  host.appendChild(el('span', 'breadcrumb-separator', '/'));
  const current = el('span', 'breadcrumb-current', stage?.shortTitle || 'Requirements');
  current.setAttribute('aria-current', 'page');
  host.appendChild(current);
}

function addStageSection(host, title, items, valueKey = null) {
  if (!items.length) return;
  const section = el('section', 'workflow-section');
  section.appendChild(el('h2', 'workflow-section-title', title));
  const list = el('ul', 'workflow-list');
  for (const item of items) {
    const row = el('li', 'workflow-list-item');
    if (valueKey) {
      row.appendChild(el('strong', null, item.label));
      row.appendChild(el('span', null, item[valueKey]));
    } else row.textContent = item;
    list.appendChild(row);
  }
  section.appendChild(list);
  host.appendChild(section);
}

function renderWorkflowStage(stageId, state) {
  const stage = workflowModel.stages.find((candidate) => candidate.id === stageId);
  const host = $('workflow-stage');
  host.innerHTML = '';
  if (!stage) return;

  host.appendChild(el('p', 'workflow-eyebrow', `Stage ${stage.index} of ${workflowModel.stages.length} · ${stage.status}`));
  host.appendChild(el('h1', 'q-prompt', stage.title));
  host.appendChild(el('p', 'q-note', stage.description));

  const contextByStage = {
    direction: ['jtbd', 'persona-pain', 'top-jobs', 'critical-screens', 'feature-priority', 'tradeoff-allocation'],
    interface: ['jtbd', 'persona-pain', 'top-jobs', 'critical-screens', 'information-density', 'brand-adjectives', 'voice', 'accessibility-floor', 'workspace-layout-preference', 'progress-feedback-preference', 'responsive-range'],
    architecture: ['platform', 'jtbd', 'top-jobs', 'critical-screens', 'feature-priority', 'tradeoff-allocation', 'accessibility-floor'],
    build: ['jtbd', 'critical-screens', 'feature-priority', 'tradeoff-allocation', 'accessibility-floor', 'progress-feedback-preference'],
  };
  const preferredNodeIds = contextByStage[stage.id] || [];
  const contextRows = workflowModel.readback.filter((row) => preferredNodeIds.includes(row.nodeId));
  addStageSection(host, 'Carried forward from earlier decisions', contextRows, 'summary');
  addStageSection(host, 'This stage produces', [stage.output]);

  if (stage.id === 'direction' && workflowModel.hasPacket) {
    addStageSection(host, 'Planning packet', Array.isArray(state.emitted) ? state.emitted : []);
  }
  if (stage.id === 'architecture' && workflowModel.gapCount != null) {
    addStageSection(host, 'Current architecture signal', [`${workflowModel.gapCount} open definition gap${workflowModel.gapCount === 1 ? '' : 's'}`]);
  }

  const actions = el('div', 'workflow-actions');
  const status = el('p', 'workflow-action-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const alreadyRequested = state.workflowRequest?.stageId === stage.id;
  const alreadyComplete = stage.status === 'complete';
  if (!alreadyComplete && ['interface', 'architecture', 'build'].includes(stage.id)) {
    const button = el('button', 'btn-primary', alreadyRequested ? 'Stage requested' : stage.actionLabel);
    button.type = 'button';
    button.disabled = !stage.available || alreadyRequested;
    if (stage.reason) status.textContent = stage.reason;
    if (alreadyRequested) status.textContent = 'Request saved with your prior decisions. Groundwork will continue here when the host agent responds.';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Saving stage request…';
      status.textContent = '';
      try {
        const result = await (await fetch('/api/workflow/continue', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stageId: stage.id }),
        })).json();
        if (!result.ok) {
          button.disabled = false;
          button.textContent = stage.actionLabel;
          status.textContent = result.error || 'Could not continue this stage.';
          return;
        }
        applyState(result.state);
      } catch {
        button.disabled = false;
        button.textContent = stage.actionLabel;
        status.textContent = 'Network error — the stage request was not saved.';
      }
    });
    actions.appendChild(button);
  }
  actions.appendChild(status);
  host.appendChild(actions);
}

// The counters render "—" until a number is actually known: either the agent
// posted measured coverage, or the answers themselves establish it (the server
// derives features/screens from the recorded cards). `?? 0` was the bug — it made
// "never measured" indistinguishable from "measured zero", so a fully-answered
// survey confidently reported 0 needs · 0 features · 0 screens · 0 non-goals.
function updateCoverage(c) {
  if (!c) return;
  const key = JSON.stringify(c);
  if (key === lastCoverageKey) return;
  lastCoverageKey = key;
  $('cov-needs').textContent = formatCount(c.needs);
  $('cov-features').textContent = formatCount(c.features);
  $('cov-screens').textContent = formatCount(c.screens);
  $('cov-nongoals').textContent = formatCount(c.nonGoals);
  const gaps = Array.isArray(c.gaps) ? c.gaps.length : c.gaps;
  $('cov-gaps').textContent = formatCount(gaps);
  // Only de-emphasise gaps when we actually know there are none; an unknown gap
  // count is not a clean bill of health.
  document.querySelector('.cov-gaps')?.classList.toggle('zero', gaps === 0);
}

function updateWalkProgress(progress) {
  if (!progress) return;
  const key = JSON.stringify(progress);
  if (key === lastProgressKey) return;
  lastProgressKey = key;
  $('walk-progress').hidden = false;
  $('walk-progress-title').textContent = `${progress.answered} of ${progress.total} decisions captured`;
  const optional = progress.optionalRemaining ? `, including ${progress.optionalRemaining} optional preference ${progress.optionalRemaining === 1 ? 'check' : 'checks'}` : '';
  $('walk-progress-note').textContent = progress.remaining
    ? `Up to ${progress.remaining} ${progress.remaining === 1 ? 'question' : 'questions'} remain${optional}. Groundwork may finish earlier when more answers would not change the plan.`
    : 'The decision walk is complete.';
  $('walk-progress-bar').style.width = `${progress.percent}%`;
  $('walk-progress-meter').setAttribute('aria-valuenow', String(progress.percent));
}

// ── question rendering ────────────────────────────────────────────────────────
function renderQuestion(q, seq, draft = null) {
  const graphNode = (GRAPH?.nodes || []).find((node) => node.id === q.nodeId);
  $('q-feeds').textContent = graphNode?.readbackLabel
    ? `Decision · ${graphNode.readbackLabel}`
    : 'Decision';
  $('q-prompt').textContent = q.prompt || '';
  const help = $('q-help');
  help.textContent = q.help || '';
  help.hidden = !q.help;
  $('err').textContent = '';
  $('steer').value = '';
  const host = $('answer');
  host.innerHTML = '';
  collect = null;
  snapshot = null;

  let renderer;
  if (q.answerKind === 'chips') renderer = renderChips(host, q, draft);
  else if (q.answerKind === 'cards') renderer = renderCards(host, q, draft);
  else if (q.answerKind === 'allocation') renderer = renderAllocation(host, q, draft);
  else renderer = renderText(host, q, draft);
  collect = renderer.collect;
  snapshot = renderer.snapshot;

  $('answer-form').dataset.seq = String(seq);
  $('answer-form').dataset.nodeId = q.nodeId;
  $('save-status').textContent = draft?.savedAt ? `Saved ${formatSavedTime(draft.savedAt)}` : '';
}

function renderText(host, q, draft) {
  const examples = Array.isArray(q.examples) ? q.examples : [];
  if (examples.length) {
    const intro = el('div', 'example-intro');
    intro.appendChild(el('p', 'example-eyebrow', 'Starting points'));
    intro.appendChild(el('p', 'example-note', 'Choose one to edit, or combine the useful parts in your own answer.'));
    host.appendChild(intro);

    const grid = el('div', 'examples');
    host.appendChild(grid);
    for (const example of examples) {
      const button = el('button', 'example-card');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.appendChild(el('span', 'example-label', example.label));
      button.appendChild(el('span', 'example-text', example.text));
      grid.appendChild(button);
    }
  }

  const label = el('label', 'answer-label', examples.length ? 'Your answer' : 'Describe the outcome');
  label.htmlFor = 'text-answer';
  host.appendChild(label);
  const ta = el('textarea', 'text-input');
  ta.id = 'text-answer';
  ta.rows = 4;
  ta.placeholder = examples.length
    ? 'Select a starting point above, or write a different outcome…'
    : 'Write the concrete result someone achieves…';
  host.appendChild(ta);
  ta.value = typeof draft?.payload?.text === 'string' ? draft.payload.text : '';
  if (typeof draft?.steering === 'string') $('steer').value = draft.steering;

  const buttons = [...host.querySelectorAll('.example-card')];
  buttons.forEach((button, index) => button.addEventListener('click', () => {
    buttons.forEach((candidate) => candidate.setAttribute('aria-pressed', 'false'));
    button.setAttribute('aria-pressed', 'true');
    ta.value = examples[index].text;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }));

  if (!examples.length) setTimeout(() => ta.focus(), 0);
  const collectText = () => {
    const text = ta.value.trim();
    if (!text) return { ok: false, error: 'Enter an answer.' };
    return { ok: true, payload: { text } };
  };
  return { collect: collectText, snapshot: () => ({ text: ta.value }) };
}

function renderChips(host, q, draft) {
  const chosen = new Set(Array.isArray(draft?.payload?.chosen) ? draft.payload.chosen : []);
  const wrap = el('div', 'chips');
  for (const label of (q.chips || [])) {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', chosen.has(label) ? 'true' : 'false');
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', on ? 'false' : 'true');
      if (on) chosen.delete(label); else chosen.add(label);
    });
    wrap.appendChild(b);
  }
  host.appendChild(wrap);
  // Free text is always available alongside chips.
  const lbl = el('label', 'free-label', 'Or add your own (comma-separated):');
  lbl.htmlFor = 'chip-free';
  const free = el('input', 'free-text');
  free.id = 'chip-free'; free.type = 'text';
  free.value = typeof draft?.payload?.free === 'string' ? draft.payload.free : '';
  host.appendChild(lbl); host.appendChild(free);
  if (typeof draft?.steering === 'string') $('steer').value = draft.steering;
  const collectChips = () => {
    const extra = free.value.split(',').map((s) => s.trim()).filter(Boolean);
    const all = [...chosen, ...extra];
    if (!all.length) return { ok: false, error: 'Pick at least one chip or type an answer.' };
    return { ok: true, payload: { chosen: all } };
  };
  return { collect: collectChips, snapshot: () => ({ chosen: [...chosen], free: free.value }) };
}

function renderMockup(card) {
  const mockup = el('span', `lofi-mockup lofi-${card.mockup.layout}`);
  mockup.setAttribute('aria-hidden', 'true');
  for (const region of card.mockup.regions) mockup.appendChild(el('span', 'lofi-region', region));
  return mockup;
}

function renderSingleCards(host, q, draft) {
  let selected = draft?.payload?.cards?.find((card) => card.decision === 'keep')?.label || null;
  const grid = el('div', 'choice-cards');
  const buttons = [];
  for (const card of q.cards || []) {
    const button = el('button', 'choice-card');
    button.type = 'button';
    button.setAttribute('aria-pressed', card.label === selected ? 'true' : 'false');
    if (card.mockup) button.appendChild(renderMockup(card));
    button.appendChild(el('span', 'choice-card-label', card.label));
    button.addEventListener('click', () => {
      selected = card.label;
      buttons.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
    });
    buttons.push(button);
    grid.appendChild(button);
  }
  host.appendChild(grid);
  if (typeof draft?.steering === 'string') $('steer').value = draft.steering;
  const answerPayload = () => ({ cards: (q.cards || []).map((card) => ({ label: card.label, decision: card.label === selected ? 'keep' : 'kill' })) });
  const draftPayload = () => ({ cards: selected ? [{ label: selected, decision: 'keep' }] : [] });
  return {
    collect: () => selected ? { ok: true, payload: answerPayload() } : { ok: false, error: 'Choose one workspace.' },
    snapshot: draftPayload,
  };
}

function renderCards(host, q, draft) {
  if (q.cardMode === 'single') return renderSingleCards(host, q, draft);
  const isPriority = q.nodeId === 'feature-priority';
  const savedCards = draft?.payload?.cards;
  const seed = Array.isArray(savedCards) && savedCards.length
    ? savedCards
    : (Array.isArray(q.cards) && q.cards.length ? q.cards : [{ label: '' }]);
  const rows = [];

  function addCard(seedCard) {
    const row = el('div', 'card');
    const label = el('input', 'card-label');
    label.type = 'text'; label.value = seedCard.label || '';
    label.placeholder = 'name this ' + (isPriority ? 'feature' : 'screen');
    row.appendChild(label);

    let prioritySel = null;
    if (isPriority) {
      prioritySel = el('select', 'card-priority');
      // The priority enum comes from the server's frozen wire contract, never a
      // local copy. A second declaration here is exactly what let the card shape
      // drift out of the agent's contract and ship blank inputs.
      for (const p of WIRE.cardPriorities) {
        const o = el('option', null, p); o.value = p; prioritySel.appendChild(o);
      }
      // Default to P1 when the seed carries no usable priority, degrading to the
      // first axis of the enum rather than an empty select if the enum ever moves.
      const fallbackPriority = WIRE.cardPriorities.includes('P1') ? 'P1' : WIRE.cardPriorities[0];
      prioritySel.value = WIRE.cardPriorities.includes(seedCard.priority) ? seedCard.priority : fallbackPriority;
      row.appendChild(prioritySel);
    }

    const kk = el('div', 'keepkill');
    const keep = el('button', null, 'Keep'); keep.type = 'button'; keep.setAttribute('aria-pressed', 'true');
    const kill = el('button', null, 'Cut'); kill.type = 'button'; kill.setAttribute('aria-pressed', 'false');
    keep.addEventListener('click', () => { keep.setAttribute('aria-pressed', 'true'); kill.setAttribute('aria-pressed', 'false'); row.classList.remove('kill'); });
    kill.addEventListener('click', () => { keep.setAttribute('aria-pressed', 'false'); kill.setAttribute('aria-pressed', 'true'); row.classList.add('kill'); });
    kk.appendChild(keep); kk.appendChild(kill);
    row.appendChild(kk);

    if (seedCard.decision === 'kill') kill.click();

    grid.appendChild(row);
    rows.push({ label, prioritySel, keep });
  }

  const grid = el('div', 'cards');
  host.appendChild(grid);
  for (const s of seed) addCard(s);

  const add = el('button', 'card-add', '+ add another');
  add.type = 'button';
  add.addEventListener('click', () => addCard({ label: '' }));
  host.appendChild(add);

  if (typeof draft?.steering === 'string') $('steer').value = draft.steering;
  const cardPayload = () => ({
    cards: rows.map((r) => ({
      label: r.label.value,
      decision: r.keep.getAttribute('aria-pressed') === 'true' ? 'keep' : 'kill',
      ...(r.prioritySel ? { priority: r.prioritySel.value } : {}),
    })),
  });
  const collectCards = () => {
    const cards = rows.map((r) => ({
      label: r.label.value.trim(),
      decision: r.keep.getAttribute('aria-pressed') === 'true' ? 'keep' : 'kill',
      ...(r.prioritySel ? { priority: r.prioritySel.value } : {}),
    })).filter((c) => c.label);
    if (!cards.length) return { ok: false, error: 'Name at least one item.' };
    return { ok: true, payload: { cards } };
  };
  return { collect: collectCards, snapshot: cardPayload };
}

function renderAllocation(host, q, draft) {
  const axes = q.axes || WIRE.tradeoffAxes;
  const AXIS_LABEL = {
    speed_to_alpha: 'Speed to alpha', scalability: 'Scalability', ux_polish: 'UX polish',
    maintainability: 'Maintainability', cost: 'Cost', security: 'Security',
  };

  const intro = el('p', 'alloc-intro',
    'Pick the most and least important in each round. We convert your ranking into a 100-point split.');
  host.appendChild(intro);
  const stage = el('div'); host.appendChild(stage);

  let remaining = Array.isArray(draft?.payload?.remaining) ? [...draft.payload.remaining] : [...axes];
  const bestOrder = Array.isArray(draft?.payload?.bestOrder) ? [...draft.payload.bestOrder] : [];
  const worstOrder = Array.isArray(draft?.payload?.worstOrder) ? [...draft.payload.worstOrder] : [];
  let finalWeights = draft?.payload?.finalWeights || null;
  let unacceptable = draft?.payload?.unacceptable || null;

  function renderRound() {
    stage.innerHTML = '';
    if (remaining.length <= 1) {
      if (remaining.length === 1) bestOrder.push(remaining[0]); // lone leftover → middle
      remaining = [];
      finish();
      return;
    }
    let best = null, worst = null;
    const round = el('div', 'alloc-round');
    for (const axis of remaining) {
      const rowEl = el('div', 'alloc-axis');
      const name = el('div', 'alloc-axis-name', AXIS_LABEL[axis] || axis);
      const bestPick = el('label', 'pick');
      const bestR = el('input'); bestR.type = 'radio'; bestR.name = 'best';
      bestPick.appendChild(bestR); bestPick.appendChild(document.createTextNode('most'));
      const worstPick = el('label', 'pick');
      const worstR = el('input'); worstR.type = 'radio'; worstR.name = 'worst';
      worstPick.appendChild(worstR); worstPick.appendChild(document.createTextNode('least'));
      bestR.addEventListener('change', () => { best = axis; check(); });
      worstR.addEventListener('change', () => { worst = axis; check(); });
      rowEl.appendChild(name); rowEl.appendChild(bestPick); rowEl.appendChild(worstPick);
      round.appendChild(rowEl);
    }
    stage.appendChild(round);
    const next = el('button', 'btn-secondary', 'Lock round'); next.type = 'button'; next.disabled = true;
    next.addEventListener('click', () => {
      bestOrder.push(best);
      worstOrder.push(worst);
      remaining = remaining.filter((a) => a !== best && a !== worst);
      renderRound();
    });
    stage.appendChild(next);
    function check() { next.disabled = !(best && worst && best !== worst); }
  }

  function finish() {
    const ranking = [...bestOrder, ...worstOrder.slice().reverse()];
    finalWeights = weightsFromRanking(ranking);
    // The "never sacrifice" default is the TOP-ranked axis (most important),
    // not the least — the user can still override via the confirm chips.
    unacceptable = unacceptable || neverSacrificeDefault(ranking);

    const result = el('div', 'alloc-result');
    const weights = el('div', 'alloc-weights');
    for (const axis of ranking) {
      const r = el('div', 'alloc-weight-row');
      r.appendChild(el('span', 'axis', AXIS_LABEL[axis] || axis));
      r.appendChild(el('span', 'val', String(finalWeights[axis])));
      weights.appendChild(r);
    }
    result.appendChild(weights);
    result.appendChild(el('p', 'alloc-never', 'Which would you never sacrifice?'));
    const opts = el('div', 'alloc-never-opts');
    for (const axis of axes) {
      const b = el('button', 'chip', AXIS_LABEL[axis] || axis); b.type = 'button';
      b.setAttribute('aria-pressed', axis === unacceptable ? 'true' : 'false');
      b.addEventListener('click', () => {
        unacceptable = axis;
        opts.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
      });
      opts.appendChild(b);
    }
    result.appendChild(opts);
    stage.appendChild(result);
  }

  if (typeof draft?.steering === 'string') $('steer').value = draft.steering;
  if (finalWeights) finish(); else renderRound();

  const collectAllocation = () => {
    if (!finalWeights) return { ok: false, error: 'Finish the ranking rounds first.' };
    if (!unacceptable) return { ok: false, error: 'Pick the tradeoff you would never sacrifice.' };
    return { ok: true, payload: { weights: finalWeights, unacceptable_tradeoff: unacceptable } };
  };
  return {
    collect: collectAllocation,
    snapshot: () => ({ remaining, bestOrder, worstOrder, finalWeights, unacceptable }),
  };
}

// ── submit ────────────────────────────────────────────────────────────────────
function formatSavedTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'just now' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function saveCurrentDraft({ quiet = false } = {}) {
  if (!snapshot) return false;
  const seq = Number($('answer-form').dataset.seq);
  const button = $('save-btn');
  button.disabled = true;
  if (!quiet) $('save-status').textContent = 'Saving…';
  try {
    const result = await (await fetch('/api/save-draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq, payload: snapshot(), steering: $('steer').value }),
    })).json();
    if (!result.ok) {
      $('save-status').textContent = result.stale ? 'Question changed; reload to continue.' : (result.error || 'Could not save.');
      return false;
    }
    $('save-status').textContent = `Saved ${formatSavedTime(result.savedAt)}`;
    return true;
  } catch {
    $('save-status').textContent = 'Network error — draft not saved.';
    return false;
  } finally {
    button.disabled = false;
  }
}

$('save-btn').addEventListener('click', () => saveCurrentDraft());
$('draft-btn').addEventListener('click', async () => {
  const button = $('draft-btn');
  button.disabled = true;
  $('save-status').textContent = 'Saving and drafting…';
  try {
    if (!(await saveCurrentDraft({ quiet: true }))) return;
    const result = await (await fetch('/api/export-draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })).json();
    $('save-status').textContent = result.ok
      ? `Working brief written to ${result.artifact}`
      : (result.error || 'Could not create working brief.');
  } catch {
    $('save-status').textContent = 'Network error — working brief not created.';
  } finally {
    button.disabled = false;
  }
});

$('answer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!collect) return;
  const c = collect();
  if (!c.ok) { $('err').textContent = c.error; return; }
  const seq = Number($('answer-form').dataset.seq);
  const steering = $('steer').value.trim();
  const btn = $('submit-btn');
  btn.disabled = true; $('err').textContent = '';
  try {
    const r = await (await fetch('/api/answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seq, ...c.payload, steering: steering || undefined }),
    })).json();
    if (!r.ok) {
      if (r.stale) { $('err').textContent = 'That question was superseded — reloading.'; renderedSeq = -1; }
      else $('err').textContent = r.error || 'Could not submit.';
      btn.disabled = false;
      return;
    }
    // Success: server flipped to await_agent. The poll loop will render the next state.
    renderedSeq = -1;
    show('waiting');
  } catch {
    $('err').textContent = 'Network error — try again.';
  } finally {
    btn.disabled = false;
  }
});

for (const button of document.querySelectorAll('[data-stage-id]')) {
  button.addEventListener('click', async () => {
    const stageId = button.dataset.stageId;
    // Leaving a live question should not discard typed work. A partial answer is
    // saved as a draft, not promoted to a decision, before navigation changes.
    if (shownPhase === 'question' && stageId !== 'requirements' && snapshot) {
      await saveCurrentDraft({ quiet: true });
    }
    navigateToStage(stageId);
  });
}

window.addEventListener('hashchange', () => {
  selectedStageId = stageFromHash();
  lastJourneyKey = '';
  if (latestState) applyState(latestState);
});

boot();
