/**
 * CanvasMenu — 「画布 16:9 ▾」 dropdown (segment-centric-editor-workbench §3.6).
 *
 * Rendered for real through the shared `?raw` + compileComponent loader
 * (tsconfig keeps JSX as `preserve`).
 */

import * as React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import menuSource from '../CanvasMenu.tsx?raw';
import {
  compileComponent, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import { getTranslations } from '@/lib/i18n';
import { buildAspectRatios, type AspectRatio } from '../aspectRatios';
import type { CanvasMenuProps } from '../CanvasMenu';

const t = getTranslations('zh-CN');
const RATIOS: AspectRatio[] = buildAspectRatios(t.videoPlayerPanel.aspectRatios);
let CanvasMenu: React.FC<CanvasMenuProps>;

beforeAll(() => {
  CanvasMenu = compileComponent<CanvasMenuProps>(menuSource, {
    ...reactModules(),
    ...localeContextModule(() => 'zh-CN'),
  });
});

afterEach(cleanup);

function renderMenu(overrides: Partial<CanvasMenuProps> = {}) {
  const onSelect = vi.fn();
  render(React.createElement(CanvasMenu, {
    aspectRatios: RATIOS, selectedId: '16:9', onSelect,
    videoCount: 3, audioCount: 2, ...overrides,
  }));
  fireEvent.click(screen.getByRole('button', { name: /^画布 / }));
  return { onSelect };
}

describe('CanvasMenu', () => {
  it('selecting_ratio_calls_controlled_handler', () => {
    const { onSelect } = renderMenu();
    fireEvent.click(screen.getByRole('radio', { name: /9:16/ }));
    expect(onSelect).toHaveBeenCalledWith(RATIOS[1]);
  });

  it('marks_only_the_controlled_ratio_checked', () => {
    renderMenu({ selectedId: '4:3' });
    const checked = screen.getAllByRole('radio').filter((radio) => radio.getAttribute('aria-checked') === 'true');
    expect(checked.map((radio) => radio.textContent)).toEqual([expect.stringContaining('4:3')]);
  });

  it('arrow_key_selects_next_ratio', () => {
    const { onSelect } = renderMenu();
    fireEvent.keyDown(screen.getByRole('radio', { name: /16:9/ }), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith(RATIOS[1]);
  });

  it('cover_slot_rendered', () => {
    renderMenu({ coverSlot: React.createElement('button', { type: 'button' }, '封面…') });
    expect(screen.getByRole('button', { name: '封面…' })).toBeTruthy();
  });

  it('shows_read_only_counts_and_ratio_note', () => {
    renderMenu();
    expect(screen.getByTestId('canvas-menu-counts').textContent).toBe('视频 3 · 音频 2');
    expect(screen.getByText(t.workbench.canvas.ratioNote)).toBeTruthy();
  });

  it('escape_closes_and_restores_focus', () => {
    renderMenu();
    fireEvent.keyDown(screen.getByRole('radio', { name: /16:9/ }), { key: 'Escape' });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /画布 16:9/ }));
  });

  it('escape_on_closed_trigger_is_left_to_the_editor', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: /画布 16:9/ });
    fireEvent.click(trigger);
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    window.removeEventListener('keydown', onWindowKeyDown);
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1);
    expect(onWindowKeyDown.mock.calls[0][0].defaultPrevented).toBe(false);
  });

  it('click_outside_closes', () => {
    renderMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});
