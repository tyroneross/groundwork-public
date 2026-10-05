#!/usr/bin/env python3
"""Dashboard Builder v1 emitter — archetype A1 (decision surface).

Host-agnostic by construction: stdlib only, plain CLI. Runs identically under
Claude Code, Cursor, or a local model via the RossLabs agent harness.

  dashboard_build.py build <contract.json> --out <file.html> [--no-sink]

The durable sink is a separate program: see sink_service.py (http and stdio).
"""
import argparse, html, json, os, re, sys

SCHEMA_VERSION = "1.0.0"
CAPTURE_ARCHETYPES = {"A1"}
ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')


def die(msg, code=2):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def validate(c):
    """Return list of human-readable errors. Empty list == valid."""
    e = []
    if c.get("schema_version") != SCHEMA_VERSION:
        e.append(f"schema_version must be {SCHEMA_VERSION!r}, got {c.get('schema_version')!r}")
    if not ID_RE.match(str(c.get("id", ""))):
        e.append("id must match ^[a-z0-9][a-z0-9-]*$")
    if c.get("archetype") not in ("A1",):
        e.append(f"archetype must be A1, got {c.get('archetype')!r}")
    if not str(c.get("decision", "")).strip():
        e.append("decision is required and must be non-empty")
    opts = c.get("options")
    if not isinstance(opts, list) or len(opts) < 2:
        e.append("options is required and needs at least 2 entries")
    else:
        seen = set()
        for i, o in enumerate(opts):
            if not isinstance(o, dict):
                e.append(f"options[{i}] must be an object"); continue
            oid = o.get("id", "")
            if not ID_RE.match(str(oid)):
                e.append(f"options[{i}].id must match ^[a-z0-9][a-z0-9-]*$")
            if oid in seen:
                e.append(f"options[{i}].id {oid!r} is duplicated")
            seen.add(oid)
            if not str(o.get("label", "")).strip():
                e.append(f"options[{i}].label is required")
        rec = c.get("recommendation")
        if rec is not None and rec not in seen:
            e.append(f"recommendation {rec!r} is not one of the option ids")
    st = c.get("status", "proposed")
    if st not in ("proposed", "accepted", "superseded", "deferred"):
        e.append(f"status {st!r} is invalid")
    return e


# --- R8: contrast tokens chosen to meet WCAG 2.2 1.4.3 (>=4.5:1 body) in both themes.
# --- R8: controls get min-height 44px (Apple HIG, stricter than WCAG 2.5.8's 24px).
CSS = """
:root{--bg:#fbfbfa;--fg:#1a1a18;--muted:#5c5c56;--line:#e0e0da;--card:#fff;
--accent:#1f5c4a;--warn-bg:#fff4e5;--warn-fg:#7a4a00;--warn-line:#e0b070;--rec:#e8f2ee}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--bg:#16171a;--fg:#ececea;--muted:#a0a09a;--line:#2e3035;--card:#1d1f23;
--accent:#7fd7bb;--warn-bg:#3a2c14;--warn-fg:#f0c98a;--warn-line:#7a5a20;--rec:#1e3b33}}
:root[data-theme="dark"]{--bg:#16171a;--fg:#ececea;--muted:#a0a09a;--line:#2e3035;
--card:#1d1f23;--accent:#7fd7bb;--warn-bg:#3a2c14;--warn-fg:#f0c98a;--warn-line:#7a5a20;--rec:#1e3b33}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);margin:0;
font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:22px;line-height:1.3;margin:0 0 4px}
.meta{color:var(--muted);font-size:13px;margin:0 0 24px}
.context{border:1px solid var(--line);border-radius:10px;background:var(--card);
padding:16px 18px;margin:0 0 28px}
.context h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;
color:var(--muted);margin:0 0 8px;font-weight:600}
fieldset{border:1px solid var(--line);border-radius:10px;background:var(--card);
padding:8px 0 4px;margin:0 0 24px}
legend{font-size:13px;text-transform:uppercase;letter-spacing:.06em;
color:var(--muted);padding:0 10px;font-weight:600}
.opt{display:flex;gap:12px;align-items:flex-start;padding:14px 18px;
border-top:1px solid var(--line);min-height:44px;cursor:pointer}
.opt:first-of-type{border-top:none}
.opt input{margin-top:3px;width:18px;height:18px;flex:none;accent-color:var(--accent)}
.opt.rec{background:var(--rec)}
.opt .label{font-weight:600}
.opt .detail{color:var(--muted);font-size:13.5px;margin-top:3px}
.opt ul{margin:6px 0 0;padding-left:18px;color:var(--muted);font-size:13px}
.tag{font-size:11px;font-weight:700;color:var(--accent);letter-spacing:.05em;
text-transform:uppercase;margin-left:8px}
textarea{width:100%;min-height:88px;padding:10px 12px;border:1px solid var(--line);
border-radius:8px;background:var(--card);color:var(--fg);font:inherit;resize:vertical}
button{min-height:44px;padding:0 20px;border-radius:8px;border:1px solid var(--accent);
background:var(--accent);color:var(--bg);font:inherit;font-weight:600;cursor:pointer}
button:disabled{opacity:.5;cursor:not-allowed}
.banner{border:1px solid var(--warn-line);background:var(--warn-bg);color:var(--warn-fg);
border-radius:10px;padding:14px 16px;margin:0 0 24px;font-size:14px}
.banner strong{display:block;margin-bottom:3px}
.prior{border:1px solid var(--line);border-radius:10px;background:var(--card);
padding:4px 0;margin:26px 0 0}
.prior h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;
color:var(--muted);margin:0;padding:14px 18px 8px;font-weight:600}
.prior li{list-style:none;border-top:1px solid var(--line);padding:13px 18px}
.prior ul{margin:0;padding:0}
.prior .who{font-size:12px;color:var(--muted);margin-top:4px}
.empty{color:var(--muted);padding:0 18px 14px;font-size:13.5px}
"""

def esc(x):
    return html.escape(str(x if x is not None else ""), quote=True)


def render(c, sink, no_sink):
    opts = c["options"]
    rec = c.get("recommendation")
    rows = []
    for o in opts:
        is_rec = (o.get("id") == rec)
        tl = "".join(f"<li>{esc(t)}</li>" for t in (o.get("tradeoffs") or []))
        rows.append(
            f'<label class="opt{" rec" if is_rec else ""}">'
            f'<input type="radio" name="option" value="{esc(o["id"])}">'
            f'<span><span class="label">{esc(o["label"])}'
            + ('<span class="tag">recommended</span>' if is_rec else '')
            + '</span>'
            + (f'<span class="detail">{esc(o.get("detail"))}</span>' if o.get("detail") else '')
            + (f'<ul>{tl}</ul>' if tl else '')
            + '</span></label>')

    # R7: the page states its own mode, honestly, in the markup.
    if no_sink:
        banner = ('<div class="banner"><strong>Responses are NOT saved.</strong>'
                  'This page was built with --no-sink. Anything entered here is discarded '
                  'on reload and never reaches an agent.</div>')
    else:
        banner = '<div class="banner" id="sink-banner" hidden></div>'

    cfg = json.dumps({"id": c["id"], "sink": (None if no_sink else sink)})
    ctx = (f'<div class="context"><h2>Context</h2><div>{esc(c.get("context"))}</div></div>'
           if c.get("context") else '')

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(c.get("title") or c["decision"])}</title>
<style>{CSS}</style></head><body><div class="wrap">
<h1>{esc(c["decision"])}</h1>
<p class="meta">{esc(c["id"])} · status: {esc(c.get("status","proposed"))} · archetype A1</p>
{banner}{ctx}
<form id="f"><fieldset><legend>Options</legend>{''.join(rows)}</fieldset>
<label for="comment" style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px">
Comment (optional)</label>
<textarea id="comment" placeholder="Why this option? What would change your mind?"></textarea>
<p style="margin:14px 0 0"><button id="submit" type="submit">Record decision</button></p>
</form>
<section class="prior"><h2>Previous responses</h2>
<div id="prior-empty" class="empty">Loading…</div><ul id="prior"></ul></section>
</div>
<script>
const CFG = {cfg};
const $ = s => document.querySelector(s);
const banner = $('#sink-banner'), submit = $('#submit');
function warn(msg) {{
  if (!banner) return;
  banner.innerHTML = '<strong>Responses cannot be saved right now.</strong>' + msg;
  banner.hidden = false;
}}
function url(p) {{ return CFG.sink.base.replace(/\\/$/,'') + p; }}

// R9-shaped behaviour: prove the sink is reachable BEFORE offering to capture.
async function checkSink() {{
  if (!CFG.sink) {{ submit.disabled = true; return false; }}
  try {{
    const r = await fetch(url('/health'), {{method:'GET'}});
    if (!r.ok) throw new Error('status ' + r.status);
    return true;
  }} catch (e) {{
    submit.disabled = true;
    warn('The sink at ' + CFG.sink.base + ' did not respond, so the button is disabled '
       + 'rather than discarding your answer silently. Start the ledger service and reload.');
    return false;
  }}
}}
async function loadPrior() {{
  const empty = $('#prior-empty'), list = $('#prior');
  if (!CFG.sink) {{ empty.textContent = 'No sink configured — nothing is saved.'; return; }}
  try {{
    const r = await fetch(url(CFG.sink.path) + '?contract_id=' + encodeURIComponent(CFG.id));
    const rows = await r.json();
    list.innerHTML = '';
    if (!rows.length) {{ empty.textContent = 'No responses recorded yet.'; return; }}
    empty.hidden = true;
    for (const row of rows) {{
      const li = document.createElement('li');
      const b = document.createElement('div');
      b.textContent = row.option_id + (row.comment ? ' — ' + row.comment : '');
      const w = document.createElement('div');
      w.className = 'who'; w.textContent = row.timestamp;
      li.append(b, w); list.append(li);
    }}
  }} catch (e) {{ empty.textContent = 'Could not read prior responses.'; }}
}}
$('#f').addEventListener('submit', async ev => {{
  ev.preventDefault();
  const sel = document.querySelector('input[name=option]:checked');
  if (!sel) {{ alert('Choose an option first.'); return; }}
  // Idempotency key: a double-click must not append the response twice.
  const key = (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
            : (CFG.id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  submit.disabled = true;
  try {{
    const r = await fetch(url(CFG.sink.path), {{
      method:'POST',
      headers:{{'Content-Type':'application/json','Idempotency-Key':key}},
      body: JSON.stringify({{ contract_id: CFG.id, option_id: sel.value,
                             response: 'selected', comment: $('#comment').value }})
    }});
    if (!r.ok) throw new Error('status ' + r.status);
    $('#comment').value = '';
    await loadPrior();
  }} catch (e) {{
    warn('Saving failed (' + e.message + '). Your answer was NOT recorded.');
  }} finally {{ submit.disabled = false; }}
}});
(async () => {{ if (await checkSink()) loadPrior(); else loadPrior(); }})();
</script></body></html>"""


def cmd_build(a):
    try:
        c = json.load(open(a.contract, encoding="utf-8"))
    except FileNotFoundError:
        die(f"contract not found: {a.contract}")
    except json.JSONDecodeError as e:
        die(f"contract is not valid JSON: {e}")

    errs = validate(c)
    if errs:
        # R2: readable error, and R2/T2: NO html written on failure.
        die("invalid contract:\n  - " + "\n  - ".join(errs))

    sink = c.get("sink")
    if c["archetype"] in CAPTURE_ARCHETYPES and not sink and not a.no_sink:
        # R6: refuse loudly rather than emit a page whose answers evaporate.
        die("archetype A1 captures user responses but no `sink` is configured.\n"
            "  Add a sink to the contract, e.g.\n"
            '    "sink": {"kind":"http-jsonl","base":"http://127.0.0.1:3847","path":"/events"}\n'
            "  or pass --no-sink to emit a read-only page that states responses are discarded.")
    if sink:
        sink.setdefault("path", "/events")

    out = render(c, sink, a.no_sink)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(out)
    mode = "standalone (NO capture)" if a.no_sink else "served (captures via sink)"
    print(f"built {a.out}  archetype={c['archetype']}  mode={mode}")
    if a.no_sink:
        print("  note: a standalone page cannot durably capture — localStorage is "
              "undefined on file:// origins (MDN) and never reaches an agent.")
    return 0



def main():
    ap = argparse.ArgumentParser(prog="dashboard_build.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("contract")
    b.add_argument("--out", required=True)
    b.add_argument("--no-sink", action="store_true")
    b.set_defaults(fn=cmd_build)
    a = ap.parse_args()
    sys.exit(a.fn(a) or 0)


if __name__ == "__main__":
    main()
