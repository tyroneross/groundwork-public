---
name: iterate
description: Iterate on ONE living design canvas through an ongoing conversation — the user comments and decides in a side rail while the mockup evolves in place and the design converges. Use when the user wants to "iterate on the UI", "keep refining this", "talk through the design", "make it more dynamic", or work a single screen conversationally instead of picking from a static gallery. This is convergence-by-conversation; the mockups flow is divergence-by-gallery.
---

You (the host agent) drive a **decision-elicitation loop over a live canvas**. The
user does not fill in a questionnaire and does not rate a fixed set of frozen mockups. They
watch ONE mockup evolve and react to it, while a decision engine picks the
highest-impact question at each step and you render its answer directly on the
canvas. The goal is a confident design direction in the FEWEST interactions
(~7–12 cold, far fewer with a warm profile) — not an exhaustive interview.

Read this whole file before starting. The engine is deterministic and already
tested; your job is to route the user's freeform reactions into it and to author
the canvas. **The math decides which question; you phrase it and render it.**

Read `references/design-profiles.md` and
`skills/interface-designer/SKILL.md` before changing the canvas. Preserve the
selected profile qualities as hypotheses and change them when product evidence,
platform behavior, accessibility, or the user's keep/kill reasons justify it.

## 0. Why this is not the gallery

The `mockups` flow authors a deliberate set of divergent full-screen options and has the
user pick — good for **divergence** (cold-start breadth). Decision science flags
"present N options at once, rate them" as an anti-pattern: it doubles anchoring
bias and cognitive load, and it authors breadth a single hard constraint would
have deleted. This flow does **convergence**: prune the space with values +
vetoes FIRST, then refine one canvas by information-gain-ordered questions until
it converges. Use `mockups` to seed a starting direction when the space is
genuinely wide; use this to drive it home.

## 1. Resolve the canvas + the Spec

Set `SPEC`, `DESIGN_DIR`, `SLUG` exactly as the `mockups` flow does (§1 there).
Before selecting a canvas for an existing product, confirm that the Spec records
the baseline, current behavior, intended direction, and explicit delta. Do not
use a screenshot alone as the baseline or begin visual iteration while the
affected trigger, state, write boundary, failure, or confirmation remains
implicit.
Then choose the ONE canvas file to iterate:

- If `mockups/selection.json` exists, pin its winning `html_path` for the screen
  the user names (or the `primaryMode`'s screen) as the starting canvas.
- Else if the user names an existing screen/URL/file, pin that.
- Else author a fresh starting canvas from the Spec for the target screen, honest
  static prototype, following the same rules as `mockups` §3 (self-contained,
  `data-component` labels on each block, visible "Demo · static prototype" tag,
  no fake-data-as-real).

Copy the pinned file to `"$DESIGN_DIR/mockups/<screen>-canvas.html"` — this is the
**working canvas** you edit every turn. Never mutate the original mockup slots;
the canvas is its own file so divergence artifacts stay intact.

```bash
CANVAS="$DESIGN_DIR/mockups/<screen>-canvas.html"
```

### Data-I/O per element (follows `designIntent`)

As you edit `$CANVAS` each turn, keep the Spec's `ScreenElement.dataIn`/`dataOut` current for whatever element the turn touches — button, nav, search, field, link, info panel — so no element converges into a dead control. Depth follows the Spec's top-level `designIntent` (`iterate-ui` | `design-app` | `unspecified`): `iterate-ui` keeps it to `dataIn.source` only, never stalling the elicitation loop to collect `expectedType`; `design-app` captures descriptive `dataIn`/`dataOut` with `expectedType`, wired into the corresponding top-level `dataModel[]` entity. Either depth: Groundwork identifies what data is needed where and points build-loop at the wiring — it is not the data-flow source of truth. Rendering the contract on the live canvas is a separate track; this flow's job is keeping the Spec's element data current as decisions lock. To surface the real contract as an io-chip on the canvas (`designer/canvas/PROTOCOL.md §5a`), mirror each touched element's `dataIn.source`/`dataOut` onto its `[data-component]` node as `data-datain`/`data-dataout` attributes in `$CANVAS`, or into `status.json`'s `ioAnnotations[component]` map — either source is display-only and non-destructive.

## 2. Classify the decision TYPE (sets your posture)

Tag the request by epistemic goal — this chooses HOW you guide, not a script:

| Type | User is asking | Posture |
|---|---|---|
| `descriptive` | "understand / capture what this screen is" | Observe + reflect current state; confirm before changing. |
| `diagnostic` | "why does this feel off" | Isolate the offending dimension first, then fix that one. |
| `choice` | "which direction should this go" (default UI) | Values → veto → info-gain-ordered A/B. |
| `policy` | "keep refining as we discuss the app" | Same loop, but re-open dimensions as the product definition shifts. |

Most "iterate on the UI" requests are `choice` chaining into `policy`.

Decisions with a visual referent (layout, component, screen structure) default to the canvas surface; use a terminal question only for a non-visual structural fork, and say why.

## 3. Seed the elicitation session (values + veto + profile)

Build the dimension set from the design catalog (leverage-weighted importance),
create the session, then WARM-START it from the cross-session taste profile so
you only ask about what is new for this product:

```bash
STATE="$DESIGN_DIR/mockups/.canvas/session.json"
mkdir -p "$DESIGN_DIR/mockups/.canvas"
DIMS=$(PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 - <<'PY'
from designer.engine.catalog._deltas import CATEGORY_DIMENSION
from collections import Counter
import json
lev = Counter(CATEGORY_DIMENSION.values())
print(json.dumps({d: min(1.0, 0.5 + 0.1*n) for d, n in lev.items()}))
PY
)
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.decide.elicit init \
  --goal "<the VALUES answer, in the user's words: what this screen is FOR>" \
  --type choice --dimensions "$DIMS" --out "$STATE"
# layer 6 — compound across prior designs (fewer questions each run):
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.decide.profile seed --state "$STATE"
```

Then run the two cheap cuts BEFORE authoring anything expensive:

- **VALUES (1–2 open questions, phrased for this product):** ask what outcome
  matters — *not* which option. Prune dimensions the goal makes irrelevant:
  `elicit prune --state "$STATE" --dims motion.intensity,elevation.style` (e.g. an
  internal data tool doesn't need brand-expression dimensions).
- **VETO (ask the hardest dealbreaker FIRST):** one hard constraint removes
  80–95% of the space with no comparison. Record each:
  `elicit veto --state "$STATE" --dim platform.target --value web --reason "ships as a web SPA"`.

Publish the first status so the rail can render it (see §5's `status.json`).

## 4. Launch the canvas surface

Start Groundwork's own live canvas server (it does NOT fork mockup-gallery) and
open it. The rail leads with the comment box ("Tell Groundwork what to change",
with a hint to click any part of the design to pin the note), then the current
decision with its lock/lean/never chips, then a one-line convergence meter whose
per-decision badges fold behind a count. The canvas iframe hot-reloads when you
edit it.

**Turn off the mockup's own annotation layer inside the canvas.** The rail is
where feedback and change notes live. If the mockup ships numbered markers, a
"show changes" overlay, a change list, or a "design preview" banner, hide them
for the canvas run (for example a `?canvas=1` flag or a class the canvas file
sets on `<body>`), so the user sees one place to comment instead of two
competing ones. Keep `data-component` attributes: they are what makes a block
pinnable.

```bash
PORT=8930; while lsof -ti:$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
node "${CLAUDE_PLUGIN_ROOT}/designer/canvas/canvas-server.mjs" \
  --file "$CANVAS" --title "<product · screen>" --port $PORT \
  > /tmp/gw-canvas.log 2>&1 &
sleep 1
open "http://localhost:$PORT"
```

Tell the user in one or two lines: **"This canvas is live — comment on it, or use
the chips: *Lock it* commits a decision, *Lean this way* nudges, *Never do X* sets
a hard rule. Click any part of the design to pin a comment to it. Toggle *Hold* when you
want the canvas to stop moving while you study it."**

## 5. The turn loop (this is the real work)

Each turn, drain the user's feedback, feed the engine, publish status, and edit
the canvas. The two control files the server relays:

- **you WRITE** `"$DESIGN_DIR/mockups/.canvas/status.json"` — the rail renders it.
- **you READ** `"$DESIGN_DIR/mockups/.canvas/feedback.jsonl"` — new lines are the
  user's comments/decisions/toggles since last turn.

**Reliability contract (PROTOCOL.md §6) — this is NOT optional plumbing.** A
long/compacted/restarted session loses in-memory state, so both the read
cursor and the status write MUST go through `feedback_cursor.py`, never an
in-memory offset or a plain `open(...).write()`:

```bash
CDIR="$DESIGN_DIR/mockups"   # the canvas dir (parent of .canvas/)

# 1. drain — reads unconsumed rows only, deduped by full `id` string (NOT
#    <seq>, which resets on server restart). Idempotent: safe to call again
#    if the turn is interrupted before commit.
NEW=$(PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 \
  "${CLAUDE_PLUGIN_ROOT}/designer/canvas/feedback_cursor.py" read-new --dir "$CDIR")

# ... route each row into the engine per the table below ...

# 2. commit — ONLY after the engine calls above have succeeded. Advances the
#    on-disk cursor atomically; if the turn dies before this line, the next
#    turn's read-new naturally replays the same rows (never silently skips).
LAST_ID=$(echo "$NEW" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r[-1]["id"] if r else "")')
COUNT=$(echo "$NEW" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
[ -n "$LAST_ID" ] && PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 \
  "${CLAUDE_PLUGIN_ROOT}/designer/canvas/feedback_cursor.py" commit \
  --dir "$CDIR" --last-id "$LAST_ID" --count "$COUNT"
```

Per new feedback row, route by `kind` into the engine:

| Row `kind` | Meaning | Engine call |
|---|---|---|
| `never` | hard constraint | `elicit veto --dim <inferred> --value <inferred> --reason <text>` |
| `lock` | commit this dimension | `elicit answer --dim <inferred> --value <inferred> --decided --rating 5` |
| `lean` | a nudge, not a commitment | `elicit answer --dim <inferred> --value <inferred>` |
| `decide` | picked A or B on a fork | `elicit answer --dim <row.dim> --value <A|B value> --decided` |
| `comment` | freeform reaction | extract the dimension + direction, then `lean` or `lock` as fitted; if it's a bug/taste note with no dimension, just apply it to the canvas |
| `toggle` | Live/Hold | no engine call — respect it: on Hold, still process feedback but expect the user to be studying |

At the same successful turn boundary, persist the corresponding ADR rigidity
and publish `status.json.decisionMeta`: ordinary unresolved questions are
`open`, `lean` is `leaning`, `lock`/decided is `locked`, a parallel exploration
is `experimental`, and a replaced decision is `superseded`. The rail badge is a
projection of the Spec decision, not a second authority. Use `Boundaries.never`
for hard prohibitions; rigidity does not replace a safety boundary.

**Color decisions run through the relationships engine, not hand-picked hex.**
When a decision touches color (surface/accent/contrast/mood), express it as a
change to the relationship vector and regenerate — never paste a swatch:
`python3 -m designer.color.combos validate --params '{...}'` to check it meets
contrast, then apply the generated `roles` to the canvas. Critique any imported
color with `designer.color.relationships.suggest_improvements`.

You are the feature-extractor: read the freeform `text` (and `component` pin) and
decide which token dimension it touches and which value it implies. When unsure,
ask ONE clarifying question phrased as a concrete choice — never an open
interview.

After the engine calls, get the next state and publish it + render it. Pipe
through `write-status` (not a shell `>` redirect) so the write is atomic
(temp-then-`os.replace` inside `.canvas/`) — the server relay must never read
a half-written `status.json` mid-write:

```bash
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.decide.elicit status --state "$STATE" \
  | PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 \
    "${CLAUDE_PLUGIN_ROOT}/designer/canvas/feedback_cursor.py" write-status --dir "$CDIR" --file -
```

Read that status:
- Edit `"$CANVAS"` to reflect every locked/leaned decision so far — the server
  live-reloads the iframe (scroll preserved). Each edit should make the *current
  question's* answer visible, so the user reacts to a concrete thing.
- If `next_question` is a genuine fork, offer a **pairwise A/B** (never 4-up): add
  a `fork` object to `status.json` before writing it —
  `{"dim":"spacing.density","question":"Denser rows or more room to breathe?","a":{"label":"Dense","sub":"more per screen"},"b":{"label":"Airy","sub":"calmer, fewer rows"}}` —
  and author both states so clicking A or B swaps the canvas.
- Narrate one line in chat per decision so the user can veto in words too.

Repeat. Because the engine seeds from the profile and prunes with vetoes, the
`next_question` is always the highest-remaining-impact one — never busywork.

## 6. Stop when it converges (do not over-ask)

Each turn, check `status.json`'s `ready`. When `ready: true` (uncertainty over the
ranking is low, or the surviving set is exhausted, or the round cap hit), STOP
asking and tell the user the direction has converged, summarizing what's locked.
Do not keep generating questions past convergence — the point is speed. The rail's
meter shows the same thing (decisions recorded · confidence %) and its badges
distinguish the rigidity of each recorded decision.

## 7. Fold the result + compound the profile

When converged (or the user says "good"):

```bash
# 1. cross-session profile: this run's taste compounds -> fewer questions next time
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.decide.profile record --state "$STATE"

# 2. record the winning direction like the mockups flow (seed for explore-ui)
#    write "$DESIGN_DIR/mockups/selection.json" per mockups §5, folding the
#    canvas's converged decisions into perScreen[].note + rationale.

# 3. refresh the self-contained builder handoff against the converged canvas
node "${CLAUDE_PLUGIN_ROOT}/engine/dist/cli.js" "$SPEC" --out "$DESIGN_DIR"
```

The converged canvas HTML is the winning artifact; embed it (or its path) in
`selection.json` so the explore-ui token walk and the builder handoff both start
from the direction the user actually endorsed, decision by decision.

## 8. Report

Give the user:
- The canvas file and how it converged (decisions locked, confidence, # of
  interactions — contrast with the ~one-per-dimension a fixed interview needs).
- What the profile learned (which dimensions are now settled taste vs still
  product-specific), so they know why the next run will be faster.
- The exact next step: run explore-ui/design-system for this slug to drive the
  token walk seeded by the converged direction, or hand off to Build Loop.

## Evidence-backed design guidance

Use the profile registry as a comparison set, not a gate. Preserve universal
constraints across every iteration: truthful state, coherent hierarchy,
recovery, accessibility, responsive behavior, content fit, and perceivable
feedback. For each recommendation, name the user or product constraint it
serves. A divergence from Calm Precision or any other profile is valid when the
context supports it and remains testable.
