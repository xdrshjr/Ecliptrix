import Link from 'next/link'

/** 404. Deliberately plain: no stack trace, no internal path, one way home. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
      <p className="mono text-4xl font-semibold text-[var(--border-strong)]">404</p>
      <h1 className="text-lg font-semibold">页面不存在</h1>
      <p className="max-w-sm text-sm text-[var(--muted)]">
        链接可能已失效，或者你访问的页面已被移除。
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex h-9 items-center rounded-sm border border-[var(--border-strong)] px-4 text-sm transition-colors hover:bg-[var(--surface-2)]"
      >
        返回首页
      </Link>
    </div>
  )
}
