"""The scaffold, graded by running it.

The one behaviour worth more than the rest: `init` must refuse to overwrite an
existing record. A decision record is a document someone has been writing in, and
there is no undo for replacing it with a template.
"""
from __future__ import annotations

import json
from pathlib import Path

from designer.decisions import decision_record as dr
from designer.decisions import decisions_build as db


def test_init_creates_a_record_that_the_contract_accepts(tmp_path):
    assert db.main(["init", str(tmp_path), "--slug", "demo"]) == 0
    record = tmp_path / ".groundwork" / "decisions" / "demo" / "decisions.json"
    assert record.exists()
    rec = json.loads(record.read_text(encoding="utf-8"))
    assert dr.validate(rec) == []
    assert rec["schema"] == dr.SCHEMA
    assert rec["id"] == "demo"


def test_a_new_record_opens_with_something_waiting(tmp_path):
    """An empty surface reads as broken rather than as empty."""
    db.main(["init", str(tmp_path), "--slug", "demo"])
    rec = json.loads((tmp_path / ".groundwork" / "decisions" / "demo" / "decisions.json").read_text())
    assert len(dr.lanes(rec)["open"]) >= 1


def test_init_writes_the_record_and_visuals_but_no_app_copies(tmp_path):
    """The page is served from the install, so a fix to the board reaches every
    board; copies beside each record drifted from those fixes."""
    db.main(["init", str(tmp_path), "--slug", "demo"])
    out = tmp_path / ".groundwork" / "decisions" / "demo"
    for name in db.APP_FILES:
        assert not (out / name).exists(), f"{name} must not be copied beside the record"
    assert (out / "visuals" / "manifest.json").exists()
    assert (tmp_path / ".groundwork" / ".gitignore").read_text() == "*\n"
    assert not (tmp_path / ".groundwork" / "write.lock").exists()


def test_init_refuses_when_an_unmigrated_legacy_board_exists(tmp_path, capsys):
    legacy = tmp_path / ".designdoc" / "demo"
    legacy.mkdir(parents=True)
    (legacy / "decisions.json").write_text("{}", encoding="utf-8")
    assert db.main(["init", str(tmp_path), "--slug", "demo"]) != 0
    assert "designer.project migrate" in capsys.readouterr().err
    assert not (tmp_path / ".groundwork" / "decisions" / "demo").exists()
    assert (legacy / "decisions.json").read_text() == "{}"


def test_serve_targets_the_project_server_for_the_repo(tmp_path):
    cmd = db.serve_command(str(tmp_path), "demo", 8920, None)
    assert cmd[0] == "node"
    assert cmd[1].endswith("designer/project/project-server.mjs")
    assert cmd[2:] == ["--repo", str(tmp_path.resolve()), "--port", "8920"]


def test_init_refuses_to_overwrite_an_existing_record(tmp_path, capsys):
    db.main(["init", str(tmp_path), "--slug", "demo"])
    record = tmp_path / ".groundwork" / "decisions" / "demo" / "decisions.json"
    rec = json.loads(record.read_text())
    rec["openItems"].append({"id": "real-work", "question": "Something a person wrote",
                             "choices": [{"key": "a", "label": "A"}]})
    record.write_text(json.dumps(rec, indent=2), encoding="utf-8")
    before = record.read_bytes()

    assert db.main(["init", str(tmp_path), "--slug", "demo"]) != 0
    assert record.read_bytes() == before, "a second init must not touch the record"
    assert "already exists" in capsys.readouterr().err


def test_init_rejects_a_path_that_is_not_a_directory(tmp_path):
    assert db.main(["init", str(tmp_path / "nope"), "--slug", "demo"]) != 0


def test_check_accepts_the_shipped_fixture(capsys):
    fixture = Path(db.HERE) / "fixtures" / "shape-conformance.decisions.json"
    assert db.main(["check", str(fixture)]) == 0
    out = capsys.readouterr().out
    assert "valid" in out
    assert "open" in out and "ruled" in out


def test_check_reports_stale_prose_without_treating_it_as_an_error(capsys):
    """The fixture has ruled items whose status still says 'open'.

    That is a note, not a failure: the lane is derived from the ruling, and the
    prose belongs to whoever wrote it.
    """
    fixture = Path(db.HERE) / "fixtures" / "shape-conformance.decisions.json"
    assert db.main(["check", str(fixture)]) == 0
    assert "still carry a status beginning" in capsys.readouterr().out


def test_check_rejects_a_record_that_is_not_one(tmp_path, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"schema": "something/else", "id": "x"}), encoding="utf-8")
    assert db.main(["check", str(bad)]) != 0
    assert "invalid record" in capsys.readouterr().err


def test_check_reports_a_missing_file_rather_than_raising(tmp_path, capsys):
    assert db.main(["check", str(tmp_path / "absent.json")]) != 0
    assert "not found" in capsys.readouterr().err


def test_check_reports_malformed_json_rather_than_raising(tmp_path, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert db.main(["check", str(bad)]) != 0
    assert "not valid JSON" in capsys.readouterr().err


def test_the_record_is_written_atomically(tmp_path):
    """No half-written record may ever be readable, and no temp file survives."""
    db.main(["init", str(tmp_path), "--slug", "demo"])
    out = tmp_path / ".groundwork" / "decisions" / "demo"
    leftovers = [p.name for p in out.iterdir() if p.name.startswith(".") and p.name.endswith(".tmp")]
    assert not leftovers, f"temp files left behind: {leftovers}"


# ------------------------------------------------------------------ compares

def _compare_init(tmp_path) -> Path:
    assert db.main(["init", str(tmp_path), "--slug", "demo", "--template", "compare"]) == 0
    return tmp_path / ".groundwork" / "decisions" / "demo" / "decisions.json"


def test_init_compare_template_ships_a_valid_three_item_board(tmp_path):
    record = _compare_init(tmp_path)
    rec = json.loads(record.read_text(encoding="utf-8"))
    assert dr.validate(rec) == []
    assert rec["id"] == "demo"
    assert len(rec["compares"]) == 3
    visuals = record.parent / "visuals"
    for item in rec["compares"]:
        for side in ("optionA", "optionB"):
            v = (item.get(side) or {}).get("visual")
            if v:
                assert (visuals / v).is_file(), f"{item['id']} {side}: {v} was not copied"
    assert (visuals / "manifest.json").is_file()


def test_init_compare_never_overwrites_an_existing_picture(tmp_path):
    vis = tmp_path / ".groundwork" / "decisions" / "demo" / "visuals"
    vis.mkdir(parents=True)
    (vis / "home-current.png").write_bytes(b"mine")
    _compare_init(tmp_path)
    assert (vis / "home-current.png").read_bytes() == b"mine"


def _rule(record: Path, rulings: dict) -> None:
    rec = json.loads(record.read_text(encoding="utf-8"))
    for item in rec["compares"]:
        if item["id"] in rulings:
            item["ruling"], note = rulings[item["id"]]
            if note is not None:
                item["rulingText"] = note
    record.write_text(json.dumps(rec, indent=2), encoding="utf-8")


def test_export_writes_selection_json(tmp_path, capsys):
    record = _compare_init(tmp_path)
    _rule(record, {"home-intro": ("approve-b", None),
                   "plan-picker": ("revise-b", "Show the price on each row."),
                   "export-home": ("other", "A menu item, not a settings row.")})
    out = tmp_path / "design" / "mockups" / "selection.json"
    assert db.main(["export", str(record), "--format", "selection", "--out", str(out)]) == 0
    sel = json.loads(out.read_text(encoding="utf-8"))
    assert sel["schema"] == "groundwork.mockups.selection/v1"
    assert [(p["screen_id"], p["mode"]) for p in sel["perScreen"]] == [
        ("home-intro", "B"), ("plan-picker", "B-revise"), ("export-home", "other")]
    assert sel["perScreen"][1]["note"] == "Show the price on each row."
    assert sel["unanswered"] == 0
    assert "3 answered" in capsys.readouterr().out


def test_export_refuses_a_revise_without_a_note(tmp_path, capsys):
    record = _compare_init(tmp_path)
    _rule(record, {"plan-picker": ("revise-b", None)})
    assert db.main(["export", str(record), "--format", "selection"]) != 0
    assert "say what to change" in capsys.readouterr().err


def test_export_refuses_a_mockup_path_that_leaves_mockups(tmp_path, capsys):
    record = _compare_init(tmp_path)
    rec = json.loads(record.read_text(encoding="utf-8"))
    rec["compares"][0]["optionB"]["mockup"] = "../../etc/passwd"
    rec["compares"][0]["ruling"] = "approve-b"
    record.write_text(json.dumps(rec), encoding="utf-8")
    assert db.main(["export", str(record), "--format", "selection"]) != 0
    assert "stay inside" in capsys.readouterr().err


def test_check_json_reads_rulings_back(tmp_path, capsys):
    record = _compare_init(tmp_path)
    _rule(record, {"export-home": ("other", "Put it in the menu.")})
    capsys.readouterr()
    assert db.main(["check", str(record), "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    row = next(i for i in out["items"] if i["id"] == "export-home")
    assert row == {**row, "lane": "ruled", "ruling": "other", "note": "Put it in the menu.",
                   "kind": "compare", "source": "compares"}
    assert out["open"] == 2 and out["ruled"] == 1
