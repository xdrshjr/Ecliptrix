/**
 * Cover-specific types for the VideoCoverModal subtree.
 *
 * Cross-file imports come from THIS module — multi-agent coordination
 * forbids re-declaring these types elsewhere. Timeline / material types
 * (``MaterialItem``, ``TimelineItem``) are NOT re-declared here; consumers
 * import them from ``@/types`` (the project-wide single source of truth).
 */

export const COVER_TEMPLATE_IDS = [
  'title',
  'tutorial',
  'click',
  'minimal',
] as const;
export type CoverTemplateId = (typeof COVER_TEMPLATE_IDS)[number];

export type ImageSource = 'frame' | 'upload';

export const COVER_ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '21:9',
] as const;
export type CoverAspectRatio = (typeof COVER_ASPECT_RATIOS)[number];

export type CoverTextAlign = 'left' | 'center' | 'right';

/**
 * One styled text layer. ``key`` is template-defined and stable across
 * template switches so user-typed ``text`` carries over when the picker
 * changes templates.
 */
export interface CoverTextLayer {
  key: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  align: CoverTextAlign;
  /** Normalized 0..1 position of the text block's anchor on the canvas. */
  x: number;
  y: number;
  /** Normalized 0..1 width — text wraps inside the box. */
  width: number;
}

export type CoverDecorationType = 'rect' | 'line' | 'badge';

export interface CoverDecoration {
  type: CoverDecorationType;
  /** Normalized 0..1 position. Decorations sit *behind* text layers. */
  x: number;
  y: number;
  w?: number;
  h?: number;
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  text?: string;
}

export interface CoverConfig {
  version: 1;
  textLayers: CoverTextLayer[];
  decorations: CoverDecoration[];
  /** Forward-compat hook for a future "burn cover into MP4" pass. Unused in v1. */
  cover_render_metadata?: Record<string, unknown>;
}

/**
 * In-app cover state (camelCase). Sent to the BFF in a snake_case shape via
 * ``putCover`` — see ``src/lib/api/videoCover.ts``.
 */
export interface CoverState {
  templateId: CoverTemplateId;
  coverConfig: CoverConfig;
  imageSource: ImageSource;
  frameVirtualTimeMs: number | null;
  uploadedImageUrl: string | null;
  aspectRatio: CoverAspectRatio;
}

/**
 * Backend payload shape (snake_case). Used by the API client when shaping
 * server responses back into the in-app camelCase ``CoverState``.
 */
export interface CoverStateOut {
  project_id: string;
  template_id: CoverTemplateId;
  cover_config: CoverConfig;
  image_source: ImageSource;
  frame_virtual_time_ms: number | null;
  uploaded_image_url: string | null;
  aspect_ratio: CoverAspectRatio;
  created_at: string;
  updated_at: string;
}

/**
 * Definition of one of the four built-in templates. ``defaultConfig`` seeds
 * the cover when the template is first picked; on subsequent template
 * switches, ``applyTemplate`` carries over the user's typed ``text`` for
 * matching keys.
 */
export interface CoverTemplateDefinition {
  id: CoverTemplateId;
  /** i18n key relative to ``videoCoverModal.templates.*`` */
  i18nKey: 'title' | 'tutorial' | 'click' | 'minimal';
  /** Inline SVG markup used as the picker thumbnail. */
  thumbnailSvg: string;
  /** Default ``CoverConfig`` for a fresh cover. */
  defaultConfig: CoverConfig;
}
