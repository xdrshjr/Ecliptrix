import { describe, it, expect } from 'vitest';
import { ScriptSegment } from '@/types';
import {
  getMockScriptSegments,
  isPlaceholderScript,
  PLACEHOLDER_SEGMENT_IDS,
} from '../mockScriptSegments';

// 回归测试：解说直接生成「首次替换 / 后续追加」语义的判定基石。
// 见 docs/diagnoses/narration-direct-script-first-gen-append-instead-of-replace/analysis.md
// （方案 A：占位识别 + 首次替换；§3.6 占位 id 唯一性安全证明）。

describe('isPlaceholderScript', () => {
  it('treats the system placeholder script (zh-CN) as placeholder', () => {
    expect(isPlaceholderScript(getMockScriptSegments('zh-CN'))).toBe(true);
  });

  it('treats the system placeholder script (en) as placeholder — id is locale-independent', () => {
    expect(isPlaceholderScript(getMockScriptSegments('en'))).toBe(true);
  });

  it('returns false for an empty list (handled by the explicit length===0 branch)', () => {
    expect(isPlaceholderScript([])).toBe(false);
  });

  it('still recognises the placeholder after a sentence text edit (segment id unchanged)', () => {
    const edited = getMockScriptSegments('zh-CN').map(segment => ({
      ...segment,
      sentences: segment.sentences.map((sentence, i) =>
        i === 0 ? { ...sentence, text: '用户改过的一句话' } : sentence),
    }));
    expect(isPlaceholderScript(edited)).toBe(true);
  });

  it('still recognises the placeholder after the user deletes some placeholder segments (subset)', () => {
    const partial = getMockScriptSegments('zh-CN').slice(0, 1);
    expect(isPlaceholderScript(partial)).toBe(true);
  });

  it('returns false for real agent-generated script segments', () => {
    const real: ScriptSegment[] = [
      { id: 'agent-segment-0', title: '真实段落 0', sentences: [] },
      { id: 'agent-segment-1', title: '真实段落 1', sentences: [] },
    ];
    expect(isPlaceholderScript(real)).toBe(false);
  });

  it('returns false for narration-direct generated segments (seg-<uuid>)', () => {
    const real: ScriptSegment[] = [
      { id: 'seg-abc-123', title: '解说段', sentences: [] },
    ];
    expect(isPlaceholderScript(real)).toBe(false);
  });

  it('returns false when real segments are mixed with placeholder ones (never deletes real content)', () => {
    const mixed: ScriptSegment[] = [
      ...getMockScriptSegments('zh-CN'),
      { id: 'seg-real-1', title: '真实解说', sentences: [] },
    ];
    expect(isPlaceholderScript(mixed)).toBe(false);
  });
});

describe('PLACEHOLDER_SEGMENT_IDS', () => {
  it('is derived from getMockScriptSegments (single source of truth)', () => {
    expect(Array.from(PLACEHOLDER_SEGMENT_IDS).sort()).toEqual(
      getMockScriptSegments().map(s => s.id).sort()
    );
  });

  it('contains exactly the fixed placeholder ids segment-1/2/3', () => {
    expect(Array.from(PLACEHOLDER_SEGMENT_IDS).sort()).toEqual(['segment-1', 'segment-2', 'segment-3']);
  });
});
