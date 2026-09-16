'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { TransitionEvent } from 'react';

export type DockPhase =
  'unmounted' | 'opening' | 'open' | 'minimizing' | 'hidden';

interface PresenceState {
  phase: DockPhase;
  expanded: boolean;
  generation: number;
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 展示状态独立于会话；已挂载内容只隐藏，不因最小化卸载。 */
// 阶段转换和清理集中在此 hook，避免拆分后旧定时器失去 generation 保护。
export function useDockPresence(isOpen: boolean) {
  const generationRef = useRef(0);
  const intentionRef = useRef(isOpen);
  const cancelRef = useRef<() => void>(() => {});
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [state, setState] = useState<PresenceState>({
    phase: isOpen ? 'opening' : 'unmounted',
    expanded: false, generation: 0,
  });
  intentionRef.current = isOpen;

  useLayoutEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const finish = useCallback((generation: number) => {
    if (generation !== generationRef.current) return;
    cancelRef.current();
    setState((previous) => ({
      phase: intentionRef.current ? 'open' :
        previous.phase === 'unmounted' ? 'unmounted' : 'hidden',
      expanded: intentionRef.current,
      generation,
    }));
  }, []);

  useLayoutEffect(() => {
    const generation = ++generationRef.current;
    const frames: number[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    cancelRef.current = () => {
      frames.forEach(cancelAnimationFrame);
      clearTimeout(timer);
    };
    setState((previous) => ({
      phase: reducedMotion ? (isOpen ? 'open' :
        previous.phase === 'unmounted' ? 'unmounted' : 'hidden') :
        isOpen ? 'opening' :
          previous.phase === 'unmounted' ? 'unmounted' : 'minimizing',
      expanded: reducedMotion && isOpen,
      generation,
    }));
    if (!reducedMotion) {
      if (isOpen) frames.push(requestAnimationFrame(() => {
        frames.push(requestAnimationFrame(() => {
          if (generation !== generationRef.current) return;
          setState((previous) => ({ ...previous, expanded: true }));
        }));
      }));
      timer = setTimeout(() => finish(generation), 240);
    }
    return () => {
      cancelRef.current();
      generationRef.current = generation + 1;
    };
  }, [isOpen, reducedMotion, finish]);

  const settle = useCallback(() => {
    finish(generationRef.current);
  }, [finish]);

  const onTransitionEnd = useCallback((event: TransitionEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget ||
        event.propertyName !== 'transform') return;
    finish(state.generation);
  }, [finish, state.generation]);

  return {
    ...state, reducedMotion, settle, onTransitionEnd,
    mounted: state.phase !== 'unmounted',
    isHidden: state.phase === 'hidden',
    isInteractive: isOpen && state.phase === 'open',
    transitionEnabled: !reducedMotion &&
      (state.phase === 'minimizing' ||
        (state.phase === 'opening' && state.expanded)),
  };
}

export type DockPresence = ReturnType<typeof useDockPresence>;
