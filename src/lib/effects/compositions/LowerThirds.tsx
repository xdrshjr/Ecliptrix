import React from 'react';
import { fitEffectText, useEffectScene, type SceneProps } from './layout';

export function LowerThirds({ document }: SceneProps) {
  const scene = useEffectScene(document);
  const isBlock = document.templateId === 'lower-block';
  const isRight = document.params.anchor === 'bottom-right';
  return <div style={{ position: 'absolute', bottom: '8%',
    left: isRight ? undefined : '6%', right: isRight ? '6%' : undefined,
    maxWidth: '82%', opacity: scene.opacity, padding: '2% 3%',
    transform: `translateX(${(1 - scene.enter) * (isRight ? 1 : -1)
      * scene.short * 0.12 * document.motion.intensity}px)`,
    background: isBlock ? document.palette.accent
      : `${document.palette.background}DD`,
    borderLeft: `4px solid ${document.palette.accent}` }}>
    <div style={fitEffectText({ document,
      text: document.content.title, width: scene.width * 0.7 })}>
      {document.content.title}
    </div>
    <div style={fitEffectText({ document, subtitle: true,
      text: document.content.subtitle, width: scene.width * 0.7 })}>
      {document.content.subtitle}
    </div>
  </div>;
}
