import { describe, it, expect, vi } from 'vitest';
import type { ScriptSegment } from '@/types';
import {
  enrichNarrationSegments,
  regenerateNarrationVideoScript,
} from '../utils/enrichNarrationSegments';

// 单测：spec narration-direct-video-script-rewrite v2 §8.1。
// 验证富化 util 的真实合并/收敛逻辑：
//  - 关键词请求体 segmentContent 取材【旁白原文】（方案 A：与画面脚本生成并行、建卡即有），
//    而非画面脚本——消除「关键词排在逐句脚本之后串行」的时序根因；
//  - 成功句写 videoScript + 'succeeded'（且同步 aiVideoPrompt）、失败句写 'failed'；
//  - sentence.text / narration / narrationText 全程不变（G3）；
//  - 【RV-2】空旁白 / 异常路径结束后无任何句残留 'generating'；
//  - 【RV-1】字段保全：TTS 时长整批回写、句级编辑 patch 后 videoScript* 不丢；
//  - 单句重试 regenerateNarrationVideoScript：generating → succeeded。

const VISUAL_A = '清晨窄巷，蒸汽自黑铁锅升腾，老师傅俯身挑面，暖黄灯光，特写慢推。';

const noGenerating = (segs: ScriptSegment[]): boolean =>
  segs.every(seg => seg.sentences.every(s => s.videoScriptStatus !== 'generating'));

function makeRef(initial: ScriptSegment[]) {
  let current = initial;
  return {
    getLatestSegments: () => current,
    commitSegments: (segs: ScriptSegment[]) => {
      current = segs;
    },
    get current() {
      return current;
    },
  };
}

describe('enrichNarrationSegments util', () => {
  it('writes the generated video script and feeds the narration (not the video script) to keyword generation [方案A]', async () => {
    const initial: ScriptSegment[] = [
      {
        id: 'seg-a',
        title: 'A',
        narrationText: 'na-旁白',
        sentences: [{ id: 'sa', text: 'na-旁白', narration: 'na-旁白', videoScriptStatus: 'generating' }],
      },
      {
        id: 'seg-b',
        title: 'B',
        narrationText: 'nb-旁白',
        sentences: [{ id: 'sb', text: 'nb-旁白', narration: 'nb-旁白', videoScriptStatus: 'generating' }],
      },
    ];
    const ref = makeRef(initial);

    const generateVideoScript = vi.fn(async (narration: string) => {
      if (narration === 'na-旁白') return { success: true, videoScript: VISUAL_A };
      // seg-b 失败（服务端判退化）
      return { success: false, videoScript: '', code: 'IDENTICAL_OUTPUT', message: 'echoed narration' };
    });

    let keywordInput: ScriptSegment[] | null = null;
    const generateKeywords = vi.fn(async (segs: ScriptSegment[]) => {
      keywordInput = segs;
      return segs.map(seg => ({ ...seg, keywords: ['kw1', 'kw2'] }));
    });

    await enrichNarrationSegments({
      newSegments: initial,
      getLatestSegments: ref.getLatestSegments,
      commitSegments: ref.commitSegments,
      generateVideoScript,
      generateKeywords,
      locale: 'zh',
    });

    const segA = ref.current.find(s => s.id === 'seg-a')!;
    const sa = segA.sentences[0];
    // 成功句：videoScript 写入、succeeded、aiVideoPrompt 同步；旁白 text/narration 不变。
    expect(sa.videoScript).toBe(VISUAL_A);
    expect(sa.videoScriptStatus).toBe('succeeded');
    expect(sa.aiVideoPrompt).toBe(VISUAL_A);
    expect(sa.aiVideoPromptStatus).toBe('succeeded');
    expect(sa.text).toBe('na-旁白');
    expect(sa.narration).toBe('na-旁白');
    expect(segA.narrationText).toBe('na-旁白');
    expect(segA.keywords).toEqual(['kw1', 'kw2']);

    const segB = ref.current.find(s => s.id === 'seg-b')!;
    const sb = segB.sentences[0];
    // 失败句：failed + error，绝不静默回退；text/videoScript 不被改成旁白。
    expect(sb.videoScriptStatus).toBe('failed');
    expect(sb.videoScriptError).toBe('echoed narration');
    expect(sb.videoScript).toBeUndefined();
    expect(sb.text).toBe('nb-旁白');

    // 关键词取材（方案 A）：直接用旁白原文，与画面脚本生成并行、不等也不用画面脚本。
    expect(keywordInput).not.toBeNull();
    const kSegA = keywordInput!.find(s => s.id === 'seg-a')!;
    const kSegB = keywordInput!.find(s => s.id === 'seg-b')!;
    expect(kSegA.sentences[0].text).toBe('na-旁白');
    expect(kSegA.sentences[0].text).not.toBe(VISUAL_A); // 不再取材画面脚本
    expect(kSegB.sentences[0].text).toBe('nb-旁白');

    // 无悬挂态。
    expect(noGenerating(ref.current)).toBe(true);
  });

  it('drops an empty-narration sentence to failed (no hanging generating) [RV-2]', async () => {
    const initial: ScriptSegment[] = [
      {
        id: 'seg-c',
        title: 'C',
        narrationText: '',
        sentences: [{ id: 'sc', text: '', narration: '', videoScriptStatus: 'generating' }],
      },
    ];
    const ref = makeRef(initial);
    const generateVideoScript = vi.fn(async () => ({ success: true, videoScript: VISUAL_A }));
    const generateKeywords = vi.fn(async (segs: ScriptSegment[]) => segs);

    await enrichNarrationSegments({
      newSegments: initial,
      getLatestSegments: ref.getLatestSegments,
      commitSegments: ref.commitSegments,
      generateVideoScript,
      generateKeywords,
      locale: 'zh',
    });

    // 空旁白句从未发起生成，但必须收敛为 failed（不停留 generating）。
    expect(generateVideoScript).not.toHaveBeenCalled();
    expect(ref.current[0].sentences[0].videoScriptStatus).toBe('failed');
    expect(noGenerating(ref.current)).toBe(true);
  });

  it('marks a thrown per-sentence generation as failed [RV-2]', async () => {
    const initial: ScriptSegment[] = [
      {
        id: 'seg-d',
        title: 'D',
        narrationText: 'nd',
        sentences: [{ id: 'sd', text: 'nd', narration: 'nd', videoScriptStatus: 'generating' }],
      },
    ];
    const ref = makeRef(initial);
    const generateVideoScript = vi.fn(async () => {
      throw new Error('network down');
    });
    const generateKeywords = vi.fn(async (segs: ScriptSegment[]) => segs);

    await enrichNarrationSegments({
      newSegments: initial,
      getLatestSegments: ref.getLatestSegments,
      commitSegments: ref.commitSegments,
      generateVideoScript,
      generateKeywords,
      locale: 'zh',
    });

    expect(ref.current[0].sentences[0].videoScriptStatus).toBe('failed');
    expect(noGenerating(ref.current)).toBe(true);
  });

  it('finally converges leftover generating sentences even if the merge write throws [RV-2]', async () => {
    const initial: ScriptSegment[] = [
      {
        id: 'seg-e',
        title: 'E',
        narrationText: 'ne',
        sentences: [{ id: 'se', text: 'ne', narration: 'ne', videoScriptStatus: 'generating' }],
      },
    ];
    let current = initial;
    let commitCalls = 0;
    const commitSegments = (segs: ScriptSegment[]) => {
      commitCalls += 1;
      if (commitCalls === 1) throw new Error('commit boom'); // [2.6] 写回抛错 → 跳到 finally
      current = segs;
    };
    const generateVideoScript = vi.fn(async () => ({ success: true, videoScript: VISUAL_A }));
    const generateKeywords = vi.fn(async (segs: ScriptSegment[]) => segs);

    await enrichNarrationSegments({
      newSegments: initial,
      getLatestSegments: () => current,
      commitSegments,
      generateVideoScript,
      generateKeywords,
      locale: 'zh',
    });

    // [2.6] 写回抛错后，finally 的收敛写把残留 generating 落为 failed。
    expect(commitCalls).toBeGreaterThanOrEqual(2);
    expect(current[0].sentences[0].videoScriptStatus).toBe('failed');
    expect(noGenerating(current)).toBe(true);
  });

  it('keeps videoScript* across a TTS-style batch writeback and a sentence edit patch [RV-1]', async () => {
    const initial: ScriptSegment[] = [
      {
        id: 'seg-a',
        title: 'A',
        narrationText: 'na',
        sentences: [{ id: 'sa', text: 'na', narration: 'na', videoScriptStatus: 'generating' }],
      },
    ];
    const ref = makeRef(initial);
    await enrichNarrationSegments({
      newSegments: initial,
      getLatestSegments: ref.getLatestSegments,
      commitSegments: ref.commitSegments,
      generateVideoScript: async () => ({ success: true, videoScript: VISUAL_A }),
      generateKeywords: async (segs: ScriptSegment[]) => segs.map(s => ({ ...s, keywords: ['kw'] })),
      locale: 'zh',
    });
    expect(ref.current[0].sentences[0].videoScript).toBe(VISUAL_A);

    // 模拟 TTS 时长整批回写（段级 spread，句子按引用透传）。
    const afterTts = ref.current.map(seg => (seg.id === 'seg-a' ? { ...seg, duration: 3.2 } : seg));
    expect(afterTts[0].sentences[0].videoScript).toBe(VISUAL_A);
    expect(afterTts[0].sentences[0].videoScriptStatus).toBe('succeeded');

    // 模拟句级编辑 patch（`{...sentence, text}`）——videoScript 不被丢。
    const afterEdit = afterTts.map(seg => ({
      ...seg,
      sentences: seg.sentences.map(s => (s.id === 'sa' ? { ...s, text: '改过的旁白' } : s)),
    }));
    expect(afterEdit[0].sentences[0].videoScript).toBe(VISUAL_A);
    expect(afterEdit[0].sentences[0].videoScriptStatus).toBe('succeeded');
  });

  it('regenerateNarrationVideoScript: failed → generating → succeeded for one sentence', async () => {
    const initial: ScriptSegment[] = [
      {
        id: 'seg-a',
        title: 'A',
        narrationText: 'na',
        sentences: [{ id: 'sa', text: 'na', narration: 'na', videoScriptStatus: 'failed', videoScriptError: 'x' }],
      },
    ];
    const ref = makeRef(initial);
    const statuses: Array<string | undefined> = [];
    const commitSegments = (segs: ScriptSegment[]) => {
      ref.commitSegments(segs);
      statuses.push(segs[0].sentences[0].videoScriptStatus);
    };

    await regenerateNarrationVideoScript({
      segmentId: 'seg-a',
      sentenceId: 'sa',
      getLatestSegments: ref.getLatestSegments,
      commitSegments,
      generateVideoScript: async () => ({ success: true, videoScript: 'RETRIED-VISUAL' }),
      locale: 'zh',
    });

    // 先置 generating，再落 succeeded。
    expect(statuses).toContain('generating');
    const sa = ref.current[0].sentences[0];
    expect(sa.videoScriptStatus).toBe('succeeded');
    expect(sa.videoScript).toBe('RETRIED-VISUAL');
    expect(sa.aiVideoPrompt).toBe('RETRIED-VISUAL');
    expect(sa.text).toBe('na'); // 旁白不变
  });
});
