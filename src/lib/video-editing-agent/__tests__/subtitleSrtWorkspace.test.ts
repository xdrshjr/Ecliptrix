import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineState, Track } from '@/types';
import type { ToolContext } from '../types';
import { createAddSubtitlesTool } from '../tools/addSubtitles';

/**
 * 工作区 SRT 分页读取（agent-subtitles spec §6.5 / P0-1 / RK-11）。
 *
 * 这一条是 P0-1 的证据用例：`executeToolkitTool` 会把结果压到 12 KiB，并把任何
 * > 1200 字符的字符串字段截成 1200 字符 + `…`；SRT 一被截断，cue 数与时间就全错，
 * 而工具仍会回 `success:true`。所以这里用一个**两页**的文件（> 8 KB）逐字节比对
 * 拼回来的文本，并显式断言每页内容都超过 1200 字符（即没有被裁剪）。
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

/** 生成一份约 9 KB 的 SRT（100 条 cue），确保跨两页、每页都远超 1200 字符。 */
function bigSrt(): string {
  const blocks: string[] = [];
  const stamp = (totalSeconds: number) => {
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `00:${minutes}:${seconds},000`;
  };
  for (let index = 0; index < 100; index += 1) {
    const start = index * 2;
    blocks.push(`${index + 1}\n${stamp(start)} --> ${stamp(start + 2)}\n`
      + `Subtitle line number ${index} carries enough text to make the file big\n`);
  }
  return `${blocks.join('\n')}`;
}

/** 按 URL 里的 offset / max_bytes 切页，模拟 `workspace_store.read_page`。 */
function servePages(body: string) {
  const bytes = Buffer.from(body, 'utf8');
  return (url: string) => {
    const query = new URL(url, 'http://localhost').searchParams;
    const offset = Number(query.get('offset'));
    const maxBytes = Number(query.get('max_bytes'));
    const end = Math.min(bytes.length, offset + maxBytes);
    return jsonResponse({
      success: true,
      data: {
        name: 'subtitle/big.srt',
        content: bytes.subarray(offset, end).toString('utf8'),
        next_offset: end < bytes.length ? end : null,
        total_bytes: bytes.length,
        truncated: end < bytes.length,
      },
    });
  };
}

function subtitleTrack(): Track {
  return {
    id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false,
    isMuted: false, isVisible: true, volume: 100, order: 0,
    items: [{ id: 'v', name: 'v', type: 'video', startTime: 0, duration: 4, trackId: 'v1', color: '#000' }],
  };
}

function makeContext(): { context: ToolContext; operations: Array<Record<string, unknown>> } {
  const timelineState: TimelineState = {
    currentTime: 0, totalDuration: 4, zoomLevel: 1, selectedItems: [],
    tracks: [subtitleTrack()], playbackRate: 1, isPlaying: false,
    snapToGrid: false, gridSize: 1, scrollLeft: 0,
  };
  const operations: Array<Record<string, unknown>> = [];
  const context: ToolContext = {
    timelineState, materials: [], apiBaseUrl: 'http://127.0.0.1:3088',
    projectId: 'proj-1', operations: new Map(),
    updateTimeline: (_toolCallId, operation) => {
      operations.push(operation as unknown as Record<string, unknown>);
      return { applied: true };
    },
    recordOperation: () => undefined, turnState: {}, callBudget: { used: 0 },
  };
  return { context, operations };
}

function run(context: ToolContext, toolCallId: string, params: unknown) {
  return createAddSubtitlesTool(context)
    .execute(toolCallId, params as never, undefined as never, undefined as never);
}

describe('srt_workspace_path paging', () => {
  it('reads a > 8 KB SRT in two pages and loses no byte', async () => {
    const body = bigSrt();
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(8_000);
    const serve = servePages(body);
    fetchMock.mockImplementation((url: string) => Promise.resolve(serve(url)));

    const { context, operations } = makeContext();
    const result = await run(context, 'call-ws', {
      srt_workspace_path: 'subtitle/big.srt',
    });

    expect(result.details).toMatchObject({ success: true, addedCount: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 逐条比对：拼接后的文本必须与原文一字不差（截断会少 cue 或错文本）。
    const clips = operations[0].clips as Array<{ text: string; startTime: number }>;
    expect(clips).toHaveLength(100);
    expect(clips.map(clip => clip.text)).toEqual(
      Array.from({ length: 100 },
        (_, index) => `Subtitle line number ${index} carries enough text to make the file big`),
    );
    expect(clips.map(clip => clip.startTime)).toEqual(
      Array.from({ length: 100 }, (_, index) => index * 2),
    );
    // 每页都超过 1200 字符：旧通道会把这些内容截成 1200 字符 + `…`。
    for (const call of fetchMock.mock.calls) {
      const query = new URL(call[0], 'http://x').searchParams;
      expect(query.get('max_bytes')).toBe('8000');
    }
  });

  it('treats next_offset === null as EOF', async () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\n单页\n';
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        name: 'a.srt', content: srt, next_offset: null,
        total_bytes: Buffer.byteLength(srt), truncated: false,
      },
    }));
    const result = await run(makeContext().context, 'call-eof', { srt_workspace_path: 'a.srt' });
    expect(result.details).toMatchObject({ success: true, addedCount: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a page that claims more content but carries no next_offset', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        name: 'a.srt', content: 'x', total_bytes: 9_000, truncated: true,
      },
    }));
    const result = await run(makeContext().context, 'call-no-offset', {
      srt_workspace_path: 'a.srt',
    });
    // 半份 SRT 会被解析成「少了一半字幕」，工具却回 success —— 正是 P0-1 的形态。
    expect(result.details).toMatchObject({
      success: false, error_code: 'invalid_offset',
    });
  });

  it('refuses a file past 64 KB after a single request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: {
        name: 'huge.srt', content: 'x'.repeat(4000), next_offset: 4000,
        total_bytes: 65 * 1024, truncated: true,
      },
    }));
    const result = await run(makeContext().context, 'call-huge', { srt_workspace_path: 'huge.srt' });
    expect(result.details).toMatchObject({
      success: false, error_code: 'subtitle_workspace_too_large',
      total_bytes: 65 * 1024,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes invalid_offset through instead of inventing a second error code', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: false,
      error_code: 'invalid_offset',
      message: 'offset is not on a UTF-8 boundary',
      error_details: { next_step: 'Use the next_offset the previous page returned.' },
    }, 400));

    const result = await run(makeContext().context, 'call-offset', { srt_workspace_path: 'a.srt' });
    expect(result.details).toMatchObject({
      success: false,
      error_code: 'invalid_offset',
      next_step: 'Use the next_offset the previous page returned.',
    });
  });

  it('reports a missing workspace file with the toolkit code', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: false, error_code: 'workspace_not_found', message: 'nope',
    }, 404));
    const result = await run(makeContext().context, 'call-404', { srt_workspace_path: 'nope.srt' });
    expect(result.details).toMatchObject({
      success: false, error_code: 'workspace_not_found',
    });
    expect(String((result.details as { next_step: string }).next_step)).toContain('workspace_list');
  });
});
