'use client';

/**
 * useBrowserCommands — the user-side commands of the Dock, each a thin call on
 * the typed bridge (spec §6.1). Every call is guarded per METHOD (F15): a main
 * process that predates a method turns the control into a no-op rather than a
 * click-time TypeError. Failures arrive as `{ok:false, code}` envelopes and are
 * deliberately ignored here — the authoritative state comes back via
 * `browser:state-changed`.
 */

import { useMemo } from 'react';
import { useBrowserBridge } from '@/contexts/BrowserWorkspaceContext';
import { fillCopy } from '@/lib/browserWorkspaceCopy';
import { sendPrefilledMessage } from '@/lib/video-editing-agent/prefilledMessage';
import type { BrowserApprovalDecision } from '@/types/browserWorkspace';

type Command = (...args: never[]) => unknown;

export function useBrowserCommands(shareTemplate: string) {
  const getBridge = useBrowserBridge();
  return useMemo(() => {
    const call = (name: string, ...args: unknown[]): Promise<unknown> => {
      const fn = (getBridge() as Record<string, Command | undefined> | null)?.[name];
      return typeof fn === 'function'
        ? Promise.resolve((fn as (...a: unknown[]) => unknown)(...args)).catch(() => undefined)
        : Promise.resolve(undefined);
    };
    return {
      navigate: (id: string, url: string) => call('navigate', id, url),
      back: (id: string) => call('back', id),
      forward: (id: string) => call('forward', id),
      reload: (id: string) => call('reload', id),
      stop: (id: string) => call('stop', id),
      openTab: (url?: string) => call('openTab', url ? { url } : {}),
      closeTab: (id: string) => call('closeTab', id),
      activateTab: (id: string) => call('activateTab', id),
      takeOver: () => call('takeOver'),
      returnControl: () => call('returnControl'),
      resolveApproval: (id: string, decision: BrowserApprovalDecision) =>
        call('resolveApproval', id, decision),
      /** "Let the Agent handle this page": a draft in the chat box, not a tab transfer (D-BW2-6). */
      async shareWithAgent(tabId: string, fallbackUrl: string) {
        const result = await call('shareUrl', tabId) as { ok?: boolean; url?: string } | undefined;
        const url = result?.ok && result.url ? result.url : fallbackUrl;
        if (url) sendPrefilledMessage(fillCopy(shareTemplate, { url }));
      },
    };
  }, [getBridge, shareTemplate]);
}
