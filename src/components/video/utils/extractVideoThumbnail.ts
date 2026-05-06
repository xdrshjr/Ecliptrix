function proxiedVideoUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    if (parsed.origin !== window.location.origin) {
      return `/api/video-proxy?url=${encodeURIComponent(url)}`
    }
  } catch {}
  return url
}

/**
 * Extract a thumbnail frame from a video URL using an offscreen canvas.
 * Automatically routes cross-origin URLs through the server-side proxy.
 * Returns a JPEG data URL or null on failure.
 */
export async function extractVideoThumbnail(videoUrl: string): Promise<string | null> {
  const src = proxiedVideoUrl(videoUrl)
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;

    let resolved = false;
    const finish = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    // Register onseeked INSIDE onloadedmetadata so it only fires for our explicit seek
    video.onloadedmetadata = () => {
      const targetTime = video.duration > 2 ? 1 : 0;
      video.onseeked = () => {
        video.onseeked = null;
        try {
          if (!video.videoWidth || !video.videoHeight) {
            finish(null);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = Math.round(320 * video.videoHeight / video.videoWidth) || 180;
          const ctx = canvas.getContext('2d');
          if (!ctx) { finish(null); return; }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.8));
        } catch {
          finish(null);
        }
      };
      video.currentTime = targetTime;
    };

    video.onerror = () => finish(null);
    // Fallback: if seek event doesn't fire within 10s, give up
    setTimeout(() => finish(null), 10000);

    video.src = src;
  });
}

/**
 * Extract a frame at an arbitrary timestamp at full (or capped) resolution.
 *
 * Reuses the same cross-origin proxy pipeline as ``extractVideoThumbnail``,
 * but seeks to a caller-specified time and skips the 320 px width cap so the
 * result is suitable for cover-rendering at 1080p+. ``extractVideoThumbnail``
 * is preserved unchanged for existing callers.
 *
 * @param videoUrl  Source URL (any origin — cross-origin is auto-proxied)
 * @param timeSec   Target time in seconds (clamped to [0, duration])
 * @param opts.maxWidth  Optional cap on the output width (defaults to native)
 * @param opts.quality   JPEG quality (0..1, default 0.92)
 * @returns JPEG dataURL or ``null`` on failure
 */
export async function extractVideoFrameAt(
  videoUrl: string,
  timeSec: number,
  opts?: { maxWidth?: number; quality?: number },
): Promise<string | null> {
  const src = proxiedVideoUrl(videoUrl);
  const quality = opts?.quality ?? 0.92;
  const maxWidth = opts?.maxWidth;

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;

    let resolved = false;
    const finish = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = Math.max(0, Math.min(timeSec, Math.max(0, duration - 0.001)));
      video.onseeked = () => {
        video.onseeked = null;
        try {
          if (!video.videoWidth || !video.videoHeight) {
            finish(null);
            return;
          }
          const nativeW = video.videoWidth;
          const nativeH = video.videoHeight;
          const targetW = maxWidth && maxWidth > 0 && maxWidth < nativeW ? maxWidth : nativeW;
          const targetH = Math.round((targetW * nativeH) / nativeW);
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            finish(null);
            return;
          }
          ctx.drawImage(video, 0, 0, targetW, targetH);
          finish(canvas.toDataURL('image/jpeg', quality));
        } catch {
          finish(null);
        }
      };
      video.currentTime = target;
    };

    video.onerror = () => finish(null);
    setTimeout(() => finish(null), 15000);

    video.src = src;
  });
}

/**
 * Extract a frame from near the end of a video.
 * Automatically routes cross-origin URLs through the server-side proxy.
 * @param videoUrl The video URL to extract from
 * @param offsetFromEnd Seconds before the end to seek to (default 3)
 * @returns JPEG data URL of the extracted frame, or null on failure
 */
export async function extractFrameFromEnd(
  videoUrl: string,
  offsetFromEnd: number = 3,
): Promise<string | null> {
  const src = proxiedVideoUrl(videoUrl)
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;

    let resolved = false;
    const finish = (value: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    video.onloadedmetadata = () => {
      const targetTime = Math.max(0, video.duration - offsetFromEnd);
      video.onseeked = () => {
        video.onseeked = null;
        try {
          if (!video.videoWidth || !video.videoHeight) {
            finish(null);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) { finish(null); return; }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.92));
        } catch {
          finish(null);
        }
      };
      video.currentTime = targetTime;
    };

    video.onerror = () => finish(null);
    setTimeout(() => finish(null), 15000);

    video.src = src;
  });
}
