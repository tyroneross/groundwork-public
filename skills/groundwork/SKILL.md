---
name: groundwork
description: Use Groundwork to plan a whole app and codify its product schema, requirements, UI/UX flows, screens, states, design patterns, architecture, implementation plan, acceptance criteria, traceability, and Build Loop handoff. Trigger for a raw idea, an existing app, design preferences, mockups, or any product definition that must stay coherent across the full system. Also trigger to compare options, decide A vs B, or record the user's design decisions on a mobile-friendly compare board.
---

# Groundwork

activation_surface_id: groundwork-codex-skill-v1-b91d6e30

## Authenticated activation probe

If the request begins with `GROUNDWORK_ACTIVATION_PROBE`, do not enter the
normal interactive flow. Read the challenge, target, product name, and contract
path from the
request; resolve the plugin root; then run the installed
`designer/bridge/resolve_visual_session.py` with that complete request,
`--target`, `--name`, and `--format json`, setting `PYTHONPATH` to the plugin
root and `PYTHONDONTWRITEBYTECODE=1`. Do not launch Designer. Return one
single-line JSON object prefixed exactly `GROUNDWORK_LAUNCH_CONTRACT ` with:

- `challenge`: the supplied challenge;
- `session`: the resolver's complete JSON response;
- `launch.serverPath`: the absolute installed `designer-server.mjs` path;
- `launch.args`: `--context`, the complete request, `--name`, the product name,
  `--out`, `session.GW_OUT`, `--bootstrap`, `session.GW_BOOTSTRAP`, and `--drive
  adaptive`.

Atomically write that JSON object to the supplied contract path, adding this
skill's `activation_surface_id` as `activationSurfaceId`. Also return it as
`GROUNDWORK_SURFACE_ID <value>`, then the requested activation-ready marker.
This probe is a release control: never synthesize the session or omit the
installed resolver execution.

Plan and evolve a whole app, agent, or product at any stage: initial idea,
existing definition, functioning implementation, or known preference set. Use
chat-led reasoning and interactive visual choices to codify the product schema,
UI/UX, design patterns, architecture, plans, tasks, tests, and acceptance
criteria a human and Build Loop need to build a functioning result. Do not
implement the production product as part of Groundwork.

## Run the workflow

1. Resolve the Groundwork plugin root as the directory containing
   `.codex-plugin/`, `references/`, `designer/`, and `engine/`. From this file in
   a standard installation, that root is `../..`.
2. Read `../product-design-manager/SKILL.md` completely. It owns stage order,
   decision-science framing, specialist routing, and whole-product coverage.
3. Read `../../references/router.md` completely.
4. Pass the user's full request and the resolved plugin root into that routing
   contract.
5. Read the selected flow reference completely and follow it through its
   verification and report step.

For an existing-app `explore-ui` session, launching Designer is an intermediate
step. Keep the Codex task active as the adaptive host driver: pass the generated
`--bootstrap <file>`, poll `GET /api/agent/contract`, reason over and post the
full filled contract to `POST /api/agent/answer`, retry stale turns, and continue
until convergence or the user explicitly pauses. This is the same transport and stop
contract used by Claude Code.

When a legacy flow reference contains the literal `${CLAUDE_PLUGIN_ROOT}`,
substitute the resolved Groundwork plugin root before executing the command.
Do not require that Claude-specific environment variable in Codex.

## Compare A vs B and record decisions

When the user wants to compare options, decide A vs B, or record their
decisions, use the compare board instead of asking in chat: follow the commands
in `../../AGENTS.md` (`init --template compare`, `serve`, `check --json`,
`export --format selection`). It records Keep A / Approve B / Revise B /
Neither plus a note per item into the project's own Groundwork store,
`.groundwork/decisions/<slug>/`. One URL per repo (`python3 -m designer.project
serve --repo <repo>`) shows every board beside the canvas, saved work, Spec and
project memory; agents read all of it with `python3 -m designer.project read
--repo <repo> --contract --json`.

## Operating boundaries

- Use the host agent as the reasoning model; do not add a vendor SDK or API-key
  requirement to the planning flows.
- Inspect an existing product before proposing changes. Preserve observed facts
  and user-confirmed preferences; label inference and unresolved gaps.
- A narrow UI request stays narrow for the user but not blind for Groundwork:
  track its needs, states, data, entities, components, contracts, flows, failure
  paths, security, telemetry, tasks, and tests when they are material.
- Keep universal interface constraints separate from contextual design
  profiles. Do not make Calm Precision, Warm Craft, or any other profile the
  mandatory Groundwork house style.
- Update the canonical Spec and its projections instead of starting over when a
  Groundwork artifact set already exists.
- Preserve the deterministic engine as the writer for generated spec artifacts.
- Prefer visual choices over an open-ended interview when the request is about
  narrowing design taste.
- Drive design decisions with the elicitation engine, not a fixed questionnaire:
  prune the space with values + hard vetoes first, then ask only the
  highest-information-gain question at each step and stop when it converges. For
  ongoing "iterate on this UI" work, use the live canvas (`iterate` flow) where
  the user comments and decides while one mockup evolves in place.
- Keep `design-system.md` and `design-tokens.md` separate.
- Elicit color, never hand-pick it. The decision engine
  (`designer/decide/color_dimensions`) asks the highest-information-gain color
  *relationship* question (temperature, energy, harmony, contrast feel, accent
  intensity, mode); you phrase it and show the option swatches; the user's picks
  compose the params the relationships engine (`designer/color/`) generates from
  — a vector of relationships (contrast targets, chroma structure, harmony delta)
  → contrast-verified, gamut-safe output. Never hand-pick hex or hand-write the
  params dict. Validate any imported palette with `suggest_improvements`; record
  chosen palettes as combos (`designer/color/combos.jsonl`).
- Hand implementation work to Build Loop only after the requested Groundwork
  artifacts are complete and `builder-handoff.md` embeds the full written
  contract plus any confirmed visual evidence. Use the generated
  `build-request.json` as the immutable machine-readable request; do not
  hand-author or mutate it.
- When Build Loop returns `build-loop.implementation-map/v1`, follow the
  `references/design.md` reconciliation path. Groundwork owns the resulting
  `convergence.json`; it must fail closed on version, run, digest, identity,
  timestamp, path, or evidence mismatches and must never overwrite intended
  Spec truth.
