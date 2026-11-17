import React from 'react';
import { Img } from 'remotion';
import { fitEffectText, getInputStyle, useEffectScene, type SceneProps } from './layout';

export function SplitScreen({ document, assets }: SceneProps) {
  const scene = useEffectScene(document);
  const isVertical = document.templateId === 'split-vertical';
  const divider = Number(document.params.divider) * 100;
  return <div style={{ position: 'absolute', inset: '6%',
    display: 'flex', flexDirection: isVertical ? 'column' : 'row',
    gap: scene.short * 0.012, opacity: scene.opacity }}>
    {['left', 'right'].map((slot, index) => {
      const input = document.inputs.find(item => item.slot === slot);
      return <div key={slot} style={{ position: 'relative', overflow: 'hidden',
        flexBasis: `${index ? 100 - divider : divider}%`, flexShrink: 1,
        transform: `translate${isVertical ? 'Y' : 'X'}(${(1 - scene.enter)
          * (index ? 20 : -20) * document.motion.intensity}%)` }}>
        {input && <Img src={assets[input.assetId]}
          style={getInputStyle(input)} />}
      </div>;
    })}
    <div style={{ position: 'absolute', left: 0, bottom: 0,
      ...fitEffectText({ document, text: document.content.title,
        height: scene.height * 0.25 }) }}>{document.content.title}</div>
  </div>;
}
