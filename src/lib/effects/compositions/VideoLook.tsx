import { EffectText } from './EffectText';
import React from 'react';
import { useEffectScene, type SceneProps } from './layout';

export function VideoLook({ document }: SceneProps) {
  const scene = useEffectScene(document);
  const strength = Number(document.params.strength)
    * document.motion.intensity;
  const pulse = strength > 0 && scene.frame % 10 === 0;
  return <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    {document.templateId === 'video-glitch'
      ? <div style={{ position: 'absolute', inset: 0,
        background: pulse ? `${document.palette.accent}40` : 'transparent',
        transform: `translateX(${pulse ? strength * 12 : 0}px)`,
        borderLeft: pulse ? `${strength * 20}px solid #00ffff80` : undefined }} />
      : <><div style={{ position: 'absolute', inset: '0 0 auto',
        height: `${strength * 12}%`, background: '#000' }} />
      <div style={{ position: 'absolute', inset: 'auto 0 0',
        height: `${strength * 12}%`, background: '#000' }} /></>}
    <div style={{ position: 'absolute', left: '6%', bottom: '18%',
      opacity: scene.opacity }}>
      <EffectText document={document} />
    </div>
  </div>;
}
