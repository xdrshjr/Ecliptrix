import { useEffect, useMemo, useState } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';
import type { EffectCompositionProps } from '@/types/effects';
import { EffectError } from '@/types/effects';
import { EFFECT_FONT_RESOURCES, getEffectFontKeys } from './fontResources';

const fontLoads = new Map<string, Promise<FontFace>>();

/** Share only in-flight and successful loads; failed resources can be retried. */
export function loadEffectFont(name: string, source: string, weight = '100 900'): Promise<FontFace> {
  const key = `${name}:${source}:${weight}`;
  const previous = fontLoads.get(key);
  if (previous) return previous;
  const pending = Promise.resolve().then(() =>
    new FontFace(`Effects-${name}`, `url("${source}")`,
      { weight }).load()).then(font => {
    document.fonts.add(font); return font;
  }).catch(() => {
    if (fontLoads.get(key) === pending) fontLoads.delete(key);
    throw new EffectError('EFFECT_FONT_LOAD_FAILED');
  });
  fontLoads.set(key, pending); return pending;
}

export const EFFECT_FONT_URLS = Object.fromEntries(
  EFFECT_FONT_RESOURCES.map(({ family, path }) =>
    [family, `/effects/fonts/${encodeURIComponent(path)}`]),
) as EffectCompositionProps['fontUrls'];

/** Await the exact bundled font; never silently render with a system font. */
export function useEffectFont(props: EffectCompositionProps): boolean {
  const family = props.document.typography.family;
  const keys = getEffectFontKeys(family);
  const key = JSON.stringify(keys.map(name => [name, props.fontUrls[name],
    EFFECT_FONT_RESOURCES.find(font => font.family === name)!.weight]));
  const [readyKey, setReadyKey] = useState('');
  const [failure, setFailure] = useState<{ key: string; error: Error }>();
  const handle = useMemo(() => ({ id: delayRender(`effects offline font ${key}`), released: false }), [key]);
  useEffect(() => {
    let active = true;
    const release = () => {
      if (!handle.released) { handle.released = true; continueRender(handle.id); }
    };
    const loading = getEffectFontKeys(family).map(name => loadEffectFont(name,
      props.fontUrls[name], EFFECT_FONT_RESOURCES.find(font => font.family === name)!.weight));
    Promise.all(loading).then(() => {
      if (active) setReadyKey(key);
      release();
    }).catch(error => {
      release();
      if (active) { setFailure({ key, error }); cancelRender(error); }
    });
    return () => { active = false; release(); };
  }, [family, props.fontUrls, key, handle]);
  if (failure?.key === key) throw failure.error;
  return readyKey === key;
}
