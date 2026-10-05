---
name: explore-ui
description: Launch the visual browser picker so the user can discover, capture, or evolve UI preferences through concrete choices. Use for a new idea, an existing app or URL, a known design system, "keep this but improve it", design direction, or design tokens. Default to the browser picker, with chat as the reasoning and fallback layer.
---

You drive the **Designer** — a revealed-preference engine that helps the user
NARROW contextual product preferences by clicking between concrete visual
options in the browser. Read `references/design-profiles.md` and
`skills/interface-designer/SKILL.md` first. This is guidance, not an open-ended
interview: the engine shows real option previews, the user picks, and it
converges to a design-token system. **Default to the visual browser picker.**
Only fall back to driving it yourself (headless) if a browser truly isn't
available. A result is evidence about this product and context, not proof that
one style should govern every product.

## 0. Start from the strongest available signal

Do not make a user rediscover preferences that already exist. Resolve the
starting signal in this order, then use the resolver below so every command has
an explicit stage, context, source, and owned output path:

1. **Existing design system:** use `DESIGN.md`, `design-tokens.md`, or another
   token-bearing design file as an import seed. The visual picker can import the
   file, show Current versus Alternate choices, and let the user keep or evolve
   each dimension.
2. **Existing app or agent:** use its repo path and, when available, a running
   local URL. Launch the picker, choose **Existing product**, enter the repo and
   URL, extract the observed visual system, review what was inferred, then
   confirm or evolve it. Treat extraction as observed evidence, not as a claim
   about user taste until the user confirms it.
3. **Groundwork Spec or prior mockup selection:** if a design under
   `~/dev/designs/<slug>/` or `<repo>/.designdoc/` has `spec.json`, use it. Fold
   any `mockups/selection.json` rationale and user-stated must-keep preferences
   into the mood/context instead of asking again.
4. **Initial idea:** use a one-line description from the request; no Spec is
   required.

Resolve the session once. `TARGET` may be a repo, design directory, `spec.json`,
or imported design file; leave it empty for an initial idea. The resolver emits
shell-quoted values and preserves the full Spec-derived description, audience,
density, mood, and selected-mockup rationale:

```bash
GROUNDWORK_ROOT="${CLAUDE_PLUGIN_ROOT}"
REQUEST="<the user's complete request>"
TARGET="<explicit source path, or empty>"
NAME="<product name when known, or empty>"
RUNNING_URL="<loopback/local product URL when available, or empty>"
RESOLVE_ARGS=(--request "$REQUEST" --format sh)
[[ -n "$TARGET" ]] && RESOLVE_ARGS+=(--target "$TARGET")
[[ -n "$NAME" ]] && RESOLVE_ARGS+=(--name "$NAME")
[[ -n "$RUNNING_URL" ]] && RESOLVE_ARGS+=(--running-url "$RUNNING_URL")
eval "$(PYTHONPATH="$GROUNDWORK_ROOT" python3 "$GROUNDWORK_ROOT/designer/bridge/resolve_visual_session.py" "${RESOLVE_ARGS[@]}")"
```

The resolved owned output is `~/dev/designs/$GW_SLUG` for an initial idea or
`<repo>/.designdoc` for an existing product. An existing app with a defensible
platform emits `$GW_BOOTSTRAP`, an atomically written and validated
`groundwork.visual-bootstrap/v1` document. It retains the full primary and
companion topology, source paths, observed design baseline, and catalog-qualified
known facts. Preserve confirmed tokens and preferences unless the user explicitly
chooses an alternative. If `$GW_BOOTSTRAP` is empty, report
`$GW_BOOTSTRAP_WARNINGS` and leave the platform unresolved rather than inventing
one.

## 1. Launch the visual picker (DEFAULT — this is what they want)

Start the Designer server on a free port with that context, then OPEN it in the browser:

```bash
mkdir -p "$GW_OUT"
PORT=8910; while lsof -ti:$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
SERVER_ARGS=(--context "$GW_DESC" --name "$GW_NAME" --out "$GW_OUT" --port "$PORT")
if [[ -n "$GW_BOOTSTRAP" ]]; then
  SERVER_ARGS+=(--bootstrap "$GW_BOOTSTRAP" --drive adaptive)
else
  SERVER_ARGS+=(--drive standard)
fi
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" nohup bash "${CLAUDE_PLUGIN_ROOT}/designer/server/run-supervised.sh" "${SERVER_ARGS[@]}" > /tmp/gw-designer.log 2>&1 &
GW_DESIGNER_PID=$!
sleep 3
open "http://localhost:$PORT"
```

Groundwork opens as one panel: a left rail listing every Groundwork component
beside a single content area. Designer is one destination in that rail, with
Saved work and Design output alongside it; components that run in chat are
listed but not clickable. Nothing in the rail changes the agent protocol below.

For an existing product, do not ask the user to choose **Existing product** or
re-enter `$GW_REPO`. The bootstrap opens directly on the observed baseline and
the server emits only to `$GW_REPO/.designdoc`; it never writes design output at
the repo root. The baseline screen leads with the next action and names the
decision it goes to, and shows that decision's options in place when you have
already posted one. Review the full topology and extracted current system, then keep
or evolve each dimension. For a new product,
tell the user, in one or two lines: **"Open — Designer is the first item in the
left rail; click the option that feels right on each step. It is narrowing your
taste across platform, navigation, color, type, density, motion, and component
decisions. You are choosing between concrete previews, not answering an
open-ended interview."**

The server renders each decision as option cards with live previews; every click records a revealed preference and advances. It converges on its own and writes the design system to `--out`.

### Stay attached in adaptive sessions

Launching the browser is not the end of the host task. When `$GW_BOOTSTRAP` is
non-empty, Claude Code and Codex must both remain attached until convergence or
the user explicitly pauses. Use the shared loopback transport:

```bash
DRIVER=(PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 "${CLAUDE_PLUGIN_ROOT}/designer/bridge/adaptive_host_driver.py" --url "http://127.0.0.1:$PORT")
```

Repeat this contract exactly:

1. Run `env "${DRIVER[@]}" contract`. The GET to `/api/agent/contract` marks the
   host attached and returns the current `seq`, phase, and decision contract.
2. If it returns `done`, stop. If it returns `waiting`, poll again; the user is
   choosing from the currently displayed options.
3. When it returns a contract, reason over its candidates and instructions.
   Preserve the full contract, fill its `answer` block, copy the response `seq`
   to the top-level answer payload, and write that JSON to a temporary file.
4. Run `env "${DRIVER[@]}" answer --file <filled-contract.json>`. On `stale`,
   discard the answer and re-read the live contract. On a validation error,
   correct the answer against the published schema; never bypass it.
5. Continue polling after the user pick hands control back to the host. End only
   at `done` or an explicit user pause.

The transport accepts loopback HTTP only and contains no vendor SDK or API key.
Both host entrypoints use this same protocol; host-specific prose may differ,
but launch arguments, request/response shapes, and stop conditions may not.

### Restart-safe launch

The launch command above already runs the server under a supervisor loop, so
this is automatic — nothing extra to do. What it buys you: the walk, the
decision the host most recently posted, and its `seq` persist to
`.designer-state.json` in the output directory (or
`$GROUNDWORK_DESIGNER_STATE_FILE` when set). Relaunching with the same
`--context`, `--out`, `--name`, `--drive`, and `--bootstrap` resumes exactly
where the walk left off — a posted decision is still there to answer even if
the host never polled again, and even across a server restart. A server whose
event loop stalls for longer than `--watchdog-seconds` (default 300; `0`
disables) exits non-zero so the supervisor loop restarts it — but only when
it was killed by a signal; a deterministic failure like a port already in use
exits the loop immediately instead of restarting forever. To stop the server
for good, `kill "$GW_DESIGNER_PID"` — that stops both the supervisor loop and
the server; killing only the `node` process gets it relaunched immediately.
`--agent-window-seconds` (default 120) only changes when the picker shows the
"no agent attached" notice — it never hides or discards a decision the host
already posted.
Only one live server may own a state file. A competing launch exits without
serving a new walk; after the owner exits, relaunch with the same arguments to
resume. If the state file cannot be written, the API returns 503 and exits
without acknowledging the unsaved turn.

## 2. If they want you to help / take over (fallback, headless)

Only if there's no browser, or they explicitly ask you to drive: run the same engine headlessly, picking on their behalf against their stated taste, narrating one line per decision so they can veto:

```bash
if [[ -n "$GW_SPEC" ]]; then
  python3 "${CLAUDE_PLUGIN_ROOT}/designer/bridge/spec_to_context.py" "$GW_SPEC" > /tmp/gw-context.json
else
  GW_DESC="$GW_DESC" python3 -c 'import json,os;json.dump({"description":os.environ["GW_DESC"]},open("/tmp/gw-context.json","w"))'
fi
python3 -c 'import json; ctx=json.load(open("/tmp/gw-context.json")); json.dump({"context":ctx,"overrides":{},"per_platform":{},"asked":[],"history":[],"baseline":{}}, open("/tmp/gw-state.json","w"))'
# loop: present (no record) -> reason -> pick
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.engine.cli present --state /tmp/gw-state.json > /tmp/gw-step.json   # read .decision.options[]
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.engine.cli pick --state /tmp/gw-state.json --category <id> --option <id> > /tmp/gw-next.json
python3 -c 'import json;json.dump(json.load(open("/tmp/gw-next.json"))["state"],open("/tmp/gw-state.json","w"))'
```
Prefer offering them 2–4 concrete named directions to choose between over asking open-ended questions — always narrow, never interview.

## 3. Convergence check (optional, between rounds)

```bash
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -c '
import json
from designer.gate.convergence import dim_states_from_history, convergence_status
from designer.engine.catalog._deltas import CATEGORY_DIMENSION
st = json.load(open("/tmp/gw-state.json"))
present = json.load(open("/tmp/gw-step.json")) if __import__("os").path.exists("/tmp/gw-step.json") else {}
next_dim = None if present.get("action") == "done" else (present.get("decision") or {}).get("dimension")
ds = dim_states_from_history(st.get("history", []), CATEGORY_DIMENSION)
print(json.dumps(convergence_status(ds, round_count=1, next_dim=next_dim), indent=2))
'
```
`ready: false` + high `info_gain` → one more pass on the shaky dimension. `ready: true` → emit.

## 3.6 Generate + validate the color system (relationships engine)

Do NOT hand-pick hex values, and do NOT hand-write the params dict. Color is
ELICITED, not guessed: the **decision engine** (`designer/decide/color_dimensions`)
asks the highest-information-gain color question, you phrase it and show the option
swatches, the user picks, and the converged answers compose the params the
**relationships engine** generates from. The engine picks WHICH question; you only
phrase it. This closes `elicit.py` ↔ `relationships.py`.

The color relationship dimensions are `temperature`, `energy`, `harmony`,
`contrast_feel`, `accent_intensity`, and `mode` — each a categorical relationship,
not a raw color. Drive the loop:

```bash
CSESS="$GW_OUT/color-session.json"
# init — pin `mode` (light|dim|dark) if the walk already settled it, so the engine
# never spends a question on it. Add --decided '{"temperature":"cool"}' for any
# relationship the brand fixes up front.
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.decide.color_dimensions init \
  --goal "$GW_DESC" --mode <light|dim|dark> --out "$CSESS"

# loop until ready: ask -> the returned question.options[] each carry a real
# {roles:{surface,on_surface,muted,accent,on_accent}} preview. Render those as
# option cards (this is a VISUAL pick, not an interview), the user picks one value,
# then record it as a COMMITTED pick with --decided (a click = a commitment, so the
# engine advances instead of re-asking). `question.fork` names the two most
# informative values when you want a fast A/B.
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.decide.color_dimensions ask --session "$CSESS"
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.decide.color_dimensions answer \
  --session "$CSESS" --dim <dim> --value <picked> --decided
# ...repeat ask/answer until `ask` returns "ready": true. Each option carries
# `clipped: true` when sRGB can't render the requested chroma (its accent looks
# identical to a lower-energy value) — don't present those two as a real choice.
# The gate asks each OPEN relationship once (up to ~5); pin more up front with
# --mode / --decided to shorten it. Stops as soon as nothing is left open.

# emit — the converged palette + the exact params vector + which dims stayed default.
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.decide.color_dimensions emit \
  --session "$CSESS" > "$GW_OUT/color-result.json"

# record it as a named combo (still contrast-GATED — refuses if any target unmet)
# and preview. The params come straight from the emit result, never hand-typed.
PARAMS="$(python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1]))["params"]))' "$GW_OUT/color-result.json")"
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.color.combos add \
  --name "$GW_SLUG" --source "explore-ui elicitation" \
  --intent "<one line: the mood the walk converged on>" --params "$PARAMS"
# preview the ACTUAL elicited palette (lead card) + its hue family. Pass the emit
# result via --params-file so the sheet shows the converged system, not defaults.
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.color.preview \
  --params-file "$GW_OUT/color-result.json" --sweep-hue 6 \
  --title "$GW_NAME palette" > "$GW_OUT/palette-preview.html"
```

If the user IMPORTED an existing palette (existing-app path), critique it before
adopting — surface concrete fixes with exact target hexes:

```bash
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -c '
from designer.color.relationships import suggest_improvements
import json; print(json.dumps(suggest_improvements("<surface>","<text>","<accent>"), indent=2))'
```

Fold the generated `roles` + `ramps` (from `combos`/`generate`) into
`design-tokens.md` in step 4. The palette is an OUTPUT of the relationships; the
relationships are the design.

## 4. Emit the design tokens

The browser walk emits to `--out` on completion. If driving headless, emit explicitly (to a SEPARATE file so it never clobbers `design-system.md`):

```bash
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.engine.cli emit --state /tmp/gw-state.json \
  --name "$GW_NAME" --out "$GW_OUT/design-tokens.md"
```

When `$GW_SPEC` is present, re-run the deterministic emitter after visual
convergence so `steering.md` and the self-contained `builder-handoff.md` refresh
against the confirmed visual artifacts:

```bash
[[ -z "$GW_SPEC" ]] || node "${CLAUDE_PLUGIN_ROOT}/engine/dist/cli.js" "$GW_SPEC" --out "$GW_OUT"
```

- `design-system.md` — screen cards / states / voice (from the design flow).
- `design-tokens.md` — the walk-derived color/type/space/motion token system.

## 5. Report

Report the emitted `design-tokens.md` path, the starting evidence used
(description, Spec, imported design, or extracted existing app), the confirmed
versus changed preferences, the key decisions recorded (accent, density,
navigation, motion), and any dimension still worth revisiting. Keep observed
current-state signals separate from user-confirmed taste.
# Decision status

Visual exploration may vary leaning palettes and treatments only within declared semantic, contrast, and relationship constraints. It must not silently override locked values or an observed baseline.

## Durable feedback and chosen designs

Read `contract.workspace` and `contract.pending_chats` when present. Notes remain pending until a valid answer echoes the current `seq`; polling is not acknowledgment. The selected visual alternative is explicit user context. See [saved work](../docs/designer-saved-work.md) for the compatible `pending_chat` field and full workspace API.
