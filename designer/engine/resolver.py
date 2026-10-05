"""Token resolver: effective = floor ⊕ overrides ⊕ per-platform override.

The floor/override split is HIDDEN from the user (they only ever pick previews).
Internally:
  - the floor (Calm Precision baseline) is the base layer
  - user picks accumulate as `overrides` (a token_delta, shared across platforms)
  - optional per-platform overrides refine a single platform
  - `flatten` compiles a self-contained DESIGN.md with no `extends:` line

Precedence (lowest -> highest):
  floor.base  <  floor.platform  <  user.overrides  <  user.platform_overrides

Rationale: the user's shared picks beat the floor's platform defaults (a user
who picks "expressive accent" means it everywhere), but a user's explicit
per-platform override is the most specific and wins.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import copy
from typing import Any

from . import floor as floor_mod
from .schema import PLATFORMS, validate_token_delta


def merge_delta(base: dict[str, Any], delta: dict[str, Any]) -> dict[str, Any]:
    """Deep-merge a token_delta onto a base token map. delta wins per-key.

    Two levels deep only (group -> key -> value); values are scalars/strings.
    Returns a new dict; inputs are not mutated.
    """
    out = copy.deepcopy(base)
    for group, keys in (delta or {}).items():
        if not isinstance(keys, dict):
            continue
        out.setdefault(group, {})
        for key, value in keys.items():
            out[group][key] = value
    return out


def resolve(
    platform: str,
    overrides: dict[str, Any] | None = None,
    platform_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute effective tokens for one platform.

    floor.base ⊕ floor.platform ⊕ user.overrides ⊕ user.platform_overrides
    """
    if platform not in PLATFORMS:
        raise ValueError(f"unknown platform {platform!r}; expected one of {PLATFORMS}")

    effective = floor_mod.floor_base()
    effective = merge_delta(effective, floor_mod.floor_platform(platform))
    if overrides:
        effective = merge_delta(effective, overrides)
    if platform_overrides:
        effective = merge_delta(effective, platform_overrides)
    return effective


def resolve_all(
    overrides: dict[str, Any] | None = None,
    per_platform: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Resolve effective tokens for every platform at once.

    `per_platform` maps a platform -> its platform_overrides token_delta.
    """
    per_platform = per_platform or {}
    return {
        p: resolve(p, overrides, per_platform.get(p))
        for p in PLATFORMS
    }


def flatten(
    name: str,
    version: str,
    overrides: dict[str, Any] | None = None,
    per_platform: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Compile a self-contained design.md/v1 doc with NO `extends:` line.

    The flattened doc carries fully-resolved effective tokens per platform plus
    a shared base equal to the web resolution's common subset. Portable: a
    consumer needs nothing but this file.
    """
    resolved = resolve_all(overrides, per_platform)

    # Shared base = keys whose value is identical across all platforms.
    base: dict[str, Any] = {}
    platform_layers: dict[str, dict[str, Any]] = {p: {} for p in PLATFORMS}

    groups = set()
    for layer in resolved.values():
        groups.update(layer.keys())

    for group in groups:
        keysets = {p: resolved[p].get(group, {}) for p in PLATFORMS}
        all_keys = set()
        for ks in keysets.values():
            all_keys.update(ks.keys())
        for key in all_keys:
            vals = {p: keysets[p].get(key) for p in PLATFORMS}
            present = [v for v in vals.values() if v is not None]
            if len(present) == len(PLATFORMS) and len(set(map(_hashable, present))) == 1:
                base.setdefault(group, {})[key] = present[0]
            else:
                for p in PLATFORMS:
                    if vals[p] is not None:
                        platform_layers[p].setdefault(group, {})[key] = vals[p]

    doc = {
        "schema": "design.md/v1",
        "name": name,
        "version": version,
        # NOTE: deliberately NO "extends:" key — this is flattened/portable.
        "base": base,
        # Always emit all three platform keys so the flattened doc is
        # structurally platform-aware even when the user's picks made every
        # platform-distinguishing token uniform (a legit but rare outcome).
        # An empty layer means "this platform inherits base unchanged."
        "platforms": {p: platform_layers.get(p, {}) for p in PLATFORMS},
    }
    return doc


def _hashable(v: Any) -> Any:
    """Make floats/strings/ints comparable in a set; fall back to repr."""
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    return repr(v)


def validate_overrides(overrides: dict[str, Any]) -> list[str]:
    """Return a list of vocabulary errors in an overrides delta ([] if clean)."""
    return validate_token_delta(overrides).errors
