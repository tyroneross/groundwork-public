"""Tests for the chat generative path: validate_mockup, validate_contract_answer,
build_decision_contract with pending_chat, decide.next_step for generate/rehighlight,
and the accept-deltas CLI acceptance path (F2).

Run: python -m pytest designer/tests/test_chat_generative.py -q
"""

from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))
sys.path.insert(0, _ROOT)

from designer.engine.contract import (
    VALID_ACTIONS,
    build_decision_contract,
    validate_contract_answer,
    validate_mockup,
)
from designer.engine.catalog_loader import load_catalog
from designer.engine.state import TasteState
import designer.engine.decide as decide_mod
from designer.emit import design_md


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _catalog():
    return load_catalog(strict=False)


def _state():
    return TasteState(context={"description": "test app"})


def _cli(args, state=None):
    """Subprocess helper matching test_chunk6_integration pattern."""
    full = [sys.executable, "-m", "designer.engine.cli", *args]
    if state is not None:
        sf = os.path.join(tempfile.gettempdir(), "ci_gen_state.json")
        with open(sf, "w") as fh:
            json.dump(state, fh)
        full += ["--state", sf]
    p = subprocess.run(full, cwd=_ROOT, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


# ---------------------------------------------------------------------------
# validate_mockup — accepts/rejects correctly
# ---------------------------------------------------------------------------

def test_validate_mockup_accepts_simple_html():
    """A minimal valid mockup passes with no errors."""
    errors = validate_mockup({"html": "<div>ok</div>"})
    assert errors == [], errors


def test_validate_mockup_rejects_script_tag():
    """<script is forbidden (case-insensitive)."""
    errors = validate_mockup({"html": "<div><Script>alert(1)</Script></div>"})
    assert any("<script" in e.lower() for e in errors), errors


def test_validate_mockup_rejects_src_http_double_quote():
    """src=\"http is forbidden."""
    errors = validate_mockup({"html": '<img src="http://evil.com/img.png">'})
    assert any("src=http" in e.lower() or "external" in e.lower() for e in errors), errors


def test_validate_mockup_rejects_src_http_single_quote():
    """src='http is forbidden."""
    errors = validate_mockup({"html": "<img src='http://evil.com/img.png'>"})
    assert any("src=http" in e.lower() or "external" in e.lower() for e in errors), errors


def test_validate_mockup_rejects_src_http_bare():
    """src=http (no quotes) is forbidden."""
    errors = validate_mockup({"html": "<img src=http://evil.com/img.png>"})
    assert any("src=http" in e.lower() or "external" in e.lower() for e in errors), errors


def test_validate_mockup_rejects_at_import():
    """@import is forbidden."""
    errors = validate_mockup({"html": "<style>@import url('https://fonts.googleapis.com/css');</style>"})
    assert any("@import" in e for e in errors), errors


def test_validate_mockup_rejects_link_tag():
    """<link is forbidden (case-insensitive)."""
    errors = validate_mockup({"html": "<LINK rel='stylesheet' href='style.css'>"})
    assert any("<link" in e.lower() for e in errors), errors


def test_validate_mockup_rejects_inline_event_handler():
    """Inline event handlers (onerror=, onclick=, …) are a JS-exec vector even
    without <script> — they must be rejected (hardening per auditor MEDIUM)."""
    for html in (
        '<img src="x" onerror="alert(1)">',
        "<div onclick=\"steal()\">y</div>",
        "<body onload = 'x()'>z</body>",
    ):
        errors = validate_mockup({"html": html})
        assert any("event handler" in e.lower() or "on…" in e.lower() for e in errors), (html, errors)


def test_validate_mockup_rejects_javascript_uri():
    """javascript: scheme URIs are forbidden."""
    errors = validate_mockup({"html": "<a href=\"javascript:alert(1)\">x</a>"})
    assert any("javascript:" in e.lower() for e in errors), errors


def test_validate_mockup_inline_handler_no_false_positive():
    """Legitimate inline-style HTML and ordinary words like 'onboarding' must
    NOT trip the event-handler matcher (it requires on<word>= with an '=')."""
    for html in (
        '<div style="position:relative;padding:16px"><button style="color:#fff">Buy</button></div>',
        "<div>onboarding flow · season pass</div>",
    ):
        assert validate_mockup({"html": html}) == [], html


def test_validate_mockup_accepts_valid_token_deltas():
    """token_deltas with a known group/key passes."""
    errors = validate_mockup({
        "html": "<div style='color:#0A6CFF'>ok</div>",
        "token_deltas": {"color": {"accent": "#0A6CFF"}},
    })
    assert errors == [], errors


def test_validate_mockup_rejects_unknown_token_group():
    """token_deltas with an unknown group is an error."""
    errors = validate_mockup({
        "html": "<div>ok</div>",
        "token_deltas": {"bogus": {"x": "y"}},
    })
    assert len(errors) > 0
    assert any("bogus" in e for e in errors), errors


def test_validate_mockup_rejects_unknown_token_key():
    """token_deltas with a known group but unknown key is an error."""
    errors = validate_mockup({
        "html": "<div>ok</div>",
        "token_deltas": {"color": {"notakey": "#FF0000"}},
    })
    assert len(errors) > 0
    assert any("notakey" in e for e in errors), errors


# ---------------------------------------------------------------------------
# validate_contract_answer
# ---------------------------------------------------------------------------

def test_validate_answer_generate_without_mockup_is_error():
    """action='generate' without answer.mockup produces an error."""
    contract = {
        "candidates": [],
        "answer": {"action": "generate", "chosen_category_id": None, "mockup": None},
    }
    errors = validate_contract_answer(contract)
    assert any("mockup" in e for e in errors), errors


def test_validate_answer_generate_bad_mockup_prefixed():
    """action='generate' with a bad mockup (script) yields errors prefixed 'answer.mockup:'."""
    contract = {
        "candidates": [],
        "answer": {
            "action": "generate",
            "chosen_category_id": None,
            "mockup": {"html": "<script>bad()</script>"},
        },
    }
    errors = validate_contract_answer(contract)
    assert len(errors) > 0
    assert all(e.startswith("answer.mockup:") for e in errors if "script" in e.lower() or "mockup" in e.lower()), errors


def test_validate_answer_generate_valid_no_errors():
    """action='generate' with a valid inline mockup yields no errors."""
    contract = {
        "candidates": [],
        "answer": {
            "action": "generate",
            "chosen_category_id": None,
            "mockup": {"html": "<div style='color:#fff'>preview</div>"},
        },
    }
    errors = validate_contract_answer(contract)
    assert errors == [], errors


def test_validate_answer_rehighlight_no_cid_is_ok():
    """action='rehighlight' without chosen_category_id is valid (cid is optional)."""
    contract = {
        "candidates": [],
        "answer": {"action": "rehighlight", "chosen_category_id": None},
    }
    errors = validate_contract_answer(contract)
    assert errors == [], errors


def test_validate_answer_rehighlight_with_valid_option_hints():
    """action='rehighlight' with well-formed option_hints passes."""
    contract = {
        "candidates": [],
        "answer": {
            "action": "rehighlight",
            "chosen_category_id": None,
            "option_hints": [
                {"option_id": "some-option", "highlight": True, "annotate": "Try this"},
            ],
        },
    }
    errors = validate_contract_answer(contract)
    assert errors == [], errors


def test_validate_answer_rehighlight_bad_option_hints_fail():
    """option_hints with a missing option_id is an error."""
    contract = {
        "candidates": [],
        "answer": {
            "action": "rehighlight",
            "chosen_category_id": None,
            "option_hints": [{"option_id": ""}],
        },
    }
    errors = validate_contract_answer(contract)
    assert len(errors) > 0


# ---------------------------------------------------------------------------
# build_decision_contract — pending_chat
# ---------------------------------------------------------------------------

def test_build_contract_with_pending_chat():
    """pending_chat dict is included in the contract with text field."""
    cat = _catalog()
    st = _state()
    contract = build_decision_contract(st, cat, pending_chat={"text": "calmer"})
    assert "pending_chat" in contract
    assert contract["pending_chat"]["text"] == "calmer"


def test_build_contract_without_pending_chat():
    """When no pending_chat is provided, the key is absent (or None)."""
    cat = _catalog()
    st = _state()
    contract = build_decision_contract(st, cat)
    # Either absent or None — should not be present with a text value
    assert contract.get("pending_chat") is None or "pending_chat" not in contract


# ---------------------------------------------------------------------------
# decide.next_step — generate and rehighlight do NOT mutate state
# ---------------------------------------------------------------------------

def _build_filled_contract(cat, st, action, *, mockup=None, chosen_cid=None):
    """Build a filled contract dict for next_step."""
    contract = build_decision_contract(st, cat)
    contract["answer"]["action"] = action
    if chosen_cid is not None:
        contract["answer"]["chosen_category_id"] = chosen_cid
    if mockup is not None:
        contract["answer"]["mockup"] = mockup
    return contract


def test_next_step_generate_action_no_state_mutation():
    """decide.next_step with action='generate' returns generate StepResult,
    carries the mockup envelope, and does NOT mutate state."""
    cat = _catalog()
    st = _state()
    # Record initial state
    before_overrides = copy.deepcopy(st.overrides)
    before_history = copy.deepcopy(st.history)

    mockup_envelope = {"html": "<div style='color:#fff'>preview</div>"}
    filled = _build_filled_contract(cat, st, "generate", mockup=mockup_envelope)
    result = decide_mod.next_step(st, cat, filled)

    assert result.action == "generate"
    assert result.mockup is not None
    assert result.mockup.get("html") == mockup_envelope["html"]
    # State unchanged
    assert st.overrides == before_overrides
    assert st.history == before_history


def test_next_step_rehighlight_resolves_category():
    """decide.next_step with action='rehighlight' + a known chosen_category_id
    returns rehighlight with a resolved category, and does NOT mutate state."""
    cat = _catalog()
    st = _state()
    # Find a valid candidate
    candidates = build_decision_contract(st, cat)["candidates"]
    first_cid = candidates[0]["id"]

    before_overrides = copy.deepcopy(st.overrides)
    before_history = copy.deepcopy(st.history)

    filled = _build_filled_contract(cat, st, "rehighlight", chosen_cid=first_cid)
    result = decide_mod.next_step(st, cat, filled)

    assert result.action == "rehighlight"
    assert result.category is not None
    assert result.category.id == first_cid
    # State unchanged
    assert st.overrides == before_overrides
    assert st.history == before_history


def test_next_step_rehighlight_no_cid_category_is_none():
    """rehighlight without chosen_category_id returns category=None (CLI reuses current)."""
    cat = _catalog()
    st = _state()
    filled = _build_filled_contract(cat, st, "rehighlight")
    result = decide_mod.next_step(st, cat, filled)
    assert result.action == "rehighlight"
    assert result.category is None


# ---------------------------------------------------------------------------
# accept-deltas CLI
# ---------------------------------------------------------------------------

def test_accept_deltas_valid_records_generate_source():
    """accept-deltas with valid delta sets overrides and records history source='generate'."""
    init_res = _cli(["init", "--context", "test"])
    state = init_res["state"]

    deltas_file = os.path.join(tempfile.gettempdir(), "test_gen_deltas.json")
    with open(deltas_file, "w") as fh:
        json.dump({"color": {"accent": "#0A6CFF"}}, fh)

    res = _cli(["accept-deltas", "--deltas", deltas_file], state)
    st = res["state"]

    assert st["overrides"].get("color", {}).get("accent") == "#0A6CFF", st["overrides"]
    assert len(st["history"]) == 1
    assert st["history"][0]["source"] == "generate"
    assert res["dropped"] == []


def test_accept_deltas_invalid_drops_unknown_paths():
    """accept-deltas with unknown token group drops it and does NOT pollute overrides."""
    init_res = _cli(["init", "--context", "test"])
    state = init_res["state"]

    deltas_file = os.path.join(tempfile.gettempdir(), "test_gen_bad_deltas.json")
    with open(deltas_file, "w") as fh:
        json.dump({"bogus": {"x": "y"}}, fh)

    res = _cli(["accept-deltas", "--deltas", deltas_file], state)

    assert "bogus.x" in res["dropped"], res["dropped"]
    assert "bogus" not in res["state"]["overrides"], res["state"]["overrides"]


def test_accept_deltas_mixed_valid_and_invalid():
    """Mixed delta: valid paths applied, invalid paths dropped, no cross-contamination."""
    init_res = _cli(["init", "--context", "test"])
    state = init_res["state"]

    deltas_file = os.path.join(tempfile.gettempdir(), "test_gen_mixed_deltas.json")
    with open(deltas_file, "w") as fh:
        json.dump({"color": {"accent": "#0A6CFF"}, "bogus": {"x": "y"}}, fh)

    res = _cli(["accept-deltas", "--deltas", deltas_file], state)

    assert res["state"]["overrides"].get("color", {}).get("accent") == "#0A6CFF"
    assert "bogus.x" in res["dropped"]
    assert "bogus" not in res["state"]["overrides"]


# ---------------------------------------------------------------------------
# F2: emit after accept carries the accepted accent into DESIGN.md
# ---------------------------------------------------------------------------

def test_emit_after_accept_includes_accent_in_design_md():
    """State with an accepted delta produces a DESIGN.md whose base includes the accent.

    Proves the generated direction (via accept) reaches the emitted artifact (F2).
    """
    from designer.engine.state import TasteState
    from designer.emit import design_md

    st = TasteState()
    st.apply_pick(
        category_id="generated:mockup",
        option_id="mockup",
        token_delta={"color": {"accent": "#0A6CFF"}},
        source="generate",
    )

    doc = design_md.build_design_doc("TestProd", st, flatten=True, version="1")
    text = design_md.render_design_md(doc)

    assert "#0A6CFF" in text, "accepted accent not found in DESIGN.md output"
