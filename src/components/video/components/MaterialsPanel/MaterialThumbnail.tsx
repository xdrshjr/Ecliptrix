'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MaterialItem } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import { extractVideoThumbnail } from '../../utils/extractVideoThumbnail';

interface MaterialThumbnailProps {
  material: MaterialItem;
}

const logger = new VideoEditingLogger({ component: 'MaterialThumbnail' });

/**
 * Placeholder glyph shown when no thumbnail can be rendered. Kept identical to
 * the four icons MaterialsPanel rendered inline before the extraction so the
 * audio / image / subtitle / video cards look unchanged.
 */
const PlaceholderIcon: React.FC<{ type: MaterialItem['type'] }> = ({ type }) => {
  if (type === 'audio') {
    return (
      <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M9 9a3 3 0 000 6 3 3 0 000-6z" />
      </svg>
    );
  }
  if (type === 'image') {
    return (
      <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (type === 'subtitle') {
    return (
      <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m0 0V3a1 1 0 011 1v12a1 1 0 01-1 1H8a1 1 0 01-1-1V4m0 0H5a1 1 0 00-1 1v14a1 1 0 001 1h14a1 1 0 001-1V5a1 1 0 00-1-1h-2M9 7h6m-6 4h6m-2 4h2" />
      </svg>
    );
  }
  return (
    <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
};

/**
 * Self-healing material card thumbnail (local-upload-video-thumbnail-fix §3.2 B,
 * "mode B"). The card must never show a broken-image glyph, so the render
 * degrades through a fallback chain:
 *
 *   1. ``<img src={material.thumbnailUrl}>`` — backend poster or client dataURL.
 *   2. On an ``<img>`` error for a VIDEO, re-extract a frame client-side via
 *      ``extractVideoThumbnail(material.url)`` (one shot) and swap to the dataURL.
 *   3. If that also fails — or the material is not a video / has no thumbnail —
 *      render the placeholder icon instead of a broken ``<img>``.
 */
const MaterialThumbnail: React.FC<MaterialThumbnailProps> = ({ material }) => {
  const [src, setSrc] = useState<string | undefined>(material.thumbnailUrl);
  const [failed, setFailed] = useState(false);
  const retriedRef = useRef(false);
  const isMountedRef = useRef(true);

  // Re-sync when the material identity / poster changes (e.g. an upload
  // completes and replaces the placeholder material in place).
  useEffect(() => {
    setSrc(material.thumbnailUrl);
    setFailed(false);
    retriedRef.current = false;
  }, [material.id, material.thumbnailUrl]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleError = async () => {
    if (material.type === 'video' && !retriedRef.current && material.url) {
      retriedRef.current = true;
      logger.debug('thumb-error-retry', {
        materialId: material.id, thumbnailUrl: src, materialType: material.type,
      });
      const dataUrl = await extractVideoThumbnail(material.url);
      if (dataUrl && isMountedRef.current) {
        setSrc(dataUrl);
        return;
      }
    }
    console.error(`[MaterialThumbnail] 缩略图回退到占位图标: ${material.name}`, {
      materialId: material.id, thumbnailUrl: src, materialType: material.type,
    });
    if (isMountedRef.current) setFailed(true);
  };

  if (!src || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <PlaceholderIcon type={material.type} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={material.name}
      className="w-full h-full object-cover pointer-events-none"
      onLoad={() => {
        logger.debug('thumb-loaded', {
          materialId: material.id, thumbnailUrl: src, materialType: material.type,
        });
      }}
      onError={handleError}
    />
  );
};

export default MaterialThumbnail;
