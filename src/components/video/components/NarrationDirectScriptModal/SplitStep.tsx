'use client';

import React, { useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { NarrationSplitSentence } from '../../types/videoEditingTypes';

interface SplitStepProps {
  splitSentences: NarrationSplitSentence[];
  onUpdate: (next: NarrationSplitSentence[]) => void;
  isSplitting: boolean;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `split-${crypto.randomUUID()}`;
  }
  return `split-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 解说直接生成 — 第 2 步（逐句拆分与精修）。
 *
 * 左侧渲染拆分后的可编辑句子列表，本期仅「编辑 / 新增 / 删除」三种操作
 * （spec 决议 R10：句子排序不在本期）。
 */
const SplitStep: React.FC<SplitStepProps> = ({ splitSentences, onUpdate, isSplitting }) => {
  const { t } = useLocale();

  const handleEdit = useCallback(
    (id: string, text: string) => {
      onUpdate(splitSentences.map((s) => (s.id === id ? { ...s, text } : s)));
    },
    [splitSentences, onUpdate],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onUpdate(splitSentences.filter((s) => s.id !== id));
    },
    [splitSentences, onUpdate],
  );

  const handleAdd = useCallback(() => {
    onUpdate([...splitSentences, { id: genId(), text: '' }]);
  }, [splitSentences, onUpdate]);

  if (isSplitting) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <svg className="h-6 w-6 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm">{t.narrationDirectScript.splitting}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{t.narrationDirectScript.splitSentencesLabel}</h4>
        <span className="text-xs text-muted-foreground">
          {t.narrationDirectScript.sentenceCount.replace('{count}', String(splitSentences.length))}
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1 min-h-0">
        {splitSentences.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="text-xs text-muted-foreground">{t.narrationDirectScript.emptySplitHint}</p>
          </div>
        ) : (
          splitSentences.map((sentence, index) => (
            <div
              key={sentence.id}
              className="flex items-start gap-2 rounded-md border border-border bg-card p-2"
            >
              <span className="mt-2 w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                {String(index + 1).padStart(2, '0')}
              </span>
              <textarea
                value={sentence.text}
                onChange={(e) => handleEdit(sentence.id, e.target.value)}
                rows={2}
                placeholder={t.narrationDirectScript.sentencePlaceholder}
                className="flex-1 resize-none rounded border border-border bg-background p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => handleDelete(sentence.id)}
                title={t.narrationDirectScript.deleteSentence}
                className="mt-1 rounded p-1 text-destructive transition-colors hover:bg-destructive/10"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={handleAdd}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-muted py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        <span>{t.narrationDirectScript.addSentence}</span>
      </button>
    </div>
  );
};

export default SplitStep;
