'use client';

import React from 'react';

interface EmptyTrackStripProps {
  /** 「＋ 添加图片」 or 「＋ 添加字幕」. */
  label: string;
  /** Accessible / tooltip text (i18n expandEmpty). */
  title: string;
  onExpand: () => void;
}

/**
 * The 20px strip a folded empty image / subtitle lane shows (spec R2 §3.10).
 *
 * Clicking only opens the lane. It deliberately does not start subtitle
 * transcription: that is slow, and stays behind the toolbar's own
 * 「添加字幕」 button.
 */
const EmptyTrackStrip: React.FC<EmptyTrackStripProps> = ({ label, title, onExpand }) => (
  <button
    type="button"
    className="ws-empty-track-strip"
    data-testid="empty-track-strip"
    title={title}
    aria-label={`${label} — ${title}`}
    onClick={onExpand}
    // The lane container pans on a press; this press is a click.
    onMouseDown={(event) => event.stopPropagation()}
  >
    {label}
  </button>
);

export default EmptyTrackStrip;
