import React from 'react';
import { useEffectScene,
  type SceneProps } from './layout';
import { EffectText } from './EffectText';

export function Typewriter({ document }: SceneProps) {
  const scene = useEffectScene(document);
  const reveal = Math.min(1,
    scene.enter / Number(document.params.revealFraction));
  return <div style={{ position: 'absolute', inset: '10% 6%',
    display: 'flex', alignItems: 'center', opacity: scene.exit }}>
    <EffectText document={document} reveal={reveal}
      revealLines={document.templateId === 'type-lines'}
      cursor={document.templateId === 'type-cursor'}
      cursorVisible={scene.frame % 30 < 15} />
  </div>;
}
