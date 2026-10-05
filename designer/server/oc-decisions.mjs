// oc-decisions.mjs — fire-and-forget adapter that tells a local RossLabs
// Operations Center instance when a Groundwork Designer turn is waiting on the
// user, and when that wait resolves.
//
// OC may not be running (or may not exist yet — this adapter is written
// against a frozen HTTP contract before OC's server ships). Every call must
// therefore be safe to make blind: synchronous return, detached request,
// every rejection swallowed. Nothing in this module may throw or await in
// the caller's request path.
//
// Contract (RossLabs Operations Center .build-loop/plan.md, "C4" / "Frozen
// contract" / HTTP):
//   POST <endpoint>
//     register: {"action":"register","source":"groundwork-designer",
//                "key":"designer:<port>","title":...,"question":...,
//                "url":"http://127.0.0.1:<port>/","ttl_secs":21600}
//     resolve:  {"action":"resolve","source":"groundwork-designer",
//                "key":"designer:<port>"}
//   Content-Type: application/json

const MAX_QUESTION_LEN = 2000;
const MAX_TITLE_LEN = 160;

/**
 * @param {object} opts
 * @param {number} opts.port - the designer server's own port; used to build
 *   the idempotency key and the callback URL.
 * @param {string|(() => string)} [opts.productName] - SESSION_NAME; prefixes
 *   the title. SESSION_NAME can be reassigned after startup (bootstrap /
 *   mode import), so accept a zero-arg getter and resolve it at post time
 *   rather than capturing a stale string at construction.
 * @param {string} [opts.endpoint] - OC's decisions endpoint.
 * @param {boolean} [opts.enabled] - master on/off switch.
 * @param {typeof fetch} [opts.fetchImpl] - injectable for tests.
 * @param {number} [opts.timeoutMs] - abort the outbound request after this.
 * @param {number} [opts.ttlSecs] - decision TTL passed to OC on register.
 * @returns {{ awaitingUser: (turn: object) => void, resolved: () => void }}
 */
export function createDecisionReporter({
  port,
  productName = '',
  endpoint = process.env.OC_DECISIONS_URL || 'http://127.0.0.1:3766/api/decisions',
  enabled = process.env.OC_DECISIONS !== '0',
  fetchImpl = typeof fetch === 'function' ? fetch : undefined,
  timeoutMs = 1500,
  ttlSecs = 21600,
} = {}) {
  const key = `designer:${port}`;
  const callbackUrl = `http://127.0.0.1:${port}/`;

  function resolveProductName() {
    return typeof productName === 'function' ? productName() : productName;
  }

  // Dedupe state. `lastPostedSeq` is the turn.seq we last registered for;
  // `open` is true once a register has gone out and no resolve has followed.
  let lastPostedSeq = null;
  let open = false;

  function post(body) {
    if (!enabled || typeof fetchImpl !== 'function') return;
    let controller;
    let timer;
    try {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
    } catch {
      controller = undefined;
    }
    // Fire-and-forget: never awaited by the caller. Wrapping the fetchImpl
    // call itself inside the resolved promise means a synchronous throw from
    // a stub/mocked fetchImpl is also swallowed, not just a rejection.
    Promise.resolve()
      .then(() =>
        fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller ? controller.signal : undefined,
        }),
      )
      .catch(() => {
        // OC may not be running, may be unreachable, or may reject the
        // request outright — none of that is this adapter's problem.
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  }

  function titleFor(turn) {
    const name = resolveProductName();
    const prefix = name ? `${name}: ` : '';
    if (turn && turn.generated) {
      return `${prefix}Review the generated mockup`;
    }
    const decisionTitle = String((turn && turn.decision && turn.decision.title) || '').trim();
    if (!decisionTitle) return `${prefix}Design decision waiting`;
    const capped =
      decisionTitle.length > MAX_TITLE_LEN ? decisionTitle.slice(0, MAX_TITLE_LEN) : decisionTitle;
    return `${prefix}${capped}`;
  }

  function questionFor(turn) {
    let text = '';
    if (turn && turn.generated) {
      text = (turn.generated.agent_reason || '').trim();
    } else if (turn) {
      // The title already carries decision.title (C4 follow-up: every board
      // row must be distinguishable by title) — the question prefers the
      // decision's own description, then agentReason, so it adds context
      // instead of repeating the title.
      const description = (turn.decision && turn.decision.description) || '';
      text = String(description || turn.agentReason || '').trim();
    }
    if (!text) return undefined;
    return text.length > MAX_QUESTION_LEN ? text.slice(0, MAX_QUESTION_LEN) : text;
  }

  return {
    // Call once per turn transition into 'await_user'. Dedupes on turn.seq
    // so re-entrant callers (rehighlight/generate/ask all land here) never
    // double-post for the same turn.
    awaitingUser(turn) {
      if (!enabled) return;
      const seq = turn && turn.seq;
      if (seq === lastPostedSeq) return;
      lastPostedSeq = seq;
      open = true;
      post({
        action: 'register',
        source: 'groundwork-designer',
        key,
        title: titleFor(turn),
        question: questionFor(turn),
        url: callbackUrl,
        ttl_secs: ttlSecs,
      });
    },

    // Call when the turn leaves await_user (a pick lands, or the walk is
    // done). Only posts if a decision is actually open, so resolve() calls
    // that fire on every /api/pick don't spam OC when nothing was posted.
    resolved() {
      if (!enabled) return;
      if (!open) return;
      open = false;
      lastPostedSeq = null;
      post({ action: 'resolve', source: 'groundwork-designer', key });
    },
  };
}
