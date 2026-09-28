import { describe, expect, it, vi } from 'vitest';
vi.mock('html-to-image', () => ({ toBlob: vi.fn(async () => null) }));
import { renderCover } from '../renderCover';
describe('封面精确渲染', () => {
  it('取消不会上传空白成品', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(renderCover(document.createElement('div'), {
      width: 1920, height: 1080, signal: abort.signal,
    })).rejects.toThrow();
  });
  it('拒绝空Blob而不降分辨率', async () => {
    await expect(renderCover(document.createElement('div'), {
      width: 1920, height: 1080,
    })).rejects.toThrow('COVER_RENDER_FAILED');
  });
});
