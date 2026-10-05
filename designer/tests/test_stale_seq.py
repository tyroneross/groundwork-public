"""f1 closure — stale-seq rejection at the live server endpoints.

The stale-seq guard lives in the zero-dep Node server (designer-server.mjs), so
its closure test is a node:test (test_stale_seq.mjs) that boots the real server
and drives the agent handshake over HTTP. This pytest wrapper runs that node
test as a subprocess so the single tracked suite (`pytest designer/tests/`)
covers it — no separate runner, no new Python deps.

Run: python3 -m pytest designer/tests/test_stale_seq.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NODE_TEST = os.path.join(ROOT, "designer", "tests", "test_stale_seq.mjs")
STATE_FILE = os.path.join(ROOT, ".designer-state.json")


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_stale_seq_rejected_via_node():
    """Run the node:test that exercises the live stale-seq guard end to end."""
    # Snapshot the live state file so the server-boot test does not leave the
    # working .designer-state.json mutated for the developer session.
    snapshot = None
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "rb") as fh:
            snapshot = fh.read()

    try:
        proc = subprocess.run(
            ["node", "--test", NODE_TEST],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=60,
        )
    finally:
        # Restore (or remove) the state file so the test is side-effect free.
        if snapshot is not None:
            with open(STATE_FILE, "wb") as fh:
                fh.write(snapshot)
        elif os.path.exists(STATE_FILE):
            os.remove(STATE_FILE)

    assert proc.returncode == 0, (
        "node stale-seq test failed:\n"
        f"STDOUT:\n{proc.stdout}\n\nSTDERR:\n{proc.stderr}"
    )
    # Sanity: the TAP output reports no failures and at least one pass.
    assert "# fail 0" in proc.stdout, proc.stdout
    assert "# pass 0" not in proc.stdout, proc.stdout
