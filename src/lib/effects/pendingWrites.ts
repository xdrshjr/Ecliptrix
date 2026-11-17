import { z } from 'zod';
import { EffectError } from '@/types/effects';
import type { EffectPendingSave, EffectPendingSubmission } from '@/types/effects';
import { getEffectTemplate } from './catalog';
import { validateEffectDocument } from './validation';

type PendingKind = 'submission' | 'save';
interface Records { submission: EffectPendingSubmission; save: EffectPendingSave }
export type PendingIdentity = { kind: 'absent' } | {
  kind: PendingKind; fingerprint: string;
};
export interface PendingSnapshot<K extends PendingKind> {
  record?: Records[K]; identity: PendingIdentity;
}
export interface EffectEditorLease {
  isActive: () => boolean; release: () => void;
}
const INVALIDATED = 'ecliptrix-effects-project-invalidated';
const finite = z.number().finite();
const text = z.string();
// Local edits preserve out-of-range values for correction; no URLs or extra
// fields can cross this boundary. Frozen writes use the full catalog validator.
const workingDocument = z.object({
  schemaVersion: z.literal(1), templateId: text, templateVersion: finite,
  canvas: z.object({ width: finite, height: finite, fps: z.literal(30) }).strict(),
  durationFrames: finite, seed: finite,
  content: z.object({ title: text, subtitle: text }).strict(),
  palette: z.object({ background: text, foreground: text, accent: text }).strict(),
  typography: z.object({ family: z.enum(['sans', 'serif', 'mono']),
    scale: finite, align: z.enum(['left', 'center', 'right']) }).strict(),
  motion: z.object({ speed: finite, intensity: finite }).strict(),
  params: z.record(text, z.union([text, finite, z.array(finite)])),
  inputs: z.array(z.object({ slot: text, assetId: z.uuid(),
    kind: z.enum(['image', 'video']), fit: z.enum(['cover', 'contain']),
    focalX: finite, focalY: finite, index: finite.optional(),
    trimStartSeconds: finite.optional() }).strict()),
}).strict().refine(document => {
  try {
    const template = getEffectTemplate(document.templateId);
    const parameters = Object.entries(template.parameterSchema);
    return template.version === document.templateVersion
      && Object.keys(document.params).length === parameters.length
      && parameters.every(([key, schema]) => {
        const value = document.params[key];
        if (schema.type === 'array') return Array.isArray(value);
        return typeof value === (schema.type === 'string' ? 'string' : 'number');
      });
  } catch { return false; }
}, 'incompatible working template structure');
const writeFields = { draftId: z.uuid(), name: text, document: workingDocument };
const frozenWrite = z.discriminatedUnion('kind', [
  z.object({ ...writeFields, kind: z.literal('create') }).strict(),
  z.object({ ...writeFields, kind: z.literal('update'),
    expectedVersion: z.number().int().positive() }).strict(),
]);
const common = { schemaVersion: z.literal(1), projectId: text.min(1),
  draftId: z.uuid(), createdAt: z.iso.datetime() };
const submissionSchema = z.object({ ...common, requestId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  profile: z.enum(['mp4-1080p', 'mp4-720p']),
  state: z.enum(['submitting', 'uncertain', 'accepted']),
  jobId: text.min(1).optional(),
}).strict().refine(record => record.state !== 'accepted' || !!record.jobId);
const saveSchema = z.object({ ...common,
  recordRevision: z.number().int().positive(),
  baseVersion: z.number().int().positive().nullable(),
  pendingWrite: frozenWrite.optional(),
  working: z.object({ name: text, document: workingDocument }).strict().optional(),
}).strict().superRefine((record, context) => {
  const write = record.pendingWrite;
  if ((!write && !record.working) || (write && (write.draftId !== record.draftId
    || (write.kind === 'create' ? record.baseVersion !== null
      : write.expectedVersion !== record.baseVersion)))) {
    context.addIssue({ code: 'custom', message: 'inconsistent save record' });
  }
  if (write) {
    try {
      validateEffectDocument(write.document);
      if (Array.from(write.name).length > 100) throw new Error('name');
    } catch { context.addIssue({ code: 'custom', message: 'invalid write' }); }
  }
});

/** Deterministic comparison ignores object insertion order, never field values. */
export function canonicalEffectValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEffectValue).join(',')}]`;
  if (value && typeof value === 'object') return '{' + Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalEffectValue(item)}`)
    .join(',') + '}';
  return JSON.stringify(value);
}
const unavailable = () => new EffectError('EFFECT_LOCAL_STATE_UNAVAILABLE');
const conflict = () => new EffectError('EFFECT_VERSION_CONFLICT');
const storageKey = (projectId: string, kind: PendingKind) =>
  `ecliptrix:effects:${kind === 'submission' ? 'pending' : 'save'}:v1:${projectId}`;

function validateRecord<K extends PendingKind>(projectId: string, kind: K,
  value: unknown): Records[K] {
  try {
    const serialized = JSON.stringify(value);
    if (new TextEncoder().encode(serialized).length > 256 * 1024) throw unavailable();
    const record = (kind === 'submission' ? submissionSchema : saveSchema)
      .parse(value);
    if (record.projectId !== projectId) throw unavailable();
    return record as Records[K];
  } catch { throw unavailable(); }
}

function readRecord<K extends PendingKind>(projectId: string, kind: K)
  : PendingSnapshot<K> {
  try {
    const raw = localStorage.getItem(storageKey(projectId, kind));
    if (raw === null) return { identity: { kind: 'absent' } };
    const record = validateRecord(projectId, kind, JSON.parse(raw));
    return { record, identity: { kind,
      fingerprint: canonicalEffectValue(record) } };
  } catch { throw unavailable(); }
}

async function withRecordLock<T>(projectId: string, action: () => T): Promise<T> {
  if (!navigator.locks?.request) throw unavailable();
  return navigator.locks.request(`ecliptrix-effects:${projectId}`,
    { mode: 'exclusive' }, () => action());
}

/** Read a validated project record without mutating damaged storage. */
export async function readPending<K extends PendingKind>(projectId: string,
  kind: K): Promise<PendingSnapshot<K>> {
  return withRecordLock(projectId, () => readRecord(projectId, kind));
}

/** Compare and replace one key inside a short Web Lock; never await network. */
export async function writePending<K extends PendingKind>(projectId: string,
  kind: K, record: Records[K], expectedIdentity: PendingIdentity)
  : Promise<PendingSnapshot<K>> {
  return withRecordLock(projectId, () => {
    try {
      if (localStorage.getItem(`${INVALIDATED}:${projectId}`) !== null) {
        throw new EffectError('EFFECT_NOT_FOUND');
      }
    } catch (error) {
      if (error instanceof EffectError) throw error;
      throw unavailable();
    }
    const current = readRecord(projectId, kind);
    if (canonicalEffectValue(current.identity)
      !== canonicalEffectValue(expectedIdentity)) throw conflict();
    validateRecord(projectId, kind, record);
    if (kind === 'save' && current.record &&
      (record as EffectPendingSave).recordRevision
        !== (current.record as EffectPendingSave).recordRevision + 1) throw conflict();
    if (kind === 'submission' && current.record) {
      const frozen = (item: EffectPendingSubmission) => ({ ...item,
        state: undefined, jobId: undefined });
      if (canonicalEffectValue(frozen(current.record as EffectPendingSubmission))
        !== canonicalEffectValue(frozen(record as EffectPendingSubmission))) {
        throw conflict();
      }
    }
    try { localStorage.setItem(storageKey(projectId, kind), JSON.stringify(record)); }
    catch { throw unavailable(); }
    return readRecord(projectId, kind);
  });
}

/** Delete only the exact record observed by the caller. */
export async function clearPending(projectId: string, kind: PendingKind,
  expectedIdentity: PendingIdentity): Promise<void> {
  await withRecordLock(projectId, () => {
    if (canonicalEffectValue(readRecord(projectId, kind).identity)
      !== canonicalEffectValue(expectedIdentity)) throw conflict();
    try { localStorage.removeItem(storageKey(projectId, kind)); }
    catch { throw unavailable(); }
  });
}

/** Only a successful project deletion may clear both keys and revoke editors. */
export async function clearProjectPending(projectId: string): Promise<void> {
  // Notify before I/O so storage failure cannot leave a deleted editor writable.
  window.dispatchEvent(new CustomEvent(INVALIDATED, { detail: projectId }));
  await withRecordLock(projectId, () => {
    try {
      localStorage.setItem(`${INVALIDATED}:${projectId}`, crypto.randomUUID());
      localStorage.removeItem(storageKey(projectId, 'submission'));
      localStorage.removeItem(storageKey(projectId, 'save'));
    } catch { throw unavailable(); }
  });
}

/** Hold an exclusive editor lock until explicit release or browser teardown. */
export async function acquireEffectEditor(projectId: string)
  : Promise<EffectEditorLease | undefined> {
  if (!navigator.locks?.request) throw unavailable();
  return new Promise((resolve, reject) => {
    void navigator.locks.request(`ecliptrix-effects-editor:${projectId}`,
      { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock) { resolve(undefined); return; }
        if (localStorage.getItem(`${INVALIDATED}:${projectId}`) !== null) {
          resolve(undefined); return;
        }
        return new Promise<void>(releaseLock => {
          let active = true;
          const release = () => {
            active = false;
            window.removeEventListener(INVALIDATED, invalidate);
            window.removeEventListener('storage', storage);
            releaseLock();
          };
          const invalidate = (event: Event) => {
            if ((event as CustomEvent).detail === projectId) release();
          };
          const storage = (event: StorageEvent) => {
            if (event.key === `${INVALIDATED}:${projectId}`) release();
          };
          window.addEventListener(INVALIDATED, invalidate);
          window.addEventListener('storage', storage);
          resolve({ isActive: () => active, release });
        });
      }).catch(() => reject(unavailable()));
  });
}
