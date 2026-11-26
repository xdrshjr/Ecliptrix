# Web 子项目「用户与权限系统」完善方案

| 字段 | 值 |
|---|---|
| 特性 slug | `webserver-user-permission-system` |
| 文档路径 | `docs/plans/webserver-user-permission-system/spec.md` |
| 文档版本 | **v4**（v2 评审 → v3 实施核验 → **v4 二次评审**：逐条复核 v3 的核验结论，修订 2 条不成立的判断，补入 3 条 v3 漏掉的 P0，见文末 §23–§26 与「评审结论（v4）」） |
| v3 核验基线 | `webserver/` 工作树 **已含 v2 的大部分后端实现（未提交）**；v3 把「设计意图」与「磁盘事实」分开记账 |
| 目标子项目 | `webserver/`（桌面端云端账号服务，独立可部署）+ 与之联动的 `desktop/` 登录闸门契约 |
| 上游基线 | `docs/plans/webserver-user-management/spec.md`（账号服务本体，已完成）、`docs/plans/account-platform-finalization/spec.md`（邮件闭环与自助生命周期，已完成）、`docs/plans/desktop-account-login-gate/spec.md`（桌面登录闸门，已完成） |
| 本轮定位 | **在已交付的账号服务上做"缺口补齐 + 权限收敛"**，不重建既有体系 |
| 本节点产物 | 仅本文件。不写实现代码、不修改 `docs/plans/webserver-user-permission-system/` 之外的任何文件、不执行 `git commit` |

---

## 评审记录（v3 → v4）

> **本轮性质**：二次评审（对 v3 的**核验结论本身**做核验）。v3 已把「设计意图」与「磁盘事实」分开记账，方向正确；本轮复核其记账的**准确性**，并补齐它仍未覆盖的接管路径。
> **复现命令**：`cd webserver && npx vitest run`（2026-11-26 实测：**13 failed files / 68 failed / 268 passed / 336 total，退出码 1**）。与 v3 §16 自述**完全一致**，予以确认。
> **处置**：P0 / P1 已直接修入正文；P2 仅记录。

| ID | 维度 | 严重度 | 问题（含源码证据） | 处置 |
|---|---|---|---|---|
| **R-V4-01** | 完整性 | **P0** | **v3 的「削弱性操作全入口表」仍是六条 + 批量，漏掉了最直接的一条：改邮箱。** `userService.updateUser` 的 `input.email !== undefined` 分支（`userService.ts:307-315`）只做 `emailExists` 查重，**没有任何 `assertRankAbove`**。后果：`admin`(80) 可以把同级 `admin`(80) 甚至 `owner`(100) 的邮箱改成自己的，再用"忘记密码"把重置信收到自己手里——这是**无需口令重置 API 的完整账号接管链**，恰好绕开 v3 刚给 `resetUserPassword` 装上的闸。同理 `POST /admin/users/{id}/email-verify`（`email-verify/route.ts:25`）只查 `users.write`，无等级闸。 | 已修：§3.4.2 入口表新增 #8「改邮箱」、#9「代验证邮箱」；§8.2 新增 AC-16e / AC-16f |
| **R-V4-02** | 完整性 | **P0** | **会话吊销完全没有等级闸，且 `support`(40) 就能踢掉 `owner`(100)。** `POST /admin/sessions/revoke`（`sessions/revoke/route.ts:21`）、`DELETE /admin/sessions/{id}`（`sessions/[id]/route.ts:20`）、`GET /admin/users/{id}/sessions`（`users/[id]/sessions/route.ts:17`）三个入口只用 `sessions.revoke` / 不分等级的 `requireAdminRead`，`adminSessionService.revokeMany`（`adminSessionService.ts:110-120`）只按 `id` 更新 `sessions`，**从不读目标用户的角色**。`SYSTEM_ROLE_PERMISSIONS.support` 含 `sessions.revoke`（`permissions.ts:131`）。后果：一个客服可以强制下线根管理员与全部管理员，属于对最高权限账号的直接打击面；这不是"读操作"，必须进 INV-1 的入口表。 | 已修：§3.4.2 入口表新增 #10「吊销会话」；§8.2 新增 AC-16g；§5.9 新增 403 契约 |
| **R-V4-03** | 可行性 | **P0** | **登录升级验证码在直连部署下退化为"全站共用一个失败计数桶"，可被用来做登录 DoS。** `captchaService.loginRequiresCaptcha`（`captchaService.ts:268-278`）的第二维度直接 `loginAttemptsRepo.countFailuresByIpSince(getDb(), ip, since)`，**没有走同文件已经写好的 `rateKeyFor(ip, userAgent)`**（该函数第 76-79 行专门为 `FALLBACK_IP` 做指纹退化）。而 `config.ts:222` 的 `TRUST_PROXY` 默认 `true` + 直连无转发头 ⇒ `ip` 恒为 `0.0.0.0`。后果：攻击者只需在 15 分钟内制造 3 次失败，**全站所有用户**登录都会收到 `captcha_required`；再叠加签发桶（`captchaIssue` 60/h）被同 IP 打满，用户拿不到图 ⇒ **全站无法登录**。v3 的 R-02 只把共享桶问题应用到了**签发限流**，漏了**升级判定**这第二个作用面，而后者直接决定能不能登录。 | 已修：§3.2.4 明确升级判定的 IP 维度**必须**复用 `rateKeyFor`；§8.2 新增 AC-09c；§24 记录 |
| **R-V4-04** | 一致性 | **P1** | **需求追溯表指向 5 个不存在的验收项。** §2.3 把「支持用户登录和注册」映射到 `AC-01、AC-20`、把「管理员有对应管理界面」映射到 `AC-21…AC-24`，但 §8.2 的表格里**没有 AC-20 / AC-21 / AC-22 / AC-23 / AC-24 任何一条**（实测：这五个编号在全文中只出现在第 111/113/118 行的追溯表内，无定义）。一条映射到空处的追溯等于没有追溯——这正是"管理员界面"这一整块需求失去验收依据的原因。 | 已修：§8.2 补齐 AC-20…AC-24 五条定义（管理界面与授权台账） |
| **R-V4-05** | 一致性 | **P1** | **v3 的 R-V3-10 判断不成立。** v3 称 `captchaRepo.windowCounts` 的「签发与消费成功计数口径尚未定义」，要求接线时再明确。磁盘事实：`captchaRepo.ts:98-118` 已经把三个口径**全部写进同一条 SQL**（`issued` = `created_at >= since`；`solved` = `consumed_at IS NOT NULL`；`failed` = `consumed_at IS NULL AND attempts > 0`），并有注释解释为何不需要状态列。这不是"待定义"，而是**已实现且自洽**。把它留作待办会让实施节点去改一段本来正确的代码。 | 已修：§25 勘误表条目；R-V3-10 降级为"已核实无缺口" |
| **R-V4-06** | 一致性 | **P1** | **`.env.example` 与代码默认值相反，会让需求 A-2 在真实部署上失效。** `.env.example:34` 是 `ROOT_ADMIN_USERNAME=owner`，`config.ts:81` 默认是 `xdrshjr`。部署者按示例复制 `.env` 后，`ROOT_ADMIN_USERNAME` **有名有值**，默认值不会生效，根管理员用户名仍是 `owner`——而"根管理员是 `xdrshjr`"是用户的硬需求。v3 把它列为 P2「记录」，但它直接否掉一条验收项，应为 P1。 | 已修（升级严重度）：§8.2 AC-10 增加"`.env.example` 亦为 `xdrshjr`"的前置断言；§19 R12 明确要求同批修改 |
| **R-V4-07** | 完整性 | **P1** | **`authorityService` 的 `actorUserId === null` 语义未被任何测试钉住，而它是唯一的"跳过等级闸"通道。** `assertRankAbove` / `assertCanGrantPermissions` / `assertCanAllocateRole`（`authorityService.ts:104-120,168-176,214-216`）在 `null` 时放行并写 `authz.system_actor`。这是刻意设计（种子 / CLI / 自动解锁），但一旦某个 HTTP 路径因 bug 传进 `null`，等级闸会**静默失效且不留拒绝记录**——只有一条"系统行为"审计。现有 AC 中没有任何一条断言"HTTP 路径产生 null actor 时仍然被拒或至少被发现"。 | 已修：§8.2 新增 AC-19b（`authz.system_actor` 行数在纯 HTTP 测试中必须为 0） |
| **R-V4-08** | 规模 | **P2** | `restoreUser(targetId, actor)` 与 `deleteUser(actorId, targetId, …)` 的 actor 传参形态不一致（前者从 `actor.actorUserId` 取，后者显式首参），`bulk` 的 `restore` 分支因此写成 `restoreUser(id, actor)` 而 `delete` 分支写 `deleteUser(actorId, id, …)`。功能正确（已核实 `userService.ts:604-608`），但两个相邻分支的调用形态不同，是下次改错的高发点。 | 记录 |
| **R-V4-09** | 安全 | **P2** | `authorityService.recordEscalationDenied`（`authorityService.ts:74-84`）把 `actorLabel / ip / requestId` 硬编码为空串，而它在服务层是有 `AuditContext` 可用的。后果：`authz.escalation_denied` 审计行无法关联到具体请求，`securityPostureService` 的越权 Top 5 只能统计 `authz.denied`（guard 层，有完整上下文）。不影响判定，影响取证。 | 记录 |
| **R-V4-10** | 规模 | **P2** | §15.1 声称「INV-1（6/7 个入口）✅」，但同一节 §15.3 与 §17 R-V3-03 又说第 4 入口未装闸。同一份文档内的两处结论互相矛盾（正确读法是"7 个入口里 6 个已装、1 个未装"）。保留 v3 原文，以本轮 §24 的十条完整表为准。 | 记录（§24 已给全表） |

---

## 评审记录（v1 → v2）

> **评审基线**：`webserver/` 当前工作树只读核验，行号以本次评审时的磁盘状态为准；不采信设计稿自述。
> **维度**：可行性（Feasibility）／完整性（Completeness）／一致性（Consistency）／规模适当性（Right-sizing）。
> **处置**：**P0 / P1 已在正文直接修入**（条目末注明「已修」及落点），**P2 仅记录**，不阻塞实施。

| ID | 维度 | 严重度 | 问题（含源码证据） | 处置 |
|---|---|---|---|---|
| **R-01** | 完整性 | **P0** | INV-1（等级闸）只写了 `PATCH /admin/users/{id}`，但削弱性操作实际散落在六个入口：`admin/users/bulk/route.ts`（suspend / delete / setRole）、`admin/users/[id]/password-reset/route.ts`、`admin/users/[id]/deletion/route.ts`、`admin/users/[id]/restore/route.ts`、`admin/users/[id]/unlock/route.ts`。最重的是口令重置：`userService.resetUserPassword`（第 437–444 行）只有 `assertNotOwner`，**一个 `admin` 可以重置另一个 `admin` 的口令并直接接管其账号**——这恰好击穿 INV-1 想守住的东西。批量 suspend 同理，可绕过等级闸封禁同级管理员。 | 已修：§3.4.2 增「削弱性操作全入口表」，§4.2 补齐五个路由文件，§8.2 增 AC-16b / AC-16c |
| **R-02** | 可行性 | **P0** | e2e 后门判定写成 `context.ip ∈ 127.0.0.1 / ::1`，但 `requestContext.clientIpFrom`（第 39–52 行）**只在** `TRUST_PROXY=true` 且存在 `X-Forwarded-For` / `X-Real-IP` 时才返回真实地址，否则一律返回 `FALLBACK_IP = '0.0.0.0'`；而 `config.ts:222` 的 `TRUST_PROXY` 默认值是 `true`。`scripts/smoke.mjs` 直连 `127.0.0.1:8787` 且不发转发头 ⇒ 拿到的 `context.ip` 是 `0.0.0.0`，后门**永不触发**，AC-35 的 smoke 无法完成注册。同一根因还让 `captchaIssue 60/h/IP` 退化成**全站共享一个桶**（60 次/小时之于整站 = 注册 DoS）。 | 已修：§3.2.5 改为「回环判定含 `0.0.0.0`，且 smoke 显式发送 `X-Forwarded-For: 127.0.0.1`」，§3.2.2 补共享桶风险与应对 |
| **R-03** | 完整性 | **P0** | §3.2.2 要求「验证码通过但注册因邮箱重复失败时，挑战仍然作废」，但 §3.7 的注册时序把「邮箱/用户名唯一」放在事务**之前**、把「消费验证码」放在事务**之内**。照此实现，邮箱已存在时挑战根本不会被消费——攻击者可拿同一挑战反复探测邮箱是否存在。两处自相矛盾。 | 已修：§3.7 改为「先原子消费验证码（`changes===1` 才算通过）→ 口令策略 → 唯一性 → 建号」，并同步 §3.2.2 |
| **R-04** | 可行性 | **P0** | 若把 `captchaId` / `captchaAnswer` 写成 `registerSchema` 的**必填**字段，缺字段时 `readJson`（`http/route.ts:112`）的 `ZodError` 会被映射成 `validation_failed`（422），与 AC-01 要求的 `400 captcha_required` 直接冲突。 | 已修：§4.2 明确「schema 内两者一律 `.optional()`，由服务层抛 `captcha_required`」 |
| **R-05** | 可行性 | **P1** | AC-12 / AC-14 / AC-15 用「`admin` A 授予 `admin`」作夹具，但 `SYSTEM_ROLE_PERMISSIONS.admin`（`permissions.ts`）**不含 `roles.write`**，而 `users/[id]/route.ts` 的 PATCH 在带 `roleId` 时额外要求 `roles.write`。因此标准 `admin` 根本到不了 `authorityService`，这三条 AC 当前**不可达**（与本仓库历史上「AC-G2 不可达」同类缺陷）。 | 已修：§8.2 改为「自定义角色夹具 `ops`（`users.write` + `roles.write`，rank 80）」，并新增 AC-12b 记录今天**真正可达**的提权路径 |
| **R-06** | 可行性 | **P1** | 三条不变式都必须读调用者的权限与等级，但 `roleService.replacePermissions(id, permissions, actor)`、`userService.updateUser(…, actor)`、`userService.createUser(…, actor)`、`inviteService.createInvite(…, actor)` 的 `actor` 类型都是 `AuditContext`（`auditService.ts:14` 只有 `actorUserId / actorLabel / ip / requestId`，**没有 permissions**）。照 §3.4 写 `assertCanAssignRole(actor, targetRole)` 无法实现子集闸。 | 已修：新增 §3.4.4 明确规定 `actorUserId` 为唯一入参、由 service 依 id 解析角色与权限，并说明查询成本 |
| **R-07** | 一致性 | **P1** | §3.2.4 把验证码排在「维护模式 → 版本闸」之前，但 `authService.login`（第 335–344 行）的固定顺序是 `assertNotInMaintenance → assertClientSupported → verifyCredentials`。排在前面会让维护期用户先做一道题再被告知「站点维护中」，还白白烧掉一次挑战（且 `captcha_expired` 与「维护中」谁先返回会随网络抖动）。 | 已修：§3.2.4 与 §3.7 统一为「限流 → CSRF → 维护 → 版本 → 验证码 → 口令」 |
| **R-08** | 完整性 | **P1** | 登录升级判定要用「同一 IP 近 15 分钟失败数」，但 `loginAttemptsRepo` 只有 `countFailuresSince(db, identifierNormalized, sinceMs)`，**没有按 IP 计数的函数**（索引 `idx_attempts_ip` 已存在）。§4.1 / §4.2 均未列这一项，实现时会直接卡住。 | 已修：§4.2 增加 `loginAttemptsRepo.countFailuresByIpSince` |
| **R-09** | 完整性 | **P1** | `/admin/security` 用 `security.read` 守卫，但 `(console)/admin/layout.tsx` 对**所有** `/admin/*` 一律要求 `users.read`；只持有 `security.read` 的角色会被渲染成 403 页而非新页面。 | 已修：§3.6 增约束「`security.read` 必须与 `users.read` 同时授予；`SYSTEM_ROLE_PERMISSIONS` 中二者同行发放」 |
| **R-10** | 完整性 | **P1** | 0007 的 `INSERT OR IGNORE … WHERE key IN ('admin','support')` 在**全新库**上匹配不到任何行——`boot.ts` 的顺序是 migrate → seed，迁移执行时 `roles` 还是空表。新库的 `security.read` 只能来自 `SYSTEM_ROLE_PERMISSIONS`，而文档只写了「`permissions.ts` 新增 `security` 权限组」，没说要同时进两张系统角色权限表。漏掉即「升级库能看、新库 403」。 | 已修：§4.2 与 §6.1 双双写明这条**双路径**（迁移给存量、seed 给新库） |
| **R-11** | 一致性 | **P1** | R-1 的上线顺序（先发桌面包 → 再提 `client.minVersion` → 最后启用验证码强制）与 §10 的实施顺序**相反**：§10 第 5–6 步就接入注册/登录验证码，桌面端却排在第 12 步。照 §10 执行等于先把老桌面版打死。 | 已修：§10 把桌面端通道提前为第 7 步，并注明灰度只能靠版本回退 |
| **R-12** | 一致性 | **P2** | §1 与 G-3 把第二条提权通道归到 `userService.ts:264`（`updateUser` 允许 admin→admin）。代码事实：`updateUser` 的 `roleId` 分支在**路由层**就要求 `roles.write`，标准 `admin` 没有该权限；今天真正可达的是 `createUser`（`POST /admin/users` 只查 `users.write`，仅拦 `owner`，`createUserSchema` 却接受 `roleKey` / `roleId`）与 `createInvite`（只拦 `owner`）。结论不变，证据需更正。 | 已修（表述）：§2.2 G-3 |
| **R-13** | 规模 | **P2** | `maintenanceService.pruneRetained` 返回 `{tokensPruned, mailsPruned}` 并被 `SweepIfDueResult` 展开。追加验证码清理时须同步扩返回类型与日志字段，否则统计数字会撒谎。 | 记录 |
| **R-14** | 安全 | **P2** | `captcha-field.tsx` 的 `dangerouslySetInnerHTML` 白名单只写了「无 `<script` / `on*=`」，未排除 `<foreignObject>`、`<use href="http…">` 与外链 `href`。产物虽来自服务端，仍建议收紧到「仅允许 `path`/`line`/`circle`/`title`/`g` 与 `fill`/`stroke`/`d`/`transform` 属性」。 | 记录 |
| **R-15** | 无障碍 | **P2** | 纯图形验证码无音频或等价替代挑战，属 WCAG 1.1.1 缺口。R-2 已把「已知限制」写明，建议补一个可见出口（「看不清？联系管理员获取邀请码」），而不是只写在文档里。 | 记录 |
| **R-16** | 规模 | **P2** | `security.read` 同时授予 `support`（rank 40）会让客服看到根管理员账号状态与越权统计。email 已脱敏，风险有限，但建议收窄到 `admin`（`owner` 由 `*` 覆盖）。 | 记录 |

---

## 0. 需求解读与假设（先读，评审节点必须逐条确认）

用户原话的关键四条，本方案的解释如下。凡是解释可能有两种读法的地方，这里一次讲清楚，避免下游实现节点自行猜测：

| # | 原话 | 本方案的解释 | 理由 |
|---|---|---|---|
| A-1 | 「注册需要输入验证码」 | 指**人机校验验证码（CAPTCHA）**：注册时须完成一次服务端签发的图形挑战。**不是**邮箱验证——邮箱验证（`mail.verificationRequired`）已实现且是可选策略，两者独立、可叠加。 | 中文语境下"注册需要输入验证码"在"用户与权限系统"的需求清单里，指向的是防机器批量注册的图形码；邮箱验证另有说法（"邮箱验证/激活邮件"）。 |
| A-2 | 「根管理员：xdrshjr/13519126390」 | 采用「用户名 / 初始口令」的读法：根管理员**用户名 `xdrshjr`**、**初始口令 `13519126390`**。`ROOT_ADMIN_EMAIL` 仍是必填的独立字段（配置层 `z.string().email()` 强制），不由用户名替代。 | 斜杠分隔账号与口令是中文产品文档的通行写法；若读成"用户名/手机号"则还隐含短信验证码基础设施，而本需求未提短信，且现有代码没有任何手机号字段（已核查 `webserver/src/server/db/migrations/0001_init.sql` 无 phone 列）。手机号仅作为 `username` 形状的合法值而被自然支持（`usernameSchema` 允许纯数字，长度 3–32）。 |
| A-3 | 「其余新注册的管理员，由这个管理员分配」 | 管理员（`admin` 角色）的**授予与撤销只能由根管理员（`owner`）执行**；普通管理员不得再任命管理员，也不得授予任何"自己所不具备的"权限。 | 这是需求里唯一一条明确的所有权约束，必须在服务端成立，而不是只在界面上隐藏按钮。 |
| A-4 | 「游客可以查看网页和相关内容，但不能下载软件」 | 游客 = 无会话访客。营销页、法务页、`/download` **页面本身**（含版本号、大小、SHA-256、历史版本列表）对游客完全可见；**安装包字节**（`/api/v1/downloads/*`）必须登录后才可取。 | 现有实现已基本如此，本轮把这条从"恰好如此"升级为**显式契约 + 回归测试**，防止后续改动无意中开门或关门。 |
| A-5 | 「还有我没考虑到的相关功能，你来完善即可」 | 见 §2 差距矩阵中的 G-3、G-5、G-6、G-7：权限授予上限（不可授出自己没有的权限）、角色等级闸、根管理员初始口令轮换检测、授权台账（谁把谁提成了管理员）。 | 这四条都是"权限系统"本体的必答题，缺了任何一条，`admin` 都能自己把自己变成事实上的 owner。 |

**明确非目标（本轮不做，防止范围蔓延）**：短信验证码与手机号实名、TOTP 双因素、OAuth/SSO 登录、多副本部署、PostgreSQL 迁移。理由见 §12。

---

## 1. 概述（Overview）

`webserver/` 子项目目前已经是一个**可运营的账号服务**：注册、登录、刷新、登出、登录限流与指数退避锁定、不透明令牌（无 JWT）、scrypt 口令、四个系统角色 + 权限矩阵、管理控制台（用户/角色/邀请码/会话/审计/邮件/发布/设置/指标）、账号中心（资料/安全/活动/会话/危险区）、邮件 outbox 管线、邮箱验证与邮件改绑、自助注销与宽限期。**本轮不是在空地上盖房子。**

但是，把用户这次的需求逐条对照现有源码，会看到三处"看起来有、实际缺"的东西：

第一，**注册完全没有人机校验**。`webserver/src/server/validation/schemas.ts` 的 `registerSchema` 只有邮箱、口令、用户名、邀请码与客户端字段；`authService.register()` 的防线是"邀请码可选 + 每 IP 每小时 10 次限流"。也就是说，只要 `INVITE_REQUIRED=false`（默认值），任何脚本都能以 10/小时/IP 的速率批量注册——对一个要"分配管理员"的账号体系，这等于把攻击面直接开到最上层。

第二，**权限体系有两条真实的提权通道**。第一条在 `webserver/src/server/services/roleService.ts#replacePermissions`：它只把 `'*'` 过滤掉，**不校验调用者是否持有被授予的权限**——所以一个只有 `roles.write` 的管理员，可以给任意角色（包括自己的角色）加上 `users.delete`、`settings.write`、`releases.write`，把"管理用户"升级成"管理一切"。第二条在 `webserver/src/server/services/userService.ts#updateUser`（第 264–272 行）：它阻止把别人提成 `owner`，但**不阻止把别人提成 `admin`**，也不比较调用者与目标的权限高低——于是一个 `admin` 可以创建第二个 `admin`，需求 A-3 的"由根管理员分配"在服务端根本不成立。

第三，**根管理员只是一个环境变量**，不是一个具名、可识别、可审计、可轮换的账号：`config.ts` 的 `ROOT_ADMIN_USERNAME` 默认值是 `owner`，`seed.ts#ensureRootAdmin` 用 `hashPassword()` 直接写库并**绕过口令策略**（这是对的，否则初始口令进不去），但系统没有任何地方告诉运维"这个最高权限账号仍在用初始口令"。对"顶级、稳健"的要求而言，这是一个必须补上的安全姿态缺口。

本方案因此交付四件事：**(1)** 一个零依赖、自研、单次性、可限流、可测试的图形验证码子系统，强制用于注册，并按失败次数自动升级到登录；**(2)** 一套可证明的授权模型：角色等级 + 权限子集 + 分配权，让"谁能把谁变成什么"变成服务端的三条不变式；**(3)** 把根管理员落成具名账号并加上初始口令轮换检测与安全态势面板；**(4)** 把"游客可看不可下"写成显式公开面清单 + 回归测试。

---

## 2. 现状核验与差距矩阵

> 本节所有结论均来自对当前工作树源码的只读核对，不采信设计稿自述。行号以本文件写作时的磁盘状态为准。

### 2.1 已具备能力（不得重建，只做接入）

| 能力 | 位置 | 状态 |
|---|---|---|
| 注册 / 登录 / 刷新 / 登出 / 心跳 | `app/api/v1/auth/*/route.ts`、`server/services/authService.ts` | 完成 |
| 不透明令牌 + HMAC 摘要存储 + 刷新重用检测 | `server/auth/tokens.ts`、`0003_refresh_history.sql` | 完成 |
| 口令策略（10–128 字节、弱口令表、相似度、重复字符） | `server/auth/password.ts#validatePasswordPolicy` | 完成 |
| 登录限流（IP 20/5min、标识 12/5min）与指数退避锁定 | `server/auth/rateLimit.ts#LIMITS`、`authService.ts#applyLockout` | 完成 |
| RBAC：角色表 + 权限联表 + 13 个权限键 | `server/auth/permissions.ts` | 完成 |
| 三道守卫：`requirePermission` / `requireAdminWrite` / `requireAdminRead` / `requireOwner` | `server/auth/guards.ts:147/199/217/178` | 完成 |
| 管理控制台九个页面 + 账号中心五个页面 | `app/(console)/**` | 完成 |
| 邮件 outbox 管线、邮箱验证、改绑、注销宽限期 | `server/mail/*`、`server/services/emailVerificationService.ts`、`accountDeletionService.ts` | 完成 |
| 下载字节必须会话 | `app/api/v1/downloads/[channel]/[platform]/route.ts:81` `requireSession` | 完成 |
| 中间件保护 `/account` `/admin` + CSP | `src/middleware.ts` | 完成 |

### 2.2 差距矩阵

| ID | 差距 | 证据 | 处置 | 优先级 |
|---|---|---|---|---|
| **G-1** | 注册无人机校验 | `registerSchema` 无验证码字段；`LIMITS.registerIp` 仅 10/h | 新增验证码子系统，注册强制；登录按失败次数升级 | P0 |
| **G-2** | 根管理员非具名账号、无轮换检测 | `config.ts` 默认 `ROOT_ADMIN_USERNAME='owner'`；`seed.ts` 无任何姿态输出 | 默认改为 `xdrshjr`；新增姿态检测与面板告警 | P0 |
| **G-3** | 权限可越级授予（两条提权通道） | ① `roleService.ts#replacePermissions`（第 166–194 行）只过滤 `'*'`，**无子集校验**——持有 `roles.write` 的自定义角色可给自己加上 `users.delete` / `settings.write`。② `userService.createUser`（`POST /admin/users`，路由只查 `users.write`，仅拦 `owner`）接受 `roleId`/`roleKey`，可创建第二个 `admin`；`inviteService.createInvite`（第 56–67 行）同样只拦 `owner`，可发一张注册即成 `admin` 的邀请码。**注**：`updateUser` 的 `roleId` 分支在路由层额外要求 `roles.write`，标准 `admin` 没有该权限，故今天主要可达路径是 ② 不是 ①（评审 R-12 更正原表述）。 | 新增 `authorityService`：等级 + 子集 + 分配权三闸 | P0 |
| **G-4** | 游客能力不是显式契约 | 无公开面清单、无对应测试；`robots.ts` 未排除 `/account` `/admin` | 显式公开面清单 + 不变式 + 回归测试 + `noindex` | P0 |
| **G-5** | 无授权台账 | `audit_events` 有 `user.update` 的 roleId diff，但审计保留 180 天后丢失；`users` 表无"由谁授予角色" | 新增 `role_granted_by/at` 两列 + 界面展示 | P0 |
| **G-6** | 管理员界面缺"分配管理员"与"可授予范围"表达 | `user-form-dialog` 角色下拉不区分可授予性；`permission-matrix` 不区分"我没有的权限" | 下拉按可授予性过滤并说明原因；矩阵禁用无权授予项 | P0 |
| **G-7** | 无安全态势视图 | 最高权限账号的初始口令状态、验证码拦截效果、越权拒绝次数均无处可看 | 新增 `/admin/security` + `securityPostureService` | P0 |
| **G-8** | 桌面端注册将因验证码失效 | `desktop/main/authHttp.js#register` 无验证码字段；`src/components/auth/RegisterForm.tsx` 无对应控件 | P0 只加**可读错误与降级文案**；P1 补 IPC 取码与控件 | P0/P1 |

### 2.3 需求追溯表

| 用户原话 | 本方案落点 | 验收 |
|---|---|---|
| 支持用户登录和注册 | 已有；本轮不削弱，补验证码 | AC-01、AC-20 |
| 注册需要输入验证码 | G-1：`captcha_challenges` + `/auth/captcha` + 注册强制 | AC-02…AC-09 |
| 管理员有对应管理界面与功能 | 已有九个页面；本轮补安全态势页与授权台账 | AC-21…AC-24 |
| 根管理员 xdrshjr/13519126390 具备最高权限 | G-2：`ROOT_ADMIN_USERNAME` 默认 `xdrshjr`，初始口令由部署环境注入，`owner` 角色权限恒为 `*` | AC-10、AC-11 |
| 其余新注册的管理员由根管理员分配 | G-3：`admin` 角色只能由 `owner` 授予；且不可授出自身没有的权限 | AC-12…AC-16 |
| 界面 UI/UX 与项目统一 | 复用 `components/ui/{button,field,badge,dialog}` 与既有 CSS 变量令牌，不引入新依赖 | AC-30 |
| 游客可看内容、不可下载 | G-4：公开面清单 + 字节端点必须会话 | AC-25…AC-29 |
| 我没考虑到的功能 | G-3/G-5/G-6/G-7（提权闸、授权台账、可授予范围、安全态势） | AC-12…AC-24 |

---

## 3. 技术方案（Technical design）

### 3.1 总体架构与分层

严格沿用既有分层，不新增"岛"：

```
浏览器 / 桌面 IPC
   │
   ├─ app/api/v1/**/route.ts        只做：解析 → zod 校验 → 取守卫 → 调服务
   │                                   （权限、CSRF、预算一律走 guards.ts，禁止手搓）
   ├─ server/services/*.ts          领域逻辑 + 事务 + 审计
   │     ├─ captchaService.ts       签发/校验/清理挑战（新）
   │     ├─ captchaRender.ts        纯函数：挑战 → SVG 字符串（新）
   │     ├─ captchaGlyphs.ts        矢量字形表（新，纯数据）
   │     ├─ authorityService.ts     等级/子集/分配权三条不变式（新）
   │     └─ securityPostureService.ts 安全姿态只读聚合（新）
   ├─ server/db/repositories/*.ts   唯一允许出现 SQL 的地方
   └─ server/db/migrations/0007_*.sql 加法式迁移
```

三条硬性约束（违反即为缺陷）：

1. **授权判定只在服务层与守卫层**。界面上的禁用、隐藏、灰化都只是 UX，不是安全边界。
2. **验证码的答案永不出现在任何响应、日志、审计、数据库明文中**。库里只存 `HMAC(SESSION_SECRET, id.answer)`。
3. **迁移只做加法**。`ALTER TABLE ADD COLUMN` 与 `CREATE TABLE`、`CREATE INDEX`、`INSERT OR IGNORE`，禁止 `DROP`。

### 3.2 验证码子系统（G-1）

#### 3.2.1 为什么自研、为什么不是"看起来像个验证码的图"

现有依赖清单里没有任何图像/字体库（`webserver/package.json` 只有 better-sqlite3、next、react、zod、nodemailer、lucide 等），而项目规则明确要求新依赖必须必要。同时，一个把答案写成 `<text>` 节点的 SVG 验证码**等于没有验证码**——任何脚本直接读 JSON 里的 SVG 源码即可拿到答案。

因此采用**笔画矢量字形**方案：服务端内置一张 32 字符的笔画字形表（`A–Z` 去掉 `I/O`、`2–9` 共 32 个，与既有 `newTempPassword`/`newInviteCode` 的免歧义字母表一致），每个字形是若干条折线的点序列；渲染时把每个字形做**逐字旋转 + 平移 + 缩放 + 描边宽度扰动**，再叠加两条正弦噪声曲线与约 40 个噪点。输出中**不存在任何 `<text>` 或答案字符串**，只有 `<path>`。这样：

- 机器人要破，必须做**视觉 OCR**，而不是读 DOM；
- 人类阅读难度可控（5 个字符、200×64、字号等效 30px、低噪声密度）；
- 零依赖、纯函数、可单测、可复现。

> 若团队后续接受引入栅格化依赖，只需替换 `captchaRender.ts` 一个函数，接口不变。这是本方案保留的唯一扩展点。

#### 3.2.2 流程（签发 → 提交 → 消费）

```
POST /auth/register（或 /auth/login 升级时）
  ① GET /api/v1/auth/captcha?purpose=register
     服务端：随机生成 5 字符 → 写 captcha_challenges 行（存 HMAC 摘要）→ 渲染 SVG → 返回
     → 200 { captcha: { id, svg, width, height, expiresAt, purpose } }
  ② 用户填答案，随注册/登录体一起提交
     服务端：按 id 取行 → 过期？→ 已消费？→ 尝试次数超限？→ 常量时间比对摘要
       失败：attempts += 1，返回 captcha_invalid（附剩余次数）
       成功：consumed_at = now（单次性，先消费后建号）
```

设计要点（每条都要有测试）：

- **单次性**：一个挑战只能成功消费一次。消费与业务写入在**同一事务**内，且**消费先行**：验证码通过但注册因邮箱重复失败时，挑战仍然作废（避免"先探邮箱是否存在再复用挑战"）。
- **先消费后校验业务前置**（评审 R-03 修正）：事务内的顺序**必须**是
  `原子消费验证码 → 口令策略 → 邮箱/用户名唯一 → 建用户 → 消耗邀请码 → 审计`，
  而不是把唯一性检查放在事务之前。理由：若先查唯一性，失败时挑战未被消费，攻击者可拿同一 `captchaId` 反复提交来枚举邮箱是否已注册；那条路既是验证码漏洞，也是枚举放大器。代价是「输错口令策略会白白烧掉一张图」——可接受，因为前端在提交前已做同源校验。
- **先消费后建号**：先 `UPDATE ... SET consumed_at=? WHERE id=? AND consumed_at IS NULL`，`changes===1` 才继续；并发两个请求只有一个能赢。
- **过期即废**：`expires_at` 默认 300 秒（设置项 `captcha.ttlSeconds`，60–900）。
- **尝试上限**：默认 5 次（`captcha.maxAttempts`，3–10）。超限视为作废，前端强制换图。
- **答案归一化**：`trim → 去空白 → NFKC → toUpperCase`，大小写不敏感（人类友好，不降低熵：字母表全大写）。
- **绑定上下文**：行里记录 `purpose` 与 `ip`；校验时 `purpose` 必须匹配，`ip` 不匹配仅记录审计 `captcha.ip_mismatch` 但**不拒绝**（移动网络切换 IP 很常见，拒绝会造成真实用户注册失败）。
- **签发限流**：`LIMITS.captchaIssue = 60 次/小时/IP`。每次签发写一行，限流同时保护数据库不被撑爆。
  - **⚠ 共享桶风险（评审 R-02 补入）**：`requestContext.clientIpFrom`（第 39–52 行）只在 `TRUST_PROXY=true` **且**存在 `X-Forwarded-For` / `X-Real-IP` 时才返回真实地址，否则一律返回常量 `FALLBACK_IP = '0.0.0.0'`。因此**直连部署**（无反代、客户端不发转发头）下，所有访客共用 `0.0.0.0` 一个桶——60 次/小时之于整站等于「一个脚本就能让全站注册 503」。处置：签发限流**必须**同时使用第二个维度 `captchaIssue` 按 `ip` 计数；当 `ip === FALLBACK_IP`（即地址不可信）时，**改为按 `sha256(ip + userAgent + 请求体 email)` 的稳定指纹**计数，并在安全态势页把 `untrustedIpRatio` 显示出来，让部署者知道自己的 `TRUST_PROXY` 配错了。这不是本轮新引入的问题，但验证码会给它一个新放大器，必须在交付时一并收敛。
- **清理**：`maintenanceService.pruneRetained` 增加一步，删除 `expires_at < now - 1h` 或 `consumed_at < now - 1h` 的行，随既有的每小时惰性扫描执行，不新增调度器。
  - **返回值同步（评审 R-13）**：`pruneRetained` 现返回 `{ tokensPruned, mailsPruned }` 并被 `SweepIfDueResult` 展开。新增 `captchasPruned` 时必须同时改返回类型、`sweepIfDue` 的展开与 `log('info','retention sweep finished')` 的字段，否则统计数字会撒谎。

#### 3.2.3 错误码（新增，属 API 变更，必须在 `docs/api.md` 登记）

| 错误码 | HTTP | 触发 | `details` |
|---|---|---|---|
| `captcha_required` | 400 | 该操作需要验证码但请求未携带 | `{ purpose }` |
| `captcha_invalid` | 400 | 答案错误 / 挑战不存在 / 已消费 / 尝试超限 | `{ remainingAttempts }` |
| `captcha_expired` | 400 | 挑战过期 | `{ expiresAt }` |

`captcha_required` 与 `captcha_invalid` **必须是两个码**：前端行为不同（前者渲染挑战，后者提示重试），而"口令错误"不能与"验证码错误"混为一谈——否则用户会以为密码错了。

#### 3.2.4 登录的阶梯升级

- 设置项 `captcha.requiredOnLoginAfterFailures`（默认 3，范围 0–20；0 = 从不要求）。
- 触发条件：**同一标识**或**同一 IP** 在最近 15 分钟内的失败次数 ≥ 阈值。标识维度用既有的 `loginAttemptsRepo.countFailuresSince`（索引 `idx_attempts_identifier`）；**IP 维度必须新增** `loginAttemptsRepo.countFailuresByIpSince(db, ip, sinceMs)`（索引 `idx_attempts_ip` 已存在，但仓库里今天没有这个函数——评审 R-08）。
- **IP 维度必须复用 `rateKeyFor`，否则这是一个登录 DoS（评审 R-V4-03，P0）**：直连部署下 `clientIpFrom` 恒返回 `FALLBACK_IP`（`TRUST_PROXY` 默认 `true` 且无转发头，见 §3.2.2 的共享桶分析），于是 `countFailuresByIpSince('0.0.0.0', …)` 统计的是**全站所有访客**的失败。攻击者只要在 15 分钟内制造 3 次失败，全站每一个用户登录都会收到 `captcha_required`；若签发桶同时被打满，用户连图都拿不到，结果是**任何人都无法登录**。
  因此这一维度的入参**不能**是裸 `ip`，必须与签发限流使用同一个键：

  ```ts
  // captchaService.loginRequiresCaptcha 的正确读法
  const ipKey = rateKeyFor(ip, userAgent)          // ip !== FALLBACK_IP 时 = ip；否则 = fp:sha256(ip|ua)
  loginAttemptsRepo.countFailuresByIpSince(getDb(), ipKey, since)
  ```

  这要求 `loginRequiresCaptcha` 的签名带上 `userAgent`（当前调用点 `authService.ts:360` 只有 `(identifier, ip)`，需一并调整），并且**写入 `login_attempts.ip` 时也用同一个 `rateKeyFor` 结果**——否则读写的键不同，计数恒为 0，等于这个维度失效（方向安全但会让 AC-09b 的 IP 分支永远不触发）。两者必须同源，这是本条的全部要点。
- 顺序（**评审 R-07 修正**）：限流 → CSRF → **维护模式 → 版本闸** → **验证码** → 口令校验。
  - 验证码**必须**排在维护/版本闸之后，因为 `authService.login`（第 335–344 行）的固定顺序就是 `assertNotInMaintenance → assertClientSupported → verifyCredentials`。若把验证码提到最前，维护期用户要先做一道题才被告知「站点维护中」，且挑战被白白烧掉；更糟的是「维护中」与「验证码过期」两个错误谁先返回会随请求时序抖动，前端无法稳定呈现。
  - 验证码仍排在**口令之前**，理由与既有注释一致：不能让一个过期的验证码把 CPU 花在 scrypt 上。
- 关键取舍：**登录的验证码不是无条件强制**。无条件强制会让每一次正常登录都多一步，而现有的按账号退避锁定已经防住了定向爆破；验证码补的是"撞库/分布式低速试错"这个锁定阈值的盲区。

#### 3.2.5 测试后门（必须被双重闸门锁死）

`scripts/smoke.mjs` 是跑在真实 HTTP 上的端到端门禁，它必须能完成一次注册。因此：

- 当且仅当 `getConfig().e2eMode === true` **且** 请求被判定为回环来源时，`GET /auth/captcha` 的响应**额外**返回 `debugAnswer`。
- **回环判定必须与实际 IP 推导一致（评审 R-02 修正，这条不修后门就永远打不开）**：
  `requestContext.clientIpFrom`（第 39–52 行）只在 `TRUST_PROXY=true` 且存在 `X-Forwarded-For` / `X-Real-IP` 时才返回真实地址，**否则一律返回常量 `FALLBACK_IP = '0.0.0.0'`**。`scripts/smoke.mjs` 直连 `127.0.0.1:8787` 且不发转发头，因此它拿到的 `context.ip` 是 `0.0.0.0` —— 若只把 `127.0.0.1` / `::1` 当作回环，后门**永不触发**，AC-35 无法完成注册。
  因此判定集合为 `{'127.0.0.1', '::1', '::ffff:127.0.0.1', '0.0.0.0'}`，**并且**要求 `e2eMode === true`。`0.0.0.0` 出现在集合里是安全的：它的唯一来源是「没有可信转发头」，而生产环境 `NODE_ENV=production` 已保证 `e2eMode === false`，两者不可能同时为真。
- 同步改 `scripts/smoke.mjs`：注册与登录请求**显式**发送 `X-Forwarded-For: 127.0.0.1`，让 `context.ip` 有确定值。这样既验证了后门，也让后面的 `register:ip` / `captchaIssue` 限流桶与真实部署同形。
- `config.ts` 已经保证：`e2eMode = nodeEnv !== 'production' && (nodeEnv === 'test' || ECLIPTRIX_E2E === true)`——生产环境无论环境变量怎么写都拿不到该字段。
- 服务启动时若 `e2eMode` 为真，打印一行 `[webserver] WARNING e2e mode: captcha debugAnswer is exposed on loopback`。
- 单测断言：`NODE_ENV=production` 下 `loadConfig().e2eMode === false`（已有测试覆盖 e2eMode，扩展一条验证码相关断言）。

### 3.3 账号体系与根管理员（G-2）

1. **默认用户名**：`config.ts` 中 `ROOT_ADMIN_USERNAME` 默认值由 `'owner'` 改为 `'xdrshjr'`。
   - 只影响**新建**库：`ensureRootAdmin` 用邮箱查找既有账号并提升角色，所以存量部署的账号名不会被改动。
   - `ROOT_ADMIN_EMAIL` 仍是必填的合法邮箱，与用户名互相独立（需求 A-2 的读法）。
2. **初始口令**：由部署环境的 `.env` 注入（`ROOT_ADMIN_PASSWORD`）。需求给出的 `13519126390` 是**真实个人标识**，不得写进仓库：`.env.example` 保留占位符 `change-me-before-first-boot`，`webserver/README.md` 与 `docs/deployment-checklist.md` 写明"首次部署必须把根管理员设为 `xdrshjr` 并在上线后立即改为强口令"。
   - `hashPassword()` 在 seed 路径绕过口令策略（现状如此，且必须保持），否则 11 位纯数字初始口令进不去。
3. **初始口令轮换检测（新增，无需加列）**：判定条件是 `users.password_updated_at <= users.created_at`（即口令哈希只在创建时写过一次）。
   - seed 时写一条审计 `security.bootstrap_credential_created`（`target_id = 用户 id`）。
   - 安全态势页把"根管理员仍在使用初始口令"作为最高优先级的红色告警，并给出改口令的入口。
   - 一旦用户改过口令，判定自然转为 false，无需清理任何标记。
4. **所有权交接**：新增 CLI `npm run owner:transfer -- --email a@b.c [--dry-run]`，在**一个事务**内把 `owner` 角色从旧账号移到新账号，写审计 `user.owner_transferred`。不提供 API——所有权变更是破窗级操作，与现有 `user:reset` 同级。

### 3.4 权限授予模型（G-3，本方案的核心）

新增 `server/services/authorityService.ts`，提供四条纯函数与两条断言。所有"改角色、改权限、发邀请码"的路径都必须经过它。

#### 3.4.1 角色等级（rank）

`roles` 表新增 `rank INTEGER NOT NULL DEFAULT 20`，等级**只能由迁移写入、不提供任何 API 修改路径**（`createRoleSchema` / `updateRoleSchema` 不含该字段），避免"改个数字就升级"的新提权面。

| 角色 | rank | 说明 |
|---|---|---|
| `owner` | 100 | 根管理员，权限恒为 `['*']` |
| `admin` | 80 | 管理员 |
| 自定义角色 | 20（默认） | 迁移不改默认值；等级低于是安全的默认失败方向 |
| `support` | 40 | 客服 |
| `member` | 10 | 普通用户 |

#### 3.4.2 三条不变式

**INV-1（等级闸）**：对目标账号执行**削弱性**操作（停用、删除、降级、重置口令）时，要求 `actor.rank > target.rank`。`owner` 因为 rank=100 且不可被操作（既有 `assertNotOwner` 保留），自然满足。
- 效果：`admin`(80) 不能停用另一个 `admin`(80)——同级互相封禁是政变，不是治理。
- 例外：`admin` 可以处理 `support`(40) 与 `member`(10)。

**削弱性操作的全入口（评审 R-01 补入，缺一即为漏洞）**：等级闸不能只装在 `PATCH /admin/users/{id}`。下列**每一个**入口都必须在执行前调用 `authorityService.assertRankAbove(actorUserId, targetUserId)`：

| # | 入口 | 服务函数 | 今天的防线（不足） |
|---|---|---|---|
| 1 | `PATCH /admin/users/{id}`（status / roleId） | `userService.updateUser` | 仅 `assertNotOwner` + `assertNotSelf` |
| 2 | `DELETE /admin/users/{id}`（含 `?hard=true`） | `userService.deleteUser` | 仅 `assertNotOwner` + `assertNotSelf` |
| 3 | `POST /admin/users/{id}/password-reset` | `userService.resetUserPassword` | **仅 `assertNotOwner`**——`admin` 可重置同级 `admin` 的口令并接管账号 |
| 4 | `POST /admin/users/{id}/deletion` | `accountDeletionService` | 仅 `assertNotOwner` |
| 5 | `POST /admin/users/{id}/restore` | `userService.restoreUser` | 无等级比较 |
| 6 | `POST /admin/users/{id}/unlock` | `userService` 解锁分支 | 无等级比较 |
| 7 | `POST /admin/users/bulk`（suspend / delete / setRole） | `userService.bulk` | 逐条走 `updateUser`，随 #1 一并受控 |
| **8** | **`PATCH /admin/users/{id}` 的 `email` 分支（评审 R-V4-01 补入）** | `userService.updateUser` | **无任何等级闸**——`admin` 可把同级 `admin`／`owner` 的邮箱改为自己的，再走"忘记密码"接管账号，**完全绕开 #3 的口令重置闸** |
| **9** | **`POST /admin/users/{id}/email-verify`（评审 R-V4-01 补入）** | `userService.markEmailVerified` | 仅 `requireAdminWrite('users.write')`——可代任意等级账号完成验证 |
| **10** | **`POST /admin/sessions/revoke`、`DELETE /admin/sessions/{id}`、`GET /admin/users/{id}/sessions`（评审 R-V4-02 补入）** | `adminSessionService.revokeMany` / `sessionService` | **完全无等级闸**；`support`(40) 持有 `sessions.revoke` ⇒ **可强制下线 `owner`(100)** |

> 第 7 条尤其危险：批量接口的「部分成功」契约意味着**一条拒绝不会中断整批**，所以等级闸必须在每一条上独立生效，而不是在批量入口做一次前置检查。
>
> **第 8 条为什么必须与 #3 同级处理（评审 R-V4-01）**：改邮箱看起来是"改个联系方式"，但账号体系里"能收信的地址 = 能重置口令的地址"。只堵 `resetUserPassword` 而不堵 `updateUser.email`，等于给接管链留了一扇后门，而且这条路 **`admin` 对 `owner` 也成立**（`assertNotOwner` 在 `email` 分支根本没被调用）。等级闸必须在 `input.email !== undefined` 分支内、写库之前调用。
>
> **第 10 条为什么算"削弱性"（评审 R-V4-02）**：强制下线不改变数据，但它能让最高权限账号失去操作能力（正在进行的破窗操作被打断、正在处理的告警被踢出），性质等同停用。因此 `adminSessionService.revokeMany` 必须先按 `userId` 解析目标角色并逐条过 `assertRankAbove`，**不能**只在路由层查一次 `sessions.revoke`。注意它同样是"批量部分成功"语义：一条被拒不能中断整批。

**INV-2（子集闸）**：任何人授予权限集合 P 时，必须满足 `∀p ∈ P : hasPermission(actor.permissions, p)`。`owner` 持有 `'*'`，`hasPermission` 对 `'*'` 恒真，因此 owner 不受限。
- 落点一：`roleService.replacePermissions`（当前的最大漏洞）。
- 落点二：`roleService.createRole`（保持"创建时权限为空"，但保留子集校验以防后续放开）。
- 落点三：`inviteService.createInvite`（邀请码携带角色 = 预先授予权限）。
- 落点四：`userService.createUser` / `updateUser` 的角色变更。

**INV-3（分配权）**：授予 `admin` 角色（`rank >= 80`）**只能由 `owner` 执行**。非 owner 尝试时返回 `forbidden` + `details.reason='admin_allocation_reserved'`。
- 这条直接把需求 A-3 变成服务端事实。
- `owner` 角色本身依旧不能通过 API 授予任何人（沿用现有 `system_role_protected` / `forbidden`），只有 CLI 交接。

#### 3.4.3 授权台账（G-5）

`users` 表新增两列：`role_granted_by TEXT REFERENCES users(id) ON DELETE SET NULL`、`role_granted_at INTEGER`。
- 每次 `role_id` 变更时在同一事务写入：`role_granted_by = actor.id`、`role_granted_at = now`；seed 创建根管理员时写 `NULL`（表示"由系统种子创建"）。
- 用户详情页展示"角色由 X 于 Y 授予"，即使审计行被保留期清理，这条归属依然在。
- `ON DELETE SET NULL` 是硬删除的必要条件（与 `0001_init.sql` 中三处外键同理），否则任何授予过角色的人都会阻塞 `?hard=true`。

#### 3.4.4 actor 入参签名（评审 R-06 修正，**不做这条三条不变式无法实现**）

三条不变式都需要读调用者的**权限集合**与**等级**，但今天所有相关服务的 `actor` 形参类型都是 `AuditContext`（`auditService.ts:14`，字段只有 `actorUserId / actorLabel / ip / requestId`），**没有任何权限信息**。照 §3.4.2 的写法直接把 `actor` 传进 `assertCanAssignRole(actor, targetRole)` 是编译不过的。

统一约定：

```ts
// authorityService 的唯一入参形态 —— 只接受 id，不接受"看着像权限的东西"
export interface ActorRef { actorUserId: string | null }

// 内部解析；不缓存、不信任调用方传入的 permissions
function resolveActor(db: Db, actorUserId: string):
  { userId: string; rank: number; permissions: string[] } | null
```

- 四个现存调用点（`roleService.replacePermissions` / `createRole`、`userService.createUser` / `updateUser` / `deleteUser` / `resetUserPassword` / `bulk`、`inviteService.createInvite`）保持现有 `actor: AuditContext` 形参不变，**只把 `actor.actorUserId` 传给 `authorityService`**。这样不动任何路由签名，也不给攻击者一条「自己声明权限」的新缝。
- `actorUserId === null`（种子、CLI、系统自动解锁）视为**系统行为**：跳过等级闸但不跳过子集闸的**记录**（写 `authz.system_actor`），因为这些路径本就不经 HTTP。
- 成本：每次授权判定多一次 `roles` + `role_permissions` 两条索引查询（主键与联合主键）。这些操作本来就在同一个事务里写三张表，可忽略。
- 硬性约束：**不得**为省这一次查询而把 `permissions` 塞进 `AuditContext` —— 那会让「审计上下文」变成「授权凭据」，而 CLI 与审计重放都会伪造它。

### 3.5 游客面契约（G-4）

新增 `webserver/src/server/auth/publicSurface.ts`，导出一份**允许匿名访问的精确清单**（不是前缀猜测）：

```ts
export const PUBLIC_PAGES = ['/', '/download', '/legal/terms', '/legal/privacy',
  '/login', '/register', '/forgot-password', '/reset-password',
  '/verify-email', '/confirm-deletion'] as const
export const PUBLIC_API_PREFIXES = ['/api/v1/health', '/api/v1/ready',
  '/api/v1/meta', '/api/v1/releases/latest', '/api/v1/auth/', '/api/v1/locale'] as const
```

不变式与测试：

1. 游客可 `200` 打开 `/download`，并看到版本号、大小、SHA-256、历史版本表；**任何可点击的安装包链接都不出现**，只有一个"登录后下载"的入口（现状已如此，加测试钉死）。
2. 游客 `GET /api/v1/downloads/stable/win` → `401`。
3. 游客访问 `/account`、`/admin` → `307` 到 `/login?next=...`。
4. `/account*`、`/admin*` 页面响应带 `X-Robots-Tag: noindex, nofollow`；`robots.ts` 增加 `Disallow: /account`、`/admin`、`/api`。
5. 游客可读 `/api/v1/releases/latest`（只暴露已发布字段，现状已如此）。

> 不做的事：不给下载加"邮箱已验证"门槛。需求只说"游客不能下载"，把门槛提到验证邮箱会顺手打掉一批正常用户，且与本轮目标无关。

### 3.6 管理端界面（G-6、G-7）

复用既有设计语言（CSS 变量令牌、`rounded-sm`、`text-2xs uppercase tracking-wider` 的小节标题、表格 `divide-y` 风格），**不引入任何新依赖**。

1. **用户详情页**（`components/console/user-detail.tsx`）：新增"授权"区块，展示当前角色、等级、授予人、授予时间；"授予管理员 / 撤销管理员"按钮只对 `owner` 可见且可用，其他人看到一行灰字说明"管理员任命由根管理员执行"（解释而不是静默隐藏——静默隐藏会让管理员以为系统坏了）。
2. **用户创建/编辑弹窗**（`user-form-dialog.tsx`）：角色下拉按 INV-2/INV-3 过滤，不可授予的项**不出现**；若当前调用者无权授予任何角色，下拉只留 `member`。
3. **权限矩阵**（`permission-matrix.tsx`）：调用者不具备的权限显示为禁用 + tooltip "你不能授予自己不具备的权限"；`owner` 行保持整体只读。
4. **安全态势页**（新 `/admin/security`，权限 `security.read`）：
   - 根管理员卡片：账号、是否仍用初始口令、上次改密、上次登录；
   - 验证码卡片（24h）：签发数、通过数、失败数、通过率；
   - 越权卡片（24h）：`authz.denied` 次数与 Top 5 权限；
   - 管理员分布：owner/admin/support/member 计数与最近三次角色变更。
   - **⚠ 权限配套（评审 R-09，不修则新页面对所有非 owner 都是 403）**：`(console)/admin/layout.tsx` 对**全部** `/admin/*` 一律先要求 `users.read`，只持有 `security.read` 的角色会被渲染成 `ForbiddenNotice` 而不是新页面。因此 `security.read` **必须与 `users.read` 同行发放**：`SYSTEM_ROLE_PERMISSIONS.admin` 中两者同时存在，迁移 0007 的 `INSERT OR IGNORE` 也只发给同时具备 `users.read` 的角色（`WHERE key = 'admin'`），不给「只有 `security.read`」的孤立组合留位置，`tests/unit/catalog.test.ts` 增加一条「`security.read` 蕴含 `users.read`」的断言钉死它。
   - 权限收窄建议（P2，R-16）：`security.read` 只发 `admin`（`owner` 由 `*` 覆盖），不发 `support`。
5. **命令面板**（`command-palette.tsx`）：导航项来自服务端已过滤的 `nav`，新增页面自动进入，无需改代码。

### 3.7 关键时序

**注册（web）**
```
POST /auth/register
  → 限流 register:ip
  → 维护模式闸 → 版本闸
  → 注册开关 / 邀请码必填
  ┌ 事务 ─────────────────────────────────────┐
  │ ① 原子消费验证码（consumed_at IS NULL）   │
  │ ② 口令策略（弱口令 → 回滚；挑战已作废）    │
  │ ③ 邮箱/用户名唯一（重复 → 回滚，防枚举）   │
  │ 按邀请码或 member 解析 role（含 INV-2/3） │
  │ 建用户 → 消耗邀请码 → 审计                │
  └───────────────────────────────────────────┘
  → 建会话 → 发验证邮件（fire-and-forget）→ 201
```

**授权变更（PATCH /admin/users/{id} with roleId）**
```
requireAdminWrite('users.write') + requirePermission('roles.write')
  → authorityService.assertCanAssignRole(actor, targetRole)   // INV-2 + INV-3
  → authorityService.assertRankAbove(actor, targetUser)        // INV-1
  → 事务：更新 role_id + role_granted_by/at + 审计 user.role_granted
```

**登录（升级路径）**
```
限流 → CSRF → 维护 → 版本 → 失败次数≥阈值?
  → 需要验证码 → 校验验证码 → 口令 → 锁定 → 会话
// 评审 R-07：验证码必须在维护/版本闸之后，与 authService.login 的固定顺序一致
```

---

## 4. 文件 / 模块变更计划

> P0 = 本轮必须交付；P1 = 紧随其后（同仓库小改，不阻塞 P0 上线）；P2 = 明确不做，仅留档。

### 4.1 新增

| 文件 | 意图 | 阶段 |
|---|---|---|
| `webserver/src/server/db/migrations/0007_captcha_and_authority.sql` | 验证码表、角色等级、授权台账、`security.read` 权限授予 | P0 |
| `webserver/src/server/db/repositories/captchaRepo.ts` | 挑战的唯一 SQL 出口（插入/原子消费/失败计数/清理） | P0 |
| `webserver/src/server/services/captchaService.ts` | 签发、校验、归一化、限流接入、清理 | P0 |
| `webserver/src/server/services/captchaRender.ts` | 纯函数：挑战 → 无文本 SVG | P0 |
| `webserver/src/server/services/captchaGlyphs.ts` | 32 个字符的笔画点表 | P0 |
| `webserver/src/server/services/authorityService.ts` | INV-1/2/3 的唯一实现 | P0 |
| `webserver/src/server/services/securityPostureService.ts` | 安全态势只读聚合 | P0 |
| `webserver/src/server/auth/publicSurface.ts` | 匿名可访问清单（唯一来源） | P0 |
| `webserver/src/app/api/v1/auth/captcha/route.ts` | `GET` 签发挑战 | P0 |
| `webserver/src/app/api/v1/admin/security/route.ts` | `GET` 安全态势（`security.read`） | P0 |
| `webserver/src/app/(console)/admin/security/page.tsx` | 安全态势页（RSC，直接调服务） | P0 |
| `webserver/src/components/console/security-posture.tsx` | 态势卡片组 | P0 |
| `webserver/src/components/auth/captcha-field.tsx` | 验证码控件（取图/刷新/无障碍） | P0 |
| `webserver/scripts/owner-transfer.ts` | 所有权交接 CLI | P0 |
| `webserver/tests/unit/captcha.test.ts` | 渲染不含答案、归一化、等级/子集纯函数 | P0 |
| `webserver/tests/integration/captcha.test.ts` | 签发/正确/错误/过期/重用/超限/登录升级 | P0 |
| `webserver/tests/integration/authority.test.ts` | INV-1/2/3 全矩阵 + 邀请码 | P0 |
| `webserver/tests/integration/guest-surface.test.ts` | 游客可看不可下 | P0 |
| `desktop/main/` 内验证码相关通道与测试 | 桌面端取码与提交 | P1 |

### 4.2 修改

| 文件 | 意图 | 阶段 |
|---|---|---|
| `webserver/src/server/db/migrations/`（无） | 只加 0007，不改既有迁移 | — |
| `webserver/src/server/db/types.ts` | `CaptchaChallengeRow`、`RoleRow.rank`、`UserRow.role_granted_*` | P0 |
| `webserver/src/server/db/repositories/rolesRepo.ts` | `COLUMNS`/insert 带上 `rank` | P0 |
| `webserver/src/server/db/repositories/usersRepo.ts` | `COLUMNS`/`create` 带上授权台账两列 | P0 |
| `webserver/src/server/db/repositories/loginAttemptsRepo.ts` | **新增 `countFailuresByIpSince`**（评审 R-08：IP 维度今天不存在，索引 `idx_attempts_ip` 已就绪） | P0 |
| `webserver/src/server/auth/permissions.ts` | 新增 `security` 权限组、`SYSTEM_ROLE_RANK`、`isSubsetOf`；**同时把 `security.read` 加进 `SYSTEM_ROLE_PERMISSIONS.admin`**（且必须与 `users.read` 同行发放，见 §3.6） | P0 |
| `webserver/src/server/auth/constants.ts` | 三个 `captcha_*` 错误码 | P0 |
| `webserver/src/server/http/errors.ts` | 新码状态映射 + `errors.captchaRequired/Invalid/Expired` | P0 |
| `webserver/src/server/auth/rateLimit.ts` | `LIMITS.captchaIssue` | P0 |
| `webserver/src/server/validation/schemas.ts` | 注册/登录体新增 `captchaId`/`captchaAnswer`（**一律 `.optional()`**，见下方注）；`captchaPurposeSchema` | P0 |
| `webserver/src/server/config.ts` | `ROOT_ADMIN_USERNAME` 默认 `xdrshjr` | P0 |
| `webserver/src/server/db/seed.ts` | 根管理员种子审计；演示账号等级说明 | P0 |
| `webserver/src/server/services/settingsService.ts` | 4 个验证码设置项 + `publicMeta.captchaRequired` | P0 |
| `webserver/src/server/services/authService.ts` | `register`/`login` 接入验证码；登录升级判定 | P0 |
| `webserver/src/server/services/userService.ts` | 角色变更走 `authorityService`；写授权台账 | P0 |
| `webserver/src/server/services/roleService.ts` | `replacePermissions` 子集闸（补最大漏洞） | P0 |
| `webserver/src/server/services/inviteService.ts` | 邀请码角色子集闸 + 拒绝 admin 及以上 | P0 |
| `webserver/src/server/services/maintenanceService.ts` | 清理过期挑战 | P0 |
| `webserver/src/app/api/v1/auth/register/route.ts` | 透传验证码字段 | P0 |
| `webserver/src/app/api/v1/auth/login/route.ts` | 验证码闸 | P0 |
| `webserver/src/app/api/v1/admin/users/[id]/route.ts` | 角色变更要求 + 错误语义 | P0 |
| `webserver/src/app/api/v1/admin/users/route.ts` | 创建时角色可授予性 | P0 |
| `webserver/src/app/api/v1/admin/roles/[id]/permissions/route.ts` | 子集拒绝的 403 语义 | P0 |
| `webserver/src/app/api/v1/admin/users/[id]/password-reset/route.ts` | **INV-1 等级闸**（评审 R-01：今天 `admin` 可重置同级口令接管账号） | P0 |
| `webserver/src/app/api/v1/admin/users/[id]/deletion/route.ts` | **INV-1 等级闸** | P0 |
| `webserver/src/app/api/v1/admin/users/[id]/restore/route.ts` | **INV-1 等级闸** | P0 |
| `webserver/src/app/api/v1/admin/users/[id]/unlock/route.ts` | **INV-1 等级闸** | P0 |
| `webserver/src/app/api/v1/admin/users/bulk/route.ts` | **INV-1 逐条生效**（批量部分成功契约） | P0 |
| `webserver/src/components/auth/register-form.tsx` | 注册强制验证码 | P0 |
| `webserver/src/components/auth/login-form.tsx` | 收到 `captcha_required` 时出现验证码 | P0 |
| `webserver/src/lib/i18n.ts` | 中英各约 40 条新键 | P0 |
| `webserver/src/lib/permissionsCatalog.ts` | `security` 组（与后端键集必须相等） | P0 |
| `webserver/src/lib/api/endpoints.ts` | `captchaApi`、`securityApi`、`usersApi.grantRole` | P0 |
| `webserver/src/app/(console)/layout.tsx` | 导航新增"安全态势" | P0 |
| `webserver/src/components/console/user-detail.tsx` | 授权区块 | P0 |
| `webserver/src/components/console/user-form-dialog.tsx` | 角色下拉按可授予性过滤 | P0 |
| `webserver/src/components/console/permission-matrix.tsx` | 无权授予项禁用 | P0 |
| `webserver/src/components/console/settings-form.tsx` | 验证码设置组 | P0 |
| `webserver/src/middleware.ts` | `/account*` `/admin*` 加 `X-Robots-Tag` | P0 |
| `webserver/src/app/robots.ts` | 排除 `/account` `/admin` `/api` | P0 |
| `webserver/docs/api.md` | 新端点、新错误码、curl 示例 | P0 |
| `webserver/README.md` | 部署顺序、根管理员初始化、验证码参数 | P0 |
| `webserver/.env.example` | `ROOT_ADMIN_USERNAME=xdrshjr` 与口令占位说明 | P0 |
| `docs/deployment-checklist.md` | 上线前检查项（根口令轮换、`client.minVersion`） | P0 |
| `webserver/scripts/smoke.mjs` | 验证码全链路 + 授权闸 + 游客面断言 | P0 |
| `src/lib/api/authBridge.ts` | 验证码 IPC 类型与 `captcha()` | P1 |
| `desktop/main/authBridge.js` | `CHANNELS.CAPTCHA` + 输入校验 | P1 |
| `desktop/main/authHttp.js` | `GET /auth/captcha` | P1 |
| `desktop/main/authController.js` | 透传 | P1 |
| `src/components/auth/RegisterForm.tsx` | 桌面注册验证码控件 | P1 |
| `src/components/auth/ServerLoginForm.tsx` | 桌面登录升级验证码 | P1 |
| `src/lib/i18n`（根项目） | 桌面端文案 | P1 |

> **注（评审 R-04，必读）**：`captchaId` / `captchaAnswer` 在 zod schema 里**必须是 `.optional()`**，绝不可写成必填。`readJson`（`server/http/route.ts:112`）把任何 `ZodError` 映射成 `validation_failed`（422），而 AC-01 要求「缺验证码 → `400 captcha_required`」。若 schema 判了必填，缺字段在到达服务层之前就被 422 拦下，AC-01 / `captcha_required` 永远不可达。正确做法：schema 只校验「若提供则形态合法」，由 `authService.register` 的 `assertCaptcha(input)` 抛 `captcha_required`。

### 4.3 规模预算

`webserver/src/lib/i18n.ts` 已 1065 行 / 940 键，`authService.ts` 770 行，`userService.ts` 551 行。本方案的全部新逻辑都放进**新文件**，对既有大文件只做"接入一行 + 抽函数"级别的改动：

- `authService.register()` 抽出一个 `assertCaptcha(input)` 调用，不内联逻辑；
- `userService.updateUser()` 的角色分支替换为一次 `authorityService` 调用；
- 任何单文件超过 **800 行**必须拆（项目 Clean Code 规则），因此 `securityPostureService` 与 `authorityService` 各自独立成文件，不塞进既有服务。

---

## 5. 接口设计（Interface design）

所有端点沿用既有信封：成功 `{success,message,timestamp,data}`，失败带 `error_code` 与 `error_details`。Cookie 写请求必须带 `X-CSRF-Token`（Bearer 除外）。

### 5.1 `GET /api/v1/auth/captcha?purpose=register|login`

需登录：否。限流：`captchaIssue` 60/h/IP。

```jsonc
// 200
{ "success": true, "message": null, "timestamp": "2026-11-26T08:00:00.000Z",
  "data": { "captcha": {
      "id": "0f0c7e2e-…", "purpose": "register",
      "svg": "<svg …role=\"img\" aria-label=\"图形验证码\">…</svg>",
      "width": 200, "height": 64,
      "expiresAt": "2026-11-26T08:05:00.000Z" } } }

// 仅在 e2eMode 且回环地址时追加
// "debugAnswer": "K7QX2"
```

### 5.2 `POST /api/v1/auth/register`（变更）

新增两个字段，`captcha` 部分二选一地失败：缺字段 → `captcha_required`；不匹配 → `captcha_invalid`。

```jsonc
{ "email": "a@b.c", "password": "…", "username": "ada",
  "inviteCode": "ECL-XXXX-XXXX-XXXX",
  "captchaId": "0f0c7e2e-…", "captchaAnswer": "K7QX2",
  "client": "web" }
```

```jsonc
// 400
{ "success": false, "error_code": "captcha_invalid",
  "error_details": { "remainingAttempts": 3 }, "message": "验证码不正确" }
```

### 5.3 `POST /api/v1/auth/login`（变更）

`captchaId`/`captchaAnswer` 可选。未达阈值时传了也无害（照样校验，防止前端状态漂移）。

```jsonc
// 400（服务端要求验证码但没带）
{ "error_code": "captcha_required", "error_details": { "purpose": "login" } }
```

### 5.4 `GET /api/v1/admin/security`（新增）

守卫：`requireAdminRead(request, context, 'security.read')`。

```jsonc
{ "data": {
  "rootAdmin": { "id": "…", "username": "xdrshjr", "email": "a***@x.com",
                 "bootstrapPassword": true,
                 "passwordUpdatedAt": "2026-11-26T07:00:00.000Z",
                 "lastLoginAt": null },
  "captcha": { "issued24h": 42, "solved24h": 31, "failed24h": 9, "solveRate": 0.74 },
  "authorities": { "owner": 1, "admin": 2, "support": 1, "member": 87 },
  "denials24h": { "count": 3, "topPermissions": [{ "permission": "settings.write", "count": 2 }] },
  "recentRoleChanges": [ { "at": "…", "actorLabel": "x***@x.com", "targetLabel": "b***@x.com",
                           "from": "member", "to": "admin" } ] } }
```

### 5.5 `PATCH /api/v1/admin/users/{id}`（语义变更）

`roleId` 分支新增三类拒绝：

| 情形 | 状态 | 错误码 | `details.reason` |
|---|---|---|---|
| 非 owner 授予 admin | 403 | `forbidden` | `admin_allocation_reserved` |
| 授予的权限超出调用者 | 403 | `forbidden` | `permission_exceeds_actor` |
| 操作同级或更高等级账号 | 403 | `forbidden` | `insufficient_rank` |

### 5.6 `PUT /api/v1/admin/roles/{id}/permissions`（语义变更）

同一套子集闸；额外拒绝把角色等级改高（该字段不在 schema 中，提交即 422）。

### 5.7 CLI

```bash
npm run owner:transfer -- --email next-owner@example.com --dry-run
npm run owner:transfer -- --email next-owner@example.com
# 事务内：新账号获得 owner 角色、旧账号降为 admin；写 user.owner_transferred
# 拒绝：目标不存在 / 已停用 / 已删除 / 已是 owner
```

### 5.8 `GET /api/v1/meta`（追加字段）

`publicMeta` 增加 `captchaRequired: boolean`（值恒为 `settings.captcha.enabled !== false`，本轮该开关不开放给运维关闭；保留字段是为了让前端不必先撞一次 400 才知道要渲染验证码）。
### 5.9 会话管理三个端点（语义变更，评审 R-V4-02）

会话吊销是对**账号操作能力**的打击，必须进 INV-1。三个入口的守卫与拒绝语义：

| 端点 | 今天 | 变更后 |
|---|---|---|
| `POST /api/v1/admin/sessions/revoke` | `requireAdminWrite('sessions.revoke')`，逐 id 更新，不读目标角色 | 批量内**逐条**解析目标会话的 `user_id` → 角色 → `assertRankAbove`；被拒条目进 `skipped`，`skipped[].reason='insufficient_rank'`，**整批不中断** |
| `DELETE /api/v1/admin/sessions/{id}` | 同上 | 单条 `403 forbidden` / `details.reason='insufficient_rank'` |
| `GET /api/v1/admin/users/{id}/sessions` | `requireAdminRead('sessions.revoke')` | 保持可读（读不是削弱），但 `admin` 以上才可见同级或更高等级账号的会话列表；`support` 对该目标返回 `403 insufficient_rank` |

> 为什么 `GET` 也要收：会话列表含 IP、设备名、最后活跃时间，是社工与定点打击的侦察面。把"能看到根管理员登录在哪台设备"给到 rank 40 的客服，与 §3.6 里 R-16 把 `security.read` 收窄到 admin 是同一条理由。

---

## 6. 数据模型（Data model）

### 6.1 迁移 `0007_captcha_and_authority.sql`

```sql
-- 0007_captcha_and_authority.sql — 人机校验与授权收敛。
-- 加法式：三张/两处 ADD COLUMN + 一张新表 + 索引 + 幂等授权。禁止任何 DROP。

CREATE TABLE captcha_challenges (
  id           TEXT PRIMARY KEY,
  purpose      TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  -- HMAC(SESSION_SECRET, `${id}.${normalisedAnswer}`)，永不存明文
  answer_hash  TEXT NOT NULL,
  ip           TEXT NOT NULL DEFAULT '',
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER,
  created_at   INTEGER NOT NULL
);
-- 供「同一时刻只允许一次成功消费」与「按时间清理」使用
CREATE INDEX idx_captcha_expiry ON captcha_challenges (expires_at);

-- 角色等级：只能由迁移写入，API 不暴露该字段
ALTER TABLE roles ADD COLUMN rank INTEGER NOT NULL DEFAULT 20;

-- 授权台账：谁把谁设成了什么角色（审计保留期清理后仍可查）
ALTER TABLE users ADD COLUMN role_granted_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN role_granted_at INTEGER;

-- 系统角色等级（幂等；自定义角色保持默认 20，失败方向安全）
UPDATE roles SET rank = 100 WHERE key = 'owner';
UPDATE roles SET rank = 80  WHERE key = 'admin';
UPDATE roles SET rank = 40  WHERE key = 'support';
UPDATE roles SET rank = 10  WHERE key = 'member';

-- 新权限授予既有系统角色（0006 的同款做法：升级库也要能拿到）
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT id, 'security.read' FROM roles WHERE key = 'admin';
```

**四条设计说明（不写清楚就会在实现时踩坑）：**

1. `ALTER TABLE users ADD COLUMN ... REFERENCES users(id)` 在 SQLite 中是合法的，前提是默认值为 `NULL`——这里正是。不自引用的话，`?hard=true` 会被第三个外键阻塞（`0001_init.sql` 里已因此改过三个外键，这是第四个）。
2. `UPDATE roles SET rank` 放在迁移里而不是 seed 里：等级是**结构不变量**，不该每次启动被重写；seed 每次启动重写会让运维对自定义角色的任何调整被静默覆盖（`seedRoles` 只补 `owner` 的 `*`，正是因为同一条理由）。
3. `INSERT OR IGNORE` 而不是 `REPLACE`：与 `0006_client_releases.sql` 的理由一致——运维手动收回的权限不能被升级过程还回去。
4. **双路径发放（评审 R-10，漏掉即「新库 403」）**：迁移里的 `INSERT OR IGNORE … SELECT … FROM roles WHERE key='admin'` 在**全新库**上匹配不到任何行——`boot.ts` 的顺序是 `runMigrations → runSeed`，迁移执行时 `roles` 还是空表。存量库靠迁移拿到 `security.read`，全新库只能靠 `SYSTEM_ROLE_PERMISSIONS.admin` 里已经包含它。两条路径**必须同时改**，`tests/integration/migrate.test.ts` 增一条断言：全新库种子后 `admin` 的权限集合含 `security.read`。

### 6.2 内存形状

```ts
interface CaptchaChallengeRow {
  id: string; purpose: 'register' | 'login'
  answer_hash: string; ip: string
  attempts: number; max_attempts: number
  expires_at: number; consumed_at: number | null; created_at: number
}
```

### 6.3 不变量清单（测试必须逐条钉住）

| ID | 不变量 |
|---|---|
| DM-1 | 一个挑战最多成功消费一次（并发两个请求只有一个 `changes === 1`） |
| DM-2 | 库里不存在验证码明文；`answer_hash` 长度恒为 64 hex |
| DM-3 | `owner` 的 `rank` 恒为 100，且任何 API 都不能改 rank |
| DM-4 | 角色变更必然同时更新 `role_granted_by` / `role_granted_at` |
| DM-5 | `?hard=true` 删除任何"授予过角色"的账号不会触发外键失败 |
| DM-6 | 系统角色 rank 由迁移固定；新建自定义角色 rank 恒为 20 |

---

## 7. 前端交互与视觉规范

**验证码控件**（`captcha-field.tsx`）：

- 结构：`<img>` 不可用（SVG 需要内联才能继承主题），改用 `dangerouslySetInnerHTML` 注入**服务端生成**的 SVG——但必须限定：只接受以 `<svg` 开头、不含 `<script`/`on*=` 的字符串（服务端产物，双保险）。
- 交互：图右侧一个刷新图标按钮（`RefreshCw`，`lucide-react` 已在依赖内），点击即重新签发；剩余尝试次数为 0 时自动刷新并提示。
- 无障碍：容器 `role="group"`、`aria-label="图形验证码"`；SVG 带 `<title>图形验证码，请照图输入 5 个字符</title>`；输入框 `autoComplete="off"`、`inputMode="text"`、`maxLength={6}`、`spellCheck={false}`；刷新按钮有 `aria-label="换一张"`。**答案本身永远不进 `aria-label`**。
- 视觉：与现有表单一致——`Field` 包裹、`Input` 尺寸、`rounded-sm` 边框、`--border` / `--danger` 令牌；图形本身用中性灰底 + 深色笔画，明暗模式下都读得清（SVG 用 `currentColor` 作为笔画色，背景用 `--surface-2`）。

**登录升级**：初始不显示验证码（不打扰 99% 的正常登录）；捕获 `captcha_required` 后才展开，并用一行 `text-xs text-[var(--muted)]` 说明"检测到多次失败，请完成验证"。保持"错误信息只有一条"的现有降级原则，不新增枚举面。

**安全态势页**：沿用 `/admin` 概览的卡片节奏（`rounded-md border bg-[var(--surface)] px-5 py-4`），四张卡 + 一张表；红色仅用于"仍在用初始口令"一条（`--danger`），其余用 `--muted`，避免告警通胀。

**i18n**：中英各新增约 40 键（`captcha.*`、`admin.security.*`、`authority.*`、`errors.captcha_*`）。`tests/unit/i18n.test.ts` 的键集相等断言会自动拦住漏翻译。

---

## 8. 测试与验收标准

### 8.1 测试分层

- **单元**（`tests/unit/`）：纯函数与渲染。验证码渲染"输出中不含答案原文、不含 `<text>`、恰好 N 个字形组、同 id 两次渲染字节相同"；归一化；`isSubsetOf`；等级比较；设置项范围。
- **集成**（`tests/integration/`）：真实 SQLite 文件 + 真实迁移 + 真实种子（沿用 `tests/setup/harness.ts`，禁止 mock 模式创建）。
- **端到端**（`scripts/smoke.mjs`）：跑在**新启动**的 standalone 进程上（既有约束：连跑会因锁定用例烧掉预算产生假红灯）。

### 8.2 验收标准

**验证码（G-1）**

| AC | 断言 |
|---|---|
| AC-01 | 无验证码注册 → `400 captcha_required`，且不创建用户（查库确认） |
| AC-02 | 错误答案注册 → `400 captcha_invalid`，`details.remainingAttempts` 递减 |
| AC-03 | 正确答案注册 → `201` |
| AC-04 | 同一 `captchaId` 第二次提交 → `captcha_invalid`（单次性） |
| AC-05 | 过期挑战（把 `expires_at` 改到过去）→ `400 captcha_expired` |
| AC-06 | 超过 `maxAttempts` → `captcha_invalid`，且换新挑战后可用 |
| AC-07 | `purpose` 不匹配（login 挑战用于 register）→ `captcha_invalid` |
| AC-08 | 渲染结果：`/ac-answer/` 正则不命中、无 `<text`、字形组数 == 长度（单测） |
| AC-09 | 同一 IP 第 61 次签发 → `429 rate_limited` |
| AC-09b | 登录：同标识连续 3 次失败后，第 4 次不带验证码 → `captcha_required`；带上正确验证码 + 正确口令 → `200` |
| AC-09c | **升级判定的 IP 维度不与全站共享（评审 R-V4-03，P0）**：两个不同 `userAgent` 的直连客户端（`context.ip` 均为 `0.0.0.0`）中，A 制造 3 次失败后，**B 的登录不得收到 `captcha_required`**；且 A 的失败写入 `login_attempts.ip` 的键与 `countFailuresByIpSince` 读取的键必须是同一个 `rateKeyFor` 结果（可 grep 断言两处均引用 `rateKeyFor`） |

**账号与根管理员（G-2）**

| AC | 断言 |
|---|---|
| AC-10 | 全新库种子后存在 `username_normalized === 'xdrshjr'` 且角色键为 `owner`、权限为 `['*']` |
| AC-11 | 根管理员 `password_updated_at <= created_at`，态势服务 `bootstrapPassword === true`；改密后变 `false` |
| AC-11b | `NODE_ENV=production` 下 `e2eMode === false`（debugAnswer 不可能出现） |

**授权模型（G-3）**

| AC | 断言 |
|---|---|
| AC-12 | **夹具**：自定义角色 `ops`（`users.read` + `users.write` + `roles.read` + `roles.write`，rank 80）的成员 A 授予 `admin` 角色 → `403`，`reason='admin_allocation_reserved'`（评审 R-05：标准 `admin` 没有 `roles.write`，根本到不了 `authorityService`，用它做夹具这条 AC 不可达） |
| AC-12b | **记录今天真正可达的路径**：标准 `admin`（无 `roles.write`）调用 `POST /admin/users`（只查 `users.write`）创建 `roleKey='admin'` 的用户 → **成功**。这是 G-3 的本体，修复后必须 → `403 admin_allocation_reserved` |
| AC-13 | `owner` 授予 `admin` 角色 → 成功，`role_granted_by === owner.id` |
| AC-14 | 角色 `ops` 的成员（只有 `users.write` + `roles.write`，无 `users.delete`）给角色加 `users.delete` → `403 permission_exceeds_actor` |
| AC-15 | 同上成员给自己所属角色加 `settings.write` → `403`（自我提权被堵） |
| AC-16 | `admin` 停用另一个 `admin` → `403 insufficient_rank`；停用 `member` → 成功 |
| AC-16b | **`admin` 对另一个 `admin` 调 `POST /admin/users/{id}/password-reset` → `403 insufficient_rank`**（评审 R-01：这是今天最直接的账号接管路径，`resetUserPassword` 只有 `assertNotOwner`） |
| AC-16c | `admin` 对 `member` 做 bulk `suspend` / `delete` → 逐条成功；对 `admin` 同级执行 → 该条 `skipped.reason='insufficient_rank'` 且整批不中断（批量「部分成功」契约 + 等级闸逐条生效） |
| AC-17 | 邀请码指定 `admin` 角色 → `403`；指定含越权权限的自定义角色 → `403` |
| AC-18 | 任何角色变更后 `role_granted_by/at` 与审计 `user.role_granted` 均存在 |
| AC-19 | `?hard=true` 删除一个曾授予过他人角色的账号 → `200`（无外键失败） |
| AC-19b | **系统通道未被 HTTP 借用（评审 R-V4-07）**：纯 HTTP 用例跑完授权矩阵后，`audit_events` 中 `action='authz.system_actor'` 的行数必须为 **0**——`actorUserId === null` 是唯一的跳过闸门通道，HTTP 路径一旦传进 null，等级闸会静默失效且只留一条"系统行为"记录 |
| AC-16e | **改邮箱也受等级闸（评审 R-V4-01，P0）**：`admin` 对同级 `admin` 调 `PATCH /admin/users/{id}`（body 只含 `email`）→ `403 insufficient_rank`；对 `owner` 同样 `403`；对 `member` → `200`。这一条必须与 AC-16b 同批复核，因为改邮箱是绕开口令重置闸的等价接管路径 |
| AC-16f | **代验证邮箱受等级闸（评审 R-V4-01，P0）**：`admin` 对同级 `admin` 调 `POST /admin/users/{id}/email-verify` → `403 insufficient_rank` |
| AC-16g | **会话吊销受等级闸，且客服不能踢根管理员（评审 R-V4-02，P0）**：`support` 对 `owner` 的会话调 `POST /admin/sessions/revoke` → 该条 `skipped`；`DELETE /admin/sessions/{id}` → `403 insufficient_rank`；`admin` 踢 `member` → 成功。批量仍为「部分成功」，一条被拒不中断整批 |

**游客面（G-4）**

| AC | 断言 |
|---|---|
| AC-25 | 游客 `GET /download` → `200`，HTML 含版本号与 SHA-256 |
| AC-26 | 游客 HTML 中不含 `/api/v1/downloads/`（无可用下载链接） |
| AC-27 | 游客 `GET /api/v1/downloads/stable/win` → `401` |
| AC-28 | 游客 `GET /account` / `/admin` → `307` 到 `/login?next=…` |
| AC-29 | `/account*` `/admin*` 响应含 `X-Robots-Tag: noindex`；`/robots.txt` 含 `Disallow: /admin` |

**管理界面与授权台账（G-5、G-6，评审 R-V4-04 补齐：此前 §2.3 追溯到此处的 AC-20…AC-24 在 v2/v3 中从未定义）**

| AC | 断言 |
|---|---|
| AC-20 | **登录与注册两条自助路径在改动后仍可用**：网页注册走完验证码 → `201` 且落库；网页登录正确口令 → `200`；错误口令 → `401` 且错误码与改动前一致（本条是「不削弱既有能力」的回归断言，v2 §2.3 已把它列为需求追溯项） |
| AC-21 | `GET /api/v1/admin/users` 返回的角色下拉数据中，**非 owner 调用者拿不到自己无权授予的角色**（`grantableRoles` 过滤），且响应里同时给出 `grantable: false` 的候选与原因，而不是静默省略 |
| AC-22 | `components/console/user-form-dialog.tsx`：`admin` 打开弹窗时，角色下拉不含 `admin` 与 `owner`；`owner` 打开时含 `admin` 不含 `owner`；提交越权角色仍被服务端 `403`（界面过滤不是边界） |
| AC-23 | `components/console/user-detail.tsx` 的授权区块在角色变更后显示 `role_granted_by` 的账号与时间；seed 创建的根管理员显示「系统创建」而非空白 |
| AC-24 | `components/console/permission-matrix.tsx`：调用者不具备的权限渲染为禁用且带说明文案；`owner` 行整体只读；提交被服务端拒绝时展示 `permission_exceeds_actor` 的可读中文原因 |

**界面与一致性**

| AC | 断言 |
|---|---|
| AC-30 | 新页面只使用 `components/ui/*` 与既有 CSS 变量；`npm run lint`、`npm run type-check` 全绿 |
| AC-31 | `tests/unit/catalog.test.ts` 通过（前后端权限键集相等，含 `security.read`） |
| AC-32 | `tests/unit/i18n.test.ts` 通过（中英键集相等，无空值） |
| AC-33 | `/admin/security` 对无 `security.read` 的 `member` → 403 页；对 `admin` → 200 |
| AC-34 | 既有全量测试（12 单测 + 18 集成）不回归 |

**端到端**

| AC | 断言 |
|---|---|
| AC-35 | `scripts/smoke.mjs` 对新进程全绿，且新增断言 ≥ 12 条覆盖 AC-01/03/12/13/25/27 |

---

## 9. 风险与缓解

| ID | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-1 | **桌面端旧版本注册被验证码打挂** | 已安装用户点"注册"看到莫名错误 | ① 服务端在 `captcha_required` 的 `details` 里带 `downloadUrl`，桌面错误映射据此显示"请升级或前往网站注册"；② 上线顺序：先发桌面包 → 再提 `client.minVersion` → 最后启用验证码强制（已写进 `docs/deployment-checklist.md`）；③ 登录不受影响（验证码仅在失败 3 次后升级） |
| R-2 | 验证码无障碍性 | 视障用户无法完成注册 | ① 5 次尝试 + 无限换图 + 失败不锁定账号；② 文案明确"看不清可换一张"；③ 记录为已知限制，P1 预留音频/替代挑战接口；④ 自托管部署可用邀请码 + 限流承担（邀请码模式下验证码仍生效，属刻意） |
| R-3 | 自研矢量字形被 OCR | 验证码失效 | 笔画字形 + 逐字旋转/缩放/描边扰动 + 噪声曲线；若被攻破，替换 `captchaRender.ts` 一个文件即可换实现（接口不变），并已在 §3.2.1 明确该扩展点 |
| R-4 | 验证码表膨胀 | 数据库变大、签发变慢 | 60/h/IP 签发限流 + 每小时的惰性清理 + `expires_at` 索引 |
| R-5 | 等级/子集闸误伤合法运维 | 管理员无法完成日常工作 | ① 默认方向安全但不过度：`admin` 仍可管理 `support`/`member`；② 拒绝时返回**可读的中文原因**而不是裸 `forbidden`；③ 界面提前过滤，用户不会先撞墙 |
| R-6 | rank 只由迁移写 → 自定义角色一律 20 | 无法给自定义角色更高地位 | 刻意如此：本轮不开放 rank 编辑，避免新提权面；若确需，走新迁移 + 评审 |
| R-7 | `security.read` 新增权限导致升级库 403 | 管理员看不到新页 | 迁移里 `INSERT OR IGNORE` 授予 `admin`/`support`（0006 已确立该做法） |
| R-8 | 登录升级判定增加一次计数查询 | 每次登录多一次索引查询 | 仅在失败计数已有行时才查（`countFailuresSince` 走 `idx_attempts_identifier`），正常账号 0 成本 |
| R-9 | 验证码消费与建号同事务，事务变长 | 锁竞争 | scrypt 哈希在事务**之外**完成（现状即如此），事务内只有三次写；单实例部署下无竞争 |
| R-10 | e2e 后门被误开 | 验证码形同虚设 | 双重闸门（`e2eMode` 且回环 IP）+ `config.ts` 保证生产恒 false + 启动告警 + AC-11b 单测 |

---

## 10. 实施顺序与回滚

**顺序（每一步都可独立验证）**

> **评审 R-11 修正**：原顺序把「注册/登录接入验证码」（第 6 步）排在「桌面端验证码通道」（第 12 步）**之前**，与 R-1 自己声明的上线顺序（先发桌面包 → 再提 `client.minVersion` → 最后启用验证码强制）**相反**。照原顺序执行等于先把存量桌面版打死。新顺序把桌面端提前到第 7 步，并明确「第 7 步之前不得对生产开启注册验证码」。

1. 迁移 0007 + `types.ts` + 三个 repository（含新增的 `countFailuresByIpSince`）→ `npm run db:migrate` 幂等；跑 `tests/integration/migrate.test.ts`（含 R-10 的「全新库 admin 有 `security.read`」断言）。
2. `authorityService` + 单测（含 §3.4.4 的 `resolveActor`）。
3. **先修提权面，再谈新功能**：`roleService` / `userService`（含 `resetUserPassword` / `deleteUser` / `bulk` / `restore` / `unlock`）/ `inviteService` 全部接入 → `tests/integration/authority.test.ts`（AC-12…AC-19）。这一步不依赖验证码，可独立上线并**立刻**关掉今天可用的提权通道。
4. `captchaGlyphs` + `captchaRender` + 单测（AC-08）+ `captchaRepo` + `captchaService` + `/auth/captcha` 路由 → 集成测试（AC-01…AC-09）。
5. 设置项 + `publicMeta` + 前端控件（`captcha-field`、注册表单）→ AC-30/AC-32。**此时验证码已可签发，但注册仍未强制。**
6. 游客面清单 + middleware/robots → AC-25…AC-29（与验证码无耦合，可并行）。
7. **P1→P0 前移：桌面端验证码通道**（`authHttp` / `authBridge` / `authController` / `RegisterForm` / `ServerLoginForm`）。发桌面包。
8. 注册/登录路由接入强制 → AC-01…AC-09b。**这一步之后才允许把 `client.minVersion` 提到含验证码的桌面版。**
9. 安全态势服务与页面 → AC-33。
10. `smoke.mjs` 扩充（含 R-02 的 `X-Forwarded-For`）→ AC-35。
11. 文档（`api.md`、`README`、`.env.example`、`deployment-checklist.md`）。

**回滚**

- 代码回滚：本方案所有新能力都收敛在**新文件**与**少量接入点**；回滚只需还原接入点，新表与新列留着不影响运行（加法式迁移的意义）。
- 功能回滚：`captcha.requiredOnLoginAfterFailures = 0` 可关闭登录升级；注册验证码**不提供**运行时关闭开关（理由：第一个被关掉的开关就是安全开关）。若确需紧急关闭，走版本回退。
- 数据回滚：`captcha_challenges` 可直接 `DELETE`（无外键引用）；`roles.rank`/`users.role_granted_*` 保持不动（无害）。

---

## 11. 审计动作清单（新增）

| action | 触发 | metadata |
|---|---|---|
| `captcha.issued` | 签发 | `{ purpose }`（不记答案、不记 id 明文以外的内容） |
| `captcha.failed` | 校验失败 | `{ purpose, attempts, reason }` |
| `authz.escalation_denied` | INV-2/INV-3 拒绝 | `{ actorRole, targetRole, required }` |
| `user.role_granted` | 角色变更成功 | `{ from, to, grantedBy }` |
| `security.bootstrap_credential_created` | seed 建根管理员 | `{ username }` |

`authz.denied`（既有）继续记录权限不足；`authz.escalation_denied` 单独一个动作，因为"权限不足"和"试图越权授予"在事件响应里是两件事。

---

## 12. 非目标与后续规划

| 项 | 为什么本轮不做 | 后续 |
|---|---|---|
| 短信验证码 / 手机号实名 | 需要短信服务商与费用，需求未提；引入即新增外部依赖与合规面 | 独立特性，届时新增 `phone` 列 + `phone_verified_at` + 独立验证码表 |
| TOTP 双因素 | 需要 `users.totp_secret`、恢复码表、登录二阶段、以及桌面端豁免策略（否则管理员绕过 MFA 从桌面登录）；体量与本轮四条主线相当 | 作为下一轮独立特性，届时必须同时落地"强制 MFA 时管理员禁止桌面登录"的闸门 |
| OAuth / SSO | 无第三方身份源需求 | 不排期 |
| 多副本部署 | 限流器与验证码都是进程内/单库设计（既有文档已声明单写者） | 需先迁 PostgreSQL + Redis |
| 邮箱验证作为下载前提 | 需求只说"游客不能下载" | 若要做，应在设置项下开关，默认关 |

---

## 13. 待评审节点确认的问题

1. **A-1 读法**：注册验证码 = 图形人机校验（不是邮箱验证），确认？
2. **A-2 读法**：`13519126390` 作为根管理员**初始口令**写入部署 `.env`（不进仓库），确认？若用户的真实意图是"手机号登录 + 短信验证码"，则本方案需要扩容一个独立特性（见 §12），请在评审节点明确。
3. **R-1 上线顺序**：接受"先发桌面版再启用验证码强制"，还是接受"桌面端注册暂时降级为提示前往网站注册"？
4. **R-6**：自定义角色本轮一律 rank 20，是否可接受？

---

## 评审结论

**有条件通过。**

方向正确、证据扎实：方案没有另起炉灶，而是在已交付的账号服务上做缺口补齐；四条主线（验证码 / 授权不变式 / 根管理员具名化 / 游客面契约）都是"权限系统"本体的必答题，规模与 `webserver/` 现有分层匹配，没有引入新依赖。§2 的现状核验经本次逐行复核，除 G-3 的证据归属需更正外（已按 R-12 修订），其余结论与磁盘一致。

但初版有 **4 个 P0** 会让实施节点撞墙或把漏洞留在线上，已全部在正文修入：

| 编号 | 一句话 |
|---|---|
| R-01 | INV-1 只装在 PATCH 一个入口，`resetUserPassword` 让 `admin` 能重置同级口令接管账号——等级闸必须覆盖 7 个削弱性入口 |
| R-02 | e2e 后门用 `context.ip` 判回环，但直连部署下该值恒为 `0.0.0.0`，后门永不触发、AC-35 无法完成注册（同一根因还让签发限流退化为全站共享桶） |
| R-03 | 「验证码失败即作废」与「唯一性检查在事务之前」自相矛盾，照写会漏出邮箱枚举通道 |
| R-04 | `captchaId` 若在 zod 里必填，缺字段返回 422 `validation_failed`，AC-01 的 `400 captcha_required` 不可达 |

**另 7 项 P1 已修**（R-05 AC 夹具不可达、R-06 `actor` 无权限字段导致三条不变式无法实现、R-07 登录顺序与 `authService.login` 冲突、R-08 缺按 IP 计数函数、R-09 `security.read` 与 `/admin` layout 的 `users.read` 冲突、R-10 新库拿不到 `security.read`、R-11 实施顺序与上线顺序相反），未修项（R-13…R-16）均为 P2，仅记录。

### 放行条件（实施节点必须同时满足）

1. **R-01 的 7 个入口全部接入等级闸**，且 AC-16b（同级口令重置）与 AC-16c（批量逐条生效）两条测试**先红后绿**。只覆盖 `PATCH` 视为未交付。
2. **R-02 / R-04 的实现细节按正文写**：回环判定集合含 `0.0.0.0` 且 `smoke.mjs` 发送 `X-Forwarded-For`；`captchaId`/`captchaAnswer` 在 schema 中一律 `.optional()`。
3. **上线顺序按 §10 修订后的 11 步**：第 7 步（桌面端通道 + 发包）必须早于第 8 步（注册强制 + 提 `client.minVersion`）。
4. **§3.4.4 的 `resolveActor` 约定不得绕开**：不得为了省一次查询把 `permissions` 塞进 `AuditContext`。
5. **P2 四项（R-13…R-16）在实施时记录为已知取舍**，尤其是 R-15（验证码无音频替代）必须在 §7 的界面上给可见出口，而不只是写在文档里。

### 仍需产品侧确认（不阻塞设计，阻塞实现细节）

- §13 的 4 个问题照旧有效，其中 **A-2（`13519126390` 读作初始口令而非手机号）** 与 **A-1（验证码 = 图形人机校验而非邮箱验证）** 是两条分支的根，若读法有变，本方案的 §3.2 与 §12 需要扩容。
- 建议对 **R-16** 直接采纳"`security.read` 只发 `admin`"，并在本轮回写进 `SYSTEM_ROLE_PERMISSIONS`——安全态势页展示根管理员账号状态，客服角色（rank 40）不需要这份可见性。

---

# v3 实施核验（Subtask #1 第二轮）

> 本轮**没有**重新做设计评审。任务是：把 v2 的每一条「应该怎么做」拿去和**磁盘上的实际代码**对账，把「已实现」「已实现但接错」「没实现」三类分开，并把对账中暴露出的**新缺陷**记成可逐行执行的条目。
>
> 核验手段全部是只读命令，结论可复现：
> `npx tsc --noEmit` · `npx eslint . --max-warnings 0` · `npx vitest run` · 逐文件 `grep`/`sed`。

## 14. 一句话结论

**v2 的后端主体已经落地，但前端入口、清理接线、一个削弱性入口和全部新测试尚未落地——当前工作树处于「功能已启用、入口未接通」的半成品状态：网页注册 100% 失败，测试基线 68 红。**

这不是设计问题，是**实施顺序被打断**：第 4 步（签发验证码）与第 8 步（注册强制）之间的第 5、7 步（前端控件、桌面通道）被跳过了，于是第 8 步强制生效时没有任何客户端能提交验证码。

## 15. 三分类对账表（磁盘事实，不采信 v2 自述）

### 15.1 已实现且**接线正确**（后端，全部未提交）

| v2 条目 | 磁盘证据 | 状态 |
|---|---|---|
| 迁移 0007 | `migrations/0007_captcha_and_authority.sql`（76 行）：新表 + `ALTER TABLE roles ADD COLUMN rank` + `users.role_granted_*` + 四条 `UPDATE roles SET rank` + `INSERT OR IGNORE … WHERE key='admin'` | ✅ |
| 验证码签发/校验 | `captchaRepo.ts`(114) / `captchaService.ts`(292) / `captchaRender.ts`(208) / `captchaGlyphs.ts`(191)；答案只存 `sha256(sessionSecret\|id\|answer)` | ✅ |
| R-02 修正 | `captchaService.ts:102` `LOOPBACK_ADDRESSES` **含 `FALLBACK_IP`**，`debugAnswerAllowed` 双闸（`e2eMode && 回环`） | ✅ |
| R-02 共享桶修正 | `rateKeyFor()`：`ip === FALLBACK_IP` 时退化为 `fp:sha256(ip\|ua)` | ✅ |
| R-03 修正 | `authService.ts:530` 在唯一性检查**之前**无条件 `consumeOrThrow` | ✅ |
| R-04 修正 | `schemas.ts:101/115` `captchaId`/`captchaAnswer` 均 `.optional()`；`captchaQuerySchema.purpose` 有默认值 | ✅ |
| R-07 修正 | `authService.login` 顺序 = 维护 → 版本 → 验证码 → 口令（`authService.ts:347-365`） | ✅ |
| R-08 修正 | `loginAttemptsRepo.countFailuresByIpSince` 已存在并被 `loginRequiresCaptcha` 调用 | ✅ |
| INV-1（6/7 个入口） | `userService.ts` 6 处 `assertRankAbove`：`updateUser` 状态分支(266)、角色分支(305)、`deleteUser`(405)、`resetUserPassword`(456)、`restoreUser`(488)、`unlockUser`(519)；`bulk` 逐条走这些函数 | ✅ |
| INV-2 | `roleService`(86 创建/192 替换)、`inviteService`(76 经 `assertCanGrantRole`)、`userService.createUser`(181) / `updateUser`(298) | ✅ |
| INV-3 | `RESERVED_ALLOCATION_RANK = 80` + `assertCanAllocateRole` 只认 `permissions.includes('*')` | ✅ |
| R-06 修正 | `authorityService.resolveActor(db, actorUserId)` 只收 id；`AuditContext` 未被塞权限 | ✅ |
| R-09/R-10/R-16 | `permissions.ts:125` `security.read` 进 `SYSTEM_ROLE_PERMISSIONS.admin` 且与 `users.read` 同行；`support` 刻意不发；迁移侧同款 `INSERT OR IGNORE` | ✅ |
| G-2 根管理员 | `config.ts:81` `ROOT_ADMIN_USERNAME` 默认 `xdrshjr`；`seed.ts:111` 写 `security.bootstrap_credential_created` 审计 | ✅ |
| G-5 授权台账 | `usersRepo.grantRole(db,id,roleId,grantedBy,now)` 同时写 `role_granted_by/at`；`updateUser:341` 传入 actor id；seed 传 `null` | ✅ |
| 设置项 | `settingsService.ts:138-141` 四个键（ttl 60-900 / attempts 3-10 / loginFailures 0-20 / length 4-7） | ✅ |
| 错误码 | `constants.ts:118-120` + `errors.ts:75-77,125-139` 三码齐 | ✅ |
| 签发限流 | `rateLimit.ts:147` `captchaIssue = 60/HOUR` | ✅ |
| 路由 | `auth/captcha/route.ts` 21 行；register/login 路由均已透传四个字段 | ✅ |

### 15.2 已写但**没有接线**（死代码）

| 文件 | 行数 | 证据 | 违反 |
|---|---|---|---|
| `server/services/securityPostureService.ts` | 241 | `grep -rn securityPostureService src/` → **0 命中**（除自身） | Clean Code 8.4「无死代码」 |
| `server/auth/publicSurface.ts` | 63 | `grep -rn publicSurface src/` → **0 命中**；`middleware.ts` 与 `robots.ts` 各自硬编码自己的清单 | 同上 + 双源 |

`publicSurface.ts` 尤其可惜：它已经写好了 `NOINDEX_PREFIXES`，却没被 `middleware.ts` 引用，于是 §3.5 不变式 4（`X-Robots-Tag: noindex`）仍然不成立。

### 15.3 完全未实现（v2 P0 缺口）

| v2 条目 | 磁盘状态 | 后果 |
|---|---|---|
| 注册表单接入验证码 | `register-form.tsx:76-83` 提交体**只有** email/username/displayName/password/inviteCode/client | **网页注册 100% 400**（P0，见 §16） |
| 登录表单升级验证码 | `login-form.tsx` 无 `captcha` 引用，不识别 `captcha_required` | 连续失败 3 次后用户被要求验证码却无输入框 → 死循环 |
| `captcha-field.tsx` | 不存在 | 同上 |
| `/admin/security` 路由 + 页面 + 组件 | 三者全无 | G-7 未交付；`security.read` 是一个授予了却用不上的权限 |
| 前端权限目录 | `permissionsCatalog.ts` 的 `PERMISSION_GROUPS` **无 `security`** 组 | `catalog.test.ts` 红（AC-31 按设计拦截） |
| i18n | `grep -c captcha src/lib/i18n.ts` → **0** | 所有新文案无处可取 |
| `endpoints.ts` | 无 `captchaApi` / `securityApi` | — |
| `middleware.ts` | 无 `X-Robots-Tag` | §3.5 不变式 4 不成立 |
| 验证码表清理 | `captchaService.pruneRetained`（288 行）**无人调用**；`maintenanceService.pruneRetained` 仍只返回 `{tokensPruned, mailsPruned}` | 表无限增长（v2 R-13 已预警，未实施） |
| `scripts/smoke.mjs` | 6 处 `auth/register` 全无反证码、无 `X-Forwarded-For` | AC-35 必红 |
| `docs/api.md` | 无 captcha / security 段 | — |
| `owner-transfer.ts` | 不存在；`package.json` 无 `owner:transfer` | — |
| 三个新测试文件 | `tests/unit/captcha.test.ts`、`tests/integration/{captcha,authority,guest-surface}.test.ts` **全不存在** | AC-08/AC-12…19/AC-25…29 无障碍 |
| 桌面端 P1 五件套 | 未动 | 老桌面版注册必失败（v2 R-1） |
| `.env.example` | 第 34 行仍是 `ROOT_ADMIN_USERNAME=owner` | 与 config 默认 `xdrshjr` 冲突（见 R-V3-08） |

## 16. 基线红灯归因（68 failed / 336，13 个文件）

`npx vitest run` 实测：**13 failed files / 68 failed tests / 268 passed / 336 total**。归因只有三类，且**没有一条是设计缺陷**：

| 类 | 数量 | 根因 | 证据 |
|---|---|---|---|
| **A. 注册被强制验证码，测试无 `debugAnswer`** | 63 | 19 处测试 `register()` 直接调用 `authService.register`（或 HTTP），不带 `captchaId` → `captchaService.ts:190` 抛 `captcha_required` | `AppError: 请先完成图形验证码` 出现 23 次；`expected 400 to be 201` |
| **B. 前端权限目录缺 `security`** | 1 | `permissionsCatalog.ts` 未加 `security` 组，`catalog.test.ts:39` 键集不相等 | 见 §15.3 |
| **C. 迁移夹具未随 schema 演进** | 1 | `migrate.test.ts` 的 upgrade-path 用例只复制 `<6` 的迁移建库后调 `seedRoles()`，而 `rolesRepo.create`（73 行）已无条件写 `rank` 列 → 旧 schema 无该列 | `SqliteError: table roles has no column named rank` |

**A 类的分布**（按文件，`accountDeletion` 18 条最重，因为它逐个用例都要建一个可管理账号）：`accountDeletion` 18、`emailVerification` 10、`emailChange` 8、`accountExport` 7、`adminSessions` 5、`auth` 5、`metrics` 4、`sweep` 4、`activity` 3、`desktop-login` 1、`mailPipeline` 1。

**关键判断**：v2 的 §8 要求「先红后绿」。现在的状态是「集体红」——所有依赖注册的用例同时变红，**已经无法区分「新回归」与「已知红」**。这本身就是必须先修的工程债：一个全部变红的门禁等于没有门禁。

## 17. v3 新发现缺陷（实施级，按严重度）

| ID | 严重度 | 缺陷 | 证据 | 处置 |
|---|---|---|---|---|
| **R-V3-01** | **P0** | **网页注册功能整体断掉**：`authService.register` 已无条件消费验证码，而 `register-form.tsx` 从不提交验证码字段 | `register-form.tsx:76-83` vs `authService.ts:530` | 补 §15.3 的前端三件套（控件 + 表单 + i18n）；这是 §10 第 5 步被跳过导致 |
| **R-V3-02** | **P0** | **测试基线集体变红**，失去「先红后绿」可判定性 | `npx vitest run` → 68 failed | 新增 `tests/setup/captcha.ts` 导出 `issueTestCaptcha(purpose)`：走 `e2eMode` + `FALLBACK_IP` 拿 `debugAnswer` 后直接构造合法提交。**禁止**在测试里关掉强制（那会让 AC-01 失去意义） |
| **R-V3-03** | **P0** | **INV-1 第 4 入口仍未装闸**：`accountDeletionService.confirmByAdmin`（252 行）只调 `assertDeletable`（仅拦 owner + 最后一个可管理账号），**无 `assertRankAbove`**，文件内 `grep authorityService` = 0 | `accountDeletionService.ts:252-274` | 在 `assertDeletable` 之后补 `authorityService.assertRankAbove(actor.actorUserId, userId)`；补 AC-16d |
| **R-V3-04** | **P1** | `securityPostureService.ts`(241) 与 `publicSurface.ts`(63) 是**零引用死代码** | `grep -rn` 均 0 命中 | 两者都必须在本轮接线（否则删除），不得作为「已完成」提交 |
| **R-V3-05** | **P1** | `npm run lint` 非零退出：`--max-warnings 0` 下有 3 个 unused 警告 | `captchaRender.ts:40 FIELD_Y`、`captchaService.ts:12 AppError`、`securityPostureService.ts:26 DAY` | 删三个未用符号（或改名为 `_` 前缀，但删除更诚实） |
| **R-V3-06** | **P1** | 旧迁移夹具与 `rolesRepo.create` 的新列不兼容，**掩盖了真正的升级路径断言** | 见 §16 类 C | 修 `migrate.test.ts`：在 `<6` 库上手工 `ALTER TABLE roles ADD COLUMN rank`，或让夹具改用 `seedRoles` 之外的建行方式；修好后**再加**「全新库 admin 有 `security.read`」断言（v2 §6.1 点 4） |
| **R-V3-07** | **P1** | 验证码清理未接线，表将无限增长（v2 R-13 已列，未做） | `captchaService.pruneRetained` 无调用方；`maintenanceService` 返回类型未扩 | 扩 `pruneRetained` → `{tokensPruned, mailsPruned, captchasPruned}`，同步 `SweepIfDueResult` 与 `log` 字段 |
| **R-V3-08** | **P2** | `.env.example:34` 的 `ROOT_ADMIN_USERNAME=owner` 与 `config.ts:81` 默认 `xdrshjr` 相反 | 两处直接对比 | 改 `.env.example` 为 `xdrshjr`，并在 README 写明首次部署必须改口令 |
| **R-V3-09** | **P2** | `captchaService` 的 `ip_mismatch` 审计在直连部署下永不触发（签发与使用都是 `0.0.0.0`） | `captchaService.ts:226` | 无害，记录；态势页的 `untrustedIpRatio` 可代替它表达同一件事 |
| **R-V3-10** | **P2** | `securityPostureService` 依赖 `captcha` 24h 聚合，但该聚合走 `captchaRepo.windowCounts`——签发与"消费成功"的计数口径尚未定义 | `captchaRepo.ts:98` | 接线时明确：`issued24h` = `created_at` 计数；`solved24h` = `consumed_at` 计数；`failed24h` = `attempts>0 且 consumed_at IS NULL`（两者相加不等于 issued，必须写进注释） |

## 18. v2 中已不再成立的陈述（勘误）

| v2 位置 | 原陈述 | 磁盘事实 |
|---|---|---|
| §2.2 G-3 | 「`roleService.replacePermissions` 只过滤 `'*'`，无子集校验」 | 现在是**流程描述**而非缺陷现状：`roleService.ts:192` 已调 `assertCanGrantPermissions`。描述保留作背景，不可再当作「待修漏洞」 |
| §2.2 G-3 | 「`createUser` 可创建第二个 admin」 | 已修（`userService.ts:181`）。AC-12b 应写成「修复**前**成功 / 修复**后** 403」，否则该 AC 的期望值写反 |
| §3.3 点 4 | 「新增 CLI `owner:transfer`」 | 尚未创建，`package.json` 亦无该 script。仍属未交付 |
| §3.6 点 4 | 「`security.read` 只发 `admin`，不发 `support`」 | **已按 R-16 采纳**：`permissions.ts:130` support 不含该键。v2 的「建议」现在应写成「已决」 |
| §4.2 行 | 「`middleware.ts` 加 `X-Robots-Tag`」「`robots.ts` 排除 /account /admin /api」 | `robots.ts` 已排除三者（**先于本轮就存在**）；`middleware.ts` 仍无 `X-Robots-Tag`。两条不可并列成同一件事 |
| §6.1 | 迁移只列 4 条 `UPDATE roles` | 实际 76 行文件与 v2 逐字一致，无偏差 ✅ |

## 19. 修正后的实施顺序（剩余部分，可直接照做）

`§10` 原 11 步中，1–4 步与 6 步（部分）已完成。剩余工作按「先让门禁变绿、再补功能、最后补入口」重排——顺序与 v2 不同，因为**现在最贵的不是缺功能，而是全红的门禁**：

| # | 动作 | 完成判据 |
|---|---|---|
| R1 | 修 `migrate.test.ts` 夹具（R-V3-06）+ 删三处 unused（R-V3-05） | `npx vitest run tests/integration/migrate.test.ts` 绿；`npx eslint . --max-warnings 0` 退出 0 |
| R2 | 新增 `tests/setup/captcha.ts`（R-V3-02），把 19 处测试注册改为带合法验证码 | 63 条类 A 红灯全部转绿，且 AC-01 仍能构造「缺验证码 → 400」 |
| R3 | 补 `permissionsCatalog.ts` 的 `security` 组 + i18n 中英各约 40 键 | `catalog.test.ts` / `i18n.test.ts` 绿 |
| R4 | `accountDeletionService.confirmByAdmin` 装 INV-1（R-V3-03）+ AC-16d 先红后绿 | 新增测试先失败、后通过 |
| R5 | `captcha-field.tsx` + `register-form` + `login-form`（R-V3-01） | 手工走查：注册成功；连续 3 次登录失败后出现验证码且可完成 |
| R6 | `securityPostureService` 接线：`/api/v1/admin/security` + `/admin/security` 页 + `security-posture.tsx` | AC-33（member 403 / admin 200） |
| R7 | `publicSurface.ts` 接入 `middleware.ts`（`X-Robots-Tag`）与 `robots.ts`（共用 `NOINDEX_PREFIXES`） | AC-28/AC-29；且两文件不再各写一份清单 |
| R8 | 验证码清理接线（R-V3-07） | `sweepIfDue` 返回 `captchasPruned` 且日志字段一致 |
| R9 | `smoke.mjs`：6 处注册补验证码 + 显式 `X-Forwarded-For: 127.0.0.1` | AC-35；新断言 ≥12 条 |
| R10 | `owner-transfer.ts` + `package.json` script | `--dry-run` 不改库；实跑后审计含 `user.owner_transferred` |
| R11 | 桌面端 P1 五件套 + 发包 | 老桌面版注册得到可读的「请升级」而非裸 400 |
| R12 | 文档：`api.md` / `README` / `.env.example`（R-V3-08）/ `deployment-checklist.md` | 新端点、新错误码、根口令轮换、上线顺序 |

> **硬门禁（缺一不得提交）**：R1–R4 完成前，任何「已完成」的声明都不成立——因为此时 `npm test` 与 `npm run lint` 都是红的，无法证明后续补的东西没有引入新回归。

## 20. 验收基线修正（v2 §8.2 的增量）

| AC | v3 修正 |
|---|---|
| AC-34（既有测试不回归） | **当前基线不是 0 红**：实测 68 红 / 336。AC-34 必须改写为「修完 R1–R2 后 `npx vitest run` 全绿（336 passing, 0 failing），此后任何新增提交不得增加红灯数」 |
| AC-31（权限键集相等） | 期望值正确，失败原因是前端目录缺 `security` 组——按 §19 R3 修前必红，修后必绿 |
| AC-30（lint/type-check 全绿） | `type-check` 已绿；`lint` 现有 3 warning → 退出 1。必须修到 0 |
| AC-01（缺验证码 400） | 追加前提：「测试侧必须通过 `tests/setup/captcha.ts` 取得合法挑战，禁止用关闭强制的开关来绕」 |
| — | 新增 **AC-16d**：`admin` 对同级 `admin` 调 `POST /admin/users/{id}/deletion` → `403 insufficient_rank`（R-V3-03） |
| — | 新增 **AC-36**：`accountDeletionService.confirmByAdmin` 与 `userService.resetUserPassword` 两条最直接的接管路径，其等级闸由同一个 `authorityService.assertRankAbove` 提供（可 grep 断言：两文件均 import 该模块） |

## 21. 风险与缓解（v3 增量）

| ID | 风险 | 缓解 |
|---|---|---|
| RV-1 | **半成品被当作成品提交**：后端已启用强制、前端未接入口，部署后注册全挂 | 提交前必须跑 §21 的「端到端注册走查」；`smoke.mjs` 的注册断言是唯一自动门禁，R9 前不得上线 |
| RV-2 | 为了「让测试变绿」而在测试环境关掉强制 | 明令禁止。合法路径只有 `e2eMode` + `debugAnswer`，它同时验证了 R-02 的后门，等于一举两得 |
| RV-3 | 死代码被当成交付物 | §15.2 两文件必须在同一提交内接线；「先提交再接线」会让 `securityPostureService` 的 24h 口径无人校验 |
| RV-4 | 修 `migrate.test` 夹具时顺手放宽了升级路径断言 | 修夹具**不得**删除原 `releases.%` 断言；新断言只能追加 |
| RV-5 | 老桌面版用户（无验证码通道）注册失败 | 严格按 §19 R11 的顺序：先发桌面端通道包 → 再提 `client.minVersion` → 最后保持注册强制 |

## 22. 本轮交付边界（重申）

本轮**只改 `docs/plans/webserver-user-permission-system/` 内的文档**：

- 未修改任何源码；未执行 `git commit`；未创建 `docs/plans/` 之外的文件。
- §15 的「已实现」判定全部来自 `git status` 可见的**未提交工作树**，因此实施节点接手后的第一件事应当是 `git status --porcelain` 复核，而不是假设已提交。
- §16 的 68 红是本轮**实测**结果（`npx vitest run`，2026-11-26），不是估算；若实施时数字变了，说明有人在此期间改了代码，应按新数字重跑归因。

**v3 结论：设计可以放行，实施不可以宣称完成。** 后端主体质量高于预期（R-02/03/04/06/07/08 六个评审修正全部正确落地，INV-2/INV-3 接线完整），但四件事必须在「完成」之前闭环：**(1)** 让门禁从全红回到全绿；**(2)** 补上唯一的注册入口；**(3)** 给 INV-1 的第 4 个入口装闸；**(4)** 把两个死代码模块接线或删除。

---

## 23. 二次评审的核验方法与可复现证据（v4）

本轮不采信 v3 自述，全部结论由下列命令复现。**实施节点接手时应先重跑一遍**，数字不同即说明工作树已变。

| 断言 | 命令 | 实测结果（2026-11-26） |
|---|---|---|
| 测试基线 | `cd webserver && npx vitest run` | `Test Files 13 failed \| 17 passed (30)`；`Tests 68 failed \| 268 passed (336)`；退出码 1 —— **与 v3 §16 一致 ✅** |
| 注册入口未接验证码 | `grep -rn "captcha" src/components/auth/register-form.tsx` | 0 命中 —— **v3 R-V3-01 成立 ✅** |
| 第 4 入口未装闸 | `grep -n "authorityService" src/server/services/accountDeletionService.ts` | 0 命中 —— **v3 R-V3-03 成立 ✅** |
| 两个死代码模块 | `grep -rn "securityPostureService\|publicSurface" src/` | 各 0 命中（除自身） —— **v3 R-V3-04 成立 ✅** |
| 前端权限目录缺 `security` | `grep -n "security" src/lib/permissionsCatalog.ts` | 0 命中 —— **v3 类 B 成立 ✅** |
| 验证码清理未接线 | `grep -rn "captchaService.pruneRetained" src/` | 仅定义处，无调用 —— **v3 R-V3-07 成立 ✅** |
| `.env.example` 与默认值相反 | `grep -n ROOT_ADMIN_USERNAME .env.example src/server/config.ts` | `owner` vs `xdrshjr` —— **v3 R-V3-08 成立 ✅** |
| **改邮箱无等级闸** | `sed -n '307,315p' webserver/src/server/services/userService.ts` | 仅 `emailExists` 查重，无 `assertRankAbove` —— **v3 漏项，见 R-V4-01** |
| **会话吊销无等级闸** | `grep -n "assertRankAbove" webserver/src/server/services/adminSessionService.ts` | 0 命中 —— **v3 漏项，见 R-V4-02** |
| **升级判定未用 `rateKeyFor`** | `sed -n '268,278p' webserver/src/server/services/captchaService.ts` | 直接传裸 `ip` —— **v3 漏项，见 R-V4-03** |
| `windowCounts` 口径已实现 | `sed -n '98,118p' webserver/src/server/db/repositories/captchaRepo.ts` | 三口径同一条 SQL，注释完整 —— **v3 R-V3-10 不成立，见 R-V4-05** |
| AC 缺定义 | `grep -n "AC-2[0-4]" spec.md` | 仅出现在 §2.3 追溯表，§8.2 无定义 —— **见 R-V4-04** |

## 24. INV-1 的完整入口表（十条，取代 §3.4.2 的七条）

v3 的入口表是「七条 + 批量」，两轮评审各补了一部分。**这是最终表，实施与复核都以它为准。** 每一行都必须能 `grep` 到 `authorityService.assertRankAbove`（批量两行是"逐条"，其余是"进入业务写入前"）。

| # | 入口 | 服务函数 | v3 状态 | v4 结论 |
|---|---|---|---|---|
| 1 | `PATCH /admin/users/{id}` status 分支 | `userService.updateUser` | 已装 (`userService.ts:266`) | ✅ |
| 2 | `DELETE /admin/users/{id}` | `userService.deleteUser` | 已装 (`:405`) | ✅ |
| 3 | `POST /admin/users/{id}/password-reset` | `userService.resetUserPassword` | 已装 (`:456`) | ✅ |
| 4 | `POST /admin/users/{id}/deletion` | `accountDeletionService.confirmByAdmin` | **未装**（R-V3-03） | ❌ 必须补 |
| 5 | `POST /admin/users/{id}/restore` | `userService.restoreUser` | 已装 (`:456`→`:488`) | ✅ |
| 6 | `POST /admin/users/{id}/unlock` | `userService.unlockUser` | 已装 (`:519`) | ✅ |
| 7 | `POST /admin/users/bulk`（suspend/delete/setRole） | `userService.bulk` | 逐条经 #1/#2 | ✅（#8 补齐后 setRole 亦覆盖） |
| **8** | **`PATCH /admin/users/{id}` email 分支** | `userService.updateUser` | **本轮新发现** | ❌ 必须补 |
| **9** | **`POST /admin/users/{id}/email-verify`** | `userService.markEmailVerified` | **本轮新发现** | ❌ 必须补 |
| **10** | **会话三端点（revoke / delete / list）** | `adminSessionService` | **本轮新发现** | ❌ 必须补 |

> **为什么这一张表值得单列**：每一轮评审都以为"入口已穷举"，结果三次各补一条。根因是**判定标准写成了"想得到哪些路由"，而不是"哪些服务函数会削弱一个账号"**。正确的复核方法是反查：`grep -n "usersRepo.update\|usersRepo.softDelete\|sessionsRepo.revoke\|usersRepo.hardDelete" src/server/services/` —— 每一个写用户态或会话态的调用点都必须能回答"这里为什么不需要等级闸"。

## 25. v3 结论勘误（v4 修订）

| v3 位置 | v3 陈述 | 磁盘事实 | v4 处置 |
|---|---|---|---|
| §17 R-V3-10 | 「`captcha` 24h 聚合的计数口径**尚未定义**，接线时明确」 | `captchaRepo.windowCounts`（`:98-118`）已用单条 SQL 定义三口径并附注释 | **降级为已核实**，不再列为待办（R-V4-05） |
| §17 R-V3-08 | `.env.example` 与默认值冲突 → **P2「记录」** | 该冲突直接让需求 A-2（根管理员为 `xdrshjr`）在按示例部署的实例上失效 | **升级为 P1**，并入 §19 R12 同批修（R-V4-06） |
| §15.1 | 「INV-1（6/7 个入口）✅」 | 与 §15.3 / R-V3-03 自述矛盾（正确读法是 7 条里 6 装 1 缺） | 以 §24 十行表为准 |
| §2.3 | 追溯表引用 `AC-20`、`AC-21…AC-24` | §8.2 中这五条**从未定义** | v4 已补齐（R-V4-04） |

## 26. v4 增量风险

| ID | 风险 | 缓解 |
|---|---|---|
| RV-6 | **只堵口令重置，不堵改邮箱**：看起来 INV-1 已收官，实际账号接管链仍通 | §24 的十条表为唯一清单；AC-16e 与 AC-16b 必须同批红绿 |
| RV-7 | **等级闸装在路由层**：路由查一次 `sessions.revoke` 就以为安全，批量里逐条仍会打穿 | 硬性约定：闸装在**服务函数**内、逐条目标解析；路由层只做权限与 CSRF |
| RV-8 | **`rateKeyFor` 读写不同源**：写入 `login_attempts.ip` 用裸 IP、读取用指纹，计数恒 0，AC-09c 假绿 | AC-09c 要求 grep 两处均引用 `rateKeyFor`；集成用例用两个不同 UA 断言互不影响 |
| RV-9 | **`actorUserId === null` 的后门被 HTTP 借用** | AC-19b：纯 HTTP 用例跑完 `authz.system_actor` 必须为 0 |
| RV-10 | 为通过 AC-09c 而把升级阈值调高 / 关掉 | 阈值范围 0–20 已有；AC-09c 断言的是**隔离性**不是**是否触发**，调阈值不能让隔离性测试通过 |

---

## 评审结论（v4）

**结论：有条件通过。**

设计本体成立：分层沿用既有约定、迁移只做加法、验证码零依赖自研、三条不变式有明确落点，且后端主体已在工作树落地（R-02/03/04/06/07/08 六个 v2 评审修正经复核全部正确）。v3 把"设计意图"与"磁盘事实"分账的做法是对的，本轮予以沿用并复核。

但 v3 在**两个方向上都不完整**：一方面把两条已实现的判断留成了待办（R-V4-05），把一条 P2 当作可延期（R-V4-06）；另一方面——这是更要紧的——它宣告 INV-1"已收官"时，**入口表仍然漏了三条真实可达的账号接管路径**：改邮箱（对 `owner` 也成立）、代验证邮箱、以及会话吊销（客服 rank 40 能踢根管理员 rank 100）。加上 v3 自己发现的 `confirmByAdmin`，**INV-1 共有 4 个未装闸的入口，而不是 1 个**。

因此本轮把版本推进到 **v4**，并把「削弱性操作」的判定标准从"枚举路由"改为"反查所有写用户态/会话态的调用点"（§24 十条表）。

### 放行条件（实施节点必须同时满足，全部可自动验证）

1. **门禁先绿**：`npx vitest run` 从 68 红回到 0 红（336 passing）；`npx eslint . --max-warnings 0` 退出 0。在 R1–R2 完成前，任何"已完成"声明不成立。
2. **注册入口接通**：`register-form.tsx` 与 `login-form.tsx` 提交验证码字段，网页注册端到端成功（AC-20 回归 + AC-03）。
3. **INV-1 十入口全装**：§24 表内第 4/8/9/10 行必须新增 `assertRankAbove`，且 AC-16b/16d/16e/16f/16g 与 AC-36 全部红转绿。
4. **两处死代码接线或删除**：`securityPostureService` → `/api/v1/admin/security` + `/admin/security`；`publicSurface` → `middleware.ts` 的 `X-Robots-Tag` 与 `robots.ts` 共用清单。二者必须与本次提交同批，不接受"先提交再接线"。
5. **升级判定同源**：`loginRequiresCaptcha` 的 IP 维度读写都经 `rateKeyFor`，AC-09c 绿。
6. **验证码清理接线**：`sweepIfDue` 返回 `captchasPruned`，日志字段一致。
7. **`actorUserId === null` 通道有测试把守**：AC-19b 绿。

### 仍需产品侧确认（不阻塞设计，阻塞实现细节）

- **无障碍（P2，R-15 重申）**：纯图形验证码无音频替代，属 WCAG 1.1.1 缺口。v4 建议补一个可见出口（"看不清？联系管理员获取邀请码"），而不是只写在文档的已知限制里。上线前请确认是否可以接受这一缺口。
- **`security.read` 的可见范围**：已按 R-16 收窄到 `admin`（`owner` 由 `*` 覆盖）。若客服也需要"站点是否被攻击"的只读视图，需要另设一个**不含根管理员账号状态**的精简视图，而不是把本页发给 `support`。
- **根管理员初始口令**：需求给的 `13519126390` 是真实个人标识，**不得进仓库**（§3.3 已按此处理）。首次部署后必须立即轮换，态势页的红色告警即为此设。

---

# 实施过程发现的方案缺陷（Subtask #2 代码开发）

> 本节点按 v4 的「文件 / 模块变更计划」与 §19 R1–R12 落地实现。以下每条都是**照设计写会出错或写不出来**的地方，均已按正确做法实现并在此记账（Constraints 要求：不静默偏离）。
> 门禁基线：接手时 `npx vitest run` = **13 files / 68 failed / 268 passed / 336**，与 v4 §23 完全一致；收尾时 **34 files / 385 passed / 0 failed**，`npx tsc --noEmit` 与 `npx eslint . --max-warnings 0` 均退出 0。

## D-01（P0，已修）验证码升级判定会掩盖 `account_locked`，等于削弱既有能力

- **现象**：`authService.login` 按设计把验证码闸排在口令校验之前（§3.2.4 / R-07）。但升级阈值默认 **3**、锁定阈值默认 **5**，于是第 4 次尝试先生成 `captcha_required`，**永远走不到** `assertCanAuthenticate` 的 `account_locked`。`tests/integration/auth.test.ts` 的锁定用例由此变红。
- **性质**：这不是测试写错，是两条闸的相对顺序没定义。设计只说了「验证码在口令之前」，没说「已在锁定窗口内的账号该由谁回答」。
- **实现**：`login()` 在判定升级之前先调 `isInsideLockout(identifier)`；已锁定则跳过验证码闸，直接由 `verifyCredentials` 返回 `account_locked`。理由：锁定是**已决定**的结果，让一个再怎么解谜也进不去的用户继续解题，既浪费挑战又掩盖真实原因。
- **回归**：`auth.test.ts` 新增用例「demands a challenge before the lockout threshold and answers the lockout after it」先红后绿，同时钉住「3 次失败后要验证码」与「锁定后回答锁定」两端。

## D-02（P0，已修）`rateKeyFor` 只接在「读」侧，写入侧仍用裸 IP，IP 维度恒为 0（AC-09c 假绿）

- **现象**：v4 §3.2.4 要求升级判定的 IP 维度复用 `rateKeyFor`，但**没有要求写侧同源**。磁盘现状是 `loginRequiresCaptcha` 已改成 `rateKeyFor(ip, ua)` 读取，而 `recordAttempt` 仍把裸 `context.ip` 写进 `login_attempts.ip`。直连部署下写入恒为 `0.0.0.0`、读取恒为 `fp:sha256(...)`，计数**永远是 0** —— 方向安全，但 AC-09c 会因为「根本不触发」而假绿。
- **实现**：`recordAttempt` 增加 `userAgent` 形参，写入前同样过 `captchaService.rateKeyFor`；`verifyCredentials` 的 context 增加可选 `userAgent`，`login()` 传入。地址可信时它就是地址本身，取证不损失；不可信时那本来也是无信息的常量。
- **回归**：`captcha.test.ts`「keeps the two escalation dimensions isolated (AC-09c / RV-8)」断言 `keyA !== keyB`、A 的 3 次失败不导致 B 被要求验证码，并断言两个键都能被 `countFailuresByIpSince` 独立计数。

## D-03（P1，已修）`confirmByAdmin` 的等级闸位置改变了「无进行中申请」的错误语义

- **现象**：按 §24 第 4 行在 `assertDeletable` 之后加 `assertRankAbove` 后，既有用例「refuses to schedule an account with no live request」变红：它用被删者**本人**当 actor，同级比较先抛 `insufficient_rank`，`conflict` 不可达。
- **判断**：闸的位置正确（必须在业务写入前），错的是夹具——真实场景里代确认是**管理员**对**他人**执行。
- **实现**：夹具改为由根管理员操作；另新增「refuses to confirm a peer administrator's deletion (INV-1)」（AC-16d）：两个 admin，A 代确认 B 的自助注销必须 `403`。

## D-04（P1，已修）会话吊销的等级闸不能只管「他人」，否则管理员无法清理自己的设备

- **现象**：按 §24 第 10 行给 `revokeMany` / `DELETE /admin/sessions/{id}` 装 `assertRankAbove` 后，`adminSessions.test.ts` 的既有用例变红——根管理员批量吊销**含自己那条**的会话时被同级闸拒绝（`expected 2 to be 3`）。
- **判断**：设计把「强制下线」整体算作削弱性操作，但没有区分**下线自己**。下线自己的设备等价于登出，只能伤到自己，不构成任何提权。
- **实现**：`authorityService` 新增 `canRevokeSessionsOf` / `assertCanRevokeSessionsOf`：`actor === target` 直接放行，其余仍走 INV-1。批量与两个单条端点统一改用它。
- **回归**：新增「always lets an actor clear its own device」与「refuses to revoke a higher-ranked account and keeps the rest of the batch going」（AC-16g）：`support`(40) 踢 `owner`(100) 记入 `denied` 且**不中断整批**，同一批里踢 `member` 成功。

## D-05（P1，已修）`revokeMany` 的 `actorUserId` 不能有 `null` 默认值

- **现象**：给 `adminSessionService.revokeMany` 追加形参时最自然的写法是 `actorUserId: string | null = null`。但 `null` 在 `authorityService` 里表示「系统」并**通过所有闸**——一个漏传的调用点会变成静默绕过，正是 AC-19b 要守死的洞。
- **实现**：形参必填、无默认值；路由显式传 `auth.audit.actorUserId`。`tests` 里两处直调同步补上真实调用者。

## D-06（P1，已修）迁移夹具不能手工 `ALTER TABLE` 补 `rank`，否则 0007 自己会撞「duplicate column」

- **现象**：R-V3-06 建议「在 `<6` 库上手工 `ALTER TABLE roles ADD COLUMN rank`」。照做后测试换了一个错：`runMigrations(db)` 应用真正的 0007 时 `duplicate column name: rank`。
- **判断**：手工加列的时机错了——它必须在 0007 **之后**才有效，但 0007 就是要被这一行测试验证的对象。
- **实现**：夹具改为用**原始 SQL** 插入四个系统角色（0001 的列形态），完全不调用 `rolesRepo.create`（它无条件写 `rank`）。这样 v5 库忠于它自称的 schema，0006/0007 的升级断言才真的在验证升级。

## D-07（P2，已修）`toAdminUserDto` 的形参联合类型挡住了联表别名

- **现象**：为 AC-23 在 `SELECT_WITH_ROLE` 里 `LEFT JOIN users g` 取 `role_granted_by_label` 后，`dto.ts` 报 `Property 'role_granted_by_label' does not exist`——形参里内联的那个交叉类型没有这个字段。
- **实现**：把别名加进 `UserListRow`（可选，因为 `findById` 的行不带它）与 `toAdminUserDto` 的内联分支，并在 DTO 里用 `'role_granted_by_label' in row` 收窄。

## D-08（记录）`grantableRoles` 在 v4 中只出现在组件约定里，没有 API 载体

- **现象**：AC-21 要求 `GET /admin/users` 返回「非 owner 拿不到自己无权授予的角色 + 原因」。全文只在 §3.6 描述界面行为，§5 的接口清单没有这个字段。
- **实现**：`GET /admin/users` 的响应对每个角色给出 `{ id, key, name, rank, grantable, reason }`（`reason ∈ owner_reserved | admin_allocation_reserved | null`），页面用 `authorityService.grantableRoles` 过滤下拉。二者同源，提交时服务端再校验一次。

## D-09（记录）`pruneRetained` 的返回类型扩展波及三处，设计只点了一处

- **现象**：R-V3-07 提醒「同步 `SweepIfDueResult` 与日志字段」，实际还有第三处：`sweepIfDue` 的 `skipped` 常量对象也必须带 `captchasPruned: 0`，否则 `ran:false` 分支返回的形状与类型不一致。
- **实现**：三处同批改完（返回类型、`skipped` 初值、`log('info','retention sweep finished')` 字段）。

## D-10（记录）验证码控件不能把 `onChange` 写成内联箭头

- **现象**：`CaptchaField` 用一个 effect 把 `{id, answer}` 上报给父表单。父表单若传内联箭头函数，每次渲染都是新引用 → effect 反复触发 → 父级 setState → 再渲染的死循环。
- **实现**：注册/登录表单都用 `useCallback(..., [])` 稳定回调；字段自身再用 `requestSeq` 丢弃过期响应，避免快速换图时旧图覆盖新图。

## D-11（记录）根项目 `tsc` 的 17 处报错与本轮无关

- 全部落在 `docs/diagnoses/**/repro/*.test.ts`（不在根 tsconfig 的 include 路径下）与既有的 `SkillRouterSettingsPanel.test.tsx`。本轮改动的 `src/lib/api/authBridge.ts`、`src/lib/i18n.ts` 无类型错误；`webserver/` 的 `tsc` 退出 0。

## 交付清单核对（对照 §4.1 / §4.2）

已新建：`0007` 迁移（既有）、`captchaRepo`/`captchaService`/`captchaRender`/`captchaGlyphs`、`authorityService`、`securityPostureService`、`publicSurface`、`/auth/captcha`、`/admin/security`、`(console)/admin/security/page.tsx`、`security-posture.tsx`、`captcha-field.tsx`、`scripts/owner-transfer.ts`、`tests/unit/captcha.test.ts`、`tests/integration/{captcha,authority,guest-surface}.test.ts`、`tests/setup/captcha.ts`。

已修改：`types/repos`（`captcha`、`rank`、`role_granted_*`、`countFailuresByIpSince`、联表别名）、`permissions`、`constants`、`errors`、`rateLimit`、`schemas`、`config`、`seed`、`settingsService`、`authService`、`userService`、`roleService`、`inviteService`、`maintenanceService`、`adminSessionService`、`emailVerificationService`、`accountDeletionService`、注册/登录/用户/角色/会话路由、`register-form`、`login-form`、`i18n`、`permissionsCatalog`、`endpoints`、`(console)/layout`、`user-detail`、`users/page`、`permission-matrix`、`middleware`、`robots`、`docs/api.md`、`README.md`、`.env.example`、`docs/deployment-checklist.md`、`scripts/smoke.mjs`，以及桌面端 `src/lib/api/authBridge.ts` 与根 `src/lib/i18n.ts`（验证码的可读降级文案）。

**未做（按设计属 P1/P2 或明确非目标）**：桌面端 IPC 取码通道与控件（R11 的 P1 部分，本轮只交付可读降级，避免把未发版的客户端契约提前固定）、TOTP、短信、OAuth、音频验证码。

---

# 代码评审与收口（Subtask #3 最终评审 + 提交）

> 本节点对 Subtask #2 的工作树做逐条评审（对照 §4.1/§4.2/§8.2/§19/§24），修掉发现的问题后提交。
> 接手基线：`npx vitest run` = **35 files / 385 passed / 0 failed**（已绿），`npx tsc --noEmit` 与 `npx eslint . --max-warnings 0` 均退出 0。收尾基线：**35 files / 390 passed / 0 failed**。

## 评审结论

设计本体成立，§24 十入口全部装闸且可 grep 到 `authorityService.assertRankAbove` / `assertCanRevokeSessionsOf`；三条不变式有测试把守；验证码零依赖自研且输出不含答案。以下 14 条为本轮修掉的问题，均为**照设计写会错或写不出来**的地方，按 Constraints 不静默偏离。

## C-01（P0，已修）验证码答案长度写死 6，`captcha.length=7` 时答案无法输入

- **现象**：`captcha.length` 是设置项（4–7），签发时按它生成字符数；但 `captcha-field.tsx` 的输入框把 `maxLength` 写死为 `6`。运营把难度调到 7 后，用户看到 7 个字符却只能在框里放 6 个，**永远输不对**，且没有任何错误提示指向真正原因。
- **实现**：`IssuedCaptcha` 增加 `length` 字段随挑战下发，控件改为 `maxLength={issued?.length ?? 7}`；`captcha.test.ts` 的公开路由用例断言该字段等于当前设置值。未取到图时回退到 schema 上限 7（宁可放宽输入，也不截断）。

## C-02（P0，已修）`securityPostureService` 直接写 SQL，违反「SQL 只在 repositories」分层

- **现象**：态势服务里有 4 段裸 `db.prepare(...)`（角色分布、被拒权限 Top5、近期角色变更、不可信 IP 占比）。项目约定（`shared.ts` 模块注释与 spec §2.2 rule 3）明确 SQL 只允许出现在 `server/db/repositories/*`，service 只做编排。这会让人在仓储层 grep 不到真实查询，也让「哪些 SQL 动了表」无法审计。
- **实现**：新增 `rolesRepo.userCountsByRoleKey`、`auditRepo.topDeniedPermissions`、`auditRepo.recentRoleEvents`、`captchaRepo.untrustedIssueCounts` 四个仓储函数，服务改为调用；`securityPostureService` 不再 import `Db`/裸 SQL。

## C-03（P1，已修）设置面板缺少验证码参数组（§4.2 列为 P0 交付）

- **现象**：`captcha.length` / `captcha.ttlSeconds` / `captcha.maxAttempts` / `captcha.requiredOnLoginAfterFailures` 四个设置项已在服务端注册并生效，但 `settings-form.tsx` 既没有渲染也没有提交它们。结果是运营能改的只有数据库，界面完全看不到——正是 §4.2 点名的「四设置项」未接线。
- **实现**：新增「人机校验」分组（4 个数值输入，带范围提示），提交负载补齐四个键；分组文案明确写出「注册始终需要验证码，此开关不可关闭」，避免管理员四处找那个刻意不存在的开关。

## C-04（P1，已修）`publicMeta.captchaRequired` 缺失（§5.8 明确要求）

- **现象**：§5.8 要求 `/api/v1/meta` 追加 `captchaRequired: boolean`，让前端不必先撞一次 400 才知道要渲染控件；实现里没有该字段。
- **实现**：`publicMeta()` 返回 `captchaRequired: true`（注册强制且无运营开关，值恒真），并在类型注释里写明为何保留这个「看起来是常量」的字段。

## C-05（P1，已修）两处 `void` 假使用＝死代码

- **现象**：`securityPostureService` 里 `void now` 与 `void settingsService.getNumber('captcha.requiredOnLoginAfterFailures')` 只为消除未使用告警而存在，注释还声称「面板展示实际生效值」——实际什么都没展示。
- **实现**：`rootAdminPosture()` 去掉无用形参；`CaptchaPosture` 增加真实的 `loginThreshold` 字段并在态势卡片上以「登录升级阈值 / 从不要求」渲染。注释与行为一致了。

## C-06（P1，已修）批量吊销的 `denied` 未在界面透出

- **现象**：服务层 `revokeMany` 已按 AC-16g 把被拒会话记进 `denied` 并返回，路由也透传了，但前端 `sessionsApi.revokeMany` 的类型里没有 `denied`，`sessions-table` 只提示 `skipped`。运营踢不动某个账号时会看到「已吊销 N 个」而不知道另外几个为什么没动——等级闸在界面上等于隐形。
- **实现**：补类型、补 `admin.sessions.denied` 中英文案，批量结果里 `denied > 0` 时用 warning toast 明确写「目标账号等级不低于你」。

## C-07（P2，已修）用户详情页的角色下拉未按可授予性过滤（AC-22）

- **现象**：列表页已按 AC-22 用 `authorityService.grantableRoles` 过滤，但详情页 `admin/users/[id]/page.tsx` 仍然 `listRoles()` 全量下发；详情页打开的是同一个 `UserFormDialog`，于是同一个对话框在两个入口给出不同的可选项。
- **实现**：详情页复用同一过滤（与列表页同源谓词，服务端提交时仍再校验一次）。

## C-08（P2，已修）`DEFAULT_CUSTOM_ROLE_RANK` 定义后无人使用

- **现象**：常量在 `permissions.ts` 里定义并注明「新建角色用它」，但 `rolesRepo.create` 仍硬编码 `?? 20`。两处字面量正是漂移的起点。
- **实现**：`rolesRepo.create` 改为引用常量。

## C-09（P2，已修）根项目 `authBridge.ts` 注释被吞词

- **现象**：`webserver` 的验证码错误映射注释写成「A build without the captcha channel lands here.  is the honest answer」，中间缺主语，读起来像半句话。
- **实现**：补全为「A build released before the captcha channel lands here. "Update the app" is the honest answer…」。

## C-10（记录）评审中确认无需改动的判断

- `loginRequiresCaptcha` 与 `recordAttempt` 两侧都经 `rateKeyFor`（AC-09c / RV-8 成立，读写同源）。
- `confirmByAdmin` / `markEmailVerified` / PATCH email 分支 / 会话三端点的等级闸位置正确：都在**服务函数内、业务写入前**，批量逐条生效不中断。
- `revokeMany` 的 `actorUserId` 无默认值，`null` 只能来自显式系统调用（AC-19b 成立）。
- 匿名可访问面由 `publicSurface` 单点定义，`middleware` 的 `X-Robots-Tag` 与 `robots.ts` 共用 `NOINDEX_PREFIXES`（R-V3-04 已真正接线）。

## C-11（记录）本轮新增的验收覆盖

- `tests/integration/captcha.test.ts`：AC-09（签发 60 次后 429）、挑战携带 `length`。
- `tests/integration/posture.test.ts`（新文件）：AC-10（种子 `xdrshjr` + owner + `*`）、AC-11（`bootstrapPassword` 改密前后翻转）、AC-33（`admin` 200 / `member` 403）、根管理员地址脱敏、`loginThreshold` 取自实际设置。

## 门禁与提交

- `npx vitest run` → **35 files / 390 passed / 0 failed**
- `npx tsc --noEmit` → 退出 0
- `npx eslint . --max-warnings 0` → 退出 0
- 提交范围：仅本功能相关文件；`webserver/.tmp-vitest.json`（一次性的 vitest JSON 报告）、`.next/`、`data/` 等构建与临时产物不入库。

