import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, MaterialItem } from '@/types';
import type { SkillSummary } from '@/types/agentSkills';
import type { MaterialMention } from '@/types/agentSteering';
import { listSkills } from '@/lib/api/agentSkills';
import type { DraftRestore } from '@/components/video/hooks/useAgentExecutionSteering';
import type { SendAgentMessageOptions } from '@/components/video/hooks/useAgentExecution';
import type { UseAgentSteeringReturn } from '@/components/video/hooks/useAgentSteering';
import {
  MAX_MENTIONS, activeMentions, detectMentionTrigger, detectSkillTrigger, insertMention,
  removeTrigger, type TriggerMatch,
} from './composerTriggers';
import { visibleSkills, type SkillListStatus } from './ComposerSkillPicker';
import { visibleCommands, type ComposerCommand } from './composerCommands';
import { visibleMaterials } from './ComposerMentionPicker';
import {
  collectInputHistory, createHistoryNavigator, draftStorageKey, useComposerDraft,
} from './useComposerStorage';

/**
 * 输入区的全部行为：文本、`/` 技能与 `@` 素材引用、键位（Enter 插话 /
 * Alt+Enter 排队 / Esc 双击停止 / ↑ 回溯）、草稿。`VideoChatWindow` 只负责布局。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.2.1 / §3.3.6 / §3.4.4。
 * 所有键位先判 `isComposing`（输入法合成中的 Enter 不得触发任何动作）。
 */

const ESC_ARM_MS = 1_500;
const NO_COMMANDS: readonly ComposerCommand[] = [];

export interface SelectedSkill { id: string; name: string }

export interface UseComposerParams {
  agentMode: boolean;
  agentIsExecuting: boolean;
  isFinishing: boolean;
  isLoading: boolean;
  steering?: UseAgentSteeringReturn;
  draftRestore?: DraftRestore | null;
  materials: readonly MaterialItem[];
  messages: readonly ChatMessage[] | undefined;
  /** 草稿与历史的归属：`{projectKey}.{conversationId}`；缺省则不保存草稿。 */
  draftScope: { projectKey: string; conversationId: string } | null;
  onSendMessage: (message: string, options?: SendAgentMessageOptions) => Promise<void>;
  onCancel: () => void;
  /** Editor commands listed in the `/` menu after the skills. */
  commands?: readonly ComposerCommand[];
  onCommand?: (command: ComposerCommand) => void;
}

type PickerKind = 'skill' | 'mention';

/** 技能清单：选择器首次打开时才读取（客户端自带 30 秒缓存）。 */
function useSkillOptions(open: boolean) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [status, setStatus] = useState<SkillListStatus>('loading');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listSkills()
      .then((list) => { if (!cancelled) { setSkills(list); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [open]);
  return { skills, status };
}

export function useComposer(params: UseComposerParams) {
  const { agentMode, agentIsExecuting, isFinishing, isLoading, steering, materials } = params;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [skill, setSkill] = useState<SelectedSkill | null>(null);
  const [mentions, setMentions] = useState<MaterialMention[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [escArmed, setEscArmed] = useState(false);
  const [mentionsTruncated, setMentionsTruncated] = useState(false);
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const running = agentMode && agentIsExecuting && !!steering;
  const disabled = isLoading || (agentIsExecuting && !steering);

  // ---- pickers ----
  const skillTrigger = agentMode && !agentIsExecuting ? detectSkillTrigger(text, caret) : null;
  const mentionTrigger = agentMode ? detectMentionTrigger(text, caret) : null;
  const trigger: TriggerMatch | null = skillTrigger ?? mentionTrigger;
  const kind: PickerKind | null = skillTrigger ? 'skill' : mentionTrigger ? 'mention' : null;
  const triggerKey = trigger && kind ? `${kind}:${trigger.start}` : null;
  const pickerOpen = triggerKey !== null && dismissed !== triggerKey;
  const { skills, status: skillStatus } = useSkillOptions(pickerOpen && kind === 'skill');

  const commands = params.commands ?? NO_COMMANDS;
  const optionCount = !pickerOpen || !trigger ? 0
    : kind === 'skill'
      ? visibleSkills(skills, trigger.query).length + visibleCommands(commands, trigger.query).length
      : visibleMaterials(materials, trigger.query).length;

  useEffect(() => { setActiveIndex(0); }, [triggerKey, trigger?.query]);
  useEffect(() => { if (!triggerKey) setDismissed(null); }, [triggerKey]);

  const syncCaret = useCallback((element: HTMLTextAreaElement) => {
    setCaret(element.selectionStart ?? element.value.length);
  }, []);

  const moveCaret = useCallback((position: number) => {
    setCaret(position);
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(position, position));
  }, []);

  const selectSkill = useCallback((chosen: SkillSummary) => {
    if (!trigger) return;
    const next = removeTrigger(text, trigger);
    setText(next.text);
    setSkill({ id: chosen.id, name: chosen.name });
    moveCaret(next.caret);
  }, [trigger, text, moveCaret]);

  const selectMaterial = useCallback((material: MaterialItem) => {
    if (!trigger) return;
    const next = insertMention(text, trigger, material.name);
    setText(next.text);
    setMentions(previous => (previous.some(item => item.materialId === material.id)
      ? previous : [...previous, { materialId: material.id, label: material.name }]));
    moveCaret(next.caret);
  }, [trigger, text, moveCaret]);

  // Selecting a command runs it and removes the `/word`; other typed text stays.
  const selectCommand = useCallback((command: ComposerCommand) => {
    if (!trigger) return;
    const next = removeTrigger(text, trigger);
    setText(next.text);
    moveCaret(next.caret);
    params.onCommand?.(command);
  }, [trigger, text, moveCaret, params]);

  const confirmPicker = useCallback(() => {
    if (!trigger) return;
    if (kind === 'skill') {
      const shown = visibleSkills(skills, trigger.query);
      const chosen = shown[activeIndex];
      const command = visibleCommands(commands, trigger.query)[activeIndex - shown.length];
      if (chosen) selectSkill(chosen);
      else if (command) selectCommand(command);
    } else {
      const chosen = visibleMaterials(materials, trigger.query)[activeIndex];
      if (chosen) selectMaterial(chosen);
    }
  }, [trigger, kind, skills, commands, materials, activeIndex, selectSkill, selectCommand, selectMaterial]);

  // ---- draft + history ----
  const draftKey = params.draftScope
    ? draftStorageKey(params.draftScope.projectKey, params.draftScope.conversationId) : null;
  const { clearDraft } = useComposerDraft(draftKey, text, setText);
  const navigator = useMemo(
    () => createHistoryNavigator(collectInputHistory(params.messages)),
    [params.messages]);

  const lastRestore = useRef(0);
  useEffect(() => {
    const restore = params.draftRestore;
    if (!restore || restore.nonce === lastRestore.current) return;
    lastRestore.current = restore.nonce;
    setText(previous => (previous.trim() ? `${previous}\n\n${restore.text}` : restore.text));
    textareaRef.current?.focus();
  }, [params.draftRestore]);

  // ---- send ----
  const reset = useCallback(() => {
    setText('');
    setCaret(0);
    setSkill(null);
    setMentions([]);
    navigator.reset();
    clearDraft();
  }, [navigator, clearDraft]);

  const send = useCallback((mode: 'steer' | 'queue' | 'send') => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (mode === 'send') {
      const chosen = activeMentions(trimmed, mentions);
      setMentionsTruncated(chosen.truncated);
      const options: SendAgentMessageOptions = agentMode ? {
        ...(skill ? { skillId: skill.id } : {}),
        ...(chosen.mentions.length ? { mentions: chosen.mentions } : {}),
      } : {};
      // No extras → the call is exactly the old `onSendMessage(text)`.
      if (Object.keys(options).length) void params.onSendMessage(trimmed, options);
      else void params.onSendMessage(trimmed);
      reset();
      return;
    }
    // Running: the text stays in the box when the queue is full (never lost).
    if (steering?.submit(trimmed, isFinishing ? 'queue' : mode) === 'accepted') reset();
  }, [text, mentions, skill, agentMode, steering, isFinishing, params, reset]);

  const submit = useCallback(() => send(running ? 'steer' : 'send'), [send, running]);

  // ---- keys ----
  const armEscape = useCallback(() => {
    setEscArmed(true);
    if (escTimer.current) clearTimeout(escTimer.current);
    escTimer.current = setTimeout(() => setEscArmed(false), ESC_ARM_MS);
  }, []);
  useEffect(() => () => { if (escTimer.current) clearTimeout(escTimer.current); }, []);

  const onPickerKey = useCallback((event: React.KeyboardEvent): boolean => {
    if (event.key === 'Escape') { setDismissed(triggerKey); return true; }
    if (optionCount === 0) return false;
    if (event.key === 'ArrowDown') setActiveIndex(index => (index + 1) % optionCount);
    else if (event.key === 'ArrowUp') setActiveIndex(index => (index - 1 + optionCount) % optionCount);
    else if (event.key === 'Enter' || event.key === 'Tab') confirmPicker();
    else return false;
    return true;
  }, [triggerKey, optionCount, confirmPicker]);

  const onHistoryKey = useCallback((event: React.KeyboardEvent): boolean => {
    const atStart = (event.currentTarget as HTMLTextAreaElement).selectionStart === 0;
    const next = event.key === 'ArrowUp' && (!text || atStart)
      ? navigator.older(text) : event.key === 'ArrowDown' ? navigator.newer() : null;
    if (next === null) return false;
    setText(next);
    return true;
  }, [text, navigator]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (pickerOpen && onPickerKey(event)) { event.preventDefault(); return; }
    if (event.key === 'Escape' && running) {
      event.preventDefault();
      if (escArmed) { setEscArmed(false); params.onCancel(); } else armEscape();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(running ? (event.altKey ? 'queue' : 'steer') : 'send');
      return;
    }
    if (!running && !isLoading && onHistoryKey(event)) event.preventDefault();
  }, [pickerOpen, onPickerKey, running, escArmed, armEscape, params, send, isLoading, onHistoryKey]);

  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
    syncCaret(event.target);
    setMentionsTruncated(false);
    if (navigator.isBrowsing()) navigator.reset();
  }, [syncCaret, navigator]);

  return {
    textareaRef, text, setText, disabled, running, skill, clearSkill: () => setSkill(null),
    pickerOpen, pickerKind: kind, pickerQuery: trigger?.query ?? '', activeIndex,
    setActiveIndex, skills, skillStatus, selectSkill, selectMaterial, selectCommand,
    escArmed, mentionsTruncated, mentionLimit: MAX_MENTIONS,
    submit, handleKeyDown, handleChange, syncCaret,
  };
}
