const PLATFORM_LABELS = {
  macos: 'macOS',
  ios: 'iOS',
  web: 'Web',
  android: 'Android',
  windows: 'Windows',
};

function humanize(value) {
  const labels = {
    'platform-target': 'Platform target',
    'platform-macos': 'macOS',
    'platform-ios': 'iOS',
    'platform-web': 'Web',
    'nav-structure': 'Navigation structure',
    'nav-structure-left': 'Left navigation',
  };
  if (labels[value]) return labels[value];
  return String(value || '')
    .replace(/^platform-/, '')
    .replace(/^nav-structure-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

export function topologyLabel(surfaces = []) {
  return surfaces.map((surface) => {
    const platform = PLATFORM_LABELS[surface.platform] || humanize(surface.platform);
    return `${platform} (${humanize(surface.role)})`;
  }).join(' + ');
}

export function factStatus(fact) {
  if (fact.status === 'changed' || fact.provenance === 'DECIDED') return 'You changed this';
  if (fact.provenance === 'OBSERVED') return 'Observed current';
  return 'Needs confirmation';
}

export function continueLabel() {
  return 'Continue';
}

export function renderBootstrapError(root, error) {
  root.replaceChildren();
  const head = el('div', 'decision-head');
  head.append(
    el('p', 'baseline-kicker', 'Baseline unavailable'),
    el('h1', 'decision-title', 'Groundwork could not open this app baseline'),
    el('p', 'decision-desc', error?.message || 'The visual bootstrap is invalid or unavailable.'),
    el('p', 'decision-note', error?.recovery || 'Regenerate the bootstrap and relaunch Groundwork.'),
  );
  const status = el('p', 'baseline-error-detail', error?.detail || 'No design state was changed.');
  status.setAttribute('role', 'alert');
  root.append(head, status);
}

/**
 * Reading order is deliberately short: context → one decision → one action.
 * Source material stays available in a disclosure instead of competing with
 * the decision.
 */
export function renderBaselineView(root, session, handlers = {}) {
  root.replaceChildren();

  const head = el('div', 'decision-head');
  const productName = session.product?.name || 'this app';
  const surfaces = topologyLabel(session.surfaces);
  head.append(
    el('p', 'baseline-kicker', surfaces ? `${productName} · ${surfaces}` : productName),
    el('h1', 'decision-title', `Continue with ${productName}?`),
    el('p', 'decision-desc', 'Use the observed app as the starting point.'),
  );
  root.append(head);

  // ── the one primary action, directly under the headline ───────────────────
  const actions = el('div', 'baseline-actions');
  const continueButton = el('button', 'btn-primary', continueLabel(session));
  continueButton.type = 'button';
  continueButton.id = 'baseline-continue';
  continueButton.addEventListener('click', () => handlers.onContinue?.(continueButton));
  const changeButton = el('button', 'btn-quiet', 'Edit setup');
  changeButton.type = 'button';
  changeButton.id = 'baseline-change-setup';
  changeButton.addEventListener('click', () => handlers.onChangeSetup?.(changeButton));
  actions.append(continueButton, changeButton);
  root.append(actions);

  const nextTitle = session?.pendingDecision?.title || session?.nextDecision?.title;
  if (nextTitle) root.append(el('p', 'baseline-next-label', `Next: ${nextTitle}`));

  const changeConfirm = el('div', 'baseline-change-confirm');
  changeConfirm.hidden = true;
  changeConfirm.setAttribute('aria-live', 'polite');
  root.append(changeConfirm);

  // ── loaded context, available on demand ──────────────────────────────────
  const context = el('details', 'baseline-context');
  context.append(el('summary', 'baseline-context-summary', 'Review loaded context'));
  const contextBody = el('div', 'baseline-context-body');

  const topology = el('p', 'baseline-topology');
  topology.append(el('span', 'baseline-label', 'Product topology'));
  topology.append(document.createTextNode(surfaces));
  contextBody.append(topology);

  if (session.requestedDelta) {
    const delta = el('div', 'baseline-context-section');
    delta.append(
      el('span', 'baseline-row-label', 'Requested change'),
      el('p', 'baseline-context-copy', session.requestedDelta),
    );
    contextBody.append(delta);
  }

  const summary = el('div', 'baseline-summary');
  summary.setAttribute('aria-label', 'Current design baseline');

  const baseline = session.designBaseline || {};
  const baselineRows = [
    ['Token set', baseline.tokenSetId],
    ['Selected mockup', baseline.selectedMockupId],
  ].filter(([, value]) => value);

  for (const [label, value] of baselineRows) {
    const row = el('div', 'baseline-row');
    const copy = el('div', 'baseline-row-copy');
    copy.append(el('span', 'baseline-row-label', label), el('span', 'baseline-row-value', value));
    row.append(copy, el('span', 'baseline-status', 'Observed current'));
    summary.append(row);
  }

  for (const fact of session.facts || []) {
    const row = el('div', 'baseline-row');
    const copy = el('div', 'baseline-row-copy');
    const label = fact.categoryLabel || humanize(fact.categoryId);
    const value = fact.optionLabel || humanize(fact.currentOptionId || fact.observedOptionId);
    copy.append(el('span', 'baseline-row-label', label), el('span', 'baseline-row-value', value));
    row.append(copy, el('span', 'baseline-status', factStatus(fact)));
    summary.append(row);
  }
  contextBody.append(summary);

  if (baseline.seed) {
    const seedBlock = el('div', 'baseline-seed');
    seedBlock.append(el('span', 'baseline-row-label', 'Design direction · observed'));
    const seedText = el('p', 'baseline-seed-text', baseline.seed);
    seedBlock.append(seedText);
    contextBody.append(seedBlock);
  }

  if (baseline.rationale) {
    contextBody.append(el('p', 'baseline-rationale', baseline.rationale));
  }

  // ── the pending decision, in place ────────────────────────────────────────
  // When the host has already posted a decision, its options belong here: a
  // reader who accepts the baseline should be able to pick without first
  // clicking through to another screen.
  const pending = el('section', 'baseline-pending');
  pending.hidden = true;
  pending.setAttribute('aria-label', 'Next decision');
  const pendingOptions = el('div', 'options');
  if (session.pendingDecision) {
    pending.append(
      el('h2', 'baseline-pending-title', session.pendingDecision.title || 'Next decision'),
      el('p', 'baseline-pending-desc', session.pendingDecision.description
        || 'Pick an option to answer this now, or continue to review it on its own screen.'),
      pendingOptions,
    );
    const rendered = handlers.renderPendingOptions?.(pendingOptions, session.pendingDecision);
    pending.hidden = rendered === false;
  }
  root.append(pending);

  const snapshot = el('details', 'baseline-snapshot');
  snapshot.hidden = true;
  snapshot.append(el('summary', 'baseline-snapshot-summary', 'Selected design snapshot'));
  const snapshotFrame = el('div', 'baseline-snapshot-frame');
  const snapshotLabel = el('p', 'baseline-snapshot-label');
  snapshot.append(snapshotFrame, snapshotLabel);
  root.append(snapshot);

  if ((session.warnings || []).length) {
    const warnings = el('div', 'baseline-warnings');
    warnings.setAttribute('role', 'status');
    warnings.append(el('p', 'baseline-warning-title', 'Review before continuing'));
    for (const warning of session.warnings) warnings.append(el('p', 'baseline-warning', warning));
    root.append(warnings);
  }

  const evidence = el('details', 'baseline-evidence');
  evidence.append(el('summary', 'baseline-evidence-summary', 'Evidence and provenance'));
  const evidenceBody = el('div', 'baseline-evidence-body');
  for (const fact of session.facts || []) {
    const item = el('div', 'baseline-evidence-item');
    const source = fact.sourceRef ? ` · ${fact.sourceRef}` : '';
    const confidence = Number.isFinite(fact.confidence) ? ` · ${Math.round(fact.confidence * 100)}% confidence` : '';
    item.append(
      el('span', 'baseline-evidence-name', fact.categoryLabel || humanize(fact.categoryId)),
      el('span', 'baseline-evidence-meta', `${fact.provenance || 'UNKNOWN'}${source}${confidence}`),
    );
    evidenceBody.append(item);
  }
  if (!evidenceBody.childElementCount) {
    evidenceBody.append(el('p', 'decision-note', 'No source evidence was included in this bootstrap.'));
  }
  evidence.append(evidenceBody);
  contextBody.append(evidence);
  context.append(contextBody);
  root.append(context);

  // ── a quiet place to comment ──────────────────────────────────────────────
  // Sending a comment is a side channel, not the next step, so it carries quiet
  // weight. Two primary-styled buttons on one screen hide the real action.
  const comment = el('details', 'baseline-comment');
  comment.setAttribute('aria-label', 'Comment for the designer');
  comment.append(el('summary', 'baseline-comment-summary', 'Add a comment'));
  const commentBody = el('div', 'baseline-comment-body');
  const commentInput = el('textarea', 'field-input baseline-comment-input');
  commentInput.rows = 3;
  commentInput.placeholder = 'Example: Keep the guided flow, but show how a midday replan would work.';
  commentInput.setAttribute('aria-label', 'Comment text');
  const commentActions = el('div', 'baseline-comment-actions');
  const commentButton = el('button', 'btn-quiet baseline-comment-send', 'Send comment');
  commentButton.type = 'button';
  commentButton.id = 'baseline-comment-send';
  const commentStatus = el('span', 'baseline-comment-status');
  commentStatus.setAttribute('aria-live', 'polite');
  async function sendComment() {
    const text = commentInput.value.trim();
    if (!text || commentButton.disabled) return;
    commentButton.disabled = true;
    commentStatus.textContent = 'Sending…';
    try {
      const result = await handlers.onComment?.(text);
      if (result?.ok === false) throw new Error(result.message || 'Comment was not sent.');
      if (commentInput.value.trim() === text) commentInput.value = '';
      commentStatus.textContent = result?.message || 'Comment sent.';
    } catch (error) {
      commentStatus.textContent = error?.message || 'Comment was not sent.';
    } finally {
      commentButton.disabled = false;
    }
  }
  commentButton.addEventListener('click', sendComment);
  commentInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendComment();
    }
  });
  commentActions.append(commentButton, commentStatus);
  commentBody.append(commentInput, commentActions);
  comment.append(commentBody);
  root.append(comment);

  return {
    showSnapshot(label, render) {
      render?.(snapshotFrame);
      snapshotLabel.textContent = label || 'Current selected direction';
      snapshot.hidden = false;
      snapshot.open = false;
    },
    showChangeConfirmation(message, onConfirm) {
      changeConfirm.replaceChildren();
      changeConfirm.append(el('p', 'decision-note', message));
      const confirm = el('button', 'btn-quiet', 'Open setup');
      confirm.type = 'button';
      confirm.id = 'baseline-open-setup';
      confirm.addEventListener('click', () => onConfirm?.(confirm));
      changeConfirm.append(confirm);
      changeConfirm.hidden = false;
      confirm.focus();
    },
  };
}
