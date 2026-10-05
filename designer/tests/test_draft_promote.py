"""Tests for draft save/load/list, delta_since, promote, and the git-safety assertion.

Run: python -m pytest designer/tests/test_draft_promote.py -q
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

from designer.engine.state import TasteState
from designer.engine.catalog_loader import load_catalog
from designer.engine.draft import make_draft, save_draft, load_draft, list_drafts, record_baseline
from designer.emit.promote import promote_draft, _is_git_repo, _bump_version


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _catalog():
    return load_catalog(strict=False)


def _cli(args, state=None):
    """Subprocess helper matching test_chunk6_integration pattern."""
    full = [sys.executable, "-m", "designer.engine.cli", *args]
    if state is not None:
        sf = os.path.join(tempfile.gettempdir(), "ci_draft_state.json")
        with open(sf, "w") as fh:
            json.dump(state, fh)
        full += ["--state", sf]
    p = subprocess.run(full, cwd=_ROOT, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def _state_with_picks():
    """Build a TasteState with a few picks and a baseline set."""
    cat = _catalog()
    by_id = cat.by_id()
    st = TasteState(context={"description": "test product"})
    # Pick color-accent-system
    c = by_id["color-accent-system"]
    opt0 = c.options[0]
    st.apply_pick(c.id, opt0.id, opt0.token_delta, source="pick")
    # Pick type-heading-style
    c2 = by_id["type-heading-style"]
    opt2 = c2.options[0]
    st.apply_pick(c2.id, opt2.id, opt2.token_delta, source="pick")
    # Record a baseline (post-picks)
    st.baseline = record_baseline(st.to_dict())
    return st


# ---------------------------------------------------------------------------
# delta_since
# ---------------------------------------------------------------------------

def test_delta_since_returns_changed_keys():
    """delta_since with a baseline missing the new key returns that key."""
    st = TasteState()
    st.overrides = {"color": {"accent": "#0A6CFF", "bg": "#fff"}}
    baseline = {"color": {"accent": "#000"}}
    delta = st.delta_since(baseline)
    # accent changed + bg added
    assert delta.get("color", {}).get("accent") == "#0A6CFF"
    assert delta.get("color", {}).get("bg") == "#fff"


def test_delta_since_equal_baseline_is_empty():
    """delta_since when overrides == baseline returns {} and has_delta is False."""
    st = TasteState()
    st.overrides = {"color": {"accent": "#0A6CFF"}}
    st.baseline = {"color": {"accent": "#0A6CFF"}}
    delta = st.delta_since()
    assert delta == {}, delta
    assert st.has_delta() is False


def test_delta_since_added_key_shows_in_delta():
    """A key present in overrides but absent from baseline appears in delta."""
    st = TasteState()
    st.overrides = {"color": {"accent": "#0A6CFF", "bg": "#fff"}}
    baseline = {"color": {"accent": "#0A6CFF"}}
    delta = st.delta_since(baseline)
    assert "bg" in delta.get("color", {}), delta
    assert "accent" not in delta.get("color", {}), "unchanged accent should not be in delta"


def test_has_delta_true_when_overrides_differ():
    """has_delta() returns True when overrides differ from baseline."""
    st = TasteState()
    st.overrides = {"color": {"accent": "#0A6CFF"}}
    st.baseline = {"color": {"accent": "#000"}}
    assert st.has_delta() is True


def test_has_delta_false_when_equal():
    """has_delta() returns False when overrides match baseline exactly."""
    st = TasteState()
    st.overrides = {"color": {"accent": "#0A6CFF"}}
    st.baseline = {"color": {"accent": "#0A6CFF"}}
    assert st.has_delta() is False


# ---------------------------------------------------------------------------
# Draft save / load / list roundtrip
# ---------------------------------------------------------------------------

def test_draft_save_creates_file():
    """save_draft creates the file on disk and returns a non-empty path."""
    st = _state_with_picks()
    plugin_root = tempfile.mkdtemp()
    draft = make_draft(st.to_dict(), product="TestProduct", baseline_overrides=st.baseline)
    res = save_draft(plugin_root, draft)

    assert os.path.isfile(res["path"]), f"draft file not found at {res['path']}"
    assert res["bytes"] > 0
    assert res["draft_id"] == draft["draft_id"]


def test_draft_load_returns_equal_state():
    """load_draft returns a record whose state_snapshot equals the saved one."""
    st = _state_with_picks()
    plugin_root = tempfile.mkdtemp()
    draft = make_draft(st.to_dict(), product="TestProduct", baseline_overrides=st.baseline)
    res = save_draft(plugin_root, draft)

    loaded = load_draft(plugin_root, "TestProduct", res["draft_id"])
    assert loaded is not None
    assert loaded["state_snapshot"] == st.to_dict()


def test_draft_list_returns_saved_draft():
    """list_drafts returns an entry matching the saved draft_id."""
    st = _state_with_picks()
    plugin_root = tempfile.mkdtemp()
    draft = make_draft(st.to_dict(), product="TestProduct", baseline_overrides=st.baseline)
    res = save_draft(plugin_root, draft)

    drafts = list_drafts(plugin_root, product="TestProduct")
    assert len(drafts) >= 1
    ids = [d["draft_id"] for d in drafts]
    assert res["draft_id"] in ids, ids


def test_draft_load_missing_id_returns_none():
    """load_draft with a nonexistent draft_id returns None, does not raise."""
    plugin_root = tempfile.mkdtemp()
    result = load_draft(plugin_root, "NoProduct", "draft-does-not-exist")
    assert result is None


def test_draft_load_corrupt_file_returns_none():
    """load_draft when the file is not valid JSON returns None gracefully."""
    st = _state_with_picks()
    plugin_root = tempfile.mkdtemp()
    draft = make_draft(st.to_dict(), product="TestProduct", baseline_overrides=st.baseline)
    res = save_draft(plugin_root, draft)

    # Overwrite with garbage
    with open(res["path"], "w") as fh:
        fh.write("NOT VALID JSON { definitely not")

    loaded = load_draft(plugin_root, "TestProduct", res["draft_id"])
    assert loaded is None


# ---------------------------------------------------------------------------
# TasteState round-trips through a draft
# ---------------------------------------------------------------------------

def test_taste_state_roundtrips_through_draft():
    """A TasteState with picks + baseline survives make→save→load→from_dict
    with identical overrides/history/asked/baseline."""
    cat = _catalog()
    by_id = cat.by_id()
    st = TasteState(context={"description": "roundtrip test"})
    c = by_id["color-accent-system"]
    opt = c.options[0]
    st.apply_pick(c.id, opt.id, opt.token_delta, source="import")
    c2 = by_id["color-dark-mode"]
    opt2 = c2.options[0]
    st.apply_pick(c2.id, opt2.id, opt2.token_delta, source="pick")
    st.baseline = record_baseline(st.to_dict())

    plugin_root = tempfile.mkdtemp()
    draft = make_draft(st.to_dict(), product="RoundTripProd", baseline_overrides=st.baseline)
    res = save_draft(plugin_root, draft)

    loaded_draft = load_draft(plugin_root, "RoundTripProd", res["draft_id"])
    assert loaded_draft is not None
    st2 = TasteState.from_dict(loaded_draft["state_snapshot"])

    assert st2.overrides == st.overrides
    assert st2.history == st.history
    assert st2.asked == st.asked
    assert st2.baseline == st.baseline


# ---------------------------------------------------------------------------
# promote — _is_git_repo
# ---------------------------------------------------------------------------

def test_is_git_repo_non_git_dir_false():
    """_is_git_repo on a plain tempdir (no .git) returns False."""
    tmpdir = tempfile.mkdtemp()
    assert _is_git_repo(tmpdir) is False


def test_is_git_repo_with_git_subdir_true():
    """_is_git_repo on a dir with a .git subdirectory returns True."""
    tmpdir = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmpdir, ".git"))
    assert _is_git_repo(tmpdir) is True


# ---------------------------------------------------------------------------
# promote — _bump_version
# ---------------------------------------------------------------------------

def test_bump_version_integer():
    """Integer version increments by 1."""
    result = _bump_version("version: 3", None)
    assert result == "4", result


def test_bump_version_dotted():
    """Dotted-numeric version increments the last segment."""
    result = _bump_version("version: 1.2", None)
    assert result == "1.3", result


def test_bump_version_explicit_overrides():
    """Explicit version is used verbatim regardless of existing."""
    result = _bump_version("version: 3", "9.0.0")
    assert result == "9.0.0", result


def test_bump_version_no_prior_returns_timestamp():
    """When no existing text, returns a non-empty UTC timestamp string."""
    result = _bump_version(None, None)
    assert result  # non-empty
    # Should look like a timestamp
    assert len(result) >= 10


# ---------------------------------------------------------------------------
# promote_draft — backup policy and git detection
# ---------------------------------------------------------------------------

def test_promote_first_write_no_bak():
    """First promote to a non-git dir writes DESIGN.md with backed_up=None."""
    plugin_root = tempfile.mkdtemp()
    st = _state_with_picks()
    draft = make_draft(st.to_dict(), product="TestProd", baseline_overrides=st.baseline)
    outdir = tempfile.mkdtemp()  # no .git

    res = promote_draft(draft, outdir, name="TestProd")
    assert os.path.isfile(os.path.join(outdir, "DESIGN.md"))
    assert res["is_git"] is False
    assert res["backed_up"] is None
    assert res["version"]


def test_promote_second_write_creates_bak_and_bumps_version():
    """Second promote to a non-git dir creates .bak + warning + version differs."""
    outdir = tempfile.mkdtemp()  # no .git
    st = _state_with_picks()
    draft = make_draft(st.to_dict(), product="TestProd", baseline_overrides=st.baseline)

    res1 = promote_draft(draft, outdir, name="TestProd")
    prior_v = res1["version"]

    res2 = promote_draft(draft, outdir, name="TestProd")
    assert res2["backed_up"] is not None
    assert os.path.isfile(res2["backed_up"]), f"bak file not found: {res2['backed_up']}"
    assert res2["warning"] is not None
    assert res2["version"] != prior_v or res2["prior_version"] is not None


def test_promote_git_dir_no_bak():
    """Promote to a git-tracked dir does NOT create a .bak file."""
    outdir = tempfile.mkdtemp()
    os.makedirs(os.path.join(outdir, ".git"))
    st = _state_with_picks()
    draft = make_draft(st.to_dict(), product="TestProd", baseline_overrides=st.baseline)

    # Write twice
    promote_draft(draft, outdir, name="TestProd")
    res2 = promote_draft(draft, outdir, name="TestProd")

    assert res2["is_git"] is True
    assert res2["backed_up"] is None
    bak_path = os.path.join(outdir, "DESIGN.md.bak")
    assert not os.path.exists(bak_path), ".bak should not be created for git repos"


# ---------------------------------------------------------------------------
# HARD ASSERTION: promote.py must never import subprocess for git
# ---------------------------------------------------------------------------

def test_promote_never_imports_subprocess_for_git():
    """The promote write path must not import subprocess (no git subprocess
    calls allowed).

    The tool is documented as 'pure stdlib, no subprocess, no git commands.'
    This test proves the invariant at the AST/import level for EVERY module on
    the promote write path: no actual import statement for subprocess exists in
    the source (a docstring may mention it, but there must be no live import).

    surgical_merge is included because promote.py delegates the imported-doc
    write to it — the no-subprocess guarantee must cover the whole write path,
    not just the entry module.
    """
    import ast
    import designer.emit.promote as promote_module
    import designer.emit.surgical_merge as surgical_merge_module

    for module in (promote_module, surgical_merge_module):
        src = open(module.__file__, encoding="utf-8").read()
        tree = ast.parse(src)

        subprocess_imported = False
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "subprocess" or alias.name.startswith("subprocess."):
                        subprocess_imported = True
            elif isinstance(node, ast.ImportFrom):
                if node.module and (
                    node.module == "subprocess"
                    or node.module.startswith("subprocess.")
                ):
                    subprocess_imported = True

        assert not subprocess_imported, (
            f"{os.path.basename(module.__file__)} must not import subprocess — "
            "the tool is documented as 'pure stdlib, no subprocess, no git "
            "commands.' Found a live subprocess import statement in the AST."
        )


# ---------------------------------------------------------------------------
# Draft CLI: draft-save / draft-list / draft-resume
# ---------------------------------------------------------------------------

def test_cli_draft_save_list_resume_roundtrip():
    """draft-save → draft-list shows it → draft-resume returns correct state."""
    # Build a state with a pick
    cat = _catalog()
    by_id = cat.by_id()
    st = TasteState(context={"description": "cli roundtrip"})
    c = by_id["color-accent-system"]
    opt = c.options[0]
    st.apply_pick(c.id, opt.id, opt.token_delta, source="pick")

    # Save via CLI
    res_save = _cli(["draft-save", "--product", "CliRoundTrip"], st.to_dict())
    draft_id = res_save["draft_id"]
    assert draft_id

    # List via CLI
    res_list = _cli(["draft-list", "--product", "CliRoundTrip"])
    ids = [d["draft_id"] for d in res_list["drafts"]]
    assert draft_id in ids

    # Resume via CLI
    res_resume = _cli(["draft-resume", "--product", "CliRoundTrip", "--draft-id", draft_id])
    resumed_state = res_resume["state"]
    # Must have the same overrides
    assert resumed_state["overrides"] == st.overrides


# ---------------------------------------------------------------------------
# Draft promote via CLI
# ---------------------------------------------------------------------------

def test_cli_draft_promote_writes_versioned_design_md():
    """draft-promote via CLI writes a DESIGN.md with a version field to --out."""
    cat = _catalog()
    by_id = cat.by_id()
    st = TasteState(context={"description": "cli promote test"})
    c = by_id["color-accent-system"]
    opt = c.options[0]
    st.apply_pick(c.id, opt.id, opt.token_delta, source="pick")

    outdir = tempfile.mkdtemp()
    res = _cli(["draft-promote", "--out", outdir, "--name", "CliProd"], st.to_dict())
    promoted = res["promoted"]

    assert os.path.isfile(promoted["path"]), f"DESIGN.md not written to {promoted['path']}"
    text = open(promoted["path"], encoding="utf-8").read()
    assert "version:" in text, "version field not found in promoted DESIGN.md"
    assert promoted["version"]
