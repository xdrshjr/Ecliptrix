/**
 * @vitest-environment node
 *
 * MaterialCacheBadge — structural verification.
 *
 * The project's tsconfig has `jsx: 'preserve'` (Next.js compiles JSX itself
 * via swc), so Vitest cannot mount tsx files containing JSX literals.
 * Following the established pattern in this repo (see layoutFixes.test.tsx)
 * we read the badge source file and assert on the structure that matters
 * for the playback-cache UX:
 *
 *   - all four cache states are rendered
 *   - the failed state is wired to onRetry on click and keyboard
 *   - i18n keys are read from materialsPanel.cacheStatus
 *   - the badge is hidden when status is missing/idle
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BADGE = resolve(__dirname, '..', 'MaterialCacheBadge.tsx');
// The material card moved out of MaterialsPanel into MaterialCard
// (workbench §3.7.1); the badge travels with it.
const PANEL = resolve(
  __dirname,
  '..',
  'MaterialsPanel',
  'MaterialCard.tsx',
);
const I18N = resolve(__dirname, '../../../..', 'lib', 'i18n.ts');

const badgeSrc = readFileSync(BADGE, 'utf-8');
const panelSrc = readFileSync(PANEL, 'utf-8');
const i18nSrc = readFileSync(I18N, 'utf-8');

describe('MaterialCacheBadge source structure', () => {
  it('handles all four cache states (pending/downloading/ready/failed)', () => {
    expect(badgeSrc).toContain("case 'pending':");
    expect(badgeSrc).toContain("case 'downloading':");
    expect(badgeSrc).toContain("case 'ready':");
    expect(badgeSrc).toContain("case 'failed':");
  });

  it('hides itself when status is missing or idle', () => {
    expect(badgeSrc).toContain("if (!status || status === 'idle')");
  });

  it('failed click wires through onRetry(material.id)', () => {
    expect(badgeSrc).toMatch(/onRetry\?\.\(material\.id\)|onRetry\(material\.id\)/);
  });

  it('failed state is keyboard-actionable (Enter / Space)', () => {
    expect(badgeSrc).toContain("e.key === 'Enter'");
    expect(badgeSrc).toContain("e.key === ' '");
  });

  it('reads i18n keys from materialsPanel.cacheStatus', () => {
    expect(badgeSrc).toContain('t.materialsPanel.cacheStatus.pending');
    expect(badgeSrc).toContain('t.materialsPanel.cacheStatus.downloading');
    expect(badgeSrc).toContain('t.materialsPanel.cacheStatus.ready');
    expect(badgeSrc).toContain('t.materialsPanel.cacheStatus.failed');
    expect(badgeSrc).toContain('t.materialsPanel.cacheStatus.retry');
  });

  it('aria-label, role, tabIndex, title are present for accessibility', () => {
    expect(badgeSrc).toContain('aria-label');
    expect(badgeSrc).toContain('role={isFailed');
    expect(badgeSrc).toContain('tabIndex');
  });
});

describe('MaterialCard integration', () => {
  it('imports the badge', () => {
    expect(panelSrc).toContain("import MaterialCacheBadge from '../MaterialCacheBadge'");
  });

  it('renders the badge for video materials with onRetry wired', () => {
    expect(panelSrc).toContain('<MaterialCacheBadge');
    expect(panelSrc).toContain('onRetry={actions.onRetryDownload');
  });
});

describe('i18n cacheStatus keys', () => {
  it('declares the type signature for cacheStatus', () => {
    expect(i18nSrc).toContain('cacheStatus: {');
    expect(i18nSrc).toContain('pending: string;');
    expect(i18nSrc).toContain('downloading: string;');
    expect(i18nSrc).toContain('ready: string;');
    expect(i18nSrc).toContain('failed: string;');
    expect(i18nSrc).toContain('retry: string;');
    expect(i18nSrc).toContain('scrubWaiting: string;');
  });

  it('has Chinese translations', () => {
    expect(i18nSrc).toContain('已加入缓存队列');
    expect(i18nSrc).toContain('正在缓存以保证流畅预览');
    expect(i18nSrc).toContain('已缓存到本地');
    expect(i18nSrc).toContain('缓存失败');
    expect(i18nSrc).toContain('点击重试');
  });

  it('has English translations', () => {
    expect(i18nSrc).toContain('Queued for caching');
    expect(i18nSrc).toContain('Caching for smooth preview');
    expect(i18nSrc).toContain('Cached locally');
    expect(i18nSrc).toContain('Cache failed');
    expect(i18nSrc).toContain('Click to retry');
  });
});
