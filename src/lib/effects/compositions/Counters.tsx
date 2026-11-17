import React from 'react';
import { fitEffectText, useEffectScene, type SceneProps } from './layout';

export function Counters({ document }: SceneProps) {
  const scene = useEffectScene(document);
  return <div style={{ position: 'absolute', inset: '10% 6%',
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    alignItems: 'center', opacity: scene.exit }}>
    {document.templateId === 'counter-bars'
      ? <div style={{ display: 'flex', alignItems: 'end',
        gap: scene.short * 0.08, height: scene.height * 0.55 }}>
        {(document.params.bars as number[]).map((value, index) =>
          <div key={index} style={{ width: scene.short * 0.12,
            height: `${value * scene.enter}%`, minHeight: 2,
            background: document.palette.accent, position: 'relative' }}>
            <span style={{ position: 'absolute', top: -scene.short * 0.06,
              fontSize: scene.short * 0.04 }}>{Math.round(value * scene.enter)}</span>
          </div>)}
      </div> : <div style={{ color: document.palette.accent,
        fontSize: scene.short * 0.19, fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(Number(document.params.value) * scene.enter)}
        {document.params.suffix}
      </div>}
    <div style={{ marginTop: '5%', ...fitEffectText({ document,
      text: document.content.title, height: scene.height * 0.2 }) }}>
      {document.content.title}
    </div>
  </div>;
}
