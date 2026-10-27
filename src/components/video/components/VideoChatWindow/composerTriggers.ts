import type { MaterialMention } from '@/types/agentSteering';

/**
 * 输入框里 `/`（技能）与 `@`（素材引用）触发器的纯函数部分。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.6 / §3.4.4。
 * 都只看「光标之前」的文本：触发词必须在行首（`/`）或词首（`@`），否则文中的
 * URL、邮箱、路径不会误弹选择器。
 */

export interface TriggerMatch {
  /** 触发词之后已输入的过滤文本。 */
  query: string;
  /** 触发符（`/` 或 `@`）在整段文本里的下标。 */
  start: number;
  /** 光标位置（替换区间的结束）。 */
  end: number;
}

/** 单次最多引用的素材数（与服务端 `MENTION_MAX_COUNT` 对齐）。 */
export const MAX_MENTIONS = 10;

function lineStartIndex(text: string, caret: number): number {
  return text.lastIndexOf('\n', caret - 1) + 1;
}

/** 光标所在行以 `/` 开头且其后无空白 → 技能选择器。 */
export function detectSkillTrigger(text: string, caret: number): TriggerMatch | null {
  const start = lineStartIndex(text, caret);
  const line = text.slice(start, caret);
  const match = /^\/(\S*)$/.exec(line);
  return match ? { query: match[1], start, end: caret } : null;
}

/** 光标之前紧邻 `@词`，且 `@` 在行首或空白之后 → 素材选择器。 */
export function detectMentionTrigger(text: string, caret: number): TriggerMatch | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const start = before.length - match[2].length - 1;
  return { query: match[2], start, end: caret };
}

/** 选中技能：把 `/xxx` 从文本里去掉（技能以芯片形式保留）。 */
export function removeTrigger(text: string, match: TriggerMatch): { text: string; caret: number } {
  const next = text.slice(0, match.start) + text.slice(match.end);
  return { text: next, caret: match.start };
}

/** 选中素材：把 `@词` 替换为 `@素材名 `。 */
export function insertMention(
  text: string, match: TriggerMatch, label: string,
): { text: string; caret: number } {
  const inserted = `@${label} `;
  const next = text.slice(0, match.start) + inserted + text.slice(match.end);
  return { text: next, caret: match.start + inserted.length };
}

/**
 * 发送前剔除文本里已不存在的 `@素材名` 引用，按出现顺序去重并截到上限。
 * `truncated` 为真时由调用方提示「多余的已忽略」。
 */
export function activeMentions(
  text: string, mentions: readonly MaterialMention[],
): { mentions: MaterialMention[]; truncated: boolean } {
  const seen = new Set<string>();
  const present = mentions.filter(item => {
    if (seen.has(item.materialId) || !text.includes(`@${item.label}`)) return false;
    seen.add(item.materialId);
    return true;
  });
  return { mentions: present.slice(0, MAX_MENTIONS), truncated: present.length > MAX_MENTIONS };
}

/** 子串过滤（大小写不敏感）；空查询返回全部。 */
export function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some(field => field?.toLowerCase().includes(needle));
}
