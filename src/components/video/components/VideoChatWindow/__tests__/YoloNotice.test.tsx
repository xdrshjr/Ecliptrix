import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';

/**
 * 首次开启 YOLO 的一次性行内说明
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.9.4 / AC-C5）。
 */

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }),
}));

import YoloNotice, {
  YOLO_NOTICE_STORAGE_KEY,
  YOLO_NOTICE_VISIBLE_MS,
} from '../YoloNotice';

const copy = translations['zh-CN'].videoChatWindow;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('YoloNotice', () => {
  it('shows once when YOLO is on and disappears after 8s', () => {
    render(React.createElement(YoloNotice, { yolo: true }));
    expect(screen.getByTestId('yolo-notice').textContent).toContain(copy.yoloNotice);
    act(() => { vi.advanceTimersByTime(YOLO_NOTICE_VISIBLE_MS); });
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
  });

  it('remembers the auto-dismissed notice, so it never comes back', () => {
    // 回归：自动消失也必须落已读标记，否则「首次开启的一次性说明」每次开启都重播。
    render(React.createElement(YoloNotice, { yolo: true }));
    act(() => { vi.advanceTimersByTime(YOLO_NOTICE_VISIBLE_MS); });
    expect(window.localStorage.getItem(YOLO_NOTICE_STORAGE_KEY)).toBe('1');
    cleanup();
    render(React.createElement(YoloNotice, { yolo: true }));
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
  });

  it('stays hidden while YOLO is off', () => {
    render(React.createElement(YoloNotice, { yolo: false }));
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
  });

  it('can be dismissed and remembers that in localStorage', () => {
    render(React.createElement(YoloNotice, { yolo: true }));
    fireEvent.click(screen.getByText(copy.yoloNoticeDismiss));
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
    expect(window.localStorage.getItem(YOLO_NOTICE_STORAGE_KEY)).toBe('1');
    cleanup();
    render(React.createElement(YoloNotice, { yolo: true }));
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
  });
});
