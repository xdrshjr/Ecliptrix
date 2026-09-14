/**
 * probeMediaDuration — read a media file's length from its metadata.
 *
 * Some materials reach the library without a duration (an ARK status response
 * may omit it). Placing such a clip used a fixed 5 s whose right edge could
 * never be dragged longer, since that 5 s also became its source length
 * (ME-11). A detached, metadata-only media element reads the real length.
 */

export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

/**
 * Resolve the duration of the media at `url`, or null when it cannot be read
 * (load error, timeout, unknown / infinite length, no DOM). The probe element
 * always releases its source afterwards.
 */
export function probeMediaDuration(
  url: string,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<number | null> {
  if (!url || typeof document === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const element = document.createElement('video');
    let settled = false;

    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.removeEventListener('loadedmetadata', handleLoaded);
      element.removeEventListener('error', handleError);
      element.removeAttribute('src');
      element.load();
      resolve(duration);
    };
    const handleLoaded = () => {
      const duration = element.duration;
      finish(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    const handleError = () => {
      console.warn('[probeMediaDuration] metadata could not be read', { url });
      finish(null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    element.preload = 'metadata';
    element.muted = true;
    element.addEventListener('loadedmetadata', handleLoaded);
    element.addEventListener('error', handleError);
    element.src = url;
  });
}
