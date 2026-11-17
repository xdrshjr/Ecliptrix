import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createEffectDocument } from '../catalog';
import { EffectText } from '../compositions/EffectText';
const handles = vi.hoisted(() => ({ delay: vi.fn(() => Math.random()), resume: vi.fn(), cancel: vi.fn() }));
vi.mock('remotion', () => ({ delayRender: handles.delay, continueRender: handles.resume, cancelRender: handles.cancel }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
// jsdom covers ownership and markup only. Browser integration proves geometry.
it('打字光标保留空帧位置与闪烁，闪烁不重新测量全文', () => {
  const document = createEffectDocument('type-cursor');
  document.content.title = 'AB';
  const view = render(<EffectText document={document} reveal={0} cursor cursorVisible />);
  expect(view.container.querySelector('[data-effects-cursor]')).toHaveStyle({ opacity: '1' });
  const calls = handles.delay.mock.calls.length;
  view.rerender(<EffectText document={document} reveal={0.5} cursor cursorVisible={false} />);
  expect(view.container.querySelectorAll('[data-effects-cursor]')).toHaveLength(1);
  expect(view.container.querySelector('[data-effects-cursor]')).toHaveStyle({ opacity: '0' });
  expect(handles.delay).toHaveBeenCalledTimes(calls);
});
it('空行与尾随行保留，输入切换释放旧等待，不改变原文档', () => {
  const document = createEffectDocument('type-lines');
  document.content.title = '一\r\n\n二\n';
  const before = JSON.stringify(document);
  const view = render(<EffectText document={document} reveal={0.3} revealLines />);
  expect(view.container.querySelector('[data-effects-text]')!.children).toHaveLength(4);
  expect(JSON.stringify(document)).toBe(before);
  view.rerender(<EffectText document={{ ...document, content: { title: '新稿', subtitle: '' } }} />);
  view.unmount();
  const released = handles.resume.mock.calls.map(call => call[0]);
  expect(new Set(released).size).toBe(released.length);
  expect(handles.resume).toHaveBeenCalledTimes(handles.delay.mock.calls.length);
});
it('空字段不产生行，隐藏测量节点和正式输出分离', () => {
  const document = createEffectDocument(); document.content.subtitle = ''; document.content.title = 'Title';
  const view = render(<EffectText document={document} field="subtitle" />);
  expect(view.container.children).toHaveLength(0);
  view.rerender(<EffectText document={document} />);
  expect(view.container.querySelectorAll('[data-effects-measure]')).toHaveLength(1);
  expect(view.container.querySelectorAll('[data-effects-text]')).toHaveLength(1);
  expect(handles.cancel).not.toHaveBeenCalled();
});

it('数字帧使用最终值测量，当前值只影响正式显示且不重开布局等待', () => {
  const document = createEffectDocument('counter-up');
  const box = { width: 1000, height: 500, sizeRatio: 0.19, minScale: 0.6 as const, lineHeight: 1.3 as const };
  const view = render(<EffectText document={document} field="params.value" text="1000000ABCDEFGH" displayText="0ABCDEFGH" box={box} />);
  expect(view.container.querySelector('[data-effects-measure]')).toHaveTextContent('1000000ABCDEFGH');
  expect(view.container.querySelector('[data-effects-text]')).toHaveTextContent('0ABCDEFGH');
  const calls = handles.delay.mock.calls.length;
  view.rerender(<EffectText document={document} field="params.value" text="1000000ABCDEFGH" displayText="1000000ABCDEFGH" box={box} />);
  expect(handles.delay).toHaveBeenCalledTimes(calls);
  expect(view.container.querySelector('[data-effects-measure]')).toHaveTextContent('1000000ABCDEFGH');
  view.rerender(<EffectText document={document} field="params.value" text={'1000000A\nB'} displayText={'0A\nB'} box={box} />);
  const displayed = view.container.querySelector('[data-effects-text]')!;
  expect(displayed.children).toHaveLength(2);
  expect(displayed.children[0]).toHaveTextContent('0A');
  expect(displayed.children[1]).toHaveTextContent('B');
});
