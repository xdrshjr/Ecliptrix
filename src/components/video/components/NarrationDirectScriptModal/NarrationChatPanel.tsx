'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { NarrationChatMessage } from '../../types/videoEditingTypes';

interface NarrationChatPanelProps {
  messages: NarrationChatMessage[];
  isStreaming: boolean;
  onSend: (content: string) => void;
  onAbort: () => void;
  /** 拆分进行中等外部禁用态。 */
  disabled?: boolean;
}

/**
 * 第 1 步右侧 AI 对话面板：消息列表 + 输入框 + 发送/中止。
 *
 * 用户在此提需求让 AI 改写左侧文案；流式态展示 thinking，结束后展示
 * 「已更新左侧文案」摘要（摘要文本由 useNarrationChat 写入 summaryText）。
 */
const NarrationChatPanel: React.FC<NarrationChatPanelProps> = ({
  messages,
  isStreaming,
  onSend,
  onAbort,
  disabled = false,
}) => {
  const { t } = useLocale();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新消息到达时自动滚到底部。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(() => {
    const value = input.trim();
    if (!value || isStreaming || disabled) return;
    setInput('');
    onSend(value);
  }, [input, isStreaming, disabled, onSend]);

  const visibleMessages = messages.filter((m) => m.role !== 'system');

  return (
    <div className="flex h-full flex-col min-h-0 rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h4 className="text-sm font-medium text-foreground">{t.narrationDirectScript.chatPanelTitle}</h4>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3 min-h-0">
        {visibleMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="text-xs text-muted-foreground">{t.narrationDirectScript.chatEmptyHint}</p>
          </div>
        ) : (
          visibleMessages.map((m) => {
            if (m.role === 'user') {
              return (
                <div key={m.id} className="ml-6 rounded-md bg-primary/10 p-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    {t.narrationDirectScript.roleUser}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-xs text-foreground">{m.content}</div>
                </div>
              );
            }
            const streaming = !!m.isStreaming;
            const reasoning = m.reasoningContent || '';
            const body = m.summaryText
              ? m.summaryText
              : streaming
                ? t.narrationDirectScript.assistantThinking
                : m.content || '';
            return (
              <div key={m.id} className="mr-6 rounded-md bg-muted p-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {t.narrationDirectScript.roleAssistant}
                  {streaming ? ' · …' : ''}
                </div>
                {(reasoning || streaming) && (
                  <details className="mb-2 rounded border border-border/60 bg-background/50">
                    <summary className="cursor-pointer select-none px-2 py-1 text-[11px] text-muted-foreground">
                      {streaming && !reasoning
                        ? t.narrationDirectScript.assistantThinking
                        : t.narrationDirectScript.reasoningLabel}
                    </summary>
                    <div className="max-h-40 overflow-auto whitespace-pre-wrap break-words px-2 py-1 text-[11px] text-muted-foreground">
                      {reasoning || (streaming ? t.narrationDirectScript.assistantThinking : '')}
                    </div>
                  </details>
                )}
                {body && <div className="whitespace-pre-wrap break-words text-xs text-foreground">{body}</div>}
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-2 border-t border-border p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={t.narrationDirectScript.chatPlaceholder}
          rows={2}
          disabled={disabled}
          className="flex-1 resize-none rounded border border-border bg-background p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onAbort}
            className="self-stretch rounded bg-destructive px-3 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            {t.narrationDirectScript.cancel}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || disabled}
            className="self-stretch rounded bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {t.narrationDirectScript.send}
          </button>
        )}
      </div>
    </div>
  );
};

export default NarrationChatPanel;
