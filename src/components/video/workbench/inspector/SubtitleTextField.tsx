'use client';

/**
 * Subtitle text editor of the properties page. Commits on blur or Ctrl+Enter
 * through `updateSubtitleTextAction` — the same undoable `UPDATE_ITEM` path as
 * the timeline's inline subtitle edit, so Ctrl+Z undoes it like any other
 * edit. A native <textarea> already keeps Space / Delete away from the
 * timeline shortcuts, so no key is intercepted here besides Ctrl+Enter.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useTimelineStore } from '../../timeline/store';
import { updateSubtitleTextAction } from '../../timeline/store/actions/updateItemFields';

export interface SubtitleTextFieldProps {
  itemId: string;
  text: string;
  /** Non-null disables the field; the text explains why. */
  disabledReason: string | null;
}

export function SubtitleTextField({ itemId, text, disabledReason }: SubtitleTextFieldProps) {
  const { t } = useLocale();
  const copy = t.workbench.inspector;
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const [draft, setDraft] = useState(text);
  const focusedRef = useRef(false);

  // Follow edits made elsewhere (timeline inline edit, undo) unless the user
  // is typing here right now.
  useEffect(() => {
    if (!focusedRef.current) setDraft(text);
  }, [text, itemId]);

  const commit = () => {
    if (draft === text) return;
    const applied = updateSubtitleTextAction(() => useTimelineStore.getState(), itemId, draft);
    // Refused (lock, locked track, clip gone): show the stored text again
    // rather than a value the project does not hold.
    if (!applied) setDraft(text);
  };

  // Selecting another clip remounts the inspector (keyed by item id) and can
  // unmount this field before its blur fires; keep the typed text anyway.
  const latestRef = useRef({ draft, text, itemId });
  latestRef.current = { draft, text, itemId };
  useEffect(() => () => {
    const latest = latestRef.current;
    if (latest.draft === latest.text) return;
    updateSubtitleTextAction(() => useTimelineStore.getState(), latest.itemId, latest.draft);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commit();
    }
  };

  return (
    <div className="ws-inspector-field">
      <label className="ws-inspector-label" htmlFor={fieldId}>
        {copy.subtitleText}
      </label>
      <textarea
        id={fieldId}
        className="ws-input ws-inspector-textarea"
        value={draft}
        rows={3}
        disabled={disabledReason !== null}
        title={disabledReason ?? undefined}
        aria-describedby={hintId}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={handleKeyDown}
      />
      <p id={hintId} className="ws-inspector-hint">
        {copy.subtitleTextHint}
      </p>
    </div>
  );
}
