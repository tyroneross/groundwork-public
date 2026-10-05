#!/usr/bin/env bash
# Groundwork's fail-closed deterministic source/browser gate.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT"

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "required runtime is missing: $1" >&2; exit 1; }
}

run() {
  local label="$1"; shift
  local log
  log="$(mktemp -t groundwork-check.XXXXXX)"
  echo "── $label"
  if ! "$@" >"$log" 2>&1; then
    tail -80 "$log" >&2
    echo "Full check log retained at: $log" >&2
    echo "FAILED: $label" >&2
    exit 1
  fi
  if grep -Eiq '# SKIP([[:space:]]|$)|# skipped [1-9][0-9]*|skipped=[1-9][0-9]*|(^|[^0-9])[1-9][0-9]* skipped([^0-9]|$)|skipped:[[:space:]]*[1-9][0-9]*' "$log"; then
    tail -80 "$log" >&2
    echo "Full check log retained at: $log" >&2
    echo "FAILED: $label reported a skipped required check" >&2
    exit 1
  fi
  tail -3 "$log" | sed 's/^/   /'
  rm -f "$log"
}

# Sourcing exposes the actual runner for bounded diagnostic regressions.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then return; fi

require node
require npm
require npx
require python3

for module in \
  designer.decide.elicit \
  designer.decide.profile \
  designer.decide.color_dimensions \
  designer.color.relationships \
  designer.canvas.feedback_cursor \
  designer.gate.convergence; do
  run "$module --selftest" python3 -m "$module" --selftest
done

if [[ -z "${CHROME_BIN:-}" ]]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/usr/bin/google-chrome" \
    "/usr/bin/chromium" \
    "/usr/bin/chromium-browser"; do
    if [[ -x "$candidate" ]]; then export CHROME_BIN="$candidate"; break; fi
  done
fi
[[ -n "${CHROME_BIN:-}" && -x "$CHROME_BIN" ]] || {
  echo "required browser is missing; set CHROME_BIN to Chrome or Chromium" >&2
  exit 1
}

mapfile_ts=()
while IFS= read -r test_file; do mapfile_ts+=("$test_file"); done < <(find engine/src -name '*.test.ts' -type f | sort)
mapfile_mjs=()
while IFS= read -r test_file; do mapfile_mjs+=("$test_file"); done < <(find designer/tests -name '*.mjs' -type f | sort)
[[ ${#mapfile_ts[@]} -gt 0 && ${#mapfile_mjs[@]} -gt 0 ]] || { echo "test discovery returned no files" >&2; exit 1; }

run "version agreement" python3 scripts/version_gate.py --agreement
run "TypeScript typecheck" npm run typecheck
run "derived adapter release gate" npm run test:adapters
run "complete Python suite" python3 -m pytest -q -p no:cacheprovider designer/tests
run "complete engine TypeScript suite" npx tsx --test --test-concurrency=1 "${mapfile_ts[@]}"
run "exact reconstruction packet" node engine/scripts/check-reconstruction.mjs
run "flow CLI mutation self-test" python3 -m designer.conformance.flow_cli_check --selftest
run "flow CLI live-doc conformance" python3 -m designer.conformance.flow_cli_check --verbose
run "canvas protocol conformance" python3 designer/canvas/conformance/run.py --server "node $ROOT/designer/canvas/canvas-server.mjs"
run "canvas mutation validation" python3 designer/canvas/conformance/mutations.py
run "complete Designer Node/browser suite" node --test --test-concurrency=1 "${mapfile_mjs[@]}"

echo "ALL CHECKS PASSED"
