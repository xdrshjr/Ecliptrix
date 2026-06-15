'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/types';

export interface ScriptShot {
  shotId: string;
  script: string;
  visualPrompt: string;
}

export interface ParsedShotsResult {
  shots: ScriptShot[];
  rawText: string;
  parseError?: string;
}

interface UseStoryboardChatOptions {
  locale?: 'zh' | 'en';
  initialSystemPrompt?: string;
}

export interface StoryboardChatMessage extends ChatMessage {
  reasoningContent?: string;
  summaryText?: string;
  parseError?: string;
}

const SYSTEM_PROMPT_ZH =
  '你是一名专业的影视分镜编剧。请按用户要求生成分镜剧本。\n' +
  '输出必须是严格 JSON，且仅输出 JSON，不要任何 markdown 代码块或解释。\n' +
  '格式：{"shots":[{"index":1,"script":"这一镜的剧本旁白/描述","visual_prompt":"用于图像生成的简短英文或中文视觉提示"}]}\n' +
  '约束：shots 数量 ≤ 12；script 用中文；visual_prompt 描述画面主体、环境、镜头与光线；index 从 1 连续。';
const SYSTEM_PROMPT_EN =
  'You are a professional storyboard screenwriter. Produce a storyboard script per the user\'s request.\n' +
  'Output MUST be a strict JSON object — no markdown, no commentary.\n' +
  'Format: {"shots":[{"index":1,"script":"narration/description for this shot","visual_prompt":"visual prompt for image generation"}]}\n' +
  'Constraints: shots ≤ 12; index starts at 1 and is contiguous.';

function extractJson(text: string): string | null {
  // Try direct parse first, then fenced code blocks, then first `{`..last `}` substring.
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fence && fence[1]) return fence[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return null;
}

export function parseShots(text: string): ParsedShotsResult {
  const candidate = extractJson(text);
  if (!candidate) {
    return { shots: [], rawText: text, parseError: 'no JSON found' };
  }
  try {
    const obj = JSON.parse(candidate);
    const rawShots = Array.isArray(obj?.shots) ? obj.shots : [];
    const shots: ScriptShot[] = rawShots.map((s: any, idx: number) => ({
      shotId: genId(),
      script: typeof s?.script === 'string' ? s.script : '',
      visualPrompt:
        typeof s?.visual_prompt === 'string'
          ? s.visual_prompt
          : typeof s?.visualPrompt === 'string'
            ? s.visualPrompt
            : '',
    }));
    return { shots, rawText: text };
  } catch (e) {
    return {
      shots: [],
      rawText: text,
      parseError: e instanceof Error ? e.message : 'parse failed',
    };
  }
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `shot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface UseStoryboardChatReturn {
  messages: StoryboardChatMessage[];
  isStreaming: boolean;
  sendMessage: (content: string) => Promise<ParsedShotsResult | null>;
  abort: () => void;
  resetChat: () => void;
  lastParsed: ParsedShotsResult | null;
}

export interface SummaryFormatter {
  (n: number): string;
}
export interface CancelledFormatter {
  (): string;
}

/**
 * Chat hook dedicated to AI storyboard script creation.
 * Streams from /api/chat (SSE), accumulates the full assistant response,
 * then attempts to parse shots[] JSON after stream completion.
 */
export function useStoryboardChat(
  opts: UseStoryboardChatOptions = {},
): UseStoryboardChatReturn {
  const systemPrompt =
    opts.initialSystemPrompt ??
    (opts.locale === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ZH);

  const isZh = opts.locale !== 'en';
  const formatSummary = (n: number) =>
    isZh ? `已生成 ${n} 段分镜 — 请在左侧查看与编辑` : `Generated ${n} shots — review them on the left.`;
  const formatCancelled = () => (isZh ? '[已取消]' : '[cancelled]');
  const formatParseFail = () => (isZh ? '生成未完成：响应无法解析为分镜 JSON' : 'Incomplete: response not parseable as shots JSON');

  const [messages, setMessages] = useState<StoryboardChatMessage[]>([
    {
      id: `sys-${Date.now()}`,
      role: 'system',
      content: systemPrompt,
      timestamp: new Date(),
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastParsed, setLastParsed] = useState<ParsedShotsResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resetChat = useCallback(() => {
    setMessages([
      {
        id: `sys-${Date.now()}`,
        role: 'system',
        content: systemPrompt,
        timestamp: new Date(),
      },
    ]);
    setLastParsed(null);
  }, [systemPrompt]);

  // Keep the system prompt in sync if locale changes while the hook is mounted
  // (e.g. modal stays open across a language switch). Only the system message
  // is replaced — user/assistant turns are preserved.
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 0 || prev[0].role !== 'system') return prev;
      if (prev[0].content === systemPrompt) return prev;
      const next = [...prev];
      next[0] = { ...next[0], content: systemPrompt };
      return next;
    });
  }, [systemPrompt]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (content: string): Promise<ParsedShotsResult | null> => {
      if (!content.trim() || isStreaming) return null;
      const userMsg: StoryboardChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date(),
      };
      const assistantMsg: StoryboardChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        reasoningContent: '',
      };
      const history = [...messages, userMsg, assistantMsg];
      setMessages(history);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = '';
      let accumulatedReasoning = '';
      let wasAborted = false;
      let errorMessage: string | null = null;
      try {
        // eslint-disable-next-line no-restricted-syntax -- /api/chat is the streaming LLM passthrough route; it doesn't require session auth and uses a custom SSE reader that the http-client wrapper does not expose.
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history.slice(0, -1).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: controller.signal,
        });
        if (!resp.ok || !resp.body) {
          throw new Error(`Chat request failed: ${resp.status}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const tl = line.trim();
            if (!tl || !tl.startsWith('data: ')) continue;
            const data = tl.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              // 上游错误以 data:{error,message} 形式下发（route.ts:176-186），该块既无 content
              // 也无 reasoning。须在空块判定 continue 之前识别并置 errorMessage，使收尾落到
              // 「生成失败：…」分支，否则会被吞掉、误报为「响应无法解析为分镜 JSON」。
              if (typeof parsed.error === 'string' && parsed.error) {
                const detail =
                  typeof parsed.message === 'string' && parsed.message.trim()
                    ? `（${parsed.message.trim()}）`
                    : '';
                errorMessage = `${parsed.error}${detail}`;
                break;
              }
              const chunk = typeof parsed.content === 'string' ? parsed.content : '';
              const reasoningChunk = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
              if (chunk.length === 0 && reasoningChunk.length === 0) continue;
              if (chunk) accumulated += chunk;
              if (reasoningChunk) accumulatedReasoning += reasoningChunk;
              setMessages((prev) => {
                const next = [...prev];
                const idx = next.length - 1;
                if (idx >= 0 && next[idx].role === 'assistant') {
                  next[idx] = {
                    ...next[idx],
                    content: accumulated,
                    reasoningContent: accumulatedReasoning,
                  };
                }
                return next;
              });
            } catch {
              // ignore malformed chunks
            }
          }
          if (errorMessage) break;
        }
      } catch (err) {
        if ((err as any)?.name === 'AbortError') {
          wasAborted = true;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setMessages((prev) => {
            const next = [...prev];
            const idx = next.length - 1;
            if (idx >= 0 && next[idx].role === 'assistant') {
              next[idx] = {
                ...next[idx],
                content: accumulated + `\n\n[error] ${msg}`,
                isStreaming: false,
              };
            }
            return next;
          });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }

      const parsed = parseShots(accumulated);
      setLastParsed(parsed);

      // Final message shape: keep reasoning, replace raw content with summary / cancelled / parse-error text.
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.length - 1;
        if (idx < 0 || next[idx].role !== 'assistant') return next;
        let summary: string;
        let parseError: string | undefined;
        if (wasAborted) {
          summary = formatCancelled();
        } else if (errorMessage) {
          summary = `${isZh ? '生成失败：' : 'Generation failed: '}${errorMessage}`;
        } else if (parsed.shots.length > 0) {
          summary = formatSummary(parsed.shots.length);
        } else {
          summary = formatParseFail();
          parseError = parsed.parseError;
        }
        next[idx] = {
          ...next[idx],
          content: summary,
          reasoningContent: accumulatedReasoning,
          summaryText: summary,
          parseError,
          isStreaming: false,
        };
        return next;
      });
      return parsed;
    },
    [isStreaming, messages],
  );

  return { messages, isStreaming, sendMessage, abort, resetChat, lastParsed };
}
