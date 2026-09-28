'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MaterialItem } from '@/types';
import { videoCoverV2 } from '@/lib/api/videoCoverV2';
import { ApiError } from '@/lib/api/http-client';
import type { CoverAgentBridge, CoverOperation, CoverOperationStatus } from '@/lib/video-editing-agent/types';
import { CoverError, type CoverAspectRatio, type CoverAsset, type CoverDocument,
  type CoverRevision, type CoverSavedDraft } from '@/types/videoCover';
import { useLocale } from '@/contexts/LocaleContext';
import { registerPendingFlush } from '../projects/autosaveRegistry';
import { useTimelineStore } from '../timeline/store/useTimelineStore';
import { applyCoverTimelineAction } from '../timeline/store/actions/applyCover';
import { coverTimelineDigest } from './coverTimeline';
import { createCoverDocument } from './templates';
import type { CoverRenderHostRef } from './CoverRenderHost';
import { useCoverJobs } from './useCoverJobs';

interface DraftSession {
  projectId: string; document: CoverDocument | null; version: number;
  hash: string; edit: number; saved: number; active: boolean;
  inFlight?: Promise<CoverSavedDraft>; blocked: boolean;
}
interface Intent {
  sequence: number; digest: string; cancelled: boolean;
  handled?: boolean; operation?: CoverOperation;
  notify?: (status: CoverOperationStatus) => void;
}
function draftResult(session: DraftSession): CoverSavedDraft {
  if (!session.document) throw new CoverError('COVER_DRAFT_NOT_READY', 'COVER_DRAFT_NOT_READY');
  return { document: structuredClone(session.document), version: session.version,
    documentHash: session.hash };
}
export function useCoverController(options: {
  projectId?: string; projectName: string; aspectRatio: CoverAspectRatio;
  renderer: React.RefObject<CoverRenderHostRef | null>;
  registerMaterial: (material: MaterialItem) => void;
  onApplied: () => void; canGenerate?: boolean;
}) {
  const { t } = useLocale();
  const latest = useRef(options); latest.current = options;
  const [document, setDocument] = useState<CoverDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [assets, setAssets] = useState<CoverAsset[]>([]);
  const [revisions, setRevisions] = useState<CoverRevision[]>([]);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [canGenerate, setCanGenerate] = useState<boolean>();
  const session = useRef<DraftSession | undefined>(undefined);
  const intents = useRef(new Map<string, Intent>());
  const completed = useRef(new Set<string>());
  const manualJobs = useRef(new Map<string, { version: number; edit: number }>());
  const generationRequest = useRef<DraftSession | undefined>(undefined);
  const generationRetry = useRef<{ key: string; id: string } | undefined>(undefined);
  const pendingCancels = useRef(new Map<string, { projectId: string;
    notify?: (status: CoverOperationStatus) => void }>());
  const publishRequest = useRef<{ key: string; id: string } | undefined>(undefined);
  const operations = useRef<DraftSession | undefined>(undefined);
  const jobs = useCoverJobs(options.projectId);
  const appliedRevisionId = useTimelineStore(state => state.tracks)
    .flatMap(track => track.items).find(item => item.metadata?.role === 'video-cover')
    ?.metadata?.cover?.revisionId;
  const appliedRevision = revisions.find(revision => revision.id === appliedRevisionId);
  const draftChanged = !!appliedRevisionId && !!document &&
    (!appliedRevision || JSON.stringify(document) !== JSON.stringify(appliedRevision.document));
  const assetsRef = useRef(assets); assetsRef.current = assets;
  const digest = () => coverTimelineDigest(latest.current.projectId ?? '',
    useTimelineStore.getState().exportToData().tracks);

  const flushSession = useCallback(async (target: DraftSession): Promise<CoverSavedDraft> => {
    if (target.inFlight) return target.inFlight;
    if (target.blocked) throw new CoverError('COVER_VERSION_CONFLICT', 'COVER_VERSION_CONFLICT');
    const work = async () => {
      while (target.saved < target.edit || target.version === 0) {
        if (!target.document) throw new CoverError('COVER_DRAFT_NOT_READY', 'COVER_DRAFT_NOT_READY');
        const sequence = target.edit;
        if (target.active) setSaveState('saving');
        const result = await videoCoverV2.save(target.projectId,
          structuredClone(target.document), target.version);
        target.version = result.version; target.hash = result.documentHash;
        target.saved = sequence;
        if (target.edit === sequence) {
          target.document = result.document;
          if (target.active) setDocument(result.document);
        }
      }
      if (target.active) setSaveState('saved');
      return draftResult(target);
    };
    target.inFlight = work().catch(cause => {
      target.blocked = cause instanceof ApiError && cause.status === 409;
      if (target.active) { setError(cause); setSaveState('unsaved'); }
      throw cause;
    }).finally(() => { target.inFlight = undefined; });
    return target.inFlight;
  }, []);
  const flush = useCallback(async () => {
    if (!session.current) throw new CoverError('COVER_PROJECT_CHANGED', 'COVER_PROJECT_CHANGED');
    return flushSession(session.current);
  }, [flushSession]);

  useEffect(() => {
    session.current = undefined;
    operations.current = undefined; generationRequest.current = undefined;
    generationRetry.current = undefined; publishRequest.current = undefined;
    setDocument(null); setAssets([]); setRevisions([]);
    setError(undefined); setSaveState('saved'); setBusy(false);
    setLegacyAvailable(false); setCanGenerate(undefined);
    intents.current.clear(); completed.current.clear(); manualJobs.current.clear();
    if (!options.projectId) { setLoading(false); return; }
    const target: DraftSession = { projectId: options.projectId,
      document: null, version: 0, hash: '', edit: 0, saved: 0,
      active: true, blocked: false };
    session.current = target; setLoading(true);
    const abort = new AbortController();
    void videoCoverV2.get(target.projectId, abort.signal).then(snapshot => {
      if (!target.active) return;
      target.document = snapshot.document ?? createCoverDocument({
        aspectRatio: latest.current.aspectRatio, title: latest.current.projectName || t.coverStudio.emptyTitle,
        mode: snapshot.generationConfigured === false ? 'html' : 'mixed',
      });
      target.version = snapshot.version; target.hash = snapshot.documentHash ?? '';
      setDocument(target.document); setAssets(snapshot.assets ?? []);
      setRevisions(snapshot.appliedRevision ? [snapshot.appliedRevision,
        ...snapshot.revisions.filter(r => r.id !== snapshot.appliedRevision!.id)] : snapshot.revisions);
      setLegacyAvailable(snapshot.legacyAvailable);
      setCanGenerate(snapshot.generationConfigured);
      jobs.setJobs(snapshot.jobs); setLoading(false);
    }).catch(cause => { if (target.active) { setError(cause); setLoading(false); } });
    const unregister = registerPendingFlush(`cover:${target.projectId}`, async () => {
      if (target.document && target.edit > target.saved) await flushSession(target);
    });
    return () => {
      target.active = false; abort.abort();
      for (const intent of Array.from(intents.current.values())) intent.cancelled = true;
      if (target.document && target.edit > target.saved) {
        void flushSession(target).then(unregister).catch(cause => {
          console.error('[CoverStudio] closing draft save failed', cause);
          // Keep the failed flush registered so the existing close guard sees it.
        });
      } else unregister();
    };
  }, [options.projectId, flushSession]);

  const update = useCallback((next: CoverDocument) => {
    const target = session.current;
    if (!target?.active) return;
    target.document = next; target.edit++; setDocument(next); setSaveState('unsaved');
  }, []);
  useEffect(() => {
    const target = session.current;
    if (!target?.document || target.edit <= target.saved || target.blocked) return;
    const timer = setTimeout(() => void flushSession(target).catch(() => undefined), 300);
    return () => clearTimeout(timer);
  }, [document, flushSession]);
  useEffect(() => {
    if (document && document.aspectRatio !== options.aspectRatio) {
      update({ ...document, aspectRatio: options.aspectRatio });
    }
  }, [options.aspectRatio, document, update]);

  const reload = async (keepLocal = false) => {
    const target = session.current; if (!target?.active) return;
    const sequence = target.edit;
    // A GET issued before the pending PUT settles can restore an older version.
    // Failed saves already expose their error; explicit reload may recover them.
    if (target.inFlight) await target.inFlight.catch(() => undefined);
    if (!target.active) return;
    const version = target.version;
    const snapshot = await videoCoverV2.get(target.projectId);
    if (!target.active) return;
    if (target.edit !== sequence || target.version !== version) {
      throw new CoverError('COVER_VERSION_CONFLICT', 'COVER_VERSION_CONFLICT');
    }
    target.version = snapshot.version; target.hash = snapshot.documentHash ?? '';
    target.blocked = false; setError(undefined);
    setAssets(snapshot.assets ?? []); setRevisions(snapshot.revisions);
    setCanGenerate(snapshot.generationConfigured);
    setLegacyAvailable(snapshot.legacyAvailable);
    if (!keepLocal || !target.document) {
      target.document = snapshot.document ?? createCoverDocument({
        aspectRatio: latest.current.aspectRatio,
        title: latest.current.projectName || t.coverStudio.emptyTitle,
        mode: snapshot.generationConfigured === false ? 'html' : 'mixed',
      });
      target.saved = target.edit;
      setDocument(target.document); setSaveState('saved');
    } else { target.edit++; await flushSession(target); }
  };
  const selectAsset = async (asset: CoverAsset) => {
    const target = session.current; if (!target?.document) return;
    assetsRef.current = [...assetsRef.current.filter(a => a.assetId !== asset.assetId), asset];
    setAssets(previous => [...previous.filter(a => a.assetId !== asset.assetId), asset]);
    update({ ...target.document, background: { ...target.document.background,
      kind: 'asset', assetId: asset.assetId } });
    return flushSession(target);
  };
  const upload = async (file: Blob) => {
    const target = session.current; if (!target) return;
    const asset = await videoCoverV2.uploadAsset(target.projectId, file);
    if (target.active) await selectAsset(asset);
  };
  const copyAsset = async (url: string) => {
    const target = session.current; if (!target) return;
    const asset = await videoCoverV2.copyAsset(target.projectId, url);
    if (target.active) await selectAsset(asset);
  };
  const prepare = async () => {
    const target = session.current!;
    const draft = await flush();
    if (!target.active) throw new CoverError('COVER_PROJECT_CHANGED', 'COVER_PROJECT_CHANGED');
    const sequence = target.edit;
    const d = draft.document;
    if ((d.mode !== 'html' && d.background.kind !== 'asset') ||
      (d.mode !== 'ai' && !`${d.fields.title}${d.fields.subtitle}`.trim())) {
      throw new CoverError('COVER_DRAFT_NOT_READY', 'COVER_DRAFT_NOT_READY');
    }
    const blob = await latest.current.renderer.current?.render(d,
      assetsRef.current.find(a => a.assetId === d.background.assetId)?.url);
    if (!target.active) throw new CoverError('COVER_PROJECT_CHANGED', 'COVER_PROJECT_CHANGED');
    if (!blob) throw new CoverError('COVER_RENDER_FAILED', 'COVER_RENDER_FAILED');
    const key = `${target.projectId}:${draft.version}:${draft.documentHash}`;
    if (publishRequest.current?.key !== key) publishRequest.current = { key, id: crypto.randomUUID() };
    const revision = await videoCoverV2.publish(target.projectId, draft, blob, publishRequest.current.id);
    if (!target.active) throw new CoverError('COVER_PROJECT_CHANGED', 'COVER_PROJECT_CHANGED');
    setRevisions(previous => [revision, ...previous.filter(r => r.id !== revision.id)]);
    if (target.edit !== sequence) throw new CoverError('COVER_VERSION_CONFLICT', 'COVER_VERSION_CONFLICT');
    return revision;
  };
  const applyRevision = (revision: CoverRevision, durationFrames: number,
    rebuild = false) => {
    const projectId = latest.current.projectId;
    if (!projectId || revision.projectId !== projectId) {
      throw new CoverError('COVER_PROJECT_CHANGED', 'COVER_PROJECT_CHANGED');
    }
    if (revision.document.aspectRatio !== latest.current.aspectRatio) {
      throw new CoverError('COVER_ASPECT_MISMATCH', 'COVER_ASPECT_MISMATCH');
    }
    applyCoverTimelineAction({ getStore: useTimelineStore.getState,
      projectId, getProjectId: () => latest.current.projectId,
      revision, durationFrames, mode: rebuild ? 'rebuild' : 'apply',
      coverLabel: t.coverStudio.cover,
      reason: 'cover',
      registerMaterial: latest.current.registerMaterial });
    latest.current.onApplied();
  };
  const act = async (action: 'apply' | 'download' | 'rebuild') => {
    const target = session.current;
    if (!target?.active || operations.current) return;
    operations.current = target; setBusy(true); setError(undefined);
    try {
      const revision = await prepare();
      if (action === 'download') {
        const link = window.document.createElement('a');
        link.href = videoCoverV2.downloadUrl(revision.projectId, revision.id);
        link.download = 'cover.png'; link.click();
      } else applyRevision(revision, revision.document.durationFrames, action === 'rebuild');
    } catch (cause) {
      console.error('[CoverStudio] prepare/apply failed', cause);
      if (target.active) setError(cause);
      throw cause;
    }
    finally {
      if (operations.current === target) {
        operations.current = undefined; setBusy(false);
      }
    }
  };
  const generate = async () => {
    if (generationRequest.current) return;
    const target = session.current; if (!target?.active) return;
    generationRequest.current = target;
    try {
      const draft = await flushSession(target);
      if (!target.active || target !== session.current) return;
      const key = `${target.projectId}:${draft.version}:${draft.documentHash}`;
      if (generationRetry.current?.key !== key) generationRetry.current = { key, id: crypto.randomUUID() };
      const requestId = generationRetry.current.id;
      const sequence = target.edit;
      const job = await videoCoverV2.generate(target.projectId, draft, requestId);
      if (!target.active) return;
      generationRetry.current = undefined;
      manualJobs.current.set(job.jobId, { version: draft.version, edit: sequence });
      jobs.putJob(job);
    } catch (cause) {
      if (target.active && cause instanceof ApiError && cause.status < 500) generationRetry.current = undefined;
      if (target.active) setError(cause);
    }
    finally {
      if (generationRequest.current === target) generationRequest.current = undefined;
    }
  };
  const applyExisting = async (revisionId: string) => {
    const target = session.current;
    if (!target?.active || operations.current) return;
    operations.current = target; setBusy(true); setError(undefined);
    try {
      const revision = await videoCoverV2.getRevision(target.projectId, revisionId);
      if (!target.active || target !== session.current) return;
      applyRevision(revision, revision.document.durationFrames);
    } catch (cause) { if (target.active) setError(cause); throw cause; }
    finally {
      if (operations.current === target) {
        operations.current = undefined; setBusy(false);
      }
    }
  };
  const validIntent = (intent: Intent) => !intent.cancelled &&
    session.current?.active && intent.sequence === session.current.edit && intent.digest === digest();
  const waitForEditor = (intent: Intent) => new Promise<void>((resolve, reject) => {
    if (!useTimelineStore.getState().externalEditLock) { resolve(); return; }
    const timer = setTimeout(() => {
      unsubscribe(); reject(new CoverError('COVER_TIMELINE_CONFLICT', 'COVER_TIMELINE_CONFLICT'));
    }, 15000);
    const unsubscribe = useTimelineStore.subscribe(state => {
      if (!state.externalEditLock || !validIntent(intent)) {
        clearTimeout(timer); unsubscribe(); resolve();
      }
    });
  });
  const runIntent = async (intent: Intent) => {
    const target = session.current;
    const operation = intent.operation;
    if (!operation || !validIntent(intent) || !operation.applyWhenReady) {
      intent.notify?.({ state: 'not_applied' }); return;
    }
    try {
      intent.notify?.({ state: 'applying' });
      const revision = operation.action === 'apply_revision'
        ? await videoCoverV2.getRevision(operation.projectId, operation.revisionId) : await prepare();
      await waitForEditor(intent);
      if (!validIntent(intent)) { intent.notify?.({ state: 'not_applied' }); return; }
      applyRevision(revision, operation.durationFrames);
      intent.notify?.({ state: 'applied', revisionId: revision.id, thumbnailUrl: revision.url });
    } catch (cause) {
      if (target?.active) setError(cause);
      intent.notify?.({ state: 'error', error: String(cause) });
    }
  };
  const runtime = useRef({ runIntent, selectAsset, reload });
  runtime.current = { runIntent, selectAsset, reload };
  useEffect(() => {
    for (const job of jobs.jobs) {
      if (job.status === 'queued' || job.status === 'running' || completed.current.has(job.jobId)) continue;
      completed.current.add(job.jobId);
      setAssets(previous => [...previous, ...(job.assets ?? []).filter(a =>
        !previous.some(old => old.assetId === a.assetId))]);
      const target = session.current;
      const manual = manualJobs.current.get(job.jobId);
      const intent = Array.from(intents.current.values()).find(i =>
        i.operation?.action === 'watch_job' && i.operation.jobId === job.jobId);
      if (job.status !== 'succeeded') {
        intent?.notify?.({ state: job.status === 'cancelled' ? 'not_applied' : 'error',
          jobId: job.jobId, error: job.errorCode });
        continue;
      }
      intent?.notify?.({ state: 'image_ready', jobId: job.jobId, thumbnailUrl: job.assets?.[0]?.url });
      const expected = manual?.version ?? (intent?.operation?.action === 'watch_job'
        ? intent.operation.draftVersion : undefined);
      const allowed = manual ? manual.edit === target?.edit : intent && validIntent(intent);
      if (!job.assets?.[0] || !target || target.version !== expected ||
        target.saved !== target.edit || !allowed) {
        intent?.notify?.({ state: 'not_applied', jobId: job.jobId }); continue;
      }
      const selectedSequence = target.edit + 1;
      void runtime.current.selectAsset(job.assets[0]).then(draft => {
        if (intent && draft && target.active && target === session.current &&
          target.edit === selectedSequence && !intent.cancelled) {
          intent.sequence = selectedSequence;
          if (intent.operation?.action === 'watch_job') intent.operation.draftVersion = draft.version;
          return runtime.current.runIntent(intent);
        } else intent?.notify?.({ state: 'not_applied' });
      }).catch(cause => {
        if (target.active) setError(cause);
        intent?.notify?.({ state: 'error', error: String(cause) });
      });
    }
  }, [jobs.jobs]);

  const bridge: CoverAgentBridge = useMemo(() => ({
    beginOperation(id, _toolName, notify) {
      const projectId = latest.current.projectId;
      if (!intents.current.has(id)) intents.current.set(id, {
        sequence: session.current?.edit ?? -1, digest: digest(), cancelled: false,
        notify: status => notify?.({ ...status, projectId }),
      });
    },
    async handleCoverOperation(operation, notify) {
      if (operation.projectId !== latest.current.projectId) return;
      const originalNotify = notify;
      notify = status => originalNotify({ ...status, projectId: operation.projectId });
      const intent = intents.current.get(operation.operationId);
      if (!intent || intent.cancelled || intent.handled) { notify({ state: 'not_applied' }); return; }
      intent.handled = true; intent.operation = operation; intent.notify = notify;
      const target = session.current;
      notify({ state: 'submitted', jobId: operation.action === 'watch_job' ? operation.jobId : undefined });
      const canAdopt = validIntent(intent) && target?.edit === target?.saved;
      if (canAdopt) await runtime.current.reload();
      if (!target?.active || target !== session.current) return;
      if (operation.action === 'watch_job') {
        const job = await videoCoverV2.getJob(operation.projectId, operation.jobId);
        if (!target.active || target !== session.current) return;
        jobs.putJob(job);
        if (!canAdopt || !validIntent(intent)) notify({ state: 'not_applied', jobId: job.jobId });
      } else if (!canAdopt || !validIntent(intent) ||
        (operation.action === 'prepare_draft' && session.current?.version !== operation.draftVersion)) {
        notify({ state: 'not_applied' });
      } else await runtime.current.runIntent(intent);
    },
    cancelOperations({ cancelJobs, operationIds }: { cancelJobs: boolean; operationIds?: string[] }) {
      for (const [id, intent] of Array.from(intents.current)) {
        if (operationIds && !operationIds.includes(id)) continue;
        intent.cancelled = true;
        if (cancelJobs && latest.current.projectId) {
          const projectId = latest.current.projectId;
          pendingCancels.current.set(id, { projectId, notify: intent.notify });
          void videoCoverV2.cancelByRequest(projectId, `agent:${id}`)
            .then(() => pendingCancels.current.delete(id))
            .catch(() => intent.notify?.({ state: 'cancel_unconfirmed' }));
        }
      }
    },
  }), [options.projectId]);
  useEffect(() => {
    const retry = () => {
      for (const [id, pending] of Array.from(pendingCancels.current)) {
        void videoCoverV2.cancelByRequest(pending.projectId, `agent:${id}`)
          .then(() => { pendingCancels.current.delete(id); pending.notify?.({ state: 'not_applied' }); })
          .catch(() => pending.notify?.({ state: 'cancel_unconfirmed' }));
      }
    };
    window.addEventListener('online', retry);
    const timer = setInterval(retry, 10000);
    return () => { window.removeEventListener('online', retry); clearInterval(timer); };
  }, []);
  return { document, update, loading, saveState, error, setError, busy, assets,
    revisions, legacyAvailable, canGenerate, draftChanged, jobs: jobs.jobs, bridge, flush, reload, upload,
    copyAsset, selectAsset, generate, act, applyExisting,
    cancel: async (id: string) => {
      const target = session.current; if (!target) return;
      manualJobs.current.delete(id);
      for (const intent of Array.from(intents.current.values())) {
        if (intent.operation?.action === 'watch_job' && intent.operation.jobId === id) {
          intent.cancelled = true; intent.notify?.({ state: 'not_applied', jobId: id });
        }
      }
      const job = await videoCoverV2.cancelJob(target.projectId, id);
      if (target.active && target === session.current) jobs.putJob(job);
    },
    importLegacy: async () => {
      const target = session.current; if (!target?.active) return;
      const sequence = target.edit;
      await videoCoverV2.importLegacy(target.projectId, crypto.randomUUID());
      if (!target.active || target !== session.current) return;
      if (target.edit !== sequence) {
        throw new CoverError('COVER_VERSION_CONFLICT', 'COVER_VERSION_CONFLICT');
      }
      await reload();
    },
  };
}
export type CoverController = ReturnType<typeof useCoverController>;
