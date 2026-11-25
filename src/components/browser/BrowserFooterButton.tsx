'use client';

/**
 * BrowserFooterButton — the FIRST button of the footer toolbar (spec §4.6.1/§4.6.2).
 *
 * Four visual states: idle · open · agent-active (orbiting clay arc + "Agent"
 * label) · needs-user (amber hand + slow pulse). It keeps animating when the Dock
 * is closed and when the toolbar is compact (labels hidden, motion kept — D3), and
 * a bubble tells the user the Agent is browsing in the background. Renders
 * nothing when the desktop bridge is absent (browser debugging path).
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/contexts/LocaleContext';
import { useBrowserBridge, useBrowserDockActions, useBrowserWorkspace } from '@/contexts/BrowserWorkspaceContext';
import {
  selectAgentInBackground, selectButtonState, selectDisabledReason, selectNeedsUser,
} from '@/lib/browserWorkspaceStore';
import { Globe, Hand } from './browserIcons';

const BUBBLE_MS = 6000;
const LIVE_DEBOUNCE_MS = 800;
const BUBBLE_GAP_PX = 6;

/** Debounced screen-reader text for state changes (a burst announces once). */
function useLiveAnnouncement(state: string, agentText: string, idleText: string, needsText: string) {
  const [text, setText] = useState('');
  const wasActive = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (state === 'agent-active') { wasActive.current = true; setText(agentText); }
      else if (state === 'needs-user') { wasActive.current = true; setText(needsText); }
      else if (wasActive.current) { wasActive.current = false; setText(idleText); }
    }, LIVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state, agentText, idleText, needsText]);
  return text;
}

export default function BrowserFooterButton() {
  const { t } = useLocale();
  const copy = t.browserWorkspace;
  const snapshot = useBrowserWorkspace();
  const actions = useBrowserDockActions();
  const getBridge = useBrowserBridge();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [bubblePos, setBubblePos] = useState<{ left: number; bottom: number } | null>(null);

  const state = selectButtonState(snapshot);
  const disabledReason = selectDisabledReason(snapshot);
  const needsUser = selectNeedsUser(snapshot);
  const background = selectAgentInBackground(snapshot);
  const showBubble = !snapshot.dockOpen && (background || needsUser);
  const pending = snapshot.workspace?.approvals.find((a) => a.status === 'pending');
  const bubbleText = needsUser ? copy.footer.needsUserBubble : copy.footer.agentBackground;
  const liveText = useLiveAnnouncement(
    state, copy.footer.liveRegionAgent, copy.footer.liveRegionIdle,
    pending?.reason ?? copy.footer.needsUser);

  // The bubble appears on each transition into a "background" state and fades
  // after a few seconds — except while the user is needed, which stays visible.
  useEffect(() => {
    if (!showBubble) { setBubbleVisible(false); return undefined; }
    setBubbleVisible(true);
    if (needsUser) return undefined;
    const timer = window.setTimeout(() => setBubbleVisible(false), BUBBLE_MS);
    return () => window.clearTimeout(timer);
  }, [showBubble, needsUser]);

  useEffect(() => {
    if (!bubbleVisible) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setBubblePos({ left: rect.left, bottom: window.innerHeight - rect.top + BUBBLE_GAP_PX });
  }, [bubbleVisible]);

  if (!snapshot.hasBridge) return null;

  const open = () => {
    const agentTab = snapshot.workspace?.tabs.find((tab) => tab.owner === 'agent');
    if (!snapshot.dockOpen && (background || needsUser) && agentTab) {
      void getBridge()?.activateTab?.(agentTab.id);
    }
    actions.toggle();
    setBubbleVisible(false);
  };
  const onClick = () => { if (!disabledReason) open(); };

  const disabledTitle = disabledReason === 'disabled'
    ? copy.footer.disabledDisabled : copy.footer.disabledUnavailable;
  const title = disabledReason ? disabledTitle
    : state === 'agent-active' ? copy.footer.agentActive
      : state === 'needs-user' ? copy.footer.needsUser : copy.footer.title;
  const label = state === 'agent-active' ? copy.footer.labelAgent
    : state === 'needs-user' ? copy.footer.needsUser : copy.footer.label;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="ws-footer-btn bw-footer-btn"
        data-bw-state={disabledReason ? 'disabled' : state}
        aria-pressed={snapshot.dockOpen}
        aria-disabled={disabledReason ? true : undefined}
        aria-label={title}
        title={title}
        tabIndex={-1}
        onClick={onClick}
      >
        <span className="bw-footer-icon">
          {state === 'needs-user' ? <Hand /> : <Globe />}
        </span>
        <span className="ws-footer-label" aria-hidden="true">
          {label}
          {state === 'agent-active' && <span className="bw-dots" />}
        </span>
        {state === 'needs-user' && <span className="bw-footer-badge" aria-hidden="true" />}
      </button>
      <span className="bw-sr-only" role="status" aria-live="polite">{liveText}</span>
      {bubbleVisible && showBubble && typeof document !== 'undefined' && createPortal(
        <button type="button" className="bw-bubble" data-native-occluder="true"
          style={bubblePos ?? { visibility: 'hidden' }}
          onClick={open}>
          {bubbleText}
        </button>,
        document.body,
      )}
    </>
  );
}
