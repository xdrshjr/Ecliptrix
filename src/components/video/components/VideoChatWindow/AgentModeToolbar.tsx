'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import YoloToggle from './YoloToggle';
import styles from './AgentComposer.module.css';

export interface AgentModeOptions {
  agentMode: boolean;
  onAgentModeChange: (enabled: boolean) => void;
  yolo: boolean;
  yoloReady: boolean;
  onYoloChange?: (enabled: boolean) => void;
  disabled: boolean;
  onCreativeBrainstormingClick?: () => void;
  onPolishClick?: () => void;
}

export default function AgentModeToolbar({ mode }: { mode: AgentModeOptions }) {
  const { t } = useLocale();
  return <div className={styles.toolbar} data-agent-mode-toolbar="">
    <div className={styles.tools}>
      {mode.onCreativeBrainstormingClick && <button type="button"
        className={styles.button} disabled={mode.disabled}
        title={t.videoChatWindow.creativeBrainstormingTooltip}
        aria-label={t.videoChatWindow.creativeBrainstormingTooltip}
        onClick={mode.onCreativeBrainstormingClick}>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"
          strokeWidth="1.6" aria-hidden="true">
          <path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3ZM12 1v2M3 5l2 2m14 0 2-2M1 12h2m18 0h2" />
        </svg>
      </button>}
      {mode.onPolishClick && <button type="button"
        className={styles.button} disabled={mode.disabled}
        title={t.videoChatWindow.polishContentTooltip}
        aria-label={t.videoChatWindow.polishContentTooltip}
        onClick={mode.onPolishClick}>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"
          strokeWidth="1.6" aria-hidden="true">
          <path d="m14 4 6 6M3 21l4-1L21 6a2 2 0 0 0-3-3L4 17l-1 4ZM12 21h9" />
        </svg>
      </button>}
    </div>
    <div className={styles.modes}>
      <span className="text-muted-foreground">{t.videoChatWindow.agentToggleLabel}</span>
      <button type="button" role="switch" aria-checked={mode.agentMode}
        aria-label={t.videoChatWindow.agentToggleLabel} disabled={mode.disabled}
        onClick={() => mode.onAgentModeChange(!mode.agentMode)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full
          transition-colors disabled:opacity-50 disabled:cursor-not-allowed
          ${mode.agentMode ? 'bg-primary' : 'bg-border'}`}>
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm
          ${mode.agentMode ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
      </button>
      <span className="w-px h-4 bg-border" aria-hidden="true" />
      <YoloToggle yolo={mode.yolo} yoloReady={mode.yoloReady}
        agentMode={mode.agentMode} agentIsExecuting={mode.disabled}
        onYoloChange={next => mode.onYoloChange?.(next)} />
    </div>
  </div>;
}
