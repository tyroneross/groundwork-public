---
description: Plan a whole app and codify its product schema, UI/UX, design patterns, architecture, and build-ready handoff.
argument-hint: "[describe the product, existing app, artifact, or UI preference you want to define or improve]"
---

# /groundwork:run

The Claude Code entrypoint for Groundwork.
activation_surface_id: groundwork-claude-run-v1-7e4a9c2f

Request: **$ARGUMENTS**

## Authenticated activation probe

If `$ARGUMENTS` begins with `GROUNDWORK_ACTIVATION_PROBE`, do not enter the
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
command's `activation_surface_id` as `activationSurfaceId`. Also return it as
`GROUNDWORK_SURFACE_ID <value>`, then the requested activation-ready marker.
This probe is a release control: never synthesize the session or omit the
installed resolver execution.

Read `${CLAUDE_PLUGIN_ROOT}/references/router.md` completely. Supply
`$ARGUMENTS` as the request and `${CLAUDE_PLUGIN_ROOT}` as the Groundwork root,
then follow the shared routing contract exactly.

If the selected flow launches Designer with an existing-app visual bootstrap,
keep this command active as the adaptive host driver after the browser opens.
Follow the shared loopback contract in `references/explore-ui.md`: launch with
`--bootstrap <file>`, poll `GET /api/agent/contract`, post the full filled
contract to `POST /api/agent/answer`, retry stale turns, and continue until the
walk converges or the user explicitly pauses.

When the router selects the `design` flow and interactive browser capture is
wanted, launch **Groundwork: Requirements** per
`${CLAUDE_PLUGIN_ROOT}/references/requirements-studio.md` (that file holds the
exact, gate-checked launch command) and drive it as the host agent. The chat
`design` flow remains the first-class fallback; the Spec and emitter contract are
identical either way.

When the selected `design` flow reaches a build handoff, use the generated
`build-request.json` as immutable machine-readable intent and
`builder-handoff.md` as the self-contained human/agent directive. If the request
includes a Build Loop implementation map, run the `references/design.md`
reconciliation path against the existing artifact directory. Do not treat a
returned map as verified merely because it parses: Groundwork must validate its
versions, run and digests, target/evidence identities, paths, timestamps, and
passing test or runtime evidence before writing `convergence.json`.

## Plugin bugs and feature requests

For a bug or a feature request about the plugin itself, use `/groundwork:submit-feedback`. It
drafts the GitHub issue and files it only after the user approves the exact text.
