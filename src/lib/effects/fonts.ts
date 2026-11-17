import { useEffect, useMemo, useState } from 'react';
import { cancelRender, continueRender, delayRender } from 'remotion';
import type { EffectCompositionProps } from '@/types/effects';

const FONT_FILES = {
  sans: 'NotoSansSC[wght].ttf', serif: 'NotoSerifSC[wght].ttf',
  mono: 'NotoSansMono[wdth,wght].ttf',
};
const fontLoads = new Map<string, Promise<FontFace>>();

export const EFFECT_FONT_URLS = Object.fromEntries(
  Object.entries(FONT_FILES).map(([family, file]) =>
    [family, `/effects/fonts/${encodeURIComponent(file)}`]),
) as EffectCompositionProps['fontUrls'];

/** Await the exact bundled font; never silently render with a system font. */
export function useEffectFont(props: EffectCompositionProps): boolean {
  const family = props.document.typography.family;
  const url = props.fontUrls[family];
  const key = `${family}:${url}:${props.fontUrls.sans}`;
  const [readyKey, setReadyKey] = useState('');
  const handle = useMemo(() => delayRender('effects offline font'), [key]);
  useEffect(() => {
    let active = true;
    const families: ('sans' | 'serif' | 'mono')[] = family === 'mono'
      ? [family, 'sans'] : [family];
    const loading = families.map(name => {
      const source = props.fontUrls[name];
      const fontKey = `${name}:${source}`;
      let loaded = fontLoads.get(fontKey);
      if (!loaded) {
        loaded = new FontFace(`Effects-${name}`, `url("${source}")`,
          { weight: '100 900' }).load().then(font => {
          document.fonts.add(font); return font;
        });
        fontLoads.set(fontKey, loaded);
      }
      return loaded;
    });
    Promise.all(loading).then(() => {
      if (active) { setReadyKey(key); continueRender(handle); }
    }).catch(error => { if (active) cancelRender(error); });
    return () => { active = false; continueRender(handle); };
  }, [family, url, key, handle]);
  return readyKey === key;
}
