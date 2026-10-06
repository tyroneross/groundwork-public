// Durable local design workspace. Hosted adapters can preserve this record model.
import { randomUUID, createHash } from 'node:crypto';
import { projectStore, projectRoot } from '../project/project-store.mjs';

// Saved work lives in the one per-repo Groundwork store:
// <repo>/.groundwork/workspace.json, written through the shared store library so
// Designer, the project pane, the CLI and agents take the same lock and read the
// same file. A target inside <repo>/.designdoc (Designer's usual output dir) or
// inside <repo>/.groundwork maps to <repo>. Until the first change, a workspace
// left at a legacy location (.designdoc/.groundwork-workspace/ or
// .groundwork-workspace/) is read in place; the first change writes the store
// copy and records the migration. Legacy files are never modified.
export function workspaceStore(target) {
  const store = projectStore(projectRoot(target), { tool: 'designer-server' });
  const defaultReview = { suggestions: true, optionCount: 3, layout: 'compare', fidelity: 'low' };
  function normalizeReview(review = {}) {
    return {
      suggestions: review.suggestions !== false,
      optionCount: Math.min(5, Math.max(2, Number(review.optionCount) || 3)),
      layout: review.layout === 'single' ? 'single' : 'compare',
      fidelity: review.fidelity === 'polished' ? 'polished' : 'low',
    };
  }
  function check(value) {
    if (value.version !== 1 || !['notes', 'alternatives', 'sources'].every(k => Array.isArray(value[k]))) throw new Error('Unsupported workspace record');
    value.review = normalizeReview(value.review || defaultReview);
    return value;
  }
  function read() { return check(store.readWorkspace().value); }
  function change(fn) {
    return store.changeWorkspace(value => fn(check(value)));
  }
  return {
    read,
    enqueue(text, id = randomUUID(), review) {
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Feedback must contain 1–4000 characters');
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid message ID');
      return change(v => {
        const old = v.notes.find(n => n.id === id);
        if (old) { if (old.text !== text) throw new Error('Message ID already contains different text'); return { ...old, duplicate: true }; }
        if (v.notes.filter(n => n.status === 'received').reduce((sum, n) => sum + n.text.length, 0) + text.length > 32000) throw new Error('Pending feedback is full; let the agent process it before sending more');
        if (v.notes.length >= 2000) throw new Error('Workspace note limit reached; export and start a new workspace');
        const note = { id, text, review: normalizeReview(review || v.review), status: 'received', createdAt: new Date().toISOString() };
        v.notes.push(note); return note;
      });
    },
    configureReview(review) {
      return change(v => { v.review = normalizeReview(review); return v.review; });
    },
    // Through the project store, so a note the pane mirrored into saved work
    // (same id in project.json) reads as processed everywhere, not only here.
    acknowledge(ids) {
      store.acknowledge(ids);
    },
    addAlternative(mockup, rationale = '') {
      if (!mockup || typeof mockup.html !== 'string' || Buffer.byteLength(JSON.stringify(mockup)) > 256000) throw new Error('Design must contain HTML and fit within 256 KB');
      return change(v => {
        const id = createHash('sha256').update(JSON.stringify(mockup)).digest('hex').slice(0,24);
        if (!v.alternatives.some(a => a.id === id)) {
          if (v.alternatives.length >= 100) throw new Error('Workspace alternative limit reached');
          v.alternatives.push({ id, mockup, rationale, createdAt: new Date().toISOString() });
        }
        return id;
      });
    },
    select(id) {
      return change(v => { if (!v.alternatives.some(a => a.id === id)) throw new Error('Unknown design'); v.selectedId = id; return id; });
    },
    source(label, kind = 'user-context') {
      if (typeof label !== 'string' || !label.trim() || label.length > 4000) throw new Error('Source description must contain 1–4000 characters');
      return change(v => {
        if (v.sources.reduce((sum, source) => sum + source.label.length, 0) + label.length > 32000) throw new Error('Source context exceeds 32000 characters');
        if (v.sources.length >= 100) throw new Error('Workspace source limit reached');
        const allowedKinds = new Set(['user-context', 'suggested-input', 'suggested-output']);
        const entry = { id: randomUUID(), kind: allowedKinds.has(kind) ? kind : 'user-context', label: label.trim(), status: 'provided', createdAt: new Date().toISOString() };
        v.sources.push(entry); return entry;
      });
    },
    exportPacket() {
      const v = read(); const selected = v.alternatives.find(a => a.id === v.selectedId);
      if (!selected) throw new Error('Select a design before exporting');
      return {
        schemaVersion: 'groundwork.visual-handoff/v1', selected,
        sources: v.sources, feedback: v.notes,
        limitations: ['Static visual prototype; application interactions are not verified.', 'Token proposals are not automatically applied by selecting a design.', 'Update the canonical Spec and run the Groundwork emitter to produce a digest-bound build request.'],
        nextAction: 'Use the selected HTML, rationale, sources and feedback to update screens, behavior contracts and design tokens in the canonical Spec. Generate and validate the builder handoff before implementation.',
      };
    },
  };
}
