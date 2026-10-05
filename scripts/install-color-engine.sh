#!/usr/bin/env bash
# Install the colour engine into a consumer plugin as a vendored module.
#
# Groundwork holds the canonical source. Each consumer gets its own copy so it
# keeps working when installed standalone, plus a color.config.json it owns and
# can customise. Taste does NOT fragment: combos + profile live in one shared
# registry so a favourite recorded anywhere is available everywhere.
#
#   ./scripts/install-color-engine.sh <target-dir> [install-name]
#
# e.g. ./scripts/install-color-engine.sh ~/dev/git-folder/build-loop build-loop
#
# Re-running is safe: engine files are overwritten (canonical wins), the local
# color.config.json is preserved (yours wins).

set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_SRC="$SRC_DIR/designer/color"

TARGET="${1:-}"
NAME="${2:-$(basename "${TARGET:-unknown}")}"

if [[ -z "$TARGET" ]]; then
  echo "usage: $0 <target-dir> [install-name]" >&2
  exit 2
fi
if [[ ! -d "$TARGET" ]]; then
  echo "error: target '$TARGET' is not a directory" >&2
  exit 2
fi
if [[ ! -d "$ENGINE_SRC" ]]; then
  echo "error: engine source missing at $ENGINE_SRC" >&2
  exit 2
fi

DEST="$TARGET/vendor/color_engine"
mkdir -p "$DEST"

# Engine files only — never copy the registries, they are shared.
for f in __init__.py relationships.py preview.py combos.py config.py README.md; do
  [[ -f "$ENGINE_SRC/$f" ]] && cp "$ENGINE_SRC/$f" "$DEST/$f"
done

# Provenance so a stale vendored copy is diagnosable.
cat > "$DEST/INSTALLED.json" <<EOF
{
  "module": "groundwork-color-engine",
  "install": "$NAME",
  "source": "$SRC_DIR",
  "installed_from_commit": "$(git -C "$SRC_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)",
  "note": "Vendored copy. Canonical source is Groundwork designer/color. Re-run install-color-engine.sh to refresh; do not edit here."
}
EOF

# Local config — created once, then left alone so customisation survives.
if [[ ! -f "$DEST/color.config.json" ]]; then
  cat > "$DEST/color.config.json" <<EOF
{
  "install": "$NAME",
  "vector": {
    "energy": "balanced",
    "contrast_feel": "standard",
    "accent_intensity": "clear",
    "harmony": "analogous"
  },
  "registry_dir": "~/dev/designs/.groundwork-color"
}
EOF
  echo "  wrote  $DEST/color.config.json  (yours to customise)"
else
  echo "  kept   $DEST/color.config.json  (existing config preserved)"
fi

echo "installed colour engine → $DEST"
echo
python3 - "$DEST" <<'PY'
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(sys.argv[1]).parent.parent))
sys.path.insert(0, str(pathlib.Path(sys.argv[1])))
try:
    import config
    print(config.describe(sys.argv[1]))
except Exception as exc:  # noqa: BLE001
    print(f"(config self-check skipped: {exc})")
PY
