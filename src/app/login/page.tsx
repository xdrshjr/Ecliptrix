'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LoginModal from '@/components/LoginModal';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Standalone login page.
 *
 * This page exists so that the http-client wrapper (`src/lib/api/http-client.ts`)
 * can redirect to `/login?reason=session-expired` on a 401 response without
 * landing the user on a 404. The page mounts the existing `LoginModal` in an
 * always-open state and redirects back to `/` after a successful login.
 *
 * Created in Phase 4.5 of the unified-api-auth-refactor.
 */
function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useAuth();

  // Always open while on this page; closing simply navigates home.
  const [open, setOpen] = useState(true);

  const reason = searchParams.get('reason');

  // Once authenticated, leave the login route.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleClose = () => {
    setOpen(false);
    router.push('/');
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      {reason === 'session-expired' && (
        <div
          role="alert"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-md bg-yellow-100 text-yellow-900 text-sm shadow"
        >
          会话已过期，请重新登录 / Your session has expired. Please log in again.
        </div>
      )}
      <LoginModal isOpen={open} onClose={handleClose} />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
