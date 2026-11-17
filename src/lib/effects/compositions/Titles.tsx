import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { EffectDocument } from '../../../types/effects';
import { getMotionProgress } from './layout';
import { EffectText } from './EffectText';

/** Both title variants share normalized source-space layout. */
export function Titles({ document }: { document: EffectDocument }) {
  const frame = useCurrentFrame();
  const { height, durationInFrames } = useVideoConfig();
  const { enter, exit } = getMotionProgress({
    frame, durationFrames: durationInFrames,
    speed: document.motion.speed,
  });
  const progress = 1 - Math.pow(1 - enter, 3);
  const distance = Number(document.params.distance ?? 0.08);
  return (
    <div data-effects-text-group data-effects-group-height={height * 0.88} style={{
      position: 'absolute', inset: '6%', display: 'flex',
      flexDirection: 'column', justifyContent: 'center',
      textAlign: document.typography.align,
      opacity: Math.min(enter, exit),
      transform: `translateY(${(1 - progress) * height * distance
        * document.motion.intensity}px)`,
      clipPath: document.templateId === 'title-mask'
        ? `inset(0 ${(1 - progress) * 100}% 0 0)` : undefined,
    }}>
      <EffectText document={document} />
      <EffectText document={document} field="subtitle"
        style={{ marginTop: height * 0.0175, color: document.palette.accent }} />
    </div>
  );
}
