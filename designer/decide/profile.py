#!/usr/bin/env python3
# ───────────────────────────────────────────────────────────────────────
# Groundwork — cross-session taste PROFILE (decision pipeline layer 6)
#
# WHAT: remembers a person's revealed design preferences ACROSS Groundwork runs
#       so each new product needs fewer questions than the last (the pipeline's
#       compounding layer). A dimension the profile already knows starts the
#       next session with LOW uncertainty instead of U_UNSEEN — so elicit.py's
#       info-gain ordering skips straight past settled taste to what's genuinely
#       new about THIS product.
#
# WHY:  the decision-elicitation research is explicit that the profile layer is
#       where the compounding lives — "each repeat needs fewer questions." A
#       first run might take 10-12 interactions; the fifth, with a warm profile,
#       takes 3-4. This is the difference between a wizard (asks everything every
#       time) and an assistant that knows you.
#
# STORE: ~/dev/designs/.groundwork-profile.json  (cross-design, per machine).
#        A flat, human-readable, hand-editable JSON — NOT a black box. The user
#        can open it, see what Groundwork thinks their taste is, and correct it.
#        Overridable with --store for tests / alternate users.
#
# NOT a claim of certainty: a profiled value SEEDS a lower starting uncertainty;
# the user can still override it in-session (a fresh pick re-decides the dim).
# Seeding lowers the bar to revisit; it never locks anything.
#
# Pure stdlib. No third-party imports. No network.
# Self-test:  python3 -m designer.decide.profile --selftest
# ───────────────────────────────────────────────────────────────────────

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import time
from typing import Any, Optional

SCHEMA = "groundwork.decide.profile/v1"

DEFAULT_STORE = os.path.expanduser("~/dev/designs/.groundwork-profile.json")

# A dimension confirmed across this many sessions is treated as "settled taste":
# its seeded uncertainty floors out and elicit.py won't spend a question on it
# unless the new product's goal keeps it eligible.
_SETTLED_AT = 3
# Seeded uncertainty as a function of how many sessions confirmed the same value.
# 1 session -> 0.55 (a lean), 2 -> 0.35, >=3 -> 0.15 (settled). Never 0: taste
# can change, and a strongly-relevant new product can still re-open it.
_SEED_BY_COUNT = {0: 0.90, 1: 0.55, 2: 0.35}
_SEED_SETTLED = 0.15


def load_profile(store: str = DEFAULT_STORE) -> dict[str, Any]:
    """Load the taste profile, or an empty one if none exists yet."""
    try:
        with open(store, encoding="utf-8") as f:
            prof = json.load(f)
        if prof.get("schema") == SCHEMA and isinstance(prof.get("dimensions"), dict):
            return prof
    except (FileNotFoundError, ValueError, TypeError):
        pass
    return {"schema": SCHEMA, "dimensions": {}}


def save_profile(profile: dict[str, Any], store: str = DEFAULT_STORE) -> None:
    """Write the profile ATOMICALLY (temp file + os.replace).

    Why atomic and not a plain open(w): load_profile treats an unparseable store
    as an EMPTY profile. A reader that catches the store mid-write would then
    read nothing and write nothing back — erasing every dimension the person has
    accumulated, including taste this writer never touched. The store is the one
    artifact the whole compounding layer exists to build, and it is shared by
    every Groundwork surface on the machine, so a half-written moment must never
    be observable.
    """
    os.makedirs(os.path.dirname(store) or ".", exist_ok=True)
    tmp = f"{store}.tmp-{os.getpid()}"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(profile, f, indent=2, sort_keys=False)
            f.write("\n")
        os.replace(tmp, store)
    except BaseException:
        try:
            os.unlink(tmp)      # never leave a partial temp file behind
        except OSError:
            pass
        raise
    _sweep_stale_temps(store)


def _sweep_stale_temps(store: str, older_than_s: float = 600.0) -> None:
    """Remove abandoned temp files next to the store.

    The cleanup above covers an exception, but not a kill -9 mid-write, which
    would strand a `<store>.tmp-<pid>`. Only files older than `older_than_s` are
    touched, so a temp file another process is writing right now is never
    removed. Best-effort: a failure here must not fail the write that succeeded.
    """
    directory = os.path.dirname(store) or "."
    prefix = os.path.basename(store) + ".tmp-"
    cutoff = time.time() - older_than_s
    try:
        for name in os.listdir(directory):
            if not name.startswith(prefix):
                continue
            path = os.path.join(directory, name)
            try:
                if os.path.getmtime(path) < cutoff:
                    os.unlink(path)
            except OSError:
                pass
    except OSError:
        pass


@contextlib.contextmanager
def store_lock(store: str = DEFAULT_STORE, timeout_s: float = 10.0):
    """Serialize a read-modify-write of the shared store ACROSS PROCESSES.

    load_profile -> record_session -> save_profile is not atomic as a unit. Two
    Groundwork surfaces recording at the same moment (two galleries, or a gallery
    and an elicit `record`) would otherwise interleave and silently drop one
    person's confirmation — the lost-update problem, on the file that is supposed
    to accumulate. Every CLI write path holds this lock.

    Waits with a bound rather than blocking forever: a wedged holder must not
    hang a person's `profile record` with no explanation. Creates a `<store>.lock`
    sidecar next to the store.

    Degrades to no lock where fcntl is unavailable; the atomic write above still
    rules out corruption there, leaving only the lost update.
    """
    try:
        import fcntl
    except ImportError:                                   # pragma: no cover
        yield
        return
    os.makedirs(os.path.dirname(store) or ".", exist_ok=True)
    with open(f"{store}.lock", "a+", encoding="utf-8") as lf:
        deadline = time.monotonic() + timeout_s
        told_the_user = False
        while True:
            try:
                fcntl.flock(lf.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"another Groundwork writer has held {store}.lock for "
                        f"over {timeout_s:g}s; nothing was recorded")
                if not told_the_user:
                    print("profile: waiting for another Groundwork writer...", file=sys.stderr)
                    told_the_user = True
                time.sleep(0.05)
        try:
            yield
        finally:
            fcntl.flock(lf.fileno(), fcntl.LOCK_UN)


def seeded_uncertainty(entry: dict[str, Any]) -> float:
    """Starting uncertainty for a dimension the profile knows.

    Lower when the SAME value was confirmed across more sessions; a dimension
    with conflicting history across sessions stays uncertain (the person's taste
    there is genuinely unsettled).
    """
    counts = entry.get("value_counts", {})
    if not counts:
        return _SEED_BY_COUNT[0]
    dominant = max(counts, key=lambda k: counts[k])
    n = counts[dominant]
    total = sum(counts.values())
    conflict = 1.0 - n / total  # taste disagreement across sessions
    base = _SEED_SETTLED if n >= _SETTLED_AT else _SEED_BY_COUNT.get(n, _SEED_BY_COUNT[2])
    # Conflict pulls the seed back toward "unseen" — don't over-trust a split.
    return base + conflict * (_SEED_BY_COUNT[0] - base)


def dominant_value(entry: dict[str, Any]) -> Optional[Any]:
    counts = entry.get("value_counts", {})
    if not counts:
        return None
    key = max(counts, key=lambda k: counts[k])
    # value_counts keys are JSON-stringified; decode back.
    try:
        return json.loads(key)
    except (ValueError, TypeError):
        return key


def seed_session(session: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    """Warm-start an elicit session's dimensions from the profile (layer 6).

    For each dimension the profile knows AND the session has open (not already
    vetoed/pruned), lower its starting uncertainty and pre-fill the leaning
    value. Records which dims were seeded so the flow can tell the user
    "kept 4 of your usual choices; only asking about what's new here."
    Mutates + returns `session`.
    """
    seeded: list[str] = []
    for dim, sv in session.get("dimensions", {}).items():
        if sv.get("excluded"):
            continue  # veto/prune already decided it — don't touch
        entry = profile.get("dimensions", {}).get(dim)
        if not entry:
            continue
        u = seeded_uncertainty(entry)
        if u < sv["uncertainty"]:          # only ever LOWER uncertainty, never raise
            sv["uncertainty"] = u
            sv["value"] = dominant_value(entry)
            seeded.append(dim)
            # SETTLED taste (>= _SETTLED_AT consistent sessions, no conflict) is
            # AUTO-APPLIED, not re-asked: mark it provisionally decided so it
            # never surfaces as a question. The user can still override it with
            # a comment in-session (that re-opens the dim via elicit.answer).
            # This is what actually makes the warm path need fewer questions.
            if u <= _SEED_SETTLED + 1e-9:
                sv["excluded"] = True
                sv["reason"] = "profile-settled: auto-kept your usual choice — change anytime"
            else:
                sv["reason"] = "profile-seed: your recent leaning across prior designs"
    session["profile_seeded"] = seeded
    return session


def record_session(profile: dict[str, Any], decided: dict[str, Any]) -> dict[str, Any]:
    """Fold a finished session's decided dimensions back into the profile.

    `decided` is elicit.status()["decided"] — {dim: value}. Each confirmation
    bumps that value's count for the dimension, so repeated taste compounds and
    `seeded_uncertainty` drops on the next run. Mutates + returns `profile`.
    """
    dims = profile.setdefault("dimensions", {})
    for dim, value in decided.items():
        entry = dims.setdefault(dim, {"value_counts": {}, "sessions": 0})
        vc = entry.setdefault("value_counts", {})
        key = json.dumps(value, sort_keys=True)
        vc[key] = vc.get(key, 0) + 1
        entry["sessions"] = entry.get("sessions", 0) + 1
    return profile


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="designer.decide.profile", description=__doc__)
    ap.add_argument("--selftest", action="store_true")
    sub = ap.add_subparsers(dest="cmd")

    p_show = sub.add_parser("show", help="print the profile")
    p_show.add_argument("--store", default=DEFAULT_STORE)

    p_seed = sub.add_parser("seed", help="warm-start a session file from the profile")
    p_seed.add_argument("--state", required=True)
    p_seed.add_argument("--store", default=DEFAULT_STORE)

    p_rec = sub.add_parser("record", help="fold a session's decided dims into the profile")
    p_rec.add_argument("--state", required=True)
    p_rec.add_argument("--store", default=DEFAULT_STORE)

    # `record` only accepts an elicit-session file, so a surface that reveals
    # taste WITHOUT running an elicit session (the mockups gallery: a pick, a
    # yay/nay, an element annotation) had no way in. `record-dims` is that seam:
    # a plain {dimension: value} map, folded through the SAME record_session(),
    # so every surface compounds into one profile instead of growing its own.
    #
    # POLARITY LIVES IN THE DIMENSION NAME. This schema counts confirmations; it
    # has no notion of a negative one. A dislike must therefore be recorded under
    # its own dimension (e.g. `design_mode_disliked`), and such a dimension must
    # NEVER be added to an elicit session catalog — seed_session would read its
    # count as a preference and pre-fill the disliked value as the answer.
    p_dims = sub.add_parser(
        "record-dims",
        help="fold a plain {dimension: value} JSON map into the profile "
             "(for surfaces that reveal taste outside an elicit session)")
    p_dims.add_argument("--dims", required=True,
                        help='JSON object, e.g. \'{"design_mode":"warm-craft"}\'')
    p_dims.add_argument("--store", default=DEFAULT_STORE)

    args = ap.parse_args(argv)
    if args.selftest:
        _selftest(); return 0

    if args.cmd == "show":
        print(json.dumps(load_profile(args.store), indent=2)); return 0

    if args.cmd == "seed":
        with open(args.state, encoding="utf-8") as f:
            session = json.load(f)
        seed_session(session, load_profile(args.store))
        with open(args.state, "w", encoding="utf-8") as f:
            json.dump(session, f, indent=2); f.write("\n")
        print(json.dumps({"profile_seeded": session.get("profile_seeded", [])}, indent=2))
        return 0

    def _locked_record(decided: dict[str, Any]) -> int:
        try:
            with store_lock(args.store):
                save_profile(record_session(load_profile(args.store), decided), args.store)
        except TimeoutError as e:
            print(f"profile: {e}", file=sys.stderr)
            return 3
        return 0

    if args.cmd == "record":
        with open(args.state, encoding="utf-8") as f:
            session = json.load(f)
        decided = {d: v["value"] for d, v in session.get("dimensions", {}).items()
                   if v.get("excluded") and v.get("value") is not None}
        rc = _locked_record(decided)
        if rc:
            return rc
        print(json.dumps({"recorded": list(decided.keys())}, indent=2))
        return 0

    if args.cmd == "record-dims":
        # Reject malformed input loudly; never silently accept or auto-create a
        # junk dimension (the same contract the other Groundwork CLIs hold —
        # a typo must not quietly become permanent cross-session "taste").
        try:
            decided = json.loads(args.dims)
        except ValueError as e:
            print(f"record-dims: --dims must be valid JSON: {e}", file=sys.stderr)
            return 2
        if not isinstance(decided, dict) or not decided:
            print("record-dims: --dims must be a non-empty JSON object "
                  '{dimension: value}, e.g. \'{"design_mode":"warm-craft"}\'',
                  file=sys.stderr)
            return 2
        bad = [k for k in decided if not isinstance(k, str) or not k.strip()]
        if bad:
            print(f"record-dims: dimension names must be non-empty strings: {bad}",
                  file=sys.stderr)
            return 2
        rc = _locked_record(decided)
        if rc:
            return rc
        print(json.dumps({"recorded": sorted(decided.keys())}, indent=2))
        return 0

    ap.print_help(); return 1


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def _selftest() -> None:
    fails = 0

    def check(name, cond):
        nonlocal fails
        if not cond: fails += 1; print(f"  FAIL: {name}")
        else: print(f"  ok:   {name}")

    from designer.decide.elicit import new_session, status, rank_by_info_gain  # local import

    # empty profile seeds nothing
    prof = {"schema": SCHEMA, "dimensions": {}}
    s = new_session("g", {"color.accent": 0.7, "spacing.density": 0.7})
    seed_session(s, prof)
    check("empty profile: nothing seeded", s["profile_seeded"] == [])
    check("empty profile: uncertainty unchanged", s["dimensions"]["color.accent"]["uncertainty"] == 0.9)

    # one confirmation -> a lean (0.55), value pre-filled
    prof = record_session(prof, {"color.accent": "teal"})
    check("record: value_counts bumped", prof["dimensions"]["color.accent"]["value_counts"]["\"teal\""] == 1)
    s = new_session("g2", {"color.accent": 0.7, "spacing.density": 0.7})
    seed_session(s, prof)
    check("1 session: color.accent seeded", "color.accent" in s["profile_seeded"])
    check("1 session: uncertainty lowered to a lean", abs(s["dimensions"]["color.accent"]["uncertainty"] - 0.55) < 1e-9)
    check("1 session: value pre-filled", s["dimensions"]["color.accent"]["value"] == "teal")
    check("1 session: unknown dim untouched", s["dimensions"]["spacing.density"]["uncertainty"] == 0.9)

    # 1-session lean is NOT excluded — still asked, just sorted lower
    lean_s = new_session("lean", {"color.accent": 0.7})
    seed_session(lean_s, record_session({"schema": SCHEMA, "dimensions": {}}, {"color.accent": "teal"}))
    check("1 session: lean dim NOT auto-excluded", lean_s["dimensions"]["color.accent"]["excluded"] is False)

    # compounding: 3 confirmations -> settled (0.15) AND auto-applied (excluded)
    prof = record_session(prof, {"color.accent": "teal"})
    prof = record_session(prof, {"color.accent": "teal"})
    s = new_session("g3", {"color.accent": 0.7})
    seed_session(s, prof)
    check("3 sessions: settled seed 0.15", abs(s["dimensions"]["color.accent"]["uncertainty"] - 0.15) < 1e-9)
    check("3 sessions: settled dim AUTO-APPLIED (excluded, not re-asked)",
          s["dimensions"]["color.accent"]["excluded"] is True)
    check("3 sessions: settled dim value kept", s["dimensions"]["color.accent"]["value"] == "teal")

    # fewer questions: a fully-settled profile should leave FEWER dims to ask
    dims = {"color.accent": 0.7, "spacing.density": 0.7, "motion.intensity": 0.6}
    warm = {"schema": SCHEMA, "dimensions": {}}
    for _ in range(3):
        for d in dims: warm = record_session(warm, {d: "x"})
    cold_s = new_session("cold", dims)
    warm_s = new_session("warm", dims); seed_session(warm_s, warm)
    cold_q = len(rank_by_info_gain(cold_s))   # dims that would be asked
    warm_q = len(rank_by_info_gain(warm_s))
    check("compounding: warm start asks fewer questions", warm_q < cold_q)
    check("compounding: fully-settled profile asks ~none", warm_q == 0)

    # conflict across sessions keeps a dim uncertain (taste unsettled there)
    conf = {"schema": SCHEMA, "dimensions": {}}
    conf = record_session(conf, {"spacing.density": "tight"})
    conf = record_session(conf, {"spacing.density": "airy"})
    s = new_session("g", {"spacing.density": 0.7})
    seed_session(s, conf)
    check("conflict: split taste stays fairly uncertain", s["dimensions"]["spacing.density"]["uncertainty"] > 0.5)

    # seeding never touches a vetoed dim
    s = new_session("g", {"color.accent": 0.7})
    s["dimensions"]["color.accent"]["excluded"] = True
    s["dimensions"]["color.accent"]["uncertainty"] = 0.05
    seed_session(s, prof)
    check("veto-safe: excluded dim not re-seeded", s["dimensions"]["color.accent"]["uncertainty"] == 0.05)

    # ---- record-dims: the non-elicit seam (gallery picks/ratings/annotations) --
    # Runs the real CLI entrypoint against an isolated temp store — never
    # DEFAULT_STORE, so a selftest can't rewrite the developer's own taste.
    import io
    import subprocess
    import tempfile  # local: keeps the module's import surface minimal

    def cli(argv: list[str]) -> int:
        """Run the real CLI entrypoint, muting its stdout/stderr so the selftest
        output stays a clean list of cases (the exit code is what's under test)."""
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            return main(argv)

    with tempfile.TemporaryDirectory(prefix="gw-profile-selftest-") as td:
        store = os.path.join(td, "nested", "profile.json")  # also proves mkdir -p

        rc = cli(["record-dims", "--dims", '{"design_mode": "warm-craft"}', "--store", store])
        check("record-dims: exits 0", rc == 0)
        p = load_profile(store)
        check("record-dims: dimension folded in",
              p["dimensions"]["design_mode"]["value_counts"]['"warm-craft"'] == 1)
        check("record-dims: session counted", p["dimensions"]["design_mode"]["sessions"] == 1)

        # multiple dims in one call (a gallery act can reveal more than one)
        cli(["record-dims", "--dims",
              '{"design_mode_liked": "glass-workspace", "critique_focus": "PlanInput"}',
              "--store", store])
        p = load_profile(store)
        check("record-dims: multi-dim call records each",
              p["dimensions"]["design_mode_liked"]["value_counts"]['"glass-workspace"'] == 1
              and p["dimensions"]["critique_focus"]["value_counts"]['"PlanInput"'] == 1)

        # compounding is the SAME math as the session path: 3 confirmations settle
        cli(["record-dims", "--dims", '{"design_mode": "warm-craft"}', "--store", store])
        cli(["record-dims", "--dims", '{"design_mode": "warm-craft"}', "--store", store])
        p = load_profile(store)
        check("record-dims: 3 confirmations reach settled taste",
              abs(seeded_uncertainty(p["dimensions"]["design_mode"]) - _SEED_SETTLED) < 1e-9)
        s = new_session("gallery", {"design_mode": 0.7})
        seed_session(s, p)
        check("record-dims: settled dim seeds + auto-applies in a session",
              s["dimensions"]["design_mode"]["excluded"] is True
              and s["dimensions"]["design_mode"]["value"] == "warm-craft")

        # malformed input is REJECTED, never silently accepted, and never writes
        before = load_profile(store)
        reject_store = os.path.join(td, "never-created.json")
        check("record-dims: malformed JSON rejected",
              cli(["record-dims", "--dims", "{not json", "--store", reject_store]) != 0)
        check("record-dims: non-object JSON rejected",
              cli(["record-dims", "--dims", '["design_mode"]', "--store", reject_store]) != 0)
        check("record-dims: empty object rejected",
              cli(["record-dims", "--dims", "{}", "--store", reject_store]) != 0)
        check("record-dims: empty dimension name rejected",
              cli(["record-dims", "--dims", '{"": "x"}', "--store", reject_store]) != 0)
        check("record-dims: a rejected call writes nothing",
              not os.path.exists(reject_store) and load_profile(store) == before)

        # ---- a FAILED write must not damage the existing store ----------------
        # The lock stops writers colliding; it cannot help a writer that dies
        # mid-write. This is what the temp-file + os.replace buys, and it is the
        # only protection on machines without fcntl — so prove it directly rather
        # than leaving it to a race that may not reproduce. A plain open(store,
        # 'w') truncates BEFORE the failure and loses everything.
        atomic_store = os.path.join(td, "atomic", "profile.json")
        save_profile(record_session(load_profile(atomic_store), {"color.accent": "teal"}), atomic_store)
        with open(atomic_store, encoding="utf-8") as f:
            intact = f.read()
        try:
            # object() is not JSON-serializable: json.dump raises PART-WAY through
            save_profile({"schema": SCHEMA, "dimensions": {"a": 1, "b": object()}}, atomic_store)
        except TypeError:
            pass
        with open(atomic_store, encoding="utf-8") as f:
            after = f.read()
        check("atomic write: a failed write leaves the store intact", after == intact)
        check("atomic write: a failed write leaves no temp file behind",
              not [n for n in os.listdir(os.path.dirname(atomic_store)) if ".tmp-" in n])
        check("atomic write: the store is still loadable after a failed write",
              load_profile(atomic_store)["dimensions"]["color.accent"]["value_counts"]['"teal"'] == 1)

        # ---- a wedged lock holder must time out, not hang forever -------------
        held_store = os.path.join(td, "held", "profile.json")
        with store_lock(held_store):
            t0 = time.monotonic()
            try:
                with store_lock(held_store, timeout_s=0.2):
                    check("lock: a held lock is not granted twice", False)
            except TimeoutError:
                check("lock: a wedged holder times out instead of hanging",
                      time.monotonic() - t0 < 5.0)

        # ---- concurrent writers must not lose or erase taste ------------------
        # The store is shared by every Groundwork surface on the machine, and the
        # gallery writes to it per act, so simultaneous writers are ordinary, not
        # exotic. Without an atomic write a reader can catch a half-written file,
        # read it as EMPTY (load_profile's fallback), and write that back —
        # erasing dimensions this writer never touched. Without a lock, the
        # read-modify-write interleaves and confirmations are silently dropped.
        # This runs REAL concurrent processes; both failures are invisible to any
        # single-process test.
        conc_store = os.path.join(td, "concurrent", "profile.json")
        # Pre-seed a settled dimension from the OTHER surface (the elicit path),
        # so the case also proves unrelated taste survives.
        save_profile(record_session(record_session(record_session(
            load_profile(conc_store), {"color.accent": "teal"}),
            {"color.accent": "teal"}), {"color.accent": "teal"}), conc_store)

        writers = 8
        env = dict(os.environ, PYTHONPATH=os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        procs = [subprocess.Popen(
            [sys.executable, "-m", "designer.decide.profile", "record-dims",
             "--dims", '{"design_mode": "warm-craft"}', "--store", conc_store],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(writers)]
        codes = [p.wait() for p in procs]
        conc = load_profile(conc_store)
        check("concurrent: every writer exits 0", all(c == 0 for c in codes))
        check(f"concurrent: all {writers} confirmations survive",
              conc.get("dimensions", {}).get("design_mode", {})
                  .get("value_counts", {}).get('"warm-craft"') == writers)
        check("concurrent: unrelated pre-existing taste is not erased",
              conc.get("dimensions", {}).get("color.accent", {})
                  .get("value_counts", {}).get('"teal"') == 3)

        # the pre-existing session path still works, unchanged, on the same store
        sess_file = os.path.join(td, "session.json")
        sess = new_session("sess", {"color.accent": 0.7})
        sess["dimensions"]["color.accent"]["excluded"] = True
        sess["dimensions"]["color.accent"]["value"] = "teal"
        with open(sess_file, "w", encoding="utf-8") as f:
            json.dump(sess, f)
        check("record (session path) still works", cli(["record", "--state", sess_file,
                                                         "--store", store]) == 0)
        p = load_profile(store)
        check("record (session path) unaffected by record-dims",
              p["dimensions"]["color.accent"]["value_counts"]['"teal"'] == 1
              and p["dimensions"]["design_mode"]["sessions"] == 3)

    print()
    if fails:
        print(f"SELFTEST: {fails} FAILED"); raise SystemExit(1)
    print("SELFTEST: all cases pass (empty, lean-seed, compounding-settle, "
          "fewer-questions, conflict-stays-uncertain, veto-safe, record-dims "
          "fold/compound/reject, session-path-unchanged)")


if __name__ == "__main__":
    if "--selftest" in (sys.argv[1:] or []):
        _selftest()
    else:
        raise SystemExit(main(sys.argv[1:]))
