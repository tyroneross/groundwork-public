import { renderBaselineView, renderBootstrapError } from './picker-bootstrap-view.mjs';

// picker.js — dumb client. State machine: BOOTSTRAP REVIEW or INTRO → MODE → WALK → DONE.
// The server (Python engine) is the single source of truth — this file holds
// NO design logic. Mode confirmation is required before the walk begins.
//
// DRIVE MODES:
//   standard  — browser polls /api/step after each pick (default, original behaviour).
//   adaptive  — agent drives decision selection via the TURN handshake; browser
//               long-polls /api/step which returns await_agent (keep polling) or
//               ask (agent has chosen; user still picks visually). After a pick,
//               /api/pick returns {phase:'await_agent'} (no step) → browser re-polls.

const $ = (sel) => document.querySelector(sel);
let decided = 0;
let pathValid = false;   // tracks whether last validate-path returned valid:true
let validateTimer = null;

// Current drive mode — kept in sync with the server; 'standard' by default.
let currentDrive = 'standard';
let bootstrappedSession = false;
let bootstrapSetupConfirmed = false;

// Live turn seq for the decision currently shown (adaptive mode). Echoed back on
// POST /api/pick so the server rejects a pick made against a superseded decision
// (f1 stale-seq guard). undefined ⇒ no seq sent (standard mode / pre-seq server).
let currentSeq;

// Adaptive poll loop guard: set to false to stop an in-flight poll loop.
let _pollActive = false;
let _pollGeneration = 0;
let chatSending = false;
let pendingChatId = null;
let pendingChatText = null;

// ── utility ──────────────────────────────────────────────────────────────────

async function getJSON(url) {
  const r = await fetch(url);
  return r.json();
}
async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Every HTML preview crosses a browser execution boundary, including HTML
// proposed by a connected agent. Parse it inertly, remove active content and
// unsafe attributes, then import only the sanitized fragment into this page.
function setSanitizedHtml(target, markup, preserveStyles = false) {
  const parsed = new DOMParser().parseFromString(String(markup || ''), 'text/html');
  if (preserveStyles) {
    for (const style of Array.from(parsed.head.querySelectorAll('style')).reverse()) parsed.body.prepend(style);
  }
  const blocked = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base']);
  const unsafeCss = /(?:@import|expression\s*\(|url\s*\(|behavior\s*:|-moz-binding)/i;
  for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    if (blocked.has(tag) || (tag === 'style' && unsafeCss.test(element.textContent || ''))) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const lowerValue = value.toLowerCase();
      if (
        name.startsWith('on') ||
        name === 'srcdoc' ||
        name === 'srcset' ||
        (name === 'style' && unsafeCss.test(value)) ||
        (['action', 'formaction'].includes(name)) ||
        (['href', 'xlink:href'].includes(name) && value && !value.startsWith('#')) ||
        (['src', 'poster'].includes(name) && value && !lowerValue.startsWith('data:image/'))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  const fragment = document.createDocumentFragment();
  for (const child of Array.from(parsed.body.childNodes)) {
    fragment.appendChild(document.importNode(child, true));
  }
  target.replaceChildren(fragment);
}

function setIsolatedMockup(target, markup) {
  const staging = document.createElement('div');
  setSanitizedHtml(staging, markup, true);
  const serializer = new XMLSerializer();
  const sanitized = Array.from(staging.childNodes)
    .map((child) => serializer.serializeToString(child))
    .join('');
  const iframe = document.createElement('iframe');
  iframe.className = 'generated-mockup-frame';
  iframe.title = 'Generated mockup preview';
  iframe.setAttribute('sandbox', '');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('tabindex', '0');
  iframe.srcdoc =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src \'none\'; base-uri \'none\'; form-action \'none\'">' +
    '<style>html,body{box-sizing:border-box;margin:0;min-height:100%;overflow:auto}body{padding:12px}</style>' +
    '</head><body>' + sanitized + '</body></html>';
  target.replaceChildren(iframe);
}

// ── drive helpers ─────────────────────────────────────────────────────────────

function getDriveValue() {
  const checked = document.querySelector('input[name="drive"]:checked');
  return checked ? checked.value : 'standard';
}

// ── screen visibility + left rail ─────────────────────────────────────────────

// Every section the stage can show, and which rail destination owns it. The
// Designer destination owns the whole walk; the other two are single screens.
const SCREEN_DESTINATION = {
  'startup-screen': 'designer',
  'baseline-screen': 'designer',
  intro: 'designer',
  'mode-screen': 'designer',
  'extract-screen': 'designer',
  'review-screen': 'designer',
  decision: 'designer',
  'await-pane': 'designer',
  'walk-complete': 'designer',
  'workspace-screen': 'saved',
  done: 'output',
};
const SCREEN_IDS = Object.keys(SCREEN_DESTINATION);

// Where the walk currently stands, so leaving Designer for Saved work and
// coming back returns to the same step rather than restarting.
let currentWalkScreen = 'startup-screen';

// Which destination the user last chose. The walk advances on its own timers —
// the adaptive poll loop re-renders every few seconds — and a background state
// change must never yank the user off a destination they selected.
let currentDestination = 'designer';
let currentSession = null;
let reviewHydrated = false;
let suggestionsRendered = false;

const DESIGNER_RAIL_NOTE = 'Visual walk — running here';
const DESIGNER_RAIL_NOTE_WAITING = 'Visual walk — updated';
const DESIGNER_RAIL_NOTE_DONE = 'Visual walk — complete';

function setDesignerRailNote(text) {
  const note = document.querySelector('#rail-designer .rail-item-note');
  if (note) note.textContent = text;
}

// What the rail should say about Designer, given where the walk stands.
function designerRailNote(moved = false) {
  if (currentWalkScreen === 'walk-complete') return DESIGNER_RAIL_NOTE_DONE;
  return moved ? DESIGNER_RAIL_NOTE_WAITING : DESIGNER_RAIL_NOTE;
}

// Advance the walk. Renders only when the user is actually looking at Designer;
// otherwise it records where the walk stands and says so in the rail.
function showWalkScreen(sectionId) {
  currentWalkScreen = sectionId;
  if (currentDestination !== 'designer') {
    setDesignerRailNote(designerRailNote(true));
    return;
  }
  showOnly(sectionId);
}

function syncRail(sectionId) {
  const destination = SCREEN_DESTINATION[sectionId];
  document.querySelectorAll('button.rail-item').forEach((item) => {
    if (item.dataset.destination === destination) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

function showOnly(sectionId) {
  // Hide all top-level sections, then reveal the requested one.
  SCREEN_IDS.forEach((id) => {
    const el = $('#' + id);
    if (el) el.hidden = (id !== sectionId);
  });
  if (SCREEN_DESTINATION[sectionId] === 'designer') currentWalkScreen = sectionId;
  syncRail(sectionId);
  // Clear tier label and ctx on non-walk screens. Saved work and Design output
  // are side destinations — leaving and returning must not wipe session context.
  if (sectionId !== 'decision' && sectionId !== 'done' && sectionId !== 'workspace-screen') {
    $('#tier-label').textContent = '';
    $('#progress').textContent = '';
    if (sectionId !== 'await-pane') {
      $('#ctx').textContent = '';
    }
  }
  // Hide agent strip whenever we leave the decision pane.
  if (sectionId !== 'decision') {
    const strip = $('#agent-strip');
    if (strip) strip.hidden = true;
  }
}

function selectDestination(destination) {
  currentDestination = destination;
  if (destination === 'saved') {
    showOnly('workspace-screen');
    refreshWorkspace();
    return;
  }
  if (destination === 'output') {
    showOnly('done');
    return;
  }
  setDesignerRailNote(designerRailNote());
  showOnly(currentWalkScreen);
}

document.querySelectorAll('button.rail-item').forEach((item) => {
  item.addEventListener('click', () => selectDestination(item.dataset.destination));
});

$('#walk-complete-output')?.addEventListener('click', () => selectDestination('output'));

// ── intro screen ──────────────────────────────────────────────────────────────

// On boot, load resume drafts (PART B §7)
async function loadResumeDrafts() {
  try {
    const res = await getJSON('/api/draft/list');
    const drafts = (res && res.drafts) || [];
    if (!drafts.length) return;
    const region = $('#resume-region');
    const list = $('#resume-list');
    if (!region || !list) return;
    list.replaceChildren();
    for (const d of drafts) {
      const row = document.createElement('button');
      row.className = 'resume-row';
      const updated = d.updated_at ? new Date(d.updated_at).toLocaleDateString() : '';
      setSanitizedHtml(row,
        `<span class="resume-product">${escapeHtml(d.product || 'general')}</span>` +
        `<span class="resume-meta">${escapeHtml(d.source || '')} · ${escapeHtml(String(d.picks_count || 0))} picks` +
        (updated ? ` · ${escapeHtml(updated)}` : '') +
        `</span>`);
      row.addEventListener('click', () => resumeDraft(d.product, d.draft_id));
      list.appendChild(row);
    }
    region.hidden = false;
  } catch (_) {
    // Non-fatal — resume affordance stays hidden.
  }
}

async function resumeDraft(product, draftId) {
  try {
    const res = await postJSON('/api/draft/resume', { product, draftId });
    if (!res.ok) return;
    if (res.extracted && res.extracted.length) {
      renderReviewScreen(res.extracted, null);
    } else {
      if (currentDrive === 'adaptive') {
        loadStep();
      } else {
        const step = await getJSON('/api/step');
        renderStep(step);
      }
    }
  } catch (_) {
    // Non-fatal.
  }
}

$('#start-btn').addEventListener('click', () => {
  showWalkScreen('mode-screen');
});

// ── mode screen ───────────────────────────────────────────────────────────────

function getModeValue() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : 'general';
}

function updateContinueState() {
  const mode = getModeValue();
  const btn = $('#continue-btn');
  if (mode === 'product') {
    // Disable until we have a valid path.
    if (pathValid) {
      btn.removeAttribute('disabled');
    } else {
      btn.setAttribute('disabled', '');
    }
  } else {
    // General mode: always enabled (default is pre-selected).
    btn.removeAttribute('disabled');
  }
}

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const mode = getModeValue();
    const repoSection = $('#repo-section');
    if (mode === 'product') {
      repoSection.hidden = false;
    } else {
      repoSection.hidden = true;
      // Reset validation state when switching back to general.
      pathValid = false;
      $('#repo-validation').textContent = '';
      $('#repo-validation').removeAttribute('style');
    }
    updateContinueState();
  });
});

// ── path validation ───────────────────────────────────────────────────────────

$('#repo-path').addEventListener('input', () => {
  clearTimeout(validateTimer);
  const val = $('#repo-path').value.trim();
  if (!val) {
    pathValid = false;
    $('#repo-validation').textContent = '';
    $('#repo-validation').removeAttribute('style');
    updateContinueState();
    return;
  }
  validateTimer = setTimeout(async () => {
    try {
      const res = await postJSON('/api/validate-path', { path: val });
      const div = $('#repo-validation');
      if (res.valid) {
        pathValid = true;
        div.textContent = 'valid';
        div.style.color = 'var(--accent)';
      } else {
        pathValid = false;
        div.textContent = res.error || 'path not found';
        div.style.color = 'var(--error)';
      }
    } catch (_) {
      pathValid = false;
      $('#repo-validation').textContent = 'could not reach server';
      $('#repo-validation').style.color = 'var(--error)';
    }
    updateContinueState();
  }, 300);
});

// ── continue → post mode, then either extract-screen (product) or walk (general) ──

$('#continue-btn').addEventListener('click', async () => {
  const mode = getModeValue();
  const drive = getDriveValue();
  let modePayload;
  if (mode === 'product') {
    modePayload = {
      mode: 'product',
      repoPath: $('#repo-path').value.trim(),
      context: $('#repo-context').value.trim(),
      drive,
      confirmReset: bootstrapSetupConfirmed,
    };
  } else {
    modePayload = { mode: 'general', drive, confirmReset: bootstrapSetupConfirmed };
  }

  const modeRes = await postJSON('/api/mode', modePayload);
  if (!modeRes.ok) {
    // Surface error inline — no error screen per contract.
    $('#repo-validation').textContent = modeRes.error || 'mode error';
    $('#repo-validation').style.color = 'var(--error)';
    return;
  }

  // Track the confirmed drive mode from the server response.
  currentDrive = modeRes.drive || drive;

  // Set context header now that mode is confirmed.
  if (mode === 'general') {
    $('#ctx').textContent = 'General design style' + (currentDrive === 'adaptive' ? ' · Adaptive' : '');
  } else {
    $('#ctx').textContent = 'Designing for: ' + (modeRes.target || modePayload.repoPath);
  }

  if (mode === 'product') {
    // Product mode: show extract step before starting the walk.
    // Reset extract UI state from any prior session.
    resetExtractScreen();
    showWalkScreen('extract-screen');
    return;
  }

  // General mode: start the walk.
  const init = await getJSON('/api/init');
  currentDrive = init.drive || currentDrive;
  if (currentDrive === 'adaptive') {
    loadStep();
  } else {
    renderStep(init.step);
  }
});

// ── extract screen helpers ────────────────────────────────────────────────────

function resetExtractScreen() {
  $('#extract-url').value = '';
  $('#extract-result').hidden = true;
  $('#extract-warning').hidden = true;
  $('#extract-warning').textContent = '';
  const confirmBtn = $('#confirm-extract-btn');
  confirmBtn.hidden = true;
  confirmBtn.setAttribute('disabled', '');
  // Reset import section
  $('#import-path').value = '';
  const skipped = $('#import-skipped');
  if (skipped) { skipped.hidden = true; skipped.textContent = ''; }
}

function renderExtractSummary(summary) {
  // summary shape: { accent, surface, type, density, components } — all string|null
  // Handle nested summary.summary from some server paths.
  const s = (summary && summary.summary) ? summary.summary : (summary || {});

  function setRow(valEl, value) {
    if (value) {
      valEl.textContent = value;
      valEl.classList.remove('exr-muted');
    } else {
      valEl.textContent = 'not detected';
      valEl.classList.add('exr-muted');
    }
  }

  // Accent — with color swatch if value looks like a color (#hex or rgb...)
  const accentVal = s.accent || null;
  const swatch = $('#exr-swatch-el');
  const accentEl = $('#exr-accent-val');
  if (accentVal) {
    // Test whether it looks like a usable CSS color (hex, rgb, named).
    const looksLikeColor = /^#[0-9a-fA-F]{3,8}$/.test(accentVal) ||
      /^rgba?\(/.test(accentVal) ||
      /^hsl/.test(accentVal);
    if (looksLikeColor) {
      swatch.style.backgroundColor = accentVal;
      swatch.hidden = false;
    } else {
      swatch.hidden = true;
    }
    accentEl.textContent = accentVal;
    accentEl.classList.remove('exr-muted');
  } else {
    swatch.hidden = true;
    accentEl.textContent = 'not detected';
    accentEl.classList.add('exr-muted');
  }

  setRow($('#exr-surface-val'), s.surface);
  setRow($('#exr-type-val'), s.type);
  setRow($('#exr-density-val'), s.density);
  setRow($('#exr-components-val'), s.components);

  $('#extract-result').hidden = false;
}

// ── extract button ────────────────────────────────────────────────────────────

$('#extract-btn').addEventListener('click', async () => {
  const url = $('#extract-url').value.trim();
  const warnEl = $('#extract-warning');

  // Reset prior result.
  $('#extract-result').hidden = true;
  const confirmBtn = $('#confirm-extract-btn');
  confirmBtn.hidden = true;
  confirmBtn.setAttribute('disabled', '');
  warnEl.hidden = true;
  warnEl.textContent = '';

  try {
    const res = await postJSON('/api/extract', { url });

    if (res.available && res.summary) {
      renderExtractSummary(res.summary);
      // Show confirm button (primary — high-intent action).
      confirmBtn.removeAttribute('disabled');
      confirmBtn.hidden = false;
      // Show any non-fatal warnings inline.
      if (res.warnings && res.warnings.length) {
        warnEl.textContent = res.warnings.join(' · ');
        warnEl.hidden = false;
      }
    } else {
      // Couldn't read the live app — don't strand the user on an error.
      // Show a calm one-liner and auto-advance into the describe/walk path.
      warnEl.textContent =
        "Couldn't read the live app — no problem, continuing from a description instead…";
      warnEl.hidden = false;
      setTimeout(proceedWithoutExtraction, 1400);
    }
  } catch (err) {
    warnEl.textContent =
      "Couldn't reach the extractor — continuing from a description instead…";
    warnEl.hidden = false;
    setTimeout(proceedWithoutExtraction, 1400);
  }
});

// ── import DESIGN.md (PART D §9) ─────────────────────────────────────────────

$('#import-btn').addEventListener('click', async () => {
  const path = $('#import-path').value.trim();
  const warnEl = $('#extract-warning');
  const skippedEl = $('#import-skipped');

  if (!path) {
    warnEl.textContent = 'Enter a path to the DESIGN.md file.';
    warnEl.hidden = false;
    return;
  }

  // Reset prior state.
  warnEl.hidden = true;
  warnEl.textContent = '';
  if (skippedEl) { skippedEl.hidden = true; skippedEl.textContent = ''; }

  try {
    const res = await postJSON('/api/import-design', { path });

    if (!res.ok) {
      warnEl.textContent = res.error || 'Import failed.';
      warnEl.hidden = false;
      return;
    }

    // NO-SILENT-EMPTY: a file that parsed but mapped zero recognized tokens
    // must NOT silently seed an empty system and drop into the walk. Surface
    // the "format not recognized" warning and STOP here (no-cosmetic-dismissal).
    const mapped = typeof res.mapped === 'number' ? res.mapped : null;
    if (res.available === false || mapped === 0) {
      warnEl.textContent =
        res.warning ||
        "This file's format wasn't recognized — no design.md/v1 tokens found. " +
        'Expected a `base:` layer or top-level token groups (color, typography, spacing).';
      warnEl.hidden = false;
      // Still surface any skipped keys so the user sees exactly what was seen.
      if (res.skipped && res.skipped.length && skippedEl) {
        const paths = res.skipped.map((s) => String(s.path || s)).join(', ');
        skippedEl.textContent = 'Keys seen but not recognized: ' + paths;
        skippedEl.hidden = false;
      }
      return;
    }

    // Update ctx.
    const label = [res.doc_name, res.doc_version].filter(Boolean).join(' ');
    if (label) {
      $('#ctx').textContent = 'Imported: ' + escapeHtml(label);
    }

    // Surface a non-fatal warning (e.g. some tokens fell outside the vocabulary)
    // on the confirm surface — informative, not blocking.
    if (res.warning) {
      warnEl.textContent = res.warning;
      warnEl.hidden = false;
    }

    // Surface skipped tokens — never silently lose them.
    if (res.skipped && res.skipped.length) {
      const count = res.skipped.length;
      const paths = res.skipped.map((s) => String(s.path || s)).join(', ');
      if (skippedEl) {
        skippedEl.textContent =
          'Not imported (' + count + ' outside vocabulary): ' + paths;
        skippedEl.hidden = false;
      }
    }

    // If extracted dims available, go to review screen (CVA confirm surface).
    if (res.extracted && res.extracted.length) {
      renderReviewScreen(res.extracted, null);
    } else {
      if (currentDrive === 'adaptive') {
        loadStep();
      } else {
        const step = await getJSON('/api/step');
        renderStep(step);
      }
    }
  } catch (_) {
    warnEl.textContent = 'Import request failed — check the server and try again.';
    warnEl.hidden = false;
  }
});

// ── confirm extraction → review screen (if extracted) OR walk ────────────────

$('#confirm-extract-btn').addEventListener('click', async () => {
  try {
    const res = await postJSON('/api/confirm-extraction', {});
    // Update ctx to reflect extracted target.
    if (res.target) {
      $('#ctx').textContent = 'Designing for: ' + escapeHtml(res.target) + ' (extracted)';
    }
    if (res.degraded && res.warning) {
      // Seeding failed but walk still starts — surface the warning once.
      console.warn('[designer] confirm-extraction degraded:', res.warning);
    }
    // If extraction produced reviewable dims, show the review screen first.
    const extracted = (res.extracted && res.extracted.length > 0) ? res.extracted : null;
    if (extracted) {
      renderReviewScreen(extracted, res.step);
    } else {
      if (currentDrive === 'adaptive') {
        loadStep();
      } else {
        renderStep(res.step);
      }
    }
  } catch (err) {
    // Network / server error — fall back to skip path.
    const init = await getJSON('/api/init');
    if (currentDrive === 'adaptive') {
      loadStep();
    } else {
      renderStep(init.step);
    }
  }
});

// ── review screen (confirm/evolve extracted dims) ─────────────────────────────

// currentStep is saved so "Continue →" can proceed to the undetermined walk.
let _reviewPendingStep = null;

function renderReviewScreen(extractedDims, pendingStep) {
  _reviewPendingStep = pendingStep;
  const container = $('#review-dims');
  container.replaceChildren();

  for (const dim of extractedDims) {
    const card = document.createElement('div');
    card.className = 'review-dim-card';
    card.dataset.categoryId = dim.category_id;

    // Header — dimension title + description
    const header = document.createElement('div');
    header.className = 'review-dim-header';
    const titleEl = document.createElement('p');
    titleEl.className = 'review-dim-title';
    titleEl.textContent = dim.title || dim.category_id;
    header.appendChild(titleEl);
    if (dim.description) {
      const descEl = document.createElement('p');
      descEl.className = 'review-dim-desc';
      descEl.textContent = dim.description;
      header.appendChild(descEl);
    }
    card.appendChild(header);

    // Option rows
    for (const opt of (dim.options || [])) {
      const isCurrent = opt.id === dim.current_option_id;
      const row = document.createElement('button');
      row.className = 'review-opt-row';
      row.setAttribute('data-current', isCurrent ? 'true' : 'false');
      row.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');

      const labelEl = document.createElement('span');
      labelEl.className = 'review-opt-label';
      labelEl.textContent = opt.label || opt.id;
      row.appendChild(labelEl);

      const markEl = document.createElement('span');
      markEl.className = 'review-current-mark';
      markEl.textContent = 'current';
      row.appendChild(markEl);

      row.addEventListener('click', () => handleReviewPick(card, dim.category_id, opt.id, row));
      card.appendChild(row);
    }

    container.appendChild(card);
  }

  showWalkScreen('review-screen');
}

async function handleReviewPick(card, categoryId, optionId, clickedRow) {
  // POST /api/pick — apply_pick appends to history with source default "pick",
  // overriding the extracted seed. The engine already supports this.
  try {
    await postJSON('/api/pick', { category: categoryId, option: optionId });
  } catch (_err) {
    // Override failure is non-fatal: the UI still marks the selection locally.
  }
  // Re-fetch the extracted list so the review screen reflects server state.
  let freshDims = null;
  try {
    const fresh = await getJSON('/api/extracted');
    freshDims = fresh.extracted || null;
  } catch (_err) {
    // Fall back to local re-mark on fetch failure.
  }

  if (freshDims && freshDims.length > 0) {
    // Re-render the whole review screen with fresh data (preserves pending step).
    renderReviewScreen(freshDims, _reviewPendingStep);
  } else {
    // Locally update the current marks in this card (fallback for network hiccup).
    const rows = card.querySelectorAll('.review-opt-row');
    rows.forEach((r) => {
      const isNow = r === clickedRow;
      r.setAttribute('data-current', isNow ? 'true' : 'false');
      r.setAttribute('aria-pressed', isNow ? 'true' : 'false');
    });
  }
}

$('#review-continue-btn') && $('#review-continue-btn').addEventListener('click', async () => {
  // Proceed to the undetermined walk.
  if (currentDrive === 'adaptive') {
    _reviewPendingStep = null;
    loadStep();
    return;
  }
  if (_reviewPendingStep) {
    // The step was already fetched during confirm-extraction; use it directly.
    const step = _reviewPendingStep;
    _reviewPendingStep = null;
    renderStep(step);
  } else {
    // Fallback: fetch the next step fresh.
    const step = await getJSON('/api/step');
    renderStep(step);
  }
});

// ── skip extraction → description-only walk ───────────────────────────────────

// Proceed into the walk without extraction — used by the Skip button AND as the
// automatic fallback when extraction fails, so a failed extract never freezes.
async function proceedWithoutExtraction() {
  const init = await getJSON('/api/init');
  if (currentDrive === 'adaptive') {
    loadStep();
  } else {
    renderStep(init.step);
  }
}

$('#skip-extract-btn').addEventListener('click', proceedWithoutExtraction);

// ── adaptive step loader — routes on action from /api/step ───────────────────

async function loadStep() {
  const generation = ++_pollGeneration;
  _pollActive = true;
  _pollLoop(generation);
}

async function _pollLoop(generation = _pollGeneration) {
  const myPoll = generation;  // capture; if loadStep() called again this goes stale.
  // Show the await-pane while we wait for the server's long-poll to resolve.
  showWalkScreen('await-pane');
  $('#await-msg').textContent = 'Agent is choosing the next decision…';
  $('#switch-standard-btn').hidden = true;

  let step;
  try {
    step = await getJSON('/api/step');
  } catch (_e) {
    if (myPoll !== _pollGeneration || !_pollActive) return;
    // Network error — retry after a pause.
    setTimeout(() => { if (_pollActive && generation === _pollGeneration) _pollLoop(generation); }, 800);
    return;
  }

  if (myPoll !== _pollGeneration || !_pollActive) return;  // superseded

  if (step.action === 'await_agent' && step.waiting) {
    // Still waiting — server timed out its own long-poll, re-poll from browser.
    showWalkScreen('await-pane');
    $('#await-msg').textContent = step.message || 'Agent is choosing the next decision…';
    $('#switch-standard-btn').hidden = true;
    setTimeout(() => { if (_pollActive && generation === _pollGeneration) _pollLoop(generation); }, 600);
    return;
  }

  if (step.action === 'await_agent' && step.noAgent) {
    // No agent attached — show informational notice with a "switch to standard" affordance.
    showWalkScreen('await-pane');
    $('#await-msg').textContent = step.message || 'No agent attached — launch via /designer --adaptive';
    const switchBtn = $('#switch-standard-btn');
    switchBtn.hidden = bootstrappedSession;
    // Poll occasionally in case an agent attaches later.
    setTimeout(() => { if (_pollActive && generation === _pollGeneration) _pollLoop(generation); }, 4000);
    return;
  }

  if (step.action === 'done') {
    _pollActive = false;
    renderDone(step);
    return;
  }

  if (step.action === 'generated') {
    // Agent generated a mockup — render it above the options, keep polling off
    // (user decides to apply or keep exploring; then we loadStep again).
    _pollActive = false;
    renderGenerated(step);
    return;
  }

  if (step.action === 'ask') {
    _pollActive = false;  // Agent answered; no more polling until next pick.
    renderStep(step);
    return;
  }

  // Unexpected — re-poll.
  setTimeout(() => { if (_pollActive && generation === _pollGeneration) _pollLoop(generation); }, 600);
}

// ── switch to standard affordance (no-agent notice) ───────────────────────────

$('#switch-standard-btn') && $('#switch-standard-btn').addEventListener('click', async () => {
  _pollActive = false;
  currentDrive = 'standard';
  // Re-POST mode with drive:'standard' — resets the walk server-side.
  const modeRes = await postJSON('/api/mode', { mode: 'general', drive: 'standard' });
  if (!modeRes.ok) return;
  $('#ctx').textContent = 'General design style';
  const init = await getJSON('/api/init');
  renderStep(init.step);
});

// ── generated mockup panel (PART A §3) ────────────────────────────────────────

function renderGenerated(step) {
  refreshWorkspace();
  // Ensure the decision pane is showing (may still be on await-pane).
  // If no current decision to display, we show only the generated panel.
  showWalkScreen('decision');
  updateChatRegion();

  const panel = $('#generated-panel');
  const reasonEl = $('#generated-reason');
  const frameEl = $('#generated-frame');
  const frameLabelEl = $('#generated-frame-label');
  const deltasEl = $('#generated-deltas');
  const applyBtn = $('#apply-deltas-btn');
  const refLabel = $('#generated-ref-label');
  const confirmEl = $('#generated-confirm');

  // Reset state.
  confirmEl.hidden = true;
  confirmEl.textContent = '';

  // Agent reason (quiet italic, ink2).
  const reason = step.agent_reason || '';
  reasonEl.textContent = reason;
  reasonEl.style.display = reason ? '' : 'none';

  // Mockup — agent-authored HTML is sanitized before it reaches the live DOM.
  const mockup = step.mockup || {};
  setIsolatedMockup(frameEl, mockup.html || '');
  const frameLabel = [mockup.label, mockup.platform].filter(Boolean).join(' · ');
  frameLabelEl.textContent = frameLabel;
  frameLabelEl.style.display = frameLabel ? '' : 'none';

  // Token deltas summary.
  const deltas = step.token_deltas || mockup.token_deltas || null;
  const hasDeltas = deltas && (Array.isArray(deltas) ? deltas.length > 0 : Object.keys(deltas).length > 0);
  if (hasDeltas) {
    // Render as "group.key → value" lines — escaped.
    let lines = '';
    if (Array.isArray(deltas)) {
      for (const item of deltas) {
        lines += `<li>${escapeHtml(String(item))}</li>`;
      }
    } else {
      // token_deltas is a 2-level token map {group:{key:value}} — flatten to
      // "group.key → value" lines (NOT String(nestedObject) → [object Object]).
      for (const [group, keys] of Object.entries(deltas)) {
        if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
          for (const [key, val] of Object.entries(keys)) {
            lines += `<li>${escapeHtml(group + '.' + key)} → ${escapeHtml(String(val))}</li>`;
          }
        } else {
          // Defensive: a flat scalar value under a group (shouldn't happen).
          lines += `<li>${escapeHtml(group)} → ${escapeHtml(String(keys))}</li>`;
        }
      }
    }
    setSanitizedHtml(deltasEl, `<ul class="generated-delta-list">${lines}</ul>`);
    deltasEl.hidden = false;
    applyBtn.hidden = false;
    refLabel.hidden = true;
  } else {
    // No deltas — reference only.
    deltasEl.hidden = true;
    applyBtn.hidden = true;
    refLabel.hidden = false;
  }

  panel.hidden = false;

  // Also render the live decision options below if the step carries a decision.
  // If it doesn't (pure generated step with no ask), leave the existing options in place.
  if (step.decision) {
    renderStep(step);
    // renderStep shows the decision pane and options — but hides generated-panel
    // since it calls showOnly. Re-show the panel after renderStep.
    panel.hidden = false;
  }

  // Update the agent strip to show agent reason for this generated step.
  const strip = $('#agent-strip');
  const stripText = $('#agent-strip-text');
  if (strip && stripText && reason) {
    strip.hidden = false;
    strip.classList.add('is-reason');
    strip.classList.remove('is-waiting');
    strip.hidden = true; // Rationale already appears beside the generated preview.
  }
}

// Apply deltas button (PART A §4).
$('#apply-deltas-btn') && $('#apply-deltas-btn').addEventListener('click', async () => {
  const btn = $('#apply-deltas-btn');
  btn.setAttribute('disabled', '');
  try {
    const res = await postJSON('/api/chat/accept', {});
    const confirmEl = $('#generated-confirm');
    if (res.ok) {
      // Show brief confirmation (applied deltas, quiet).
      let msg = 'Applied.';
      if (res.applied && res.applied.length) {
        msg = 'Applied: ' + res.applied.map((a) => escapeHtml(String(a))).join(', ');
      }
      if (res.warning) {
        msg += ' — ' + escapeHtml(res.warning);
      }
      if (res.note) {
        msg += ' (' + escapeHtml(res.note) + ')';
      }
      confirmEl.textContent = msg;
      confirmEl.hidden = false;
      // Hide panel briefly then continue.
      setTimeout(() => {
        $('#generated-panel').hidden = true;
        loadStep();
      }, 1200);
    } else {
      confirmEl.textContent = 'Could not apply: ' + escapeHtml(res.reason || res.error || 'unknown error');
      confirmEl.hidden = false;
      btn.removeAttribute('disabled');
    }
  } catch (_) {
    const confirmEl = $('#generated-confirm');
    confirmEl.textContent = 'Request failed.';
    confirmEl.hidden = false;
    btn.removeAttribute('disabled');
  }
});

// Keep exploring (PART A §3) — just dismiss the panel.
$('#keep-exploring-btn') && $('#keep-exploring-btn').addEventListener('click', () => {
  $('#generated-panel').hidden = true;
  $('#generated-confirm').hidden = true;
});

// ── chat region (PART A §1–2, §10) ───────────────────────────────────────────

// Update chat region visibility based on current drive mode.
function updateChatRegion() {
  const standardNote = $('#chat-standard-note');
  const inputWrap = $('#chat-input-wrap');
  if (!standardNote || !inputWrap) return;

  if (currentDrive === 'adaptive') {
    standardNote.hidden = true;
    inputWrap.hidden = false;
  } else {
    standardNote.hidden = false;
    inputWrap.hidden = true;
  }
}

// Send chat message (adaptive mode).
async function sendChat() {
  const input = $('#chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  // If not adaptive, this shouldn't fire but guard anyway.
  if (currentDrive !== 'adaptive') return;

  if (chatSending) return;
  chatSending = true;
  const sendButton = $('#chat-send');
  if (sendButton) sendButton.disabled = true;
  if (pendingChatText !== text) { pendingChatId = crypto.randomUUID(); pendingChatText = text; }

  // Show waiting state in agent strip.
  const strip = $('#agent-strip');
  const stripText = $('#agent-strip-text');
  if (strip && stripText) {
    strip.hidden = false;
    strip.classList.add('is-waiting');
    strip.classList.remove('is-reason');
    stripText.textContent = 'Agent is reading your note…';
  }

  try {
    const review = typeof reviewPreferences === 'function' ? reviewPreferences() : undefined;
    const res = await postJSON('/api/chat', { text, id: pendingChatId, review });
    if (!res.ok) {
      if (res.reason === 'enable-adaptive') {
        // Show the standard mode note (should already be switched, defensive).
        currentDrive = 'standard';
        updateChatRegion();
      }
      // Reset strip.
      if (strip) {
        strip.classList.remove('is-waiting');
        stripText.textContent = res.reason ? escapeHtml(res.reason) : '';
      }
      return;
    }
    if (input.value.trim() === text) input.value = '';
    pendingChatId = null; pendingChatText = null;
    await refreshWorkspace();
    // On ok — trigger the adaptive poll loop so browser picks up agent response.
    loadStep();
  } catch (_) {
    if (strip) {
      strip.classList.remove('is-waiting');
      stripText.textContent = 'Message not sent. Your text is kept; retry when connected.';
    }
  } finally {
    chatSending = false;
    if (sendButton) sendButton.disabled = false;
  }
}

$('#chat-send') && $('#chat-send').addEventListener('click', sendChat);

$('#chat-input') && $('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

// Enable Adaptive button (PART D §10) — switch from standard note to adaptive input.
$('#enable-adaptive-btn') && $('#enable-adaptive-btn').addEventListener('click', async () => {
  try {
    const res = await postJSON('/api/mode', { drive: 'adaptive' });
    if (res.ok) {
      currentDrive = 'adaptive';
      updateChatRegion();
      // Re-initialize in adaptive mode.
      loadStep();
    }
  } catch (_) {
    // Non-fatal — user can retry.
  }
});

// ── walk rendering ────────────────────────────────────────────────────────────

function renderStep(step) {
  if (!step) return;
  if (step.action === 'done') return renderDone(step);
  if (step.action === 'infer') {
    // Engine inferred a dimension from the floor; advance silently.
    if (currentDrive === 'adaptive') {
      loadStep();
    } else {
      loadNextStep();
    }
    return;
  }
  if (step.action !== 'ask' || !step.decision) return;

  const d = step.decision;

  // Capture the live turn seq for this decision (adaptive mode); pick() echoes
  // it so the server can reject a stale pick. Standard steps carry no seq.
  currentSeq = step.seq;

  // Show decision pane, hide all others.
  showWalkScreen('decision');

  // Update chat region visibility for current drive mode.
  updateChatRegion();

  // ── Agent strip (adaptive mode) ──────────────────────────────────────────────
  const strip = $('#agent-strip');
  const stripText = $('#agent-strip-text');
  if (strip && stripText) {
    if (currentDrive === 'adaptive' && step.agent_reason) {
      // Show the agent's one-line reason for this decision choice.
      strip.hidden = false;
      strip.classList.add('is-reason');
      strip.classList.remove('is-waiting');
      stripText.textContent = 'Agent: ' + escapeHtml(step.agent_reason);
    } else if (currentDrive === 'adaptive') {
      // Adaptive but no reason supplied — show a quiet label.
      strip.hidden = false;
      strip.classList.add('is-reason');
      strip.classList.remove('is-waiting');
      stripText.textContent = 'Agent chose this decision';
    } else {
      // Standard mode — hide entirely.
      strip.hidden = true;
      strip.classList.remove('is-reason', 'is-waiting');
    }
  }

  // Tier label: prefer step.decision.ordering_tier_label, fall back to step.tier.
  const tierLabel = (d.ordering_tier_label) || (step.tier) || '';
  $('#tier-label').textContent = tierLabel;

  document.getElementById('decision-title').textContent = d.title;
  document.getElementById('decision-desc').textContent = d.description || '';
  document.getElementById('decision-note').textContent = d.cp_note || '';

  // Populate progressive-disclosure explainer (server-generated trusted HTML).
  // Emptied first so stale content never persists between decisions.
  const explainerSlot = document.getElementById('decision-explainer-slot');
  if (explainerSlot) setSanitizedHtml(explainerSlot, d.learn_more || '');

  renderOptions($('#options'), d, 'option');
  decided += 1;
  $('#progress').textContent = `decision ${decided}`;
}

// Build one decision's option cards into `wrap`. Shared by the decision pane
// and by the pending decision shown in place on the baseline screen, so both
// render identically and a pick behaves identically.
// `idPrefix` gives each card a stable id: focus styling is keyed per element.
function renderOptions(wrap, d, idPrefix) {
  if (!wrap || !d || !Array.isArray(d.options) || d.options.length === 0) return false;
  wrap.replaceChildren();
  d.options.forEach((opt, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.id = `${idPrefix}-${index}`;
    // Base class; add suggested modifier if agent hinted this option.
    card.className = 'option' + (opt.highlight ? ' option--suggested' : '');
    card.setAttribute('aria-label', `Pick ${opt.label}`);

    const pv = document.createElement('div');
    pv.className = 'option-previews';
    const hiPlatforms = new Set(opt.high_fi_platforms || []);
    // Render only the platforms actually present in this option's previews
    // (scoped mode de-scopes platforms — e.g. choosing iOS drops web/macos).
    // Rendering the hardcoded triple would emit empty labeled columns for
    // de-scoped platforms. Preserve the canonical web→ios→macos order.
    const presentPlatforms = ['web', 'ios', 'macos'].filter(
      (plat) => opt.previews && opt.previews[plat] != null,
    );
    for (const plat of presentPlatforms) {
      const cell = document.createElement('div');
      cell.className = 'pv';
      const isHi = hiPlatforms.has(plat);
      if (isHi) cell.classList.add('pv-high-fi');
      const label = document.createElement('div');
      label.className = 'pv-label';
      label.textContent = isHi ? `${plat} · high-fi` : plat;
      const frame = document.createElement('div');
      setSanitizedHtml(frame, (opt.previews && opt.previews[plat]) || '');
      cell.appendChild(label);
      cell.appendChild(frame);
      pv.appendChild(cell);
    }

    const meta = document.createElement('div');
    meta.className = 'option-meta';
    let metaHtml =
      `<div class="option-label">${escapeHtml(opt.label)}` +
      (opt.tag ? ` <span class="option-tag">${escapeHtml(opt.tag)}</span>` : '') +
      `</div>` +
      (opt.desc ? `<p class="option-desc">${escapeHtml(opt.desc)}</p>` : '');

    // Per-option annotate line ("why this fits") — only if agent provided it.
    // NEVER filters or hides options — all options always render.
    if (opt.annotate && String(opt.annotate).trim()) {
      metaHtml += `<p class="option-annotate">${escapeHtml(String(opt.annotate))}</p>`;
    }
    setSanitizedHtml(meta, metaHtml);

    card.appendChild(pv);
    card.appendChild(meta);
    card.addEventListener('click', () => pick(d.category_id, opt.id));
    wrap.appendChild(card);
  });
  return true;
}

async function pick(category, option) {
  // Echo the live turn seq (adaptive). If the decision was superseded by an
  // agent re-steer, the server returns {stale:true} and we re-poll instead of
  // applying a pick against the wrong decision.
  const body = { category, option };
  if (currentSeq !== undefined) body.seq = currentSeq;
  const res = await postJSON('/api/pick', body);

  if (res && res.stale) {
    // Decision is stale — the agent moved on. Re-poll for the current one.
    loadStep();
    return;
  }

  // Adaptive: /api/pick returns {phase:'await_agent'} with NO step.
  // Standard: /api/pick returns {step: ...}.
  if (res.step) {
    // Standard mode — next step already included.
    renderStep(res.step);
  } else {
    // Adaptive mode — hand back to agent; poll for next decision.
    loadStep();
  }
}

async function loadNextStep() {
  const step = await getJSON('/api/step');
  renderStep(step);
}

// ── done pane (PART B §6, PART C §8) ─────────────────────────────────────────

// Minimal JS deep-diff over a 2-level token map to detect delta presence.
// state.overrides and state.baseline are expected to be objects of objects.
function _hasDelta(state) {
  if (!state) return false;
  const ov = state.overrides || {};
  const base = state.baseline || {};
  for (const group of Object.keys(ov)) {
    const ovGroup = ov[group] || {};
    const baseGroup = base[group] || {};
    for (const key of Object.keys(ovGroup)) {
      if (ovGroup[key] !== baseGroup[key]) return true;
    }
  }
  return false;
}

async function renderDone(step) {
  _pollActive = false;
  // The walk is over. Clear every surface that still carries an answered
  // decision, so no path can re-submit one, and park Designer on its terminal
  // screen.
  $('#options').replaceChildren();
  document.querySelector('#baseline-screen .options')?.replaceChildren();
  currentSeq = undefined;
  currentWalkScreen = 'walk-complete';
  setDesignerRailNote(designerRailNote());
  // Completion is a navigation only for someone already watching Designer.
  // A user reading Saved work keeps their place; the rail tells them the walk
  // finished and Design output is one click away.
  if (currentDestination === 'designer') {
    currentDestination = 'output';
    showOnly('done');
  }
  $('#tier-label').textContent = '';
  // Design output stops being an empty destination once the walk produces one.
  $('#done-title').textContent = 'Your design is ready';
  $('#done-empty').hidden = true;
  $('#done-body').hidden = false;
  $('#done-reason').textContent = (step && step.reason) || 'Walk complete.';
  const md = await getJSON('/api/design-md');
  $('#design-md').textContent = (md && md.design_md) || '';

  // Reset status labels.
  const draftStatus = $('#draft-status');
  const promoteStatus = $('#promote-status');
  if (draftStatus) { draftStatus.hidden = true; draftStatus.textContent = ''; }
  if (promoteStatus) { promoteStatus.hidden = true; promoteStatus.textContent = ''; }

  // Determine delta presence to set Save-draft button state.
  const saveBtn = $('#save-draft-btn');
  try {
    const cur = await getJSON('/api/current');
    const hasDelta = _hasDelta(cur && cur.state);
    if (saveBtn) {
      if (hasDelta) {
        // Delta present — make save-draft a prominent btn-primary.
        saveBtn.className = 'btn-primary';
        saveBtn.removeAttribute('disabled');
        saveBtn.removeAttribute('title');
      } else {
        // No delta — keep muted btn-quiet with tooltip.
        saveBtn.className = 'btn-quiet';
        saveBtn.setAttribute('disabled', '');
        saveBtn.title = 'make a change to save a draft';
      }
    }
  } catch (_) {
    // Non-fatal — leave save-draft in its default muted state.
    if (saveBtn) {
      saveBtn.className = 'btn-quiet';
      saveBtn.setAttribute('disabled', '');
    }
  }

  // Load version history disclosure.
  loadVersionHistory();
}

async function loadVersionHistory() {
  const bodyEl = $('#version-history-body');
  if (!bodyEl) return;
  try {
    const res = await getJSON('/api/version/history');
    if (!res.ok) {
      setSanitizedHtml(bodyEl, '<p class="dex-what" style="color:var(--ink3)">Could not load history.</p>');
      return;
    }
    let html = '';
    if (res.current) {
      html += `<p class="dex-what"><strong>Current version:</strong> ${escapeHtml(res.current)}</p>`;
    } else {
      html += `<p class="dex-what" style="color:var(--ink3)">Not yet promoted.</p>`;
    }
    if (res.note) {
      html += `<p class="dex-does" style="color:var(--ink3)">${escapeHtml(res.note)}</p>`;
    }
    setSanitizedHtml(bodyEl, html);
  } catch (_) {
    setSanitizedHtml(bodyEl, '<p class="dex-what" style="color:var(--ink3)">Could not load history.</p>');
  }
}

$('#emit-btn') && $('#emit-btn').addEventListener('click', async () => {
  $('#emit-status').textContent = 'writing…';
  const res = await postJSON('/api/emit', {});
  if (res.written) {
    $('#emit-status').textContent = `wrote ${res.written.path} (${res.written.bytes} bytes)`;
  } else {
    $('#emit-status').textContent = 'error: ' + (res.error || 'unknown');
  }
});

// Save draft (PART B §6).
$('#save-draft-btn') && $('#save-draft-btn').addEventListener('click', async () => {
  const btn = $('#save-draft-btn');
  const status = $('#draft-status');
  if (btn.hasAttribute('disabled')) return;
  try {
    const res = await postJSON('/api/draft/save', {});
    if (status) {
      if (res.ok) {
        status.textContent = 'saved draft ' + escapeHtml(res.draft_id || '');
      } else {
        status.textContent = 'save failed: ' + escapeHtml(res.error || 'unknown');
      }
      status.hidden = false;
    }
  } catch (_) {
    if (status) { status.textContent = 'save request failed'; status.hidden = false; }
  }
});

// Promote to version (PART B §6).
$('#promote-btn') && $('#promote-btn').addEventListener('click', async () => {
  const status = $('#promote-status');
  try {
    const res = await postJSON('/api/draft/promote', {});
    if (status) {
      if (res.ok) {
        let msg = 'promoted v' + escapeHtml(String(res.version || '')) + ' → ' + escapeHtml(res.path || '');
        if (res.warning) {
          msg += ' — ' + escapeHtml(res.warning);
        }
        status.textContent = msg;
      } else {
        status.textContent = 'promote failed: ' + escapeHtml(res.error || 'unknown');
      }
      status.hidden = false;
    }
    // Refresh version history after promote.
    loadVersionHistory();
  } catch (_) {
    if (status) { status.textContent = 'promote request failed'; status.hidden = false; }
  }
});

async function continueFromBaseline(button) {
  button.setAttribute('disabled', '');
  try {
    const result = await postJSON('/api/baseline/continue', {});
    if (!result.ok) throw new Error(result.error || 'Could not continue');
    currentDrive = result.drive || currentDrive;
    if (currentDrive === 'adaptive') {
      loadStep();
    } else {
      const step = await getJSON('/api/step');
      renderStep(step);
    }
  } catch (_error) {
    button.removeAttribute('disabled');
  }
}

async function requestSetupChange(view, button) {
  button.setAttribute('disabled', '');
  try {
    const result = await postJSON('/api/baseline/change-setup', {});
    if (!result.confirmationRequired) return;
    view.showChangeConfirmation(result.message, async (confirmButton) => {
      confirmButton.setAttribute('disabled', '');
      const confirmed = await postJSON('/api/baseline/change-setup', { confirm: true });
      if (!confirmed.ok) {
        confirmButton.removeAttribute('disabled');
        return;
      }
      bootstrapSetupConfirmed = true;
      showWalkScreen('mode-screen');
      $('#ctx').textContent = 'Change app setup';
      const currentDriveOption = document.querySelector(`input[name="drive"][value="${currentDrive}"]`);
      if (currentDriveOption) currentDriveOption.checked = true;
    });
  } finally {
    button.removeAttribute('disabled');
  }
}

async function loadBaselineSnapshot(view) {
  try {
    const snapshot = await getJSON('/api/baseline/snapshot');
    if (!snapshot?.available || typeof snapshot.html !== 'string') return;
    view.showSnapshot(snapshot.label, (target) => setIsolatedMockup(target, snapshot.html));
  } catch (_) {
    // A missing or invalid local snapshot must not block review of the baseline.
  }
}

let baselineRetry = null;
async function sendBaselineComment(text) {
  const review = typeof reviewPreferences === 'function' ? reviewPreferences() : undefined;
  if (baselineRetry?.text !== text) baselineRetry = { text, id: crypto.randomUUID(), review };
  const result = await postJSON('/api/chat', baselineRetry);
  if (!result?.ok) {
    return { ok: false, message: result?.reason || 'Comment was not sent.' };
  }
  baselineRetry = null;
  refreshWorkspace();
  // Reuse the adaptive pending_chat handoff. The host sees the note on its next
  // contract poll. Keep this baseline visible while that work happens so the
  // user can keep reviewing the selected snapshot or send a correction.
  return { ok: true, message: 'Comment sent. Waiting for the connected designer.' };
}

async function bootPicker() {
  showWalkScreen('startup-screen');
  try {
    const session = await getJSON('/api/session');
    currentSession = session;
    renderWorkspaceSuggestions();
    bootstrappedSession = session.bootstrapped === true;
    currentDrive = session.drive || currentDrive;
    if (session.status === 'invalid') {
      showWalkScreen('baseline-screen');
      renderBootstrapError($('#baseline-screen'), session.error);
      return;
    }
    if (session.bootstrapped) {
      $('#ctx').textContent = `${session.product?.name || 'App'} · ${currentDrive === 'adaptive' ? 'Adaptive' : 'Standard'}`;
      if (session.route === 'next-unresolved') {
        if (currentDrive === 'adaptive') {
          loadStep();
        } else {
          const step = await getJSON('/api/step');
          renderStep(step);
        }
        return;
      }
      showWalkScreen('baseline-screen');
      $('#ctx').textContent = `${session.product?.name || 'App'} · ${currentDrive === 'adaptive' ? 'Adaptive' : 'Standard'}`;
      let view;
      view = renderBaselineView($('#baseline-screen'), session, {
        onContinue: continueFromBaseline,
        onChangeSetup: (button) => requestSetupChange(view, button),
        onComment: sendBaselineComment,
        renderPendingOptions: (wrap, pending) => {
          // Echo the live turn seq so a pick made here is checked against the
          // same stale-turn guard the decision pane uses.
          currentSeq = pending.seq;
          return renderOptions(wrap, pending.decision, 'pending-option');
        },
      });
      loadBaselineSnapshot(view);
      return;
    }

    // Manual (non-bootstrap) session with a walk already in progress — e.g.
    // a page reload, or a resumed walk after a server restart. Continue it
    // the same way the Start button does after /api/mode succeeds, WITHOUT
    // posting /api/mode again: that endpoint resets the walk, and this walk
    // is already the one to show.
    if (session.route === 'next-unresolved') {
      // GET /api/session never carries product paths — mode/target come
      // from GET /api/init instead, the same source the Start handler above
      // uses for its own header text.
      const init = await getJSON('/api/init');
      currentDrive = init.drive || currentDrive;
      if (init.mode === 'general') {
        $('#ctx').textContent = 'General design style' + (currentDrive === 'adaptive' ? ' · Adaptive' : '');
      } else {
        $('#ctx').textContent = 'Designing for: ' + (init.target || '');
      }
      if (currentDrive === 'adaptive') {
        loadStep();
      } else {
        renderStep(init.step);
      }
      return;
    }
  } catch (_error) {
    // A manual launch remains usable if the optional session endpoint fails.
  }
  showWalkScreen('intro');
  loadResumeDrafts();
}

bootPicker();

// Saved work remains available while the agent is thinking or after a reload.
let workspaceGeneration = 0;

function reviewPreferences() {
  return {
    suggestions: $('#workspace-suggestions')?.checked !== false,
    optionCount: Number($('#workspace-option-count')?.value || 3),
    layout: $('#workspace-review-layout')?.value === 'single' ? 'single' : 'compare',
    fidelity: $('#workspace-low-fi')?.checked === false ? 'polished' : 'low',
  };
}

function hydrateReviewControls(review = {}) {
  if (reviewHydrated) return;
  $('#workspace-suggestions').checked = review.suggestions !== false;
  $('#workspace-option-count').value = String(Math.min(5, Math.max(2, Number(review.optionCount) || 3)));
  $('#workspace-review-layout').value = review.layout === 'single' ? 'single' : 'compare';
  $('#workspace-low-fi').checked = review.fidelity !== 'polished';
  syncReviewControls();
  reviewHydrated = true;
}

function syncReviewControls() {
  $('#workspace-option-count').disabled = !$('#workspace-suggestions').checked;
}

async function persistReviewPreferences() {
  syncReviewControls();
  try {
    await postJSON('/api/workspace/review', reviewPreferences());
  } catch (_) {
    $('#workspace-status').textContent = 'Review choices were not saved. They still apply while this panel stays open.';
  }
}

for (const id of ['workspace-suggestions', 'workspace-option-count', 'workspace-review-layout', 'workspace-low-fi']) {
  $(`#${id}`)?.addEventListener('change', persistReviewPreferences);
}

function workspaceSuggestions(session = currentSession) {
  const product = session?.product?.name || 'the app';
  const suggestions = [];
  if (session?.requestedDelta) {
    suggestions.push({ kind: 'Input', provenance: 'Observed request', text: session.requestedDelta });
  }
  for (const surface of (session?.surfaces || []).slice(0, 2)) {
    const modes = (surface.interactionModes || []).join(', ');
    suggestions.push({
      kind: 'Input',
      provenance: surface.provenance === 'OBSERVED' ? 'Observed in app' : 'Current decision',
      text: `${surface.name || surface.platform || 'Existing'} surface${modes ? ` using ${modes}` : ''}`,
    });
  }
  const sources = [...new Set((session?.facts || []).map((fact) => fact.sourceRef).filter(Boolean))];
  if (sources.length) {
    suggestions.push({ kind: 'Input', provenance: 'Observed in code', text: `Preserve behavior evidenced by ${sources.slice(0, 2).join(' and ')}` });
  }
  suggestions.push(
    { kind: 'Output', provenance: 'Suggested', text: `A revised ${product} direction that preserves the observed app structure` },
    { kind: 'Output', provenance: 'Suggested', text: 'An implementation-ready visual handoff with behavior gaps called out' },
  );
  return suggestions.slice(0, 5);
}

function renderWorkspaceSuggestions() {
  const root = $('#workspace-suggestions-list');
  if (!root || suggestionsRendered) return;
  root.replaceChildren();
  for (const suggestion of workspaceSuggestions()) {
    const row = document.createElement('div'); row.className = 'suggestion-row';
    const kind = document.createElement('span'); kind.className = 'suggestion-kind'; kind.textContent = suggestion.kind;
    const copy = document.createElement('div'); copy.className = 'suggestion-copy';
    const input = document.createElement('input'); input.className = 'field-input'; input.value = suggestion.text; input.maxLength = 4000;
    input.setAttribute('aria-label', `Suggested ${suggestion.kind.toLowerCase()}`);
    const provenance = document.createElement('span'); provenance.className = 'suggestion-provenance'; provenance.textContent = suggestion.provenance;
    copy.append(input, provenance);
    const actions = document.createElement('div'); actions.className = 'suggestion-actions';
    const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'btn-quiet'; accept.textContent = 'Accept';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn-quiet'; remove.textContent = 'Remove';
    accept.addEventListener('click', async () => {
      const label = input.value.trim(); if (!label) return;
      const result = await postJSON('/api/workspace/source', { label, kind: `suggested-${suggestion.kind.toLowerCase()}` });
      if (result.ok) { row.remove(); $('#workspace-status').textContent = `${suggestion.kind} added to the next handoff.`; await refreshWorkspace(); }
    });
    remove.addEventListener('click', () => row.remove());
    actions.append(accept, remove); row.append(kind, copy, actions); root.append(row);
  }
  suggestionsRendered = true;
}

async function refreshWorkspace() {
  const generation = ++workspaceGeneration;
  const root = $('#workspace-alternatives');
  if (!root) return;
  try {
    const data = await getJSON('/api/workspace');
    if (generation !== workspaceGeneration) return;
    if (!data.ok) throw new Error(data.error || 'Workspace unavailable');
    hydrateReviewControls(data.review);
    renderWorkspaceSuggestions();
    root.replaceChildren();
    $('#workspace-empty').hidden = data.alternatives.length > 0;
    for (const alternative of data.alternatives) {
      const card = document.createElement('article'); card.className = 'workspace-card';
      const heading = document.createElement('h3'); heading.textContent = alternative.mockup.label || 'Design direction';
      const preview = document.createElement('div'); setIsolatedMockup(preview, alternative.mockup.html);
      const reason = document.createElement('p'); reason.textContent = alternative.rationale;
      const select = document.createElement('button'); select.className = 'btn-quiet';
      const selected = data.selectedId === alternative.id;
      select.textContent = selected ? 'Selected design' : 'Select this design';
      select.setAttribute('aria-pressed', String(selected));
      select.addEventListener('click', async () => {
        try {
          const result = await postJSON('/api/workspace/select', { id: alternative.id });
          if (!result.ok) throw new Error(result.error);
          await refreshWorkspace();
          $('#workspace-status').textContent = 'Selection saved. Refine it with a note or use the design packet.';
        } catch (error) { $('#workspace-status').textContent = error.message; }
      });
      card.append(heading, preview, reason, select); root.append(card);
    }
    const ledger = $('#workspace-ledger'); ledger.replaceChildren();
    for (const item of [...data.sources, ...data.notes]) {
      const row = document.createElement('li'); row.textContent = `${item.status}: ${item.label || item.text}`; ledger.append(row);
    }
    $('#workspace-export').hidden = !data.selectedId;
  } catch (error) { if (generation !== workspaceGeneration) return; $('#workspace-status').textContent = `Could not load saved work: ${error.message}`; }
}
$('#workspace-refresh')?.addEventListener('click', refreshWorkspace);
$('#workspace-source-save')?.addEventListener('click', async () => {
  const input = $('#workspace-source'); const label = input.value.trim(); if (!label) return;
  try {
    const result = await postJSON('/api/workspace/source', { label });
    if (!result.ok) throw new Error(result.error);
    if (input.value.trim() === label) input.value = '';
    $('#workspace-status').textContent = 'Context added to the next handoff.';
    await refreshWorkspace();
  } catch (error) { $('#workspace-status').textContent = `Source not saved: ${error.message}`; }
});
$('#workspace-refine')?.addEventListener('click', () => {
  const input = $('#workspace-refinement');
  const draft = input.value;
  if (chatSending || !draft.trim()) return;
  if ($('#chat-input').value.trim() && $('#chat-input').value !== draft) {
    $('#workspace-status').textContent = 'Send or clear your existing feedback draft first. Your refinement is kept.';
    return;
  }
  $('#chat-input').value = draft;
  if (currentDrive !== 'adaptive') {
    $('#workspace-status').textContent = 'Connect your coding agent to refine the selected design. Your note is kept.';
    return;
  }
  sendChat().then(() => {
    if (!$('#chat-input').value) { if (input.value === draft) input.value = ''; $('#workspace-status').textContent = 'Refinement received. Refresh saved work after the agent responds.'; }
    else $('#workspace-status').textContent = 'Refinement not sent; your note is kept. Retry when connected.';
  });
});
refreshWorkspace();
