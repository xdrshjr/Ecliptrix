import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { EffectDocument } from '../../../types/effects';
import { fitEffectText, getMotionProgress } from './layout';

/** Both title variants share normalized source-space layout. */
export function Titles({ document }: { document: EffectDocument }) {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const { enter, exit } = getMotionProgress({
    frame, durationFrames: durationInFrames,
    speed: document.motion.speed,
  });
  const progress = 1 - Math.pow(1 - enter, 3);
  const distance = Number(document.params.distance ?? 0.08);
  return (
    <div style={{
      position: 'absolute', inset: '6%', display: 'flex',
      flexDirection: 'column', justifyContent: 'center',
      textAlign: document.typography.align,
      opacity: Math.min(enter, exit),
      transform: `translateY(${(1 - progress) * height * distance
        * document.motion.intensity}px)`,
      clipPath: document.templateId === 'title-mask'
        ? `inset(0 ${(1 - progress) * 100}% 0 0)` : undefined,
    }}>
      <div style={{
        ...fitEffectText({ document, text: document.content.title }),
        lineHeight: 1.25, fontWeight: 600,
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
      }}>{document.content.title}</div>
      <div style={{
        ...fitEffectText({ document, text: document.content.subtitle,
          subtitle: true }),
        lineHeight: 1.4, marginTop: '0.5em',
        color: document.palette.accent, whiteSpace: 'pre-wrap',
      }}>{document.content.subtitle}</div>
    </div>
  );
}
