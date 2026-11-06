import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';

/**
 * 首次开启 YOLO 的非占位浮层与跨会话可见时长预算。
 * （docs/plans/agent-chat-tabs-and-composer/spec.md §3.3）。
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
  it('pauses while hidden and while hovered, preserving the shared budget', () => {
    const notice = { remainingMs: 8000, dismissed: false };
    const { rerender } = render(<YoloNotice yolo notice={notice} />);
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.mouseEnter(screen.getByTestId('yolo-notice'));
    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getByTestId('yolo-notice')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByTestId('yolo-notice'));
    rerender(<YoloNotice yolo notice={notice} isVisible={false} />);
    act(() => vi.advanceTimersByTime(9000));
    rerender(<YoloNotice yolo notice={notice} />);
    act(() => vi.advanceTimersByTime(5999));
    expect(screen.getByTestId('yolo-notice')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
  });

  it('does not display or consume time when suppressed or too short', () => {
    const notice = { remainingMs: 8000, dismissed: false };
    const { rerender } = render(<YoloNotice yolo notice={notice} suppressed />);
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
    act(() => vi.advanceTimersByTime(9000));
    rerender(<YoloNotice yolo notice={notice} availableHeight={49} />);
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
    rerender(<YoloNotice yolo notice={notice} availableHeight={50} />);
    expect(screen.getByTestId('yolo-notice')).toBeInTheDocument();
    expect(notice.remainingMs).toBe(8000);
  });

  it('Escape closes only the focused notice and restores control focus', () => {
    const restore = vi.fn();
    const outer = vi.fn();
    render(<div onKeyDown={outer}><YoloNotice yolo onRestoreFocus={restore} /></div>);
    const close = screen.getByRole('button', { name: copy.yoloNoticeDismiss });
    act(() => close.focus());
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
  });

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
    fireEvent.click(screen.getByRole('button', { name: copy.yoloNoticeDismiss }));
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
    expect(window.localStorage.getItem(YOLO_NOTICE_STORAGE_KEY)).toBe('1');
    cleanup();
    render(React.createElement(YoloNotice, { yolo: true }));
    expect(screen.queryByTestId('yolo-notice')).toBeNull();
  });
});
