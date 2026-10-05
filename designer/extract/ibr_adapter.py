"""IBR extraction adapter — shells out to the `ibr` CLI and distills signals.

The adapter is the only layer that touches the IBR scan output. It normalises
the raw JSON into a compact `extraction_signals` dict that the rest of the
extraction pipeline (contract.py, seed.py) consumes. No host-LLM or vendor API
is called here — this is a pure data-reduction step.

Design principles
-----------------
* Never raises. Every public function returns a structured dict on all error
  paths; callers check `available` before trusting the payload.
* Defensive access: every sensor sub-object may be absent or None on a sparse
  page. Missing keys produce None/empty in the output, not exceptions.
* Neutral-color exclusion: oklch with chroma < 0.04, transparent backgrounds,
  and CSS rgb-gray values are treated as neutral and omitted from
  accent_candidates.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from typing import Any


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_neutral_color(color: str | None) -> bool:
    """Return True when *color* is a gray/transparent/neutral value.

    Neutral heuristics (deterministic):
    - None or empty string.
    - "transparent" literal.
    - "rgba(0, 0, 0, 0)" — fully transparent.
    - oklch with chroma < 0.04: matches "oklch(L C H)" where C < 0.04.
    - rgb(R, G, B) where all channels are within ±15 of each other (near-gray).
    """
    if not color:
        return True
    color = color.strip()
    if not color:
        return True
    if color.lower() == "transparent":
        return True
    if color == "rgba(0, 0, 0, 0)":
        return True

    # oklch chroma check
    oklch_m = re.match(
        r"oklch\(\s*[\d.]+\s+([\d.]+)\s+[\d.]+\s*\)", color, re.IGNORECASE
    )
    if oklch_m:
        try:
            chroma = float(oklch_m.group(1))
            return chroma < 0.04
        except ValueError:
            pass

    # rgb(R, G, B) near-gray check
    rgb_m = re.match(
        r"rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)", color, re.IGNORECASE
    )
    if rgb_m:
        try:
            r, g, b = float(rgb_m.group(1)), float(rgb_m.group(2)), float(rgb_m.group(3))
            mn, mx = min(r, g, b), max(r, g, b)
            return (mx - mn) < 15
        except ValueError:
            pass

    return False


def _dominant_typography(rows: list[dict]) -> dict:
    """Pick dominant_family, heading_weight, body_size_px, heading_size_px.

    Rules (deterministic):
    - dominant_family: family from the row with the highest `count`.
      Skip rows where family is "<unspecified>" or empty.
    - heading_weight: highest weight among rows with weight >= 600 and count >= 1.
    - body_size_px: size_px from the highest-count row with weight < 600 and
      family containing "sans-serif".
    - heading_size_px: size_px from the highest-count row with weight >= 600.
    """
    if not rows:
        return {
            "dominant_family": None,
            "heading_weight": None,
            "body_size_px": None,
            "heading_size_px": None,
        }

    # dominant_family: highest-count row with a real family name
    family: str | None = None
    top_count = -1
    for row in rows:
        f = (row.get("family") or "").strip()
        if not f or f == "<unspecified>":
            continue
        cnt = row.get("count", 0) or 0
        if cnt > top_count:
            top_count = cnt
            family = f

    # heading_weight: highest weight among rows with weight >= 600
    heading_weight: int | None = None
    for row in rows:
        w = row.get("weight")
        if w is not None and w >= 600:
            if heading_weight is None or w > heading_weight:
                heading_weight = w

    # body_size_px: highest-count row with weight < 600 and sans-serif family
    body_size: int | None = None
    body_top = -1
    for row in rows:
        w = row.get("weight") or 0
        f = (row.get("family") or "").lower()
        if w < 600 and "sans-serif" in f:
            cnt = row.get("count", 0) or 0
            if cnt > body_top:
                body_top = cnt
                body_size = row.get("size_px")

    # heading_size_px: highest-count row with weight >= 600
    heading_size: int | None = None
    heading_top = -1
    for row in rows:
        w = row.get("weight") or 0
        if w >= 600:
            cnt = row.get("count", 0) or 0
            if cnt > heading_top:
                heading_top = cnt
                heading_size = row.get("size_px")

    return {
        "dominant_family": family,
        "heading_weight": heading_weight,
        "body_size_px": body_size,
        "heading_size_px": heading_size,
    }


def _extract_accent_candidates(visual_patterns: list[dict]) -> list[str]:
    """Collect distinct non-neutral `color` values from button/link dominants."""
    seen: set[str] = set()
    result: list[str] = []
    for vp in visual_patterns:
        cat = (vp.get("category") or "").lower()
        if cat not in ("button", "link"):
            continue
        dominant = vp.get("dominant") or {}
        fp = dominant.get("styleFingerprint") or {}
        color = fp.get("color")
        if color and not _is_neutral_color(color) and color not in seen:
            seen.add(color)
            result.append(color)
    return result


def _extract_surface_bg(visual_patterns: list[dict]) -> str | None:
    """Pick the most common non-transparent background from button fingerprints."""
    for vp in visual_patterns:
        cat = (vp.get("category") or "").lower()
        if cat != "button":
            continue
        dominant = vp.get("dominant") or {}
        fp = dominant.get("styleFingerprint") or {}
        bg = fp.get("backgroundColor")
        if bg and not _is_neutral_color(bg):
            return bg
    return None


def _extract_button_fp(visual_patterns: list[dict]) -> dict:
    """Extract the dominant button fingerprint fields."""
    for vp in visual_patterns:
        cat = (vp.get("category") or "").lower()
        if cat != "button":
            continue
        dominant = vp.get("dominant") or {}
        fp = dominant.get("styleFingerprint") or {}
        return {
            "backgroundColor": fp.get("backgroundColor") or None,
            "borderRadius": fp.get("borderRadius") or None,
            "padding": fp.get("padding") or None,
            "fontWeight": fp.get("fontWeight") or None,
        }
    return {
        "backgroundColor": None,
        "borderRadius": None,
        "padding": None,
        "fontWeight": None,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

# Failure reasons that signal a browser-connection problem IBR can often recover
# from by attaching to an already-running Chrome (its own error hints at this).
_CONNECT_RETRY_HINTS = (
    "chrome debugger",
    "debugger did not respond",
    "browser-mode",
    "port",
    "econnrefused",
    "connect",
    "sandbox",
    "timed out",
    "no json output",
)


def _scan_once(ibr_bin: str, url: str, timeout_s: int, extra_args: list[str]) -> dict:
    """One `ibr scan` attempt. Returns the raw scan dict on success, or
    ``{"available": False, "reason": ...}`` on failure. Never raises."""
    try:
        result = subprocess.run(
            [ibr_bin, "scan", url, "--json", *extra_args],
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return {"available": False, "reason": f"ibr scan timed out after {timeout_s}s"}
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": f"ibr scan failed: {exc}"}

    # IBR uses a NON-ZERO exit code to signal "findings/warnings present", NOT a
    # hard failure — a good scan with valid JSON still exits 1. So we do NOT gate
    # on returncode; we parse the JSON regardless and only treat it as failed when
    # stdout carries no parseable JSON object (a crash, load timeout, or no page).
    raw = result.stdout or ""
    brace_idx = raw.find("{")
    if brace_idx == -1:
        stderr = (result.stderr or "").strip()
        reason = f"ibr exited {result.returncode} with no JSON output"
        if stderr:
            reason += f": {stderr[:200]}"
        return {"available": False, "reason": reason}

    try:
        return json.loads(raw[brace_idx:])
    except json.JSONDecodeError as exc:
        return {"available": False, "reason": f"ibr JSON parse error: {exc}"}


def run_scan(
    url: str,
    timeout_s: int = 60,
    scan_json: dict | None = None,
) -> dict:
    """Shell out to `ibr scan <url> --json` and return the parsed dict.

    On a browser-connection failure (Chrome debugger unreachable / port in use /
    sandbox), automatically retries ONCE in IBR connect mode
    (``--browser-mode connect``) — the recovery IBR's own error message suggests.
    Never raises; returns ``{"available": False, "reason": "<msg>"}`` on all error
    paths so the caller can degrade gracefully to describe-mode.

    Parameters
    ----------
    url:
        The URL to scan. Only used when *scan_json* is not provided.
    timeout_s:
        Subprocess timeout in seconds.
    scan_json:
        Optional pre-loaded scan dict (test injection; bypasses subprocess).
    """
    if scan_json is not None:
        return scan_json

    ibr_bin = shutil.which("ibr")
    if ibr_bin is None:
        return {"available": False, "reason": "ibr CLI not installed"}

    first = _scan_once(ibr_bin, url, timeout_s, [])
    if "available" not in first:  # a real scan dict (success) has no 'available' key
        return first

    reason = str(first.get("reason", "")).lower()
    if any(hint in reason for hint in _CONNECT_RETRY_HINTS):
        retry = _scan_once(ibr_bin, url, timeout_s, ["--browser-mode", "connect"])
        if "available" not in retry:
            return retry
        first["reason"] = f"{first.get('reason', '')} (connect-mode retry also failed)"
    return first


def distill_signals(scan: dict) -> dict:
    """Reduce a raw IBR scan dict into a compact extraction_signals dict.

    Parameters
    ----------
    scan:
        The raw IBR scan JSON (as returned by run_scan or loaded from fixture).
        May be empty or missing sensor sub-objects.

    Returns
    -------
    dict
        ``extraction_signals`` with keys:
        typography, color, components, motion, structure.
        Missing sensors produce None/empty values, not errors. Never raises.
    """
    sensors: dict[str, Any] = (scan.get("sensors") or {}) if isinstance(scan, dict) else {}

    # --- Typography ---
    typo_rows: list[dict] = []
    typo_raw = sensors.get("typography")
    if isinstance(typo_raw, dict):
        typo_rows = typo_raw.get("rows") or []
    typo = _dominant_typography(typo_rows)

    # --- Color ---
    contrast_raw = sensors.get("contrast")
    tone: str | None = None
    if isinstance(contrast_raw, dict):
        by_tone = contrast_raw.get("byTone") or {}
        light_on_dark = by_tone.get("lightOnDark") or 0
        dark_on_light = by_tone.get("darkOnLight") or 0
        if light_on_dark > dark_on_light:
            tone = "dark"
        elif dark_on_light > light_on_dark:
            tone = "light"
        # equal => None (ambiguous)

    visual_patterns: list[dict] = sensors.get("visualPatterns") or []
    accent_candidates = _extract_accent_candidates(visual_patterns)
    surface_bg = _extract_surface_bg(visual_patterns)

    # --- Components ---
    button_fp = _extract_button_fp(visual_patterns)

    # --- Motion ---
    motion_raw = sensors.get("motion")
    has_transitions = False
    has_keyframes = False
    reduced_motion_aware = False
    if isinstance(motion_raw, dict):
        has_transitions = bool(motion_raw.get("transitions"))
        has_keyframes = bool(motion_raw.get("keyframes"))
        reduced_motion_aware = bool(motion_raw.get("reduced_motion_overrides"))

    # --- Structure ---
    nav_landmarks = 0
    heading_levels_used = 0
    hierarchy_raw = sensors.get("hierarchy")
    if isinstance(hierarchy_raw, dict):
        landmarks = hierarchy_raw.get("landmarks") or {}
        if isinstance(landmarks, dict):
            nav_landmarks = landmarks.get("nav") or 0
        for lvl in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level_data = hierarchy_raw.get(lvl)
            if isinstance(level_data, dict) and (level_data.get("count") or 0) > 0:
                heading_levels_used += 1

    return {
        "typography": typo,
        "color": {
            "tone": tone,
            "accent_candidates": accent_candidates,
            "surface_bg": surface_bg,
        },
        "components": {
            "button": button_fp,
        },
        "motion": {
            "has_transitions": has_transitions,
            "has_keyframes": has_keyframes,
            "reduced_motion_aware": reduced_motion_aware,
        },
        "structure": {
            "nav_landmarks": nav_landmarks,
            "heading_levels_used": heading_levels_used,
        },
    }


def extract(
    url: str | None,
    scan_json: dict | None = None,
) -> dict:
    """Run the full extraction pipeline for a URL (or pre-loaded scan JSON).

    Convenience function: run_scan → distill_signals. Handles all error
    paths gracefully; never raises.

    Returns
    -------
    dict
        ``{
            "available": bool,
            "signals": dict | None,
            "warnings": [str],
            "reason": str | None,
            "raw_url": url,
        }``
        When ``available`` is True, ``signals`` is populated (possibly with
        None sub-fields when certain sensors were absent). Partial extraction
        is available=True with a warning, not a failure.
    """
    warnings: list[str] = []

    # --- Obtain scan ---
    if scan_json is not None:
        scan = scan_json
    elif url:
        scan = run_scan(url)
    else:
        return {
            "available": False,
            "signals": None,
            "warnings": [],
            "reason": "no url or scan_json provided",
            "raw_url": url,
        }

    # run_scan failure path
    if not isinstance(scan, dict):
        return {
            "available": False,
            "signals": None,
            "warnings": [],
            "reason": "scan returned non-dict",
            "raw_url": url,
        }
    if scan.get("available") is False:
        return {
            "available": False,
            "signals": None,
            "warnings": [],
            "reason": scan.get("reason", "scan failed"),
            "raw_url": url,
        }

    # --- Guard: IBR reached an ERROR / unreachable page, not the real app. ---
    # IBR cleanly flags this: semantic.state.errors.hasErrors AND
    # semantic.pageIntent.intent == "error" (e.g. Chrome's "site can't be
    # reached" / ERR_UNSAFE_PORT page). Extracting a "design system" from a
    # browser error page would seed garbage, so degrade to available=False.
    # This is a KNOWN risk (broken target) — a justified deterministic guard,
    # not a flexibility-violating threshold.
    semantic = (scan.get("semantic") or {}) if isinstance(scan, dict) else {}
    page_intent = (semantic.get("pageIntent") or {}).get("intent")
    has_errors = bool(((semantic.get("state") or {}).get("errors") or {}).get("hasErrors"))
    if page_intent == "error" and has_errors:
        return {
            "available": False,
            "signals": None,
            "warnings": warnings,
            "reason": "target is unreachable or an error page (not a live app)",
            "raw_url": url,
        }

    # --- Distill ---
    signals = distill_signals(scan)

    # --- Warn about missing sensors ---
    sensors = (scan.get("sensors") or {}) if isinstance(scan, dict) else {}
    if not sensors.get("typography"):
        warnings.append("typography sensor absent")
    if not sensors.get("contrast"):
        warnings.append("contrast sensor absent")
    if not sensors.get("visualPatterns"):
        warnings.append("visualPatterns sensor absent")
    if not sensors.get("motion"):
        warnings.append("motion sensor absent")
    if not sensors.get("hierarchy"):
        warnings.append("hierarchy sensor absent")

    # --- Guard: an extraction with ZERO usable design signal is NOT a system. ---
    # Partial extraction (some real values + some absent) is fine and stays
    # available=True with warnings. But an all-null distillation (empty/garbage
    # scan, or a scan of an unreachable/error page) must degrade to
    # available=False so the UI falls back to description-only rather than
    # seeding a phantom design system from nothing (intent: partial > nothing,
    # but never fabricate).
    if not _has_usable_signal(signals):
        return {
            "available": False,
            "signals": None,
            "warnings": warnings,
            "reason": "no usable design signal extracted (page empty, unreachable, or non-visual)",
            "raw_url": url,
        }

    return {
        "available": True,
        "signals": signals,
        "warnings": warnings,
        "reason": None,
        "raw_url": url,
    }


def _has_usable_signal(signals: dict) -> bool:
    """True when the distilled signals carry at least one real design value.

    A value counts as usable if any of: a color tone, an accent candidate, a
    dominant type family or heading weight, a button background/radius, or any
    motion/structure positive. All-null/empty distillation → False.
    """
    color = signals.get("color") or {}
    if color.get("tone") or color.get("accent_candidates") or color.get("surface_bg"):
        return True
    typo = signals.get("typography") or {}
    if typo.get("dominant_family") or typo.get("heading_weight") or typo.get("body_size_px"):
        return True
    button = (signals.get("components") or {}).get("button") or {}
    if button.get("backgroundColor") or button.get("borderRadius") or button.get("fontWeight"):
        return True
    motion = signals.get("motion") or {}
    if motion.get("has_transitions") or motion.get("has_keyframes") or motion.get("reduced_motion_aware"):
        return True
    structure = signals.get("structure") or {}
    if (structure.get("nav_landmarks") or 0) > 0 or (structure.get("heading_levels_used") or 0) > 0:
        return True
    return False
