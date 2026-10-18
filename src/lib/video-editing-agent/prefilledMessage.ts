/**
 * 卡片 → 聊天输入框的唯一耦合点。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §7.1（`suggested_tool` 只
 * 预填一条用户消息，**不直接执行**工具）。约定只有两条：一个 window 事件 +
 * 一个可选的数据属性；卡片不必认识聊天 store，聊天窗口也不必认识卡片。
 */

export const PREFILL_MESSAGE_EVENT = 'ecliptrix:prefill-message';

export interface PrefillMessageDetail {
  text: string;
}

/** React 受控组件只看原生 setter 之后的 input 事件，直接赋值会被吞掉。 */
function writeValue(
  el: HTMLInputElement | HTMLTextAreaElement, value: string,
): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 预填一条用户消息；空文本、服务端渲染时静默返回。 */
export function sendPrefilledMessage(text: string): void {
  if (typeof window === 'undefined') return;
  const value = text.trim();
  if (!value) return;
  window.dispatchEvent(new CustomEvent<PrefillMessageDetail>(
    PREFILL_MESSAGE_EVENT, { detail: { text: value } },
  ));
  const el = document.querySelector('[data-agent-input]');
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    writeValue(el, value);
  }
}
