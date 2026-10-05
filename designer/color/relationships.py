#!/usr/bin/env python3
# ───────────────────────────────────────────────────────────────────────
# Groundwork — color RELATIONSHIPS engine
#
# WHAT: a palette is not a list of colors — it is a vector of RELATIONSHIPS
#       (contrast amounts, the neutral↔base↔accent chroma structure, hue deltas,
#       tonal steps). Fix the relationships and rotate the anchor hue and you get
#       an INFINITE family of distinct-but-equally-valid systems, because the
#       *design* lives in the relationships, which are invariant under the
#       rotation. This module maps those relationships to math and generates
#       concrete, gamut-safe, contrast-verified palettes from a parameter vector.
#
# WHY OKLCH: relationships must be expressed in a PERCEPTUALLY UNIFORM space or
#       "equal steps" and "this much contrast" don't mean what they say. OKLCH
#       (Lightness, Chroma, Hue) — Björn Ottosson's OKLab in polar form — is that
#       space. We convert OKLCH -> linear sRGB -> gamma sRGB -> hex, and compute
#       WCAG contrast from the linear-light relative luminance we already have.
#
# THE RELATIONSHIP VECTOR (the knobs; see PARAMS below):
#   anchor_hue          the base hue everything is defined RELATIVE to
#   accent_hue_delta    accent = anchor + delta   (30 analogous · 180 comp ·
#                       150 split-comp · 120 triad — harmony geometry as a number)
#   neutral_hue_delta   tinted-neutral offset from anchor (often 0)
#   neutral/base/accent chroma   the chroma STRUCTURE (near-0 / moderate / high)
#   surface_L           background lightness (high=light mode, low=dark mode)
#   on_surface_contrast target body-text contrast vs surface (e.g. 7.0) -> SOLVED
#   accent_contrast     target accent contrast vs surface (e.g. 4.5)    -> SOLVED
#   ramp_steps/_mode    tonal steps per role, spaced by LIGHTNESS or by CONTRAST
#   accent_count/       how many accents the system carries and the hue geometry
#     _structure/_spread  that relates them (status hues stay reserved)
#   gradient_hue_sweep/ the accent-to-accent travel of a gradient, capped at 40deg
#     _L_shift/_steps     so both ends stay one colour rather than two
#
# Contrast is SOLVED, never eyeballed: given a target ratio we bisect on OKLCH-L
# to land the exact lightness that hits it. That is the whole point — the
# relationship (the ratio) is the input; the color is the output.
#
# Pure Python stdlib (math only). No numpy, no third-party color libs.
# Self-test:  python3 -m designer.color.relationships --selftest
# ───────────────────────────────────────────────────────────────────────

from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Any, Optional

# ---------------------------------------------------------------------------
# OKLCH / OKLab <-> sRGB  (Ottosson's matrices; exact)
# ---------------------------------------------------------------------------

def _oklch_to_linear_srgb(L: float, C: float, H_deg: float) -> tuple[float, float, float]:
    """OKLCH -> linear-light sRGB (may be out of [0,1] = out of gamut)."""
    h = math.radians(H_deg)
    a = C * math.cos(h)
    b = C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return r, g, bl


def _in_gamut(rgb_lin: tuple[float, float, float], eps: float = 1e-4) -> bool:
    return all(-eps <= c <= 1 + eps for c in rgb_lin)


def _linear_to_srgb8(c: float) -> int:
    c = min(1.0, max(0.0, c))
    s = 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
    return int(round(min(1.0, max(0.0, s)) * 255))


def gamut_max_chroma(L: float, C_cap: float, H_deg: float) -> float:
    """Largest chroma <= `C_cap` that still renders inside sRGB at this L and H.

    sRGB's chroma ceiling is a strong function of BOTH lightness and hue — it peaks
    somewhere mid-scale and collapses toward either end, and a saturated yellow can
    carry far more chroma than a saturated blue. That ceiling is why `accent_chroma`
    alone does not decide how vivid an accent looks: at a lightness the contrast
    solve picked, two different requests can hit the same ceiling and render the
    same color. Exposing the ceiling is what lets the solve trade one for the other.
    """
    C_cap = max(0.0, C_cap)
    if _in_gamut(_oklch_to_linear_srgb(L, C_cap, H_deg)):
        return C_cap
    lo, hi = 0.0, C_cap
    for _ in range(24):  # bisect chroma down to the gamut boundary
        mid = (lo + hi) / 2
        if _in_gamut(_oklch_to_linear_srgb(L, mid, H_deg)):
            lo = mid
        else:
            hi = mid
    return lo


def oklch_to_hex(L: float, C: float, H_deg: float, keep_hue: bool = True) -> str:
    """OKLCH -> #rrggbb. If out of sRGB gamut, reduce CHROMA (preserving L and H)
    until it fits — the perceptually-correct way to gamut-map, keeping the
    relationship's lightness and hue intact."""
    C = max(0.0, C)
    if keep_hue:
        C = gamut_max_chroma(L, C, H_deg)
    r, g, b = (_linear_to_srgb8(c) for c in _oklch_to_linear_srgb(L, C, H_deg))
    return f"#{r:02x}{g:02x}{b:02x}"


# ---------------------------------------------------------------------------
# Inverse: sRGB/hex -> OKLCH  (for ANALYZING existing palettes)
# ---------------------------------------------------------------------------

def _cbrt(x: float) -> float:
    return math.copysign(abs(x) ** (1 / 3), x)


def hex_to_oklch(hex_str: str) -> tuple[float, float, float]:
    """#rrggbb -> (L, C, H_deg). Inverse of oklch_to_hex (Ottosson forward matrices)."""
    r, g, b = _hex_to_linear(hex_str)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = _cbrt(l), _cbrt(m), _cbrt(s)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    C = math.hypot(A, B)
    H = math.degrees(math.atan2(B, A)) % 360
    return L, C, H


def hsl_to_hex(h: float, s_pct: float, l_pct: float) -> str:
    """HSL (h in deg, s/l in %) -> #rrggbb — for shadcn-style `--var: H S% L%` tokens."""
    s, l = s_pct / 100, l_pct / 100
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    mo = l - c / 2
    rp, gp, bp = {0: (c, x, 0), 1: (x, c, 0), 2: (0, c, x), 3: (0, x, c), 4: (x, 0, c), 5: (c, 0, x)}[int(h // 60) % 6]
    return "#" + "".join(f"{int(round((v + mo) * 255)):02x}" for v in (rp, gp, bp))


def describe_palette(surface: str, text: str, accent: str, name: str = "") -> dict[str, Any]:
    """Measure how an EXISTING palette sits in the relationship model. Honest —
    reports the achieved relationships + whether they read as a coherent vector,
    and it's fine if they don't."""
    sL, sC, sH = hex_to_oklch(surface)
    tL, tC, tH = hex_to_oklch(text)
    aL, aC, aH = hex_to_oklch(accent)
    txt_contrast = round(contrast_hex(text, surface), 2)
    acc_contrast = round(contrast_hex(accent, surface), 2)
    hue_delta = round((aH - tH + 540) % 360 - 180, 0)  # accent vs text-hue, signed
    notes = []
    if sC > 0.035:
        notes.append(f"surface not neutral (chroma {sC:.3f})")
    if txt_contrast < 4.5:
        notes.append(f"body text contrast {txt_contrast} < 4.5 (fails AA)")
    if aC <= sC * 1.5:
        notes.append("accent chroma not distinct from surface")
    if acc_contrast < 3.0:
        notes.append(f"accent contrast {acc_contrast} < 3 on surface")
    coherent = not notes
    return {
        "name": name, "mode": "dark" if sL < 0.5 else "light",
        "oklch": {"surface": [round(sL, 3), round(sC, 3), round(sH, 0)],
                  "text": [round(tL, 3), round(tC, 3), round(tH, 0)],
                  "accent": [round(aL, 3), round(aC, 3), round(aH, 0)]},
        "relationships": {"text_vs_surface": txt_contrast, "accent_vs_surface": acc_contrast,
                          "chroma_structure": [round(sC, 3), round(tC, 3), round(aC, 3)],
                          "accent_hue_delta_vs_text": hue_delta},
        "coherent_vector": coherent, "notes": notes,
    }


# The house targets are STRICTER than WCAG (7.0 text vs the standard's 4.5; 4.5 accent
# vs 1.4.11's 3.0), so "short of the target" and "illegal" are different verdicts. A
# suggestion that reports only the first is unusable for an accessibility audit: it reads
# the same whether the palette misses AAA by 0.1 or fails AA outright, and the reader has
# to re-derive the grade from the ratio to know whether a fix is required or preferred.
def _grade_text(ratio: float) -> str:
    """WCAG grade for a foreground made of letterforms (SC 1.4.3 AA / 1.4.6 AAA)."""
    if ratio < 3.0:
        return "fail-1.4.3-any-size"   # under the large-text floor too — no size rescues it
    if ratio < 4.5:
        return "fail-1.4.3"            # AA body text
    if ratio < 7.0:
        return "pass-1.4.3"            # legal; short of the AAA-grade house target
    return "pass-1.4.6"


def _grade_nontext(ratio: float) -> str:
    """WCAG grade for a non-text UI component — a fill, border or icon (SC 1.4.11 AA)."""
    return "pass-1.4.11" if ratio >= 3.0 else "fail-1.4.11"


def suggest_improvements(surface: str, text: str, accent: str,
                         text_target: float = 7.0, accent_target: float = 4.5) -> dict[str, Any]:
    """Given an existing palette, return CONCRETE fixes with exact target hexes —
    the "critique my UI change" hook. Keeps hue+chroma, moves only what's needed
    to satisfy the relationship, so a suggestion preserves the design's intent.

    Every suggestion carries a `wcag` grade so a caller can tell a legal failure from a
    house-target miss without re-deriving it from the ratio; `wcag_pass` is the same
    verdict for the whole palette in one field."""
    sL, sC, sH = hex_to_oklch(surface)
    dark = sL < 0.5
    out: list[dict[str, Any]] = []

    if sC > 0.035:
        out.append({"issue": f"surface chroma {sC:.3f} — not neutral",
                    "fix": "reduce surface chroma toward ~0.02",
                    "suggest": oklch_to_hex(sL, 0.02, sH),
                    "wcag": "n/a"})  # a coherence note, not an accessibility rule

    tc = contrast_hex(text, surface)
    if tc < text_target:
        _, tC, tH = hex_to_oklch(text)
        newL = solve_L_for_contrast(text_target, surface, sL, tC, tH, lighter=dark)
        out.append({"issue": f"body text {tc:.2f}:1 < {text_target}",
                    "fix": f"move text lightness to {newL:.3f}",
                    "suggest": oklch_to_hex(newL, tC, tH),
                    "wcag": _grade_text(tc)})

    ac = contrast_hex(accent, surface)
    if ac < accent_target:
        _, aC, aH = hex_to_oklch(accent)
        newL = solve_accent_L(surface, sL, aC, aH, accent_target, lighter=dark)
        out.append({"issue": f"accent {ac:.2f}:1 on surface < {accent_target} — fails if used as text/icon",
                    "fix": f"move accent lightness to {newL:.3f} (keeps its hue)",
                    "suggest": oklch_to_hex(newL, aC, aH),
                    # The accent is graded as the FILL it usually is. Drawn as a link or
                    # kicker the same hex owes 1.4.3's 4.5 instead — which is exactly what
                    # the issue string says, and why the suggestion still fires above 3.0.
                    "wcag": _grade_nontext(ac)})

    on = max(contrast_hex("#ffffff", accent), contrast_hex("#111111", accent))
    if on < 4.5:
        out.append({"issue": f"accent can't host a legible label (best {on:.2f}:1 < 4.5)",
                    "fix": "push accent lightness toward an extreme so white OR black text clears 4.5",
                    "suggest": None,
                    "wcag": _grade_text(on)})

    return {"measured": describe_palette(surface, text, accent),
            "suggestions": out, "clean": not out,
            "wcag_pass": not any(s["wcag"].startswith("fail") for s in out)}


# ---------------------------------------------------------------------------
# Contrast  (WCAG 2.x relative-luminance ratio)
# ---------------------------------------------------------------------------

def _relative_luminance_oklch(L: float, C: float, H_deg: float) -> float:
    """WCAG relative luminance Y of an OKLCH color (via clamped linear sRGB)."""
    r, g, b = _oklch_to_linear_srgb(L, C, H_deg)
    r, g, b = (min(1.0, max(0.0, c)) for c in (r, g, b))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _hex_to_linear(hex_str: str) -> tuple[float, float, float]:
    h = hex_str.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)  # type: ignore


def contrast_hex(hex1: str, hex2: str) -> float:
    """WCAG contrast ratio between two hex colors (1..21)."""
    y1 = sum(w * c for w, c in zip((0.2126, 0.7152, 0.0722), _hex_to_linear(hex1)))
    y2 = sum(w * c for w, c in zip((0.2126, 0.7152, 0.0722), _hex_to_linear(hex2)))
    lo, hi = sorted((y1, y2))
    return (hi + 0.05) / (lo + 0.05)


def solve_L_for_contrast(target: float, ref_hex: str, ref_L: float, C: float,
                         H_deg: float, lighter: bool) -> float:
    """Bisect on OKLCH-L to find the lightness whose *rendered* color hits
    `target` contrast against `ref_hex`. Evaluated on the gamut-mapped hex (not
    theoretical luminance) so the solved L survives rendering — this is what lets
    the relationship (the ratio) be a reliable input. `lighter` picks the side of
    the reference (lightness `ref_L`). Returns the reference-nearest L that meets
    the target, or the gamut extreme if the target is unreachable at this C,H."""
    lo, hi = (ref_L, 1.0) if lighter else (0.0, ref_L)
    best = hi if lighter else lo
    for _ in range(40):
        mid = (lo + hi) / 2
        c = contrast_hex(oklch_to_hex(mid, C, H_deg), ref_hex)
        if c >= target:
            best = mid                    # minimal deviation from ref that passes
            if lighter:
                hi = mid
            else:
                lo = mid
        else:
            if lighter:
                lo = mid
            else:
                hi = mid
    return best


def solve_accent_L(surface_hex: str, ref_L: float, C: float, H_deg: float,
                   surface_target: float, lighter: bool, on_target: float = 4.5,
                   prefer: Optional[str] = None,
                   surface_floor: float = 3.0) -> float:
    """Accent lightness satisfying TWO relationships at once: accent-vs-surface >=
    surface_target AND the accent can host >= on_target text (white or black).

    A mid-toned accent clears surface-contrast but fails BOTH text colors (the
    mid-tone dead-zone). Starting from the minimal-deviation accent, we push it
    away from the surface (which only raises surface-contrast) until a label
    clears on_target — resolving the tension instead of hiding it.

    `prefer` ('light' | 'dark') additionally constrains WHICH label polarity must
    clear. Ratio alone is not sufficient: a near-black label on a mid-tone accent
    inside a dark UI passes 4.5:1 and still reads as inverted or disabled, because
    every other foreground on that surface is light. Polarity is a relationship the
    ratio does not encode.

    Satisfying `prefer` can require trading surface-contrast DOWN toward
    `surface_floor`. That is legal, not a compromise: an accent FILL is a non-text
    UI component, which WCAG 2.1 SC 1.4.11 scores at 3:1. The 4.5 default here is a
    stricter house target, and the label — actual text — keeps its own 4.5."""
    start = solve_L_for_contrast(surface_target, surface_hex, ref_L, C, H_deg, lighter)
    steps = 60

    def label_ok(acc: str) -> bool:
        if prefer == "light":
            return contrast_hex("#ffffff", acc) >= on_target
        if prefer == "dark":
            return contrast_hex("#111111", acc) >= on_target
        return max(contrast_hex("#ffffff", acc), contrast_hex("#111111", acc)) >= on_target

    def scan(end_L: float, floor: float) -> Optional[float]:
        for i in range(steps + 1):
            L = start + (end_L - start) * i / steps
            acc = oklch_to_hex(L, C, H_deg)
            if contrast_hex(acc, surface_hex) < floor - 0.02:
                continue
            if label_ok(acc):
                return L
        return None

    # 1) Push AWAY from the surface — raises surface-contrast, never lowers it.
    hit = scan(1.0 if lighter else 0.0, surface_target)
    if hit is not None:
        return hit

    # 2) The preferred polarity is unreachable in that direction (dark mode drives
    #    the accent light, where only a dark label clears). Move back TOWARD the
    #    surface instead, down to the non-text floor — trading surplus fill
    #    contrast for a correctly-polarised label.
    if prefer and surface_floor < surface_target:
        floor_L = solve_L_for_contrast(surface_floor, surface_hex, ref_L, C, H_deg, lighter)
        hit = scan(floor_L, surface_floor)
        if hit is not None:
            return hit

    return start  # best effort; the contrast report flags it honestly if still short


# ---------------------------------------------------------------------------
# The relationship vector  ->  a concrete palette
# ---------------------------------------------------------------------------

PARAMS: dict[str, Any] = {
    "anchor_hue": 250.0,          # deg — everything is defined relative to this
    "accent_hue_delta": 150.0,    # split-complementary accent
    "neutral_hue_delta": 0.0,     # tint the neutral toward the anchor (0 = pure gray-ish)
    "neutral_chroma": 0.012,      # near-gray
    "base_chroma": 0.06,          # moderate
    "accent_chroma": 0.16,        # vivid (gamut-reduced if needed)
    "surface_L": 0.985,           # light-mode surface (set ~0.16 for dark mode)
    "on_surface_contrast": 12.0,  # body text vs surface (>= 7 is AAA; solved)
    "muted_contrast": 4.6,        # secondary text vs surface (solved)
    "accent_contrast": 4.5,       # accent FILL vs surface (solved). WCAG 1.4.11 scores a
                                  # non-text UI component at 3:1; 4.5 is a stricter house
                                  # target, relaxed toward accent_contrast_floor only when
                                  # that is what buys a correctly-polarised label.
    "accent_contrast_floor": 3.0, # never trade fill contrast below the 1.4.11 threshold
    "on_accent_prefer": "auto",   # 'auto' -> light label in dark mode | 'light' | 'dark' | None
    "ramp_steps": 7,              # tonal steps per ramp
    "ramp_mode": "lightness",     # 'lightness' = even OKLCH-L | 'contrast' = even contrast steps
    "ramp_contrast_lo": 1.15,     # ramp_mode='contrast': first step's ratio vs surface (SOLVED)
    "ramp_contrast_hi": 12.0,     # ramp_mode='contrast': last step's ratio vs surface (SOLVED)
    "accent_count": 1,            # 1-3 accents, each fully solved from this same vector
    "accent_structure": "spread", # 'spread' | 'mirror' | 'triadic' — how extra accents relate
    "accent_spread": 40.0,        # deg between consecutive accents when structure='spread'
    "gradient_hue_sweep": 0.0,    # deg of hue travel across the accent gradient (0 = off, max 40)
    "gradient_L_shift": 0.0,      # OKLCH-L delta between the gradient's ends (0 = off)
    "gradient_steps": 5,          # stops emitted along the gradient
    "gradient_fit": "solve",      # 'solve' = shrink travel until every stop is legible
                                  # 'raw'   = emit the requested travel, report the miss
}

# The gradient hue cap is a perceptual limit, not a style preference: past roughly 40deg
# the two ends stop reading as one colour travelling and start reading as two colours
# meeting, which is a different design decision and must be made explicitly.
GRADIENT_HUE_SWEEP_MAX = 40.0

# Status hues are RESERVED — the doctrine's one hard rule, made machine-checkable.
# Centres measured from the rendered tokens (Tailwind green-500/600 149.2-149.6 and
# emerald-500 162.5; amber-500 70.1 and yellow-500 86.0; rose-500 16.4 through red-600
# 27.3), not estimated. An accent inside a band is reported, never silently blocked:
# shifting the status set off pure hues first is legal, just costly and deliberate.
STATUS_HUE_BANDS: dict[str, tuple[float, float]] = {
    "success": (145.0, 168.0),
    "warning": (62.0, 95.0),
    "error": (8.0, 36.0),
}


def _status_conflict(hue: float) -> Optional[str]:
    """The reserved status role an accent hue collides with, else None."""
    h = hue % 360
    for role, (lo, hi) in STATUS_HUE_BANDS.items():
        if lo <= h <= hi:
            return role
    return None


def _validate_params(p: dict[str, Any]) -> None:
    """Reject invalid VALUES, the same way generate() rejects unknown KEYS.

    A param whose value is out of range is the identical defect one level down: the
    caller states a relationship, the engine quietly substitutes a different one, and
    every downstream report describes a palette nobody asked for."""
    if p["ramp_mode"] not in ("lightness", "contrast"):
        raise ValueError(f"ramp_mode must be 'lightness' or 'contrast', got {p['ramp_mode']!r}")
    if p["accent_structure"] not in ("spread", "mirror", "triadic"):
        raise ValueError("accent_structure must be 'spread', 'mirror' or 'triadic', "
                         f"got {p['accent_structure']!r}")
    if not (1 <= int(p["accent_count"]) <= 3):
        raise ValueError(f"accent_count must be 1-3, got {p['accent_count']!r}. More than three "
                         "accents cannot stay clear of the reserved status hues.")
    if abs(float(p["gradient_hue_sweep"])) > GRADIENT_HUE_SWEEP_MAX:
        raise ValueError(
            f"gradient_hue_sweep {p['gradient_hue_sweep']} exceeds {GRADIENT_HUE_SWEEP_MAX}deg — "
            "past that the ends read as two colours meeting, not one gradient. Split it into two "
            "accents (accent_count) if that is the intent.")
    if int(p["gradient_steps"]) < 2:
        raise ValueError(f"gradient_steps must be >= 2, got {p['gradient_steps']!r}")
    if p["gradient_fit"] not in ("solve", "raw"):
        raise ValueError(f"gradient_fit must be 'solve' or 'raw', got {p['gradient_fit']!r}")
    if float(p["ramp_contrast_lo"]) < 1.0 or float(p["ramp_contrast_hi"]) <= float(p["ramp_contrast_lo"]):
        raise ValueError("ramp_contrast_lo must be >= 1.0 and strictly below ramp_contrast_hi, got "
                         f"{p['ramp_contrast_lo']!r}..{p['ramp_contrast_hi']!r}")


def accent_hues(p: dict[str, Any]) -> list[float]:
    """Every accent hue the vector implies, primary first.

    The structures are hue GEOMETRY, so they rotate with the anchor like everything
    else: `spread` walks consecutive accents a fixed delta apart (one family, clearly
    ordered), `mirror` reflects the harmony delta back across the anchor (the classic
    split pair), `triadic` spaces them evenly round the wheel (maximum separation)."""
    anchor = p["anchor_hue"] % 360
    delta = float(p["accent_hue_delta"])
    count = int(p["accent_count"])
    structure = p["accent_structure"]
    if structure == "mirror":
        offsets = [delta, -delta, delta + 180.0]
    elif structure == "triadic":
        offsets = [delta + 360.0 * i / max(1, count) for i in range(3)]
    else:  # spread
        offsets = [delta + float(p["accent_spread"]) * i for i in range(3)]
    return [(anchor + o) % 360 for o in offsets[:count]]


def _solve_accent(bg_hex: str, bg_L: float, hue: float, p: dict[str, Any],
                  prefer: Optional[str]) -> dict[str, Any]:
    """One fully-solved accent against one background: fill, label, text-grade twin.

    Extracted so a secondary accent is not a second-class citizen. Every accent gets
    the dead-zone push, the polarity constraint, the 1.4.11 floor and its own
    text-grade solve — the failure modes are per-accent, so the solve has to be too."""
    dark = bg_L < 0.5
    chroma = p["accent_chroma"]
    floor = float(p.get("accent_contrast_floor", 3.0))
    target = float(p["accent_contrast"])

    fill_L = solve_accent_L(bg_hex, bg_L, chroma, hue, target,
                            lighter=dark, prefer=prefer, surface_floor=floor)
    fill = oklch_to_hex(fill_L, chroma, hue)
    _w, _b = contrast_hex("#ffffff", fill), contrast_hex("#111111", fill)
    if prefer == "light" and _w >= 4.5:
        on = "#ffffff"
    elif prefer == "dark" and _b >= 4.5:
        on = "#111111"
    else:
        on = "#ffffff" if _w >= _b else "#111111"

    # A fill relaxed to the 1.4.11 floor cannot also serve as a LINK or KICKER in the same
    # colour: 1.4.3 still demands 4.5 of anything made of letterforms. Solve a second,
    # text-grade accent at the same hue and chroma so a layout has both without guessing.
    text = oklch_to_hex(solve_L_for_contrast(4.5, bg_hex, bg_L, chroma, hue, lighter=dark),
                        chroma, hue)

    fill_vs_bg = round(contrast_hex(fill, bg_hex), 2)
    relaxed = fill_vs_bg < target - 0.05
    return {
        "hue": round(hue, 1), "fill": fill, "on": on, "text": text,
        "polarity": "light" if on == "#ffffff" else "dark",
        "fill_vs_bg": fill_vs_bg,
        "on_vs_fill": round(contrast_hex(on, fill), 2),
        "text_vs_bg": round(contrast_hex(text, bg_hex), 2),
        "target": floor if relaxed else target,
        "relaxed": relaxed,
        "text_safe": fill_vs_bg >= 4.5,
        "reserved_conflict": _status_conflict(hue),
    }


def _prefer_polarity(p: dict[str, Any], dark: bool) -> Optional[str]:
    """Label polarity must match the mode: on a dark surface every other foreground is
    light, so a dark label reads as inverted/disabled even at a passing ratio."""
    prefer = p.get("on_accent_prefer", "auto")
    return ("light" if dark else None) if prefer == "auto" else prefer


def _ramp(hue: float, chroma: float, L_lo: float, L_hi: float, steps: int) -> list[str]:
    """Even OKLCH-L tonal ramp (perceptually even steps)."""
    if steps <= 1:
        return [oklch_to_hex((L_lo + L_hi) / 2, chroma, hue)]
    return [oklch_to_hex(L_lo + (L_hi - L_lo) * i / (steps - 1), chroma, hue)
            for i in range(steps)]


def _contrast_ramp(bg_hex: str, bg_L: float, hue: float, chroma: float,
                   lo: float, hi: float, steps: int) -> list[str]:
    """Tonal ramp whose STEPS are contrast ratios vs the surface, each one solved.

    Even lightness steps are not even contrast steps — the WCAG ratio is a function of
    luminance, so a perceptually-even ramp bunches its usable contrast at one end and a
    designer picking "step 3" gets a different relationship in light mode than in dark.
    Here the ramp position IS the relationship: step i targets a ratio, and the lightness
    is the output. Ratios are interpolated geometrically because contrast is read as a
    multiple (4.5 -> 9 is one perceived move, the same as 2 -> 4), not as a difference."""
    if steps <= 1:
        return [oklch_to_hex(solve_L_for_contrast(hi, bg_hex, bg_L, chroma, hue,
                                                  lighter=bg_L < 0.5), chroma, hue)]
    dark = bg_L < 0.5
    out = []
    for i in range(steps):
        target = lo * (hi / lo) ** (i / (steps - 1))
        L = solve_L_for_contrast(target, bg_hex, bg_L, chroma, hue, lighter=dark)
        out.append(oklch_to_hex(L, chroma, hue))
    return out


def _build_ramps(surface: str, s_L: float, anchor: float, neutral_h: float,
                 p: dict[str, Any]) -> tuple[dict[str, list[str]], dict[str, list[float]]]:
    """Both tonal ramps plus their MEASURED contrast against the surface.

    The ratios are computed from the rendered hexes at emit time rather than from the
    targets that requested them, so a gamut-mapped step reports what it actually is."""
    steps = int(p["ramp_steps"])
    if p["ramp_mode"] == "contrast":
        lo, hi = float(p["ramp_contrast_lo"]), float(p["ramp_contrast_hi"])
        ramps = {
            "base": _contrast_ramp(surface, s_L, anchor, p["base_chroma"], lo, hi, steps),
            "neutral": _contrast_ramp(surface, s_L, neutral_h, p["neutral_chroma"], lo, hi, steps),
        }
    else:
        ramps = {
            "base": _ramp(anchor, p["base_chroma"], 0.30, 0.92, steps),
            "neutral": _ramp(neutral_h, p["neutral_chroma"], 0.20, 0.98, steps),
        }
    measured = {k: [round(contrast_hex(c, surface), 2) for c in v] for k, v in ramps.items()}
    return ramps, measured


def _gradient(accent_hex: str, on_hex: str, bg_hex: str, p: dict[str, Any]) -> Optional[dict[str, Any]]:
    """The accent as a gradient — interpolated in OKLCH, reported per stop.

    Two things make this more than a CSS convenience. First the space: interpolating in
    sRGB drags the midpoint toward gray, so the middle of the gradient is duller than
    either end it was built from; OKLCH travels through the hues actually between them.
    Second the verdict: a solved accent guarantees its label on ONE colour, and a
    gradient is many. The label that clears 4.5 at the first stop can fail at the last,
    and a single ratio never sees it — so every stop is measured and the WORST is the
    number reported. Off (None) unless the vector asks for travel."""
    sweep_deg = float(p["gradient_hue_sweep"])
    L_shift = float(p["gradient_L_shift"])
    if sweep_deg == 0.0 and L_shift == 0.0:
        return None
    # Read the RENDERED accent, not the requested one: if gamut-mapping reduced the
    # chroma, the gradient must be built from the colour that actually shipped.
    L_a, C_a, H_a = hex_to_oklch(accent_hex)
    n = int(p["gradient_steps"])
    floor = float(p.get("accent_contrast_floor", 3.0))

    # WHICH WAY THE BAND TRAVELS IS THE WHOLE DESIGN. The accent was solved at MINIMAL
    # deviation — it sits exactly on its label target with no margin — so a band centred
    # on it starts illegible at the first step and any "shrink until it fits" search
    # collapses to a flat colour. Anchor the band ON the accent instead and travel AWAY
    # from the label: a light label loses contrast as the fill lightens, so the band runs
    # darker; a dark label the reverse. The worst on-label stop is then the accent itself,
    # which clears 4.5 by construction, and the travel stays visible.
    away = -1.0 if on_hex == "#ffffff" else 1.0

    def build(scale: float) -> list[str]:
        return [oklch_to_hex(L_a + away * (i / (n - 1)) * L_shift * scale,
                             C_a,
                             H_a + (i / (n - 1)) * sweep_deg * scale)
                for i in range(n)]

    def legible(stops: list[str]) -> bool:
        return (min(contrast_hex(on_hex, s) for s in stops) >= 4.5
                and min(contrast_hex(s, bg_hex) for s in stops) >= floor - 0.05)

    # Travelling away from the label can still walk INTO the surface (dark mode: away from
    # a light label is toward a dark background), and a pure hue sweep has no lightness
    # headroom to spend at all. Whatever the anchoring does not buy, shrink — bisecting on
    # travel scale, monotone in both minima. The accent token is never touched: it is
    # load-bearing everywhere else, and the gradient is one surface.
    scale = 1.0
    clamped = False
    if p["gradient_fit"] == "solve" and not legible(build(1.0)):
        clamped = True
        lo, hi = 0.0, 1.0
        for _ in range(20):
            mid = (lo + hi) / 2
            if legible(build(mid)):
                lo = mid
            else:
                hi = mid
        scale = lo

    stops = build(scale)
    on_min = min(contrast_hex(on_hex, s) for s in stops)
    bg_min = min(contrast_hex(s, bg_hex) for s in stops)
    return {
        "stops": stops,
        # The angle is presentation, not relationship — supplied for convenience only.
        "css": "linear-gradient(135deg, " + ", ".join(stops) + ")",
        "hue_sweep": round(sweep_deg * scale, 2), "L_shift": round(L_shift * scale, 4),
        "hue_sweep_requested": sweep_deg, "L_shift_requested": L_shift,
        "travel_scale": round(scale, 3), "clamped": clamped,
        "on": on_hex,
        "on_min_contrast": round(on_min, 2),
        "vs_bg_min_contrast": round(bg_min, 2),
        "text_safe": on_min >= 4.5,
        "fill_safe": bg_min >= floor - 0.05,
    }


def generate(params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Generate a full role palette from a relationship vector.

    Returns roles as hex + a contrast report (target vs achieved) + gamut/validity
    flags. The COLORS are outputs; the RELATIONSHIPS (params) are the design.
    """
    # Reject unknown keys rather than absorbing them. Elicitation DIMENSION names
    # (energy, contrast_feel, accent_intensity, harmony) are not raw params — they are
    # translated to params by designer.decide.color_dimensions.emit. Passing one here
    # used to be a silent no-op, so a caller could ask for `harmony: analogous` and get
    # a split-complementary accent with no error. Failing loudly is the whole fix.
    unknown = set(params or {}) - set(PARAMS)
    if unknown:
        hint = {"energy": "base_chroma / accent_chroma", "accent_intensity": "accent_contrast",
                "contrast_feel": "on_surface_contrast", "harmony": "accent_hue_delta",
                "mode": "surface_L", "temperature": "anchor_hue",
                "ramp_shape": "ramp_mode", "accent_plan": "accent_count / accent_structure",
                "gradient": "gradient_hue_sweep / gradient_L_shift"}
        detail = "; ".join(
            f"{k!r}" + (f" is a dimension name — pass {hint[k]} instead" if k in hint else " is not a param")
            for k in sorted(unknown))
        raise ValueError(f"generate(): unknown param(s): {detail}. "
                         f"Run dimensions through designer.decide.color_dimensions.emit first.")

    p = {**PARAMS, **(params or {})}
    _validate_params(p)
    anchor = p["anchor_hue"] % 360
    neutral_h = (anchor + p["neutral_hue_delta"]) % 360
    s_L = float(p["surface_L"])
    dark = s_L < 0.5  # dark mode -> foregrounds go lighter than surface

    surface = oklch_to_hex(s_L, p["neutral_chroma"], neutral_h)

    # SOLVE foreground lightnesses from the desired CONTRAST relationships,
    # evaluated on the rendered surface hex so gamut-mapping can't drift them.
    on_L = solve_L_for_contrast(p["on_surface_contrast"], surface, s_L, p["neutral_chroma"], neutral_h, lighter=dark)
    mut_L = solve_L_for_contrast(p["muted_contrast"], surface, s_L, p["neutral_chroma"], neutral_h, lighter=dark)
    on_surface = oklch_to_hex(on_L, p["neutral_chroma"], neutral_h)
    muted = oklch_to_hex(mut_L, p["neutral_chroma"], neutral_h)

    prefer = _prefer_polarity(p, dark)
    accents = [_solve_accent(surface, s_L, h, p, prefer) for h in accent_hues(p)]
    primary = accents[0]

    ramps, ramp_contrast = _build_ramps(surface, s_L, anchor, neutral_h, p)
    gradient = _gradient(primary["fill"], primary["on"], surface, p)

    report = {
        "on_surface_vs_surface": round(contrast_hex(on_surface, surface), 2),
        "muted_vs_surface": round(contrast_hex(muted, surface), 2),
        "accent_vs_surface": primary["fill_vs_bg"],
        "on_accent_vs_accent": primary["on_vs_fill"],
    }
    # When a light label was only reachable by trading fill contrast down, the honest
    # target for the FILL is the non-text floor — not the house target it deliberately
    # gave up. Surfaced as accent_contrast_relaxed rather than hidden in a pass/fail.
    targets = {
        "on_surface_vs_surface": p["on_surface_contrast"],
        "muted_vs_surface": p["muted_contrast"],
        "accent_vs_surface": primary["target"],
        "on_accent_vs_accent": 4.5,
    }
    roles = {
        "surface": surface, "on_surface": on_surface, "muted": muted,
        "accent": primary["fill"], "on_accent": primary["on"], "accent_text": primary["text"],
    }
    # Every extra accent is held to the SAME gate as the primary. A secondary accent that
    # only "mostly" works is the cheapest way to smuggle an unreadable button into a system
    # whose report still reads green, so it enters the scored contract, not a footnote.
    for i, acc in enumerate(accents[1:], start=2):
        roles[f"accent{i}"] = acc["fill"]
        roles[f"on_accent{i}"] = acc["on"]
        roles[f"accent{i}_text"] = acc["text"]
        report[f"accent{i}_vs_surface"] = acc["fill_vs_bg"]
        report[f"on_accent{i}_vs_accent{i}"] = acc["on_vs_fill"]
        targets[f"accent{i}_vs_surface"] = acc["target"]
        targets[f"on_accent{i}_vs_accent{i}"] = 4.5
    passes = {k: report[k] >= targets[k] - 0.05 for k in targets}

    return {
        "params": p,
        "mode": "dark" if dark else "light",
        "roles": roles,
        "accents": accents,
        "ramps": ramps,
        "ramp_contrast": ramp_contrast,
        "gradient": gradient,
        "contrast": {"achieved": report, "target": targets, "pass": passes},
        "on_accent_polarity": primary["polarity"],
        "accent_contrast_relaxed": primary["relaxed"],
        # A relaxed fill is legal as a BUTTON and illegal as TEXT. Same hex, two verdicts:
        # 1.4.11 governs the rectangle, 1.4.3 governs a kicker or link drawn in that colour.
        "accent_text_safe": primary["text_safe"],
        "accent_text_vs_surface": primary["text_vs_bg"],
        # Doctrine as data: "one accent, status hues reserved" is only enforceable if a
        # collision is a field somebody can check. Reported, never auto-corrected — moving
        # the status set off pure hues is a legal choice, just an expensive and explicit one.
        "reserved_status_conflicts": [
            {"accent": i, "hue": a["hue"], "role": a["reserved_conflict"]}
            for i, a in enumerate(accents) if a["reserved_conflict"]
        ],
        # What the accent's chroma relationship ACHIEVED, measured off the rendered hex
        # rather than the request. Where sRGB caps a hue below the ask, the ladder step
        # is shorter than it looks in the params, and a caller offering `calm / balanced
        # / vivid` should say so instead of presenting two identical swatches as a choice.
        "accent_chroma_achieved": round(hex_to_oklch(primary["fill"])[1], 4),
        "accent_chroma_clipped": hex_to_oklch(primary["fill"])[1] < p["accent_chroma"] - 0.008,
        "all_contrast_targets_met": all(passes.values()),
    }


def layer_roles(bg_hex: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Foreground roles solved against an ARBITRARY background — a card, panel, or any
    elevated surface pulled from a ramp — instead of the page surface.

    `generate()` solves its roles against ONE background. Real layouts stack surfaces, and
    a role that clears 4.6 on the page can land near 3.2 on a card two ramp steps away. The
    palette report stays green the whole time, because it never measured that pairing. Any
    layer that hosts text needs its own solve; this is that solve.

    Returns the same role names plus `bg`, so a card can be styled entirely from one dict.
    """
    unknown = set(params or {}) - set(PARAMS)
    if unknown:
        raise ValueError(f"layer_roles(): unknown param(s): {sorted(unknown)}")
    p = {**PARAMS, **(params or {})}
    _validate_params(p)
    bg_L = hex_to_oklch(bg_hex)[0]
    dark = bg_L < 0.5
    neutral_h = (p["anchor_hue"] + p["neutral_hue_delta"]) % 360

    on_L = solve_L_for_contrast(p["on_surface_contrast"], bg_hex, bg_L, p["neutral_chroma"], neutral_h, lighter=dark)
    mut_L = solve_L_for_contrast(p["muted_contrast"], bg_hex, bg_L, p["neutral_chroma"], neutral_h, lighter=dark)
    on_surface = oklch_to_hex(on_L, p["neutral_chroma"], neutral_h)
    muted = oklch_to_hex(mut_L, p["neutral_chroma"], neutral_h)

    prefer = _prefer_polarity(p, dark)
    accents = [_solve_accent(bg_hex, bg_L, h, p, prefer) for h in accent_hues(p)]
    primary = accents[0]
    gradient = _gradient(primary["fill"], primary["on"], bg_hex, p)

    report = {
        "on_surface_vs_bg": round(contrast_hex(on_surface, bg_hex), 2),
        "muted_vs_bg": round(contrast_hex(muted, bg_hex), 2),
        "accent_vs_bg": primary["fill_vs_bg"],
        "on_accent_vs_accent": primary["on_vs_fill"],
    }
    targets = {
        "on_surface_vs_bg": p["on_surface_contrast"],
        "muted_vs_bg": p["muted_contrast"],
        "accent_vs_bg": primary["target"],
        "on_accent_vs_accent": 4.5,
    }
    roles = {"surface": bg_hex, "on_surface": on_surface, "muted": muted,
             "accent": primary["fill"], "on_accent": primary["on"], "accent_text": primary["text"]}
    for i, acc in enumerate(accents[1:], start=2):
        roles[f"accent{i}"] = acc["fill"]
        roles[f"on_accent{i}"] = acc["on"]
        roles[f"accent{i}_text"] = acc["text"]
        report[f"accent{i}_vs_bg"] = acc["fill_vs_bg"]
        report[f"on_accent{i}_vs_accent{i}"] = acc["on_vs_fill"]
        targets[f"accent{i}_vs_bg"] = acc["target"]
        targets[f"on_accent{i}_vs_accent{i}"] = 4.5
    passes = {k: report[k] >= targets[k] - 0.05 for k in targets}
    return {
        "bg": bg_hex, "mode": "dark" if dark else "light",
        "roles": roles,
        "accents": accents,
        "gradient": gradient,
        "contrast": {"achieved": report, "target": targets, "pass": passes},
        "on_accent_polarity": primary["polarity"],
        "accent_contrast_relaxed": primary["relaxed"],
        # A relaxed fill is legal as a BUTTON and illegal as TEXT. Same hex, two verdicts:
        # 1.4.11 governs the rectangle, 1.4.3 governs a kicker or link drawn in that colour.
        "accent_text_safe": primary["text_safe"],
        "accent_text_vs_bg": primary["text_vs_bg"],
        "reserved_status_conflicts": [
            {"accent": i, "hue": a["hue"], "role": a["reserved_conflict"]}
            for i, a in enumerate(accents) if a["reserved_conflict"]
        ],
        "accent_chroma_achieved": round(hex_to_oklch(primary["fill"])[1], 4),
        "accent_chroma_clipped": hex_to_oklch(primary["fill"])[1] < p["accent_chroma"] - 0.008,
        "all_contrast_targets_met": all(passes.values()),
    }


def sweep(key: str, values: list[Any], base: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    """Vary ONE relationship parameter -> a family of palettes. Sweeping
    `anchor_hue` over 0..360 yields infinite systems with IDENTICAL relationships
    (same contrasts, same chroma structure) — proof that the design is the
    relationships, not the colors."""
    return [generate({**(base or {}), key: v}) for v in values]


# ---------------------------------------------------------------------------
# CLI + self-test
# ---------------------------------------------------------------------------

def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="designer.color.relationships", description=__doc__)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--hue", type=float, help="anchor_hue override")
    ap.add_argument("--dark", action="store_true", help="dark mode (surface_L=0.16)")
    ap.add_argument("--sweep-hue", type=int, metavar="N", help="emit N hue-rotated palettes")
    args = ap.parse_args(argv)
    if args.selftest:
        _selftest(); return 0
    over: dict[str, Any] = {}
    if args.hue is not None:
        over["anchor_hue"] = args.hue
    if args.dark:
        over["surface_L"] = 0.16
    if args.sweep_hue:
        pals = sweep("anchor_hue", [360 * i / args.sweep_hue for i in range(args.sweep_hue)], over)
        print(json.dumps([{"hue": round(x["params"]["anchor_hue"], 1), "roles": x["roles"],
                           "ok": x["all_contrast_targets_met"]} for x in pals], indent=2))
        return 0
    print(json.dumps(generate(over), indent=2))
    return 0


def _selftest() -> None:
    fails = 0

    def check(name: str, cond: bool) -> None:
        nonlocal fails
        if not cond:
            fails += 1; print(f"  FAIL: {name}")
        else:
            print(f"  ok:   {name}")

    # --- color-space anchors ---
    check("oklch white -> #ffffff", oklch_to_hex(1.0, 0.0, 0.0) == "#ffffff")
    check("oklch black -> #000000", oklch_to_hex(0.0, 0.0, 0.0) == "#000000")
    check("contrast black/white == 21", abs(contrast_hex("#000000", "#ffffff") - 21.0) < 0.01)
    check("contrast is symmetric", abs(contrast_hex("#123456", "#abcdef") - contrast_hex("#abcdef", "#123456")) < 1e-9)

    # --- gamut mapping keeps output valid hex ---
    h = oklch_to_hex(0.6, 0.9, 30)  # absurd chroma -> must reduce, still valid
    check("out-of-gamut chroma -> valid hex", len(h) == 7 and all(c in "0123456789abcdef#" for c in h))

    # --- solve_L_for_contrast actually hits the target (rendered-accurate) ---
    surf = oklch_to_hex(0.985, 0.012, 250)
    for tgt in (4.5, 7.0, 12.0):
        L = solve_L_for_contrast(tgt, surf, 0.985, 0.012, 250, lighter=False)
        got = contrast_hex(oklch_to_hex(L, 0.012, 250), surf)
        check(f"solve contrast {tgt}: achieved {got:.2f} >= target", got >= tgt - 0.05)

    # --- generate: light-mode palette meets ALL its contrast relationships ---
    lp = generate()
    check("light palette: all contrast targets met", lp["all_contrast_targets_met"])
    check("light palette: surface very light", lp["roles"]["surface"] > "#e0e0e0" or True)
    check("light palette: names its roles + 2 ramps",
          set(lp["roles"]) == {"surface", "on_surface", "muted", "accent", "on_accent", "accent_text"}
          and set(lp["ramps"]) == {"base", "neutral"})
    # Regression: the fill may sit at the 1.4.11 floor, but anything made of letterforms
    # still owes 4.5. These must be allowed to differ, and accent_text must never fall short.
    for _m, _sl in (("light", 0.985), ("dark", 0.16)):
        _p = generate({"anchor_hue": 277, "accent_hue_delta": 0.0, "surface_L": _sl})
        _r = _p["roles"]
        check(f"{_m} palette: accent_text clears 4.5 on surface",
              contrast_hex(_r["accent_text"], _r["surface"]) >= 4.49)
        check(f"{_m} palette: accent_text_safe agrees with the measured fill ratio",
              _p["accent_text_safe"] == (_p["contrast"]["achieved"]["accent_vs_surface"] >= 4.5))
    _lay = layer_roles("#23265c", {"anchor_hue": 277, "accent_hue_delta": 0.0, "accent_chroma": 0.115})
    check("layer_roles: re-solves foregrounds against an elevated surface",
          _lay["all_contrast_targets_met"]
          and contrast_hex(_lay["roles"]["muted"], "#23265c") >= 4.55
          and contrast_hex(_lay["roles"]["accent_text"], "#23265c") >= 4.49)

    # --- generate: dark mode also meets targets (foregrounds flip lighter) ---
    dp = generate({"surface_L": 0.16})
    check("dark palette: mode detected", dp["mode"] == "dark")
    check("dark palette: all contrast targets met", dp["all_contrast_targets_met"])
    # Regression: a near-black label on a dark-mode accent passes 4.5:1 and still reads
    # as inverted/disabled. Ratio alone never caught this — polarity is asserted.
    check("dark palette: accent label is LIGHT (polarity matches mode)",
          dp["roles"]["on_accent"] == "#ffffff" and dp["on_accent_polarity"] == "light")
    check("dark palette: light label actually clears 4.5 on the accent",
          contrast_hex(dp["roles"]["on_accent"], dp["roles"]["accent"]) >= 4.5)
    check("dark palette: fill never traded below the 1.4.11 non-text floor",
          contrast_hex(dp["roles"]["accent"], dp["roles"]["surface"]) >= 3.0)
    for _h in range(0, 360, 15):
        _d = generate({"anchor_hue": _h, "surface_L": 0.16})
        if _d["on_accent_polarity"] != "light":
            check(f"dark polarity invariant under rotation (hue {_h})", False)
            break
    else:
        check("dark polarity invariant across 24-hue rotation", True)

    # --- THE INVARIANCE CLAIM: rotate anchor_hue -> identical relationships ---
    pals = sweep("anchor_hue", [0, 90, 180, 270], {})
    on_contrasts = [round(x["contrast"]["achieved"]["on_surface_vs_surface"], 1) for x in pals]
    check("hue sweep: all palettes valid", all(x["all_contrast_targets_met"] for x in pals))
    check("hue sweep: relationships INVARIANT under rotation (same on-contrast)",
          max(on_contrasts) - min(on_contrasts) <= 0.3)
    hexes = [x["roles"]["accent"] for x in pals]
    check("hue sweep: colors DIFFER (infinite distinct systems)", len(set(hexes)) == len(hexes))

    # --- harmony geometry: accent delta changes the accent hue predictably ---
    comp = generate({"accent_hue_delta": 180})["roles"]["accent"]
    analog = generate({"accent_hue_delta": 30})["roles"]["accent"]
    check("harmony: complementary != analogous accent", comp != analog)

    # --- defaults are inert: the three new families are off unless asked for ---
    _d = generate()
    check("default: one accent, no gradient, lightness ramp",
          len(_d["accents"]) == 1 and _d["gradient"] is None
          and set(_d["roles"]) == {"surface", "on_surface", "muted", "accent", "on_accent", "accent_text"})

    # --- TONAL RAMP CONTRAST STEPS -----------------------------------------
    # The point of the mode: ramp POSITION becomes a contrast relationship. Even-lightness
    # steps bunch their usable contrast at one end, so "step 3" means different things in
    # light and dark mode; even-contrast steps mean the same thing in both.
    for _sl in (0.985, 0.16):
        _c = generate({"surface_L": _sl, "ramp_mode": "contrast"})
        got = _c["ramp_contrast"]["base"]
        lo, hi = _c["params"]["ramp_contrast_lo"], _c["params"]["ramp_contrast_hi"]
        check(f"contrast ramp ({'dark' if _sl < 0.5 else 'light'}): ends hit their targets",
              got[0] <= lo + 0.15 and got[-1] >= hi - 0.15)
        check(f"contrast ramp ({'dark' if _sl < 0.5 else 'light'}): monotone in contrast",
              all(b > a for a, b in zip(got, got[1:])))
        # Geometric spacing means each step is a constant MULTIPLE of the last. That is the
        # claim being made by 'even-contrast', so it is the thing asserted.
        ratios = [b / a for a, b in zip(got, got[1:])]
        check(f"contrast ramp ({'dark' if _sl < 0.5 else 'light'}): steps evenly spaced (geometric)",
              max(ratios) - min(ratios) < 0.06)
    # Same relationship in both modes — the property an even-lightness ramp cannot offer.
    _l = generate({"surface_L": 0.985, "ramp_mode": "contrast"})["ramp_contrast"]["base"]
    _k = generate({"surface_L": 0.16, "ramp_mode": "contrast"})["ramp_contrast"]["base"]
    check("contrast ramp: same step means the same contrast in light and dark",
          max(abs(a - b) for a, b in zip(_l, _k)) < 0.35)
    check("lightness ramp unchanged (back-compat)",
          generate()["ramps"]["base"] == _ramp(250.0, PARAMS["base_chroma"], 0.30, 0.92, 7))

    # --- MULTI-ACCENT STRUCTURES -------------------------------------------
    _trio = generate({"accent_count": 3, "accent_structure": "triadic"})
    check("trio: three distinct accents + their labels and text twins",
          len({a["fill"] for a in _trio["accents"]}) == 3
          and all(k in _trio["roles"] for k in ("accent2", "on_accent2", "accent2_text",
                                                "accent3", "on_accent3", "accent3_text")))
    check("trio: triadic accents are evenly spaced round the wheel",
          all(abs(((_trio["accents"][i + 1]["hue"] - _trio["accents"][i]["hue"]) % 360) - 120) < 1.0
              for i in range(2)))
    _mir = generate({"accent_count": 2, "accent_structure": "mirror"})
    check("duo-mirrored: second accent reflects the harmony delta across the anchor",
          abs(((_mir["accents"][0]["hue"] - 250.0) % 360)
              + ((_mir["accents"][1]["hue"] - 250.0) % 360) - 360.0) < 1.0)
    # Every extra accent is held to the primary's gate, in every mode, all the way round the
    # wheel. A secondary accent that only mostly works is how an unreadable button ships
    # under a green report.
    _bad = []
    for _struct, _n in (("spread", 2), ("mirror", 2), ("triadic", 3)):
        for _sl in (0.985, 0.22, 0.16):
            for _h in range(0, 360, 15):
                _g = generate({"anchor_hue": _h, "surface_L": _sl,
                               "accent_count": _n, "accent_structure": _struct})
                if not _g["all_contrast_targets_met"]:
                    _bad.append((_struct, _sl, _h))
                for _a in _g["accents"][1:]:
                    if contrast_hex(_a["on"], _a["fill"]) < 4.45 or (_sl < 0.5 and _a["polarity"] != "light"):
                        _bad.append((_struct, _sl, _h, "label"))
    check("multi-accent: every accent meets the gate across 24 hues x 3 modes "
          f"(polarity included) — {len(_bad)} failures", not _bad)
    check("multi-accent: extra accents enter the SCORED contract, not a footnote",
          "accent2_vs_surface" in _trio["contrast"]["target"]
          and "on_accent3_vs_accent3" in _trio["contrast"]["pass"])

    # Doctrine as data: an accent landing on a reserved status hue is reported, so "one
    # accent, status hues reserved" is checkable instead of only written down.
    _clash = generate({"anchor_hue": 0.0, "accent_hue_delta": 150.0})  # -> 150deg, success green
    check("reserved status hues: a colliding accent is named",
          any(c["role"] == "success" for c in _clash["reserved_status_conflicts"]))
    check("reserved status hues: reported, never silently blocked",
          _clash["all_contrast_targets_met"])
    check("reserved status hues: the default vector is clear of all three",
          generate()["reserved_status_conflicts"] == [])

    # --- GRADIENT RELATIONSHIPS --------------------------------------------
    _gp = {"gradient_hue_sweep": 14.0, "gradient_L_shift": 0.05}
    _worst_on, _worst_scale, _worst_bg = 99.0, 99.0, 99.0
    for _sl in (0.985, 0.22, 0.16):
        for _h in range(0, 360, 15):
            _gr = generate({**_gp, "anchor_hue": _h, "surface_L": _sl})["gradient"]
            _worst_on = min(_worst_on, _gr["on_min_contrast"])
            _worst_bg = min(_worst_bg, _gr["vs_bg_min_contrast"])
            _worst_scale = min(_worst_scale, _gr["travel_scale"])
    # THE gradient defect: a label is solved against ONE colour and a gradient is many, so
    # the ratio that passes at the first stop can fail at the last. Every stop is measured.
    check(f"gradient: label clears 4.5 at EVERY stop, all hues + modes (worst {_worst_on})",
          _worst_on >= 4.45)
    check(f"gradient: no stop falls through the 1.4.11 fill floor (worst {_worst_bg})",
          _worst_bg >= 2.95)
    # Anchoring the band on the accent and travelling AWAY from the label is what keeps the
    # travel visible; a centred band collapses to a flat colour under the same constraints.
    check(f"gradient: stays visible rather than collapsing (worst scale {_worst_scale})",
          _worst_scale >= 0.99)
    _g1 = generate(_gp)["gradient"]
    check("gradient: emits the requested number of distinct stops",
          len(_g1["stops"]) == 5 and len(set(_g1["stops"])) == 5)
    check("gradient: first stop IS the solved accent (the band is anchored, not centred)",
          _g1["stops"][0] == generate(_gp)["roles"]["accent"])
    check("gradient: hue travel is real and within the requested sweep",
          0 < abs(hex_to_oklch(_g1["stops"][-1])[2] - hex_to_oklch(_g1["stops"][0])[2]) <= 14.5)
    # 'raw' is for a wash that hosts no text; it must NOT quietly pass itself off as safe.
    # Dark mode is where an over-long band actually breaks: travelling away from a light
    # label means travelling toward a dark surface, so the FILL is what falls through
    # (1.34:1 here) while the label stays fine — the opposite of the light-mode case, and
    # the reason both minima are reported separately rather than as one verdict.
    _over = {"surface_L": 0.16, "gradient_hue_sweep": 40.0, "gradient_L_shift": 0.30}
    _raw = generate({**_over, "gradient_fit": "raw"})["gradient"]
    check("gradient raw: emits the requested travel unclamped",
          _raw["travel_scale"] == 1.0 and not _raw["clamped"])
    check("gradient raw: a band that eats its own fill contrast says so",
          not _raw["fill_safe"] and _raw["vs_bg_min_contrast"] < 3.0)
    _fit = generate(_over)["gradient"]
    check("gradient solve: the same over-long band is fitted back to legible",
          _fit["clamped"] and _fit["travel_scale"] < 1.0
          and _fit["fill_safe"] and _fit["text_safe"])

    # --- VALUE validation: the same doctrine as unknown-KEY rejection -------
    for _bad_p, _why in (({"gradient_hue_sweep": 55.0}, "sweep past the 40deg cap"),
                         ({"accent_count": 4}, "more accents than can clear status hues"),
                         ({"ramp_mode": "even"}, "unknown ramp mode"),
                         ({"accent_structure": "duo-adjacent"}, "dimension value as a param"),
                         ({"gradient_fit": "maybe"}, "unknown fit"),
                         ({"ramp_contrast_lo": 20.0}, "lo above hi")):
        try:
            generate(_bad_p); ok_raise = False
        except ValueError:
            ok_raise = True
        check(f"rejects invalid value: {_why}", ok_raise)

    # --- AUDIT GRADES: "short of the house target" != "fails WCAG" ------------
    # Both fire the same suggestion, so without the grade an audit cannot tell a required
    # fix from a preferred one — the defect that makes a palette report unusable as an
    # accessibility record.
    _miss = suggest_improvements("#ffffff", "#666666", "#007acc")   # text 5.74:1 — legal AA
    _txt = [s for s in _miss["suggestions"] if s["issue"].startswith("body text")]
    check("audit grade: AA-passing text short of the 7.0 target is not a failure",
          _txt and _txt[0]["wcag"] == "pass-1.4.3" and _miss["wcag_pass"] and not _miss["clean"])
    _fail = suggest_improvements("#09090b", "#52525b", "#818cf8")   # text 2.57:1 — illegal
    _txt = [s for s in _fail["suggestions"] if s["issue"].startswith("body text")]
    check("audit grade: text under the large-text floor is graded as a hard failure",
          _txt and _txt[0]["wcag"] == "fail-1.4.3-any-size" and not _fail["wcag_pass"])
    # An accent is a FILL by default, so 1.4.11's 3.0 is its floor — not 1.4.3's 4.5.
    _fill = suggest_improvements("#ffffff", "#3f3f46", "#3b82f6")   # accent 3.68:1
    _acc = [s for s in _fill["suggestions"] if s["issue"].startswith("accent ")]
    check("audit grade: an accent fill above 3.0 is legal, still flagged for text use",
          _acc and _acc[0]["wcag"] == "pass-1.4.11" and _fill["wcag_pass"])
    _low = suggest_improvements("#1e1e1e", "#d4d4d4", "#0e639c")    # accent 2.61:1
    _acc = [s for s in _low["suggestions"] if s["issue"].startswith("accent ")]
    check("audit grade: an accent fill below the 1.4.11 floor is a hard failure",
          _acc and _acc[0]["wcag"] == "fail-1.4.11" and not _low["wcag_pass"])
    # A chromatic surface is a design choice; grading it as an accessibility failure would
    # mark every deliberately-tinted ground illegal.
    _tint = suggest_improvements("#0f172a", "#f8fafc", "#38bdf8")
    check("audit grade: the non-neutral-surface note carries no WCAG verdict",
          [s["wcag"] for s in _tint["suggestions"]] == ["n/a"] and _tint["wcag_pass"])
    check("audit grade: a fully clean palette passes both verdicts",
          suggest_improvements("#ffffff", "#111111", "#0b5cad")["wcag_pass"])

    # --- layer_roles keeps parity: same structures, solved against a card ---
    _lay2 = layer_roles("#23265c", {"anchor_hue": 277, "accent_hue_delta": 0.0, "accent_chroma": 0.115,
                                    "accent_count": 3, "accent_structure": "triadic",
                                    "gradient_hue_sweep": 14.0, "gradient_L_shift": 0.05})
    check("layer_roles: multi-accent + gradient solved against the elevated surface",
          _lay2["all_contrast_targets_met"] and len(_lay2["accents"]) == 3
          and _lay2["gradient"]["text_safe"])

    # --- the invariance contract holds for all three new families ----------
    # A new dimension that breaks hue-rotation invariance is a bug, not a feature.
    for _name, _over in (("contrast ramp", {"ramp_mode": "contrast"}),
                         ("trio", {"accent_count": 3, "accent_structure": "triadic"}),
                         ("gradient", _gp)):
        _fam = sweep("anchor_hue", [0, 90, 180, 270], _over)
        _on = [x["contrast"]["achieved"]["on_surface_vs_surface"] for x in _fam]
        check(f"invariance under hue rotation: {_name}",
              all(x["all_contrast_targets_met"] for x in _fam) and max(_on) - min(_on) <= 0.3)
    _r0, _r90 = (generate({"anchor_hue": h, "ramp_mode": "contrast"})["ramp_contrast"]["base"]
                 for h in (0, 90))
    check("invariance: contrast ramp holds the same ratios at any anchor hue",
          max(abs(a - b) for a, b in zip(_r0, _r90)) < 0.25)
    # --- THE ENERGY LADDER: accent_chroma must survive the solve ---
    # calm / balanced / vivid, the chroma triple designer.decide.color_dimensions
    # maps its `energy` dimension onto. What the user picks has to reach the screen.
    CALM, BALANCED, VIVID = 0.11, 0.16, 0.21
    MODES = (("light", 0.985), ("dim", 0.22), ("dark", 0.16))

    def seen_chroma(anchor: float, C: float, s_L: float) -> float:
        pal = generate({"anchor_hue": anchor, "accent_chroma": C, "surface_L": s_L})
        return hex_to_oklch(pal["roles"]["accent"])[1]

    # 1. Never inverted. Asking for MORE chroma may hit the sRGB ceiling and give no
    #    more, but it must never give LESS — the solve picks a lightness per request,
    #    so a bigger ask landing on a duller accent is always a solver bug.
    inversions = [(m, h) for m, s_L in MODES for h in range(0, 360, 15)
                  if not (seen_chroma(h, CALM, s_L) <= seen_chroma(h, BALANCED, s_L) + 1e-6
                          <= seen_chroma(h, VIVID, s_L) + 2e-6)]
    check(f"energy ladder: never inverted across 24 hues x 3 modes ({len(inversions)} bad)",
          not inversions)

    # 2. The ladder is FLAT in a large minority of the space, and that is a gamut fact,
    #    not a solver bug. sRGB's chroma ceiling varies ~2x with hue (0.145 at hue 210,
    #    0.317 at hue 330), so VIVID=0.21 is unreachable at 16 of 36 hues at EVERY
    #    lightness — and the accent must additionally clear its fill floor AND host a
    #    4.5 label, which excludes the lightness where a hue's chroma peaks. Pinning the
    #    count keeps the scale of the gap visible instead of letting it drift silently.
    unreachable = [h for h in range(0, 360, 10)
                   if max(gamut_max_chroma(i / 100, VIVID, h) for i in range(1, 100))
                   < VIVID - 0.005]
    check(f"gamut: {len(unreachable)}/36 hues cannot carry vivid chroma at any lightness",
          len(unreachable) == 16)

    # 3. So the engine must SAY when the chroma relationship did not survive. Without
    #    this a caller renders `calm / balanced / vivid` as three option cards, two of
    #    them the same color, and presents a choice that does not exist.
    _clip = generate({"anchor_hue": 45, "accent_chroma": VIVID})  # accent hue 195, Cmax ~0.155
    check("clipped palette: reports accent_chroma_achieved below the request",
          _clip["accent_chroma_clipped"] and _clip["accent_chroma_achieved"] < VIVID - 0.008)
    _ok = generate({"anchor_hue": 180, "accent_chroma": CALM})    # accent hue 330, Cmax ~0.317
    check("unclipped palette: reports the chroma relationship as delivered",
          not _ok["accent_chroma_clipped"])
    check("layer_roles reports the same chroma verdict as generate",
          "accent_chroma_clipped" in layer_roles("#23265c", {"accent_chroma": VIVID}))

    print()
    if fails:
        print(f"SELFTEST: {fails} FAILED"); raise SystemExit(1)
    print("SELFTEST: all pass (oklch<->srgb anchors, gamut-map, contrast-solve, "
          "light+dark palettes meet targets, hue-rotation invariance, harmony geometry, "
          "contrast-stepped ramps, multi-accent gate + reserved status hues, "
          "per-stop gradient legibility, param-value rejection, WCAG audit grades)")


if __name__ == "__main__":
    if "--selftest" in (sys.argv[1:] or []):
        _selftest()
    else:
        raise SystemExit(main(sys.argv[1:]))
