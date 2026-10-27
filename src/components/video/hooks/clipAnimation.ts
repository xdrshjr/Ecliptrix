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
};
const ANIMATION_MS = 700;

function targetClipId(operation: AgentTimelineOperation): string {
  return operation.type === 'add_clip' ? operation.clip.id : operation.clipId;
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
