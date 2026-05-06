'use client';

import { titleTemplate } from './titleTemplate';
import { tutorialTemplate } from './tutorialTemplate';
import { clickTemplate } from './clickTemplate';
import { minimalTemplate } from './minimalTemplate';
import { applyTemplate as applyTemplateImpl } from '../utils/applyTemplate';
import type {
  CoverAspectRatio,
  CoverState,
  CoverTemplateDefinition,
  CoverTemplateId,
} from '../types';

/**
 * Registry of the four built-in templates. Order is the picker order.
 */
export const COVER_TEMPLATES: ReadonlyArray<CoverTemplateDefinition> = [
  titleTemplate,
  tutorialTemplate,
  clickTemplate,
  minimalTemplate,
];

const TEMPLATE_BY_ID = new Map<CoverTemplateId, CoverTemplateDefinition>(
  COVER_TEMPLATES.map((t) => [t.id, t]),
);

export function getTemplate(id: CoverTemplateId): CoverTemplateDefinition {
  return TEMPLATE_BY_ID.get(id) ?? titleTemplate;
}

/**
 * Build a fresh ``CoverState`` from a template id + the player's current
 * aspect ratio. Used when the modal opens for a project that has no saved
 * cover yet.
 */
export function makeDefaultState(opts: {
  templateId?: CoverTemplateId;
  aspectRatio: CoverAspectRatio;
}): CoverState {
  const def = getTemplate(opts.templateId ?? 'title');
  return {
    templateId: def.id,
    coverConfig: {
      version: 1,
      textLayers: def.defaultConfig.textLayers.map((l) => ({ ...l })),
      decorations: def.defaultConfig.decorations.map((d) => ({ ...d })),
    },
    imageSource: 'frame',
    frameVirtualTimeMs: 0,
    uploadedImageUrl: null,
    aspectRatio: opts.aspectRatio,
  };
}

/**
 * Switch to a different template, carrying over user-typed text by ``key``.
 * Re-exported here so consumers do a single import from ``./templates``.
 */
export function applyTemplate(
  nextTemplateId: CoverTemplateId,
  prev: CoverState,
): CoverState {
  return applyTemplateImpl(nextTemplateId, prev, getTemplate);
}
