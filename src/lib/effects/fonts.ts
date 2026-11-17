import { useEffect, useMemo, useState } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';
import type { EffectCompositionProps } from '@/types/effects';
import { EffectError } from '@/types/effects';

const FONT_FILES = {
  sans: 'NotoSansSC[wght].ttf', serif: 'NotoSerifSC[wght].ttf',
  mono: 'NotoSansMono[wdth,wght].ttf',
};
const fontLoads = new Map<string, Promise<FontFace>>();

/** Share only in-flight and successful loads; failed resources can be retried. */
export function loadEffectFont(name: string, source: string): Promise<FontFace> {
  const key = `${name}:${source}`;
  const previous = fontLoads.get(key);
  if (previous) return previous;
  const pending = Promise.resolve().then(() =>
    new FontFace(`Effects-${name}`, `url("${source}")`,
      { weight: '100 900' }).load()).then(font => {
    document.fonts.add(font); return font;
  }).catch(() => {
    if (fontLoads.get(key) === pending) fontLoads.delete(key);
    throw new EffectError('EFFECT_FONT_LOAD_FAILED');
  });
  fontLoads.set(key, pending); return pending;
}

export const EFFECT_FONT_URLS = Object.fromEntries(
  Object.entries(FONT_FILES).map(([family, file]) =>
    [family, `/effects/fonts/${encodeURIComponent(file)}`]),
) as EffectCompositionProps['fontUrls'];

/** Await the exact bundled font; never silently render with a system font. */
export function useEffectFont(props: EffectCompositionProps): boolean {
  const family = props.document.typography.family;
  const url = props.fontUrls[family];
  const sansUrl = props.fontUrls.sans;
  const key = `${family}:${url}:${sansUrl}`;
  const [readyKey, setReadyKey] = useState('');
  const handle = useMemo(() => delayRender(`effects offline font ${key}`), [key]);
  useEffect(() => {
    let active = true;
    let released = false;
    const release = () => {
      if (!released) { released = true; continueRender(handle); }
    };
    const families: ('sans' | 'serif' | 'mono')[] = family === 'mono'
      ? [family, 'sans'] : [family];
    const loading = families.map(name => loadEffectFont(name,
      name === 'sans' ? sansUrl : url));
    Promise.all(loading).then(() => {
      if (active) setReadyKey(key);
      release();
    }).catch(error => { release(); if (active) cancelRender(error); });
    return () => { active = false; release(); };
  }, [family, url, sansUrl, key, handle]);
  return readyKey === key;
}
