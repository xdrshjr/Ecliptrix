'use client';

import React from 'react';
import type { ChatMessage } from '@/types';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import AgentToolCallCard from './AgentToolCallCard';
import { useLocale } from '@/contexts/LocaleContext';

interface AgentMessageBubbleProps {
  message: ChatMessage;
  onUndo?: (message: ChatMessage) => void;
}

/** @deprecated Use timeline/AgentResponseNode instead. */
const AgentMessageBubble: React.FC<AgentMessageBubbleProps> = ({ message, onUndo }) => {
  const { t } = useLocale();
  const toolCalls = message.agentToolCalls || [];
  const operationCount = message.pendingOperations?.length ?? 0;
  const canUndo = message.isAgentMessage && !message.isStreaming && operationCount > 0 && !message.isUndone;

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] w-full">
        <div className="bg-card border border-border rounded-md overflow-hidden">
          {/* Agent label */}
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border bg-muted/50">
            <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-semibold text-primary">{t.videoChatWindow.agentToggleLabel}</span>
            {message.isStreaming && (
              <svg className="w-3 h-3 text-primary animate-spin ml-1" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
          </div>

          {/* Text content */}
          {message.content && (
            <div className="px-4 py-3 text-sm leading-relaxed">
              <MarkdownRenderer content={message.content} isUser={false} />
              {message.isStreaming && (
                <span className="inline-block w-2 h-4 bg-current opacity-75 animate-pulse ml-1" />
              )}
            </div>
          )}

          {/* Tool calls */}
          {toolCalls.length > 0 && (
            <div className="px-4 pb-3 space-y-2">
              {toolCalls.map((tc) => (
                <AgentToolCallCard key={tc.id} toolCall={tc} />
              ))}
            </div>
          )}

          {/* Undo button */}
          {canUndo && (
            <div className="px-4 py-2 border-t border-border bg-muted/30">
              <button
                type="button"
                onClick={() => onUndo?.(message)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                {t.videoChatWindow.agentUndoButton} ({operationCount} {t.videoChatWindow.agentOperations})
              </button>
            </div>
          )}

          {/* Undone indicator */}
          {message.isUndone && (
            <div className="px-4 py-2 border-t border-border bg-muted/30">
              <span className="text-xs text-muted-foreground italic">{t.videoChatWindow.agentUndoneLabel}</span>
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className="mt-1.5 text-xs text-muted-foreground">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};

export default AgentMessageBubble;
