"""Tests for yaml_min round-trip, split_frontmatter, and import_design end-to-end.

Run: python -m pytest designer/tests/test_import_design.py -q
"""

from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))
sys.path.insert(0, _ROOT)

from designer.emit.yaml_min import dump, parse
from designer.extract.import_design import (
    import_design,
    parse_design_md,
    split_frontmatter,
)
from designer.engine.catalog_loader import load_catalog
from designer.engine.state import TasteState
from designer.emit import design_md


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _catalog():
    return load_catalog(strict=False)


def _make_design_md_with_accent(accent: str = "#0A84FF") -> tuple[str, TasteState]:
    """Build a DESIGN.md text with a known accent via a pick, return (text, source_state)."""
    cat = _catalog()
    by_id = cat.by_id()
    st = TasteState(context={"description": "test product"})
    c = by_id["color-accent-system"]
    # Use the first option (accent-cta-only → #0A84FF) or inject a custom accent
    opt = c.options[0]
    delta = {"color": {"accent": accent}}
    st.apply_pick(c.id, opt.id, delta, source="pick")
    doc = design_md.build_design_doc("TestProd", st, flatten=True, version="1")
    text = design_md.render_design_md(doc)
    return text, st


# ---------------------------------------------------------------------------
# yaml_min round-trip invariant
# ---------------------------------------------------------------------------

def test_yaml_min_roundtrip_nested_dict():
    """parse(dump(obj)) == obj for a nested dict of scalars."""
    obj = {"a": {"b": "hello", "c": 42}, "d": {"e": "world"}}
    assert parse(dump(obj)) == obj


def test_yaml_min_roundtrip_hex_color_stays_string():
    """Hex color string '#0A6CFF' round-trips as a string, not a number."""
    obj = {"color": {"accent": "#0A6CFF"}}
    result = parse(dump(obj))
    assert result == obj
    assert isinstance(result["color"]["accent"], str)


def test_yaml_min_roundtrip_empty_dict():
    """Empty dict round-trips."""
    obj = {"empty": {}}
    result = parse(dump(obj))
    assert result == obj
    assert result["empty"] == {}


def test_yaml_min_roundtrip_empty_list():
    """Empty list round-trips."""
    obj = {"empty_list": []}
    result = parse(dump(obj))
    assert result == obj
    assert result["empty_list"] == []


def test_yaml_min_roundtrip_list_of_scalars():
    """List of scalar strings round-trips."""
    obj = {"items": ["alpha", "beta", "gamma"]}
    result = parse(dump(obj))
    assert result == obj


def test_yaml_min_roundtrip_quoted_number_as_string():
    """A number-like string value round-trips as a string (not int)."""
    obj = {"version": "3"}
    result = parse(dump(obj))
    assert result["version"] == "3"
    assert isinstance(result["version"], str)


def test_yaml_min_roundtrip_bool_values():
    """Boolean values round-trip."""
    obj = {"flag_true": True, "flag_false": False}
    result = parse(dump(obj))
    assert result == obj


def test_yaml_min_roundtrip_none_value():
    """None round-trips as None."""
    obj = {"key": None}
    result = parse(dump(obj))
    assert result == obj
    assert result["key"] is None


def test_yaml_min_roundtrip_deeply_nested():
    """Deeply nested structure round-trips."""
    obj = {"a": {"b": {"c": {"d": "leaf"}}}}
    assert parse(dump(obj)) == obj


def test_yaml_min_roundtrip_mixed_object():
    """A representative mixed object (scalars + hex + empty + list) round-trips."""
    obj = {
        "schema": "design.md/v1",
        "name": "Test",
        "version": "1",
        "base": {
            "color": {"accent": "#0A6CFF", "surface": "#F5F5F7"},
            "typography": {"headingWeight": 700},
        },
        "platforms": {},
    }
    result = parse(dump(obj))
    assert result == obj
    assert result["base"]["color"]["accent"] == "#0A6CFF"


# ---------------------------------------------------------------------------
# split_frontmatter
# ---------------------------------------------------------------------------

def test_split_frontmatter_real_design_md():
    """split_frontmatter on a real DESIGN.md returns non-empty YAML + non-empty body."""
    text, _ = _make_design_md_with_accent()
    fm, body = split_frontmatter(text)
    assert fm.strip(), "frontmatter should be non-empty"
    assert body.strip(), "body should be non-empty"
    # The YAML block should contain schema
    assert "schema" in fm


def test_split_frontmatter_no_fences():
    """split_frontmatter on text without --- fences returns ('', text)."""
    text = "just a body\nno frontmatter here"
    fm, body = split_frontmatter(text)
    assert fm == ""
    assert body == text


def test_split_frontmatter_extracts_version():
    """Frontmatter YAML is parseable and contains 'version'."""
    text, _ = _make_design_md_with_accent()
    fm, _ = split_frontmatter(text)
    doc = parse(fm)
    assert "version" in doc


# ---------------------------------------------------------------------------
# import_design end-to-end
# ---------------------------------------------------------------------------

def test_import_design_seeds_accent_in_overrides():
    """import_design seeds the known accent into overrides of a fresh state."""
    cat = _catalog()
    text, _ = _make_design_md_with_accent("#0A84FF")
    st = TasteState()
    result = import_design(st, text, cat)

    assert result.get("seeded"), "seeded list is empty"
    assert st.overrides.get("color", {}).get("accent") == "#0A84FF", st.overrides


def test_import_design_seeded_is_per_category():
    """seeded[] has multiple entries, each with category_id + dimension + source='import'."""
    cat = _catalog()
    text, _ = _make_design_md_with_accent()
    st = TasteState()
    result = import_design(st, text, cat)

    seeded = result["seeded"]
    assert len(seeded) > 1, f"expected >1 seeded entries, got {len(seeded)}"
    for entry in seeded:
        assert "category_id" in entry and entry["category_id"]
        assert "dimension" in entry and entry["dimension"]
        assert entry.get("source") == "import", entry


def test_import_design_baseline_overrides_equals_state_overrides():
    """baseline_overrides in the result equals state.overrides right after import."""
    cat = _catalog()
    text, _ = _make_design_md_with_accent()
    st = TasteState()
    result = import_design(st, text, cat)

    assert result["baseline_overrides"] == st.overrides


def test_import_design_summary_has_accent():
    """The human-readable summary contains an accent entry."""
    cat = _catalog()
    text, _ = _make_design_md_with_accent("#0A84FF")
    st = TasteState()
    result = import_design(st, text, cat)

    summary = result.get("summary", {})
    assert "accent" in summary, f"summary does not contain 'accent': {summary}"
    assert summary["accent"] == "#0A84FF", summary


# ---------------------------------------------------------------------------
# LENIENT I-ii: bogus tokens go to skipped[], valid tokens still imported
# ---------------------------------------------------------------------------

def _make_design_md_with_bogus_base_token() -> str:
    """Build a DESIGN.md text that contains a bogus token inside the 'base' layer.

    import_design processes doc['base'] and doc['platforms'] via reverse_map;
    top-level unknown keys are silently ignored (they are metadata). The bogus
    token must be INSIDE the 'base' group so reverse_map encounters it.

    We build the doc dict directly, inject bogus into base, then manually render
    the frontmatter YAML without the schema validator (which would reject it).
    """
    from designer.emit import yaml_min

    cat = _catalog()
    by_id = cat.by_id()
    st = TasteState(context={"description": "bogus test"})
    c = by_id["color-accent-system"]
    opt = c.options[0]
    st.apply_pick(c.id, opt.id, opt.token_delta, source="pick")
    doc = design_md.build_design_doc("TestProd", st, flatten=True, version="1")

    # Inject bogus group into the base layer (reverse_map processes doc['base'])
    doc["base"]["bogus"] = {"nope": "x"}

    # Render frontmatter manually (skip schema validation which would reject bogus)
    fm_doc = {k: v for k, v in doc.items() if k != "prompt_pack"}
    fm_yaml = yaml_min.dump(fm_doc)

    # Build DESIGN.md text in the frontmatter format
    body = "\n# TestProd — Design System\n\n## AI Prompt Pack\n\n"
    return "---\n" + fm_yaml + "---\n" + body


def test_import_design_bogus_token_goes_to_skipped():
    """Injecting a bogus token group into the 'base' layer puts it in skipped[]
    and does NOT appear in overrides. Valid tokens still import normally."""
    cat = _catalog()
    modified_text = _make_design_md_with_bogus_base_token()

    st = TasteState()
    result = import_design(st, modified_text, cat)

    # bogus.nope must appear in skipped with an appropriate reason
    skipped_paths = [s["path"] for s in result.get("skipped", [])]
    assert "bogus.nope" in skipped_paths, f"bogus.nope not in skipped: {result['skipped']}"

    # bogus must NOT appear in overrides
    assert "bogus" not in st.overrides, f"bogus leaked into overrides: {st.overrides}"

    # Valid accent still imported
    assert st.overrides.get("color", {}).get("accent"), "valid accent should still be imported"


def test_import_design_skipped_reason_mentions_vocabulary():
    """The skipped reason for an unknown token mentions 'vocabulary' or 'outside'."""
    cat = _catalog()
    modified_text = _make_design_md_with_bogus_base_token()

    st = TasteState()
    result = import_design(st, modified_text, cat)

    for skipped_entry in result.get("skipped", []):
        if skipped_entry["path"] == "bogus.nope":
            reason = skipped_entry.get("reason", "")
            assert "vocabulary" in reason or "outside" in reason, (
                f"Expected 'vocabulary' or 'outside' in reason, got: {reason!r}"
            )
            break
    else:
        raise AssertionError("bogus.nope not found in skipped")


# ---------------------------------------------------------------------------
# extracted_picks after import
# ---------------------------------------------------------------------------

def test_extracted_picks_non_empty_after_import():
    """After import, extracted_picks() returns at least one entry."""
    cat = _catalog()
    text, _ = _make_design_md_with_accent()
    st = TasteState()
    import_design(st, text, cat)
    picks = st.extracted_picks()
    assert len(picks) > 0, "extracted_picks() empty after import"


def test_extracted_picks_all_seeded_by_import():
    """Every category returned by extracted_picks() was seeded via import."""
    cat = _catalog()
    text, _ = _make_design_md_with_accent()
    st = TasteState()
    result = import_design(st, text, cat)
    seeded_cids = {s["category_id"] for s in result["seeded"]}

    picks = st.extracted_picks()
    for pick in picks:
        assert pick["category_id"] in seeded_cids, (
            f"{pick['category_id']!r} in extracted_picks() but not in seeded"
        )


# ---------------------------------------------------------------------------
# yaml_min: foreign hand-authored frontmatter (comments + inline flow style)
# ---------------------------------------------------------------------------

def test_yaml_min_skips_leading_comment_lines():
    """A frontmatter that OPENS with # comment lines still parses (was the
    catastrophic silent-empty root cause: parse() returned {})."""
    text = "# a header comment\n# another comment\nschema: design.md/v1\nname: Foo"
    result = parse(text)
    assert result.get("schema") == "design.md/v1"
    assert result.get("name") == "Foo"


def test_yaml_min_strips_trailing_inline_comment():
    """A trailing '# ...' comment is removed from the value, but a '#' inside a
    quoted hex color is NOT treated as a comment."""
    text = 'color:\n  accent: "#0A84FF"   # primary actions\n  grid: 8  # base unit'
    result = parse(text)
    assert result["color"]["accent"] == "#0A84FF"
    assert result["color"]["grid"] == 8


def test_yaml_min_parses_inline_flow_map():
    """Inline flow map { size: 21, weight: 600, use: "x" } parses to a dict."""
    text = 'typography:\n  L1_title: { size: 21, weight: 600, use: "screen title" }'
    result = parse(text)
    assert result["typography"]["L1_title"] == {
        "size": 21, "weight": 600, "use": "screen title",
    }


def test_yaml_min_parses_inline_flow_list():
    """Inline flow list [4, 8, 12, 16] parses to a list of ints."""
    text = "spacing:\n  scale: [4, 8, 12, 16, 24]"
    result = parse(text)
    assert result["spacing"]["scale"] == [4, 8, 12, 16, 24]


def test_yaml_min_unquoted_hex_block_is_not_a_comment():
    """An UNQUOTED hand-authored hex value (`accent: #FF5733`) must parse to the
    hex string, NOT None. (Regression: _strip_comment treated the space-led #
    as a comment, silently destroying every unquoted color value.)"""
    result = parse("color:\n  accent: #FF5733\n  bg: #FFF")
    assert result["color"]["accent"] == "#FF5733"
    assert result["color"]["bg"] == "#FFF"


def test_yaml_min_unquoted_hex_in_flow_map():
    """An unquoted hex inside a flow map parses, not corrupts. (Regression:
    comment-stripping was not bracket-aware and truncated mid-collection.)"""
    result = parse("color: { accent: #FF5733, bg: #FFF }")
    assert result["color"] == {"accent": "#FF5733", "bg": "#FFF"}


def test_yaml_min_8digit_alpha_hex_unquoted():
    """An 8-digit (alpha) unquoted hex parses as the full hex string."""
    result = parse("color:\n  overlay: #FF5733AA")
    assert result["color"]["overlay"] == "#FF5733AA"


def test_yaml_min_real_trailing_comment_still_stripped():
    """A genuine trailing word-comment (non-hex after #) is still removed."""
    result = parse("spacing:\n  grid: 8  # base unit\n  density: 2  # F1 first")
    assert result["spacing"] == {"grid": 8, "density": 2}


def test_yaml_min_dump_roundtrip_still_holds():
    """The dump()->parse() round-trip invariant survives the comment/flow
    additions (regression guard for the emitted format)."""
    obj = {
        "schema": "design.md/v1",
        "base": {"color": {"accent": "#0A6CFF"}, "typography": {"headingWeight": 700}},
        "platforms": {},
    }
    assert parse(dump(obj)) == obj


# ---------------------------------------------------------------------------
# Top-level (hand-authored) frontmatter layout — the core fix
# ---------------------------------------------------------------------------

_TOP_LEVEL_DESIGN_MD = """---
# A hand-authored DESIGN.md (Google design.md/v1 convention).
schema: design.md/v1
name: HandAuthored
platform: macOS desktop (SwiftUI)
principles:
  - Calm, low-chrome.
color:
  bg:       "#FFFFFF"
  accent:   "#0A84FF"   # primary actions
  surface:  "#F5F5F7"
typography:
  fontFamily: "-apple-system, system-ui, sans-serif"
  L1_title: { size: 21, weight: 600, use: "title" }
spacing:
  grid: 8
  scale: [4, 8, 12, 16]
radius:
  button: 8
  card: 10
totallyBogusKey:
  nope: x
---

# HandAuthored — Design System
"""


def test_import_top_level_format_seeds_overrides():
    """A DESIGN.md with token groups at the TOP LEVEL (no `base:`) seeds a
    non-empty overrides set — the original silent-empty bug."""
    cat = _catalog()
    st = TasteState()
    result = import_design(st, _TOP_LEVEL_DESIGN_MD, cat)

    assert result.get("available") is True
    assert result.get("mapped", 0) > 0, result
    assert st.overrides.get("color", {}).get("accent") == "#0A84FF", st.overrides
    assert st.overrides.get("color", {}).get("bg") == "#FFFFFF"
    assert st.overrides.get("typography", {}).get("fontFamily")
    assert st.overrides.get("spacing", {}).get("grid") == 8
    assert st.overrides.get("radius", {}).get("button") == 8


def test_import_top_level_format_flags_non_vocab_in_skipped():
    """Top-level tokens outside the vocabulary land in skipped[], never silently
    dropped (lenient I-ii). Inline flow maps that are not vocab keys (L1_title)
    and the bogus top-level key both surface."""
    cat = _catalog()
    st = TasteState()
    result = import_design(st, _TOP_LEVEL_DESIGN_MD, cat)

    skipped_paths = {s["path"] for s in result.get("skipped", [])}
    # L1_title is not a typography vocab key -> skipped.
    assert "typography.L1_title" in skipped_paths, skipped_paths
    # scale is not a spacing vocab key -> skipped.
    assert "spacing.scale" in skipped_paths, skipped_paths
    # radius.card IS a vocab key -> mapped, not skipped.
    assert "radius.card" not in skipped_paths, skipped_paths
    assert st.overrides.get("radius", {}).get("card") == 10
    # A foreign top-level key is surfaced too.
    assert "totallyBogusKey" in skipped_paths, skipped_paths
    # The bogus value never leaks into overrides.
    assert "totallyBogusKey" not in st.overrides


def test_import_both_formats_base_takes_precedence():
    """A doc carrying BOTH a base: layer AND top-level groups merges both, with
    base winning on a conflicting (group, key)."""
    cat = _catalog()
    both = """---
schema: design.md/v1
name: BothFormats
base:
  color:
    accent: "#111111"
color:
  accent: "#999999"
  bg: "#FFFFFF"
---
# body
"""
    st = TasteState()
    result = import_design(st, both, cat)
    assert result.get("available") is True
    # base accent wins over the top-level accent.
    assert st.overrides["color"]["accent"] == "#111111", st.overrides
    # the top-level-only token still merges in.
    assert st.overrides["color"]["bg"] == "#FFFFFF"


# ---------------------------------------------------------------------------
# NO-SILENT-EMPTY guard
# ---------------------------------------------------------------------------

def test_import_zero_map_returns_warning_not_silent_seed():
    """A frontmatter that parses but maps ZERO recognized tokens returns an
    explicit unavailable+warning signal and leaves state untouched."""
    cat = _catalog()
    non_token = """---
schema: design.md/v1
name: NoTokens
randomKey: bar
anotherThing:
  nested: value
---
# body
"""
    st = TasteState()
    result = import_design(st, non_token, cat)

    assert result.get("available") is False, result
    assert result.get("mapped", -1) == 0
    assert result.get("warning"), "expected a non-empty warning"
    assert "unexpected format" in result["warning"].lower()
    assert st.overrides == {}, "0-map import must NOT seed overrides"


def test_import_unquoted_hex_seeds_real_values_not_none():
    """A hand-authored file using UNQUOTED hex (the dominant human convention)
    imports the real hex values, never silently None. (Regression for the
    auditor's f1 — recognized keys with destroyed values.)"""
    cat = _catalog()
    unquoted = """---
schema: design.md/v1
name: Unquoted
color:
  accent: #0A84FF
  bg: #FFFFFF
  surface: #F5F5F7
---
# body
"""
    st = TasteState()
    result = import_design(st, unquoted, cat)
    assert result.get("available") is True
    assert result.get("mapped", 0) >= 3, result
    assert st.overrides["color"]["accent"] == "#0A84FF"
    assert st.overrides["color"]["bg"] == "#FFFFFF"
    # No None leaked into overrides.
    for k, v in st.overrides.get("color", {}).items():
        assert v is not None, k


def test_import_null_valued_token_does_not_count_as_mapped():
    """A recognized token whose value did NOT parse (None/empty) must NOT count
    toward mapped_count and must be surfaced, not silently seeded. (Regression
    for the auditor's f3 — guard counted keys, not meaningful values.)"""
    cat = _catalog()
    malformed = """---
schema: design.md/v1
name: Malformed
color:
  accent:
  bg:
---
# body
"""
    st = TasteState()
    result = import_design(st, malformed, cat)
    assert result.get("available") is False, result
    assert result.get("mapped", -1) == 0
    assert st.overrides == {}, "null-valued tokens must NOT seed overrides"
    null_paths = {s["path"] for s in result.get("skipped", []) if s.get("value") is None}
    assert "color.accent" in null_paths
    assert "color.bg" in null_paths


def test_import_empty_frontmatter_returns_warning():
    """Empty frontmatter (no token groups, no base) returns the unavailable
    warning rather than a silent empty seed."""
    cat = _catalog()
    st = TasteState()
    result = import_design(st, "---\n---\n# body only", cat)
    assert result.get("available") is False
    assert result.get("warning")


def test_import_no_frontmatter_returns_parse_error():
    """Text with no frontmatter fence returns a parse error (unavailable)."""
    cat = _catalog()
    st = TasteState()
    result = import_design(st, "just text, no fences", cat)
    assert result.get("available") is False
    assert result.get("errors") or result.get("warning")


def test_import_successful_warning_surfaces_skipped_count():
    """A successful import that skipped some tokens carries a non-fatal warning
    naming the skipped count (the UI surfaces it on the confirm screen)."""
    cat = _catalog()
    st = TasteState()
    result = import_design(st, _TOP_LEVEL_DESIGN_MD, cat)
    assert result.get("available") is True
    assert result.get("warning"), "expected a non-fatal skipped-token warning"
    assert "not imported" in result["warning"].lower()


# ---------------------------------------------------------------------------
# Real-file regression — the actual Sample Notes DESIGN.md (if present)
# ---------------------------------------------------------------------------

def test_import_synthetic_notes_design_md():
    """The real hand-authored Sample Notes DESIGN.md seeds a non-empty system
    with its accent #0A84FF and flags its non-vocab tokens. Skips cleanly if
    the file is not on this machine (keeps the suite portable)."""
    psych = os.path.join(os.path.dirname(__file__), "fixtures", "sample-notes_design.md")
    cat = _catalog()
    st = TasteState()
    text = open(psych, encoding="utf-8").read()
    result = import_design(st, text, cat)

    assert result.get("available") is True
    assert result.get("mapped", 0) >= 10, result.get("mapped")
    assert st.overrides.get("color", {}).get("accent") == "#0A84FF"
    # The known non-vocab sample-notes tokens are surfaced, not dropped.
    skipped_paths = {s["path"] for s in result.get("skipped", [])}
    assert "typography.L1_title" in skipped_paths
    assert "spacing.scale" in skipped_paths
