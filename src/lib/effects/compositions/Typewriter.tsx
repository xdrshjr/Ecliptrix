import React from 'react';
import { fitEffectText, getGraphemes, useEffectScene,
  type SceneProps } from './layout';

export function Typewriter({ document }: SceneProps) {
  const scene = useEffectScene(document);
  const letters = getGraphemes(document.content.title);
  const reveal = Math.min(1,
    scene.enter / Number(document.params.revealFraction));
  return <div style={{ position: 'absolute', inset: '10% 6%',
    display: 'flex', alignItems: 'center', opacity: scene.exit }}>
    <div style={{ ...fitEffectText({ document,
      text: document.content.title }), width: '100%' }}>
      {document.templateId === 'type-lines'
        ? document.content.title.split('\n').map((line, i, all) =>
          <div key={i} style={{ opacity: i < Math.ceil(reveal * all.length)
            ? 1 : 0 }}>{line}</div>)
        : <>{letters.slice(0, Math.ceil(letters.length * reveal)).join('')}
          <span style={{ color: document.palette.accent,
            opacity: scene.frame % 30 < 15 ? 1 : 0 }}>▎</span></>}
    </div>
  </div>;
}
