'use client';

/**
 * useSegmentCommands — plan → confirm → apply → script patch for every
 * segment-level command (spec R2 §3.1 / §5.1).
 *
 * Called exactly ONCE, in VideoEditingInterface; cards, material menus, the
 * timeline drop and the inspector reach it through SegmentCommandsContext.
 * It is the only caller of `applySegmentCommandAction`, and it registers the
 * history companion restorer that lets Ctrl+Z undo the script together with
 * the timeline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MaterialItem, ScriptSegment } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import {
  applyScriptOps,
  applySegmentCommandAction,
  isScriptOnlyPlan,
  registerCompanionRestorer,
  useTimelineStore,
} from '../timeline/store';
import { isEditLocked } from '../timeline/store/editLock';
import { deriveTrackDisplayName } from '../timeline/trackDisplayName';
import type { TrackData } from '../timeline/domain';
import {
  buildReorderOp,
  isCandidateStale,
  planScriptOnly,
  planSegmentRemoval,
  planSegmentReorder,
  planSegmentVisualCandidate,
  planSegmentVisualReplace,
  planSegmentVoiceApply,
  planSegmentVoiceApplyMany,
  type SegmentCommandPlan,
  type SegmentCommandResult,
  type SegmentImpact,
  type SegmentPlanContext,
  type SegmentRefusal,
} from '../lib/segments/segmentCommands';
import {
  formatSegmentImpact,
  formatSignedSeconds,
} from '../lib/segments/formatSegmentImpact';
import { stampMaterialForSegment } from '../lib/segments/stampMaterialForSegment';
import type { SegmentLinksValue } from '../lib/segments/SegmentLinksContext';

/** Below this change a new voice-over is applied without asking (§3.4.2). */
const SILENT_DELTA_SECONDS = 0.05;

export interface UseSegmentCommandsOptions {
  getSegments(): ScriptSegment[];
  commitSegments(next: ScriptSegment[]): void;
  getMaterials(): MaterialItem[];
  addMaterial(material: MaterialItem): void;
  /** Latest segment derivation (ordinals, candidates, ranges). */
  getLinks(): SegmentLinksValue;
  /** Effective project voice (persisted, else the built-in default). */
  getDefaultVoiceId(): string;
}

export type SegmentDialogState =
  | { kind: 'none' }
  | {
      kind: 'voice-duration';
      segmentId: string;
      delta: number;
      lines: string[];
      canKeep: boolean;
      isStaleVersion: boolean;
      adjustPlan: SegmentCommandPlan;
      keepPlan: SegmentCommandPlan | null;
      replan(mode: 'adjust' | 'keep'): SegmentCommandResult;
    }
  | {
      kind: 'impact';
      title: string;
      message?: string;
      lines: string[];
      confirmLabel: string;
      onConfirm(): void;
    }
  | {
      kind: 'delete';
      segmentId: string;
      ordinal: number;
      title: string;
      removedItems: SegmentImpact['removedItems'];
      removalLines: string[];
      isEditLocked: boolean;
    };

export interface SegmentCommands {
  /** Apply a voice-over: directly for a tiny change, else via the duration dialog. */
  applyVoice(segmentId: string, candidateId?: string, options?: { allowStale?: boolean }): void;
  applyAllPendingVoices(): void;
  replaceVisual(segmentId: string, materialId: string): void;
  /** Open the delete dialog. */
  requestRemove(segmentId: string): void;
  remove(segmentId: string, options: { removeTimelineItems: boolean }): void;
  previewRemoval(segmentId: string): SegmentImpact | null;
  move(segmentId: string, toIndex: number): void;
  chooseVoiceDuration(choice: 'adjust' | 'keep' | 'edit' | 'skip'): void;
  /** Plain script edit (voice / speed): not a timeline history entry. */
  patchSegment(segmentId: string, patch: Partial<ScriptSegment>): void;
  getSegment(segmentId: string): ScriptSegment | undefined;
  getDefaultVoiceId(): string;
  dialog: SegmentDialogState;
  closeDialog(): void;
}

const NO_DIALOG: SegmentDialogState = { kind: 'none' };

const REFUSAL_KEYS: Record<Exclude<SegmentRefusal, 'edit-locked'>, string> = {
  'segment-not-found': 'segmentNotFound',
  'not-on-timeline': 'notOnTimeline',
  'target-track-locked': 'targetTrackLocked',
  'no-target-track': 'noTargetTrack',
  'span-occupied': 'spanOccupied',
  interleaved: 'interleaved',
  'candidate-stale': 'candidateStale',
  'nothing-to-do': 'nothingToDo',
};

function sameImpact(a: SegmentImpact, b: SegmentImpact): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Focus the narration editor of a just-expanded card (after it renders). */
function focusNarrationEditor(segmentId: string): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => {
    const card = document.querySelector(`[data-segment-id="${CSS.escape(segmentId)}"]`);
    card?.querySelector<HTMLElement>('[data-narration-editor] textarea, [data-narration-editor] button')?.focus();
  }, 60);
}

// Hook exceeds 60 lines by design: it is the single command surface of the
// workbench and each command is a small closure over the same helpers.
export function useSegmentCommands(options: UseSegmentCommandsOptions): SegmentCommands {
  const { t } = useLocale();
  const { showSuccess, showWarning, showError } = useNotification();
  const [dialog, setDialog] = useState<SegmentDialogState>(NO_DIALOG);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const tRef = useRef(t);
  tRef.current = t;

  // RV2-06: one stable restorer reading the newest commit function and
  // script through refs; unregistering only clears itself (StrictMode).
  useEffect(() => registerCompanionRestorer((ops, direction) => {
    const { getSegments, commitSegments } = optionsRef.current;
    commitSegments(applyScriptOps(getSegments(), ops, direction));
  }), []);

  const buildContext = useCallback((): SegmentPlanContext => {
    const { getSegments, getMaterials } = optionsRef.current;
    const trackCopy = tRef.current.timeline.track;
    return {
      tracks: useTimelineStore.getState().exportToData().tracks,
      materialsById: new Map(getMaterials().map((material) => [material.id, material])),
      segments: getSegments(),
      trackName: (track: TrackData) => deriveTrackDisplayName(track, trackCopy),
    };
  }, []);

  const ordinalOf = useCallback((segmentId: string): number =>
    optionsRef.current.getLinks().segmentIndex.get(segmentId)?.ordinal
      ?? optionsRef.current.getSegments().findIndex((segment) => segment.id === segmentId) + 1, []);

  const titleOfOrdinal = useCallback((ordinal: number): string =>
    optionsRef.current.getSegments()[ordinal - 1]?.title ?? '', []);

  const refusalMessage = useCallback((reason: SegmentRefusal): string => {
    if (reason === 'edit-locked') return tRef.current.timeline.messages.editLockedByAgent;
    const refusals = tRef.current.workbench.segmentRefusals as Record<string, string>;
    return refusals[REFUSAL_KEYS[reason]];
  }, []);

  const impactLines = useCallback((impact: SegmentImpact, extra: { gap?: boolean } = {}) =>
    formatSegmentImpact(impact, {
      copy: tRef.current.workbench.segmentCommands,
      titleOf: titleOfOrdinal,
      includeGap: extra.gap,
    }), [titleOfOrdinal]);

  /** Write a plan: timeline first (can be refused), then the script patch. */
  const execute = useCallback((
    plan: SegmentCommandPlan,
    replan: (() => SegmentCommandResult) | null,
    successMessage: string | null,
  ): boolean => {
    const { getSegments, commitSegments, addMaterial } = optionsRef.current;
    const getStore = useTimelineStore.getState;
    if (isEditLocked(getStore())) {
      // RV2-07: script-only commands keep today's behaviour under the lock.
      if (!isScriptOnlyPlan(plan)) {
        showWarning(tRef.current.timeline.messages.editLockedByAgent);
        return false;
      }
      commitSegments(applyScriptOps(getSegments(), plan.scriptOps, 'forward'));
      if (successMessage) showSuccess(successMessage);
      return true;
    }
    let applied = plan;
    plan.addedMaterials.forEach(addMaterial);
    let result = applySegmentCommandAction(getStore, plan);
    if (!result.ok && result.reason === 'stale-plan' && replan) {
      const fresh = replan();
      if (fresh.ok && sameImpact(fresh.impact, plan.impact)) {
        fresh.addedMaterials.forEach(addMaterial);
        applied = fresh;
        result = applySegmentCommandAction(getStore, fresh);
      }
    }
    if (!result.ok) {
      const messages = tRef.current.workbench.segmentCommands;
      if (result.reason === 'edit-locked') showWarning(tRef.current.timeline.messages.editLockedByAgent);
      else if (result.reason === 'stale-plan') showWarning(messages.stalePlan);
      else showError(messages.invalidPlan);
      return false;
    }
    commitSegments(applyScriptOps(getSegments(), applied.scriptOps, 'forward'));
    if (successMessage) showSuccess(successMessage);
    return true;
  }, [showError, showSuccess, showWarning]);

  const closeDialog = useCallback(() => setDialog(NO_DIALOG), []);

  const applyVoice = useCallback((
    segmentId: string,
    candidateId?: string,
    voiceOptions: { allowStale?: boolean } = {},
  ) => {
    const { getMaterials, getLinks, getSegments } = optionsRef.current;
    const candidate = candidateId
      ? getMaterials().find((material) => material.id === candidateId)
      : getLinks().latestVoiceById.get(segmentId);
    const segment = getSegments().find((entry) => entry.id === segmentId);
    if (!candidate || !segment) { showWarning(refusalMessage('segment-not-found')); return; }
    const appliedAt = new Date().toISOString();
    const replan = (lengthMode: 'adjust' | 'keep') => planSegmentVoiceApply(buildContext(), {
      segmentId, candidate, lengthMode, allowStale: voiceOptions.allowStale, appliedAt,
    });
    const adjust = replan('adjust');
    if (!adjust.ok) { showWarning(refusalMessage(adjust.reason)); return; }
    const delta = adjust.impact.durationDelta;
    const isStaleVersion = !!voiceOptions.allowStale && isCandidateStale(candidate, segment);
    if (Math.abs(delta) < SILENT_DELTA_SECONDS && !isStaleVersion) {
      execute(adjust, () => replan('adjust'), tRef.current.workbench.segmentCommands.voiceApplied);
      return;
    }
    const keep = delta < 0 ? replan('keep') : null;
    const onTimeline = getLinks().statusById.get(segmentId)?.voiceOnTimeline !== 'absent';
    setDialog({
      kind: 'voice-duration',
      segmentId,
      delta,
      lines: impactLines(adjust.impact),
      canKeep: onTimeline && !!keep?.ok,
      isStaleVersion,
      adjustPlan: adjust,
      keepPlan: keep?.ok ? keep : null,
      replan,
    });
  }, [buildContext, execute, impactLines, refusalMessage, showWarning]);

  const chooseVoiceDuration = useCallback((choice: 'adjust' | 'keep' | 'edit' | 'skip') => {
    const current = dialog;
    setDialog(NO_DIALOG);
    if (current.kind !== 'voice-duration') return;
    if (choice === 'skip') return;
    if (choice === 'edit') {
      useEditorFocusStore.getState().selectSegment(current.segmentId, 'script');
      focusNarrationEditor(current.segmentId);
      return;
    }
    const plan = choice === 'keep' && current.keepPlan ? current.keepPlan : current.adjustPlan;
    const mode = choice === 'keep' && current.keepPlan ? 'keep' : 'adjust';
    execute(plan, () => current.replan(mode), tRef.current.workbench.segmentCommands.voiceApplied);
  }, [dialog, execute]);

  const applyAllPendingVoices = useCallback(() => {
    const { getLinks, getMaterials, getSegments } = optionsRef.current;
    const links = getLinks();
    const byId = new Map(getMaterials().map((material) => [material.id, material]));
    const entries = getSegments().flatMap((segment) => {
      const candidate = links.statusById.get(segment.id)?.candidate;
      const material = candidate && !candidate.isStale ? byId.get(candidate.materialId) : undefined;
      return material ? [{ segmentId: segment.id, candidate: material }] : [];
    });
    const appliedAt = new Date().toISOString();
    const replan = () => planSegmentVoiceApplyMany(buildContext(), entries, appliedAt);
    const result = replan();
    if (!result.plan) {
      showWarning(refusalMessage(result.skipped[0]?.reason ?? 'nothing-to-do'));
      return;
    }
    const messages = tRef.current.workbench.segmentCommands;
    const plan = result.plan;
    const lines = [
      result.applied.map(({ segmentId, durationDelta }) =>
        `${String(ordinalOf(segmentId)).padStart(2, '0')} ${formatSignedSeconds(durationDelta)}s`).join(' · '),
      ...result.skipped.map(({ segmentId, reason }) => messages.applyAllSkipped
        .replace('{index}', String(ordinalOf(segmentId))).replace('{reason}', refusalMessage(reason))),
      ...impactLines(plan.impact),
    ];
    setDialog({
      kind: 'impact',
      title: messages.applyAllTitle.replace('{count}', String(result.applied.length)),
      lines,
      confirmLabel: messages.applyAll,
      onConfirm: () => {
        setDialog(NO_DIALOG);
        execute(plan, () => replan().plan ?? { ok: false, reason: 'nothing-to-do' },
          messages.allApplied.replace('{count}', String(result.applied.length)));
      },
    });
  }, [buildContext, execute, impactLines, ordinalOf, refusalMessage, showWarning]);

  const replaceVisual = useCallback((segmentId: string, materialId: string) => {
    const material = optionsRef.current.getMaterials().find((entry) => entry.id === materialId);
    const messages = tRef.current.workbench.segmentCommands;
    if (!material) { showWarning(refusalMessage('nothing-to-do')); return; }
    if (material.type !== 'video' && material.type !== 'image') {
      showWarning(messages.dropAudioRejected);
      return;
    }
    const ordinal = ordinalOf(segmentId);
    const segment = optionsRef.current.getSegments().find((entry) => entry.id === segmentId);
    const stampCopy = (source: MaterialItem, copyId: string) => stampMaterialForSegment(source, {
      segmentId, segmentNumber: ordinal, segmentTitle: segment?.title, videoIndexInSegment: 1,
      assignedAt: Date.now(), segmentPrefix: tRef.current.scriptPanel.segments.segmentPrefix,
    }, copyId);
    const copyId = `${material.id}_seg_${Date.now()}`;
    const replan = () => planSegmentVisualReplace(buildContext(), { segmentId, material, copyId, stampCopy });
    const result = replan();
    if (result.ok) {
      execute(result, replan, messages.visualReplaced.replace('{index}', String(ordinal)));
      return;
    }
    if (result.reason === 'not-on-timeline') {
      const candidate = planSegmentVisualCandidate(buildContext(), segmentId, material);
      if (candidate.ok) execute(candidate, null, messages.visualCandidateOnly);
      return;
    }
    showWarning(refusalMessage(result.reason));
  }, [buildContext, execute, ordinalOf, refusalMessage, showWarning]);

  const previewRemoval = useCallback((segmentId: string): SegmentImpact | null => {
    const result = planSegmentRemoval(buildContext(), { segmentId, removeTimelineItems: true });
    return result.ok ? result.impact : null;
  }, [buildContext]);

  const requestRemove = useCallback((segmentId: string) => {
    const segment = optionsRef.current.getSegments().find((entry) => entry.id === segmentId);
    const impact = previewRemoval(segmentId);
    if (!segment || !impact) return;
    setDialog({
      kind: 'delete',
      segmentId,
      ordinal: ordinalOf(segmentId),
      title: segment.title,
      removedItems: impact.removedItems,
      removalLines: impactLines(impact, { gap: true }),
      isEditLocked: isEditLocked(useTimelineStore.getState()),
    });
  }, [impactLines, ordinalOf, previewRemoval]);

  const remove = useCallback((segmentId: string, removeOptions: { removeTimelineItems: boolean }) => {
    setDialog(NO_DIALOG);
    const ordinal = ordinalOf(segmentId);
    const replan = () => planSegmentRemoval(buildContext(), { segmentId, ...removeOptions });
    const result = replan();
    if (!result.ok) { showWarning(refusalMessage(result.reason)); return; }
    const messages = tRef.current.workbench.segmentCommands;
    const locked = isEditLocked(useTimelineStore.getState());
    const message = (locked ? messages.segmentDeletedScriptOnly : messages.segmentDeleted)
      .replace('{index}', String(ordinal));
    if (!execute(result, replan, message)) return;
    const focus = useEditorFocusStore.getState();
    if (focus.selectedSegmentId === segmentId) focus.selectSegment(null, null);
  }, [buildContext, execute, ordinalOf, refusalMessage, showWarning]);

  const moveScriptOnly = useCallback((segmentId: string, toIndex: number, message: string) => {
    const context = buildContext();
    const op = buildReorderOp(context.segments, segmentId, toIndex);
    if (op) execute(planScriptOnly(context, [op]), null, message);
  }, [buildContext, execute]);

  const move = useCallback((segmentId: string, toIndex: number) => {
    const messages = tRef.current.workbench.segmentCommands;
    const from = ordinalOf(segmentId);
    const fill = (template: string) =>
      template.replace('{from}', String(from)).replace('{to}', String(toIndex + 1));
    const replan = () => planSegmentReorder(buildContext(), { segmentId, toIndex });
    const result = replan();
    const locked = isEditLocked(useTimelineStore.getState());
    const openFallback = (message: string) => setDialog({
      kind: 'impact',
      title: messages.reorderBlockedTitle,
      message,
      lines: [],
      confirmLabel: messages.scriptOnly,
      onConfirm: () => {
        setDialog(NO_DIALOG);
        moveScriptOnly(segmentId, toIndex,
          fill(locked ? messages.movedScriptOnlyLocked : messages.movedScriptOnly));
      },
    });
    if (result.ok) {
      const scriptOnly = isScriptOnlyPlan(result);
      if (locked && !scriptOnly) { openFallback(messages.reorderEditLocked); return; }
      const template = scriptOnly
        ? (locked ? messages.movedScriptOnlyLocked : messages.movedScriptOnly)
        : messages.moved;
      execute(result, replan, fill(template));
      return;
    }
    if (result.reason === 'nothing-to-do' || result.reason === 'segment-not-found') return;
    const reasons: Partial<Record<SegmentRefusal, string>> = {
      interleaved: messages.reorderInterleaved.replace('{index}', String(from)),
      'target-track-locked': messages.reorderLocked,
      'not-on-timeline': messages.reorderPartial,
    };
    openFallback(reasons[result.reason] ?? refusalMessage(result.reason));
  }, [buildContext, execute, moveScriptOnly, ordinalOf, refusalMessage]);

  const patchSegment = useCallback((segmentId: string, patch: Partial<ScriptSegment>) => {
    const { getSegments, commitSegments } = optionsRef.current;
    commitSegments(getSegments().map((segment) => (segment.id === segmentId ? { ...segment, ...patch } : segment)));
  }, []);
  const getSegment = useCallback((segmentId: string) =>
    optionsRef.current.getSegments().find((segment) => segment.id === segmentId), []);
  const getDefaultVoiceId = useCallback(() => optionsRef.current.getDefaultVoiceId(), []);

  return useMemo<SegmentCommands>(() => ({
    applyVoice,
    applyAllPendingVoices,
    replaceVisual,
    requestRemove,
    remove,
    previewRemoval,
    move,
    chooseVoiceDuration,
    patchSegment,
    getSegment,
    getDefaultVoiceId,
    dialog,
    closeDialog,
  }), [applyAllPendingVoices, applyVoice, chooseVoiceDuration, closeDialog, dialog, getDefaultVoiceId,
    getSegment, move, patchSegment, previewRemoval, remove, replaceVisual, requestRemove]);
}
