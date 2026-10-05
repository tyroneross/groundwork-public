"""DESIGN.md promote — writes a draft to a canonical, versioned DESIGN.md in a
product repo.

Fork V-iii: a single DESIGN.md with a frontmatter ``version:`` bump on each
promote.  The tool is write-only and NEVER runs git; the product repo's own git
is the version history.

Fork P-i backup policy
-----------------------
- Product repo IS git-tracked (detected via ``.git`` dir/file walk) → no .bak;
  git history is the record.
- Product repo is NOT git-tracked → prior DESIGN.md is copied to DESIGN.md.bak
  and a warning is returned so callers can surface it to the user.

Pure stdlib.  No subprocess, no git commands.
"""

from __future__ import annotations

import os
import re
import shutil
import datetime as _dt
from typing import Any


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _utc_stamp(avoid: str | None = None) -> str:
    """Return a UTC timestamp string ``YYYY-MM-DDTHH:MM:SSZ``.

    If ``avoid`` is given and the generated stamp equals it (same-second
    collision), the last segment is incremented by one second so the caller
    always gets a value that differs from the prior version.
    """
    now = _dt.datetime.now(_dt.timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if avoid and stamp == avoid:
        bumped = now + _dt.timedelta(seconds=1)
        stamp = bumped.strftime("%Y-%m-%dT%H:%M:%SZ")
    return stamp


def _is_git_repo(repo_dir: str) -> bool:
    """Return True if *repo_dir* or any ancestor directory contains a ``.git``
    directory or file (worktrees use a ``.git`` file).

    Pure filesystem check — never runs a subprocess or git command.
    """
    path = os.path.abspath(repo_dir)
    # Walk up until we either find .git or exhaust the filesystem tree.
    while True:
        git_candidate = os.path.join(path, ".git")
        if os.path.isdir(git_candidate) or os.path.isfile(git_candidate):
            return True
        parent = os.path.dirname(path)
        if parent == path:
            # Reached the filesystem root without finding .git.
            return False
        path = parent


def _bump_version(existing_text: str | None, explicit: str | None) -> str:
    """Return the version string to use for the new promote.

    Priority:
    1. ``explicit`` → used verbatim.
    2. Parse a ``version:`` line from ``existing_text`` front-matter:
       - integer or dotted-numeric (e.g. ``3``, ``1.2``, ``v4``) → increment
         last numeric segment (``3``→``4``, ``1.2``→``1.3``, ``v4``→``v5``).
       - ISO-8601 timestamp string → fall through to a fresh UTC timestamp.
       - Anything else unparseable → fall through.
    3. Fresh UTC timestamp ``YYYY-MM-DDTHH:MM:SSZ``.
    """
    if explicit is not None:
        return explicit

    if existing_text:
        # Locate the version: value in the YAML front-matter block.
        # Front-matter is between the first pair of ``---`` lines.
        # We accept both quoted and unquoted values.
        m = re.search(
            r'^version:\s*["\']?([^"\'#\r\n]+?)["\']?\s*$',
            existing_text,
            re.MULTILINE,
        )
        if m:
            raw = m.group(1).strip()
            # Strip a leading 'v' prefix for numeric check, keep for output.
            prefix = ""
            candidate = raw
            if raw and raw[0].lower() == "v":
                prefix = raw[0]
                candidate = raw[1:]

            # Dotted-numeric: only digits and dots (e.g. "1", "1.2", "1.2.3").
            if re.fullmatch(r"\d+(\.\d+)*", candidate):
                parts = candidate.split(".")
                parts[-1] = str(int(parts[-1]) + 1)
                return prefix + ".".join(parts)
            # If it looks like a timestamp (contains 'T' or '-' patterns),
            # fall through to a fresh stamp that avoids colliding with it.
            return _utc_stamp(avoid=raw)

    return _utc_stamp()


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def read_existing_version(path: str) -> str | None:
    """Read the DESIGN.md at *path* and return its ``version:`` frontmatter
    value, or ``None`` if the file doesn't exist or has no version field.
    """
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return None
    m = re.search(
        r'^version:\s*["\']?([^"\'#\r\n]+?)["\']?\s*$',
        text,
        re.MULTILINE,
    )
    if m:
        return m.group(1).strip()
    return None


# ---------------------------------------------------------------------------
# Core promote
# ---------------------------------------------------------------------------

def promote_draft(
    draft: dict[str, Any],
    out: str,
    *,
    name: str | None = None,
    catalog: Any = None,
    version: str | None = None,
) -> dict[str, Any]:
    """Promote a draft to a canonical, versioned DESIGN.md.

    Parameters
    ----------
    draft:
        A dict with at least ``state_snapshot`` (TasteState.to_dict() output)
        and optionally ``product`` (product name string).
    out:
        Destination — a directory (writes ``<dir>/DESIGN.md``) or an exact
        ``.md`` path.
    name:
        Override the product name.  Falls back to ``draft["product"]`` then
        ``"Product"``.
    catalog:
        Optional catalog object forwarded to the prompt-pack builder.
    version:
        If given, used verbatim as the new version; otherwise auto-bumped.

    Returns
    -------
    dict with keys:
        path, bytes, version, prior_version, is_git, backed_up, warning.
    """
    # Lazy imports to avoid circular imports at module load time.
    from ..engine.state import TasteState
    from . import design_md, writer

    # 1. Reconstruct state.
    state = TasteState.from_dict(draft["state_snapshot"])

    # 2. Resolve destination path.
    path = writer.resolve_out_path(out)

    # 3. Read existing file (may be None).
    existing_text: str | None = None
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            existing_text = fh.read()

    existing_version = read_existing_version(path)

    # 4. Decide version string.
    new_version = _bump_version(existing_text, version)

    # 5. Build + render — two paths:
    #    a) import→evolve→promote: import_base present → surgical structure-
    #       preserving merge (only evolved scalar values + version bumped).
    #    b) fresh-walk / extract: full re-emit from the tool's template.
    import_base = state.context.get("import_base") if isinstance(state.context, dict) else None
    if import_base and import_base.get("raw_text"):
        # Structure-preserving surgical merge-back (import→evolve→promote path).
        from .surgical_merge import surgical_update
        evolved = state.delta_since(draft.get("baseline_overrides"))
        original = import_base["raw_text"]
        text = surgical_update(original, evolved, new_version)
    else:
        # Fresh-walk / extract path — full re-emit from template (UNCHANGED).
        product_name = name or draft.get("product") or "Product"
        doc = design_md.build_design_doc(
            product_name, state, flatten=True, version=new_version, catalog=catalog
        )
        text = design_md.render_design_md(doc)

    # 6. Detect git.
    is_git = _is_git_repo(os.path.dirname(path))

    # 7. Backup policy (P-i).
    backed_up: str | None = None
    warning: str | None = None
    if existing_text is not None and not is_git:
        bak = path + ".bak"
        shutil.copy2(path, bak)
        backed_up = bak
        warning = (
            "prior retained as DESIGN.md.bak; "
            "repo isn't git-tracked so full history isn't available."
        )

    # 8. Write.
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)

    return {
        "path": path,
        "bytes": len(text.encode("utf-8")),
        "version": new_version,
        "prior_version": existing_version,
        "is_git": is_git,
        "backed_up": backed_up,
        "warning": warning,
    }
