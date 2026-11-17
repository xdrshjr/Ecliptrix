import { EffectText } from './EffectText';
import React from 'react';
import { random } from 'remotion';
import { useEffectScene, type SceneProps } from './layout';

export function Backgrounds({ document }: SceneProps) {
  const scene = useEffectScene(document);
  const isGrid = document.templateId === 'background-grid';
  return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
    {Array.from({ length: Number(document.params.density) }, (_, index) => {
      const phase = scene.progress * Math.PI * 2 * document.motion.speed
        + index * 0.7;
      const radius = random(document.seed + index) * 30 + 8;
      return <div key={index} style={{ position: 'absolute',
        left: `${isGrid ? (index % 6) * 18 : 50 + Math.cos(phase) * radius}%`,
        top: `${isGrid ? Math.floor(index / 6) * 28 : 50 + Math.sin(phase)
          * radius * document.motion.intensity}%`,
        width: scene.short * (isGrid ? 0.15 : 0.07),
        height: scene.short * (isGrid ? 0.15 : 0.07),
        border: `1px solid ${document.palette.accent}`,
        borderRadius: isGrid ? 0 : '50%',
        opacity: isGrid ? 0.25 + Math.sin(phase) * 0.2 : 0.4,
        transform: isGrid ? `rotate(${Math.sin(phase) * 10
          * document.motion.intensity}deg)` : undefined }} />;
    })}
    <div data-effects-text-group data-effects-group-height={scene.height * 0.88}
      style={{ position: 'absolute', inset: '6%', display: 'flex',
      flexDirection: 'column', justifyContent: 'center',
      opacity: scene.opacity }}>
      <EffectText document={document} />
      <EffectText document={document} field="subtitle" />
    </div>
  </div>;
}
