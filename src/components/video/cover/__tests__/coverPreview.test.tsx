import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { coverSize, fitCoverPreview } from '../layout';
import { CoverTemplatePicker } from '../CoverTemplatePicker';
import { CoverPreviewDialog } from '../CoverPreviewDialog';
import { createCoverDocument } from '../templates';
import type { CoverAspectRatio } from '@/types/videoCover';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'] }),
}));
afterEach(cleanup);

it('原生预览Esc只关闭当前层并恢复触发按钮焦点', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const outerEscape = vi.fn();
  function Fixture() {
    const [open, setOpen] = React.useState(false);
    return <div onKeyDown={outerEscape}><button onClick={() => setOpen(true)}>打开预览</button>
      <CoverPreviewDialog open={open} title="预览"
        document={createCoverDocument({ aspectRatio: '9:16' })}
        onClose={() => setOpen(false)} /></div>;
  }
  render(<Fixture />);
  const trigger = screen.getByRole('button', { name: '打开预览' });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog');
  expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(outerEscape).not.toHaveBeenCalled();
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveFocus();
});

it('历史图片失败导致原触发按钮禁用时回到资源入口', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  function Fixture() {
    const [open, setOpen] = React.useState(false);
    const [failed, setFailed] = React.useState(false);
    const fallback = React.useRef<HTMLButtonElement>(null);
    return <><button ref={fallback}>最近成品</button>
      <button disabled={failed} onClick={() => setOpen(true)}>历史预览</button>
      <CoverPreviewDialog open={open} title="成品" imageUrl="/history.png"
        onClose={() => setOpen(false)}
        onImageError={() => { setFailed(true); setOpen(false); }}
        onFocusFallback={() => fallback.current?.focus()} /></>;
  }
  render(<Fixture />);
  const trigger = screen.getByRole('button', { name: '历史预览' });
  trigger.focus(); fireEvent.click(trigger);
  fireEvent.error(document.querySelector('.cover-history-image')!);
  expect(screen.getByRole('button', { name: '最近成品' })).toHaveFocus();
});

it.each(['16:9', '9:16', '1:1', '4:3', '21:9'] as CoverAspectRatio[])(
  '%s 完整适配可用矩形且不放大', ratio => {
    const output = coverSize(ratio);
    const fitted = fitCoverPreview(output, { width: 800, height: 400 });
    expect(fitted.width).toBeLessThanOrEqual(768);
    expect(fitted.height).toBeLessThanOrEqual(368);
    expect(fitted.width / fitted.height).toBeCloseTo(output.width / output.height);
    expect(fitted.scale).toBeLessThanOrEqual(1);
    expect(fitCoverPreview(output, { width: 20, height: 10 }).scale).toBe(0);
  });
it.each([0, -1, NaN, Infinity])('无效尺寸 %s 不沿用旧缩放', width => {
  expect(fitCoverPreview({ width, height: 1920 }, { width: 800, height: 400 }))
    .toEqual({ scale: 0, width: 0, height: 0 });
});
it.each(['16:9', '9:16', '1:1', '4:3', '21:9'] as CoverAspectRatio[])(
  '五张模板全部使用 %s 工程比例', aspectRatio => {
    render(<CoverTemplatePicker value="editorial" aspectRatio={aspectRatio}
      onChange={vi.fn()} />);
    expect(screen.getAllByText(aspectRatio)).toHaveLength(5);
    const canvases = document.querySelectorAll('[data-cover-canvas]');
    expect(canvases).toHaveLength(5);
    for (const canvas of Array.from(canvases)) {
      expect(canvas).toHaveStyle({ width: `${coverSize(aspectRatio).width}px`,
        height: `${coverSize(aspectRatio).height}px` });
    }
  });
