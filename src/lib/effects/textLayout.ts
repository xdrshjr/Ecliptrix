import rules from './textLayout.json';
import { getEffectTemplate } from './catalog';
import { EffectError, type EffectDocument, type EffectTextBox } from '@/types/effects';

export type EffectTextField = 'title' | 'subtitle';
export function normalizeEffectDisplayText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
}
export function getRenderedEffectFields(document: EffectDocument): EffectTextField[] {
  const component = getEffectTemplate(document.templateId).componentId;
  return [...rules.components[component as keyof typeof rules.components].renderedFields] as EffectTextField[];
}

/** Numbers in untransformed source pixels, shared with the backend export. */
export function getEffectTextBox(document: EffectDocument, field: EffectTextField): EffectTextBox {
  const component = getEffectTemplate(document.templateId).componentId;
  const rule = rules.components[component as keyof typeof rules.components];
  const { width: w, height: h } = document.canvas;
  let width = w * rule.widthRatio, height = h * rule.heightRatio;
  if (rule.kind === 'product') {
    if (w <= h * 1.5) height = h * (field === 'title' ? 0.15 : 0.10);
    else width = Math.min(w * 0.4, w * 0.88
      - Math.min(Number(document.params.cardScale) * Math.min(w, h), h * 0.85)
      - Math.min(w, h) * 0.03);
  } else if (rule.kind === 'callout') {
    const top = h * (Number(document.params.pointY) > 0.5 ? 0.12 : 0.72);
    height = Math.min(h * 0.35, h * 0.94 - top);
  }
  if (!(width > 0 && height > 0)) throw new EffectError('EFFECT_TEXT_OVERFLOW');
  return { width, height, sizeRatio: rule.sizeRatio[field], minScale: 0.6, lineHeight: 1.3 };
}
