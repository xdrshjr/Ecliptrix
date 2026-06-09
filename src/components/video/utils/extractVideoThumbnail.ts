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

/** Options shared by the arbitrary-timestamp frame extractors. */
export interface ExtractFrameOptions {
  /** Optional cap on the output width (defaults to native). */
  maxWidth?: number;
  /** JPEG quality (0..1, default 0.92). */
  quality?: number;
}

/**
 * Seek a hidden <video> to ``timeSec`` and hand the decoded frame to
 * ``onCanvas`` as a sized <canvas>. The single shared decode/seek core behind
 * both the data-URL and blob frame extractors (DRY — keeps the seek timeout,
 * cross-origin proxy and finish-once guard in one place).
 *
 * @param videoUrl  Source URL (any origin — cross-origin is auto-proxied)
 * @param timeSec   Target time in seconds (clamped to [0, duration])
 * @param maxWidth  Optional cap on the output width
 * @param onCanvas  Receives the drawn canvas; its return resolves the promise
 * @returns Whatever ``onCanvas`` resolves to, or ``null`` on any failure
 */
function withSeekedFrame<T>(
  videoUrl: string,
  timeSec: number,
  maxWidth: number | undefined,
  onCanvas: (canvas: HTMLCanvasElement) => T | Promise<T>,
): Promise<T | null> {
  const src = proxiedVideoUrl(videoUrl);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;

    let resolved = false;
    const finish = (value: T | null) => {
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
          Promise.resolve(onCanvas(canvas)).then(finish).catch(() => finish(null));
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
  opts?: ExtractFrameOptions,
): Promise<string | null> {
  const quality = opts?.quality ?? 0.92;
  return withSeekedFrame(videoUrl, timeSec, opts?.maxWidth, (canvas) =>
    canvas.toDataURL('image/jpeg', quality),
  );
}

/**
 * Blob-producing variant of {@link extractVideoFrameAt}.
 *
 * Filmstrip persistence (spec 03) needs to upload extracted frames as
 * multipart blobs rather than embed them as data URLs. This shares the exact
 * decode/seek core with the data-URL variant so the two cannot diverge.
 *
 * @param videoUrl  Source URL (direct-local same-origin preferred; cross-origin
 *                  legacy URLs are auto-proxied)
 * @param timeSec   Target time in seconds (clamped to [0, duration])
 * @param opts.maxWidth  Optional cap on the output width (defaults to native)
 * @param opts.quality   JPEG quality (0..1, default 0.7 — strips favour size)
 * @returns A JPEG Blob, or ``null`` on failure
 */
export async function extractVideoFrameBlobAt(
  videoUrl: string,
  timeSec: number,
  opts?: ExtractFrameOptions,
): Promise<Blob | null> {
  const quality = opts?.quality ?? 0.7;
  return withSeekedFrame(videoUrl, timeSec, opts?.maxWidth, (canvas) =>
    new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    }),
  );
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
