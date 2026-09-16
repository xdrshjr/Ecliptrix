import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTranslations } from '@/lib/i18n';
import type { ChatMessage } from '@/types';
import * as motion from 'framer-motion';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import thinkingSource from '../AgentThinkingNode.tsx?raw';
// @ts-expect-error Vitest raw source loader for JSX-preserving projects.
import iconSource from '../TimelineNodeIcon.tsx?raw';
import * as animations from '../animations';
import * as utils from '../utils';
import type { AgentThinkingNodeData } from '../types';
import {
  compileComponent, reactModules, localeContextModule,
} from '@/components/video/timeline/__tests__/test-utils/compileComponent';
import { mapMessageToNodes } from '../utils';

vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: getTranslations('zh-CN') }),
}));
afterEach(cleanup);

const modules = {
  ...reactModules(), ...localeContextModule(() => 'zh-CN'),
  'framer-motion': motion, './animations': animations, './utils': utils,
};
const AgentThinkingNode = compileComponent<{ node: AgentThinkingNodeData }>(
  thinkingSource, {
    ...modules,
    './TimelineNodeIcon': compileComponent(iconSource, modules),
  },
);

describe('思考图标生命周期', () => {
  it.each([true, false])('思考分支 %s 结束时立即移除旋转及光标', isThinkingPhase => {
    const node = {
      kind: 'thinking' as const, id: 'thinking', timestamp: new Date(0),
      content: '分析内容', isThinkingPhase, isStreaming: true,
    };
    const { container, rerender } = render(React.createElement(AgentThinkingNode, { node }));
    expect(container.querySelector('.timeline-anim-spin')).not.toBeNull();
    rerender(React.createElement(AgentThinkingNode, {
      node: { ...node, isStreaming: false },
    }));
    expect(container.querySelector('.timeline-anim-spin')).toBeNull();
    expect(container.querySelector('.timeline-anim-cursor-blink')).toBeNull();
    expect(container.textContent).toContain(getTranslations('zh-CN').agentTimeline.thoughtProcess);
  });

  it.each([
    { isStreaming: false, isCancelled: false },
    { isStreaming: true, isCancelled: true },
  ])('中断或历史思考保持静态且不生成空响应卡', patch => {
    const message: ChatMessage = {
      id: 'm', role: 'assistant', timestamp: new Date(0), content: '',
      isAgentMessage: true, thinkingContent: '思考内容', isThinking: true,
      ...patch,
    };
    const nodes = mapMessageToNodes(message, { emptyResponse: '空响应' });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'thinking', isStreaming: false });
  });
});
