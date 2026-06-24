/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import { generateKeywordsForSegments } from '../useScriptGeneration';
import { VideoEditingLogger } from '../../utils';
import { ScriptSegment } from '@/types';

// 单测：spec narration-direct-ai-video-script-keywords v2 §8.1。
// 验证 options.language 透传进 POST body（评审 R-2）、缺省不带 language（防回归 R-4）、
// 失败降级返回原 segment（保留既有语义）。

const logger = new VideoEditingLogger({ taskId: 'test', component: 'test' });

const makeSegment = (overrides?: Partial<ScriptSegment>): ScriptSegment => ({
  id: 'seg-1',
  title: '段落一',
  sentences: [{ id: 's-1', text: '画面：辽阔的山脉在晨光中铺展' }],
  ...overrides,
});

describe('generateKeywordsForSegments', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('forwards options.language="english" into the POST body', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      keywords: ['mountain landscape'],
    } as never);

    await generateKeywordsForSegments([makeSegment()], 'task-1', logger, {
      language: 'english',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/script-keywords-generation');
    expect(spy.mock.calls[0][1]).toMatchObject({
      segmentTitle: '段落一',
      taskId: 'task-1',
      language: 'english',
    });
    // 取材为 sentence.text 拼接（即「AI 视频脚本」）。
    expect((spy.mock.calls[0][1] as { segmentContent: string }).segmentContent).toContain(
      '辽阔的山脉',
    );
  });

  it('omits language from the body when no options are given (no regression)', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      keywords: ['商务办公'],
    } as never);

    await generateKeywordsForSegments([makeSegment()], 'task-2', logger);

    const body = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('language');
  });

  it('returns the original segment (no keywords) when the request throws', async () => {
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(
      new ApiError(500, 'INTERNAL', 'keyword service down'),
    );

    const input = makeSegment();
    const result = await generateKeywordsForSegments([input], 'task-3', logger, {
      language: 'english',
    });

    expect(result).toHaveLength(1);
    expect(result[0].keywords).toBeUndefined();
    expect(result[0].id).toBe(input.id);
  });

  it('returns the original segment when the response is unsuccessful / invalid', async () => {
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: false,
    } as never);

    const result = await generateKeywordsForSegments([makeSegment()], 'task-4', logger, {
      language: 'english',
    });

    expect(result[0].keywords).toBeUndefined();
  });
});

describe('ScriptPanel lazy search keywords', () => {
  const file = resolve(__dirname, '..', '..', 'ScriptPanel.tsx');
  const src = readFileSync(file, 'utf-8');
  const importBlock = src.slice(0, src.indexOf('interface ScriptPanelProps'));
  const openSearchStart = src.indexOf('const handleOpenVideoSearch = useCallback');
  expect(openSearchStart).toBeGreaterThan(-1);
  const openSearchEnd = src.indexOf('const handleVideoNavigation = useCallback', openSearchStart);
  expect(openSearchEnd).toBeGreaterThan(openSearchStart);
  const handleOpenVideoSearch = src.slice(openSearchStart, openSearchEnd);

  it('imports the shared keyword generator for search-open fallback', () => {
    expect(importBlock).toMatch(/generateKeywordsForSegments/);
    expect(importBlock).toMatch(/\.\/hooks\/useScriptGeneration/);
  });

  it('generates English keywords before opening search when the segment has none', () => {
    expect(handleOpenVideoSearch).toMatch(/generateKeywordsForSegments\(/);
    expect(handleOpenVideoSearch).toMatch(/language:\s*'english'/);
    expect(handleOpenVideoSearch).toMatch(/onUpdateSegments\(/);
    expect(handleOpenVideoSearch).toMatch(/openSearchModal\(\s*generatedKeywords\s*\)/);
  });

  it('guards duplicate lazy-generation clicks for the same segment', () => {
    expect(src).toMatch(/keywordGenerationPromisesRef\s*=\s*useRef/);
    expect(handleOpenVideoSearch).toMatch(/keywordGenerationPromisesRef\.current\.get\(segmentId\)/);
    expect(handleOpenVideoSearch).toMatch(/keywordGenerationPromisesRef\.current\.set\(segmentId/);
  });

  it('reuses keywords written by background enrichment before starting lazy generation', () => {
    expect(handleOpenVideoSearch).toMatch(/freshKeywords/);
    expect(handleOpenVideoSearch).toMatch(/return freshKeywords/);
  });
});
