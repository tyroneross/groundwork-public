#!/usr/bin/env python3
# ───────────────────────────────────────────────────────────────────────
# Groundwork — full-screen mockup scaffolder (Phase 1.5)
#
# Given a Spec JSON + a design slug, lay out
#   <design-dir>/mockups/
# with:
#   - manifest.json         — enumerates, per critical screen, one candidate
#                             slot per design-mode brief:
#                             {screen_id, mode, html_path, status:"pending"}
#   - <screen>-<mode>.html  — a PLACEHOLDER, standalone, visibly non-functional
#                             HTML file the HOST AGENT overwrites with a real,
#                             mode-seeded full-screen static mockup.
#
# The HTML *content* of a finished mockup is authored by the host agent (the
# LLM) per /groundwork:mockups — NOT by this script. This script only scaffolds
# the directory, the manifest index, and empty placeholder slots.
#
# The flat `<screen>-<mode>.html` naming is deliberate: the mockup-gallery
# server scans its mockup dir NON-recursively (readdirSync + endsWith(".html")),
# so nested per-screen subdirs would be invisible to it. Flat files with a
# screen-name prefix keep same-screen variants grouped alphabetically in the
# gallery while staying scannable. manifest.json / selection.json are non-HTML
# and are ignored by the gallery scanner.
#
# Pure stdlib. No third-party imports. No network. No API calls.
# ───────────────────────────────────────────────────────────────────────

import argparse
import datetime
import hashlib
import html
import json
import os
import re
import sys

SCHEMA_ID = "groundwork.mockups/v1"
PLACEHOLDER_SENTINEL = "groundwork:placeholder"

# The four primary design-mode briefs that seed divergent full-screen
# hypotheses. `brief` is relative to the plugin root (the dir that contains the
# designer/ package). `hint` is a one-line palette cue surfaced in the
# placeholder + manifest so the host agent has a reminder at a glance; the
# authoritative palette/type/components live in the brief file.
MODES = [
    {
        "id": "atmospheric-immersion",
        "name": "Atmospheric Immersion",
        "brief": "designer/references/modes/atmospheric-immersion.md",
        "hint": "dark gradient ground, thin large type, frosted glass cards, progress ring, mode-color left-border + glow",
    },
    {
        "id": "glass-workspace",
        "name": "Glass Workspace",
        "brief": "designer/references/modes/glass-workspace.md",
        "hint": "sidebar+content, frosted glass surfaces on near-black, indigo accent, ambient aurora radials",
    },
    {
        "id": "warm-craft",
        "name": "Warm Craft",
        "brief": "designer/references/modes/warm-craft.md",
        "hint": "warm blacks/browns, amber accent, DM Sans, dot-texture paper ground, hand-made material feel",
    },
    {
        "id": "data-narrative",
        "name": "Data Narrative",
        "brief": "designer/references/modes/data-narrative.md",
        "hint": "dark hero -> light content, decision-first charts, bento grid, blue key / gray context",
    },
]
MODE_BY_ID = {m["id"]: m for m in MODES}


def verify_artifact_generation(spec_path):
    """Reject a detectable partial transaction before consuming canonical input."""
    design_dir = os.path.dirname(os.path.abspath(spec_path))
    if any(name.startswith(".groundwork-tx-") for name in os.listdir(design_dir)):
        raise ValueError("interrupted Groundwork artifact transaction; rerun the emitter first")
    manifest_path = os.path.join(design_dir, "artifact-manifest.json")
    if not os.path.isfile(manifest_path):
        return
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)
    expected = next(
        (item.get("sha256") for item in manifest.get("files", []) if item.get("name") == "spec.json"),
        None,
    )
    if not expected:
        raise ValueError("artifact manifest does not cover spec.json")
    with open(spec_path, "rb") as fh:
        actual = hashlib.sha256(fh.read()).hexdigest()
    if actual != expected:
        raise ValueError("spec.json does not match artifact-manifest.json; rerun the emitter")


def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "screen"


def screen_slug(screen):
    # Prefer a clean name; fall back to the id (minus a leading "screen-").
    name = screen.get("name") or re.sub(r"^screen-", "", screen.get("id", ""))
    return slugify(name)


def is_placeholder_file(path):
    """A slot is still 'pending' if the file is missing or is a groundwork
    placeholder (carries the sentinel). Host-authored files lack it."""
    if not os.path.exists(path):
        return True
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return PLACEHOLDER_SENTINEL in fh.read(4096)
    except OSError:
        return True


def placeholder_html(product_name, screen, mode):
    """A minimal, valid, standalone HTML placeholder. Visibly non-functional
    (amber 'PENDING' banner) and gallery-rateable (data-component + muted
    label) so it renders honestly in the review surface before authoring."""
    pn = html.escape(product_name)
    sname = html.escape(screen.get("name", screen.get("id", "")))
    spurpose = html.escape(screen.get("purpose", ""))
    saction = html.escape(screen.get("primaryAction", "") or "")
    sstates = ", ".join(html.escape(s) for s in screen.get("states", []) or [])
    mname = html.escape(mode["name"])
    mbrief = html.escape(mode["brief"])
    mhint = html.escape(mode["hint"])
    comp = "".join(w.capitalize() for w in re.split(r"[^A-Za-z0-9]+", sname) if w) or "Screen"
    return f"""<!-- {PLACEHOLDER_SENTINEL} — overwrite this whole file with the authored, mode-seeded full-screen mockup -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{pn} · {sname} · {mname} (pending)</title>
<style>
  :root {{ color-scheme: dark; }}
  html,body {{ margin:0; height:100%; }}
  body {{
    font: 14px/1.5 -apple-system, "SF Pro Text", Segoe UI, Roboto, sans-serif;
    background:#0e1225; color:#e8e8f0;
    display:flex; align-items:center; justify-content:center; min-height:100vh;
  }}
  .wrap {{ max-width:560px; padding:32px; }}
  .banner {{
    display:inline-block; font-size:11px; font-weight:600; letter-spacing:1.5px;
    text-transform:uppercase; color:#0e1225; background:#e8a23d;
    padding:4px 10px; border-radius:6px; margin-bottom:20px;
  }}
  .label {{ font-size:11px; font-weight:600; letter-spacing:1.2px; text-transform:uppercase;
    color:#7d7f9a; margin-bottom:8px; }}
  h1 {{ font-size:26px; font-weight:300; margin:0 0 4px; }}
  .mode {{ font-size:13px; color:#9aa0c8; margin:0 0 20px; }}
  .card {{ background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08);
    border-left:2px solid #3a4878; border-radius:10px; padding:14px 16px; margin-top:12px; }}
  .card b {{ display:block; font-size:11px; font-weight:600; letter-spacing:1px;
    text-transform:uppercase; color:#7d7f9a; margin-bottom:4px; }}
  code {{ font-family:"SF Mono", Menlo, monospace; font-size:12px; color:#b8af8a; }}
</style>
</head>
<body>
  <!-- muted component label above each rateable section (mockup-gallery convention) -->
  <div class="label">PLACEHOLDER — authored by host agent</div>
  <section class="wrap" data-component="{comp}Placeholder">
    <span class="banner">Pending · non-functional</span>
    <h1>{pn} — {sname}</h1>
    <p class="mode">Mode hypothesis: <b>{mname}</b></p>
    <div class="card"><b>Screen purpose</b>{spurpose or "&mdash;"}</div>
    <div class="card"><b>Primary action</b>{saction or "&mdash;"}</div>
    <div class="card"><b>States to show</b>{sstates or "&mdash;"}</div>
    <div class="card"><b>Seed brief</b><code>{mbrief}</code><br>{mhint}</div>
    <div class="card"><b>Instruction</b>Overwrite this file with a real, full-screen static mockup that
      commits to the <b>{mname}</b> palette, type, and components from the brief above.
      Keep it an honest static prototype: no fake backends, visibly non-functional controls.</div>
  </section>
</body>
</html>
"""


def build_manifest(spec, slug, screens, modes, existing_status):
    product_name = spec.get("productName") or slug
    slots = []
    for sc in screens:
        sslug = screen_slug(sc)
        for m in modes:
            fname = f"{sslug}-{m['id']}.html"
            status = existing_status.get((sc.get("id"), m["id"]), "pending")
            slots.append({
                "screen_id": sc.get("id"),
                "screen_name": sc.get("name", sc.get("id")),
                "mode": m["id"],
                "html_path": fname,
                "status": status,
            })
    return {
        "schema": SCHEMA_ID,
        "slug": slug,
        "productName": product_name,
        "platformTarget": spec.get("platformTarget", "web"),
        "spec": "spec.json",
        "generatedAt": datetime.datetime.now(datetime.timezone.utc)
            .replace(microsecond=0).isoformat(),
        "modes": [
            {"id": m["id"], "name": m["name"], "brief": m["brief"], "hint": m["hint"]}
            for m in modes
        ],
        "screens": [
            {
                "id": sc.get("id"),
                "name": sc.get("name", sc.get("id")),
                "purpose": sc.get("purpose", ""),
                "primaryAction": sc.get("primaryAction"),
                "states": sc.get("states", []),
                "slug": screen_slug(sc),
            }
            for sc in screens
        ],
        "slots": slots,
        # Written later by /groundwork:mockups step (e) after review; the
        # subsequent /groundwork:explore-ui reads it to seed the Designer walk.
        "selection": "selection.json",
    }


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Scaffold a groundwork full-screen mockup gallery from a Spec JSON.",
    )
    ap.add_argument("spec", help="Path to the Spec JSON (SpecSchema).")
    ap.add_argument("--slug", help="Design slug (kebab-case). Default: slugified productName.")
    ap.add_argument("--out", help="Design directory. Default: ~/dev/designs/<slug>.")
    ap.add_argument("--modes", help="Comma-separated mode ids. Default: all four primary modes. "
                                    "Choices: " + ", ".join(m["id"] for m in MODES))
    ap.add_argument("--screens", help="Comma-separated screen ids to include. Default: all screens[].")
    ap.add_argument("--force", action="store_true",
                    help="Overwrite existing placeholder AND authored HTML with fresh placeholders.")
    ap.add_argument("--print-manifest", action="store_true", help="Print the manifest JSON to stdout.")
    args = ap.parse_args(argv)

    try:
        verify_artifact_generation(args.spec)
        with open(args.spec, "r", encoding="utf-8") as fh:
            spec = json.load(fh)
    except (OSError, ValueError) as e:
        ap.error(f"could not read Spec JSON at {args.spec}: {e}")

    slug = args.slug or slugify(spec.get("productName", ""))
    if not slug:
        ap.error("no --slug and Spec has no productName to derive one from.")

    design_dir = args.out or os.path.join(os.path.expanduser("~"), "dev", "designs", slug)
    mockups_dir = os.path.join(design_dir, "mockups")

    # Resolve modes.
    if args.modes:
        modes = []
        for mid in [m.strip() for m in args.modes.split(",") if m.strip()]:
            if mid not in MODE_BY_ID:
                ap.error(f"unknown mode '{mid}'. Choices: {', '.join(MODE_BY_ID)}")
            modes.append(MODE_BY_ID[mid])
    else:
        modes = list(MODES)

    # Resolve screens.
    all_screens = spec.get("screens", []) or []
    if not all_screens:
        ap.error("Spec has no screens[]; nothing to scaffold.")
    if args.screens:
        want = [s.strip() for s in args.screens.split(",") if s.strip()]
        by_id = {sc.get("id"): sc for sc in all_screens}
        missing = [w for w in want if w not in by_id]
        if missing:
            ap.error(f"screen id(s) not in Spec: {', '.join(missing)}")
        screens = [by_id[w] for w in want]
    else:
        screens = all_screens

    os.makedirs(mockups_dir, exist_ok=True)

    # Preserve status for slots already authored (file exists, no sentinel),
    # unless --force re-seeds everything.
    existing_status = {}
    if not args.force:
        for sc in screens:
            sslug = screen_slug(sc)
            for m in modes:
                path = os.path.join(mockups_dir, f"{sslug}-{m['id']}.html")
                if os.path.exists(path) and not is_placeholder_file(path):
                    existing_status[(sc.get("id"), m["id"])] = "authored"

    product_name = spec.get("productName") or slug
    written, kept = [], []
    for sc in screens:
        sslug = screen_slug(sc)
        for m in modes:
            fname = f"{sslug}-{m['id']}.html"
            path = os.path.join(mockups_dir, fname)
            # Write a placeholder when forced, when missing, or when the existing
            # file is still a groundwork placeholder. Never clobber host-authored
            # HTML unless --force.
            if args.force or is_placeholder_file(path):
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(placeholder_html(product_name, sc, m))
                written.append(fname)
            else:
                kept.append(fname)  # host-authored; leave it alone

    # Copy the Spec next to the mockups for the gallery/explore-ui to find,
    # only if a spec.json isn't already present in the design dir.
    spec_dest = os.path.join(design_dir, "spec.json")
    if not os.path.exists(spec_dest):
        try:
            with open(spec_dest, "w", encoding="utf-8") as fh:
                json.dump(spec, fh, indent=2)
        except OSError:
            pass

    manifest = build_manifest(spec, slug, screens, modes, existing_status)
    manifest_path = os.path.join(mockups_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)

    print(f"Scaffolded {len(manifest['slots'])} slot(s): "
          f"{len(screens)} screen(s) x {len(modes)} mode(s)")
    print(f"  design dir : {design_dir}")
    print(f"  mockups    : {mockups_dir}")
    print(f"  manifest   : {manifest_path}")
    print(f"  placeholder written/refreshed: {len(written)}")
    if kept:
        print(f"  host-authored kept: {len(kept)} -> {', '.join(kept)}")
    print("\nNext: author the mockups with Groundwork, then review them in")
    print("Groundwork's own gallery (detached, readiness-checked, and stoppable):")
    print(f'  node "${{CLAUDE_PLUGIN_ROOT}}/designer/canvas/gallery-launcher.mjs" start \\')
    print(f'    --dir "{mockups_dir}"')

    if args.print_manifest:
        print("\n" + json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
