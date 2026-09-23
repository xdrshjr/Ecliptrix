/**
 * @vitest-environment node
 *
 * Canvas fit geometry (spec segment-centric-editor-workbench-r2 §3.9.2).
 *
 * T-FIT-2 (TS side): the preview rects match the SAME fixture the Python
 * export test reads, within its tolerance, so preview and export cannot drift.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CanvasFit } from '@/types';
import {
  blurBackgroundFilter,
  cameraContentRect,
  computeVideoFitRects,
  cropInSourceWindow,
  visibleSourceWindow,
} from '../videoFit';
import { fitSourceInFrame, type FitRect } from '../internal/fitContain';

type RectTuple = [number, number, number, number];

interface FitCase {
  name: string;
  source: { width: number; height: number };
  canvas: { width: number; height: number };
  expected: Record<CanvasFit, { content: RectTuple; background: RectTuple | null }>;
}

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const FIXTURE = resolve(
  REPO_ROOT,
  'backend-services/basic-service/tests/fixtures/fit-cases.json',
);
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as {
  tolerance_px: number;
  cases: FitCase[];
};
const FITS: CanvasFit[] = ['contain', 'cover', 'blur'];

function expectRectClose(actual: FitRect, expected: RectTuple, where: string): void {
  const got = [actual.x, actual.y, actual.width, actual.height];
  got.forEach((value, index) => {
    const diff = Math.abs(value - expected[index]);
    expect(diff, `${where}: ${got.join(',')} vs ${expected.join(',')}`)
      .toBeLessThanOrEqual(fixture.tolerance_px);
  });
}

describe('computeVideoFitRects — shared fixture (T-FIT-2)', () => {
  it('has the twelve geometry cases', () => {
    expect(fixture.cases).toHaveLength(12);
  });

  for (const testCase of fixture.cases) {
    for (const fit of FITS) {
      it(`${testCase.name} / ${fit}`, () => {
        const frame = {
          x: 0, y: 0, width: testCase.canvas.width, height: testCase.canvas.height,
        };
        const rects = computeVideoFitRects(
          testCase.source.width, testCase.source.height, frame, fit,
        );
        const expected = testCase.expected[fit];
        const where = `${testCase.name} / ${fit}`;

        expectRectClose(rects.content, expected.content, where);
        if (expected.background === null) {
          expect(rects.background, where).toBeNull();
        } else {
          expect(rects.background, where).not.toBeNull();
          expectRectClose(rects.background as FitRect, expected.background, where);
        }
        expect(rects.clip).toEqual(frame);
      });
    }
  }
});

describe('computeVideoFitRects — contain is today', () => {
  it('returns fitSourceInFrame for an offset frame', () => {
    const frame = { x: 40, y: 10, width: 1600, height: 900 };

    const rects = computeVideoFitRects(1080, 1920, frame, 'contain');

    expect(rects.content).toEqual(fitSourceInFrame(1080, 1920, frame));
    expect(rects.background).toBeNull();
  });
});

describe('cover camera window', () => {
  const frame = { x: 0, y: 0, width: 1920, height: 1080 };

  it('moves the camera on the cropped frame', () => {
    const rects = computeVideoFitRects(1080, 1920, frame, 'cover');

    expect(cameraContentRect(rects, 'cover')).toEqual(frame);
    expect(cameraContentRect(rects, 'blur')).toEqual(rects.content);
  });

  it('maps the camera crop into the visible part of the source', () => {
    const rects = computeVideoFitRects(1080, 1920, frame, 'cover');
    const window = visibleSourceWindow(rects);

    expect(window.x).toBeCloseTo(0);
    expect(window.w).toBeCloseTo(1);
    expect(window.h).toBeCloseTo(1080 / rects.content.height);
    expect(window.y).toBeCloseTo((1 - window.h) / 2);
    const full = cropInSourceWindow({ x: 0, y: 0, w: 1, h: 1 }, window);
    expect(full).toEqual(window);
  });
});

describe('blurBackgroundFilter', () => {
  it('scales sigma with the frame height', () => {
    expect(blurBackgroundFilter(1080)).toBe('blur(20px) brightness(0.6)');
    expect(blurBackgroundFilter(540)).toBe('blur(10px) brightness(0.6)');
  });
});
