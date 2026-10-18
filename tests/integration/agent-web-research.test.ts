/** Deterministic HTTP boundary + real editor operation/undo integration.
 * Real Chromium transport coverage lives in test_research_browser.py.
 */
import { createServer } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { executeWebTool } from '@/lib/video-editing-agent/tools/webToolAdapter';
import { createAddToTrackTool } from '@/lib/video-editing-agent/tools/addToTrack';
import { createDefaultAgentTimelineState } from '@/lib/video-editing-agent/defaultTimeline';
import { OperationApplier } from '@/lib/video-editing-agent/OperationApplier';
import { useVideoEditingStore } from '@/stores';
import type { ToolContext, AgentOperation } from '@/lib/video-editing-agent/types';

let origin = '';
const localUrl = '/api/storage/files/cached_materials/web/fixture.png';
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  const data = request.url?.endsWith('/research')
    ? { brief: '来源支持的中文介绍', facts: [{ text: '资料事实', source_ids: ['source'] }],
      sources: [{ id: 'source', url: 'https://example.org/' }], artifact_id: 'artifact' }
    : { status: 'ready', reused: false, material: { id: 'web-fixture', name: '图片',
      type: 'image', format: 'png', size: 128, width: 320, height: 180,
      local_url: localUrl, created_at: '2026-10-06', provenance: {
        source_page_url: 'https://example.org/?token=FAKE_SECRET',
        final_url: 'https://example.org/a.png', license_status: 'unknown',
      } } };
  response.end(JSON.stringify({ success: true, data }));
});
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture_server_failed');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

it('researches, imports local media, edits a track, then undoes both without affecting other tracks', async () => {
  let timeline = createDefaultAgentTimelineState();
  const before = structuredClone(timeline);
  const operations = new Map<string, AgentOperation>();
  const context = { apiBaseUrl: origin, materials: [], timelineState: structuredClone(timeline),
    operations, recordOperation: (id: string, operation: AgentOperation) => operations.set(id, operation),
    updateTimeline: (id: string, operation: AgentOperation) => operations.set(id, operation),
    researchRun: { headers: async () => ({}), cancelCall: async () => {}, controller: new AbortController() },
  } as unknown as ToolContext;
  const research = await executeWebTool(context, 'research', { path: '/research', body: { topic: '介绍' } });
  expect(research.details.success).toBe(true);
  expect(operations.size).toBe(0);
  await executeWebTool(context, 'download', { path: '/download', body: { kind: 'image' }, importMaterial: true });
  expect(context.materials[0].url).toBe(localUrl);
  expect(JSON.stringify(context.materials)).not.toContain('FAKE_SECRET');
  const applier = new OperationApplier({ getTimelineState: () => timeline,
    setTimelineState: state => { timeline = state; } });
  const download = operations.get('download')!;
  applier.recordNonTimelineOperation(download, 'download');
  useVideoEditingStore.getState().addMaterials(context.materials);
  const added = await createAddToTrackTool(context).execute('track', {
    materialId: 'web-fixture', trackId: 'video-track-1', startTime: 0,
  });
  expect(added.details.success).toBe(true);
  const operation = operations.get('track');
  if (!operation || operation.type !== 'add_clip') throw new Error('expected_add_clip');
  await applier.apply(operation, 'track');
  expect(timeline.tracks[0].items[0].url).toBe(localUrl);
  expect(applier.undoOperation('track')).toEqual({ ok: true });
  expect(applier.undoNonTimelineOperation('download')).toBe(true);
  expect(timeline.tracks).toEqual(before.tracks);
  expect(useVideoEditingStore.getState().materials.some(m => m.id === 'web-fixture')).toBe(false);
});
