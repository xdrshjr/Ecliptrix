/**
 * Wire-format (snake_case) integration payloads for tests. The shapes follow
 * `GET /api/integrations` (spec §5.1) and are built from the shared contract
 * fixture so a registry change shows up here too.
 */
import schema from '@/lib/api/__fixtures__/integrations-schema.json';

type Overrides = Record<string, Partial<WireField>>;

export interface WireField {
  name: string;
  kind: string;
  required: boolean;
  configured: boolean;
  source: string;
  value?: string;
  choices?: string[];
  count?: number;
  max_items?: number;
}

export interface WireIntegration {
  id: string;
  capabilities: string[];
  verify_level: string;
  usable: boolean;
  source: string;
  fields: WireField[];
}

const DEFAULT_CHOICE: Record<string, string> = {
  'volcano_tts.resource_id': 'seed-tts-2.0',
  'volcano_asr.resource_id': 'volc.bigasr.sauc.duration',
  'volcano_voice_clone.tts_resource_id': 'seed-icl-1.0',
};

/** One integration as the backend would return it; everything unconfigured unless overridden. */
export function wireIntegration(
  id: string,
  options: { usable?: boolean; source?: string; fields?: Overrides } = {},
): WireIntegration {
  const spec = schema.integrations.find((item) => item.id === id);
  if (!spec) throw new Error(`unknown integration ${id}`);
  const fields = spec.fields.map((field) => {
    const base: WireField = {
      name: field.name,
      kind: field.kind,
      required: field.required,
      configured: field.kind === 'choice',
      source: field.kind === 'choice' ? 'default' : 'none',
    };
    if (field.kind === 'choice') {
      base.value = DEFAULT_CHOICE[`${id}.${field.name}`];
      base.choices = (field as { choices?: string[] }).choices;
    }
    if (field.kind === 'secret_list') {
      base.count = 0;
      base.max_items = (field as { maxItems?: number }).maxItems ?? 5;
    }
    return { ...base, ...(options.fields?.[field.name] ?? {}) };
  });
  return {
    id,
    capabilities: [...spec.capabilities],
    verify_level: spec.verifyLevel,
    usable: options.usable ?? false,
    source: options.source ?? 'none',
    fields,
  };
}

/** Wrap a list the way the endpoint does. */
export function listBody(items: WireIntegration[], loadFailed = false) {
  return { success: true, data: { integrations: items, load_failed: loadFailed } };
}

/** Every integration unconfigured (a clean, redacted install). */
export function cleanInstall(): WireIntegration[] {
  return schema.integrations.map((item) => wireIntegration(item.id));
}
