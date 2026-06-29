/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import { generateKeywordsForSegments, deriveLocalKeywordsFromNarration } from '../useScriptGeneration';
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

// 关键词路径优雅降级（评审 R4 / 第 3 轮）：桌面端 LLM 关键词不可用时，从旁白原文本地派生
// 检索词，保证搜索框永不为空；仅旁白为空时才返回 [] 让调用方弹原报错（真错可见）。
describe('deriveLocalKeywordsFromNarration', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('uses the FAST_LLM translation as the search phrase when available', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      translatedQuery: 'hand drip coffee brewing',
    } as never);

    const keywords = await deriveLocalKeywordsFromNarration('介绍一杯手冲咖啡的制作过程', 'task-1', logger);

    expect(spy.mock.calls[0][0]).toBe('/api/translate-search-query');
    expect(keywords).toEqual(['hand drip coffee brewing']);
  });

  it('degrades to offline narration tokens when the FAST_LLM route fails (desktop 401)', async () => {
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(
      new ApiError(401, 'UNAUTHORIZED', 'invalid_api_key'),
    );

    const keywords = await deriveLocalKeywordsFromNarration('a calm sunrise over the mountains', 'task-2', logger);

    // 译文不可用 → 退化为本地分词，仍返回非空（搜索框永不为空）。
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords).toContain('calm');
  });

  it('falls back to a narration snippet for Chinese text when no latin words exist', async () => {
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({ success: false } as never);

    const keywords = await deriveLocalKeywordsFromNarration('介绍一杯手冲咖啡的制作过程。', 'task-3', logger);

    expect(keywords).toHaveLength(1);
    expect(keywords[0]).toContain('手冲咖啡');
  });

  it('returns [] only when the narration is empty (real error stays visible)', async () => {
    const spy = vi.spyOn(httpModule.http, 'post');

    const keywords = await deriveLocalKeywordsFromNarration('   ', 'task-4', logger);

    expect(keywords).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
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
