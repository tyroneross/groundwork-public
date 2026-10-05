"""Tests for Layer-1 Scope & Skeleton catalog additions.

Verifies that the two new categories (platform-target, nav-structure) exist
in the catalog with correct dimensions, that all 8 new option deltas validate
against the schema, that schema.is_known_token() recognises the new token paths,
that floor defaults are present, and that TasteState.apply_pick() correctly
merges the platform-ios delta.

Pure stdlib + pytest. No network, no vendor SDK.
"""

from __future__ import annotations

import pytest

from designer.engine.catalog_loader import load_catalog
from designer.engine import schema, floor
from designer.engine.state import TasteState
from designer.engine.catalog._deltas import OPTION_DELTA


# ---------------------------------------------------------------------------
# Catalog load
# ---------------------------------------------------------------------------

def test_catalog_loads_strict_and_has_34_categories():
    """load_catalog() succeeds in strict mode and now contains 34 categories."""
    cat = load_catalog(strict=True)
    assert len(cat.categories) == 34, (
        f"Expected 34 categories (32 original + 2 Layer-1), got {len(cat.categories)}"
    )


def test_platform_target_category_exists_with_correct_dimension():
    cat = load_catalog()
    by_id = cat.by_id()
    assert "platform-target" in by_id, "platform-target category missing from catalog"
    assert by_id["platform-target"].dimension == "platform.target"


def test_nav_structure_category_exists_with_correct_dimension():
    cat = load_catalog()
    by_id = cat.by_id()
    assert "nav-structure" in by_id, "nav-structure category missing from catalog"
    assert by_id["nav-structure"].dimension == "nav.layoutModel"


def test_platform_target_has_four_options():
    cat = load_catalog()
    cat_by_id = cat.by_id()
    opts = [o.id for o in cat_by_id["platform-target"].options]
    assert set(opts) == {"platform-web", "platform-ios", "platform-macos", "platform-multi"}


def test_nav_structure_has_four_options():
    cat = load_catalog()
    cat_by_id = cat.by_id()
    opts = [o.id for o in cat_by_id["nav-structure"].options]
    assert set(opts) == {
        "nav-structure-left", "nav-structure-top",
        "nav-structure-tabbar", "nav-structure-none",
    }


# ---------------------------------------------------------------------------
# Delta validation
# ---------------------------------------------------------------------------

NEW_OPTION_IDS = [
    "platform-web",
    "platform-ios",
    "platform-macos",
    "platform-multi",
    "nav-structure-left",
    "nav-structure-top",
    "nav-structure-tabbar",
    "nav-structure-none",
]


@pytest.mark.parametrize("option_id", NEW_OPTION_IDS)
def test_new_option_delta_validates(option_id: str):
    """Each of the 8 new option deltas must pass schema.validate_token_delta."""
    assert option_id in OPTION_DELTA, f"OPTION_DELTA missing entry for {option_id!r}"
    result = schema.validate_token_delta(OPTION_DELTA[option_id])
    assert result.ok, (
        f"Delta for {option_id!r} failed validation: {result.errors}"
    )


# ---------------------------------------------------------------------------
# Schema token vocabulary
# ---------------------------------------------------------------------------

def test_platform_target_is_known_token():
    assert schema.is_known_token("platform", "target"), (
        "schema.is_known_token('platform', 'target') returned False — "
        "platform group or target key missing from TOKEN_GROUPS"
    )


def test_nav_layout_model_is_known_token():
    assert schema.is_known_token("nav", "layoutModel"), (
        "schema.is_known_token('nav', 'layoutModel') returned False — "
        "layoutModel missing from nav group in TOKEN_GROUPS"
    )


# ---------------------------------------------------------------------------
# Floor defaults
# ---------------------------------------------------------------------------

def test_floor_base_has_platform_target_multi():
    base = floor.floor_base()
    assert "platform" in base, "floor._BASE missing 'platform' group"
    assert base["platform"]["target"] == "multi", (
        f"Expected floor platform.target == 'multi', got {base['platform'].get('target')!r}"
    )


def test_floor_base_has_nav_layout_model_tab_bar():
    base = floor.floor_base()
    assert "nav" in base, "floor._BASE missing 'nav' group"
    assert base["nav"]["layoutModel"] == "tab-bar", (
        f"Expected floor nav.layoutModel == 'tab-bar', got {base['nav'].get('layoutModel')!r}"
    )


# ---------------------------------------------------------------------------
# TasteState integration
# ---------------------------------------------------------------------------

def test_apply_pick_platform_ios_sets_override():
    """Picking platform-ios must write platform.target == 'ios' into overrides."""
    state = TasteState()
    delta = OPTION_DELTA["platform-ios"]
    state.apply_pick("platform-target", "platform-ios", delta)
    assert state.overrides.get("platform", {}).get("target") == "ios", (
        f"Expected overrides['platform']['target'] == 'ios', "
        f"got {state.overrides.get('platform')!r}"
    )


def test_apply_pick_records_in_asked_and_history():
    state = TasteState()
    delta = OPTION_DELTA["nav-structure-left"]
    state.apply_pick("nav-structure", "nav-structure-left", delta)
    assert "nav-structure" in state.asked
    assert state.history[-1]["option_id"] == "nav-structure-left"
