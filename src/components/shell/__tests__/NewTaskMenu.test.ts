import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- Vite raw source for the JSX-preserve test loader.
import menuSource from '../NewTaskMenu.tsx?raw';
// @ts-expect-error -- Vite raw source.
import taskbarSource from '../../VerticalTaskbar.tsx?raw';
import {
  compileComponent, localeContextModule, reactModules,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import type { NewTaskMenuProps } from '../NewTaskMenu';
import type { TaskType, Tab } from '@/types';

interface TaskbarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab(tabId: string): void;
  onCloseTab(tabId: string): void;
  onOpenTask?(type: TaskType): void;
  isBlurred?: boolean;
}

let Menu: React.FC<NewTaskMenuProps>;
let Taskbar: React.FC<TaskbarProps>;

beforeAll(() => {
  const shared = { ...reactModules(), ...localeContextModule(() => 'zh-CN') };
  const menuModule = compileComponent<NewTaskMenuProps>(menuSource, shared);
  Menu = menuModule;
  Taskbar = compileComponent<TaskbarProps>(taskbarSource, {
    ...shared,
    '@/components/shell/NewTaskMenu': { __esModule: true, default: menuModule },
  });
});

afterEach(cleanup);

function renderMenu(overrides: Partial<NewTaskMenuProps> = {}) {
  const trigger = React.createRef<HTMLButtonElement>();
  const onChoose = vi.fn();
  const onClose = vi.fn();
  render(React.createElement(
    React.Fragment, null,
    React.createElement('button', { ref: trigger }, 'plus'),
    React.createElement(Menu, {
      existingTypes: new Set<TaskType>(['video']),
      onChoose,
      onClose,
      returnFocusRef: trigger,
      renderIcon: () => null,
      labelFor: (type: TaskType) => (type === 'chat' ? 'AI 对话' : '视频编辑'),
      ...overrides,
    }),
  ));
  return { trigger, onChoose, onClose };
}

describe('NewTaskMenu', () => {
  it('arrow_keys_cycle_items', () => {
    renderMenu();
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[1]);
  });

  it('choose_calls_onChoose_with_type', () => {
    const { onChoose } = renderMenu();
    fireEvent.click(screen.getAllByRole('menuitem')[1]);
    expect(onChoose).toHaveBeenCalledWith('video');
  });

  it('shows_switch_hint_for_existing_type', () => {
    renderMenu();
    const [chatItem, videoItem] = screen.getAllByRole('menuitem');
    expect(chatItem.textContent).toContain('新建');
    expect(videoItem.textContent).toContain('已打开，点击切换');
  });

  it('escape_closes_and_returns_focus', () => {
    const { trigger, onClose } = renderMenu();
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger.current);
  });

  it('outside_pointerdown_closes', () => {
    const { onClose } = renderMenu();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pointerdown_on_trigger_is_not_outside', () => {
    const { trigger, onClose } = renderMenu();
    fireEvent.pointerDown(trigger.current!);
    fireEvent.pointerDown(screen.getAllByRole('menuitem')[0]);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('VerticalTaskbar with NewTaskMenu', () => {
  const tabs: Tab[] = [
    { id: 'tv', taskId: 'v', title: '视频编辑', isActive: true, type: 'video' },
  ];

  function renderTaskbar() {
    const onOpenTask = vi.fn();
    const utils = render(React.createElement(Taskbar, {
      tabs, activeTabId: 'tv', onSelectTab: vi.fn(),
      onCloseTab: vi.fn(), onOpenTask,
    }));
    const taskbar = utils.container.querySelector('.vertical-taskbar')!;
    const plus = utils.container.querySelectorAll('.new-task-button');
    return { onOpenTask, taskbar, plus };
  }

  it('renders_exactly_one_plus_button', () => {
    const { plus } = renderTaskbar();
    expect(plus).toHaveLength(1);
    expect(plus[0].getAttribute('aria-haspopup')).toBe('menu');
  });

  it('menu_is_portaled_outside_taskbar', () => {
    const { taskbar, plus } = renderTaskbar();
    act(() => { fireEvent.click(plus[0]); });
    const menu = screen.getByRole('menu');
    expect(taskbar.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('clicking_menu_item_does_not_toggle_taskbar_expansion', () => {
    const { taskbar, plus, onOpenTask } = renderTaskbar();
    expect(taskbar.className).toContain('collapsed');
    act(() => { fireEvent.click(plus[0]); });
    act(() => { fireEvent.click(screen.getAllByRole('menuitem')[0]); });
    expect(onOpenTask).toHaveBeenCalledWith('chat');
    expect(taskbar.className).toContain('collapsed');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
