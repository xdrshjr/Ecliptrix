'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';

export interface NarrationEditState {
  /** Segment whose narration is being edited, or null. */
  editingSegmentId: string | null;
  editingText: string;
  onChangeText(text: string): void;
  onKeyDown(event: React.KeyboardEvent): void;
  onStartEdit(segmentId: string, narrationText: string): void;
  onSave(): void;
  onCancel(): void;
}

interface SegmentNarrationEditorProps {
  segmentId: string;
  narrationText: string;
  edit: NarrationEditState;
}

/**
 * 解说文案就地编辑区（从 ScriptPanel 原样移出，状态仍归 ScriptPanel 所有）。
 * `data-narration-editor` 是卡头 Enter 展开后移交焦点的锚点（spec §3.5.2）。
 */
const SegmentNarrationEditor: React.FC<SegmentNarrationEditorProps> = ({
  segmentId,
  narrationText,
  edit,
}) => {
  const { t } = useLocale();
  const isEditing = edit.editingSegmentId === segmentId;
  return (
    <div
      data-narration-editor
      className="mb-3 p-2.5 rounded-md"
      style={{ background: 'var(--ws-panel)' }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-[color:var(--ws-primary-text)]">
          {t.scriptPanel.narration.label}
        </span>
        {!isEditing && (
          <button
            type="button"
            onClick={() => edit.onStartEdit(segmentId, narrationText)}
            className="ws-icon-btn"
            title={t.scriptPanel.narration.editTooltip}
            aria-label={t.scriptPanel.narration.editTooltip}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
      </div>
      {isEditing ? (
        <div>
          <textarea
            value={edit.editingText}
            onChange={(e) => edit.onChangeText(e.target.value)}
            onKeyDown={edit.onKeyDown}
            className="ws-input resize-none py-2"
            style={{ height: 'auto', fontSize: 14, lineHeight: 1.6 }}
            rows={3}
            autoFocus
          />
          <div className="flex items-center gap-2 mt-2">
            <button type="button" onClick={edit.onSave} className="ws-btn ws-btn--primary ws-btn--sm">
              {t.scriptPanel.editing.save}
            </button>
            <button type="button" onClick={edit.onCancel} className="ws-btn ws-btn--sm">
              {t.scriptPanel.editing.cancel}
            </button>
            <span className="text-xs" style={{ color: 'var(--ws-text-tertiary)' }}>
              {t.scriptPanel.editing.saveHint}
            </span>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ws-text)' }}>
          {narrationText}
        </p>
      )}
    </div>
  );
};

export default SegmentNarrationEditor;
