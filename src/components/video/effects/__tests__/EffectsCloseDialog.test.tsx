import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { EffectsCloseDialog } from '../EffectsCloseDialog';
afterEach(cleanup);
it.each([
  { key: 'z', ctrlKey: true },
  { key: 'z', metaKey: true },
  { key: 'z', ctrlKey: true, shiftKey: true },
  { key: 'y', ctrlKey: true },
])('确认层快捷键不修改背景草稿：%j', shortcut => {
  const backgroundKey = vi.fn();
  render(<LocaleProvider><div onKeyDown={backgroundKey}>
    <EffectsCloseDialog onContinue={vi.fn()} onDiscard={vi.fn()}
      onSave={vi.fn()} onClosed={vi.fn()} />
  </div></LocaleProvider>);
  const keep = screen.getByRole('button', { name: 'Continue editing' });
  fireEvent.keyDown(keep, shortcut);
  expect(backgroundKey).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(keep, { key: 'Enter' })).toBe(true);
});
it('初始焦点、每次 Tab 和 IME Escape 都在确认层正确处理', () => {
  const resume = vi.fn();
  render(<LocaleProvider><EffectsCloseDialog onContinue={resume}
    onDiscard={vi.fn()} onSave={vi.fn()} onClosed={vi.fn()} /></LocaleProvider>);
  const dialog = screen.getByRole('alertdialog');
  const keep = screen.getByRole('button', { name: 'Continue editing' });
  expect(document.activeElement).toBe(keep);
  fireEvent.keyDown(keep, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save and close' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(keep);
  fireEvent.compositionStart(dialog);
  fireEvent.keyDown(dialog, { key: 'Escape', isComposing: true, keyCode: 229 });
  expect(resume).not.toHaveBeenCalled();
  fireEvent.compositionEnd(dialog); fireEvent.keyDown(keep, { key: 'Escape' });
  expect(resume).toHaveBeenCalledOnce();
});
it('保存失败保留确认，错误摘要获得焦点；继续编辑撤销异步关闭', async () => {
  const close = vi.fn(), resume = vi.fn();
  const view = render(<LocaleProvider><EffectsCloseDialog onContinue={resume}
    onDiscard={vi.fn()} onSave={vi.fn().mockRejectedValue(new Error('EFFECT_VERSION_CONFLICT'))}
    onClosed={close} /></LocaleProvider>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save and close' })); });
  expect(document.activeElement).toBe(screen.getByRole('alert'));
  expect(close).not.toHaveBeenCalled();
  let finish!: () => void;
  view.rerender(<LocaleProvider><EffectsCloseDialog onContinue={resume}
    onDiscard={vi.fn()} onSave={() => new Promise<void>(done => { finish = done; })}
    onClosed={close} /></LocaleProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Save and close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
  await act(async () => { finish(); }); expect(close).not.toHaveBeenCalled();
});
