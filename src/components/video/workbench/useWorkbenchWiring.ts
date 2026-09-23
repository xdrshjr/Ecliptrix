'use client';

/**
 * useWorkbenchWiring — the glue between VideoEditingInterface and the
 * workbench shell, kept out of the 2k-line orchestrator (spec RV-15 size
 * gate). It owns layout, the controlled aspect ratio, side-tab opening,
 * segment locate / reveal, the assistant context line and the workbench
 * shortcuts. It never derives segments itself: it receives the single
 * `useSegmentLinks` result from VideoEditingInterface (RV-01).
 */

import { useCallback, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore, type RightPanelTab } from '@/stores/editorFocusStore';
import type { TimelinePanelHandle } from '../timeline';
import type { VideoPlayerPanelRef } from '../components/VideoPlayerPanel/VideoPlayerPanel';
import type { SegmentLinksValue } from '../lib/segments/SegmentLinksContext';
import { useSegmentSelectionSync } from '../hooks/useSegmentSelectionSync';
import type { ToolWindowRailProps } from './ToolWindowRail';
import { useWorkbenchLayout, type UseWorkbenchLayoutReturn } from './useWorkbenchLayout';
import { useWorkbenchShortcuts } from './useWorkbenchShortcuts';

export interface UseWorkbenchWiringInput {
  segmentLinks: SegmentLinksValue;
  videoPlayerRef: React.RefObject<VideoPlayerPanelRef | null>;
  /** Moves the playhead (VideoEditingInterface.handleTimelineTimeChange). */
  onSeek(time: number): void;
  isAssistantOpen: boolean;
  setAssistantOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface UseWorkbenchWiringReturn {
  layout: UseWorkbenchLayoutReturn;
  timelinePanelRef: React.RefObject<TimelinePanelHandle | null>;
  aspectRatioId: string;
  setAspectRatioId(id: string): void;
  railProps: ToolWindowRailProps;
  toggleAssistant(): void;
  /** Pause the final preview before any material-level listening (§3.4.3). */
  pauseComposition(): void;
  openSideTab(tab: RightPanelTab): void;
  locateSegment(segmentId: string): void;
  revealMaterial(materialId: string): void;
  /** 「正在协助：第 2 段 · 活泼天性」, or null for the whole project. */
  assistantContextLabel: string | null;
}

export function useWorkbenchWiring(input: UseWorkbenchWiringInput): UseWorkbenchWiringReturn {
  const { segmentLinks, videoPlayerRef, onSeek, isAssistantOpen, setAssistantOpen } = input;
  const { t } = useLocale();
  useSegmentSelectionSync(segmentLinks.itemSegmentMap);
  const layout = useWorkbenchLayout();
  const timelinePanelRef = useRef<TimelinePanelHandle>(null);
  const [aspectRatioId, setAspectRatioId] = useState('16:9'); // 不持久化（保持现状）
  const rightPanelTab = useEditorFocusStore((state) => state.rightPanelTab);
  const selectedSegmentId = useEditorFocusStore((state) => state.selectedSegmentId);

  const toggleAssistant = useCallback(() => setAssistantOpen((open) => !open), [setAssistantOpen]);
  useWorkbenchShortcuts({ onApplyPreset: layout.applyPreset, onToggleAssistant: toggleAssistant });
  const pauseComposition = useCallback(() => {
    // Same guard as the Space handler: in composition mode the pause path
    // runs the composition play/pause callback, so only call it while playing.
    const player = videoPlayerRef.current;
    if (player?.isPlaying()) void player.pauseFromTimeline();
  }, [videoPlayerRef]);

  // Tabs change only on explicit user actions (§3.4.1 iron rule).
  const { reveal, toggle } = layout;
  const openSideTab = useCallback((tab: RightPanelTab) => {
    useEditorFocusStore.getState().setRightPanelTab(tab);
    reveal('right');
  }, [reveal]);
  const toggleSideTab = (tab: RightPanelTab) => {
    if (layout.visible.right && rightPanelTab === tab) toggle('right');
    else openSideTab(tab);
  };
  const locateSegment = (segmentId: string) => {
    const range = segmentLinks.segmentRanges.get(segmentId);
    if (range) onSeek(range.start);
  };
  const revealMaterial = (materialId: string) => {
    openSideTab('materials');
    useEditorFocusStore.getState().selectMaterial(materialId);
  };

  const selected = selectedSegmentId ? segmentLinks.segmentIndex.get(selectedSegmentId) : undefined;
  const assistantContextLabel = selected
    ? t.workbench.assistant.contextSegment
      .replace('{index}', String(selected.ordinal)).replace('{title}', selected.title)
    : null;

  const railProps: ToolWindowRailProps = {
    isScriptOpen: layout.visible.left,
    isMaterialsOpen: layout.visible.right && rightPanelTab === 'materials',
    isPropertiesOpen: layout.visible.right && rightPanelTab === 'properties',
    isAssistantOpen,
    onToggleScript: () => toggle('left'),
    onToggleMaterials: () => toggleSideTab('materials'),
    onToggleProperties: () => toggleSideTab('properties'),
    onToggleAssistant: toggleAssistant,
    onApplyPreset: layout.applyPreset,
    onResetLayout: layout.reset,
  };

  return {
    layout, timelinePanelRef, aspectRatioId, setAspectRatioId, railProps, toggleAssistant,
    pauseComposition, openSideTab, locateSegment, revealMaterial, assistantContextLabel,
  };
}
