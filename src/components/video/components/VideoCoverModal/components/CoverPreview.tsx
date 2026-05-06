'use client';

import React, { forwardRef, useEffect, useRef, useState } from 'react';

import { aspectRatioToSize } from '../utils/aspectRatioToSize';
import type { CoverAspectRatio, CoverConfig, CoverTextLayer } from '../types';
import { DecorationLayer } from './DecorationLayer';
import { EditableTextLayer } from './EditableTextLayer';

interface CoverPreviewProps {
  aspectRatio: CoverAspectRatio;
  config: CoverConfig;
  /** Background dataURL (frame extracted from the timeline) or remote URL. */
  backgroundUrl: string | null;
  editingLayerKey: string | null;
  selectedLayerKey: string | null;
  onSelectLayer: (key: string | null) => void;
  onStartEditLayer: (key: string) => void;
  onUpdateLayer: (key: string, patch: Partial<CoverTextLayer>) => void;
  onCommitText: (key: string, next: string) => void;
}

/**
 * forwardRef container exposing the inner stage element to ``useCoverRender``
 * (so ``html-to-image`` snapshots the cover EXACTLY as the user sees it).
 *
 * The stage clamps to the project's selected aspect ratio. A ``--cover-px``
 * CSS variable is set so px-at-1080-short-side font sizes scale faithfully
 * regardless of the on-screen preview width.
 */
export const CoverPreview = forwardRef<HTMLDivElement, CoverPreviewProps>(
  function CoverPreview(props, ref) {
    const {
      aspectRatio,
      config,
      backgroundUrl,
      editingLayerKey,
      selectedLayerKey,
      onSelectLayer,
      onStartEditLayer,
      onCommitText,
    } = props;

    const stageRef = useRef<HTMLDivElement | null>(null);
    const [stageWidth, setStageWidth] = useState(0);

    // Bridge the forwarded ref + our internal ref (ResizeObserver needs the
    // raw DOM node).
    React.useImperativeHandle(ref, () => stageRef.current as HTMLDivElement, []);

    useEffect(() => {
      const el = stageRef.current;
      if (!el) return;
      const update = () => setStageWidth(el.clientWidth);
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }, [aspectRatio]);

    const { width: nativeW } = aspectRatioToSize(aspectRatio);
    const ratioStyle: React.CSSProperties = {
      aspectRatio: aspectRatio.replace(':', ' / '),
      // px-at-1080-short-side → on-screen px scaling factor used by the
      // text layer / decoration components.
      ['--cover-px' as unknown as string]: stageWidth > 0
        ? `${stageWidth / nativeW}px`
        : '0.0009259px',
      backgroundImage: backgroundUrl ? `url(${cssUrl(backgroundUrl)})` : undefined,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      // Subtle checkerboard for transparent regions
      backgroundColor: '#0f172a',
    };

    return (
      <div
        ref={stageRef}
        className="relative w-full overflow-hidden rounded-md shadow-inner"
        style={ratioStyle}
        onClick={() => onSelectLayer(null)}
      >
        <DecorationLayer decorations={config.decorations} />

        {config.textLayers.map((layer) => (
          <EditableTextLayer
            key={layer.key}
            layer={layer}
            isEditing={editingLayerKey === layer.key}
            selected={selectedLayerKey === layer.key}
            onSelect={() => onSelectLayer(layer.key)}
            onStartEdit={() => onStartEditLayer(layer.key)}
            onCommitText={(next) => onCommitText(layer.key, next)}
          />
        ))}
      </div>
    );
  },
);

/**
 * Escape parentheses + quotes so user-supplied URLs cannot break out of
 * ``url(...)`` in our inline style.
 */
function cssUrl(raw: string): string {
  return `'${raw.replace(/'/g, "\\'").replace(/\n/g, '')}'`;
}

export default CoverPreview;
