import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { ToolRegistry } from '../registry/ToolRegistry';
import { CORE_TOOLKIT_TOOL_NAMES } from '../promptParts';
import { unmetRequirements } from '../skillContext';
import { utf8Slice } from '../modelContextBudget';
import { executeToolkitTool, toolkitFailure, toolkitResult } from './toolkitAdapter';
import { RESULT_BYTE_CAP } from './webToolAdapter';

/**
 * `use_skill`：读取一份剪辑套路（L1 正文），并预加载它声明的工具。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.5。
 * 技能不授予任何权限：预加载的只是**本来就存在**的工具，联网/下载/生成的开关与
 * 确认仍由各自的设置与网关控制。
 */

const SKILLS_BASE_PATH = '/api/agent-skills';
const SKILL_FIELDS = ['id', 'name', 'version', 'tools', 'requires', 'body',
  'enabled', 'valid'] as const;
/** 信封（除 body 外的字段）的预留字节，防止正文把整条结果推过 12 KiB。 */
const ENVELOPE_RESERVE_BYTES = 64;

const parameters = Type.Object({
  id: Type.String({ pattern: '^[a-z][a-z0-9-]{2,39}$',
    description: 'Skill id from the 可用技能 list.' }),
});

type Params = Static<typeof parameters>;

interface SkillPayload {
  id: string; name: string; version: number; tools: string[]; requires: string[];
  body: string; enabled: boolean; valid: boolean;
}

interface Unavailable { tool: string; reason: string }

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** tool name → category id；注册表是唯一事实来源，技能文件里不写类别。 */
function findCategory(registry: ToolRegistry, toolName: string): string | null {
  for (const categoryId of registry.getCategoryIds()) {
    if (registry.getCategoryTools(categoryId).some(tool => tool.name === toolName)) {
      return categoryId;
    }
  }
  return null;
}

function isResident(registry: ToolRegistry, categoryId: string, toolName: string): boolean {
  return CORE_TOOLKIT_TOOL_NAMES.includes(toolName)
    || registry.getCategory(categoryId)?.alwaysAvailable === true;
}

/**
 * 按所属类别分组预加载：每组 ≤ 4 个、最多 2 组（`ToolActivationState.load` 的
 * 约束）。任何一组失败只把该组记入 `unavailable`，技能整体不失败。
 */
export function preloadSkillTools(
  context: ToolContext, registry: ToolRegistry, tools: readonly string[],
): { loaded: string[]; unavailable: Unavailable[] } {
  const loaded: string[] = [];
  const unavailable: Unavailable[] = [];
  const groups = new Map<string, string[]>();
  for (const name of tools) {
    const category = findCategory(registry, name);
    if (!category) {
      unavailable.push({ tool: name, reason: 'unknown_tool' });
    } else if (isResident(registry, category, name)) {
      loaded.push(name);
    } else {
      groups.set(category, [...(groups.get(category) ?? []), name]);
    }
  }
  let groupCount = 0;
  for (const [category, names] of Array.from(groups)) {
    const batch = names.slice(0, 4);
    names.slice(4).forEach(tool => unavailable.push({ tool, reason: 'group_limit' }));
    if (++groupCount > 2 || !context.loadTools) {
      batch.forEach(tool => unavailable.push({ tool, reason: 'group_limit' }));
      continue;
    }
    try {
      loaded.push(...context.loadTools(category, batch).loaded);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'load_failed';
      batch.forEach(tool => unavailable.push({ tool, reason }));
    }
  }
  return { loaded, unavailable };
}

/** 正文在 JSON 转义后可能膨胀（换行/引号）；收敛到整条结果 ≤ `RESULT_BYTE_CAP`。 */
function fitBody(rest: Record<string, unknown>, body: string): { body: string; cut: boolean } {
  const room = RESULT_BYTE_CAP - jsonBytes({ ...rest, body: '' }) - ENVELOPE_RESERVE_BYTES;
  let current = body;
  let budget = new TextEncoder().encode(body).length;
  while (current && jsonBytes(current) - 2 > room) {
    budget = Math.floor(budget * 0.9);
    current = utf8Slice(body, budget);
  }
  return { body: current, cut: current !== body };
}

function buildNote(
  skill: SkillPayload, unmet: string[], preload: { loaded: string[]; unavailable: Unavailable[] },
): string {
  const notes: string[] = [];
  if (unmet.length) {
    notes.push(`${unmet.join('/')} capability is currently unavailable; tell the user `
      + 'and take the local-materials path instead.');
  }
  if (preload.loaded.some(tool => !CORE_TOOLKIT_TOOL_NAMES.includes(tool))) {
    notes.push('Tools above are callable on your NEXT response.');
  }
  if (preload.unavailable.length) {
    notes.push('Some listed tools could not be preloaded; use explore_tools for them.');
  }
  return notes.join(' ') || `Follow the steps of skill ${skill.id}.`;
}

export function createSkillTool(
  context: ToolContext, registry: ToolRegistry,
): AgentTool<typeof parameters> {
  return {
    name: 'use_skill',
    label: 'Use skill',
    description:
      'Load a skill (a proven editing procedure) listed under 可用技能 and preload the tools it '
      + 'names. Returns the procedure body; follow it, starting with update_plan. Skills grant '
      + 'no permissions — disabled capabilities stay disabled.',
    parameters,
    execute: async (toolCallId: string, params: Params) => {
      const result = await executeToolkitTool(context, toolCallId, {
        basePath: SKILLS_BASE_PATH,
        path: `/${params.id}`,
        select: SKILL_FIELDS,
      });
      const details = result.details as unknown as Partial<SkillPayload> & { success?: boolean };
      if (details.success !== true) return result;
      const skill = details as SkillPayload;
      if (!skill.enabled) return toolkitFailure('skill_disabled', { id: skill.id });
      if (!skill.valid || !skill.body) return toolkitFailure('invalid_skill', { id: skill.id });

      const preload = preloadSkillTools(context, registry, skill.tools ?? []);
      const unmet = unmetRequirements(skill.requires ?? [], context.skillAvailability ?? {});
      const rest = {
        success: true, id: skill.id, name: skill.name, version: skill.version,
        loaded_tools: preload.loaded, unavailable: preload.unavailable,
        note: buildNote(skill, unmet, preload),
      };
      const fitted = fitBody(rest, skill.body);
      return toolkitResult({
        ...rest, body: fitted.body,
        ...(fitted.cut ? { body_truncated: true } : {}),
      });
    },
  };
}
