import React from 'react';
import { Img } from 'remotion';
import { fitEffectText, getInputStyle, useEffectScene, type SceneProps } from './layout';

export function Slideshow({ document, assets }: SceneProps) {
  const scene = useEffectScene(document);
  const images = document.inputs.filter(input => input.slot === 'images')
    .sort((a, b) => a.index! - b.index!);
  const time = scene.progress * Math.max(1, images.length);
  const active = Math.min(images.length - 1, Math.floor(time));
  const blend = Math.min(1, (time - Math.floor(time))
    / Number(document.params.transitionFraction));
  const isStack = document.templateId === 'slides-stack';
  return <div style={{ position: 'absolute', inset: 0,
    opacity: scene.opacity, overflow: 'hidden' }}>
    {images.map((image, index) => <div key={image.assetId + index}
      style={{ position: 'absolute', inset: isStack ? '8%' : 0,
        opacity: index === active ? (active ? blend : 1)
          : index === active - 1 ? 1 : 0,
        zIndex: index,
        transform: isStack ? `translateX(${index === active
          ? (1 - blend) * 100 * document.motion.intensity : 0}%)
          rotate(${index % 2 ? 2 : -2}deg)` : undefined }}>
      <Img src={assets[image.assetId]} style={getInputStyle(image)} />
    </div>)}
    <div style={{ position: 'absolute', left: '6%', bottom: '6%',
      zIndex: 10, ...fitEffectText({ document, text: document.content.title,
        height: scene.height * 0.25 }) }}>{document.content.title}</div>
  </div>;
}
