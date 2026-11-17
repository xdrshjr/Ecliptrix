import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { EffectComposition } from './EffectComposition';
import type { EffectCompositionProps } from '../../../types/effects';
import { createEffectDocument } from '../catalog';
import { EFFECT_FONT_URLS } from '../fonts';

/** Runtime metadata always comes from the immutable submitted document. */
function EffectRoot() {
  return <Composition id="Effect" component={EffectComposition}
    defaultProps={{ document: createEffectDocument(), assets: {},
      fontUrls: EFFECT_FONT_URLS } satisfies EffectCompositionProps}
    width={1920} height={1080} fps={30} durationInFrames={150}
    calculateMetadata={({ props }) => {
      const document = (props as EffectCompositionProps).document;
      return {
        width: document.canvas.width,
        height: document.canvas.height,
        fps: document.canvas.fps,
        durationInFrames: document.durationFrames,
      };
    }} />;
}

registerRoot(EffectRoot);
