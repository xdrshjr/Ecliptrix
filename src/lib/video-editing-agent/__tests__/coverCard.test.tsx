import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { translations } from '@/lib/i18n';
import type { AgentToolCallRecord } from '@/types';
import { CoverToolStatus } from '@/components/video/components/VideoChatWindow/AgentToolCallCard';
import AgentExecutionNode from '@/components/video/components/VideoChatWindow/timeline/AgentExecutionNode';

vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations['zh-CN'] }) }));
afterEach(cleanup);

function call(state = 'not_applied', projectId: string | undefined = 'project'): AgentToolCallRecord {
  return { id: 'operation', name: 'create_video_cover', params: {}, status: 'completed',
    result: { coverStatus: { state, projectId, revisionId: 'revision',
      thumbnailUrl: '/api/storage/files/projects/project/covers/assets/image.png' } } };
}

describe('Agent封面结果卡', () => {
  it('显示本地缩略图，编辑和应用事件带项目、操作和版本', () => {
    const listener = vi.fn(); window.addEventListener('ecliptrix:cover-action', listener);
    try {
      render(<CoverToolStatus toolCall={call()} />);
      expect(screen.getByRole('img')).toHaveAttribute('src',
        '/api/storage/files/projects/project/covers/assets/image.png');
      fireEvent.click(screen.getByRole('button', { name: '编辑封面' }));
      fireEvent.click(screen.getByRole('button', { name: '应用到视频' }));
      expect(listener.mock.calls.map(([event]) => event.detail)).toEqual([
        { projectId: 'project', operationId: 'operation', revisionId: 'revision', action: 'edit' },
        { projectId: 'project', operationId: 'operation', revisionId: 'revision', action: 'apply' },
      ]);
      expect(screen.queryByRole('button', { name: '定位到轨道' })).toBeNull();
    } finally { window.removeEventListener('ecliptrix:cover-action', listener); }
  });

  it('实际折叠执行节点也提供已应用封面的定位操作', () => {
    const listener = vi.fn(); window.addEventListener('ecliptrix:cover-action', listener);
    try {
      render(<AgentExecutionNode node={{ kind: 'execution', id: 'node',
        timestamp: new Date(), toolCalls: [call('applied')], isActive: false, messageId: 'message' }} />);
      fireEvent.click(screen.getByRole('button', { name: '定位到轨道' }));
      expect(listener.mock.calls[0][0].detail).toEqual({ projectId: 'project',
        operationId: 'operation', action: 'locate', revisionId: 'revision' });
    } finally { window.removeEventListener('ecliptrix:cover-action', listener); }
  });

  it('历史状态缺少可信项目时禁用操作，不采用模型参数的projectId', () => {
    const old = call();
    (old.result as { coverStatus: { projectId?: string } }).coverStatus.projectId = undefined;
    old.params.projectId = 'untrusted';
    render(<CoverToolStatus toolCall={old} />);
    expect(screen.getByRole('button', { name: '编辑封面' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用到视频' })).toBeDisabled();
  });

  it('图片就绪但没有成品版本时只提供编辑，排队不显示成品操作', () => {
    const ready = call('image_ready');
    delete (ready.result as { coverStatus: { revisionId?: string } }).coverStatus.revisionId;
    const view = render(<CoverToolStatus toolCall={ready} />);
    expect(screen.getByRole('button', { name: '编辑封面' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '应用到视频' })).toBeNull();
    view.rerender(<CoverToolStatus toolCall={call('submitted')} />);
    expect(screen.queryByRole('button', { name: '编辑封面' })).toBeNull();
  });

  it('不从历史记录加载外部缩略图', () => {
    const remote = call();
    (remote.result as { coverStatus: { thumbnailUrl: string } }).coverStatus.thumbnailUrl = 'https://example.com/image.png';
    render(<CoverToolStatus toolCall={remote} />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
