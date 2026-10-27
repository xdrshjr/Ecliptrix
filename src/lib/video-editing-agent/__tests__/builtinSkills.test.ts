// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../types';
import { createToolRegistry } from '../tools/index';
import { CORE_TOOLKIT_TOOL_NAMES } from '../promptParts';

/**
 * AC-B1 (front-end half): every tool a built-in skill names exists in the real
 * registry, and the preload groups obey `ToolActivationState.load` limits
 * (≤ 2 non-resident categories, ≤ 4 tools each). The back end only checks the
 * NAME FORMAT of `tools`; this is the test that catches a renamed tool.
 */

const BUILTIN_ROOT = path.resolve(
  __dirname, '../../../../backend-services/basic-service/app/services/agent_skills/builtin');

function frontmatterList(markdown: string, key: string): string[] {
  const head = markdown.split(/\r?\n---\r?\n/)[0];
  const line = head.split(/\r?\n/).find(item => item.startsWith(`${key}:`));
  if (!line) return [];
  const flow = /\[(.*)\]/.exec(line);
  return flow ? flow[1].split(',').map(item => item.trim()).filter(Boolean) : [];
}

function context(): ToolContext {
  return {
    timelineState: {
      currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [], tracks: [],
      playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 0.1, scrollLeft: 0,
    },
    materials: [], apiBaseUrl: 'http://127.0.0.1:3000', operations: new Map(),
    updateTimeline: () => undefined, recordOperation: () => undefined, turnState: {}, callBudget: { used: 0 },
  };
}

const skills = readdirSync(BUILTIN_ROOT).map(id => ({
  id, markdown: readFileSync(path.join(BUILTIN_ROOT, id, 'SKILL.md'), 'utf-8'),
}));
const registry = createToolRegistry(context());
const categoryOf = new Map<string, string>();
for (const categoryId of registry.getCategoryIds()) {
  for (const tool of registry.getCategoryTools(categoryId)) categoryOf.set(tool.name, categoryId);
}

describe('built-in skills', () => {
  it('ships exactly the seven designed skills', () => {
    expect(skills.map(skill => skill.id).sort()).toEqual([
      'explainer-video', 'final-qc-and-export', 'news-digest-video',
      'parallel-sourcing', 'quick-assemble', 'storyboard-short', 'web-footage-sourcing',
    ]);
  });

  it.each(skills)('$id: every named tool exists in the registry', ({ markdown }) => {
    for (const tool of frontmatterList(markdown, 'tools')) {
      expect(categoryOf.has(tool), `unknown tool ${tool}`).toBe(true);
    }
  });

  it.each(skills)('$id: preload groups fit the activation limits', ({ markdown }) => {
    const groups = new Map<string, string[]>();
    for (const tool of frontmatterList(markdown, 'tools')) {
      const category = categoryOf.get(tool)!;
      if (CORE_TOOLKIT_TOOL_NAMES.includes(tool)
        || registry.getCategory(category)?.alwaysAvailable) continue;
      groups.set(category, [...(groups.get(category) ?? []), tool]);
    }
    expect(groups.size).toBeLessThanOrEqual(2);
    for (const names of Array.from(groups.values())) expect(names.length).toBeLessThanOrEqual(4);
  });

  it.each(skills)('$id: declares only known capabilities in requires', ({ markdown }) => {
    for (const requirement of frontmatterList(markdown, 'requires')) {
      expect(['web', 'browser', 'vision', 'documents', 'tts', 'crew']).toContain(requirement);
    }
  });

  it('keeps the narration_text mandate from the migrated explainer recipe', () => {
    const explainer = skills.find(skill => skill.id === 'explainer-video')!;
    expect(explainer.markdown).toContain('narration_text');
  });

  it('does not ask the agent to export by itself (final-qc-and-export)', () => {
    const qc = skills.find(skill => skill.id === 'final-qc-and-export')!;
    expect(qc.markdown).toMatch(/不负责导出|不(要|得)?自行导出|do not export/i);
  });
});
