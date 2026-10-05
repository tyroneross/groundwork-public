import json
import shlex
from pathlib import Path

import pytest

from designer.bridge.resolve_visual_session import resolve
from designer.bridge.visual_bootstrap import initialize_taste_state, load_visual_bootstrap
from designer.engine.catalog_loader import load_catalog
from designer.engine.contract import build_decision_contract


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "engine" / "fixtures" / "sample-spec.json"


def test_initial_idea_resolves_every_session_value():
    session = resolve("A calm planning app", None, "Calm Plan")
    assert session["GW_STAGE"] == "initial-idea"
    assert session["GW_SLUG"] == "calm-plan"
    assert session["GW_SPEC"] == ""
    assert session["GW_REPO"] == ""
    assert session["GW_OUT"].endswith("/dev/designs/calm-plan")


def test_existing_repo_keeps_source_and_designdoc_output_separate(tmp_path):
    repo = tmp_path / "Existing App"
    (repo / ".git").mkdir(parents=True)
    session = resolve("Preserve the current app", str(repo), None)
    assert session["GW_STAGE"] == "existing-app"
    assert session["GW_REPO"] == str(repo)
    assert session["GW_OUT"] == str(repo / ".designdoc")
    assert session["GW_SPEC"] == ""
    assert session["GW_BOOTSTRAP"] == ""
    assert "platform remains unresolved" in session["GW_BOOTSTRAP_WARNINGS"]


def test_existing_spec_flattens_typed_ui_context_and_selection(tmp_path):
    out = tmp_path / ".designdoc"
    (out / "mockups").mkdir(parents=True)
    spec = json.loads(FIXTURE.read_text())
    spec["projectContext"]["sourceRepo"] = str(tmp_path)
    (out / "spec.json").write_text(json.dumps(spec))
    (out / "mockups" / "selection.json").write_text(
        json.dumps({"rationale": "Keep the warm hierarchy"})
    )
    session = resolve("Keep the style but make the history denser", str(out / "spec.json"), None)
    assert session["GW_STAGE"] == "existing-app"
    assert session["GW_NAME"] == "StrideStreak"
    assert "glanceable and sparse" in session["GW_DESC"]
    assert "encouraging, focused, energetic" in session["GW_DESC"]
    assert "Current baseline:" in session["GW_DESC"]
    assert "Current requested delta: Keep the style but make the history denser" in session["GW_DESC"]
    assert "Keep the warm hierarchy" in session["GW_DESC"]
    assert session["GW_SELECTION"].endswith("mockups/selection.json")
    bootstrap = load_visual_bootstrap(session["GW_BOOTSTRAP"])
    assert bootstrap["drive"] == "adaptive"
    assert bootstrap["entryBehavior"] == "review-baseline"
    assert bootstrap["product"]["outputPath"] == str(out)
    assert bootstrap["knownFacts"][0]["categoryId"] == "platform-target"


def test_design_seed_inside_repo_uses_owned_designdoc(tmp_path):
    repo = tmp_path / "Product"
    (repo / ".git").mkdir(parents=True)
    seed = repo / "DESIGN.md"
    seed.write_text("# Existing design")
    session = resolve("Evolve this direction", str(seed), None)
    assert session["GW_STAGE"] == "known-preference"
    assert session["GW_REPO"] == str(repo)
    assert session["GW_OUT"] == str(repo / ".designdoc")
    assert session["GW_DESIGN_SEED"] == str(seed)


@pytest.mark.parametrize("manifest", ["package.json", "pyproject.toml", "Package.swift", "project.yml"])
def test_design_seed_uses_nearest_non_git_repo_manifest(tmp_path, manifest):
    outer = tmp_path / "Outer"
    inner = outer / "packages" / "Product"
    inner.mkdir(parents=True)
    (outer / "package.json").write_text("{}")
    (inner / manifest).write_text("{}")
    seed = inner / "DESIGN.md"
    seed.write_text("# Existing design")
    session = resolve("Evolve this direction", str(seed), None)
    assert session["GW_REPO"] == str(inner)
    assert session["GW_OUT"] == str(inner / ".designdoc")


def test_design_seed_recognizes_git_worktree_file(tmp_path):
    repo = tmp_path / "Worktree"
    repo.mkdir()
    (repo / ".git").write_text("gitdir: /tmp/example")
    seed = repo / "DESIGN.md"
    seed.write_text("# Existing design")
    assert resolve("Evolve", str(seed), None)["GW_REPO"] == str(repo)


def test_explicit_missing_or_unsupported_target_fails(tmp_path):
    with pytest.raises(ValueError, match="does not exist"):
        resolve("Inspect it", str(tmp_path / "missing"), None)
    unsupported = tmp_path / "notes.txt"
    unsupported.write_text("not a supported design seed")
    with pytest.raises(ValueError, match="unsupported design seed"):
        resolve("Inspect it", str(unsupported), None)


def test_broken_target_symlink_fails(tmp_path):
    target = tmp_path / "broken.md"
    target.symlink_to(tmp_path / "missing.md")
    with pytest.raises(ValueError, match="does not exist"):
        resolve("Inspect it", str(target), None)


def test_selection_rationale_rejects_symlink_and_oversize(tmp_path):
    repo = tmp_path / "Product"
    mockups = repo / ".designdoc" / "mockups"
    mockups.mkdir(parents=True)
    (repo / "package.json").write_text("{}")
    outside = tmp_path / "outside.json"
    outside.write_text(json.dumps({"rationale": "outside evidence"}))
    selection = mockups / "selection.json"
    selection.symlink_to(outside)
    with pytest.raises(ValueError, match="regular file"):
        resolve("Evolve", str(repo), None)
    selection.unlink()
    selection.write_bytes(b" " * (256 * 1024 + 1))
    with pytest.raises(ValueError, match="256 KiB"):
        resolve("Evolve", str(repo), None)


def test_shell_format_values_are_quote_safe(tmp_path):
    request = "App with spaces; $(touch /tmp/never-run) and 'quotes'"
    session = resolve(request, None, "Quoted App")
    rendered = [f"{key}={shlex.quote(value)}" for key, value in session.items()]
    parsed = {
        line.split("=", 1)[0]: shlex.split(line.split("=", 1)[1])[0]
        for line in rendered
    }
    assert parsed == session


def test_v3_spec_bootstrap_preserves_primary_companion_and_design_fact(tmp_path):
    repo = tmp_path / "Spectra"
    out = repo / ".designdoc"
    out.mkdir(parents=True)
    (repo / ".git").mkdir()
    (out / "design.md").write_text("# Aurora workbench\nUse a persistent left sidebar.")
    spec = {
        "productName": "Spectra",
        "productDescription": "Campaign editor",
        "platformTarget": "macos",
        "platformSurfaces": [
            {
                "id": "surface-macos", "platform": "macos", "role": "primary",
                "name": "Spectra Studio", "interactionModes": ["pointer", "keyboard"],
                "featureIds": [], "provenance": "observed",
            },
            {
                "id": "surface-web", "platform": "web", "role": "companion",
                "name": "Spectra Review", "interactionModes": ["pointer"],
                "featureIds": [], "provenance": "observed",
            },
        ],
    }
    (out / "spec.json").write_text(json.dumps(spec))

    session = resolve(
        "Refine onboarding",
        str(repo),
        None,
        "http://127.0.0.1:4173",
    )
    bootstrap = load_visual_bootstrap(session["GW_BOOTSTRAP"])

    assert [(s["platform"], s["role"]) for s in bootstrap["context"]["platformSurfaces"]] == [
        ("macos", "primary"),
        ("web", "companion"),
    ]
    facts = {(fact["categoryId"], fact["optionId"]) for fact in bootstrap["knownFacts"]}
    assert ("platform-target", "platform-macos") in facts
    assert ("nav-structure", "nav-structure-left") in facts
    assert bootstrap["context"]["designBaseline"]["seed"]
    assert bootstrap["product"]["runningUrl"] == "http://127.0.0.1:4173"


def test_raw_spectra_repo_discovers_topology_and_known_layout(tmp_path):
    repo = tmp_path / "Spectra"
    (repo / "web").mkdir(parents=True)
    (repo / "docs").mkdir()
    (repo / "Package.swift").write_text(
        '// swift-tools-version: 6.0\nlet package = Package(platforms: [.macOS(.v14)])\n'
    )
    (repo / "web" / "package.json").write_text(json.dumps({
        "name": "spectra-web",
        "description": "Read-mostly web companion",
        "dependencies": {"next": "15.1.0", "react": "19.0.0"},
    }))
    (repo / "README.md").write_text(
        "# Spectra\n"
        "A native macOS primary editor/workbench with a toolbar and persistent left sidebar.\n"
        "A compact menu-bar controller uses an NSStatusItem popover.\n"
        "The read-mostly web companion supports review and sharing.\n"
    )
    (repo / "docs" / "surfaces.md").write_text(
        "macOS workbench: primary. Menu bar: compact controller. Web: companion.\n"
    )

    session = resolve("Understand this existing app", str(repo), "Spectra")
    bootstrap = load_visual_bootstrap(session["GW_BOOTSTRAP"])

    assert [(surface["id"], surface["platform"], surface["role"]) for surface in bootstrap["context"]["platformSurfaces"]] == [
        ("surface-macos", "macos", "primary"),
        ("surface-web", "web", "companion"),
        ("surface-menubar", "macos", "extension"),
    ]
    assert set(bootstrap["sourcePaths"]) == {
        "Package.swift", "web/package.json", "README.md", "docs/surfaces.md",
    }
    facts = {(fact["categoryId"], fact["optionId"]) for fact in bootstrap["knownFacts"]}
    assert ("platform-target", "platform-macos") in facts
    assert ("nav-structure", "nav-structure-left") in facts
    assert "toolbar" in bootstrap["context"]["designBaseline"]["seed"].lower()
    contract = build_decision_contract(
        initialize_taste_state(bootstrap, catalog=load_catalog()),
        load_catalog(),
    )
    candidate_ids = {candidate["id"] for candidate in contract["candidates"]}
    assert contract["candidates"][0]["id"] not in {"platform-target", "nav-structure"}
    assert {"sheet-size", "nav-tabbar", "micro-haptics"}.isdisjoint(candidate_ids)


def test_nested_tooling_package_is_not_inferred_as_web_surface(tmp_path):
    repo = tmp_path / "NativeProduct"
    (repo / "packages" / "tooling").mkdir(parents=True)
    (repo / "Package.swift").write_text(
        '// swift-tools-version: 6.0\nlet package = Package(platforms: [.macOS(.v14)])\n'
    )
    (repo / "packages" / "tooling" / "package.json").write_text(json.dumps({
        "name": "release-tooling", "devDependencies": {"typescript": "5.9.0"},
    }))

    session = resolve("Understand this app", str(repo), "NativeProduct")
    bootstrap = load_visual_bootstrap(session["GW_BOOTSTRAP"])
    assert [(surface["platform"], surface["role"]) for surface in bootstrap["context"]["platformSurfaces"]] == [
        ("macos", "primary"),
    ]
    assert "packages/tooling/package.json" not in bootstrap["sourcePaths"]


def test_root_tooling_package_is_not_inferred_as_web_surface(tmp_path):
    repo = tmp_path / "NativeProduct"
    repo.mkdir()
    (repo / "Package.swift").write_text(
        '// swift-tools-version: 6.0\nlet package = Package(platforms: [.macOS(.v14)])\n'
    )
    (repo / "package.json").write_text(json.dumps({
        "name": "native-build-tools", "devDependencies": {"typescript": "5.9.0"},
    }))

    session = resolve("Understand this app", str(repo), "NativeProduct")
    bootstrap = load_visual_bootstrap(session["GW_BOOTSTRAP"])
    assert [(surface["platform"], surface["role"]) for surface in bootstrap["context"]["platformSurfaces"]] == [
        ("macos", "primary"),
    ]
    assert "package.json" not in bootstrap["sourcePaths"]


def test_explicit_docs_can_make_web_primary_over_native_surface(tmp_path):
    repo = tmp_path / "WebFirst"
    (repo / "web").mkdir(parents=True)
    (repo / "Package.swift").write_text(
        '// swift-tools-version: 6.0\nlet package = Package(platforms: [.macOS(.v14)])\n'
    )
    (repo / "web" / "package.json").write_text(json.dumps({
        "dependencies": {"next": "15.1.0", "react": "19.0.0"},
    }))
    (repo / "README.md").write_text(
        "The web application is the primary product surface. The macOS utility is a companion.\n"
    )

    session = resolve("Understand this app", str(repo), "WebFirst")
    bootstrap = load_visual_bootstrap(session["GW_BOOTSTRAP"])
    assert [(surface["platform"], surface["role"]) for surface in bootstrap["context"]["platformSurfaces"]] == [
        ("macos", "companion"),
        ("web", "primary"),
    ]


def test_repo_docs_symlink_and_oversize_are_not_used_as_evidence(tmp_path):
    repo = tmp_path / "Product"
    (repo / "docs").mkdir(parents=True)
    (repo / "Package.swift").write_text(
        '// swift-tools-version: 6.0\nlet package = Package(platforms: [.macOS(.v14)])\n'
    )
    outside = tmp_path / "outside.md"
    outside.write_text("persistent left sidebar")
    (repo / "README.md").symlink_to(outside)
    (repo / "docs" / "surfaces.md").write_bytes(b"x" * (256 * 1024 + 1))

    session = resolve("Understand this app", str(repo), "Product")
    bootstrap = load_visual_bootstrap(session["GW_BOOTSTRAP"])
    assert bootstrap["sourcePaths"] == ["Package.swift"]
    assert "designBaseline" not in bootstrap["context"]
    assert {fact["categoryId"] for fact in bootstrap["knownFacts"]} == {"platform-target"}
