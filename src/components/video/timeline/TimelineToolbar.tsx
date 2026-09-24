'use client';

import React, { useRef, useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useTimelineStore, removeItemsAction } from './store';
import type { TimelineToolType } from './store';
import { cameraMotionIneligibleReason } from '../playback/camera/eligibility';
import type { CameraIneligibleReason } from '../playback/camera/eligibility';
import { useShallow } from 'zustand/react/shallow';
import PortalTooltip from './PortalTooltip';
import { useAudioClipDisplay } from './audioClipDisplayPref';

/** lucide "audio-waveform" / "rows-3" geometry (lucide-react is not a dependency). */
const AudioWaveformIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2" />
  </svg>
);
const SentenceRowsIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M21 9H3" /><path d="M21 15H3" />
  </svg>
);

/**
 * Audio clips show a clean waveform by default; this toggles the TTS
 * sentence colour blocks instead (editor-shell-ui-consolidation W6). Neutral
 * pressed state — no primary blue.
 */
const AudioDisplayToggle: React.FC = () => {
  const { t } = useLocale();
  const [display, setDisplay] = useAudioClipDisplay();
  const showsSentences = display === 'sentences';
  const title = t.timeline.audioDisplay.toggleTitle;
  return (
    <PortalTooltip className="relative" label={title}>
      <button
        type="button"
        aria-pressed={showsSentences}
        aria-label={title}
        onClick={() => setDisplay(showsSentences ? 'waveform' : 'sentences')}
        className={`p-1.5 rounded-md w-7 h-7 flex items-center justify-center transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
          ${showsSentences ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
      >
        {showsSentences ? <SentenceRowsIcon /> : <AudioWaveformIcon />}
      </button>
    </PortalTooltip>
  );
};

/** One toolbar icon button. */
interface ToolbarButtonConfig {
  id: string;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why the button is disabled; appended to the tooltip. */
  disabledHint?: string;
  comingSoon?: boolean;
  loading?: boolean;
  /** A two-state tool (e.g. Cut): exposes `aria-pressed`. */
  toggle?: boolean;
  isActive?: boolean;
  className?: string;
}

interface TimelineToolbarProps {
  onExportJSON: () => void;
  onImportJSON: (file: File) => void;
  onOrganizeMaterials: () => void;
  onCopy: () => void;
  /** Open the camera-motion panel for the current selection (camera-motion-2d-3d §4.5.1). */
  onOpenCameraMotion: () => void;
  onAddEffect: () => void;
  onAddTransition: () => void;
  onAddSubtitle: () => void;
}

const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
  onExportJSON,
  onImportJSON,
  onOrganizeMaterials,
  onCopy,
  onOpenCameraMotion,
  onAddEffect,
  onAddTransition,
  onAddSubtitle,
}) => {
  const { t } = useLocale();
  const { showError } = useNotification();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Read from store
  const {
    isExporting,
    isImporting,
    isExtractingSubtitles,
    selectedItemsCount,
    editableSelectedCount,
    isEditLocked,
    isInteracting,
    activeTool,
  } = useTimelineStore(
    useShallow((state) => ({
      isExporting: state.isExporting,
      isImporting: state.isImporting,
      isExtractingSubtitles: state.isExtractingSubtitles,
      selectedItemsCount: state.selectedItems.length,
      // Copy/delete ignore clips on locked tracks, so the buttons must too.
      editableSelectedCount: state.selectedItems.filter((id) =>
        state.tracks.some((track) => !track.isLocked && track.items.some((item) => item.id === id)),
      ).length,
      isEditLocked: state.externalEditLock !== null,
      // A drag in flight owns the timeline: a delete under it would be
      // overwritten by the release (TL2-18).
      isInteracting: state.isInteracting,
      activeTool: state.activeTool,
    })),
  );
  const editLockedHint = isEditLocked ? t.timeline.messages.editLockedByAgent : undefined;

  // Store actions
  const setActiveTool = useTimelineStore((state) => state.setActiveTool);

  // Toggle the cut/split tool. When 'cut' is active, clicking a clip on the
  // timeline splits it at the click point (see TimelineItem). Clicking again
  // returns to the default 'select' tool.
  const isCutActive = activeTool === 'cut';
  const handleToggleCut = useCallback(() => {
    setActiveTool(isCutActive ? 'select' : 'cut');
  }, [isCutActive, setActiveTool]);

  const handleDelete = useCallback(() => {
    const state = useTimelineStore.getState();
    if (state.selectedItems.length > 0) {
      removeItemsAction(() => useTimelineStore.getState(), state.selectedItems);
    }
  }, []);

  // 处理导入文件选择
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // 处理文件选择
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
        showError(t.timeline.toolbar.invalidJsonFile);
        event.target.value = '';
        return;
      }
      onImportJSON(file);
    }
    event.target.value = '';
  };

  // 导入项目按钮配置
  const importButton: ToolbarButtonConfig = {
    id: 'import',
    onClick: handleImportClick,
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
        <path d="M12,11L8,15H10.5V19H13.5V15H16L12,11Z"/>
      </svg>
    ),
    label: t.timeline.toolbar.importProject,
    shortcut: '',
    // Importing replaces the whole timeline, which the agent's lock refuses.
    disabled: isImporting || isEditLocked,
    disabledHint: editLockedHint,
    loading: isImporting
  };

  // 剪切/分割工具按钮（toggle）。激活后在时间轴 clip 上点击即按点切分。
  const cutButton: ToolbarButtonConfig = {
    id: 'cut',
    onClick: handleToggleCut,
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm0 12c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3z"/>
      </svg>
    ),
    label: t.timeline.toolbar.cut,
    shortcut: t.timeline.shortcuts.cutShortcut,
    disabled: isEditLocked,
    disabledHint: editLockedHint,
    toggle: true,
    isActive: isCutActive,
  };

  // 基础编辑按钮配置
  const basicEditButtons: ToolbarButtonConfig[] = [
    {
      id: 'copy',
      onClick: onCopy,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
        </svg>
      ),
      label: t.timeline.toolbar.copy,
      shortcut: t.timeline.shortcuts.copyShortcut,
      // Copy duplicates clips onto the timeline, so it is an edit as well.
      disabled: editableSelectedCount === 0 || isEditLocked,
      disabledHint: editLockedHint,
    },
    {
      id: 'delete',
      onClick: handleDelete,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      ),
      label: t.timeline.toolbar.delete,
      shortcut: t.timeline.shortcuts.deleteShortcut,
      disabled: editableSelectedCount === 0 || isEditLocked || isInteracting,
      disabledHint: editLockedHint,
    }
  ];

  // 整理：撤销 / 重做已上移到编辑器顶栏（spec §3.8），快捷键仍由 TimelinePanel 处理。
  const organizeButton: ToolbarButtonConfig = {
    id: 'organize',
    onClick: onOrganizeMaterials,
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
      </svg>
    ),
    label: t.timeline.toolbar.organizeMaterials,
    // Organizing repacks every lane, so it is an edit like any other.
    disabled: isEditLocked,
    disabledHint: editLockedHint,
  };

  // 运镜按钮可用性：走 canApplyCameraMotion 单一判据（§4.5.1 / P2-7），并把
  // 「为什么不可用」映射成一条解释性 tooltip，避免用户对着灰按钮猜。
  const cameraMotionEligibility = useTimelineStore(
    useShallow((state) => {
      const selected = state.selectedItems;
      if (selected.length === 0) return { enabled: false, reason: 'no-selection' as const };
      let firstReason: CameraIneligibleReason = 'no-selection';
      for (const itemId of selected) {
        for (const track of state.tracks) {
          const item = track.items.find((candidate) => candidate.id === itemId);
          if (!item) continue;
          const reason = cameraMotionIneligibleReason(item, track);
          if (reason === null) return { enabled: true, reason: null };
          firstReason = reason;
        }
      }
      return { enabled: false, reason: firstReason };
    }),
  );

  const cameraMotionDisabledHint =
    cameraMotionEligibility.reason === 'track-locked'
      ? t.timeline.cameraMotion.disabledTrackLocked
      : cameraMotionEligibility.reason === 'not-visual'
        ? t.timeline.cameraMotion.disabledNotVisual
        : t.timeline.cameraMotion.disabledNoSelection;

  // 轨道功能：运镜、字幕、导出 / 导入 JSON
  const trackFeatureButtons: ToolbarButtonConfig[] = [
    {
      id: 'motion',
      onClick: onOpenCameraMotion,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4zM10 15.5v-7l5 3.5-5 3.5z"/>
        </svg>
      ),
      label: t.timeline.toolbar.motion,
      shortcut: t.timeline.shortcuts.motionShortcut,
      disabled: !cameraMotionEligibility.enabled,
      disabledHint: cameraMotionDisabledHint,
    },
    {
      id: 'subtitles',
      onClick: onAddSubtitle,
      icon: isExtractingSubtitles ? (
        <div className="relative w-4 h-4">
          <svg className="w-4 h-4 animate-spin" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
        </div>
      ) : (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
        </svg>
      ),
      label: isExtractingSubtitles ? t.timeline.toolbar.extractingSubtitles : t.timeline.toolbar.subtitles,
      shortcut: t.timeline.shortcuts.subtitlesShortcut,
      disabled: isExtractingSubtitles || isEditLocked,
      disabledHint: editLockedHint,
    },
    {
      id: 'export-json',
      onClick: onExportJSON,
      icon: isExporting ? (
        <div className="relative w-4 h-4">
          <svg className="w-4 h-4 animate-spin" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
        </div>
      ) : (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
        </svg>
      ),
      label: isExporting ? t.timeline.toolbar.exportingJson : t.timeline.toolbar.exportJson,
      shortcut: t.timeline.shortcuts.exportShortcut,
      disabled: isExporting
    },
    importButton,
  ];

  // 即将推出：特效、转场
  const comingSoonButtons: ToolbarButtonConfig[] = [
    {
      id: 'effects',
      onClick: onAddEffect,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
      ),
      label: t.timeline.toolbar.effects,
      shortcut: t.timeline.shortcuts.effectsShortcut,
      comingSoon: true,
      disabled: true,
    },
    {
      id: 'transitions',
      onClick: onAddTransition,
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H3v16h2l2-4h3l2 4h2l-2-4h3l2 4h2l-2-4h3l2 4h2V4z"/>
        </svg>
      ),
      label: t.timeline.toolbar.transitions,
      shortcut: t.timeline.shortcuts.transitionsShortcut,
      comingSoon: true,
      disabled: true,
    }
  ];

  // Tooltip text, built once per button. It renders through PortalTooltip: an
  // in-button bubble was clipped by `.timeline-toolbar button { overflow:
  // hidden }` and never showed, and a native `title` would duplicate it.
  const tooltipText = (button: ToolbarButtonConfig): string => {
    if (button.comingSoon) return t.timeline.messages.featureComingSoon;
    if (button.disabled && button.disabledHint) return `${button.label} — ${button.disabledHint}`;
    return button.shortcut ? `${button.label} (${button.shortcut})` : button.label;
  };

  // 渲染图标按钮
  const renderIconButton = (button: ToolbarButtonConfig) => (
    <PortalTooltip key={button.id} className="relative" label={tooltipText(button)}>
      <button
        type="button"
        onClick={() => {
          if (!button.disabled) {
            button.onClick();
          }
        }}
        className={`
          relative p-1.5 rounded-md transition-all duration-200 flex items-center justify-center w-7 h-7
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
          ${button.disabled
            ? 'text-muted-foreground cursor-not-allowed bg-muted'
            : button.isActive
              ? 'text-primary bg-primary-a/15 border border-transparent shadow-inner'
              : button.className || 'text-foreground hover:text-foreground hover:bg-muted active:bg-accent border border-transparent'
          }
        `}
        disabled={button.disabled}
        aria-pressed={button.toggle ? Boolean(button.isActive) : undefined}
        aria-label={
          button.comingSoon
            ? `${button.label} — ${t.timeline.messages.featureComingSoon}`
            : (button.shortcut ? `${button.label} (${button.shortcut})` : button.label)
        }
      >
        <span className={button.disabled ? 'opacity-50' : ''}>
          {button.icon}
        </span>
      </button>
    </PortalTooltip>
  );

  // Groups (spec §3.8): 编辑 | 整理 | 运镜、字幕、JSON | 即将推出 — 1px apart.
  const buttonGroups: ToolbarButtonConfig[][] = [
    [cutButton, ...basicEditButtons],
    [organizeButton],
    trackFeatureButtons,
    comingSoonButtons,
  ];

  return (
    <div className="timeline-toolbar h-9 bg-card border-b border-border flex items-center justify-between px-3 relative overflow-visible">
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="flex items-center">
        {buttonGroups.map((group, index) => (
          <React.Fragment key={group[0].id}>
            {index > 0 && <div className="w-px h-4 bg-border mx-1.5" aria-hidden="true" />}
            <div className="flex items-center gap-0.5">
              {group.map(button => renderIconButton(button))}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* 状态显示 */}
      <div className="flex items-center space-x-3 text-xs text-muted-foreground">
        <AudioDisplayToggle />
        {selectedItemsCount > 0 && (
          <div className="flex items-center space-x-1 bg-primary-a/10 px-2 py-1 rounded-full">
            <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            <span className="text-primary font-medium text-xs">
              {t.timeline.status.selectedItems.replace('{count}', selectedItemsCount.toString())}
            </span>
          </div>
        )}

        <div className="hidden md:flex items-center space-x-1 text-xs" aria-live="polite">
          <span>
            {t.timeline.status.currentTool.replace(
              '{tool}',
              isCutActive ? t.timeline.toolbar.cut : t.timeline.toolbar.select,
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

export default TimelineToolbar;
