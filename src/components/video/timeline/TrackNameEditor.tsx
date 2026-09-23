'use client';

import React, { useEffect, useRef, useState } from 'react';
import { TRACK_NAME_MAX_LENGTH } from './store/actions/trackActions';

interface TrackNameEditorProps {
  /** Text the input starts with — the name the header currently shows. */
  initialName: string;
  /** Accessible name of the input (i18n renameLabel). */
  ariaLabel: string;
  /** Enter or blur: the raw text; '' asks for the default name back. */
  onCommit: (name: string) => void;
  /** Esc: leave the name as it was. */
  onCancel: () => void;
}

/**
 * In-place track rename field. Enter / blur commit, Esc cancels.
 *
 * Keys are stopped here: the timeline treats Delete, Space, arrows and
 * Ctrl+Z as clip shortcuts, and a document-level listener would otherwise
 * see them after the input did.
 */
const TrackNameEditor: React.FC<TrackNameEditorProps> = ({
  initialName,
  ariaLabel,
  onCommit,
  onCancel,
}) => {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter / Esc unmount the field, which then blurs it: settle only once.
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const settle = (commit: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    // An untouched derived name ("主画面") must stay derived, or it would
    // freeze in the current locale.
    if (commit && value.trim() !== initialName.trim()) onCommit(value);
    else onCancel();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      settle(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      settle(false);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className="ws-track-name-input"
      value={value}
      maxLength={TRACK_NAME_MAX_LENGTH}
      aria-label={ariaLabel}
      data-testid="track-name-input"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => event.stopPropagation()}
      onBlur={() => settle(true)}
      // A press in the field must not start a lane pan or a clip gesture.
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
};

export default TrackNameEditor;
