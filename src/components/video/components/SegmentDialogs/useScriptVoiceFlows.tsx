'use client';

/**
 * useScriptVoiceFlows — the script panel's voice-related flows that need a
 * dialog (spec R2 §3.5 / §3.12): changing the project voice, the batch fill
 * scope, polishing one segment, and serving voice requests raised elsewhere
 * (task centre retry). Kept out of ScriptPanel, which must not grow.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ScriptSegment } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { useSegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import { planBatchFill, type BatchFillScope } from '../../lib/segments/segmentCommands';
import type { SegmentVoiceGeneration } from '../../hooks/useSegmentVoiceGeneration';
import ContentPolishModal from '../ContentPolishModal/ContentPolishModal';
import DefaultVoiceChangeDialog from './DefaultVoiceChangeDialog';
import BatchFillScopeDialog from './BatchFillScopeDialog';

export interface UseScriptVoiceFlowsOptions {
  taskId?: string;
  segmentsRef: MutableRefObject<ScriptSegment[]>;
  voice: SegmentVoiceGeneration;
  defaultVoiceId: string;
  onDefaultVoiceChange?(voiceId: string): void;
  onUpdateSegments?(segments: ScriptSegment[]): void;
}

export interface ScriptVoiceFlows {
  requestDefaultVoiceChange(voiceId: string, voiceName?: string): void;
  openBatchFill(): void;
  /** Plain script edit of one segment (voice / speed / polished text). */
  patchSegment(segmentId: string, patch: Partial<ScriptSegment>): void;
  openPolish(segment: ScriptSegment): void;
  dialogs: React.ReactNode;
}

interface VoiceChangeState { voiceId: string; voiceName: string; affectedIds: string[]; overridden: number }

/** Segments on the project voice that already have a voice-over, and the overridden count. */
export function countDefaultVoiceImpact(
  segments: readonly ScriptSegment[],
  hasVoice: (segmentId: string) => boolean,
): { affectedIds: string[]; overridden: number } {
  const affectedIds: string[] = [];
  let overridden = 0;
  segments.forEach((segment) => {
    if (segment.voiceId) { overridden += 1; return; }
    if (hasVoice(segment.id)) affectedIds.push(segment.id);
  });
  return { affectedIds, overridden };
}

// Hook exceeds 60 lines by design: three small dialog flows share the same
// refs and the rendered dialog node.
export function useScriptVoiceFlows(options: UseScriptVoiceFlowsOptions): ScriptVoiceFlows {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const links = useSegmentLinksValue();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [voiceChange, setVoiceChange] = useState<VoiceChangeState | null>(null);
  const [batchScope, setBatchScope] = useState<BatchFillScope | null>(null);
  const [polishTarget, setPolishTarget] = useState<ScriptSegment | null>(null);
  const voiceRequest = useEditorFocusStore((state) => state.voiceRequest);
  const clearVoiceRequest = useEditorFocusStore((state) => state.clearVoiceRequest);
  const requestSegmentVoice = useEditorFocusStore((state) => state.requestSegmentVoice);
  const copy = t.workbench.segmentCommands;

  // Voice requests raised outside the panel run here, after the render that
  // carries any settings change made together with the request.
  useEffect(() => {
    if (!voiceRequest) return;
    clearVoiceRequest(voiceRequest.nonce);
    const { voice } = optionsRef.current;
    if (voiceRequest.segmentIds.length === 1) {
      const segment = optionsRef.current.segmentsRef.current.find((s) => s.id === voiceRequest.segmentIds[0]);
      if (segment) void voice.convert(segment);
      return;
    }
    void voice.convertMany(voiceRequest.segmentIds).then(({ ok, failed }) => {
      const message = copy.batchFillDone.replace('{ok}', String(ok)).replace('{failed}', String(failed));
      if (failed > 0) showError(message);
      else showSuccess(message);
    });
  }, [voiceRequest, clearVoiceRequest, copy.batchFillDone, showError, showSuccess]);

  const patchSegment = useCallback((segmentId: string, patch: Partial<ScriptSegment>) => {
    const { segmentsRef, onUpdateSegments } = optionsRef.current;
    if (!onUpdateSegments) return;
    const next = segmentsRef.current.map((segment) => (segment.id === segmentId ? { ...segment, ...patch } : segment));
    segmentsRef.current = next;
    onUpdateSegments(next);
  }, []);

  const requestDefaultVoiceChange = useCallback((voiceId: string, voiceName?: string) => {
    const { segmentsRef, onDefaultVoiceChange, defaultVoiceId } = optionsRef.current;
    if (voiceId === defaultVoiceId || !onDefaultVoiceChange) return;
    const impact = countDefaultVoiceImpact(segmentsRef.current,
      (segmentId) => (links.statusById.get(segmentId)?.voice ?? 'none') !== 'none');
    if (impact.affectedIds.length === 0) { onDefaultVoiceChange(voiceId); return; }
    setVoiceChange({ voiceId, voiceName: voiceName ?? voiceId, ...impact });
  }, [links]);

  const openBatchFill = useCallback(() => {
    setBatchScope(planBatchFill(optionsRef.current.segmentsRef.current, links.statusById));
  }, [links]);

  const ordinalOf = (segmentId: string) => links.segmentIndex.get(segmentId)?.ordinal
    ?? optionsRef.current.segmentsRef.current.findIndex((segment) => segment.id === segmentId) + 1;

  const dialogs = (
    <>
      {voiceChange && (
        <DefaultVoiceChangeDialog
          voiceName={voiceChange.voiceName}
          affectedCount={voiceChange.affectedIds.length}
          overriddenCount={voiceChange.overridden}
          onClose={() => setVoiceChange(null)}
          onChoose={(choice) => {
            setVoiceChange(null);
            optionsRef.current.onDefaultVoiceChange?.(voiceChange.voiceId);
            if (choice === 'regenerate') requestSegmentVoice(voiceChange.affectedIds);
          }}
        />
      )}
      {batchScope && (
        <BatchFillScopeDialog
          scope={batchScope}
          ordinalOf={ordinalOf}
          onClose={() => setBatchScope(null)}
          onStart={() => {
            setBatchScope(null);
            requestSegmentVoice(batchScope.voiceTargetIds);
          }}
        />
      )}
      {polishTarget && (
        <ContentPolishModal
          isOpen
          mode="segment"
          title={copy.polishTitle.replace('{index}', String(ordinalOf(polishTarget.id)))}
          onClose={() => setPolishTarget(null)}
          originalContent={polishTarget.narrationText
            ?? polishTarget.sentences.map((sentence) => sentence.text).join('')}
          onContentSelect={(text) => {
            patchSegment(polishTarget.id, { narrationText: text });
            setPolishTarget(null);
          }}
          taskId={options.taskId ?? 'unknown'}
        />
      )}
    </>
  );

  return {
    requestDefaultVoiceChange,
    openBatchFill,
    patchSegment,
    openPolish: setPolishTarget,
    dialogs,
  };
}
