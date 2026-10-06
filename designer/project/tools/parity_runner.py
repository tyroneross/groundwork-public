"""Parity runner (Python side). Twin: parity-runner.mjs. Used by designer/tests/test_project_parity.py.

  python3 -m designer.project.tools.parity_runner ops <fixture.json> <root>   # run the op script
  python3 -m designer.project.tools.parity_runner read <root>                 # read-only projections
  python3 -m designer.project.tools.parity_runner summary <decisions.json>    # decision_summary

Prints canonical JSON. Every string equal to the store root becomes "<ROOT>".
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from designer.project.project_store import ProjectStore, StoreError, canonical, decision_summary

REPO = Path(__file__).resolve().parents[3]
READ_CLOCK = "2026-10-06T13:00:00.000Z"


def counter_clock(start: str, step_ms: int):
    t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
    n = {"i": 0}

    def now() -> str:
        t = t0 + timedelta(milliseconds=step_ms * n["i"])
        n["i"] += 1
        return t.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return now


def counter_ids():
    n = {"i": 0}

    def new_id(prefix: str) -> str:
        n["i"] += 1
        return f"{prefix}{n['i']:04d}"
    return new_id


def _resolve(v: Any, results: list) -> Any:
    if isinstance(v, str) and v.startswith("$") and "." in v:
        idx, key = v[1:].split(".", 1)
        return results[int(idx)][key]
    if isinstance(v, dict):
        return {k: _resolve(x, results) for k, x in v.items()}
    if isinstance(v, list):
        return [_resolve(x, results) for x in v]
    return v


def _norm_root(v: Any, root: str) -> Any:
    if isinstance(v, str):
        return "<ROOT>" if v == root else v
    if isinstance(v, dict):
        return {k: _norm_root(x, root) for k, x in v.items()}
    if isinstance(v, list):
        return [_norm_root(x, root) for x in v]
    return v


def run_op(s: ProjectStore, op: dict) -> Any:
    k = op["op"]
    if k == "init":
        return s.init()
    if k == "readWorkspace":
        value, legacy = s.read_workspace()
        return {"value": value, "legacy": legacy}
    if k == "upsertDraft":
        return s.upsert_draft(op.get("id"), op["section"], op["text"], op.get("target"), op.get("origin"))
    if k == "submitFeedback":
        return s.submit_feedback(op["id"], op.get("text"))
    if k == "addFeedback":
        return s.add_feedback(op["section"], op["text"], op.get("target"), op.get("origin"),
                              op.get("submit", True), op.get("id"))
    if k == "deleteDraft":
        return s.delete_draft(op["id"])
    if k == "acknowledge":
        return s.acknowledge(op["ids"])
    if k == "addPreference":
        return s.add_preference(op["text"], op.get("scope", "repo"), op.get("provenance"), op.get("supersedes"))
    if k == "appendAlternative":
        return s.change_workspace(lambda ws: ws["alternatives"].append(op["alternative"]))
    if k == "selectDesign":
        return s.select_design(op["id"])
    if k == "recordArtifact":
        return s.record_artifact(op["kind"], op["path"], op.get("meta"))
    if k == "recordMigration":
        return s.record_migration(op["entry"])
    if k == "writeBoard":
        return s.write_board(op["slug"], (REPO / op["file"]).read_bytes())
    if k == "listFeedback":
        return s.list_feedback(op.get("section"), op.get("status"))
    if k == "listPreferences":
        return s.list_preferences(op.get("includeSuperseded", False))
    if k == "snapshot":
        return s.snapshot()
    if k == "agentContract":
        return s.agent_contract()
    raise ValueError(f"unknown op {k}")


def run_ops(fixture: Path, root: Path) -> list:
    fx = json.loads(fixture.read_text(encoding="utf-8"))
    s = ProjectStore(root, now=counter_clock(fx["clock"]["start"], fx["clock"]["stepMs"]),
                     new_id=counter_ids(), tool="parity")
    results: list = []
    for op in fx["ops"]:
        try:
            results.append(run_op(s, _resolve(op, results)))
        except StoreError as e:
            results.append({"error": e.code})
    return _norm_root(results, str(s.root))


def read_all(root: Path) -> dict:
    s = ProjectStore(root, now=lambda: READ_CLOCK, new_id=counter_ids(), tool="parity")
    value, legacy = s.read_workspace()
    out = {"snapshot": s.snapshot(), "contract": s.agent_contract(), "feedback": s.list_feedback(),
           "preferences": s.list_preferences(True), "boards": s.list_boards(), "project": s.read_project(),
           "workspace": {"value": value, "legacy": legacy}}
    return _norm_root(out, str(s.root))


def main(argv: list[str]) -> int:
    cmd = argv[0]
    if cmd == "ops":
        out = run_ops(Path(argv[1]), Path(argv[2]))
    elif cmd == "read":
        out = read_all(Path(argv[1]))
    elif cmd == "summary":
        out = decision_summary(json.loads(Path(argv[1]).read_text(encoding="utf-8")))
    else:
        raise SystemExit(f"unknown command {cmd}")
    sys.stdout.write(canonical(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
