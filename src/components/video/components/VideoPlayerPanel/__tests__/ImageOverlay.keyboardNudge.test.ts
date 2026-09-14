/**
 * @vitest-environment node
 *
 * N-02 — an image overlay can be moved with the keyboard: arrow keys move it
 * live, a burst is committed once after 400 ms idle, Escape reverts a burst.
 *
 * The burst timing is exercised on {@link ImageNudgeBurst}; the focus / key
 * wiring in `ImageOverlay.tsx` is pinned at the source level because the
 * Vitest config cannot mount `.tsx` components (tsconfig jsx: "preserve").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ImagePosition } from '@/types';
import { ImageNudgeBurst, NUDGE_COMMIT_IDLE_MS } from '../imageOverlayNudge';

const OVERLAY = readFileSync(resolve(__dirname, '..', 'ImageOverlay.tsx'), 'utf-8');

function recordingBurst() {
  const changes: ImagePosition[] = [];
  const commits: ImagePosition[] = [];
  const burst = new ImageNudgeBurst({
    onPositionChange: (position) => changes.push(position),
    onCommit: (position) => commits.push(position),
  });
  return { burst, changes, commits };
}

const START: ImagePosition = { x: 0.2, y: 0.55, width: 0.4, height: 0.4, zIndex: 10 };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ImageOverlay keyboard nudge (N-02)', () => {
  it('ArrowRight moves 1% live and commits once after 400 ms idle', () => {
    const { burst, changes, commits } = recordingBurst();
    burst.nudge(START, 'ArrowRight', false);
    burst.nudge(START, 'ArrowRight', false);
    vi.advanceTimersByTime(NUDGE_COMMIT_IDLE_MS - 1);
    const committedBeforeIdle = commits.length;
    vi.advanceTimersByTime(1);

    expect({
      liveX: changes.map((position) => Number(position.x.toFixed(4))),
      committedBeforeIdle,
      commits: commits.map((position) => Number(position.x.toFixed(4))),
    }).toEqual({ liveX: [0.21, 0.22], committedBeforeIdle: 0, commits: [0.22] });
  });

  it('Shift+ArrowDown moves 10% and clamps to the frame', () => {
    const { burst, changes } = recordingBurst();
    burst.nudge(START, 'ArrowDown', true);
    // y 0.55 + 0.1 would push the bottom edge past the frame; it stops at 1 − 0.4.
    expect(changes[0].y).toBeCloseTo(0.6, 9);
  });

  it('Escape during a nudge burst reverts without committing', () => {
    const { burst, changes, commits } = recordingBurst();
    burst.nudge(START, 'ArrowLeft', false);
    const cancelled = burst.cancel();
    vi.advanceTimersByTime(NUDGE_COMMIT_IDLE_MS * 2);

    expect({ cancelled, lastChange: changes[changes.length - 1], commits: commits.length })
      .toEqual({ cancelled: true, lastChange: START, commits: 0 });
  });

  it('the overlay is a focusable, labelled group wired to the nudge burst', () => {
    expect(OVERLAY).toMatch(/tabIndex=\{0\}/);
    expect(OVERLAY).toMatch(/role="group"/);
    expect(OVERLAY).toMatch(/aria-label=\{t\.imageOverlay\.overlayLabel\}/);
    expect(OVERLAY).toMatch(/onKeyDown=\{handleKeyDown\}/);
    expect(OVERLAY).toMatch(/onBlur=\{\(\) => nudgeBurst\.flush\(\)\}/);
  });
});
