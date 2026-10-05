#!/usr/bin/env python3
"""Validated bridge for ``groundwork.visual-bootstrap/v1``.

This module owns the host-side contract boundary. It validates bootstrap JSON,
publishes it atomically, and applies catalog-qualified facts to ``TasteState``
without converting observed repository evidence into user taste.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import stat
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit

from designer.engine.catalog_loader import Catalog, load_catalog
from designer.engine.state import TasteState


CONTRACT = "groundwork.visual-bootstrap/v1"
STAGES = {"idea", "existing-app", "change"}
DRIVES = {"adaptive", "guided", "manual"}
ENTRY_BEHAVIORS = {"review-baseline", "next-unresolved", "setup"}
SURFACE_ROLES = {"primary", "companion", "admin", "extension", "service"}
SURFACE_PLATFORMS = {
    "web", "vite-spa", "ios", "macos", "watchos", "tvos", "visionos",
    "android", "claude-plugin", "agent-system", "api", "service", "other",
}
VISUAL_PLATFORM_OPTIONS = {
    "web": "platform-web",
    "vite-spa": "platform-web",
    "ios": "platform-ios",
    "macos": "platform-macos",
}
_TOP_LEVEL_FIELDS = {
    "contract", "stage", "drive", "entryBehavior", "product", "context",
    "sourcePaths", "knownFacts", "warnings",
}


class VisualBootstrapError(ValueError):
    """Raised when a visual bootstrap fails the frozen contract."""


def _nonempty(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise VisualBootstrapError(f"{field} must be a non-empty string")
    return value.strip()


def _canonical_repo_and_output(
    product: dict[str, Any], *, require_existing_repo: bool
) -> tuple[Path, Path]:
    repo_text = _nonempty(product.get("repoPath"), "product.repoPath")
    out_text = _nonempty(product.get("outputPath"), "product.outputPath")
    repo_input = Path(repo_text).expanduser()
    out_input = Path(out_text).expanduser()
    if not repo_input.is_absolute() or not out_input.is_absolute():
        raise VisualBootstrapError("product repoPath and outputPath must be absolute")

    if require_existing_repo:
        try:
            repo = repo_input.resolve(strict=True)
        except OSError as exc:
            raise VisualBootstrapError(f"product.repoPath is not readable: {exc}") from exc
        if not repo.is_dir():
            raise VisualBootstrapError("product.repoPath must be a directory")
        if repo_input != repo:
            raise VisualBootstrapError("product.repoPath must be canonical and may not be a symlink")
    else:
        repo = Path(os.path.abspath(repo_input))

    expected = repo / ".designdoc"
    lexical_out = Path(os.path.abspath(out_input))
    if lexical_out != expected:
        raise VisualBootstrapError(
            "existing-app outputPath must be exactly <repo>/.designdoc"
        )
    if out_input.exists() or out_input.is_symlink():
        try:
            metadata = out_input.lstat()
        except OSError as exc:
            raise VisualBootstrapError(f"cannot inspect product.outputPath: {exc}") from exc
        if stat.S_ISLNK(metadata.st_mode):
            raise VisualBootstrapError("product.outputPath may not be a symlink")
        if not stat.S_ISDIR(metadata.st_mode):
            raise VisualBootstrapError("product.outputPath must be a directory")
        if out_input.resolve(strict=True) != expected:
            raise VisualBootstrapError("product.outputPath resolves outside the product repo")
    return repo, expected


def _validate_source_path(value: Any, repo: Path, field: str) -> str:
    text = _nonempty(value, field)
    pure = PurePosixPath(text)
    if pure.is_absolute() or ".." in pure.parts:
        raise VisualBootstrapError(f"{field} must be a repo-relative contained path")
    candidate = repo.joinpath(*pure.parts)
    if candidate.exists() or candidate.is_symlink():
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(repo)
        except (OSError, ValueError) as exc:
            raise VisualBootstrapError(f"{field} escapes the product repo") from exc
        if candidate.is_symlink():
            raise VisualBootstrapError(f"{field} may not be a symlink")
    return pure.as_posix()


def _validate_running_url(value: Any) -> str:
    text = _nonempty(value, "product.runningUrl")
    parsed = urlsplit(text)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise VisualBootstrapError("product.runningUrl must be an HTTP(S) URL")
    if parsed.username or parsed.password:
        raise VisualBootstrapError("product.runningUrl may not contain credentials")
    return text


def _validate_surface(surface: Any, index: int) -> dict[str, Any]:
    field = f"context.platformSurfaces[{index}]"
    if not isinstance(surface, dict):
        raise VisualBootstrapError(f"{field} must be an object")
    allowed = {
        "id", "platform", "role", "name", "interactionModes", "featureIds",
        "provenance",
    }
    extra = set(surface) - allowed
    if extra:
        raise VisualBootstrapError(f"{field} has unsupported fields: {sorted(extra)}")
    normalized = copy.deepcopy(surface)
    normalized["id"] = _nonempty(surface.get("id"), f"{field}.id")
    normalized["name"] = _nonempty(surface.get("name"), f"{field}.name")
    platform = _nonempty(surface.get("platform"), f"{field}.platform")
    if platform not in SURFACE_PLATFORMS:
        raise VisualBootstrapError(f"{field}.platform is unsupported: {platform}")
    normalized["platform"] = platform
    role = _nonempty(surface.get("role"), f"{field}.role")
    if role not in SURFACE_ROLES:
        raise VisualBootstrapError(f"{field}.role is unsupported: {role}")
    normalized["role"] = role
    for list_field in ("interactionModes", "featureIds"):
        values = surface.get(list_field)
        if not isinstance(values, list) or any(
            not isinstance(item, str) or not item.strip() for item in values
        ):
            raise VisualBootstrapError(f"{field}.{list_field} must be a string array")
        if len(values) != len(set(values)):
            raise VisualBootstrapError(f"{field}.{list_field} must contain unique values")
        normalized[list_field] = list(values)
    provenance = surface.get("provenance")
    if provenance is not None and provenance not in {
        "observed", "decided", "assumed", "derived",
    }:
        raise VisualBootstrapError(f"{field}.provenance is invalid")
    return normalized


def _validate_design_baseline(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        raise VisualBootstrapError("context.designBaseline must be a non-empty object")
    allowed = {"seed", "tokenSetId", "selectedMockupId", "rationale"}
    extra = set(value) - allowed
    if extra:
        raise VisualBootstrapError(
            f"context.designBaseline has unsupported fields: {sorted(extra)}"
        )
    return {
        key: _nonempty(item, f"context.designBaseline.{key}")
        for key, item in value.items()
    }


def validate_visual_bootstrap(
    payload: Any,
    *,
    require_existing_repo: bool = False,
    catalog: Catalog | None = None,
) -> dict[str, Any]:
    """Validate and normalize a frozen visual-bootstrap document.

    ``require_existing_repo=False`` supports validation of relocatable contract
    fixtures. Production creation/loading passes ``True`` to enforce canonical
    filesystem and symlink checks.
    """
    if not isinstance(payload, dict):
        raise VisualBootstrapError("visual bootstrap must be a JSON object")
    extra = set(payload) - _TOP_LEVEL_FIELDS
    if extra:
        raise VisualBootstrapError(f"visual bootstrap has unsupported fields: {sorted(extra)}")
    if payload.get("contract") != CONTRACT:
        raise VisualBootstrapError(f"contract must equal {CONTRACT!r}")

    normalized = copy.deepcopy(payload)
    stage = payload.get("stage")
    drive = payload.get("drive")
    entry = payload.get("entryBehavior")
    if stage not in STAGES:
        raise VisualBootstrapError(f"unsupported stage: {stage!r}")
    if drive not in DRIVES:
        raise VisualBootstrapError(f"unsupported drive: {drive!r}")
    if entry not in ENTRY_BEHAVIORS:
        raise VisualBootstrapError(f"unsupported entryBehavior: {entry!r}")

    product = payload.get("product")
    if not isinstance(product, dict):
        raise VisualBootstrapError("product must be an object")
    extra_product = set(product) - {"name", "repoPath", "outputPath", "runningUrl"}
    if extra_product:
        raise VisualBootstrapError(f"product has unsupported fields: {sorted(extra_product)}")
    normalized["product"] = copy.deepcopy(product)
    normalized["product"]["name"] = _nonempty(product.get("name"), "product.name")
    repo, output = _canonical_repo_and_output(
        product, require_existing_repo=require_existing_repo
    )
    normalized["product"]["repoPath"] = str(repo)
    normalized["product"]["outputPath"] = str(output)
    if "runningUrl" in product:
        normalized["product"]["runningUrl"] = _validate_running_url(product["runningUrl"])

    context = payload.get("context")
    if not isinstance(context, dict):
        raise VisualBootstrapError("context must be an object")
    surfaces = context.get("platformSurfaces")
    if not isinstance(surfaces, list) or not surfaces:
        raise VisualBootstrapError("context.platformSurfaces must contain at least one surface")
    normalized_surfaces = [_validate_surface(item, index) for index, item in enumerate(surfaces)]
    ids = [item["id"] for item in normalized_surfaces]
    if len(ids) != len(set(ids)):
        raise VisualBootstrapError("context.platformSurfaces IDs must be unique")
    primary = [item for item in normalized_surfaces if item["role"] == "primary"]
    if len(primary) != 1:
        raise VisualBootstrapError("context.platformSurfaces must contain exactly one primary")
    normalized["context"] = copy.deepcopy(context)
    normalized["context"]["platformSurfaces"] = normalized_surfaces
    if "designBaseline" in context:
        normalized["context"]["designBaseline"] = _validate_design_baseline(
            context["designBaseline"]
        )
    if "requestedDelta" in context and not isinstance(context["requestedDelta"], str):
        raise VisualBootstrapError("context.requestedDelta must be a string")
    if "structuredContext" in context and not isinstance(context["structuredContext"], dict):
        raise VisualBootstrapError("context.structuredContext must be an object")

    source_paths = payload.get("sourcePaths", [])
    if not isinstance(source_paths, list):
        raise VisualBootstrapError("sourcePaths must be an array")
    normalized_sources = [
        _validate_source_path(value, repo, f"sourcePaths[{index}]")
        for index, value in enumerate(source_paths)
    ]
    if len(normalized_sources) != len(set(normalized_sources)):
        raise VisualBootstrapError("sourcePaths must contain unique paths")
    normalized["sourcePaths"] = normalized_sources

    facts = payload.get("knownFacts")
    if not isinstance(facts, list):
        raise VisualBootstrapError("knownFacts must be an array")
    live_catalog = catalog or load_catalog()
    categories = live_catalog.by_id()
    seen_categories: set[str] = set()
    normalized_facts: list[dict[str, Any]] = []
    for index, fact in enumerate(facts):
        field = f"knownFacts[{index}]"
        if not isinstance(fact, dict):
            raise VisualBootstrapError(f"{field} must be an object")
        extra_fact = set(fact) - {
            "categoryId", "optionId", "provenance", "sourcePath", "confidence",
        }
        if extra_fact:
            raise VisualBootstrapError(f"{field} has unsupported fields: {sorted(extra_fact)}")
        category_id = _nonempty(fact.get("categoryId"), f"{field}.categoryId")
        option_id = _nonempty(fact.get("optionId"), f"{field}.optionId")
        category = categories.get(category_id)
        if category is None:
            raise VisualBootstrapError(f"{field} references unknown catalog category {category_id!r}")
        if option_id not in {option.id for option in category.options}:
            raise VisualBootstrapError(
                f"{field} option {option_id!r} does not belong to {category_id!r}"
            )
        if category_id in seen_categories:
            raise VisualBootstrapError(f"knownFacts contains duplicate category {category_id!r}")
        seen_categories.add(category_id)
        provenance = fact.get("provenance")
        if provenance not in {"observed", "decided"}:
            raise VisualBootstrapError(f"{field}.provenance must be observed or decided")
        normalized_fact = copy.deepcopy(fact)
        normalized_fact["categoryId"] = category_id
        normalized_fact["optionId"] = option_id
        if "sourcePath" in fact:
            normalized_fact["sourcePath"] = _validate_source_path(
                fact["sourcePath"], repo, f"{field}.sourcePath"
            )
        if "confidence" in fact:
            confidence = fact["confidence"]
            if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
                raise VisualBootstrapError(f"{field}.confidence must be numeric")
            if not 0 <= float(confidence) <= 1:
                raise VisualBootstrapError(f"{field}.confidence must be between 0 and 1")
            normalized_fact["confidence"] = float(confidence)
        normalized_facts.append(normalized_fact)
    normalized["knownFacts"] = normalized_facts

    warnings = payload.get("warnings", [])
    if not isinstance(warnings, list) or any(
        not isinstance(item, str) or not item.strip() for item in warnings
    ):
        raise VisualBootstrapError("warnings must be a string array")
    normalized["warnings"] = list(warnings)

    primary_platform = primary[0]["platform"]
    projected = VISUAL_PLATFORM_OPTIONS.get(primary_platform)
    platform_fact = next(
        (fact for fact in normalized_facts if fact["categoryId"] == "platform-target"),
        None,
    )
    if projected is None and platform_fact is not None:
        raise VisualBootstrapError(
            f"unsupported visual platform {primary_platform!r} must remain unresolved"
        )
    if projected is None and not any("unresolved" in warning.lower() for warning in warnings):
        raise VisualBootstrapError(
            f"unsupported visual platform {primary_platform!r} requires an unresolved warning"
        )
    if projected is not None and platform_fact is not None and platform_fact["optionId"] != projected:
        raise VisualBootstrapError(
            "platform-target fact must project only the primary platform surface"
        )
    return normalized


def write_visual_bootstrap(
    payload: Any,
    path: str | Path,
    *,
    require_existing_repo: bool = True,
) -> Path:
    """Validate and atomically publish a bootstrap with owner-only permissions."""
    normalized = validate_visual_bootstrap(
        payload, require_existing_repo=require_existing_repo
    )
    destination = Path(path).expanduser()
    expected_destination = (
        Path(normalized["product"]["outputPath"]) / ".visual-bootstrap.json"
    )
    if not destination.is_absolute():
        destination = Path(os.path.abspath(destination))
    if destination != expected_destination:
        raise VisualBootstrapError(
            "bootstrap path must be exactly <product.outputPath>/.visual-bootstrap.json"
        )
    parent = destination.parent
    if parent.exists() and parent.is_symlink():
        raise VisualBootstrapError("bootstrap parent may not be a symlink")
    parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.is_symlink():
        raise VisualBootstrapError("bootstrap path may not be a symlink")

    fd, temp_name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=parent)
    temp_path = Path(temp_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(normalized, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, destination)
        directory_fd = os.open(parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    return destination


def load_visual_bootstrap(
    path: str | Path, *, require_existing_repo: bool = True
) -> dict[str, Any]:
    """Load a regular bootstrap file and validate it before consumption."""
    source = Path(path).expanduser()
    try:
        metadata = source.lstat()
    except OSError as exc:
        raise VisualBootstrapError(f"bootstrap file is not readable: {exc}") from exc
    if not stat.S_ISREG(metadata.st_mode):
        raise VisualBootstrapError("bootstrap file must be a regular file, not a symlink")
    if metadata.st_size > 1024 * 1024:
        raise VisualBootstrapError("bootstrap file exceeds the 1 MiB limit")
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise VisualBootstrapError(f"bootstrap file is invalid JSON: {exc}") from exc
    return validate_visual_bootstrap(
        payload, require_existing_repo=require_existing_repo
    )


def initialize_taste_state(
    bootstrap: dict[str, Any],
    state: TasteState | None = None,
    *,
    catalog: Catalog | None = None,
) -> TasteState:
    """Idempotently apply validated context and known facts to taste state."""
    normalized = validate_visual_bootstrap(bootstrap, catalog=catalog)
    live_catalog = catalog or load_catalog()
    categories = live_catalog.by_id()
    current = state or TasteState()

    structured = copy.deepcopy(normalized["context"].get("structuredContext") or {})
    baseline_description = str(structured.get("description") or "").strip()
    requested_delta = str(normalized["context"].get("requestedDelta") or "").strip()
    if requested_delta:
        structured["requestedDelta"] = requested_delta
        structured["description"] = (
            f"{baseline_description} | Requested delta: {requested_delta}"
            if baseline_description
            else requested_delta
        )
    structured.update({
        "product": copy.deepcopy(normalized["product"]),
        "stage": normalized["stage"],
        "drive": normalized["drive"],
        "entryBehavior": normalized["entryBehavior"],
        "platformSurfaces": copy.deepcopy(normalized["context"]["platformSurfaces"]),
    })
    if "designBaseline" in normalized["context"]:
        structured["designBaseline"] = copy.deepcopy(normalized["context"]["designBaseline"])
    current.context.update(structured)

    for fact in normalized["knownFacts"]:
        category = categories[fact["categoryId"]]
        option = next(item for item in category.options if item.id == fact["optionId"])
        evidence = {
            key: copy.deepcopy(fact[key])
            for key in ("sourcePath", "confidence")
            if key in fact
        }
        if fact["provenance"] == "observed":
            current.apply_observation(
                category.id,
                option.id,
                option.token_delta,
                evidence=evidence or None,
            )
            continue
        already_decided = any(
            entry.get("category_id") == category.id
            and entry.get("option_id") == option.id
            and TasteState._entry_provenance(entry) == "DECIDED"
            for entry in current.history
        )
        if not already_decided:
            current.apply_pick(category.id, option.id, option.token_delta, source="pick")
    return current


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate or consume a Groundwork visual bootstrap")
    sub = parser.add_subparsers(dest="command", required=True)
    validate_parser = sub.add_parser("validate")
    validate_parser.add_argument("bootstrap")
    validate_parser.add_argument("--allow-missing-repo", action="store_true")
    state_parser = sub.add_parser("state")
    state_parser.add_argument("bootstrap")
    state_parser.add_argument("--state")
    args = parser.parse_args(argv)

    bootstrap = load_visual_bootstrap(
        args.bootstrap,
        require_existing_repo=not getattr(args, "allow_missing_repo", False),
    )
    if args.command == "validate":
        print(json.dumps(bootstrap, ensure_ascii=False, indent=2))
        return 0
    state = None
    if args.state:
        state = TasteState.from_dict(json.loads(Path(args.state).read_text(encoding="utf-8")))
    initialized = initialize_taste_state(bootstrap, state)
    print(json.dumps({"bootstrap": bootstrap, "state": initialized.to_dict()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
