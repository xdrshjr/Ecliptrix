import { describe, expect, it } from 'vitest';
import { projectSentencesOntoClip } from '../sentenceWindow';

function sentence(id: string, start: number, end: number) {
  return { id, start_time: start, end_time: end };
}

function blocks(result: ReturnType<typeof projectSentencesOntoClip<ReturnType<typeof sentence>>>) {
  return result.map(({ sentence: s, leftPct, widthPct }) => ({
    id: s.id,
    leftPct: Number(leftPct.toFixed(6)),
    widthPct: Number(widthPct.toFixed(6)),
  }));
}

describe('projectSentencesOntoClip', () => {
  it('right half of a split shows only in-window sentences starting at 0%', () => {
    // Source [10, 15] of a 15 s recording: only the sentence at 10–12 s is visible.
    const sentences = [sentence('a', 0, 5), sentence('b', 5, 10), sentence('c', 10, 12)];
    expect(blocks(projectSentencesOntoClip(sentences, 10, 5))).toEqual([
      { id: 'c', leftPct: 0, widthPct: 40 },
    ]);
  });

  it('a sentence straddling clipStart is clipped to its visible part', () => {
    const sentences = [sentence('a', 2, 6)];
    expect(blocks(projectSentencesOntoClip(sentences, 4, 4))).toEqual([
      { id: 'a', leftPct: 0, widthPct: 50 },
    ]);
  });

  it('zero duration yields no blocks', () => {
    expect(projectSentencesOntoClip([sentence('a', 0, 2)], 0, 0)).toEqual([]);
  });
});
