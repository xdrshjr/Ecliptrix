'use client';

import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import type { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import type { UseContextMemoryReturn } from '../../hooks/useContextMemory';
import type { useComposer } from './useComposer';
import type { ComposerCommand } from './composerCommands';
import ComposerSkillPicker from './ComposerSkillPicker';
import ComposerMentionPicker from './ComposerMentionPicker';
import { pickerOptionId } from './ComposerPicker';
import { ConnectedContextRing } from './ContextRing';
import AgentModeToolbar, { type AgentModeOptions } from './AgentModeToolbar';
import YoloNotice, { type YoloNoticeState } from './YoloNotice';
import styles from './AgentComposer.module.css';

export interface AgentComposerProps {
  composer: ReturnType<typeof useComposer>;
  mode: AgentModeOptions;
  actions: {
    isLoading: boolean; agentIsExecuting: boolean; isFinishing: boolean;
    hasMessages: boolean; onClear: () => void; onCancel: () => void;
    onFocusChange: (focused: boolean) => void;
    busyReason?: string | null; hasQueuedInput?: boolean;
  };
  upload: {
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    enabled: boolean; uploading: boolean; accept: string; error: string | null;
    onSelect: (file: File | undefined) => void | Promise<void>;
  };
  context?: { memory: UseContextMemoryReturn; onCompact: () => void };
  materials?: MaterialItem[];
  commands?: readonly ComposerCommand[];
  isVisible?: boolean;
  notice?: YoloNoticeState;
}

function useNoticeHeight(
  anchor: React.RefObject<HTMLDivElement | null>, isVisible: boolean,
  text: string,
) {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = anchor.current;
    if (!element || !isVisible) { setHeight(0); return; }
    const panel = element.closest('[role="dialog"]');
    const body = element.closest('[role="tabpanel"]')
      ?? element.closest('.agent-chat-window');
    if (!body) return;
    const measure = () => {
      const top = element.getBoundingClientRect();
      const bounds = body.getBoundingClientRect();
      const moving = panel?.getAttribute('data-phase') === 'opening'
        || panel?.getAttribute('data-phase') === 'closing';
      setHeight(!moving && top.width > 0 && bounds.height > 0
        ? Math.max(0, top.top - 6 - bounds.top - 8) : 0);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined'
      ? null : new ResizeObserver(measure);
    observer?.observe(element);
    observer?.observe(body);
    if (panel) observer?.observe(panel);
    const attributes = new MutationObserver(measure);
    if (panel) attributes.observe(panel, { attributes: true,
      attributeFilter: ['data-phase', 'data-compact'] });
    return () => { observer?.disconnect(); attributes.disconnect(); };
  }, [anchor, isVisible, text]);
  return height;
}

function Icon({ kind }: { kind: 'attach' | 'clear' | 'send' | 'stop' }) {
  const paths = {
    attach: 'm8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9',
    clear: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5',
    send: 'M12 20V4m-6 6 6-6 6 6',
    stop: 'M7 7h10v10H7z',
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    fill={kind === 'stop' ? 'currentColor' : 'none'}><path d={paths[kind]} /></svg>;
}

function ComposerActions({ composer, actions, upload, context, mode }:
  AgentComposerProps) {
  const { t } = useLocale();
  const busy = actions.isLoading || composer.isSubmitting || upload.uploading
    || !!actions.busyReason;
  const secondaryDisabled = busy || actions.agentIsExecuting;
  const label = actions.isFinishing ? t.agentApply.finishing
    : t.videoChatWindow.stopAgentTooltip;
  return <div className={styles.actions} data-agent-composer-actions="">
    <div className={styles.actionGroup}>
      <input ref={upload.fileInputRef} type="file" className="hidden"
        accept={upload.accept}
        onChange={event => { void upload.onSelect(event.target.files?.[0]); }} />
      <button type="button" className={styles.button}
        onClick={() => upload.fileInputRef.current?.click()}
        disabled={!upload.enabled || secondaryDisabled}
        aria-label={t.agentToolkit.attachDocument}
        title={upload.enabled ? t.agentToolkit.attachDocument
          : t.agentToolkit.attachDisabled}>
        <Icon kind="attach" />
      </button>
      <span className="sr-only" aria-live="polite">
        {upload.uploading ? t.agentToolkit.attaching : ''}
      </span>
      <button type="button" className={styles.button} onClick={actions.onClear}
        disabled={!actions.hasMessages || secondaryDisabled}
        title={t.videoChatWindow.clearChatTooltip}
        aria-label={t.videoChatWindow.clearChatTooltip}><Icon kind="clear" /></button>
    </div>
    <div className={styles.actionGroup}>
      {context && mode.agentMode && <ConnectedContextRing
        memory={context.memory} onCompact={context.onCompact} />}
      {actions.agentIsExecuting && composer.running && <button type="submit"
        className={`${styles.button} ${styles.primary}`}
        disabled={!composer.text.trim() || composer.isSubmitting}
        title={t.agentCollab.steerButton} aria-label={t.agentCollab.steerButton}
        data-testid="agent-steer-button"><Icon kind="send" /></button>}
      {actions.agentIsExecuting ? <button type="button"
        className={`${styles.button} ${styles.stop}`} onClick={event => {
          // 停止可同步切回发送按钮，阻止本次 click 的默认动作提交草稿。
          event.preventDefault(); actions.onCancel();
        }}
        disabled={actions.isFinishing} title={label} aria-label={label}
        data-testid="agent-stop-button"><Icon kind="stop" /></button>
        : <button type="submit" className={`${styles.button} ${styles.primary}`}
          disabled={!composer.text.trim() || busy}
          title={t.videoChatWindow.sendMessageTooltip}
          aria-label={t.videoChatWindow.sendMessageTooltip}><Icon kind="send" /></button>}
    </div>
  </div>;
}

/** 行为由 useComposer 拥有；这里仅组织工具栏、输入、操作与非占位说明。 */
export default function AgentComposer(props: AgentComposerProps) {
  const { composer, mode, actions, upload, context, materials = [],
    commands, isVisible = true, notice } = props;
  const { t } = useLocale();
  const root = useRef<HTMLDivElement>(null);
  const listPrefix = useId();
  const skillList = `agent-skill-${listPrefix}`;
  const mentionList = `agent-mention-${listPrefix}`;
  const pickerId = composer.pickerKind === 'skill' ? skillList : mentionList;
  const height = useNoticeHeight(root, isVisible, composer.text);
  useLayoutEffect(() => {
    const textarea = composer.textareaRef.current;
    if (!textarea || !isVisible) return;
    const resize = () => {
      const max = textarea.closest('[data-compact="true"]') ? 80 : 120;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(40, Math.min(textarea.scrollHeight, max))}px`;
      textarea.style.overflowY = textarea.scrollHeight > max ? 'auto' : 'hidden';
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined'
      ? null : new ResizeObserver(resize);
    observer?.observe(textarea);
    const panel = textarea.closest('[role="dialog"]');
    const attributes = new MutationObserver(resize);
    if (panel) attributes.observe(panel, { attributes: true,
      attributeFilter: ['data-compact'] });
    return () => { observer?.disconnect(); attributes.disconnect(); };
  }, [composer.text, composer.textareaRef, isVisible]);
  const placeholder = actions.agentIsExecuting
    ? (composer.running ? t.agentCollab.steerPlaceholder
      : t.videoChatWindow.agentWorkingPlaceholder)
    : mode.agentMode ? t.videoChatWindow.agentInputPlaceholder
      : t.videoChatWindow.inputPlaceholder;
  const suppressed = actions.agentIsExecuting || actions.isLoading
    || upload.uploading || composer.pickerOpen || !!actions.hasQueuedInput
    || !!actions.busyReason;
  const error = upload.error ?? (composer.sendRejected
    ? t.agentConversations.sendRejected : null);
  return <div className={styles.outer}>
    <div ref={root} className={styles.composer} data-agent-composer="">
      <YoloNotice yolo={mode.yolo} enabled={mode.agentMode && mode.yoloReady}
        isVisible={isVisible} suppressed={suppressed} availableHeight={height}
        notice={notice} onRestoreFocus={() => {
          if (!isVisible) return;
          const toggle = root.current
            ?.querySelector<HTMLButtonElement>('[data-yolo-toggle]:not(:disabled)');
          (toggle ?? composer.textareaRef.current)?.focus({ preventScroll: true });
        }} />
      <AgentModeToolbar mode={mode} />
      <form className={styles.card} onSubmit={event => {
        event.preventDefault(); composer.submit();
      }}>
        {composer.skill && <div className={styles.skill}>
          <span className={styles.chip}>
            {t.agentCollab.skillChip.replace('{name}', composer.skill.name)}
            <button type="button" onClick={composer.clearSkill}
              aria-label={t.agentCollab.skillChipRemove}
              title={t.agentCollab.skillChipRemove}><span aria-hidden="true">×</span></button>
          </span>
        </div>}
        {composer.pickerOpen && composer.pickerKind === 'skill' &&
          <ComposerSkillPicker id={skillList} query={composer.pickerQuery}
            skills={composer.skills} status={composer.skillStatus}
            activeIndex={composer.activeIndex} onSelect={composer.selectSkill}
            onHover={composer.setActiveIndex} commands={commands}
            onSelectCommand={composer.selectCommand} />}
        {composer.pickerOpen && composer.pickerKind === 'mention' &&
          <ComposerMentionPicker id={mentionList} query={composer.pickerQuery}
            materials={materials} activeIndex={composer.activeIndex}
            onSelect={composer.selectMaterial} onHover={composer.setActiveIndex} />}
        <textarea ref={composer.textareaRef} data-agent-input=""
          className={styles.textArea} value={composer.text} rows={1}
          onChange={composer.handleChange} onKeyDown={composer.handleKeyDown}
          onKeyUp={event => composer.syncCaret(event.currentTarget)}
          onClick={event => composer.syncCaret(event.currentTarget)}
          onFocus={() => actions.onFocusChange(true)}
          onBlur={() => actions.onFocusChange(false)}
          aria-haspopup="listbox" aria-autocomplete="list"
          aria-controls={composer.pickerOpen ? pickerId : undefined}
          aria-activedescendant={composer.pickerOpen
            ? pickerOptionId(pickerId, composer.activeIndex) : undefined}
          placeholder={placeholder} aria-label={t.videoChatWindow.inputAriaLabel}
          disabled={composer.disabled} />
        <ComposerActions {...props} context={context} />
      </form>
      {composer.escArmed && <p role="status" className={styles.hint}>
        {t.agentCollab.escToStop}
      </p>}
      {composer.invalidReferences && <p role="status" className={styles.hint}>
        {t.agentConversations.invalidReferences}
      </p>}
      {actions.busyReason && !actions.agentIsExecuting &&
        <p role="status" className={styles.hint}>{actions.busyReason}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  </div>;
}
