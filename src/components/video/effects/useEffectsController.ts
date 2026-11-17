import { useEffectsDraftList } from './useEffectsDraftList';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MaterialItem } from '@/types';
import type { EffectAsset, EffectTargetSnapshot } from '@/types/effects';
import { EffectError } from '@/types/effects';
import { useLocale } from '@/contexts/LocaleContext';
import { attachEffectInput, getEffectAsset, getEffectCapabilities,
  getEffectDraft } from '@/lib/api/effects';
import { createEffectDocument, getEffectTemplate } from '@/lib/effects/catalog';
import { fingerprintEffectTarget } from '@/lib/effects/provenance';
import { useTimelineStore } from '../timeline/store/useTimelineStore';
import { applyEffectsTimelineAction } from '../timeline/store/actions/applyEffects';
import { createEffectMaterial } from './effectsTimeline';
import { useEffectsDraft, type EffectMemoryDraft } from './useEffectsDraft';
import { useEffectsJobs } from './useEffectsJobs';
import { useEffectsSubmission } from './useEffectsSubmission';
import { acquireEffectEditor, readPending,
  writePending } from '@/lib/effects/pendingWrites';
import type { EffectEditorLease } from '@/lib/effects/pendingWrites';
import type { PendingIdentity } from '@/lib/effects/pendingWrites';

interface EditorSession {
  projectId?: string;
  lease?: EffectEditorLease;
  snapshot?: EffectMemoryDraft & { dirty: boolean };
  failure?: Error;
  pendingExit?: Promise<void>;
  expectedIdentity?: PendingIdentity;
}
// Failed local I/O must not erase the only remaining copy during navigation.
// This is memory-only and never authorizes a server overwrite or old target.
const failedEditorSessions = new Map<string, EditorSession>();

// React cleanup cannot await. Keep the old lease alive only for its final local
// snapshot, then release; network and UI delivery have already been revoked.
async function persistEditorExit(session: EditorSession) {
  const { snapshot, projectId, lease } = session;
  try {
    if (!projectId || !snapshot?.dirty || !lease?.isActive()) return;
    failedEditorSessions.set(projectId, session);
    if (snapshot.isConflicted) {
      session.expectedIdentity = snapshot.expectedIdentity;
      session.failure = new EffectError('EFFECT_VERSION_CONFLICT');
      return;
    }
    const stored = await readPending(projectId, 'save');
    session.expectedIdentity = stored.identity;
    if (!lease.isActive()) return;
    if (stored.record && stored.record.draftId !== snapshot.draftId) return;
    await writePending(projectId, 'save', {
      schemaVersion: 1, projectId, draftId: snapshot.draftId,
      baseVersion: stored.record ? stored.record.baseVersion : snapshot.baseVersion,
      recordRevision: (stored.record?.recordRevision ?? 0) + 1,
      createdAt: stored.record?.createdAt ?? new Date().toISOString(),
      ...(stored.record?.pendingWrite ? { pendingWrite: stored.record.pendingWrite } : {}),
      working: snapshot.working,
    }, stored.identity);
    if (failedEditorSessions.get(projectId) === session) {
      failedEditorSessions.delete(projectId);
    }
  } catch (error) {
    session.failure = error instanceof Error ? error : new Error(String(error));
    console.error('[effects] Final local draft snapshot failed', error);
  } finally { lease?.release(); }
}

export interface EffectsEntry { material?: MaterialItem; clipId?: string;
  draftId?: string; newDraft?: boolean }
interface ControllerOptions { projectId?: string; materials: MaterialItem[];
  aspectRatioId?: string;
  registerMaterial: (material: MaterialItem) => void }

function getLocalSource(material: Partial<MaterialItem>): string {
  const url = [material.cacheUrl, material.metadata?.localResolvedUrl,
    material.serverUrl, material.url].find(value =>
    typeof value === 'string' && value.startsWith('/api/storage/files/'));
  if (!url) throw new EffectError('EFFECT_INPUT_NOT_LOCAL');
  return url;
}

function findClip(clipId: string) {
  for (const track of useTimelineStore.getState().exportToData().tracks) {
    const item = track.items.find(clip => clip.id === clipId);
    if (item) return { track, item };
  }
  throw new EffectError('EFFECT_TARGET_CHANGED');
}

async function captureTarget(options: {
  projectId: string; clipId: string; materials: MaterialItem[];
}): Promise<{ target: EffectTargetSnapshot; asset: EffectAsset }> {
  const { track, item } = findClip(options.clipId);
  if (item.type !== 'video' || item.originalMaterialType === 'image'
    || item.metadata?.role || track.isLocked || !Number.isFinite(item.duration)
    || item.duration < 0.5 || item.duration > 60
    || !Number.isFinite(item.clipStart ?? 0) || (item.clipStart ?? 0) < 0
    || (item.clipEnd !== undefined
      && Math.abs(item.clipEnd - (item.clipStart ?? 0) - item.duration) > 1 / 30)) {
    throw new EffectError('EFFECT_SOURCE_RANGE_INVALID');
  }
  const targetFingerprint = fingerprintEffectTarget(track, item);
  const material = options.materials.find(m => m.id === item.materialId);
  const asset = await attachEffectInput(options.projectId,
    getLocalSource({ ...material, ...item }), item.materialId);
  const current = findClip(item.id);
  if (fingerprintEffectTarget(current.track, current.item) !== targetFingerprint) {
    throw new EffectError('EFFECT_TARGET_CHANGED');
  }
  return { asset, target: { projectId: options.projectId, trackId: track.id,
    clipId: item.id, sourceMaterialId: item.materialId, targetFingerprint,
    durationSeconds: item.duration, sourceSha256: asset.sha256,
    trimStartFrame: Math.round((item.clipStart ?? 0) * 30),
    durationFrames: Math.ceil(item.duration * 30) } };
}

function useEffectsCapability() {
  const [capability, setCapability] = useState<
    Awaited<ReturnType<typeof getEffectCapabilities>>>();
  const refresh = useCallback(async (retry = false) => {
    const result = await getEffectCapabilities(retry);
    setCapability(result); return result;
  }, []);
  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);
  return { capability, refresh };
}

// The controller keeps project generation, draft and jobs in one ownership
// scope; field editing and polling are delegated to the two smaller hooks.
export function useEffectsController(options: ControllerOptions) {
  const { t } = useLocale();
  const [isOpen, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [assets, setAssets] = useState<EffectAsset[]>([]);
  const [target, setTarget] = useState<EffectTargetSnapshot>();
  const draftList = useEffectsDraftList(options.projectId, isOpen);
  const observedDrafts = useRef(new Set<string>());
  const lease = useRef<EffectEditorLease | undefined>(undefined);
  const editorEpoch = useRef(0);
  const session = useRef<EditorSession>({ projectId: options.projectId });
  const [isEditor, setEditor] = useState(false);
  const owner = useRef(options); owner.current = options;
  const generation = useRef(0);
  const attachmentRevision = useRef(0);
  const attachments = useRef({ epoch: '', pending: Promise.resolve() });
  const previousProject = useRef(options.projectId);
  if (previousProject.current !== options.projectId) {
    previousProject.current = options.projectId; generation.current++;
    editorEpoch.current++; lease.current = undefined;
    session.current = { projectId: options.projectId };
  }
  useEffect(() => {
    const exiting = session.current;
    setOpen(false); setAssets([]); setTarget(undefined); setError(undefined);
    return () => {
      generation.current++; editorEpoch.current++;
      exiting.pendingExit = persistEditorExit(exiting);
    };
  }, [options.projectId]);
  const canWrite = () => Boolean(lease.current?.isActive());
  const getEditorEpoch = () => editorEpoch.current;
  const draft = useEffectsDraft(options.projectId, isOpen && !busy && isEditor,
    canWrite, getEditorEpoch);
  if (draft.status === 'saved' && !draft.isDirty()
    && failedEditorSessions.get(options.projectId ?? '')?.snapshot?.draftId
      === draft.draft?.id) failedEditorSessions.delete(options.projectId!);
  if (draft.getId()) session.current.snapshot = {
    draftId: draft.getId(), baseVersion: draft.getBaseVersion(),
    dirty: draft.isDirty(), working: structuredClone(draft.getCurrent()),
    expectedIdentity: draft.getMemoryIdentity(), isConflicted: draft.hasMemoryConflict(),
  };
  const { upsertSummary, refresh: refreshDraftList } = draftList;
  useEffect(() => {
    const saved = draft.draft;
    if (!saved || saved.projectId !== options.projectId || !isOpen) return;
    upsertSummary({ id: saved.id, name: saved.name, version: saved.version });
    const identity = `${saved.projectId}:${saved.id}`;
    if (!observedDrafts.current.has(identity)) {
      observedDrafts.current.add(identity);
      if (saved.version === 1) void refreshDraftList();
    }
  }, [draft.draft, options.projectId, isOpen, upsertSummary, refreshDraftList]);
  const runtime = useEffectsCapability();
  const register = useCallback((asset: EffectAsset) => {
    if (asset.projectId !== owner.current.projectId) {
      throw new EffectError('EFFECT_TARGET_CHANGED');
    }
    owner.current.registerMaterial(createEffectMaterial(asset));
  }, []);
  const jobs = useEffectsJobs({ projectId: options.projectId,
    onRegister: register });
  const submission = useEffectsSubmission({ projectId: options.projectId,
    canWrite, getEditorEpoch, watch: jobs.watch });
  const run = async (action: () => Promise<void>, ownsResult?: () => boolean) => {
    const projectId = owner.current.projectId;
    const capturedEditor = editorEpoch.current;
    const isCurrent = ownsResult ?? (() => projectId === owner.current.projectId
      && capturedEditor === editorEpoch.current);
    setError(undefined);
    try { await action(); } catch (error) {
      if (isCurrent()) setError(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const open = (entry: EffectsEntry = {},
    navigation: { discardChanges?: boolean } = {}) => {
    const token = ++generation.current;
    const isCurrent = () => token === generation.current;
    return run(async () => {
    if (isOpen && draft.isDirty() && !navigation.discardChanges) {
      await draft.flush();
    }
    if (!isCurrent()) return;
    if (navigation.discardChanges) {
      if (draft.status === 'conflict') await draft.discardConflict();
      else {
        if (draft.hasPending()) throw new EffectError('EFFECT_SUBMISSION_UNKNOWN');
        await draft.discard();
      }
      failedEditorSessions.delete(owner.current.projectId ?? '');
    }
    const projectId = owner.current.projectId;
    if (!projectId) throw new EffectError('EFFECT_NOT_FOUND');
    editorEpoch.current++;
    setOpen(true); setBusy(true); setTarget(undefined);
    try {
      await failedEditorSessions.get(projectId)?.pendingExit;
      if (!isCurrent()) return;
      if (!lease.current?.isActive()) {
        const acquired = await acquireEffectEditor(projectId);
        if (!isCurrent()) { acquired?.release(); return; }
        lease.current = acquired;
        editorEpoch.current++;
        session.current.lease = lease.current;
      }
      setEditor(Boolean(lease.current));
      if (!lease.current) return;
      const retained = failedEditorSessions.get(projectId);
      if ((!isOpen || retained) && await draft.restore(() => {
        if (isCurrent()) setBusy(false);
      }, retained?.snapshot ? { ...retained.snapshot,
        expectedIdentity: retained.expectedIdentity } : undefined)) {
        if (!isCurrent()) return;
        if (retained?.failure && isCurrent()) setError(retained.failure);
        if (retained) {
          try {
            await draft.persistWorking();
            if (isCurrent() && failedEditorSessions.get(projectId) === retained) {
              failedEditorSessions.delete(projectId);
            }
          } catch (failure) { if (isCurrent()) setError(failure as Error); }
        }
        if (!isCurrent()) return;
        const snapshot = draft.getCurrent();
        const stored = await readPending(projectId, 'save');
        const bindings = [...snapshot.document.inputs,
          ...(stored.record?.pendingWrite?.document.inputs ?? [])];
        const found = await Promise.allSettled(Array.from(new Set(
          bindings.map(input => input.assetId)))
          .map(id => getEffectAsset(projectId, id)));
        if (token !== generation.current) return;
        setAssets(found.flatMap(result => result.status === 'fulfilled'
          ? [result.value] : []));
        void submission.recover();
        return;
      }
      const hasExplicitEntry = entry.newDraft || entry.material || entry.clipId || entry.draftId;
      const hasMemory = draft.draft?.projectId === projectId;
      const recent = !hasExplicitEntry && !hasMemory ? await draftList.ensureFirstPage() : [];
      if (!isCurrent()) return;
      const chosen = !entry.newDraft && !entry.material && !entry.clipId
        && !entry.draftId ? { draftId: (draft.draft?.projectId === projectId
          ? draft.draft.id : undefined) ?? recent[0]?.id } : entry;
      const prepared = await prepareEntry({ entry: chosen, projectId,
        aspectRatioId: owner.current.aspectRatioId,
        materials: owner.current.materials, name: t.effects.labels.untitled });
      if (token !== generation.current) return;
      if (prepared.persisted) observedDrafts.current.add(`${projectId}:${prepared.persisted.id}`);
      draft.load(prepared.working, prepared.persisted);
      setAssets(prepared.assets); setTarget(prepared.target);
      void submission.recover();
    } finally { if (token === generation.current) setBusy(false); }
    }, isCurrent);
  };
  const selectTemplate = (id: string) => {
    attachmentRevision.current++;
    const current = draft.getCurrent();
    const template = getEffectTemplate(id);
    const next = { ...current.document, templateId: id,
      templateVersion: template.version, params: structuredClone(template.defaults),
      inputs: current.document.inputs.filter(input => template.slots.some(slot =>
        slot.id === input.slot && slot.kinds.includes(input.kind))) };
    draft.edit({ name: current.name, document: next });
  };
  const render = () => run(async () => {
    const projectId = owner.current.projectId;
    const token = generation.current;
    if (!canWrite() || submission.pending) return;
      const saved = await draft.flush();
      if (!projectId || !saved || token !== generation.current) return;
      if (!saved.renderability.ready) throw new EffectError('EFFECT_DRAFT_INCOMPLETE');
      await submission.submit({ draftId: saved.id,
        expectedVersion: saved.version });
  });
  const apply = (asset: EffectAsset, mode: 'insert' | 'replace') => run(async () => {
    const projectId = owner.current.projectId;
    if (!projectId) throw new EffectError('EFFECT_NOT_FOUND');
    if (mode === 'replace') {
      if (!target) throw new EffectError('EFFECT_TARGET_CHANGED');
    }
    applyEffectsTimelineAction({ getStore: useTimelineStore.getState,
      getProjectId: () => owner.current.projectId,
      registerMaterial: material => owner.current.registerMaterial(material),
      asset, label: t.effects.labels.title,
      intent: { projectId, operationId: crypto.randomUUID(), mode, target,
        startTime: useTimelineStore.getState().currentTime } });
  });
  const reselect = () => run(async () => {
    const selected = useTimelineStore.getState().selectedItems;
    if (selected.length !== 1 || !owner.current.projectId) {
      throw new EffectError('EFFECT_TARGET_CHANGED');
    }
    const token = generation.current;
    const prepared = await captureTarget({ projectId: owner.current.projectId,
      clipId: selected[0], materials: owner.current.materials });
    if (token === generation.current) setTarget(prepared.target);
  });
  const attach = (slot: string, material: MaterialItem) => {
    if (!canWrite()) return Promise.resolve();
    const projectId = owner.current.projectId;
    const token = generation.current;
    const revision = attachmentRevision.current;
    const epoch = `${token}:${revision}`;
    const isCurrent = () => token === generation.current
      && revision === attachmentRevision.current
      && projectId === owner.current.projectId;
    // Preserve selection order, including the order of slideshow images.
    // A new editor/template does not wait for the old editor's pending I/O.
    if (attachments.current.epoch !== epoch) {
      attachments.current = { epoch, pending: Promise.resolve() };
    }
    const pending = attachments.current.pending.then(() => run(async () => {
      if (!isCurrent()) return;
      if (!projectId) throw new EffectError('EFFECT_NOT_FOUND');
      let asset: EffectAsset;
      try {
        asset = await attachEffectInput(projectId, getLocalSource(material), material.id);
      } catch (error) {
        if (isCurrent()) throw error;
        return;
      }
      if (!isCurrent()) return;
      setAssets(previous => [...previous.filter(a => a.id !== asset.id), asset]);
      const latest = draft.getCurrent();
      const descriptor = getEffectTemplate(latest.document.templateId);
      const destination = descriptor.slots.find(item => item.id === slot);
      const kind = asset.kind === 'input-video' ? 'video' : 'image';
      if (!destination || !destination.kinds.includes(kind)) {
        throw new EffectError('EFFECT_INVALID_ARGUMENT');
      }
      const inputs = slot === 'images' ? [...latest.document.inputs]
        : latest.document.inputs.filter(input => input.slot !== slot);
      if (inputs.filter(input => input.slot === slot).length >= destination.max) {
        throw new EffectError('EFFECT_INVALID_ARGUMENT');
      }
      inputs.push({ slot, assetId: asset.id,
        kind: asset.kind === 'input-video' ? 'video' : 'image',
        fit: 'cover', focalX: 0.5, focalY: 0.5,
        ...(slot === 'images' ? { index: inputs.filter(i => i.slot === slot).length } : {}),
        ...(asset.kind === 'input-video' ? { trimStartSeconds: 0 } : {}) });
      draft.edit({ name: latest.name, document: { ...latest.document, inputs } });
    }));
    attachments.current.pending = pending.catch(() => {});
    return pending;
  };
  const close = async (discardChanges = false) => {
    draftList.invalidate();
    const token = generation.current;
    if (canWrite()) {
      if (discardChanges) await draft.discard();
      else await draft.persistWorking();
    }
    if (token !== generation.current) return;
    generation.current++; editorEpoch.current++; setOpen(false);
    lease.current?.release(); lease.current = undefined; setEditor(false);
    session.current.snapshot = undefined;
    failedEditorSessions.delete(owner.current.projectId ?? '');
  };
  return { isOpen, isEditor, editorEpoch: editorEpoch.current,
    busy, error, assets, target, drafts: draftList.items, draftList, draft, jobs, submission, ...runtime,
    open, close,
    forgetRecoveredDraft: () => failedEditorSessions.delete(owner.current.projectId ?? ''),
    selectTemplate, render, register, apply, reselect, attach, run };
}

async function prepareEntry(options: {
  entry: EffectsEntry; projectId: string; materials: MaterialItem[]; name: string;
  aspectRatioId?: string;
}) {
  if (options.entry.draftId) {
    const persisted = await getEffectDraft(options.projectId, options.entry.draftId);
    const resolved = await Promise.allSettled(Array.from(new Set(persisted.document.inputs
      .map(input => input.assetId))).map(id => getEffectAsset(options.projectId, id)));
    const assets = resolved.flatMap(result => result.status === 'fulfilled'
      ? [result.value] : []);
    return { working: { name: persisted.name, document: persisted.document },
      persisted, assets, target: undefined };
  }
  const document = createEffectDocument();
  const ratios: Record<string, [number, number]> = {
    '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1],
    '4:3': [4, 3], '21:9': [21, 9],
  };
  const [width, height] = ratios[options.aspectRatioId ?? ''] ?? ratios['16:9'];
  const canvasScale = Math.min(1080 / Math.min(width, height),
    1920 / Math.max(width, height));
  document.canvas = { width: Math.floor(width * canvasScale / 2) * 2,
    height: Math.floor(height * canvasScale / 2) * 2, fps: 30 };
  let target: EffectTargetSnapshot | undefined;
  let asset: EffectAsset | undefined;
  if (options.entry.clipId) {
    const clip = findClip(options.entry.clipId).item;
    if (clip.originalMaterialType === 'image') {
      const material = options.materials.find(m => m.id === clip.materialId);
      asset = await attachEffectInput(options.projectId,
        getLocalSource({ ...material, ...clip }), clip.materialId);
    } else {
      const prepared = await captureTarget({ ...options,
        clipId: options.entry.clipId });
      target = prepared.target; asset = prepared.asset;
      document.durationFrames = target.durationFrames!;
    }
  } else if (options.entry.material) {
    asset = await attachEffectInput(options.projectId,
      getLocalSource(options.entry.material), options.entry.material.id);
    if (asset.kind === 'input-video') document.durationFrames =
      Math.min(150, Math.floor(asset.durationSeconds! * 30));
  }
  if (asset) {
    const scale = Math.min(1, 1920 / Math.max(asset.width, asset.height));
    document.canvas = { width: Math.floor(asset.width * scale / 2) * 2,
      height: Math.floor(asset.height * scale / 2) * 2, fps: 30 };
    document.inputs = [{ slot: 'base', assetId: asset.id,
      kind: asset.kind === 'input-video' ? 'video' : 'image',
      fit: 'cover', focalX: 0.5, focalY: 0.5,
      ...(asset.kind === 'input-video'
        ? { trimStartSeconds: (target?.trimStartFrame ?? 0) / 30 } : {}) }];
  }
  return { working: { document, name: options.name }, persisted: undefined,
    assets: asset ? [asset] : [], target };
}

export type EffectsController = ReturnType<typeof useEffectsController>;
