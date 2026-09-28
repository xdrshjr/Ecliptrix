'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MaterialItem } from '@/types';
import { videoCoverV2 } from '@/lib/api/videoCoverV2';
import { ApiError } from '@/lib/api/http-client';
import type { CoverAgentBridge, CoverOperation,
  CoverOperationStatus } from '@/lib/video-editing-agent/types';
import { CoverError, type CoverAspectRatio, type CoverAsset,
  type CoverDocument, type CoverRevision, type CoverSavedDraft,
  type CoverSnapshot, type CoverIssue, type CoverOperationSource,
  type CoverActivity, type CoverRestoreUndo, type CoverPendingSubmission,
  type CoverRevisionEntry } from '@/types/videoCover';
import { useLocale } from '@/contexts/LocaleContext';
import { registerPendingFlush } from '../projects/autosaveRegistry';
import { useTimelineStore } from '../timeline/store/useTimelineStore';
import { applyCoverTimelineAction } from '../timeline/store/actions/applyCover';
import { coverTimelineDigest } from './coverTimeline';
import { createCoverDocument } from './templates';
import { normalizeCoverIssue, isDraftConflict } from './coverRecovery';
import { mergeCoverAssets, mergeCoverRevisions,
  selectCoverRevisions } from './coverResourceUtils';
import type { CoverRenderHostRef } from './CoverRenderHost';
import { useCoverJobs } from './useCoverJobs';

interface DraftSession {
  projectId: string; document: CoverDocument | null; version: number;
  hash: string; edit: number; saved: number; active: boolean;
  inFlight?: Promise<CoverSavedDraft>; blocked: boolean;
  conflict?: unknown; backgroundIntent: number; barrier?: OperationOwner;
  resourceSequence: number;
}
interface OperationOwner {
  session: DraftSession; operationId: string; kind: string;
  edit: number; backgroundSequence: number;
}
interface Intent {
  sequence: number; backgroundSequence: number; digest: string;
  cancelled: boolean; handled?: boolean; operation?: CoverOperation;
  notify?: (status: CoverOperationStatus) => void;
}
interface ErrorContext {
  session: DraftSession; operationId: string; edit: number;
  backgroundSequence: number; operation?: CoverOperationSource;
  revisionId?: string;
}
const stale = () => new CoverError('COVER_VERSION_CONFLICT',
  'COVER_OPERATION_STALE');
function draftResult(target: DraftSession): CoverSavedDraft {
  if (!target.document) throw new CoverError('COVER_DRAFT_NOT_READY',
    'COVER_DRAFT_NOT_READY');
  return { document: structuredClone(target.document),
    version: target.version, documentHash: target.hash };
}
function backgroundChanged(a: CoverDocument | null, b: CoverDocument) {
  return !a || a.mode !== b.mode || a.templateId !== b.templateId ||
    a.aspectRatio !== b.aspectRatio ||
    JSON.stringify(a.background) !== JSON.stringify(b.background);
}
function decodeImage(url: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timer); image.onload = null; image.onerror = null;
      if (error) reject(error); else resolve();
    };
    const failure = () => finish(new CoverError('COVER_ASSET_MISSING',
      'COVER_ASSET_MISSING'));
    const timer = setTimeout(() => finish(new CoverError('COVER_RENDER_FAILED',
      'COVER_IMAGE_TIMEOUT')), 10000);
    image.onload = () => finish(); image.onerror = failure; image.src = url;
    if (typeof image.decode === 'function') image.decode().then(
      () => finish(), failure);
  });
}
// The controller owns one session transaction boundary; keeping these small
// operations together prevents independent hooks from bypassing the same lock.
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
  const [error, setRawError] = useState<unknown>();
  const [issue, setIssue] = useState<CoverIssue>();
  const [notice, setNotice] = useState<'image-imported' |
    'image-import-failed' | 'restore-reflow'>();
  const issueContext = useRef<ErrorContext | undefined>(undefined);
  const handledErrors = useRef(new Set<unknown>());
  const [activity, setActivity] = useState<CoverActivity>('idle');
  const [assets, setAssets] = useState<CoverAsset[]>([]);
  const assetsRef = useRef<CoverAsset[]>([]);
  const [revisions, setRevisions] = useState<CoverRevision[]>([]);
  const revisionsRef = useRef<CoverRevision[]>([]);
  const [availability, setAvailability] = useState<Record<string,
    Omit<CoverRevisionEntry, 'id' | 'revision'> | undefined>>({});
  const revisionRequests = useRef(new Map<string, Promise<void>>());
  const revisionDownloads = useRef(new Set<string>());
  const revisionAttempted = useRef(new Set<string>());
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [canGenerate, setCanGenerate] = useState<boolean>();
  const capability = useRef<boolean | undefined>(undefined);
  const session = useRef<DraftSession | undefined>(undefined);
  const intents = useRef(new Map<string, Intent>());
  const completed = useRef(new Set<string>());
  const manualJobs = useRef(new Map<string, {
    version: number; edit: number; backgroundSequence: number }>());
  const pendingSubmission = useRef<CoverPendingSubmission | undefined>(undefined);
  const [hasUnknownSubmission, setHasUnknownSubmission] = useState(false);
  const [submittingGeneration, setSubmittingGeneration] = useState(false);
  const generationRequest = useRef<DraftSession | undefined>(undefined);
  const pendingCancels = useRef(new Map<string, { projectId: string;
    notify?: (status: CoverOperationStatus) => void }>());
  const publishRequest = useRef<{ key: string; id: string } | undefined>(undefined);
  const operations = useRef<OperationOwner | undefined>(undefined);
  const [restoreUndo, setRestoreUndo] = useState<CoverRestoreUndo>();
  const [templateUndo, setTemplateUndo] = useState<CoverRestoreUndo>();
  const [intentRevision, setIntentRevision] = useState(0);
  const jobs = useCoverJobs(options.projectId);
  const appliedRevisionId = useTimelineStore(state => state.tracks)
    .flatMap(track => track.items).find(item => item.metadata?.role === 'video-cover')
    ?.metadata?.cover?.revisionId;
  const appliedRevision = revisions.find(value => value.id === appliedRevisionId);
  const draftChanged = appliedRevisionId && (!appliedRevision ||
    availability[appliedRevisionId]?.metadataStatus === 'unavailable') ? undefined :
    !!appliedRevision && !!document &&
    JSON.stringify(document) !== JSON.stringify(appliedRevision.document);
  const isCurrent = (target: DraftSession) => target.active &&
    target === session.current;
  const digest = () => coverTimelineDigest(latest.current.projectId ?? '',
    useTimelineStore.getState().exportToData().tracks);
  const context = (target: DraftSession): ErrorContext => ({ session: target,
    operationId: crypto.randomUUID(), edit: target.edit,
    backgroundSequence: target.backgroundIntent });
  const reportError = (cause: unknown, source: CoverOperationSource,
    owner: ErrorContext, extra: { revisionId?: string;
      retryAction?: 'apply' | 'download' | 'rebuild' } = {}) => {
    if (handledErrors.current.has(cause)) return;
    handledErrors.current.add(cause);
    if (!isCurrent(owner.session)) return;
    if ((source === 'upload' || source === 'copy') &&
      owner.backgroundSequence !== owner.session.backgroundIntent) {
      setNotice('image-import-failed'); return;
    }
    if (issueContext.current && issueContext.current.operationId !==
      owner.operationId && (issueContext.current.edit > owner.edit ||
      issueContext.current.backgroundSequence > owner.backgroundSequence)) return;
    issueContext.current = { ...owner, operation: source,
      revisionId: extra.revisionId }; setRawError(cause);
    setIssue(normalizeCoverIssue(cause, source, owner.session.projectId,
      { id: owner.operationId, ...extra }));
  };
  const clearError = (owner?: ErrorContext, source?: CoverOperationSource) => {
    if (owner && issueContext.current?.operationId !== owner.operationId) return;
    if (source && issueContext.current?.operation !== source) return;
    issueContext.current = undefined; setRawError(undefined); setIssue(undefined);
  };
  const setError = (cause: unknown) => {
    if (!cause) { clearError(); return; }
    if (handledErrors.current.has(cause) || !session.current) return;
    reportError(cause, 'apply', context(session.current));
  };
  const mergeAssets = (incoming: CoverAsset[]) => {
    assetsRef.current = mergeCoverAssets(assetsRef.current, incoming);
    setAssets(assetsRef.current);
  };
  const mergeRevisions = (incoming: CoverRevision[]) => {
    revisionsRef.current = mergeCoverRevisions(revisionsRef.current, incoming);
    setRevisions(revisionsRef.current);
  };
  const mergeSnapshot = (snapshot: CoverSnapshot) => {
    mergeAssets(snapshot.assets ?? []);
    mergeRevisions(snapshot.appliedRevision ?
      [...snapshot.revisions, snapshot.appliedRevision] : snapshot.revisions);
    capability.current = snapshot.generationConfigured;
    setCanGenerate(snapshot.generationConfigured);
    setLegacyAvailable(snapshot.legacyAvailable);
  };
  const advanceBackground = (target: DraftSession) => {
    target.backgroundIntent++; setIntentRevision(value => value + 1);
    setRestoreUndo(undefined); setTemplateUndo(undefined); setNotice(undefined);
  };
  const writeDocument = (target: DraftSession, next: CoverDocument) => {
    target.document = next; target.edit++;
    setRestoreUndo(undefined); setTemplateUndo(undefined);
    setDocument(next); setSaveState('unsaved');
  };
  const acquire = (target: DraftSession, kind: string,
    nextActivity: CoverActivity = 'preparing') => {
    if (!isCurrent(target) || operations.current) return undefined;
    const owner = { ...context(target), kind };
    operations.current = owner; setActivity(nextActivity); return owner;
  };
  const release = (owner: OperationOwner) => {
    if (operations.current !== owner) return;
    operations.current = undefined;
    if (isCurrent(owner.session)) setActivity('idle');
  };
  const assertOwner = (owner: OperationOwner) => {
    if (!isCurrent(owner.session)) throw new CoverError(
      'COVER_PROJECT_CHANGED', 'COVER_PROJECT_CHANGED');
    if (operations.current !== owner || owner.edit !== owner.session.edit ||
      owner.backgroundSequence !== owner.session.backgroundIntent) throw stale();
  };
  const refreshOwner = (owner: OperationOwner) => {
    owner.edit = owner.session.edit;
    owner.backgroundSequence = owner.session.backgroundIntent;
  };
  const flushSession = useCallback(async (target: DraftSession,
    owner?: OperationOwner): Promise<CoverSavedDraft> => {
    if (target.barrier && target.barrier !== owner) throw stale();
    if (target.inFlight) return target.inFlight;
    if (target.blocked) {
      // A dismissed issue must be reachable again without issuing another PUT.
      const conflict = new ApiError(409, 'COVER_VERSION_CONFLICT',
        'COVER_VERSION_CONFLICT');
      reportError(conflict, 'save', context(target)); throw conflict;
    }
    const errorOwner = context(target);
    const previousIssue = issueContext.current;
    const work = async () => {
      while (target.saved < target.edit || target.version === 0) {
        if (target.barrier && target.barrier !== owner) break;
        if (!target.document) throw new CoverError('COVER_DRAFT_NOT_READY',
          'COVER_DRAFT_NOT_READY');
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
        if (owner) break;
      }
      if (target.active) {
        setSaveState(target.saved === target.edit ? 'saved' : 'unsaved');
        if (previousIssue) clearError(previousIssue, 'save');
      }
      return draftResult(target);
    };
    target.inFlight = work().catch(cause => {
      target.blocked = isDraftConflict(cause);
      if (target.blocked) target.conflict = cause;
      if (target.active) {
        reportError(cause, 'save', errorOwner); setSaveState('unsaved');
      }
      throw cause;
    }).finally(() => { target.inFlight = undefined; });
    return target.inFlight;
  }, []);
  const flush = useCallback(async () => {
    if (!session.current) throw new CoverError('COVER_PROJECT_CHANGED',
      'COVER_PROJECT_CHANGED');
    return flushSession(session.current);
  }, [flushSession]);
  const initialDocument = (snapshot: CoverSnapshot) => snapshot.document ??
    createCoverDocument({ aspectRatio: latest.current.aspectRatio,
      title: latest.current.projectName || t.coverStudio.emptyTitle,
      mode: snapshot.generationConfigured === true ? 'mixed' : 'html' });
  useEffect(() => {
    session.current = undefined; operations.current = undefined;
    generationRequest.current = undefined; pendingSubmission.current = undefined;
    publishRequest.current = undefined; capability.current = undefined;
    assetsRef.current = []; revisionsRef.current = [];
    setDocument(null); setAssets([]); setRevisions([]); setAvailability({});
    setRawError(undefined); setIssue(undefined); issueContext.current = undefined;
    setSaveState('saved'); setActivity('idle'); setRestoreUndo(undefined);
    setTemplateUndo(undefined); setSubmittingGeneration(false);
    setHasUnknownSubmission(false); setLegacyAvailable(false);
    setCanGenerate(undefined); setNotice(undefined);
    intents.current.clear(); completed.current.clear(); manualJobs.current.clear();
    revisionRequests.current.clear(); revisionDownloads.current.clear();
    revisionAttempted.current.clear(); handledErrors.current.clear();
    if (!options.projectId) { setLoading(false); return; }
    const target: DraftSession = { projectId: options.projectId,
      document: null, version: 0, hash: '', edit: 0, saved: 0,
      active: true, blocked: false, backgroundIntent: 0, resourceSequence: 0 };
    session.current = target; setLoading(true);
    const abort = new AbortController(); const owner = context(target);
    void videoCoverV2.get(target.projectId, abort.signal).then(snapshot => {
      if (!isCurrent(target)) return;
      target.document = initialDocument(snapshot);
      target.version = snapshot.version; target.hash = snapshot.documentHash ?? '';
      setDocument(target.document); mergeSnapshot(snapshot);
      jobs.setJobs(snapshot.jobs); setLoading(false);
    }).catch(cause => {
      if (isCurrent(target)) {
        reportError(cause, 'load', owner); setLoading(false);
      }
    });
    const unregister = registerPendingFlush(`cover:${target.projectId}`, async () => {
      if (target.document && target.edit > target.saved) await flushSession(target);
    });
    return () => {
      target.active = false; abort.abort(); target.barrier = undefined;
      for (const intent of Array.from(intents.current.values())) intent.cancelled = true;
      if (target.document && target.edit > target.saved) {
        void flushSession(target).then(unregister).catch(cause => {
          console.error('[CoverStudio] closing draft save failed', cause);
        });
      } else unregister();
    };
  }, [options.projectId, flushSession]);
  const update = useCallback((next: CoverDocument) => {
    const target = session.current; if (!target?.active) return;
    if (backgroundChanged(target.document, next)) advanceBackground(target);
    writeDocument(target, next);
  }, []);
  useEffect(() => {
    const target = session.current;
    if (!target?.document || target.edit <= target.saved || target.blocked ||
      target.barrier) return;
    const timer = setTimeout(() => void flushSession(target).catch(() => undefined), 300);
    return () => clearTimeout(timer);
  }, [document, activity, intentRevision, flushSession]);
  useEffect(() => {
    if (document && document.aspectRatio !== options.aspectRatio) {
      update({ ...document, aspectRatio: options.aspectRatio });
    }
  }, [options.aspectRatio, document, update]);

  const refreshResources = async () => {
    const target = session.current; if (!target?.active) return;
    const sequence = ++target.resourceSequence; const owner = context(target);
    const previousIssue = issueContext.current;
    try {
      const snapshot = await videoCoverV2.get(target.projectId);
      if (!isCurrent(target) || sequence !== target.resourceSequence) return;
      mergeSnapshot(snapshot);
      if (previousIssue) clearError(previousIssue, 'resources');
      const id = useTimelineStore.getState().tracks.flatMap(track => track.items)
        .find(item => item.metadata?.role === 'video-cover')?.metadata?.cover?.revisionId;
      if (id) await retryRevision(id);
    } catch (cause) {
      if (isCurrent(target) && sequence === target.resourceSequence) {
        capability.current = undefined; setCanGenerate(undefined);
        reportError(cause, 'resources', owner);
      } else handledErrors.current.add(cause);
      throw cause;
    }
  };
  const resolveConflict = async (choice: 'local' | 'server') => {
    const target = session.current; if (!target?.active) return;
    const owner = acquire(target, 'recovery'); if (!owner) return;
    const initialLoad = !target.document;
    const previousIssue = issueContext.current;
    advanceBackground(target); refreshOwner(owner); target.barrier = owner;
    try {
      if (target.inFlight) await target.inFlight.catch(() => undefined);
      assertOwner(owner); const version = target.version;
      const snapshot = await videoCoverV2.get(target.projectId);
      assertOwner(owner); if (target.version !== version) throw stale();
      if (choice === 'server' && !snapshot.document && target.document) {
        throw new CoverError('COVER_DRAFT_NOT_READY', 'COVER_DRAFT_NOT_READY');
      }
      target.version = snapshot.version; target.hash = snapshot.documentHash ?? '';
      target.blocked = false; target.conflict = undefined; mergeSnapshot(snapshot);
      // Recovery of the initial GET must also restore observation of saved jobs.
      // It grants no manual/Agent intent, so old results stay as candidates.
      if (initialLoad) jobs.setJobs(snapshot.jobs);
      if (choice === 'local' && target.document) {
        target.edit++; refreshOwner(owner); await flushSession(target, owner);
      } else {
        writeDocument(target, initialDocument(snapshot)); target.saved = target.edit;
        setSaveState('saved');
      }
      if (previousIssue) clearError(previousIssue);
    } catch (cause) {
      if (target.blocked && isDraftConflict(target.conflict) &&
        cause instanceof CoverError && cause.code === 'COVER_VERSION_CONFLICT') {
        // The stale recovery did not resolve the previously confirmed CAS.
        // Keep that decision reachable rather than retrying an unrelated apply.
        handledErrors.current.add(cause);
        reportError(new ApiError(409, 'COVER_VERSION_CONFLICT',
          'COVER_VERSION_CONFLICT'), 'save', owner);
      } else {
        reportError(cause, initialLoad ? 'load' : 'save', owner);
        if (choice === 'server' && cause instanceof CoverError &&
          cause.code === 'COVER_DRAFT_NOT_READY') {
          setIssue(previous => previous?.id === owner.operationId ? {
            ...previous, code: 'COVER_SERVER_DRAFT_MISSING',
            actions: ['use-local', 'dismiss'],
          } : previous);
        }
      }
      throw cause;
    } finally {
      if (target.barrier === owner) target.barrier = undefined;
      release(owner);
    }
  };
  const reload = async (keepLocal = false) => {
    // Compatibility is reserved for initial load and legacy callers.
    if (session.current?.document) throw stale();
    return resolveConflict(keepLocal ? 'local' : 'server');
  };
  const retrySave = async () => { await flush(); };
  const adoptAsset = async (asset: CoverAsset, target: DraftSession,
    sequence: number) => {
    if (!isCurrent(target)) return;
    mergeAssets([asset]);
    if (target.backgroundIntent !== sequence || !target.document) {
      setNotice('image-imported'); return;
    }
    writeDocument(target, { ...target.document, background: {
      ...target.document.background, kind: 'asset', assetId: asset.assetId } });
    return flushSession(target);
  };
  const selectAsset = async (asset: CoverAsset) => {
    const target = session.current; if (!target?.active) return;
    advanceBackground(target);
    return adoptAsset(asset, target, target.backgroundIntent);
  };
  const importAsset = async (source: 'upload' | 'copy', value: Blob | string) => {
    const target = session.current; if (!target?.active) return;
    advanceBackground(target); const owner = context(target);
    try {
      const asset = source === 'upload'
        ? await videoCoverV2.uploadAsset(target.projectId, value as Blob)
        : await videoCoverV2.copyAsset(target.projectId, value as string);
      await adoptAsset(asset, target, owner.backgroundSequence);
      if (isCurrent(target)) clearError(owner);
    } catch (cause) { reportError(cause, source, owner); throw cause; }
  };
  const upload = (file: Blob) => importAsset('upload', file);
  const copyAsset = (url: string) => importAsset('copy', url);

  const prepare = async (owner: OperationOwner) => {
    const target = owner.session; const draft = await flushSession(target);
    assertOwner(owner); const d = draft.document;
    if ((d.mode !== 'html' && d.background.kind !== 'asset') ||
      (d.mode !== 'ai' && !`${d.fields.title}${d.fields.subtitle}`.trim())) {
      throw new CoverError('COVER_DRAFT_NOT_READY', 'COVER_DRAFT_NOT_READY');
    }
    const blob = await latest.current.renderer.current?.render(d,
      assetsRef.current.find(asset => asset.assetId === d.background.assetId)?.url);
    assertOwner(owner);
    if (!blob) throw new CoverError('COVER_RENDER_FAILED', 'COVER_RENDER_FAILED');
    const key = `${target.projectId}:${draft.version}:${draft.documentHash}`;
    if (publishRequest.current?.key !== key) publishRequest.current = {
      key, id: crypto.randomUUID() };
    const revision = await videoCoverV2.publish(target.projectId, draft,
      blob, publishRequest.current.id);
    if (isCurrent(target)) mergeRevisions([revision]);
    assertOwner(owner); return revision;
  };
  const applyRevision = (revision: CoverRevision, durationFrames: number,
    rebuild = false) => {
    const projectId = latest.current.projectId;
    if (!projectId || revision.projectId !== projectId) throw new CoverError(
      'COVER_PROJECT_CHANGED', 'COVER_PROJECT_CHANGED');
    if (revision.document.aspectRatio !== latest.current.aspectRatio) {
      throw new CoverError('COVER_ASPECT_MISMATCH', 'COVER_ASPECT_MISMATCH');
    }
    applyCoverTimelineAction({ getStore: useTimelineStore.getState,
      projectId, getProjectId: () => latest.current.projectId,
      revision, durationFrames, mode: rebuild ? 'rebuild' : 'apply',
      coverLabel: t.coverStudio.cover, reason: 'cover',
      registerMaterial: latest.current.registerMaterial });
    latest.current.onApplied();
  };
  const triggerDownload = (revision: CoverRevision) => {
    const link = window.document.createElement('a');
    link.href = videoCoverV2.downloadUrl(revision.projectId, revision.id);
    link.download = 'cover.png'; link.click();
  };
  const act = async (action: 'apply' | 'download' | 'rebuild') => {
    const target = session.current; if (!target?.active) return;
    const owner = acquire(target, action, action === 'download' ?
      'downloading' : 'applying'); if (!owner) return;
    const previousIssue = issueContext.current;
    try {
      const revision = await prepare(owner); assertOwner(owner);
      if (action === 'download') triggerDownload(revision);
      else applyRevision(revision, revision.document.durationFrames,
        action === 'rebuild');
      if (previousIssue && ['apply', 'render'].includes(
        previousIssue.operation ?? '')) clearError(previousIssue);
    } catch (cause) {
      reportError(cause, 'apply', owner, { retryAction: action }); throw cause;
    } finally { release(owner); }
  };
  const applyExisting = async (revisionId: string) => {
    const target = session.current; if (!target?.active) return;
    const owner = acquire(target, 'apply-existing', 'applying'); if (!owner) return;
    try {
      const revision = await videoCoverV2.getRevision(target.projectId, revisionId);
      assertOwner(owner); mergeRevisions([revision]);
      applyRevision(revision, revision.document.durationFrames);
    } catch (cause) { reportError(cause, 'apply', owner); throw cause; }
    finally { release(owner); }
  };

  const submitFrozen = async (pending: CoverPendingSubmission) => {
    const target = pending.session as DraftSession;
    if (!isCurrent(target) || generationRequest.current) return;
    generationRequest.current = target; setSubmittingGeneration(true);
    pending.state = 'submitting';
    const owner: ErrorContext = { session: target, operationId: pending.requestId,
      edit: pending.edit, backgroundSequence: pending.backgroundSequence };
    try {
      const job = await videoCoverV2.generate(target.projectId,
        pending.draft, pending.requestId, pending.referenceAssetIds);
      if (!isCurrent(target)) return;
      if (!job?.jobId || !['queued', 'running', 'succeeded', 'failed',
        'cancelled', 'interrupted'].includes(job.status) ||
        !Array.isArray(job.assets)) throw new Error('COVER_INVALID_RESPONSE');
      pendingSubmission.current = undefined; setHasUnknownSubmission(false);
      manualJobs.current.set(job.jobId, { version: pending.draft.version,
        edit: pending.edit, backgroundSequence: pending.backgroundSequence });
      jobs.putJob(job); clearError(owner, 'generate');
    } catch (cause) {
      if (!isCurrent(target)) return;
      const rejected = cause instanceof ApiError &&
        [400, 404, 409, 422, 429].includes(cause.status);
      if (rejected) pendingSubmission.current = undefined;
      else { pending.state = 'unknown'; pendingSubmission.current = pending; }
      setHasUnknownSubmission(!rejected); reportError(cause, 'generate', owner);
      if (!rejected) setIssue(previous => previous?.id === owner.operationId
        ? { ...previous, actions: ['resume-submission', 'cancel-submission',
          'dismiss'] } : previous);
    } finally {
      if (generationRequest.current === target) {
        generationRequest.current = undefined;
        if (isCurrent(target)) setSubmittingGeneration(false);
      }
    }
  };
  const generate = async () => {
    const target = session.current;
    if (!target?.active || generationRequest.current ||
      pendingSubmission.current || capability.current !== true) return;
    advanceBackground(target); const owner = context(target);
    generationRequest.current = target; setSubmittingGeneration(true);
    try {
      const draft = await flushSession(target);
      if (!isCurrent(target)) return;
      if (target.edit !== owner.edit || target.backgroundIntent !==
        owner.backgroundSequence) throw stale();
      const pending: CoverPendingSubmission = { ...owner,
        requestId: crypto.randomUUID(), draft: structuredClone(draft),
        referenceAssetIds: [], state: 'submitting' };
      pendingSubmission.current = pending; generationRequest.current = undefined;
      await submitFrozen(pending);
    } catch (cause) { reportError(cause, 'generate', owner); }
    finally {
      if (generationRequest.current === target) generationRequest.current = undefined;
      if (isCurrent(target)) setSubmittingGeneration(false);
    }
  };
  const resumeSubmission = async () => {
    const pending = pendingSubmission.current;
    if (pending?.state === 'unknown') await submitFrozen(pending);
  };
  const cancelSubmission = async () => {
    const pending = pendingSubmission.current;
    if (!pending || generationRequest.current) return;
    const target = pending.session as DraftSession;
    generationRequest.current = target; setSubmittingGeneration(true);
    try {
      const job = await videoCoverV2.cancelByRequest(target.projectId, pending.requestId);
      if (!isCurrent(target)) return;
      if (!job?.jobId || !['succeeded', 'failed', 'cancelled',
        'interrupted'].includes(job.status) || !Array.isArray(job.assets)) {
        throw new Error('COVER_CANCEL_UNCONFIRMED');
      }
      jobs.putJob(job);
      pendingSubmission.current = undefined; setHasUnknownSubmission(false);
      clearError({ session: target, operationId: pending.requestId,
        edit: pending.edit, backgroundSequence: pending.backgroundSequence },
      'generate');
    } catch (cause) {
      reportError(cause, 'generate', { session: target,
        operationId: pending.requestId, edit: pending.edit,
        backgroundSequence: pending.backgroundSequence });
      if (isCurrent(target)) setIssue(previous => previous?.id === pending.requestId
        ? { ...previous, actions: ['resume-submission', 'cancel-submission',
          'dismiss'] } : previous);
    } finally {
      if (generationRequest.current === target) generationRequest.current = undefined;
      if (isCurrent(target)) setSubmittingGeneration(false);
    }
  };

  const setRevisionStatus = (id: string,
    patch: Partial<Omit<CoverRevisionEntry, 'id' | 'revision'>>) => {
    setAvailability(previous => ({ ...previous, [id]: {
      metadataStatus: 'unknown', pngStatus: 'unknown', backgroundStatus: 'unknown',
      ...previous[id], ...patch } }));
  };
  const readRevision = async (id: string, target: DraftSession) => {
    try {
      const revision = await videoCoverV2.getRevision(target.projectId, id);
      if (!isCurrent(target)) throw new CoverError('COVER_PROJECT_CHANGED',
        'COVER_PROJECT_CHANGED');
      if (revision.projectId !== target.projectId) throw new CoverError(
        'COVER_PROJECT_CHANGED', 'COVER_PROJECT_CHANGED');
      mergeRevisions([revision]);
      setRevisionStatus(id, { metadataStatus: 'readable' }); return revision;
    } catch (cause) {
      if (isCurrent(target)) setRevisionStatus(id, { metadataStatus: 'unavailable' });
      throw cause;
    }
  };
  const checkBackground = async (revision: CoverRevision, target: DraftSession) => {
    if (!isCurrent(target)) throw new CoverError('COVER_PROJECT_CHANGED',
      'COVER_PROJECT_CHANGED');
    if (revision.document.background.kind !== 'asset') {
      setRevisionStatus(revision.id, { backgroundStatus: 'readable' }); return;
    }
    const asset = assetsRef.current.find(value =>
      value.assetId === revision.document.background.assetId);
    try {
      if (!asset) throw new CoverError('COVER_ASSET_MISSING', 'COVER_ASSET_MISSING');
      await decodeImage(asset.url);
      if (isCurrent(target)) setRevisionStatus(revision.id,
        { backgroundStatus: 'readable' });
    } catch (cause) {
      if (isCurrent(target)) setRevisionStatus(revision.id,
        { backgroundStatus: cause instanceof CoverError &&
          cause.code === 'COVER_RENDER_FAILED' ? 'unknown' : 'unavailable' });
      throw cause;
    }
  };
  const retryRevision = async (id: string) => {
    const target = session.current; if (!target?.active) return;
    if (revisionRequests.current.has(id)) return revisionRequests.current.get(id);
    revisionAttempted.current.add(id); const owner = context(target);
    const previousIssue = issueContext.current;
    setRevisionStatus(id, { metadataStatus: 'checking' });
    const request = (async () => {
      try {
        const revision = await readRevision(id, target);
        // PNG and source background have independent recovery paths: a broken
        // PNG may still be regenerated from a readable original background.
        const results = await Promise.allSettled([
          decodeImage(revision.url).then(() => {
            if (isCurrent(target)) setRevisionStatus(id, { pngStatus: 'readable' });
          }, cause => {
            if (isCurrent(target)) setRevisionStatus(id, { pngStatus: 'unavailable' });
            throw cause;
          }), checkBackground(revision, target),
        ]);
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        if (isCurrent(target) && previousIssue?.revisionId === id) {
          clearError(previousIssue);
        }
      } catch (cause) {
        reportError(cause, 'restore', owner, { revisionId: id });
      } finally {
        if (isCurrent(target)) revisionRequests.current.delete(id);
      }
    })();
    revisionRequests.current.set(id, request); return request;
  };
  useEffect(() => {
    if (appliedRevisionId && !revisionsRef.current.some(value =>
      value.id === appliedRevisionId) && !revisionAttempted.current.has(appliedRevisionId)) {
      void retryRevision(appliedRevisionId);
    }
  }, [appliedRevisionId, options.projectId, loading]);
  const downloadRevision = async (id: string) => {
    const target = session.current; if (!target?.active ||
      revisionDownloads.current.has(id)) return;
    revisionDownloads.current.add(id); const owner = context(target);
    try {
      const revision = await readRevision(id, target);
      if (isCurrent(target)) triggerDownload(revision);
    } catch (cause) { reportError(cause, 'restore', owner, { revisionId: id }); }
    finally { if (isCurrent(target)) revisionDownloads.current.delete(id); }
  };
  const restoreRevision = async (id: string) => {
    const target = session.current; if (!target?.document) return;
    const owner = acquire(target, 'restore', 'restoring'); if (!owner) return;
    const previousIssue = issueContext.current;
    advanceBackground(target); refreshOwner(owner);
    const previous = structuredClone(target.document);
    try {
      await flushSession(target); assertOwner(owner);
      const revision = await readRevision(id, target); assertOwner(owner);
      await refreshResources(); assertOwner(owner);
      await checkBackground(revision, target); assertOwner(owner);
      writeDocument(target, { ...structuredClone(revision.document),
        schemaVersion: 2, templateVersion: 1,
        aspectRatio: latest.current.aspectRatio });
      if (revision.document.aspectRatio !== latest.current.aspectRatio) {
        setNotice('restore-reflow');
      }
      setRestoreUndo({ document: previous, resultEdit: target.edit,
        backgroundSequence: target.backgroundIntent, session: target });
      await flushSession(target);
      if (previousIssue?.revisionId === id) clearError(previousIssue, 'restore');
    } catch (cause) {
      reportError(cause, 'restore', owner, { revisionId: id }); throw cause;
    } finally { release(owner); }
  };
  const validUndo = (undo?: CoverRestoreUndo) => !!undo &&
    undo.session === session.current && session.current?.active &&
    undo.resultEdit === session.current.edit &&
    undo.backgroundSequence === session.current.backgroundIntent;
  const undoDocument = async (undo?: CoverRestoreUndo) => {
    const target = session.current;
    if (!target || !validUndo(undo) || !undo) return;
    const owner = acquire(target, 'undo', 'restoring'); if (!owner) return;
    try {
      advanceBackground(target);
      writeDocument(target, structuredClone(undo.document));
      await flushSession(target);
    } finally { release(owner); }
  };
  const changeTemplate = (next: CoverDocument) => {
    const target = session.current; if (!target?.document) return;
    const previous = structuredClone(target.document); update(next);
    setTemplateUndo({ document: previous, resultEdit: target.edit,
      backgroundSequence: target.backgroundIntent, session: target });
  };

  const validIntent = (intent: Intent) => !intent.cancelled &&
    session.current?.active && intent.sequence === session.current.edit &&
    intent.backgroundSequence === session.current.backgroundIntent &&
    intent.digest === digest();
  const waitForEditor = (intent: Intent) => new Promise<void>((resolve, reject) => {
    if (!useTimelineStore.getState().externalEditLock) { resolve(); return; }
    const timer = setTimeout(() => {
      unsubscribe(); reject(new CoverError('COVER_TIMELINE_CONFLICT',
        'COVER_TIMELINE_CONFLICT'));
    }, 15000);
    const unsubscribe = useTimelineStore.subscribe(state => {
      if (!state.externalEditLock || !validIntent(intent)) {
        clearTimeout(timer); unsubscribe(); resolve();
      }
    });
  });
  const runIntent = async (intent: Intent, held?: OperationOwner) => {
    const target = session.current; const operation = intent.operation;
    if (!target || !operation || !validIntent(intent) || !operation.applyWhenReady) {
      intent.notify?.({ state: 'not_applied' }); return;
    }
    const owner = held ?? acquire(target, 'agent', 'applying');
    if (!owner) { intent.notify?.({ state: 'not_applied' }); return; }
    try {
      intent.notify?.({ state: 'applying' }); assertOwner(owner);
      const revision = operation.action === 'apply_revision'
        ? await videoCoverV2.getRevision(operation.projectId, operation.revisionId)
        : await prepare(owner);
      assertOwner(owner); await waitForEditor(intent); assertOwner(owner);
      if (!validIntent(intent)) { intent.notify?.({ state: 'not_applied' }); return; }
      applyRevision(revision, operation.durationFrames);
      intent.notify?.({ state: 'applied', revisionId: revision.id,
        thumbnailUrl: revision.url });
    } catch (cause) {
      reportError(cause, 'apply', owner);
      intent.notify?.({ state: validIntent(intent) ? 'error' : 'not_applied',
        error: cause instanceof CoverError ? cause.code : 'COVER_APPLY_FAILED' });
    } finally { if (!held) release(owner); }
  };
  const adoptAgentSnapshot = async (intent: Intent, owner: OperationOwner) => {
    const target = owner.session; target.barrier = owner;
    try {
      if (target.inFlight) await target.inFlight.catch(() => undefined);
      assertOwner(owner);
      if (!validIntent(intent) || target.edit !== target.saved) return false;
      const version = target.version;
      const snapshot = await videoCoverV2.get(target.projectId);
      assertOwner(owner);
      if (!validIntent(intent) || target.version !== version ||
        target.edit !== target.saved) return false;
      target.document = initialDocument(snapshot); target.version = snapshot.version;
      target.hash = snapshot.documentHash ?? '';
      target.edit++; target.saved = target.edit;
      target.blocked = false; setDocument(target.document); setSaveState('saved');
      setRestoreUndo(undefined); setTemplateUndo(undefined); mergeSnapshot(snapshot);
      intent.sequence = target.edit;
      intent.backgroundSequence = target.backgroundIntent;
      refreshOwner(owner); return true;
    } finally { if (target.barrier === owner) target.barrier = undefined; }
  };
  const runtime = useRef({ runIntent, adoptAsset, adoptAgentSnapshot });
  runtime.current = { runIntent, adoptAsset, adoptAgentSnapshot };
  useEffect(() => {
    for (const job of jobs.jobs) {
      if (job.status === 'queued' || job.status === 'running' ||
        completed.current.has(job.jobId)) continue;
      completed.current.add(job.jobId); const target = session.current;
      if (!target?.active) continue;
      try { mergeAssets(job.assets ?? []); }
      catch (cause) { reportError(cause, 'resources', context(target)); continue; }
      const manual = manualJobs.current.get(job.jobId);
      const intent = Array.from(intents.current.values()).find(value =>
        value.operation?.action === 'watch_job' && value.operation.jobId === job.jobId);
      if (job.status !== 'succeeded') {
        intent?.notify?.({ state: job.status === 'cancelled' ? 'not_applied' : 'error',
          jobId: job.jobId, error: job.errorCode }); continue;
      }
      intent?.notify?.({ state: 'image_ready', jobId: job.jobId,
        thumbnailUrl: job.assets?.[0]?.url });
      const expected = manual?.version ?? (intent?.operation?.action === 'watch_job'
        ? intent.operation.draftVersion : undefined);
      const allowed = manual ? manual.edit === target.edit &&
        manual.backgroundSequence === target.backgroundIntent :
        intent && validIntent(intent);
      if (!job.assets?.[0] || target.version !== expected ||
        target.saved !== target.edit || !allowed || operations.current) {
        intent?.notify?.({ state: 'not_applied', jobId: job.jobId }); continue;
      }
      const owner = acquire(target, 'job-adopt'); if (!owner) continue;
      const selectedSequence = target.edit + 1;
      void runtime.current.adoptAsset(job.assets[0], target,
        target.backgroundIntent).then(async draft => {
        if (intent && draft && isCurrent(target) && target.edit === selectedSequence &&
          target.backgroundIntent === owner.backgroundSequence && !intent.cancelled) {
          intent.sequence = selectedSequence;
          intent.backgroundSequence = target.backgroundIntent;
          if (intent.operation?.action === 'watch_job') {
            intent.operation.draftVersion = draft.version;
          }
          refreshOwner(owner); await runtime.current.runIntent(intent, owner);
        } else intent?.notify?.({ state: 'not_applied' });
      }).catch(cause => {
        reportError(cause, 'save', owner);
        intent?.notify?.({ state: 'error', error: 'COVER_SAVE_FAILED' });
      }).finally(() => release(owner));
    }
  }, [jobs.jobs]);

  const bridge: CoverAgentBridge = useMemo(() => ({
    beginOperation(id, _toolName, notify) {
      const projectId = latest.current.projectId;
      if (!intents.current.has(id)) intents.current.set(id, {
        sequence: session.current?.edit ?? -1,
        backgroundSequence: session.current?.backgroundIntent ?? -1,
        digest: digest(), cancelled: false,
        notify: status => notify?.({ ...status, projectId }),
      });
    },
    async handleCoverOperation(operation, notify) {
      if (operation.projectId !== latest.current.projectId) return;
      const originalNotify = notify;
      notify = status => originalNotify({ ...status, projectId: operation.projectId });
      const intent = intents.current.get(operation.operationId);
      if (!intent || intent.cancelled || intent.handled) {
        notify({ state: 'not_applied' }); return;
      }
      intent.handled = true; intent.operation = operation; intent.notify = notify;
      const target = session.current; if (!target?.active) return;
      const owner = acquire(target, 'agent'); let adopted = false;
      try {
        if (owner && validIntent(intent) && target.edit === target.saved) {
          try { adopted = await runtime.current.adoptAgentSnapshot(intent, owner); }
          catch (cause) {
            handledErrors.current.add(cause);
            if (!isCurrent(target)) return;
            intent.cancelled = true;
          }
        }
        if (!isCurrent(target)) return;
        if (operation.action === 'watch_job') {
          const job = await videoCoverV2.getJob(operation.projectId, operation.jobId);
          if (!isCurrent(target)) return;
          if (!adopted || !validIntent(intent)) {
            intent.cancelled = true;
            notify({ state: 'not_applied', jobId: job.jobId });
          }
          if (owner) release(owner);
          jobs.putJob(job);
        } else if (!owner || !adopted || !validIntent(intent) ||
          (operation.action === 'prepare_draft' && target.version !== operation.draftVersion)) {
          notify({ state: 'not_applied' });
        } else await runtime.current.runIntent(intent, owner);
      } catch (cause) {
        if (owner) reportError(cause, 'apply', owner);
        intent.cancelled = true; notify({ state: 'not_applied' });
      } finally { if (owner) release(owner); }
    },
    cancelOperations({ cancelJobs, operationIds }) {
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
          .then(() => { pendingCancels.current.delete(id);
            pending.notify?.({ state: 'not_applied' }); })
          .catch(() => pending.notify?.({ state: 'cancel_unconfirmed' }));
      }
    };
    window.addEventListener('online', retry);
    const timer = setInterval(retry, 10000);
    return () => { window.removeEventListener('online', retry); clearInterval(timer); };
  }, []);
  const revisionEntries: CoverRevisionEntry[] = selectCoverRevisions(revisions,
    appliedRevisionId).map(revision => ({ id: revision.id, revision,
    metadataStatus: 'unknown', pngStatus: 'unknown', backgroundStatus: 'unknown',
    ...availability[revision.id] }));
  if (appliedRevisionId && !appliedRevision) revisionEntries.unshift({
    id: appliedRevisionId, metadataStatus: 'unknown', pngStatus: 'unknown',
    backgroundStatus: 'unknown', ...availability[appliedRevisionId] });
  return { document, update, loading, saveState, error, setError, issue, notice,
    activity, busy: activity !== 'idle', assets, revisions, revisionEntries,
    legacyAvailable, canGenerate, draftChanged, appliedRevisionId, appliedRevision,
    jobs: jobs.jobs, jobConnection: jobs.connection, bridge, flush, reload,
    upload, copyAsset, selectAsset, generate, act, applyExisting,
    refreshResources, refreshJobs: jobs.refreshNow, retrySave, resolveConflict,
    restoreRevision, restoreUndo, undoRestore: () => undoDocument(restoreUndo),
    canUndoRestore: !!validUndo(restoreUndo), changeTemplate,
    undoTemplate: () => undoDocument(templateUndo),
    canUndoTemplate: !!validUndo(templateUndo),
    retryRevision, downloadRevision, submittingGeneration, hasUnknownSubmission,
    resumeSubmission, cancelSubmission,
    markRevisionPngUnavailable: (id: string) => setRevisionStatus(id,
      { pngStatus: 'unavailable' }),
    markRevisionPngReadable: (id: string) => setRevisionStatus(id,
      { pngStatus: 'readable' }),
    cancel: async (id: string) => {
      const target = session.current; if (!target) return;
      const owner = context(target);
      manualJobs.current.delete(id);
      for (const intent of Array.from(intents.current.values())) {
        if (intent.operation?.action === 'watch_job' && intent.operation.jobId === id) {
          intent.cancelled = true;
          intent.notify?.({ state: 'not_applied', jobId: id });
        }
      }
      try {
        const job = await videoCoverV2.cancelJob(target.projectId, id);
        if (isCurrent(target)) jobs.putJob(job);
      } catch (cause) { reportError(cause, 'poll', owner); throw cause; }
    },
    importLegacy: async () => {
      const target = session.current; if (!target?.active) return;
      const owner = acquire(target, 'legacy'); if (!owner) return;
      advanceBackground(target); refreshOwner(owner); target.barrier = owner;
      try {
        if (target.inFlight) await target.inFlight;
        assertOwner(owner);
        const result = await videoCoverV2.importLegacy(target.projectId,
          crypto.randomUUID());
        if (!isCurrent(target)) return;
        assertOwner(owner); writeDocument(target, result.document);
        target.version = result.version; target.hash = result.documentHash;
        target.saved = target.edit; setSaveState('saved');
      } catch (cause) { reportError(cause, 'restore', owner); throw cause; }
      finally {
        if (target.barrier === owner) target.barrier = undefined;
        release(owner);
      }
    },
  };
}
export type CoverController = ReturnType<typeof useCoverController>;
