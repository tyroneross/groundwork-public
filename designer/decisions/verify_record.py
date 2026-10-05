#!/usr/bin/env python3
"""Cleanup-and-invariant checker for a Groundwork decision record.

This exists because of a real failure: a closing report asserted
"annotations: 0" while a real user annotation was sitting in the file. The
assertion was a bare COUNT, and the cleanup before it was a blind
`annotations = []`. Either alone destroys substantive human feedback.

THE GOVERNING RULE: classify every item individually; delete ONLY what
matches a known test signature; REFUSE to touch anything unrecognised and
report it instead. A count is never the verdict -- the per-item verdict is.

Three invariants, each independently reported and independently testable:

1. Per-item classification, never a count. `classify(item)` returns
   ("TEST"|"USER", reason). An item is TEST only when it matches a known
   signature (see TEST_ID_PREFIXES / TEST_PROBE_MARKERS below). Everything
   else is USER and is never removed. The same probe-marker vocabulary is
   also swept across authored free text that lives outside the three item
   arrays -- `axes[].note` / `openItems[].rulingText` (via
   `decision_record.ruleables()`) and every string value in the `copy`
   dict -- because a probe left in a note is a real escape that a check
   looking only at `previewComments`/`annotations` misses. Those escapes
   cannot be auto-purged (there is no sane way to delete "an axis"), so
   they are reported as a violation that blocks `--purge` until a human
   looks at it.
2. Transient-field invariant. No persisted item in `previewComments`,
   `annotations`, or `history` may carry `decision_record.TRANSIENT_FIELDS`
   (`savedToFile`, `unsaved`). Those describe a browser session, not the
   record.
3. id-coherence invariant. No id may appear both live
   (`previewComments`/`annotations`) and archived (`history`). Archiving
   MOVES an item; it never copies.

    python3 -m designer.decisions.verify_record <record.json>
    python3 -m designer.decisions.verify_record <record.json> --purge
    python3 -m designer.decisions.verify_record --selftest

Exit 0 when clean, 1 when an invariant is violated (or a purge was
refused), 2 on a usage/IO error.
"""
from __future__ import annotations

import copy as copy_module
import json
import os
import sys
import tempfile
from typing import Any

from designer.decisions import decision_record

ITEM_ARRAYS = ("previewComments", "annotations", "history")
LIVE_ARRAYS = ("previewComments", "annotations")
ARCHIVE_ARRAY = "history"

# Project-specific vocabulary. A project embedding this checker overrides
# these module attributes (e.g. `verify_record.TEST_ID_PREFIXES = (...)`)
# before calling `classify`/`build_report` -- they are read fresh on every
# call, never captured at import time.
TEST_ID_PREFIXES: tuple[str, ...] = ("test-", "e2e-", "probe-", "synthetic-", "auto-")
TEST_PROBE_MARKERS: tuple[str, ...] = (
    "[e2e-probe]",
    "e2e probe",
    "automated test",
    "playwright probe",
    "synthetic-probe",
    "__test_marker__",
)

# Fields on a `previewComments`/`annotations`/`history` item that carry a
# human-authored comment, and the field that records what DOM element an
# annotation was anchored to. A human annotation carries at least one of
# these; an automated click that only records coordinates carries neither.
NOTE_KEYS = ("note", "text", "comment", "body")
#
# `selector` counts. The surface's own reference view treats it as the anchor,
# and a pin saved the moment it is dropped carries `{id, selector}` with the
# note still empty because the person has not typed it yet. Leaving `selector`
# out classified that pin as an automated click and `--purge` deleted it --
# destroying exactly the substantive feedback this file exists to protect.
# Caught in independent audit; see test_verify_record.py.
ANCHOR_KEYS = ("elementText", "anchorText", "targetText", "selector",
               "elementSelector", "cssPath")


def _nonempty(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value
    return None


def _first_text(item: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for k in keys:
        v = _nonempty(item.get(k))
        if v is not None:
            return v
    return None


def _matches_probe(text: str | None) -> str | None:
    """The first configured probe marker found in `text`, else None."""
    if not text:
        return None
    lowered = text.lower()
    for marker in TEST_PROBE_MARKERS:
        if marker.lower() in lowered:
            return marker
    return None


def classify(item: Any) -> tuple[str, str]:
    """Classify one item as TEST or USER. Never a count -- a per-item verdict.

    TEST only when: the id starts with a configured test-id prefix, OR a
    configured probe marker appears in its note/text, OR it has an empty
    note AND no anchored element text (the signature an automated click
    leaves behind). Everything else -- including anything this function
    does not recognise -- is USER.
    """
    if not isinstance(item, dict):
        return "USER", "not an object -- kept, unrecognised"

    item_id = str(item.get("id") or "")
    for prefix in TEST_ID_PREFIXES:
        if item_id and item_id.startswith(prefix):
            return "TEST", f"id {item_id!r} starts with test prefix {prefix!r}"

    note = _first_text(item, NOTE_KEYS)
    marker = _matches_probe(note)
    if marker:
        return "TEST", f"probe marker {marker!r} found in note/text"

    anchor = _first_text(item, ANCHOR_KEYS)
    if note is None and anchor is None:
        return "TEST", "empty note and nothing recording what it pointed at"

    return "USER", "no test signature matched"


def find_transient_violations(record: dict[str, Any]) -> list[tuple[str, int, str, str]]:
    """(source, index, id, field) for every persisted item carrying a
    runtime-only field from `decision_record.TRANSIENT_FIELDS`."""
    violations: list[tuple[str, int, str, str]] = []
    for source in ITEM_ARRAYS:
        for i, item in enumerate(record.get(source) or []):
            if not isinstance(item, dict):
                continue
            for field in decision_record.TRANSIENT_FIELDS:
                if field in item:
                    violations.append((source, i, str(item.get("id") or ""), field))
    return violations


def find_id_coherence_violations(record: dict[str, Any]) -> list[str]:
    """ids that appear in both a live array and `history`. Archiving MOVES
    an item; finding it in both places means one copy is a ghost."""
    live_ids: set[str] = set()
    for source in LIVE_ARRAYS:
        for item in record.get(source) or []:
            if isinstance(item, dict):
                iid = str(item.get("id") or "")
                if iid:
                    live_ids.add(iid)
    archived_ids: set[str] = set()
    for item in record.get(ARCHIVE_ARRAY) or []:
        if isinstance(item, dict):
            iid = str(item.get("id") or "")
            if iid:
                archived_ids.add(iid)
    return sorted(live_ids & archived_ids)


def find_probe_leaks(record: dict[str, Any]) -> list[tuple[str, str]]:
    """(location, marker) for every probe marker that escaped into authored
    free text OUTSIDE the three item arrays: `axes[].note`,
    `openItems[].rulingText`, `compares[].rulingText`, and any string value
    in `copy`.

    These are never purged -- there is no sane action to delete "an axis"
    or a UI copy string -- they are reported so a human notices the
    contamination, and they block `--purge` on the item arrays until it is
    resolved (see build_report/`clean`).
    """
    leaks: list[tuple[str, str]] = []
    for r in decision_record.ruleables(record):
        marker = _matches_probe(_nonempty(r.free_text))
        if marker:
            field_name = decision_record.ADAPTER["freeText"][r.source]
            leaks.append((f"{r.source}[{r.index}].{field_name}", marker))

    copy_dict = record.get("copy")
    if isinstance(copy_dict, dict):
        for key, value in copy_dict.items():
            if isinstance(value, str):
                marker = _matches_probe(value)
                if marker:
                    leaks.append((f"copy.{key}", marker))
    return leaks


def build_report(record: dict[str, Any]) -> dict[str, Any]:
    """Everything this tool knows about `record`. `clean` is the ONLY
    gate `--purge` consults before writing."""
    item_verdicts: list[dict[str, Any]] = []
    for source in ITEM_ARRAYS:
        for i, item in enumerate(record.get(source) or []):
            verdict, reason = classify(item)
            item_verdicts.append({
                "source": source,
                "index": i,
                "id": str(item.get("id") or "") if isinstance(item, dict) else "",
                "verdict": verdict,
                "reason": reason,
            })

    transient = find_transient_violations(record)
    coherence = find_id_coherence_violations(record)
    leaks = find_probe_leaks(record)

    return {
        "item_verdicts": item_verdicts,
        "transient_violations": transient,
        "id_coherence_violations": coherence,
        "probe_leaks": leaks,
        # Presence of TEST-classified items is NOT a violation -- that is
        # the expected pre-purge state. Only invariants 2 and 3, plus a
        # probe marker escaped somewhere purge cannot reach, make a record
        # unclean.
        "clean": not transient and not coherence and not leaks,
    }


def print_report(rep: dict[str, Any]) -> None:
    for v in rep["item_verdicts"]:
        print(f"  [{v['verdict']:4}] {v['source']}[{v['index']}] id={v['id']!r} -- {v['reason']}")

    if rep["transient_violations"]:
        print("TRANSIENT FIELD VIOLATIONS (invariant 2):")
        for source, i, iid, field in rep["transient_violations"]:
            print(f"  {source}[{i}] id={iid!r} carries transient field {field!r}")

    if rep["id_coherence_violations"]:
        print("ID-COHERENCE VIOLATIONS -- present both live and archived (invariant 3):")
        for iid in rep["id_coherence_violations"]:
            print(f"  id={iid!r}")

    if rep["probe_leaks"]:
        print("PROBE MARKER LEAKS -- authored free text, never auto-purged (invariant 1):")
        for loc, marker in rep["probe_leaks"]:
            print(f"  {loc} contains marker {marker!r}")

    print("CLEAN" if rep["clean"] else "ISSUES FOUND")


def purge(record: dict[str, Any], rep: dict[str, Any]) -> dict[str, Any]:
    """A deep copy of `record` with every TEST-classified item removed
    from `previewComments`/`annotations`/`history`. Caller must have
    already confirmed `rep["clean"]` is True."""
    new_record = copy_module.deepcopy(record)
    to_remove: dict[str, set[int]] = {}
    for v in rep["item_verdicts"]:
        if v["verdict"] == "TEST":
            to_remove.setdefault(v["source"], set()).add(v["index"])
    for source, idxs in to_remove.items():
        arr = new_record.get(source) or []
        new_record[source] = [item for i, item in enumerate(arr) if i not in idxs]
    return new_record


def atomic_write(path: str, data: dict[str, Any]) -> None:
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".verify_record_", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)
    except BaseException:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


# --------------------------------------------------------------------- selftest

def _selftest() -> int:
    fails: list[str] = []

    def ck(name: str, cond: bool, detail: str = "") -> None:
        print(f"  [{'ok ' if cond else 'FAIL'}] {name}" + (f" -- {detail}" if detail and not cond else ""))
        if not cond:
            fails.append(name)

    print("verify_record --selftest")

    clean_record = {
        "schema": decision_record.SCHEMA,
        "id": "selftest-clean",
        "axes": [{"id": "ax-1", "note": "a real reason",
                  "options": [{"key": "a", "label": "A"}]}],
        "openItems": [{"id": "it-1", "rulingText": "a real ruling",
                       "choices": [{"key": "a", "label": "A"}]}],
        "copy": {"heading": "Welcome"},
        "previewComments": [{"id": "pc-user-1", "note": "This button looks off-center to me."}],
        "annotations": [{"id": "an-user-1", "elementText": "Submit"}],
        "history": [{"id": "an-archived-1", "note": "archived note"}],
    }

    rep = build_report(clean_record)
    ck("clean record has no violations", rep["clean"] is True, str(rep))
    ck("real user annotation classified USER",
       next(v for v in rep["item_verdicts"] if v["id"] == "pc-user-1")["verdict"] == "USER")

    test_id_record = json.loads(json.dumps(clean_record))
    test_id_record["previewComments"].append({"id": "test-auto-1", "note": "whatever"})
    rep2 = build_report(test_id_record)
    v2 = next(v for v in rep2["item_verdicts"] if v["id"] == "test-auto-1")
    ck("test-prefixed id classified TEST", v2["verdict"] == "TEST", str(v2))
    ck("a TEST item alone does not make the record unclean", rep2["clean"] is True)

    probe_record = json.loads(json.dumps(clean_record))
    probe_record["annotations"].append({"id": "an-2", "note": "[e2e-probe] click check"})
    rep3 = build_report(probe_record)
    v3 = next(v for v in rep3["item_verdicts"] if v["id"] == "an-2")
    ck("probe marker in note classified TEST", v3["verdict"] == "TEST", str(v3))

    empty_record = json.loads(json.dumps(clean_record))
    empty_record["history"].append({"id": "auto-click-1"})
    rep4 = build_report(empty_record)
    v4 = next(v for v in rep4["item_verdicts"] if v["id"] == "auto-click-1")
    ck("empty note + no anchor classified TEST", v4["verdict"] == "TEST", str(v4))

    transient_record = json.loads(json.dumps(clean_record))
    transient_record["previewComments"][0]["savedToFile"] = True
    rep5 = build_report(transient_record)
    ck("transient field detected", len(rep5["transient_violations"]) == 1, str(rep5["transient_violations"]))
    ck("transient violation makes record unclean", rep5["clean"] is False)

    coherence_record = json.loads(json.dumps(clean_record))
    coherence_record["history"].append({"id": "pc-user-1", "note": "ghost"})
    rep6 = build_report(coherence_record)
    ck("id-coherence violation detected", rep6["id_coherence_violations"] == ["pc-user-1"],
       str(rep6["id_coherence_violations"]))
    ck("id-coherence violation makes record unclean", rep6["clean"] is False)

    axes_leak_record = json.loads(json.dumps(clean_record))
    axes_leak_record["axes"][0]["note"] = "leftover [e2e-probe] text"
    rep7 = build_report(axes_leak_record)
    ck("probe leak in axes[].note found", any(loc == "axes[0].note" for loc, _ in rep7["probe_leaks"]),
       str(rep7["probe_leaks"]))
    ck("probe leak in axes[].note makes record unclean", rep7["clean"] is False)

    copy_leak_record = json.loads(json.dumps(clean_record))
    copy_leak_record["copy"]["heading"] = "[e2e-probe] Welcome"
    rep8 = build_report(copy_leak_record)
    ck("probe leak in copy value found", any(loc == "copy.heading" for loc, _ in rep8["probe_leaks"]),
       str(rep8["probe_leaks"]))

    purged = purge(test_id_record, rep2)
    ck("purge removes test item", all(i["id"] != "test-auto-1" for i in purged["previewComments"]))
    ck("purge keeps real user annotation", any(i["id"] == "pc-user-1" for i in purged["previewComments"]))

    print(f"\n{'PASSED' if not fails else 'FAILED: ' + ', '.join(fails)}")
    return 1 if fails else 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv

    if argv and argv[0] == "--selftest":
        return _selftest()

    if not argv:
        print(__doc__)
        return 2

    path = argv[0]
    do_purge = "--purge" in argv[1:]

    try:
        record = decision_record.load(path)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
        return 2

    if not isinstance(record, dict):
        print(f"error: {path} does not contain a JSON object", file=sys.stderr)
        return 2

    rep = build_report(record)
    print_report(rep)

    if do_purge:
        if not rep["clean"]:
            print("refusing to purge -- record has unresolved invariant violations", file=sys.stderr)
            return 1
        removed = sum(1 for v in rep["item_verdicts"] if v["verdict"] == "TEST")
        if removed == 0:
            print("nothing to purge -- record already clean of test items")
            return 0
        new_record = purge(record, rep)
        atomic_write(path, new_record)
        print(f"purged {removed} test item(s); wrote {path}")
        return 0

    return 0 if rep["clean"] else 1


if __name__ == "__main__":
    sys.exit(main())
