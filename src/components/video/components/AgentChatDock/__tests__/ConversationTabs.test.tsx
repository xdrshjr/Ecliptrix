import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { Conversation } from '@/types';
import ConversationTabs from '../ConversationTabs';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'] }),
}));
afterEach(cleanup);
const conversations = ['A', 'B', 'C'].map(id => ({
  id, title: id, messages: [], createdAt: new Date(0), updatedAt: new Date(0),
})) satisfies Conversation[];
const props = () => ({
  conversations, activeConversationId: 'A', idPrefix: 'chat',
  onSelect: vi.fn(() => ({ ok: true })),
  onCreate: vi.fn(() => ({ ok: true, conversationId: 'D' })),
  onRename: vi.fn(() => ({ ok: true })), onDelete: vi.fn(),
});

describe('会话页签', () => {
  it('方向键只移动焦点，空格激活并隔离工作台快捷键', () => {
    const options = props();
    const workspace = vi.fn();
    render(<div onKeyDown={workspace}><ConversationTabs {...options} /></div>);
    const tabs = screen.getAllByRole('tab');
    act(() => tabs[0].focus());
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
    expect(options.onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(tabs[1], { key: ' ' });
    expect(options.onSelect).toHaveBeenCalledWith('B');
    expect(workspace).not.toHaveBeenCalled();
    expect(tabs[0]).toHaveAttribute('aria-controls', 'chat-panel-A');
  });

  it('忙碌时保留页签语义和焦点，但拒绝激活', () => {
    const options = props();
    render(<ConversationTabs {...options} busyReason="正在回复" />);
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(options.onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'B' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: '新建会话' })).toBeDisabled();
  });

  it('F2 只编辑活动页签，Enter 只提交一次并保留原 tab', () => {
    const options = props();
    render(<ConversationTabs {...options} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'B' }), { key: 'F2' });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'F2' });
    const input = screen.getByRole('textbox');
    expect(screen.getByRole('tab', { name: 'A' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: ' 新名称 ' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(options.onRename).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(options.onRename).toHaveBeenCalledExactlyOnceWith('A', '新名称');
    expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
  });

  it('空名称显示校验错误；Escape 取消且不因 blur 提交', () => {
    const options = props();
    render(<ConversationTabs {...options} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'F2' });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: ' ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('1–40');
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(options.onRename).not.toHaveBeenCalled();
  });

  it('菜单键盘焦点离开后收起，并让菜单项退出普通 Tab 顺序', () => {
    render(<><ConversationTabs {...props()} /><button>输入区</button></>);
    fireEvent.click(screen.getByRole('button', { name: '当前会话操作' }));
    expect(screen.getByRole('menuitem', { name: '重命名' })).toHaveFocus();
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item).toHaveAttribute('tabindex', '-1');
    }
    act(() => screen.getByRole('button', { name: '输入区' }).focus());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: '输入区' })).toHaveFocus();
  });

  it('Shift+Tab 回到菜单按钮，重新点击已展开的菜单按钮可收起', () => {
    render(<ConversationTabs {...props()} />);
    const trigger = screen.getByRole('button', { name: '当前会话操作' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: '重命名' }),
      { key: 'Tab', shiftKey: true });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    act(() => trigger.focus());
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
