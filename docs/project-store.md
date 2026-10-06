# One Groundwork project per repo

Every Groundwork tool keeps a repository's data in one directory,
`<repo>/.groundwork/`, and shows it at one local URL. A ruling on a decision
board, a comment typed under the canvas, a preference, a selected design and a
note an agent adds are all readable by every section of the pane, by the CLI and
by agents on their next read.

```
<repo>/.groundwork/
  .gitignore                        "*": the store never enters source control
  project.json                      groundwork.project/v1: notes, preferences, Spec pointers, migration log
  workspace.json                    Designer saved work (alternatives, selection, sources, notes)
  decisions/<slug>/decisions.json   a decision board, groundwork.decision-set/v1, stored byte-for-byte
  decisions/<slug>/visuals/         that board's screenshots and wireframes
  snapshots/<time>/                 byte copies made by `snapshot`
  write.lock, server.json           transient
```

## Open it

```bash
python3 -m designer.project serve --repo <repo>
```

The server binds to `127.0.0.1` on a port derived from the repo path, so a repo
keeps the same URL; a second `serve` for the same repo prints the running URL
instead of starting another server. The page has five sections: **Decisions**
(every board, opened in place; the board app is served from this install, never
copied), **Canvas** (the living canvas page, sandboxed, and its notes),
**Saved work** (Designer alternatives; "Use this design" records the selection),
**Spec** (the Spec files the engine wrote) and **Memory** (preferences, with
scope, provenance and replacement history).

Every section has the same comment box. Typing saves a draft to the store, so it
survives a reload or a restart; **Done** sends it. The line under the box says
which is true: "Draft saved 14:05 — not sent yet" or "Sent 14:06". The notes list
under it switches between this section and all sections.

Each draft write from the pane carries `revision`, a whole number the page
raises by one per write for that draft (`PUT /api/feedback/<id>` and `DELETE`
take it in the JSON body; `upsertDraft({revision})` / `upsert_draft(...,
revision=)` and `deleteDraft(id, revision)` / `delete_draft(id, revision)` in the
libraries). The store keeps the newest one on the note as `draftRevision` and
refuses, with error code `stale` (HTTP 409), any write or delete whose revision
is not greater than it, so a save that arrives late, such as one still in flight
when the page-exit save went out, cannot put older text back. A write without
`revision` (CLI, agents) is accepted as before and leaves `draftRevision`
unchanged. Revisions apply only to drafts: a sent or processed note still
refuses every change with `state`. Deleting a draft that held a revision (or
deleting with one) leaves a tombstone in `project.json` `draftFloors`
(`{"<id>": <revision>}`), so a late write for that id at or below it is refused
with `stale` instead of bringing the draft back; a newer write recreates the
draft and clears the entry. Tombstones are not notes: no list, snapshot or agent
contract shows them.

## Read and write it from a shell or an agent

```bash
python3 -m designer.project read     --repo <repo> --contract --json
python3 -m designer.project read     --repo <repo> --decisions
python3 -m designer.project feedback --repo <repo> --section canvas --text "..."
python3 -m designer.project ack      --repo <repo> <note-id>
python3 -m designer.project prefer add --repo <repo> --text "..." --scope repo
python3 -m designer.project snapshot --repo <repo>
python3 -m designer.project export   --repo <repo> --out <new-dir>
```

`bin/groundwork project <verb>` is the same CLI. The running server also answers
`GET /api/agent/contract` (same shape as `read --contract`) and
`POST /api/agent/ack`. Reading never consumes: no read changes a status, a
revision or a timestamp. A note becomes `processed` only when an agent
acknowledges it after acting on it.

Notes typed in **Saved work** are also delivered to Designer as workspace notes,
so its own agent contract sees them. Notes from the canvas rail stay in the
canvas journal (`.canvas/feedback.jsonl`), which the canvas agent owns; the pane
and the CLI show them read-only with ids prefixed `canvas:`, and `ack` refuses
them because only the canvas agent moves its cursor. Comments typed in the pane's
Canvas section go to the project store, where canvas agents read them with
`read --section canvas`.

## Writes and locking

Python and Node use one library each (`designer/project/project_store.py`,
`designer/project/project-store.mjs`) with the same API and byte-identical
output, checked by `designer/tests/test_project_parity.py`. Every write to any
file under `.groundwork/` takes `.groundwork/write.lock`, writes a temp file in
the same directory and renames it into place. A writer waits up to two seconds
for the lock; a lock left by a dead process on this machine is removed and
reported (renamed aside and re-checked, so two waiters cannot both break it),
any other held lock fails with an error naming its holder, and a writer only
ever removes its own lock.

The server answers only requests addressed to `localhost:<port>` or
`127.0.0.1:<port>` (a DNS-rebinding page gets 421), and every write must come
from the pane's own origin with a JSON body. The optional `--proxy` preview is
served on the pane's origin so the board can overlay choices on it; only proxy
a dev build you trust.

## Migration from the older locations

`serve` runs `migrate` at startup; it can also run alone:

```bash
python3 -m designer.project migrate --repo <repo> --verify
```

It copies boards from `.designdoc/<slug>/` (record and visuals, byte-for-byte;
never the copied app files) and Designer saved work from
`.designdoc/.groundwork-workspace/` or `.groundwork-workspace/`, and records
`.designer-state.json`, the Spec files and canvas folders as pointers. It never
writes, moves or deletes an original. Each source is tracked by content hash in
`project.json` `migrations[]`: `migrated`, `unchanged`, `recopied` (the original changed while the store still held an unedited byte
copy of it, as when an old board server is still open) or `conflict` (anything
else that changed on both sides, including any edit first made in the store;
nothing is written, and the entry names the diverging items). A store edit is
never overwritten by a migration. `--verify` re-reads every migrated board. While the store copy is still the
migrated copy, any ruling, note or time that differs from its source exits 1;
an unreadable store copy also exits 1. A board someone has since answered in
the pane is listed as `storeEdited` with the items that changed, not as a
failure, so verify cannot tell a hand edit that leaves valid JSON from a ruling.
