export const OBSERVATION_BATCH_CONTRACT = 'groundwork.observation-batch/v1';
export const OBSERVATION_BATCH_ARTIFACT = 'observation-batch.json';

export const OBSERVATION_FIELDS = [
  'platformSurfaces',
  'architecture.components',
  'architecture.contracts',
  'architecture.relationships',
  'architecture.flows',
  'architecture.specDependencies',
  'governance.constraints',
  'governance.decisions',
  'governance.owners',
  'changeSet.current',
  'changeSet.proposed',
  'changeSet.verified',
];

const OBSERVATION_FIELD_SET = new Set(OBSERVATION_FIELDS);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const PLATFORM_TARGETS = new Set([
  'web', 'vite-spa', 'ios', 'macos', 'claude-plugin', 'agent-system',
]);

function slug(value, fallback) {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function requireId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a stable ID.`);
  }
  return value;
}

function requireSafePath(value, label) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || /^[A-Za-z]:/.test(value)
      || value.includes('\\') || value.split('/').some((part) => !part || part === '..')) {
    throw new Error(`${label} must be a safe relative POSIX path.`);
  }
  return value;
}

function normalizeSourceRef(ref, index) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
    throw new Error(`sourceRefs[${index}] must be an object.`);
  }
  if (ref.kind === 'survey') return { kind: 'survey', nodeId: requireId(ref.nodeId, `sourceRefs[${index}].nodeId`) };
  if (ref.kind === 'agent') return { kind: 'agent', id: requireId(ref.id, `sourceRefs[${index}].id`) };
  if (ref.kind === 'repo' || ref.kind === 'artifact') {
    return { kind: ref.kind, path: requireSafePath(ref.path, `sourceRefs[${index}].path`) };
  }
  throw new Error(`sourceRefs[${index}].kind is unsupported.`);
}

export function normalizeStructuredObservation(raw, { provenance, fallbackSourceRefs = [] } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('observation must be an object.');
  if (!raw.target || typeof raw.target !== 'object' || Array.isArray(raw.target)) {
    throw new Error('observation.target must be an object.');
  }
  const field = raw.target.field;
  if (!OBSERVATION_FIELD_SET.has(field)) throw new Error(`Unsupported observation field: ${field}`);
  const entityId = requireId(raw.target.entityId, 'observation.target.entityId');
  if (!Object.prototype.hasOwnProperty.call(raw, 'value')) throw new Error('observation.value is required.');
  if (!['observed', 'decided', 'assumed'].includes(provenance)) {
    throw new Error('observation provenance must be forced by the live route.');
  }
  const sourceRefs = (Array.isArray(raw.sourceRefs) && raw.sourceRefs.length
    ? raw.sourceRefs
    : fallbackSourceRefs).map(normalizeSourceRef);
  if (!sourceRefs.length) throw new Error('observation requires at least one safe source ref.');
  if (raw.confidence !== undefined && (!Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)) {
    throw new Error('observation confidence must be between 0 and 1.');
  }
  return {
    id: requireId(raw.id || `obs-${slug(field, 'field')}-${slug(entityId, 'entity')}`, 'observation.id'),
    target: { field, entityId },
    value: structuredClone(raw.value),
    provenance,
    sourceRefs,
    ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
  };
}

export function upsertStructuredObservation(state, observation) {
  const key = `${observation.target.field}:${observation.target.entityId}`;
  state.structuredObservations = (Array.isArray(state.structuredObservations)
    ? state.structuredObservations
    : []).filter((item) => `${item?.target?.field}:${item?.target?.entityId}` !== key);
  state.structuredObservations.push(structuredClone(observation));
}

function platformObservation(state) {
  const answer = (Array.isArray(state.answers) ? state.answers : [])
    .find((item) => item?.feedsField === 'platformTarget');
  const rawTarget = answer && (Array.isArray(answer.value) ? answer.value[0] : answer.value);
  if (!PLATFORM_TARGETS.has(rawTarget)) return null;
  const provenance = String(answer.provenance || '').toLowerCase();
  if (!['observed', 'decided', 'assumed'].includes(provenance)) return null;
  const entityId = `surface-${slug(rawTarget, 'web')}`;
  return {
    id: `obs-${entityId}`,
    target: { field: 'platformSurfaces', entityId },
    value: {
      id: entityId,
      platform: rawTarget,
      role: 'primary',
      name: `${state.project || 'Product'} ${rawTarget}`,
      interactionModes: [],
      featureIds: [],
      provenance,
    },
    provenance,
    sourceRefs: [{ kind: 'survey', nodeId: requireId(answer.nodeId || 'platform', 'platform answer nodeId') }],
    ...(Number.isFinite(answer.confidence) ? { confidence: answer.confidence } : {}),
  };
}

export function buildObservationBatch(state, requiredFields = OBSERVATION_FIELDS) {
  const observations = (Array.isArray(state.structuredObservations)
    ? structuredClone(state.structuredObservations)
    : []);
  if (!observations.some((item) => item?.target?.field === 'platformSurfaces')) {
    const projected = platformObservation(state);
    if (projected) observations.push(projected);
  }
  observations.sort((left, right) => (
    OBSERVATION_FIELDS.indexOf(left.target.field) - OBSERVATION_FIELDS.indexOf(right.target.field)
    || left.target.entityId.localeCompare(right.target.entityId)
    || left.id.localeCompare(right.id)
  ));
  const resolved = new Set(observations.map((item) => item.target.field));
  const unresolved = requiredFields
    .filter((field) => OBSERVATION_FIELD_SET.has(field) && !resolved.has(field))
    .map((field) => ({ field, reason: `No explicit ${field} observation was recorded.` }));
  return {
    contract: OBSERVATION_BATCH_CONTRACT,
    specId: requireId(state.specId || `spec-${slug(state.project, 'requirements')}`, 'state.specId'),
    observations,
    unresolved,
  };
}

export function writeObservationBatch(fs, path, out, batch) {
  fs.mkdirSync(out, { recursive: true });
  const destination = path.join(out, OBSERVATION_BATCH_ARTIFACT);
  const tmp = path.join(out, `.observation-batch.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(batch, null, 2));
  fs.renameSync(tmp, destination);
  return destination;
}
