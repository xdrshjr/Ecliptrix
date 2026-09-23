'use client';

/**
 * Track-level volume and mute for the selected audio clip (spec §3.7.2).
 *
 * 「轨道音量」 opens the timeline's own `VolumeSlider` popover for this track
 * (`showVolumeSliderForTrack`, the call the track header makes), so there is
 * one slider implementation with one undo behaviour. The button lists the
 * popover in `aria-controls`, which is how the slider recognises its owner
 * and lets a second click close it instead of racing its outside-click.
 * Labelled as TRACK volume on purpose: it is not a per-clip gain.
 */

import React, { useRef } from 'react';
import { Volume, VolumeMuted } from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import { toggleTrackMuteAction, useTimelineStore } from '../../timeline/store';
import type { TrackData } from '../../timeline/domain/types';
import { InspectorActions } from './InspectorPrimitives';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

export interface AudioClipControlsProps {
  track: TrackData;
  /** Non-null while the agent edit lock is held; explains the disabled state. */
  lockReason: string | null;
}

export function AudioClipControls({ track, lockReason }: AudioClipControlsProps) {
  const { t } = useLocale();
  const copy = t.workbench.inspector;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isSliderOpen = useTimelineStore((s) => s.showVolumeSlider?.trackId === track.id);
  const disabledReason = lockReason ?? (track.isLocked ? t.timeline.track.trackLocked : null);
  const isDisabled = disabledReason !== null;

  const toggleVolumeSlider = () => {
    const store = useTimelineStore.getState();
    if (isSliderOpen) {
      store.hideVolumeSlider();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    store.showVolumeSliderForTrack(track.id, {
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
  };

  const muteLabel = track.isMuted ? t.timeline.track.unmute : t.timeline.track.mute;

  return (
    <InspectorActions>
      <button
        ref={buttonRef}
        type="button"
        className="ws-btn"
        disabled={isDisabled}
        title={disabledReason ?? copy.trackVolume}
        aria-haspopup="dialog"
        aria-expanded={isSliderOpen}
        aria-controls={`volume-popover-${track.id}`}
        onClick={toggleVolumeSlider}
      >
        <Volume {...ICON} />
        {copy.trackVolume}
        <span className="ws-tabular">{`${track.volume}%`}</span>
      </button>
      <button
        type="button"
        className="ws-icon-btn"
        disabled={isDisabled}
        aria-pressed={track.isMuted}
        aria-label={muteLabel}
        title={disabledReason ?? muteLabel}
        onClick={() => toggleTrackMuteAction(() => useTimelineStore.getState(), track.id)}
      >
        {track.isMuted ? <VolumeMuted {...ICON} /> : <Volume {...ICON} />}
      </button>
    </InspectorActions>
  );
}
