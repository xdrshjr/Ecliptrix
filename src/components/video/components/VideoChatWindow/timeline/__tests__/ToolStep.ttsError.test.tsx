import React from 'react';
import * as motion from 'framer-motion';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getTranslations, type SupportedLocale } from '@/lib/i18n';
import * as ttsErrors from '@/lib/ttsErrors';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import source from '../ToolStep.tsx?raw';
import * as animations from '../animations';
import * as utils from '../utils';
import type { ToolStepData } from '../types';
import {
  compileComponent, reactModules, localeContextModule,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';

let locale: SupportedLocale = 'zh-CN';
const ToolStep = compileComponent<{ step: ToolStepData }>(source, {
  ...reactModules(), ...localeContextModule(() => locale),
  'framer-motion': motion, '@/lib/ttsErrors': ttsErrors,
  './utils': utils, './animations': animations,
});
afterEach(() => { cleanup(); locale = 'zh-CN'; });

const failure = {
  success: false, error_code: 'TTS_INSUFFICIENT_BALANCE',
  error: '原错误摘要', error_details: {
    source: 'provider', retryable: false, attempts: 1,
    provider_message: 'insufficient balance', request_id: 'request-01',
  },
};
function step(result: unknown = failure): ToolStepData {
  return {
    id: 'tts', name: 'generate_tts', displayName: '生成配音',
    status: 'error', params: {}, summary: '原错误摘要',
    elapsedMs: 200, result,
  };
}

describe('TTS 失败卡片', () => {
  it('原因只显示一次且不截断，展开仅增加安全诊断', () => {
    const summary = getTranslations('zh-CN').ttsErrors.summary.TTS_INSUFFICIENT_BALANCE;
    render(React.createElement(ToolStep, { step: step() }));
    expect(screen.getAllByText(summary)).toHaveLength(1);
    expect(screen.getByText(summary).className).not.toContain('truncate');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByText(summary)).toHaveLength(1);
    expect(screen.getByText('request-01')).toBeInTheDocument();
    expect(screen.queryByText('原错误摘要')).not.toBeInTheDocument();
  });

  it('历史结构化错误随界面语言重新翻译', () => {
    const view = render(React.createElement(ToolStep, { step: step() }));
    locale = 'en';
    view.rerender(React.createElement(ToolStep, { step: step() }));
    expect(screen.getByText(
      getTranslations('en').ttsErrors.summary.TTS_INSUFFICIENT_BALANCE,
    )).toBeInTheDocument();
  });

  it('部分完成显示计数和段落失败，不显示绿色全成功', () => {
    const partial = { ...step({
      success: true, partial: true, total_segments: 2,
      successful_segments: 1, failed_segments: 1,
      failures: [{ ...failure, input_index: 1, segment_id: 'b' }],
    }), name: 'batch_generate_tts', status: 'completed' as const };
    const { container } = render(React.createElement(ToolStep, { step: partial }));
    expect(screen.getByText(getTranslations('zh-CN').ttsErrors.partial)).toBeInTheDocument();
    expect(screen.getByText('成功 1/2 段，1 段失败')).toBeInTheDocument();
    expect(container.querySelector('.text-green-500')).toBeNull();
  });

  it('撤销或取消状态不伪装为部分完成', () => {
    render(React.createElement(ToolStep, { step: {
      ...step({ success: true, partial: true }), status: 'cancelled',
    } }));
    expect(screen.queryByText(getTranslations('zh-CN').ttsErrors.partial))
      .not.toBeInTheDocument();
  });

  it('TTS 的本地应用失败展开后仍可见且优先于供应商错误', () => {
    const localFailure = step({
      ...failure, clientApplyError: { reason: 'track-not-found' },
    });
    const copy = getTranslations('zh-CN').agentApply;
    const expected = `${copy.notApplied} · ${copy.reasons.trackNotFound}`;
    render(React.createElement(ToolStep, { step: localFailure }));
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByText(expected)).toHaveLength(1);
    expect(screen.queryByText(
      getTranslations('zh-CN').ttsErrors.summary.TTS_INSUFFICIENT_BALANCE,
    )).not.toBeInTheDocument();
  });
});
