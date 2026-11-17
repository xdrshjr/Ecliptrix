import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/http-client';
import { getEffectJobByRequest, submitEffectJob } from '@/lib/api/effects';
import { clearPending, readPending, writePending } from '@/lib/effects/pendingWrites';
import type { EffectPendingSubmission, EffectRenderJob } from '@/types/effects';
import { EffectError } from '@/types/effects';

interface SubmissionOptions {
  projectId?: string;
  canWrite: () => boolean;
  getEditorEpoch?: () => number;
  watch: (job: EffectRenderJob) => void;
}
type SubmissionState = 'idle' | 'submitting' | 'accepted' | 'uncertain' | 'rejected';

/** Durable request ownership survives modal close and process reload. */
export function useEffectsSubmission(options: SubmissionOptions) {
  const [state, setState] = useState<SubmissionState>('idle');
  const [error, setError] = useState<Error>();
  const [record, setRecord] = useState<EffectPendingSubmission>();
  const owner = useRef(options); owner.current = options;
  const epoch = useRef(0);
  const previous = useRef(options.projectId);
  const flight = useRef(false);
  if (previous.current !== options.projectId) {
    previous.current = options.projectId; epoch.current++; flight.current = false;
  }
  useEffect(() => {
    const generation = epoch.current;
    setState('idle'); setRecord(undefined); setError(undefined);
    if (options.projectId) void readPending(options.projectId, 'submission')
      .then(snapshot => {
        if (generation !== epoch.current) return;
        setRecord(snapshot.record);
        if (snapshot.record) setState(snapshot.record.state === 'accepted'
          ? 'accepted' : 'uncertain');
      }).catch(error => {
        if (generation === epoch.current) { setError(error); setState('uncertain'); }
      });
    return () => { epoch.current++; };
  }, [options.projectId]);

  const execute = useCallback(async (input?: {
    draftId: string; expectedVersion: number;
    profile?: 'mp4-1080p' | 'mp4-720p';
  }) => {
    const projectId = owner.current.projectId;
    if (!projectId || flight.current) return;
    const generation = epoch.current;
    const editorEpoch = owner.current.getEditorEpoch?.();
    const isCurrent = () => generation === epoch.current
      && projectId === owner.current.projectId;
    const canWrite = () => isCurrent() && owner.current.canWrite()
      && editorEpoch === owner.current.getEditorEpoch?.();
    flight.current = true; setError(undefined);
    let frozen: EffectPendingSubmission | undefined;
    let wasUnknown = !input;
    try {
      if (!canWrite()) throw new EffectError('EFFECT_LOCAL_STATE_UNAVAILABLE');
      let snapshot = await readPending(projectId, 'submission');
      if (!canWrite()) return;
      frozen = snapshot.record;
      if (frozen) wasUnknown = true;
      else if (input) {
        frozen = { schemaVersion: 1, projectId, ...input,
          profile: input.profile ?? 'mp4-1080p', requestId: crypto.randomUUID(),
          createdAt: new Date().toISOString(), state: 'submitting' };
        snapshot = await writePending(projectId, 'submission', frozen,
          snapshot.identity);
      } else { setState('idle'); setRecord(undefined); return; }
      setRecord(frozen); setState('submitting');
      if (!canWrite()) return;
      let job: EffectRenderJob;
      const request = { projectId, draftId: frozen.draftId,
        expectedVersion: frozen.expectedVersion, requestId: frozen.requestId,
        profile: frozen.profile };
      if (wasUnknown) {
        try { job = await getEffectJobByRequest(projectId, frozen.requestId); }
        catch (lookupError) {
          if (!(lookupError instanceof ApiError) || lookupError.status !== 404
            || frozen.state === 'accepted') throw lookupError;
          if (!canWrite()) return;
          job = await submitEffectJob(request);
        }
      } else job = await submitEffectJob(request);
      if (!isCurrent()) return;
      if (!job.id || job.projectId !== projectId || job.requestId !== frozen.requestId
        || job.draftId !== frozen.draftId
        || job.draftVersion !== frozen.expectedVersion
        || !['queued', 'running', 'cancelling', 'succeeded', 'failed',
          'cancelled', 'interrupted'].includes(job.status)) {
        throw new EffectError('EFFECT_SUBMISSION_UNKNOWN');
      }
      owner.current.watch(job);
      setState('accepted');
      if (!canWrite()) return;
      const latest = await readPending(projectId, 'submission');
      if (!canWrite() || latest.record?.requestId !== frozen.requestId) return;
      const accepted = { ...frozen, state: 'accepted' as const, jobId: job.id };
      const committed = await writePending(projectId, 'submission', accepted,
        latest.identity);
      setRecord(accepted);
      await clearPending(projectId, 'submission', committed.identity);
      if (isCurrent()) { setRecord(undefined); setState('idle'); }
    } catch (failure) {
      if (!isCurrent()) return;
      setError(failure instanceof Error ? failure : new Error(String(failure)));
      const rejected = !wasUnknown && failure instanceof ApiError
        && failure.status >= 400 && failure.status < 500 && failure.status !== 409;
      if (frozen && canWrite()) {
        try {
          const latest = await readPending(projectId, 'submission');
          if (canWrite() && latest.record?.requestId === frozen.requestId) {
            if (rejected) await clearPending(projectId, 'submission', latest.identity);
            else if (latest.record.state !== 'accepted') {
              await writePending(projectId, 'submission',
                { ...latest.record, state: 'uncertain' }, latest.identity);
            }
          }
        } catch { /* Original error remains visible; original record is retained. */ }
      }
      setState(rejected ? 'rejected' : 'uncertain');
      if (rejected) setRecord(undefined);
    } finally { if (isCurrent()) flight.current = false; }
  }, []);
  return { state, error, record, pending: Boolean(record)
    || state === 'uncertain' || state === 'submitting',
  submit: execute, recover: () => execute() };
}
