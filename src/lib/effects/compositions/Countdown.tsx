import React from 'react';
import { fitEffectText, useEffectScene, type SceneProps } from './layout';

export function Countdown({ document }: SceneProps) {
  const scene = useEffectScene(document);
  const value = Math.ceil(Number(document.params.from) * (1 - scene.progress));
  const isRing = document.templateId === 'countdown-ring';
  return <div style={{ position: 'absolute', inset: '6%', display: 'flex',
    flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
    <div style={{ position: 'relative', width: scene.short * 0.55,
      height: scene.short * 0.55, display: 'grid', placeItems: 'center',
      background: isRing ? undefined : `${document.palette.foreground}10`,
      borderRadius: isRing ? '50%' : '6%',
      fontSize: scene.short * 0.24, fontVariantNumeric: 'tabular-nums',
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
    <div style={{ marginTop: '4%', ...fitEffectText({ document,
      text: document.content.title, height: scene.height * 0.2 }) }}>
      {document.content.title}
    </div>
  </div>;
}
