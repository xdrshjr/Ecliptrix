import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/http-client';
import { saveEffectDraft } from '@/lib/api/effects';
import { createEffectDocument } from '@/lib/effects/catalog';
import type { EffectDocument, EffectDraft } from '@/types/effects';

interface WorkingDraft { document: EffectDocument; name: string }
export type DraftSaveState = 'saved' | 'editing' | 'saving' | 'error' | 'conflict';

/** One serial write chain owns the CAS version, independent of React effects. */
export function useEffectsDraft(projectId: string | undefined, enabled: boolean) {
  const [working, setWorking] = useState<WorkingDraft>(() => ({
    document: createEffectDocument(), name: '' }));
  const [draft, setDraft] = useState<EffectDraft>();
  const [status, setStatus] = useState<DraftSaveState>('saved');
  const [error, setError] = useState<Error>();
  const workingRef = useRef(working); workingRef.current = working;
  const saved = useRef<EffectDraft | undefined>(undefined);
  const dirty = useRef(false);
  const blocked = useRef(false);
  const epoch = useRef(0);
  const history = useRef<{ past: WorkingDraft[]; future: WorkingDraft[] }>(
    { past: [], future: [] });
  const chain = useRef<Promise<EffectDraft | undefined>>(Promise.resolve(undefined));
  const project = useRef(projectId);
  if (project.current !== projectId) {
    project.current = projectId; epoch.current++; saved.current = undefined;
    dirty.current = false;
  }
  const load = useCallback((next: WorkingDraft, persisted?: EffectDraft) => {
    epoch.current++; saved.current = persisted; setDraft(persisted);
    dirty.current = !persisted; workingRef.current = next; setWorking(next);
    blocked.current = false;
    history.current = { past: [], future: [] };
    setError(undefined); setStatus(persisted ? 'saved' : 'editing');
  }, []);
  const edit = useCallback((next: WorkingDraft, record = true) => {
    if (saved.current?.readOnly) return;
    if (record) history.current = { future: [], past:
      [...history.current.past, workingRef.current].slice(-50) };
    workingRef.current = next; dirty.current = true;
    setWorking(next); setStatus(blocked.current ? 'conflict' : 'editing');
  }, []);
  const save = useDraftSaver({ projectId, workingRef, saved, dirty, blocked, epoch,
    chain, setDraft, setStatus, setError });
  useEffect(() => {
    if (!enabled || !dirty.current || status === 'conflict') return;
    const timer = setTimeout(() => { void save().catch(() => {}); }, 500);
    return () => clearTimeout(timer);
  }, [working, enabled, save, status === 'conflict']);
  const undo = (redo = false) => {
    const from = redo ? history.current.future : history.current.past;
    const next = from.pop();
    if (!next) return;
    (redo ? history.current.past : history.current.future)
      .push(workingRef.current);
    edit(next, false);
  };
  const flush = async () => {
    let result = await save();
    while (dirty.current && !blocked.current) result = await save();
    return result;
  };
  return { ...working, draft, status, error, load, edit, save, flush, undo,
    getCurrent: () => workingRef.current,
    isDirty: () => dirty.current,
    dirty: dirty.current,
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0 };
}

interface SaverOptions {
  projectId?: string;
  workingRef: React.MutableRefObject<WorkingDraft>;
  saved: React.MutableRefObject<EffectDraft | undefined>;
  dirty: React.MutableRefObject<boolean>;
  epoch: React.MutableRefObject<number>;
  chain: React.MutableRefObject<Promise<EffectDraft | undefined>>;
  blocked: React.MutableRefObject<boolean>;
  setDraft: (draft: EffectDraft) => void;
  setStatus: (status: DraftSaveState) => void;
  setError: (error: Error | undefined) => void;
}

function useDraftSaver(options: SaverOptions) {
  const current = useRef(options); current.current = options;
  return useCallback(() => {
    const owner = current.current;
    const generation = owner.epoch.current;
    const execute = async () => {
      if (owner.epoch.current !== generation) return undefined;
      if (!owner.dirty.current) return owner.saved.current;
      if (owner.blocked.current) throw new Error('EFFECT_VERSION_CONFLICT');
      if (!owner.projectId) throw new Error('EFFECT_NOT_FOUND');
      const snapshot = owner.workingRef.current;
      owner.setStatus('saving');
      try {
        const result = await saveEffectDraft({ ...snapshot,
          projectId: owner.projectId, draftId: owner.saved.current?.id,
          expectedVersion: owner.saved.current?.version });
        if (owner.epoch.current !== generation) return undefined;
        owner.saved.current = result; owner.setDraft(result);
        owner.dirty.current = owner.workingRef.current !== snapshot;
        owner.setStatus(owner.dirty.current ? 'editing' : 'saved');
        owner.setError(undefined);
        return result;
      } catch (error) {
        if (owner.epoch.current === generation) {
          owner.blocked.current = error instanceof ApiError && error.status === 409;
          owner.setStatus(error instanceof ApiError && error.status === 409
            ? 'conflict' : 'error');
          owner.setError(error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
      }
    };
    const pending = owner.chain.current.catch(() => undefined).then(execute);
    owner.chain.current = pending;
    return pending;
  }, []);
}
