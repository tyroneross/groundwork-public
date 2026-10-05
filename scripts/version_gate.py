#!/usr/bin/env python3
"""Groundwork version gate — one source of truth, and no version without a release.

TWO RULES, TWO SCOPES
---------------------
`--agreement` (runs in scripts/check.sh, so on every test run and every push)
    Every file that declares the version must declare the SAME version.

`--release` (runs in .githooks/pre-push only)
    The manifest must not disagree with the VERSION OF RECORD in
    ~/dev/git-folder/_catalog/versions.json.

    This rule used to read "pushing commits must move the version past origin;
    a push is the unit of release." That premise was retired 2026-09-04 by an
    explicit decision: the version describes what the USER GETS, not how much
    work produced it. It moves on a push that delivers a feature, a capability,
    or a major fix, and NOT for text, references, or docs. Pushing 1 commit and
    pushing 40 produce the same single bump.

    Forcing a bump per push made every documentation edit look like a release,
    which is how a repo ends up at 0.4.1 for a README change. Worse, it made the
    number stop meaning anything, which is the same failure this file was
    written to prevent — just approached from the other side.

WHY THIS EXISTS
---------------
2026-09-01: `.claude-plugin/plugin.json` read 0.3.1 while `package.json` and
`.claude-plugin/marketplace.json` read 0.3.0, and origin/main read 0.3.0 with
nine commits unpushed. So 0.3.1 was a version that existed in one file of one
working tree and nowhere on GitHub — yet a plugin install had already cached it
as "0.3.1", making the CACHE look newer than the checkout that was actually
ahead. Version numbers stopped being evidence of anything.

Two defects produced that, and this gate closes both:

1. NO SOURCE OF TRUTH. Three files carried a version and two consumers
   disagreed about which one counted: `scripts/stage-release.mjs` read
   `package.json`, while the Claude/Codex plugin host reads
   `.claude-plugin/plugin.json`. Nothing compared them, so they drifted
   silently and each consumer was correct by its own lights.
2. VERSIONING AHEAD OF RELEASE. The bump landed in the working tree instead of
   at the push. Tyrone's rule: "versioning shouldn't happen until released and
   pushed to GitHub." A number that is not on origin is not a version, it is a
   guess, and anything that installs from a local path will cache the guess.

WHY COMPARE AGAINST ORIGIN AND NOT AGAINST TAGS
-----------------------------------------------
Same reason build-loop's gate does (scripts/prepush_version_gate.py there):
tags get skipped, and a skipped tag would let a release push twice with no
bump. The remote's own copy of the manifest cannot drift from what origin has.

WHY THIS BLOCKS INSTEAD OF AUTO-BUMPING
---------------------------------------
Rewriting the manifest mid-push would change commits git has already computed
refs for, and would land a bump in a commit nobody reviewed. So it blocks and
prints the exact command, matching how check.sh already fails closed.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The manifest the plugin host actually reads is the source of truth. Every
# other file mirrors it.
SOURCE = ".claude-plugin/plugin.json"
MIRRORS = (
    # The Codex host reads its own manifest; designer/tests already asserted the
    # two hosts agree, and that test is what caught this file missing from the
    # first draft of this gate.
    ".codex-plugin/plugin.json",
    "package.json",
    ".claude-plugin/marketplace.json",
    ".agents/plugins/marketplace.json",
)
BYPASS = "GROUNDWORK_SKIP_VERSION_GATE"


def _version_in(blob: object) -> str | None:
    """First `version` string found, depth-first. Marketplace files nest theirs."""
    if isinstance(blob, dict):
        v = blob.get("version")
        if isinstance(v, str):
            return v
        for value in blob.values():
            found = _version_in(value)
            if found:
                return found
    elif isinstance(blob, list):
        for value in blob:
            found = _version_in(value)
            if found:
                return found
    return None


def read_version(rel: str, root: Path = ROOT) -> str | None:
    path = root / rel
    if not path.exists():
        return None
    try:
        return _version_in(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, OSError):
        return None


def _semver(v: str | None) -> tuple[int, int, int] | None:
    if not isinstance(v, str):
        return None
    parts = v.split("-")[0].split(".")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    return int(parts[0]), int(parts[1]), int(parts[2])


def _git(args: list[str]) -> str | None:
    try:
        r = subprocess.run(["git", "-C", str(ROOT), *args],
                           capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def check_agreement() -> list[str]:
    """Every declared version identical. Returns human-readable failures."""
    source = read_version(SOURCE)
    if source is None:
        return [f"{SOURCE} declares no readable version; it is the source of truth"]
    if _semver(source) is None:
        return [f"{SOURCE} version {source!r} is not semver"]

    bad = []
    for rel in MIRRORS:
        mirror = read_version(rel)
        if mirror is None:
            continue  # absent file is fine; a present-but-wrong one is not
        if mirror != source:
            bad.append(f"{rel} declares {mirror} but {SOURCE} declares {source}")
    return bad


def _catalog_version() -> tuple[str | None, str | None]:
    """The version of record, or a reason it could not be read.

    The catalog is the single source of truth across every plugin, so this gate
    asks it rather than deciding locally. It fails OPEN on an unreachable
    catalog: a missing shared file should not block a push in one repo.
    """
    catalog = Path.home() / "dev" / "git-folder" / "_catalog" / "catalog_version.py"
    if not catalog.is_file():
        return None, f"no catalog at {catalog}"
    try:
        out = subprocess.run(
            [sys.executable, str(catalog), "get", "groundwork"],
            capture_output=True, text=True, timeout=20,
        )
    except Exception as exc:
        return None, f"catalog unreadable: {exc}"
    if out.returncode != 0:
        return None, (out.stderr or "").strip() or "catalog returned no version"
    return (out.stdout.strip() or None), None


def check_release() -> list[str]:
    """The manifest must agree with the version of record.

    NOT "the version must have moved." A push carrying only text or references
    is expected to ship the same version it shipped last time.
    """
    of_record, why = _catalog_version()
    if of_record is None:
        # Fail open, but say so — a silent skip is how a gate rots unnoticed.
        print(f"version_gate: skipping catalog check ({why})", file=sys.stderr)
        return []

    local = read_version(SOURCE)
    if local is None:
        return []  # manifest omits version and resolves to the SHA: the target state

    if local != of_record:
        return [
            f"{SOURCE} declares {local} but the version of record is {of_record}.",
            "The catalog is the source of truth across every plugin:",
            "    ~/dev/git-folder/_catalog/versions.json",
            "Bump it only if this push delivers a capability or a major fix:",
            "    python3 ~/dev/git-folder/_catalog/catalog_version.py bump groundwork \\",
            '        --capability --reason "<what it delivers>"',
            "Otherwise drop the hand-pinned version from the manifest so it",
            "resolves to the commit SHA and cannot drift again.",
        ]
    return []


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--agreement", action="store_true",
                    help="all declared versions identical (safe to run anytime)")
    ap.add_argument("--release", action="store_true",
                    help="also require a bump past origin when commits are pending")
    args = ap.parse_args()
    if not (args.agreement or args.release):
        args.agreement = True

    import os
    if os.environ.get(BYPASS):
        print(f"version gate bypassed via {BYPASS}")
        return 0

    failures: list[str] = []
    if args.agreement or args.release:
        failures += check_agreement()
    if args.release:
        failures += check_release()

    if failures:
        print("VERSION GATE FAILED", file=sys.stderr)
        for line in failures:
            print(f"  {line}", file=sys.stderr)
        print(f"\n  Genuinely not a release? {BYPASS}=1 git push", file=sys.stderr)
        return 1

    print(f"version gate ok — {read_version(SOURCE)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
