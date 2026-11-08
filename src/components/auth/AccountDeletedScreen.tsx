'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useSession } from '@/contexts/SessionContext';

/**
 * Signed-out screen for an account that was deleted.
 *
 * Why this is not a banner on `LoginScreen`: a deleted account answers
 * `invalid_credentials` at sign-in on purpose (spec P1-5), so the ONLY trustworthy
 * place this fact can appear is the moment the main process reports that a session
 * died with `details.reason = account_deleted` — i.e. after the user has already
 * proved they owned the account. Rendering "this account was deleted" on the
 * sign-in form would answer "does this address exist?" for anyone who types it.
 *
 * The single action re-runs the gate, which lands on the ordinary login form
 * (`SessionContext.retry` re-reads the main-process status).
 */
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center h-11 px-4 rounded-lg border border-border bg-muted ' +
  'text-sm text-foreground transition-colors duration-150 ease-out hover:bg-accent ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';

export default function AccountDeletedScreen(): React.ReactElement {
  const { t } = useLocale();
  const { retry } = useSession();

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center overflow-y-auto px-6 py-10 bg-background">
      <div className="w-full max-w-[380px]">
        <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.02em] text-foreground">
          {t.auth.deleted.title}
        </h1>
        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-line"
        >
          {t.auth.deleted.body}
        </p>
        <button type="button" onClick={retry} className={`${SECONDARY_BUTTON} mt-6`}>
          {t.auth.deleted.signInOther}
        </button>
      </div>
    </div>
  );
}
