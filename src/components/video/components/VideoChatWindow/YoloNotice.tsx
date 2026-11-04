'use client';

/**
 * YoloNotice — 首次开启 YOLO 时的一条行内说明
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.9.4 / AC-C5）。
 *
 * 为什么不是模态确认（D-10）：这是一个随时可逆、且不影响数据安全的模式开关，
 * 用 `ConfirmationDialog` 会制造"危险操作"的错误暗示，也打断"打开面板→立刻发
 * 任务"的连招。一句话 + 8 秒自动消失 + 可随时停止，才是这一档风险的正确成本。
 *
 * 已读标记写 `localStorage`（纯 UI 记忆，不是可信状态；权威值在
 * `system_settings`）。
 *
 * @module VideoChatWindow/YoloNotice
 */

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';

/** 已读标记：v1 后缀保证将来改文案时能重新播一次。 */
export const YOLO_NOTICE_STORAGE_KEY = 'ecliptrix:yolo-notice-v1';

/** 自动消失时间（毫秒）。 */
export const YOLO_NOTICE_VISIBLE_MS = 8_000;

function hasSeenNotice(): boolean {
  try {
    return window.localStorage.getItem(YOLO_NOTICE_STORAGE_KEY) === '1';
  } catch {
    // 隐私模式 / 存储被禁：当作已读，绝不因为一条提示而抛错。
    return true;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(YOLO_NOTICE_STORAGE_KEY, '1');
  } catch {
    // 同上：提示已读只是体验优化，失败不影响开关。
  }
}

export interface YoloNoticeProps {
  /** 只有在 YOLO 已开启时才有内容可展示。 */
  yolo: boolean;
}

const YoloNotice: React.FC<YoloNoticeProps> = ({ yolo }) => {
  const { t } = useLocale();
  const copy = t.videoChatWindow;
  const [dismissed, setDismissed] = useState(false);
  const [seen, setSeen] = useState(true);

  // localStorage 只在客户端可读，挂载后再判断，避免 SSR/首帧不一致。
  useEffect(() => { setSeen(hasSeenNotice()); }, []);

  useEffect(() => {
    if (!yolo || seen || dismissed) return undefined;
    // 自动消失同样要记「已读」：否则「首次开启」的说明会在每次开启时重播，
    // 与 AC-C5 的「只出现一次」相悖。
    const timer = setTimeout(() => {
      markSeen();
      setDismissed(true);
    }, YOLO_NOTICE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [yolo, seen, dismissed]);

  if (!yolo || seen || dismissed) return null;

  const dismiss = () => {
    markSeen();
    setDismissed(true);
  };

  return (
    <div
      data-testid="yolo-notice"
      role="status"
      aria-live="polite"
      className="flex-shrink-0 flex items-center justify-between h-[22px] px-3
        text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50
        dark:bg-amber-950/30 border-y border-amber-200 dark:border-amber-900"
    >
      <span className="truncate" title={copy.yoloNotice}>{copy.yoloNotice}</span>
      <button
        type="button"
        onClick={dismiss}
        className="ml-2 shrink-0 hover:underline focus:outline-none
          focus-visible:ring-1 focus-visible:ring-amber-500 rounded"
      >
        {copy.yoloNoticeDismiss}
      </button>
    </div>
  );
};

export default YoloNotice;
