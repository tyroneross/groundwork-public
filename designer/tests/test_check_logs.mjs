import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check.sh', import.meta.url));
for (const mode of ['failure', 'required skip']) {
  test('check runner retains early diagnostics after ' + mode, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-log-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const command = path.join(dir, 'check.sh');
    fs.writeFileSync(command, '#!/bin/bash\necho ORIGINAL_EARLY_DIAGNOSTIC\n' + (mode === 'required skip' ? 'echo "# SKIP required fixture"\n' : '') + 'for ((i=0;i<150;i++)); do echo "later output $i"; done\nexit ' + (mode === 'failure' ? '1' : '0') + '\n');
    const result = spawnSync('bash', ['-c', 'source "$1"; run "fixture gate" bash "$2"', '--', script, command], { encoding: 'utf8', env: { ...process.env, TMPDIR: dir }, timeout: 5000 });
    assert.equal(result.status, 1, result.stderr);
    const match = result.stderr.match(/Full check log retained at: (.+)/);
    assert.ok(match, 'failure should report the retained log path');
    assert.match(fs.readFileSync(match[1], 'utf8'), /ORIGINAL_EARLY_DIAGNOSTIC/);
    assert.match(result.stderr, /FAILED: fixture gate/);
  });
}
