import { z } from 'zod';
import type { MaterialItem, TimelineItem, Track } from '@/types';
import type { EffectAsset, EffectDocument, EffectParameterSchema,
  EffectTargetSnapshot } from '@/types/effects';
import { EffectError } from '@/types/effects';
import { createEffectDocument, EFFECT_CATALOG, getEffectTemplate } from '@/lib/effects/catalog';
import { validateEffectDocument } from '@/lib/effects/validation';
import { fingerprintEffectTarget } from '@/lib/effects/provenance';
import { fromWireEffectAsset, fromWireEffectDraft,
  toWireEffectDocument } from '@/lib/api/effects';
import type { ToolContext } from '../types';
import { effectId, effectRequest, effectProjectPath, effectText,
  makeEffectTool, strictObject } from './effectsCatalogTools';

const number = z.number().finite();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
function parameterSchema(schema: EffectParameterSchema): z.ZodType {
  if (schema.type === 'string') return schema.enum
    ? z.enum(schema.enum as [string, ...string[]]) : effectText(schema.maxLength ?? 300);
  if (schema.type === 'array') return z.array(number.min(schema.items!.minimum)
    .max(schema.items!.maximum)).min(schema.minItems!).max(schema.maxItems!);
  const value = number.min(schema.minimum!).max(schema.maximum!);
  return schema.type === 'integer' ? value.int() : value;
}
// Only shared editable fields are disclosed here. get_effect_template supplies
// the chosen schema; validateEffectDocument enforces that exact template again.
const parameterFields = Object.assign({},
  ...EFFECT_CATALOG.templates.map(t => t.parameterSchema)) as Record<string, EffectParameterSchema>;
const params = strictObject(Object.fromEntries(Object.entries(parameterFields)
  .map(([key, schema]) => [key, parameterSchema(schema).optional()])));
const edits = {
  name: effectText(100).optional(),
  content: strictObject({ title: effectText(120).optional(),
    subtitle: effectText(300).optional() }).optional(), params: params.optional(),
  palette: strictObject({ background: color.optional(),
    foreground: color.optional(), accent: color.optional() }).optional(),
  typography: strictObject({ family: z.enum(['sans', 'serif', 'mono']).optional(),
    scale: number.min(0.6).max(1.4).optional(),
    align: z.enum(['left', 'center', 'right']).optional() }).optional(),
  motion: strictObject({ speed: number.min(0.5).max(2).optional(),
    intensity: number.min(0).max(1).optional() }).optional(),
  seed: number.int().min(0).max(2147483647).optional(),
  durationSeconds: number.min(0.5).max(60).optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional(),
  sourceMaterialId: effectId.optional(), sourceClipId: effectId.optional(),
  images: z.array(strictObject({ slot: effectId, materialId: effectId,
    index: number.int().min(0).max(7).optional() })).max(8).optional(),
};
const editSchema = strictObject(edits);
type DraftEdits = z.output<typeof editSchema>;

export function getEffectsTargets(context: ToolContext) {
  return context.effectsTargets ??= { drafts: new Map(), outputs: new Map() };
}

export function findEffectsClip(context: ToolContext, clipId: string) {
  for (const track of context.timelineState.tracks) {
    const item = track.items.find(item => item.id === clipId);
    if (item) return { track, item };
  }
  throw new EffectError('EFFECT_TARGET_CHANGED');
}

export function effectsSourceRef(material: Partial<MaterialItem>): string {
  const source = [material.cacheUrl, material.metadata?.localResolvedUrl,
    material.serverUrl, material.url].find(url => typeof url === 'string'
      && url.startsWith('/api/storage/files/'));
  if (!source) throw new EffectError('EFFECT_INPUT_NOT_LOCAL');
  return source;
}

export async function attachEffectsInput(context: ToolContext,
  material: Partial<MaterialItem>, originMaterialId?: string): Promise<EffectAsset> {
  const result = await effectRequest(context, effectProjectPath(context, '/inputs'),
    { body: { source_ref: effectsSourceRef(material),
      ...(originMaterialId ? { origin_material_id: originMaterialId } : {}) } });
  return fromWireEffectAsset(result.asset as Record<string, unknown>);
}

function applyCanvas(document: EffectDocument, width: number, height: number) {
  const scale = Math.min(1, 1920 / Math.max(width, height));
  if (Math.min(width, height) * scale < 64) {
    throw new EffectError('EFFECT_SOURCE_RANGE_INVALID');
  }
  document.canvas = { width: Math.floor(width * scale / 2) * 2,
    height: Math.floor(height * scale / 2) * 2, fps: 30 };
}

/** A target intent refers to this request's live mirror, never project_data. */
export async function captureEffectsTarget(context: ToolContext,
  clipId: string, allowImageSource = false): Promise<{ target: EffectTargetSnapshot; asset: EffectAsset }> {
  const { track, item } = findEffectsClip(context, clipId);
  assertClipSource(item, track, allowImageSource);
  const fingerprint = fingerprintEffectTarget(track, item);
  const material = context.materials.find(m => m.id === item.materialId);
  const asset = await attachEffectsInput(context, { ...material, ...item }, item.materialId);
  const current = findEffectsClip(context, clipId);
  if (fingerprintEffectTarget(current.track, current.item) !== fingerprint) {
    throw new EffectError('EFFECT_TARGET_CHANGED');
  }
  return { asset, target: { projectId: context.projectId!, trackId: track.id,
    clipId: item.id, sourceMaterialId: item.materialId,
    targetFingerprint: fingerprint, durationSeconds: item.duration,
    sourceSha256: asset.sha256, trimStartFrame: Math.round((item.clipStart ?? 0) * 30),
    durationFrames: Math.ceil(item.duration * 30) } };
}

function assertClipSource(item: TimelineItem, track: Track, allowImageSource: boolean): void {
  const image = item.originalMaterialType === 'image';
  if ((!image && item.type !== 'video') || (image && !allowImageSource)
    || item.metadata?.role || track.isLocked || !Number.isFinite(item.duration)
    || item.duration < 0.5 || item.duration > 60
    || !Number.isFinite(item.clipStart ?? 0) || (item.clipStart ?? 0) < 0
    || (!image && item.clipEnd !== undefined
      && Math.abs(item.clipEnd - (item.clipStart ?? 0) - item.duration) > 1 / 30)) {
    throw new EffectError('EFFECT_SOURCE_RANGE_INVALID');
  }
}

async function bindSource(context: ToolContext, document: EffectDocument,
  changes: DraftEdits): Promise<EffectTargetSnapshot | undefined> {
  if (changes.sourceClipId && (changes.sourceMaterialId
    || changes.durationSeconds !== undefined || changes.aspectRatio !== undefined)) {
    throw new EffectError('EFFECT_INVALID_ARGUMENT');
  }
  let asset: EffectAsset | undefined;
  let target: EffectTargetSnapshot | undefined;
  if (changes.sourceClipId) {
    const source = await captureEffectsTarget(context, changes.sourceClipId, true);
    asset = source.asset;
    target = asset.kind === 'input-video' ? source.target : undefined;
    document.durationFrames = source.target.durationFrames!;
  } else if (changes.sourceMaterialId) {
    const material = context.materials.find(m => m.id === changes.sourceMaterialId);
    if (!material || !['image', 'video'].includes(material.type)) {
      throw new EffectError('EFFECT_NOT_FOUND');
    }
    asset = await attachEffectsInput(context, material, material.id);
    if (asset.kind === 'input-video' && changes.durationSeconds === undefined) {
      document.durationFrames = Math.min(150, Math.floor(asset.durationSeconds! * 30));
    }
  }
  if (asset) {
    if (!changes.aspectRatio) applyCanvas(document, asset.width, asset.height);
    document.inputs = document.inputs.filter(input => input.slot !== 'base');
    document.inputs.push({ slot: 'base', assetId: asset.id,
      kind: asset.kind === 'input-video' ? 'video' : 'image', fit: 'cover',
      focalX: 0.5, focalY: 0.5, ...(asset.kind === 'input-video'
        ? { trimStartSeconds: (target?.trimStartFrame ?? 0) / 30 } : {}) });
  }
  return target;
}

async function changeDocument(context: ToolContext, original: EffectDocument,
  changes: DraftEdits) {
  const document = structuredClone(original);
  for (const key of ['content', 'palette', 'typography', 'motion', 'params'] as const) {
    Object.assign(document[key], changes[key]);
  }
  if (changes.seed !== undefined) document.seed = changes.seed;
  if (changes.durationSeconds !== undefined) {
    document.durationFrames = Math.round(changes.durationSeconds * 30);
  }
  if (changes.aspectRatio) {
    const [w, h] = changes.aspectRatio.split(':').map(Number);
    applyCanvas(document, w * 1080, h * 1080);
  }
  const target = await bindSource(context, document, changes);
  if (changes.images) await bindImages(context, document, changes.images);
  validateEffectDocument(document);
  return { document, target };
}

async function bindImages(context: ToolContext, document: EffectDocument,
  images: NonNullable<DraftEdits['images']>): Promise<void> {
  const slots = new Set(images.map(image => image.slot));
  document.inputs = document.inputs.filter(input => input.kind === 'video'
    || (input.slot === 'base' && !slots.has('base')));
  for (const image of images) {
    const material = context.materials.find(m => m.id === image.materialId);
    if (!material || material.type !== 'image') throw new EffectError('EFFECT_NOT_FOUND');
    const asset = await attachEffectsInput(context, material, material.id);
    document.inputs.push({ slot: image.slot, assetId: asset.id, kind: 'image',
      fit: 'cover', focalX: 0.5, focalY: 0.5,
      ...(image.index === undefined ? {} : { index: image.index }) });
  }
}

export function createEffectsDraftTools(context: ToolContext) {
  return [makeEffectTool({ context, name: 'create_effect_draft',
    description: 'Create a savable effect draft using local materials or one clip. Missing text/images remain incomplete.',
    schema: strictObject({ templateId: effectId, ...edits }),
    run: async (_, params) => {
      getEffectTemplate(params.templateId);
      const changed = await changeDocument(context,
        createEffectDocument(params.templateId), params);
      const draft = fromWireEffectDraft(await effectRequest(context,
        effectProjectPath(context, '/drafts'), { body: {
          name: params.name ?? 'Remotion', document: toWireEffectDocument(changed.document) } }));
      if (changed.target) getEffectsTargets(context).drafts.set(draft.id, changed.target);
      return { success: true, draftId: draft.id, version: draft.version,
        renderability: draft.renderability,
        targetFingerprint: changed.target?.targetFingerprint };
    } }), makeEffectTool({ context, name: 'update_effect_draft',
    description: 'CAS-update one effect draft. Template changes require a new draft; incomplete work remains savable.',
    schema: strictObject({ draftId: effectId,
      expectedVersion: number.int().positive(), changes: editSchema }),
    run: async (_, params) => {
      const path = effectProjectPath(context, `/drafts/${encodeURIComponent(params.draftId)}`);
      const current = fromWireEffectDraft(await effectRequest(context, path));
      if (current.version !== params.expectedVersion || current.readOnly) {
        throw new EffectError('EFFECT_VERSION_CONFLICT');
      }
      const changed = await changeDocument(context, current.document, params.changes);
      const draft = fromWireEffectDraft(await effectRequest(context, path, {
        method: 'PUT', body: { expected_version: params.expectedVersion,
          name: params.changes.name ?? current.name,
          document: toWireEffectDocument(changed.document) } }));
      if (changed.target) getEffectsTargets(context).drafts.set(draft.id, changed.target);
      else if (params.changes.sourceMaterialId || params.changes.sourceClipId) {
        getEffectsTargets(context).drafts.delete(draft.id);
      }
      return { success: true, draftId: draft.id, version: draft.version,
        renderability: draft.renderability };
    } })];
}
