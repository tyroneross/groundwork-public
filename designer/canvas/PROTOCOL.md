# Groundwork Canvas Protocol — `groundwork.canvas.protocol/v1`

**Normative.** A conformant canvas server can be written in any language from
this file plus the JSON Schemas in `schemas/`. The `.canvas/` file contract —
not the server — is the substrate. This file is the contract the conformance
suite (`conformance/`) enforces.

Field shapes are defined by the schemas and are the source of truth:
- `schemas/status.schema.json` — `status.json`
- `schemas/feedback.schema.json` — one `feedback.jsonl` row
- `schemas/mode.schema.json` — `mode.json`

This file defines the **behavioral** contract (roles, endpoints, SSE, watch,
ordering, reliability). Where prose and schema overlap, the schema wins on
shapes, this file wins on behavior.

## 1. Roles — the single-writer rule

Three actors; **every file has exactly one writer**. This is what makes the
server a dumb, swappable relay — it never reasons and never interprets content.

| Actor | Writes | Reads |
|---|---|---|
| **Agent** (host LLM, between turns) | `<canvas>.html`, `status.json` | `feedback.jsonl` (new rows), `mode.json` |
| **Server** (relay only) | `feedback.jsonl` (append), `mode.json` | `<canvas>.html`, `status.json`, `mode.json` |
| **Browser** (rail + iframe) | nothing on disk — only `POST /__canvas/feedback` | HTTP endpoints only |

`mode.json` is **server-owned**: the agent and rail treat it read-only. A server
MUST NOT call the decision engine or otherwise interpret payloads (contrast the
sibling `designer-server.mjs`, which does — that is a different surface).

## 2. File layout

```
<dir>/                    # --dir; defaults to the canvas file's directory
  <canvas>.html           # the living mockup (--file); agent overwrites each turn
  <sibling assets>        # optional css/js/img the canvas references
  .canvas/                # control dir, created by the server on boot
    status.json           # agent -> browser (server relays)
    feedback.jsonl        # browser -> agent (server appends)
    mode.json             # server-owned Live/Hold
    cursor.json           # AGENT-OWNED read cursor (see §6) — server never writes
    session.json          # AGENT-PRIVATE engine state — NOT protocol
```

`session.json` is agent-private; the server and auditor MUST ignore it.
`cursor.json` is agent-owned. The server MAY read only its `last_id` for the
optional feedback review projection (§9); it MUST NOT advance or write the
cursor. The projection does not expose engine state.

## 3. HTTP endpoints — the conformance surface

Server MUST bind **loopback only** (`127.0.0.1`) — this is a local design tool,
never LAN-exposed.

| Method + path | Response | Notes |
|---|---|---|
| `GET /` | 200 `text/html` — rail + iframe shell | shell *content* is NON-normative; only its protocol behavior (§4–5, status rendering) is |
| `GET /__canvas/file` | 200, canvas HTML verbatim | iframe src; MUST ignore unknown query params (client cache-busts with `?t=`) |
| `GET /__canvas/status` | 200 `application/json` — `status.json` or `{}` | MUST NOT 404/500 on missing/corrupt file |
| `GET /__canvas/mode` | 200 `application/json` — `mode.json` or `{"mode":"live"}` | |
| `GET /__canvas/events` | SSE stream (§4) | unbounded clients; drop silently on write failure |
| `GET /__canvas/feedback` | 200 `{rows:[...], invalidRows:0, reviewedThroughId:null, reviewStatusAvailable:true}`; 500 on journal read failure | OPTIONAL, additive. Missing journal returns empty rows. Malformed rows are counted; valid rows remain visible. Read-only projection for refresh recovery |
| `POST /__canvas/feedback` | 200 `{"ok":true,"id":"<id>"}` / 400 bad JSON | §5; ≤1 MB body |
| `GET /__canvas/nav` | 200 `application/json` — `{title?, groups:[{label, items:[{label, url, hint?}]}]}` or `{}` | OPTIONAL, additive. Source: `--nav <file>`, else `canvas-nav.json` in `<dir>`, else in its parent. Read per request. Only `http(s)` URLs with a label are returned. The shell renders groups as left sections and their items as top views; Design/Pages/Screens supplies Canvas and Screen previews. The collapsible pane retains section destinations and draws an indigo frame around the window; `{}` means no pane |
| `POST /__canvas/preview` | 200 `{"ok":true}` / 400 bad request | §4a; relay-only, never persisted — NOT a `feedback.jsonl` row, does not touch `status.json` or the canvas file |
| `GET /<asset>` | 200 sibling asset / 404 / 403 on traversal | MIME: html,css,js,mjs,json,svg,png,jpg,jpeg,webp,gif,woff2; else `application/octet-stream`. Traversal guard: resolved path MUST stay within `<dir>` |

**Launch contract:** `--file <canvas.html>` (required — **omitted, nonexistent,
or not a regular file → exit 2**; do not fall back to cwd),
`--dir` (default: canvas file's dir), `--port` (default 8930; on EADDRINUSE
retry +1 up to +40), `--title`. Startup MUST print a line containing
`http://localhost:<port>` so the flow can `open` it.

## 4. SSE — `GET /__canvas/events`

- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`.
- On connect: send `retry: 1000` then a `hello` frame.
- All frames are default-event `data:` JSON lines (no `event:` field — clients
  use `onmessage` and dispatch on `type`).

| type | payload | trigger | client behavior |
|---|---|---|---|
| `hello` | `{"type":"hello"}` | connect | liveness only |
| `reload` | `{"type":"reload","mtime":<ms>}` | `<canvas>.html` mtime changed | reload iframe (unless Held → pending pill) |
| `status` | `{"type":"status","mtime":<ms>}` | `status.json` mtime changed | re-fetch `/__canvas/status`, re-render decide + meter |
| `feedback` | `{"type":"feedback"}` | optional journal or cursor checkpoint change | re-fetch `/__canvas/feedback` |
| `preview` | `{"type":"preview","component":"<name>","addClass":<string\|null>,"removeClass":<string\|null>}` | `POST /__canvas/preview` with a `component` | find `[data-component="<name>"]` in the iframe and toggle the class(es) |
| `preview-clear` | `{"type":"preview-clear"}` | `POST /__canvas/preview` with `{clear:true}` | undo the one active preview toggle, reverting to committed (on-disk) state |

**Watch (normative):** poll both files' mtime every **≤500 ms** and fire on
**inequality** (not ordering). A server MAY use native FS events but MUST
debounce to ≤1 event/file/interval and MUST still deliver `reload` for a
**same-size** rewrite (compare mtime or content hash, never size).

## 4a. `POST /__canvas/preview` — decision preview (relay-only)

Additive, v1-compatible surface for hovering/focusing a `fork.a`/`fork.b`
option in the rail (§ schemas/status.schema.json `forkOption.preview`) and
seeing its effect live on the spotlighted `[data-component]` element inside
the iframe, without leaving the rail.

Body: `{"component":"<data-component name>","addClass"?:"<class>","removeClass"?:"<class>"}`
to preview, or `{"clear":true}` to revert. The server does nothing but
re-broadcast the equivalent `preview` / `preview-clear` SSE frame (§4) — it
MUST NOT write `<canvas>.html`, `status.json`, or `feedback.jsonl` for this
endpoint. Committing a decision is unchanged: still `POST /__canvas/feedback
{kind:"decide",...}`. A canvas reload (file mtime change) always wins and is
itself the revert-to-truth — the committed state is whatever is on disk.

## 5. `POST /__canvas/feedback`

Body: one JSON object (see `schemas/feedback.schema.json`). Server MUST:
1. reject unparsable JSON with **400**;
2. cap body at **1 MB**;
3. for a `toggle` row, rewrite `mode.json` **before** appending;
4. stamp `ts` (ISO-8601) and a unique `id` (`fb-<epoch-ms>-<seq>`);
5. append exactly one line to `feedback.jsonl`;
6. respond `200 {"ok":true,"id":"<id>"}`.

v1 servers do NOT validate `kind` against the enum — any JSON is appended;
consumers tolerate unknown kinds by ignoring them. Per-kind agent routing is in
`references/iterate.md §5`.

## 5a. Per-element I/O annotations (display-only, additive)

Optional, non-destructive surfacing of an element's data contract (the Spec's
`ScreenElement.dataIn`/`dataOut`, per `references/mockups.md`/`iterate.md`'s
per-element I/O annotation guidance) as a small "in: … · out: …" chip appended
to the matching `[data-component]` element. Neither source is required; a
canvas with neither produces zero chips — identical DOM to before this feature
existed.

Two sources, either or both may be present; **inline attributes win** when
both are set on the same component:

1. **Inline attributes** — `data-datain` and/or `data-dataout` written
   directly onto a `[data-component]` element in the canvas HTML, e.g.
   `<button data-component="logRunButton" data-datain="user-entry" data-dataout="run started">`.
2. **`status.json.ioAnnotations`** — an optional top-level map, keyed by the
   same `data-component` name, each value `{"in"?: "<string>", "out"?: "<string>"}`
   (`schemas/status.schema.json` `ioAnnotations`/`ioAnnotation`), e.g.
   `{"logRunButton": {"in": "user-entry", "out": "run started"}}`.

The rail re-renders chips on every canvas load and on every `status.json`
poll; it never writes `<canvas>.html` or `status.json` for this — purely
visual, same direct-DOM technique as the decision preview (§4a). Gallery mode
(`references/mockups.md`, §schemas/manifest.schema.json) renders the same
inline-attribute source (source 1 only — gallery slots have no per-slot
`status.json`) on the full-view modal frame; the grid preview thumbnails are
too small to usefully show chips and do not render them.

## 6. Reliability contract (v1)

These make the loop trustworthy across long / compacted / restarted sessions.

- **Feedback cursor (agent-owned):** the agent tracks consumed rows in
  `.canvas/cursor.json` (`{"last_id": "<id>", "count": <n>}`) and dedups by the
  full `id` string. It MUST NOT rely on an in-memory offset (a compacted session
  would replay or skip). `id` embeds the server epoch-ms, so it stays unique
  across server restarts even though `<seq>` resets. See
  `designer/canvas/feedback_cursor.py`.
- **Atomic status writes (agent):** the agent writes `status.json` via
  write-temp-then-`rename` within `.canvas/` so a reader (server relay) never
  observes a half-written file. (`rename` is atomic on the same filesystem.)
- **`mode.json` rehydrate (rail):** the shell MUST fetch `/__canvas/mode` on
  load and reflect it in the Live/Hold toggle, so a browser refresh doesn't show
  stale state.

## 7. Versioning

- Protocol id: `groundwork.canvas.protocol/v1` (matches the
  `groundwork.decide.session/v1` convention).
- **Additive fields = same version.** Unknown-field tolerance is REQUIRED of all
  shells and consumers (already relied on by the rail). Absence of a `schema`
  field on `status.json` MEANS v1.
- Changed semantics or removed fields = version bump + a new conformance
  profile. Multi-canvas, concurrent raters, and remote pairing require a new
  protocol profile before they can claim conformance.

## 8. Conformance

`conformance/` boots a server via its launch command and asserts every rule
here. A new server implementation is "conformant" iff the suite passes AND the
suite has been mutation-validated (deliberately break the reference server;
confirm the suite catches it). No server ships on green-that-never-failed.
# Decision metadata badges

`status.json.decisionMeta` is an optional, display-only map keyed by decision or dimension. Each entry may provide `rigidity` (`open`, `leaning`, `locked`, `experimental`, or `superseded`), label, scope, and note. Absence preserves the current UI and no feedback POST or decision-engine input changes. Hosts render visible text and an accessible name; color alone cannot communicate the status.

## Workspace shell behavior (non-normative)

The iterate shell keeps the navigation, composer and saved decisions mounted
while page links change the preview iframe. Home restores the living canvas;
Back restores the previous preview. Same-port loopback aliases resolve to the
current origin. Cross-origin pages may be viewed, but browser origin rules can
prevent pinning or live preview. The home fork is shown only on its home canvas.

An option click previews a choice without writing feedback. **Apply choice**
appends the existing `decide` row with `dim` and option key `value`; the secondary
**Ask next question** retains the existing `next` request. Advanced preferences
use `lock`, `lean`, and `never`. Saved feedback says it awaits the agent;
a refreshed canvas does not prove that any particular feedback row was applied.
The optional `canvasUrl` and `canvasLabel` fields attach feedback to its preview.
An unsent draft keeps its original page attribution while the person browses.

Explicit Hold and unsent drafts defer file reloads even when the window gains
focus. The refresh control applies a pending preview without changing Hold.
Failed sends preserve the draft. Under 860px the canvas fills the workspace;
Pages and Feedback open collapsible panels. Data-source annotations are hidden
until the person enables **Inspect data sources**.

## 9. Workspace views and quick screen feedback (additive)

The iterate shell displays a current decision before the freeform composer.
Screen previews display only registered Design page URLs and the home canvas,
with script-disabled thumbnails and an explicit Open screen action. Browser
drafts retain the original canvas/component context across navigation and
reload. These presentation changes do not change host routing or the decision
engine. See [canvas workspace](../../references/canvas-workspace.md).

Quick ratings and notes append existing `comment` rows with optional metadata:
`source: "screen-preview"`, `reviewRating: "keep"|"revise"|"unsure"`,
`reviewNote`, `canvasUrl`, and `canvasLabel`. The text also carries the rating
and note so hosts that ignore metadata still receive actionable feedback.
These ratings are not `decide` events and do not create a ruling. A successful
POST establishes a saved journal row, never proof that an agent applied it.

The feedback projection MAY include `reviewedThroughId` and
`reviewStatusAvailable`. The checkpoint is the exact cursor `last_id`, only
when present in the current valid journal rows; absent or stale IDs return
null. A missing cursor means no rows reviewed. An unreadable or invalid cursor
sets availability false while preserving valid journal rows. Counts and
timestamps MUST NOT establish review. A checkpoint acknowledges host routing,
not implementation or application of a design change. Only the host commits it
after successful processing.

The optional SSE `feedback` frame signals journal or checkpoint changes. Clients
refresh the read-only projection and also refresh on reconnect. Screen cards
show the latest row per screen as “Saved · awaiting agent review” or “Reviewed
by agent”; a new save returns that screen to awaiting review. Unavailable
review evidence is shown explicitly. Browser drafts and focused notes retain
precedence during background reads.
