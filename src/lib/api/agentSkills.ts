/**
 * `/api/agent-skills` 类型化客户端（`/` 选择器与设置中心「Agent 技能」面板共用）。
 *
 * 全程走 BFF 白名单代理与 `http-client` 包装；4xx/5xx 抛 `ApiError`，其 `code`
 * 是后端错误码闭集（见 `src/types/agentSkills.ts`）。唯一的例外是
 * `validateSkill`：面板要在输入过程中展示校验结果，因此把"内容不合格"折叠成
 * `{ valid: false }` 而不是抛错。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.4 / §3.3.6。
 */
import { ApiError, http } from '@/lib/api/http-client';
import type {
  DeleteSkillResult,
  EnableSkillResult,
  SkillDetail,
  SkillSummary,
  ValidateResult,
  SkillValidationPreview,
} from '@/types/agentSkills';

const BASE = '/api/agent-skills';
/** 列表缓存时长：`/` 选择器频繁打开，面板里改动后会主动失效。 */
export const SKILLS_LIST_CACHE_MS = 30_000;
/** `validateSkill` 把这些状态码视为"内容不合格"，而不是传输失败。 */
const VALIDATION_STATUSES = new Set([413, 422]);

interface Envelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
  error_code?: string;
}

let listCache: { at: number; skills: SkillSummary[] } | null = null;
let listInFlight: Promise<SkillSummary[]> | null = null;

/** 面板里创建/编辑/删除/启停之后调用，使下一次 `listSkills` 重新读取。 */
export function invalidateSkillsCache(): void {
  listCache = null;
  listInFlight = null;
}

function unwrap<T>(envelope: Envelope<T> | null): T {
  if (!envelope || envelope.success === false || envelope.data === undefined) {
    throw new ApiError(
      200,
      envelope?.error_code ?? 'internal_error',
      envelope?.message ?? 'Unexpected agent-skills response',
    );
  }
  return envelope.data;
}

async function fetchSkillList(): Promise<SkillSummary[]> {
  const envelope = await http.get<Envelope<{ skills: SkillSummary[] }>>(BASE);
  return unwrap(envelope).skills;
}

/**
 * 管理列表（含禁用、无效、被内置遮蔽的条目）。
 *
 * @param options.force 跳过 30 秒缓存。
 * @throws ApiError 后端不可用或被守卫拒绝时。
 */
export async function listSkills(
  options: { force?: boolean } = {},
): Promise<SkillSummary[]> {
  const fresh = listCache && Date.now() - listCache.at < SKILLS_LIST_CACHE_MS;
  if (!options.force && fresh && listCache) return listCache.skills;
  if (!options.force && listInFlight) return listInFlight;
  const pending = fetchSkillList().then(skills => {
    // 请求期间被 invalidate 过（listInFlight 已被清空）则不写回过期结果。
    if (listInFlight === pending) listCache = { at: Date.now(), skills };
    return skills;
  }).finally(() => {
    if (listInFlight === pending) listInFlight = null;
  });
  listInFlight = pending;
  return pending;
}

export async function getSkill(id: string): Promise<SkillDetail> {
  const envelope = await http.get<Envelope<SkillDetail>>(
    `${BASE}/${encodeURIComponent(id)}`);
  return unwrap(envelope);
}

export async function createSkill(markdown: string): Promise<SkillDetail> {
  const envelope = await http.post<Envelope<SkillDetail>>(BASE, { markdown });
  invalidateSkillsCache();
  return unwrap(envelope);
}

export async function updateSkill(
  id: string,
  markdown: string,
): Promise<SkillDetail> {
  const envelope = await http.put<Envelope<SkillDetail>>(
    `${BASE}/${encodeURIComponent(id)}`, { markdown });
  invalidateSkillsCache();
  return unwrap(envelope);
}

export async function deleteSkill(id: string): Promise<DeleteSkillResult> {
  const envelope = await http.del<Envelope<DeleteSkillResult>>(
    `${BASE}/${encodeURIComponent(id)}`);
  invalidateSkillsCache();
  return unwrap(envelope);
}

export async function setSkillEnabled(
  id: string,
  enabled: boolean,
): Promise<EnableSkillResult> {
  const envelope = await http.post<Envelope<EnableSkillResult>>(
    `${BASE}/${encodeURIComponent(id)}/enabled`, { enabled });
  invalidateSkillsCache();
  return unwrap(envelope);
}

/** 把任意技能（含内置）复制为用户技能，便于改一份副本。 */
export async function duplicateSkill(
  id: string,
  newId: string,
): Promise<SkillDetail> {
  const envelope = await http.post<Envelope<SkillDetail>>(
    `${BASE}/${encodeURIComponent(id)}/duplicate`, { new_id: newId });
  invalidateSkillsCache();
  return unwrap(envelope);
}

/**
 * 干跑校验，不落盘。
 *
 * 内容不合格（422/413）返回 `{ valid: false, error_code, message }`；
 * 传输层或守卫失败（网络、403、5xx）照常抛 `ApiError`。
 */
export async function validateSkill(markdown: string): Promise<ValidateResult> {
  try {
    const envelope = await http.post<
      Envelope<SkillValidationPreview & { valid: true }>>(
      `${BASE}/validate`, { markdown });
    return { ...unwrap(envelope), valid: true };
  } catch (error) {
    if (error instanceof ApiError && VALIDATION_STATUSES.has(error.status)) {
      return { valid: false, error_code: error.code, message: error.message };
    }
    throw error;
  }
}
