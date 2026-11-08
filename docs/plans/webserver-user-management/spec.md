# Web Server 用户中心（webserver 子项目）— 完整设计方案

> Feature slug: `webserver-user-management`
> 文档版本: **v2**（Subtask #0 方案设计 → Subtask #1 设计评审修订）
> 作者: Solution Architect（Anthropic engineering）／评审: Senior Reviewer（Anthropic engineering）
> 交付物: `webserver/`（独立可部署的 Web 服务子项目）+ 桌面端登录联动契约
> 状态: Approved with conditions（见文末「评审结论」）
> 最后更新: 2026-10-08

**v2 修订摘要**：评审共记录 22 条问题（P0×4、P1×8、P2×10），全部 P0/P1 已在正文就地修正。最重的四条：刷新令牌重用检测在原 DDL 下**原理上不可实现**（§2.9.4 / §5.2）；限流阈值与锁定阈值相等导致 `423 account_locked` **永远不可达**（§4.6）；`?hard=true` 物理删除会被审计表外键**永久阻塞**（§5.2 DDL）；Next.js `instrumentation.ts` 会被 Edge 运行时编译，`better-sqlite3` 因此**构建失败**（§2.3）。这四条都属于"纸面上自洽、实现必炸"的问题，只有在写代码时才会暴露。

---

## 评审记录

> 评审方法：按章节逐条对照（可行性 / 完整性 / 一致性 / 规模适当性）。每条都给出一句话结论与处置；P0/P1 已在正文修正，P2 记录在案、按需处理。标注「实现验证」的条目，是在 `webserver/` 参考实现中真实复现后确认的，不是推演。

| ID | 维度 | 级别 | 问题 | 处置 |
|---|---|---|---|---|
| R-01 | 可行性 | **P0** | 刷新令牌重用检测不可实现：`sessions.refresh_token_hash` 每次轮换被覆盖，旧令牌的摘要随之消失，重放只能落到"未知令牌"分支，`auth.refresh_reuse_detected` 永远不会触发。 | 新增 `refresh_token_history` 表（只存 HMAC 摘要 + 保留期），轮换时把旧摘要写入历史链；命中历史即判定重用并撤销该用户全部会话。§2.9.4 / §5.2 已改。（实现验证） |
| R-02 | 一致性 | **P0** | 限流与锁定阈值自相矛盾：§2.9.6 与 §4.6 都规定 `login:identifier` 为 5 次/5 分钟，而 `LOGIN_MAX_ATTEMPTS` 默认也是 5 —— 第 5 次失败锁定账号，第 6 次请求先被限流器拦成 `429`，`423 account_locked` 在真实流量下**不可达**。 | 把 `login:identifier` 提到 12 次/5 分钟并写明理由：限流是粗粒度防洪，锁定才是凭证防线。§4.6 已改，边界测试已加。（实现验证） |
| R-03 | 完整性 | **P0** | `?hard=true` 物理删除必然失败：`audit_events.actor_user_id`、`registration_invites.created_by`、`password_reset_tokens.issued_by` 都是 `REFERENCES users(id)` 且默认 `NO ACTION`。任何执行过操作的账号都留着审计行，删除立刻 `FOREIGN KEY constraint failed`。§5.2 的注释还声称"物理删除会级联 sessions/password_reset_tokens"，与实际 DDL 不符。 | 三处外键改为 `ON DELETE SET NULL`（`created_by` / `issued_by` 同步改可空），并在 DDL 处写明这是硬删除的必要条件而非风格选择。§5.2 已改。（实现验证） |
| R-04 | 可行性 | **P0** | 启动钩子选错运行时：Next.js 会为 **Edge 运行时** 编译 `src/instrumentation.ts`，其模块图一旦引入 `better-sqlite3`（原生模块），`next build` 直接报 `Module not found: Can't resolve 'fs'`。§2.3 把"启动顺序"挂在 instrumentation 上，属于会阻断构建的方案。 | 改为**请求期惰性启动**：`ensureBooted()` 由根 layout 与统一路由包装器（`server/http/route.ts`）触发，原生依赖只进 Node 运行时；生产仍要求显式 `db:migrate`。§2.3 已重写。（实现验证） |
| R-05 | 完整性 | **P1** | 软删恢复缺少数据来源：§5.4 说恢复时"从 `audit_events` 最后一次 `user.delete` 的 metadata 取回原值"，但 §2.7 与 §5 从未要求 `user.delete` 事件**写入 email/username**。按原文实现，恢复时取到空值只能 500。 | 明确规定 `user.delete` 的 metadata **必须**含 `email` 与 `username`（归一化值），恢复时读取；若原邮箱已被占用返回 `email_taken`。§2.7 T3、§5.4 已改。（实现验证） |
| R-06 | 完整性 | **P1** | 施工图缺文件：§4.2 端点总表有 `POST /admin/users/{id}/restore`，§3.6 路由文件清单却没有对应的 `route.ts`。照 §3 施工会漏掉一个已承诺的端点。 | §3.6 补 `webserver/src/app/api/v1/admin/users/[id]/restore/route.ts`。（实现验证） |
| R-07 | 一致性 | **P1** | 排序参数与数据库列名不一致：§4.5 写 `sort=createdAt|-createdAt|lastLoginAt|...`（camelCase），而 §5.2 的列是 `created_at` / `last_login_at`。若实现按参数名直连 SQL 会报 `no such column`，若做映射则文档与实现两套命名。 | 统一为**数据库列名**白名单（`created_at|-created_at|email|-email|last_login_at|-last_login_at`），非白名单值回退默认（同时是注入护栏）。§4.5 已改。（实现验证） |
| R-08 | 一致性 | **P1** | AC-25 自相矛盾：同一条验收里既写"改邮箱与状态字段被忽略（返回 200 但值不变）"，又写"或 403 更严格实现——固定为：不在白名单，出现即 422"。三条互斥结论并列，验收无法判定。 | 固定为 **422**：`/me` 的 PATCH schema 使用 `.strict()`，管理员字段出现即校验失败。AC-25 与 §4.2 已改。（实现验证） |
| R-09 | 一致性 | **P1** | i18n 传参违反 RSC 约束：§3.11 只定义 `t()` / `useI18n()`，但没有约束"客户端组件不得接收翻译函数"。把 `tt` 当 prop 传给 `'use client'` 组件会在渲染期抛 `Functions cannot be passed directly to Client Components`——落地页与控制台**全部 500**。 | 明确规定：服务端组件传 `locale: 'zh-CN'|'en-US'`（可序列化），客户端组件内部 `const tt = translator(locale)`。§2.4 / §3.11 已改。（实现验证） |
| R-10 | 完整性 | **P1** | 带 Cookie 的登录请求未定义 CSRF 要求：§2.9.5 只说"Cookie 会话的写方法"，未点明 `/auth/login`、`/auth/logout`、`/auth/refresh` 在浏览器已持 Cookie 时也必须校验。漏掉会让会话固定（session fixation）防护出现缺口。 | §2.5 明确：这三个端点在**存在会话 Cookie 时**必须通过 CSRF 双提交校验；Bearer 请求豁免。登录接口分支持有 Cookie = 必须带 `X-CSRF-Token`。（实现验证） |
| R-11 | 完整性 | **P1** | 缺少"迁移文件必须进入 standalone 产物"的部署约束：`migrations/*.sql` 是运行时从磁盘读的，`output: standalone` 默认不会带上，镜像里会出现"启动即报 no migrations"。§7 风险表没有这条。 | 新增风险 R13 并给出对策 `outputFileTracingIncludes` + Dockerfile 显式 COPY；同时支持 `MIGRATIONS_DIR` 覆盖。（实现验证） |
| R-12 | 规模适当性 | **P1** | 阶段判据与验收不可执行：§3.13 阶段 0 的判据"`/` 渲染空白骨架页不报错"与 §2.8 九段落地页要求冲突；AC-05 给的校验命令 `grep -r "@/" webserver/src \| grep -v "webserver/src"` 恒为空（过滤条件把自身路径排掉），是永远不会失败的空断言。 | 阶段 0 判据改为"`/` 返回 200 且渲染 Navbar/Hero/Footer 骨架"；AC-05 改为按**别名根解析**校验（禁止 `require('../../src/...')` 与根 `@/*` 解析）+ 检查 `webserver/package.json` 未依赖根包。§3.13 / §6.3 已改。 |
| R-13 | 一致性 | **P2** | `AUTO_MIGRATE` 默认值表达含混（"dev 为 true、prod 为 false"）与 §5.5"生产拒绝启动并列出待执行版本"分散在两处。 | 合并到 §2.3 一处说明，并补"缺省解析规则：空值 = 按 NODE_ENV 推断"。 |
| R-14 | 完整性 | **P2** | 日志脱敏名单没有边界：若把 `code` 当敏感键，`error.code` 这类诊断字段会被打成 `[redacted]`，线上排障反而失去唯一线索；招聘制还会误伤 `inviteCode` 之外的正常字段。 | §2.9.11 明确敏感键**只**包含口令/令牌/会话/密钥类（`password*`、`token*`、`authorization`、`cookie`、`secret`、`inviteCode`），错误码必须可读。（实现验证） |
| R-15 | 性能 | **P2** | `users.email` 无索引：控制台搜索用 `email LIKE 'x%'`，UNIQUE 索引只覆盖 `email_normalized`，非归一化列会退化为扫描。 | §5.2 增加 `idx_users_email`。 |
| R-16 | 完整性 | **P2** | `PATCH /admin/users/{id}` 改角色时权限要求只写在端点表括注里（"另需 `roles.write`"），正文 §2.9.12 未重复，容易被实现遗漏。 | §2.9.12 增补：`roleId` 变更同时要求 `roles.write`，且不允许把他人提升为 `owner`。 |
| R-17 | 一致性 | **P2** | 时间显示口径不统一：§4.1 规定 ISO-8601，§5.4 规定入库 epoch 毫秒，但 §3.11 的 `lib/format.ts` 未说明"服务端只输出 ISO，客户端自行本地化"。 | §3.11 补一句：DTO 一律 ISO，相对时间只在客户端计算（避免 SSR/CSR 文本不一致导致 hydration 警告）。 |
| R-18 | 完整性 | **P2** | `POST /auth/password/change` 未定义"当前会话是否保留"的默认值：§2.7 T4/§3.10 `SecurityForm` 提到勾选项，端点表没写默认。 | 明确 `signOutOtherSessions` 默认 `false`，勾选后才撤销其他会话（当前会话永不撤销）。 |
| R-19 | 安全性 | **P2** | `/me/sessions/{id}` 对**他人会话**返回 404 的规则只在 §2.9.12 括注，端点表未写；实现容易顺手返回 403，泄露会话 id 存在性。 | §4.2 明确 404 语义并注明"403 会确认资源存在"。 |
| R-20 | 一致性 | **P2** | Cookie `Secure` 的判定口径写的是"production 时必须 Secure"，但本地用生产构建做验证（http）时会话根本写不进去，且 TLS 终止在 Nginx，Node 进程并不感知协议。 | 改为**从 `PUBLIC_BASE_URL` 的 scheme 推导**，比读 `NODE_ENV` 更贴近真实部署。（实现验证） |
| R-21 | 完整性 | **P2** | §4.4 错误码表列出 `payload_too_large`(413)，但正文从未定义请求体上限的**执行点**（只说 Nginx 兜底 1m）。 | §4.1 明确应用层 64 KB 上限在路由解析处强制执行，Nginx 只是外层兜底。 |
| R-22 | 文档 | **P2** | 缺少"最小可运行闭环"的冒烟清单：验收项 AC-01…AC-30 面向功能，但没有一条证明"服务起来后，注册→登录→建用户→封禁→审计"能真实跑通。 | §6.3 新增 AC-31：提供 `scripts/smoke.mjs` 对运行中的服务执行 46 项端到端断言（含 Cookie/CSRF/Bearer/重用检测/锁定）。 |

**评审中确认无误的关键决定**（保留不改）：scrypt 参数与存储格式、不引入 JWT、仓储层隔离 SQL、只做加法式迁移、单实例 SQLite 约束、`owner` 恒为 `*` 且不可通过 API 变更、Bearer 请求豁免 CSRF、找回口令恒 `202`。

---

## 1. Overview（概述）

Ecliptrix 目前是一个**完全单机的 Electron 桌面应用**：主进程拉起本地 FastAPI（SQLite）与 Next.js standalone 服务，全部绑定 `127.0.0.1`，没有用户系统、没有登录、没有 RBAC（见 `CLAUDE.md`「Key Conventions → No auth」与 `.claude-index/index.md`「Auth: none」）。业务数据的所有 `user_id` 恒等于 `LOCAL_OWNER_ID`。这意味着**每一次安装都是一个独立的、无法识别的副本**：运营方无法知道谁在用、无法回收某一台机器的使用权、无法把某个客户升级成"专业版"、也无法封禁滥用账号。

本方案新增一个**独立的、可部署到公网的服务端（Web Server）子项目**，落在仓库根目录的 `webserver/`（该目录当前已存在且为空）。它是桌面端用户的**外部身份源（external identity provider）**：提供注册、登录、会话签发与校验、账号与权限管理、审计与运营数据。它同时自带一个**面向最终用户与管理员的可视化网站**：访客看到 Supabase 风格的软件落地页（Landing Page），普通用户登录后只能查看／编辑自己的账号资料与设备会话，管理员登录后额外获得完整的用户管理后台（增删改查、角色与权限分配、邀请码、审计日志、系统设置、运营指标）。桌面端后续在启动时弹出登录界面，用户名密码交由该服务端验证；唯一的例外是一个**写死在本地配置文件里的最高权限账号 `admin / adminjr`**，它不经过网络、由本地常量时间比对放行，用于服务端不可达或管理员自锁时的"破窗（break-glass）"救援。

技术上，`webserver/` 是一个**与主仓库零耦合的独立 npm 子项目**：Next.js 15 App Router + TypeScript + React 19 + Tailwind 3 + shadcn/ui（new-york），SQLite（better-sqlite3，WAL）+ 手写迁移运行器 + 仓储层，认证用 Node 内置 `crypto` 的 scrypt 与不透明随机令牌（不做 JWT），一套 REST `/api/v1/*` 同时服务浏览器控制台与桌面端。它与根项目共享的只有**设计语言与代码风格**，不共享 `node_modules`、不 import 根项目任何模块、不修改根项目任何业务代码（本方案只在「§3 阶段 7」定义桌面端接入契约，供后续节点实施）。

本文件的目标是**让下游工程师无需再做任何决策**：技术栈、目录、文件清单、SQL DDL、REST 契约、错误码、限流规则、设计 token、测试用例与验收清单全部在此锁定。凡本文件已给出形如「必须／禁止／固定为」的表述，实现时不得替换为等价方案；凡标注「可延后」的能力，一律不进入本轮（1/3）交付范围。

---

## 2. Technical Design（技术设计）

### 2.1 定位与边界

| 维度 | 结论 |
|---|---|
| 子项目路径 | `webserver/`（根目录下，与 `desktop/`、`backend-services/` 平级） |
| 技术栈 | Node ≥ 20.11（本机 22.18）+ Next.js 15 App Router + TypeScript 5 + React 19 + Tailwind CSS 3 + shadcn/ui（new-york） |
| 数据库 | SQLite（`better-sqlite3`，`journal_mode=WAL`，`foreign_keys=ON`，`busy_timeout=5000`） |
| 认证 | 不透明随机令牌（opaque token），**禁止 JWT**；服务端存 `sha256` 哈希 |
| 口令 | scrypt（N=32768, r=8, p=1, keyLen=64），每用户 16 字节随机盐 |
| 会话载体 | Web：`HttpOnly` Cookie `ecs_session` + 双提交 CSRF Cookie `ecs_csrf`；桌面：`Authorization: Bearer <accessToken>` + body 中的 `refreshToken` |
| 多租户 | **不支持**（单租户单实例）。若未来需要横向扩展，换 PostgreSQL 即可，仓储层已隔离 SQL |
| 与根项目耦合 | 零。不得 import `@/*`（根 `src/`）、不得读写根 `package.json`、不得修改根业务代码 |
| 运行形态 | 一个 Node 进程（Next.js standalone），可 Docker 部署，前置 Nginx 终止 TLS |
| 首轮范围 | 落地页 + 登录/注册/改密/找回 + 账号中心 + 完整管理员后台 + REST v1 + 部署产物 + 测试 |
| 明确不做 | 支付/计费、邮件模板引擎、OAuth 第三方登录、WebAuthn、2FA（接口预留，见 §8.4）、多语言之外的第三语言、水平扩展/读写分离 |

### 2.2 架构总览

```
                        ┌──────────────────────── 公网 (Nginx / TLS) ────────────────────────┐
                        │  webserver/  (Next.js 15 standalone, 单进程, :8787)                 │
                        │                                                                    │
   浏览器 ─────────────▶│  src/middleware.ts        安全响应头 + 会话 Cookie 存在性快速重定向  │
   (访客/用户/管理员)    │        │                                                           │
                        │        ▼                                                           │
                        │  app/(marketing)/*        落地页、法务页（公开、SSR、可静态化）      │
                        │  app/(auth)/*             登录、注册、忘记/重置口令（公开）          │
                        │  app/(console)/account/*  账号中心（需登录，仅本人）                 │
                        │  app/(console)/admin/*    管理后台（需 permissions.* 权限）           │
                        │        │                                                           │
                        │        ├── Server Component：直接调用 services/*（不经 HTTP 自调用） │
                        │        └── Client Component mutation：fetch /api/v1/*               │
                        │                                                                    │
                        │  app/api/v1/**/route.ts   REST 边界：validate → guard → service     │
                        │        │                                                           │
                        │        ▼                                                           │
                        │  server/services/*       业务事务（auth/user/role/invite/audit/…）  │
                        │        │                                                           │
                        │        ▼                                                           │
                        │  server/db/repositories/*  prepared statements（唯一 SQL 出口）      │
                        │        │                                                           │
                        │        ▼                                                           │
                        │  data/webserver.db  (SQLite WAL)                                   │
                        └────────────────────────────────────────────────────────────────────┘
                                   ▲                                   ▲
                                   │ POST /api/v1/auth/login            │ 同左（Bearer）
                                   │ Authorization: Bearer …            │
                        ┌──────────┴──────────┐              ┌─────────┴──────────┐
                        │ Electron 桌面端      │              │ 第三方运维脚本/CLI  │
                        │ (后续节点接入)       │              │ (npm run user:*)    │
                        └─────────────────────┘              └────────────────────┘
```

**分层铁律（下游实现不得违反）**

1. `app/**/page.tsx`（Server Component）**只**调用 `server/services/*`，不 `fetch` 自己的 `/api/v1`（避免自调用、Cookie 丢失与无谓的 RTT）。
2. `app/api/v1/**/route.ts` 只做三件事：解析 + `zod` 校验 → 取会话与权限守卫 → 调 service 并用统一信封回包。**禁止**在 route 里写 SQL 或业务分支。
3. `server/services/*` 是唯一的事务边界，SQL 只出现在 `server/db/repositories/*`。
4. `src/middleware.ts` 运行在 Edge Runtime，**禁止**在此校验会话（better-sqlite3 是原生模块，Edge 不可用）。Middleware 只做：安全响应头、`/account`、`/admin` 的 Cookie 存在性快速跳转（"有 Cookie 才继续，无 Cookie 直接 302 /login"）。真实鉴权在 Server Component / Route Handler 内通过 `requireSession()` / `requirePermission()` 完成——这是**双重防线，第二道才是权威**。
5. 所有 mutation 由 Client Component 通过 `src/lib/api/client.ts` 调 REST，成功后 `router.refresh()`；禁止 Server Action 与 REST 混用同一业务动作（便于桌面端复用同一契约）。
6. `webserver/` 的 TS 路径别名固定为 `@/*` → `webserver/src/*`，与根项目写法一致但解析根不同（各自 `tsconfig.json`）。

### 2.3 运行时、配置与进程模型

`webserver/src/server/config.ts` 用 `zod` 解析一次性导出的 `config` 对象；**缺失必填项时打印全部错误并 `process.exit(1)`**（不允许静默降级——这是安全服务的底线）。

| 环境变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `NODE_ENV` | 否 | `development` | `production` 时 Cookie 必须 `Secure` 且关闭 dev 提示 |
| `PORT` | 否 | `8787` | 监听端口（与桌面端 3000/8000 不冲突） |
| `HOST` | 否 | `0.0.0.0` | Docker 内需 0.0.0.0；裸机建议 `127.0.0.1` + Nginx |
| `DATABASE_PATH` | 是 | — | 例 `./data/webserver.db`；目录自动创建 |
| `PUBLIC_BASE_URL` | 是 | — | 例 `https://id.ecliptrix.app`；用于 Cookies 域校验、邮件链接、CORS 默认值 |
| `SESSION_SECRET` | 是 | — | ≥ 32 字节随机串；用于 CSRF 与令牌指纹 HMAC 的密钥派生（`token 哈希 = sha256(HMAC(SESSION_SECRET, token))`，双重保险） |
| `CORS_ALLOWED_ORIGINS` | 否 | 空 | 逗号分隔；桌面端请求不带 Origin，故为空即可 |
| `ROOT_ADMIN_EMAIL` | 是 | — | 首次启动创建/提升的超级管理员邮箱 |
| `ROOT_ADMIN_PASSWORD` | 是 | — | 首个超级管理员口令；仅首次建号写入哈希，之后改 `RESET_ROOT_ADMIN_PASSWORD=1` 才覆盖 |
| `ROOT_ADMIN_USERNAME` | 否 | `admin` | 首个超级管理员用户名 |
| `RESET_ROOT_ADMIN_PASSWORD` | 否 | `false` | `true` 时启动强制把 root 管理员口令重置为 env 值（一次性，用后清空 env） |
| `REGISTRATION_ENABLED` | 否 | `true` | 全局注册开关（管理员可在后台改，DB 设置值优先于 env 初始值） |
| `INVITE_REQUIRED` | 否 | `false` | 注册必须邀请码 |
| `ACCESS_TOKEN_TTL_HOURS` | 否 | `12` | Web 与桌面共用（桌面端由 §2.6 的离线宽限兜底） |
| `REFRESH_TOKEN_TTL_DAYS` | 否 | `30` | Web 刷新令牌 |
| `DESKTOP_REFRESH_TOKEN_TTL_DAYS` | 否 | `90` | 桌面端长期刷新令牌 |
| `LOGIN_MAX_ATTEMPTS` | 否 | `5` | 同一 identifier+IP 的失败阈值 |
| `LOGIN_LOCK_MINUTES` | 否 | `15` | 首次锁定时长，指数退避至 24h 上限 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | 否 | 空 | 全空即"邮件禁用"模式：自助找回关闭，改由管理员后台签发一次性重置码（§2.10） |
| `TRUST_PROXY` | 否 | `true` | 读取 `X-Forwarded-For` 第一个地址作为客户端 IP |
| `LOG_LEVEL` | 否 | `info` | `debug｜info｜warn｜error` |
| `AUTO_MIGRATE` | 否 | dev 为 `true`、prod 为 `false` | 启动自动跑迁移；prod 建议 CI 里显式 `npm run db:migrate` |

启动顺序（**请求期惰性启动**，不再挂在 Next.js `instrumentation.ts` 上——见评审记录 R-04：该文件会被 Edge 运行时编译，引入 `better-sqlite3` 会直接让 `next build` 失败）：

`server/boot.ts#ensureBooted()` 是唯一入口，由两处触发，且每进程只执行一次：

1. 根布局 `src/app/layout.tsx`（页面渲染路径，保证直接访问 `/admin` 也会启动）；
2. 统一路由包装器 `src/server/http/route.ts#withContext()`（API 路径）。

执行内容与失败策略：

1. 解析 config（失败即 `process.exit(1)`，并打印全部问题）。
2. 打开 SQLite、执行 `PRAGMA`（`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`）。
3. `AUTO_MIGRATE` 为真则跑迁移；否则检测到未应用迁移时**拒绝启动**并打印待执行版本号（防止 schema 漂移）。`AUTO_MIGRATE` 缺省解析规则：空值 = `NODE_ENV !== 'production'`。
4. `seedBaseData()`：幂等写入 4 个系统角色 + 权限矩阵 + `app_settings` 默认值（`INSERT ... ON CONFLICT DO NOTHING`，绝不覆盖管理员改过的值）。
5. `ensureRootAdmin()`：按 env 创建/提升 `ROOT_ADMIN_EMAIL` 为 `owner` 角色；口令哈希缺失或 `RESET_ROOT_ADMIN_PASSWORD=true` 时写入 env 口令；**永不**在日志打印口令。
6. 打印 `ready` 摘要（端口、DB 路径、root 邮箱、注册开关），**不打印**任何秘密。

`next build` 期间（`NEXT_PHASE === 'phase-production-build'`）跳过整个启动序列：构建机没有数据库，也不该有。

CLI（`scripts/*.ts`）不经过该入口，自行 `loadDotEnv()` + 直接调用 `openDatabase()`/`runMigrations()`。

### 2.4 关键代码路径与既有锚点

本子项目为全新目录，不存在"改既有文件"；此表列出**实现必须对齐的仓库既有约定**及其出处，供实现者核对而不必自行推断。

| 约定 | 仓库锚点 | 在 webserver 中的落地 |
|---|---|---|
| 响应信封包含 `success/message/timestamp/data` | `backend-services/basic-service/app/models`（`BaseResponse`）与 `CLAUDE.md`「Backend error responses」 | `server/http/envelope.ts` 的 `ok()` / `fail()` 产出同名结构 |
| 错误结构含 `error_code` 语义 | 同上（`ErrorResponse`） | 统一错误体 `error: { code, message, details? }`，`code` 用 §4.4 的稳定枚举 |
| ESLint：`prefer-const: error`、`no-explicit-any: warn` | `CLAUDE.md`「Key Conventions」 | webserver 独立 ESLint 配置沿用同两条 + `@typescript-eslint/no-floating-promises: error` |
| 文件 ≤ 800 行、函数 ≤ 50 行、参数 ≤ 5、圈复杂度 ≤ 10、行宽 80 | `CLAUDE.md`「Clean Code Guidelines §2」 | 所有 service 按"一函数一职责"拆分；参数超 5 个改用 options 对象 |
| 错误显式传播、边界只验证一次 | `CLAUDE.md`「§5 Error handling」 | zod 只在 route 边界校验；service 内信任已校验输入，失败抛 `AppError` |
| 新功能必须有计划文档 | `docs/plans/<slug>/spec.md` 惯例（74 个同级目录） | 本文件 |
| i18n 单文件大表 | `src/lib/i18n.ts`（根项目，约 10.8k 行） | webserver 采用**分文件** `lib/i18n/{zh-CN,en-US}.ts`（子项目独立，避免 10k 行单文件拖慢构建），键名规则见 §8.1。合并示例（JSONL，v1 未作要求，**v2 起必选**）：见风险评估 R-14。 |
| **RSC 传参约束（v2 新增）** | React 19 Server Components 序列化规则 | `'use client'` 组件**禁止**接收函数型 prop（`tt`）。服务端组件传 `locale: Locale`，客户端组件内部 `const tt = translator(locale)`。违反会在渲染期抛 `Functions cannot be passed directly to Client Components`，整个页面 500（评审记录 R-09，实现中真实触发过）。 |
| 设计语言：shadcn new-york + Tailwind class dark mode + CSS 变量 | `components.json`、`tailwind.config.js`（根） | 复制同样的 `darkMode: ["class"]` 与 CSS 变量策略，但**色板独立**（§2.9） |
| 已有 `docs/plans/desktop-root-admin-login-gate/spec.md` 规划过桌面登录闸门但**未实现**（仓库内无 `AuthContext`、无 `ROOT_USERNAME` env） | `src/contexts/`（仅 Locale/Notification）、`grep ROOT_USERNAME` 无命中 | 本方案的桌面端接入以**现状（无任何登录代码）**为起点重新定义，不复用该未落地方案的假设；该文档可作为背景参考 |

### 2.5 全局请求生命周期

```
请求 ──▶ middleware.ts
   ├─ 注入安全响应头（CSP / HSTS / X-Frame-Options / Referrer-Policy / X-Content-Type-Options）
   ├─ 生成或复用 request-id（转发到 handler 的 requestContext）
   └─ 路径以 /account、/admin 开头且无 ecs_session Cookie → 302 /login?next=<path>

请求 ──▶ route handler（app/api/v1/**/route.ts）
   1. requestContext()：解析 IP（TRUST_PROXY）、UA、request-id、Origin、CSRF 头与 Cookie
   2. ensureBooted()：首次请求触发启动序列（§2.3）
   3. zod 校验 body/query（失败 → 422 validation_failed + details）
   4. 可选：rateLimit(scope, key)（登录/注册/找回/管理写操作）
   5. requireSession() / requirePermission(perm) → 失败 401/403
   6. CSRF 校验（仅 Cookie 会话的写方法：POST/PATCH/PUT/DELETE）
      —— v2 新增（R-10）：/auth/login、/auth/logout、/auth/refresh 在请求
         已携带 ecs_session Cookie 时同样必须校验。浏览器持有会话 Cookie 的
         登录请求是会话固定（session fixation）的入口，必须带 X-CSRF-Token；
         Bearer 请求与无 Cookie 的桌面登录豁免（无 Cookie 即无 CSRF 面）。
   7. 调 service（内部开事务；写成功后必须 audit()）
   8. ok(data) → 统一信封 + Set-Cookie（如需）
任何抛出：AppError → 对应状态码；未知错误 → 500 internal_error + 日志（含 request-id，
           不回显堆栈/内部路径）
```

### 2.6 桌面端登录联动设计（本方案的对外核心价值）

桌面端存在**两种登录形态**，二者互不替代：

- **形态 A｜网络登录（普通用户，唯一合法路径）**：用户在登录界面输入邮箱/用户名 + 口令 → 桌面端 `POST {PUBLIC_BASE_URL}/api/v1/auth/login`，body `{ identifier, password, client: "desktop", device: { name, platform, appVersion } }` → 服务端校验、建会话、回 `{ accessToken, refreshToken, expiresAt, user }`。桌面端把会话写入 `userData/auth-session.json`（Electron `safeStorage` 加密；不可用时降级为明文并写审计告警），随后所有对服务端的请求带 `Authorization: Bearer`。桌面端**不把口令落盘**。
- **形态 B｜本地破窗登录（最高权限，无网络）**：用户名口令写死在本地配置文件（`userData/desktop-config.json` 的 `localAdmin: { "username": "admin", "password": "adminjr" }`，首启由 `desktop/main/config.js#initUserData` 从模板写入）。渲染进程不得直接读该值：必须经 `ipcRenderer.invoke('auth:local-verify', { username, password })` → 主进程用 `crypto.timingSafeEqual` 比对，成功返回 `{ source: "local-root", role: "owner", permissions: ["*"] }`，**不发任何网络请求**，本地失败计数（5 次/5 分钟）与审计写 `logs/auth.log`。该账号**不可被服务端吊销**（它不在服务端存在），这正是它的设计目的；README 必须显式声明这一点及修改方式。

**校验与降级规则（固定策略，实现不得改动）**

| 场景 | 行为 |
|---|---|
| 服务端可达 + 凭证正确 | 正常登录，`source: "server"`，本地缓存 `lastVerifiedAt` |
| 服务端可达 + 凭证错误 | 401 `invalid_credentials`，统一文案（不区分"用户不存在/口令错误"，防枚举） |
| 服务端不可达（DNS/超时/5xx） | 若本地存在未过期且 `lastVerifiedAt` 在**离线宽限期 7 天**内的服务端会话 → 允许进入应用并显示"离线模式"角标（`source: "offline-cache"`）；否则登录界面显示"无法连接账号服务器" + 重试 + "使用本地管理员登录"入口 |
| 本地 `lastVerifiedAt` 超宽限期 | 必须联网重新验证（`source: "server"`），否则只能走形态 B |
| 服务端返回 403 `account_suspended` | 桌面端强制登出、清除本地会话、显示封禁提示与申诉方式，**不允许**用形态 B 绕过（形态 B 是设备救援，不是账号恢复：不加载该用户的云端数据） |

**会话撤销传播**：管理员在后台"踢下线"后，服务端把 `sessions.revoked_at` 置位；桌面端每次启动 + 每 15 分钟心跳（`POST /api/v1/auth/heartbeat`，Bearer）都会拿到 401 `session_revoked`，随即清本地会话并回到登录界面。心跳失败但离线宽限未过期时**不**登出（避免网络抖动误伤）。

**桌面端接入的完整文件契约见 §3 阶段 7**（本轮只产出契约与接口，不改根项目代码）。

### 2.7 关键时序

**T1｜Web 登录（管理员）**

```
1. GET /login                        → 渲染 AuthShell + LoginForm（无会话）
2. 用户提交                          → POST /api/v1/auth/login {identifier,password,client:"web"}
3. route: zod → rateLimit(login) → authService.login()
4. authService: 按 email_normalized/username_normalized 查用户
      ├─ 不存在 → 记 login_attempts(success=0,reason=unknown_identifier) → AppError 401 invalid_credentials
      ├─ locked_until > now → 423 account_locked（附 retryAfter 秒）
      ├─ status=suspended/deleted → 403 account_suspended / 401 invalid_credentials(不泄露存在性)
      └─ scrypt 校验（timingSafeEqual）
            ├─ 失败 → failed_login_count+1，达阈值写 locked_until → 401
            └─ 成功 → 清零计数；如哈希参数过旧则就地 rehash
5. sessionService.create({client:'web'}) → access+refresh 明文令牌一次性下发，
   库里只存 sha256(HMAC(SESSION_SECRET, token))
6. 回包：Set-Cookie ecs_session（HttpOnly, SameSite=Lax, Secure in prod, Path=/, Max-Age=TTL）
          Set-Cookie ecs_csrf（非 HttpOnly，供 JS 读取双提交）
          body: { user, expiresAt }
7. audit(action='auth.login', actor=user) → 302 由前端 router.push('/admin' 或 '/account')
```

**T2｜注册（含开关与邀请码）**

```
POST /api/v1/auth/register { email, password, username?, displayName?, inviteCode?, client }
1. settings.registration.enabled=false → 403 registration_disabled
2. settings.invite.required=true 且无/错 inviteCode → 403 invite_required | invite_invalid
3. 校验：email 格式与长度≤254、口令策略（§2.10）、username 规则 ^[a-zA-Z0-9_.-]{3,32}$
4. email_normalized/username_normalized 唯一冲突 → 409 email_taken | username_taken
5. 创建用户 status='active'（若开启邮箱验证则 'pending' 且不可登录），role=邀请码指定角色或 'member'
6. 邀请码 used_count+1（同一事务；超 max_uses → 409 invite_exhausted）
7. audit(action='user.register') → 自动登录（等同 T1 的 5~6 步）
```

**T3｜管理员停用用户（会话即时失效）**

```
PATCH /api/v1/admin/users/:id { status: "suspended" }（需 users.write）
1. 禁止把 owner 角色用户降级/停用（409 cannot_modify_owner），禁止自我停用
2. 事务内：users.status='suspended', updated_at=now
3. sessionService.revokeAllForUser(id, reason='suspended')
4. audit(action='user.suspend', target=id, metadata={before:{status},after:{status}})
   —— 若是软删除，metadata 还必须写入原 email 与 username（v2，R-05：恢复时唯一来源）
5. 目标用户下一个请求 → 401 session_revoked；桌面端回到登录界面并提示封禁
```

**T4｜管理员改密（无邮件模式）**

```
POST /api/v1/admin/users/:id/password-reset  { mode: "temp_password" | "reset_link" }
   mode=temp_password → 生成 16 字符高熵临时口令，返回一次（响应体 + 后台可复制），
                        并置 users.password_hash=scrypt(temp)、must_change_password=1
   mode=reset_link    → 仅当 SMTP 配置存在；写 password_reset_tokens(expires 60min) 并发信
目标用户登录后若 must_change_password=1 → 强制跳 /account/security 改密（其他路由 403 password_change_required）
```

**T5｜账号中心自助（普通用户）**

```
GET /account           → 资料卡（只读 email/username + 可改 displayName/avatarUrl/时区/语言）
GET /account/security  → 改密表单 + 我的设备列表（GET /api/v1/me/sessions）
DELETE /api/v1/me/sessions/:id → 撤销某设备（不能撤销当前会话以外的"未知会话"以外的任何他人会话）
GET /account/activity  → 本人近 90 天审计事件（action 白名单，只读）
普通用户访问 /admin/*  → middleware 放行（有 Cookie），Server Component requirePermission 失败 →
                        渲染 403 页面（不 404，避免误导），并记录 audit(action='authz.denied')
```

**T6｜桌面端离线宽限与破窗**

```
启动 → 读 userData/auth-session.json
  ├─ 无 → LoginScreen（两个入口：账号服务器登录 / 本地管理员登录）
  ├─ 有 → 试 POST /api/v1/auth/heartbeat (Bearer, 5s 超时)
  │     ├─ 200 → 进入应用（source:'server'，刷新 lastVerifiedAt）
  │     ├─ 401 revoked/suspended → 清会话 → LoginScreen(带原因)
  │     └─ 网络错误 → now - lastVerifiedAt ≤ 7d ? 进入应用(离线角标) : LoginScreen(需联网)
  └─ 用户点"本地管理员登录" → IPC auth:local-verify → 常量时间比对配置 → owner 权限进入
```

### 2.8 设计系统（Supabase 风格，固定 token）

主题：**深色为默认**，可切浅色；整体像 Supabase 控制台——近黑底、极细边框、单点高饱和强调色、等宽字体展示 ID/令牌、几乎不用阴影、留白克制、动效短促。

**色板（`globals.css` 的 CSS 变量 + `tailwind.config.ts` 映射）**

| Token | 深色值 | 浅色值 | 用途 |
|---|---|---|---|
| `--background` | `#0b0b0c` | `#ffffff` | 页面底色 |
| `--surface` | `#121214` | `#f7f7f8` | 卡片/面板 |
| `--surface-2` | `#18181b` | `#efeff1` | 表格斑马纹、输入框 |
| `--border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.08)` | 1px 分隔线 |
| `--border-strong` | `rgba(255,255,255,0.16)` | `rgba(0,0,0,0.16)` | hover/聚焦边框 |
| `--foreground` | `#ededed` | `#161616` | 正文 |
| `--muted` | `#9a9a9e` | `#6b6b70` | 次要文字 |
| `--accent` | `#3ecf8e` | `#24b47e` | Supabase 绿：主按钮、选中态、成功 |
| `--accent-fg` | `#06231a` | `#ffffff` | 强调色上的文字 |
| `--danger` | `#f87171` | `#dc2626` | 危险操作、封禁 |
| `--warning` | `#fbbf24` | `#d97706` | 待处理、锁定提示 |
| `--info` | `#60a5fa` | `#2563eb` | 提示、链接 hover |

**字体与排版**：`Inter`（`next/font/local` 或 `next/font/google` 二选一，离线优先本地）+ 中文回退 `"Noto Sans SC", system-ui`；等宽 `ui-monospace, SFMono-Regular, "JetBrains Mono", monospace` 用于 token、ID、SQL 片段。字号刻度 `12 / 13 / 14 / 16 / 20 / 24 / 32 / 44`，行高正文 `1.6`、标题 `1.15`；字距：标题 `-0.02em`。**禁止**使用超过 3 种字号在同一屏幕区块。

**间距与形状**：4px 基准的 8 栅格（`4/8/12/16/24/32/48/64/96`）；圆角 `sm=6px`（输入/按钮）、`md=8px`（卡片）、`lg=12px`（弹层）；阴影仅在浮层（`0 8px 30px rgba(0,0,0,.35)`）；边框统一 1px。

**动效**：`--ease: cubic-bezier(0.16, 1, 0.3, 1)`；页面进场 `160ms`，弹层 `200ms`，列表行 hover `90ms`；`prefers-reduced-motion: reduce` 时全部降为 `0ms` 并移除位移。禁止无限循环装饰动画（除加载 skeleton 的 shimmer）。

**组件形态要点**（shadcn 定制，`src/components/ui/*`）

- Button：`h-9`，`px-3.5`，`text-[13px]`，`rounded-sm`；primary=实心 accent，secondary=1px 边框透明底，ghost=纯文字；loading 时左置 14px spinner 并禁用。
- Input/Select：`h-9`，底色 `surface-2`，聚焦 `ring-1 ring-accent/60 + border-strong`，错误态 `border-danger` + 下方 12px 红字（**不用** toast 报告字段错误）。
- Table：粘性表头、`text-[13px]`、行高 44px、hover 高亮、列右对齐数字、空态插画+一句说明+主操作。
- Dialog/Sheet：右上角 ✕，Esc 关闭，焦点陷阱，关闭后焦点回归触发元素；危险操作必须输入资源名或二次确认（`ConfirmDialog variant="danger"`）。
- Badge：角色/状态用低饱和描边徽章（`owner=紫`、`admin=绿`、`support=蓝`、`member=灰`；`active=绿`、`suspended=红`、`pending=黄`）。
- Toast：右下角堆叠，4s 自动消失，`role="status"`；失败用 `role="alert"`。
- 顶栏：左侧面包屑、右侧命令面板触发（`⌘K` / `Ctrl+K`）、主题切换、用户菜单。

**品牌与落地页内容结构**（`app/(marketing)/page.tsx`）

1. Navbar：Logo（SVG `Ecliptrix` 字标）+ 产品/功能/定价/文档 + 右侧「登录」「下载桌面端」。
2. Hero：`h1` 一句话价值主张（"Where light and shadow collide"），副标题一段，双 CTA（主：下载 for macOS/Windows；次：打开控制台），下方产品截图（`/public/showcase/editor.png`）带 1px 边框与轻微透视，背景径向渐变 + 网格纹理（纯 CSS，不用图片）。
3. `FeatureGrid`（6 张卡，图标线性 20px）：AI 剪辑、多轨时间线、语音合成、素材库、封面工作室、团队账号与权限。
4. `ShowcaseMock`：三段交替左图右文（时间线 / 语音 / 权限后台），呼应"顶级产品"叙事。
5. `PermissionsSection`：把管理后台能力商品化呈现（角色矩阵示意）。
6. `PricingCards`（3 档：Free / Pro / Studio）——纯展示文案，无支付。
7. `Faq`（6 条，`<details>` 语义化折叠）。
8. `Footer`：产品/资源/法务三列 + 版权 + 服务状态点（静态"All systems normal"）。
9. 顶部右侧在已登录时把「登录」换成「控制台 →」。

**SEO / 可访问性**：`app/(marketing)/opengraph-image.tsx` 用 `next/og` 生成动态 OG；`sitemap.ts`、`robots.ts`；全站单一 `h1`；交互元素 ≥ 44×44 命中区；对比度 ≥ 4.5:1；全键盘可达；所有图标按钮有 `aria-label`；表单 `label` 关联 + `aria-describedby` 错误说明。

### 2.9 安全设计（逐项固定）

1. **口令哈希**：`scrypt(password, salt, 64, {N:32768, r:8, p:1, maxmem:64*1024*1024})`；存储格式 `scrypt$32768$8$1$<saltB64>$<hashB64>`；校验用 `timingSafeEqual`；登录成功且参数低于当前标准时就地 rehash。口令先 `password.normalize('NFKC')`，长度按**字节**计上限 128。
2. **口令策略**：≥ 10 且 ≤ 128 字符；不等于 email/username（不区分大小写）及其常见变体（去掉非字母数字后比较）；不在内置弱口令表（`server/auth/weakPasswords.ts`，约 500 条常见口令）；**不**强制大小写/符号组合（NIST 800-63B）。
3. **令牌**：`crypto.randomBytes(32).toString('base64url')` 生成；明文仅在创建响应中出现一次；库里存 `sha256(HMAC-SHA256(SESSION_SECRET, token))`（即使 DB 泄露也无法直接使用）。访问令牌与刷新令牌**配对**（`sessions.access_token_hash` / `refresh_token_hash`）。
4. **刷新轮换**：`POST /api/v1/auth/refresh` 成功后旧刷新令牌立即作废并换新。**重用检测（v2 修正，R-01）**：轮换时把旧的 `refresh_token_hash` 写入 `refresh_token_history`（只存 HMAC 摘要，保留 90 天）；若收到的刷新令牌只在历史链中命中，说明同一令牌被两方持有 → 撤销该用户全部会话、写 `refresh_token_reuse_events`、audit `auth.refresh_reuse_detected`。**不得**依赖"覆盖后的 `sessions.refresh_token_hash` 认不出旧值"来实现该功能——那样永远检测不到。
5. **CSRF**：Cookie 会话的所有写请求必须带 `X-CSRF-Token`，值与 `ecs_csrf` Cookie 一致；Bearer 请求豁免（无 Cookie 即无 CSRF）。`SameSite=Lax`。**v2 补充（R-10）**：`/auth/login`、`/auth/logout`、`/auth/refresh` 在请求携带会话 Cookie 时同样校验。刷新 Cookie 单独限定 `Path=/api/v1/auth`，避免跟随每一次页面请求。
6. **限流**：进程内滑动窗口（`server/auth/rateLimit.ts`，`Map` + 定时清理，单实例足够）：`login` 20 次/5 分钟/IP 与 **12 次/5 分钟/identifier**；`register` 10 次/小时/IP；`password_reset` 3 次/小时/IP；`admin_write` 120 次/分钟/用户；`heartbeat` 60 次/小时/会话。超限 `429 rate_limited` + `Retry-After`。**v2 修正（R-02）**：identifier 限额必须**严格大于** `LOGIN_MAX_ATTEMPTS`（默认 5），否则第 5 次失败锁定账号、第 6 次请求先被限流器 429 拦下，`423 account_locked` 永远不可达。限流是粗粒度防洪，锁定才是凭证防线。
7. **账户锁定**：连续失败达 `LOGIN_MAX_ATTEMPTS` → `locked_until = now + LOGIN_LOCK_MINUTES × 2^(lockCount-1)`，上限 24h；管理员可在后台"解锁"。
8. **防枚举**：登录失败统一 `invalid_credentials`；注册冲突**必须**报 `email_taken`（否则无法注册），但找回口令接口恒返回 `202 pending`；响应时间对不存在用户也执行一次假哈希（防时序侧信道）。
9. **审计**：所有写操作、所有登录尝试、所有鉴权拒绝都写 `audit_events`（`metadata` 里存 before/after 的**非敏感**字段差异，绝不存口令/令牌）。
10. **安全头**（middleware 注入）：`Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'（prod）；frame-ancestors 'none'; base-uri 'none'; form-action 'self'`、`Strict-Transport-Security: max-age=31536000; includeSubDomains`（仅 prod HTTPS）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`、`Permissions-Policy: geolocation=(), microphone=(), camera=()`。
11. **日志脱敏**：`server/http/requestContext.ts` 提供 `redact()`；口令、令牌、`authorization`、`cookie`、`secret`、`inviteCode` 一律 `[redacted]`；生产不记录 body。**v2 澄清（R-14）**：`code` / `error_code` **不得**进入脱敏名单——它是线上排障的唯一线索，把错误码打成 `[redacted]` 等于自毁证据链。脱敏按**键名**匹配，不按键值猜测。
12. **越权防护**：所有按 id 的操作在 service 内二次校验归属（`/me/sessions/:id` 必须 `session.user_id === session.user.id`）；`role_id` 变更要求 `roles.write`（v2 补，R-16：同时禁止把其他用户提升为 `owner`）；`owner` 角色对任何用户（含自己）都不可通过 API 变更/删除，只能由 CLI 操作。
13. **Owner 保护**：管理员不能停用/降级/删除 `owner` 角色用户；不能删除自己；系统角色（`is_system=1`）不可删除，权限矩阵中 `owner` 恒为 `*`。

### 2.10 邮件与找回（可选能力）

SMTP 未配置时：`/forgot-password` 页面显示"请联系管理员重置口令"，接口 `POST /api/v1/auth/password/reset/request` 仍返回 `202`（不泄露配置状态）。SMTP 配置后：`server/mail/mailer.ts` 用 `nodemailer` 发纯文本 + 极简 HTML 邮件（重置链接指向 `{PUBLIC_BASE_URL}/reset-password?token=…`，60 分钟有效，一次性）。邮件失败不得影响 API 语义（异步发、失败记 `audit` 与日志）。

### 2.11 可观测性与运维

- `GET /api/v1/health` → `{ status: "ok", uptimeSeconds, version }`（不触库）；`GET /api/v1/ready` → 触库 `SELECT 1` 并检查迁移已应用。
- 结构化日志：单行 JSON `{ ts, level, requestId, msg, ...fields }` 写 stdout（容器友好）。
- 指标页：`/admin` 概览由 `metricsService` 聚合（用户总数、7 日活跃、今日新增、活跃会话数、近 14 天注册趋势 sparkline、失败登录 TOP5），SQL 全部走索引。
- 备份：`webserver/scripts/backup.sh`（`sqlite3 data/webserver.db ".backup data/backup-$(date).db"`）+ cron 示例。
- 升级：`npm run db:migrate` 幂等；每个迁移在**单事务**内执行并写 `schema_migrations`；失败整体回滚并退出非 0。

### 2.12 部署

- `webserver/Dockerfile`（多阶段）：`node:22-alpine` builder 装 devDeps 构建 → 运行镜像只带 `.next/standalone`、`node_modules` 生产依赖、`public`、`migrations`；`USER node`；`HEALTHCHECK` 打 `/api/v1/health`。
- `webserver/docker-compose.yml`：单服务 + 卷 `./data:/app/data` + `env_file: .env`；`restart: unless-stopped`。
- `webserver/deploy/nginx.conf.example`：80→443 跳转、TLS 1.2+/HTTP2、`proxy_set_header X-Forwarded-For $remote_addr`、`client_max_body_size 1m`、静态缓存、`proxy_read_timeout 30s`。
- `webserver/deploy/webserver.service`（systemd）：`EnvironmentFile`、`Restart=always`、`NoNewPrivileges=true`、`ProtectSystem=strict` + `ReadWritePaths=/opt/webserver/data`。
- 单实例约束：SQLite WAL 只允许**一个写入进程**；需要多副本时必须换 PostgreSQL（不在本轮）。

---

## 3. File / Module Change Plan（文件与模块变更计划）

以下为 `webserver/` 内**全部**需要创建的文件。除最后一行（本文件）外，**本轮不创建任何代码文件**；本表是下游实现的施工图。"阶段"列对应 §3.13 的实施顺序。

### 3.1 项目根与配置（阶段 0）

| 文件 | 意图 | 阶段 |
|---|---|---|
| `webserver/package.json` | 子项目清单与脚本：`dev`、`build`、`start`、`lint`、`type-check`、`test`、`test:watch`、`db:migrate`、`db:backup`、`user:create`、`user:reset`、`seed:demo`；依赖见 §3.14 | 0 |
| `webserver/.env.example` | §2.3 全部环境变量的注释化模板（`SESSION_SECRET` 写 `change-me-...` 占位并注明生成命令） | 0 |
| `webserver/.gitignore` | `node_modules/`、`.next/`、`data/`、`.env`、`coverage/`、`*.db*` | 0 |
| `webserver/tsconfig.json` | `strict: true`、`noUncheckedIndexedAccess: true`、`paths { "@/*": ["./src/*"] }`、`target ES2022`、`moduleResolution bundler` | 0 |
| `webserver/next.config.mjs` | `output: 'standalone'`、`experimental.serverComponentsExternalPackages: ['better-sqlite3']`、`poweredByHeader: false`、`outputFileTracingIncludes` 带上 migrations | 0 |
| `webserver/tailwind.config.ts` | `darkMode: ['class']`、§2.8 色板 CSS 变量映射、`content` 覆盖 `src/**` | 0 |
| `webserver/postcss.config.mjs` | tailwindcss + autoprefixer | 0 |
| `webserver/eslint.config.mjs` | flat config：`next/core-web-vitals` + `prefer-const: error`、`no-explicit-any: warn`、`no-floating-promises: error` | 0 |
| `webserver/vitest.config.ts` | node 环境 + `setupFiles`（临时 DB 工厂）+ 覆盖率阈值行 80% | 0 |
| `webserver/components.json` | shadcn 配置：style `new-york`、rsc true、别名指向 `@/components` | 0 |
| `webserver/README.md` | 快速开始、环境变量、Docker 部署、CLI 用法、**破窗账号说明与修改方法**、安全须知 | 0 |
| `webserver/docs/desktop-integration.md` | 桌面端接入契约（端点、令牌存储、离线宽限、错误映射、时序图） | 7 |
| `webserver/docs/api.md` | 由 §4 展开的对外 API 文档（含 curl 示例） | 7 |

### 3.2 数据层（阶段 1）

| 文件 | 意图 | 阶段 |
|---|---|---|
| `webserver/src/server/db/client.ts` | 单例 `Database` 打开 + PRAGMA + `closeForTests()` | 1 |
| `webserver/src/server/db/migrate.ts` | 迁移运行器：读 `migrations/*.sql` 按版本号排序、事务执行、写 `schema_migrations`、`pendingMigrations()` | 1 |
| `webserver/src/server/db/migrations/0001_init.sql` | §5 全部 DDL + 索引 | 1 |
| `webserver/src/server/db/migrations/0002_seed_roles.sql` | 系统角色与权限矩阵种子（幂等 `INSERT OR IGNORE`） | 1 |
| `webserver/src/server/db/repositories/usersRepo.ts` | `findById/findByEmailOrUsername/list(filter)/create/update/softDelete/hardDelete/countByStatus/bumpFailedLogin/clearFailedLogin/setLockedUntil` | 1 |
| `webserver/src/server/db/repositories/rolesRepo.ts` | 角色 CRUD + `permissionsFor(roleId)` + `replacePermissions` | 1 |
| `webserver/src/server/db/repositories/sessionsRepo.ts` | `create/findByAccessHash/findByRefreshHash/touch/revokeOne/revokeAllForUser/listForUser/listActive` | 1 |
| `webserver/src/server/db/repositories/invitesRepo.ts` | 邀请码 CRUD + `consume(codeHash)`（原子 `used_count+1`） | 1 |
| `webserver/src/server/db/repositories/auditRepo.ts` | `insert`、`list(filter, page)`、`listForUser` | 1 |
| `webserver/src/server/db/repositories/settingsRepo.ts` | `getAll/get/setMany`（JSON 值） | 1 |
| `webserver/src/server/db/repositories/loginAttemptsRepo.ts` | `insert`、`countFailuresSince`、`topFailedIdentifiers` | 1 |
| `webserver/src/server/db/repositories/passwordResetsRepo.ts` | 重置令牌的 `create/findByHash/consume` | 1 |
| `webserver/src/server/db/seed.ts` | `seedBaseData()` + `ensureRootAdmin()` + `seedDemoData()`（仅 dev，`seed:demo` 脚本） | 1 |
| `webserver/src/server/db/types.ts` | 行类型定义（`UserRow`、`SessionRow` …）与 `toDto()` 映射（时间戳 ms → ISO） | 1 |

### 3.3 认证与安全（阶段 1）

| 文件 | 意图 | 阶段 |
|---|---|---|
| `webserver/src/server/auth/password.ts` | `hashPassword`、`verifyPassword`（timingSafeEqual）、`needsRehash`、`validatePasswordPolicy` | 1 |
| `webserver/src/server/auth/weakPasswords.ts` | 约 500 条常见弱口令集合（`Set<string>`） | 1 |
| `webserver/src/server/auth/tokens.ts` | `newToken()`、`hashToken()`（HMAC+sha256）、`newTempPassword()` | 1 |
| `webserver/src/server/auth/permissions.ts` | 权限目录常量 + `hasPermission(perms, need)`（支持 `*` 与 `users.*` 通配） | 1 |
| `webserver/src/server/auth/session.ts` | `createSession`、`rotateRefresh`、`resolveFromRequest`（Cookie 或 Bearer）、`revokeOne`、`revokeAllForUser` | 1 |
| `webserver/src/server/auth/guards.ts` | `requireSession()`、`requirePermission()`、`requireCsrf()`、`assertSelfOrPermission()` | 1 |
| `webserver/src/server/auth/rateLimit.ts` | 滑动窗口计数器 `hit(scope,key,limit,windowMs)`、`reset()`（测试用） | 1 |
| `webserver/src/server/auth/constants.ts` | Cookie 名、TTL 换算、错误码常量（单一来源） | 1 |

### 3.4 HTTP 基础设施（阶段 1）

| 文件 | 意图 | 阶段 |
|---|---|---|
| `webserver/src/server/http/envelope.ts` | `ok(data, message?)`、`fail(code, message, status, details?)`，统一 §4.3 信封 | 1 |
| `webserver/src/server/http/errors.ts` | `AppError`（code/status/details）+ `ERROR_STATUS` 映射表 | 1 |
| `webserver/src/server/http/requestContext.ts` | 取 IP/UA/requestId、`redact()`、`withRoute()` 高阶包装（捕获 AppError） | 1 |
| `webserver/src/server/http/pagination.ts` | `parsePage(searchParams)`、`buildPageMeta(total,page,pageSize)`（默认 20，上限 100） | 1 |
| `webserver/src/server/http/cookies.ts` | `setSessionCookies()`、`clearSessionCookies()`、`readCookie()` | 1 |
| `webserver/src/server/validation/schemas.ts` | 全部 zod schema（`loginSchema`、`registerSchema`、`patchUserSchema`…） | 1 |

### 3.5 业务服务（阶段 1–2）

| 文件 | 意图 | 阶段 |
|---|---|---|
| `webserver/src/server/services/authService.ts` | `login`、`register`、`logout`、`refresh`、`heartbeat`、`changePassword`、`requestPasswordReset`、`confirmPasswordReset` | 1 |
| `webserver/src/server/services/userService.ts` | 管理端用户 CRUD、批量操作、停用/启用、解锁、临时口令、软删/恢复/硬删、`listUsers`（筛选分页排序） | 2 |
| `webserver/src/server/services/roleService.ts` | 角色 CRUD、权限矩阵读写、系统角色保护 | 2 |
| `webserver/src/server/services/inviteService.ts` | 邀请码生成（返回明文一次 + 存哈希）、列表、撤销 | 2 |
| `webserver/src/server/services/auditService.ts` | `record()`（含 actor 快照）与查询 | 1 |
| `webserver/src/server/services/settingsService.ts` | 应用设置读写（白名单键 + 类型校验） | 2 |
| `webserver/src/server/services/metricsService.ts` | 概览指标与 14 天趋势 | 2 |
| `webserver/src/server/services/profileService.ts` | 本人资料/会话/活动读写（`/me/*` 的数据源） | 2 |
| `webserver/src/server/mail/mailer.ts` | nodemailer 封装 + 模板（重置口令） | 2 |

### 3.6 REST 路由（阶段 2）

| 文件 | 意图 |
|---|---|
| `webserver/src/app/api/v1/health/route.ts` | `GET` 存活探针 |
| `webserver/src/app/api/v1/ready/route.ts` | `GET` 就绪探针（含迁移检查） |
| `webserver/src/app/api/v1/meta/route.ts` | `GET` 公开元信息：`registrationEnabled`、`inviteRequired`、`smtpEnabled`、`passwordPolicy`、`version` |
| `webserver/src/app/api/v1/auth/login/route.ts` | `POST` 登录 |
| `webserver/src/app/api/v1/auth/register/route.ts` | `POST` 注册 |
| `webserver/src/app/api/v1/auth/logout/route.ts` | `POST` 登出（撤销当前会话） |
| `webserver/src/app/api/v1/auth/refresh/route.ts` | `POST` 轮换刷新令牌 |
| `webserver/src/app/api/v1/auth/heartbeat/route.ts` | `POST` 桌面端心跳/续期 + 撤销探测 |
| `webserver/src/app/api/v1/auth/session/route.ts` | `GET` 当前会话与用户（Web 端首帧校验） |
| `webserver/src/app/api/v1/auth/password/change/route.ts` | `POST` 改密（需当前口令） |
| `webserver/src/app/api/v1/auth/password/reset/request/route.ts` | `POST` 申请重置（恒 202） |
| `webserver/src/app/api/v1/auth/password/reset/confirm/route.ts` | `POST` 重置确认 |
| `webserver/src/app/api/v1/me/route.ts` | `GET`/`PATCH` 本人资料 |
| `webserver/src/app/api/v1/me/sessions/route.ts` | `GET` 本人设备列表 |
| `webserver/src/app/api/v1/me/sessions/[id]/route.ts` | `DELETE` 撤销本人某设备 |
| `webserver/src/app/api/v1/me/activity/route.ts` | `GET` 本人 90 天活动 |
| `webserver/src/app/api/v1/admin/metrics/route.ts` | `GET` 概览指标 |
| `webserver/src/app/api/v1/admin/users/route.ts` | `GET` 列表 / `POST` 创建 |
| `webserver/src/app/api/v1/admin/users/[id]/route.ts` | `GET`/`PATCH`/`DELETE` 单个用户 |
| `webserver/src/app/api/v1/admin/users/[id]/password-reset/route.ts` | `POST` 临时口令或重置链接 |
| `webserver/src/app/api/v1/admin/users/[id]/restore/route.ts` | `POST` 恢复软删用户（v2 补：§4.2 已承诺该端点，v1 漏了文件） |
| `webserver/src/app/api/v1/admin/users/[id]/unlock/route.ts` | `POST` 清除锁定 |
| `webserver/src/app/api/v1/admin/users/[id]/sessions/route.ts` | `GET` 该用户会话 |
| `webserver/src/app/api/v1/admin/users/bulk/route.ts` | `POST` 批量停用/启用/删除/改角色 |
| `webserver/src/app/api/v1/admin/sessions/[id]/route.ts` | `DELETE` 踢下线任意会话 |
| `webserver/src/app/api/v1/admin/roles/route.ts` | `GET`/`POST` 角色 |
| `webserver/src/app/api/v1/admin/roles/[id]/route.ts` | `PATCH`/`DELETE` 角色 |
| `webserver/src/app/api/v1/admin/roles/[id]/permissions/route.ts` | `PUT` 替换权限集合 |
| `webserver/src/app/api/v1/admin/invites/route.ts` | `GET`/`POST` 邀请码 |
| `webserver/src/app/api/v1/admin/invites/[id]/route.ts` | `DELETE` 撤销邀请码 |
| `webserver/src/app/api/v1/admin/audit/route.ts` | `GET` 审计日志（筛选分页） |
| `webserver/src/app/api/v1/admin/settings/route.ts` | `GET`/`PATCH` 系统设置 |

### 3.7 页面路由（阶段 3–5）

| 文件 | 意图 | 阶段 |
|---|---|---|
| `webserver/src/app/layout.tsx` | `<html lang>` 由 Cookie 决定、主题 class、字体变量、`Toaster`、`ThemeProvider` | 3 |
| `webserver/src/app/globals.css` | §2.8 CSS 变量（深/浅）、基础重置、焦点环、滚动条、skeleton shimmer、grid 纹理工具类 | 3 |
| `webserver/src/app/(marketing)/layout.tsx` | Navbar + Footer 外壳 | 3 |
| `webserver/src/app/(marketing)/page.tsx` | 落地页（§2.8 九段内容） | 3 |
| `webserver/src/app/(marketing)/legal/privacy/page.tsx` | 隐私政策占位（真实条文由运营替换，标注 TODO 归属与日期） | 3 |
| `webserver/src/app/(marketing)/legal/terms/page.tsx` | 服务条款占位 | 3 |
| `webserver/src/app/(marketing)/opengraph-image.tsx` | `next/og` 动态 OG 图 | 3 |
| `webserver/src/app/sitemap.ts` / `robots.ts` | SEO | 3 |
| `webserver/src/app/(auth)/layout.tsx` | 居中卡片 + 左侧品牌区（大屏）/ 纯卡片（小屏） | 4 |
| `webserver/src/app/(auth)/login/page.tsx` | 登录（读 `?next=`，已登录则重定向） | 4 |
| `webserver/src/app/(auth)/register/page.tsx` | 注册（无邀请码要求时隐藏该字段；开关关闭时显示禁用提示） | 4 |
| `webserver/src/app/(auth)/forgot-password/page.tsx` | 申请重置 | 4 |
| `webserver/src/app/(auth)/reset-password/page.tsx` | 重置确认（读 `?token=`） | 4 |
| `webserver/src/app/(console)/layout.tsx` | 登录态外壳（侧栏 + 顶栏），未登录 `redirect('/login')` | 5 |
| `webserver/src/app/(console)/account/page.tsx` | 资料 | 5 |
| `webserver/src/app/(console)/account/security/page.tsx` | 改密 + 设备 | 5 |
| `webserver/src/app/(console)/account/activity/page.tsx` | 本人活动 | 5 |
| `webserver/src/app/(console)/admin/layout.tsx` | 二次权限守卫（`users.read`）+ 管理侧栏 | 6 |
| `webserver/src/app/(console)/admin/page.tsx` | 概览仪表盘 | 6 |
| `webserver/src/app/(console)/admin/users/page.tsx` | 用户列表（URL 驱动筛选/分页） | 6 |
| `webserver/src/app/(console)/admin/users/[id]/page.tsx` | 用户详情（资料/权限/会话/活动 四 Tab） | 6 |
| `webserver/src/app/(console)/admin/roles/page.tsx` | 角色与权限矩阵 | 6 |
| `webserver/src/app/(console)/admin/invites/page.tsx` | 邀请码 | 6 |
| `webserver/src/app/(console)/admin/audit/page.tsx` | 审计日志 | 6 |
| `webserver/src/app/(console)/admin/settings/page.tsx` | 系统设置 | 6 |
| `webserver/src/app/(console)/admin/forbidden/page.tsx` | 403 页面（带"返回账号中心"） | 6 |
| `webserver/src/app/not-found.tsx` / `error.tsx` | 404 / 全局错误边界（不泄露堆栈） | 3 |
| `webserver/src/middleware.ts` | 安全头 + Cookie 快速跳转（§2.2 规则 4） | 4 |

### 3.8 UI 基元（阶段 0 + 4，shadcn 生成后定制）

`webserver/src/components/ui/{button,input,label,textarea,select,checkbox,switch,dialog,sheet,dropdown-menu,tabs,table,badge,avatar,tooltip,separator,skeleton,toast,toaster,alert,progress,popover,command}.tsx` — 每个文件一行意图：shadcn 组件按 §2.8 形态定制（圆角/高度/聚焦环/暗色变量）。

### 3.9 落地页与认证组件（阶段 3–4）

| 文件 | 意图 |
|---|---|
| `webserver/src/components/marketing/Navbar.tsx` | 吸顶导航、滚动后加毛玻璃、移动端抽屉 |
| `webserver/src/components/marketing/Hero.tsx` | 主标题/CTA/产品截图/背景纹理 |
| `webserver/src/components/marketing/FeatureGrid.tsx` | 6 张能力卡（数据驱动数组） |
| `webserver/src/components/marketing/ShowcaseMock.tsx` | 三段图文交替（`reverse` prop） |
| `webserver/src/components/marketing/PermissionsSection.tsx` | 角色矩阵示意（静态表格 + 高亮） |
| `webserver/src/components/marketing/PricingCards.tsx` | 三档展示卡（无支付，Pro 高亮） |
| `webserver/src/components/marketing/Faq.tsx` | `<details>` 折叠问答 |
| `webserver/src/components/marketing/Footer.tsx` | 三列链接 + 版权 + 状态点 |
| `webserver/src/components/marketing/DownloadCta.tsx` | 按 UA 显示平台（Windows/macOS），未知则"查看全部版本" |
| `webserver/src/components/auth/AuthShell.tsx` | 认证页布局（品牌侧栏 + 卡片） |
| `webserver/src/components/auth/LoginForm.tsx` | 登录表单（identifier/password、显示口令、提交态、错误内联、`next` 跳转） |
| `webserver/src/components/auth/RegisterForm.tsx` | 注册表单（口令强度条、邀请码条件渲染、条款勾选） |
| `webserver/src/components/auth/ForgotPasswordForm.tsx` | 申请重置 |
| `webserver/src/components/auth/ResetPasswordForm.tsx` | 新口令 + 确认 |
| `webserver/src/components/auth/PasswordField.tsx` | 显隐切换 + `autoComplete` 正确取值 + CapsLock 提示 |
| `webserver/src/components/auth/PasswordStrength.tsx` | 本地启发式强度条（长度/弱口令表/相似度），不阻塞提交（策略由服务端裁决） |

### 3.10 控制台组件（阶段 5–6）

| 文件 | 意图 |
|---|---|
| `webserver/src/components/console/ConsoleShell.tsx` | 侧栏 + 顶栏布局（可折叠、移动端 Sheet） |
| `webserver/src/components/console/ConsoleSidebar.tsx` | 按权限过滤导航项（无权限即不渲染） |
| `webserver/src/components/console/Topbar.tsx` | 面包屑、⌘K 触发、主题切换、用户菜单 |
| `webserver/src/components/console/UserMenu.tsx` | 头像下拉（账号/安全/登出） |
| `webserver/src/components/console/CommandPalette.tsx` | ⌘K 跳转 + 快速搜索用户（`cmdk`） |
| `webserver/src/components/console/StatCard.tsx` | 指标卡（数值 + 环比 + 迷你 sparkline） |
| `webserver/src/components/console/DataTable.tsx` | 通用服务端分页表格（列定义、排序、空态、加载骨架、行选择） |
| `webserver/src/components/console/FilterBar.tsx` | 搜索 + 状态/角色下拉 + 时间范围（写 URL query） |
| `webserver/src/components/console/BulkActionBar.tsx` | 批量操作条（选中数 + 动作 + 危险二次确认） |
| `webserver/src/components/console/EmptyState.tsx` | 空态（图标/标题/说明/主操作） |
| `webserver/src/components/console/ConfirmDialog.tsx` | 通用确认（`variant=danger` 需输入名称） |
| `webserver/src/components/console/RoleBadge.tsx` / `StatusBadge.tsx` | 角色与状态徽章（色板固定 §2.8） |
| `webserver/src/components/console/PermissionMatrix.tsx` | 权限分组 + 复选矩阵 + 全选/全清 + 脏值提示 |
| `webserver/src/components/console/UserFormDialog.tsx` | 新建/编辑用户（创建时可选"生成临时口令"） |
| `webserver/src/components/console/UserSessionsPanel.tsx` | 用户设备列表 + 踢下线 |
| `webserver/src/components/console/ActivityTimeline.tsx` | 审计事件时间线（图标 + 相对时间 + metadata 折叠） |
| `webserver/src/components/console/ThemeToggle.tsx` | 深/浅切换（写 localStorage + html class） |
| `webserver/src/components/account/ProfileForm.tsx` | 显示名/头像/语言/时区 |
| `webserver/src/components/account/SecurityForm.tsx` | 改密（当前 + 新 + 确认，成功后其他会话是否保留的勾选项） |
| `webserver/src/components/account/SessionList.tsx` | 本人设备列表（当前设备高亮、撤销） |
| `webserver/src/components/account/DangerZone.tsx` | 申请注销（写审计 + 通知管理员，本轮不做自助真删） |

### 3.11 客户端库（阶段 2–6）

| 文件 | 意图 |
|---|---|
| `webserver/src/lib/api/client.ts` | 浏览器 fetch 封装：同源、自动带 `X-CSRF-Token`、统一解信封、`ApiError`、401 → `location.assign('/login?reason=session-expired')` |
| `webserver/src/lib/api/endpoints.ts` | 端点常量与类型化调用函数（`authApi`、`usersApi`、`rolesApi`…） |
| `webserver/src/lib/permissionsCatalog.ts` | 与 `server/auth/permissions.ts` 共享的权限键与中文/英文标签、分组（**唯一前端来源**，UI 不硬编码字符串） |
| `webserver/src/lib/i18n/index.ts` | `t(key, vars)`、`useI18n()`、语言检测（Cookie `ecs_lang` → `Accept-Language` → `zh-CN`） |
| `webserver/src/lib/i18n/zh-CN.ts` | 简体中文全量文案（默认语言） |
| `webserver/src/lib/i18n/en-US.ts` | 英文全量文案（键集合必须与 zh-CN 完全一致，测试强制） |
| `webserver/src/lib/format.ts` | 相对时间、日期、数字千分位、字节（避免引入 dayjs）。**v2 补（R-17）**：DTO 一律输出 ISO-8601，相对时间只在客户端计算——服务端渲染相对时间会与 hydration 后的文本不一致，触发 React 警告并闪一下 |
| `webserver/src/lib/permissionsCatalog.ts` | 与 `server/auth/permissions.ts` 共享的权限键与中文/英文标签、分组（**唯一前端来源**，UI 不硬编码字符串）。**v2 补（R-09）**：客户端组件只接收 `locale: 'zh-CN' \| 'en-US'` 这类可序列化值，翻译函数在组件内部用 `translator(locale)` 现造；禁止把 `tt` 作为 prop 跨 RSC 边界传递 |
| `webserver/src/lib/validators.ts` | 前端复用的 email/username/password 规则（与服务端同阈值，注释注明同源） |
| `webserver/src/lib/theme.ts` | 主题读写与首帧无闪烁脚本 |

### 3.12 CLI 与测试（阶段 1–7）

| 文件 | 意图 |
|---|---|
| `webserver/scripts/create-user.mjs` | `npm run user:create -- --email --password --role`（服务端离线创建，直连 service） |
| `webserver/scripts/reset-password.mjs` | `npm run user:reset -- --email --password`（破窗重置） |
| `webserver/scripts/backup.sh` | SQLite 在线备份 |
| `webserver/tests/setup/tempDb.ts` | 每测例独立临时 DB（`file:$TMP`），迁移后返回句柄，用例结束删除 |
| `webserver/tests/unit/password.test.ts` | 哈希/校验/策略（含弱口令、超长、相似 email） |
| `webserver/tests/unit/tokens.test.ts` | 令牌熵、哈希稳定性、临时口令字符集 |
| `webserver/tests/unit/permissions.test.ts` | `*` 与 `users.*` 通配、未知权限拒绝 |
| `webserver/tests/unit/rateLimit.test.ts` | 窗口计数、过期复位、超限返回 retryAfter |
| `webserver/tests/unit/validation.test.ts` | zod schema 的通过/拒绝样例（含中文错误文案键） |
| `webserver/tests/integration/migrate.test.ts` | 迁移幂等、`schema_migrations` 记录、外键开启 |
| `webserver/tests/integration/auth.login.test.ts` | 成功/口令错/锁定/封禁/枚举防护/审计写入 |
| `webserver/tests/integration/auth.register.test.ts` | 开关、邀请码必需/无效/耗尽、邮箱重复、口令策略 |
| `webserver/tests/integration/auth.session.test.ts` | 刷新轮换、重用检测撤销全部会话、Cookie 属性、CSRF 缺失被拒 |
| `webserver/tests/integration/users.admin.test.ts` | CRUD、分页筛选、owner 保护、自删禁止、软删/恢复、批量 |
| `webserver/tests/integration/roles.admin.test.ts` | 权限矩阵替换、系统角色不可删、权限即时生效（同会话） |
| `webserver/tests/integration/rbac.matrix.test.ts` | 逐角色 × 逐端点断言 200/403（§6.2 表驱动） |
| `webserver/tests/integration/audit.test.ts` | 每个写端点必产出一条审计；敏感字段不落库 |
| `webserver/tests/integration/i18n.test.ts` | zh-CN 与 en-US 键集合完全一致、无空值 |
| `webserver/e2e/critical-flows.spec.ts` | Playwright：落地页→注册→登录→账号中心→管理员登录→改角色→踢下线（6 条） |

### 3.13 实施顺序（每阶段可独立验收，下游按序执行）

| 阶段 | 内容 | 完成判据（必须全部通过才进下一阶段） |
|---|---|---|
| 0 | 脚手架、配置、设计 token、UI 基元 | `npm run type-check` 与 `npm run lint` 零错误；`npm run build` 产出 standalone；`/` 返回 200 并渲染 Navbar/Hero/Footer 骨架，且**不出现** `Functions cannot be passed directly to Client Components`（v2 修正 R-12：v1 的"空白骨架页不报错"与 §2.8 九段落地页要求冲突） |
| 1 | DB、迁移、认证内核、HTTP 基础设施、auth service | `npm test -- tests/unit tests/integration/migrate.test.ts` 全绿；`npm run db:migrate` 连跑两次幂等；启动日志出现 ready 摘要 |
| 2 | REST v1 全量 + 业务服务 + CLI | 全部 integration 测试绿；`docs/api.md` 的每个端点至少一条真实 curl 记录（手测截图/输出粘进 PR） |
| 3 | 落地页、法务页、SEO、主题 | Lighthouse（桌面）Performance ≥ 90、A11y ≥ 95；九段内容齐全；`prefers-reduced-motion` 生效 |
| 4 | 认证页、middleware 守卫、i18n 全量 | 6 条 e2e 中"落地页→注册→登录"通过；无 Cookie 访问 `/admin` 302 到 `/login?next=/admin` |
| 5 | 账号中心（资料/安全/设备/活动） | 普通用户能改资料与口令、能撤销他人设备但不能撤销他人会话；403 页面正确 |
| 6 | 管理后台（概览/用户/角色/邀请/审计/设置） | §6.3 验收清单 AC-10…AC-24 全绿；`rbac.matrix.test.ts` 全绿 |
| 7 | 部署产物、文档、桌面端契约 | `docker compose up` 后 `/api/v1/ready` 返回 200；`docs/desktop-integration.md` 可按步骤被第三方实现 |

### 3.14 依赖清单（锁定，禁止随意增删）

运行依赖：`next@^15.4`、`react@^19`、`react-dom@^19`、`better-sqlite3@^11`、`zod@^3`、`nodemailer@^6`、`clsx`、`tailwind-merge`、`class-variance-authority`、`lucide-react`、`cmdk`、`next-themes`、`sonner`。
开发依赖：`typescript@^5.9`、`@types/node`、`@types/react`、`@types/react-dom`、`@types/better-sqlite3`、`@types/nodemailer`、`tailwindcss@^3.4`、`postcss`、`autoprefixer`、`eslint@^9`、`eslint-config-next`、`@typescript-eslint/*`、`vitest@^2`、`@vitest/coverage-v8`、`@playwright/test`（仅 e2e 阶段安装）。
**不引入**：Prisma/Drizzle（原生 SQL 更可控）、NextAuth（其模型与桌面 Bearer 流不匹配）、bcrypt/argon2（原生构建风险，scrypt 已够）、JWT 库、日期库、任何 UI 全家桶。

### 3.15 桌面端接入契约（阶段 7 之后由后续节点实施；本轮不改动）

**根项目需要新增/修改的文件（供后续节点直接照做）**

| 文件 | 动作 | 意图 |
|---|---|---|
| `webserver/docs/desktop-integration.md` | 新增 | 契约文档（本方案产出，随 webserver 交付） |
| `src/lib/api/http-client.ts` | 修改 | 注入 `Authorization: Bearer`（从会话存储读），401 不弹跳转而是广播 `ecliptrix-session-invalid` 事件 |
| `src/lib/api/authClient.ts` | 新增 | `login/register/refresh/heartbeat/logout` 的类型化调用（指向 `NEXT_PUBLIC_ACCOUNT_SERVER_URL`） |
| `src/contexts/SessionContext.tsx` | 新增 | 会话状态机 `loading｜authenticated｜unauthenticated｜offline` + 心跳定时器 + 事件订阅 |
| `src/app/layout.tsx` | 修改 | 用 `<SessionProvider>` 包裹（仅此一行级别改动） |
| `src/app/page.tsx` | 修改 | 未认证时短路整个 HomePage，只渲染 `<LoginScreen/>`（整窗仅一条标题栏） |
| `src/app/login/page.tsx` | 新增 | `/login` 路由渲染同一 `LoginScreen`（供深链与过期跳转） |
| `src/components/auth/LoginScreen.tsx` | 新增 | 全窗口登录界面（服务器登录 + 本地管理员登录两个入口，风格与 webserver 认证页一致） |
| `desktop/main/authBridge.js` | 新增 | IPC：`auth:local-verify`（常量时间比对 `desktop-config.json.localAdmin`）、`auth:session-read/write/clear`（`safeStorage` 加密）、失败计数 |
| `desktop/main/config.js` | 修改 | `initUserData()` 写入默认 `localAdmin: { username: 'admin', password: 'adminjr' }`（已存在则不覆盖） |
| `desktop/main/index.js` | 修改 | 注册 `authBridge` IPC；启动时读会话并决定首帧路由 |
| `desktop/scripts/env.template.desktop` | 修改 | 追加 `ACCOUNT_SERVER_URL=https://id.ecliptrix.app`、`ACCOUNT_OFFLINE_GRACE_DAYS=7`（**不**把本地管理员口令放进 env，它属于 `desktop-config.json`） |
| `src/lib/i18n.ts` | 修改 | 追加登录界面相关键（zh/en 同批） |
| `src/hooks/__tests__/sessionGate.test.tsx` 等 | 新增 | 闸门与破窗登录的单元测试 |

**桌面端硬约束**：业务表 `user_id` **继续**恒为 `LOCAL_OWNER_ID`（`app/constants.py` 与 `src/lib/localOwner.ts` 同步不动）——身份认证只决定"谁能打开应用"，不改变本地数据归属，避免任何数据迁移（与 `CLAUDE.md` 的 "No auth / single owner" 约定兼容）。

---

## 4. Interface Design（接口设计）

### 4.1 通用约定

- Base：`{PUBLIC_BASE_URL}/api/v1`；全部 `Content-Type: application/json; charset=utf-8`，请求体 ≤ **64 KB**（**v2 补，R-21**：应用层在路由解析处强制执行并返回 `413 payload_too_large`；`client_max_body_size 1m` 的 Nginx 只是外层兜底，不能当作唯一防线）。
- 认证：Web 用 `ecs_session` Cookie（`HttpOnly; SameSite=Lax; Path=/; Secure=production`）。**v2 修正（R-20）**：`Secure` 由 `PUBLIC_BASE_URL` 的 scheme 推导（`https://` → 设置），而不是读 `NODE_ENV`——TLS 在 Nginx 终止，Node 进程并不知道协议；用生产构建在 http 上做本地验证时，按 `NODE_ENV` 判定会让浏览器静默丢弃会话。桌面用 `Authorization: Bearer <accessToken>`。
- 写请求（Cookie 会话）必须带 `X-CSRF-Token`，值等于 `ecs_csrf` Cookie；Bearer 请求免 CSRF。
- 每个响应带 `X-Request-Id`；客户端可传 `X-Request-Id` 复用，否则服务端生成 UUIDv4。
- 时间字段一律 ISO-8601 UTC（`2026-10-08T09:31:22.000Z`），入库为 epoch 毫秒。
- ID 一律 UUIDv4 字符串；`role.key` 为稳定 slug（`owner|admin|support|member`）。
- 幂等：写请求可选 `Idempotency-Key`（仅 `POST /admin/users`、`POST /admin/invites` 生效，24h 内同键返回首次结果）。

### 4.2 端点总表

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/health` | 公开 | 存活：`{status,version,uptimeSeconds}` |
| GET | `/ready` | 公开 | 就绪：DB + 迁移状态，未就绪 503 |
| GET | `/meta` | 公开 | `{registrationEnabled,inviteRequired,smtpEnabled,passwordPolicy,version}` |
| POST | `/auth/login` | 公开（限流） | 登录，Web 回 Cookie，桌面回令牌 |
| POST | `/auth/register` | 公开（限流） | 注册（受开关/邀请码约束） |
| POST | `/auth/logout` | 会话 | 撤销当前会话并清 Cookie |
| POST | `/auth/refresh` | 刷新令牌 | 轮换，旧令牌立即失效 |
| POST | `/auth/heartbeat` | Bearer | 桌面端心跳；返回剩余 TTL 与撤销状态 |
| GET | `/auth/session` | 会话 | 当前用户 + 权限 + 会话信息 |
| POST | `/auth/password/change` | 会话 | 改密（需当前口令，可选注销其他会话；`signOutOtherSessions` 默认 `false`，当前会话永不撤销——v2 补，R-18） |
| POST | `/auth/password/reset/request` | 公开（限流） | 恒 202 |
| POST | `/auth/password/reset/confirm` | 公开 | 用一次性令牌设新口令 |
| GET | `/me` | 会话 | 本人资料 |
| PATCH | `/me` | 会话 | 改 `displayName/avatarUrl/locale/timezone` |
| GET | `/me/sessions` | 会话 | 本人设备列表（当前标记） |
| DELETE | `/me/sessions/{id}` | 会话（本人） | 撤销本人某设备；撤销当前会话等价登出；**他人会话一律返回 404**（v2 补，R-19：403 会确认资源存在） |
| GET | `/me/activity` | 会话 | 本人 90 天事件（白名单动作） |
| GET | `/admin/metrics` | `users.read` | 概览指标 |
| GET | `/admin/users` | `users.read` | 列表：`query,status,role,plan,createdFrom,createdTo,sort,page,pageSize` |
| POST | `/admin/users` | `users.write` | 创建（可直接指定角色/临时口令） |
| GET | `/admin/users/{id}` | `users.read` | 详情（含权限与会话摘要） |
| PATCH | `/admin/users/{id}` | `users.write`（改角色另需 `roles.write`） | 更新资料/状态/角色/备注/plan |
| DELETE | `/admin/users/{id}` | `users.delete` | 软删；`?hard=true` 仅 owner |
| POST | `/admin/users/{id}/restore` | `users.write` | 恢复软删用户 |
| POST | `/admin/users/{id}/password-reset` | `users.write` | `{mode:"temp_password"｜"reset_link"}` |
| POST | `/admin/users/{id}/unlock` | `users.write` | 清除锁定与失败计数 |
| GET | `/admin/users/{id}/sessions` | `sessions.revoke` | 该用户会话 |
| POST | `/admin/users/bulk` | `users.write` | `{action:"suspend"｜"activate"｜"delete"｜"setRole", ids[], roleId?}` |
| DELETE | `/admin/sessions/{id}` | `sessions.revoke` | 踢下线 |
| GET | `/admin/roles` | `roles.read` | 角色 + 权限 + 用户数 |
| POST | `/admin/roles` | `roles.write` | 新建角色 |
| PATCH | `/admin/roles/{id}` | `roles.write` | 改名/描述 |
| DELETE | `/admin/roles/{id}` | `roles.write` | 删除（有用户占用 → 409；系统角色 → 403） |
| PUT | `/admin/roles/{id}/permissions` | `roles.write` | 全量替换权限集合 |
| GET | `/admin/invites` | `invites.read` | 邀请码列表（只回 `codeHint`） |
| POST | `/admin/invites` | `invites.write` | 新建，响应**一次**回明文 `code` |
| DELETE | `/admin/invites/{id}` | `invites.write` | 撤销 |
| GET | `/admin/audit` | `audit.read` | 筛选：`actor,action,targetType,targetId,from,to,page` |
| GET | `/admin/settings` | `settings.read` | 全部设置 |
| PATCH | `/admin/settings` | `settings.write` | 局部更新（白名单键） |

### 4.3 信封与示例

成功：
```json
{
  "success": true,
  "message": null,
  "timestamp": "2026-10-08T09:31:22.000Z",
  "data": {
    "accessToken": "b7Y…",
    "refreshToken": "k2Q…",
    "expiresAt": "2026-10-08T21:31:22.000Z",
    "user": {
      "id": "6f1c…",
      "email": "ada@example.com",
      "username": "ada",
      "displayName": "Ada",
      "role": { "id": "r-adm", "key": "admin", "name": "管理员" },
      "status": "active",
      "planTag": "pro",
      "permissions": ["users.read", "users.write", "roles.read", "audit.read"],
      "createdAt": "2026-10-01T03:12:00.000Z",
      "lastLoginAt": "2026-10-08T09:31:22.000Z"
    }
  }
}
```

失败：
```json
{
  "success": false,
  "message": "邮箱或口令不正确",
  "timestamp": "2026-10-08T09:31:22.000Z",
  "error": {
    "code": "invalid_credentials",
    "message": "邮箱或口令不正确",
    "details": { "retryAfterSeconds": null }
  }
}
```

分页响应 `data`：
```json
{
  "items": [],
  "page": { "page": 1, "pageSize": 20, "total": 128, "totalPages": 7 }
}
```

### 4.4 错误码表（稳定枚举，禁止改名）

| code | HTTP | 何时 |
|---|---|---|
| `invalid_request` | 400 | 无法解析的 body/参数 |
| `validation_failed` | 422 | zod 校验失败（`details.fields[{path,message}]`） |
| `unauthorized` | 401 | 缺会话/令牌 |
| `invalid_credentials` | 401 | 登录失败（不区分原因） |
| `session_expired` | 401 | 访问令牌过期 |
| `session_revoked` | 401 | 会话被撤销/踢下线 |
| `password_change_required` | 403 | `must_change_password=1` 时的非改密端点 |
| `forbidden` | 403 | 权限不足 |
| `account_suspended` | 403 | 账号被封禁 |
| `account_locked` | 423 | 失败次数过多（`details.retryAfterSeconds`） |
| `registration_disabled` | 403 | 注册关闭 |
| `invite_required` / `invite_invalid` / `invite_exhausted` | 403 / 409 / 409 | 邀请码 |
| `email_taken` / `username_taken` | 409 | 唯一冲突 |
| `weak_password` | 422 | 口令策略（`details.reasons[]`） |
| `password_mismatch` | 401 | 改密时当前口令错 |
| `cannot_modify_owner` | 409 | 试图改 owner 角色用户 |
| `cannot_modify_self` | 409 | 自我停用/删除/降级 |
| `role_in_use` | 409 | 删角色时仍有用户 |
| `system_role_protected` | 403 | 改/删系统角色 |
| `not_found` | 404 | 资源不存在（含已软删） |
| `conflict` | 409 | 其他状态冲突（如重复邀请码哈希碰撞） |
| `rate_limited` | 429 | 限流（带 `Retry-After`） |
| `csrf_failed` | 403 | CSRF 校验失败 |
| `service_unavailable` | 503 | 维护/DB 不可用 |
| `internal_error` | 500 | 未预期错误（日志留 requestId） |

### 4.5 关键端点细则

**`POST /auth/login`**
```json
// request（web）
{ "identifier": "ada@example.com", "password": "correct horse battery", "client": "web" }
// request（desktop）
{ "identifier": "ada", "password": "…", "client": "desktop",
  "device": { "name": "Ada 的 MacBook", "platform": "darwin-arm64", "appVersion": "1.0.1" } }
// 响应 200 data
{ "accessToken": "…", "refreshToken": "…", "expiresAt": "…", "user": { } }
```
`client=web` 时 `accessToken/refreshToken` 不出现在 body（只进 Cookie），body 只有 `{ user, expiresAt }`；`client=desktop` 时同时回令牌且**不**设 Cookie。

**`POST /auth/heartbeat`**（Bearer）
```
200 → { "ok": true, "sessionId": "…", "expiresAt": "…", "revoked": false, "user": { "id", "role", "permissions" } }
401 → session_revoked | session_expired | account_suspended
```

**`GET /admin/users`** 查询参数
```
query        string  (邮箱/用户名/显示名 模糊，前缀优先，命中 UNIQUE 索引)
status       active|suspended|pending|deleted
role         owner|admin|support|member|<自定义 key>
plan         free|pro|studio|*
createdFrom  ISO date   createdTo  ISO date
sort         created_at|-created_at|last_login_at|-last_login_at|email|-email
             （v2 修正 R-07：一律使用**数据库列名**，与 §5.2 对齐；非白名单值回退
              默认 `-created_at`。参数名直连 ORDER BY 时必须走白名单，否则是注入面）
page         默认 1     pageSize 默认 20，上限 100
```
返回 `items[].{}` 含 `id,email,username,displayName,role{key,name},status,planTag,lastLoginAt,createdAt,sessionsActive`。

**`PATCH /admin/users/{id}`**
```json
{ "displayName": "Ada L.", "email": "ada@new.com", "roleId": "r-sup",
  "status": "suspended", "planTag": "studio", "note": "企业客户" }
```
语义：字段缺省即不改；`status` 变更会触发会话撤销；`roleId` 变更立即刷新该用户权限（下一个请求生效）；`email` 变更需重新唯一校验并写审计 before/after。**禁止**把 `role.key === 'owner'` 的用户改角色/停用（`cannot_modify_owner`）。

**`PUT /admin/roles/{id}/permissions`**
```json
{ "permissions": ["users.read", "users.write", "audit.read"] }
```
全量替换；`owner` 角色恒为 `["*"]`，请求体非 `["*"]` 时返回 409 `system_role_protected`。未知权限键 → 422。

**`POST /admin/invites`**
```json
{ "maxUses": 5, "expiresInDays": 14, "roleKey": "member" }
→ 201 { "id": "…", "code": "ECL-7FQ2-K9PD-31MZ", "codeHint": "MZ", "maxUses": 5, "expiresAt": "…" }
```
`code` 仅此一次可见。

**`GET /admin/audit`** → `items[].{id,actorLabel,action,targetType,targetId,metadata,ip,createdAt}`；`action` 支持前缀匹配（`user.*`）。

**`PATCH /admin/settings`**
```json
{ "registration.enabled": true, "invite.required": false,
  "security.loginMaxAttempts": 5, "session.webTtlHours": 12,
  "branding.appName": "Ecliptrix" }
```
白名单键与类型：`registration.enabled:boolean`、`invite.required:boolean`、`security.loginMaxAttempts:int 3..20`、`security.loginLockMinutes:int 1..1440`、`session.webTtlHours:int 1..168`、`session.desktopRefreshDays:int 7..365`、`branding.appName:string≤40`、`branding.supportEmail:string`。越界 → 422。

### 4.6 限流与配额（固定数值）

| scope | 目标 | 限额 | 超限 |
|---|---|---|---|
| `login:ip` | 客户端 IP | 20 / 5 分钟 | 429 |
| `login:identifier` | 归一化标识 | **12 / 5 分钟**（v2：须 > 锁定阈值，见 §2.9.6） | 429 |
| `register:ip` | IP | 10 / 小时 | 429 |
| `reset:ip` | IP | 3 / 小时 | 429 |
| `admin:write` | 用户 ID | 120 / 分钟 | 429 |
| `heartbeat:session` | 会话 | 60 / 小时 | 429 |
| `read:user` | 用户 ID | 600 / 分钟 | 429 |

### 4.7 WebSocket / 事件

本轮**不使用 WebSocket**。会话失效通过 HTTP 401 传播（桌面端 15 分钟心跳 + 每次启动校验已足够）。保留扩展点：`/api/v1/events`（SSE，管理员实时看到新注册），标注为「可延后」，实现时不得提前引入。

### 4.8 CLI 契约

```bash
npm run db:migrate                                   # 应用全部待执行迁移（幂等）
npm run db:backup                                    # data/backup-<ts>.db
npm run user:create -- --email a@b.c --password '…' --role admin --display-name 'Ada'
npm run user:reset  -- --email a@b.c --password '…'   # 破窗重置（含解锁、清失败计数）
npm run seed:demo                                    # 仅 dev：12 个演示用户 + 3 个邀请码
```
CLI 直连 `server/db` 与服务层，**不得**起 HTTP；输出只打印邮箱与角色，绝不打印口令哈希。

---

## 5. Data Model（数据模型）

### 5.1 ER 概览

```
roles 1─┬─* users ─┬─* sessions
        │          ├─* password_reset_tokens
        │          └─* audit_events (actor)
        └─* role_permissions
registration_invites *─1 roles / users(created_by)
login_attempts   （独立，按 identifier+ip 索引）
app_settings     （key-value）
schema_migrations
```

### 5.2 DDL（`0001_init.sql`，逐字实现）

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE role_permissions (
  role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
) WITHOUT ROWID;

CREATE TABLE users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL,
  email_normalized      TEXT NOT NULL UNIQUE,
  username              TEXT NOT NULL,
  username_normalized   TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  password_updated_at   INTEGER NOT NULL,
  role_id               TEXT NOT NULL REFERENCES roles(id),
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','pending','deleted')),
  plan_tag              TEXT NOT NULL DEFAULT 'free',
  must_change_password  INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  email_verified_at     INTEGER,
  avatar_url            TEXT,
  locale                TEXT NOT NULL DEFAULT 'zh-CN',
  timezone              TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  note                  TEXT NOT NULL DEFAULT '',
  last_login_at         INTEGER,
  failed_login_count    INTEGER NOT NULL DEFAULT 0,
  lock_count            INTEGER NOT NULL DEFAULT 0,
  locked_until          INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  deleted_at            INTEGER
);
CREATE INDEX idx_users_status_created ON users (status, created_at DESC);
CREATE INDEX idx_users_role           ON users (role_id);
CREATE INDEX idx_users_last_login     ON users (last_login_at DESC);

CREATE TABLE sessions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client             TEXT NOT NULL CHECK (client IN ('web','desktop')),
  access_token_hash  TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT UNIQUE,
  device_name        TEXT NOT NULL DEFAULT '',
  platform           TEXT NOT NULL DEFAULT '',
  app_version        TEXT NOT NULL DEFAULT '',
  ip                 TEXT NOT NULL DEFAULT '',
  user_agent         TEXT NOT NULL DEFAULT '',
  created_at         INTEGER NOT NULL,
  last_seen_at       INTEGER NOT NULL,
  access_expires_at  INTEGER NOT NULL,
  refresh_expires_at INTEGER,
  revoked_at         INTEGER,
  revoked_reason     TEXT
);
CREATE INDEX idx_sessions_user    ON sessions (user_id, created_at DESC);
CREATE INDEX idx_sessions_active  ON sessions (user_id, revoked_at, access_expires_at);

CREATE TABLE registration_invites (
  id          TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  code_hint   TEXT NOT NULL,
  -- v2（R-03）：可空 + ON DELETE SET NULL。邀请人硬删除不得被自己发出的邀请码
  -- 阻塞；没有作者的邀请码仍是有价值的历史记录。
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  role_id     TEXT NOT NULL REFERENCES roles(id),
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER,
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  issued_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE login_attempts (
  id                    TEXT PRIMARY KEY,
  identifier_normalized TEXT NOT NULL,
  ip                    TEXT NOT NULL,
  success               INTEGER NOT NULL CHECK (success IN (0,1)),
  reason                TEXT NOT NULL,
  created_at            INTEGER NOT NULL
);
CREATE INDEX idx_attempts_identifier ON login_attempts (identifier_normalized, created_at DESC);
CREATE INDEX idx_attempts_ip        ON login_attempts (ip, created_at DESC);

CREATE TABLE audit_events (
  id            TEXT PRIMARY KEY,
  -- v2（R-03）：SET NULL 是硬删除的必要条件，不是风格选择。审计行仍然指向
  -- "某个曾经存在的 actor"；若保留 NO ACTION，任何执行过操作的账号都无法物理删除。
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label   TEXT NOT NULL,
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL DEFAULT '',
  metadata      TEXT NOT NULL DEFAULT '{}',
  ip            TEXT NOT NULL DEFAULT '',
  request_id    TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_events (created_at DESC);
CREATE INDEX idx_audit_action  ON audit_events (action, created_at DESC);
CREATE INDEX idx_audit_target  ON audit_events (target_type, target_id);
CREATE INDEX idx_audit_actor   ON audit_events (actor_user_id, created_at DESC);

-- v2 新增（R-15）：控制台搜索按 email 前缀匹配，UNIQUE 索引只覆盖归一化列。
CREATE INDEX idx_users_email ON users (email);

-- v2 新增（R-01）：已退役的刷新令牌摘要链，只存 HMAC 摘要，保留 90 天。
-- 没有这张表，"刷新令牌重用检测"在原理上无法实现：sessions.refresh_token_hash
-- 每次轮换都被覆盖，旧令牌只能落到"未知令牌"分支，事件永远不触发。
CREATE TABLE refresh_token_history (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  retired_at INTEGER NOT NULL
);
CREATE INDEX idx_refresh_history_session ON refresh_token_history (session_id, retired_at DESC);
CREATE INDEX idx_refresh_history_user    ON refresh_token_history (user_id, retired_at DESC);

CREATE TABLE refresh_token_reuse_events (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  presented_at INTEGER NOT NULL,
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT '',
  action_taken TEXT NOT NULL DEFAULT 'revoke_all_sessions'
);
CREATE INDEX idx_reuse_user ON refresh_token_reuse_events (user_id, presented_at DESC);

-- v2 新增（R-01 配套）：权限矩阵变更留痕。审计行指向的 role 之后可能被删除，
-- 矩阵的前后差异需要独立一行才能存活。
CREATE TABLE role_change_events (
  id          TEXT PRIMARY KEY,
  role_id     TEXT NOT NULL,
  role_key    TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  changed_at  INTEGER NOT NULL,
  before_json TEXT NOT NULL DEFAULT '[]',
  after_json  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_role_change_role ON role_change_events (role_id, changed_at DESC);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
```

> `audit_events.actor_user_id` 是唯一允许为 NULL 的外键：系统动作（seeding、CLI、自动解锁）用 `actor_label='system'`。

### 5.3 种子数据（`0002_seed_roles.sql` + `seed.ts`）

| role.key | name | permissions |
|---|---|---|
| `owner` | 超级管理员（Owner） | `["*"]` |
| `admin` | 管理员 | `users.read, users.write, users.delete, roles.read, invites.read, invites.write, audit.read, settings.read, sessions.revoke` |
| `support` | 客服 | `users.read, sessions.revoke, audit.read` |
| `member` | 普通用户 | （空，仅自助能力 `me.*`，无需显式权限） |

权限目录（`permissionsCatalog.ts`，分组 → 键 → 文案）：

| 分组 | 权限键 |
|---|---|
| 用户 | `users.read`、`users.write`、`users.delete` |
| 角色 | `roles.read`、`roles.write` |
| 会话 | `sessions.revoke` |
| 邀请 | `invites.read`、`invites.write` |
| 审计 | `audit.read` |
| 设置 | `settings.read`、`settings.write` |

`app_settings` 默认：`registration.enabled=true`、`invite.required=false`、`security.loginMaxAttempts=5`、`security.loginLockMinutes=15`、`session.webTtlHours=12`、`session.desktopRefreshDays=90`、`branding.appName=Ecliptrix`、`branding.supportEmail=""`。

### 5.4 归一化与约束

- `email_normalized = email.trim().toLowerCase()`；`username_normalized = username.trim().toLowerCase()`。
- 唯一性只在 normalized 列上（SQLite `UNIQUE` 区分大小写，故必须存归一化列，这是"大小写不敏感登录"的实现前提）。
- 软删：`status='deleted'` + `deleted_at`，同时把 `email_normalized`/`username_normalized` 改写为 `deleted+<uuid>@invalid`，使其邮箱可被重新注册。**v2 修正（R-05）**：`user.delete` 审计事件的 `metadata` **必须**同时写入原 `email` 与 `username`（归一化值），恢复时从这里取回并在写入前重新做唯一性校验；若原值已被占用返回 `409 email_taken`/`username_taken`，由管理员先改邮箱再恢复。不得假设"审计里有原值"而不要求写入。
- 所有 `DELETE` 走软删；`?hard=true` 仅 `owner` 且写审计。**v2 修正（R-03）**：物理删除依赖 `audit_events.actor_user_id`、`registration_invites.created_by`、`password_reset_tokens.issued_by` 三处 `ON DELETE SET NULL`（见 §5.2）；`sessions` 与 `password_reset_tokens` 对 `user_id` 是 `ON DELETE CASCADE`。审计行本身**不删除**，只把 actor 置空。
- 时间全部 `INTEGER` epoch 毫秒；DTO 层转 ISO。
- `metadata` 为 JSON 文本，写入前 `JSON.stringify`，读取时 `JSON.parse` 包在 try/catch 并降级为 `{}`（仅此一处允许降级，因为是展示型字段）。

### 5.5 迁移与演进规则

- 文件命名 `NNNN_snake_name.sql`，版本号连续递增，**禁止**修改已发布的迁移文件。
- 每个迁移在单一事务中执行：`BEGIN` → 逐语句 → 写 `schema_migrations` → `COMMIT`；任何语句抛错整体回滚并 `process.exit(1)`。
- 只允许**加法式**演进（`CREATE TABLE/INDEX`、`ALTER TABLE ADD COLUMN`）；禁止 `DROP TABLE/COLUMN`（与根项目 `CLAUDE.md` 的数据库铁律一致）。删除能力靠代码不读该列，靠后续大版本迁移脚本显式处理。
- 生产启动若发现未应用迁移且 `AUTO_MIGRATE!=1` → 拒绝启动并列出待执行版本（防止 schema 漂移导致的 500）。

---

## 6. Testing & Acceptance Criteria（测试与验收）

### 6.1 测试策略

| 层 | 工具 | 范围 | 规则 |
|---|---|---|---|
| 单元 | vitest（node env） | 口令、令牌、权限通配、限流、zod、格式化、i18n 键一致性 | 纯函数，无 IO，单文件 < 500ms |
| 集成 | vitest + 临时 SQLite 文件 | 迁移、登录/注册/会话/管理 CRUD/RBAC 矩阵/审计 | 每个用例独立 DB，**不 mock 数据库**（`CLAUDE.md`：高风险路径不许 mock） |
| E2E | Playwright（chromium） | 6 条关键用户旅程 | 依赖已 seed 的演示数据，禁止依赖外部网络 |
| 手动 | 检查清单（§6.4） | 视觉、动效、可访问性、响应式 | 截图存档到 PR |

**必须覆盖的失败路径**（缺一不可）：口令错误、账号锁定、封禁、过期令牌、被撤销会话、CSRF 缺失、越权访问（member 调 admin 接口）、owner 保护、自我删除、角色占用删除、邀请码耗尽、注册关闭、限流触发、软删用户登录失败、刷新令牌重用。

### 6.2 RBAC 矩阵测试（表驱动，`rbac.matrix.test.ts`）

对 4 个系统角色 × 全部写端点，断言期望状态码：

| 端点（写） | owner | admin | support | member |
|---|---|---|---|---|
| `POST /admin/users` | 201 | 201 | 403 | 403 |
| `PATCH /admin/users/{id}` | 200 | 200 | 403 | 403 |
| `DELETE /admin/users/{id}` | 200 | 200 | 403 | 403 |
| `POST /admin/users/{id}/password-reset` | 200 | 200 | 403 | 403 |
| `PUT /admin/roles/{id}/permissions` | 200 | 403 | 403 | 403 |
| `POST /admin/invites` | 201 | 201 | 403 | 403 |
| `PATCH /admin/settings` | 200 | 403 | 403 | 403 |
| `DELETE /admin/sessions/{id}` | 200 | 200 | 200 | 403 |
| `GET /admin/audit` | 200 | 200 | 200 | 403 |
| `PATCH /me` | 200 | 200 | 200 | 200 |
| `DELETE /me/sessions/{他人会话}` | 404 | 404 | 404 | 404 |

### 6.3 验收标准（Definition of Done，逐条可验）

**A. 项目与工程**

- **AC-01** `webserver/` 独立可跑：`npm install` → `npm run db:migrate` → `npm run dev` 后 `GET /api/v1/health` 返回 `{"status":"ok"}`。
- **AC-02** `npm run type-check`、`npm run lint` 零错误零警告（`no-explicit-any` 允许 warn 但本子项目内必须为 0）。
- **AC-03** `npm run build` 成功产出 `.next/standalone`，镜像内 `node server.js` 可启动。
- **AC-04** 迁移幂等：连续执行两次 `db:migrate`，`schema_migrations` 行数不变且无错误。
- **AC-05** `webserver/` 内不存在对根项目 `src/` 的引用（v2 修正：v1 给出的 `grep -r "@/" webserver/src | grep -v "webserver/src"` 恒为空——过滤条件把自身的真实路径排掉了，是一个永远不会失败的空断言）。改为两条可执行断言：① `webserver/tsconfig.json` 的 `paths.@/*` 指向 `./src/*`，且构建产物不解析到上一级目录；② 不存在 `from '../../src/...'` / `from '../../../src/...'` 形式的相对越界引用，且 `webserver/package.json` 不依赖任何根项目包。

**B. 落地页与认证**

- **AC-06** `/` 落地页含 §2.8 的九段内容，深色为默认，375px 宽度无横向滚动，Lighthouse Performance ≥ 90、Accessibility ≥ 95。
- **AC-07** `/login` 正确登录后跳 `next` 参数指定的内部路径（默认：owner/admin/support → `/admin`，member → `/account`）；已登录访问 `/login` 自动重定向。
- **AC-08** 注册：开关关闭时提交返回 `registration_disabled` 且 UI 显示禁用说明；`invite.required=true` 时无邀请码 `invite_required`、错码 `invite_invalid`、超次 `invite_exhausted`。
- **AC-09** 口令策略：`12345678` 返回 `weak_password` 且 `details.reasons` 非空；与邮箱相同的口令被拒；≥10 位强口令通过。
- **AC-10** 同一标识连续 5 次错误口令 → 第 6 次返回 `account_locked`（423）且带 `details.retryAfterSeconds > 0`；管理员解锁后可再次登录。
- **AC-11** 登录失败文案恒定（不泄露账号是否存在），且不存在用户路径仍消耗等量 CPU（假哈希）。
- **AC-12** 未登录访问 `/admin/users`、`/account` 均 302 到 `/login?next=<原路径>`。
- **AC-13** Cookie 会话的写请求缺 `X-CSRF-Token` 返回 `csrf_failed`；Bearer 请求无此要求。

**C. 权限与账号管理**

- **AC-14** member 登录后侧栏无任何管理入口；直接访问 `/admin` 渲染 403 页面，且 `audit_events` 新增 `authz.denied`。
- **AC-15** 管理员可完成用户全生命周期：创建（含临时口令，首次登录强制改密）→ 编辑资料/角色/plan → 停用（该用户下一次请求 401 `session_revoked`）→ 启用 → 软删 → 恢复。
- **AC-16** 批量操作：勾选 3 个用户执行"停用"，3 条 `user.suspend` 审计事件产生，UI 表格状态即时更新（不经全页刷新）。
- **AC-17** owner 保护：任何角色对 `role.key='owner'` 的用户执行停用/改角色/删除均返回 `cannot_modify_owner`；管理员删除自己返回 `cannot_modify_self`。
- **AC-18** 角色管理：可新建自定义角色并勾选任意权限；被用户占用的角色删除返回 `role_in_use`；系统角色删除返回 `system_role_protected`；把某用户改为新角色后，该用户**下一次请求**即按新权限判定（无需重新登录）。
- **AC-19** 邀请码：新建后明文仅显示一次，列表只显示 `codeHint`；用于注册成功后 `used_count` +1；达到 `maxUses` 后注册返回 `invite_exhausted`；撤销后返回 `invite_invalid`。
- **AC-20** 踢下线：管理员撤销某用户会话后，该用户刷新页面回到登录页并提示"会话已失效"。
- **AC-21** 审计完整性：§4.2 中每个写端点各执行一次后，`audit_events` 至少新增一条对应 `action`，且 `metadata` 内不含 `password`、`token`、`hash` 任何字段（用测试断言字符串搜索）。
- **AC-22** 设置：`PATCH /admin/settings` 修改 `registration.enabled=false` 后，`/register` 立即显示禁用；越界值（`security.loginMaxAttempts=99`）返回 422。
- **AC-23** 概览指标：`GET /admin/metrics` 的 `totalUsers/active7d/newToday/activeSessions` 与直接 SQL 统计一致（测试比对）。
- **AC-24** 搜索与分页：`GET /admin/users?query=ada&status=active&page=2&pageSize=10` 返回正确的 `items` 与 `page.totalPages`；1000 条种子数据下响应 < 150ms（本机）。

**D. 账号中心**

- **AC-25** 普通用户可改 `displayName/avatarUrl/locale/timezone`；改邮箱与状态字段**返回 422**（`/me` 的 PATCH schema 为 `.strict()`，管理员字段出现即校验失败——v2 固定该语义，删除 v1 "或 403 / 或 200 但忽略" 的矛盾表述）。
- **AC-26** 改密需要当前口令；错误返回 `password_mismatch`；成功后可选"注销其他会话"，被注销会话下一次请求 401。
- **AC-27** 设备列表显示当前设备徽章、操作系统、最后活跃时间；撤销他人会话返回 404（不泄露存在性）。

**E. 桌面端契约与破窗**

- **AC-28** `docs/desktop-integration.md` 中每个端点与 §4.2 一致（测试用 grep 校验端点字符串存在）。
- **AC-29** 桌面端 `client=desktop` 登录响应包含 `accessToken/refreshToken` 且**不**设置 `ecs_session` Cookie；`client=web` 反之。
- **AC-30** 破窗账号设计可执行性评审通过：`desktop-config.json.localAdmin` 存在、IPC 校验用 `timingSafeEqual`、5 次/5 分钟限速、审计落 `logs/auth.log`、README 记录默认值与修改方法（本轮以文档形式验收，代码在后续节点）。
- **AC-31（v2 新增，R-22）** 最小可运行闭环可证：对**运行中的服务**执行 `node scripts/smoke.mjs`，46 项断言全绿，覆盖 `/health` `/ready` `/meta` 落地页与安全头、未登录跳转、注册（Cookie+CSRF）、`/me` 读写与越权拒绝、登出、owner 登录、桌面端 Bearer 登录与心跳、刷新轮换、旧刷新令牌重放被拒并撤销全部会话、管理端用户 CRUD/停用/owner 保护、角色与权限矩阵保护、邀请码只显示一次、审计、设置越界 422、连续失败锁定返回 423（而非 429）、`/admin` 与 `/admin/users` 真实渲染。

### 6.4 手动验收清单（视觉与体验）

1. 深/浅主题切换无闪烁（首帧脚本），所有组件在两种主题下对比度达标。
2. 落地页滚动时导航毛玻璃出现，`prefers-reduced-motion` 下无位移动画。
3. 表格 hover / 选中 / 排序箭头 / 分页器状态清晰；空列表显示"暂无用户 + 邀请"。
4. 危险操作（删除用户、撤销邀请、踢下线）均需二次确认；删除用户需输入其用户名。
5. 表单错误内联在字段下方，键盘 Tab 顺序自然，`Enter` 提交，`Esc` 关闭弹层并归还焦点。
6. 所有异步按钮有 loading 态且防重复提交；失败以 toast（`role="alert"`）+ 内联说明双呈现。
7. 375 / 768 / 1280 / 1920 四档截图无布局破损；管理后台在 < 1024 时侧栏折叠为抽屉。
8. ⌘K 命令面板可跳转全部有权限的页面并搜索用户（≤ 150ms 出结果）。

---

## 7. Risks & Mitigations（风险与对策）

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| R1 | 桌面端接入属于根项目改动（`src/app/page.tsx`、`http-client.ts` 等），本轮不实施，可能与后续节点排期冲突 | 用户看不到"桌面登录界面" | 本方案锁定 §3.15 的逐文件契约与 §2.6 的降级矩阵；webserver 先行可独立验收，桌面接入是纯增量（未接入时桌面端行为不变，零回归） |
| R2 | `CLAUDE.md` 明写"No auth"，新增登录面与既有约定冲突 | 维护者误以为引入了多租户 | 明确边界：服务端身份只决定"能否打开应用"；本地业务表 `user_id` 恒为 `LOCAL_OWNER_ID`，不做任何数据迁移；README 与 `docs/desktop-integration.md` 首段写明该不变式 |
| R3 | 破窗账号 `admin/adminjr` 是已知默认口令，可能成为后门 | 安全审计不通过 | 三重约束：①仅在本地配置文件、不发网络请求、服务端无此账号；②默认值只是"首次可救援"，README 强制要求交付前修改，并在 `desktop-config.json` 写入 `localAdminRotated: false` 让 UI 首次登录后提示修改；③本地限速 + 审计 + 不可用于访问云端用户数据（不加载他人数据） |
| R4 | SQLite 单写者 + Next.js 多 worker（standalone 多进程）可能出现 `SQLITE_BUSY` | 偶发 500 | `WAL` + `busy_timeout=5000` + 单例连接 + 部署固定单实例（Docker `replicas: 1`、systemd 单 `ExecStart`）；`next.config.mjs` 不开 cluster；README 注明扩展需换 PostgreSQL |
| R5 | Middleware 在 Edge Runtime 无法用 better-sqlite3，若误在 middleware 校验会话会构建失败 | 构建期报错/线上 500 | §2.2 规则 4 明确禁止；middleware 只做 Cookie 存在性判断；真实鉴权在 server 端；`next.config.mjs` 显式把 `better-sqlite3` 放入 `serverComponentsExternalPackages` 并只从 `server/*` 引入 |
| R6 | 会话令牌存储/刷新轮换实现有误 → 令牌重用或永久会话 | 账号被接管 | 库里只存 HMAC+sha256 哈希；刷新即轮换；重用检测撤销全部会话（有集成测试 AC 覆盖）；访问令牌 TTL ≤ 12h |
| R7 | 邮件未配置时"忘记口令"形同虚设 | 用户自锁 | 默认提供管理员签发临时口令路径（`mode=temp_password`）+ `must_change_password` 强制改密；`/forgot-password` 明确显示"请联系管理员"；CLI 破窗 `user:reset` |
| R8 | 管理员误删/误封 owner 导致无人可管理 | 运维事故 | owner 角色任何 API 不可变更（`cannot_modify_owner`）；系统角色受保护；破窗账号与 CLI 双重救援 |
| R9 | 审计日志无限增长 | DB 膨胀、查询变慢 | `audit_events` 按 `created_at` 索引；README 给出保留策略（默认 180 天）与 `scripts/prune-audit.sql`；本轮不自动清理（避免误删证据） |
| R10 | 前端与后端口令策略阈值不同步 | 用户在浏览器通过、服务端拒绝 | 阈值常量只在 `server/auth/*` 定义，`lib/validators.ts` 由测试强制与之一致（i18n/验证单测断言同一数值） |
| R11 | 视觉要求"顶级"但落地页纯 CSS 资产缺失（截图、OG 图） | 视觉打折 | 截图用应用内已有 `public/` 素材，缺失时用 CSS 绘制的抽象编辑器示意（禁止外链图片）；OG 图由 `next/og` 代码生成 |
| R12 | 新增原生依赖 `better-sqlite3` 在无预编译包的平台安装失败 | 部署阻塞 | 依赖 `node:22-alpine` 有官方预编译；Dockerfile 中显式 `npm ci --omit=dev` 并验证 `require('better-sqlite3')`；README 给出 `python3/make/g++` 兜底说明 |
| R13 | **（v2 新增，R-11）** `migrations/*.sql` 是运行时从磁盘读取的，`output: 'standalone'` 默认**不会**把它们带进产物；镜像里会表现为"启动即失败/迁移永远找不到" | 首次部署即失败，且报错指向"没有迁移"而非"文件缺失"，极易误判 | `next.config.mjs` 用 `outputFileTracingIncludes` 把 `src/server/db/migrations/**` 打进 trace；Dockerfile 再显式 `COPY migrations`；`resolveMigrationsDir()` 支持 `MIGRATIONS_DIR` 覆盖（容器内指向副本） |
| R14 | **（v2 新增，R-09）** 客户端组件接收翻译函数会直接渲染失败：RSC 只能序列化数据，函数 prop 抛 `Functions cannot be passed directly to Client Components`，表现为整站 500 | 全站不可用 | 契约固定为"传 `locale`，客户端内部 `translator(locale)`"；`'use client'` 组件的 props 只允许可序列化值。代码评审时检查 `'use client'` 文件的 props 接口 |
| R15 | **（v2 新增，R-04）** 在 `instrumentation.ts` 里初始化数据库会让 `next build` 失败（Edge 编译期解析 `better-sqlite3`） | 构建阻塞，且错误信息指向 `Module not found: Can't resolve 'fs'`，容易误以为是依赖装错 | 启动序列改为请求期惰性（§2.3），构建期整体跳过；`better-sqlite3` 仅允许从 `src/server/**` 引入，且列入 `serverExternalPackages` |

---

## 8. Appendix（附录）

### 8.1 i18n 键结构

```
common.*           保存/取消/删除/确认/搜索/上一页/下一页/加载中/重试
nav.*              产品/功能/定价/文档/登录/控制台/下载
marketing.*        落地页九段文案（hero.*、features.*、showcase.*、pricing.*、faq.*）
auth.*             login.*、register.*、forgot.*、reset.*、errors.*
account.*          profile.*、security.*、sessions.*、activity.*、danger.*
admin.*            overview.*、users.*、roles.*、invites.*、audit.*、settings.*
permissions.*      每个权限键的中英文名与描述
errors.code.*      与 §4.4 一一对应的用户可读文案
```
规则：值只允许字符串（不支持复数规则）；插值用 `{name}`；`zh-CN` 为默认与回退；`i18n.test.ts` 断言两语言键集合完全相等。

### 8.2 性能预算

| 指标 | 目标 |
|---|---|
| 落地页 LCP（中端机，4G 仿真） | < 1.8s |
| 首屏 JS（落地页 / 控制台） | < 140 KB / < 210 KB gzip |
| `GET /admin/users`（1 万用户，第 1 页） | < 120ms（本机 SQLite） |
| 登录端到端（本机） | < 250ms（scrypt 约 60–100ms 为主） |
| 内存常驻 | < 220 MB |

### 8.3 后续路线（明确不在本轮）

1. 桌面端登录界面接入（阶段 7 契约已有，待后续节点实施）。
2. 2FA / TOTP、WebAuthn（`sessions` 增加 `mfa_level` 字段即可扩展，接口预留 `POST /auth/mfa/verify`）。
3. 订阅与计费（`users.plan_tag` 已预留；接入支付后新增 `subscriptions` 表与 webhook 端点）。
4. 邮件验证与邮件模板可视化编辑。
5. PostgreSQL 适配 + 多实例部署（仓储层已隔离 SQL，需重写 `db/client.ts` 与迁移语法差异）。
6. 管理端实时事件（SSE，见 §4.7）。
7. 数据导出（GDPR）：`GET /me/export` 生成 JSON 压缩包。

### 8.4 与需求原文的对应关系（自检）

| 需求原文 | 本方案落点 |
|---|---|
| 在项目下新增 Web Server 子项目（`Web Server` 目录） | `webserver/`（§2.1、§3 全部） |
| 用于网站部署 + 用户管理 | §2.12 部署产物（Docker/Nginx/systemd）+ §4.2 管理端点 |
| 有外部界面，管理员可增删改查账号与分配权限 | §3.10 管理后台 + §4.2 `admin/*` + §5.3 角色权限矩阵 |
| 桌面端登录需连外部项目验证 | §2.6 形态 A + §4.5 `/auth/login` `client=desktop` + §3.15 契约 |
| 桌面端最高权限账号写死配置文件 `admin/adminjr`，不联网 | §2.6 形态 B + `desktop-config.json.localAdmin` + IPC 常量时间比对 |
| 其他用户必须登录，注册/登录连服务端 | §2.7 T1/T2 + §4.2 `auth/*` |
| Supabase 风格，顶级设计/体验/交互 | §2.8 设计系统（色板 token、字体、间距、动效、组件形态）+ §6.4 手动清单 |
| 登录后先看落地页；管理员进用户管理；普通用户看/改自己信息 | §3.7 路由结构 + §2.7 T5 + AC-07/AC-14/AC-25 |
| 未考虑到的功能由你完善 | 审计日志、邀请码、设备会话管理、账户锁定与解锁、限流、系统设置、运营指标、CLI 破窗、部署与备份、i18n、SEO、可访问性、离线宽限（§2.6/§2.9/§2.11/§8.3） |

---

**本文件的边界**：只定义设计与施工图，不含实现代码。下游实现必须严格遵循 §3.13 的阶段顺序与各阶段完成判据；任何与本文件冲突的实现都视为缺陷，应先修订本文件（并在 `docs/plans/webserver-user-management/` 下记录变更原因）再改代码。

---

## 评审结论

**结论：有条件通过（Approved with conditions）**

### 判定依据

| 维度 | 判定 | 说明 |
|---|---|---|
| 可行性 | 通过（修正后） | v1 有 2 处**会直接阻断构建/运行**的方案（R-04 instrumentation 选错运行时、R-01 重用检测原理不可实现），均已在 v2 改正并在参考实现中验证。技术栈（Next 15 + better-sqlite3 + scrypt）与仓库现状一致，无新的原生编译面，无根项目耦合。 |
| 完整性 | 通过（修正后） | v1 缺 4 处闭合路径：软删恢复无数据来源（R-05）、restore 路由文件缺失（R-06）、迁移文件未纳入 standalone 产物（R-11）、带 Cookie 的登录未定义 CSRF（R-10）。均已补齐。 |
| 一致性 | 通过（修正后） | 三处自相矛盾全部消除：限流阈值 vs 锁定阈值（R-02）、排序参数命名（R-07）、AC-25 的三条互斥结论（R-08）。与 `CLAUDE.md` 的既有约定（无 auth 的桌面端、只做加法式 DDL、不用 Alembic、Clean Code 阈值）无冲突，且 §2.6 / §3.15 的"业务 `user_id` 恒为 `LOCAL_OWNER_ID`"不变式与根项目约定相容。 |
| 规模适当性 | 通过 | 首轮范围（落地页 + 认证 + 账号中心 + 管理后台 + REST + 部署 + 测试）对"1/3 轮"而言偏满但可交付：§3.13 的 8 个阶段各自有独立判据，任一阶段可独立验收；明确延后的能力（2FA、WebAuthn、支付、SSE、PostgreSQL、GDPR 导出）都记录在 §8.3，没有偷偷塞进本轮。 |

### 放行条件（必须全部满足才算真正完成）

1. **C1 — 三条 P0 必须有回归测试**：刷新令牌重放 → 全部会话被撤销且写入 `refresh_token_reuse_events`；连续失败第 6 次返回 `423 account_locked`（不是 `429`）；`?hard=true` 在目标用户有审计历史时仍能删除成功。
2. **C2 — RSC 边界必须有构建期防线**：所有 `'use client'` 组件的 props 只允许可序列化值；CI 跑一次 `next build` + 访问 `/`、`/admin`、`/account` 三条真实页面（`Functions cannot be passed directly to Client Components` 只会在渲染期暴露，纯类型检查抓不到）。
3. **C3 — 端到端冒烟作为发布门禁**：`node scripts/smoke.mjs` 对运行中的服务全绿（AC-31），否则不允许进入阶段 7 的部署验收。
4. **C4 — 破窗账号默认口令必须在上线前轮换**：`localAdmin.password` 的默认值 `adminjr` 只允许存在于模板与 README 示例中；交付检查表需记录轮换证据（R3 的三重约束不解除）。
5. **C5 — 迁移文件随产物分发**：Docker 镜像内 `MIGRATIONS_DIR` 可用、`/api/v1/ready` 在容器内返回 200；否则首次部署会以"没有迁移"的形式失败（R13）。

### 明确接受的风险（不再作为阻塞项）

- **单实例约束**：SQLite WAL 只允许一个写入进程。多副本需求出现时必须换 PostgreSQL，这是已知且已文档化的架构边界，不在本轮解决。
- **进程内限流**：重启即清零，多实例不同步。作为粗粒度防洪可接受，真正的凭证防线是账号锁定。
- **邮件能力可选**：未配置 SMTP 时自助找回关闭、改由管理员签发一次性口令。这是产品取舍，不是缺陷。
- **桌面端接入未在本轮实施**：§3.15 只产出逐文件契约。桌面端未接入时行为零变化（纯增量），是本轮可交付性的前提。

### 与参考实现的关系

`webserver/` 下已有一份**参照本文件（v2）实现并通过验证**的代码：`npm run type-check` / `npm run lint` 零问题、`npm test` 112 项全绿、`next build` 产出 37 条路由、`node scripts/smoke.mjs` 46 项端到端断言全绿。本文档中的每一处 v2 修正都对应其中一处真实修复（评审记录中标注「实现验证」）。下游若从零实现，请以本文件为准；若在现有 `webserver/` 上继续，请先跑上述四条命令确认基线。

---

**评审签署**：Senior Reviewer（Anthropic engineering） · 2026-10-08 · 版本 v2

---

## 实施过程发现的方案缺陷

本节记录实施阶段发现的、与本设计（v2）不一致或本设计未闭合的地方，以及实际采用的处理方式。按约束「不静默偏离」，每一条都先在这里记账，再以修正后的做法实现。

### D-01（缺端点）`POST /me/deletion-request` 在 §4.2 端点表里不存在

- **现象**：§3.10 要求交付 `components/account/DangerZone.tsx`（「申请注销：写审计 + 通知管理员」），`services/profileService.requestAccountDeletion()` 也已实现，但 §4.2 没有任何与之配套的端点，导致该 service 是死代码、账号中心也没有入口。
- **处理**：新增 `src/app/api/v1/me/deletion-request/route.ts`（`POST`，需会话 + Cookie 请求需 CSRF；写 `user.deletion_requested` 审计；**不删除账号**），并在 `/account` 页面接入 `DangerZone`。`docs/api.md` 的 `/me` 表已补该行与 curl 示例。

### D-02（文件计划 vs 实现形态）§3.8 的 22 个 UI 基元按职责合并

- **现象**：§3.8 逐文件列出 `input/label/textarea/select/checkbox/...` 等 22 个 shadcn 基元；`webserver/` 现有实现把它们合并为 `ui/{button,dialog,field,badge}.tsx`（`field.tsx` 内含 Field/Input/Textarea/Select/Checkbox）。
- **处理**：沿用合并形态，不新增 20 个空壳文件——逐个文件搬运不会改变行为，只会让「哪个 input 才是样式来源」变模糊。新组件一律从这 4 个模块取基元。

### D-03（命名）`server/auth/session.ts` 落在了服务层

- **现象**：§3.3 规划 `server/auth/session.ts`。
- **处理**：实现为 `server/services/sessionService.ts`，与 `authService`/`profileService` 同层，避免 `auth/`（纯函数原语）与 `services/`（状态与审计）之间出现两份会话逻辑。§3.3 的其余文件（password/tokens/permissions/guards/rateLimit/weakPasswords/constants）均按原路径落地，`guards.ts` 负责「从请求解析会话」，`sessionService` 负责「会话生命周期」。

### D-04（文件计划 vs 实现形态）控制台外壳类组件合并，本轮补 CommandPalette

- **现象**：§3.10 的 `ConsoleSidebar.tsx` / `Topbar.tsx` / `UserMenu.tsx` 在实现中合并进 `console-shell.tsx`；`FilterBar` / `BulkActionBar` / `EmptyState` / `StatCard` 以局部组件形式内联在 `users-table.tsx`、`data-table.tsx`、概览页中。真正缺功能的是 `CommandPalette.tsx`（手动清单第 8 条「⌘K」）。
- **处理**：本轮新增 `components/console/command-palette.tsx`（⌘/Ctrl+K 开合、方向键 + Enter、Esc 关闭、按权限过滤的导航项），并在 `console-shell.tsx` 顶栏接入，命令列表与侧栏共用同一份 `adminNav`，因此不会出现「面板里有、侧栏里没有」的越权入口。其余内联组件保持现状（拆成文件不改变行为，但会打散「列表 + 批量 + 筛选」的一处阅读上下文）。

### D-05（依赖清单）§3.14 列的 `cmdk` / `next-themes` / `sonner` 未被引入

- **现象**：§3.14 把三者列为运行依赖，但现有实现自研了 toaster（`shell/toaster.tsx`）、主题脚本（`lib/theme.ts` + `shell/theme-toggle.tsx`）与命令面板（本轮 D-04）。
- **处理**：不新增依赖。CLAUDE.md §8「新依赖必须必要」优先于文件清单的措辞；三个库各自只覆盖本仓库 30–120 行已自足的能力，引入后仍需自行处理 a11y/主题首帧/键盘焦点。若后续需要 toast 队列或主题 provider 的更多能力，再按实际需要引入并回写本节。

### D-06（测试形态）`e2e/critical-flows.spec.ts` 未创建，端到端由冒烟脚本承担

- **现象**：§3.12 规划 Playwright 用例；§3.14 注明「`@playwright/test` 仅 e2e 阶段安装」。
- **处理**：本轮不引入 Playwright（需要浏览器二进制与独立 CI 阶段），端到端门禁由 `scripts/smoke.mjs` 承担并对运行中的 standalone 服务执行真实 HTTP 断言。本轮把它从 46 项扩到 **52 项**：新增详情页渲染、未知 id → 404、OG 图（从落地页 `og:image` 读取真实哈希路径后取图）、`/me/deletion-request` 不删除账号。Playwright 阶段开始时，本节改为「已补」。

### D-07（脚本缺口）`seed:demo` 只有脚本名，没有实现

- **现象**：§3.1 的 `package.json` 列了 `seed:demo`，§3.2 列了 `seedDemoData()`，但两者都不存在。
- **处理**：补 `seedDemoData()`（幂等，已存在账号不改口令）与 `scripts/seed-demo.ts`，并在 `NODE_ENV=production` 时直接失败——演示口令写在仓库里，生产环境出现演示账号等于开后门。

### D-08（门禁可复现性）冒烟脚本连跑会产生假失败

- **现象**：`scripts/smoke.mjs` 的锁定用例会烧掉失败次数，同一进程连跑两次时第二次会被登录 IP 限流（20 次 / 5 分钟）拦住，表现为「设置接口 422 失败」「/admin 不渲染」等一连串与代码无关的红灯。
- **处理**：README 的验收自检注明「冒烟须对新启动的进程执行」；本轮验证即按「清空一次性 DB → 重启 standalone → 跑一次」执行，结果 52/52。

### D-09（本轮补齐的计划文件清单）

`(console)/admin/layout.tsx`、`(console)/admin/users/[id]/page.tsx`、`(console)/admin/users/[id]/…` 之外的详情组件、`(marketing)/opengraph-image.tsx`、`lib/permissionsCatalog.ts`、`lib/validators.ts`、`lib/theme.ts`、`lib/api/endpoints.ts`、`components.json`、`components/console/{user-detail,user-form-dialog,confirm-dialog,user-sessions-panel,command-palette,forbidden-notice}.tsx`、`components/account/{session-list,danger-zone}.tsx`、`tests/integration/rbac.matrix.test.ts`、`tests/unit/catalog.test.ts`、`scripts/seed-demo.ts`、`api/v1/me/deletion-request/route.ts`。其中 `admin/layout.tsx` 采用**就地渲染 403**（`ForbiddenNotice`）而不是 `redirect('/admin/forbidden')`：该路由位于同一 layout 之下，重定向会重新进入 layout 形成无限循环，浏览器只会表现为白屏。

---

## 代码评审（Subtask #3）发现并就地修复的缺陷

评审按「覆盖性 / 回归风险 / 命名与风格」三维对照本文件正文执行，全部修复均已在源码中落地并复跑门禁。下面只列**本设计（v2）自身未闭合、因而照抄就会出错**的部分；纯实现笔误不记账。

### D-10（文件计划 vs 实现形态）迁移文件拆成 3 个，种子改由 `seed.ts` 承担

- **现象**：§3.2 规划 `0002_seed_roles.sql`（以 SQL 写系统角色与权限矩阵），§5.2 把
  `refresh_token_history` 放在 `0001_init.sql` 里。实现是
  `0001_init.sql`（表与索引）+ `0002_hardening.sql`（refresh 重用事件、
  role_change_events、`idx_users_email`）+ `0003_refresh_history.sql`（刷新历史链），
  角色/权限/`app_settings` 默认值改由 `db/seed.ts#runSeed()` 幂等写入。
- **处理**：保留实现形态，理由是不用「一次性迁移」而用「启动期幂等种子」：
  `0001_init.sql` 是已发布的结构基线，再往里塞新表意味着「已迁移的库永远不会补上」；
  而权限矩阵是**每次启动都要重新断言**的东西（`owner` 恒为 `*`，且管理员不能把
  `admin` 的 `users.delete` 删掉——见 `seed.ts` 注释），写在迁移里只能在升级那一刻生效一次。
  §3.2 的文件清单因此按下表对应：`0002_seed_roles.sql` → `db/seed.ts`；
  `refresh_token_history` → `0003_refresh_history.sql`；另加 `0002_hardening.sql`。

### R-23（P1，安全）`/auth/refresh` 用 `Authorization` 头判定载体，桌面端刷新全链路不可用

- **现象**：`if (!bearer) assertCsrf(context)` 把「没有 Bearer 头」等同于「Cookie 会话」。而 §2.6 的桌面契约是 `POST /auth/refresh` + body `{refreshToken}`，**不带** `Authorization`（访问令牌刚刚过期，这正是刷新存在的原因），也没有任何 Cookie。于是 `assertCsrf` 必然 403；即便绕过，响应走 Cookie 分支，新令牌不进 body。结果是 `DESKTOP_REFRESH_TOKEN_TTL_DAYS=90` 形同虚设，桌面用户每 12 小时必须重新输口令。
- **处理**：按**令牌来源**而非请求头分模式——body 里带 `refreshToken` 即桌面模式（回 body，免 CSRF），否则读 `ecs_refresh` Cookie 即浏览器模式（回 Cookie，必须带 `X-CSRF-Token`）。§2.9.5「无 Cookie 即无 CSRF 面」即此判据。

### R-24（P1，安全）`/auth/login` 的 CSRF 触发条件绑错 Cookie

- **现象**：§2.5 第 6 步与 §2.9.5 都写「请求携带 **`ecs_session`** Cookie 时必须校验」，实现按 `ecs_csrf` 是否存在触发。只要会话 Cookie 还在而 CSRF Cookie 缺失（用户手工清理、扩展干扰、两个 Cookie 的 maxAge 将来被改得不一致），登录接口就退化为完全无保护的登录 CSRF——攻击者页面可把受害者浏览器切入攻击者账号。
- **处理**：判据改为 `ecs_session` Cookie 是否存在；缺失 `ecs_csrf` 时正确返回 403 而不是放行。`/auth/logout` 同步收敛为「有会话 Cookie 才校验」，避免无 Cookie 的登出被 403 挡掉。

### R-25（P1，数据）`app_settings.updated_by` 是第 4 个会阻塞物理删除的外键

- **现象**：§5.2 只把 `audit_events.actor_user_id` / `registration_invites.created_by` / `password_reset_tokens.issued_by` 改成 `ON DELETE SET NULL`，漏了 `app_settings.updated_by TEXT REFERENCES users(id)`。任何进过 `/admin/settings` 保存设置的账号（`settingsService.patch` 会写入真实 actor id）执行 `?hard=true` 都会 `FOREIGN KEY constraint failed` → 500。（已用真实 SQLite 复现。）
- **处理**：DDL 补 `ON DELETE SET NULL`；同时在 `usersRepo.hardDelete` 里先把该列的引用清空再删——SQLite 无法就地修改外键，纯改 DDL 只能救新建库，救不了已经建好的库，而重建表等于 DROP（违反加法式迁移铁律）。

### R-26（P1，正确性）软删除的恢复元数据只有一条路径写对

- **现象**：§2.7 T3 / §5.4 规定 `user.delete` 的 metadata 必须含原 email 与 username，是恢复的唯一来源。但 `PATCH /admin/users/{id} {status:"deleted"}` 走的是通用 patch，写的是 `user.update`，于是 `restoreUser` 永远找不到原值 → 通过 PATCH 删除的账号**不可恢复**。同一处还有两个衍生缺陷：`PATCH {status:"active"}` 把已删账号「激活」时不清 `deleted_at`、不还原墓碑化的 `email_normalized`，得到一个既不能登录、其原邮箱又对下一次注册显示为空闲的残废账号。
- **处理**：删除与恢复收敛为各自唯一的生命周期入口（`deleteUser` / `restoreUser`），`updateUser` 遇到这两个状态变更直接转发；删除时的「撤销会话 + 墓碑 + 审计」放进**同一事务**，且审计经 `auditRepo.insert` 直写而非经 `auditService.record`（后者按设计吞错，而这一行是恢复的唯一凭证）。

### R-27（P1，安全）管理写接口的 CSRF 与限流靠逐文件手抄，漏了一处

- **现象**：§4.6 给 `admin:write` 120/分钟、`read:user` 600/分钟，§4.1 要求 Cookie 会话写请求全部校验 CSRF。实现里这两步在 12 个 admin 写路由中逐一手写，结果是 `POST /admin/users/{id}/unlock` **完全没有 CSRF**（跨站即可清空锁定与失败计数，正好配合口令爆破），且除 `admin/users` 的 POST/PATCH 外都没有 `admin:write`；`LIMITS.readUser` 一次都没被调用。
- **处理**：在 `guards.ts` 增加 `requireAdminWrite()`（权限 → CSRF → `admin:write`）与 `requireAdminRead()`（权限 → `read:user`），全部 admin 路由改用它。一处实现、一套顺序，不再有「漏抄一行就少一道防线」的可能。

### R-28（P1，安全）`X-Forwarded-For` 取第一段 + Nginx 用 `$proxy_add_x_forwarded_for`

- **现象**：§2.12 明文要求 `proxy_set_header X-Forwarded-For $remote_addr`，交付的示例配置写的是 `$proxy_add_x_forwarded_for`（**追加**语义：`<客户端自己写的>, <真实 IP>`），而代码取 `split(',')[0]`。两者组合让客户端完全掌控 `context.ip`：登录 20/5 分钟、注册 10/小时、找回 3/小时三条 IP 限额，以及 `login_attempts.ip` 与 `audit_events.ip` 全部可伪造。
- **处理**：示例配置改回 `$remote_addr`（与 §2.12 一致）；代码改取**最后一段**——正常部署下两者取值相同，前端配置出错时退化为「不准但不可伪造」，而不是「信谁写谁」。

### R-29（P1，正确性）`/me/activity` 的 SQL 布尔优先级错误，泄露全部历史

- **现象**：`WHERE actor_user_id = ? OR (target_type='user' AND target_id = ?) AND created_at >= ? AND action IN (…)`——`AND` 比 `OR` 紧，`actor_user_id` 分支因此绕开了 90 天窗口与 `SELF_VISIBLE_ACTIONS` 白名单，普通用户在账号中心能看到自己的**全部**审计行（含 `role.*`、`settings.update`、`user.delete`）。§2.7 T5 的「白名单 + 90 天」形同虚设，且 count 与列表同错，前端分页看起来完全正常。
- **处理**：整个归属条件加括号，count 与分页共用同一个 `where` 常量，避免两者再次漂移。

### R-30（P1，部署）镜像构建必然失败 + 迁移无处可跑

- **现象**：① `Dockerfile` 的 `COPY --from=builder /app/public ./public` 在 `webserver/` 下没有 `public/`，Docker 对不存在的 COPY 源是硬错误；② 缺 `webserver/.dockerignore`，`COPY . .` 会把宿主 `node_modules`（Windows 二进制，会覆盖 deps 阶段的 musl 构建）、`.next`、`data/*.db` 和 **`.env`** 一并带上——Next 会把 `.env` trace 进 `.next/standalone`，镜像层里因此躺着一份可用的 dev `SESSION_SECRET` 与 root 口令；③ compose 设 `AUTO_MIGRATE=false`，而运行镜像不含 `tsx`/`scripts`，空卷首启必然「检测到未应用迁移 → exit(1)」并被 `restart: unless-stopped` 无限重启，§3.13 阶段 7 的「`docker compose up` 后 `/ready` 返回 200」不可达。
- **处理**：① 补 `webserver/public/.gitkeep`（保留该 COPY 行，未来静态资源有落点）；② 新增 `.dockerignore`（`node_modules`/`.next`/`data`/`coverage`/`.env`）；③ compose 改 `AUTO_MIGRATE=true` 并写明理由——单写者 SQLite 不存在多副本场景，迁移器幂等且每步单事务，重复启动无副作用；将来若要多副本，必须先预迁移再关掉它。

### R-31（P2，一致性）`X-Request-Id` 只在失败响应上出现

- §4.1 要求「每个响应带 `X-Request-Id`」，实现只在错误路径设置。**处理**：`withContext` 在成功返回前统一补头，一处覆盖全部端点。

### R-32（P2，可用性）`reset:ip` 被申请与确认共用一个桶

- §4.6 只给了 `reset:ip`（3/小时），实现同时套在 `request` 与 `confirm` 上：确认码手误 3 次即耗光配额，用户当小时连**申请**新链接都被拒——恢复流程把自己锁在门外。§4.2 对 `confirm` 本来也没要求限流。**处理**：`confirm` 改用独立桶 `resetConfirmIp`（10/小时）；这不取消防爆破，只是不让两个端点互相吃配额（本条是 §4.6 之外的补充 scope，故在此记账）。

### R-33（P2，一致性）删除接口的权限与 owner 闸门

- §4.2 规定 `DELETE /admin/users/{id}` 的权限是 `users.delete`（软删与硬删同一格），实现软删走的是 `users.write`——只授 `users.write` 的角色可以删账号，属越权降级。同时「`?hard=true` 仅 owner」在路由与 service 都没有实现，而 `admin` 角色自带 `users.delete`，等于不存在。**处理**：权限统一为 `users.delete`；`hard=true` 追加 `requireOwner()`。`POST /admin/users/bulk` 的 `setRole` 亦按 §2.9.12 追加 `roles.write`。

### R-34（P2，体验）前端若干系统性缺陷

- 相对时间在 SSR 阶段计算（5 处，§R-17 明令禁止）→ 新增 `components/shell/relative-time.tsx`：首帧输出确定性 UTC 绝对时间，挂载后再换相对时间，`relativeTime/absoluteTime/formatNumber` 的 `locale` 改为必填，杜绝漏传。
- `errorMessage(code, 'zh-CN')` 写死 14 处 → 英文界面下报错仍是中文；全部改为组件自己的 `locale`。
- 邀请码撤销按钮引用了不存在（合并 i18n 时被删）的 `admin.security.revoke`，`t()` 兜底返回 key 本身，管理员看到裸 key；状态徽章直接渲染英文 `active/exhausted/…`。→ 新增 `admin.invites.revoke` 与 4 个 `admin.invites.state.*` 键（中英同批）。
- 侧栏与 ⌘K 的 admin 导航由客户端用**单个** `users.read` 标志位重建，无视已有逐项权限，support 角色因此看到「角色/邀请码/设置」三个必然 403 的入口。→ 导航整体在 `(console)/layout.tsx` 按各项真实权限过滤后再下发，外壳只负责分组渲染。
- 「界面语言」下拉只写 `users.locale`，而 `resolveLocale()` 只读 `ecs_lang`，`POST /api/v1/locale` 无任何调用者——保存成功但界面不变。→ 保存后按需调用该端点写 Cookie。
- 6 个文件（`register-form`、`console-shell`、`users-table`、两个测试、`smoke.mjs`）为 CRLF，其余为 LF。→ 统一为 LF。

### 评审后验证结果

- `npm run type-check` 0 error、`npm run lint` 0 warning（`--max-warnings 0`）。
- `npm test`：**149 项全绿**（14 个文件）。新增 `tests/integration/admin.lifecycle.test.ts` 7 项，逐条钉住 R-25/R-26/R-29 三条回归：PATCH 删除后可恢复、设置过配置的账号可物理删除、`/me/activity` 不再泄露白名单外与 90 天外的记录。
- `next build`：成功产出 standalone。

