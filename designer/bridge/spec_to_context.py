"""spec_to_context — map a groundwork Spec into the Designer engine's context dict.

The Designer engine ranks its design decisions with an information-gain heuristic
(`designer/engine/contract.py::information_gain`) that scans a flat
``TasteState.context`` dict — ``{description, audience, density, mood}`` — for
keyword signals. This module is the one-way bridge that reads a validated
groundwork ``Spec`` (the zod schema in ``engine/src/spec.ts``) and produces that
context dict so a design walk can be seeded from the product spec instead of a
hand-typed sentence.

Mapping (Spec field -> context key)
-----------------------------------
    productDescription            -> description   (falls back to productName)
    personas[].{name,trigger,
               jobs,exclusions}   -> audience      (who the product is for)
    density | screens[]           -> density       (explicit field, else inferred)
    voiceProfile{principles,
        doWords} | brandAdjectives-> mood          (emotional / brand register)

Every mapping degrades gracefully: a missing optional field simply omits its
context key rather than emitting an empty/None value (the engine's keyword scan
tolerates absent keys). ``description`` is always present (possibly "").

Usage
-----
    python3 designer/bridge/spec_to_context.py path/to/spec.json   # file arg
    cat spec.json | python3 designer/bridge/spec_to_context.py -    # stdin
    python3 designer/bridge/spec_to_context.py                      # stdin

Prints the context dict as pretty JSON to stdout.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

# Density keywords the engine's _CONTEXT_BOOSTS actually rewards. Kept here so the
# inference below only ever emits a value the heuristic can act on.
_DENSE_WORDS = ("dense", "compact", "data", "pro-tool", "professional")
_SPARSE_WORDS = ("glanceable", "glance", "sparse", "minimal", "spacious", "simple")


def build_context(spec: dict[str, Any]) -> dict[str, Any]:
    """Map a groundwork Spec dict to the Designer engine ``context`` dict.

    Parameters
    ----------
    spec : dict
        A parsed groundwork Spec (conforming to ``SpecSchema``). Missing
        optional fields are handled gracefully.

    Returns
    -------
    dict
        ``{description, audience?, density?, mood?}`` — ``description`` is always
        present (possibly empty); the other keys are omitted when the spec
        carries no signal for them, since the engine scans only the keys present.
    """
    if not isinstance(spec, dict):
        spec = {}

    context: dict[str, Any] = {"description": _description(spec)}

    audience = _audience(spec)
    if audience:
        context["audience"] = audience

    density = _density(spec)
    if density:
        context["density"] = density

    mood = _mood(spec)
    if mood:
        context["mood"] = mood

    return context


# ---------------------------------------------------------------------------
# Per-field mappers
# ---------------------------------------------------------------------------

def _description(spec: dict[str, Any]) -> str:
    """productDescription -> description (fall back to productName, else "")."""
    for key in ("productDescription", "productName"):
        v = spec.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _audience(spec: dict[str, Any]) -> str:
    """personas[] -> a single audience phrase.

    Joins each persona's name, trigger (their situation/"who they are"), and top
    jobs into one string. Exclusions ("who they are NOT") are appended so the
    heuristic sees the full audience shape. Empty personas -> "".
    """
    personas = spec.get("personas")
    if not isinstance(personas, list):
        return ""

    fragments: list[str] = []
    for p in personas:
        if not isinstance(p, dict):
            continue
        bits: list[str] = []
        name = p.get("name")
        if isinstance(name, str) and name.strip():
            bits.append(name.strip())
        trigger = p.get("trigger")
        if isinstance(trigger, str) and trigger.strip():
            bits.append(trigger.strip())
        for list_key in ("jobs", "exclusions"):
            vals = p.get(list_key)
            if isinstance(vals, list):
                bits.extend(str(x).strip() for x in vals if str(x).strip())
        if bits:
            fragments.append(". ".join(bits))
    return " | ".join(fragments)


def _density(spec: dict[str, Any]) -> str:
    """density field if present, else infer from screens[].

    Resolution order:
      1. An explicit density-like field (``density`` / ``informationDensity`` /
         ``uiDensity``) — used verbatim (lowercased).
      2. A glanceable/sparse signal in voiceProfile.principles -> "spacious".
      3. Screen complexity: many screens or many total states -> "dense",
         otherwise "spacious".

    Returns "" only if the spec has neither an explicit field nor any screens.
    """
    ui_preferences = spec.get("uiPreferences")
    if isinstance(ui_preferences, dict):
        explicit = ui_preferences.get("informationDensity")
        if isinstance(explicit, str) and explicit.strip():
            return explicit.strip().lower()

    for key in ("density", "informationDensity", "uiDensity"):
        v = spec.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip().lower()

    voice = spec.get("voiceProfile")
    if isinstance(voice, dict):
        blob = " ".join(str(x) for x in (voice.get("principles") or [])).lower()
        if any(w in blob for w in _SPARSE_WORDS):
            return "spacious"

    screens = spec.get("screens")
    if not isinstance(screens, list) or not screens:
        return ""

    n_screens = len(screens)
    total_states = sum(
        len(s.get("states") or [])
        for s in screens
        if isinstance(s, dict) and isinstance(s.get("states"), list)
    )
    if n_screens >= 5 or total_states >= 12:
        return "dense"
    return "spacious"


def _mood(spec: dict[str, Any]) -> str:
    """brand adjectives + voiceProfile -> mood (emotional / brand register).

    Prefers an explicit brand-adjectives field if one exists, then folds in the
    voiceProfile principles and doWords. Returns "" when the spec carries no
    voice/brand signal.
    """
    parts: list[str] = []

    ui_preferences = spec.get("uiPreferences")
    if isinstance(ui_preferences, dict):
        values = ui_preferences.get("brandAdjectives")
        if isinstance(values, list):
            parts.extend(str(x).strip() for x in values if str(x).strip())

    for key in ("brandAdjectives", "brand", "adjectives"):
        v = spec.get(key)
        if isinstance(v, list):
            parts.extend(str(x).strip() for x in v if str(x).strip())
        elif isinstance(v, str) and v.strip():
            parts.append(v.strip())

    voice = spec.get("voiceProfile")
    if isinstance(voice, dict):
        for list_key in ("principles", "doWords"):
            vals = voice.get(list_key)
            if isinstance(vals, list):
                parts.extend(str(x).strip() for x in vals if str(x).strip())

    return ", ".join(parts)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _read_spec(path: str | None) -> dict[str, Any]:
    if path and path != "-":
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    data = sys.stdin.read()
    return json.loads(data) if data.strip() else {}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="spec_to_context",
        description="Map a groundwork Spec JSON to the Designer engine context dict.",
    )
    parser.add_argument(
        "spec",
        nargs="?",
        default=None,
        help="Path to a Spec JSON file. Omit or pass '-' to read from stdin.",
    )
    args = parser.parse_args(argv)

    spec = _read_spec(args.spec)
    context = build_context(spec)
    json.dump(context, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
