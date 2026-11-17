import React from 'react';
import { Img } from 'remotion';
import { fitEffectText, getInputStyle, useEffectScene,
  type SceneProps } from './layout';

export function ImageReveal({ document, assets }: SceneProps) {
  const scene = useEffectScene(document);
  const hero = document.inputs.find(input => input.slot === 'hero');
  const isWipe = document.templateId === 'image-wipe';
  const zoom = 1 + (Number(document.params.zoom) - 1)
    * scene.progress * document.motion.intensity;
  return <div style={{ position: 'absolute', inset: 0, opacity: scene.exit,
    clipPath: isWipe ? `circle(${scene.enter * 150}% at 50% 50%)` : undefined,
    transform: isWipe ? undefined : `scale(${zoom})` }}>
    {hero && <Img src={assets[hero.assetId]} style={getInputStyle(hero)} />}
    <div style={{ position: 'absolute', left: '6%', bottom: '8%',
      ...fitEffectText({ document, text: document.content.title }) }}>
      {document.content.title}
    </div>
  </div>;
}
