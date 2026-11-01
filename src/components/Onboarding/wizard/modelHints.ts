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

/**
 * Whole-string placeholder shapes, mirrored 1:1 from the backend
 * `app/services/secret_values.py` (shared sample table:
 * `src/lib/api/__fixtures__/placeholder-samples.json`). Deliberately narrow:
 * `sk-test-…` and keys that merely contain "example" are real-looking keys.
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^your_.*_here$/i,
  /^your_[a-z0-9_]*$/i,
  /^x+$/i,
  /^<.+>$/,
  /^(change|replace)[_-]?me$/i,
  /^(test|example|dummy|fake|sample|placeholder|todo|none|null)$/i,
  /^0+$/,
];

/** Template placeholders (`your_xxx_here`) must read as "not a real key". */
export function isPlaceholderKey(value: string): boolean {
  const stripped = value.trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(stripped));
}
