"""Groundwork — color-decision engine (decide × color bridge).

WHAT:  turns COLOR into a set of *relationship* dimensions the Bayesian
       elicitation engine (`designer.decide.elicit`) drives by information gain,
       and maps the converged answers onto a `designer.color.relationships`
       params vector that GENERATES a contrast-verified, gamut-safe palette.

WHY:   before this, the flow had the agent hand-write a color params dict. That
       is the "capability without activation" gap: the relationships engine
       existed but no decision process reached it. Here the engine ASKS the
       highest-information-gain color question, the host phrases it, the user
       picks a concrete relationship (shown as real swatches), and the palette
       is an OUTPUT of the relationships — never hand-picked hex.

MODEL: a palette lives in RELATIONSHIPS, not colors (Ottosson OKLCH; a hue
       rotation preserves every relationship). So the dimensions are
       relationship knobs — temperature, energy, harmony, contrast feel, accent
       intensity, mode — each a categorical choice mapping to `relationships`
       PARAMS. Elicit picks WHICH to ask (EIG); this module maps answers -> params.

Self-test:  python3 -m designer.decide.color_dimensions --selftest
CLI relay:  init | ask | answer | emit  (JSON in/out, mirrors elicit.py's style)
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Optional

from . import elicit
from ..color import relationships as rel

SCHEMA = "groundwork.decide.color-session/v1"

# ---------------------------------------------------------------------------
# The color RELATIONSHIP dimensions.
#
# Each dimension:
#   importance : leverage weight (how much of the visual system it governs).
#   default    : the value assumed when the dim is never asked (k-sparse: only
#                3-5 of these get a question before the gate converges).
#   values     : ordered categorical candidates -> the elicit belief vector.
#   patch(v)   : the PARTIAL relationships-PARAMS delta a chosen value implies.
#
# The value -> params maps are intentionally coarse-but-solvable: every value in
# every dimension composes into a palette that meets its contrast targets in
# BOTH light and dark mode (asserted by the self-test). The contrast RELATION is
# solved by relationships.generate(); these knobs only set the *targets* and the
# hue/chroma STRUCTURE, never raw lightnesses.
# ---------------------------------------------------------------------------

# anchor hue by temperature family (deg on the OKLCH hue circle)
_TEMP_HUE = {
    "cool": 250.0,      # blue/indigo
    "fresh": 160.0,     # teal/green
    "warm": 40.0,       # amber/orange
    "bold": 330.0,      # magenta/pink
    "neutral": 250.0,   # cool-leaning gray system (low chroma carries it)
}

# accent hue delta by harmony relationship (deg from anchor)
_HARMONY_DELTA = {
    "analogous": 35.0,
    "split-complementary": 150.0,
    "complementary": 180.0,
    "triadic": 120.0,
}

# (base_chroma, accent_chroma) by energy
_ENERGY_CHROMA = {
    "calm": (0.035, 0.11),
    "balanced": (0.06, 0.16),
    "vivid": (0.09, 0.21),
}

# (on_surface_contrast, muted_contrast) by contrast feel
_CONTRAST_FEEL = {
    "soft": (8.5, 4.6),      # gentler body text; still AAA-ish, muted stays AA
    "standard": (12.0, 4.6),
    "crisp": (15.5, 5.5),    # maximum legibility
}

# (accent_contrast, accent_chroma nudge) by accent intensity
_ACCENT_INTENSITY = {
    "subtle": (3.2, -0.03),   # quiet accent (below AA-text; for large UI only)
    "clear": (4.5, 0.0),      # AA for UI + small text on-accent
    "bold": (6.0, 0.02),      # loud, high-contrast accent
}

# surface lightness by mode
_MODE_SURFACE_L = {
    "light": 0.985,
    "dim": 0.22,
    "dark": 0.16,
}

# ramp_mode by how tonal steps should be SPACED
_RAMP_SHAPE = {
    "even-tone": "lightness",     # equal perceptual lightness steps
    "even-contrast": "contrast",  # equal contrast steps vs the surface (each one solved)
}

# (accent_count, accent_structure) by accent plan. The dimension is named `accent_plan`,
# not `accent_structure`, deliberately: dimension names and PARAMS names are separate
# namespaces, and generate() can only catch a dimension leaking into a params dict while
# the two sets stay disjoint.
_ACCENT_PLAN = {
    "single": (1, "spread"),
    "duo-adjacent": (2, "spread"),
    "duo-mirrored": (2, "mirror"),
    "trio": (3, "triadic"),
}

# (gradient_hue_sweep, gradient_L_shift) by gradient appetite. Hue travel is the axis a
# person actually reads as "a gradient"; lightness travel is the axis that SPENDS label
# contrast. So expressive buys its presence mostly in hue (30deg, near the 40deg cap) and
# stays modest in lightness — which is why it fits unclamped across most of the wheel.
_GRADIENT = {
    "none": (0.0, 0.0),
    "subtle": (14.0, 0.05),
    "expressive": (30.0, 0.06),
}


def _patch_temperature(v: str) -> dict[str, Any]:
    hue = _TEMP_HUE.get(v, _TEMP_HUE["cool"])
    # neutral system: near-zero chroma neutrals, faint tint toward anchor
    if v == "neutral":
        return {"anchor_hue": hue, "neutral_chroma": 0.006, "neutral_hue_delta": 0.0}
    return {"anchor_hue": hue, "neutral_chroma": 0.012, "neutral_hue_delta": 0.0}


def _patch_harmony(v: str) -> dict[str, Any]:
    return {"accent_hue_delta": _HARMONY_DELTA.get(v, 150.0)}


def _patch_energy(v: str) -> dict[str, Any]:
    base_c, acc_c = _ENERGY_CHROMA.get(v, _ENERGY_CHROMA["balanced"])
    return {"base_chroma": base_c, "accent_chroma": acc_c}


def _patch_contrast_feel(v: str) -> dict[str, Any]:
    on_c, mut_c = _CONTRAST_FEEL.get(v, _CONTRAST_FEEL["standard"])
    return {"on_surface_contrast": on_c, "muted_contrast": mut_c}


def _patch_accent_intensity(v: str) -> dict[str, Any]:
    acc_contrast, chroma_nudge = _ACCENT_INTENSITY.get(v, _ACCENT_INTENSITY["clear"])
    return {"accent_contrast": acc_contrast, "_accent_chroma_nudge": chroma_nudge}


def _patch_mode(v: str) -> dict[str, Any]:
    return {"surface_L": _MODE_SURFACE_L.get(v, 0.985)}


def _patch_ramp_shape(v: str) -> dict[str, Any]:
    return {"ramp_mode": _RAMP_SHAPE.get(v, "lightness")}


def _patch_accent_plan(v: str) -> dict[str, Any]:
    count, structure = _ACCENT_PLAN.get(v, _ACCENT_PLAN["single"])
    return {"accent_count": count, "accent_structure": structure}


def _patch_gradient(v: str) -> dict[str, Any]:
    sweep, shift = _GRADIENT.get(v, _GRADIENT["none"])
    return {"gradient_hue_sweep": sweep, "gradient_L_shift": shift}


# dim name -> (importance, default value, [values], patch fn)
DIMENSIONS: dict[str, dict[str, Any]] = {
    "temperature": {
        "importance": 0.9, "default": "cool",
        "values": ["cool", "fresh", "warm", "bold", "neutral"],
        "patch": _patch_temperature,
        "ask": "What temperature should the system feel — {values}?",
    },
    "energy": {
        "importance": 0.8, "default": "balanced",
        "values": ["calm", "balanced", "vivid"],
        "patch": _patch_energy,
        "ask": "How energetic should the color be — {values}?",
    },
    "harmony": {
        "importance": 0.7, "default": "split-complementary",
        "values": ["analogous", "split-complementary", "complementary", "triadic"],
        "patch": _patch_harmony,
        "ask": "How should the accent relate to the base hue — {values}?",
    },
    "contrast_feel": {
        "importance": 0.75, "default": "standard",
        "values": ["soft", "standard", "crisp"],
        "patch": _patch_contrast_feel,
        "ask": "How much text contrast — {values}?",
    },
    "accent_intensity": {
        "importance": 0.6, "default": "clear",
        "values": ["subtle", "clear", "bold"],
        "patch": _patch_accent_intensity,
        "ask": "How loud should the accent be — {values}?",
    },
    "mode": {
        "importance": 0.85, "default": "light",
        "values": ["light", "dim", "dark"],
        "patch": _patch_mode,
        "ask": "Light or dark surface — {values}?",
    },
    # The three structural dimensions below sit BELOW the six above on importance on
    # purpose. They shape more of the system than they decide about it: a product needs a
    # temperature and a mode, and only some products need a second accent or a gradient.
    # Ranked lower, k-sparse elicitation reaches them only once the load-bearing choices
    # are settled — which is the right order to ask them in anyway.
    "accent_plan": {
        "importance": 0.5, "default": "single",
        "values": ["single", "duo-adjacent", "duo-mirrored", "trio"],
        "patch": _patch_accent_plan,
        "ask": "How many accents, and how should they relate — {values}?",
    },
    "ramp_shape": {
        "importance": 0.45, "default": "even-tone",
        "values": ["even-tone", "even-contrast"],
        "patch": _patch_ramp_shape,
        "ask": "How should tonal steps be spaced — {values}?",
    },
    "gradient": {
        "importance": 0.35, "default": "none",
        "values": ["none", "subtle", "expressive"],
        "patch": _patch_gradient,
        "ask": "Should the accent carry a gradient — {values}?",
    },
}


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

def color_session(goal: str, mode: Optional[str] = None,
                  decided: Optional[dict[str, str]] = None) -> dict[str, Any]:
    """Create an elicit session over the color relationship dimensions.

    `mode` (light|dim|dark), when the user already stated it, is recorded as a
    DECIDED answer so the engine never spends a question on it. `decided` may pin
    any other dimension the same way (e.g. a brand temperature). The rest are
    left OPEN for information-gain elicitation.
    """
    dims = {
        name: {"importance": spec["importance"], "values": list(spec["values"])}
        for name, spec in DIMENSIONS.items()
    }
    session = elicit.new_session(goal=goal, dimensions=dims, decision_type="choice")
    session["schema"] = SCHEMA
    pins = dict(decided or {})
    if mode:
        pins.setdefault("mode", mode)
    for d, v in pins.items():
        if d in DIMENSIONS and v in DIMENSIONS[d]["values"]:
            elicit.answer(session, d, v, decided=True, note="stated up front")
    return session


def _current_value(session: dict[str, Any], name: str) -> str:
    """The value in effect for `name`: the recorded answer, else the belief
    argmax if the dim was touched, else the dimension default."""
    st = session["dimensions"].get(name, {})
    if st.get("value") is not None:
        return st["value"]
    if isinstance(st.get("belief"), list):
        vals = st.get("values") or DIMENSIONS[name]["values"]
        b = elicit.belief(st)
        return vals[max(range(len(b)), key=lambda i: b[i])]
    return DIMENSIONS[name]["default"]


def _session_values(session: dict[str, Any]) -> dict[str, str]:
    """The value in effect for every dimension (answer, else belief argmax,
    else default)."""
    return {name: _current_value(session, name) for name in DIMENSIONS}


def _params_from_values(values: dict[str, str]) -> dict[str, Any]:
    """Compose one relationships-PARAMS vector from a full dim->value map.
    Resolves the accent_chroma nudge exactly once (accent_intensity trims or
    loudens the chroma energy set), so composing is idempotent and override-safe.
    """
    params: dict[str, Any] = {}
    for name in DIMENSIONS:
        params.update(DIMENSIONS[name]["patch"](values[name]))
    nudge = params.pop("_accent_chroma_nudge", 0.0)
    params["accent_chroma"] = max(0.02, params.get("accent_chroma", rel.PARAMS["accent_chroma"]) + nudge)
    return params


def params_from_session(session: dict[str, Any]) -> dict[str, Any]:
    """Compose the full relationships-PARAMS vector from the session's current
    per-dimension values. Unanswered dimensions use their default value."""
    return _params_from_values(_session_values(session))


def generate_from_session(session: dict[str, Any]) -> dict[str, Any]:
    """The palette the session currently implies + the params + open dims."""
    params = params_from_session(session)
    palette = rel.generate(params)
    palette["decided"] = {n: _current_value(session, n) for n in DIMENSIONS}
    palette["open_dims"] = [n for n, st in session["dimensions"].items()
                            if not st["excluded"]]
    return palette


# ---------------------------------------------------------------------------
# The next question, as concrete option previews (real swatches, not words)
# ---------------------------------------------------------------------------

def is_valid_answer(dim: str, value: Any) -> bool:
    """True iff `dim` is a real color dimension and `value` one of its candidates.
    Guards the answer path: elicit.answer would otherwise auto-create an unknown
    dim with placeholder values (deadlocking the loop), and the patch fns would
    silently substitute a default for an unknown value (committing something the
    user did not pick)."""
    spec = DIMENSIONS.get(dim)
    return spec is not None and value in spec["values"]


def option_previews(session: dict[str, Any], dim: Optional[str] = None,
                    max_options: Optional[int] = None) -> Optional[dict[str, Any]]:
    """For the next (or given) dimension, return EVERY candidate value as a
    concrete PREVIEW palette — the roles that result if the user picks it, with
    all other dimensions held at their current values. This is what lets the
    flow show option cards, not an open-ended question.

    `max_options` (default None) shows all values; a cap is honored but the
    PAPRIKA fork is then computed ONLY over the shown subset, so the fast A/B
    fork can never name a value that has no option card.

    Each option carries `clipped`: True when sRGB can't carry the requested
    accent chroma at the solved lightness, so its accent swatch is visually the
    same as a lower-energy value's — the flow should not present those as a
    meaningful choice.
    """
    dim = dim or elicit.next_question(session)
    if dim is None:
        return None
    spec = DIMENSIONS.get(dim)
    if spec is None:
        return None
    all_values = list(spec["values"])
    values = all_values[:max_options] if max_options else all_values
    base_values = _session_values(session)
    options = []
    for v in values:
        # params as if THIS value were chosen, every other dimension held —
        # a clean single override, so no knob is double-applied.
        params = _params_from_values({**base_values, dim: v})
        pal = rel.generate(params)
        req_c = params["accent_chroma"]
        got_c = rel.hex_to_oklch(pal["roles"]["accent"])[1]
        options.append({
            "value": v,
            "roles": pal["roles"],
            "mode": pal["mode"],
            "all_contrast_targets_met": pal["all_contrast_targets_met"],
            "clipped": got_c < req_c - 0.008,
            # Without these two, every `gradient` option card renders as the same flat
            # swatch and every `accent_plan` card hides the accents it added — the person
            # would be choosing from the adjective after all, which is the one thing the
            # preview exists to prevent.
            "gradient": pal["gradient"],
            "reserved_status_conflicts": pal["reserved_status_conflicts"],
        })
    pair = elicit.paprika_pair(session, dim)
    fork = None
    if pair is not None and len(values) > 2 and pair[0] in values and pair[1] in values:
        fork = {"a": pair[0], "b": pair[1]}
    return {
        "dim": dim,
        "prompt": spec["ask"].format(values=" / ".join(all_values)),
        "options": options,
        "fork": fork,
    }


# ---------------------------------------------------------------------------
# CLI relay  (init | ask | answer | emit) — JSON in/out, elicit.py style
# ---------------------------------------------------------------------------

def _emit(obj: Any) -> None:
    json.dump(obj, sys.stdout, indent=2, sort_keys=False)
    sys.stdout.write("\n")


def _load(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _save(path: str, session: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(session, f, indent=2, sort_keys=False)
        f.write("\n")


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="designer.decide.color_dimensions",
                                 description=__doc__)
    ap.add_argument("--selftest", action="store_true")
    sub = ap.add_subparsers(dest="cmd")

    p_init = sub.add_parser("init", help="create a color-decision session")
    p_init.add_argument("--goal", required=True)
    p_init.add_argument("--mode", default=None, choices=list(_MODE_SURFACE_L))
    p_init.add_argument("--decided", default=None,
                        help='JSON {dim: value} to pin up front')
    p_init.add_argument("--out", required=True)

    p_ask = sub.add_parser("ask", help="next question as option previews + ready flag")
    p_ask.add_argument("--session", required=True)

    p_ans = sub.add_parser("answer", help="record an answer, print updated status")
    p_ans.add_argument("--session", required=True)
    p_ans.add_argument("--dim", required=True)
    p_ans.add_argument("--value", required=True)
    p_ans.add_argument("--decided", action="store_true", help="pin (user committed)")
    p_ans.add_argument("--rating", type=float, default=None)

    p_emit = sub.add_parser("emit", help="final palette + params from the session")
    p_emit.add_argument("--session", required=True)

    args = ap.parse_args(argv)

    if args.selftest:
        _selftest()
        return 0

    if args.cmd == "init":
        decided = json.loads(args.decided) if args.decided else None
        session = color_session(args.goal, mode=args.mode, decided=decided)
        _save(args.out, session)
        _emit({"session": args.out, "status": elicit.status(session)})
        return 0

    if args.cmd == "ask":
        session = _load(args.session)
        st = elicit.status(session)
        prev = option_previews(session) if not st["ready"] else None
        _emit({"ready": st["ready"], "confidence": st["confidence"],
               "info_gain": st["info_gain"], "question": prev})
        return 0

    if args.cmd == "answer":
        if not is_valid_answer(args.dim, args.value):
            allowed = list(DIMENSIONS[args.dim]["values"]) if args.dim in DIMENSIONS else list(DIMENSIONS)
            _emit({"error": f"invalid answer {args.dim}={args.value!r}",
                   "dim_known": args.dim in DIMENSIONS, "allowed": allowed})
            return 2
        session = _load(args.session)
        elicit.answer(session, args.dim, args.value,
                      decided=args.decided, rating=args.rating)
        _save(args.session, session)
        _emit({"status": elicit.status(session)})
        return 0

    if args.cmd == "emit":
        session = _load(args.session)
        _emit(generate_from_session(session))
        return 0

    ap.print_help()
    return 2


# ---------------------------------------------------------------------------
# Self-test — proves the bridge holds: every value maps to a valid palette in
# both modes, elicitation ranks sensibly, and a converged session generates.
# ---------------------------------------------------------------------------

def _selftest() -> None:
    ok = 0

    # 1. session builds with all dimensions open
    s = color_session("a focused developer task manager")
    assert set(s["dimensions"]) == set(DIMENSIONS), "all dims present"
    ok += 1

    # 2. stated mode is DECIDED (never asked)
    s2 = color_session("goal", mode="dark")
    assert s2["dimensions"]["mode"]["excluded"], "mode pinned when stated"
    assert elicit.next_question(s2) != "mode", "engine won't ask a decided dim"
    ok += 1

    # 3. EVERY value of EVERY dimension composes a palette meeting contrast
    #    targets in BOTH light and dark mode (the mid-tone dead-zone guard).
    fails = []
    for mode in ("light", "dark"):
        for dim, spec in DIMENSIONS.items():
            if dim == "mode":
                continue
            for v in spec["values"]:
                sess = color_session("g", mode=mode)
                elicit.answer(sess, dim, v)  # confirming signal, not decided
                pal = generate_from_session(sess)
                if not pal["all_contrast_targets_met"]:
                    fails.append((mode, dim, v, pal["contrast"]["achieved"]))
    assert not fails, f"contrast targets unmet: {fails[:4]}"
    ok += 1

    # 4. params_from_session covers the real relationships knobs
    p = params_from_session(color_session("g"))
    for k in ("anchor_hue", "accent_hue_delta", "base_chroma", "accent_chroma",
              "on_surface_contrast", "muted_contrast", "accent_contrast", "surface_L"):
        assert k in p, f"missing param {k}"
    assert "_accent_chroma_nudge" not in p, "internal nudge key must be resolved out"
    ok += 1

    # 5. option_previews returns concrete role hexes for the next question
    prev = option_previews(color_session("g"))
    assert prev and prev["options"] and all(
        o["roles"]["accent"].startswith("#") for o in prev["options"]), "preview swatches"
    ok += 1

    # 6. info-gain ranking prefers a high-importance untouched dim first;
    #    answering it (confirming) lowers its rank next round (entropy fell).
    s6 = color_session("g", mode="light")
    first = elicit.next_question(s6)
    assert first in DIMENSIONS and first != "mode", "asks an open dim first"
    r_before = dict(elicit.rank_by_info_gain(s6))
    elicit.answer(s6, first, DIMENSIONS[first]["values"][0])
    r_after = dict(elicit.rank_by_info_gain(s6))
    assert r_after.get(first, 0.0) <= r_before[first] + 1e-9, "EIG of answered dim drops"
    ok += 1

    # 7. a fully-answered session converges (ready) and generates a valid palette
    s7 = color_session("g", mode="light")
    for dim, spec in DIMENSIONS.items():
        if dim == "mode":
            continue
        elicit.answer(s7, dim, spec["default"], decided=True)
    st7 = elicit.status(s7)
    assert st7["ready"], "exhausted session is ready to stop"
    pal7 = generate_from_session(s7)
    assert pal7["all_contrast_targets_met"], "converged palette meets targets"
    assert pal7["open_dims"] == [], "no dims left open"
    ok += 1

    # 8. hue-rotation invariance still holds through the bridge: a temperature
    #    change rotates hue but keeps every contrast relationship intact.
    a = generate_from_session(_answered("temperature", "cool"))
    b = generate_from_session(_answered("temperature", "warm"))
    assert a["contrast"]["target"] == b["contrast"]["target"], "same relationships"
    assert a["roles"]["accent"] != b["roles"]["accent"], "different colors"
    assert a["all_contrast_targets_met"] and b["all_contrast_targets_met"]
    ok += 1

    # 9. preview idempotence (catches double-applied knobs like the accent nudge):
    #    previewing a dimension's CURRENT value must reproduce the session's own
    #    palette exactly — for EVERY dimension, incl. accent_intensity.
    s9 = color_session("g", mode="light")
    elicit.answer(s9, "energy", "vivid")
    elicit.answer(s9, "accent_intensity", "bold")
    elicit.answer(s9, "accent_plan", "duo-mirrored")
    elicit.answer(s9, "gradient", "expressive")
    own = generate_from_session(s9)
    for dim in DIMENSIONS:
        cur = _current_value(s9, dim)
        prev = option_previews(s9, dim, max_options=0)
        match = next(o for o in prev["options"] if o["value"] == cur)
        assert match["roles"] == own["roles"], f"preview of current {dim}={cur} must match session palette"
        # The gradient is derived from the SOLVED accent, so it is the most sensitive
        # witness to a knob applied twice — a drift invisible in the role hexes still
        # moves the stops.
        assert match["gradient"] == own["gradient"], f"preview of current {dim}={cur} drifted the gradient"
    ok += 1

    # 10. option_previews shows EVERY value (temperature has 5) and the PAPRIKA
    #     fork never names a value that has no option card (D1 guard).
    prev10 = option_previews(color_session("g", mode="light"), dim="temperature")
    shown = [o["value"] for o in prev10["options"]]
    assert shown == DIMENSIONS["temperature"]["values"], f"all values shown, got {shown}"
    if prev10["fork"]:
        assert prev10["fork"]["a"] in shown and prev10["fork"]["b"] in shown, "fork ⊆ shown"
    # a capped preview still keeps the fork inside the shown subset
    capped = option_previews(color_session("g", mode="light"), dim="temperature", max_options=3)
    if capped["fork"]:
        cv = [o["value"] for o in capped["options"]]
        assert capped["fork"]["a"] in cv and capped["fork"]["b"] in cv, "capped fork ⊆ shown"
    ok += 1

    # 11. answer validation (D2/D3 guard): unknown dim / unknown value rejected,
    #     valid pair accepted.
    assert not is_valid_answer("tempreture", "warm"), "typo'd dim rejected"
    assert not is_valid_answer("temperature", "hot-pink"), "unknown value rejected"
    assert is_valid_answer("temperature", "warm"), "valid pair accepted"
    ok += 1

    # 12. the three structural dimensions reach the params they claim to govern, and
    #     nothing else — a patch that leaks would silently redesign a neighbouring knob.
    for dim, value, expected in (
        ("ramp_shape", "even-contrast", {"ramp_mode": "contrast"}),
        ("accent_plan", "trio", {"accent_count": 3, "accent_structure": "triadic"}),
        ("accent_plan", "duo-mirrored", {"accent_count": 2, "accent_structure": "mirror"}),
        ("gradient", "subtle", {"gradient_hue_sweep": 14.0, "gradient_L_shift": 0.05}),
        ("gradient", "none", {"gradient_hue_sweep": 0.0, "gradient_L_shift": 0.0}),
    ):
        got = DIMENSIONS[dim]["patch"](value)
        assert got == expected, f"{dim}={value} patched {got}, expected {expected}"
    ok += 1

    # 13. dimension names and PARAMS names stay disjoint. They are separate namespaces,
    #     and generate()'s unknown-key guard can only catch a dimension leaking into a
    #     params dict for as long as no dimension is spelled like a real param.
    collisions = set(DIMENSIONS) & set(rel.PARAMS)
    assert not collisions, f"dimension names shadow real params: {sorted(collisions)}"
    ok += 1

    # 14. the defaults compose the unchanged single-accent system: adding dimensions must
    #     not restyle every project that never answers them.
    base = generate_from_session(color_session("g", mode="light"))
    assert len(base["accents"]) == 1 and base["gradient"] is None, "defaults stay inert"
    assert base["params"]["ramp_mode"] == "lightness", "default ramp unchanged"
    ok += 1

    # 15. every structural value survives BOTH twins with its full contract — extra
    #     accents labelled correctly, gradients legible at every stop. Test 3 checks the
    #     scored gate; this checks the properties a scalar ratio cannot express.
    for mode in ("light", "dark"):
        for value in DIMENSIONS["accent_plan"]["values"]:
            s = color_session("g", mode=mode)
            elicit.answer(s, "accent_plan", value)
            pal = generate_from_session(s)
            for a in pal["accents"]:
                assert rel.contrast_hex(a["on"], a["fill"]) >= 4.45, f"{mode}/{value} label ratio"
                if mode == "dark":
                    assert a["polarity"] == "light", f"{mode}/{value} label polarity inverted"
        for value in DIMENSIONS["gradient"]["values"]:
            s = color_session("g", mode=mode)
            elicit.answer(s, "gradient", value)
            g = generate_from_session(s)["gradient"]
            if value == "none":
                assert g is None, "gradient 'none' emits no gradient"
            else:
                assert g["text_safe"] and g["fill_safe"], f"{mode}/{value} gradient unsafe"
    ok += 1

    # 16. option cards for the structural dimensions carry what distinguishes them.
    #     Without the gradient payload every `gradient` card renders the same flat
    #     swatch and the person is choosing from the adjective — the exact failure the
    #     preview exists to prevent.
    gprev = option_previews(color_session("g", mode="light"), dim="gradient")
    by_value = {o["value"]: o for o in gprev["options"]}
    assert by_value["none"]["gradient"] is None, "none card shows no gradient"
    assert by_value["subtle"]["gradient"]["stops"], "subtle card shows real stops"
    assert (by_value["expressive"]["gradient"]["stops"]
            != by_value["subtle"]["gradient"]["stops"]), "cards must be distinguishable"
    aprev = option_previews(color_session("g", mode="light"), dim="accent_plan")
    assert all("accent3" in o["roles"] for o in aprev["options"] if o["value"] == "trio"), \
        "trio card shows its third accent"
    ok += 1

    print(f"color_dimensions selftest: {ok}/{ok} passed")


def _answered(dim: str, value: str, mode: str = "light") -> dict[str, Any]:
    s = color_session("g", mode=mode)
    elicit.answer(s, dim, value)
    return s


if __name__ == "__main__":
    raise SystemExit(main())
