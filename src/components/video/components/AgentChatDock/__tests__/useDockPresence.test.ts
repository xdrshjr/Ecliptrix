import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransitionEvent } from 'react';
import { useDockPresence } from '../useDockPresence';

let reducedMotion = false;
let mediaListener: (() => void) | undefined;

beforeEach(() => {
  reducedMotion = false;
  mediaListener = undefined;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return reducedMotion; },
    addEventListener: (_name: string, listener: () => void) => {
      mediaListener = listener;
    },
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function transition(propertyName = 'transform', child = false) {
  const element = document.createElement('div');
  return {
    currentTarget: element,
    target: child ? document.createElement('span') : element,
    propertyName,
  } as unknown as TransitionEvent<HTMLElement>;
}

describe('浮窗展示阶段', () => {
  it('首开前不挂载，首开后隐藏仍保持挂载', () => {
    const { result, rerender } = renderHook(useDockPresence,
      { initialProps: false });
    expect(result.current.phase).toBe('unmounted');
    rerender(true);
    expect(result.current.phase).toBe('opening');
    expect(result.current.expanded).toBe(false);
    act(() => vi.advanceTimersByTime(40));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.onTransitionEnd(transition()));
    expect(result.current.phase).toBe('open');
    rerender(false);
    expect(result.current.phase).toBe('minimizing');
    expect(result.current.isInteractive).toBe(false);
    act(() => result.current.onTransitionEnd(transition()));
    expect(result.current.phase).toBe('hidden');
    expect(result.current.mounted).toBe(true);
  });

  it('150ms 内开关重开后旧收起事件不能隐藏新面板', () => {
    const { result, rerender } = renderHook(useDockPresence,
      { initialProps: true });
    act(() => vi.advanceTimersByTime(50));
    rerender(false);
    const staleEnd = result.current.onTransitionEnd;
    act(() => vi.advanceTimersByTime(50));
    rerender(true);
    act(() => staleEnd(transition()));
    expect(result.current.phase).toBe('opening');
    act(() => vi.advanceTimersByTime(240));
    expect(result.current.phase).toBe('open');
    expect(result.current.isHidden).toBe(false);
  });

  it('忽略子元素与 opacity transitionend，240ms 兜底到达终态', () => {
    const { result } = renderHook(() => useDockPresence(true));
    act(() => result.current.onTransitionEnd(transition('opacity')));
    act(() => result.current.onTransitionEnd(transition('transform', true)));
    expect(result.current.phase).toBe('opening');
    act(() => vi.advanceTimersByTime(240));
    expect(result.current.phase).toBe('open');
  });

  it('减少动画即时展开和隐藏，动态开启也终止动画', () => {
    reducedMotion = true;
    const { result, rerender } = renderHook(useDockPresence,
      { initialProps: true });
    expect(result.current.phase).toBe('open');
    rerender(false);
    expect(result.current.phase).toBe('hidden');
    act(() => { reducedMotion = false; mediaListener?.(); });
    rerender(true);
    expect(result.current.phase).toBe('opening');
    act(() => { reducedMotion = true; mediaListener?.(); });
    expect(result.current.phase).toBe('open');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resize/拖拽归位取消当前动画及所有排队帧', () => {
    const { result, rerender, unmount } = renderHook(useDockPresence,
      { initialProps: true });
    act(() => result.current.settle());
    expect(result.current.phase).toBe('open');
    expect(vi.getTimerCount()).toBe(0);
    rerender(false);
    act(() => result.current.settle());
    expect(result.current.phase).toBe('hidden');
    rerender(true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
