/**
 * 编辑器将句子的实际秒数映射到便于选用的时长档位。
 * 这些档位仅用于编辑器，接口范围由所选模型能力决定。
 *
 * 规则（向上取桶 + 边界裁剪）：
 *   NaN / ≤ 0      → 5
 *   (0, 5]         → 5
 *   (5, 7]         → 7
 *   (7, 10]        → 10
 *   (10, 12]       → 12
 *   > 12           → 12 （UI 层应额外提示用户拆分）
 */

export const ARK_DURATION_BUCKETS = [5, 7, 10, 12] as const;
export type ArkDurationBucket = typeof ARK_DURATION_BUCKETS[number];

export function mapSentenceDurationToArkBucket(seconds: number): ArkDurationBucket {
  if (!Number.isFinite(seconds) || seconds <= 0) return 5;
  if (seconds <= 5) return 5;
  if (seconds <= 7) return 7;
  if (seconds <= 10) return 10;
  return 12;
}

/**
 * 判断一个 duration 是否落在合法桶内；用于 AiVideoModal 接收 initialDuration 时校验。
 */
export function isArkDurationBucket(value: number): value is ArkDurationBucket {
  return (ARK_DURATION_BUCKETS as readonly number[]).includes(value);
}
