"""Acceptance tests for the Current-vs-Alternate (CVA) requirement.

Verifies that after import:
  - Every seeded decision has EXACTLY ONE option with is_current=True and the
    rest with is_alternate=True.
  - current_option_id is set and matches the seeded option.
  - For the accent dimension, the imported option is flagged current even when
    the value is a measured literal that no catalog preset equals exactly.
  - Switching to an alternate records a delta vs the imported baseline.
  - decision-cva CLI flags the seeded option as current.

Run: python -m pytest designer/tests/test_current_vs_alternate.py -q
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))
sys.path.insert(0, _ROOT)

from designer.engine.catalog_loader import load_catalog
from designer.engine.state import TasteState
from designer.extract.import_design import import_design
from designer.emit import design_md


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _catalog():
    return load_catalog(strict=False)


def _cli(args, state=None):
    """Subprocess helper matching test_chunk6 pattern."""
    full = [sys.executable, "-m", "designer.engine.cli", *args]
    if state is not None:
        sf = os.path.join(tempfile.gettempdir(), "ci_cva_state.json")
        with open(sf, "w") as fh:
            json.dump(state, fh)
        full += ["--state", sf]
    p = subprocess.run(full, cwd=_ROOT, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def _build_post_import_state(accent: str = "#0A84FF") -> tuple[TasteState, list[dict]]:
    """Build and import a DESIGN.md; return (post-import state, seeded list)."""
    cat = _catalog()
    by_id = cat.by_id()

    # Build DESIGN.md with a known accent
    src_st = TasteState(context={"description": "cva test"})
    c = by_id["color-accent-system"]
    opt = c.options[0]
    src_st.apply_pick(c.id, opt.id, {"color": {"accent": accent}}, source="pick")
    doc = design_md.build_design_doc("CVATest", src_st, flatten=True, version="1")
    text = design_md.render_design_md(doc)

    # Import into fresh state
    st = TasteState()
    result = import_design(st, text, cat)
    st.baseline = result["baseline_overrides"]

    return st, result["seeded"]


# ---------------------------------------------------------------------------
# Core CVA invariant: exactly one is_current per decision in extracted
# ---------------------------------------------------------------------------

def test_extracted_each_decision_has_exactly_one_current():
    """After import, every decision returned by `extracted` CLI has exactly one
    option with is_current=True and all others is_alternate=True."""
    st, seeded = _build_post_import_state()

    res = _cli(["extracted"], st.to_dict())
    extracted = res["extracted"]
    assert len(extracted) > 0, "No extracted decisions returned"

    for decision in extracted:
        opts = decision["options"]
        current_opts = [o for o in opts if o.get("is_current") is True]
        alternate_opts = [o for o in opts if o.get("is_alternate") is True]
        non_current_not_alt = [
            o for o in opts
            if not o.get("is_current") and not o.get("is_alternate")
        ]
        cid = decision["category_id"]

        assert len(current_opts) == 1, (
            f"{cid}: expected exactly 1 is_current option, got {len(current_opts)}: "
            f"{[o['id'] for o in current_opts]}"
        )
        assert "current_option_id" in decision, (
            f"{cid}: missing current_option_id in decision"
        )
        # The is_current option's id must match current_option_id
        assert current_opts[0]["id"] == decision["current_option_id"], (
            f"{cid}: is_current option id {current_opts[0]['id']!r} != "
            f"current_option_id {decision['current_option_id']!r}"
        )
        # All non-current options must be is_alternate
        assert not non_current_not_alt, (
            f"{cid}: options that are neither current nor alternate: "
            f"{[o['id'] for o in non_current_not_alt]}"
        )
        # Expect at least one alternate (at least 2 options per category)
        assert len(alternate_opts) >= 1, (
            f"{cid}: expected >=1 alternate options, got {len(alternate_opts)}"
        )


def test_current_option_id_matches_seeded_history():
    """For each extracted decision, current_option_id equals the option_id
    recorded in history for that category."""
    st, seeded = _build_post_import_state()

    # Build history lookup: category -> last recorded option_id
    history_by_cid: dict[str, str] = {}
    for entry in st.history:
        history_by_cid[entry["category_id"]] = entry["option_id"]

    res = _cli(["extracted"], st.to_dict())
    extracted = res["extracted"]

    for decision in extracted:
        cid = decision["category_id"]
        if cid not in history_by_cid:
            continue  # non-seeded, skip
        expected_oid = history_by_cid[cid]
        actual_coid = decision.get("current_option_id")
        assert actual_coid == expected_oid, (
            f"{cid}: current_option_id {actual_coid!r} != history option {expected_oid!r}"
        )


# ---------------------------------------------------------------------------
# Accent dimension: is_current flagged even for measured values
# ---------------------------------------------------------------------------

def test_accent_dimension_has_exactly_one_current():
    """The color.accent dimension (color-accent-system) has exactly one current
    in the extracted list, matching the seeded option."""
    st, seeded = _build_post_import_state(accent="#0A84FF")

    res = _cli(["extracted"], st.to_dict())
    extracted = res["extracted"]

    accent_decision = next(
        (d for d in extracted if d["category_id"] == "color-accent-system"), None
    )
    assert accent_decision is not None, (
        "color-accent-system not found in extracted decisions"
    )

    opts = accent_decision["options"]
    current_opts = [o for o in opts if o.get("is_current")]
    assert len(current_opts) == 1, (
        f"accent: expected exactly 1 is_current, got {len(current_opts)}: "
        f"{[o['id'] for o in current_opts]}"
    )
    assert "current_option_id" in accent_decision
    assert current_opts[0]["id"] == accent_decision["current_option_id"]


def test_accent_dimension_current_is_seeded_option():
    """The current option for the accent dimension is the option recorded in
    history — even when the value is a measured literal."""
    st, seeded = _build_post_import_state(accent="#0A84FF")

    # Find the seeded option for color-accent-system
    seeded_accent = next(
        (s for s in seeded if s["category_id"] == "color-accent-system"), None
    )
    assert seeded_accent is not None, "color-accent-system not in seeded"
    expected_oid = seeded_accent["option_id"]

    res = _cli(["extracted"], st.to_dict())
    extracted = res["extracted"]
    accent_decision = next(
        (d for d in extracted if d["category_id"] == "color-accent-system"), None
    )
    assert accent_decision is not None

    assert accent_decision.get("current_option_id") == expected_oid, (
        f"current_option_id {accent_decision.get('current_option_id')!r} != "
        f"seeded option {expected_oid!r}"
    )


# ---------------------------------------------------------------------------
# Switching to an alternate records a delta vs the imported baseline
# ---------------------------------------------------------------------------

def test_switch_to_alternate_records_delta():
    """After import (baseline set), switching one imported decision to an option
    with a genuinely different token makes delta_since(baseline) non-empty."""
    cat = _catalog()
    st, seeded = _build_post_import_state()
    # Confirm no delta before switching (import == baseline)
    assert not st.has_delta(), "Expected no delta immediately after import"

    by_id = cat.by_id()
    # Use color-accent-system: pick the option with a different accent (#5E5CE6)
    # accent-expressive has accent: '#5E5CE6' which differs from baseline '#0A84FF'
    c = by_id["color-accent-system"]
    baseline_accent = st.baseline.get("color", {}).get("accent")
    # Find an option whose color.accent differs from the baseline accent
    alt_opt = next(
        (o for o in c.options
         if o.token_delta.get("color", {}).get("accent") != baseline_accent
         and o.token_delta.get("color", {}).get("accent") is not None),
        None,
    )
    assert alt_opt is not None, (
        f"No option with a different accent from baseline {baseline_accent!r} found on {c.id}"
    )

    st.apply_pick(c.id, alt_opt.id, alt_opt.token_delta, source="pick")

    assert st.has_delta(), "has_delta() should be True after switching to a different accent"
    delta = st.delta_since()
    assert delta, "delta_since() should return non-empty dict after switch"


def test_no_delta_before_switch():
    """Before any switch, has_delta() is False (import == baseline)."""
    st, _ = _build_post_import_state()
    # Set baseline from import result
    assert not st.has_delta(), (
        "Expected has_delta() False immediately after import (baseline == overrides)"
    )


def test_switch_delta_reflects_switched_token():
    """After switching an imported category to a truly different accent, delta_since()
    reflects the new token in the color group."""
    cat = _catalog()
    st, seeded = _build_post_import_state()
    by_id = cat.by_id()

    c = by_id["color-accent-system"]
    baseline_accent = st.baseline.get("color", {}).get("accent")
    # Pick an option with a genuinely different accent value
    alt_opt = next(
        (o for o in c.options
         if o.token_delta.get("color", {}).get("accent") != baseline_accent
         and o.token_delta.get("color", {}).get("accent") is not None),
        c.options[-1],
    )
    st.apply_pick(c.id, alt_opt.id, alt_opt.token_delta, source="pick")

    delta = st.delta_since()
    # The color group should be in the delta
    assert "color" in delta, f"Expected 'color' in delta after accent switch; got: {delta}"


# ---------------------------------------------------------------------------
# decision-cva CLI flags the seeded option as current
# ---------------------------------------------------------------------------

def test_decision_cva_cli_flags_seeded_option_current():
    """decision-cva CLI for a seeded category returns is_current=True on the
    seeded option and current_option_id matches."""
    st, seeded = _build_post_import_state()

    # Use color-accent-system as a seeded category
    seeded_accent = next(
        (s for s in seeded if s["category_id"] == "color-accent-system"), None
    )
    assert seeded_accent is not None

    res = _cli(
        ["decision-cva", "--category", "color-accent-system"],
        st.to_dict(),
    )
    decision = res["decision"]
    opts = decision["options"]

    current_opts = [o for o in opts if o.get("is_current") is True]
    assert len(current_opts) == 1, (
        f"Expected exactly 1 is_current option in decision-cva, got {len(current_opts)}: "
        f"{[o['id'] for o in current_opts]}"
    )
    assert decision.get("current_option_id") == seeded_accent["option_id"], (
        f"current_option_id {decision.get('current_option_id')!r} != "
        f"seeded {seeded_accent['option_id']!r}"
    )
    # The current option's id matches
    assert current_opts[0]["id"] == seeded_accent["option_id"]


def test_decision_cva_cli_all_non_current_are_alternate():
    """decision-cva CLI: all options that are not current have is_alternate=True."""
    st, _ = _build_post_import_state()

    res = _cli(
        ["decision-cva", "--category", "color-accent-system"],
        st.to_dict(),
    )
    decision = res["decision"]
    opts = decision["options"]

    for opt in opts:
        if not opt.get("is_current"):
            assert opt.get("is_alternate") is True, (
                f"Option {opt['id']!r} is not current but also not is_alternate"
            )


# ---------------------------------------------------------------------------
# Iterate all extracted dimensions: invariant holds universally
# ---------------------------------------------------------------------------

def test_exactly_one_current_invariant_all_dimensions():
    """For EVERY dimension returned by `extracted`, exactly one option is
    is_current and the rest are is_alternate. The invariant is universal."""
    st, _ = _build_post_import_state()
    res = _cli(["extracted"], st.to_dict())
    extracted = res["extracted"]
    assert extracted, "No extracted decisions — cannot assert invariant"

    failures = []
    for decision in extracted:
        cid = decision["category_id"]
        opts = decision["options"]
        current_opts = [o for o in opts if o.get("is_current")]
        alternate_opts = [o for o in opts if o.get("is_alternate")]
        total = len(opts)

        if len(current_opts) != 1:
            failures.append(
                f"{cid}: {len(current_opts)} current (expected 1)"
            )
        if len(alternate_opts) != total - 1:
            failures.append(
                f"{cid}: {len(alternate_opts)} alternate (expected {total - 1})"
            )

    assert not failures, "CVA invariant failures:\n" + "\n".join(failures)
