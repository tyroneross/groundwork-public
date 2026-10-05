#!/usr/bin/env python3
# ───────────────────────────────────────────────────────────────────────
# Groundwork — canvas feedback cursor + atomic status writer (agent-side)
#
# WHAT: the agent-private half of PROTOCOL.md §6 (reliability contract). Two
#       jobs, both stdlib, both file-based so they survive a compacted or
#       restarted host-agent session:
#         1. read-new / commit — drains .canvas/feedback.jsonl without an
#            in-memory offset. The cursor lives on disk (.canvas/cursor.json)
#            and dedups by the full `id` STRING, not by <seq>.
#         2. write-status — writes .canvas/status.json via write-temp-then-
#            os.replace so the server (a concurrent reader) never observes a
#            half-written file.
#
# WHY id-string dedup, not <seq>: feedback ids are stamped `fb-<epoch-ms>-
# <seq>` by canvas-server.mjs (PROTOCOL.md §5). <seq> is an in-process
# counter that resets to 0 on every server restart, so two rows from two
# different server lifetimes can share the same <seq> while being distinct
# rows. The epoch-ms component is what keeps the full id string unique
# across restarts; a cursor keyed on <seq> alone would silently re-consume
# (replay) or skip rows the moment the server restarts mid-session. So the
# cursor stores `last_id` as the full string and finds its position in the
# CURRENT feedback.jsonl by exact string match, then takes everything after
# it as new. feedback.jsonl is append-only (server-owned, §1), so "after
# last_id's position" is well-defined regardless of what <seq> looks like.
# If last_id can't be found (first run, or the control dir was reset), every
# row currently on disk is treated as new — degrade to "read everything"
# rather than silently drop rows.
#
# Pure stdlib. No third-party imports. No network. No API calls.
# Self-test:  python3 designer/canvas/feedback_cursor.py --selftest
# ───────────────────────────────────────────────────────────────────────

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Optional

CURSOR_NAME = "cursor.json"
STATUS_NAME = "status.json"
FEEDBACK_NAME = "feedback.jsonl"


def _ctrl_dir(canvas_dir: str) -> str:
    return os.path.join(canvas_dir, ".canvas")


def _feedback_path(canvas_dir: str) -> str:
    return os.path.join(_ctrl_dir(canvas_dir), FEEDBACK_NAME)


def _cursor_path(canvas_dir: str) -> str:
    return os.path.join(_ctrl_dir(canvas_dir), CURSOR_NAME)


def _status_path(canvas_dir: str) -> str:
    return os.path.join(_ctrl_dir(canvas_dir), STATUS_NAME)


# ---------------------------------------------------------------------------
# read-new  (idempotent — never advances the cursor)
# ---------------------------------------------------------------------------

def _load_feedback_rows(canvas_dir: str) -> list[dict[str, Any]]:
    """Parse feedback.jsonl into an ordered list of rows.

    Corrupt/partial trailing lines (a read racing a mid-append write) are
    skipped rather than raising — graceful degradation over a hard failure.
    """
    path = _feedback_path(canvas_dir)
    rows: list[dict[str, Any]] = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except (ValueError, TypeError):
                    continue  # skip a torn line rather than fail the whole read
    except FileNotFoundError:
        return []
    return rows


def load_cursor(canvas_dir: str) -> dict[str, Any]:
    """{"last_id": "<id>"|None, "count": int}. Absent file => never consumed."""
    path = _cursor_path(canvas_dir)
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return {"last_id": data.get("last_id"), "count": int(data.get("count", 0))}
    except (FileNotFoundError, ValueError, TypeError):
        return {"last_id": None, "count": 0}


def read_new(canvas_dir: str) -> list[dict[str, Any]]:
    """Return feedback rows not yet consumed, per the on-disk cursor.

    Dedups by the full `id` string (see module docstring for why not <seq>):
    finds `last_id`'s position in the CURRENT append-only file and returns
    everything after it. If `last_id` is unset or not found, returns every
    row currently on disk. Does NOT advance the cursor — call `commit` for
    that; read-new is safe to call repeatedly with no side effects.
    """
    rows = _load_feedback_rows(canvas_dir)
    cursor = load_cursor(canvas_dir)
    last_id = cursor.get("last_id")
    if not last_id:
        return rows
    for i, row in enumerate(rows):
        if row.get("id") == last_id:
            return rows[i + 1 :]
    # last_id not found in the current file (control dir reset, or the file
    # was rotated out from under us) -> degrade to "everything is new"
    # rather than silently dropping rows.
    return rows


# ---------------------------------------------------------------------------
# commit — the only thing that advances the cursor; atomic temp+rename
# ---------------------------------------------------------------------------

def _atomic_write_json(path: str, data: Any) -> None:
    """write-temp-then-rename in the SAME directory so rename is atomic
    (same filesystem) and a concurrent reader never observes a partial file.
    """
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, f".{os.path.basename(path)}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=False)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)  # atomic on POSIX + Windows, same filesystem


def commit_cursor(canvas_dir: str, last_id: str, count: int) -> dict[str, Any]:
    """Persist the new read position. Called AFTER the agent has actually
    routed the drained rows into the decision engine — commit is the "I'm
    done with these" signal, kept separate from read so a crash between
    read and commit replays (never silently skips) on the next turn.
    """
    cursor = {"last_id": last_id, "count": int(count)}
    _atomic_write_json(_cursor_path(canvas_dir), cursor)
    return cursor


# ---------------------------------------------------------------------------
# write-status — atomic status.json write (the mechanism PROTOCOL.md §6
# requires of the agent so the server relay never serves a half-written file)
# ---------------------------------------------------------------------------

def write_status(canvas_dir: str, payload: Any) -> str:
    path = _status_path(canvas_dir)
    _atomic_write_json(path, payload)
    return path


# ---------------------------------------------------------------------------
# CLI  (mirrors designer/decide/elicit.py's JSON-relay style)
# ---------------------------------------------------------------------------

def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="designer.canvas.feedback_cursor", description=__doc__)
    ap.add_argument("--selftest", action="store_true", help="run the self-test and exit")
    sub = ap.add_subparsers(dest="cmd")

    p_read = sub.add_parser("read-new", help="emit unconsumed feedback rows as a JSON array")
    p_read.add_argument("--dir", required=True, help="canvas dir (parent of .canvas/)")

    p_commit = sub.add_parser("commit", help="advance the cursor (atomic)")
    p_commit.add_argument("--dir", required=True)
    p_commit.add_argument("--last-id", required=True)
    p_commit.add_argument("--count", required=True, type=int)

    p_status = sub.add_parser("write-status", help="atomically write .canvas/status.json")
    p_status.add_argument("--dir", required=True)
    p_status.add_argument("--file", required=True, help="path to a status JSON file, or '-' for stdin")

    args = ap.parse_args(argv)

    if args.selftest:
        _selftest()
        return 0

    if args.cmd == "read-new":
        print(json.dumps(read_new(args.dir), indent=2))
        return 0

    if args.cmd == "commit":
        cursor = commit_cursor(args.dir, args.last_id, args.count)
        print(json.dumps(cursor, indent=2))
        return 0

    if args.cmd == "write-status":
        raw = sys.stdin.read() if args.file == "-" else open(args.file, encoding="utf-8").read()
        try:
            payload = json.loads(raw)
        except (ValueError, TypeError) as e:
            print(f"write-status: invalid JSON input: {e}", file=sys.stderr)
            return 1
        path = write_status(args.dir, payload)
        print(json.dumps({"ok": True, "path": path}, indent=2))
        return 0

    ap.print_help()
    return 1


# ---------------------------------------------------------------------------
# Self-test:  python3 designer/canvas/feedback_cursor.py --selftest
# ---------------------------------------------------------------------------

def _selftest() -> None:
    import shutil
    import tempfile

    fails = 0

    def check(name: str, cond: bool) -> None:
        nonlocal fails
        if not cond:
            fails += 1
            print(f"  FAIL: {name}")
        else:
            print(f"  ok:   {name}")

    tmp = tempfile.mkdtemp(prefix="gw-canvas-selftest-")
    try:
        canvas_dir = tmp
        ctrl = _ctrl_dir(canvas_dir)
        os.makedirs(ctrl, exist_ok=True)
        fb_path = _feedback_path(canvas_dir)

        # 1. seed feedback.jsonl with 3 rows (simulates one server lifetime,
        #    epoch-ms bucket 1000, seq 0..2)
        rows_a = [
            {"ts": "2026-01-01T00:00:00Z", "id": "fb-1000-0", "kind": "comment", "text": "a"},
            {"ts": "2026-01-01T00:00:01Z", "id": "fb-1000-1", "kind": "lean", "text": "b"},
            {"ts": "2026-01-01T00:00:02Z", "id": "fb-1000-2", "kind": "lock", "text": "c"},
        ]
        with open(fb_path, "w", encoding="utf-8") as f:
            for r in rows_a:
                f.write(json.dumps(r) + "\n")

        # 2. read-new with no cursor -> all 3, and read is idempotent
        new1 = read_new(canvas_dir)
        check("read-new: no cursor returns all 3 rows", len(new1) == 3)
        new1_again = read_new(canvas_dir)
        check("read-new: idempotent (no cursor advance as a side effect)",
              new1_again == new1)

        # 3. commit the last id
        commit_cursor(canvas_dir, last_id=rows_a[-1]["id"], count=3)
        cursor = load_cursor(canvas_dir)
        check("commit: last_id persisted", cursor["last_id"] == "fb-1000-2")
        check("commit: count persisted", cursor["count"] == 3)

        # 4. read-new again -> 0 (all consumed)
        new2 = read_new(canvas_dir)
        check("read-new: fully consumed returns 0 rows", len(new2) == 0)

        # 5. append 2 more rows simulating a SERVER RESTART: epoch-ms bucket
        #    changes to 500 (earlier ms is possible after a restart — clock
        #    doesn't matter, only the string differs) and <seq> resets to 0,
        #    colliding numerically with the old seq 0/1 but NOT the full id.
        rows_b = [
            {"ts": "2026-01-01T00:05:00Z", "id": "fb-500-0", "kind": "comment", "text": "d"},
            {"ts": "2026-01-01T00:05:01Z", "id": "fb-500-1", "kind": "never", "text": "e"},
        ]
        with open(fb_path, "a", encoding="utf-8") as f:
            for r in rows_b:
                f.write(json.dumps(r) + "\n")

        new3 = read_new(canvas_dir)
        check("read-new: post-restart rows detected despite seq reset (2 rows)",
              len(new3) == 2)
        check("read-new: dedup is by full id string, not seq (fb-500-0 != stale fb-1000-0)",
              [r["id"] for r in new3] == ["fb-500-0", "fb-500-1"])

        # commit again, then verify full drain
        commit_cursor(canvas_dir, last_id=rows_b[-1]["id"], count=5)
        check("read-new: drained again after second commit", len(read_new(canvas_dir)) == 0)

        # 6. atomic status write: no half-written file ever visible, valid JSON
        status_payload = {"confidence": 0.42, "ready": False, "next_question": "spacing.density"}
        path = write_status(canvas_dir, status_payload)
        check("write-status: file exists", os.path.exists(path))
        with open(path, encoding="utf-8") as f:
            loaded = json.load(f)
        check("write-status: round-trips valid JSON", loaded == status_payload)
        tmp_leftover = os.path.join(ctrl, f".{STATUS_NAME}.tmp")
        check("write-status: no leftover temp file after rename", not os.path.exists(tmp_leftover))

        # overwrite again to confirm atomic replace works on a second write
        status_payload2 = {"confidence": 0.9, "ready": True, "next_question": None}
        write_status(canvas_dir, status_payload2)
        with open(path, encoding="utf-8") as f:
            loaded2 = json.load(f)
        check("write-status: second atomic write replaces cleanly", loaded2 == status_payload2)

        # missing feedback.jsonl -> read-new degrades to empty, not an error
        empty_dir = tempfile.mkdtemp(prefix="gw-canvas-selftest-empty-")
        try:
            check("read-new: missing feedback.jsonl returns [] (no crash)",
                  read_new(empty_dir) == [])
        finally:
            shutil.rmtree(empty_dir, ignore_errors=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if fails:
        print(f"SELFTEST: {fails} FAILED")
        raise SystemExit(1)
    print("SELFTEST: all cases pass (idempotent read, id-string dedup across "
          "seq-reset, atomic commit, atomic status write)")


if __name__ == "__main__":
    if "--selftest" in (sys.argv[1:] or []):
        _selftest()
    else:
        raise SystemExit(main(sys.argv[1:]))
