"""The compare header keeps every text item in the text column.

`.c-head` is a two-column grid whose big number spans three rows. The header
renders four text items (area, question, status, why), so the fourth fell into
the 48/72px number column and wrapped one word per line. Observed 2026-10-06 on
a real board: IBR reported `p.c-why` painting 90px of text into a 72px box.
"""
from __future__ import annotations

import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "decisions" / "app"


def test_header_items_after_the_number_stay_in_the_text_column():
    css = (APP / "decisions.css").read_text()
    rule = re.search(r"\.c-head(?::not\(\.no-num\))?\s*>\s*:not\(\.c-big\)\s*\{([^}]*)\}", css)
    assert rule, "no rule pins non-number header items to a column"
    assert re.search(r"grid-column\s*:\s*2\b", rule.group(1))


def test_header_still_renders_more_items_than_the_number_spans():
    # Guards the premise: if the header ever drops to three items the rule is
    # harmless, but if it grows the rule above is what keeps the layout intact.
    js = (APP / "decisions.js").read_text()
    head = js[js.index('<div class="c-head'):]
    head = head[: head.index('<div class="c-pair">')]
    items = sum(head.count(cls) for cls in ('class="c-area"', 'class="c-q"', 'class="c-why"', "implementationHtml("))
    span = int(re.search(r"\.c-big\s*\{[^}]*grid-row\s*:\s*1\s*/\s*span\s*(\d+)", (APP / "decisions.css").read_text()).group(1))
    assert items > span


def test_unordered_boards_hide_numbers_and_use_one_column_header():
    css = (APP / "decisions.css").read_text(); js = (APP / "decisions.js").read_text()
    assert re.search(r"\.c-head\.no-num\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,\s*1fr\)", css)
    assert "DATA.ordered === true" in js
    assert re.search(r"body:not\(\.c-ordered\)\s*\.c-jump\s*\{[^}]*display\s*:\s*none", css)


def test_index_cards_are_uniform_and_hover_glows_instead_of_underlining():
    css = (APP / "decisions.css").read_text()
    assert re.search(r"\.c-cards\s*\{[^}]*grid-auto-rows\s*:\s*1fr", css)
    hover = re.search(r"\.c-card:hover[^{]*\{([^}]*)\}", css)
    assert hover and "box-shadow" in hover.group(1) and "border-color" in hover.group(1)
    assert "text-decoration:underline" not in css.replace(" ", "")
