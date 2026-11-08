# 桌面端接入契约

本文是 `webserver/` 与 Ecliptrix 桌面端之间的**唯一契约**。桌面端接入实现必须逐条满足；服务端实现已按此契约锁定，改动任一侧都需要同步改另一侧。

- 服务端 Base URL：`ACCOUNT_SERVER_URL`（例 `https://id.ecliptrix.app`），桌面端在 `env.template.desktop` 中配置。
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
  "device": { "name": "Ada 的 MacBook", "platform": "darwin-arm64", "appVersion": "1.0.1" }
}
```

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

失败：`401 invalid_credentials`（不区分「用户不存在」与「口令错误」）、`403 account_suspended`、`423 account_locked`（带 `details.retryAfterSeconds`）、`429 rate_limited`（带 `Retry-After`）。

### 2.2 心跳 / 撤销探测

```
POST /auth/heartbeat
Authorization: Bearer <accessToken>
```

- `200`：`{ ok: true, sessionId, expiresAt, revoked: false, mustChangePassword, role, permissions }`
- `401 session_revoked`：管理员踢下线或密码变更 → 桌面端**立即**清本地会话并回登录界面
- `401 session_expired`：访问令牌过期 → 先调 `/auth/refresh`，失败再登出
- `403 account_suspended`：封禁提示，且**不允许**用形态 B 绕过（形态 B 是设备救援，不是账号恢复）

建议节奏：启动时一次 + 每 15 分钟一次。服务端限流 60 次/小时/会话，15 分钟节奏约 4 次/小时。

### 2.3 刷新

```
POST /auth/refresh
Content-Type: application/json
{ "refreshToken": "…" }
```

`200` 返回新的 `accessToken` / `refreshToken` / `expiresAt` / `refreshExpiresAt`。

**轮换与重用检测**：每次刷新都会让旧刷新令牌作废。若服务端收到一个**已轮换过的**刷新令牌，说明同一令牌被两方持有，服务端会撤销该用户**全部**会话并返回 `401`。桌面端此时必须清空本地会话并回到登录界面——不要重试。

### 2.4 登出

```
POST /auth/logout
Authorization: Bearer <accessToken>
```

幂等：退出时无论令牌是否已过期都返回 `200`。

---

## 3. 本地存储

`userData/auth-session.json`（Electron `safeStorage` 加密；不可用时降级明文并写审计告警）：

```json
{
  "accessToken": "…",
  "refreshToken": "…",
  "expiresAt": "2026-10-08T21:31:22.000Z",
  "refreshExpiresAt": "2027-01-06T09:31:22.000Z",
  "user": { "id": "…", "email": "…", "username": "…", "displayName": "…", "role": { "key": "member" }, "permissions": [] },
  "source": "server",
  "lastVerifiedAt": "2026-10-08T09:31:22.000Z"
}
```

- **绝不落盘口令**。
- `lastVerifiedAt` 是离线宽限的基准，每次心跳/启动成功都要刷新。
- 清除时同时删除内存状态与文件。

---

## 4. 降级矩阵（固定策略，实现不得改动）

| 场景 | 行为 |
|---|---|
| 服务端可达 + 凭据正确 | 正常进入，`source: "server"` |
| 服务端可达 + 凭据错误 | 显示统一错误文案，留在登录界面 |
| 服务端不可达（DNS/超时/5xx） | 本地会话存在且 `lastVerifiedAt` 在 **7 天**内 → 允许进入并显示「离线模式」角标（`source: "offline-cache"`）；否则显示「无法连接账号服务器」+ 重试 + 「使用本地管理员登录」 |
| `lastVerifiedAt` 超 7 天 | 必须联网重新验证，否则只能走形态 B |
| 服务端 403 `account_suspended` | 强制登出、清本地会话、显示封禁与申诉方式；**不允许**形态 B 绕过 |
| 心跳网络错误但宽限未过期 | **不登出**（避免网络抖动误伤） |

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
     └─ 用户点「本地管理员登录」→ IPC auth:local-verify → 常量时间比对 → owner 权限进入
```

---

## 6. 错误码映射（桌面端展示用）

| code | HTTP | 桌面端动作 |
|---|---|---|
| `invalid_credentials` | 401 | 内联提示「邮箱或口令不正确」 |
| `account_locked` | 423 | 提示锁定 + `details.retryAfterSeconds` 倒计时 |
| `account_suspended` | 403 | 清会话、封禁提示、禁止破窗绕过 |
| `session_revoked` | 401 | 清会话、回登录界面、提示「会话已失效」 |
| `session_expired` | 401 | 先刷新；刷新失败再清会话 |
| `password_change_required` | 403 | 跳账号中心安全页改密 |
| `rate_limited` | 429 | 按 `Retry-After` 禁用按钮 |
| `service_unavailable` | 503 | 按「服务端不可达」处理（走离线宽限） |
| `internal_error` | 500 | 通用错误 + 展示 `X-Request-Id` |

---

## 7. 不变式（必须写进桌面端 README 与代码注释）

1. 业务表的 `user_id` **继续恒为** `LOCAL_OWNER_ID`（`app/constants.py` 与 `src/lib/localOwner.ts` 同步不动）。身份认证只决定「谁能打开应用」，不改变本地数据归属，因此**不需要任何数据迁移**。
2. 普通用户必须联网校验；离线只是宽限期，不是长期授权。
3. 破窗账号只用于设备救援：不发网络请求、不进服务端、不加载他人数据、不可被服务端吊销。
4. 令牌只存加密的 `auth-session.json`，不写日志、不写 `.env`、不进 `desktop-config.json`。

---

## 8. 需要新增 / 修改的桌面端文件

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/lib/api/authClient.ts` | 新增 | `login/register/refresh/heartbeat/logout` 的类型化调用（指向 `ACCOUNT_SERVER_URL`） |
| `src/lib/api/http-client.ts` | 修改 | 注入 `Authorization: Bearer`；401 不发跳转而是广播 `ecliptrix-session-invalid` |
| `src/contexts/SessionContext.tsx` | 新增 | 状态机 `loading｜authenticated｜unauthenticated｜offline` + 心跳定时器 + 事件订阅 |
| `src/app/layout.tsx` | 修改 | 用 `<SessionProvider>` 包裹 |
| `src/app/page.tsx` | 修改 | 未认证时短路，整窗只渲染 `<LoginScreen/>` |
| `src/app/login/page.tsx` | 新增 | 深链与过期跳转入口 |
| `src/components/auth/LoginScreen.tsx` | 新增 | 服务器登录 + 本地管理员登录两个入口，风格与 webserver 认证页一致 |
| `desktop/main/authBridge.js` | 新增 | IPC：`auth:local-verify`（常量时间比对）、`auth:session-read/write/clear`（`safeStorage`）、失败计数 |
| `desktop/main/config.js` | 修改 | `initUserData()` 写入默认 `localAdmin: { username: 'admin', password: 'adminjr' }`（已存在则不覆盖） |
| `desktop/main/index.js` | 修改 | 注册 `authBridge` IPC；启动时读会话决定首帧路由 |
| `desktop/scripts/env.template.desktop` | 修改 | 追加 `ACCOUNT_SERVER_URL=`、`ACCOUNT_OFFLINE_GRACE_DAYS=7`（**不**把本地管理员口令放进 env） |
| `src/lib/i18n.ts` | 修改 | 追加登录界面文案键（zh/en 同批） |
| `src/hooks/__tests__/sessionGate.test.tsx` 等 | 新增 | 闸门与破窗登录的单元测试 |
