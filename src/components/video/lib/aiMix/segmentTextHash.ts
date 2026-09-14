/**
 * segmentTextHash — fingerprint of what a script segment's voice-over says
 * (RV-07).
 *
 * Agent-generated segment ids are positional (`agent-segment-0`) and survive
 * a regenerated script, so a voice-over's `segment_id` alone cannot tell
 * whether it still matches its segment. ScriptPanel stamps this hash on every
 * TTS material; auto-mix compares it with the current segment and treats a
 * mismatch as a stale voice-over.
 *
 * The hash covers exactly the sentence texts
 * `convertScriptSegmentToSentenceRequest` sends to TTS (the narration split
 * into sentences when present, else the shot sentences). Reusing the request
 * builder keeps the two from drifting apart, and edits TTS never reads — shot
 * text under a narration, spacing between sentences — do not mark the
 * voice-over stale.
 */

import { convertScriptSegmentToSentenceRequest } from '@/lib/api/tts';
import type { ScriptSegment } from '@/types';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** Keeps ['ab', 'c'] and ['a', 'bc'] apart. */
const SENTENCE_SEPARATOR = '\n';

/** FNV-1a 32-bit over UTF-16 code units, as 8 hex digits. */
function fnv1a32(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function segmentTextHash(
  segment: Pick<ScriptSegment, 'narrationText' | 'sentences'>,
): string {
  const request = convertScriptSegmentToSentenceRequest(
    { id: '', title: '', narrationText: segment.narrationText, sentences: segment.sentences },
    '',
  );
  return fnv1a32(request.sentences.map((sentence) => sentence.text).join(SENTENCE_SEPARATOR));
}
