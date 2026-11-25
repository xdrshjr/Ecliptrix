'use client';

/**
 * ProfileSwitcher — the browser's "users" (spec §4.2.2 / §4.6.3). One user = one
 * persistent Electron partition = one set of sign-ins; the Agent always uses the
 * ACTIVE user, and consent is per user.
 *
 * The menu opens INSIDE the Dock and overlaps the native view, so it carries
 * `role="menu"` + `data-native-occluder` (R1-5): the viewport swaps to a frozen
 * frame while it is open and the menu stays fully visible.
 */

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useBrowserBridge } from '@/contexts/BrowserWorkspaceContext';
import { bridgeCan } from '@/lib/api/browserBridge';
import { fillCopy } from '@/lib/browserWorkspaceCopy';
import type { BrowserProfileInfo } from '@/types/browserWorkspace';
import { ChevronDown, Pencil, Trash, User, X } from './browserIcons';
import { usePopover } from './usePopover';

export const MAX_PROFILES = 5;
const MAX_NAME = 24;

type Pending =
  | { kind: 'clear' | 'remove'; profile: BrowserProfileInfo }
  | { kind: 'rename'; profile: BrowserProfileInfo }
  | null;

export interface ProfileSwitcherProps {
  profiles: BrowserProfileInfo[];
  activeId: string;
  /** The Agent holds control: switching would pull the profile from under it. */
  agentBusy: boolean;
}

export default function ProfileSwitcher({ profiles, activeId, agentBusy }: ProfileSwitcherProps) {
  const { t } = useLocale();
  const copy = t.browserWorkspace;
  const getBridge = useBrowserBridge();
  const { open, setOpen, close, triggerRef, panelRef } = usePopover();
  const [pending, setPending] = useState<Pending>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const active = profiles.find((profile) => profile.id === activeId) ?? profiles[0];

  const fail = (code: string) => setError(
    code === 'duplicate_name' ? copy.profile.errorDuplicate
      : code === 'invalid_name' ? copy.profile.errorInvalid
        : code === 'profile_busy' ? copy.control.busyProfile : copy.profile.errorGeneric);
  const run = async (call: () => Promise<{ ok: boolean; code?: string } | undefined>) => {
    setError('');
    try {
      const result = await call();
      if (result && result.ok === false) { fail(result.code ?? ''); return false; }
      return true;
    } catch {
      fail('');
      return false;
    }
  };
  const bridge = getBridge();
  const canSwitch = bridgeCan(bridge, 'profiles.switch');
  const canCreate = bridgeCan(bridge, 'profiles.create') && profiles.length < MAX_PROFILES;

  const choose = async (profile: BrowserProfileInfo) => {
    if (profile.id === activeId) return close();
    if (agentBusy) return setError(copy.control.busyProfile);
    if (await run(() => bridge!.profiles!.switch!(profile.id))) close();
  };
  const submitDraft = async () => {
    const name = draft.trim().slice(0, MAX_NAME);
    if (!name) return;
    const ok = pending?.kind === 'rename'
      ? await run(() => bridge!.profiles!.rename!(pending.profile.id, name))
      : await run(() => bridge!.profiles!.create!({ name }));
    if (ok) { setDraft(''); setPending(null); }
  };
  const confirmPending = async () => {
    if (!pending || pending.kind === 'rename') return;
    const call = pending.kind === 'clear' ? bridge?.profiles?.clearData : bridge?.profiles?.remove;
    if (call && await run(() => call(pending.profile.id))) setPending(null);
  };

  return (
    <div className="bw-popover-anchor">
      <button ref={triggerRef} type="button" className="bw-btn bw-profile-trigger"
        aria-haspopup="menu" aria-expanded={open} title={copy.profile.menuLabel}
        aria-label={`${copy.profile.menuLabel}: ${active?.name ?? ''}`}
        onClick={() => { setOpen(!open); setPending(null); setError(''); }}>
        <span className="bw-dot" style={{ background: active?.color }} aria-hidden="true" />
        <span className="bw-profile-name">{active?.name ?? copy.profile.label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div ref={panelRef} role="menu" data-native-occluder="true" className="bw-popover"
          aria-label={copy.profile.menuLabel}>
          {profiles.map((profile) => (
            <div key={profile.id} className="bw-menu-row" role="none">
              <button type="button" role="menuitemradio" aria-checked={profile.id === activeId}
                className="bw-menu-item" disabled={!canSwitch}
                onClick={() => void choose(profile)}>
                <span className="bw-dot" style={{ background: profile.color }} aria-hidden="true" />
                <span className="bw-menu-main">
                  <span>{profile.name}</span>
                  <span className="bw-menu-sub">
                    {fillCopy(copy.profile.sitesCount, { n: profile.loginSiteCount })}
                  </span>
                </span>
              </button>
              {bridgeCan(bridge, 'profiles.rename') && (
                <button type="button" role="menuitem" className="bw-icon-btn"
                  title={copy.profile.rename} aria-label={`${copy.profile.rename}: ${profile.name}`}
                  onClick={() => { setPending({ kind: 'rename', profile }); setDraft(profile.name); }}>
                  <Pencil size={13} />
                </button>
              )}
              {bridgeCan(bridge, 'profiles.clearData') && (
                <button type="button" role="menuitem" className="bw-icon-btn"
                  title={copy.profile.clear} aria-label={`${copy.profile.clear}: ${profile.name}`}
                  onClick={() => setPending({ kind: 'clear', profile })}>
                  <Trash size={13} />
                </button>
              )}
              {profile.id !== 'default' && bridgeCan(bridge, 'profiles.remove') && (
                <button type="button" role="menuitem" className="bw-icon-btn"
                  title={copy.profile.remove} aria-label={`${copy.profile.remove}: ${profile.name}`}
                  onClick={() => setPending({ kind: 'remove', profile })}>
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          <p className="bw-menu-note"><User size={12} /> {copy.profile.agentUses}</p>
          {pending && pending.kind !== 'rename' && (
            <div className="bw-menu-confirm" role="group">
              <p>{fillCopy(pending.kind === 'clear' ? copy.profile.confirmClear : copy.profile.confirmRemove,
                { name: pending.profile.name })}</p>
              <div className="bw-menu-confirm-actions">
                <button type="button" role="menuitem" className="bw-btn bw-btn-danger"
                  onClick={() => void confirmPending()}>{copy.profile.confirm}</button>
                <button type="button" role="menuitem" className="bw-btn"
                  onClick={() => setPending(null)}>{copy.profile.cancel}</button>
              </div>
            </div>
          )}
          {canCreate || pending?.kind === 'rename' ? (
            <form className="bw-menu-create" onSubmit={(event) => { event.preventDefault(); void submitDraft(); }}>
              <input value={draft} maxLength={MAX_NAME} placeholder={copy.profile.namePlaceholder}
                aria-label={pending?.kind === 'rename' ? copy.profile.rename : copy.profile.create}
                className="bw-input" onChange={(event) => setDraft(event.target.value)} />
              <button type="submit" className="bw-btn" disabled={!draft.trim()}>
                {pending?.kind === 'rename' ? copy.profile.rename : copy.profile.create}
              </button>
            </form>
          ) : profiles.length >= MAX_PROFILES && (
            <p className="bw-menu-note">{copy.profile.limit}</p>
          )}
          {error && <p className="bw-menu-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
