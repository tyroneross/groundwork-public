# AGENTS.md

Instructions for any coding agent working with Groundwork: Codex, Claude, or
another. Every command here is plain shell, runs from the root of this
repository, and needs only `python3` and `node`. Nothing depends on a
host-specific environment variable.

For whole-app planning (spec, flows, mockups, build handoff), start at
`skills/groundwork/SKILL.md`, which routes through `references/router.md`.

## Default process diagrams

Use Diagram Intelligence for process-flow, workflow, data-flow, and sequence
diagrams by default. This applies to every host and model, including Claude and
Codex. Follow `references/process-diagrams.md`; the user can request another
tool or format. If the skill is unavailable, state the fallback explicitly.

## Record A-or-B decisions (the compare board)

Use this when the person says "compare options", "decide A vs B", "which
version do I keep", or "record my decisions". Each decision shows option A
(keep what exists) beside option B (the proposal). The person answers
**Keep A**, **Approve B**, **Revise B**, or **Neither**, and adds a note.
Revise B and Neither require the note. The board works on a phone.

Full contract: [`designer/decisions/README.md`](designer/decisions/README.md).

### 1. Create the board

```bash
python3 -m designer.decisions.decisions_build init <repo> --slug <slug> --template compare
```

This writes `<repo>/.groundwork/decisions/<slug>/`: `decisions.json` (the record)
and `visuals/`. The page is served from this install, never copied beside the
record. A board made before the store existed (`<repo>/.designdoc/<slug>/`) is
copied in, without changing the original, by
`python3 -m designer.project migrate --repo <repo>`. The template
holds three synthetic decisions. Replace them with real ones. Each item in
`compares[]` looks like this:

```json
{
  "id": "home-intro",
  "area": "Home",
  "question": "How should the home page introduce the product?",
  "why": "One line on why this needs deciding.",
  "optionA": { "summary": "What exists now, in one line.", "visual": "home-current.png" },
  "optionB": { "summary": "The proposal, in one line.", "visual": "home-proposed.html",
               "mockup": "home-b.html" },
  "secondOpinion": { "source": "Persona panel", "verdict": "approve", "note": "Optional." }
}
```

- `visual` is a plain file name inside `visuals/`: a `.png`/`.jpg`/`.webp`
  screenshot, or a static `.html` wireframe (served sandboxed; scripts never run).
- Capture screenshots with IBR, never Playwright directly
  (`ibr session:start <url> -d iphone-14 --detach`, then
  `ibr session:screenshot <session>`). If no picture can exist, add
  `"<id>#a": {"file": null, "reason": "..."}` to `visuals/manifest.json`.
- `mockup` is optional: a path relative to the design's `mockups/` directory.
  The export uses it as `html_path`.

### 2. Validate, then serve

```bash
python3 -m designer.decisions.decisions_build check <repo>/.groundwork/decisions/<slug>/decisions.json
python3 -m designer.decisions.decisions_build serve <repo> --slug <slug> --port 8920
```

`serve` starts the project server for the whole repo in the foreground and
prints its URL (loopback only, next free port if the chosen one is taken). The
board is at `<URL>decisions/<slug>/`; the page at `<URL>` shows every board plus
the canvas, saved work, Spec and project memory. Run it in the background, give the person the URL, and
wait for them to answer. Clicking an answer writes it to the file immediately.
Notes save as the person types. A note alone never counts as an answer.

### 3. Read the answers back

```bash
python3 -m designer.decisions.decisions_build check <repo>/.groundwork/decisions/<slug>/decisions.json --json
```

The answers live in the record itself, `compares[].ruling` (`keep-a`,
`approve-b`, `revise-b`, `other`), with the note in `compares[].rulingText` and
the time in `compares[].ruledAt`. An item is answered when `ruling` is present
and non-blank. Never infer that from `status`, which is free prose.

### 4. Export to the mockup flow

```bash
python3 -m designer.decisions.decisions_build export <repo>/.groundwork/decisions/<slug>/decisions.json --format selection --out <design-dir>/mockups/selection.json
```

This writes `groundwork.mockups.selection/v1` (`references/mockups.md` §5):
keep-a → `A`, approve-b → `B`, revise-b → `B-revise`, other → `other`, one
`perScreen` row per answered decision, keyed by its id. Unanswered decisions are
left out and counted in `unanswered`. The export refuses a record that holds a
Revise B or Neither with no note.

### Rules when an agent edits a record

- Never change or clear a ruling the person made. Add new items instead.
- Never write `status`. Keep unknown keys; the format is open.
- A record can hold private product plans. Do not copy one, or its
  screenshots, into this repository. Fixtures here are synthetic.

## One project store per repo

Every Groundwork tool keeps a repo's data in `<repo>/.groundwork/` (decision
boards, notes from every section, preferences, Designer's saved work, Spec
pointers). Read and write it with:

```bash
python3 -m designer.project status   --repo <repo>
python3 -m designer.project read     --repo <repo> --contract --json   # pending notes, preferences, rulings; changes nothing
python3 -m designer.project feedback --repo <repo> --section decisions --text "..."
python3 -m designer.project ack      --repo <repo> <note-id>           # only after acting on it
python3 -m designer.project serve    --repo <repo>                     # one URL: Decisions, Canvas, Saved work, Spec, Memory
python3 -m designer.project snapshot --repo <repo>
```

`bin/groundwork project <verb>` is the same CLI. Contract: `docs/project-store.md`.

## Tests

```bash
npm test
```

`npm test` runs `scripts/check.sh`, the full gate, which needs Chrome or
Chromium. For the decision surface alone:

```bash
PYTHONPATH="$PWD" python3 -m pytest -q designer/tests/test_decision_record.py designer/tests/test_decisions_build.py designer/tests/test_decisions_contrast.py designer/tests/test_verify_record.py
node --test designer/tests/test_decisions_client.mjs designer/tests/test_decisions_server.mjs
```
