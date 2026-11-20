import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProjectThumbnail from '../ProjectThumbnail';
import ProjectCard from '../ProjectCard';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { getTranslations } from '@/lib/i18n';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('项目卡片缩略图', () => {
  it('已有封面优先，失败后才尝试项目首片', () => {
    const { container } = render(<ProjectThumbnail projectId="项目/id" updatedAt="时间" coverUrl="/cover.png" />);
    const cover = container.querySelector('img')!;
    expect(cover.getAttribute('src')).toBe('/cover.png');
    fireEvent.error(cover);
    const automatic = container.querySelector('img')!;
    expect(automatic.getAttribute('src')).toBe('/api/video-projects/%E9%A1%B9%E7%9B%AE%2Fid/thumbnail?v=%E6%97%B6%E9%97%B4');
    fireEvent.error(cover);
    expect(container.querySelector('img')).toBe(automatic);
    fireEvent.load(automatic);
    expect(automatic.getAttribute('loading')).toBe('lazy');
    expect(automatic.getAttribute('decoding')).toBe('async');
    expect(automatic.getAttribute('alt')).toBe('');
    expect(automatic.getAttribute('aria-hidden')).toBe('true');
  });

  it('自动图失败先显示占位，三秒后只重试一次', () => {
    vi.useFakeTimers();
    const { container } = render(<ProjectThumbnail projectId="p" updatedAt="v" />);
    const first = container.querySelector('img')!;
    fireEvent.error(first);
    expect(container.querySelector('img')).toBeNull();
    act(() => vi.advanceTimersByTime(2999));
    expect(container.querySelector('img')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    const retry = container.querySelector('img')!;
    expect(retry.getAttribute('src')).toContain('&retry=1');
    fireEvent.error(first);
    expect(container.querySelector('img')).toBe(retry);
    fireEvent.error(retry);
    act(() => vi.advanceTimersByTime(30000));
    expect(container.querySelector('img')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('加载成功后不再重试，卸载时清除定时器', () => {
    vi.useFakeTimers();
    const first = render(<ProjectThumbnail projectId="p" updatedAt="v" />);
    const image = first.container.querySelector('img')!;
    fireEvent.load(image);
    fireEvent.error(image);
    expect(vi.getTimerCount()).toBe(0);
    first.unmount();
    const second = render(<ProjectThumbnail projectId="q" updatedAt="v" />);
    fireEvent.error(second.container.querySelector('img')!);
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('项目或版本切换后重置来源，旧事件与定时器不会串图', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ProjectThumbnail key="p:v" projectId="p" updatedAt="v" />);
    const old = container.querySelector('img')!;
    fireEvent.error(old);
    rerender(<ProjectThumbnail key="q:v2" projectId="q" updatedAt="v2" />);
    fireEvent.error(old);
    act(() => vi.advanceTimersByTime(3000));
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/api/video-projects/q/thumbnail?v=v2');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('卡片图片仍能打开项目，菜单重命名与删除不误触打开', () => {
    localStorage.setItem('ecliptrix-locale', 'zh-CN');
    const t = getTranslations('zh-CN');
    const onOpen = vi.fn(), onRename = vi.fn(), onDelete = vi.fn();
    const project = { id: 'p', name: '测试项目',
      created_at: '2026-11-20', updated_at: '2026-11-20' };
    const view = render(<LocaleProvider><ProjectCard project={project}
      onOpen={onOpen} onRename={onRename} onDelete={onDelete} /></LocaleProvider>);
    fireEvent.click(view.container.querySelector('img')!);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole('button', { name: t.videoProjects.projectActions }));
    fireEvent.click(view.getByRole('menuitem', { name: t.videoProjects.rename }));
    expect(onRename).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole('button', { name: t.videoProjects.projectActions }));
    fireEvent.click(view.getByRole('menuitem', { name: t.videoProjects.delete }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
