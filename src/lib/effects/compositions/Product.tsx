import React from 'react';
import { Img } from 'remotion';
import { fitEffectText, getInputStyle, useEffectScene,
  type SceneProps } from './layout';

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
    <div style={{ width: textWidth, flexShrink: 0 }}>
      <div style={fitEffectText({ document, text: document.content.title,
        width: textWidth, height: scene.height * (isVertical ? 0.15 : 0.35),
      })}>{document.content.title}</div>
      <div style={{ ...fitEffectText({ document, subtitle: true,
        text: document.content.subtitle, width: textWidth,
        height: scene.height * (isVertical ? 0.1 : 0.35) }),
      marginTop: scene.short * 0.03, opacity: 0.75 }}>
        {document.content.subtitle}
      </div>
    </div>
  </div>;
}
