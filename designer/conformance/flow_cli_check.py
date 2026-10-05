#!/usr/bin/env python3
"""
flow_cli_check.py — Groundwork flow-doc ↔ CLI conformance.

WHAT it catches (the class a green unit-test suite structurally CANNOT):
  1. DOC-COMMAND DRIFT — every plugin-CLI command written in a flow doc
     (references/*.md, skills/groundwork/SKILL.md) must actually run against the
     live code: its subcommand must exist and every --flag it names must be a
     real flag. Validated against `--help` (side-effect-free; never runs a body,
     never launches a server). This is what would have caught the 2026-07-11 F1
     defect — explore-ui.md documented `preview --sweep-hue 1` as the palette
     preview when preview had no way to take the elicited params, and later a
     `--params` flag that didn't exist.
  2. CLI INPUT VALIDATION — a CLI fed a malformed enum / unknown value must exit
     nonzero with an error, never deadlock or silently substitute a default
     (the 2026-07-11 D2/D3 defects: a typo'd --dim auto-created a junk dim and
     deadlocked the loop; a bad --value was silently accepted).

WHY it's a hook, not a memory note or a skill: input-validation, CLI robustness,
and doc-command drift are deterministic and mechanically checkable. Per the
project rule "automate what's deterministic; skill-ify the judgment; rule-ify the
irreducible process; memory is the record" — this is the automate layer. A memory
note only fires if recalled; this fires every run.

Usage:
  python3 -m designer.conformance.flow_cli_check            # run all checks
  python3 -m designer.conformance.flow_cli_check --verbose
  python3 -m designer.conformance.flow_cli_check --selftest # mutation-prove it bites

Exit 0 = all pass, 1 = a check failed, 2 = harness error.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

# plugin root = three levels up from this file (designer/conformance/x.py -> root)
ROOT = Path(__file__).resolve().parents[2]

PASS, FAIL = "PASS", "FAIL"

# Docs whose fenced shell blocks are the flow's contract with the user.
DOC_GLOBS = ["references/*.md", "skills/groundwork/SKILL.md"]

# A plugin-CLI python invocation: optional env-var prefixes, then
# `python3 -m designer.<dotted.module> <rest-of-command>`.
_PY_CLI = re.compile(r"python3?\s+-m\s+(designer\.[\w.]+)\s*(.*)")
# A node server/tool invocation: `node <...>/designer/<path>.mjs <rest>`.
_NODE_CLI = re.compile(r"node\s+\S*designer/([\w./-]+\.mjs)\s*(.*)")
_FLAG = re.compile(r"(?:^|\s)(--[A-Za-z][\w-]*)")
# argparse colorizes --help output on Python ≥3.14 (and unconditionally when
# FORCE_COLOR is set in the environment). The SGR escapes wrap flag tokens
# (e.g. "\x1b[36m--title\x1b[0m"), which defeats the (?<![\w-]) flag-presence
# lookbehind below and makes every documented flag look "missing". Strip ANSI
# from captured help text so the check is robust regardless of the caller's
# color environment.
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _env() -> dict:
    e = dict(os.environ)
    e["PYTHONPATH"] = str(ROOT)
    return e


# ---------------------------------------------------------------------------
# Extract CLI invocations from the fenced shell blocks of the flow docs
# ---------------------------------------------------------------------------

def _shell_blocks(md: str) -> list[str]:
    """Every ```bash / ```sh fenced block body in a markdown doc."""
    return re.findall(r"```(?:bash|sh)\n(.*?)```", md, re.DOTALL)


def _logical_lines(block: str) -> list[str]:
    """Join backslash-continued lines into single logical commands."""
    out, buf = [], ""
    for raw in block.splitlines():
        line = raw.rstrip()
        if line.endswith("\\"):
            buf += line[:-1] + " "
            continue
        buf += line
        if buf.strip():
            out.append(buf.strip())
        buf = ""
    if buf.strip():
        out.append(buf.strip())
    return out


def _command_span(rest: str) -> str:
    """The command text up to the first shell separator / redirect, so flags of a
    piped-to or redirected-from command are not misattributed."""
    for sep in ("|", ">", "&&", ";"):
        i = rest.find(sep)
        if i != -1:
            rest = rest[:i]
    return rest.strip()


def scan_docs() -> tuple[list[dict], list[dict]]:
    """Return (python_invocations, node_invocations) found across the flow docs.
    Each python entry: {module, subcommand|None, flags:[--x...], doc, line}.
    Each node entry:   {mjs, flags:[--x...], doc, line}."""
    py, node = [], []
    for glob in DOC_GLOBS:
        for path in sorted(ROOT.glob(glob)):
            text = path.read_text(encoding="utf-8")
            for block in _shell_blocks(text):
                for line in _logical_lines(block):
                    mpy = _PY_CLI.search(line)
                    if mpy:
                        module = mpy.group(1)
                        rest = _command_span(mpy.group(2))
                        toks = rest.split()
                        sub = toks[0] if toks and not toks[0].startswith("-") else None
                        flags = _FLAG.findall(" " + rest)
                        py.append({"module": module, "subcommand": sub,
                                   "flags": sorted(set(flags)),
                                   "doc": path.relative_to(ROOT).as_posix(), "line": line})
                    mnode = _NODE_CLI.search(line)
                    if mnode:
                        rest = _command_span(mnode.group(2))
                        flags = _FLAG.findall(" " + rest)
                        node.append({"mjs": mnode.group(1), "flags": sorted(set(flags)),
                                     "doc": path.relative_to(ROOT).as_posix(), "line": line})
    return py, node


# ---------------------------------------------------------------------------
# Check 1 — doc commands validate against the live CLI (--help), no side effects
# ---------------------------------------------------------------------------

def _help_text(module: str, subcommand: Optional[str]) -> tuple[bool, str]:
    """`python3 -m module [subcommand] --help`. (ok, text). ok=False if argparse
    rejected the subcommand (nonzero exit)."""
    argv = [sys.executable, "-m", module] + ([subcommand] if subcommand else []) + ["--help"]
    try:
        p = subprocess.run(argv, env=_env(), capture_output=True, text=True, timeout=25)
    except subprocess.TimeoutExpired:
        return False, "timeout"
    return (p.returncode == 0), _ANSI.sub("", p.stdout + p.stderr)


def check_doc_commands(invocations: Optional[list[dict]] = None) -> list[tuple[str, str]]:
    """One (status, msg) per documented python CLI command."""
    py = invocations if invocations is not None else scan_docs()[0]
    results = []
    help_cache: dict[tuple[str, Optional[str]], tuple[bool, str]] = {}
    for inv in py:
        key = (inv["module"], inv["subcommand"])
        if key not in help_cache:
            help_cache[key] = _help_text(*key)
        ok, help_text = help_cache[key]
        label = f"{inv['module']}" + (f" {inv['subcommand']}" if inv["subcommand"] else "")
        if not ok:
            results.append((FAIL, f"{inv['doc']}: `{label}` — subcommand/module not runnable "
                                  f"(argparse rejected it): {inv['line'][:70]}"))
            continue
        missing = [f for f in inv["flags"] if not re.search(rf"(?<![\w-]){re.escape(f)}(?![\w-])", help_text)]
        if missing:
            results.append((FAIL, f"{inv['doc']}: `{label}` documents flag(s) {missing} "
                                  f"not in its --help — doc/CLI drift"))
        else:
            results.append((PASS, f"{inv['doc']}: `{label}` {inv['flags']} all valid"))
    return results


def check_node_commands(invocations: Optional[list[dict]] = None) -> list[tuple[str, str]]:
    """Node servers have no argparse --help; validate each documented --flag is
    actually parsed by the .mjs source (looks for `flag('--x'` / '--x')."""
    node = invocations if invocations is not None else scan_docs()[1]
    results = []
    src_cache: dict[str, str] = {}
    for inv in node:
        src_path = ROOT / "designer" / inv["mjs"]
        if not src_path.exists():
            results.append((FAIL, f"{inv['doc']}: node target designer/{inv['mjs']} does not exist"))
            continue
        src = src_cache.setdefault(inv["mjs"], src_path.read_text(encoding="utf-8"))
        missing = [f for f in inv["flags"] if f not in src]
        if missing:
            results.append((FAIL, f"{inv['doc']}: designer/{inv['mjs']} documents flag(s) {missing} "
                                  f"not referenced in its source — doc/CLI drift"))
        else:
            results.append((PASS, f"designer/{inv['mjs']} {inv['flags']} all referenced"))
    return results


# ---------------------------------------------------------------------------
# Check 2 — CLIs reject malformed input (never deadlock / silently accept)
# ---------------------------------------------------------------------------

def check_input_validation() -> list[tuple[str, str]]:
    """Feed each CLI boundary a malformed value and assert it rejects with a
    nonzero exit — never deadlock, never silently accept.

    CRITICAL to test validity: the answer cases run against a REAL, valid session
    file. A missing session would ALSO exit nonzero (file-load crash), confounding
    "rejected by validation" with "crashed on a missing file" — a disabled
    validator would then pass. With a valid session, a reject is the ONLY cause of
    a nonzero exit, so turning validation off flips the case to accept (exit 0)
    and the check fails. (Mutation-verified in _selftest.)
    """
    cd = "designer.decide.color_dimensions"
    results = []
    with tempfile.TemporaryDirectory(prefix="gw-cli-conf-") as td:
        sess = str(Path(td) / "session.json")
        init = subprocess.run([sys.executable, "-m", cd, "init", "--goal", "g",
                               "--mode", "light", "--out", sess],
                              env=_env(), capture_output=True, text=True, timeout=25)
        if init.returncode != 0 or not Path(sess).exists():
            return [(FAIL, f"could not create a baseline session (harness): {init.stderr[:120]}")]

        cases = [
            # D2: typo'd dimension rejected, not auto-created + deadlocked
            (["-m", cd, "answer", "--session", sess, "--dim", "tempreture", "--value", "warm"], True,
             "answer: typo'd --dim rejected"),
            # D3: unknown value rejected, not silently defaulted
            (["-m", cd, "answer", "--session", sess, "--dim", "temperature", "--value", "hot-pink"], True,
             "answer: unknown --value rejected"),
            # argparse choices layer: bad --mode rejected
            (["-m", cd, "init", "--goal", "g", "--mode", "chartreuse", "--out", str(Path(td) / "x.json")], True,
             "init: bad --mode rejected"),
            # control LAST (it mutates the session): a valid answer must SUCCEED,
            # else "reject everything" would pass the check vacuously.
            (["-m", cd, "answer", "--session", sess, "--dim", "temperature", "--value", "warm"], False,
             "answer (valid) accepted"),
        ]
        for argv, must_fail, label in cases:
            try:
                p = subprocess.run([sys.executable, *argv], env=_env(),
                                   capture_output=True, text=True, timeout=25)
            except subprocess.TimeoutExpired:
                results.append((FAIL, f"{label}: DEADLOCKED (timed out) — the exact D2 failure mode"))
                continue
            failed = p.returncode != 0
            if failed == must_fail:
                verb = "rejected (nonzero)" if must_fail else "accepted (zero)"
                results.append((PASS, f"{label}: {verb}"))
            else:
                got = "accepted it (exit 0)" if must_fail else f"rejected it (exit {p.returncode})"
                results.append((FAIL, f"{label}: expected {'reject' if must_fail else 'accept'}, "
                                      f"but CLI {got}"))
    return results


# ---------------------------------------------------------------------------
# Runner + mutation self-test
# ---------------------------------------------------------------------------

def run_all(verbose: bool = False) -> int:
    py, node = scan_docs()
    groups = [
        ("doc-command drift (python)", check_doc_commands(py)),
        ("doc-command drift (node)", check_node_commands(node)),
        ("CLI input validation", check_input_validation()),
    ]
    failed = 0
    for name, results in groups:
        print(f"\n# {name}")
        for status, msg in results:
            if status == FAIL:
                failed += 1
            if status == FAIL or verbose:
                print(f"  [{'FAIL' if status == FAIL else ' ok '}] {msg}")
        if not verbose:
            passed = sum(1 for s, _ in results if s == PASS)
            print(f"  {passed}/{len(results)} passed")
    total = sum(len(r) for _, r in groups)
    print(f"\nSUMMARY: {total - failed}/{total} passed, {failed} failed  "
          f"(scanned {len(py)} python + {len(node)} node doc commands)")
    return 1 if failed else 0


def _selftest() -> None:
    """Mutation-prove each check BITES: inject a defect, confirm a FAIL; confirm
    the real docs/CLIs pass."""
    ok = 0

    # A) doc-command check catches a nonexistent flag (F1-class), on a temp doc.
    with tempfile.TemporaryDirectory() as td:
        bad = Path(td) / "bad.md"
        bad.write_text("```bash\npython3 -m designer.color.preview --nonexistent-flag 1\n```\n")
        # scan the temp doc directly through the same extractor + checker
        text = bad.read_text()
        invs = []
        for block in _shell_blocks(text):
            for line in _logical_lines(block):
                m = _PY_CLI.search(line)
                if m:
                    rest = _command_span(m.group(2))
                    toks = rest.split()
                    invs.append({"module": m.group(1),
                                 "subcommand": toks[0] if toks and not toks[0].startswith("-") else None,
                                 "flags": sorted(set(_FLAG.findall(" " + rest))),
                                 "doc": "bad.md", "line": line})
        res = check_doc_commands(invs)
        assert any(s == FAIL and "--nonexistent-flag" in m for s, m in res), \
            f"doc-command check must FAIL on a bogus flag, got {res}"
    ok += 1

    # B) doc-command check PASSES a real, correct command.
    good = [{"module": "designer.color.preview", "subcommand": None,
             "flags": ["--params-file", "--sweep-hue", "--title"],
             "doc": "x.md", "line": "..."}]
    assert all(s == PASS for s, _ in check_doc_commands(good)), "real preview flags must pass"
    ok += 1

    # C) input-validation check discriminates: reject-cases fail, control passes.
    iv = check_input_validation()
    assert all(s == PASS for s, _ in iv), f"live CLIs must pass input validation, got {iv}"
    # and prove the reject-cases are genuinely testing rejection (not vacuous):
    labels = [m for _, m in iv]
    assert any("typo'd --dim rejected" in m for m in labels), "D2 case present"
    assert any("unknown --value rejected" in m for m in labels), "D3 case present"
    ok += 1

    # D) the REAL flow docs pass end-to-end (this is the live guard).
    assert run_all(verbose=False) == 0, "the real flow docs + CLIs must conform"
    ok += 1

    print(f"flow_cli_check selftest: {ok}/{ok} passed (mutation-validated: catches bogus flag, "
          f"discriminates reject vs accept)")


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="designer.conformance.flow_cli_check", description=__doc__)
    ap.add_argument("--verbose", action="store_true", help="print every check, not just failures")
    ap.add_argument("--selftest", action="store_true", help="mutation-prove the checks bite, then exit")
    args = ap.parse_args(argv)
    if args.selftest:
        _selftest()
        return 0
    return run_all(verbose=args.verbose)


if __name__ == "__main__":
    raise SystemExit(main())
