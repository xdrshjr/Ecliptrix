import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, RateLimitError, TimeoutError } from '@/lib/api/http-client';
import { translations } from '@/lib/i18n';
import WebResearchSettingsPanel from '../WebResearchSettingsPanel';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api/http-client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api/http-client')>(), http: api,
}));
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (url: string) => url.includes('capabilities')
    ? { success: true, data: { search: { available: true, configured: true, key_count: 1 }, browser: { available: true }, downloads: { available: true } } }
    : { success: true, settings: [
      { key: 'enabled', value: true },
      { key: 'use_research_model', value: false },
      { key: 'tavily_api_keys', value: null },
    ] });
  api.put.mockResolvedValue({ success: true, data: { configured: true, key_count: 1 } });
  api.post.mockResolvedValue({ success: true, settings: [] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('网络研究设置', () => {
  it.each([
    [new RateLimitError(5, 'private-error'), 'Connection test is busy. Try again later'],
    [new TimeoutError('private-error'), 'Search service timed out'],
    [new ApiError(0, 'NETWORK_ERROR', 'private-error'), 'Unable to connect to search service'],
    [new ApiError(503, 'provider_rejected', 'private-error'), 'Search credentials were rejected'],
    [new Error('private-error'), 'Unable to connect to search service'],
  ])('捕获传输错误而不展示原文', async (error, label) => {
    api.post.mockRejectedValue(error);
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    fireEvent.click(screen.getByRole('button', { name: 'Test saved connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(label);
    expect(screen.queryByText('private-error')).toBeNull();
  });

  it('实际HTTP包装器的网络异常映射连接失败', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api/http-client')>(
      '@/lib/api/http-client');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('private-error'));
    api.post.mockImplementation(actual.http.post.bind(actual.http));
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    fireEvent.click(screen.getByRole('button', { name: 'Test saved connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect to search service');
  });

  it.each([100, 6000])('冷却从开始计时，请求耗时 %i ms', async duration => {
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    vi.useFakeTimers();
    api.post.mockImplementation(() => new Promise(resolve => setTimeout(() =>
      resolve({ success: true, data: { reachable: true, configured: true } }), duration)));
    const button = screen.getByRole('button', { name: 'Test saved connection' });
    fireEvent.click(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(duration); });
    if (duration < 5000) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      await act(async () => { await vi.advanceTimersByTimeAsync(5000 - duration); });
    }
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });
  it.each([
    ['provider_rejected', 'Search credentials were rejected'],
    ['provider_rate_limited', 'Search is rate limited. Try again later'],
    ['provider_quota_exceeded', 'Search quota is exhausted'],
    ['provider_response_invalid', 'Search service returned an invalid response'],
    ['upstream_timeout', 'Search service timed out'],
    ['upstream_error', 'Unable to connect to search service'],
  ])('连接业务错误 %s 保留输入、焦点和配置', async (code, label) => {
    api.post.mockResolvedValue({ success: true, data: {
      reachable: false, configured: true, error_code: code,
      message: 'private-provider-error',
    } });
    render(<WebResearchSettingsPanel />);
    const input = await screen.findByLabelText('New search keys');
    fireEvent.change(input, { target: { value: 'unsaved-secret' } });
    const button = screen.getByRole('button', { name: 'Test saved connection' });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(label);
    expect(button).toHaveFocus();
    expect(input).toHaveValue('unsaved-secret');
    expect(api.put).not.toHaveBeenCalled();
    expect(screen.queryByText('private-provider-error')).toBeNull();
  });

  it('能力刷新失败后移除旧可用状态且不保存配置', async () => {
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    expect(screen.getAllByText(/· Available/).length).toBeGreaterThan(0);
    api.get.mockRejectedValueOnce(new Error('private-error'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await screen.findAllByText('Status temporarily unavailable');
    expect(screen.queryAllByText(/· Available/)).toHaveLength(0);
    expect(screen.queryAllByText(/· Available/)).toHaveLength(0);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('较早的能力刷新迟到成功不能覆盖较新失败，重试仍可恢复', async () => {
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    const originalGet = api.get.getMockImplementation()!;
    let finishOlder!: (value: unknown) => void;
    api.get.mockImplementationOnce(() => new Promise(resolve => {
      finishOlder = resolve;
    })).mockRejectedValueOnce(new Error('private-error'));
    const refresh = screen.getByRole('button', { name: 'Refresh status' });
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    await screen.findAllByText('Status temporarily unavailable');
    await act(async () => {
      finishOlder(await originalGet('/api/web-research/capabilities'));
    });
    expect(screen.queryByText(/· Available/)).toBeNull();
    fireEvent.click(refresh);
    await screen.findAllByText(/· Available/);
    expect(screen.queryByText('Status temporarily unavailable')).toBeNull();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('超过冷却时间仍在进行的连接测试不接受重复调用', async () => {
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    vi.useFakeTimers();
    let finishTest!: (value: unknown) => void;
    api.post.mockImplementationOnce(() => new Promise(resolve => {
      finishTest = resolve;
    }));
    const button = screen.getByRole('button', { name: 'Test saved connection' });
    button.focus();
    fireEvent.click(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    fireEvent.click(button);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();
    await act(async () => {
      finishTest({ success: true, data: { configured: true, reachable: true } });
    });
    expect(button).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByText('Connection successful')).toHaveAttribute('role', 'status');
  });
  it.each(['network', 'business'])('设置读取失败（%s）时禁止默认值覆盖，并允许重试', async failure => {
    const originalGet = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url: string) => {
      if (url.includes('capabilities')) return originalGet(url);
      if (failure === 'network') throw new Error('private-provider-error');
      return { success: false, settings: [] };
    });
    render(<WebResearchSettingsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Settings could not be loaded. Retry before making changes.');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('private-provider-error')).toBeNull();
    api.get.mockImplementation(async (url: string) => url.includes('capabilities')
      ? originalGet(url)
      : { success: true, settings: [{ key: 'enabled', value: false }] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('switch', {
      name: 'Enable network research',
    })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('现有 HTTP 包装器为无 body 的 reset 发送 JSON 空对象', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api/http-client')>(
      '@/lib/api/http-client');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, settings: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    try {
      await actual.http.post('/api/system-settings/web_research/reset');
      const request = fetchSpy.mock.calls[0][1];
      expect(request?.method).toBe('POST');
      expect(request?.body).toBe('{}');
      expect(new Headers(request?.headers).get('Content-Type')).toBe('application/json');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('普通保存不包含凭证，新凭证写入后清空输入', async () => {
    render(<WebResearchSettingsPanel />);
    const input = await screen.findByLabelText('New search keys');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'test-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update credentials' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/api/web-research/credentials', { tavily_api_keys: ['test-secret'] }, expect.anything()));
    await waitFor(() => expect(input).toHaveValue(''));
    fireEvent.click(screen.getByRole('switch', { name: 'Enable network research' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/api/system-settings/web_research', { settings: expect.objectContaining({ enabled: false }) }));
    const saved = api.put.mock.calls.find(call => call[0] === '/api/system-settings/web_research');
    expect(saved?.[1].settings).not.toHaveProperty('tavily_api_keys');
  });

  it('代理模式三选一：切直连后地址隐藏，保存携带 proxy_mode', async () => {
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    // 默认 auto：自定义地址输入可见。
    expect(screen.getByLabelText(/Custom proxy address/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Direct' }));
    expect(screen.queryByLabelText(/Custom proxy address/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/api/system-settings/web_research',
      { settings: expect.objectContaining({ proxy_mode: 'direct' }) }));
  });

  it('自定义代理地址校验：非法值阻止保存并给出提示', async () => {
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    const address = screen.getByLabelText(/Custom proxy address/);
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.change(address, { target: { value: 'ftp://bad' } });
    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(/host:port/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(address, { target: { value: 'http://127.0.0.1:7890' } });
    expect(address).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('未配置密钥与不可用是两种状态，并给出设置入口与出口（§13）', async () => {
    const originalGet = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url: string) => url.includes('capabilities')
      ? { success: true, data: {
        search: { available: false, configured: false, key_count: 0,
          error_code: 'provider_not_configured' },
        browser: { available: false, enabled: true,
          error_code: 'browser_unavailable' },
        downloads: { available: true },
        proxy: { mode: 'auto', resolved_from: 'system',
          target: 'http://127.0.0.1:7890' },
      } }
      : originalGet(url));
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    expect(await screen.findByText(/Not configured/)).toBeInTheDocument();
    expect(screen.getByText(/Not provided by this environment/)).toBeInTheDocument();
    expect(screen.getByText(/System proxy detected by the app/)).toBeInTheDocument();
    const entry = screen.getByRole('button', { name: 'Add search keys' });
    fireEvent.click(entry);
    expect(screen.getByLabelText('New search keys')).toHaveFocus();
  });

  it('用户关闭能力时显示关闭而不是不可用', async () => {
    const originalGet = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url: string) => url.includes('capabilities')
      ? originalGet(url)
      : { success: true, settings: [{ key: 'enabled', value: false }] });
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    expect(screen.getAllByText(/Network research is disabled/).length)
      .toBeGreaterThan(0);
  });

  it('逐段关闭只影响该段，不把整块标成不可用（§13-2）', async () => {
    const originalGet = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url: string) => url.includes('capabilities')
      ? originalGet(url)
      : { success: true, settings: [
        { key: 'enabled', value: true },
        { key: 'browser_enabled', value: false },
        { key: 'downloads_enabled', value: true },
      ] });
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    const tile = (label: string) => screen.getByText(label).closest('li');
    expect(tile('Dynamic pages')?.textContent).toContain('Off');
    expect(tile('Web search')?.textContent).toContain('Available');
    expect(tile('Local downloads')?.textContent).toContain('Available');
    expect(screen.queryByText('Status temporarily unavailable')).toBeNull();
  });

  it('清除凭证使用显式空数组，关闭辅助模型保留但禁用其预算', async () => {
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    fireEvent.click(screen.getByText('Advanced resource limits'));
    expect(screen.getByLabelText('Research model context window')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear credentials' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/api/web-research/credentials', { tavily_api_keys: [] }, expect.anything()));
  });

  it('恢复默认调用类别 reset 并清空未保存的秘密', async () => {
    render(<WebResearchSettingsPanel />);
    const input = await screen.findByLabelText('New search keys');
    fireEvent.change(input, { target: { value: 'unsaved-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/system-settings/web_research/reset'));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.getByText('Defaults restored')).toBeInTheDocument();
  });

  it('凭证保存失败不展示含秘密的异常并保留输入', async () => {
    api.put.mockRejectedValueOnce(new Error('secret-from-error'));
    render(<WebResearchSettingsPanel />);
    const input = await screen.findByLabelText('New search keys');
    fireEvent.change(input, { target: { value: 'pending-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update credentials' }));
    expect(await screen.findByText('The operation failed. Please try again.')).toBeInTheDocument();
    expect(input).toHaveValue('pending-secret');
    expect(screen.queryByText('secret-from-error')).toBeNull();
  });

  it('HTTP 成功但业务失败的凭证响应不能清空待保存密钥', async () => {
    api.put.mockResolvedValueOnce({ success: false, data: null });
    render(<WebResearchSettingsPanel />);
    const input = await screen.findByLabelText('New search keys');
    fireEvent.change(input, { target: { value: 'pending-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update credentials' }));
    await screen.findByText('The operation failed. Please try again.');
    expect(input).toHaveValue('pending-secret');
  });

  it('辅助模型预算校验与字段关联，非法值阻止保存', async () => {
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    fireEvent.click(screen.getByRole('switch', { name: 'Use an auxiliary research model' }));
    fireEvent.click(screen.getByText('Advanced resource limits'));
    const input = screen.getByLabelText('Research model context window');
    expect(input).not.toBeDisabled();
    fireEvent.change(input, { target: { value: '100' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'research-research_context_window_tokens-error');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('连接测试仅使用已保存凭证且不因重复点击重复请求', async () => {
    api.post.mockResolvedValue({ success: true, data: { reachable: true, configured: true } });
    render(<WebResearchSettingsPanel />);
    await screen.findByLabelText('New search keys');
    const test = screen.getByRole('button', { name: 'Test saved connection' });
    fireEvent.click(test);
    fireEvent.click(test);
    await screen.findByText('Connection successful');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/web-research/test-connection', {}, expect.anything());
  });
});
