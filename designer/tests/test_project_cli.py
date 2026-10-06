"""`groundwork project` graded by running it as a person or agent would.

The property that matters most: reading never consumes. An agent may run
`read` as often as it likes; only `ack` changes a note's status.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "designer" / "decisions" / "fixtures" / "compare-demo"


def run(*args, cwd=None, bin_=False):
    env = {**os.environ, "PYTHONPATH": str(ROOT)}
    cmd = [str(ROOT / "bin" / "groundwork"), "project", *args] if bin_ else \
        [sys.executable, "-m", "designer.project", *args]
    return subprocess.run(cmd, cwd=cwd or ROOT, env=env, capture_output=True, text=True, timeout=60)


def js(proc):
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def test_init_then_status_reports_an_empty_store(tmp_path):
    assert run("init", "--repo", str(tmp_path)).returncode == 0
    st = js(run("status", "--repo", str(tmp_path), "--json"))
    assert st["exists"] is True and st["server"] is None and st["pendingFeedback"] == 0
    assert (tmp_path / ".groundwork" / ".gitignore").read_text() == "*\n"


def test_feedback_is_readable_and_reading_never_consumes(tmp_path):
    run("init", "--repo", str(tmp_path))
    fid = run("feedback", "--repo", str(tmp_path), "--section", "canvas", "--text", "Keep left navigation").stdout.strip()
    assert fid.startswith("fb_")
    before = (tmp_path / ".groundwork" / "project.json").read_bytes()
    first = js(run("read", "--repo", str(tmp_path), "--json"))
    second = js(run("read", "--repo", str(tmp_path), "--contract", "--json"))
    assert (tmp_path / ".groundwork" / "project.json").read_bytes() == before, "read must not write"
    assert [i["text"] for i in first["items"]] == ["Keep left navigation"]
    assert [p["id"] for p in second["pending"]] == [fid]
    assert second["readConsumes"] is False
    assert run("ack", "--repo", str(tmp_path), fid).returncode == 0
    after = js(run("read", "--repo", str(tmp_path), "--status", "processed", "--json"))
    assert [i["id"] for i in after["items"]] == [fid]


def test_ack_refuses_canvas_rows_because_the_canvas_agent_owns_its_cursor(tmp_path):
    canvas = tmp_path / "mockups" / ".canvas"
    canvas.mkdir(parents=True)
    row = {"ts": "2026-10-06T00:00:00.000Z", "id": "fb-1-1", "kind": "comment", "text": "Bigger title"}
    (canvas / "feedback.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    journal = (canvas / "feedback.jsonl").read_bytes()
    items = js(run("read", "--repo", str(tmp_path), "--section", "canvas", "--json"))["items"]
    assert [i["id"] for i in items] == ["canvas:fb-1-1"]
    proc = run("ack", "--repo", str(tmp_path), "canvas:fb-1-1")
    assert proc.returncode == 1 and "canvas-cursor-owned" in proc.stdout
    assert (canvas / "feedback.jsonl").read_bytes() == journal
    assert not (canvas / "cursor.json").exists()


def test_preferences_supersede_and_list(tmp_path):
    first = run("prefer", "add", "--repo", str(tmp_path), "--text", "Left navigation").stdout.strip()
    second = js(run("prefer", "add", "--repo", str(tmp_path), "--text", "Top navigation on phones",
                    "--scope", "canvas", "--supersedes", first, "--json"))
    active = js(run("prefer", "list", "--repo", str(tmp_path), "--json"))["preferences"]
    every = js(run("prefer", "list", "--repo", str(tmp_path), "--all", "--json"))["preferences"]
    assert [p["id"] for p in active] == [second["id"]]
    old = next(p for p in every if p["id"] == first)
    assert old["status"] == "superseded" and old["supersededBy"] == second["id"]


def test_read_decisions_returns_board_rulings_and_notes(tmp_path):
    from designer.decisions import decisions_build as db
    from designer.project.project_store import ProjectStore
    assert db.main(["init", str(tmp_path), "--slug", "demo", "--template", "compare"]) == 0
    store = ProjectStore(tmp_path)
    rec = json.loads(store.read_board("demo"))
    rec["compares"][0]["ruling"] = "revise-b"
    rec["compares"][0]["rulingText"] = "Shorter heading — keep the photo ✓"
    with store.lock():
        store.write_board("demo", (json.dumps(rec, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    out = js(run("read", "--repo", str(tmp_path), "--decisions", "--json"))
    board = next(b for b in out["boards"] if b["slug"] == "demo")
    item = next(i for i in board["items"] if i["id"] == rec["compares"][0]["id"])
    assert item["ruling"] == "revise-b" and item["note"] == "Shorter heading — keep the photo ✓"
    contract = js(run("read", "--repo", str(tmp_path), "--contract", "--json"))
    cboard = next(b for b in contract["decisions"] if b["slug"] == "demo")
    assert any(i.get("ruling") == "revise-b" for i in cboard["items"])


def test_snapshot_and_export_copy_the_store(tmp_path):
    run("feedback", "--repo", str(tmp_path), "--section", "spec", "--text", "Name the export button")
    snap = Path(js(run("snapshot", "--repo", str(tmp_path), "--json"))["path"])
    assert (snap / "project.json").read_bytes() == (tmp_path / ".groundwork" / "project.json").read_bytes()
    out = tmp_path.parent / (tmp_path.name + "-export")
    try:
        exp = Path(js(run("export", "--repo", str(tmp_path), "--out", str(out), "--json"))["path"])
        assert (exp / "project.json").is_file()
        assert run("export", "--repo", str(tmp_path), "--out", str(out)).returncode == 1, "never into an existing dir"
        assert run("export", "--repo", str(tmp_path), "--out", str(tmp_path / ".groundwork" / "x")).returncode == 1
    finally:
        shutil.rmtree(out, ignore_errors=True)


def test_migrate_verify_passes_then_catches_a_tampered_ruling(tmp_path):
    legacy = tmp_path / ".designdoc" / "demo"
    shutil.copytree(DEMO, legacy)
    rec = json.loads((legacy / "decisions.json").read_text(encoding="utf-8"))
    rec["compares"][0]["ruling"] = "approve-b"
    (legacy / "decisions.json").write_text(json.dumps(rec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    source = (legacy / "decisions.json").read_bytes()
    assert run("migrate", "--repo", str(tmp_path), "--verify").returncode == 0
    dest = tmp_path / ".groundwork" / "decisions" / "demo" / "decisions.json"
    assert dest.read_bytes() == source and (legacy / "decisions.json").read_bytes() == source
    # A valid ruling edit in the store is a store edit (listed), not a mismatch.
    dest.write_bytes(source.replace(b'"approve-b"', b'"keep-a"'))
    ok = run("migrate", "--repo", str(tmp_path), "--verify", "--json")
    assert ok.returncode == 0
    assert [x["id"] for x in json.loads(ok.stdout)["verify"]["storeEdited"]] == ["decisions:demo"]
    # The text output names the store-edited board too, not only --json.
    txt = run("migrate", "--repo", str(tmp_path), "--verify")
    assert txt.returncode == 0
    assert "verify: ok" in txt.stdout
    assert [ln.strip().split(" (items:")[0] for ln in txt.stdout.splitlines()
            if ln.strip().startswith("store-edited ")] == ["store-edited decisions:demo"]
    # A store copy that is no longer a readable board is a tamper: exit 1.
    dest.write_bytes(source[:40])
    assert run("migrate", "--repo", str(tmp_path), "--verify").returncode == 1


def test_bin_wrapper_works_from_another_directory(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    assert run("init", cwd=repo, bin_=True).returncode == 0
    st = json.loads(run("status", "--json", cwd=repo, bin_=True).stdout)
    assert Path(st["root"]).resolve() == repo.resolve()
    bad = subprocess.run([str(ROOT / "bin" / "groundwork"), "nope"], capture_output=True, text=True)
    assert bad.returncode == 2


def test_every_verb_accepts_repo_and_json_for_doc_conformance():
    for verb in ("init", "status", "migrate", "serve", "read", "feedback", "ack", "snapshot", "export"):
        h = run(verb, "--help").stdout
        assert "--repo" in h and "--json" in h, verb
