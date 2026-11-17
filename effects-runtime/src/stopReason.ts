/** The first stop cause remains authoritative across asynchronous cleanup. */
export type StopReason = 'user_cancel' | 'deadline' | 'parent_lost';

export interface StopRecord {
  reason: StopReason;
  at: number;
}

const STOP_ERRORS: Record<StopReason, string> = {
  user_cancel: 'EFFECT_CANCELLED',
  deadline: 'EFFECT_RENDER_TIMEOUT',
  parent_lost: 'EFFECT_RENDER_INTERRUPTED',
};

const CHILD_ERRORS = new Set([
  ...Object.values(STOP_ERRORS), 'EFFECT_DISK_FULL',
  'EFFECT_INPUT_NOT_LOCAL', 'EFFECT_MEDIA_DECODE_FAILED',
  'EFFECT_TEXT_OVERFLOW', 'EFFECT_FONT_LOAD_FAILED', 'EFFECT_RUNTIME_UNAVAILABLE',
]);

/** Record one cause exactly once; later races cannot replace it. */
export function latchStopReason(
  current: StopRecord | undefined, reason: StopReason, at = Date.now(),
): StopRecord {
  return current ?? { reason, at };
}

/** Map only the fixed internal stop vocabulary into public error codes. */
export function getStopErrorCode(stop: StopRecord): string {
  return STOP_ERRORS[stop.reason];
}

/** Child messages must not expose arbitrary strings from media failures. */
export function normalizeChildErrorCode(value: unknown): string {
  return typeof value === 'string' && CHILD_ERRORS.has(value)
    ? value : 'EFFECT_MEDIA_DECODE_FAILED';
}
