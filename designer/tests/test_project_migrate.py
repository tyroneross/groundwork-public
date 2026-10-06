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
    src.write_text('{"version": 1, "notes": [], "alternatives": [], "sources": [], "selectedId": null}\n',
                   encoding="utf-8")
    e = by_id(run(root))["workspace:workspace.json"]
    assert e["status"] == "migrated" and e["source"] == ".groundwork-workspace/workspace.json"
    src.write_text('{"version": 1, "notes": [], "alternatives": [], "sources": [], "selectedId": "x"}\n',
                   encoding="utf-8")
    assert by_id(run(root))["workspace:workspace.json"]["status"] == "recopied"
    assert (root / ".groundwork" / "workspace.json").read_bytes() == src.read_bytes()


def test_verify_detects_tampered_dest(repo):
    clean = run(repo, verify=True)
    assert clean["verify"]["ok"] is True and clean["verify"]["mismatches"] == []
    assert clean["verify"]["storeEdited"] == []
    assert {c["id"] for c in clean["verify"]["checked"]} == {"decisions:compare-demo", "decisions:odd-text"}
    # Tamper 1: a store copy that is no longer a readable board is a mismatch.
    odd = repo / ".groundwork" / "decisions" / "odd-text" / "decisions.json"
    odd.write_bytes(odd.read_bytes()[:40])
    v = run(repo, verify=True)["verify"]
    assert v["ok"] is False
    assert [(m["id"], m["problem"]) for m in v["mismatches"]] == [("decisions:odd-text", "unreadable")]
    # Tamper 2: forged lineage (store copy edited and its sha written in as the
    # baseline) is compared against the source and caught.
    odd.write_bytes((repo / ".designdoc" / "odd-text" / "decisions.json").read_bytes())
    set_ruling(odd, "home-intro", "keep-a", "tampered")
    pj = repo / ".groundwork" / "project.json"
    doc = json.loads(pj.read_text(encoding="utf-8"))
    for m in doc["migrations"]:
        if m["id"] == "decisions:odd-text":
            m["destSha256"] = sha(odd)
    pj.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    v = run(repo, verify=True)["verify"]
    assert v["ok"] is False
    assert [(m["id"], m["problem"], m["items"]) for m in v["mismatches"]] == \
        [("decisions:odd-text", "rulings-differ", ["home-intro"])]
    os.unlink(repo / ".groundwork" / "decisions" / "compare-demo" / "decisions.json")
    # dest gone -> the next run re-copies it; verify on that run is clean for that board
    res = run(repo, verify=True)
    assert by_id(res)["decisions:compare-demo"]["status"] == "migrated"
    assert {m["id"] for m in res["verify"]["mismatches"]} == {"decisions:odd-text"}


def test_verify_lists_a_pane_ruling_as_store_edited_not_a_mismatch(repo):
    run(repo)
    store = ProjectStore(repo)
    rec = json.loads(store.read_board("compare-demo"))
    rec["compares"][0]["ruling"] = "approve-b"
    rec["compares"][0]["ruledAt"] = NOW
    store.write_board("compare-demo", (json.dumps(rec, indent=2) + "\n").encode("utf-8"))
    res = run(repo, verify=True)
    v = res["verify"]
    assert v["ok"] is True and v["mismatches"] == []
    assert [(x["id"], x["items"]) for x in v["storeEdited"]] == [("decisions:compare-demo", [rec["compares"][0]["id"]])]
    assert {c["id"] for c in v["checked"]} == {"decisions:odd-text"}


def test_invalid_legacy_workspace_is_error_and_never_copied(repo):
    run(repo)
    dest = repo / ".groundwork" / "workspace.json"
    legacy = repo / ".designdoc" / ".groundwork-workspace" / "workspace.json"
    good, dest_before = legacy.read_bytes(), dest.read_bytes()
    base = by_id(run(repo))["workspace:workspace.json"]
    for bad in (good[: len(good) // 2], b'{"version": 2, "notes": [], "alternatives": [], "sources": []}',
                b'{"version": 1, "notes": {}, "alternatives": [], "sources": []}', b"\xff\xfe"):
        legacy.write_bytes(bad)
        e = by_id(run(repo))["workspace:workspace.json"]
        assert e["status"] == "error" and "not a supported record" in e["note"]
        assert dest.read_bytes() == dest_before
        assert (e["sourceSha256"], e["destSha256"]) == (base["sourceSha256"], base["destSha256"])
    legacy.write_bytes(good)
    assert by_id(run(repo))["workspace:workspace.json"]["status"] == "unchanged"


def test_unchanged_board_still_gets_missing_visuals(repo):
    run(repo)
    legacy_vis = repo / ".designdoc" / "compare-demo" / "visuals"
    dest_vis = repo / ".groundwork" / "decisions" / "compare-demo" / "visuals"
    (legacy_vis / "new-shot.png").write_bytes(b"\x89PNG synthetic new")
    existing = sorted(p.name for p in dest_vis.iterdir())[0]
    (dest_vis / existing).write_bytes(b"store-side visual")
    before = tree(repo)
    res = run(repo)
    e = by_id(res)["decisions:compare-demo"]
    assert e["status"] == "unchanged" and res["changed"] is True
    assert (dest_vis / "new-shot.png").read_bytes() == b"\x89PNG synthetic new"
    assert (dest_vis / existing).read_bytes() == b"store-side visual"
    assert f"kept store copy of visual {existing}" in e["note"]
    assert tree(repo) == before
    again = run(repo)
    assert again["changed"] is False and by_id(again)["decisions:compare-demo"]["status"] == "unchanged"


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


def test_a_store_edit_is_never_overwritten_by_a_later_legacy_edit(tmp_path):
    """Audit f1: a pane ruling (store edit) followed by an old server editing the
    legacy board must end in conflict, never in a recopy that erases the ruling."""
    import shutil as _sh
    from designer.project.migrate import migrate as _migrate
    from designer.project.project_store import ProjectStore as _PS
    root = Path(__file__).resolve().parents[2]
    legacy = tmp_path / ".designdoc" / "demo"
    _sh.copytree(root / "designer" / "decisions" / "fixtures" / "compare-demo", legacy)
    assert {e["status"] for e in _migrate(tmp_path)["entries"] if e["id"] == "decisions:demo"} == {"migrated"}
    store = _PS(tmp_path)
    rec = json.loads(store.read_board("demo"))
    rec["compares"][0]["ruling"] = "approve-b"
    pane_bytes = (json.dumps(rec, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    with store.lock():
        store.write_board("demo", pane_bytes)
    # A restart runs migrate again while legacy is untouched.
    assert [e["status"] for e in _migrate(tmp_path)["entries"] if e["id"] == "decisions:demo"] == ["unchanged"]
    old = json.loads((legacy / "decisions.json").read_text(encoding="utf-8"))
    old["compares"][1]["ruling"] = "keep-a"
    (legacy / "decisions.json").write_text(json.dumps(old, indent=2) + "\n", encoding="utf-8")
    entry = next(e for e in _migrate(tmp_path)["entries"] if e["id"] == "decisions:demo")
    assert entry["status"] == "conflict"
    assert store.read_board("demo") == pane_bytes, "the pane ruling must survive"


def test_a_workspace_first_written_through_the_store_is_not_recopied(tmp_path):
    """Audit f1 workspace path: legacy note n0, store edit adds n1, the legacy
    file then gains n2; migrate must not replace the store copy."""
    from designer.project.migrate import migrate as _migrate
    from designer.project.project_store import ProjectStore as _PS
    wsdir = tmp_path / ".groundwork-workspace"
    wsdir.mkdir()
    base = {"version": 1, "notes": [{"id": "n0", "text": "legacy0", "status": "received",
                                      "createdAt": "2026-01-01T00:00:00.000Z"}],
            "alternatives": [], "selectedId": None, "sources": []}
    (wsdir / "workspace.json").write_text(json.dumps(base, indent=2), encoding="utf-8")
    store = _PS(tmp_path)
    store.change_workspace(lambda v: v["notes"].append(
        {"id": "n1", "text": "PANE CHANGE", "status": "received", "createdAt": "2026-01-02T00:00:00.000Z"}))
    base["notes"].append({"id": "n2", "text": "old server", "status": "received",
                          "createdAt": "2026-01-03T00:00:00.000Z"})
    (wsdir / "workspace.json").write_text(json.dumps(base, indent=2), encoding="utf-8")
    entry = next(e for e in _migrate(tmp_path)["entries"] if e["kind"] == "workspace")
    assert entry["status"] == "conflict"
    ids = [n["id"] for n in store.read_workspace()[0]["notes"]]
    assert "n1" in ids
