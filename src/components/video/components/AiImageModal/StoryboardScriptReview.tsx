'use client';

import React from 'react';
import { ScriptShot, ScriptMessage } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

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
  const { t } = useLocale();

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      {/* Header badge */}
      <div className="flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full bg-secondary text-foreground border border-border font-medium">
            {t.storyboardTab.scriptPreviewLabel.replace('{count}', String(frameCount))}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-secondary text-foreground border border-border">
            {t.storyboardTab.languageLabel.replace('{lang}', locale === 'zh' ? '中文' : 'English')}
          </span>
        </div>
        <button
          onClick={onBack}
          disabled={isBusy}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {t.storyboardTab.backToInput}
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
              {t.storyboardTab.shotNumber.replace('{number}', String(shot.index + 1))}
            </div>
            <textarea
              value={shot.script}
              onChange={(e) => onEditShot(shot.index, e.target.value)}
              disabled={isBusy}
              rows={Math.max(2, Math.ceil(shot.script.length / 60))}
              className="w-full text-sm text-foreground bg-background border border-border rounded-md p-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              placeholder={t.storyboardTab.shotPlaceholder.replace('{number}', String(shot.index + 1))}
            />
          </div>
        ))}
        {shots.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6">
            {t.storyboardTab.emptyScript}
          </div>
        )}
      </div>

      {/* Chat panel — max-h-[28%] keeps it from squeezing the confirm button on many messages */}
      <div className="shrink-0 max-h-[28%] overflow-hidden border border-border rounded-md p-3 bg-card/60 flex flex-col gap-2">
        <div className="text-xs font-medium text-foreground shrink-0">{t.storyboardTab.chatTitle}</div>
        {messages.length > 0 && (
          <div className="space-y-1 overflow-y-auto text-xs min-h-0 flex-1">
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
                  {m.role === 'user' ? t.storyboardTab.chatYou : t.storyboardTab.chatAI}
                </span>
                {m.content}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 shrink-0">
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
            placeholder={t.storyboardTab.chatPlaceholder}
            className="flex-1 text-sm bg-background border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={onSendChat}
            disabled={isBusy || !chatInput.trim()}
            className="px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBusy ? '...' : t.storyboardTab.chatSend}
          </button>
        </div>
      </div>

      {error && <p className="shrink-0 text-xs text-destructive">{error}</p>}

      <button
        onClick={onConfirm}
        disabled={!canConfirm || isBusy}
        title={!canConfirm ? t.storyboardTab.scriptMinLengthHint : undefined}
        className="shrink-0 w-full py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t.storyboardTab.confirmGenerate}
      </button>
    </div>
  );
};

export default StoryboardScriptReview;
