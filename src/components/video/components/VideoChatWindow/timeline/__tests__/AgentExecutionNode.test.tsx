import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '@/lib/i18n';
import type { AgentToolCallRecord } from '@/types';
import AgentExecutionNode from '../AgentExecutionNode';
import type { AgentExecutionNodeData } from '../types';

const copy = translations.en.agentVision;

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: translations.en, locale: 'en' }),
}));

function node(toolCalls: AgentToolCallRecord[]): AgentExecutionNodeData {
  return {
    kind: 'execution',
    id: 'node-1',
    timestamp: new Date('2026-10-18T10:00:00Z'),
    toolCalls,
    isActive: false,
    messageId: 'message-1',
  };
}

function call(
  id: string, name: string, result: unknown,
  status: AgentToolCallRecord['status'] = 'completed',
): AgentToolCallRecord {
  return { id, name, params: {}, status, result };
}

/**
 * 节点结束后默认折叠，卡片在折叠区里。展开一次再断言，才是用户真实看到的路径。
 */
function renderNode(toolCalls: AgentToolCallRecord[]) {
  const view = render(<AgentExecutionNode node={node(toolCalls)} />);
  const header = view.container.querySelector('button[aria-expanded]');
  if (header && header.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(header);
  }
  return view;
}

const LINT_RESULT = {
  success: true,
  ok: false,
  blockers: 1,
  warnings: 1,
  notes: 0,
  issues: [
    {
      code: 'missing_material', severity: 'blocker',
      message: 'clip c1 points at a missing video material',
      target: { itemId: 'c1' }, suggested_tool: 'add_to_track',
    },
    {
      code: 'audio_gap', severity: 'warning',
      message: 'no audio between 18s and 21s',
      target: { at_seconds: 18 }, suggested_tool: null,
    },
  ],
  checked_rules: ['missing_material', 'audio_gap', 'timeline_empty'],
  next_step: 'Fix the blocker first.',
};

const OBSERVATION = {
  success: true,
  ok: true,
  verdict: 'concern',
  summary: 'The chip factory photo is a stock render, not a real plant.',
  observations: [{ region: 'center', text: 'computer render' }],
  issues: [{ code: 'watermark', severity: 'warning', note: 'faint logo' }],
  text_lines: ['ACME NEWS'],
  images: 1,
  cached: false,
  observation_id: 'obs-1',
  untrusted: true,
  ui: {
    thumbs: ['data:image/jpeg;base64,AAAA'],
    source_labels: ['material: pexels-1234'],
    model: { provider: 'openai', model: 'qwen-vl-plus', source: 'database' },
    elapsed_ms: 1200,
  },
};

const EXPORT_RESULT = {
  success: true,
  ok: false,
  composition_id: 'comp-1',
  probe: {
    duration_seconds: 59.8, width: 1080, height: 1920, has_audio: true,
    black_frames: 1, silence_segments: 1,
    loudness: { integrated_lufs: -22.4, true_peak_dbtp: -0.4 },
  },
  duration_seconds: 59.8,
  issues: [{
    code: 'black_frames', severity: 'blocker', at_seconds: 3.2,
    note: '1.1s of pure black',
  }],
  loudness: { integrated_lufs: -22.4, true_peak_dbtp: -0.4 },
  skipped: ['visual'],
  next_step: 'Re-export after filling the black gap.',
};

describe('AgentExecutionNode — 视觉审阅卡片分派', () => {
  it('check_timeline 结果渲染自检卡片', () => {
    renderNode([call('t1', 'check_timeline', LINT_RESULT)]);
    expect(screen.getByText(copy.lintTitle)).toBeInTheDocument();
  });

  it('view_image 结果渲染视觉观察卡片，缩略图 alt 用来源标签', () => {
    const view = renderNode([call('t2', 'view_image', OBSERVATION)]);
    expect(screen.getByText(copy.visionTitle)).toBeInTheDocument();
    const image = view.container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('alt', OBSERVATION.ui.source_labels[0]);
  });

  it('inspect_export 结果渲染成品探测卡片并列出未检测项', () => {
    renderNode([call('t3', 'inspect_export', EXPORT_RESULT)]);
    expect(screen.getByText(copy.exportTitle)).toBeInTheDocument();
    // 未跑成的探测项必须如实出现，不能"看起来全绿"。
    expect(screen.getByText(
      copy.exportSkipped.replace('{item}', 'Visual spot check')))
      .toBeInTheDocument();
  });

  it('三个视觉工具同时出现时各自渲染，不互相吞掉', () => {
    renderNode([
      call('t1', 'check_timeline', LINT_RESULT),
      call('t2', 'view_image', OBSERVATION),
      call('t3', 'inspect_export', EXPORT_RESULT),
    ]);
    expect(screen.getByText(copy.lintTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.visionTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.exportTitle)).toBeInTheDocument();
  });

  it('失败态用 role="alert" 并给出错误码', () => {
    renderNode([
      call('t4', 'view_image', {
        success: false,
        error_code: 'vision_unavailable',
        next_step: 'Configure a vision model first.',
      }, 'error'),
    ]);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(copy.visionTitle);
    expect(alert.textContent).toContain('vision_unavailable');
  });

  it('运行中的 check_timeline 不得渲染"全部通过"', () => {
    // `tool_call` 事件只有 status:'executing'、没有 result。若照样分派到卡片，
    // 卡片会从空结果里读出 blockers=0 并显示"全部通过"——自检还没跑完就先
    // 绿了，正是本功能要消灭的假绿（AC-04 / AC-27）。
    renderNode([{ id: 't6', name: 'check_timeline', params: {}, status: 'executing' }]);
    expect(screen.queryByText(copy.lintTitle)).toBeNull();
    expect(screen.queryByText(
      copy.lintAllPassed.replace('{count}', '15'))).toBeNull();
  });

  it('被取消的 view_image 也没有结果，不得渲染观察卡片', () => {
    renderNode([{ id: 't7', name: 'view_image', params: {}, status: 'cancelled' }]);
    expect(screen.queryByText(copy.visionTitle)).toBeNull();
  });

  it('未知工具仍走普通 ToolStep，不被视觉分派截走', () => {
    renderNode([call('t5', 'some_other_tool', { success: true })]);
    expect(screen.queryByText(copy.visionTitle)).toBeNull();
    expect(screen.queryByText(copy.lintTitle)).toBeNull();
  });
});
