/**
 * YOLO 全自动模式的**唯一真相**（docs/plans/agent-yolo-autonomous-mode
 * spec.md §4.2 / §7.2 / D-14 / 评审 P1-3）。
 *
 * 为什么是模块级 store 而不是每个组件各持一份 `useState + GET`：剪辑台工具栏
 * 与设置中心「自动化与交互」写的是同一个键 `agent_toolkit.yolo_mode`，两个
 * hook 实例之间若没有任何通道，"改一边另一边立刻同步"在物理上不可能成立，
 * 用户会看到"设置里开了、面板里是关的"。
 *
 * 生命周期：Electron 单进程单用户、本项目无登录，store 与页面同寿。
 */

import { getCategorySettings, updateCategorySettings } from '@/lib/api/systemSettings';

/** 后端类别与键名（与 `agent-toolkit-config.yaml` 一一对应）。 */
export const YOLO_CATEGORY = 'agent_toolkit';
export const YOLO_SETTING_KEY = 'yolo_mode';

/** 任何成功写入后广播，供非 React 消费者（或将来其它入口）订阅。 */
export const YOLO_MODE_UPDATED_EVENT = 'ecliptrix-yolo-mode-updated';

export interface YoloModeSnapshot {
  /** 当前生效值（乐观更新，失败回滚）。 */
  enabled: boolean;
  /** 首次 GET 是否已回；`false` 时开关禁用（评审 P2-02）。 */
  ready: boolean;
  /** 写入中（防连点；不做 spinner，仅禁用）。 */
  saving: boolean;
}

const INITIAL: YoloModeSnapshot = { enabled: false, ready: false, saving: false };

let snapshot: YoloModeSnapshot = INITIAL;
const listeners = new Set<() => void>();
/** `loadYoloModeOnce` 的幂等句柄：并发调用只发一次 GET。 */
let inflight: Promise<void> | null = null;

function publish(next: YoloModeSnapshot): void {
  snapshot = next;
  listeners.forEach(listener => listener());
}

function broadcast(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(YOLO_MODE_UPDATED_EVENT));
}

/** 当前快照。`useSyncExternalStore` 要求同一状态返回同一引用。 */
export function getYoloModeSnapshot(): YoloModeSnapshot {
  return snapshot;
}

export function subscribeYoloMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 只用于测试：把 store 复位到"尚未加载"。 */
export function resetYoloModeForTest(): void {
  inflight = null;
  snapshot = INITIAL;
  listeners.forEach(listener => listener());
}

/**
 * 首次读取持久化值。幂等：并发调用只发一次 GET。
 *
 * 读取失败（后端未起、路由 500）→ `enabled=false, ready=true`，不弹错误：
 * 开关可用性与聊天可用性解耦，读不到就等于没开（失败即旧行为）。
 */
export function loadYoloModeOnce(): Promise<void> {
  if (snapshot.ready) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const result = await getCategorySettings(YOLO_CATEGORY);
      const entry = Array.isArray(result.settings)
        ? result.settings.find(item => item.key === YOLO_SETTING_KEY)
        : undefined;
      publish({ enabled: entry?.value === true, ready: true, saving: false });
    } catch {
      publish({ enabled: false, ready: true, saving: false });
    }
  })();
  return inflight;
}

/**
 * 写入持久化值：乐观更新 → PUT → 成功广播 / 失败回滚后抛出。
 *
 * 抛出而不是吞掉：调用方（`useAgentYoloMode`）要用它决定是否弹通知。
 * `Boolean(next)` 是必需的——后端用 `StrictBool` 校验，`1/0` 会 422（§6.1）。
 */
export async function setYoloMode(next: boolean): Promise<void> {
  const value = Boolean(next);
  const previous = snapshot;
  publish({ ...snapshot, enabled: value, ready: true, saving: true });
  try {
    const result = await updateCategorySettings(YOLO_CATEGORY, {
      [YOLO_SETTING_KEY]: value,
    });
    if (!result.success) throw new Error('yolo_mode_save_failed');
    publish({ ...snapshot, enabled: value, ready: true, saving: false });
    broadcast();
  } catch (error) {
    publish(previous);
    throw error;
  }
}
