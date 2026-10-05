"""Chunk 5 tests — emitter produces a valid, platform-aware DESIGN.md reflecting
the picks; two pick-sequences produce two valid docs (MAY differ or coincide —
divergence NOT required per the correction).

Run: python3 designer/tests/test_chunk5_emit.py
"""

from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from designer.engine import catalog_loader as cl
from designer.engine.state import TasteState
from designer.emit import design_md, writer, yaml_min
from designer.engine.schema import validate_design_md


def _walk(context_desc, picks):
    """Build a TasteState by applying a fixed list of (category_id, option_id)."""
    cat = cl.load_catalog()
    by_id = cat.by_id()
    opts = cat.options_by_id()
    st = TasteState(context={"description": context_desc})
    for cid, oid in picks:
        o = opts[oid]
        st.apply_pick(cid, oid, o.token_delta)
    return st, cat


def test_yaml_min_roundtrip_basic():
    doc = {"schema": "design.md/v1", "color": {"accent": "#FF2D55"}, "list": ["a", "b"]}
    out = yaml_min.dump(doc)
    assert "#FF2D55" in out
    assert '"#FF2D55"' in out  # hex must be quoted
    assert "- a" in out


def test_emit_flattened_valid_and_no_extends():
    st, cat = _walk("dense data dashboard", [
        ("color-accent-system", "accent-expressive"),
        ("type-numbers", "num-mono-tabular"),
    ])
    doc = design_md.build_design_doc("Dash", st, flatten=True, version="1.0.0", catalog=cat)
    assert "extends" not in doc
    assert validate_design_md(doc).ok, validate_design_md(doc).errors
    text = design_md.render_design_md(doc)
    assert "design.md/v1" in text
    assert "AI Prompt Pack" in text
    assert "5E5CE6".lower() in text.lower() or "#5E5CE6" in text  # expressive accent


def test_emit_extends_mode_tiny_diff():
    st, cat = _walk("calm reader", [("color-accent-system", "accent-cta-only")])
    doc = design_md.build_design_doc("Reader", st, flatten=False, version="0.1.0", catalog=cat)
    assert doc.get("extends")  # declares the floor
    assert validate_design_md(doc).ok


def test_platform_aware_layers_present():
    st, cat = _walk("consumer app", [("color-accent-system", "accent-expressive")])
    doc = design_md.build_design_doc("App", st, flatten=True, version="1.0.0", catalog=cat)
    assert "base" in doc
    assert "platforms" in doc
    # platform layers carry the font divergence
    plats = doc["platforms"]
    assert any(p in plats for p in ("ios", "macos"))


def test_prompt_pack_reflects_picks():
    st, cat = _walk("fintech", [("color-accent-system", "accent-expressive")])
    doc = design_md.build_design_doc("Fin", st, flatten=True, catalog=cat)
    pack = "\n".join(doc["prompt_pack"])
    assert "accent" in pack.lower()
    assert "Revealed preferences" in pack  # the picks are cited


def test_two_sequences_both_valid():
    """Two different pick-sequences each produce a valid DESIGN.md.

    Per the correction: they MAY differ or coincide — divergence is NOT asserted.
    We only require BOTH validate and reflect their own picks.
    """
    st_a, cat = _walk("dense dashboard", [
        ("color-accent-system", "accent-expressive"),
        ("delight-celebration", "celebrate-confetti"),
    ])
    st_b, _ = _walk("calm editorial reader", [
        ("color-accent-system", "accent-cta-only"),
        ("delight-celebration", "celebrate-checkmark-ripple"),
    ])
    da = design_md.build_design_doc("A", st_a, flatten=True, catalog=cat)
    db = design_md.build_design_doc("B", st_b, flatten=True, catalog=cat)
    assert validate_design_md(da).ok
    assert validate_design_md(db).ok
    # both are valid — we do NOT assert da != db (divergence not required)


def test_writer_writes_to_out_dir():
    st, cat = _walk("test", [("color-accent-system", "accent-cta-only")])
    with tempfile.TemporaryDirectory() as d:
        res = writer.write_design_md("Test", st, d, flatten=True, version="1.0.0", catalog=cat)
        assert os.path.exists(res["path"])
        assert res["path"].endswith("DESIGN.md")
        assert res["bytes"] > 0
        with open(res["path"], encoding="utf-8") as fh:
            content = fh.read()
        assert "design.md/v1" in content


def test_writer_explicit_md_path_and_backup():
    st, cat = _walk("test", [("color-accent-system", "accent-cta-only")])
    with tempfile.TemporaryDirectory() as d:
        target = os.path.join(d, "MYDESIGN.md")
        r1 = writer.write_design_md("T", st, target, catalog=cat)
        assert r1["path"] == os.path.abspath(target)
        assert r1["backed_up"] is None
        r2 = writer.write_design_md("T", st, target, catalog=cat)  # second write
        assert r2["backed_up"] and os.path.exists(r2["backed_up"])


def _run():
    fns = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn(); print(f"PASS {fn.__name__}")
        except AssertionError as e:
            failed += 1; print(f"FAIL {fn.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1; print(f"ERROR {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if _run() else 0)
