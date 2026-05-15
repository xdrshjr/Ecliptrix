/**
 * Dev-only playback variant switcher.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase4/spec.md §3.2.6 / F3.
 *
 * Renders a three-state toggle that pins the playback variant to
 * `force-v2`, `force-legacy`, or `auto` (no override). The switch only
 * renders in dev / staging (`process.env.NODE_ENV !== 'production'`),
 * and clicking a button reloads the page because `playbackFlags` is
 * locked at the editor's first mount.
 *
 * Bundle safety: the early return is the *first* statement so a Next.js
 * tree-shake in production sees a function that immediately returns
 * null. R-P2-4 still recommends `next/dynamic({ ssr: false })` if a
 * future bundle audit shows it being shipped, but we keep this file
 * compatible with the simpler import path used by VideoPlayerPanel.
 */

import React, { useEffect, useState } from 'react';

import {
  readPlaybackVariantOverride,
  setPlaybackVariantOverride,
  type PlaybackVariantOverride,
} from '@/lib/playbackFlags';

const OPTIONS: ReadonlyArray<{ value: PlaybackVariantOverride; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'force-v2', label: 'Force v2' },
  { value: 'force-legacy', label: 'Force legacy' },
];

export interface PlaybackVariantSwitcherProps {
  className?: string;
  /** Inject for tests; defaults to ``window.location.reload``. */
  reloadImpl?: () => void;
}

export function PlaybackVariantSwitcher(
  props: PlaybackVariantSwitcherProps,
): React.ReactElement | null {
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  return <PlaybackVariantSwitcherInner {...props} />;
}

function PlaybackVariantSwitcherInner({
  className,
  reloadImpl,
}: PlaybackVariantSwitcherProps): React.ReactElement | null {
  const [current, setCurrent] = useState<PlaybackVariantOverride>('auto');

  useEffect(() => {
    setCurrent(readPlaybackVariantOverride() ?? 'auto');
  }, []);

  const onSelect = (next: PlaybackVariantOverride) => {
    if (next === current) return;
    setPlaybackVariantOverride(next === 'auto' ? null : next);
    setCurrent(next);
    const reload = reloadImpl ?? (() => window.location.reload());
    try {
      reload();
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={className}
      data-testid="playback-variant-switcher"
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: '4px 6px',
        background: 'rgba(0,0,0,0.45)',
        color: '#fff',
        borderRadius: 4,
        font: '11px/1.4 system-ui, sans-serif',
      }}
    >
      <span style={{ opacity: 0.8 }}>v2:</span>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          data-variant={opt.value}
          data-active={opt.value === current ? 'true' : 'false'}
          style={{
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: 3,
            border: 'none',
            background:
              opt.value === current ? 'rgba(255,255,255,0.85)' : 'transparent',
            color: opt.value === current ? '#000' : '#fff',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default PlaybackVariantSwitcher;
