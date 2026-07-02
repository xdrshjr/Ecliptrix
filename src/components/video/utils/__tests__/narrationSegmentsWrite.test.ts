import { describe, it, expect } from 'vitest';
import type { ScriptSegment } from '@/types';
import { resolveNarrationSegmentsWrite } from '../narrationSegmentsWrite';
import { getMockScriptSegments } from '../../data';

function makeSegment(id: string, narration: string): ScriptSegment {
  return {
    id,
    title: id,
    narrationText: narration,
    sentences: [{ id: `${id}-s1`, text: narration, narration }],
  };
}

// 本次生成的逐句新解说（非占位 id）。
const NEW_SEGMENTS: ScriptSegment[] = [
  makeSegment('seg-new-1', '新解说一。'),
  makeSegment('seg-new-2', '新解说二。'),
];

describe('resolveNarrationSegmentsWrite', () => {
  it('append × existing real content → keeps existing then new (existing first)', () => {
    const existing = [makeSegment('seg-real-1', '已有解说。')];
    const result = resolveNarrationSegmentsWrite(existing, NEW_SEGMENTS, 'append');
    expect(result).toHaveLength(existing.length + NEW_SEGMENTS.length);
    expect(result.map((s) => s.id)).toEqual(['seg-real-1', 'seg-new-1', 'seg-new-2']);
  });

  it('append × empty existing → writes only the new segments', () => {
    const result = resolveNarrationSegmentsWrite([], NEW_SEGMENTS, 'append');
    expect(result).toEqual(NEW_SEGMENTS);
  });

  it('append × placeholder existing → writes only the new segments (no placeholder cards left)', () => {
    const placeholder = getMockScriptSegments();
    const result = resolveNarrationSegmentsWrite(placeholder, NEW_SEGMENTS, 'append');
    // 占位守卫：空/占位面板下追加只写本次生成，杜绝残留 segment-1/2/3 脏卡片。
    expect(result).toEqual(NEW_SEGMENTS);
    expect(result.some((s) => s.id.startsWith('segment-'))).toBe(false);
  });

  it('replace × existing real content → discards existing, keeps only the new segments', () => {
    const existing = [
      makeSegment('seg-real-1', '已有解说一。'),
      makeSegment('seg-real-2', '已有解说二。'),
    ];
    const result = resolveNarrationSegmentsWrite(existing, NEW_SEGMENTS, 'replace');
    expect(result).toEqual(NEW_SEGMENTS);
    expect(result).toHaveLength(NEW_SEGMENTS.length);
    expect(result.some((s) => s.id.startsWith('seg-real-'))).toBe(false);
  });

  it('replace × empty or placeholder existing → writes only the new segments', () => {
    expect(resolveNarrationSegmentsWrite([], NEW_SEGMENTS, 'replace')).toEqual(NEW_SEGMENTS);
    expect(resolveNarrationSegmentsWrite(getMockScriptSegments(), NEW_SEGMENTS, 'replace')).toEqual(NEW_SEGMENTS);
  });
});
