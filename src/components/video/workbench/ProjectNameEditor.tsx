'use client';

/**
 * ProjectNameEditor — in-place rename of the open project (spec §3.2).
 * Click / Enter / F2 edits; Enter or blur commits; Esc cancels. A blank name
 * reverts without a request; a failed request reverts and is reported by the
 * caller's rejection (the top bar shows the error toast).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from './icons';
import { useLocale } from '@/contexts/LocaleContext';

export interface ProjectNameEditorProps {
  name: string;
  /** Rejects on failure; the editor then shows the previous name again. */
  onRename(name: string): Promise<void>;
  onRenameFailed(error: unknown): void;
}

const MAX_LENGTH = 100;

const ProjectNameEditor: React.FC<ProjectNameEditorProps> = ({ name, onRename, onRenameFailed }) => {
  const { t } = useLocale();
  const copy = t.workbench.topBar;
  const displayName = name || t.videoProjects.untitled;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const startEditing = () => {
    if (pendingName !== null) return;
    cancelledRef.current = false;
    setDraft(name);
    setIsEditing(true);
  };

  const commit = async () => {
    if (cancelledRef.current) return;
    setIsEditing(false);
    const next = draft.trim().slice(0, MAX_LENGTH);
    if (!next || next === name) return;
    setPendingName(next);
    try {
      await onRename(next);
    } catch (error) {
      onRenameFailed(error);
    } finally {
      setPendingName(null);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelledRef.current = true;
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="ws-input"
        style={{ maxWidth: 280, fontSize: 14, fontWeight: 600 }}
        value={draft}
        maxLength={MAX_LENGTH}
        aria-label={copy.renameLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={onKeyDown}
      />
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <button
        type="button"
        className="ws-btn ws-btn--ghost ws-project-name"
        style={{ color: 'var(--ws-text)', padding: '0 6px' }}
        title={copy.renameHint}
        aria-label={`${copy.renameLabel}: ${pendingName ?? displayName}`}
        onClick={startEditing}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            startEditing();
          }
        }}
      >
        {pendingName ?? displayName}
      </button>
      {pendingName !== null && <Loader2 size={14} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />}
    </span>
  );
};

export default ProjectNameEditor;
