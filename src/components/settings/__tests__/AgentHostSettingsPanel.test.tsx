import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { ApiError } from '@/lib/api/http-client';
import AgentHostSettingsPanel from '../AgentHostSettingsPanel';
import SettingsPage from '../SettingsPage';
import SettingsSidebar from '../SettingsSidebar';

const copy = translations.en.agentHost;
const SAVE_LABEL = translations.en.adminSettings.save;

const settingsApi = vi.hoisted(() => ({
  getCategorySettings: vi.fn(),
  updateCategorySettings: vi.fn(),
}));
vi.mock('@/lib/api/systemSettings', () => settingsApi);

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

/** 后端 `agent_host` 分类的 18 个键，值取 spec §4.9 的出厂值。 */
function settingsResponse() {
  return {
    success: true,
    category: 'agent_host',
    settings: [
      { key: 'enabled', value: true },
      { key: 'shell_enabled', value: true },
      { key: 'shell_scope', value: 'workspace' },
      { key: 'shell_timeout_s', value: 120 },
      { key: 'shell_max_output_kb', value: 64 },
      { key: 'fs_enabled', value: true },
      { key: 'fs_max_bytes', value: 32768 },
      { key: 'egress_enabled', value: true },
      { key: 'egress_mode', value: 'balanced' },
      { key: 'egress_allow_hosts', value: [] },
      { key: 'egress_deny_hosts', value: [] },
      { key: 'egress_allow_ports', value: [] },
      { key: 'egress_max_bytes', value: 8388608 },
      { key: 'egress_max_per_turn', value: 60 },
      { key: 'egress_max_per_minute', value: 120 },
      { key: 'host_read_roots', value: ['C:\\work'] },
      { key: 'host_write_roots', value: ['C:\\work'] },
      { key: 'audit_log_retention_days', value: 30 },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsApi.getCategorySettings.mockResolvedValue(settingsResponse());
  settingsApi.updateCategorySettings.mockResolvedValue({
    success: true, message: 'ok',
  });
});

describe('本机与网络访问设置面板', () => {
  it('加载中只有状态播报，不渲染保存按钮', async () => {
    let finishLoad: (value: unknown) => void = () => {};
    settingsApi.getCategorySettings.mockImplementation(() => new Promise(
      (resolve) => { finishLoad = resolve; }));
    render(<AgentHostSettingsPanel />);
    expect(screen.getByRole('status')).toHaveTextContent(copy.loading);
    expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();
    finishLoad(settingsResponse());
    expect(await screen.findByLabelText(copy.enabled)).toBeChecked();
  });

  it('加载失败只显示 alert 与重试，不渲染表单', async () => {
    settingsApi.getCategorySettings.mockRejectedValue(new Error('private-io'));
    render(<AgentHostSettingsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.loadFailed);
    expect(screen.getByRole('button', { name: copy.retry })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();
    expect(screen.queryByText('private-io')).toBeNull();
  });

  it('读取使用 agent_host 分类的出厂 18 个键', async () => {
    render(<AgentHostSettingsPanel />);
    await screen.findByLabelText(copy.enabled);
    expect(settingsApi.getCategorySettings)
      .toHaveBeenCalledWith('agent_host');
    expect(settingsApi.getCategorySettings).toHaveBeenCalledTimes(1);
  });

  it('AC-G19a：shell_timeout_s=0 越界，标记 aria-invalid 且不保存', async () => {
    render(<AgentHostSettingsPanel />);
    const timeout = await screen.findByLabelText(copy.shellTimeoutS);
    expect(timeout).toHaveValue(120);
    fireEvent.change(timeout, { target: { value: '0' } });
    expect(timeout).toHaveAttribute('aria-invalid', 'true');
    expect(timeout).toHaveAttribute('aria-describedby',
      'agent-host-shell_timeout_s-error');
    expect(screen.getByText(copy.rangeHint
      .replace('{min}', '1').replace('{max}', '600'))).toBeInTheDocument();
    const save = screen.getByRole('button', { name: SAVE_LABEL });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(settingsApi.updateCategorySettings).not.toHaveBeenCalled();
  });

  it('AC-G19b：egress_mode=open 未确认不保存，勾选后才提交', async () => {
    render(<AgentHostSettingsPanel />);
    await screen.findByLabelText(copy.enabled);
    fireEvent.click(screen.getByRole('radio', { name: copy.egressModeOpen }));
    expect(screen.getByText(copy.openWarning)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: SAVE_LABEL });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(settingsApi.updateCategorySettings).not.toHaveBeenCalled();
    // 未确认时也给出可读的原因，而不是只把按钮变灰。
    expect(screen.getByText(copy.saveBlockedConfirm)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(copy.openConfirm));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(settingsApi.updateCategorySettings)
      .toHaveBeenCalledWith('agent_host', { egress_mode: 'open' }));
    expect(await screen.findByText(copy.saved)).toBeInTheDocument();
  });

  it('shell_scope=host 同样需要二次确认，确认文案说明不是沙箱', async () => {
    render(<AgentHostSettingsPanel />);
    await screen.findByLabelText(copy.enabled);
    fireEvent.click(screen.getByRole('radio', { name: copy.shellScopeHost }));
    const hostConfirm = screen.getByLabelText(copy.hostConfirm);
    expect(copy.hostConfirm).toMatch(/not a sandbox/);
    expect(screen.getByRole('button', { name: SAVE_LABEL })).toBeDisabled();
    fireEvent.click(hostConfirm);
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));
    await waitFor(() => expect(settingsApi.updateCategorySettings)
      .toHaveBeenCalledWith('agent_host', { shell_scope: 'host' }));
  });

  it('AC-G19c：保存只提交改动的键', async () => {
    render(<AgentHostSettingsPanel />);
    const output = await screen.findByLabelText(copy.shellMaxOutputKb);
    fireEvent.change(output, { target: { value: '128' } });
    fireEvent.change(screen.getByLabelText(copy.fsMaxBytes),
      { target: { value: '65536' } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));
    await waitFor(() => expect(settingsApi.updateCategorySettings)
      .toHaveBeenCalledWith('agent_host', {
        shell_max_output_kb: 128, fs_max_bytes: 65536,
      }));
    expect(settingsApi.updateCategorySettings).toHaveBeenCalledTimes(1);
  });

  it('列表越界阻止保存：端口 0 与相对路径', async () => {
    render(<AgentHostSettingsPanel />);
    const ports = await screen.findByLabelText(copy.egressAllowPorts);
    fireEvent.change(ports, { target: { value: '0' } });
    expect(ports).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(copy.invalidPort
      .replace('{max}', '20'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SAVE_LABEL })).toBeDisabled();
    fireEvent.change(ports, { target: { value: '8443' } });
    const roots = screen.getByLabelText(copy.hostReadRoots);
    fireEvent.change(roots, { target: { value: 'relative/dir' } });
    expect(roots).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: SAVE_LABEL })).toBeDisabled();
    fireEvent.change(roots, { target: { value: 'C:\\work' } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));
    await waitFor(() => expect(settingsApi.updateCategorySettings)
      .toHaveBeenCalledWith('agent_host', { egress_allow_ports: [8443] }));
  });

  it('保存失败时按错误码给出对应文案', async () => {
    // 真实链路抛的是 `ApiError`（码在 `.code`）：用它的真实形状，而不是
    // 造一个生产环境不会出现的 `{ errorCode }`。
    settingsApi.updateCategorySettings.mockRejectedValue(
      new ApiError(429, 'egress_rate_limited', 'upstream'));
    render(<AgentHostSettingsPanel />);
    const field = await screen.findByLabelText(copy.auditLogRetentionDays);
    fireEvent.change(field, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));
    expect(await screen.findByText(copy.errors.egress_rate_limited))
      .toBeInTheDocument();
    expect(screen.queryByText('upstream')).toBeNull();
  });

  it('无改动时不提交，也不出现「恢复默认」按钮', async () => {
    render(<AgentHostSettingsPanel />);
    await screen.findByLabelText(copy.enabled);
    expect(screen.getByRole('button', { name: SAVE_LABEL })).toBeDisabled();
    expect(screen.queryByText(/restore defaults/i)).toBeNull();
    expect(settingsApi.updateCategorySettings).not.toHaveBeenCalled();
  });
});

describe('AC-G23 新分类可寻址', () => {
  it('侧边栏渲染出 agentHost 项并标记为当前项', () => {
    render(
      <SettingsSidebar activeItem="agentHost" onSelectItem={() => {}} />,
    );
    const item = screen.getByRole('button', {
      name: new RegExp(copy.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    });
    expect(item).toHaveAttribute('aria-current', 'page');
  });

  it('设置页选中 agentHost 时渲染本面板，而不是被 default 吞掉', async () => {
    render(<SettingsPage onClose={() => {}} initialItem="agentHost" />);
    expect(await screen.findByRole('heading', { name: copy.title }))
      .toBeInTheDocument();
    expect(await screen.findByLabelText(copy.shellTimeoutS)).toBeInTheDocument();
  });
});

describe('agent_host 相关文案', () => {
  const errorCodes = [
    'shell_disabled', 'shell_busy', 'shell_spawn_failed', 'path_forbidden',
    'edit_not_unique', 'host_file_too_large', 'egress_disabled',
    'egress_budget_exceeded', 'egress_rate_limited', 'http_write_unsupported',
    'proxy_config_invalid', 'dns_answer_non_global', 'dns_no_answer',
    'port_not_allowed', 'invalid_url', 'binary_file', 'workspace_file_too_large',
    'workspace_quota_exceeded', 'material_not_materialized',
    'unsupported_media_type', 'url_forbidden',
  ];
  const reasonCodes = [
    'proxy_config_invalid', 'url_too_long', 'url_control_char', 'invalid_url',
    'scheme_not_allowed', 'userinfo_not_allowed', 'port_not_allowed',
    'host_denied', 'host_literal_non_global', 'dns_no_answer',
    'dns_answer_non_global', 'robots_disallowed', 'robots_unavailable',
  ];

  it.each(['en', 'zh-CN'])('%s 覆盖 21 个错误码文案', (locale) => {
    const errors = translations[locale].agentHost.errors;
    for (const code of errorCodes) {
      expect(errors[code], code).toBeTruthy();
    }
  });

  it.each(['en', 'zh-CN'])('%s 覆盖 13 个出口 reason 文案', (locale) => {
    const reason = translations[locale].webResearch.reason;
    for (const code of reasonCodes) {
      expect(reason[code], code).toBeTruthy();
    }
  });
});
