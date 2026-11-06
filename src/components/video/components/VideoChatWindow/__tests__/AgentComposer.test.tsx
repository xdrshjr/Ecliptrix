import React from 'react';
import { flushSync } from 'react-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import { useComposer } from '../useComposer';
import AgentComposer from '../AgentComposer';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations['zh-CN'] }),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const cancel = vi.fn();
const select = vi.fn();
function Harness({ running = false, finishing = false, loading = false,
  onCancel = cancel, onSendMessage = vi.fn().mockResolvedValue({ accepted: true }) }: {
  running?: boolean;
  finishing?: boolean;
  loading?: boolean;
  onCancel?: () => void;
  onSendMessage?: Parameters<typeof useComposer>[0]['onSendMessage'];
}) {
  const composer = useComposer({
    agentMode: true, agentIsExecuting: running, isFinishing: finishing,
    isLoading: loading, materials: [], messages: [], draftScope: null,
    onSendMessage, onCancel,
    steering: running ? { steer: vi.fn(), enqueue: vi.fn() } as never : undefined,
  });
  return <AgentComposer composer={composer}
    mode={{ agentMode: true, onAgentModeChange: vi.fn(), yolo: false,
      yoloReady: true, disabled: running || loading }}
    actions={{ isLoading: loading, agentIsExecuting: running,
      isFinishing: finishing, hasMessages: true, onClear: vi.fn(),
      onCancel, onFocusChange: vi.fn() }}
    upload={{ fileInputRef: React.createRef(), enabled: true,
      uploading: false, accept: '.pdf', error: null, onSelect: select }} />;
}

describe('统一输入卡片', () => {
  it('空输入不能发送，附件、清空与发送均有可访问名称', () => {
    render(<Harness />);
    const copy = translations['zh-CN'];
    expect(screen.getByRole('button', { name: copy.videoChatWindow.sendMessageTooltip }))
      .toBeDisabled();
    expect(screen.getByRole('button', { name: copy.videoChatWindow.clearChatTooltip }))
      .toBeEnabled();
    expect(screen.getByRole('button', { name: copy.agentToolkit.attachDocument }))
      .toBeEnabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '剪辑' } });
    expect(screen.getByRole('button', { name: copy.videoChatWindow.sendMessageTooltip }))
      .toBeEnabled();
  });
  it('执行中显示插话与停止，收尾中仍可排队但不能停止', () => {
    const { rerender } = render(<Harness running />);
    expect(screen.getByTestId('agent-stop-button')).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '补充' } });
    expect(screen.getByTestId('agent-steer-button')).toBeEnabled();
    rerender(<Harness running finishing />);
    expect(screen.getByTestId('agent-stop-button')).toBeDisabled();
    expect(screen.getByTestId('agent-steer-button')).toBeEnabled();
  });
  it('等待普通聊天时保留可编辑输入并禁用发送与附件', () => {
    render(<Harness loading />);
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.getByRole('button', {
      name: translations['zh-CN'].agentToolkit.attachDocument,
    })).toBeDisabled();
  });
  it('窗口变窄后重新测量草稿高度，超过上限时允许内部滚动', () => {
    const observers: Array<{ callback: ResizeObserverCallback; targets: Element[] }> = [];
    vi.stubGlobal('ResizeObserver', class {
      record: typeof observers[number];
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, targets: [] }; observers.push(this.record);
      }
      observe(target: Element) { this.record.targets.push(target); }
      disconnect() {}
    });
    render(<Harness />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    let contentHeight = 40;
    Object.defineProperty(input, 'scrollHeight', { get: () => contentHeight });
    fireEvent.change(input, { target: { value: '窗口缩窄后应完整显示这段多行草稿' } });
    expect(input.style.height).toBe('40px');
    contentHeight = 180;
    act(() => {
      for (const record of observers) {
        record.callback(record.targets.map(target => ({ target })) as ResizeObserverEntry[],
          {} as ResizeObserver);
      }
    });
    expect(input.style.height).toBe('120px');
    expect(input.style.overflowY).toBe('auto');
  });
  it('点击停止同步回到空闲时，不把未提交草稿当成发送', () => {
    const send = vi.fn().mockResolvedValue({ accepted: true });
    function SwitchingHarness() {
      const [running, setRunning] = React.useState(true);
      return <Harness running={running} onCancel={() => flushSync(() => setRunning(false))}
        onSendMessage={send} />;
    }
    render(<SwitchingHarness />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留这段草稿' } });
    fireEvent.click(screen.getByTestId('agent-stop-button'));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('保留这段草稿');
  });
});
