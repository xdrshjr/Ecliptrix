import lock from '../../../public/effects/fonts/source-lock.json';
import type { EffectDocument } from '@/types/effects';

export type EffectFontKey = 'sans' | 'serif' | 'mono' | 'emoji';
export const EFFECT_FONT_RESOURCES = lock.resources.filter(item => item.role === 'font') as
  (typeof lock.resources[number] & { family: EffectFontKey; weight: string })[];

export function getEffectFontKeys(family: EffectDocument['typography']['family']): EffectFontKey[] {
  return family === 'sans' ? ['sans', 'emoji'] : [family, 'sans', 'emoji'];
}

/** CSS and canvas use exactly the same offline fallback chain. */
export function getEffectFontChain(family: EffectDocument['typography']['family']): string {
  return getEffectFontKeys(family).map(name => `Effects-${name}`).join(', ');
}
