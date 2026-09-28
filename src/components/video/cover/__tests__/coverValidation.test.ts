import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoverDocument } from '../templates';
import { measureCoverCanvas } from '../CoverCanvas';
import { measureCoverText, validateCoverStructure } from '../coverValidation';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
describe('封面发布结构与真实布局门禁', () => {
  it('标签和空白不替代标题，AI不要求隐藏文字', () => {
    const doc = createCoverDocument({ mode: 'html', title: ' \n ' });
    doc.fields.subtitle = ''; doc.fields.label = '标签';
    expect(validateCoverStructure(doc)).toEqual([{ code: 'content-empty' }]);
    doc.mode = 'ai';
    expect(validateCoverStructure(doc)).toEqual([{ code: 'background-required' }]);
    doc.background = { ...doc.background, kind: 'asset', assetId: 'a' };
    expect(validateCoverStructure(doc, '/api/storage/files/a.png')).toEqual([]);
    expect(validateCoverStructure(doc, 'blob:preview')).toEqual([
      { code: 'background-missing' },
    ]);
  });
  it('HTML纯色不读取图片，混合必须有本地背景', () => {
    const doc = createCoverDocument({ mode: 'html', title: '标题' });
    expect(validateCoverStructure(doc)).toEqual([]);
    doc.mode = 'mixed';
    expect(validateCoverStructure(doc)).toEqual([{ code: 'background-required' }]);
  });
  it('缺画布、缺文字节点或零布局不能通过布尔兼容接口', () => {
    const root = document.createElement('div'); document.body.append(root);
    expect(measureCoverCanvas(root)).toBe(false);
    root.dataset.coverCanvas = ''; root.dataset.coverMode = 'html';
    expect(measureCoverText(root)).toEqual({ measurable: false, overflowFields: [] });
  });
  it('三个字段分别溢出时固定顺序报告，缺节点不冒充溢出', () => {
    const root = document.createElement('div');
    root.dataset.coverCanvas = ''; root.dataset.coverMode = 'html';
    document.body.append(root);
    const rect = { width: 100, height: 100, top: 0, left: 0, right: 100,
      bottom: 100, x: 0, y: 0, toJSON() {} };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1010);
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true,
      value: () => [rect] });
    for (const field of ['label', 'title', 'subtitle']) {
      const node = document.createElement('div');
      Object.assign(node.dataset, { coverText: field, initial: '40', minimum: '20', lines: '3' });
      node.textContent = field; root.append(node);
    }
    expect(measureCoverText(root)).toEqual({ measurable: true,
      overflowFields: ['title', 'subtitle', 'label'] });
    expect(measureCoverCanvas(root)).toBe(false);
    root.firstElementChild!.remove();
    expect(measureCoverText(root)).toEqual({ measurable: false, overflowFields: [] });
    root.replaceChildren(); root.dataset.coverMode = 'ai';
    expect(measureCoverCanvas(root)).toBe(true);
    root.remove(); expect(measureCoverCanvas(root)).toBe(false);
  });
});
