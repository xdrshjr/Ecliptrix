import { expect, it } from 'vitest';
import { createEffectDocument } from '../catalog';
import { getEffectTextBox, normalizeEffectDisplayText, getRenderedEffectFields } from '../textLayout';
import vectors from '../__fixtures__/text-layout-vectors.json';

it('共享 golden 覆盖十二组件、三画布及参数边界，排版不改持久身份', () => {
  for (const vector of vectors) {
    const document = createEffectDocument(vector.templateId);
    Object.assign(document, { canvas: vector.canvas, params: vector.params });
    document.typography.scale = vector.scale;
    const before = JSON.stringify(document);
    const box = getEffectTextBox(document, vector.field as 'title' | 'subtitle');
    for (const [key, value] of Object.entries(vector.expectedBox))
      expect(box[key as keyof typeof box]).toBeCloseTo(value, 8);
    expect(JSON.stringify(document)).toBe(before);
  }
});
it('展示视图规范化换行和 tab，不吞显式空行或尾行', () => {
  expect(normalizeEffectDisplayText('a\r\nb\rc\n\n\t\n')).toBe('a\nb\nc\n\n    \n');
  expect(getRenderedEffectFields(createEffectDocument('type-lines'))).toEqual(['title']);
  expect(getRenderedEffectFields(createEffectDocument('title-rise'))).toEqual(['title', 'subtitle']);
});
