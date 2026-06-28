import { NextRequest, NextResponse } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import { normalizeApiType, streamLlmChat, type LlmApiType } from '@/lib/llm/streamLlmChat';

// ============================================================================
// Narration → AI Video Script API Route
// POST /api/narration-video-script
//
// Dedicated "旁白 → 画面脚本转换器". Given ONE narration sentence (the spoken
// voiceover line) it returns a SHOT/SCENE description that is intentionally
// DIFFERENT from the narration — it describes what the camera sees, never
// repeats the narration text.
//
// Why this exists (not /api/prompt-polish): prompt-polish's `ai-video` branch
// is a "prompt optimizer" whose system prompt explicitly preserves the user's
// original intent and only lightly expands it. Feeding a complete narration to
// an optimizer legitimately yields a near-verbatim echo, so the narration-direct
// "AI 视频脚本" came out word-for-word identical to the narration. This route
// models the task correctly (transformation, not optimization) AND adds a
// server-side "output ≈ narration" equivalence check with one retry, so even a
// weak model that echoes the narration cannot silently surface as the script —
// it returns a structured `IDENTICAL_OUTPUT` failure instead.
// See docs/plans/narration-direct-video-script-rewrite/spec.md.
//
// Transport: reuses the api_type-aware shared client (resolve chat model first,
// env vars as fallback) exactly like /api/chat, /api/prompt-polish and
// /api/ai-video-script-generation — so it works against both OpenAI- and
// Anthropic-compatible endpoints. The output is FREE TEXT: trimmed + de-quoted,
// NEVER JSON-parsed.
// ============================================================================

const LOG_PREFIX = '[Narration Video Script API]';

type ResolvedConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  apiType: LlmApiType;
};

// Actionable copy surfaced verbatim to the user when no model is configured.
const LLM_NOT_CONFIGURED_MESSAGE =
  '尚未配置 AI 模型凭证,请前往 设置 → 模型设置 完成配置 (AI model not configured — open Settings → Model Settings)';

// Distinguishable error so the outer catch can return a structured 503 instead
// of a generic 500. Identified by a stable `code`, never by message matching.
class LlmNotConfiguredError extends Error {
  readonly code = 'LLM_NOT_CONFIGURED';
  constructor(message: string = LLM_NOT_CONFIGURED_MESSAGE) {
    super(message);
    this.name = 'LlmNotConfiguredError';
  }
}

// Resolve LLM credentials the same way /api/chat and Agent inference do: the
// DB-configured chat model first (via the FastAPI resolve endpoint), env vars
// as fallback. Crucially returns `apiType`, so the call site picks the correct
// OpenAI vs Anthropic transport (RV-6: "not configured" is decided by an empty
// apiUrl/apiKey after the env fallback, never by collapsing an upstream 401).
const getConfig = async (): Promise<ResolvedConfig> => {
  let backendNotConfiguredMessage: string | null = null;
  try {
    const res = await fetch(
      backendConfig.joinPath('/api/model-settings/resolve/chat'),
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    );
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.api_key) {
        return {
          apiUrl: data.api_url,
          apiKey: data.api_key,
          model: data.model_name,
          apiType: normalizeApiType(data.api_type),
        };
      }
    } else if (res.status === 503) {
      const data = await res.json().catch(() => null);
      if (data?.error_code === 'MODEL_NOT_CONFIGURED' && typeof data.message === 'string') {
        backendNotConfiguredMessage = data.message;
      }
    }
  } catch {
    console.warn(`${LOG_PREFIX} Failed to fetch model settings from backend, falling back to env vars`);
  }

  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';
  const apiType = normalizeApiType(process.env.LLM_API_TYPE);

  if (!apiKey) {
    throw new LlmNotConfiguredError(backendNotConfiguredMessage ?? undefined);
  }

  return { apiUrl, apiKey, model, apiType };
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface NarrationVideoScriptRequest {
  narration: string;
  fullScript?: string;
  locale?: 'zh' | 'en';
}

// ---------------------------------------------------------------------------
// Prompt construction — a TRANSFORMER, not an optimizer.
// ---------------------------------------------------------------------------
const buildSystemPrompt = (locale: 'zh' | 'en'): string => {
  if (locale === 'en') {
    return `You are a storyboard visual director. You are given ONE narration line (spoken voiceover) and must turn it into an AI VIDEO SHOT SCRIPT — describing ONLY what the audience can SEE on screen. Hard rules:
1. NEVER repeat, copy, or merely paraphrase the narration's own words; the narration sentence must NOT appear in your output.
2. Output a SHOT / SCENE description (setting & environment, character actions and poses, lighting, color tone, shot size and camera movement, visual style) — NOT dialogue, NOT narration, NOT voiceover text.
3. It must read clearly DIFFERENT from the narration (different wording and viewpoint: the narration tells the "content", you tell "what the camera sees").
4. Keep it to 1–3 sentences, concrete and understandable by an AI video model.
5. Output ONLY the shot-script body — no prefix, suffix, quotes, numbering, labels or explanation.`;
  }
  return `你是分镜视觉导演。给你一句解说旁白（用于配音朗读），请把它转化为一段 AI 视频画面脚本——只描述镜头里观众看得到的画面。硬性要求：
1. 绝不复述、不照抄、不仅做同义改写旁白本身的文字；输出里不得出现旁白原句。
2. 输出的是画面 / 镜头描述（场景环境、人物动作与姿态、光影、色彩基调、景别与运镜、视觉风格），不是台词、不是解说、不是配音文本。
3. 与旁白文字明显不同（不同的措辞与视角：旁白讲"内容"，你讲"镜头看到什么"）。
4. 控制在 1–3 句，具体、可被 AI 视频模型理解。
5. 直接输出画面脚本正文，不要前后缀、引号、编号、标注或解释。`;
};

const buildUserPrompt = (narration: string, fullScript: string | undefined, locale: 'zh' | 'en'): string => {
  const sections: string[] = [];
  const context = (fullScript ?? '').trim();
  if (context) {
    sections.push(locale === 'en' ? `[Overall narration context]\n${context}` : `【整体解说上下文】\n${context}`);
  }
  sections.push(locale === 'en' ? `[This narration line]\n${narration}` : `【本句解说旁白】\n${narration}`);
  return sections.join('\n\n');
};

const buildRetryHint = (locale: 'zh' | 'en'): string =>
  locale === 'en'
    ? 'Your previous output was almost identical to the narration. Output ONLY a pure shot/scene description; the narration text must NOT appear.'
    : '你上次的输出与旁白几乎相同。请只输出纯画面/镜头描述，禁止包含旁白原文。';

// ---------------------------------------------------------------------------
// Equivalence check — guards against the model echoing the narration.
// ---------------------------------------------------------------------------

// Normalize for comparison: lowercase, then keep ONLY letters / digits / CJK
// ideographs — dropping whitespace, quotes and all (ASCII + CJK) punctuation.
// A positive whitelist avoids the `u`-flag / \p{} unicode escapes (target es5).
const norm = (s: string): string =>
  (s || '')
    .toLowerCase()
    .replace(/[^0-9a-z一-鿿㐀-䶿]/g, '');

// Levenshtein similarity ratio in [0,1]. Bounded inputs (single sentences), so
// the O(n*m) cost is negligible; we still cap to keep it cheap on long lines.
const levenshteinRatio = (a: string, b: string): number => {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const x = a.length > 600 ? a.slice(0, 600) : a;
  const y = b.length > 600 ? b.slice(0, 600) : b;
  const prev = new Array<number>(y.length + 1);
  const curr = new Array<number>(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= y.length; j++) prev[j] = curr[j];
  }
  const dist = prev[y.length];
  return 1 - dist / Math.max(x.length, y.length);
};

// "Output ≈ narration" → treat as a degenerate echo. Empty output is degenerate
// too (nothing usable). Mutual containment / very-high similarity catch near-
// verbatim repeats. A legitimate shot description differs strongly in wording.
const isDegenerate = (out: string, narration: string): boolean => {
  const o = norm(out);
  if (!o) return true;
  const n = norm(narration);
  if (!n) return false; // nothing to compare against → accept
  if (o === n) return true;
  if (o.includes(n) || n.includes(o)) return true;
  if (levenshteinRatio(o, n) > 0.9) return true;
  return false;
};

// Free text → strip surrounding whitespace and any single layer of wrapping
// quotes the model may add. NEVER JSON-parsed (per spec §10#2).
const cleanOutput = (content: string): string => content.trim().replace(/^["']|["']$/g, '').trim();

type LlmMessage = { role: string; content: string };

// One streamed LLM call accumulated into a single string. Returns either the
// accumulated content or a structured upstream error (status preserved).
const runLlmOnce = async (
  config: ResolvedConfig,
  messages: LlmMessage[],
): Promise<{ content: string; upstreamError: { status: number; message: string } | null }> => {
  let content = '';
  let upstreamError: { status: number; message: string } | null = null;
  for await (const event of streamLlmChat({
    config: {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      model: config.model,
      apiType: config.apiType,
    },
    messages,
    temperature: 0.8, // encourage divergence, lower the chance of echoing the narration
    maxTokens: 400,
    signal: AbortSignal.timeout(30000),
  })) {
    if (event.kind === 'error') {
      upstreamError = { status: event.status, message: event.message };
      break;
    }
    if (event.kind === 'content') content += event.text;
  }
  return { content, upstreamError };
};

const upstreamErrorResponse = (status: number, message: string): NextResponse => {
  const httpStatus = status >= 400 && status <= 599 ? status : 502;
  return NextResponse.json(
    { success: false, videoScript: '', code: 'UPSTREAM_ERROR', message: `LLM API error: ${status}` },
    { status: httpStatus },
  );
};

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as NarrationVideoScriptRequest;

    if (!body.narration || typeof body.narration !== 'string' || body.narration.trim().length === 0) {
      return NextResponse.json(
        { success: false, videoScript: '', code: 'EMPTY', message: 'narration is required and must be non-empty' },
        { status: 400 },
      );
    }

    const narration = body.narration.trim();
    const fullScript = typeof body.fullScript === 'string' ? body.fullScript : undefined;
    const locale: 'zh' | 'en' = body.locale === 'en' ? 'en' : 'zh';

    const config = await getConfig();
    console.log(`${LOG_PREFIX} Calling LLM API (api_type=${config.apiType}) base=${config.apiUrl}`);

    const messages: LlmMessage[] = [
      { role: 'system', content: buildSystemPrompt(locale) },
      { role: 'user', content: buildUserPrompt(narration, fullScript, locale) },
    ];

    // Round 1.
    const round1 = await runLlmOnce(config, messages);
    if (round1.upstreamError) {
      console.error(`${LOG_PREFIX} LLM API error (round1): ${round1.upstreamError.status}`);
      return upstreamErrorResponse(round1.upstreamError.status, round1.upstreamError.message);
    }
    let output = cleanOutput(round1.content);

    // Equivalence guard: if the model echoed the narration, append a corrective
    // instruction and retry ONCE before failing (never surface the echo).
    if (isDegenerate(output, narration)) {
      console.warn(`${LOG_PREFIX} Round 1 output is degenerate (≈ narration), retrying once`);
      const retryMessages: LlmMessage[] = [
        ...messages,
        { role: 'assistant', content: round1.content.trim() || '(empty)' },
        { role: 'user', content: buildRetryHint(locale) },
      ];
      const round2 = await runLlmOnce(config, retryMessages);
      if (round2.upstreamError) {
        console.error(`${LOG_PREFIX} LLM API error (round2): ${round2.upstreamError.status}`);
        return upstreamErrorResponse(round2.upstreamError.status, round2.upstreamError.message);
      }
      output = cleanOutput(round2.content);

      if (isDegenerate(output, narration)) {
        const code = output ? 'IDENTICAL_OUTPUT' : 'EMPTY';
        console.warn(`${LOG_PREFIX} Round 2 still degenerate → ${code}`);
        return NextResponse.json(
          {
            success: false,
            videoScript: '',
            code,
            message:
              code === 'IDENTICAL_OUTPUT'
                ? 'Model repeatedly echoed the narration instead of producing a distinct shot script.'
                : 'Model returned an empty shot script.',
          },
          { status: 422 },
        );
      }
    }

    console.log(`${LOG_PREFIX} Generated video script (${output.length} chars)`);
    return NextResponse.json({ success: true, videoScript: output });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      console.error(`${LOG_PREFIX} LLM API call timed out`);
      return NextResponse.json(
        { success: false, videoScript: '', code: 'UPSTREAM_ERROR', message: 'LLM API call timed out. Please try again.' },
        { status: 504 },
      );
    }

    if (error instanceof LlmNotConfiguredError) {
      console.error(`${LOG_PREFIX} ${error.message}`);
      return NextResponse.json(
        { success: false, videoScript: '', code: error.code, message: error.message },
        { status: 503 },
      );
    }

    console.error(`${LOG_PREFIX} Unexpected error:`, error);
    return NextResponse.json(
      { success: false, videoScript: '', code: 'UPSTREAM_ERROR', message: 'Internal server error' },
      { status: 500 },
    );
  }
}
