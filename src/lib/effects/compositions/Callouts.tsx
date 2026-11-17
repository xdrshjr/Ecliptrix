import React from 'react';
import { useEffectScene, type SceneProps } from './layout';
import { EffectText } from './EffectText';

export function Callouts({ document }: SceneProps) {
  const scene = useEffectScene(document);
  const x = Number(document.params.pointX) * 100;
  const y = Number(document.params.pointY) * 100;
  const isRing = document.templateId === 'callout-ring';
  return <div style={{ position: 'absolute', inset: 0,
    opacity: scene.opacity }}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <circle cx={x} cy={y} r={isRing ? 4 : 0.8} fill="none"
        stroke={document.palette.accent} strokeWidth="0.4"
        pathLength="1" strokeDasharray="1" strokeDashoffset={1 - scene.enter} />
      {!isRing && <path d={`M${x} ${y} L${x > 50 ? x - 10 : x + 10}
        ${y > 50 ? y - 10 : y + 10} H${x > 50 ? 10 : 90}`}
        fill="none" stroke={document.palette.accent} strokeWidth="0.3"
        pathLength="1" strokeDasharray="1" strokeDashoffset={1 - scene.enter} />}
    </svg>
    <div style={{ position: 'absolute', left: x > 50 ? '6%' : '55%',
      top: y > 50 ? '12%' : '72%', width: scene.width * 0.38 }}>
      <EffectText document={document} />
    </div>
  </div>;
}
