/**
 * Heuristic only: shows a "may support images" badge on the vision row. It
 * never blocks saving — real usability is verified by the settings page's
 * "test connection" and by runtime errors.
 */
const VISION_MODEL_PATTERN = /(vl|vision|4o|gemini|claude|glm-4v|qwen.*vl)/i;

export function looksVisionCapable(modelName: string): boolean {
  return VISION_MODEL_PATTERN.test(modelName);
}

/** Split pasted search keys on whitespace / commas, de-duplicated. */
export function parseSearchKeys(raw: string): string[] {
  const keys = raw
    .split(/[\s,;，；]+/)
    .map((key) => key.trim())
    .filter(Boolean);
  return Array.from(new Set(keys));
}

/** The backend `search()` only uses the first 3 keys (RV-10: deliberate). */
export const MAX_SEARCH_KEYS = 3;

/** Template placeholders (`your_xxx_here`) must read as "not a real key". */
export function isPlaceholderKey(value: string): boolean {
  return /^your_.*_here$/i.test(value.trim());
}
