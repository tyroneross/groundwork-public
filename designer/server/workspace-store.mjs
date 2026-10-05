// Durable local design workspace. Hosted adapters can preserve this record model.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export function workspaceStore(target) {
  const dir = path.join(target, '.groundwork-workspace');
  const file = path.join(dir, 'workspace.json');
  const safe = (p) => {
    if (fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Workspace symlinks are not supported');
  };
  const defaultReview = { suggestions: true, optionCount: 3, layout: 'compare', fidelity: 'low' };
  function normalizeReview(review = {}) {
    return {
      suggestions: review.suggestions !== false,
      optionCount: Math.min(5, Math.max(2, Number(review.optionCount) || 3)),
      layout: review.layout === 'single' ? 'single' : 'compare',
      fidelity: review.fidelity === 'polished' ? 'polished' : 'low',
    };
  }
  function read() {
    safe(dir); safe(file);
    if (!fs.existsSync(file)) return { version: 1, notes: [], alternatives: [], selectedId: null, sources: [], review: { ...defaultReview } };
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.version !== 1 || !['notes', 'alternatives', 'sources'].every(k => Array.isArray(value[k]))) throw new Error('Unsupported workspace record');
    value.review = normalizeReview(value.review);
    return value;
  }
  function change(fn) {
    safe(dir); fs.mkdirSync(dir, { recursive: true });
    const lock = path.join(dir, 'write.lock');
    // Exclusive file locking fails visibly; another writer is never overwritten.
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Workspace writer lock exists at ${lock}. Retry after the other writer finishes; if it crashed, stop all writers before removing this lock.`);
      throw error;
    }
    const temp = path.join(dir, `workspace-${randomUUID()}.tmp`);
    try {
      const value = read(); const result = fn(value);
      fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, file);
      return result;
    } finally {
      fs.closeSync(fd); fs.rmSync(lock);
      fs.rmSync(temp, { force: true });
    }
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
    acknowledge(ids) {
      return change(v => { for (const note of v.notes) if (ids.includes(note.id)) { note.status = 'processed'; note.processedAt = new Date().toISOString(); } });
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
