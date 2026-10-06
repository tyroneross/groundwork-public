#!/usr/bin/env python3
"""The typed contract behind a Groundwork decision surface.

A decision record is a document a person rules on. It carries three arrays that
hold ruleable things -- `axes` (a few large either/or choices), `openItems` (a
long queue of small ones) and `compares` (A = keep what exists vs B = the
proposal, answered Keep A / Approve B / Revise B / Neither) -- plus whatever else
the project that owns the record wants to keep in it. This module turns any of
them into ONE normalized `Ruleable`, so the surface renders a single list and
every future array is a column in the adapter table rather than a rewrite.

THE RULE THAT DECIDES EVERYTHING HERE: A LANE IS DERIVED, NEVER DECLARED.

Records carry a `status` field. It is prose written for a human, it drifts, and
it is wrong often enough that reading it is a defect. Measured on the record this
module was built against (2026-09-14, 25 items): 20 items had a status beginning
"open" while already carrying a ruling -- "open -- MERGE BLOCKER" on an item
ruled `own`, "open -- undecided, NOT ruled" on an item ruled `latest-useful`.
Any enum, any parse, any mapping table over those 15 distinct prose values
mislabels 20 of 25 items on real data the first time it runs.

So openness is computed from whether a ruling is PRESENT, and `status` is carried
through as display prose that nothing parses and this surface never writes. The
prose is worth keeping -- "MERGE BLOCKER" is a caveat no enum holds -- it just
does not get a vote.

`ruledAt` does not rule anything either. It is a stamp; an item can carry one
from a ruling that was later cleared.

WHY THE TWO ARRAYS ARE NOT MERGED ON DISK
A record must load in this surface unchanged, and the repositories that own these
records read `axes[].selected` directly from their own scripts. Normalizing on
disk would rewrite someone else's file to suit our renderer. So normalization is
a projection, in memory, and a write projects back to the field it came from.

    python3 -m designer.decisions.decision_record --selftest
    python3 -m designer.decisions.decision_record lanes <record.json>
"""
from __future__ import annotations

import json
import sys
from typing import Any

SCHEMA = "groundwork.decision-set/v1"

# The whole mapping, in one table. A new ruleable array is a column here.
#
#   normalized field -> {array name: that array's key}
#
# `chosen` and `freeText` are the two that a write projects back through, so
# they are the two that must never be guessed at a call site.
ADAPTER: dict[str, dict[str, str | None]] = {
    "title":    {"axes": "title",    "openItems": "question",   "compares": "question"},
    "prompt":   {"axes": "decision", "openItems": "question",   "compares": "question"},
    "why":      {"axes": "why",      "openItems": "why",        "compares": "why"},
    "chosen":   {"axes": "selected", "openItems": "ruling",     "compares": "ruling"},
    "freeText": {"axes": "note",     "openItems": "rulingText", "compares": "rulingText"},
    "ruledAt":  {"axes": "ruledAt",  "openItems": "ruledAt",    "compares": "ruledAt"},
    "status":   {"axes": None,       "openItems": "status",     "compares": "status"},
    "kind":     {"axes": None,       "openItems": "kind",       "compares": None},
    "target":   {"axes": None,       "openItems": "target",     "compares": "target"},
}

RULEABLE_ARRAYS = ("axes", "openItems", "compares")
_CHOICES_KEY: dict[str, str | None] = {"axes": "options", "openItems": "choices", "compares": None}

# ------------------------------------------------------------------ compares
#
# A compare is one A-vs-B question: option A is what exists now, option B is
# the proposal. Its four answers are FIXED by the surface rather than authored
# per item, because an export has to map them onto selection.json modes and a
# per-item choice list would make that mapping a guess. `other` is the open
# answer -- "neither; here is what I want instead" -- so a person who likes
# neither option is not forced to fake a revision of B.
COMPARE_CHOICES: tuple[dict[str, Any], ...] = (
    {"key": "keep-a",    "label": "Keep A",    "needsText": False},
    {"key": "approve-b", "label": "Approve B", "needsText": False},
    {"key": "revise-b",  "label": "Revise B",  "needsText": True},
    {"key": "other",     "label": "Neither",   "needsText": True},
)
COMPARE_RULINGS = tuple(c["key"] for c in COMPARE_CHOICES)
NOTE_REQUIRED = tuple(c["key"] for c in COMPARE_CHOICES if c["needsText"])
# groundwork.mockups.selection/v1 `mode` per ruling (references/mockups.md §5).
SELECTION_MODE = {"keep-a": "A", "approve-b": "B", "revise-b": "B-revise", "other": "other"}


def compare_note_error(ruling: Any, note: Any) -> str | None:
    """Why this ruling may not be recorded yet, or None when it may.

    Revise B and Neither mean nothing without the words: "revise" to what,
    "neither" so what instead. The browser refuses to commit either without a
    note, and `validate()` refuses a record that carries one anyway.
    """
    if ruling is None or (isinstance(ruling, str) and not ruling.strip()):
        return None
    if ruling not in COMPARE_RULINGS:
        return f"ruling must be one of {', '.join(COMPARE_RULINGS)}"
    if ruling in NOTE_REQUIRED and not (isinstance(note, str) and note.strip()):
        return ("say what to change in B" if ruling == "revise-b"
                else "say what you want instead")
    return None


def _side(v: Any) -> dict[str, Any]:
    """One option of a compare. A bare string is shorthand for its summary."""
    if isinstance(v, str):
        return {"summary": v, "visual": None, "mockup": None}
    if not isinstance(v, dict):
        return {"summary": "", "visual": None, "mockup": None}
    visual = v.get("visual")
    mockup = v.get("mockup")
    return {
        "summary": v["summary"] if isinstance(v.get("summary"), str) else "",
        "visual": visual if isinstance(visual, str) and visual.strip() else None,
        "mockup": mockup if isinstance(mockup, str) and mockup.strip() else None,
    }


def _compare(raw: dict[str, Any]) -> dict[str, Any]:
    # Strings only, as in decisions.js: anything else is absent, so the two
    # normalizers cannot stringify a malformed value differently.
    def s(x: Any) -> str | None:
        return x if isinstance(x, str) and x != "" else None

    so = raw.get("secondOpinion")
    second = None
    if isinstance(so, dict) and any(s(so.get(k)) for k in ("source", "verdict", "note")):
        second = {k: s(so.get(k)) for k in ("source", "verdict", "note")}
    return {
        "area": s(raw.get("area")),
        "headline": s(raw.get("headline")),
        "optionA": _side(raw.get("optionA")),
        "optionB": _side(raw.get("optionB")),
        "secondOpinion": second,
    }


# Fields the page computes at runtime to tell a person whether their work has
# reached the file. They describe a session, not the record, so a record that
# carries one is asserting a save state it cannot know. See verify_record.py.
TRANSIENT_FIELDS = ("savedToFile", "unsaved")


class Ruleable:
    """One thing a person can rule on, whichever array it came from."""

    __slots__ = ("source", "index", "id", "title", "prompt", "why", "choices",
                 "chosen", "free_text", "ruled_at", "status_prose", "kind",
                 "target", "preview", "compare", "raw")

    def __init__(self, source: str, index: int, raw: dict[str, Any]) -> None:
        self.source = source
        self.index = index
        self.raw = raw
        self.id = str(raw.get("id") or "")

        def via(field: str) -> Any:
            key = ADAPTER[field][source]
            return None if key is None else raw.get(key)

        self.title = via("title") or self.id
        self.prompt = via("prompt") or ""
        self.why = via("why") or ""
        # NOT `or None`. A ruling of `False` or `0` is a real answer to a yes/no
        # or a count, and `or None` would erase it here -- defeating _truthy one
        # line below and re-opening an item the person already settled. Caught by
        # the `it-false-ruling` case in --selftest.
        chosen = via("chosen")
        self.chosen = None if chosen is None else chosen
        self.free_text = via("freeText") or None
        self.ruled_at = via("ruledAt") or None
        self.status_prose = via("status") or None
        if source == "compares":
            self.kind = "compare"
        elif source == "openItems":
            self.kind = via("kind") or "axis"
        else:
            self.kind = "axis"
        self.target = via("target") or None
        self.preview = raw.get("preview") or None
        ck = _CHOICES_KEY[source]
        self.choices = ([_choice(c) for c in COMPARE_CHOICES] if ck is None else
                        [_choice(c) for c in (raw.get(ck) or []) if isinstance(c, dict)])
        self.compare = _compare(raw) if source == "compares" else None

    @property
    def lane(self) -> str:
        """DERIVED. `status` is not consulted -- see the module docstring.

        `addressed` is the one declared field that closes a lane, because it
        does not mean "ruled", it means "this no longer needs an answer" -- an
        axis the project settled elsewhere. It is a removal from the queue, not
        a ruling, so it cannot be inferred from `chosen`.
        """
        if self.raw.get("addressed"):
            return "ruled"
        return "ruled" if _truthy(self.chosen) else "open"

    def write_back(self, chosen: Any = None, free_text: Any = None,
                   ruled_at: str | None = None) -> dict[str, Any]:
        """The inverse projection: the patch to apply to this item's own array.

        Returns only the keys that belong to this item's source array, so a
        caller cannot write an `openItems` field onto an axis.
        """
        patch: dict[str, Any] = {}
        for field, value in (("chosen", chosen), ("freeText", free_text),
                             ("ruledAt", ruled_at)):
            if value is None:
                continue
            key = ADAPTER[field][self.source]
            if key is not None:
                patch[key] = value
        return patch

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source, "index": self.index, "id": self.id,
            "title": self.title, "prompt": self.prompt, "why": self.why,
            "choices": self.choices, "chosen": self.chosen,
            "freeText": self.free_text, "ruledAt": self.ruled_at,
            "status": self.status_prose, "kind": self.kind,
            "target": self.target, "preview": self.preview,
            "compare": self.compare, "lane": self.lane,
        }


def _truthy(v: Any) -> bool:
    """A ruling is present when it carries content.

    An empty string and an empty list are what a cleared ruling leaves behind,
    so neither counts. `False` and `0` are real answers to a yes/no or a count
    and must count -- which is why this is not a bare `bool(v)`.
    """
    if v is None:
        return False
    if isinstance(v, str):
        return v.strip() != ""
    if isinstance(v, (list, dict, tuple)):
        return len(v) > 0
    return True


def _choice(c: dict[str, Any]) -> dict[str, Any]:
    """Both arrays spell a choice differently; the surface renders one shape.

    `body`/`cost` (axes) and `note` (openItems) all mean "the quiet line under
    the label", so they collapse into `note`. `letter` is an axis affordance
    ("A.", "B.") that openItems has no equivalent for and so stays optional.
    """
    note = c.get("note") or c.get("body") or None
    return {
        "key": c.get("key"),
        "label": c.get("label") or str(c.get("key") or ""),
        "note": note,
        "cost": c.get("cost") or None,
        "letter": c.get("letter") or None,
        "needsText": bool(c.get("needsText")),
        "text": c.get("text") if "text" in c else None,
    }


def load(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def ruleables(record: dict[str, Any]) -> list[Ruleable]:
    """Every ruleable thing in the record, in the order the record lists them."""
    out: list[Ruleable] = []
    for source in RULEABLE_ARRAYS:
        for i, raw in enumerate(record.get(source) or []):
            if isinstance(raw, dict):
                out.append(Ruleable(source, i, raw))
    return out


def lanes(record: dict[str, Any]) -> dict[str, list[Ruleable]]:
    out: dict[str, list[Ruleable]] = {"open": [], "ruled": []}
    for r in ruleables(record):
        out[r.lane].append(r)
    return out


def comparison_sets(record: dict[str, Any]) -> list[list[Ruleable]]:
    """Group alternative proposals that share one area and current visual."""
    groups: dict[tuple[str, str, str], list[Ruleable]] = {}
    for item in ruleables(record):
        if item.source != "compares":
            continue
        current = item.compare["optionA"]
        key = ((item.compare["area"] or "", current["summary"] or "",
                current["visual"] or "") if current["summary"] or current["visual"]
               else ("item", item.id, ""))
        groups.setdefault(key, []).append(item)
    return list(groups.values())


def validate(record: dict[str, Any]) -> list[str]:
    """Human-readable errors. Empty list means the record may be rendered.

    Deliberately thin. This contract is OPEN: a record carries whatever else its
    project needs, and a schema that rejects unknown keys would reject the very
    documents it was written to render. Only the spine is checked -- what the
    surface must have in order to show anything at all and to write back safely.
    """
    e: list[str] = []
    schema = record.get("schema")
    if schema != SCHEMA:
        e.append(f"schema must be {SCHEMA!r}, got {schema!r}")
    if not str(record.get("id") or "").strip():
        e.append("id is required and must be non-empty")

    if not any(record.get(a) for a in RULEABLE_ARRAYS):
        e.append("record carries no ruleable items in " + " or ".join(RULEABLE_ARRAYS))

    for source in RULEABLE_ARRAYS:
        arr = record.get(source)
        if arr is None:
            continue
        if not isinstance(arr, list):
            e.append(f"{source} must be an array")
            continue
        seen: set[str] = set()
        for i, raw in enumerate(arr):
            if not isinstance(raw, dict):
                e.append(f"{source}[{i}] must be an object")
                continue
            rid = str(raw.get("id") or "")
            if not rid:
                # Without an id a ruling cannot be written back to the right
                # row, and a pin cannot say what it was pointing at.
                e.append(f"{source}[{i}] has no id")
            elif rid in seen:
                e.append(f"{source}[{i}].id {rid!r} is duplicated within {source}")
            seen.add(rid)
            if source == "compares":
                problem = compare_note_error(raw.get("ruling"), raw.get("rulingText"))
                if problem:
                    e.append(f"compares[{i}] ({rid or 'no id'}): {problem}")
    selections = record.get("groupSelections")
    if selections is not None:
        if not isinstance(selections, dict):
            e.append("groupSelections must be an object")
        else:
            groups = {group[0].id: group for group in comparison_sets(record)
                      if len(group) > 1}
            for group_id, selection in selections.items():
                group = groups.get(group_id)
                allowed = {"current", *(item.id for item in group)} if group else set()
                if not isinstance(selection, dict) or selection.get("selected") not in allowed:
                    e.append(f"groupSelections[{group_id!r}] selects no version in that group")
                elif not isinstance(selection.get("note", ""), str):
                    e.append(f"groupSelections[{group_id!r}].note must be text")
    statuses = record.get("implementationStatus")
    if statuses is not None:
        if not isinstance(statuses, dict):
            e.append("implementationStatus must be an object")
        else:
            groups = {group[0].id: group for group in comparison_sets(record)}
            for group_id, entry in statuses.items():
                prefix = f"implementationStatus[{group_id!r}]"
                group = groups.get(group_id)
                if group is None:
                    e.append(f"{prefix} names no comparison group")
                    continue
                if not isinstance(entry, dict):
                    e.append(f"{prefix} must be an object")
                    continue
                allowed = ({"current", *(item.id for item in group)} if len(group) > 1
                           else set(COMPARE_RULINGS))
                selected = entry.get("selected")
                if not isinstance(selected, str) or selected not in allowed:
                    e.append(f"{prefix}.selected names no choice in that group")
                stage = entry.get("stage")
                if not isinstance(stage, str) or stage not in {"pending", "in-progress", "complete"}:
                    e.append(f"{prefix}.stage must be pending, in-progress, or complete")
                if not isinstance(entry.get("proposal"), dict):
                    e.append(f"{prefix}.proposal must snapshot the selected option")
                if not isinstance(entry.get("decisionNote"), str):
                    e.append(f"{prefix}.decisionNote must snapshot the saved choice note")
                evidence = entry.get("evidence")
                valid = (isinstance(evidence, list) and all(
                    isinstance(item, dict) and isinstance(item.get("detail"), str)
                    and item["detail"].strip() and isinstance(item.get("kind"), str)
                    and item["kind"] in {"source", "verification"}
                    and isinstance(item.get("ref"), str) and item["ref"].strip()
                    and ("revision" not in item or isinstance(item["revision"], str))
                    for item in evidence))
                if not valid:
                    e.append(f"{prefix}.evidence must be an array of source or verification details with refs")
                elif isinstance(stage, str) and stage in {"in-progress", "complete"} and not evidence:
                    e.append(f"{prefix}.{stage} requires evidence")
                elif stage == "complete" and not any(
                    item["kind"] == "verification" and isinstance(item.get("revision"), str)
                    and item["revision"].strip() for item in evidence):
                    e.append(f"{prefix}.complete requires verification evidence with revision")
    return e


def fingerprint(record: dict[str, Any]) -> dict[str, Any]:
    """A CONTENT-FREE structural summary of a record.

    This exists so a real project record can act as a conformance fixture
    without its contents entering this repository. Real records hold unshipped
    strategy and quoted private conversation; Groundwork ships publicly. So the
    committed artifact is shape only -- key names, types, counts -- and never a
    value a person wrote.

    The one number that is a count of values rather than a value is
    `distinctStatusCount`, which is the point: it is the evidence that `status`
    is unbounded prose and cannot be an enum.
    """
    fp: dict[str, Any] = {
        "schema": record.get("schema"),
        "topLevelKeys": sorted(k for k in record if isinstance(k, str)),
        "arrays": {},
    }
    for source in RULEABLE_ARRAYS:
        if source == "compares" and "compares" not in record:
            continue  # absent, not empty: keeps fingerprints of older records stable
        arr = record.get(source) or []
        rs = [Ruleable(source, i, r) for i, r in enumerate(arr) if isinstance(r, dict)]
        statuses = {str(r.status_prose) for r in rs if r.status_prose}
        fp["arrays"][source] = {
            "count": len(rs),
            "open": sum(1 for r in rs if r.lane == "open"),
            "ruled": sum(1 for r in rs if r.lane == "ruled"),
            "distinctStatusCount": len(statuses),
            "statusSaysOpenButRuled": sum(
                1 for r in rs
                if r.lane == "ruled" and str(r.status_prose or "").strip().lower().startswith("open")
            ),
            "fieldNames": sorted({k for r in rs for k in r.raw}),
            "kinds": sorted({r.kind for r in rs if r.kind}),
            "choiceCounts": sorted({len(r.choices) for r in rs}),
        }
    return fp


def to_selection(record: dict[str, Any], slug: str | None = None,
                 selected_at: str | None = None) -> dict[str, Any]:
    """Project a record's ruled compares into groundwork.mockups.selection/v1.

    This is the bridge from "compare decisions" back into the mockup flow
    (references/mockups.md section 5): each ruled compare becomes one
    `perScreen` row keyed by its id, with the ruling mapped through
    SELECTION_MODE. Unruled compares are left out rather than guessed at, and
    counted in `unanswered` so the caller can say so.

    `html_path` is emitted only when the chosen option names a `mockup` -- a
    path relative to the design's `mockups/` directory, which is what the
    engine resolves it against. A compare's `visual` lives in this surface's
    own `visuals/` directory and is deliberately NOT promoted to html_path:
    the engine would look for it in the wrong place and fail the packet.
    """
    per_screen: list[dict[str, Any]] = []
    counts = {m: 0 for m in SELECTION_MODE.values()}
    unanswered = 0
    selections = record.get("groupSelections") or {}
    for group in comparison_sets(record):
        if len(group) > 1:
            selected = selections.get(group[0].id) or {}
            selected_id = selected.get("selected")
            if selected_id not in {"current", *(item.id for item in group)}:
                unanswered += 1
                continue
            winner = group[0] if selected_id == "current" else next(
                item for item in group if item.id == selected_id)
            mode = "A" if selected_id == "current" else "B"
            note = selected.get("note") or ""
            screen_id = group[0].id
        else:
            winner = group[0]
            if winner.lane != "ruled" or winner.chosen not in SELECTION_MODE:
                unanswered += 1
                continue
            mode = SELECTION_MODE[winner.chosen]
            note = winner.free_text or ""
            screen_id = winner.id
        counts[mode] += 1
        side = winner.compare["optionA" if mode == "A" else "optionB"]
        row: dict[str, Any] = {"screen_id": screen_id, "mode": mode}
        if mode != "other" and side.get("mockup"):
            row["html_path"] = side["mockup"]
        row["note"] = note
        per_screen.append(row)

    # Most-chosen mode; a tie goes to the proposal (B before B-revise, A, other)
    # so the result never depends on dict order.
    order = {"B": 0, "B-revise": 1, "A": 2, "other": 3}
    ranked = sorted(((n, m) for m, n in counts.items() if n), key=lambda p: (-p[0], order[p[1]]))
    primary = ranked[0][1] if ranked else None
    answered = len(per_screen)
    split = ", ".join(f"{n} {m}" for n, m in ranked) or "none"
    return {
        "schema": "groundwork.mockups.selection/v1",
        "slug": slug or str(record.get("id") or ""),
        "selectedAt": selected_at,
        # primaryMode seeds the Designer walk with a design-mode id (mockups.md §5).
        # A/B compare answers are not mode ids, so leave it null and report the
        # most-chosen answer separately.
        "primaryMode": None,
        "dominantChoice": primary,
        "source": {"board": str(record.get("id") or ""),
                   "builder": "designer.decisions.decisions_build export --format selection"},
        "perScreen": per_screen,
        "unanswered": unanswered,
        "rationale": (f"{answered} of {answered + unanswered} compare decisions answered "
                      f"({split}). Notes carry what to change or what to do instead."),
    }


# --------------------------------------------------------------------- selftest

_SYNTHETIC = {
    "schema": SCHEMA,
    "id": "selftest",
    "unknownProjectKey": {"kept": True},
    "axes": [
        {"id": "ax-open", "title": "An unruled axis", "decision": "Pick one.",
         "options": [{"key": "a", "letter": "A", "label": "First", "body": "why a",
                      "cost": "costs a"},
                     {"key": "b", "letter": "B", "label": "Second"}]},
        {"id": "ax-ruled", "title": "A ruled axis", "decision": "Pick one.",
         "selected": "a", "note": "because",
         "options": [{"key": "a", "label": "First"}, {"key": "b", "label": "Second"}]},
        {"id": "ax-addressed", "title": "Settled elsewhere", "decision": "n/a",
         "addressed": True,
         "options": [{"key": "a", "label": "First"}, {"key": "b", "label": "Second"}]},
    ],
    "openItems": [
        {"id": "it-open", "kind": "copy", "question": "Which wording?",
         "status": "open -- needs your answer",
         "choices": [{"key": "no", "label": "Leave it"},
                     {"key": "own", "label": "Write my own", "needsText": True}]},
        # The case that decides the contract: prose says open, a ruling exists.
        {"id": "it-stale-status", "kind": "decision", "question": "Ship it?",
         "status": "open -- MERGE BLOCKER", "ruling": "own",
         "rulingText": "his words", "ruledAt": "2026-09-14T00:21:37.745Z",
         "target": {"surface": "Homepage", "section": "hero"},
         "choices": [{"key": "yes", "label": "Ship"},
                     {"key": "own", "label": "Write my own", "needsText": True}]},
        {"id": "it-false-ruling", "kind": "decision", "question": "Keep the banner?",
         "status": "open", "ruling": False,
         "choices": [{"key": "yes", "label": "Keep"}, {"key": "no", "label": "Remove"}]},
        {"id": "it-cleared", "kind": "copy", "question": "Cleared ruling",
         "status": "ruled", "ruling": "   ",
         "choices": [{"key": "a", "label": "A"}, {"key": "b", "label": "B"}]},
    ],
    "compares": [
        {"id": "cmp-open", "area": "Home", "question": "Which header?",
         "why": "The header is the first thing read.",
         "optionA": {"summary": "Current header", "visual": "a.png"},
         "optionB": {"summary": "Shorter header", "visual": "b.html", "mockup": "home-b.html"},
         "secondOpinion": {"source": "Panel", "verdict": "approve-b"}},
        {"id": "cmp-revise", "question": "Which footer?", "optionA": "Now",
         "optionB": {"summary": "Proposed", "mockup": "footer-b.html"},
         "ruling": "revise-b", "rulingText": "tighter spacing"},
        {"id": "cmp-other", "question": "Which nav?", "ruling": "other",
         "rulingText": "a third layout"},
    ],
}


def _selftest() -> int:
    fails: list[str] = []

    def ck(name: str, cond: bool, detail: str = "") -> None:
        print(f"  [{'ok ' if cond else 'FAIL'}] {name}" + (f" -- {detail}" if detail and not cond else ""))
        if not cond:
            fails.append(name)

    print("decision_record --selftest")
    rec = json.loads(json.dumps(_SYNTHETIC))

    ck("valid synthetic record passes validate()", validate(rec) == [], str(validate(rec)))

    by = {r.id: r for r in ruleables(rec)}
    ck("all three arrays normalize into one list", len(by) == 10, f"got {len(by)}")

    # The rule the whole module exists for.
    ck("prose status 'open' does NOT open a ruled item",
       by["it-stale-status"].lane == "ruled", by["it-stale-status"].lane)
    ck("unruled item is open", by["it-open"].lane == "open")
    ck("unruled axis is open", by["ax-open"].lane == "open")
    ck("ruled axis is ruled", by["ax-ruled"].lane == "ruled")
    ck("addressed axis leaves the open lane", by["ax-addressed"].lane == "ruled")
    ck("ruling False is a real answer, not an absence",
       by["it-false-ruling"].lane == "ruled", by["it-false-ruling"].lane)
    ck("whitespace-only ruling does not rule",
       by["it-cleared"].lane == "open", by["it-cleared"].lane)
    ck("ruledAt alone does not rule",
       Ruleable("openItems", 0, {"id": "x", "ruledAt": "2026-01-01T00:00:00Z"}).lane == "open")

    # Adapter both ways.
    ck("axis title/prompt read through the adapter",
       by["ax-ruled"].title == "A ruled axis" and by["ax-ruled"].prompt == "Pick one.")
    ck("item title falls back to question", by["it-open"].title == "Which wording?")
    ck("axis freeText reads `note`", by["ax-ruled"].free_text == "because")
    ck("item freeText reads `rulingText`", by["it-stale-status"].free_text == "his words")
    ck("axis writes back to `selected`/`note`",
       by["ax-open"].write_back(chosen="b", free_text="n") == {"selected": "b", "note": "n"})
    ck("item writes back to `ruling`/`rulingText`",
       by["it-open"].write_back(chosen="own", free_text="t") == {"ruling": "own", "rulingText": "t"})
    ck("write_back cannot leak a field across arrays",
       "ruling" not in by["ax-open"].write_back(chosen="b")
       and "selected" not in by["it-open"].write_back(chosen="own"))

    # Choice shape.
    a = by["ax-open"].choices[0]
    ck("axis body collapses into note", a["note"] == "why a")
    ck("axis cost survives", a["cost"] == "costs a")
    ck("axis letter survives", a["letter"] == "A")
    ck("needsText carries", by["it-open"].choices[1]["needsText"] is True)

    # Openness of the contract.
    ck("unknown top-level keys are not rejected", "unknownProjectKey" in rec)
    bad = validate({"schema": SCHEMA, "id": "x", "axes": [{"title": "no id"}]})
    ck("a ruleable without an id is rejected", any("has no id" in m for m in bad), str(bad))
    dup = validate({"schema": SCHEMA, "id": "x",
                    "openItems": [{"id": "same"}, {"id": "same"}]})
    ck("duplicate ids within an array are rejected", any("duplicated" in m for m in dup), str(dup))
    ck("wrong schema is rejected",
       any("schema must be" in m for m in validate({"schema": "other/v9", "id": "x",
                                                    "axes": [{"id": "a"}]})))
    ck("an empty record is rejected",
       any("no ruleable items" in m for m in validate({"schema": SCHEMA, "id": "x"})))

    # Compares.
    c = by["cmp-open"]
    ck("compare is open until ruled", c.lane == "open")
    ck("compare kind is fixed", c.kind == "compare")
    ck("compare carries the four fixed choices",
       [x["key"] for x in c.choices] == list(COMPARE_RULINGS))
    ck("compare title reads `question`", c.title == "Which header?")
    ck("bare-string option is its summary",
       by["cmp-revise"].compare["optionA"] == {"summary": "Now", "visual": None, "mockup": None})
    ck("compare writes back to `ruling`/`rulingText`",
       c.write_back(chosen="other", free_text="x") == {"ruling": "other", "rulingText": "x"})
    ck("revise-b without a note is refused",
       compare_note_error("revise-b", "  ") is not None)
    ck("other without a note is refused", compare_note_error("other", None) is not None)
    ck("keep-a needs no note", compare_note_error("keep-a", None) is None)
    ck("an unknown compare ruling is refused", compare_note_error("maybe", "x") is not None)
    bad_c = validate({"schema": SCHEMA, "id": "x",
                      "compares": [{"id": "c", "ruling": "revise-b"}]})
    ck("validate() refuses a noteless revise-b", any("compares[0]" in m for m in bad_c), str(bad_c))
    sel = to_selection(rec, selected_at="2026-01-01T00:00:00Z")
    ck("export maps revise-b -> B-revise and other -> other",
       [(p["screen_id"], p["mode"]) for p in sel["perScreen"]]
       == [("cmp-revise", "B-revise"), ("cmp-other", "other")], str(sel["perScreen"]))
    ck("export carries html_path only from a named mockup",
       sel["perScreen"][0].get("html_path") == "footer-b.html"
       and "html_path" not in sel["perScreen"][1])
    ck("export counts the unanswered", sel["unanswered"] == 1)

    # Fingerprint is structure, never content.
    fp = fingerprint(rec)
    blob = json.dumps(fp)
    # Two, not one: `it-stale-status` (status "open -- MERGE BLOCKER", ruled
    # `own`) and `it-false-ruling` (status "open", ruled `False`). The second
    # only counts once `chosen` stops coercing False to None, so this number
    # also guards that fix.
    ck("fingerprint counts the stale-status contradiction",
       fp["arrays"]["openItems"]["statusSaysOpenButRuled"] == 2,
       str(fp["arrays"]["openItems"]["statusSaysOpenButRuled"]))
    ck("fingerprint carries no authored prose",
       "MERGE BLOCKER" not in blob and "his words" not in blob and "because" not in blob)
    ck("fingerprint lane counts match derivation",
       fp["arrays"]["openItems"]["open"] == 2 and fp["arrays"]["axes"]["open"] == 1,
       blob[:200])

    print(f"\n{'PASSED' if not fails else 'FAILED: ' + ', '.join(fails)}")
    return 1 if fails else 0


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] == "--selftest":
        return _selftest()
    if args[0] == "lanes" and len(args) > 1:
        rec = load(args[1])
        errs = validate(rec)
        if errs:
            print("invalid record:\n  - " + "\n  - ".join(errs), file=sys.stderr)
            return 2
        ln = lanes(rec)
        print(f"open: {len(ln['open'])}   ruled: {len(ln['ruled'])}")
        for r in ln["open"]:
            print(f"  open   {r.source}[{r.index}] {r.id}")
        return 0
    if args[0] == "fingerprint" and len(args) > 1:
        print(json.dumps(fingerprint(load(args[1])), indent=2, sort_keys=True))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
