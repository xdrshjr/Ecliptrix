import type { AgentTimelineOperation } from '@/types';

/**
 * Visual feedback for a timeline operation the agent just applied: the
 * affected clip element gets a short-lived CSS animation class.
 */

const ANIMATION_CLASS: Record<AgentTimelineOperation['type'], string> = {
  add_clip: 'agent-clip-added',
  trim_clip: 'agent-clip-trimmed',
  delete_clip: 'agent-clip-deleting',
  move_clip: 'agent-clip-moving',
  resize_clip: 'agent-clip-resized',
  // 字幕一次落一批条目：逐条闪一下没有信息量，反而会盖住刚写上去的文字。
  add_subtitle_clips: '',
  // 只改属性、不改位置：没有可闪的几何变化，预览本身就会刷新。
  update_clip_effects: '',
};
const ANIMATION_MS = 700;

function targetClipId(operation: AgentTimelineOperation): string {
  switch (operation.type) {
    case 'add_clip':
      return operation.clip.id;
    case 'add_subtitle_clips':
      return '';
    default:
      return operation.clipId;
  }
}

export function triggerClipAnimation(operation: AgentTimelineOperation): void {
  const clipId = targetClipId(operation);
  const animationClass = ANIMATION_CLASS[operation.type];
  if (!clipId || !animationClass) return;
  requestAnimationFrame(() => {
    const element = document.querySelector(`[data-clip-id="${clipId}"]`);
    if (!element) return;
    element.classList.add(animationClass);
    setTimeout(() => element.classList.remove(animationClass), ANIMATION_MS);
  });
}
