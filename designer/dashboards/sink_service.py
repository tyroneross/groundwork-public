#!/usr/bin/env python3
"""Durable append-only JSONL sink for Dashboard Builder responses.

Two transports over ONE request dispatcher, so both are tested by the same tests:
  http  — `sink_service.py --ledger L --port 3847`      (normal use)
  stdio — `sink_service.py --ledger L --stdio`          (one JSON envelope per line)

stdio exists because a socket bind is not always available: sandboxed agent runtimes
and some local-model harnesses forbid it. Same dispatcher, so an agent that can only
pipe stdin gets identical semantics.

Routes
  GET  /health                      -> {"ok":true,...}
  GET  /events?contract_id=<id>     -> [event, ...]
  POST /events                      -> 201 stored | 200 duplicate (Idempotency-Key)
"""
import argparse, json, os, sys
from datetime import datetime, timezone
from http import HTTPStatus

REQUIRED = ("contract_id", "option_id", "response")

# The sink binds loopback only, so a wildcard CORS origin buys nothing and widens
# exposure if the host is ever bound elsewhere. Echo back only loopback origins.
ALLOWED_ORIGIN_RE = __import__("re").compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")


def allowed_origin(origin):
    """Return the origin to echo in Access-Control-Allow-Origin, or None to omit it."""
    return origin if origin and ALLOWED_ORIGIN_RE.match(origin) else None
OPTIONAL = ("comment", "timestamp", "event_id")


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def valid_timestamp(v):
    try:
        datetime.fromisoformat(str(v).replace("Z", "+00:00"));  return True
    except ValueError:
        return False


class Sink:
    def __init__(self, ledger):
        self.ledger = os.path.abspath(ledger)

    def _read(self):
        if not os.path.exists(self.ledger):
            return []
        out = []
        with open(self.ledger, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))   # a malformed line must not
                except json.JSONDecodeError:       # make the whole ledger unreadable
                    continue
        return out

    def events(self, contract_id=None):
        rows = self._read()
        return [r for r in rows if contract_id is None or r.get("contract_id") == contract_id]

    def append_idempotently(self, event):
        """Return True if written, False if an event with this event_id already exists."""
        eid = event.get("event_id")
        if eid and any(r.get("event_id") == eid for r in self._read()):
            return False
        os.makedirs(os.path.dirname(self.ledger) or ".", exist_ok=True)
        with open(self.ledger, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
        return True


def dispatch(sink, method, path, query, body, headers):
    """The single request dispatcher. Both transports call exactly this."""
    if method == "GET" and path == "/health":
        return HTTPStatus.OK, {"ok": True, "ledger": sink.ledger}
    if method == "GET" and path == "/events":
        return HTTPStatus.OK, sink.events(query.get("contract_id"))
    if method != "POST" or path != "/events":
        return HTTPStatus.NOT_FOUND, {"error": "not found"}
    try:
        if not body or len(body) > 100_000:
            raise ValueError("request body must be between 1 and 100000 bytes")
        ev = json.loads(body)
        if not isinstance(ev, dict):
            raise ValueError("event must be a JSON object")
        missing = [k for k in REQUIRED if not str(ev.get(k, "")).strip()]
        if missing:
            raise ValueError(f"missing or empty: {', '.join(missing)}")
        for k in REQUIRED + OPTIONAL:
            if k in ev and not isinstance(ev[k], str):
                raise ValueError(f"{k} must be a string")
        ev.setdefault("comment", "")
        ev["timestamp"] = ev.get("timestamp") or utcnow()
        if not valid_timestamp(ev["timestamp"]):
            raise ValueError("timestamp must be ISO-8601")
        key = headers.get("Idempotency-Key") or headers.get("idempotency-key")
        if key:
            ev["event_id"] = key
        stored = sink.append_idempotently(ev)
        return (HTTPStatus.CREATED if stored else HTTPStatus.OK), {"stored": stored, "event": ev}
    except (ValueError, json.JSONDecodeError) as e:
        return HTTPStatus.BAD_REQUEST, {"error": str(e)}


def serve_http(sink, host, port):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from urllib.parse import urlparse, parse_qs

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _cors(self):
            o = allowed_origin(self.headers.get("Origin"))
            if o:
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")

        def _reply(self, status, payload):
            b = json.dumps(payload).encode()
            self.send_response(int(status))
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self._cors()
            self.end_headers()
            self.wfile.write(b)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()

        def _go(self, method):
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n).decode("utf-8") if n else ""
            st, payload = dispatch(sink, method, u.path, q, body, dict(self.headers))
            self._reply(st, payload)

        def do_GET(self):
            self._go("GET")

        def do_POST(self):
            self._go("POST")

    srv = ThreadingHTTPServer((host, port), H)
    print(f"sink listening on http://{host}:{port}/events -> {sink.ledger}", flush=True)
    srv.serve_forever()


def serve_stdio(sink):
    """One JSON envelope per stdin line: {method, path, query, body, headers}."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            env = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"status": 400, "body": {"error": "bad envelope"}}), flush=True)
            continue
        st, payload = dispatch(
            sink, env.get("method", "GET"), env.get("path", "/health"),
            env.get("query") or {},
            env.get("body") if isinstance(env.get("body"), str) else json.dumps(env.get("body") or {}),
            env.get("headers") or {})
        print(json.dumps({"status": int(st), "body": payload}), flush=True)


def main():
    ap = argparse.ArgumentParser(description="Dashboard Builder durable JSONL sink")
    ap.add_argument("--ledger", required=True, help="append-only JSONL event file")
    ap.add_argument("--stdio", action="store_true", help="one JSON envelope per stdin line")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=3847)
    a = ap.parse_args()
    sink = Sink(a.ledger)
    if a.stdio:
        serve_stdio(sink)
    else:
        serve_http(sink, a.host, a.port)


if __name__ == "__main__":
    main()
