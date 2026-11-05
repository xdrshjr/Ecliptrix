/**
 * 音色 ID 的唯一来源。
 *
 * 背景（docs/diagnoses/agent-tts-ignores-project-default-voice/analysis.md
 * §8.6 / §9.1 方案 A′）：界面「全片默认音色」的缺省值写死在
 * `ScriptPanel.tsx`，两个 Agent TTS 工具又各自硬编码「清新女声」，提示词
 * 把它们当成事实告诉模型 —— 三份互不引用的默认值，用户改了设置也不生效。
 * 现在缺省值、优先级解析、请求体白名单校验全部收在这一个模块里，任何新
 * 代码都必须从这里引用，不再复制字面量。
 *
 * 注意：后端也各带一份互相矛盾的默认值（`tts_models.py` 为 male、
 * `tts_service.py:72` 为 female），而 `/api/tts/convert` 是纯透传路由，所以
 * 工具**始终显式传值**，后端默认只在请求缺字段时才会生效。
 */

/** 界面「全片默认音色」与 Agent 工具共用的缺省音色（少年梓辛 2.0）。 */
export const FALLBACK_TTS_VOICE_ID = 'zh_male_shaonianzixin_uranus_bigtts';

/** 空白字符串（含纯空格）等于「没指定」——后端会以 `tts_voice_empty` 422 拒绝空音色。 */
function normalizedVoiceId(value: string | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

/**
 * 解析一次 TTS 调用真正使用的音色。
 *
 * 优先级：**用户在对话里显式指定 > 工程「全片默认音色」> 缺省音色**。
 *
 * @param requested 本次调用的 `voice_type`（模型显式传入，可能为空/空白）
 * @param projectDefault 工程「全片默认音色」快照（`content.defaultVoiceId`）
 * @returns 永不为空串的可用音色 ID
 */
export function resolveVoiceType(
  requested?: string,
  projectDefault?: string,
): string {
  return normalizedVoiceId(requested)
    ?? normalizedVoiceId(projectDefault)
    ?? FALLBACK_TTS_VOICE_ID;
}

/**
 * 音色 ID 白名单：现状三张音色表（后端 `config/batch_tts_config.yaml` 102 条）
 * 的字符集只有 `[0-9a-z_]`，最长 39 字符；这里留出 `.-` 与 96 字符的余量，
 * 以免将来合法 id 被静默丢弃（analysis §8.2 E-6）。
 */
const VOICE_ID_PATTERN = /^[A-Za-z0-9_.-]{1,96}$/;

/**
 * 校验请求体带来的 `defaultVoiceId`。
 *
 * 非法值一律降级为 `undefined`（后续走工程默认/缺省音色），不返回 400：
 * 一个脏字段不值得让整轮对话失败（analysis §8.6）。命中非法值时告警一次，
 * 免得「用户设了新音色却没生效」再次变成不可排查的问题（§8.7 Q-4）。
 *
 * @param value 请求体里的原始值，类型未知
 */
export function readVoiceId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!VOICE_ID_PATTERN.test(trimmed)) {
    console.warn(
      `[VideoEditingAgent] 丢弃非法 defaultVoiceId: ${trimmed.slice(0, 32)} (len=${trimmed.length})`,
    );
    return undefined;
  }
  return trimmed;
}
