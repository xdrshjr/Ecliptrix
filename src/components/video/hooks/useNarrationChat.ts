'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NarrationChatMessage } from '../types/videoEditingTypes';

interface UseNarrationChatOptions {
  locale?: 'zh' | 'en';
  /** 读取最新的左侧文案（含用户手改），作为改写上下文，避免闭包陈旧。 */
  getDraftText: () => string;
  /** 流结束后把完整改写文案一次性回写到 draftText（spec §2.2 B-3）。 */
  onRewrite: (fullText: string) => void;
  /**
   * 流式增量回调（本轮新需求）：每收到一块正文就把「已累计的正文」写入左侧
   * draftText，实现 ChatGPT 式逐块显示。只回传 content（不含 reasoning）。
   */
  onStreamDraft?: (partial: string) => void;
  /**
   * 与拆分调用共用的 AbortController ref（spec 决议 R4）。
   * 发送前赋新 controller，close()/abort() 中止之。
   */
  abortRef: React.MutableRefObject<AbortController | null>;
}

export interface UseNarrationChatReturn {
  messages: NarrationChatMessage[];
  isStreaming: boolean;
  sendMessage: (content: string) => Promise<void>;
  abort: () => void;
  reset: () => void;
}

const SYSTEM_PROMPT_ZH =
  '你是专业短视频解说文案撰稿人。每次回复都只输出当前完整的解说文案纯文本，' +
  '不要 markdown、不要解释、不要分镜或编号。请在用户最新需求的基础上修改我给出的『当前文案』，' +
  '若当前文案为空则直接按需求创作一段完整解说。';
const SYSTEM_PROMPT_EN =
  'You are a professional short-video narration copywriter. Every reply must output ONLY the current ' +
  'full narration as plain text — no markdown, no commentary, no shot list or numbering. Revise the ' +
  '"current draft" I provide according to the user\'s latest request; if the draft is empty, write a ' +
  'complete narration from scratch.';

function genId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 剥离模型偶发混入的 ```fenced``` 代码块包裹，保留内层纯文本。 */
function stripCodeFence(text: string): string {
  const fence = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fence && fence[1] && fence[1].trim()) return fence[1].trim();
  return text;
}

/**
 * 「文案改写」流式对话 hook（仿 useStoryboardChat）。
 *
 * 与分镜聊天不同：每轮把当前左侧文案作为上下文随需求发送，流结束后把累计文本
 * 整段回写 draftText，并把该条 assistant 气泡替换为「已更新左侧文案」摘要。
 */
export function useNarrationChat(opts: UseNarrationChatOptions): UseNarrationChatReturn {
  const { locale, getDraftText, onRewrite, onStreamDraft, abortRef } = opts;
  const isZh = locale !== 'en';
  const systemPrompt = isZh ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;

  const formatUpdated = () => (isZh ? '已更新左侧文案' : 'Left draft updated.');
  const formatCancelled = () => (isZh ? '[已取消]' : '[cancelled]');
  // 流末内容空守卫（R-B / E2）：模型只产 reasoning、或正文与思考皆空时，给出明确的
  // 终态反馈，而非把进行中的「正在改写…」误当终态摘要。任何分支都不把 reasoning 写入左侧 draft。
  const formatReasoningOnly = () =>
    isZh
      ? '模型仅返回思考内容、未生成解说正文，请更换模型或重试'
      : 'The model returned only reasoning, no narration body — switch models or retry.';
  const formatEmptyResult = () =>
    isZh ? '模型未返回任何内容，请重试' : 'The model returned nothing — please retry.';

  const makeSystemMessage = useCallback(
    (): NarrationChatMessage => ({
      id: genId('sys'),
      role: 'system',
      content: systemPrompt,
      timestamp: new Date(),
    }),
    [systemPrompt],
  );

  const [messages, setMessages] = useState<NarrationChatMessage[]>(() => [makeSystemMessage()]);
  const [isStreaming, setIsStreaming] = useState(false);

  // 保持最新 messages 供发送时拼接历史，避免把 setState 放进 useCallback 依赖。
  const messagesRef = useRef<NarrationChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // locale 变化时仅替换 system 消息，保留用户/assistant 轮次。
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 0 || prev[0].role !== 'system') return prev;
      if (prev[0].content === systemPrompt) return prev;
      const next = [...prev];
      next[0] = { ...next[0], content: systemPrompt };
      return next;
    });
  }, [systemPrompt]);

  const reset = useCallback(() => {
    setMessages([makeSystemMessage()]);
  }, [makeSystemMessage]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, [abortRef]);

  const sendMessage = useCallback(
    async (content: string): Promise<void> => {
      if (!content.trim() || isStreaming) return;

      const draft = getDraftText();
      const composedUserContent = isZh
        ? `当前文案：\n${draft}\n\n用户需求：${content}`
        : `Current draft:\n${draft}\n\nRequest: ${content}`;

      // 展示用消息只显示需求文本；发往后端的最后一条 user 替换为含上下文版本。
      const userMsg: NarrationChatMessage = {
        id: genId('u'),
        role: 'user',
        content,
        timestamp: new Date(),
      };
      const assistantMsg: NarrationChatMessage = {
        id: genId('a'),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        reasoningContent: '',
      };
      const history = [...messagesRef.current, userMsg, assistantMsg];
      setMessages(history);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      // 出站负载：去掉占位 assistant，并把最后一条 user 内容替换为含「当前文案」上下文。
      const outboundBase = history.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
      const outbound = outboundBase.map((m, idx) =>
        idx === outboundBase.length - 1 ? { ...m, content: composedUserContent } : m,
      );

      let accumulated = '';
      let accumulatedReasoning = '';
      let wasAborted = false;
      let errorMessage: string | null = null;
      try {
        // eslint-disable-next-line no-restricted-syntax -- /api/chat is the streaming LLM passthrough route; custom SSE reader not exposed by http-client.
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: outbound }),
          signal: controller.signal,
        });
        if (!resp.ok || !resp.body) {
          // 优先呈现后端的可操作错误文案（如「未配置 AI 模型凭证…」结构化 503），
          // 而非裸状态码。响应体可能非 JSON 或为空，解析失败时回退到原状态码提示。
          let serverMessage = '';
          try {
            const errBody = await resp.json();
            serverMessage =
              (typeof errBody?.message === 'string' && errBody.message) ||
              (typeof errBody?.error === 'string' && errBody.error) ||
              '';
          } catch {
            // body 非 JSON / 为空：忽略，走下方状态码回退。
          }
          throw new Error(serverMessage || `Chat request failed: ${resp.status}`);
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
              // 流式增量 → 左侧：把已累计的正文（不含 reasoning）实时写入 draftText。
              // reasoning 留在右侧可折叠区，绝不混进左侧（评审 8.3 边界约束）。
              if (chunk) onStreamDraft?.(accumulated);
            } catch {
              // ignore malformed chunks
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
          wasAborted = true;
        } else {
          errorMessage = err instanceof Error ? err.message : String(err);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }

      const rewritten = stripCodeFence(accumulated).trim();
      // 流正常结束且有内容：整段回写左侧文案（spec §2.2 B-3 一次性回写）。
      if (!wasAborted && !errorMessage && rewritten) {
        onRewrite(rewritten);
      }

      // 收尾：把 assistant 气泡替换为摘要 / 取消 / 错误文案。
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.length - 1;
        if (idx < 0 || next[idx].role !== 'assistant') return next;
        let summary: string;
        if (wasAborted) {
          summary = formatCancelled();
        } else if (errorMessage) {
          summary = `${isZh ? '改写失败：' : 'Rewrite failed: '}${errorMessage}`;
        } else if (rewritten) {
          summary = formatUpdated();
        } else if (accumulatedReasoning.trim()) {
          // 仅产 reasoning、无正文 content：流已结束，给出明确空结果反馈（修掉 E2 的误导性「正在改写…」）。
          summary = formatReasoningOnly();
        } else {
          // 正文与思考皆空：模型什么都没返回。
          summary = formatEmptyResult();
        }
        next[idx] = {
          ...next[idx],
          content: summary,
          summaryText: summary,
          reasoningContent: accumulatedReasoning,
          isStreaming: false,
        };
        return next;
      });
    },
    // formatX 取自 isZh，已纳入依赖；getDraftText/onRewrite/onStreamDraft/abortRef 为稳定引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isStreaming, isZh, getDraftText, onRewrite, onStreamDraft, abortRef],
  );

  return { messages, isStreaming, sendMessage, abort, reset };
}
