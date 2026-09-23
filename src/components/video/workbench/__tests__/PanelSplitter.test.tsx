import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import splitterSource from '../PanelSplitter.tsx?raw';
import { compileComponent, reactModules } from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import type { PanelSplitterProps } from '../PanelSplitter';

let PanelSplitter: React.FC<PanelSplitterProps>;

beforeAll(() => {
  PanelSplitter = compileComponent<PanelSplitterProps>(splitterSource, reactModules());
});

afterEach(() => {
  cleanup();
  document.body.classList.remove('ws-resizing');
});

beforeAll(() => {
  // jsdom has no pointer capture.
  HTMLElement.prototype.setPointerCapture = () => {};
});

function renderSplitter(patch: Partial<PanelSplitterProps> = {}) {
  const props: PanelSplitterProps = {
    id: 'left', orientation: 'vertical', direction: 1, value: 320, min: 280, max: 480,
    onPreview: vi.fn(), onCommit: vi.fn(), onReset: vi.fn(),
    ariaLabel: 'Resize the script panel', controlsId: 'ws-region-script', ...patch,
  };
  const view = render(React.createElement(PanelSplitter, props));
  return { props, separator: screen.getByRole('separator'), unmount: view.unmount };
}

describe('PanelSplitter', () => {
  it('arrow_keys_step_16px', () => {
    const { props, separator } = renderSplitter();
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(props.onCommit).toHaveBeenCalledWith(336);
  });

  it('shift_arrow_steps_64px', () => {
    const { props, separator } = renderSplitter();
    fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true });
    expect(props.onCommit).toHaveBeenCalledWith(280); // 320 - 64 clamped to min
  });

  it('reversed_direction_grows_right_panel_on_arrow_left', () => {
    const { props, separator } = renderSplitter({ id: 'right', direction: -1, value: 300, max: 440 });
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(props.onCommit).toHaveBeenCalledWith(316);
  });

  it('double_click_resets', () => {
    const { props, separator } = renderSplitter();
    fireEvent.doubleClick(separator);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('exposes_separator_aria_values', () => {
    const { separator } = renderSplitter();
    expect([
      separator.getAttribute('aria-valuenow'), separator.getAttribute('aria-valuemin'),
      separator.getAttribute('aria-valuemax'), separator.getAttribute('aria-controls'),
      separator.getAttribute('aria-orientation'),
    ]).toEqual(['320', '280', '480', 'ws-region-script', 'vertical']);
  });

  it('click_without_drag_does_not_commit', () => {
    const { props, separator } = renderSplitter();
    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 100 });
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it('unmount_mid_drag_releases_resize_cursor', () => {
    const { separator, unmount } = renderSplitter();
    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 100 });
    unmount();
    expect(document.body.classList.contains('ws-resizing')).toBe(false);
  });
});
