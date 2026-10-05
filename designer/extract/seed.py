"""Seed applier — maps extraction contract answers onto TasteState.

Two entry points:
  apply_extraction — host-LLM path: apply a validated contract answer dict.
  auto_seed        — deterministic fallback: map signals directly, no host LLM.

Both return a summary dict describing what was seeded, matching the shape:
  {
    "seeded": [{"category_id", "dimension", "option_id", "source": "extract"}],
    "skipped": [{"category_id", "reason"}],
    "summary": {"accent": str|None, "type": str|None,
                "density": str|None, "components": str|None},
  }

On validation errors, apply_extraction returns {"seeded": [], "errors": [...]}
and leaves the state unchanged (degraded, never raises).

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from ..engine.catalog_loader import Catalog
    from ..engine.state import TasteState

from .contract import validate_extraction_answer


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _human_summary(state: "TasteState") -> dict[str, str | None]:
    """Build a human-readable "here's your current system" summary from state."""
    overrides = state.overrides or {}

    accent = (overrides.get("color") or {}).get("accent")
    surface = (overrides.get("color") or {}).get("surface")

    typo_group = overrides.get("typography") or {}
    type_str: str | None = None
    if typo_group.get("fontFamily"):
        type_str = f"family={typo_group['fontFamily'][:50]}"
    elif typo_group.get("headingWeight"):
        type_str = f"weight={typo_group['headingWeight']}"

    density = (overrides.get("spacing") or {}).get("density")

    button_shape = (overrides.get("components") or {}).get("buttonShape")
    elevation = (overrides.get("elevation") or {}).get("style")
    comp_str: str | None = button_shape or elevation

    return {
        "accent": accent,
        "surface": surface,
        "type": type_str,
        "density": density,
        "components": comp_str,
    }


# ---------------------------------------------------------------------------
# Host-LLM path
# ---------------------------------------------------------------------------

def apply_extraction(
    state: "TasteState",
    contract_answer: dict[str, Any],
    catalog: "Catalog",
) -> dict[str, Any]:
    """Apply a host-LLM-filled extraction contract to *state*.

    Parameters
    ----------
    state:
        The TasteState to mutate. Modified in-place via state.apply_pick.
    contract_answer:
        The FULL filled contract dict (as returned by contract.read_contract
        after the host LLM fills it). Contains ``answer.mappings``.
    catalog:
        The loaded design catalog.

    Returns
    -------
    dict
        Summary with "seeded", "skipped", "summary" on success.
        ``{"seeded": [], "errors": [...]}`` when validation fails (state
        unchanged).
    """
    errors = validate_extraction_answer(contract_answer)
    if errors:
        return {"seeded": [], "errors": errors}

    mappings = (contract_answer.get("answer") or {}).get("mappings") or []
    opts_by_id = catalog.options_by_id()
    cat_by_id = catalog.by_id()

    seeded: list[dict] = []
    skipped: list[dict] = []

    for mapping in mappings:
        if not isinstance(mapping, dict):
            continue

        cid = mapping.get("category_id")
        if not cid:
            continue

        cat = cat_by_id.get(cid)
        if cat is None:
            skipped.append({"category_id": cid, "reason": "category not in catalog"})
            continue

        opt_id = mapping.get("option_id")
        raw_delta = mapping.get("token_delta")

        # Resolve token_delta
        if opt_id is not None:
            opt = opts_by_id.get(opt_id)
            if opt is None:
                skipped.append({
                    "category_id": cid,
                    "reason": f"option_id {opt_id!r} not found in catalog",
                })
                continue
            token_delta = opt.token_delta
            effective_opt_id = opt_id
        elif raw_delta:
            token_delta = raw_delta
            effective_opt_id = "extract"
        else:
            skipped.append({
                "category_id": cid,
                "reason": "no option_id or token_delta provided",
            })
            continue

        state.apply_pick(cid, effective_opt_id, token_delta, source="extract")
        seeded.append({
            "category_id": cid,
            "dimension": cat.dimension,
            "option_id": effective_opt_id,
            "source": "extract",
        })

    return {
        "seeded": seeded,
        "skipped": skipped,
        "summary": _human_summary(state),
    }


# ---------------------------------------------------------------------------
# Deterministic fallback / headless path
# ---------------------------------------------------------------------------

# Mapping from tone signal -> (category_id, option_id)
_TONE_TO_DARK_MODE: dict[str, tuple[str, str]] = {
    "dark": ("color-dark-mode", "dark-elevated-layers"),
    "light": ("color-dark-mode", "dark-true-black"),  # default when light (least opinionated)
}

# Accent candidate heuristic: if we have a non-neutral accent, map to the
# "accent-expressive" or "accent-semantic" option depending on chroma signals.
# We use "accent-semantic" as a safe default and "accent-expressive" for vivid
# non-near-neutral colors with high inferred chroma.
_ACCENT_OPTION_DEFAULT = "accent-semantic"

# heading_weight -> option_id
_HEADING_WEIGHT_OPTIONS: list[tuple[int, str]] = [
    (800, "type-weight-contrast"),   # weight >= 800
    (700, "type-tight-tracking"),    # weight >= 700
    (600, "type-sf-system"),         # weight >= 600 (SF Pro default weight)
]

# button border-radius heuristics: empty/None → flat, "pill" shapes → pill
_BUTTON_RADIUS_TO_OPTION: list[tuple[str, str]] = [
    ("50%", "toggle-segmented-pill"),
    ("9999", "toggle-segmented-pill"),
    ("px", "btn-flat"),
    ("rem", "btn-soft-shadow"),
]

# motion signals
_MOTION_CATEGORY_MAP = {
    "has_transitions": ("page-transition", "transition-fade"),
    "has_keyframes": ("loading-state", "skeleton-shimmer-ltr"),
    "reduced_motion_aware": ("pull-refresh", "ptr-native-spinner"),
}


def auto_seed(
    state: "TasteState",
    signals: dict,
    catalog: "Catalog",
) -> dict[str, Any]:
    """Deterministic fallback mapper — no host LLM required.

    Applies derivation rules directly from the distilled signals dict and
    seeds the state. Rules are deterministic given identical inputs.

    Parameters
    ----------
    state:
        The TasteState to mutate in-place.
    signals:
        The ``extraction_signals`` dict from ibr_adapter.distill_signals.
    catalog:
        The loaded design catalog.

    Returns
    -------
    dict
        Summary with "seeded", "skipped", "summary".
        Empty "seeded" only when no signal maps to a catalog option
        (degenerate case — should not occur with a valid fixture).
    """
    cat_by_id = catalog.by_id()
    opts_by_id = catalog.options_by_id()
    seeded: list[dict] = []
    skipped: list[dict] = []

    def _apply(cid: str, oid: str, reason: str, value_delta: dict | None = None) -> None:
        """Seed a dimension.

        ``value_delta`` (optional) lets a MEASURED value override the catalog
        option's preset. Extraction is measurement, not a curated pick: when we
        read a real accent color or heading weight off the page, we keep that
        exact value rather than snapping to the nearest catalog preset (which
        would silently rewrite a purple app's accent to the default blue). The
        catalog option is still recorded so the dimension reads as "determined"
        and the walk surfaces it for confirm/evolve. The user can still override.
        """
        cat = cat_by_id.get(cid)
        opt = opts_by_id.get(oid)
        if cat is None or opt is None:
            skipped.append({"category_id": cid, "reason": f"catalog miss: {reason}"})
            return
        token_delta = opt.token_delta
        if value_delta:
            # Deep-overlay the measured value(s) onto the option's preset delta.
            token_delta = {**token_delta}
            for group, keys in value_delta.items():
                token_delta[group] = {**token_delta.get(group, {}), **keys}
        state.apply_pick(cid, oid, token_delta, source="extract")
        seeded.append({
            "category_id": cid,
            "dimension": cat.dimension,
            "option_id": oid,
            "source": "extract",
        })

    color = signals.get("color") or {}
    tone = color.get("tone")
    accent_candidates = color.get("accent_candidates") or []

    typo = signals.get("typography") or {}
    heading_weight = typo.get("heading_weight")

    motion = signals.get("motion") or {}
    components = signals.get("components") or {}
    button = components.get("button") or {}

    # 1. Color dark-mode / surface
    if tone in _TONE_TO_DARK_MODE:
        cid, oid = _TONE_TO_DARK_MODE[tone]
        _apply(cid, oid, f"tone={tone}")

    # 2. Accent system — keep the MEASURED accent color, not a catalog preset.
    if accent_candidates:
        measured_accent = accent_candidates[0]
        _apply("color-accent-system", _ACCENT_OPTION_DEFAULT,
               f"accent_candidate={measured_accent[:40]}",
               value_delta={"color": {"accent": measured_accent}})

    # 3. Typography heading style — record the option for the walk, but overlay
    #    the MEASURED weight (and family, if read) so the emitted system reflects
    #    the real type, not the preset weight.
    if heading_weight is not None:
        chosen_oid = "type-sf-system"  # fallback
        for threshold, oid in _HEADING_WEIGHT_OPTIONS:
            if heading_weight >= threshold:
                chosen_oid = oid
                break
        type_value: dict[str, Any] = {"headingWeight": heading_weight}
        fam = typo.get("dominant_family")
        if fam:
            type_value["fontFamily"] = fam
        _apply("type-heading-style", chosen_oid, f"heading_weight={heading_weight}",
               value_delta={"typography": type_value})

    # 4. Button shadow/micro-toggle — only from POSITIVE button evidence.
    #    Seed a button treatment when we read a real radius OR a real background
    #    (a button the page actually styles). Never seed a "flat" default from
    #    the absence of evidence — that would fabricate a system (intent: never
    #    seed from nothing; leave it undetermined for the walk).
    border_radius = (button.get("borderRadius") or "").lower()
    has_button_evidence = bool(border_radius) or bool(button.get("backgroundColor"))
    if has_button_evidence:
        btn_oid = "btn-flat"  # default when a button exists but radius is square/empty
        for radius_hint, oid in _BUTTON_RADIUS_TO_OPTION:
            if radius_hint in border_radius:
                btn_oid = oid
                break
        _apply("button-shadow", btn_oid,
               f"borderRadius={border_radius[:30] or 'square'}, bg={button.get('backgroundColor')}")

    # 5. Motion categories
    if motion.get("has_transitions"):
        _apply("page-transition", "transition-fade", "has_transitions=True")

    if motion.get("has_keyframes"):
        _apply("loading-state", "skeleton-shimmer-ltr", "has_keyframes=True")

    if motion.get("reduced_motion_aware"):
        _apply("pull-refresh", "ptr-native-spinner", "reduced_motion_aware=True")

    return {
        "seeded": seeded,
        "skipped": skipped,
        "summary": _human_summary(state),
    }
