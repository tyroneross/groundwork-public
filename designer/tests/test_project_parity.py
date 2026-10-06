"""C3 (T-04): the Python and JS project stores produce byte-identical stores and equal projections.

One op script (designer/project/fixtures/parity-ops.json) runs through
designer/project/tools/parity_runner.py and parity-runner.mjs on two identical
temp repos, each with an injected counter clock and id generator.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from designer.decisions import decision_record as dr
from designer.project.project_store import _ruleable_view, decision_summary

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "designer" / "project" / "fixtures" / "parity-ops.json"
EDGE = ROOT / "designer" / "project" / "fixtures" / "decision-edge.json"
MALFORMED = ROOT / "designer" / "project" / "fixtures" / "decision-malformed.json"
COMPARE_DEMO = ROOT / "designer" / "decisions" / "fixtures" / "compare-demo" / "decisions.json"
JS_RUNNER = ROOT / "designer" / "project" / "tools" / "parity-runner.mjs"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is required for parity")


def _py(*args: str) -> str:
    env = {**os.environ, "PYTHONPATH": str(ROOT)}
    r = subprocess.run([sys.executable, "-m", "designer.project.tools.parity_runner", *args],
                       cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return r.stdout


def _js(*args: str) -> str:
    r = subprocess.run(["node", str(JS_RUNNER), *args], cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return r.stdout


def _setup(root: Path) -> None:
    fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
    setup = fx["setup"]
    for rel, text in setup["files"].items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode("utf-8"))
    for rel, src in setup["copies"].items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes((ROOT / src).read_bytes())
    ns = setup["mtimeNs"]
    for p in sorted(root.rglob("*"), key=lambda q: -len(q.parts)):
        os.utime(p, ns=(ns, ns))


@pytest.fixture(scope="module")
def runs(tmp_path_factory):
    py_root = tmp_path_factory.mktemp("py-store")
    js_root = tmp_path_factory.mktemp("js-store")
    _setup(py_root)
    _setup(js_root)
    legacy_before = (py_root / ".designdoc/.groundwork-workspace/workspace.json").read_bytes()
    py_out = json.loads(_py("ops", str(FIXTURE), str(py_root)))
    js_out = json.loads(_js("ops", str(FIXTURE), str(js_root)))
    return {"py_root": py_root, "js_root": js_root, "py": py_out, "js": js_out,
            "legacy_before": legacy_before}


@pytest.mark.parametrize("name", ["project.json", "workspace.json", ".gitignore",
                                  "decisions/compare-demo/decisions.json", "decisions/edge/decisions.json",
                                  "decisions/malformed/decisions.json"])
def test_store_files_byte_identical(runs, name):
    a = (runs["py_root"] / ".groundwork" / name).read_bytes()
    b = (runs["js_root"] / ".groundwork" / name).read_bytes()
    assert a == b, f"{name} differs between Python and JS"


def test_store_file_set_identical_and_no_leftovers(runs):
    def files(r: Path) -> list[str]:
        return sorted(p.relative_to(r).as_posix() for p in (r / ".groundwork").rglob("*") if p.is_file())
    assert files(runs["py_root"]) == files(runs["js_root"])
    assert not any(n.endswith(".tmp") or n.endswith("write.lock") for n in files(runs["py_root"]))


def test_op_results_identical(runs):
    for i, (a, b) in enumerate(zip(runs["py"], runs["js"])):
        assert a == b, f"op {i} result differs"
    assert len(runs["py"]) == len(runs["js"])


def test_op_script_exercised_what_it_claims(runs):
    """Guard against a script that silently stops covering a rule."""
    r = runs["py"]
    proj = json.loads((runs["py_root"] / ".groundwork/project.json").read_text(encoding="utf-8"))
    ws = json.loads((runs["py_root"] / ".groundwork/workspace.json").read_text(encoding="utf-8"))
    assert r[1]["legacy"] is True and r[1]["value"]["review"]["optionCount"] == 4  # normalizeReview on read
    assert r[2]["text"] == "Café — naïve façade ✓"                                  # stored trimmed (AM-13)
    assert r[5] == r[2]                                                             # same text: no change
    assert r[4]["text"] == "日本語のフィードバック"
    assert r[7] == {"deleted": r[6]["id"]}
    assert r[10] == {"error": "state"} and r[16] == {"error": "state"} and r[19] == {"error": "not-found"}
    assert r[13] == {"acknowledged": ["fb_cafe", "fb_emoji", "n-legacy", "fb_cafe"],
                     "refused": [{"id": "fb_cjk", "reason": "draft"},
                                 {"id": "canvas:c1", "reason": "canvas-cursor-owned"},
                                 {"id": "fb_missing", "reason": "unknown"}]}
    # AM-5: the saved-work submit mirrored a note; ack marked both; projection dedupes
    note = next(n for n in ws["notes"] if n["id"] == "fb_emoji")
    assert list(note) == ["id", "text", "review", "status", "createdAt", "processedAt"]
    assert note["status"] == "processed" and note["review"] == ws["review"]
    assert [f["id"] for f in r[30]].count("fb_emoji") == 1
    # AM-15 workspace migration entry; legacy bytes untouched
    mig = next(m for m in proj["migrations"] if m["kind"] == "workspace")
    assert mig["id"] == "workspace:workspace.json" and mig["dest"] == ".groundwork/workspace.json"
    assert mig["source"] == ".designdoc/.groundwork-workspace/workspace.json"
    assert (runs["py_root"] / ".designdoc/.groundwork-workspace/workspace.json").read_bytes() == runs["legacy_before"]
    # AM-7 preference order and supersede
    assert [p["status"] for p in r[32]] == ["active", "superseded"]
    assert r[32][1]["supersededBy"] == r[32][0]["id"]
    # unchanged artifact / migration upserts keep their stamps (P8)
    assert r[22]["recordedAt"] == r[20]["recordedAt"] and r[24]["migratedAt"] == r[23]["migratedAt"]
    assert r[29] is False                                                           # identical board bytes skipped
    codes = [w["code"] for w in r[33]["warnings"]]
    assert codes == ["conflict", "migration-failed", "canvas-invalid-rows", "legacy-unmigrated"]
    assert r[34]["decisions"][0]["items"]                                          # AM-6


@pytest.mark.parametrize("reader_src,writer", [("py", "py"), ("js", "py"), ("py", "js"), ("js", "js")])
def test_cross_read_projections_equal(runs, reader_src, writer):
    root = runs[f"{writer}_root"]
    got = json.loads((_py if reader_src == "py" else _js)("read", str(root)))
    ref = json.loads(_py("read", str(runs["py_root"])))
    assert got == ref


def test_cross_read_leaves_store_untouched(runs):
    before = {p: p.read_bytes() for p in (runs["js_root"] / ".groundwork").rglob("*") if p.is_file()}
    _py("read", str(runs["js_root"]))
    _js("read", str(runs["js_root"]))
    after = {p: p.read_bytes() for p in (runs["js_root"] / ".groundwork").rglob("*") if p.is_file()}
    assert before == after


@pytest.mark.parametrize("path", [COMPARE_DEMO, EDGE, MALFORMED])
def test_decision_summary_parity(path):
    py = json.loads(_py("summary", str(path)))
    js = json.loads(_js("summary", str(path)))
    assert py == js
    rec = json.loads(path.read_text(encoding="utf-8"))
    lanes = dr.lanes(_ruleable_view(rec)[0])
    assert (py["open"], py["ruled"]) == (len(lanes["open"]), len(lanes["ruled"]))
    assert py == decision_summary(rec)


def test_decision_edge_expected_lanes():
    s = decision_summary(json.loads(EDGE.read_text(encoding="utf-8")))
    lane = {(i["source"], i["id"], i["title"]): i["lane"] for i in s["items"]}
    expected_ruled = {"ax-addr-true", "ax-addr-str", "ax-sel-false", "ax-sel-zero", "ax-sel-list",
                      "ax-no-title", "oi-ruling-false", "oi-ruling-zero", "oi-ruling-x",
                      "oi-addr-zero-ruled", "cmp-approve", "cmp-addressed-list"}
    ruled_ids = {k[1] for k, v in lane.items() if v == "ruled" and k[1]}
    assert ruled_ids == expected_ruled
    by = {i["id"]: i for i in s["items"] if i["id"]}
    assert by["ax-sel-false"]["ruling"] is False and by["ax-sel-zero"]["ruling"] == 0
    assert by["ax-sel-blank"]["note"] is None and by["ax-null"]["title"] == "ax-null"
    assert by["ax-no-title"]["title"] == "ax-no-title"
    assert by["oi-ruling-zero"]["note"] == "zero"
    no_id = [i for i in s["items"] if i["id"] is None]                     # AM-7: "" -> null
    assert [(i["title"], i["lane"]) for i in no_id] == [("No id, ruled", "ruled"), (None, "open")]
    assert (s["open"], s["ruled"]) == (14, 13)


def test_malformed_ruleable_arrays_are_empty_with_named_errors(runs):
    """P4: a non-list axes/openItems/compares is empty plus one error per field, in both libraries."""
    s = decision_summary(json.loads(MALFORMED.read_text(encoding="utf-8")))
    assert s == {"open": 0, "ruled": 0, "items": [],
                 "errors": ["axes must be a list", "openItems must be a list", "compares must be a list"]}
    for reader in (_py, _js):
        boards = {b["slug"]: b for b in json.loads(reader("read", str(runs["py_root"])))["boards"]}
        b = boards["malformed"]
        assert b["valid"] is True and b["items"] == [] and b["errors"] == s["errors"]
