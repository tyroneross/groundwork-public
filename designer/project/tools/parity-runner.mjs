// Parity runner (JS side). Twin: parity_runner.py. Used by designer/tests/test_project_parity.py.
//   node designer/project/tools/parity-runner.mjs ops <fixture.json> <root>
//   node designer/project/tools/parity-runner.mjs read <root>
//   node designer/project/tools/parity-runner.mjs summary <decisions.json>
// Prints canonical JSON. Every string equal to the store root becomes "<ROOT>".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectStore, StoreError, canonical, decisionSummary } from '../project-store.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const READ_CLOCK = '2026-10-06T13:00:00.000Z';

function counterClock(start, stepMs) {
  const t0 = Date.parse(start); let i = 0;
  return () => new Date(t0 + stepMs * (i++)).toISOString();
}
function counterIds() { let i = 0; return (p) => `${p}${String(++i).padStart(4, '0')}`; }

function resolve(v, results) {
  if (typeof v === 'string' && v.startsWith('$') && v.includes('.')) {
    const [idx, ...rest] = v.slice(1).split('.');
    return results[Number(idx)][rest.join('.')];
  }
  if (Array.isArray(v)) return v.map(x => resolve(x, results));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, results)]));
  return v;
}
function normRoot(v, root) {
  if (typeof v === 'string') return v === root ? '<ROOT>' : v;
  if (Array.isArray(v)) return v.map(x => normRoot(x, root));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normRoot(x, root)]));
  return v;
}

function runOp(s, op) {
  switch (op.op) {
    case 'init': return s.init();
    case 'readWorkspace': return s.readWorkspace();
    case 'upsertDraft': return s.upsertDraft({ id: op.id ?? null, section: op.section, text: op.text, target: op.target ?? null, origin: op.origin ?? null, revision: op.revision ?? null });
    case 'submitFeedback': return s.submitFeedback(op.id, op.text ?? null);
    case 'addFeedback': return s.addFeedback({ section: op.section, text: op.text, target: op.target ?? null, origin: op.origin ?? null, submit: op.submit ?? true, id: op.id ?? null });
    case 'deleteDraft': return s.deleteDraft(op.id, op.revision ?? null);
    case 'acknowledge': return s.acknowledge(op.ids);
    case 'addPreference': return s.addPreference({ text: op.text, scope: op.scope ?? 'repo', provenance: op.provenance ?? null, supersedes: op.supersedes ?? null });
    case 'appendAlternative': return s.changeWorkspace(ws => { ws.alternatives.push(op.alternative); }) ?? null;
    case 'selectDesign': return s.selectDesign(op.id);
    case 'recordArtifact': return s.recordArtifact(op.kind, op.path, op.meta ?? null);
    case 'recordMigration': return s.recordMigration(op.entry);
    case 'writeBoard': return s.writeBoard(op.slug, fs.readFileSync(path.join(REPO, op.file)));
    case 'listFeedback': return s.listFeedback({ section: op.section ?? null, status: op.status ?? null });
    case 'listPreferences': return s.listPreferences({ includeSuperseded: op.includeSuperseded ?? false });
    case 'snapshot': return s.snapshot();
    case 'agentContract': return s.agentContract();
    default: throw new Error(`unknown op ${op.op}`);
  }
}

function runOps(fixture, root) {
  const fx = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const s = projectStore(root, { now: counterClock(fx.clock.start, fx.clock.stepMs), newId: counterIds(), tool: 'parity' });
  const results = [];
  for (const op of fx.ops) {
    try { results.push(runOp(s, resolve(op, results))); } catch (e) {
      if (!(e instanceof StoreError)) throw e;
      results.push({ error: e.code });
    }
  }
  return normRoot(results, s.root);
}

function readAll(root) {
  const s = projectStore(root, { now: () => READ_CLOCK, newId: counterIds(), tool: 'parity' });
  return normRoot({
    snapshot: s.snapshot(), contract: s.agentContract(), feedback: s.listFeedback(),
    preferences: s.listPreferences({ includeSuperseded: true }), boards: s.listBoards(), project: s.readProject(),
    workspace: s.readWorkspace(),
  }, s.root);
}

const [cmd, a, b] = process.argv.slice(2);
let out;
if (cmd === 'ops') out = runOps(a, b);
else if (cmd === 'read') out = readAll(a);
else if (cmd === 'summary') out = decisionSummary(JSON.parse(fs.readFileSync(a, 'utf8')));
else { process.stderr.write(`unknown command ${cmd}\n`); process.exit(2); }
process.stdout.write(canonical(out));
