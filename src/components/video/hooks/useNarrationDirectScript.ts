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
  /** 父级追加回调：把组装好的新解说 segment 合并进 content.scriptSegments。 */
  onComplete: (segment: ScriptSegment) => void;
  /** 新 segment 的默认标题（随 i18n 变化，complete 时取最新值）。 */
  defaultSegmentTitle: string;
}

function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 拼接 narrationText：英文句首补一个空格，中文/标点直接相接（spec 决议 R9），
 * 避免 "A." + "B." 相接成 "A.B."。
 */
function joinNarration(parts: string[]): string {
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  let out = '';
  for (const part of clean) {
    if (!out) {
      out = part;
      continue;
    }
    const nextFirst = part[0] ?? '';
    const needSpace = /[A-Za-z0-9]/.test(nextFirst);
    out += (needSpace ? ' ' : '') + part;
  }
  return out;
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

  const chat = useNarrationChat({
    locale,
    getDraftText,
    onRewrite: handleRewrite,
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
    const segment: ScriptSegment = {
      id: genId('seg'),
      title: titleRef.current,
      narrationText: joinNarration(sentences.map((s) => s.text)),
      sentences: sentences.map((s) => ({
        id: genId('sent'),
        text: s.text,
        narration: s.text,
      })),
    };
    onComplete(segment);
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
