#!/usr/bin/env python3
"""Resolve one complete, shell-safe Groundwork visual-session context."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import os
import re
import shlex
import stat
import sys
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

from designer.bridge.spec_to_context import build_context
from designer.bridge.visual_bootstrap import (
    VISUAL_PLATFORM_OPTIONS,
    VisualBootstrapError,
    validate_visual_bootstrap,
    write_visual_bootstrap,
)


def _bounded_child_files(parent: Path, suffix: str, cap: int) -> list[Path]:
    """Inspect a bounded number of direct children without recursive walks."""
    found: list[Path] = []
    try:
        with os.scandir(parent) as entries:
            for entry in itertools.islice(entries, cap * 4):
                if not entry.is_dir(follow_symlinks=False):
                    continue
                candidate = Path(entry.path) / suffix
                if candidate.is_file() and not candidate.is_symlink():
                    found.append(candidate)
    except OSError:
        return []
    return sorted(found)[:cap]


def _bounded_child_directories(parent: Path, cap: int) -> list[Path]:
    found: list[Path] = []
    try:
        with os.scandir(parent) as entries:
            for entry in itertools.islice(entries, cap * 4):
                if entry.is_dir(follow_symlinks=False):
                    found.append(Path(entry.path))
    except OSError:
        return []
    return sorted(found)[:cap]


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "untitled"


def _looks_like_repo(target: Path) -> bool:
    if (target / ".git").exists() or any(
        (target / name).exists()
        for name in ("package.json", "pyproject.toml", "Package.swift", "project.yml")
    ):
        return True
    return any(
        candidate.is_file()
        for candidate in (
            target / "web" / "package.json",
            target / "frontend" / "package.json",
            target / "macos" / "Package.swift",
        )
    ) or any(_bounded_child_files(target / group, "package.json", 1) for group in ("apps", "packages"))


def _find_repo_root(start: Path) -> Path | None:
    for candidate in (start, *start.parents):
        if _looks_like_repo(candidate):
            return candidate
    return None


def _load_spec(spec_path: Path) -> dict[str, Any]:
    _verify_spec_generation(spec_path)
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    if not isinstance(spec, dict):
        raise ValueError("spec.json must contain a JSON object")
    return spec


def _spec_context(spec_path: Path) -> tuple[str, str]:
    spec = _load_spec(spec_path)
    context = build_context(spec)
    description = " | ".join(str(value) for value in context.values() if value)
    return str(spec.get("productName") or ""), description


def _verify_spec_generation(spec_path: Path) -> None:
    out = spec_path.parent
    if any(item.name.startswith(".groundwork-tx-") for item in out.iterdir()):
        raise ValueError("interrupted Groundwork artifact transaction; rerun the emitter")
    manifest_path = out / "artifact-manifest.json"
    if not manifest_path.is_file():
        return
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = next(
        (item.get("sha256") for item in manifest.get("files", []) if item.get("name") == "spec.json"),
        None,
    )
    actual = hashlib.sha256(spec_path.read_bytes()).hexdigest()
    if not expected or actual != expected:
        raise ValueError("spec.json does not match artifact-manifest.json; rerun the emitter")


def _resolve_file(target: Path) -> dict[str, Path | str | None]:
    if target.name == "spec.json":
        stage, repo = "existing-definition", None
        out = target.parent
        if out.name == ".designdoc":
            stage, repo = "existing-app", out.parent
        return {"stage": stage, "repo": repo, "spec": target, "seed": None, "out": out}
    if target.suffix.lower() not in {".md", ".markdown"}:
        raise ValueError(
            f"unsupported design seed {target.name!r}; use spec.json, a repository, "
            "a design directory, or a Markdown design file"
        )
    repo = _find_repo_root(target.parent)
    return {
        "stage": "known-preference",
        "repo": repo,
        "spec": None,
        "seed": target,
        "out": repo / ".designdoc" if repo else target.parent,
    }


def _resolve_directory(target: Path) -> dict[str, Path | str | None]:
    owned = target / ".designdoc"
    if (owned / "spec.json").is_file():
        return {"stage": "existing-app", "repo": target, "spec": owned / "spec.json", "seed": None, "out": owned}
    if (target / "spec.json").is_file():
        return {"stage": "existing-definition", "repo": None, "spec": target / "spec.json", "seed": None, "out": target}
    if _looks_like_repo(target):
        return {"stage": "existing-app", "repo": target, "spec": None, "seed": None, "out": owned}
    return {"stage": "existing-definition", "repo": None, "spec": None, "seed": None, "out": target}


def _resolve_target(target: Path | None) -> dict[str, Path | str | None]:
    if target is None:
        return {"stage": "initial-idea", "repo": None, "spec": None, "seed": None, "out": None}
    if not target.exists():
        raise ValueError(f"explicit Groundwork target does not exist: {target}")
    return _resolve_file(target) if target.is_file() else _resolve_directory(target)


def _selection_rationale(selection: Path, owned_out: Path) -> str:
    if not selection.exists() and not selection.is_symlink():
        return ""
    mockups = owned_out / "mockups"
    try:
        if mockups.is_symlink() or not mockups.is_dir():
            raise ValueError("mockups evidence directory must be an owned, regular directory")
        metadata = selection.lstat()
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError("selection.json must be a regular file, not a symlink")
        if metadata.st_size > 256 * 1024:
            raise ValueError("selection.json exceeds the 256 KiB evidence limit")
        resolved_root = mockups.resolve(strict=True)
        resolved_selection = selection.resolve(strict=True)
        if resolved_selection.parent != resolved_root:
            raise ValueError("selection.json resolves outside the owned mockups directory")
        selected = json.loads(selection.read_text(encoding="utf-8"))
        return str(selected.get("rationale") or "").strip()
    except OSError as exc:
        raise ValueError(f"unable to read selection.json safely: {exc}") from exc


def _relative_source(path: Path, repo: Path) -> str | None:
    try:
        return path.resolve(strict=True).relative_to(repo).as_posix()
    except (OSError, ValueError):
        return None


def _safe_text_evidence(path: Path, repo: Path) -> tuple[str, str] | None:
    """Read bounded, contained design evidence and return (relative path, text)."""
    try:
        resolved = path.resolve(strict=True)
        relative = resolved.relative_to(repo.resolve(strict=True)).as_posix()
    except (OSError, ValueError):
        return None
    descriptor = None
    try:
        descriptor = os.open(resolved, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 256 * 1024:
            return None
        return relative, os.read(descriptor, metadata.st_size + 1).decode("utf-8")
    except (OSError, UnicodeError):
        return None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _bounded_repo_evidence(repo: Path) -> list[tuple[str, str]]:
    """Return high-signal, bounded product evidence in deterministic order."""
    candidates = [
        repo / "README.md",
        repo / "README.markdown",
        repo / "docs" / "surfaces.md",
        repo / "docs" / "design.md",
        repo / "docs" / "architecture.md",
    ]
    evidence: list[tuple[str, str]] = []
    seen: set[str] = set()
    for candidate in candidates:
        item = _safe_text_evidence(candidate, repo)
        if item and item[0] not in seen:
            evidence.append(item)
            seen.add(item[0])
    return evidence


def _web_package_candidates(repo: Path) -> list[Path]:
    """Return allowlisted web manifests without recursively walking dependencies."""
    candidates = [
        repo / "package.json",
        repo / "web" / "package.json",
        repo / "frontend" / "package.json",
    ]
    candidates.extend(_bounded_child_files(repo / "apps", "package.json", 16))
    candidates.extend(_bounded_child_files(repo / "packages", "package.json", 16))
    return candidates[:34]


def _is_web_package(package: dict[str, Any], *, root_manifest: bool) -> bool:
    blob = json.dumps(package).lower()
    if any(marker in blob for marker in ('"electron"', '"@tauri-apps/')):
        return False
    web_markers = (
        '"next"', '"react"', '"vite"', '"vue"', '"nuxt"', '"svelte"',
        '"astro"', '"@angular/core"', '"@remix-run/',
    )
    return any(marker in blob for marker in web_markers)


def _documented_primary_platform(
    evidence: list[tuple[str, str]],
    observed_platforms: set[str],
) -> str | None:
    """Return one explicitly documented primary platform, never a guess."""
    aliases = {r"mac[\s-]?os": "macos", r"ios": "ios", r"web": "web"}
    candidates: set[str] = set()
    for _source, text in evidence:
        normalized = re.sub(r"\s+", " ", text.lower())
        for label_pattern, platform in aliases.items():
            if platform not in observed_platforms:
                continue
            patterns = (
                rf"\b{label_pattern}\b[^.!?\n]{{0,80}}\b(?:is\s+the\s+)?primary\b",
                rf"\bprimary\b[^.!?\n]{{0,80}}\b{label_pattern}\b",
            )
            if any(re.search(pattern, normalized) for pattern in patterns):
                candidates.add(platform)
    return next(iter(candidates)) if len(candidates) == 1 else None


def _platform_surfaces(
    spec: dict[str, Any] | None,
    repo: Path,
    product_name: str,
) -> tuple[list[dict[str, Any]], list[str], str | None]:
    """Return full topology, evidence paths, and an optional warning."""
    if spec:
        raw_surfaces = spec.get("platformSurfaces")
        if isinstance(raw_surfaces, list) and raw_surfaces:
            if any(not isinstance(item, dict) for item in raw_surfaces):
                raise VisualBootstrapError("spec platformSurfaces must contain objects")
            return [dict(item) for item in raw_surfaces], [".designdoc/spec.json"], None
        target = spec.get("platformTarget")
        if isinstance(target, str) and target:
            return [{
                "id": f"surface-{target}",
                "platform": target,
                "role": "primary",
                "name": f"{product_name} {target}",
                "interactionModes": [],
                "featureIds": [],
                "provenance": "observed",
            }], [".designdoc/spec.json"], None

    observed: list[tuple[str, str, list[str], str]] = []
    warnings: list[str] = []
    package_swift_candidates = [repo / "Package.swift"]
    package_swift_candidates.extend(_bounded_child_files(repo, "Package.swift", 16))
    for candidate in package_swift_candidates:
        package_swift = _safe_text_evidence(candidate, repo)
        if package_swift and ".macOS" in package_swift[1]:
            observed.append(("macos", package_swift[0], ["pointer", "keyboard"], "native"))

    projects = _bounded_child_files(repo, "project.pbxproj", 16)
    for child in _bounded_child_directories(repo, 16):
        projects.extend(_bounded_child_files(child, "project.pbxproj", 2))
    for project in sorted(projects)[:32]:
        evidence = _safe_text_evidence(project, repo)
        if not evidence:
            continue
        text = evidence[1]
        platform = "macos" if "SDKROOT = macosx" in text else "ios" if "SDKROOT = iphoneos" in text else None
        if platform:
            modes = ["pointer", "keyboard"] if platform == "macos" else ["touch"]
            observed.append((platform, evidence[0], modes, "native"))

    for package_path in _web_package_candidates(repo):
        package_json = _safe_text_evidence(package_path, repo)
        if not package_json:
            continue
        try:
            package = json.loads(package_json[1])
        except json.JSONDecodeError:
            package = {}
        blob = json.dumps(package).lower()
        if any(marker in blob for marker in ('"electron"', '"@tauri-apps/')):
            warnings.append(
                f"Unsupported ambiguous desktop shell in {package_json[0]}; platform remains unresolved for that surface."
            )
            continue
        if _is_web_package(package, root_manifest=package_path == repo / "package.json"):
            observed.append(("web", package_json[0], ["pointer", "touch"], "web"))

    deduped: list[tuple[str, str, list[str], str]] = []
    seen_platforms: set[str] = set()
    for item in observed:
        if item[0] not in seen_platforms:
            deduped.append(item)
            seen_platforms.add(item[0])
    observed = deduped
    if not observed:
        warning = warnings[0] if warnings else "No defensible visual platform was observed; platform remains unresolved."
        return [], [], warning

    product_evidence = _bounded_repo_evidence(repo)
    documented_primary = _documented_primary_platform(
        product_evidence, {item[0] for item in observed}
    )
    primary_index = next(
        (index for index, item in enumerate(observed) if item[0] == documented_primary),
        next((index for index, item in enumerate(observed) if item[3] == "native"), 0),
    )
    surfaces: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for index, (platform, source, modes, _kind) in enumerate(observed):
        base_id = f"surface-{platform}"
        surface_id = base_id
        suffix = 2
        while surface_id in used_ids:
            surface_id = f"{base_id}-{suffix}"
            suffix += 1
        used_ids.add(surface_id)
        surfaces.append({
            "id": surface_id,
            "platform": platform,
            "role": "primary" if index == primary_index else "companion",
            "name": f"{product_name} {platform}",
            "interactionModes": modes,
            "featureIds": [],
            "provenance": "observed",
        })

    product_blob = " ".join(text.lower() for _path, text in product_evidence)
    if (
        any(marker in product_blob for marker in ("menu bar", "menu-bar", "nsstatusitem"))
        and any(marker in product_blob for marker in ("controller", "popover", "status item", "nsstatusitem"))
    ):
        surfaces.append({
            "id": "surface-menubar",
            "platform": "macos",
            "role": "extension",
            "name": f"{product_name} Menu Bar",
            "interactionModes": ["pointer", "keyboard"],
            "featureIds": [],
            "provenance": "observed",
        })

    sources = [item[1] for item in observed]
    sources.extend(path for path, _text in product_evidence)
    return surfaces, list(dict.fromkeys(sources)), warnings[0] if warnings else None


def _design_evidence(
    repo: Path,
    seed: Path | None,
    selection: Path,
) -> tuple[dict[str, str] | None, tuple[str, str] | None, str | None]:
    """Return designBaseline, one catalog fact, and its evidence path."""
    candidates = [
        seed,
        repo / ".designdoc" / "design.md",
        repo / ".designdoc" / "design-tokens.md",
        repo / "DESIGN.md",
        repo / "design-tokens.md",
        repo / ".ibr" / "ui-guidance" / "active.md",
    ]
    candidates.extend(repo / path for path, _text in _bounded_repo_evidence(repo))
    selected: tuple[str, str] | None = None
    for candidate in candidates:
        if not isinstance(candidate, Path):
            continue
        selected = _safe_text_evidence(candidate, repo)
        if selected:
            break

    baseline: dict[str, str] = {}
    text = ""
    source = ""
    if selected:
        source, text = selected
        summary = " ".join(
            line.lstrip("# ").strip()
            for line in text.splitlines()
            if line.strip() and not line.lstrip().startswith("<!--")
        )[:500]
        if summary:
            baseline["seed"] = summary

    rationale = _selection_rationale(selection, repo / ".designdoc")
    if rationale:
        baseline["rationale"] = rationale
        try:
            selected_payload = json.loads(selection.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            selected_payload = {}
        selected_id = selected_payload.get("selectedId") or selected_payload.get("mockupId")
        if isinstance(selected_id, str) and selected_id.strip():
            baseline["selectedMockupId"] = selected_id.strip()

    haystack = f"{text} {rationale}".lower()
    heuristics = (
        (("left sidebar", "sidebar nav", "sidebar"), ("nav-structure", "nav-structure-left")),
        (("top nav", "top navigation"), ("nav-structure", "nav-structure-top")),
        (("bottom tab", "tab bar"), ("nav-structure", "nav-structure-tabbar")),
        (("aurora", "mesh gradient", "mesh"), ("color-gradient-style", "gradient-mesh")),
        (("glass", "frosted"), ("button-shadow", "btn-glass")),
    )
    for markers, fact in heuristics:
        if source and any(marker in haystack for marker in markers):
            return baseline or None, fact, source
    return baseline or None, None, source or None


def _create_bootstrap(
    *,
    request: str,
    name: str,
    repo: Path | None,
    spec_path: Path | None,
    seed: Path | None,
    out: Path,
    selection: Path,
    running_url: str | None,
) -> tuple[str, list[str]]:
    """Create an existing-app/change bootstrap or return an unresolved warning."""
    if repo is None:
        return "", []
    spec = _load_spec(spec_path) if spec_path else None
    surfaces, platform_sources, platform_warning = _platform_surfaces(spec, repo, name)
    warnings = [platform_warning] if platform_warning else []
    if not surfaces:
        return "", warnings

    design_baseline, design_fact, design_source = _design_evidence(repo, seed, selection)
    context: dict[str, Any] = {
        "platformSurfaces": surfaces,
        "requestedDelta": request.strip(),
        "structuredContext": build_context(spec or {}),
    }
    if design_baseline:
        context["designBaseline"] = design_baseline

    source_paths: list[str] = []
    if spec_path:
        relative_spec = _relative_source(spec_path, repo)
        if relative_spec:
            source_paths.append(relative_spec)
    for platform_source in platform_sources:
        if platform_source not in source_paths:
            source_paths.append(platform_source)
    if design_source and design_source not in source_paths:
        source_paths.append(design_source)

    primary = next((surface for surface in surfaces if surface.get("role") == "primary"), None)
    if primary is None:
        raise VisualBootstrapError("observed platform topology must contain one primary surface")
    known_facts: list[dict[str, Any]] = []
    platform_option = VISUAL_PLATFORM_OPTIONS.get(str(primary.get("platform")))
    if platform_option:
        fact: dict[str, Any] = {
            "categoryId": "platform-target",
            "optionId": platform_option,
            "provenance": "observed",
            "confidence": 0.98 if spec else 0.8,
        }
        if platform_sources:
            fact["sourcePath"] = platform_sources[0]
        known_facts.append(fact)
    else:
        warnings.append(
            f"Unsupported visual platform {primary.get('platform')!r}; platform remains unresolved."
        )
    if design_fact and design_source:
        known_facts.append({
            "categoryId": design_fact[0],
            "optionId": design_fact[1],
            "provenance": "observed",
            "sourcePath": design_source,
            "confidence": 0.85,
        })

    product: dict[str, Any] = {
        "name": name,
        "repoPath": str(repo),
        "outputPath": str(out),
    }
    if running_url:
        product["runningUrl"] = running_url
    payload = {
        "contract": "groundwork.visual-bootstrap/v1",
        "stage": "change" if seed else "existing-app",
        "drive": "adaptive",
        "entryBehavior": "review-baseline",
        "product": product,
        "context": context,
        "sourcePaths": source_paths,
        "knownFacts": known_facts,
        "warnings": warnings,
    }
    normalized = validate_visual_bootstrap(payload, require_existing_repo=True)
    destination = out / ".visual-bootstrap.json"
    write_visual_bootstrap(normalized, destination)
    return str(destination), warnings


def resolve(
    request: str,
    target_value: str | None,
    name_value: str | None,
    running_url: str | None = None,
) -> dict[str, str]:
    target = Path(target_value).expanduser().resolve() if target_value else None
    resolved = _resolve_target(target)
    repo = resolved["repo"]
    spec = resolved["spec"]
    out = resolved["out"]

    spec_name = ""
    current_request = request.strip()
    desc = current_request
    if isinstance(spec, Path):
        spec_name, spec_desc = _spec_context(spec)
        if spec_desc:
            desc = f"Current baseline: {spec_desc}"
            if current_request:
                desc += f" | Current requested delta: {current_request}"

    repo_name = repo.name if isinstance(repo, Path) else ""
    name = (name_value or spec_name or repo_name or "Untitled Product").strip()
    slug = _slug(name)
    if not isinstance(out, Path):
        out = Path.home() / "dev" / "designs" / slug

    selection = out / "mockups" / "selection.json"
    rationale = _selection_rationale(selection, out)
    if rationale:
        desc = f"{desc} | Confirmed mockup rationale: {rationale}" if desc else rationale

    bootstrap, bootstrap_warnings = _create_bootstrap(
        request=current_request,
        name=name,
        repo=repo if isinstance(repo, Path) else None,
        spec_path=spec if isinstance(spec, Path) else None,
        seed=resolved["seed"] if isinstance(resolved["seed"], Path) else None,
        out=out,
        selection=selection,
        running_url=running_url,
    )

    return {
        "GW_STAGE": str(resolved["stage"]),
        "GW_NAME": name,
        "GW_SLUG": slug,
        "GW_SPEC": str(spec) if spec else "",
        "GW_DESC": desc,
        "GW_OUT": str(out),
        "GW_REPO": str(repo) if isinstance(repo, Path) else "",
        "GW_DESIGN_SEED": str(resolved["seed"]) if isinstance(resolved["seed"], Path) else "",
        "GW_SELECTION": str(selection) if selection.is_file() else "",
        "GW_RUNNING_URL": running_url or "",
        "GW_BOOTSTRAP": bootstrap,
        "GW_BOOTSTRAP_WARNINGS": json.dumps(bootstrap_warnings),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--target")
    parser.add_argument("--name")
    parser.add_argument("--running-url")
    parser.add_argument("--format", choices=("json", "sh"), default="json")
    args = parser.parse_args()
    session = resolve(args.request, args.target, args.name, args.running_url)
    if args.format == "json":
        print(json.dumps(session, indent=2))
    else:
        for key, value in session.items():
            print(f"{key}={shlex.quote(value)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
