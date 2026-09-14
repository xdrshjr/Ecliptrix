/**
 * sentenceWindow — project a recording's sentence timings onto a clip.
 *
 * Sentence timings are absolute positions in the SOURCE recording, while a
 * clip shows only `[clipStart, clipStart + duration]` of it (after a split or
 * a trim). Each visible part is placed relative to the clip's own window.
 */

export interface ProjectedSentence<S> {
  sentence: S;
  /** Left edge as a percentage of the clip width. */
  leftPct: number;
  /** Visible width as a percentage of the clip width. */
  widthPct: number;
}

/** A sliver under a millisecond is not worth a block (it would render 0 px). */
const MIN_VISIBLE_SECONDS = 1e-3;

export function projectSentencesOntoClip<S extends { start_time: number; end_time: number }>(
  sentences: readonly S[],
  clipStart: number,
  duration: number,
): ProjectedSentence<S>[] {
  if (!(duration > 0)) return [];
  const windowEnd = clipStart + duration;
  const projected: ProjectedSentence<S>[] = [];
  for (const sentence of sentences) {
    const visibleStart = Math.max(sentence.start_time, clipStart);
    const visibleEnd = Math.min(sentence.end_time, windowEnd);
    if (visibleEnd - visibleStart <= MIN_VISIBLE_SECONDS) continue;
    projected.push({
      sentence,
      leftPct: ((visibleStart - clipStart) / duration) * 100,
      widthPct: ((visibleEnd - visibleStart) / duration) * 100,
    });
  }
  return projected;
}
