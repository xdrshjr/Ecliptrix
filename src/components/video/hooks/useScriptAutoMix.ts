/**
 * useScriptAutoMix — "AI auto mix" from the script panel (AS2-02 / AS2-04).
 *
 * Arranges the current script's voice-overs and matched videos onto Video 1 /
 * Audio 1 as one undoable step. When existing clips would be replaced the user
 * confirms first, and confirming re-plans from the library and script as they
 * are THEN: TTS or matching that finished while the prompt was open is used,
 * and the prompt reopens when the number of replaced clips changed.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import type { Translations } from '@/lib/i18n';
import type { MaterialItem, ScriptSegment } from '@/types';
import {
  planScriptAutoMix,
  type AutoMixSegmentReport,
  type ScriptAutoMixPlan,
  type ScriptSegmentRef,
} from '../lib/aiMix/planScriptAutoMix';
import { segmentTextHash } from '../lib/aiMix/segmentTextHash';
import {
  applyScriptAutoMixAction,
  checkAutoMixTargets,
  type AutoMixRefusal,
} from '../timeline/store/actions/applyScriptAutoMix';
import { isEditLocked } from '../timeline/store/editLock';
import { useTimelineStore } from '../timeline/store/useTimelineStore';
import { VideoEditingLogger } from '../utils/logger';

export interface UseScriptAutoMixOptions {
  taskId: string;
  getMaterials: () => readonly MaterialItem[];
  /** The current script; undefined when there is none (legacy grouping). */
  getScriptSegments: () => readonly ScriptSegmentRef[] | undefined;
}

export interface AutoMixConfirmState {
  isOpen: boolean;
  replacedItemCount: number;
}

export interface UseScriptAutoMixReturn {
  /** Button entry: lock check → plan → target check → confirm when replacing. */
  requestAutoMix: () => void;
  confirmState: AutoMixConfirmState;
  /** Re-plans and re-checks with the data present at confirm time. */
  confirmAutoMix: () => void;
  cancelAutoMix: () => void;
}

interface PreparedAutoMix {
  plan: ScriptAutoMixPlan;
  replacedItemCount: number;
}

type Notifier = ReturnType<typeof useNotification>;

const CLOSED: AutoMixConfirmState = { isOpen: false, replacedItemCount: 0 };

/** The planner's view of the script: ids, matched videos and voice-over text hash. */
export function toScriptSegmentRefs(
  segments: readonly ScriptSegment[] | undefined,
): ScriptSegmentRef[] | undefined {
  return segments?.map((segment) => ({
    id: segment.id,
    videos: segment.videos,
    textHash: segmentTextHash(segment),
  }));
}

function reportRefusal(
  reason: AutoMixRefusal,
  plan: ScriptAutoMixPlan,
  t: Translations,
  notify: Notifier,
): void {
  const messages = t.videoEditing.autoMix;
  if (reason === 'edit-locked') {
    notify.showWarning(t.timeline.messages.editLockedByAgent);
  } else if (reason === 'track-locked') {
    notify.showWarning(messages.trackLocked);
  } else if (reason === 'no-target-track') {
    notify.showError(messages.noTargetTrack);
  } else {
    notify.showError(messages.noScriptMaterials, 6000);
    announceOrphans(plan, t, notify); // explains why a script with materials planned nothing
  }
}

function announceOrphans(plan: ScriptAutoMixPlan, t: Translations, notify: Notifier): void {
  const count = plan.orphanedMaterialIds.length;
  if (count === 0) return;
  notify.showInfo(t.videoEditing.autoMix.orphansIgnored.replace('{count}', String(count)));
}

function announceApplied(
  plan: ScriptAutoMixPlan,
  t: Translations,
  locale: string,
  notify: Notifier,
): void {
  const messages = t.videoEditing.autoMix;
  const numbersWith = (status: AutoMixSegmentReport['status']) => plan.segments
    .filter((segment) => segment.status === status)
    .map((segment) => segment.segmentNumber)
    .join(locale === 'zh-CN' ? '、' : ', ');
  const skipped = plan.segments.filter((segment) => segment.status === 'skipped-no-audio');
  notify.showSuccess(messages.applied
    .replace('{segments}', String(plan.segments.length - skipped.length)));
  if (skipped.length > 0) {
    notify.showWarning(messages.skippedNoAudio.replace('{list}', numbersWith('skipped-no-audio')));
  }
  if (plan.segments.some((segment) => segment.status === 'video-short')) {
    notify.showWarning(messages.videoShort.replace('{list}', numbersWith('video-short')));
  }
  if (plan.ignoredDuplicateMaterialIds.length > 0) {
    notify.showInfo(messages.duplicatesIgnored
      .replace('{count}', String(plan.ignoredDuplicateMaterialIds.length)));
  }
  announceOrphans(plan, t, notify);
}

export function useScriptAutoMix(options: UseScriptAutoMixOptions): UseScriptAutoMixReturn {
  const { taskId, getMaterials, getScriptSegments } = options;
  const { t, locale } = useLocale();
  const notify = useNotification();
  const logger = useMemo(
    () => new VideoEditingLogger({ taskId, component: 'useScriptAutoMix' }),
    [taskId],
  );
  const [confirmState, setConfirmState] = useState<AutoMixConfirmState>(CLOSED);
  // The count the open prompt shows, read at confirm time without a stale closure.
  const shownCountRef = useRef(0);

  const openConfirm = useCallback((replacedItemCount: number) => {
    shownCountRef.current = replacedItemCount;
    setConfirmState({ isOpen: true, replacedItemCount });
  }, []);

  // Closing keeps the count so the dialog's exit animation shows the same text.
  const closeConfirm = useCallback(() => {
    setConfirmState((current) => ({ ...current, isOpen: false }));
  }, []);

  /** Plan from the data present now; null after telling the user why not. */
  const prepare = useCallback((): PreparedAutoMix | null => {
    // The agent owns the timeline while it runs; the lock may engage while
    // the prompt is open, so every entry re-checks it.
    if (isEditLocked(useTimelineStore.getState())) {
      notify.showWarning(t.timeline.messages.editLockedByAgent);
      return null;
    }
    const plan = planScriptAutoMix(getMaterials(), { segments: getScriptSegments() });
    // Missing or locked targets are reported BEFORE asking to replace, so the
    // user is never asked to confirm an edit that will be refused.
    const check = checkAutoMixTargets(useTimelineStore.getState().tracks, plan);
    if (!check.ok) {
      reportRefusal(check.reason, plan, t, notify);
      return null;
    }
    return { plan, replacedItemCount: check.replacedItemCount };
  }, [getMaterials, getScriptSegments, notify, t]);

  const apply = useCallback((plan: ScriptAutoMixPlan) => {
    const result = applyScriptAutoMixAction(() => useTimelineStore.getState(), plan);
    if (!result.ok) {
      reportRefusal(result.reason, plan, t, notify);
      return;
    }
    announceApplied(plan, t, locale, notify);
    logger.info('Script auto-mix applied', {
      placements: plan.placements.length,
      segments: plan.segments.length,
      orphaned: plan.orphanedMaterialIds.length,
      replacedItemCount: result.replacedItemCount,
    });
  }, [locale, logger, notify, t]);

  const requestAutoMix = useCallback(() => {
    if (getMaterials().length === 0) {
      notify.showError(t.videoEditing.autoMix.noMaterials, 5000);
      return;
    }
    const prepared = prepare();
    if (!prepared) return;
    if (prepared.replacedItemCount > 0) {
      openConfirm(prepared.replacedItemCount);
      return;
    }
    apply(prepared.plan);
  }, [apply, getMaterials, notify, openConfirm, prepare, t]);

  const confirmAutoMix = useCallback(() => {
    const prepared = prepare();
    if (!prepared) {
      closeConfirm();
      return;
    }
    const { plan, replacedItemCount } = prepared;
    if (replacedItemCount > 0 && replacedItemCount !== shownCountRef.current) {
      openConfirm(replacedItemCount); // the user agreed to a different number
      return;
    }
    closeConfirm();
    apply(plan);
  }, [apply, closeConfirm, openConfirm, prepare]);

  return { requestAutoMix, confirmState, confirmAutoMix, cancelAutoMix: closeConfirm };
}
