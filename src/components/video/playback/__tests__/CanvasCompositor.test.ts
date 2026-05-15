/**
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §7.1.
 *
 * Uses jsdom's canvas mock — drawImage is observed via spies on the 2d
 * context. We do not require pixel-accurate rendering.
 */

import { describe, it, expect, vi } from 'vitest';
import { CanvasCompositor } from '../CanvasCompositor';
import {
  ADAPTIVE_DEGRADE_DRAW_MS,
  ADAPTIVE_RECOVER_DRAW_MS,
  ADAPTIVE_RECOVER_HOLD_FRAMES,
  ADAPTIVE_WINDOW_FRAMES,
} from '../internal/constants';
import type { OverlayPayload, PreviewFrame } from '../types';

interface MockCtx {
  drawImage: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  fillStyle: string;
  globalAlpha: number;
  textAlign: string;
  textBaseline: string;
  font: string;
  imageSmoothingQuality: string;
}

function makeMockCanvas(width = 1280, height = 720): {
  canvas: HTMLCanvasElement;
  ctx: MockCtx;
} {
  const ctx: MockCtx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 100 })),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '#000',
    globalAlpha: 1,
    textAlign: 'center',
    textBaseline: 'middle',
    font: '',
    imageSmoothingQuality: 'high',
  };
  const canvas = {
    width,
    height,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:image/png;base64,xxx'),
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}

function makeMockVideo(readyState = 4, w = 1920, h = 1080): HTMLVideoElement {
  return {
    readyState,
    videoWidth: w,
    videoHeight: h,
  } as unknown as HTMLVideoElement;
}

function frame(overrides: Partial<PreviewFrame> = {}): PreviewFrame {
  return {
    compositionTime: 1,
    sequenceIndex: 0,
    sequenceLocalTime: 1,
    source: makeMockVideo(),
    ...overrides,
  };
}

describe('CanvasCompositor', () => {
  it('attach throws when getContext returns null', () => {
    const c = new CanvasCompositor();
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => c.attach(canvas)).toThrow();
  });

  it('drawFrame skips when no source bound and counts as dropped', () => {
    const { canvas } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    c.drawFrame(frame({ source: null }));
    expect(c.getStats().drawnFrames).toBe(0);
    expect(c.getStats().droppedFrames).toBe(1);
  });

  it('drawFrame skips when readyState < 2 (HAVE_CURRENT_DATA)', () => {
    const { canvas, ctx } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    c.drawFrame(frame({ source: makeMockVideo(1) }));
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(c.getStats().droppedFrames).toBe(1);
  });

  it('drawFrame letterboxes 16:9 source into 4:3 canvas', () => {
    const { canvas, ctx } = makeMockCanvas(800, 600);
    const c = new CanvasCompositor();
    c.attach(canvas);
    const v = makeMockVideo(4, 1920, 1080); // 16:9
    c.drawFrame(frame({ source: v }));
    expect(ctx.drawImage).toHaveBeenCalledOnce();
    const args = ctx.drawImage.mock.calls[0];
    expect(args[3]).toBe(800); // width fills horizontally
    expect(args[4]).toBeCloseTo(450, 0); // height letterboxed
    expect(args[2]).toBeCloseTo(75, 0); // y offset (600 - 450) / 2
  });

  it('drawFrame pillarboxes 4:3 source into 16:9 canvas', () => {
    const { canvas, ctx } = makeMockCanvas(1600, 900);
    const c = new CanvasCompositor();
    c.attach(canvas);
    const v = makeMockVideo(4, 800, 600); // 4:3
    c.drawFrame(frame({ source: v }));
    const args = ctx.drawImage.mock.calls[0];
    expect(args[4]).toBe(900); // height fills vertically
    expect(args[3]).toBeCloseTo(1200, 0); // pillarboxed width
  });

  it('renders subtitle overlay during its visible window', () => {
    const { canvas, ctx } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    const overlays: OverlayPayload[] = [
      {
        kind: 'subtitle',
        id: 's1',
        text: 'hello',
        style: { fontSize: 24, color: '#fff' },
        startMs: 0,
        endMs: 2000,
      },
    ];
    c.setOverlays(overlays);
    c.drawFrame(frame({ compositionTime: 1 }));
    expect(ctx.fillText).toHaveBeenCalledWith('hello', expect.any(Number), expect.any(Number));
  });

  it('does not render subtitle outside its time window', () => {
    const { canvas, ctx } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    c.setOverlays([
      {
        kind: 'subtitle',
        id: 's1',
        text: 'hello',
        style: { fontSize: 24, color: '#fff' },
        startMs: 5000,
        endMs: 6000,
      },
    ]);
    c.drawFrame(frame({ compositionTime: 1 }));
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('captureFrame returns the dataURL', () => {
    const { canvas } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    expect(c.captureFrame()).toBe('data:image/png;base64,xxx');
  });

  it('targetFps degrades to 30 after slow rolling window', () => {
    const { canvas } = makeMockCanvas();
    let now = 0;
    const c = new CanvasCompositor(() => {
      const t = now;
      now += ADAPTIVE_DEGRADE_DRAW_MS + 1; // slow each frame
      return t;
    });
    c.attach(canvas);
    for (let i = 0; i < ADAPTIVE_WINDOW_FRAMES + 1; i++) {
      c.drawFrame(frame());
    }
    expect(c.getStats().targetFps).toBe(30);
  });

  it('targetFps recovers to 60 after sustained fast frames', () => {
    const { canvas } = makeMockCanvas();
    let increment = ADAPTIVE_DEGRADE_DRAW_MS + 2; // start slow → degrade
    let now = 0;
    const c = new CanvasCompositor(() => {
      const t = now;
      now += increment;
      return t;
    });
    c.attach(canvas);
    for (let i = 0; i < ADAPTIVE_WINDOW_FRAMES + 5; i++) c.drawFrame(frame());
    expect(c.getStats().targetFps).toBe(30);
    increment = Math.max(0, ADAPTIVE_RECOVER_DRAW_MS - 2);
    for (let i = 0; i < ADAPTIVE_WINDOW_FRAMES + ADAPTIVE_RECOVER_HOLD_FRAMES + 5; i++) {
      c.drawFrame(frame());
    }
    expect(c.getStats().targetFps).toBe(60);
  });

  it('detach clears state and stops drawing', () => {
    const { canvas, ctx } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    c.detach();
    c.drawFrame(frame());
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
