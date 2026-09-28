'use client';
import React, { useLayoutEffect, useRef } from 'react';
import type { CoverDocument } from '@/types/videoCover';
import { coverSize, templateLayout } from './layout';
import { measureCoverText } from './coverValidation';
import { COVER_TEMPLATES } from './templates';

const FONTS = {
  sans: 'Segoe UI, Microsoft YaHei, sans-serif',
  serif: 'Georgia, Songti SC, SimSun, serif',
  mono: 'Consolas, Microsoft YaHei, monospace',
};
export function measureCoverCanvas(root: HTMLElement): boolean {
  const result = measureCoverText(root);
  return result.measurable && result.overflowFields.length === 0;
}

export function CoverCanvas({ document: doc, backgroundUrl, safeArea = false,
  onOverflow, imageLoadKey = 0 }: { document: CoverDocument; backgroundUrl?: string;
  imageLoadKey?: number;
  safeArea?: boolean; onOverflow?: (overflow: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = coverSize(doc.aspectRatio);
  const s = Math.min(width, height);
  const layout = templateLayout(doc);
  const template = COVER_TEMPLATES[doc.templateId];
  useLayoutEffect(() => {
    if (ref.current) onOverflow?.(!measureCoverCanvas(ref.current));
  }, [doc, onOverflow]);
  const background = doc.background.kind === 'gradient'
    ? `linear-gradient(125deg, ${doc.background.color}, ${template.accentColor})`
    : doc.background.color;
  return <div ref={ref} data-cover-canvas data-cover-mode={doc.mode}
    style={{ width, height, position: 'relative',
    overflow: 'hidden', background, color: doc.typography.textColor,
    fontFamily: FONTS[doc.typography.family] }}>
    {backgroundUrl && doc.background.kind === 'asset' && <img key={imageLoadKey}
      alt="" src={backgroundUrl}
      style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover',
        objectPosition: `${doc.background.focusX * 100}% ${doc.background.focusY * 100}%` }} />}
    {doc.mode !== 'ai' && <>
      {doc.templateId === 'cinematic' && <div style={{ position: 'absolute', inset: 0,
        background: 'linear-gradient(transparent 30%, rgba(0,0,0,.82))' }} />}
      {doc.background.kind !== 'asset' && <div style={{ position: 'absolute',
        width: width * .30, height: height * .42, right: width * .07,
        bottom: height * .08, border: `${s * .006}px solid ${doc.typography.accentColor}`,
        borderRadius: doc.templateId === 'product' ? '50%' : 0, opacity: .4 }} />}
      {(['title', 'subtitle', 'label'] as const).map(key => {
        const box = layout[key];
        const initial = key === 'title' ? s * template.titleScale * doc.typography.titleScale
          : s * (key === 'subtitle' ? .034 : .026);
        return <div key={key} data-cover-text={key} data-initial={initial}
          data-minimum={s * (key === 'title' ? .04 : key === 'subtitle' ? .025 : .026)}
          data-lines={key === 'title' ? 3 : key === 'subtitle' ? 2 : 1}
          style={{ position: 'absolute', left: box.x * width, top: box.y * height,
            width: box.width * width, height: box.height * height, whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere', lineHeight: 1.12, fontSize: initial,
            fontWeight: key === 'title' ? 700 : 500, textAlign: doc.typography.align,
            color: key === 'label' ? doc.typography.accentColor : undefined }}>
          {doc.fields[key]}
        </div>;
      })}
    </>}
    {safeArea && <div data-cover-guide style={{ position: 'absolute', inset: '6%',
      border: '2px dashed rgba(128,128,128,.65)', pointerEvents: 'none' }} />}
  </div>;
}
