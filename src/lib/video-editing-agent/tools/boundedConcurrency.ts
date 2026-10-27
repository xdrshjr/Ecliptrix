/**
 * 有界并发映射：批量采购与研究小队共用的极小信号量。
 *
 * 按下标顺序启动 worker（先来先服务），最多 `limit` 个同时在飞；`shouldStart`
 * 返回 false 时不再启动**尚未开始**的条目（已在飞的不受影响），这些条目的结果
 * 位置为 `undefined`，由调用方标记为 skipped。worker 的异常不会让其余条目停下：
 * 它被收进对应位置的 `{ error }`。
 */
export type SettledSlot<T> = { value: T } | { error: unknown } | undefined;

export async function mapWithConcurrency<I, T>(
  items: readonly I[],
  limit: number,
  worker: (item: I, index: number) => Promise<T>,
  shouldStart: (index: number) => boolean = () => true,
): Promise<Array<SettledSlot<T>>> {
  const results: Array<SettledSlot<T>> = new Array(items.length).fill(undefined);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let cursor = 0;
  const lane = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      if (!shouldStart(index)) continue;
      try { results[index] = { value: await worker(items[index], index) }; }
      catch (error) { results[index] = { error }; }
    }
  };
  await Promise.all(Array.from({ length: width }, lane));
  return results;
}
