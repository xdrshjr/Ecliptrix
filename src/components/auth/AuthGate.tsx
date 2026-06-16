'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isDesktop } from '@/lib/desktop/isDesktop';
import LoginScreen from '@/components/auth/LoginScreen';

interface AuthGateProps {
  /** The protected application body (page-level title bar + app). */
  children: React.ReactNode;
}

/** Neutral, SSR-identical boot placeholder — nothing but the themed background
 *  so the server frame and the first client frame match exactly (spec §2.1/R2). */
function BootPlaceholder() {
  return <div className="fixed inset-0 bg-background" />;
}

/**
 * Mandatory login gate for the packaged desktop app (spec §2.1, §2.7).
 *
 * Decision order:
 *   1. Before client mount → BootPlaceholder. `isDesktop()` is always false
 *      during SSR, so we must wait for hydration before branching on it; both
 *      the server frame and the first client frame render the neutral
 *      placeholder, avoiding a hydration mismatch (spec §2.6 / R2).
 *   2. Web (not the desktop shell) → render children unchanged. The web app
 *      keeps its landing-page + login-modal flow; it is never gated (D2).
 *   3. Desktop while auth is still loading → BootPlaceholder.
 *   4. Desktop and unauthenticated → the full-window LoginScreen, which REPLACES
 *      the whole HomePage subtree (including the page-level DesktopTitleBar) so
 *      no data components mount and exactly one title bar exists (spec §2.7).
 *   5. Otherwise (authenticated) → children.
 */
export default function AuthGate({ children }: AuthGateProps) {
  const [mounted, setMounted] = useState(false);
  const { isAuthenticated, isLoading } = useAuth();
  const [reason, setReason] = useState<'session-expired' | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // A 401 anywhere clears the session and dispatches this event; the desktop
  // path does NOT redirect to /login (http-client returns early), so the gate
  // surfaces in place. Remember the cause so the LoginScreen shows the
  // "session expired" notice (spec §2.4). Cleared once re-authenticated.
  useEffect(() => {
    const onExpired = () => setReason('session-expired');
    window.addEventListener('ecliptrix:session-expired', onExpired);
    return () => window.removeEventListener('ecliptrix:session-expired', onExpired);
  }, []);

  useEffect(() => {
    if (isAuthenticated) setReason(null);
  }, [isAuthenticated]);

  if (!mounted) return <BootPlaceholder />;
  if (!isDesktop()) return <>{children}</>;
  if (isLoading) return <BootPlaceholder />;
  if (!isAuthenticated) return <LoginScreen reason={reason} />;
  return <>{children}</>;
}
