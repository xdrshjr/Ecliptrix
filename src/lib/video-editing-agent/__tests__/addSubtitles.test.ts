import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineState, TimelineItem, Track } from '@/types';
import type { ToolContext } from '../types';
import { createAddSubtitlesTool } from '../tools/addSubtitles';
import { createTrimClipTool } from '../tools/trimClip';
import { applySubtitleClipsToState } from '../subtitleClips';
import { DEFAULT_AGENT_SUBTITLE_STYLE } from '../subtitleClips';

/**
 * `add_subtitles` 工具本体（agent-subtitles spec §6.1 / §8 / §9.1）。
 *
 * 每个错误码至少一例；成功路径钉住 `lineBudget`/`assumedFrame`/`overflowWarnings`
 * 与「据回执决定 success」（P0-2）。所有断言都用 `resolves`——工具**不抛异常**（D-8）。
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function subtitleItem(id: string, text: string, start: number, duration = 1): TimelineItem {
  return {
    id, name: text, type: 'subtitle', startTime: start, duration,
    trackId: 'subtitle-track-1', color: '#E67E22', text,
    subtitleStyle: DEFAULT_AGENT_SUBTITLE_STYLE,
  };
}

function track(id: string, type: Track['type'], items: TimelineItem[] = []): Track {
  return {
    id, name: id, type, height: type === 'subtitle' ? 50 : 80, isLocked: false,
    isMuted: false, isVisible: true, volume: 100, order: 0, items,
  };
}

function makeState(tracks: Track[] = []): TimelineState {
  return {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, selectedItems: [], tracks,
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
}

interface Harness {
  context: ToolContext;
  recorded: Array<{ toolCallId: string; operation: unknown }>;
}

/** `updateTimeline` 默认走真实纯函数，与 `agent.ts` 的本地副本同一实现。 */
function makeContext(
  state = makeState([track('v1', 'video', [subtitleItem('v', '', 0, 4)])]),
  updateTimeline?: ToolContext['updateTimeline'],
): Harness {
  const recorded: Harness['recorded'] = [];
  const context: ToolContext = {
    timelineState: state,
    materials: [],
    apiBaseUrl: 'http://127.0.0.1:3088',
    projectId: 'proj-1',
    operations: new Map(),
    updateTimeline: updateTimeline ?? ((toolCallId, operation) => {
      recorded.push({ toolCallId, operation });
      applySubtitleClipsToState(context.timelineState, operation as never);
      return { applied: true };
    }),
    recordOperation: () => undefined,
    turnState: {},
    callBudget: { used: 0 },
  };
  return { context, recorded };
}

function run(context: ToolContext, toolCallId: string, params: unknown) {
  const tool = createAddSubtitlesTool(context);
  return tool.execute(toolCallId, params as never, undefined as never, undefined as never);
}

function details(result: { details?: unknown }): Record<string, unknown> {
  return result.details as Record<string, unknown>;
}

const TWO_CUES = [
  { text: '家人们谁懂啊！', startTime: 0, duration: 2 },
  { text: '这货叫会走路的宝石', startTime: 2, duration: 2 },
];

describe('add_subtitles success paths', () => {
  it('writes cues from the cues[] source and reports the line budget', async () => {
    const { context, recorded } = makeContext();
    const result = await run(context, 'call-1', { cues: TWO_CUES });
    const body = details(result);

    expect(body).toMatchObject({
      success: true,
      trackId: 'subtitle-track-1',
      mode: 'append',
      addedCount: 2,
      updatedCount: 0,
      removedCount: 0,
      lineBudget: 30,
      assumedFrame: '16:9',
      cuesOmitted: 0,
    });
    expect(recorded).toHaveLength(1);
    expect(context.timelineState.tracks[1].items.map(item => item.text))
      .toEqual(['家人们谁懂啊！', '这货叫会走路的宝石']);
    // 确定性 id（D-10）
    expect(context.timelineState.tracks[1].items[0].id).toBe('subtitle-call-1-0');
  });

  it('parses the srt source', async () => {
    const { context } = makeContext();
    const srt = '1\n00:00:00,000 --> 00:00:02,000\n第一句\n\n2\n00:00:02,000 --> 00:00:04,000\n第二句\n';
    const body = details(await run(context, 'call-2', { srt }));
    expect(body).toMatchObject({ success: true, addedCount: 2 });
  });

  it('reads the srt_workspace_path source with the raw (untruncated) channel', async () => {
    const srt = '1\n00:00:00,000 --> 00:00:02,000\n工作区字幕\n';
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        name: 'subtitle/yorkie.srt', content: srt, next_offset: null,
        total_bytes: Buffer.byteLength(srt), truncated: false,
      },
    }));
    const { context } = makeContext();
    const body = details(await run(context, 'call-3', {
      srt_workspace_path: 'subtitle/yorkie.srt',
    }));

    expect(body).toMatchObject({ success: true, addedCount: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/agent-toolkit/workspace/read');
    expect(String(url)).toContain('max_bytes=8000');
    expect((init.headers as Record<string, string>)['x-tool-call-id'])
      .toBe('call-3-srt-0');
  });

  it('computes the line budget from the requested frame (D-13 / AC-11)', async () => {
    const { context } = makeContext();
    const body = details(await run(context, 'call-4', {
      cues: [{ text: '竖屏一句二十个中文字符会溢出', startTime: 0, duration: 1 }],
      aspect_ratio: '9:16',
    }));
    expect(body).toMatchObject({ success: true, lineBudget: 16, assumedFrame: '9:16' });
    expect(body.overflowWarnings).toEqual([]);
  });

  it('warns only past three lines', async () => {
    const fits = details(await run(makeContext().context, 'call-5', {
      cues: [{ text: '字'.repeat(90), startTime: 0, duration: 1 }],
    }));
    expect(fits.overflowWarnings).toEqual([]);

    const overflows = details(await run(makeContext().context, 'call-6', {
      cues: [{ text: '字'.repeat(100), startTime: 0, duration: 1 }],
    }));
    expect(overflows.overflowWarnings).toEqual([
      expect.objectContaining({ index: 0, lines: 4, lineBudget: 30 }),
    ]);
  });

  it('warns when the subtitle track outgrows the video track (V11)', async () => {
    const { context } = makeContext();
    const body = details(await run(context, 'call-7', {
      cues: [{ text: '很晚的字幕', startTime: 30, duration: 2 }],
    }));
    expect(body.warning).toContain('subtitle');
  });

  it('replaces the whole track and reports how many cues were removed', async () => {
    const existing = track('subtitle-track-1', 'subtitle', [
      subtitleItem('old-1', '旧一', 0), subtitleItem('old-2', '旧二', 1),
    ]);
    const { context } = makeContext(makeState([track('v1', 'video'), existing]));
    const body = details(await run(context, 'call-8', {
      cues: [{ text: '全新一句', startTime: 0, duration: 1 }], mode: 'replace',
    }));
    expect(body).toMatchObject({ success: true, mode: 'replace', removedCount: 2 });
    expect(context.timelineState.tracks[1].items.map(item => item.text))
      .toEqual(['全新一句']);
  });

  it('counts a replayed call as an update, not a second cue (D-15 / AC-12)', async () => {
    const { context } = makeContext();
    await run(context, 'call-9', { cues: TWO_CUES });
    const body = details(await run(context, 'call-9', { cues: TWO_CUES }));
    expect(body).toMatchObject({ addedCount: 0, updatedCount: 2 });
    expect(context.timelineState.tracks[1].items).toHaveLength(2);
  });
});

describe('add_subtitles refusals', () => {
  async function expectRefusal(params: unknown, code: string, state?: TimelineState) {
    const { context, recorded } = makeContext(state);
    const result = await run(context, 'call-x', params);
    const body = details(result);
    expect(body).toMatchObject({
      success: false, error_code: code,
      error_details: { failure_class: 'validation' },
    });
    expect(typeof body.next_step).toBe('string');
    expect(recorded).toHaveLength(0);
    return body;
  }

  it('requires exactly one source', async () => {
    await expectRefusal({}, 'subtitle_source_missing');
    await expectRefusal({ cues: TWO_CUES, srt: 'x' }, 'subtitle_source_ambiguous');
  });

  it('caps a single call at 120 cues', async () => {
    const cues = Array.from({ length: 121 }, (_, index) => ({
      text: `第${index}句`, startTime: index * 2, duration: 1.5,
    }));
    const body = await expectRefusal({ cues }, 'subtitle_too_many_cues');
    expect(body.count).toBe(121);
  });

  it('refuses empty or oversized text', async () => {
    const empty = await expectRefusal(
      { cues: [{ text: '   ', startTime: 0, duration: 1 }] }, 'subtitle_text_invalid',
    );
    expect(empty.index).toBe(0);
    await expectRefusal(
      { cues: [{ text: 'x'.repeat(201), startTime: 0, duration: 1 }] },
      'subtitle_text_invalid',
    );
  });

  it('refuses a non-positive duration or negative start', async () => {
    await expectRefusal(
      { cues: [{ text: '字', startTime: 0, duration: 0 }] }, 'subtitle_time_invalid',
    );
    await expectRefusal(
      { cues: [{ text: '字', startTime: -1, duration: 2 }] }, 'subtitle_time_invalid',
    );
  });

  it('refuses overlapping cues and names both indices', async () => {
    const body = await expectRefusal({
      cues: [
        { text: '前一句', startTime: 0, duration: 2 },
        { text: '后一句', startTime: 1, duration: 2 },
      ],
    }, 'subtitle_cues_overlap');
    expect(body).toMatchObject({ index: 1, previousIndex: 0 });
  });

  it('refuses a cue that collides with an existing subtitle on append', async () => {
    const existing = track('subtitle-track-1', 'subtitle', [subtitleItem('old', '旧字幕', 0, 3)]);
    const body = await expectRefusal(
      { cues: [{ text: '新字幕', startTime: 1, duration: 2 }] },
      'subtitle_conflicts_existing',
      makeState([track('v1', 'video'), existing]),
    );
    expect(body).toMatchObject({ existingIndex: 0, existingText: '旧字幕' });
  });

  it('refuses an illegal style and an unknown aspect ratio', async () => {
    await expectRefusal(
      { cues: TWO_CUES, style: { fontSize: 300 } }, 'subtitle_style_invalid',
    );
    await expectRefusal(
      { cues: TWO_CUES, aspect_ratio: '3:2' }, 'subtitle_aspect_invalid',
    );
  });

  it('reports a broken SRT with its line number', async () => {
    const body = await expectRefusal({ srt: '1\n00:00:00,000 --> 00:00:01,000\nok\n\n乱块\n' },
      'subtitle_parse_failed');
    expect(body.line).toBe(5);
  });

  it('refuses an oversized inline srt', async () => {
    await expectRefusal({ srt: 'x'.repeat(20_001) }, 'subtitle_source_too_large');
  });

  it('refuses a locked subtitle track and a non-subtitle trackId', async () => {
    const locked = { ...track('subtitle-track-1', 'subtitle'), isLocked: true };
    await expectRefusal({ cues: TWO_CUES }, 'subtitle_track_locked',
      makeState([track('v1', 'video'), locked]));
    await expectRefusal({ cues: TWO_CUES, trackId: 'v1' }, 'subtitle_track_wrong_type');
  });

  it('refuses to push a track past 1000 cues', async () => {
    const full = track('subtitle-track-1', 'subtitle', Array.from(
      { length: 1000 }, (_, index) => subtitleItem(`old-${index}`, 'x', index * 2, 1),
    ));
    await expectRefusal(
      { cues: [{ text: '多出来的一句', startTime: 5000, duration: 1 }] },
      'subtitle_track_full',
      makeState([track('v1', 'video'), full]),
    );
  });

  it('reports subtitle_apply_refused (never success) when the local copy refuses (P0-2)', async () => {
    const { context } = makeContext(makeState([track('v1', 'video')]), () => ({
      applied: false, reason: 'invalid-time',
    }));
    const body = details(await run(context, 'call-refused', { cues: TWO_CUES }));
    expect(body).toMatchObject({
      success: false,
      error_code: 'subtitle_apply_refused',
      reason: 'invalid-time',
    });
    expect(context.timelineState.tracks).toHaveLength(1);
  });
});

describe('trim_clip refuses subtitles (D-12)', () => {
  it('points the model at resize_clip instead', async () => {
    const item = subtitleItem('s1', '一句字幕', 0, 2);
    const { context } = makeContext(makeState([
      track('v1', 'video'), track('subtitle-track-1', 'subtitle', [item]),
    ]));
    const result = await createTrimClipTool(context)
      .execute('tc-trim', { clipId: 's1' } as never, undefined as never, undefined as never);
    expect(details(result)).toMatchObject({ success: false });
    expect(String(details(result).error)).toContain('resize_clip');
  });
});
