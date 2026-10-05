"""Acceptance test for the 'evolve my existing design system' core use case.

Re-runs the exact dogfood that surfaced the two findings, against a COMMITTED
fixture (never the external sample-notes path):

    copy fixture -> temp NON-git target -> import it -> evolve 2 decisions
    -> draft-save -> draft-resume (proves import_base survives the round-trip)
    -> promote

and asserts the promoted DESIGN.md is the ORIGINAL document with ONLY the two
evolved token values changed (+ a version line), NOT a lossy re-emit from the
tool's minimal template.

Findings under test:
  * Finding 2 (P0) — promote re-emitted from template and dropped the imported
    file's principles block, comments, and unmodeled tokens (6104B -> 3299B).
    The fix is a structure-preserving surgical merge of the original text.
  * Finding 1 — only color.accent + color.surface seeded a reviewable decision;
    typography.fontFamily (in-vocab, modeled as a sibling in the heading-style
    decision) now also seeds, so more of the imported system is reviewable.

Run: python -m pytest designer/tests/test_promote_preserves_imported_doc.py -q
"""

from __future__ import annotations

import os
import sys
import tempfile
import shutil

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))
sys.path.insert(0, _ROOT)

import pytest

from designer.engine.state import TasteState
from designer.engine.catalog_loader import load_catalog
from designer.engine.draft import make_draft, save_draft, load_draft
from designer.extract.import_design import import_design
from designer.emit.promote import promote_draft
from designer.emit.surgical_merge import surgical_update


_FIXTURE = os.path.join(_HERE, "fixtures", "sample-notes_design.md")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _catalog():
    return load_catalog(strict=False)


def _run_dogfood(plugin_root: str, target_dir: str):
    """Execute the full import -> evolve -> draft round-trip -> promote dogfood.

    Returns (original_text, promoted_text, promote_result, seeded_list).

    target_dir is a NON-git directory so the .bak / non-git-warning path fires.
    """
    cat = _catalog()
    original = open(_FIXTURE, encoding="utf-8").read()

    target = os.path.join(target_dir, "DESIGN.md")
    shutil.copy2(_FIXTURE, target)

    # 1. Import the foreign document.
    st = TasteState()
    res = import_design(st, original, cat, source_path=target)
    st.baseline = res["baseline_overrides"]
    seeded = res["seeded"]

    # 2. Evolve exactly 2 decisions with genuinely different values so
    #    delta_since is non-empty (color-dark-mode + color-accent-system).
    st.apply_pick(
        "color-dark-mode", "dark-deep-color",
        {"color": {"surface": "#0B1020"}}, source="pick",
    )
    st.apply_pick(
        "color-accent-system", "accent-expressive",
        {"color": {"accent": "#5E5CE6"}}, source="pick",
    )

    # 3. draft-save then draft-resume — proves import_base (which rides inside
    #    state.context) survives the serialize/deserialize round-trip.
    draft = make_draft(
        st.to_dict(), product="Sample Notes",
        baseline_overrides=st.baseline, source="import",
    )
    save_draft(plugin_root, draft)
    loaded = load_draft(plugin_root, "Sample Notes", draft["draft_id"])
    assert loaded is not None, "draft did not round-trip through save/load"

    # Reconstruct exactly like cmd_draft_resume does.
    st_resumed = TasteState.from_dict(loaded["state_snapshot"])
    st_resumed.baseline = loaded.get("baseline_overrides", st_resumed.baseline)

    # import_base MUST have survived the round-trip.
    ib = st_resumed.context.get("import_base")
    assert ib and ib.get("raw_text"), "import_base did not survive the draft round-trip"
    assert ib["raw_text"] == original, "import_base.raw_text was mutated in round-trip"

    # 4. Promote from the RESUMED state (the realistic path).
    promote_draft_envelope = {
        "product": "Sample Notes",
        "state_snapshot": st_resumed.to_dict(),
        "baseline_overrides": loaded.get("baseline_overrides"),
    }
    result = promote_draft(promote_draft_envelope, target, name="Sample Notes", catalog=cat)
    promoted = open(target, encoding="utf-8").read()
    return original, promoted, result, seeded


# ---------------------------------------------------------------------------
# Finding 2 — structure preservation on the imported promote path
# ---------------------------------------------------------------------------

def test_promote_preserves_principles_block():
    """The full principles: block (and its bullets) survive promote verbatim."""
    pr = tempfile.mkdtemp(); td = tempfile.mkdtemp()
    original, promoted, _res, _seeded = _run_dogfood(pr, td)

    # Every line of the original principles block must be present verbatim.
    o_lines = original.split("\n")
    start = next(i for i, l in enumerate(o_lines) if l.rstrip() == "principles:")
    # Block runs until the next top-level token group header ("color:").
    end = next(i for i in range(start + 1, len(o_lines)) if o_lines[i] == "color:")
    for line in o_lines[start:end]:
        assert line in promoted, f"principles line dropped: {line!r}"
    # Spot-check distinctive content.
    assert "Use a quiet interface" in promoted
    assert "Preserve comments and unmodeled tokens" in promoted


def test_promote_preserves_inline_and_section_comments():
    """Inline token comments AND principles section comments survive verbatim."""
    pr = tempfile.mkdtemp(); td = tempfile.mkdtemp()
    _original, promoted, _res, _seeded = _run_dogfood(pr, td)

    # Inline comment on a token value line.
    assert "# grouped card fill" in promoted
    assert "# primary actions (Save, Export)" in promoted
    assert "# sample marker" in promoted
    # Section comments inside the principles block.
    assert "# Synthetic fixture comment; preserve this line." in promoted
    assert "# Synthetic fixture comment; preserve this line." in promoted
    # Top-of-file comments.
    assert "# Synthetic design.md token format" in promoted


def test_promote_preserves_non_vocab_tokens():
    """Non-catalog-vocabulary tokens (>=3) survive promote — they would be
    dropped by a template re-emit because the catalog cannot model them."""
    pr = tempfile.mkdtemp(); td = tempfile.mkdtemp()
    _original, promoted, _res, _seeded = _run_dogfood(pr, td)

    for tok in (
        "flagBar:",            # color.flagBar  — non-vocab
        "mono:",               # typography.mono — non-vocab
        "surfaceSunken:",      # color.surfaceSunken — non-vocab
        "warningBg:",          # color.warningBg — non-vocab
        "button.primary:",     # components flow-map — non-vocab
        "L1_title:",           # typography flow-map — non-vocab
        "elevation:",          # whole elevation block — non-vocab
    ):
        assert tok in promoted, f"non-vocab token dropped: {tok}"


def test_promote_changes_only_evolved_values_plus_version():
    """ONLY the 2 evolved token values changed (+ a version line). Every other
    frontmatter+body line is byte-identical to the original fixture."""
    import difflib
    pr = tempfile.mkdtemp(); td = tempfile.mkdtemp()
    original, promoted, result, _seeded = _run_dogfood(pr, td)

    o = original.split("\n")
    p = promoted.split("\n")
    sm = difflib.SequenceMatcher(None, o, p)
    removed, added = [], []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "equal":
            removed.extend(o[i1:i2])
            added.extend(p[j1:j2])

    # Removed: exactly the old surface + old accent value lines.
    assert any('"#F5F5F7"' in l for l in removed), f"old surface not in removed: {removed}"
    assert any('"#0A84FF"' in l for l in removed), f"old accent not in removed: {removed}"
    assert len(removed) == 2, f"expected exactly 2 removed lines, got {removed}"

    # Added: the new surface, new accent, and a version line.
    assert any('"#0B1020"' in l for l in added), f"new surface not in added: {added}"
    assert any('"#5E5CE6"' in l for l in added), f"new accent not in added: {added}"
    assert any(l.startswith("version:") for l in added), f"version line not added: {added}"
    assert len(added) == 3, f"expected exactly 3 added lines, got {added}"

    # The old accent hex must be GONE from the frontmatter (sole occurrence was
    # the value we evolved).
    frontmatter = promoted.split("\n---\n")[0]
    assert "#0A84FF" not in frontmatter, "old accent value still present in frontmatter"

    # Comments on the two changed lines are preserved (the value, not the line,
    # is what changed).
    assert "#0B1020" in promoted and "# grouped card fill" in promoted
    assert "#5E5CE6" in promoted and "# primary actions (Save, Export)" in promoted

    # Version was bumped/recorded.
    assert result["version"]


def test_promote_size_matches_original_not_shrunk():
    """Only token changes and a version line may alter the synthetic document."""
    pr = tempfile.mkdtemp(); td = tempfile.mkdtemp()
    original, promoted, _res, _seeded = _run_dogfood(pr, td)

    o_bytes = len(original.encode("utf-8"))
    p_bytes = len(promoted.encode("utf-8"))
    # Promoted must be within a small delta of the original (only a version line
    # + value swaps changed it), and FAR above the ~3299B template re-emit.
    assert p_bytes >= o_bytes - 50, f"promoted shrank: {o_bytes}B -> {p_bytes}B"
    assert p_bytes <= o_bytes + 250, f"unexpected document expansion: {o_bytes}B -> {p_bytes}B"


def test_promote_bak_equals_original_and_warns_non_git():
    """On a NON-git target the prior file is backed up as DESIGN.md.bak (== the
    original fixture) and a non-git warning is returned — behavior unchanged on
    the surgical path."""
    pr = tempfile.mkdtemp(); td = tempfile.mkdtemp()
    original, _promoted, result, _seeded = _run_dogfood(pr, td)

    assert result["is_git"] is False
    assert result["backed_up"] is not None, "non-git promote must create a .bak"
    bak = result["backed_up"]
    assert os.path.isfile(bak)
    assert open(bak, encoding="utf-8").read() == original, ".bak must equal the original fixture"
    assert result["warning"], "non-git promote must return a warning"


# ---------------------------------------------------------------------------
# Finding 1 — review-coverage improvement (2 -> 3 seeded decisions)
# ---------------------------------------------------------------------------

def test_import_seeds_more_reviewable_decisions():
    """The sample-notes import now seeds 3 reviewable decisions (was 2): the two
    color decisions PLUS the typography heading-style decision via the
    fontFamily alias. No fake decisions are invented."""
    cat = _catalog()
    original = open(_FIXTURE, encoding="utf-8").read()
    st = TasteState()
    res = import_design(st, original, cat, source_path=_FIXTURE)

    dims = sorted(s["dimension"] for s in res["seeded"])
    assert dims == ["color.accent", "color.surface", "typography.headingWeight"], dims
    assert len(res["seeded"]) == 3

    # The aliased token landed at its ORIGINAL path in overrides (faithful).
    assert st.overrides["typography"]["fontFamily"].startswith("-apple-system")
    # fontFamily is no longer stranded in unmapped[].
    assert "typography.fontFamily" not in [u["path"] for u in res["unmapped"]]

    # Raw color hexes that legitimately have no decision STAY raw overrides
    # (no synthetic decision invented for them).
    unmapped_paths = {u["path"] for u in res["unmapped"]}
    assert "color.bg" in unmapped_paths
    assert "color.border" in unmapped_paths


def test_seeded_decisions_have_exactly_one_current():
    """CVA invariant: every seeded decision marks exactly one option current
    (extracted_picks reports one option per seeded category, including the new
    aliased heading-style decision)."""
    cat = _catalog()
    original = open(_FIXTURE, encoding="utf-8").read()
    st = TasteState()
    import_design(st, original, cat, source_path=_FIXTURE)

    picks = st.extracted_picks()
    seen = {}
    for p in picks:
        cid = p["category_id"]
        assert cid not in seen, f"category {cid} appears twice in extracted_picks"
        seen[cid] = p["option_id"]
        assert p["option_id"], f"category {cid} has no current option"
    # The aliased heading-style decision is among them.
    assert "type-heading-style" in seen


# ---------------------------------------------------------------------------
# Surgical updater: refuse structured values loudly (no silent corruption)
# ---------------------------------------------------------------------------

def test_surgical_update_refuses_structured_value():
    """surgical_update only edits scalar value lines. A dict/list value (which
    would be repr-serialized into a byte-corrupting line) is refused loudly
    rather than silently corrupting the document. Unreachable in the supported
    pipeline, but guarded as defense-in-depth against the silent-loss class this
    whole build exists to prevent."""
    original = open(_FIXTURE, encoding="utf-8").read()
    with pytest.raises(ValueError):
        surgical_update(original, {"typography": {"L1_title": {"size": 99}}}, "9")
    with pytest.raises(ValueError):
        surgical_update(original, {"spacing": {"scale": [1, 2, 3]}}, "9")
    # A scalar value is still accepted (sanity — the guard is type-scoped).
    out = surgical_update(original, {"color": {"surface": "#0B1020"}}, "9")
    assert "#0B1020" in out


# ---------------------------------------------------------------------------
# Regression: fresh-walk (no import_base) promote still re-emits from template
# ---------------------------------------------------------------------------

def test_fresh_walk_promote_still_re_emits_from_template():
    """A promote with NO import_base (fresh-walk / extract path) takes the
    template re-emit branch unchanged — proving the surgical path is scoped to
    imported docs only and does not regress the original behavior."""
    cat = _catalog()
    st = TasteState()
    # A picked-but-not-imported state has no import_base in context.
    by_id = cat.by_id()
    accent = by_id["color-accent-system"]
    st.apply_pick(accent.id, accent.options[0].id, accent.options[0].token_delta, source="pick")
    assert "import_base" not in st.context

    td = tempfile.mkdtemp()
    draft = make_draft(st.to_dict(), product="FreshProd", baseline_overrides=st.baseline)
    result = promote_draft(draft, td, name="FreshProd", catalog=cat)
    text = open(os.path.join(td, "DESIGN.md"), encoding="utf-8").read()

    # Template re-emit produces the tool's canonical schema header + a clean
    # frontmatter — it is NOT the sample-notes document.
    assert "schema: design.md/v1" in text
    assert "principles:" not in text  # no foreign principles block to preserve
    assert "flagBar:" not in text     # no foreign non-vocab tokens
    assert result["version"]
