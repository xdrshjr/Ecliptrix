// 解说文案逐句拆分工具。
//
// 主路径调用 AI（复用 /api/chat SSE，满足需求「调用 AI 对文案进行拆分」），
// 失败或字义被改写时自动回退本地确定性拆分（localSplitNarration），
// 保证「解说直接生成」第 2 步永不卡死，且「不增删字义」（spec v2 §2.3）。

/** 句末边界标点（中英）。换行单独处理为软边界，不保留。 */
const SENTENCE_END = /[。！？!?；;]/;

/**
 * 本地确定性拆分：按中英文句末标点与换行切句。
 *
 * 规则：保留句末标点，换行作为边界但不保留，去除首尾空白与空句。
 * 这是 AI 拆分失败时的兜底路径，纯函数、可单测、永不抛出。
 */
export function localSplitNarration(text: string): string[] {
  if (!text || !text.trim()) return [];
  const result: string[] = [];
  let current = '';
  for (const ch of text) {
    if (ch === '\n') {
      const trimmed = current.trim();
      if (trimmed) result.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
    if (SENTENCE_END.test(ch)) {
      const trimmed = current.trim();
      if (trimmed) result.push(trimmed);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail) result.push(tail);
  return result;
}

/**
 * 从可能含散文/代码块包裹的模型输出中抽取 JSON 文本。
 *
 * 与 useStoryboardChat 同款思路：先尝试直解，再尝试 ```fenced``` 代码块，
 * 最后退回首个 `{`..末个 `}` 截取。
 */
function extractJson(text: string): string | null {
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

/**
 * 解析模型返回的 `{"sentences":[...]}`。
 *
 * 返回去空白、去空句后的句子数组；无法解析或结构不符时返回 null，
 * 由调用方回退本地拆分。
 */
export function parseSentencesJson(text: string): string[] | null {
  const candidate = extractJson(text);
  if (!candidate) return null;
  try {
    const obj = JSON.parse(candidate);
    if (!obj || !Array.isArray(obj.sentences)) return null;
    const sentences = (obj.sentences as unknown[])
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s) => s.length > 0);
    return sentences.length > 0 ? sentences : null;
  } catch {
    return null;
  }
}

/** 去除全部空白字符，用于字义一致性比对。 */
function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, '');
}

/**
 * 字义一致性校验：AI 各句拼接（去空白）须与原文（去空白）完全一致，
 * 否则视为模型擅自改写字义，丢弃 AI 结果回退本地拆分（spec v2 §2.3 决议 4）。
 */
export function sentencesPreserveText(sentences: string[], original: string): boolean {
  return stripWhitespace(sentences.join('')) === stripWhitespace(original);
}

const SPLIT_SYSTEM_PROMPT_ZH =
  '你是文本切分助手。把下列解说文案按自然句切分，仅输出严格 JSON：{"sentences":["第一句","第二句"]}。' +
  '不得改写、增删任何字义，不加标点之外的内容，不加 markdown 代码块或解释。';
const SPLIT_SYSTEM_PROMPT_EN =
  'You are a text segmentation assistant. Split the following narration into natural sentences and ' +
  'output STRICT JSON only: {"sentences":["first","second"]}. Do NOT rewrite, add, or remove any wording; ' +
  'no commentary, no markdown code block.';

interface SplitOptions {
  signal?: AbortSignal;
  locale?: 'zh' | 'en';
}

/**
 * 调用 /api/chat 完成一次性（非流式 UI）补全，累加并返回完整文本。
 *
 * 复用 SSE `data: {content}` + `data: [DONE]` 范式。AbortError 向上抛出，
 * 供调用方区分「用户关闭/取消」与「拆分失败」。
 */
async function fetchSplitCompletion(text: string, opts: SplitOptions): Promise<string> {
  const systemPrompt = opts.locale === 'en' ? SPLIT_SYSTEM_PROMPT_EN : SPLIT_SYSTEM_PROMPT_ZH;
  // eslint-disable-next-line no-restricted-syntax -- /api/chat is the streaming LLM passthrough route; it uses a custom SSE reader not exposed by the http-client wrapper.
  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    }),
    signal: opts.signal,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`Split request failed: ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulated = '';
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
        if (typeof parsed.content === 'string') accumulated += parsed.content;
      } catch {
        // ignore malformed chunks
      }
    }
  }
  return accumulated;
}

/**
 * 把整段解说文案拆分为句子数组。
 *
 * 主路径调用 AI 并做字义一致性校验；任何非中止失败（请求错误、不可解析、
 * 字义被改写）都自动回退本地确定性拆分，确保返回非空的句子数组（除非原文为空）。
 * 中止（AbortError）向上抛出，由调用方决定是否丢弃结果。
 */
export async function splitNarrationIntoSentences(
  text: string,
  opts: SplitOptions = {},
): Promise<string[]> {
  const local = localSplitNarration(text);
  try {
    const aiText = await fetchSplitCompletion(text, opts);
    const parsed = parseSentencesJson(aiText);
    if (parsed && parsed.length > 0 && sentencesPreserveText(parsed, text)) {
      return parsed;
    }
    return local;
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    return local;
  }
}
