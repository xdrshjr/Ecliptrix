import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from '../registry';
import { createToolRegistry } from '../tools/index';
import type { AgentAutonomy, ToolContext } from '../types';
import type { TimelineState } from '@/types';

/**
 * YOLO 下 `ask_user` 根本不注册（docs/plans/agent-yolo-autonomous-mode
 * spec.md §4.4 / AC-A2）。
 *
 * 默认路径的既有断言（`toolkitTools.test.ts:155-179`：
 * 12 个工具全注册、常驻含 `ask_user`、`workflow_tools` 四项）
 * 一字不改，本文件只断言 YOLO 的相反事实。
 */

function makeContext(autonomy?: AgentAutonomy): ToolContext {
  const timelineState: TimelineState = {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 0.1, scrollLeft: 0,
  };
  return {
    timelineState, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => undefined,
    recordOperation: () => undefined, turnState: {}, callBudget: { used: 0 },
    autonomy,
  };
}

const WORKFLOW = CATEGORY_IDS.WORKFLOW_TOOLS;

describe('YOLO 注册表', () => {
  it('has no ask_user anywhere in the registry', () => {
    const registry = createToolRegistry(makeContext('yolo'));
    expect(registry.getAllTools().map(tool => tool.name))
      .not.toContain('ask_user');
    expect(registry.getCategoryTools(WORKFLOW).map(tool => tool.name))
      .not.toContain('ask_user');
    expect(registry.getAlwaysAvailableTools().map(tool => tool.name))
      .not.toContain('ask_user');
    expect(registry.getTool('ask_user')).toBeUndefined();
  });

  it('leaves workflow_tools with exactly three tools', () => {
    const registry = createToolRegistry(makeContext('yolo'));
    expect(registry.getCategoryTools(WORKFLOW).map(tool => tool.name))
      .toEqual(['update_plan', 'check_timeline', 'use_skill']);
  });

  it('drops exactly one tool compared with the interactive registry', () => {
    const interactive = createToolRegistry(makeContext());
    const yolo = createToolRegistry(makeContext('yolo'));
    const interactiveNames = interactive.getAllTools().map(tool => tool.name);
    const yoloNames = yolo.getAllTools().map(tool => tool.name);
    expect(interactiveNames).toContain('ask_user');
    expect(interactiveNames.length - yoloNames.length).toBe(1);
    expect(yoloNames.every(name => name !== 'ask_user')).toBe(true);
  });

  it('explore_tools still lists workflow_tools without the tool', async () => {
    const registry = createToolRegistry(makeContext('yolo'));
    const info = registry.getCategoryToolInfo(WORKFLOW);
    expect(info?.tools.map(tool => tool.name)).not.toContain('ask_user');
    // 类别本身仍在（否则 use_skill 预加载会整类失效）。
    expect(registry.getCategorySummaries().map(item => item.id))
      .toContain(WORKFLOW);
  });
});
