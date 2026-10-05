#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

stage_json="$(node scripts/stage-release.mjs)"
manifest="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.manifestPath)' "$stage_json")"
digest="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.artifactDigest)' "$stage_json")"
artifact_root="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.artifactRoot)' "$stage_json")"
record_failed() {
  node scripts/release-evidence.mjs record \
    --gate deterministic \
    --status failed \
    --manifest "$manifest" \
    --gate-command "npm run test:release" \
    --metadata "$(node -e 'process.stdout.write(JSON.stringify({nodeVersion:process.version,platform:process.platform}))')" \
    >/dev/null || true
}
trap 'code=$?; if [[ $code -ne 0 ]]; then record_failed; fi; exit $code' EXIT

bash scripts/check.sh
node scripts/verify-derived-exports.mjs \
  --cli "$artifact_root/engine/dist/cli.js" \
  --fixture "$artifact_root/engine/fixtures/export-ready-spec.json"
command -v claude >/dev/null 2>&1 || { echo "required runtime is missing: claude" >&2; exit 1; }
claude plugin validate --strict .

restaged="$(node scripts/stage-release.mjs)"
restaged_digest="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.artifactDigest)' "$restaged")"
[[ "$restaged_digest" == "$digest" ]] || { echo "source bytes changed during the deterministic gate" >&2; exit 1; }

node scripts/release-evidence.mjs record \
  --gate deterministic \
  --status passed \
  --manifest "$manifest" \
  --gate-command "npm run test:release" \
  --metadata "$(node -e 'process.stdout.write(JSON.stringify({nodeVersion:process.version,platform:process.platform}))')" \
  >/dev/null
trap - EXIT
echo "DETERMINISTIC RELEASE GATE PASSED: $digest"
