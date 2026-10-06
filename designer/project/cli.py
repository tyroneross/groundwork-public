"""`groundwork project` — read and write a repository's Groundwork store.

Every Groundwork tool keeps its data for a repository in `<repo>/.groundwork/`:
decision boards, project notes (feedback from every section), preferences,
Designer's saved work, Spec pointers and the migration log. This CLI is the
agent and shell door to the same store the project pane shows.

    python3 -m designer.project status   --repo <repo> [--json]
    python3 -m designer.project migrate  --repo <repo> [--dry-run] [--verify] [--json]
    python3 -m designer.project serve    --repo <repo> [--port N] [--proxy ORIGIN] [--no-migrate]
    python3 -m designer.project read     --repo <repo> [--section S] [--status S] [--decisions] [--contract] [--json]
    python3 -m designer.project feedback --repo <repo> --section S --text T [--target X] [--draft]
    python3 -m designer.project ack      --repo <repo> ID [ID ...]
    python3 -m designer.project prefer   add --repo <repo> --text T [--scope S] [--source agent] [--supersedes ID]
    python3 -m designer.project prefer   list --repo <repo> [--all]
    python3 -m designer.project snapshot --repo <repo>
    python3 -m designer.project export   --repo <repo> --out DIR

Reading never consumes anything: `read` changes no status, revision or time.
Only `ack` marks a note processed. Exit codes: 0 ok, 1 refused / conflict /
verify mismatch, 2 usage or invalid input, 3 lock timeout.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

from designer.project import project_store as ps

INSTALL_ROOT = Path(__file__).resolve().parents[2]
SERVER = INSTALL_ROOT / "designer" / "project" / "project-server.mjs"


def _out(a, value, text: str | None = None) -> None:
    if getattr(a, "json", False) or text is None:
        print(json.dumps(value, indent=2, ensure_ascii=False))
    else:
        print(text)


def _err(msg: str, code: int) -> int:
    print(f"error: {msg}", file=sys.stderr)
    return code


def _store(a) -> ps.ProjectStore:
    return ps.ProjectStore(ps.project_root(a.repo), tool="groundwork-cli")


def _server_url(root: Path) -> str | None:
    """The running project server for this repo, if its health check answers."""
    try:
        info = json.loads((root / ".groundwork" / "server.json").read_text(encoding="utf-8"))
        url = info.get("url")
        if not url:
            return None
        with urllib.request.urlopen(url.rstrip("/") + "/api/health", timeout=1) as r:
            health = json.loads(r.read().decode("utf-8"))
        return url if Path(health.get("root", "")).resolve() == root.resolve() else None
    except Exception:  # absent, stale or unreachable: not running
        return None


# ------------------------------------------------------------------ verbs

def cmd_init(a) -> int:
    doc = _store(a).init()
    _out(a, {"root": str(ps.project_root(a.repo)), "rev": doc.get("rev")},
         f"Groundwork store ready at {ps.project_root(a.repo) / '.groundwork'}")
    return 0


def cmd_status(a) -> int:
    root = ps.project_root(a.repo)
    snap = _store(a).snapshot()
    s = snap["sections"]
    boards = s.get("decisions") or []
    pending = [f for f in snap.get("feedback", []) if f.get("status") == "submitted"]
    status = {
        "root": str(root),
        "store": str(root / ".groundwork"),
        "exists": (root / ".groundwork" / "project.json").exists(),
        "server": _server_url(root),
        "rev": snap.get("rev"),
        "boards": [{"slug": b["slug"], "open": b["open"], "ruled": b["ruled"], "legacy": b["legacy"]} for b in boards],
        "pendingFeedback": len(pending),
        "preferences": len([p for p in (s.get("memory") or {}).get("preferences", []) if p.get("status") == "active"]),
        "savedDesigns": len((s.get("savedWork") or {}).get("alternatives", [])),
        "specArtifacts": len((s.get("spec") or {}).get("artifacts", [])),
        "canvas": bool((s.get("canvas") or {}).get("available")),
        "warnings": snap.get("warnings", []),
    }
    lines = [f"{status['store']}  (revision {status['rev']})",
             f"  server    {status['server'] or 'not running'}",
             f"  boards    {len(boards)}" + "".join(f"\n    {b['slug']}: {b['open']} open, {b['ruled']} ruled"
                                                   + (" (not migrated)" if b["legacy"] else "") for b in boards),
             f"  pending   {status['pendingFeedback']} note(s) waiting for an agent",
             f"  memory    {status['preferences']} active preference(s)",
             f"  saved     {status['savedDesigns']} design(s)",
             f"  spec      {status['specArtifacts']} file(s)",
             f"  canvas    {'yes' if status['canvas'] else 'none'}"]
    for w in status["warnings"]:
        lines.append(f"  warning   {w.get('code')}: {w.get('detail')}")
    _out(a, status, "\n".join(lines))
    return 0


def cmd_migrate(a) -> int:
    from designer.project.migrate import migrate
    result = migrate(ps.project_root(a.repo), dry_run=a.dry_run, verify=a.verify)
    entries = result.get("entries", [])
    lines = [f"{'dry run: ' if a.dry_run else ''}{len(entries)} source(s), changed: {result.get('changed')}"]
    for e in entries:
        lines.append(f"  {e.get('status'):<9} {e.get('id')}" + (f"  ({e['note']})" if e.get("note") else ""))
    mismatch = False
    if a.verify:
        v = result.get("verify") or {}
        mismatches = v.get("mismatches") or []
        mismatch = bool(mismatches) or v.get("ok") is False
        lines.append(f"verify: {'MISMATCH' if mismatch else 'ok'}")
        for m in mismatches:
            lines.append(f"  {m}")
        for e in v.get("storeEdited") or []:
            # Answered in the pane since migration: listed, never silent.
            ident = e.get("id") if isinstance(e, dict) else e
            items = e.get("items") if isinstance(e, dict) else None
            lines.append(f"  store-edited {ident}" + (f" (items: {', '.join(items)})" if items else ""))
    _out(a, result, "\n".join(lines))
    if mismatch or any(e.get("status") in ("conflict", "error") for e in entries):
        return 1
    return 0


def cmd_serve(a) -> int:
    cmd = ["node", str(SERVER), "--repo", str(ps.project_root(a.repo))]
    if a.port:
        cmd += ["--port", str(a.port)]
    if a.proxy:
        cmd += ["--proxy", a.proxy]
    if a.no_migrate:
        cmd += ["--no-migrate"]
    try:
        return subprocess.call(cmd)
    except FileNotFoundError:
        return _err("node is required to serve the project pane", 2)
    except KeyboardInterrupt:  # pragma: no cover
        return 0


def cmd_read(a) -> int:
    store = _store(a)
    if a.contract:
        _out(a, store.agent_contract(), None)
        return 0
    if a.decisions:
        boards = store.list_boards()
        lines = []
        for b in boards:
            lines.append(f"{b['slug']}: {b['open']} open, {b['ruled']} ruled")
            for it in b.get("items", []):
                if it.get("lane") == "ruled":
                    note = f" -- {it['note']}" if it.get("note") else ""
                    lines.append(f"  {it.get('id')}: {it.get('ruling')}{note}")
        _out(a, {"boards": boards}, "\n".join(lines) or "no decision boards")
        return 0
    items = store.list_feedback(section=a.section, status=a.status)
    lines = [f"[{f['section']}] {f['status']:<9} {f['id']}  {f['text']}" for f in items]
    _out(a, {"items": items}, "\n".join(lines) or "no notes")
    return 0


def cmd_feedback(a) -> int:
    item = _store(a).add_feedback(a.section, a.text, target=a.target,
                                  origin={"kind": "agent", "ref": None}, submit=not a.draft)
    _out(a, item, item["id"])
    return 0


def cmd_ack(a) -> int:
    result = _store(a).acknowledge(a.ids)
    lines = [f"acknowledged {i}" for i in result.get("acknowledged", [])]
    lines += [f"refused {r['id']}: {r['reason']}" for r in result.get("refused", [])]
    _out(a, result, "\n".join(lines))
    return 1 if result.get("refused") else 0


def cmd_prefer(a) -> int:
    store = _store(a)
    if a.prefer_cmd == "add":
        pref = store.add_preference(a.text, scope=a.scope,
                                    provenance={"source": a.source, "ref": a.ref},
                                    supersedes=a.supersedes)
        _out(a, pref, pref["id"])
        return 0
    prefs = store.list_preferences(include_superseded=a.all)
    lines = [f"{p['status']:<10} [{p['scope']}] {p['id']}  {p['text']}" for p in prefs]
    _out(a, {"preferences": prefs}, "\n".join(lines) or "no preferences")
    return 0


def cmd_snapshot(a) -> int:
    path = _store(a).save_snapshot()
    _out(a, {"ok": True, "path": str(path)}, str(path))
    return 0


def cmd_export(a) -> int:
    root = ps.project_root(a.repo)
    out = Path(a.out).expanduser().resolve()
    store_dir = (root / ".groundwork").resolve()
    if out.exists():
        return _err(f"{out} already exists; export never writes into an existing directory", 1)
    if out == store_dir or store_dir in out.parents:
        return _err("export must go outside .groundwork/", 1)
    path = _store(a).save_snapshot(out)
    _out(a, {"ok": True, "path": str(path)}, str(path))
    return 0


# ------------------------------------------------------------------ parser

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="groundwork project", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def verb(name: str, fn, help_: str) -> argparse.ArgumentParser:
        p = sub.add_parser(name, help=help_)
        p.add_argument("--repo", default=os.getcwd(), help="repository root (default: current directory)")
        p.add_argument("--json", action="store_true", help="print JSON")
        p.set_defaults(fn=fn)
        return p

    verb("init", cmd_init, "create <repo>/.groundwork/ if absent")
    verb("status", cmd_status, "summarise the store and whether its server runs")
    m = verb("migrate", cmd_migrate, "copy legacy Groundwork data into the store; never deletes")
    m.add_argument("--dry-run", action="store_true", help="report what would change; write nothing")
    m.add_argument("--verify", action="store_true", help="re-check every migrated board's rulings byte-for-byte")
    s = verb("serve", cmd_serve, "start the project pane server (one URL per repo)")
    s.add_argument("--port", type=int, default=None)
    s.add_argument("--proxy", default=None, help="origin of a live dev build shown at /__live/")
    s.add_argument("--no-migrate", action="store_true", help="skip the startup migration")
    r = verb("read", cmd_read, "print notes, rulings or the agent contract; changes nothing")
    r.add_argument("--section", default=None, choices=list(ps.SECTIONS))
    r.add_argument("--status", default=None, choices=["draft", "submitted", "processed"])
    r.add_argument("--decisions", action="store_true", help="print every board's rulings and notes")
    r.add_argument("--contract", action="store_true", help="print the agent contract (pending notes, preferences, decisions)")
    f = verb("feedback", cmd_feedback, "add a note to a section as an agent")
    f.add_argument("--section", required=True, choices=list(ps.SECTIONS))
    f.add_argument("--text", required=True)
    f.add_argument("--target", default=None)
    f.add_argument("--draft", action="store_true", help="save as a draft instead of submitting")
    k = verb("ack", cmd_ack, "mark notes processed after acting on them")
    k.add_argument("ids", nargs="+")
    pr = verb("prefer", cmd_prefer, "record or list project preferences")
    psub = pr.add_subparsers(dest="prefer_cmd", required=True)
    pa = psub.add_parser("add", help="add a preference (optionally replacing one)")
    pa.add_argument("--repo", default=os.getcwd())
    pa.add_argument("--json", action="store_true")
    pa.add_argument("--text", required=True)
    pa.add_argument("--scope", default="repo", choices=["repo", "decisions", "canvas", "saved-work", "spec"])
    pa.add_argument("--source", default="agent", choices=["person", "agent", "decision"])
    pa.add_argument("--ref", default=None)
    pa.add_argument("--supersedes", default=None)
    pl = psub.add_parser("list", help="list active preferences")
    pl.add_argument("--repo", default=os.getcwd())
    pl.add_argument("--json", action="store_true")
    pl.add_argument("--all", action="store_true", help="include replaced preferences")
    verb("snapshot", cmd_snapshot, "copy the store to .groundwork/snapshots/<time>/")
    e = verb("export", cmd_export, "copy the store to a new directory outside it")
    e.add_argument("--out", required=True)
    return ap


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    try:
        return a.fn(a)
    except ps.StoreError as e:
        code = getattr(e, "code", None)
        if code == "lock-timeout":
            return _err(str(e), 3)
        if code in ("invalid", "symlink"):
            return _err(str(e), 2)
        return _err(str(e), 1)


if __name__ == "__main__":
    sys.exit(main())
