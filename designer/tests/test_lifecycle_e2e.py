"""End-to-end lifecycle tests via the CLI (no server).

FLOW 1 — import → evolve → draft-save → draft-resume → draft-promote:
  1. Build + import a DESIGN.md (import entry point).
  2. Evolve: pick a different option on one imported category (records a delta).
  3. draft-save the evolved state.
  4. draft-resume: resumed state must equal the pre-save state.
  5. draft-promote into a tempdir: assert a valid versioned DESIGN.md is written
     with the evolved override and can be parsed back.

FLOW 2 — generate → accept → promote:
  1. Fresh state.
  2. accept-deltas a generated token_delta (source=generate).
  3. draft-promote into a tempdir: DESIGN.md includes the accepted accent.

Both flows assert: only DESIGN.md (+ optional .bak) is written — no git ops,
no stray files.

Run: python -m pytest designer/tests/test_lifecycle_e2e.py -q
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))
sys.path.insert(0, _ROOT)

from designer.engine.catalog_loader import load_catalog
from designer.engine.state import TasteState
from designer.emit import design_md
from designer.extract.import_design import import_design
from designer.engine.schema import validate_design_md
from designer.emit.yaml_min import parse


# ---------------------------------------------------------------------------
# Subprocess helper
# ---------------------------------------------------------------------------

def _cli(args, state=None):
    """Run designer.engine.cli via subprocess; assert rc=0; return parsed JSON."""
    full = [sys.executable, "-m", "designer.engine.cli", *args]
    if state is not None:
        sf = os.path.join(tempfile.gettempdir(), "e2e_state.json")
        with open(sf, "w") as fh:
            json.dump(state, fh)
        full += ["--state", sf]
    p = subprocess.run(full, cwd=_ROOT, capture_output=True, text=True)
    assert p.returncode == 0, f"CLI failed (rc={p.returncode}):\n{p.stderr}"
    return json.loads(p.stdout)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _catalog():
    return load_catalog(strict=False)


def _make_design_md_text() -> str:
    """Build a representative DESIGN.md with a known accent."""
    cat = _catalog()
    by_id = cat.by_id()
    st = TasteState(context={"description": "e2e test product"})
    c = by_id["color-accent-system"]
    opt = c.options[0]  # accent-cta-only → #0A84FF
    st.apply_pick(c.id, opt.id, opt.token_delta, source="pick")
    doc = design_md.build_design_doc("E2ETest", st, flatten=True, version="1")
    return design_md.render_design_md(doc)


def _assert_only_design_files(outdir: str, allow_bak: bool = True) -> None:
    """Assert the output directory contains only DESIGN.md (+ optional .bak)."""
    allowed = {"DESIGN.md"}
    if allow_bak:
        allowed.add("DESIGN.md.bak")
    actual = set(os.listdir(outdir))
    unexpected = actual - allowed
    assert not unexpected, (
        f"Unexpected files in output dir: {unexpected}. "
        f"Tool must NOT write git objects or other artefacts."
    )


# ---------------------------------------------------------------------------
# FLOW 1: import → evolve → draft-save → draft-resume → draft-promote
# ---------------------------------------------------------------------------

def test_flow1_import_evolve_draft_resume_promote():
    """Full import→evolve→save→resume→promote flow."""
    cat = _catalog()
    by_id = cat.by_id()

    # --- Step 1: init + import-design ----------------------------------------
    init_res = _cli(["init", "--context", "e2e lifecycle"])
    state = init_res["state"]

    design_file = os.path.join(tempfile.gettempdir(), "e2e_flow1_design.md")
    with open(design_file, "w", encoding="utf-8") as fh:
        fh.write(_make_design_md_text())

    imp_res = _cli(["import-design", "--file", design_file], state)
    state = imp_res["state"]

    # Baseline must be set after import
    assert state.get("baseline"), "baseline should be set after import-design"
    seeded = imp_res.get("seeded", [])
    assert seeded, "import-design should seed at least one category"

    # --- Step 2: evolve — pick a different option on one imported category ----
    # Find the color-accent-system category; pick the second option
    c = by_id["color-accent-system"]
    seeded_cids = {s["category_id"] for s in seeded}
    assert "color-accent-system" in seeded_cids, (
        "color-accent-system was not seeded — cannot evolve it"
    )
    seeded_oid = next(
        (s["option_id"] for s in seeded if s["category_id"] == "color-accent-system"),
        c.options[0].id,
    )
    alt_opt = next((o for o in c.options if o.id != seeded_oid), c.options[-1])

    pick_res = _cli(
        ["pick", "--category", "color-accent-system", "--option", alt_opt.id],
        state,
    )
    state = pick_res["state"]

    # Sanity: state now has the evolved option
    assert state["overrides"].get("color", {}).get("accent") == (
        alt_opt.token_delta.get("color", {}).get("accent")
    ), "evolved accent not in overrides"

    # Capture a snapshot of state before save for later comparison
    pre_save_state = dict(state)

    # --- Step 3: draft-save ---------------------------------------------------
    save_res = _cli(["draft-save", "--product", "E2EFlow1Prod"], state)
    draft_id = save_res["draft_id"]
    assert draft_id

    # --- Step 4: draft-resume — must equal pre-save state ---------------------
    resume_res = _cli(
        ["draft-resume", "--product", "E2EFlow1Prod", "--draft-id", draft_id]
    )
    resumed = resume_res["state"]

    assert resumed["overrides"] == pre_save_state["overrides"], (
        "Resumed overrides differ from pre-save state"
    )
    assert resumed["history"] == pre_save_state["history"], (
        "Resumed history differs from pre-save state"
    )
    # Baseline should also be preserved
    assert resumed["baseline"] == pre_save_state["baseline"], (
        "Resumed baseline differs from pre-save state"
    )

    # --- Step 5: draft-promote — assert valid versioned DESIGN.md ------------
    outdir = tempfile.mkdtemp()
    promote_res = _cli(["draft-promote", "--out", outdir, "--name", "E2EFlow1"], resumed)
    promoted = promote_res["promoted"]

    assert os.path.isfile(promoted["path"]), f"DESIGN.md not written to {promoted['path']}"
    assert promoted["version"], "promoted version should be set"

    text = open(promoted["path"], encoding="utf-8").read()

    # The evolved accent must appear in the emitted file
    evolved_accent = alt_opt.token_delta.get("color", {}).get("accent")
    if evolved_accent:
        assert evolved_accent in text, (
            f"Evolved accent {evolved_accent!r} not found in promoted DESIGN.md"
        )

    # version must be stamped in the file
    assert "version:" in text, "version field not in promoted DESIGN.md"

    # Only DESIGN.md written (no stray files)
    _assert_only_design_files(outdir)

    # --- Step 6: validate emitted DESIGN.md parses back cleanly --------------
    from designer.extract.import_design import split_frontmatter

    fm, _ = split_frontmatter(text)
    doc = parse(fm)
    assert isinstance(doc, dict), "promoted DESIGN.md frontmatter should parse to a dict"
    vr = validate_design_md(doc)
    assert vr.ok, f"Promoted DESIGN.md fails schema validation: {vr.errors}"


def test_flow1_resumed_state_equals_pre_save():
    """Dedicated assertion: resume exactly restores overrides, history, baseline."""
    cat = _catalog()
    by_id = cat.by_id()

    # Build a state with two picks
    st = TasteState(context={"description": "resume test"})
    c1 = by_id["color-accent-system"]
    st.apply_pick(c1.id, c1.options[0].id, c1.options[0].token_delta, source="import")
    c2 = by_id["color-dark-mode"]
    st.apply_pick(c2.id, c2.options[0].id, c2.options[0].token_delta, source="pick")
    st.baseline = dict(st.overrides)  # simulate post-import baseline

    # Save then resume
    save_res = _cli(["draft-save", "--product", "ResumeTest"], st.to_dict())
    draft_id = save_res["draft_id"]
    resume_res = _cli(["draft-resume", "--product", "ResumeTest", "--draft-id", draft_id])
    resumed = resume_res["state"]

    assert resumed["overrides"] == st.overrides
    assert resumed["history"] == st.history
    assert resumed["baseline"] == st.baseline


# ---------------------------------------------------------------------------
# FLOW 2: generate → accept-deltas → promote
# ---------------------------------------------------------------------------

def test_flow2_generate_accept_promote():
    """accept-deltas (source=generate) → draft-promote includes accepted accent."""
    # --- Step 1: init fresh state --------------------------------------------
    init_res = _cli(["init", "--context", "generative promote flow"])
    state = init_res["state"]

    # --- Step 2: accept-deltas a generated token_delta -----------------------
    generated_accent = "#5E5CE6"
    deltas_file = os.path.join(tempfile.gettempdir(), "e2e_flow2_deltas.json")
    with open(deltas_file, "w", encoding="utf-8") as fh:
        json.dump({"color": {"accent": generated_accent}}, fh)

    accept_res = _cli(["accept-deltas", "--deltas", deltas_file], state)
    state = accept_res["state"]

    # Confirm the accent is in overrides and history source=generate
    assert state["overrides"].get("color", {}).get("accent") == generated_accent
    assert any(h["source"] == "generate" for h in state["history"]), (
        "history should have a generate-sourced entry after accept-deltas"
    )

    # --- Step 3: draft-promote -----------------------------------------------
    outdir = tempfile.mkdtemp()
    promote_res = _cli(["draft-promote", "--out", outdir, "--name", "Flow2Prod"], state)
    promoted = promote_res["promoted"]

    assert os.path.isfile(promoted["path"])
    text = open(promoted["path"], encoding="utf-8").read()

    # The accepted accent must be in the emitted DESIGN.md
    assert generated_accent in text, (
        f"Accepted accent {generated_accent!r} not found in promoted DESIGN.md"
    )
    assert "version:" in text

    # --- Assert only DESIGN.md written (no git, no stray files) -------------
    _assert_only_design_files(outdir)


def test_flow2_promoted_design_md_is_schema_valid():
    """The DESIGN.md produced in Flow 2 passes schema validation."""
    from designer.extract.import_design import split_frontmatter

    init_res = _cli(["init", "--context", "schema-valid flow 2"])
    state = init_res["state"]

    deltas_file = os.path.join(tempfile.gettempdir(), "e2e_flow2_valid_deltas.json")
    with open(deltas_file, "w", encoding="utf-8") as fh:
        json.dump({"color": {"accent": "#0A84FF"}}, fh)

    accept_res = _cli(["accept-deltas", "--deltas", deltas_file], state)
    state = accept_res["state"]

    outdir = tempfile.mkdtemp()
    _cli(["draft-promote", "--out", outdir, "--name", "SchemaValidProd"], state)

    text = open(os.path.join(outdir, "DESIGN.md"), encoding="utf-8").read()
    fm, _ = split_frontmatter(text)
    doc = parse(fm)
    vr = validate_design_md(doc)
    assert vr.ok, f"Flow 2 DESIGN.md fails schema validation: {vr.errors}"


# ---------------------------------------------------------------------------
# Cross-flow: no git operations (tool must not write .git or call git CLI)
# ---------------------------------------------------------------------------

def test_promote_no_git_objects_written():
    """Promoting to a plain directory must not create .git or any git objects."""
    init_res = _cli(["init", "--context", "no git test"])
    state = init_res["state"]

    deltas_file = os.path.join(tempfile.gettempdir(), "e2e_no_git_deltas.json")
    with open(deltas_file, "w", encoding="utf-8") as fh:
        json.dump({"color": {"accent": "#0A84FF"}}, fh)

    accept_res = _cli(["accept-deltas", "--deltas", deltas_file], state)
    state = accept_res["state"]

    outdir = tempfile.mkdtemp()
    _cli(["draft-promote", "--out", outdir, "--name", "NoGitProd"], state)

    # No .git directory should exist
    assert not os.path.exists(os.path.join(outdir, ".git")), (
        ".git directory was created by promote — tool must not run git"
    )
    _assert_only_design_files(outdir)


def test_second_promote_non_git_creates_bak():
    """Second promote to a non-git dir creates .bak; no other stray files."""
    init_res = _cli(["init", "--context", "bak test"])
    state = init_res["state"]

    deltas_file = os.path.join(tempfile.gettempdir(), "e2e_bak_deltas.json")
    with open(deltas_file, "w", encoding="utf-8") as fh:
        json.dump({"color": {"accent": "#0A84FF"}}, fh)

    accept_res = _cli(["accept-deltas", "--deltas", deltas_file], state)
    state = accept_res["state"]

    outdir = tempfile.mkdtemp()
    # First promote
    _cli(["draft-promote", "--out", outdir, "--name", "BakProd"], state)
    # Second promote
    res2 = _cli(["draft-promote", "--out", outdir, "--name", "BakProd"], state)
    promoted = res2["promoted"]

    # .bak should exist (non-git dir, second write)
    assert promoted["backed_up"] is not None, "Expected backed_up path on second promote"
    assert os.path.isfile(promoted["backed_up"]), f"bak file missing: {promoted['backed_up']}"

    # Only DESIGN.md + DESIGN.md.bak
    _assert_only_design_files(outdir, allow_bak=True)
