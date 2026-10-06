# Guided decision surface

A page a person opens to rule on their own project. It shows what is still open,
shows the thing each decision is about, records the ruling to a file, and says
plainly whether the file has it.

```bash
python3 -m designer.decisions.decisions_build init  ~/dev/my-app --slug home
python3 -m designer.decisions.decisions_build serve ~/dev/my-app --slug home
```

For an A-or-B board (Keep A / Approve B / Revise B / Neither), add
`--template compare`; see [Compare: A or B](#compare-a-or-b) below. Any agent
can drive it from the plain commands in the repository's `AGENTS.md`.

That scaffolds `~/dev/my-app/.designdoc/home/` with the record and the surface
beside it, matching the storage model in `SPEC.md`: a project's design data lives
in the repository it describes.

## The six things this surface does differently

Each answers a specific piece of feedback measured on the page this was ported
from, and each is enforced by a test rather than by intent.

**1. Open decisions first.** The default view is unruled items as numbered cards
with the control inline. No record bar, no stamps, no counts, no explanatory
prose above the cards — one quiet line at the foot is the only thing that reports
save state there. Ruled items live on their own view with the ruling, the time
and the receipt. The feedback that drove this: *"too much unnecessary info and no
clear visual distinction for open decisions."*

**2. Every card shows the thing being decided.** A cropped screenshot of the
element at 390px, or the current and proposed text in full, above the question.
Titles are plain words and record keys never appear in prose. The feedback:
*"I don't know what this refers to, where it is in the UI or what it looks
like."*

**3. Save truth.** The server returns `{ok, savedAt, bytes}` and the page refuses
to call a write successful without all three — a 204 is a save that lands on disk
and reports failure to the person. Each note and ruling carries its own flag, so
the page answers "is this in the record?" per item instead of comparing two blobs
by timestamp. Deleting is a real tombstone. Notes autosave; rulings never do,
because a ruling is a commitment.

**4. Annotations.** Incorporating one moves it to history carrying a receipt;
declining one leaves it visible with the reason; absence of a disposition is not
consent to hide. Deleting is a tombstone, because the merge re-reads disk and a
plain removal is undone by the union it just passed through.

⚠️ **Scope, stated plainly:** the annotation *model* — `incorporate`, `decline`,
tombstones, the transient-field rule — is implemented and tested, and the
Reference view renders existing pins with their dispositions. The pin-dropping
UI (click the preview to place a pin, type into a card at the pin, second click
moves an empty pin) is **not wired in this commit**. Nothing in the page creates
an annotation yet.

**5. Live preview.** An opt-in same-origin proxy of the real dev build, served
under the reserved `/__live/` path, with a Mockup toggle, a build-sha line and
Refresh. Picking a choice mutates the live iframe: text choices swap the target
element's text, keep/remove hides a section, structural choices load an
alternate page.

The preview root is `/__live/` and not `/` because `/` is the decisions app's own
index: pointing the iframe there rendered this surface inside itself, and every
overlay then edited a nested copy of the page instead of the build under review.

A `page`-mode url is filtered by `safePreviewUrl()` before it can reach
`iframe.src`. A record is untrusted input, and `javascript:` in that field would
execute in the one origin that owns the writable path — escaping markup does not
help, because this is not an HTML sink.

**6. Condensed supporting text.** Why is held to two sentences and about 35
words; option labels to twelve. Nothing is thrown away — the remainder is the
first thing `more` opens.

## Saved state and "Ask for new options"

A saved group choice shows "✓ Saved: <choice> at <local time>", a green left
edge, and a Save button that reads "Saved ✓" until something changes; a toast
confirms every write. An unsaved choice shows an amber "Not saved yet" line.

"Ask for new options" writes the group's comment to `optionRequests` in the
record: `{ id, group, area, note, requestedAt, status: "open" }`. An agent reads
open requests, adds new compares to that group (same `area` and current
visual), then sets the request's `status` to `"done"`. Requests merge by id, so
a save never drops another writer's request.

## Implementation status

The Compare view shows choices that still need a decision. Saved choices move
to the separate **Selected** view as compact rectangular cards. Each card
shows its chosen option and work status; opening it reveals the full comparison
and evidence so the choice can be reviewed or changed. Selected cards are
grouped in collapsible **In progress**, **Pending**, and **Complete** sections.
Needs decision is derived from the absence of a saved choice. A saved choice
starts Pending. Agents may
add a separate, evidence-backed `implementationStatus` entry keyed by the
comparison group id (or the compare id for an individual A/B card):

```json
"implementationStatus": {
  "home-intro": {
    "selected": "home-intro-b",
    "decisionNote": "Use the shorter heading",
    "proposal": { "summary": "Short heading", "visual": "home-intro-b.html" },
    "stage": "in-progress",
    "evidence": [{ "kind": "source", "detail": "New intro layout is present", "ref": "Sources/HomeView.swift:88" }]
  }
}
```

`selected`, `decisionNote`, and `proposal` must match the current saved choice,
its note, and its option object. Otherwise the board returns the item to
Pending, so changed requirements cannot inherit old evidence. In progress
requires a nonempty source detail and `ref`. Complete also requires an entry
with `kind: "verification"`, a checkable `ref`, and a nonempty `revision`
(commit, build id, or equivalent). The board displays that evidence. This is
an agent-maintained evidence ledger: it does not inspect the live source or
prove that a cited build is the latest one. The person's
choice and note remain untouched when an agent updates implementation status.

## Compare: A or B

When several compares describe the same area and current visual, the board
shows the current version once beside all proposed versions. The current card
is compact, proposals scroll sideways, and Preview size changes proposal card
width. A person chooses one version and saves one group decision. Earlier A/B
responses remain visible with their proposals and remain unchanged in the
record. Export uses the saved group choice; until it exists, the group counts
as one unanswered decision. Compares without a shared current visual keep the
original A/B flow.

A compare is one question with two answers side by side: **A**, keep what
exists (a screenshot of the current page), and **B**, the proposal (a
screenshot, or a static HTML wireframe from `visuals/`). The person answers
**Keep A**, **Approve B**, **Revise B**, or **Neither**. Neither is the open
answer: "I like neither, here is what I want instead", so nobody has to fake a
revision of B to say no to both.

```json
{ "id": "home-intro", "area": "Home", "question": "...", "why": "...",
  "optionA": { "summary": "...", "visual": "home-current.png" },
  "optionB": { "summary": "...", "visual": "home-proposed.html", "mockup": "home-b.html" },
  "secondOpinion": { "source": "Persona panel", "verdict": "approve", "note": "..." } }
```

Picking A or B saves a **draft** (`draftChoice`) with the note; the card stays
put and the line under it says exactly what is saved. **Done** records the
answer (`ruling`), clears the draft and moves the card out of the queue. A
draft is never an answer.

Optional fields: `headline` is the decision's one main idea in a few words
("Team lead model level"); the index card shows the category (`area`), the
headline, then the question. Set `"ordered": true` at the record's top level
only when the decisions must be answered in sequence; otherwise no numbers are
shown, because a number implies an order. Index cards share one width and
height; hover and keyboard focus raise a border and glow, never an underline.

The rules, each tested:

- **The four answers are fixed**, not authored per item (`COMPARE_CHOICES`),
  so the export maps them without guessing. They are stored in `ruling` as
  `keep-a | approve-b | revise-b | other`, the note in `rulingText`.
- **Revise B and Neither need a note.** Clicking either with an empty note
  marks it pending, says why inline, and shows a Record button that enables
  once the note has words. `validate()` refuses a record that carries either
  without a note, and so does `export`.
- **Save truth holds.** Clicking an answer is the explicit commit and writes
  at once through the same `{ok, savedAt, bytes}` path. The note autosaves on
  its own and never commits an answer. Only a note unchanged since the write
  was built is marked saved.
- **The lane is still derived.** An item is answered when `ruling` is present.
- **Mobile first.** At 390px A and B stack, the answers are a 2×2 grid of 48px
  buttons, the index becomes a number grid, and nothing is under 14px. Status
  is text colour only, from the existing graded tokens.
- **Wireframes are inert.** An `.html` visual is framed with `sandbox=""` and
  served with a sandbox CSP, so even opened directly it runs no script and has
  no origin that could reach the writable path.

The board is its own view (Compare tab). It groups the index by `area`, shows a
progress count with the split by answer, and puts "Back to index" after each
item. Answered items stay on the board; they also appear under Ruled.

```bash
python3 -m designer.decisions.decisions_build init   ~/dev/my-app --slug redesign --template compare
python3 -m designer.decisions.decisions_build check  ~/dev/my-app/.designdoc/redesign/decisions.json --json
python3 -m designer.decisions.decisions_build export ~/dev/my-app/.designdoc/redesign/decisions.json --format selection --out ~/dev/my-app/design/mockups/selection.json
```

`export` writes `groundwork.mockups.selection/v1` (`references/mockups.md` §5):
keep-a → `A`, approve-b → `B`, revise-b → `B-revise`, other → `other`. An
option's `mockup` (a path inside `mockups/`) becomes `html_path`. Its `visual`
is not used, because the packet emitter resolves `html_path` against `mockups/`
and would refuse a file that lives in `visuals/`.

## The record

`groundwork.decision-set/v1`. Three arrays hold ruleable things: `axes` (a few
large either/or choices), `openItems` (a long queue of small ones) and
`compares` (A or B, above). All normalize into one `Ruleable` through a single
adapter table, so the surface renders one list and a new array is a column in
that table rather than a rewrite.

The contract is **open**: only `schema`, `id` and per-item `id` are required, and
unknown keys round-trip untouched. A closed schema would reject the documents it
exists to render — a real record carries a dozen keys its project invented.

### A lane is derived, never declared

Records carry a `status` field. It is prose written for a human and it drifts.
Measured on the record this was ported from: **20 of 25 items had a status
beginning "open" while already carrying a ruling** — `"open — MERGE BLOCKER"` on
an item ruled `own`, `"open — undecided, NOT ruled"` on an item ruled
`latest-useful`. Any enum, parse, or mapping table over those 15 distinct prose
values mislabels 80% of the queue on real data.

So openness is computed from whether a ruling is **present**. `status` is carried
through as display prose that nothing parses and this surface never writes — a
stale status stays its author's to fix rather than being overwritten with a
fabricated agreement. `ruledAt` does not rule anything either; it is a stamp.

That number is the reason the contract is shaped this way, and it is kept
checkable in `fixtures/reference-fingerprint.json`.

### Why the real record is not a fixture here

The conformance fixture is synthetic, and the real project record's shape is
carried content-free as a fingerprint: key names, types and counts, never a value
a person wrote. Real records hold unshipped strategy and quoted private
conversation, and Groundwork is published. `fingerprint()` exists so a private
record can still act as a conformance fixture in a public repo.

## Files

| | |
|---|---|
| `decision_record.py` | the contract: load, validate, normalize, fingerprint |
| `verify_record.py` | the record invariants, and a cleanup that refuses to guess |
| `decisions_build.py` | `init` (`--template compare`) / `check` (`--json`) / `serve` / `export --format selection` |
| `decisions-server.mjs` | static host, one writable path, `visuals/`, opt-in proxy |
| `app/` | the surface — copied beside each project's record, not linked |
| `fixtures/` | synthetic conformance record, the reference fingerprint, and `compare-demo/` (the synthetic board `--template compare` copies) |
| `visuals.schema.json` | the per-decision screenshot manifest |

## Screenshots

Capture is per-project, because the selectors are. Drive a browser with **IBR**
(never Playwright or Puppeteer directly), resolve each element by selector or
text, screenshot at `iphone-14`, crop, and write `visuals/manifest.json` per
`visuals.schema.json`. Key each entry by the ruleable's id, or `<id>#a` /
`<id>#b` for a compare's options. When an element
cannot be captured, write `{"file": null, "reason": "..."}` — the card then says
so instead of leaving a blank.

```bash
ibr session:start "$BASE" -d iphone-14 -n decision-visuals --detach
ibr session:screenshot "$SESSION" --viewport-only
```

The server hands these out from `<record dir>/visuals/` at `/visuals/<file>`,
resolved by leaf name only so the route cannot be walked out of that directory.

## Boundary

This module does not import from `designer/server/`, `designer/canvas/`,
`designer/engine/` or `designer/dashboards/`, and none of them import from it.
The adaptive walk (`/api/agent/contract`, `/api/agent/answer`) is a different
surface with a different durability contract and is untouched by this one.

## Tests

Run by `scripts/check.sh`, so by `npm test` and every push.

```bash
PYTHONPATH="$PWD" python3 -m pytest -q designer/tests/test_decision_record.py \
    designer/tests/test_decisions_contrast.py \
    designer/tests/test_decisions_build.py \
    designer/tests/test_verify_record.py
node --test designer/tests/test_decisions_client.mjs designer/tests/test_decisions_server.mjs
```

Contrast is **graded, not asserted**: `test_decisions_contrast.py` parses the
token block out of `app/decisions.css` and computes real WCAG ratios in both
themes, so a re-theme is measured rather than broken. The two normalizers
(Python and the browser's) are compared by execution, not by reading, because two
implementations of one rule drift silently and the drift shows up as a decision
landing in the wrong lane on one surface and not the other.
