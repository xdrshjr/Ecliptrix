/**
 * subtitleGuard — 字幕工具的失败信封与熔断判据。
 *
 * 设计基线：docs/plans/agent-subtitles/spec.md §D-8 / P1-4 / §6.1。
 *
 * 与 `stillGuard` 同构：校验失败是**一步自纠**，不该把「用户连续两句字幕写错」
 * 升级成整轮中断（`agent.ts` 的 `MAX_CONSECUTIVE_TOOL_FAILURES = 5`）。
 *
 * 两条硬约束（P1-4）：
 *  1. 校验失败必须**正常返回**结果对象（`details.success === false`），禁止
 *     `throw`——抛异常时 `event.isError === true` 且 `details` 不再是对象，
 *     下面的 `isSubtitleGuardRejection` 就判不出来，豁免静默失效。
 *  2. `failure_class` 必须放在 `error_details.failure_class`：`agent.ts` 只读
 *     嵌套的那一份（与 `toolkitAdapter` 的错误信封同一形状）。
 */

/** §6.1 表格里的稳定错误码。 */
export const SUBTITLE_ERROR_CODES = [
  'subtitle_source_missing',
  'subtitle_source_ambiguous',
  'subtitle_source_too_large',
  'subtitle_too_many_cues',
  'subtitle_track_full',
  'subtitle_text_invalid',
  'subtitle_time_invalid',
  'subtitle_cues_overlap',
  'subtitle_conflicts_existing',
  'subtitle_style_invalid',
  'subtitle_aspect_invalid',
  'subtitle_parse_failed',
  'subtitle_workspace_too_large',
  'subtitle_track_locked',
  'subtitle_track_wrong_type',
  'subtitle_apply_refused',
] as const;

export type SubtitleErrorCode = (typeof SUBTITLE_ERROR_CODES)[number];

/**
 * 豁免熔断的错误码：都是「模型看一眼结果就能自己改对」的输入问题。
 *
 * `subtitle_apply_refused` **不在**名单里：它意味着本地副本与客户端对同一个
 * 操作给出不同判断（P0-2 要防的漂移），把它也豁免掉就等于让漂移无限重试，
 * 所以它照常计入连续失败次数。
 */
const BREAKER_EXEMPT: ReadonlySet<string> = new Set(
  SUBTITLE_ERROR_CODES.filter(code => code !== 'subtitle_apply_refused'),
);

/** 工具结果的形状（与 pi-agent-core 的 AgentToolResult 一致）。 */
export interface SubtitleGuardResult {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
}

/**
 * 构造一次校验失败的结果（**返回值**，不抛）。
 *
 * @param code    稳定错误码。字幕自己的码取 `SUBTITLE_ERROR_CODES`；工作区读取
 *                失败时原样透传 toolkit 的码（`workspace_not_found` /
 *                `invalid_offset`…），不新造第二套（§6.1 末段）。
 * @param extra   定位信息（第几条 cue、字符数、与哪条既有字幕重叠……）。
 * @param nextStep 给模型的下一步；缺省按错误码从 `NEXT_STEPS` 取。
 */
export function subtitleRejection(
  code: string,
  extra: Record<string, unknown> = {},
  nextStep?: string,
): SubtitleGuardResult {
  const details: Record<string, unknown> = {
    success: false,
    error_code: code,
    error: (extra.error as string | undefined) ?? code,
    next_step: nextStep
      ?? NEXT_STEPS[code as SubtitleErrorCode]
      ?? 'Report the limitation to the user; do not retry the same call.',
    error_details: { failure_class: 'validation' },
    ...extra,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(details) }],
    details,
  };
}

/** 每个错误码一句可执行的下一步；模型看到它才不会原地重试。 */
const NEXT_STEPS: Record<SubtitleErrorCode, string> = {
  subtitle_source_missing:
    'Give exactly one source: cues[], srt, or srt_workspace_path.',
  subtitle_source_ambiguous:
    'Keep only ONE of cues / srt / srt_workspace_path and call again.',
  subtitle_source_too_large:
    'Use srt_workspace_path (the tool pages it in) or send the cues in batches.',
  subtitle_too_many_cues:
    'Split the cues into calls of at most 120, or shorten the text.',
  subtitle_track_full:
    'Rewrite the track with mode:"replace", or delete_clip the old subtitles first.',
  subtitle_text_invalid:
    'Fix the text of the reported cue (non-empty, at most 200 characters).',
  subtitle_time_invalid:
    'Give startTime >= 0 and duration > 0 in seconds for the reported cue.',
  subtitle_cues_overlap:
    'Shorten or delay the cue so it starts after the previous one ends.',
  subtitle_conflicts_existing:
    'Move the cue, or rewrite the whole track with mode:"replace".',
  subtitle_style_invalid:
    'Use a valid style (fontSize 8..72, position enum, #RRGGBB colour) or omit style.',
  subtitle_aspect_invalid:
    'Omit aspect_ratio (defaults to 16:9) or use a supported value.',
  subtitle_parse_failed:
    'Fix the SRT text at the reported line, or send cues[] instead.',
  subtitle_workspace_too_large:
    'Send the cues[] in batches instead of a file larger than 64 KB.',
  subtitle_track_locked:
    'Ask the user to unlock the subtitle track, then call again.',
  subtitle_track_wrong_type:
    'Omit trackId so the tool picks (or creates) a subtitle track.',
  subtitle_apply_refused:
    'Fix the cause in reason and call again once; if it repeats, report it to the user '
    + 'instead of retrying the same call.',
};

/** True for a tool result detail produced by this guard (breaker exemption). */
export function isSubtitleGuardRejection(details: unknown): boolean {
  if (typeof details !== 'object' || details === null) return false;
  const code = (details as { error_code?: unknown }).error_code;
  return typeof code === 'string' && BREAKER_EXEMPT.has(code);
}
