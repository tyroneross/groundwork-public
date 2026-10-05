#!/usr/bin/env python3
"""Acceptance suite: T1-T5 from the frozen v1 spec, on BOTH transports,
plus P1/P2 -- the out-of-spec probes that each caught a real defect in the
Claude-vs-Codex bake-off. Exits non-zero if anything fails."""
import json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD, SINK = ROOT / "dashboard_build.py", ROOT / "sink_service.py"
EXAMPLE = ROOT / "examples" / "decision-canonical-home.json"
PY = sys.executable
passed = failed = 0


def ok(n, d=""):
    global passed; passed += 1; print(f"  PASS  {n}" + (f" — {d}" if d else ""))


def no(n, d=""):
    global failed; failed += 1; print(f"  FAIL  {n}" + (f" — {d}" if d else ""))


def build(contract, out, *extra):
    return subprocess.run([PY, str(BUILD), "build", str(contract), "--out", str(out), *extra],
                          capture_output=True, text=True)


def stdio(ledger, method, path, body=None, headers=None, query=None):
    env = {"method": method, "path": path, "query": query or {},
           "body": json.dumps(body) if body is not None else "", "headers": headers or {}}
    r = subprocess.run([PY, str(SINK), "--stdio", "--ledger", str(ledger)],
                       input=json.dumps(env) + "\n", capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return json.loads(r.stdout.strip().splitlines()[-1])


def http(port, method, path, body=None, headers=None):
    url = f"http://127.0.0.1:{port}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def main():
    work = Path(tempfile.mkdtemp(prefix="dash-acceptance-"))
    contract = json.loads(EXAMPLE.read_text())

    print("T1  build a valid contract")
    out = work / "out.html"
    r = build(EXAMPLE, out)
    ok("exit 0, HTML produced") if r.returncode == 0 and out.exists() and out.stat().st_size > 0 \
        else no("build valid", r.stderr.strip()[:90])

    print("T2  invalid contract (options removed)")
    bad = work / "bad.json"; c = dict(contract); c.pop("options")
    bad.write_text(json.dumps(c)); t2 = work / "t2.html"
    r = build(bad, t2)
    ok(f"exit {r.returncode}, readable error, no HTML written") \
        if r.returncode != 0 and not t2.exists() and "options" in r.stderr \
        else no("reject invalid", f"rc={r.returncode} html={t2.exists()}")

    print("T5  refuse-without-sink")
    ns = work / "nosink.json"; c = dict(contract); c.pop("sink", None)
    ns.write_text(json.dumps(c)); t5 = work / "t5.html"
    r = build(ns, t5)
    ok(f"build failed loudly (rc={r.returncode})") if r.returncode != 0 and not t5.exists() \
        else no("refuse without sink", f"rc={r.returncode}")

    ev = {"contract_id": "c1", "option_id": "groundwork-lane",
          "response": "selected", "comment": "ships sooner"}

    for name, call, setup in (("stdio", "stdio", None), ("http", "http", "server")):
        print(f"T3  capture round-trip [{name}]")
        led = work / f"{name}.jsonl"
        proc = None
        if setup:
            port = 3931
            proc = subprocess.Popen([PY, str(SINK), "--ledger", str(led), "--port", str(port)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(50):
                try:
                    if http(port, "GET", "/health")[0] == 200: break
                except Exception: time.sleep(0.1)
        try:
            send = (lambda b, h=None: stdio(led, "POST", "/events", b, h)) if not setup \
                else (lambda b, h=None: (lambda t: {"status": t[0], "body": t[1]})(http(port, "POST", "/events", b, h)))
            read = (lambda: stdio(led, "GET", "/events", None, None, {"contract_id": "c1"})) if not setup \
                else (lambda: (lambda t: {"status": t[0], "body": t[1]})(http(port, "GET", "/events?contract_id=c1")))

            res = send(ev, {"Idempotency-Key": "k-1"})
            lines = led.read_text().strip().splitlines() if led.exists() else []
            ok("POST 201, ledger gained exactly 1 well-formed line") \
                if res["status"] == 201 and len(lines) == 1 and json.loads(lines[0]) \
                else no(f"capture [{name}]", f"status={res['status']} lines={len(lines)}")

            print(f"T4  re-read after reload [{name}]  (DECISIVE)")
            got = read()
            rows = got["body"]
            ok("prior response survives and is re-served") \
                if got["status"] == 200 and len(rows) == 1 and rows[0]["option_id"] == "groundwork-lane" \
                else no(f"re-read [{name}]", f"rows={rows}")

            print(f"P2  double-submit is deduped [{name}]  (probe: real bug in one bake-off entry)")
            send(ev, {"Idempotency-Key": "k-1"}); send(ev, {"Idempotency-Key": "k-1"})
            n = len(led.read_text().strip().splitlines())
            ok("3 identical POSTs -> 1 ledger row") if n == 1 else no(f"idempotency [{name}]", f"rows={n}")
        finally:
            if proc: proc.terminate(); proc.wait(timeout=5)

    print("P1  emitted page refuses input when the sink is unreachable  (probe)")
    html = out.read_text()
    ok("page probes /health and disables submit before accepting input") \
        if "/health" in html and "submit.disabled = true" in html \
        else no("sink-down guard", "no health probe in emitted page")

    print(f"\n  {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
