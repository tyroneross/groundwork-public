"""designer.gate — convergence gate for the groundwork UI-iteration loop.

Ports the style-calibrator convergence gate (client-side JS) into pure-stdlib
Python, plus an adapter that derives per-dimension {uncertainty, importance}
from Designer pick history.

Public surface (see convergence.py):
    overall_confidence(dim_states) -> float
    info_gain_remaining(dim_states) -> float
    convergence_status(dim_states, round_count, next_dim, last_rating=None,
                       max_rounds=MAX_ROUNDS) -> dict
    dim_states_from_history(history, category_dimension) -> dict
    MAX_ROUNDS  (int constant, matches source)
"""

from .convergence import (
    MAX_ROUNDS,
    convergence_status,
    dim_states_from_history,
    info_gain_remaining,
    overall_confidence,
)

__all__ = [
    "MAX_ROUNDS",
    "overall_confidence",
    "info_gain_remaining",
    "convergence_status",
    "dim_states_from_history",
]
