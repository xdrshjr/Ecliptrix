import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { createEffectDocument, getEffectTemplate } from '@/lib/effects/catalog';
import { EffectsSourcePicker } from '../EffectsSourcePicker';

const upload = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/http-client', () => ({ http: { upload } }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function picker(templateId: string, onChoose = vi.fn()) {
  return <LocaleProvider><EffectsSourcePicker template={getEffectTemplate(templateId)}
    document={createEffectDocument(templateId)} assets={[]} materials={[]}
    onChoose={onChoose} onChange={vi.fn()} /></LocaleProvider>;
}

it('上传期间暂停素材下拉选择，避免后返回的上传覆盖已选素材', async () => {
  let finish!: (result: unknown) => void;
  upload.mockImplementation(() => new Promise(done => { finish = done; }));
  const view = render(picker('image-zoom'));
  fireEvent.change(view.container.querySelector('input[type=file]')!, {
    target: { files: [new File(['png'], 'upload.png', { type: 'image/png' })] },
  });
  expect(Array.from(view.container.querySelectorAll('select'))
    .every(select => select.disabled)).toBe(true);
  await act(async () => { finish({ success: true, file_url: '/api/storage/files/new.png' }); });
  expect(Array.from(view.container.querySelectorAll('select'))
    .every(select => !select.disabled)).toBe(true);
});

it('切换模板会取消上传，旧回包不会绑定到新模板或重置新上传状态', async () => {
  let finish!: (result: unknown) => void;
  upload.mockImplementationOnce(() => new Promise(done => { finish = done; }));
  const choose = vi.fn();
  const view = render(picker('image-zoom', choose));
  fireEvent.change(view.container.querySelector('input[type=file]')!, {
    target: { files: [new File(['png'], 'old.png', { type: 'image/png' })] },
  });
  const signal = upload.mock.calls[0][2].signal as AbortSignal;
  view.rerender(picker('image-wipe', choose));
  expect(signal.aborted).toBe(true);
  expect((view.container.querySelector('input[type=file]') as HTMLInputElement).disabled)
    .toBe(false);
  let finishNew!: (result: unknown) => void;
  upload.mockImplementationOnce(() => new Promise(done => { finishNew = done; }));
  fireEvent.change(view.container.querySelector('input[type=file]')!, {
    target: { files: [new File(['png'], 'new.png', { type: 'image/png' })] },
  });
  await act(async () => { finish({ success: true, file_url: '/api/storage/files/old.png' }); });
  expect(choose).not.toHaveBeenCalled();
  expect((view.container.querySelector('input[type=file]') as HTMLInputElement).disabled)
    .toBe(true);
  await act(async () => { finishNew({ success: true, file_url: '/api/storage/files/new.png' }); });
  expect(choose).toHaveBeenCalledWith('base', expect.objectContaining({ name: 'new.png' }));
});
