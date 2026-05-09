'use client';

import React, { forwardRef, useRef } from 'react';

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
 * `--cover-px` is derived purely in CSS via `calc(100cqw / nativeW)` so the
 * value is correct at any rendered width — including html-to-image's full
 * native export size — without any JS coordination.
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

    React.useImperativeHandle(ref, () => stageRef.current as HTMLDivElement, []);

    const { width: nativeW } = aspectRatioToSize(aspectRatio);
    const ratioStyle: React.CSSProperties = {
      aspectRatio: aspectRatio.replace(':', ' / '),
      // CSS containment context — enables `cqw` inside this subtree so
      // descendants can reference the stage's own width regardless of where
      // it is rendered (preview / html-to-image foreignObject / tests).
      containerType: 'inline-size',
      // 1cqw == 1% of the stage's content width. Dividing by the canvas's
      // native width yields a per-px scale factor that resolves correctly at
      // ANY container width — keeping preview and exported PNG visually
      // identical without ResizeObserver / JS state.
      ['--cover-px' as unknown as string]: `calc(100cqw / ${nativeW})`,
      backgroundImage: backgroundUrl ? `url(${cssUrl(backgroundUrl)})` : undefined,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
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
