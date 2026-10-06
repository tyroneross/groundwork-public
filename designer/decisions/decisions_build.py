#!/usr/bin/env python3
"""Scaffold a guided-decision surface for any project, and serve it.

A project's decision boards live in the repository they describe, in the one
per-repo Groundwork store: `<repo>/.groundwork/decisions/<slug>/` holds the
record and its screenshots. The page that renders a board is served from the
Groundwork install by the project server (`designer/project/project-server.mjs`),
which shows every board, the canvas, saved work, the Spec and project memory at
one URL per repo. Boards made before the store existed sit in
`<repo>/.designdoc/<slug>/`; `python3 -m designer.project migrate` copies them in
without touching the originals.

    python3 -m designer.decisions.decisions_build init   <repo> --slug <slug> [--template compare]
    python3 -m designer.decisions.decisions_build check  <record.json> [--json]
    python3 -m designer.decisions.decisions_build serve  <repo> --slug <slug>
    python3 -m designer.decisions.decisions_build export <record.json> --format selection [--out <file>]

`init` NEVER overwrites an existing record. A decision record is a document a
person has been writing in; replacing it with a template because a command was
run twice is not recoverable from, so the command refuses and says so.

The app files are NOT copied beside the record. A copy per board drifted from
every later fix to the board, so the page is served from the install instead.
The record itself stays plain JSON that `check --json` reads with no server.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from designer.decisions import decision_record as dr

HERE = Path(__file__).resolve().parent
APP_DIR = HERE / "app"
APP_FILES = ("index.html", "decisions.css", "decisions.js")
SERVER = HERE / "decisions-server.mjs"
PROJECT_SERVER = HERE.parent / "project" / "project-server.mjs"
RECORD_NAME = "decisions.json"
# `init --template compare` copies this synthetic A-or-B set, visuals and all,
# so the board opens on something real-shaped instead of a blank.
COMPARE_TEMPLATE = HERE / "fixtures" / "compare-demo"
TEMPLATES = ("starter", "compare")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _die(msg: str, code: int = 2) -> int:
    print(f"error: {msg}", file=sys.stderr)
    return code


def starter_record(slug: str, product: str) -> dict:
    """An empty record that is still a VALID one.

    It carries one open axis rather than nothing, because a surface that opens
    to "nothing is waiting for you" on a brand-new project reads as broken
    rather than as empty.
    """
    return {
        "schema": dr.SCHEMA,
        "id": slug,
        "product": product,
        "surface": "",
        "axes": [
            {
                "id": "first-decision",
                "num": 1,
                "title": "Replace this with the first real decision",
                "decision": "What is the first thing that needs ruling on?",
                "why": "Written by `decisions_build init`. Edit or delete it.",
                "options": [
                    {"key": "a", "letter": "A", "label": "The first option"},
                    {"key": "b", "letter": "B", "label": "The second option"},
                ],
            }
        ],
        "openItems": [],
        "previewComments": [],
        "annotations": [],
        "history": [],
        "lifecycle": {"generation": 1, "generatedAt": _now(), "savedAt": None, "savedScope": None},
    }


def compare_record(slug: str, product: str | None) -> dict:
    """The synthetic A-or-B set, re-keyed to this project. Every string in it is
    invented; it exists so the board opens with three answerable items."""
    rec = json.loads((COMPARE_TEMPLATE / RECORD_NAME).read_text(encoding="utf-8"))
    rec["id"] = slug
    if product:
        rec["product"] = product
    rec["lifecycle"] = {"generation": 1, "generatedAt": _now(), "savedAt": None, "savedScope": None}
    return rec


def target_dir(repo: str, slug: str) -> Path:
    return Path(repo).expanduser().resolve() / ".groundwork" / "decisions" / slug


def legacy_dir(repo: str, slug: str) -> Path:
    return Path(repo).expanduser().resolve() / ".designdoc" / slug


def cmd_init(a) -> int:
    from designer.project.project_store import ProjectStore, StoreError

    repo = Path(a.repo).expanduser().resolve()
    if not repo.is_dir():
        return _die(f"not a directory: {repo}")
    out = target_dir(a.repo, a.slug)
    record = out / RECORD_NAME

    if record.exists():
        # Refusing is the whole point. See the module docstring.
        return _die(
            f"{record} already exists.\n"
            "  A decision record is a document someone has been writing in, so this\n"
            "  command will not replace it. Delete it yourself if that is what you want.")
    legacy = legacy_dir(a.repo, a.slug) / RECORD_NAME
    if legacy.exists():
        return _die(
            f"{legacy} already exists from before the project store.\n"
            f"  Copy it into the store with: python3 -m designer.project migrate --repo {repo}")

    if a.template == "compare":
        rec = compare_record(a.slug, a.product)
    else:
        rec = starter_record(a.slug, a.product or a.slug)
    errs = dr.validate(rec)
    if errs:  # pragma: no cover - would mean starter_record itself is broken
        return _die("the starter record is invalid:\n  - " + "\n  - ".join(errs))

    store = ProjectStore(repo, tool="decisions_build")
    try:
        store.init()
        base = f"decisions/{a.slug}"
        with store.lock():
            if record.exists():
                return _die(f"{record} already exists.")
            store.write_bytes(f"{base}/{RECORD_NAME}",
                              (json.dumps(rec, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
            if a.template == "compare":
                # Never over an existing picture: visuals/ may predate the record.
                for src in sorted((COMPARE_TEMPLATE / "visuals").iterdir()):
                    if src.is_file() and not (out / "visuals" / src.name).exists():
                        store.write_bytes(f"{base}/visuals/{src.name}", src.read_bytes())
            elif not (out / "visuals" / "manifest.json").exists():
                store.write_bytes(f"{base}/visuals/manifest.json",
                                  (json.dumps({"items": {}}, indent=2) + "\n").encode("utf-8"))
    except StoreError as e:
        return _die(str(e), 3 if getattr(e, "code", None) == "lock-timeout" else 2)

    print(f"created {out}")
    print(f"  {RECORD_NAME}   the record -- edit this, or have an agent append to it")
    print(f"  visuals/       put per-decision screenshots here (see VISUALS.md)")
    print(f"\nserve it:\n  python3 -m designer.decisions.decisions_build serve {a.repo} --slug {a.slug}")
    return 0


def _atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def cmd_check(a) -> int:
    try:
        rec = dr.load(a.record)
    except FileNotFoundError:
        return _die(f"record not found: {a.record}")
    except json.JSONDecodeError as e:
        return _die(f"record is not valid JSON: {e}")

    errs = dr.validate(rec)
    if errs:
        return _die("invalid record:\n  - " + "\n  - ".join(errs))

    ln = dr.lanes(rec)
    if getattr(a, "json", False):
        # The read-back an agent wants: one row per ruleable, lane derived.
        rows = [{"id": r.id, "source": r.source, "kind": r.kind, "title": r.title,
                 "lane": r.lane, "ruling": r.chosen, "note": r.free_text,
                 "ruledAt": r.ruled_at} for r in dr.ruleables(rec)]
        print(json.dumps({"record": a.record, "valid": True,
                          "open": len(ln["open"]), "ruled": len(ln["ruled"]),
                          "items": rows}, indent=2, ensure_ascii=False))
        return 0
    print(f"{a.record}: valid")
    print(f"  open  {len(ln['open']):>3}")
    print(f"  ruled {len(ln['ruled']):>3}")
    # The number that would be wrong if anything ever read `status`.
    stale = [r for r in ln["ruled"]
             if str(r.status_prose or "").strip().lower().startswith("open")]
    if stale:
        print(f"  note  {len(stale)} ruled item(s) still carry a status beginning "
              f"'open'. The lane is derived from the ruling, so they are correctly "
              f"filed as ruled; the prose is the author's to update.")
    return 0


def cmd_export(a) -> int:
    """Write the ruled compares as groundwork.mockups.selection/v1.

    Refuses an invalid record rather than exporting half of it: a Revise B or
    Neither with no note is exactly the answer the next step cannot act on.
    """
    try:
        rec = dr.load(a.record)
    except FileNotFoundError:
        return _die(f"record not found: {a.record}")
    except json.JSONDecodeError as e:
        return _die(f"record is not valid JSON: {e}")
    errs = dr.validate(rec)
    if errs:
        return _die("invalid record:\n  - " + "\n  - ".join(errs))
    if not rec.get("compares"):
        return _die("this record has no compares[] to export")

    sel = dr.to_selection(rec, slug=a.slug, selected_at=_now())
    for row in sel["perScreen"]:
        hp = row.get("html_path")
        if hp and (Path(hp).is_absolute() or ".." in Path(hp).parts):
            return _die(f"{row['screen_id']}: mockup path {hp!r} must be relative to mockups/ "
                        "and stay inside it")
    text = json.dumps(sel, indent=2, ensure_ascii=False) + "\n"
    if a.out:
        out = Path(a.out).expanduser()
        out.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(out, text)
        missing = [r["html_path"] for r in sel["perScreen"]
                   if r.get("html_path") and not (out.parent / r["html_path"]).is_file()]
        print(f"wrote {out}: {len(sel['perScreen'])} answered, {sel['unanswered']} unanswered")
        for hp in missing:
            # The packet emitter refuses a selection whose html_path is absent,
            # so say so now rather than at emit time.
            print(f"  warning: {hp} is not in {out.parent}; the packet emitter will refuse it",
                  file=sys.stderr)
    else:
        sys.stdout.write(text)
    return 0


def serve_command(repo: str, slug: str, port: int | None = None, proxy: str | None = None) -> list[str]:
    """The project server command line that shows this board (and the rest of
    the project) at one URL per repo."""
    cmd = ["node", str(PROJECT_SERVER), "--repo", str(Path(repo).expanduser().resolve())]
    if port:
        cmd += ["--port", str(port)]
    if proxy:
        cmd += ["--proxy", proxy]
    return cmd


def cmd_serve(a) -> int:
    out = target_dir(a.repo, a.slug)
    record = out / RECORD_NAME
    legacy = legacy_dir(a.repo, a.slug) / RECORD_NAME
    if not record.exists() and not legacy.exists():
        return _die(f"no record at {record}\n  run `init` first.")
    cmd = serve_command(a.repo, a.slug, a.port, a.proxy)
    print("  " + " ".join(cmd))
    print(f"  the board opens at <printed URL>decisions/{a.slug}/ (the pane lists every board)")
    try:
        return subprocess.call(cmd)
    except FileNotFoundError:
        return _die("node is required to serve the surface")
    except KeyboardInterrupt:  # pragma: no cover
        return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="decisions_build.py", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    i = sub.add_parser("init", help="create a board record in <repo>/.groundwork/decisions/<slug>/")
    i.add_argument("repo")
    i.add_argument("--slug", required=True)
    i.add_argument("--product", default=None)
    i.add_argument("--template", choices=TEMPLATES, default="starter",
                   help="starter: one open axis. compare: a synthetic 3-item A-or-B set with visuals")
    i.set_defaults(fn=cmd_init)

    c = sub.add_parser("check", help="validate a record and report its lanes")
    c.add_argument("record")
    c.add_argument("--json", action="store_true", help="print every item with its lane, ruling and note")
    c.set_defaults(fn=cmd_check)

    e = sub.add_parser("export", help="write ruled compares as mockups selection.json")
    e.add_argument("record")
    e.add_argument("--format", choices=("selection",), required=True)
    e.add_argument("--out", default=None, help="file to write (default: stdout); "
                   "normally <design-dir>/mockups/selection.json")
    e.add_argument("--slug", default=None, help="selection slug (default: the record id)")
    e.set_defaults(fn=cmd_export)

    s = sub.add_parser("serve", help="serve the project pane (all boards) for a repo")
    s.add_argument("repo")
    s.add_argument("--slug", required=True)
    s.add_argument("--port", type=int, default=None)
    s.add_argument("--proxy", default=None, help="origin of a live dev build to proxy same-origin")
    s.set_defaults(fn=cmd_serve)

    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
