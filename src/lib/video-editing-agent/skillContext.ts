import type { SkillIndexEntry, SkillDetail } from '@/types/agentSkills';
import { SKILL_ID_PATTERN } from '@/types/agentSkills';
import type { SkillSkipReason, WebCapabilitySnapshot } from './types';

/**
 * 技能（Skill）在 Agent 侧的三处接入：L0 索引、用户显式调用的正文、引用素材。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.5。
 * 技能只是提示词内容，不授予任何权限；本模块所有读取都**降级为「没有技能」**，
 * 绝不让一次技能服务故障变成整轮失败。
 */

const SKILL_INDEX_TTL_MS = 60_000;
const SKILL_FETCH_TIMEOUT_MS = 1_500;
/** L0 索引的硬上限（§3.3.1）。 */
export const SKILL_INDEX_MAX_LINES = 10;
export const SKILL_INDEX_LINE_MAX_CHARS = 130;
export const SKILL_INDEX_TOTAL_MAX_CHARS = 1_300;
const MENTION_MAX_COUNT = 10;
const MENTION_LABEL_MAX_CHARS = 40;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const MARKDOWN_PREFIX = /^[#\-*>`\s]+/;

const skillIndexCache = new Map<string, { at: number; value: SkillIndexEntry[] }>();

/** 后端拒绝含路径分隔符/控制字符的 call id，键要先净化再当 header 用。 */
function callIdFor(prefix: string, key: string): string {
  return `${prefix}-${(key || 'global').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 96)}`;
}

/** 折叠为单行并去掉控制字符（深度防御：技能文件可能被用户在磁盘上手改）。 */
export function toSingleLine(text: string): string {
  return text.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

function cleanIndexText(text: unknown): string {
  return typeof text === 'string'
    ? toSingleLine(text).replace(MARKDOWN_PREFIX, '') : '';
}

function codePointSlice(text: string, maxChars: number): string {
  return Array.from(text).slice(0, maxChars).join('');
}

async function fetchEnvelope<T>(
  url: string, apiBaseUrl: string, callId: string,
): Promise<{ status: number; data: T | null }> {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(SKILL_FETCH_TIMEOUT_MS),
    headers: { Origin: apiBaseUrl, 'x-tool-call-id': callId },
  });
  if (!response.ok) return { status: response.status, data: null };
  const envelope = await response.json() as { success?: boolean; data?: T };
  return { status: response.status, data: envelope.success ? envelope.data ?? null : null };
}

/**
 * L0 索引：1.5 秒超时、进程内 60 秒缓存，失败返回空数组且不阻塞回合。
 * 面板里启停/编辑后，索引最多滞后 60 秒（显式 `skillId` 不走此缓存）。
 */
export async function loadSkillIndex(
  apiBaseUrl: string, projectId: string | undefined,
): Promise<SkillIndexEntry[]> {
  const key = projectId ?? '';
  const cached = skillIndexCache.get(key);
  if (cached && Date.now() - cached.at < SKILL_INDEX_TTL_MS) return cached.value;
  try {
    const { data } = await fetchEnvelope<{ skills?: SkillIndexEntry[] } | SkillIndexEntry[]>(
      `${apiBaseUrl}/api/agent-skills/index`, apiBaseUrl, callIdFor('skills', key));
    const list = Array.isArray(data) ? data : data?.skills;
    if (!Array.isArray(list)) return [];
    skillIndexCache.set(key, { at: Date.now(), value: list });
    return list;
  } catch (error) {
    console.warn('[VideoEditingAgent] skill index unavailable:',
      error instanceof Error ? error.name : 'unknown');
    return [];
  }
}

export type SkillLoadResult =
  | { ok: true; skill: Pick<SkillDetail, 'id' | 'name' | 'body'> }
  | { ok: false; reason: SkillSkipReason };

/**
 * 用户显式指定的技能：每次直接读 `/{id}`，保证「刚启用/刚编辑」立即生效。
 * 取不到时一律返回原因，由调用方降级为普通请求并发 `skill_skipped`。
 */
export async function loadSkillForTurn(
  apiBaseUrl: string, skillId: string,
): Promise<SkillLoadResult> {
  if (!SKILL_ID_PATTERN.test(skillId)) return { ok: false, reason: 'not_found' };
  try {
    const { status, data } = await fetchEnvelope<SkillDetail>(
      `${apiBaseUrl}/api/agent-skills/${skillId}`, apiBaseUrl, callIdFor('skill', skillId));
    if (status === 404) return { ok: false, reason: 'not_found' };
    if (!data) return { ok: false, reason: 'unavailable' };
    if (!data.valid || typeof data.body !== 'string' || !data.body.trim()) {
      return { ok: false, reason: 'invalid' };
    }
    if (!data.enabled) return { ok: false, reason: 'disabled' };
    return { ok: true, skill: { id: data.id, name: data.name, body: data.body } };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** 哪些能力当前不可用；`undefined` 表示「不声称任何事」（没有快照）。 */
export type SkillAvailability = Partial<Record<string, boolean>>;

export function skillAvailability(
  snapshot?: WebCapabilitySnapshot | null,
  crewEnabled?: boolean,
): SkillAvailability {
  const crew = crewEnabled === false ? { crew: false } : {};
  if (!snapshot) return crew;
  return {
    web: snapshot.search.available && snapshot.downloads.available,
    browser: snapshot.browser.available && snapshot.browser.enabled !== false,
    ...crew,
  };
}

/** 该技能依赖但当前不可用的能力，用于 L0 后缀与 `use_skill` 的 `note`。 */
export function unmetRequirements(
  requires: readonly string[], availability: SkillAvailability,
): string[] {
  return requires.filter(requirement => availability[requirement] === false);
}

function renderIndexLine(
  entry: SkillIndexEntry, availability: SkillAvailability,
): string | null {
  const id = cleanIndexText(entry.id);
  if (!SKILL_ID_PATTERN.test(id)) return null;
  const unmet = unmetRequirements(Array.isArray(entry.requires) ? entry.requires : [],
    availability);
  const suffix = unmet.length ? ` [unavailable: ${unmet.join(', ')}]` : '';
  const prefix = `- ${id}: `;
  const room = SKILL_INDEX_LINE_MAX_CHARS - prefix.length - suffix.length;
  const description = codePointSlice(cleanIndexText(entry.description), Math.max(room, 0));
  return `${prefix}${description}${suffix}`;
}

const INDEX_HEADER = '## 可用技能\n'
  + '遇到下列类型的任务，先 use_skill(id) 读取套路再动手；'
  + '用户用 / 指定的技能已随消息给出，无需再读。';

/**
 * 渲染 L0「可用技能」段。索引为空 → 返回空串（整段不输出，含引导句）。
 * 超出总长时**整行丢弃**而不是半行截断，保证每一行都以 `- ` 开头。
 */
export function formatSkillIndex(
  index: readonly SkillIndexEntry[] | undefined,
  availability: SkillAvailability = {},
): string {
  const lines = (index ?? []).slice(0, SKILL_INDEX_MAX_LINES)
    .map(entry => renderIndexLine(entry, availability))
    .filter((line): line is string => line !== null);
  if (lines.length === 0) return '';
  const kept: string[] = [];
  let total = INDEX_HEADER.length;
  for (const line of lines) {
    if (total + 1 + line.length > SKILL_INDEX_TOTAL_MAX_CHARS) break;
    kept.push(line);
    total += 1 + line.length;
  }
  return kept.length ? `${INDEX_HEADER}\n${kept.join('\n')}` : '';
}

export interface MentionInput { materialId: string; label: string }

/**
 * 只保留出现在本轮 `materials` 中的引用（未知 id 静默丢弃），label 折叠为
 * 单行并按码点截断，最多 10 条。
 */
export function sanitizeMentions(
  mentions: unknown, materialIds: ReadonlySet<string>,
): MentionInput[] {
  if (!Array.isArray(mentions)) return [];
  const accepted: MentionInput[] = [];
  for (const raw of mentions) {
    const candidate = raw as Partial<MentionInput> | null;
    if (!candidate || typeof candidate.materialId !== 'string'
      || !materialIds.has(candidate.materialId)) continue;
    const label = codePointSlice(toSingleLine(String(candidate.label ?? '')),
      MENTION_LABEL_MAX_CHARS);
    accepted.push({ materialId: candidate.materialId, label: label || candidate.materialId });
    if (accepted.length >= MENTION_MAX_COUNT) break;
  }
  return accepted;
}

function escapeSkillBody(body: string): string {
  return body.replace(/<\/skill>/gi, '<\\/skill>');
}

export interface UserPromptInput {
  text: string;
  skill?: Pick<SkillDetail, 'id' | 'name' | 'body'> | null;
  mentions?: readonly MentionInput[];
}

/**
 * 最终交给 `agent.prompt()` 的字符串：`[技能块] + 用户原文 + [引用素材块]`。
 * 技能块与引用块只存在于本次发往模型的提示里，不写回对话历史。
 */
export function buildUserPrompt(input: UserPromptInput): string {
  const { text, skill, mentions } = input;
  let prompt = text;
  if (skill) {
    const name = toSingleLine(skill.name).replace(/"/g, "'");
    prompt = `<skill id="${skill.id}" name="${name}">\n${escapeSkillBody(skill.body)}\n</skill>\n`
      + '以上是用户指定的剪辑套路，请按其步骤执行，并先 update_plan。\n\n' + prompt;
  }
  if (mentions && mentions.length > 0) {
    prompt += '\n\n[用户引用的素材]\n'
      + mentions.map(item => `- ${item.label} → material_id=${item.materialId}`).join('\n');
  }
  return prompt;
}

/** 仅供测试：清空索引缓存。 */
export function resetSkillIndexCacheForTests(): void {
  skillIndexCache.clear();
}
