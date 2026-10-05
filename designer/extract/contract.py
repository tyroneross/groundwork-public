"""Host-LLM extraction contract — structured packet for mapping IBR signals
to catalog token deltas.

Mirrors the style of designer/engine/contract.py (same F4 floor: the host LLM
reasons over structured data; no vendor API is called here).

Workflow
--------
1. Call ``build_extraction_contract(signals, catalog)`` to build the packet.
2. Write it to disk (``write_contract``).
3. The host LLM reads the file, fills the ``answer.mappings`` block, and
   writes the file back.
4. Read it back (``read_contract``) and validate (``validate_extraction_answer``).
5. Pass the filled contract to ``seed.apply_extraction``.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import copy
import json
import os
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from ..engine.catalog_loader import Catalog


# ---------------------------------------------------------------------------
# Contract builder
# ---------------------------------------------------------------------------

def build_extraction_contract(signals: dict, catalog: "Catalog") -> dict[str, Any]:
    """Build the structured packet for the host LLM to fill.

    Parameters
    ----------
    signals:
        The ``extraction_signals`` dict produced by ibr_adapter.distill_signals.
    catalog:
        The loaded design catalog (from catalog_loader.load_catalog).

    Returns
    -------
    dict
        A JSON-serializable packet. The ``answer`` block has empty
        ``mappings`` that the host LLM fills. The ``candidates`` block
        lists every catalog category with its options and token_deltas so
        the host LLM can reference them without needing to load the catalog.

    Contract shape
    --------------
    {
      "signals": {...},          # distilled extraction signals from IBR
      "candidates": [            # all catalog categories, for host-LLM reference
          {
            "category_id": str,
            "dimension": str,
            "title": str,
            "options": [{"id": str, "label": str, "token_delta": dict}],
          }, ...
      ],
      "instructions": str,       # instructions for the host LLM
      "answer": {                # HOST LLM FILLS THESE SLOTS
          "mappings": [
            {
              "category_id": str,         # REQUIRED — must be a real catalog id
              "option_id": str | null,    # pick an existing option, or null
              "token_delta": dict | null, # raw delta override, or null
              "confidence": float,        # 0.0–1.0
              "evidence": str,            # brief note on which signal drove this
            }, ...
          ]
      }
    }
    """
    candidates = []
    for cat in catalog.categories:
        candidates.append({
            "category_id": cat.id,
            "dimension": cat.dimension,
            "title": cat.title,
            "options": [
                {
                    "id": opt.id,
                    "label": opt.label,
                    "token_delta": opt.token_delta,
                }
                for opt in cat.options
            ],
        })

    instructions = (
        "You are the host LLM driving the IBR extraction phase of the adaptive "
        "design walk. Your task is to map the extracted design signals from the "
        "scanned app onto catalog token deltas, seeding the taste-state so the "
        "subsequent walk can confirm and evolve rather than start from scratch.\n\n"
        "For each catalog category where you can confidently map a signal, add an "
        "entry to ``answer.mappings`` with:\n"
        "  - ``category_id``: must be one of the candidate category_ids.\n"
        "  - ``option_id``: the closest catalog option id, OR null if you are "
        "providing a raw token_delta.\n"
        "  - ``token_delta``: a raw partial token map if option_id is null, "
        "otherwise null (the engine resolves the option's delta).\n"
        "  - ``confidence``: float 0.0–1.0. Use < 0.5 only when signal is weak.\n"
        "  - ``evidence``: one-sentence note referencing the specific signal "
        "(e.g. heading weight=700 in typography rows, accent candidate "
        "oklch(0.5 0.2 260) from button fingerprint).\n\n"
        "LEAVE OUT categories you cannot confidently map — omitted categories "
        "stay undetermined and will be surfaced in the adaptive walk. "
        "An empty mappings list is valid. "
        "Do not add fields outside the answer.mappings entries. "
        "Each mapping must provide at least one of option_id or token_delta."
    )

    return {
        "signals": copy.deepcopy(signals),
        "candidates": candidates,
        "instructions": instructions,
        "answer": {
            "mappings": [],
        },
    }


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_extraction_answer(contract: dict[str, Any]) -> list[str]:
    """Validate the host-LLM-filled answer block.

    Returns
    -------
    list[str]
        Empty list = valid. Each entry is a human-readable error string.

    Rules
    -----
    - ``answer`` block must be present and a mapping.
    - ``answer.mappings`` must be a list (empty is valid).
    - Each mapping must have a real ``category_id`` (present in candidates).
    - If ``option_id`` is given, it must be a real option of that category.
    - At least one of ``option_id`` or ``token_delta`` must be present and non-null.
    """
    errors: list[str] = []
    answer = contract.get("answer")
    if not isinstance(answer, dict):
        errors.append("answer block is missing or not a mapping")
        return errors

    mappings = answer.get("mappings")
    if not isinstance(mappings, list):
        errors.append("answer.mappings must be a list")
        return errors

    # Build lookup from candidates
    candidate_options: dict[str, set[str]] = {}
    for cand in (contract.get("candidates") or []):
        cid = cand.get("category_id")
        if cid:
            candidate_options[cid] = {o["id"] for o in (cand.get("options") or [])}

    for idx, mapping in enumerate(mappings):
        if not isinstance(mapping, dict):
            errors.append(f"mappings[{idx}] is not a dict")
            continue

        cid = mapping.get("category_id")
        if not cid:
            errors.append(f"mappings[{idx}] missing category_id")
            continue

        if cid not in candidate_options:
            errors.append(
                f"mappings[{idx}] category_id {cid!r} is not a known catalog category"
            )
            continue

        opt_id = mapping.get("option_id")
        token_delta = mapping.get("token_delta")

        if opt_id is not None and opt_id not in candidate_options[cid]:
            errors.append(
                f"mappings[{idx}] option_id {opt_id!r} is not a valid option "
                f"for category {cid!r}"
            )

        if opt_id is None and not token_delta:
            errors.append(
                f"mappings[{idx}] for {cid!r}: at least one of option_id or "
                "token_delta must be provided"
            )

    return errors


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------

def write_contract(path: str, contract: dict[str, Any]) -> None:
    """Write a contract dict to *path* as pretty-printed JSON.

    Creates parent directories if needed.
    """
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(contract, fh, indent=2, ensure_ascii=False)


def read_contract(path: str) -> dict[str, Any]:
    """Read a JSON contract file and return the dict.

    Does not validate — call validate_extraction_answer on the returned dict
    to check that the host LLM filled the answer slots correctly.
    """
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)
