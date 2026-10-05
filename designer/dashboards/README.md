# Dashboard Builder

Archetype **A1 (decision surface)**: a contract describing a decision becomes an HTML
page that captures a response to a durable, agent-readable ledger — and can read it
back.

```bash
# 1. serve the sink (leave running)
python3 sink_service.py --ledger decisions.jsonl --port 3847

# 2. build a dashboard from a contract
python3 dashboard_build.py build examples/decision-canonical-home.json --out decision.html

# 3. open decision.html through that server, answer, reload -- the answer is still there
```

Constrained runtime with no socket bind (sandboxed agent, some local-model harnesses):

```bash
echo '{"method":"GET","path":"/events","query":{"contract_id":"x"}}' \
  | python3 sink_service.py --stdio --ledger decisions.jsonl
```

## Capture guarantees

A dashboard that captures responses requires a sink. Its health probe disables
submission while the sink is unavailable. The sink validates payloads and
deduplicates idempotency keys before appending responses to the local ledger.
A standalone page cannot provide an agent-readable durable ledger.

## Tests

```bash
python3 tests/run_acceptance.py
```

T1–T5 run on **both** transports, plus P1/P2. 10 checks. Non-zero exit on any failure.

## Limits

- ⚠️ **T4 is verified at the transport layer, not the DOM.** The ledger re-serves the
  stored response and the page's payload shape is verified against the sink, but no
  browser test confirms `loadPrior()` paints it. An IBR scan would close this.
- `/health` proves the sink answers; it does not prove a write will succeed.
- The service is intended for loopback use; health alone does not prove a response was saved.
- Only A1 exists. A2–A7 are unbuilt.
