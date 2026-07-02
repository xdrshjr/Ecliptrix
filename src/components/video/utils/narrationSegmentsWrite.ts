import type { ScriptSegment } from '@/types';
import type { NarrationCompleteMode } from '../types/videoEditingTypes';
import { isPlaceholderScript } from '../data';

/**
 * 「解说直接生成」写入外部脚本面板时，按用户意图（追加 / 替换）解析出最终要写入
 * `content.scriptSegments` 的 segment 数组。作为「追加 / 替换」判定的唯一实现锚点，
 * 供 `VideoEditingInterface.handleWriteNarrationSegments` 调用（spec §5 / §9.1）。
 *
 * 规则：
 * - `mode === 'replace'`：无条件用本次生成的 `segments` 全量覆盖，丢弃 `existing`。
 * - `mode === 'append'`：追加到已有真实解说之后（`[...existing, ...segments]`）；但当
 *   `existing` 为空或仍是系统示意占位脚本时，只写 `segments`，避免遗留占位脏卡片（占位守卫）。
 *
 * @param existing 面板当前的 segments（`scriptSegmentsRef.current ?? []`）。
 * @param segments 本次生成的逐句新解说 segments。
 * @param mode 用户在弹窗第 2 步选择的写入模式。
 * @returns 应写入面板的最终 segment 数组。
 */
export function resolveNarrationSegmentsWrite(
  existing: ScriptSegment[],
  segments: ScriptSegment[],
  mode: NarrationCompleteMode,
): ScriptSegment[] {
  const isEmptyOrPlaceholder = existing.length === 0 || isPlaceholderScript(existing);
  if (mode === 'replace' || isEmptyOrPlaceholder) {
    return segments;
  }
  return [...existing, ...segments];
}
