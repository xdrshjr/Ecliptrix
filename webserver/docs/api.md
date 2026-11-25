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

> 与本特性相关的新增码：`range_not_satisfiable`（416，Range 越界）。`client_outdated`
> （426）的 `details` 现在是 `{ minVersion, downloadUrl }`——版本闸门必须同时给出去处。

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
| `client_outdated` | 426 | 桌面端版本低于**生效闸门**（`details.minVersion` 即该值，永远是可下载的版本）；**只**由 login/register 返回 |
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
| `service_unavailable` | 503 | 维护 / DB 不可用 |
| `internal_error` | 500 | 未预期错误 |
| `email_not_verified` | 403 | 开启 `mail.verificationRequired` 后未验证的**桌面端**登录（`details.redirect`）；**只**由 `POST /auth/login` 返回，注册永不返回 |
| `email_already_verified` | 409 | 对已验证地址请求重发 / 再次标记已验证 |
| `token_invalid` | 400 | 邮件令牌无效/过期/已用/用途不符（不细分，防探测） |
| `deletion_pending` | 409 | 已有进行中的注销申请（`POST/DELETE /me/email/change`、`PATCH /me`） |
| `mail_disabled` | 503 | 该动作必须有邮件而部署未配置 SMTP（重发验证信、换邮箱、管理员代发重置链接） |

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
  "version": "0.1.0",
  "minClientVersion": "",
  "latestClientVersion": "1.0.2",
  "downloadUrl": "https://id.example.com/download",
  "maintenanceMessage": "",
  "maxActiveSessions": 10,
  "emailVerificationRequired": false
}
```

`version` 是**账号服务器自身**的 npm 版本（`0.1.0`），不要拿它当客户端版本；
客户端版本是 `latestClientVersion`（没有已发布版本时为 `null`），下载页地址是
`downloadUrl`（由 `PUBLIC_BASE_URL` 拼出，**永不**取自请求 Host 头）。

`emailVerificationRequired` 是「桌面端未验证邮箱不得登录」的开关（`mail.verificationRequired`，
无 SMTP 时强制为 `false`）。网页端登录永不受它限制，注册也永不施加该闸门。

三个闸门字段（都来自 `app_settings`，可在 `/admin/settings` 热改，无需重启）：

| 字段 | 含义 | 默认 |
|---|---|---|
| `minClientVersion` | **生效**的最低桌面客户端版本：`client.minVersion` 存量值与 stable 渠道在服版本取小（读取时钳制，详见 `PATCH /admin/settings`），语义化比较（`1.0.10` > `1.0.9`）。空串 = 不限制；渠道无版本时恒为空串，因此**可能**与 `/admin/settings` 里的存量值不同 | `''` |
| `maintenanceMessage` | 非空即维护模式：`/auth/login`、`/auth/register` 返回 `503 service_unavailable` + `details.reason='maintenance'`；**心跳与续期不受影响** | `''` |
| `maxActiveSessions` | 每用户并发会话上限（1–50）。调小不批量踢人，下次登录按 LRU 收敛 | `10` |

---

## 认证

### `POST /auth/login`

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"owner@example.com","password":"owner-password-123","client":"web"}'
```

桌面端登录（带设备身份，`device.deviceKey` 可选但强烈建议）：

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"ada@example.com","password":"…","client":"desktop","clientVersion":"1.0.1",
       "device":{"name":"DESKTOP-7F3K2","platform":"win32-x64","appVersion":"1.0.1",
                 "deviceKey":"9b2c1f8e0a4d6c3b7e5f1a2d4c8b6e0f"}}'
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

限流：`20 / 5min / IP`、`12 / 5min / 标识`。

**执行顺序（固定）**：限流（路由层）→ 维护闸门 → 版本闸门 → 口令校验。前两道闸门**不写 `login_attempts`、不计锁定**，因此一次配置失误不会把账号锁死。

**同设备顶号**：`device.deviceKey` 是「这台机器 + 这个 profile」的稳定指纹（8–64 位 `[A-Za-z0-9_-]`）。同一 `(user, deviceKey)` 再次登录时，服务端在**同一事务**内先撤销旧会话（`revoked_reason='same_device_relogin'`，旧访问令牌随后心跳得到 `401 session_revoked`），再建新会话，并写审计 `auth.session_relogin`。不传 `deviceKey`（浏览器、旧客户端）时行为与以前完全一致。

**版本闸门**：仅当 `client=desktop` 且 `clientVersion` 非空时生效；`clientVersion < 生效闸门` → `426 client_outdated` + `details.minVersion`，并写审计 `auth.login_blocked_outdated_client`。生效闸门 = `min(client.minVersion 存量值, stable 渠道在服版本)`（读取侧钳制，见 `PATCH /admin/settings`），因此 `details.minVersion` 永远是用户**真的能下载到**的版本；渠道无版本时视为不设闸门。`heartbeat`/`refresh`/`logout` **永不**返回 426——旧客户端必须还能登出。

**维护模式**：`app.maintenanceMessage` 非空时，login/register → `503 service_unavailable` + `details.reason='maintenance'`，`message` 就是公告原文；已存在的会话心跳与续期照常。

### `POST /auth/register`

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","username":"ada","password":"quiet meadow lantern drift","client":"web"}'
```

`201`。受 `registration.enabled` 与 `invite.required` 约束。限流 `10 / h / IP`。

入参与登录同形：`clientVersion`（桌面端）+ `device.deviceKey`；维护模式 → `503`，版本过低 → `426 client_outdated`，两者都在创建账号之前判定。

`client=desktop` 的 `201` body 与登录**逐键同形**（`user` 含 `avatarUrl`/`planTag`/`mustChangePassword`/`lastLoginAt`，外加 `accessToken`/`refreshToken`/`expiresAt`/`refreshExpiresAt`/`sessionId` 且不设 Cookie）；`client=web` 只返回 `user` + `expiresAt` + `sessionId`，令牌进 Cookie。

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
  "mustChangePassword": false, "role": { "key": "member" }, "permissions": [],
  "emailVerified": true, "displayName": "Ada" }
```

`emailVerified` 与 `displayName` 每次都回传：桌面主进程把它们写回缓存的
`SessionUser` 快照，并在变化时推送 `auth:changed`。少了这两个字段，用户在会话期间完成
邮箱验证（或在账号中心改了昵称）后，标题栏与账号中心会一直显示旧值直到重启。

任何 401 都带 `error.details.reason`（`session_expired` / `session_revoked` + 吊销理由 /
`deleted` / `suspended` / `account_deleted`）：客户端靠它区分「刷新即可」和「别再重试」。

### `POST /auth/email/verify`

无会话：令牌本身即凭据。邮件里的链接由 `/verify-email` 页面在**客户端**消费（GET 不生效，避免邮件扫描器烧掉令牌）。

会话是**可选**的，且只用于一件事：换邮箱确认会吊销「其他」会话，正在点击链接的那个浏览器
保留自己的会话（否则用户会在自己眼前的页面上被登出）。

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/auth/email/verify \
  -H 'Content-Type: application/json' -d '{"token":"…"}'
# → 200 { "email": "a@b.c", "verifiedAt": "…", "changed": false }
# → 200 { "email": "new@b.c", "verifiedAt": "…", "changed": true, "sessionsRevoked": 2 }
# → 400 token_invalid
```

### `POST /auth/email/verify/resend`

需会话 + CSRF（Cookie）或 Bearer。限流：3/h/账号 + 10/h/IP。

```bash
# → 202 { "sentAt": "…", "expiresAt": "…" }
# → 409 email_already_verified | 429 rate_limited | 503 mail_disabled
```

### `POST /auth/deletion/confirm`

无会话，令牌即凭据，限流 60/h/IP。确认后**只是排期**（`now + account.deletionGraceHours`），期间仍可取消。

```bash
# → 200 { "scheduledFor": "…" }
# → 400 token_invalid | 409 conflict（已取消/已完成）
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
| GET | `/me/sessions` | 本人设备列表（含 `current` 标记与 `deviceKey`） |
| DELETE | `/me/sessions/{id}` | 撤销本人某设备；他人会话 → 404 |
| GET | `/me/activity` | 本人 90 天白名单事件（每行带 `ipMasked`，原始 `ip` 亦返回但桌面端只用遮罩值） |
| POST | `/me/deletion-request` | **开启真实注销流程**（需口令）：有邮件 → `awaiting_confirmation` + 确认邮件；无邮件 → 直接 `scheduled`。`202` |
| DELETE | `/me/deletion-request` | 取消进行中的注销申请（`200`；无申请 → `404`） |
| POST | `/me/email/change` | 发起换邮箱（需口令）；双封信（新址确认 + 旧址通知）；`202`。无 SMTP → `503 mail_disabled` |
| DELETE | `/me/email/change` | 取消待确认的换邮箱（`200`；无待确认 → `404`） |
| GET | `/me/export` | 数据导出附件（JSON，`Content-Disposition: attachment`），冷却期见 `account.exportCooldownMinutes` |

```bash
curl -s http://127.0.0.1:8787/api/v1/me \
  -H 'Cookie: ecs_session=…'
```

`GET /me/sessions` 的每一项（`toSessionDto`，`current` 由调用方自己的会话 id 标注）：

```json
{ "items": [ { "id": "…", "client": "desktop", "deviceName": "DESKTOP-7F3K2",
               "platform": "win32-x64", "appVersion": "1.0.1",
               "deviceKey": "9b2c1f8e…", "ip": "203.0.113.7", "userAgent": "…",
               "createdAt": "…", "lastSeenAt": "…", "expiresAt": "…",
               "current": true } ],
  "total": 1 }
```

`current` **恰好一条**（就是本次调用携带令牌的那条）；`deviceKey` 对网页会话与 0004 之前的历史行是空串。

```json
{ "id": "…", "email": "owner@example.com", "username": "owner", "displayName": "owner",
  "avatarUrl": null, "locale": "zh-CN", "timezone": "Asia/Shanghai", "planTag": "studio",
  "status": "active", "mustChangePassword": false,
  "emailVerified": true, "emailVerifiedAt": "…",
  "pendingEmail": null,
  "deletion": null,
  "role": { "id": "…", "key": "owner", "name": "超级管理员" },
  "createdAt": "…", "lastLoginAt": "…" }
```

`pendingEmail` 是**脱敏**的待确认地址（`n***@b.c`）：未确认之前它还不是既成事实。
`deletion` 为 `null` 或 `{ status: 'awaiting_confirmation' | 'scheduled', scheduledFor }`。

`PATCH /me` 白名单之外（`email`、`status`、`roleId`、`planTag`）→ `422 validation_failed`；
注销申请进行中时 `PATCH /me` → `409 deletion_pending`。

```bash
# 注销申请（需口令；无 SMTP 时直接排期）
curl -s -X POST http://127.0.0.1:8787/api/v1/me/deletion-request \
  -H 'Cookie: ecs_session=…; ecs_csrf=…' -H "X-CSRF-Token: $CSRF" \
  -H 'Content-Type: application/json' -d '{"password":"…","reason":"不再使用"}'
# → 202 { "requestId": "…", "requiresConfirmation": true, "scheduledFor": null }

# 导出（成功体是附件；错误体仍是 JSON 信封）
curl -s -D - -o account.json http://127.0.0.1:8787/api/v1/me/export \
  -H 'Cookie: ecs_session=…'
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
| GET | `/admin/sessions` | `users.read`（列表；邮箱与 IP 脱敏） |
| POST | `/admin/sessions/revoke` | `sessions.revoke`（≤100 个 id，一条聚合审计） |
| GET | `/admin/mail` · `/admin/mail/{id}` | `settings.read` |
| POST | `/admin/mail/{id}/retry` | `users.write` |
| GET | `/admin/users/export` | `users.read`（CSV 附件） |
| POST | `/admin/users/{id}/email-verify` | `users.write` |
| POST | `/admin/users/{id}/deletion` | `users.delete`（管理员代确认注销） |

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

白名单与类型（共 **19** 个键）：`registration.enabled:boolean`、`invite.required:boolean`、`security.loginMaxAttempts:int 3..20`、`security.loginLockMinutes:int 1..1440`、`security.maxActiveSessions:int 1..50`、`session.webTtlHours:int 1..168`、`session.desktopRefreshDays:int 7..365`、`client.minVersion:string≤20`、`app.maintenanceMessage:string≤200`、`branding.appName:string≤40`、`branding.supportEmail:string`，
以及邮件与账号生命周期分组：`mail.verificationRequired:boolean`、`mail.verificationTtlHours:int 1..168`（默认 48）、`mail.emailChangeTtlHours:int 1..72`（默认 24）、`mail.notifyNewDevice:boolean`、`mail.notifyPasswordChange:boolean`、`account.deletionGraceHours:int 1..720`（默认 72）、`account.exportCooldownMinutes:int 1..1440`（默认 60）、`audit.retentionDays:int 30..3650`（默认 180，`npm run db:prune` 读取）。越界 → `422`（`details.fields`）。

无 SMTP 时 `mail.verificationRequired` 在**读和写两侧都被夹紧为 `false`**：写入 `true` 回答 `422`，`GET` 也永远返回 `false`。否则管理员打开开关的同时没有任何投递通道，全体桌面端用户会被 403 锁在门外。

`GET /admin/settings` 返回 `{settings, available, mail}`：`mail` 是只读能力块（`mode` / `fromAddress` / `configured` / `sent24h` / `failed24h` / `sendTimeoutMs`），不是可写键。

`client.minVersion` 现在与「已发布版本」联动（四条规则，服务端强制，控制台只是反映）：

1. `''` 永远允许——这是「不限制」；
2. 一个已发布版本都没有时，非空值一律 `422`（否则就是全员锁定且无处下载）；
3. 高于最新已发布版本的值 `422`，`details.fields[0].message` 会说出当前最新版本号；
4. 其它情况允许（含无法排序的字符串，此时版本闸门本身按既有规则 fail-open 并记日志）。

> **生效值 = `min(存量值, stable 渠道在服版本)`（读取侧钳制）**。上面四条只守「保存」这一个入口，
> 而且校验与写库不在同一事务；回滚、撤回、CLI 发布、手改库都从别的门进来。所以**读取**时才最终裁决：
> 渠道无版本 → 生效值 `''`（fail-open），存量值高于在服版本 → 生效值取在服版本，并打一条
> `client.minVersion clamped to the version the channel serves` 的 warn。存量值**永不被改写**，
> 重新发布更高版本后闸门自动恢复。两个读点用的是同一个函数（`releaseService.effectiveMinVersion`）：
> `POST /auth/login` 的 426 判定与 `GET /meta` 的 `minClientVersion`——二者必须相等，否则会出现
> 「API 放行、桌面端界面仍然锁死」。因此 `GET /admin/settings` 里的字段值是**存量值**，可能与当前
> 生效值不同（这是有意为之）。

`client.minVersion` / `app.maintenanceMessage` / `security.maxActiveSessions` 是桌面端闸门：

```bash
# 强制升级（高风险：高于线上版本会让所有旧客户端登录被 426 拦住）
curl -s -X PATCH http://127.0.0.1:8787/api/v1/admin/settings \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -H 'Cookie: ecs_session=…; ecs_csrf=…' \
  -d '{"client.minVersion":"1.1.0"}'

# 维护公告：非空即进入维护模式；空串恢复
-d '{"app.maintenanceMessage":"今晚 23:00 数据库维护，预计 30 分钟"}'

# 每用户并发会话上限
-d '{"security.maxActiveSessions":5}'
```

`GET /admin/settings` 返回 `{ settings, available, mail }`，`settings` 是上述 19 个键的完整快照（缺失行回落默认值），`mail` 是只读能力块（见 `PATCH /admin/settings` 一节）。

---

### 客户端发布（`/releases`、`/downloads`、`/admin/releases`）

桌面端没有自动更新，`/download` 是**唯一**升级路径，所以这条链路是产品可用性的一部分。

#### `GET /releases/latest?channel=stable`（公开）

```bash
curl -s http://127.0.0.1:8787/api/v1/releases/latest
# → { "channel": "stable",
#     "release": { "version": "1.0.2", "publishedAt": "…", "channel": "stable",
#       "platforms": [ { "platform": "win", "arch": "x64", "fileName": "Ecliptrix-Setup-1.0.2.exe",
#                        "byteSize": 307200, "sha256": "08bd…", "downloads": 3,
#                        "downloadPath": "/api/v1/downloads/stable/win" } ] },
#     "downloadUrl": "https://id.example.com/download" }
```

没有已发布版本时 `release` 为 `null`（**不是** 404、更不是 500）。渠道未知 → `404`。
`release.version` 是该渠道各平台中**最新**的那个；每个平台条目自带自己的 `version` 与 `sha256`。

#### `GET /downloads/{channel}/{platform}`（需会话）

安装包字节流，`runtime='nodejs'`，逐段读取，不整体缓冲。
`?release=<id>` 服务**指定的那一版**（`/download` 的「历史版本」列表就用它），而不是渠道当前
指向的那版：一个被撤回的构建对已经装了它的人仍然是必需的。指定行必须 `status='published'`
且平台匹配，否则 `404`。

| 请求 | 响应 |
|---|---|
| 无 `Range` | `200` + `Accept-Ranges: bytes` + `ETag: "<sha256>"` + `Cache-Control: private, max-age=0, must-revalidate` |
| `Range: bytes=0-1023` | `206` + `Content-Range: bytes 0-1023/N`，`Content-Length` 是**切片**长度 |
| `Range: bytes=<N-1024>-` | `206` 到文件尾 |
| `Range: bytes=-500` | `206`，最后 500 字节 |
| 起点 ≥ 文件大小 | `416` + `Content-Range: bytes */N` |
| `Range: bytes=0-1,5-6` 或非法 Range | 忽略 Range，`200` |
| `If-None-Match: "<sha256>"` | `304`，无 body |
| `HEAD` | 与 GET 同头，无 body |

失败：`401`（无会话）、`404`（该平台当前没有已发布版本，或文件已丢失）、`416`（越界）。
成功计数一次 `downloads`。认证产物不得被共享缓存保存，所以是 `private`。

#### `GET /admin/releases`（`releases.read`）

返回 `{ items, channels, platforms, counts, latestVersion, latest }`。`items` 含草稿、已撤回
与上传人；`pointedBy` 指出哪些渠道正指向该版本（`stable` 即「用户当前拿到的」）。

#### `POST /admin/releases?...`（`releases.write`）

**元数据走查询串，body 是裸文件字节**（不用 multipart：`request.formData()` 会把整个安装包
读进内存）。查询串里**只有短字段**：`version` / `platform` / `arch` / `fileName` / 可选 `sha256`。
**发布说明不走这里**——2000 字符的说明在 URL 编码后（中文每字 9 字节）远超 nginx 8 KB 的头部
缓冲，上传会在开始前就 `414`；草稿建好之后用 `PATCH {action:'notes'}` 写，控制台也是这么做的。

```bash
curl -s -X POST "http://127.0.0.1:8787/api/v1/admin/releases?version=1.0.2&platform=win&arch=x64&fileName=Ecliptrix-Setup-1.0.2.exe" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/octet-stream' \
  --data-binary @desktop/release/Ecliptrix-Setup-1.0.2.exe
# → 201 { "release": { "id": "…", "status": "draft", "sha256": "…", "byteSize": … } }

curl -s -X PATCH "http://127.0.0.1:8787/api/v1/admin/releases/<id>" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"notes","notes":"首版：修复导出崩溃"}'
```

- 落盘：`RELEASES_DIR/.incoming/<uuid>.part` → 边写边算 SHA-256 与字节数（超过 1 GiB 立刻
  中止）→ fsync → 原子改名到 `<version>/<platform>/<sha256><ext>` → **最后**才 INSERT 行；
  任何一步失败都删临时文件、不写行。
- `fileName` 只用展示，先 `basename()` 再拒绝 `/ \ ..`；真实路径由内容决定，因此重复上传
  同一版本不会覆盖已发布的包。
- 校验和：可选 `sha256=` 参数，给了就必须与上传字节一致，否则 `422`。
- 冲突：`(version, platform, arch)` 已存在 → `409`；空文件 → `422`；超限 → `413`。
- 大文件没有浏览器的场合用 `npm run release:publish -- --file … --version … --publish`。

#### `PATCH /admin/releases/{id}`（`releases.write`）

```bash
-d '{"action":"publish"}'                       # 标记已发布并把该平台指针指过来
-d '{"action":"rollback","channel":"stable"}'   # 指针回到**更早且已发布**的版本
-d '{"action":"retract"}'                       # 撤回：同事务清空所有指向它的指针，文件保留
-d '{"action":"notes","notes":"修复 …"}'        # 只改发布说明
```

不变式：**历史是行，「当前」是指针**（`client_release_channels` 每 `(channel, platform)` 一行）。
回溯不删除任何东西；指向已撤回版本的状态无法构造；撤回命中当前指针时同事务清空。四条动作
都写 `audit_events`（`releases.upload` / `publish` / `rollback` / `retract`），`publish` 与
`rollback` 记录 before/after 的 `release_id`。

`rollback` 只能**向后**移动。把指针指回更新的版本用 `publish`（同一个指针动作）：回溯之后
那个更新的版本仍然是 `published` 行，控制台因此按版本号而不是按状态决定显示「发布」还是
「回溯」。

版本闸门（`client.minVersion`）比对的是 **stable 渠道当前服务的版本**，不是"任意已发布行"：
只发到 `beta` 的构建拿不到下载页，用它可以把自己锁死。另外，只有**变更过**的值才会校验——
控制台每次保存都提交整份设置，重新校验已存的那个值会让「改个登录次数上限」在一个早于本
特性就设过闸门的部署上失败。

### `GET /admin/sessions` / `POST /admin/sessions/revoke`

`users.read` / `sessions.revoke`（**`support` 也持有 `sessions.revoke`**，所以客服可以批量踢下线，这是既有角色设计）。

```bash
curl -s 'http://127.0.0.1:8787/api/v1/admin/sessions?client=desktop&activeOnly=1' \
  -H 'Cookie: ecs_session=…'
# → { "rows": [ { "userEmail": "a***@b.c", "ip": "1.2.x.x", … } ], "total": 42, "page": {…} }

curl -s -X POST http://127.0.0.1:8787/api/v1/admin/sessions/revoke \
  -H 'Cookie: ecs_session=…; ecs_csrf=…' -H "X-CSRF-Token: $CSRF" \
  -H 'Content-Type: application/json' \
  -d '{"ids":["…","…"],"reason":"admin_revoke"}'
# → { "revoked": 2, "skipped": 0 }；写入**一条**聚合审计 admin.sessions_revoked
```

列表里的邮箱与 IP 一律脱敏；上限 100 个 id（超出 → `422`），未知 id 计入 `skipped` 而不是失败。

### `/admin/mail`（outbox 可观测）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/mail` | `settings.read` | 列表，收件人脱敏 |
| GET | `/admin/mail/{id}` | `settings.read` | 详情：**只回文本**（`html` 永不回传），正文里的一次性凭据已脱敏为 `token=***` / `invite=***` / `***`（邀请码整行） |
| POST | `/admin/mail/{id}/retry` | `users.write` | 同步重试一次；`retryable=0`（含一次性链接）→ `409 conflict` |

> 重试权限是 `users.write` 而不是 `settings.write`：`admin` 角色没有 `settings.write`（只有 `owner` 有），那样就等于"只有超管能重试邮件"。

### `/admin/users/export`（CSV）

`users.read`，与列表同一套筛选参数。响应是附件：`text/csv; charset=utf-8` + UTF-8 BOM（否则 Excel 中文乱码），上限 20000 行，超出时用响应头 `X-Export-Truncated: 1` 表达。

### `/admin/users/{id}/email-verify` 与 `/admin/users/{id}/deletion`

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/admin/users/{id}/email-verify` | `users.write` | 管理员强制标记已验证（用户收不到信时的出口），审计 `user.email_verified_by_admin` |
| POST | `/admin/users/{id}/deletion` | `users.delete` | 管理员代确认注销（用户丢失邮箱访问权），`{ "reason": "…" }`；**不**跳过冷静期与审计 |

### `GET /admin/metrics?days=14|30`

`users.read`，`days` 范围 7–90，越界 → `422`。除既有字段外新增：

```jsonc
{
  "loginsTrend": [{ "date": "2026-01-01", "count": 12 }],
  "sessionsTrend": [{ "date": "2026-01-01", "count": 4 }],
  "emailVerifiedRate": 62.5,
  "pendingDeletions": 3,
  "clientBreakdown": [{ "platform": "win32-x64", "appVersion": "1.0.3", "sessions": 7 }],
  "rangeDays": 30
}
```

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
