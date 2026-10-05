"""Adaptive decision engine — next_step and auto_next_step.

The engine drives the ask|infer|done turn loop for the adaptive design walk.
It operates in two modes:

  HOST-LLM PATH (primary):
    next_step(state, catalog, contract_answer=None)
      - Called with no contract_answer: returns a contract dict for the host
        LLM to fill. The caller writes it to disk (contract.write_contract),
        lets the host LLM fill the answer slots, reads it back
        (contract.read_contract), validates it (contract.validate_contract_answer),
        and calls next_step again with the filled answer dict.
      - Called with a filled contract_answer: honors the host LLM's action.

  FALLBACK / HEADLESS PATH:
    auto_next_step(state, catalog) -> StepResult
      - Fully deterministic. No host LLM required.
      - Picks the highest-heuristic-score undetermined category, or terminates
        when none remain or MAX_DECISIONS is reached.
      - Used by the test suite and any headless runner. The host-LLM path is
        always primary; auto is the fallback/test harness.

Termination:
  "done" when:
    - no undetermined categories remain, OR
    - state.asked has reached MAX_DECISIONS (hard cap, tunable heuristic —
      NOT an architectural gate; the host LLM may also choose "done" earlier).

Cap and ASK/INFER lean are tunable constants documented below.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .catalog_loader import Catalog, Category
    from .state import TasteState

from . import contract as contract_mod
from .catalog._deltas import ordering_tier_for_dimension, layer_for_dimension

# ---------------------------------------------------------------------------
# Tunable constants
# ---------------------------------------------------------------------------

# Maximum number of categories to decide before the engine forces termination.
# This is a heuristic cap, NOT a divergence gate. Identical walks at cap are
# fine; the host LLM may also terminate earlier via action="done".
MAX_DECISIONS: int = 9

# Information-gain threshold below which auto_next_step prefers "infer" over
# "ask". This is a SOFT heuristic used only by the deterministic fallback path.
# The host LLM on the primary path may reason differently.
_AUTO_INFER_THRESHOLD: float = 0.40


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class StepResult:
    """Returned by next_step and auto_next_step.

    Attributes
    ----------
    action : str
        One of: "PENDING_HOST" | "ask" | "infer" | "done" |
        "rehighlight" | "generate".
        "PENDING_HOST" means the caller must pass the contract to the host LLM
        and call next_step again with the filled answer.
    contract : dict | None
        The contract packet when action == "PENDING_HOST".
    category : Category | None
        The category to present / re-highlight when action == "ask" or
        "rehighlight". May be None for "rehighlight" when the host LLM omits
        chosen_category_id (CLI reuses the current decision).
    inferred_category : Category | None
        The category that was auto-inferred when action == "infer".
    reason : str
        Human-readable explanation of why this step was chosen.
    mockup : dict | None
        The host-LLM-generated mockup envelope when action == "generate".
        Already validated by validate_mockup. The CLI must present this to the
        user and offer an explicit ACCEPT path (apply_pick source='generate')
        before any token_deltas are recorded (revealed-preference invariant).
    """
    action: str                              # "PENDING_HOST" | "ask" | "infer" | "done" | "rehighlight" | "generate"
    contract: Optional[dict[str, Any]] = None
    category: Optional[Any] = None           # Category when action == "ask" or "rehighlight"
    inferred_category: Optional[Any] = None  # Category when action == "infer"
    reason: str = ""
    mockup: Optional[dict[str, Any]] = None  # Mockup envelope when action == "generate"


# ---------------------------------------------------------------------------
# Host-LLM path
# ---------------------------------------------------------------------------

def next_step(
    state: "TasteState",
    catalog: "Catalog",
    contract_answer: Optional[dict[str, Any]] = None,
) -> StepResult:
    """Drive one turn of the adaptive walk.

    Parameters
    ----------
    state : TasteState
        Current accumulated taste-state. MUTATED in-place when the host LLM
        chooses "infer" (the inferred category is recorded via state.apply_pick).
        When action=="ask" the caller is responsible for calling
        state.apply_pick() after the user has selected an option.
    catalog : Catalog
        The full design catalog.
    contract_answer : dict | None
        If None: build and return the contract for the host LLM to fill
        (action="PENDING_HOST"). If provided: the FULL filled contract dict
        (as returned by contract.read_contract after the host LLM fills it).
        The engine extracts and validates the "answer" block from it.

    Returns
    -------
    StepResult
        See StepResult docstring.
    """
    # --- Guard: termination conditions checked before building a contract ----
    if _is_done(state, catalog):
        return StepResult(
            action="done",
            reason=_done_reason(state, catalog),
        )

    # --- No answer yet: build contract for host LLM --------------------------
    if contract_answer is None:
        ctr = contract_mod.build_decision_contract(state, catalog)
        return StepResult(
            action="PENDING_HOST",
            contract=ctr,
            reason="Contract built; awaiting host-LLM answer.",
        )

    # --- Validate the filled contract ----------------------------------------
    # contract_answer is the FULL filled contract dict (with an "answer" block).
    errors = contract_mod.validate_contract_answer(contract_answer)
    if errors:
        raise ValueError(
            f"Invalid contract answer ({len(errors)} error(s)):\n  "
            + "\n  ".join(errors)
        )

    answer_block = contract_answer["answer"]
    action = answer_block["action"]
    cid = answer_block.get("chosen_category_id")
    rationale = answer_block.get("rationale", "")

    # --- Honor host-LLM decision ---------------------------------------------
    if action == "done":
        return StepResult(
            action="done",
            reason=f"Host LLM chose done. Rationale: {rationale}",
        )

    if action == "infer":
        # Engine picks the top-ranked undetermined category and records it as
        # inferred (using the category's first option as the default).
        undetermined = state.undetermined_categories(catalog)
        if not undetermined:
            return StepResult(action="done", reason="No undetermined categories remain.")
        ranked = sorted(
            undetermined,
            key=lambda cat: (layer_for_dimension(cat.dimension), ordering_tier_for_dimension(cat.dimension), -contract_mod.information_gain(cat, state)),
        )
        cat = ranked[0]
        default_option = cat.options[0] if cat.options else None
        delta = default_option.token_delta if default_option else {}
        option_id = default_option.id if default_option else "none"
        state.apply_pick(cat.id, option_id, delta, source="infer")
        return StepResult(
            action="infer",
            inferred_category=cat,
            reason=(
                f"Host LLM chose infer; engine inferred {cat.id!r} "
                f"(dimension={cat.dimension!r}) using default option {option_id!r}. "
                f"Rationale: {rationale}"
            ),
        )

    if action == "ask":
        by_id = state.project_catalog(catalog).by_id()
        cat = by_id.get(cid)
        if cat is None:
            raise ValueError(
                f"chosen_category_id {cid!r} not found in catalog after validation. "
                "This should not happen if validate_contract_answer passed."
            )
        return StepResult(
            action="ask",
            category=cat,
            reason=(
                f"Host LLM chose to ask about {cat.id!r} "
                f"(dimension={cat.dimension!r}). Rationale: {rationale}"
            ),
        )

    if action == "rehighlight":
        # NO state mutation. category is None when cid is absent (CLI reuses
        # the current decision) or when cid is not in the catalog (tolerated —
        # validation only required cid to be a candidate when action=="ask").
        cat = None
        if cid:
            by_id = state.project_catalog(catalog).by_id()
            cat = by_id.get(cid)  # None if cid not found — caller handles gracefully
        return StepResult(
            action="rehighlight",
            category=cat,
            reason=(
                f"Host LLM chose rehighlight"
                + (f" for {cid!r}" if cid else " (current decision)")
                + f". Rationale: {rationale}"
            ),
        )

    if action == "generate":
        # NO state mutation. Mockup is already validated by validate_contract_answer.
        mockup = answer_block.get("mockup")
        return StepResult(
            action="generate",
            mockup=mockup,
            reason=(
                f"Host LLM chose generate (mockup present: {mockup is not None}). "
                f"Rationale: {rationale}"
            ),
        )

    # Should be unreachable after validate_contract_answer, but be safe.
    raise ValueError(f"Unexpected action {action!r} after validation.")


# ---------------------------------------------------------------------------
# Deterministic fallback / headless path
# ---------------------------------------------------------------------------

def present_next(state: "TasteState", catalog: "Catalog") -> StepResult:
    """NON-MUTATING: surface the next decision WITHOUT recording any pick.

    This is the INTERACTIVE-path step. The server (and any host-LLM/human driver)
    calls this to show the user the next highest-leverage undetermined decision +
    its option previews. The pick is recorded ONLY when the user actually chooses
    (via state.apply_pick / the /api/pick route).

    Returns:
      - action="ask"  + category   : present this decision to the user.
      - action="done" + reason      : the walk is determined / cap reached.

    Unlike auto_next_step, this NEVER calls state.apply_pick. It performs no
    "infer" auto-recording either: in the interactive path, dimensions the user
    never decides are simply left to the floor at emit time (the resolver fills
    them), which is the correct revealed-preference semantics — the user only
    ever owns the tokens they explicitly chose.
    """
    if _is_done(state, catalog):
        return StepResult(action="done", reason=_done_reason(state, catalog))

    undetermined = state.undetermined_categories(catalog)
    if not undetermined:
        return StepResult(action="done", reason="No undetermined categories remain.")

    ranked = sorted(
        undetermined,
        key=lambda cat: (layer_for_dimension(cat.dimension), ordering_tier_for_dimension(cat.dimension), -contract_mod.information_gain(cat, state)),
    )
    cat = ranked[0]
    gain = contract_mod.information_gain(cat, state)
    return StepResult(
        action="ask",
        category=cat,
        reason=f"present: {cat.id!r} (gain={gain:.3f}) — awaiting user pick (no auto-record).",
    )


def auto_next_step(state: "TasteState", catalog: "Catalog") -> StepResult:
    """Deterministic fallback: advance one step without the host LLM.

    Selection policy:
      - Rank undetermined categories by information_gain descending.
      - If the top candidate's score >= _AUTO_INFER_THRESHOLD: action="ask".
      - Otherwise: action="infer" (low-leverage decisions use floor defaults).
      - If none remain or MAX_DECISIONS reached: action="done".

    The host-LLM path (next_step) is always primary. Use auto_next_step for:
      - The test suite (no host LLM available).
      - Headless runs / batch preview generation.
      - Any caller that needs the engine to make progress without a human/LLM.

    IMPORTANT: auto_next_step does NOT present options to a user; it immediately
    records the pick using the top-ranked option's delta. The return value
    indicates what was decided.
    """
    if _is_done(state, catalog):
        return StepResult(
            action="done",
            reason=_done_reason(state, catalog),
        )

    undetermined = state.undetermined_categories(catalog)
    if not undetermined:
        return StepResult(action="done", reason="No undetermined categories remain.")

    ranked = sorted(
        undetermined,
        key=lambda cat: (layer_for_dimension(cat.dimension), ordering_tier_for_dimension(cat.dimension), -contract_mod.information_gain(cat, state)),
    )
    cat = ranked[0]
    gain = contract_mod.information_gain(cat, state)

    if gain >= _AUTO_INFER_THRESHOLD:
        # "ask" in auto mode: immediately pick the first option (headless).
        default_option = cat.options[0] if cat.options else None
        delta = default_option.token_delta if default_option else {}
        option_id = default_option.id if default_option else "none"
        state.apply_pick(cat.id, option_id, delta, source="auto")
        return StepResult(
            action="ask",
            category=cat,
            reason=(
                f"auto: selected {cat.id!r} (gain={gain:.3f}) "
                f"using first option {option_id!r}."
            ),
        )
    else:
        # Below threshold: infer from floor default.
        default_option = cat.options[0] if cat.options else None
        delta = default_option.token_delta if default_option else {}
        option_id = default_option.id if default_option else "none"
        state.apply_pick(cat.id, option_id, delta, source="auto-infer")
        return StepResult(
            action="infer",
            inferred_category=cat,
            reason=(
                f"auto-infer: {cat.id!r} below threshold "
                f"(gain={gain:.3f} < {_AUTO_INFER_THRESHOLD}). "
                f"Used default option {option_id!r}."
            ),
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_done(state: "TasteState", catalog: "Catalog") -> bool:
    if len(state.asked) >= MAX_DECISIONS:
        return True
    if not state.undetermined_categories(catalog):
        return True
    return False


def _done_reason(state: "TasteState", catalog: "Catalog") -> str:
    if len(state.asked) >= MAX_DECISIONS:
        return (
            f"MAX_DECISIONS cap reached ({MAX_DECISIONS}). "
            "Emit DESIGN.md with current taste-state."
        )
    return "All category dimensions determined. Ready to emit DESIGN.md."
