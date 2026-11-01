import {
  type FieldPatch,
  type IntegrationFieldStatus,
  type IntegrationSaveError,
  type IntegrationStatus,
} from '@/lib/api/integrations';
import {
  isPlaceholderKey,
  parseSearchKeys,
} from '@/components/Onboarding/wizard/modelHints';

/** Mirrors the registry's `max_items`; the server enforces the real limit. */
export const DEFAULT_MAX_LIST_ITEMS = 5;

/** Plain-text drafts keyed by field name (the secret_list one is raw textarea text). */
export type FieldDrafts = Record<string, string>;

export interface BuiltPatch {
  patch: FieldPatch;
  error: IntegrationSaveError | null;
}

function secretListMax(field: IntegrationFieldStatus): number {
  return field.maxItems ?? DEFAULT_MAX_LIST_ITEMS;
}

/** The value a field would send, `undefined` when the user did not touch it. */
function draftValue(
  field: IntegrationFieldStatus,
  raw: string | undefined,
): string | string[] | undefined {
  if (raw === undefined) return undefined;
  if (field.kind === 'choice') {
    return raw === field.value ? undefined : raw;
  }
  if (field.kind === 'secret_list') {
    const keys = parseSearchKeys(raw);
    return keys.length > 0 ? keys : undefined;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function placeholderIn(value: string | string[]): boolean {
  return Array.isArray(value) ? value.some(isPlaceholderKey) : isPlaceholderKey(value);
}

function validateField(
  field: IntegrationFieldStatus,
  value: string | string[],
): IntegrationSaveError | null {
  if (field.kind === 'choice') return null;
  if (placeholderIn(value)) return { kind: 'placeholder', field: field.name };
  if (Array.isArray(value) && value.length > secretListMax(field)) {
    return { kind: 'tooMany', field: field.name };
  }
  return null;
}

function missingRequired(
  integration: IntegrationStatus,
  patch: FieldPatch,
): IntegrationFieldStatus | undefined {
  return integration.fields.find(
    (field) => field.required && !field.configured && !(field.name in patch),
  );
}

/**
 * Turn the drafts into the PUT payload and catch what the server would reject
 * anyway (placeholders, too many keys, a still-missing required field), so the
 * user sees the mistake without a round trip. Untouched fields are omitted,
 * which the backend reads as "keep".
 */
export function buildPatch(
  integration: IntegrationStatus,
  drafts: FieldDrafts,
): BuiltPatch {
  const patch: FieldPatch = {};
  for (const field of integration.fields) {
    const value = draftValue(field, drafts[field.name]);
    if (value === undefined) continue;
    const error = validateField(field, value);
    if (error) return { patch, error };
    patch[field.name] = value;
  }
  const missing = missingRequired(integration, patch);
  if (missing && !integration.usable) {
    return { patch, error: { kind: 'required', field: missing.name } };
  }
  return { patch, error: null };
}

/** True when a secret / text / list field holds unsubmitted input. */
export function hasUnsubmittedInput(
  integration: IntegrationStatus,
  drafts: FieldDrafts,
): boolean {
  return integration.fields.some(
    (field) =>
      field.kind !== 'choice' && (drafts[field.name] ?? '').trim() !== '',
  );
}
