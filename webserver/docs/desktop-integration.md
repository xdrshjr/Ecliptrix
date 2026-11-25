# 桌面端接入契约 v3

本文是 `webserver/` 与 Ecliptrix 桌面端之间的**唯一契约**。桌面端接入实现必须逐条满足；服务端实现已按此契约锁定，改动任一侧都需要同步改另一侧。

**v2 的由来**：v1 是「webserver 用户管理」阶段写下的契约，当时桌面端尚未实现。落地桌面端登录闸门时发现 11 处照抄就会写错的地方（§9 逐条列出），其中 4 处属于 P0（令牌落入渲染进程、打包后配置永远读不到、心跳误踢、`refresh` 全链路 403）。服务端侧的差异已在本地实现，v2 是**已实现事实**的描述，不是计划。

- 服务端 Base URL：权威来源是 `userData/desktop-config.json` 的 `auth.accountServerUrl`（见 §9 D2-09）。
- 所有路径相对 `{ACCOUNT_SERVER_URL}/api/v1`。
- 统一响应信封：`{ success, message, timestamp, data }` / `{ success:false, message, error_code, error:{code,message,details} }`。

---

## 1. 两种登录形态

桌面端存在两种**互不替代**的登录：

| 形态 | 触发 | 网络 | 结果 |
|---|---|---|---|
| A 账号服务器登录 | 用户输入邮箱/用户名 + 口令 | 需要 | `source: "server"`，拿到令牌对 |
| B 本地破窗登录 | 用户点击「使用本地管理员登录」 | **不需要** | `source: "local-root"`，`role: owner`，`permissions: ["*"]` |

形态 B 的凭据来自 `userData/desktop-config.json` 的 `localAdmin`，由主进程用 `crypto.timingSafeEqual` 比对，**渲染进程不得直接读取该值**。它不请求任何端点，也不产生服务端会话。

---

## 2. 端点清单

### 2.1 登录

```
POST /auth/login
Content-Type: application/json

{
  "identifier": "ada@example.com",   // 邮箱或用户名，大小写不敏感
  "password": "…",
  "client": "desktop",
  "clientVersion": "1.0.1",          // 服务端版本闸门用；空串 = 不报版本
  "device": {
    "name": "Ada 的 MacBook",
    "platform": "darwin-arm64",
    "appVersion": "1.0.1",
    "deviceKey": "9b2c1f8e0a4d6c3b7e5f1a2d4c8b6e0f"
  }
}
```

`deviceKey` 是**稳定指纹**（`deriveDeviceKey({userDataPath, hostname})`，8–64 位 `[A-Za-z0-9_-]`），不是随机数、也不是每次启动重新生成：随机数会让「重装」变成换机（顶号失效，每用户会话名额被自己吃光），裸 `hostname` 会让同机房镜像互相顶号。

成功 `200`：

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "…", "email": "ada@example.com", "username": "ada",
      "displayName": "Ada", "status": "active", "planTag": "pro",
      "mustChangePassword": false,
      "role": { "id": "…", "key": "member", "name": "普通用户" },
      "permissions": []
    },
    "accessToken": "…",
    "refreshToken": "…",
    "expiresAt": "2026-10-08T21:31:22.000Z",
    "refreshExpiresAt": "2027-01-06T09:31:22.000Z",
    "sessionId": "…"
  }
}
```

`client=desktop` 时**不设置任何 Cookie**；`client=web` 时令牌只进 Cookie、body 不含令牌。

**服务端判定顺序（固定）**：限流（路由层）→ 维护模式 → 版本闸门 → 口令校验。维护与版本两道闸门在口令之前，因此**不写 `login_attempts`、不计锁定**——一次配置失误不能把账号锁死。

失败：

| HTTP | code | 桌面端动作 |
|---|---|---|
| 401 | `invalid_credentials` | 内联「邮箱或口令不正确」（不区分账号不存在与口令错） |
| 403 | `account_suspended` | 清会话 + 封禁提示，**禁止**破窗绕过 |
| 423 | `account_locked` | `details.retryAfterSeconds` 倒计时 |
| 426 | `client_outdated` | 更新阻断屏，`details.minVersion` 显示目标版本 |
| 429 | `rate_limited` | 按 `Retry-After` 禁用按钮 |
| 503 | `service_unavailable` | `details.reason === 'maintenance'` → 维护屏；其它 → 按「不可达」处理 |

**同设备顶号**：同一 `(user, deviceKey)` 再次登录时，服务端在一个事务内先撤销该设备旧会话（`revoked_reason='same_device_relogin'`）再建新会话。旧 `accessToken` 随后的请求得到 `401 session_revoked`，桌面端此时**不要**提示「被攻击」——这是自己换了一台同 profile 的实例或重装后的正常结果。

### 2.1b 注册（桌面端同样走这条）

```
POST /auth/register
{ "email": "…", "username": "ada", "password": "…", "client": "desktop",
  "clientVersion": "1.0.1", "inviteCode": "…",   // inviteCode 仅在 /meta.inviteRequired 时
  "device": { …与登录同形… } }
```

`201` 的 `data` 与登录**逐键同形**：`user`（含 `avatarUrl` / `planTag` / `mustChangePassword` /
`lastLoginAt`）、`accessToken`、`refreshToken`、`expiresAt`、`refreshExpiresAt`、`sessionId`。
桌面端把注册响应喂给与登录同一个 `sessionFromLogin()`，所以少一个键就等于少一条会话字段：
`refreshExpiresAt` 缺失时离线宽限不再受刷新令牌寿命约束（D2-08 失效），`mustChangePassword`
缺失时管理员预设的强制改密在注册后第一次心跳前不会生效。`webserver/tests/integration/
desktop-login.test.ts` 有一条用例逐键比对 login 200 与 register 201，防止再次漂移。

失败码与登录同表（`email_taken` / `username_taken` / `invite_*` / `registration_disabled` /
`client_outdated` / `service_unavailable`），维护与版本闸门都在**建账号之前**判定。

### 2.2 心跳 / 撤销探测

```
POST /auth/heartbeat
Authorization: Bearer <accessToken>
```

- `200`：`{ ok: true, sessionId, userId, expiresAt, revoked: false, mustChangePassword, role, permissions }`
- `401 session_revoked`：管理员踢下线、口令变更或**同设备顶号** → 立即清本地会话并回登录界面
- `401 session_expired`：访问令牌过期 → 先调 `/auth/refresh`，失败再登出
- `401 unauthorized`：没有可用会话
- `403 account_suspended`：封禁提示，且**不允许**用形态 B 绕过（形态 B 是设备救援，不是账号恢复）
- `429 rate_limited`：**按网络问题处理**，走离线宽限判定，绝不因此登出（限流不代表会话失效）

**成功信号在响应体，不在状态码**：`mustChangePassword` / `role` / `permissions` / `expiresAt` 都在 body 里。心跳路由用 `allowPasswordChangeRequired: true` 放行改密前状态，因此心跳上**永远**不会出现 `403 password_change_required`、`423`、`426` 或 `503`（维护模式也不拦心跳）。

建议节奏：启动一次 + 每 15 分钟一次 + 窗口 `focus` 且距上次 > 15 分钟补一次 + `powerMonitor.resume` 同规则。服务端限流 60 次/小时/会话。

### 2.3 刷新

```
POST /auth/refresh
Content-Type: application/json
{ "refreshToken": "…" }
```

`200` 返回新的 `accessToken` / `refreshToken` / `expiresAt` / `refreshExpiresAt`。

**载波决定模式，不是 `Authorization` 头（v2 明确语义）**：请求体里带 `refreshToken` 即**桌面模式** —— 不回 Cookie、**免 CSRF**、新令牌对进 body。浏览器模式是「没有 body 令牌、但带 `ecs_refresh` Cookie」，那才需要 `X-CSRF-Token` 且新令牌走 Cookie。

> 为什么值得单独写一段：服务端早期版本按「有没有 `Authorization` 头」判定载体，而桌面端续期时访问令牌**刚刚过期**，正是因为没有可用访问令牌才来续期——于是每次续期都被判成浏览器模式、CSRF 必然 403，90 天刷新令牌形同虚设，用户每 12 小时就要重输口令。

**轮换与重用检测**：每次刷新都会让旧刷新令牌作废。若服务端收到一个**已轮换过的**刷新令牌，说明同一令牌被两方持有，服务端会撤销该用户**全部**会话并返回 `401`。桌面端此时必须清空本地会话并回到登录界面——不要重试，也**不要并发续期**（单飞 `withTokenLock`，否则自己触发重用检测把全场踢下线）。

### 2.4 登出

```
POST /auth/logout
Authorization: Bearer <accessToken>
```

幂等：退出时无论令牌是否过期都返回 `200`。**清理本地会话必须发生在远端撤销之后**，反过来会让 90 天刷新令牌变成无法撤销的孤儿。`logout` 永不返回 `426`：旧客户端也必须能登出。

### 2.5 设备列表与撤销

```
GET /me/sessions
Authorization: Bearer <accessToken>
```

```json
{ "items": [ { "id": "…", "client": "desktop", "deviceName": "…", "platform": "win32-x64",
               "appVersion": "1.0.1", "deviceKey": "9b2c1f8e…", "ip": "…", "userAgent": "…",
               "createdAt": "…", "lastSeenAt": "…", "expiresAt": "…", "current": true } ],
  "total": 1 }
```

`current` **恰好一条**，就是本次请求携带令牌的那条；`deviceKey` 对网页会话与历史行是空串。

```
DELETE /me/sessions/{id}
```

撤销**自己当前**的会话会**成功**（`200 { revoked: true, sessionId }`，服务端失效该会话并清 Cookie）：桌面端必须把它当作「自我登出」处理——成功后立刻切 `unauthenticated` 并回登录屏。界面上对当前会话置灰按钮是**前端便利规则**，不是服务端约束，不要写一段永远不生效的 `409` 分支。

---

## 3. 本地存储

`userData/auth-session.json`（Electron `safeStorage` 加密；不可用时降级明文并写审计告警）：

```json
{
  "schemaVersion": 1,
  "accessToken": "…",
  "refreshToken": "…",
  "expiresAt": 1794118092000,
  "refreshExpiresAt": 1797212092000,
  "sessionId": "…",
  "deviceKey": "9b2c1f8e0a4d6c3b7e5f1a2d4c8b6e0f",
  "user": { "id": "…", "email": "…", "username": "…", "displayName": "…", "role": { "key": "member" }, "permissions": [] },
  "source": "server",
  "lastVerifiedAt": 1794118092434,
  "serverTimeAt": 1794118092000
}
```

- 时间为**入库 epoch 毫秒**（不是 ISO 字符串）：主进程要做差值、宽限与回拨判定，ISO 每次都要 parse 且时区/精度易错；出口再转 ISO。
- **绝不落盘口令**。
- `lastVerifiedAt` 是离线宽限的基准，每次心跳/启动成功都要刷新；`serverTimeAt` 取自最近一次成功响应的信封 `timestamp`，用于回拨交叉校验，且不出现在渲染进程可见的 `AuthStatus` 里。
- `rememberDevice === false` 时**不写这个文件**（令牌只活在主进程内存）。若上一次会话曾落盘，先 `clear()` 再继续——否则下次启动会把用户「登录」进他以为自己没记住的会话。
- 磁盘上实际是信封：`{"v":1,"enc":"safeStorage","payload":"<base64>"}`。

---

## 4. 降级矩阵（固定策略，实现不得改动）

| 场景 | 行为 |
|---|---|
| 服务端可达 + 凭据正确 | 正常进入，`source: "server"` |
| 服务端可达 + 凭据错误 | 显示统一错误文案，留在登录界面 |
| 服务端不可达（DNS/超时/5xx） | 本地会话存在且 `lastVerifiedAt` 在 **7 天**内 → 允许进入并显示「离线模式」角标（`source: "offline-cache"`）；否则「无法连接账号服务器」+ 重试 + 「使用本地管理员登录」 |
| `lastVerifiedAt` 超 7 天 | 必须联网重新验证，否则只能走形态 B |
| 宽限期内的 `refreshExpiresAt` 已过 | **按宽限过期处理**（没有可续期的凭证，宽限就是空的） |
| 系统时间回拨 > 5 分钟 | 视为超出宽限 → 重新登录（`clock-rollback`），**不**删除会话文件 |
| 服务端 403 `account_suspended` | 强制登出、清本地会话、显示封禁与申诉方式；**不允许**形态 B 绕过 |
| 心跳网络错误 / `429` 但宽限未过期 | **不登出**（避免网络抖动与限流误伤） |

---

## 5. 启动时序

```
启动
 └─ 读 userData/auth-session.json
     ├─ 无 → LoginScreen（两个入口：账号服务器登录 / 本地管理员登录）
     ├─ 有 → POST /auth/heartbeat（5s 超时）
     │    ├─ 200 → 进入应用（source: server，刷新 lastVerifiedAt）
     │    ├─ 401 revoked/suspended → 清会话 → LoginScreen（带原因）
     │    └─ 网络错误 → now - lastVerifiedAt ≤ 7d ? 进入应用（离线角标） : LoginScreen（需联网）
     └─ 用户点「本地管理员登录」→ IPC auth:login-local（`CHANNELS.LOGIN_LOCAL`）→ 主进程常量时间比对 → owner 权限进入
```

维护模式由 `GET /meta` 的 `maintenanceMessage !== ''` 判定（**不**靠心跳——心跳不受维护影响）：显示阻断屏 + 公告 + 重试 + 破窗入口。

---

## 6. 错误码映射（桌面端展示用）

| code | HTTP | 桌面端动作 |
|---|---|---|
| `invalid_credentials` | 401 | 内联提示「邮箱或口令不正确」 |
| `account_locked` | 423 | 提示锁定 + `details.retryAfterSeconds` 倒计时 |
| `account_suspended` | 403 | 清会话、封禁提示、禁止破窗绕过 |
| `session_revoked` | 401 | 清会话、回登录界面、提示「会话已失效」（顶号也走这条） |
| `session_expired` | 401 | 先刷新；刷新失败再清会话 |
| `password_change_required` | 403 | 应用内不可关闭的 `ChangePasswordDialog`（见 D2-06） |
| `client_outdated` | 426 | 更新阻断屏 + `details.minVersion` + 下载页；**只**在 login/register 出现 |
| `rate_limited` | 429 | 按 `Retry-After` 禁用按钮；心跳上的 429 按网络处理 |
| `service_unavailable` | 503 | `details.reason === 'maintenance'` → 维护屏；其它 → 走离线宽限 |
| `internal_error` | 500 | 通用错误 + 展示 `X-Request-Id` |

---

## 7. 不变式（必须写进桌面端 README 与代码注释）

1. 业务表的 `user_id` **继续恒为** `LOCAL_OWNER_ID`（`app/constants.py` 与 `src/lib/localOwner.ts` 同步不动）。身份认证只决定「谁能打开应用」，不改变本地数据归属，因此**不需要任何数据迁移**。
2. 普通用户必须联网校验；离线只是宽限期，不是长期授权。
3. 破窗账号只用于设备救援：不发网络请求、不进服务端、不加载他人数据、不可被服务端吊销。
4. 令牌只存加密的 `auth-session.json`（或仅在主进程内存），不写日志、不写 `.env`、不进 `desktop-config.json`、**不进渲染进程**。

---

## 8. 桌面端文件清单（v2 实际形态）

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/lib/api/authBridge.ts` | 新增 | IPC 包装 `getAuthBridge()` + `AuthBridge`/`AuthStatus`/`SessionUser`/`ServerMeta`/`SessionInfo` 类型（**不是** `authClient.ts`，见 D2-01） |
| `desktop/main/authConfig.js` | 新增 | `readAuthConfig` / `deriveDeviceKey` / `resolveGate`（见 D2-09） |
| `desktop/main/authPolicy.js` | 新增 | `decideStartup` / `graceDeadline` / `detectClockRollback` / `nextTimerDelay` / `compareVersions`（纯函数） |
| `desktop/main/authSessionStore.js` | 新增 | `safeStorage` 信封 + 原子写 + 损坏容错（见 D2-04） |
| `desktop/main/authHttp.js` | 新增 | 账号服务器 HTTP 客户端：信封解包、超时、`AccountError`、日志脱敏、**不自动重试** |
| `desktop/main/authController.js` | 新增 | 状态机、心跳调度、单飞续期（见 D2-07/D2-08/D2-11） |
| `desktop/main/authBridge.js` | 新增 | **14** 个 `ipcMain.handle`（10 个基础通道 + `auth:me`/`auth:update-profile`/`auth:activity`/`auth:resend-verification`）+ 入参校验 + 错误归一化 + `openExternal` 白名单（`auth:changed` 是事件通道，不计入） |
| `desktop/main/localAdmin.js` | 新增 | 破窗凭据常量时间比对 + 失败计数 + 指数退避 |
| `src/contexts/SessionContext.tsx` | 新增 | 状态机 `booting｜authenticated｜unauthenticated｜blocked` + 心跳订阅 |
| `src/components/auth/*` | 新增 | `SessionGate` / `LoginScreen` / `RegisterForm` / `ResetPasswordForm` / `LocalAdminForm` / `ChangePasswordDialog` / `AuthBlocker` / `AccountMenu` / `AuthTitleBar` |
| `src/app/layout.tsx` | 修改 | 用 `<SessionProvider><SessionGate>` 包裹（见 D2-03） |
| `src/app/page.tsx` | 修改 | 只透传 `sessionSlot={<AccountMenu/>}`（见 D2-03） |
| `desktop/main/config.js` | 修改 | 默认 `localAdmin` + `auth.accountServerUrl` / `auth.offlineGraceDays` |
| `desktop/scripts/env.template.desktop` | 修改 | **不**把 `ACCOUNT_SERVER_URL` 当权威配置；只追加 `ECLIPTRIX_AUTH_GATE` / `ACCOUNT_OFFLINE_GRACE_DAYS` 作为可选覆盖（D2-09） |
| `src/lib/i18n.ts` | 修改 | `Translations.auth` 段（65 个键，嵌套对象，中英同批） |

---

## 9. 与 v1 契约的差异（D2-01 … D2-11，逐条必须遵守）

| 编号 | v1 原文 | v2 做法 | 理由 |
|---|---|---|---|
| **D2-01** | §8 新增 `src/lib/api/authClient.ts`（渲染进程直连账号服务器） | 改为 `src/lib/api/authBridge.ts`（IPC 包装）+ 主进程 `desktop/main/authHttp.js` | 令牌必须与网络外呼同处一域，否则 90 天凭证进入 XSS 可达区域 |
| **D2-02** | §8 修改 `src/lib/api/http-client.ts` 注入 `Authorization: Bearer` | **不改** | 该客户端只打本地 `127.0.0.1` 后端（文件开头注释即此意），注入外部令牌既无用又把令牌送进渲染进程 |
| **D2-03** | §8 修改 `src/app/page.tsx`：未认证时短路 | 改为在 `src/app/layout.tsx` 用 `<SessionGate>` 包裹；`page.tsx` 只加一行 `sessionSlot` | 短路写在页面里，`/login` 深链与将来任何新增页面都要复制一遍，遗漏一次就是漏洞 |
| **D2-04** | §3 `auth-session.json` 只有 ISO 时间字段 | 增加 `schemaVersion` / `sessionId` / `deviceKey` / `serverTimeAt`，时间改存 **epoch 毫秒** | 主进程要做时间差与回拨检测；ISO 每次都要 parse，且时区/精度易错 |
| **D2-05** | 未提及「同一设备重新登录」 | 新增 `sessions.device_key` + 登录事务内顶号（服务端迁移 0004） | 10 条会话上限 × 90 天刷新令牌 = 重装用户被自己挤出 |
| **D2-06** | §6 `password_change_required` → 「跳账号中心安全页改密」 | 改为应用内 `ChangePasswordDialog`（不可关闭，仅可退出登录） | 跳到网页改密要求用户再登录一次网页会话；同期令牌就在主进程里，直接改最快 |
| **D2-07** | §2.2 心跳节奏「启动一次 + 每 15 分钟一次」 | 保留，并补「窗口 focus 且距上次 > 15 分钟时立即补一次」「`powerMonitor.resume` 同规则」 | 笔记本合盖唤醒后，用户会先看到 15 分钟前的状态 |
| **D2-08** | §4 降级矩阵「服务端不可达且 `lastVerifiedAt` 在 7 天内 → 允许进入」 | 保留，并补「宽限同时受 `refreshExpiresAt` 约束」「系统时间回拨 5 分钟以上视为超出宽限」 | 一个可改系统时间的宽限窗口等于没有宽限 |
| **D2-09** | 未指定「桌面端账号服务器地址从哪里配」 | 权威来源 `desktop-config.json` 的 `auth.accountServerUrl`；`userData/.env` 里的 `ACCOUNT_SERVER_URL` 只作可选覆盖，且仅打包版由 `index.js` 注入 `readAuthConfig` | Electron 主进程**不解析** `userData/.env`（无 dotenv、无 `process.env` 赋值），那个文件只被注入给 FastAPI / Next 子进程。写进 env 等于「配置了但永远读不到」 |
| **D2-10** | §8 未指定「撤销自己的会话」的语义 | 服务端 `DELETE /me/sessions/{id}` 撤自己会**成功**（200 + 失效 + 清 Cookie），桌面端据此当作「自我登出」处理；按钮置灰是前端便利规则 | v1 误记为 `409 cannot_modify_self`（那是管理后台对管理员的保护），照抄会写出永不生效的分支 |
| **D2-11** | §2.2 心跳「启动一次 + 每 15 分钟一次」，未说失败码 | 心跳的成功信号在**响应体**（`mustChangePassword` / `role` / `permissions` / `expiresAt`），失败码只有 `401 session_revoked` / `session_expired` / `unauthorized`、`403 account_suspended`、`429 rate_limited`（按网络处理） | 心跳路由用 `allowPasswordChangeRequired: true` 放行改密前状态，因此 403 `password_change_required` / 423 / 426 / 503 都不会出现在心跳上 |

---

## 10. 服务端侧配套（v2 已实现，无需桌面端实现，但要知道存在）

| 能力 | 端点/设置 | 说明 |
|---|---|---|
| `/meta` 三字段 | `GET /meta` | `minClientVersion` / `maintenanceMessage` / `maxActiveSessions`，60 秒缓存即可 |
| 版本闸门 | `client.minVersion` | 只拦 login/register；不消耗失败次数、不锁号。**生效值 = `min(存量值, stable 在服版本)`**：`/meta` 的 `minClientVersion` 与 426 的 `details.minVersion` 报的都是这个钳制后的值，渠道无版本时为空（不设闸门） |
| 维护模式 | `app.maintenanceMessage` | 只拦 login/register；心跳/续期/登出照常 |
| 会话上限 | `security.maxActiveSessions`（1–50，默认 10） | 调小不批量踢人，下次登录按 LRU 收敛，被挤掉记 `session_limit` |
| 设备顶号 | `device.deviceKey` | 同 `(user, deviceKey)` 登录时在同一事务内替换；审计 `auth.session_relogin` |
| 审计 | `auth.login_blocked_outdated_client` / `auth.login_blocked_maintenance` / `auth.session_relogin` | 排障时先看这三条 |


---

## 11. v3 增量：账号中心与生命周期（本轮）

v2 描述的是"谁能进门"；v3 补的是"进来以后能管什么"。四条通道、两条边界、四个错误原因。

### 11.1 新增 IPC 通道

| 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `auth:me` | 无 | `MeView` | 调用方自己的档案；`pendingEmail` 已由服务端脱敏 |
| `auth:update-profile` | `{ displayName?, locale?, timezone? }` | `MeView` | 只此三键，其余 → `invalid_request`；locale 限 `zh-CN`/`en-US`，timezone 需 `Area/City` 形态 |
| `auth:activity` | 无（主进程固定 `page=1&pageSize=30`） | `{ items, truncated }` | `truncated` 语义是"还有更多"，不是"服务端截断" |
| `auth:resend-verification` | 无 | `{ sentAt, expiresAt }` | 已验证 → `409 email_already_verified`；无 SMTP → `503 mail_disabled` |

`mustChangePassword` 的缩口名单由 5 个扩到 **6** 个：加入 `auth:me`（强制改密页需要显示"你正在为谁改密"），
它是**只读**调用，不增加任何写能力。

### 11.2 两条边界

1. **IP 只在主进程脱敏。** 服务端 `/me/activity` 回的是原始 `ip`（账号主人有权看到自己的数据），
   `authController.activity()` 把它转成 `ipMasked`（IPv4 `1.2.x.x`，IPv6 `1.2:…`）后才交给渲染层。
   用例断言"返回值里不出现完整四段 IPv4"。
2. **能力探测必须逐方法。** 旧主进程有 bridge 但没有这 4 个方法，因此 `SessionContext.capabilities`
   用 `typeof auth?.me === 'function'` 逐个探测，`AccountCentreDialog` 据此决定渲染哪些控件；
   缺方法时降级为"仅状态 + 浏览器"，绝不渲染一个点了就报错的按钮。

### 11.3 错误原因增补

| `error_code` | `reason` | 出现位置 | 文案意图 |
|---|---|---|---|
| `email_not_verified` | `email-unverified` | 只有 `POST /auth/login`（策略开启 + 桌面端） | "去收信 / 重发"，不是口令错 |
| `email_already_verified` | `email-unverified` | 重发验证信 | "已经验证过了" |
| `deletion_pending` | `deletion-pending` | `PATCH /me`、换邮箱 | "注销进行中，先取消" |
| `mail_disabled` | `mail-disabled` | 重发验证信、换邮箱 | "这个部署没有邮件服务" |

**吊销理由 → reason**：`auth.session_revoked` 的 `error_details.reason` 里，
`account_deleted`（本人注销）与 `deleted`（管理员删号）**都**映射到 `account-deleted`；
`suspended` → `account-suspended`；`refresh_reuse` → `session-revoked`。

> **登录屏不给 `account-deleted` 专用文案**：已注销账号重新登录仍然返回 `invalid_credentials`
> （刻意的防枚举设计）。写一条专用文案就等于提供了一个"这个邮箱曾经存在过"的探针。
> `account-deleted` 只可能出现在已登录会话的心跳 / refresh 401 上。

### 11.4 会话文件增量

`auth-session.json` 的 `user` 多一个 `emailVerified` 布尔。信封仍是 `schemaVersion: 1`，
旧文件读出来是 `undefined`，主进程在 `currentUser()` 里统一归一为 `false`（下一步心跳后刷新）。

### 11.5 "在浏览器中打开"的地址来源

渲染层**不再**使用构建期常量做默认值：`accountCenterUrl(status.server.baseUrl)` 优先取运行时地址，
为空才回落 `NEXT_PUBLIC_ACCOUNT_SERVER_URL`，两者都为空时按钮 `disabled` 并说明原因。
`/meta` 因此多回一个 `baseUrl`（就是本次连接的服务地址），它已经在 `open-external` 的动态白名单里。
