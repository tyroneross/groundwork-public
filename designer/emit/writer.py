"""DESIGN.md writer — writes the rendered DESIGN.md into a target product repo.

TAG:ASSUMED (per plan): the target-product repo path is supplied at emit time.
`--out` names the destination (a directory -> writes DESIGN.md inside it; a
path ending in .md -> writes exactly there). A version stamp is embedded by the
emitter; this module owns the filesystem write + a non-destructive backup of any
existing DESIGN.md.

Pure stdlib.
"""

from __future__ import annotations

import os
import shutil
from typing import Any

from .design_md import build_design_doc, render_design_md


def resolve_out_path(out: str) -> str:
    """Map a --out value to a concrete DESIGN.md file path.

    - ends with .md            -> that exact file
    - existing dir / dir-like  -> <dir>/DESIGN.md
    """
    if out.endswith(".md"):
        return os.path.abspath(out)
    return os.path.abspath(os.path.join(out, "DESIGN.md"))


def write_design_md(
    name: str,
    state: Any,
    out: str,
    *,
    flatten: bool = True,
    version: str | None = None,
    catalog: Any = None,
    backup: bool = True,
) -> dict[str, Any]:
    """Build, validate, render and write a DESIGN.md to `out`.

    Returns a result dict: {path, bytes, flattened, backed_up}.
    Raises ValueError if the doc fails schema validation (render_design_md).
    """
    doc = build_design_doc(name, state, flatten=flatten, version=version, catalog=catalog)
    text = render_design_md(doc)  # validates internally

    path = resolve_out_path(out)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    backed_up = None
    if backup and os.path.exists(path):
        bak = path + ".bak"
        shutil.copy2(path, bak)
        backed_up = bak

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)

    return {
        "path": path,
        "bytes": len(text.encode("utf-8")),
        "flattened": flatten,
        "backed_up": backed_up,
    }
