import Link from 'next/link'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'

/** Static legal placeholder. Real copy is an operator responsibility. */
export default async function PrivacyPage() {
  const locale = await resolveLocale()
  const tt = translator(locale)

  return (
    <article className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">{tt('footer.privacy')}</h1>
      <p className="mt-2 text-xs text-[var(--muted)]">最后更新：2026-10-08</p>

      <div className="prose-invert mt-8 flex flex-col gap-5 text-sm leading-7 text-[var(--muted)]">
        <section>
          <h2 className="text-base font-medium text-[var(--foreground)]">我们收集什么</h2>
          <p className="mt-1">
            账号服务器只保存身份与访问控制所需的信息：邮箱、用户名、显示名、口令哈希、角色与权限、
            会话记录以及审计日志。创作内容（视频、音频、图片、脚本）始终保存在你的本机，从不上传。
          </p>
        </section>
        <section>
          <h2 className="text-base font-medium text-[var(--foreground)]">我们如何使用</h2>
          <p className="mt-1">
            这些信息用于登录校验、权限判定、账号安全（锁定、会话撤销）与运营审计。我们不会出售，
            也不会用于广告画像。
          </p>
        </section>
        <section>
          <h2 className="text-base font-medium text-[var(--foreground)]">保留期限</h2>
          <p className="mt-1">
            审计日志默认保留 180 天；会话记录在失效后保留 90 天后清理。你可以联系管理员申请导出或删除
            你的账号数据。
          </p>
        </section>
        <section>
          <h2 className="text-base font-medium text-[var(--foreground)]">你的权利</h2>
          <p className="mt-1">
            你可以随时在账号中心查看、修改你的资料，撤销设备会话，或提交账号注销请求。
          </p>
        </section>
        <p className="rounded-sm border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-xs text-[var(--warning)]">
          TODO(运营方, 2026-10-08)：上线前请替换为本司法辖区的正式隐私政策文本，并在页脚标注版本号。
        </p>
      </div>

      <Link href="/" className="mt-10 inline-block text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
        ← {tt('common.back')}
      </Link>
    </article>
  )
}
