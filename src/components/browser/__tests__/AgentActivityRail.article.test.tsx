/**
 * AgentActivityRail 的正文条目（agent-browser-article-reading §4.8 / AC-A12）：
 * 有发布时间显示「Published …」，缺失时显示「No publication time stated」（两种都渲染，
 * 不隐藏），条目带 tabId 时可点击跳转到该标签页。
 *
 * 断言用英文：`LocaleProvider` 的 `defaultLocale` 是 `'en'`（i18n.ts），除非测试先写入
 * `ecliptrix-locale`，否则渲染出来的就是英文文案。
 */
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentActivityRail, { formatPublished } from '../AgentActivityRail';
import { LocaleProvider } from '@/contexts/LocaleContext';
import type { BrowserActivityEntry } from '@/types/browserWorkspace';

afterEach(() => { cleanup(); });

const OPEN_TAB = 'Show this page in the browser';

const entry = (patch: Partial<BrowserActivityEntry> = {}): BrowserActivityEntry => ({
  id: 'a1', ts: 1000, kind: 'article', label: 'Water levels fall', status: 'ok', durationMs: 420,
  tabId: 'tab-7',
  articleMeta: { title: 'Water levels fall', site: 'x.test',
    publishedAt: '2026-11-26T08:30:00Z', totalBlocks: 41, chars: 3120 },
  ...patch,
});

function renderRail(entries: BrowserActivityEntry[], onOpenTab?: (id: string) => void) {
  return render(
    <LocaleProvider>
      <AgentActivityRail entries={entries} onOpenTab={onOpenTab} />
    </LocaleProvider>,
  );
}

describe('AgentActivityRail article rows (AC-A12)', () => {
  it('shows the publication time when the page declared one', () => {
    renderRail([entry()]);
    const row = document.querySelector('[data-kind="article"]')!;
    expect(row.textContent).toContain('Water levels fall');
    expect(row.textContent).toContain('x.test');
    expect(row.textContent).toContain('Published');
    expect(row.textContent).not.toContain('No publication time stated');
  });

  it('states the missing publication time instead of hiding the row', () => {
    // 用户有权知道来源没给这个信息，所以缺失态必须显式渲染（spec §4.8）。
    renderRail([entry({ articleMeta: { title: 'x', site: 'y.test', publishedAt: null,
      totalBlocks: 3, chars: 90 } })]);
    const row = document.querySelector('[data-kind="article"]')!;
    expect(row.textContent).toContain('No publication time stated');
    expect(row.textContent).toContain('y.test');
  });

  it('opens the tab the article came from when the row is clicked', () => {
    const onOpenTab = vi.fn();
    renderRail([entry()], onOpenTab);
    fireEvent.click(screen.getByRole('button', { name: OPEN_TAB }));
    expect(onOpenTab).toHaveBeenCalledWith('tab-7');
  });

  it('renders an article row without a tab id as plain text (no dead button)', () => {
    renderRail([entry({ tabId: undefined })]);
    expect(screen.queryByRole('button', { name: OPEN_TAB })).toBeNull();
  });

  it('keeps every other activity kind on the single-line renderer', () => {
    renderRail([entry({ id: 'b1', kind: 'read', label: 'Reading page', tabId: undefined,
      articleMeta: undefined })]);
    expect(document.querySelector('[data-kind="article"]')).toBeNull();
    expect(document.body.textContent).toContain('Reading page');
  });

  it('formats an ISO stamp locally and degrades gracefully on garbage input', () => {
    expect(formatPublished('2026-11-26T08:30:00Z')).toMatch(/^2026-11-2\d \d{2}:\d{2}$/);
    expect(formatPublished('yesterday')).toBe('yesterday');
  });
});
