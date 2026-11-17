import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo } from 'remotion';
import type { EffectCompositionProps } from '../../../types/effects';
import { Titles } from './Titles';
import { Typewriter } from './Typewriter';
import { LowerThirds } from './LowerThirds';
import { ImageReveal } from './ImageReveal';
import { Slideshow } from './Slideshow';
import { SplitScreen } from './SplitScreen';
import { Product } from './Product';
import { Callouts } from './Callouts';
import { Counters } from './Counters';
import { Countdown } from './Countdown';
import { VideoLook } from './VideoLook';
import { Backgrounds } from './Backgrounds';
import { getEffectTemplate } from '../catalog';
import { getEffectFontChain } from '../fontResources';
import { normalizeEffectDisplayText } from '../textLayout';
import { useEffectFont } from '../fonts';
import { getInputStyle } from './layout';
import { EffectTextResources } from './EffectText';

const COMPONENTS: Record<string, React.ComponentType<EffectCompositionProps>> = {
  Titles, Typewriter, LowerThirds, ImageReveal, Slideshow, SplitScreen,
  Product, Callouts, Counters, Countdown, VideoLook, Backgrounds,
};

/** Shared composition; asset URLs are resolved per preview/render session. */
export function EffectComposition(props: EffectCompositionProps) {
  const isFontReady = useEffectFont(props);
  const { document, assets } = props;
  const base = document.inputs.find((binding) => binding.slot === 'base');
  const Component = COMPONENTS[getEffectTemplate(document.templateId).componentId];
  if (!isFontReady) return <AbsoluteFill />;
  return (
    <AbsoluteFill style={{
      backgroundColor: document.palette.background,
      color: document.palette.foreground,
      fontFamily: getEffectFontChain(document.typography.family),
    }}>
      {base?.kind === 'video' && (
        <OffthreadVideo src={assets[base.assetId]}
          trimBefore={Math.round((base.trimStartSeconds ?? 0) * 30)}
          style={getInputStyle(base)} />
      )}
      {base?.kind === 'image' && (
        <Img src={assets[base.assetId]} style={getInputStyle(base)} />
      )}
      <EffectTextResources.Provider value={JSON.stringify(props.fontUrls)}>
      <Component {...props} document={{ ...document, content: {
        title: normalizeEffectDisplayText(document.content.title),
        subtitle: normalizeEffectDisplayText(document.content.subtitle),
      } }} />
      </EffectTextResources.Provider>
    </AbsoluteFill>
  );
}
