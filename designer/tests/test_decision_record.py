"""The record contract, and the parity that keeps two languages honest.

The normalizer exists twice -- `decision_record.py` for tooling and the pure
half of `app/decisions.js` for the browser. Two implementations of one rule drift
silently, and the drift would show up as a decision landing in the wrong lane on
one surface and not the other. So the adapter table is compared across the two
files here rather than trusted.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest

from designer.decisions import decision_record as dr

ROOT = Path(__file__).resolve().parent.parent
APP_JS = ROOT / "decisions" / "app" / "decisions.js"
FIXTURES = ROOT / "decisions" / "fixtures"
COMPARE_DEMO = FIXTURES / "compare-demo" / "decisions.json"
SHAPE = FIXTURES / "shape-conformance.decisions.json"
REFERENCE_FP = FIXTURES / "reference-fingerprint.json"


@pytest.fixture(scope="module")
def shape() -> dict:
    return json.loads(SHAPE.read_text(encoding="utf-8"))


def test_module_selftest_passes():
    assert dr._selftest() == 0


def test_the_shipped_fixture_is_a_valid_record(shape):
    assert dr.validate(shape) == []


def test_lane_is_derived_from_the_ruling_not_the_prose_status(shape):
    """The rule the whole contract rests on.

    The fixture deliberately contains items whose `status` begins "open" while
    they already carry a ruling, because that is what real records look like: on
    the record this surface was built against, 20 of 25 items were in exactly
    that state. A lane read off `status` mislabels every one of them.
    """
    by = {r.id: r for r in dr.ruleables(shape)}
    contradictions = [
        r for r in by.values()
        if str(r.status_prose or "").strip().lower().startswith("open") and r.lane == "ruled"
    ]
    assert contradictions, "the fixture must exercise the stale-status case"
    for r in contradictions:
        assert dr._truthy(r.chosen), f"{r.id} is ruled, so its lane must be ruled"


def test_status_is_never_constrained_to_an_enum(shape):
    """Unbounded by design: value 16 arrives with the next record."""
    statuses = {r.status_prose for r in dr.ruleables(shape) if r.status_prose}
    assert len(statuses) >= 4
    src = (ROOT / "decisions" / "decision_record.py").read_text(encoding="utf-8")
    assert "STATUS_ENUM" not in src
    assert not re.search(r'status.*in\s*\(\s*"open"', src)


def test_unknown_top_level_keys_are_carried_not_rejected(shape):
    """A closed schema would reject the documents it exists to render."""
    assert dr.validate(dict(shape, someFutureKey={"a": 1}, anotherOne=[1, 2])) == []


def test_a_ruleable_without_an_id_is_rejected():
    errs = dr.validate({"schema": dr.SCHEMA, "id": "x", "axes": [{"title": "no id"}]})
    assert any("has no id" in m for m in errs)


def test_write_back_cannot_cross_between_the_two_arrays(shape):
    by = {r.id: r for r in dr.ruleables(shape)}
    axis = next(r for r in by.values() if r.source == "axes")
    item = next(r for r in by.values() if r.source == "openItems")
    a = axis.write_back(chosen="b", free_text="reason")
    i = item.write_back(chosen="own", free_text="words")
    assert a == {"selected": "b", "note": "reason"}
    assert i == {"ruling": "own", "rulingText": "words"}
    assert "ruling" not in a and "selected" not in i


def test_a_false_ruling_survives_normalization():
    """`or None` on the chosen field would erase this and reopen a settled item."""
    r = dr.Ruleable("openItems", 0, {"id": "x", "ruling": False})
    assert r.chosen is False
    assert r.lane == "ruled"


# ------------------------------------------------------------------ fingerprint

def test_fingerprint_carries_structure_and_never_content(shape):
    fp = dr.fingerprint(shape)
    blob = json.dumps(fp)
    for r in dr.ruleables(shape):
        for authored in (r.free_text, r.status_prose, r.why, r.title):
            if authored and len(str(authored)) > 12:
                assert str(authored) not in blob, (
                    "a fingerprint is shape only -- it is what lets a private "
                    "record act as a conformance fixture in a public repo")


def test_the_committed_reference_fingerprint_records_the_real_shape():
    """Evidence, kept deliberately content-free.

    This is the structural summary of the real project record the surface was
    ported from. The record itself is not in this repository and must not be:
    it holds unshipped positioning and quoted private conversation, and
    Groundwork ships publicly. What is checkable here is the shape, and the one
    number that settles the contract's central question.
    """
    fp = json.loads(REFERENCE_FP.read_text(encoding="utf-8"))
    assert fp["schema"] == dr.SCHEMA
    items = fp["arrays"]["openItems"]
    assert items["count"] == 25
    assert items["open"] == 2 and items["ruled"] == 23
    assert items["distinctStatusCount"] == 15, "status is prose, not an enum"
    assert items["statusSaysOpenButRuled"] == 20, (
        "20 of 25 items said 'open' while already ruled -- reading `status` "
        "would have mislabelled 80% of the queue")
    # No authored value may appear anywhere in the committed artifact.
    blob = json.dumps(fp)
    assert "MERGE BLOCKER" not in blob


def test_fingerprint_is_reproducible(shape):
    assert dr.fingerprint(shape) == dr.fingerprint(json.loads(json.dumps(shape)))


# -------------------------------------------------------- cross-language parity

def _js_adapter() -> dict[str, dict[str, str | None]]:
    """Read the adapter table out of decisions.js by EXECUTING it.

    Parsing it with a regex would grade a comment. Running it in node grades the
    object the browser will actually use.
    """
    script = f"""
      const fs = require("node:fs"), vm = require("node:vm");
      const sandbox = {{ console }}; sandbox.globalThis = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync({str(APP_JS)!r}, "utf8"), sandbox);
      process.stdout.write(JSON.stringify(sandbox.GroundworkDecisions.ADAPTER));
    """
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, f"could not load decisions.js in node: {out.stderr}"
    return json.loads(out.stdout)


def test_the_two_normalizers_agree_on_every_field_mapping():
    js = _js_adapter()
    py = dr.ADAPTER
    assert set(js) == set(py), (
        f"adapter fields differ: only in js {sorted(set(js) - set(py))}, "
        f"only in python {sorted(set(py) - set(js))}")
    for fieldname in py:
        assert js[fieldname] == py[fieldname], (
            f"{fieldname} maps differently: js={js[fieldname]} python={py[fieldname]}")


def test_both_languages_put_the_same_items_in_the_same_lane(shape):
    """The rule, not just the table. Executed on both sides, compared."""
    script = f"""
      const fs = require("node:fs"), vm = require("node:vm");
      const sandbox = {{ console }}; sandbox.globalThis = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync({str(APP_JS)!r}, "utf8"), sandbox);
      const D = sandbox.GroundworkDecisions;
      const rec = JSON.parse(fs.readFileSync({str(SHAPE)!r}, "utf8"));
      const out = {{}};
      D.normalize(rec).forEach((r) => {{ out[r.id] = D.lane(r); }});
      process.stdout.write(JSON.stringify(out));
    """
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    js_lanes = json.loads(out.stdout)
    py_lanes = {r.id: r.lane for r in dr.ruleables(shape)}
    assert js_lanes == py_lanes, (
        "the browser and the tooling disagree about what is still open: "
        f"{ {k: (js_lanes.get(k), py_lanes.get(k)) for k in set(js_lanes) | set(py_lanes) if js_lanes.get(k) != py_lanes.get(k)} }")


def test_both_languages_agree_on_what_counts_as_a_ruling():
    """The falsy-but-real cases are where two implementations drift."""
    cases = [None, "", "   ", False, 0, "own", [], ["a"], {}]
    script = f"""
      const fs = require("node:fs"), vm = require("node:vm");
      const sandbox = {{ console }}; sandbox.globalThis = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync({str(APP_JS)!r}, "utf8"), sandbox);
      const D = sandbox.GroundworkDecisions;
      process.stdout.write(JSON.stringify({json.dumps(cases)}.map(D.truthy)));
    """
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout) == [dr._truthy(c) for c in cases]


# ------------------------------------------------------------------- compares

def _js(expr_body: str) -> object:
    """Run `expr_body` against the browser's decisions.js in node; it must
    assign the value to compare to `out`."""
    script = f"""
      const fs = require("node:fs"), vm = require("node:vm");
      const sandbox = {{ console }}; sandbox.globalThis = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync({str(APP_JS)!r}, "utf8"), sandbox);
      const D = sandbox.GroundworkDecisions;
      let out;
      {expr_body}
      process.stdout.write(JSON.stringify(out));
    """
    res = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


# Every shape a compare item arrives in: full objects, bare-string options,
# missing options, a visual that is not a string, an empty second opinion, a
# ruled item and a noteless one.
COMPARE_CASES = {
    "schema": dr.SCHEMA, "id": "cmp-parity",
    "compares": [
        {"id": "full", "area": "Home", "question": "Q1", "why": "W1",
         "optionA": {"summary": "a", "visual": "a.png"},
         "optionB": {"summary": "b", "visual": "b.html", "mockup": "m/b.html"},
         "secondOpinion": {"source": "Panel", "verdict": "approve", "note": "n"}},
        {"id": "strings", "question": "Q2", "optionA": "now", "optionB": "next",
         "ruling": "revise-b", "rulingText": "tighter"},
        {"id": "bare", "question": "Q3"},
        {"id": "no-summary", "question": "Q3b", "optionA": {"visual": "a.png"},
         "optionB": {"summary": "", "visual": "  "}},
        {"id": "odd", "question": "Q4", "area": "",
         "optionA": {"summary": 7, "visual": 3}, "optionB": ["not", "an", "object"],
         "secondOpinion": {"source": "", "verdict": "", "note": ""},
         "ruling": "other", "rulingText": "a third way", "ruledAt": "2026-01-01T00:00:00Z"},
        {"id": "cleared", "question": "Q5", "ruling": "  "},
        # Malformed values the two languages used to stringify differently.
        {"id": "malformed", "question": "Q6", "area": {},
         "secondOpinion": {"source": [], "verdict": 5},
         "optionA": {"summary": ["a", "b"]}, "optionB": {"summary": None}},
    ],
}
PARITY_FIELDS = ("source", "id", "title", "prompt", "why", "chosen", "freeText",
                 "ruledAt", "status", "kind", "choices", "compare", "lane")


def test_both_normalizers_produce_the_same_compare_items():
    """Compare normalization, executed in both languages and compared field by
    field -- the fields the surface renders and the export reads."""
    py = {r.id: {k: v for k, v in r.to_dict().items() if k in PARITY_FIELDS}
          for r in dr.ruleables(COMPARE_CASES)}
    js = _js(f"""
      const rec = {json.dumps(COMPARE_CASES)};
      out = {{}};
      D.normalize(rec).forEach((r) => {{
        const row = {{}};
        {json.dumps(list(PARITY_FIELDS))}.forEach((k) => {{
          row[k] = k === "lane" ? D.lane(r) : r[k];
        }});
        out[r.id] = row;
      }});
    """)
    assert set(js) == set(py)
    for rid in py:
        diff = {k: (js[rid].get(k), py[rid].get(k)) for k in PARITY_FIELDS
                if js[rid].get(k) != py[rid].get(k)}
        assert not diff, f"{rid}: js vs python differ on {diff}"


def test_the_four_rulings_are_the_same_in_both_languages():
    js = _js("out = D.COMPARE_CHOICES.map((c) => [c.key, c.label, c.needsText]);")
    py = [[c["key"], c["label"], c["needsText"]] for c in dr.COMPARE_CHOICES]
    assert js == py
    assert [k for k, _, _ in py] == ["keep-a", "approve-b", "revise-b", "other"]


def test_note_required_rule_agrees_in_both_languages():
    cases = [[k, n] for k in ("keep-a", "approve-b", "revise-b", "other", "maybe", None, "")
             for n in (None, "", "   ", "a note")]
    js = _js(f"out = {json.dumps(cases)}.map(([k, n]) => D.compareNoteError(k, n));")
    py = [dr.compare_note_error(k, n) for k, n in cases]
    assert js == py
    need = {k for (k, n), e in zip(cases, py) if e and n == "a note"}
    assert need == {"maybe"}, "only an unknown ruling fails once a note is present"
    for k in ("revise-b", "other"):
        assert dr.compare_note_error(k, "  ") is not None
        assert dr.compare_note_error(k, "a note") is None
    for k in ("keep-a", "approve-b"):
        assert dr.compare_note_error(k, None) is None


def test_validate_refuses_a_noteless_revise_or_neither_and_an_unknown_ruling():
    for ruling in ("revise-b", "other"):
        errs = dr.validate({"schema": dr.SCHEMA, "id": "x",
                            "compares": [{"id": "c", "ruling": ruling}]})
        assert any("compares[0]" in m for m in errs), errs
    errs = dr.validate({"schema": dr.SCHEMA, "id": "x",
                        "compares": [{"id": "c", "ruling": "approve"}]})
    assert any("must be one of" in m for m in errs), errs
    assert dr.validate({"schema": dr.SCHEMA, "id": "x",
                        "compares": [{"id": "c", "ruling": "keep-a"}]}) == []


def test_compare_lane_is_derived_from_the_ruling():
    by = {r.id: r for r in dr.ruleables(COMPARE_CASES)}
    assert by["full"].lane == "open"
    assert by["strings"].lane == "ruled"
    assert by["cleared"].lane == "open", "a whitespace ruling is a cleared ruling"
    assert by["full"].write_back(chosen="keep-a", free_text="n") == {
        "ruling": "keep-a", "rulingText": "n"}


def test_export_maps_every_ruling_to_its_selection_mode():
    rec = {"schema": dr.SCHEMA, "id": "board", "compares": [
        {"id": "k", "ruling": "keep-a", "optionA": {"mockup": "a.html"}},
        {"id": "a", "ruling": "approve-b", "optionB": {"mockup": "b.html"}},
        {"id": "r", "ruling": "revise-b", "rulingText": "smaller", "optionB": {"mockup": "b.html"}},
        {"id": "o", "ruling": "other", "rulingText": "neither", "optionB": {"mockup": "b.html"}},
        {"id": "u"},
    ]}
    sel = dr.to_selection(rec, slug="s", selected_at="t")
    assert sel["schema"] == "groundwork.mockups.selection/v1"
    assert sel["slug"] == "s" and sel["selectedAt"] == "t"
    rows = {p["screen_id"]: p for p in sel["perScreen"]}
    assert {k: v["mode"] for k, v in rows.items()} == {
        "k": "A", "a": "B", "r": "B-revise", "o": "other"}
    assert rows["k"]["html_path"] == "a.html", "Keep A points at A's mockup"
    assert rows["r"]["html_path"] == "b.html" and rows["r"]["note"] == "smaller"
    assert "html_path" not in rows["o"], "Neither selects no mockup"
    assert sel["unanswered"] == 1 and "u" not in rows


def test_grouped_export_uses_one_saved_choice_and_preserves_earlier_feedback():
    rec = {"schema": dr.SCHEMA, "id": "board", "compares": [
        {"id": "blue", "area": "Panel", "optionA": {"summary": "Current", "visual": "now.png"},
         "optionB": {"summary": "Blue", "mockup": "blue.html"},
         "ruling": "revise-b", "rulingText": "less blue"},
        {"id": "gray", "area": "Panel", "optionA": {"summary": "Current", "visual": "now.png"},
         "optionB": {"summary": "Gray", "mockup": "gray.html"}, "ruling": "approve-b"},
    ]}
    assert len(dr.comparison_sets(rec)) == 1
    before = dr.to_selection(rec)
    assert before["perScreen"] == [] and before["unanswered"] == 1
    rec["groupSelections"] = {"blue": {"selected": "gray", "note": "calmer", "ruledAt": "T"}}
    assert dr.validate(rec) == []
    after = dr.to_selection(rec)
    assert after["perScreen"] == [
        {"screen_id": "blue", "mode": "B", "html_path": "gray.html", "note": "calmer"}]
    assert after["unanswered"] == 0
    assert rec["compares"][0]["ruling"] == "revise-b"
    rec["groupSelections"]["blue"]["selected"] = "missing"
    assert any("selects no version" in error for error in dr.validate(rec))


def test_implementation_status_requires_valid_choice_and_verification():
    rec = {"schema": dr.SCHEMA, "id": "board", "compares": [
        {"id": "blue", "area": "Panel", "optionA": {"summary": "Current"}, "optionB": {"summary": "Blue"}},
        {"id": "gray", "area": "Panel", "optionA": {"summary": "Current"}, "optionB": {"summary": "Gray"}},
    ], "groupSelections": {"blue": {"selected": "gray"}}}
    rec["implementationStatus"] = {"blue": {"selected": "gray", "stage": "complete",
        "proposal": rec["compares"][1]["optionB"].copy(), "decisionNote": "",
        "evidence": [{"kind": "source", "detail": "Source changed", "ref": "src/view.ts:8"}]}}
    assert any("requires verification" in error for error in dr.validate(rec))
    rec["implementationStatus"]["blue"]["evidence"].append(
        {"kind": "verification", "detail": "UI checked", "ref": "reports/ui.txt", "revision": "abc123"})
    assert dr.validate(rec) == []
    rec["groupSelections"]["blue"]["selected"] = "blue"
    assert dr.validate(rec) == [], "changing a choice must not block save; UI treats old evidence as pending"
    rec["implementationStatus"]["blue"]["selected"] = "missing"
    assert any("names no choice" in error for error in dr.validate(rec))
    rec["implementationStatus"]["blue"]["selected"] = []
    rec["implementationStatus"]["blue"]["stage"] = []
    errors = dr.validate(rec)
    assert any("names no choice" in error for error in errors)
    assert any("stage must" in error for error in errors)
    rec["implementationStatus"]["blue"]["stage"] = "complete"
    rec["implementationStatus"]["blue"]["evidence"][0]["kind"] = []
    assert any("evidence must" in error for error in dr.validate(rec))


def test_the_shipped_compare_demo_is_valid_and_synthetic():
    rec = json.loads(COMPARE_DEMO.read_text(encoding="utf-8"))
    assert dr.validate(rec) == []
    items = [r for r in dr.ruleables(rec) if r.source == "compares"]
    assert len(items) == 3 and all(r.lane == "open" for r in items)
    assert "SYNTHETIC" in " ".join(rec.get("_comment", []))
    visuals = COMPARE_DEMO.parent / "visuals"
    for r in items:
        for side in ("optionA", "optionB"):
            v = r.compare[side]["visual"]
            if v:
                assert (visuals / v).is_file(), f"{r.id} {side} names a missing file {v}"


def test_export_tie_goes_to_the_proposal_not_dict_order():
    rec = {"schema": dr.SCHEMA, "id": "t", "compares": [
        {"id": "a", "ruling": "keep-a"}, {"id": "b", "ruling": "approve-b"}]}
    sel = dr.to_selection(rec)
    assert sel["dominantChoice"] == "B"
    assert sel["primaryMode"] is None
