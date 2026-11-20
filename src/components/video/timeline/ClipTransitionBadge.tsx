'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useTimelineStore, setClipTransitionAction } from './store';
import { ClipContextMenu } from './ClipContextMenu';
import type { SequenceTransitionData } from './domain/types';

/**
 * Narrower than this the two 12px markers would sit on top of each other (and
 * be impossible to hit), so the badge steps aside rather than overlapping.
 */
const MIN_CLIP_WIDTH_PX = 40;

type Side = 'in' | 'out';

interface ClipTransitionBadgeProps {
  itemId: string;
  transitionIn?: SequenceTransitionData;
  transitionOut?: SequenceTransitionData;
  /** Rendered width of the clip; very short clips show no badge. */
  widthPx: number;
  isTrackLocked: boolean;
}

interface MenuState { side: Side; x: number; y: number }

const RAMP_PATH: Record<Side, string> = {
  in: 'M1 11 L11 11 L11 1 Z',
  out: 'M1 1 L1 11 L11 11 Z',
};

/**
 * Bottom-edge markers for a clip's fade-in / fade-out, with a small menu to
 * remove them. The editing agent can write transitions but the toolbar has no
 * "add transition" flow yet, so this is where a user SEES and REVERTS them.
 * Bottom placement keeps clear of the camera badge (top-right) and the
 * missing-material badge (top-left). Writes go through
 * {@link setClipTransitionAction}: one undo step, refused while locked.
 */
export default function ClipTransitionBadge(props: ClipTransitionBadgeProps) {
  const { itemId, transitionIn, transitionOut, widthPx, isTrackLocked } = props;
  const { t } = useLocale();
  const isAgentLocked = useTimelineStore(state => state.externalEditLock !== null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  if ((!transitionIn && !transitionOut) || widthPx < MIN_CLIP_WIDTH_PX) return null;

  const labels = t.timeline.transition;
  const isDisabled = isTrackLocked || isAgentLocked;
  const clear = (patch: { in?: null; out?: null }) =>
    setClipTransitionAction(() => useTimelineStore.getState(), [itemId], patch);

  const renderMarker = (side: Side, transition: SequenceTransitionData | undefined) => {
    if (!transition) return null;
    const text = (side === 'in' ? labels.badgeIn : labels.badgeOut)
      .replace('{seconds}', String(Number(transition.duration.toFixed(2))));
    const title = isAgentLocked ? `${text} — ${labels.lockedHint}` : text;
    return (
      <button
        type="button"
        data-testid={`clip-transition-${side}`}
        disabled={isDisabled}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ side, x: rect.left, y: rect.bottom });
        }}
        className={`absolute bottom-1 z-10 flex h-3.5 w-3.5 items-center justify-center rounded bg-black/60
          text-white backdrop-blur-sm transition-colors hover:bg-black/80 disabled:cursor-not-allowed
          disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white
          ${side === 'in' ? 'left-1' : 'right-1'}`}
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <path d={RAMP_PATH[side]} />
        </svg>
      </button>
    );
  };

  const menuActions = menu && [
    { label: menu.side === 'in' ? labels.clearIn : labels.clearOut,
      run: () => clear(menu.side === 'in' ? { in: null } : { out: null }) },
    ...(transitionIn && transitionOut
      ? [{ label: labels.clearAll, run: () => clear({ in: null, out: null }) }] : []),
  ];

  return (
    <>
      {renderMarker('in', transitionIn)}
      {renderMarker('out', transitionOut)}
      {menu && menuActions && (
        <ClipContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} actions={menuActions} />
      )}
    </>
  );
}
