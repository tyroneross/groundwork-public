"""Legacy migration into `.groundwork/` (C4). Frozen contract: project-store-plan.md section H, ADR-06.

Copy, never move. Every legacy source is read-only: this module writes only
under `R/.groundwork/` and only through `ProjectStore`. Boards and the
workspace are copied as BYTES and tracked by a sha lineage in the D-05
migration entries; a source and a store copy that both changed since the last
migration is a `conflict` and is never auto-resolved.

Lineage per source (s = sha of the legacy bytes, d = sha of the store copy or
None, E = the existing migration entry when it carries a baseline):
  d is None                         -> copy, `migrated`
  E and s == E.sourceSha256         -> `unchanged` (no writes)
  E and s != E.src and d == E.dest  -> re-copy, `recopied`
  E and s != E.src and d != E.dest  -> `conflict` (no copy)
  no E and d == s                   -> record only, `migrated`
  no E and d != s                   -> `conflict` (no copy)

A conflict or error entry keeps the previous baseline shas (or null when there
was none), so the next run re-detects the same conflict instead of mistaking
the current bytes for a fresh baseline.

API: `migrate(root, dry_run=False, verify=False) -> dict`. The CLI lives in C7.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Callable

from designer.decisions import decision_record as dr
from designer.project.project_store import (DIR, LEGACY_WORKSPACES, SLUG_RE, WORKSPACE_MIGRATION_ID,
                                            ProjectStore, StoreError)

DESIGNER_STATE_FILES = (".designdoc/.designer-state.json", ".designer-state.json")
# A.4. Checked against the emitters: engine/src/cli.ts writes spec.json,
# build-request.json, builder-handoff.md and reads design-tokens.md from the
# out dir; assembled-spec.json is the survey's spec file
# (designer/tests/test_survey_rehearsal.mjs); DESIGN.md is a hand-kept doc.
SPEC_FILES = ("spec.json", "assembled-spec.json", "build-request.json", "builder-handoff.md",
              "design-tokens.md", "DESIGN.md")
CANVAS_DIRS = (".designdoc/mockups/.canvas", "mockups/.canvas")
PROJECT_JSON = f"{DIR}/project.json"
VERIFIABLE = ("migrated", "unchanged", "recopied")


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def resolve_root(target: Any) -> Path:
    """AM-8: realpath; a `.groundwork` component -> its parent; else a `.designdoc` basename -> parent."""
    p = Path(target).resolve()
    parts = p.parts
    if ".groundwork" in parts:
        return Path(*parts[:parts.index(".groundwork")])
    return p.parent if p.name == ".designdoc" else p


def _symlink_on_path(root: Path, rel: str) -> str | None:
    cur = root
    for part in Path(rel).parts:
        cur = cur / part
        if cur.is_symlink():
            return str(cur.relative_to(root))
    return None


def _read_file(root: Path, rel: str) -> bytes | None:
    p = root / rel
    return p.read_bytes() if p.is_file() else None


def _rulings(data: bytes) -> list[tuple[str, tuple]] | None:
    try:
        rec = json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(rec, dict):
        return None
    return [(r.id, (r.chosen, r.free_text, r.ruled_at)) for r in dr.ruleables(rec)]


def ruling_diff(a: bytes, b: bytes) -> list[str] | None:
    """Item ids whose ruling/rulingText/ruledAt differ (incl. one-sided ids); None if either is unreadable."""
    ra, rb = _rulings(a), _rulings(b)
    if ra is None or rb is None:
        return None
    ma, mb = dict(ra), dict(rb)
    order = [i for i, _ in ra] + [i for i, _ in rb if i not in ma]
    seen: set[str] = set()
    out = []
    for i in order:
        if i in seen:
            continue
        seen.add(i)
        if ma.get(i, None) != mb.get(i, None) or (i in ma) != (i in mb):
            out.append(i)
    return out


def _entry(id: str, kind: str, source: str | None, dest: str | None, src_sha: str | None,
           dest_sha: str | None, status: str, note: str | None = None, migrated_at: str | None = None) -> dict:
    return {"id": id, "kind": kind, "source": source, "dest": dest, "sourceSha256": src_sha,
            "destSha256": dest_sha, "status": status, "migratedAt": migrated_at, "note": note}


def _same(old: dict | None, new: dict) -> bool:
    if old is None:
        return False
    return {**old, "migratedAt": None} == {**new, "migratedAt": None}


class _Plan:
    """One source's outcome: the entry to report, the files to write, the record to keep."""

    def __init__(self, entry: dict, old: dict | None, writes: list[tuple[str, bytes]] | None = None,
                 artifact: tuple[str, str, dict | None] | None = None) -> None:
        self.entry = entry
        self.old = old
        self.writes = writes or []
        self.artifact = artifact

    @property
    def _clears(self) -> bool:
        # Back to baseline after a conflict/error: persist `unchanged` so the warning clears.
        return self.old is not None and self.old.get("status") in ("conflict", "error")

    @property
    def record(self) -> bool:
        if self.entry["status"] == "unchanged" and not self._clears:
            return False
        return not _same(self.old, self.entry)

    @property
    def reported(self) -> dict:
        if self.entry["status"] == "unchanged" and self.old is not None and not self._clears:
            return {**self.old, "status": "unchanged"}
        return dict(self.entry)


def _lineage(id: str, kind: str, source: str, dest: str, s_bytes: bytes, d_bytes: bytes | None,
             old: dict | None, diff_note: Callable[[], str]) -> tuple[str, dict]:
    """Return (status, entry) under the section H rules. `diff_note` builds the conflict note."""
    s = _sha(s_bytes)
    d = _sha(d_bytes) if d_bytes is not None else None
    base = old if old is not None and old.get("sourceSha256") else None
    if d is None:
        return "migrated", _entry(id, kind, source, dest, s, s, "migrated")
    if base is not None and s == base["sourceSha256"]:
        if old.get("status") in ("conflict", "error"):
            # The legacy copy went back to its baseline: the store is authoritative again.
            return "unchanged", _entry(id, kind, source, dest, base["sourceSha256"],
                                               base.get("destSha256"), "unchanged")
        # Keep the baseline dest sha even when the store copy has since been
        # edited (a ruling made in the pane): the lineage must remember that
        # the store diverged, or a later legacy edit would look like a safe
        # recopy and overwrite the person's store-only work.
        return "unchanged", _entry(id, kind, source, dest, s, base.get("destSha256"), "unchanged")
    if base is not None:
        # Recopy only when the store still holds a byte copy of the old
        # baseline: base dest == base source (it was copied, not first written
        # through the store) and the store has not changed since.
        if d == base.get("destSha256") and base.get("destSha256") == base["sourceSha256"]:
            return "recopied", _entry(id, kind, source, dest, s, s, "recopied")
        note = f"legacy {source} and store {dest} both changed since the last migration; {diff_note()}"
        return "conflict", _entry(id, kind, source, dest, base["sourceSha256"], base.get("destSha256"),
                                  "conflict", note)
    if d == s:
        return "migrated", _entry(id, kind, source, dest, s, s, "migrated")
    note = f"store {dest} already exists and differs from legacy {source}; {diff_note()}"
    return "conflict", _entry(id, kind, source, dest, None, None, "conflict", note)


def _error(id: str, kind: str, source: str | None, dest: str | None, old: dict | None, note: str) -> _Plan:
    base = old if old is not None and old.get("sourceSha256") else None
    e = _entry(id, kind, source, dest, base["sourceSha256"] if base else None,
               base.get("destSha256") if base else None, "error", note)
    return _Plan(e, old)


def _board_note(s_bytes: bytes, d_bytes: bytes | None) -> Callable[[], str]:
    def note() -> str:
        if d_bytes is None:
            return "no store copy"
        ids = ruling_diff(s_bytes, d_bytes)
        if ids is None:
            return "one side is unreadable JSON"
        return ("items whose ruling differs: " + ", ".join(ids)) if ids else "no ruling differences"
    return note


def _plan_board(root: Path, slug: str, old: dict | None) -> _Plan | None:
    src = f".designdoc/{slug}"
    dest = f"{DIR}/decisions/{slug}"
    id = f"decisions:{slug}"
    link = _symlink_on_path(root, f"{src}/decisions.json")
    if link:
        return _error(id, "decision-board", src, dest, old, f"refusing symlink: {link}")
    s_bytes = (root / src / "decisions.json").read_bytes()
    try:
        rec = json.loads(s_bytes.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        return _error(id, "decision-board", src, dest, old, f"legacy decisions.json is not valid JSON: {e}")
    if not isinstance(rec, dict) or rec.get("schema") != dr.SCHEMA:
        return None  # not a decision board
    link = _symlink_on_path(root, f"{dest}/decisions.json")
    if link:
        return _error(id, "decision-board", src, dest, old, f"refusing symlink: {link}")
    d_bytes = _read_file(root, f"{dest}/decisions.json")
    status, entry = _lineage(id, "decision-board", src, dest, s_bytes, d_bytes, old,
                             _board_note(s_bytes, d_bytes))
    if status not in ("migrated", "recopied"):
        return _Plan(entry, old)
    writes: list[tuple[str, bytes]] = []
    if status == "recopied" or d_bytes is None:
        writes.append((f"{dest}/decisions.json", s_bytes))
    notes = []
    vdir = root / src / "visuals"
    if vdir.is_symlink():
        notes.append("skipped symlinked visuals directory")
    elif vdir.is_dir():
        for p in sorted(vdir.iterdir()):
            if p.is_symlink():
                notes.append(f"skipped symlinked visual {p.name}")
                continue
            if not p.is_file() or p.name.startswith("."):
                continue
            rel = f"{dest}/visuals/{p.name}"
            if _symlink_on_path(root, rel):
                notes.append(f"skipped visual {p.name}: store path is a symlink")
                continue
            data = p.read_bytes()
            have = _read_file(root, rel)
            if have is None:
                writes.append((rel, data))
            elif have != data:
                notes.append(f"kept store copy of visual {p.name} (differs from legacy)")
    entry["note"] = "; ".join(notes) or None
    return _Plan(entry, old, writes)


def _plan_workspace(root: Path, old: dict | None) -> _Plan | None:
    id, dest = WORKSPACE_MIGRATION_ID, f"{DIR}/workspace.json"
    found = []
    for rel in LEGACY_WORKSPACES:
        link = _symlink_on_path(root, rel)
        if link:
            return _error(id, "workspace", rel, dest, old, f"refusing symlink: {link}")
        data = _read_file(root, rel)
        if data is not None:
            found.append((rel, data))
    if not found:
        return None
    src, s_bytes = found[0]
    if len(found) == 2 and found[0][1] != found[1][1]:
        base = old if old is not None and old.get("sourceSha256") else None
        e = _entry(id, "workspace", src, dest, base["sourceSha256"] if base else None,
                   base.get("destSha256") if base else None, "conflict",
                   f"legacy workspaces {found[0][0]} and {found[1][0]} both exist and differ; nothing copied")
        return _Plan(e, old)
    link = _symlink_on_path(root, dest)
    if link:
        return _error(id, "workspace", src, dest, old, f"refusing symlink: {link}")
    d_bytes = _read_file(root, dest)
    status, entry = _lineage(id, "workspace", src, dest, s_bytes, d_bytes, old,
                             lambda: "workspace bytes differ")
    writes = [(dest, s_bytes)] if status == "recopied" or (status == "migrated" and d_bytes is None) else []
    return _Plan(entry, old, writes)


def _plan_pointer(root: Path, kind: str, rel: str, meta: dict | None, old: dict | None) -> _Plan | None:
    p = root / rel
    if not (p.exists() or p.is_symlink()):
        return None
    id = f"{kind}:{rel}"
    link = _symlink_on_path(root, rel)
    if link:
        return _error(id, "pointer", rel, PROJECT_JSON, old, f"refusing symlink: {link}")
    if kind == "canvas":
        if not p.is_dir():
            return None
        journal = p / "feedback.jsonl"
        if journal.is_symlink():
            return _error(id, "pointer", rel, PROJECT_JSON, old, f"refusing symlink: {rel}/feedback.jsonl")
        s = _sha(journal.read_bytes() if journal.is_file() else b"")
    else:
        if not p.is_file():
            return None
        s = _sha(p.read_bytes())
    unchanged = old is not None and old.get("sourceSha256") == s and old.get("status") not in ("conflict", "error")
    e = _entry(id, "pointer", rel, PROJECT_JSON, s, None, "unchanged" if unchanged else "migrated")
    return _Plan(e, old, artifact=(kind, rel, meta))


def _plans(root: Path, migrations: list[dict]) -> list[_Plan]:
    by_id = {m.get("id"): m for m in migrations if isinstance(m, dict)}
    plans: list[_Plan | None] = []
    legacy = root / ".designdoc"
    if legacy.is_symlink():
        raise StoreError("symlink", f"refusing symlink: {legacy}")
    if legacy.is_dir():
        for d in sorted(legacy.iterdir(), key=lambda p: p.name):
            if not SLUG_RE.match(d.name) or d.name.startswith("."):
                continue
            if not (d.is_dir() or d.is_symlink()):
                continue
            if not ((d / "decisions.json").is_file() or (d / "decisions.json").is_symlink()):
                continue
            plans.append(_plan_board(root, d.name, by_id.get(f"decisions:{d.name}")))
    plans.append(_plan_workspace(root, by_id.get(WORKSPACE_MIGRATION_ID)))
    for rel in DESIGNER_STATE_FILES:
        plans.append(_plan_pointer(root, "designer-state", rel, {}, by_id.get(f"designer-state:{rel}")))
    for name in SPEC_FILES:
        rel = f".designdoc/{name}"
        plans.append(_plan_pointer(root, "spec", rel, {}, by_id.get(f"spec:{rel}")))
    for rel in CANVAS_DIRS:
        plans.append(_plan_pointer(root, "canvas", rel, None, by_id.get(f"canvas:{rel}")))
    return [p for p in plans if p is not None]


def _verify(root: Path, entries: list[dict]) -> dict:
    checked, mismatches = [], []
    for e in entries:
        if e.get("kind") != "decision-board" or e.get("status") not in VERIFIABLE:
            continue
        src = _read_file(root, f"{e['source']}/decisions.json")
        dst = _read_file(root, f"{e['dest']}/decisions.json")
        if src is None or dst is None:
            mismatches.append({"id": e["id"], "source": e["source"], "dest": e["dest"],
                               "problem": "source-missing" if src is None else "dest-missing", "items": []})
            continue
        checked.append({"id": e["id"], "sourceSha256": _sha(src), "destSha256": _sha(dst),
                        "bytesEqual": src == dst})
        ids = ruling_diff(src, dst)
        if ids is None:
            mismatches.append({"id": e["id"], "source": e["source"], "dest": e["dest"],
                               "problem": "unreadable", "items": []})
        elif ids:
            mismatches.append({"id": e["id"], "source": e["source"], "dest": e["dest"],
                               "problem": "rulings-differ", "items": ids})
    return {"ok": not mismatches, "checked": checked, "mismatches": mismatches}


def migrate(root: Any, dry_run: bool = False, verify: bool = False, *,
            now: Callable[[], str] | None = None) -> dict:
    """Section H. Returns {"root","dryRun","entries":[D-05],"changed"[, "verify"]}."""
    r = resolve_root(root)
    store = ProjectStore(r, now=now, tool="migrate")
    if store.dir.is_symlink():
        raise StoreError("symlink", f"refusing symlink: {store.dir}")

    if dry_run:
        plans = _plans(r, store.read_project()["migrations"])
        changed = not (store.dir / "project.json").is_file() or any(p.record or p.writes for p in plans)
        entries = [p.reported for p in plans]
    else:
        pj = store.dir / "project.json"
        with store.lock():
            before = pj.read_bytes() if pj.is_file() else None
            store.init()
            plans = _plans(r, store.read_project()["migrations"])
            wrote = False
            entries = []
            for p in plans:
                try:
                    for rel, data in p.writes:
                        # Plans name destinations from the repo root; the store
                        # library takes paths inside .groundwork/ (AM-12).
                        store.write_bytes(rel.removeprefix(".groundwork/"), data)
                        wrote = True
                    if p.artifact is not None:
                        store.record_artifact(*p.artifact)
                    if p.record:
                        store.record_migration(p.entry)
                        rec = next(m for m in store.read_project()["migrations"] if m["id"] == p.entry["id"])
                        entries.append({**rec, "status": p.entry["status"]})
                    else:
                        entries.append(p.reported)
                except (StoreError, OSError) as exc:
                    err = _error(p.entry["id"], p.entry["kind"], p.entry["source"], p.entry["dest"], p.old,
                                 f"{type(exc).__name__}: {exc}").entry
                    store.record_migration(err)
                    entries.append(err)
            after = pj.read_bytes() if pj.is_file() else None
            changed = wrote or before != after

    out: dict[str, Any] = {"root": str(r), "dryRun": bool(dry_run), "entries": entries, "changed": bool(changed)}
    if verify:
        out["verify"] = _verify(r, entries)
    return out
