/**
 * Aspect-ratio config for the video player preview.
 *
 * Extracted from VideoPlayerPanel (D10 split, S4). Pure data + helpers — no
 * React, no DOM — so it is independently unit-testable.
 */

export interface AspectRatio {
  id: string;
  label: string;
  ratio: string;
  description: string;
  cssClass: string;
}

/** The translation slice the labels/descriptions read. */
interface AspectRatioLabels {
  landscapeStandard: string;
  portraitMobile: string;
  traditionalScreen: string;
  square: string;
  ultrawide: string;
}

/**
 * Build the aspect-ratio options for the preview. Descriptions come from the
 * caller's i18n slice so the data stays presentation-locale-aware while the
 * shape/order/css stays here.
 */
export function buildAspectRatios(labels: AspectRatioLabels): AspectRatio[] {
  return [
    { id: '16:9', label: '16:9', ratio: '16/9', description: labels.landscapeStandard, cssClass: 'aspect-video' },
    { id: '9:16', label: '9:16', ratio: '9/16', description: labels.portraitMobile, cssClass: 'aspect-[9/16]' },
    { id: '4:3', label: '4:3', ratio: '4/3', description: labels.traditionalScreen, cssClass: 'aspect-[4/3]' },
    { id: '1:1', label: '1:1', ratio: '1/1', description: labels.square, cssClass: 'aspect-square' },
    { id: '21:9', label: '21:9', ratio: '21/9', description: labels.ultrawide, cssClass: 'aspect-[21/9]' },
  ];
}

/**
 * Convert a `'w/h'` ratio string to a numeric aspect ratio, or `undefined` when
 * the string is malformed / non-positive (used for the compositor letterbox).
 */
export function aspectRatioToNumber(ratio: string): number | undefined {
  const [w, h] = ratio.split('/').map(Number);
  return w > 0 && h > 0 ? w / h : undefined;
}
