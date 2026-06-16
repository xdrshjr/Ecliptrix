'use client';

import React, { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LoginScreen from '@/components/auth/LoginScreen';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Standalone login page.
 *
 * This page exists so that the http-client wrapper (`src/lib/api/http-client.ts`)
 * can redirect to `/login?reason=session-expired` on a 401 response without
 * landing the user on a 404. It now renders the full-window `LoginScreen` (the
 * same gate AuthGate surfaces in place) so the fallback route stays visually
 * consistent with the desktop login gate (spec §3 #7). `LoginScreen` owns its
 * own single `DesktopTitleBar` and session-expired notice, so this page must
 * not render a second one. It redirects back to `/` after a successful login.
 *
 * Created in Phase 4.5 of the unified-api-auth-refactor; switched from the old
 * closable `LoginModal` to `LoginScreen` in the desktop-login-gate fix.
 */
function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useAuth();

  // Narrow the free-form query string to the LoginScreen `reason` union; any
  // value other than the known notice falls back to no banner (evidence I).
  const reasonParam = searchParams.get('reason');
  const reason = reasonParam === 'session-expired' ? 'session-expired' : null;

  // Once authenticated, leave the login route.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, router]);

  return <LoginScreen reason={reason} />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
