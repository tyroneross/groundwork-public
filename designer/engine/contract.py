"""Host-LLM decision contract — the structured packet the host agent fills.

The adaptive walk works by having the engine write a question packet (contract)
to a file, then the host LLM (Claude / Codex / etc.) reads it, fills in the
answer slots, and writes it back. The engine reads the filled contract and
advances state. No vendor API calls are ever made here.

This is the F4 floor: "host-agent-is-the-LLM." The engine provides structured
data + instructions; the host LLM reasons over it.

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import copy
import json
import os
import re
from typing import Any, TYPE_CHECKING

# Matches an inline HTML event-handler attribute (on<word> optionally followed by
# whitespace then '='), e.g. ` onerror=`, `onclick =`. Word-boundary-anchored so
# it does not match e.g. a CSS property or the literal word "on".
_INLINE_HANDLER_RE = re.compile(r"\son[a-z]+\s*=", re.IGNORECASE)

if TYPE_CHECKING:
    from .catalog_loader import Catalog, Category
    from .state import TasteState

from .catalog._deltas import ordering_tier_for_dimension, layer_for_dimension, layer_label
from .schema import validate_token_delta


# ---------------------------------------------------------------------------
# Information-gain heuristic
# ---------------------------------------------------------------------------

# Keyword priors that map context signals to high-leverage token dimensions.
# This is a SOFT RANKING SIGNAL for the host LLM — never a gate. The host LLM
# may always override the ranking with its own reasoning.
#
# Structure: {dimension -> {context_keyword -> boost}}
# boost is additive to the base score; dimensions not listed start at 0.5.

_DIMENSION_BASE: dict[str, float] = {
    # High structural impact — these decisions cascade across the whole design.
    "color.accent": 0.75,
    "color.surface": 0.70,
    "typography.headingWeight": 0.65,
    "spacing.density": 0.70,
    "motion.intensity": 0.65,
    "nav.tabStyle": 0.60,
    "nav.activeStyle": 0.55,
    # Mid-tier — noticeable but scoped
    "elevation.style": 0.55,
    "motion.transition": 0.55,
    "motion.press": 0.50,
    "radius.button": 0.50,
    "components.buttonShape": 0.50,
    "components.emptyState": 0.45,
    "components.toast": 0.45,
    # Lower impact — micro-decisions
    "components.separator": 0.35,
    "typography.numericStyle": 0.35,
}

# Context keyword -> dimension -> extra boost (capped at 1.0 total).
_CONTEXT_BOOSTS: dict[str, dict[str, float]] = {
    # Emotional register
    "playful":     {"color.accent": 0.15, "motion.intensity": 0.15, "radius.button": 0.10},
    "calm":        {"motion.intensity": -0.10, "color.accent": 0.10, "spacing.density": 0.10},
    "energetic":   {"motion.intensity": 0.15, "motion.press": 0.10, "color.accent": 0.10},
    "serious":     {"typography.headingWeight": 0.15, "color.surface": 0.10},
    "minimal":     {"spacing.density": 0.15, "color.surface": 0.10, "components.separator": 0.10},
    "expressive":  {"color.accent": 0.15, "motion.intensity": 0.10},
    "trustworthy": {"color.surface": 0.10, "typography.headingWeight": 0.10},
    "modern":      {"motion.transition": 0.10, "nav.tabStyle": 0.10},
    # Density signals
    "compact":     {"spacing.density": 0.15, "typography.numericStyle": 0.10},
    "spacious":    {"spacing.density": 0.15},
    "dense":       {"spacing.density": 0.15, "typography.numericStyle": 0.10},
    # Audience signals
    "consumer":    {"color.accent": 0.10, "motion.intensity": 0.10},
    "enterprise":  {"typography.headingWeight": 0.15, "color.surface": 0.10},
    "professional":{"typography.headingWeight": 0.10, "spacing.density": 0.10},
    "athlete":     {"motion.intensity": 0.10, "color.accent": 0.10},
    "fitness":     {"motion.intensity": 0.10, "color.accent": 0.10, "spacing.density": 0.05},
    "health":      {"color.accent": 0.05, "color.surface": 0.05},
    # Domain signals
    "finance":     {"typography.numericStyle": 0.20, "color.surface": 0.10},
    "data":        {"typography.numericStyle": 0.15, "spacing.density": 0.10},
    "social":      {"color.accent": 0.10, "motion.intensity": 0.05, "nav.tabStyle": 0.10},
    "gaming":      {"motion.intensity": 0.15, "color.accent": 0.10},
    "productivity":{"spacing.density": 0.15, "nav.tabStyle": 0.05},
    "creative":    {"color.accent": 0.10, "motion.intensity": 0.05},
    "travel":      {"color.accent": 0.05, "motion.transition": 0.05},
    "ecommerce":   {"color.accent": 0.10, "nav.tabStyle": 0.05},
}


def information_gain(category: "Category", state: "TasteState") -> float:
    """Estimate how much deciding this category would inform the design.

    Returns a float in [0.0, 1.0]. Higher = more leverage, present the category
    earlier. This is a SOFT RANKING SIGNAL — the host LLM may override the
    ranking with its own judgment.

    Heuristic:
      1. Start from the dimension's base score (structural weight).
      2. Add keyword boosts derived from state.context (description, mood,
         audience, density fields are all scanned for known keywords).
      3. Clamp to [0.0, 1.0].

    The scoring is deterministic given identical (category, state) inputs.
    """
    dim = category.dimension
    score: float = _DIMENSION_BASE.get(dim, 0.5)

    # Flatten context into a single lowercase string for keyword scanning.
    ctx_blob = _flatten_context(state.context)

    for keyword, dim_boosts in _CONTEXT_BOOSTS.items():
        if keyword in ctx_blob and dim in dim_boosts:
            score += dim_boosts[dim]

    return max(0.0, min(1.0, score))


def _flatten_context(ctx: dict[str, Any]) -> str:
    """Convert context dict to a single lowercase string for keyword matching."""
    parts: list[str] = []
    for v in ctx.values():
        if isinstance(v, str):
            parts.append(v.lower())
        elif isinstance(v, list):
            parts.extend(str(x).lower() for x in v)
        elif isinstance(v, dict):
            parts.append(_flatten_context(v))
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Contract builder
# ---------------------------------------------------------------------------

def build_decision_contract(
    state: "TasteState",
    catalog: "Catalog",
    pending_chat: "dict[str, Any] | None" = None,
) -> dict[str, Any]:
    """Build the structured packet for the host LLM to fill.

    The host LLM reads this dict (usually written to a .json file via
    write_contract), fills the answer slots, and writes it back. The engine
    then reads it via read_contract + validate_contract_answer.

    Parameters
    ----------
    state : TasteState
        Current accumulated taste-state.
    catalog : Catalog
        The full design catalog.
    pending_chat : dict | None
        Optional chat message from the user to the host LLM. When provided,
        it is included in the returned contract as ``contract["pending_chat"]``
        with at least a ``"text"`` key. The host LLM interprets the message
        and may respond with action="rehighlight" or action="generate". The
        engine treats this field as opaque data only — it does not parse or
        validate the chat content beyond confirming it is a dict with a
        non-empty "text" string.

    Returned structure
    ------------------
    {
      "context": {...},                  # what the user is building
      "taste_summary": {                 # accumulated decisions so far
          "picks_count": int,
          "asked_categories": [...],
          "overrides_snapshot": {...},
      },
      "candidates": [                    # undetermined categories, ranked
          {
            "id": str,
            "title": str,
            "description": str,
            "cp_note": str,
            "dimension": str,
            "information_gain": float,   # SOFT heuristic, may be overridden
            "options": [
              {"id": str, "label": str, "tag": str, "desc": str}
            ]
          }, ...
      ],
      "instructions": str,               # instructions for the host LLM
      "pending_chat": {                  # OPTIONAL — present only when the user
          "text": str,                   # typed a chat message. Host LLM reads
          ...                            # and may include extra fields verbatim.
      },
      "answer": {                        # HOST LLM FILLS THESE SLOTS
          "action": null,                # "ask" | "infer" | "done"
                                         # | "rehighlight" | "generate"
          "chosen_category_id": null,    # required when action == "ask";
                                         # optional for "rehighlight"
          "rationale": null,             # optional free text
          "mockup": null,                # required when action == "generate"
      }
    }
    """
    undetermined = state.undetermined_categories(catalog)

    # Composite sort: primary = layer ASCENDING (Layer 1 "Scope & Skeleton" first,
    # then Layer 2 "Foundations", then Layer 3 "Details"); secondary =
    # ordering_tier ASCENDING as a within-layer tie-break; tertiary =
    # information_gain DESCENDING as a final tie-break within each ordering-tier.
    #
    # Rationale: design tokens follow a primitive→semantic→component cascade
    # (per Material Design, Atlassian Design System, USWDS). Block-in general→specific
    # (painter's algorithm for decisions). Surface the highest-elimination scope
    # decisions first (platform, nav structure), then visual foundations, then
    # surface details — progressive disclosure per Hick's Law. This is a SOFT
    # default: the host LLM may still pick any candidate from the list.
    ranked = sorted(
        undetermined,
        key=lambda cat: (layer_for_dimension(cat.dimension), ordering_tier_for_dimension(cat.dimension), -information_gain(cat, state)),
    )

    candidates = []
    for cat in ranked:
        ot = ordering_tier_for_dimension(cat.dimension)
        lyr = layer_for_dimension(cat.dimension)
        candidates.append({
            "id": cat.id,
            "title": cat.title,
            "description": cat.description,
            "cp_note": cat.cp_note,
            "dimension": cat.dimension,
            "information_gain": round(information_gain(cat, state), 4),
            "ordering_tier": ot,
            "layer": lyr,
            "layer_label": layer_label(lyr),
            "applicable_platforms": sorted(cat.platforms) if cat.platforms else ["ios", "macos", "web"],
            "options": [
                {
                    "id": opt.id,
                    "label": opt.label,
                    "tag": opt.tag,
                    "desc": opt.desc,
                    "applicable_platforms": sorted(opt.platforms) if opt.platforms else ["ios", "macos", "web"],
                }
                for opt in cat.options
            ],
        })

    taste_summary = {
        "picks_count": len(state.history),
        "asked_categories": list(state.asked),
        "overrides_snapshot": copy.deepcopy(state.overrides),
        "platform_scope": state.primary_platform() or "multi-or-unresolved",
    }

    instructions = (
        "You are the host LLM driving an adaptive design walk. "
        "Based on the context and accumulated taste-state, choose ONE action:\n\n"
        "  'ask'         — Present the chosen_category_id to the user as the next\n"
        "                  decision. chosen_category_id MUST be one of the candidate\n"
        "                  ids listed above. Candidates are ordered coarse→fine by\n"
        "                  layer:\n"
        "                    Layer 1 'Scope & Skeleton' (platform, nav structure —\n"
        "                    highest elimination power) → Layer 2 'Foundations'\n"
        "                    (accent, type, density, shape, nav style) → Layer 3\n"
        "                    'Details' (surface treatment, motion, micro).\n"
        "                  Within each layer, candidates are ordered by ordering_tier\n"
        "                  then information_gain. Each candidate carries 'layer' (int)\n"
        "                  and 'layer_label' (str) for your reference. This ordering\n"
        "                  is a SOFT default — picking any candidate is always valid.\n\n"
        "  'infer'       — Skip asking; infer a sensible default from context priors.\n"
        "                  The engine will record the top-ranked undetermined category\n"
        "                  as inferred (using its first/default option).\n\n"
        "  'done'        — Terminate the walk. The engine will emit the DESIGN.md.\n"
        "                  Use this when the design is sufficiently defined or the\n"
        "                  user has reached a natural stopping point.\n\n"
        "  'rehighlight' — Re-annotate the current (or a named) decision. Use this\n"
        "                  when the user's chat message asks to reconsider, clarify,\n"
        "                  or re-examine options for a category without advancing\n"
        "                  state. chosen_category_id is OPTIONAL (if omitted the CLI\n"
        "                  re-uses the last presented decision). option_hints may be\n"
        "                  filled to guide the user's attention. No state mutation.\n\n"
        "  'generate'    — Produce a low-fidelity HTML mockup in answer.mockup.\n"
        "                  Use this when the user asks to see a preview, concept,\n"
        "                  or visual for the current taste-state. The mockup PROPOSES\n"
        "                  token_deltas; the user must explicitly ACCEPT them before\n"
        "                  any tokens are recorded (revealed-preference invariant).\n"
        "                  chosen_category_id is NOT required for generate.\n"
        "                  answer.mockup must conform to the validate_mockup contract:\n"
        "                    - mockup.html: non-empty string, inline-only (no <script,\n"
        "                      no external src=http…, no @import, no <link).\n"
        "                    - mockup.token_deltas (optional): {group:{key:value}}\n"
        "                      map using known token vocabulary paths.\n"
        "                    - mockup.label, mockup.platform, mockup.rationale:\n"
        "                      optional free strings.\n\n"
        "If a 'pending_chat' block is present, read the user's message and let it\n"
        "guide your action choice and option_hints / mockup content.\n\n"
        "Fill the 'answer' block below. Do not add fields outside the answer block.\n"
        "The 'layer', 'ordering_tier', and 'information_gain' fields in candidates\n"
        "are SOFT hints — identical or divergent walks are both acceptable."
    )

    result: dict[str, Any] = {
        "context": copy.deepcopy(state.context),
        "taste_summary": taste_summary,
        "candidates": candidates,
        "instructions": instructions,
        "answer": {
            "action": None,
            "chosen_category_id": None,
            "rationale": None,
            # option_hints: list[{option_id, highlight?, annotate?}] | None
            # Fill this when action == "ask" or "rehighlight" to highlight/
            # annotate best-fit options for the user. NEVER use it to remove
            # platform-eligible options (revealed preference is preserved
            # within the active platform scope).
            "option_hints": None,
            # mockup: dict | None
            # Required when action == "generate". Must conform to the
            # validate_mockup contract (inline HTML only, optional token_deltas).
            "mockup": None,
        },
    }

    if pending_chat is not None:
        result["pending_chat"] = {"text": pending_chat.get("text", ""), **{
            k: v for k, v in pending_chat.items() if k != "text"
        }}

    return result


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

    Does not validate — call validate_contract_answer on the returned dict
    to check that the host LLM filled the answer slots correctly.
    """
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Answer validation
# ---------------------------------------------------------------------------

VALID_ACTIONS = frozenset({"ask", "infer", "done", "rehighlight", "generate"})


def validate_mockup(mockup: dict[str, Any]) -> list[str]:
    """Validate a host-LLM-generated mockup envelope.

    Returns a list of error strings. Empty list = valid.

    Rules
    -----
    - ``mockup`` must be a dict.
    - ``mockup["html"]`` must be a non-empty string AND must NOT contain:
        * ``<script``  (case-insensitive) — no inline scripts
        * ``src="http``, ``src='http``, or ``src=http`` — no external resources
        * ``@import`` — no CSS imports
        * ``<link``   (case-insensitive) — no external stylesheets
        * an inline event handler ``on<event>=`` (e.g. ``onerror=``,
          ``onload=``, ``onclick=``) — no inline JS execution vectors
        * ``javascript:`` (case-insensitive) — no javascript-scheme URIs
      These restrictions enforce the self-contained inline-only contract,
      mirroring the scope_preview safety policy. The event-handler and
      javascript-scheme checks harden the gate beyond the existing preview
      path (defense-in-depth on the innerHTML render of agent-authored HTML).
    - ``mockup["token_deltas"]`` (optional): if present must be a dict and must
      pass ``validate_token_delta``; unknown token paths are ERRORS here (the
      server/accept layer decides drop-vs-reject, but validate_mockup surfaces
      them).
    - ``mockup["label"]``, ``mockup["platform"]``, ``mockup["rationale"]``
      (all optional): must be strings if present; content is unconstrained.

    The engine does NOT author HTML or interpret semantics — it only validates
    structure and safety constraints.
    """
    errors: list[str] = []

    if not isinstance(mockup, dict):
        errors.append("mockup must be a dict")
        return errors

    # --- html (required) ---
    html = mockup.get("html")
    if not isinstance(html, str) or not html:
        errors.append("mockup.html must be a non-empty string")
    else:
        html_lower = html.lower()
        if "<script" in html_lower:
            errors.append("mockup.html must not contain <script (inline scripts not allowed)")
        if "src=\"http" in html or "src='http" in html or "src=http" in html:
            errors.append("mockup.html must not reference external resources via src=http…")
        if "@import" in html:
            errors.append("mockup.html must not contain @import")
        if "<link" in html_lower:
            errors.append("mockup.html must not contain <link (external stylesheets not allowed)")
        # Inline event handlers (onerror=, onload=, onclick=, …) are a JS-exec
        # vector even without <script>. Match an HTML attribute of the form
        # on<word>= (optionally with whitespace before '='). Defense-in-depth.
        if _INLINE_HANDLER_RE.search(html):
            errors.append("mockup.html must not contain inline event handlers (on…= attributes)")
        if "javascript:" in html_lower:
            errors.append("mockup.html must not contain javascript: URIs")

    # --- token_deltas (optional) ---
    token_deltas = mockup.get("token_deltas")
    if token_deltas is not None:
        if not isinstance(token_deltas, dict):
            errors.append("mockup.token_deltas must be a dict if present")
        else:
            result = validate_token_delta(token_deltas)
            errors.extend(result.errors)

    # --- optional free-string fields ---
    for field_name in ("label", "platform", "rationale"):
        val = mockup.get(field_name)
        if val is not None and not isinstance(val, str):
            errors.append(f"mockup.{field_name} must be a string if present, got {type(val).__name__!r}")

    return errors


def validate_contract_answer(contract: dict[str, Any]) -> list[str]:
    """Validate the host-LLM-filled answer block.

    Returns a list of error strings. Empty list = valid.

    Checks:
      - answer block is present
      - action is one of "ask" | "infer" | "done" | "rehighlight" | "generate"
      - when action == "ask": chosen_category_id is non-null and present in
        the contract's candidate list.
      - when action == "rehighlight": chosen_category_id is OPTIONAL (no error
        if absent); option_hints validation still applies.
      - when action == "generate": answer.mockup is required and is validated
        via validate_mockup; chosen_category_id is NOT required.
      - optional answer.option_hints (if present): must be a list of dicts,
        each with a non-empty string option_id; highlight (if present) must be
        bool; annotate (if present) must be a string.

    option_hints semantics
    ----------------------
    option_hints highlight/annotate best-fit options; they NEVER filter or
    remove platform-eligible options (revealed preference is preserved). The
    eligible option list is surfaced unchanged. option_hints is only meaningful when
    action == "ask" or "rehighlight"; if present with another action it is a
    soft no-op (not an error — the validator ignores it rather than rejecting
    the answer).
    """
    errors: list[str] = []
    answer = contract.get("answer")
    if not isinstance(answer, dict):
        errors.append("answer block is missing or not a mapping")
        return errors

    action = answer.get("action")
    if action not in VALID_ACTIONS:
        errors.append(
            f"answer.action must be one of {sorted(VALID_ACTIONS)!r}, got {action!r}"
        )

    if action == "ask":
        cid = answer.get("chosen_category_id")
        if not cid:
            errors.append("answer.chosen_category_id is required when action == 'ask'")
        else:
            candidate_ids = {c["id"] for c in contract.get("candidates", [])}
            if cid not in candidate_ids:
                errors.append(
                    f"answer.chosen_category_id {cid!r} not in candidate list; "
                    f"valid ids: {sorted(candidate_ids)}"
                )

    # rehighlight: chosen_category_id is optional — no structural error if absent.
    # option_hints validation (below) still applies as a soft annotation signal.

    if action == "generate":
        mockup = answer.get("mockup")
        if mockup is None:
            errors.append("answer.mockup is required when action == 'generate'")
        else:
            mockup_errors = validate_mockup(mockup)
            errors.extend(f"answer.mockup: {e}" for e in mockup_errors)

    # Validate optional option_hints (action-agnostic structural check).
    hints = answer.get("option_hints")
    if hints is not None:
        if not isinstance(hints, list):
            errors.append("answer.option_hints must be a list if present")
        else:
            for i, hint in enumerate(hints):
                prefix = f"answer.option_hints[{i}]"
                if not isinstance(hint, dict):
                    errors.append(f"{prefix} must be a dict")
                    continue
                oid = hint.get("option_id")
                if not isinstance(oid, str) or not oid:
                    errors.append(
                        f"{prefix}.option_id must be a non-empty string, got {oid!r}"
                    )
                highlight = hint.get("highlight")
                if highlight is not None and not isinstance(highlight, bool):
                    errors.append(
                        f"{prefix}.highlight must be a bool if present, got {highlight!r}"
                    )
                annotate = hint.get("annotate")
                if annotate is not None and not isinstance(annotate, str):
                    errors.append(
                        f"{prefix}.annotate must be a string if present, got {annotate!r}"
                    )

    return errors
