"""designer engine CLI — the JSON bridge the Node server (and a human) calls.

The Node interface stays dumb: it shells out to this CLI for every engine
operation and renders the JSON it returns. The Python engine is the single
source of truth (FORK-1 Path A). The host LLM, when driving adaptively, fills
the decision contract; the CLI also exposes an `auto` step so the loop runs
headless for testing/demo.

Subcommands (all read state JSON on stdin or --state, write JSON to stdout):
  init      --context "<desc>"            -> fresh state JSON
  step      --state <file>               -> next decision + its option previews
                                            (auto path: highest-leverage undetermined)
  contract  --state <file>               -> the host-LLM decision contract packet
  pick      --state <file> --category C --option O  -> updated state JSON
  current   --state <file>               -> live previews of the current design
  emit      --state <file> --out <path> --name <n> [--no-flatten]  -> writes DESIGN.md
  preview-md --state <file> --name <n>   -> the rendered DESIGN.md text (no write)

Pure stdlib.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from . import catalog_loader as cl
from . import decide as decide_mod
from . import contract as contract_mod
from . import learn_more as learn_more_mod
from . import draft as draft_mod
from .state import TasteState
from .schema import validate_token_delta
from .catalog._deltas import ordering_tier_for_dimension, ordering_tier_label, layer_for_dimension, layer_label
from ..preview import schematic
from ..preview.focus_spec import focus_for
from ..emit import design_md, writer
from ..emit import promote as promote_mod
from ..extract import ibr_adapter, contract as extract_contract_mod, seed as seed_mod
from ..extract import import_design as import_design_mod


def _plugin_root() -> str:
    """Return the repo root (two directory levels above this module).

    This module lives at designer/engine/cli.py; the plugin root is the
    directory that contains the 'designer' package, i.e. the repo root.
    """
    this_file = os.path.abspath(__file__)
    # this_file -> designer/engine/cli.py
    # dirname -> designer/engine/
    # dirname -> designer/
    # dirname -> repo_root/
    return os.path.dirname(os.path.dirname(os.path.dirname(this_file)))


def _unwrap_state(obj: object) -> dict:
    """Accept both the wrapped {"state": {...}} and bare {...} state shapes.

    cmd_init and cmd_pick emit {"state": {...}} so the output is re-feedable
    directly as --state input (the CLI docstring promise at line ~9). The Node
    server is safe because it already unwraps .state; this makes direct CLI
    round-trip safe too. Emit shape is UNCHANGED.
    """
    if isinstance(obj, dict) and "state" in obj and isinstance(obj["state"], dict):
        return obj["state"]
    return obj  # type: ignore[return-value]


def _load_state(args) -> TasteState:
    if getattr(args, "state", None):
        with open(args.state, encoding="utf-8") as fh:
            return TasteState.from_dict(_unwrap_state(json.load(fh)))
    data = sys.stdin.read().strip()
    if data:
        return TasteState.from_dict(_unwrap_state(json.loads(data)))
    return TasteState()


def _emit(obj) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")


def cmd_init(args):
    ctx = {"description": args.context or ""}
    st = TasteState(context=ctx)
    _emit({"state": st.to_dict()})


def _decision_payload(c, overrides):
    # Tiered previews carry the AUTHORITATIVE per-(option, platform) tier the
    # engine selected — no HTML string-sniffing. high == fidelity changes the
    # pick (color/depth/motion); low == low-fi schematic. The picker stays dumb:
    # it renders the preview HTML strings and labels the tier.
    # enable_focus=True: low-fi fragments get focus rings + non-target dimming.
    tiered = schematic.render_decision_previews_tiered(c, c.options, overrides, enable_focus=True)
    tier = schematic.tier_for_dimension(c.dimension)

    def _opt_payload(o):
        cells = tiered.get(o.id, {})
        platform_scope = overrides.get("platform", {}).get("target")
        if platform_scope in {"web", "ios", "macos"}:
            cells = {platform_scope: cells[platform_scope]} if platform_scope in cells else {}
        previews = {p: cell["html"] for p, cell in cells.items()}
        # platforms the engine actually escalated to high-fi for this option
        hi_platforms = [p for p, cell in cells.items() if cell["tier"] == "high"]
        return {
            "id": o.id, "label": o.label, "tag": o.tag, "desc": o.desc,
            "applicable_platforms": sorted(o.platforms) if o.platforms else ["ios", "macos", "web"],
            "previews": previews,
            "fidelity": "high" if hi_platforms else "low",
            "high_fi_platforms": hi_platforms,
        }

    ot = ordering_tier_for_dimension(c.dimension)
    lyr = layer_for_dimension(c.dimension)
    return {
        "category_id": c.id, "title": c.title, "description": c.description,
        "cp_note": c.cp_note, "dimension": c.dimension,
        "applicable_platforms": sorted(c.platforms) if c.platforms else ["ios", "macos", "web"],
        "tier": tier,                              # fidelity tier (existing, unchanged)
        "ordering_tier": ot,                       # ordering tier 1|2|3
        "ordering_tier_label": ordering_tier_label(ot),  # "Direction"|"Foundations"|"Details"
        "layer": lyr,                              # coarse-to-fine layer 1|2|3
        "layer_label": layer_label(lyr),           # "Scope & Skeleton"|"Foundations"|"Details"
        "options": [_opt_payload(o) for o in c.options],
        "focus_spec": focus_for(c.dimension),      # structured focus metadata for this dimension
        "learn_more": learn_more_mod.build_learn_more(c),  # <details> explainer HTML
    }


def _apply_option_hints(payload: dict, hints: list) -> dict:
    """Apply option_hints to a _decision_payload dict in-place and return it.

    For each hint in *hints*, find the option in payload["options"] whose "id"
    matches hint["option_id"] and set:
      - opt["highlight"] = bool(hint["highlight"])  if "highlight" is present
      - opt["annotate"]  = str(hint["annotate"])    if "annotate" is present

    Eligible options without a matching hint are LEFT UNCHANGED — never removed.
    option_hints are highlight/annotate ONLY; revealed preference is preserved.
    """
    if not hints:
        return payload
    hint_map = {h["option_id"]: h for h in hints if isinstance(h, dict) and h.get("option_id")}
    for opt in payload.get("options", []):
        h = hint_map.get(opt.get("id"))
        if h is None:
            continue
        if "highlight" in h:
            opt["highlight"] = bool(h["highlight"])
        if "annotate" in h:
            opt["annotate"] = str(h["annotate"])
    return payload


def cmd_next_step(args):
    """Host-LLM adaptive step: expose decide.next_step through the CLI.

    Without --answer: returns the decision contract (action="PENDING_HOST") so
    the host LLM can inspect candidates and fill the answer block.

    With --answer <file>: reads the filled contract, calls decide.next_step,
    and emits the result. The host agent's rationale is surfaced as agent_reason.
    For action=="ask", the decision payload is augmented with any option_hints
    the host LLM provided (highlight/annotate only — eligible options are never filtered).

    Emitted shapes
    --------------
    PENDING_HOST:
      {"action": "PENDING_HOST", "contract": {...}, "state": {...}}

    ask:
      {"action": "ask", "reason": "...", "agent_reason": "...",
       "decision": {<payload with optional highlight/annotate on hinted options>},
       "state": {...}}

    infer:
      {"action": "infer", "reason": "...",
       "inferred": {"category_id": "...", "title": "..."} | null,
       "state": {...}}

    done:
      {"action": "done", "reason": "...", "state": {...}}

    error (invalid filled answer):
      {"error": "...", "state": {...}}
    """
    cat = cl.load_catalog()
    st = _load_state(args)

    answer_path = getattr(args, "answer", None)

    # --- No answer yet: return contract for host LLM --------------------------
    if not answer_path:
        r = decide_mod.next_step(st, cat, None)
        _emit({"action": "PENDING_HOST", "contract": r.contract, "state": st.to_dict()})
        return

    # --- Read the filled contract file ----------------------------------------
    try:
        with open(answer_path, encoding="utf-8") as fh:
            filled = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        _emit({"error": f"Could not read answer file: {exc}", "state": st.to_dict()})
        return

    # --- Call next_step with the filled contract; catch validation errors ------
    try:
        r = decide_mod.next_step(st, cat, filled)
    except ValueError as exc:
        _emit({"error": str(exc), "state": st.to_dict()})
        return

    agent_reason = ""
    if isinstance(filled.get("answer"), dict):
        agent_reason = filled["answer"].get("rationale", "") or ""

    # --- Emit based on action -------------------------------------------------
    if r.action == "ask":
        payload = _decision_payload(r.category, st.overrides)
        hints = None
        if isinstance(filled.get("answer"), dict):
            hints = filled["answer"].get("option_hints")
        if hints:
            _apply_option_hints(payload, hints)
        _emit({
            "action": "ask",
            "reason": r.reason,
            "agent_reason": agent_reason,
            "decision": payload,
            "state": st.to_dict(),
        })

    elif r.action == "infer":
        inferred = None
        if r.inferred_category is not None:
            inferred = {"category_id": r.inferred_category.id, "title": r.inferred_category.title}
        _emit({
            "action": "infer",
            "reason": r.reason,
            "inferred": inferred,
            "state": st.to_dict(),
        })

    elif r.action == "done":
        _emit({"action": "done", "reason": r.reason, "state": st.to_dict()})

    elif r.action == "rehighlight":
        # Chat re-annotate (CB1, FORK A3): re-surface the CURRENT (or chosen)
        # decision with the agent's option_hints applied. NO state mutation —
        # this only changes presentation, never the recorded picks.
        out: dict = {
            "action": "rehighlight",
            "reason": r.reason,
            "agent_reason": agent_reason,
            "state": st.to_dict(),
        }
        if r.category is not None:
            payload = _decision_payload(r.category, st.overrides)
            hints = None
            if isinstance(filled.get("answer"), dict):
                hints = filled["answer"].get("option_hints")
            if hints:
                _apply_option_hints(payload, hints)
            out["decision"] = payload
        else:
            # No chosen category — the server reuses the current TURN.decision and
            # applies option_hints in its relay layer. Pass the hints through.
            if isinstance(filled.get("answer"), dict):
                out["option_hints"] = filled["answer"].get("option_hints")
        _emit(out)

    elif r.action == "generate":
        # Chat generate (CB1, FORK A3): surface the agent-authored low-fi mockup
        # envelope (already structurally validated by validate_contract_answer →
        # validate_mockup). NO state mutation — accept is a separate explicit
        # user action (/api/chat/accept → accept-deltas). Revealed preference.
        _emit({
            "action": "generate",
            "reason": r.reason,
            "agent_reason": agent_reason,
            "mockup": r.mockup,
            "state": st.to_dict(),
        })

    else:
        # Unexpected — surface gracefully.
        _emit({"error": f"Unexpected action {r.action!r}", "state": st.to_dict()})


def cmd_present(args):
    """NON-MUTATING interactive step: surface the next decision + previews
    WITHOUT recording any pick. This is what the server's /api/step calls."""
    cat = cl.load_catalog()
    st = _load_state(args)
    r = decide_mod.present_next(st, cat)
    out = {"action": r.action, "reason": r.reason, "state": st.to_dict()}
    if r.action == "ask" and r.category is not None:
        out["decision"] = _decision_payload(r.category, st.overrides)
    _emit(out)


def cmd_step(args):
    """Headless/auto step: records the top option (used for tests / batch runs).
    The interactive server uses `present` instead so it never auto-records."""
    cat = cl.load_catalog()
    st = _load_state(args)
    r = decide_mod.auto_next_step(st, cat)
    out = {"action": r.action, "reason": r.reason, "state": st.to_dict()}
    if r.action == "ask" and r.category is not None:
        out["decision"] = _decision_payload(r.category, st.overrides)
    elif r.action == "infer" and r.inferred_category is not None:
        out["inferred"] = {"category_id": r.inferred_category.id, "title": r.inferred_category.title}
    _emit(out)


def cmd_contract(args):
    cat = cl.load_catalog()
    st = _load_state(args)
    _emit({"contract": contract_mod.build_decision_contract(st, cat)})


def cmd_pick(args):
    cat = cl.load_catalog()
    st = _load_state(args)
    projected = st.project_catalog(cat)
    category = projected.by_id().get(args.category)
    if category is None:
        _emit({"error": f"unknown or inapplicable category {args.category!r}"}); return
    opt = next((item for item in category.options if item.id == args.option), None)
    if opt is None:
        _emit({"error": f"option {args.option!r} does not belong to eligible category {args.category!r}"}); return
    st.apply_pick(args.category, args.option, opt.token_delta)
    _emit({"state": st.to_dict(), "picked": {"category": args.category, "option": args.option}})


def cmd_current(args):
    st = _load_state(args)
    _emit({"previews": schematic.render_all_platforms(st.overrides), "state": st.to_dict()})


def cmd_emit(args):
    cat = cl.load_catalog()
    st = _load_state(args)
    res = writer.write_design_md(
        args.name or st.context.get("description", "Product")[:40] or "Product",
        st, args.out, flatten=not args.no_flatten, version=args.version, catalog=cat,
    )
    _emit({"written": res})


def cmd_preview_md(args):
    cat = cl.load_catalog()
    st = _load_state(args)
    doc = design_md.build_design_doc(
        args.name or "Product", st, flatten=not args.no_flatten, version=args.version, catalog=cat,
    )
    _emit({"design_md": design_md.render_design_md(doc)})


def cmd_extract(args):
    """Extract design signals from a served app URL (or fail with a clear reason).

    --url  : run ibr_adapter.extract against the given URL.
    --repo : stub only — Phase 3 targets served URLs; no static analysis path.
    """
    cat = cl.load_catalog()
    if getattr(args, "url", None):
        result = ibr_adapter.extract(args.url)
    elif getattr(args, "repo", None):
        result = {
            "available": False,
            "reason": "no served URL — provide a running app URL",
            "signals": None,
            "warnings": [],
            "raw_url": None,
        }
    else:
        result = {
            "available": False,
            "reason": "provide --url or --repo",
            "signals": None,
            "warnings": [],
            "raw_url": None,
        }

    out: dict = {"extraction": result}
    if result.get("available") and result.get("signals"):
        out["contract"] = extract_contract_mod.build_extraction_contract(
            result["signals"], cat
        )
    _emit(out)


def cmd_extracted(args):
    """Return the list of extracted (source=='extract'|'import') picks with full decision payloads.

    --state <file>  : the taste-state JSON (bare or wrapped).

    Emits:
      {"extracted": [{<decision_payload>, "current_option_id": <seeded option_id>}, ...]}

    The ``current_option_id`` field marks the option that extraction/import seeded for that
    category so the review screen can highlight it.  If no extracted picks exist,
    emits {"extracted": []}.

    Each option also carries is_current/is_alternate flags from _mark_current_alternate,
    which uses st.baseline to identify the option whose token_delta matches what was imported.
    For import-driven baselines, this ensures the correct option (by token match, not just
    option_id) is flagged current.
    """
    cat = cl.load_catalog()
    st = _load_state(args)
    picks = st.extracted_picks()
    cat = st.project_catalog(cat)
    by_id = cat.by_id()
    result = []
    for pick in picks:
        cid = pick["category_id"]
        oid = pick["option_id"]
        category = by_id.get(cid)
        if category is None:
            continue
        payload = _decision_payload(category, st.overrides)
        # The authoritative "current" for a seeded (extract/import) decision is
        # the option actually recorded in history (`oid`) — it carries the
        # MEASURED value, which a catalog preset often won't equal. Pass it as
        # the primary current signal; baseline preset-match is the secondary
        # heuristic for decisions the baseline determines but that were not
        # explicitly seeded.
        _mark_current_alternate(payload, st.baseline, cat, seeded_option_id=oid)
        result.append(payload)
    _emit({"extracted": result})


def cmd_seed_apply(args):
    """Apply a filled extraction contract to a taste-state file.

    --state    <file>  : the taste-state JSON (bare or wrapped).
    --contract <file>  : the filled extraction contract JSON.
    --auto             : use auto_seed instead of apply_extraction.
                         Reads signals from the contract's "signals" key.
    --signals  <file>  : optional; overrides the signals source for --auto.
    """
    cat = cl.load_catalog()
    st = _load_state(args)
    cat = st.project_catalog(cat)

    if getattr(args, "auto", False):
        # Auto-seed: signals from --signals file, or from the contract's "signals" key.
        signals: dict = {}
        if getattr(args, "signals", None):
            import json as _json
            with open(args.signals, encoding="utf-8") as fh:
                signals = _json.load(fh)
        elif getattr(args, "contract", None):
            import json as _json
            with open(args.contract, encoding="utf-8") as fh:
                ctr = _json.load(fh)
            signals = ctr.get("signals") or {}
        summary = seed_mod.auto_seed(st, signals, cat)
    else:
        if not getattr(args, "contract", None):
            _emit({"error": "--contract is required unless --auto is set"})
            return
        ctr = extract_contract_mod.read_contract(args.contract)
        summary = seed_mod.apply_extraction(st, ctr, cat)

    _emit({"state": st.to_dict(), "summary": summary})


def _mark_current_alternate(
    payload: dict,
    baseline_overrides: dict,
    catalog,
    seeded_option_id: str | None = None,
) -> None:
    """Flag each option in *payload* as is_current / is_alternate and set exactly
    one payload["current_option_id"] for a decision the baseline determines.

    "Current" = what's actually in the imported/extracted system right now.
    Resolution order (first that fires wins, guarantees ≤1 current):

      1. ``seeded_option_id`` — the option recorded in history for this category.
         This is authoritative: it carries the MEASURED value (a real imported
         accent like #0A6CFF that no catalog preset equals), so an option whose
         preset differs is still the true current. Used for seeded decisions.
      2. Baseline preset-match — for a decision the baseline DETERMINES but that
         was not explicitly seeded: an option is current iff every (group,key) in
         its preset token_delta that also appears in baseline_overrides matches,
         and at least one overlaps. If exactly one option matches, it's current.

    If neither resolves a single current, all options are is_alternate and
    current_option_id is left unset (the baseline does not determine this
    decision — the UI surfaces alternates only, per spec).

    Mutates *payload* in-place; returns None.
    """
    options = payload.get("options", [])
    options_by_id = catalog.options_by_id()

    # --- Path 1: authoritative seeded option (the recorded pick). -------------
    if seeded_option_id is not None and any(
        o.get("id") == seeded_option_id for o in options
    ):
        for opt in options:
            is_curr = opt.get("id") == seeded_option_id
            opt["is_current"] = is_curr
            opt["is_alternate"] = not is_curr
        payload["current_option_id"] = seeded_option_id
        return

    # --- Path 2: baseline preset-match for non-seeded determined decisions. ---
    current_ids: list[str] = []
    for opt in options:
        oid = opt.get("id")
        opt_obj = options_by_id.get(oid)
        if opt_obj is None:
            opt["is_current"] = False
            opt["is_alternate"] = True
            continue

        delta = opt_obj.token_delta
        overlapping = False
        all_match = True
        for group, keys in delta.items():
            if not isinstance(keys, dict):
                continue
            for key, val in keys.items():
                base_group = baseline_overrides.get(group, {})
                if not isinstance(base_group, dict):
                    continue
                if key in base_group:
                    overlapping = True
                    if base_group[key] != val:
                        all_match = False

        is_curr = overlapping and all_match
        opt["is_current"] = is_curr
        opt["is_alternate"] = not is_curr
        if is_curr:
            current_ids.append(oid)

    # Only a UNIQUE preset-match counts as current (ambiguous ties → no current).
    if len(current_ids) == 1:
        payload["current_option_id"] = current_ids[0]
    else:
        for opt in options:
            opt["is_current"] = False
            opt["is_alternate"] = True
        payload.pop("current_option_id", None)


def cmd_accept_deltas(args):
    """CB1 accept path (FORK A3): apply a token_delta file to state.

    Validates the delta against the token vocabulary; drops unknown paths,
    applies valid subset via apply_pick with source='generate'.
    """
    st = _load_state(args)

    with open(args.deltas, encoding="utf-8") as fh:
        raw_deltas = json.load(fh)

    vr = validate_token_delta(raw_deltas)
    dropped: list[str] = []
    valid_delta: dict = {}

    if vr.ok:
        valid_delta = raw_deltas
    else:
        # Separate valid paths from invalid ones by walking the delta manually.
        from .schema import TOKEN_GROUPS, is_known_token
        for group, keys in raw_deltas.items():
            if group not in TOKEN_GROUPS:
                if isinstance(keys, dict):
                    for key in keys:
                        dropped.append(f"{group}.{key}")
                else:
                    dropped.append(group)
                continue
            if not isinstance(keys, dict):
                dropped.append(group)
                continue
            for key, val in keys.items():
                if is_known_token(group, key):
                    valid_delta.setdefault(group, {})[key] = val
                else:
                    dropped.append(f"{group}.{key}")

    label = args.label or "mockup"
    if valid_delta:
        st.apply_pick(
            category_id=f"generated:{label}",
            option_id=label,
            token_delta=valid_delta,
            source="generate",
        )

    warning: str | None = None
    if dropped:
        warning = f"dropped {len(dropped)} unknown token path(s): {dropped}"

    _emit({
        "state": st.to_dict(),
        "applied": valid_delta,
        "dropped": dropped,
        "warning": warning,
    })


def cmd_draft_save(args):
    """Save current state as a draft to .designer/drafts/<product>/."""
    st = _load_state(args)
    draft = draft_mod.make_draft(
        st.to_dict(),
        product=args.product,
        baseline_overrides=st.baseline,
        draft_id=args.draft_id or None,
        source=args.source or "draft",
    )
    res = draft_mod.save_draft(_plugin_root(), draft)
    _emit({
        "saved": res,
        "draft_id": draft["draft_id"],
        "has_delta": st.has_delta(),
    })


def cmd_draft_list(args):
    """List drafts, optionally filtered by product."""
    _emit({"drafts": draft_mod.list_drafts(_plugin_root(), getattr(args, "product", None))})


def cmd_draft_resume(args):
    """Resume an existing draft, restoring state and baseline exactly."""
    dr = draft_mod.load_draft(_plugin_root(), args.product, args.draft_id)
    if dr is None:
        _emit({"error": "draft not found"})
        return
    st = TasteState.from_dict(dr["state_snapshot"])
    # Ensure baseline is restored from the draft envelope.
    st.baseline = dr.get("baseline_overrides", st.baseline)
    _emit({
        "state": st.to_dict(),
        "draft": {
            "draft_id": dr.get("draft_id"),
            "product": dr.get("product"),
            "source": dr.get("source"),
            "created_at": dr.get("created_at"),
            "updated_at": dr.get("updated_at"),
        },
    })


def cmd_draft_promote(args):
    """Promote a state to a versioned DESIGN.md in the product repo."""
    cat = cl.load_catalog()
    st = _load_state(args)
    product_name = (
        getattr(args, "product", None)
        or st.context.get("description", "Product")[:40]
        or "Product"
    )
    draft_envelope = {
        "product": product_name,
        "state_snapshot": st.to_dict(),
        "baseline_overrides": st.baseline,
    }
    res = promote_mod.promote_draft(
        draft_envelope,
        args.out,
        name=getattr(args, "name", None),
        catalog=cat,
        version=getattr(args, "version", None),
    )
    _emit({"promoted": res})


def cmd_import_design(args):
    """Import an existing DESIGN.md into state (P3A entry point)."""
    cat = cl.load_catalog()
    st = _load_state(args)
    cat = st.project_catalog(cat)
    with open(args.file, encoding="utf-8") as fh:
        text = fh.read()
    res = import_design_mod.import_design(st, text, cat, source_path=args.file)
    # Record the imported baseline so delta_since works correctly.
    if "baseline_overrides" in res:
        st.baseline = res["baseline_overrides"]
    _emit({
        "state": st.to_dict(),
        "summary": res.get("summary"),
        "skipped": res.get("skipped"),
        "seeded": res.get("seeded"),
        # NO-SILENT-EMPTY: surface mapped count + format warning so the caller
        # (server/UI) can tell the user when nothing was recognized.
        "mapped": res.get("mapped", 0),
        "available": res.get("available", True),
        "warning": res.get("warning"),
        "doc_name": res.get("doc_name"),
        "doc_version": res.get("doc_version"),
    })


def cmd_decision_cva(args):
    """Return a decision payload for one category with CVA flags applied.

    Uses st.baseline as the baseline. Allows the UI to request current-vs-alternate
    framing for any decision during a baseline-driven walk.
    """
    cat = cl.load_catalog()
    st = _load_state(args)
    cat = st.project_catalog(cat)
    by_id = cat.by_id()
    category = by_id.get(args.category)
    if category is None:
        _emit({"error": f"unknown or inapplicable category {args.category!r}"})
        return
    payload = _decision_payload(category, st.overrides)
    # Derive the seeded option (the option last recorded in history for this
    # category, if any) so CVA flags the option actually in the system.
    seeded_oid = None
    for entry in st.history:
        if entry.get("category_id") == args.category:
            seeded_oid = entry.get("option_id")
    _mark_current_alternate(payload, st.baseline, cat, seeded_option_id=seeded_oid)
    _emit({"decision": payload})


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="designer-engine")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init"); s.add_argument("--context", default=""); s.set_defaults(fn=cmd_init)
    s = sub.add_parser("present"); s.add_argument("--state"); s.set_defaults(fn=cmd_present)
    s = sub.add_parser("step"); s.add_argument("--state"); s.set_defaults(fn=cmd_step)
    s = sub.add_parser("contract"); s.add_argument("--state"); s.set_defaults(fn=cmd_contract)
    s = sub.add_parser("pick"); s.add_argument("--state"); s.add_argument("--category", required=True); s.add_argument("--option", required=True); s.set_defaults(fn=cmd_pick)
    s = sub.add_parser("current"); s.add_argument("--state"); s.set_defaults(fn=cmd_current)
    s = sub.add_parser("emit"); s.add_argument("--state"); s.add_argument("--out", required=True); s.add_argument("--name"); s.add_argument("--version"); s.add_argument("--no-flatten", action="store_true"); s.set_defaults(fn=cmd_emit)
    s = sub.add_parser("preview-md"); s.add_argument("--state"); s.add_argument("--name"); s.add_argument("--version"); s.add_argument("--no-flatten", action="store_true"); s.set_defaults(fn=cmd_preview_md)

    s = sub.add_parser("extract")
    s.add_argument("--url", default=None)
    s.add_argument("--repo", default=None)
    s.set_defaults(fn=cmd_extract)

    s = sub.add_parser("extracted")
    s.add_argument("--state", default=None)
    s.set_defaults(fn=cmd_extracted)

    s = sub.add_parser("seed-apply")
    s.add_argument("--state", default=None)
    s.add_argument("--contract", default=None)
    s.add_argument("--signals", default=None)
    s.add_argument("--auto", action="store_true")
    s.set_defaults(fn=cmd_seed_apply)

    s = sub.add_parser("next-step")
    s.add_argument("--state", default=None)
    s.add_argument("--answer", default=None,
                   help="Path to a filled decision contract JSON file. "
                        "Omit to receive the contract (PENDING_HOST).")
    s.set_defaults(fn=cmd_next_step)

    s = sub.add_parser("accept-deltas")
    s.add_argument("--state", default=None)
    s.add_argument("--deltas", required=True, help="Path to a token_delta JSON file.")
    s.add_argument("--label", default=None, help="Label for the generated pick (default: mockup).")
    s.set_defaults(fn=cmd_accept_deltas)

    s = sub.add_parser("draft-save")
    s.add_argument("--state", default=None)
    s.add_argument("--product", required=True, help="Product name.")
    s.add_argument("--draft-id", default=None, dest="draft_id")
    s.add_argument("--source", default=None, help="Provenance: draft|import|extract.")
    s.set_defaults(fn=cmd_draft_save)

    s = sub.add_parser("draft-list")
    s.add_argument("--product", default=None)
    s.set_defaults(fn=cmd_draft_list)

    s = sub.add_parser("draft-resume")
    s.add_argument("--product", required=True)
    s.add_argument("--draft-id", required=True, dest="draft_id")
    s.set_defaults(fn=cmd_draft_resume)

    s = sub.add_parser("draft-promote")
    s.add_argument("--state", default=None)
    s.add_argument("--out", required=True, help="Output path or directory.")
    s.add_argument("--name", default=None)
    s.add_argument("--version", default=None)
    s.add_argument("--product", default=None)
    s.set_defaults(fn=cmd_draft_promote)

    s = sub.add_parser("import-design")
    s.add_argument("--state", default=None)
    s.add_argument("--file", required=True, help="Path to the DESIGN.md file to import.")
    s.set_defaults(fn=cmd_import_design)

    s = sub.add_parser("decision-cva")
    s.add_argument("--state", default=None)
    s.add_argument("--category", required=True, help="Category id for CVA framing.")
    s.set_defaults(fn=cmd_decision_cva)

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
