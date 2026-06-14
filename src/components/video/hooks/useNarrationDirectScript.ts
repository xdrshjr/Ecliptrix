'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScriptSegment } from '@/types';
import type {
  NarrationDirectStep,
  NarrationSplitSentence,
  UseNarrationDirectScriptReturn,
} from '../types/videoEditingTypes';
import { splitNarrationIntoSentences } from '../utils/narrationSplit';
import { useNarrationChat } from './useNarrationChat';

interface UseNarrationDirectScriptOptions {
  locale?: 'zh' | 'en';
  /** 父级追加回调：把组装好的逐句新解说 segments 一次性合并进 content.scriptSegments。 */
  onComplete: (segments: ScriptSegment[]) => void;
  /** 新 segment 的默认标题（随 i18n 变化，complete 时取最新值）。 */
  defaultSegmentTitle: string;
}

function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toSplitSentences(texts: string[]): NarrationSplitSentence[] {
  return texts.map((text) => ({ id: genId('split'), text }));
}

/**
 * 「解说直接生成」两步式弹窗的编排 hook。
 *
 * 管理 open/close、step（compose/split）、draftText、改写流式态、拆分态与拆分结果，
 * 内部实例化 useNarrationChat 完成第 1 步对话改写。改写与拆分共用同一个 AbortController
 * ref（spec 决议 R4）：close() 同时中止两者。
 */
export function useNarrationDirectScript(
  options: UseNarrationDirectScriptOptions,
): UseNarrationDirectScriptReturn {
  const { locale, onComplete } = options;

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<NarrationDirectStep>('compose');
  const [draftText, setDraftTextState] = useState('');
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitSentences, setSplitSentences] = useState<NarrationSplitSentence[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 改写与拆分共用的中止控制器。
  const abortRef = useRef<AbortController | null>(null);
  // 读取最新 draftText / splitSentences / 标题，避免异步闭包陈旧。
  const draftRef = useRef(draftText);
  const splitRef = useRef(splitSentences);
  const titleRef = useRef(options.defaultSegmentTitle);
  useEffect(() => {
    draftRef.current = draftText;
  }, [draftText]);
  useEffect(() => {
    splitRef.current = splitSentences;
  }, [splitSentences]);
  useEffect(() => {
    titleRef.current = options.defaultSegmentTitle;
  }, [options.defaultSegmentTitle]);

  const getDraftText = useCallback(() => draftRef.current, []);
  const handleRewrite = useCallback((fullText: string) => {
    setDraftTextState(fullText);
  }, []);
  // 流式增量：把对话产出的正文逐块写入左侧 draftText（ChatGPT 式逐字显示）。
  const handleStreamDraft = useCallback((partial: string) => {
    setDraftTextState(partial);
  }, []);

  const chat = useNarrationChat({
    locale,
    getDraftText,
    onRewrite: handleRewrite,
    onStreamDraft: handleStreamDraft,
    abortRef,
  });

  const setDraftText = useCallback((text: string) => {
    setDraftTextState(text);
  }, []);

  const open = useCallback(
    (initialText?: string) => {
      // 初始 draftText 默认空串（spec 决议 R2）：禁止用既有解说聚合文本预填。
      const seed = initialText ?? '';
      setDraftTextState(seed);
      setStep('compose');
      setSplitSentences([]);
      setIsSplitting(false);
      setError(null);
      chat.reset();
      setIsOpen(true);
    },
    [chat],
  );

  const close = useCallback(() => {
    // 同时中止改写流与拆分请求（共用 abortRef），并重置全部状态。
    abortRef.current?.abort();
    abortRef.current = null;
    setIsOpen(false);
    setStep('compose');
    setDraftTextState('');
    setSplitSentences([]);
    setIsSplitting(false);
    setError(null);
    chat.reset();
  }, [chat]);

  const abortChat = useCallback(() => {
    chat.abort();
  }, [chat]);

  const goToSplitStep = useCallback(async () => {
    const text = draftRef.current.trim();
    if (!text || isSplitting || chat.isStreaming) return;
    setError(null);
    setIsSplitting(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const sentences = await splitNarrationIntoSentences(draftRef.current, {
        signal: controller.signal,
        locale: locale === 'en' ? 'en' : 'zh',
      });
      setSplitSentences(toSplitSentences(sentences));
      setStep('split');
    } catch (err) {
      // AbortError（用户关闭/取消）静默返回；其余错误已在工具内回退本地拆分，
      // 走到这里属意外，给出可读提示而不抛出。
      if ((err as { name?: string })?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsSplitting(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [isSplitting, chat.isStreaming, locale]);

  const backToCompose = useCallback(() => {
    setStep('compose');
  }, []);

  const updateSplitSentences = useCallback((next: NarrationSplitSentence[]) => {
    setSplitSentences(next);
  }, []);

  const complete = useCallback(() => {
    const sentences = splitRef.current
      .map((s) => ({ ...s, text: s.text.trim() }))
      .filter((s) => s.text.length > 0);
    if (sentences.length === 0) return;
    // 每句生成一个独立 segment（每段仅 1 句），实现外部面板「一句一卡、逐句对应」。
    // 多句时给标题补 1 基序号，便于区分各条目。
    const multi = sentences.length > 1;
    const segments: ScriptSegment[] = sentences.map((s, idx) => ({
      id: genId('seg'),
      title: multi ? `${titleRef.current} ${idx + 1}` : titleRef.current,
      narrationText: s.text,
      sentences: [{ id: genId('sent'), text: s.text, narration: s.text }],
    }));
    // 一次性批量上抛，由父级单次 handleUpdateSegments([...existing, ...segments]) 写入，
    // 规避「逐次单写读陈旧 ref 导致丢句」的竞态（评审 8.2-(1) / 决议 R3）。
    onComplete(segments);
    close();
  }, [onComplete, close]);

  return {
    isOpen,
    step,
    draftText,
    isStreaming: chat.isStreaming,
    isSplitting,
    splitSentences,
    error,
    chatMessages: chat.messages,
    open,
    close,
    setDraftText,
    sendChatMessage: chat.sendMessage,
    abortChat,
    goToSplitStep,
    backToCompose,
    updateSplitSentences,
    complete,
  };
}
