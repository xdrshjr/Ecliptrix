/**
 * editor-shell-ui-consolidation W4: the panel toggles live at the left end of
 * the timeline bottom bar; the layout menu opens upwards via a portal.
 */
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import toolbarSource from '../FooterToolbar.tsx?raw';
// @ts-expect-error -- Vite raw source.
import iconsSource from '../icons.tsx?raw';
import {
  compileComponent, compileComponentModule, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import type { FooterToolbarProps } from '../FooterToolbar';

let FooterToolbar: React.FC<FooterToolbarProps>;

beforeAll(() => {
  const shared = { ...reactModules(), ...localeContextModule(() => 'zh-CN') };
  FooterToolbar = compileComponent<FooterToolbarProps>(toolbarSource, {
    ...shared, './icons': compileComponentModule(iconsSource, reactModules()),
  });
});

afterEach(cleanup);

function renderToolbar(overrides: Partial<FooterToolbarProps> = {}) {
  const props: FooterToolbarProps = {
    isScriptOpen: true, isMaterialsOpen: false, isPropertiesOpen: true, isAssistantOpen: false,
    onToggleScript: vi.fn(), onToggleMaterials: vi.fn(), onToggleProperties: vi.fn(),
    onToggleAssistant: vi.fn(), onApplyPreset: vi.fn(), onResetLayout: vi.fn(),
    ...overrides,
  };
  const utils = render(React.createElement(FooterToolbar, props));
  return { props, ...utils };
}

describe('FooterToolbar', () => {
  it('renders_five_buttons_with_pressed_state_mapping', () => {
    const { container } = renderToolbar();
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.ws-footer-btn'));
    expect(buttons).toHaveLength(5);
    expect(buttons.map(button => button.getAttribute('aria-pressed')))
      .toEqual(['true', 'false', 'true', 'false', null]);
    expect(buttons[4].getAttribute('aria-haspopup')).toBe('menu');
    expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
  });

  it('buttons_call_their_toggles', () => {
    const { container, props } = renderToolbar();
    const buttons = container.querySelectorAll<HTMLButtonElement>('.ws-footer-btn');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[2]);
    fireEvent.click(buttons[3]);
    expect([
      props.onToggleScript, props.onToggleMaterials,
      props.onToggleProperties, props.onToggleAssistant,
    ].map(fn => (fn as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1, 1]);
  });

  it('layout_menu_opens_upwards_in_a_portal', () => {
    const { container } = renderToolbar();
    const layoutButton = container.querySelectorAll<HTMLButtonElement>('.ws-footer-btn')[4];
    layoutButton.getBoundingClientRect = () => ({ left: 120, top: 500 } as DOMRect);
    act(() => { fireEvent.click(layoutButton); });
    const menu = screen.getByRole('menu');
    expect(container.contains(menu)).toBe(false);
    expect(menu.getAttribute('data-overlay')).toBe('true');
    expect(menu.style.left).toBe('120px');
    expect(menu.style.bottom).toBe(`${window.innerHeight - 500 + 4}px`);
  });

  it('escape_closes_the_menu_and_restores_focus', () => {
    const { container } = renderToolbar();
    const layoutButton = container.querySelectorAll<HTMLButtonElement>('.ws-footer-btn')[4];
    act(() => { fireEvent.click(layoutButton); });
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(layoutButton).toHaveFocus();
  });

  it('choosing_a_preset_applies_it', () => {
    const { container, props } = renderToolbar();
    act(() => { fireEvent.click(container.querySelectorAll('.ws-footer-btn')[4]); });
    fireEvent.click(screen.getAllByRole('menuitem')[1]);
    expect(props.onApplyPreset).toHaveBeenCalledWith('edit');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('arrow_keys_move_focus_between_buttons', () => {
    const { container } = renderToolbar();
    const buttons = container.querySelectorAll<HTMLButtonElement>('.ws-footer-btn');
    act(() => buttons[0].focus());
    fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
    expect(buttons[1]).toHaveFocus();
    fireEvent.keyDown(buttons[1], { key: 'ArrowLeft' });
    fireEvent.keyDown(buttons[0], { key: 'ArrowLeft' });
    expect(buttons[4]).toHaveFocus();
  });
});
