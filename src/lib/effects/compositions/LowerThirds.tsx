import React from 'react';
import { useEffectScene, type SceneProps } from './layout';
import { EffectText } from './EffectText';

export function LowerThirds({ document }: SceneProps) {
  const scene = useEffectScene(document);
  const isBlock = document.templateId === 'lower-block';
  const isRight = document.params.anchor === 'bottom-right';
  return <div data-effects-text-group data-effects-group-height={scene.height * 0.8}
    style={{ position: 'absolute', bottom: '8%',
    left: isRight ? undefined : '6%', right: isRight ? '6%' : undefined,
    maxWidth: '82%', opacity: scene.opacity, padding: '2% 3%',
    transform: `translateX(${(1 - scene.enter) * (isRight ? 1 : -1)
      * scene.short * 0.12 * document.motion.intensity}px)`,
    background: isBlock ? document.palette.accent
      : `${document.palette.background}DD`,
    borderLeft: `4px solid ${document.palette.accent}` }}>
    <EffectText document={document} />
    <EffectText document={document} field="subtitle" />
  </div>;
}
