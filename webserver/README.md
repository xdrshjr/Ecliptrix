# Ecliptrix Account Server (`webserver/`)

Ecliptrix 账号服务器：桌面端用户的**外部身份源**，附带 Supabase 风格的落地页、账号中心与管理员控制台。

它解决的问题是：桌面端是完全本地运行的 Electron 应用，安装即孤岛——运营方不知道谁在用、无法回收使用权、无法封禁滥用。这个子项目提供注册 / 登录 / 会话 / 角色与权限 / 审计，并让桌面端在启动时向它验证身份；唯一的例外是写死在本地配置文件里的**破窗账号**，见下文。

---

## 快速开始

```bash
cd webserver
npm install                # Node >= 20.11
cp .env.example .env        # 然后至少填 SESSION_SECRET / ROOT_ADMIN_*
npm run db:migrate
npm run dev                 # http://127.0.0.1:8787
```

必备环境变量（缺任一项会**拒绝启动**并打印全部问题，这是安全服务的底线）：

| 变量 | 说明 |
|---|---|
| `DATABASE_PATH` | SQLite 文件路径，父目录自动创建 |
| `PUBLIC_BASE_URL` | 本站公开地址，用于 Cookie 作用域、重置邮件链接 |
| `SESSION_SECRET` | ≥ 32 字节随机串；轮换它会作废全部会话（预期行为） |
| `ROOT_ADMIN_EMAIL` / `ROOT_ADMIN_PASSWORD` | 首个超级管理员；口令只在建号或 `RESET_ROOT_ADMIN_PASSWORD=true` 时写入 |

生成密钥：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

首次启动会自动：跑迁移 → 写入 4 个系统角色与权限矩阵 → 写入默认设置 → 创建/提升超级管理员 → 打印 ready 摘要（不含任何秘密）。

---

## 命令

```bash
npm run dev            # 开发服务器 :8787
npm run build          # 产出 .next/standalone
npm run start          # 生产启动
npm run lint           # ESLint（--max-warnings 0）
npm run type-check     # tsc --noEmit
npm test               # vitest（单元 + 集成，真实 SQLite）
npm run test:coverage  # 带覆盖率阈值

npm run db:migrate     # 应用未执行的迁移（幂等）
npm run db:backup      # 在线备份到 data/backup-<ts>.db
npm run seed:demo      # 仅非生产：创建 admin/support/member 三个演示账号（打印口令）
npm run user:create -- --email a@b.c --password '…' --role admin
npm run user:reset  -- --email a@b.c --password '…'    # 破窗重置（含解锁、踢下线）
```

CLI 直连数据库与服务层，**不起 HTTP**，输出只打印邮箱与角色，绝不打印口令或哈希。

---

## 角色与权限

四个系统角色，权限矩阵可在后台逐项勾选（`owner` 恒为 `*`，不可编辑）：

| 权限 | owner | admin | support | member |
|---|---|---|---|---|
| `users.read` | ✓ | ✓ | ✓ | |
| `users.write` | ✓ | ✓ | | |
| `users.delete` | ✓ | ✓ | | |
| `roles.read` | ✓ | ✓ | | |
| `roles.write` | ✓ | | | |
| `sessions.revoke` | ✓ | ✓ | ✓ | |
| `invites.read` / `invites.write` | ✓ | ✓ | | |
| `audit.read` | ✓ | ✓ | ✓ | |
| `settings.read` | ✓ | ✓ | | |
| `settings.write` | ✓ | | | |

`member` 不需要任何显式权限：`/me/*` 自助端点只要求「有会话」，不要求权限。

**保护规则（服务端强制，UI 只是反映）**

- `owner` 角色用户不能被停用 / 降级 / 删除（`cannot_modify_owner`）；
- 任何人不能停用或删除自己（`cannot_modify_self`）；
- 系统角色不可删除；仍有用户占用的自定义角色也不可删除（`role_in_use`）；
- 角色权限变更对目标用户的**下一次请求**立即生效，无需重新登录。

---

## API 概览

Base：`{PUBLIC_BASE_URL}/api/v1`。Web 用 `ecs_session` Cookie，桌面端用 `Authorization: Bearer`。

统一信封（与桌面端后端一致的字段名）：

```json
{ "success": true, "message": null, "timestamp": "…", "data": { } }
{ "success": false, "message": "…", "timestamp": "…", "error_code": "invalid_credentials",
  "error": { "code": "invalid_credentials", "message": "…", "details": { } } }
```

主要端点：`/health`、`/ready`、`/meta`、`/auth/{login,register,logout,refresh,heartbeat,session,password/*}`、`/me`、`/me/sessions`、`/me/activity`、`/admin/{metrics,users,users/bulk,users/{id}/*,sessions/{id},roles,invites,audit,settings}`。

完整说明（含请求体、错误码、限流数值与 curl 示例）见 [`docs/api.md`](docs/api.md)。

---

## 安全模型

| 关注点 | 做法 |
|---|---|
| 口令 | scrypt N=32768/r=8/p=1/keyLen=64，每用户 16 字节盐；登录成功且参数过旧就地 rehash |
| 口令策略 | ≥10 字符 / ≤128 字节、弱口令表、与邮箱用户名相似度、单字符重复（NIST 800-63B，不强制字符类） |
| 令牌 | 32 字节随机不透明串；库里只存 `HMAC-SHA256(SESSION_SECRET, token)` |
| 刷新轮换 | 每次刷新即轮换，旧摘要进入历史链；重放旧令牌 → 撤销该用户**全部**会话并记录事件 |
| CSRF | Cookie 会话的写请求必须带 `X-CSRF-Token`（双提交）；Bearer 请求天然豁免 |
| 枚举 | 登录失败统一文案；不存在账号也执行一次假 scrypt（防时序）；找回口令恒 202 |
| 锁定 | 连续失败达阈值 → 指数退避锁定，上限 24h；管理员可解锁 |
| 限流 | 进程内滑动窗口：登录 20/5min/IP 与 **12**/5min/标识（标识上限必须高于锁定阈值，否则永远看不到 423）、注册 10/h、重置 3/h、管理写 120/min |
| 越权 | 每个 `/me/*` 按 id 的操作在 service 内二次校验归属；他人会话 id 返回 404 而非 403 |
| 审计 | 所有写操作、登录尝试、鉴权拒绝都落库；metadata 只放非敏感前后差异 |
| 响应头 | CSP / HSTS（prod）/ X-Frame-Options / Referrer-Policy / Permissions-Policy 由 middleware 注入 |

`src/middleware.ts` 运行在 Edge，**只**做安全头与「无 Cookie → 跳登录」，不校验会话（`better-sqlite3` 是原生模块，Edge 不可用）。真正的鉴权在 Node 运行时。

---

## 部署

### Docker

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:8787/api/v1/ready
```

### systemd + Nginx

```bash
sudo cp deploy/webserver.service /etc/systemd/system/
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/webserver
sudo systemctl enable --now webserver
```

**单实例约束**：SQLite WAL 只允许一个写入进程。需要多副本时必须换 PostgreSQL（仓储层已隔离 SQL，但要重写 `db/client.ts` 与迁移语法）。

**迁移策略**：`deploy/webserver.service` 与 `docker-compose.yml` 都在启动时迁移（`AUTO_MIGRATE=true`）——运行产物里没有 TypeScript 工具链，`npm run db:migrate` 在那里跑不起来，而 `AUTO_MIGRATE=false` 遇到未应用的迁移会直接退出，`Restart=always` 只会把「拒绝启动」变成重启风暴。迁移器幂等、每个迁移单事务，重复启动无副作用。只有在你**能预迁移**的环境（CI 里带源码跑 `npm run db:migrate`，或多副本滚动升级）才应把它关掉。

### 运维

- 备份：`npm run db:backup`（SQLite `.backup`，运行中安全），建议 cron 每日。
- 审计保留：默认 180 天，用 SQL 按 `created_at` 清理；代码里没有删除接口，这是刻意的。
- 升级：`git pull && npm ci && npm run build`，然后**把静态资源同步进 standalone 目录**（`next build` 不会替你放）：
  ```bash
  cp -r .next/static .next/standalone/.next/
  [ -d public ] && cp -r public .next/standalone/
  cp -r src/server/db/migrations .next/standalone/migrations
  sudo systemctl restart webserver
  ```
  漏掉 `.next/static` 的表现是「页面能打开但没有样式」，而且 Nginx 会给 `/_next/static/` 加一年缓存，修好后还要清一次缓存。
- 排障：每个响应带 `X-Request-Id`，日志是单行 JSON，含 `requestId`。

---

## 桌面端接入 🔑

桌面端登录接入的完整契约（端点、令牌存储、离线宽限、错误映射、时序图）见 [`docs/desktop-integration.md`](docs/desktop-integration.md)（**v2**）。三条不变式：

1. **业务数据的 `user_id` 继续恒为 `LOCAL_OWNER_ID`**。身份认证只决定「谁能打开应用」，不改变本地数据归属，因此不需要任何数据迁移，也与 `CLAUDE.md` 的「No auth / single owner」约定兼容。
2. 普通用户**必须**联网校验；离线只允许在 7 天宽限期内继续使用，超过后必须重新联网。
3. 管理员在后台「踢下线」后，桌面端下一次心跳（15 分钟）就会拿到 401 并清空本地会话。

服务端为桌面端额外提供三条能力（都可在 `/admin/settings` 热改，不必发版）：

- **设备顶号**：桌面端带上稳定的 `device.deviceKey`（这台机器 + 这个 profile 的指纹，不是随机数）。同一设备再次登录时，服务端在**一个事务**内撤掉该设备的旧会话（`revoked_reason='same_device_relogin'`）再建新会话，因此重装或反复登录不会把每用户会话名额吃光；旧令牌随后的心跳得到 `401 session_revoked`。
- **版本闸门**：`client.minVersion` 非空时，低于它的桌面构建登录/注册直接 `426 client_outdated`（`details.minVersion` 给出目标版本），且**不消耗登录失败次数、不锁号**。`heartbeat` / `refresh` / `logout` 永不返回 426——旧客户端必须还能体面登出。
- **会话上限**：`security.maxActiveSessions`（1–50，默认 10）取代了硬编码常量。调小不会批量踢人，下一次登录按 LRU 收敛，被挤掉的会话记 `session_limit`。

维护模式（`app.maintenanceMessage` 非空）只拦**新的**登录/注册（`503 service_unavailable` + `details.reason='maintenance'`）：已经在工作的用户不会因为一条公告被踢出应用。

---

## ⚠️ 破窗账号（本地最高权限）

桌面端 `userData/desktop-config.json` 中有：

```json
{ "localAdmin": { "username": "admin", "password": "adminjr" } }
```

- 它**只存在于本地配置文件**，服务端没有这个账号，也永远不会有；
- 校验由主进程用 `crypto.timingSafeEqual` 完成，**不发任何网络请求**；
- 它不可被服务端吊销——这正是它存在的意义：服务端不可达、或管理员把所有人锁在门外时，用它救援；
- 它**不能**用来访问其他用户的云端数据，也不会加载任何服务端会话。

**交付前必须修改默认口令**，并在 README / 部署检查表里确认已改。修改方式：编辑该 JSON 的 `localAdmin.password`，重启桌面端。安全审计会把「保留了默认口令」视为后门。

---

## 目录结构

```
webserver/
├── src/
│   ├── app/
│   │   ├── (marketing)/      落地页、法务页（公开）
│   │   ├── (auth)/           登录、注册、找回、重置
│   │   ├── (console)/        account/* 与 admin/*（需会话 / 权限）
│   │   └── api/v1/           REST 边界：validate → guard → service
│   ├── components/           ui / marketing / auth / console / account / shell
│   ├── lib/                  api client、i18n、格式化、session 读法
│   ├── server/               config、db、auth、http、services、mail
│   └── middleware.ts         安全头 + Cookie 快速跳转
├── src/server/db/migrations/ 手写迁移（单一事务、只做加法）
├── tests/                    单元 + 集成（真实 SQLite，不 mock 数据库）
├── scripts/                  migrate / backup / user:create / user:reset
├── deploy/                   nginx.conf.example / webserver.service
└── docs/                     api.md / desktop-integration.md
```

分层铁律：`app/**/page.tsx` 只调 `server/services/*`；`app/api/**/route.ts` 只做「解析 + zod + 守卫 + 调 service + 统一回包」；SQL 只出现在 `server/db/repositories/*`。

---

## 验收自检

```bash
npm run type-check     # 0 error
npm run lint           # 0 warning
npm test               # 173 tests green（单元 + 集成 + RBAC 矩阵，真实 SQLite）
npm run build          # standalone 产物（含 /admin/users/[id]、/api/v1/me/deletion-request、OG 图）
npm run db:migrate     # 连跑两次，第二次输出 "nothing to do"

# 对运行中的服务做端到端冒烟（62 项断言，含 Cookie/CSRF/Bearer/重用检测/锁定/详情页/OG 图
# 以及桌面端闸门：设备顶号、426 版本闸门、维护模式、/me/sessions 的 current 与 deviceKey、
# 三个新设置项往返、maxActiveSessions 挤压）
npm run dev            # 另一个终端
node scripts/smoke.mjs
```

冒烟脚本会临时注册测试账号；如果它跑在**你自己的**数据库上，那些账号会留在库里。
建议对一次性数据库执行：`DATABASE_PATH=./data/smoke.db npm run dev`。同一进程连跑第二次会
因为登录 IP 限流（20 次 / 5 分钟）而出现假失败——冒烟应针对**新启动的进程**执行。

更多背景见计划文档 [`../docs/plans/webserver-user-management/spec.md`](../docs/plans/webserver-user-management/spec.md)。
