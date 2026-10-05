"""Optional demo: render floor-state schematics for all 3 platforms and write
to /tmp/designer_preview_demo.html so a human can open it in a browser.

Usage: python3 designer/preview/_demo.py

Not imported by schematic.py. Safe to run standalone.
"""

from __future__ import annotations

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG_ROOT = os.path.dirname(os.path.dirname(_HERE))
if _PKG_ROOT not in sys.path:
    sys.path.insert(0, _PKG_ROOT)

from designer.preview.schematic import render_all_platforms

_OUT = "/tmp/designer_preview_demo.html"


def _build_demo_page(platform_htmls: dict[str, str]) -> str:
    sections = ""
    for platform, html in platform_htmls.items():
        sections += (
            f'<section style="margin:32px 0;">'
            f'<h2 style="font-family:system-ui;font-size:14px;font-weight:600;'
            f'color:#1C1C1E;margin-bottom:12px;text-transform:uppercase;'
            f'letter-spacing:0.05em;">{platform.upper()}</h2>'
            f'{html}'
            f'</section>'
        )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Designer Preview Demo — Floor State</title>
  <style>
    body {{
      font-family: system-ui, -apple-system, sans-serif;
      background: #F0F0F2;
      padding: 40px;
      margin: 0;
    }}
    h1 {{
      font-size: 18px;
      font-weight: 700;
      color: #1C1C1E;
      margin-bottom: 4px;
    }}
    p.subtitle {{
      font-size: 12px;
      color: #6E6E73;
      margin-bottom: 32px;
    }}
  </style>
</head>
<body>
  <h1>Designer Preview — Floor State (Calm Precision 6.4.2)</h1>
  <p class="subtitle">Low-fidelity schematics rendered server-side from the floor token state. No overrides applied.</p>
  {sections}
</body>
</html>"""


def main() -> None:
    print("Rendering floor state for all platforms...")
    htmls = render_all_platforms({})
    page = _build_demo_page(htmls)
    with open(_OUT, "w", encoding="utf-8") as fh:
        fh.write(page)
    print(f"Written to {_OUT}")
    print(f"Open with: open {_OUT}")


if __name__ == "__main__":
    main()
