import React from 'react';
import { Img } from 'remotion';
import { getInputStyle, useEffectScene,
  type SceneProps } from './layout';
import { EffectText } from './EffectText';

export function Product({ document, assets }: SceneProps) {
  const scene = useEffectScene(document);
  const hero = document.inputs.find(input => input.slot === 'hero');
  const isSpotlight = document.templateId === 'product-spotlight';
  const isVertical = scene.width <= scene.height * 1.5;
  const size = Math.min(Number(document.params.cardScale) * scene.short,
    scene.height * (isVertical ? 0.5 : 0.85));
  const float = Math.sin(scene.progress * Math.PI * 2)
    * scene.short * 0.025 * document.motion.intensity;
  const textWidth = isVertical ? scene.width * 0.88
    : Math.min(scene.width * 0.4, scene.width * 0.88 - size - scene.short * 0.03);
  return <div style={{ position: 'absolute', inset: '6%',
    display: 'flex', alignItems: 'center', justifyContent: 'space-around',
    flexDirection: isVertical ? 'column' : 'row', gap: scene.short * 0.03,
    opacity: scene.opacity }}>
    <div style={{ width: size, height: size, flexShrink: 0,
      transform: `translateY(${isSpotlight ? 0 : float}px)
        scale(${0.9 + scene.enter * 0.1})`,
      borderRadius: '5%', overflow: 'hidden',
      boxShadow: isSpotlight ? `0 0 ${size * 0.4}px
        ${document.palette.accent}80` : '0 20px 60px #0005' }}>
      {hero && <Img src={assets[hero.assetId]} style={getInputStyle(hero)} />}
    </div>
    <div data-effects-text-group
      data-effects-group-height={scene.height * (isVertical ? 0.28 : 0.88)}
      style={{ width: textWidth, flexShrink: 0 }}>
      <EffectText document={document} />
      <EffectText document={document} field="subtitle"
        style={{ marginTop: scene.short * 0.03, opacity: 0.75 }} />
    </div>
  </div>;
}
