"""C1 acceptance: the Python project store (frozen interface sections B-E)."""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from designer.decisions import decision_record as dr
from designer.project import project_store as ps
from designer.project.project_store import ProjectStore, StoreError

ROOT = Path(__file__).resolve().parents[2]
COMPARE_DEMO = ROOT / "designer" / "decisions" / "fixtures" / "compare-demo" / "decisions.json"


def make(tmp_path, **kw):
    n = {"i": 0}

    def new_id(prefix):
        n["i"] += 1
        return f"{prefix}{n['i']:03d}"
    kw.setdefault("now", lambda: "2026-10-06T12:00:00.000Z")
    kw.setdefault("new_id", new_id)
    return ProjectStore(tmp_path, **kw)


def clock():
    t = {"n": 0}

    def now():
        t["n"] += 1
        return f"2026-10-06T12:00:{t['n']:02d}.000Z"
    return now


def test_canonical_and_defaults():
    assert ps.canonical({"a": "é😀", "b": None}) == '{\n  "a": "é😀",\n  "b": null\n}\n'
    assert ps._default_new_id("fb_").startswith("fb_") and len(ps._default_new_id("fb_")) == 35
    import re
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", ps._default_now())


def test_project_root_strips_designdoc(tmp_path):
    (tmp_path / ".designdoc").mkdir()
    assert ps.project_root(tmp_path / ".designdoc") == tmp_path.resolve()
    assert ps.project_root(tmp_path) == tmp_path.resolve()


def test_init_idempotent_and_gitignore(tmp_path):
    s = make(tmp_path)
    doc = s.init()
    assert (tmp_path / ".groundwork" / ".gitignore").read_text() == "*\n"
    assert list(doc) == ["schema", "rev", "createdAt", "updatedAt", "feedback", "preferences",
                         "artifacts", "migrations"]
    assert doc["rev"] == 0 and doc["schema"] == ps.SCHEMA
    before = (tmp_path / ".groundwork" / "project.json").read_bytes()
    mt = (tmp_path / ".groundwork" / "project.json").stat().st_mtime_ns
    s.init()
    assert (tmp_path / ".groundwork" / "project.json").read_bytes() == before
    assert (tmp_path / ".groundwork" / "project.json").stat().st_mtime_ns == mt
    assert not (tmp_path / ".groundwork" / "write.lock").exists()


def test_lock_second_holder_times_out(tmp_path, monkeypatch):
    monkeypatch.setattr(ps, "LOCK_TIMEOUT_MS", 150)
    a, b = make(tmp_path), make(tmp_path)
    with a.lock():
        t0 = time.monotonic()
        with pytest.raises(StoreError) as e:
            with b.lock():
                pass
        assert e.value.code == "lock-timeout"
        assert time.monotonic() - t0 >= 0.14
        assert str(os.getpid()) in str(e.value)
    with b.lock():  # released after holder exits
        pass


def _dead_pid():
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    return p.pid


def test_stale_lock_with_dead_pid_is_broken_with_warning(tmp_path, monkeypatch):
    monkeypatch.setattr(ps, "LOCK_TIMEOUT_MS", 100)
    s = make(tmp_path)
    (tmp_path / ".groundwork").mkdir()
    lock = tmp_path / ".groundwork" / "write.lock"
    lock.write_text(json.dumps({"pid": _dead_pid(), "host": socket.gethostname(),
                                "tool": "x", "acquiredAt": "t"}))
    s.init()
    assert [w["code"] for w in s.warnings] == ["lock-stale-broken"]
    assert s.snapshot()["warnings"][0]["code"] == "lock-stale-broken"
    assert not lock.exists()


def test_live_pid_lock_never_broken(tmp_path, monkeypatch):
    monkeypatch.setattr(ps, "LOCK_TIMEOUT_MS", 100)
    s = make(tmp_path)
    (tmp_path / ".groundwork").mkdir()
    lock = tmp_path / ".groundwork" / "write.lock"
    body = json.dumps({"pid": os.getpid(), "host": socket.gethostname(), "tool": "x", "acquiredAt": "t"})
    lock.write_text(body)
    with pytest.raises(StoreError) as e:
        s.init()
    assert e.value.code == "lock-timeout" and lock.read_text() == body
    # dead pid but foreign host: also never broken
    lock.write_text(json.dumps({"pid": _dead_pid(), "host": "some-other-host", "tool": "x", "acquiredAt": "t"}))
    with pytest.raises(StoreError) as e:
        s.init()
    assert e.value.code == "lock-timeout" and lock.exists()


def test_lock_file_content_and_reentrancy(tmp_path):
    s = make(tmp_path, tool="unit")
    with s.lock():
        info = json.loads((tmp_path / ".groundwork" / "write.lock").read_text())
        assert list(info) == ["pid", "host", "tool", "acquiredAt"]
        assert info["pid"] == os.getpid() and info["tool"] == "unit"
        with s.lock():
            pass
        assert (tmp_path / ".groundwork" / "write.lock").exists()
    assert not (tmp_path / ".groundwork" / "write.lock").exists()


def test_concurrent_writers_lose_nothing(tmp_path):
    ProjectStore(tmp_path).init()
    errs = []

    def work(i):
        try:
            ProjectStore(tmp_path).upsert_draft(f"fb_{i}", "general", f"t{i}")
        except Exception as e:  # pragma: no cover
            errs.append(e)
    ts = [threading.Thread(target=work, args=(i,)) for i in range(12)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errs
    doc = ProjectStore(tmp_path).read_project()
    assert len(doc["feedback"]) == 12 and doc["rev"] == 12


def test_feedback_lifecycle_and_immutability(tmp_path):
    s = make(tmp_path, now=clock())
    s.init()
    d = s.upsert_draft("fb_a", "decisions", "  first ", target="decisions:x#1",
                       origin={"kind": "person"})
    assert list(d) == ["id", "section", "target", "text", "status", "createdAt", "updatedAt",
                       "submittedAt", "processedAt", "origin"]
    assert d["text"] == "first" and d["status"] == "draft" and d["origin"] == {"kind": "person", "ref": None}
    d2 = s.upsert_draft("fb_a", "decisions", "second")
    assert d2["text"] == "second" and d2["createdAt"] == d["createdAt"]
    sub = s.submit_feedback("fb_a", "final")
    assert sub["status"] == "submitted" and sub["text"] == "final" and sub["submittedAt"]
    assert s.submit_feedback("fb_a", "final")["status"] == "submitted"  # idempotent
    assert s.submit_feedback("fb_a")["status"] == "submitted"
    with pytest.raises(StoreError) as e:
        s.submit_feedback("fb_a", "changed")
    assert e.value.code == "state"
    with pytest.raises(StoreError) as e:
        s.upsert_draft("fb_a", "decisions", "again")
    assert e.value.code == "state"
    with pytest.raises(StoreError) as e:
        s.delete_draft("fb_a")
    assert e.value.code == "state"
    res = s.acknowledge(["fb_a"])
    assert res == {"acknowledged": ["fb_a"], "refused": []}
    item = s.list_feedback()[0]
    assert item["status"] == "processed" and item["processedAt"]
    # no backward move
    for call in (lambda: s.upsert_draft("fb_a", "decisions", "x"),
                 lambda: s.submit_feedback("fb_a", "other"), lambda: s.delete_draft("fb_a")):
        with pytest.raises(StoreError) as e:
            call()
        assert e.value.code == "state"
    assert s.list_feedback()[0]["status"] == "processed"


def test_feedback_validation_and_delete(tmp_path):
    s = make(tmp_path)
    for args in (("nope", "t"), ("general", "   "), ("general", "x" * 4001)):
        with pytest.raises(StoreError) as e:
            s.upsert_draft("fb_a", *args)
        assert e.value.code == "invalid"
    with pytest.raises(StoreError):
        s.upsert_draft("bad id", "general", "t")
    with pytest.raises(StoreError):
        s.upsert_draft("fb_a", "general", "t", target="x" * 201)
    with pytest.raises(StoreError):
        s.upsert_draft("fb_a", "general", "t", origin={"kind": "robot"})
    s.upsert_draft("fb_a", "general", "t")
    s.delete_draft("fb_a")
    assert s.list_feedback() == []
    with pytest.raises(StoreError) as e:
        s.delete_draft("fb_a")
    assert e.value.code == "not-found"
    with pytest.raises(StoreError) as e:
        s.submit_feedback("fb_zzz")
    assert e.value.code == "not-found"


def test_add_feedback_paths_and_limit(tmp_path):
    s = make(tmp_path)
    a = s.add_feedback("spec", "do it", origin={"kind": "agent", "ref": "r"})
    assert a["id"] == "fb_001" and a["status"] == "submitted"
    b = s.add_feedback("spec", "later", submit=False, id="fb_keep")
    assert b["status"] == "draft"
    again = s.add_feedback("spec", "later", submit=True, id="fb_keep")
    assert again["status"] == "submitted"
    rev = s.read_project()["rev"]
    assert s.add_feedback("spec", "later", id="fb_keep")["status"] == "submitted"
    assert s.read_project()["rev"] == rev  # idempotent retry writes nothing
    with pytest.raises(StoreError) as e:
        s.add_feedback("spec", "different", id="fb_keep")
    assert e.value.code == "state"
    doc = s.read_project()
    doc["feedback"] = [{"id": f"fb_{i}"} for i in range(ps.MAX_FEEDBACK)]
    with s.lock():
        s.write_json("project.json", doc)  # AM-12: rel is under .groundwork/
    with pytest.raises(StoreError) as e:
        s.add_feedback("spec", "over")
    assert e.value.code == "limit"


def test_acknowledge_refusals(tmp_path):
    s = make(tmp_path)
    s.upsert_draft("fb_d", "general", "draft")
    res = s.acknowledge(["fb_d", "canvas:fb-1-0", "nope"])
    assert res == {"acknowledged": [], "refused": [
        {"id": "fb_d", "reason": "draft"}, {"id": "canvas:fb-1-0", "reason": "canvas-cursor-owned"},
        {"id": "nope", "reason": "unknown"}]}


def test_100_reads_leave_project_untouched(tmp_path):
    s = make(tmp_path)
    s.init()
    s.add_feedback("general", "hello")
    s.add_preference("be calm")
    p = tmp_path / ".groundwork" / "project.json"
    before, mt = p.read_bytes(), p.stat().st_mtime_ns
    for _ in range(100):
        s.read_project(); s.list_feedback(); s.list_preferences(); s.snapshot()
        s.agent_contract(); s.list_boards(); s.read_workspace()
    assert p.read_bytes() == before and p.stat().st_mtime_ns == mt
    assert json.loads(before)["rev"] == 2
    assert not (tmp_path / ".groundwork" / "workspace.json").exists()


def test_unchanged_write_skips_rev_and_changed_bumps(tmp_path):
    s = make(tmp_path, now=clock())
    s.init()
    s.mutate(lambda d: None)
    assert s.read_project()["rev"] == 0
    s.mutate(lambda d: d["feedback"].append({"id": "x"}))
    doc = s.read_project()
    assert doc["rev"] == 1 and doc["updatedAt"] != doc["createdAt"]
    s.upsert_draft("fb_a", "general", "t")
    s.upsert_draft("fb_a", "general", "t")  # same content: no bump
    assert s.read_project()["rev"] == 2


def test_symlinked_groundwork_refused(tmp_path):
    real = tmp_path / "elsewhere"
    real.mkdir()
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / ".groundwork").symlink_to(real)
    s = make(repo)
    for call in (s.init, s.read_project, s.snapshot, lambda: s.upsert_draft("fb_a", "general", "t")):
        with pytest.raises(StoreError) as e:
            call()
        assert e.value.code == "symlink"
    assert list(real.iterdir()) == []


def test_symlinked_write_target_and_legacy_source_refused(tmp_path):
    s = make(tmp_path)
    s.init()
    outside = tmp_path / "outside.json"
    outside.write_text("{}")
    (tmp_path / ".groundwork" / "workspace.json").symlink_to(outside)
    with pytest.raises(StoreError) as e:
        s.change_workspace(lambda w: w["notes"].append({}))
    assert e.value.code == "symlink"
    assert outside.read_text() == "{}"
    (tmp_path / ".groundwork" / "workspace.json").unlink()
    (tmp_path / ".groundwork-workspace").mkdir()
    (tmp_path / ".groundwork-workspace" / "workspace.json").symlink_to(outside)
    with pytest.raises(StoreError) as e:
        s.read_workspace()
    assert e.value.code == "symlink"


def test_write_rejects_escape_and_cleans_temp(tmp_path):
    s = make(tmp_path)
    s.init()
    with pytest.raises(StoreError) as e:
        s.write_bytes("decisions/x/a.bin", b"x")
    assert e.value.code == "state"  # P2: caller must hold the lock
    with s.lock():
        for bad in ("../x", "/abs", "", "a/../../x"):
            with pytest.raises(StoreError) as e:
                s.write_bytes(bad, b"x")
            assert e.value.code == "invalid"
        assert s.write_bytes("decisions/x/a.bin", b"\x00\x01") is True  # AM-12
        mt = (tmp_path / ".groundwork/decisions/x/a.bin").stat().st_mtime_ns
        assert s.write_bytes("decisions/x/a.bin", b"\x00\x01") is False  # identical: skipped
        assert (tmp_path / ".groundwork/decisions/x/a.bin").stat().st_mtime_ns == mt
    assert oct((tmp_path / ".groundwork/decisions/x/a.bin").stat().st_mode & 0o777) == "0o600"
    leftovers = [p for p in (tmp_path / ".groundwork").rglob("*.tmp")]
    assert leftovers == []


LEGACY_WS = {"version": 1, "notes": [{"id": "n1", "text": "hi", "status": "received",
                                      "createdAt": "2026-10-01T00:00:00.000Z"}],
             "alternatives": [{"id": "a1", "mockup": "m.html", "rationale": "r",
                               "createdAt": "2026-10-01T00:00:00.000Z"}],
             "selectedId": None, "sources": [],
             "review": {"suggestions": True, "optionCount": 3, "layout": "compare", "fidelity": "low"}}


@pytest.mark.parametrize("rel", [".designdoc/.groundwork-workspace/workspace.json",
                                 ".groundwork-workspace/workspace.json"])
def test_workspace_legacy_fallback_then_first_change_migrates(tmp_path, rel):
    legacy = tmp_path / rel
    legacy.parent.mkdir(parents=True)
    raw = json.dumps(LEGACY_WS).encode()
    legacy.write_bytes(raw)
    s = make(tmp_path)
    ws, is_legacy = s.read_workspace()
    assert is_legacy and ws["notes"][0]["id"] == "n1"
    assert not (tmp_path / ".groundwork" / "workspace.json").exists()  # read never writes
    assert s.select_design("a1") == "a1"
    new = tmp_path / ".groundwork" / "workspace.json"
    assert new.read_text() == ps.canonical({**LEGACY_WS, "selectedId": "a1"})
    assert legacy.read_bytes() == raw  # legacy untouched
    ws, is_legacy = s.read_workspace()
    assert not is_legacy and ws["selectedId"] == "a1"
    (m,) = s.read_project()["migrations"]
    assert m["kind"] == "workspace" and m["status"] == "migrated" and m["source"] == rel
    assert m["sourceSha256"] == __import__("hashlib").sha256(raw).hexdigest()
    assert m["destSha256"] == __import__("hashlib").sha256(new.read_bytes()).hexdigest()
    assert m["dest"] == ".groundwork/workspace.json"
    with pytest.raises(StoreError) as e:
        s.select_design("unknown")
    assert e.value.code == "not-found"


def test_workspace_empty_default_and_priority(tmp_path):
    s = make(tmp_path)
    ws, legacy = s.read_workspace()
    assert not legacy and ws == {"version": 1, "notes": [], "alternatives": [], "selectedId": None,
                                 "sources": [], "review": {"suggestions": True, "optionCount": 3,
                                                           "layout": "compare", "fidelity": "low"}}
    s.change_workspace(lambda w: w["notes"].append({"id": "n", "text": "t", "status": "received",
                                                    "createdAt": "c"}))
    assert (tmp_path / ".groundwork" / "workspace.json").exists()
    leg = tmp_path / ".groundwork-workspace" / "workspace.json"
    leg.parent.mkdir()
    leg.write_text(json.dumps(LEGACY_WS))
    ws, legacy = s.read_workspace()
    assert not legacy and ws["notes"][0]["id"] == "n"
    snap = s.snapshot()
    assert snap["sections"]["savedWork"]["legacy"] is False
    # unchanged workspace change writes nothing
    p = tmp_path / ".groundwork" / "workspace.json"
    mt = p.stat().st_mtime_ns
    s.change_workspace(lambda w: None)
    assert p.stat().st_mtime_ns == mt


def test_workspace_notes_projection_and_ack(tmp_path):
    s = make(tmp_path)
    s.change_workspace(lambda w: w["notes"].extend([
        {"id": "n1", "text": "a", "status": "received", "createdAt": "2026-10-01T00:00:00.000Z"},
        {"id": "n2", "text": "b", "status": "processed", "createdAt": "2026-10-02T00:00:00.000Z",
         "processedAt": "2026-10-03T00:00:00.000Z"}]))
    f = s.list_feedback()
    assert f[0] == {"id": "n1", "section": "saved-work", "target": None, "text": "a",
                    "status": "submitted", "createdAt": "2026-10-01T00:00:00.000Z",
                    "updatedAt": "2026-10-01T00:00:00.000Z", "submittedAt": "2026-10-01T00:00:00.000Z",
                    "processedAt": None, "origin": {"kind": "workspace", "ref": ".groundwork/workspace.json"}}
    assert f[1]["status"] == "processed" and f[1]["updatedAt"] == "2026-10-03T00:00:00.000Z" \
        and f[1]["processedAt"] == "2026-10-03T00:00:00.000Z"
    assert s.acknowledge(["n1"])["acknowledged"] == ["n1"]
    assert {i["id"]: i["status"] for i in s.list_feedback()} == {"n1": "processed", "n2": "processed"}


def test_preferences_supersede(tmp_path):
    s = make(tmp_path)
    a = s.add_preference("calm", scope="canvas")
    assert list(a) == ["id", "text", "scope", "provenance", "status", "supersedes", "supersededBy",
                       "createdAt", "updatedAt"]
    assert a["provenance"] == {"source": "person", "ref": None}
    b = s.add_preference("calmer", supersedes=a["id"],
                         provenance={"source": "agent", "ref": "r"})
    prefs = s.list_preferences(include_superseded=True)
    assert [p["id"] for p in prefs] == [b["id"], a["id"]]  # active first
    assert prefs[1]["status"] == "superseded" and prefs[1]["supersededBy"] == b["id"]
    assert [p["id"] for p in s.list_preferences()] == [b["id"]]
    with pytest.raises(StoreError) as e:
        s.add_preference("again", supersedes=a["id"])
    assert e.value.code == "state"
    with pytest.raises(StoreError) as e:
        s.add_preference("x", supersedes="pref_nope")
    assert e.value.code == "not-found"
    for kw in ({"scope": "bad"}, {"provenance": {"source": "x"}}):
        with pytest.raises(StoreError) as e:
            s.add_preference("t", **kw)
        assert e.value.code == "invalid"
    with pytest.raises(StoreError):
        s.add_preference("x" * 2001)
    assert len(s.read_project()["preferences"]) == 2  # failures wrote nothing


def test_decision_summary_matches_lanes_on_compare_demo():
    rec = json.loads(COMPARE_DEMO.read_text(encoding="utf-8"))
    sm = ps.decision_summary(rec)
    lanes = dr.lanes(rec)
    assert sm["open"] == len(lanes["open"]) and sm["ruled"] == len(lanes["ruled"])
    assert len(sm["items"]) == sm["open"] + sm["ruled"] > 0
    assert list(sm["items"][0]) == ["id", "source", "title", "lane", "ruling", "note", "ruledAt"]
    ids = {i["id"]: i["lane"] for i in sm["items"]}
    assert ids == {r.id: r.lane for r in dr.ruleables(rec)}


def test_decision_summary_edge_lanes():
    rec = {"schema": dr.SCHEMA,
           "axes": [{"id": "a1", "title": "T", "selected": False, "note": "n", "ruledAt": "z"},
                    {"id": "a2", "selected": 0}, {"id": "a3", "selected": ""},
                    {"id": "a4", "selected": [], "addressed": True}],
           "openItems": [{"id": "o1", "question": "Q?", "ruling": {}}],
           "compares": [{"id": "c1", "question": "C?", "ruling": "approve-b", "rulingText": "ok"}]}
    sm = ps.decision_summary(rec)
    lane = {i["id"]: i["lane"] for i in sm["items"]}
    assert lane == {"a1": "ruled", "a2": "ruled", "a3": "open", "a4": "ruled", "o1": "open", "c1": "ruled"}
    a1 = sm["items"][0]
    assert a1["ruling"] is False and a1["note"] == "n" and a1["ruledAt"] == "z" and a1["title"] == "T"
    assert sm["items"][-1]["ruling"] == "approve-b" and sm["items"][-1]["note"] == "ok"
    assert sm["items"][4]["title"] == "Q?"


def test_boards_roundtrip_bytes_and_legacy_listing(tmp_path):
    s = make(tmp_path)
    data = COMPARE_DEMO.read_bytes()
    with pytest.raises(StoreError) as e:
        s.write_board("../x", data)
    assert e.value.code == "invalid"
    for bad in (b"not json", b'{"schema":"other"}', b"[]"):
        with pytest.raises(StoreError) as e:
            s.write_board("x", bad)
        assert e.value.code == "invalid"
    s.write_board("demo", data)
    assert s.read_board("demo") == data
    assert (tmp_path / ".groundwork/decisions/demo/decisions.json").read_bytes() == data
    leg = tmp_path / ".designdoc" / "old"
    leg.mkdir(parents=True)
    (leg / "decisions.json").write_bytes(data)
    boards = s.list_boards()
    assert [(b["slug"], b["legacy"], b["path"]) for b in boards] == [
        ("demo", False, ".groundwork/decisions/demo"), ("old", True, ".designdoc/old")]
    assert boards[0]["valid"] and boards[0]["errors"] == [] and boards[0]["conflict"] is None
    assert s.read_board("old") == data
    assert (leg / "decisions.json").read_bytes() == data
    with pytest.raises(StoreError) as e:
        s.read_board("missing")
    assert e.value.code == "not-found"
    codes = [w["code"] for w in s.snapshot()["warnings"]]
    assert codes == ["legacy-unmigrated"]


def test_record_artifact_and_migration_upsert(tmp_path):
    s = make(tmp_path, now=clock())
    (tmp_path / ".designdoc").mkdir()
    spec = tmp_path / ".designdoc" / "spec.json"
    spec.write_text('{"a":1}')
    a = s.record_artifact("spec", ".designdoc/spec.json")
    assert list(a) == ["id", "kind", "path", "sha256", "bytes", "mtime", "recordedAt", "meta"]
    assert a["id"] == "spec:.designdoc/spec.json" and a["bytes"] == 7 and a["meta"] == {}
    rev = s.read_project()["rev"]
    assert s.record_artifact("spec", ".designdoc/spec.json") == a
    assert s.read_project()["rev"] == rev
    spec.write_text('{"a":22}')
    b = s.record_artifact("spec", ".designdoc/spec.json")
    assert b["bytes"] == 8 and len(s.read_project()["artifacts"]) == 1
    for call in (lambda: s.record_artifact("bogus", ".designdoc/spec.json"),
                 lambda: s.record_artifact("spec", "nofile.json")):
        with pytest.raises(StoreError):
            call()
    m = s.record_migration({"id": "pointer:spec", "kind": "pointer", "status": "migrated"})
    assert list(m) == ["id", "kind", "source", "dest", "sourceSha256", "destSha256", "status",
                       "migratedAt", "note"]
    assert m["source"] is None and m["note"] is None
    s.record_migration({"id": "pointer:spec", "kind": "pointer", "status": "unchanged"})
    ms = s.read_project()["migrations"]
    assert len(ms) == 1 and ms[0]["status"] == "unchanged"
    with pytest.raises(StoreError):
        s.record_migration({"id": "x", "kind": "pointer", "status": "weird"})


def _canvas(tmp_path, rows, cursor=None, raw_extra="", where=".designdoc/mockups/.canvas"):
    d = tmp_path / where
    d.mkdir(parents=True)
    (d / "feedback.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows) + raw_extra)
    if cursor is not None:
        (d / "cursor.json").write_text(json.dumps({"last_id": cursor, "count": 1}))
    return d


ROWS = [
    {"ts": "2026-10-06T10:00:00.000Z", "id": "fb-1-0", "kind": "comment", "text": "make it bigger",
     "component": "hero"},
    {"ts": "2026-10-06T10:01:00.000Z", "id": "fb-2-0", "kind": "toggle", "mode": "hold"},
    {"ts": "2026-10-06T10:02:00.000Z", "id": "fb-3-0", "kind": "decide", "dim": "density", "value": "a",
     "component": None},
    {"ts": "2026-10-06T10:03:00.000Z", "id": "fb-4-0", "kind": "lock", "text": ""},
]


def test_canvas_projection_cursor_and_invalid_rows(tmp_path):
    d = _canvas(tmp_path, ROWS, cursor="fb-2-0", raw_extra='{"ts": "partial\n[1]\n')
    (d / "board.html").write_text("<html></html>")
    s = make(tmp_path)
    before = {p.name: p.read_bytes() for p in d.iterdir()}
    items = [i for i in s.list_feedback() if i["section"] == "canvas"]
    assert [i["id"] for i in items] == ["canvas:fb-1-0", "canvas:fb-3-0", "canvas:fb-4-0"]  # toggle skipped
    assert [i["text"] for i in items] == ["make it bigger", "[decide] density=a", "[lock]"]
    assert [i["target"] for i in items] == ["hero", None, None]
    assert [i["status"] for i in items] == ["processed", "submitted", "submitted"]
    assert items[0] == {"id": "canvas:fb-1-0", "section": "canvas", "target": "hero",
                        "text": "make it bigger", "status": "processed",
                        "createdAt": ROWS[0]["ts"], "updatedAt": ROWS[0]["ts"],
                        "submittedAt": ROWS[0]["ts"], "processedAt": None,
                        "origin": {"kind": "canvas", "ref": ".designdoc/mockups/.canvas/feedback.jsonl"}}
    snap = s.snapshot()
    assert snap["sections"]["canvas"] == {"available": True, "dir": ".designdoc/mockups/.canvas",
                                          "htmlFile": ".designdoc/mockups/.canvas/board.html",
                                          "rows": 3, "invalidRows": 2}
    assert "canvas-invalid-rows" in [w["code"] for w in snap["warnings"]]
    assert {p.name: p.read_bytes() for p in d.iterdir()} == before  # nothing written under .canvas
    assert [p for p in tmp_path.rglob("write.lock")] == []


def test_canvas_cursor_absent_or_unknown_all_submitted_and_dir_priority(tmp_path):
    _canvas(tmp_path, ROWS[:1], where="mockups/.canvas")
    s = make(tmp_path)
    assert [i["status"] for i in s.list_feedback()] == ["submitted"]
    _canvas(tmp_path, ROWS, cursor="fb-not-there")
    items = [i for i in s.list_feedback() if i["section"] == "canvas"]
    assert len(items) == 3 and {i["status"] for i in items} == {"submitted"}  # first dir wins
    assert items[0]["origin"]["ref"].startswith(".designdoc/")


def test_canvas_artifact_meta_and_no_canvas(tmp_path):
    s = make(tmp_path)
    assert s.snapshot()["sections"]["canvas"] == {"available": False, "dir": None, "htmlFile": None,
                                                  "rows": 0, "invalidRows": 0}
    d = _canvas(tmp_path, ROWS)
    (d / "a.html").write_text("a")
    a = s.record_artifact("canvas", ".designdoc/mockups/.canvas")
    assert a["meta"] == {"htmlFile": ".designdoc/mockups/.canvas/a.html",
                         "journal": ".designdoc/mockups/.canvas/feedback.jsonl"}


def test_snapshot_and_contract_shapes_and_ordering(tmp_path):
    s = make(tmp_path, now=clock())
    s.init()
    s.add_feedback("spec", "second", id="fb_b")
    s.add_feedback("general", "first", id="fb_a")
    s.upsert_draft("fb_c", "memory", "draft")
    s.add_preference("p")
    snap = s.snapshot()
    assert list(snap) == ["schema", "root", "rev", "generatedAt", "sections", "feedback",
                          "migrations", "warnings"]
    assert snap["schema"] == ps.SNAPSHOT_SCHEMA and snap["root"] == str(tmp_path.resolve())
    assert list(snap["sections"]) == ["decisions", "canvas", "savedWork", "spec", "memory"]
    assert [f["id"] for f in snap["feedback"]] == ["fb_b", "fb_a", "fb_c"]  # createdAt asc
    assert snap["sections"]["savedWork"]["available"] is False
    c = s.agent_contract()
    assert c["schema"] == ps.CONTRACT_SCHEMA and c["readConsumes"] is False
    assert [f["id"] for f in c["pending"]] == ["fb_b", "fb_a"]
    assert len(c["preferences"]) == 1 and c["rev"] == snap["rev"]
    assert c["ack"] == {"method": "POST", "path": "/api/agent/ack", "body": {"ids": ["…"]},
                        "cli": "groundwork project ack <id>…"}
    assert c == s.agent_contract()  # reading does not consume
    assert [f["id"] for f in s.list_feedback(section="spec")] == ["fb_b"]
    assert [f["id"] for f in s.list_feedback(status="draft")] == ["fb_c"]


def test_save_snapshot_copies_store_without_transients(tmp_path):
    s = make(tmp_path)
    s.init()
    s.add_feedback("general", "x")
    s.write_board("demo", COMPARE_DEMO.read_bytes())
    (tmp_path / ".groundwork" / "server.json").write_text("{}")
    p = s.save_snapshot()
    assert p.parent == tmp_path / ".groundwork" / "snapshots"
    names = sorted(str(q.relative_to(p)) for q in p.rglob("*") if q.is_file())
    assert names == [".gitignore", "decisions/demo/decisions.json", "project.json"]
    assert (p / "project.json").read_bytes() == (tmp_path / ".groundwork/project.json").read_bytes()
    p2 = s.save_snapshot()
    assert p2 != p and not any("snapshots" in q.relative_to(p2).parts for q in p2.rglob("*"))
    out = tmp_path / "export"
    assert s.save_snapshot(out) == out.resolve() and (out / "project.json").exists()
    with pytest.raises(StoreError) as e:
        s.save_snapshot(out)
    assert e.value.code == "conflict"
    with pytest.raises(StoreError) as e:
        s.save_snapshot(tmp_path / ".groundwork" / "inside")
    assert e.value.code == "invalid"


# ------------------------------------------------- C3 reconciliation (AM-4..AM-16)
def test_am8_project_root_groundwork_ancestor(tmp_path):
    (tmp_path / ".groundwork" / "decisions" / "x").mkdir(parents=True)
    assert ps.project_root(tmp_path / ".groundwork") == tmp_path.resolve()
    assert ps.project_root(tmp_path / ".groundwork" / "decisions" / "x") == tmp_path.resolve()
    assert ProjectStore(tmp_path / ".groundwork" / "decisions").root == tmp_path.resolve()


def test_am12_write_rel_is_under_groundwork(tmp_path):
    s = make(tmp_path)
    with s.lock():
        s.write_json("decisions/d/x.json", {"a": 1})
    assert (tmp_path / ".groundwork" / "decisions" / "d" / "x.json").read_text() == '{\n  "a": 1\n}\n'
    assert (tmp_path / ".groundwork" / ".gitignore").read_text() == "*\n"  # any lock writes it


def test_p1_one_stamp_per_lock(tmp_path):
    s = make(tmp_path, now=clock())
    s.init()                                   # 1 stamp
    d = s.upsert_draft("fb_a", "general", "x")  # 1 stamp
    assert d["createdAt"] == d["updatedAt"] == "2026-10-06T12:00:02.000Z"
    with s.lock():                              # nested ops share the outer stamp
        s.add_preference("p")
        s.submit_feedback("fb_a")
    doc = s.read_project()
    assert doc["preferences"][0]["createdAt"] == doc["feedback"][0]["submittedAt"] == doc["updatedAt"] \
        == "2026-10-06T12:00:03.000Z"


def test_am4_normalize_review_on_read_and_conflict(tmp_path):
    a = tmp_path / ".designdoc/.groundwork-workspace/workspace.json"
    b = tmp_path / ".groundwork-workspace/workspace.json"
    for p, review in ((a, {"optionCount": "9", "layout": "single"}), (b, None)):
        p.parent.mkdir(parents=True)
        p.write_text(json.dumps({**LEGACY_WS, "review": review}))
    s = make(tmp_path)
    ws, legacy = s.read_workspace()
    assert legacy is True and ws["review"] == {"suggestions": True, "optionCount": 5, "layout": "single",
                                               "fidelity": "low"}
    assert {"code": "conflict", "detail": ".designdoc/.groundwork-workspace/workspace.json and "
            ".groundwork-workspace/workspace.json differ"} in s.snapshot()["warnings"]
    for call in (lambda: s.select_design("a1"), lambda: s.add_feedback("saved-work", "x")):
        with pytest.raises(StoreError) as e:
            call()
        assert e.value.code == "conflict"
    assert not (tmp_path / ".groundwork" / "workspace.json").exists()
    assert ps.normalize_review({"optionCount": 2.5, "suggestions": 0}) == \
        {"suggestions": True, "optionCount": 2.5, "layout": "compare", "fidelity": "low"}
    assert ps.normalize_review(None)["optionCount"] == 3


def test_am5_saved_work_submit_mirrors_note_and_ack_marks_both(tmp_path):
    s = make(tmp_path)
    s.upsert_draft("fb_s", "saved-work", "keep the header")
    s.submit_feedback("fb_s")
    s.submit_feedback("fb_s")                    # idempotent: one note
    ws, _ = s.read_workspace()
    assert ws["notes"] == [{"id": "fb_s", "text": "keep the header", "review": ws["review"],
                            "status": "received", "createdAt": "2026-10-06T12:00:00.000Z"}]
    assert [f["id"] for f in s.list_feedback()] == ["fb_s"]           # projection dedupes
    assert s.list_feedback()[0]["origin"] is None                     # the store item wins
    assert s.acknowledge(["fb_s"]) == {"acknowledged": ["fb_s"], "refused": []}
    ws, _ = s.read_workspace()
    assert ws["notes"][0]["status"] == "processed" and list(ws["notes"][0])[-1] == "processedAt"
    assert s.read_project()["feedback"][0]["status"] == "processed"
    s.add_feedback("decisions", "not mirrored")
    assert len(s.read_workspace()[0]["notes"]) == 1


def test_am6_am7_contract_items_and_ordering(tmp_path):
    s = make(tmp_path, now=clock())
    s.write_board("demo", COMPARE_DEMO.read_bytes())
    p1 = s.add_preference("one")
    p2 = s.add_preference("two")
    s.add_preference("three", supersedes=p1["id"])
    assert [p["text"] for p in s.list_preferences(include_superseded=True)] == ["two", "three", "one"]
    assert [p["id"] for p in s.agent_contract()["preferences"]] == [p2["id"], "pref_003"]
    c = s.agent_contract()
    assert c["decisions"] == s.snapshot()["sections"]["decisions"] and c["decisions"][0]["items"]
    sm = ps.decision_summary({"axes": [{"title": ""}, {"id": "", "title": "T"}]})
    assert [(i["id"], i["title"]) for i in sm["items"]] == [(None, None), (None, "T")]


def test_am15_workspace_migration_entry(tmp_path):
    p = tmp_path / ".groundwork-workspace/workspace.json"
    p.parent.mkdir(parents=True)
    raw = json.dumps(LEGACY_WS).encode()
    p.write_bytes(raw)
    s = make(tmp_path)
    s.select_design("a1")
    (m,) = s.read_project()["migrations"]
    assert list(m) == ["id", "kind", "source", "dest", "sourceSha256", "destSha256", "status", "migratedAt", "note"]
    assert (m["id"], m["kind"], m["source"], m["dest"], m["status"]) == \
        ("workspace:workspace.json", "workspace", ".groundwork-workspace/workspace.json",
         ".groundwork/workspace.json", "migrated")
    import hashlib
    assert m["sourceSha256"] == hashlib.sha256(raw).hexdigest()
    assert m["destSha256"] == hashlib.sha256((tmp_path / ".groundwork/workspace.json").read_bytes()).hexdigest()
    assert p.read_bytes() == raw


def test_p6_submit_processed_refused_and_add_idempotent(tmp_path):
    s = make(tmp_path)
    a = s.add_feedback("spec", "x")
    s.acknowledge([a["id"]])
    with pytest.raises(StoreError) as e:
        s.submit_feedback(a["id"])
    assert e.value.code == "state"
    assert s.add_feedback("spec", "x", id=a["id"])["status"] == "processed"


def test_p11_read_board_falls_back_to_legacy(tmp_path):
    leg = tmp_path / ".designdoc" / "old"
    leg.mkdir(parents=True)
    (leg / "decisions.json").write_bytes(COMPARE_DEMO.read_bytes())
    assert make(tmp_path).read_board("old") == COMPARE_DEMO.read_bytes()
