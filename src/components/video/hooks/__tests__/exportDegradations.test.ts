import { describe, expect, it } from 'vitest';
import type { CompositionDegradation } from '@/lib/api/videoComposition';
import type { Translations } from '@/lib/i18n';
import {
  formatDegradationMessage,
  formatNameList,
  mergeDegradations,
} from '../exportDegradations';

const t = {
  videoExport: {
    degradedTitle: 'Export finished, but some content is missing from the video:',
    degradedImageOverlay: 'Images not rendered: {names}',
    degradedSubtitles: "Subtitles couldn't be burned into the video",
    degradedAudioItem: 'Audio not mixed in: {names}',
    degradedEmbeddedAudio: 'Original video sound not mixed in: {names}',
    moreItems: 'and {count} more',
  },
} as unknown as Translations;

function degradation(
  kind: CompositionDegradation['kind'],
  ids: string[],
  names: string[] = ids,
): CompositionDegradation {
  return { kind, item_ids: ids, item_names: names, reason: 'ffmpeg: No such file or directory' };
}

describe('exportDegradations', () => {
  it('formats image overlay degradations with at most three names', () => {
    const message = formatDegradationMessage(
      [degradation('image_overlay', ['a', 'b', 'c', 'd', 'e'], ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'])],
      t,
      'en',
    );
    expect(message).toBe(
      'Export finished, but some content is missing from the video:\n' +
        'Images not rendered: a.png, b.png, c.png and 2 more',
    );
  });

  it('merges the same degradation reported across polls', () => {
    const first = mergeDegradations([], [degradation('audio_item', ['a1'])]);
    const second = mergeDegradations(first, [
      degradation('audio_item', ['a1']),
      degradation('subtitles', []),
    ]);
    expect(second.map((entry) => entry.kind)).toEqual(['audio_item', 'subtitles']);
  });

  it('returns null when nothing degraded', () => {
    expect(formatDegradationMessage([], t)).toBeNull();
    expect(mergeDegradations([], undefined)).toEqual([]);
  });

  it('never puts the backend reason into the notice', () => {
    const message = formatDegradationMessage([degradation('subtitles', [])], t) ?? '';
    expect(message).not.toContain('ffmpeg');
    expect(message).toContain("Subtitles couldn't be burned into the video");
  });

  it('uses the Chinese list separator for zh-CN', () => {
    expect(formatNameList(['甲', '乙'], t, 'zh-CN')).toBe('甲、乙');
  });
});
