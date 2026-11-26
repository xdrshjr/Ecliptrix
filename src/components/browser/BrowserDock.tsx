'use client';

/**
 * BrowserDock — the browser panel (spec §4.6.3). Overlays the area above the
 * timeline, hugging the app's vertical task bar, instead of pushing the preview
 * around (no canvas reflow, no playback jitter). The page itself is a native view
 * glued to the viewport placeholder (BrowserViewport); everything else here is DOM.
 *
 * The Agent is visible three ways: the page-side cursor (main process), the
 * breathing ring around the stage while it holds control, and the activity rail.
 */

import React, { useEffect, useRef } from 'react';
import '@/styles/browser-workspace.css';
import { useLocale } from '@/contexts/LocaleContext';
import { useBrowserDockActions, useBrowserWorkspace } from '@/contexts/BrowserWorkspaceContext';
import { fillCopy } from '@/lib/browserWorkspaceCopy';
import { openSettings } from '@/lib/setupEvents';
import { selectActiveTab, selectDisabledReason } from '@/lib/browserWorkspaceStore';
import AgentActivityRail from './AgentActivityRail';
import ApprovalBanner from './ApprovalBanner';
import BrowserStartPage from './BrowserStartPage';
import BrowserTabStrip from './BrowserTabStrip';
import BrowserToolbar from './BrowserToolbar';
import BrowserUnavailable from './BrowserUnavailable';
import BrowserViewport from './BrowserViewport';
import LoginSitesPanel from './LoginSitesPanel';
import ProfileSwitcher from './ProfileSwitcher';
import { Globe, Maximize2, Minimize2, X } from './browserIcons';
import { useBrowserCommands } from './useBrowserCommands';
import { useBrowserPrefs } from './useBrowserPrefs';
import { useDockPhase, useDockResize } from './useDockLifecycle';

const DEFAULT_MAX_TABS = 8;
const isBlank = (url: string | undefined) => !url || url === 'about:blank';

export default function BrowserDock() {
  const { t } = useLocale();
  const copy = t.browserWorkspace;
  const snapshot = useBrowserWorkspace();
  const actions = useBrowserDockActions();
  const dockRef = useRef<HTMLElement>(null);
  const { mounted, settled } = useDockPhase(snapshot.dockOpen);
  const prefs = useBrowserPrefs(snapshot.dockOpen);
  const commands = useBrowserCommands(copy.toolbar.shareDraft);
  const resize = useDockResize(dockRef, snapshot.dockWidth, actions.setWidth);
  const workspace = snapshot.workspace;
  const tab = selectActiveTab(snapshot);

  // Opening the Dock on an empty workspace gives the user a tab to type into.
  const needsFirstTab = snapshot.dockOpen && !!workspace && workspace.available
    && workspace.tabs.length === 0;
  useEffect(() => { if (needsFirstTab) void commands.openTab(); }, [needsFirstTab, commands]);

  if (!snapshot.hasBridge || !mounted || workspace?.locked) return null;
  const unavailable = selectDisabledReason(snapshot);
  const holder = workspace?.control.holder ?? 'idle';
  const approval = workspace?.approvals.find((item) => item.status === 'pending');
  const activeProfile = workspace?.profiles.find((p) => p.id === workspace.activeProfileId);
  const blank = isBlank(tab?.url);
  const style = snapshot.dockWidth && !snapshot.expanded
    ? ({ '--bw-dock-w': `${snapshot.dockWidth}px` } as React.CSSProperties) : undefined;

  return (
    <aside
      ref={dockRef}
      className="bw-dock"
      role="complementary"
      aria-label={copy.dock.ariaLabel}
      data-browser-dock-root=""
      data-phase={snapshot.dockOpen ? (settled ? 'open' : 'opening') : 'closing'}
      data-expanded={snapshot.expanded || undefined}
      data-agent={holder === 'agent' || undefined}
      style={style}
    >
      <header className="bw-header">
        <span className="bw-title"><Globe size={15} />{copy.title}</span>
        {workspace && (
          <ProfileSwitcher profiles={workspace.profiles} activeId={workspace.activeProfileId}
            agentBusy={holder === 'agent'} />
        )}
        {workspace && (
          <LoginSitesPanel cookieTtlDays={prefs.sessionCookieTtlDays}
            activeProfileId={workspace.activeProfileId} />
        )}
        <span className="bw-spacer" />
        <button type="button" className="bw-icon-btn" aria-pressed={snapshot.expanded}
          aria-label={snapshot.expanded ? copy.dock.collapse : copy.dock.expand}
          title={snapshot.expanded ? copy.dock.collapse : copy.dock.expand}
          onClick={() => actions.setExpanded(!snapshot.expanded)}>
          {snapshot.expanded ? <Minimize2 /> : <Maximize2 />}
        </button>
        <button type="button" className="bw-icon-btn" aria-label={copy.dock.close}
          title={copy.dock.close} onClick={actions.close}>
          <X size={15} />
        </button>
      </header>

      {unavailable ? (
        <BrowserUnavailable reason={unavailable}
          onOpenSettings={unavailable === 'disabled' ? () => openSettings('browser') : undefined} />
      ) : (
        <>
          <BrowserTabStrip tabs={workspace?.tabs ?? []} activeTabId={workspace?.activeTabId ?? null}
            maxTabs={DEFAULT_MAX_TABS} onActivate={(id) => void commands.activateTab(id)}
            onClose={(id) => void commands.closeTab(id)} onNewTab={() => void commands.openTab()} />
          <BrowserToolbar tab={tab} holder={holder} searchEngine={prefs.searchEngine}
            onNavigate={(url) => tab && void commands.navigate(tab.id, url)}
            onBack={() => tab && void commands.back(tab.id)}
            onForward={() => tab && void commands.forward(tab.id)}
            onReload={() => tab && void commands.reload(tab.id)}
            onStop={() => tab && void commands.stop(tab.id)}
            onTakeOver={() => void commands.takeOver()}
            onReturnControl={() => void commands.returnControl()}
            onShareWithAgent={() => tab && void commands.shareWithAgent(tab.id, tab.url)} />
          {approval && (
            <ApprovalBanner approval={approval} profileName={activeProfile?.name ?? ''}
              onResolve={(id, decision) => void commands.resolveApproval(id, decision)} />
          )}
          {!snapshot.privacyAcked && (
            <div className="bw-privacy" data-native-inflow="true" role="note">
              <span>{fillCopy(copy.privacy.banner, { days: prefs.sessionCookieTtlDays })}</span>
              <button type="button" className="bw-btn" onClick={actions.ackPrivacy}>
                {copy.privacy.gotIt}
              </button>
            </div>
          )}
          <div className="bw-stage" data-agent={holder === 'agent' || undefined}>
            {tab && blank ? (
              <BrowserStartPage searchEngine={prefs.searchEngine}
                onNavigate={(url) => void commands.navigate(tab.id, url)} />
            ) : (
              <BrowserViewport tab={tab} live={settled && !!tab} locked={false}
                onReload={() => tab && void commands.reload(tab.id)}
                onBack={() => tab && void commands.back(tab.id)} />
            )}
          </div>
          <AgentActivityRail entries={workspace?.activity ?? []} />
        </>
      )}
      {!snapshot.expanded && (
        <div className="bw-resizer" role="separator" aria-orientation="vertical" tabIndex={0}
          aria-label={copy.dock.resize} data-dragging={resize.dragging || undefined}
          {...resize.handleProps} />
      )}
    </aside>
  );
}
