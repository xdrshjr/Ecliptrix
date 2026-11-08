import Link from 'next/link'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'

/** Static terms placeholder. */
export default async function TermsPage() {
  const locale = await resolveLocale()
  const tt = translator(locale)

  return (
    <article className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">{tt('footer.terms')}</h1>
      <p className="mt-2 text-xs text-[var(--muted)]">最后更新：2026-10-08</p>

      <div className="mt-8 flex flex-col gap-5 text-sm leading-7 text-[var(--muted)]">
        <section>
          <h2 className="text-base font-medium text-[var(--foreground)]">授权范围</h2>
          <p className="mt-1">
            Ecliptrix 桌面端按账号授权使用。一个账号对应一个自然人；管理员可以创建、停用或删除账号，
            并分配角色与权限。
          </p>
        </section>
        <section>
          <h2 className="text-base font-medium text-[var(--foreground)]">账号安全</h2>
          <p className="mt-1">
            请妥善保管口令。连续多次登录失败会触发临时锁定。桌面端内置的本地破窗账号仅用于设备救援，
            不得用于访问他人数据。
          </p>
        </section>
        <section>
          <h2 className="text-base font-medium text-[var(--foreground)]">服务变更</h2>
          <p className="mt-1">
            本服务处于持续开发阶段，功能可能调整。重大变更会通过站点公告或邮件提前告知。
          </p>
        </section>
        <p className="rounded-sm border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-xs text-[var(--warning)]">
          TODO(运营方, 2026-10-08)：上线前请替换为经法务审阅的正式服务条款。
        </p>
      </div>

      <Link href="/" className="mt-10 inline-block text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
        ← {tt('common.back')}
      </Link>
    </article>
  )
}
