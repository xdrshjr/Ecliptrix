import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { VisionImageRef } from '@/types/agentVision';
import { findMaterial } from './index';
import { createInspectExportTool } from './exportInspectTool';
import {
  executeVisionTool,
  resolveCompositionId,
  visionFailure,
} from './visionAdapter';

/**
 * `view_image` / `review_frames` —— Agent 的「眼睛」。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §4.4 / §5.3 / §4.7。
 *
 * 两条不可退让的纪律：
 *   1. **像素不进上下文**：这两个工具返回的是文字观察，不是图片；缩略图只
 *      出现在 `details.ui`，模型可见副本里会被替换成占位符。
 *   2. **来源是闭集**：参数只接受枚举来源 + 标识，绝不接受任意路径或 URL；
 *      服务端按白名单根做包含性校验（§4.4 的 R1–R6）。
 */

const MAX_IMAGES = 6;

/** `/api/storage/files/` 之后的相对键才是后端认的 `storage_key`。 */
const MATERIAL_STORAGE_PREFIX = '/api/storage/files/';

const sourceKind = Type.Union([
  Type.Literal('material'), Type.Literal('cover'), Type.Literal('workspace'),
  Type.Literal('artifact'), Type.Literal('frame'), Type.Literal('export'),
], {
  description:
    'Where the image comes from. material/cover/workspace/artifact read a '
    + 'stored file; frame cuts one moment out of a video; export is the '
    + 'rendered composition.',
});

const modeSchema = Type.Optional(Type.Union([
  Type.Literal('look'), Type.Literal('scan'),
], {
  description:
    'look = detailed reading of one scene (default); scan = fast pass for '
    + 'glitches and text legibility.',
}));

const imageRefParameters = Type.Object({
  source: sourceKind,
  material_id: Type.Optional(Type.String({
    description: 'Material id from list_materials/get_timeline.' })),
  storage_key: Type.Optional(Type.String({
    description:
      'Relative key exactly as returned by list_materials/get_timeline '
      + '(e.g. "cached_materials/pexels/1234.jpg"). Copy it verbatim; a made-up '
      + 'path is refused.' })),
  asset_id: Type.Optional(Type.String({
    description: 'Cover asset id (source="cover"); omit for the current cover.' })),
  name: Type.Optional(Type.String({
    description: 'Workspace relative file name (source="workspace").' })),
  artifact_id: Type.Optional(Type.String({
    description: 'Research artifact id (source="artifact").' })),
  composition_id: Type.Optional(Type.String({
    description:
      'Composition id for source="frame"/"export". May be omitted: the app '
      + 'uses the most recent export of this project.' })),
  at_seconds: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400,
    description: 'Second to cut for source="frame" (default 0).' })),
});

const viewImageParameters = Type.Object({
  images: Type.Array(imageRefParameters, {
    minItems: 1, maxItems: MAX_IMAGES,
    description: 'Images to review (1-6). Each needs a source and its id.',
  }),
  question: Type.String({ maxLength: 300, description:
    'What to check, e.g. "is this the right subject, and is any text cut off?"' }),
  mode: modeSchema,
  checklist: Type.Optional(Type.Array(Type.Union([
    Type.Literal('watermark'), Type.Literal('text_legible'),
    Type.Literal('subject_match'), Type.Literal('safe_area'),
    Type.Literal('quality'),
  ]), { maxItems: 5, description: 'Optional checklist to report on explicitly.' })),
});

const reviewFramesParameters = Type.Object({
  source: Type.Object({
    kind: Type.Union([
      Type.Literal('material'), Type.Literal('composition'),
      Type.Literal('workspace'),
    ], { description:
      'material = a library video; composition = the exported composition '
      + '(id may be omitted right after an export); workspace = a workspace file.' }),
    id: Type.Optional(Type.String({
      description:
        'Material id for kind="material", composition id for '
        + '"composition" (optional), or the relative name for "workspace".' })),
    storage_key: Type.Optional(Type.String({
      description: 'Material relative key copied verbatim from tool output.' })),
  }),
  start_seconds: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400,
    description: 'Start of the sampled window (default: 0).' })),
  end_seconds: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400,
    description: 'End of the sampled window (default: full duration).' })),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_IMAGES,
    description: 'Frames to sample into the contact sheet (default 4).' })),
  question: Type.Optional(Type.String({ maxLength: 300, description:
    'What to check across the frames, e.g. "is any subtitle cut off?"' })),
  mode: modeSchema,
});

type ViewImageParams = Static<typeof viewImageParameters>;
type ReviewFramesParams = Static<typeof reviewFramesParameters>;
type ImageRefParams = ViewImageParams['images'][number];
type FrameSourceParams = ReviewFramesParams['source'];

/**
 * 只接受「相对键」：非空、≤256 字符、不带盘符/前导 `/`/`..`/scheme。
 *
 * 服务端还会做一次白名单根校验（§4.4），这里只是把显然不会通过的输入
 * 挡在出口，免得模型为了一个错键反复试错。
 */
function normalizeStorageKey(raw?: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value || value.length > 256) return undefined;
  if (value.startsWith('/') || value.includes('..')) return undefined;
  if (/^[a-zA-Z]:/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return undefined;
  }
  return value;
}

function relativeStorageKey(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith(MATERIAL_STORAGE_PREFIX)
    ? raw.slice(MATERIAL_STORAGE_PREFIX.length) : raw;
}

/**
 * `storage_key` 的来源（§4.4 路径 A）。
 *
 * 模型给的键优先（它照抄了工具输出）；模型漏了就用 `ToolContext.materials`
 * 里那条素材的 `storageKey` / 同源 URL 反推——用户自己上传的素材在后端
 * **没有**索引表，不补这一步就只剩"只能看网图"。
 */
function storageKeyFor(
  context: ToolContext,
  materialId?: string,
  provided?: string,
): string | undefined {
  const explicit = normalizeStorageKey(provided);
  if (explicit) return explicit;
  if (!materialId) return undefined;
  const material = findMaterial(context.materials, materialId);
  return normalizeStorageKey(material?.storageKey)
    ?? normalizeStorageKey(relativeStorageKey(material?.cacheUrl))
    ?? normalizeStorageKey(relativeStorageKey(material?.url));
}

function toImageRef(
  context: ToolContext, ref: ImageRefParams,
): VisionImageRef {
  const image: VisionImageRef = { source: ref.source };
  if (ref.material_id) image.material_id = ref.material_id;
  const key = storageKeyFor(context, ref.material_id, ref.storage_key);
  if (key) image.storage_key = key;
  if (ref.asset_id) image.asset_id = ref.asset_id;
  if (ref.name) image.name = ref.name;
  if (ref.artifact_id) image.artifact_id = ref.artifact_id;
  if (typeof ref.at_seconds === 'number') image.at_seconds = ref.at_seconds;
  // 只有 frame / export 需要 composition_id；其余来源带上会让服务端困惑。
  if (ref.source === 'frame' || ref.source === 'export') {
    const compositionId = resolveCompositionId(context, ref.composition_id);
    if (compositionId) image.composition_id = compositionId;
  }
  return image;
}

function frameSource(
  context: ToolContext, source: FrameSourceParams,
) {
  const id = source.kind === 'composition'
    ? resolveCompositionId(context, source.id)
    : source.id?.trim() || undefined;
  const key = source.kind === 'material'
    ? storageKeyFor(context, id, source.storage_key)
    : normalizeStorageKey(source.storage_key);
  return {
    kind: source.kind,
    ...(id ? { id } : {}),
    ...(key ? { storage_key: key } : {}),
  };
}

export function createViewImageTool(
  context: ToolContext,
): AgentTool<typeof viewImageParameters> {
  return {
    name: 'view_image',
    label: 'View Image',
    description:
      'Look at 1-6 images and return a TEXT observation (never the image). '
      + 'Copy storage_key verbatim from list_materials/get_timeline; never '
      + 'invent one.',
    parameters: viewImageParameters,
    execute: async (toolCallId: string, params: ViewImageParams) => {
      if (!params.images?.length) {
        return visionFailure(
          'invalid_argument',
          { message: 'images must contain 1..6 entries' },
          'Pass one image per source, with the id a tool returned.',
        );
      }
      return executeVisionTool(context, toolCallId, {
        path: '/describe',
        body: {
          project_id: context.projectId ?? null,
          images: params.images.slice(0, MAX_IMAGES)
            .map(ref => toImageRef(context, ref)),
          question: params.question,
          mode: params.mode ?? 'look',
          ...(params.checklist?.length ? { checklist: params.checklist } : {}),
        },
      });
    },
  };
}

export function createReviewFramesTool(
  context: ToolContext,
): AgentTool<typeof reviewFramesParameters> {
  return {
    name: 'review_frames',
    label: 'Review Frames',
    description:
      'Sample 1-6 frames into one numbered contact sheet and return a TEXT '
      + 'observation (never the image). kind="composition" needs no id right '
      + 'after an export.',
    parameters: reviewFramesParameters,
    execute: async (toolCallId: string, params: ReviewFramesParams) => {
      const start = params.start_seconds;
      const end = params.end_seconds;
      if (typeof start === 'number' && typeof end === 'number' && end <= start) {
        return visionFailure(
          'invalid_argument',
          { message: 'end_seconds must be greater than start_seconds' },
          'Pass a window whose end is later than its start, or omit both to '
          + 'sample the whole clip.',
        );
      }
      return executeVisionTool(context, toolCallId, {
        path: '/frames',
        body: {
          project_id: context.projectId ?? null,
          source: frameSource(context, params.source),
          ...(typeof start === 'number' ? { start_seconds: start } : {}),
          ...(typeof end === 'number' ? { end_seconds: end } : {}),
          count: params.count ?? 4,
          ...(params.question ? { question: params.question } : {}),
          ...(params.mode ? { mode: params.mode } : {}),
        },
      });
    },
  };
}

export function createVisionTools(context: ToolContext) {
  return [
    createViewImageTool(context),
    createReviewFramesTool(context),
    createInspectExportTool(context),
  ];
}
