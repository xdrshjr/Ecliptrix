import catalog from './catalog.json';
import type {
  EffectDocument, EffectLibrary, EffectTemplate,
} from '@/types/effects';
import { EffectError } from '@/types/effects';

export const EFFECT_CATALOG = catalog as unknown as {
  schemaVersion: number;
  catalogVersion: number;
  libraries: EffectLibrary[];
  templates: EffectTemplate[];
};

/** Resolve one versioned built-in template; arbitrary code is never accepted. */
export function getEffectTemplate(id: string): EffectTemplate {
  const template = EFFECT_CATALOG.templates.find(item => item.id === id);
  if (!template) throw new EffectError('EFFECT_TEMPLATE_INCOMPATIBLE');
  return template;
}

/** Start an editable draft; required content is deliberately left empty. */
export function createEffectDocument(id = 'title-rise'): EffectDocument {
  const template = getEffectTemplate(id);
  return {
    schemaVersion: 1, templateId: id, templateVersion: template.version,
    canvas: { width: 1920, height: 1080, fps: 30 },
    durationFrames: 150, seed: 1,
    content: { title: '', subtitle: '' },
    palette: { background: '#15171A', foreground: '#F5F4F1',
      accent: '#C87758' },
    typography: { family: 'sans', scale: 1, align: 'center' },
    motion: { speed: 1, intensity: 1 }, inputs: [],
    params: structuredClone(template.defaults),
  };
}
