"""TasteState — accumulates user picks as token deltas during the adaptive walk.

The state object is the single source of truth for what the user has decided so
far. It is purely data: a JSON-serializable dataclass with no I/O, no LLM calls,
no network, and no third-party deps.

Consumed by: decide.py (next_step), contract.py (build_decision_contract),
             emitter (Phase 5, out of scope here).

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from .catalog_loader import Catalog

from . import resolver as resolver_mod

# Sentinel used in delta_since to distinguish "key absent" from value==None.
_SENTINEL = object()


@dataclass
class TasteState:
    """Accumulated taste-state from a single adaptive walk session.

    Fields
    ------
    context : dict
        Free-form description of what the user is building plus any inferred
        priors. Example:
            {"description": "fitness tracking app", "audience": "athletes",
             "density": "compact", "mood": "energetic"}
        The decision engine and the information-gain heuristic read this to rank
        undetermined categories.

    overrides : dict
        Accumulated token_delta from all user picks (shared across platforms).
        Grows via apply_pick(); starts empty.

    per_platform : dict[platform -> token_delta]
        Per-platform token overrides. Normally empty in Phase 1; reserved for
        Phase 2 platform-specific decisions.

    asked : list[str]
        Ordered list of category_ids that have already been decided (the
        slot-dedup ledger). A category is added here when apply_pick() is
        called, and also when decide.py records an "inferred" decision.
        Invariant: no duplicates.

    history : list[dict]
        Ordered record of every pick: {category_id, option_id, delta, source,
        provenance}. ``source`` retains the engine's compatibility vocabulary;
        ``provenance`` distinguishes user decisions from observed evidence and
        assumptions.
    """

    context: dict[str, Any] = field(default_factory=dict)
    overrides: dict[str, Any] = field(default_factory=dict)
    per_platform: dict[str, dict[str, Any]] = field(default_factory=dict)
    asked: list[str] = field(default_factory=list)
    history: list[dict[str, Any]] = field(default_factory=list)
    baseline: dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------

    def apply_pick(
        self,
        category_id: str,
        option_id: str,
        token_delta: dict[str, Any],
        source: str = "pick",
    ) -> None:
        """Record a user pick.

        Merges *token_delta* into self.overrides (shared layer) via
        resolver.merge_delta. Appends *category_id* to self.asked (if not
        already present — guard against double-apply) and records in history.

        Parameters
        ----------
        category_id : str
            The category that was decided (slot-dedup key).
        option_id : str
            The specific option the user chose.
        token_delta : dict
            The partial token map from Option.token_delta. May be empty for
            inferred/floor entries.
        source : str
            "pick" for user-chosen, "infer" for engine-inferred.
        """
        target = token_delta.get("platform", {}).get("target")
        if category_id == "platform-target" and target in {"web", "ios", "macos", "multi"}:
            self._recompute_platform_view(None if target == "multi" else target)
        self.overrides = resolver_mod.merge_delta(self.overrides, token_delta)
        if category_id not in self.asked:
            self.asked.append(category_id)
        provenance = {
            "pick": "DECIDED",
            "generate": "DECIDED",
            "extract": "OBSERVED",
            "import": "OBSERVED",
            "infer": "ASSUMED",
            "auto": "ASSUMED",
            "auto-infer": "ASSUMED",
        }.get(source, "ASSUMED")
        self.history.append({
            "category_id": category_id,
            "option_id": option_id,
            "delta": copy.deepcopy(token_delta),
            "source": source,
            "provenance": provenance,
        })

    def _recompute_platform_view(self, platform: str | None) -> None:
        """Recompute effective deltas without destroying reversible history.

        The immutable baseline and full history remain available when a user
        switches back. Only ``asked`` and effective ``overrides`` are projected
        to the newly selected platform.
        """
        if not self.history:
            return
        from .catalog_loader import load_catalog

        full = load_catalog()
        projected = full.project(platform)
        full_ids = full.by_id()
        projected_ids = projected.by_id()
        projected_options = {
            category.id: {option.id for option in category.options}
            for category in projected.categories
        }

        def eligible(entry: dict[str, Any]) -> bool:
            category_id = str(entry.get("category_id") or "")
            option_id = str(entry.get("option_id") or "")
            if category_id not in full_ids:
                return True
            category = projected_ids.get(category_id)
            if category is None:
                return False
            if not option_id or option_id in projected_options[category_id]:
                return True
            return entry.get("source") in {"extract", "import"}

        active_history = [entry for entry in self.history if eligible(entry)]
        self.asked = list(dict.fromkeys(
            str(entry.get("category_id")) for entry in active_history if entry.get("category_id")
        ))
        effective_baseline = copy.deepcopy(self.baseline)

        # Remove baseline values that uniquely encode an ineligible option.
        # Unmapped imported tokens survive because Groundwork cannot safely
        # infer their platform scope.
        eligible_values: dict[tuple[str, str], set[str]] = {}
        ineligible_values: dict[tuple[str, str], set[str]] = {}
        for category in full.categories:
            allowed = projected_options.get(category.id, set())
            for option in category.options:
                target = eligible_values if option.id in allowed else ineligible_values
                for group, values in option.token_delta.items():
                    if not isinstance(values, dict):
                        continue
                    for key, value in values.items():
                        target.setdefault((group, key), set()).add(repr(value))
        for (group, key), blocked in ineligible_values.items():
            current = effective_baseline.get(group, {}).get(key, _SENTINEL)
            if current is _SENTINEL or repr(current) not in blocked:
                continue
            if repr(current) in eligible_values.get((group, key), set()):
                continue
            effective_baseline[group].pop(key, None)
            if not effective_baseline[group]:
                effective_baseline.pop(group, None)

        self.overrides = effective_baseline
        for entry in active_history:
            if self._entry_provenance(entry) == "OBSERVED":
                continue
            self.overrides = resolver_mod.merge_delta(
                self.overrides, entry.get("delta") or {}
            )

    def apply_observation(
        self,
        category_id: str,
        option_id: str,
        token_delta: dict[str, Any],
        *,
        evidence: dict[str, Any] | None = None,
    ) -> bool:
        """Record an observed current-state fact without treating it as taste.

        Observations retain the legacy ``source='extract'`` vocabulary so the
        current-versus-alternate review continues to discover them. The
        explicit ``provenance='OBSERVED'`` marker is the authority boundary.

        Reapplying the same observation is idempotent. If a user has already
        made a DECIDED choice for the category, the observation is retained in
        history and baseline but the user choice remains the effective delta.

        Returns ``True`` when a new observation was recorded and ``False`` for
        an idempotent replay.
        """
        for entry in self.history:
            if (
                entry.get("category_id") == category_id
                and entry.get("option_id") == option_id
                and self._entry_provenance(entry) == "OBSERVED"
            ):
                if category_id not in self.asked:
                    self.asked.append(category_id)
                return False

        latest_decision = next(
            (
                entry
                for entry in reversed(self.history)
                if entry.get("category_id") == category_id
                and self._entry_provenance(entry) == "DECIDED"
            ),
            None,
        )

        self.overrides = resolver_mod.merge_delta(self.overrides, token_delta)
        self.baseline = resolver_mod.merge_delta(self.baseline, token_delta)
        if category_id not in self.asked:
            self.asked.append(category_id)
        record = {
            "category_id": category_id,
            "option_id": option_id,
            "delta": copy.deepcopy(token_delta),
            "source": "extract",
            "provenance": "OBSERVED",
        }
        if evidence:
            record["evidence"] = copy.deepcopy(evidence)
        self.history.append(record)

        if latest_decision is not None:
            self.overrides = resolver_mod.merge_delta(
                self.overrides,
                latest_decision.get("delta") or {},
            )
        return True

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    def determined_dimensions(self) -> set[str]:
        """Return the set of token-path dimensions already decided.

        A dimension is determined when at least one category that maps to it
        has been asked (regardless of whether the pick had a non-empty delta).
        """
        # We don't have a direct catalog reference here to look up each asked
        # category's dimension — callers who need per-dimension info pass the
        # catalog. This method returns the raw asked set for fast O(1) membership
        # checks in undetermined_categories().
        return set(self.asked)

    def primary_platform(self) -> str | None:
        """Return the concrete primary platform that scopes design decisions."""
        target = self.overrides.get("platform", {}).get("target")
        if target in {"web", "ios", "macos"}:
            return target
        if target == "multi":
            return None
        surfaces = self.context.get("platformSurfaces")
        if isinstance(surfaces, list):
            primary = [
                item for item in surfaces
                if isinstance(item, dict) and item.get("role") == "primary"
            ]
            if len(primary) == 1 and primary[0].get("platform") in {"web", "ios", "macos"}:
                return str(primary[0]["platform"])
        return None

    def project_catalog(self, catalog: "Catalog") -> "Catalog":
        """Return the one catalog view used by every decision path."""
        return catalog.project(self.primary_platform())

    def undetermined_categories(self, catalog: "Catalog") -> list[Any]:
        """Return categories not yet decided.

        A category is undetermined when:
          1. Its id is NOT in self.asked (slot-dedup).
          2. No earlier pick has already covered its dimension (i.e., another
             category mapped to the same token path has already been asked).

        The second condition prevents the engine from asking about two
        categories that both control, say, motion.intensity — once one is
        answered the dimension is covered.

        Returns the list in catalog order (contract.py re-ranks by information
        gain before presenting to the host LLM).
        """
        catalog = self.project_catalog(catalog)
        asked_set = set(self.asked)
        # Build the set of dimensions already covered by asked categories.
        covered_dimensions: set[str] = set()
        by_id = catalog.by_id()
        for cid in self.asked:
            cat = by_id.get(cid)
            if cat and cat.dimension != "UNMAPPED":
                covered_dimensions.add(cat.dimension)

        result = []
        for cat in catalog.categories:
            if cat.id in asked_set:
                continue
            if cat.dimension in covered_dimensions:
                continue
            result.append(cat)
        return result

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable snapshot of state."""
        return {
            "context": copy.deepcopy(self.context),
            "overrides": copy.deepcopy(self.overrides),
            "per_platform": copy.deepcopy(self.per_platform),
            "asked": list(self.asked),
            "history": copy.deepcopy(self.history),
            "baseline": copy.deepcopy(self.baseline),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "TasteState":
        """Reconstruct from a to_dict() snapshot."""
        return cls(
            context=d.get("context", {}),
            overrides=d.get("overrides", {}),
            per_platform=d.get("per_platform", {}),
            asked=list(d.get("asked", [])),
            history=list(d.get("history", [])),
            baseline=d.get("baseline", {}),
        )

    def delta_since(self, baseline_overrides: dict | None = None) -> dict:
        """Return the token delta of current overrides relative to a baseline.

        Returns a 2-level token map {group: {key: value}} containing only the
        (group, key) paths whose value in self.overrides is ABSENT from the
        baseline or DIFFERS from the baseline value.  Pure, no I/O.

        Parameters
        ----------
        baseline_overrides:
            The baseline to compare against.  Defaults to self.baseline.
        """
        base = baseline_overrides if baseline_overrides is not None else self.baseline
        result: dict[str, Any] = {}
        for group, keys in self.overrides.items():
            if not isinstance(keys, dict):
                continue
            for key, val in keys.items():
                base_val = base.get(group, {}).get(key, _SENTINEL)
                if base_val is _SENTINEL or base_val != val:
                    result.setdefault(group, {})[key] = val
        return result

    def has_delta(self, baseline_overrides: dict | None = None) -> bool:
        """True iff delta_since() is non-empty."""
        return bool(self.delta_since(baseline_overrides))

    def extracted_picks(self) -> list[dict[str, str]]:
        """Return the confirm/evolve review list: every category that was
        SEEDED from extraction OR import, marked with its CURRENT EFFECTIVE option.

        A category qualifies for the review list if it has ever been picked
        with ``source in ("extract", "import")`` (either determined it — it's a
        confirm/evolve candidate). The reported ``option_id`` is the LATEST
        pick for that category of ANY source, so a user override (a later
        ``source=="pick"`` on the same category) is reflected as the current
        choice rather than reverting to the originally-seeded option. Explicit
        provenance precedence is ``DECIDED > OBSERVED > ASSUMED``; within the
        same precedence, the latest row wins.

        Each entry is ``{"category_id": str, "option_id": str}``. The list
        preserves the order each category was first seeded (extract or import).

        Pure, no I/O, no catalog reference.
        """
        extracted_order: list[str] = []        # categories ever seeded by extract/import
        extracted_set: set[str] = set()
        latest_option: dict[str, str] = {}      # category_id -> effective option_id
        latest_priority: dict[str, int] = {}
        for entry in self.history:
            cid = entry.get("category_id", "")
            oid = entry.get("option_id", "")
            if not cid:
                continue
            provenance = self._entry_provenance(entry)
            priority = {"ASSUMED": 1, "OBSERVED": 2, "DECIDED": 3}[provenance]
            if priority >= latest_priority.get(cid, 0):
                latest_option[cid] = oid
                latest_priority[cid] = priority
            if entry.get("source") in ("extract", "import") and cid not in extracted_set:
                extracted_set.add(cid)
                extracted_order.append(cid)
        return [
            {"category_id": cid, "option_id": latest_option[cid]}
            for cid in extracted_order
        ]

    @staticmethod
    def _entry_provenance(entry: dict[str, Any]) -> str:
        """Return explicit provenance, deriving it for legacy state rows."""
        explicit = str(entry.get("provenance") or "").upper()
        if explicit in {"DECIDED", "OBSERVED", "ASSUMED"}:
            return explicit
        source = entry.get("source")
        if source in {"pick", "generate"}:
            return "DECIDED"
        if source in {"extract", "import"}:
            return "OBSERVED"
        return "ASSUMED"

    # ------------------------------------------------------------------
    # Optional helper
    # ------------------------------------------------------------------

    def effective(self, catalog: "Catalog") -> dict[str, dict[str, Any]]:
        """Return resolver.resolve_all with accumulated overrides + per_platform.

        Convenience for the emitter and debugging. Not used by the decision
        engine itself (which only needs token deltas, not the full resolved set).
        """
        return resolver_mod.resolve_all(self.overrides, self.per_platform)
