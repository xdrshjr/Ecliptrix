# `/api/v1` API 文档

Base：`{PUBLIC_BASE_URL}/api/v1`
Content-Type：`application/json; charset=utf-8`
请求体上限 64 KB。

## 通用约定

- **认证**：Web 用 `ecs_session` Cookie（`HttpOnly; SameSite=Lax; Path=/`），桌面端用 `Authorization: Bearer <accessToken>`。
- **CSRF**：Cookie 会话的写请求（POST/PATCH/PUT/DELETE）必须带 `X-CSRF-Token`，值等于 `ecs_csrf` Cookie。Bearer 请求天然豁免。
- **请求 ID**：每个响应带 `X-Request-Id`；客户端可传同名头复用，否则服务端生成 UUIDv4。
- **时间**：一律 ISO-8601 UTC；入库为 epoch 毫秒。
- **ID**：UUIDv4 字符串。
- **分页**：`page`（默认 1）、`pageSize`（默认 20，上限 100）。
- **排序**：`sort=created_at|-created_at|email|-email|last_login_at|-last_login_at`；非白名单值回退默认（SQL 注入防护）。

### 成功信封

```json
{ "success": true, "message": null, "timestamp": "2026-10-08T09:31:22.000Z", "data": { } }
```

### 失败信封

```json
{
  "success": false,
  "message": "邮箱或口令不正确",
  "timestamp": "2026-10-08T09:31:22.000Z",
  "error_code": "invalid_credentials",
  "error": { "code": "invalid_credentials", "message": "邮箱或口令不正确", "details": null }
}
```

### 分页 data

```json
{ "items": [], "page": { "page": 1, "pageSize": 20, "total": 128, "totalPages": 7 } }
```

### 错误码（稳定枚举）

| code | HTTP | 何时 |
|---|---|---|
| `invalid_request` | 400 | 无法解析的 body |
| `validation_failed` | 422 | zod 校验失败（`details.fields[{path,message}]`） |
| `unauthorized` | 401 | 缺会话 / 令牌 |
| `invalid_credentials` | 401 | 登录失败（不区分原因） |
| `session_expired` | 401 | 访问令牌过期 |
| `session_revoked` | 401 | 会话被撤销 |
| `password_change_required` | 403 | `must_change_password=1` 时的非改密端点 |
| `forbidden` | 403 | 权限不足 |
| `account_suspended` | 403 | 账号停用 |
| `account_locked` | 423 | 失败次数过多（`details.retryAfterSeconds`） |
| `registration_disabled` | 403 | 注册关闭 |
| `invite_required` / `invite_invalid` / `invite_exhausted` | 403 / 403 / 409 | 邀请码 |
| `email_taken` / `username_taken` | 409 | 唯一冲突 |
| `weak_password` | 422 | 口令策略（`details.reasons[]`） |
| `password_mismatch` | 401 | 改密时当前口令错 |
| `cannot_modify_owner` / `cannot_modify_self` | 409 | 保护规则 |
| `role_in_use` | 409 | 删角色仍有用户 |
| `system_role_protected` | 403 | 系统角色受保护 |
| `not_found` | 404 | 资源不存在 |
| `conflict` | 409 | 其他状态冲突 |
| `rate_limited` | 429 | 限流（带 `Retry-After`） |
| `csrf_failed` | 403 | CSRF 校验失败 |
| `payload_too_large` | 413 | body > 64 KB |
| `service_unavailable` | 503 | 维护 / DB 不可用 / 未配置邮件 |
| `internal_error` | 500 | 未预期错误 |

---

## 公开端点

### `GET /health`

```bash
curl -s http://127.0.0.1:8787/api/v1/health
```

```json
{ "success": true, "data": { "status": "ok", "version": "0.1.0", "uptimeSeconds": 42, "env": "development" } }
```

不触库——存活探针不应该因为数据库慢而被重启。

### `GET /ready`

触库 `SELECT 1` 并检查迁移；未就绪返回 `503`：

```json
{ "success": false, "error_code": "service_unavailable",
  "error": { "code": "service_unavailable", "details": { "pendingMigrations": [4] } } }
```

### `GET /meta`

登录/注册页首帧需要的信息，无秘密：

```json
{
  "registrationEnabled": true,
  "inviteRequired": false,
  "smtpEnabled": false,
  "passwordPolicy": { "minLength": 10, "maxBytes": 128 },
  "appName": "Ecliptrix",
  "supportEmail": "",
  "version": "0.1.0"
}
```

---

## 认证

### `POST /auth/login`

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"owner@example.com","password":"owner-password-123","client":"web"}'
```

```json
{ "success": true,
  "data": {
    "user": { "id": "…", "email": "owner@example.com", "username": "owner", "displayName": "owner",
              "role": { "id": "…", "key": "owner", "name": "超级管理员" }, "permissions": ["*"],
              "status": "active", "planTag": "studio", "mustChangePassword": false },
    "expiresAt": "2026-10-08T21:31:22.000Z",
    "sessionId": "…"
  } }
```

`client=web` 不返回令牌（只进 Cookie）；`client=desktop` 返回 `accessToken/refreshToken/refreshExpiresAt` 且不设 Cookie。

限流：`20 / 5min / IP`、`5 / 5min / 标识`。

### `POST /auth/register`

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","username":"ada","password":"quiet meadow lantern drift","client":"web"}'
```

`201`。受 `registration.enabled` 与 `invite.required` 约束。限流 `10 / h / IP`。

### `POST /auth/logout`

幂等，`200 { "loggedOut": true }`，同时清除三个 Cookie。

### `POST /auth/refresh`

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/auth/refresh \
  -H 'Content-Type: application/json' -H 'X-CSRF-Token: <ecs_csrf>' \
  -d '{"refreshToken":"…"}'
```

轮换成功返回新令牌对。收到**已轮换过**的令牌 → 撤销该用户全部会话并 `401`。

### `POST /auth/heartbeat`

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/auth/heartbeat \
  -H 'Authorization: Bearer <accessToken>'
```

```json
{ "ok": true, "sessionId": "…", "userId": "…", "expiresAt": "…", "revoked": false,
  "mustChangePassword": false, "role": { "key": "member" }, "permissions": [] }
```

### `GET /auth/session`

返回当前用户、角色、权限与会话摘要（Web 端首帧校验）。

### `POST /auth/password/change`

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/auth/password/change \
  -H 'Content-Type: application/json' -H 'X-CSRF-Token: <ecs_csrf>' \
  -H 'Cookie: ecs_session=…; ecs_csrf=…' \
  -d '{"currentPassword":"owner-password-123","newPassword":"another long passphrase","signOutOtherSessions":true}'
```

`must_change_password=1` 时**只有**这个端点可用。

### `POST /auth/password/reset/request`

恒 `202`（防枚举）：

```json
{ "success": true, "message": "如果该邮箱存在，重置邮件已经发送", "data": { "accepted": true } }
```

SMTP 未配置时不发信、不报错，管理端改用一次性口令。

### `POST /auth/password/reset/confirm`

```bash
-d '{"token":"<邮件中的令牌>","newPassword":"a brand new long passphrase"}'
```

成功后撤销该用户全部会话。

---

## 本人（`/me`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/me` | 本人资料 |
| PATCH | `/me` | 改 `displayName/avatarUrl/locale/timezone`（`.strict()`，其他字段 → 422） |
| GET | `/me/sessions` | 本人设备列表（含 `current` 标记） |
| DELETE | `/me/sessions/{id}` | 撤销本人某设备；他人会话 → 404 |
| GET | `/me/activity` | 本人 90 天白名单事件 |
| POST | `/me/deletion-request` | 记录注销申请（写审计 `user.deletion_requested`，**不删除账号**） |

```bash
curl -s http://127.0.0.1:8787/api/v1/me \
  -H 'Cookie: ecs_session=…'
```

```json
{ "id": "…", "email": "owner@example.com", "username": "owner", "displayName": "owner",
  "avatarUrl": null, "locale": "zh-CN", "timezone": "Asia/Shanghai", "planTag": "studio",
  "status": "active", "mustChangePassword": false,
  "role": { "id": "…", "key": "owner", "name": "超级管理员" },
  "createdAt": "…", "lastLoginAt": "…" }
```

`PATCH /me` 白名单之外（`email`、`status`、`roleId`、`planTag`）→ `422 validation_failed`。

`POST /me/deletion-request` 只表达意图：账号继续可用，直到管理员处理审计记录。自助硬删除不在本轮范围内。

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/me/deletion-request \
  -H 'Cookie: ecs_session=…; ecs_csrf=…' -H "X-CSRF-Token: $CSRF"
# → { "success": true, "data": { "requested": true } }
```

---

## 管理端（`/admin`）

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/admin/metrics` | `users.read` |
| GET | `/admin/users` | `users.read` |
| POST | `/admin/users` | `users.write` |
| GET | `/admin/users/{id}` | `users.read` |
| PATCH | `/admin/users/{id}` | `users.write`（改角色另需 `roles.write`） |
| DELETE | `/admin/users/{id}` | `users.delete`；软删与硬删同一权限，`?hard=true` 另需 owner 角色 |
| POST | `/admin/users/{id}/restore` | `users.write` |
| POST | `/admin/users/{id}/password-reset` | `users.write` |
| POST | `/admin/users/{id}/unlock` | `users.write` |
| GET | `/admin/users/{id}/sessions` | `sessions.revoke` |
| POST | `/admin/users/bulk` | `users.write` |
| DELETE | `/admin/sessions/{id}` | `sessions.revoke` |
| GET/POST | `/admin/roles` | `roles.read` / `roles.write` |
| PATCH/DELETE | `/admin/roles/{id}` | `roles.write` |
| PUT | `/admin/roles/{id}/permissions` | `roles.write` |
| GET/POST | `/admin/invites` | `invites.read` / `invites.write` |
| DELETE | `/admin/invites/{id}` | `invites.write` |
| GET | `/admin/audit` | `audit.read` |
| GET/PATCH | `/admin/settings` | `settings.read` / `settings.write` |

### `GET /admin/users`

```bash
curl -s 'http://127.0.0.1:8787/api/v1/admin/users?query=ada&status=active&page=1&pageSize=20&sort=-created_at' \
  -H 'Cookie: ecs_session=…'
```

返回项含 `id, email, username, displayName, role{id,key,name}, status, planTag, note, mustChangePassword, lastLoginAt, createdAt, activeSessions, locked`。

### `POST /admin/users`

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/admin/users \
  -H 'Content-Type: application/json' -H 'X-CSRF-Token: <ecs_csrf>' \
  -H 'Cookie: ecs_session=…; ecs_csrf=…' \
  -d '{"email":"new@example.com","username":"newbie","roleKey":"member","planTag":"free"}'
```

`201`，未提供口令时生成一次性口令：

```json
{ "user": { "id": "…" }, "temporaryPassword": "k7Qm2VxR9pLt4HsB" }
```

`temporaryPassword` **只出现这一次**；对应账号 `mustChangePassword=true`。

### `PATCH /admin/users/{id}`

```bash
-d '{"displayName":"Ada L.","roleId":"<role-uuid>","status":"suspended","planTag":"studio"}'
```

字段缺省即不改；`status` 变更立即撤销该用户全部会话；`email` 变更需重新唯一校验并写 before/after 审计。

### `POST /admin/users/bulk`

```bash
-d '{"action":"suspend","ids":["<uuid>","<uuid>"]}'
```

```json
{ "requested": 3, "affected": ["…","…"], "skipped": [{ "id": "…", "reason": "cannot_modify_owner" }] }
```

批量操作**按用户**部分成功：一行受保护不应中断整批。

### `PUT /admin/roles/{id}/permissions`

```bash
-d '{"permissions":["users.read","audit.read"]}'
```

全量替换。`owner` 角色 → `403 system_role_protected`；未知权限键 → `422`。

### `POST /admin/invites`

```bash
-d '{"maxUses":5,"expiresInDays":14,"roleKey":"member"}'
```

```json
{ "invite": { "id": "…", "code": "ECL-7FQ2-K9PD-31MZ", "codeHint": "MZ", "roleKey": "member",
              "maxUses": 5, "expiresAt": "2026-10-22T…", "createdAt": "…" } }
```

`code` 仅此一次可见；列表只回 `codeHint`。

### `GET /admin/audit`

参数：`query`、`action`（支持 `user.*` 前缀）、`targetType`、`targetId`、`actor`、`from`、`to`、`page`、`pageSize`。

### `PATCH /admin/settings`

```bash
-d '{"registration.enabled":false,"invite.required":true,"security.loginMaxAttempts":5}'
```

白名单与类型：`registration.enabled:boolean`、`invite.required:boolean`、`security.loginMaxAttempts:int 3..20`、`security.loginLockMinutes:int 1..1440`、`session.webTtlHours:int 1..168`、`session.desktopRefreshDays:int 7..365`、`branding.appName:string≤40`、`branding.supportEmail:string`。越界 → `422`（`details.fields`）。

---

## 限流表

| scope | 目标 | 限额 |
|---|---|---|
| `login:ip` | 客户端 IP | 20 / 5 分钟 |
| `login:identifier` | 归一化标识 | **12 / 5 分钟**（必须高于锁定阈值，否则 `423` 不可达） |
| `register:ip` | IP | 10 / 小时 |
| `reset:ip` | IP | 3 / 小时 |
| `admin:write` | 用户 ID | 120 / 分钟 |
| `heartbeat:session` | 会话 | 60 / 小时 |

超限返回 `429` + `Retry-After`。
