'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useSession } from '@/contexts/SessionContext';
import {
  authReasonCopyKey,
  clientDownloadUrl,
  downloadFailureCopyKey,
  type AuthReason,
} from '@/lib/api/authBridge';
import LocalAdminForm from './LocalAdminForm';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center h-11 px-4 rounded-lg bg-primary text-primary-foreground ' +
  'text-sm font-medium transition-opacity duration-150 ease-out hover:opacity-90 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';
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

function logsPath(): string {
  if (typeof window === 'undefined') return '';
  return window.ecliptrixDesktop?.logsPath ?? '';
}

/**
 * Shown when `logsPath` itself is unreachable — which is exactly the
 * `bridge-unavailable` case (no preload ⇒ no `window.ecliptrixDesktop`). Windows
 * only: the app has no other target. Never a link (`file://` is refused by the
 * preload allowlist), just selectable text.
 */
const WINDOWS_LOG_FALLBACK = '%APPDATA%\\Ecliptrix\\logs';

/**
 * Blocked-state screen (spec §2.7 / §2.13): maintenance, client too old,
 * missing bridge, no account server configured.
 *
 * Every variant offers an action the user can actually take — retry, open the
 * download page, read the log location — and the two states that can lock an
 * installation out (no server, maintenance) keep the break-glass entry.
 */
export default function AuthBlocker() {
  const { t } = useLocale();
  const { status, retry, openExternal, pending } = useSession();
  const [downloadHint, setDownloadHint] = useState<string | null>(null);
  const reason: AuthReason = status.reason ?? 'network';
  const meta = status.server;
  const path = logsPath();
  // `null` means "origin unknown": disable the button instead of navigating to
  // a domain that may not be the user's (Rule 3, spec §3.7 / P1-8).
  const downloadUrl = clientDownloadUrl(status.server?.baseUrl);
  // Only `client-outdated` offers a download button, so only that state may show
  // a hint about it: rendered unconditionally, `noUrl` surfaced under a
  // bridge-unavailable / local-admin / maintenance screen and read as if
  // downloading were broken.
  const canDownload = reason === 'client-outdated';

  const openDownload = async () => {
    if (!downloadUrl || !canDownload || pending) return;
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
  // disabled button with no explanation reads as "broken".
  const downloadHintText =
    canDownload ? downloadHint ?? (downloadUrl ? null : t.auth.outdated.noUrl) : null;

  const title =
    reason === 'maintenance'
      ? t.auth.maintenance.title
      : reason === 'client-outdated'
        ? t.auth.outdated.title
        : t.auth.error[authReasonCopyKey(reason) ?? 'unknown'];

  const body =
    reason === 'maintenance'
      ? meta?.maintenanceMessage ?? ''
      : reason === 'client-outdated'
        ? [
            fill(t.auth.outdated.current, { version: status.appVersion || '—' }),
            fill(t.auth.outdated.minimum, { version: meta?.minClientVersion ?? '—' }),
          ].join('\n')
        : '';

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-[420px]">
        <h1 className="text-[24px] leading-[30px] font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {body && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
            {body}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={retry} className={PRIMARY_BUTTON}>
            {t.auth.retry}
          </button>
          {reason === 'client-outdated' && (
            <button
              type="button"
              onClick={openDownload}
              disabled={!downloadUrl || pending}
              className={DOWNLOAD_BUTTON}
            >
              {t.auth.maintenance.download}
            </button>
          )}
        </div>

        {downloadHintText && (
          <div
            role="status"
            className="mt-3 text-[11px] leading-relaxed text-amber-500"
          >
            <p>{downloadHintText}</p>
            {downloadUrl && (
              <p className="select-text break-all">{downloadUrl}</p>
            )}
          </div>
        )}

        {reason === 'bridge-unavailable' && (
          <div className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            <span className="block font-medium text-foreground">{t.auth.logs}</span>
            <span className="select-text break-all">{path || WINDOWS_LOG_FALLBACK}</span>
          </div>
        )}

        {(reason === 'server-not-configured' || reason === 'maintenance') && (
          <div className="mt-8 border-t border-border pt-4">
            <LocalAdminForm />
          </div>
        )}
      </div>
    </div>
  );
}
