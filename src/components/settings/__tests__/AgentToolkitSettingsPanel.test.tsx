import React from 'react';
import {
  act, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import AgentToolkitSettingsPanel from '../AgentToolkitSettingsPanel';

const copy = translations.en.agentToolkit;
const SAVE_LABEL = translations.en.adminSettings.save;

const settingsApi = vi.hoisted(() => ({
  getCategorySettings: vi.fn(),
  updateCategorySettings: vi.fn(),
}));
vi.mock('@/lib/api/systemSettings', () => settingsApi);

const toolkitApi = vi.hoisted(() => ({
  fetchAgentToolkitCapabilities: vi.fn(),
  fetchAgentToolkitUsage: vi.fn(),
  fetchWorkspaceListing: vi.fn(),
  deleteWorkspaceFile: vi.fn(),
  workspaceDownloadUrl: vi.fn(),
  fetchMemories: vi.fn(),
  deleteMemory: vi.fn(),
  clearProjectMemories: vi.fn(),
}));
vi.mock('@/lib/api/agentToolkit', () => toolkitApi);

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

function settingsResponse() {
  return {
    success: true,
    category: 'agent_toolkit',
    settings: [
      { key: 'enabled', value: true },
      { key: 'workspace_enabled', value: true },
      { key: 'documents_enabled', value: true },
      { key: 'analysis_enabled', value: false },
      { key: 'memory_enabled', value: true },
      { key: 'workspace_quota_mb', value: 256 },
      { key: 'max_file_mb', value: 32 },
      { key: 'document_digest_model', value: 'fast' },
    ],
  };
}

function capabilitiesResponse() {
  return {
    workspace: {
      available: true, enabled: true, root_label: 'projects/demo/workspace',
      used_bytes: 2048, quota_bytes: 268435456, used_by_kind: {},
    },
    documents: { available: true, enabled: true, formats: ['.pdf'] },
    analysis: { available: false, enabled: false },
    memory: { available: true, enabled: true, entries: {} },
    limits: {
      max_file_mb: 32, document_max_pages: 800,
      document_max_chars: 2000000, analysis_timeout_seconds: 20,
    },
  };
}

const FILE_NAME = 'outline.md';
const MEMORY_TEXT = 'Prefers short clips';

function listingResponse() {
  return {
    files: [{
      name: FILE_NAME, bytes: 2048, mtime: '2026-01-01T00:00:00Z', kind: 'text',
    }],
    documents: [],
    totalFiles: 1,
    totalBytes: 2048,
    quotaBytes: 268435456,
    truncated: false,
  };
}

function memoryResponse() {
  return {
    count: 1,
    entries: [{
      id: 'memory-1', kind: 'preference', text: MEMORY_TEXT, tags: [],
      scope: 'project', hitCount: 2,
      updatedAt: '2026-01-01T00:00:00Z', expiresAt: null,
    }],
  };
}

beforeEach(() => {
  settingsApi.getCategorySettings.mockResolvedValue(settingsResponse());
  settingsApi.updateCategorySettings.mockResolvedValue({
    success: true, message: 'ok',
  });
  toolkitApi.fetchAgentToolkitCapabilities.mockResolvedValue(
    capabilitiesResponse());
  toolkitApi.fetchAgentToolkitUsage.mockResolvedValue({});
  toolkitApi.fetchWorkspaceListing.mockResolvedValue(listingResponse());
  toolkitApi.deleteWorkspaceFile.mockResolvedValue({
    deleted: true, name: FILE_NAME,
  });
  toolkitApi.workspaceDownloadUrl.mockImplementation(
    (name: string) => `/api/agent-toolkit/workspace/download?name=${name}`);
  toolkitApi.fetchMemories.mockResolvedValue(memoryResponse());
  toolkitApi.deleteMemory.mockResolvedValue({ deleted: true });
  toolkitApi.clearProjectMemories.mockResolvedValue({ deleted: 1 });
});

describe('Agent 能力设置面板', () => {
  it('计算分析风险说明同时包含两句强制文案', async () => {
    render(<AgentToolkitSettingsPanel />);
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(copy.analysisRisk);
    expect(note).toHaveTextContent(copy.analysisRiskNoMemory);
  });

  it('加载中只有状态播报，不渲染表单与保存按钮', async () => {
    let finishLoad: (value: unknown) => void = () => {};
    settingsApi.getCategorySettings.mockImplementation(() => new Promise(
      (resolve) => { finishLoad = resolve; }));
    render(<AgentToolkitSettingsPanel />);
    expect(screen.getByRole('status')).toHaveTextContent(copy.loading);
    expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();
    // 结算未完成的读取，避免用例结束时留下未包装的 setState。
    await act(async () => { finishLoad(settingsResponse()); });
    expect(await screen.findByLabelText(copy.enabled)).toBeInTheDocument();
  });

  it('加载失败只显示 alert 与重试，不渲染表单', async () => {
    settingsApi.getCategorySettings.mockRejectedValue(new Error('private-io'));
    render(<AgentToolkitSettingsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.loadFailed);
    expect(screen.getByRole('button', { name: copy.retry })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();
    expect(screen.queryByText('private-io')).toBeNull();
  });

  it('配额越界时标记 aria-invalid 并禁用保存', async () => {
    render(<AgentToolkitSettingsPanel />);
    const input = await screen.findByLabelText(copy.workspaceQuotaMb);
    fireEvent.change(input, { target: { value: '4' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby',
      'agent-toolkit-workspace_quota_mb-error');
    expect(screen.getByText(copy.invalidSetting)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SAVE_LABEL })).toBeDisabled();
    expect(settingsApi.updateCategorySettings).not.toHaveBeenCalled();
  });

  it('保存成功后以 aria-live 播报结果并提交变更键', async () => {
    render(<AgentToolkitSettingsPanel />);
    const input = await screen.findByLabelText(copy.maxFileMb);
    fireEvent.change(input, { target: { value: '64' } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));
    const notice = await screen.findByText(copy.saved);
    expect(notice.closest('[aria-live="polite"]')).not.toBeNull();
    expect(settingsApi.updateCategorySettings).toHaveBeenCalledWith(
      'agent_toolkit', { max_file_mb: 64 });
  });

  it('保存失败播报失败文案', async () => {
    settingsApi.updateCategorySettings.mockResolvedValue({
      success: false, message: 'rejected',
    });
    render(<AgentToolkitSettingsPanel />);
    const input = await screen.findByLabelText(copy.maxFileMb);
    fireEvent.change(input, { target: { value: '64' } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));
    expect(await screen.findByText(copy.saveFailed)).toBeInTheDocument();
  });

  it('工作区文件表渲染行，删除需要二次确认', async () => {
    render(<AgentToolkitSettingsPanel />);
    expect(await screen.findByText(FILE_NAME)).toBeInTheDocument();
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '2048');
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '268435456');
    const download = screen.getByRole('link', {
      name: `${copy.download} ${FILE_NAME}`,
    });
    expect(download).toHaveAttribute('href',
      `/api/agent-toolkit/workspace/download?name=${FILE_NAME}`);
    fireEvent.click(screen.getByRole('button', {
      name: `${copy.delete} ${FILE_NAME}`,
    }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      copy.deleteConfirm.replace('{name}', FILE_NAME));
    expect(toolkitApi.deleteWorkspaceFile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: copy.delete }));
    await waitFor(() => expect(toolkitApi.deleteWorkspaceFile)
      .toHaveBeenCalledWith(FILE_NAME));
  });

  it('记忆列表渲染条目并清空本项目记忆需二次确认', async () => {
    render(<AgentToolkitSettingsPanel />);
    expect(await screen.findByText(MEMORY_TEXT)).toBeInTheDocument();
    expect(screen.getByText(copy.kindPreference)).toBeInTheDocument();
    expect(screen.getByText(copy.scopeProject)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: copy.memoryClear }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(copy.memoryClearConfirm);
    expect(dialog).toHaveTextContent(copy.memoryClearConfirmBody);
    expect(toolkitApi.clearProjectMemories).not.toHaveBeenCalled();
    toolkitApi.fetchMemories.mockResolvedValue({ entries: [], count: 0 });
    fireEvent.click(within(dialog).getByRole('button', {
      name: copy.memoryClear,
    }));
    await waitFor(() => expect(toolkitApi.clearProjectMemories).toHaveBeenCalled());
    expect(await screen.findByText(copy.emptyMemories)).toBeInTheDocument();
  });

  it('总开关关闭时子能力 aria-disabled 且不进入保存 diff', async () => {
    render(<AgentToolkitSettingsPanel />);
    const master = await screen.findByLabelText(copy.enabled);
    fireEvent.click(master);
    const child = screen.getByLabelText(copy.workspaceEnabled);
    expect(child).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(child);
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));
    await screen.findByText(copy.saved);
    expect(settingsApi.updateCategorySettings).toHaveBeenCalledWith(
      'agent_toolkit', { enabled: false });
  });

  it('提供 onOpenModels 时渲染打开模型设置按钮', async () => {
    const onOpenModels = vi.fn();
    render(<AgentToolkitSettingsPanel onOpenModels={onOpenModels} />);
    fireEvent.click(await screen.findByRole('button', {
      name: copy.openModelSettings,
    }));
    expect(onOpenModels).toHaveBeenCalledTimes(1);
  });

  it('未提供 onOpenModels 时不渲染打开模型设置按钮', async () => {
    render(<AgentToolkitSettingsPanel />);
    await screen.findByLabelText(copy.enabled);
    expect(screen.queryByRole('button', { name: copy.openModelSettings }))
      .toBeNull();
  });
});
