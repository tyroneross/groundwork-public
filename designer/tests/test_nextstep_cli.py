"""Tests for the CLI `next-step` subcommand and the contract.option_hints extension.

Covers:
  1. next-step with no --answer → action PENDING_HOST, contract has candidates +
     answer block that includes an option_hints slot (set to None).
  2. Round-trip ask: fill answer {action:"ask", chosen_category_id, rationale,
     option_hints:[{option_id, highlight:true, annotate:"best fit"}]}, run
     next-step --answer → action "ask", decision payload present, hinted option
     carries highlight:true + annotate:"best fit", ALL other options are present
     (count unchanged — not filtered), agent_reason == rationale string.
  3. Fill answer {action:"infer"} → action "infer", state.asked grew by 1.
  4. Fill answer {action:"done"} → action "done".
  5. validate_contract_answer: option_hints with a non-string option_id →
     non-empty error list.
  6. validate_contract_answer: valid option_hints → empty error list.
  7. validate_contract_answer: option_hints present with action=="infer" →
     still valid (soft no-op, no error).

Run:
  /workspace/example-project Guidance/.venv/bin/python \
    -m pytest designer/tests/test_nextstep_cli.py -q
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stdout
from types import SimpleNamespace

# Ensure project root is on path.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from designer.engine import cli as cli_mod
from designer.engine import contract as contract_mod
from designer.engine.catalog_loader import load_catalog
from designer.engine.state import TasteState


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fresh_state() -> dict:
    """Return a bare state dict (empty TasteState)."""
    return TasteState().to_dict()


def _run_next_step(state_dict: dict, answer_path: str | None = None) -> dict:
    """Call cmd_next_step via an args shim, capture stdout, parse JSON."""
    args = SimpleNamespace(state=None, answer=answer_path)

    # Write state to a temp file so _load_state reads it.
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as sf:
        json.dump(state_dict, sf)
        state_path = sf.name

    args.state = state_path
    buf = io.StringIO()
    try:
        with redirect_stdout(buf):
            cli_mod.cmd_next_step(args)
    finally:
        os.unlink(state_path)

    return json.loads(buf.getvalue())


def _write_answer(answer_dict: dict) -> str:
    """Write a filled contract dict to a temp file and return the path."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as af:
        json.dump(answer_dict, af)
        return af.name


def _get_first_candidate_and_option(state_dict: dict) -> tuple[str, str]:
    """Get the first candidate id and its first option id from a PENDING_HOST contract."""
    result = _run_next_step(state_dict)
    assert result["action"] == "PENDING_HOST", result
    contract = result["contract"]
    assert contract["candidates"], "Expected at least one candidate"
    first_cand = contract["candidates"][0]
    first_opt = first_cand["options"][0]["id"]
    return first_cand["id"], first_opt


# ---------------------------------------------------------------------------
# Test 1: no --answer → PENDING_HOST with option_hints slot
# ---------------------------------------------------------------------------

def test_no_answer_returns_pending_host():
    result = _run_next_step(_fresh_state())

    assert result["action"] == "PENDING_HOST", result
    assert "contract" in result
    assert "state" in result

    contract = result["contract"]
    # Must have candidates and answer block
    assert isinstance(contract.get("candidates"), list)
    assert len(contract["candidates"]) > 0

    # Answer block must exist and include the option_hints slot (set to None)
    answer = contract.get("answer")
    assert isinstance(answer, dict), "answer block must be present"
    assert "action" in answer
    assert "chosen_category_id" in answer
    assert "rationale" in answer
    assert "option_hints" in answer, (
        "answer block must contain option_hints slot so host LLM sees it"
    )
    assert answer["option_hints"] is None


# ---------------------------------------------------------------------------
# Test 2: filled ask answer with option_hints → annotated payload, no filtering
# ---------------------------------------------------------------------------

def test_ask_with_option_hints_round_trip():
    state = _fresh_state()

    # Get the PENDING_HOST contract — the host LLM fills slots IN this dict.
    raw = _run_next_step(state)
    assert raw["action"] == "PENDING_HOST"
    full_contract = raw["contract"]

    all_candidates = full_contract["candidates"]
    # Pick the first candidate and its first option
    chosen = all_candidates[0]
    cand_id = chosen["id"]
    opt_id = chosen["options"][0]["id"]
    total_options = len(chosen["options"])
    assert total_options > 0

    # Fill the answer block inside the full contract (real-world usage: the host
    # LLM fills slots in the contract it received, not a bare {answer:...} dict).
    full_contract["answer"] = {
        "action": "ask",
        "chosen_category_id": cand_id,
        "rationale": "because X",
        "option_hints": [
            {
                "option_id": opt_id,
                "highlight": True,
                "annotate": "best fit",
            }
        ],
    }
    answer_path = _write_answer(full_contract)
    try:
        result = _run_next_step(state, answer_path=answer_path)
    finally:
        os.unlink(answer_path)

    assert result["action"] == "ask", result
    assert "decision" in result
    assert "state" in result
    assert result.get("agent_reason") == "because X"

    payload = result["decision"]
    options = payload["options"]

    # All options must still be present — no filtering
    assert len(options) == total_options, (
        f"option_hints must NOT filter options: expected {total_options}, got {len(options)}"
    )

    # The hinted option must carry highlight + annotate
    hinted = next((o for o in options if o["id"] == opt_id), None)
    assert hinted is not None, f"Hinted option {opt_id!r} disappeared"
    assert hinted.get("highlight") is True, hinted
    assert hinted.get("annotate") == "best fit", hinted

    # Other options must NOT have been modified (no highlight/annotate keys set)
    for opt in options:
        if opt["id"] != opt_id:
            assert not opt.get("highlight"), f"Non-hinted option gained highlight: {opt}"


# ---------------------------------------------------------------------------
# Test 3: filled infer answer → state.asked grew by 1
# ---------------------------------------------------------------------------

def test_infer_answer_grows_asked():
    state = _fresh_state()
    initial_asked_count = len(state.get("asked", []))

    # Must use the full contract so validate_contract_answer has candidates.
    raw = _run_next_step(state)
    full_contract = raw["contract"]
    full_contract["answer"] = {
        "action": "infer",
        "chosen_category_id": None,
        "rationale": "low-info dimension",
    }
    answer_path = _write_answer(full_contract)
    try:
        result = _run_next_step(state, answer_path=answer_path)
    finally:
        os.unlink(answer_path)

    assert result["action"] == "infer", result
    assert "state" in result
    new_asked = result["state"].get("asked", [])
    assert len(new_asked) == initial_asked_count + 1, (
        f"Expected asked to grow by 1 after infer; before={initial_asked_count}, after={len(new_asked)}"
    )


# ---------------------------------------------------------------------------
# Test 4: filled done answer → action done
# ---------------------------------------------------------------------------

def test_done_answer():
    state = _fresh_state()
    raw = _run_next_step(state)
    full_contract = raw["contract"]
    full_contract["answer"] = {
        "action": "done",
        "chosen_category_id": None,
        "rationale": "sufficient decisions made",
    }
    answer_path = _write_answer(full_contract)
    try:
        result = _run_next_step(state, answer_path=answer_path)
    finally:
        os.unlink(answer_path)

    assert result["action"] == "done", result
    assert "state" in result


# ---------------------------------------------------------------------------
# Test 5: validate_contract_answer with non-string option_id → errors
# ---------------------------------------------------------------------------

def test_validate_option_hints_bad_option_id():
    # Build a minimal contract with candidates so the action=="ask" path is valid
    cat = load_catalog(strict=False)
    state = TasteState()
    contract = contract_mod.build_decision_contract(state, cat)
    first_cand_id = contract["candidates"][0]["id"]

    contract["answer"] = {
        "action": "ask",
        "chosen_category_id": first_cand_id,
        "rationale": "test",
        "option_hints": [
            {"option_id": 123, "highlight": True}  # option_id must be str
        ],
    }
    errors = contract_mod.validate_contract_answer(contract)
    assert len(errors) > 0, "Expected validation error for non-string option_id"
    assert any("option_id" in e for e in errors), errors


# ---------------------------------------------------------------------------
# Test 6: validate_contract_answer with valid option_hints → empty error list
# ---------------------------------------------------------------------------

def test_validate_option_hints_valid():
    cat = load_catalog(strict=False)
    state = TasteState()
    contract = contract_mod.build_decision_contract(state, cat)
    first_cand = contract["candidates"][0]
    first_cand_id = first_cand["id"]
    first_opt_id = first_cand["options"][0]["id"]

    contract["answer"] = {
        "action": "ask",
        "chosen_category_id": first_cand_id,
        "rationale": "test",
        "option_hints": [
            {"option_id": first_opt_id, "highlight": True, "annotate": "recommended"}
        ],
    }
    errors = contract_mod.validate_contract_answer(contract)
    assert errors == [], f"Expected no errors for valid option_hints, got: {errors}"


# ---------------------------------------------------------------------------
# Test 7: validate_contract_answer with option_hints + action=="infer" → valid
# ---------------------------------------------------------------------------

def test_validate_option_hints_with_infer_is_noop():
    """option_hints with action!="ask" must not produce an error (soft no-op)."""
    cat = load_catalog(strict=False)
    state = TasteState()
    contract = contract_mod.build_decision_contract(state, cat)
    first_cand = contract["candidates"][0]
    first_opt_id = first_cand["options"][0]["id"]

    contract["answer"] = {
        "action": "infer",
        "chosen_category_id": None,
        "rationale": "auto-infer",
        "option_hints": [
            {"option_id": first_opt_id, "highlight": True}
        ],
    }
    errors = contract_mod.validate_contract_answer(contract)
    assert errors == [], (
        f"option_hints with action=='infer' must be a soft no-op (no error), got: {errors}"
    )
