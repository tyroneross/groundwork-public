#!/usr/bin/env python3
"""Reject staged local agent state from Groundwork commits."""

from __future__ import annotations

import subprocess
import sys
from pathlib import PurePosixPath


RUNTIME_PARTS = {
    ".agent-rally-point", ".bookmark", ".build-loop", ".claude",
    ".claude-code-debugger", ".codex", ".episodic", ".in_use",
    ".procedural", ".rally", ".semantic",
}
ALLOWED = {".codex/hooks.json"}
ALLOWED_PREFIXES = (".claude/commands/",)


def is_runtime_path(name: str) -> bool:
    if name in ALLOWED or name.startswith(ALLOWED_PREFIXES):
        return False
    return any(part in RUNTIME_PARTS for part in PurePosixPath(name).parts)


def main() -> int:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        capture_output=True,
    )
    if result.returncode:
        sys.stderr.write(result.stderr.decode(errors="replace"))
        return 2
    blocked = sorted(
        name for name in (raw.decode(errors="surrogateescape") for raw in result.stdout.split(b"\0") if raw)
        if is_runtime_path(name)
    )
    if blocked:
        print("Local runtime state cannot be committed:", file=sys.stderr)
        for name in blocked:
            print(f"  {name}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
