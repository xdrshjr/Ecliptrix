'use client';

/**
 * YoloToggle — 全自动模式（YOLO）主开关
 * （docs/plans/agent-yolo-autonomous-mode spec.md §4.9.1 / §4.9.3）。
 *
 * 几何**逐像素复用**相邻的「Agent」开关（`h-5 w-9` / 旋钮 `h-3.5 w-3.5` /
 * `translate-x-[18px]/[3px]`），标签排版也复用相邻标签的类，只对 `YOLO` 补
 * 一点字距，让 4 个字母与 `Agent` 视觉等重（评审 P2-09）。琥珀色是「已武装的
 * 自主性」，不是错误红（D-09）。
 *
 * 五种状态缺一不可：可用-关 / 可用-开 / 禁用-非 Agent / 禁用-执行中 /
 * 禁用-尚未加载。禁用原因写在 `title` 与隐藏的 `aria-describedby` 里，不靠
 * 颜色单独表意。
 *
 * @module VideoChatWindow/YoloToggle
 */

import React, { useId } from 'react';
import { useLocale } from '@/contexts/LocaleContext';

export interface YoloToggleProps {
  /** 当前是否已武装（全局偏好，由 `useAgentYoloMode` 提供）。 */
  yolo: boolean;
  onYoloChange(next: boolean): void;
  /** 是否处于 Agent 模式；`false` 时开关禁用并解释原因。 */
  agentMode: boolean;
  /** 运行中禁用切换（本回合已快照，改了也只在下一回合生效）。 */
  agentIsExecuting: boolean;
  /** 首次读取持久化值是否已回；`false` 时禁用（评审 P2-02）。 */
  yoloReady: boolean;
}

const TRACK_BASE = 'relative inline-flex h-5 w-9 shrink-0 items-center '
  + 'rounded-full transition-colors motion-reduce:transition-none '
  + 'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 '
  + 'focus-visible:outline-amber-500';

const Toggle: React.FC<YoloToggleProps> = ({
  yolo, onYoloChange, agentMode, agentIsExecuting, yoloReady,
}) => {
  const { t } = useLocale();
  const copy = t.videoChatWindow;
  const disabled = !yoloReady || !agentMode || agentIsExecuting;
  const title = !yoloReady ? copy.yoloTitleLoading
    : !agentMode ? copy.yoloTitleNeedsAgent
      : agentIsExecuting ? copy.yoloTitleBusy
        : yolo ? copy.yoloTitleOn : copy.yoloTitleOff;
  const track = yolo
    ? 'bg-amber-500 border border-amber-600/70 shadow-[0_0_0_3px_rgba(245,158,11,0.12)]'
    : 'bg-border dark:bg-zinc-600';
  const label = yolo
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-muted-foreground dark:text-zinc-400';
  // 面板可能同时存在两份实例（停靠 + 浮动），id 必须唯一，否则
  // aria-describedby 会指向另一份实例的隐藏文本。
  const descriptionId = `yolo-toggle-description-${useId()}`;

  return (
    <div className={`flex items-center gap-2 ${disabled ? 'opacity-60' : ''}`}>
      <span className={`text-xs font-medium tracking-[0.06em] ${label}`}>
        {copy.yoloToggleLabel}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={yolo}
        aria-label={`${copy.yoloToggleLabel} — ${title}`}
        aria-describedby={descriptionId}
        aria-busy={!yoloReady || undefined}
        title={title}
        disabled={disabled}
        onClick={() => onYoloChange(!yolo)}
        className={`${TRACK_BASE} ${track} disabled:cursor-not-allowed`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ${
            'transition-transform motion-reduce:transition-none'
          } ${yolo ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
        />
      </button>
      <span id={descriptionId} className="sr-only">{title}</span>
    </div>
  );
};

export default Toggle;
