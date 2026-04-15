import { extractVideoThumbnail } from './extractVideoThumbnail';

export const PLACEHOLDER_VIDEO_THUMBNAIL = '/placeholder-video.svg';

/**
 * Resolve a non-empty thumbnail for a storyboard-generated video.
 *
 * Order: client-side extracted frame → caller-supplied fallback (e.g.
 * segment reference image) → static placeholder asset. Never returns empty.
 */
export async function resolveStoryboardThumbnail(
  videoUrl: string,
  fallbackImageUrl?: string,
): Promise<string> {
  try {
    const dataUrl = await extractVideoThumbnail(videoUrl);
    if (dataUrl) return dataUrl;
  } catch {
    // swallow — fall through to fallback/placeholder
  }
  if (fallbackImageUrl) return fallbackImageUrl;
  return PLACEHOLDER_VIDEO_THUMBNAIL;
}
