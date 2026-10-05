#!/usr/bin/env python3
"""
mutations.py — proves run.py actually bites.

PROTOCOL.md §8: "A new server implementation is 'conformant' iff the suite
passes AND the suite has been mutation-validated (deliberately break the
reference server; confirm the suite catches it). No server ships on
green-that-never-failed."

This script creates deliberately BROKEN temp copies of the reference
canvas-server.mjs — one protocol violation at a time — runs run.py against
each broken copy, and asserts (a) the suite exits nonzero and (b) the
specific check(s) expected to catch that violation are among the failures.
If any mutation is NOT caught, this script itself exits nonzero.

Usage:
  python3 mutations.py
  python3 mutations.py --server-source /path/to/alternate-canvas-server.mjs
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN_PY = HERE / "run.py"
DEFAULT_SOURCE = HERE.parent / "canvas-server.mjs"


# ---------------------------------------------------------------------------
# Mutations. Each takes the reference source and returns a broken variant, or
# raises RuntimeError if its anchor text isn't found (source drifted —
# surfaced as a [SETUP-FAIL], not silently skipped).
# ---------------------------------------------------------------------------

def mutate_remove_toggle_mode_writeback(src):
    """Breaks PROTOCOL.md §5.3: a `toggle` feedback row must rewrite
    mode.json. Deletes the entire if-block that does so."""
    pattern = re.compile(
        r"\n\s*// A toggle also updates mode\.json.*?\n"
        r"\s*if \(row\.kind === 'toggle'.*?\n"
        r"\s*fs\.writeFileSync\(MODE_FILE.*?\n"
        r"\s*\}\n",
        re.DOTALL,
    )
    new_src, n = pattern.subn("\n", src, count=1)
    if n != 1:
        raise RuntimeError("mutate_remove_toggle_mode_writeback: anchor pattern not found (source drifted)")
    return new_src


def mutate_status_404_on_missing(src):
    """Breaks PROTOCOL.md §3: GET /__canvas/status MUST NOT 404/500 on a
    missing status.json. Injects a 404 short-circuit."""
    anchor = "if (p === '/__canvas/status') {\n"
    if anchor not in src:
        raise RuntimeError("mutate_status_404_on_missing: anchor not found (source drifted)")
    injected = anchor + "    if (!fs.existsSync(STATUS_FILE)) { res.writeHead(404).end('not found'); return; }\n"
    return src.replace(anchor, injected, 1)


def mutate_bind_all_interfaces(src):
    """Breaks PROTOCOL.md §3: server MUST bind loopback only. Drops the
    '127.0.0.1' host argument from server.listen(), which makes Node bind
    all interfaces."""
    anchor = "server.listen(PORT, '127.0.0.1', () => {"
    if anchor not in src:
        raise RuntimeError("mutate_bind_all_interfaces: anchor not found (source drifted)")
    return src.replace(anchor, "server.listen(PORT, () => {", 1)


def mutate_drop_hello_frame(src):
    """Breaks PROTOCOL.md §4: SSE connect MUST send retry: then a hello
    frame. Removes the hello frame write."""
    pattern = re.compile(
        r"^\s*res\.write\(`data: \$\{JSON\.stringify\(\{ type: 'hello' \}\)\}\\n\\n`\);\n",
        re.MULTILINE,
    )
    new_src, n = pattern.subn("", src, count=1)
    if n != 1:
        raise RuntimeError("mutate_drop_hello_frame: anchor pattern not found (source drifted)")
    return new_src


MUTATIONS = [
    ("remove_toggle_mode_writeback", mutate_remove_toggle_mode_writeback,
     {"feedback_toggle_updates_mode"}),
    ("status_404_on_missing", mutate_status_404_on_missing,
     {"status_missing_returns_empty"}),
    ("bind_all_interfaces", mutate_bind_all_interfaces,
     {"loopback_bind_refused"}),
    ("drop_hello_frame", mutate_drop_hello_frame,
     {"sse_retry_then_hello"}),
]


def run_suite_against(server_path):
    cmd = [sys.executable, str(RUN_PY), "--server", f'node "{server_path}"']
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return 1, set(), "(suite timed out)"
    failing = set(re.findall(r"^\[FAIL\] (\S+):", proc.stdout, re.MULTILINE))
    return proc.returncode, failing, proc.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server-source", default=str(DEFAULT_SOURCE),
                     help="reference server .mjs to mutate (default: ../canvas-server.mjs)")
    ap.add_argument("--verbose", action="store_true", help="print full run.py output per mutation")
    args = ap.parse_args()

    source_path = Path(args.server_source)
    if not source_path.exists():
        print(f"ERROR: reference server source not found: {source_path}", file=sys.stderr)
        return 2
    src = source_path.read_text()

    tmpdir = Path(tempfile.mkdtemp(prefix="canvas-mutations-"))
    all_ok = True
    try:
        # Mutated copies retain the reference server's relative runtime imports.
        # Stage those immutable sibling modules beside every broken server so a
        # module-resolution crash cannot masquerade as a caught protocol fault.
        for dependency in ("gallery-archive.mjs", "workspace.mjs"):
            sibling = source_path.parent / dependency
            if not sibling.is_file():
                print(f"ERROR: required canvas runtime dependency not found: {sibling}", file=sys.stderr)
                return 2
            shutil.copy2(sibling, tmpdir / sibling.name)
        for name, mutate_fn, expected_checks in MUTATIONS:
            broken_path = tmpdir / f"broken-{name}.mjs"
            try:
                mutated_src = mutate_fn(src)
            except RuntimeError as e:
                print(f"[SETUP-FAIL] {name}: {e}")
                all_ok = False
                continue
            broken_path.write_text(mutated_src)

            returncode, failing, stdout = run_suite_against(broken_path)
            if args.verbose:
                print(f"\n--- run.py output for mutation '{name}' ---\n{stdout}\n--- end ---")
            caught = failing & expected_checks

            if returncode == 0:
                print(f"[NOT CAUGHT] {name}: suite exited 0 against the broken server — mutation is invisible")
                all_ok = False
            elif not failing:
                print(f"[NOT CAUGHT] {name}: suite exited {returncode} but no [FAIL] lines were parsed from its output")
                all_ok = False
            elif not caught:
                print(f"[WRONG CHECK] {name}: expected one of {sorted(expected_checks)} to fail, "
                      f"got failures {sorted(failing)} instead")
                all_ok = False
            else:
                print(f"[caught] {name}: caught by {sorted(caught)}"
                      + (f" (also: {sorted(failing - expected_checks)})" if failing - expected_checks else ""))
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print()
    if all_ok:
        print(f"MUTATIONS: all {len(MUTATIONS)} mutations were caught by their expected check(s).")
        return 0
    print("MUTATIONS: at least one mutation was NOT caught as expected — the suite (or this "
          "mutation harness) has a gap. See lines above.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
