/**
 * EXO-09 — subtitles are laid out in output pixels and scaled onto the preview
 * frame, so their size relative to the picture matches the export.
 */

import { describe, expect, it, vi } from 'vitest';
import { CanvasCompositor } from '../CanvasCompositor';

function makeRecordingCanvas(width: number, height: number) {
  const draws: Array<{ kind: 'fill' | 'stroke'; text: string; x: number; y: number; font: string }> = [];
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn((text: string, x: number, y: number) => {
      draws.push({ kind: 'fill', text, x, y, font: ctx.font });
    }),
    strokeText: vi.fn((text: string, x: number, y: number) => {
      draws.push({ kind: 'stroke', text, x, y, font: ctx.font });
    }),
    measureText: vi.fn(() => ({ width: 30 })),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    font: '',
    imageSmoothingQuality: 'high',
  };
  const canvas = {
    width,
    height,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:'),
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx, draws };
}

describe('CanvasCompositor — subtitle scale (EXO-09)', () => {
  it('subtitle font scales with frame height over output height', () => {
    // 9:16 preview 360×640 of a 1080×1920 export → scale 1/3.
    const { canvas, ctx, draws } = makeRecordingCanvas(360, 640);
    const compositor = new CanvasCompositor(() => 0);
    compositor.attach(canvas, { aspectRatio: 9 / 16 });

    compositor.renderFrame([
      {
        kind: 'subtitle',
        id: 's',
        lines: [
          { text: 'hello', topY: 1817 },
          { text: '', topY: 1870 },
        ],
        style: { fontSize: 48, color: '#ffffff' },
        outputHeight: 1920,
        opacity: 1,
        z: 1,
      },
    ]);

    expect(draws.map((draw) => draw.kind)).toEqual(['stroke', 'fill']);
    expect(draws[1].font.startsWith('16px ')).toBe(true);
    expect(draws[1].x).toBeCloseTo(180, 6);
    expect(draws[1].y).toBeCloseTo(1817 / 3, 6);
    expect(ctx.lineWidth).toBeCloseTo(4 / 3, 6);
  });

  it('pads a background box by the drawtext boxborderw scaled to the frame', () => {
    const { canvas, ctx } = makeRecordingCanvas(1920, 1080);
    const compositor = new CanvasCompositor(() => 0);
    compositor.attach(canvas, { aspectRatio: 16 / 9 });

    compositor.renderFrame([
      {
        kind: 'subtitle',
        id: 's',
        lines: [{ text: 'boxed', topY: 1001 }],
        style: { fontSize: 24, color: '#ffffff', background: '#000000' },
        outputHeight: 1080,
        opacity: 1,
        z: 1,
      },
    ]);

    // measureText width 30 → box x = 960 − 15 − 5, y = 1001 − 5, w = 40, h = 24 + 10.
    expect(ctx.fillRect).toHaveBeenLastCalledWith(940, 996, 40, 34);
  });
});
