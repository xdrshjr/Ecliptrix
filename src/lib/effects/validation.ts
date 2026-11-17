import { z } from 'zod';
import type {
  EffectDocument, EffectParameterSchema, EffectRenderability,
} from '@/types/effects';
import { EffectError } from '@/types/effects';
import { getEffectTemplate } from './catalog';

const finite = z.number().finite();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const codePoints = (max: number) => z.string()
  .refine(value => Array.from(value).length <= max);
const input = z.object({
  slot: z.string(), assetId: z.uuid(), kind: z.enum(['image', 'video']),
  fit: z.enum(['cover', 'contain']),
  focalX: finite.min(0).max(1), focalY: finite.min(0).max(1),
  index: z.number().int().min(0).max(7).optional(),
  trimStartSeconds: finite.min(0).optional(),
}).strict();
const baseDocument = z.object({
  schemaVersion: z.literal(1), templateId: z.string(),
  templateVersion: z.number().int().positive(),
  canvas: z.object({ width: z.number().int().min(64).max(1920),
    height: z.number().int().min(64).max(1920), fps: z.literal(30),
  }).strict().refine(value => !(value.width % 2 || value.height % 2)),
  durationFrames: z.number().int().min(15).max(1800),
  seed: z.number().int().min(0).max(2147483647),
  content: z.object({ title: codePoints(120), subtitle: codePoints(300) })
    .strict(),
  palette: z.object({ background: color, foreground: color, accent: color })
    .strict(),
  typography: z.object({ family: z.enum(['sans', 'serif', 'mono']),
    scale: finite.min(0.6).max(1.4),
    align: z.enum(['left', 'center', 'right']) }).strict(),
  motion: z.object({ speed: finite.min(0.5).max(2),
    intensity: finite.min(0).max(1) }).strict(),
  params: z.record(z.string(), z.unknown()), inputs: z.array(input).max(9),
}).strict();

function parseParameter(schema: EffectParameterSchema): z.ZodType {
  if (schema.type === 'string') {
    const value = codePoints(schema.maxLength ?? 300);
    return schema.enum ? value.refine(item => schema.enum!.includes(item))
      : value;
  }
  if (schema.type === 'array') {
    return z.array(finite.min(schema.items!.minimum)
      .max(schema.items!.maximum)).min(schema.minItems!)
      .max(schema.maxItems!);
  }
  const value = finite.min(schema.minimum!).max(schema.maximum!);
  return schema.type === 'integer' ? value.int() : value;
}

/** Strict save validation; completeness is a separate, derived result. */
export function validateEffectDocument(value: unknown): EffectDocument {
  const document = baseDocument.parse(value);
  const template = getEffectTemplate(document.templateId);
  if (template.version !== document.templateVersion) {
    throw new EffectError('EFFECT_TEMPLATE_INCOMPATIBLE');
  }
  const fields = Object.fromEntries(Object.entries(template.parameterSchema)
    .map(([key, schema]) => [key, parseParameter(schema)]));
  z.object(fields).strict().parse(document.params);
  validateBindings(document as EffectDocument);
  return document as EffectDocument;
}

function validateBindings(document: EffectDocument): void {
  const template = getEffectTemplate(document.templateId);
  let videos = 0;
  for (const binding of document.inputs) {
    const slot = template.slots.find(item => item.id === binding.slot);
    if (!slot || !slot.kinds.includes(binding.kind)) {
      throw new EffectError('EFFECT_INVALID_ARGUMENT', 'inputs.slot');
    }
    if ((binding.slot === 'images') !== (binding.index !== undefined)
      || (binding.kind === 'image'
        && binding.trimStartSeconds !== undefined)
      || (binding.kind === 'video'
        && binding.trimStartSeconds === undefined)) {
      throw new EffectError('EFFECT_INVALID_ARGUMENT', 'inputs.binding');
    }
    if (binding.kind === 'video') videos++;
  }
  if (videos > 1 || document.inputs.length - videos > 8) {
    throw new EffectError('EFFECT_INVALID_ARGUMENT', 'inputs.count');
  }
  for (const slot of template.slots) {
    const bindings = document.inputs.filter(item => item.slot === slot.id);
    if (bindings.length > slot.max || (slot.id === 'images'
      && bindings.map(item => item.index).sort().some((n, i) => n !== i))) {
      throw new EffectError('EFFECT_INVALID_ARGUMENT', `inputs.${slot.id}`);
    }
  }
}

/** Required text and media block rendering while preserving draft edits. */
export function getEffectRenderability(
  document: EffectDocument,
): EffectRenderability {
  const template = getEffectTemplate(document.templateId);
  const paths = template.requiredContent
    .filter(key => !document.content[key].trim())
    .map(key => `content.${key}`);
  for (const slot of template.slots) {
    if (document.inputs.filter(item => item.slot === slot.id).length
      < slot.min) paths.push(`inputs.${slot.id}`);
  }
  return { ready: paths.length === 0, errors: paths.map(path => ({ path,
    code: 'EFFECT_DRAFT_INCOMPLETE', messageKey: 'effects.required' })) };
}
