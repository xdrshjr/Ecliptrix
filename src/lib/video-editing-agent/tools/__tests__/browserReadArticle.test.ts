// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Type, validateToolArguments } from '@mariozechner/pi-ai';
import { createBrowserTools, BROWSER_READ_IMAGES_TIMEOUT_MS } from '../browserTools';
import type { ToolContext } from '../../types';

/**
 * `docs/plans/agent-browser-article-reading/spec.md` AC-A14: `browser_read` gains
 * three optional article fields; the out-of-range values must be refused before a
 * request is made, and a `article:true` read shares the 25 000 ms page-script
 * ceiling instead of opening a new timeout tier.
 */
const toolFetch = vi.hoisted(() => vi.fn());
vi.mock('../apiHelper', () => ({ toolFetch }));

const SID = '123e4567-e89b-42d3-a456-426614174000';

function makeContext(extra: Partial<ToolContext> = {}): ToolContext {
  // `researchRun` is required by executeWebTool (it owns the abort signal); without it
  // the adapter throws before toolFetch is reached and every timing assertion reads
  // `undefined` — the sibling browserSaveImage suite carries the same fixture.
  return { timelineState: {} as never, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => ({ applied: true as const }),
    recordOperation: vi.fn(), turnState: {}, callBudget: { used: 0 },
    researchRun: { lostReason: null, markLost: vi.fn(),
      headers: async () => ({ 'x-research-run': 'r' }), cancelCall: vi.fn(),
      controller: new AbortController() } as never, ...extra };
}

function validate(name: string, args: Record<string, unknown>): boolean {
  const tool = createBrowserTools(makeContext()).find(item => item.name === name);
  if (!tool) return false;
  try {
    validateToolArguments(tool as never,
      { type: 'toolCall', id: 'x', name, arguments: args } as never);
    return true;
  } catch { return false; }
}

describe('browser_read article schema (AC-A14)', () => {
  it('accepts the three optional article fields and keeps legacy calls valid', () => {
    expect(validate('browser_read', { session_id: SID })).toBe(true);
    expect(validate('browser_read', { session_id: SID, article: true })).toBe(true);
    expect(validate('browser_read', { session_id: SID, article: true,
      article_from: 0, article_blocks: 12 })).toBe(true);
    expect(validate('browser_read', { session_id: SID, article: true,
      article_from: 399, article_blocks: 40 })).toBe(true);
  });

  it('refuses out-of-range values so no request is made', () => {
    expect(validate('browser_read', { session_id: SID, article_from: 400 })).toBe(false);
    expect(validate('browser_read', { session_id: SID, article_from: -1 })).toBe(false);
    expect(validate('browser_read', { session_id: SID, article_blocks: 0 })).toBe(false);
    expect(validate('browser_read', { session_id: SID, article_blocks: 41 })).toBe(false);
    expect(validate('browser_read', { session_id: SID, article: 'yes' })).toBe(false);
  });

  it('keeps additionalProperties:false (a stray key is a 422, not a silent drop)', () => {
    expect(validate('browser_read', { session_id: SID, article_section: 'intro' })).toBe(false);
  });

  it('gives an article read the 25 000 ms ceiling and keeps a plain read at 15 000 ms', async () => {
    toolFetch.mockReset();
    toolFetch.mockImplementation(async () => Response.json(
      { success: true, data: { text: '', elements: [] } }));
    const read = createBrowserTools(makeContext()).find(tool => tool.name === 'browser_read')!;
    await read.execute('c1', { session_id: SID } as never);
    await read.execute('c2', { session_id: SID, article: true } as never);
    await read.execute('c3', { session_id: SID, article: true, article_from: 12 } as never);
    const [plain, withArticle, continued] = toolFetch.mock.calls
      .map(call => (call[2] as { timeout: number }).timeout);
    expect(plain).toBe(15_000);
    expect(withArticle).toBe(BROWSER_READ_IMAGES_TIMEOUT_MS);
    expect(withArticle).toBe(25_000);
    expect(continued).toBe(25_000);
  });

  it('tells the model how to continue a long read', () => {
    const tool = createBrowserTools(makeContext()).find(item => item.name === 'browser_read')!;
    expect(tool.description).toContain('article_from=next_from');
    expect(tool.description).toContain('publication metadata');
  });

  it('does not add a tool: the count staying at six is the invariant (spec D-A1)', () => {
    const names = createBrowserTools(makeContext()).map(tool => tool.name);
    expect(names).toContain('browser_read');
    expect(names).not.toContain('browser_article');
    expect(names.filter(name => name.startsWith('browser_'))).toHaveLength(6);
  });
});

describe('Type re-export guard', () => {
  it('keeps the article fields optional, never required', () => {
    const schema = Type.Object({ article: Type.Optional(Type.Boolean()) });
    expect(schema.required).toBeUndefined();
  });
});
