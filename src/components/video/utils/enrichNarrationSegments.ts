/**
 * 「解说直接生成」富化流水线（spec narration-direct-video-script-rewrite v2 §3.2）。
 *
 * 把链路重写为：整篇解说作上下文 → 逐句调【专用转换端点】生成 AI 视频脚本（画面描述，
 * 与旁白逐字不同）→ 写 `videoScript`/状态（失败置 'failed'，绝不静默回退旁白）；并【与逐句
 * 脚本生成并行】从旁白原文提取英文关键词、先到先 ref-safe 单独写回（方案 A：关键词不再排在
 * 逐句脚本之后串行，建卡即就位，消除「点搜索时关键词几乎必空」的时序根因）→ 画面脚本按 id
 * 合并 ref 写回；并以 `try/finally` 收敛任何残留 `generating` 句为 `failed`（RV-2 无悬挂态）。
 *
 * 抽成依赖注入的独立 util（见 spec「实施过程发现的方案缺陷 IF-1」）：富化主体原应内联在
 * `VideoEditingInterface` 的 useCallback 里，但其单测无法在不渲染整个巨型组件时覆盖真实
 * 合并/收敛逻辑，故抽到此处。所有 `videoScript*` 写入仍是「基于实时 ref 的单句增量 patch、
 * spread 既有字段」（RV-1/RV-3）：`commitSegments` 由调用方实现为「先前移 ref 再向上同步」。
 */

import type { ScriptSegment, ScriptSentence } from '@/types';
import type { NarrationVideoScriptResult } from '@/lib/api/narrationVideoScript';
import { buildFullScriptContext, runWithConcurrency } from '@/lib/api/sentenceAiVideoPrompt';

const GENERATING = 'generating' as const;
const SUCCEEDED = 'succeeded' as const;
const FAILED = 'failed' as const;

/** 逐句画面脚本生成的并发上限（沿用现有富化的 limit=2）。 */
const VIDEO_SCRIPT_CONCURRENCY = 2;

export type GenerateVideoScriptFn = (
  narration: string,
  fullScript: string,
  locale: 'zh' | 'en',
) => Promise<NarrationVideoScriptResult>;

export type GenerateKeywordsFn = (segments: ScriptSegment[]) => Promise<ScriptSegment[]>;

export interface EnrichNarrationSegmentsDeps {
  /** 本轮新写入的解说 segments（每段每句已携带 `videoScriptStatus:'generating'`）。 */
  newSegments: ScriptSegment[];
  /** 读取最新 scriptSegments（即 `scriptSegmentsRef.current`），杜绝闭包陈旧。 */
  getLatestSegments: () => ScriptSegment[];
  /** ref-safe 写回：实现方须「先前移 ref 再 onUpdateSegments」（RV-3）。 */
  commitSegments: (segments: ScriptSegment[]) => void;
  /** 专用端点：旁白 → 画面脚本（与旁白逐字不同）。 */
  generateVideoScript: GenerateVideoScriptFn;
  /** 关键词端点：取材为传入 segments 的 `sentence.text`（方案 A：此处即旁白原文，与画面脚本并行）。 */
  generateKeywords: GenerateKeywordsFn;
  /** 画面脚本输出语言。 */
  locale: 'zh' | 'en';
  /** 可选告警回调（仅记录，不影响流程）。 */
  onWarn?: (message: string, meta?: Record<string, unknown>) => void;
}

/** 成功句的字段 patch：写 `videoScript`/succeeded，并同步 `aiVideoPrompt` 抑制 TTS 后重复润色。 */
function succeededPatch(videoScript: string): Partial<ScriptSentence> {
  return {
    videoScript,
    videoScriptStatus: SUCCEEDED,
    videoScriptError: undefined,
    // ARK 句级取材与画面脚本一致，且使 shouldAutoGeneratePrompt 命中跳过（R6/RV-7）。
    aiVideoPrompt: videoScript,
    aiVideoPromptStatus: SUCCEEDED,
    aiVideoPromptError: undefined,
  };
}

/**
 * ref-safe 单次合并写回：读最新 segments，只改命中 segment 的句子/keywords，
 * `{...seg}` / `{...sentence}` 展开既有字段（RV-1 字段保全）。无任何实际变化时不写
 * （避免 finally 的冗余空写触发不必要的下游重渲染）。返回是否写入。
 */
function mergeAndCommit(
  deps: Pick<EnrichNarrationSegmentsDeps, 'getLatestSegments' | 'commitSegments'>,
  enrichedIds: Set<string>,
  patchFn: (sentence: ScriptSentence) => ScriptSentence,
  keywordsBySegment?: Map<string, string[] | undefined>,
): boolean {
  const latest = deps.getLatestSegments() ?? [];
  if (!latest.some(seg => enrichedIds.has(seg.id))) return false; // 全被删除/清空 → 不写
  let changed = false;
  const merged = latest.map(seg => {
    if (!enrichedIds.has(seg.id)) return seg;
    let segChanged = false;
    const sentences = seg.sentences.map(sent => {
      const next = patchFn(sent);
      if (next !== sent) segChanged = true;
      return next;
    });
    const kw = keywordsBySegment?.get(seg.id);
    const keywordsChanged = kw !== undefined && kw !== seg.keywords;
    if (!segChanged && !keywordsChanged) return seg;
    changed = true;
    return keywordsChanged ? { ...seg, sentences, keywords: kw } : { ...seg, sentences };
  });
  if (!changed) return false;
  deps.commitSegments(merged);
  return true;
}

export async function enrichNarrationSegments(deps: EnrichNarrationSegmentsDeps): Promise<void> {
  const { newSegments, getLatestSegments, generateVideoScript, generateKeywords, locale, onWarn } = deps;
  if (newSegments.length === 0) return;
  const enrichedIds = new Set(newSegments.map(s => s.id));

  try {
    // [2.1] 整篇解说上下文（优先每段 narrationText）。
    const fullScript = buildFullScriptContext([...(getLatestSegments() ?? []), ...newSegments]);

    // [2.2] 逐句任务（过滤空旁白；空旁白句在 [2.6] 直接落 failed，不停留 generating）。
    const jobs = newSegments
      .flatMap(seg => seg.sentences.map(sent => ({
        sentenceId: sent.id,
        narration: (sent.narration ?? sent.text ?? '').trim(),
      })))
      .filter(job => job.narration.length > 0);

    // [2.3]+[2.5] 并行（方案 A，对齐用户「生成解说/视频脚本时异步同时生成关键词」诉求）：
    //   逐句画面脚本生成（慢，N 次 LLM、并发 2）与英文关键词生成【同时启动】，互不阻塞。
    //   关键词不再等画面脚本——它取材旁白原文（newSegments 建卡即有 sentence.text/narration），
    //   先到先用一次独立 ref-safe 写回落地，使关键词在富化早期就位（通常早于 TTS 完成），
    //   消除「关键词被排到逐句脚本之后串行、用户点搜索时几乎必空」的时序根因。
    const scriptBySentence = new Map<string, string>();
    const failedBySentence = new Map<string, string>();

    // [2.3] 逐句并发生成画面脚本（仅填充 maps，写回延后到 [2.6]，不携带关键词）。
    const videoScriptTask = runWithConcurrency(jobs, VIDEO_SCRIPT_CONCURRENCY, async (job) => {
      try {
        const res = await generateVideoScript(job.narration, fullScript, locale);
        if (res.success && res.videoScript.trim()) {
          scriptBySentence.set(job.sentenceId, res.videoScript.trim());
        } else {
          failedBySentence.set(job.sentenceId, res.message || res.code || 'generate failed');
        }
      } catch (err) {
        failedBySentence.set(job.sentenceId, err instanceof Error ? err.message : String(err));
      }
    });

    // [2.5] 关键词生成：取材【旁白原文】（直接喂 newSegments，generateKeywords 读 sentence.text），
    //   与 [2.3] 并行；拿到即用恒等 patchFn 单独写回 keywords（不动句子字段），尽早落到面板。
    //   失败仅 best-effort 告警（点击态兜底为安全网）。
    const keywordTask = (async () => {
      try {
        const keyworded = await generateKeywords(newSegments);
        const keywordsBySegment = new Map(keyworded.map(seg => [seg.id, seg.keywords]));
        mergeAndCommit(
          { getLatestSegments, commitSegments: deps.commitSegments },
          enrichedIds,
          (sent) => sent,
          keywordsBySegment,
        );
      } catch (err) {
        onWarn?.('解说直接生成关键词富化失败，保留空关键词', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    await Promise.all([videoScriptTask, keywordTask]);

    // [2.6] 画面脚本单次写回：成功 → videoScript/succeeded；失败 → failed；空旁白漏网句若仍
    //       generating → failed（不动 text / narration / narrationText）。关键词已在 [2.5] 单独
    //       写回，这里【不再携带 keywords】，避免用过时映射覆盖已落地的关键词（防 clobber）。
    mergeAndCommit({ getLatestSegments, commitSegments: deps.commitSegments }, enrichedIds, (sent) => {
      const ok = scriptBySentence.get(sent.id);
      if (ok) return { ...sent, ...succeededPatch(ok) };
      const errMsg = failedBySentence.get(sent.id);
      if (errMsg !== undefined) {
        return { ...sent, videoScriptStatus: FAILED, videoScriptError: errMsg };
      }
      if (sent.videoScriptStatus === GENERATING) {
        return { ...sent, videoScriptStatus: FAILED, videoScriptError: sent.videoScriptError ?? 'empty narration' };
      }
      return sent;
    });
  } catch (err) {
    onWarn?.('解说直接生成富化异常', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    // [2.7] 收敛：任何仍停留 generating 的句子统一落 failed（早退 / 异常 / 漏网）。
    //       `generating` 必为瞬态（RV-2）。
    mergeAndCommit({ getLatestSegments, commitSegments: deps.commitSegments }, enrichedIds, (sent) =>
      sent.videoScriptStatus === GENERATING
        ? { ...sent, videoScriptStatus: FAILED, videoScriptError: sent.videoScriptError ?? 'generation incomplete' }
        : sent,
    );
  }
}

export interface RegenerateNarrationVideoScriptDeps {
  segmentId: string;
  sentenceId: string;
  getLatestSegments: () => ScriptSegment[];
  commitSegments: (segments: ScriptSegment[]) => void;
  generateVideoScript: GenerateVideoScriptFn;
  locale: 'zh' | 'en';
}

/**
 * 单句「重新生成」AI 视频脚本（卡片「重新生成」按钮触发）。
 * 全程 ref-safe 单句增量 patch（RV-3）：generating → 调端点 → succeeded / failed。
 */
export async function regenerateNarrationVideoScript(deps: RegenerateNarrationVideoScriptDeps): Promise<void> {
  const { segmentId, sentenceId, getLatestSegments, commitSegments, generateVideoScript, locale } = deps;

  const patchOne = (patch: Partial<ScriptSentence>): boolean => {
    const latest = getLatestSegments() ?? [];
    const target = latest.find(seg => seg.id === segmentId);
    if (!target?.sentences.some(s => s.id === sentenceId)) return false;
    const next = latest.map(seg =>
      seg.id === segmentId
        ? { ...seg, sentences: seg.sentences.map(s => (s.id === sentenceId ? { ...s, ...patch } : s)) }
        : seg,
    );
    commitSegments(next);
    return true;
  };

  const latest = getLatestSegments() ?? [];
  const sentence = latest.find(seg => seg.id === segmentId)?.sentences.find(s => s.id === sentenceId);
  if (!sentence) return;

  const narration = (sentence.narration ?? sentence.text ?? '').trim();
  if (!narration) {
    patchOne({ videoScriptStatus: FAILED, videoScriptError: 'empty narration' });
    return;
  }

  patchOne({ videoScriptStatus: GENERATING, videoScriptError: undefined });
  const fullScript = buildFullScriptContext(getLatestSegments() ?? []);
  try {
    const res = await generateVideoScript(narration, fullScript, locale);
    if (res.success && res.videoScript.trim()) {
      patchOne(succeededPatch(res.videoScript.trim()));
    } else {
      patchOne({ videoScriptStatus: FAILED, videoScriptError: res.message || res.code || 'generate failed' });
    }
  } catch (err) {
    patchOne({ videoScriptStatus: FAILED, videoScriptError: err instanceof Error ? err.message : String(err) });
  }
}
