"""Tests for designer.decisions.verify_record.

Every record here is synthetic and built inline -- never a real project
record, never written inside the repo. `tmp_path` is the only place these
tests ever touch disk.
"""
from __future__ import annotations

import json

from designer.decisions import decision_record
from designer.decisions import verify_record as vr


def _record(**overrides):
    base = {
        "schema": decision_record.SCHEMA,
        "id": "rec-1",
        "axes": [],
        "openItems": [],
        "copy": {"heading": "Welcome"},
        "previewComments": [],
        "annotations": [],
        "history": [],
    }
    base.update(overrides)
    return base


def _write(tmp_path, record, name="record.json"):
    path = tmp_path / name
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def test_clean_record_exits_0(tmp_path):
    record = _record(annotations=[{"id": "an-1", "note": "Looks good to me."}])
    path = _write(tmp_path, record)
    assert vr.main([str(path)]) == 0


def test_user_annotation_with_real_content_kept_by_purge(tmp_path):
    """The exact regression that motivated this file: a real user
    annotation must survive `--purge` untouched."""
    record = _record(annotations=[
        {"id": "an-real-1", "note": "The CTA button feels off-center on mobile."},
    ])
    path = _write(tmp_path, record)
    rc = vr.main([str(path), "--purge"])
    assert rc == 0
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["annotations"] == record["annotations"]


def test_item_matching_test_id_prefix_removed_by_purge(tmp_path):
    record = _record(previewComments=[
        {"id": "an-user-1", "note": "Real feedback about spacing."},
        {"id": "test-abc123", "note": "irrelevant scratch content"},
    ])
    path = _write(tmp_path, record)
    rc = vr.main([str(path), "--purge"])
    assert rc == 0
    saved = json.loads(path.read_text(encoding="utf-8"))
    ids = [i["id"] for i in saved["previewComments"]]
    assert ids == ["an-user-1"]


def test_item_with_probe_marker_in_note_removed_by_purge(tmp_path):
    record = _record(annotations=[
        {"id": "an-1", "note": "[e2e-probe] automated click check"},
        {"id": "an-2", "note": "A genuine concern about the header spacing."},
    ])
    path = _write(tmp_path, record)
    rc = vr.main([str(path), "--purge"])
    assert rc == 0
    saved = json.loads(path.read_text(encoding="utf-8"))
    ids = [i["id"] for i in saved["annotations"]]
    assert ids == ["an-2"]


def test_unrecognised_item_kept_and_reported_as_user(tmp_path, capsys):
    record = _record(history=[
        {"id": "hist-mystery", "note": "Kept from an old review round."},
    ])
    path = _write(tmp_path, record)
    rc = vr.main([str(path)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "[USER]" in out
    assert "hist-mystery" in out


def test_transient_field_violation_detected(tmp_path):
    record = _record(previewComments=[
        {"id": "pc-1", "note": "hi", "savedToFile": True},
    ])
    path = _write(tmp_path, record)
    assert vr.main([str(path)]) == 1


def test_purge_refuses_to_write_when_invariant_violated(tmp_path):
    record = _record(previewComments=[
        {"id": "pc-1", "note": "hi", "unsaved": True},
    ])
    path = _write(tmp_path, record)
    before = path.read_bytes()
    rc = vr.main([str(path), "--purge"])
    assert rc == 1
    after = path.read_bytes()
    assert before == after


def test_id_coherence_violation_same_id_live_and_archived(tmp_path):
    record = _record(
        annotations=[{"id": "dup-1", "note": "live copy"}],
        history=[{"id": "dup-1", "note": "archived copy"}],
    )
    path = _write(tmp_path, record)
    assert vr.main([str(path)]) == 1


def test_probe_marker_hidden_in_axis_note_is_found(tmp_path, capsys):
    record = _record(axes=[
        {"id": "ax-1", "note": "leftover [e2e-probe] text",
         "options": [{"key": "a", "label": "A"}]},
    ])
    path = _write(tmp_path, record)
    rc = vr.main([str(path)])
    out = capsys.readouterr().out
    assert rc == 1
    assert "axes[0].note" in out


def test_probe_marker_hidden_in_copy_value_is_found(tmp_path, capsys):
    record = _record(copy={"heading": "[e2e-probe] Welcome"})
    path = _write(tmp_path, record)
    rc = vr.main([str(path)])
    out = capsys.readouterr().out
    assert rc == 1
    assert "copy.heading" in out


def test_report_only_mode_never_modifies_the_file(tmp_path):
    record = _record(previewComments=[{"id": "test-junk", "note": "x"}])
    path = _write(tmp_path, record)
    before = path.read_bytes()
    vr.main([str(path)])
    after = path.read_bytes()
    assert before == after


def test_selftest_exits_0():
    assert vr.main(["--selftest"]) == 0


def test_purge_keeps_a_pin_that_has_a_selector_but_no_note_yet(tmp_path):
    """A pin is saved the moment it is dropped, before its note is typed.

    It then carries `{id, selector}` and an empty note. Classifying that as an
    automated click meant `--purge` deleted a real pin the person had just
    placed -- the precise failure this module was written to prevent, arriving
    through the one field nobody had listed as an anchor.
    """
    record = tmp_path / "decisions.json"
    record.write_text(json.dumps({
        "schema": "groundwork.decision-set/v1", "id": "x",
        "axes": [{"id": "a", "title": "t", "decision": "d",
                  "options": [{"key": "k", "label": "l"}]}],
        "openItems": [],
        "annotations": [{"id": "ann-just-dropped", "note": "",
                         "selector": "[data-component='Hero'] h1"}],
        "previewComments": [], "history": [],
    }, indent=2), encoding="utf-8")

    assert vr.main([str(record), "--purge"]) == 0
    kept = json.loads(record.read_text(encoding="utf-8"))["annotations"]
    assert [a["id"] for a in kept] == ["ann-just-dropped"], (
        "a freshly dropped pin must survive a purge")


def test_a_coordinate_only_pin_with_no_anchor_is_still_classified_as_test(tmp_path):
    """The negative control: widening ANCHOR_KEYS must not disable the rule."""
    record = tmp_path / "decisions.json"
    record.write_text(json.dumps({
        "schema": "groundwork.decision-set/v1", "id": "x",
        "axes": [{"id": "a", "title": "t", "decision": "d",
                  "options": [{"key": "k", "label": "l"}]}],
        "openItems": [],
        "annotations": [{"id": "ann-robot", "note": "", "x": 10, "y": 20}],
        "previewComments": [], "history": [],
    }, indent=2), encoding="utf-8")

    assert vr.main([str(record), "--purge"]) == 0
    assert json.loads(record.read_text(encoding="utf-8"))["annotations"] == []
