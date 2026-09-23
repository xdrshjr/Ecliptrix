'use client';

import React from 'react';
import type { ScriptSegment, ScriptSentence } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

export interface SentenceTiming {
  sentenceId: string;
  order: number;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface SentenceEditState {
  editingSentenceId: string | null;
  editingText: string;
  onChangeText(text: string): void;
  onKeyDown(event: React.KeyboardEvent): void;
  onStartEdit(sentence: ScriptSentence): void;
  onSave(): void;
  onCancel(): void;
}

export interface SentenceActions {
  onDeleteSentence(segmentId: string, sentenceId: string): void;
  onAddSentence(segmentId: string): void;
  /** Present only when the parent wired sentence-level AI video. */
  onOpenSentenceAi?(segment: ScriptSegment, sentence: ScriptSentence, timing: SentenceTiming): void;
  onRegenerateVideoScript?(segmentId: string, sentenceId: string): void;
  formatTime(seconds: number): string;
}

interface SegmentSentenceListProps {
  segment: ScriptSegment;
  /** 「画面描述 (n)」折叠是否展开（ScriptPanel 的 expandedScriptSegments）。 */
  isOpen: boolean;
  onToggle(): void;
  timings: SentenceTiming[] | null;
  edit: SentenceEditState;
  actions: SentenceActions;
}

type Translations = ReturnType<typeof useLocale>['t'];

function aiVideoButtonLabel(t: Translations, status: string): string {
  const copy = t.scriptPanel.aiVideoScript;
  if (status === 'generating') return copy.sentenceAiVideoGenerating;
  if (status === 'succeeded') return copy.sentenceAiVideoSucceeded;
  if (status === 'failed') return copy.sentenceAiVideoFailed;
  return copy.sentenceAiVideoButton;
}

function aiVideoButtonClass(status: string): string {
  if (status === 'generating') return 'bg-purple-500/30 text-white/70 cursor-not-allowed';
  if (status === 'succeeded') {
    return 'border border-purple-500 text-purple-600 hover:bg-purple-500/10 dark:text-purple-300';
  }
  if (status === 'failed') return 'border border-red-500 text-red-500 hover:bg-red-500/10';
  return 'bg-purple-500 text-white hover:bg-purple-600 dark:bg-purple-600 dark:hover:bg-purple-700';
}

const Spinner: React.FC = () => (
  <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

/**
 * 「AI 视频脚本」正文按 videoScriptStatus 优先级渲染（spec §7）：
 * generating → 生成中…；videoScript 非空 → 画面脚本；failed → 失败 + 重新生成；
 * 其余（常规链路句）→ 渲染 sentence.text。永不把旁白当脚本静默展示。
 */
const SentenceBody: React.FC<{
  segmentId: string;
  sentence: ScriptSentence;
  edit: SentenceEditState;
  actions: SentenceActions;
}> = ({ segmentId, sentence, edit, actions }) => {
  const { t } = useLocale();
  const videoScriptText = (sentence.videoScript ?? '').trim();
  if (sentence.videoScriptStatus === 'generating') {
    return (
      <p className="text-sm text-muted-foreground leading-relaxed flex items-center gap-2">
        <Spinner />
        <span>{t.scriptPanel.aiVideoScript.videoScriptGenerating}</span>
      </p>
    );
  }
  if (!videoScriptText && sentence.videoScriptStatus === 'failed') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-red-500">{t.scriptPanel.aiVideoScript.videoScriptFailed}</span>
        {actions.onRegenerateVideoScript && (
          <button
            type="button"
            onClick={() => actions.onRegenerateVideoScript?.(segmentId, sentence.id)}
            className="text-xs font-medium px-2 py-0.5 rounded border border-red-500 text-red-500 hover:bg-red-500/10 transition-colors"
          >
            {t.scriptPanel.aiVideoScript.videoScriptRetry}
          </button>
        )}
      </div>
    );
  }
  return (
    <p
      className="text-sm text-foreground leading-relaxed cursor-pointer"
      onClick={() => edit.onStartEdit(sentence)}
    >
      {videoScriptText || sentence.text}
    </p>
  );
};

const SentenceTimingLine: React.FC<{
  sentence: ScriptSentence;
  timing: SentenceTiming | undefined;
  formatTime(seconds: number): string;
}> = ({ sentence, timing, formatTime }) => {
  const { t } = useLocale();
  if (timing) {
    return (
      <div className="flex items-center space-x-2 mt-1">
        <span className="text-xs text-[color:var(--ws-primary-text)] font-mono bg-primary-a/10 px-1 py-0.5 rounded">
          {formatTime(timing.startTime)}-{formatTime(timing.endTime)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t.scriptPanel.video.duration}: {timing.duration.toFixed(1)}s
        </span>
      </div>
    );
  }
  if (sentence.startTime === undefined || sentence.endTime === undefined) return null;
  return (
    <div className="mt-1">
      <span className="text-xs text-muted-foreground font-mono bg-muted px-1 py-0.5 rounded">
        {sentence.startTime}s-{sentence.endTime}s
      </span>
    </div>
  );
};

const SentenceEditor: React.FC<{ edit: SentenceEditState }> = ({ edit }) => {
  const { t } = useLocale();
  return (
    <div className="flex-1">
      <textarea
        value={edit.editingText}
        onChange={(e) => edit.onChangeText(e.target.value)}
        onKeyDown={edit.onKeyDown}
        className="ws-input resize-none py-2"
        style={{ height: 'auto' }}
        rows={2}
        autoFocus
      />
      <div className="flex items-center gap-2 mt-2">
        <button type="button" onClick={edit.onSave} className="ws-btn ws-btn--primary ws-btn--sm">
          {t.scriptPanel.editing.save}
        </button>
        <button type="button" onClick={edit.onCancel} className="ws-btn ws-btn--sm">
          {t.scriptPanel.editing.cancel}
        </button>
        <span className="text-xs text-muted-foreground">{t.scriptPanel.editing.saveHint}</span>
      </div>
    </div>
  );
};

const EditIcon: React.FC = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const SentenceRowActions: React.FC<{
  segment: ScriptSegment;
  sentence: ScriptSentence;
  timing: SentenceTiming | undefined;
  edit: SentenceEditState;
  actions: SentenceActions;
}> = ({ segment, sentence, timing, edit, actions }) => {
  const { t } = useLocale();
  const status = sentence.aiVideoStatus ?? 'idle';
  const label = aiVideoButtonLabel(t, status);
  const openSentenceAi = () => {
    if (!timing || status === 'generating') return;
    actions.onOpenSentenceAi?.(segment, sentence, timing);
  };
  return (
    <div className="flex items-center space-x-1 ml-2 shrink-0">
      <button
        type="button"
        onClick={() => edit.onStartEdit(sentence)}
        className="ws-icon-btn"
        title={t.scriptPanel.actions.editSentence}
        aria-label={t.scriptPanel.actions.editSentence}
      >
        <EditIcon />
      </button>
      <button
        type="button"
        onClick={() => actions.onDeleteSentence(segment.id, sentence.id)}
        className="ws-icon-btn"
        style={{ color: 'var(--ws-danger)' }}
        title={t.scriptPanel.actions.deleteSentence}
        aria-label={t.scriptPanel.actions.deleteSentence}
        disabled={segment.sentences.length <= 1}
      >
        <TrashIcon />
      </button>
      {timing && actions.onOpenSentenceAi && (
        <button
          type="button"
          onClick={openSentenceAi}
          disabled={status === 'generating'}
          className={`text-xs font-medium px-2 py-0.5 rounded transition-colors ml-1 ${aiVideoButtonClass(status)}`}
          title={label}
        >
          {label}
        </button>
      )}
    </div>
  );
};

const SentenceRow: React.FC<{
  segment: ScriptSegment;
  sentence: ScriptSentence;
  sentenceIndex: number;
  timing: SentenceTiming | undefined;
  edit: SentenceEditState;
  actions: SentenceActions;
}> = ({ segment, sentence, sentenceIndex, timing, edit, actions }) => {
  const isEditing = edit.editingSentenceId === sentence.id;
  return (
    <div className="script-sentence p-2 rounded" style={{ background: 'var(--ws-panel)' }}>
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-2 flex-1 min-w-0">
          <span className="text-xs text-muted-foreground mt-1 font-mono">
            {String(sentenceIndex + 1).padStart(2, '0')}
          </span>
          {isEditing ? (
            <SentenceEditor edit={edit} />
          ) : (
            <div className="flex-1 min-w-0">
              <SentenceBody segmentId={segment.id} sentence={sentence} edit={edit} actions={actions} />
              <SentenceTimingLine sentence={sentence} timing={timing} formatTime={actions.formatTime} />
            </div>
          )}
        </div>
        {!isEditing && (
          <SentenceRowActions
            segment={segment}
            sentence={sentence}
            timing={timing}
            edit={edit}
            actions={actions}
          />
        )}
      </div>
    </div>
  );
};

/**
 * 「画面描述 (n)」折叠区 + 句子行 + 「+ 添加句子」（从 ScriptPanel 原样移出）。
 * 原折叠标题复用了 tab 名「AI视频脚本」，与左栏 tab 重名，按 spec §2.3 改名。
 */
const SegmentSentenceList: React.FC<SegmentSentenceListProps> = ({
  segment,
  isOpen,
  onToggle,
  timings,
  edit,
  actions,
}) => {
  const { t } = useLocale();
  return (
    <>
      <div className="mb-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="ws-btn ws-btn--ghost ws-btn--sm"
        >
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span>
            {t.workbench.segmentCard.visualDescriptions.replace('{count}', String(segment.sentences.length))}
          </span>
        </button>
      </div>
      {isOpen && (
        <div className="space-y-2">
          {segment.sentences.map((sentence, sentenceIndex) => (
            <SentenceRow
              key={sentence.id}
              segment={segment}
              sentence={sentence}
              sentenceIndex={sentenceIndex}
              timing={timings?.find((timing) => timing.sentenceId === sentence.id)}
              edit={edit}
              actions={actions}
            />
          ))}
          <div className="mt-3 pt-2">
            <button
              type="button"
              onClick={() => actions.onAddSentence(segment.id)}
              className="ws-btn w-full"
              title={t.scriptPanel.actions.addSentence}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span>{t.scriptPanel.actions.addSentence}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default SegmentSentenceList;
