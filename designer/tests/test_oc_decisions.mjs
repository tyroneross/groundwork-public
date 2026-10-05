// test_oc_decisions.mjs — the Operations Center decision reporter (C4).
//
// The reporter is fire-and-forget: awaitingUser()/resolved() return
// synchronously and every network outcome (success, 4xx/5xx, connection
// refused, timeout) must be swallowed. These tests stub a real
// http.createServer on port 0 to capture the actual request bodies rather
// than mocking fetch, so the wire shape is asserted against real JSON
// parsing, not against what the adapter merely intends to send.
//
// Run: node --test designer/tests/test_oc_decisions.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createDecisionReporter } from '../server/oc-decisions.mjs';

// Starts a capturing stub OC. Returns { url, requests, close }.
function startStubOC() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      let json = null;
      try {
        json = buf ? JSON.parse(buf) : null;
      } catch {
        json = null;
      }
      requests.push({ method: req.method, contentType: req.headers['content-type'], json });
      res.writeHead(json && json.action === 'register' ? 201 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ decision: { id: 'stub' } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/api/decisions`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Poll until `requests` reaches `count` entries or the timeout elapses.
// Requests are fire-and-forget, so tests must wait for the detached fetch
// to actually land rather than asserting immediately after the call.
async function waitFor(requests, count, timeoutMs = 2000) {
  const start = Date.now();
  while (requests.length < count && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('awaitingUser posts a register body matching the frozen contract', async () => {
  const oc = await startStubOC();
  try {
    const reporter = createDecisionReporter({ port: 8900, productName: 'Acme UI', endpoint: oc.url });
    reporter.awaitingUser({
      seq: 3,
      decision: { title: 'Pick a nav pattern', description: 'Tabs or sidebar?' },
      agentReason: 'user has not chosen yet',
      generated: null,
    });
    await waitFor(oc.requests, 1);

    assert.equal(oc.requests.length, 1);
    const [{ method, contentType, json }] = oc.requests;
    assert.equal(method, 'POST');
    assert.equal(contentType, 'application/json');
    assert.deepEqual(json, {
      action: 'register',
      source: 'groundwork-designer',
      key: 'designer:8900',
      title: 'Acme UI: Pick a nav pattern',
      question: 'Tabs or sidebar?',
      url: 'http://127.0.0.1:8900/',
      ttl_secs: 21600,
    });
  } finally {
    await oc.close();
  }
});

test('a generated-mockup turn titles the review prompt distinctly', async () => {
  const oc = await startStubOC();
  try {
    const reporter = createDecisionReporter({ port: 8901, productName: 'Acme UI', endpoint: oc.url });
    reporter.awaitingUser({
      seq: 5,
      decision: null,
      generated: { mockup: {}, agent_reason: 'high-fidelity pass for the dashboard' },
    });
    await waitFor(oc.requests, 1);

    assert.equal(oc.requests.length, 1);
    assert.equal(oc.requests[0].json.title, 'Acme UI: Review the generated mockup');
    assert.equal(oc.requests[0].json.question, 'high-fidelity pass for the dashboard');
  } finally {
    await oc.close();
  }
});

test('a decision without a title falls back to the generic waiting title', async () => {
  const oc = await startStubOC();
  try {
    const reporter = createDecisionReporter({ port: 8908, productName: 'Acme UI', endpoint: oc.url });
    reporter.awaitingUser({ seq: 1, decision: null, agentReason: 'no decision chosen yet' });
    await waitFor(oc.requests, 1);
    assert.equal(oc.requests[0].json.title, 'Acme UI: Design decision waiting');
    assert.equal(oc.requests[0].json.question, 'no decision chosen yet');
  } finally {
    await oc.close();
  }
});

test('a long decision title is capped at 160 chars in the title', async () => {
  const oc = await startStubOC();
  try {
    const reporter = createDecisionReporter({ port: 8909, endpoint: oc.url });
    const longTitle = 'T'.repeat(200);
    reporter.awaitingUser({ seq: 1, decision: { title: `  ${longTitle}  ` } });
    await waitFor(oc.requests, 1);
    assert.equal(oc.requests[0].json.title, 'T'.repeat(160));
  } finally {
    await oc.close();
  }
});

test('question prefers decision.description over agentReason, never repeats the title', async () => {
  const oc = await startStubOC();
  try {
    const reporter = createDecisionReporter({ port: 8910, endpoint: oc.url });
    reporter.awaitingUser({
      seq: 1,
      decision: { title: 'Pick a nav pattern', description: 'Tabs or sidebar?' },
      agentReason: 'should not be used because description is present',
    });
    await waitFor(oc.requests, 1);
    assert.equal(oc.requests[0].json.title, 'Pick a nav pattern');
    assert.equal(oc.requests[0].json.question, 'Tabs or sidebar?');

    reporter.awaitingUser({
      seq: 2,
      decision: { title: 'Pick a layout' }, // no description
      agentReason: 'falls back to agentReason',
    });
    await waitFor(oc.requests, 2);
    assert.equal(oc.requests[1].json.title, 'Pick a layout');
    assert.equal(oc.requests[1].json.question, 'falls back to agentReason');
  } finally {
    await oc.close();
  }
});

test('a function-valued productName is re-resolved on every post (SESSION_NAME can change after startup)', async () => {
  const oc = await startStubOC();
  try {
    let name = 'Initial Name';
    const reporter = createDecisionReporter({ port: 8911, productName: () => name, endpoint: oc.url });

    reporter.awaitingUser({ seq: 1, decision: { title: 'Pick a nav pattern' } });
    await waitFor(oc.requests, 1);
    assert.equal(oc.requests[0].json.title, 'Initial Name: Pick a nav pattern');

    // Simulate SESSION_NAME being reassigned by a later bootstrap/mode import.
    name = 'Renamed Product';
    reporter.resolved();
    await waitFor(oc.requests, 2);

    reporter.awaitingUser({ seq: 2, decision: { title: 'Pick a layout' } });
    await waitFor(oc.requests, 3);
    assert.equal(oc.requests[2].json.title, 'Renamed Product: Pick a layout');
  } finally {
    await oc.close();
  }
});

test('awaitingUser dedupes on turn.seq — a repeated poll at the same seq sends nothing new', async () => {
  const oc = await startStubOC();
  try {
    const reporter = createDecisionReporter({ port: 8902, endpoint: oc.url });
    const turn = { seq: 1, decision: { title: 'A' } };
    reporter.awaitingUser(turn);
    reporter.awaitingUser(turn); // same seq — must not post again
    reporter.awaitingUser({ ...turn, seq: 1 }); // still seq 1 — must not post again
    await waitFor(oc.requests, 1);
    // Give any erroneous second post a chance to land before asserting count.
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(oc.requests.length, 1, 'only one register for a single seq');

    reporter.awaitingUser({ seq: 2, decision: { title: 'B' } });
    await waitFor(oc.requests, 2);
    assert.equal(oc.requests.length, 2, 'a new seq does post again');
  } finally {
    await oc.close();
  }
});

test('resolved() posts a resolve body after a register', async () => {
  const oc = await startStubOC();
  try {
    const reporter = createDecisionReporter({ port: 8903, endpoint: oc.url });
    reporter.awaitingUser({ seq: 1, decision: { title: 'A' } });
    await waitFor(oc.requests, 1);

    reporter.resolved();
    await waitFor(oc.requests, 2);

    assert.equal(oc.requests.length, 2);
    assert.deepEqual(oc.requests[1].json, {
      action: 'resolve',
      source: 'groundwork-designer',
      key: 'designer:8903',
    });
  } finally {
    await oc.close();
  }
});

test('resolved() sends nothing when no decision is open', async () => {
  const oc = await startStubOC();
  try {
    const reporter = createDecisionReporter({ port: 8904, endpoint: oc.url });
    reporter.resolved(); // nothing was ever registered
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(oc.requests.length, 0);

    // Register then resolve twice — the second resolve is a no-op.
    reporter.awaitingUser({ seq: 1, decision: { title: 'A' } });
    await waitFor(oc.requests, 1);
    reporter.resolved();
    await waitFor(oc.requests, 2);
    reporter.resolved();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(oc.requests.length, 2, 'a second resolve with nothing open must not post again');
  } finally {
    await oc.close();
  }
});

test('disabled reporter sends nothing for either call', async () => {
  const oc = await startStubOC();
  try {
    const reporter = createDecisionReporter({ port: 8905, endpoint: oc.url, enabled: false });
    reporter.awaitingUser({ seq: 1, decision: { title: 'A' } });
    reporter.resolved();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(oc.requests.length, 0);
  } finally {
    await oc.close();
  }
});

test('an unreachable endpoint (closed port) does not throw and resolves silently', async () => {
  // Bind to port 0 to get a free port, then close it immediately so nothing
  // is listening — connections to it should be refused synchronously by the
  // OS, exercising the reporter's swallow-everything path.
  const probe = http.createServer();
  const closedPort = await new Promise((resolve) => {
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

  const reporter = createDecisionReporter({
    port: 8906,
    endpoint: `http://127.0.0.1:${closedPort}/api/decisions`,
    timeoutMs: 300,
  });

  assert.doesNotThrow(() => reporter.awaitingUser({ seq: 1, decision: { title: 'A' } }));
  assert.doesNotThrow(() => reporter.resolved());

  // Let the detached, rejected fetches settle; an unhandled rejection here
  // would fail the test run via node:test's process-level guard.
  await new Promise((r) => setTimeout(r, 500));
});

test('question is trimmed and capped at 2000 chars', async () => {
  const oc = await startStubOC();
  try {
    const reporter = createDecisionReporter({ port: 8907, endpoint: oc.url });
    const long = 'x'.repeat(2500);
    reporter.awaitingUser({ seq: 1, decision: { description: `  ${long}  ` } });
    await waitFor(oc.requests, 1);
    assert.equal(oc.requests[0].json.question.length, 2000);
    assert.equal(oc.requests[0].json.question, 'x'.repeat(2000));
  } finally {
    await oc.close();
  }
});
