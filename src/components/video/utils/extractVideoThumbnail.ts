/**
 * Extract a thumbnail frame from a video URL using an offscreen canvas.
 * Works with CDN URLs that support CORS. Returns a JPEG data URL or null on failure.
 */
export async function extractVideoThumbnail(videoUrl: string): Promise<string | null> {
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

    // Register onseeked INSIDE onloadedmetadata so it only fires for our explicit seek,
    // not for any browser-initiated initial seek at t=0 (which would capture a blank frame).
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

    video.src = videoUrl;
  });
}

/**
 * Extract a frame from near the end of a video.
 * @param videoUrl The video URL to extract from
 * @param offsetFromEnd Seconds before the end to seek to (default 3)
 * @returns JPEG data URL of the extracted frame, or null on failure
 */
export async function extractFrameFromEnd(
  videoUrl: string,
  offsetFromEnd: number = 3,
): Promise<string | null> {
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

    video.src = videoUrl;
  });
}
