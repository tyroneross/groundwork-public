"""Contrast is GRADED from the stylesheet, never asserted as a hex literal.

A test that pins `--text` to "#171B21" fails the moment anyone re-themes the
surface, and it proves nothing about legibility either way. So this parses the
token block out of decisions.css and computes the real WCAG 2.2 ratio for every
pair the surface actually paints, in BOTH themes. Re-theme freely; the gate
grades the relationship.

The surface this was ported from was light-theme only. Dark is new here, which
is exactly why it needs a computed floor rather than a careful eye.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

CSS = Path(__file__).resolve().parent.parent / "decisions" / "app" / "decisions.css"

# WCAG 2.2: 1.4.3 body text 4.5:1; 1.4.11 meaning-carrying non-text 3:1.
AA_TEXT = 4.5
AA_NON_TEXT = 3.0

# What the surface paints on what. Each pair is a real rule in decisions.css.
TEXT_PAIRS = [
    ("text", "bg"), ("text", "surface"), ("text", "surface-2"),
    ("text-muted", "bg"), ("text-muted", "surface"), ("text-muted", "surface-2"),
    ("accent", "surface"), ("accent", "bg"),
    ("accent-strong", "accent-soft"), ("text", "accent-soft"),
    ("good", "surface"), ("good", "good-soft"), ("text", "good-soft"),
    ("danger", "surface"), ("danger", "danger-soft"), ("text", "danger-soft"),
    ("warn", "surface"), ("warn", "warn-soft"), ("text", "warn-soft"),
    # The compare board paints answer colours on the page background too (the
    # option headings sit outside the response box) as well as on its surface.
    ("good", "bg"), ("warn", "bg"), ("danger", "bg"), ("text", "bg"),
]

# The inset rules that carry selection and state. These are the ONLY signal for
# "which option is picked" at a glance, so they are meaning-carrying non-text.
NON_TEXT_PAIRS = [
    ("accent", "surface"), ("accent", "accent-soft"),
    ("good", "surface"), ("danger", "surface"),
    ("border-strong", "surface"),
    # Compare: the wireframe's dashed warn edge and the chosen option's good
    # outline both sit on the page background; the invalid note edge on surface.
    ("warn", "bg"), ("good", "bg"), ("danger", "surface"),
]


def _srgb(c: int) -> float:
    x = c / 255.0
    return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4


def luminance(hex_colour: str) -> float:
    h = hex_colour.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _srgb(r) + 0.7152 * _srgb(g) + 0.0722 * _srgb(b)


def contrast(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _block(css: str, start_pat: str) -> dict[str, str]:
    """Pull `--name:#hex` pairs out of the first block matching start_pat."""
    m = re.search(start_pat, css, re.MULTILINE)
    assert m, f"no block in decisions.css matched {start_pat!r}"
    # depth starts at 1: the pattern already consumed the opening brace. Starting
    # at 0 made the closing brace take depth to -1, which never equals 0, so the
    # walk ran to end-of-file and every block returned EVERY token in the
    # stylesheet -- with the last value winning. The light theme was then graded
    # against the dark palette and a broken light token could not fail. Caught by
    # planting a low-contrast --text-muted and watching the gate stay green.
    depth, i, body = 1, m.end(), []
    while i < len(css):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                break
        body.append(css[i])
        i += 1
    assert depth == 0, f"unbalanced braces after {start_pat!r}"
    return dict(re.findall(r"--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})", "".join(body)))


@pytest.fixture(scope="module")
def themes() -> dict[str, dict[str, str]]:
    css = CSS.read_text(encoding="utf-8")
    light = _block(css, r"^:root\s*\{")
    dark = _block(css, r':root\[data-theme="dark"\]\s*\{')
    # The system-preference block must define the same tokens as the explicit
    # override, or the two ways of getting dark disagree.
    media = _block(css, r"@media\s*\(prefers-color-scheme:\s*dark\)\s*\{")
    assert light, "no light token block found"
    assert dark, "no [data-theme=dark] token block found"
    return {"light": light, "dark": dark, "media-dark": media}


def test_both_themes_define_every_token_the_surface_uses(themes):
    needed = {t for pair in TEXT_PAIRS + NON_TEXT_PAIRS for t in pair}
    for name in ("light", "dark"):
        missing = sorted(needed - set(themes[name]))
        assert not missing, f"{name} theme is missing tokens: {missing}"


def test_system_dark_and_explicit_dark_agree(themes):
    """Both routes into dark must land on the same colours.

    The media query alone cannot be toggled and the attribute alone ignores the
    OS, so the surface ships both. If they drift, a person toggling the theme
    gets a different palette than a person whose OS is already dark.
    """
    explicit, media = themes["dark"], themes["media-dark"]
    shared = set(explicit) & set(media)
    assert shared, "the dark media query defines no tokens"
    disagree = {k: (explicit[k], media[k]) for k in shared
                if explicit[k].lower() != media[k].lower()}
    assert not disagree, f"dark routes disagree on {disagree}"


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_body_text_clears_wcag_aa(themes, theme):
    t = themes[theme]
    failures = [
        f"{fg} on {bg} = {contrast(t[fg], t[bg]):.2f}:1"
        for fg, bg in TEXT_PAIRS if contrast(t[fg], t[bg]) < AA_TEXT
    ]
    assert not failures, f"{theme} theme below {AA_TEXT}:1 -> " + "; ".join(failures)


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_state_indicators_clear_non_text_contrast(themes, theme):
    t = themes[theme]
    failures = [
        f"{fg} on {bg} = {contrast(t[fg], t[bg]):.2f}:1"
        for fg, bg in NON_TEXT_PAIRS if contrast(t[fg], t[bg]) < AA_NON_TEXT
    ]
    assert not failures, f"{theme} theme below {AA_NON_TEXT}:1 -> " + "; ".join(failures)


def test_the_contrast_maths_is_itself_correct():
    """A grader nobody checked is not evidence. Black on white is 21:1."""
    assert round(contrast("#000000", "#FFFFFF"), 2) == 21.0
    assert round(contrast("#FFFFFF", "#FFFFFF"), 2) == 1.0
    assert round(contrast("#777777", "#FFFFFF"), 1) == 4.5  # the canonical AA edge


def test_every_interactive_control_reserves_a_44px_target():
    """Apple HIG 44px, stricter than WCAG 2.5.8's 24px.

    Checked structurally: every rule naming an interactive class must carry a
    min-height, because a control that is merely styled small cannot be hit on a
    phone regardless of how it looks.
    """
    css = CSS.read_text(encoding="utf-8")
    interactive = [".tab", ".d-opt", ".d-use", ".mini-btn", ".d-more-btn", "textarea",
                   ".c-choice", ".c-jump a", ".c-idx a", ".c-back"]
    missing = []
    for sel in interactive:
        # Match the selector as a WHOLE token: a bare `.tab` otherwise matches
        # inside `.tabs`, and the test then grades the wrong rule.
        pat = re.escape(sel) + r"(?![\w-])[^{}]*\{([^}]*)\}"
        blocks = [m.group(1) for m in re.finditer(pat, css)]
        if not any("min-height" in b for b in blocks):
            missing.append(sel)
    assert not missing, f"no min-height on: {missing}"
    assert "min-height:44px" in css.replace(" ", "")


def test_no_remote_stylesheet_or_font_is_required():
    """The surface must render with no network.

    A font that fails to load must not change the layout it was measured in, and
    a person ruling on their own project should not need the internet to see it.
    """
    css = CSS.read_text(encoding="utf-8")
    html = (CSS.parent / "index.html").read_text(encoding="utf-8")
    for blob, what in ((css, "decisions.css"), (html, "index.html")):
        assert "@import" not in blob, f"{what} imports a remote stylesheet"
        assert "fonts.googleapis" not in blob, f"{what} loads a remote font"
        assert "http://" not in blob and "https://" not in blob, f"{what} fetches over the network"
    # The stack must end in a generic family so an absent face degrades.
    m = re.search(r"--font-sans:\s*([^;]+);", css)
    assert m, "no --font-sans token"
    assert m.group(1).strip().rstrip(";").split(",")[-1].strip() in {
        "sans-serif", "serif", "system-ui", "monospace"
    }, "the font stack must end in a generic family"


def test_dividers_are_inset_shadows_not_per_item_borders():
    """One border around a group, dividers between the rows.

    And the divider is a shadow on the BUTTON, never a border on the <li>: the
    row's own background (picked, ruled) paints over an <li> border and the
    divider vanishes exactly where the eye is looking.
    """
    css = CSS.read_text(encoding="utf-8")
    assert "li + li > .d-opt" in css.replace("  ", " ")
    assert re.search(r"li \+ li > \.d-opt\s*\{\s*box-shadow:inset 0 1px 0", css)
    # A picked row that is also a divider row needs BOTH shadows, or selecting
    # an option silently deletes the divider above it.
    assert re.search(r"li \+ li > \.d-opt\.picked\s*\{\s*box-shadow:inset 3px 0 0 var\(--accent\),\s*inset 0 1px 0",
                     css), "a picked divider row must keep its divider"


def test_dispositions_are_text_colour_never_a_filled_badge():
    css = CSS.read_text(encoding="utf-8")
    for state in ("incorporated", "declined"):
        m = re.search(r"\.disp\." + state + r"\s*\{([^}]*)\}", css)
        assert m, f"no .disp.{state} rule"
        body = m.group(1)
        assert "color:" in body
        assert "background" not in body, (
            f".disp.{state} paints a background; a badge is a box competing with "
            "the content, and the word already carries the meaning")


def test_grid_tracks_cannot_overflow_a_390px_viewport():
    """`1fr` is `minmax(auto,1fr)`, so a column refuses to shrink below its
    min-content -- a 390px preview frame then forces a horizontal scrollbar on
    the one viewport that cannot afford one."""
    css = CSS.read_text(encoding="utf-8")
    for m in re.finditer(r"grid-template-columns:([^;]+);", css):
        track = m.group(1)
        assert "minmax(auto" not in track
        assert not re.search(r"(^|\s)1fr", track), (
            f"bare 1fr track {track.strip()!r} cannot shrink below min-content")


def _compare_block(css: str) -> str:
    start = css.index("/* ---------------------------------------------------------------- compare */")
    end = css.index("/* --------------------------------------------------------------- save line */")
    return css[start:end]


def test_compare_board_holds_a_14px_type_floor():
    """The board is read on a phone. Nothing in it is set below 14px."""
    block = _compare_block(CSS.read_text(encoding="utf-8"))
    sizes = [float(m) for m in re.findall(r"font-size:\s*([0-9.]+)px", block)]
    assert sizes, "the compare block sets no font sizes"
    small = [s for s in sizes if s < 14]
    assert not small, f"compare type below 14px: {small}"


def test_compare_answer_buttons_are_a_2x2_grid_on_phones():
    block = _compare_block(CSS.read_text(encoding="utf-8"))
    base = re.search(r"\.c-choices\s*\{([^}]*)\}", block)
    assert base and "repeat(2,minmax(0,1fr))" in base.group(1).replace(" ", "")
    m = re.search(r"\.c-choice\s*\{([^}]*)\}", block)
    height = re.search(r"min-height:\s*(\d+)px", m.group(1))
    assert height and int(height.group(1)) >= 44


def test_compare_status_is_text_colour_never_a_fill():
    """Calm Precision: an answer colours text (and a pressed ring), never a chip."""
    block = _compare_block(CSS.read_text(encoding="utf-8"))
    for m in re.finditer(r"([^{}]*\[data-[cv]=[^{}]*)\{([^}]*)\}", block):
        assert "background" not in m.group(2), f"filled status in {m.group(1).strip()}"


def test_compare_colours_are_existing_graded_tokens():
    """No new colour token enters the board ungraded."""
    block = _compare_block(CSS.read_text(encoding="utf-8"))
    used = set(re.findall(r"var\(--([a-z0-9-]+)\)", block))
    graded = {t for pair in TEXT_PAIRS + NON_TEXT_PAIRS for t in pair} | {"border", "card-width"}
    assert used <= graded, f"ungraded tokens in compare: {sorted(used - graded)}"
    assert not re.search(r"#[0-9A-Fa-f]{3,8}\b", re.sub(r"/\*.*?\*/", "", block, flags=re.S)), "a hex literal bypasses the tokens"
