import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/http-client';
import { getEffectDraft, saveEffectDraft } from '@/lib/api/effects';
import { createEffectDocument } from '@/lib/effects/catalog';
import { validateEffectDocument } from '@/lib/effects/validation';
import { canonicalEffectValue, clearPending, readPending,
  writePending } from '@/lib/effects/pendingWrites';
import type { PendingIdentity } from '@/lib/effects/pendingWrites';
import { EffectError } from '@/types/effects';
import type { EffectDraft, EffectDraftWrite, EffectPendingSave,
  EffectWorkingDraft } from '@/types/effects';

export type DraftSaveState = 'saved' | 'editing' | 'saving'
  | 'error' | 'conflict' | 'uncertain';
const equal = (a: unknown, b: unknown) =>
  canonicalEffectValue(a) === canonicalEffectValue(b);
const asWorking = (draft: EffectDraft): EffectWorkingDraft =>
  ({ name: draft.name, document: draft.document });
export interface EffectMemoryDraft {
  draftId: string; baseVersion: number | null; working: EffectWorkingDraft;
  expectedIdentity?: PendingIdentity;
  isConflicted?: boolean;
}

/** Frozen requests and newer local input have separate durable lifetimes. */
export function useEffectsDraft(projectId: string | undefined, enabled: boolean,
  canWrite: () => boolean = () => true,
  getEditorEpoch: () => number = () => 0) {
  const [working, setWorking] = useState<EffectWorkingDraft>(() => ({
    document: createEffectDocument(), name: '' }));
  const [draft, setDraft] = useState<EffectDraft>();
  const [status, setStatus] = useState<DraftSaveState>('saved');
  const [error, setError] = useState<Error>();
  const [restored, setRestored] = useState(false);
  const state = useRef({ projectId, epoch: 0, id: '',
    working, dirty: false, blocked: false, hasPending: false, needsRecovery: false,
    baseVersion: null as number | null,
    memoryIdentity: undefined as PendingIdentity | undefined,
    memoryConflict: false,
    saved: undefined as EffectDraft | undefined,
    localChain: Promise.resolve(),
    saveChain: Promise.resolve<EffectDraft | undefined>(undefined),
    past: [] as EffectWorkingDraft[], future: [] as EffectWorkingDraft[],
  });
  const permission = useRef(canWrite); permission.current = canWrite;
  const editor = useRef(getEditorEpoch); editor.current = getEditorEpoch;
  const current = state.current;
  useEffect(() => () => { state.current.epoch++; }, []);
  if (current.projectId !== projectId) {
    current.projectId = projectId; current.epoch++; current.id = '';
    current.baseVersion = null;
    current.memoryConflict = false; current.memoryIdentity = undefined;
    current.dirty = false; current.saved = undefined; current.hasPending = false;
    current.blocked = false; current.localChain = Promise.resolve();
    current.needsRecovery = false;
    current.saveChain = Promise.resolve(undefined);
  }
  const capture = useCallback(() => {
    const generation = current.epoch, project = current.projectId;
    const permit = permission.current;
    const editorEpoch = editor.current();
    return { project, isCurrent: () => current.epoch === generation
      && project === current.projectId && permit()
      && editor.current() === editorEpoch };
  }, [current]);
  const report = (failure: unknown, uncertain = false) => {
    const next = failure instanceof Error ? failure : new Error(String(failure));
    current.blocked = failure instanceof ApiError && failure.status === 409
      || next.message === 'EFFECT_VERSION_CONFLICT';
    setError(next); setStatus(current.blocked ? 'conflict'
      : uncertain ? 'uncertain' : 'error');
  };
  const requireWrite = (isCurrent: () => boolean) => {
    if (!isCurrent()) throw new EffectError('EFFECT_LOCAL_STATE_UNAVAILABLE');
  };
  // Keep network out of this queue so newer typing persists during lost replies.
  const mutate = async (change: (record?: EffectPendingSave)
    => EffectPendingSave | undefined) => {
    const { project, isCurrent } = capture();
    if (!project) throw new EffectError('EFFECT_NOT_FOUND');
    const execute = async () => {
      requireWrite(isCurrent);
      const snapshot = await readPending(project, 'save');
      requireWrite(isCurrent);
      if (snapshot.record && snapshot.record.draftId !== current.id) {
        throw new EffectError('EFFECT_VERSION_CONFLICT');
      }
      const next = change(snapshot.record);
      if (equal(next, snapshot.record)) return;
      if (next) await writePending(project, 'save', next, snapshot.identity);
      else if (snapshot.record) await clearPending(project, 'save', snapshot.identity);
      requireWrite(isCurrent);
    };
    const pending = current.localChain.catch(() => {}).then(execute);
    current.localChain = pending; await pending;
  };
  const makeRecord = (record?: EffectPendingSave): EffectPendingSave => ({
    schemaVersion: 1, projectId: current.projectId!, draftId: current.id,
    recordRevision: (record?.recordRevision ?? 0) + 1,
    baseVersion: record ? record.baseVersion
      : current.saved?.version ?? current.baseVersion,
    ...(record?.pendingWrite ? { pendingWrite: record.pendingWrite } : {}),
    working: structuredClone(current.working),
    createdAt: record?.createdAt ?? new Date().toISOString(),
  });
  const persistWorking = () => {
    if (current.memoryConflict) return Promise.reject(
      new EffectError('EFFECT_VERSION_CONFLICT'));
    return mutate(record => {
    if (!current.dirty) return record?.pendingWrite ? record : undefined;
    return makeRecord(record);
    });
  };
  const load = (next: EffectWorkingDraft, persisted?: EffectDraft,
    stableId?: string) => {
    if (current.hasPending) throw new EffectError('EFFECT_SUBMISSION_UNKNOWN');
    current.epoch++; current.saved = persisted;
    current.baseVersion = persisted?.version ?? null;
    current.memoryConflict = false; current.memoryIdentity = undefined;
    current.id = stableId ?? persisted?.id ?? crypto.randomUUID();
    current.working = next; current.dirty = !persisted; current.blocked = false;
    current.needsRecovery = false;
    current.past = []; current.future = [];
    current.saveChain = Promise.resolve(undefined);
    setDraft(persisted); setWorking(next); setError(undefined); setRestored(false);
    setStatus(persisted ? 'saved' : 'editing');
  };
  const edit = (next: EffectWorkingDraft, record = true) => {
    if (current.saved?.readOnly || !permission.current()) return;
    if (record) { current.past = [...current.past, current.working].slice(-50);
      current.future = []; }
    current.working = next; current.dirty = true; setWorking(next);
    setStatus(current.blocked ? 'conflict'
      : current.hasPending || current.needsRecovery ? 'uncertain' : 'editing');
  };
  const validateResult = (result: EffectDraft, write: EffectDraftWrite) => {
    const version = write.kind === 'create' ? 1 : write.expectedVersion + 1;
    if (result.id !== write.draftId || result.projectId !== current.projectId
      || result.readOnly || result.deletedAt || result.version !== version
      || !equal(asWorking(result), { name: write.name, document: write.document })) {
      throw new EffectError('EFFECT_VERSION_CONFLICT');
    }
  };
  const confirm = async (result: EffectDraft, write: EffectDraftWrite) => {
    const { isCurrent } = capture();
    let discarded = false;
    await mutate(record => {
      if (!record?.pendingWrite || !equal(record.pendingWrite, write)) {
        throw new EffectError('EFFECT_VERSION_CONFLICT');
      }
      const latest = record.working === undefined ? undefined : current.working;
      discarded = latest === undefined;
      if (!latest || equal(latest, asWorking(result))) return undefined;
      return { ...makeRecord(record), baseVersion: result.version,
        pendingWrite: undefined, working: structuredClone(latest) };
    });
    requireWrite(isCurrent);
    current.hasPending = false; current.saved = result;
    current.baseVersion = result.version;
    current.dirty = !discarded && !equal(current.working, asWorking(result));
    setDraft(result); setStatus(current.dirty ? 'editing' : 'saved');
    setError(undefined);
  };
  const executeSave = async () => {
    const { project, isCurrent } = capture();
    requireWrite(isCurrent);
    if (!project || !current.id) return undefined;
    if (current.blocked) throw new EffectError('EFFECT_VERSION_CONFLICT');
    if (current.needsRecovery) throw new EffectError('EFFECT_SUBMISSION_UNKNOWN');
    if (!current.dirty && !current.hasPending) return current.saved;
    let frozen: EffectDraftWrite | undefined;
    let replay = false;
    try {
      await persistWorking(); requireWrite(isCurrent);
      const snapshot = await readPending(project, 'save');
      requireWrite(isCurrent);
      replay = Boolean(snapshot.record?.pendingWrite);
      frozen = snapshot.record?.pendingWrite;
      if (!frozen) {
        validateEffectDocument(current.working.document);
        if (Array.from(current.working.name).length > 100) {
          throw new EffectError('EFFECT_INVALID_ARGUMENT');
        }
        frozen = structuredClone(current.saved ? { kind: 'update' as const,
          draftId: current.id, expectedVersion: current.saved.version,
          ...current.working } : { kind: 'create' as const,
          draftId: current.id, ...current.working });
        const write = frozen;
        await mutate(record => ({ ...makeRecord(record), pendingWrite: write }));
      }
      current.hasPending = true; setStatus('saving'); requireWrite(isCurrent);
      let result: EffectDraft;
      if (replay && frozen.kind === 'create') {
        try { result = await getEffectDraft(project, frozen.draftId); }
        catch (failure) {
          if (!(failure instanceof ApiError) || failure.status !== 404) throw failure;
          requireWrite(isCurrent);
          result = await saveEffectDraft({ projectId: project, write: frozen });
        }
      } else result = await saveEffectDraft({ projectId: project, write: frozen });
      requireWrite(isCurrent); validateResult(result, frozen);
      await confirm(result, frozen); requireWrite(isCurrent); return result;
    } catch (failure) {
      if (isCurrent()) {
        const known = failure instanceof ApiError && failure.status >= 400
          && failure.status < 500;
        if (frozen && known && !replay) {
          await mutate(record => record ? { ...makeRecord(record),
            pendingWrite: undefined } : undefined);
          current.hasPending = false;
        }
        report(failure, current.hasPending);
      }
      throw failure;
    }
  };
  const saveRef = useRef(executeSave); saveRef.current = executeSave;
  const save = useCallback(() => {
    const generation = state.current.epoch;
    const pending = state.current.saveChain.catch(() => undefined).then(() => {
      if (generation !== state.current.epoch) return undefined;
      return saveRef.current();
    });
    state.current.saveChain = pending; return pending;
  }, []);
  const latest = useRef({ persistWorking, report });
  latest.current = { persistWorking, report };
  useEffect(() => {
    if (!enabled || !current.dirty || !current.id) return;
    const { isCurrent } = capture();
    const attempt = latest.current;
    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      void attempt.persistWorking().then(() => {
        if (isCurrent() && !state.current.hasPending && !state.current.blocked
          && !state.current.needsRecovery) return save();
      }).catch(failure => {
        if (isCurrent()) attempt.report(failure,
          state.current.hasPending || state.current.needsRecovery);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [working, enabled, save, current.dirty, current.id,
    current.needsRecovery, capture]);
  const restore = async (onWorking?: () => void, memory?: EffectMemoryDraft) => {
    const { project, isCurrent } = capture();
    if (!project) return false;
    let record: EffectPendingSave | undefined;
    let identity: PendingIdentity | undefined;
    let storageFailure: unknown;
    if (!memory && current.memoryConflict) throw new EffectError('EFFECT_VERSION_CONFLICT');
    try {
      const snapshot = await readPending(project, 'save');
      record = snapshot.record; identity = snapshot.identity;
    }
    catch (failure) { if (!memory) throw failure; storageFailure = failure; }
    requireWrite(isCurrent);
    if (memory) {
      current.memoryIdentity = memory.expectedIdentity;
      current.memoryConflict = Boolean(memory.isConflicted)
        || !memory.expectedIdentity || !equal(identity, memory.expectedIdentity);
      if (current.memoryConflict && !storageFailure) {
        storageFailure = new EffectError('EFFECT_VERSION_CONFLICT');
      }
      if (record && record.draftId !== memory.draftId) {
        storageFailure = new EffectError('EFFECT_VERSION_CONFLICT');
        record = undefined;
      }
      record = { schemaVersion: 1, projectId: project, draftId: memory.draftId,
        recordRevision: 1, baseVersion: memory.baseVersion,
        createdAt: new Date().toISOString(), ...record,
        working: memory.working };
    }
    if (!record) return false;
    const next = current.id === record.draftId && current.dirty
      ? current.working : record.working ?? record.pendingWrite!;
    current.id = record.draftId;
    current.baseVersion = record.baseVersion;
    current.working = { name: next.name, document: next.document };
    current.hasPending = Boolean(record.pendingWrite); current.dirty = true;
    current.needsRecovery = true;
    current.blocked = false; current.saved = undefined;
    setWorking(current.working); setRestored(true);
    setDraft(undefined); setStatus('uncertain'); onWorking?.();
    if (storageFailure) { report(storageFailure, true); return true; }
    try {
      const server = await getEffectDraft(project, record.draftId);
      requireWrite(isCurrent);
      if (server.id !== record.draftId || server.projectId !== project) {
        throw new EffectError('EFFECT_VERSION_CONFLICT');
      }
      current.needsRecovery = false;
      if (record.pendingWrite) {
        if (server.version === (record.pendingWrite.kind === 'create' ? 1
          : record.pendingWrite.expectedVersion + 1)) {
          validateResult(server, record.pendingWrite);
          await confirm(server, record.pendingWrite);
        } else if (record.pendingWrite.kind === 'update'
          && server.version === record.baseVersion && !server.readOnly) {
          current.saved = server; setDraft(server);
        } else throw new EffectError('EFFECT_VERSION_CONFLICT');
      } else {
        if (server.id !== record.draftId || server.version !== record.baseVersion || server.readOnly
          || server.projectId !== project) throw new EffectError('EFFECT_VERSION_CONFLICT');
        current.saved = server; setDraft(server); setStatus('editing');
      }
    } catch (failure) {
      if (isCurrent() && failure instanceof ApiError && failure.status === 404
        && record.baseVersion === null) {
        current.needsRecovery = false;
        setStatus(record.pendingWrite ? 'uncertain' : 'editing'); return true;
      }
      if (isCurrent()) {
        current.needsRecovery = true;
        report(failure, true);
      }
    }
    return true;
  };
  const discard = async () => {
    if (!current.memoryConflict) await mutate(record => {
      if (!record?.pendingWrite) return undefined;
      return { ...record, recordRevision: record.recordRevision + 1,
        working: undefined };
    });
    else current.hasPending = false;
    current.memoryConflict = false; current.memoryIdentity = undefined;
    current.epoch++; current.dirty = false;
    setStatus(current.hasPending ? 'uncertain' : 'saved');
  };
  const discardConflict = async () => {
    if (current.memoryConflict) throw new EffectError('EFFECT_VERSION_CONFLICT');
    if (!current.blocked) throw new EffectError('EFFECT_SUBMISSION_UNKNOWN');
    const { project, isCurrent } = capture();
    const snapshot = project && await readPending(project, 'save');
    requireWrite(isCurrent);
    if (snapshot && snapshot.record?.draftId !== current.id) {
      throw new EffectError('EFFECT_VERSION_CONFLICT');
    }
    if (project && snapshot && snapshot.record?.pendingWrite) {
      try {
        const result = await saveEffectDraft({ projectId: project,
          write: snapshot.record.pendingWrite });
        requireWrite(isCurrent);
        validateResult(result, snapshot.record.pendingWrite);
        await confirm(result, snapshot.record.pendingWrite);
      } catch (failure) {
        // A replay rejected by CAS cannot later overwrite the observed server
        // version. Network errors still leave the old write unresolved.
        if (!(failure instanceof ApiError) || failure.status !== 409) throw failure;
      }
    }
    requireWrite(isCurrent);
    await mutate(() => undefined);
    current.hasPending = false; current.dirty = false; current.epoch++;
    current.needsRecovery = false;
    current.memoryConflict = false; current.memoryIdentity = undefined;
  };
  const flush = async () => {
    const { isCurrent } = capture();
    let result = await save();
    while (isCurrent() && current.dirty && !current.blocked) result = await save();
    requireWrite(isCurrent); return result;
  };
  const undo = (redo = false) => {
    const next = (redo ? current.future : current.past).pop(); if (!next) return;
    (redo ? current.past : current.future).push(current.working); edit(next, false);
  };
  return { ...working, draft, status, error, restored, load, edit, save, flush,
    restore, discard, discardConflict, persistWorking, undo,
    getCurrent: () => current.working, getId: () => current.id,
    getBaseVersion: () => current.baseVersion,
    getMemoryIdentity: () => current.memoryIdentity,
    hasMemoryConflict: () => current.memoryConflict,
    hasPending: () => current.hasPending, isDirty: () => current.dirty,
    dirty: current.dirty, canUndo: current.past.length > 0,
    canRedo: current.future.length > 0 };
}
