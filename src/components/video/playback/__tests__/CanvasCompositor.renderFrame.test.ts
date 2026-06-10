/**
 * CanvasCompositor.renderFrame multi-track tests (spec 02 §2.2 / §4 / §6).
 *
 * Uses the SAME mock-2d-context pattern as CanvasCompositor.test.ts: drawImage /
 * fillText are spies; we record globalAlpha at each draw so per-layer opacity
 * and z-order are assertable without a real GPU.
 *
 * Acceptance cases pinned here:
 *   - §6 case 8: two video tracks, the UPPER one opacity<1 → the LOWER one is
 *     still drawn (i.e. lets the lower show through).
 *   - §6 case 9: an active subtitle is drawn to the canvas.
 */

import { describe, it, expect, vi } from 'vitest';
import { CanvasCompositor } from '../CanvasCompositor';
import type { CompositorLayer } from '../types';

interface AlphaCall {
  alpha: number;
  source: unknown;
}

function makeMockCanvas(width = 1280, height = 720) {
  const drawImageAlphas: AlphaCall[] = [];
  const fillTextCalls: string[] = [];
  const ctx = {
    drawImage: vi.fn(function (this: { globalAlpha: number }, source: unknown) {
      drawImageAlphas.push({ alpha: ctx.globalAlpha, source });
    }),
    fillRect: vi.fn(),
    fillText: vi.fn((text: string) => {
      fillTextCalls.push(text);
    }),
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
  return { canvas, ctx, drawImageAlphas, fillTextCalls };
}

function makeMockVideo(readyState = 4, w = 1920, h = 1080): HTMLVideoElement {
  return { readyState, videoWidth: w, videoHeight: h } as unknown as HTMLVideoElement;
}

function videoLayer(id: string, z: number, opacity: number, source = makeMockVideo()): CompositorLayer {
  return { kind: 'video', id, source, opacity, z };
}

describe('CanvasCompositor.renderFrame — multi-source compositing', () => {
  it('draws video layers in ascending z order (bottom first)', () => {
    const { canvas, drawImageAlphas } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    const bottom = makeMockVideo(4, 1920, 1080);
    const top = makeMockVideo(4, 1920, 1080);
    // Provide them out of z order to prove renderFrame sorts.
    c.renderFrame([
      { kind: 'video', id: 'top', source: top, opacity: 1, z: 5 },
      { kind: 'video', id: 'bottom', source: bottom, opacity: 1, z: 0 },
    ]);
    expect(drawImageAlphas).toHaveLength(2);
    expect(drawImageAlphas[0].source).toBe(bottom); // z=0 first
    expect(drawImageAlphas[1].source).toBe(top); // z=5 second
  });

  it('§6 case 8: upper video opacity<1 still draws the lower video (lower shows through)', () => {
    const { canvas, drawImageAlphas } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    const lower = makeMockVideo(4, 1920, 1080);
    const upper = makeMockVideo(4, 1920, 1080);
    c.renderFrame([
      videoLayer('lower', 0, 1, lower),
      videoLayer('upper', 1, 0.4, upper),
    ]);
    // Both are drawn — the lower is NOT skipped just because an upper layer exists.
    expect(drawImageAlphas.map((d) => d.source)).toEqual([lower, upper]);
    // Lower at full alpha, upper at its reduced alpha.
    expect(drawImageAlphas[0].alpha).toBeCloseTo(1, 6);
    expect(drawImageAlphas[1].alpha).toBeCloseTo(0.4, 6);
  });

  it('applies each layer opacity as globalAlpha at its own drawImage', () => {
    const { canvas, drawImageAlphas } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    c.renderFrame([
      videoLayer('a', 0, 0.25),
      videoLayer('b', 1, 0.75),
    ]);
    expect(drawImageAlphas[0].alpha).toBeCloseTo(0.25, 6);
    expect(drawImageAlphas[1].alpha).toBeCloseTo(0.75, 6);
  });

  it('skips a video layer whose source is not ready (readyState<2) without dropping others', () => {
    const { canvas, drawImageAlphas } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    const notReady = makeMockVideo(1, 1920, 1080);
    const ready = makeMockVideo(4, 1920, 1080);
    c.renderFrame([
      videoLayer('notready', 0, 1, notReady),
      videoLayer('ready', 1, 1, ready),
    ]);
    expect(drawImageAlphas.map((d) => d.source)).toEqual([ready]);
  });

  it('skips a video layer with opacity 0', () => {
    const { canvas, drawImageAlphas } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    c.renderFrame([videoLayer('a', 0, 0)]);
    expect(drawImageAlphas).toHaveLength(0);
  });

  it('§6 case 9: draws an active subtitle layer (lines) over the video', () => {
    const { canvas, fillTextCalls } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    c.renderFrame([
      videoLayer('v', 0, 1),
      {
        kind: 'subtitle',
        id: 's',
        lines: ['hello world', 'second line'],
        style: { fontSize: 24, color: '#fff' },
        opacity: 1,
        z: 1_000_000,
      },
    ]);
    expect(fillTextCalls).toContain('hello world');
    expect(fillTextCalls).toContain('second line');
  });

  it('subtitle z keeps it ABOVE video (drawn after the video layer)', () => {
    const { canvas, ctx } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    const order: string[] = [];
    ctx.drawImage.mockImplementation(() => order.push('video'));
    ctx.fillText.mockImplementation(() => order.push('subtitle'));
    c.renderFrame([
      { kind: 'subtitle', id: 's', lines: ['cap'], style: { fontSize: 20, color: '#fff' }, opacity: 1, z: 2_000_000 },
      videoLayer('v', 0, 1),
    ]);
    // Even though subtitle was listed first, its higher z sorts it after video.
    expect(order[0]).toBe('video');
    expect(order).toContain('subtitle');
    expect(order.indexOf('subtitle')).toBeGreaterThan(order.indexOf('video'));
  });

  it('counts a frame with at least one drawn layer as drawn; an all-idle frame as dropped', () => {
    const { canvas } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    c.renderFrame([videoLayer('v', 0, 1)]);
    expect(c.getStats().drawnFrames).toBe(1);
    c.renderFrame([videoLayer('v', 0, 1, makeMockVideo(1))]); // not ready → nothing drawn
    expect(c.getStats().droppedFrames).toBe(1);
  });

  it('renderFrame is a no-op after detach', () => {
    const { canvas, drawImageAlphas } = makeMockCanvas();
    const c = new CanvasCompositor();
    c.attach(canvas);
    c.detach();
    c.renderFrame([videoLayer('v', 0, 1)]);
    expect(drawImageAlphas).toHaveLength(0);
  });
});
