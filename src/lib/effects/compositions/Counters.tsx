import React from 'react';
import { useEffectScene, type SceneProps } from './layout';
import { EffectText } from './EffectText';

export function Counters({ document }: SceneProps) {
  const scene = useEffectScene(document);
  return <div data-effects-text-group data-effects-group-height={scene.height * 0.8}
    style={{ position: 'absolute', inset: '10% 6%',
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    alignItems: 'center', opacity: scene.exit }}>
    {document.templateId === 'counter-bars'
      ? <div style={{ display: 'flex', alignItems: 'end',
        gap: scene.short * 0.08, height: scene.height * 0.55, flexShrink: 0,
        paddingTop: scene.short * 0.06, boxSizing: 'border-box' }}>
        {(document.params.bars as number[]).map((value, index) =>
          <div key={index} style={{ width: scene.short * 0.12,
            height: `${value * scene.enter}%`, minHeight: 2,
            background: document.palette.accent, position: 'relative' }}>
            <span style={{ position: 'absolute', top: -scene.short * 0.06,
              fontSize: scene.short * 0.04 }}>{Math.round(value * scene.enter)}</span>
          </div>)}
      </div> : <EffectText document={document} field="params.value"
        text={`${document.params.value}${document.params.suffix}`}
        displayText={`${Math.round(Number(document.params.value) * scene.enter)}${document.params.suffix}`}
        box={{ width: scene.width * 0.88, height: scene.height * 0.55,
          sizeRatio: 0.19, minScale: 0.6, lineHeight: 1.3 }}
        style={{ color: document.palette.accent, fontVariantNumeric: 'tabular-nums' }} />}
    <EffectText document={document} style={{ marginTop: scene.short * 0.05 }} />
  </div>;
}
