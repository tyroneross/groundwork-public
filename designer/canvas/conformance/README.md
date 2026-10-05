# Canvas protocol conformance suite

Language-agnostic conformance harness for `groundwork.canvas.protocol/v1`
(`../PROTOCOL.md`). It boots ANY canvas server via a launch command you give
it, then asserts every rule in PROTOCOL.md §3–§7 over HTTP, SSE, and the
`.canvas/` control-dir filesystem — **it never reads server source**. A
server written in any language is conformant iff `run.py` passes against it.

Pure Python 3 stdlib. No pip installs, no network access beyond talking to
the server-under-test on `127.0.0.1`.

## Files

| File | Role |
|---|---|
| `run.py` | The runner. Boots the server in a temp canvas dir on a free port, runs every check, prints ok/FAIL per check + a summary, exits nonzero on any failure. |
| `checks.py` | The 23 individual protocol assertions (importable; each maps to a PROTOCOL.md section or schema file in a comment). |
| `mutations.py` | Deliberately breaks the reference server one rule at a time and proves `run.py` catches each break. |
| `README.md` | This file. |

## Running it

```bash
python3 run.py --server "node ../canvas-server.mjs"
```

`--server` is a launch command template (parsed with `shlex`). The runner
appends `--file <temp canvas.html> --dir <temp dir> --port <free port>
--title Conformance` to it — so pass just the interpreter + entrypoint, e.g.:

```bash
python3 run.py --server "node /abs/path/canvas-server.mjs"
python3 run.py --server "python3 /abs/path/alt_server.py"
python3 run.py --server "./my-canvas-server"
```

Flags:
- `--verbose` — print the server's captured stdout/stderr after the run.
- `--keep-temp` — don't delete the temp canvas dir (useful for debugging a failing check).

Exit code is `0` iff every check passed (SKIPs don't count against it).

## Mutation validation

```bash
python3 mutations.py
```

Per PROTOCOL.md §8: *"a new server implementation is 'conformant' iff the
suite passes AND the suite has been mutation-validated."* `mutations.py`
creates temp broken copies of the reference `canvas-server.mjs` — each
violating exactly one rule — and asserts `run.py` fails with the *expected*
check against each one:

| Mutation | Breaks | Expected catching check |
|---|---|---|
| `remove_toggle_mode_writeback` | §5.3 — toggle row must rewrite `mode.json` | `feedback_toggle_updates_mode` |
| `status_404_on_missing` | §3 — `/__canvas/status` MUST NOT 404 on missing file | `status_missing_returns_empty` |
| `bind_all_interfaces` | §3 — server MUST bind loopback only | `loopback_bind_refused` |
| `drop_hello_frame` | §4 — SSE connect MUST send a hello frame | `sse_retry_then_hello` |

If any mutation is *not* caught (suite exits 0, or the wrong check fails),
`mutations.py` itself exits nonzero and prints which mutation slipped
through. A suite that has never been proven to fail is untrusted — this is
the enforcement of that rule, not a formality.

`mutations.py` defaults to mutating `../canvas-server.mjs`; point it at a
different reference with `--server-source`.

## What each check covers

All 23 checks live in `checks.py::CHECKS`, run in this order:

1. **Launch contract** (§3) — `--file` pointing at a nonexistent path exits 2; startup prints a line containing `http://localhost:<port>`.
2. **Loopback bind** (§3) — the port is reachable on `127.0.0.1` but refused/unreachable from the machine's LAN-facing IP. If the sandbox has no non-loopback address (e.g. fully airgapped), this check **SKIPs with a NOTE** rather than failing — see "Known ambiguity" below.
3. **`GET /`** (§3) — 200, `text/html`.
4. **`GET /__canvas/file`** (§3) — verbatim canvas bytes (a seeded marker string is asserted present); unknown query params (`?t=123`) don't change the body.
5. **`GET /__canvas/status`** (§3, `schemas/status.schema.json`) — `{}` when absent; reflects a written object verbatim; satisfies the structural schema subset; 200 + valid JSON (never 404/500) when the file is corrupt.
6. **`GET /__canvas/mode`** (§3, `schemas/mode.schema.json`) — defaults to `{"mode":"live"}`; satisfies the structural schema subset.
7. **`POST /__canvas/feedback`** (§5) — 200 `{ok:true,id}`; a row is appended with server-stamped `ts`/`id` matching `fb-<epoch-ms>-<seq>`; unparsable JSON → 400; a `toggle` row updates `mode.json`; ids are unique across multiple posts.
8. **SSE `/__canvas/events`** (§4) — `retry:` then a `hello` frame on connect; a canvas edit fires `reload` within ~2s; a **same-size** canvas rewrite still fires `reload` (never compares by size); a `status.json` edit fires `status`.
9. **Static assets** (§3) — a sibling file serves with a correct MIME type; three path-traversal payloads (literal `..`, `%2f`-encoded, `%2e%2e`-encoded), sent over a raw socket so no HTTP client library pre-normalizes them, all return 403/404 and never leak a file outside `<dir>`.
10. **Schema validation** — a hand-rolled **structural** validator (required keys + types + enums only — see below) checks the served `status.json` and `mode.json` against the relevant schema file's required subset.

## Schema validator scope (honest disclosure)

`checks.py::struct_validate` is **not** a JSON Schema implementation — stdlib
has no `jsonschema` and this suite takes zero pip dependencies. It checks
only: required keys present, primitive type match (`number`/`integer`/
`boolean`/`string|null`/`object`), numeric bounds (`minimum`/`maximum`), and
enum membership. It does **not** validate `$ref`, `allOf`/`if`/`then`
conditionals (e.g. the feedback schema's `decide`/`toggle` conditional
requirements), nested object shapes (`fork.a`/`fork.b`), or `additionalProperties: false`.
Good enough to catch a server that omits a required field or sends the wrong
type; not a substitute for a real schema validator if you need full-draft
conformance.

## `--file` omission — found by this suite, now FIXED

This suite originally surfaced a reference-server deviation: PROTOCOL.md §3's
`--file (required, must exist → exit 2)` bundled two failure modes (flag
**omitted** vs. flag **pointing at a nonexistent path**), and the Node server
only satisfied the second — an omitted `--file` made `path.resolve('')` resolve
to `process.cwd()` (which exists as a directory), so the guard never fired and
the server booted treating cwd as the canvas (creating a stray `.canvas/`).

**Resolved (commit `0df08b5`):** `canvas-server.mjs` now guards the omitted-flag
case explicitly and also rejects a non-regular-file `--file`; PROTOCOL.md §3
spells out omitted|nonexistent|not-a-file → exit 2.

`launch_missing_file_exit2` still tests an explicit nonexistent path (the
portable, implementation-neutral form of the check); the omission case is
covered by the reference server's guard and validated in the acceptance run.

## Design notes

- **No pip deps.** HTTP requests, the SSE reader, and path-traversal probes
  are all hand-rolled over `socket`/`http.client`-free stdlib sockets — this
  also means no client library silently normalizes traversal payloads before
  they hit the wire.
- **Free-port probing.** `run.py` binds `:0`, reads the OS-assigned port,
  closes it, then hands that port to the server via `--port`. Race window is
  small and unavoidable without a `SO_REUSEPORT`-style handoff, which most
  target servers won't support anyway.
- **SSE never hangs the runner.** Every SSE read has an explicit timeout
  (2–3s); a server that doesn't fire an expected frame in time is a `FAIL`,
  not a hang.
- **Ordering matters.** Checks share one running server + one canvas dir, in
  a specific sequence (e.g. the "status missing → {}" check must run before
  anything else writes `status.json`). See the order in `checks.py::CHECKS`
  if you're adding a new check.
