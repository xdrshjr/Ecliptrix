import type { CoverAspectRatio, CoverDocument } from '@/types/videoCover';
export interface CoverBox { x: number; y: number; width: number; height: number }
const SIZES: Record<CoverAspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 }, '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 }, '4:3': { width: 1440, height: 1080 },
  '21:9': { width: 2560, height: 1080 },
};
export const coverSize = (ratio: CoverAspectRatio) => SIZES[ratio];
export function templateLayout(document: CoverDocument) {
  const portrait = document.aspectRatio === '9:16';
  const square = document.aspectRatio === '1:1';
  const tall = portrait || square;
  const layouts: Record<string, number[]> = {
    editorial: tall ? [0.08, 0.12, 0.84, 0.30] : [0.07, 0.24, 0.50, 0.48],
    cinematic: tall ? [0.08, 0.62, 0.84, 0.21] : [0.07, 0.60, 0.80, 0.25],
    knowledge: tall ? [0.08, 0.12, 0.84, 0.30] : [0.07, 0.24, 0.50, 0.40],
    // Keep the top label (ending at 0.115h) clear of the product title.
    product: tall ? [0.08, 0.14, 0.84, 0.25] : [0.12, 0.14, 0.76, 0.23],
    bold: tall ? [0.08, 0.18, 0.84, 0.52] : [0.08, 0.18, 0.78, 0.55],
  };
  const [x, rawY, rawWidth, height] = layouts[document.templateId];
  const y = square && document.templateId !== 'cinematic' &&
    document.templateId !== 'product' ? 0.12 : rawY;
  const width = document.aspectRatio === '21:9' ? Math.min(rawWidth, 0.55) : rawWidth;
  return {
    title: { x, y, width, height },
    subtitle: { x, y: y + height + 0.025, width,
      height: Math.min(0.15, 0.94 - y - height - 0.025) },
    label: { x: 0.07, y: 0.065, width: 0.65, height: 0.05 },
  };
}

/** Real DOM measurement preserves every code point; overflow blocks publishing. */
export function fitCoverText(element: HTMLElement, options: {
  initial: number; minimum: number; maxLines: number;
}): boolean {
  const minimum = Math.floor(options.minimum);
  let size = Math.max(minimum, Math.floor(options.initial));
  while (size >= minimum) {
    element.style.fontSize = `${size}px`;
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    // Count rendered line positions: glyph bounds can exceed line-height and
    // the preview is scaled, so dividing its bounding height gives false overflow.
    const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
    const lines = new Set(rects.filter(rect => rect.width > 0).map(rect => Math.round(rect.top * 10)));
    const fits = element.scrollWidth <= element.clientWidth + 1 &&
      element.scrollHeight <= element.clientHeight + 1 &&
      lines.size <= options.maxLines;
    if (fits) { element.dataset.overflow = 'false'; return true; }
    size -= 1;
  }
  element.dataset.overflow = 'true'; return false;
}
