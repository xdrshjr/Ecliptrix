/**
 * AG2-03: get_timeline tells the model what each clip is. Without `kind` an
 * image on a video track looked like a video, and trim_clip then failed with
 * "Images have no source range".
 */
import { describe, it, expect } from 'vitest';
import type { TimelineItem, Track } from '@/types';
import type { ToolContext } from '../types';
import { createGetTimelineTool } from '../tools/getTimeline';

function clip(id: string, trackId: string, extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id, name: id, type: 'video', startTime: 0, duration: 4, trackId, color: '#000',
    clipStart: 0, clipEnd: 4, originalDuration: 10, ...extra,
  };
}

function track(id: string, type: Track['type'], items: TimelineItem[], isVisible = true): Track {
  return {
    id, name: id, type, height: 80, isLocked: false, isMuted: false, isVisible,
    volume: 100, order: 0, items,
  };
}

async function readTimeline(tracks: Track[]) {
  const context: ToolContext = {
    timelineState: {
      currentTime: 0, totalDuration: 10, zoomLevel: 1, selectedItems: [], tracks,
      playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    },
    materials: [],
    apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(),
    updateTimeline: () => undefined,
    recordOperation: () => undefined,
  };
  const result = await createGetTimelineTool(context).execute('tc-1', {});
  const text = (result.content[0] as { text: string }).text;
  return { details: JSON.parse(text) as { tracks: Array<{ id: string; visible: boolean; clips: Array<Record<string, unknown>> }> }, text };
}

describe('get_timeline clip fields', () => {
  it('get_timeline tells image clips from video clips', async () => {
    const { details } = await readTimeline([
      track('v1', 'video', [
        clip('scene', 'v1'),
        clip('photo', 'v1', { startTime: 4, originalMaterialType: 'image' }),
      ]),
    ]);

    expect(details.tracks[0].clips.map(c => [c.id, c.kind])).toEqual([['scene', 'video'], ['photo', 'image']]);
  });

  it('get_timeline returns subtitle text, detached and transition flags', async () => {
    const { details, text } = await readTimeline([
      track('v1', 'video', [
        clip('scene', 'v1', { audioDetached: true, transitionIn: { type: 'fade', duration: 0.5 }, opacity: 0.4 }),
      ]),
      track('s1', 'subtitle', [clip('caption', 's1', { type: 'subtitle', text: 'x'.repeat(250) })], false),
    ]);
    const scene = details.tracks[0].clips[0];
    const caption = details.tracks[1].clips[0];

    expect({
      visible: details.tracks.map(t => t.visible),
      scene: { audioDetached: scene.audioDetached, transitionIn: scene.transitionIn, opacity: scene.opacity },
      captionTextLength: (caption.text as string).length,
      captionHasNoDefaults: !('audioDetached' in caption) && !('opacity' in caption),
      compactJson: !text.includes('\n'),
    }).toEqual({
      visible: [true, false],
      scene: { audioDetached: true, transitionIn: { type: 'fade', duration: 0.5 }, opacity: 0.4 },
      captionTextLength: 200,
      captionHasNoDefaults: true,
      compactJson: true,
    });
  });
});
