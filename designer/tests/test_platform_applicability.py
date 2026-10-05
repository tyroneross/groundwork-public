from __future__ import annotations

import io
import json
from contextlib import redirect_stdout
from types import SimpleNamespace

from designer.engine import cli as cli_mod
from designer.engine.catalog_loader import load_catalog
from designer.engine.contract import build_decision_contract
from designer.engine.state import TasteState


IOS_ONLY = {
    "nav-tabbar", "nav-active-state", "nav-back", "sheet-handle",
    "sheet-size", "swipe-reveal", "pull-refresh", "search-bar",
    "micro-icon-anim", "micro-haptics", "micro-toggle",
    "profile-avatar-edit", "delight-splash", "delight-scroll-physics",
}


def _state_for(platform: str) -> TasteState:
    catalog = load_catalog()
    category = catalog.by_id()["platform-target"]
    option = next(item for item in category.options if item.id == f"platform-{platform}")
    state = TasteState()
    state.apply_pick(category.id, option.id, option.token_delta, source="extract")
    return state


def test_macos_contract_omits_ios_categories_and_mobile_nav_option():
    catalog = load_catalog()
    state = _state_for("macos")
    candidates = {
        item["id"]: item for item in build_decision_contract(state, catalog)["candidates"]
    }
    assert IOS_ONLY.isdisjoint(candidates)
    assert [item["id"] for item in candidates["nav-structure"]["options"]] == [
        "nav-structure-left", "nav-structure-top", "nav-structure-none",
    ]


def test_ios_contract_retains_ios_categories_and_bottom_tab_option():
    catalog = load_catalog()
    state = _state_for("ios")
    candidates = {
        item["id"]: item for item in build_decision_contract(state, catalog)["candidates"]
    }
    assert IOS_ONLY.issubset(candidates)
    assert "nav-structure-tabbar" in {
        item["id"] for item in candidates["nav-structure"]["options"]
    }


def test_multi_and_unresolved_preserve_the_complete_catalog():
    catalog = load_catalog()
    legacy = [
        (category.id, [option.id for option in category.options])
        for category in catalog.categories
    ]
    assert [
        (category.id, [option.id for option in category.options])
        for category in TasteState().project_catalog(catalog).categories
    ] == legacy
    assert [
        (category.id, [option.id for option in category.options])
        for category in _state_for("multi").project_catalog(catalog).categories
    ] == legacy


def test_primary_surface_scopes_catalog_not_companion_surface():
    state = TasteState(context={
        "platformSurfaces": [
            {"id": "mac", "platform": "macos", "role": "primary"},
            {"id": "web", "platform": "web", "role": "companion"},
        ]
    })
    ids = {category.id for category in state.project_catalog(load_catalog()).categories}
    assert IOS_ONLY.isdisjoint(ids)


def test_known_platform_and_nav_advance_to_a_real_unresolved_decision():
    catalog = load_catalog()
    state = _state_for("macos")
    nav = catalog.by_id()["nav-structure"]
    option = next(item for item in nav.options if item.id == "nav-structure-left")
    state.apply_pick(nav.id, option.id, option.token_delta, source="extract")
    first = build_decision_contract(state, catalog)["candidates"][0]["id"]
    assert first not in {"platform-target", "nav-structure"}
    assert first not in IOS_ONLY


def test_pick_rejects_cross_category_and_platform_ineligible_options(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps(_state_for("macos").to_dict()))

    def invoke(category: str, option: str) -> dict:
        args = SimpleNamespace(state=str(state_path), category=category, option=option)
        output = io.StringIO()
        with redirect_stdout(output):
            cli_mod.cmd_pick(args)
        return json.loads(output.getvalue())

    assert "does not belong" in invoke("button-shadow", "accent-cta-only")["error"]
    assert "inapplicable" in invoke("sheet-size", "detent-snap-two")["error"]


def test_macos_import_design_preserves_density_without_seeding_ios_sheet_detent(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps(_state_for("macos").to_dict()))
    design_path = tmp_path / "DESIGN.md"
    design_path.write_text(
        """---
schema: design.md/v1
name: Mac App
base:
  spacing:
    density: comfortable
---
# Mac App
"""
    )

    output = io.StringIO()
    with redirect_stdout(output):
        cli_mod.cmd_import_design(SimpleNamespace(
            state=str(state_path), file=str(design_path),
        ))
    imported = json.loads(output.getvalue())

    assert imported["state"]["overrides"]["spacing"]["density"] == "comfortable"
    assert all(item["category_id"] != "sheet-size" for item in imported["seeded"])
    assert "sheet-size" not in imported["state"]["asked"]
    assert all(
        not str(item.get("option_id", "")).startswith("detent-")
        for item in imported["state"]["history"]
    )


def test_macos_decision_cva_rejects_ios_only_sheet_size(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps(_state_for("macos").to_dict()))

    output = io.StringIO()
    with redirect_stdout(output):
        cli_mod.cmd_decision_cva(SimpleNamespace(
            state=str(state_path), category="sheet-size",
        ))
    result = json.loads(output.getvalue())

    assert "decision" not in result
    assert "inapplicable" in result["error"]


def test_macos_present_payload_prunes_irrelevant_preview_columns(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps(_state_for("macos").to_dict()))
    output = io.StringIO()
    with redirect_stdout(output):
        cli_mod.cmd_present(SimpleNamespace(state=str(state_path)))
    decision = json.loads(output.getvalue())["decision"]
    assert decision["applicable_platforms"] == ["ios", "macos", "web"]
    assert all(set(option["previews"]) == {"macos"} for option in decision["options"])


def test_platform_switch_hides_inapplicable_delta_but_preserves_reversible_history():
    catalog = load_catalog()
    state = _state_for("ios")
    sheet = catalog.by_id()["sheet-size"]
    sheet_option = sheet.options[0]
    state.apply_pick(sheet.id, sheet_option.id, sheet_option.token_delta)
    assert sheet.id in state.asked

    platform = catalog.by_id()["platform-target"]
    macos = next(option for option in platform.options if option.id == "platform-macos")
    state.apply_pick(platform.id, macos.id, macos.token_delta)

    assert sheet.id not in state.asked
    assert any(entry["category_id"] == sheet.id for entry in state.history)
    for group, values in sheet_option.token_delta.items():
        for key, value in values.items():
            assert state.overrides.get(group, {}).get(key) != value
    assert sheet.id not in {
        category.id for category in state.project_catalog(catalog).categories
    }

    ios = next(option for option in platform.options if option.id == "platform-ios")
    state.apply_pick(platform.id, ios.id, ios.token_delta)
    assert sheet.id in state.asked
    for group, values in sheet_option.token_delta.items():
        for key, value in values.items():
            assert state.overrides.get(group, {}).get(key) == value


def test_platform_switch_preserves_immutable_and_unmapped_baseline_tokens():
    catalog = load_catalog()
    state = _state_for("ios")
    macos_catalog = catalog.project("macos")
    eligible_values = {
        (group, key, repr(value))
        for category in macos_catalog.categories
        for option in category.options
        for group, values in option.token_delta.items()
        for key, value in values.items()
    }
    mobile_only = next(
        (group, key, value)
        for category in catalog.categories
        if category.id in IOS_ONLY
        for option in category.options
        for group, values in option.token_delta.items()
        for key, value in values.items()
        if (group, key, repr(value)) not in eligible_values
    )
    group, key, value = mobile_only
    state.baseline = {
        "custom": {"brandVoice": "precise"},
        group: {key: value},
    }
    state.overrides = json.loads(json.dumps(state.baseline))

    platform = catalog.by_id()["platform-target"]
    macos = next(option for option in platform.options if option.id == "platform-macos")
    state.apply_pick(platform.id, macos.id, macos.token_delta)

    assert state.baseline["custom"]["brandVoice"] == "precise"
    assert state.overrides["custom"]["brandVoice"] == "precise"
    assert state.baseline != state.overrides
    assert state.baseline[group][key] == value
    assert state.overrides.get(group, {}).get(key) != value


def test_macos_auto_seed_skips_ios_only_extraction_and_review(tmp_path):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps(_state_for("macos").to_dict()))
    signals_path = tmp_path / "signals.json"
    signals_path.write_text(json.dumps({
        "motion": {"reduced_motion_aware": True},
    }))

    seeded_output = io.StringIO()
    with redirect_stdout(seeded_output):
        cli_mod.cmd_seed_apply(SimpleNamespace(
            state=str(state_path), auto=True, signals=str(signals_path), contract=None,
        ))
    seeded = json.loads(seeded_output.getvalue())
    assert all(item["category_id"] != "pull-refresh" for item in seeded["summary"]["seeded"])
    assert any(item["category_id"] == "pull-refresh" for item in seeded["summary"]["skipped"])

    state_path.write_text(json.dumps(seeded["state"]))
    review_output = io.StringIO()
    with redirect_stdout(review_output):
        cli_mod.cmd_extracted(SimpleNamespace(state=str(state_path)))
    reviewed = json.loads(review_output.getvalue())
    assert all(item["category_id"] != "pull-refresh" for item in reviewed["extracted"])
