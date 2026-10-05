# Canvas workspace

The iterate workspace keeps the live canvas and feedback pane mounted while a
person moves between sections and screens. Launch it with the existing command:

```sh
node designer/canvas/canvas-server.mjs --file /absolute/path/canvas.html --nav /absolute/path/canvas-nav.json --title "Product review"
```

## Navigation

`canvas-nav.json` retains its existing `{title, groups:[{label, items:[{label,
url, hint?}]}]}` shape. Groups become sections on the left; items become views
within a section across the top. The first group labelled Design, Screens or
Pages supplies the Design screens. If no group matches, Design contains the
home canvas and the supplied groups remain separate sections. A missing or
empty nav keeps the left pane hidden.

Design has Canvas and Screen previews views, with a screen picker when there
are multiple screens. Other sections show their page names across the top.
Back and Home operate within the workspace. Collapse retains accessible section
buttons and stores the preference for this workspace in the browser. On phones,
Pages and Feedback open support panels while the canvas fills the screen.

## Review behavior

The right pane presents the current decision before the freeform note. Existing
preview, Apply choice, lasting preferences, pinning and Live/Hold behavior
remain available. A draft retains its original page and component while the
person browses, and recovers after refresh in the same browser. Send note saves
through the existing feedback endpoint. A failed save retains the draft.

Screen previews use registered page URLs and disable scripts and pointer
interaction in their thumbnails. Open screen opens the actual canvas. Previews
are static documents; applications that need scripts may have incomplete
thumbnails. Refresh screen previews reads the current documents explicitly;
a live canvas reload also refreshes thumbnails. Hold still requires an explicit
refresh to accept a pending canvas update.

Each preview offers Keep, Revise and Unsure plus a quick note. Ratings save
immediately; notes save after 700 ms without further typing. The journal row is
an existing `comment` with `source: "screen-preview"`, `canvasUrl`, `canvasLabel`,
`reviewRating` and `reviewNote`. These are screen review signals, not a decision
engine ruling. Failed or interrupted saves keep the draft in the browser and
provide Retry save. Successfully saved feedback reloads from the file journal.
Clearing an unsent draft does not delete an earlier saved row.

Browser drafts use local storage scoped to the workspace origin. They remain
local to that browser and are not sent to a model until saved. Saved feedback
means the server appended the journal; it does not prove that the host agent
read or applied it. Screen cards show “Saved · awaiting agent review” until
the host commits the exact journal checkpoint after processing. “Reviewed by
agent” acknowledges that routing; it does not prove a design change was applied.
New feedback on that screen returns to awaiting review. A missing or stale
checkpoint reviews no current rows; an unreadable checkpoint displays “Saved ·
review status unavailable”. The host drains feedback between turns and publishes
updated canvas/status files.

## Compatibility and verification

The server adds read-only `GET /__canvas/feedback` with
`{rows, invalidRows, reviewedThroughId, reviewStatusAvailable}`. The server only
reads the agent-owned cursor checkpoint; it never changes it. Feedback SSE
updates and reconnects refresh the projection without replacing browser drafts.
Missing journals return no rows; malformed lines are counted while valid rows
remain visible; a read failure returns HTTP 500. User text renders through text
nodes and textarea values.

`designer/tests/test_canvas_workspace.mjs` exercises real browser navigation,
compact mode, screen feedback attribution, journal rehydration, retained drafts,
failed save/retry, Hold, and phone fit. The existing rail and shell browser tests
cover decision order and optional navigation columns. Run `npm test` for the
required repository gate.
