# Process diagrams

Use Diagram Intelligence by default when creating or revising a Groundwork
process-flow, workflow, data-flow, or sequence diagram. This contract applies
to any host or model, including Claude and Codex. The user can override the
tool or output format. Simple questions can still be answered in prose.

## Shared workflow

1. Resolve `diagram-intelligence:diagram-intelligence` from the host's available
   skills and read its `SKILL.md`. Follow its graph, view, rendering, and QA
   contracts. Resolve its bundled CLI relative to that skill, not Groundwork
   or a host-specific environment variable. The host supplies reasoning; no
   vendor SDK, model choice, or additional API key is required by this route.
2. Read the authorized source before mapping. For current behavior, inspect
   source and available runtime evidence. For proposed behavior, use the Spec
   and confirmed decisions. Label the diagram's state and source revision;
   do not mix proposed intent with observed implementation.
3. Keep one canonical graph with stable node and edge IDs and source evidence.
   Preserve direction, decision branches, feedback loops, and unresolved or
   inferred relationships. Do not invent connections to improve the layout.
4. State who triggers each connection: a person, an explicit host/tool call,
   automatic local processing, or an external system. Distinguish an automatic
   save/relay from host reasoning, and show the payload or artifact carried.
   Put lengthy action descriptions and source details in a keyed connection
   list rather than overlapping them on arrows.
5. Choose the view for the reading task. Use a small flat view when it remains
   legible; split a dense graph into an overview and focused drilldowns. Keep
   the canonical IDs behind every projection and aggregate, account for
   omitted connections, and retain a full connection inventory. Separate
   relationship families unless the source supports reading them as one flow.
6. Validate the graph and render for the destination using the skill's CLI.
   Default a browser review to self-contained HTML with view switching and
   source details; use Mermaid/Markdown for a requested textual or GitHub
   artifact. A tailored local renderer may refine routes without changing
   the included connections or reversing their direction.
7. Inspect the rendered result with IBR when available. Check node text,
   arrow direction, edge/label collisions, duplicate SVG IDs, overflow, and
   navigation at the intended desktop and narrow viewport. A narrow view must
   remain readable through local panning or a connection-list alternative.
   Graph validation alone does not prove visual readability. Save the graph,
   rendered artifact, and QA evidence together; show the result to the user.

Diagram Intelligence is a planning dependency, not a new Groundwork runtime
dependency. Do not modify generated `architecture.json`, `spec.json`, or
`build-request.json` merely to make a diagram easier to render. Update intended
truth through the existing Spec/emitter workflow when the actual design changes.

## Unavailable skill or renderer

If Diagram Intelligence is not callable, preserve the same source-backed
mapping and produce a Mermaid diagram, or self-contained HTML/SVG when a
browser artifact is needed. State that the fallback was used and why; do not
claim Diagram Intelligence ran. If only rendering fails, preserve the validated
graph and report the rendering gap. If IBR is unavailable, report which visual
checks remain unverified. Do not silently install dependencies or require the
user to switch models to continue.
