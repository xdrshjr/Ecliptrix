import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { YoloToggleProps } from '../YoloToggle';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }),
}));
import YoloToggle from '../YoloToggle';

/**
 * YOLO 开关的五种状态与无障碍
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.9.3 / AC-C1）。
 */

const copy = translations['zh-CN'].videoChatWindow;

function renderToggle(patch: Partial<YoloToggleProps> = {}) {
  const onYoloChange = vi.fn();
  render(React.createElement(YoloToggle, {
    yolo: false, yoloReady: true, agentMode: true, agentIsExecuting: false,
    onYoloChange, ...patch,
  }));
  return { onYoloChange };
}

const toggleButton = () => screen.getByRole('switch') as HTMLButtonElement;

afterEach(() => cleanup());

describe('YoloToggle', () => {
  it('renders a switch whose state follows the value and title', () => {
    renderToggle({ yolo: false });
    expect(toggleButton().getAttribute('aria-checked')).toBe('false');
    expect(toggleButton().getAttribute('title')).toBe(copy.yoloTitleOff);
    expect(screen.getByText(copy.yoloToggleLabel)).toBeTruthy();
    cleanup();
    renderToggle({ yolo: true });
    expect(toggleButton().getAttribute('aria-checked')).toBe('true');
    expect(toggleButton().getAttribute('title')).toBe(copy.yoloTitleOn);
  });

  it('is enabled and reports the new value on click / keyboard', () => {
    const { onYoloChange } = renderToggle({ yolo: false });
    fireEvent.click(toggleButton());
    expect(onYoloChange).toHaveBeenCalledWith(true);
    fireEvent.keyDown(toggleButton(), { key: 'Enter' });
    fireEvent.keyUp(toggleButton(), { key: 'Enter' });
    fireEvent.click(toggleButton());
    expect(onYoloChange).toHaveBeenCalledTimes(2);
  });

  it('is disabled with a reason when Agent mode is off (S3)', () => {
    renderToggle({ agentMode: false });
    expect(toggleButton().disabled).toBe(true);
    expect(toggleButton().getAttribute('title')).toBe(copy.yoloTitleNeedsAgent);
  });

  it('is disabled while the agent is running (S4)', () => {
    renderToggle({ agentIsExecuting: true });
    expect(toggleButton().disabled).toBe(true);
    expect(toggleButton().getAttribute('title')).toBe(copy.yoloTitleBusy);
  });

  it('is disabled and marked busy until the preference is loaded (P2-02)', () => {
    const { onYoloChange } = renderToggle({ yoloReady: false });
    expect(toggleButton().disabled).toBe(true);
    expect(toggleButton().getAttribute('aria-busy')).toBe('true');
    expect(toggleButton().getAttribute('title')).toBe(copy.yoloTitleLoading);
    fireEvent.click(toggleButton());
    expect(onYoloChange).not.toHaveBeenCalled();
  });

  it('describes itself for screen readers and does not rely on colour alone', () => {
    renderToggle({ yolo: true });
    const described = toggleButton().getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described!)?.textContent).toBe(copy.yoloTitleOn);
    expect(toggleButton().getAttribute('aria-label'))
      .toContain(copy.yoloToggleLabel);
  });
});
