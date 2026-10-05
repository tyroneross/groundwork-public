"""Draft persistence for the designer adaptive walk (SAVE=DRAFT / PROMOTE=VERSION).

A draft captures the full TasteState snapshot plus a recorded BASELINE
(the overrides at the start of the session, e.g. from an import or
extraction) so "deltas this run" = current overrides − baseline.

Drafts live in the TOOL's own storage:
  <plugin_root>/.designer/drafts/<product_slug>/<draft_id>.json

This keeps the product repository clean until promote. Resuming a draft
restores the state_snapshot exactly via TasteState.from_dict().

Schema version: designer.draft/v1

Pure stdlib. No deps, no network, no vendor SDK.
"""

from __future__ import annotations

import copy
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _utcnow_iso() -> str:
    """Return current UTC time as an ISO-8601 string with Z suffix."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _slugify(product: str) -> str:
    """Convert *product* to a filesystem-safe slug.

    Rules:
    - Lowercase.
    - Non-alphanumeric characters replaced with '-'.
    - Consecutive '-' collapsed to a single '-'.
    - Leading/trailing '-' stripped.
    - Empty result defaults to "design-system".
    """
    if not product or not product.strip():
        return "design-system"
    slug = product.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "design-system"


def _short_uuid() -> str:
    """Return the first 8 hex chars of a random UUID4."""
    return uuid.uuid4().hex[:8]


# ---------------------------------------------------------------------------
# 1. DRAFTS_ROOT resolution
# ---------------------------------------------------------------------------

def drafts_dir(plugin_root: str, product: str) -> str:
    """Return the absolute path to the drafts directory for *product*.

    Path: <plugin_root>/.designer/drafts/<safe_product>/

    The directory is NOT created here; callers that write use save_draft()
    which does mkdir -p.

    Parameters
    ----------
    plugin_root : str
        Absolute path to the plugin's root directory (the directory that owns
        the .designer/ storage subtree).
    product : str
        Human-readable product name. Sanitized to a slug before use as a
        directory component.
    """
    slug = _slugify(product)
    return str(Path(plugin_root) / ".designer" / "drafts" / slug)


# ---------------------------------------------------------------------------
# 2. make_draft
# ---------------------------------------------------------------------------

def make_draft(
    state_dict: dict,
    *,
    product: str,
    baseline_overrides: dict,
    draft_id: str | None = None,
    source: str = "draft",
) -> dict:
    """Build and return a draft record dict (in-memory, no I/O).

    Parameters
    ----------
    state_dict : dict
        The result of TasteState.to_dict() — full walk state snapshot.
    product : str
        Human-readable product name (stored verbatim; slugified for file path).
    baseline_overrides : dict
        The overrides at the START of this session (from import/extract/fresh).
        "Deltas this run" = state_dict["overrides"] − baseline_overrides.
    draft_id : str | None
        Explicit draft id. If None, a deterministic-looking id is generated:
        "draft-<YYYYMMDDTHHMMSSZ>-<8-hex-chars>".
    source : str
        Provenance of the baseline: "draft" | "import" | "extract".

    Returns
    -------
    dict
        Draft record conforming to designer.draft/v1.
    """
    now = _utcnow_iso()
    if draft_id is None:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        draft_id = f"draft-{ts}-{_short_uuid()}"

    return {
        "schema": "designer.draft/v1",
        "draft_id": draft_id,
        "product": product,
        "source": source,
        "created_at": now,
        "updated_at": now,
        "baseline_overrides": copy.deepcopy(baseline_overrides) if baseline_overrides else {},
        "state_snapshot": copy.deepcopy(state_dict),
    }


# ---------------------------------------------------------------------------
# 3. save_draft
# ---------------------------------------------------------------------------

def save_draft(plugin_root: str, draft: dict) -> dict:
    """Persist *draft* to disk and return a write-result dict.

    Writes to:
      drafts_dir(plugin_root, draft["product"]) / <draft_id>.json

    If a file with the same id already exists it is OVERWRITTEN (re-save =
    update). Updates draft["updated_at"] to the current UTC time in-place
    before writing.

    Parameters
    ----------
    plugin_root : str
        Absolute path to the plugin's root directory.
    draft : dict
        Draft record produced by make_draft() (or a previously loaded draft).

    Returns
    -------
    dict
        {"path": <abs path str>, "draft_id": <str>, "bytes": <int>}
    """
    draft["updated_at"] = _utcnow_iso()

    target_dir = drafts_dir(plugin_root, draft["product"])
    Path(target_dir).mkdir(parents=True, exist_ok=True)

    draft_id = draft["draft_id"]
    file_path = str(Path(target_dir) / f"{draft_id}.json")

    payload = json.dumps(draft, indent=2, ensure_ascii=False)
    encoded = payload.encode("utf-8")

    with open(file_path, "wb") as fh:
        fh.write(encoded)

    return {
        "path": file_path,
        "draft_id": draft_id,
        "bytes": len(encoded),
    }


# ---------------------------------------------------------------------------
# 4. load_draft
# ---------------------------------------------------------------------------

def load_draft(plugin_root: str, product: str, draft_id: str) -> dict | None:
    """Load a draft by product and id. Returns None if missing or corrupt.

    Never raises — degrade gracefully on any I/O or JSON error.

    Parameters
    ----------
    plugin_root : str
        Absolute path to the plugin's root directory.
    product : str
        Human-readable product name (slugified to build the file path).
    draft_id : str
        The draft_id stored in the file name.

    Returns
    -------
    dict | None
        The full draft record dict, or None on any failure.
    """
    file_path = Path(drafts_dir(plugin_root, product)) / f"{draft_id}.json"
    try:
        with open(file_path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 5. list_drafts
# ---------------------------------------------------------------------------

def list_drafts(plugin_root: str, product: str | None = None) -> list[dict]:
    """List draft summaries, sorted by updated_at DESC.

    Parameters
    ----------
    plugin_root : str
        Absolute path to the plugin's root directory.
    product : str | None
        If given, list only that product's drafts (slugified for lookup).
        If None, scan all product subdirs under .designer/drafts/.

    Returns
    -------
    list[dict]
        Each entry: {draft_id, product, source, created_at, updated_at,
                     path, picks_count}.
        picks_count = len(state_snapshot.get("history", [])).
        Unreadable/corrupt files are silently skipped.
        Returns [] if the drafts root doesn't exist.
    """
    drafts_root = Path(plugin_root) / ".designer" / "drafts"
    if not drafts_root.exists():
        return []

    # Determine which product directories to scan.
    if product is not None:
        slug = _slugify(product)
        product_dirs = [drafts_root / slug]
    else:
        try:
            product_dirs = [p for p in drafts_root.iterdir() if p.is_dir()]
        except OSError:
            return []

    summaries: list[dict] = []
    for product_dir in product_dirs:
        if not product_dir.exists():
            continue
        try:
            json_files = list(product_dir.glob("*.json"))
        except OSError:
            continue
        for json_file in json_files:
            try:
                with open(json_file, "r", encoding="utf-8") as fh:
                    rec = json.load(fh)
                summaries.append({
                    "draft_id": rec.get("draft_id", json_file.stem),
                    "product": rec.get("product", product_dir.name),
                    "source": rec.get("source", "draft"),
                    "created_at": rec.get("created_at", ""),
                    "updated_at": rec.get("updated_at", ""),
                    "path": str(json_file),
                    "picks_count": len(
                        rec.get("state_snapshot", {}).get("history", [])
                    ),
                })
            except Exception:
                continue  # skip corrupt files silently

    summaries.sort(key=lambda x: x["updated_at"], reverse=True)
    return summaries


# ---------------------------------------------------------------------------
# 6. record_baseline
# ---------------------------------------------------------------------------

def record_baseline(state_dict: dict) -> dict:
    """Return a deepcopy of the current overrides from *state_dict*.

    This is called at the moment a fresh/extract/import seed becomes the
    starting point for a session, capturing the overrides before any new picks
    are applied. "Deltas this run" = later overrides − this baseline.

    Parameters
    ----------
    state_dict : dict
        The result of TasteState.to_dict() at the start of a session.

    Returns
    -------
    dict
        A deepcopy of state_dict.get("overrides", {}).
    """
    return copy.deepcopy(state_dict.get("overrides", {}))
