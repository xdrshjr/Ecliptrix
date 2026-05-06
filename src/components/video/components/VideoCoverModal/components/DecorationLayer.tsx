'use client';

import React from 'react';

import type { CoverDecoration } from '../types';

interface DecorationLayerProps {
  decorations: CoverDecoration[];
}

/**
 * Renders normalized decorations as absolutely-positioned SVG/CSS shapes
 * sitting BEHIND text layers (the parent ``CoverPreview`` handles z-order
 * via DOM order). Coordinates are 0..1 against the canvas.
 */
export const DecorationLayer: React.FC<DecorationLayerProps> = ({ decorations }) => {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {decorations.map((d, idx) => (
        <DecorationShape key={idx} decoration={d} />
      ))}
    </div>
  );
};

interface DecorationShapeProps {
  decoration: CoverDecoration;
}

const DecorationShape: React.FC<DecorationShapeProps> = ({ decoration: d }) => {
  const common: React.CSSProperties = {
    position: 'absolute',
    left: `${(d.x ?? 0) * 100}%`,
    top: `${(d.y ?? 0) * 100}%`,
    width: `${(d.w ?? 0) * 100}%`,
    height: `${(d.h ?? 0) * 100}%`,
  };

  if (d.type === 'rect') {
    return (
      <span
        style={{
          ...common,
          background: d.fill ?? 'transparent',
          border: d.stroke ? `${d.stroke_width ?? 1}px solid ${d.stroke}` : undefined,
        }}
      />
    );
  }

  if (d.type === 'line') {
    return (
      <span
        style={{
          ...common,
          height: '2px',
          background: d.fill ?? d.stroke ?? 'currentColor',
        }}
      />
    );
  }

  // 'badge' — rounded pill with optional inline text
  return (
    <span
      style={{
        ...common,
        background: d.fill ?? 'rgba(0,0,0,0.4)',
        color: d.stroke ?? '#ffffff',
        borderRadius: '9999px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 'calc(40 * var(--cover-px, 0.001))',
        fontWeight: 700,
      }}
    >
      {d.text ?? ''}
    </span>
  );
};

export default DecorationLayer;
