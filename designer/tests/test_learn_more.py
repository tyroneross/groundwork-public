"""Tests for designer.engine.learn_more.

Verifies:
- Every real catalog category produces a non-empty, structurally correct explainer.
- The explainer is collapsed by default (no ` open` attribute — Hick's Law).
- Required CSS classes and structural elements are present.
- Content for flagged categories ("color-accent-system", "sheet-size") is meaningful.
- Dynamic text is HTML-escaped.
- Categories not in the hand-authored table use the default builder and still return
  a non-empty explainer.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from designer.engine import catalog_loader
from designer.engine.learn_more import build_learn_more


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_all_categories():
    cat = catalog_loader.load_catalog()
    return cat.categories


# ---------------------------------------------------------------------------
# Tests against the real catalog
# ---------------------------------------------------------------------------

class TestAllCategories:
    """Every category in the real catalog must produce a valid explainer."""

    @pytest.fixture(scope="class")
    @classmethod
    def all_categories(cls):
        return _load_all_categories()

    def test_all_categories_return_nonempty_string(self, all_categories):
        for cat in all_categories:
            result = build_learn_more(cat)
            assert isinstance(result, str), f"{cat.id}: expected str, got {type(result)}"
            assert result.strip(), f"{cat.id}: returned empty string"

    def test_all_categories_contain_details_tag(self, all_categories):
        for cat in all_categories:
            result = build_learn_more(cat)
            assert "<details" in result, f"{cat.id}: missing <details"

    def test_all_categories_contain_decision_explainer_class(self, all_categories):
        for cat in all_categories:
            result = build_learn_more(cat)
            assert "decision-explainer" in result, (
                f"{cat.id}: missing class 'decision-explainer'"
            )

    def test_all_categories_contain_summary_class(self, all_categories):
        for cat in all_categories:
            result = build_learn_more(cat)
            assert "decision-explainer-summary" in result, (
                f"{cat.id}: missing class 'decision-explainer-summary'"
            )

    def test_all_categories_collapsed_by_default(self, all_categories):
        """The `open` attribute must NOT appear — collapsed is Hick's Law requirement."""
        for cat in all_categories:
            result = build_learn_more(cat)
            # Match " open" (space-prefixed) to avoid false positives on "decision-explainer"
            assert " open" not in result, (
                f"{cat.id}: found ' open' attribute — sheet must be collapsed by default"
            )

    def test_all_categories_contain_what_this_controls(self, all_categories):
        for cat in all_categories:
            result = build_learn_more(cat)
            assert "What this controls" in result, (
                f"{cat.id}: missing 'What this controls' section"
            )

    def test_all_categories_contain_what_it_does(self, all_categories):
        for cat in all_categories:
            result = build_learn_more(cat)
            assert "What it does" in result, (
                f"{cat.id}: missing 'What it does' section"
            )

    def test_all_categories_contain_at_least_one_list_item(self, all_categories):
        for cat in all_categories:
            result = build_learn_more(cat)
            assert "<li" in result, f"{cat.id}: missing at least one <li"


# ---------------------------------------------------------------------------
# Tests for specifically flagged categories
# ---------------------------------------------------------------------------

class TestFlaggedCategories:
    """color-accent-system and sheet-size must contain domain-specific keywords."""

    @pytest.fixture(scope="class")
    @classmethod
    def by_id(cls):
        cats = _load_all_categories()
        return {c.id: c for c in cats}

    def test_color_accent_system_mentions_accent_placement(self, by_id):
        cat = by_id["color-accent-system"]
        result = build_learn_more(cat)
        keywords = ["accent", "CTA", "placement", "signal", "semantic"]
        found = any(kw.lower() in result.lower() for kw in keywords)
        assert found, (
            f"color-accent-system explainer does not mention accent placement concept. "
            f"Expected one of {keywords}.\nGot:\n{result}"
        )

    def test_sheet_size_mentions_detent_or_snap(self, by_id):
        cat = by_id["sheet-size"]
        result = build_learn_more(cat)
        keywords = ["detent", "snap", "resting", "height", "stop"]
        found = any(kw.lower() in result.lower() for kw in keywords)
        assert found, (
            f"sheet-size explainer does not mention detent/snap/resting concept. "
            f"Expected one of {keywords}.\nGot:\n{result}"
        )


# ---------------------------------------------------------------------------
# HTML-escaping test via synthetic category
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _FakeOption:
    id: str = "fake-opt"
    label: str = "Fake"
    tag: str = "Test"
    desc: str = "A fake option with <b>bold</b>."
    token_delta: dict = field(default_factory=dict)


@dataclass(frozen=True)
class _FakeCategory:
    id: str = "fake-category-not-in-table"
    name: str = "Fake"
    title: str = "Fake Decision"
    description: str = "Fake description with <em>emphasis</em>."
    cp_note: str = "Fake note with <script>alert('xss')</script> injection."
    dimension: str = "fake.dimension"
    options: list = field(default_factory=lambda: [_FakeOption()])


class TestHtmlEscaping:
    """Dynamic text from catalog fields must be HTML-escaped before insertion."""

    def test_script_injection_is_escaped(self):
        fake = _FakeCategory()
        result = build_learn_more(fake)  # type: ignore[arg-type]
        assert "<script>" not in result, "Raw <script> tag found — not escaped"
        assert "&lt;script&gt;" in result, "Expected &lt;script&gt; in output"

    def test_html_in_description_is_escaped(self):
        fake = _FakeCategory()
        result = build_learn_more(fake)  # type: ignore[arg-type]
        assert "<em>" not in result, "Raw <em> from description leaked through"

    def test_result_still_has_structure(self):
        fake = _FakeCategory()
        result = build_learn_more(fake)  # type: ignore[arg-type]
        assert "<details" in result
        assert "decision-explainer" in result
        assert "<li" in result


# ---------------------------------------------------------------------------
# Default-path test: a category not in the hand-authored table
# ---------------------------------------------------------------------------

class TestDefaultPath:
    """Categories absent from the hand-authored table use _default_learn_more."""

    def test_unknown_category_yields_nonempty_explainer(self):
        """Use the fake category (id not in _LEARN_MORE) to exercise the default path."""
        fake = _FakeCategory()
        result = build_learn_more(fake)  # type: ignore[arg-type]
        assert result.strip(), "Default path returned empty string"
        assert "<details" in result
        assert "decision-explainer" in result
        assert "What this controls" in result
        assert "What it does" in result
        assert "<li" in result
        assert " open" not in result
