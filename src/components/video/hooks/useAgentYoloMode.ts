'use client';

/**
 * YOLO 开关的 hook 外壳（docs/plans/agent-yolo-autonomous-mode spec.md §7.2）。
 *
 * 它**不持状态**：状态在模块级 `autonomyStore`（唯一真相，评审 P1-3），本
 * hook 只负责「首次订阅时读一次」与「切换时的乐观写入 + 失败通知」。两个入口
 * （剪辑台工具栏、设置中心小节）各持一份实例，读到的是同一个快照。
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  getYoloModeSnapshot,
  loadYoloModeOnce,
  setYoloMode,
  subscribeYoloMode,
} from '@/lib/video-editing-agent/autonomyStore';

export interface UseAgentYoloModeArgs {
  /** 写入失败的用户可见提示（由宿主注入，便于复用既有 toast）。 */
  onSaveFailed?: () => void;
}

export interface UseAgentYoloModeReturn {
  /** 当前是否已武装（全局偏好）。 */
  yolo: boolean;
  /** 首次 GET 是否已回；`false` 时开关必须禁用（评审 P2-02）。 */
  yoloReady: boolean;
  /** 写入中：防连点。 */
  yoloSaving: boolean;
  /** 切换；失败时 store 已回滚，这里只负责提示。 */
  toggleYolo: (next: boolean) => Promise<void>;
}

export function useAgentYoloMode(
  args: UseAgentYoloModeArgs = {},
): UseAgentYoloModeReturn {
  const snapshot = useSyncExternalStore(
    subscribeYoloMode,
    getYoloModeSnapshot,
    getYoloModeSnapshot,
  );

  // 首屏与面板挂载同时发生：用户开始打字时早已 ready，感知成本为零。
  useEffect(() => { void loadYoloModeOnce(); }, []);

  const onSaveFailed = args.onSaveFailed;
  const toggleYolo = useCallback(async (next: boolean) => {
    try {
      await setYoloMode(next);
    } catch {
      // store 已回滚到原值；这里只补一条提示，不阻断聊天。
      onSaveFailed?.();
    }
  }, [onSaveFailed]);

  return {
    yolo: snapshot.enabled,
    yoloReady: snapshot.ready,
    yoloSaving: snapshot.saving,
    toggleYolo,
  };
}
