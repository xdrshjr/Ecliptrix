'use client';
import React, { useEffect, useId, useRef, useState } from 'react';
import type { CoverDocument } from '@/types/videoCover';
import { useLocale } from '@/contexts/LocaleContext';
import { CoverCanvas } from './CoverCanvas';
import { coverSize, fitCoverPreview } from './layout';

export function CoverPreviewDialog({ open, title, document: coverDocument,
  backgroundUrl, imageUrl, onClose, onImageError, onFocusFallback }: {
  open: boolean; title: string; document?: CoverDocument;
  backgroundUrl?: string; imageUrl?: string; onClose: () => void;
  onImageError?: () => void; onFocusFallback?: () => void;
}) {
  const { t } = useLocale(); const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const fallback = useRef(onFocusFallback); fallback.current = onFocusFallback;
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  useEffect(() => { setImageSize({ width: 0, height: 0 }); }, [imageUrl]);
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    const trigger = window.document.activeElement as HTMLElement | null;
    node.showModal(); closeButton.current?.focus();
    const measure = () => setBounds({ width: viewport.current?.clientWidth ?? 0,
      height: viewport.current?.clientHeight ?? 0 });
    measure(); const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    return () => {
      observer.disconnect(); node.close();
      if (trigger?.isConnected) trigger.focus();
      if (!trigger || window.document.activeElement !== trigger) fallback.current?.();
    };
  }, [open]);
  const output = coverDocument ? coverSize(coverDocument.aspectRatio) : imageSize;
  const fit = fitCoverPreview(output, bounds);
  return <dialog ref={dialog} className="cover-preview-dialog"
    aria-labelledby={titleId} onCancel={event => {
      event.preventDefault(); event.stopPropagation(); onClose();
    }} onClose={() => { if (open) onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
    <header><h3 id={titleId}>{title}</h3>
      <button ref={closeButton} onClick={onClose}>{t.coverStudio.close}</button>
    </header>
    <div ref={viewport} className="cover-dialog-viewport">
      {imageUrl && <img className="cover-history-image" src={imageUrl} alt={title}
        onLoad={event => setImageSize({ width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight })}
        onError={onImageError} style={{ width: fit.width, height: fit.height,
          visibility: fit.scale > 0 ? 'visible' : 'hidden' }} />}
      {coverDocument && fit.scale > 0 &&
        <div className="cover-dialog-frame" style={{ width: fit.width, height: fit.height }}>
          <div style={{ transform: `scale(${fit.scale})`, transformOrigin: 'top left' }}>
            <CoverCanvas document={coverDocument} backgroundUrl={backgroundUrl} />
          </div>
        </div>}
      {!fit.scale && <span role="status">{t.coverStudio.loading}</span>}
    </div>
  </dialog>;
}
