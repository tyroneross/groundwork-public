import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('guided ideation remains a named option over the canonical design flow', () => {
  const readme = read('README.md');
  const router = read('references/router.md');
  const contract = read('references/guided-ideation.md');

  for (const experience of [
    'Guided ideation',
    'Chat planning',
    'Mockup comparison',
    'Live canvas',
  ]) {
    assert.match(readme, new RegExp(experience, 'i'));
    assert.match(router, new RegExp(experience, 'i'));
  }

  assert.match(router, /references\/guided-ideation\.md/);
  assert.match(router, /same canonical Spec/i);
  assert.match(contract, /not a fifth canonical flow/i);
  assert.match(contract, /editable examples/i);
  assert.match(contract, /upper bound[\s\S]*questions remaining/i);
  assert.match(contract, /save partial input/i);
  assert.match(contract, /persistent stage rail/i);
  assert.match(contract, /indigo planning[\s\S]*frame/i);
  assert.match(contract, /flashing and jitter/i);
  assert.match(contract, /next action remains visible/i);
});
