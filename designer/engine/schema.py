"""design.md/v1 schema — the single schema-of-record for the designer engine.

Every other module (catalog, emitter) imports the token vocabulary and the
validator from HERE. There is no second schema definition anywhere in the tree.

Shape mirrors ~/dev/git-folder/sample-notes-local/DESIGN.md (Google design.md
token format, schema: design.md/v1): a shared base layer plus optional
per-platform override layers (web / iOS / macOS).

Pure stdlib. No third-party deps, no network, no vendor SDK.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

SCHEMA_ID = "design.md/v1"
PLATFORMS = ("web", "ios", "macos")

# --- token vocabulary -------------------------------------------------------
# A token is addressed by (group, key). The catalog's option deltas, the
# resolver, and the emitter all speak this vocabulary. Adding a token here is
# the ONLY place the vocabulary grows.

TOKEN_GROUPS: dict[str, tuple[str, ...]] = {
    "color": (
        "bg", "surface", "surfaceSunken", "border",
        "textPrimary", "textSecondary", "textTertiary",
        "accent", "accentText", "warning", "danger", "success",
    ),
    "typography": (
        "fontFamily", "scaleRatio", "headingWeight", "bodyWeight",
        "tracking", "numericStyle",
    ),
    "spacing": ("grid", "density"),
    "radius": ("button", "card", "pill"),
    "elevation": ("style", "depth"),
    "motion": ("transition", "press", "intensity"),
    "nav": ("activeStyle", "tabStyle", "layoutModel"),
    "platform": ("target",),
    "components": ("buttonShape", "separator", "emptyState", "toast"),
}


def is_known_token(group: str, key: str) -> bool:
    return key in TOKEN_GROUPS.get(group, ())


def all_token_paths() -> list[str]:
    return [f"{g}.{k}" for g, keys in TOKEN_GROUPS.items() for k in keys]


# --- structured result ------------------------------------------------------

@dataclass
class ValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:  # truthy == valid
        return self.ok


def _is_token_map(obj: Any) -> bool:
    return isinstance(obj, dict)


def validate_token_delta(delta: dict[str, Any]) -> ValidationResult:
    """A token_delta is a flat-ish {group: {key: value}} partial map.

    Every (group, key) it touches must be in the vocabulary. Unknown paths are
    errors (catches typos in the catalog before they reach a DESIGN.md).
    """
    errors: list[str] = []
    if not _is_token_map(delta):
        return ValidationResult(False, ["token_delta must be a mapping"])
    for group, keys in delta.items():
        if group not in TOKEN_GROUPS:
            errors.append(f"unknown token group: {group!r}")
            continue
        if not isinstance(keys, dict):
            errors.append(f"group {group!r} must map to a key->value object")
            continue
        for key in keys:
            if not is_known_token(group, key):
                errors.append(f"unknown token: {group}.{key}")
    return ValidationResult(not errors, errors)


REQUIRED_TOP_KEYS = ("schema", "name", "version", "base")


def validate_design_md(doc: dict[str, Any]) -> ValidationResult:
    """Validate a fully-assembled DESIGN.md document object (pre-YAML-dump).

    Required: schema id, name, version, a `base` token layer. Optional
    `platforms` map keyed by PLATFORMS, each an override token layer. An
    `extends` line is allowed (non-flattened) but a flattened doc must NOT
    carry one — that is checked separately by the resolver's flatten path.
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(doc, dict):
        return ValidationResult(False, ["DESIGN.md doc must be a mapping"])

    for k in REQUIRED_TOP_KEYS:
        if k not in doc:
            errors.append(f"missing required key: {k}")

    if doc.get("schema") not in (SCHEMA_ID, None):
        errors.append(f"schema must be {SCHEMA_ID!r}, got {doc.get('schema')!r}")

    base = doc.get("base")
    if base is not None:
        r = validate_token_delta(base)
        errors.extend(f"base: {e}" for e in r.errors)

    platforms = doc.get("platforms", {})
    if platforms:
        if not isinstance(platforms, dict):
            errors.append("platforms must be a mapping")
        else:
            for plat, layer in platforms.items():
                if plat not in PLATFORMS:
                    errors.append(f"unknown platform: {plat!r}")
                    continue
                r = validate_token_delta(layer)
                errors.extend(f"platforms.{plat}: {e}" for e in r.errors)

    if not doc.get("prompt_pack"):
        warnings.append("no prompt_pack present (AI prompt pack expected)")

    return ValidationResult(not errors, errors, warnings)
