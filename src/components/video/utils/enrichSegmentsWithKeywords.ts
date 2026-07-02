/**
 * 通用「后台英文关键词富化」（诊断 narration-keywords-lazy-on-video-search-click 方案 A）。
 *
 * 任一脚本生成链路（视频理解 / 转换消息为脚本 / 标准配置）产出片段一经落面板，即由此在后台
 * 异步为其生成 2–3 个英文检索关键词并 ref-safe 合并回填，使关键词在用户点「搜索在线视频」之前
 * 就位，消除「点击按钮才现场生成关键词」的割裂交互。
 *
 * 与「解说直接生成」链路（enrichNarrationSegments 的 [2.5] 段）同源，只做关键词一件事：
 * 关键词取材片段旁白/文本、失败由注入的 generateKeywords 内部本地兜底、回填走「读最新 ref →
 * 按 id 只改 keywords → 单次写回」，与 TTS/时长/删除等并发写入互不覆盖（防 clobber）。
 * generateKeywords 与写回路径由调用方注入，以复用 VideoEditingInterface 的
 * scriptSegmentsRef + commitNarrationSegments ref-safe 写回（评审 §8.3 硬约束）。
 */

import type { ScriptSegment } from '@/types';

export type GenerateKeywordsFn = (segments: ScriptSegment[]) => Promise<ScriptSegment[]>;

export interface EnrichSegmentsWithKeywordsDeps {
  /** 本轮新落面板的脚本片段（关键词恒空，待后台富化）。 */
  newSegments: ScriptSegment[];
  /** 读取最新 scriptSegments（即 scriptSegmentsRef.current），杜绝闭包陈旧。 */
  getLatestSegments: () => ScriptSegment[];
  /** ref-safe 写回：实现方须「先前移 ref 再 onUpdateSegments」。 */
  commitSegments: (segments: ScriptSegment[]) => void;
  /** 英文关键词端点（含本地兜底），取材传入 segments 的旁白 / 文本。 */
  generateKeywords: GenerateKeywordsFn;
  /** 可选告警回调（仅记录，不影响流程）。 */
  onWarn?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * 后台英文关键词富化：为 newSegments 生成英文关键词，拿到后按 id 单次 ref-safe 合并写回。
 * 失败仅 best-effort 告警（片段保留空关键词，点击态懒生成作为最后安全网），绝不抛出中断上层。
 */
export async function enrichSegmentsWithKeywords(deps: EnrichSegmentsWithKeywordsDeps): Promise<void> {
  const { newSegments, getLatestSegments, commitSegments, generateKeywords, onWarn } = deps;
  if (newSegments.length === 0) return;
  const enrichedIds = new Set(newSegments.map(s => s.id));

  try {
    const keyworded = await generateKeywords(newSegments);
    const keywordsBySegment = new Map(keyworded.map(seg => [seg.id, seg.keywords]));

    // ref-safe 单次合并写回：读最新 segments，只改命中 segment 的 keywords（不动句子字段），
    // 无实际变化则不写（避免多余重渲染）。全被删除 / 替换 → 不写。
    const latest = getLatestSegments() ?? [];
    if (!latest.some(seg => enrichedIds.has(seg.id))) return;
    let changed = false;
    const merged = latest.map(seg => {
      if (!enrichedIds.has(seg.id)) return seg;
      const kw = keywordsBySegment.get(seg.id);
      if (kw === undefined || kw === seg.keywords) return seg;
      changed = true;
      return { ...seg, keywords: kw };
    });
    if (changed) commitSegments(merged);
  } catch (err) {
    onWarn?.('脚本关键词后台富化失败，保留空关键词（点击态兜底为安全网）', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
