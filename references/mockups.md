---
name: mockups
description: Author a task-appropriate set of divergent full-screen HTML mockups, review them in Groundwork's gallery, and record the winning direction to seed the Designer walk. Use when the user wants UI options, a redesign, "show me designs", "improve the UI", a mockup gallery, or full-screen visual directions to compare from an existing Spec.
---

You (the host agent) are the designer. Read `references/design-profiles.md` and
`skills/interface-designer/SKILL.md` first. The Designer engine only renders
**per-token schematic previews**, never full screens — so full-screen mockups
are **authored by you**, seeded by meaningfully different profile hypotheses,
then reviewed in **Groundwork's own gallery** (the canvas server's `--mode
gallery`). This flow lays out the gallery, has you author the mockups, launches
the review surface, and records the pick back into the design so the explore-ui
flow can seed its walk. Groundwork owns this surface; the separate
mockup-gallery plugin stays independent and is not required.

Target: a design slug under `~/dev/designs/`, an existing product repo with
`.designdoc/spec.json`, or a direct Spec JSON path.

## 1. Locate the design + Spec

Resolve the Spec JSON and design directory:
- If the target is a path to a `.json` file, that's the Spec. Its design dir is `~/dev/designs/<slug>/` (slug = kebab-case `productName`), or pass `--out` in step 2.
- If the target is an existing product repo, use `<repo>/.designdoc/spec.json`
  and set the design dir to `<repo>/.designdoc/`.
- If it's a slug (or empty), look under `~/dev/designs/<slug>/` for the Spec (`spec.json`, else the most recent design folder). If several match, ask which.
- If no Spec exists, tell the user to run the design flow first — this flow mocks up *from* a Spec, it does not author one.

Set `SPEC` to the Spec path, `DESIGN_DIR` to the owned design directory, and
`SLUG` to the design folder name.

## 2. Scaffold the mockups dir + manifest

Run the scaffolder (pure stdlib, no network):

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/designer/mockups/scaffold.py" "$SPEC" --slug "$SLUG"
# optional: --out <design-dir>  --screens id1,id2  --modes atmospheric-immersion,warm-craft  --force
```

It creates `<design-dir>/mockups/` with a `manifest.json` enumerating one **slot per (selected screen × selected direction)** — `{screen_id, mode, html_path, status:"pending"}` — plus a placeholder HTML file per slot. The command defaults to the Spec's `screens[]` and the four primary briefs as a scaffolding convenience, not a required review count. Use `--screens` and `--modes` to generate the meaningful set for this task. Read `manifest.json`; the `slots[]` are your work list. Placeholders are visibly non-functional and carry a `groundwork:placeholder` sentinel, so re-running is idempotent (host-authored files are kept, their status flips to `authored`).

Schema: `${CLAUDE_PLUGIN_ROOT}/designer/mockups/manifest.schema.json`.

Before you fix the mode list, check what past reviews already revealed about this
person's taste — the gallery records it there (see §4, "What the gallery
remembers across projects"):

```bash
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.decide.profile show
```

Read `dimensions.design_mode` / `design_mode_liked` (modes they keep choosing)
and `design_mode_disliked` (modes they keep rejecting), and let that order which
modes you author — lead with a settled favorite, and do not spend another slot
re-proposing a mode they have repeatedly rejected. This is a lean, not a rule:
if the product genuinely calls for the rejected mode, author it and say why.

### Choose the option count deliberately

**Option count is a design decision, not a quota. The user-requested count wins.**
Author enough genuinely different directions to expose the material trade-offs,
and no more. Do not create redundant variants merely to reach three, four, or
nine. Start with a compact set when the direction is uncertain, then add an
option only when it tests a new hypothesis or the user asks for more range.

Count **directions** separately from **review views**. Three coherent directions
applied across three critical screens create nine review views; that can be an
efficient set because each direction is judged as a system. A one-screen question
may need only two or three views, while a broader product exploration may need
more. Record the selected `--screens` and `--modes` so the count has an explicit
rationale.

## 3. Author the mockups (this is the real work)

For **each selected screen**, author one candidate HTML file for every selected direction, with each candidate committing fully to its hypothesis. Write each into its slot's `html_path` (overwrite the placeholder). Read the applicable brief before authoring it:

- `${CLAUDE_PLUGIN_ROOT}/designer/references/modes/atmospheric-immersion.md`
- `${CLAUDE_PLUGIN_ROOT}/designer/references/modes/glass-workspace.md`
- `${CLAUDE_PLUGIN_ROOT}/designer/references/modes/warm-craft.md`
- `${CLAUDE_PLUGIN_ROOT}/designer/references/modes/data-narrative.md`

The point is **divergence**: each mode is a genuinely different hypothesis, not a recolor. Use the brief's type ladder and named components, and honor the Spec — the screen's `purpose`, `primaryAction`, and `states`, plus the product's `voiceProfile`, `personas`, and `platformTarget`.

Default to a **low-fidelity first pass** when the user has not asked for polished output. Use simple layout blocks, real labels, and only enough styling to make the interaction hypothesis legible. A fast rough option that earns feedback is more useful than a slow polished option built on an untested direction. Move to higher fidelity after the user confirms the structure or explicitly asks for it.

Make the comparison contract explicit in each authored slot. Add a `delta` object to the slot in `manifest.json` with a short `summary` that answers “What changes in this option?” If the material difference is confined to one small region, also add a `selector` for the first same-origin element the gallery should outline in expanded review:

```json
"delta": {
  "summary": "Keeps the assistant in the menu bar and removes the persistent desktop pet.",
  "selector": "[data-component='PresenceControl']"
}
```

Do not invent a selector for a broad visual direction. Text is the required explanation; the outline is an optional orientation cue. An invalid or unmatched selector degrades to the summary without blocking review.

**Color comes from the engine, not from your judgment.** A mode brief's hexes are a *starting vector*, not a palette to copy: they were authored for that brief's original context, not this Spec's surface, mode, or audience. The standing rule in `skills/groundwork/SKILL.md` — *elicit color, never hand-pick it* — applies here, and this is the flow where it is most often broken, because authoring HTML makes typing a hex feel like design work. It is not; it is guessing with extra steps.

Before you write a single hex into a mockup:

```bash
GW="${CLAUDE_PLUGIN_ROOT}"
# 1. Validate the brief's palette against THIS Spec's surface. Returns solved
#    replacements (same hue + chroma) for anything that fails.
PYTHONPATH="$GW" python3 -m designer.color.combos ingest \
  --surface '<brief surface>' --text '<brief on_surface>' --accent '<brief accent>'

# 2. Or generate the palette from the relationship vector and use its roles verbatim.
PYTHONPATH="$GW" python3 -m designer.color.preview \
  --params '{"energy":"balanced","contrast_feel":"crisp","accent_intensity":"clear",
             "harmony":"analogous","anchor_hue":<H>,"surface_L":<0.985 light | 0.16 dark>}' \
  --sweep-hue 6 > /tmp/palette.html
```

Then author against the returned `surface / on_surface / muted / accent / on_accent` roles. Two guarantees you cannot reproduce by eye: the engine **bisects on OKLCH-L against the rendered hex** so gamut-mapping can't silently drift contrast, and it resolves the mid-tone dead-zone so the accent can host a legible label. If an option reports `clipped: true`, sRGB cannot render that chroma — do not present it as a real choice; lower `energy` or `accent_intensity` instead of quietly accepting a duller color than the brief promises.

Two failure modes worth naming, both observed in real runs:
- **Reserved-hue collision.** Status hues (success/warning/error) are spoken for. An accent that matches one destroys the signal — if the brand accent is the success green, "success" stops meaning anything. Check the Spec's status set before choosing an anchor.
- **Dark-only palettes wearing a "new direction" label.** An accent can look excellent on `#09090b` and fail AA on white. If the Spec needs both modes, solve **both twins** from the same vector (`surface_L` 0.985 and 0.16) and verify each — never ship one and assume the other.

Rules for every file:
- **Full-screen, self-contained, standalone HTML.** Inline `<style>`; no build step, no external fetches. (Tailwind via CDN is acceptable if you prefer it, but mode palettes are cleanest as raw CSS.)
- **Honest static prototype.** No fake backends and no fake-data-as-real. Controls are visual only — mark the screen visibly non-functional (a small "Demo · static prototype" tag). Show a plausible representative state; if you show several states, label them.
- **Gallery-rateable.** Put `data-component="ComponentName"` on each distinct section and a muted component label above it (mockup-gallery convention).
- One screen per file. Match the platform (e.g. iOS: ~50px top inset for the notch, 44pt touch targets; web: responsive down to the Spec's smallest viewport).
- Respect the foundational rules the briefs inherit (luminance hierarchy, left-border accent not boxes, ≥70% content-to-chrome, reduced-motion). A file can follow a mode perfectly and still fail these.

### Data-I/O depth follows `designIntent`

Read the Spec's top-level `designIntent` (`iterate-ui` | `design-app` | `unspecified`) before deciding how much data detail to record while authoring. When `iterate-ui`: note each element's `dataIn.source` only and move on — never stall the mockup pass collecting `expectedType` or entity detail. When `design-app`: capture descriptive `dataIn`/`dataOut` with `expectedType`, and make sure the entities they point at exist in the Spec's top-level `dataModel[]`, linked via `readByFeatureIds`/`writtenByFeatureIds`/`elementRefs`. Either depth: Groundwork identifies what data is needed where and points build-loop at the wiring — it is not the data-flow source of truth.

### Per-element data-I/O annotation

Every interactive or display element you author into a mockup — button, nav, search, field, link, info panel — should record its data contract on the corresponding `ScreenElement` in the Spec: `dataIn` (`source`: `user-entry` | `search` | `computed` | `fetched` | `none`, plus optional `expectedType`/`note`) and `dataOut` (`shows`, optional `expectedType`/`note`). This is guidance for you, the host agent, updating the Spec alongside each mockup — no element should ship as a dead control with no resolved data wire. Rendering this annotation on the canvas itself is a separate track; this flow's job is making sure the Spec captures it. To make that contract visible as an io-chip on the canvas (`designer/canvas/PROTOCOL.md §5a`), mirror the same `dataIn.source`/`dataOut` onto the element's `[data-component]` node as `data-datain`/`data-dataout` attributes, or into `status.json`'s `ioAnnotations[component]` map.

After writing all files, re-run step 2's scaffold command once (no `--force`) to refresh `manifest.json` statuses to `authored`, or set them yourself. Every slot should be `authored` before review.

## 4. Launch the review surface (Groundwork's own gallery)

Groundwork ships its own divergence/compare surface — the **gallery mode** of the
canvas server (`designer/canvas/canvas-server.mjs --mode gallery`). It does NOT
depend on the separate mockup-gallery plugin; that stays an independent tool.
Point it at the mockups dir — it reads `manifest.json` and renders the slots side
by side, grouped by screen, each with a rating (yay/ok/nay), a per-screen winner
pick, and a note field. Every slot also has **Expand**, which opens the full
mockup in a focused review workspace. Full view keeps the review loop compact:
**Yay** or **Nay** records the direction immediately, the overall comment saves
automatically, and **Previous** / **Next** moves through every review view.
**Annotate** is reserved for feedback tied to a specific spot: it lets the user
place a numbered dot at an exact point or draw a box around a selected element,
then attach a comment. Annotation mode and the selected tool persist across
saves until the user chooses **End annotation**.
The comparison grid stays compact; element-level tools appear only in full view.

Each comparison thumbnail is a bordered, letterboxed, non-interactive rendering
of the slot's complete same-origin document. It is a miniature for orientation,
not another embedded app; use **Expand** to inspect or interact with the design.
When a slot declares `delta.summary`, both the card and expanded rail show it as
**What changes**. When `delta.selector` resolves, expanded review also outlines
that region so a small difference does not disappear inside a full-screen image.
After a rating is chosen, the gallery shows that one selection prominently and
collapses the alternatives behind **Change**. Dot/Box controls appear only while
Annotate is active and hide again when annotation mode ends.

### When you rewrite a mockup, its annotations are archived

An annotation is feedback on the content it was placed over. Rewrite that slot's
HTML and the annotation is now critique of work already done — so the gallery
retires it instead of floating it over the new design. On the next change to a
slot (live, or detected at startup for a change made while the server was down)
the gallery:

1. writes the version it is replacing to
   `<mockups>/.canvas/archive/<slot>/<version>/` — the prior HTML bytes under
   their original filename, plus `annotations.json` holding the full annotation
   records (comment, bounds, target, timestamps: nothing is dropped),
2. flips those records to `status:"archived"` in `gallery-selections.json`, with
   `archivedAt` and `archivedFrom:"<version>"` pointing at that directory,
3. removes them from the live overlay and the annotation rail.

The same proven content-hash change also clears the slot's live rating and any
per-screen winner pick that points at it, because those choices describe the
bytes the user reviewed. An identical-byte rewrite clears nothing. Notes,
annotations, archived versions, and `.canvas/feedback.jsonl` remain intact, so
the review history is append-only even though the new version needs a new live
decision.

`<version>` is `<UTC compact time>-<first 8 hex of a sha256>` — e.g.
`20260722T051056Z-3f9a1c2b`. Which hash depends on the path: on a
**content-hash** version (the normal case — a snapshot exists) it is the
retired content's own sha256; on an **mtime-bootstrap** version (no prior
bytes to hash) it is the *superseding* content's hash instead, since that is
the only one available. The timestamp is usually the archive instant but not
always — a same-UTC-second collision nudges it forward. **Do not treat the
`-<hash8>` suffix as identity**: it is a prefilter over directory names only.
The archive's real identity is the `hash` field inside `annotations.json`
(and an mtime-bootstrap payload carries `hash:null`, so it is never matched
by it). Bookkeeping lives in `.canvas/slot-versions.json` and
`.canvas/current/<slot>` (a byte snapshot of the recorded version, which is
what makes the PRIOR bytes archivable — by the time a change is noticed, the
file itself already holds the new ones). **Nothing is deleted**: archiving
only moves feedback out of the live view.

A rewrite of a slot with no open annotations still writes a version record —
history stays continuous, and a later annotation has a version to be
attributed to — but copies no HTML, since there is nothing open to explain
the bytes. That version's `&file=html` returns 404, and such versions
accumulate in the **Prior versions (N)** list below alongside ones you can
actually open.

`resolved` annotations are never archived and never rewritten — that status is
the user's own disposition. They stop drawing on the overlay along with archived
ones, which is a rendering rule, not a change to what they mean.

**Read the archive back** (ungated, loopback, read-only — it holds this design
dir's own data, the same class `/__gallery/selections` already serves):

```bash
curl -s "http://localhost:$PORT/__gallery/archive?slot=<slot>.html" | python3 -m json.tool
curl -s "http://localhost:$PORT/__gallery/archive?slot=<slot>.html&version=<id>"
curl -s "http://localhost:$PORT/__gallery/archive?slot=<slot>.html&version=<id>&file=html"
```

A slot with no history answers `{"slot":…,"versions":[]}`; an unknown version is
404, and a slot or version that is not a plain name is 400. Full view also shows
a **Prior versions (N)** disclosure at the foot of the annotation rail when a slot
has history. The comparison grid is unchanged.

**Caveat: the mtime-bootstrap fallback.** When the gallery has no recorded hash
or snapshot to diff a changed slot against, the true prior bytes are
unrecoverable, so it falls back to the file's mtime: any open annotation whose
own `updatedAt` is older than the file gets archived with
`provenance:"mtime-bootstrap"` and `html:null` — an honest record that the prior
HTML was never captured. That direction of error is deliberate; the alternative
(seed silently) leaves genuinely stale annotations rendering forever. The
tradeoff, stated plainly: a content-preserving mtime bump — `git checkout`,
`touch` — before this fallback fires archives annotations that were still
valid.

This is **not** a one-time event. It fires whenever no usable snapshot exists
to diff against — normally just the very first time the gallery sees a slot,
but it recurs if the snapshot is later lost (e.g. `.canvas/current/<slot>`
deleted) or fails its own integrity check against the recorded hash. Either
way it deletes nothing, and every field is recoverable through the route
above.

```bash
node "${CLAUDE_PLUGIN_ROOT}/designer/canvas/gallery-launcher.mjs" start \
  --dir "$DESIGN_DIR/mockups" \
  --title "<product> · pick a direction" --port 8930
```

The launcher detaches the server from the short-lived host process, waits for
`GET /__gallery/health`, and prints the ready URL. It records only local runtime
control data under `$DESIGN_DIR/mockups/.canvas/`:

- `gallery-server.pid` — the verified server PID;
- `gallery-server.json` — URL, port, PID, start time, and log path;
- `gallery-server.log` — append-only stdout/stderr for this gallery.

Use the same launcher for deterministic health and stop operations:

```bash
node "${CLAUDE_PLUGIN_ROOT}/designer/canvas/gallery-launcher.mjs" health \
  --dir "$DESIGN_DIR/mockups"
node "${CLAUDE_PLUGIN_ROOT}/designer/canvas/gallery-launcher.mjs" stop \
  --dir "$DESIGN_DIR/mockups"
```

`stop` signals a PID only when that process answers the recorded gallery health
endpoint with the same PID, launch-instance identifier, and canonical gallery
directory. Copied or stale metadata never authorizes killing an unrelated
process. If the browser loses its event stream, the gallery shows a visible
disconnect notice instead of accepting silent save failures.

### Review from a phone or another device on the same Wi-Fi

Keep the gallery server on its required loopback address. If the user wants a
nearby reviewer to rate, annotate, or pick a mockup from another device, invoke
the installed `$share-lan-preview` skill after the gallery is running. Its
expiring token proxy exposes the existing loopback port temporarily and keeps
Groundwork's feedback write path unchanged. Return the tokenized LAN URL, the
same-Wi-Fi requirement, and the expiry time. Never change the canvas bind address
or substitute a public tunnel.

### What the gallery remembers across projects

The review also compounds into Groundwork's **cross-session taste profile** — the
same store the decision pipeline already keeps at
`~/dev/designs/.groundwork-profile.json` (schema `groundwork.decide.profile/v1`),
not a second one. Four acts are treated as revealed preference, resolved to the
slot's design mode via `manifest.json`:

| act | dimension recorded | value |
|---|---|---|
| pick a winner | `design_mode` | the slot's mode |
| rate **yay** | `design_mode_liked` | the slot's mode |
| rate **nay** | `design_mode_disliked` | the slot's mode |
| add a **new** annotation | `critique_focus` | the annotated `data-component` |

`ok` ratings, notes, annotation edits, and re-clicking a rating or pick you
already made record nothing — only a distinct change of revealed preference
counts, because three confirmations settle a dimension.

**Privacy boundary.** Only mode ids and component names ever leave the design
dir. Annotation comment text, note text, file paths, project names, and slot
filenames are never written to the global profile, and a value that is not a
plain identifier is dropped rather than recorded.

**How to read it back.**

```bash
PYTHONPATH="${CLAUDE_PLUGIN_ROOT}" python3 -m designer.decide.profile show
```

The running gallery also serves it read-only at `GET /__gallery/profile`, gated
by a token the launch banner prints (`profile read: …?token=…`, in
`/tmp/gw-gallery.log` for the launch above). The token is never embedded in any
page: mockup HTML runs on the same origin as the gallery, so an ungated route
would let a mockup read taste recorded from every other project.

**Files it touches.** The store itself, plus a zero-byte `<store>.lock` sidecar
used to keep two Groundwork writers from clobbering each other. One review
session records at most one confirmation per preference, and stops recording
after 200 distinct ones (a line on the server's stderr says so if you ever hit
it).

**Opt out.** `--no-profile` on the launch above, or `GROUNDWORK_PROFILE=off` in
the environment; `GROUNDWORK_PROFILE_STORE` points it at a different store. With
recording off the gallery behaves exactly as it did before this existed.

**Two things worth knowing about how it reads.** Picks are per-screen, so a
review where different screens win with different modes is recorded as split
taste, and the profile stays appropriately uncertain about your mode preference —
that is faithful, not a bug. And the profile is an append-only record of what you
expressed, not a mirror of the final state: rating a slot yay and later nay
leaves both, the same way the elicit path never retracts an earlier answer.

**Who consumes it — precisely.** `explore-ui` and `iterate` warm-start from this
same store, but `seed_session` only seeds dimensions their session already asks
about, and no dimension catalog defines the four above. So feeding them does not
change those flows' question count today. The consumer of the mode-level
dimensions is **you, the host agent**: check them in step 2 before choosing which
design modes to author, so a mode this person has settled on is offered first and
one they keep rejecting is not re-proposed for the fourth time. What the gallery
adds to the shared store for `explore-ui`/`iterate` is the store's continued
existence and hand-editability, not new warm-start coverage.

Tell the user to **expand any option they need to inspect, annotate exact
elements, rate each option, then pick a winner per screen** — the goal is one
winning direction per critical screen with actionable feedback attached. Their
rate / pick / note / annotation actions append to
`$DESIGN_DIR/mockups/.canvas/feedback.jsonl` and are folded into the server-owned
`$DESIGN_DIR/mockups/.canvas/gallery-selections.json`, which step 5 reads.
Element annotations are keyed by slot and preserve normalized page position,
marker shape, normalized element bounds, `data-component`, selector, element text/label, viewport/document
dimensions, comment, status, and timestamps. Schema:
`${CLAUDE_PLUGIN_ROOT}/designer/mockups/gallery-selections.schema.json`.

Slots are flat `<screen>-<mode>.html` files (the scaffolder's convention); the
gallery groups them by `screen_id` from `manifest.json`. `manifest.json`,
`selection.json`, and the `.canvas/` control files are not slots and are not
rendered as options.

## 5. Record the selection (seed for explore-ui)

When the user has picked, write `<design-dir>/mockups/selection.json` capturing the winning mode per screen and the dominant direction:

```json
{
  "schema": "groundwork.mockups.selection/v1",
  "slug": "<slug>",
  "selectedAt": "<ISO-8601>",
  "primaryMode": "<the dominant mode id to seed the Designer walk>",
  "perScreen": [
    { "screen_id": "<id>", "mode": "<mode id>", "html_path": "<file>", "note": "<why it won / change asked for>" }
  ],
  "rationale": "<one paragraph: what direction won and why, in the user's terms>"
}
```

Read the user's ratings/picks/notes **and every open element annotation** from
the gallery's server-owned state,
`<design-dir>/mockups/.canvas/gallery-selections.json` (shape
`{schema, ratings:{file:rating}, picks:{screen_id:file}, notes:{file:text},
annotations:{file:[annotation]}}`), rather than guessing. `picks[screen_id]` is
the winning slot per screen; fold `notes` into the matching perScreen `note`.

**"Open" means `status === "open"` — test it positively.** `status` has three
values: `open` (live feedback on the current content), `resolved` (the user dealt
with it), and `archived` (the mockup was rewritten; this annotation belongs to the
version it replaced — see §4). A negative test such as `status !== "resolved"`
counts archived critique as required work and re-raises feedback on markup that no
longer exists.

Only `open` records draw on the gallery overlay, so a `resolved` one disappears
from the markers and the rail exactly like an archived one — same silence, two
different meanings. Unlike archived records they have no "Prior versions"
surface and no `GET /__gallery/archive` entry: they stay in
`gallery-selections.json` and are read there, or from `.canvas/feedback.jsonl`.

Treat open annotations as required UI work: quote the comment, identify the
captured component/selector, and carry it into the updated mockup, design
artifact, or Build Loop handoff. Do not mark the visual review complete while an
open annotation is silently ignored. If an annotation is intentionally not
applied, record the reason in the handoff. Archived annotations are not required
work and must not be re-raised as such; read them through
`GET /__gallery/archive` when you need the history of what was asked for and
against which version. (The `.canvas/feedback.jsonl` rows are the raw event log
if you need ordering; archiving appends nothing to it.)

**Divergent mockups → compare decisions → selection.json.** When the choice is
per screen between the current version (A) and a proposal (B), and the user
wants to answer each one with a note (Keep A, Approve B, Revise B, Neither),
put the pairs on a compare board (`AGENTS.md`, `designer/decisions/README.md`)
and export the answers instead of hand-writing this file:

```bash
python3 -m designer.decisions.decisions_build export <repo>/.groundwork/decisions/<slug>/decisions.json --format selection --out <design-dir>/mockups/selection.json
```

`primaryMode` is the seed the next step consumes: the explore-ui flow maps the Spec to a Designer context whose `mood` should now carry this chosen mode, so the token-level walk starts from the direction the user already endorsed at full-screen scale.

Refresh the generated packet so the selected HTML and rationale are embedded in
the self-contained builder handoff:

```bash
node "${CLAUDE_PLUGIN_ROOT}/engine/dist/cli.js" "<design-dir>/spec.json" --out "<design-dir>"
```

The emitter rejects traversal or a missing selected HTML file and preserves the
previous artifact generation instead of publishing an incomplete handoff.

## 6. Report

Give the user:
- The mockups dir, the selected screens and directions, and how many review views were authored (`screens × directions`), including why that count was useful.
- The winning mode per screen and the `primaryMode`, with the one-paragraph rationale.
- The gallery invocation you used (Groundwork's own `--mode gallery`).
- The exact next step: invoke Groundwork again with an explore-ui or
  design-system request for this slug to drive the Designer walk seeded by
  `selection.json` (`/groundwork:run` in Claude Code; the `groundwork` skill or
  plain language in Codex).

## Evidence-backed design guidance

Compare a small set of genuinely different profile hypotheses, not cosmetic
variants of one house style. Hold universal constraints constant: truthful and
complete states, hierarchy, recovery, accessibility, responsive behavior,
content fit, and perceivable feedback. Explain which product constraint each
profile serves and risks. The user's keep/kill reasons are evidence for this
product; they do not become universal taste rules without repeated support.
# Baseline and delta

Each comparison names its baseline, direction, and delta. A locked visual result carries exact scoped values and verification; a leaning result carries the relationship grammar and permitted variation.
