"""Chunk 1 tests — resolver precedence matrix, flatten, schema validation.

Verifies F3: effective tokens resolve deterministically as floor ⊕ overrides ⊕
per-platform; flatten output contains zero `extends:`.

Run: python3 -m pytest designer/tests/test_chunk1_resolver.py
Or:  python3 designer/tests/test_chunk1_resolver.py   (stdlib runner)
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from designer.engine import floor as floor_mod
from designer.engine import resolver
from designer.engine import schema


def test_floor_only_resolution():
    """No overrides -> effective equals floor.base ⊕ floor.platform."""
    eff = resolver.resolve("web")
    assert eff["color"]["accent"] == "#0A84FF"
    assert eff["typography"]["fontFamily"].startswith("'Inter'")  # web platform layer
    assert eff["spacing"]["grid"] == 8


def test_single_override_wins_over_floor():
    overrides = {"color": {"accent": "#FF2D55"}}
    eff = resolver.resolve("web", overrides)
    assert eff["color"]["accent"] == "#FF2D55"
    # untouched tokens still come from floor
    assert eff["color"]["bg"] == "#FFFFFF"


def test_override_beats_floor_platform_default():
    """A shared user override beats the floor's platform default."""
    # floor ios nav.activeStyle == "fill-color"; user override should win everywhere
    overrides = {"nav": {"activeStyle": "text-underline"}}
    eff = resolver.resolve("ios", overrides)
    assert eff["nav"]["activeStyle"] == "text-underline"


def test_per_platform_override_is_most_specific():
    overrides = {"color": {"accent": "#FF2D55"}}
    per_platform = {"macos": {"color": {"accent": "#34C759"}}}
    eff_mac = resolver.resolve("macos", overrides, per_platform["macos"])
    eff_web = resolver.resolve("web", overrides)
    assert eff_mac["color"]["accent"] == "#34C759"   # per-platform wins
    assert eff_web["color"]["accent"] == "#FF2D55"   # shared override elsewhere


def test_resolve_all_covers_three_platforms():
    allp = resolver.resolve_all()
    assert set(allp.keys()) == {"web", "ios", "macos"}
    # platform-specific font differs
    assert allp["ios"]["typography"]["fontFamily"] != allp["web"]["typography"]["fontFamily"]


def test_flatten_has_no_extends():
    overrides = {"color": {"accent": "#FF2D55"}, "motion": {"intensity": "expressive"}}
    doc = resolver.flatten("Test Product", "calm-precision@6.4.2", overrides)
    assert "extends" not in doc
    # base holds shared tokens; platforms hold the diffs
    assert doc["base"]["color"]["accent"] == "#FF2D55"
    assert doc["schema"] == "design.md/v1"


def test_flatten_validates_against_schema():
    overrides = {"color": {"accent": "#FF2D55"}}
    doc = resolver.flatten("Test Product", "calm-precision@6.4.2", overrides)
    # add a prompt_pack so no warning; validity is about errors
    doc["prompt_pack"] = ["Use accent #FF2D55 for the one conversion action."]
    result = schema.validate_design_md(doc)
    assert result.ok, result.errors


def test_unknown_token_override_is_caught():
    bad = {"color": {"notAToken": "#000"}}
    errs = resolver.validate_overrides(bad)
    assert any("notAToken" in e for e in errs)


def test_determinism_same_input_same_output():
    overrides = {"radius": {"button": 12}}
    a = resolver.resolve("web", overrides)
    b = resolver.resolve("web", overrides)
    assert a == b


def test_floor_document_is_valid():
    doc = floor_mod.floor_document()
    doc["prompt_pack"] = ["floor"]
    result = schema.validate_design_md(doc)
    assert result.ok, result.errors


# --- stdlib runner (no pytest needed) --------------------------------------
def _run():
    fns = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if _run() else 0)
