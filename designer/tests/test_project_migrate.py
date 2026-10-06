"""C4 acceptance (T-05, T-06): legacy migration into .groundwork/. Synthetic fixtures only."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

import pytest

from designer.project.migrate import migrate, resolve_root, ruling_diff
from designer.project.project_store import ProjectStore

ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "designer" / "decisions" / "fixtures" / "compare-demo"
NOW = "2026-10-06T12:00:00.000Z"
ODD_TEXT = "Café ✨🚀 — ok\t  two  spaces nbsp\n  next line  "


def now():
    return NOW


def run(root, **kw):
    return migrate(root, now=now, **kw)


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def tree(root: Path, skip_groundwork=True) -> dict[str, str]:
    out = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if skip_groundwork and rel.parts[0] == ".groundwork":
            continue
        if p.is_symlink():
            out[str(rel)] = "symlink:" + os.readlink(p)
        elif p.is_file():
            out[str(rel)] = sha(p)
        else:
            out[str(rel)] = "dir"
    return out


def build_repo(root: Path) -> Path:
    dd = root / ".designdoc"
    board = dd / "compare-demo"
    shutil.copytree(DEMO, board)
    for app in ("index.html", "decisions.css", "decisions.js"):
        (board / app).write_text(f"/* synthetic app file {app} */\n", encoding="utf-8")
    (root / "outside.png").write_bytes(b"\x89PNG synthetic")
    os.symlink(root / "outside.png", board / "visuals" / "linked.png")
    # second board: odd whitespace, non-ASCII and emoji in rulingText, unusual formatting
    rec = json.loads((DEMO / "decisions.json").read_text(encoding="utf-8"))
    rec["id"] = "odd-text"
    rec["compares"][0].update(ruling="revise-b", rulingText=ODD_TEXT, ruledAt=NOW)
    odd = dd / "odd-text"
    odd.mkdir()
    (odd / "decisions.json").write_bytes(
        (json.dumps(rec, indent=4, ensure_ascii=False) + "   \n\n").encode("utf-8"))
    nb = dd / "not-a-board"
    nb.mkdir()
    (nb / "decisions.json").write_text('{"schema": "something/else"}\n', encoding="utf-8")
    ws = dd / ".groundwork-workspace"
    ws.mkdir()
    (ws / "workspace.json").write_bytes(json.dumps({
        "version": 1, "notes": [{"id": "n1", "text": "Synthetic note ✓", "status": "received",
                                 "createdAt": NOW}],
        "alternatives": [{"id": "alt-1", "rationale": "synthetic", "createdAt": NOW}],
        "selectedId": None, "sources": []}, ensure_ascii=False).encode("utf-8"))
    (dd / ".designer-state.json").write_text('{"synthetic": true}\n', encoding="utf-8")
    (root / ".designer-state.json").write_text('{"synthetic": "root"}\n', encoding="utf-8")
    (dd / "spec.json").write_text('{"spec": "synthetic"}\n', encoding="utf-8")
    (dd / "builder-handoff.md").write_text("# Synthetic handoff\n", encoding="utf-8")
    canvas = root / "mockups" / ".canvas"
    canvas.mkdir(parents=True)
    (canvas / "canvas.html").write_text("<!doctype html><p>synthetic</p>\n", encoding="utf-8")
    (canvas / "feedback.jsonl").write_text(
        json.dumps({"ts": NOW, "id": "c1", "kind": "comment", "text": "synthetic"}) + "\n", encoding="utf-8")
    (canvas / "cursor.json").write_text('{"last_id": null}\n', encoding="utf-8")
    return root


@pytest.fixture
def repo(tmp_path):
    return build_repo(tmp_path / "repo")


def by_id(result):
    return {e["id"]: e for e in result["entries"]}


def set_ruling(path: Path, item: str, ruling: str, text: str) -> None:
    rec = json.loads(path.read_text(encoding="utf-8"))
    for c in rec["compares"]:
        if c["id"] == item:
            c.update(ruling=ruling, rulingText=text, ruledAt=NOW)
    path.write_text(json.dumps(rec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def test_migrates_every_legacy_source_and_leaves_legacy_bytes(repo):
    before = tree(repo)
    res = run(repo)
    assert tree(repo) == before  # nothing outside .groundwork written, renamed or deleted
    assert res["root"] == str(repo.resolve()) and res["dryRun"] is False and res["changed"] is True
    e = by_id(res)
    assert set(e) == {"decisions:compare-demo", "decisions:odd-text", "workspace:workspace.json",
                      "designer-state:.designdoc/.designer-state.json", "designer-state:.designer-state.json",
                      "spec:.designdoc/spec.json", "spec:.designdoc/builder-handoff.md", "canvas:mockups/.canvas"}
    assert {x["status"] for x in res["entries"]} == {"migrated"}
    g = repo / ".groundwork"
    for slug in ("compare-demo", "odd-text"):
        src, dst = repo / ".designdoc" / slug / "decisions.json", g / "decisions" / slug / "decisions.json"
        assert dst.read_bytes() == src.read_bytes()
        assert e[f"decisions:{slug}"]["sourceSha256"] == e[f"decisions:{slug}"]["destSha256"] == sha(src)
    # odd rulingText survives byte-for-byte, including the trailing whitespace of the file
    odd = (g / "decisions" / "odd-text" / "decisions.json").read_bytes()
    assert ODD_TEXT in json.loads(odd.decode("utf-8"))["compares"][0]["rulingText"]
    assert odd.endswith(b"   \n\n")
    vis = g / "decisions" / "compare-demo" / "visuals"
    assert sorted(p.name for p in vis.iterdir()) == sorted(p.name for p in (DEMO / "visuals").iterdir())
    assert not (vis / "linked.png").exists()
    for app in ("index.html", "decisions.css", "decisions.js"):
        assert not (g / "decisions" / "compare-demo" / app).exists()
    assert not (g / "decisions" / "not-a-board").exists()
    assert (g / "workspace.json").read_bytes() == \
        (repo / ".designdoc" / ".groundwork-workspace" / "workspace.json").read_bytes()
    proj = json.loads((g / "project.json").read_text(encoding="utf-8"))
    arts = {a["id"]: a for a in proj["artifacts"]}
    assert arts["canvas:mockups/.canvas"]["meta"] == {"htmlFile": "mockups/.canvas/canvas.html",
                                                      "journal": "mockups/.canvas/feedback.jsonl"}
    assert arts["designer-state:.designer-state.json"]["meta"] == {}
    assert arts["spec:.designdoc/spec.json"]["sha256"] == sha(repo / ".designdoc" / "spec.json")
    # all sources reachable through the store
    store = ProjectStore(repo)
    snap = store.snapshot()
    boards = {b["slug"]: b for b in snap["sections"]["decisions"]}
    assert boards["compare-demo"]["legacy"] is False and boards["odd-text"]["legacy"] is False
    ws, legacy = store.read_workspace()
    on_disk = json.loads((g / "workspace.json").read_text(encoding="utf-8"))
    # read_workspace normalizes `review` (AM-4); the copied bytes are verbatim.
    assert legacy is False and {k: v for k, v in ws.items() if k != "review"} == on_disk
    assert not [w for w in snap["warnings"] if w["code"] in ("conflict", "legacy-unmigrated")]


def test_rerun_is_unchanged_and_leaves_project_json_untouched(repo):
    run(repo)
    pj = repo / ".groundwork" / "project.json"
    snap = {str(p): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in (repo / ".groundwork").rglob("*") if p.is_file()}
    res = run(repo)
    assert res["changed"] is False
    assert {x["status"] for x in res["entries"]} == {"unchanged"}
    assert len(res["entries"]) == 8
    after = {str(p): (p.read_bytes(), p.stat().st_mtime_ns)
             for p in (repo / ".groundwork").rglob("*") if p.is_file()}
    assert after == snap
    assert pj.stat().st_mtime_ns == snap[str(pj)][1]


def test_store_edit_after_migration_stays_unchanged(repo):
    run(repo)
    set_ruling(repo / ".groundwork" / "decisions" / "compare-demo" / "decisions.json", "home-intro", "keep-a", "store")
    res = run(repo)
    assert by_id(res)["decisions:compare-demo"]["status"] == "unchanged" and res["changed"] is False


def test_legacy_edited_after_migration_is_recopied(repo):
    run(repo)
    legacy = repo / ".designdoc" / "compare-demo"
    set_ruling(legacy / "decisions.json", "home-intro", "approve-b", "legacy edit ü")
    (legacy / "visuals" / "new-shot.html").write_text("<p>synthetic new</p>\n", encoding="utf-8")
    before = tree(repo)
    res = run(repo)
    assert tree(repo) == before
    e = by_id(res)["decisions:compare-demo"]
    assert e["status"] == "recopied" and res["changed"] is True
    dest = repo / ".groundwork" / "decisions" / "compare-demo"
    assert (dest / "decisions.json").read_bytes() == (legacy / "decisions.json").read_bytes()
    assert (dest / "visuals" / "new-shot.html").is_file()
    assert e["sourceSha256"] == e["destSha256"] == sha(legacy / "decisions.json")
    assert by_id(run(repo))["decisions:compare-demo"]["status"] == "unchanged"


def test_both_edited_is_conflict_naming_item_ids_with_no_writes(repo):
    run(repo)
    legacy = repo / ".designdoc" / "compare-demo" / "decisions.json"
    dest = repo / ".groundwork" / "decisions" / "compare-demo" / "decisions.json"
    set_ruling(legacy, "home-intro", "approve-b", "legacy")
    set_ruling(dest, "plan-picker", "keep-a", "store")
    dest_before, legacy_before = dest.read_bytes(), legacy.read_bytes()
    res = run(repo)
    e = by_id(res)["decisions:compare-demo"]
    assert e["status"] == "conflict"
    assert "home-intro" in e["note"] and "plan-picker" in e["note"] and "export-home" not in e["note"]
    assert dest.read_bytes() == dest_before and legacy.read_bytes() == legacy_before
    warn = [w for w in ProjectStore(repo).snapshot()["warnings"] if w["code"] == "conflict"]
    assert warn and ".designdoc/compare-demo" in warn[0]["detail"] \
        and ".groundwork/decisions/compare-demo" in warn[0]["detail"]
    # a rerun re-detects the conflict without writing anything
    pj = repo / ".groundwork" / "project.json"
    m = pj.stat().st_mtime_ns
    res2 = run(repo)
    assert by_id(res2)["decisions:compare-demo"]["status"] == "conflict"
    assert res2["changed"] is False and pj.stat().st_mtime_ns == m and dest.read_bytes() == dest_before
    # legacy restored to its baseline clears the conflict; the store copy stays authoritative
    legacy.write_bytes((DEMO / "decisions.json").read_bytes())
    res3 = run(repo)
    assert by_id(res3)["decisions:compare-demo"]["status"] == "unchanged"
    assert dest.read_bytes() == dest_before
    assert not [w for w in ProjectStore(repo).snapshot()["warnings"] if w["code"] == "conflict"]


def test_preexisting_store_copy_without_lineage_is_conflict(repo):
    dest = repo / ".groundwork" / "decisions" / "compare-demo" / "decisions.json"
    dest.parent.mkdir(parents=True)
    shutil.copyfile(DEMO / "decisions.json", dest)
    set_ruling(dest, "export-home", "other", "store only")
    before = dest.read_bytes()
    e = by_id(run(repo))["decisions:compare-demo"]
    assert e["status"] == "conflict" and "export-home" in e["note"]
    assert dest.read_bytes() == before
    assert not (dest.parent / "visuals").exists()


def test_store_copy_equal_without_lineage_is_recorded_migrated(repo):
    dest = repo / ".groundwork" / "decisions" / "compare-demo" / "decisions.json"
    dest.parent.mkdir(parents=True)
    shutil.copyfile(repo / ".designdoc" / "compare-demo" / "decisions.json", dest)
    vis = dest.parent / "visuals"
    vis.mkdir()
    (vis / "manifest.json").write_text('{"store": "keeps this"}\n', encoding="utf-8")
    e = by_id(run(repo))["decisions:compare-demo"]
    assert e["status"] == "migrated"
    assert (vis / "manifest.json").read_text(encoding="utf-8") == '{"store": "keeps this"}\n'
    assert "manifest.json" in e["note"]
    assert (vis / "home-current.png").read_bytes() == (DEMO / "visuals" / "home-current.png").read_bytes()


def test_two_differing_legacy_workspaces_conflict(repo):
    (repo / ".groundwork-workspace").mkdir()
    (repo / ".groundwork-workspace" / "workspace.json").write_text('{"version": 1, "notes": []}\n')
    res = run(repo)
    e = by_id(res)["workspace:workspace.json"]
    assert e["status"] == "conflict"
    assert ".designdoc/.groundwork-workspace/workspace.json" in e["note"]
    assert ".groundwork-workspace/workspace.json" in e["note"]
    assert not (repo / ".groundwork" / "workspace.json").exists()


def test_workspace_lineage_recopy_and_root_legacy_candidate(tmp_path):
    root = tmp_path / "r"
    (root / ".groundwork-workspace").mkdir(parents=True)
    src = root / ".groundwork-workspace" / "workspace.json"
    src.write_text('{"version": 1, "notes": [], "selectedId": null}\n', encoding="utf-8")
    e = by_id(run(root))["workspace:workspace.json"]
    assert e["status"] == "migrated" and e["source"] == ".groundwork-workspace/workspace.json"
    src.write_text('{"version": 1, "notes": [], "selectedId": "x"}\n', encoding="utf-8")
    assert by_id(run(root))["workspace:workspace.json"]["status"] == "recopied"
    assert (root / ".groundwork" / "workspace.json").read_bytes() == src.read_bytes()


def test_verify_detects_tampered_dest(repo):
    clean = run(repo, verify=True)
    assert clean["verify"]["ok"] is True and clean["verify"]["mismatches"] == []
    assert {c["id"] for c in clean["verify"]["checked"]} == {"decisions:compare-demo", "decisions:odd-text"}
    set_ruling(repo / ".groundwork" / "decisions" / "odd-text" / "decisions.json", "home-intro", "keep-a", "tampered")
    res = run(repo, verify=True)
    v = res["verify"]
    assert v["ok"] is False
    assert [(m["id"], m["problem"], m["items"]) for m in v["mismatches"]] == \
        [("decisions:odd-text", "rulings-differ", ["home-intro"])]
    os.unlink(repo / ".groundwork" / "decisions" / "compare-demo" / "decisions.json")
    # dest gone -> the next run re-copies it; verify on that run is clean for that board
    res = run(repo, verify=True)
    assert by_id(res)["decisions:compare-demo"]["status"] == "migrated"
    assert {m["id"] for m in res["verify"]["mismatches"]} == {"decisions:odd-text"}


def test_dry_run_writes_nothing(repo):
    before = tree(repo, skip_groundwork=False)
    res = run(repo, dry_run=True, verify=True)
    assert tree(repo, skip_groundwork=False) == before
    assert not (repo / ".groundwork").exists()
    assert res["dryRun"] is True and res["changed"] is True
    assert {x["status"] for x in res["entries"]} == {"migrated"} and len(res["entries"]) == 8
    run(repo)
    legacy = repo / ".designdoc" / "compare-demo" / "decisions.json"
    set_ruling(legacy, "home-intro", "approve-b", "x")
    before = tree(repo, skip_groundwork=False)
    res = run(repo, dry_run=True)
    assert by_id(res)["decisions:compare-demo"]["status"] == "recopied" and res["changed"] is True
    assert tree(repo, skip_groundwork=False) == before


def test_root_resolution_am8(repo):
    run(repo)
    assert resolve_root(repo / ".designdoc") == repo.resolve()
    assert resolve_root(repo / ".groundwork" / "decisions" / "compare-demo") == repo.resolve()
    assert run(repo / ".groundwork" / "decisions")["root"] == str(repo.resolve())


def test_symlinked_board_record_is_error_and_not_copied(repo):
    link = repo / ".designdoc" / "linked"
    link.mkdir()
    os.symlink(repo / ".designdoc" / "compare-demo" / "decisions.json", link / "decisions.json")
    e = by_id(run(repo))["decisions:linked"]
    assert e["status"] == "error" and "symlink" in e["note"]
    assert not (repo / ".groundwork" / "decisions" / "linked").exists()


def test_ruling_diff_counts_one_sided_ids():
    a = json.dumps({"compares": [{"id": "x", "ruling": "keep-a"}, {"id": "y"}]}).encode()
    b = json.dumps({"compares": [{"id": "x", "ruling": "keep-a"}, {"id": "z"}]}).encode()
    assert ruling_diff(a, b) == ["y", "z"]
    assert ruling_diff(a, b"{") is None
