"""Catalog loader — joins category metadata + option deltas + dimension.

Reads the mined catalog (catalog/categories.json: 32 categories, 118 options,
from `iOS Design A B Tester/data.js`) and joins it with the authored
option->token_delta mapping (catalog/_deltas.py). Every option ends up with:
  - id, label, tag, desc, category metadata
  - dimension: the single design.md token path the category determines
  - token_delta: the partial token map picking it applies (validated)

Consumers (Chunk 3 engine, Chunk 5 emitter) call load_catalog() and read; they
never define deltas. Chunk 2 is the sole author.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, replace
from typing import Any

from .catalog import _deltas
from .schema import validate_token_delta

_HERE = os.path.dirname(os.path.abspath(__file__))
_CATEGORIES_JSON = os.path.join(_HERE, "catalog", "categories.json")
_PLATFORMS = frozenset({"web", "ios", "macos"})


@dataclass(frozen=True)
class Option:
    id: str
    label: str
    tag: str
    desc: str
    token_delta: dict[str, Any]
    platforms: frozenset[str] | None = None


@dataclass(frozen=True)
class Category:
    id: str
    name: str          # category group, e.g. "Navigation"
    title: str         # decision title, e.g. "Tab Bar Style"
    description: str
    cp_note: str
    dimension: str     # the design.md token path this decision determines
    options: list[Option] = field(default_factory=list)
    platforms: frozenset[str] | None = None


@dataclass(frozen=True)
class Catalog:
    categories: list[Category]

    def by_id(self) -> dict[str, Category]:
        return {c.id: c for c in self.categories}

    def options_by_id(self) -> dict[str, Option]:
        return {o.id: o for c in self.categories for o in c.options}

    def dimensions(self) -> dict[str, str]:
        """category_id -> token dimension path."""
        return {c.id: c.dimension for c in self.categories}

    def project(self, platform: str | None) -> "Catalog":
        """Project the catalog for one concrete platform.

        ``None`` and ``multi`` preserve the legacy complete catalog. Concrete
        targets omit inapplicable categories and options. A category with fewer
        than two remaining options is not a meaningful user decision and is
        therefore omitted. Platform Target remains fully reversible.
        """
        if platform not in _PLATFORMS:
            return self
        projected: list[Category] = []
        for category in self.categories:
            if category.platforms and platform not in category.platforms:
                continue
            if category.id == "platform-target":
                projected.append(category)
                continue
            options = [
                option for option in category.options
                if not option.platforms or platform in option.platforms
            ]
            if len(options) >= 2:
                projected.append(replace(category, options=options))
        return Catalog(categories=projected)


class CatalogError(Exception):
    pass


def load_catalog(strict: bool = True) -> Catalog:
    """Load and validate the catalog.

    strict=True (default) raises CatalogError if any option lacks a delta, any
    delta fails schema validation, or any pplx/_orig cruft string is present.
    """
    with open(_CATEGORIES_JSON, encoding="utf-8") as fh:
        raw = json.load(fh)

    errors: list[str] = []
    categories: list[Category] = []

    for craw in raw:
        cid = craw["id"]
        category_platforms = _parse_platforms(craw.get("platforms"), f"category {cid!r}", errors)
        dimension = _deltas.CATEGORY_DIMENSION.get(cid)
        if dimension is None:
            errors.append(f"category {cid!r} has no dimension mapping")
            dimension = "UNMAPPED"

        options: list[Option] = []
        for oraw in craw["options"]:
            oid = oraw["id"]
            delta = _deltas.OPTION_DELTA.get(oid)
            if delta is None:
                errors.append(f"option {oid!r} has no token_delta")
                delta = {}
            else:
                vr = validate_token_delta(delta)
                if not vr.ok:
                    errors.extend(f"option {oid!r} delta: {e}" for e in vr.errors)
            # cruft scan (the V2-deferred clean-up: drop pplx / _orig leftovers)
            blob = json.dumps(oraw) + json.dumps(delta)
            if "pplx" in blob or "_orig" in blob:
                errors.append(f"option {oid!r} carries pplx/_orig cruft")
            options.append(Option(
                id=oid,
                label=oraw.get("label", ""),
                tag=oraw.get("tag", ""),
                desc=oraw.get("desc", ""),
                token_delta=delta,
                platforms=_parse_platforms(
                    oraw.get("platforms"), f"option {oid!r}", errors
                ),
            ))

        categories.append(Category(
            id=cid,
            name=craw.get("category", ""),
            title=craw.get("title", ""),
            description=craw.get("description", ""),
            cp_note=craw.get("cpNote", ""),
            dimension=dimension,
            options=options,
            platforms=category_platforms,
        ))

    if errors and strict:
        raise CatalogError(
            f"catalog has {len(errors)} problem(s):\n  " + "\n  ".join(errors[:20])
        )

    return Catalog(categories=categories)


def _parse_platforms(
    value: Any,
    owner: str,
    errors: list[str],
) -> frozenset[str] | None:
    if value is None:
        return None
    if not isinstance(value, list) or not value or any(
        not isinstance(item, str) for item in value
    ):
        errors.append(f"{owner} platforms must be a non-empty string array")
        return None
    normalized = frozenset(value)
    unknown = normalized - _PLATFORMS
    if unknown:
        errors.append(f"{owner} has unknown platforms: {sorted(unknown)}")
    if len(normalized) != len(value):
        errors.append(f"{owner} platforms must be unique")
    return normalized if not unknown else None


def catalog_stats() -> dict[str, int]:
    cat = load_catalog()
    return {
        "categories": len(cat.categories),
        "options": sum(len(c.options) for c in cat.categories),
        "dimensions": len(set(c.dimension for c in cat.categories)),
    }
