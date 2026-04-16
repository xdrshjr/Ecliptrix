'use client';

import React from 'react';
import { ScriptShot, ScriptMessage } from '@/types';

interface StoryboardScriptReviewProps {
  frameCount: number;
  locale: 'zh' | 'en';
  shots: ScriptShot[];
  messages: ScriptMessage[];
  chatInput: string;
  onChatInputChange: (v: string) => void;
  onSendChat: () => void;
  onEditShot: (index: number, text: string) => void;
  onBack: () => void;
  onConfirm: () => void;
  isBusy: boolean;
  canConfirm: boolean;
  error?: string;
}

const StoryboardScriptReview: React.FC<StoryboardScriptReviewProps> = ({
  frameCount,
  locale,
  shots,
  messages,
  chatInput,
  onChatInputChange,
  onSendChat,
  onEditShot,
  onBack,
  onConfirm,
  isBusy,
  canConfirm,
  error,
}) => {
  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      {/* Header badge */}
      <div className="flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full bg-secondary text-foreground border border-border font-medium">
            剧本预览（共 {frameCount} 幕）
          </span>
          <span className="px-2 py-0.5 rounded-full bg-secondary text-foreground border border-border">
            {locale === 'zh' ? '中文' : 'English'}
          </span>
        </div>
        <button
          onClick={onBack}
          disabled={isBusy}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          ← 返回修改输入
        </button>
      </div>

      {/* Shot cards — flex-1 so they absorb remaining space; only this area scrolls */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
        {shots.map((shot) => (
          <div
            key={shot.index}
            className="border border-border rounded-md p-3 bg-card"
          >
            <div className="text-xs font-medium text-muted-foreground mb-1">
              第 {shot.index + 1} 幕
            </div>
            <textarea
              value={shot.script}
              onChange={(e) => onEditShot(shot.index, e.target.value)}
              disabled={isBusy}
              rows={Math.max(2, Math.ceil(shot.script.length / 60))}
              className="w-full text-sm text-foreground bg-background border border-border rounded-md p-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              placeholder={`第 ${shot.index + 1} 幕剧本...`}
            />
          </div>
        ))}
        {shots.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6">
            剧本为空，请返回上一步重新生成
          </div>
        )}
      </div>

      {/* Chat panel — max-h-[30%] keeps it from squeezing the confirm button on many messages */}
      <div className="shrink-0 max-h-[30%] overflow-y-auto border border-border rounded-md p-3 space-y-2 bg-card/60">
        <div className="text-xs font-medium text-foreground">与 AI 对话修改剧本</div>
        {messages.length > 0 && (
          <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'user'
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }
              >
                <span className="font-medium mr-1">
                  {m.role === 'user' ? '你：' : 'AI：'}
                </span>
                {m.content}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => onChatInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSendChat();
              }
            }}
            disabled={isBusy}
            placeholder="例如：把第 3 幕改为夜晚雨天"
            className="flex-1 text-sm bg-background border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={onSendChat}
            disabled={isBusy || !chatInput.trim()}
            className="px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBusy ? '...' : '发送'}
          </button>
        </div>
      </div>

      {error && <p className="shrink-0 text-xs text-destructive">{error}</p>}

      <button
        onClick={onConfirm}
        disabled={!canConfirm || isBusy}
        title={!canConfirm ? '请确保所有剧本不少于 5 个字符' : undefined}
        className="shrink-0 w-full py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        确认并生成分镜
      </button>
    </div>
  );
};

export default StoryboardScriptReview;
