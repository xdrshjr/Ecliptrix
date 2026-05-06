'use client';

import type {
  CoverState,
  CoverTemplateDefinition,
  CoverTemplateId,
  CoverTextLayer,
} from '../types';

/**
 * Switch templates while preserving the user's typed-in ``text`` content
 * for any layer ``key`` that exists in BOTH the previous and next templates.
 *
 * Behavior:
 *   * For each layer in the new template's defaults, look up the same ``key``
 *     in ``prev.coverConfig.textLayers``. If found AND that layer has a
 *     non-empty ``text``, copy the ``text`` over and KEEP the new template's
 *     style (font / size / color / weight / align / position).
 *   * Otherwise, the layer takes the new template's defaults verbatim.
 *   * Decorations are replaced wholesale — there is no carry-over for them.
 *   * Image source / aspect ratio / frame time / uploaded URL are preserved
 *     from ``prev``; only the template-driven fields change.
 *
 * The ``getTemplate`` parameter is injected so this module has no circular
 * dependency on ``./templates/index.ts``.
 */
export function applyTemplate(
  nextTemplateId: CoverTemplateId,
  prev: CoverState,
  getTemplate: (id: CoverTemplateId) => CoverTemplateDefinition,
): CoverState {
  const next = getTemplate(nextTemplateId);

  const prevByKey = new Map<string, CoverTextLayer>();
  for (const layer of prev.coverConfig.textLayers) {
    prevByKey.set(layer.key, layer);
  }

  const mergedLayers: CoverTextLayer[] = next.defaultConfig.textLayers.map((defLayer) => {
    const prior = prevByKey.get(defLayer.key);
    if (prior && prior.text && prior.text.trim().length > 0) {
      return { ...defLayer, text: prior.text };
    }
    return { ...defLayer };
  });

  return {
    ...prev,
    templateId: next.id,
    coverConfig: {
      version: 1,
      textLayers: mergedLayers,
      decorations: next.defaultConfig.decorations.map((d) => ({ ...d })),
      cover_render_metadata: prev.coverConfig.cover_render_metadata,
    },
  };
}
