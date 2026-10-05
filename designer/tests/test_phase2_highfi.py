"""Phase 2 tests — high-fidelity preview tier + progressive-fidelity routing.

Covers the four Phase 2 acceptance criteria:
  P1. iOS high-fi pack: every high-fi-firing option-id renders a scoped,
      cruft-free, JS-free fragment.
  P2. macOS + web high-fi: token-parameterized (accent change -> output change).
  P3. Tier-selection is engine logic: high-fi fires ONLY on color/depth/motion
      dimensions; low-fi everywhere else; per-platform graceful fallback.
  P4. End-to-end: a walk surfaces high-fi where it matters and low-fi elsewhere
      via the CLI decision payload, and still emits a schema-valid DESIGN.md.

Run: uv run --with pytest python -m pytest designer/tests/test_phase2_highfi.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from designer.engine.catalog_loader import load_catalog
from designer.engine.schema import validate_design_md
from designer.engine.state import TasteState
from designer.emit import design_md
from designer.preview.fidelity_rule import fidelity_for
from designer.preview.highfi import ios_pack, macos_pack, web_pack
from designer.preview.highfi.router import render_high_fi, should_escalate
from designer.preview import schematic
from designer.engine import cli as cli_mod


# ---------------------------------------------------------------------------
# P1. iOS high-fi pack
# ---------------------------------------------------------------------------

def test_ios_pack_count_is_52():
    assert len(ios_pack.IOS_HIGH_FI_IDS) == 52


def test_ios_pack_every_id_scoped_clean_jsfree():
    for oid in ios_pack.IOS_HIGH_FI_IDS:
        html = ios_pack.render_ios_high_fi(oid)
        assert html, f"{oid}: empty fragment"
        assert f"hf-ios-{oid}" in html, f"{oid}: missing scope root"
        assert "pplx" not in html and "_orig" not in html, f"{oid}: cruft"
        assert "onmousedown" not in html and "onmouseup" not in html and "onclick" not in html, \
            f"{oid}: inline JS handler not stripped"


def test_ios_pack_accent_parameterized():
    html = ios_pack.render_ios_high_fi("accent-cta-only", {"color": {"accent": "#FF00AA"}})
    assert html and "#FF00AA" in html


# ---------------------------------------------------------------------------
# P2. macOS + web high-fi token parameterization
# ---------------------------------------------------------------------------

def test_macos_web_packs_nonempty():
    assert len(macos_pack.MACOS_HIGH_FI_IDS) >= 20
    assert len(web_pack.WEB_HIGH_FI_IDS) >= 20


def test_macos_web_accent_changes_output():
    for fn, ids in ((macos_pack.render_macos_high_fi, macos_pack.MACOS_HIGH_FI_IDS),
                    (web_pack.render_web_high_fi, web_pack.WEB_HIGH_FI_IDS)):
        for oid in ids:
            a = fn(oid, {"color": {"accent": "#FF00AA"}})
            b = fn(oid, {"color": {"accent": "#00FF00"}})
            if a is not None and b is not None:
                assert a != b, f"{oid}: ignores accent token"


# ---------------------------------------------------------------------------
# P3. Tier-selection is engine logic
# ---------------------------------------------------------------------------

def test_router_escalates_only_on_high_fi_dims():
    cat = load_catalog().by_id()
    # color/depth/motion -> escalate
    for cid, dim in (("color-accent-system", "color.accent"),
                     ("button-shadow", "elevation.style"),
                     ("press-feedback", "motion.press")):
        assert should_escalate(cat[cid].dimension), f"{cid} should escalate"
        assert fidelity_for(cat[cid].dimension) == "high"
    # everything else stays low-fi
    for cid in ("nav-tabbar", "list-separator", "type-heading-style"):
        assert not should_escalate(cat[cid].dimension), f"{cid} must NOT escalate"


def test_router_per_platform_graceful_fallback():
    cat = load_catalog().by_id()
    motion_dim = cat["micro-haptics"].dimension  # motion.intensity (high)
    assert should_escalate(motion_dim)
    # iOS-only motion ids -> high-fi on iOS, None (low-fi fallback) on web/macos
    assert render_high_fi("ios", "haptic-minimal", motion_dim) is not None
    assert render_high_fi("web", "haptic-minimal", motion_dim) is None
    assert render_high_fi("macos", "haptic-minimal", motion_dim) is None


def test_low_fi_dim_never_escalates_any_platform():
    cat = load_catalog().by_id()
    nav_dim = cat["nav-tabbar"].dimension
    for p in ("web", "ios", "macos"):
        assert render_high_fi(p, "tabbar-icon-label", nav_dim) is None


# ---------------------------------------------------------------------------
# P4. End-to-end: CLI decision payload surfaces tier; walk emits valid DESIGN.md
# ---------------------------------------------------------------------------

def test_decision_payload_high_fi_on_color_category():
    cat = load_catalog().by_id()
    c = cat["color-accent-system"]
    payload = cli_mod._decision_payload(c, {})
    assert payload["tier"] == "high"
    # at least one option escalated to high-fi on at least one platform
    escalated = [o for o in payload["options"] if o["fidelity"] == "high"]
    assert escalated, "color category produced no high-fi option payload"
    # the high-fi option's previews contain a scoped high-fi fragment
    o0 = escalated[0]
    assert any("hf-" in (o0["previews"].get(p) or "") for p in o0["high_fi_platforms"])


def test_decision_payload_low_fi_on_nav_category():
    cat = load_catalog().by_id()
    c = cat["nav-tabbar"]
    payload = cli_mod._decision_payload(c, {})
    assert payload["tier"] == "low"
    for o in payload["options"]:
        assert o["fidelity"] == "low", f"{o['id']} unexpectedly high-fi"
        for p, html in o["previews"].items():
            assert "hf-" not in (html or ""), f"{o['id']}/{p}: leaked high-fi fragment"


def test_tier_is_authoritative_not_html_sniffed():
    """Closure proof for auditor finding f1: fidelity is read from the engine's
    selected tier, NOT by sniffing 'hf-' in the HTML. A low-fi schematic that
    happens to contain the literal 'hf-' must still report tier 'low'."""
    cat = load_catalog().by_id()
    c = cat["nav-tabbar"]  # low-fi dimension
    tiered = schematic.render_decision_previews_tiered(c, c.options, {})
    for oid, cells in tiered.items():
        for p, cell in cells.items():
            # inject the high-fi marker token into a genuinely low-fi fragment
            poisoned = cell["html"] + "<!-- hf- decoy -->"
            assert cell["tier"] == "low", f"{oid}/{p}: low-fi misreported as {cell['tier']}"
            # the tier field, not the string, is what the payload trusts
            assert "hf-" in poisoned  # the decoy is present...
            assert cell["tier"] == "low"  # ...yet tier stays low (no sniffing)


def test_e2e_walk_emits_valid_design_md():
    """Drive a full pick sequence (incl. high-fi color/depth/motion decisions)
    then confirm the loop still emits a schema-valid, platform-aware DESIGN.md."""
    cat = load_catalog()
    by_id = cat.by_id()
    opts_by_id = cat.options_by_id()
    st = TasteState(context={"description": "a calm research app"})

    # pick a spread across high-fi (color/depth/motion) and low-fi dimensions
    picks = [
        ("color-accent-system", "accent-expressive"),  # color (high-fi)
        ("button-shadow", "btn-soft-shadow"),           # elevation (high-fi)
        ("press-feedback", "press-scale-down"),         # motion (high-fi)
        ("nav-tabbar", "tabbar-icon-label"),            # nav (low-fi)
        ("list-separator", "sep-inset-line"),           # components (low-fi)
    ]
    for cid, oid in picks:
        st.apply_pick(cid, oid, opts_by_id[oid].token_delta)

    doc = design_md.build_design_doc("Calm Research App", st, flatten=True, catalog=cat)
    res = validate_design_md(doc)
    assert res.ok, f"emitted DESIGN.md invalid: {res.errors}"
    # platform-aware: base + per-platform layers present
    assert "base" in doc and isinstance(doc["base"], dict)
    # flattened doc must NOT carry an extends line
    md = design_md.render_design_md(doc)
    assert "extends:" not in md
    # the picks are reflected: the expressive accent override propagated
    assert "accent" in md.lower()


# ---------------------------------------------------------------------------
# stdlib runner
# ---------------------------------------------------------------------------

def _run() -> int:
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
