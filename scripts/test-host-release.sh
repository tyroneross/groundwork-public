#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v claude >/dev/null 2>&1 || { echo "required host runtime is missing: claude" >&2; exit 1; }
command -v codex >/dev/null 2>&1 || { echo "required host runtime is missing: codex" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "required host runtime is missing: python3" >&2; exit 1; }

stage_json="$(node scripts/stage-release.mjs)"
manifest="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.manifestPath)' "$stage_json")"
digest="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.artifactDigest)' "$stage_json")"
claude_version="$(claude --version | head -1)"
codex_version="$(codex --version | head -1)"
python_version="$(python3 --version 2>&1 | head -1)"
record_failed() {
  node scripts/release-evidence.mjs record \
    --gate host \
    --status failed \
    --manifest "$manifest" \
    --gate-command "npm run test:host-release" \
    --metadata "$(node -e 'process.stdout.write(JSON.stringify({claudeVersion:process.argv[1],codexVersion:process.argv[2],pythonVersion:process.argv[3],platform:process.platform}))' "$claude_version" "$codex_version" "$python_version")" \
    >/dev/null || true
}
trap 'code=$?; if [[ $code -ne 0 ]]; then record_failed; fi; exit $code' EXIT

host_result="$(node scripts/verify-host-parity.mjs --manifest "$manifest")"
echo "$host_result"
build_loop_version="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.buildLoopVersion)' "$host_result")"
build_loop_commit="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.buildLoopCommit)' "$host_result")"
build_loop_adapter_digest="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.buildLoopAdapterDigest)' "$host_result")"
node scripts/release-evidence.mjs record \
  --gate host \
  --status passed \
  --manifest "$manifest" \
  --gate-command "npm run test:host-release" \
  --metadata "$(node -e 'process.stdout.write(JSON.stringify({claudeVersion:process.argv[1],codexVersion:process.argv[2],pythonVersion:process.argv[3],buildLoopVersion:process.argv[4],buildLoopCommit:process.argv[5],buildLoopAdapterDigest:process.argv[6],platform:process.platform}))' "$claude_version" "$codex_version" "$python_version" "$build_loop_version" "$build_loop_commit" "$build_loop_adapter_digest")" \
  >/dev/null
trap - EXIT
echo "HOST RELEASE GATE PASSED: $digest"
