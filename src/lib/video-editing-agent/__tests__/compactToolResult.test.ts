/**
 * AG2-12: inline media never reaches stored tool results or model context.
 * RV-16: tool cards render results as text, so the placeholder can never
 * become a broken <img>.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AgentToolCallCard from '@/components/video/components/VideoChatWindow/AgentToolCallCard';
import { getTranslations } from '@/lib/i18n';
import type { ChatMessage } from '@/types';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import toolStepSource from '@/components/video/components/VideoChatWindow/timeline/ToolStep.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import executionNodeSource from '@/components/video/components/VideoChatWindow/timeline/AgentExecutionNode.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import responseNodeSource from '@/components/video/components/VideoChatWindow/timeline/AgentResponseNode.tsx?raw';
import { AgentStateManager } from '../AgentStateManager';
import { compactToolResult, INLINE_MEDIA_PLACEHOLDER } from '../compactToolResult';
import { convertToAgentMessages } from '../messageConverter';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';
vi.mock('@/contexts/LocaleContext', () => ({
  useLocale: () => ({ t: getTranslations('zh-CN') }),
}));

describe('compactToolResult', () => {
  it('compactToolResult replaces nested data urls', () => {
    const result = {
      success: true,
      materials: [{ id: 'm1', thumbnailUrl: DATA_URL, url: '/api/storage/files/video/m1.mp4' }],
      preview: 'blob:http://localhost/1234',
    };

    expect(compactToolResult(result)).toEqual({
      success: true,
      materials: [{ id: 'm1', thumbnailUrl: INLINE_MEDIA_PLACEHOLDER, url: '/api/storage/files/video/m1.mp4' }],
      preview: INLINE_MEDIA_PLACEHOLDER,
    });
  });

  it('does not mutate the original result', () => {
    const result = { thumbnailUrl: DATA_URL };
    compactToolResult(result);
    expect(result.thumbnailUrl).toBe(DATA_URL);
  });

  it('stores tool results without inline media', () => {
    const manager = new AgentStateManager('msg-1');
    manager.addToolCall({ id: 'tc-1', name: 'list_materials', params: {}, status: 'executing' });

    manager.updateToolStatus('tc-1', 'completed', { materials: [{ thumbnailUrl: DATA_URL }] });

    expect(manager.getSnapshot().toolCalls[0].result).toEqual({
      materials: [{ thumbnailUrl: INLINE_MEDIA_PLACEHOLDER }],
    });
  });

  it('replayed tool results drop inline data urls', () => {
    const history: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'list', timestamp: new Date(0) },
      {
        id: 'a1', role: 'assistant', content: '', timestamp: new Date(0), isAgentMessage: true,
        agentToolCalls: [{
          id: 'tc-1', name: 'list_materials', params: {}, status: 'completed',
          result: { materials: [{ id: 'm1', thumbnailUrl: DATA_URL }] },
        }],
      },
    ];

    const toolResult = convertToAgentMessages(history).find(m => m.role === 'toolResult');
    const text = (toolResult?.content[0] as { text: string }).text;

    expect({ hasPlaceholder: text.includes(INLINE_MEDIA_PLACEHOLDER), hasDataUrl: text.includes('data:image') })
      .toEqual({ hasPlaceholder: true, hasDataUrl: false });
  });

  it('tool cards render results as text and never feed them to an <img>', () => {
    const sources = [toolStepSource, executionNodeSource, responseNodeSource].map(String);
    expect(sources.filter(source => /<img\b/.test(source))).toEqual([]);
  });

  it.each(['list_materials', 'create_video_cover'])(
    '%s的内联媒体占位符不能变成图片来源', name => {
      const markup = renderToStaticMarkup(createElement(AgentToolCallCard, {
        toolCall: { id: 'call', name, params: {}, status: 'completed',
          result: compactToolResult({
            thumbnailUrl: DATA_URL,
            coverStatus: { state: 'not_applied', thumbnailUrl: DATA_URL },
          }),
        },
      }));
      expect(markup).not.toMatch(/<img\b/);
      expect(markup).not.toContain(DATA_URL);
    });
});
