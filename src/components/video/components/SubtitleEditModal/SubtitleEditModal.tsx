'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  TimelineItem,
  SubtitleStyle,
  SubtitleStylePreset,
  SubtitleFontFamily,
  SubtitlePosition,
} from '@/types';
import { VideoEditingLogger } from '../../utils';
import type { SupportedLocale, Translations } from '@/lib/i18n';
import { useLocale } from '@/contexts/LocaleContext';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import { trapTabKey } from '@/components/ui/focusTrap';

interface SubtitleEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Return `false` to keep the dialog open (the save was blocked and explained). */
  onSave: (subtitles: TimelineItem[]) => boolean | void;
  subtitles: TimelineItem[];
  taskId: string;
  /** Kept for backward compatibility; the locale context always wins. */
  locale?: SupportedLocale;
  /** The agent holds the timeline (S9): saving is disabled and the reason shown. */
  isEditLocked?: boolean;
}

type SubtitleEditLabels = Translations['timeline']['subtitleEditModal'];

// Predefined subtitle style presets; display names come from i18n by id.
const SUBTITLE_STYLE_PRESETS: Array<SubtitleStylePreset & { id: keyof SubtitleEditLabels['presets'] }> = [
  {
    id: 'default',
    name: 'Default',
    style: {
      fontFamily: 'default',
      fontSize: 60,
      fontColor: '#FFFFFF',
      position: 'bottom'
      // 注意：没有backgroundColor，表示无背景
    }
  },
  {
    id: 'classic',
    name: 'Classic',
    style: {
      fontFamily: 'default',
      fontSize: 60,
      fontColor: '#FFFFFF',
      backgroundColor: '#000000',
      position: 'bottom'
    }
  },
  {
    id: 'modern',
    name: 'Modern',
    style: {
      fontFamily: 'sans-serif',
      fontSize: 60,
      fontColor: '#FFFFFF',
      position: 'bottom'
    }
  },
  {
    id: 'elegant',
    name: 'Elegant',
    style: {
      fontFamily: 'serif',
      fontSize: 60,
      fontColor: '#F0F0F0',
      backgroundColor: '#1A1A1A',
      position: 'bottom'
    }
  },
  {
    id: 'tech',
    name: 'Tech',
    style: {
      fontFamily: 'monospace',
      fontSize: 60,
      fontColor: '#00FF00',
      backgroundColor: '#000000',
      position: 'bottom'
    }
  }
];

const DEFAULT_STYLE = SUBTITLE_STYLE_PRESETS[0].style;

const FONT_FAMILY_OPTIONS: { value: SubtitleFontFamily; labelKey: keyof SubtitleEditLabels['fonts'] }[] = [
  { value: 'default', labelKey: 'default' },
  { value: 'serif', labelKey: 'serif' },
  { value: 'sans-serif', labelKey: 'sansSerif' },
  { value: 'monospace', labelKey: 'monospace' }
];

const POSITION_OPTIONS: { value: SubtitlePosition; labelKey: keyof SubtitleEditLabels['positions'] }[] = [
  { value: 'top', labelKey: 'top' },
  { value: 'upper-3/4', labelKey: 'upper34' },
  { value: 'center', labelKey: 'center' },
  { value: 'lower-3/4', labelKey: 'lower34' },
  { value: 'bottom', labelKey: 'bottom' }
];

const TITLE_ID = 'subtitle-edit-modal-title';
const EDIT_LOCK_HINT_ID = 'subtitle-edit-modal-lock-hint';

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

function withDefaultStyle(subtitles: TimelineItem[], fallback: SubtitleStyle): TimelineItem[] {
  return subtitles.map(subtitle => ({ ...subtitle, subtitleStyle: subtitle.subtitleStyle || fallback }));
}

// ---------------------------------------------------------------------------
// Left panel — style settings (presentational; one panel per component keeps
// the markup readable, so it is not split further to meet the 60-line limit)
// ---------------------------------------------------------------------------

interface StylePanelProps {
  labels: SubtitleEditLabels;
  currentStyle: SubtitleStyle;
  isEditingSingle: boolean;
  onPresetSelect: (preset: SubtitleStylePreset) => void;
  onStyleChange: (property: keyof SubtitleStyle, value: SubtitleStyle[keyof SubtitleStyle]) => void;
  onApplyToAll: () => void;
}

const StylePanel: React.FC<StylePanelProps> = ({
  labels,
  currentStyle,
  isEditingSingle,
  onPresetSelect,
  onStyleChange,
  onApplyToAll,
}) => (
  <div className="w-80 bg-muted border-r border-border flex flex-col">
    <div className="p-4 border-b border-border">
      <h3 className="text-lg font-semibold text-foreground mb-2">{labels.styleSettings}</h3>
      <p className="text-sm text-muted-foreground">
        {isEditingSingle ? labels.editingSingle : labels.editingAll}
      </p>
    </div>

    {/* Scrollable content area */}
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {/* Style Presets */}
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-3">{labels.presetsHeading}</h4>
        <div className="grid grid-cols-2 gap-2">
          {SUBTITLE_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onPresetSelect(preset)}
              className="p-3 text-left border border-border rounded-md hover:border-primary/30 hover:bg-primary/10 transition-colors"
            >
              <div className="text-sm font-medium text-foreground">{labels.presets[preset.id]}</div>
              <div
                className="text-xs mt-1 px-2 py-1 rounded"
                aria-hidden="true"
                style={{
                  color: preset.style.fontColor,
                  backgroundColor: preset.style.backgroundColor || 'transparent',
                  fontFamily: preset.style.fontFamily === 'default' ? 'inherit' : preset.style.fontFamily,
                  fontSize: '10px'
                }}
              >
                {labels.presetSample}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Font Family */}
      <div>
        <label htmlFor="subtitle-edit-font-family" className="block text-sm font-semibold text-foreground mb-2">
          {labels.fontFamily}
        </label>
        <select
          id="subtitle-edit-font-family"
          value={currentStyle.fontFamily}
          onChange={(e) => onStyleChange('fontFamily', e.target.value as SubtitleFontFamily)}
          className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary"
        >
          {FONT_FAMILY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {labels.fonts[option.labelKey]}
            </option>
          ))}
        </select>
      </div>

      {/* Font Size */}
      <div>
        <label htmlFor="subtitle-edit-font-size" className="block text-sm font-semibold text-foreground mb-2">
          {labels.fontSize.replace('{size}', String(currentStyle.fontSize))}
        </label>
        <input
          id="subtitle-edit-font-size"
          type="range"
          min="10"
          max="120"
          value={currentStyle.fontSize}
          onChange={(e) => onStyleChange('fontSize', parseInt(e.target.value, 10))}
          className="w-full h-2 bg-accent rounded-md appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>10px</span>
          <span>120px</span>
        </div>
      </div>

      {/* Font Color */}
      <div>
        <label htmlFor="subtitle-edit-font-color" className="block text-sm font-semibold text-foreground mb-2">
          {labels.fontColor}
        </label>
        <div className="flex items-center space-x-3">
          <input
            id="subtitle-edit-font-color"
            type="color"
            value={currentStyle.fontColor}
            onChange={(e) => onStyleChange('fontColor', e.target.value)}
            className="w-12 h-8 border border-border rounded-md cursor-pointer"
          />
          <input
            type="text"
            value={currentStyle.fontColor}
            onChange={(e) => onStyleChange('fontColor', e.target.value)}
            aria-label={labels.fontColor}
            className="flex-1 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary font-mono text-sm"
            placeholder="#FFFFFF"
          />
        </div>
      </div>

      {/* Background Color */}
      <div>
        <span className="block text-sm font-semibold text-foreground mb-2">{labels.backgroundColor}</span>
        <label className="flex items-center space-x-3">
          <input
            type="checkbox"
            checked={!!currentStyle.backgroundColor}
            onChange={(e) => onStyleChange('backgroundColor', e.target.checked ? '#000000' : undefined)}
            className="w-4 h-4 text-primary border-border rounded focus:ring-primary"
          />
          <span className="text-sm text-muted-foreground">{labels.enableBackground}</span>
        </label>
        {currentStyle.backgroundColor && (
          <div className="flex items-center space-x-3 mt-2">
            <input
              type="color"
              value={currentStyle.backgroundColor}
              onChange={(e) => onStyleChange('backgroundColor', e.target.value)}
              aria-label={labels.backgroundColor}
              className="w-12 h-8 border border-border rounded-md cursor-pointer"
            />
            <input
              type="text"
              value={currentStyle.backgroundColor}
              onChange={(e) => onStyleChange('backgroundColor', e.target.value)}
              aria-label={labels.backgroundColor}
              className="flex-1 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary font-mono text-sm"
              placeholder="#000000"
            />
          </div>
        )}
      </div>

      {/* Position */}
      <div>
        <label htmlFor="subtitle-edit-position" className="block text-sm font-semibold text-foreground mb-2">
          {labels.position}
        </label>
        <select
          id="subtitle-edit-position"
          value={currentStyle.position}
          onChange={(e) => onStyleChange('position', e.target.value as SubtitlePosition)}
          className="w-full px-3 py-2 text-sm border border-border rounded-md bg-card text-foreground hover:border-border focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
        >
          {POSITION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {labels.positions[option.labelKey]}
            </option>
          ))}
        </select>
      </div>

      {/* Preview */}
      <div>
        <span className="block text-sm font-semibold text-foreground mb-2">{labels.stylePreview}</span>
        <div className="bg-black rounded-md p-4 flex items-center justify-center min-h-[80px]">
          <div
            style={{
              color: currentStyle.fontColor,
              backgroundColor: currentStyle.backgroundColor || 'transparent',
              fontFamily: currentStyle.fontFamily === 'default' ? 'inherit' : currentStyle.fontFamily,
              fontSize: `${Math.max(12, Math.min(36, currentStyle.fontSize * 0.4))}px`,
              padding: currentStyle.backgroundColor ? '4px 8px' : '0',
              borderRadius: currentStyle.backgroundColor ? '4px' : '0'
            }}
          >
            {labels.stylePreviewSample}
          </div>
        </div>
      </div>
    </div>

    {/* Fixed Apply to All Button at bottom */}
    <div className="p-4 border-t border-border bg-muted flex-shrink-0">
      <button
        type="button"
        onClick={onApplyToAll}
        className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary-a/90 transition-colors font-medium"
      >
        {labels.applyToAll}
      </button>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Right panel — subtitle text list
// ---------------------------------------------------------------------------

interface SubtitleListProps {
  labels: SubtitleEditLabels;
  subtitles: readonly TimelineItem[];
  selectedSubtitleId: string | null;
  onSelect: (subtitleId: string) => void;
  onTextChange: (subtitleId: string, text: string) => void;
}

const SubtitleList: React.FC<SubtitleListProps> = ({
  labels,
  subtitles,
  selectedSubtitleId,
  onSelect,
  onTextChange,
}) => (
  <div className="flex-1 flex flex-col">
    <div className="p-4 border-b border-border">
      <h3 className="text-lg font-semibold text-foreground">{labels.contentHeading}</h3>
      <p className="text-sm text-muted-foreground mt-1">{labels.contentHint}</p>
    </div>

    <div className="flex-1 overflow-y-auto p-4">
      <div className="space-y-4">
        {subtitles.map((subtitle, index) => {
          const isSelected = selectedSubtitleId === subtitle.id;
          const fieldId = `subtitle-edit-text-${subtitle.id}`;
          return (
            <div
              key={subtitle.id}
              className={`rounded-md p-4 border transition-colors cursor-pointer ${
                isSelected ? 'bg-primary/10 border-primary/30' : 'bg-muted border-border hover:border-border'
              }`}
              onClick={() => onSelect(subtitle.id)}
            >
              <div className="flex items-start space-x-4">
                {/* Subtitle number */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                }`}>
                  {index + 1}
                </div>

                {/* Subtitle content */}
                <div className="flex-1 space-y-3">
                  {/* Time info */}
                  <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                    <div className="flex items-center space-x-1">
                      <span className="font-medium">{labels.startTime}</span>
                      <span className="font-mono bg-muted px-2 py-1 rounded-md">{formatTime(subtitle.startTime)}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <span className="font-medium">{labels.duration}</span>
                      <span className="font-mono bg-muted px-2 py-1 rounded-md">{formatTime(subtitle.duration)}</span>
                    </div>
                  </div>

                  {/* Text editor */}
                  <div>
                    <label htmlFor={fieldId} className="block text-sm font-medium text-foreground mb-2">
                      {labels.subtitleText}
                    </label>
                    <textarea
                      id={fieldId}
                      value={subtitle.text || ''}
                      onChange={(e) => onTextChange(subtitle.id, e.target.value)}
                      onFocus={() => onSelect(subtitle.id)}
                      placeholder={labels.placeholder}
                      className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-primary resize-none transition-colors text-foreground"
                      rows={2}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  {/* Style preview for this subtitle */}
                  {subtitle.subtitleStyle && (
                    <div className="bg-black rounded p-2 flex items-center justify-center">
                      <div
                        style={{
                          color: subtitle.subtitleStyle.fontColor,
                          backgroundColor: subtitle.subtitleStyle.backgroundColor || 'transparent',
                          fontFamily: subtitle.subtitleStyle.fontFamily === 'default' ? 'inherit' : subtitle.subtitleStyle.fontFamily,
                          fontSize: `${Math.max(10, Math.min(24, subtitle.subtitleStyle.fontSize * 0.3))}px`,
                          padding: subtitle.subtitleStyle.backgroundColor ? '2px 4px' : '0',
                          borderRadius: subtitle.subtitleStyle.backgroundColor ? '2px' : '0'
                        }}
                      >
                        {subtitle.text || labels.itemPreviewFallback}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

const SubtitleEditModal: React.FC<SubtitleEditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  subtitles,
  taskId,
  isEditLocked = false,
}) => {
  const [editedSubtitles, setEditedSubtitles] = useState<TimelineItem[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);
  const [currentStyle, setCurrentStyle] = useState<SubtitleStyle>(DEFAULT_STYLE);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);

  // 使用 ref 跟踪模态框初始化状态和上次的字幕ID列表
  const isInitializedRef = useRef(false);
  const lastSubtitleIdsRef = useRef<string[]>([]);
  const preservedStyleRef = useRef<SubtitleStyle | null>(null);
  // Serialized subtitles as opened: closing asks before discarding only when
  // the edit actually differs (typing then undoing the text is not a change).
  const openedSnapshotRef = useRef('[]');

  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const backdropPressedRef = useRef(false);
  const didInitialFocusRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const shouldRestoreFocusRef = useRef(false);

  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'SubtitleEditModal'
  }), [taskId]);

  const { t } = useLocale();
  const labels = t.timeline.subtitleEditModal;

  // Remember the opener. Declared first so it runs before the initial-focus
  // effect moves focus into the dialog.
  useEffect(() => {
    if (!isOpen) return undefined;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const previous = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // Hand focus back only when it was still inside the dialog on close;
      // otherwise the user already moved on and must not be yanked back.
      if (shouldRestoreFocusRef.current && previous?.isConnected) previous.focus();
      shouldRestoreFocusRef.current = false;
    };
  }, [isOpen]);

  // 处理模态框打开和关闭
  useEffect(() => {
    if (isOpen && !isInitializedRef.current) {
      logger.info('Subtitle edit dialog opened', {
        subtitleCount: subtitles.length,
        subtitleIds: subtitles.map(s => s.id),
        defaultStyle: DEFAULT_STYLE,
        timestamp: new Date().toISOString()
      });

      const initializedSubtitles = withDefaultStyle(subtitles, DEFAULT_STYLE);
      setEditedSubtitles(initializedSubtitles);
      openedSnapshotRef.current = JSON.stringify(initializedSubtitles);
      setHasChanges(false);

      if (initializedSubtitles.length > 0) {
        setSelectedSubtitleId(initializedSubtitles[0].id);
        setCurrentStyle(initializedSubtitles[0].subtitleStyle || DEFAULT_STYLE);
      }

      lastSubtitleIdsRef.current = subtitles.map(s => s.id);
      isInitializedRef.current = true;
    } else if (!isOpen && isInitializedRef.current) {
      logger.info('Subtitle edit dialog closed, resetting state', {
        timestamp: new Date().toISOString()
      });

      isInitializedRef.current = false;
      lastSubtitleIdsRef.current = [];
      preservedStyleRef.current = null;
      setIsDiscardConfirmOpen(false);
    }
  }, [isOpen]);

  // 处理字幕内容变化（仅在模态框已初始化时）
  useEffect(() => {
    if (!isOpen || !isInitializedRef.current) return;

    const currentSubtitleIds = subtitles.map(s => s.id);
    const lastSubtitleIds = lastSubtitleIdsRef.current;
    const idsChanged = currentSubtitleIds.length !== lastSubtitleIds.length ||
                       currentSubtitleIds.some((id, index) => id !== lastSubtitleIds[index]);
    if (!idsChanged) return;

    logger.info('Subtitles changed while the dialog is open, refreshing edit state', {
      oldIds: lastSubtitleIds,
      newIds: currentSubtitleIds,
      preservedStyle: preservedStyleRef.current,
      timestamp: new Date().toISOString()
    });

    // 保存当前样式以便在更新后恢复
    preservedStyleRef.current = currentStyle;
    const updatedSubtitles = withDefaultStyle(subtitles, preservedStyleRef.current || DEFAULT_STYLE);
    setEditedSubtitles(updatedSubtitles);
    // The list was replaced from outside, so it becomes the new baseline.
    openedSnapshotRef.current = JSON.stringify(updatedSubtitles);

    if (selectedSubtitleId && currentSubtitleIds.includes(selectedSubtitleId)) {
      const selectedSubtitle = updatedSubtitles.find(s => s.id === selectedSubtitleId);
      if (selectedSubtitle?.subtitleStyle) {
        setCurrentStyle(selectedSubtitle.subtitleStyle);
      }
    } else if (updatedSubtitles.length > 0) {
      setSelectedSubtitleId(updatedSubtitles[0].id);
      setCurrentStyle(updatedSubtitles[0].subtitleStyle || preservedStyleRef.current || DEFAULT_STYLE);
    }

    lastSubtitleIdsRef.current = currentSubtitleIds;
  }, [subtitles, isOpen, selectedSubtitleId, currentStyle]);

  // Initial focus: the first subtitle field (or Cancel when there is nothing
  // to edit), once per opening and only after the fields have rendered.
  useEffect(() => {
    if (!isOpen) {
      didInitialFocusRef.current = false;
      return;
    }
    if (didInitialFocusRef.current) return;
    if (subtitles.length > 0 && editedSubtitles.length === 0) return;
    didInitialFocusRef.current = true;
    const firstField = dialogRef.current?.querySelector<HTMLTextAreaElement>('textarea');
    (firstField ?? cancelButtonRef.current ?? dialogRef.current)?.focus();
  }, [isOpen, subtitles.length, editedSubtitles.length]);

  const sortedSubtitles = useMemo(
    () => [...editedSubtitles].sort((a, b) => a.startTime - b.startTime),
    [editedSubtitles],
  );

  // Handle subtitle text change
  const handleSubtitleChange = useCallback((subtitleId: string, newText: string) => {
    logger.info('Subtitle text changed', {
      subtitleId,
      newTextLength: newText.length,
      timestamp: new Date().toISOString()
    });

    setEditedSubtitles(prev =>
      prev.map(subtitle =>
        subtitle.id === subtitleId
          ? {
              ...subtitle,
              text: newText,
              name: `${t.timeline.messages.subtitlePrefix}: ${newText.substring(0, 20)}${newText.length > 20 ? '...' : ''}`
            }
          : subtitle
      )
    );
    setHasChanges(true);
  }, [logger, t]);

  const closeDialog = useCallback(() => {
    const dialog = dialogRef.current;
    shouldRestoreFocusRef.current = !!dialog && dialog.contains(document.activeElement);
    onClose();
  }, [onClose]);

  // Every dismissal path (Escape, ×, Cancel, backdrop) asks before throwing
  // edits away; an unchanged dialog just closes.
  const requestClose = useCallback(() => {
    if (JSON.stringify(editedSubtitles) !== openedSnapshotRef.current) {
      setIsDiscardConfirmOpen(true);
      return;
    }
    logger.info('Subtitle edit dialog dismissed without changes', { timestamp: new Date().toISOString() });
    closeDialog();
  }, [editedSubtitles, closeDialog, logger]);

  const handleDiscardConfirmed = useCallback(() => {
    logger.info('Unsaved subtitle edits discarded', { timestamp: new Date().toISOString() });
    setIsDiscardConfirmOpen(false);
    // Focus sits in the confirmation (outside the dialog card) at this point.
    shouldRestoreFocusRef.current = true;
    onClose();
  }, [onClose, logger]);

  const handleDiscardCancelled = useCallback(() => {
    setIsDiscardConfirmOpen(false);
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    if (isEditLocked) return;
    logger.info('Saving subtitle edits', {
      subtitleCount: editedSubtitles.length,
      hasChanges,
      timestamp: new Date().toISOString()
    });

    const saved = hasChanges ? onSave(editedSubtitles) : true;
    // The owner refused (e.g. the track got locked): keep the edits on screen.
    if (saved === false) return;
    closeDialog();
  }, [editedSubtitles, hasChanges, isEditLocked, onSave, closeDialog, logger]);

  // Handle subtitle selection
  const handleSubtitleSelect = useCallback((subtitleId: string) => {
    setSelectedSubtitleId(subtitleId);
    const selectedSubtitle = editedSubtitles.find(s => s.id === subtitleId);
    if (selectedSubtitle?.subtitleStyle) {
      setCurrentStyle(selectedSubtitle.subtitleStyle);
    }
  }, [editedSubtitles]);

  const applyStyle = useCallback((style: SubtitleStyle) => {
    // 保存样式到 ref 以便在更新时保持
    preservedStyleRef.current = style;
    setCurrentStyle(style);
    setEditedSubtitles(prev =>
      prev.map(subtitle =>
        !selectedSubtitleId || subtitle.id === selectedSubtitleId
          ? { ...subtitle, subtitleStyle: style }
          : subtitle
      )
    );
    setHasChanges(true);
  }, [selectedSubtitleId]);

  // Handle style preset selection
  const handlePresetSelect = useCallback((preset: SubtitleStylePreset) => {
    logger.info('Subtitle style preset applied', {
      presetId: preset.id,
      selectedSubtitleId,
      previousStyle: currentStyle,
      newStyle: preset.style,
      timestamp: new Date().toISOString()
    });
    applyStyle(preset.style);
  }, [selectedSubtitleId, currentStyle, applyStyle, logger]);

  // Handle individual style property changes
  const handleStyleChange = useCallback((property: keyof SubtitleStyle, value: SubtitleStyle[keyof SubtitleStyle]) => {
    const newStyle = { ...currentStyle, [property]: value } as SubtitleStyle;
    logger.info('Subtitle style property changed', {
      property,
      oldValue: currentStyle[property],
      newValue: value,
      selectedSubtitleId,
      timestamp: new Date().toISOString()
    });
    applyStyle(newStyle);
  }, [currentStyle, selectedSubtitleId, applyStyle, logger]);

  // Apply current style to all subtitles
  const handleApplyToAll = useCallback(() => {
    logger.info('Subtitle style applied to all subtitles', {
      styleApplied: currentStyle,
      subtitleCount: editedSubtitles.length,
      timestamp: new Date().toISOString()
    });

    setEditedSubtitles(prev =>
      prev.map(subtitle => ({ ...subtitle, subtitleStyle: currentStyle }))
    );
    setHasChanges(true);
  }, [currentStyle, editedSubtitles.length, logger]);

  const handleDialogKeyDown = (e: React.KeyboardEvent) => {
    // The discard confirmation is nested in this backdrop and owns its keys.
    if (isDiscardConfirmOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      requestClose();
      return;
    }
    trapTabKey(e, dialogRef.current);
  };

  // A drag that starts inside the card (selecting text) and ends on the
  // backdrop must not dismiss the dialog: both ends have to be the backdrop.
  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    backdropPressedRef.current = e.target === e.currentTarget;
    // A press on the bare backdrop would blur focus to <body>, outside
    // [aria-modal]: Delete / Space would then reach the timeline behind the
    // dialog and Escape / Tab would no longer reach this dialog.
    if (backdropPressedRef.current) e.preventDefault();
  };

  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    const pressedOnBackdrop = backdropPressedRef.current;
    backdropPressedRef.current = false;
    if (pressedOnBackdrop && e.target === e.currentTarget && !isDiscardConfirmOpen) {
      requestClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-modal p-4"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
      onKeyDown={handleDialogKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        className="bg-card rounded-md border border-border max-w-7xl w-full max-h-[90vh] flex flex-col overflow-hidden outline-none"
      >
        {/* Header */}
        <div className="bg-muted px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 id={TITLE_ID} className="text-xl font-semibold text-foreground">{labels.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{labels.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors"
              aria-label={labels.closeAriaLabel}
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main Content - Left-Right Layout */}
        <div className="flex-1 flex overflow-hidden">
          {editedSubtitles.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <svg className="w-16 h-16 text-muted-foreground mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                </svg>
                <h3 className="text-lg font-medium text-foreground mb-2">{labels.noSubtitles}</h3>
                <p className="text-muted-foreground">{labels.noSubtitlesHint}</p>
              </div>
            </div>
          ) : (
            <>
              <StylePanel
                labels={labels}
                currentStyle={currentStyle}
                isEditingSingle={selectedSubtitleId !== null}
                onPresetSelect={handlePresetSelect}
                onStyleChange={handleStyleChange}
                onApplyToAll={handleApplyToAll}
              />
              <SubtitleList
                labels={labels}
                subtitles={sortedSubtitles}
                selectedSubtitleId={selectedSubtitleId}
                onSelect={handleSubtitleSelect}
                onTextChange={handleSubtitleChange}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-muted px-6 py-4 border-t border-border flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {editedSubtitles.length > 0 && (
                <span>{labels.countSummary.replace('{count}', String(editedSubtitles.length))}</span>
              )}
              {isEditLocked && (
                <span id={EDIT_LOCK_HINT_ID} role="status" className="text-amber-600 dark:text-amber-400">
                  {t.timeline.messages.editLockedByAgent}
                </span>
              )}
            </div>
            <div className="flex items-center space-x-3">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={requestClose}
                className="px-4 py-2 text-sm font-medium text-secondary-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
              >
                {labels.cancel}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges || isEditLocked}
                aria-describedby={isEditLocked ? EDIT_LOCK_HINT_ID : undefined}
                className={`px-4 py-2 rounded-md font-medium transition-colors ${
                  hasChanges && !isEditLocked
                    ? 'bg-primary text-primary-foreground hover:bg-primary-a/90'
                    : 'bg-muted-foreground/30 text-muted-foreground cursor-not-allowed'
                }`}
              >
                {labels.save}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Nested in the backdrop so it stacks above the z-modal card. */}
      <ConfirmationDialog
        isOpen={isDiscardConfirmOpen}
        type="warning"
        title={labels.discardChangesTitle}
        message={labels.discardChangesBody}
        confirmText={labels.discardChangesConfirm}
        cancelText={t.common.cancel}
        onConfirm={handleDiscardConfirmed}
        onCancel={handleDiscardCancelled}
      />
    </div>
  );
};

export default SubtitleEditModal;
