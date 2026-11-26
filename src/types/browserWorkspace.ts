/**
 * Browser workspace shared contract (spec §6.1 / §7, docs/plans/agent-browser-workspace/spec.md).
 *
 * Why this file exists: the main process (desktop/main/browserWorkspace/stateStore.js, JSDoc
 * references these names), the renderer mirror and the IPC bridge all speak ONE JSON shape.
 * The main process owns the truth; the renderer only mirrors it. Never put tokens, cookie
 * values or page text in anything declared here (spec §6.1: "no channel returns them").
 */

export type BrowserControlHolder = 'idle' | 'agent' | 'user';
export type BrowserTabOwner = 'user' | 'agent';
export type BrowserTabSecurity = 'https' | 'http' | 'cert_error' | 'blocked';
export type BrowserApprovalKind = 'consent' | 'risky_action' | 'handoff';
export type BrowserApprovalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'completed'
  | 'expired'
  | 'cancelled';
export type BrowserApprovalDecision = 'approve' | 'approve_scope' | 'deny';

export interface BrowserProfileInfo {
  id: string;
  name: string;
  color: string;
  loginSiteCount: number;
  /** Per-user Agent consent (spec §4.2.2, R1-4). Truth lives in the main process only. */
  agentConsent: boolean;
}

export interface BrowserTabInfo {
  id: string;
  owner: BrowserTabOwner;
  origin?: 'agent';
  url: string;
  title: string;
  faviconUrl?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  audible: boolean;
  crashed: boolean;
  secure: BrowserTabSecurity;
}

export interface BrowserControlState {
  holder: BrowserControlHolder;
  since: number;
}

export interface BrowserApproval {
  id: string;
  kind: BrowserApprovalKind;
  runId: string;
  reason: string;
  target?: { host: string; label: string };
  createdAt: number;
  expiresAt: number;
  status: BrowserApprovalStatus;
  /**
   * Login handoff only: the main process thinks the sign-in is done (new session cookie, off the
   * login page, no password box). A suggestion — the user still presses "完成". Absent on an
   * older main process = false.
   */
  suggestComplete?: boolean;
}

export type BrowserActivityKind =
  | 'open'
  | 'read'
  | 'click'
  | 'fill'
  | 'press'
  | 'scroll'
  | 'wait'
  | 'save_image'
  | 'article'
  | 'handoff'
  | 'close'
  | 'notice';

export interface BrowserActivityEntry {
  id: string;
  ts: number;
  kind: BrowserActivityKind;
  /** ≤80 chars, never contains typed text (only "输入 N 个字符"). */
  label: string;
  status: 'running' | 'ok' | 'error';
  durationMs?: number;
  errorCode?: string;
  /** Tab the entry belongs to: clicking an article row calls `activateTab(tabId)`. */
  tabId?: string;
  /**
   * Present on `kind: 'article'` rows only (agent-browser-article-reading §4.8).
   * `publishedAt` is `null` when the page declared no publication time — the UI says
   * so instead of hiding the row, because the user has a right to know it is missing.
   */
  articleMeta?: {
    title: string;
    site: string;
    publishedAt: string | null;
    totalBlocks: number;
    chars: number;
  };
}

export interface BrowserWorkspaceState {
  v: 1;
  available: boolean;
  enabled: boolean;
  agentEnabled: boolean;
  activeProfileId: string;
  profiles: BrowserProfileInfo[];
  tabs: BrowserTabInfo[];
  activeTabId: string | null;
  control: BrowserControlState;
  approvals: BrowserApproval[];
  /** ≤100 entries, newest last. */
  activity: BrowserActivityEntry[];
  /** True while the identity gate is not "passed" (spec §4.2.1): Dock must not render. */
  locked: boolean;
}

export interface BrowserViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserLoginSite {
  host: string;
  cookies: number;
}

/** Result envelope of every `browser:*` IPC call: failures resolve, never reject. */
export type BrowserBridgeResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; code: string };

/** `browser:save-resource-request` event payload (spec §6.1, R2-2). */
export interface BrowserSaveResourceRequest {
  tabId: string;
  url: string;
  kind: 'image' | 'media';
}

export interface BrowserWorkspaceBridge {
  state(): Promise<BrowserWorkspaceState>;
  onStateChanged(cb: (state: BrowserWorkspaceState) => void): () => void;
  onActivity(cb: (entry: BrowserActivityEntry) => void): () => void;
  onSaveResourceRequest(cb: (req: BrowserSaveResourceRequest) => void): () => void;
  /** Keys pressed while a native page view owns focus (main process `viewShortcuts`). Optional: older main processes lack them. */
  onShortcut?(cb: (payload: { action: string }) => void): () => void;
  onFocusAddress?(cb: () => void): () => void;
  onToggleDock?(cb: () => void): () => void;
  openTab(args?: { url?: string; background?: boolean }): Promise<BrowserBridgeResult<{ tabId: string }>>;
  closeTab(id: string): Promise<BrowserBridgeResult>;
  activateTab(id: string): Promise<BrowserBridgeResult>;
  reorderTabs(ids: string[]): Promise<BrowserBridgeResult>;
  navigate(id: string, input: string): Promise<BrowserBridgeResult>;
  back(id: string): Promise<BrowserBridgeResult>;
  forward(id: string): Promise<BrowserBridgeResult>;
  reload(id: string): Promise<BrowserBridgeResult>;
  stop(id: string): Promise<BrowserBridgeResult>;
  setBounds(rect: BrowserViewRect | null): Promise<BrowserBridgeResult>;
  setVisible(visible: boolean): Promise<BrowserBridgeResult>;
  captureFrozen(): Promise<BrowserBridgeResult<{ dataUrl: string }>>;
  profiles: {
    list(): Promise<BrowserBridgeResult<{ profiles: BrowserProfileInfo[] }>>;
    create(args: { name: string }): Promise<BrowserBridgeResult<{ id: string }>>;
    rename(id: string, name: string): Promise<BrowserBridgeResult>;
    switch(id: string): Promise<BrowserBridgeResult>;
    clearData(id: string): Promise<BrowserBridgeResult>;
    remove(id: string): Promise<BrowserBridgeResult>;
  };
  loginSites(): Promise<BrowserBridgeResult<{ sites: BrowserLoginSite[] }>>;
  removeSite(host: string): Promise<BrowserBridgeResult>;
  takeOver(): Promise<BrowserBridgeResult>;
  returnControl(): Promise<BrowserBridgeResult>;
  resolveApproval(id: string, decision: BrowserApprovalDecision): Promise<BrowserBridgeResult>;
  shareUrl(id: string): Promise<BrowserBridgeResult<{ url: string }>>;
  revokeConsent(profileId: string): Promise<BrowserBridgeResult>;
}
