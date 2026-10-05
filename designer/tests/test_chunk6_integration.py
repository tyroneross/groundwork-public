"""Chunk 6 integration test — the full revealed-preference loop end to end
through the CLI bridge (what the Node server calls), and the plugin still loads.

Verifies F1 + F5 end-to-end: init -> walk -> emit a valid, platform-aware
DESIGN.md reflecting the picks, with per-decision 3-platform previews.

Run: python3 designer/tests/test_chunk6_integration.py
"""

from __future__ import annotations

import json
import hashlib
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)


def _cli(args, state=None):
    full = [sys.executable, "-m", "designer.engine.cli", *args]
    sf = None
    if state is not None:
        with tempfile.NamedTemporaryFile(
            prefix="ci_designer_state_", suffix=".json", mode="w", delete=False
        ) as fh:
            json.dump(state, fh)
            sf = fh.name
        full += ["--state", sf]
    try:
        p = subprocess.run(full, cwd=ROOT, capture_output=True, text=True)
        assert p.returncode == 0, p.stderr
        return json.loads(p.stdout)
    finally:
        if sf is not None:
            os.unlink(sf)


def test_full_loop_emits_valid_design_md():
    state = _cli(["init", "--context", "a dense crypto trading dashboard"])["state"]
    picks = 0
    first_decision_id = None
    valid_platforms = {"web", "ios", "macos"}
    for _ in range(14):
        step = _cli(["step"], state)
        state = step["state"]
        if step["action"] == "done":
            break
        if step["action"] == "ask":
            dec = step["decision"]
            if first_decision_id is None:
                first_decision_id = dec["category_id"]
            opt0 = dec["options"][0]
            # Layered walk + platform scoping: each decision carries a NON-EMPTY
            # subset of the platform columns. Before a platform is chosen the full
            # {web,ios,macos} set renders; once a single platform is picked the
            # cascade narrows downstream decisions to that column (the feature).
            pv_keys = set(opt0["previews"].keys())
            assert pv_keys and pv_keys.issubset(valid_platforms), pv_keys
            res = _cli(["pick", "--category", dec["category_id"], "--option", opt0["id"]], state)
            state = res["state"]
            picks += 1
    assert picks >= 1
    # Layer-first: the walk OPENS on the Layer-1 platform scope decision, not accent.
    assert first_decision_id == "platform-target", first_decision_id

    with tempfile.TemporaryDirectory() as d:
        out = _cli(["emit", "--out", d, "--name", "CryptoDash", "--version", "1.0.0"], state)
        path = out["written"]["path"]
        assert os.path.exists(path)
        text = open(path, encoding="utf-8").read()
        # F1: valid, platform-aware, prompt pack present
        assert "schema: design.md/v1" in text
        assert "platforms:" in text
        assert "AI Prompt Pack" in text
        for plat in ("web:", "ios:", "macos:"):
            assert plat in text, plat


def test_interactive_present_does_not_auto_record():
    """REGRESSION (auditor f1): the interactive path must NOT record a pick when
    surfacing a decision. `present` is non-mutating; only `pick` records.
    """
    state = _cli(["init", "--context", "x"])["state"]
    assert state.get("history", []) == []
    assert state.get("overrides", {}) == {}

    # present the first decision — MUST NOT mutate state
    step = _cli(["present"], state)
    state = step["state"]
    assert step["action"] == "ask"
    assert state.get("history", []) == [], "present auto-recorded a pick (f1 regression)"
    assert state.get("overrides", {}) == {}, "present mutated overrides before any pick"


def test_interactive_walk_tokens_trace_only_to_user_picks():
    """REGRESSION (auditor f1/f2): pick NON-first options and assert the emitted
    DESIGN.md carries only tokens the user actually chose — no phantom auto picks,
    no duplicate-category history.
    """
    state = _cli(["init", "--context", "a dense crypto dashboard"])["state"]
    user_picks = []
    for _ in range(12):
        step = _cli(["present"], state)
        state = step["state"]
        if step["action"] == "done":
            break
        dec = step["decision"]
        # pick the LAST option (non-first) where possible — exposes auto-record bugs
        opt = dec["options"][-1]
        res = _cli(["pick", "--category", dec["category_id"], "--option", opt["id"]], state)
        assert "error" not in res, res
        state = res["state"]
        user_picks.append((dec["category_id"], opt["id"]))

    history = state.get("history", [])
    # one history entry per user pick, no auto picks
    assert len(history) == len(user_picks), (len(history), len(user_picks))
    assert all(h.get("source") != "auto" for h in history), "phantom auto pick recorded"
    # no category recorded twice
    cats = [h["category_id"] for h in history]
    assert len(cats) == len(set(cats)), f"duplicate-category history: {cats}"
    # every recorded option matches what the user actually picked
    recorded = [(h["category_id"], h["option_id"]) for h in history]
    assert recorded == user_picks, (recorded, user_picks)


def test_unknown_category_pick_is_rejected():
    """auditor f3: --category is validated against the catalog."""
    state = _cli(["init", "--context", "x"])["state"]
    res = _cli(["pick", "--category", "no-such-category", "--option", "accent-cta-only"], state)
    assert "error" in res and "category" in res["error"]


def test_contract_path_available_for_host_llm():
    state = _cli(["init", "--context", "calm reader"])["state"]
    ctr = _cli(["contract"], state)["contract"]
    assert "answer" in ctr or "candidates" in ctr or "instructions" in ctr
    # candidates carry an information_gain score (the soft ranking signal)
    cands = ctr.get("candidates") or []
    if cands:
        assert "information_gain" in cands[0]


def test_current_previews_three_platforms():
    state = _cli(["init", "--context", "x"])["state"]
    cur = _cli(["current"], state)
    assert set(cur["previews"].keys()) == {"web", "ios", "macos"}


def test_plugin_manifests_valid_and_skills_resolve():
    claude_manifest = json.load(open(os.path.join(ROOT, ".claude-plugin", "plugin.json")))
    codex_manifest = json.load(open(os.path.join(ROOT, ".codex-plugin", "plugin.json")))
    package_manifest = json.load(open(os.path.join(ROOT, "package.json")))
    assert claude_manifest["name"] == "groundwork"
    assert codex_manifest["name"] == "groundwork"
    assert package_manifest["name"] == "groundwork"
    for key in ("version", "description", "author", "repository", "license", "keywords"):
        assert codex_manifest[key] == claude_manifest[key]
    for key in ("version", "description"):
        assert codex_manifest[key] == package_manifest[key]
    assert codex_manifest["skills"] == "./skills"
    assert codex_manifest["interface"]["displayName"] == "Groundwork"
    assert "Interactive" in codex_manifest["interface"]["capabilities"]

    command = open(os.path.join(ROOT, "commands", "run.md"), encoding="utf-8").read()
    skill_path = os.path.join(ROOT, "skills", "groundwork", "SKILL.md")
    skill = open(skill_path, encoding="utf-8").read()
    router = open(os.path.join(ROOT, "references", "router.md"), encoding="utf-8").read()
    design = open(os.path.join(ROOT, "references", "design.md"), encoding="utf-8").read()
    explore = open(os.path.join(ROOT, "references", "explore-ui.md"), encoding="utf-8").read()
    assert "references/router.md" in command
    assert "references/router.md" in skill
    for content in (command, skill, router, design, explore):
        assert "existing app" in content.lower()
    mockups = open(os.path.join(ROOT, "references", "mockups.md"), encoding="utf-8").read()
    for content in (router, design, explore, mockups):
        assert ".designdoc" in content
    for flow in ("design", "mockups", "explore-ui"):
        relative = f"references/{flow}.md"
        assert relative in router
        assert os.path.isfile(os.path.join(ROOT, relative))


def test_design_emitter_persists_spec_for_mockup_handoff():
    """The design output must contain the source Spec required by mockups."""
    fixture = os.path.join(ROOT, "engine", "fixtures", "sample-spec.json")
    cli = os.path.join(ROOT, "engine", "dist", "cli.js")
    scaffold = os.path.join(ROOT, "designer", "mockups", "scaffold.py")

    with tempfile.TemporaryDirectory() as design_dir:
        emitted = subprocess.run(
            ["node", cli, fixture, "--out", design_dir],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert emitted.returncode == 0, emitted.stderr

        spec_path = os.path.join(design_dir, "spec.json")
        assert spec_path in emitted.stdout
        builder_path = os.path.join(design_dir, "builder-handoff.md")
        assert builder_path in emitted.stdout
        persisted = json.load(open(spec_path, encoding="utf-8"))
        assert persisted["schemaVersion"] == 3
        assert persisted["productName"] == "StrideStreak"
        assert persisted["traceMatrix"], "canonical Spec omitted traceability"
        trace = persisted["traceMatrix"]
        assert trace["needToFeatures"]["need-one-tap-log"] == ["feat-today-log"]
        assert trace["featureToScreens"]["feat-today-log"] == ["screen-today"]
        assert trace["screenToTasks"]["screen-today"] == ["task-screen-screen-today"]
        assert "test-idempotent-log" in trace["taskToTests"]["task-screen-screen-today"]
        assert trace["integrationToTasks"]["int-healthkit"] == [
            "task-integration-int-healthkit"
        ]
        assert trace["integrationToTests"]["int-healthkit"] == ["test-healthkit-import"]
        assert trace["coverageGaps"] == []
        manifest_path = os.path.join(design_dir, "artifact-manifest.json")
        manifest = json.load(open(manifest_path, encoding="utf-8"))
        for item in manifest["files"]:
            actual = open(os.path.join(design_dir, item["name"]), "rb").read()
            assert hashlib.sha256(actual).hexdigest() == item["sha256"]
        steering = open(os.path.join(design_dir, "steering.md"), encoding="utf-8").read()
        assert "Must avoid" in steering
        assert "No visual preference artifact has been confirmed yet" in steering
        design_system = open(
            os.path.join(design_dir, "design-system.md"), encoding="utf-8"
        ).read()
        assert "embedded in the Builder Handoff" in design_system
        assert "No separate token sidecar is required" in design_system
        assert "design-tokens.md" not in design_system
        assert "/groundwork:explore-ui" not in design_system
        design_doc = open(os.path.join(design_dir, "design.md"), encoding="utf-8").read()
        assert "Enable the HealthKit capability" in design_doc
        assert "manual" in design_doc.lower()
        builder = open(builder_path, encoding="utf-8").read()
        for phrase in (
            "high-fidelity, near-production-ready",
            "External manual integrations",
            "Code the AI must complete",
            "Enable the HealthKit capability",
            "Completion report",
            "Embedded Groundwork contract",
            "task-integration-int-healthkit",
        ):
            assert phrase in builder
        assert "give it access to the sibling" not in builder
        assert "/path/to/StrideStreak" not in builder
        tasks = open(os.path.join(design_dir, "tasks.md"), encoding="utf-8").read()
        for heading in (
            "## Approach Lenses",
            "## Depends-on (reads-from)",
            "## Threat Model",
        ):
            assert heading in tasks
        assert "override: reads-from-dependency" in tasks
        assert "Inspect existing project and evolve the data model" in tasks
        assert "**Task ID:** `task-integration-int-healthkit`" in tasks
        assert "**Clean-sheet:**" not in tasks

        # Validate a canonical v3 packet here. The legacy v2 fixture intentionally
        # receives an unresolved verification placeholder during migration.
        incomplete = json.loads(json.dumps(persisted))
        incomplete["integrations"][0].pop("verification")
        incomplete_input = os.path.join(design_dir, "incomplete-integration.json")
        with open(incomplete_input, "w", encoding="utf-8") as fh:
            json.dump(incomplete, fh)
        rejected = subprocess.run(
            ["node", cli, incomplete_input, "--out", os.path.join(design_dir, "rejected")],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert rejected.returncode == 1
        assert "verification" in rejected.stderr
        assert "No files were written" in rejected.stderr

        legacy = json.load(open(fixture, encoding="utf-8"))
        legacy.pop("schemaVersion")
        integration = legacy["integrations"][0]
        integration["manualSetup"] = integration.pop("codeSetup")
        integration.pop("externalManualActions")
        legacy_input = os.path.join(design_dir, "legacy.json")
        legacy_out = os.path.join(design_dir, "legacy-out")
        with open(legacy_input, "w", encoding="utf-8") as fh:
            json.dump(legacy, fh)
        migrated = subprocess.run(
            ["node", cli, legacy_input, "--out", legacy_out],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert migrated.returncode == 0, migrated.stderr
        migrated_spec = json.load(open(os.path.join(legacy_out, "spec.json"), encoding="utf-8"))
        assert migrated_spec["schemaVersion"] == 3
        assert migrated_spec["platformSurfaces"][0]["platform"] == legacy["platformTarget"]
        assert migrated_spec["architecture"] == {
            "components": [],
            "contracts": [],
            "relationships": [],
            "flows": [],
            "specDependencies": [],
        }
        assert migrated_spec["screens"][0]["elements"][0]["id"]
        assert migrated_spec["integrations"][0]["codeSetup"] == []
        assert migrated_spec["integrations"][0]["unclassifiedSetup"]

        future = json.load(open(fixture, encoding="utf-8"))
        future["schemaVersion"] = 4
        future_input = os.path.join(design_dir, "future.json")
        with open(future_input, "w", encoding="utf-8") as fh:
            json.dump(future, fh)
        future_result = subprocess.run(
            ["node", cli, future_input, "--out", os.path.join(design_dir, "future-out")],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert future_result.returncode == 1
        assert "schemaVersion" in future_result.stderr

        v2_legacy_field = json.load(open(fixture, encoding="utf-8"))
        v2_legacy_field["integrations"][0]["manualSetup"] = ["ambiguous ownership"]
        v2_legacy_input = os.path.join(design_dir, "v2-legacy-field.json")
        with open(v2_legacy_input, "w", encoding="utf-8") as fh:
            json.dump(v2_legacy_field, fh)
        v2_legacy_result = subprocess.run(
            ["node", cli, v2_legacy_input, "--out", os.path.join(design_dir, "v2-legacy-out")],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert v2_legacy_result.returncode == 0, v2_legacy_result.stderr
        v2_legacy_spec = json.load(
            open(
                os.path.join(design_dir, "v2-legacy-out", "spec.json"),
                encoding="utf-8",
            )
        )
        assert "ambiguous ownership" in v2_legacy_spec["integrations"][0][
            "unclassifiedSetup"
        ]

        poisoned = json.load(open(fixture, encoding="utf-8"))
        poisoned["traceMatrix"] = {"generatedBy": "untrusted-input"}
        poisoned_input = os.path.join(design_dir, "poisoned-trace.json")
        poisoned_out = os.path.join(design_dir, "poisoned-out")
        with open(poisoned_input, "w", encoding="utf-8") as fh:
            json.dump(poisoned, fh)
        poisoned_result = subprocess.run(
            ["node", cli, poisoned_input, "--out", poisoned_out],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert poisoned_result.returncode == 0, poisoned_result.stderr
        regenerated_trace = json.load(
            open(os.path.join(poisoned_out, "traceability.json"), encoding="utf-8")
        )
        assert regenerated_trace["generatedBy"] == "groundwork-cli/v3"

        portable = json.load(open(fixture, encoding="utf-8"))
        portable["projectContext"]["sourceArtifacts"].append(
            "/Users/example/Desktop/private-current-state.md"
        )
        portable["projectContext"]["evidence"][0]["sourceRefs"].append(
            "/tmp/private-runtime.log"
        )
        portable["uiPreferences"]["visualReferences"].append(
            "/Users/example/Desktop/private-reference.png"
        )
        portable["projectContext"]["sourceArtifacts"].extend(
            [
                "/Users/example/My Private Project/current state.md",
                r"C:\Users\Alice\AppData\Local\Temp\secret file.txt",
                r"\\studio-host\Alice\private reference.png",
            ]
        )
        portable_input = os.path.join(design_dir, "portable.json")
        portable_out = os.path.join(design_dir, "portable-out")
        with open(portable_input, "w", encoding="utf-8") as fh:
            json.dump(portable, fh)
        portable_result = subprocess.run(
            ["node", cli, portable_input, "--out", portable_out],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert portable_result.returncode == 0, portable_result.stderr
        portable_builder = open(
            os.path.join(portable_out, "builder-handoff.md"), encoding="utf-8"
        ).read()
        assert "/Users/example" not in portable_builder
        assert "/tmp/private-runtime.log" not in portable_builder
        assert "My Private Project" not in portable_builder
        assert "Alice" not in portable_builder
        assert "studio-host" not in portable_builder
        assert "path redacted; inspect" in portable_builder
        assert "<local-path>" not in portable_builder

        headless = json.load(open(fixture, encoding="utf-8"))
        headless["platformTarget"] = "agent-system"
        headless["screens"] = []
        headless["uxFlows"] = []
        for feature in headless["features"]:
            feature["surface"] = "headless"
        for test_case in headless["tests"]:
            test_case["screenIds"] = []
        headless_input = os.path.join(design_dir, "headless.json")
        headless_out = os.path.join(design_dir, "headless-out")
        with open(headless_input, "w", encoding="utf-8") as fh:
            json.dump(headless, fh)
        headless_result = subprocess.run(
            ["node", cli, headless_input, "--out", headless_out],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert headless_result.returncode == 0, headless_result.stderr
        headless_trace = json.load(
            open(os.path.join(headless_out, "traceability.json"), encoding="utf-8")
        )
        assert headless_trace["coverageGaps"] == []

        no_risk_spec = json.load(open(fixture, encoding="utf-8"))
        no_risk_spec["apiContracts"] = []
        no_risk_spec["integrations"] = []
        for test_case in no_risk_spec["tests"]:
            test_case["integrationIds"] = []
        for point in no_risk_spec["dataPoints"]:
            point["pii"] = False
        no_risk_input = os.path.join(design_dir, "no-risk-input.json")
        with open(no_risk_input, "w", encoding="utf-8") as fh:
            json.dump(no_risk_spec, fh)
        no_risk_out = os.path.join(design_dir, "no-risk")
        no_risk_emitted = subprocess.run(
            ["node", cli, no_risk_input, "--out", no_risk_out],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert no_risk_emitted.returncode == 0, no_risk_emitted.stderr
        no_risk_tasks = open(
            os.path.join(no_risk_out, "tasks.md"), encoding="utf-8"
        ).read()
        assert "threat-model: not-applicable:" in no_risk_tasks

        before_failure = {
            name: open(os.path.join(design_dir, name), "rb").read()
            for name in [item["name"] for item in manifest["files"]]
            + ["artifact-manifest.json"]
        }
        changed = json.load(open(fixture, encoding="utf-8"))
        changed["productDescription"] += " Changed only for rollback verification."
        changed_input = os.path.join(design_dir, "changed.json")
        with open(changed_input, "w", encoding="utf-8") as fh:
            json.dump(changed, fh)
        fail_env = {**os.environ, "GROUNDWORK_TEST_FAIL_AFTER_INSTALL": "2"}
        failed_transaction = subprocess.run(
            ["node", cli, changed_input, "--out", design_dir],
            cwd=ROOT,
            capture_output=True,
            text=True,
            env=fail_env,
        )
        assert failed_transaction.returncode == 1
        for name, expected in before_failure.items():
            assert open(os.path.join(design_dir, name), "rb").read() == expected
        assert not any(name.startswith(".groundwork-tx-") for name in os.listdir(design_dir))

        scaffolded = subprocess.run(
            [
                sys.executable,
                scaffold,
                spec_path,
                "--out",
                design_dir,
                "--screens",
                "screen-today",
                "--modes",
                "warm-craft",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert scaffolded.returncode == 0, scaffolded.stderr
        assert "designer/canvas/gallery-launcher.mjs" in scaffolded.stdout
        assert "canvas-server.mjs" not in scaffolded.stdout
        manifest = json.load(
            open(os.path.join(design_dir, "mockups", "manifest.json"), encoding="utf-8")
        )
        assert len(manifest["slots"]) == 1
        selected_name = manifest["slots"][0]["html_path"]
        selected_path = os.path.join(design_dir, "mockups", selected_name)
        with open(selected_path, "w", encoding="utf-8") as fh:
            fh.write("<!doctype html><title>Confirmed warm craft direction</title>")
        with open(os.path.join(design_dir, "design-tokens.md"), "w", encoding="utf-8") as fh:
            fh.write("# Confirmed tokens\n\nAccent: amber\n")
        selection = {
            "rationale": "Warm, focused, and immediately readable.",
            "selections": [{"screen_id": "screen-today", "html_path": selected_name}],
        }
        with open(
            os.path.join(design_dir, "mockups", "selection.json"),
            "w",
            encoding="utf-8",
        ) as fh:
            json.dump(selection, fh)
        canvas_dir = os.path.join(design_dir, "mockups", ".canvas")
        os.makedirs(canvas_dir, exist_ok=True)
        gallery_selections = {
            "schema": "groundwork.gallery-selections/v2",
            "ratings": {},
            "picks": {"screen-today": selected_name},
            "notes": {},
            "annotations": {
                selected_name: [
                    {
                        "id": "ann-integration",
                        "marker": "square",
                        "x": 0.4,
                        "y": 0.25,
                        "target": {
                            "selector": "[data-component=PlanInput]",
                            "component": "PlanInput",
                            "tag": "section",
                            "role": "",
                            "label": "",
                            "text": "Plan today",
                        },
                        "viewport": {"width": 1280, "height": 800},
                        "document": {"width": 1280, "height": 1600},
                        "comment": "Make the planning input the single dominant action.",
                        "status": "open",
                        "createdAt": "2026-07-13T00:00:00Z",
                        "updatedAt": "2026-07-13T00:00:00Z",
                    },
                    {
                        "id": "ann-archived",
                        "marker": "square",
                        "x": 0.6,
                        "y": 0.35,
                        "target": {
                            "selector": "[data-component=OldHeader]",
                            "component": "OldHeader",
                            "tag": "header",
                            "role": "",
                            "label": "",
                            "text": "Old header",
                        },
                        "viewport": {"width": 1280, "height": 800},
                        "document": {"width": 1280, "height": 1600},
                        "comment": "Retired critique against a prior mockup version.",
                        "status": "archived",
                        "archivedAt": "2026-07-22T06:00:00.000Z",
                        "archivedFrom": "20260722T060000Z-3f9a1c2b",
                        "createdAt": "2026-07-12T00:00:00Z",
                        "updatedAt": "2026-07-12T00:00:00Z",
                    },
                    {
                        "id": "ann-resolved",
                        "marker": "square",
                        "x": 0.2,
                        "y": 0.55,
                        "target": {
                            "selector": "[data-component=FooterLink]",
                            "component": "FooterLink",
                            "tag": "footer",
                            "role": "",
                            "label": "",
                            "text": "Footer link",
                        },
                        "viewport": {"width": 1280, "height": 800},
                        "document": {"width": 1280, "height": 1600},
                        "comment": "Already addressed; dispositioned by the user.",
                        "status": "resolved",
                        "createdAt": "2026-07-11T00:00:00Z",
                        "updatedAt": "2026-07-11T00:00:00Z",
                    },
                ]
            },
        }
        with open(
            os.path.join(canvas_dir, "gallery-selections.json"),
            "w",
            encoding="utf-8",
        ) as fh:
            json.dump(gallery_selections, fh)
        refreshed = subprocess.run(
            ["node", cli, fixture, "--out", design_dir],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert refreshed.returncode == 0, refreshed.stderr
        refreshed_builder = open(builder_path, encoding="utf-8").read()
        assert "mockups/selection.json" in refreshed_builder
        assert "mockups/.canvas/gallery-selections.json" in refreshed_builder
        assert "Make the planning input the single dominant action" in refreshed_builder
        # Fixture now carries 1 open + 1 archived + 1 resolved annotation for this slot.
        # The count must reflect ONLY the open one: an archived record surviving the
        # (buggy) negative `status !== "resolved"` test would inflate this to 2 and
        # flip "annotation" to the plural "annotations", which the assertion below
        # rules out.
        assert "- Required visual feedback: 1 open element annotation in" in refreshed_builder
        assert "2 open element annotations" not in refreshed_builder
        assert "Confirmed warm craft direction" in refreshed_builder
        assert "# Confirmed tokens" in refreshed_builder
        refreshed_steering = open(
            os.path.join(design_dir, "steering.md"), encoding="utf-8"
        ).read()
        assert "Warm, focused, and immediately readable" in refreshed_steering

        prior_builder = open(builder_path, "rb").read()
        with tempfile.TemporaryDirectory() as outside_canvas:
            with open(
                os.path.join(outside_canvas, "gallery-selections.json"),
                "w",
                encoding="utf-8",
            ) as fh:
                json.dump(gallery_selections, fh)
            owned_canvas = canvas_dir + "-owned"
            os.rename(canvas_dir, owned_canvas)
            os.symlink(outside_canvas, canvas_dir)
            escaped_annotations = subprocess.run(
                ["node", cli, fixture, "--out", design_dir],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            assert escaped_annotations.returncode == 1
            assert "gallery-selections.json escapes the owned mockups directory" in escaped_annotations.stderr
            assert open(builder_path, "rb").read() == prior_builder
            os.unlink(canvas_dir)
            os.rename(owned_canvas, canvas_dir)

        with tempfile.TemporaryDirectory() as outside:
            outside_mockup = os.path.join(outside, "outside.html")
            with open(outside_mockup, "w", encoding="utf-8") as fh:
                fh.write("outside sentinel must never be embedded")
            linked = os.path.join(design_dir, "mockups", "linked")
            os.symlink(outside, linked)
            selection["selections"][0]["html_path"] = "linked/outside.html"
            with open(
                os.path.join(design_dir, "mockups", "selection.json"),
                "w",
                encoding="utf-8",
            ) as fh:
                json.dump(selection, fh)
            escaped = subprocess.run(
                ["node", cli, fixture, "--out", design_dir],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            assert escaped.returncode == 1
            assert "escapes the owned mockups directory" in escaped.stderr
            assert open(builder_path, "rb").read() == prior_builder
            os.unlink(linked)

            tokens_path = os.path.join(design_dir, "design-tokens.md")
            os.remove(tokens_path)
            os.symlink(outside_mockup, tokens_path)
            direct_symlink = subprocess.run(
                ["node", cli, fixture, "--out", design_dir],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            assert direct_symlink.returncode == 1
            assert "design-tokens.md is not a safe regular file" in direct_symlink.stderr
            os.unlink(tokens_path)
            with open(tokens_path, "w", encoding="utf-8") as fh:
                fh.write("# Confirmed tokens\n\nAccent: amber\n")

        oversized_name = "oversized.html"
        with open(
            os.path.join(design_dir, "mockups", oversized_name),
            "w",
            encoding="utf-8",
        ) as fh:
            fh.write("x" * (2 * 1024 * 1024 + 1))
        selection["selections"][0]["html_path"] = oversized_name
        with open(
            os.path.join(design_dir, "mockups", "selection.json"),
            "w",
            encoding="utf-8",
        ) as fh:
            json.dump(selection, fh)
        oversized = subprocess.run(
            ["node", cli, fixture, "--out", design_dir],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert oversized.returncode == 1
        assert "embedding limit" in oversized.stderr
        assert open(builder_path, "rb").read() == prior_builder

        selection["selections"][0]["html_path"] = "missing-selected.html"
        with open(
            os.path.join(design_dir, "mockups", "selection.json"),
            "w",
            encoding="utf-8",
        ) as fh:
            json.dump(selection, fh)
        missing_selection = subprocess.run(
            ["node", cli, fixture, "--out", design_dir],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        assert missing_selection.returncode == 1
        assert "Selected mockup is missing" in missing_selection.stderr
        assert open(builder_path, "rb").read() == prior_builder


def test_server_file_is_zero_dep():
    """The server and local helpers use only built-in modules."""
    import re
    from pathlib import Path
    pending = [Path(ROOT) / "designer/server/designer-server.mjs"]
    seen = set()
    while pending:
        source = pending.pop().resolve()
        if source in seen:
            continue
        seen.add(source)
        for mod in re.findall(r"import .* from ['\"]([^'\"]+)['\"]", source.read_text()):
            if mod.startswith("./"):
                helper = (source.parent / mod).resolve()
                assert helper.is_relative_to(Path(ROOT).resolve()), mod
                assert helper.is_file(), mod
                pending.append(helper)
            else:
                assert mod.removeprefix("node:") in {
                    "http", "fs", "os", "path", "child_process", "url", "crypto", "worker_threads",
                }, mod


def test_mockup_option_count_is_a_deliberate_flexible_choice():
    reference = open(os.path.join(ROOT, "references", "mockups.md"), encoding="utf-8").read()
    iterate_reference = open(os.path.join(ROOT, "references", "iterate.md"), encoding="utf-8").read()
    spec = open(os.path.join(ROOT, "SPEC.md"), encoding="utf-8").read()
    assert "Option count is a design decision, not a quota." in reference
    assert "The user-requested count wins." in reference
    assert "Three coherent directions" in reference
    assert "create nine review views" in reference
    assert "`--screens` and `--modes`" in reference
    combined_contract = "\n".join((reference, iterate_reference, spec))
    for stale_quota in (
        "Author 3–4",
        "author its 3–4",
        "author the default four",
        "authors 3–4 divergent",
        "generate 3–4 static HTML mockups",
        "rate four frozen mockups",
    ):
        assert stale_quota not in combined_contract


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
