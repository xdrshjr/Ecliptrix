# 账号平台收尾：邮件闭环、自助生命周期与运营治理

| 字段 | 值 |
|---|---|
| 特性 slug | `account-platform-finalization` |
| 文档路径 | `docs/plans/account-platform-finalization/spec.md` |
| 版本 | **v2**（v1 = 节点 #0 设计稿；节点 #1 设计评审后原地升级：文首新增「评审记录」，文末新增「评审结论」，正文就地修复 6 项 P0 与 13 项 P1，D3-11…D3-15 已回写附录） |
| 轮次 | 第 3 轮 / 共 3 轮 —— 节点 #0（设计）→ 节点 #1（设计评审，本版本） |
| 本轮定位 | 收尾轮：不引入新概念，只把已交付的两半（`webserver/` 账号服务 + `desktop/` 登录闸门）补成可运营、可合规、可回归的成品 |
| 上游设计 | `docs/plans/webserver-user-management/spec.md`（R1，账号服务本体，v2 + 实施缺陷 D-01…D-10 + 代码评审 R-23…R-34）；`docs/plans/desktop-account-login-gate/spec.md`（R2，桌面登录闸门，v2 + D-01…D-18 + 评审结论 C1…C11） |
| 下游节点 | #1 设计评审（本版本）→ #2 实施 → #3 评审与提交 |
| 本节点产物 | **仅本文件**。不写实现代码、不改 `docs/plans/account-platform-finalization/` 之外的任何文件、不执行 `git commit` |

---

## 评审记录

评审对象：本文件 v1（1143 行）。评审方式：§0–§11 逐章对照**当前工作树源码**，不采信设计稿自述；四条只读核验通道分别核对邮件/错误码/设置层、用户与会话与审计层、迁移与 DDL、桌面端与测试基线，全部结论都落到具体符号与行号。**判定：有条件通过**（条件见文末「评审结论」）。**6 项 P0 与 13 项 P1 已全部在正文就地修正**，下表「处置」列给出修正落点；P2 保留在案供实施节点取舍，其中 P2-2 与 P2-5 建议随本轮一并做。

### P0（阻断实施，已修）

| ID | 位置 | 问题与证据 | 处置 |
|---|---|---|---|
| P0-1 | §3.3 / §4.2 / §2.1 | **"同步有界 5000 ms"按现设计不可实现，会把注册接口挂死最长 1 小时。** `webserver/src/server/mail/mailer.ts` 顶部是**静态** `import nodemailer from 'nodemailer'`，且 `nodemailer` 是 `dependencies`（非可选依赖，`next.config.mjs` 里还列进 `serverExternalPackages`）——v1 §2.1 写"可选依赖"是错的。更关键：`getTransporter()` 的 `createTransport({ host, port, secure, auth })` **没有** `connectionTimeout`/`socketTimeout`/`greetingTimeout`，`sendPasswordResetMail` 的 `sendMail(...)` 也不带超时，现网唯一上界是 nodemailer 默认 socketTimeout（1 小时）。v1 只加 `MAIL_SEND_TIMEOUT_MS` 环境变量，却没把 `mailer.ts` 列进 §4.2 修改清单，实施节点照做也只会拿到一个没被使用的配置项。 | §3.3 增补「传输层超时契约」（三个超时全部由 `MAIL_SEND_TIMEOUT_MS` 派生）；§3.3 明确注册/换邮箱/注销等**用户热路径 fire-and-forget**（outbox 已落库，不 await 投递），只有 `/admin/mail/{id}/retry` 同步等待；§4.2 增列 `mailer.ts`；§2.1 订正为硬依赖 |
| P0-2 | §3.8 / §6.1 | **`account_deletion_requests.token_hash TEXT NOT NULL UNIQUE` 与"无 SMTP 时直接排期"自相矛盾。** 邮件不可用路径不产生确认令牌，若写占位值 `''`，则第二次注销申请必然撞 UNIQUE（`500`）；而 §3.8 又要求"重新申请覆盖旧申请"。同表 `status` CHECK 与状态机一致（已核），问题只在 `token_hash`。 | §6.1 改为 `token_hash TEXT`（可空）+ `CREATE UNIQUE INDEX … WHERE token_hash IS NOT NULL`；§3.8 增补"无邮件申请不得写空串" |
| P0-3 | §3.4 / §6.1 | **发新验证信会撞 `idx_email_action_live`。** 该局部唯一索引谓词是 `WHERE used_at IS NULL`，**不含 `expires_at`**：一条已过期但 `used_at` 仍为 NULL 的旧行会继续占槽，此时"插新令牌"直接 `SQLITE_CONSTRAINT_UNIQUE`。v1 只说"旧令牌在同事务内 `used_at` 置位"，没说过期行，也没规定 UPDATE 必须先于 INSERT（仓库既有正确范例：`passwordResetsRepo.ts` 先 `UPDATE … SET used_at` 再 `INSERT`）。触发场景很普通：用户 48 h 后再点"重新发送"。 | §3.4 增补令牌发放的**三条硬规则**（先置后插、含已过期行、按 (user,purpose) 全量置位）；§6.1 DDL 注释同步；§7.1 增用例 |
| P0-4 | §3.4-强制策略 / §5.2 | **策略开启后注册永远失败，设计自锁。** §3.4 让 `POST /auth/login` 与 `/auth/register` 在"未验证 + 桌面端"时返回 403 `email_not_verified`；但 §3.4-1 又规定"注册成功后才发验证信"，而 `authService.register` 是**注册即登录**（`authService.ts` 内 `sessionService.createSession` + 路由 `201`）。于是新建用户恒为未验证 → 注册恒 403 → 新用户永远进不来，验证信也就永远没有收件人。 | §3.4 明确**注册路径不施加该闸门**（只对 `login` 施加），并说明注册后桌面端以"未验证黄条 + 重发"引导（`SessionUser.emailVerified=false`） |
| P0-5 | §5.1 / §4.2 | **只改 `ERROR_STATUS` 会 `tsc` 失败。** `errors.ts` 的表声明是 `Record<ErrorCode, number>`，`ErrorCode` 来自 `auth/constants.ts` 的 `ERROR_CODE`（30 键）。v1 §5.1 的注释只要求更新 `ERROR_STATUS`/`errors.*`/`docs/api.md`/`authErrors.js`/`AuthReason`，§4.2 对 `constants.ts` 的改动只提限流常量与 `REVOKE_REASON` —— **漏了 `ERROR_CODE`**，5 个新码会以"缺少属性"的形式打断类型闸门（AC-37）。 | §5.1 注补充"必须同时改 `ERROR_CODE`"，§4.2 的 `constants.ts` 行同步 |
| P0-6 | §3.10 / §4.2 | **桌面「活动」页签与网页活动页对新事件全盲。** `/me/activity` 走 `profileService.myActivity` → `auditRepo.listForUser`，后者用固定白名单 `SELF_VISIBLE_ACTIONS`（9 条：`auth.login`/`auth.login_failed`/`auth.logout`/`auth.password_changed`/`auth.session_revoked`/`auth.session_relogin`/`user.register`/`user.profile_updated`/`authz.denied`）+ `action IN (…)` 过滤。本轮新增的 `auth.email_verified`、`user.email_changed`、`user.exported`、`account.deletion_requested/scheduled/cancelled/deleted` **一条都不会出现**，而 v1 §4.2 对 `profileService.ts` 的改动只写了"注销委托 + PATCH 拒 email"。这是"功能上线即空转，且现有测试一条都不会红"的典型缺陷。 | §4.2 增列 `auditRepo.ts`（`SELF_VISIBLE_ACTIONS`）；§6.3 增加"自助可见"列并逐条判定；§7.1 增用例 |

### P1（已修）

| ID | 位置 | 问题与证据 | 处置 |
|---|---|---|---|
| P1-1 | §1.3-不变量 1 | 不变量"任何发信失败都不得改变 HTTP 状态码"与**现网代码冲突**：`app/api/v1/admin/users/[id]/password-reset/route.ts` 在 `!isMailEnabled()` 时抛 `service_unavailable`（503），且 `await sendPasswordResetMail(...)` 的 `false` 返回值被忽略仍回 `ok({ mode: 'reset_link' })`。v1 不写这条例外，实施节点会以"不变量"为由改掉管理员路径，或反过来让自助路径也变成 503。 | §1.3 给不变量加**作用域**（自助/合规路径）+ 允许的唯一例外族（`mail_disabled`，含管理员重置口令迁移）；§4.2 增列该 route；D3-11 记账 |
| P1-2 | §6.1 注 | **"`migrate.ts` 的 checksum 机制"不存在。** `migrate.ts` 的 `schema_migrations` 只有 `version/name/applied_at`，跳过判定只看 `version`，`name` 从不回读比对。结论（本轮只新增 0005）仍成立，但理由必须换成真话：**没有完整性校验，改写旧迁移不会报错，只会让老库/新库静默漂移**。 | §6.1 注改写，并把"无 checksum"写成实施时的自律约束 |
| P1-3 | §3.9 / §5.2 / AC-31 | **`/admin/mail` 的守卫与真实角色权限不符，AC-31 的期望值是错的。** `permissions.ts` 的 `SYSTEM_ROLE_PERMISSIONS` 里 `admin` **不含 `settings.write`**（只有 `owner` 有 `*`），`support` 不含 `settings.read`；同时 `support` **持有 `sessions.revoke`**。因此 v1 的"重试用 `settings.write`"实际只有 `owner` 能重试；AC-31 写的"`support` 读管理会话 200 / 写 403"对 `/admin/sessions/revoke` 是错的（`support` 应为 200）。 | §3.9 增补"真实权限矩阵"表并给每个新端点标注 4 角色期望；邮件重试改 `users.write`（超管/管理员均可运维，客服仍 403）；AC-31 重写 |
| P1-4 | §3.7 / §3.9 | **附件/CSV 响应与统一信封冲突，未给适配层。** `withContext` 的 handler 必须返回 `NextResponse`，`ok()` 强制 `NextResponse.json` + `Cache-Control: no-store`；`x-request-id` 由 `withContext` 统一注入。`/me/export` 与 CSV 若写成 `ok(json)`，下载会变成"被信封包住的 JSON"，`Content-Disposition` 也无处安放。 | §3.7 增「附件响应约定」：`new NextResponse(body, { status, headers })` + 手动 `Content-Type`/`Content-Disposition`/`Cache-Control: no-store`，错误仍走 `fail()`；§3.9 CSV 同款 |
| P1-5 | §3.8 / §3.10 / §6.5 | **"注销后登录显示专用文案"不可实现。** `authService` 对 `status === 'deleted'` 的账号直接返回 `invalid_credentials`（且刻意不写 `login_attempts`）——这是防枚举设计，不应破坏。v1 却承诺登录屏 `reason='account-deleted'` 专用文案。 | §3.8/§3.10 明确：`account_deleted` **只出现在已登录会话的心跳/refresh 401**；已注销账号重新登录仍是 `invalid_credentials`（并说明为什么这是正确选择） |
| P1-6 | §3.10 / §5.3 | **`auth:activity` 契约与现网端点对不上。** 现网 `GET /me/activity` 返回 `{ items: [{ id, action, targetType, targetId, ip, createdAt }], page }`（原始 `ip`），v1 的 `ActivityItem` 用 `ipMasked` 且返回 `{ items, truncated }`（`truncated` 现网不存在）。谁做脱敏、`truncated` 语义是什么，都没写。 | §5.3 重写 `ActivityItem` 与返回体（沿用 `page` 语义，`ipMasked` 由**主进程**脱敏，渲染层拿不到原始 IP）；§3.10 同步 |
| P1-7 | §3.14 / §3.10 | **"已有 bridge 缺失分支"只到 bridge 粒度。** `SessionContext.tsx` 只判断 `window.ecliptrixDesktop.auth` 整体存在与否；旧主进程 bridge 在、4 个新方法不在 → 逐方法调用直接抛错，v1 承诺的"账号中心降级为仅状态 + 打开浏览器"不会发生。 | §3.10/§3.14 改为**逐方法探测**（`typeof auth.me === 'function'`），并给出降级矩阵与用例 |
| P1-8 | §3.7 / §3.10 | **"打开 `${PUBLIC_BASE_URL}/account`"在桌面端拿不到。** `PUBLIC_BASE_URL` 是服务端变量；渲染层现有 `accountCenterUrl()` 来自**构建期** `NEXT_PUBLIC_ACCOUNT_SERVER_URL`，兜底硬编码 `https://ecliptrix.app`。自建账号服务时这个按钮会把用户送到厂商站点。`authBridge` 的 `open-external` 白名单已动态接纳"已配置的服务器 host"，所以修复可行。 | §3.7/§3.10 规定：`accountCenterUrl()` 改为优先 `status.server.baseUrl`（运行时，可空），仅在为空时回落构建期常量；为空且无常量时按钮 `disabled` + 文案 |
| P1-9 | §2.2 / §3.12 / §4.2 / §6.4 / §7.2 / §7.5 | **数字基线有 4 处错，而它们全是门禁阈值。** 实测：`AuthReason` = **21** 值（v1 说 19）；`authErrors` 映射 = **21** 条 + 未知回落 `internal-error`（v1 说"保留既有 30+ 映射"）；`src/components/auth` + `src/contexts` = **4 文件 / 27 用例**（v1 说 5 文件 / 29）；i18n 新键 §4.2 说"约 78"而 §6.4 分项求和是 **92**（11+15+5+9+14+16+7+11+4）。其余基线复核为真：webserver 19 文件 / 174 用例、`smoke.mjs` 62 条 `check()`、`CHANNELS` 10 个、`PASSWORD_CHANGE_ALLOWED` 5 个、`authHttp` 11 个方法、桌面 6 套件。 | §2.2/§6.4/§3.12/§7.2 全部订正，并在 §7.5 增加"基线必须由命令产出"的要求 + AC-45 |
| P1-10 | §3.8 / §6.3 | **现网把明文邮箱写进审计 metadata。** `profileService.requestAccountDeletion` 里 `metadata: { email: user.email_normalized }` —— 完整邮箱落库到 `audit_events`，与 §6.3"metadata 脱敏"和 R1 的审计原则直接矛盾。v1 把该函数改成"委托给新服务"，却没说这条 metadata 必须一起改。 | §3.8/§6.3 明确新流程只写脱敏值（`a***@b.c`），并列入 §4.2 `profileService.ts` 改动 |
| P1-11 | §3.8 | **收不到信的用户永远无法注销。** 邮件可用时注销必须先点确认链接；若用户丢了邮箱访问权，v1 既没有"管理员代确认"端点，也没有 CLI（对比：口令找回已有 `user:reset` 破窗通道）。合规上这是硬伤。 | §3.8 增补管理员通道 `POST /api/v1/admin/users/{id}/deletion`（`users.delete`，强制推进到 `scheduled`，写审计）+ §5.4 增 `npm run account:confirm-deletion` 离线通道；§7.1 增用例 |
| P1-12 | §3.8 / §6.3 / §6.5 | **`account_deleted` 与既有 `REVOKE_REASON.deleted` 语义重复且未对齐。** `REVOKE_REASON.deleted = 'deleted'` 已被 `userService`（管理员删除用户时 `revokeAllForUser(targetId, REVOKE_REASON.deleted)`）使用。v1 新增 `account_deleted`，而桌面端只按 `session_revoked` + `details.reason` 分流；两个值并存时，桌面必须同时识别，否则"管理员删号"会落进未知分支。 | §6.3 增"吊销理由词表"说明两者边界；§6.5/§4.3 要求 `authErrors`/`authController` 同时映射 `deleted` 与 `account_deleted` 到同一 `account-deleted` reason |
| P1-13 | §3.7 | **导出冷却期以审计行为数据源不可靠。** `auditService.record` 是 best-effort（异常被吞、只打日志，注释明写 "Never throws"），且 `audit.retentionDays` 会把旧行删掉。用它判定"最近一次导出"既可能失效也可能误放行。 | §3.7 改数据源为 `users.last_exported_at`；§6.1 迁移增加一条 `ALTER TABLE users ADD COLUMN last_exported_at INTEGER`（加法，符合本项目迁移铁律，先例：0004 的 `ADD COLUMN device_key`） |

### P2（记录在案，本轮不强制）

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| P2-1 | §2.1 | "`email_verified_at` 全库 0 处写入"表述不准：`usersRepo` 的 INSERT 列清单里有它，只是调用方恒传 `null`，且无任何 UPDATE | 已改为"无任何写点会把非 NULL 值写入"，实施时以 grep `email_verified_at` 为准 |
| P2-2 | §6.2 | `settingsService` **没有"只读键"机制**（只有 `SPECS` 的 type/min/max + `SETTING_KEYS` 白名单）。无 SMTP 时"强制 `mail.verificationRequired=false`"必须在 `settingsService` 的读/写两侧夹紧，否则管理员开了开关又没有 SMTP，全体桌面端用户会被 403 锁死（可用性事故） | 建议随 P1-1 一起做：写入时拒绝 + 读取时夹紧 + 用例 |
| P2-3 | §3.3 | 每日 20 封上限按 `to_user_id` 统计，但管理员邀请邮件没有 `to_user_id` → 不覆盖"管理员刷邀请" | 管理员侧以 `admin:{id}` 的 `mailInvite` 预算为主，文档明写口径 |
| P2-4 | §3.3 | 5 s 同步投递若留在注册/申请路径，会把注册时延从毫秒级拉到最坏 5 s | 已被 P0-1 的 fire-and-forget 覆盖，此处保留为实施提醒 |
| P2-5 | §5.2 | 两个**无会话**消费端点（`/auth/email/verify`、`/auth/deletion/confirm`）没有限流 scope，令牌虽不可爆（32 字节随机），但可被用于审计/查询放大 | 建议各加一条 `verify:{ip}`（如 60/h） |
| P2-6 | §5.1 | 用 `409 deletion_pending` 禁止 `PATCH /me`，与 R3"申请期间账号仍可用"的缓解思路有张力 | 实施时确认是否需要，或降级为"仅禁止改邮箱" |
| P2-7 | §3.9 | CSV 20000 行上限的**响应表达**未定义（没有 `truncated` 头或尾注） | 明确用 `X-Export-Truncated: 1` 之类，或写进 README |
| P2-8 | §3.12 | "Playwright 装不上可登记偏差"与 DoD 的"e2e 全绿"冲突 | 已加限定：登记偏差时必须写明"未执行"并给出报错原文，且 `smoke.mjs ≥ 96` 不得降级 |
| P2-9 | §7.5 | AC-14 的证据写"`admin.test.ts` 新增 2 例"，但 §7.1 未列该文件条目；AC-40 以"人工逐条比对"为唯一证据，与 §0"每条 AC 都绑自动化证据或命令"自述冲突 | 已在 §7.1 补 `admin.test.ts` 条目；AC-40 保留人工项但补齐可自动化的真子集（文档自检脚本） |
| P2-10 | §3.11 | `deploy/cron.example` 只给 crontab；本项目主平台是 Windows | 增 Windows 任务计划的等价说明（或用 `npm run accounts:sweep --dry-run` 手工验证） |
| P2-11 | §3.12 | "用例数 ≥ 232" 与 §7.1 具名用例（约 60）之和大致自洽，但没有给计数命令 | 已在 §7.5 增加 `npm test -- --reporter=json` 一类可复现口径 |

### 已核实为正确的断言（不再重复讨论）

以下 v1 断言与源码一致，实施时可直接采信，不必再验：

- `users.status` 的 CHECK **已包含** `'deleted'`（`0001_init.sql`），因此匿名化不需要重建表 —— v1 的"只改数据不改表结构"成立。
- `sessions.revoked_reason` **没有 CHECK 约束**（`0001_init.sql` 该列裸 `TEXT`；`0002_hardening.sql` 的注释明确写"枚举在代码里（`REVOKE_REASON`）而非 SQL，因为 SQLite 加 CHECK 必须重建表"）→ 新增 `email_changed`/`account_deleted`/`admin_lockdown`/`security_incident` 可以直接写。
- 局部唯一索引有先例且引擎支持：`0004_device_identity.sql` 的 `CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions (user_id, device_key) WHERE device_key <> ''` 已在真实库中应用；SQLite 版本 3.49.2。
- `migrate.ts` **单事务 + 失败整文件回滚**（`db.transaction(() => { db.exec(sql); record })`，`tests/integration/migrate.test.ts` 有覆盖），且新 `.sql` 只需按 `NNNN_name.sql` 命名即被自动发现，无注册表。
- 权限键 `users.read`/`users.write`/`users.delete`/`sessions.revoke`/`settings.read`/`settings.write`/`invites.write`/`audit.read` **全部存在**（`permissions.ts` 的 `PERMISSION_GROUPS`）。
- 守卫入口就是 `requireAdminRead` / `requireAdminWrite` 两个，v1 要求"新端点一律走守卫"可行。
- `auditService.record` 接受任意 `action: string`，**没有动作白名单**，新增 13 个动作不会被拒（v1 §4.2 说"新动作加入合法集合"是多虑，已在正文订正为"无需改动"）。
- 桌面端 `CHANNELS` = 10、`PASSWORD_CHANGE_ALLOWED` = 5、`EXTERNAL_HOST_ALLOWLIST` 含已配置服务器 host（动态加入）、`authHttp` 有 `AbortController` 超时机制、`preload` 暴露 10 invoke + `onChanged` —— v1 对桌面现状的描述成立，新增 4 通道的接法也可行。
- webserver 测试 19 文件 / 174 用例、`smoke.mjs` 62 条（`check()` 调用 62 次）、`tests/unit/i18n.test.ts` 与根项目 `src/lib/__tests__/authI18nParity.test.ts` 都存在 —— v1 的质量基线成立（除 P1-9 列出的 4 处数字）。

### 核验方法与可复现命令

```bash
# 计数类断言（静态计数，不跑测试；PowerShell/cmd 均可）
python -c "import re,pathlib;print(sum(len(re.findall(r'(?<![\w.])it\(|(?<![\w.])test\(',p.read_text(encoding='utf-8'))) for p in pathlib.Path('webserver/tests').rglob('*.ts')))"      # 174
python -c "import re,pathlib;print(len(re.findall(r'(?<![\w.])check\(',pathlib.Path('webserver/scripts/smoke.mjs').read_text(encoding='utf-8')))-1)"                                             # 62
python -c "import re,pathlib;t=pathlib.Path('src/lib/api/authBridge.ts').read_text(encoding='utf-8');i=t.find('export type AuthReason');print(len(re.findall(r\"'[a-z-]+'\",t[i:t.find(';',i)])))"  # 21
# 符号类断言
grep -n "SELF_VISIBLE_ACTIONS" webserver/src/server/db/repositories/auditRepo.ts        # 白名单缺新动作（P0-6）
grep -n "settings.write" webserver/src/server/auth/permissions.ts | head                # admin 角色不含它（P1-3）
grep -n "createTransport" webserver/src/server/mail/mailer.ts                          # 无超时参数（P0-1）
grep -n "Record<ErrorCode, number>" webserver/src/server/http/errors.ts                # P0-5 的编译约束
grep -n "email: user.email_normalized" webserver/src/server/services/profileService.ts  # P1-10 明文邮箱
```

---

## 0. 摘要

R1 交付了 `webserver/` 账号服务（Supabase 风格落地页、登录/注册/找回、账号中心、管理后台的用户 CRUD 与角色权限矩阵、邀请码、审计、REST `/api/v1`、Docker/Nginx/systemd 部署产物），R2 交付了桌面端启动登录闸门（令牌只在主进程、破窗账号 `admin/adminjr`、7 天离线宽限、设备顶号、版本闸门、维护模式）。用户最初的需求——「一个外部 Web 子项目，管理员在上面增删改查账号并分配权限，桌面端连它做登录验证，另有一个写死的最高权限账号」——已经**功能可用**。

本轮**不再加新概念**，只补三条"最后一公里"，全部是 R1/R2 已明确记录为推迟或缺失的项：

1. **邮件通道只有一条腿**（R1 §8.3 #4 推迟"邮箱验证与邮件模板"）：当前只有口令重置一封信（`webserver/src/server/mail/mailer.ts` 仅导出 `sendPasswordResetMail`）。注册不验证邮箱（`users.email_verified_at` 列存在但从未被写入）、邀请码不能发信、用户无法自助更换邮箱。**没有 SMTP 的部署连找回口令都要找管理员**，这是真实运营的硬伤。
2. **账号生命周期是假的**（R1 D-01 明写"不删除账号"；R1 §8.3 #7 推迟 GDPR 导出）：注销只写一条审计与管理员通知；没有任何数据导出；桌面端"账号中心"只是一个 `openExternal` 跳浏览器（`src/components/auth/AccountMenu.tsx`），资料、安全、活动全在网页侧，体验割裂。
3. **运营与回归靠肉眼**：管理员看不到"全局谁在线"（只有 `/admin/users/[id]` 的任务级会话列表），概览只有 14 天注册趋势（`metricsService.overview()` 的 `registrationTrend`），没有登录/会话趋势与客户端版本分布；没有浏览器级 e2e（R1 D-06 明确推迟 Playwright）、没有无障碍闸门、没有邮件可观测性。

**一句话目标**：让运营方能真发信、真验证、真删号、真看数，让用户能在桌面端原地管理自己的账号，让下一次改动有人工之外的回归护栏。

本轮的每一条验收（§7）都绑定一个自动化证据（测试文件 + 用例名）或一条可复制粘贴的命令；不写"应当"、不写"手工确认即可"作为唯一证据。

---

## 1. Overview

### 1.1 要建什么

三个交付面，共 9 个阶段（§4 P0…P8）：

- **邮件面（P0–P3）**：把邮件从"一个函数"升级成"一条管线"——`mail_outbox` 持久化 + 模板表 + 送达/失败状态 + 开发期可读的 outbox + 按账号/按 IP 的发送限流。在它之上落三个业务流：注册邮箱验证（含重发与管理员强制标记已验证）、更换邮箱（新址确认 + 旧址通知的双确认）、邀请码邮件 + 三类安全通知（新设备登录 / 口令变更 / 注销流程）。
- **生命周期面（P4–P6）**：自助数据导出（`GET /me/export`，JSON 附件，冷却期）；带冷静期的真实注销（申请 → 邮件确认 → 72 h 可取消 → 清扫器匿名化，会话随之吊销，桌面端收到 `account_deleted`）；桌面端内嵌账号中心（4 个页签：资料 / 设备 / 安全 / 活动），不再强制跳浏览器。
- **运营与质量面（P7–P8）**：管理后台新增 `/admin/sessions`（全局会话与批量踢下线）与 `/admin/mail`（outbox 可观测），概览扩到 30 天多序列趋势 + 平台/版本分布，用户列表 CSV 导出，管理员可强制标记邮箱已验证，审计/邮件/令牌的保留清理脚本；质量闸门补浏览器级 e2e（Playwright，8 条主流程）+ axe 无障碍断言 + i18n 双字典一致性 + `smoke.mjs` 从 62 扩到 ≥96。

### 1.2 为什么是这三块

- **为什么先补邮件**：邮箱是"账号所有权"的唯一凭证。没有验证，任何人可以用别人的地址注册；没有变更流程，用户换邮箱只能求管理员改库；没有邀请邮件，邀请码只能靠 IM 手抄。这三件事决定了这套系统能不能对外。"没有 SMTP 也能跑"必须继续成立（R1 §2.10），所以 outbox 不是可选项，它是降级模式的可视化出口。
- **为什么必须补注销与导出**：现在 `POST /me/deletion-request` 只写审计（`profileService.requestAccountDeletion`），用户点完没有任何后续，管理员的"危险操作"卡片没有闭环。SaaS 账号体系的底线是"能自己走、能把自己的数据带走"。
- **为什么补运营面**：用户原话是"管理员可以在上面进行账号的增删改查管理和权限分配"。R1 做到了"改"，但"看到谁在用、谁在线、哪个版本在跑"是同一件事的另一半；而 `/admin/metrics` 已经证明数据在库里（`sessions` 有 `platform`/`app_version`，`login_attempts` 有 `success`），只差查询与图表。
- **为什么不做 2FA / 支付 / PostgreSQL**：见 §9。它们的实现成本远高于本轮收益，且 R1/R2 已各自给出推迟理由；本轮把这些理由原文固化，避免下一轮重复讨论。

### 1.3 边界（不变量，破一条就是缺陷）

继承 R1/R2 的全部不变量，本轮**新增**三条：

1. **邮件永不影响自助与合规路径的 API 结果**（作用域见下）。任何发信失败（SMTP 拒绝、超时、模板渲染异常）都不得改变 HTTP 状态码或 `error_code`；"申请重置/申请注销/注册"的响应在邮件可用与不可用时必须逐字一致（R1 §2.10 的枚举防护要求）。允许的例外只有两类，且必须同时写进 `docs/api.md`：
   - `mail_disabled`（503，§5.1）：只在"该动作在无邮件时根本无法完成"时返回（`POST /auth/email/verify/resend`；以及迁移后的管理员代发口令重置，见下条）；
   - **管理员代发路径**：`app/api/v1/admin/users/[id]/password-reset/route.ts` 目前在 `!isMailEnabled()` 时抛 `service_unavailable`，且忽略 `sendPasswordResetMail()` 的 `false` 仍回 `ok({ mode: 'reset_link' })`。这是评审前就存在的偏离（不变量被写成"绝对"会诱导实施节点把它改成静默 200，从而让管理员以为信发出去了）。本轮把它并入 `mail_disabled`，并**保留"邮件不可用时管理员改用一次性口令"的既有语义**（D3-11）。
2. **令牌只存在于链接，不落库明文、不进 outbox、不进日志**。outbox `payload` 中的令牌一律以 `token=***` 形式脱敏存储；带令牌的邮件标记 `retryable = 0`（重试无法重放一个已脱敏的令牌）。令牌明文只在一次发送的内存里存在。
3. **注销只做匿名化，不做物理删除**。`users` 行保留（`status='deleted'`、`deleted_at` 置位、邮箱与用户名脱敏到不可反查），审计与角色历史因此不断链。这与 `webserver/src/server/db/migrations/0001_init.sql` 的 `status IN ('active','suspended','pending','deleted')` 与 `audit_events.actor_user_id … ON DELETE SET NULL` 的设计一致。

---

## 2. 现状基线（实施前必须先确认的既有事实）

> 本节是给实施节点的"起点清单"。每一条都可在源码核对；实施时**沿用**，不要重造。

### 2.1 账号服务（`webserver/`）

| 维度 | 现状 |
|---|---|
| 栈 | Next.js 15 App Router + TS + React 19 + Tailwind 3；`better-sqlite3`（WAL）；手写迁移；不透明令牌（无 JWT）；scrypt 口令 |
| 分层 | `app/**/page.tsx`（RSC）直连 `server/services/*`，从不 fetch 自己的 API；`app/api/v1/**/route.ts` 只做「解析 + zod + 守卫 + 调 service + 回包」；SQL 只在 `server/db/repositories/*` |
| 路由 | 34 个 `route.ts` / 45 个 handler；20 个页面（`(marketing)` / `(auth)` / `(console)`）。**没有** `/admin/sessions`、`/admin/mail` |
| 表（12） | `schema_migrations`、`roles`、`role_permissions`、`users`、`sessions`、`registration_invites`、`password_reset_tokens`、`login_attempts`、`audit_events`、`app_settings`、`refresh_token_reuse_events`、`role_change_events` |
| `users` 关键列 | `email`、`email_normalized`(U)、`username(_normalized)`(U)、`display_name`、`password_hash`、`status`、`plan_tag`、`must_change_password`、**`email_verified_at`（列已存在；`usersRepo` 的 INSERT 列清单包含它，但调用方恒传 `null`，全库没有任何 UPDATE 写非空值）**、`avatar_url`、`locale`、`timezone`、`note`、`last_login_at`、`failed_login_count`、`lock_count`、`locked_until`、`deleted_at` |
| `sessions` 关键列 | `client`(web/desktop)、`access_token_hash`(U)、`refresh_token_hash`(U)、`device_name`、`platform`、`app_version`、`ip`、`user_agent`、`last_seen_at`、`access_expires_at`、`refresh_expires_at`、`revoked_at`、`revoked_reason`、`device_key`（0004 增列，部分索引） |
| 迁移规则 | 单事务、只做加法、**启动期永不 DROP**；`db:migrate` 幂等（README 要求连跑两次第二次 "nothing to do"） |
| 信封 | `ok(data,{status,message})` / `fail(error)`：`{success,message,timestamp,data}` 与 `{success:false,message,timestamp,error_code,error_details?,error:{code,message,details?}}`；每个响应带 `x-request-id`；`Cache-Control: no-store` |
| 错误码 | `ERROR_STATUS` 30 个（`invalid_request`…`service_unavailable`） |
| 守卫 | `server/auth/guards.ts`：`requireAdminWrite()`（权限 → CSRF → `admin:write` 预算）/ `requireAdminRead()`（权限 → `read:user` 预算）；`can(session, permission)`；页面侧 `src/lib/session.ts` 的 `currentSession()` |
| 限流 | 进程内滑窗 `hit(scope,key,limit,windowMs)`：登录 20/5 min/IP 与 12/5 min/标识、注册 10/h、重置 3/h、管理写 120/min |
| 设置 | `settingsService` 白名单 11 键（`registration.enabled`、`invite.required`、`security.loginMaxAttempts`、`security.loginLockMinutes`、`security.maxActiveSessions`、`session.webTtlHours`、`session.desktopRefreshDays`、`client.minVersion`、`app.maintenanceMessage`、`branding.appName`、`branding.supportEmail`），未知键 = 422 |
| 审计 | `audit_events`；现有动作 25 个：`auth.login`、`auth.login_blocked_maintenance`、`auth.login_blocked_outdated_client`、`auth.logout`、`auth.password_changed`、`auth.password_reset`、`auth.reset_requested`、`auth.session_relogin`、`auth.session_revoked`、`authz.denied`、`invite.create`、`invite.revoke`、`role.*`、`session.revoke`、`settings.update`、`user.create`、`user.deletion_requested`、`user.password_reset`、`user.profile_updated`、`user.register`、`user.restore`、`user.unlock`、`user.update` |
| 邮件 | `server/mail/mailer.ts`：`isMailEnabled()`、`sendPasswordResetMail()`、`buildResetUrl()`、`interface PasswordResetMail`；`nodemailer` 是**运行时硬依赖**（静态 `import` + `dependencies` + `next.config.mjs` 的 `serverExternalPackages`，不是可选依赖）；SMTP 关则 `getTransporter()` 返回 `null` 且函数返回 `false`，调用方不得报错。**现状缺口**：`createTransport({ host, port, secure, auth })` 没有任何 `connectionTimeout`/`socketTimeout`/`greetingTimeout`，`sendMail` 也不带超时 → 唯一的既存上界是 nodemailer 默认 socketTimeout（1 小时）。本轮"同步有界投递"必须先补这一层（§3.3） |
| i18n | `src/lib/i18n.ts`，`LOCALES = ['zh-CN','en-US']`，扁平 `Dictionary`，`tests/unit/i18n.test.ts` 断言两字典 key 集完全一致 |
| 测试 | 19 个测试文件（6 integration / 10 unit / 3 setup），174 tests；`scripts/smoke.mjs` 62 条端到端断言（对运行中的 standalone）；**无 Playwright、无 axe** |

### 2.2 桌面端登录闸门（`desktop/` + `src/`）

| 维度 | 现状 |
|---|---|
| 主进程 | `authConfig.js`（配置/env → AuthConfig、`deriveDeviceKey()`、`resolveGate()`）、`authPolicy.js`（`decideStartup()` 12 行表、`graceDeadline()`、`nextTimerDelay()`）、`authSessionStore.js`（`safeStorage` 信封 → `userData/auth-session.json`）、`authHttp.js`（唯一 HTTP 客户端）、`localAdmin.js`（`timingSafeEqual` + 失败锁）、`authController.js`（状态机 / 单飞 refresh / 心跳）、`authBridge.js`（10 个 `ipcMain.handle`） |
| IPC | 10 个通道：`auth:status`、`auth:login`、`auth:login-local`、`auth:logout`、`auth:register`、`auth:change-password`、`auth:reset-request`、`auth:list-sessions`、`auth:revoke-session`、`auth:open-external`，外加事件 `auth:changed`；`mustChangePassword` 时只放行 5 个通道（`STATUS`/`CHANGE_PASSWORD`/`LOGOUT`/`LIST_SESSIONS`/`REVOKE_SESSION`） |
| 已调端点 | `/health`、`/meta`、`/auth/{login,register,refresh,heartbeat,logout,password/change,password/reset/request}`、`/me/sessions`、`/me/sessions/{id}`。**没有** `/me`（GET/PATCH）、`/me/activity`、`/auth/email/verify/resend` |
| 渲染侧类型 | `src/lib/api/authBridge.ts`：`AuthStatus`（`state`/`source`/`reason`/`user`/`sessionId`/`expiresAt`/`lastVerifiedAt`/`graceUntil`/`mustChangePassword`/`appVersion`/`server`/`reachable`/`lockedUntil`/`attemptsLeft`/`securityWarning`）、`SessionUser`（`id`/`email`/`username`/`displayName`/`avatarUrl`/`status`/`planTag`/`mustChangePassword`/`role{key,name}`/`permissions`）、`SessionInfo`、`ServerMeta`（含 `smtpEnabled`） |
| 账号入口 | `AccountMenu.tsx` 四项：我的设备（内嵌面板）、修改口令（`ChangePasswordDialog`）、打开账号中心（`openExternal`）、退出登录 |
| 凭据安全 | 令牌只在主进程；`auth:*` 通道不返回 `accessToken`/`refreshToken`；`open-external` 走 https + host 白名单（`id.ecliptrix.app` 等） |
| 测试 | `desktop/ npm run test:auth` 6 套 / 107 checks；`node scripts/auth-smoke.js` 14 条（假账号服务器）；渲染侧 5 文件 / 29 tests |

### 2.3 缺口（本轮要填的洞，与 §4 阶段一一对应）

| # | 缺口 | 证据 | 阶段 |
|---|---|---|---|
| G1 | 没有任何持久化的邮件发送记录，SMTP 关闭时用户与管理员都看不到"信发没发出去" | `mailer.ts` 只 `sendMail` 不落库 | P0 |
| G2 | `email_verified_at` 没有任何写点会把非 NULL 值写进去，注册后无法验证邮箱 | 列与读路径存在（`0001_init.sql`、`db/types.ts`、`usersRepo` 的 SELECT+INSERT、`http/dto.ts`），但无任何 `UPDATE … email_verified_at`，INSERT 恒绑 `null` | P1 |
| G3 | 用户无法自助换邮箱；`PATCH /me` 也不允许改邮箱（`account.profile.email` 文案写死"由管理员维护"） | `src/lib/i18n.ts` 文案 + `profileService` | P2 |
| G4 | 邀请码只能复制粘贴，不能发信 | `inviteService.create` 无邮件 | P3 |
| G5 | 无数据导出端点 | 路由清单无 `/me/export`（R1 §8.3 #7 推迟） | P4 |
| G6 | 注销只有一条审计与管理员通知，用户无法确认、无法取消，账号永不消失 | `profileService.requestAccountDeletion`（R1 D-01） | P5 |
| G7 | 桌面端账号中心是跳浏览器，资料/安全/活动无法原地操作 | `AccountMenu.tsx` 的 `openExternal` | P6 |
| G8 | 管理员看不到全局在线会话；概览无登录/会话趋势与版本分布；用户列表不能导出 | `metricsService.overview()`、`/admin/sessions` 缺失 | P7 |
| G9 | 无浏览器级 e2e、无 a11y 闸门、无邮件/注销的端到端断言 | `tests/` 只有 vitest；`smoke.mjs` 62 条 | P8 |

---

## 3. Technical Design

### 3.1 架构与不变量

沿用 R1 的三层铁律（页面 → service → repository，SQL 只在 repository）与两条守卫入口（`requireAdminWrite` / `requireAdminRead`）。本轮新增的是**一个横向能力（邮件）**与**三个领域服务（验证、导出、注销）**，它们都必须落在既有分层里，不允许在 route 里写 SQL 或直接 `nodemailer.sendMail`。

```
route.ts ──zod──> guards ──> service ──> repository ──> SQLite
                                │
                                └──> mailService.queue() ──> mail_outbox ──> (SMTP | captured)
```

四条硬约束：

1. **`mailService` 是唯一发送出口**。`server/mail/mailer.ts` 退化为"SMTP 传输层"，只保留 `isMailEnabled()`、`sendRaw()`；模板渲染、脱敏、落库、限流全部在 `mailService`。旧的 `sendPasswordResetMail` 迁入模板 `password-reset`，调用点改为 `mailService.queue(...)`；**不保留两条路径**。
2. **渲染层不做网络请求**（R2 D2-01）。桌面端新能力必须经 IPC；账号中心对话框只消费 `window.ecliptrixDesktop.auth`。
3. **页面不 fetch 自己的 API**（R1 分层）。`/admin/sessions`、`/admin/mail` 是 RSC，直接调 service；交互（分页/筛选/批量）走 URL `searchParams` + `useRouter`，与 `users-table.tsx` 完全同构。
4. **可序列化边界**：server component 只向 client component 传 `locale`（字符串）、DTO、布尔权限位；**永不传函数**（R1 实施缺陷记录过：传函数在客户端组件渲染期抛错，整页 500）。

### 3.2 新增模块与职责

| 模块 | 职责 | 禁止 |
|---|---|---|
| `server/services/mailService.ts` | 模板选择 → 渲染 → 令牌脱敏 → 落 outbox → 限流 → 调 `mailer.sendRaw` → 回写状态；`deliver(outboxId)` 单次尝试、永不抛 | 被 route 直接调用以外的业务逻辑；不得泄漏令牌到返回值与日志 |
| `server/mail/templates.ts` | 12 个模板的 `subject/text/html`（zh-CN + en-US 双份），纯函数 `render(template, params, locale)` | 不做 IO；不读 DB/配置 |
| `server/mail/links.ts` | `buildVerifyUrl()` / `buildChangeEmailUrl()` / `buildDeletionUrl()` / `buildInviteUrl()` / `buildResetUrl()`（迁入）；统一基于 `PUBLIC_BASE_URL` | 不拼接未编码参数 |
| `server/services/emailVerificationService.ts` | 发验证信（注册时 / 重发）、消费验证令牌、换邮箱双确认、管理员强制标记已验证 | 不直接发信（只调 mailService） |
| `server/services/accountExportService.ts` | 组装导出 JSON、冷却期判定、脱敏（无哈希、无令牌） | 不返回任何 `*_hash` 字段 |
| `server/services/accountDeletionService.ts` | 申请 → 确认 → 排期 → 取消 → 执行（匿名化）、清扫入口 `sweepDue()` | 物理删除 `users` 行；删除审计 |
| `server/services/maintenanceService.ts` | 惰性清扫（每小时至多一次）：到期注销、过期令牌、outbox 保留期 | 在 request 关键路径做重活（> 5 ms 的批量循环走事务批量） |
| `server/services/adminSessionService.ts` | 全局会话查询、批量吊销 | 不复用单会话 `sessionService` 的 404 语义（批量取不到就跳过并计数） |

### 3.3 邮件管线（P0）

**状态机**（`mail_outbox.status`）：

```
captured ──deliver ok──> sent
   │
   └──deliver fail──> failed ──admin retry──> captured ──> …
```

- `captured`：已落库，SMTP 未配置（`isMailEnabled() === false`）或尚未尝试。开发期用它当 outbox 浏览内容。
- `failed`：尝试过且失败，`attempts` 自增、`last_error` 记录 `error.name + 无敏感 message`（最多 200 字符）。
- 仅 `retryable = 1` 的模板允许 `/admin/mail/{id}/retry`；带令牌的模板（`verify-email`、`change-email-confirm`、`password-reset`、`invite`、`deletion-confirm`）为 `retryable = 0`，因为库里只存了脱敏后的 `token=***`。管理员看到的是"该邮件含一次性链接，不能重试；请让用户重新申请"。

**传输层超时契约（P0-1，必须先做）**：`mailer.ts` 收窄为 `isMailEnabled()` + `sendRaw(input): Promise<TransportResult>`，并**在 `createTransport` 上显式设置三个超时**，全部由 `MAIL_SEND_TIMEOUT_MS`（默认 5000，范围 500–20000）派生：

```ts
nodemailer.createTransport({
  host, port, secure, auth,
  connectionTimeout: sendTimeoutMs,
  greetingTimeout:   sendTimeoutMs,
  socketTimeout:     sendTimeoutMs,
})
```

不设置就是 nodemailer 默认的 1 小时 socketTimeout——那会让一次"SMTP 主机不可达"变成注册接口挂起一小时。`sendRaw` 只做一件事：投递并返回 `{ ok: true } | { ok: false, errorName }`，**只回错误类名，不回 message**（message 可能含服务器地址与账号片段）。

**发送时序（先落库，再尽力投递）**：

1. service 层生成令牌（明文只在内存）→ 调 `mailService.queue({ template, to, locale, userId, params })`。
2. `queue` **先**插 outbox（`payload` 内令牌写成 `token=***`），再尝试一次投递，单次上限 = `MAIL_SEND_TIMEOUT_MS`。
3. 投递失败只写 `failed` + `log('warn', 'mail delivery failed', { outboxId, template })`（不含收件人明文与令牌），**API 结果不变**。
4. `queue` 返回 `{ id, status }`，service 层**不得**把这个 status 映射成 HTTP 错误。
5. **用户热路径不等待投递**：注册、重发验证、换邮箱、注销申请/取消、三条安全通知，一律 `void mailService.queue(...)`（outbox 已落库，投递结果由状态页/管理员重试接管）。理由：这些路径的响应时间是产品体验，而 5 s 的最坏同步等待在移动网络下的 SMTP 上是常态。**唯一同步等待的是 `POST /admin/mail/{id}/retry`**——管理员点的就是"现在发，告诉我结果"。
6. 因此 §7.1 的 `smtp failure leaves api result unchanged` 用例必须用"注入一个必失败的 transport"来断言，而不是靠超时。

**限流**（沿用 `server/auth/rateLimit.ts` 的 `hit()`）：

| scope | 键 | 预算 | 说明 |
|---|---|---|---|
| `mailVerifyResend` | `user:{id}` | 3 / h | 重发验证信 |
| `mailVerifyResendIp` | `ip` | 10 / h | 防批量刷 |
| `mailChangeEmail` | `user:{id}` | 3 / 24 h | 换邮箱 |
| `mailInvite` | `admin:{id}` | 60 / h | 邀请邮件随邀请码创建 |
| `mailDeletion` | `user:{id}` | 3 / h | 注销申请/取消 |
| `emailVerifyConsume` | `ip` | 60 / h | **两个无会话消费端点**（`/auth/email/verify`、`/auth/deletion/confirm`）共用。令牌是 32 字节随机数、不可爆破，但这两条路径会做一次 DB 查询 + 一次审计，无预算就是放大面（P2-5） |

外加上限兜底：`mail_outbox` 每 24 h 每用户最多 20 行；超过直接 `captured` 但不投递（`last_error='daily_cap'`）——这保证被入侵的账号无法把服务器变成发信机。**口径说明**：上限按 `to_user_id` 统计，因此管理员发出的邀请邮件（无 `to_user_id`）不受这一条约束，它们的预算是上表的 `mailInvite`（`admin:{id}`，60/h）（P2-3）。

**开发期可见性**：`/admin/mail` 列表 + 详情（正文渲染结果、状态、尝试次数、`last_error`）。E2E 与集成测试因此可以断言"验证信已进入 outbox"而无需真实 SMTP。

### 3.4 邮箱验证（P1）

**状态**：`users.email_verified_at`（已存在）。`NULL` = 未验证，非空 = 已验证时间。

**生命周期的四个动作**：

1. **注册即发信**：`authService.register` 成功后（注册即登录，R2 行为，不改）调用 `emailVerificationService.issueFor(user, { trigger: 'register' })` → 建 `email_action_tokens`（`purpose='verify'`，TTL `mail.verificationTtlHours` 默认 48 h）→ 发 `verify-email`。
2. **重发**：`POST /api/v1/auth/email/verify/resend`（需会话，Bearer 或 Cookie）。邮件通道可用时返回 `202 { sentAt, expiresAt }`（是否真的送达不反映在响应里，与 R1 §2.10 的枚举防护一致）；邮件未配置返回 `503 mail_disabled`；已验证的账号返回 `409 email_already_verified`（明确语义优于静默吞掉——这里不存在枚举风险，因为调用方已登录）。
3. **消费**：`POST /api/v1/auth/email/verify` `{ token }` → 查 `purpose='verify'` 活跃行 → 未过期未使用 → 事务内 `users.email_verified_at = now`、令牌 `used_at = now`、审计 `auth.email_verified` → `200 { email, verifiedAt }`。无效/过期/已用/用途不符统一 `400 token_invalid`（不区分原因，防探测）。
4. **管理员覆盖**：`POST /api/v1/admin/users/{id}/email-verify`（`users.write`）→ 直接置位 + 审计 `user.email_verified_by_admin`（支持"用户收不到信，人工放行"）。

**令牌发放的三条硬规则（P0-3，违反任一条就是 500）——动作 1/2 与 §3.5 的换邮箱令牌都适用**：

1. **先置后插**：在**同一个 `better-sqlite3` 事务**内，先把该 `(user_id, purpose)` 下所有 `used_at IS NULL` 的行置为 `used_at = now`，再 `INSERT` 新行。反过来（先插后置）必然撞 `idx_email_action_live`。仓库既有正确范例：`passwordResetsRepo` 的先 `UPDATE` 后 `INSERT`。
2. **"所有未用行"包含已过期的行**：局部唯一索引的谓词是 `WHERE used_at IS NULL`，不含 `expires_at`。一条 48 h 前发出的、从未使用过的旧令牌仍然占着唯一槽——只按"未过期"清理会让"用户第二天再点重新发送"直接 `SQLITE_CONSTRAINT_UNIQUE`。
3. **不删行**：旧行只置 `used_at`，保留用于事后审计（"这封信什么时候被谁作废"）。过期清理交给 `db:prune`。

**强制策略**（可选开关）：`mail.verificationRequired`（默认 `false`）。为 `true` 时：

- **只对 `POST /auth/login` 施加**：未验证的桌面端（`client='desktop'`）返回 `403 email_not_verified`，`details: { redirect: '/verify-email' }`。**`/auth/register` 不施加此闸门**（P0-4）：注册刚建的用户必然未验证，若同时也拦，注册就永远返回 403，新用户进不来、验证信也没有收件人——设计会自锁。注册照常 `201`（`user.emailVerified=false`），由桌面端的未验证黄条 + "重新发送验证邮件"接管。
- 网页端不受影响（网页正是用户去收信/重发的地方）；
- 管理员（`admin`/`owner` 角色）与破窗账号永不受此限；
- 该 403 **不**计入 `failed_login_count`（与 426 版本闸门同样的处理，见 R2 实施记录），插入点必须在口令验证**之后**（`verifyCredentials` 成功、`markLoggedIn`/`replaceDeviceSession` 之前）：这样它不会变成"账号是否存在 / 是否已验证"的枚举探针，也不会顶掉本机既有会话。

**桌面端可见性**：`ServerMeta` 增加 `emailVerificationRequired: boolean`；`SessionUser` 增加 `emailVerified: boolean`。未验证时账号中心与 AccountMenu 显示黄条 + "重新发送验证邮件"。

### 3.5 更换邮箱（P2）

双确认，旧地址与管理员都可感知：

1. `POST /api/v1/me/email/change` `{ password, newEmail }`（需会话 + CSRF 或 Bearer）：
   - 校验口令（`password.verify`）；错 → `401 password_mismatch`；
   - `newEmail` 规范化后：与当前邮箱相同 → `422 validation_failed`；已被占用 → `409 email_taken`；
   - 若存在活跃 `purpose='change_email'` 令牌且 `created_at > now - 10 min` → `429 rate_limited`（`Retry-After` 给出剩余秒数）；
   - 写令牌（`email_normalized = 新邮箱`，TTL `mail.emailChangeTtlHours` 默认 24 h，一用户一活跃）→ 发两封信：`change-email-confirm`（发到**新**地址，含确认链接）与 `email-change-notice`（发到**旧**地址，仅告知，无链接）；
   - 恒 `202 { pendingEmail, expiresAt }`（`email_taken` 之外不泄漏更多）。
2. `POST /api/v1/auth/email/verify` `{ token }` 对 `purpose='change_email'`：
   - 事务内：校验再占用（并发下唯一索引兜底 `email_taken`）→ `users.email`/`email_normalized` 更新、`email_verified_at = now`（新地址视为已验证，因为用户刚刚证明了控制权）→ 令牌 `used_at` → **撤销该用户除当前外全部会话**（`revoked_reason='email_changed'`）→ 审计 `user.email_changed`（metadata 只放 `{ from: 'a***@x.com', to: 'b***@y.com' }` 脱敏形式）→ 发 `email-changed` 到旧地址；
   - `200 { email: 新邮箱, sessionsRevoked: n }`。
3. `DELETE /api/v1/me/email/change` → 取消待确认（`200`），审计 `user.email_change_cancelled`。
4. `GET /api/v1/me` 增加 `pendingEmail: string | null`（只回 `email_action_tokens` 的脱敏目标：`b***@y.com`，避免把待确认地址当既成事实）。

**为什么要双确认**：只验证新地址无法阻止攻击者把受害者的账号"改成自己的邮箱再走找回"；旧地址通知是唯一的止损窗口。

### 3.6 邀请邮件与安全通知（P3）

**邀请邮件**：`POST /admin/invites` 现有请求体新增可选 `email`、`note`。填了 `email` 时：创建邀请码 → 发 `invite`（收件人 `email`，正文含 `code` 与 `${PUBLIC_BASE_URL}/register?invite={code}`）→ 响应 `201 { invite, mailStatus }`。**明文邀请码只在这一封信里出现一次**（库里 `code_hash` + `code_hint`），因此该邮件 `retryable = 0`；未填 `email` 时行为与现在完全一致（响应仍返回 `code` 供手工复制）。

**通知邮件**（全部受 `app_settings` 开关控制，默认开）：

| 模板 | 触发 | 开关 |
|---|---|---|
| `new-device` | 桌面端登录成功且 `deviceKey` 与已存在会话的最近 5 条都不同（新设备/新 profile） | `mail.notifyNewDevice` |
| `password-changed` | 自助改密成功（`auth.password_changed`） | `mail.notifyPasswordChange` |
| `deletion-confirm` / `deletion-scheduled` / `deletion-cancelled` / `deletion-completed` | 见 §3.8 | 固定发送（合规信，不可关） |

通知失败不影响主流程；不使用事务外键写库顺序问题（outbox 的 `to_user_id` 为 `ON DELETE SET NULL`）。

### 3.7 数据导出（P4）

`GET /api/v1/me/export`（需会话，`GET` 天然免 CSRF；限流按 `account.exportCooldownMinutes`）。响应 `200`，`Content-Type: application/json; charset=utf-8`，`Content-Disposition: attachment; filename="ecliptrix-account-<userid 前 8>-<yyyymmdd>.json"`，`Cache-Control: no-store`。

**附件响应约定（P1-4，必须照抄，否则下载会变成被信封包住的 JSON）**：`withContext` 的 handler 契约是"返回 `NextResponse`"，而 `ok()` 只会 `NextResponse.json` 且强制 `Cache-Control: no-store`。因此**两个导出端点不走 `ok()`**，直接用：

```ts
const response = new NextResponse(body, { status: 200, headers: { … } })
response.headers.set('Content-Type', 'application/json; charset=utf-8')      // CSV 用 'text/csv; charset=utf-8'
response.headers.set('Content-Disposition', `attachment; filename="${name}"`)
response.headers.set('Cache-Control', 'no-store, max-age=0')
return response
```

- `x-request-id` 由 `withContext` 统一补（它拿到 handler 的返回值后 `headers.set(REQUEST_ID_HEADER, …)`），**不要在 route 里再设一次**。
- 冷却期/权限等失败分支**照旧 `throw`**，由 `withContext` 的 `fail()` 统一回信封——错误永远是 JSON，只有成功体是附件。这一点要写进测试：`429` 的 `content-type` 必须是 `application/json`。
- 文件名中的 `<userid 前 8>` 必须 `encodeURIComponent` 化并只保留 `[a-zA-Z0-9_-]`（用户名可控的输入不进头部）。

```jsonc
{
  "format": "ecliptrix.account.export",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "account": { "id": "…", "email": "…", "username": "…", "displayName": "…", "status": "active",
               "planTag": "free", "locale": "zh-CN", "timezone": "Asia/Shanghai",
               "emailVerifiedAt": null, "createdAt": "…", "lastLoginAt": null, "role": { "key": "member", "name": "成员" } },
  "sessions": [{ "id": "…", "client": "desktop", "deviceName": "…", "platform": "win32",
                 "appVersion": "1.0.3", "ip": "…", "createdAt": "…", "lastSeenAt": "…",
                 "revokedAt": null, "revokedReason": null }],
  "activity": [{ "action": "auth.login", "targetType": "user", "targetId": "…", "ip": "…",
                 "createdAt": "…", "metadata": { } }],
  "invites": { "created": [], "redeemed": [] },
  "deletion": null,
  "truncated": { "activity": false }
}
```

- `activity` 上限 5000 行（按 `created_at DESC`），超出置 `truncated.activity=true` 并在 UI 提示"可在审计页按需查询"。
- **绝不包含**：`password_hash`、任何 `*_token_hash`、`refresh_token_reuse_events`、他人数据。
- 冷却期：**数据源是 `users.last_exported_at`（本轮迁移新增列），不是审计表**（P1-13）。理由是 `auditService.record()` 明确声明"永不抛出"（异常被吞，只打日志），且 `audit.retentionDays` 会把旧行删掉——用一个 best-effort 且会被清理的表来判定"是否在冷却期内"，既可能失效也可能误放行。未满冷却 → `429 rate_limited`（`details.retryAfterSeconds`）。成功后同时做两件事：事务内写 `users.last_exported_at = now`，并行写 `user.exported` 审计（metadata 只放 `{ activityRows, sessions }`）。
- 桌面端不实现导出下载（沙箱与保存对话框成本高）：账号中心"导出我的数据"按钮复用 `openExternal` 打开**当前账号服务的** `${baseUrl}/account`，并在按钮旁写明"将在浏览器中完成"。**注意 URL 来源**（P1-8）：渲染层现有 `accountCenterUrl()` 用的是**构建期** `NEXT_PUBLIC_ACCOUNT_SERVER_URL`（兜底硬编码 `https://ecliptrix.app`），自建实例下会把用户送到厂商站点。改为优先取运行时 `status.server.baseUrl`，为空才回落构建期常量；两者都为空（例如离线宽限登录）时按钮 `disabled` 且文案说明"账号服务地址未知"。`auth:open-external` 的白名单已动态接纳"已配置服务器 host"，因此改 URL 不会撞白名单。

### 3.8 真实注销（P5）

**状态机**（`account_deletion_requests.status`）：

```
(无) ──申请──> awaiting_confirmation ──确认──> scheduled ──到期──> completed
                     │                            │
                     └──────取消/新申请────────────┘──> cancelled
```

- **邮件可用**：申请 → `awaiting_confirmation`（发 `deletion-confirm`，链接 `/confirm-deletion?token=…`）→ 用户点链接或 POST 确认 → `scheduled`（`scheduled_for = now + account.deletionGraceHours`，默认 72 h；发 `deletion-scheduled`，含取消入口）。
- **邮件不可用**（`isMailEnabled() === false`）：申请直接进入 `scheduled`（跳过确认，响应 `requiresConfirmation:false`），并由 `mail_outbox` 写一条 `captured` 的 `deletion-scheduled`，管理员在 `/admin/mail` 与审计里可见。这条降级必须写进 README 与 `docs/api.md`，因为它意味着"无邮件部署下注销不需要邮箱确认"。
- **取消**：`DELETE /api/v1/me/deletion-request` → `cancelled` + 审计 `account.deletion_cancelled` + 发 `deletion-cancelled`；用户也可重新申请（覆盖旧申请，旧行置 `cancelled`）。
- **令牌列与"覆盖旧申请"的顺序（P0-2、P0-3 同源）**：`account_deletion_requests.token_hash` 在本轮 DDL 里是**可空**列（§6.1）：只有"发确认信"的分支写哈希，无邮件降级路径写 `NULL`。写空串 `''` 会让第二次申请撞 UNIQUE（全表只能有一行 `''`），随后所有注销请求都是 500。同样，"重新申请覆盖旧申请"必须**先**在同一事务内把旧行置 `status='cancelled'`、**再**插新行，否则撞 `idx_deletion_live`。
- **管理员代确认与离线破窗（P1-11）**：用户丢了邮箱访问权时，不能因为"点不了确认链接"就永远注销不了（对照：口令找回早有 `user:reset` 破窗）。两条通道：`POST /api/v1/admin/users/{id}/deletion`（`users.delete`；把 `awaiting_confirmation` 推进到 `scheduled` 或直接排期，写审计 `account.deletion_confirmed_by_admin`，`reason` ≤200 字）与离线 CLI `npm run account:confirm-deletion -- --email a@b.c [--force]`。两者**都不跳过冷静期**，也都不跳过审计。
- **审计与隐私（P1-10）**：申请/确认/取消的审计 metadata **一律只放脱敏邮箱**（`a***@b.c`）。现网 `profileService.requestAccountDeletion` 写的是 `metadata: { email: user.email_normalized }`——完整明文邮箱永久留在 `audit_events`，与 §6.3 的脱敏规则和 R1 的审计原则直接冲突，本轮必须一并改掉。
- **到期执行**（`maintenanceService.sweepDue()` 或 CLI `npm run accounts:sweep`）：`status='scheduled' AND scheduled_for <= now` 的行，逐行事务：
  1. 读旧邮箱/用户名（用于发信与审计脱敏）；
  2. `users`：`status='deleted'`、`deleted_at=now`、`email='deleted+<id 前 8>@deleted.invalid'`、`email_normalized` 同步、`username='deleted_<id 前 8>'`（`username_normalized` 同步）、`display_name='已注销账号'`、`password_hash=<48 字节随机 base64>`、`avatar_url=NULL`、`note=''`、`must_change_password=0`、`locked_until=NULL`、`failed_login_count=0`；
  3. `sessions`：全部 `revoked_at=now`、`revoked_reason='account_deleted'`；
  4. `email_action_tokens` / `password_reset_tokens`：该用户全部 `used_at=now`；
  5. `registration_invites`：`created_by` 已被 `ON DELETE SET NULL`… 但本轮不做物理删除，改为不动（邀请码保留，`code_hint` 不含个人信息）；
  6. 审计 `account.deleted`（`target_type='user'`，metadata `{ priorEmailMasked, sessionsRevoked, requestId }`）；
  7. 发 `deletion-completed` 到旧邮箱（失败不影响执行）；
  8. 请求行 `status='completed'`、`completed_at=now`。
- **保护规则**：`owner` 角色不能申请注销（`409 cannot_modify_owner`）；系统内最后一个 `owner` 或最后一个 `admin` 级账号（`users.write` 权限持有者）不能注销（`409 conflict` + 文案提示先转移权限）；管理员可用既有 `PATCH /admin/users/{id}` 提前停用（`suspended`）以阻止注销（`403 account_suspended` 优先于注销）。
- **桌面端收尾**：被注销用户的下一次心跳（≤15 min）返回 `401 session_revoked`，`error_details.reason='account_deleted'`；`authController` 映射为 `reason='account-deleted'`（新增 `AuthReason`），清空本地会话并显示"账号已注销"页（与 `session-revoked` 文案区分）。90 天刷新令牌随之失效（会话已 revoked）。
- **"已注销后再登录"的正确语义（P1-5）**：`authService` 对 `status === 'deleted'` 的账号**已经**返回 `invalid_credentials`（并且刻意不写 `login_attempts`）——这是防枚举设计，不许为了"更好的文案"改掉它。因此 `account-deleted` 这个 reason **只可能出现在已登录会话的心跳/refresh 401 上**；登录屏不要为它写"专用文案"，那会变成"这个邮箱曾经存在过"的探针。§3.10 与 §6.5 的措辞按此收敛。
- **与既有 `REVOKE_REASON.deleted` 的边界（P1-12）**：`constants.ts` 里已有 `REVOKE_REASON.deleted = 'deleted'`，`userService` 在管理员删除/停用用户时用它 `revokeAllForUser`。本轮的自助注销用新的 `account_deleted`。两者**语义不同**（管理员删 vs 本人注销），但桌面端必须把**两个值都**映射到 `account-deleted` 这一 reason——`authErrors`/`authController` 的映射表要同时含 `deleted` 与 `account_deleted`，否则"管理员删号"会落进未知分支，用户看到的是"未知错误"。

### 3.9 后台治理（P7）

**`/admin/sessions`（新页面）**

- 权限：页面 `users.read`；批量吊销 `sessions.revoke`。**注意 `support` 角色也持有 `sessions.revoke`**（`permissions.ts` 的 `SYSTEM_ROLE_PERMISSIONS.support = ['users.read','sessions.revoke','audit.read']`），所以客服**能**批量踢下线——这是既有角色设计，不是漏洞，但 AC-31 的期望值必须照此写（P1-3）。
- 数据：`adminSessionService.listAll({ query, client, platform, activeOnly, page })` → 行 DTO `{ id, userId, userEmail, userDisplayName, client, deviceName, platform, appVersion, deviceKeyPrefix8, ip, createdAt, lastSeenAt, revokedAt, revokedReason, active }`。
- UI：与 `users-table.tsx` 同构（URL 驱动筛选 + `parsePage`/`buildPageMeta`），表头可按 `last_seen_at` / `created_at` 排序，行内"吊销"与表头"吊销所选"（二次确认，`ConfirmDialog`）。
- 端点：`GET /api/v1/admin/sessions`、`POST /api/v1/admin/sessions/revoke` `{ ids: string[] (≤100), reason?: string }` → `{ revoked: n, skipped: m }`，审计 `admin.sessions_revoked`（每个 id 一行还是聚合一行？→ **聚合一行**，metadata `{ count, reason }`，避免一次点击写 100 行审计）。
- `reason` 白名单：`admin_revoke`（默认）、`admin_lockdown`、`security_incident`。

**`/admin/mail`（新页面）**

- 权限：查看 `settings.read`；**重试 `users.write`**（P1-3：v1 写的 `settings.write` 只有 `owner` 持有——`SYSTEM_ROLE_PERMISSIONS.admin` 不含它——那会让"管理员能重试邮件"变成"只有超管能重试"，与"运维可自助"的初衷相反。`users.write` 由 owner 与 admin 共同持有，`support` 没有，语义正好）。
- 列表：`GET /api/v1/admin/mail?status&template&page` → `{ rows, total, page }`，行 `{ id, template, toMasked, status, attempts, createdAt, sentAt, retryable }`（收件人一律脱敏 `a***@x.com`）。
- 详情：`GET /api/v1/admin/mail/{id}` → 含渲染后的 `subject` 与 `text`（**html 不回传**，避免把管理员页面变成渲染器），`payload` 已脱敏。UI 用 `<pre>` 展示文本。
- 重试：`POST /api/v1/admin/mail/{id}/retry` → `captured` → **同步**尝试投递（唯一同步等待点，见 §3.3-5）→ 返回最新状态；`retryable=0` → `409 conflict` + 文案。

**新增管理端点的真实权限矩阵（P1-3，AC-31 的期望值逐格取自本表）**

权限来源：`permissions.ts` 的 `SYSTEM_ROLE_PERMISSIONS`（`owner=['*']`、`admin` 有 `users.read/write/delete`+`roles.read`+`invites.read/write`+`audit.read`+`settings.read`+`sessions.revoke`、`support=['users.read','sessions.revoke','audit.read']`、`member=[]`）。

| 端点 | 权限键 | owner | admin | support | member |
|---|---|---|---|---|---|
| `GET /admin/sessions` | `users.read` | 200 | 200 | 200 | 403 |
| `POST /admin/sessions/revoke` | `sessions.revoke` | 200 | 200 | **200** | 403 |
| `GET /admin/mail`、`GET /admin/mail/{id}` | `settings.read` | 200 | 200 | 403 | 403 |
| `POST /admin/mail/{id}/retry` | `users.write` | 200 | **200** | 403 | 403 |
| `GET /admin/users/export` | `users.read` | 200 | 200 | 200 | 403 |
| `POST /admin/users/{id}/email-verify` | `users.write` | 200 | 200 | 403 | 403 |
| `POST /admin/users/{id}/deletion` | `users.delete` | 200 | 200 | 403 | 403 |
| `GET /admin/metrics` | `users.read` | 200 | 200 | 200 | 403 |
| `GET` / `PATCH /admin/settings` | `settings.read` / `settings.write` | 200 / 200 | 200 / **403** | 403 | 403 |

> 最后一行的 `admin / 403` 是**既有事实**（设置页可由管理员查看，但保存只有 `owner` 能做），本轮不改变它；写进矩阵是为了不再出现"AC 里假设管理员能保存设置"这类错误期望。如需改变，属独立需求（见 §9）。

**`/admin` 概览扩展**

`GET /api/v1/admin/metrics?days=14|30`（默认 14，范围 7–90）：

```ts
interface OverviewMetricsV2 extends OverviewMetrics {   // 既有字段全部保留
  loginsTrend: TrendPoint[]        // login_attempts.success=1 按天
  sessionsTrend: TrendPoint[]      // sessions.created_at 按天（新会话）
  emailVerifiedRate: number        // 已验证用户 / 非 deleted 用户
  pendingDeletions: number         // status IN ('awaiting_confirmation','scheduled')
  clientBreakdown: { platform: string; appVersion: string; sessions: number }[]  // 活跃会话分组，前 10
}
```

- 查询全部走索引：`users(status,created_at)`、`login_attempts(ip,created_at)` / `identifier,created_at`、`sessions(user_id,created_at)`；本轮**新增** `sessions(created_at)` 与 `login_attempts(created_at)` 索引（迁移 0005）以支撑按天聚合。
- 图表零依赖：`src/components/console/trend-chart.tsx` 用内联 SVG 画柱/折线（`<svg role="img" aria-label>`），不引入 chart 库（与 R1 D-05 "不新增依赖"一致）。

**用户列表 CSV 导出**：`GET /api/v1/admin/users/export`（`users.read`），复用列表的筛选参数，输出 `text/csv; charset=utf-8`（**带 UTF-8 BOM**，否则 Excel 中文乱码），列：`email,username,display_name,role,status,plan_tag,email_verified,created_at,last_login_at,active_sessions`。上限 20000 行；超出时**用响应头表达**（P2-7）：`X-Export-Truncated: 1`，页面据此提示"结果已截断，请缩小筛选范围"（不要静默截断）。导出写审计 `admin.users_exported`（metadata `{ rows, filters }`）。响应构造遵循 §3.7 的"附件响应约定"：`new NextResponse(csv, { headers })`，不走 `ok()`。

**设置页扩展**：新增分组「邮件与账号策略」，字段见 §6.2；顶部一行只读状态条：`邮件投递：SMTP / 仅记录（outbox）`、`发件地址`、`最近 24h 发送：n 成功 / m 失败`（来自 `mail_outbox` 聚合）。

### 3.10 桌面端内嵌账号中心（P6）

`AccountMenu` 的「打开账号中心」拆成两项：

1.「账号中心」（内嵌 `AccountCentreDialog`，默认）；
2.「在浏览器中打开」（保留 `openExternal`，用于导出/查看完整活动）。

`AccountCentreDialog` 四个页签：

| 页签 | 数据来源 | 能力 |
|---|---|---|
| 资料 | `auth:me` → `GET /me` | 显示名、语言、时区可改（`auth:update-profile` → `PATCH /me`）；邮箱只读 + 验证徽标 + 「重新发送验证邮件」（`auth:resend-verification`）+ 「在网页版更换邮箱」链接；注销状态徽标（申请中/已排期） |
| 设备 | `auth:list-sessions`（既有） | 列表 + 逐条吊销（既有） |
| 安全 | 既有 `ChangePasswordDialog` 入口 + 通知开关展示 | 改密（既有）、「同时注销其他设备」 |
| 活动 | `auth:activity` → `GET /me/activity` | 最近 30 条（主进程固定取 `page=1&pageSize=30`），含动作本地化标签、**IP 脱敏（IPv4 保留前两段，由主进程做）**、时间用 `RelativeTime` |

**`auth:activity` 的精确契约（P1-6，与现网端点对齐）**：现网 `GET /me/activity` 回 `{ items: [{ id, action, targetType, targetId, ip, createdAt }], page }`（**原始 `ip`**，且没有 `truncated`）。因此：

- 主进程拿 `items` + `page.total`，**在主进程内**把 `ip` 转成 `ipMasked`（`^(\\d+)\\.(\\d+)\\.` → `$1.$2.x.x`；IPv6 只保留第一段并补 `…`）。渲染层永远拿不到原始 IP——这是"令牌只在主进程"之外的第二条边界（IP 是个人数据）。
- 返回体是 `{ items: ActivityItem[], truncated: boolean }`，`truncated = page.total > items.length`——**语义是"还有更多"，不是"服务端截断"**，所以它是布尔而不是新的服务端字段。
- 动作本地化标签：新增动作必须在 `authActivityLabel` 映射里出现（`auth.timeline.*`），缺键时回落为原始 action 字符串（可见但不友好，避免静默显示空行）。

**新增 IPC 通道**（`CHANNELS`）：`auth:me`、`auth:update-profile`、`auth:activity`、`auth:resend-verification`。`mustChangePassword` 缩口名单从 5 个扩到 6 个（加 `auth:me`，因为强制改密页需要显示"你正在为谁改密"）。`auth:update-profile` 的输入校验：`displayName` 1–64 字符、`locale ∈ {'zh-CN','en-US'}`、`timezone` 长度 ≤ 64 且形如 `Area/City`（宽松正则，服务端为权威校验）。

**能力探测必须逐方法（P1-7）**：渲染侧现有的 `SessionContext` 只判断 `window.ecliptrixDesktop.auth` **整体**是否存在（不存在则 `bridge-unavailable`），它无法识别"bridge 在、但 4 个新方法不在"的旧主进程。所以 `AccountCentreDialog` 打开时先做一次能力探测：

```ts
const can = {
  me: typeof auth?.me === 'function',
  updateProfile: typeof auth?.updateProfile === 'function',
  activity: typeof auth?.activity === 'function',
  resend: typeof auth?.resendVerification === 'function',
}
```

任一为假就降级：页签仍可切换，但只显示 `AuthStatus` 里已有的信息（邮箱/角色/会话数）+「在浏览器中打开」一个按钮，缺能力的按钮**不渲染**（而不是渲染后报错）。这必须有专门用例（`renders without the four methods and degrades`）。

**账号服务地址必须取运行时值（P1-8）**：`AccountMenu`/`AccountCentreDialog` 里所有"在浏览器中打开"的链接都从 `status.server.baseUrl`（运行时）拼，为空才回落构建期 `NEXT_PUBLIC_ACCOUNT_SERVER_URL`，两者都为空则按钮 `disabled`。现网 `accountCenterUrl()` 直接返回构建期常量（兜底 `https://ecliptrix.app`），自建账号服务下会把用户送到厂商站点。

**新增 `AuthReason`**：`'email-unverified'`、`'account-deleted'`、`'deletion-pending'`；`authErrors.js` 的 `EMAIL_NOT_VERIFIED` / `ACCOUNT_DELETED` 映射到此，`authBridge.ts` 的 `authErrorCopyKey` 补齐三个键。其中 `account-deleted` 还要同时接受 `REVOKE_REASON.deleted`（管理员删号）与 `account_deleted`（本人注销）两个吊销理由（P1-12），且**只出现在心跳/refresh 的 401 上**（登录沿用 `invalid_credentials`，见 §3.8）。

### 3.11 运维与清理（P7/P8）

- `scripts/prune.ts`（`npm run db:prune`）：按 `audit.retentionDays`(默认 180) 删 `audit_events`；`mail_outbox` 保留 30 天（仅 `sent`/`failed`；`captured` 保留 7 天）；`email_action_tokens` / `password_reset_tokens` 过期行保留 7 天后删；`refresh_token_reuse_events` 保留 180 天。输出每类删除行数，`--dry-run` 只统计。
- `scripts/sweep.ts`（`npm run accounts:sweep`）：与 `maintenanceService.sweepDue()` 同一实现，供 cron 使用。
- **惰性清扫**：`withContext()` 在 `ensureBooted()` 之后调用 `maintenanceService.sweepIfDue()`；用 `app_settings` 的 `system.lastSweepAt`（本键**只由服务内部写**，不进 `SETTING_KEYS` 白名单，避免管理员误改）判定"上次清扫是否超过 1 小时"。清扫失败只 `log('warn')`，不改变响应。
- 部署文档：`webserver/README.md` 增加「没有 SMTP 时会发生什么」表格（重置 = 管理员签发一次性口令；注销 = 无需邮箱确认；验证 = 关闭）；`deploy/` 增加 `cron.example`（备份 + `db:prune` + `accounts:sweep`）。**Windows 部署（本项目的主平台）没有 cron**：同一份说明里给出"任务计划程序"的两条等价命令（`npm run db:prune` 与 `npm run accounts:sweep`），并把 `--dry-run` 作为首次执行前的验收动作（P2-10）。
- 备份：`npm run db:backup` 已有，补一条"导出的 JSON 不含备份文件"的说明（避免用户以为导出=备份）。

### 3.12 质量闸门（P8）

| 闸门 | 命令 | 通过标准 |
|---|---|---|
| 类型 | `cd webserver && npm run type-check` | 0 error |
| 静态 | `cd webserver && npm run lint` | 0 warning（`--max-warnings 0`） |
| 单测+集成 | `cd webserver && npm test` | 全绿，用例数 ≥ 232（现 174，本轮新增 ≥ 58） |
| 构建 | `cd webserver && npm run build` | 成功，路由包含 `/admin/sessions`、`/admin/mail`、`/verify-email`、`/confirm-deletion` 与 5 个新 API |
| 迁移幂等 | `npm run db:migrate` ×2 | 第二次输出 "nothing to do" |
| 冒烟 | `node scripts/smoke.mjs`（对**新启动**的进程与一次性库） | ≥ 96 条 0 failed（现 62） |
| 浏览器 e2e | `cd webserver && npm run test:e2e` | 8 条主流程全绿（Chromium） |
| 无障碍 | `npm run test:a11y` | 5 个页面 0 serious/critical 违规 |
| i18n | `npm test -- tests/unit/i18n.test.ts` | 两字典 key 集完全一致（既有用例，新增键自动纳入） |
| 桌面主进程 | `cd desktop && npm run test:auth` | ≥ 128 checks（历史值 107；本节点未能复测，实施时以命令输出为准确认基数） |
| 桌面端到端 | `cd desktop && node scripts/auth-smoke.js` | ≥ 20 条（现 14） |
| 渲染侧 | `npx vitest run src/components/auth src/contexts` | 全绿，用例数 ≥ 38（**现 27**：`components/auth` 2 文件 + `contexts` 2 文件；v1 写的"5 文件 / 29"是错的，见 §7.5 的计数命令） |
| 根项目 | `npx tsc --noEmit` + `npm run build` | 0 error / 成功（`tsconfig.json` 已排除 `webserver`，见 R2 D-18） |

> Playwright 的现实约束：`npm i -D @playwright/test` + `npx playwright install chromium` 需要在实施机上下载浏览器（约 150 MB）。若实施环境确实装不上，**允许**把 e2e 记为受控偏差（在 `spec.md` 尾部「实施过程发现的方案缺陷」登记 + 给出 `npm run test:e2e` 的失败原文），但 `smoke.mjs ≥ 96` **不允许**降级——它才是本轮的硬门禁。

### 3.13 关键时序

**A. 注册 → 验证**

```
desktop: auth:register
  → POST /auth/register (Bearer 无、Cookie 无)
  → authService.register: 建用户(status=active, email_verified_at=NULL) + 建会话 + 审计 user.register
  → emailVerificationService.issueFor(user,'register')   [不参与事务】
       → 建 email_action_tokens(purpose=verify, TTL 48h)
       → mailService.queue('verify-email', to=user.email)  → outbox(captured) → 尝试投递
  → 201 { user, session }（响应不含任何邮件状态）
user: 点邮件链接 → GET /verify-email?token=…
  → 页面（RSC）渲染 client 面板 → POST /auth/email/verify {token}
  → 200 { email, verifiedAt } → 页面显示"已验证"
```

**B. 换邮箱**

```
POST /me/email/change {password,newEmail}
  → 校验口令 → 占用检查 → 建 token(purpose=change_email, email_normalized=新址)
  → 发 change-email-confirm(新址) + email-change-notice(旧址)
  → 202 { pendingEmail: 'b***@y.com', expiresAt }
用户点新址链接 → POST /auth/email/verify {token}
  → 事务: 再检查占用 → 更新 email + email_verified_at=now
          → 撤销其他会话(email_changed) → 审计 user.email_changed
  → 发 email-changed 到旧址 → 200 { email, sessionsRevoked: n }
```

**C. 注销**

```
POST /me/deletion-request {password, reason?}
  → 校验口令；owner/最后管理员 → 409；已存在活跃申请 → 覆盖旧行为 cancelled
  → 邮件可用: 建行(awaiting_confirmation) + 发 deletion-confirm → 202 {requiresConfirmation:true}
  → 邮件不可用: 建行(scheduled, now+grace) + outbox(captured) → 202 {requiresConfirmation:false, scheduledFor}
POST /auth/deletion/confirm {token} → scheduled + 发 deletion-scheduled → 200 {scheduledFor}
DELETE /me/deletion-request       → cancelled + 发 deletion-cancelled  → 200
sweepDue()（每小时惰性 / CLI）
  → 对每行 scheduled & 到期: 匿名化 users + 撤销会话(account_deleted) + 审计 account.deleted
  → 发 deletion-completed → status=completed
desktop 心跳 → 401 session_revoked〔details.reason=account_deleted〕→ 清会话 + account-deleted 页
```

**D. 管理员批量踢下线**

```
POST /admin/sessions/revoke {ids:[…≤100], reason:'admin_revoke'}
  → requireAdminWrite('sessions.revoke')  → 事务内 UPDATE sessions SET revoked_at,revoked_reason
  → 审计 admin.sessions_revoked {count,reason} → 200 {revoked,skipped}
  → 对应用户下一次心跳(≤15min) → 401 session_revoked
```

### 3.14 兼容性

- **迁移只加不改**：0005 是 `CREATE TABLE` / `CREATE INDEX` + **一条 `ALTER TABLE users ADD COLUMN last_exported_at INTEGER`**（P1-13 的数据源；加法列，先例是 0004 的 `ADD COLUMN device_key`），不删不改既有列；旧数据 `users.email_verified_at` 保持 `NULL`（既存用户视为"未验证"，若管理员把 `mail.verificationRequired` 打开，需先用 §3.4-4 批量放行——README 与设置页提示必须写明）。
- **响应只加字段**：`/me`、`/admin/metrics`、`/admin/settings`、`/auth/login` 的 `user` 均只新增键，不删不改语义；桌面端旧版本遇到未知键必须忽略（`AuthBridge` 现有实现按字段取值，天然容忍）。
- **桌面端向后兼容**：新 IPC 通道在旧主进程上不存在。注意现有 `SessionContext` 的"降级"只到 **bridge 粒度**（整体缺失 → `bridge-unavailable`），**没有**逐方法探测（P1-7）；因此账号中心必须自己实现逐方法能力检测，缺方法时降级为"仅显示状态 + 打开浏览器"，并有不依赖新方法的用例。
- **`smoke.mjs` 的登录 IP 限流**：20/5 min，仍要求对**新进程**跑（R1 D-06 已记录），e2e 用独立 `DATABASE_PATH` + 独立端口 8799。

---

## 4. File / module change plan

### 4.1 阶段与判据

| 阶段 | 主题 | 完成判据（可核对） |
|---|---|---|
| P0 | 邮件管线（表 + 模板 + service + outbox 管理页雏形） | 迁移 0005 幂等；`mail_outbox` 三类状态可写；`password-reset` 从旧 `mailer` 迁到模板后 `tests/integration/auth.test.ts` 全绿；新增 `tests/unit/mailTemplates.test.ts`、`tests/integration/mailPipeline.test.ts` |
| P1 | 邮箱验证 | 注册后 outbox 出现 `verify-email`；消费成功/过期/已用/用途不符四态用例全绿；管理员覆盖端点可用；`/me` 返回 `emailVerified` |
| P2 | 换邮箱双确认 | 双封信 + 旧会话吊销 + 占用并发用例（两个用户同时确认同一新址 → 一个 409）全绿 |
| P3 | 邀请邮件 + 通知 | 邀请邮件含一次性 code 且 `retryable=0`；三类通知受开关控制 |
| P4 | 数据导出 | 附件头/字段/脱敏/冷却期/5000 行截断全绿；导出后审计 `user.exported` 可查 |
| P5 | 注销（含清扫） | 申请→确认→取消→到期匿名化全链路用例；桌面端 `account-deleted` 映射有测试；CLI 幂等 |
| P6 | 桌面内嵌账号中心 | 4 个页签可用；4 个新 IPC 通道有校验用例；`mustChangePassword` 缩口名单含 `auth:me`；渲染侧 ≥ 38 用例 |
| P7 | 后台治理（会话/邮件/指标/CSV/设置） | 两个新页面 200；两个新端点 RBAC 矩阵用例；指标含新序列；CSV 带 BOM |
| P8 | 质量闸门（e2e/axe/i18n/smoke/文档） | §3.12 全表通过（Playwright 例外需登记偏差） |

### 4.2 账号服务（`webserver/`）

**新增文件**

| 文件 | 意图 |
|---|---|
| `src/server/db/migrations/0005_account_lifecycle.sql` | 3 张新表 + 4 个索引（§6.1） |
| `src/server/mail/templates.ts` | 12 个模板 × 2 语言，纯函数 `render()` |
| `src/server/mail/links.ts` | 5 个链接构造器（含既有 `buildResetUrl` 迁入） |
| `src/server/services/mailService.ts` | queue / deliver / retry / 每日上限 / 脱敏 |
| `src/server/services/emailVerificationService.ts` | 验证、重发、换邮箱、管理员覆盖 |
| `src/server/services/accountExportService.ts` | 导出装配 + 冷却期 |
| `src/server/services/accountDeletionService.ts` | 申请/确认/取消/执行 + `sweepDue()` |
| `src/server/services/adminSessionService.ts` | 全局会话查询 + 批量吊销 |
| `src/server/services/maintenanceService.ts` | `sweepIfDue()`（到期注销、令牌、outbox 保留） |
| `src/server/db/repositories/emailActionTokensRepo.ts` | 令牌 CRUD（`findLiveByUserPurpose`、`consume`、`invalidateAll`） |
| `src/server/db/repositories/mailOutboxRepo.ts` | 插入、状态回写、分页查询、聚合计数、保留清理 |
| `src/server/db/repositories/deletionRequestsRepo.ts` | 活跃申请查询、状态迁移、到期扫描 |
| `src/app/api/v1/auth/email/verify/route.ts` | `POST` 消费验证/换邮箱令牌 |
| `src/app/api/v1/auth/email/verify/resend/route.ts` | `POST` 重发（202） |
| `src/app/api/v1/auth/deletion/confirm/route.ts` | `POST` 注销确认 |
| `src/app/api/v1/me/email/change/route.ts` | `POST` 发起 / `DELETE` 取消 |
| `src/app/api/v1/me/export/route.ts` | `GET` 导出附件 |
| `src/app/api/v1/admin/sessions/route.ts` | `GET` 全局会话 |
| `src/app/api/v1/admin/sessions/revoke/route.ts` | `POST` 批量吊销 |
| `src/app/api/v1/admin/mail/route.ts` | `GET` outbox 列表 |
| `src/app/api/v1/admin/mail/[id]/route.ts` | `GET` outbox 详情（文本） |
| `src/app/api/v1/admin/mail/[id]/retry/route.ts` | `POST` 重试 |
| `src/app/api/v1/admin/users/export/route.ts` | `GET` CSV |
| `src/app/api/v1/admin/users/[id]/email-verify/route.ts` | `POST` 管理员标记已验证 |
| `src/app/api/v1/admin/users/[id]/deletion/route.ts` | `POST` 管理员代确认/代排期注销（P1-11，`users.delete`） |
| `src/app/(console)/admin/sessions/page.tsx` | RSC 全局会话页 |
| `src/app/(console)/admin/mail/page.tsx` | RSC outbox 页 |
| `src/app/(auth)/verify-email/page.tsx` | RSC 壳（读 `?token=`，只传字符串） |
| `src/app/(auth)/confirm-deletion/page.tsx` | RSC 壳（读 `?token=`） |
| `src/components/auth/email-verify-panel.tsx` | 客户端：消费令牌 → 四态结果 |
| `src/components/auth/deletion-confirm-panel.tsx` | 客户端：确认/取消注销 |
| `src/components/account/email-panel.tsx` | 邮箱只读 + 验证徽标 + 重发 + 换邮箱表单 |
| `src/components/account/data-export-panel.tsx` | 导出按钮 + 冷却倒计时 |
| `src/components/console/sessions-table.tsx` | 全局会话表（筛选/排序/批量） |
| `src/components/console/mail-table.tsx` | outbox 表 + 详情抽屉 |
| `src/components/console/trend-chart.tsx` | 内联 SVG 柱/折线（`role="img"`） |
| `src/components/console/stat-tiles.tsx` | 概览新增指标块（复用 `StatCard` 拆分） |
| `playwright.config.ts` | e2e 配置（chromium、`webServer`、独立 `DATABASE_PATH`、端口 8799） |
| `e2e/01-marketing.spec.ts` … `e2e/08-account-lifecycle.spec.ts` | 8 条主流程 |
| `e2e/helpers/server.ts` | 起服/清库/注册固定账号 |
| `tests/unit/mailTemplates.test.ts` | 模板渲染 + 双语 + 脱敏 |
| `tests/unit/accountExport.test.ts` | 导出字段白名单（无 `*_hash`） |
| `tests/integration/mailPipeline.test.ts` | queue→outbox→状态机→每日上限 |
| `tests/integration/emailVerification.test.ts`（新） | 验证/重发/管理员覆盖/策略闸门 |
| `tests/integration/emailChange.test.ts`（新） | 换邮箱双确认、并发占用、取消 |
| `tests/integration/accountExport.test.ts`（新） | 附件头、字段白名单、冷却期 |
| `tests/integration/accountDeletion.test.ts` | 申请/确认/取消/清扫/保护规则 |
| `tests/integration/adminSessions.test.ts` | 列表/筛选/批量吊销/审计 |
| `tests/integration/adminMail.test.ts` | 列表/详情脱敏/重试/不可重试 |
| `tests/integration/metrics.test.ts` | 新序列长度与数值正确性 |
| `tests/integration/export-csv.test.ts` | BOM、列序、上限 |
| `tests/integration/sweep.test.ts` | `sweepIfDue` 频率闸门 + 幂等 |
| `scripts/prune.ts` | 保留清理（`--dry-run`） |
| `scripts/sweep.ts` | 到期注销 CLI |
| `scripts/confirm-deletion.ts` | 破窗：管理员代确认注销（`npm run account:confirm-deletion`，P1-11） |
| `deploy/cron.example` | 备份 + prune + sweep 的 crontab 样例 |

**修改文件**

| 文件 | 改动 |
|---|---|
| `src/server/http/errors.ts` | `ERROR_STATUS` 追加 `email_not_verified`(403)、`email_already_verified`(409)、`token_invalid`(400)、`deletion_pending`(409)、`mail_disabled`(503)；`errors.*` 工厂补 5 个 |
| `src/server/auth/constants.ts` | **`ERROR_CODE` 追加同样 5 个码（P0-5：`ERROR_STATUS` 是 `Record<ErrorCode, number>`，只加一处 `tsc` 直接失败）**；新限流常量（`MAIL_*`、`EXPORT_*`、`DELETION_*`、`emailVerifyConsume`）、`REVOKE_REASON` 追加 `email_changed`/`account_deleted`/`admin_lockdown`/`security_incident` |
| `src/server/mail/mailer.ts` | **（P0-1 新增行）**收窄为 `isMailEnabled()` + `sendRaw()`；`createTransport` 补 `connectionTimeout`/`greetingTimeout`/`socketTimeout`（全部取 `MAIL_SEND_TIMEOUT_MS`）；删掉 `sendPasswordResetMail`（迁入模板 `password-reset`）与内联 HTML |
| `src/server/config.ts` | 新增 `mailSendTimeoutMs`（env `MAIL_SEND_TIMEOUT_MS`，默认 5000，范围 500–20000）、`e2eMode`（仅 `NODE_ENV==='test'` 或 `ECLIPTRIX_E2E=1`） |
| `src/server/validation/schemas.ts` | 新增 `emailVerifySchema`、`emailVerifyResendSchema`(空)、`emailChangeSchema`、`deletionRequestSchema`（`password` + 可选 `reason` ≤200）、`deletionConfirmSchema`、`adminSessionsQuerySchema`、`adminSessionsRevokeSchema`（1–100 个 id）、`adminMailQuerySchema`、`adminEmailVerifySchema`(空)、`userExportQuerySchema`；`inviteCreateSchema` 增可选 `email`/`note` |
| `src/server/services/settingsService.ts` | 8 个新键（§6.2）；`all()` 保持不变；新增只读 `mailCapabilities()`；**无 SMTP 时把 `mail.verificationRequired` 在读写两侧夹紧为 `false`**（P2-2：否则管理员一开开关就把全体桌面端用户 403 锁死，且自己无从恢复） |
| `src/server/services/authService.ts` | 注册后发验证信；**只在 `login` 施加 `verificationRequired` 闸门**（P0-4；位置在 `verifyCredentials` 之后、`markLoggedIn` 之前，不写 `login_attempts`）；`heartbeat`/`refresh` 在 401 时写入 `details.reason`（`account_deleted` / `deleted` 都映射到桌面的 `account-deleted`） |
| `src/server/services/profileService.ts` | `requestAccountDeletion` 改为委托 `accountDeletionService.request`，**并停止把明文邮箱写进审计 metadata**（P1-10）；`PATCH /me` 显式拒绝 `email` 字段；`myActivity` 透传新白名单结果 |
| `src/server/services/inviteService.ts` | 可选 `email` → 发 `invite` 邮件 |
| `src/server/services/sessionService.ts` | `revokeMany(ids, reason)`、`listAll(filter)` 委托给 repo；`revokeAllForUser(reason)` 复用 |
| `src/server/services/userService.ts` | `markEmailVerified(id, actor)`、`listForExport(filter)`、`anonymize(id, tx)`（供注销服务在同一事务调用） |
| `src/server/services/auditService.ts` | **无需改动**：`record()` 接受任意 `action: string`，没有动作白名单（v1 写的"新动作加入合法集合"不成立）。只需保证动作名与 §6.3 表逐字一致 |
| `src/server/services/metricsService.ts` | `overview(now, days)` 增 4 个序列 + `emailVerifiedRate`/`pendingDeletions`/`clientBreakdown` |
| `src/server/boot.ts` | 迁移后 seed 新设置键；调用一次 `sweepIfDue()`（失败仅告警） |
| `src/server/http/route.ts` | `withContext` 末尾追加 `maintenanceService.sweepIfDue()`（best-effort）；**确认附件响应路径仍能注入 `x-request-id`**（P1-4） |
| `src/server/db/repositories/usersRepo.ts` | `findByEmailIncludingDeleted`、`markEmailVerified`、`listForExport`、`anonymizeUser`、`touchLastExportedAt`（P1-13） |
| `src/server/db/repositories/auditRepo.ts` | **`SELF_VISIBLE_ACTIONS` 追加本轮的自助可见动作**（P0-6：`auth.email_verified`、`user.email_changed`、`user.exported`、`account.deletion_requested/scheduled/cancelled/completed`），否则桌面"活动"页签与网页活动页对新功能全盲 |
| `src/server/db/repositories/sessionsRepo.ts` | `listAll(filter)`、`countAll(filter)`、`revokeMany`、`recentDeviceKeys(userId,5)` |
| `src/lib/i18n.ts` | 新增 **92** 键（§6.4 分项求和：11+15+5+9+14+16+7+11+4），zh-CN/en-US 两侧同步（v1 写的"约 78 键"与 §6.4 自相矛盾，以 92 为准） |
| `src/app/(console)/layout.tsx` | 导航新增 `/admin/sessions`（`users.read`）与 `/admin/mail`（`settings.read`） |
| `src/app/(console)/account/page.tsx` | 插入 `<EmailPanel>` 与 `<DataExportPanel>`；`DangerZone` 改造 |
| `src/app/(console)/admin/page.tsx` | 新指标块 + 30 天趋势 + 版本分布 |
| `src/app/(console)/admin/settings/page.tsx` | 新分组 + 邮件能力只读条 |
| `src/components/account/danger-zone.tsx` | 申请（含口令）/ 待确认状态 / 排期与倒计时 / 取消 |
| `src/components/account/profile-form.tsx` | 邮箱行改为 `<EmailPanel>` 承载 |
| `src/components/console/settings-form.tsx` | 8 个新字段 + 只读邮件能力 |
| `src/components/console/user-detail.tsx` | 资料页签加"邮箱验证状态 + 标记已验证" |
| `src/components/console/data-table.tsx` | 如需支持行选择，抽出 `SelectableTable`（不改既有用法） |
| `scripts/smoke.mjs` | 62 → ≥96 条 |
| `package.json` | `test:e2e`、`test:a11y`、`db:prune`、`accounts:sweep`；devDeps `@playwright/test`、`@axe-core/playwright` |
| `docs/api.md` | 新端点全量 + 5 个错误码 + 无邮件降级说明 |
| `docs/desktop-integration.md` | 升 v3：`emailVerified`、`account_deleted`、新 IPC、账号中心契约 |
| `README.md` | 邮件/注销/导出/清理章节 + 验收自检数字更新 |
| `deploy/nginx.conf.example` | 给 `/verify-email`、`/confirm-deletion` 加 `Referrer-Policy: no-referrer` 覆盖（兜底 middleware 已设） |

### 4.3 桌面端（`desktop/` + 根 `src/`）

| 文件 | 改动 |
|---|---|
| `desktop/main/authHttp.js` | 新增 `me()`、`updateProfile()`、`activity()`、`resendVerification()`；`heartbeat`/`refresh` 读取 `error.details.reason` |
| `desktop/main/authErrors.js` | 新增码 → `uiReason`：`email_not_verified→'email-unverified'`、`account_deleted→'account-deleted'`、`deletion_pending→'deletion-pending'`；**并让吊销理由 `deleted`（管理员删号）与 `account_deleted`（本人注销）都归到 `account-deleted`**（P1-12）。既有映射是 **21 条**（不是 v1 说的"30+"），未知码回落 `internal-error`，这两点不变 |
| `desktop/main/authController.js` | 4 个新动作（`me`/`updateProfile`/`activity`/`resendVerification`）；`SessionUser` 增 `emailVerified`；心跳 401 分流加 `account_deleted` 与 `deleted`（现有判死集合是 `session_revoked`/`session_expired`/`unauthorized`/`account_suspended`，新值必须加入同一集合，否则"账号已注销"会被当成网络抖动而无限重试）；`activity()` 里做 IP 脱敏（P1-6）；`refresh` 后刷新 user 快照（`emailVerified` 变化要能推 `auth:changed`） |
| `desktop/main/authBridge.js` | `CHANNELS` 增 4 个；`PASSWORD_CHANGE_ALLOWED` 增 `ME`；输入校验（显示名 1–64、locale 枚举、timezone 正则、无多余字段） |
| `desktop/main/authBridge.test.js` / `authHttp.test.js` | 新通道校验用例 + 新端点路径/超时用例 |
| `desktop/scripts/test-auth.js` | 107 → ≥128 checks（含新套件注册） |
| `desktop/scripts/auth-smoke.js` | 14 → ≥20 条（假服务端模拟 `email_not_verified`、`account_deleted`、`/me` PATCH 与 `/me/activity`） |
| `desktop/preload/preload.js` | `auth` 命名空间增 4 方法 |
| `src/types/desktop.d.ts` | 同步 `AuthBridge`（引用 `src/lib/api/authBridge.ts` 类型，无需重复声明） |
| `src/lib/api/authBridge.ts` | `AuthReason` 增 3 值（现状 **21** 值，不是 v1 说的 19）；`SessionUser.emailVerified`；`ServerMeta.emailVerificationRequired`；`AuthBridge` 4 方法；`MeView`/`ActivityItem` 类型（`ActivityItem` 用 `ipMasked`，见 §3.10）；`authErrorCopyKey` 补 3 键（现状 24 条键 + `service_unavailable` 的 maintenance 特判）；**`accountCenterUrl()` 改为优先取运行时 `status.server.baseUrl`**（P1-8） |
| `src/contexts/SessionContext.tsx` | `updateProfile()`、`reloadMe()`、`resendVerification()`、`loadActivity()`；状态不做乐观编造（沿用 R2 原则）；**新增逐方法能力探测**（P1-7：现有降级只到 bridge 粒度） |
| `src/components/auth/AccountCentreDialog.tsx`（新） | 4 页签容器，键盘可达（Esc 关闭、焦点陷阱复用 `ChangePasswordDialog` 模式） |
| `src/components/auth/AccountMenu.tsx` | 「账号中心」改为打开内嵌对话框；保留「在浏览器中打开」；未验证黄条 |
| `src/components/auth/LoginScreen.tsx` | `email-unverified` 专用文案（含"去收信/重发"引导）；**不**为 `account-deleted` 写登录专用文案（P1-5：已注销账号登录仍回 `invalid_credentials`，写专用文案会变成"该邮箱曾经存在"的探针） |
| `src/components/auth/RegisterForm.tsx` | 注册成功后提示"验证邮件已发送到 x***@y"（来自 `meta.smtpEnabled`） |
| `src/components/auth/__tests__/AccountCentreDialog.test.tsx`（新） | 4 页签、降级、错误态 |
| `src/components/auth/__tests__/LoginScreen.test.tsx` | 新增 2 个 reason 用例 |
| `src/lib/i18n.ts`（根项目） | `auth.account.*` 约 46 键 × 2 语言 + 3 个 reason 文案；`authI18nParity` 用例自动纳入 |
| `desktop/README.md` | 账号中心与验证/注销说明；`test:auth` 数字 |
| 根 `CLAUDE.md` | 「Desktop identity gate」「Account server」两节追加本轮契约（**由实施节点更新**，本轮不改） |

### 4.4 明确不改

`src/app/api/**`（根项目侧）、`backend-services/**`、`desktop/main/index.js` 的启动顺序、`desktop/main/authConfig.js`/`authSessionStore.js`/`authPolicy.js`/`localAdmin.js`（本轮零改动；破窗账号契约不变）、任何业务表的 `user_id`（仍恒为 `LOCAL_OWNER_ID`）。

---

## 5. Interface design

### 5.1 错误码增补

| code | HTTP | 语义 | 使用点 |
|---|---|---|---|
| `email_not_verified` | 403 | 邮箱未验证，按策略禁止登录 | **仅** `POST /auth/login`（`verificationRequired=true` 且 `client='desktop'`；`details: { redirect: '/verify-email' }`）。`/auth/register` 不返回它——注册必然未验证，拦了就永远注册不进来（P0-4） |
| `email_already_verified` | 409 | 已验证还请求重发 | `POST /auth/email/verify/resend` |
| `token_invalid` | 400 | 令牌无效/过期/已用/用途不符（不细分） | `POST /auth/email/verify`、`/auth/deletion/confirm` |
| `deletion_pending` | 409 | 已存在待确认/已排期的注销申请 | `POST /me/email/change`、`PATCH /me`（注销流程进行中禁止改资料） |
| `mail_disabled` | 503 | 该动作在无 SMTP 时必须邮件，但邮件未配置 | `POST /auth/email/verify/resend`（`details: { reason: 'mail_disabled' }`）；**管理员代发口令重置**（原 `service_unavailable` 迁入，P1-1）；注销申请**不**用它（走降级） |

> 新增码必须同时更新**五处 + 两处**：`webserver/src/server/auth/constants.ts` 的 **`ERROR_CODE`**（**P0-5：漏这一处 `tsc` 直接失败**，因为 `ERROR_STATUS` 声明为 `Record<ErrorCode, number>`）、`ERROR_STATUS`、`errors.*` 工厂、`webserver/docs/api.md` 错误码表、`desktop/main/authErrors.js` 映射、`src/lib/api/authBridge.ts` 的 `AuthReason`；并在 `webserver/tests/unit/validation.test.ts` 增加一条断言「5 个新码同时存在于 `ERROR_CODE` 与 `ERROR_STATUS`，且 HTTP 状态码与本节表格一致」。
> **不得**给 `429` 复用于锁定（R1 评审已踩：423 才是锁定）；`email_not_verified` 不得用 `403 forbidden` 复用，否则桌面端无法给出"去收信"的具体引导。

### 5.2 REST 端点全表（新增标 `＋`，改动标 `~`）

| 方法 | 路径 | 守卫 | 成功 | 主要错误 |
|---|---|---|---|---|
| ＋POST | `/api/v1/auth/email/verify` | 无会话（令牌即凭据） | 200 `{ email, verifiedAt \| changed:true, sessionsRevoked? }` | `400 token_invalid`、`409 email_taken` |
| ＋POST | `/api/v1/auth/email/verify/resend` | 会话（Bearer/Cookie）+ CSRF（Cookie） | 202 `{ sentAt, expiresAt }` | `401`、`409 email_already_verified`、`429 rate_limited`、`503 mail_disabled` |
| ＋POST | `/api/v1/auth/deletion/confirm` | 无会话 | 200 `{ scheduledFor }` | `400 token_invalid`、`409 conflict`（已取消/已完成） |
| ＋POST | `/api/v1/me/email/change` | 会话 + CSRF/Bearer | 202 `{ pendingEmail, expiresAt }` | `401 password_mismatch`、`409 email_taken`/`deletion_pending`、`422 validation_failed`、`429` |
| ＋DELETE | `/api/v1/me/email/change` | 同上 | 200 `{ cancelled:true }` | `404 not_found` |
| ＋GET | `/api/v1/me/export` | 会话 | 200 `application/json` 附件 | `429 rate_limited`（含 `details.retryAfterSeconds`） |
| ~GET | `/api/v1/me` | 会话 | 200 `{ …user, emailVerified, emailVerifiedAt, pendingEmail, deletion }` | `401` |
| ~POST | `/api/v1/me/deletion-request` | 会话 | 202 `{ requestId, requiresConfirmation, scheduledFor\|null }` | `401 password_mismatch`、`409 cannot_modify_owner`/`conflict`/`deletion_pending`、`429` |
| ＋DELETE | `/api/v1/me/deletion-request` | 会话 | 200 `{ cancelled:true }` | `404 not_found` |
| ＋GET | `/api/v1/admin/sessions` | `requireAdminRead('users.read')` | 200 `{ rows, total, page }` | `403` |
| ＋POST | `/api/v1/admin/sessions/revoke` | `requireAdminWrite('sessions.revoke')` | 200 `{ revoked, skipped }` | `422 validation_failed`、`403` |
| ＋GET | `/api/v1/admin/mail` | `requireAdminRead('settings.read')` | 200 `{ rows, total, page }` | `403` |
| ＋GET | `/api/v1/admin/mail/{id}` | 同上 | 200 `{ id, template, toMasked, subject, text, status, attempts, lastError, retryable, createdAt, sentAt }` | `404` |
| ＋POST | `/api/v1/admin/mail/{id}/retry` | `requireAdminWrite('users.write')` | 200 `{ status }` | `409 conflict`（`retryable=0`）、`403`（`support`） |
| ＋GET | `/api/v1/admin/users/export` | `requireAdminRead('users.read')` | 200 `text/csv; charset=utf-8`（BOM） | `403` |
| ＋POST | `/api/v1/admin/users/{id}/email-verify` | `requireAdminWrite('users.write')` | 200 `{ emailVerifiedAt }` | `404`、`409 email_already_verified` |
| ＋POST | `/api/v1/admin/users/{id}/deletion` | `requireAdminWrite('users.delete')` | 200 `{ status: 'scheduled', scheduledFor }` | `404`、`409 conflict`（无活跃申请 / 已是 owner） |
| ~GET | `/api/v1/admin/metrics?days=` | `requireAdminRead('users.read')` | 200 `OverviewMetricsV2` | `422`（days 越界） |
| ~GET/PATCH | `/api/v1/admin/settings` | 读 `settings.read` / 写 `settings.write` | 200 `{ settings, mail: { mode, fromAddress, configured, sent24h, failed24h } }` | `422`（未知键）、`403` |
| ~POST | `/api/v1/admin/invites` | `requireAdminWrite('invites.write')` | 201 `{ invite, mail: { queued, id } \| null }` | `422` |
| ~POST | `/api/v1/auth/login` | 无 | 200 `{ user, session }`（`user.emailVerified`） | ＋`403 email_not_verified`（仅策略开启且在口令验证之后） |
| ~POST | `/api/v1/auth/register` | 无 | 201 同上 | **不返回 `email_not_verified`**（P0-4） |
| ~POST | `/api/v1/auth/heartbeat` | `resolveAuth` | 200 `{ session }` | `401` 时 `details.reason ∈ {'session_revoked','session_expired','account_suspended','account_deleted','deleted'}`（后两个都由桌面映射到 `account-deleted`；401 的 `details` 目前只有 `session_revoked` 分支带，本轮补齐其余分支） |

**请求/响应样例（逐一，实施时照抄字段名）**

```jsonc
// ＋POST /api/v1/auth/email/verify
{ "token": "eyJ…" }                                  // 32 字节 base64url，长度 43
// 200 (purpose=verify)
{ "success": true, "message": null, "timestamp": "…",
  "data": { "email": "a@b.c", "verifiedAt": "2026-01-01T00:00:00.000Z", "changed": false } }
// 200 (purpose=change_email)
{ "success": true, "message": null, "timestamp": "…",
  "data": { "email": "new@b.c", "verifiedAt": "…", "changed": true, "sessionsRevoked": 2 } }
// 400
{ "success": false, "message": "链接无效或已过期", "timestamp": "…",
  "error_code": "token_invalid", "error": { "code": "token_invalid", "message": "链接无效或已过期" } }
```

```jsonc
// ＋POST /api/v1/me/email/change
{ "password": "…", "newEmail": "new@b.c" }
// 202 → data: { "pendingEmail": "n***@b.c", "expiresAt": "…" }
```

```jsonc
// ＋POST /api/v1/me/deletion-request
{ "password": "…", "reason": "不再使用" }             // reason 可选，≤200
// 202（邮件可用）
{ "requestId": "…", "requiresConfirmation": true, "scheduledFor": null }
// 202（邮件不可用）
{ "requestId": "…", "requiresConfirmation": false, "scheduledFor": "2026-01-04T00:00:00.000Z" }
```

```jsonc
// ＋POST /api/v1/admin/sessions/revoke
{ "ids": ["sess_…", "sess_…"], "reason": "admin_revoke" }
// 200 → data: { "revoked": 2, "skipped": 0 }
```

```jsonc
// ＋GET /api/v1/admin/sessions?query=&client=desktop&platform=&activeOnly=1&page=1&pageSize=20&sort=-last_seen_at
// 200 → data: { "total": 42, "page": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 },
//               "rows": [ { "id": "…", "userId": "…", "userEmail": "a***@b.c", "userDisplayName": "…",
//                           "client": "desktop", "deviceName": "…", "platform": "win32", "appVersion": "1.0.3",
//                           "deviceKeyPrefix": "ab12cd34", "ip": "1.2.x.x", "createdAt": "…", "lastSeenAt": "…",
//                           "revokedAt": null, "revokedReason": null, "active": true } ] }
```

> `userEmail` 与 `ip` 在列表里**脱敏**（`a***@b.c`、`1.2.x.x`）；完整 IP 只在 `/admin/users/{id}` 的会话页签（既有页）与审计详情里给。这条与 R1「审计 metadata 只放非敏感差异」一致，也避免管理员页面成为批量导出个人数据的入口。

### 5.3 桌面 IPC 通道（追加 4 个）

| 通道 | 入参校验 | 返回 |
|---|---|---|
| `auth:me` | 无 | `{ ok:true, data: MeView }` |
| `auth:update-profile` | `{ displayName?: string(1–64), locale?: 'zh-CN'\|'en-US', timezone?: string(≤64, /^[A-Za-z_]+\/[A-Za-z_+\-0-9]+$/), at least one field }` | `{ ok:true, data: MeView }` |
| `auth:activity` | 无（主进程固定 `page=1&pageSize=30`） | `{ ok:true, data: { items: ActivityItem[], truncated: boolean } }`；`truncated = page.total > items.length`（"还有更多"） |
| `auth:resend-verification` | 无 | `{ ok:true, data: { sentAt, expiresAt } }` |

```ts
export interface MeView {
  id: string
  email: string
  emailVerified: boolean
  displayName: string
  username: string
  locale: 'zh-CN' | 'en-US'
  timezone: string
  role: { key: string; name: string }
  planTag: string
  createdAt: string
  lastLoginAt: string | null
  pendingEmail: string | null          // 脱敏
  deletion: { status: 'awaiting_confirmation' | 'scheduled'; scheduledFor: string | null } | null
}

export interface ActivityItem {
  id: string
  action: string                       // 'auth.login' …
  targetType: string
  targetId: string                     // 服务端原样透传（可能是 ''）
  ipMasked: string                     // '1.2.x.x' —— 主进程脱敏，渲染层拿不到原始 ip
  createdAt: string
}
```

> **为什么 `ipMasked` 而不是 `ip`（P1-6）**：服务端 `/me/activity` 现在直接回原始 `ip`。桌面端把它降级为遮罩值再送渲染层，理由与"令牌只在主进程"同源：IP 是个人数据，渲染层一旦拿到就会被随手打日志/上报。这也意味着 `auth:activity` 的契约与 HTTP 响应**不**逐字相同——映射发生在 `authHttp.activity()` → `authController` 之间，用例必须断言"返回值里没有出现完整的四段 IPv4"。

约束（沿用 R2 不变量 1）：这 4 个通道**不得**返回 `accessToken`/`refreshToken`/`deviceKey` 明文/`*_hash`；`auth:update-profile` 不接受 `email`/`roleId`/`status`/`passwordHash` 任何额外字段（多余字段 → `{ ok:false, code:'invalid_request' }`）。

### 5.4 CLI 签名

```bash
# 保留清理（默认 dry-run 关闭，即执行）
npm run db:prune -- [--audit-days 180] [--mail-days 30] [--dry-run]
# 输出：audit_events=12345 mail_outbox=42 email_action_tokens=7 password_reset_tokens=3 reuse_events=0

# 到期注销清扫（与 maintenanceService.sweepDue 同一实现）
npm run accounts:sweep -- [--dry-run] [--limit 500]
# 输出：deleted=2 cancelled=0 scanned=5

# 管理员强制标记已验证（复用 API 不可用时的手工通道）
npm run user:verify -- --email a@b.c
npm run user:verify -- --all-unverified [--dry-run]   # 开启 mail.verificationRequired 前的批量放行
# 输出：email=a@b.c verified_at=2026-01-01T00:00:00.000Z  /  batch updated=37 skipped=0

# 破窗：管理员代确认注销（用户丢失邮箱访问权时）
npm run account:confirm-deletion -- --email a@b.c [--force]
# 输出：email=a@b.c status=scheduled scheduled_for=2026-01-04T00:00:00.000Z

# 浏览器 e2e / 无障碍
npm run test:e2e
npm run test:a11y
```

> 批量放行是为 §3.4 的 `mail.verificationRequired` 准备的**上线前置动作**：既有用户的 `email_verified_at` 全是 `NULL`，直接开启策略会让全体桌面端用户拿到 `403 email_not_verified`。设置页在开启该开关时必须先提示"先运行 `npm run user:verify -- --all-unverified --dry-run` 看清楚会影响多少个账号"——这正是 v1 §10 自评弱点 1 的补丁。

---

## 6. Data model

### 6.1 迁移 0005（全文，实施时逐字使用）

`webserver/src/server/db/migrations/0005_account_lifecycle.sql`

```sql
-- 0005_account_lifecycle.sql — close the account lifecycle: email verification
-- and email change, an auditable mail outbox, and a real (anonymising) deletion
-- with a grace period.
--
-- Additive only: three new tables plus indexes. No column is added to an
-- existing table, no table is rebuilt (the migration iron rule: startup DDL
-- never contains DROP).
--
-- Why the outbox exists even when SMTP is configured: a transactional mail that
-- silently disappears is indistinguishable from a bug, and "did the invite mail
-- go out?" is the first question an operator asks. The row is written BEFORE the
-- send attempt, so a crash mid-send still leaves evidence.
--
-- Tokens are never stored in the outbox: `payload` carries `token=***` and the
-- row is marked retryable = 0, because a retry cannot replay a redacted secret.

CREATE TABLE email_action_tokens (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose          TEXT NOT NULL CHECK (purpose IN ('verify', 'change_email')),
  -- target address for a change_email confirmation; '' for a plain verification
  email_normalized TEXT NOT NULL DEFAULT '',
  token_hash       TEXT NOT NULL UNIQUE,
  expires_at       INTEGER NOT NULL,
  used_at          INTEGER,
  ip               TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL
);

-- One live token per (user, purpose): issuing a new one consumes the old.
CREATE UNIQUE INDEX idx_email_action_live
  ON email_action_tokens (user_id, purpose) WHERE used_at IS NULL;
CREATE INDEX idx_email_action_lookup
  ON email_action_tokens (token_hash, used_at);

CREATE TABLE mail_outbox (
  id          TEXT PRIMARY KEY,
  template    TEXT NOT NULL,
  to_email    TEXT NOT NULL,
  to_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  locale      TEXT NOT NULL DEFAULT 'zh-CN',
  subject     TEXT NOT NULL,
  -- rendered text body, tokens already redacted; html is never persisted
  body_text   TEXT NOT NULL DEFAULT '',
  -- metadata only: no token, no password, no rendered link
  payload     TEXT NOT NULL DEFAULT '{}',
  -- 1 = a retry can succeed; 0 = the row carries a one-shot secret
  retryable   INTEGER NOT NULL DEFAULT 1 CHECK (retryable IN (0, 1)),
  status      TEXT NOT NULL DEFAULT 'captured'
              CHECK (status IN ('captured', 'sent', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER
);

CREATE INDEX idx_mail_created ON mail_outbox (created_at DESC);
CREATE INDEX idx_mail_status  ON mail_outbox (status, created_at DESC);
CREATE INDEX idx_mail_user    ON mail_outbox (to_user_id, created_at DESC);

CREATE TABLE account_deletion_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL on the no-SMTP degraded path: a request that never mailed a link has
  -- no token. NOT NULL + UNIQUE here would make the SECOND degraded request
  -- collide on '' and answer 500 (review P0-2), so the column is nullable and
  -- uniqueness is a partial index below.
  token_hash    TEXT,
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'awaiting_confirmation'
                CHECK (status IN ('awaiting_confirmation', 'scheduled',
                                  'cancelled', 'completed')),
  requested_at  INTEGER NOT NULL,
  confirmed_at  INTEGER,
  scheduled_for INTEGER,
  cancelled_at  INTEGER,
  completed_at  INTEGER,
  ip            TEXT NOT NULL DEFAULT '',
  request_id    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_deletion_user ON account_deletion_requests (user_id, requested_at DESC);
CREATE UNIQUE INDEX idx_deletion_token
  ON account_deletion_requests (token_hash) WHERE token_hash IS NOT NULL;
-- At most one live request per user; a second request cancels the first.
-- Order matters: UPDATE the old row to 'cancelled' BEFORE inserting the new one.
CREATE UNIQUE INDEX idx_deletion_live
  ON account_deletion_requests (user_id)
  WHERE status IN ('awaiting_confirmation', 'scheduled');

-- Export cooldown lives on the user row, not in the audit log: auditService.record
-- is best-effort (it swallows failures) and audit rows are pruned by
-- audit.retentionDays, so neither can be an authorisation input (review P1-13).
ALTER TABLE users ADD COLUMN last_exported_at INTEGER;

-- Aggregations added by the metrics/trend work: per-day grouping without a scan.
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_created ON login_attempts (created_at DESC);
```

**注意**：
- `CREATE UNIQUE INDEX … WHERE status IN (…)` 与既有 `0004` 的 `WHERE device_key <> ''` 同款局部索引写法，SQLite（实例为 3.49.2）支持，且 0004 的同类索引已在真实库中应用。
- **`migrate.ts` 没有 checksum 机制**（P1-2）：`schema_migrations` 只有 `version/name/applied_at`，跳过判定只看版本号，`name` 从不回读比对。因此"已应用迁移文件永不改动"是**纪律**而不是机械保证——改写 0001 不会报错，只会让老库与新库静默漂移。本轮唯一正确的做法是**只新增 0005**（含那一条加法 `ALTER TABLE`，先例是 0004 的 `ADD COLUMN device_key`），不要回改 0001–0004。
- `email_action_tokens` 的 `idx_email_action_live` 谓词不含 `expires_at`：**发新令牌前必须把该 `(user_id, purpose)` 下所有 `used_at IS NULL` 的行（含已过期）置位**，否则插入失败（§3.4 的三条硬规则，P0-3）。

### 6.2 新增设置键（`settingsService` 白名单）

| key | 类型 | 范围/默认 | 语义 |
|---|---|---|---|
| `mail.verificationRequired` | boolean | 默认 `false` | 桌面端未验证邮箱禁止登录（网页端不受限） |
| `mail.verificationTtlHours` | int | 1–168，默认 `48` | 验证令牌 TTL |
| `mail.emailChangeTtlHours` | int | 1–72，默认 `24` | 换邮箱确认 TTL |
| `mail.notifyNewDevice` | boolean | 默认 `true` | 新设备登录通知 |
| `mail.notifyPasswordChange` | boolean | 默认 `true` | 改密通知 |
| `account.deletionGraceHours` | int | 1–720，默认 `72` | 注销冷静期 |
| `account.exportCooldownMinutes` | int | 1–1440，默认 `60` | 数据导出冷却 |
| `audit.retentionDays` | int | 30–3650，默认 `180` | 审计保留（`db:prune` 读取） |

- 未配置 SMTP 时，设置页的邮件分组显示为**只读**并给出说明（`mail.verificationRequired` 也强制只读为 `false`，避免把自己锁在门外）。
- 只读能力块（不是设置键，PATCH 传它 → `422`）：
  ```jsonc
  "mail": { "mode": "smtp" | "outbox", "fromAddress": "Ecliptrix <no-reply@…>",
            "configured": true, "sent24h": 31, "failed24h": 0 }
  ```

### 6.3 审计动作增补（沿用 `domain.verb_object` 命名）

| action | 触发 | metadata（脱敏） | 自助可见（`SELF_VISIBLE_ACTIONS`） |
|---|---|---|---|
| `auth.email_verified` | 用户点击验证链接 | `{ purpose }` | **是（P0-6）** |
| `auth.email_verify_resent` | 重发验证 | `{ outboxId }` | 是（限流类，用户需要看到"我又发了一封"） |
| `user.email_change_requested` | 发起换邮箱 | `{ to: 'n***@b.c' }` | **是** |
| `user.email_change_cancelled` | 取消换邮箱 | `{}` | **是** |
| `user.email_changed` | 确认换邮箱 | `{ from: 'a***@b.c', to: 'n***@b.c', sessionsRevoked }` | **是** |
| `user.email_verified_by_admin` | 管理员覆盖 | `{ actor }` | **是**（用户有权知道"是管理员帮我放行的"） |
| `user.exported` | 数据导出 | `{ activityRows, sessions, truncated }` | **是** |
| `account.deletion_requested` | 申请注销 | `{ requiresConfirmation }` | **是** |
| `account.deletion_scheduled` | 确认注销 | `{ scheduledFor }` | **是** |
| `account.deletion_cancelled` | 取消注销 | `{}` | **是** |
| `account.deleted` | 清扫执行 | `{ priorEmailMasked, sessionsRevoked }` | **是**（账号已匿名化，这一行是用户唯一还能读到的收尾证据） |
| `account.deletion_confirmed_by_admin` | 管理员代确认（P1-11） | `{ reason, scheduledFor }` | **是** |
| `admin.sessions_revoked` | 批量踢下线 | `{ count, reason }` | 否（管理动作；用户侧看 `auth.session_revoked`） |
| `admin.users_exported` | CSV 导出 | `{ rows, filters }` | 否 |
| `mail.delivery_failed` | 投递失败（**只在管理员重试路径写**；普通失败只进 outbox 的 `last_error`，避免审计洪泛） | `{ outboxId, template }` | 否 |

> **"自助可见"这一列是 P0-6 的修正**：`/me/activity` 的实现是 `auditRepo.listForUser`，它用固定白名单 `SELF_VISIBLE_ACTIONS` + `action IN (…)` 过滤。不把新动作加进那个数组，桌面"活动"页签和网页活动页对本轮全部新功能都是空白——而现有测试一条都不会红。
> 既有动作一律不改名。`user.deletion_requested` 保留给历史行，新流程改用 `account.deletion_requested`，`/me/activity` 的标签映射对两者都要有文案。
> **metadata 硬规则（P1-10）**：任何动作都**不得**写入明文邮箱、完整 IP、令牌或其摘要。现网 `profileService.requestAccountDeletion` 写的 `{ email: user.email_normalized }` 是反例，本轮随委托一起改掉。
> **吊销理由词表（P1-12）**：`REVOKE_REASON` 现有 `logout`/`suspended`/`admin_revoked`/`refresh_reuse`/`password_changed`/`session_limit`/`deleted`/`same_device_relogin`，本轮追加 `email_changed`/`account_deleted`/`admin_lockdown`/`security_incident`。注意 `deleted`（管理员删号）**不能**被 `account_deleted`（本人注销）替代：两者并存，桌面端把两者都映射到 `account-deleted`，审计里则保持可区分。

### 6.4 服务端 i18n 新增键（`webserver/src/lib/i18n.ts`，zh-CN + en-US 各一份）

| 前缀 | 键（数量） |
|---|---|
| `verify.*` | `title`、`subtitle`、`success`、`successChanged`、`invalid`、`expired`、`resend`、`resent`、`alreadyVerified`、`sessionsRevoked` `{count}`、`backToAccount`（11） |
| `account.email.*` | `label`、`verified`、`unverified`、`verifyNow`、`changeTitle`、`changeHint`、`newEmail`、`password`、`submit`、`pending` `{email}`、`cancel`、`cancelled`、`alreadyTaken`、`mailDisabled`、`managedByAdmin`（15） |
| `account.export.*` | `title`、`desc`、`submit`、`cooldown` `{minutes}`、`denied`（5） |
| `account.danger.*`（改） | `requestRealTitle`、`requestRealDesc`、`confirmPassword`、`cancelRequest`、`scheduledFor` `{date}`、`awaitingConfirmation`、`graceNotice` `{hours}`、`requestedKept`、`cancelDone`（9，替换既有 5 键中的 `desc`/`requested`） |
| `admin.sessions.*` | `title`、`query`、`allClients`、`allPlatforms`、`activeOnly`、`revoke`、`revokeSelected`、`revoked` `{count}`、`skipped` `{count}`、`reason`、`reasonAdmin`、`reasonLockdown`、`reasonIncident`、`empty`（14） |
| `admin.mail.*` | `title`、`status`、`template`、`recipient`、`attempts`、`createdAt`、`sentAt`、`retry`、`notRetryable`、`detail`、`lastError`、`mode`、`modeSmtp`、`modeOutbox`、`sent24h`、`failed24h`（16） |
| `admin.overview.*`（改） | `loginsTrend`、`sessionsTrend`、`verifiedRate`、`pendingDeletions`、`clientMix`、`range14`、`range30`（7） |
| `admin.settings.mail.*` | `group`、`verificationRequired`、`verificationTtl`、`emailChangeTtl`、`notifyNewDevice`、`notifyPasswordChange`、`deletionGrace`、`exportCooldown`、`retentionDays`、`readOnlyNoSmtp`、`capabilities`（11） |
| `admin.users.*`（改） | `emailVerified`、`markVerified`、`exportCsv`、`verifiedAt`（4） |

合计约 92 键（两侧各一份）。既有 `tests/unit/i18n.test.ts` 会强制两字典键集一致，新增键必须同批提交，禁止 `tt('x') ?? 'x'` 式兜底。

### 6.5 桌面端 `SessionUser` 增量

```ts
export interface SessionUser {
  // …R2 既有字段保持不变…
  emailVerified: boolean          // 新增：来自服务端 user.emailVerified
}
export interface ServerMeta {
  // …R2 既有字段保持不变…
  emailVerificationRequired: boolean   // 新增：策略开关
}
export type AuthReason =
  | …R2 既有 **21** 值（v1 写的"19 值"是错的：`no-session`/`session-expired`/`session-revoked`/`account-suspended`/`account-locked`/`password-change-required`/`grace-expired`/`clock-rollback`/`network`/`client-outdated`/`maintenance`/`bridge-unavailable`/`server-not-configured`/`gate-disabled`/`invalid-credentials`/`rate-limited`/`weak-password`/`validation-failed`/`password-mismatch`/`registration-disabled`/`internal-error`）…
  | 'email-unverified'
  | 'account-deleted'
  | 'deletion-pending'
```

`account-deleted` 的产出条件收敛（P1-5、P1-12）：**只**由心跳/refresh 的 401 产生，且吊销理由 `account_deleted` 与 `deleted` 都映射到它；登录失败仍是 `invalid-credentials`。

`desktop/main/authSessionStore.js` 的 `auth-session.json` 结构**不加版本号**（信封已是 `schemaVersion: 1`）：`user.emailVerified` 只是多一个布尔，旧文件读出来为 `undefined` → 主进程启动时按 `false` 归一（并在下一次心跳后刷新）。

---

## 7. Testing & acceptance criteria

### 7.1 单元与集成（`webserver/tests/`）

| 文件 | 关键用例（名称即断言） |
|---|---|
| `tests/unit/mailTemplates.test.ts`（新） | `renders all 12 templates in both locales`；`never renders a token into outbox payload`；`escapes html in displayName`；`subject <= 120 chars` |
| `tests/unit/accountExport.test.ts`（新） | `export contains no *_hash keys`；`export contains no token digests`；`activity capped at 5000 with truncated flag` |
| `tests/unit/i18n.test.ts`（既有，自动纳入） | `dictionaries have identical key sets`（新键不同步 → 红） |
| `tests/unit/settings.test.ts`（改） | `new keys have defaults and bounds`；`unknown key is 422`；`mail.verificationRequired ignored when smtp off` |
| `tests/integration/mailPipeline.test.ts`（新） | `queue persists before send`；`smtp failure leaves api result unchanged`；`daily cap 20 per user blocks delivery`；`retry only for retryable rows`；**`transport uses the configured timeouts`（P0-1：断言 `createTransport` 收到三个超时且等于 `MAIL_SEND_TIMEOUT_MS`）** |
| `tests/integration/emailVerification.test.ts`（新） | `register queues verify-email`；`verify success sets email_verified_at`；`expired token is token_invalid`；`used token is token_invalid`；`purpose mismatch is token_invalid`；`resend invalidates previous token`；`admin mark verified writes audit`；`verificationRequired blocks desktop login only`；**`register is never blocked by verificationRequired`（P0-4）**；**`resend after the previous token expired still inserts`（P0-3：过期未用行会占住局部唯一索引）** |
| `tests/integration/emailChange.test.ts`（新） | `change requires correct password`；`sends two mails (new + old)`；`confirm updates email and revokes other sessions`；`concurrent confirm of same new address: one 409`；`cancel clears pending` |
| `tests/integration/accountDeletion.test.ts`（新） | `request stores awaiting_confirmation + mails confirm link`；`request without smtp schedules immediately`；`confirm schedules for now+grace`；`cancel sets cancelled`；`sweep anonymises user and revokes sessions`；`owner cannot delete`；`last admin cannot delete`；`deleted user heartbeat returns details.reason account_deleted`；**`two consecutive no-smtp requests do not violate token uniqueness`（P0-2）**；**`re-request cancels the previous live row before inserting`（P0-2）**；**`admin can confirm a pending request on behalf`（P1-11）**；**`request audit metadata contains no plaintext email`（P1-10）** |
| `tests/integration/accountExport.test.ts`（新） | `export returns attachment headers`；`cooldown returns 429 with retryAfter`；`audit row written`；**`429 body is json, not an attachment`（P1-4）**；**`cooldown is driven by users.last_exported_at`（P1-13）** |
| `tests/integration/activity.test.ts`（新） | **`self-visible list contains the new lifecycle actions`（P0-6：注册→验证→换邮箱→导出→申请注销，逐条断言 `/me/activity` 能看到）**；`admin-only actions stay invisible` |
| `tests/integration/admin.test.ts`（既有，改） | `invite mail carries a one-shot code`；`invite without email keeps the old response shape`（AC-14 的证据落点） |
| `tests/integration/adminSessions.test.ts`（新） | `list filters by client/platform/activeOnly`；`list masks email and ip`；`bulk revoke caps at 100`；`bulk revoke writes one aggregated audit row` |
| `tests/integration/adminMail.test.ts`（新） | `list masks recipient`；`detail returns text but not html`；`retry rejected for retryable=0`；**`retry is allowed for admin and refused for support`（P1-3）** |
| `tests/integration/metrics.test.ts`（新） | `trend arrays have requested length`；`days out of range is 422`；`clientBreakdown sums to active sessions` |
| `tests/integration/export-csv.test.ts`（新） | `csv starts with BOM`；`column order is stable`；`respects filters` |
| `tests/integration/sweep.test.ts`（新） | `sweepIfDue runs at most hourly`；`sweep is idempotent`；`sweep failure does not fail the request` |
| `tests/integration/rbac.matrix.test.ts`（改） | 4 角色 × 新增 8 个 admin 端点的状态码矩阵，**期望值逐格取自 §3.9 的"真实权限矩阵"**（例：`support` 读 `/admin/sessions` 200 **且批量吊销也是 200**——它持有 `sessions.revoke`；`support` 读 `/admin/mail` 403；`admin` 重试邮件 200） |
| `tests/integration/migrate.test.ts`（改） | `0005 applies once and is idempotent`；`partial unique index rejects second live request`；**`two rows may both have a null token_hash`（P0-2）**；**`ALTER TABLE users ADD COLUMN last_exported_at is additive`（P1-13）** |

### 7.2 桌面端

| 文件 | 用例 |
|---|---|
| `desktop/main/authBridge.test.js`（改） | `auth:me validates no arguments`；`auth:update-profile rejects unknown fields`；`auth:update-profile rejects bad locale/timezone`；`auth:activity returns items`；`resend-verification returns timestamps`；`password_change narrows to 6 channels incl. auth:me` |
| `desktop/main/authHttp.test.js`（改） | `me/get path is /api/v1/me`；`updateProfile sends PATCH`；`activity path is /api/v1/me/activity`；`resend path is /api/v1/auth/email/verify/resend`；`heartbeat exposes details.reason` |
| `desktop/main/authController.test.js`（新） | **`deleted and account_deleted both map to account-deleted`（P1-12）**；**`a deleted-and-anonymised account is treated as dead, not as a network blip`**；**`activity masks ipv4 before it reaches the renderer`（P1-6）**；`refresh failure keeps the session`（R2 既有行为回归） |
| `desktop/scripts/auth-smoke.js`（改） | 假服务端返回 `403 email_not_verified` → 登录面显示对应 reason、返回 `409 email_already_verified` → 提示已验证、`401 session_revoked{account_deleted}` → 清会话并显示注销页、`PATCH /me` 往返、`/me/activity` 往返（14 → ≥20 条） |
| `src/components/auth/__tests__/AccountCentreDialog.test.tsx`（新） | `renders 4 tabs`；`profile save calls updateProfile`；`shows unverified banner + resend`；**`renders without the four methods and degrades`（P1-7：逐方法探测，缺方法时不渲染对应按钮）**；`closing returns focus to trigger`；**`account centre link prefers runtime baseUrl`（P1-8）** |
| `src/components/auth/__tests__/LoginScreen.test.tsx` | 新增 `shows email-unverified copy with resend hint` 用例；**不**为 `account-deleted` 增登录文案用例（P1-5） |

### 7.3 浏览器级 e2e（`webserver/e2e/`，Chromium）

| # | 流程 | 断言要点 |
|---|---|---|
| 01 | 落地页 | 标题、CTA、导航、主题切换、无控制台 error |
| 02 | 注册 → 收验证信（outbox）→ 验证 → 徽标变已验证 | outbox 页出现 `verify-email`；`/verify-email` 显示成功 |
| 03 | 登录 → 账号中心 → 改显示名 → 语言切换 | PATCH 生效；界面语言立即变化（R1 R-34 的回归点） |
| 04 | 忘记口令 → outbox 取链接 → 重置 → 新口令登录 | 旧口令 401、新口令 200 |
| 05 | 换邮箱 | 两封信；确认后登录名变为新邮箱；其他会话被踢 |
| 06 | 管理员：用户 CRUD + 权限拒绝 | `support` 访问 `/admin/users` 看到 403 页；`admin` 可编辑 |
| 07 | 管理员：全局会话踢下线 | 被踢账号下一次请求 401 |
| 08 | 注销全流程（含取消一次） | 取消后账号可用；再次申请 + 时间推进（测试注入 `now`）→ 清扫后登录 401 |

### 7.4 无障碍（`e2e/a11y.spec.ts`）

对 `/`、`/login`、`/account`、`/admin`、`/admin/sessions` 跑 `@axe-core/playwright`，`serious`/`critical` 必须为 0；同时断言每页恰好一个 `<h1>`、主内容有 `main` 地标、焦点可见（`focus-visible` 轮廓）。

### 7.5 验收标准（每条都可核对）

| ID | 判据 | 证据（文件 / 命令） |
|---|---|---|
| AC-01 | 迁移 0005 幂等，连跑两次第二次 "nothing to do" | `npm run db:migrate` ×2 输出 |
| AC-02 | 每封邮件先落 `mail_outbox` 再尝试投递，三类状态可写 | `tests/integration/mailPipeline.test.ts` 前 2 例 |
| AC-03 | SMTP 故障不改变任何 API 结果 | `mailPipeline` 第 2 例 + `auth.test.ts` 重置用例 |
| AC-04 | 每用户每日 20 封上限生效 | `mailPipeline` 第 3 例 |
| AC-05 | 带令牌邮件 `retryable=0` 且 payload 已脱敏 | `mailTemplates` 第 2 例 + `adminMail` 第 3 例 |
| AC-06 | 注册后 outbox 出现 `verify-email`，链接可用 | `emailVerification` 第 1、2 例 + e2e-02 |
| AC-07 | 过期/已用/用途不符统一 `400 token_invalid` | `emailVerification` 第 3–5 例 |
| AC-08 | 重发使旧令牌失效，已验证返回 `409 email_already_verified` | `emailVerification` 第 6 例 |
| AC-09 | `mail.verificationRequired=true` 时未验证桌面端登录 `403 email_not_verified`，网页端不受限，管理员豁免 | `emailVerification` 第 8 例 |
| AC-10 | 换邮箱需要正确口令，错误口令 `401 password_mismatch` | `emailChange` 第 1 例 |
| AC-11 | 换邮箱发两封信（新址确认 + 旧址通知） | `emailChange` 第 2 例 |
| AC-12 | 确认换邮箱后撤销其他会话并写 `user.email_changed` | `emailChange` 第 3 例 + `account/security` 页面 |
| AC-13 | 同一新址并发确认只成功一次（另一个 `409 email_taken`） | `emailChange` 第 4 例 |
| AC-14 | 邀请邮件含一次性 code；无 `email` 时行为不变 | `admin.test.ts` 新增 2 例 |
| AC-15 | 导出为 JSON 附件，含 6 个区块，绝不含任何 `*_hash` | `accountExport` 第 1、2 例 |
| AC-16 | 导出冷却期内 `429` 且带 `retryAfterSeconds` | `accountExport` 第 3 例 |
| AC-17 | 注销需口令；错误口令 `401`；有活跃申请时 `409 deletion_pending` | `accountDeletion` 第 1、7 例 |
| AC-18 | 无 SMTP 时注销直接排期（`requiresConfirmation:false`） | `accountDeletion` 第 2 例 |
| AC-19 | 确认后排期 `now + deletionGraceHours`，可取消 | `accountDeletion` 第 3、4 例 |
| AC-20 | 到期清扫匿名化用户、撤销会话、写 `account.deleted`、状态 `completed` | `accountDeletion` 第 5 例 + `sweep` |
| AC-21 | `owner` 与"最后一个管理员"不可注销 | `accountDeletion` 第 6 例 |
| AC-22 | 桌面端收到 `details.reason='account_deleted'` 后清会话并显示注销页 | `desktop/scripts/auth-smoke.js` 第 18–19 条 |
| AC-23 | 桌面账号中心 4 页签可用，资料保存往返 | `AccountCentreDialog.test.tsx` 4 例 |
| AC-24 | 4 个新 IPC 通道拒绝非法输入且不泄漏令牌 | `authBridge.test.js` 6 例 |
| AC-25 | 强制改密期间通道收窄为 6 个（含 `auth:me`） | `authBridge.test.js` 最后一例 |
| AC-26 | `/admin/sessions` 可按 client/platform/activeOnly 筛选并批量吊销（≤100） | `adminSessions` + RBAC 矩阵 |
| AC-27 | 批量吊销只写**一行**聚合审计 | `adminSessions` 第 4 例 |
| AC-28 | `/admin/mail` 收件人脱敏、详情不含 html、`retryable=0` 拒绝重试 | `adminMail` 3 例 |
| AC-29 | 概览返回 30 天三序列 + 验证率 + 待注销数 + 版本分布 | `metrics` 3 例 |
| AC-30 | CSV 带 BOM、列序固定、遵守筛选 | `export-csv` 3 例 |
| AC-31 | 8 个新增 admin 端点纳入 RBAC 矩阵（4 角色），期望值逐格取自 §3.9「真实权限矩阵」（`support` 批量吊销 = 200、`support` 读邮件 = 403、`admin` 重试邮件 = 200、`admin` 保存设置 = 403） | `rbac.matrix.test.ts` |
| AC-32 | 新增 8 个设置键有默认值/边界；未知键仍 422 | `settings.test.ts` |
| AC-33 | 两语言字典键集一致（含 92 个新键） | `tests/unit/i18n.test.ts` |
| AC-34 | e2e 8 条主流程全绿（Playwright 例外须登记偏差） | `npm run test:e2e` |
| AC-35 | 5 个页面 axe 0 serious/critical | `npm run test:a11y` |
| AC-36 | `smoke.mjs` ≥ 96 条 0 failed（新进程 + 一次性库） | `node scripts/smoke.mjs` |
| AC-37 | webserver `type-check` 0 error / `lint` 0 warning / `npm test` ≥ 232 全绿 / `build` 成功 | 4 条命令输出 |
| AC-38 | 桌面 `test:auth` ≥ 128、`auth-smoke` ≥ 20、渲染 auth 用例 ≥ 38 | 3 条命令输出 |
| AC-39 | 根项目 `npx tsc --noEmit` 0 error、`npm run build` 成功 | 2 条命令输出 |
| AC-40 | `README.md`/`docs/api.md`/`docs/desktop-integration.md` 与实现逐条一致（尤其"无 SMTP 时会发生什么"） | 文档内的自检清单（`grep` 端点/错误码/设置键三张表与实现逐一比对）；**纯人工"逐条比对"不再是唯一证据**（P2-9） |
| AC-41 | 邮件传输有界：`createTransport` 收到 `connectionTimeout`/`greetingTimeout`/`socketTimeout`，且都等于 `MAIL_SEND_TIMEOUT_MS` | `mailPipeline` 的 `transport uses the configured timeouts` + `mailer.ts` 代码复核 |
| AC-42 | 无 SMTP 连续两次注销申请都不 500，且旧申请先被置 `cancelled` | `accountDeletion` 的 `two consecutive no-smtp requests…` 与 `re-request cancels the previous live row…` |
| AC-43 | 过期未用的旧验证令牌不会阻塞新令牌签发 | `emailVerification` 的 `resend after the previous token expired still inserts` |
| AC-44 | `mail.verificationRequired=true` 时注册仍返回 201，只有登录被拦 | `emailVerification` 的 `register is never blocked by verificationRequired` |
| AC-45 | 本轮新增的自助事件全部出现在 `/me/activity`；管理动作不出现 | `activity.test.ts` 两例（P0-6） |
| AC-46 | 基线数字由命令产出并与本 spec 一致（174 tests / 62 smoke / 27 渲染用例 / 21 个 `AuthReason`） | 运行 §7.5 上方"核验方法"一节的 3 条计数命令，输出与文中数字逐字一致 |

### 7.6 手工走查清单（打包后必须逐条打勾，记录在 PR 描述里）

| # | 步骤 |
|---|---|
| M-1 | 全新 `userData` 启动桌面端 → 登录屏 → 注册 → 收到 outbox 里的验证信（本地 SMTP 或 outbox 页）→ 验证 → 标题栏徽标变已验证 |
| M-2 | 未验证 + `verificationRequired=true` → 桌面登录看到"去验证邮箱"引导，网页端仍可登录 |
| M-3 | 账号中心：改显示名/语言/时区 → 重启桌面端仍生效；设备页签与网页 `/account/security` 一致 |
| M-4 | 换邮箱：收到两封信 → 确认 → 旧会话被踢（另一台设备下一次心跳 401） |
| M-5 | 导出：网页下载 JSON → 用编辑器打开确认无哈希字段 |
| M-6 | 注销：申请 → 邮件确认 → 取消 → 再申请 → 把系统时间推进超过冷静期或用 `npm run accounts:sweep` → 桌面端显示"账号已注销" |
| M-7 | 管理后台：`/admin/sessions` 批量踢下线 → 被踢账号 5 秒内（下一次请求）失效 |
| M-8 | 管理后台：`/admin/mail` 看到失败邮件、重试一次非令牌邮件成功 |
| M-9 | 破窗账号 `admin/adminjr` 在账号服务完全停机时仍可进入应用，且**不产生任何网络请求**（DevTools Network 为空） |
| M-10 | 深色/浅色 × 1440/1024/768 三档宽度：两个新页面无横向滚动、表格可读、趋势图不溢出 |

---

## 8. Risks & mitigations

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 邮件送达率（SPF/DKIM/DMARC、被投垃圾箱） | 验证/找回不可用 | `docs/api.md` 与 README 给 DNS 配置清单；outbox 让"发出去了吗"可查；验证失败可走管理员覆盖端点 |
| R2 | 令牌走 URL 被 Referer/日志泄漏 | 账号接管 | 全局 `Referrer-Policy: no-referrer`（middleware 已设，nginx 覆盖兜底）；令牌单次 + 短 TTL；页面用 POST 消费而不是 GET 生效；令牌不落库明文、不进 outbox、不进日志 |
| R3 | 注销不可逆造成误删 | 用户流失 | 72 h 冷静期 + 邮件可取消 + 申请期间可登录（只有 `scheduled` 才在下一轮清扫生效）+ 管理员可见 + 首次申请需口令 |
| R4 | 匿名化撞唯一索引（`email_normalized`/`username_normalized`） | 清扫失败卡住队列 | 用 `deleted+<id 前 8>@deleted.invalid` / `deleted_<id 前 8>`（id 是 UUID，前缀碰撞概率可忽略，且真实冲突时事务回滚后重试一次并记录 `last_error`） |
| R5 | 惰性清扫在每请求路径上引入延迟 | 全站变慢 | `sweepIfDue()` 只读一行 `app_settings` 判时间戳（<0.1 ms），1 小时一次；清扫体量用 `LIMIT 200` 分批；失败只 warn |
| R6 | SMTP 未配置时"注销可直接排期"被误解为安全洞 | 账号被恶意注销 | 需要口令 + 会话；管理员在 `/admin/audit` 可见；README 明确写出该降级；恶意注销可被管理员在冷静期内恢复（`PATCH /admin/users/{id}` 无法撤回匿名化，但**未到期前**可取消，故要求冷静期 ≥1 h） |
| R7 | 新增设置键导致旧前端保存设置时 422 | 管理员无法保存 | PATCH 为**按 key 局部更新**（既有契约），新增键不改变既有键；`settings-form.tsx` 同批更新 |
| R8 | 新增错误码破坏桌面端映射 | 桌面端显示"未知错误" | `authErrors.toUiReason` 未知码回落 `internal-error`（既有行为），且本轮同批补 3 个新 reason + 6 个新码文案 |
| R9 | Playwright 浏览器下载失败（内网/离线） | 无 e2e | 允许登记受控偏差（§3.12 注），`smoke.mjs` 仍是硬门禁；实施节点必须在 spec 尾部记录原文报错 |
| R10 | 趋势聚合在 10 万行以上变慢 | 概览页卡 | 0005 补 `sessions(created_at)`、`login_attempts(created_at)` 索引；`days` 上限 90；后续可加日汇总表（本轮不做，见 §9） |
| R11 | 邮件内 HTML 被注入（显示名含 `<script>`） | 钓鱼/渲染问题 | 模板对所有插值 `escapeHtml`；outbox 只存 `body_text`（不存 html）；`/admin/mail` 详情只渲染 `<pre>` 文本 |
| R12 | 桌面端旧版本主进程 + 新渲染层 | 崩溃 | 账号中心在 `bridge` 缺方法时以"仅状态 + 打开浏览器"降级（`AccountCentreDialog.test.tsx` 有专门用例） |
| R13 | 注销/换邮箱与并发登录竞争（同一用户两次请求） | 状态错乱 | 所有状态迁移在 `better-sqlite3` 事务内 + 局部唯一索引兜底；`sessions` 吊销按 `user_id` 全量条件更新 |
| R14 | 文档与实现再次漂移（R1/R2 都发生过） | 误信文档 | §7.5 AC-40 要求文档逐条比对；`README.md` 的"验收自检"数字与本 spec 的 §3.12 必须一致（实施节点自查清单在 §11.2） |

---

## 9. 本轮明确不做（附理由，避免下一轮重复讨论）

| 项 | 理由 | 出处 |
|---|---|---|
| 2FA / TOTP / WebAuthn / OAuth 社交登录 | 需要新的凭证类型、恢复码、审计与 UD 流程，量级接近本轮全部内容；当前破窗账号 + 邮件验证已覆盖"找回"场景 | R1 §8.3 #2/#3、R2 §1.3 |
| 订阅/计费（`plan_tag` 只作标签） | 用户需求不涉及付费；`plan_tag` 已预留 | R1 §8.3 #3 |
| PostgreSQL 适配 / 多副本 | 需要重写 `db/client.ts` 与迁移语法、引入连接池与共享限流；单人运维场景 SQLite + WAL 足够 | R1 §8.3 #5、§2.12 |
| SSE / WebSocket 实时事件（审计流、在线状态） | 与单实例约束冲突；`/admin/sessions` 轮询已足够 | R1 §8.3 #6 |
| 第三种语言 / 邮件模板可视化编辑 | 模板用 TS 常量即可维护；可视化编辑器是独立产品面 | R1 §2.1、§8.3 #4 |
| CSV **批量导入**用户 | 导入的失败语义（部分成功/回滚/口令生成）会拖长本轮；导出已满足"带走数据"的合规目的 | 本轮新增判断 |
| 全文审计搜索 / 导出审计 | 既有 `LIKE` 搜索 + 目标筛选够用；审计导出是独立需求 | 本轮新增判断 |
| 邮件投递重试队列（后台 worker） | `next start` 无常驻 worker；同步尝试 + 管理端手动重试已覆盖 99% 场景 | 本轮新增判断 |
| 桌面端内实现导出下载（保存对话框） | Electron 沙箱 + `dialog` 成本高；`openExternal` 打开网页账号中心更稳 | 本轮新增判断 |
| 登录页语言/主题切换 | 桌面端语言跟随应用设置（R2 已有）；登录屏额外控件收益低 | 本轮新增判断 |
| 客户端证书固定 / 本地令牌加密增强 | R2 已明确为非目标（无中间人威胁模型） | R2 §2.1.1 |
| 修根项目既有 lint 10 error | 与账号平台无关，属独立债务 | R2 D-17 |

---

## 10. 自评弱点（供评审节点优先攻击）

1. **`mail.verificationRequired` 的默认值**：默认关是为了不破坏 R1/R2 的既存用户（`email_verified_at` 全为 NULL，一开就全员锁死）。评审若要求默认开，必须先给出"一次批量放行脚本"作为迁移前提——本 spec 只提供了 `user:verify` 单人命令，没有批量。
2. **无 SMTP 时注销跳过邮箱确认**：这是可用的妥协，但它把"账号所有权证明"降级为"知道口令"。评审可要求改为"必须管理员在 `/admin/users` 手动批准"，代价是多一个端点与一个页面状态。
3. **注销用惰性清扫而非调度器**：`next start` 没有常驻定时器。若部署方不设 cron 且长期无人访问，注销会延迟到下一次任意请求。可接受但不精确，评审可要求 boot 时也强制扫一次（本文已写 `boot.ts` 调用一次）。
4. **`/admin/sessions` 列表里的邮箱/IP 脱敏**：管理员排查问题时可能需要完整值。取舍是"页面不成为个人数据批量出口"，完整值仍在 `/admin/users/{id}` 与审计页。
5. **CSV 导出上限 20000 行**：超出时需筛选，属于隐式限制；评审可要求改成流式响应，代价是 route 需返回 `ReadableStream`，与现有 `ok()` 信封不兼容。
6. **e2e 依赖环境**：Playwright 在离线环境可能装不上，本 spec 允许登记偏差——这是最可能被打回的放松点。
7. **趋势指标新增 4 个聚合查询**：`clientBreakdown` 的 `GROUP BY platform, app_version` 在会话量大时仍可能扫全表；`active` 条件已走 `idx_sessions_active`，但分组列无索引。若评审要求硬指标，可加"日汇总表"（本轮刻意不做）。
8. **桌面账号中心与网页账号中心功能重叠**：两端都要维护 i18n 与降级分支，长期是双写成本。R2 的"桌面只管门、网页管管理"原则本轮被部分打破，理由是"用户原地管理"的体验价值；评审可以否决这一条而不影响 P0–P5。

**评审后追加（v2 仍然存在的、已记录不做的取舍）**：

9. **`admin` 角色不能保存设置**是既有权限事实（只有 `owner` 持 `settings.write`），本轮只在 §3.9 的矩阵里如实写出，没有修。修它属于角色设计变更，会牵动 R1 的角色矩阵与全部 RBAC 用例，收益不抵风险；但它意味着"管理员进设置页只能看"这一体验问题会继续存在。
10. **P2 清单里仍有 5 条未处理**（P2-1 已随文订正；P2-3/P2-5/P2-7/P2-10 已写进正文；P2-6 的 `deletion_pending` 与 `PATCH /me` 的组合、P2-11 的用例计数口径保留给实施节点决定）。它们不阻断实施，但 P2-6 需要实施时明确"是否真的禁止改资料"。
11. **e2e 的偏差容错仍是最大的放松点**：Playwright 需要下载 ~150 MB 浏览器，离线环境装不上时允许登记偏差。本轮的硬门禁因此落在 `smoke.mjs ≥ 96` 上；如果实施节点既装不上 Playwright 又没扩到 96，本轮等于没有回归护栏。

---

## 11. Appendix

### 11.1 与 R1/R2 契约的差异（D3-xx，实施时若与本文不同必须回写此处）

| ID | 差异 | 理由 |
|---|---|---|
| D3-01 | `password-reset` 邮件从 `mailer.sendPasswordResetMail` 迁到 `mailService + templates`，`mailer.ts` 只保留 `isMailEnabled()`/`sendRaw()` | 一条发送出口，否则 outbox 永远不完整 |
| D3-02 | `POST /me/deletion-request` 语义升级：不再只是"记录一个请求"，而是开启状态机（R1 D-01 明说"不删除账号"） | 用户需求是"真能注销"，审计-only 无法闭环 |
| D3-03 | 新增 `token_invalid`(400) 与既有 `invalid_request`(400) 并存 | 前者是"链接问题"（可给用户具体文案），后者是"请求格式问题" |
| D3-04 | `mustChangePassword` 缩口名单 5 → 6（加 `auth:me`） | 强制改密页需要显示当前身份；这不放宽任何写能力 |
| D3-05 | 桌面端账号中心从"仅跳浏览器"变为"内嵌 4 页签 + 保留跳转" | 体验收尾；不改变令牌留在主进程的不变量 |
| D3-06 | `/admin/metrics` 的 `registrationTrend` 长度由 14 固定变为 `days` 参数（默认仍 14） | 向后兼容：不传参时行为与现在逐字相同 |
| D3-07 | 邀请码创建响应新增 `mail` 字段 | 只加不改；未传 `email` 时为 `null` |
| D3-08 | `auth-heartbeat` 的 401 响应体新增 `error.details.reason` | 桌面端需要区分"被踢"与"已注销"；旧客户端忽略该字段 |
| D3-09 | 设置页新增只读 `mail` 能力块（不是设置键） | 管理员需要知道"现在到底发不发得出去" |
| D3-10 | 保留清理由"README 里的 SQL"变为 `npm run db:prune` | R1 §7 R9 明确"本轮不自动清理"，本轮补上 |
| D3-11 | 管理员代发口令重置在无 SMTP 时的错误码由 `service_unavailable` 改为 `mail_disabled`，并在有 SMTP 时检查投递结果（原先忽略 `false` 仍回 200） | 评审 P1-1：不变量写成"绝对"，而现网这条路径本来就是 503；把两处语义统一到同一个码，同时让"管理员以为发出去了"不再可能 |
| D3-12 | `account_deletion_requests.token_hash` 由 `NOT NULL UNIQUE` 改为**可空 + 局部唯一索引** | 评审 P0-2：无 SMTP 降级路径不产生令牌，非空唯一会让第二次申请 500 |
| D3-13 | 导出冷却期的数据源由"最近一条 `user.exported` 审计"改为 `users.last_exported_at`（0005 中的一条加法 `ALTER TABLE`） | 评审 P1-13：审计是 best-effort 且会被保留期清理，不能作为授权/限流输入 |
| D3-14 | `/admin/mail/{id}/retry` 的守卫由 `settings.write` 改为 `users.write` | 评审 P1-3：`admin` 角色没有 `settings.write`，原设计等于"只有超管能重试邮件" |
| D3-15 | `mail.verificationRequired` **不施加于注册**，且无 SMTP 时在读写两侧夹紧为 `false` | 评审 P0-4 / P2-2：注册必然未验证，拦注册等于关站；无 SMTP 时开启策略等于把全体桌面端锁死 |

### 11.2 实施顺序检查表（按此顺序做，每步跑对应门禁）

1. 0005 迁移 + `db:migrate` ×2（AC-01）。**先跑一次 DDL 语法自检**（`python -c` + 内存 SQLite 执行 0005 全文），因为本项目没有 checksum 保护，写错的文件不会被任何机制发现。
2. `mailer.ts` 收窄 + **三个传输层超时** + `templates.ts` + `links.ts` + `mailService` + `mailOutboxRepo` + 迁移 `password-reset` 调用点 → `npm test`（既有 174 全绿，AC-41）。
3. 设置键 8 个 + 设置页字段 + 无 SMTP 时的夹紧（AC-32、D3-15）。
4. 邮箱验证服务 + 2 个端点 + `verify-email` 页（AC-06…09、43、44）。
5. 换邮箱 + `email-panel`（AC-10…13）。
6. 邀请邮件 + 三类通知（AC-14）。
7. 导出 + `data-export-panel` + `users.last_exported_at`（AC-15、16）。
8. 注销服务 + 2 个端点 + **管理员代确认端点/CLI** + `confirm-deletion` + `danger-zone` 改造 + `maintenanceService`（AC-17…22、42）。
9. **`auditRepo.SELF_VISIBLE_ACTIONS` 补新动作 + `activity.test.ts`（AC-45，必须在桌面账号中心之前做，否则"活动"页签是调不通的空壳）**。
10. 桌面主进程 4 通道 + `authErrors` + `authController` 脱敏 + 渲染 `AccountCentreDialog`（AC-23…25）。
11. `/admin/sessions`、`/admin/mail`、指标扩展、CSV、RBAC 矩阵（AC-26…31）。
12. `smoke.mjs` 扩到 ≥96（AC-36）。
13. Playwright + axe（AC-34、35，允许登记偏差）。
14. i18n 全量补键（AC-33）。
15. 文档三件套（AC-40）。
16. 全门禁（AC-37…39），并用 §7.5 的计数命令核对 AC-46。

### 11.3 命令速查

```bash
# 账号服务
cd webserver && npm run type-check && npm run lint && npm test && npm run build
cd webserver && npm run db:migrate            # 两次，第二次 nothing to do
cd webserver && npm run db:prune -- --dry-run
cd webserver && npm run accounts:sweep -- --dry-run
cd webserver && ECLIPTRIX_E2E=1 npm run test:e2e
cd webserver && npm run test:a11y
# 冒烟必须对“新进程 + 一次性库”执行
cd webserver && DATABASE_PATH=./data/smoke-$(date +%s).db npm run dev   # 终端 A
cd webserver && node scripts/smoke.mjs                                  # 终端 B

# 桌面端
cd desktop && npm run test:auth
cd desktop && node scripts/auth-smoke.js
# 根项目
npx vitest run src/components/auth src/contexts
npx tsc --noEmit && npm run build
```

### 11.4 需求逐条自检（对应用户原始要求）

| 用户原话 | 本轮如何继续满足 |
|---|---|
| "给这个项目开发一个 Web Server 的子项目" | `webserver/` 已存在（R1）；本轮在其内扩展，不新起目录 |
| "用来进行网站部署" | 部署产物在 R1（`Dockerfile`/`docker-compose.yml`/`deploy/`）；本轮补 `deploy/cron.example` 与"AUTO_MIGRATE/邮件/清理"三节运维说明 |
| "管理员可以在上面进行账号的增删改查和权限分配" | 既有 CRUD + 角色矩阵（R1）；本轮补全局会话治理、CSV 导出、强制标记邮箱已验证、邮件可观测 |
| "用户在桌面端登录需要连接到外部项目验证" | R2 已交付；本轮补验证策略、注销后即时失效、错误原因可区分 |
| "桌面端有一个最高权限账号，写死在配置文件里（admin/adminjr）" | 完全不变（`desktop/main/localAdmin.js` + `desktop-config.json`）；本轮零改动，M-9 专测 |
| "其他用户必须通过服务器登录/注册" | 不变；新增的验证/换邮箱/注销都走同一账号服务 |
| "整体界面和风格是 Supabase 风格，顶级设计/体验/交互" | 新增页面全部复用既有 `console-shell` + `ui/*` + 主题变量；新增 `trend-chart` 零依赖内联 SVG；§7.4 用 axe 与焦点检查把"体验"变成可核对项 |
| "管理员登录到用户管理界面；普通用户只能看落地页和自己的账号信息" | 既有 RBAC 不变；本轮新增端点全部走 `requireAdmin*`，并在 RBAC 矩阵里逐条断言（AC-31） |
| "我没有考虑到、你来完善" | 本轮补的邮件闭环、导出、注销、桌面账号中心、运营指标、质量闸门即是对该句的回应；未做的 12 项在 §9 给出理由 |

---

**文档结束**。本节点仅产出本文档；实现、文档三件套更新（`README.md`、`webserver/docs/api.md`、`webserver/docs/desktop-integration.md`）与提交由下游节点完成。

---

## 评审结论

**判定：有条件通过（approved with conditions）。**

v1 的**范围判断是对的**：它没有另起炉灶，而是准确抓住了已交付两半（`webserver/` 账号服务 + `desktop/` 登录闸门）之上真实存在的三条"最后一公里"——邮件只有一条腿、注销与导出是假的、运营与回归靠肉眼。§2 的现状基线除 4 处数字与 3 处措辞外，逐条都能在源码中核对（已核实项见「评审记录 · 已核实为正确的断言」）；三条架构铁律（分层、守卫入口、迁移只加不改）也都被新模块遵守，没有出现"新岛"。

**6 项 P0 与 13 项 P1 已在正文就地修复，本版本（v2）具备实施条件。** 其中三项 P0 属于"照原样写就是 500/挂死/关站"级别：邮件发送没有传输层超时（注册可挂 1 小时）、注销表把 `token_hash` 定成非空唯一（无 SMTP 时第二次申请必炸）、验证策略同时拦注册（策略一开就没人能注册）。另外三项会让功能"上线即空转"且测试不红：新错误码漏改 `ERROR_CODE`（tsc 挂）、自助可见审计白名单不含新动作（活动页签全空）、权限值假设与真实角色不符（AC 期望值本身就是错的）。

### 放行条件（C-1…C-10，逐条可核对）

任一条不成立，"通过"即不成立——这是判定的边界，不是建议。

| # | 条件 | 核对方式 |
|---|---|---|
| C-1 | 邮件传输有界：三个 nodemailer 超时全部由 `MAIL_SEND_TIMEOUT_MS` 派生，用户热路径不 `await` 投递 | AC-41 + `mailer.ts` 代码复核 |
| C-2 | 令牌与注销申请的局部唯一索引在"过期未用 / 无令牌"两种情形下都不炸 | AC-42、AC-43 |
| C-3 | `mail.verificationRequired=true` 时注册返回 201，只有登录被拦 | AC-44 |
| C-4 | 5 个新错误码同时存在于 `ERROR_CODE` 与 `ERROR_STATUS`，`tsc --noEmit` 为 0 error | AC-37 + `validation.test.ts` 新断言 |
| C-5 | 本轮新增的自助事件出现在 `/me/activity`，管理动作不出现 | AC-45 |
| C-6 | RBAC 矩阵逐格取自 §3.9 的"真实权限矩阵"（`support` 可批量吊销、不可读邮件；`admin` 可重试邮件、不可保存设置） | AC-31 |
| C-7 | 两个导出端点用 `new NextResponse(...)` 返回附件，错误分支仍是 JSON 信封且带 `x-request-id` | AC-15、AC-30 + `429` 的 `content-type` 断言 |
| C-8 | 任何审计 metadata 不含明文邮箱/完整 IP/令牌摘要 | AC-20 区段 + `accountDeletion` 的脱敏用例 |
| C-9 | 桌面账号中心逐方法能力探测；"在浏览器中打开"优先用运行时 `server.baseUrl` | AC-23 + `AccountCentreDialog` 两例 |
| C-10 | 门禁数字由命令产出并与本 spec 一致：`smoke.mjs ≥ 96`、`npm test ≥ 232`、`type-check` 0 error、`lint` 0 warning、桌面 `test:auth ≥ 128`、`auth-smoke ≥ 20`、渲染用例 ≥ 38 | AC-36、37、38、46 |

### 会被打回为"不通过"的情形（提前写明，避免实施期争议）

1. 为了让某个用例通过而**回改 0001–0004 迁移**（本项目没有 checksum，改了不会报错，只会让老库漂移）。
2. 把 `smoke.mjs` 的 ≥96 条降级，或把 e2e 偏差当成"已完成"（P2-8）。
3. 为了"更好的文案"把已注销账号的登录响应从 `invalid_credentials` 改成 `account_deleted`（P1-5，防枚举）。
4. 在 route 里直接 `nodemailer.sendMail`，或保留 `mailer.sendPasswordResetMail` 与新模板两条路径（§3.1 硬约束 1）。
5. 把"邮件失败"改成影响状态码——除了 §1.3 允许的 `mail_disabled` 两类例外。

### 实施期的记录义务

实现与本文件的任何偏离，都按 R1/R2 的既有惯例记到新增的「实施过程发现的方案缺陷」章节（D3-11…D3-15 已由本节点占用），并在 `webserver/docs/desktop-integration.md` 升版时一并回写。评审节点在下一轮会先读那一段，再读正文。

---

## 实施过程发现的方案缺陷

实施节点记录（D3-16…D3-24）。全部按 R1/R2 的惯例就地说明，**没有一条是静默偏离**：凡是与 §4 改动清单不一致的地方，都写清了原因与最终落点。

| ID | 位置 | 方案原文 | 实施做法 | 理由 |
|---|---|---|---|---|
| **D3-16** | §4.2 新增文件 | 未列 `server/services/privacy.ts` | 新增一个 8 行模块，导出 `maskEmail` / `maskIp` / `shortId` | 脱敏出现在邮件 outbox、`/admin/sessions`、`/admin/mail`、`accountExport`、`profileService.myActivity`、桌面 IPC 六处。抄六遍必然漂移，而"两处脱敏规则不一致"是数据泄露级缺陷 |
| **D3-17** | §3.4 动作 2 | 重发验证"已验证 → 409" | 实现相同，但**另加**：无 SMTP 时先判 `503 mail_disabled` | 已验证地址 + 无 SMTP 时，`409` 与 `503` 都"正确"，但 `409` 会让人以为重发是可行的。先答"这个部署发不了信"更诚实 |
| **D3-18** | §3.5 换邮箱 | 未规定无 SMTP 时的行为 | `POST /me/email/change` 直接 `503 mail_disabled` | 双确认必须发两封信；发不出去就会留下一个**永远确认不了**的待确认状态，用户被困在旧地址直到令牌过期。校验顺序仍先跑完同址/占用/注销进行中，避免把 503 变成"地址是否存在"的探针 |
| **D3-19** | §5.3 `ActivityItem` | 桌面端契约只提 `ipMasked` | 服务端 `/me/activity` **同时**返回原始 `ip` 与 `ipMasked` | 网页活动页是账号主人自己的数据，遮掉反而损失信息；桌面端只取 `ipMasked`，`authController` 再脱敏一次（幂等）。用例断言渲染层返回值里不出现完整四段 IPv4 |
| **D3-20** | §3.10 `ServerMeta` | 只加 `emailVerificationRequired` | 另加 `baseUrl`（运行时账号服务地址） | P1-8 要求"优先取运行时地址"，但 `AuthStatus.server` 原本没有这个字段。把地址放进 `ServerMeta` 是最小改动，且它已在 `open-external` 白名单里 |
| **D3-21** | §3.9 `/admin/mail` | 未规定详情是否回 `html` | 详情只回 `subject` 与 `text` | 与 R11 一致：控制台不做 HTML 渲染器。`html` 从 `mail_outbox` 落库时就没存 |
| **D3-22** | §4.2 `admin/users/export` | 只写"CSV + BOM" | 另加 `X-Export-Truncated: 1` 响应头（P2-7 的取值） | 静默截断是最糟的失败模式：操作者以为拿到了全部 20000 行 |
| **D3-23** | §7.2 桌面用例 | 未覆盖"旧会话文件没有 `emailVerified`" | 新增 2 条用例 | 迁移 0005 之前写下的 `auth-session.json` 没有这个键，`undefined` 会让渲染层分支错乱。`currentUser()` 统一归一为布尔 |
| **D3-24** | §3.12 质量闸门 | e2e 8 条 + axe 5 页 | **未执行，登记为受控偏差** | 见下 |

| **D3-25** | §4.2 `usersRepo` | `markEmailVerified` / `anonymizeUser` 落在 `usersRepo` | 两者都没写进 repo：标记已验证在 `emailVerificationService.markVerifiedByAdmin`，匿名化在 `accountDeletionService.anonymise`，写入统一走 `usersRepo.update` | 匿名化必须与该事务里的会话吊销、申请状态迁移同时进行，放进 repo 会把事务边界劈成两半；且 `update()` 的列白名单已足够，多造两个只有一处调用者的包装函数只会让"哪些列可写"更难审计 |
| **D3-26** | §3.7 导出字段 | `invites: { created: string[], redeemed: string[] }` | 改为 `invites.created: [{ id, usedCount, createdAt, revokedAt }]`，删除 `redeemed` | 库里**没有**兑换记录表（`registration_invites` 只有 `used_count`），"我兑换过哪些邀请码"这件事无法回答；原样返回一个恒空的 `redeemed: []` 等于在导出文件里写"你没兑换过"，比不写更糟 |
| **D3-27** | §4.2 `validation/schemas.ts` | 新增 5 个 schema，其中 `emailVerifyResendSchema` / `adminEmailVerifySchema` 是空对象 | 删除这两个空 schema | 这两个端点**不接受任何入参**，空对象 schema 既不能拒绝多余字段（zod 默认 strip），也不能省掉一次读取请求体的行为改变；留着是死代码 |
| **D3-28** | §4.2 `RegisterForm.tsx` | 注册成功后提示"验证邮件已发送到 x***@y" | **未实现** | `register` 是注册即登录（§3.4-P0-4 的既有语义），成功后 `SessionGate` 立刻切到工作区，`RegisterForm` 随即卸载——写在表单里的提示永远不会被看到。改为在**常驻**界面呈现：标题栏 `AccountMenu` 的未验证黄条 + 账号中心资料页的横幅与重发按钮 |
| **D3-29** | §3.10 `AccountCentreDialog` | "4 页签容器，键盘可达（Esc 关闭、焦点陷阱复用 `ChangePasswordDialog` 模式）" | 补齐 `trapTabKey` 与关闭时焦点归还触发元素 | 上一节点只做了 Esc 与首焦点：`aria-modal="true"` 但没有 Tab 陷阱时，焦点会走到遮罩后的编辑器里；关闭后焦点掉到 `<body>`。两处都复用既有 `components/ui/focusTrap`，并补一条用例断言"关闭后焦点回到触发器" |
| **D3-30** | §7.2 桌面用例 | 未覆盖"心跳回传 `emailVerified`"与"刷新腿上的 `account_deleted`" | 补 3 条用例（心跳刷新快照、`maskIp` 不可解析取值、刷新被拒的已注销账号） | 服务端 `/auth/heartbeat` 本轮才开始回传 `emailVerified` / `displayName`；而"access token 已过期后被注销"只走刷新腿，原因码必须在那条路径上读取，否则桌面显示"会话过期" |
| **D3-31** | §3.9 `/admin/sessions`、`/admin/users/export` | 未规定 UI 层的平台筛选与逐行吊销 | 补齐：平台筛选输入框、逐行吊销按钮、CSV 导出改为 fetch + blob（读 `X-Export-Truncated`）、导出按钮改由 `users.read` 决定可见性 | 端点侧本来就有（`platform` 过滤、`DELETE /admin/sessions/{id}`、截断响应头、`users.read` 权限），但界面上一个都到不了：`support` 拿得到 200 却看不到按钮，静默截断无人知晓 |

### D3-24：Playwright / axe 未执行（受控偏差）

`npm i -D @playwright/test` 与 `npx playwright install chromium` 需要下载约 150 MB 的浏览器二进制，本实施环境不具备该网络条件（与 §3.12 注、R9 的预设一致）。按 §3.12 的规则：

- **不把偏差当"已完成"**：`npm run test:e2e` 与 `npm run test:a11y` 没有加入 `package.json`（加一个永远红的脚本比没有更糟）；
- **硬门禁不降级**：`scripts/smoke.mjs` 由 62 条扩到 **109** 条（要求 ≥96；评审节点又补了"令牌页 Referrer-Policy"与"未知 outbox 筛选 → 422"两条），覆盖了 e2e 里除"真实浏览器渲染"以外的全部流程（注册→outbox 验证信→验证→改资料→换邮箱→导出→注销全流程→管理员踢下线→指标/CSV）；
- **无障碍**：新增页面全部复用既有 `console-shell` + `ui/*` 组件与主题变量，标题层级、`tablist`/`tabpanel` 关系、`aria-label`、`role="img"` 与 `title` 都在源码里显式写出（`AccountCentreDialog` 与 `TrendChart`），但没有 axe 自动断言——这是本轮的已知缺口，下一轮若环境允许应首先补上。

### 其它需要知道的实施事实

1. **`scripts/smoke.mjs` 必须在"新进程 + 一次性库"上跑**（登录 IP 限流 20/5 min 仍在）。本轮实测：`DATABASE_PATH=./data/smoke-g5.db` 起进程 → `107 passed, 0 failed`。
2. **`npm run dev` 要求 `NODE_ENV=development`**：父进程带 `NODE_ENV=production` 时 Next 会以生产模式编译而读不到 `.next/required-server-files.json`，表现为全站 500。这不是代码缺陷，但会浪费半天，故记在此处。
3. **`cmd.exe` 的 `set X=Y & next` 会带上尾随空格**，`LOG_LEVEL=warn ` 会让 `config.ts` 的枚举校验直接失败——起服务请用脚本或 `node -e` 传 env。
4. **基线数字（AC-46，命令产出）**：`npm test` = **285 tests / 28 files**；`smoke.mjs` = **109 checks**；渲染侧 `src/components/auth src/contexts` = **42 tests / 6 files**；`AuthReason` = **25 值**（原 21 + 新增 4）；桌面 `test:auth` = **134 checks / 7 suites**；`auth-smoke` = **20 条**。评审节点新增的 5 条 webserver 用例覆盖：邀请码脱敏（正文与链接）、邀请邮件不泄漏完整地址、换邮箱保留确认会话、取消换邮箱不动验证令牌、注销确认链接不可重放。

---

## 代码评审（第 3 轮，节点 #3）

评审对象：节点 #2 的实现（`git status` 全部改动），对照本文件 v2 与「实施过程发现的方案缺陷」D3-16…D3-24。三维度：**覆盖性**（§4 改动清单是否逐条落地）、**回归风险**（是否动了已交付的语义）、**命名/风格/注释**（是否与本仓库既有写法一致）。全部问题**直接改在源码里**，无 TODO。下表按"缺陷 → 落点"记录；能自动化的都补了用例。

### 阻断级（会让功能"上线即空转"或造成凭据泄漏）

| # | 缺陷 | 落点 |
|---|---|---|
| R3-01 | **邀请码不经脱敏就进 `mail_outbox.body_text`**：`redactTokens` 只匹配 `token=`，而邀请模板把一次性邀请码**单独占一行**（`一次性邀请码：ECL-…` / `Your one-time invite code: ECL-…`）并嵌进 `?invite=` 链接。行内所有管理员可读，`db:backup` 也会带走 | `mailService.redactTokens` 增 `invite=` 与邀请码整行两条规则；迁移 0005 的注释一并订正（脱敏发生在 `body_text`，`payload` 只存 `{template,toMasked,fields}`）；`tests/unit/mailTemplates.test.ts` 增 2 例（12 模板 × 2 语言全量断言） |
| R3-02 | **已注销账号的专用文案出现在登录屏**：`REASON_COPY_KEYS` 把 `account-deleted` 映射成横幅，`SessionGate` 在 `unauthenticated` 状态下把它交给 `LoginScreen`——这正是 P1-5 禁止的"该地址存在过"探针 | 从登录横幅表里删掉该项；新增 `src/components/auth/AccountDeletedScreen.tsx`，`SessionGate` 只在 `status.reason === 'account-deleted'` 时渲染它（只有持过会话的人能看到）；补 `AccountDeletedScreen.test.tsx`（2 例）与 `LoginScreen.test.tsx` 的"该 reason 不出横幅"用例 |
| R3-03 | **`?reason=` 可伪造任意理由**：`readUrlReason()` 接受 `AUTH_REASONS` 里的任何一个值，包括 `account-deleted`，未登录也能触发 R3-02 的文案 | 改成白名单（`maintenance` / `client-outdated` / `server-not-configured` / `bridge-unavailable`），并删掉已过期且无人再用的 `AUTH_REASONS` 常量 |
| R3-04 | **刷新腿丢掉注销原因**：access token 已过期的已注销账号只走 `/auth/refresh`，而 `handleHeartbeatError` 只看错误码，`details.reason` 从未读取 → 用户看到"会话过期" | 刷新被拒与轮换后重试两处都先 `revokeReasonFor(refreshError)` 再定性；`authAccountCentre.test.js` 增"刷新被拒的已注销账号报 `account-deleted`"用例 |
| R3-05 | **注销确认链接可重放**：`confirm()` 不消费令牌、`markScheduled` 也接受已 `scheduled` 的行，于是每次点击都重算 `now + grace` 并重发一封"已排期"邮件——链接在收件人手里等于"永久推迟删除"按钮 | `deletionRequestsRepo.markScheduled` 在同一条 UPDATE 里把 `token_hash` 置 NULL；`confirm()` 命中已排期行时直接返回原截止时间；用例"重放链接不再推迟删除" |
| R3-06 | **换邮箱确认把确认者自己踢下线**：`revokeAllForUser` 没有排除当前会话，`currentSessionId` 参数声明了却从未传下去 | `/auth/email/verify` 用 `optionalSession()` 取当前会话（不强制）并透传；`applyEmailChange` 用 `exceptSessionId`；用例"保留确认会话、只踢其他设备" |
| R3-07 | **指标三套时间基准**：`startOfDay()` 取本地零点、SQL 按 `created_at/86400000`（UTC）分桶、标签用 `toISOString()`（UTC）。UTC+8 主机上每个标签早一天、当天柱状图大半天为 0 | `startOfDay()` 改为纯 UTC 日对齐；`metrics.test.ts` 增"标签等于 UTC 日"的与时区无关断言 |

### 功能性缺口（端点存在但界面/链路到不了）

| # | 缺陷 | 落点 |
|---|---|---|
| R3-08 | **邀请邮件只能靠 curl 发**：创建对话框不传 `email`，`inviteService` 还把整个收件地址当问候语写进正文（违反脱敏规则），`note` 被 schema 接收后静默丢弃 | 对话框新增收件邮箱字段；`displayName` 改 `maskEmail(input.email)`；`note` 写进 `invite.create` 审计 metadata；`admin.invites.email` / `neverExpires` 双语文案（顺手修掉一处写死的中文 hint） |
| R3-09 | **`support` 拿得到 CSV 却看不见按钮**：导出按钮被 `canWrite`（`users.write`）门住，而端点只要 `users.read`；按钮是 `<a download>`，读不到 `X-Export-Truncated` | 导出改为 fetch + blob，按响应头提示"超出 20000 行已截断"；可见性改由页面权限决定，只有"新建用户"仍受 `canWrite` 约束 |
| R3-10 | **会话页缺两个已写好的能力**：`platform` 筛选只有 URL、逐行吊销（`DELETE /admin/sessions/{id}`）无入口；`admin.sessions.allPlatforms` 是死键 | 补平台输入框与逐行"吊销"按钮 |
| R3-11 | **趋势图对读屏永远说"近 14 天"**：`aria-label` 写死 `range14` | 由 `points.length` 选 `range14`/`range30`/新键 `rangeDays` |
| R3-12 | **用户详情看不到验证状态**：`admin.users.emailVerified` / `verifiedAt` 两个键无处使用 | 资料页签新增"邮箱已验证"与"验证时间"两行；`toAdminUserDto` 增 `emailVerifiedAt` |
| R3-13 | **导出面板与冷却期自相矛盾**：冷却中文案在，但 `<a download>` 照旧可点，点下去把整页导航到裸 JSON 429 | 改为按钮 + fetch，冷却期内禁用，失败留在页内显示 `errorMessage` |
| R3-14 | **注销确认页写死 72 小时**：`graceNotice` 传 `{ hours: 72 }`，改过 `account.deletionGraceHours` 的部署会对用户撒谎 | 用服务端返回的 `scheduledFor` 反算并展示 |
| R3-15 | **验证面板有一个永远不可达的状态**：`already` 依赖 `email_already_verified`，而 `POST /auth/email/verify` 对所有失败统一 `400 token_invalid`（防探针）；上游 schema 里两个"空对象"也是死代码 | 删掉该分支与死 schema（D3-27 记账），注释写明为什么不能区分 |

### 一致性、隐私与可观测性

| # | 缺陷 | 落点 |
|---|---|---|
| R3-16 | **审计行里写明文地址**：`applyEmailChange` 的 `actorLabel` 是完整新地址，而同一行的 metadata 刻意脱敏 | 改 `maskEmail(...)` |
| R3-17 | **`maskIp` 把不可解析值原样返回**：`203.0.113.42:51234` 含冒号，先走 IPv6 分支后返回 `203.0.113.42:…`（完整 IPv4）；`webserver` 与 `desktop/main/authController.js` 两份实现同病 | 两处都改为"先按点分四段判定"，端口/括号先剥，不可解析 → `…`；保留幂等（服务端已脱敏的 `203.0.x.x` 原样返回），并补桌面用例 |
| R3-18 | **心跳不回传用户快照**：`emailVerified` / `displayName` 只在登录时写一次，会话中期验证邮箱或改昵称要重启才生效；`authController.statusSignature()` 也不含这两个字段，即使更新了也不推 `auth:changed` | `/auth/heartbeat` 回传两字段；`applyHeartbeatBody` 归一写回；`statusSignature` 纳入；桌面用例断言心跳后快照更新 |
| R3-19 | **`sendRaw` 的"永不抛出"是假的**：`getTransporter()` 在 try 之外，配置畸形时 `createTransport` 抛出，两个 await 调用者（管理员邀请、管理员代发重置）变 500 并留下 `captured` 死行 | 移入 try |
| R3-20 | **惰性清扫只做注销**：`sweepIfDue` 没有令牌/outbox 保留，未接 cron 的部署（Windows）永远不清理 | 增 `pruneRetained()`（令牌 7 天、终态邮件取 `audit.retentionDays`、`captured` 7 天），独立 try/catch，失败不拖累注销扫描 |
| R3-21 | **查询参数从不校验**：`/admin/mail`、`/admin/sessions`、`/admin/users/export` 手读 `searchParams`，`?status=sentt` 静默返回全表、`template` 无长度上限 | 新增 `http/route.readSearch()`，三个端点改用已声明的 schema；`?status=sentt → 422` 进 smoke |
| R3-22 | **令牌页没有 `no-referrer`**：全局 `strict-origin-when-cross-origin` 在同源导航仍会发送完整 URL（带 `?token=`），页面注释却说中间件已设 | 中间件对 `/verify-email`、`/confirm-deletion` 下发 `Referrer-Policy: no-referrer`；`deploy/nginx.conf.example` 增同名 location 覆盖；smoke 增断言 |
| R3-23 | **`GET /admin/settings` 的文档与实现不符**：返回 `{settings, available, mail}`，文档写 `{settings, available}`；设置白名单缺 8 个新键；`/meta` 示例缺 `emailVerificationRequired` | `docs/api.md` 三处订正；顺带把管理端总表补上 sessions/mail/export/email-verify/deletion 七行 |
| R3-24 | **桌面通道数写错两处**：`desktop-integration.md` 与根 `CLAUDE.md` 都写"10 个 `ipcMain.handle`"（实为 14），`desktop-integration.md` 还引用了不存在的 `auth:local-verify`（实为 `auth:login-local`）；`authBridge.js` 注释写"五个通道"（实为 6，含 `auth:me`） | 三处订正 |
| R3-25 | **`AccountCentreDialog` 有两个 lint 缺陷**：`TAB_ORDER` 无人使用（warning），`aria-modal` 没有 Tab 陷阱、关闭不还焦点 | 删冗余常量；复用 `components/ui/focusTrap` 并在关闭时归还焦点；`SessionContext` 的 `useMemo` 依赖加"这是缓存键"的 `eslint-disable-next-line` 说明 |
| R3-26 | **两条断言是空转的**："两个账号抢同一新址"预先注册了地址（只走前置检查，没碰唯一索引）；"重申请先取消再插入"先手工取消再调用（顺序从未被执行，`allowExistingPending` 没有调用者） | 前者保留为"前置检查"语义并新增真正的并发确认用例；后者改为走 `allowExistingPending`，让 `idx_deletion_live` 真正参与 |

### 门禁（评审节点在本机实测，命令产出）

| 门禁 | 结果 |
|---|---|
| `webserver: npm run type-check` | 0 error |
| `webserver: npm run lint` | 0 warning（`--max-warnings 0`） |
| `webserver: npm test` | **285 tests / 28 files** 全绿 |
| `webserver: npm run build` | 成功（`✓ Compiled successfully`） |
| `webserver: node scripts/smoke.mjs`（新进程 + 一次性库） | **109 passed, 0 failed** |
| `root: npx tsc --noEmit` | 0 error |
| `root: npm run build` | 成功 |
| `root: npm run lint`（仅本轮改动文件） | 0 warning / 0 error（仓库另有 10 条 D-17 既有 error，与本轮文件无关） |
| `desktop: node scripts/test-auth.js` | **7 suites / 134 checks** PASS |
| `desktop: node scripts/auth-smoke.js` | 20/20 PASS |
| 渲染侧 `npx vitest run src/components/auth src/contexts` | **42 tests / 6 files** 全绿 |
