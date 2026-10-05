"""Chunk 2 tests — catalog loads, every option has a resolvable token_delta,
zero pplx/_orig cruft, all 34 categories mapped to a dimension.

Run: python3 designer/tests/test_chunk2_catalog.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from designer.engine import catalog_loader as cl
from designer.engine import resolver
from designer.engine.schema import validate_token_delta


def test_catalog_loads_strict():
    cat = cl.load_catalog(strict=True)  # raises on any problem
    # 32 mined categories + 2 Layer-1 scope categories (platform-target, nav-structure)
    assert len(cat.categories) == 34


def test_option_count_is_126():
    cat = cl.load_catalog()
    total = sum(len(c.options) for c in cat.categories)
    # 118 mined options + 8 Layer-1 scope options
    assert total == 126, total


def test_every_option_has_resolvable_delta():
    cat = cl.load_catalog()
    for o in cat.options_by_id().values():
        assert o.token_delta is not None
        vr = validate_token_delta(o.token_delta)
        assert vr.ok, (o.id, vr.errors)


def test_every_category_has_dimension():
    cat = cl.load_catalog()
    for c in cat.categories:
        assert c.dimension and c.dimension != "UNMAPPED", c.id
        group, _, key = c.dimension.partition(".")
        # dimension path must be a real token vocabulary path
        from designer.engine.schema import is_known_token
        assert is_known_token(group, key), c.dimension


def test_deltas_merge_through_resolver():
    """Applying any option delta resolves cleanly (no resolver crash)."""
    cat = cl.load_catalog()
    acc: dict = {}
    for o in cat.options_by_id().values():
        acc = resolver.merge_delta(acc, o.token_delta)
    # accumulated everything; resolve still works for each platform
    for p in ("web", "ios", "macos"):
        eff = resolver.resolve(p, acc)
        assert "color" in eff


def test_zero_pplx_orig_cruft():
    # strict load already raises on cruft; assert explicitly too
    import json
    raw = json.load(open(cl._CATEGORIES_JSON, encoding="utf-8"))
    blob = json.dumps(raw)
    assert "pplx" not in blob
    assert "_orig" not in blob


def test_stats():
    s = cl.catalog_stats()
    assert s["categories"] == 34
    assert s["options"] == 126
    assert s["dimensions"] >= 8


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
