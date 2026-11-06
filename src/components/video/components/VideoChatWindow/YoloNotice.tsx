'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import styles from './AgentComposer.module.css';

export const YOLO_NOTICE_STORAGE_KEY = 'ecliptrix:yolo-notice-v1';
export const YOLO_NOTICE_VISIBLE_MS = 8_000;

/** 编辑器拥有预算，切换会话不会重新开始首次说明的计时。 */
export interface YoloNoticeState {
  remainingMs: number;
  dismissed: boolean;
}

export interface YoloNoticeProps {
  yolo: boolean;
  enabled?: boolean;
  isVisible?: boolean;
  suppressed?: boolean;
  availableHeight?: number;
  notice?: YoloNoticeState;
  onRestoreFocus?: () => void;
}

function hasSeenNotice(): boolean {
  try {
    return window.localStorage.getItem(YOLO_NOTICE_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

function markSeen(): void {
  try { window.localStorage.setItem(YOLO_NOTICE_STORAGE_KEY, '1'); }
  catch { /* 已读标记不可写时，仍保留本项目内存标记。 */ }
}

/** 非模态说明；仅实际可读且未被操作时消耗八秒预算。 */
const YoloNotice: React.FC<YoloNoticeProps> = ({
  yolo, enabled = true, isVisible = true, suppressed = false,
  availableHeight = Number.POSITIVE_INFINITY, notice, onRestoreFocus,
}) => {
  const { t } = useLocale();
  const localNotice = useRef<YoloNoticeState>({
    remainingMs: YOLO_NOTICE_VISIBLE_MS, dismissed: false,
  });
  const budget = notice ?? localNotice.current;
  const root = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(isVisible);
  visibleRef.current = isVisible;
  const [seen, setSeen] = useState(true);
  const [dismissed, setDismissed] = useState(budget.dismissed);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    setSeen(hasSeenNotice());
    const sync = () => setPageVisible(document.visibilityState === 'visible');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const dismiss = useCallback(() => {
    const restore = root.current?.contains(document.activeElement);
    budget.dismissed = true;
    budget.remainingMs = 0;
    markSeen();
    setDismissed(true);
    if (restore && visibleRef.current) onRestoreFocus?.();
  }, [budget, onRestoreFocus]);

  const shown = yolo && enabled && isVisible && !suppressed && !seen
    && !dismissed && !budget.dismissed && availableHeight >= 50;
  useEffect(() => {
    if (!shown || !pageVisible || hovered || focused) return;
    const started = Date.now();
    const timer = setTimeout(dismiss, budget.remainingMs);
    return () => {
      clearTimeout(timer);
      budget.remainingMs = Math.max(0,
        budget.remainingMs - (Date.now() - started));
    };
  }, [shown, pageVisible, hovered, focused, budget, dismiss]);

  useEffect(() => {
    if (!shown) { setHovered(false); setFocused(false); }
  }, [shown]);

  if (!shown) return null;
  return (
    <div className={styles.noticeAnchor}>
      <div ref={root} data-testid="yolo-notice" role="status"
        aria-live="polite" className={styles.notice}
        style={{ maxHeight: Number.isFinite(availableHeight)
          ? availableHeight : undefined }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocused(false);
          }
        }}
        onKeyDown={event => {
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }}>
        <span className={styles.noticeIcon} aria-hidden="true">✦</span>
        <span className={styles.noticeText}>{t.videoChatWindow.yoloNotice}</span>
        <button type="button" onClick={dismiss}
          className={styles.noticeClose}
          aria-label={t.videoChatWindow.yoloNoticeDismiss}
          title={t.videoChatWindow.yoloNoticeDismiss}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
};

export default YoloNotice;
