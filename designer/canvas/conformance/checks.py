#!/usr/bin/env python3
"""
checks.py — individual protocol assertions for the Groundwork canvas
conformance suite. Pure Python 3 stdlib. Importable by run.py.

Every check speaks HTTP + SSE + the filesystem of the canvas control dir
only. It never reads server source — a check may only depend on things any
conformant server, in any language, exposes per PROTOCOL.md.

Each check function has the signature `fn(ctx: Ctx) -> (status, message)`
where status is PASS, FAIL, or SKIP (SKIP does not count as a failure — see
PROTOCOL.md §3 loopback-bind, which is environment-dependent).
"""
from __future__ import annotations

import json
import re
import socket
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

PASS = "PASS"
FAIL = "FAIL"
SKIP = "SKIP"


@dataclass
class Ctx:
    host: str
    port: int
    canvas_dir: Path
    canvas_file: Path
    ctrl_dir: Path
    status_file: Path
    feedback_file: Path
    mode_file: Path
    marker: str
    server_argv: list
    startup_line: str
    proc: object
    state: dict = field(default_factory=dict)


@dataclass
class Check:
    id: str
    ref: str
    fn: Callable[["Ctx"], tuple]


# ---------------------------------------------------------------------------
# Minimal HTTP/1.1 client (stdlib socket only — no urllib, so we control
# exactly what bytes hit the wire; needed for the traversal check below).
# ---------------------------------------------------------------------------
def http_request(host, port, method, path, headers=None, body=None, timeout=5.0):
    headers = dict(headers or {})
    data = b""
    if body is not None:
        data = body.encode("utf-8") if isinstance(body, str) else body
        headers.setdefault("Content-Length", str(len(data)))
    headers.setdefault("Host", f"{host}:{port}")
    headers.setdefault("Connection", "close")
    req_lines = [f"{method} {path} HTTP/1.1"]
    for k, v in headers.items():
        req_lines.append(f"{k}: {v}")
    req = ("\r\n".join(req_lines) + "\r\n\r\n").encode("utf-8") + data

    sock = socket.create_connection((host, port), timeout=timeout)
    sock.settimeout(timeout)
    try:
        sock.sendall(req)
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf += chunk
        head, _, rest = buf.partition(b"\r\n\r\n")
        head_lines = head.decode("iso-8859-1").split("\r\n")
        status = int(head_lines[0].split(" ", 2)[1])
        resp_headers = {}
        for line in head_lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                resp_headers[k.strip().lower()] = v.strip()

        body_buf = rest
        if resp_headers.get("transfer-encoding", "").lower() == "chunked":
            body_buf = _read_chunked(sock, body_buf, timeout)
        elif "content-length" in resp_headers:
            need = int(resp_headers["content-length"])
            while len(body_buf) < need:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                body_buf += chunk
            body_buf = body_buf[:need]
        else:
            while True:
                try:
                    chunk = sock.recv(65536)
                except socket.timeout:
                    break
                if not chunk:
                    break
                body_buf += chunk
        return status, resp_headers, body_buf
    finally:
        sock.close()


def _read_chunked(sock, initial, timeout):
    buf = initial
    out = b""
    while True:
        while b"\r\n" not in buf:
            chunk = sock.recv(65536)
            if not chunk:
                return out
            buf += chunk
        size_line, _, buf = buf.partition(b"\r\n")
        size = int(size_line.split(b";")[0] or b"0", 16)
        if size == 0:
            return out
        while len(buf) < size + 2:
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf += chunk
        out += buf[:size]
        buf = buf[size + 2:]


def raw_http_get(host, port, raw_path, timeout=5.0):
    """Sends a literal, un-normalized request line — bypasses any client-side
    path normalization so path-traversal payloads reach the server verbatim."""
    sock = socket.create_connection((host, port), timeout=timeout)
    sock.settimeout(timeout)
    try:
        req = f"GET {raw_path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
        sock.sendall(req.encode("iso-8859-1"))
        buf = b""
        while True:
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                break
            if not chunk:
                break
            buf += chunk
        head, _, body = buf.partition(b"\r\n\r\n")
        head_lines = head.decode("iso-8859-1").split("\r\n")
        if not head_lines or not head_lines[0]:
            return 0, {}, b""
        status = int(head_lines[0].split(" ", 2)[1])
        headers = {}
        for line in head_lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        return status, headers, body
    finally:
        sock.close()


class SSEClient:
    """Reads `GET /__canvas/events` as raw text/event-stream frames, each
    terminated by a blank line, per PROTOCOL.md §4."""

    def __init__(self, host, port, path="/__canvas/events", timeout=5.0):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        req = (
            f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
            "Accept: text/event-stream\r\nConnection: keep-alive\r\n\r\n"
        )
        self.sock.sendall(req.encode("utf-8"))
        self.buf = b""
        self._read_headers()

    def _read_headers(self):
        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("connection closed before SSE headers arrived")
            self.buf += chunk
        head, _, rest = self.buf.partition(b"\r\n\r\n")
        self.buf = rest
        self.status_line = head.split(b"\r\n")[0].decode("iso-8859-1")

    def read_event_block(self, timeout=2.0):
        """Returns the next `\\n\\n`-terminated block, or None on timeout/close."""
        deadline = time.time() + timeout
        while b"\n\n" not in self.buf:
            remaining = deadline - time.time()
            if remaining <= 0:
                return None
            self.sock.settimeout(remaining)
            try:
                chunk = self.sock.recv(4096)
            except socket.timeout:
                return None
            if not chunk:
                return None
            self.buf += chunk
        block, _, rest = self.buf.partition(b"\n\n")
        self.buf = rest
        return block.decode("utf-8", errors="replace")

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def parse_sse_block(block):
    result = {"retry": None, "data": None}
    for line in block.split("\n"):
        line = line.rstrip("\r")
        if line.startswith("retry:"):
            try:
                result["retry"] = int(line[len("retry:"):].strip())
            except ValueError:
                pass
        elif line.startswith("data:"):
            payload = line[len("data:"):].strip()
            try:
                result["data"] = json.loads(payload)
            except json.JSONDecodeError:
                result["data"] = None
    return result


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj))


def get_lan_ip():
    """Outward-facing local IP via a UDP 'connect' (no packets sent — just
    asks the kernel which interface/route would be used)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except OSError:
        ip = None
    finally:
        s.close()
    if ip and not ip.startswith("127."):
        return ip
    return None


# ---------------------------------------------------------------------------
# Hand-rolled MINIMAL structural validator — required keys + types + enums
# only. This is NOT a full JSON Schema draft implementation (stdlib has no
# jsonschema); see README.md for scope.
# ---------------------------------------------------------------------------
def _is_number(lo=None, hi=None):
    def f(v):
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            return False, f"expected number, got {type(v).__name__}"
        if lo is not None and v < lo:
            return False, f"{v} < min {lo}"
        if hi is not None and v > hi:
            return False, f"{v} > max {hi}"
        return True, ""
    return f


def _is_bool():
    def f(v):
        return (True, "") if isinstance(v, bool) else (False, f"expected boolean, got {type(v).__name__}")
    return f


def _is_int(lo=None):
    def f(v):
        if not isinstance(v, int) or isinstance(v, bool):
            return False, f"expected integer, got {type(v).__name__}"
        if lo is not None and v < lo:
            return False, f"{v} < min {lo}"
        return True, ""
    return f


def _is_str_or_null():
    def f(v):
        return (True, "") if (v is None or isinstance(v, str)) else (False, f"expected string or null, got {type(v).__name__}")
    return f


def _is_object():
    def f(v):
        return (True, "") if isinstance(v, dict) else (False, f"expected object, got {type(v).__name__}")
    return f


def _is_enum(values):
    def f(v):
        return (True, "") if v in values else (False, f"{v!r} not in {values}")
    return f


def struct_validate(obj, spec):
    if not isinstance(obj, dict):
        return ["root is not a JSON object"]
    errors = []
    for key, check, required in spec:
        if key not in obj:
            if required:
                errors.append(f"missing required key '{key}'")
            continue
        ok, msg = check(obj[key])
        if not ok:
            errors.append(f"key '{key}': {msg}")
    return errors


# schemas/status.schema.json required subset (PROTOCOL.md defers shapes to schemas/)
STATUS_SPEC = [
    ("confidence", _is_number(0, 1), True),
    ("info_gain", _is_number(0, None), True),
    ("ready", _is_bool(), True),
    ("round", _is_int(0), True),
    ("next_question", _is_str_or_null(), True),
    ("decided", _is_object(), True),
]

# schemas/mode.schema.json
MODE_SPEC = [
    ("mode", _is_enum(["live", "hold"]), True),
]

VALID_STATUS = {
    "confidence": 0.42, "info_gain": 0.2, "ready": False, "round": 2,
    "next_question": "layout.density", "decided": {"tone": "calm"},
}


# ---------------------------------------------------------------------------
# Checks. Each maps to a PROTOCOL.md section in its trailing comment.
# ---------------------------------------------------------------------------

def check_launch_missing_file_exit2(ctx):
    # PROTOCOL.md §3 Launch contract: "--file <canvas.html> (required, must
    # exist -> exit 2)". Tested via a --file pointing at a path that does not
    # exist, not via omitting the flag entirely: the reference server
    # resolves an omitted --file to `path.resolve('')` == cwd, and
    # fs.existsSync(cwd) is true (it's a directory), so a fully-omitted flag
    # does not reliably exit 2 on the reference implementation. That's a
    # PROTOCOL.md ambiguity (see README.md "Known ambiguity"), not something
    # this suite can assert without producing a false negative against the
    # reference server itself.
    bogus_path = str(ctx.canvas_file.parent / "does-not-exist.html")
    argv = ctx.server_argv + ["--file", bogus_path]
    try:
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    except Exception as e:
        return FAIL, f"failed to spawn server with a nonexistent --file: {e}"
    try:
        out, _ = proc.communicate(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        return FAIL, "server did not exit promptly when --file points at a nonexistent path (expected exit 2)"
    if proc.returncode != 2:
        return FAIL, f"expected exit code 2 when --file does not exist, got {proc.returncode}; output: {out[:300]!r}"
    return PASS, "--file <nonexistent path> -> exit 2"


def check_launch_startup_prints_url(ctx):
    # PROTOCOL.md §3: "Startup MUST print a line containing http://localhost:<port>"
    if not ctx.startup_line:
        return FAIL, "no startup line captured"
    if not re.search(r"http://localhost:\d+", ctx.startup_line):
        return FAIL, f"startup line does not match http://localhost:<port>: {ctx.startup_line!r}"
    return PASS, f"startup printed {ctx.startup_line.strip()!r}"


def check_loopback_bind_refused(ctx):
    # PROTOCOL.md §3: "Server MUST bind loopback only (127.0.0.1) ... never LAN-exposed"
    lan_ip = get_lan_ip()
    if not lan_ip:
        return SKIP, "NOTE: no non-loopback local address available in this environment; skipping"
    try:
        s = socket.create_connection((lan_ip, ctx.port), timeout=1.5)
        s.close()
        return FAIL, f"server accepted a connection on non-loopback address {lan_ip}:{ctx.port} (must be loopback-only)"
    except (ConnectionRefusedError, socket.timeout, OSError):
        return PASS, f"non-loopback address {lan_ip}:{ctx.port} correctly refused/unreachable"


def check_root_html(ctx):
    # PROTOCOL.md §3: GET / -> 200 text/html
    status, headers, body = http_request(ctx.host, ctx.port, "GET", "/")
    if status != 200:
        return FAIL, f"expected 200, got {status}"
    if "text/html" not in headers.get("content-type", ""):
        return FAIL, f"expected text/html content-type, got {headers.get('content-type')!r}"
    return PASS, "GET / -> 200 text/html"


def check_canvas_file_verbatim(ctx):
    # PROTOCOL.md §3: GET /__canvas/file -> 200, canvas HTML verbatim
    status, headers, body = http_request(ctx.host, ctx.port, "GET", "/__canvas/file")
    if status != 200:
        return FAIL, f"expected 200, got {status}"
    if ctx.marker.encode() not in body:
        return FAIL, f"marker {ctx.marker!r} not found in served canvas body"
    expected = ctx.canvas_file.read_bytes()
    if body != expected:
        return FAIL, "served body does not match the canvas file on disk verbatim"
    ctx.state["canvas_body_snapshot"] = body
    return PASS, "canvas file served verbatim with seeded marker present"


def check_canvas_file_ignores_query(ctx):
    # PROTOCOL.md §3: "MUST ignore unknown query params (client cache-busts with ?t=)"
    base = ctx.state.get("canvas_body_snapshot")
    if base is None:
        _, _, base = http_request(ctx.host, ctx.port, "GET", "/__canvas/file")
    status, _, body = http_request(ctx.host, ctx.port, "GET", "/__canvas/file?t=123456")
    if status != 200:
        return FAIL, f"expected 200 with unknown query param, got {status}"
    if body != base:
        return FAIL, "unknown query param changed the served body"
    return PASS, "unknown query params ignored; body unchanged (still 200)"


def check_status_missing_returns_empty(ctx):
    # PROTOCOL.md §3: GET /__canvas/status -> {} when status.json absent
    if ctx.status_file.exists():
        ctx.status_file.unlink()
    status, headers, body = http_request(ctx.host, ctx.port, "GET", "/__canvas/status")
    if status != 200:
        return FAIL, f"expected 200 when status.json absent, got {status}"
    if "application/json" not in headers.get("content-type", ""):
        return FAIL, f"expected application/json content-type, got {headers.get('content-type')!r}"
    try:
        obj = json.loads(body)
    except Exception as e:
        return FAIL, f"body not valid JSON: {e}"
    if obj != {}:
        return FAIL, f"expected {{}} when status.json absent, got {obj}"
    return PASS, "GET /__canvas/status -> 200 {} when file absent"


def check_status_reflects_written(ctx):
    # PROTOCOL.md §3: "200 application/json — status.json or {}"
    write_json(ctx.status_file, VALID_STATUS)
    time.sleep(0.05)
    status, _, body = http_request(ctx.host, ctx.port, "GET", "/__canvas/status")
    if status != 200:
        return FAIL, f"expected 200, got {status}"
    try:
        obj = json.loads(body)
    except Exception as e:
        return FAIL, f"body not valid JSON: {e}"
    if obj != VALID_STATUS:
        return FAIL, f"served status.json != written object: {obj} != {VALID_STATUS}"
    return PASS, "GET /__canvas/status reflects the written object verbatim"


def check_status_schema_structural(ctx):
    # schemas/status.schema.json — required keys + types (structural subset)
    status, _, body = http_request(ctx.host, ctx.port, "GET", "/__canvas/status")
    try:
        obj = json.loads(body)
    except Exception as e:
        return FAIL, f"body not valid JSON: {e}"
    errors = struct_validate(obj, STATUS_SPEC)
    if errors:
        return FAIL, "; ".join(errors)
    return PASS, "status.json satisfies the structural subset of schemas/status.schema.json"


def check_status_corrupt_no_crash(ctx):
    # PROTOCOL.md §3: "MUST NOT 404/500 on missing/corrupt file"
    ctx.status_file.write_text("{ this is not valid json ]]]")
    status, _, body = http_request(ctx.host, ctx.port, "GET", "/__canvas/status")
    if status in (404, 500):
        return FAIL, f"server returned {status} on corrupt status.json (MUST NOT 404/500)"
    if status != 200:
        return FAIL, f"expected 200 on corrupt status.json, got {status}"
    try:
        json.loads(body)
    except Exception as e:
        return FAIL, f"200 response body is not valid JSON on corrupt status.json: {e}"
    return PASS, "corrupt status.json handled gracefully (200, valid JSON fallback)"


def check_mode_default_live(ctx):
    # PROTOCOL.md §3: GET /__canvas/mode -> 200 {"mode":"live"} fallback
    status, _, body = http_request(ctx.host, ctx.port, "GET", "/__canvas/mode")
    if status != 200:
        return FAIL, f"expected 200, got {status}"
    try:
        obj = json.loads(body)
    except Exception as e:
        return FAIL, f"body not valid JSON: {e}"
    if obj.get("mode") != "live":
        return FAIL, f"expected default mode 'live', got {obj}"
    return PASS, "GET /__canvas/mode -> {'mode':'live'} by default"


def check_mode_schema_structural(ctx):
    # schemas/mode.schema.json
    _, _, body = http_request(ctx.host, ctx.port, "GET", "/__canvas/mode")
    try:
        obj = json.loads(body)
    except Exception as e:
        return FAIL, f"body not valid JSON: {e}"
    errors = struct_validate(obj, MODE_SPEC)
    if errors:
        return FAIL, "; ".join(errors)
    return PASS, "mode.json satisfies the structural subset of schemas/mode.schema.json"


def check_feedback_valid_ok_id(ctx):
    # PROTOCOL.md §5.6: respond 200 {"ok":true,"id":"<id>"}
    status, _, body = http_request(
        ctx.host, ctx.port, "POST", "/__canvas/feedback",
        headers={"Content-Type": "application/json"},
        body=json.dumps({"kind": "comment", "text": "conformance check"}),
    )
    if status != 200:
        return FAIL, f"expected 200, got {status}: {body[:200]!r}"
    try:
        obj = json.loads(body)
    except Exception as e:
        return FAIL, f"response not valid JSON: {e}"
    if obj.get("ok") is not True or not obj.get("id"):
        return FAIL, f"expected {{ok:true,id:...}}, got {obj}"
    return PASS, f"200 {{ok:true,id:{obj['id']}}}"


def check_feedback_row_appended_ts_id(ctx):
    # PROTOCOL.md §5.4-5.5: stamp ts + unique id; append exactly one line
    before = ctx.feedback_file.read_text().count("\n") if ctx.feedback_file.exists() else 0
    status, _, body = http_request(
        ctx.host, ctx.port, "POST", "/__canvas/feedback",
        headers={"Content-Type": "application/json"},
        body=json.dumps({"kind": "comment", "text": "row-appended-check"}),
    )
    if status != 200:
        return FAIL, f"POST failed: {status}"
    resp = json.loads(body)
    time.sleep(0.05)
    lines = [l for l in ctx.feedback_file.read_text().split("\n") if l.strip()]
    if len(lines) != before + 1:
        return FAIL, f"expected exactly one new line appended, before={before} after={len(lines)}"
    last = json.loads(lines[-1])
    if last.get("id") != resp["id"]:
        return FAIL, "appended row id does not match the POST response id"
    if not re.match(r"^fb-\d+-\d+$", last.get("id", "")):
        return FAIL, f"id does not match fb-<epoch-ms>-<seq>: {last.get('id')}"
    if "ts" not in last:
        return FAIL, "row missing server-stamped ts"
    try:
        datetime.fromisoformat(last["ts"].replace("Z", "+00:00"))
    except Exception as e:
        return FAIL, f"ts not ISO-8601 parseable: {last['ts']!r} ({e})"
    return PASS, f"row appended with ts={last['ts']} id={last['id']}"


def check_feedback_bad_json_400(ctx):
    # PROTOCOL.md §5.1: reject unparsable JSON with 400
    status, _, body = http_request(
        ctx.host, ctx.port, "POST", "/__canvas/feedback",
        headers={"Content-Type": "application/json"},
        body=b"{not valid json!!",
    )
    if status != 400:
        return FAIL, f"expected 400 for unparsable JSON, got {status}: {body[:200]!r}"
    return PASS, "unparsable JSON body rejected with 400"


def check_feedback_toggle_updates_mode(ctx):
    # PROTOCOL.md §5.3: "for a toggle row, rewrite mode.json before appending"
    _, _, before_body = http_request(ctx.host, ctx.port, "GET", "/__canvas/mode")
    before_mode = json.loads(before_body).get("mode")
    target = "hold" if before_mode != "hold" else "live"
    status, _, _ = http_request(
        ctx.host, ctx.port, "POST", "/__canvas/feedback",
        headers={"Content-Type": "application/json"},
        body=json.dumps({"kind": "toggle", "mode": target}),
    )
    if status != 200:
        return FAIL, f"toggle POST failed: {status}"
    time.sleep(0.05)
    _, _, after_body = http_request(ctx.host, ctx.port, "GET", "/__canvas/mode")
    after_mode = json.loads(after_body).get("mode")
    if after_mode != target:
        return FAIL, f"mode.json not updated by toggle row: expected {target}, got {after_mode}"
    if not ctx.mode_file.exists():
        return FAIL, "mode.json does not exist on disk after toggle"
    on_disk = json.loads(ctx.mode_file.read_text()).get("mode")
    if on_disk != target:
        return FAIL, f"mode.json on-disk content not updated: {on_disk}"
    return PASS, f"toggle feedback row -> mode.json updated to {target!r}"


def check_feedback_ids_unique(ctx):
    # PROTOCOL.md §5.4: id unique per row
    ids = []
    for i in range(5):
        status, _, body = http_request(
            ctx.host, ctx.port, "POST", "/__canvas/feedback",
            headers={"Content-Type": "application/json"},
            body=json.dumps({"kind": "comment", "text": f"uniq-{i}"}),
        )
        if status != 200:
            return FAIL, f"POST #{i} failed: {status}"
        ids.append(json.loads(body)["id"])
    if len(set(ids)) != len(ids):
        return FAIL, f"duplicate ids across posts: {ids}"
    return PASS, f"{len(ids)} posts produced {len(set(ids))} unique ids"


def check_sse_retry_then_hello(ctx):
    # PROTOCOL.md §4: "On connect: send retry: 1000 then a hello frame"
    sse = SSEClient(ctx.host, ctx.port)
    try:
        b1 = sse.read_event_block(timeout=3)
        if b1 is None:
            return FAIL, "no data received after connect (expected a retry: line)"
        f1 = parse_sse_block(b1)
        if f1["retry"] is None:
            return FAIL, f"first frame missing 'retry:' directive: {b1!r}"
        b2 = sse.read_event_block(timeout=3)
        if b2 is None:
            return FAIL, "no hello frame received after the retry line"
        f2 = parse_sse_block(b2)
        if not f2["data"] or f2["data"].get("type") != "hello":
            return FAIL, f"expected a hello frame, got {b2!r}"
        return PASS, "retry: directive then {type:hello} frame received on connect"
    finally:
        sse.close()


def check_sse_reload_on_canvas_change(ctx):
    # PROTOCOL.md §4: canvas mtime change -> reload frame within ~1s (poll <=500ms)
    sse = SSEClient(ctx.host, ctx.port)
    try:
        sse.read_event_block(timeout=3)  # retry
        sse.read_event_block(timeout=3)  # hello
        new_content = ctx.canvas_file.read_text() + f"\n<!-- change-{uuid.uuid4().hex[:6]} -->"
        ctx.canvas_file.write_text(new_content)
        block = sse.read_event_block(timeout=2.0)
        if block is None:
            return FAIL, "no SSE frame within 2s of editing the canvas file (expected reload)"
        frame = parse_sse_block(block)
        if not frame["data"] or frame["data"].get("type") != "reload":
            return FAIL, f"expected a reload frame, got {block!r}"
        if "mtime" not in frame["data"]:
            return FAIL, "reload frame missing 'mtime' field"
        return PASS, "reload frame fired within 2s of a canvas file edit"
    finally:
        sse.close()


def check_sse_reload_on_same_size_rewrite(ctx):
    # PROTOCOL.md §4 Watch (normative): "MUST still deliver reload for a
    # same-size rewrite (compare mtime or content hash, never size)"
    sse = SSEClient(ctx.host, ctx.port)
    try:
        sse.read_event_block(timeout=3)
        sse.read_event_block(timeout=3)
        original = ctx.canvas_file.read_text()
        if "<!--z-->" not in original:
            return FAIL, "test fixture missing the same-size marker comment <!--z-->"
        mutated = original.replace("<!--z-->", "<!--q-->", 1)
        if len(mutated) != len(original):
            return FAIL, "test harness bug: same-size rewrite changed length"
        ctx.canvas_file.write_text(mutated)
        block = sse.read_event_block(timeout=2.0)
        if block is None:
            return FAIL, "no reload frame for a same-size content change (server likely compares by size)"
        frame = parse_sse_block(block)
        if not frame["data"] or frame["data"].get("type") != "reload":
            return FAIL, f"expected a reload frame for a same-size rewrite, got {block!r}"
        return PASS, "reload fired for a same-size (different content) canvas rewrite"
    finally:
        sse.close()


def check_sse_status_on_status_change(ctx):
    # PROTOCOL.md §4: status.json mtime change -> status frame
    sse = SSEClient(ctx.host, ctx.port)
    try:
        sse.read_event_block(timeout=3)
        sse.read_event_block(timeout=3)
        write_json(ctx.status_file, dict(VALID_STATUS, round=VALID_STATUS["round"] + 1))
        block = sse.read_event_block(timeout=2.0)
        if block is None:
            return FAIL, "no SSE frame within 2s of editing status.json (expected status)"
        frame = parse_sse_block(block)
        if not frame["data"] or frame["data"].get("type") != "status":
            return FAIL, f"expected a status frame, got {block!r}"
        return PASS, "status frame fired within 2s of a status.json edit"
    finally:
        sse.close()


def check_static_asset_mime(ctx):
    # PROTOCOL.md §3: GET /<asset> -> 200 sibling asset, correct MIME
    asset = ctx.canvas_dir / "sibling.css"
    asset.write_text("body{color:red}")
    status, headers, body = http_request(ctx.host, ctx.port, "GET", "/sibling.css")
    if status != 200:
        return FAIL, f"expected 200 for sibling asset, got {status}"
    ct = headers.get("content-type", "")
    if "css" not in ct:
        return FAIL, f"expected a CSS content-type, got {ct!r}"
    if b"color:red" not in body:
        return FAIL, "sibling asset body did not match what was written to disk"
    return PASS, "sibling static asset served with correct MIME"


def check_static_traversal_blocked(ctx):
    # PROTOCOL.md §3: "Traversal guard: resolved path MUST stay within <dir>"
    outside_marker = f"TRAVERSAL-PROBE-{uuid.uuid4().hex[:8]}"
    outside_file = ctx.canvas_dir.parent / "outside-secret.txt"
    outside_file.write_text(outside_marker)
    try:
        candidates = ["/../outside-secret.txt", "/..%2foutside-secret.txt", "/%2e%2e/outside-secret.txt"]
        for path in candidates:
            status, _, body = raw_http_get(ctx.host, ctx.port, path)
            if status == 200 and outside_marker.encode() in body:
                return FAIL, f"path traversal succeeded via {path!r} — escaped <dir>"
            if status not in (403, 404):
                return FAIL, f"traversal attempt {path!r} returned unexpected status {status} (want 403 or 404)"
        return PASS, "path-traversal attempts blocked (403/404), never escaped <dir>"
    finally:
        outside_file.unlink(missing_ok=True)


def check_decision_badges_accessible(ctx):
    status, _, body = http_request(ctx.host, ctx.port, "GET", "/")
    if status != 200:
        return FAIL, f"expected rail 200, got {status}"
    text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else body
    required = ["id=\"decisionBadges\"", "Decision status", "aria-label", "decision-badge", "decisions carried forward"]
    missing = [item for item in required if item not in text]
    if missing:
        return FAIL, f"decision badge accessibility contract missing: {missing}"
    if "rigidity-locked" not in text or "rigidity-leaning" not in text:
        return FAIL, "rigidity states are not distinguished without color"
    return PASS, "decision badges carry visible text, accessible names, and non-color distinctions"


CHECKS = [
    Check("launch_missing_file_exit2", "PROTOCOL.md §3 (Launch contract)", check_launch_missing_file_exit2),
    Check("launch_startup_prints_url", "PROTOCOL.md §3 (Launch contract)", check_launch_startup_prints_url),
    Check("loopback_bind_refused", "PROTOCOL.md §3 (loopback only)", check_loopback_bind_refused),
    Check("root_html", "PROTOCOL.md §3 (GET /)", check_root_html),
    Check("canvas_file_verbatim", "PROTOCOL.md §3 (GET /__canvas/file)", check_canvas_file_verbatim),
    Check("canvas_file_ignores_query", "PROTOCOL.md §3 (GET /__canvas/file)", check_canvas_file_ignores_query),
    Check("status_missing_returns_empty", "PROTOCOL.md §3 (GET /__canvas/status)", check_status_missing_returns_empty),
    Check("status_reflects_written", "PROTOCOL.md §3 (GET /__canvas/status)", check_status_reflects_written),
    Check("status_schema_structural", "schemas/status.schema.json", check_status_schema_structural),
    Check("status_corrupt_no_crash", "PROTOCOL.md §3 (GET /__canvas/status)", check_status_corrupt_no_crash),
    Check("mode_default_live", "PROTOCOL.md §3 (GET /__canvas/mode)", check_mode_default_live),
    Check("mode_schema_structural", "schemas/mode.schema.json", check_mode_schema_structural),
    Check("feedback_valid_ok_id", "PROTOCOL.md §5.6", check_feedback_valid_ok_id),
    Check("feedback_row_appended_ts_id", "PROTOCOL.md §5.4-5.5", check_feedback_row_appended_ts_id),
    Check("feedback_bad_json_400", "PROTOCOL.md §5.1", check_feedback_bad_json_400),
    Check("feedback_toggle_updates_mode", "PROTOCOL.md §5.3", check_feedback_toggle_updates_mode),
    Check("feedback_ids_unique", "PROTOCOL.md §5.4", check_feedback_ids_unique),
    Check("sse_retry_then_hello", "PROTOCOL.md §4", check_sse_retry_then_hello),
    Check("sse_reload_on_canvas_change", "PROTOCOL.md §4", check_sse_reload_on_canvas_change),
    Check("sse_reload_on_same_size_rewrite", "PROTOCOL.md §4 (Watch, normative)", check_sse_reload_on_same_size_rewrite),
    Check("sse_status_on_status_change", "PROTOCOL.md §4", check_sse_status_on_status_change),
    Check("static_asset_mime", "PROTOCOL.md §3 (GET /<asset>)", check_static_asset_mime),
    Check("static_traversal_blocked", "PROTOCOL.md §3 (traversal guard)", check_static_traversal_blocked),
    Check("decision_badges_accessible", "PROTOCOL.md (Decision metadata badges)", check_decision_badges_accessible),
]
