import { describe, it, expect, vi } from 'vitest';
import { enrichSegmentsWithKeywords } from '../enrichSegmentsWithKeywords';
import type { ScriptSegment } from '@/types';

// 诊断 narration-keywords-lazy-on-video-search-click 方案 A：脚本片段落面板后由此在后台生成英文
// 关键词并 ref-safe 合并回填。此处只验证「合并回填 / 无变化不写 / 竞态删除不写 / 失败不抛」等
// 行为，英文关键词生成本身由注入的 generateKeywords 负责（其单测另有覆盖）。

const makeSegment = (id: string, keywords?: string[]): ScriptSegment => ({
  id,
  title: `title-${id}`,
  sentences: [{ id: `${id}-s1`, text: `text ${id}`, narration: `narration ${id}` }],
  keywords,
});

describe('enrichSegmentsWithKeywords', () => {
  it('merges generated keywords onto matching segments by id, leaving other fields and unrelated segments intact', async () => {
    const commitSegments = vi.fn();
    const generateKeywords = vi.fn(async (segments: ScriptSegment[]) =>
      segments.map(seg => ({ ...seg, keywords: [`${seg.id}-kw1`, `${seg.id}-kw2`] })),
    );

    await enrichSegmentsWithKeywords({
      newSegments: [makeSegment('a'), makeSegment('b')],
      getLatestSegments: () => [makeSegment('a'), makeSegment('b'), makeSegment('c', ['keep'])],
      commitSegments,
      generateKeywords,
    });

    expect(commitSegments).toHaveBeenCalledTimes(1);
    const committed = commitSegments.mock.calls[0][0] as ScriptSegment[];
    expect(committed.find(s => s.id === 'a')?.keywords).toEqual(['a-kw1', 'a-kw2']);
    expect(committed.find(s => s.id === 'b')?.keywords).toEqual(['b-kw1', 'b-kw2']);
    // 未参与富化的 segment 关键词与其它字段保持原样
    expect(committed.find(s => s.id === 'c')?.keywords).toEqual(['keep']);
    expect(committed.find(s => s.id === 'a')?.title).toBe('title-a');
    expect(committed.find(s => s.id === 'a')?.sentences).toHaveLength(1);
  });

  it('is a no-op when there are no new segments', async () => {
    const commitSegments = vi.fn();
    const generateKeywords = vi.fn();

    await enrichSegmentsWithKeywords({
      newSegments: [],
      getLatestSegments: () => [makeSegment('a')],
      commitSegments,
      generateKeywords,
    });

    expect(generateKeywords).not.toHaveBeenCalled();
    expect(commitSegments).not.toHaveBeenCalled();
  });

  it('does not commit when every enriched segment was removed from the latest state (anti-clobber)', async () => {
    const commitSegments = vi.fn();
    const generateKeywords = vi.fn(async (segments: ScriptSegment[]) =>
      segments.map(seg => ({ ...seg, keywords: ['x'] })),
    );

    await enrichSegmentsWithKeywords({
      // 'a' 在关键词生成期间被用户删除/替换，最新状态里已无它
      newSegments: [makeSegment('a')],
      getLatestSegments: () => [makeSegment('z', ['other'])],
      commitSegments,
      generateKeywords,
    });

    expect(commitSegments).not.toHaveBeenCalled();
  });

  it('does not commit when generation yields no keyword change', async () => {
    const commitSegments = vi.fn();
    // 关键词生成失败逐段回原样（keywords 保持 undefined），无实际变化不应触发写回
    const generateKeywords = vi.fn(async (segments: ScriptSegment[]) =>
      segments.map(seg => ({ ...seg })),
    );

    await enrichSegmentsWithKeywords({
      newSegments: [makeSegment('a')],
      getLatestSegments: () => [makeSegment('a')],
      commitSegments,
      generateKeywords,
    });

    expect(commitSegments).not.toHaveBeenCalled();
  });

  it('swallows generation errors, reports via onWarn, and never rejects', async () => {
    const commitSegments = vi.fn();
    const onWarn = vi.fn();
    const generateKeywords = vi.fn(async () => {
      throw new Error('LLM 401');
    });

    await expect(
      enrichSegmentsWithKeywords({
        newSegments: [makeSegment('a')],
        getLatestSegments: () => [makeSegment('a')],
        commitSegments,
        generateKeywords,
        onWarn,
      }),
    ).resolves.toBeUndefined();

    expect(commitSegments).not.toHaveBeenCalled();
    expect(onWarn).toHaveBeenCalledTimes(1);
  });
});
