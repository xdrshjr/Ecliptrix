/**
 * AG2-20: the agent chat timeline follows the UI language. Source-level
 * guard against English labels (and Chinese stream errors) creeping back in.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import responseNodeSource from '../../../components/video/components/VideoChatWindow/timeline/AgentResponseNode.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import chatPanelSource from '../../../components/video/components/VideoChatWindow/timeline/TimelineChatPanel.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import executionNodeSource from '../../../components/video/components/VideoChatWindow/timeline/AgentExecutionNode.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import toolStepSource from '../../../components/video/components/VideoChatWindow/timeline/ToolStep.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import thinkingNodeSource from '../../../components/video/components/VideoChatWindow/timeline/AgentThinkingNode.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import userNodeSource from '../../../components/video/components/VideoChatWindow/timeline/UserMessageNode.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import errorCardSource from '../../../components/video/components/VideoChatWindow/timeline/ErrorStateCard.tsx?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import utilsSource from '../../../components/video/components/VideoChatWindow/timeline/utils.ts?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import agentExecutionSource from '../../../components/video/hooks/useAgentExecution.ts?raw';
// @ts-expect-error -- Vite resolves ?raw imports; this repo has no ambient typing for them
import errorRecoverySource from '../errorRecovery.ts?raw';

const UI_SOURCES: Record<string, string> = {
  AgentResponseNode: String(responseNodeSource),
  TimelineChatPanel: String(chatPanelSource),
  AgentExecutionNode: String(executionNodeSource),
  ToolStep: String(toolStepSource),
  AgentThinkingNode: String(thinkingNodeSource),
  UserMessageNode: String(userNodeSource),
  ErrorStateCard: String(errorCardSource),
  utils: String(utilsSource),
  useAgentExecution: String(agentExecutionSource),
};

/** Literal labels that used to be hardcoded (string literals and JSX text). */
const HARDCODED_LABELS: readonly RegExp[] = [
  /Undo All/,
  /Undo Single/,
  /\(undone\)/,
  /['"`]Executing/,
  /(^|[^A-Za-z])Executing:/,
  /['"`]Executed['"`]/,
  />\s*(AI|Executing|Executed|Cancel|Cancel Execution|Retry|Parameters|Result|Operations undone)\s*</,
  /Agent error:/,
  /Agent is working/,
  /click to expand/,
  /The model did not return a response/,
  /An unexpected error occurred/,
  /Execution Timed Out|Execution Error|Reconnecting\.\.\./,
  /Thinking\.\.\.|Thought Process|AI Analyzing/,
  />\s*User\s*</,
];

function cjkPattern(): RegExp {
  // Built from code points so this file itself stays ASCII.
  return new RegExp(`[${String.fromCharCode(0x4e00)}-${String.fromCharCode(0x9fff)}]`);
}

describe('agent timeline UI text', () => {
  it('agent timeline UI has no hardcoded English labels', () => {
    const hits = Object.entries(UI_SOURCES).flatMap(([file, source]) =>
      HARDCODED_LABELS.filter(pattern => pattern.test(source)).map(pattern => `${file}: ${pattern}`),
    );

    expect(hits).toEqual([]);
  });

  it('stream error recovery carries no Chinese user text', () => {
    expect(cjkPattern().test(String(errorRecoverySource))).toBe(false);
  });
});
