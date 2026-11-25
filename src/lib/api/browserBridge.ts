/**
 * Typed wrapper around `window.ecliptrixDesktop.browser` (spec §6.1, F15).
 *
 * Why per-METHOD detection: an older main process can ship the bridge object
 * without a newer method (e.g. `revokeConsent`). A control for a missing method
 * must hide, not throw at click time — the same rule as the account centre.
 * No network call and no token ever lives here; the only HTTP in this file is
 * the BFF call that saves a page resource into the media library.
 */

import { http } from '@/lib/api/http-client';
import type {
  BrowserWorkspaceBridge,
  BrowserSaveResourceRequest,
} from '@/types/browserWorkspace';
import type { ResearchMaterial } from '@/types/webResearch';

type DesktopWithBrowser = { browser?: Partial<BrowserWorkspaceBridge> };

/** The preload channel, or null in a plain browser / on a build that predates it. */
export function getBrowserBridge(): Partial<BrowserWorkspaceBridge> | null {
  if (typeof window === 'undefined') return null;
  const desktop = window.ecliptrixDesktop as unknown as DesktopWithBrowser | undefined;
  const bridge = desktop?.browser;
  if (!bridge || typeof bridge.state !== 'function') return null;
  return bridge;
}

/** True when the bridge exposes `method` as a function (nested: `profiles.list`). */
export function bridgeCan(
  bridge: Partial<BrowserWorkspaceBridge> | null,
  method: keyof BrowserWorkspaceBridge | `profiles.${keyof BrowserWorkspaceBridge['profiles']}`,
): boolean {
  if (!bridge) return false;
  if (method.startsWith('profiles.')) {
    const name = method.slice('profiles.'.length) as keyof BrowserWorkspaceBridge['profiles'];
    return typeof bridge.profiles?.[name] === 'function';
  }
  return typeof bridge[method as keyof BrowserWorkspaceBridge] === 'function';
}

const BFF = '/api/browser-workspace';

interface SaveResourceEnvelope {
  success?: boolean;
  data?: { material?: ResearchMaterial } & Partial<ResearchMaterial>;
  material?: ResearchMaterial;
}

/** Thrown when the backend answers but without a usable material. */
export class BrowserSaveError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BrowserSaveError';
  }
}

/**
 * Right-click "save to the media library": the main process only emits
 * `{tabId,url,kind}`; this call goes renderer → BFF → backend (R2-2), where the
 * bytes are fetched through the tab's own session (cookies, Referer).
 */
export async function saveBrowserResource(
  request: BrowserSaveResourceRequest,
  projectId?: string,
): Promise<ResearchMaterial> {
  const result = await http.post<SaveResourceEnvelope>(
    `${BFF}/resources/save`,
    { tab_id: request.tabId, url: request.url, kind: request.kind,
      ...(projectId ? { project_id: projectId } : {}) },
    { timeoutMs: 60000, retries: 0 },
  );
  const material = result.data?.material ?? result.material
    ?? (result.data && 'local_url' in result.data ? (result.data as ResearchMaterial) : undefined);
  if (!material) throw new BrowserSaveError('save_failed');
  return material;
}

export interface BrowserWorkspaceDiagnostics {
  reachable: boolean;
  version?: string;
  profiles?: number;
  tabs?: number;
}

/** GET /state — diagnostics only; carries no token and no URL (spec §4.3.4). */
export async function getBrowserDiagnostics(): Promise<BrowserWorkspaceDiagnostics> {
  const result = await http.get<{ data?: BrowserWorkspaceDiagnostics } & BrowserWorkspaceDiagnostics>(
    `${BFF}/state`, { timeoutMs: 3000, retries: 0 });
  return result.data ?? result;
}
