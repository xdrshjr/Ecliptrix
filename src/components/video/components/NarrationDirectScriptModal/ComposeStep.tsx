'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { NarrationChatMessage } from '../../types/videoEditingTypes';
import NarrationChatPanel from './NarrationChatPanel';

interface ComposeStepProps {
  draftText: string;
  setDraftText: (text: string) => void;
  /** 改写流式进行中：左侧 textarea 只读，规避整段回写覆盖用户手改（spec 决议 R4）。 */
  isStreaming: boolean;
  chatMessages: NarrationChatMessage[];
  onSend: (content: string) => void;
  onAbort: () => void;
}

/**
 * 解说直接生成 — 第 1 步（撰写）。
 *
 * 左侧文案编辑 textarea（双向绑定 draftText，流式中只读）+ 右侧 AI 对话面板。
 */
const ComposeStep: React.FC<ComposeStepProps> = ({
  draftText,
  setDraftText,
  isStreaming,
  chatMessages,
  onSend,
  onAbort,
}) => {
  const { t } = useLocale();

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-2">
      {/* 左：文案编辑 */}
      <div className="flex min-h-0 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="narration-draft" className="text-sm font-medium text-foreground">
            {t.narrationDirectScript.draftLabel}
          </label>
          {isStreaming && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {t.narrationDirectScript.streamingHint}
            </span>
          )}
        </div>
        <textarea
          id="narration-draft"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          readOnly={isStreaming}
          placeholder={t.narrationDirectScript.draftPlaceholder}
          className="flex-1 resize-none rounded-md border border-border bg-background p-3 text-sm leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-primary read-only:opacity-70"
        />
      </div>

      {/* 右：AI 对话 */}
      <div className="flex min-h-0 flex-col">
        <NarrationChatPanel
          messages={chatMessages}
          isStreaming={isStreaming}
          onSend={onSend}
          onAbort={onAbort}
        />
      </div>
    </div>
  );
};

export default ComposeStep;
