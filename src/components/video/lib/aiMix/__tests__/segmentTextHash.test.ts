import { describe, it, expect } from 'vitest';
import { segmentTextHash } from '../segmentTextHash';

const sentences = [
  { id: 's1', text: '城市清晨的街道。' },
  { id: 's2', text: '人群开始忙碌。' },
];

describe('segmentTextHash', () => {
  it('hashes narration text when present and sentences otherwise', () => {
    const narrated = segmentTextHash({ narrationText: '清晨的城市苏醒了。', sentences });
    const sameNarrationOtherShots = segmentTextHash({
      narrationText: '清晨的城市苏醒了。',
      sentences: [{ id: 's1', text: '完全不同的画面描述。' }],
    });
    const sentencesOnly = segmentTextHash({ sentences });

    expect({
      narrationIgnoresShotText: narrated === sameNarrationOtherShots,
      sentencesDifferFromNarration: sentencesOnly !== narrated,
      stable: sentencesOnly === segmentTextHash({ sentences: [...sentences] }),
      format: /^[0-9a-f]{8}$/.test(narrated),
    }).toEqual({
      narrationIgnoresShotText: true,
      sentencesDifferFromNarration: true,
      stable: true,
      format: true,
    });
  });

  it('the hash changes when one word changes', () => {
    expect(segmentTextHash({ narrationText: 'The city wakes up.', sentences }))
      .not.toBe(segmentTextHash({ narrationText: 'The town wakes up.', sentences }));
  });

  it('hashes what the TTS request reads, so spacing between sentences does not matter', () => {
    // convertScriptSegmentToSentenceRequest splits narration after sentence
    // punctuation and trims each sentence; the voice-over is identical.
    expect(segmentTextHash({ narrationText: 'First line.   Second line.', sentences }))
      .toBe(segmentTextHash({ narrationText: 'First line.Second line.', sentences }));
  });
});
