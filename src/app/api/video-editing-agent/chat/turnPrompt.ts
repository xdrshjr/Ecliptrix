import type { MaterialItem } from '@/types';
import {
  buildUserPrompt, loadSkillForTurn, sanitizeMentions,
} from '@/lib/video-editing-agent/skillContext';
import type { SSEEvent } from '@/lib/video-editing-agent/types';

/**
 * 把用户原文、用户用 `/` 指定的技能、用 `@` 引用的素材合成本轮发给模型的提示。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.5。
 * 技能取不到时**降级为普通请求**并发 `skill_skipped`，绝不让回合失败（§R-07）。
 */
export interface TurnPromptInput {
  apiBaseUrl: string;
  text: string;
  skillId?: unknown;
  mentions?: unknown;
  materials: MaterialItem[];
  send: (event: SSEEvent) => void;
}

export async function resolveTurnPrompt(input: TurnPromptInput): Promise<string> {
  const { apiBaseUrl, text, send } = input;
  const mentions = sanitizeMentions(input.mentions,
    new Set(input.materials.map(material => material.id)));
  const skillId = typeof input.skillId === 'string' ? input.skillId : '';
  if (!skillId) return buildUserPrompt({ text, mentions });

  const loaded = await loadSkillForTurn(apiBaseUrl, skillId);
  if (loaded.ok) return buildUserPrompt({ text, skill: loaded.skill, mentions });

  // 日志只记 skillId 与原因，不含正文。
  console.warn(`[VideoEditingAgent] skill skipped id=${skillId.slice(0, 40)} reason=${loaded.reason}`);
  send({ type: 'skill_skipped', skillId: skillId.slice(0, 40), reason: loaded.reason });
  return buildUserPrompt({ text, mentions });
}
