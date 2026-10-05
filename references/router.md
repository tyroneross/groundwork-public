# Groundwork Router

Route a plain-language whole-app planning or UI/UX design request to the right
Groundwork starting flow. Groundwork codifies product schema, requirements,
flows, screens, states, design patterns, architecture, implementation plans,
acceptance criteria, and tests before handing production work to a builder. Do
not make the user learn internal modes. Start with one primary flow, then
continue into another only when the requested outcome spans written definition
and visual convergence.

## Host contract

Accept two inputs from the host entrypoint:

- **Request**: the user's complete request, unchanged.
- **Groundwork root**: the absolute plugin directory containing `references/`,
  `designer/`, and `engine/`.

Claude Code resolves the root through `${CLAUDE_PLUGIN_ROOT}`. Codex resolves it
from the installed `skills/groundwork/SKILL.md` location. When a selected flow
contains `${CLAUDE_PLUGIN_ROOT}`, substitute the resolved Groundwork root before
executing its commands.

When `explore-ui` resolves an existing-app bootstrap, launching the browser does
not complete the host task. Both hosts must pass `--bootstrap <file>`, remain
attached through the shared `/api/agent/contract` → `/api/agent/answer` loop in
`references/explore-ui.md`, and stop only on convergence or an explicit user
pause. A bare launch with no bootstrap retains the Standard/manual entry.

## Default diagram owner

For any Groundwork process-flow, workflow, data-flow, or sequence diagram, use
Diagram Intelligence by default and read `references/process-diagrams.md`.
Apply this across every planning experience and flow, on Claude, Codex, and
other hosts. Respect an explicit user choice of another tool or format. A
plain question that needs only prose does not require a diagram.

The host retains product reasoning and Spec ownership. Diagram Intelligence
maps evidence into graph views; it does not launch or automate the process it
depicts. Resolve its skill from the host's available skill catalog rather than
assuming a Claude environment variable or a particular cache path. If it is
unavailable, follow the documented fallback and disclose the limitation.

## Starting-stage contract

Classify the user's starting point before routing:

| Starting point | Evidence to use | Required behavior |
|---|---|---|
| Initial idea | The request and any supplied source material | Build the minimum complete definition; ask only questions that change the result. |
| Existing definition | `spec.json`, requirements, architecture, build request, convergence, design docs, mockups, or tokens | Read the artifacts first, preserve decisions, and update the canonical Spec rather than restarting. Treat implementation evidence as delivery state, not product intent. |
| Existing app or agent | Repository path, running URL, package manifests, source, tests, and current design artifacts | Inspect current behavior and architecture before recommending a delta. Separate observed facts, user-confirmed preferences, and assumptions. |
| Known preferences | Stated constraints, examples, prior selections, `DESIGN.md`, `design-tokens.md`, or `selection.json` | Treat them as seeds to preserve or deliberately evolve, not questions to ask again. |

Use chat for reasoning, clarification, current-state synthesis, architecture,
and written artifacts. Use the visual picker or full-screen mockups when a user
needs to recognize, compare, or refine a UI preference. The user may enter at
any stage and should not have to replay earlier stages.

## Choose the planning experience

The primary flow determines the work. The planning experience determines how
the user makes the decisions. These are independent choices and must converge
on the same canonical Spec.

| Experience | Choose when | Implementation |
|---|---|---|
| **Guided ideation** | The user asks for step-by-step guidance, wants an interactive dashboard, starts with a rough idea, or benefits from examples and visible progress | Run the `design` flow through Groundwork: Requirements. Read `references/guided-ideation.md` and `references/requirements-studio.md`. |
| **Chat planning** | The user wants a fast conversation, supplies a mature definition, or the next question has no useful visual referent | Run the selected written flow in chat. |
| **Mockup comparison** | The user needs several visual directions before choosing | Run `references/mockups.md`. |
| **Live canvas** | The user has one direction and wants to refine it in place | Run `references/iterate.md`. |
| **Compare decisions** | The user must choose between what exists (A) and a proposal (B) across one or more items, or asks to "compare options", "decide A vs B", or "record my decisions" | Build a compare board with `designer/decisions` (`init --template compare`, `serve`, `export --format selection`). Commands and record fields: `AGENTS.md`. The export feeds `references/mockups.md` §5. |

Do not silently force Guided ideation merely because a browser exists. When two
experiences are genuinely live and the request does not indicate a preference,
offer the smallest useful choice and recommend one with a concrete reason. Once
chosen, preserve that experience across resume unless the user asks to switch.
Switching the surface must retain prior decisions, provenance, drafts, and
generated files.

Decisions with a visual referent (layout, component, screen structure) default to the canvas surface; use a terminal question only for a non-visual structural fork, and say why.

## Whole-product coordination

Before routing a material existing-product visual change, confirm behavior, baseline, direction, delta, architecture implications, and verification—not only style.

The product design manager owns the route even when the user asks for one
screen, one research question, or one architecture choice. Invoke only the
specialists the decision needs, but preserve the downstream impact record:

- `skills/ui-ux-researcher/SKILL.md` for evidence that could change the choice;
- `skills/interface-designer/SKILL.md` for flows, screens, states, interaction,
  accessibility, responsive behavior, and visual direction;
- `skills/product-design-architect/SKILL.md` before a material UI or workflow
  change is called build-ready.

The manager does not force every stage to completion. It records inapplicable,
assumed, and unresolved links so the user's immediate work can finish without
losing whole-product continuity.

## Route

Classify the request by intent, then read the matching reference completely and
follow its instructions. Resolve every flow path against the Groundwork root,
never against the user's current project directory:

| Intent | Typical request language | Flow |
|---|---|---|
| Iterate on ONE living canvas through conversation until it converges | "iterate on the UI", "keep refining this", "talk through the design", "make it more dynamic", "let's work on this screen", "adjust this as we discuss the app" | `references/iterate.md` |
| Discover, capture, or evolve design taste through concrete choices | "help me figure out the design", "capture my preferences", "keep this style but improve it", "guide me on the UI", "pick a look", "design system", "design tokens" | `references/explore-ui.md` |
| Compare full-screen UI options or redesign a screen | "show me options", "mockups", "redesign this screen", "improve the UI", "gallery", "make it look like" | `references/mockups.md` |
| Plan the whole app; define, hand off, or reconcile its written product and technical system | "plan this app", "spec this out", "write the PRD", "codify the schema", "architecture", "requirements", "understand this app", "audit this agent", "what should I build", "send this to Build Loop", "reconcile this implementation map" | `references/design.md` |

Match intent rather than exact keywords. Route design-taste uncertainty to the
visual `explore-ui` flow. Route explicit requests for a PRD or written spec to
the `design` flow. For an existing product, `design` captures current state and
the desired delta; `explore-ui` extracts or imports the current visual system
before asking the user to confirm or evolve it.

**Trusted LAN review is a delivery option, not a new Groundwork flow.** When the
user asks to open a canvas on a phone or collect feedback from someone on the
same Wi-Fi, route the design intent normally, launch Groundwork on loopback, then
use the installed `$share-lan-preview` skill to place its expiring token proxy in
front of the canvas. Keep the canvas server on `127.0.0.1`; do not weaken its
loopback-only protocol or create a public tunnel.

**Divergence vs convergence** — `mockups` and `iterate` are two halves of visual
work. `mockups` DIVERGES: it authors several distinct full-screen directions to
compare when the space is wide and the user needs breadth ("show me options").
`iterate` CONVERGES: it pins ONE living canvas and refines it through an ongoing
conversation, using the decision-elicitation engine (values → veto →
information-gain-ordered questions → stop) so the design lands in the fewest
interactions. Route "show me / compare options" to `mockups`; route "let's work
on this / keep refining / make it dynamic" to `iterate`. A common chain is
`mockups` to pick a starting direction, then `iterate` to drive it home — and
`iterate` seeds directly from `mockups/selection.json` when it exists.

When a request needs both a complete written definition and visual preference
work, start with `design` if there is no canonical `spec.json`; otherwise start
with the user's dominant requested outcome. Continue into `mockups` or
`explore-ui` without repeating settled questions.

**Groundwork: Requirements (Guided ideation implementation).** When the `design`
flow and Guided ideation experience are selected, launch Groundwork:
Requirements — the same interview rendered as chips / text / keep-kill cards /
tradeoff-allocation rounds with a live coverage bar. Read
`references/guided-ideation.md`, then `references/requirements-studio.md`, and
launch its survey server; you (the host agent) drive it by long-polling
`/api/agent/contract`, and you assemble the **same `SpecSchema` and run the same
emitter** as the chat flow. The **chat `design` flow remains a first-class
alternative**; the Spec and emitter contract are identical either way (no
browser → stay in chat with no loss).

## Empty or ambiguous request

- If a Groundwork set exists under `~/dev/designs/` or `<repo>/.designdoc/` and
  the request says "continue" or "next", choose the natural missing artifact:
  spec without mockups routes to `mockups`; a selected mockup the user now wants
  to refine routes to `iterate`; selected mockups without tokens routes to
  `explore-ui`; an existing implementation without a current Spec routes to
  `design`.
- Otherwise explain in one line that Groundwork can guide the idea in a
  step-by-step dashboard, plan it in chat, compare full-screen mockups, or refine
  one living canvas. Recommend Guided ideation for a rough product idea and ask
  only when another experience is equally plausible.
- Default "go" or "help me design" to `explore-ui`, because it provides the
  concrete narrowing experience rather than an open-ended interview.

Route decisively and keep the selected flow's validation and reporting steps
intact. Completion means the relevant artifact set is current enough for the
next real user action. A build handoff requires the generated, digest-bound
`build-request.json`; a delivery-verification request requires a validated
`implementation-map.json` and Groundwork-owned `convergence.json`. It does not
require every Groundwork artifact on every run.
