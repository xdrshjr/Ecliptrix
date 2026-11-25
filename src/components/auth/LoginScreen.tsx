'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useSession } from '@/contexts/SessionContext';
import {
  authReasonCopyKey,
  clientDownloadUrl,
  compareSemver,
  downloadFailureCopyKey,
  type AuthReason,
  type AuthStatus,
} from '@/lib/api/authBridge';
import ServerLoginForm from './ServerLoginForm';
import RegisterForm from './RegisterForm';
import ResetPasswordForm from './ResetPasswordForm';
import LocalAdminForm from './LocalAdminForm';

type AuthView = 'login' | 'register' | 'reset';

interface LoginScreenProps {
  /** `AuthStatus.reason` (or the `?reason=` hint) — copy only, never state. */
  reason?: AuthReason | null;
}

const TITLE = 'text-[28px] leading-[34px] font-semibold tracking-[-0.02em] text-foreground';
const SECONDARY_BUTTON =
  'inline-flex items-center justify-center h-11 px-4 rounded-lg border border-border bg-muted ' +
  'text-sm text-foreground transition-colors duration-150 ease-out hover:bg-accent ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';
/** The download button dims when the account origin is unknown (Rule 3). */
const DOWNLOAD_BUTTON =
  `${SECONDARY_BUTTON} disabled:opacity-60 disabled:cursor-not-allowed`;

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

/**
 * Version gate: a stricter `minClientVersion` must be visible before the form.
 *
 * Both sides must be comparable. `status.appVersion` is empty when the main
 * process could not read the version, and comparing `''` as `0.0.0` would replace
 * the whole form with "please download a newer version" — a self-lock, since the
 * main process's own `compareVersions` treats unparsable input as "not old" and
 * the server skips the gate for an empty `clientVersion`.
 */
function isClientOutdated(status: AuthStatus): boolean {
  const minimum = status.server?.minClientVersion ?? '';
  if (!minimum || !status.appVersion) return false;
  return compareSemver(status.appVersion, minimum) < 0;
}

/**
 * 120–160ms `ease-out` view swap (opacity + 4px rise), per spec §2.8.
 * `motion-reduce` zeroes it out; the first view is rendered visible so the
 * login screen never starts as a blank rectangle.
 */
function ViewTransition({ viewKey, children }: { viewKey: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(false);
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [viewKey]);

  return (
    <div
      className="transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none motion-reduce:duration-0"
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(4px)' }}
    >
      {children}
    </div>
  );
}

function BrandPanel() {
  const { t } = useLocale();
  return (
    <div className="hidden lg:flex flex-1 items-center justify-center border-l border-border-a/60 bg-gradient-to-br from-background via-background to-accent-a/10">
      <div className="max-w-[320px] px-10 text-center">
        <div className="mx-auto h-24 w-24 rounded-full bg-gradient-to-br from-primary-a/30 to-transparent blur-[2px]" />
        <p className="mt-8 text-sm leading-relaxed text-muted-foreground">{t.auth.subtitle}</p>
      </div>
    </div>
  );
}

interface NoticePanelProps {
  body: string;
  children: React.ReactNode;
}

function NoticePanel({ body, children }: NoticePanelProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">{body}</p>
      {children}
    </div>
  );
}

/**
 * Full-window login layout (spec §2.8).
 *
 * Two columns at ≥1024px; the brand column collapses below that and the form
 * keeps its fixed `max-w-[380px]`. Maintenance and "client too old" replace the
 * form *in place* — the break-glass entry stays reachable in every state,
 * because it is the only way back into an installation whose server is down.
 */
export default function LoginScreen({ reason = null }: LoginScreenProps) {
  const { t } = useLocale();
  const { status, retry, openExternal, pending } = useSession();
  const [view, setView] = useState<AuthView>('login');
  const [downloadHint, setDownloadHint] = useState<string | null>(null);
  const meta = status.server;
  const maintenanceMessage = meta?.maintenanceMessage ?? '';
  const outdated = isClientOutdated(status);
  // `null` means "origin unknown": disable the button rather than navigate to a
  // domain that may not be the user's (Rule 3, spec §3.7 / P1-8).
  const downloadUrl = clientDownloadUrl(status.server?.baseUrl);

  const reasonKey = authReasonCopyKey(reason);
  const reasonText = reasonKey ? t.auth.error[reasonKey] : null;

  const heading = maintenanceMessage
    ? t.auth.maintenance.title
    : outdated
      ? t.auth.outdated.title
      : view === 'register'
        ? t.auth.createAccount
        : view === 'reset'
          ? t.auth.forgot
          : t.auth.title;

  const openDownload = async () => {
    if (!downloadUrl || pending) return;
    setDownloadHint(null);
    try {
      await openExternal(downloadUrl);
    } catch (error) {
      // The bridge rejects with the plain `{ ok:false, code }` envelope, so
      // `instanceof Error` would miss every refusal — the classifier is the
      // only correct test and it picks the `url_not_allowed` sentence.
      // `null` means the click was skipped (another auth action was running),
      // not that opening failed, so nothing is reported.
      const key = downloadFailureCopyKey(error);
      if (key) setDownloadHint(t.auth.outdated[key]);
    }
  };
  // No address means nothing to open, so the hint stands in for the click: a
  // disabled button with no explanation reads as "broken" (Rule 3, §3.7/P1-8).
  const downloadHintText =
    downloadHint ?? (downloadUrl ? null : t.auth.outdated.noUrl);

  const canRegister = !!meta && meta.registrationEnabled;
  const form = (() => {
    // Without `/meta` the account server is unreachable: sign-in can still be
    // attempted (the main process reports the real failure), but password reset
    // cannot be offered — it would set `view='reset'` and fall straight back into
    // this branch, i.e. a button that does nothing.
    if (!meta) return <ServerLoginForm />;
    if (maintenanceMessage) {
      return (
        <NoticePanel body={maintenanceMessage}>
          <button type="button" onClick={retry} className={SECONDARY_BUTTON}>
            {t.auth.retry}
          </button>
        </NoticePanel>
      );
    }
    if (outdated) {
      return (
        <NoticePanel
          body={[
            fill(t.auth.outdated.current, { version: status.appVersion || '—' }),
            fill(t.auth.outdated.minimum, { version: meta.minClientVersion }),
          ].join('\n')}
        >
          <button
            type="button"
            onClick={openDownload}
            disabled={!downloadUrl || pending}
            className={DOWNLOAD_BUTTON}
          >
            {t.auth.maintenance.download}
          </button>
          {downloadHintText && (
            <div
              role="status"
              className="text-[11px] leading-relaxed text-amber-500"
            >
              <p>{downloadHintText}</p>
              {downloadUrl && (
                <p className="select-text break-all">{downloadUrl}</p>
              )}
            </div>
          )}
        </NoticePanel>
      );
    }
    if (view === 'register' && canRegister) {
      return <RegisterForm meta={meta} onBack={() => setView('login')} />;
    }
    if (view === 'reset') {
      return <ResetPasswordForm meta={meta} onBack={() => setView('login')} />;
    }
    return <ServerLoginForm onForgot={() => setView('reset')} />;
  })();

  const showViewSwitch = view === 'login' && !maintenanceMessage && !outdated;

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden bg-background">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-[380px]">
            <h1 className={TITLE}>{heading}</h1>
            {view === 'login' && !maintenanceMessage && !outdated && (
              <p className="mt-2 text-sm text-muted-foreground">{t.auth.subtitle}</p>
            )}

            {reasonText && (
              <p
                role="status"
                aria-live="polite"
                className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500"
              >
                {reasonText}
              </p>
            )}

            <div className="mt-6">
              <ViewTransition viewKey={`${view}:${maintenanceMessage}:${outdated}`}>
                {form}
              </ViewTransition>
            </div>

            {showViewSwitch && canRegister && (
              <>
                <div className="my-5 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t.auth.or}
                  </span>
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  {t.auth.noAccount}{' '}
                  <button
                    type="button"
                    onClick={() => setView('register')}
                    className="text-primary hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {t.auth.createAccount}
                  </button>
                </p>
              </>
            )}

            {showViewSwitch && !canRegister && meta?.supportEmail && (
              <p className="mt-5 text-center text-xs text-muted-foreground">
                {t.common.support}:{' '}
                <a
                  href={`mailto:${meta.supportEmail}`}
                  className="text-primary hover:underline underline-offset-2 break-all"
                >
                  {meta.supportEmail}
                </a>
              </p>
            )}

            <div className="mt-8 border-t border-border pt-4">
              <LocalAdminForm />
            </div>
          </div>
        </div>
      </div>

      <BrandPanel />
    </div>
  );
}
