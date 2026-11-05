import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { ToolRegistry } from '@/lib/video-editing-agent/registry/ToolRegistry';
import { ToolActivationState } from '@/lib/video-editing-agent/registry/ToolActivationState';
import { buildAllAgentTools } from '@/lib/video-editing-agent/tools';
import { createWorkspaceTools } from '@/lib/video-editing-agent/tools/workspaceTools';
import type { ToolContext } from '@/lib/video-editing-agent/types';
import WorkspaceFileCard from '@/components/video/components/VideoChatWindow/WorkspaceFileCard';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('只加载导入后调用列表：明确提示加载工具，不显示伪空工作区', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const registry = new ToolRegistry();
  registry.registerCategory({
    id: 'workspace_tools', name: '工作区', description: '',
    alwaysAvailable: false,
    tools: createWorkspaceTools({} as ToolContext),
  });
  const state = new ToolActivationState(registry, ['explore_tools']);
  state.load('workspace_tools', ['workspace_import_material']);
  state.offer();
  const tool = buildAllAgentTools(registry, state)
    .find(item => item.name === 'workspace_list')!;
  const rejected = await tool.execute('diagnosis-list', {});
  expect(fetch).not.toHaveBeenCalled();
  expect(rejected.details).toMatchObject({
    success: false,
    error_code: 'tool_not_loaded',
    error: 'tool_not_loaded: load with explore_tools, then call on the next response.',
  });
  render(<WorkspaceFileCard toolCall={{
    id: 'diagnosis-list', name: 'workspace_list', params: {},
    status: 'error', result: rejected.details,
  }} />);
  const copy = translations['zh-CN'].agentToolkit;
  expect(screen.getByRole('status')).toHaveTextContent(/加载/);
  expect(screen.queryByText(copy.emptyFiles)).not.toBeInTheDocument();
  expect(screen.queryByText(copy.emptyDocuments)).not.toBeInTheDocument();
  expect(screen.queryByText(/已用/)).not.toBeInTheDocument();

  state.load('workspace_tools', ['workspace_list']);
  expect(state.canExecute('workspace_list')).toBe(false);
  state.offer();
  expect(state.canExecute('workspace_list')).toBe(true);
});

it('数据库提交失败有明确文案且保留已知文件名', () => {
  render(<WorkspaceFileCard toolCall={{
    id: 'diagnosis-import', name: 'workspace_import_material',
    params: { name: 'bgm_ukulele_quiet.mp3' }, status: 'error',
    result: {
      success: false, error_code: 'cache_commit_failed',
      failureClass: 'internal', status: 500,
    },
  }} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    /素材.*保存失败/);
  expect(screen.getByText('bgm_ukulele_quiet.mp3')).toBeInTheDocument();
});
