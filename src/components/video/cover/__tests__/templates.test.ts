import { describe, expect, it, vi } from 'vitest';
import { COVER_TEMPLATES, createCoverDocument, applyCoverTemplate } from '../templates';
import { coverSize, templateLayout, fitCoverText } from '../layout';

describe('封面模板契约', () => {
  it('按实际行数测量缩放预览，字形高度不误报单行标签溢出', () => {
    const node = document.createElement('div');
    node.textContent = '创作笔记 01';
    Object.defineProperties(node, {
      clientWidth: { value: 200 }, scrollWidth: { value: 100 },
      clientHeight: { value: 54 }, scrollHeight: { value: 54 },
    });
    const range = vi.spyOn(document, 'createRange').mockReturnValue({
      selectNodeContents: vi.fn(),
      getBoundingClientRect: () => ({ height: 37 }),
      getClientRects: () => [{ top: 4, width: 100, height: 37 }],
    } as unknown as Range);
    expect(fitCoverText(node, { initial: 28, minimum: 28, maxLines: 1 })).toBe(true);
    range.mockReturnValue({ selectNodeContents: vi.fn(),
      getClientRects: () => [{ top: 4, width: 30 }, { top: 10, width: 30 }],
    } as unknown as Range);
    expect(fitCoverText(node, { initial: 28, minimum: 28, maxLines: 1 })).toBe(false);
    range.mockRestore();
  });
  it('提供五模板和十五种安全区布局', () => {
    expect(Object.keys(COVER_TEMPLATES)).toHaveLength(5);
    for (const id of Object.keys(COVER_TEMPLATES)) {
      for (const ratio of ['16:9', '9:16', '1:1'] as const) {
        const doc = createCoverDocument({ templateId: id as never, aspectRatio: ratio });
        const box = templateLayout(doc).title;
        expect(box.x + box.width).toBeLessThanOrEqual(0.95);
        expect(box.y + box.height).toBeLessThanOrEqual(0.95);
      }
    }
  });
  it('切换模板保留文字和背景，尺寸与导出一致', () => {
    const doc = createCoverDocument({ title: '保留中文 / Hello 🎬' });
    doc.background = { ...doc.background, kind: 'asset', assetId: 'local' };
    const next = applyCoverTemplate(doc, 'bold');
    expect(next.fields).toEqual(doc.fields);
    expect(next.background).toEqual(doc.background);
    expect(coverSize('21:9')).toEqual({ width: 2560, height: 1080 });
  });
  it('五种比例的标签与标题保持独立可读区域', () => {
    for (const templateId of Object.keys(COVER_TEMPLATES)) {
      for (const aspectRatio of ['16:9', '9:16', '1:1', '4:3', '21:9'] as const) {
        const layout = templateLayout(createCoverDocument({
          templateId: templateId as keyof typeof COVER_TEMPLATES, aspectRatio,
        }));
        const { title, label } = layout;
        const overlaps = title.x < label.x + label.width &&
          label.x < title.x + title.width &&
          title.y < label.y + label.height && label.y < title.y + title.height;
        expect(overlaps, `${templateId} / ${aspectRatio}`).toBe(false);
      }
    }
  });
});
