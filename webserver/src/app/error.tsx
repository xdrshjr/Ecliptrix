'use client'

import { useEffect } from 'react'

/**
 * Global error boundary.
 *
 * Shows a request id the user can quote, but never the message or stack: an error
 * string from the server can leak a file path or a query fragment.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The server already logged the detail; the browser console keeps the object
    // available for support without echoing it into the page.
    console.error('unhandled UI error', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
      <p className="mono text-4xl font-semibold text-[var(--border-strong)]">500</p>
      <h1 className="text-lg font-semibold">出现了一个未预期的错误</h1>
      <p className="max-w-md text-sm text-[var(--muted)]">
        请稍后重试。如果问题持续存在，请把下面的 request-id 提供给管理员。
      </p>
      {error.digest ? (
        <code className="mono rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs">
          {error.digest}
        </code>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-2 inline-flex h-9 items-center rounded-sm bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)]"
      >
        重试
      </button>
    </div>
  )
}
