"""Chunk 7 tests — IBR extraction adapter + taste-state seed.

Covers:
  1. adapter.extract(scan_json=fixture) → available:True, key signals present.
  2. run_scan with ibr absent (monkeypatched shutil.which=None) → available:False, no raise.
  3. distill_signals({}) → returns graceful degraded result, no raise.
  4. auto_seed(fresh_state, signals_from_fixture, catalog) → state seeded with
     color.accent OR color.surface OR typography token; history has source="extract".
  5. build_extraction_contract + validate_extraction_answer:
       - valid hand-built mapping passes;
       - fake category_id fails;
       - empty mappings list is valid.
  6. No vendor import in designer/extract/*.py.

Run: uv run --with pytest pytest designer/tests/test_chunk7_extract.py -q
"""

from __future__ import annotations

import json
import os
import sys
import unittest.mock as mock

# Ensure project root is on path.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))
sys.path.insert(0, _ROOT)

from designer.engine.catalog_loader import load_catalog
from designer.engine.state import TasteState
from designer.extract import ibr_adapter, contract as extract_contract_mod, seed as seed_mod


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

_FIXTURE_PATH = os.path.join(_HERE, "fixtures", "ibr_scan_synthetic.json")


def _load_fixture() -> dict:
    with open(_FIXTURE_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _catalog():
    return load_catalog(strict=False)


# ---------------------------------------------------------------------------
# Test 1: adapter.extract with fixture scan_json
# ---------------------------------------------------------------------------

def test_extract_from_fixture_available():
    """extract(scan_json=fixture) returns available:True with expected signals."""
    fixture = _load_fixture()
    result = ibr_adapter.extract(url=None, scan_json=fixture)

    assert result["available"] is True, f"Expected available=True, got: {result}"
    signals = result["signals"]
    assert signals is not None

    # color.tone must be present (fixture has byTone data)
    assert signals["color"]["tone"] in ("dark", "light", None)
    # At least one key is resolved (fixture has contrast data)
    assert signals["color"]["tone"] is not None, (
        "Expected tone to be set from fixture's byTone data"
    )

    # typography.dominant_family should be present (fixture has typography rows)
    assert signals["typography"]["dominant_family"] is not None, (
        "Expected dominant_family from fixture typography rows"
    )

    # components.button must be a dict (even if all None)
    assert isinstance(signals["components"]["button"], dict)
    assert "backgroundColor" in signals["components"]["button"]


def test_extract_color_tone_from_fixture():
    """Tone derivation: fixture has lightOnDark=1, darkOnLight=0 → tone='dark'."""
    fixture = _load_fixture()
    result = ibr_adapter.extract(url=None, scan_json=fixture)
    assert result["available"] is True
    assert result["signals"]["color"]["tone"] == "dark"


def test_extract_typography_dominant_family():
    """Dominant family picked from highest-count row with a real family name."""
    fixture = _load_fixture()
    result = ibr_adapter.extract(url=None, scan_json=fixture)
    fam = result["signals"]["typography"]["dominant_family"]
    assert fam is not None
    # Should be the ui-sans-serif system stack (highest count non-unspecified rows)
    assert "sans-serif" in fam.lower() or "monospace" in fam.lower()


# ---------------------------------------------------------------------------
# Test 2: run_scan with ibr absent
# ---------------------------------------------------------------------------

def test_run_scan_ibr_absent_no_raise():
    """When shutil.which('ibr') returns None, run_scan returns available:False without raising."""
    with mock.patch("shutil.which", return_value=None):
        result = ibr_adapter.run_scan("https://example.com")
    assert result.get("available") is False
    assert "reason" in result
    assert "ibr" in result["reason"].lower()


def test_run_scan_with_scan_json_bypasses_subprocess():
    """Passing scan_json= skips subprocess entirely and returns the dict unchanged."""
    dummy = {"sensors": {}, "url": "x"}
    result = ibr_adapter.run_scan("https://example.com", scan_json=dummy)
    assert result is dummy


# ---------------------------------------------------------------------------
# Test 3: distill_signals on empty/missing scan
# ---------------------------------------------------------------------------

def test_distill_signals_empty_dict_no_raise():
    """distill_signals({}) must not raise and must return the expected shape."""
    result = ibr_adapter.distill_signals({})
    assert isinstance(result, dict)
    assert "typography" in result
    assert "color" in result
    assert "components" in result
    assert "motion" in result
    assert "structure" in result
    # All sub-values should be None / empty / False — not exceptions
    assert result["color"]["tone"] is None
    assert result["color"]["accent_candidates"] == []
    assert result["typography"]["dominant_family"] is None
    assert result["motion"]["has_transitions"] is False


def test_distill_signals_none_sensors_no_raise():
    """Scan dict with sensors=None must not raise."""
    result = ibr_adapter.distill_signals({"sensors": None})
    assert isinstance(result, dict)
    assert result["color"]["tone"] is None


def test_extract_empty_scan_json_graceful():
    """extract(scan_json={}) is available=False (no 'sensors' key is ok, no raise)."""
    result = ibr_adapter.extract(url=None, scan_json={})
    # An empty dict has no "available":False marker, so it goes through distill_signals
    # and returns available:True with all-None signals (partial extraction with warnings).
    assert isinstance(result, dict)
    # Should not raise; either available path is acceptable for completely empty scan
    assert "available" in result


# ---------------------------------------------------------------------------
# Test 4: auto_seed produces non-empty seed from fixture signals
# ---------------------------------------------------------------------------

def test_auto_seed_from_fixture_nonempty():
    """auto_seed on fixture signals must produce at least one seeded entry."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    state = TasteState()

    summary = seed_mod.auto_seed(state, signals, cat)

    assert isinstance(summary, dict)
    assert "seeded" in summary
    assert len(summary["seeded"]) > 0, (
        f"Expected at least one seeded entry from fixture; got summary={summary}"
    )


def test_auto_seed_state_overrides_populated():
    """auto_seed from fixture must set at least one of color.accent, color.surface,
    or typography tokens in state.overrides."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    state = TasteState()

    seed_mod.auto_seed(state, signals, cat)

    overrides = state.overrides
    has_color_accent = bool((overrides.get("color") or {}).get("accent"))
    has_color_surface = bool((overrides.get("color") or {}).get("surface"))
    has_typography = bool(overrides.get("typography"))
    assert has_color_accent or has_color_surface or has_typography, (
        f"Expected color.accent, color.surface, or typography in overrides; "
        f"got overrides={overrides}"
    )


def test_auto_seed_history_source_is_extract():
    """All picks recorded by auto_seed must have source='extract'."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    state = TasteState()

    seed_mod.auto_seed(state, signals, cat)

    assert len(state.history) > 0
    for entry in state.history:
        assert entry["source"] == "extract", (
            f"Expected source='extract', got {entry['source']!r} in {entry}"
        )


# ---------------------------------------------------------------------------
# Test 5: build_extraction_contract + validate_extraction_answer
# ---------------------------------------------------------------------------

def test_build_extraction_contract_shape():
    """build_extraction_contract returns the expected top-level keys."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()

    ctr = extract_contract_mod.build_extraction_contract(signals, cat)

    assert "signals" in ctr
    assert "candidates" in ctr
    assert "instructions" in ctr
    assert "answer" in ctr
    assert isinstance(ctr["candidates"], list)
    assert len(ctr["candidates"]) > 0
    # Each candidate has required keys
    for cand in ctr["candidates"]:
        assert "category_id" in cand
        assert "options" in cand


def test_validate_extraction_answer_valid_mapping():
    """A hand-built valid mapping passes validation."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    ctr = extract_contract_mod.build_extraction_contract(signals, cat)

    # Use the first candidate's first option as a known-valid mapping
    first_cand = ctr["candidates"][0]
    cid = first_cand["category_id"]
    oid = first_cand["options"][0]["id"]

    ctr["answer"]["mappings"] = [
        {
            "category_id": cid,
            "option_id": oid,
            "token_delta": None,
            "confidence": 0.9,
            "evidence": "test evidence",
        }
    ]

    errors = extract_contract_mod.validate_extraction_answer(ctr)
    assert errors == [], f"Expected no errors, got: {errors}"


def test_validate_extraction_answer_fake_category_id():
    """A mapping with a fake category_id fails validation."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    ctr = extract_contract_mod.build_extraction_contract(signals, cat)

    ctr["answer"]["mappings"] = [
        {
            "category_id": "definitely-not-a-real-category-id",
            "option_id": None,
            "token_delta": {"color": {"accent": "#FF0000"}},
            "confidence": 0.8,
            "evidence": "fake",
        }
    ]

    errors = extract_contract_mod.validate_extraction_answer(ctr)
    assert len(errors) > 0
    assert any("definitely-not-a-real-category-id" in e for e in errors)


def test_validate_extraction_answer_empty_mappings_is_valid():
    """Empty mappings list is valid (degraded but not an error)."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    ctr = extract_contract_mod.build_extraction_contract(signals, cat)

    # Default answer has empty mappings
    assert ctr["answer"]["mappings"] == []
    errors = extract_contract_mod.validate_extraction_answer(ctr)
    assert errors == [], f"Empty mappings should be valid; got: {errors}"


def test_validate_extraction_answer_raw_token_delta():
    """A mapping with no option_id but a raw token_delta is valid."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    ctr = extract_contract_mod.build_extraction_contract(signals, cat)

    first_cid = ctr["candidates"][0]["category_id"]
    ctr["answer"]["mappings"] = [
        {
            "category_id": first_cid,
            "option_id": None,
            "token_delta": {"color": {"accent": "#0A84FF"}},
            "confidence": 0.7,
            "evidence": "raw delta from scan",
        }
    ]

    errors = extract_contract_mod.validate_extraction_answer(ctr)
    assert errors == [], f"Raw token_delta should be valid; got: {errors}"


def test_validate_extraction_answer_no_delta_or_option():
    """A mapping with both option_id=None and token_delta=None fails."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    ctr = extract_contract_mod.build_extraction_contract(signals, cat)

    first_cid = ctr["candidates"][0]["category_id"]
    ctr["answer"]["mappings"] = [
        {
            "category_id": first_cid,
            "option_id": None,
            "token_delta": None,
            "confidence": 0.5,
            "evidence": "nothing",
        }
    ]

    errors = extract_contract_mod.validate_extraction_answer(ctr)
    assert len(errors) > 0


# ---------------------------------------------------------------------------
# Test 6: No vendor import in designer/extract/*.py
# ---------------------------------------------------------------------------

_BANNED_TOKENS = [
    "anthropic", "openai", "requests", "httpx", "urllib.request",
]

_EXTRACT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "extract",
)
_EXTRACT_FILES = ["ibr_adapter.py", "contract.py", "seed.py"]


def test_no_vendor_imports_in_extract():
    """Assert no vendor/network import in the extract module files."""
    for fname in _EXTRACT_FILES:
        path = os.path.join(_EXTRACT_DIR, fname)
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        for token in _BANNED_TOKENS:
            assert token not in src, (
                f"F4 VIOLATION: extract/{fname} contains banned token {token!r}. "
                "Extract modules must never call vendor APIs directly."
            )


# ---------------------------------------------------------------------------
# Bonus: apply_extraction with a hand-built valid contract answer
# ---------------------------------------------------------------------------

def test_apply_extraction_from_valid_contract():
    """apply_extraction seeds the state correctly from a valid contract."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    ctr = extract_contract_mod.build_extraction_contract(signals, cat)

    # Build a minimal valid contract answer
    first_cand = ctr["candidates"][0]
    cid = first_cand["category_id"]
    oid = first_cand["options"][0]["id"]
    ctr["answer"]["mappings"] = [
        {
            "category_id": cid,
            "option_id": oid,
            "token_delta": None,
            "confidence": 0.9,
            "evidence": "test",
        }
    ]

    state = TasteState()
    summary = seed_mod.apply_extraction(state, ctr, cat)

    assert "errors" not in summary
    assert len(summary["seeded"]) == 1
    assert summary["seeded"][0]["category_id"] == cid
    assert summary["seeded"][0]["source"] == "extract"
    assert cid in state.asked


def test_apply_extraction_invalid_contract_no_state_mutation():
    """apply_extraction with a validation error returns errors and does NOT mutate state."""
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    ctr = extract_contract_mod.build_extraction_contract(signals, cat)

    # Inject a bad mapping
    ctr["answer"]["mappings"] = [
        {
            "category_id": "FAKE-CATEGORY",
            "option_id": None,
            "token_delta": None,
            "confidence": 0.5,
            "evidence": "bad",
        }
    ]

    state = TasteState()
    result = seed_mod.apply_extraction(state, ctr, cat)

    assert "errors" in result
    assert result["seeded"] == []
    assert state.asked == []  # state unchanged
    assert state.overrides == {}


# ---------------------------------------------------------------------------
# Regression tests — live-path bugs found in Phase 3 Chunk 4 E2E
# ---------------------------------------------------------------------------

def test_run_scan_nonzero_exit_with_json_is_success():
    """IBR exits NON-ZERO when findings/warnings are present even on a good
    scan. run_scan must parse the JSON on stdout regardless of returncode and
    only fail when stdout carries no JSON object.
    Regression: the adapter previously gated on returncode and treated a
    perfectly good scan (exit 1 + valid JSON) as a failure.
    """
    fake_stdout = 'Scanning http://x/...\n{"url":"http://x/","sensors":{"contrast":{"byTone":{"lightOnDark":1,"darkOnLight":0}}}}'
    fake_proc = mock.Mock(returncode=1, stdout=fake_stdout, stderr="")
    with mock.patch("designer.extract.ibr_adapter.shutil.which", return_value="/usr/bin/ibr"), \
         mock.patch("designer.extract.ibr_adapter.subprocess.run", return_value=fake_proc):
        scan = ibr_adapter.run_scan("http://x/")
    assert isinstance(scan, dict)
    assert scan.get("available") is not False  # parsed, not a failure
    assert scan["sensors"]["contrast"]["byTone"]["lightOnDark"] == 1


def test_run_scan_nonzero_exit_no_json_is_failure():
    """Non-zero exit AND no JSON on stdout is a real failure (crash/timeout)."""
    fake_proc = mock.Mock(returncode=1, stdout="some error text, no json\n", stderr="boom")
    with mock.patch("designer.extract.ibr_adapter.shutil.which", return_value="/usr/bin/ibr"), \
         mock.patch("designer.extract.ibr_adapter.subprocess.run", return_value=fake_proc):
        scan = ibr_adapter.run_scan("http://x/")
    assert scan.get("available") is False
    assert "no JSON" in scan.get("reason", "")


def test_empty_scan_degrades_not_available():
    """An all-null distillation (empty/garbage/unreachable scan) must report
    available:False so the UI degrades to description-only rather than seeding
    a phantom system from nothing.
    """
    r = ibr_adapter.extract(None, scan_json={})
    assert r["available"] is False
    assert r["signals"] is None
    assert "no usable design signal" in (r.get("reason") or "")


def test_auto_seed_keeps_measured_accent_not_catalog_preset():
    """Extraction is measurement: a real accent color must survive into the
    seed verbatim, not get snapped to the nearest catalog option preset.
    """
    cat = load_catalog()
    signals = {
        "color": {"tone": "dark", "accent_candidates": ["rgb(124, 58, 237)"], "surface_bg": None},
        "typography": {"dominant_family": "Inter, system-ui, sans-serif", "heading_weight": 800,
                       "body_size_px": 16, "heading_size_px": 32},
        "components": {"button": {"backgroundColor": "rgb(124, 58, 237)", "borderRadius": None,
                                  "padding": None, "fontWeight": None}},
        "motion": {"has_transitions": False, "has_keyframes": False, "reduced_motion_aware": False},
        "structure": {"nav_landmarks": 1, "heading_levels_used": 2},
    }
    state = TasteState()
    summary = seed_mod.auto_seed(state, signals, cat)
    # measured accent preserved verbatim
    assert state.overrides["color"]["accent"] == "rgb(124, 58, 237)"
    # measured weight + family preserved (not the option's preset weight)
    assert state.overrides["typography"]["headingWeight"] == 800
    assert state.overrides["typography"]["fontFamily"] == "Inter, system-ui, sans-serif"
    assert summary["summary"]["accent"] == "rgb(124, 58, 237)"


def test_auto_seed_does_not_fabricate_button_from_absent_evidence():
    """No button background AND no radius → do NOT seed a 'flat' button default.
    Seeding from the absence of evidence fabricates a system.
    """
    cat = load_catalog()
    signals = {
        "color": {"tone": "dark", "accent_candidates": [], "surface_bg": None},
        "typography": {"dominant_family": None, "heading_weight": None, "body_size_px": None, "heading_size_px": None},
        "components": {"button": {"backgroundColor": None, "borderRadius": None, "padding": None, "fontWeight": None}},
        "motion": {"has_transitions": False, "has_keyframes": False, "reduced_motion_aware": False},
        "structure": {"nav_landmarks": 0, "heading_levels_used": 0},
    }
    state = TasteState()
    seed_mod.auto_seed(state, signals, cat)
    seeded_dims = {h["category_id"] for h in state.history}
    assert "button-shadow" not in seeded_dims  # no phantom button seed
    # but the real tone signal still seeds the surface
    assert "color-dark-mode" in seeded_dims


# ---------------------------------------------------------------------------
# New tests — extracted_picks review surface (chunk-extract-review)
# ---------------------------------------------------------------------------

def test_extracted_picks_returns_seeded():
    """extracted_picks() returns the category_ids+option_ids seeded via auto_seed,
    deduped to the last occurrence per category, in first-seen order.
    """
    fixture = _load_fixture()
    signals = ibr_adapter.distill_signals(fixture)
    cat = _catalog()
    state = TasteState()
    seed_mod.auto_seed(state, signals, cat)

    picks = state.extracted_picks()

    # Must return at least one entry (fixture produces seeded entries).
    assert len(picks) > 0, "Expected extracted_picks() to return at least one entry"

    # Every entry must have category_id and option_id.
    for pick in picks:
        assert "category_id" in pick
        assert "option_id" in pick

    # All returned category_ids must appear in state.history with source=="extract".
    extract_cids = {e["category_id"] for e in state.history if e.get("source") == "extract"}
    result_cids = {p["category_id"] for p in picks}
    assert result_cids == extract_cids, (
        f"Mismatch: extracted_picks returned {result_cids}, history has {extract_cids}"
    )

    # No duplicate category_ids in the result.
    cid_list = [p["category_id"] for p in picks]
    assert len(cid_list) == len(set(cid_list)), "Duplicate category_ids in extracted_picks()"


def test_user_pick_overrides_seeded_prior():
    """After auto_seed seeds a category, a subsequent apply_pick with source='pick'
    makes state.overrides reflect the NEW option's token_delta (override wins).
    History contains both entries.
    """
    cat = _catalog()
    by_id = cat.by_id()
    opts_by_id = cat.options_by_id()

    # Find the color-accent-system category and its options.
    accent_cat = by_id.get("color-accent-system")
    assert accent_cat is not None, "color-accent-system not in catalog"
    assert len(accent_cat.options) >= 2, "Need at least 2 options to test override"

    first_opt = accent_cat.options[0]
    second_opt = accent_cat.options[1]

    state = TasteState()

    # Seed the category via extract (as auto_seed would do).
    state.apply_pick(
        "color-accent-system",
        first_opt.id,
        first_opt.token_delta,
        source="extract",
    )

    # History has one extract entry.
    assert len(state.history) == 1
    assert state.history[0]["source"] == "extract"
    assert state.history[0]["option_id"] == first_opt.id

    # User picks a DIFFERENT option (override — source default "pick").
    state.apply_pick(
        "color-accent-system",
        second_opt.id,
        second_opt.token_delta,
    )

    # History has both entries.
    assert len(state.history) == 2
    assert state.history[1]["source"] == "pick"
    assert state.history[1]["option_id"] == second_opt.id

    # state.overrides reflects the SECOND option's delta (override wins).
    # The resolver merges deltas in order; the second pick's token_delta
    # must dominate for any key it sets.
    if second_opt.token_delta:
        for group, kv in second_opt.token_delta.items():
            for key, val in kv.items():
                assert state.overrides.get(group, {}).get(key) == val, (
                    f"Expected overrides[{group!r}][{key!r}] == {val!r} after override pick; "
                    f"got {state.overrides.get(group, {}).get(key)!r}"
                )

    # The confirm/evolve REVIEW surface must reflect the user's override, not
    # the originally-extracted option (the marker follows the latest pick of
    # any source). This is the UX-correctness fix: a changed dimension must not
    # snap back to the extracted value in the review screen.
    review = state.extracted_picks()
    accent_entry = next((e for e in review if e["category_id"] == "color-accent-system"), None)
    assert accent_entry is not None, "extracted category missing from review list"
    assert accent_entry["option_id"] == second_opt.id, (
        f"review surface should show the override {second_opt.id!r}, "
        f"got {accent_entry['option_id']!r}"
    )


def test_error_page_scan_degrades_not_available():
    """IBR reaching an unreachable/error page (semantic error intent +
    hasErrors) must degrade to available:False rather than seeding garbage
    from a browser error page. Known-risk guard.
    """
    error_scan = {
        "url": "http://127.0.0.1:1/x",
        "semantic": {
            "pageIntent": {"intent": "error", "confidence": 0.3},
            "state": {"errors": {"hasErrors": True, "errors": [{"message": "site can't be reached"}]}},
        },
        "sensors": {
            # error pages DO render some typography — guard must catch via semantic, not signal-emptiness
            "typography": {"rows": [{"family": "system-ui", "size_px": 24, "weight": 400, "count": 1}]},
        },
    }
    r = ibr_adapter.extract(None, scan_json=error_scan)
    assert r["available"] is False
    assert "error page" in (r.get("reason") or "") or "unreachable" in (r.get("reason") or "")
