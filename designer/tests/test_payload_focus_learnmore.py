"""Payload integration test — focus_spec + learn_more keys in _decision_payload.

Verifies the chunk-6 final integration:
  1. Every decision payload carries "focus_spec" (dict with target_regions) and
     "learn_more" (non-empty string containing <details> and decision-explainer).
  2. Previews are focus-wrapped when focus applies (option HTML contains
     data-focus-region or focus-wrap markers for a low-fi decision with targets).
  3. Existing 3-platform preview shape is unchanged.

Run: python3 -m pytest designer/tests/test_payload_focus_learnmore.py -q
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)


def _cli(args, state=None):
    full = [sys.executable, "-m", "designer.engine.cli", *args]
    if state is not None:
        sf = os.path.join(tempfile.gettempdir(), "ci_focus_lm_state.json")
        with open(sf, "w") as fh:
            json.dump(state, fh)
        full += ["--state", sf]
    p = subprocess.run(full, cwd=ROOT, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def _first_ask_decision():
    """Init + present, return the first decision dict."""
    state = _cli(["init", "--context", "focus-learnmore test"])["state"]
    step = _cli(["present"], state)
    assert step["action"] == "ask", f"Expected 'ask', got {step['action']!r}"
    return step["decision"]


def test_payload_carries_focus_spec():
    """decision dict must have focus_spec with expected structure."""
    d = _first_ask_decision()
    assert "focus_spec" in d, "Missing 'focus_spec' key in decision payload"
    fs = d["focus_spec"]
    assert isinstance(fs, dict), f"focus_spec must be a dict, got {type(fs)}"
    assert "target_regions" in fs, f"focus_spec missing 'target_regions': {fs}"
    assert isinstance(fs["target_regions"], list), "target_regions must be a list"
    assert "non_target_treatment" in fs, f"focus_spec missing 'non_target_treatment': {fs}"
    assert "target_ring" in fs, f"focus_spec missing 'target_ring': {fs}"


def test_payload_carries_learn_more():
    """decision dict must have learn_more — a non-empty <details> HTML string."""
    d = _first_ask_decision()
    assert "learn_more" in d, "Missing 'learn_more' key in decision payload"
    lm = d["learn_more"]
    assert isinstance(lm, str) and lm, "learn_more must be a non-empty string"
    assert "<details" in lm, f"learn_more must contain <details>; got: {lm[:120]!r}"
    assert "decision-explainer" in lm, (
        f"learn_more must reference 'decision-explainer' class; got: {lm[:200]!r}"
    )


def test_learn_more_css_classes_match_spec():
    """CSS class names in learn_more output must match what picker.css defines."""
    d = _first_ask_decision()
    lm = d["learn_more"]
    expected_classes = [
        "decision-explainer",
        "decision-explainer-summary",
        "decision-explainer-body",
        "dex-what",
        "dex-does",
        "dex-considerations",
    ]
    for cls in expected_classes:
        assert cls in lm, f"learn_more missing CSS class '{cls}'; got: {lm[:400]!r}"


def test_previews_focus_wrapped_when_targets_exist():
    """For a decision whose focus_spec has non-empty target_regions, at least
    one option's web preview HTML should carry focus markers (data-focus-region
    or focus-wrap) — confirming enable_focus=True took effect end-to-end."""
    # Walk until we find a decision with target_regions, or exhaust 10 decisions.
    state = _cli(["init", "--context", "focus wrap e2e"])["state"]
    found_targeted = False
    for _ in range(10):
        step = _cli(["present"], state)
        if step["action"] == "done":
            break
        d = step["decision"]
        fs = d.get("focus_spec", {})
        if fs.get("target_regions"):
            # This decision has focus targets; check the low-fi web previews.
            opt0 = d["options"][0]
            web_html = opt0["previews"].get("web", "")
            assert web_html, "web preview must be non-empty"
            # Focus wrappers inject data-focus-region markers on low-fi fragments.
            has_focus = "data-focus-region" in web_html or "focus-wrap" in web_html
            assert has_focus, (
                f"enable_focus=True had no effect on web preview for dimension "
                f"'{d['dimension']}' with target_regions={fs['target_regions']}.\n"
                f"web HTML (first 300): {web_html[:300]!r}"
            )
            found_targeted = True
            break
        # Advance: pick first option so the walk progresses.
        opt0 = d["options"][0]
        res = _cli(["pick", "--category", d["category_id"], "--option", opt0["id"]], state)
        state = res["state"]

    assert found_targeted, (
        "Could not find a decision with non-empty target_regions in 10 steps. "
        "Check focus_spec.py FOCUS_SPECS table."
    )


def test_three_platform_previews_still_present():
    """Regression: enabling focus must not break the 3-platform preview shape."""
    d = _first_ask_decision()
    opt0 = d["options"][0]
    assert set(opt0["previews"].keys()) == {"web", "ios", "macos"}, (
        f"Expected 3 platforms, got: {set(opt0['previews'].keys())}"
    )
    for plat in ("web", "ios", "macos"):
        assert opt0["previews"][plat], f"Platform '{plat}' preview is empty"


def test_existing_tier_key_still_present():
    """Regression guard: the 'tier' fidelity key (asserted by test_uxiter_tiering)
    must remain in the payload after adding focus_spec + learn_more."""
    d = _first_ask_decision()
    assert "tier" in d, "Existing 'tier' key was removed from decision payload"
    assert isinstance(d["tier"], str), f"'tier' must be a string, got {type(d['tier'])}"


def _run():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
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
