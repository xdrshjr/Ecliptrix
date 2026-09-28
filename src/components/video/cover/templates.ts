import type { CoverAspectRatio, CoverDocument, CoverMode,
  CoverTemplateId } from '@/types/videoCover';

export interface CoverTemplate {
  color: string; textColor: string; accentColor: string;
  titleScale: number; mode: CoverMode; prompt: string;
}
export const COVER_TEMPLATES: Record<CoverTemplateId, CoverTemplate> = {
  editorial: { color: '#F4F1EA', textColor: '#242320', accentColor: '#B66B50',
    titleScale: 0.092, mode: 'mixed', prompt: 'Natural light, subject on the right, quiet negative space on the left' },
  cinematic: { color: '#151719', textColor: '#F4F1EA', accentColor: '#B66B50',
    titleScale: 0.086, mode: 'mixed', prompt: 'Cinematic wide scene, layered light, readable negative space below' },
  knowledge: { color: '#F4F1EA', textColor: '#233C58', accentColor: '#E7BE61',
    titleScale: 0.090, mode: 'html', prompt: 'Clear subject, clean background, informative composition' },
  product: { color: '#ECEDEA', textColor: '#242320', accentColor: '#315C4B',
    titleScale: 0.082, mode: 'mixed', prompt: 'Single central subject, soft studio light, negative space above' },
  bold: { color: '#171717', textColor: '#FFFFFF', accentColor: '#DC8354',
    titleScale: 0.125, mode: 'html', prompt: 'Strong contrast, simple composition, no letters or watermark' },
};

export function createCoverDocument(options: {
  templateId?: CoverTemplateId; aspectRatio?: CoverAspectRatio;
  title?: string; mode?: CoverMode;
} = {}): CoverDocument {
  const templateId = options.templateId ?? 'editorial';
  const template = COVER_TEMPLATES[templateId];
  return {
    schemaVersion: 2, templateVersion: 1, templateId,
    mode: options.mode ?? template.mode,
    aspectRatio: options.aspectRatio ?? '16:9',
    fields: { title: options.title ?? '', subtitle: '', label: '' },
    typography: { family: 'sans', titleScale: 1, align: 'left',
      textColor: template.textColor, accentColor: template.accentColor },
    background: { kind: 'solid', color: template.color, assetId: null,
      focusX: 0.5, focusY: 0.5 },
    generation: { prompt: '', count: 1 }, durationFrames: 30,
  };
}

export function applyCoverTemplate(document: CoverDocument,
  templateId: CoverTemplateId): CoverDocument {
  const fresh = createCoverDocument({ templateId });
  return { ...document, templateId, typography: fresh.typography,
    background: document.background.kind === 'asset'
      ? document.background : fresh.background };
}
