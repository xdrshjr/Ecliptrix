'use client';

/**
 * useWorkbenchWiring — the glue between VideoEditingInterface and the
 * workbench shell, kept out of the 2k-line orchestrator (spec RV-15 size
 * gate). It owns layout, the controlled aspect ratio, side-tab opening,
 * segment locate / reveal, the assistant context line and the workbench
 * shortcuts. It never derives segments itself: it receives the single
 * `useSegmentLinks` result from VideoEditingInterface (RV-01).
 *
 * R2 §3.5 / §3.9: the aspect ratio, the picture fit and the project voice are
 * project settings kept at the top level of the content (uiState drops
 * unknown keys). Writes read the newest content through a ref and advance it
 * at once, so two settings changed in one tick are both kept (RV2-18).
 */

import { useCallback, useRef, useState } from 'react';
import type { CanvasFit, CanvasSettings, DismissibleExportAdvisory, VideoEditingTaskContent } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore, type RightPanelTab } from '@/stores/editorFocusStore';
import type { TimelinePanelHandle } from '../timeline';
import type { VideoPlayerPanelRef } from '../components/VideoPlayerPanel/VideoPlayerPanel';
import type { SegmentLinksValue } from '../lib/segments/SegmentLinksContext';
import { useSegmentSelectionSync } from '../hooks/useSegmentSelectionSync';
import type { AgentEditorContext } from '../hooks/useAgentExecution';
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
  /** Project content (null while loading) and its writer. */
  content: VideoEditingTaskContent | null;
  onUpdateContent(content: VideoEditingTaskContent): void;
}

export interface UseWorkbenchWiringReturn {
  layout: UseWorkbenchLayoutReturn;
  timelinePanelRef: React.RefObject<TimelinePanelHandle | null>;
  aspectRatioId: string;
  setAspectRatioId(id: string): void;
  /** Picture fit of video layers (preview + export); default 'contain'. */
  canvasFit: CanvasFit;
  setCanvasFit(fit: CanvasFit): void;
  /** Persisted project voice, or undefined for an old project (I-1). */
  defaultVoiceId: string | undefined;
  setDefaultVoiceId(voiceId: string): void;
  dismissedAdvisories: readonly DismissibleExportAdvisory[];
  dismissAdvisory(code: DismissibleExportAdvisory): void;
  railProps: ToolWindowRailProps;
  toggleAssistant(): void;
  /** Pause the final preview before any material-level listening (§3.4.3). */
  pauseComposition(): void;
  openSideTab(tab: RightPanelTab): void;
  locateSegment(segmentId: string): void;
  revealMaterial(materialId: string): void;
  /** 「正在协助：第 2 段 · 活泼天性」, or null for the whole project. */
  assistantContextLabel: string | null;
  /** The selected segment for the agent request (R2 §3.12), read at send time. */
  getEditorContext(): AgentEditorContext | null;
}

export function useWorkbenchWiring(input: UseWorkbenchWiringInput): UseWorkbenchWiringReturn {
  const { segmentLinks, videoPlayerRef, onSeek, isAssistantOpen, setAssistantOpen } = input;
  const settings = useProjectSettings(input.content, input.onUpdateContent);
  const { t } = useLocale();
  useSegmentSelectionSync(segmentLinks.itemSegmentMap);
  const layout = useWorkbenchLayout();
  const timelinePanelRef = useRef<TimelinePanelHandle>(null);
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

  const linksRef = useRef(segmentLinks);
  linksRef.current = segmentLinks;
  const refCopy = t.workbench.segmentCommands.impactSegmentRef;
  const getEditorContext = useCallback((): AgentEditorContext | null => {
    const id = useEditorFocusStore.getState().selectedSegmentId;
    const entry = id ? linksRef.current.segmentIndex.get(id) : undefined;
    if (!id || !entry) return null;
    return {
      selectedSegmentId: id,
      segmentLabel: refCopy.replace('{index}', String(entry.ordinal)).replace('{title}', entry.title),
      segmentRange: linksRef.current.segmentRanges.get(id) ?? null,
    };
  }, [refCopy]);

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
    layout, timelinePanelRef, ...settings, railProps, toggleAssistant,
    pauseComposition, openSideTab, locateSegment, revealMaterial, assistantContextLabel,
    getEditorContext,
  };
}

type ProjectSettings = Pick<UseWorkbenchWiringReturn,
  'aspectRatioId' | 'setAspectRatioId' | 'canvasFit' | 'setCanvasFit' | 'defaultVoiceId'
  | 'setDefaultVoiceId' | 'dismissedAdvisories' | 'dismissAdvisory'>;

const DEFAULT_ASPECT_RATIO = '16:9';

/** Project-level canvas / voice settings read from and written to the content. */
export function useProjectSettings(
  content: VideoEditingTaskContent | null,
  onUpdateContent: (content: VideoEditingTaskContent) => void,
): ProjectSettings {
  const contentRef = useRef(content);
  contentRef.current = content;
  const writerRef = useRef(onUpdateContent);
  writerRef.current = onUpdateContent;
  // Before the project is loaded there is nothing to persist into; the
  // ratio then stays a local choice exactly as before R2.
  const [localRatio, setLocalRatio] = useState(DEFAULT_ASPECT_RATIO);

  const write = useCallback((patch: (current: VideoEditingTaskContent) => VideoEditingTaskContent) => {
    const current = contentRef.current;
    if (!current) return false;
    const next = patch(current);
    contentRef.current = next;
    writerRef.current(next);
    return true;
  }, []);
  const writeCanvas = useCallback((patch: Partial<CanvasSettings>) => write((current) => ({
    ...current, canvasSettings: { ...current.canvasSettings, ...patch },
  })), [write]);

  const setAspectRatioId = useCallback((id: string) => {
    setLocalRatio(id);
    writeCanvas({ aspectRatioId: id });
  }, [writeCanvas]);
  const setCanvasFit = useCallback((fit: CanvasFit) => { writeCanvas({ fit }); }, [writeCanvas]);
  const setDefaultVoiceId = useCallback((voiceId: string) => {
    write((current) => ({ ...current, defaultVoiceId: voiceId }));
  }, [write]);
  const dismissAdvisory = useCallback((code: DismissibleExportAdvisory) => {
    const dismissed = contentRef.current?.canvasSettings?.dismissedAdvisories ?? [];
    if (!dismissed.includes(code)) writeCanvas({ dismissedAdvisories: [...dismissed, code] });
  }, [writeCanvas]);

  const canvas = content?.canvasSettings;
  return {
    aspectRatioId: content ? (canvas?.aspectRatioId ?? DEFAULT_ASPECT_RATIO) : localRatio,
    setAspectRatioId,
    canvasFit: canvas?.fit ?? 'contain',
    setCanvasFit,
    defaultVoiceId: content?.defaultVoiceId,
    setDefaultVoiceId,
    dismissedAdvisories: canvas?.dismissedAdvisories ?? [],
    dismissAdvisory,
  };
}
