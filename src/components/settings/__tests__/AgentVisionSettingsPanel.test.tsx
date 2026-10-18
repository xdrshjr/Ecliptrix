import React from 'react';
import {
  act, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import AgentVisionSettingsPanel from '../AgentVisionSettingsPanel';

const copy = translations.en.agentVision;
const SAVE_LABEL = translations.en.adminSettings.save;

const settingsApi = vi.hoisted(() => ({
  getCategorySettings: vi.fn(),
  updateCategorySettings: vi.fn(),
}));
vi.mock('@/lib/api/systemSettings', () => settingsApi);

const visionApi = vi.hoisted(() => ({
  fetchAgentVisionCapabilities: vi.fn(),
  fetchAgentVisionUsage: vi.fn(),
  clearVisionCache: vi.fn(),
}));
vi.mock('@/lib/api/agentVision', () => visionApi);

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

function settingsResponse(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    category: 'agent_vision',
    settings: [
      { key: 'enabled', value: true },
      { key: 'probe_enabled', value: true },
      { key: 'visual_spot_check', value: true },
      { key: 'max_images_per_call', value: 4 },
      { key: 'max_image_side_px', value: 1280 },
      { key: 'max_image_bytes', value: 409600 },
      { key: 'frame_sample_count', value: 4 },
      { key: 'daily_call_cap', value: 120 },
      { key: 'daily_image_cap', value: 400 },
      { key: 'request_timeout_seconds', value: 45 },
      { key: 'cache_ttl_days', value: 7 },
    ].map((item) => (item.key in overrides
      ? { ...item, value: overrides[item.key] } : item)),
  };
}

function capabilitiesResponse(configured = true) {
  return {
    vision: {
      available: configured,
      enabled: configured,
      ...(configured ? {
        model: {
          provider: 'openai', model: 'qwen-vl-plus', source: 'database',
        },
      } : { model: null }),
      egress: 'configured_provider',
      downscale_px: 1280,
    },
    frames: { available: true, enabled: configured },
    probe: { available: true, enabled: true },
    limits: {
      max_images_per_call: 4,
      max_image_side_px: 1280,
      max_image_bytes: 409600,
      frame_sample_count: 4,
      daily_call_cap: 120,
      daily_image_cap: 400,
      request_timeout_seconds: 45,
      cache_ttl_days: 7,
    },
    usage: {
      day: '2026-10-18', calls: 3, images: 7, cached_calls: 2, failures: 0,
    },
  };
}

const usageResponse = {
  day: '2026-10-18', calls: 3, images: 7, cached_calls: 2, failures: 1,
};

beforeEach(() => {
  settingsApi.getCategorySettings.mockResolvedValue(settingsResponse());
  settingsApi.updateCategorySettings.mockResolvedValue({
    success: true, message: 'ok',
  });
  visionApi.fetchAgentVisionCapabilities.mockResolvedValue(
    capabilitiesResponse());
  visionApi.fetchAgentVisionUsage.mockResolvedValue(usageResponse);
  visionApi.clearVisionCache.mockResolvedValue({ removed: 3 });
});

describe('视觉审阅设置面板', () => {
  it('加载中只有状态播报，不渲染表单与保存按钮', async () => {
    let finish: (value: unknown) => void = () => {};
    settingsApi.getCategorySettings.mockImplementation(() => new Promise(
      (resolve) => { finish = resolve; }));
    render(<AgentVisionSettingsPanel />);
    expect(screen.getByRole('status')).toHaveTextContent(copy.loading);
    expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();
    await act(async () => { finish(settingsResponse()); });
    expect(await screen.findByLabelText(copy.enabled)).toBeInTheDocument();
  });

  it('加载失败只显示 alert 与重试，不渲染表单', async () => {
    settingsApi.getCategorySettings.mockRejectedValue(new Error('private-io'));
    render(<AgentVisionSettingsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.loadFailed);
    expect(screen.getByRole('button', { name: copy.retry })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SAVE_LABEL })).toBeNull();
    // 底层异常文本不得出现在界面上。
    expect(screen.queryByText('private-io')).toBeNull();
  });

  it('视觉模型未配置时显示"未配置"与前往模型设置的 CTA', async () => {
    visionApi.fetchAgentVisionCapabilities.mockResolvedValue(
      capabilitiesResponse(false));
    const onOpenModels = vi.fn();
    render(<AgentVisionSettingsPanel onOpenModels={onOpenModels} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.notConfigured);
    const cta = screen.getAllByRole('button', { name: copy.openModelSettings })[0];
    fireEvent.click(cta);
    expect(onOpenModels).toHaveBeenCalled();
  });

  it('固定的自检说明始终可见：自检不受能力开关影响', async () => {
    render(<AgentVisionSettingsPanel />);
    const note = await screen.findByText(copy.lintAlwaysOn);
    expect(note).toBeInTheDocument();
    expect(screen.getByText(copy.rulesWhy)).toBeInTheDocument();
  });

  it('配额越界时标记 aria-invalid 并禁用保存', async () => {
    render(<AgentVisionSettingsPanel />);
    const input = await screen.findByLabelText(copy.dailyCallCap);
    fireEvent.change(input, { target: { value: '0' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby',
      'agent-vision-daily_call_cap-error');
    expect(screen.getByText(copy.invalidSetting)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SAVE_LABEL })).toBeDisabled();
    expect(settingsApi.updateCategorySettings).not.toHaveBeenCalled();
  });

  it('保存只提交变化键，并以 aria-live 播报结果', async () => {
    render(<AgentVisionSettingsPanel />);
    const input = await screen.findByLabelText(copy.dailyCallCap);
    fireEvent.change(input, { target: { value: '240' } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));
    const notice = await screen.findByText(copy.saved);
    expect(notice.closest('[aria-live="polite"]')).not.toBeNull();
    expect(settingsApi.updateCategorySettings).toHaveBeenCalledWith(
      'agent_vision', { daily_call_cap: 240 });
  });

  it('保存失败播报失败文案且不清空表单', async () => {
    settingsApi.updateCategorySettings.mockResolvedValue({
      success: false, message: 'rejected',
    });
    render(<AgentVisionSettingsPanel />);
    const input = await screen.findByLabelText(copy.dailyCallCap);
    fireEvent.change(input, { target: { value: '240' } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }));
    expect(await screen.findByText(copy.saveFailed)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.dailyCallCap)).toHaveValue(240);
  });

  it('清空缓存需要二次确认，确认后才调用后端', async () => {
    render(<AgentVisionSettingsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: copy.cacheClear }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(copy.cacheClearConfirm);
    expect(dialog).toHaveTextContent(copy.cacheClearConfirmBody);
    expect(visionApi.clearVisionCache).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: copy.cacheClear }));
    await waitFor(() => expect(visionApi.clearVisionCache).toHaveBeenCalled());
    expect(await screen.findByText(copy.cacheCleared)).toBeInTheDocument();
  });

  it('用量区渲染今天的四个计数', async () => {
    render(<AgentVisionSettingsPanel />);
    expect(await screen.findByText('2026-10-18')).toBeInTheDocument();
    expect(screen.getByText(copy.usageCalls)).toBeInTheDocument();
    expect(screen.getByText(copy.usageImages)).toBeInTheDocument();
    expect(screen.getByText(copy.usageFailures)).toBeInTheDocument();
  });
});
