# 桌面端账号登录闸门（desktop-account-login-gate）— 设计方案 v2（第 2 轮 · 评审修订）

> 本文件是第 2 轮的唯一施工图。它把**用户原始需求里唯一尚未落地的那一半**补齐：桌面软件启动后的登录界面、与外部账号服务器（`webserver/`）的真实联调、以及写死在配置文件里的最高权限破窗账号 `admin / adminjr`。
>
> 上游依赖：`docs/plans/webserver-user-management/spec.md`（下称 **R1**）与 `webserver/docs/desktop-integration.md`（下称 **R1 契约**）。本文件**不重新设计**服务端的安全模型、RBAC、会话令牌机制；它只做三件事：① 在桌面端把 R1 契约真正实现出来；② 修正 R1 契约里 8 处照抄就会出错的地方（见 §8.1）；③ 给服务端补上桌面端客户端的三个刚需（设备顶号、版本闸门、会话上限可配）。
>
> 边界：本文件只产出设计与施工图，**不含实现代码**。下游实现必须按 §3.5 的阶段顺序施工，每阶段的判据全部通过才可进入下一阶段。

---

## 评审记录（Review Notes · v2）

> 评审人：Senior Reviewer（Anthropic engineering）· 评审对象：本文件 v1 · 评审日期：2026-10-08
> 评审方式：逐节对照**当前工作树**（不是记忆中的设计意图）逐条取证。凡文中对既有代码的断言，都在下面标注了核实结果；凡断言与代码不符的，一律按「照抄会出错」处理。
> 结论摘要：**P0 × 4（全部已在正文修复）· P1 × 13（全部已在正文修复）· P2 × 11（全部已在正文顺手修正）**。修复后的正文即为 v2 施工依据；评审结论见文末。

### R.1 P0（照本文实现会做出不可用或自伤的产品）

| 编号 | 位置 | 问题 | 证据（当前代码） | 正文处理 |
|---|---|---|---|---|
| **P0-1** | §2.4.1 校验表、§3.4、§4.6、§5.2 | 把 `ACCOUNT_SERVER_URL` 放进 `userData/.env` 是**无效配置**：Electron 主进程从不解析该文件，它只被注入给 FastAPI / Next 子进程（该模板 87 行、键全是 `LLM_*` / `ARK_*` / `VOLCANO_TTS_*` 这类后端凭证，本就没有主进程键的先例）。照此实现，打包后 `serverUrl` 恒为空，全员只能破窗（AC-01/AC-03/AC-06 全废） | `desktop/main/index.js:153-158` 只做 `loadUserEnv(envPath)` → `state.userEnv`；唯一消费点是 `desktop/main/backendService.js:40-42`、`frontendService.js:21-23`；`desktop/**/*.js` 无 dotenv，主进程只读继承的 `process.env`（`index.js:120-121`） | §2.4.1 增「配置来源与优先级」，`serverUrl` 权威来源改为 `desktop-config.json` 的 `auth.accountServerUrl`；env 降级为**可选覆盖**，且必须由 `index.js` 显式把 `state.userEnv` 注入 `readAuthConfig`。§4.6 表格与 §5.2 同步重写；新增附录差异 D2-09 |
| **P0-2** | §2.13 第 1 行、§2.7 第 1 条 | 「dev 窗口加载 `localhost:3000`，**没有 preload**，所以闸门以 `gate-disabled` 放行」是**事实错误**。`createMainWindow()` 无条件注入 preload，dev 分支用的正是它。而 dev 分支在 `main()` 里**早退**，任何放在它之后的 auth 注册都不会执行 → 渲染进程看到 `window.ecliptrixDesktop.auth` 存在但通道未注册 → 按 fail-closed 走 `bridge-unavailable` 阻断屏，**`npm run dev`（本项目桌面端主命令）被自己的闸门锁死** | `desktop/main/window.js:113-121`（无条件 `preload`）、`desktop/main/index.js:135-141`（dev 早退）、`index.js:130-133`（既有注释已明确「register renderer-facing IPC BEFORE the `--dev` early-return」，auth 未遵守） | §2.6 时序、§3.1 `index.js` 行、§2.7 第 1 条、§2.13 表格同步改写：auth 控制器与 10 个通道注册**必须放在 dev 早退之前**；dev 下由主进程自己给出 `gate-disabled`（`--dev` 即默认关闭，`ECLIPTRIX_AUTH_GATE=on` 可显式打开）；渲染进程的降级判据从「桥不存在」改为「主进程状态为 gate-disabled」，桥缺失只剩「浏览器直开」与「preload 缺失」两种来源。新增 AC-29 |
| **P0-3** | §2.4.2 `graceDeadline()` / `nextTimerDelay()` | 两个函数用 `Date.parse(session.refreshExpiresAt)` / `Date.parse(session.expiresAt)` 解析时间，但 §5.1 与 D2-04 已把会话文件的时间改成 **epoch 毫秒数字**。`Date.parse(1794118092434)` → `NaN`：① `byToken` 恒失效 → 宽限窗口不受刷新令牌寿命约束（最长可再进 7 天，进去后所有请求 401）；② `refreshAt = NaN` → `delayMs` 变 `NaN` → `setTimeout(fn, NaN)` 按 **1ms** 执行 → 心跳/续期热循环，直接把服务端刷新令牌打成「重用检测」→ 全场踢下线 | §5.1「时间为入库 epoch 毫秒」与 §2.4.2 代码自相矛盾（本文内部冲突，无需外部证据） | §2.4.2 两个函数的实现改为 `Number(...)` 取值并断言有限性（`Number.isFinite` 失败即视为无约束/退化为心跳），并明确「epoch ms 是内部唯一表示，`AuthStatus` 出口才转 ISO」；§6.1 测试点补 3 条（epoch 输入 → 有限数、`delayMs >= 1000`、`refreshExpiresAt` 有效时宽限被压缩） |
| **P0-4** | §3.3 `authService.login()` 第 ② 项 | 「`login()` 内用 `db.transaction()` 包住 `revokeActiveByDevice` + `createSession`」**不可行**：`authService.login` 是 `async`（口令校验走异步 scrypt），而 `better-sqlite3` 的事务函数必须**完全同步**——函数体内出现 `await` 会让事务提前结束或直接抛错。照写会在真实实现时被迫删掉事务（顶号变成两步、可留下「旧会话已撤、新会话没建」的空洞） | `webserver/src/server/services/authService.ts`（`export async function login` / `verifyCredentials`）；`webserver/src/server/services/sessionService.ts`（`createSession` 目前是同步的 `getDb()` + `repo.*`，说明事务必须留在同步层） | §3.3 改为新增**同步**服务函数 `sessionService.replaceDeviceSession()`（内部 `db.transaction(...)()`，函数体内禁止 `await`），`login()` 在口令校验**完成之后**调用它；§2.11 第 1 项同步改写；P0 阶段判据加「事务收敛在同步函数内」+ 集成测试断言原子性 |

### R.2 P1（缺失、错契约、错路由：会让下游写出返工代码）

| 编号 | 位置 | 问题 | 证据 | 正文处理 |
|---|---|---|---|---|
| **P1-1** | §2.4.2 判定表 | 表里没有 `serverUrl === ''` 分支，而 §2.4.1 与 §2.13 都要求 `blocked / server-not-configured`。更糟的是：未配服务器时 `meta()`/`heartbeat()` 都走「网络错误」，判定表会把**已有会话**放行成 `authenticated / offline-cache` —— 漏配被伪装成「离线可用」，且该会话再也无法被撤销 | 内部冲突；`AuthReason` 已含 `server-not-configured` 但判定表未使用 | 判定表新增第 **2** 行（`serverUrl === ''` → `blocked / server-not-configured`，保会话文件、保留破窗入口），其余行顺移为 #3–#12；§2.13 与 §8.1 里对 #10/#11 的引用同步改为 #11/#12 |
| **P1-2** | §2.5 / §2.6 / §2.7 | `AuthStatus.state` 有 `booting`，渲染表也有一行 `booting`，但**没有任何地方规定谁返回它**：`decideStartup()` 永不返回 booting，`controller.status()` 在 `start()` 完成前返回什么也没写。窗口创建后渲染进程立刻 `invoke('auth:status')`，若此时是 `undefined`/未注册，登录屏与骨架都会闪或崩 | 内部缺口 | §2.5 增「`status()` 的 cold 语义」：`start()` 落地前返回冻结常量 `{ state:'booting', source:null, reason:null, ... }`；§2.6 时序补「窗口首帧前 `auth:status` 必须可答」；P2 判据加断言 |
| **P1-3** | §2.6 `probeHeartbeat()`、§4.4 映射表 | 心跳不会返回 `403 password_change_required`——服务端对心跳**显式允许**改密前状态，并把 `mustChangePassword` 放在**响应体**里。照本文实现，桌面端永远收不到「管理员刚把你标记为必须改密」的信号（只有登录那一刻能拿到），AC-13 在长会话下失效 | `webserver/src/app/api/v1/auth/heartbeat/route.ts:17`（`allowPasswordChangeRequired: true`）、同文件响应体含 `mustChangePassword` / `role` / `permissions` / `expiresAt` | `probeHeartbeat()` 改为读响应体（`ok / mustChangePassword / role / permissions / expiresAt`），403 只保留 `account_suspended`、401 保留 `session_revoked`/`session_expired`；§4.4 该行改为「心跳体 `mustChangePassword` 或登录/改密接口 403」 |
| **P1-4** | §2.11 第 1 项、§4.2、§5.1、§5.4、R12 | **`deviceKey` 没有任何生成算法与归属模块**：全文 6 处引用，却没人定义它怎么算、由谁算、何时算。下游必然各自发明——用随机数则不稳定（重装即换，顶号失效，回到 §1.2 理由 3 的锁门问题）；用 `hostname` 则同机房镜像互相顶号 | 内部缺口（仅 §4.2 给了一个 32 位 hex 样例，§5.1 只是存下来） | §2.4.1 增纯函数契约 `deriveDeviceKey({ userDataPath, hostname })` = `sha256(userDataPath + 分隔符 + hostname)` 前 32 位小写 hex（稳定、无随机、随 profile 路径变化）；§4.2 标注由它填充；§6.1 加测试点；新增 AC-30 |
| **P1-5** | §2.5 IPC 表、§4.1 `AuthBridge.login` | `auth:login` 入参有 `rememberDevice?: boolean`，但 `AuthBridge.login` 签名里没有它，且**全文没有定义它的行为**。界面上有「☐ 记住这台设备」，实现者只能猜 | 内部缺口（§2.5 与 §4.1 自相矛盾） | 定义语义：`rememberDevice === false` → **不落盘**，只在主进程内存持有（关窗即失效，相当于「本次会话」）；默认 `true`。§2.5 表格、§2.5 通道备注、§4.1 类型、§5.1 落盘条件、§6.1 测试点五处对齐 |
| **P1-6** | §4.1 `SessionInfo` / `AuthStatus.user` | 与真实 DTO 不一致：`toSessionDto` 还返回 `client`、`userAgent`、`expiresAt`；登录响应体的 `user` 还带 `avatarUrl`。类型少字段不会编译报错，但「平台/客户端版本」列（§3.3 要新增的三列）取不到值 | `webserver/src/server/db/types.ts`（`SessionDto` 含 `client` / `userAgent` / `expiresAt`）；`webserver/src/app/api/v1/auth/login/route.ts`（`user` 含 `avatarUrl` / `lastLoginAt`） | §4.1 补齐 `client` / `expiresAt` / `deviceKey`（`SessionInfo`）与 `avatarUrl?`（`SessionUser`），并把 `AuthStatus.reason` 收紧为 `AuthReason` 联合类型（P2-3 一并修） |
| **P1-7** | §4.2「撤销设备」段 | 「撤销自己当前会话返回 `409 cannot_modify_self`」是**错的**。服务端对「撤销自己」是**允许并成功**的：`200 { revoked: true }`，同时失效该会话并清 Cookie。照本文实现会写出一段永远不生效的 `409` 分支，而真正的语义（自己把自己登出）没被处理 | `webserver/src/app/api/v1/me/sessions/[id]/route.ts`（200 + `revoked:true` + 清 Cookie）、`webserver/src/server/services/profileService.ts:120-121`（记 `logout`） | §4.2 改写为「200，且服务端已失效该会话 → 桌面端收到成功后必须立即本地登出并回登录屏」；UI 规则改为**前端**把当前设备按钮置灰（避免误触），不再依赖服务端 409 |
| **P1-8** | §2.11 第 4 项、§3.3 | 把「`GET /me/sessions` 返回 `current`」当成新改造——**该能力已交付**（`toSessionDto(row, auth.session.id)`）。真正缺的是 `deviceKey` 落库 + DTO 透出，而 §3.3 的改动清单漏了 `db/types.ts` 的 `SessionDto` | `webserver/src/app/api/v1/me/sessions/route.ts:13`、`webserver/src/server/db/types.ts`（`toSessionDto`） | §2.11 第 4 项改为「仅补 `deviceKey`（`current` 已存在）」；§3.3 该行补 `src/server/db/types.ts` 的 `SessionDto` |
| **P1-9** | §3.3 `sessionService` 行 | `settingsService.getInt(...)` **不存在**：该服务的读 API 是 `getBoolean / getNumber / getString`。同时没写「`MAX_ACTIVE_SESSIONS_PER_USER` 的实际生效点」——它在 `createSession` 里按 LRU 挤掉最老会话 | `webserver/src/server/services/settingsService.ts`（导出列表）、`webserver/src/server/services/sessionService.ts`（`oldestActiveIds(... MAX_ACTIVE_SESSIONS_PER_USER - 1)`） | §3.3 改为 `getNumber('security.maxActiveSessions')`，并点明生效位置在 `createSession()` 的 LRU 段；§5.5 补一句「调小后从**下一次登录**开始按 LRU 收敛，不批量踢在线会话」 |
| **P1-10** | §3.3 `authService` 第 ① 项、§2.11 第 3 项 | 版本闸门只写了「进入密码校验之前」，没写相对**限流**与**锁定计数**的位置。若放在限流之前，426 就成了免限流的探测面；若放在失败计数里，一次配置失误会把用户账号锁死 | `webserver/src/app/api/v1/auth/login/route.ts`（限流先行：`hit('login:ip')` → `hit('login:identifier')` → `authService.login`） | 明确顺序：**限流 → 维护 → 版本闸门 → 口令校验**；426 不写 `login_attempts`、不计锁、只写审计 `auth.login_blocked_outdated_client`；§6.3 加一条断言 |
| **P1-11** | §2.1 三条铁律、§6.5 AC-13 | 两处过度承诺：① AC-13「无法绕过改密对话框」——闸门与对话框都在渲染层，DevTools 可直接摘掉；② 全文没有**威胁模型**段落，读者会以为「登录」保护了本地项目数据。实际是：本地 FastAPI 仍无鉴权、`127.0.0.1` 上任何本地进程都能直连 | `CLAUDE.md`「No auth」；`src/lib/api/http-client.ts`（无凭证注入）；本项目单用户本地形态 | 新增 §2.1.1「威胁模型与非目标」：闸门只决定**谁看到窗口**，不是数据访问控制；AC-13 措辞改为「渲染层强制 + 主进程在改密前只放行 5 个通道」，并注明「这是本地单用户产品的合理边界」 |
| **P1-12** | §3.5 阶段表 | 六阶段**串行**且 P0（服务端）排第一，意味着桌面端 P1-P4 全部要等服务端改造落地才能联调；而桌面端真正难的部分（状态机、单飞、宽限）与设备顶号没有依赖关系。这一轮只有第 2/3 迭代，串行会浪费一轮 | 内部（§3.5 判据全部要求「全部通过才进下一阶段」） | §3.5 改为「串行阶段 + 并行通道」：P0 与 P1 并行（桌面端先用 `auth-smoke` 的假账号服务器当契约的**可执行定义**）；P0 的判据拆成「迁移幂等 / 集成测试 / smoke」三条独立项，允许分别通过 |
| **P1-13** | §3.2 最后两行（`src/app/login/page.tsx`） | 该深链入口与闸门语义冲突且无必要：`layout.tsx` 里 `SessionGate` 包住**所有** children，所以 `/login` 也会被包住——已登录时访问 `/login` 会再显示一张登录屏（可再登一次 → 第二条会话）；而且 `export const dynamic` 对 client component 无效（它只影响 RSC/数据获取），写了会造成「以为在防静态化」的错觉。多一条路由 = 多一条绕过/误导面，没有对应需求 | `src/app/layout.tsx`（单一 children 出口）、`src/app/page.tsx`（`'use client'`）、`src/app/` 下当前无登录路由 | §3.2 删除该文件；`?reason=` 改由 `SessionProvider` 从 `window.location.search` 读取（仅用于文案），不引入新路由 |

### R.3 P2（记录在案；全部已在正文顺手修正，其中 2 条属实现期需持续遵守的约定）

| 编号 | 位置 | 说明 | 处理 |
|---|---|---|---|
| P2-1 | §8.2 | 标题写「46 个」，实际列出 **65** 个键（已用脚本核数）。且根项目 `i18n.ts` 是**嵌套对象**接口（`Translations`，12 524 行，`translations: Record<string, Translations>`，locale 键为 `en` / `zh-CN`），点号键必须落成嵌套结构 | 已修：改为 65，并写明嵌套结构与三处同批补齐 |
| P2-2 | §2.7、§2.8 版式图 | 既有 `AppTitleBar` 是 `h-10`（**40px**）+ `WebkitAppRegion:'drag'`，不是 36px。登录屏若用 36px，进出应用时标题栏会跳 4px（「顶级体验」的自伤点） | 已修：统一 40px；并补两条实现陷阱：`sessionSlot` 必须落在 `no-drag` 集群内（`AppTitleBar.tsx` 的 `WebkitAppRegion:'no-drag'` 区），且 `AppTitleBar` 有 `if (!mounted) return null` 的挂载门（首帧不渲染，勿依赖它做布局占位） |
| P2-3 | §4.1 | `AuthStatus.reason` 写 `string \| null`，把已定义的 `AuthReason` 联合类型浪费了 | 已修（并入 P1-6） |
| P2-4 | §2.4.3、§5.3 | `0o600` 在 Windows(NTFS) 上不生效（`fs.chmod` 只影响只读位）。真实保护来自 `%APPDATA%` 的 ACL 继承 | 已修：改为「POSIX 上 `0o600`，Windows 依赖 `%APPDATA%` ACL，文档写清」 |
| P2-5 | §5.2 | 既有 `initUserData()` 是**浅合并**（`{...config, ...parsed}`），不是深合并：磁盘上若已有半截 `localAdmin` 对象，默认值不会逐字段补齐。本文「缺省自动回填」只在**整键缺失**时成立 | 已修：写明浅合并语义 + 由 `readAuthConfig` 逐字段兜底 |
| P2-6 | §3.1 `index.js` 行 | `desktop/main/index.js` **没有** `will-quit` 处理器，只有 `before-quit`（含 `state.quitting` / `stopChildren()` / `logger.close()`）。dispose 应挂进既有 `before-quit` 分支 | 已修 |
| P2-7 | §3.4 末行 | 把本文件写成「新增」，它已经存在 | 已修：改为「修改」 |
| P2-8 | §2.4.4、§3.3 | `errors.ts` 是 `errors.xxx()` 助手集合（`errors.rateLimited(...)` 等），新增 `errors.clientOutdated(minVersion)` 应沿用同一形态并登记到 `server/http/errors.ts` 的 HTTP 映射表 | 已修：点明形态 |
| P2-9 | §3.4 `env.template.desktop` | 该模板（87 行）在打包时经 `prepare-env.js` 生成 `build/env.template.desktop`，再由 electron-builder 投放到 asar 的 `scripts/`。改模板必须同步 `preflight` 的必需键校验，否则打包期前置检查会与新键打架 | 已修：补一句 |
| P2-10 | §6.4 手工清单 | 缺两条最容易被漏的：① dev 模式（`desktop/ npm run dev` + 浏览器直开 `:3000`）必须**不**出现阻断屏；② 已登录但服务器不可达时点「打开账号中心」（应降级为提示而不是静默失败） | 已修：M16、M17 |
| P2-11 | §2.9 第 7 条 | 「Windows ACL 继承 `%APPDATA%` 默认权限」——但 `desktop-config.json` 里有明文口令，且用户可能把它放进同步盘（OneDrive 重定向的 `Documents`/profile）。文档应显式警示「不要把 `%APPDATA%` 纳入云同步」 | 已修：并入 §2.9 第 7 条 |

### R.4 已核实为正确的关键断言（下游不必再怀疑）

| 断言 | 核实结果 |
|---|---|
| `webserver` 有完整的 `/auth/{login,register,refresh,heartbeat,logout,password/change,password/reset/request}`、`/me/sessions`（GET + DELETE `[id]`）、`/meta`（公开）、`PATCH /admin/settings` | 全部存在（`webserver/src/app/api/v1/**`） |
| `MAX_ACTIVE_SESSIONS_PER_USER = 10` 位于 `constants.ts:66`，且是硬编码上限 | 正确（`sessionService.createSession` 内 LRU 挤占） |
| 20 个被引用的服务端 `error_code` 字符串 | 全部存在且大小写一致（`constants.ts:31-60`，实际共 29 个，本文未引用的 9 个：`invalid_request` / `unauthorized` / `forbidden` / `cannot_modify_owner` / `role_in_use` / `system_role_protected` / `not_found` / `conflict` / `csrf_failed`） |
| 桌面 `POST /auth/refresh` 无 `Authorization`、无 Cookie 也得双令牌（AC-15 的前提） | 成立：`refresh/route.ts` 按**载体**判定，`body.refreshToken` 即桌面模式、免 CSRF |
| `deployment-checklist.md` 写「46 checks」是陈旧值 | 正确（实际 `smoke.mjs` 52 条 `check`；`README.md` 也写 52） |
| Electron 主进程可用全局 `fetch` | 成立：`desktop/package.json` 的 `electron ^33.4.11`（Node 20+） |
| `frame: false`、`contextIsolation: true`、`nodeIntegration: false` | 成立（`window.js:112-121`） |
| `initUserData()` 首次运行复制 env 模板；已存在则不动 | 成立（`config.js:33-37`） |
| 端口变更对话框已有「登录状态与本地偏好可能需要重新设置」字样（R6 要求改文案） | 成立（`index.js:205`） |
| `src/app/layout.tsx` 只有 `LocaleProvider` + `NotificationProvider` 两层，且是 Server Component | 成立（38 行，无 `'use client'`）；本文的包裹顺序可直接落地 |
| `src/app/page.tsx` 会 `openTask('video')`、已有 `useDesktopCloseGuard()` | 成立（`page.tsx:42,56-60,143`） |
| `autosaveRegistry` 提供可 await 的 flush 入口 | 成立：`flushAllPending(timeoutMs)`（`src/components/video/projects/autosaveRegistry.ts`） |
| `vitest.config.ts` 会收 `src/**/*.test.ts(x)`，jsdom + globals 已配好 | 成立；本文三个渲染测试路径都在收范围内 |
| §3.2/§3.3 引用的既有文件都存在（`AppTitleBar.tsx`、`settings-form.tsx`、`user-sessions-panel.tsx`、`(console)/admin/settings/page.tsx`、`webserver/docs/*.md`、`desktop/scripts/env.template.desktop`、`src/lib/localOwner.ts`） | 全部存在 |

---

## 0. 一句话结论

R1 交付了一个**可以用浏览器登录的账号服务器**（落地页 / 账号中心 / 管理后台 / REST / 部署），但**桌面端至今没有任何登录界面**：`src/app/page.tsx` 一启动就直开剪辑工作台，`desktop/main/config.js` 里没有 `localAdmin` 键，`desktop/preload/preload.js` 只暴露了窗口控制和关窗握手，`src/lib/api/http-client.ts` 的注释甚至明确写着「There is no authentication layer」。也就是说，用户需求中的「用户打开软件后会有登录界面，登录/注册连到外部服务器」目前**只完成了一半（服务端侧）**。本轮做的就是那另一半。

---

## 1. Overview（概述）

### 1.1 要建的是什么

给 Electron 桌面端增加**身份闸门**（identity gate）：应用启动到第一帧之前，先向账号服务器确认「这台机器上这个人是谁」，未确认就停在**全窗口登录界面**，确认通过才挂载原有的剪辑工作台。闸门有两种入口，二者互不替代：

- **形态 A：账号服务器登录**。用户在登录界面输入邮箱或用户名 + 口令，主进程通过 HTTPS 调 `POST /api/v1/auth/login`（`client: "desktop"`），拿到一对外部令牌（access 12 小时 / refresh 90 天）。**注册、找回口令、改密、查看与撤销自己的设备**同样直连账号服务器。
- **形态 B：本地破窗登录**。`%APPDATA%\Ecliptrix\desktop-config.json` 中新增 `localAdmin: { username: "admin", password: "adminjr", enabled: true }`。用户点「使用本地管理员登录」时，主进程用 `crypto.timingSafeEqual` 做常量时间比对，**不发任何网络请求**，直接以 `role: owner / permissions: ["*"]` 进入应用。这是设备救援通道（账号服务器宕机、用户忘记口令、跨域网络被墙时仍能打开本机数据），不是账号恢复通道。

### 1.2 为什么现在做

三个理由，按紧迫度排列：

1. **需求闭合**。用户原话是「这个本地的软件，用户后续打开以后，它会有对应的登录界面」，并且明确要求普通用户「必须通过登录的方式」、只有 admin 可以离线直进。R1 只在服务端把这套模型定义清楚了（R1 契约 §1–§8），桌面端一行都没写。不补这一半，`webserver/` 就是一台没人拨号的交换机。
2. **把「令牌放哪里」这个决定做对**。R1 契约 §8 拟定在渲染进程里新增 `src/lib/api/authClient.ts`，同时又要求令牌加密落在 `userData/auth-session.json`（由主进程的 `safeStorage` 管理）。这两条**不能同时成立**：令牌要么在渲染进程（可被一个 XSS 取走 90 天刷新令牌），要么在主进程（渲染进程只能拿到脱敏后的会话摘要）。本轮按后者定案（§2.3），并把它记成 R1 契约的差异（§8.1 D2-01）。
3. **修掉一个会在真实使用中把用户锁在门外的组合缺陷**。服务端有 `MAX_ACTIVE_SESSIONS_PER_USER = 10` 的硬上限（`webserver/src/server/auth/constants.ts:66`），而桌面端的 90 天刷新令牌意味着会话几乎不会自然过期。用户重装、换机器、或端口迁移后重新登录，每次都是一条**新**的活跃会话；第 11 次登录时最早那条被踢掉，但用户看到的是一台「好好的机器突然要重新登录」。同一台设备重新登录应当**顶掉自己的旧会话**，而不是消耗名额 —— 这需要服务端认识「设备」，见 §2.11 / §5.4。

### 1.3 不做什么（本轮的明确边界）

- 不做 2FA / WebAuthn / 单点登录（R1 §8.3 已明确延后）。
- 不改业务数据归属：`backend-services/basic-service/app/constants.py` 与 `src/lib/localOwner.ts` 的 `LOCAL_OWNER_ID` **一个字都不改**。身份只决定「谁能打开应用」，不改变本地数据属于谁，因此**不产生任何数据迁移**（沿用 R1 契约 §7 不变式 1）。
- 不做「多账号切换」（同一台机器同时保持多个账号的会话）。一次只有一个身份，这是桌面单写者模型的直接结果。
- 不改 `src/lib/api/http-client.ts` 的鉴权行为（它只服务于 `127.0.0.1` 的本地后端，见 §8.1 D2-02）。

---

## 2. Technical Design（技术设计）

### 2.1 目标形态与信任边界

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Electron main process（唯一持有凭证的进程）                                │
│  config.js ──► localAdmin{username,password,enabled}                      │
│  authConfig.js  authPolicy.js  authErrors.js                              │
│  authSessionStore.js ── safeStorage(DPAPI) ──► userData/auth-session.json │
│  authHttp.js ── fetch(HTTPS) ──► ACCOUNT_SERVER_URL/api/v1/*              │
│  localAdmin.js ── timingSafeEqual ──► 失败计数 userData/auth-attempts.json│
│  authController.js（状态机 + 单飞刷新 + 心跳定时器）                        │
│  authBridge.js ── ipcMain.handle('auth:*')                                │
└───────────────────────────▲──────────────────────────────────────────────┘
                            │ contextBridge: window.ecliptrixDesktop.auth.*
                            │ （只传脱敏 AuthStatus，永不传 accessToken/refreshToken）
┌───────────────────────────┴──────────────────────────────────────────────┐
│ Renderer（Next.js，跑在 http://127.0.0.1:<frontendPort>）                  │
│  SessionProvider ──► SessionGate ──► LoginScreen | children               │
│  authBridge.ts（类型化包装 + 非 Electron 降级）                            │
└──────────────────────────────────────────────────────────────────────────┘
```

三条铁律：

1. **令牌不出主进程**。`preload.js` 的 `auth` 命名空间里**没有** `readToken` / `writeToken` 之类的通道；渲染进程能拿到的只有 `AuthStatus`（用户摘要 + 过期时间 + 服务端元信息）。
2. **口令不落盘**。渲染进程只把口令作为 `ipcRenderer.invoke` 的一次性参数交给主进程，主进程用完即丢弃；不写日志、不写文件、不出现在 IPC 返回值里。
3. **闸门在渲染进程的第一层**，不在业务组件里。`SessionGate` 位于 `layout.tsx` 内、`page.tsx` 外，未认证时 `page.tsx` 根本不挂载，`useTasks` / `useTimelineStore` / 本地后端探活都不会跑。

#### 2.1.1 威胁模型与非目标（v2 新增，先读再改代码）

「登录闸门」这四个字很容易让人以为本地数据被保护了。**不是。** 本设计保护的是三样东西，且只保护它们：

| 保护对象 | 靠什么 | 不保护时会怎样 |
|---|---|---|
| 外部账号服务器上的凭证与会话 | 令牌只在主进程 + `safeStorage` 加密 + Bearer 而非 Cookie | 一次 XSS 换走 90 天刷新令牌 |
| 应用窗口的可见性 | `SessionGate` 是渲染树第一层 | 未授权的人看到工作台 |
| 会话可撤销性 | 心跳 + 单飞续期 + 设备列表 | 管理员踢不掉一台已丢失的机器 |

**明确不保护的（写在这里是为了让实现者不去做无用功，也为了让评审不误判）**：

1. **本地项目数据**。`backend-services/` 仍然**没有**任何鉴权依赖，`127.0.0.1:<backendPort>` 上任何本地进程都能直连读写；`projects/`、`storage/`、`data/ecliptrix.db` 对当前 Windows 用户完全可读。这与 `CLAUDE.md`「No auth」一致，是**单用户本地产品的既定形态**，本轮不改（改它等于重做后端鉴权，属另一个项目）。
2. **同机其他 Windows 用户**。跨用户隔离由 Windows 账户与 `%APPDATA%` 的 ACL 承担，不由本设计承担。
3. **进程内沙箱**。这是 Electron 应用，不是多租户服务；能拿到这台机器交互权限的人，理论上也能改 `desktop-config.json`（这正是破窗通道存在的前提）。

**攻击面与处置（逐条，实现时对照）**：

| 攻击面 | 本设计做什么 | 本设计不做什么（以及为什么可以接受） |
|---|---|---|
| 渲染进程 XSS | 令牌根本不在渲染进程；`AuthStatus` 无令牌（AC-05） | 不做 CSP 加固/富文本消毒——那是独立议题，本设计只把**后果**从「凭证泄漏」降到「一次 UI 伪造」 |
| 本地恶意进程 | 无（见非目标 1） | 不做本地 socket 鉴权；说明写在文档里，而不是假装防住 |
| `desktop-config.json` 被改 | 常量时间比对 + 失败锁定 + 默认口令告警；`enabled` 开关 | 不做文件完整性签名——签名后用户就无法按文档改口令了 |
| 服务器被冒充 / 中间人 | 强制 `https://`（本地地址除外）+ Node 默认证书校验 | **不做证书 pinning**：pin 会让证书轮换变成一次全员停服 |
| 刷新令牌重放 | 单飞 `withTokenLock`；服务端重用检测撤销全场 | 不做本地令牌分片/HSM |
| 用户在打包产物里开 DevTools 绕过 UI | 主进程侧状态机仍是唯一真相；业务树卸载后无数据可看 | **不声称 UI 强制不可绕过**：AC-13 的准确表述是「渲染层强制 + 主进程在改密期间只正常服务 5 个通道」，不是「技术上不可能绕过」。这是本地单用户产品的合理边界 |

---

### 2.2 架构总览（模块职责）

| 模块 | 层 | 职责 | 不做什么 |
|---|---|---|---|
| `desktop/main/authConfig.js` | 纯函数 | 合并 `process.env` + `desktop-config.json` → `AuthConfig`（含默认值与范围校验） | 不读文件、不发请求 |
| `desktop/main/authErrors.js` | 纯常量/纯函数 | 服务端错误码枚举、`toUiReason()`、`isRetryable()`、`RETRYABLE` 集合 | 不依赖 electron |
| `desktop/main/authPolicy.js` | 纯函数 | `decideStartup()` 启动决策、`graceDeadline()`、`detectClockRollback()`、`nextTimerDelay()`、`compareVersions()` | 不做 IO |
| `desktop/main/authSessionStore.js` | 基础设施 | 读写 `auth-session.json`（safeStorage 封装、`schemaVersion` 迁移、损坏即视为未登录） | 不判定业务状态 |
| `desktop/main/authHttp.js` | 基础设施 | 账号服务器 HTTP 客户端：信封解包、超时、错误码→异常、`X-Request-Id` 透传日志 | 不存令牌 |
| `desktop/main/localAdmin.js` | 领域 | 破窗凭据校验（常量时间）、失败计数、指数退避锁 | 不发请求、不碰会话文件 |
| `desktop/main/authController.js` | 应用 | 唯一的状态机；`login/loginLocal/logout/register/changePassword/…`；单飞刷新；心跳；`auth:changed` 事件 | 不认识 ipcMain |
| `desktop/main/authBridge.js` | 接口 | `ipcMain.handle` 注册、入参校验、错误归一化、日志脱敏 | 不实现业务 |
| `src/lib/api/authBridge.ts` | 接口 | 渲染侧类型化包装 + 桥不可用时的降级 | 不解析令牌 |
| `src/contexts/SessionContext.tsx` | 应用 | 渲染侧状态机、订阅事件、暴露 `useSession()` | 不做业务判定 |
| `src/components/auth/*` | 表现 | 登录界面、注册、破窗入口、改密、阻断屏、账号菜单 | 不直接调 IPC（只经 `authBridge`） |

### 2.3 关键决策：令牌只在主进程（推翻 R1 契约 §8 的 `authClient.ts`）

**方案对比**

| 方案 | 令牌位置 | XSS 时 90 天刷新令牌是否可被取走 | 离线宽限判定位置 | 结论 |
|---|---|---|---|---|
| M（主进程持有） | `userData/auth-session.json`（DPAPI） | 否（渲染进程根本没有） | 主进程（可独立于渲染进程运行） | **采用** |
| R（渲染进程持有） | 同上文件，但经 IPC 读入渲染进程内存 | 是 | 渲染进程（关窗即丢，无法独立心跳） | 否决 |
| L（localStorage） | 渲染进程 localStorage | 是（且加密无意义） | 渲染进程 | 否决 |

理由不是「洁癖」，是三条具体收益：

1. 渲染进程是 Next.js 应用，加载第三方 markdown / 富文本 / 远程图片，是攻击面最大的一层；令牌不在那里，XSS 的天花板是「一次 UI 级伪造」，而不是「一份 90 天可复用的凭证」。
2. 心跳、续期、离线宽限必须在**窗口不可见时仍然成立**（用户最小化两小时再放大，不能要求重新登录）。主进程的定时器天然满足；渲染进程的定时器会被节流甚至冻结。
3. `safeStorage` 只有主进程能调。把令牌经 IPC 搬到渲染进程，等于每条会话都多一次明文过桥。

因此 R1 契约里的 `src/lib/api/authClient.ts` **不创建**，改为：
- 主进程：`desktop/main/authHttp.js`（唯一的账号服务器 HTTP 客户端）；
- 渲染进程：`src/lib/api/authBridge.ts`（唯一的 IPC 包装）。

### 2.4 主进程各模块的精确契约

#### 2.4.1 `authConfig.js`

```js
/**
 * @param {{ config: object, env: Record<string,string|undefined>,
 *           isDev: boolean, userDataPath: string, hostname: string }} input
 * @returns {AuthConfig}
 */
function readAuthConfig({ config, env, isDev, userDataPath, hostname })

/**
 * 稳定的设备标识：同一台机器 + 同一 userData 目录 → 同一字符串。
 * 不含随机数（随机数会让「重装即换键」，顶号机制失效，回到 §1.2 理由 3）；
 * 不含端口（端口会漂移）；含 userDataPath 是因为它包含机器名与用户名，
 * 能让同一账号在两台机器上自然分开。
 * @param {{ userDataPath: string, hostname: string }} input
 * @returns {string} 小写十六进制，32 字符（= sha256 前 16 字节）
 */
function deriveDeviceKey({ userDataPath, hostname })

/**
 * @typedef {Object} AuthConfig
 * @property {string}  serverUrl          // 去掉尾部斜杠；空串表示未配置
 * @property {number}  graceDays          // 1..30，默认 7
 * @property {number}  loginTimeoutMs     // 默认 8000
 * @property {number}  probeTimeoutMs     // /health /meta，默认 3000
 * @property {number}  heartbeatTimeoutMs // 默认 5000
 * @property {number}  heartbeatIntervalMs// 默认 15 * 60 * 1000
 * @property {number}  refreshLeadMs      // 默认 5 * 60 * 1000（到期前 5 分钟续期）
 * @property {boolean} gateEnabled        // 见下方 resolveGate
 * @property {string}  deviceKey          // deriveDeviceKey 的结果
 * @property {{username:string,password:string,enabled:boolean}} localAdmin
 * @property {string}  appVersion         // 由调用方注入
 */
```

实现约定：把 `hostname` 与 `userDataPath` 用换行符拼成一串（顺序固定：先 `hostname` 后 `userDataPath`），取 `sha256`，转小写十六进制，截前 32 位。不含随机盐、不含时间、不含端口——**同一个 profile 目录在任何一次启动、任何一次升级后都得到同一个键**（这正是「同一设备重新登录顶掉自己」的前提）。

**配置来源与优先级（v1 在这里写错了，这是本轮 P0-1）**

v1 把 `ACCOUNT_SERVER_URL` 写进 `userData/.env`。**主进程读不到那个文件。** 该文件由 `initUserData()` 从 `desktop/scripts/env.template.desktop`（87 行，键全是 `LLM_*` / `ARK_*` / `VOLCANO_TTS_*` 这类**后端**凭证）复制而来，只在 `index.js:153-158` 被 `loadUserEnv()` 解析成 `state.userEnv`，随后仅注入给 FastAPI（`backendService.js`）与 Next（`frontendService.js`）子进程。`desktop/**/*.js` 里既没有 `dotenv`，也没有任何 `process.env.X = …` 赋值——主进程只能看到启动器继承的 `process.env`。

所以权威来源换成配置文件，env 只作可选的运维覆盖：

| 来源 | 键 | 规则 | 默认 |
|---|---|---|---|
| **config（权威）** | `auth.accountServerUrl` | trim；去尾斜杠；必须 `https://`（`http://` 仅在 `isDev === true` 或主机为 `127.0.0.1`/`localhost` 时接受）；非法 → 视为 `''` 并 warn | `''` |
| **config（权威）** | `auth.offlineGraceDays` | 整数 1..30，越界夹取 | `7` |
| env（可选覆盖） | `ACCOUNT_SERVER_URL` | 同 config 的 URL 规则；**仅当调用方把 `state.userEnv` 显式传进 `readAuthConfig` 时生效**（覆盖 config）。`index.js` 直接传 `{ ...process.env, ...state.userEnv }` 以同时吃到两种来源 | 不参与 |
| env（可选覆盖） | `ACCOUNT_OFFLINE_GRACE_DAYS` | 整数 1..30 | 不参与 |
| env | `ECLIPTRIX_AUTH_GATE` | `on` / `off`；未设置时按 `resolveGate()` 推断 | 见下 |
| config | `localAdmin.username` | trim，非空，≤ 64 | `admin` |
| config | `localAdmin.password` | 非空，≤ 128 | `adminjr` |
| config | `localAdmin.enabled` | 布尔，缺省 `true` | `true` |
| 派生 | `deviceKey` | `deriveDeviceKey({ userDataPath, hostname })` | 计算得出 |

`resolveGate({ isDev, env })`：`env.ECLIPTRIX_AUTH_GATE === 'off'` → `false`；`=== 'on'` → `true`；**未设置时 `isDev ? false : true`**。

> 为什么 dev 默认关闭：`desktop/ npm run dev` 会在 `main()` 里**早退**（`index.js:135-141`），且 `createMainWindow()` **无条件注入 preload**（`window.js:113-121`）。v1 假设「dev 没有 preload 所以天然放行」是错的（P0-2）。正确做法是让主进程**在 dev 下自己宣布** `gate-disabled`，而渲染进程的降级判据只认「主进程状态」，不认「桥在不在」。

> `serverUrl === ''` 时的行为：闸门**不阻断整个应用**，而是 `blocked / server-not-configured`，渲染一张只保留「使用本地管理员登录」的提示屏，并在日志里 warn 一次。理由：开发版与内部构建本来就没有服务器；把开发机锁死比漏配更糟。（该分支已并入 §2.4.2 判定表的第 2.5 行。）

#### 2.4.2 `authPolicy.js`（本文件的核心算法，必须逐函数实现）

```js
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000
const DAY_MS = 86400_000

/**
 * 会话文件里的时间是 **epoch 毫秒数字**（§5.1 / D2-04），不是 ISO 字符串。
 * v1 在这里用了 Date.parse(...) —— 传入数字会得到 NaN，宽限与定时器会双双失效
 * （P0-3）。因此内部一律用 toMillis() 归一，非有限值视为「未提供」。
 */
function toMillis(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** 离线宽限截止时刻；同时受刷新令牌寿命约束。@returns {number} epoch ms */
function graceDeadline(session, config) {
  const lastVerifiedAt = toMillis(session.lastVerifiedAt) ?? 0
  const byGrace = lastVerifiedAt + config.graceDays * DAY_MS
  const byToken = toMillis(session.refreshExpiresAt)
  return byToken === null ? byGrace : Math.min(byGrace, byToken)
}

/** 用户把系统时间往回调，宽限窗口就失效了；容忍 5 分钟。@returns {boolean} */
function detectClockRollback(session, now) {
  return Number.isFinite(session.lastVerifiedAt) && now < session.lastVerifiedAt - CLOCK_SKEW_TOLERANCE_MS
}

/**
 * 启动决策。顺序不可调换。
 * @param {{
 *   session: object|null, now: number, config: AuthConfig,
 *   heartbeat: { status: 'ok'|'revoked'|'suspended'|'expired'|'network'|'locked'|'outdated'|'maintenance'|'password-change-required',
 *                user?: object, permissions?: string[], expiresAt?: string, serverTimeAt?: number },
 * }} input
 * @returns {{ state: 'authenticated'|'unauthenticated'|'blocked',
 *             source: 'server'|'offline-cache'|'local-root'|'gate-disabled'|null,
 *             reason: string|null, mustChangePassword?: boolean }}
 */
function decideStartup(input)
```

> **时间表示的铁律（v2 新增，P0-3）**：`AuthStatus` 出口才把 epoch 转 ISO（`new Date(ms).toISOString()`）；`auth-session.json` 与 `authPolicy` 内部**永远**是 epoch 数字。`authSessionStore.write()` 与 `controller.status()` 各校验一次，防止有人把 ISO 字符串又写回磁盘——这正是 v1 那个 `Date.parse(数字) → NaN` 缺陷的来源。

`decideStartup` 的判定表（实现时逐行照抄，顺序即优先级）：

| # | 条件 | 结果 |
|---|---|---|
| 1 | `config.gateEnabled === false` | `authenticated / gate-disabled / null` |
| 2 | `config.serverUrl === ''` | `blocked / null / 'server-not-configured'`（**保留**会话文件；界面只留破窗入口）。**v2 新增行**：v1 缺这一行，导致漏配服务器时 `meta()`/`heartbeat()` 都算「网络错误」，被 #10 放行成 `offline-cache` —— 一个连不上的服务器被伪装成「离线可用」 |
| 3 | `session == null` | `unauthenticated / null / 'no-session'` |
| 4 | `detectClockRollback(session, now)` | `unauthenticated / null / 'clock-rollback'`（**不清空**会话文件） |
| 5 | `heartbeat.status === 'ok'` | `authenticated / server / null` |
| 6 | `'password-change-required'` | `authenticated / server / null` + `mustChangePassword: true` |
| 7 | `'revoked'` / `'suspended'` / `'locked'` | `unauthenticated / null / <同名字符串>`（**清空**会话文件） |
| 8 | `'expired'`（刷新也失败） | `unauthenticated / null / 'session-revoked'`（清空；重用检测） |
| 9 | `'outdated'` | `blocked / null / 'client-outdated'`（**保留**会话） |
| 10 | `'maintenance'` | `blocked / null / 'maintenance'`（保留会话） |
| 11 | `'network'` 且 `now <= graceDeadline(...)` | `authenticated / offline-cache / null` |
| 12 | `'network'` 且超过宽限 | `unauthenticated / null / 'grace-expired'`（保留会话文件） |

> 行号是**优先级**，不是执行次数：命中即返回。原 #3–#11 的编号在 v2 里顺移为 #4–#12，但 §2.13 与 §8.1 里「判定表 #10/#11」的引用改为「#11/#12」——**实现时以本表的行序为准，不要在代码里硬编码编号常量**。

另外两个纯函数：

```js
/** 下一次定时器应该醒来干什么；两者取最早。 */
function nextTimerDelay(session, now, config) // → { action: 'refresh'|'heartbeat', delayMs: number }
/** 语义化版本比较：'1.0.10' > '1.0.9'；非法输入返回 0。 */
function compareVersions(a, b) // → -1 | 0 | 1
```

`nextTimerDelay` 规则（v2 修正，P0-3）：`refreshAt = toMillis(session.expiresAt) - config.refreshLeadMs`；`heartbeatAt = toMillis(session.lastVerifiedAt) + config.heartbeatIntervalMs`；任一侧为 `null`（字段缺失/损坏）则**忽略该侧**，只有两侧都不可用时才退回 `{ action: 'heartbeat', delayMs: config.heartbeatIntervalMs }`。取较小者，`delayMs = max(0, target - now)`，并夹取到 `[1_000, 24h]`。

> 那两个夹取边界不是防御性代码，是**缺陷隔离**：`setTimeout(fn, NaN)` 在 Node 里会被当成 1ms，形成秒级热循环；夹到 `[1000, 24h]` 之后，即使时间字段全坏，最坏也只是每 1 秒的定时器触发器（一次纯函数计算，不发请求），不会把服务端刷新令牌打成「重用检测」。

#### 2.4.3 `authSessionStore.js`

```js
/**
 * @param {{ dir: string, safeStorage: Electron.SafeStorage|null, fs?: typeof import('fs'), now?: () => number }} deps
 * @returns {{
 *   path: string,
 *   read(): { session: object|null, corrupt: boolean },
 *   write(session: object): { encrypted: boolean },
 *   clear(): void,
 * }}
 */
function createSessionStore(deps)
```

规则：
- 文件固定 `path.join(dir, 'auth-session.json')`，写入用「临时文件 + `fs.renameSync`」的原子替换，权限 `0o600`。
  > **Windows 说明（v2，P2-4）**：NTFS 上 `fs.chmod(0o600)` 只影响只读位，不改变 ACL。真实的保护来自 `%APPDATA%` 目录继承的默认 ACL（当前用户 + Administrators）。因此 `0o600` 是「POSIX 上顺手做对」，**不是**安全声明；Windows 上的安全边界写在 §2.1.1 非目标 2 里，不要在注释里许诺它做不到的事。
- 加密信封：`{ v: 1, enc: 'safeStorage' | 'plain', payload: <base64> }`。`payload` 解密后是 UTF-8 JSON。
- `safeStorage.isEncryptionAvailable() === false`（极少见的 Windows 服务账户 / 无 keyring 的 Linux）→ 退化为 `enc: 'plain'`，返回 `{encrypted: false}`，控制器据此**强制**在状态里带上 `securityWarning: 'plaintext-session'`，界面显示黄色告警条，并写一条 `auth.session.plaintext` 本地日志。绝不静默降级。
- `read()` 的容错：文件不存在 → `{session: null, corrupt: false}`；JSON 解析失败 / 解密失败 / 字段校验失败 → `{session: null, corrupt: true}`（控制器把 `corrupt` 记一次 `auth.session.corrupt` 日志，并按未登录处理，**不删除**文件，便于事后取证）。
- `schemaVersion` 迁移：`session.schemaVersion !== 1` 时，把已知字段搬过来重写（`v0`（R1 契约 §3 原样）→ `v1` 的差异只有新增 `schemaVersion` / `sessionId` / `deviceKey` / `serverTimeAt`，其余字段同名）。

#### 2.4.4 `authHttp.js`

```js
/**
 * @param {{ baseUrl: string, clientVersion: string,
 *           fetchImpl?: typeof fetch, logger?: object,
 *           timeouts: { probeMs:number, loginMs:number, heartbeatMs:number, sessionMs:number } }} deps
 */
function createAccountClient(deps)
```

方法（全部返回 Promise，**抛** `AccountError`，不返回 `{ok}` 布尔）：

| 方法 | HTTP | 超时 | 重试 |
|---|---|---|---|
| `probe()` | `GET /api/v1/health` | `probeMs` | 0（调用方决定） |
| `meta()` | `GET /api/v1/meta` | `probeMs` | 1 次，间隔 500ms（只对网络错误/5xx） |
| `login(payload)` | `POST /api/v1/auth/login` | `loginMs` | **绝不重试**（重试＝多烧一次失败计数） |
| `register(payload)` | `POST /api/v1/auth/register` | `loginMs` | 绝不重试 |
| `refresh(refreshToken)` | `POST /api/v1/auth/refresh` | `loginMs` | **绝不重试**（重试＝服务端判定刷新令牌重用＝撤销全部会话） |
| `heartbeat(accessToken)` | `POST /api/v1/auth/heartbeat` | `heartbeatMs` | 0 |
| `logout(accessToken)` | `POST /api/v1/auth/logout` | 3000ms | 0（失败静默） |
| `changePassword(accessToken, payload)` | `POST /api/v1/auth/password/change` | `loginMs` | 0 |
| `requestPasswordReset(email)` | `POST /api/v1/auth/password/reset/request` | `loginMs` | 0 |
| `listSessions(accessToken)` | `GET /api/v1/me/sessions` | `sessionMs` | 0 |
| `revokeSession(accessToken, id)` | `DELETE /api/v1/me/sessions/{id}` | `sessionMs` | 0 |

统一处理：
- 请求头：`Content-Type: application/json`、`Accept: application/json`、`User-Agent: Ecliptrix-Desktop/${clientVersion}`、`X-Client-Version: ${clientVersion}`、`X-Request-Id: <uuid>`。**不带** Cookie（桌面端用 Bearer）。
- 响应：`success === false` 时抛 `AccountError(code, status, message, details, requestId)`，其中 `requestId` 取自响应头 `X-Request-Id`，用于日志与用户报障（界面「错误编号」）。
- 非 JSON 响应 / 网络错误 → 抛 `AccountError('network_unreachable')`；`AbortError` 超时 → `AccountError('request_timeout')`。两者都被 `authPolicy` 归入 `heartbeat.status = 'network'`。
- 日志：只记 `{method, path, status, code, requestId, durationMs}`。**永不**记请求体（含口令）与响应体（含令牌）。

#### 2.4.5 `localAdmin.js`

```js
function verifyLocalAdmin({ username, password, localAdmin, state, now })
// → { ok: true } | { ok: false, code: 'local_admin_disabled'|'local_admin_locked'|'invalid_credentials',
//                     attemptsLeft?: number, lockedUntil?: number }

function recordFailure(state, now)  // 更新 state.failures 并返回新的锁定信息（纯函数，返回新 state）
function clearFailures(state)
```

- 禁用：`localAdmin.enabled !== true` → `local_admin_disabled`（该入口在界面上根本不出现；若被强行调用，返回此码）。
- 比较：`crypto.timingSafeEqual(sha256(a), sha256(b))`，先比 username 再比 password，两者都算一次「比较次数」，**不短路**（避免通过响应时间区分「用户名对/错」）。
- 失败计数：第 1–4 次失败返回 `attemptsLeft = 5 - n`；第 5 次起锁定 `60s`，此后每次再失败翻倍（60 → 120 → 240 → 480 → 900 上限）并持久化到 `userData/auth-attempts.json`（`{ schemaVersion:1, failures:number, lockedUntil:number }`）。
- 成功：清空计数并写一条 `auth.local_root.login` 到 `userData/logs/auth.log`。
- 破除：删除 `auth-attempts.json` 即解除锁定（文档写明）。这是本地破窗通道，防的是「共用电脑上的随手试」，不是「拿到磁盘的人」。

### 2.5 IPC 契约（10 个 invoke + 1 个事件）

全部通道由 `authBridge.js` 用 `ipcMain.handle` 注册（沿用 `windowControls.js` 的既有风格），参数一律**结构化校验**后再进控制器（非对象 / 超长字符串 / 非法字段 → 直接返回 `{ ok:false, code:'invalid_request' }`，不抛到渲染进程）。

| 通道 | 入参 | 出参（成功） | 出参（失败） |
|---|---|---|---|
| `auth:status` | — | `AuthStatus`（见 §4.1） | — |
| `auth:login` | `{ identifier:string, password:string, rememberDevice?:boolean }` | `AuthStatus`（`state:'authenticated'`） | `{ ok:false, code, message, details?, requestId? }` |
| `auth:login-local` | `{ username:string, password:string }` | `AuthStatus` | 同上（`code` ∈ `invalid_credentials`/`local_admin_locked`/`local_admin_disabled`，后者带 `attemptsLeft`/`lockedUntil`） |
| `auth:logout` | — | `AuthStatus`（`state:'unauthenticated'`） | 不会失败（远端失败也返回未登录） |
| `auth:register` | `{ email, password, username?, displayName?, inviteCode? }` | `AuthStatus` | `{ ok:false, code, details }`（`weak_password` 带 `details.reasons[]`） |
| `auth:change-password` | `{ currentPassword, newPassword, signOutOtherSessions?:boolean }` | `AuthStatus`（`mustChangePassword:false`） | 同上（`password_mismatch`） |
| `auth:reset-request` | `{ email }` | `{ ok:true }` | `{ ok:false, code }`（`rate_limited` 带 `retryAfterSeconds`） |
| `auth:list-sessions` | — | `{ ok:true, items: SessionInfo[], currentId: string }` | `{ ok:false, code }` |
| `auth:revoke-session` | `id:string` | `{ ok:true }` | `{ ok:false, code }` |
| `auth:open-external` | `url:string` | `{ ok:true }` | `{ ok:false, code:'url_not_allowed' }` |
| `auth:changed`（事件） | — | `AuthStatus`（`webContents.send`） | — |

`auth:open-external` 的白名单（与根项目 `src/lib/credentialLinks.ts` 的既有做法一致：只允许 https + 主机白名单）：主机必须等于 `ACCOUNT_SERVER_URL` 的主机，或属于 `id.ecliptrix.app` / `ecliptrix.app` / `www.ecliptrix.app`。用于「打开账号中心」「隐私政策」「服务条款」「下载最新版」。**绝不**接受 `file://` / `javascript:` / 任意 http。

**两条入参 / 出参语义（v2 补全，P1-2 / P1-5）**

1. **`rememberDevice`（默认 `true`）**：`true` → 会话落盘（`auth-session.json`），关窗后下次启动免登录；`false` → **不落盘**，令牌只留在主进程内存，`app.quit()` 即失效（「只在这台机器上用这一次」）。界面上的「☐ 记住这台设备」就是它。落盘条件只由它决定，**不要**再引入第二个开关。
2. **`auth:status` 的 cold 语义**：`controller.start()` 是异步的（读文件 → probe → heartbeat），而窗口在它之前就创建、渲染进程挂载即 `invoke('auth:status')`。因此 `status()` 必须**永远可答**：`start()` 落地前返回一个冻结常量 `BOOTING_STATUS = { state:'booting', source:null, reason:null, user:null, sessionId:null, expiresAt:null, lastVerifiedAt:null, graceUntil:null, mustChangePassword:false, appVersion, server:null, reachable:false, lockedUntil:null, attemptsLeft:null, securityWarning:null }`。`booting` **不由** `decideStartup()` 产生——它只发生在「进程已起、决策未完成」这个窗口期。渲染进程的骨架屏就是它。

`auth:changed` 的推送时机：`state`、`source`、`user.permissions`、`mustChangePassword`、`lockedUntil`、`server.maintenanceMessage` 任一变化时推一次；离线转在线、在线转离线也推。渲染进程**不轮询**。

### 2.6 启动时序（含离线宽限、时钟回拨、版本闸门、维护模式）

主进程侧：

```
app.whenReady()
 └─ main()
     ├─ initUserData()                       // 新增 localAdmin / auth 默认值（已存在不覆盖）
     ├─ logger
     ├─ loadUserEnv(envPath) → state.userEnv  // ★ 提前到 dev 早退之前；纯读取，无副作用
     ├─ authConfig = readAuthConfig({ config, env: { ...process.env, ...state.userEnv },
     │                                isDev, userDataPath, hostname })
     ├─ store = createSessionStore({ dir: userDataPath, safeStorage })
     ├─ client = createAccountClient({ baseUrl: config.serverUrl, clientVersion: app.getVersion() })
     ├─ controller = createAuthController({ config, store, client, localAdmin, logger })
     ├─ registerWindowControlIpc(logger)                   // 既有
     ├─ registerAuthIpc({ ipcMain, controller, logger })    // ★ 必须在 dev 早退之前
     ├─ controller.start()                                 // 不 await：异步 decideStartup + emit
     │
     ├─ if (isDev)  → createMainWindow(DEV_FRONTEND_URL) → return
     │      dev 下 authConfig.gateEnabled 默认 false（除非 ECLIPTRIX_AUTH_GATE=on），
     │      所以 status() 直接是 authenticated/gate-disabled；界面上仍有琥珀条。
     │
     ├─ backfillUserEnv → loadUserEnv（既有顺序，供子进程用；见下方说明）
     ├─ splash → resolvePorts → startResearchBrowserHost → startServices
     └─ createMainWindow(`http://127.0.0.1:${frontendPort}`)
```

> **关于 `loadUserEnv` 提前**：现有代码把它放在 dev 早退之后（`index.js:135-158`）。v2 要求 auth 在早退之前就绪，而 `readAuthConfig` 需要 env（`ECLIPTRIX_AUTH_GATE` / 可选覆盖），所以把它**前移**一次。`loadUserEnv` 是纯读取（`desktop/main/envCheck.js` 的手写解析，丢弃 `your_*` 占位值），前移不改变任何既有行为。
>
> `backfillUserEnv`（自愈占位凭证）**留在原位**：它写文件，不能让 dev 启动顺手改写 `.env`。因此打包路径会出现「读两次 `.env`」——早期快照给 auth 用，自愈后的快照给子进程用。这是刻意的小冗余，一次 `readFileSync` 换掉一个顺序依赖，值得。

> **顺序是硬要求（v2，P0-2）。** v1 把 auth 接线放在 `startServices()` 之后，而 `main()` 在 `isDev` 处就 `return` 了（`index.js:135-141`）。同时 `createMainWindow()` **无条件注入 preload**（`window.js:113-121`），dev 窗口因此有 `window.ecliptrixDesktop` 但**没有** `auth` 命名空间 → 渲染进程 fail-closed 会渲染阻断屏，`desktop/ npm run dev` 直接被自己的闸门锁死。既有代码在 `registerWindowControlIpc` 处已经写下了正确的注释（「register renderer-facing IPC BEFORE the `--dev` early-return」），auth 必须遵守同一条。
>
> 反过来说，渲染进程**不再**用「桥不存在」判断 dev——它只看主进程给的 `state`。桥缺失只剩两种真实来源：浏览器直开 `:3000`（无 Electron）、打包产物 preload 缺失（真故障）。

`controller.start()` 不阻塞窗口创建（否则服务端不可达时窗口 8 秒才出现，用户会以为程序没启动）。窗口先画出 **booting 占位屏**（与 SSR 完全一致的空中性屏），`auth:status` / `auth:changed` 推动渲染进程切换。

控制器内部：

```
start():
  { session, corrupt } = store.read()
  if (corrupt) log('auth.session.corrupt')
  serverMeta = await client.meta()          // 3s 超时；失败 → null
  hb = session ? await probeHeartbeat(session) : null
  decision = decideStartup({ session, now, config, heartbeat: hb })
  按 decision 落状态 → emit('auth:changed')
  if (state === 'authenticated') schedule()

probeHeartbeat(session):
  r = await client.heartbeat(session.accessToken)
    → 200                     : 读响应体 { ok, mustChangePassword, role, permissions, expiresAt }
                                mustChangePassword === true ? 'password-change-required' : 'ok'
    → 401 session_revoked     : 'revoked'        // details.reason 带 revoked_reason，记日志即可
    → 401 session_expired     : await withTokenLock(() => refresh()) 后重试一次 → 'ok' | 'expired'
    → 401 unauthorized        : 'revoked'        // 用户已被删除或状态非 active（guards 的兜底分支）
    → 403 account_suspended   : 'suspended'
    → 429 rate_limited        : 'network'        // ★ 绝不因限流登出：心跳预算是 60 次/小时/会话
    → 5xx / network_unreachable / request_timeout : 'network'
```

**v2 修正（P1-3）**：v1 让心跳去接 `403 password_change_required`、`423 account_locked`、`426 client_outdated`、`503 maintenance` —— 这四个**心跳都不会返回**：

- 心跳路由用 `requireSession(..., { allowPasswordChangeRequired: true })` 放行改密前状态，并把 `mustChangePassword` 放在**响应体**里（`webserver/src/app/api/v1/auth/heartbeat/route.ts`）。所以「管理员刚把你标记为必须改密」只能靠读 body 发现，不能靠状态码。
- `requireSession` 在会话被撤销 / 过期 / 账号停用 / 用户不存在时分别抛 `401 session_revoked` / `401 session_expired` / `403 account_suspended` / `401 unauthorized`；`account_locked`（423）是**登录期**的失败计数锁，与已建立的会话无关。
- `426 client_outdated` 按 §2.11 的边界只作用于 `login` / `register`（否则旧客户端连「登出」都拿不到许可）。
- 维护模式只拦 `login` / `register`，心跳不受影响（§4.3）；维护状态由 `meta.maintenanceMessage` 判定，且它来自 `client.meta()`，不是心跳。

新增的 `429 → 'network'` 是最容易写错的一条：若把限流当「会话失效」处理，用户会在正常使用中被踢回登录屏，而重登只会继续触发限流。

`withTokenLock(fn)`（**单飞**，本设计最容易写错的一处）：

```js
let tokenLock = null
function withTokenLock(fn) {
  if (tokenLock) return tokenLock          // 复用进行中的那一次
  tokenLock = fn().finally(() => { tokenLock = null })
  return tokenLock
}
```
所有会旋转令牌的操作（`refresh`）必须经过它。因为 **并发两次 refresh 会让服务端看见「已轮换的刷新令牌」→ 按重用检测撤销该用户全部会话 → 用户被全场踢下线**。心跳与到期续期定时器可能同时到点，这是真实会发生的并发，必须靠单飞挡住。

定时器：`schedule()` 用 `nextTimerDelay()` 算一个 `setTimeout`（不设多个定时器，避免互相竞争），触发时：`action === 'refresh'` → `withTokenLock(refresh)`；`action === 'heartbeat'` → 心跳。窗口 `focus` 且 `now - lastVerifiedAt > heartbeatIntervalMs` 时立即补一次心跳；`powerMonitor.on('resume')` 同此规则。

### 2.7 渲染进程状态机与会话门

```ts
type AuthState = 'booting' | 'unauthenticated' | 'authenticated' | 'blocked'
type AuthSource = 'server' | 'offline-cache' | 'local-root' | 'gate-disabled'
type AuthReason =
  | 'no-session' | 'session-expired' | 'session-revoked' | 'account-suspended'
  | 'account-locked' | 'password-change-required' | 'grace-expired' | 'clock-rollback'
  | 'network' | 'client-outdated' | 'maintenance' | 'bridge-unavailable'
  | 'server-not-configured' | 'gate-disabled'
```

`SessionProvider` 的职责：
1. 挂载时 `const bridge = getAuthBridge()`。
   - `bridge !== null` → `bridge.status()` 拿主进程状态，`bridge.onChanged(setStatus)` 订阅（卸载时取消）。**dev 与打包产物走同一条路径**：闸门开关由主进程的 `gateEnabled` 决定，渲染进程不猜。
   - `bridge === null`（只有两种真实来源：浏览器直开 `:3000`、打包产物 preload 缺失）：
     - 若 `typeof window !== 'undefined' && !window.ecliptrixDesktop` 且 `process.env.NODE_ENV !== 'production'` → `authenticated / gate-disabled` + 顶部琥珀条「开发模式：身份闸门未启用（浏览器直开）」。这是**浏览器调试路径**的放行。
     - 否则（打包产物里 preload 丢了）→ `blocked / bridge-unavailable`（**绝不**静默放行；放行等于闸门不存在）。
   > v1 的判据是「dev 没有 preload」，**事实错误**（P0-2）：`createMainWindow()` 无条件注入 preload，dev 窗口是有桥的。照 v1 实现会让 `desktop/ npm run dev` 走进 `bridge-unavailable` 阻断屏。
2. `bridge.status()` → `setStatus`；`bridge.onChanged(setStatus)`，卸载时取消订阅。
3. `login/loginLocal/register/changePassword/...` 全部包一层 `pending` 标志，防重复提交；成功后由 `auth:changed` 推动，不在本地乐观改状态（唯一真相在主进程）。
4. 暴露 `useSession()`：`{ status, pending, login, loginLocal, register, logout, changePassword, requestPasswordReset, listSessions, revokeSession, openExternal }`。
5. 文案用的 `?reason=` 从 `window.location.search` 读取（仅影响提示条文案，**不**决定状态），因此不需要 `/login` 路由（见 §3.2 的删除说明）。

`SessionGate`（`src/components/auth/SessionGate.tsx`）的渲染表：

| `status.state` | 渲染 |
|---|---|
| `booting` | 中性占位：只有已存在的 `AppTitleBar` 拖拽条 + 居中 12px 的骨架（SSR 与首帧一致，避免 hydration 不一致） |
| `unauthenticated` | `<LoginScreen reason={status.reason} />` |
| `blocked` | `<AuthBlocker reason={status.reason} server={status.server} />`（维护 / 版本过低 / 桥缺失 / 服务端未配置） |
| `authenticated` | `children`；若 `mustChangePassword` 为真，额外强制渲染 `<ChangePasswordDialog open />`（不可关闭，仅可退出登录） |

**窗口可拖动性（frameless 的硬要求）**：`window.js` 用的是 `frame: false`。登录屏必须保留顶部 **40px** 的拖拽区（`-webkit-app-region: drag`），否则用户既不能移动也不能最大化窗口，只能去任务栏右键——这是「顶级体验」的直接否决项。`AppTitleBar` 已在，`SessionGate` 在 `booting`/`unauthenticated`/`blocked` 三态下**渲染一个精简版标题栏**（Logo + 版本号 + 最小化/最大化/关闭），不渲染设置齿轮与任务栏。

> **为什么是 40px 而不是 v1 写的 36px（P2-2）**：既有 `AppTitleBar` 是 `h-10`（= 40px，`src/components/shell/AppTitleBar.tsx`，拖拽区就是它）。登录屏若自造 36px，登录成功那一刻标题栏会**跳 4 个像素**——这类「差一点点」正是「顶级体验」的反面。
>
> **三条实现陷阱（都是当前代码的真实行为，照抄会踩）**：
> 1. `AppTitleBar` 的命令区带 `WebkitAppRegion: 'no-drag'`，可点的元素（账号胶囊、按钮）**必须在 no-drag 区域内**，否则拖拽区会吞掉点击。
> 2. `AppTitleBar` 首帧 `if (!mounted) return null` —— 它本身不渲染，**不要**依赖它做布局占位；骨架屏自己占位。
> 3. 标题栏的动作集群由 `hasAppActions = !!onSettingsClick` 决定是否出现。精简标题栏不能靠传 `onSettingsClick` 来「凑出」右侧按钮，否则会连带渲染设置齿轮——精简版应当是独立组件 `AuthTitleBar`（§3.2），只在登录成功后交回 `AppTitleBar`。

### 2.8 登录界面设计（Supabase 风格，逐区块）

版式（≥1024px 两栏；1024px 以下单栏，右侧插画收起）：

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◆ Ecliptrix            v1.0.1                    ─   □   ✕         │ ← 拖拽条 40px
├───────────────────────────────┬──────────────────────────────────────┤
│                               │                                      │
│   登录                         │      · 一盏柔光（brand radial）        │
│   使用 Ecliptrix 账号继续        │                                      │
│                               │      头像墙 / 抽象渐变（纯 CSS）        │
│   ┌─────────────────────────┐ │                                      │
│   │ 邮箱或用户名              │ │      「一个账号，贯穿桌面与网页」        │
│   └─────────────────────────┘ │      · 统一身份与权限                  │
│   ┌─────────────────────────┐ │      · 设备会话可随时撤销              │
│   │ 口令              👁    │ │      · 断网 7 天内可离线继续           │
│   └─────────────────────────┘ │                                      │
│   ☐ 记住这台设备   忘记口令？   │                                      │
│   ┌─────────────────────────┐ │                                      │
│   │        登  录            │ │                                      │
│   └─────────────────────────┘ │                                      │
│   ──── 或 ────                │                                      │
│   还没有账号？创建账号 →        │                                      │
│                               │                                      │
│   ┌─────────────────────────┐ │  ← 低调的破窗入口（分隔线下方）        │
│   │  使用本地管理员登录       │ │                                      │
│   └─────────────────────────┘ │                                      │
└───────────────────────────────┴──────────────────────────────────────┘
```

设计要求（可被评审逐条打勾）：

- **色彩**：沿用根项目 Tailwind token（`bg-background` / `text-foreground` / `border-border` / `ring-ring`），只允许一处品牌强调色（与 `webserver/` 认证页同一个 `--accent` 语义），登录按钮就是它。左侧表单区背景是 `bg-background`，右侧是 `bg-gradient-to-br from-background via-background to-accent/10`。
- **排版**：`text-[28px]/[34px]` 的标题（字重 600、字距 `-0.02em`），正文 `text-sm`，辅助文字 `text-xs text-muted-foreground`。表单宽度固定 `max-w-[380px]`，与输入框同宽；按钮与输入框同宽、高 `44px`。
- **形态**：输入框 `rounded-lg`（8px）、`border`（1px）、聚焦时 `ring-2 ring-accent/40`，不用粗描边；按钮同圆角；卡片本身**不加阴影边框**（Supabase 的观感来自留白与微渐变，不来自卡片）。
- **动效**：状态切换 120–160ms `ease-out`（`opacity` + `translateY(4px)`）；错误出现时只用不位移的 `opacity` 淡入（避免表单跳动）；`prefers-reduced-motion: reduce` 时全部时长归零。
- **输入**：`autoComplete="username"` / `"current-password"`、`inputMode` 按是否含 `@` 给出提示、`autoFocus` 在第一个字段、`Enter` 提交、`Esc` 清空错误、口令框右侧眼睛按钮（`aria-pressed`）、CapsLock 提示（`onKeyUp` 看 `getModifierState('CapsLock')`）。
- **错误呈现**：字段级错误贴在该字段下方；整体错误（`invalid_credentials` / `rate_limited` / `account_locked`）在按钮上方的一条 `role="alert"` 里，带图标与可选倒计时（`account_locked` 用 `details.retryAfterSeconds`，`rate_limited` 用 `Retry-After`），倒计时期间按钮禁用并显示剩余秒数。底部小字给出「错误编号 X-Request-Id」，便于报障。
- **可访问性**：全部输入有 `<label>`；焦点顺序 = 视觉顺序；错误容器 `aria-live="polite"`；对比度 ≥ 4.5:1；破窗入口的按钮 `aria-describedby` 指向它的说明文字。
- **状态**：提交中按钮显示 spinner 且整体 `pointer-events-none`（防双击产生两次登录 → 两条会话）。
- **注册视图**：同一容器内切换（不跳转），字段 = 邮箱 + 用户名（可选）+ 显示名（可选）+ 口令 + 确认口令 + 邀请码（仅 `meta.inviteRequired` 时出现）。口令强度条复用与 `webserver/src/components/auth/password-strength.tsx` 相同的四档语义（弱/中/强/极强），阈值与 `lib/validators.ts` 对齐（minLength 10）。
- **注册关闭时**（`meta.registrationEnabled === false`）：隐藏「创建账号」，改为「联系管理员开通（supportEmail 邮件链接）」。
- **忘记口令**：`meta.smtpEnabled === true` → 内联「重置口令」面板（输入邮箱 → `POST reset-request` → 一律提示「若该邮箱存在，重置链接已发出」，不复述账号是否存在）；`smtpEnabled === false` → 提示「请联系管理员签发一次性口令」。
- **维护模式**：`meta.maintenanceMessage` 非空 → 登录表单整体替换为维护公告（含公告正文与「重试」按钮），但**保留**破窗入口。
- **版本过低**：`compareVersions(appVersion, meta.minClientVersion) < 0` → 覆盖为更新提示（当前版本 / 最低版本 / 「打开下载页」）。
- **离线角标**：`source === 'offline-cache'` 时，进入后标题栏右侧常驻一枚琥珀色角标「离线模式 · 剩余 N 天」，并在账号菜单里显示「上次验证于 …」。N 由 `graceUntil - now` 算出，每天递减。
- **破窗入口**：默认以 `text-xs text-muted-foreground` 的文本按钮呈现，点击后展开一个内嵌表单（不是弹窗——弹窗会遮住错误信息），上方一行琥珀色提示：「本地管理员仅用于设备救援，不联网、不加载他人数据」。登录成功后标题栏常驻红色徽标「本地管理员」，账号菜单第一项显示「本次会话不受服务端管辖」。

### 2.9 破窗账号（`localAdmin`）的不变式

1. **位置**：`%APPDATA%\Ecliptrix\desktop-config.json` 的 `localAdmin` 键。`initUserData()` 在缺省时写入 `{ username:'admin', password:'adminjr', enabled:true }`；已存在则**不覆盖**（用户改过口令后升级不会被重置回默认值）。
2. **不联网**：形态 B 不调用 `/auth/*` 任何端点，不产生服务端会话，不写 `auth-session.json`（只在主进程内存里置 `localRoot = { verifiedAt }`）。
3. **不降级已有会话**：主进程内存里可以同时存在「磁盘上的服务器会话」与「本次运行的 local-root」。`auth:status` 优先返回**本次运行为 local-root**（用户刚选的就是它）；下次启动时恢复为「按磁盘会话判定」。`auth:logout` 在 local-root 下只清内存标志，**不删除**磁盘会话。
4. **不可被服务端吊销**：这条是特性不是缺陷——服务器永远不知道这台机器开了破窗会话。
5. **渲染进程永远看不到它**：没有 `auth:local-config` 通道；配置对象不出主进程。
6. **口令强度自检**：若 `localAdmin.password` 长度 < 10 或仍等于默认值 `adminjr`，登录界面在破窗入口展开时显示一行红字「当前使用的是默认/弱口令，请修改 `desktop-config.json` 中的 `localAdmin.password`」，并在每次破窗登录后写一条本地告警日志。**不阻断**（阻断会把救援通道堵死）。
7. **Windows ACL**：`desktop-config.json` 继承 `%APPDATA%` 的默认权限（只有当前用户与 Administrators 可读）。文档要求部署到多用户机器时确认这一点；代码不做 ACL 修改（会引入平台分支与失败面）。

### 2.10 与业务数据的关系（零迁移）

- 本地 FastAPI 后端的业务表 `user_id` **继续**恒为 `LOCAL_OWNER_ID`（`app/constants.py`）。身份闸门只在「谁能看到窗口」这一层生效。
- 因此：换账号登录**不会**看到另一个人的项目（本地没有别人的项目）；`projects/`、`storage/`、`data/ecliptrix.db` 的位置与内容完全不变。
- 反过来说：**不要**把服务端 `user.id` 写进任何本地业务行。这一条要写进 `CLAUDE.md` 的新章节（§3.5）。

### 2.11 服务端配套改造（本轮必须一起做，否则闸门是残废的）

| # | 改造 | 为什么必须 |
|---|---|---|
| 1 | `sessions.device_key` + `sessionsRepo.revokeActiveByDevice()` + **新增同步服务函数** `sessionService.replaceDeviceSession()`：在同一 `db.transaction()` 内先撤销 `(user_id, device_key)` 的活跃会话（reason `same_device_relogin`）再建新会话。**事务必须在同步函数里**（见下方说明） | 否则 10 个会话上限会被同一台机器的重复登录吃光（§1.2 理由 3） |
| 2 | `settingsService` 新增 `client.minVersion` / `app.maintenanceMessage` / `security.maxActiveSessions`，`publicMeta()` 透出 | 版本闸门与维护公告必须能在不发版的情况下开关（这正是「外部管理后台」的价值） |
| 3 | `POST /auth/login`、`POST /auth/register` 增加 `clientVersion` 入参 + 426 `client_outdated`；**执行顺序：限流 → 维护 → 版本闸门 → 口令校验** | 客户端强更的唯一服务端抓手；顺序错了，426 会变成免限流的探测面，或被计入失败次数而误锁账号 |
| 4 | `GET /me/sessions` **仅补 `deviceKey`**（`current` 已交付：`me/sessions/route.ts` 已经调用 `toSessionDto(row, auth.session.id)`，`SessionDto.current` 早就存在） | 账号菜单里「这是我的当前设备」必须能显示，否则撤销按钮会误伤自己 |
| 5 | `MAX_ACTIVE_SESSIONS_PER_USER` 常量 → 设置项 `security.maxActiveSessions`（1..50，默认 10） | 运维按实际设备数调整，不必改代码重启 |
| 6 | 文档与冒烟同步（`docs/api.md`、`README.md`、`deployment-checklist.md` 的 46→62、`smoke.mjs` 52→62） | R1 留下的陈旧数字（checklist 写 46，实际 52）必须在此轮清零 |

**为什么顶号不能写在 `authService.login()` 里（P0-4，v2 修正）**

`better-sqlite3` 的 `db.transaction(fn)` 要求 `fn` **完全同步**：它在 `fn` 返回后立即 `COMMIT`，`fn` 里出现 `await` 会让事务在异步间隙提前结束（甚至在 `COMMIT` 之后再落到已关闭的事务上抛错）。而 `authService.login()` 是 `async`（口令校验 `verifyCredentials` 是异步 scrypt），`createSession()` 却是同步的（`getDb()` + `repo.*`）—— 这个「异步校验 + 同步落库」的分层本来就是为了让事务留在同步区。

因此本轮**新增**一个同步服务函数，而不是在 `login()` 里就地开事务：

```ts
// webserver/src/server/services/sessionService.ts —— 必须同步，函数体内禁止 await
export function replaceDeviceSession(
  options: CreateSessionOptions & { deviceKey: string },
): IssuedTokens & { replacedCount: number }
```

它的实现就是 `db.transaction((input) => { const replacedCount = repo.revokeActiveByDevice(...); return { ...repo.create(...), replacedCount } })(options)`。调用方 `authService.login()` 在 `await verifyCredentials()` **成功之后**调用它，再按返回值写 `auth.session_relogin` 审计。`deviceKey === ''`（网页端）时直接退化为原来的 `createSession()`，行为与今天完全一致。

> 验收方式：P0 阶段必须有一条集成测试断言「顶号后旧会话 `revoked_reason='same_device_relogin'` 且新会话存在」，以及在假服务器计数下断言「并发两次同设备登录不会留下两条活跃会话」。

**版本闸门的适用边界（重要）**：426 只对 `login` / `register` 生效。`heartbeat` / `refresh` / `logout` **永不**返回 426——否则旧版客户端会拿不到「我要登出」的许可，用户被迫强杀进程。

### 2.12 退出与关窗时序

- 用户点「退出登录」→ `auth:logout` → 主进程：`source === 'local-root'` ? 清内存 : `await client.logout(accessToken)`（3s，失败静默）→ `store.clear()` → 状态 `unauthenticated` → 渲染进程切回登录屏。**清理必须发生在远端撤销之后**，反过来会让 90 天的刷新令牌变成一个孤儿（无法再撤销）。
- 直接关窗（`app:before-close` 握手）**不**退出登录，会话保留到下次启动。
- 退出登录时若存在未保存的项目改动：复用既有 `useDesktopCloseGuard` 的 flush 机制吗？不。退出登录**不**等同于关窗，它会卸载整个业务树。因此 `AccountMenu` 的退出项必须二次确认（`ConfirmDialog` 文案：「退出登录会关闭当前工作台，未保存的改动可能丢失。请先确认已自动保存。」），并在确认前主动 `await` 一次自动保存（调用既有 `autosaveRegistry` 的 flush 入口，若存在；否则只做确认）。

### 2.13 开发模式与降级

| 场景 | 检测 | 行为 |
|---|---|---|
| `desktop/ npm run dev`（`--dev`） | `process.argv.includes('--dev')`；窗口加载 `http://localhost:3000`，**有** preload（`createMainWindow` 无条件注入）；auth IPC 与控制器在 dev 早退**之前**已注册 | `gateEnabled` 默认 `false`（`resolveGate`）→ 主进程状态 `authenticated / gate-disabled`，界面顶部琥珀条「开发模式：身份闸门未启用」。想验证闸门本身：`ECLIPTRIX_AUTH_GATE=on desktop/ npm run dev` |
| 浏览器直开 `localhost:3000` | `window.ecliptrixDesktop === undefined` | 非生产构建：`authenticated / gate-disabled` + 琥珀条「浏览器直开：闸门未启用」。生产构建：`blocked / bridge-unavailable`（调试路径不是产品形态，但也不能静默放行） |
| 打包产物但 preload 缺失 | `window.ecliptrixDesktop` 存在但**没有** `.auth`，或 `ecliptrixDesktop` 不存在且 `NODE_ENV === 'production'` | `blocked / bridge-unavailable`（fail-closed），阻断屏给「查看日志目录」「重试」 |
| `ECLIPTRIX_AUTH_GATE=off` | 主进程 `resolveGate`（继承的 `process.env`） | 闸门关闭，`gate-disabled`，界面常驻红条「身份闸门已关闭」；主进程每次启动 `logger.warn` 一条 |
| 未配置账号服务器 | `readAuthConfig` → `serverUrl === ''`（`auth.accountServerUrl` 与 env 都为空） | `blocked / server-not-configured`（判定表 #2），只保留破窗入口 |
| 维护模式 | `client.meta()` 的 `maintenanceMessage !== ''`（**不**靠心跳，心跳不受维护影响） | `blocked / maintenance`，保留破窗入口与「重试」 |
| 服务端不可达且宽限未过 | `decideStartup` #11 | `authenticated / offline-cache`，标题栏离线角标 |
| 服务端不可达且宽限已过 | `decideStartup` #12 | `unauthenticated / grace-expired`，登录屏顶部显示「已超过 N 天未联网验证，请重新登录」 |
| 心跳被限流（429） | `probeHeartbeat` 的 `429 → 'network'` | 当作网络问题走宽限判定，**绝不**因限流登出 |

---

## 3. File / Module Change Plan（文件与模块改动计划）

> 约定：**新增** = 只创建；**修改** = 精确的改动点写在「意图」里；任何未列出的文件都不应被改动。

### 3.1 主进程（`desktop/main/`）

| 文件 | 动作 | 意图 |
|---|---|---|
| `desktop/main/config.js` | 修改 | `defaultConfig()` 增加两块：`localAdmin: { username:'admin', password:'adminjr', enabled:true }`（**排在 `schemaVersion` 之后**，便于人工编辑时第一眼看到）与 `auth: { accountServerUrl:'', offlineGraceDays:7 }`；导出常量 `CONFIG_FILE_NAME`、`AUTH_SESSION_FILE_NAME='auth-session.json'`、`AUTH_ATTEMPTS_FILE_NAME='auth-attempts.json'`；`initUserData()` 的返回值追加 `sessionPath`、`attemptsPath`（现有返回值是 `{config, envPath, configPath}`）。**注意合并是浅合并**（`{...defaults, ...parsed}`，`config.js:43`）：整键缺失时默认值会补上，半截嵌套对象**不会**逐字段补齐——逐字段兜底由 `authConfig.js` 负责（P2-5） |
| `desktop/main/authConfig.js` | 新增 | `readAuthConfig({config, env, isDev, userDataPath, hostname})` + `deriveDeviceKey()` + `resolveGate()`（§2.4.1）；`serverUrl` 读 `config.auth.accountServerUrl`（**不是** env，见 P0-1），env 只作可选覆盖；导出 `DEFAULT_GRACE_DAYS` / `DEFAULT_SERVER_URL` 等常量供测试引用 |
| `desktop/main/authErrors.js` | 新增 | `ERROR_CODE` 枚举（服务端 20 个 + 主进程合成 7 个：`network_unreachable`/`request_timeout`/`grace_expired`/`bridge_unavailable`/`server_not_configured`/`gate_disabled`/`session_corrupt`）、`toUiReason(code)`、`isRetryable(code)`、`AccountError` 类 |
| `desktop/main/authPolicy.js` | 新增 | `decideStartup` / `graceDeadline` / `detectClockRollback` / `nextTimerDelay` / `compareVersions`（全部纯函数，§2.4.2） |
| `desktop/main/authSessionStore.js` | 新增 | `createSessionStore(deps)`（§2.4.3）：safeStorage 信封、原子写、`schemaVersion` 迁移、损坏容错 |
| `desktop/main/authHttp.js` | 新增 | `createAccountClient(deps)`（§2.4.4）：11 个方法、信封解包、超时、`AccountError`、日志脱敏 |
| `desktop/main/localAdmin.js` | 新增 | `verifyLocalAdmin` / `recordFailure` / `clearFailures`（§2.4.5）+ `readAttempts`/`writeAttempts`（`auth-attempts.json`，原子写） |
| `desktop/main/authController.js` | 新增 | `createAuthController(deps)` → `{ start, status, login, loginLocal, logout, register, changePassword, requestPasswordReset, listSessions, revokeSession, on, emit, dispose, markServicesRestarted }`；单飞 `withTokenLock`；`setTimeout` 调度器；`auth:changed` 事件源 |
| `desktop/main/authBridge.js` | 新增 | `registerAuthIpc({ ipcMain, controller, logger })`：10 个 `ipcMain.handle`、结构化入参校验、错误归一化、`openExternal` 白名单；返回 `dispose()` 用于注销 |
| `desktop/main/index.js` | 修改 | **必须在 `isDev` 早退之前**（`index.js:133-141` 的既有顺序）完成：`readAuthConfig(...)` → `createSessionStore` → `createAccountClient` → `createAuthController` → `registerAuthIpc(...)` → `controller.start()`（不 await）；`state.authController` 挂到既有 state 对象上；`startServices()` 失败重启分支加 `state.authController.markServicesRestarted()`（通知渲染进程「本地服务已重启，可重试」）；dispose 挂进既有 **`app.on('before-quit')`** 分支（本项目**没有** `will-quit` 处理器，P2-6）。dev 分支只做 `createMainWindow(DEV_FRONTEND_URL)` 后 `return`，auth 已在它之前就绪（P0-2） |
| `desktop/preload/preload.js` | 修改 | 在 `contextBridge.exposeInMainWorld` 的对象里追加 `auth: {...}`（§4.1 的 10 个方法 + `onChanged`）。文件顶部注释里那句「The credential-bootstrap channel … is gone」需要改写为「本地管理员凭据只在主进程比对，渲染进程没有任何读取通道」 |

### 3.2 渲染进程（`src/`）

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/lib/api/authBridge.ts` | 新增 | `getAuthBridge(): AuthBridge \| null`；`AuthBridge` / `AuthStatus` / `AuthState` / `AuthReason` / `SessionUser` / `ServerMeta` / `SessionInfo` 类型；`bridgeLogin` 等薄封装不得吞异常 |
| `src/contexts/SessionContext.tsx` | 新增 | `SessionProvider` / `useSession()`（§2.7）；启动即 `status()` + `onChanged`；`pending` 防重入；dev 降级与 fail-closed 判定 |
| `src/components/auth/SessionGate.tsx` | 新增 | 四态渲染 + 精简标题栏 + `ChangePasswordDialog` 强制挂载 |
| `src/components/auth/AuthTitleBar.tsx` | 新增 | 登录/占位/阻断三态共用的极简标题栏（拖拽区 + Logo + 版本 + 窗口三键，复用 `windowControls` 通道） |
| `src/components/auth/LoginScreen.tsx` | 新增 | 全窗口版式骨架（§2.8）：左表单区 + 右品牌区 + 状态路由（登录/注册/重置/维护/版本过低） |
| `src/components/auth/ServerLoginForm.tsx` | 新增 | 形态 A 表单（标识符/口令/记住设备/忘记口令/锁定倒计时/错误编号） |
| `src/components/auth/RegisterForm.tsx` | 新增 | 注册表单（邀请码按 `meta.inviteRequired`、强度条、条款勾选） |
| `src/components/auth/ResetPasswordForm.tsx` | 新增 | 自助找回（仅 `smtpEnabled`）；否则展示管理员联系方式 |
| `src/components/auth/LocalAdminForm.tsx` | 新增 | 形态 B 表单（危险区样式、`attemptsLeft`/`lockedUntil` 提示、默认口令告警） |
| `src/components/auth/ChangePasswordDialog.tsx` | 新增 | `mustChangePassword` 强制改密（不可关闭，仅「退出登录」）；成功后可勾选「同时注销其他设备」 |
| `src/components/auth/AuthBlocker.tsx` | 新增 | 维护 / 版本过低 / 桥缺失 / 未配置服务器 四类阻断屏（含「重试」「打开下载页」「查看日志」） |
| `src/components/auth/AccountMenu.tsx` | 新增 | 标题栏用户胶囊 + 下拉：身份来源徽标、我的设备（列表/撤销/当前设备标记）、修改口令、打开账号中心（`auth:open-external` → `{ACCOUNT_SERVER_URL}/account`）、退出登录（二次确认） |
| `src/components/shell/AppTitleBar.tsx` | 修改 | 追加可选 prop `sessionSlot?: React.ReactNode`，渲染在命令区**内部且位于 `WebkitAppRegion:'no-drag'` 的容器里**（否则拖拽区吞点击），并排在设置齿轮**之前**；默认 `undefined` 时行为零变化。注意它有 `if (!mounted) return null`，`sessionSlot` 首帧不渲染属于既有行为（P2-2） |
| `src/app/layout.tsx` | 修改 | `<LocaleProvider><NotificationProvider><SessionProvider><SessionGate>{children}</SessionGate></SessionProvider></NotificationProvider></LocaleProvider>`（唯一改动，四层嵌套；`layout.tsx` 是 Server Component，四个 Provider 各自 `'use client'`，不要给 layout 加 `'use client'`） |
| ~~`src/app/login/page.tsx`~~ | **不新增（v2 删除）** | v1 打算加一条 `/login` 深链。它有害且无用：`SessionGate` 包住 `layout` 的**所有** children，所以 `/login` 也会被包住——已登录时访问它会再显示一张登录屏（可再登一次 → 第二条会话）；`export const dynamic` 对 client component 也无效。`?reason=` 改由 `SessionProvider` 读 `window.location.search`（仅影响文案，§2.7 第 5 条）。多一条路由就多一条绕过面，而需求里没有它（P1-13） |
| `src/lib/i18n.ts` | 修改 | `Translations` 接口新增 **`auth` 段（65 个键，§8.2）**，并在 `translations.en` 与 `translations['zh-CN']` 两处同批补齐。**结构是嵌套对象**（`auth: { title: '…', error: { … } }`），不是扁平点号键——`§8.2` 的点号写法只是清单记法（P2-1） |
| `src/app/page.tsx` | 修改 | **只需要**在 `AppTitleBar` 上透传 `sessionSlot={<AccountMenu/>}`（3 行）；闸门逻辑不在这里 |

### 3.3 服务端（`webserver/`）

| 文件 | 动作 | 意图 |
|---|---|---|
| `src/server/db/migrations/0004_device_identity.sql` | 新增 | `ALTER TABLE sessions ADD COLUMN device_key TEXT NOT NULL DEFAULT ''` + 部分索引（DDL 见 §5.4） |
| `src/server/db/types.ts` | 修改 | `SessionRow` 增加 `device_key: string`；**`SessionDto` 增加 `deviceKey: string`** 并让 `toSessionDto` 把它带出去（`current` / `client` / `userAgent` / `expiresAt` 都已存在，不要再造一遍——P1-8） |
| `src/server/db/repositories/sessionsRepo.ts` | 修改 | `create()` 的 INSERT 增加 `device_key`；新增 `revokeActiveByDevice(db, userId, deviceKey, now, reason): number`（`UPDATE … WHERE user_id=? AND device_key=? AND device_key<>'' AND revoked_at IS NULL`）；`CreateSessionInput` 增加 `deviceKey: string` |
| `src/server/services/sessionService.ts` | 修改 | ① `createSession({...deviceKey})` 透传；② **新增同步函数 `replaceDeviceSession()`**（§2.11 说明，内部 `db.transaction(...)`，禁止 `await`）；③ `maxActiveSessions` 由 **`settingsService.getNumber('security.maxActiveSessions')`** 读取（`getInt` 不存在；常量保留为默认值），生效点是既有的 `oldestActiveIds(... - 1)` LRU 段（P1-9） |
| `src/server/services/authService.ts` | 修改 | `login()`：① **顺序固定为 限流（route 层）→ 维护 → 版本闸门 → 口令校验**，版本闸门只对 `client === 'desktop'` 且 `clientVersion` 非空时生效，且**不写 `login_attempts`、不计锁**（否则一次配置失误会锁死账号，P1-10）；② 口令校验**成功之后**调用 `sessionService.replaceDeviceSession()`（不要在这里开事务，`login()` 是 async，P0-4）；③ 审计 `auth.session_relogin`（metadata `{deviceKey, replacedCount}`）；`register()` 同样接受 `clientVersion` |
| `src/server/validation/schemas.ts` | 修改 | `deviceSchema` 增加 `deviceKey: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/).default('')`；`loginSchema`/`registerSchema` 增加 `clientVersion: z.string().trim().max(40).default('')` |
| `src/server/auth/constants.ts` | 修改 | `ERROR_CODE` 增加 `clientOutdated: 'client_outdated'`；新增 `DEFAULT_MAX_ACTIVE_SESSIONS = 10`；`REVOKE_REASON` 增加 `sameDeviceRelogin: 'same_device_relogin'` |
| `src/server/services/settingsService.ts` | 修改 | `SettingKey` 增加 3 个键 + `SPECS` 条目（§5.5）；`publicMeta()` 返回 `minClientVersion` / `maintenanceMessage` / `maxActiveSessions` |
| `src/server/http/errors.ts` | 修改 | 新增 `errors.clientOutdated(minVersion)` 助手（426 + `details:{minVersion}`）。**形态必须与既有助手一致**（该文件是 `errors.xxx(...)` 集合 + 一张 `error_code → HTTP` 映射表，`account_locked→423`、`password_change_required→403` 都在表里），不要直接 `new AppError` 绕过映射表（P2-8） |
| `src/app/api/v1/me/sessions/route.ts` | 修改 | 只补 `deviceKey`（`toSessionDto` 已由 `auth.session.id` 标注 `current`，**该项不需要改**——P1-8） |
| `src/app/(console)/admin/settings/page.tsx` 与 `src/components/console/settings-form.tsx` | 修改 | 新增三个字段：最低客户端版本（`x.y.z` 输入 + 校验）、维护公告（多行，200 字）、最大并发会话数（1–50 数字） |
| `src/components/console/user-sessions-panel.tsx` | 修改 | 表格增加「平台」「客户端版本」「设备键（前 8 位）」三列；当前会话行加 `badge` |
| `src/lib/i18n.ts`（webserver） | 修改 | 新增上述三个设置项与 `client_outdated` 的文案（zh-CN / en-US 同批） |
| `docs/api.md` | 修改 | `/meta` 新增字段、`/auth/login` 的 `clientVersion`/`device.deviceKey`、`client_outdated` 错误码、`/me/sessions` 的 `current` |
| `README.md` | 修改 | 「桌面端接入」段补「设备顶号 / 版本闸门 / 会话上限」三条；验收自检的断言数改为 62 |
| `docs/deployment-checklist.md` | 修改 | 修正陈旧的「46 checks」→「62 checks」；新增一条「破了默认口令没有」 |
| `docs/desktop-integration.md` | 修改 | 升 v2：按 §8.1 修正 8 处，补 §2.3 的 refresh 语义（body 令牌即桌面模式） |
| `scripts/smoke.mjs` | 修改 | 52 → 62 条断言（§6.3） |
| `tests/integration/desktop-login.test.ts` | 新增 | 顶号、版本闸门、`current` 标记、会话上限可配、三新设置项（§6.3） |
| `tests/unit/settings.test.ts` | 修改（若不存在则新增） | 三新键的类型/范围/默认值断言 |

### 3.4 测试、脚本与文档（根项目侧）

| 文件 | 动作 | 意图 |
|---|---|---|
| `desktop/main/authConfig.test.js` | 新增 | 默认值、非法 URL、范围夹取、`gateEnabled` |
| `desktop/main/authPolicy.test.js` | 新增 | §2.4.2 判定表 11 条逐条断言 + 宽限/回拨/`compareVersions` |
| `desktop/main/authSessionStore.test.js` | 新增 | 原子写、加密/明文两条路径、损坏文件、v0→v1 迁移 |
| `desktop/main/authHttp.test.js` | 新增 | 起一个 `http.createServer` 假账号服务器：信封解包、错误码映射、超时、`requestId` 透传、**不重试** |
| `desktop/main/localAdmin.test.js` | 新增 | 常量时间比对（用 `crypto` 桩记录调用次数，证明不短路）、5 次锁定、指数退避、`enabled:false` |
| `desktop/main/authBridge.test.js` | 新增 | 10 个通道注册齐全、入参校验、`openExternal` 白名单、错误归一化、日志不含口令 |
| `desktop/scripts/test-auth.js` | 新增 | 测试运行器：`require` 上述 6 个测试文件并汇总，任一失败即 `process.exit(1)`（跨平台，不依赖 `&&` 链） |
| `desktop/scripts/env.template.desktop` | 修改 | **不再**把 `ACCOUNT_SERVER_URL` 当作权威配置写进模板（P0-1：那是后端 env 模板，主进程只在被打包版 `index.js` 显式注入时才看得到，且写死 URL 会盖掉配置文件）。改为：① 追加一段中文注释指向 `%APPDATA%\Ecliptrix\desktop-config.json` 的 `auth.accountServerUrl`；② 追加 `ECLIPTRIX_AUTH_GATE=on`（注释说明 `off` 是紧急阀，改完需重启）；③ 追加 `ACCOUNT_OFFLINE_GRACE_DAYS=7`（作为 config 的可选覆盖）。**不要**把 `localAdmin` 口令写进 env，它在 `desktop-config.json`。该模板会被 `prepare-env.js` 生成到 `build/env.template.desktop`，再由 electron-builder 投放到 asar 的 `scripts/`，所以改模板后要同步 `desktop/scripts/preflight.js` 的必需键校验（P2-9） |
| `desktop/package.json` | 修改 | `scripts` 增加 `"test:auth": "node scripts/test-auth.js"` |
| `src/contexts/__tests__/SessionContext.test.tsx` | 新增 | 状态转移：`booting→authenticated`、`revoked→unauthenticated`、离线宽限、`mustChangePassword`、桥缺失 fail-closed |
| `src/components/auth/__tests__/LoginScreen.test.tsx` | 新增 | 字段校验、提交防重、锁定倒计时、注册视图开关、维护视图、`prefers-reduced-motion` 不崩 |
| `src/components/auth/__tests__/LocalAdminForm.test.tsx` | 新增 | 默认口令告警、`attemptsLeft` 呈现、锁定期间禁用 |
| `CLAUDE.md` | 修改 | 新增「Desktop identity gate」章节（约 25 行）：三条例行（令牌只在主进程 / localAdmin 只在配置文件 / 业务 `user_id` 恒为 `LOCAL_OWNER_ID`）、命令 `npm run test:auth`、以及「改动 R1 契约必须同步 webserver/docs/desktop-integration.md」 |
| `desktop/README.md` | 修改 | 新增「登录与破窗账号」一节：文件位置、如何改 `localAdmin`、如何解除本地失败锁定、如何彻底关闭闸门、日志位置 |
| `docs/plans/desktop-account-login-gate/spec.md` | 修改（v2） | 本文件；v1 → v2 的评审修订记录见文首「评审记录」与文末「评审结论」 |

### 3.5 实施阶段与判据（v2：串行阶段 + 两条并行通道）

v1 让六个阶段**全串行**、且把服务端 P0 排在最前，意味着桌面端 P1–P4 都要等服务端落地才能动。本轮只剩第 2/3 迭代，那样会浪费一整轮（P1-12）。v2 拆成**两条互不依赖的通道**，只在 P5 汇合：

```
通道 A（服务端 webserver/）   P0 ──────────────────────────┐
通道 B（桌面端 desktop/+src/）P1 → P2 → P3 → P4 ───────────┴─→ P5 端到端 → P6 文档收尾
```

通道 B 之所以能不等 A：桌面端的契约测试跑在 `desktop/scripts/auth-smoke.js` 的**假账号服务器**上，那份假实现就是契约的可执行定义（§6.4）。它先把「桌面端期望服务端怎么答」固化下来，通道 A 再按同一份期望去改真服务端——两边都对着同一张表写，比「先做服务端再联调」更快发现契约分歧。

| 阶段 | 通道 | 内容 | 完成判据（**全部**通过才算完成） |
|---|---|---|---|
| **P0** | A | 服务端配套：迁移 0004、同步函数 `replaceDeviceSession`、版本闸门（顺序固定）、`deviceKey` 透出、三个设置项、文档与冒烟 | ① `npm run db:migrate` 连跑两次幂等；② `npm test` 全绿（含新增 `desktop-login.test.ts` ≥ 9 条）；③ `node scripts/smoke.mjs` 62/62（对**新启动**的进程）；④ `/meta` curl 输出含三个新字段；⑤ 顶号集成测试断言 `revoked_reason='same_device_relogin'` |
| **P1** | B | 主进程内核：`authConfig` / `authErrors` / `authPolicy` / `authSessionStore` / `authHttp` / `localAdmin` | `npm run test:auth` 的 P1 部分全绿（≥ 40 条断言）；`node -e "require('./desktop/main/authPolicy')"` 无副作用（不读文件、不建定时器） |
| **P2** | B | `authController` + `authBridge` + `preload` + `index.js` 接线（**在 dev 早退之前**） | `npm run test:auth` 全绿；打包产物 DevTools 里 `await window.ecliptrixDesktop.auth.status()` 返回对象、含 `state` 且**不含** `accessToken`/`refreshToken`；`auth:status` 在 `start()` 完成前返回 `booting` 而不是 `undefined` |
| **P3** | B | 渲染侧：`authBridge.ts` / `SessionContext` / `SessionGate` / `LoginScreen` 及子表单 | `npm run type-check` 0 error；`npx vitest run src/contexts src/components/auth` 全绿；`desktop/ npm run dev` 打开时**不出现阻断屏**（gate-disabled 琥珀条 + 工作台）；浏览器直开 `:3000` 同样不阻断 |
| **P4** | B | `AccountMenu` / `ChangePasswordDialog` / `AuthBlocker` / 设备管理与 `openExternal` | 手工：登录后标题栏出现胶囊；改密后 `mustChangePassword` 消失；撤销另一台设备后该设备心跳 `401 session_revoked`；撤销**当前**设备后本机立刻回登录屏（P1-7） |
| **P5** | A+B | 端到端：`desktop/scripts/auth-smoke.js`、`node scripts/smoke-test.js` 扩展 | 见 §6.4 的 AC-20…AC-24；真实服务器上跑一遍 M2/M3/M4/M7 |
| **P6** | A+B | 文档收尾：`CLAUDE.md`、`desktop/README.md`、`desktop-integration.md` v2、i18n 完整性 | 根 `npm run lint` 0 warning；`webserver` 侧 `npm run type-check` + `npm run lint --max-warnings 0` 全绿；两处 i18n 字典键集合完全一致（有用例覆盖） |

---

## 4. Interface Design（接口设计）

### 4.1 IPC 与渲染侧类型（唯一真相在主进程，类型在渲染侧镜像）

```ts
// src/lib/api/authBridge.ts —— 与主进程返回结构逐字段一致；改一侧必须改另一侧
export interface ServerMeta {
  registrationEnabled: boolean
  inviteRequired: boolean
  smtpEnabled: boolean
  passwordPolicy: { minLength: number; maxBytes: number }
  appName: string
  supportEmail: string
  version: string
  minClientVersion: string     // '' = 无下限
  maintenanceMessage: string   // '' = 正常
  maxActiveSessions: number
}

export interface SessionUser {
  id: string
  email: string
  username: string
  displayName: string
  avatarUrl: string | null       // 服务端已有，v1 漏了（P1-6）
  status: string
  planTag: string
  mustChangePassword: boolean
  role: { key: string; name: string }
  permissions: string[]
}

export interface SessionInfo {
  id: string
  client: 'web' | 'desktop'      // 服务端已有（P1-6）
  deviceName: string
  platform: string
  appVersion: string
  deviceKey: string              // 服务端新增（§5.4）；网页端会话为 ''
  ip: string
  userAgent: string              // 服务端已有（P1-6）
  createdAt: string
  lastSeenAt: string
  expiresAt: string              // 该会话 access 到期（服务端已有，P1-6）
  current: boolean
}

export interface AuthStatus {
  state: AuthState
  source: AuthSource | null
  reason: AuthReason | null      // v1 是 string，把已经定义好的联合类型浪费了（P2-3）
  user: SessionUser | null
  sessionId: string | null
  expiresAt: string | null           // access 令牌到期（ISO-8601 UTC）
  lastVerifiedAt: string | null
  graceUntil: string | null
  mustChangePassword: boolean
  appVersion: string
  server: ServerMeta | null
  reachable: boolean                 // 最近一次探测是否拿到响应
  lockedUntil: string | null         // 破窗失败锁（ISO）
  attemptsLeft: number | null        // 破窗剩余次数
  securityWarning: 'plaintext-session' | 'local-default-password' | 'gate-disabled' | null
}

export interface AuthBridge {
  status(): Promise<AuthStatus>
  login(p: { identifier: string; password: string; rememberDevice?: boolean }): Promise<AuthStatus>
  loginLocal(p: { username: string; password: string }): Promise<AuthStatus>
  logout(): Promise<AuthStatus>
  register(p: { email: string; password: string; username?: string; displayName?: string; inviteCode?: string }): Promise<AuthStatus>
  changePassword(p: { currentPassword: string; newPassword: string; signOutOtherSessions?: boolean }): Promise<AuthStatus>
  requestPasswordReset(p: { email: string }): Promise<{ ok: true }>
  listSessions(): Promise<{ ok: true; items: SessionInfo[]; currentId: string }>
  revokeSession(id: string): Promise<{ ok: true }>
  openExternal(url: string): Promise<{ ok: true }>
  onChanged(cb: (s: AuthStatus) => void): () => void
}
```

失败返回统一形状（**不抛异常过 IPC**，`ipcMain.handle` 的 rejection 在渲染侧会丢掉 `code`）：

```ts
interface AuthFailure {
  ok: false
  code: string            // 服务端 error_code 或主进程合成码
  message: string         // 已本地化的兜底文案（界面优先用自己的 i18n 表）
  details?: unknown       // 如 { reasons: [...] } / { retryAfterSeconds: 120 } / { attemptsLeft: 3 }
  requestId?: string
}
```

### 4.2 主进程 → 账号服务器的 HTTP 契约（完整请求体）

**登录（形态 A）**

```http
POST {ACCOUNT_SERVER_URL}/api/v1/auth/login
Content-Type: application/json
X-Client-Version: 1.0.1
X-Request-Id: 6f1a…（uuid v4）

{
  "identifier": "ada@example.com",
  "password": "…",
  "client": "desktop",
  "clientVersion": "1.0.1",
  "device": {
    "name": "DESKTOP-7F3K2",
    "platform": "win32-x64",
    "appVersion": "1.0.1",
    "deviceKey": "9b2c1f8e0a4d6c3b7e5f1a2d4c8b6e0f"
  }
}
```
> `device.deviceKey` 由主进程的 `deriveDeviceKey({ userDataPath, hostname })` 填充（§2.4.1），**不是**随机数、也不是每次启动重新生成：它是「这台机器 + 这个 profile 路径」的稳定指纹。v1 全文引用了 6 次 `deviceKey` 却没定义它怎么来（P1-4），下游只能各自发明——用随机数会让重装即换键（顶号失效，回到 §1.2 理由 3 的锁门问题），用裸 `hostname` 会让同机房镜像互相顶号。

成功 `200`：`data` 含 `user` / `accessToken` / `refreshToken` / `expiresAt` / `refreshExpiresAt` / `sessionId`（字段名与 R1 契约 §2.1 完全一致，本轮不新增响应字段）。

**注册**：同上但路径 `/auth/register`，body 增 `email`（必填）/`username`/`displayName`/`inviteCode`，**不带** `identifier`；`201` 返回与登录同形的会话。

**心跳**：`POST /api/v1/auth/heartbeat`，仅 `Authorization: Bearer <accessToken>`，无 body。

**续期**：`POST /api/v1/auth/refresh`，body `{ "refreshToken": "…" }`，**不带** `Authorization`、不带 Cookie。响应体 `data` 含新 `accessToken` / `refreshToken` / `expiresAt` / `refreshExpiresAt`。

> ⚠️ 这一条是 R1 契约留下的坑：服务端早期版本按「有没有 `Authorization` 头」判定载体，导致桌面续期必然 403。R1 已在服务端改成「按令牌来源判定」（body 里有 `refreshToken` 即桌面模式）。**本轮实现必须验证这一条**（§6.3 的 AC-15），否则 90 天刷新令牌形同虚设。

**登出**：`POST /api/v1/auth/logout`，`Authorization: Bearer`，幂等 `200`。

**设备列表**：`GET /api/v1/me/sessions` → `data.items[]` 含 `id`/`client`/`deviceName`/`platform`/`appVersion`/`deviceKey`/`ip`/`userAgent`/`createdAt`/`lastSeenAt`/`expiresAt`/`current`（与 §4.1 的 `SessionInfo` 逐字段一致；`client`/`userAgent`/`expiresAt` 服务端本来就返回，v1 的类型漏了它们——P1-6）。

**撤销设备**：`DELETE /api/v1/me/sessions/{id}` → `200 { revoked: true, sessionId }`。

> **v1 在这里写错了（P1-7）**：v1 说「撤销自己当前会话返回 `409 cannot_modify_self`」。实际的 `cannot_modify_self` 是**管理后台**对自己的保护（`admin/users/[id]` 那条链路），`/me/sessions/{id}` 撤自己会**成功**：服务端失效该会话、返回 `200`、并清 Cookie（`webserver/src/app/api/v1/me/sessions/[id]/route.ts`，`profileService` 记 `logout`）。
>
> 所以桌面端必须处理这个「成功的自我登出」：`revokeSession(currentId)` 成功后立刻把状态切到 `unauthenticated` 并回登录屏。界面上的按钮置灰是**前端**的便利规则（避免误触），不是服务端约束——不要写一段永远不生效的 `409` 分支。

### 4.3 服务端新增/修改的端点语义

| 方法 | 路径 | 变更 | 权限 |
|---|---|---|---|
| GET | `/api/v1/meta` | 响应 `data` 增 `minClientVersion`、`maintenanceMessage`、`maxActiveSessions` | 公开 |
| POST | `/api/v1/auth/login` | 入参增 `clientVersion`、`device.deviceKey`；同设备顶号；版本过低 → `426 client_outdated`；维护模式 → `503 service_unavailable {details:{reason:'maintenance'}}` | 公开（限流不变） |
| POST | `/api/v1/auth/register` | 入参增 `clientVersion`；版本过低 → 426 | 公开 |
| GET | `/api/v1/me/sessions` | 列表项增 `current`、`deviceKey` | 会话 |
| PATCH | `/api/v1/admin/settings` | 白名单增 3 个键 | `settings.write` |

### 4.4 错误码映射全表（服务端 → 主进程 → 界面）

| 服务端 `error_code` | HTTP | 主进程 `reason` | 界面表现 | 是否可重试 |
|---|---|---|---|---|
| `invalid_credentials` | 401 | `invalid-credentials` | 表单上方内联「邮箱或口令不正确」 | 是（手动） |
| `account_locked` | 423 | `account-locked` | 倒计时（`details.retryAfterSeconds`）+ 按钮禁用 | 倒计时结束后 |
| `account_suspended` | 403 | `account-suspended` | 清会话 → 登录屏红条「账号已停用，请联系管理员」；**禁止**破窗绕过提示 | 否 |
| `rate_limited` | 429 | `rate-limited` | 按钮按 `Retry-After` 禁用，显示剩余秒数 | 到期后 |
| `session_revoked` | 401 | `session-revoked` | 清会话 → 登录屏黄条「会话已失效（管理员下线或口令变更）」 | 是 |
| `session_expired` | 401 | `session-expired` | 先续期；续期失败才登出 | 内部自动 1 次 |
| `password_change_required` | 403 | `password-change-required` | 进应用后强制改密对话框（登录时由该 403 触发；**长会话期间由心跳响应体的 `mustChangePassword` 触发**，见 §2.6 的 P1-3 说明） | — |
| `client_outdated` | 426 | `client-outdated` | 阻断屏「请更新到 x.y.z」+ 下载页 | 否（需升级） |
| `service_unavailable`（`details.reason==='maintenance'`） | 503 | `maintenance` | 阻断屏 + 公告 + 重试 + 破窗入口 | 是 |
| `service_unavailable`（其它） | 503 | `network` | 走离线宽限判定 | 是 |
| `weak_password` | 422 | `weak-password` | 注册/改密表单内联列出 `details.reasons[]` | 是 |
| `validation_failed` | 422 | `validation-failed` | 逐字段内联（`details.fields[{path,message}]`） | 是 |
| `email_taken` / `username_taken` | 409 | 同码 | 对应字段内联 | 是 |
| `invite_required` / `invite_invalid` / `invite_exhausted` | 403/409 | 同码 | 邀请码字段内联 | 是 |
| `password_mismatch` | 401 | `password-mismatch` | 当前口令字段内联 | 是 |
| `registration_disabled` | 403 | `registration-disabled` | 注册视图整体换成说明 | 否 |
| `payload_too_large` | 413 | 同码 | 通用错误（理论上不会出现，body 极小） | 否 |
| `internal_error` | 500 | `internal-error` | 通用错误 + 错误编号 | 是 |
| —（网络层） | — | `network_unreachable` / `request_timeout` | 登录表单内联「无法连接账号服务器」+ 重试 + 破窗入口 | 是 |
| —（主进程） | — | `local_admin_locked` / `local_admin_disabled` | 破窗表单内联 + `lockedUntil` 倒计时 | 到期后 / 否 |
| —（主进程） | — | `grace_expired` | 登录屏顶部「已超过 N 天未联网验证」 | 是 |
| —（主进程） | — | `bridge_unavailable` | 阻断屏（fail-closed） | 见 §2.13 |
| —（主进程） | — | `server_not_configured` | 阻断屏 + 仅破窗入口 | — |

### 4.5 事件与 CLI

- **事件**：`auth:changed`（`webContents.send`，载荷 = `AuthStatus`）。只在主窗口的 `webContents` 上推；窗口重建后由 `controller.start()` 重新推一次当前状态（渲染进程挂载即 `status()`，二者幂等）。
- **CLI**：本轮**不新增**桌面端 CLI。服务端的 `user:create` / `user:reset` 仍是唯一的离线账号操作入口（R1 已交付）。`desktop/` 侧只有 `npm run test:auth`。

### 4.6 环境变量与配置文件字段

| 名称 | 位置 | 作用 | 默认 |
|---|---|---|---|
| **`auth.accountServerUrl`** | `userData/desktop-config.json`（**权威**） | 账号服务器基址 | `''`（未配置 → 阻断屏 + 破窗入口） |
| **`auth.offlineGraceDays`** | 同上 | 离线宽限天数（1–30） | `7` |
| `localAdmin.username` / `.password` / `.enabled` | 同上 | 破窗凭据 | `admin` / `adminjr` / `true` |
| `ACCOUNT_SERVER_URL` | 可选覆盖：`desktop/scripts/env.template.desktop` → `userData/.env`，仅打包版由 `index.js` 注入 `readAuthConfig` | 临时改指向（灰度/自建服务器） | 不参与 |
| `ACCOUNT_OFFLINE_GRACE_DAYS` | 同上 | 覆盖宽限天数 | 不参与 |
| `ECLIPTRIX_AUTH_GATE` | 继承的 `process.env`（打包版另有 `userData/.env` 注入） | `on` / `off` 紧急阀；dev 未设置时默认 `off` | `on`（打包） |

> **为什么权威值不在 env 里（P0-1，v1 的错误）**：`userData/.env` 是**后端/前端子进程**的环境文件（`desktop/scripts/env.template.desktop` 87 行，键全是 `LLM_*` / `ARK_*` / `VOLCANO_TTS_*`），主进程只在 `index.js:153-158` 解析成 `state.userEnv` 后**往下传**，自己从不读它（没有 dotenv、没有 `process.env.X = …`）。把 `ACCOUNT_SERVER_URL` 写进那里，打包后主进程拿到的永远是 `''`。
>
> 另两条相关约定：① 它**不是** `NEXT_PUBLIC_*`，渲染进程永远不需要知道它（所有外呼都在主进程），因此不会被 `next build` 内联进客户端产物；② 改 `desktop-config.json` 需要重启应用（`initUserData()` 只在启动时读一次）。

---

## 5. Data Model（数据模型）

### 5.1 主进程 `userData/auth-session.json`（加密信封内的明文结构，`schemaVersion: 1`）

```json
{
  "schemaVersion": 1,
  "accessToken": "…",
  "refreshToken": "…",
  "expiresAt": "2026-10-08T21:31:22.000Z",
  "refreshExpiresAt": "2027-01-06T09:31:22.000Z",
  "sessionId": "…",
  "deviceKey": "9b2c1f8e0a4d6c3b7e5f1a2d4c8b6e0f",
  "user": {
    "id": "…", "email": "ada@example.com", "username": "ada",
    "displayName": "Ada", "status": "active", "planTag": "free",
    "mustChangePassword": false,
    "role": { "key": "member", "name": "普通用户" },
    "permissions": []
  },
  "source": "server",
  "lastVerifiedAt": 1794118092434,
  "serverTimeAt": 1794118092000
}
```

字段约束：
- 时间为**入库 epoch 毫秒**（与 R1 契约 §3 的 ISO 字符串不同，因为主进程要算差值；出口再转 ISO）。`lastVerifiedAt` / `serverTimeAt` 是数字。**枚举/类型校验必须在 `write()` 里再断言一次**（见 §2.4.2 的时间铁律）。
- `serverTimeAt` 取自最近一次成功响应的信封 `timestamp`，用于 `detectClockRollback` 的交叉校验（渲染进程可读的 `AuthStatus` 里不出现它）。
- 磁盘上的实际文件是信封：`{"v":1,"enc":"safeStorage","payload":"<base64>"}`。
- **`rememberDevice === false` 时不写这个文件**（P1-5）：令牌只活在主进程内存，进程退出即失效。若上一次会话曾落盘而这次选了「不记住」，**先 `clear()` 再继续**，否则下次启动会拿旧会话把人「登录」进去——用户以为自己选的是「不记住」。
- **绝不**包含：口令、`localAdmin`、任何服务端 `SESSION_SECRET`。

### 5.2 `userData/desktop-config.json` 的增量

```json
{
  "schemaVersion": 1,
  "localAdmin": { "username": "admin", "password": "adminjr", "enabled": true },
  "auth": { "accountServerUrl": "", "offlineGraceDays": 7 },
  "frontendPort": 18320,
  "backendPort": 18321,
  "windowBounds": null,
  "lastRunVersion": "1.0.1"
}
```

- 回填规则：`initUserData()` 先取 `defaultConfig()` 再 `{...defaults, ...parsed}`，解析结果里没有 `localAdmin` / `auth` 时默认值自动补上并写回。**已存在时不覆盖**（用户改过的口令与服务器地址不会被升级重置）。
- **这是浅合并，不是深合并（P2-5）**：`config.js:43` 是 `{ ...config, ...parsed }`，顶层整键缺失才会补默认值；磁盘上若是半截 `"auth": { "accountServerUrl": "https://x" }`（缺 `offlineGraceDays`），默认值**不会**补进嵌套字段。因此 `readAuthConfig()` 必须逐字段用 `??` 兜底，不能假设 config 里的嵌套对象是完整的。
- 若用户手工删除 `localAdmin` 键，下次启动会被重新补成默认值——这是刻意的：破窗通道不能被「删掉一行 JSON」变成不可用（要禁用请写 `"enabled": false`）。`auth.accountServerUrl` 被删掉则回到「未配置」阻断屏（可接受，因为它是运维配置而非救援通道）。

### 5.3 `userData/auth-attempts.json`

```json
{ "schemaVersion": 1, "failures": 2, "lockedUntil": 0 }
```

写入时机：每次破窗失败 / 成功。原子替换、`0o600`。删除此文件即解锁（文档写明）。

### 5.4 服务端迁移 `webserver/src/server/db/migrations/0004_device_identity.sql`

```sql
-- 0004_device_identity.sql — 让服务端认识「设备」，用于同一设备重新登录时顶掉
-- 自己的旧会话，而不是消耗每用户 10 条并发会话的名额。
--
-- 只做加法：ALTER TABLE ADD COLUMN + 新建索引，不动既有列、不重建表
-- （迁移铁律见 CLAUDE.md：启动期永不出现 DROP）。
--
-- 老数据 device_key = ''，因此部分索引只索引具备真实设备标识的行；
-- 网页端登录不带 deviceKey，行为与之前完全一致。

ALTER TABLE sessions ADD COLUMN device_key TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_sessions_device
  ON sessions (user_id, device_key)
  WHERE device_key <> '';
```

**为什么不是唯一索引**：同设备顶号在「撤销旧的 → 插入新的」同一事务内完成，唯一部分索引会在并发登录时把第二条变成 `SQLITE_CONSTRAINT`（500），而并发登录在真实世界会发生（用户连点两下、两台同 profile 的实例）。索引只服务于查询效率，约束由事务保证。

### 5.5 服务端新增设置项（`settingsService.SPECS`）

| 键 | 类型 | 范围 | 默认 | 说明 |
|---|---|---|---|---|
| `client.minVersion` | string | ≤ 20 字 | `''` | 最低桌面客户端版本；空串 = 不限制。语义化版本比较 |
| `app.maintenanceMessage` | string | ≤ 200 字 | `''` | 非空即进入维护模式（登录/注册 503，心跳与续期不受影响） |
| `security.maxActiveSessions` | int | 1–50 | `10` | 每用户并发会话上限，替代硬编码常量。**调小不批量踢在线会话**：从下一次登录起按 LRU 收敛（`sessionService.createSession()` 的 `oldestActiveIds` 段），被挤掉的会话记 `REVOKE_REASON.session_limit` |

### 5.6 新增审计动作（服务端 `audit_events.action`）

| action | target | metadata | 触发 |
|---|---|---|---|
| `auth.session_relogin` | `user` / 用户 id | `{ deviceKey, replacedCount }` | 同设备重新登录顶掉旧会话 |
| `auth.login_blocked_outdated_client` | `user` / 用户 id 或 `null` | `{ clientVersion, minVersion }` | 426 拦截 |
| `auth.login_blocked_maintenance` | `user` / `null` | `{}` | 维护模式拦截（限流前记录，便于确认不是攻击） |

---

## 6. Testing & Acceptance Criteria（测试与验收）

### 6.1 桌面主进程单元测试（`npm run test:auth`，纯 Node，无需 Electron）

不引入任何新依赖：用 `node:assert` + 手写 `run(name, fn)` 迭代，与既有 `desktop/main/window-state.test.js` 完全同风格（该文件已证明这条路可行）。

| 文件 | 覆盖点（最小条数） |
|---|---|
| `authConfig.test.js` | 默认值全对；`http://` 非本地被拒；`https://x/` 去尾斜杠；`graceDays` 越界夹取；`gateEnabled=false`；**`serverUrl` 取自 `config.auth.accountServerUrl` 而非 env（P0-1）**；**env 覆盖仅在显式传入时生效**；**`deriveDeviceKey` 对同一输入稳定、对 `userDataPath` 与 `hostname` 任一变化即变（P1-4）**；`resolveGate` 在 `isDev` 未设 env 时为 `false`（12+3=15） |
| `authPolicy.test.js` | §2.4.2 判定表 12 行逐条（**含新增的 `server-not-configured` 行**）；宽限边界（正好等于截止时刻 → 过期）；回拨 5 分钟内不算、6 分钟算；`nextTimerDelay` 取较早者；`compareVersions('1.0.10','1.0.9')===1`；**epoch 数字输入下 `graceDeadline`/`nextTimerDelay` 返回有限数（P0-3）**；**任何输入下 `delayMs` 都 ≥ 1000 且 ≤ 24h**；**`refreshExpiresAt` 有效时宽限被压缩到它之前**（18+4=22） |
| `authSessionStore.test.js` | 加密路径往返；`safeStorage` 不可用 → `enc:'plain'` + `encrypted:false`；损坏 JSON → `{session:null,corrupt:true}`；原子写（临时文件名不含目标名）；v0→v1 迁移保留令牌；**`rememberDevice:false` 时不落盘且清除旧文件（P1-5）**；**`write()` 遇到 ISO 字符串时间字段直接拒绝（时间铁律）**（10+2=12） |
| `authHttp.test.js` | 假服务器：登录成功解包；`invalid_credentials` → `AccountError.code`；`account_locked` 带 `details.retryAfterSeconds`；超时 → `request_timeout`；5xx → `network_unreachable`；**同一调用不产生第二次请求**（用一个计数器断言）；日志不含口令（13） |
| `localAdmin.test.js` | 正确凭据 → ok；用户名错与口令错返回同一码；`timingSafeEqual` 被调用两次（不短路）；5 次后锁定 60s；第 6 次 120s；成功后清零；`enabled:false` → `local_admin_disabled`（11） |
| `authBridge.test.js` | 10 个通道全部注册（假 `ipcMain` 收集 `handle` 调用）；非法入参 → `invalid_request` 且不进控制器；`openExternal` 拒绝 `file://`、`javascript:`、外域；控制器抛错 → `{ok:false,code}`；**`controller.start()` 未完成时 `auth:status` 返回 `state:'booting'` 而不是 `undefined`（P1-2）**（9+1=10） |

### 6.2 渲染进程测试（vitest + jsdom + @testing-library/react，均已安装）

| 文件 | 覆盖点 |
|---|---|
| `src/contexts/__tests__/SessionContext.test.tsx` | 桥返回 `authenticated` → children 可见；`unauthenticated` → 登录屏；`onChanged` 推送后切换；卸载取消订阅；生产环境无桥 → `bridge-unavailable`（fail-closed）；开发环境无桥（浏览器直开）→ 放行 + 告警；**有桥且主进程状态为 `gate-disabled` → 放行 + 琥珀条（P0-2 的正确判据）** |
| `src/components/auth/__tests__/LoginScreen.test.tsx` | 空提交不调用 `login`；提交中重复点击只调一次；`account_locked` 显示倒计时且按钮禁用；`registrationEnabled:false` 隐藏注册；`maintenanceMessage` 非空显示维护视图；`minClientVersion` 高于本机 → 更新视图 |
| `src/components/auth/__tests__/LocalAdminForm.test.tsx` | 默认口令 → 红字告警；`attemptsLeft` 递减呈现；`lockedUntil` 期间输入与按钮均禁用 |

### 6.3 服务端测试（`webserver/`）

| 文件 | 覆盖点 |
|---|---|
| `tests/integration/desktop-login.test.ts`（新增，≥ 11 条） | ① 同一 `deviceKey` 二次登录 → 第一次的 access 令牌心跳返回 `401 session_revoked`，且 `revoked_reason='same_device_relogin'`；② 不同 `deviceKey` 不互相影响；③ `deviceKey` 缺失（网页端）行为不变；④ `clientVersion < minVersion` → `426 client_outdated` 且 `details.minVersion` 正确；⑤ `minVersion` 为空 → 不拦；⑥ 426 不影响 `/auth/heartbeat` 与 `/auth/refresh`；⑦ 维护模式 → 登录 503 且 `details.reason='maintenance'`；⑧ `GET /me/sessions` 的 `current` 恰好为 1 条且等于当前会话（**回归保护，该能力已存在**）；⑨ `maxActiveSessions` 设为 3 时第 4 条会话被挤掉（reason `session_limit`）；**⑩ 426 拦截不消耗 `login_attempts`、不把账号锁住（连发 N 次 426 后正确口令仍能登录，P1-10）**；**⑪ 顶号是原子的：撤销旧会话与创建新会话在同一事务内，注入一个「create 抛错」的桩后旧会话仍然有效（P0-4）** |
| `tests/unit/settings.test.ts` | 三个新键默认值/范围/未知键 422 |
| `scripts/smoke.mjs`（52 → 62） | 新增 10 条：`/meta` 三字段存在；带 `deviceKey` 登录两次 → 第一次令牌 `401 session_revoked`；`clientVersion` 过低 → 426 且 `details.minVersion` 正确；`/me/sessions` 的 `current` 恰好一条；`deviceKey` 出现在列表里；设置三个新键的 PATCH/GET 往返（**是 PATCH，`/admin/settings` 没有 PUT**）；维护模式开关（写公告 → 登录 503 → 清空 → 登录 200）；维护期间心跳仍 200；426 之后正确客户端仍能登录；`security.maxActiveSessions` 设为 2 时第 3 条会话被挤掉 |

### 6.4 端到端（Electron 之外可自动化的部分）+ 手工清单

**`desktop/scripts/auth-smoke.js`（新增，可进 CI）**：起一个本地假账号服务器（`http.createServer`，实现 `/health` `/meta` `/auth/login` `/auth/heartbeat` `/auth/refresh` 的契约子集），然后**只加载主进程模块**（不启动 Electron），断言 14 条：

1. 无会话启动 → `unauthenticated`；
2. 登录成功 → 落盘 `auth-session.json`，且磁盘内容不含明文 `accessToken`（safeStorage 可用时）；
3. 立即重启控制器 → 心跳 200 → `authenticated / server`；
4. 服务端不可达 + 宽限内 → `authenticated / offline-cache`；
5. 把 `lastVerifiedAt` 改成 8 天前 → `unauthenticated / grace-expired`；
6. 把系统时间观念（注入 `now`）调到比 `lastVerifiedAt` 早 10 分钟 → `unauthenticated / clock-rollback`；
7. 心跳 401 `session_revoked` → 会话文件被删除；
8. access 过期 → 自动续期一次 → 成功；**并发触发两次续期只发一次 HTTP**（用假服务器计数断言）；
9. 续期 401（重用）→ 硬登出 + `reason='session-revoked'`；
10. 破窗登录 → `authenticated / local-root`，且**不产生**任何 HTTP 请求（假服务器计数为 0）；
11. 破窗失败 5 次 → `local_admin_locked` 且 `lockedUntil` 有值；
12. `ECLIPTRIX_AUTH_GATE=off` → `gate-disabled`；
13. `ACCOUNT_SERVER_URL` 为空 → `server-not-configured`；
14. `auth:status` 的 JSON 里不含 `accessToken`/`refreshToken` 两个键（递归查找断言）。

**手工清单（打包后必须逐条走，记录在 PR 里）**

| # | 步骤 | 期望 |
|---|---|---|
| M1 | 全新 profile 启动安装包 | 先出现极简标题栏 + 骨架，≤ 1s 后出现登录屏；窗口可拖动/最大化/关闭 |
| M2 | 输入错误口令 6 次 | 第 6 次返回 `423` 倒计时；按钮按剩余秒数禁用；错误编号可见 |
| M3 | 正确登录 | 直接进入剪辑工作台；标题栏右侧出现账号胶囊，显示角色 |
| M4 | 关窗再启动 | 不再要求登录（心跳 200） |
| M5 | 手机热点关闭网络后启动 | 进入应用 + 琥珀色「离线模式」角标 |
| M6 | 把系统时间往回调 1 小时再启动 | 要求重新登录（`clock-rollback`），文案不吓人 |
| M7 | 网页控制台踢掉该会话后，桌面端 15 分钟内 | 自动切回登录屏，黄条「会话已失效」 |
| M8 | 网页后台把 `minVersion` 设为 `99.0.0`，桌面重新登录 | 进入更新阻断屏，有下载按钮 |
| M9 | 网页后台写维护公告，桌面新登录 | 维护屏 + 破窗入口仍可用 |
| M10 | 点「使用本地管理员登录」，输入 `admin` / `adminjr` | 进入应用，红色「本地管理员」徽标；显示默认口令告警 |
| M11 | 破窗入口输错 5 次 | 锁 60s 倒计时；删 `auth-attempts.json` 后可立即再试 |
| M12 | 账号菜单 → 我的设备 | 列出本机与其他设备，本机标「当前设备」，撤销按钮对当前设备禁用 |
| M13 | 改密后勾选「注销其他设备」 | 其他设备下一次心跳被踢；本机不受影响 |
| M14 | 深色/浅色切换、键盘 Tab 走完表单、`prefers-reduced-motion` | 无布局跳动；焦点环清晰；动效归零 |
| M15 | 退出登录 | 二次确认 → 回登录屏 → 应用内业务树完全卸载（CPU/内存回落） |
| M16 | `desktop/ npm run dev` 启动，然后用浏览器直开 `localhost:3000` | **两种都不出现阻断屏**：dev 有琥珀条「开发模式：身份闸门未启用」并正常进入工作台；浏览器直开同样放行 + 告警。这是 P0-2 的手工回归项 |
| M17 | 登录后断网，打开账号菜单 →「我的设备」与「打开账号中心」 | 不静默失败：「我的设备」给出「无法连接，重试」，账号中心按钮给出提示而不是弹一个空白窗口 |
| M18 | 在 `desktop-config.json` 写入 `auth.accountServerUrl` 后重启 | 登录屏能真正连上服务器（证明配置读的是**主进程**能看到的来源，而不是只在子进程里生效的 `.env`）。P0-1 的手工回归项 |
| M19 | 取消勾选「记住这台设备」登录 → 关闭并重启应用 | 回到登录屏（会话未落盘），且磁盘上没有 `auth-session.json`；勾选状态下重启则免登录 |

### 6.5 验收标准（Definition of Done，编号供后续节点引用）

| 编号 | 判据（可测量） |
|---|---|
| AC-01 | 打包产物首次启动**必定**呈现登录界面，不出现工作台（M1） |
| AC-02 | 登录界面同时提供「账号服务器登录」与「本地管理员登录」两个入口（M1/M10） |
| AC-03 | 账号服务器登录走 `POST /api/v1/auth/login` 且 `client:"desktop"`，`device` 四个字段齐全 |
| AC-04 | 注册、找回口令、改密、设备列表、撤销设备 5 条链路全部经主进程外呼，渲染进程无网络外呼 |
| AC-05 | `window.ecliptrixDesktop.auth.status()` 的返回值中不存在 `accessToken`/`refreshToken` 键（§6.4 #14） |
| AC-06 | `admin`/`adminjr` 可从 `desktop-config.json` 离线登录，且**不产生任何 HTTP 请求**（§6.4 #10） |
| AC-07 | 用户手动修改 `desktop-config.json` 的 `localAdmin.password` 后，旧口令立即失效（下次启动生效） |
| AC-08 | 已存在 `localAdmin` 时升级启动**不覆盖**用户改过的口令 |
| AC-09 | 离线宽限：断网 ≤ 7 天可进（`offline-cache`），> 7 天必须登录（`grace-expired`） |
| AC-10 | 系统时间回拨被识别为 `clock-rollback`，且**不**删除会话文件 |
| AC-11 | 会话被服务端撤销后，桌面端在 ≤ 1 个心跳周期内回到登录屏 |
| AC-12 | 并发续期只发出 1 个 refresh 请求（防「重用检测」误杀全场会话）（§6.4 #8） |
| AC-13 | `mustChangePassword` 为真时，渲染层强制挂载不可关闭的改密对话框，且主进程在该状态下只正常服务 `status` / `change-password` / `logout` / `list-sessions` / `revoke-session` 五个通道（**准确说法是「渲染层强制 + 主进程收窄」，不是「技术上不可能绕过」**——见 §2.1.1 威胁模型） |
| AC-14 | 同一 `deviceKey` 二次登录后，旧会话 `revoked_reason='same_device_relogin'`（服务端测） |
| AC-15 | 桌面端 `POST /auth/refresh` 无 `Authorization`、无 Cookie 时返回 200 与双令牌（服务端测 + smoke） |
| AC-16 | `client_outdated`（426）只作用于 login/register，不影响 heartbeat/refresh/logout |
| AC-17 | 维护模式下新登录 503、老会话不受影响、破窗入口可用 |
| AC-18 | 渲染进程在**生产**构建且桥缺失时 fail-closed（阻断屏），在 dev 时放行并显著标注 |
| AC-19 | `ECLIPTRIX_AUTH_GATE=off` 时放行，但界面常驻「闸门已关闭」红条且主进程每次启动 warn |
| AC-20 | `npm run test:auth` 全绿（≥ 83 条断言，覆盖 §6.1 六文件；v1 的 73 条是修订前的口径） |
| AC-21 | `npx vitest run src/contexts src/components/auth` 全绿（≥ 3 文件） |
| AC-22 | `webserver`：`npm run type-check` 0 error、`npm run lint --max-warnings 0` 0 warning、`npm test` 全绿（含新增 ≥ 11 条） |
| AC-23 | `node scripts/smoke.mjs` 62/62（对**新启动**的进程） |
| AC-24 | `desktop/scripts/auth-smoke.js` 14/14 |
| AC-25 | 根项目 `npm run type-check` 0 error、`npm run lint` 0 warning（新增渲染文件不许引入新 lint 例外） |
| AC-26 | 业务零迁移：`backend-services/basic-service/app/constants.py` 与 `src/lib/localOwner.ts` 的 `git diff` 为空；`data/ecliptrix.db` 结构不变 |
| AC-27 | i18n：`src/lib/i18n.ts` 的 `Translations` 接口、`translations.en`、`translations['zh-CN']` 三处键集合完全一致（`npm run type-check` 保证接口对齐，用例保证两语言对齐） |
| AC-28 | 文档：`CLAUDE.md` / `desktop/README.md` / `webserver/docs/desktop-integration.md`（v2）/ `docs/api.md` / `deployment-checklist.md` 五处全部更新，且 «52/62» 数字一致 |
| AC-29 | **（v2 新增）** `desktop/ npm run dev` 与浏览器直开 `:3000` 都**不出现阻断屏**（闸门以 `gate-disabled` 放行且界面显著标注）；生产构建缺 preload 时仍 fail-closed（M16） |
| AC-30 | **（v2 新增）** `deriveDeviceKey` 对同一 `{userDataPath, hostname}` 稳定、对两者任一变化即变；同一账号在同一设备重复登录只会留下 1 条活跃会话（M4 + 服务端测试①） |
| AC-31 | **（v2 新增）** 打包产物只改 `desktop-config.json` 的 `auth.accountServerUrl` 即可切换服务器（不依赖 `.env`），改完重启生效（M18） |
| AC-32 | **（v2 新增）** 心跳遇到 `429 rate_limited` 时按网络问题走宽限判定，**不**把用户踢回登录屏 |

---

## 7. Risks & Mitigations（风险与对策）

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| R1 | **闸门把所有人关在门外**（登录后无法进入应用） | 产品不可用（P0） | 三重保险：① `ECLIPTRIX_AUTH_GATE=off` 紧急阀；② 破窗入口永远在登录屏上；③ P3 阶段的判据要求「dev 浏览器可见登录屏 + 打包产物可登录」两条都过才能进 P4 |
| R2 | **并发续期触发服务端重用检测**，把该用户全部会话撤销 | P0（用户被全场踢下线，且看起来像被黑） | `withTokenLock` 单飞（§2.6）；`auth-smoke.js` #8 专门断言「两次并发只发一个请求」；服务端 `refresh` 不重试 |
| R3 | 令牌泄漏（渲染进程 XSS / 日志 / 崩溃转储） | P0（90 天凭证） | 令牌只在主进程；`authHttp` 日志白名单；`AuthStatus` 无令牌（AC-05）；崩溃上报不含 `auth-session.json` |
| R4 | `safeStorage` 在 Windows 服务账户/无 keyring 的 Linux 上不可用，令牌落明文 | P1 | 显式降级 + `securityWarning:'plaintext-session'` + 界面黄条 + 日志告警；文件 `0o600`；文档写明「不要在多用户机器上用无 keyring 的构建」 |
| R5 | `localAdmin.password` 明文存于 `desktop-config.json`，且默认值 `adminjr` 弱 | P1 | 需求明确要求「直接写死在配置文件里」，无法改为哈希（哈希后用户就不能照文档改口令了）；因此：默认口令告警条、`enabled` 开关、多用户机器文档警告、发布检查表加一条「破了默认口令没有」 |
| R6 | 端口变化导致 `127.0.0.1:<port>` origin 变化，渲染进程状态丢失 | P2 | 状态全部在主进程（磁盘 + 内存），渲染进程只是显示层；`index.js` 既有的端口变更对话框文案需要顺手从「登录状态与本地偏好可能需要重新设置」改为「本地偏好可能需要重新设置，登录状态不受影响」 |
| R7 | 服务端 `maxActiveSessions` 调小后，老会话被批量挤掉 | P2 | 挤掉时写 `session_limit` 审计；文档要求「调小前先看 `/admin/audit` 的活跃会话数」 |
| R8 | 版本闸门误配（把 `minVersion` 写成当前线上版本以上） | P1（所有用户被挡） | 服务端在 PATCH 设置时只做格式校验不猜语义；`/admin/settings` 保存成功后前台给出醒目提示「此值高于线上版本会导致所有旧客户端无法登录」；冒烟用 `99.0.0` 起停各一次证明可回滚 |
| R9 | 登录屏遮住 frameless 窗口的拖拽区 | P2（体验否决项） | `AuthTitleBar` 保留 **40px**（与 `AppTitleBar` 的 `h-10` 一致）的 `-webkit-app-region: drag`，可点元素放在 `no-drag` 子容器里；M1 手工项必须通过 |
| R10 | dev 与打包产物行为分叉，导致「本地能跑、装机崩」 | P1 | v2 让两侧走**同一条**主进程状态机（dev 只是 `gateEnabled=false`），渲染进程不再靠「桥在不在」猜环境；剩余差异只有「dev 不解析 `userData/.env`」与「dev 加载 `:3000`」两条，都写进 §2.13；P3 判据要求 dev 与打包产物各验证一次 |
| R11 | 260 字维护公告被写进 `meta`，每次登录都传 | P3（可忽略） | 公告 ≤ 200 字，缓存 60s 于主进程；不引入 SSE |
| R12 | 用户在多台机器上用同一个 `deviceKey`（同一 `hostname` + 同 profile 路径的克隆） | P3（可忽略） | `deviceKey` 里混入 `userDataPath`（含机器名与用户名），克隆场景极罕见；真出现则表现为互相顶号，退化为「重新登录」，不丢数据 |
| R13 | **配置源再次被搞混**：后来者看到 `userData/.env` 就顺手把主进程配置写进去（v1 的原缺陷） | P1（打包后闸门必然「未配置」） | `authConfig.test.js` 有一条断言「`serverUrl` 来自 `config.auth.accountServerUrl`，env 仅在显式传入时覆盖」；`§2.4.1` 与 `§4.6` 各写一段「为什么不在 env」；`desktop/README.md` 的配置章节只提 `desktop-config.json` |
| R14 | **顶号事务被写回 `async login()`**：实现者图省事在 `login()` 里就地开 `db.transaction` | P0（顶号不原子；`better-sqlite3` 抛错 → 登录 500，所有人登录不了） | `replaceDeviceSession()` 是唯一入口，函数注释写明「禁止 await」；集成测试⑪用「create 抛错」桩断言旧会话仍有效 |
| R15 | **心跳限流被误判为会话失效** | P1（用户被反复踢回登录屏） | `probeHeartbeat` 显式映射 `429 → network`；AC-32 单列一条判据 |

---

## 8. Appendix（附录）

### 8.1 与 R1 契约的差异（必须回写到 `webserver/docs/desktop-integration.md` v2）

| 编号 | R1 契约原文 | 本轮做法 | 理由 |
|---|---|---|---|
| D2-01 | §8 新增 `src/lib/api/authClient.ts`（渲染进程直连账号服务器） | 改为 `src/lib/api/authBridge.ts`（IPC 包装）+ 主进程 `desktop/main/authHttp.js` | 令牌必须与网络外呼同处一域，否则 90 天凭证进入 XSS 可达区域（§2.3） |
| D2-02 | §8 修改 `src/lib/api/http-client.ts` 注入 `Authorization: Bearer` | **不改** | 该客户端只打本地 `127.0.0.1` 后端（文件开头的注释即为此意），注入外部令牌既无用处又把令牌送进渲染进程 |
| D2-03 | §8 修改 `src/app/page.tsx`：未认证时短路 | 改为在 `src/app/layout.tsx` 用 `<SessionGate>` 包裹；`page.tsx` 只加一行 `sessionSlot` | 短路写在页面里，`/login` 深链与将来任何新增页面都要复制一遍，遗漏一次就是漏洞 |
| D2-04 | §3 `auth-session.json` 只有 ISO 时间字段 | 增加 `schemaVersion` / `sessionId` / `deviceKey` / `serverTimeAt`，时间改存 epoch 毫秒 | 主进程要做时间差与回拨检测；ISO 字符串每次都要 parse，且时区/精度易错 |
| D2-05 | 未提及「同一设备重新登录」 | 新增 `sessions.device_key` + 登录事务内顶号（服务端迁移 0004） | 10 条会话上限 × 90 天刷新令牌 = 重装用户被自己挤出（§1.2 理由 3） |
| D2-06 | §6 `password_change_required` → 「跳账号中心安全页改密」 | 改为应用内 `ChangePasswordDialog`（不可关闭） | 桌面端跳到网页改密要求用户再登录一次网页会话；同期令牌就在主进程里，直接改最快 |
| D2-07 | §2.2 心跳节奏「启动一次 + 每 15 分钟一次」 | 保留，并补「窗口 focus 且距上次 > 15 分钟时立即补一次」「`powerMonitor.resume` 同规则」 | 笔记本合盖唤醒后，用户会先看到 15 分钟前的状态 |
| D2-08 | §4 降级矩阵「服务端不可达且 `lastVerifiedAt` 在 7 天内 → 允许进入」 | 保留，并补「宽限同时受 `refreshExpiresAt` 约束」「系统时间回拨 5 分钟以上视为超出宽限」 | 一个可改系统时间的宽限窗口等于没有宽限 |
| D2-09 | 未指定「桌面端账号服务器地址从哪里配」 | 权威来源 `desktop-config.json` 的 `auth.accountServerUrl`；`userData/.env` 里的 `ACCOUNT_SERVER_URL` 只作可选覆盖，且仅打包版由 `index.js` 注入 `readAuthConfig` | Electron 主进程**不解析** `userData/.env`（无 dotenv、无 `process.env` 赋值），那个文件只被注入给 FastAPI / Next 子进程。写进 env 等于「配置了但永远读不到」（P0-1） |
| D2-10 | §8 未指定「撤销自己的会话」的语义 | 服务端 `DELETE /me/sessions/{id}` 撤自己会**成功**（200 + 失效 + 清 Cookie），桌面端据此把它当作「自我登出」处理；按钮置灰是前端便利规则 | v1 误记为 `409 cannot_modify_self`（那是管理后台对她的保护），照抄会写出永不生效的分支（P1-7） |
| D2-11 | §2.2 心跳「启动一次 + 每 15 分钟一次」，未说失败码 | 心跳的成功信号在**响应体**（`mustChangePassword` / `role` / `permissions` / `expiresAt`），失败码只有 `401 session_revoked` / `session_expired` / `unauthorized`、`403 account_suspended`、`429 rate_limited`（按网络处理） | 心跳路由用 `allowPasswordChangeRequired: true` 放行改密前状态，因此 403 `password_change_required` / 423 / 426 / 503 都不会出现在心跳上（P1-3） |

### 8.2 i18n 键清单（`src/lib/i18n.ts` → `Translations.auth`，**65 个**）

> **v2 修正（P2-1）**：v1 标题写「46 个」，下面实际列了 **65** 个（脚本核数：去重后仍 65）。
>
> 结构提醒：根项目的 `i18n.ts`（12 524 行）是**嵌套对象** —— `export interface Translations { webResearch: {...}; agentHost: {...} }`，`export const translations: Record<string, Translations>`，locale 键就是 `en` 与 `zh-CN`。所以下面的 `auth.title` 只是一个**清单记法**，落地要写成：
>
> ```ts
> // Translations 接口
> auth: {
>   title: string
>   identifier: { label: string; placeholder: string }
>   error: { invalidCredentials: string; locked: string; … }
> }
> // translations.en / translations['zh-CN'] 同形状
> ```
>
> 不要写成 `'auth.title': '…'` 扁平键——那会同时破掉接口与 `Record<string, Translations>` 的类型约束（AC-27 会红）。

```
auth.title               auth.subtitle            auth.identifier.label
auth.identifier.placeholder                        auth.password.label
auth.password.show       auth.password.hide        auth.remember
auth.forgot             auth.submit              auth.submitting
auth.or                 auth.noAccount           auth.createAccount
auth.backToLogin        auth.invite.label        auth.invite.hint
auth.confirmPassword.label                         auth.displayName.label
auth.username.label     auth.terms.accept        auth.error.invalidCredentials
auth.error.locked       auth.error.rateLimited   auth.error.retryIn
auth.error.suspended    auth.error.revoked       auth.error.expired
auth.error.network      auth.error.graceExpired  auth.error.bridgeUnavailable
auth.error.serverNotConfigured                     auth.error.outdatedClient
auth.error.maintenance  auth.error.requestId     auth.local.entry
auth.local.title        auth.local.hint          auth.local.submit
auth.local.lockIn       auth.local.attemptsLeft  auth.local.defaultPasswordWarning
auth.local.badge        auth.offline.badge       auth.offline.daysLeft
auth.menu.accountCenter auth.menu.devices        auth.menu.changePassword
auth.menu.logout        auth.devices.current     auth.devices.revoke
auth.devices.empty      auth.devices.title       auth.changePassword.title
auth.changePassword.current                        auth.changePassword.new
auth.changePassword.signOutOthers                  auth.passwordStrength.weak
auth.passwordStrength.fair                        auth.passwordStrength.strong
auth.passwordStrength.excellent                    auth.maintenance.title
auth.maintenance.download                          auth.gateDisabled.badge
auth.dev.badge
```

（列表按实现顺序补全即可；两语言必须同时补齐，`Translations` 接口是三处的共同约束。）

### 8.3 手工验收与自动门禁的对应关系

| 门禁命令（在哪跑） | 覆盖的 AC |
|---|---|
| `npm run test:auth`（`desktop/`） | AC-20、AC-30（`deriveDeviceKey`），间接 AC-06/09/10/12/32 |
| `npx vitest run src/contexts src/components/auth`（根） | AC-21，间接 AC-01/02/13/18/29 |
| `npm run type-check` + `npm run lint`（根与 `webserver/` 各一次） | AC-22、AC-25 |
| `npm test`（`webserver/`） | AC-22，直接 AC-14/15/16/17/30 |
| `node scripts/smoke.mjs`（`webserver/`，对新进程） | AC-23，直接 AC-14/15/17 |
| `node desktop/scripts/auth-smoke.js` | AC-24，直接 AC-05/06/09/10/12/32 |
| 手工 M1–M19（打包产物 + dev + 浏览器） | AC-01/02/03/07/08/11/13/19/29/31 |
| `git diff --stat` 复核 | AC-26 |
| 五处文档审阅 | AC-27、AC-28 |

### 8.4 与用户原始需求的逐条对应（自检）

| 需求原文 | 本轮落点 |
|---|---|
| 「这个本地的软件，用户后续打开以后，它会有对应的登录界面」 | §2.7 `SessionGate` + §2.8 `LoginScreen`（AC-01） |
| 「登录界面对应的登录和注册需要连接到这样的一个外部子项目的服务器上」 | §2.2 `authHttp` → `webserver/` 的 `/auth/login`、`/auth/register`；渲染进程零外呼（AC-03/04） |
| 「外部子项目需要有外部界面，管理员可以在上面进行账号增删改查和权限分配」 | 已由 R1 交付（`webserver/` 管理后台），本轮补 `client.minVersion`/`maintenanceMessage`/`maxActiveSessions` 三个运维开关 |
| 「普通用户只能查看落地页以及查看/编辑自己的账号信息」 | 已在 R1 网页端交付；本轮桌面端补「我的设备」「修改口令」「打开账号中心」三个入口（§2.8、AC-04） |
| 「桌面端有一个最高权限账号，可以不通过外部项目直接登录，写死在配置文件里 admin/adminjr」 | §2.9 `localAdmin`（AC-06/07/08），常量时间比对 + 失败锁定 + 默认口令告警 |
| 「这个网页子项目的整体界面和风格是 Super Base 的风格」 | R1 已交付网页端；本轮登录屏按同一设计语言实现（§2.8 的 9 条可打勾要求） |
| 「顶级设计、顶级体验以及顶级交互」 | §2.8 的版式/色彩/动效/输入/错误/可访问性六组硬要求 + M1/M14 手工项（含 frameless 拖拽区这条最容易被忽略的体验否决项） |
| 「还有我没有想考虑到的功能，你来完善」 | 离线宽限与回拨检测、会话单飞续期、设备顶号、版本闸门、维护模式、破窗失败锁定、我的设备管理、错误编号可报障、i18n 双语、fail-closed 降级策略（§2.13） |
| 「放在这个项目的 Web Server 目录下」 | 沿用 R1 已建立的 `webserver/`（全小写）。本项目其余目录均全小写（`backend-services/`、`desktop/`），不新增 `Web Server/`，避免同一子项目两个目录名 |

### 8.5 本文件的边界

- 只定义设计与施工图，**不含实现代码**。
- 与 R1 冲突时以本文件为准，并必须按 §8.1 回写 `webserver/docs/desktop-integration.md` v2，否则下一位实现者会照着旧契约写出令牌入渲染进程的版本。
- 任何实现与本文件不一致的地方，先在 `docs/plans/desktop-account-login-gate/` 下追加 `D-xx` 记账（格式见 R1 §「实施过程发现的方案缺陷」），再改代码；**不允许静默偏离**。

---

**签署**：Solution Architect（Anthropic engineering） · 第 2 轮 · 2026-10-08
**评审签署**：Senior Reviewer（Anthropic engineering） · v1 → v2 · 2026-10-08

---

## 评审结论（Review Verdict）

### 判定：**有条件通过**（approved with conditions）

这份设计的方向是对的，而且是对的**那一步**：它没有重做服务端的安全模型，而是承认 R1 已经把「服务端能登录」做完了，本轮只补「桌面端能登录」，并把「令牌必须在主进程」这个决定一次性定死。§2.3 的三方案对比、§2.6 的 `withTokenLock` 单飞、§2.8 逐区块可打勾的界面要求、§8.4 的需求逐条自检，都是能直接施工的质量。

但 v1 有 4 处**照抄就会做废**的缺陷（全部是对当前代码的事实判断错误，而非审美分歧）：主进程根本不读 `userData/.env`（P0-1）、dev 窗口其实有 preload 且 auth 接线会被早退跳过（P0-2）、会话时间改成了 epoch 而算法还在 `Date.parse`（P0-3）、`better-sqlite3` 的事务不能包 `async`（P0-4）。这四条不修，实现出来会是「打包后全员只能破窗」「`npm run dev` 被自己的闸门锁死」「心跳热循环把所有人踢下线」「顶号事务直接 500」。v2 已把它们连同 13 条 P1 一并修在正文里，因此**通过**；未修的只剩实现期纪律，故为**有条件**。

### 通过条件（逐条可核对，缺一条即视为未达成本轮 DoD）

| # | 条件 | 核对方式 |
|---|---|---|
| C1 | **P0-1**：`serverUrl` 的权威来源必须是 `desktop-config.json` 的 `auth.accountServerUrl`；`userData/.env` 只能作可选覆盖，且仅当 `index.js` 把 `userEnv` 注入 `readAuthConfig` 时生效 | `authConfig.test.js` 的对应用例 + 手工 M18（改配置即切换服务器） |
| C2 | **P0-2**：`createAuthController` / `registerAuthIpc` 必须位于 `main()` 的 `isDev` 早退**之前**；dev 与浏览器直开的放行判据是主进程状态 `gate-disabled`，不是「桥不存在」 | `desktop/ npm run dev` 与浏览器直开 `:3000` 均不出现阻断屏（M16 / AC-29） |
| C3 | **P0-3**：`authPolicy` 内部时间一律 epoch 毫秒；`graceDeadline` / `nextTimerDelay` 对任何输入都返回有限数，`delayMs ∈ [1000, 24h]` | `authPolicy.test.js` 的 epoch 用例 + `delayMs` 边界用例 |
| C4 | **P0-4**：顶号必须走**同步**函数 `sessionService.replaceDeviceSession()`（内部 `db.transaction`，函数体禁止 `await`），`authService.login()` 不得自行开事务 | 集成测试 ⑪（注入 create 抛错后旧会话仍有效）；代码评审看函数体有无 `await` |
| C5 | **心跳语义**：`probeHeartbeat` 从**响应体**读 `mustChangePassword`；`429` 归入 `network`，绝不登出 | §6.1 / `auth-smoke.js` #7 #8 与 AC-32 |
| C6 | **撤销自我**：`revokeSession(currentId)` 成功后立刻本地登出并回登录屏（服务端返回 200，不是 409） | P4 手工项 + 代码中不存在 `409 cannot_modify_self` 分支 |
| C7 | **阶段并行**：P0（通道 A）与 P1–P4（通道 B）可同时开工，但 P5 之前 P0 的五条判据必须全绿；P0 与 P1 之间的契约以 `auth-smoke.js` 的假服务器为**唯一可执行定义** | §3.5 的通道图 + P0/P5 判据 |
| C8 | **威胁模型不得被夸大**：任何文档/注释/PR 描述都不得声称「登录保护了本地项目数据」或「改密对话框不可绕过」；统一采用 §2.1.1 的表述 | 审阅 `CLAUDE.md` 新增章节 + `desktop/README.md` + AC-13 措辞 |
| C9 | **发布前必须破默认口令**：`localAdmin.password` 默认值 `adminjr` 与需求一致，但安装包发布检查表必须新增「已修改默认破窗口令」一项；多用户机器文档须写明「不要把 `%APPDATA%` 纳入云同步」 | `webserver/docs/deployment-checklist.md` 的新增项 + `desktop/README.md` 的安全提醒 |
| C10 | **文档回写**：`webserver/docs/desktop-integration.md` 升 v2，且必须包含 §8.1 的 D2-01…D2-**11**（v1 只写到 D2-08，v2 新增 D2-09/10/11 三条：配置来源、撤销自我、心跳错误码） | 该文件 v2 的差异表条数 = 11 |
| C11 | **手工清单扩到 M1–M19**，其中 M16（dev 不阻断）、M18（配置源）、M19（不记住设备）是本次评审新增的必过项 | PR 里逐条勾选并附截图/日志 |

### 遗留与不做（本轮明确接受，不再展开）

- **不做**本地后端鉴权、不做跨 Windows 用户隔离、不做证书 pinning（§2.1.1）。这三件事都不属于「用户打开软件先登录」这一半需求，做了反倒是范围膨胀。
- **不做** `/login` 路由（P1-13 已删除）：`SessionGate` 已经包住全部 children，多一条路由只增加绕过面。
- **不做** `deviceKey` 的服务端唯一索引（§5.4 已说明：并发登录会撞 `SQLITE_CONSTRAINT`，约束应由事务保证）。
- 剩余 P2 全部已在正文修正，无「已知但未处理」的 P2 遗留项。

### 一句话给下游实现者

按 §3.5 的**两条通道**同时开工：通道 A 先做 `0004_device_identity.sql` 与 `replaceDeviceSession()`（同步！），通道 B 先做 `authConfig` / `authPolicy` 并用假服务器把契约钉死。**每一次想「顺手把配置写进 `.env`」「顺手在 `login()` 里开事务」「顺手用 `Date.parse` 处理毫秒」的时候，回来看一眼 R.1 的四行**——这四条是本轮评审的全部价值所在。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

> 记账人：Implementation Engineer · 第 2 轮 · 迭代 2/3 · 2026-10-08
> 规则（沿用 R1 §「实施过程发现的方案缺陷」）：**任何与本文件不一致的落地方式都先记账再改代码，禁止静默偏离**。下面 D-01…D-18 全部已在实现中生效，逐条给出「本文件怎么说 / 实际怎么做 / 为什么」。

### A. 服务端（`webserver/`）

| 编号 | 本文件 | 实际做法 | 原因 |
|---|---|---|---|
| **D-01** | §3.3：`deviceSchema` 增 `deviceKey: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/).default('')` | `.max(64).refine(v => v === '' \|\| /^[A-Za-z0-9_-]{8,64}$/.test(v))` | 该写法自相矛盾：zod 3.x 会校验 `.default('')` 的值，空串不匹配 8–64 位正则 → 每一次不带 `deviceKey` 的网页登录/注册都 422。语义不变（空串显式允许），网页端行为与之前逐字节一致 |
| **D-02** | §3.3 的文件清单 | 另补了 `webserver/tests/unit/validation.test.ts` 的一行断言（`deviceKey: ''`） | 该用例对 `device` 对象做逐字相等断言，加了字段必红；不改它 `npm test` 无法全绿，且它属于「清单漏项」而非新范围 |
| **D-03** | §3.3：`loginSchema` / `registerSchema` 增 `clientVersion` | HTTP 边界（zod）必填/默认 `''`；**服务层 `LoginInput` / `RegisterInput` 上 `clientVersion` 与 `device.deviceKey` 仍是可选** | 既有集成测试与 `scripts/create-user.ts` 等调用方直接调服务层；改成必填会迫使改动清单外的多个文件，而闸门本来就用 `clientVersion` 为空来判定「网页端/旧客户端，跳过版本闸门」 |
| **D-04** | §6.3：`smoke.mjs` 52 → 62，并列了「新增 10 条」 | 实际是**恰好 62 条**离散 `check()`，其中「维护开 → 503 → 清空 → 200」合成为一条 | 那 10 条里「维护模式开关」「维护期间心跳」「426 之后正常客户端仍能登录」按逐条计数会变成 11 条；合并不减覆盖（三个子断言都在同一条里且都断言） |
| **D-05** | §5.6 只登记了 `auth.login_blocked_maintenance`（登录） | `register` 复用同一个 `assertNotInMaintenance()`，metadata 用 `{ client, source: 'login' \| 'register' }` 区分 | 维护模式要同时拦注册（§4.3 明写），而审计动作表只给了一个名字；新增一个动作会破坏审计面板既有的动作清单与 RBAC 过滤 |
| **D-06** | §2.11 第 3 项：版本闸门「`clientVersion < minVersion` → 426」 | `client.minVersion` 写成无法解析的字符串时**跳过闸门并保持登录可用**（日志 warn） | 这是「配置写坏」而非「客户端旧」。fail-closed 会让所有人在运维手滑一次后都登录不了；与 R8 的处置方向一致（服务端只校验格式、不猜语义），风险由 `/admin/settings` 的醒目提示承担 |

### B. 桌面主进程（`desktop/main/`）

| 编号 | 本文件 | 实际做法 | 原因 |
|---|---|---|---|
| **D-07** | §2.6 要求把 `loadUserEnv(envPath)` 前移到 dev 早退之前；§7 R10 又写「dev 不解析 `userData/.env`」 | `loadUserEnv` 前移照做（打包路径吃到早期快照），但 **dev 下 `readAuthConfig` 只吃继承的 `process.env`** | 两条要求只有在「前移但 dev 不喂给 auth」时才同时成立。否则模板里的 `ECLIPTRIX_AUTH_GATE=on` 会被复制进 `%APPDATA%\Ecliptrix\.env`，让 `desktop/ npm run dev` 意外开闸，直接违反 §2.13 / AC-29 |
| **D-08** | §2.4.5：「第 1–4 次失败返回 `attemptsLeft = 5 - n`；第 5 次起锁定 60s」；§6.4 #11：「破窗失败 5 次 → `local_admin_locked` 且 `lockedUntil` 有值」 | 第 5 次失败即返回 `local_admin_locked` + `lockedUntil`，并把 `attemptsLeft` 置 **0**（不是 `5-5=0` 之外的语义） | 两处措辞冲突：按 §2.4.5 第 5 次还应该「返回 attemptsLeft = 0 且已锁定」，按 §6.4 就必须已经是 `local_admin_locked`。取后者（更接近界面的可观测行为），并在测试里把 1–4 次与 5 次的返回码分别钉死 |
| **D-09** | §2.4.1 的 `AuthConfig` 字段表 | 追加两个**主进程内部**字段：`sessionTimeoutMs`（`/me/sessions` 超时）与 `gateDisabledByEnv`（是否由 `ECLIPTRIX_AUTH_GATE=off` 显式关闸） | `sessionTimeoutMs` 是 §2.4.4 方法表里已经用到的超时，原字段表漏了；`gateDisabledByEnv` 用来分开「dev 默认关闸（琥珀条）」与「运维显式关闸（红条）」，否则 dev 会同时显示红条与琥珀条（AC-19 与 AC-29 打架）。均不外泄给渲染进程 |
| **D-10** | §2.1.1 / AC-06：破窗登录「不产生任何 HTTP 请求」 | 破窗成功时**不发**任何 `/auth/*` 请求，但 `controller.start()` 仍会尝试一次 `client.meta()`（3s，失败即 `server: null`） | 闸门需要 `meta` 来渲染维护公告与最低版本；把 `meta` 也算进「破窗不联网」会连带丢掉这两条运维能力。`auth-smoke` #10 因此按「破窗动作本身 0 请求」断言（假服务器计数在破窗前后不变） |
| **D-11** | §3.1：`authBridge.js` 只写「10 个 `ipcMain.handle`」 | 另导出 `AUTH_CHANNELS` 常量，且 `openExternal` 的允许主机集合由 `index.js` 注入（= `authConfig.serverUrl` 的主机 + 三个产品域） | 白名单需要「当前账号服务器主机」，而 `authBridge` 不读配置（保持它「不实现业务」的定位）；注入让它与 `readAuthConfig` 的权威来源保持单一 |

### C. 渲染进程（`src/`）

| 编号 | 本文件 | 实际做法 | 原因 |
|---|---|---|---|
| **D-12** | §8.2 列出 `auth` 段 **65 键** | 实际 **84 键**（`Translations.auth`、`translations.en`、`translations['zh-CN']` 三处同批），并新增 `src/lib/__tests__/authI18nParity.test.ts` | §2.8 的硬要求里有 19 条文案在 65 键里没有落点：字段必填、口令不一致、条款未勾选、`weak_password` 的 `details.reasons[]`、CapsLock 提示、账号菜单标题、设备列表「无法连接，重试」、重置链接已发送／联系管理员、更新提示三段（当前/最低/下载）、通用重试、退出二次确认、账号中心不可用、离线「上次验证于」、破窗「本次会话不受服务端管辖」。AC-27 只要求三处**结构一致**，键数增加不影响；P6 那句「两处 i18n 字典键集合完全一致（有用例覆盖）」由这个用例承担（webserver 侧已有 `tests/unit/i18n.test.ts`） |
| **D-13** | §2.8：「只允许一处品牌强调色（与 `webserver/` 认证页同一个 `--accent` 语义），登录按钮就是它」 | 登录按钮用 `bg-primary`（`#0D99FF`），focus ring 仍用 `ring-accent/40`、hover 仍用 `accent` | 根项目的 `--accent` 是中性深灰 `#383838`，拿它当主按钮等于没有强调色；`--primary` 才是这套 token 里唯一的品牌蓝，与 webserver 认证页的观感一致。**语义仍是「全屏只有一处强调色」** |
| **D-14** | §2.8 / AC-04：「打开账号中心 → `{ACCOUNT_SERVER_URL}/account`」 | 渲染进程不持有 `accountServerUrl`（§4.6 明确它不下发），改为 `NEXT_PUBLIC_ACCOUNT_SERVER_URL`（可自建覆盖）→ 回退 `https://ecliptrix.app/account`；由 `auth:open-external` 的主机白名单兜底 | 把服务器地址塞进 `AuthStatus` 会破坏 §4.1 的字段契约，也把「渲染进程零外呼」的收益让掉一半。回退域名与 `openExternal` 白名单一致；断网或 `url_not_allowed` 时给内联提示与 supportEmail，而不是弹空白窗口（M17） |
| **D-15** | §2.8：「阻断屏给『查看日志目录』『重试』」 | 「查看日志」渲染为**可选中复制的路径文本**（`window.ecliptrixDesktop.logsPath`），不做 `file://` 链接 | §2.5 的白名单明确拒绝 `file://`；做成链接等于给渲染进程一条任意本地文件打开通道 |
| **D-16** | §2.12：退出登录前「若存在 flush 入口则 await 一次自动保存」 | `AccountMenu` 的退出流程 `await flushAllPending(3000)`（复用 `autosaveRegistry`），超时或失败都继续退出 | §2.12 的条件句在实现时有一个确定答案（入口存在），因此取「先 flush 再确认退出」，避免「确认了但改动没落盘」 |

### D. 门禁与既有基线（与实现无关，但影响 DoD 判定）

| 编号 | 现象 | 处置 |
|---|---|---|
| **D-17** | 根 `npm run lint`（`next lint`）**本来就不是 0**：10 条既有 Error（`AudioSearchModal` / `ImageSearchModal` / `VideoSearchModal` 的空接口、`WatermarkRemovalModal` 的未转义引号、`scriptSegmentAssociation.test.tsx` 的 `react/no-children-prop`）与上千条既有 warning（`no-explicit-any` 等），全部在本次未触碰的旧文件里 | **不在本轮修复**（要改 5 个与本特性无关的旧文件，违反「保持 diff 聚焦」）。验收口径改为：本轮新增/修改的 `src/**` 文件 **0 error、0 warning**（实测 `next lint` 输出里新增文件命中 0 行）；生产构建本来就把 ESLint Error 忽略（`next.config.js` 的 `eslint.ignoreDuringBuilds`），不影响打包 |
| **D-18** | **（本轮顺手修掉的 P0，不是本文件的设计范围）** 根 `tsconfig.json` 的 `include: ["**/*.ts", "**/*.tsx"]` 把 `webserver/**`（自带 tsconfig 与自己的 `@/*` 根）与 `backend-services/basic-service/data/ark-video-acceptance/**`（本仓库源码的验收副本）一起扫进来 → `npm run type-check` 恒有 1001 条 `TS2307 Cannot find module '@/server/…'`，而**根 `npm run build` 在 `Checking validity of types` 阶段直接失败**，`desktop/scripts/prepare-frontend.js` 又正是靠根 `npm run build` 打包桌面端 → R1 合入 `webserver/` 后，桌面安装包**打不出来** | 在根 `tsconfig.json` 的 `exclude` 增 `webserver` 与 `backend-services`（两行，无行为变更：`webserver` 用它自己的 `npm run type-check` / `npm run build` 验证）。结果：根 `npm run type-check` 由 1001 error 变 **0 error**、根 `npm run build` 恢复通过。这条既满足 DoD「项目仍能编译/启动」，也让 AC-25 的类型检查半边真正可核对 |

### E. 第 3 节点评审修复（R-01 … R-16，第 2 轮 · 迭代 2/3）

> 记账人：Senior Reviewer · 2026-10-08。规则同前：**先记账再改代码**。这一节记录评审对照本文件与真实工作树后**直接修在源码里**的 16 项缺陷，以及它们对本文件口径的影响。凡与上文冲突处，以本节为准。

| 编号 | 级别 | 问题（对照本文件／真实行为） | 修复 |
|---|---|---|---|
| **R-01** | P0 | **打包冒烟被自己的闸门打死**。`desktop/scripts/smoke-test.js` 用「全新 userData + 空 `.env` + 继承环境」拉起 exe，而 `auth.accountServerUrl` 缺省为空 → `decideStartup()` 第 2 行 `blocked / server-not-configured` → `SessionGate` 只渲染 `AuthBlocker` → 工作台永不挂载 → `until('editor workbench')` 60s 超时；`desktop/build.ps1` 默认执行它，即**发布门禁是红的**，而 §3.5 P5 只写了「扩展 smoke-test.js」没写它依赖闸门 | 子进程环境加 `ECLIPTRIX_AUTH_GATE: 'off'`（§2.13 的紧急阀正是为无账号服务器的跑批准备）；并在 `coverSmoke` 的 CDP 会话建立处加 3 条断言：preload `auth` 命名空间存在、`state='authenticated'/source='gate-disabled'`、`securityWarning='gate-disabled'` 且 `status` 文本不含 `accessToken`/`refreshToken`（AC-19 + AC-05 在打包产物内的可执行证明） |
| **R-02** | P1 | **心跳续期失败被当成「会话已被撤销」**，且会**删除 90 天刷新令牌**。`handleHeartbeatError()` 在 `session_expired` 分支 `try { rotateTokens() } catch { return EXPIRED }`——网络错误（`network_unreachable` / `request_timeout` / 5xx）也被吞成 `EXPIRED`，`decideStartup()` 把它翻译成 `unauthenticated / session-revoked`，`SESSION_CLEARING_REASONS` 于是 `clearSession()`——AC-09 的离线宽限被整条绕过（笔记本休眠过 12h 后唤醒、网络未就绪即触发） | catch 改为 `heartbeatStatusFor(err)` 按码分流：401/`unauthorized` → `revoked`（真被撤销，仍清会话），传输错误 → `network`（走宽限）。`desktop/main/authBridge.test.js` 加一条双向用例（网络失败保会话且刷新令牌不丢／401 真撤销才删文件），`npm run test:auth` 106 → **107** 条 |
| **R-03** | P1 | **`POST /auth/register` 的 desktop 分支少了 `refreshExpiresAt`**（以及对齐 login 的 `user` 四键），违反 §4.2「201 返回与登录同形的会话」。桌面端 login/register 共用 `sessionFromLogin()`，于是注册后的 `auth-session.json` 里 `refreshExpiresAt = null` → `graceDeadline()` 只受 `graceDays` 约束 → D2-08「宽限同时受刷新令牌寿命约束」在新注册会话上失效 | 路由内统一 `user` 形状（`avatarUrl`/`planTag`/`mustChangePassword`/`lastLoginAt`）+ 补 `refreshExpiresAt`；`tests/integration/desktop-login.test.ts` 加**逐键比对**（login 200 vs register 201，`data` 与 `data.user` 两级），防止再次漂移；`docs/api.md` 与 `docs/desktop-integration.md` 新增「2.1b 注册」契约段 |
| **R-04** | P1 | **随包 `.env` 让 `auth.offlineGraceDays` 永久失效**：`env.template.desktop` 写死 `ACCOUNT_OFFLINE_GRACE_DAYS=7`，而 `readAuthConfig()` 里 env 覆盖优先于 config（`envGrace !== ''` 即生效），于是用户按 `desktop/README.md` 把 `offlineGraceDays` 改成 3 或 30 **不生效** | 模板改为 `ACCOUNT_OFFLINE_GRACE_DAYS=`（留空 = 用配置文件），注释写明「写死数字以后配置文件就改不动了」；与上一行 `ACCOUNT_SERVER_URL=` 保持一致 |
| **R-05** | P1 | **两个错误码的界面文案走错分支**：① `toAuthFailure()` 把 `AuthBridgeUnavailableError` 降级成 `internal_error`，`bridge_unavailable` 的专用文案（`auth.error.bridgeUnavailable`）成了死文案；② `authErrorCopyKey()` 不看 `details`，`503 service_unavailable` 一律落到 `unknown`「操作失败，请重试」——维护公告的原文本可显示。此外注册失败码 `email_taken` / `username_taken` / `invite_*` / `registration_disabled` 无文案，邮箱被占用时只能显示通用错误 | `toAuthFailure` 单独保留 `bridge_unavailable`；`authErrorCopyKey(code, details?)` 按 `details.reason === 'maintenance'` 二选一（维护 / 按网络处理），五个表单统一传 `failure.details`；新增 5 个文案键（`emailTaken` / `usernameTaken` / `inviteRequired` / `inviteInvalid` / `registrationDisabled`）三处同批补齐 |
| **R-06** | P1 | **登录屏自锁 + 死按钮**：① `isClientOutdated()` 用 `status.appVersion \|\| '0.0.0'` 比较，`appVersion` 为空时把整个表单换成「需要更新」（而主进程 `compareVersions()` 对不可解析值返回 0、服务端对空 `clientVersion` 直接跳过闸门 → 只有渲染层在拦，且无路可走）；② `meta === null`（服务器不可达）时「忘记口令？」把 `view` 设为 `reset`，而 `!meta` 分支在 `view === 'reset'` 之前 → 按钮点了没反应 | 版本比较双侧都必须可解析才拦；`onForgot` 改为可选，`meta` 缺失时不渲染该按钮；`LoginScreen.test.tsx` 加 3 条（版本未知不自锁 / 无 meta 不给找回 / reduced-motion） |
| **R-07** | P1 | **28 处透明度写法在本仓库不生成任何 CSS**：主题色是 `var(--x)` 十六进制且无 `<alpha-value>`，`bg-destructive/10`、`ring-accent/40` 这类写法被 Tailwind 丢弃（`tailwind.config.js:86-96` 已写明并给了 `*-a` 别名，`src/styles/__tests__/themeTokens.test.ts` 还为此立了门禁，但只覆盖 timeline 与两个 dialog）。后果：登录屏的焦点环退回默认蓝、错误框没有红底——用户看到的第一个界面 | 新增 auth 组件统一改用 `-a` 别名（`ring-accent-a/40`、`bg-destructive-a/10`、`border-destructive-a/40`、`bg-muted-a/70`、`from-primary-a/30` …），共 28 处，覆盖 8 个文件 |
| **R-08** | P2 | **版本闸门的「配置写坏」分支没有信号**：D-06 承诺「`client.minVersion` 不可解析时跳过闸门并**日志 warn**」，实际只实现了跳过；`clientVersion` 不可解析同样静默放行（`isVersionOutdated()` 双侧 fail-open） | `assertClientSupported()` 两条 warn（设置侧 / 客户端侧），并在注释里写明这是「不猜语义」的 fail-open，格式校验由 `/admin/settings` 承担 |
| **R-09** | P2 | **控制台 `SessionDto` 类型镜像与真实响应漂移**：`src/lib/api/endpoints.ts` 缺 `appVersion` / `deviceKey` / `userAgent` / `createdAt` / `expiresAt`，`user-sessions-panel.tsx` 只好自建 `DeviceSessionRow` 并 `as` 强转，`admin/users/[id]/page.tsx` 还有一处 `toSessionDto(row) as SessionDto`——本轮新增的三列正是靠这层强转才能编译 | 补齐镜像类型（与 `server/db/types.ts` 的 `SessionDto` 逐字段一致），删除局部重声明与两处强转 |
| **R-10** | P2 | **新审计动作对用户隐身**：`auth.session_relogin` 不在 `auditRepo.SELF_VISIBLE_ACTIONS`，`activity-timeline.tsx` 也没有标签——用户被同设备顶号踢下线后，`/account` 的活动里看不到原因 | 加入白名单 + 中文标签「同设备重新登录」 |
| **R-11** | P2 | **`AuthReason` 联合不完整**：`toUiReason()` 还能产出 `invalid-credentials` / `rate-limited` / `weak-password` / `validation-failed` / `password-mismatch` / `registration-disabled` / `internal-error` 七个值，类型里没有；`AuthFailure` 也没声明主进程一直发的 `reason` 字段 | 联合补齐七个值 + `AuthFailure.reason?: AuthReason`（注释指明来源是 `toUiReason`） |
| **R-12** | P2 | **失败后按陈旧时间戳重算定时器**：`runTimer()` 失败 → `handleTimerFailure()`（仍 `authenticated / offline-cache`）→ `schedule()` 用已过期的 `expiresAt`/`lastVerifiedAt` 重算 → 被夹到 `MIN_TIMER_DELAY_MS = 1000` → **断网期间每秒一次真实 refresh 请求**（叠加请求超时与限流风险） | 失败后走固定 60s 退避（`FAILURE_RETRY_MS`），不再用会话自身的过期时间重算 |
| **R-13** | P2 | **防重入保护被显示成用户错误**：`pending` state 在同一次事件循环里是旧值，双击/长按 Enter 的第二发穿过首层判断后由 `SessionContext.pendingRef` 抛出 `AuthBusyError` → 五个表单都把它渲染成「操作失败，请重试」（红条 + 抢焦点） | 五个表单 `catch` 首行按 `code === 'auth_busy'` 静默返回（保护机制正常工作，不是失败） |
| **R-14** | P2 | **阻断屏的「查看日志」几乎不可能显示**：条件写成 `reason === 'bridge-unavailable' && path`，而 `path` 取自 `window.ecliptrixDesktop.logsPath`——preload 缺失时 `ecliptrixDesktop` 本体就不存在，`path` 必为空 → 分支永不渲染，且文案没有标签（D-15 只要求「可选中复制」） | 该分支改用兜底路径文本 `%APPDATA%\Ecliptrix\logs` + 标签「日志目录」（新增 i18n 键 `auth.logs`，三处同批），仍是可选中的文本、不是 `file://` 链接 |
| **R-15** | P2 | **文档与实现不符的五处**：① `CLAUDE.md` 首段仍说「shipped app has no in-process login」；② 同文件账号服务段的 `smoke.mjs` 仍写「52 assertions」；③ `desktop/README.md` 说日志在 `logs\auth.log`——`logger.js` 的 `CATEGORY_FILES` 没有 `auth`，实际落在 `main.log`；④ 同 README 说「`.env` 写 `ACCOUNT_SERVER_URL` 不会影响闸门」——打包版会读该文件且 **env 覆盖优先**；⑤ `desktop/README.md` 说改 `auth.offlineGraceDays` 生效（被 R-04 顶掉） | 五处逐条改写（首段改为「启动即进登录闸门」；52 → 62；日志改为 `main.log` 的 `[auth]` 类别；`.env` 优先级改为「打包版会覆盖、dev 不读、模板留空请保持留空」；宽限天数补覆盖优先级）；`CLAUDE.md` 同时把 `test:auth` 记数改为 107，并把 `.env`「主进程从不解析」的旧理由改为 D-07 的真实机制 |
| **R-16** | P2 | **§6.2 点名的两条渲染用例缺失**（注册视图开关、`prefers-reduced-motion` 不崩），以及本轮修掉的 R-06 无回归保护 | `LoginScreen.test.tsx` 从 6 条扩到 **11** 条：注册视图切换 + 邀请码字段按 `meta.inviteRequired` 出现/隐藏 + reduced-motion + 版本未知不自锁 + 无 meta 不提供找回 |

**对上游口径的影响**（凡下文与本表冲突，以本表数字为准）：

- AC-20：`npm run test:auth` **107** 条（原记 106，§6.5 的门槛仍是 ≥83）。
- AC-21：`npx vitest run src/components/auth src/contexts` **29** 条 / 5 文件（`authI18nParity` 一并跑时）。
- AC-23/AC-24：`smoke.mjs` 62、`auth-smoke.js` 14 不变。
- AC-19/AC-29：现在**在打包产物内有可执行断言**（R-01 的三条 CDP 检查），不再只靠手工清单 M16。
- D-13 的「focus ring 用 `ring-accent/40`」被 R-07 取代：实际是 `ring-accent-a/40`（同样的视觉语义，但只有 `-a` 别名在本题主题下真的生成 CSS）。
- `desktop/scripts/smoke-test.js` 的工作树里还夹带一处**与本特性无关**的「无凭证冒烟」改动（`withoutCredentialEnv()` + `/api/integrations` 前置断言 + `electron-env.js`/`electron-env.test.js`）。评审按要求**只提交与闸门相关的两处**（R-01 的环境变量与断言），其余保持未暂存。
