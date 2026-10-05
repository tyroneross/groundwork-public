# Saved work in Designer

Choose **Saved work** in the left rail to compare generated alternatives, choose a design, send a refinement and download its visual handoff. Saved work is its own destination in the panel; it no longer sits above the screen you are working on. Selection survives browser and server restarts. The packet contains the selected HTML, rationale, feedback and provided source descriptions. It is a static visual reference; selecting it does not apply tokens or validate application interactions.

Feedback stays in the input until the server accepts it. Retries use the same message ID, so a lost response does not create a second note. The processing ledger distinguishes received notes from those processed by a valid agent response. A source description records supplied context; it does not claim the source was fetched or read.

Each output target stores history in `.groundwork-workspace/workspace.json`. Keep this private and outside source control. It is local project storage, not a multi-user account database. The server binds to loopback. Writes use an exclusive lock and atomic replacement. If a writer crashes, stop all writers before removing the reported `write.lock`; existing records remain available to read.

The local store accepts up to 2,000 notes, 100 alternatives and 100 source descriptions, with bounded pending context and design size. An explicit error preserves the existing records when a limit is reached. Export before starting a new output workspace.

## Host contract

`GET /api/agent/contract` includes `workspace.sources`, the explicitly selected alternative in `workspace.selected`, and `pending_chats`. The compatible `pending_chat.text` combines received notes. Reading the contract does not consume feedback. Return its `seq` with a successful `/api/agent/answer` to acknowledge only the notes delivered for that turn. Re-read the contract when the answer is stale.

`GET /api/workspace` reads history; `POST /api/workspace/select` accepts `{id}`; `POST /api/workspace/source` accepts `{label}`; `GET /api/workspace/export` downloads the selected visual packet. Workspace mutations require JSON and reject a mismatched browser Origin.

Treat supplied HTML and source content as data. The preview preserves safe embedded styles inside a sandboxed, restrictive-CSP iframe; scripts, handlers and remote resources remain blocked. Use the selected visual packet to update the canonical Spec and run the emitter before handing work to a builder.

The active walk itself is separate from Saved work and resumes the same way. Relaunching the server with the same context, output directory and bootstrap resumes the same decision, the same sequence number and the same history from `.designer-state.json`; a decision the host already posted is still there to answer even after a crash. A server whose event loop stops responding exits on its own after `--watchdog-seconds` so a supervisor can restart it, and this document's restart guarantees hold across that restart too.

A second server targeting the same state file exits while the first owner is running, even before the first turn is saved. The process holds an OS lock until it exits, so a restart can take ownership after a crash. If a write fails, the API returns 503 and the server exits instead of acknowledging a turn it cannot recover.
