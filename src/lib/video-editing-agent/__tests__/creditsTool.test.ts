import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialItem, TimelineState } from '@/types';
import type { ToolContext } from '../types';
import {
  createBuildCreditsTool, escapeCell, renderCreditsMarkdown, toCreditRow,
} from '../tools/creditsTool';

function material(id: string, name: string, extra: Partial<MaterialItem['metadata']> = {}): MaterialItem {
  return {
    id, name, type: 'video', format: 'mp4', size: 0, url: `/m/${id}.mp4`,
    createdAt: new Date(0),
    metadata: { source: 'web', ...extra },
  };
}

function context(materials: MaterialItem[], usedIds: string[]): ToolContext {
  const state: TimelineState = {
    currentTime: 0, totalDuration: 10, zoomLevel: 1, selectedItems: [], playbackRate: 1,
    isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
    tracks: [{
      id: 'v1', name: 'v1', type: 'video', height: 80, isLocked: false, isMuted: false,
      isVisible: true, volume: 100, order: 0,
      items: usedIds.map((materialId, index) => ({
        id: `c${index}`, name: materialId, type: 'video' as const, startTime: index * 5,
        duration: 5, trackId: 'v1', color: '#000', volume: 1, materialId,
      })),
    }],
  };
  return {
    timelineState: state, materials, apiBaseUrl: 'http://127.0.0.1:3000', projectId: 'p1',
    operations: new Map(), updateTimeline: () => undefined, recordOperation: () => undefined,
    turnState: {},
  };
}

const PROVENANCE = {
  source_page_url: 'https://example.com/a', final_url: 'https://example.com/a',
  title: 't', author: 'Ann | `x`\nnewline', license_status: 'unknown' as const,
  retrieved_at: '2026-10-27', sha256: 'z',
};

afterEach(() => vi.unstubAllGlobals());

describe('escapeCell', () => {
  it('escapes pipes and backticks, folds newlines and truncates to 200 code points', () => {
    expect(escapeCell('a|b`c\nd')).toBe('a\\|b\\`c d');
    expect(Array.from(escapeCell('x'.repeat(500))).length).toBe(200);
    expect(escapeCell(undefined)).toBe('');
  });
});

describe('credits table', () => {
  it('marks undeclared licences prominently and keeps the disclaimer', () => {
    const row = toCreditRow({
      materialId: 'w1', name: 'clip', provenance: PROVENANCE,
      usages: [{ trackId: 'v1', start: 0, end: 5 }],
    });
    expect(row.license).toContain('未声明');
    expect(row.author).toBe('Ann \\| \\`x\\` newline');
    const markdown = renderCreditsMarkdown([row]);
    expect(markdown).toContain('不构成法律意见');
    expect(markdown.split('\n').filter(line => line.startsWith('| clip')).length).toBe(1);
  });
});

describe('build_credits', () => {
  const workspaceReply = (ok: boolean) => vi.fn(async () => new Response(
    JSON.stringify(ok ? { success: true, data: { name: 'credits.md' } }
      : { success: false, error_code: 'workspace_disabled', message: 'off' }),
    { status: ok ? 200 : 403, headers: { 'content-type': 'application/json' } }));

  it("scope 'used' lists only materials on the timeline", async () => {
    vi.stubGlobal('fetch', workspaceReply(true));
    const materials = [
      material('w1', 'on-timeline', { provenance: PROVENANCE }),
      material('w2', 'library-only', { provenance: PROVENANCE }),
    ];
    const tool = createBuildCreditsTool(context(materials, ['w1']));
    const result = await tool.execute('call-1', {});
    const details = result.details as Record<string, unknown>;
    expect(details.total).toBe(1);
    expect(details.unlicensed).toBe(1);
    expect(details.written).toEqual({ name: 'credits.md' });
  });

  it("scope 'all' also lists library-only web materials", async () => {
    vi.stubGlobal('fetch', workspaceReply(true));
    const materials = [
      material('w1', 'a', { provenance: PROVENANCE }),
      material('w2', 'b', { provenance: PROVENANCE }),
    ];
    const tool = createBuildCreditsTool(context(materials, ['w1']));
    const result = await tool.execute('call-1', { scope: 'all' });
    expect((result.details as { total: number }).total).toBe(2);
  });

  it('degrades without an error when the workspace is disabled', async () => {
    vi.stubGlobal('fetch', workspaceReply(false));
    const tool = createBuildCreditsTool(
      context([material('w1', 'a', { provenance: PROVENANCE })], ['w1']));
    const result = await tool.execute('call-1', {});
    const details = result.details as { success: boolean; written: unknown; note?: string };
    expect(details.success).toBe(true);
    expect(details.written).toBeNull();
    expect(details.note).toContain('工作区未启用');
  });

  it('does not touch the workspace when write_to_workspace is false', async () => {
    const fetchMock = workspaceReply(true);
    vi.stubGlobal('fetch', fetchMock);
    const tool = createBuildCreditsTool(
      context([material('w1', 'a', { provenance: PROVENANCE })], ['w1']));
    await tool.execute('call-1', { write_to_workspace: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports nothing to credit for a local-only timeline', async () => {
    const local: MaterialItem = { ...material('l1', 'local'), metadata: {} };
    const tool = createBuildCreditsTool(context([local], ['l1']));
    const result = await tool.execute('call-1', {});
    expect((result.details as { total: number }).total).toBe(0);
  });
});
