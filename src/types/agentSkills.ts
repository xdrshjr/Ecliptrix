/**
 * Agent 技能库的前端类型。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.3.2 / §3.3.4。
 * 后端契约在 backend-services/basic-service/app/models/agent_skills_models.py，
 * 两边的错误码闭集必须同步修改（新增码即新增契约）。
 */

/** `AgentSkillsError.error_code` 闭集（含守卫层可能产生的 `json_required`）。 */
export const AGENT_SKILL_ERROR_CODES = [
  'invalid_skill',
  'invalid_parameters',
  'skill_not_found',
  'skill_exists',
  'builtin_readonly',
  'skill_limit',
  'skill_too_large',
  'origin_forbidden',
  'invalid_call_id',
  'json_required',
  'internal_error',
] as const;

export type AgentSkillErrorCode = (typeof AGENT_SKILL_ERROR_CODES)[number];

/** 技能 `requires` 可声明的能力。 */
export const AGENT_SKILL_REQUIRES = [
  'web', 'browser', 'vision', 'documents', 'tts', 'crew',
] as const;

export type AgentSkillRequirement = (typeof AGENT_SKILL_REQUIRES)[number];

/** 技能 id：与目录名一致，见后端 `limits.SKILL_ID_PATTERN`。 */
export const SKILL_ID_PATTERN = /^[a-z][a-z0-9-]{2,39}$/;

/** 损坏技能的原因，来自解析器的 `AgentSkillsError`。 */
export interface SkillProblem {
  error_code: AgentSkillErrorCode;
  message: string;
}

/** `GET /api/agent-skills` 管理列表中的一项（含禁用、无效、被遮蔽）。 */
export interface SkillSummary {
  id: string;
  /** 无效技能没有解析出名称时回退为 id。 */
  name: string;
  /** 无效技能为空串。 */
  description: string;
  version: number;
  tools: string[];
  requires: string[];
  builtin: boolean;
  enabled: boolean;
  valid: boolean;
  /** 用户目录与内置同名：该条目不生效。 */
  shadowed: boolean;
  /** `valid === false` 时给出原因，否则为 null。 */
  problem: SkillProblem | null;
  body_chars: number;
  /** ISO8601，来自文件 mtime。 */
  updated_at: string;
}

/** `GET /api/agent-skills/{id}`：完整内容。 */
export interface SkillDetail extends SkillSummary {
  /** SKILL.md 原文（编辑器用）。 */
  markdown: string;
  /** 解析出的正文（不含 frontmatter）；无效技能为空串。 */
  body: string;
  body_bytes: number;
}

/** `GET /api/agent-skills/index`：L0 索引条目（仅启用且有效的技能）。 */
export interface SkillIndexEntry {
  id: string;
  name: string;
  description: string;
  requires: string[];
  builtin: boolean;
}

export interface SkillIndex {
  skills: SkillIndexEntry[];
  /** 超出 10 条被截断。 */
  truncated: boolean;
}

/** `POST /validate` 成功时的解析结果；不落盘。 */
export interface SkillValidationPreview {
  id: string;
  name: string;
  description: string;
  version: number;
  tools: string[];
  requires: string[];
  body: string;
  body_chars: number;
  body_bytes: number;
  warnings: string[];
}

/** 客户端 `validateSkill` 的语义化结果（服务端 4xx 被折叠为 `valid:false`）。 */
export type ValidateResult =
  | ({ valid: true } & SkillValidationPreview)
  | { valid: false; error_code: AgentSkillErrorCode | string; message: string };

export interface EnableSkillResult {
  id: string;
  enabled: boolean;
}

export interface DeleteSkillResult {
  id: string;
  deleted: true;
}
