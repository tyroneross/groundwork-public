"""Import an existing DESIGN.md as a third entry point into the adaptive walk.

Import is the INVERSE of emit: split frontmatter, parse the restricted-subset
YAML, reverse-map base+platforms into a token_delta, seed TasteState via
apply_pick(source='import'), and surface a confirm summary.

LENIENT (Fork I-ii): map every (group, key) pair found in the DESIGN.md token
vocabulary (TOKEN_GROUPS); unknown/unmappable tokens are surfaced back to the
caller as ``skipped[]`` entries — nothing is silently lost.

Deliberate simplification (v1):
  Per-platform token layers (doc['platforms'][p]) are FOLDED into the same
  shared overrides layer as the base.  In a DESIGN.md the base holds
  cross-platform tokens and each platform layer holds diffs, but the TasteState
  shared layer carries the user's taste intent — the per-platform diffs are
  usually cosmetic and nearly always subsume the base values.  A future chunk
  can extend TasteState.per_platform and re-import with finer granularity.

Pure stdlib. No network, no git, no vendor SDK.
"""

from __future__ import annotations

import copy
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from ..engine.catalog_loader import Catalog
    from ..engine.state import TasteState

from ..emit import yaml_min
from ..engine import schema
from .seed import _human_summary

# Path-alias map (Finding 1): in-vocab tokens whose exact group.key is not a
# catalog dimension, but which the catalog ALREADY models as a sibling token
# inside a real decision's options. Aliasing them to that decision's dimension
# makes more of the imported system reviewable WITHOUT inventing fake decisions.
# Each entry must be genuinely 1:1 and evidenced (the target dimension's options
# carry this token). Conservative by design — add only clean mappings.
IMPORT_DECISION_ALIASES = {
    "typography.fontFamily": "typography.headingWeight",
}

# Metadata keys in the frontmatter doc that are NOT token-group entries and
# must never appear in skipped[].
_METADATA_KEYS = frozenset({
    "schema", "name", "version", "extends",
    "generated_at", "generated_by", "context", "prompt_pack",
    # Hand-authored design.md/v1 frontmatter carries these descriptive keys
    # alongside the token groups — they are documentation, not tokens, and
    # must NOT be surfaced as skipped (they were never meant to import).
    "platform", "principles", "title", "description", "notes",
})


# ---------------------------------------------------------------------------
# 1. Frontmatter split
# ---------------------------------------------------------------------------

def split_frontmatter(text: str) -> tuple[str, str]:
    """Split a DESIGN.md text into (frontmatter_yaml, body).

    If the text begins with a ``---`` fence, returns everything between the
    opening and closing ``---`` lines as the YAML, and the remainder as body.
    If there is no frontmatter fence, returns ("", text) — graceful degrade.
    """
    if not text.startswith("---\n"):
        return ("", text)
    # Find the closing --- line (first occurrence after the opening).
    rest = text[4:]  # skip opening "---\n"
    close = rest.find("\n---\n")
    if close == -1:
        # Try trailing --- at end-of-string.
        if rest.endswith("\n---"):
            fm = rest[: -4]
            body = ""
            return (fm, body)
        return ("", text)
    fm = rest[:close]
    body = rest[close + 5:]  # skip "\n---\n"
    return (fm, body)


# ---------------------------------------------------------------------------
# 2. Parse
# ---------------------------------------------------------------------------

def parse_design_md(text: str) -> dict:
    """Parse a DESIGN.md text and return the frontmatter as a dict.

    Returns {} on any parse error — never raises.
    """
    try:
        fm_yaml, _body = split_frontmatter(text)
        if not fm_yaml.strip():
            return {}
        parsed = yaml_min.parse(fm_yaml)
        if not isinstance(parsed, dict):
            return {}
        return parsed
    except Exception:  # noqa: BLE001
        return {}


# ---------------------------------------------------------------------------
# 3. Reverse-map
# ---------------------------------------------------------------------------

def reverse_map(doc: dict) -> tuple[dict, list[dict]]:
    """Reverse-map a parsed frontmatter doc into (token_delta, skipped).

    Handles BOTH design.md/v1 frontmatter layouts:

    * **Tool-emitted (nested)** — token groups live under ``base:`` plus
      optional ``platforms:`` override layers. This is what the designer's
      own emitter produces.
    * **Hand-authored (top-level)** — token groups (``color:``, ``typography:``,
      ``spacing:`` …) sit directly under the frontmatter, NOT under ``base:``.
      This is the shape a human writes (e.g. Sample Notes's DESIGN.md) and the
      Google design.md convention.

    Precedence when BOTH are present: the ``base`` (+``platforms``) layers are
    folded first; any top-level token group NOT already supplying that exact
    (group, key) is then merged in. ``base`` wins on a conflict.

    Each (group, key) is checked against schema.is_known_token:
    - known  → included in token_delta[group][key].
    - unknown → appended to skipped as
        {"path": "group.key", "value": <val>,
         "reason": "not imported (outside vocabulary)"}.

    A top-level key that is NOT a schema TOKEN_GROUP and NOT a known metadata
    key (schema/name/version/platform/principles/…) is also surfaced to
    skipped[] so a foreign vocabulary is never silently dropped.
    """
    token_delta: dict[str, dict[str, Any]] = {}
    skipped: list[dict] = []

    def _merge_layer(layer: Any) -> None:
        """Fold one token-map layer into token_delta / skipped."""
        if not isinstance(layer, dict):
            return
        for group, keys in layer.items():
            if not isinstance(keys, dict):
                continue
            for key, val in keys.items():
                if schema.is_known_token(group, key):
                    # base/earlier layer wins — do not overwrite a value
                    # already supplied by a higher-precedence layer.
                    token_delta.setdefault(group, {}).setdefault(key, val)
                else:
                    skipped.append({
                        "path": f"{group}.{key}",
                        "value": val,
                        "reason": "not imported (outside vocabulary)",
                    })

    # Base layer — tool-emitted format.
    _merge_layer(doc.get("base"))

    # Platform layers — optional, fold into the shared delta (v1 simplification).
    platforms = doc.get("platforms")
    if isinstance(platforms, dict):
        for _plat, layer in platforms.items():
            _merge_layer(layer)

    # Top-level token groups — hand-authored format. Any frontmatter key that
    # is a recognized TOKEN_GROUP becomes a layer; base/platforms already
    # merged above take precedence (setdefault in _merge_layer).
    top_level_layer = {
        k: v
        for k, v in doc.items()
        if k in schema.TOKEN_GROUPS and isinstance(v, dict)
    }
    if top_level_layer:
        _merge_layer(top_level_layer)

    # Lenient surfacing for FOREIGN top-level keys: a key that is neither a
    # token group, nor a structural layer (base/platforms), nor recognized
    # metadata is surfaced so nothing is silently lost.
    for key, val in doc.items():
        if key in schema.TOKEN_GROUPS or key in _METADATA_KEYS:
            continue
        if key in ("base", "platforms"):
            continue
        skipped.append({
            "path": key,
            "value": val,
            "reason": "not imported (unrecognized top-level key, outside vocabulary)",
        })

    return token_delta, skipped


# ---------------------------------------------------------------------------
# 4. Entry point
# ---------------------------------------------------------------------------

def _match_option_for_dimension(
    category: Any,
    imported_value: Any,
) -> Any:
    """Pick the catalog option that best represents an imported token value.

    Like seed.auto_seed, import is MEASUREMENT — we keep the user's real value
    and overlay it onto a representative catalog option so the dimension reads as
    "determined" and the confirm/evolve walk can surface it as Current vs the
    other options (alternates).

    Selection: prefer an option whose own token_delta already carries this exact
    value on the dimension's key (a clean catalog match → that option IS current,
    no overlay needed). Otherwise fall back to the category's first option as the
    carrier and let the caller overlay the measured value.

    Returns the chosen Option (or None if the category has no options).
    """
    if not category.options:
        return None
    # dimension is "group.key"; the matching value lives at token_delta[group][key].
    if "." in category.dimension:
        group, key = category.dimension.split(".", 1)
        for opt in category.options:
            val = (opt.token_delta.get(group) or {}).get(key)
            if val is not None and val == imported_value:
                return opt
    return category.options[0]


def import_design(
    state: "TasteState",
    text: str,
    catalog: "Catalog",
    source_path: str | None = None,
) -> dict[str, Any]:
    """Import a DESIGN.md text into *state*, seeding PER CATALOG CATEGORY.

    Mirrors seed.auto_seed's per-dimension seeding so each imported decision
    becomes a real, reviewable catalog category — the Current-vs-Alternate
    confirm/evolve surface works identically to the extract path. The imported
    (group, key) values are mapped onto the catalog category whose ``dimension``
    is ``"group.key"``; the MEASURED value is overlaid onto a representative
    option's delta (import is measurement, not a curated pick), so the emitted
    system reflects the real imported tokens, not a catalog preset.

    Returns (mirrors seed.apply_extraction's shape) on success::

        {
          "seeded": [{"category_id","dimension","option_id","source":"import"}, ...],
          "skipped": [{"path": str, "value": Any, "reason": str}, ...],
          "unmapped": [{"path","value"}, ...],   # in-vocab tokens with no catalog
                                                  # category controlling them (kept
                                                  # in overrides, no review surface)
          "summary": {...},
          "baseline_overrides": <deep copy of state.overrides after seeding>,
          "doc_name": str|None,
          "doc_version": str|None,
        }

    On parse failure (state is unchanged)::

        {"seeded": [], "errors": ["could not parse a DESIGN.md frontmatter"]}
    """
    doc = parse_design_md(text)

    # A doc is importable if it carries a tool-emitted layer (base/platforms)
    # OR any top-level schema token group (hand-authored layout). Anything else
    # (empty/garbage frontmatter, no recognized structure) is a hard parse miss.
    has_nested = bool(doc.get("base")) or bool(doc.get("platforms"))
    has_top_level = any(
        k in schema.TOKEN_GROUPS and isinstance(v, dict)
        for k, v in (doc.items() if isinstance(doc, dict) else [])
    )
    if not doc or (not has_nested and not has_top_level):
        return {
            "seeded": [],
            "skipped": [],
            "mapped": 0,
            "available": False,
            "warning": (
                "unexpected format — no recognized design.md/v1 tokens found "
                "(expected a `base:` layer or top-level token groups like "
                "`color:` / `typography:` / `spacing:`)"
            ),
            "errors": ["could not parse a DESIGN.md frontmatter"],
        }

    token_delta, skipped = reverse_map(doc)

    # NO-SILENT-EMPTY guard: a parseable frontmatter whose recognized structure
    # mapped ZERO MEANINGFUL in-vocabulary tokens must be LOUD, not a silent
    # empty seed. (no-cosmetic-dismissal: a 0-map import is a real failure to
    # surface.) We count non-None/non-empty values, NOT bare key presence — a
    # key that parsed to None (e.g. a malformed/unparseable value) is itself a
    # silent-loss signal and must NOT count as a successful mapping.
    def _is_meaningful(v: Any) -> bool:
        return v not in (None, "", {}, [])

    mapped_count = sum(
        1 for keys in token_delta.values() for v in keys.values() if _is_meaningful(v)
    )
    null_tokens = [
        f"{group}.{key}"
        for group, keys in token_delta.items()
        for key, v in keys.items()
        if not _is_meaningful(v)
    ]
    # Surface any in-vocab token whose value failed to parse (None/empty) — these
    # are recognized keys with lost values, the more insidious silent-loss path —
    # and PRUNE them from token_delta so a None never lands in overrides.
    for path in null_tokens:
        group, key = path.split(".", 1)
        skipped.append({
            "path": path,
            "value": None,
            "reason": "recognized token but its value did not parse (possible unquoted/malformed value)",
        })
        token_delta.get(group, {}).pop(key, None)
        if group in token_delta and not token_delta[group]:
            del token_delta[group]
    if mapped_count == 0:
        return {
            "seeded": [],
            "skipped": skipped,
            "mapped": 0,
            "available": False,
            "warning": (
                "unexpected format — no recognized design.md/v1 tokens found; "
                "the file parsed but none of its keys matched the token "
                "vocabulary (color/typography/spacing/radius/elevation/"
                "components/nav/motion)"
            ),
            "doc_name": doc.get("name"),
            "doc_version": doc.get("version"),
        }

    # Build dimension -> category index. Each dimension is a "group.key" path; a
    # single category owns it (when several share a dimension the first wins —
    # the imported value seeds whichever category controls that token path).
    dim_to_category: dict[str, Any] = {}
    for cat in catalog.categories:
        if cat.dimension != "UNMAPPED" and cat.dimension not in dim_to_category:
            dim_to_category[cat.dimension] = cat

    seeded: list[dict] = []
    unmapped: list[dict] = []
    seeded_paths: set[str] = set()

    # Seed per dimension: for each imported (group,key), find the category whose
    # dimension is that path, pick a carrier option, overlay the MEASURED value.
    for group, keys in token_delta.items():
        for key, value in keys.items():
            dim = f"{group}.{key}"
            cat = dim_to_category.get(dim)
            if cat is None:
                # In-vocabulary but no catalog category controls this exact path.
                # Before falling to unmapped, check if this token is aliased to a
                # catalog dimension it IS modeled under (Finding 1: conservative
                # alias map — only genuinely 1:1, evidenced entries).
                aliased_dim = IMPORT_DECISION_ALIASES.get(dim)
                alias_cat = dim_to_category.get(aliased_dim) if aliased_dim else None
                if (
                    alias_cat is not None
                    and aliased_dim not in seeded_paths
                    and dim not in seeded_paths
                ):
                    opt = _match_option_for_dimension(alias_cat, value)
                    if opt is not None:
                        seed_delta = copy.deepcopy(opt.token_delta)
                        # Overlay the imported value at its ORIGINAL path
                        # (group/key from the import, not the aliased dimension).
                        seed_delta.setdefault(group, {})[key] = value
                        state.apply_pick(alias_cat.id, opt.id, seed_delta, source="import")
                        seeded.append({
                            "category_id": alias_cat.id,
                            "dimension": alias_cat.dimension,
                            "option_id": opt.id,
                            "source": "import",
                        })
                        seeded_paths.add(dim)  # mark ORIGINAL path seeded
                        continue
                # (e.g. color.bg — a real token with no decision category). Keep
                # it in overrides so the emitted system is faithful, but it has
                # no Current-vs-Alternate review surface.
                unmapped.append({"path": dim, "value": value})
                continue
            opt = _match_option_for_dimension(cat, value)
            if opt is None:
                unmapped.append({"path": dim, "value": value})
                continue
            # Overlay the measured value onto the carrier option's preset delta
            # so the imported value is preserved exactly (mirrors auto_seed).
            seed_delta = copy.deepcopy(opt.token_delta)
            seed_delta.setdefault(group, {})[key] = value
            state.apply_pick(cat.id, opt.id, seed_delta, source="import")
            seeded.append({
                "category_id": cat.id,
                "dimension": cat.dimension,
                "option_id": opt.id,
                "source": "import",
            })
            seeded_paths.add(dim)

    # Any in-vocabulary token path NOT owned by a seeded category but present in
    # token_delta must still land in overrides verbatim (faithful import). The
    # per-category apply_pick calls above already merged each carrier option's
    # FULL delta, which can introduce sibling tokens; re-assert the imported
    # values last so a carrier preset never silently overrides a real imported
    # value on a path the import explicitly carried.
    for group, keys in token_delta.items():
        for key, value in keys.items():
            cur = (state.overrides.get(group) or {}).get(key)
            if cur != value:
                state.overrides.setdefault(group, {})[key] = value

    baseline_overrides = copy.deepcopy(state.overrides)

    # Task A: capture import_base for Finding 2 (delta_since / promote round-trip).
    # Only set on a successful import (mapped_count > 0 — we are past the early
    # returns at L264/L311). Store verbatim, no normalization.
    state.context["import_base"] = {"path": source_path, "raw_text": text}

    warning = None
    if skipped:
        warning = (
            f"{len(skipped)} token(s) outside the design.md/v1 vocabulary were "
            "not imported (see skipped[] for paths)"
        )

    return {
        "seeded": seeded,
        "skipped": skipped,
        "unmapped": unmapped,
        "mapped": mapped_count,
        "available": True,
        "warning": warning,
        "summary": _human_summary(state),
        "baseline_overrides": baseline_overrides,
        "doc_name": doc.get("name"),
        "doc_version": doc.get("version"),
    }
