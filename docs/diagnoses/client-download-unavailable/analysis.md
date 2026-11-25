# 网页端「登录后下载客户端」通道从未存在：版本闸门把用户锁死在 404 上

> 诊断日期：2026-11-25（会话节点 #0，**只做定位与取证**）
> 范围声明：本节点不改产品代码、不执行 `git commit`。第 6 节是给修复节点的方案与
> 契约草案，落地留给 Subtask #1–#3。
> 复现脚本在 `evidence/`，端到端实测输出在 `evidence/*.txt`（本机已跑通，见第 2、7 节）。
>
> 阅读范围：`CLAUDE.md`（Account server / Desktop identity gate / Clean Code 约定）、
> `webserver/README.md`、`webserver/docs/api.md`、`webserver/docs/deployment-checklist.md`、
> `.claude-index/index.md`（Feature Map、Account server 一节）、
> `desktop/README.md` 与 `desktop/electron-builder.yml`。

---

## 1. 问题描述（Problem description）

### 1.1 用户这次要的东西

原始需求（`task-board.md` 的 Original Task）是给**网页子项目**（`webserver/`，即桌面端的
云端账号服务）加一条「客户端分发」链路，四条硬要求：

1. 用户可以登录以后，下载客户端；
2. 管理员可以上传软件包、发布软件包；
3. 软件包可以更新版本、回溯版本；
4. 没考虑到的由开发者补全。

### 1.2 实际状态：三个「下载」入口，没有一个能拿到安装包

产品里确实已经有三处**看起来是下载**的界面，实测全都不通：

| 入口 | 位置 | 期望 | 实际（本机实测） |
| --- | --- | --- | --- |
| 落地页首屏主按钮 “Download for desktop / 下载客户端” | `webserver/src/components/marketing/hero.tsx:29-35` | 开始下载安装包 | `href="/register"` → 跳到注册页（200） |
| 落地页底部 Windows / macOS 按钮 | `webserver/src/components/marketing/download-cta.tsx:19-33` | 分别下载对应平台安装包 | 两个按钮 `href="/register"`；第三个按钮标题是 `nav.docs`，`href="/legal/terms"` |
| 桌面端「需要更新客户端」阻断页的 “下载” 按钮 | `src/components/auth/AuthBlocker.tsx:53-55,90-94`、`src/components/auth/LoginScreen.tsx:132-134,152-165` | 打开下载页 | 打开 `{account-origin}/download` → **HTTP 404** |

服务端侧对应的探测（`evidence/route-probe.txt`，实测输出）：

```text
200  GET /
200  GET /#download
404  GET /download            <- 桌面端唯一的升级出路
404  GET /download/windows
200  GET /api/v1/meta
404  GET /api/v1/downloads
404  GET /api/v1/releases
404  GET /api/v1/admin/releases
200  GET /register
200  GET /login
```

#### 评审补注 R-1：证据链上三处必须修正/补强的引用

> 以下全部由评审节点（Subtask #1）逐行核对现行源码后写入，`path:line` 均为本机实测。

**(a) 阻断页不是「唯一按钮」，是「重试 + 下载」两颗；下载按钮只在 `client-outdated` 一种状态出现。**
`src/components/auth/AuthBlocker.tsx:86-95` 先渲染 `retry`，再条件渲染下载：

```tsx
86  <div className="mt-6 flex flex-wrap gap-2">
87    <button type="button" onClick={retry} className={PRIMARY_BUTTON}>
89    </button>
90    {reason === 'client-outdated' && (
91      <button type="button" onClick={openDownload} className={SECONDARY_BUTTON}>
92        {t.auth.maintenance.download}
93      </button>
94    )}
```

对结论无影响（`retry` 重试 426 仍是 426，不构成自救路径），但**这句描述必须修正**，
否则 Subtask #2 会去改 `maintenance` / `server-not-configured` 状态里根本不存在的下载按钮。
`maintenance` / `server-not-configured` 走的是 `LocalAdminForm`（`:104`），`bridge-unavailable`
走日志路径提示（`:97-102`）。

**(b) 版本闸门只作用于 `client === 'desktop'`，浏览器登录完全豁免——这是本方案能成立的地基。**

```ts
webserver/src/server/services/authService.ts:221-223
function assertClientSupported(input: GateInput): void {
  const clientVersion = (input.clientVersion ?? '').trim()
  if (input.client !== 'desktop' || clientVersion === '') return
```

浏览器登录走的是**同一条路由**（`webserver/src/app/api/v1/auth/login/route.ts:46-55` 把
`client` / `clientVersion` 原样透传），区别只在请求体：`loginSchema.client` 缺省为 `'web'`
（`webserver/src/server/validation/schemas.ts:69`；`registerSchema` 同，`:80`）。

既有测试已经把这条豁免钉成契约，可直接引用为反面证据：

```ts
webserver/tests/integration/desktop-login.test.ts:203-214
it('ignores the gate for browser clients and for clients without a version', async () => {
  setSettings({ 'client.minVersion': '99.0.0' })
  await expect(
    authService.login({ …, client: 'web', device: { …, appVersion: '' }, … }),
  ).resolves.toBeTruthy()
```

**为什么必须补上这一条**：R1 要求「登录后下载」，而下载页一旦要求登录，就必须存在一条
「426 锁死的用户仍能登录网页」的路径，否则 `/download` 会变成第二个死锁点。此条证明
该路径天然存在（web 登录不受闸门影响），因此 §6.6 的「未登录渲染登录引导而不是 302」
是安全的、不是自相矛盾的。原报告从未记录这一点，属于**评估方案可行性时缺失的关键证据**。

**(c) 闸门同样在 `register()` 上生效，新用户从旧安装包注册也一样死锁。**
`webserver/src/server/services/authService.ts:483` 是第二个调用点（`login()` 在 `:345`）。
影响：报第 4.1 节「新用户同样拿不到客户端」时，除了营销页问题，还有一条**从桌面端注册**
的路径（旧客户端 → 426 → 无账号也无安装包）。修复时 `/download` 必须允许未登录访问其登录引导页。

**(d) 桌面端没有任何自动更新能力，`/download` 是唯一升级路径（新增反证）。**
对 `desktop/` 全量 grep `electron-updater` / `latest.yml` / `checkForUpdates` 零命中，
`desktop/electron-builder.yml` 也没有 `publish` / `provider` 段。因此 §6.8 的
「P0 只要网页上线，存量安装立即自救」不是乐观估计，而是**唯一**可行的自救途径。

### 1.3 一句话结论

**这不是「下载失败」，而是「下载通道从未存在」。** 版本闸门（`client.minVersion` → HTTP 426）
**于 2026-11-08 随桌面端账号登录闸门一起上线**（`git log -S assertClientSupported` →
`e4763011`，距本诊断 17 天；原报告此处写「半年前」不实，已更正），它把「请升级到 x.y.z」这条**字符串**发给客户端；而升级所需的另一半
——制品存储、版本目录、发布/回溯动作、下载页——一个都没建。于是任何一次真实的版本闸门
启用，都会把整批用户钉在一个 404 页面上，**没有任何应用内或站点内的自救路径**。

> 实测链路：把 `client.minVersion` 设为 `9.9.9` 后，桌面端 `1.0.1` 登录得到
> `426 client_outdated / details={minVersion:"9.9.9"}`；阻断页唯一的按钮打开
> `GET /download` → `404`。原始报文见 `evidence/lockout-chain.txt`。

---

## 2. 复现步骤（Reproduction steps）

三条复现路径，按成本从低到高。前两条**不需要桌面端**，任何人可以照抄执行。

### 2.1 前置：把账号服务器跑起来

```bat
cd M:\takoAI\Ecliptrix\webserver
npm install
npm run dev
```

已知坑（本机踩到，与本次缺陷无关但会浪费半小时）：
**如果当前 shell 的环境变量里已有 `NODE_ENV=production`，`npm run dev` 会在 Edge
middleware 阶段抛 `EvalError: Code generation from strings disallowed for this context`，
所有页面变 500。** `webserver/.env` 里的 `NODE_ENV=development` 不会覆盖已存在的进程
环境变量，必须显式清掉或改写：

```bat
set NODE_ENV=development&& npm run dev
```

验证服务已就绪：

```bat
curl -s -o NUL -w "%{http_code}\n" http://127.0.0.1:8787/
```

预期 `200`。

### 2.2 静态复现：下载通道不存在（30 秒）

```bat
curl -s -o NUL -w "GET /download -> %{http_code}\n" http://127.0.0.1:8787/download
curl -s -o NUL -w "GET /api/v1/releases -> %{http_code}\n" http://127.0.0.1:8787/api/v1/releases
curl -s -o NUL -w "GET /api/v1/admin/releases -> %{http_code}\n" http://127.0.0.1:8787/api/v1/admin/releases
```

实测（`evidence/route-probe.txt`）：

```text
GET /download -> 404
GET /api/v1/releases -> 404
GET /api/v1/admin/releases -> 404
```

一条命令复跑全部探测（含落地页下载区块抓取与 `/api/v1/meta` 快照）：

```bat
python docs/diagnoses/client-download-unavailable/evidence/collect-probe.py
```

### 2.3 端到端复现：426 → 唯一的出路是 404（2 分钟）

脚本会读取 `webserver/.env` 里的 root admin 凭据（**不打印**），临时把
`client.minVersion` 调到 `9.9.9`，做一次桌面端登录，探测阻断页要打开的 URL，
最后在 `finally` 里把设置**恢复原值**（本机实测恢复为 `''`）：

```bat
python docs/diagnoses/client-download-unavailable/evidence/repro-426-then-404.py
```

实测输出（`evidence/lockout-chain.txt`，节选）：

```text
200  POST /api/v1/auth/login (desktop, root admin)
      previous client.minVersion = ''
200  PATCH /api/v1/admin/settings client.minVersion=9.9.9

426  POST /api/v1/auth/login (desktop 1.0.1) -> the lock-out
{
  "success": false,
  "message": "客户端版本过低，请升级到 9.9.9 或更高版本",
  "error_code": "client_outdated",
  "error_details": { "minVersion": "9.9.9" },
  "error": { "code": "client_outdated", "message": "...", "details": { "minVersion": "9.9.9" } }
}

404  GET /download  <- what AuthBlocker opens (clientDownloadUrl())
200  PATCH /api/v1/admin/settings restored to ''
```

注意报文里**只有 `minVersion`，没有 `downloadUrl`**，也没有「最新版本」「发布日期」
「安装包大小」「校验和」。客户端除了一句「请升级到 9.9.9」之外拿不到任何可执行信息。

### 2.4 桌面端视角（可选，需要打包产物）

1. `cd desktop && npm run build`，装出 `release/Ecliptrix-Setup-1.0.1.exe`（`desktop/package.json:3`
   的 `version` 就是这个号；产物命名见 `desktop/electron-builder.yml:87`）。
2. 安装并启动，登录成功后退出；在账号服务端把 `client.minVersion` 设成 `9.9.9`
   （控制台 `/admin/settings`，或第 2.3 节的脚本）。
3. 重启桌面端：进入 `需要更新客户端 / 当前版本 1.0.1 / 最低版本 9.9.9` 阻断页
   （`AuthBlocker`，拷自 `src/lib/i18n.ts:13584-13588`）。
4. 点「下载」：系统浏览器打开 `{account-origin}/download` → **404 页面**。
   如果该 origin 不在桌面端的外部链接白名单里，则**什么都不会发生**（连报错都没有），
   见 3.2 的静默失败一节。

### 2.5 反向验证：为什么日常没人发现

- `client.minVersion` 的出厂默认值是空字符串（`webserver/src/server/services/settingsService.ts:90`），
  空值意味着闸门**完全不生效**（`authService.ts:225`）。开发环境从不配它，所以 426 这条
  分支在日常里根本不触发。
- 落地页的三个按钮都指向 `/register`，而 `/register` 返回 **200**。从「页面能点开、
  不报错」的角度看，一切正常；只有真要下载的人才会发现是在注册。
- 因此缺陷只在「运维真的设了 `client.minVersion`」时暴露——而那时暴露给用户的方式
  是**登录不进去**，不是「下载按钮不好用」。

---

## 3. 根因分析（Root cause analysis）

四个独立缺陷，D1 是主体，D2/D3/D4 让它在每个方向上都无路可逃。

### 3.1 D1（P1，主体）：账号服务器里没有「发布目录」这个概念

把一条客户端分发链路需要的东西逐项对照仓库现状（`git ls-files webserver` 全量清单 +
迁移文件 + 路由目录）：

| 分发链路的必备件 | 现状 | 证据 |
| --- | --- | --- |
| 制品存储目录 | 不存在。`webserver/public/` 只有一个 `.gitkeep` | `webserver/public/.gitkeep` |
| 制品元数据表（版本/平台/大小/sha256/说明/发布时间） | **没有**。5 个迁移里 16 个 `CREATE TABLE`（15 张业务表 + `schema_migrations`），全是身份/审计/邮件类 | `webserver/src/server/db/migrations/000{1..5}_*.sql` 的 `CREATE TABLE` |
| 仓储层 | 无 `releasesRepo`（`server/db/repositories/` 12 个文件） | `webserver/src/server/db/repositories/` |
| 服务层 | 无 `releaseService`（`server/services/` 17 个文件） | `webserver/src/server/services/` |
| 公共读取端点（最新版本/清单） | 无。`/api/v1/meta` 只吐 `minClientVersion`，不含最新版本、不含下载地址 | `webserver/src/app/api/v1/meta/route.ts:11`；`settingsService.ts:248-282` |
| 制品下载端点（含 Range） | 无 | `evidence/route-probe.txt` 的两个 404 |
| 管理端上传/发布/回溯端点 | 无 | 同上；`docs/api.md` 全文无 download/release 端点 |
| 管理端页面 | 无 `/admin/releases`（`(console)/admin/` 下只有 audit/forbidden/invites/mail/roles/sessions/settings/users） | `webserver/src/app/(console)/admin/` |
| 权限点 | 无 `releases.read` / `releases.write`；权限目录只有 users/sessions/invites/audit/settings | `webserver/src/lib/permissionsCatalog.ts:18-23`、`webserver/src/server/auth/permissions.ts:12-17,73-83` |
| 公开下载页 | 无 `/download` 路由（`app/` 下只有 marketing / legal / auth / console / api） | `webserver/src/app/sitemap.ts:7-13` 也没有它 |

**所以「管理员上传软件包、发布、回溯版本」在本仓库里不是「有 BUG」，而是「零实现」。**
落地页上的 `DownloadCta` 因此只能拿注册页当占位符
（`webserver/src/components/marketing/download-cta.tsx:19-41`），这在代码注释里也没有被
标成 TODO——说明它在设计阶段就被当成了「营销区的按钮」，而不是「分发链路的入口」。

### 3.2 D2（P1）：`clientDownloadUrl()` 绕开运行时 origin，并硬编码厂商域名

桌面端阻断页唯一的出路是这一行（`src/lib/api/authBridge.ts:687-691`）：

```ts
/** `/download` on the account service — the "client too old" escape hatch. */
export function clientDownloadUrl(): string {
  const origin = accountServiceOrigin(null);          // ← 注意这个 null
  return origin ? `${origin}/download` : 'https://ecliptrix.app/download';
}
```

与它的兄弟函数对照（`src/lib/api/authBridge.ts:682-685`）：

```ts
export function accountCenterUrl(runtimeBaseUrl?: string | null): string | null {
  const origin = accountServiceOrigin(runtimeBaseUrl);   // ← 接收运行时地址
  return origin ? `${origin}/account` : null;
}
```

而同一个文件在 `:634-651` 明写了这条铁律（R.3，注释原文）：

> 1. the RUNTIME address the main process actually connected to (`status.server.baseUrl`)
>    — authoritative for a self-hosted instance;
> 2. the build-time `NEXT_PUBLIC_ACCOUNT_SERVER_URL`, ...
> 3. nothing — the helper answers `null` and the caller disables the button instead of
>    silently navigating to the vendor's site.
> **Rule 3 is the important one: a build-time default of `https://ecliptrix.app` used to
> send a self-hosted user to a domain that is not theirs, which is a phishing-shaped bug.**

`clientDownloadUrl()` 把三条全违反了：传 `null` 丢掉运行时 origin、兜底写死
`https://ecliptrix.app/download`、失败时不返回 `null` 而是强行给一个 URL。后果：

- **自建部署的用户**（运行时 origin 是 `https://id.example.com`）被送到
  `https://ecliptrix.app/download`——一个不属于他的域名（正是 R.3 想消灭的那类缺陷，
  只是当时只修了 `/account`，没修 `/download`）。
- 该按钮的点击链路是 `openExternal(clientDownloadUrl()).catch(() => {})`
  （`AuthBlocker.tsx:53-55`、`LoginScreen.tsx:132-134`）。主进程的白名单是
  `EXTERNAL_HOST_ALLOWLIST = ['id.ecliptrix.app','ecliptrix.app','www.ecliptrix.app']` +
  运行时服务端主机（`desktop/main/authBridge.js:54,86-92`）；不匹配时**返回**
  `{ ok:false, code:'url_not_allowed' }`（`authBridge.js:218-228`）而不是抛异常，
  于是 `.catch(() => {})` 抓不到它：**按钮点了毫无反应，也没有任何提示**。
- 即使用户被送到了正确 origin，那个地址也不存在（D1），得到 404。

一句话：这个「逃逸舱口」在自建部署上指向别人的域名，在本站上是 404，在白名单外是静默无响应。

#### 评审补注 R-2：D2 的「静默」从推断升级为代码链证明，并修正两处引用

**(a) 引用名错了：源码里这条规则叫 “Rule 3 / spec §3.7 / P1-8”，不叫 “R.3”。**
`src/lib/api/authBridge.ts:634-648` 的原文是：

```ts
 * Order of preference (spec §3.7 / P1-8):
 *  1. the RUNTIME address the main process actually connected to
 *  2. the build-time `NEXT_PUBLIC_ACCOUNT_SERVER_URL`
 *  3. nothing — the helper answers `null` ...
 * Rule 3 is the important one: a build-time default of `https://ecliptrix.app`
 * used to send a self-hosted user to a domain that is not theirs ...
```

`docs/plans/desktop-account-login-gate/spec.md` 的 `### R.3` 是另一节（P2 记录在案表），
不含任何 origin 优先级内容。Subtask #2 按 "R.3" 去 spec 里找会找不到，**引用必须改成
「Rule 3（§3.7 / P1-8）」**。CLAUDE.md 里说的「R.1 block（the four P0s）」才是 spec 的小节号。

**(b) `.catch(() => {})` 之所以抓不到白名单拒绝，是一条完整的三段链，逐段有代码：**

```js
// 1. 主进程：拒绝时 RETURN 一个失败信封，不抛
desktop/main/authBridge.js:218-228
if (!isAllowedExternal(target, allowedHosts)) {
  return { ok: false, code: 'url_not_allowed', message: '该链接不在允许的域名列表内' }
```
```ts
// 2. 预加载：IPC 原样返回该信封
desktop/preload/preload.js:52   openExternal: (url) => ipcRenderer.invoke('auth:open-external', url)
```
```ts
// 3. 渲染层封装：把这个信封重新抛成异常（注意：抛的是普通对象，不是 Error）
src/lib/api/authBridge.ts:324-327, 413-414
function unwrapOk(value: { ok: true } | AuthFailure): { ok: true } {
  if (isAuthFailure(value)) throw value;
  return value;
}
export async function bridgeOpenExternal(url: string): Promise<{ ok: true }> {
  return unwrapOk(await requireBridge().openExternal(url));
}
```

于是 `AuthBlocker.tsx:53-55` / `LoginScreen.tsx:132-134` 的
`openExternal(...).catch(() => {})` **必然**吞掉 `url_not_allowed` 与 `bridge_unavailable`：
抛出的对象不是 `Error`，没有任何全局兜底会打印它，用户界面里没有 toast、没有 inline 错误。
这就是「点了毫无反应」的机制级证明（原报告是推断，未给链）。

**修复要求（后续节点硬约束）**：`.catch(() => {})` 改为检查失败并落到可见反馈；
并且因为抛的是**普通对象**，`error instanceof Error` 判断会漏，必须用
`isAuthFailure(error)`（`authBridge.ts:335-339`）判定。这一条原报告未写，是易漏点。

**(c) 白名单本身是「厂商三域名 + 运行时主机」，所以两条错路都能打开，只是目的地不对。**
`desktop/main/authBridge.js:54` 的 `EXTERNAL_HOST_ALLOWLIST` 含 `ecliptrix.app`，
因此硬编码兜底在**白名单内**——它不会静默失败，会真的把自建用户送到厂商域名。
「静默」只发生在**自建 origin 不在白名单**的场景。这两件事必须分开描述，
否则会误判成「反正点不动，风险低」，而实际风险最高的一档恰恰是「能打开别人的站点」。

### 3.3 D3（P2）：版本闸门和「发布」这件事在系统里毫无耦合

- 闸门只发版本号：`webserver/src/server/http/errors.ts:88-98`（`details: { minVersion }`）。
  注释自己写着「`minVersion` travels in `details` so the client can say "update to x.y.z"」
  ——设计意图就此止步于「说出版本号」，没有任何「去哪儿拿」。
- 闸门设置在控制台是一个自由文本输入框（`webserver/src/components/console/settings-form.tsx:59-93`），
  只校验 `x.y.z` 形状；填一个从未发布过的号（例如 `9.9.9`）不会有任何阻拦，
  界面只是弹一句警告 `admin.settings.minVersion.risk`（`webserver/src/lib/i18n.ts:819-820`）：
  「a value above the released build locks every older client out — make sure that release is out first」。
  **「that release is out」这件事，系统内部没有任何事实来源可供比对。**
- 交付检查表用人工步骤补这个洞（`webserver/docs/deployment-checklist.md:92-96`）：
  「`client.minVersion` is **empty or equal to the released build**」——靠人记。
- 运营侧同样没有事实来源：部署清单、`README` 都没有一处写明安装包放在哪里、
  用户该从哪里装（`webserver/docs/api.md` 与 `deployment-checklist.md` 全文无
  download/release/installer 相关端点或步骤）。

#### 评审补注 R-3：`publicBaseUrl` 已存在且是必需项——R12 无需新配置，但**禁止**用 Host 头拼

原报告 §6.3 写「`downloadUrl` 由 `PUBLIC_BASE_URL` 拼」，方向正确，但没给事实来源。
逐行核对后可以确认它**已经是必需的、已被邮件链路使用的**配置项，落地成本为零：

```ts
webserver/src/server/config.ts:52-54
PUBLIC_BASE_URL: z
  .string()
  .min(1, 'PUBLIC_BASE_URL is required (e.g. https://id.example.com)')
```
```ts
webserver/src/server/config.ts:168      publicBaseUrl: value.PUBLIC_BASE_URL,
```

既有使用者（说明它已经是「对外绝对地址」的唯一来源）：

| 位置 | 用途 |
| --- | --- |
| `webserver/src/server/mail/links.ts:6-17` | 所有邮件链接，`function base() { return getConfig().publicBaseUrl }` |
| `webserver/src/app/sitemap.ts:5` | `process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:8787'` |
| `webserver/src/app/robots.ts:5` | 同上 |
| `webserver/src/app/layout.tsx:19` | metadata 的绝对 origin |

`mail/links.ts:6-8` 的注释正是这条铁律，**426 报文的 `downloadUrl` 必须照抄**：

> Every one is built from `PUBLIC_BASE_URL` in configuration, never from a
> request header: a `Host` header is caller-controlled, and a mailed link that
> points at the caller's own domain is a phishing primitive.

→ 同一类缺陷（把 caller-controlled 的东西写进给用户的绝对地址）如果出现在
`clientOutdated(minVersion, downloadUrl)` 里，就是把服务端刚修好的洞在桌面端重开一次。

**另一处必须避坑**：`publicMeta()` 里已经有一个 `version` 字段，
但它不是客户端版本：

```ts
webserver/src/server/services/settingsService.ts:273
version: process.env.npm_package_version ?? '0.1.0',
```

这是**账号服务器自己**的 npm 版本。新增字段必须用不会与之混淆的名字
（建议 `latestClientVersion` + `downloadPath`），并且 `/download` 页**不得**把
`version` 当客户端版本渲染——否则会出现「页面显示 0.1.0，安装包是 1.0.2」的新缺陷。

### 3.4 D4（P2）：营销页把「下载」实现成「注册」，并且谎报平台

- 首屏主按钮文案是 `hero.ctaPrimary = 'Download for desktop' / '下载客户端'`
  （`webserver/src/lib/i18n.ts:495,62`），`href` 却是 `/register`（`hero.tsx:30-35`）。
- 下载区块同时给出 Windows **和 macOS** 两个按钮（`download-cta.tsx:19-33`），
  副标题写的是 `hero.note = 'Windows and macOS · runs locally · …'`（`i18n.ts:497`；
  中文 `i18n.ts:64`）。但桌面端**只产出 Windows x64 NSIS 安装包**
  （`desktop/electron-builder.yml:63-74` 只有 `win.target: nsis / x64`；
  `desktop/package.json:5` 的项目描述就是 "Windows packaging scripts"；
  `src/components/auth/AuthBlocker.tsx:30-36` 的注释也写着 "Windows only: the app has no
  other target"）。
- 也就是说：这套 UI 承诺了两个平台，其中一个是**不存在的产物**；而因为没有任何
  发布目录，“到底有哪些平台的哪个版本”这个问题在系统里根本没有答案。

### 3.5 为什么测试没拦住：既有测试断言的正是这个残缺契约

`webserver/tests/integration/desktop-login.test.ts:175-186`：

```ts
it('refuses an outdated desktop client with 426 and the version to reach', async () => {
  setSettings({ 'client.minVersion': '1.4.0' })
  const error = await desktopLogin(DEVICE_KEY, '1.3.9').catch((thrown) => thrown)
  expect(error).toMatchObject({
    code: 'client_outdated',
    status: 426,
    details: { minVersion: '1.4.0' },   // ← 把“只带版本号”钉成了契约
  })
})
```

`toMatchObject` 只做子集匹配，所以**新增 `downloadUrl` 字段不会让它挂**；但也没有任何测试
问过「这个版本号对应的安装包在哪儿」。加上 `/download` 从来不是任何测试的目标
（`webserver/tests/` 28 个文件无 download/release 用例），这条链路在测试层面是完全透明的。

> 与黑板上 F-3（`ttsTools.errorPropagation.test.ts` 把「错误默认音色」钉成契约）是同一类
> 问题：**测试巩固了缺陷，而不只是没发现缺陷。** 修复时这两个断言要一起改。

#### 评审补注 R-4：权限点不是「加两处」，是**加五处**；而且种子不会把新权限发给既有 admin

原报告 §6.5 说「权限点加进**两处**目录+种子」，漏了三处，其中一处会让线上管理员在发版后
直接 403。逐行核对如下：

**(a) 前端目录与服务端目录之间存在强制对等测试**（漏了会红）

```ts
webserver/tests/unit/catalog.test.ts:38-46
it('lists exactly the permissions the server knows', () => {
  expect([...FRONTEND_PERMISSIONS].sort()).toEqual([...SERVER_PERMISSIONS].sort())
})
it('groups them the same way', () => { … expect(FRONTEND_GROUPS[group], …).toEqual([...PERMISSION_GROUPS[group]]) })
```
→ 必须同时改 `webserver/src/lib/permissionsCatalog.ts:17-24` 与
`webserver/src/server/auth/permissions.ts:11-18`，且**分组名也要一致**。

**(b) i18n 标签同样是测试强制的第三处**

```ts
webserver/tests/unit/catalog.test.ts:48-60
for (const permission of FRONTEND_PERMISSIONS) {
  const label = permissionLabel(permission, locale)
  expect(label, `${locale} label for ${permission}`).not.toBe(permission)
```
`permissionLabel` 在查不到 `permissions.<key>` 时**回退成 key 本身**
（`webserver/src/lib/permissionsCatalog.ts:44-48`），所以少一个标签 = 断言失败。
必须新增 `permissions.releases.read` / `permissions.releases.write` /
`permissions.group.releases`，中英**各一份**（`webserver/src/lib/i18n.ts`），
而 `webserver/tests/unit/i18n.test.ts:13` 的 `expect(en).toEqual(zh)` 又要求两份键集完全相同。

**(c) 角色默认值若写了不存在的键，测试也拦**

```ts
webserver/tests/unit/catalog.test.ts:68-74   // 'grants only permissions that exist'
expect(isKnownPermission(permission), `${permission} is unknown`).toBe(true)
```

**(d) 最危险的一处：`seedRoles()` 对**既有**角色是空操作——新权限不会自动发给 admin。**

```ts
webserver/src/server/db/seed.ts:20-26
/**
 * Create the four system roles and their permission sets.
 *
 * Existing roles keep their permissions — an operator who stripped
 * `users.delete` from `admin` must not get it back because the service
 * restarted.
 */
webserver/src/server/db/seed.ts:33-44
if (!existing) { rolesRepo.create(db, { …, permissions: SYSTEM_ROLE_PERMISSIONS[key], now }); continue }
```
唯一的例外是 owner（`seed.ts:51-54` 把 owner 强制回 `['*']`）。

**后果**：在**已有部署**上升级后，`SYSTEM_ROLE_PERMISSIONS.admin` 里新加的
`releases.write` 只影响「此后新建的 admin 角色」；既有 admin 账号调用
`POST /api/v1/admin/releases` 会一直 403，而开发机上（新库）一切正常——
典型的「本地绿、线上红」。原报告的四阶段计划里没有任何一步覆盖它。

**修复要求（写进 Subtask #2 的验收）**：迁移 `0006` 里对 `role_permissions` 做**幂等 INSERT**
（`INSERT OR IGNORE INTO role_permissions … SELECT … FROM roles WHERE key IN ('admin','support')`
—— `support` 只给 `releases.read`），并且**只在缺失时插入**，从而既满足
「既有角色不被重置」，又满足「升级后权限可用」。注意 `0001_init.sql:28` 的表名是
`role_permissions`，写入只能走这一个幂等通道，不能在启动时删改角色权限。

**(e) 另外两个被漏掉的既有事实，会直接影响 `/admin/releases` 的写法**

| 事实 | 位置 | 为什么重要 |
| --- | --- | --- |
| 控制台已有 `metricsService.overview()` 与 `/api/v1/admin/metrics` | `webserver/src/server/services/metricsService.ts:161`、`webserver/src/app/api/v1/admin/metrics/route.ts:14`、`webserver/docs/api.md:362,532` | R9（下载计数）不是新设施，是给既有 overview 加两条序列 |
| 控制台页面全部 `export const dynamic = 'force-dynamic'` + 二次 `can()` 校验 | `webserver/src/app/(console)/admin/page.tsx:21,27-30` | `/admin/releases` 必须照抄这两条：layout 不是安全边界 |
| 已有 `Content-Disposition` 的写法可复用（但**不是**流式） | `webserver/src/app/api/v1/me/export/route.ts:41-43` | 只能抄头，不能抄「先拼字符串再返回」——安装包 188 MB 级 |

#### 评审补注 R-4b：`webserver/` 内**不存在**任何 `Range` 实现——R14 是从零开始，不是复用

对 `webserver/src` 全量 grep `createReadStream` / `Accept-Ranges` / `Content-Range` / `206`
**零命中**。这意味着：

- §6.4 陷阱三（`Range` 支持）不是「注意一下」，而是本仓库**第一次**写流式下载；
- 「已有 109 条 smoke 断言」不含任何大文件用例，`npm test` 也不会替你验证 `206`；
- 因此 §6.9 的验收必须真的发一次 `Range: bytes=0-1023` 并断言 `206 + Content-Range`
  **以及**越界时的 `416`（原报告只写了 206）。

### 3.6 因果链

```text
运营要给全量用户强制升级
   └─ 控制台填 client.minVersion = 1.2.0        （无任何“该版本是否已发布”校验，D3）
        └─ 旧客户端登录 → 426 client_outdated    （只带 minVersion，无下载地址，D3）
             └─ 桌面端阻断页/登录页只有一个按钮   （openExternal(clientDownloadUrl())，D2）
                  ├─ 自建部署 → 打开厂商域名 …/download   （Rule 3 已明令禁止的回退，D2）
                  │     └─ 不是该用户的站点；白名单外则静默无响应
                  └─ 本站 → GET /download              （路由不存在，D1）
                        └─ 404 页面
                              └─ 用户：登录不进去，也没有任何地方能拿到新版本
                                    └─ 只能靠支持人员手工发安装包（无校验和、无版本记录）
营销页访客
   └─ “Download for desktop” → /register           （下载被实现成注册，D4）
        └─ 注册成功后仍然找不到安装包（D1）        （macOS 按钮承诺不存在的产物，D4）
```

### 3.7 根因陈述

**根因：客户端分发只实现了「拒绝」，没有实现「给予」。**
版本闸门（`authService.assertClientSupported` + `426 client_outdated`）是一个完整的、
经过测试的**准入控制**；但它依赖的**分发面**——制品存储、版本目录、发布/回溯动作、
下载页、以及客户端可解析的下载地址——在 `webserver/` 与桌面端两侧都不存在。
其中 D1 是「整块功能缺失」，D2/D3/D4 是把缺失放大成「用户无法自救 + 平台能力被谎报 +
自建部署被导向他人域名」的三处实现缺陷。

三条硬证据（非推测）：

1. 端到端实测：`426 → GET /download → 404`（`evidence/lockout-chain.txt`）；
2. 代码事实：`clientDownloadUrl()` 传 `null` 进 `accountServiceOrigin`，并兜底硬编码
   `https://ecliptrix.app/download`（`src/lib/api/authBridge.ts:687-691`），与同文件
   `:634-651` 的 R.3 铁律直接冲突；
3. 结构事实：16 个 `CREATE TABLE`（15 张业务表）、47 个 API 路由、22 个页面里没有任何与
   「制品/版本/发布」相关的实体或端点（`webserver/src/server/db/migrations/`、
   `webserver/src/app/api/v1/`、`git ls-files webserver`）。

---

## 4. 影响面（Impact surface）

### 4.1 用户（P1，阻断级）

- **一旦启用版本闸门，全部旧客户端的用户 100% 被锁死**：登录返回 426，唯一的
  「下载」按钮打不开任何东西（404 或静默无响应），离线宽限期结束后连应用都进不去。
  这不是「某个功能不好用」，而是**整个产品对该用户不可用**。
- 新用户同样拿不到客户端：落地页承诺下载，实际把人送去注册，注册完成后仍然没有安装包。
- 无自助能力：FAQ 里没有任何「去哪里下载最新版」的答案
  （`webserver/src/lib/i18n.ts:534-546` 六条问答全都与下载无关）。

### 4.2 运维 / 交付（P1）

- 每一次发版都要人工把安装包通过 IM/网盘发给用户；没有版本记录、没有下载计数、
  没有「现在对外的是哪一版」的单一事实来源。
- 无法回溯：用户装了坏版本，运维没有「把当前版本指回上一版」的原子动作，
  只能再手工发一个包并祈祷没人装错。
- 无法校验完整性：构建脚本其实**已经算过 sha256**（`desktop/scripts/build.js:389-401`，
  `install-record.json` 里也有 `installer_sha256`，见 `desktop/README.md:412`），
  但这个值发不出去，用户下载后无从验证。
- 回滚与闸门联动全靠记忆：`deployment-checklist.md:92-96` 是人工清单。

### 4.3 安全（P1，D2 单独成立）

- 自建部署的用户被 `clientDownloadUrl()` 送到 `https://ecliptrix.app/download`——
  正是 R.3 明令禁止的「把自建用户送到不是他的域名」。一旦有第三方把该域名下的
  同名路径做成恶意安装包，就是一条**可被利用的投毒路径**（用户在此情境下已经
  被逼到只有这一个按钮可点）。
- 没有校验和、没有签名验证说明，安装包的真伪只能靠 HTTPS 与信任。

### 4.4 增长 / 转化（P2）

- 落地页最关键的那颗按钮是假的：`Download → /register →（无产物）`，
  漏斗在最后一步断掉，而且用户拿不到任何解释。
- macOS 按钮承诺一个从不存在的产物（`electron-builder.yml` 只出 `win nsis x64`），
  属于欺骗性可用性（deceptive affordance）。

### 4.5 严重度与触发条件

| 缺陷 | 严重度 | 触发条件 | 影响比例 |
| --- | --- | --- | --- |
| D1 无分发通道 | **P1** | 任一部署把 `client.minVersion` 设为非空 | 该部署 100% 的旧客户端用户 |
| D2 下载地址错/静默 | **P1** | 自建部署（运行时 origin ≠ 构建时 origin），或 host 不在白名单 | 全部自建部署用户 |
| D3 闸门与发布脱钩 | P2 | 每次发版 / 每次改 `client.minVersion` | 运维与全量用户（间接） |
| D4 营销页占位与平台谎报 | P2 | 任何访客 | 全部访客；macOS 用户被误导 |

---

## 5. 候选修复方案（Candidate fixes）

### 5.1 需求覆盖矩阵

用户给的 4 条 + 我认为必须补的 12 条（第 4 条「还有我没考虑到的」就是这些）：

| # | 需求 | 来源 |
| --- | --- | --- |
| R1 | 登录后下载客户端（带鉴权，不公开直链） | 用户 |
| R2 | 管理员上传软件包 | 用户 |
| R3 | 管理员发布软件包（对外可见） | 用户 |
| R4 | 版本更新（新版本取代当前版本） | 用户 |
| R5 | 版本回溯（把当前版本指回上一版，历史不丢） | 用户 |
| R6 | 制品完整性：大小 + SHA-256 对外可见 | 补全 |
| R7 | 发布说明（Release notes）与发布日期 | 补全 |
| R8 | 平台/架构矩阵（当前只有 win-x64；不能再谎报 macOS） | 补全 |
| R9 | 下载次数统计（每版本），进现有 `/admin/metrics` | 补全 |
| R10 | 撤回发布（unpublish）与删除（软删，不留孤儿文件） | 补全 |
| R11 | 与 `client.minVersion` 联动校验：闸门不得高于最新已发布版本 | 补全 |
| R12 | 426 报文带可解析的下载地址（`details.downloadUrl`） | 补全 |
| R13 | 桌面端 `clientDownloadUrl` 遵循 R.3（运行时 origin 优先、不回落厂商域名） | 补全 |
| R14 | 大文件可靠性：流式上传、断点续传/`Range` 下载、nginx 体积上限 | 补全 |
| R15 | 审计：上传/发布/回溯/撤回全部落 `audit_events` | 补全 |
| R16 | 单实例 SQLite 下的并发安全（只允许一个制品指针写入） | 补全 |

### 5.2 方案对比

| 方案 | 做法 | 改动面 | 覆盖 R1–R16 | 风险 | 工作量 |
| --- | --- | --- | --- | --- | --- |
| **A. 静态托管** | 把 `Ecliptrix-Setup-*.exe` 放进 `public/download/`（或 nginx 静态目录），按钮直接链过去 | 2 个文件 | 仅 R2/R3 的「手工拷贝版」；R1/R5/R6/R9/R11–R15 全无 | 低 | 0.5 天 |
| **B. 发布目录（DB + API + 页面 + 控制台）** | 新增 `client_releases` 表与仓储/服务、公共下载页、流式下载端点、管理端上传/发布/回溯、权限点、审计、指标，并修桌面端两处 | ~22 个文件（`webserver/` 16 + 根项目 3 + 文档 3） | R1–R16 全覆盖 | 中（见 6.x 的四个陷阱） | 3–5 天 |
| **C. 清单文件 + CLI** | 制品落盘 + `data/releases.json` 清单，`npm run release:publish` 写清单并原子 rename；页面读清单；控制台只读 | ~9 个文件 | R1/R4/R5/R6/R7/R8/R10/R14/R16 可实现；**R2/R3 没有网页入口**（与用户要求冲突）、R9/R11/R15 弱 | 低–中（无 DB 事务，靠原子 rename） | 2 天 |
| **D. `electron-updater` 自动更新** | 接 `electron-updater` + `generic` provider，客户端自己拉 `latest.yml` | 桌面端 + 静态托管 | R4 体验最好，但 **R1/R2/R3/R5 仍无网页入口**，且需要签名（当前 `electron-builder.yml:71-73` 明确 v1 不签名） | 中–高（签名/SmartScreen） | 3 天+ |

补充说明为什么不是 A/D：

- **A 不满足需求本身**：用户要的是「管理员可以上传/发布/回溯」，A 没有这个概念；
  而且把制品放进 `public/` 在 standalone 部署下会**根本不生效**（见 6.4 的陷阱一）。
- **D 是互补而不是替代**：自动更新解决「装过的人怎么升级」，解决不了「新用户怎么装」
  与「管理员怎么发版/回溯」。建议作为 B 之后的 P2 叠加项（B 的制品目录可以直接喂给
  `generic` provider，这也是 B 的额外收益）。
- **C 是「不落库」的简化版**，本可用作 P0 止血，但它没有网页上传入口，
  与用户明确要求的「管理员可以上传软件包」不符；且清单文件与 `audit_events`/
  `metrics` 两张表脱节，后续仍要返工。

### 5.3 我建议排除的做法（省下返工）

- **不要**把安装包放到 `webserver/public/`：`next start`（standalone）在构建后不再读取
  `public/` 的新文件，且部署脚本是「一次性 `cp -r public .next/standalone/`」
  （`webserver/README.md:175-181`），线上传上去的文件不会被服务。
- **不要**用 `<a href>` 直链到文件系统路径：安装包必须经过鉴权端点（R1），并支持 `Range`
  （浏览器/下载器会发 `Range: bytes=…`，与 `preview-blackscreen-no-http-range-seeking`
  那份诊断里踩过的坑同类）。
- **不要**为了「回溯」做 `DELETE` 或覆盖文件：SQLite 单写者 + 无 Alembic，
  历史的正确做法是**新增行 + 移动指针**，删除只做软删（与仓库「Never add destructive DDL」
  和「删除即匿名化」的既有风格一致）。

---

## 6. 推荐修复（Recommended fix）：方案 B

**一句话：在账号服务器里建一个「发布目录（release catalog）」，把「拒绝」的对面补齐成
「给予」——一个表、两组端点、两个页面、一个权限点、一次指针移动，加桌面端两处修正。**

### 6.1 形态

```text
管理员                               用户
  │                                    │
  ├─ /admin/releases（列表 + 上传）      ├─ /download（RSC，需登录）
  │    ├─ POST 上传（流式落盘 + sha256）  │    ├─ 读「当前发布」：版本/平台/大小/sha256/说明
  │    ├─ 发布（把 channel 指针指过去）   │    └─ 点「Windows (x64)」→ 鉴权下载端点
  │    ├─ 回溯（指针指回上一版）          │
  │    └─ 撤回（指针清空 / 软删）         └─ 桌面端 426 阻断页
  │                                          └─ clientDownloadUrl(status.server.baseUrl)
  └─ 审计 + 指标                                      → /download（不再是 404）
```

### 6.2 数据模型（迁移 `0006_client_releases.sql`，只做加法）

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `client_releases` | `id`、`version`（唯一）、`channel`（`stable`/`beta`）、`platform`（`win`）、`arch`（`x64`）、`file_name`、`byte_size`、`sha256`、`notes`、`status`（`draft`/`published`/`retracted`）、`published_at`、`created_by`、`created_at`、`retracted_at` | 一行 = 一个平台的制品；`version+platform+arch` 唯一。**不存绝对路径**，只存 `file_name`（目录由配置决定，迁移机器不失效） |
| `client_release_channels` | `channel`（主键）、`release_id`、`updated_at`、`updated_by` | 「当前对外是哪一版」的**唯一事实来源**；发布/回溯/撤回都是这一行的一次 `UPDATE`（R5/R10/R16） |
| （索引） | `idx_client_releases_version`、`idx_client_releases_status` | |

#### 评审补注 R-5：§6.2 的数据模型有**三处自相矛盾**，照抄会直接写不出 macOS 支持

**(a) `version` 唯一 与 `version+platform+arch` 唯一不能同时成立。**
§6.2 同一行既写「`version`（唯一）」又写「`version+platform+arch` 唯一」。若 `version` 单列唯一，
则「同一个 1.0.2 同时出 win-x64 与 mac-arm64」永远不可能，而 §6.3 又要求
`/api/v1/releases/latest` 返回 `platforms[]`（复数）——一个版本只能有一行、一行只有一个
platform，`platforms[]` 就永远只有一个元素。**必须只保留 `UNIQUE(version, platform, arch)`**，
并且 R8（平台矩阵）才有实现基础。

**(b) `client_release_channels.channel` 做主键 → 每个渠道只能指向**一个**平台。**
指针表的语义是「当前对外是哪一版」，但「当前对外」对每个平台各有一个答案。
`channel` 单主键意味着 `stable` 同时只能指 win 或 mac 之一。**主键必须是 `(channel, platform)`**
（或 `(channel, platform, arch)`），否则 macOS 上线当天指针表就得重构。

**(c) `channel` 同时出现在行上和指针上 → 回溯语义有歧义。**
若 `client_releases.channel='beta'` 的行不能被 `stable` 指针指过去，那「把 stable 从 1.0.3
退回 1.0.2」在 1.0.2 原本是 beta 构建时就没有合法表达。**建议：渠道只属于指针表**，
制品行保持渠道无关（一行可被任意渠道指向）。这同时让 `beta → stable` 的晋升变成一次纯指针移动。

**(d) `file_name` 是客户端可控字符串：路径穿越 + 覆盖，两个都是真实漏洞。**
§6.2 说「只存 `file_name`（目录由配置决定）」——但 `file_name` 来自 `multipart/form-data`
的文件名，攻击者可以给 `..\\..\\config.ts` 或让两次上传得到同一个名字（浏览器的
`Ecliptrix-Setup.exe` 永远同名）。**必须**：

```text
落盘名 = `${sha256}${ext}`（或 `${id}${ext}`），目录 = `${RELEASES_DIR}/${version}/${platform}/`
file_name 仅作展示与 Content-Disposition 使用：
  - 写盘前 basename() 剥掉目录部分，并拒绝含 '/' '\\' '..' 的输入
  - 读盘时用 path.resolve(RELEASES_DIR) + startsWith 做包含性校验（不要拼接后直接 open）
  - 非 ASCII 展示名走 filename*=UTF-8''，不要塞进裸 filename=
```
仓库里已有同类先例可引：agent host 的 `download_url` 明确「refuses `size = 0`」
（`CLAUDE.md`「Agent host layer」一节），上传端点同样必须拒绝 `byte_size = 0`
并校验「流式哈希 == 落盘字节数」，否则 0 字节安装包会被当成正常发布。

**(e) R10 的「软删」与「不留孤儿文件」互相冲突，必须二选一。**
§5.1 R10 写「撤回发布（unpublish）与删除（软删，不留孤儿文件）」。软删的定义就是保留行，
保留行就要保留文件（历史版本必须还能下载，这是 R5 回溯的前提）；删文件则软删的行会变成
指向空文件的死链。**建议**：v1 不做物理删除，只做 `retracted` + 指针清空；另给一条
`npm run release:prune -- --older-than 90d --dry-run` 供运维显式回收，默认不动。
这与仓库既有风格一致（「Never add destructive DDL」「删除即匿名化」）。

**（f）指针不变式必须写死，否则回溯/撤回会在并发下产生悬空指针。**
- `publish`/`rollback` 的目标行 `status` 必须 `= 'published'`，否则拒绝（422）；
- `retract` 命中「当前指针」时，**同一事务内**把指针清空（或指回上一已发布版本）；
- 指针的每次写入都必须是单条 `UPDATE`（单实例 SQLite 下即原子），并在 `audit_events`
  里记 before/after 两个 `release_id`。

**修正后的模型摘要**：历史就是 `client_releases` 的全部行；
`client_release_channels` 只存指针——回溯 = 把指针指回旧 `release_id`，天然可逆。

### 6.3 API 契约

| 方法 / 路径 | 守卫 | 作用 |
| --- | --- | --- |
| `GET /api/v1/releases/latest` | 无（公开读，只吐已发布字段） | 落地页/下载页渲染：`version/notes/size/sha256/publishedAt/platforms[]` |
| `GET /api/v1/downloads/:channel/:platform` | `requireSession()`（R1） | **流式**返回制品；`Content-Disposition: attachment`、`ETag`=`sha256`、`Accept-Ranges: bytes`；计一次下载（R9），写一条 `audit_events`（R15） |
| `GET /api/v1/admin/releases` | `requireAdminRead(ctx,'releases.read')` | 管理端列表（含 draft/retracted） |
| `POST /api/v1/admin/releases` | `requireAdminWrite(ctx,'releases.write')` | 上传：`runtime='nodejs'`，`request.body` → `fs.createWriteStream`（**不 buffer 整个文件**），边写边算 sha256，落 `draft` 行 |
| `PATCH /api/v1/admin/releases/:id` | 同上 | 改 notes、发布（`status:'published'` + 指针）、回溯（指针换 `release_id`）、撤回（`status:'retracted'` + 指针清空） |
| `GET /api/v1/meta`（改） | 无 | 追加 `latestClientVersion`、`downloadUrl`（由 `PUBLIC_BASE_URL` 拼，**不泄露内网地址**） |
| 426 报文（改） | — | `clientOutdated(minVersion, downloadUrl)` → `details: { minVersion, downloadUrl }`（R12） |

⚠️ **必须同步改的既有断言**：`webserver/tests/integration/desktop-login.test.ts:175-186`
现在钉死了 `details: { minVersion }`。加字段后要把它更新成显式期望（`toMatchObject` 不会
自动失败，但**不能靠它不挂就当契约没变**），并补一条「`downloadUrl` 指向 `/download` 且
主机来自 `PUBLIC_BASE_URL`」的断言。

### 6.4 制品存储与流式下载（四个必须踩对的坑）

1. **目录不能在 `public/`**。新增配置 `RELEASES_DIR`（默认 `./data/releases`，
   与 `DATABASE_ROOT` 同级、位于 standalone 目录**之外**），启动时 `mkdir -p`；
   `deploy/` 与 `webserver/.env.example` 同步文档化。
2. **nginx 现在的上限是 1 MB**：`webserver/deploy/nginx.conf.example:40-42`
   （`client_max_body_size 1m; client_body_timeout 15s;`）。上传安装包（数百 MB 量级，
   打包后的 `Ecliptrix.exe` 单文件在 188 MB 量级，见 `desktop/scripts/build.js:35`）
   会直接 413。必须为 `/api/` 单独给出更大的 `client_max_body_size` 与
   `client_body_timeout`，或**只为上传路由**放宽并在文档里写清代价；
   `proxy_buffering off` 已就位（`:73`），对上传/下载流都是好事。
3. **下载端点必须支持 `Range`**：下载器会续传，且大文件不 `Range` 会让浏览器把
   整个响应读进内存。实现上用 `fs.createReadStream(path,{start,end})` +
   `206 Partial Content` + `Content-Range`，`ETag` 直接用 sha256（下载页上也是它，天然一致）。
4. **上传要么流式、要么给 CLI**：浏览器表单上传 300 MB 在教学网络里成功率不高。
   建议两者都给：网页上传走流式端点（满足 R2），同时提供
   `npm run release:publish -- --file desktop/release/Ecliptrix-Setup-1.0.2.exe --version 1.0.2 --notes …`
   作为大文件/无浏览器环境的通道（CLI 直连服务层，与仓库现有 `user:create` 等脚本同风格，
   `webserver/scripts/`）。

#### 评审补注 R-6：四个坑的**精确行号**、Range 的完整边界用例、以及上传原子性

**(a) nginx 的准确取值（§6.4 陷阱二引的是 `40-42, 59-74`，实际有四处要动）**

```text
webserver/deploy/nginx.conf.example:41   client_max_body_size 1m;      ← 188 MB 安装包的硬 413
webserver/deploy/nginx.conf.example:42   client_body_timeout  15s;     ← 相邻两次读的间隔，不是总时长
webserver/deploy/nginx.conf.example:72   proxy_read_timeout 30s;       ← 上传 location
webserver/deploy/nginx.conf.example:104  proxy_read_timeout 30s;       ← 第二个 location，容易只改一处
webserver/deploy/nginx.conf.example:73   proxy_buffering off;          ← 只影响响应，不影响请求体
```

三点必须说清楚，否则 Subtask #2 会以为「把 15s 调大就行」：

- `client_body_timeout` 是**两次成功读之间的间隔**，慢速但持续的 300 MB 上传不会因为它超时；
  真正 413 的是 `client_max_body_size`。
- `proxy_buffering off` 只作用于**响应**方向。**请求**方向由 `proxy_request_buffering`
  （默认 `on`）控制：nginx 会先把整个请求体落盘再转发，188 MB 会白占一倍磁盘并多一次拷贝。
  上传 location 应显式 `proxy_request_buffering off;` 才能真流式。
- **不要全局放开 `client_max_body_size`**：那等于给 `/login`、`/register` 等所有端点
  开了一个 300 MB 的 DoS 面。只为 `location ~ ^/api/v1/admin/releases` 单独放大，
  其它保持 `1m`，并把这一段的理由写在 `deployment-checklist.md` 里。

**(b) `Range` 的边界用例必须逐条断言（原报告只写了「206 + Content-Range」）**

| 请求 | 期望 | 说明 |
| --- | --- | --- |
| 无 `Range` | `200` + `Content-Length: N` + `Accept-Ranges: bytes` + `ETag` | 基线 |
| `Range: bytes=0-1023` | `206` + `Content-Range: bytes 0-1023/N` + `Content-Length: 1024` | 206 的 `Content-Length` 是**切片长度**，不是 N |
| `Range: bytes=<N-1024>-` | `206` 到文件尾 | 下载器续传主用形态 |
| `Range: bytes=-500` | `206`，最后 500 字节 | 后缀式，容易漏 |
| `Range: bytes=<N>-` （起点等于文件大小） | `416` + `Content-Range: bytes */N` | **越界必须 416，不能 500 也不能空 206** |
| `Range: bytes=0-1,5-6` | 只返回第一段（`206`）或忽略 `Range` 返 `200` | 多段不要尝试拼 `multipart/byteranges` |
| 非法 `Range`（如 `bytes=abc`） | 忽略，`200` | 按 RFC 不得 400 |
| `If-None-Match: "<sha256>"` | `304`，无 body | ETag 用 sha256 必须加引号（强校验器） |
| `HEAD` | 与 GET 同头、无 body | 浏览器/下载器都会先探 |

另外两条与安全/资源直接相关：

- `Cache-Control: private, max-age=0, must-revalidate`——**不得** `public`，
  这是鉴权产物；`ETag` 用 sha256 已经天然去重，无需长缓存。
- 响应流必须响应客户端断开：`request.signal.addEventListener('abort', () => stream.destroy())`。
  缺这一句，反复「下载→取消」会积累未关闭的文件句柄，最终 `EMFILE`。

**(c) 上传必须先落临时文件、校验通过再原子改名，否则会留下半截包和幽灵 draft 行**

§6.4 陷阱四只说「流式落盘 + sha256」。缺的步骤是**顺序**：

```text
1. 客户端字节 → `${RELEASES_DIR}/.incoming/${uuid}.part`（同时 update 哈希、累计 byte_size）
2. 边写边计字节数，达到上限立刻 abort（不要等写满再判断，否则可被用来塞满磁盘）
3. 结束时校验：hash 与声明的 sha256（若有）一致、byte_size > 0
4. fsync + rename 到正式名 `${version}/${platform}/${sha256}${ext}`
5. 最后一步才 INSERT 行（外加唯一约束冲突 → 删除刚落盘的文件并返回 409）
失败/中断/客户端断开 → 删 `.part`，不写行
```

三条不变式：
- **任何时刻都不存在「有行无文件」或「文件大小与 `byte_size` 不符」的记录**；
- 同一 `(version, platform, arch)` 重复上传 → `409 conflict`，且**不覆盖已有文件**
  （§6.9 已有这条验收，但要注意别在 `rename` 阶段把旧文件覆盖掉——`rename` 会静默覆盖，
  所以要先查行、再落盘）；
- `runtime = 'nodejs'` + `export const dynamic = 'force-dynamic'`，并且**不要**调用
  `request.formData()`（它会整体缓冲）。参考既有写法：`me/export/route.ts:25` 用了
  `force-dynamic`，但那是**响应**方向的小文件，不能照抄成上传实现。



### 6.5 权限与审计

- 权限点：`releases.read`、`releases.write`，加进**两处**目录+种子：
  `webserver/src/lib/permissionsCatalog.ts:18-23`（前端权限矩阵）
  与 `webserver/src/server/auth/permissions.ts:12-17,73-83`（服务端权威 + 角色默认值：
  `admin` 给 `releases.read/write`，`support` 只给 `releases.read`，`owner` 恒 `*`）。
  漏掉前者 → 控制台权限矩阵里看不到这一项；漏掉后者 → 路由永远 403。
- 守卫只用现成的 `requireAdminRead/requireAdminWrite`（`server/auth/guards.ts:199-217`），
  **不要手写** permission→CSRF→budget 的顺序（README 记录的教训：唯一手写的那条路由漏了 CSRF）。
- 审计：`releases.upload` / `releases.publish` / `releases.rollback` / `releases.retract`
  四条 action，metadata 只放 `version/platform/byteSize/sha256 前 12 位`，不放完整路径。
- 指标：`metricsService` 增加 `releases.uploads`、`downloads.count`（按 version 分桶），
  控制台 `/admin/metrics` 出图。

### 6.6 前端（`webserver/`）

1. **`/download` 公开页**（`app/(marketing)/download/page.tsx`，RSC）：
   - 走 `resolveLocale()` + `translator(locale)`，文案进 `webserver/src/lib/i18n.ts` 中英两份；
   - 顶部一张「当前版本」卡片：版本号、发布日期、平台/架构、大小、SHA-256（可复制）、
     「下载」按钮（→ 鉴权端点）；下面是 `notes` 渲染与「历史版本」列表（R5 的用户侧体现，
     只列 `published`/`retracted`，点旧版本也能下）；
   - **登录校验**：未登录时不是 302，而是渲染「登录后下载」面板（`/login?next=/download`），
     因为需求是「登录以后下载」，而不是「看不到页面」；
   - 空目录时给运维可读的空态（「尚未发布任何版本」），不要 404 也不要假按钮；
   - 加进 `app/sitemap.ts:7-13`。
2. **替换占位按钮**：`DownloadCta` 与 `Hero` 的按钮改为链到 `/download`
   （`download-cta.tsx:19-41`、`hero.tsx:29-35`），**删掉 macOS 按钮**或按
   `GET /api/v1/releases/latest` 的 `platforms[]` 动态渲染——有产物才显示，
   从根上消灭「承诺不存在的产物」（D4 / R8）。`hero.note` 的 "Windows and macOS"
   （`webserver/src/lib/i18n.ts:497`、`:64`）必须同步改成真实平台。
3. **控制台 `/admin/releases`**（`app/(console)/admin/releases/page.tsx` +
   `components/console/releases-panel.tsx`）：表格（版本/平台/状态/大小/发布人/时间）、
   上传对话框（进度条 + 客户端预校验 `\.exe$` 与 maxsize）、
   行内动作「发布 / 回溯 / 撤回 / 复制校验和」，危险动作走现有 `confirm-dialog.tsx`。
   新增菜单项进 `console-shell.tsx`；行内「回溯」要显式说明「把当前版本指回 x.y.z」。
4. **`client.minVersion` 联动**（R11）：`settings-form.tsx:59-93` 保存前拉一次
   `/api/v1/releases/latest`，若 `minVersion > latest.version` 则**阻断保存**并给出
   「当前最新已发布版本是 x.y.z」的具体提示（现在只有一句泛泛的警告）。
   服务端在 `settingsService.patch` 里也做同样校验（UI 只是反映，服务端强制）。

#### 评审补注 R-7：营销页是**静态预渲染**的——「动态渲染 platforms[]」会把版本烤进构建产物

§6.6 第 2 条要求「按 `GET /api/v1/releases/latest` 的 `platforms[]` 动态渲染，有产物才显示」。
但落地页现在没有任何动态标记：

```text
webserver/src/app/(marketing)/page.tsx:18   export const metadata: Metadata = { … }
（全文无 `export const dynamic`、无 `export const revalidate`）
```

Next.js 会对它做**构建期静态预渲染**。后果：发布/回溯之后，落地页上的平台与版本
仍是 `npm run build` 那一刻的值，直到下次重建——一个「管理员点了发布，官网没变」的新缺陷，
而且极难在开发环境发现（dev 每次请求都重新渲染）。

**必须二选一，并写进验收**：

- `export const dynamic = 'force-dynamic'`（推荐：单实例 SQLite，一次索引查询可忽略）；或
- `export const revalidate = 60` 并接受最长 1 分钟的陈旧。

对应验收：**发布新版本后，不重建、不重启，刷新 `/` 必须显示新版本**。

另外两处必须一起改，否则会留下假链接：

| 位置 | 现状 | 必须 |
| --- | --- | --- |
| `webserver/src/components/marketing/footer.tsx:13` | `{ label: tt('nav.download'), href: '#download' }` | 保留 `id="download"` 区块则不动；若改为跳 `/download` 则同步改这里 |
| `webserver/src/lib/i18n.ts:56,489` | `nav.download` = `'下载桌面端'` / `'Download'` | 已存在，**不要**新建同义键（`i18n.test.ts:13` 要求中英键集完全一致，重复键会互相覆盖） |

#### 评审补注 R-7b：i18n 的强制约束（新增页面必须一次加两份）

```ts
webserver/tests/unit/i18n.test.ts:4,13
/** i18n parity: a key present in one locale and missing in the other is a bug. */
expect(en).toEqual(zh)
```

§6.6 只说「文案进 i18n 中英两份」，但要落地成约束：**任何新 key（`/download` 页、
`/admin/releases` 面板、`permissions.releases.*`）都必须在
`webserver/src/lib/i18n.ts` 的中英两个字典里同时出现**，否则 `npm test` 红。
这是 Subtask #2 最容易在最后一刻翻车的地方（写完英文忘了中文）。

### 6.7 桌面端（根项目）两处修正

1. `clientDownloadUrl(runtimeBaseUrl?: string | null)`（`src/lib/api/authBridge.ts:687-691`）：
   签名对齐 `accountCenterUrl`，内部改传 `runtimeBaseUrl`，**去掉 `https://ecliptrix.app/download`
   兜底**，未知时返回 `null` 并让按钮禁用——这正是同文件 `:634-651` 的 R.3，
   只是当年只修了 `/account`。
2. 两个调用点传运行时地址并处理 `null`：
   `AuthBlocker.tsx:53-55,90-94`、`LoginScreen.tsx:132-134,152-165`；
   同时把 `openExternal(...).catch(() => {})` 改成**检查返回值**：
   白名单拒绝返回的是 `{ ok:false, code:'url_not_allowed' }`（`desktop/main/authBridge.js:218-228`），
   `.catch` 抓不到它，用户点了毫无反应。至少要把失败变成一条可见提示。
3. 补测试：`src/lib/api/__tests__`（或 authBridge 现有测试旁）加
   「运行时 origin 优先」「未知 origin → `null`，绝不返回厂商域名」两条；
   `desktop/main/authBridge.test.js:231` 已有白名单用例，可扩展一条
   「`/download` 不在白名单时返回 `url_not_allowed`」。

### 6.8 分阶段落地（给后续节点的顺序建议）

| 阶段 | 内容 | 目的 |
| --- | --- | --- |
| **P0 止血（半天）** | 建 `RELEASES_DIR` + 迁移 0006 + 只读 `/download` 页 + 手工把当前安装包登记为 `published` + `clientDownloadUrl` 修正 | **消灭 404**：已发出去的桌面端不需要更新就能用（它们本来就指向 `/download`） |
| **P1 完整（2–3 天）** | 上传端点（流式 + sha256）、发布/回溯/撤回、权限点、审计、指标、`/admin/releases` 控制台、`Range` 下载、落地页换链 | 满足用户四条硬要求 |
| **P2 增强（1–2 天）** | `/meta` + 426 带 `downloadUrl`、`client.minVersion` 联动校验、CLI `release:publish`、nginx 配置模板与文档、`electron-updater` 对接评估 | 把分发改成可持续运营的能力 |

> P0 的价值值得强调：**已经发出去的 `1.0.1` 客户端，其阻断页永远只会打开 `{origin}/download`。**
> 只要这个路径上线，所有存量安装立即获得自救能力——不需要任何客户端更新。
> 这是方案 B 相对于「在客户端里加自动更新」的决定性优势。

### 6.9 验收命令（修复节点的 Definition of Done）

```bat
cd webserver
npm run type-check          :: 0 error
npm run lint                :: 0 warning（--max-warnings 0）
npm test                    :: 既有 280 项全绿 + 新增用例
npm run db:migrate          :: 连跑两次，第二次 "nothing to do"
npm run build               :: standalone 含 /download 与 /admin/releases
node scripts/smoke.mjs      :: 对运行中的服务端到端（需新进程，避免登录限流）
```

新增测试至少覆盖（正常路径 + 失败路径）：

- 未登录 `GET /download` → 渲染登录引导（不是 302 也不是 500）；
- 已登录 `GET /api/v1/downloads/stable/win` → 200 + `Content-Length` + `ETag`；
  带 `Range: bytes=0-1023` → 206 + `Content-Range`；
- 无当前发布 → 该端点 404/409，**且页面显示空态**，不能 500；
- 非管理员 `POST /api/v1/admin/releases` → 403；
- 发布 → `/api/v1/releases/latest` 返回新版本；回溯 → 返回旧版本且新版本仍在列表里；
- `minVersion` 高于最新发布版本 → `settingsService.patch` 拒绝（422）；
- 上传同名版本 → 409（唯一约束），不能覆盖既有文件；
- sha256 与上传字节一致（流式哈希与落盘大小双校验）。

### 6.10 明确不做（YAGNI）

- 不做多租户/多产品线分发（当前产品只有一个桌面端）；
- 不做 CDN/对象存储抽象（本地目录 + 流式端点够用，`RELEASES_DIR` 可挂网络盘）；
- 不做自动灰度/百分比放量（用 `beta` 渠道 + `minVersion` 已足够）；
- 不做安装包签名（v1 明确不签名，`desktop/electron-builder.yml:71-73`），
  但**必须**把 sha256 展示出来，让用户自己可校验。

---

## 7. 证据附录

### 7.1 实测输出

| 文件 | 内容 |
| --- | --- |
| `evidence/route-probe.txt` | 10 条路由的 HTTP 状态 + `/api/v1/meta` 完整 `data`（无任何下载字段） |
| `evidence/lockout-chain.txt` | 426 报文原文（只有 `minVersion`）→ `GET /download` 404 → 设置已恢复 `''` |
| `evidence/landing-download-section.html` | 服务端渲染的下载区块：两个 `href="/register"`，第三个 `href="/legal/terms"` |
| `evidence/collect-probe.py` | 只读探测脚本（可重复执行） |
| `evidence/repro-426-then-404.py` | 端到端复现脚本（读 `.env`、`finally` 恢复设置、不打印凭据） |

### 7.2 代码引用清单（每条均已核对现行源码）

| 位置 | 事实 |
| --- | --- |
| `src/lib/api/authBridge.ts:687-691` | `clientDownloadUrl()` 传 `null` 并兜底 `https://ecliptrix.app/download` |
| `src/lib/api/authBridge.ts:682-685` | 兄弟函数 `accountCenterUrl(runtimeBaseUrl)` 接收运行时地址，未知时返回 `null` |
| `src/lib/api/authBridge.ts:634-651` | R.3 铁律：运行时 origin 优先、不得回落厂商域名 |
| `src/components/auth/AuthBlocker.tsx:53-55,90-94` | 阻断页「下载」按钮 = `openExternal(clientDownloadUrl()).catch(()=>{})` |
| `src/components/auth/LoginScreen.tsx:132-134,152-165` | 登录页同样的「只有一颗下载按钮」 |
| `src/lib/i18n.ts:8880,13571` | 按钮文案 `Open download page` / `打开下载页`（`auth.maintenance.download`）。**原报告写的 4578/9273 是另一处键**（agent 文件工具栏的 `Download`/`下载`，见 `:4574-4583`、`:9264-9277`），Subtask #2 若按旧行号改会改错位置 |
| `src/lib/i18n.ts:8893-8897,13584-13588` | 阻断文案：当前版本 / 最低版本（不提供任何地址） |
| `desktop/main/authBridge.js:54,86-92` | 外部链接白名单 = 厂商三域名 + 运行时服务端主机 |
| `desktop/main/authBridge.js:218-228` | 白名单拒绝时**返回** `{ok:false,code:'url_not_allowed'}`，不抛异常 |
| `webserver/src/server/http/errors.ts:88-98` | 426 只带 `details:{minVersion}`（注释也只写到「告诉用户版本号」） |
| `webserver/src/server/services/authService.ts:221-251` | 闸门在密码校验之前生效，写审计 `auth.login_blocked_outdated_client` |
| `webserver/src/app/api/v1/meta/route.ts:11`、`settingsService.ts:248-282` | 公共 meta 无「最新版本/下载地址」字段 |
| `webserver/src/components/marketing/download-cta.tsx:19-41` | Windows/macOS 均 `href="/register"`；第三个按钮 `nav.docs` → `/legal/terms` |
| `webserver/src/components/marketing/hero.tsx:29-35` | 首屏主按钮 “Download for desktop” → `/register` |
| `webserver/src/lib/i18n.ts:495-497,62-64` | 文案承诺 “Windows and macOS” |
| `desktop/electron-builder.yml:63-74,82-88` | 只出 `win nsis x64`；`artifactName: ${productName}-Setup-${version}.${ext}` |
| `desktop/scripts/build.js:389-401,447-458` | 构建期已算 sha256 与大小，但只打印到终端 |
| `webserver/src/server/db/migrations/0001..0005` | **16 个 `CREATE TABLE`（15 张业务表 + `schema_migrations`）**，无任何制品/版本/发布实体（原报告 §7.2 此处写「13 张表」，与 §3.1 的 16 处自相矛盾，已按实测更正；表名清单见补注 R-8） |
| `webserver/src/lib/permissionsCatalog.ts:18-23`、`server/auth/permissions.ts:12-17,73-83` | 权限目录里没有 `releases.*` |
| `webserver/src/app/sitemap.ts:7-13` | 公开路由清单里没有 `/download` |
| `webserver/src/middleware.ts:17,96-104` | 只保护 `/account`、`/admin`；`/download` 若上线需自行决定「登录引导」而非中间件跳转 |
| `webserver/deploy/nginx.conf.example:40-42,59-74` | `client_max_body_size 1m`、`client_body_timeout 15s`、`proxy_read_timeout 30s` |
| `webserver/docs/deployment-checklist.md:92-96` | 靠人工确认「`client.minVersion` 空或等于已发布版本」 |
| `webserver/tests/integration/desktop-login.test.ts:175-186` | 既有测试把「426 只带 minVersion」钉成契约（修复时必须同步改） |
| `webserver/README.md:195-201` | 版本闸门的官方描述：只说「426 + details.minVersion」，全文无下载通道 |

### 7.3 本次产生的文件

```text
docs/diagnoses/client-download-unavailable/
├── analysis.md                        ← 本报告
└── evidence/
    ├── collect-probe.py               ← 只读探测（可重复）
    ├── repro-426-then-404.py          ← 端到端复现（自动恢复设置）
    ├── route-probe.txt                ← 路由状态码实测
    ├── lockout-chain.txt              ← 426 → 404 实测报文
    └── landing-download-section.html  ← 落地页下载区块的实际渲染结果
```

---

## 8. 未覆盖与风险（交给后续节点）

1. **本节点未验证桌面端 GUI**：第 2.4 节的点击路径是从代码推定 + 服务端 404 实测，
   没有真的在打包产物里点过那颗按钮（打包耗时数十分钟）。修复节点应补一次真实点击。
2. **`openExternal` 白名单在自建部署下的实际表现未跑**：`allowedHosts` 含运行时主机，
   因此「正确 origin」是能打开的；「厂商域名兜底」也在白名单内——两条都能打开，
   只是目的地不对。真机验证建议用 `desktop-config.json` 指向一个自定义 origin 做一次。
3. **大文件上传未实测**：`client_max_body_size 1m` 的 413 行为来自配置阅读，
   未用真实 300 MB 文件打穿一遍（那需要一台配好 nginx 的机器）。
4. **多副本/集群**：仓库明确「单实例 SQLite」（`webserver/README.md:148`），
   方案 B 的「指针一次 UPDATE」在这个前提下是原子的；若要横向扩展，`RELEASES_DIR`
   必须换成共享存储且指针写入需要真事务——这是已知边界，不要在本迭代里解决。
5. **黑板上没有本缺陷的记录**：本次已补一条 `finding`（`F-18`）指向本报告，
   供 Subtask #1–#3 直接引用。

---

## 评审结论（Review Verdict）

> 评审节点：Subtask #1（资深评审视角）。评审日期 2026-11-25。
> 评审方式：对 §1–§8 的**每一处代码引用逐行回读现行源码**（不是读报告的自述），
> 对 where 断言做「文件/目录是否真的不存在」的实测，对关键行为回读既有测试确认契约。
> 本节点**不改产品代码、不 commit**，只改本文件。
> 下文 `R-x` 指本节点插入正文的补注；`C-x` 指给 Subtask #2 的硬约束。

### 0. 判定摘要

| 项 | 判定 |
| --- | --- |
| 根因是否成立（通道不存在 + 三处实现缺陷） | **成立**，且证据比原报告自述的更硬（R-2 补出机制链） |
| 缺陷是否真的会伤到用户 | **成立但需收窄表述**：仅当运维把 `client.minVersion` 设为非空时触发；且只影响**桌面端**用户（Web 登录豁免，R-1b） |
| 四条根因的严重度排序 | D2 **上调**（自建部署被导向他人域名 = 可利用投毒面，且 `ecliptrix.app` 在白名单内**会真的打开**）；D1 维持 P1；D3/D4 维持 P2 |
| 候选方案 | A/C 排除，D 仅作 P2 补充，**B 是唯一满足用户四条硬要求的方案** |
| **最终推荐** | **方案 B（架构不变），但必须先修正 R-4～R-7 点名的设计缺陷（收敛为 C1–C10 十条硬约束）再落码**，并把落地顺序压成「B-P0 半天止血 → B-P1 满足需求 → B-P2 增强」 |
| 阻断级前置条件 | 若不做 R-5(a)(b)、R-4(d)、R-7，方案 B 上线即带三处新缺陷（macOS 无法上线 / 线上管理员 403 / 发布后官网不更新） |

**一句话最终结论**：**采纳方案 B，但把它当作「修正后的 B」实施**——原报告的方向、
需求矩阵（R1–R16）与三阶段顺序（§6.8 的 P0/P1/P2）全部成立，可直接作为 Subtask #2 的施工图；
唯一不可直接照抄的是 §6.2 的数据模型、§6.5 的权限落地方式、§6.4 的上传/下载实现细节
与 §6.6 的营销页渲染模式，四处共 8 个具体点已在 R-4～R-7 逐条给出修正。

---

### 1. 根因证据审计

#### 1.1 引用代码是否真的在失败路径上被执行——逐条裁决

裁决标准：**「被引用」不算证据，「在这次失败里被执行」才算**。

| # | 报告断言 | 裁决 | 依据 |
| --- | --- | --- | --- |
| D1 | 账号服务器没有发布目录（表/仓储/服务/端点/页面/权限全无） | **成立（实测）** | `webserver/src/app` 下只有 `(auth) (console) (marketing) api` 四个目录；`api/v1` 下只有 `admin auth health locale me meta ready` 七个；`(console)/admin` 下只有 `audit forbidden invites mail roles sessions settings users` 八个。16 个 `CREATE TABLE`（清单见附录 R-8）无一处与制品相关 |
| D1 | `/download` 的 404 不是「构建陈旧」导致的假象 | **成立（关键排除）** | 树里**根本不存在**可服务 `/download` 的文件，`sitemap.ts`/`middleware.ts` 也没有它 → 404 是结构性缺失，不是 dev/prod 差异 |
| D2 | `clientDownloadUrl()` 丢弃运行时 origin 并硬编码厂商域名 | **成立（逐字核对）** | `src/lib/api/authBridge.ts:687-691`，与兄弟函数 `:682-685`、`accountServiceOrigin` `:671-675` 对比成立 |
| D2 | 点击后「毫无反应」 | **成立，并由本节点补出机制链** | 主进程 return 失败信封（`desktop/main/authBridge.js:218-228`）→ preload 原样透传（`desktop/preload/preload.js:52`）→ 渲染层 `unwrapOk` 把它 throw 成**普通对象**（`src/lib/api/authBridge.ts:324-327,413-414`）→ `.catch(()=>{})` 必然吞掉。原报告是推断，未给链 |
| D2 | 自建部署被导向 `https://ecliptrix.app/download` | **成立且更严重** | `EXTERNAL_HOST_ALLOWLIST` 含 `ecliptrix.app`（`desktop/main/authBridge.js:54`）→ 兜底地址**在白名单内，会真的打开**。「静默」只发生在自建 origin 不在白名单时。两者必须分开 |
| D3 | 426 只带 `minVersion` | **成立（逐字核对）** | `webserver/src/server/http/errors.ts:95-98`，`details` 只有 `minVersion` |
| D3 | 闸门在密码校验之前生效并写审计 | **成立（逐字核对）** | `authService.ts:344-349`（先 `assertNotInMaintenance` 再 `assertClientSupported`，之后才 `verifyCredentials`）；审计 `:242-249` |
| D3 | `client.minVersion` 默认空 → 闸门对它形同关闭 | **成立** | `webserver/src/server/services/settingsService.ts:90` `default: () => ''`；`:225` `if (minVersion === '') return` |
| D3 | 控制台只校验 `x.y.z` 形状、无「是否已发布」校验 | **成立** | `webserver/src/components/console/settings-form.tsx:59-61`（`VERSION_PATTERN`）、`:93`（只 `toast.warning`） |
| D4 | 首屏与下载区块三颗按钮都指向 `/register` / `/legal/terms` | **成立（源码 + 渲染产物双证）** | `hero.tsx:30-35`；`download-cta.tsx:20-40`；`evidence/landing-download-section.html` 与源码逐字符吻合 |
| D4 | 承诺 macOS 但只产 win-x64 | **成立** | `webserver/src/lib/i18n.ts:64,497`（`hero.note` 含 macOS）；`desktop/electron-builder.yml` 只有 `win: nsis / x64` |
| §3.5 | 既有测试把「只带 minVersion」钉成契约 | **成立，但影响被高估** | `desktop-login.test.ts:181-185` 用 `toMatchObject` 做**子集**匹配 → 新增 `downloadUrl` **不会**让它变红。所以它是「契约没有被表达」，不是「加字段会打架」。真正的风险是**没人会因此被告知契约已变** |
| §1.3 | 版本闸门「半年前就上线」 | **不实，已更正** | `git log -S assertClientSupported` → `2026-11-08 e4763011`，距诊断 **17 天**。这条叙述不承载结论，但它决定了「为什么没人发现」的解释力度，必须改正 |

#### 1.2 证据强度分级（哪些是实测、哪些是代码事实、哪些仍是推断）

| 等级 | 内容 | 可用性 |
| --- | --- | --- |
| **A 实测** | `/download` 404、426 报文原文、落地页渲染 HTML、`client.minVersion` 恢复为 `''` | 可直接进验收 |
| **B 代码事实** | 四处根因的全部引用、白名单与失败信封链、`publicBaseUrl` 存在性、`seedRoles` 幂等性、`i18n` 对等测试 | 可直接进施工图（本节点已逐条回读） |
| **C 推断（已在 R-6 补齐为可执行）** | 大文件上传 413、`Range` 行为、nginx 超时 | 由「配置阅读」升级为「按行号 + 逐条边界用例」，但仍未真机跑通 300 MB |
| **D 未验证（诚实标注）** | 打包产物里真点那颗按钮（§8.1 自述未做）；`openExternal` 在自建 origin 的真机表现（§8.2）；`clientDownloadUrl` 修复后的端到端 | 由 Subtask #2 的复现步骤覆盖，**不得**视为已闭合 |

`evidence/` 里有两处应当修正的表述（不影响结论）：
`route-probe.txt` 的 `200  GET /#download` 一行**不构成任何证据**（URL 片段不会发给服务端，
它等价于又测了一次 `GET /`）；`lockout-chain.txt` 的 404 body 被截断到 300 字符，
因此无法把该 404 归因到 `app/not-found.tsx` 而非反向代理——本节点用「树里没有该路由」
把这条补实了。

#### 1.3 报告漏掉的证据（本节点已补入正文）

| 补注 | 内容 | 为什么它是必需的 |
| --- | --- | --- |
| R-1a | 阻断页是「重试 + 下载」两颗，下载仅在 `client-outdated` | 否则修错地方 |
| **R-1b** | **版本闸门只对 `client === 'desktop'` 生效，Web 登录豁免（有测试钉死）** | **本方案的地基**：`/download` 要求登录时，必须存在「426 用户仍能登录网页」的路径，否则制造第二个死锁 |
| R-1c | 闸门同样作用于 `register()` | 旧安装包注册的新用户同样死锁 |
| R-1d | 桌面端**零**自动更新（`electron-updater`/`latest.yml`/`checkForUpdates` 零命中） | 证明 `/download` 是**唯一**升级路径，而非「体验更好的一条」 |
| R-2 | `.catch(()=>{})` 静默的三段链 + 抛的是普通对象（须用 `isAuthFailure` 判定） | 否则修 `.catch` 时用 `instanceof Error` 会漏 |
| R-3 | `publicBaseUrl` 已存在且必需；**禁止**用 Host 头拼 `downloadUrl` | R12 零成本落地 + 防重开钓鱼口 |
| R-4 | 权限点是**五处**不是两处（含 i18n 标签，测试强制）；**`seedRoles` 不给既有角色发新权限** | 不做 → 发版后线上 admin 永久 403，本地绿 |
| R-4b | `webserver/` 内**零** `Range` 实现 | R14 是从零写流式，风险与工作量都要重估 |
| R-5 | 数据模型三处自相矛盾 + 路径穿越 + 软删矛盾 | 照抄写不出 macOS |
| R-6 | nginx 四处行号 + `proxy_request_buffering` + 9 条 Range 边界 + 上传原子性顺序 | 原报告只给了 3 条验收，会漏 416/304/后缀式 |
| R-7 | 营销页是**静态预渲染**，动态渲染 `platforms[]` 会被烤进构建产物 | 否则「发布后官网不更新」 |
| R-8 | 16 张表的完整清单（附录） | 更正 §7.2 的「13 张表」与 §3.1 的 16 自相矛盾 |

#### 1.4 反例与替代解释（是否还有别的解释能说明同一现象）

逐条压力测试，只有一条真正动摇了报告措辞：

| # | 替代解释 / 反例 | 是否成立 | 对结论的影响 |
| --- | --- | --- | --- |
| E1 | 「落地页按钮指向 `/register` 是营销策略：先注册再下载」 | **不成立** | 注册后依然没有产物（D1），且注册页没有任何「下一步下载」；实测 `/register` 200 之后无路可走 |
| E2 | 「桌面端本来就有自动更新，不需要下载页」 | **不成立（实测反证）** | `desktop/` 全量 grep `electron-updater`/`latest.yml`/`checkForUpdates` 零命中；`electron-builder.yml` 无 `publish` |
| E3 | 「`/download` 的 404 是构建陈旧/代理错误」 | **不成立（实测反证）** | `webserver/src/app` 树里没有该路由；`api/v1` 只有 7 个目录 |
| E4 | 「版本闸门把**所有**用户锁死」 | **部分成立 → 必须收窄** | 闸门只对 `client === 'desktop'` 且带版本号的登录生效（`authService.ts:223`，`desktop-login.test.ts:203-225` 钉死）。**Web 用户完全不受影响**，因此「整批用户」应改写为「该部署的全部**桌面端**用户」 |
| E5 | 「这是 P1 阻断缺陷，随时会爆」 | **条件是缺失的 → 需补条件** | `client.minVersion` 出厂为 `''`（未启用）。缺陷在「运维设置了非空值」时 100% 爆发。§4.5 的影响比例列必须写「**仅当** `client.minVersion` 非空」 |
| E6 | 「就算没有下载页，用户还能找客服要安装包」 | **成立，但不构成免责** | 这是唯一现存的替代路径，正是 §4.2「靠人工发、无校验和、无版本记录」所描述的那条；它恰恰是要被本需求消灭的对象 |
| E7 | 「`/download` 需要登录 → 被 426 锁死的人登录不了 → 死锁」 | **不成立（R-1b 证伪）** | 这是**最值得担心**的一条反例，也是原报告从未讨论的一条。它被证伪，方案才成立 |

**审计结论**：根因成立；报告的**方向**与**需求矩阵**无懈可击；需要修正的是
**严重度的触发条件（E4/E5）**、**三处引用准确性（R-1a/R-2a/§7.2 表数）**
与**一处时间叙述（17 天 vs 半年）**。这些都不动摇 D1–D4。

---

### 2. 候选修复方案审计

#### 2.1 四个方案的裁决

| 方案 | 裁决 | 理由（含本节点新增证据） |
| --- | --- | --- |
| A 静态托管 | **排除** | ①不满足「管理员上传/发布/回溯」；②`next start` standalone 不再读取构建后新增的 `public/` 文件（报告已指出，属实测级结论）；③无鉴权、无计数、无校验和。**补充**：即使只想止血，A 也做不到——它连「手工登记一行」的能力都没有 |
| **B 发布目录** | **采纳（修正后）** | 唯一同时覆盖 R1–R16 的方案；P0 阶段就能消灭 404，且**已发出去的 1.0.1 客户端无需更新**（因为它的阻断页本来就打开 `{origin}/download`）。这是相对 D 的决定性优势，也是本方案的核心价值 |
| C 清单 + CLI | **排除（但吸收其 CLI）** | 与用户硬要求「管理员可以上传软件包」直接冲突（无网页入口）；且与 `audit_events`/`metrics` 脱节要返工。**保留**其 `npm run release:publish` 作为大文件/无浏览器环境的第二通道（§6.4 陷阱四已提），成本极低 |
| D electron-updater | **降为 P2 叠加项** | 解决「装过的人怎么升」，解决不了「新用户怎么装」「管理员怎么发/回溯」；且 v1 不签名（`electron-builder.yml:71-73`），SmartScreen 会拦。B 的 `RELEASES_DIR` 可直接喂 `generic` provider，是后续收益 |

#### 2.2 「是否最小改动」——把 B 拆成可独立验收的三段

原报告 §6.8 的三段划分**方向正确**，但边界不够硬。评审给出的判定标准是
**「每段结束后，用户拿到的东西是否可独立验证」**：

| 段 | 必须包含 | 为什么这一段就够了 | 明确不做 |
| --- | --- | --- | --- |
| **B-P0（半天，止血）** | 迁移 0006 + `RELEASES_DIR` + `/download` 页（含「未登录→登录引导」空态）+ 一条手工/CLI 登记的 `published` 行 + `clientDownloadUrl(runtimeBaseUrl)` 修正 | 存量 1.0.1 立即能自救；`/download` 从 404 变成真页面。**这是唯一能当天消除「用户完全无法自救」的改动** | 不做上传端点、不做控制台、不做计数 |
| **B-P1（2–3 天，满足用户四条硬要求）** | 上传（流式+原子改名）+ 发布/回溯/撤回 + 权限点（五处）+ 审计 + `/admin/releases` + `Range` 下载 + 落地页换链 + **R-7 动态化** | 用户 R1–R5 全部闭合 | 不做 `/meta`/426 `downloadUrl`（P2 才需要） |
| **B-P2（1–2 天，运营可持续）** | `/meta` + 426 带 `downloadUrl` + `client.minVersion` 前后端联动校验 + CLI + nginx 模板 + 文档 + `electron-updater` 评估 | 把「一次性修复」变成「可持续运营」 | 不做 CDN/灰度/签名 |

**是否在做多余的事？** 不是。R1–R5 是用户明写的，R6–R16 是「还有我没考虑到的」
（用户显式授权的补全）。真正可能被质疑的是 R9（下载计数）与 R15（审计）——
但它们各自的边际成本只有「复用既有 `metricsService.overview()` 与 `auditService.record()`」，
且审计在「谁把坏版本发出去了」这类事故里是唯一证据，**保留**。

#### 2.3 方案 B 会引入的新回归风险（原报告未列，必须显式管理）

| 风险 | 机制 | 处置（已写入 R-x / C-x） |
| --- | --- | --- |
| **发布后官网不更新** | 落地页静态预渲染（无 `dynamic`/`revalidate`） | R-7：`dynamic='force-dynamic'` + 验收「发布后不重建即变」 |
| **发版后管理员 403** | `seedRoles` 对既有角色是空操作 | R-4(d)：0006 里幂等 INSERT 到 `role_permissions` |
| **macOS 永远上不了线** | `version` 单列唯一 + 指针表 `channel` 单主键 | R-5(a)(b)：`UNIQUE(version,platform,arch)` + PK`(channel,platform)` |
| **上传被路径穿越/覆盖** | `file_name` 来自客户端 | R-5(d)：落盘名用 sha256，`file_name` 仅展示 |
| **半截包 / 幽灵 draft 行** | 先写行后写文件 | R-6(c)：`.part` → 校验 → `rename` → 最后 INSERT |
| **下载把文件句柄耗尽** | 未监听客户端断开 | R-6(b)：`request.signal` → `stream.destroy()` |
| **`/api` 全局放开体积 → DoS 面扩大** | 直接调大 `client_max_body_size` | R-6(a)：只为 releases location 放大 |
| **内存被 188 MB 撑爆** | 用 `request.formData()` 或先拼接再返回 | R-6(c)：只允许 `request.body` 流式 |
| **i18n 漏一份 → `npm test` 红** | `i18n.test.ts:13` 要求中英键集相等 | R-7b：一次加两份 |
| **磁盘被上传塞满** | 只在写完后判断大小 | R-6(c)：边写边计、超限即 abort |

---

### 3. 最终推荐的修复（单一方案）

> **推荐：采纳方案 B（发布目录 = 迁移 0006 + 两组端点 + 两个页面 + 一个权限域 + 一次指针移动 + 桌面端两处修正），按 R-4～R-7 修正后实施，顺序 B-P0 → B-P1 → B-P2。**
> 不推荐 A（不满足需求且 standalone 不服务新文件）、不推荐 C（无网页上传入口，与用户要求冲突）、
> 不把 D（自动更新）当替代方案（只解决已装用户的升级，且 v1 无签名）。

**为什么是它，而不是别的**（评审给出的四条充分理由）：

1. **它是唯一能让「已发出去的客户端」自救的方案。** 存量 1.0.1 的阻断页**永远**只打开
   `{origin}/download`；只要该路径上线，无需任何客户端更新即可恢复。`electron-updater`
   做不到这一点（旧客户端里没有这段代码）。
2. **它把「拒绝」补成「给予」，而不是把拒绝削掉。** 版本闸门的准入控制是对的
   （`authService.ts:221-251` 有审计、不消耗锁定计数、不影响心跳/刷新），缺的是分发面。
   任何「放宽闸门」的捷径都会把安全能力降级。
3. **它落在既有的架构骨架上**，不引入新岛：`requireAdminWrite/Read`（`guards.ts:199-226`）、
   `auditService.record`、`metricsService.overview`（`:161`）、`publicBaseUrl`
   （`config.ts:52-54,168`）、手写幂等迁移、i18n 单文件——全部现成。
4. **它的边界条件已经被本节点逐条点名并给了解法**（R-4～R-7 共 8 处 + C1–C10），
   剩下的不确定性只有「大文件真机上传」一项，且可以在 P1 末尾用一次真机 188 MB 上传闭合。

#### 3.1 给 Subtask #2 的硬约束（不可协商，逐条可验收）

| 编号 | 约束 | 违反后的后果 |
| --- | --- | --- |
| **C1** | `clientDownloadUrl(runtimeBaseUrl?: string \| null): string \| null`，内部传 `runtimeBaseUrl`，**删除** `https://ecliptrix.app/download` 兜底，未知返回 `null`，两个调用点禁用按钮 | 自建用户继续被导向他人域名（可投毒） |
| **C2** | `.catch(() => {})` 必须改为**检查**失败并给出可见提示；判定用 `isAuthFailure()`，**不得**用 `instanceof Error` | 按钮点了没反应，用户以为坏了 |
| **C3** | 制品目录 `RELEASES_DIR`（默认 `./data/releases`）**不得**位于 `public/` 或 standalone 构建产物内；启动 `mkdir -p` | 线上上传的文件永远不会被服务 |
| **C4** | 唯一约束只允许 `UNIQUE(version, platform, arch)`；指针表主键 `(channel, platform)`；`channel` 只属于指针表 | macOS 无法上线；回溯语义歧义 |
| **C5** | `publish`/`rollback` 的目标必须 `status='published'`；`retract` 命中当前指针时同事务清空指针；指针写入单条 `UPDATE` + 审计 before/after | 悬空指针，`/download` 指向已撤回版本 |
| **C6** | 上传：`.incoming/*.part` → 边写边算 sha256 与字节数（超限即 abort）→ 校验非零 → `rename` → **最后** INSERT；失败删临时文件、不写行 | 半截包 / 有行无文件 |
| **C7** | 落盘名用 `${sha256}${ext}`，`file_name` 仅展示；写入前 `basename()` + 拒绝 `/ \ ..`；读取用 `resolve + startsWith` 校验 | 路径穿越、互相覆盖 |
| **C8** | 下载端点：`ETag=sha256`（带引号）、`Accept-Ranges`、206/416/304/HEAD 全部按 R-6(b) 表实现、`Cache-Control: private`、监听 `request.signal` 关流 | 下载器续传失败 / 句柄泄漏 |
| **C9** | 权限点五处齐改（两个 `PERMISSION_GROUPS` + `SYSTEM_ROLE_PERMISSIONS` + 中英 i18n 标签），并在 0006 里幂等 INSERT 到既有 `admin`/`support` 角色 | 线上 403（本地不复现） |
| **C10** | `minVersion` 联动：①`minVersion > latest published` → 拒绝（422）；②**没有任何 `published` 版本时，非空 `minVersion` 一律拒绝**（否则零产物 = 全员死锁且无出口）；③`minVersion=''` 永远允许；④UI 提示具体版本号 | 把闸门设成「无人可登录且无人可下载」 |

> C10 ② 是本节点新增的边界：原报告只写了「`minVersion` 不得高于最新已发布版本」，
> 漏掉「根本没有已发布版本」这一格——它恰好是全新部署的第一天，最容易被误设。

#### 3.2 验收增补（在 §6.9 之外，必须补的 7 条）

1. **Web 登录不受闸门影响**：`minVersion='99.0.0'` 时 `client:'web'` 登录成功
   （现状已被 `desktop-login.test.ts:203-225` 覆盖，**回归时不得删**）。
2. **无已发布版本时的空态**：`/download` 显示「尚未发布任何版本」，`/api/v1/downloads/…`
   返回 404/409 而**非** 500；同时 `PATCH /admin/settings` 设非空 `minVersion` 被拒。
3. **`Range` 全家桶**：206（前段 / 后缀式 / 到文件尾）、416（越界 + `Content-Range: bytes */N`）、
   304（`If-None-Match`）、HEAD。
4. **发布后落地页即时生效**：`POST publish` 后**不重建**，`GET /` 即显示新版本与平台。
5. **既有部署升级后 admin 可用**：用「已存在角色」的库跑迁移，admin 直接 `POST` 上传返回 200
   （不是 403）。
6. **上传原子性**：上传中途断开 → 无 `draft` 行、无残留文件；重复上传同版本 → 409 且原文件未被覆盖。
7. **cwd 无关性**：`npm run db:migrate` 连跑两次第二次 `nothing to do`；`RELEASES_DIR` 不存在时
   启动自动创建（不能因缺目录而 500）。

---

### 4. 未闭合事项（交给 Subtask #2 / #3）

| # | 事项 | 归属 |
| --- | --- | --- |
| 1 | 打包产物里真点一次阻断页按钮（§8.1 自述未做），并用 `desktop-config.json` 指向自定义 origin 验证白名单行为（§8.2） | Subtask #2 |
| 2 | 真机 188 MB 安装包上传 + 断点续传各一次（P1 末尾） | Subtask #2 |
| 3 | `client.minVersion` 与「最新已发布版本」的联动是**服务端强制**、UI 只反映（§6.6 第 4 条已写，验收要覆盖 422 分支） | Subtask #2 |
| 4 | `docs/plans/` 需要新增本特性的 spec 文件（仓库惯例：`docs/plans/<feature>/spec.md`），至少记录 C1–C10 与不做清单 | Subtask #3 |
| 5 | `webserver/docs/api.md`、`deployment-checklist.md`、`webserver/README.md` 三处文档需登记新端点、`RELEASES_DIR`、nginx 体积上限 | Subtask #3 |

---

### 附录 R-8：`webserver/` 现有 16 张表的完整清单（更正 §7.2「13 张表」）

`0001_init.sql`：`schema_migrations`(:12)、`roles`(:18)、`role_permissions`(:28)、
`users`(:34)、`sessions`(:66)、`registration_invites`(:88)、`password_reset_tokens`(:103)、
`login_attempts`(:115)、`audit_events`(:127)、`app_settings`(:148)；
`0002_hardening.sql`：`refresh_token_reuse_events`(:18)、`role_change_events`(:30)；
`0003_refresh_history.sql`：`refresh_token_history`(:12)；
`0004_device_identity.sql`：**无 `CREATE TABLE`**（仅 `ALTER TABLE sessions ADD COLUMN device_key`）；
`0005_account_lifecycle.sql`：`email_action_tokens`(:19)、`mail_outbox`(:41)、
`account_deletion_requests`(:66)。

合计 **16** 个 `CREATE TABLE` = 15 张业务表 + `schema_migrations`，与 §3.1 一致、与旧 §7.2 不一致。
其中最接近「与客户端版本有关」的是 `sessions.app_version`（`0001_init.sql:74`），
但那是**每次会话上报的客户端版本**，不是可下载的制品——两者不可混用。

---

## 实施过程发现的方案缺陷

> 本节由实现节点（Subtask #2）在落码过程中追加。判定标准：**只有「照方案做会出错」或
> 「方案与环境不符」才算缺陷**；纯粹的补充说明写在各条目的「处置」里。

### I-1（阻断级，已修）：`0006` 在本机是「空号」，`npm run db:migrate` 会静默跳过它

§6.2 假定 `0006_client_releases.sql` 就是下一个版本号，这对**本仓库的 git 血统**成立
（`git ls-files` 只有 0001–0005）。但本机 `webserver/data/dev.db` 的 `schema_migrations`
里，版本 6/7/8 已经被**另一套迁移血统**占用：

```text
(1,init) (2,hardening) (3,refresh_history) (4,device_identity) (5,account_lifecycle)
(6,api_gateway) (7,gateway_cost_observability) (8,gateway_dispatch)
```

迁移器**只按版本整数**判断是否已应用（`migrate.ts` 的 `appliedVersions` 收集的是
`Set<number>`），于是：

```text
npm run db:migrate
[db:migrate] ./data/dev.db — 6 migration(s), 0 pending
[db:migrate] nothing to do          <- 0006 被当成「已应用」，client_releases 表从未创建
```

**后果比一个 404 更隐蔽**：服务照常启动，`/api/v1/releases/latest` 第一次查
`client_releases` 就 500，而 `npm test` 全绿（测试用 `:memory:`，从 0001 重建）。这正是
诊断里反复点名的「本地绿、线上红」形状。

**处置（两件事，都在本次实现内）**

1. `src/server/db/migrate.ts` 新增 `assertNoVersionCollision()`：当磁盘上的迁移文件名与
   `schema_migrations` 已记录的同版本名不一致时**直接抛错**，消息同时给出「已记录的名字」
   「本树的文件」「下一步动作」。`runMigrations()` 与 `pendingMigrations()` 两侧都调用，
   所以 `AUTO_MIGRATE=false` 的部署同样会在启动时拒绝，而不是跑一半。
2. 迁移号**保持 0006**：本仓库的 git 血统到 5 为止，把新迁移写成 0009 等于把别人的血统
   永久编码进来；正确做法是让冲突可见（见 1），并让运维换一个干净的 `DATABASE_PATH`。

验收：`tests/integration/migrate.test.ts` 新增
「refuses to run when a version number is already applied under another name」；对干净库连跑
两次 `db:migrate` 第二次输出 `nothing to do`；对本机旧 `dev.db` 则给出上面的可读错误
（不是静默跳过）。

### I-2（需澄清，已按最小改动处置）：C10 没有覆盖「非空但不可排序」的 minVersion

C10 只约束了「> 最新已发布版本」与「零已发布版本」两种情形。而 `client.minVersion` 是一个
自由文本设置，既有的 `webserver/tests/unit/settings.test.ts:61-67` 明确钉着
「长度是上限，不是形状」（`1.0.0-alpha.20261008` 必须被接受，闸门本身对不可排序值 fail-open
并记一条 warn，见 `authService.assertClientSupported`）。

若按「不可排序也拒绝」实现，等于在方案之外新增一条规则并推翻既有契约。**处置**：
`assertMinVersionAllowed()` 在 `compareVersions() === null` 时**放行**，把形状交给控制台的
`VERSION_PATTERN` 与闸门自身的 fail-open；只有「零已发布」与「高于最新」两种情形 422。
这条要写进 Subtask #3 的文档，否则下一个人会以为漏了校验。

### I-3（配置默认值修正）：`RELEASES_DIR` 默认跟**数据库**同目录，不是跟 cwd

§6.4 写「默认 `./data/releases`，与 `DATABASE_ROOT` 同级」。相对于 cwd 的相对路径在
standalone 部署下会落到 `.next/standalone/data`——`deploy/webserver.service` 的
`ReadWritePaths=/opt/webserver/data` 不含它，上传时 EACCES。**处置**：默认值取
`dirname(DATABASE_PATH) + "/releases"`（`:memory:` 时回落 `cwd/data/releases`），并把
`RELEASES_DIR` 显式写进 `.env.example` 与 systemd unit。行为与方案意图一致，路径来源更硬。

### I-4（观察，不要「修」）：大文件响应在 Next 的流式路径上可能是 chunked，没有 `Content-Length`

R-6(b) 要求「无 Range → `200` + `Content-Length: N`」。实现确实设置了该头，单元级断言
（`releases.test.ts`）也验证了它。但在 `next dev`（以及 standalone 的流式响应路径）上实测，
Node 会把流式 body 改为 `Transfer-Encoding: chunked`，`Content-Length` 不出现在线上报文里：

```text
GET /downloads/stable/win  -> 200  读到 307200 字节  etag/accept-ranges/cache-control 正确
```

这不是缺陷：`200` + chunked 是合法的，浏览器照样显示进度；`Range` 请求（下载器续传的
真实形态）返回 `206` 时 `Content-Range` 带总长度，续传逻辑不受影响。**如果有人看到缺
`Content-Length` 就去「修」，会破坏流式响应。** 反代层不要加
`proxy_buffering on` 来「补回」这个头——188 MB 会被整段缓冲。

### I-5（已按 R-5(f) 落地，但补一条实现细节）：指针与制品状态的双重保险

R-5(f) 要求「指针只能指向 `published`」。实现里这一条由**两处**保证：写入路径
（`publishRelease` / `rollbackRelease` 的事务）与读取路径（`resolveDownload` 再次检查
`release.status === 'published'`）。第二处不是冗余——`client_release_channels.release_id`
的 `ON DELETE SET NULL` 只能处理被删除的行，处理不了「有人手工把 status 改回 retracted」，
而 `/download` 一旦把撤回的包发出去，用户装到的就是被明确撤回的构建。

### I-6（范围外但已记录）：既有 `data/dev.db` 需要运维动作

本机 `webserver/data/dev.db` 因 I-1 无法再启动（这正是新守卫的目的）。恢复方式二选一：
换一个干净的 `DATABASE_PATH`，或先 `npm run db:backup` 再人工核对
`schema_migrations` 后删除该文件。这一条只影响被污染的开发库，不影响 git 血统上的任何部署。
