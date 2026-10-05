#!/usr/bin/env python3
"""
run.py — Groundwork canvas protocol conformance runner.

Boots ANY canvas server via a launch command, waits for it to announce its
port, then runs every check in checks.py against it over HTTP + SSE + the
canvas control-dir filesystem — never server source. Prints ok/FAIL per
check and a summary; exits nonzero if any check fails.

Usage:
  python3 run.py --server "node ../canvas-server.mjs"
  python3 run.py --server "node ../canvas-server.mjs" --verbose
  python3 run.py --server "node ../canvas-server.mjs" --keep-temp

See README.md for what each check covers and PROTOCOL.md for the contract.
"""
from __future__ import annotations

import argparse
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import checks as C

BOOT_TIMEOUT = 12.0
CONNECT_RETRY_TIMEOUT = 5.0


def free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_for_connect(host, port, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


class OutputPump(threading.Thread):
    """Continuously drains a subprocess's stdout so it can never block on a
    full pipe buffer while we run checks against it for the next 30+ seconds."""

    def __init__(self, stream):
        super().__init__(daemon=True)
        self.stream = stream
        self.lines = []
        self._lock = threading.Lock()

    def run(self):
        try:
            for line in iter(self.stream.readline, ""):
                with self._lock:
                    self.lines.append(line)
        except Exception:
            pass
        finally:
            try:
                self.stream.close()
            except Exception:
                pass

    def snapshot(self):
        with self._lock:
            return list(self.lines)


def cleanup(tmpdir, keep):
    if keep:
        print(f"# temp dir kept: {tmpdir}")
        return
    shutil.rmtree(tmpdir, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description="Groundwork canvas protocol conformance suite")
    ap.add_argument("--server", required=True, help='Launch command, e.g. "node ../canvas-server.mjs"')
    ap.add_argument("--keep-temp", action="store_true", help="do not delete the temp canvas dir on exit")
    ap.add_argument("--verbose", action="store_true", help="print captured server stdout at the end")
    args = ap.parse_args()

    server_argv = shlex.split(args.server)
    if not server_argv:
        print("ERROR: --server must not be empty", file=sys.stderr)
        return 2

    tmpdir = Path(tempfile.mkdtemp(prefix="canvas-conformance-"))
    canvas_file = tmpdir / "canvas.html"
    marker = f"CONFORMANCE-{uuid.uuid4().hex[:12]}"
    # <!--z--> is a fixed-width marker the same-size-rewrite SSE check flips
    # in place (see checks.check_sse_reload_on_same_size_rewrite).
    canvas_file.write_text(f"<!doctype html><html><body><p>{marker}</p><!--z--></body></html>")

    port = free_port()
    argv = server_argv + [
        "--file", str(canvas_file),
        "--dir", str(tmpdir),
        "--port", str(port),
        "--title", "Conformance",
    ]

    print(f"# booting: {' '.join(argv)}")
    try:
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    except Exception as e:
        print(f"ERROR: failed to launch server: {e}", file=sys.stderr)
        cleanup(tmpdir, args.keep_temp)
        return 2

    pump = OutputPump(proc.stdout)
    pump.start()

    startup_line = None
    actual_port = port
    deadline = time.time() + BOOT_TIMEOUT
    while time.time() < deadline:
        for line in pump.snapshot():
            m = re.search(r"http://localhost:(\d+)", line)
            if m:
                startup_line = line
                actual_port = int(m.group(1))
                break
        if startup_line or proc.poll() is not None:
            break
        time.sleep(0.1)

    if not startup_line:
        if proc.poll() is None:
            proc.kill()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        print(f"FAIL: server never printed a line containing http://localhost:<port> within {BOOT_TIMEOUT}s")
        print("".join(pump.snapshot()))
        cleanup(tmpdir, args.keep_temp)
        return 1

    if not wait_for_connect("127.0.0.1", actual_port, CONNECT_RETRY_TIMEOUT):
        proc.kill()
        print(f"FAIL: server printed {startup_line.strip()!r} but port {actual_port} never accepted a connection")
        cleanup(tmpdir, args.keep_temp)
        return 1

    ctx = C.Ctx(
        host="127.0.0.1",
        port=actual_port,
        canvas_dir=tmpdir,
        canvas_file=canvas_file,
        ctrl_dir=tmpdir / ".canvas",
        status_file=tmpdir / ".canvas" / "status.json",
        feedback_file=tmpdir / ".canvas" / "feedback.jsonl",
        mode_file=tmpdir / ".canvas" / "mode.json",
        marker=marker,
        server_argv=server_argv,
        startup_line=startup_line,
        proc=proc,
    )

    results = []
    for check in C.CHECKS:
        try:
            status, msg = check.fn(ctx)
        except Exception as e:
            status, msg = C.FAIL, f"unhandled exception: {type(e).__name__}: {e}"
        results.append((check, status, msg))
        tag = {"PASS": " ok ", "FAIL": "FAIL", "SKIP": "SKIP"}[status]
        print(f"[{tag}] {check.id}: {msg}    ({check.ref})")

    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
    pump.join(timeout=2)

    if args.verbose:
        print("\n--- server stdout/stderr ---")
        print("".join(pump.snapshot()))

    cleanup(tmpdir, args.keep_temp)

    passed = sum(1 for _, s, _ in results if s == C.PASS)
    failed = sum(1 for _, s, _ in results if s == C.FAIL)
    skipped = sum(1 for _, s, _ in results if s == C.SKIP)
    total = len(results)
    print(f"\nSUMMARY: {passed}/{total} passed, {failed} failed, {skipped} skipped")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
