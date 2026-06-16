# Desktop Root-Admin Login Gate — 设计方案 (spec.md)

> Feature slug: `desktop-root-admin-login-gate`
> Document version: **v2** (方案评审与修复 / Subtask #1 产出；v1 为 Subtask #0 方案设计)
> Author: Solution Architect (Anthropic engineering)
> Reviewer: Senior Reviewer (Anthropic engineering) — 见 §「评审记录」与「评审结论」
> Status: Reviewed — 有条件通过 (P0/P1 已就地修复，遗留 P2 见验收清单)
> Last updated: 2026-06-16

---

## 评审记录（Review Notes — Subtask #1）

> 评审维度：**可行性 (Feasibility)** / **完备性 (Completeness)** / **一致性 (Consistency)** / **规模合理性 (Right-sizing)**。
> 评审方法：逐节比对方案与真实代码（已核对 `AuthContext.tsx`、`page.tsx`、`LoginModal.tsx`、`login/page.tsx`、`http-client.ts`、`isDesktop.ts`、`desktopAuth.ts`、`backendService.js`、`envCheck.js`、`index.js`、`dev.js`、`env.template(.desktop)`、`auth_service.py`、`config.py`、`database.py` 等锚点）。
> 结论：方案整体**可行且锚点准确**（行号与现状一致，后端 root 认证链路确已存在，水合闸门 `ready=hydrated` 模式 page.tsx 已在用）。但存在 3 个 P1 与若干 P2，已在本版（v2）就地修复。

### 严重度图例

- **P0** — 阻断：不修则功能无法工作 / 存在严重缺陷。
- **P1** — 高：会导致可见缺陷、安全控制静默失效或方案与现状矛盾，必须在实现前修复。
- **P2** — 中/低：一致性、文案、健壮性改进，建议在实现阶段一并处理。

### P0

- 无。逐节核对后未发现阻断性缺陷：登录闸门仅覆盖 `/` 与 `/login` 两个路由（`src/app/**/page.tsx` 仅此两个），二者都渲染同一 `LoginScreen`，桌面端入口全覆盖；后端 root 认证（`auth_service.py:151-160` 常量时间比对 `.env`）与 seeding（`database.py:122-184`，root 口令不参与 hash 校验）改口令安全；冷启动不会卡在 `isLoading`（已明确置 `false`）。

### P1（本版已修复）

- **P1-1｜`src/lib/api/http-client.ts` 漏入变更清单，且 §2.4 误述桌面端 401 行为。**
  - 现状核实：`handleSessionExpired()`（`http-client.ts:164-197`）在桌面端**第 189 行直接 `return`，根本不跳转 `/login`**——只有 Web 端才 `window.location.href='/login?reason=session-expired'`。原 §2.4 第 1 步与 §2.4 注释称"`/login` 跳转仍可保留 / 两条路径都汇聚"对桌面端是**事实错误**：桌面端 401 从不触发该跳转。
  - 更严重：该函数 186-190 行注释写着"AuthContext re-runs silent auto-login off the event instead"——本方案删除静默登录后，此注释**与新设计直接矛盾**，会误导实现者。
  - **修复**（见 §3 新增文件 #23、§2.4 重写、§9 R4 改写）：把 `http-client.ts` 纳入变更清单；**保留** `isDesktop()` 提前 `return`（它恰好正确——避免与原地闸门竞争而闪现 `/login`），改为更新该处注释以反映"事件触发 AuthGate 在 `/` 原地浮现 `LoginScreen`，而非静默重登"；R4 的"双登录界面竞争"在桌面端**不可能发生**，降级为提示。

- **P1-2｜`DesktopTitleBar` 双重渲染：登录界面会出现两条标题栏 / 重复窗口控件。**
  - 现状核实：`page.tsx:137` 与 `login/page.tsx:45` 均**已无条件**渲染 `<DesktopTitleBar/>`（浏览器端渲染 null）。而 §6.1 又让 `LoginScreen` **自带**一条 `<DesktopTitleBar/>`。若 `AuthGate` 仅包裹 body（§2.1 图示把页级标题栏置于 `AuthGate` 之外），则登录态下页级标题栏与 `LoginScreen` 标题栏**叠加**，出现两套拖拽/最小化/关闭控件——直接违背"顶级设计"要求。
  - **修复**（见 §2.1 图、§3 #6/#7、§6.1、新增 §2.7 层级约定）：确立"**整窗仅一条标题栏**"不变式——`LoginScreen` 独占标题栏；未认证时 `AuthGate` 短路**整个** HomePage（含页级 `DesktopTitleBar`），只渲染 `LoginScreen`；`login/page.tsx` 切到 `LoginScreen` 后**移除**自身的 `DesktopTitleBar` 与重复的会话过期提示条（改由 `LoginScreen` 承载）。

- **P1-3｜`ROOT_ONLY_LOGIN` 配置链路不完整，安全开关可能被静默忽略。**
  - 现状核实：`get_settings()` 在 `config.py:970-976` 显式构造 `AuthConfig(...)`，**只传** `admin_*/root_*/invite_code`。§3 #16 仅说"`AuthConfig` 增字段 + `get_settings()` 读 env"，**未提**必须把新字段传进 970-976 的构造调用；若实现者遗漏这一步，`root_only_login` 永远取模型默认值 `False`，桌面模板里的 `ROOT_ONLY_LOGIN=true` 会被**静默忽略**——一个安全控制无声失效。此外 §5.2 用裸赋值（`root_only_login: bool = False`），与现状 `AuthConfig` 一致使用的 `Field(default=..., description=...)` 风格不符（CLAUDE.md：与既有风格一致）。
  - **修复**（见 §3 #16 细化、§4.4 增解析约定、§5.2 改用 `Field()`）：明确三步缺一不可——①模型加 `root_only_login: bool = Field(default=False, ...)`；②读取 `ROOT_ONLY_LOGIN` 并按既有布尔解析（`config.py:1138` 的 `in {"1","true","yes","on"}` 约定）；③**在 970-976 的 `AuthConfig(...)` 构造里把 `root_only_login=...` 传进去**。

### P2（建议实现阶段处理；已在 v2 标注，不阻断）

- **P2-1｜桌面端测试文件命名与项目约定不符。** §3 #21 写 `desktop/main/__tests__/envCheck.test.js`，但 `desktop/main/` 无 `__tests__/`，既有约定是**同级** `*.test.js`（如 `desktop/main/window-state.test.js`）。已改为 `desktop/main/envCheck.test.js`。（前端 #19/#20 用 `__tests__/` 与 `src/hooks/__tests__/` 约定一致，保留。）
- **P2-2｜删除静默登录后多处注释变陈旧。** `dev.js:45-52`、`index.js:107-120`、`desktopAuth.ts`、`AuthContext.tsx` 内的 "silent auto-login" 注释会失真；§3 对应条目已补"同步更新注释"。
- **P2-3｜`ROOT_ONLY_LOGIN` 非 root 拒绝是否记登录历史未定。** 既有失败口令路径会 `_record_login_history`（`auth_service.py:167`）。为一致性，§3 #17 已注明：拒绝时**复用同一 `INVALID_CREDENTIALS` 文案/错误码**（防账户枚举，D5），登录历史记录与否由实现者按既有失败分支对齐。
- **P2-4｜模板头注释与 `ROOT_PASSWORD` 实值冲突。** `env.template.desktop` 头部声明"模板内只允许占位符(your_*_here)"，但 `ROOT_PASSWORD` 现为 `change_me_on_first_run`、本方案改为真实默认 `adminjr`。§3 #13 已注明顺带订正该头注释，说明 `ROOT_USERNAME/ROOT_PASSWORD` 携带真实默认值（属既有事实）。
- **P2-5｜迁移会静默改变可用口令。** backfill 把旧默认 `change_me_on_first_run` 迁到 `adminjr` 后，**被接受的口令随之改变**；§9 R3 已补充：旧默认为显式"change-me"占位、无人记忆，风险可接受，但需在 README 注明。
- **P2-6｜`AuthGate` 必须"替换"而非"并列"子树。** 已核实 `useTasks` 仅读写 localStorage、`useLlmConfigStatus` 已按 `isAuthenticated` 门控，故未认证时不会发鉴权请求；但为防 future 回归，§2.1/§3 #2 已明确 `AuthGate` 未认证时**以 `LoginScreen` 取代 children**（数据组件不挂载），并在 §8.2 新增 AC：登录界面期间无 `MissingAuthError`/失败鉴权请求/控制台报错。

---

## 1. Overview (概述)

### 1.1 需求陈述

桌面端（打包后的 Electron 应用）当前在启动时执行**静默自动登录**（`silentDesktopLogin()`）：主进程通过 IPC 把 `ROOT_USERNAME` / `ROOT_PASSWORD` 暴露给渲染进程，`AuthContext` 在挂载时与 401 会话过期时自动用这对凭证登录，用户**从不**看到登录界面。

本需求要求把这一行为**反转**为一个**强制登录闸门（mandatory login gate）**：

1. 在 env 文件中配置一个"根管理员账户"，默认 `admin / adminjr`；
2. 打包后的桌面端启动时，**先打开一个登录界面**，要求用户**手动输入**用户名和密码；
3. 用户**只能**使用这个提前配置好的根管理员账户登录（不开放注册、不接受其他账户）；
4. 登录成功后**正确加载并持久化登录状态**，保证后续请求都带上会话凭证；
5. 登录面板要**美观优雅、顶级设计、符合人机交互最佳实践**。

### 1.2 与现状的差距（Why）

后端的"根账户认证"链路**已经完整存在**且无需重写：`auth_service.authenticate_user()` 对 `is_root` 用户用 `hmac.compare_digest` 直接比对 `.env` 里的 `ROOT_PASSWORD`（常量时间比较，`.env` 为唯一事实来源）；`config.py` 已按 `ROOT_* > ADMIN_*` 的优先级读取 env；`database.py` 启动时按 env 同步/创建唯一 root 用户；默认 `INVITE_CODE` 为空即关闭自助注册。因此"只能用配置好的账户登录"在后端层面**几乎天然成立**，只需把默认口令改为 `adminjr`，并补一个可选的"仅 root 可登录"硬闸门即可。

真正要改的是**前端与桌面装配层**：

- **删除静默自动登录**（`AuthContext` 的挂载路径与会话过期路径），让桌面端在"无有效会话"时落到登录界面而不是自动登录；
- **新增一个强制登录闸门**：桌面端未认证时全窗口渲染一个**不可关闭**的登录界面，盖住整个应用；
- **设计一个专门的、顶级视觉质量的登录面板**（`LoginScreen`），替代/补充现有的 `LoginModal`；
- **把默认口令统一为 `admin/adminjr`**，并提供从旧默认值（`change_me_on_first_run` / `change_me_in_production`）平滑迁移的逻辑。

### 1.3 范围与非目标（Scope / Non-Goals）

**范围内**：桌面端强制登录闸门、登录界面 UI、登录状态持久化校验、env 默认凭证、凭证在三处（后端子进程 / dev 启动器 / 桌面模板）的一致传播、可选的 `ROOT_ONLY_LOGIN` 后端硬闸门、相关 i18n 与文档。

**非目标**：

- 不引入 JWT / OAuth / 多用户 / 找回密码 / 记住设备等能力；单设备会话语义沿用现有 `active_session_token`。
- 不改变 Web（浏览器）端的现有交互（Web 仍是"着陆页 + 按钮触发登录弹窗"），仅桌面端强制闸门。理由见 §7 决策 D2；如需 Web 也强制，仅需把闸门条件中的 `isDesktop()` 去掉，是单行改动。
- 不改动后端会话校验、单设备挤下线等既有逻辑。

---

## 2. Technical Design (技术设计)

### 2.1 架构总览

```
┌────────────────────────── Electron 主进程 (desktop/main) ──────────────────────────┐
│ index.js: 启动 splash → 解析端口 → 起后端(:backendPort) → 起前端(:frontendPort)        │
│           → createMainWindow("http://127.0.0.1:<frontendPort>")  (即加载 `/` 路由)     │
│ backendService.js: 把 userData/.env (含 ROOT_USERNAME/ROOT_PASSWORD) 注入后端子进程    │
│ envCheck.js: 首次复制 env.template.desktop;backfill healing(本方案扩展 STALE_DEFAULTS)│
└───────────────────────────────────────────────────────────────────────────────────┘
                                   │ 加载 `/`
                                   ▼
┌────────────────────────────── 渲染进程 (Next.js `/`) ──────────────────────────────┐
│ <AuthProvider> (AuthContext)                                                        │
│   - 挂载: 校验 localStorage 会话 → 有效则 authenticated;无效/无 → unauthenticated     │
│     (★ 删除桌面端 silentDesktopLogin 调用)                                            │
│ HomePage(page.tsx)                                                                  │
│   <AuthGate>  ← ★ 新增                                                               │
│     ├─ 未水合      → BootPlaceholder(中性占位)                                        │
│     ├─ isLoading   → BootPlaceholder(spinner)                                        │
│     ├─ 桌面端 && !isAuthenticated → <LoginScreen/>  ← ★ 新增,全窗口、不可关闭          │
│     └─ 其余        → 既有应用(VerticalTaskbar/Container/LandingPage…)                  │
└───────────────────────────────────────────────────────────────────────────────────┘
                                   │ POST /api/auth/login (Next 代理透传)
                                   ▼
┌────────────────────────────────── 后端 (FastAPI) ─────────────────────────────────┐
│ auth_router.login → auth_service.authenticate_user                                  │
│   - (本方案新增可选) ROOT_ONLY_LOGIN 时:非 root 用户直接 INVALID_CREDENTIALS           │
│   - root 用户: hmac.compare_digest(input, ***REMOVED***)  ← .env 唯一源 │
│   - 成功 → session_service.create_session → 返回 {success,user,session_token}          │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键代码路径（现状锚点 → 改动）

| 锚点（现状） | 文件:行 | 改动 |
|---|---|---|
| 桌面端挂载静默登录 | `src/contexts/AuthContext.tsx:222-238` | 删除 `void silentDesktopLogin()` 两处调用，桌面端改为与 Web 一致：置 `unauthenticated, isLoading=false` |
| 会话过期静默重登 | `src/contexts/AuthContext.tsx:296-301` | 删除 `if (isDesktop()) void silentDesktopLogin()`，仅清状态（闸门会自动浮现） |
| 静默登录实现 | `src/contexts/AuthContext.tsx:398-426` | 整段删除 `silentDesktopLogin` 函数、`desktopLoginInFlightRef`(110)、`getBootstrapCredentials` import(23) |
| 应用根渲染 | `src/app/page.tsx:133-249` | 用 `<AuthGate>` 包裹主体；桌面端未认证渲染 `<LoginScreen/>` |
| 现有登录弹窗 | `src/components/LoginModal.tsx` | 抽出 `useLoginForm` 共享逻辑;视觉对齐新设计（Web 仍用它） |
| 后端 root 比对 | `app/services/auth_service.py:151-160` | 之前插入 `ROOT_ONLY_LOGIN` 判定（非 root 早退） |
| env 读取 | `app/config.py:962-976` | 增加 `root_only_login` 读取 |
| 桌面凭证模板 | `desktop/scripts/env.template.desktop:55-56` | `ROOT_PASSWORD=adminjr` + `ROOT_ONLY_LOGIN=true` |
| 后端凭证模板 | `backend-services/basic-service/env.template:89-94` | `ROOT_PASSWORD=adminjr` |
| dev 凭证 | `desktop/scripts/dev.js:51-52` | 默认 `ROOT_PASSWORD=adminjr`（dev 也走登录界面，与生产一致） |
| backfill healing | `desktop/main/envCheck.js:91-120` | 扩展为也修复 `STALE_DEFAULTS`（旧默认口令）迁移到 `adminjr` |
| 启动 IPC 兜底默认 | `desktop/main/index.js:117-120` | 兜底口令改 `adminjr`（静默登录移除后此 IPC 退化为可选；见 §7-D4） |

### 2.3 时序：桌面端冷启动 → 手动登录

```
1. 用户启动 .exe
2. 主进程: 起后端(注入 ROOT_USERNAME=admin / ROOT_PASSWORD=adminjr) + 起前端 → 后端 seeding 出唯一 root 用户(口令以 .env 为准)
3. 主窗口加载 http://127.0.0.1:<port>/  (即 HomePage)
4. AuthProvider 挂载: localStorage 无会话 → setAuthState({unauthenticated, isLoading:false})
5. AuthGate: hydrated && isDesktop() && !isAuthenticated → 渲染 <LoginScreen/>(全窗口,含 DesktopTitleBar)
6. 用户在登录界面输入 admin / adminjr → 提交
7. AuthContext.login() → authLogin() → POST /api/auth/login (Next 透传) → 后端 hmac 比对 .env → 200 {user, session_token}
8. login() 写 localStorage(SESSION_USER_KEY, SESSION_TOKEN_KEY) + setSessionToken(cookie) + setAuthState({authenticated})
9. AuthGate: isAuthenticated=true → 卸载 LoginScreen,渲染应用
10. page.tsx didAutoOpenRef effect: 桌面端且无持久化标签 → createTask('video') 直达剪辑工作区
```

### 2.4 时序：登录后会话过期（401）

```
1. 任意 browser→backend 调用返回 401 → http-client.handleSessionExpired():
     a. 清 localStorage(token+user)
     b. 派发 'ecliptrix:session-expired'
     c. ★ 桌面端在此 return —— 不跳转 /login(http-client.ts:189 既有早退)
2. AuthContext 的 session-expired 监听: 清状态 → setAuthState({unauthenticated})  (★ 不再 silentDesktopLogin)
3. AuthGate 重新计算: 桌面端 && !isAuthenticated → 原地浮现 <LoginScreen reason="session-expired"/>
4. 用户重新输入 admin/adminjr → 回到 §2.3 第 7 步
```

> **桌面端不存在 `/login` 跳转**（P1-1 评审修正）：`http-client.ts:164-197` 的 `handleSessionExpired()` 对 `isDesktop()` **第 189 行直接 `return`**，从不执行 `window.location.href='/login'`——这条早退**正确且必须保留**：它让 401 经由 `ecliptrix:session-expired` 事件驱动 `AuthGate` 在 `/` **原地**浮现 `LoginScreen`，而不是整窗导航到 `/login` 造成闪屏与竞争。实现阶段须**更新该处现已失真的注释**（其原文称"AuthContext re-runs silent auto-login"——静默登录已被本方案删除），改述为"事件触发原地登录闸门"。
> Web 端行为不变：非 `/login`/`/register` 路径仍重定向到 `/login?reason=session-expired`。`/login` 路由（§3 文件 **#7**）本方案改为渲染同一 `<LoginScreen/>`，故 Web 的"跳 /login"与桌面的"原地浮现"汇聚到同一视觉。

### 2.5 凭证传播一致性（三处必须同源）

`admin/adminjr` 必须在以下三处一致，否则"用户输入的口令"与"后端校验的口令"不匹配会 401：

1. **后端子进程**：`backendService.js:30-32` 把 `userEnv`（即 `userData/.env`）展开进后端 env；`userData/.env` 首次由 `env.template.desktop` 复制而来 → 模板设 `ROOT_PASSWORD=adminjr`。
2. **dev 启动器**：`dev.js:51-52,193-195,250-251` 把 `ROOT_USERNAME/ROOT_PASSWORD` 注入后端**和**Electron → 默认改 `adminjr`。
3. **后端默认 / 文档**：`env.template`（后端）、README 默认登录说明统一为 `admin/adminjr`。

升级安装（已有旧 `userData/.env`）通过 §2.6 的 backfill 迁移收敛到 `adminjr`。

### 2.6 升级迁移（旧默认口令 → adminjr）

`backfillUserEnv()` 当前只修复 `^your_*` 形态的占位符（`PLACEHOLDER_PATTERN`）。旧版桌面模板的默认口令是 `change_me_on_first_run`（后端模板是 `change_me_in_production`），它们**不是**占位符形态，不会被现有 backfill 触碰，导致升级用户停留在旧默认口令、与本需求"默认 adminjr"不一致。

**方案**：在 `envCheck.js` 引入 `STALE_DEFAULTS`（`Set` 包含 `'change_me_on_first_run'`、`'change_me_in_production'`），`backfillUserEnv` 在判定"是否需要回填"时，把"值等于 STALE_DEFAULTS 之一"也视为可迁移（与占位符同等对待），用模板新值（`adminjr`）就地改写。规则保持幂等、保留注释/顺序、用户自定义的真实口令（非占位、非 stale-default）不动。

> 安全权衡：这等于把"出厂默认口令"自动升级为新出厂默认口令，不覆盖任何用户自选口令，风险可控（详见 §8 风险 R3）。

### 2.7 渲染层级与"整窗仅一条标题栏"不变式（P1-2 评审新增）

桌面端无边框窗口的拖拽/最小化/关闭控件由 `<DesktopTitleBar/>` 承载（浏览器端渲染 `null`）。现状 `page.tsx:137` 与 `login/page.tsx:45` **均已无条件**渲染一条 `DesktopTitleBar`。本方案的 `LoginScreen`（§6.1）**自带**标题栏，因此必须确立**不变式：任一时刻整窗有且仅有一条 `DesktopTitleBar`**，否则登录界面会叠出两套窗口控件。

约定（实现须严格遵守）：

- **`LoginScreen` 独占标题栏**：登录态由 `LoginScreen` 自身渲染唯一的 `DesktopTitleBar`。
- **`AuthGate` 短路整个 HomePage**：未认证（桌面）时，`AuthGate` **取代整个 HomePage 主体**（含页级 `DesktopTitleBar`、`Header`、`Container` 等），**只**渲染 `<LoginScreen/>`；即 `AuthGate` 在层级上**包住** `page.tsx:137` 的标题栏，而非仅包住下方 body。等价做法：把页级 `DesktopTitleBar` 与应用主体一起放进 `AuthGate` 的"已认证 / children"分支。
- **`AuthGate` 以 `LoginScreen` 取代 children（而非并列）**：未认证时数据组件（`Container` 等）**不挂载**，从而不会在登录界面期间触发任何鉴权请求（已核实 `useTasks` 仅 localStorage、`useLlmConfigStatus` 已按 `isAuthenticated` 门控）。
- **`login/page.tsx` 去重**：该路由切换到 `<LoginScreen/>` 后，**删除**其自身的 `DesktopTitleBar`（#7 第 45 行）与重复的会话过期提示条（第 47-54 行），统一由 `LoginScreen` 承载。

更新后的 §2.1 渲染进程视图（标题栏归属已明确）：

```
HomePage(page.tsx)
  <AuthGate>                         ← ★ 新增,包住"标题栏 + 主体"整体
    ├─ 未水合 / isLoading            → BootPlaceholder(中性占位 / spinner)
    ├─ 桌面端 && !isAuthenticated    → <LoginScreen/>  ← 唯一 DesktopTitleBar 在此
    └─ 其余(已认证 / Web)            → <DesktopTitleBar/> + 既有应用(Header/Container/LandingPage…)
```

---

## 3. File / Module Change Plan (文件 / 模块变更计划)

> 约定：本节产出（spec.md）属于 Subtask #0；下表是 Subtask #2 实现阶段要落的代码清单。

| # | 文件 | 动作 | 一句话意图 |
|---|---|---|---|
| 0 | `docs/plans/desktop-root-admin-login-gate/spec.md` | 新增 | 本设计文档（当前节点产出） |
| 1 | `src/components/auth/LoginScreen.tsx` | 新增 | 全窗口、不可关闭、顶级视觉的登录界面；含品牌区 + 表单 + `DesktopTitleBar`；接受 `reason?` 提示 |
| 2 | `src/components/auth/AuthGate.tsx` | 新增 | 闸门组件：依据 `hydrated / isLoading / isDesktop() / isAuthenticated` 决定渲染 BootPlaceholder / LoginScreen / 应用。未认证时**以 `LoginScreen` 取代整个 HomePage 主体（含页级 `DesktopTitleBar`）**，children 不挂载（§2.7） |
| 3 | `src/components/auth/useLoginForm.ts` | 新增 | 共享登录表单 hook（用户名/口令 state、校验、提交、loading/error、capsLock、显隐口令），供 LoginScreen 与 LoginModal 复用，避免重复 |
| 4 | `src/components/auth/LoginScreen.module` 样式（若不用 Tailwind 内联）| 可选 | 仅在内联 Tailwind 不足以表达动效时新增；默认不需要 |
| 5 | `src/contexts/AuthContext.tsx` | 修改 | 删除 `silentDesktopLogin` 及其在挂载/会话过期处的调用、`desktopLoginInFlightRef`、`getBootstrapCredentials` import；桌面端无会话时置 `unauthenticated,isLoading=false` |
| 6 | `src/app/page.tsx` | 修改 | 用 `<AuthGate>` 包住**页级 `DesktopTitleBar`(137) + 应用主体**整体（§2.7 单标题栏不变式）；按钮触发的 `LoginModal` 保留（Web 仍用） |
| 7 | `src/app/login/page.tsx` | 修改 | 改为渲染 `<LoginScreen reason={reason}/>`（统一登录视觉），保留"已登录则 router.replace('/')"；**删除自身 `DesktopTitleBar`(45) 与重复的会话过期提示条(47-54)**，统一由 `LoginScreen` 承载（§2.7） |
| 8 | `src/components/LoginModal.tsx` | 修改 | 改用 `useLoginForm`；视觉令牌对齐新设计（Web 端按钮触发场景保留） |
| 9 | `src/lib/i18n.ts` | 修改 | 新增/补全登录界面文案键（品牌标语、口令显隐、CapsLock 提示、会话过期提示、占位符等），中英双语 |
| 10 | `src/lib/desktop/desktopAuth.ts` | 修改/删除 | `getBootstrapCredentials` 随静默登录移除而成为死代码；删除该文件或保留并标注 deprecated（见 §7-D4） |
| 11 | `desktop/main/index.js` | 修改 | `auth:bootstrap-credentials` 兜底口令 `change_me_on_first_run`→`adminjr`；该 IPC 退化为可选（静默登录已移除）；同步更新 107-120 处提及 "silent login" 的失真注释（P2-2） |
| 12 | `desktop/main/envCheck.js` | 修改 | 引入 `STALE_DEFAULTS`，`backfillUserEnv` 同时迁移旧默认口令到模板新值 |
| 13 | `desktop/scripts/env.template.desktop` | 修改 | `ROOT_PASSWORD=adminjr`；新增 `ROOT_ONLY_LOGIN=true`；订正头部"模板内只允许占位符(your_*_here)"注释，说明 `ROOT_USERNAME/ROOT_PASSWORD` 携带真实默认值（P2-4） |
| 14 | `desktop/scripts/dev.js` | 修改 | `ROOT_PASSWORD` 默认 `adminjr`（dev 与生产一致地走登录界面）；更新 45-52 处 "silent auto-login" 失真注释（P2-2） |
| 15 | `backend-services/basic-service/env.template` | 修改 | `ROOT_PASSWORD=adminjr`；新增 `ROOT_ONLY_LOGIN`（默认 false，文档说明桌面端为 true） |
| 16 | `backend-services/basic-service/app/config.py` | 修改 | **三步缺一不可（P1-3）**：①`AuthConfig` 加 `root_only_login: bool = Field(default=False, ...)`；②`get_settings()` 读 `os.getenv("ROOT_ONLY_LOGIN")` 并按 `config.py:1138` 既有布尔约定 `in {"1","true","yes","on"}` 解析；③**在 970-976 的 `AuthConfig(...)` 构造中传入 `root_only_login=...`**（漏此步则开关静默失效） |
| 17 | `backend-services/basic-service/app/services/auth_service.py` | 修改 | `authenticate_user` 在取到 user(129 行)之后、口令比对(151 行)之前插入：若 `settings.auth.root_only_login and not user.is_root` → 返回与现有失败分支**完全一致**的 `INVALID_CREDENTIALS` 文案/错误码（不泄露账户存在性，D5）；登录历史是否记录与现有 `invalid_password` 分支保持一致（P2-3） |
| 18 | `README.md` / `README.zh-CN.md` | 修改 | 默认登录改为 `admin / adminjr`；新增"桌面端启动需登录"说明 |
| 19 | `src/components/auth/__tests__/AuthGate.test.tsx` | 新增 | 闸门状态机单测（boot/login/app 三态、桌面 vs Web、会话过期） |
| 20 | `src/components/auth/__tests__/LoginScreen.test.tsx` | 新增 | 表单校验/提交/错误/可访问性（焦点、aria、CapsLock、显隐口令）单测 |
| 21 | `desktop/main/envCheck.test.js` | 新增 | STALE_DEFAULTS 迁移单测：旧默认→adminjr、用户自选口令不动、幂等。**用同级 `*.test.js` 约定**（如 `desktop/main/window-state.test.js`），项目无 `__tests__/`（P2-1） |
| 22 | `backend-services/basic-service/tests/test_auth_root_only.py` | 新增 | `ROOT_ONLY_LOGIN` 开启时非 root 被拒、root 仍可登录的集成测试 |
| 23 | `src/lib/api/http-client.ts` | 修改 | **P1-1**：`handleSessionExpired()`(189 行)的 `isDesktop()` 早退**保留**（让 401 由 `AuthGate` 原地浮现 `LoginScreen` 处理，不跳 `/login`）；更新 186-190 处现已失真的注释（原称 "AuthContext re-runs silent auto-login"——静默登录已删除），改述为"事件触发原地登录闸门" |

> 变更不触碰构建产物 / `__pycache__` / `.next` / `.idea`（遵循 CLAUDE.md gitignore 注意事项）。

---

## 4. Interface Design (接口设计)

### 4.1 复用的 REST 接口（无签名变更）

- `POST /api/auth/login`：请求 `{ username: string, password: string }`；成功 `{ success: true, user: UserInfo, session_token: string }`；失败 401 `{ success:false, message, error_code:"INVALID_CREDENTIALS" }`。（`src/app/api/auth/login/route.ts` 透传到后端 `auth_router.login`）
- `POST /api/auth/validate-session`：`{ user_id, session_token }` → `{ success, valid, reason?, is_root?, user? }`。
- `POST /api/auth/logout`：带会话头，清后端 `active_session_token`。

### 4.2 组件接口（新增）

```ts
// src/components/auth/AuthGate.tsx
interface AuthGateProps {
  children: React.ReactNode; // 受保护的应用主体
}
// 行为：SSR/未水合 → BootPlaceholder;isLoading → BootPlaceholder;
//       isDesktop() && !isAuthenticated → <LoginScreen/>;否则 children。

// src/components/auth/LoginScreen.tsx
interface LoginScreenProps {
  reason?: 'session-expired' | null; // 顶部提示条文案选择
}
// 不接受 onClose —— 闸门界面不可关闭(强制登录)。

// src/components/auth/useLoginForm.ts
interface UseLoginFormResult {
  username: string; password: string;
  setUsername(v: string): void; setPassword(v: string): void;
  showPassword: boolean; toggleShowPassword(): void;
  capsLockOn: boolean; onPasswordKeyEvent(e: React.KeyboardEvent): void;
  isLoading: boolean; error: string;
  canSubmit: boolean;            // username && password && !isLoading
  submit(e?: React.FormEvent): Promise<void>; // 调 AuthContext.login,统一错误处理
}
```

### 4.3 桌面 IPC（现状，本方案不再依赖于登录，但保留）

- `ipcMain.handle('auth:bootstrap-credentials', …)`（`index.js:117-120`）：静默登录移除后不再被前端调用。保留为无害可选项；兜底口令更新为 `adminjr`。preload 暴露的 `window.ecliptrixDesktop.getBootstrapCredentials` 同样退化为未使用。

### 4.4 配置接口（env 变量）

| 变量 | 默认 | 含义 | 读取处 |
|---|---|---|---|
| `ROOT_USERNAME` | `admin` | 根账户用户名 | `config.py:966` |
| `ROOT_PASSWORD` | `adminjr`（模板默认） | 根账户口令，`.env` 为唯一事实来源 | `config.py:967`，启动校验 `config.py:1147` |
| `ROOT_ONLY_LOGIN` | `false`（后端默认）/ `true`（桌面模板） | 为 true 时仅允许 root 用户登录 | `config.py` 970-976 构造 `AuthConfig` 时传入，按 `in {"1","true","yes","on"}` 解析（同 `config.py:1138` 约定）；`auth_service` 新增判定 |
| `INVITE_CODE` | 空 | 空=关闭自助注册 | `config.py:968` |
| `ADMIN_USERNAME/ADMIN_PASSWORD` | `admin/admin` | 弃用回退（`ROOT_*` 未设时生效） | `config.py:964-965` |

---

## 5. Data Model (数据模型)

### 5.1 后端 ORM（现状，仅引用不改结构）

`User`（`app/models/db_models.py:15-41`）关键字段：`id(UUID PK)`、`username(unique)`、`password_hash`、`is_active`、`is_admin`、`is_root`、`user_role`、`active_session_token`、`session_created_at/device_info/ip_address`、`last_login_at`。root 用户口令**不入库**（`password_hash` 对 root 不参与校验），以 `.env` `ROOT_PASSWORD` 为准。

`database.py` 启动 seeding：按 `settings.auth.root_username/root_password` 同步出**唯一** `is_root=True, is_admin=True` 用户；多 root 时降级多余者。**本方案不改 seeding**。

### 5.2 `AuthConfig`（`app/config.py:380-398`，新增一字段）

现状 `AuthConfig` 全部字段使用 `Field(default=..., description=...)`（见 `config.py:380-398`），新增字段须**沿用同一风格**（CLAUDE.md：与既有约定一致），不可用裸赋值：

```python
class AuthConfig(BaseModel):
    admin_username: str = Field(default="admin", description="...(deprecated)")
    admin_password: str = Field(default="admin", description="...(deprecated)")
    root_username: str  = Field(default="admin", description="...")
    root_password: str  = Field(default="", description="...")   # 启动校验要求非空
    invite_code: str    = Field(default="", description="...")
    # ★ 新增:为 true 时仅 root 可登录(防御纵深, 桌面模板默认开启)
    root_only_login: bool = Field(
        default=False, description="When true, only the root user may log in"
    )
```

⚠️ 仅加字段不够——`get_settings()` 在 `config.py:970-976` 显式构造 `AuthConfig(...)`，必须**同时**在该构造调用里传入 `root_only_login=<解析后的 env 值>`，否则字段恒为默认 `False`，桌面模板的 `ROOT_ONLY_LOGIN=true` 被静默忽略（见 §3 #16 三步）。

### 5.3 前端登录状态（现状，localStorage / cookie）

- `localStorage["ecliptrix-user"]` = `User`（camelCase，见 `normalizeUser`）。
- `localStorage["ecliptrix-session-token"]` = 会话 token；`setSessionToken()` 同时写同源 cookie，供 `<video>`/媒体标签请求带会话。
- 会话生命周期：登录写入 → 每 5 分钟 `validateSession` 续验 → 401 触发 `ecliptrix:session-expired` 清除。**本方案不改这些 key 与续验逻辑**，仅改"无会话时的去向"（闸门而非静默登录）。

### 5.4 `User`（前端类型，`src/types/auth.ts`，引用）

`{ id, username, email?, avatar?, fullName?, avatarUrl?, userRole?, isAdmin?, isRoot? }`。登录成功后 `isRoot=true`，`AuthContext` 派生 `isRoot/isAdmin/canManageUsers/canManageAdmins`。

---

## 6. UI / UX Design — 登录面板（顶级设计要求）

> 目标：美观优雅、顶级设计、符合人机交互最佳实践。以下为可直接落地的视觉与交互规范，沿用项目既有 Tailwind + CSS 变量主题（shadcn "new-york"，class 暗色模式）。

### 6.1 布局（`LoginScreen`）

- **全窗口**：`fixed inset-0`，背景为带品牌氛围的渐变（`bg-background` 之上叠加柔和径向高光，暗色模式自适应），居中卡片。
- **顶部**：`<DesktopTitleBar/>`（无边框窗口需要拖拽/最小化/关闭控件；浏览器端渲染 null）。⚠️ 这是登录态下**唯一**的标题栏——调用方（`AuthGate` 在 `/`、`login/page.tsx` 在 `/login`）**不得**再渲染第二条（§2.7 单标题栏不变式）。
- **双栏卡片**（≥ lg）：左为**品牌英雄区**（`public/logo-ai.png` Logo + 产品名 "Ecliptrix" + 标语 "Where light and shadow collide" + 3 条能力点），右为**登录表单**；< lg 折叠为单栏（仅表单 + 顶部精简 Logo）。
- 卡片：`rounded-2xl border border-border bg-card/90 backdrop-blur shadow-2xl`，最大宽度 ~ `max-w-4xl`，入场轻微淡入+上移（`opacity/translate`，尊重 `prefers-reduced-motion` 时禁用）。

### 6.2 表单与控件

- 字段：**用户名**（`autoComplete="username"`，自动聚焦）、**口令**（`autoComplete="current-password"`，右侧**显隐切换**眼睛按钮）。
- **提交按钮**：全宽主色（`bg-primary`），`disabled` 当 `!canSubmit`；loading 时按钮内嵌 spinner + 文案切到"登录中…"。
- **回车提交**：表单 `onSubmit`；按钮为 `type="submit"`。
- 默认**不预填**任何凭证（严格满足"要求用户输入用户名和密码"）；可在表单下方放一行**极轻量提示**（仅 `NEXT_PUBLIC_SHOW_DEV_HINTS=true` 时）："默认账户见部署文档"，绝不在 UI 明文写出口令。

### 6.3 反馈与状态

- **错误**：用户名/口令为空 → 内联校验文案；登录失败 → `role="alert" aria-live="assertive"` 的错误条（红色，`bg-destructive/10`）+ 一次性 toast；用户开始输入即清错。
- **CapsLock 提示**：口令框监听 `keydown/keyup` 的 `getModifierState('CapsLock')`，开启时在口令框下方显示"⇪ 大写锁定已开启"。
- **会话过期**：`reason==='session-expired'` 时顶部黄色提示条"会话已过期，请重新登录 / Your session has expired."。
- **网络/超时**：复用 `AuthContext.login` 既有的 `TimeoutError`/`NETWORK_ERROR` 文案分支。

### 6.4 可访问性（A11y，沿用 LoginModal 既有实现并加强）

- `role="dialog" aria-modal="true" aria-labelledby`；**焦点陷阱**（Tab/Shift+Tab 环绕，复用 `getFocusable`）。
- 闸门界面**不响应 Escape 关闭**（强制登录，无可关闭语义）——与 `LoginModal`（可 Escape 关闭）的关键差异。
- 所有输入有 `<label htmlFor>`；错误用 `aria-describedby` 关联；按钮有可辨识文本/`aria-label`。
- 对比度满足 WCAG AA；显隐口令按钮 `aria-pressed`。

### 6.5 设计令牌（统一引用主题变量，禁止硬编码颜色）

`--background/--foreground/--card/--border/--input/--ring/--primary/--primary-foreground/--muted/--muted-foreground/--destructive`。暗色模式由 `darkMode:["class"]` 驱动，登录界面在两种模式下都需校验。

---

## 7. 关键设计决策（Decisions）

- **D1 闸门放在 `page.tsx`（`/` 路由）而非全局 `layout.tsx`**：`layout.tsx` 包裹所有路由（含 `/login`），若在此强制闸门会与 `/login` 自渲染登录界面冲突并造成双重渲染。放在 `/`（应用主入口、也是桌面窗口默认加载的 URL）最小化影响面，`/login` 作为独立路由各自渲染同一 `LoginScreen`。
- **D2 仅桌面端强制闸门，Web 维持现状**：需求明确针对"打包后的桌面端"；Web 端着陆页/按钮登录是既有产品形态，强行闸门属超范围回归风险。条件写作 `isDesktop() && !isAuthenticated`，未来要 Web 强制只需删去 `isDesktop()`。
- **D3 删除静默登录而非加开关**：保留 `silentDesktopLogin` 并加 flag 会让"是否显示登录界面"取决于运行时分支，增加状态空间与歧义。需求是确定性的"必须手动登录"，直接删除最清晰；dev 启动器同步去自动登录以保证 dev/prod 一致（避免"dev 不弹、prod 弹"的体验漂移）。
- **D4 `bootstrap-credentials` IPC 退化为可选**：移除静默登录后该 IPC 不再被调用。为降低改动面，保留 IPC + preload 暴露但更新兜底口令；可在 Review 阶段按"清理死代码"原则删除 `desktopAuth.ts` 与 IPC（标注于 §3 文件 #10/#11）。
- **D5 `ROOT_ONLY_LOGIN` 作为防御纵深而非唯一手段**：默认（唯一 root + `INVITE_CODE` 空关闭注册）已满足"只能用配置账户登录"；新增 flag 是为升级库里可能残留的非 root 用户兜底，桌面模板默认开启，错误信息与"用户不存在/口令错误"一致以防账户枚举。

---

## 8. Testing & Acceptance Criteria (测试与验收)

### 8.1 单元 / 集成测试

1. **`AuthGate` 状态机**（#19）：未水合→BootPlaceholder；`isLoading`→BootPlaceholder；`isDesktop()&&!authenticated`→`LoginScreen`；`authenticated`→children；Web 端 `!authenticated`→children（不闸门）。
2. **`LoginScreen` 表单**（#20）：空字段拒绝提交并提示；成功调用 `login` 后由父级（闸门）切换；失败显示 `role="alert"`；CapsLock 提示出现/消失；显隐口令切换；焦点初始落在用户名、Tab 环绕、Escape 不关闭。
3. **`useLoginForm`**：`canSubmit` 真值表；`submit` 透传 `AuthContext.login` 的成功/失败/超时分支。
4. **`envCheck` STALE_DEFAULTS 迁移**（#21）：`ROOT_PASSWORD=change_me_on_first_run`→`adminjr`；用户自选口令（如 `MyP@ss`）不动；占位符仍迁移；二次运行幂等不重写。
5. **后端 `ROOT_ONLY_LOGIN`**（#22，真实 SQLite 集成、不 mock 鉴权）：开启时 root 用户用 `adminjr` 登录成功、非 root 用户被拒（`INVALID_CREDENTIALS`）；关闭时非 root 行为不变。复现 bug 须先写测试（遵循 CLAUDE.md 测试规约）。

### 8.2 端到端验收（桌面走查 — mandatory gate）

- [ ] **AC1 启动即登录界面**：打包桌面端冷启动，splash 后**首屏为登录界面**（不再静默进入应用）。
- [ ] **AC2 仅配置账户可登录**：输入 `admin/adminjr` 成功进入应用；输入任意其他用户名/口令（如 `admin/wrong`、`user/adminjr`）被拒并提示。
- [ ] **AC3 登录态持久化**：登录后关闭并重开应用，会话在有效期内自动恢复（无需再次输入）；过期或登出后再次回到登录界面。
- [ ] **AC4 登录后功能正常**：登录后桌面端自动打开视频剪辑工作区（`didAutoOpenRef`），后续 API 请求带 token、无 401。
- [ ] **AC5 会话过期回闸**：手动使会话失效（清后端 token / 等待挤下线），应用自动回到登录界面，重新登录可恢复。
- [ ] **AC6 视觉与可访问性**：登录面板在明/暗两种模式下美观；**整窗仅一条 `DesktopTitleBar`**（无重复窗口控件，P1-2/R9）；键盘全程可操作（聚焦、Tab 环绕、回车提交）；显隐口令与 CapsLock 提示工作；UI 不暴露明文口令。
- [ ] **AC7 凭证同源**：dev (`npm run dev`) 与打包端都用 `admin/adminjr`；升级安装经 backfill 迁移后同样为 `adminjr`。
- [ ] **AC8 构建/类型**：`npm run type-check` 与 `npm run build` 通过；后端 `pytest tests/ -v` 通过。
- [ ] **AC9 登录界面无副作用请求**（P1-1/P2-6）：停留在登录界面期间，DevTools 无 `MissingAuthError`、无失败的鉴权请求、无 401 重定向到 `/login`（桌面端 401 只原地浮现闸门）。

### 8.3 Definition of Done（本节点 / Subtask #0）

- `docs/plans/desktop-root-admin-login-gate/spec.md` 已创建并在 `git status` 可见。
- 覆盖 Overview / Technical design / File-change plan / Interface / Data model / Testing / Risks 全部章节，篇幅 ≥ 800 字。
- 详细到下游可逐行实现而无需再决策。

---

## 9. Risks & Mitigations (风险与缓解)

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 凭证三处不同源（后端校验口令 ≠ 用户输入）导致登录恒 401 | 高：用户无法进入应用 | §2.5 单一事实来源清单 + AC7 显式校验 dev/打包/升级三场景；backfill 迁移收敛 |
| R2 | 闸门用 `isDesktop()` 在 SSR 恒 false，渲染期分支造成水合不一致或桌面端闪现一帧应用 | 中：闪烁/控制台告警 | 以 `hydrated` 为闸门（沿用 `page.tsx:98 ready` 模式）：未水合两端都渲染中性 BootPlaceholder，水合后才求值 `isDesktop()` |
| R3 | STALE_DEFAULTS 自动迁移误改用户**故意**设为旧默认值的口令；且迁移后被接受的口令**静默由旧默认变为 `adminjr`** | 低：极少数用户口令被改为 adminjr；可能困惑 | 仅迁移精确等于已知出厂默认字符串者；不触碰任何其他值；迁移写入日志（`self-healed …`）可追溯。旧默认 `change_me_on_first_run` 本就是显式"change-me"占位、无人会记忆，故口令变更可接受；README 须注明"升级后请用 `admin/adminjr`"（P2-5） |
| R4 | ~~会话过期时 `/login` 跳转与原地闸门竞争出现双登录界面~~ → **桌面端此竞争不存在**（P1-1） | 极低 | 已核实 `http-client.ts:189` 对桌面端**早退、从不跳 `/login`**：桌面 401 只走"事件→`AuthGate` 原地浮现 `LoginScreen`"单一路径。Web 端 `/login` 与 `AuthGate` 渲染**同一** `LoginScreen`，且 `/login` 在 `isAuthenticated` 后 `router.replace('/')`，两路径互斥收敛 |
| R5 | 登录界面把口令明文写进 UI/日志，泄露默认凭证 | 中：安全 | UI 不显示口令；dev 提示仅 `NEXT_PUBLIC_SHOW_DEV_HINTS=true` 且不含口令；后端日志既有"不记录敏感信息"约定；root 比对用常量时间 `hmac.compare_digest` |
| R6 | `LoginScreen` 与 `LoginModal` 逻辑重复导致后续维护漂移 | 低 | 抽 `useLoginForm` 共享提交/校验/状态；两组件仅差"可关闭/品牌布局" |
| R7 | 后端启动校验要求 `ROOT_PASSWORD` 非空，迁移/模板若漏配会拒绝启动 | 中：后端起不来 | 模板默认 `adminjr` 非空；`config.py:1147` 校验给出明确报错；桌面 `loadUserEnv` 不会把非占位真实值剥离 |
| R8 | 移除 `getBootstrapCredentials` 留下死代码或 import 报错 | 低：构建失败 | 一并删除 import/引用与 `desktopAuth.ts`（或保留并标注 deprecated）；`npm run build`/`type-check` 兜底 |
| R9 | `LoginScreen` 自带标题栏 + 页级/`/login` 标题栏叠加，登录界面出现两套窗口控件（P1-2） | 中：可见 UI 缺陷，违背"顶级设计" | §2.7 确立"整窗仅一条 `DesktopTitleBar`"不变式：`AuthGate` 未认证时短路整个 HomePage（含页级标题栏）只渲 `LoginScreen`；`login/page.tsx` 删除自带标题栏；AC6 走查显式校验仅一条标题栏 |

---

## 10. 实施顺序建议（供 Subtask #2）

1. 后端 env 默认 + `ROOT_ONLY_LOGIN`（#13-#17）→ 保证"只能用 admin/adminjr"成立。
2. `useLoginForm` + `LoginScreen` + `AuthGate`（#1-#3）→ 登录 UI 与闸门。
3. `AuthContext` 删静默登录（#5）+ `page.tsx`/`login/page.tsx` 接入闸门（#6-#7）+ `http-client.ts` 桌面 401 注释除锈（#23，早退保留）。
4. 桌面装配：env 模板、dev.js、envCheck backfill、index.js 兜底（#11-#14）。
5. i18n、README（#9、#18）。
6. 测试（#19-#22）+ 桌面走查（§8.2）。

---

## 11. 实施过程发现的方案缺陷（占位 — 由 Subtask #2 回填）

> 实现阶段如发现本方案与代码现实冲突，请在此分条记录（问题、对方案的偏离、最终取舍），便于 Review 节点对照。

(待回填)

---

## 12. 评审记录

> 已回填：完整的 P0/P1/P2 问题清单与就地修复结论见文档顶部 **「评审记录（Review Notes — Subtask #1）」** 段（按任务约定置于顶部便于先读）。文档版本已提升为 **v2**，评审结论见 §13。

---

## 13. 评审结论（Review Verdict — Subtask #1）

**结论：有条件通过（Approved with conditions）。**

本方案在四个维度上均达标：

- **可行性**：所有现状锚点（行号、函数、文件）经逐一核对与真实代码一致；后端 root 认证链路（`auth_service` 常量时间比对 `.env` + `database.py` 唯一 root seeding）确已存在，仅需改默认口令与补可选硬闸门；水合闸门复用 `page.tsx` 既有的 `ready=hydrated` 模式；`LoginModal` 结构清晰，`useLoginForm` 抽取可直接落地。
- **完备性**：覆盖冷启动 / 会话过期 / 升级迁移 / 凭证三处同源 / 明暗主题 / A11y / 单测 + 集成 + 桌面走查；经本轮修复后补齐了 401 桌面路径、标题栏层级、安全开关三步配链与无副作用请求验收。
- **一致性**：与 CLAUDE.md 的 gitignore 注意事项、`Field()` 配置风格、同级 `*.test.js` 测试约定、错误响应模型对齐（已就地订正偏差）。
- **规模合理性**：仅桌面端强制闸门、Web 维持现状、`ROOT_ONLY_LOGIN` 作为可选防御纵深而非重写鉴权——范围克制、无过度工程；删除静默登录而非加运行时开关，复杂度收敛。

**已就地修复（v2）**：P1-1（`http-client.ts` 入清单 + §2.4 桌面 401 重写 + R4 改写）、P1-2（§2.7 单标题栏不变式 + #6/#7/§6.1/R9 + AC6）、P1-3（`ROOT_ONLY_LOGIN` 三步配链 + §5.2 `Field()` 化 + §4.4 解析约定）。**无遗留 P0/P1。**

**放行条件（Conditions — 留给 Subtask #2 在实现时落实，均为 P2，不阻断开工）**：

1. **C1（同级测试命名）**：桌面端测试用 `desktop/main/envCheck.test.js`，勿创建 `__tests__/`（P2-1）。
2. **C2（注释除锈）**：随静默登录删除，一并更新 `http-client.ts`/`dev.js`/`index.js`/`desktopAuth.ts`/`AuthContext.tsx` 中提及 "silent auto-login" 的失真注释（P2-2）。
3. **C3（枚举防护）**：`ROOT_ONLY_LOGIN` 非 root 拒绝必须复用与现有失败分支一致的 `INVALID_CREDENTIALS` 文案/错误码，登录历史记录与现状对齐（P2-3）。
4. **C4（模板与文档）**：订正 `env.template.desktop` 头部"仅占位符"注释（P2-4）；README/README.zh-CN 注明"升级后请用 `admin/adminjr`"（P2-5）。
5. **C5（出口校验）**：以 §8.2 AC1–AC9（尤其 AC6 单标题栏、AC9 无副作用请求）与 `type-check`/`build`/`pytest` 作为合并前的强制门。

> 移交 Subtask #2：可直接按 §10 实施顺序开工；实现中若与现实冲突，请记入 §11「实施过程发现的方案缺陷」。
