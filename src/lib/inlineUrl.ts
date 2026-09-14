/**
 * inlineUrl — recognises media embedded in a URL string.
 *
 * `data:` URLs carry the whole file inline (a single uploaded thumbnail is
 * tens of kilobytes) and `blob:` URLs only resolve inside the page that
 * created them. Neither may travel into model context, tool results or saved
 * project data.
 */

const INLINE_MEDIA_URL = /^(data:|blob:)/i;

export function isInlineMediaUrl(value: unknown): value is string {
  return typeof value === 'string' && INLINE_MEDIA_URL.test(value);
}
