import type { CSSProperties } from 'react';
import { getEffectFontChain } from '../fontResources';
import { getEffectTextBox, normalizeEffectDisplayText } from '../textLayout';
import { useCurrentFrame } from 'remotion';
import type {
  EffectCompositionProps, EffectDocument, EffectInputBinding,
} from '@/types/effects';

export type SceneProps = EffectCompositionProps;

/** Quantized frame intervals shared by Player and offline rendering. */
export function getMotionProgress(options: {
  frame: number;
  durationFrames: number;
  speed: number;
}): { enter: number; exit: number } {
  const length = Math.max(1, Math.floor(
    options.durationFrames * 0.125 / options.speed,
  ));
  return {
    enter: Math.min(1, Math.max(0, options.frame / length)),
    exit: Math.min(1, Math.max(0,
      (options.durationFrames - 1 - options.frame) / length,
    )),
  };
}

/** Frame-based timing leaves at least half the clip for complete content. */
export function useEffectScene(document: EffectDocument) {
  const frame = useCurrentFrame();
  const timing = getMotionProgress({ frame,
    durationFrames: document.durationFrames, speed: document.motion.speed });
  return { frame, ...timing, opacity: Math.min(timing.enter, timing.exit),
    progress: frame / Math.max(1, document.durationFrames - 1),
    width: document.canvas.width, height: document.canvas.height,
    short: Math.min(document.canvas.width, document.canvas.height) };
}

/** Keep user-selected crop placement identical in Player and rendering. */
export function getInputStyle(binding: EffectInputBinding): CSSProperties {
  return { width: '100%', height: '100%', objectFit: binding.fit,
    objectPosition: `${binding.focalX * 100}% ${binding.focalY * 100}%` };
}

export function getGraphemes(text: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    .segment(text), item => item.segment);
}

/** Wrap before shrinking, preserving newlines and complete graphemes. */
export function fitEffectText(options: {
  text: string; document: EffectDocument; subtitle?: boolean;
  width?: number; height?: number;
}): CSSProperties {
  const { document, text, subtitle } = options;
  const base = Math.min(document.canvas.width, document.canvas.height)
    * (subtitle ? 0.035 : 0.07) * document.typography.scale;
  const box = getEffectTextBox(document, subtitle ? 'subtitle' : 'title');
  const width = options.width ?? box.width;
  const height = options.height ?? box.height;
  const canvas = window.document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const fits = (size: number) => {
    if (!context) return true;
    context.font = `${subtitle ? 400 : 600} ${size}px ${getEffectFontChain(document.typography.family)}`;
    let lines = 1, current = '';
    for (const letter of getGraphemes(normalizeEffectDisplayText(text))) {
      if (letter === '\n') { lines++; current = ''; continue; }
      const candidate = current + letter;
      if (current && context.measureText(candidate).width > width) {
        lines++; current = letter;
      } else current = candidate;
    }
    return lines * size * 1.3 <= height;
  };
  let low = base * 0.6;
  let high = base;
  if (!text || !fits(low)) return { fontSize: low }; // DOM decides final fit.
  for (let i = 0; i < 12; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle; else high = middle;
  }
  return { fontSize: low, lineHeight: 1.3, whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere', textAlign: document.typography.align,
    maxWidth: width, fontWeight: subtitle ? 400 : 600 };
}
