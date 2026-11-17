import React from 'react';
import { useEffectScene, type SceneProps } from './layout';
import { EffectText } from './EffectText';

export function Countdown({ document }: SceneProps) {
  const scene = useEffectScene(document);
  const value = Math.ceil(Number(document.params.from) * (1 - scene.progress));
  const isRing = document.templateId === 'countdown-ring';
  return <div data-effects-text-group data-effects-group-height={scene.height * 0.88}
    style={{ position: 'absolute', inset: '6%', display: 'flex',
    flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
    <div style={{ position: 'relative', width: scene.short * 0.55,
      height: scene.short * 0.55, display: 'grid', placeItems: 'center',
      background: isRing ? undefined : `${document.palette.foreground}10`,
      borderRadius: isRing ? '50%' : '6%',
      fontSize: scene.short * 0.24, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
      transform: isRing ? undefined : `perspective(800px) rotateX(${Math.sin(
        scene.progress * Number(document.params.from) * Math.PI) * 8
        * document.motion.intensity}deg)` }}>
      {isRing && <svg viewBox="0 0 100 100"
        style={{ position: 'absolute', inset: 0 }}>
        <circle cx="50" cy="50" r="46" fill="none" strokeWidth="2"
          stroke={document.palette.accent} pathLength="1"
          strokeDasharray="1" strokeDashoffset={scene.progress}
          transform="rotate(-90 50 50)" />
      </svg>}
      {value}
    </div>
    <EffectText document={document} style={{ marginTop: scene.short * 0.04 }} />
  </div>;
}
