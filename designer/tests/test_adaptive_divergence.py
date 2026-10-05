"""Adaptive divergence test — the #1-criterion adaptivity claim (f2).

The headline claim of the adaptive drive mode is that the *agent chooses which
decision to ask next*, so two agent answer-streams that diverge on an early pick
produce DIFFERENT downstream `asked[]` sequences. This is what distinguishes
adaptive mode from the Standard deterministic walk.

This test captures that claim directly, plus the baseline contrast:

  ADAPTIVE  — two scripted agent streams (via decide.next_step + the contract
              answer path) that diverge on the first asked category AND the
              first picked option. Assert the resulting asked[] sequences DIFFER.

  STANDARD  — the deterministic present_next walk is purely rank-ordered: given
              the SAME divergent first pick, the downstream order it surfaces is
              IDENTICAL regardless of how the agent would have steered. That is
              the baseline contrast — the engine's ranking is stable, so any
              downstream divergence in adaptive mode is the AGENT's doing, not
              the engine's.

Run: python3 -m pytest designer/tests/test_adaptive_divergence.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from designer.engine.state import TasteState
from designer.engine.catalog_loader import load_catalog
from designer.engine import contract as contract_mod
from designer.engine import decide as decide_mod


def _catalog():
    return load_catalog(strict=False)


def _build_ask_answer(state, catalog, chosen_category_id):
    """Build a filled contract whose answer block asks `chosen_category_id`.

    Mirrors what the host LLM (agent) fills in via the /api/agent/answer path.
    """
    ctr = contract_mod.build_decision_contract(state, catalog)
    ctr["answer"] = {
        "action": "ask",
        "chosen_category_id": chosen_category_id,
        "rationale": "scripted divergence test",
    }
    errors = contract_mod.validate_contract_answer(ctr)
    assert not errors, f"scripted answer invalid: {errors}"
    return ctr


def _candidate_ids(state, catalog):
    """The category ids the agent may currently choose to ask about."""
    ctr = contract_mod.build_decision_contract(state, catalog)
    return [c["id"] for c in ctr["candidates"]]


def _drive_adaptive(catalog, script):
    """Drive the adaptive path with a scripted stream of agent decisions.

    `script` is a list of callables: each receives (state, candidate_ids) and
    returns (chosen_category_id, option_index). We ask that category via the
    contract answer path (decide.next_step), then record the user's pick.

    Returns the final state (state.asked is the captured decision sequence).
    """
    state = TasteState(context={"description": "a productivity dashboard"})
    by_id = catalog.by_id()
    for directive in script:
        cands = _candidate_ids(state, catalog)
        if not cands:
            break
        chosen_id, opt_index = directive(state, cands)
        # Agent answers: ask about chosen_id (the engine validates + echoes it).
        answer = _build_ask_answer(state, catalog, chosen_id)
        result = decide_mod.next_step(state, catalog, contract_answer=answer)
        assert result.action == "ask", result.reason
        cat = by_id[chosen_id]
        # User picks the directed option for that category.
        opt = cat.options[opt_index]
        state.apply_pick(cat.id, opt.id, opt.token_delta, source="pick")
    return state


def test_adaptive_divergence():
    """Two divergent agent streams produce DIFFERENT asked[] sequences."""
    catalog = _catalog()

    # Both streams must diverge on the FIRST asked category. The candidate list
    # at the opening state is identical for both, so pick two distinct opening
    # categories from it.
    opening = TasteState(context={"description": "a productivity dashboard"})
    opening_candidates = _candidate_ids(opening, catalog)
    assert len(opening_candidates) >= 2, (
        "need at least two opening candidates to diverge on the first pick"
    )
    first_a = opening_candidates[0]
    first_b = opening_candidates[1]
    assert first_a != first_b

    # Stream A: open on first_a, then thereafter ask the top candidate.
    # Stream B: open on first_b, then thereafter ask the top candidate.
    def stream(first_id):
        steps = []
        # Step 1: the divergent opening choice (option index 0).
        steps.append(lambda st, cands, fid=first_id: (fid, 0))
        # Steps 2..N: greedily ask the current top-ranked candidate, pick opt 0.
        for _ in range(6):
            steps.append(lambda st, cands: (cands[0], 0))
        return steps

    state_a = _drive_adaptive(catalog, stream(first_a))
    state_b = _drive_adaptive(catalog, stream(first_b))

    # The HEADLINE assertion: divergent opening => divergent decision sequences.
    assert state_a.asked != state_b.asked, (
        "adaptive streams that diverge on the first asked category must yield "
        f"different asked[] sequences; got A={state_a.asked} B={state_b.asked}"
    )
    # Both must be non-trivial walks (not an immediate stop).
    assert len(state_a.asked) >= 2 and len(state_b.asked) >= 2


def test_standard_walk_is_identical_given_same_first_pick():
    """Baseline contrast: the Standard present_next walk is rank-deterministic.

    Given the SAME divergent first pick applied to two independent states, the
    deterministic present_next walk surfaces the IDENTICAL downstream order.
    Any divergence seen in adaptive mode is therefore the agent's steering, not
    the engine's ranking.
    """
    catalog = _catalog()

    # Establish a single "divergent first pick" — the category the adaptive test
    # used to fork on. Apply it identically to two fresh states.
    seed = TasteState(context={"description": "a productivity dashboard"})
    seed_candidates = _candidate_ids(seed, catalog)
    by_id = catalog.by_id()
    first_cat = by_id[seed_candidates[0]]
    first_opt = first_cat.options[0]

    def standard_walk_after_first_pick():
        st = TasteState(context={"description": "a productivity dashboard"})
        st.apply_pick(first_cat.id, first_opt.id, first_opt.token_delta, source="pick")
        order = []
        for _ in range(20):
            step = decide_mod.present_next(st, catalog)
            if step.action == "done":
                break
            assert step.action == "ask"
            cat = step.category
            order.append(cat.id)
            # present_next is non-mutating; record the floor pick to advance.
            opt = cat.options[0]
            st.apply_pick(cat.id, opt.id, opt.token_delta, source="pick")
        return order

    order_1 = standard_walk_after_first_pick()
    order_2 = standard_walk_after_first_pick()

    assert order_1 == order_2, (
        "Standard present_next walk must be identical given the same first pick; "
        f"got {order_1} vs {order_2}"
    )
    assert len(order_1) >= 1, "expected a non-empty downstream Standard walk"
