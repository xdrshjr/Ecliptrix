# 客户端版本闸门高于「实际能下载到的构建」：一次回滚就把整支舰队永久锁在 426 上

> 诊断日期：2026-11-25（执行 `tge-ae88d085`，迭代 2/2，节点 #0，**只做定位与取证**）
> 范围声明：本节点**不改产品代码、不执行 `git commit`**。第 6 节是给修复节点的契约草案，
> 落地留给 Subtask #1–#3。
> 上一轮交付（commit `c72d994f`，67 文件 +6860/−104）已经把「网页端登录后下载客户端」
> 这条通道建起来了；本报告只看**这条通道自己还剩哪些能把用户锁死的缺口**，以及
> `docs/diagnoses/client-download-unavailable/analysis.md` 里那条「闸门不能高于可下载版本」
> 的护栏（C10）为什么仍然拦不住它。
>
> 阅读范围：`CLAUDE.md`（Account server / Desktop identity gate / Clean Code 约定）、
> `webserver/README.md`（客户端分发、安全模型、部署）、`webserver/docs/api.md`、
> `.claude-index/index.md`、`webserver/src/server/services/{releaseService,releaseUpload,releaseStorage,releaseRange,authService,settingsService}.ts`、
> `webserver/src/server/db/{migrations/0006_client_releases.sql,repositories/releasesRepo.ts}`、
> `webserver/src/app/api/v1/**`、`webserver/src/app/(marketing)/download/page.tsx`、
> `webserver/src/components/{console/releases-panel,console/settings-form,marketing/download-platform-button}.tsx`、
> `desktop/main/{index.js,authConfig.js,authController.js}`、`desktop/package.json`。
>
> 实测产物全部在 `evidence/`，复现脚本在 `repro/`（用法见附录 B）。

---

## 1. 问题描述（Problem description）

### 1.1 已经交付的能力（上一轮）

| 能力 | 落点 |
| --- | --- |
| 登录后下载安装包（鉴权 + 流式 + Range） | `GET /api/v1/downloads/{channel}/{platform}` |
| 管理员上传 / 发布 / 回溯 / 撤回 | `/admin/releases`、`POST|PATCH /api/v1/admin/releases` |
| 「当前是哪一版」 | `client_release_channels` 指针行，`(channel, platform)` 主键 |
| 版本闸门 | 设置项 `client.minVersion` → 桌面端登录 426 |
| 公开版本信息 | `GET /api/v1/releases/latest`、`GET /meta` 的 `latestClientVersion`/`downloadUrl` |

### 1.2 本轮要回答的问题

用户这条需求的本质不是「做一个下载页」，而是**「让每一个装过旧版的用户，永远有路走到新版」**。
上一轮修的正是「无路可走」（`/download` 曾经 404）。本轮要问的是：
**这条路上还有没有别的岔口，把它重新变成死路？**

结论：**有，而且有两条，其中一条只需要管理员做一次「正确的应急操作」就会触发。**

### 1.3 结论一览

| 编号 | 严重度 | 标题 | 一句话根因 | 证据 |
| --- | --- | --- | --- | --- |
| **A1** | **P0** | 闸门可以高于「渠道实际服务的版本」，回滚/撤回后整支舰队永久 426，且 426 指向的那个安装包正是被拒绝的版本 | `client.minVersion` 是自由文本设置，只在「设置写入」这一个入口校验一次；发布/回溯/撤回都不读它，读取侧也没有任何上界钳制 | 第 3.1 节 / `evidence/live-repro-transcript.txt` |
| **A1b** | **P0** | 目录版本号与安装包「自述版本号」从不核对：上传时填 `1.0.2`、包里自述 `1.0.1`，闸门设在 `1.0.2` 后**装完新包仍然进不去** | 上传只校验版本号形状；桌面端报的是 `app.getVersion()`（= `desktop/package.json`）；`sessions.app_version` 已在库里却从不参与对账 | 第 3.2 节 |
| **A2** | **P1** | 只发布到 `beta` 的构建会出现在公开 `/download` 的历史表，并能从 **stable** 字节端点下载 | 制品行不带 channel（有意），但 `history()` 与 `?release=` 两处都没有按 channel 过滤，四个面里两个隔离了、两个没有 | 第 3.3 节 / `evidence/beta-channel-leak.txt` |
| **A3** | **P2** | 撤回「当前版本」后渠道指针被清空，`/download` 变成「尚未发布任何版本」——尽管还有一个更旧的已发布版本可以直接用 | `retractRelease` 只清指针，不寻找继任者 | 第 3.4 节 / `evidence/unit-probe.txt` |
| **A4** | **P2** | `downloads` 计数统计的是「请求」不是「下载」：一次 200 记 1，同一次传输续传两次记 3；HEAD 记 0 | 计数发生在「响应产生」处，而 Range/续传是 188 MB 安装包的正常形态 | 第 3.5 节 |
| **A5** | **P3** | 设置页把闸门过高的**校验错误**渲染成了**状态文案**（「当前最新已发布版本：1.0.2」），拒绝那一屏没有半句「你会把所有人锁在外面」（现有那句正确文案被放在保存**之后**，且不比较大小） | `gateConflict()` 复用了 `admin.releases.latestHint` 这个状态 key；`admin.settings.minVersion.risk` 只用于 `toast.warning` | 第 3.6 节 |
| **A1c** | **P0（评审补登）** | 撤回**最后一个**已发布构建后，库里的闸门仍然非空、而渠道已没有任何东西可下：写侧「没有已发布版本就不许设闸门」这条规则**在读取侧被绕过**，全体 426 且 `/download` 只剩空态 | 撤回只清指针（`releaseService.ts:391-394`），闸门读取侧不校验「渠道是否有版本」 | 第 8 节 R-4 |
| **A6** | **P2（评审补登）** | 回滚后被回滚掉的那个构建仍出现在 `/download` 历史表里、状态被渲染成**「当前可用」**，并带一条真能下的链接——于是用户唯一的出路是装回被判坏的那一版 | `download/page.tsx:206-210` 只按 `status==='published'` 上色，`resolveExact` 也只按 published 放行 | 第 8 节 R-5 |

**为什么这些漏了？** 现有 333 个用例全绿（第 3.7 节），但它们覆盖的是「每个端点单独是否正确」，
没有一条覆盖「两个真值之间的一致性」：`client.minVersion` ≤ 可下载版本、channel 隔离、
撤回后仍可用、计数口径。A1/A1b 恰好都是**跨模块不变量**。

---

## 2. 复现步骤（Reproduction steps）

### 2.1 前置

```bash
cd webserver
npm install
```

准备一个**一次性数据库**（不要用 `webserver/.env` 指向的库），三个必需变量缺一不可：

```bash
DATABASE_PATH=<tmp>/repro.db
RELEASES_DIR=<tmp>/releases
PUBLIC_BASE_URL=http://127.0.0.1:8787
SESSION_SECRET=<任意 ≥32 字节随机串>
ROOT_ADMIN_EMAIL=owner@example.com
ROOT_ADMIN_PASSWORD=owner-password-123
AUTO_MIGRATE=true
```

> ⚠️ 本机实测的坑（附录 C）：如果外层 shell 里 `NODE_ENV=production`，
> `next dev` 会让 middleware 抛 `EvalError: Code generation from strings disallowed`，
> 于是**每个页面路由都 500**。这不是产品缺陷，是环境串味。
> 用 `probe-public-surfaces.mjs` 看页面时必须先 `NODE_ENV=development`。

### 2.2 A1 实时复现（一条命令，会话级证据）

```bash
# 终端 1
cd webserver && npm run dev          # 指向一次性数据库

# 终端 2
node docs/diagnoses/client-version-gate-lockout-after-rollback/repro/live-repro.mjs
```

实测输出（完整件：`evidence/live-repro-transcript.txt`，本次会话真实日志）：

```text
  this run uses 1.0.534 (kept) and 1.0.535 (withdrawn)

— operator signs in to the console
  web login: 200, cookie session established

— publish 1.0.534 on the stable channel
  served version: 1.0.534

— arm the version gate at 1.0.534 (allowed: it is what the channel serves)
  PATCH settings client.minVersion=1.0.534 → 200

— publish 1.0.535 and arm the gate at 1.0.535 (still allowed)
  PATCH settings client.minVersion=1.0.535 → 200

— 1.0.535 turns out broken: the operator rolls back (the documented remedy)
  PATCH rollback to 1.0.534 → 200
  channel now serves: 1.0.534
  stored client.minVersion: 1.0.535
  download page: http://127.0.0.1:8787/download

— a desktop client on 1.0.534 — the build the page now hands out — tries to sign in
  POST /api/v1/auth/login (clientVersion=1.0.534) → 426
  error_code: client_outdated
  details: {"minVersion":"1.0.535","downloadUrl":"http://127.0.0.1:8787/download"}

— … and a client on the withdrawn 1.0.535 gets in, which is the only way back inside
  POST /api/v1/auth/login (clientVersion=1.0.535) → 200

REPRODUCED: every desktop client on the served build is refused before the password is
checked, and the only build the 426 body can send them to is the one they already have.
```

**这五步里没有任何一步是误操作**：装发布包 → 设闸门（护栏 C10 允许）→ 发现新版有问题 →
回滚（README 与诊断报告都把它列为应急手段）。第 6 步的用户体验是：

1. 客户端 426「请升级到 1.0.535」；
2. 点「下载」→ `/download` 页面显示当前版本 **1.0.534**；
3. 装完 1.0.534，还是 426；
4. 循环。

> **评审订正（链路细节，会影响修复方式）**：第 2 步那个「下载」按钮的地址**不是**从 426 报文里取的，
> 而是客户端自己拼的——`src/lib/api/authBridge.ts:703-705` `clientDownloadUrl(runtimeBaseUrl)`
> 返回 `${origin}/download`，用在 `src/components/auth/LoginScreen.tsx:125` 与
> `src/components/auth/AuthBlocker.tsx:64`。全仓库对 `details.downloadUrl` 的消费是**零**
> （`desktop/` 与 `src/` 里 `downloadUrl` 的 grep 命中只有上面这三处合成点）。加上渲染进程在**表单之前**
> 就用 `/meta` 的 `minClientVersion` 做了同样的比较（`LoginScreen.tsx:51-55` `isClientOutdated()`），
> 用户连密码框都看不到。结论不变（两条路都通向同一个死循环），但**不要指望改 426 的 `downloadUrl`
> 能改变用户体验**：真正决定用户看到什么的，是 `/meta.minClientVersion` 和 `/download` 服务的版本。

### 2.3 同一时刻两个公开面自相矛盾（`evidence/public-surfaces.txt`）

```text
GET /api/v1/meta
  minClientVersion    = 1.0.535      <- 要求 ≥ 1.0.535
  latestClientVersion = 1.0.534      <- 唯一能下载到的是 1.0.534
  downloadUrl         = http://127.0.0.1:8787/download
GET /api/v1/releases/latest
  release.version     = 1.0.534
GET /download
  status              = 200
```

一个 payload 里同时说着「你必须 ≥ 1.0.535」和「最新可下载是 1.0.534」。
**这就是「服务端知道怎么救，但做错了」的形态**，比 404 更难排查：页面是好的，包是真的，
装上了却还是进不去。

### 2.4 A1 单测级复现（6 个用例，`evidence/unit-probe.txt`）

```bash
cp docs/diagnoses/client-version-gate-lockout-after-rollback/repro/gate-and-channel.probe.test.ts \
   webserver/tests/integration/
cd webserver && npx vitest run tests/integration/gate-and-channel.probe.test.ts
```

断言的是**当前（错误的）行为**，所以全绿即证据：

```text
[probe1] served=1.0.2 gate=1.0.3
[probe1] download page offers=1.0.2 url=http://127.0.0.1:8787/download
[probe2] retract+republish: served=1.0.2 gate=1.0.3      <- 撤回+重发也救不回来
[probe3] public history versions=2.0.0,1.0.2             <- beta 版进了公开历史
[probe3] GET /api/v1/downloads/stable/win?release=<beta 2.0.0> → 200
[probe4] after one 200: 1, after the same transfer resumed twice: 3
[probe4b] HEAD → 200, downloads=0
[probe5] latestPublished=null apiRelease=null            <- 撤回当前版本后页面变空态
```

### 2.5 A1b 变体：版本号对不上（无需回滚）

**本条是结构性结论**：本次会话没有真的安装一个伪造版本的 exe（需要重新打包安装包），
证据是「任意版本号都能被接受」的实测 + 三条代码事实（第 3.2 节）。

本次会话中真实跑通的请求（`evidence/live-repro-transcript.txt`、
`evidence/beta-channel-leak.txt`）：`version` 分别填 `1.0.483`、`1.0.484`、`1.0.534`、
`1.0.535`、`9.9.563`，**全部 201 接受**，服务端从未打开安装包去核对它自称什么版本：

```bash
# 形状（本次实测同形请求均 201；版本号由 `^\d+(\.\d+){1,3}$` 校验，仅此而已）
POST /api/v1/admin/releases?version=<任意 x.y.z>&platform=win&arch=x64&fileName=Ecliptrix-Setup.exe
PATCH /api/v1/admin/settings {"client.minVersion":"<同一个 x.y.z>"}   # → 200
```

此后每一个真实安装包自述的都是 `desktop/package.json:3` 的 `1.0.1`
（取值链：`desktop/main/index.js:131 appVersion: app.getVersion()` →
`index.js:248 clientVersion: authConfig.appVersion` → `authController.js:853`），
所以**装完这个 1.0.536 也仍然报 1.0.1 → 仍然 426**。这条路径连「回滚」都不需要，
而且 A1 的读侧钳制（第 6 节）**修不了它**：钳制后闸门 = 1.0.536 = 渠道服务版本，
服务端视角完全自洽，用户却依然永远过不去。

### 2.6 A2 复现（`evidence/beta-channel-leak.txt`）

```bash
node docs/diagnoses/client-version-gate-lockout-after-rollback/repro/probe-beta-leak.mjs
```

```text
— upload 9.9.563 and publish it ONLY to the beta channel
  PATCH publish channel=beta → 200
— what the STABLE channel says it serves (correct: the beta build is not current)
  stable current = 1.0.534
  beta current   = 9.9.563
— what the public /download page renders for a signed-out visitor
  GET /download → 200
  page mentions 9.9.563: true
— GET /api/v1/downloads/stable/win?release=<beta build>, signed in as a plain user
  status = 200, bytes = 4096, sha256 in header = c9ac7b06…
```

未发布的 beta 构建被公开页面当作「当前可用」列出来，并且能通过 **stable** 地址拿到字节。

### 2.7 A3 / A4 / A5

见第 2.4 节的 `probe5` / `probe4` 两行输出，以及第 3.4–3.6 节的代码引用。

---

## 3. 根因分析（Root cause analysis）

### 3.1 A1：闸门是一次写入校验的自由文本，读取侧无上界

**写入侧只有一处校验。** `settingsService.patch` 对**变更过的** `client.minVersion`
调用 `releaseService.assertMinVersionAllowed`：

```ts
// webserver/src/server/services/settingsService.ts:244
if (key === 'client.minVersion' && rawValue.trim() !== current[key]) {
  try {
    releaseService.assertMinVersionAllowed(rawValue)
```

```ts
// webserver/src/server/services/releaseService.ts:88-98
export function latestPublishedVersion(channel: string = DEFAULT_RELEASE_CHANNEL): string | null {
  const versions = releasesRepo.listCurrent(getDb(), resolved).map((row) => row.version)…
```

也就是说 C10 的语义是：**「你保存的那一刻，渠道路上有这个版本」**。

**读取侧没有任何上界。** 桌面端每次登录都从设置里原样取：

```ts
// webserver/src/server/services/authService.ts:199-215
const minVersion = settingsService.getString('client.minVersion').trim()
…
if (!isVersionOutdated(clientVersion, minVersion)) return
throw errors.clientOutdated(minVersion, releaseService.downloadPageUrl())   // :227
```

**两个「移动发布」的动作都不碰它。** `rollbackRelease`（`releaseService.ts:318-376`）
与 `retractRelease`（`:385-407`）只写指针表：

```ts
// releaseService.ts:391-394
inTransaction(db, () => {
  releasesRepo.markRetracted(db, id, now)
  releasesRepo.clearPointersFor(db, id, audit.actorUserId, now)
})
```

**时序（这就是 bug 的全部）**

```text
t0  发布 1.0.534        pointer=(stable,win)→534
t1  闸门 = 1.0.534      C10: 534 ≤ 服务的 534  ✓ 允许
t2  发布 1.0.535        pointer=(stable,win)→535
t3  闸门 = 1.0.535      C10: 535 ≤ 服务的 535  ✓ 允许
t4  回滚到 1.0.534      pointer=(stable,win)→534   ← 闸门仍是 535，无人再过问
t5  任何 1.0.534 客户端登录 → 426 "请升级到 1.0.535"
t6  426 里的 downloadUrl → /download → 只给 1.0.534
t7  用户装完 1.0.534 → 回到 t5，永久循环
```

C10 是**瞬时**判断（保存时刻），而这条链路是**长期漂移**（之后任一发布动作都会改变
「可下载版本」这个真值）。护栏守住了入口，没有守住出口。

**为什么连审计里也看不出问题**：`releases.rollback` 的 metadata 只记了 before/after 指针
（`releaseService.ts:362-374`），没有记「闸门现在高于它」——事故复盘时看审计日志，
一切正常。

**控制台没有任何提示**：`/admin/releases` 表头只显示「当前最新已发布版本」
（`webserver/src/components/console/releases-panel.tsx:118-129`），
而 `client.minVersion` 这个字符串在**整个发布控制台里一次都没出现**（`grep` 结果：
`webserver/src/components/console/` 下只有 `settings-form.tsx` 引用它）。
运营看到的是「我回滚成功了」，看板上没有任何红字。

### 3.2 A1b：目录版本号 vs 安装包自述版本号，从不核对

| 事实 | 引用 |
| --- | --- |
| 上传的版本号只校验**形状** | `webserver/src/server/services/releaseUpload.ts:71-73`（`isReleaseVersion`），`webserver/src/lib/releases.ts:81` `^\d+(\.\d+){1,3}$` |
| 服务端从不读安装包里的版本资源 | 全文 `releaseUpload.ts`：只做 sha256 / 字节数 / 扩展名 / 落盘，没有任何 PE 解析 |
| 桌面端报给闸门的是 Electron 的 app 版本 | 真实调用链（评审逐行核对，原文此处行号有误）：`desktop/main/index.js:242` `appVersion: app.getVersion()`（`readAuthConfig` 实参）→ `desktop/main/index.js:248` `clientVersion: authConfig.appVersion`（`createAccountClient`）→ `desktop/main/authConfig.js:215` `appVersion` 出参 → `desktop/main/authController.js:1053`（**登录** `loginPayload()`）/ `:853`（**注册**）。注意 `index.js:131` 的 `appVersion: app.getVersion()` 是**另一个消费者**（`initUserData({...})`，写 `desktop-config.json` 的 `lastRunVersion`），**不在鉴权链路上** |
| 该版本就是构建时的 package.json | `desktop/package.json:3` `"version": "1.0.1"` |
| 打包过程不会改写它（评审反证已排除） | `desktop/electron-builder.yml` 全文无 `extraMetadata`、无 `version` 覆盖，`:87` 只是 `artifactName: ${productName}-Setup-${version}.${ext}`；`desktop/scripts/build.js:446` 只**读**该字段用于 `Ecliptrix-Setup-${version}.exe`（`:448`），全仓无任何脚本回写 `desktop/package.json`。磁盘上现存的产物就是 `desktop/release/Ecliptrix-Setup-1.0.1.exe` |
| 「设备自述版本」其实已经存在库里 | `webserver/src/server/db/migrations/0001_init.sql:74` `app_version TEXT NOT NULL DEFAULT ''`，由 `authService.ts:359,402,563` 写入 |

**所以「目录里的版本号」和「用户装完之后的版本号」是两个从不交汇的字段。**
两者一旦不一致，闸门就要求一个**根本不存在**的版本：服务器认为已经发布了 1.0.536，
用户装完仍然自称 1.0.1。这与 A1 是**同一类失败**（闸门要求不可达版本），但触发条件更简单
（一个手滑的版本号，不需要任何应急操作），而且 A1 的读侧钳制对它无效。

值得注意的是：`sessions.app_version` 让服务端**本来就能**知道舰队实际在报什么版本——
这个数据被写进库后再没有被读过一次（没有任何报表或告警消费它）。

### 3.3 A2：channel 只活在指针表里，历史与 `?release=` 都不看它

数据模型是**有意**这么设计的（`0006_client_releases.sql:21-24`）：

```sql
--  3. The pointer table carries the channel, the artifact rows do not. A build
--     can therefore be promoted from `beta` to `stable`, … as one pure pointer move
```

「制品行不带 channel」本身没错（它让晋升变成一次指针移动），错的是**下结论说
「所以任何地方都不需要 channel 判断」**。四个面里两个判了、两个没判：

| 面 | 是否按 channel 过滤 | 引用 |
| --- | --- | --- |
| `GET /releases/latest` | ✅ | `webserver/src/app/api/v1/releases/latest/route.ts:19-26` |
| 下载端点（当前版本） | ✅ 指针按 `(channel, platform)` 查 | `releaseService.ts:236-247` |
| 下载端点（`?release=<id>`） | ❌ **完全不看 channel** | `releaseService.ts:251-262` |
| 公开历史 `history()` | ❌ 无 channel 参数 | `releaseService.ts:193-195` → `releasesRepo.ts:94-103` |

```ts
// webserver/src/server/services/releaseService.ts:251 — 注释自称 channel-scoped
/** One named build, served regardless of which build the channel points at now. */
function resolveExact(channel: ReleaseChannel, platform: string, releaseId: string) {
  const release = releasesRepo.findById(getDb(), releaseId)
  if (!release || release.platform !== platform || release.status !== 'published') { … }
```

`channel` 参数进来了，却**只被原样塞进返回值**，从未参与任何过滤。而 `DownloadTarget.channel`
的注释（`:55-56`）写着「a named build is still channel-scoped」——注释与实现相反。

`/download` 页面把两者拼在一起，于是泄漏可见（`src/app/(marketing)/download/page.tsx:44,51-52,193-231`）：

```ts
const history = releaseService.history(20)                       // 所有 channel 的行
const downloadBase = (platform, releaseId) =>
  `${releaseDownloadPath(channel, platform)}?release=…`          // channel 恒为 stable
```

后果：beta 构建出现在公开页、标着「当前可用」、点一下就能下。**一个「beta 通道」如果
内容对所有人可见可下，它就不是通道，只是标签。**

### 3.4 A3：撤回只清指针，不找继任者

```ts
// releaseService.ts:385-407
export function retractRelease(id, audit) {
  inTransaction(db, () => {
    releasesRepo.markRetracted(db, id, now)
    releasesRepo.clearPointersFor(db, id, audit.actorUserId, now)
  })
```

当被撤回的正是指针目标时，指针被清成 `NULL`，`latestPublished()` 返回 `null`，
`/download` 走空态分支（`download/page.tsx:81-92`：「尚未发布任何版本」），
`/releases/latest` 也回 `null`——尽管同一平台上还有一个**已发布、可直接服务**的旧版本。
实测：`[probe5] latestPublished=null`，而 `history()` 里 1.0.2 仍是 `published`。

运营的意图是「把坏的撤下来」，实际效果是「把整条分发链路撤下来」，然后必须再手动发布一次
（而这一步没有任何地方提示）。

### 3.5 A4：计数口径是「响应产生」而不是「传输开始」

```ts
// src/app/api/v1/downloads/[channel]/[platform]/route.ts:131
releaseService.noteDownload(release.id)
```

- 一次 200 全量下载 → **1**；
- 同一次传输被下载器续传两次（`Range: bytes=0-1023`、`bytes=1024-`）→ **3**（实测 `probe4`）；
- `HEAD`（下载器和浏览器都会先探）→ 不计（`:115-117` 提前返回）。

对 188 MB 的安装包来说，「一次下载 = 一次请求」是最不成立的假设。这个数字会显示给运营
（`releases-panel.tsx:140,184`、`/admin` 的统计卡 `admin/page.tsx:47`），越被下载器
正常使用，越偏高。

### 3.6 A5：校验错误复用了状态文案

```ts
// src/components/console/settings-form.tsx:40-49
const latest = await fetchLatestClientVersion()
if (latest === null) return tt('admin.settings.minVersion.unpublished')
const comparison = compareVersions(minVersion, latest)
return comparison !== null && comparison > 0
  ? tt('admin.releases.latestHint', { version: latest })   // ← 「当前最新已发布版本：1.0.2」
  : null
```

`admin.releases.latestHint`（`src/lib/i18n.ts:462`）是发布面板表头的**状态**文案。
它被当作字段错误显示时，运营看到的是「当前最新已发布版本：1.0.2」——
既没说哪错了，也没说后果。服务端其实有正确文案（`releaseService.ts:134-143`：
「最低版本不能高于已发布的最新版本 / 当前最新已发布版本是 X，闸门不能高于它」），
但前端预检先拦住了提交，运营永远看不到服务端那句话。

> **评审订正（“没有半个字”只在提交前的报错路径上成立）**：仓库里**确实**有一条说得清楚的文案，
> `webserver/src/lib/i18n.ts:414` `'admin.settings.minVersion.risk'`
> ＝「提醒：此值高于线上版本会让所有旧客户端无法登录，请先确认已发布对应版本」（en：`:924`）。
> 它被用在 `settings-form.tsx:131`——**保存成功之后**的 `toast.warning`，而且触发条件只有
> `minVersion !== ''`，**不做任何比较**：安全值（1.0.2 ≤ 1.0.534）也照样弹，真正越界时它又来得太晚
> （写库已经完成）。因此 A5 的准确表述是「**拒绝发生的那一屏用错了文案，正确文案被放到了保存之后、
> 而且没有条件**」，而不是「产品里没有这句话」。另外 `settings-form.tsx:85-87` 的注释
> （“the server only validates the shape”）自 C10 起已经**过期**——服务端早已按发布目录校验，
> 这条过期注释正是 A5 一直没被发现的认知来源。

### 3.7 为什么 333 个用例全绿

本轮开始时实测：`cd webserver && npm test` → **30 文件 / 333 用例全绿**
（耗时 96s，末态与上一轮一致）。

现有用例覆盖的是**单元边界**：Range 解析表、上传原子性、指针移动、权限、C10 写入校验。
缺的是**跨模块不变量**，而这些恰恰是本报告的全部内容：

| 缺失的不变量 | 对应用例 |
| --- | --- |
| 闸门 ≤ 渠道实际服务版本（**长期**成立，不只保存那一刻） | 写入那一刻**已有**用例：`webserver/tests/integration/releases.test.ts:343-406`（`describe('client.minVersion guard (C10)')`，含 `:350` 「只按 stable 在服版本度量」、`:392` 「拒绝高于最新已发布版本」、`:370` 「未变更的值不重校验」）；**长期**成立无用例——新用例只需补「保存之后发生 publish/rollback/retract」这一段，不要重复写这 4 条 |
| 闸门要求的版本必须是「装完能过关」的版本（自述版本对账） | 无 |
| 非当前渠道的构建不出现在公开面、不可从别的 channel 下载 | 无 |
| 撤回当前版本后渠道仍可服务（继任者） | `releases.test.ts:291-306` 断言的是**当前（错误的）**行为（撤回后指针清空、`latestPublished()` 为 null），修 A3 时这条用例本身要**改写**，不是新增 |
| `downloads` = 下载次数（而非请求次数） | `releases.test.ts:546-556` 只覆盖「一次 GET 记 1」，续传与 HEAD 无用例 |

---

## 4. 影响面（Impact surface）

### 4.1 谁会被影响

| 角色 | 影响 |
| --- | --- |
| **桌面端用户（全体，A1/A1b）** | 新装、重装、换机、退出后重新登录 → 426，且无路可升级。**已登录且 token 未过期的用户暂时不受影响**（`authService.ts:187-195` 明确把 heartbeat/refresh/logout 排除在闸门外），所以症状是「一部分人还能用、一部分人突然进不去」，最难被当成事故上报 |
| **运营/管理员** | 事故中必须从浏览器控制台改设置才能止血；而控制台本身**不提示**闸门与在服版本的关系，也没有任何入口能一眼看到 |
| **beta 测试用户（A2）** | 反向受害：beta 构建无法真正保密，任何人都能从公开页拿到未发布版本 |
| **客服/支持** | 426 报文里唯一给出去的信息是「请升级到 1.0.535」+ 一个只能下到 1.0.534 的页面，支持无法自证 |

### 4.2 受影响的功能面

| 功能 | 状态 |
| --- | --- |
| 桌面端登录（`client=desktop`） | **完全不可用**（426 在密码校验之前） |
| 桌面端注册 | 同闸门（`authService` 同一函数） |
| `/download` 页面 | 可用但对用户是死路（承诺与结果不一致） |
| 426 恢复路径 | 断（指向被拒绝的版本） |
| 管理控制台的发布操作 | 可用且「看起来成功」，无风险提示 |
| `downloads` 统计 | 数字不可信（A4） |
| beta 通道隔离 | 失效（A2） |

### 4.3 不受影响（避免误判排查面）

- **Web 端登录/控制台**：闸门只对 `client === 'desktop'` 生效（`authService.ts:198`），
  所以管理员永远能进控制台止血——这是这个设计的唯一幸运之处。
- 已持有有效会话的桌面端：heartbeat / refresh / logout 不看闸门。
- Range / 流式下载本身：上一轮的实现是对的（206/416/304 均有测试）。

### 4.4 业务影响

`webserver/README.md:116` 自己写着：「桌面端没有自动更新，**`/download` 是唯一升级路径**。
这条链路因此是产品可用性的一部分」。A1 让这条唯一路径在**最需要它的时刻**（刚出事故、
刚回滚）失效；A1b 让它在**和平时期**也可能永久失效。对一个单机 Electron 产品，
这等价于「已安装用户无法恢复出厂可用状态」。

---

## 5. 候选修复方案对比（Candidate fixes）

### 5.1 A1：闸门高于在服版本

| 方案 | 做法 | 侵入性 | 风险 | 工作量 | 评价 |
| --- | --- | --- | --- | --- | --- |
| **A1-1 读侧钳制（fail-safe）** | 新增 `releaseService.effectiveMinVersion(stored)`：`min(stored, latestPublishedVersion)`（无发布时视为不设闸门），`authService` 改用它 | 小：1 个新函数 + 1 处调用 | 极低。语义变成「闸门永远要求一个能拿到的版本」；不写库、不动数据 | 0.5 天 | **必做**。它同时覆盖 CLI / 手改库 / 未来任何新写入者 |
| **A1-2 写侧拒绝** | `publish/rollback/retract` 若会让在服版本低于闸门 → 409 `gate_conflict`，要求先降闸门 | 中：3 个服务动作 + 控制台错误处理 | 中。**恰好在最需要一键回滚的事故现场增加一步**，可能被绕过（关掉闸门再回滚，反而更慢） | 1 天 | 不推荐单用 |
| **A1-3 写侧自动下调 + 审计** | 指针移动与「闸门下调到新在服版本」在同一事务；写 `settings.client_gate_relaxed` 审计行，响应体带 `gateAdjusted:{from,to}`，控制台 toast | 中：`releaseService` 三处 + 响应契约 + i18n | 中低。需要明确「这不是安全闸门，是可运维的分发闸门」 | 1 天 | **推荐与 A1-1 一起做**：A1-1 保证不锁死，A1-3 让这件事**有记录、有提示**，而不是悄悄发生 |
| A1-4 控制台加提示（不加逻辑） | `/admin/releases` 显示闸门值与「闸门高于在服版本」红字 | 小 | 低，但**只是提示**，事故里照样会点下去 | 0.5 天 | 建议作为 A1-3 的展示层一部分 |

### 5.2 A1b：目录版本 vs 自述版本

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
| --- | --- | --- | --- | --- |
| **A1b-1 上传时校验自述版本** | 上传接受 `appVersion` 参数（构建脚本本来就知道），存 `app_version` 列；与 `version` 不一致直接 422；PE 资源解析留作可选增强 | 中：迁移 0007 + 上传校验 + 控制台表单字段 | 低（多一个必填项，但把错误挡在发布之前） | 1.5 天 |
| **A1b-2 运行期对账与告警** | 用已有的 `sessions.app_version` 出「舰队自述版本分布」，当**闸门 > 舰队最高自述版本 且 查询窗口内有登录**时在控制台红字 + 审计 | 小：1 个只读聚合查询 + 控制台卡片 | 低；纯观测，不动闸门语义 | 1 天 |
| **A1b-3 取消自由文本闸门** | `client.minVersion` 增加模式 `follow_release`（默认）= 「等于 stable 在服版本」，`manual` 才允许自由填 | 中：设置项语义 + 控制台 + `authService` 取值 | 中：改动用户可见语义；但**A1 与 A1b 在默认路径上一起消失** | 1.5 天 |

推荐：**A1b-1 + A1b-2**（先挡住 + 先看见），A1b-3 作为下一轮的产品化方向。

### 5.3 A2：channel 泄漏

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
| --- | --- | --- | --- | --- |
| **A2-1 发布目标表** | 新表 `client_release_publications(release_id, channel, published_at)`，`publishRelease` 写入；`listVisible(channel)` 与 `resolveExact` 按它过滤；回填既有行（published→stable） | 中：迁移 0007 + 仓储 + 2 个调用点 | 低。保留「晋升」语义（一版可同时在两 channel） | 1 天 |
| A2-2 只看指针 | 公开历史只列当前指针的那一行 | 极小 | 高：会删掉「历史版本可回取」这个明确承诺（README:119-120） | 0.5 小时 |
| A2-3 删掉 beta | `RELEASE_CHANNELS = ['stable']`，CLI/API 一并收窄 | 小 | 低，但**功能缩水**：已经在用的 `?channel=beta` 会 404 | 0.5 天 |
| A2-4 只修 `resolveExact` | 让 `?release=` 校验「该构建已在请求的 channel 发布过」 | 极小 | 中：历史表仍把 beta 构建列出来，点了才知道不行（同样的死路，只是搬到点击之后） | 0.5 小时 |

推荐：**A2-1**。若产品确定不要分阶段渠道，**A2-3** 是诚实的次优解（比留着半个通道好）。

### 5.4 A3 / A4 / A5

| 编号 | 方案 | 侵入性 | 风险 | 工作量 |
| --- | --- | --- | --- | --- |
| A3-1（推荐） | 撤回指针目标时，同一事务内把指针移到该 `(channel, platform)` 下**最新仍 published** 的构建；审计 `releases.repoint`，metadata 带 `reason:'retract'`；无继任者才清空 | 小：`retractRelease` 内一段 | 低。行为可预测、可审计 | 0.5 天 |
| A3-2 | 拒绝撤回指针目标（409 `needs_successor`），要求先指定继任者 | 小 | 中：事故中多一步，且没有「全都不能用」时的出路 | 0.5 天 |
| A4-1（推荐） | 只在「传输开始」计数：`range.kind === 'full'` 或 `partial && range.start === 0`，HEAD 不计；列注释改为「downloads started」 | 极小：下载路由 1 处 | 极低。数字仍是近似，但不再随续传线性膨胀 | 0.5 小时 |
| A4-2 | 按 `(release, 用户/IP, 小时)` 去重，需要新表 | 中 | 中：多写一份状态，收益有限 | 1 天 |
| A5-1（推荐） | 新增 `admin.settings.minVersion.aboveServed`（中英），`gateConflict` 用它；文案与服务端一致，包含「现行版本 X、闸门 Y、会让旧客户端无法登录」 | 极小 | 无 | 0.5 小时 |

---

## 6. 推荐方案（Recommended fix）

### 6.1 要守住的不变量（每一条都能直接写成用例）

1. **闸门可达**：任何时刻，生效的 `client.minVersion` ≤ stable 渠道当前服务的版本；
   渠道无版本时视为不设闸门。→ 一条 1.0.x 客户端永远不会被要求一个下不到的版本。
2. **闸门自洽**：生效闸门对应的构建，其自述版本必须 ≥ 闸门（A1b 后由上传校验保证）。
3. **渠道隔离**：只在 `beta` 发布过的构建，不出现在公开 `/download`，也不能从 `stable`
   的字节端点下载。
4. **撤回可用**：撤回当前版本后，渠道仍服务该平台最新的已发布构建（若有），并被审计。
5. **计数口径**：`downloads` 统计「开始的下载」，不随续传重复计数，不把 HEAD 当下载。
6. **可见性**：控制台在「闸门 > 在服版本」时给出可见告警（这条是 UI 契约，不是业务逻辑）。

### 6.2 分阶段落地（建议顺序）

**P0（先止血，可独立上线）**

- `releaseService.effectiveMinVersion()`（A1-1）+ `authService.ts:199` 改用它；
- 下载/发布动作在同一事务内下调闸门并写审计（A1-3）+ 响应 `gateAdjusted`；
- i18n：`admin.settings.minVersion.aboveServed`（A5-1）；
- 用例：不变量 1、5、6。

**P1（隔离与可观测）**

- `client_release_publications` 迁移 + `listVisible(channel)`/`resolveExact(channel)`（A2-1）；
- 控制台 `/admin/releases` 表头显示闸门 + 在服版本 + 红字（A1-4）；
- 「舰队自述版本」聚合查询与告警（A1b-2）；
- 用例：不变量 3。

**P2（产品化与补齐）**

- 上传携带并校验 `app_version`（A1b-1，迁移 0007 与上面合并）；
- 撤回继任者（A3-1）；
- 下载计数口径（A4-1）；
- 迁移版本冲突断言（上一轮已加过的同款检查）复用。

### 6.3 契约变更（需要同步 `webserver/docs/api.md`）

```text
PATCH /api/v1/admin/releases/{id}   {action:'publish'|'rollback'|'retract'}
  200 新增可选字段：gateAdjusted: { from: string, to: string } | null
        （发生时同一事务内已下调 client.minVersion，并写审计 settings.client_gate_relaxed）

GET /api/v1/admin/releases
  新增：minVersion: string          // 生效闸门
        gateSatisfiable: boolean    // minVersion === '' || minVersion <= latestVersion

GET /api/v1/releases/latest
  不变（release 为空仍是 null）；公开历史语义收紧为「该 channel 发布过的构建」

GET /download
  历史表加 channel 归属；不再列从未在该 channel 发布过的构建
```

### 6.4 验收清单（修复节点照此逐条勾）

- [ ] 实时复现脚本从「REPRODUCED」变为「NOT REPRODUCED」：
      `node docs/diagnoses/client-version-gate-lockout-after-rollback/repro/live-repro.mjs`
      退出码 1（现在退出码 0）。
- [ ] `probe-beta-leak.mjs` 同样反转，且 `/download` HTML 不再包含 beta 版本号。
- [ ] `gate-and-channel.probe.test.ts` 的 6 个断言全部反向后通过（作为回归用例永久留在
      `webserver/tests/integration/`）。
- [ ] 撤回当前版本后 `latestPublished()` 返回**旧版本**而非 `null`（除非确实没有别的已发布版本）。
- [ ] 一次 200 + 两次续传 → `downloads` 只 +1；HEAD 仍不计。
- [ ] `client.minVersion` 高于在服版本时，`/admin/settings` 字段错误文案包含
      「会让所有旧客户端无法登录」语义（而非状态文案）。
- [ ] `cd webserver && npm test` 全绿（当前基线：30 文件 / 333 用例）；`npm run type-check`
      与 `npm run lint`（`--max-warnings 0`）零输出。
- [ ] `/api/v1/meta` 的 `minClientVersion` 与 `latestClientVersion` 不再同时出现「前者更高」。

### 6.5 为什么这是最小改动而不是「重写分发」

上面每一条都是**在一个已存在的函数里加一层判断**：闸门钳制是 `authService` 一行取值，
撤回继任者是 `retractRelease` 内一段，channel 过滤是两个仓储查询的参数，计数是一个 `if`。
没有一条要求改动数据模型之外的结构，没有一条引入新依赖，也没有一条触碰已经正确的
Range / 上传原子性 / 权限矩阵实现。

---

## 7. 本轮未做的事与后续建议

- **未改任何产品代码**，未 `git commit`（节点约束）。所有改动建议停留在第 5、6 节。
- **未做的事故演练**：建议在修完之后做一次「假装 1.0.x 有问题」的完整演练
  （发布 → 设闸门 → 回滚 → 用旧客户端登录），把第 6.4 节变成 SOP。
- **未覆盖的能力建议**（不属于 bug，供产品决策）：
  1. 桌面端「有新版本可用」的主动提示（`/meta` 已有 `latestClientVersion`，客户端未消费）；
  2. 下载统计按日聚合与来源（渠道/平台），`downloads` 单列整数不够运营用；
  3. beta 订阅（用户主动选择「我要测试版」），这是 A2 之后渠道语义真正落地的形态；
  4. 安装包完整性校验在客户端的落地（页面已展示 SHA-256，客户端下载时不校验）。

---

## 8. 评审补充与订正（Review additions and corrections）

本节是**高级评审**对第 1–7 节的逐条核对结果：既有「原报告结论成立」的确认，也有三处**证据/表述必须订正**
的地方，以及两条**原报告漏掉的 P0/P2 缺口**（已补登为 A1c、A6）。所有引用都已按当前磁盘逐行复核。

### R-1 闸门的「校验」与「写库」不在同一事务 → 只做写侧规则不可能 airtight（订正 A1-1/A1-2 的取舍依据）

`settingsService.patch` 在循环里校验，返回后**另一条语句**才写库：

```ts
// webserver/src/server/services/settingsService.ts:244-253（校验）
if (key === 'client.minVersion' && rawValue.trim() !== current[key]) {
  try { releaseService.assertMinVersionAllowed(rawValue) } catch (error) { … }
}
// webserver/src/server/services/settingsService.ts:258-262（抛错）
//   → 中间没有事务
// webserver/src/server/services/settingsService.ts:267（写库）
settingsRepo.setMany(getDb(), accepted, actorUserId, now)
```

`inTransaction` 只定义在 `webserver/src/server/db/repositories/shared.ts:17`，`settingsService.ts`
对它**零引用**（grep 核对）。而 `assertMinVersionAllowed` 内部读的是指针表
（`releaseService.ts:88-98` → `releasesRepo.listCurrent`）。SQLite 的单写者只串行化**写**，不串行化
「读指针 → 判断 → 写设置」这个窗口：并发的 `rollback`/`retract` 可以在两者之间移动指针。

**对修复的影响**：任何「发布时若闸门过高则拒绝 / 自动下调」的写侧方案都只能是**建议性**的；
只有读取侧钳制才能给出「无论谁在什么时候写了什么」的保证。这条把 A1-1 从「必做之一」升级为
**唯一能把不变量变成结构性质的地方**。

### R-2 A1-3（自动下调闸门）会**静默销毁运营意图**——不建议做（与原推荐的偏离）

原报告把 A1-3 与 A1-1 并列为「推荐一起做」。评审认为 A1-3 有真实回归，理由是一条**允许的**正常序列：

1. 闸门 = 1.0.535；回滚到 1.0.534 → A1-3 把库里值改成 1.0.534 并写审计；
2. 事故修好，**重新发布 1.0.535**——这是被明确允许且有用例的行为
   （`webserver/tests/integration/releases.test.ts:326` `lets a rolled-back-to build be published again`）；
3. 闸门**不会**回到 1.0.535：库里已经是 534，运营必须记得再改一次。
   而运营当初设 535 的意图（旧客户端必须升级）恰恰在此刻最需要生效。

对比 A1-1（读侧钳制）：库里的 535 原样保留，`min(535, 在服 534) = 534` 只作用于**当下**；
重新发布 535 后自动恢复成 535，**不需要任何人记得**。
另外 A1-3 会让 `releaseService` 直接写 `app_settings`，绕过 `settingsService`——把「设置只有一个写入者」
这条隐性约定拆掉，为下一个 bug 铺路。**结论：A1-3 不做；把它的「可见性」部分降级成 A1-4（只告警、不改值）。**

### R-3 A1b 的证据链已闭合，且当前实现下**它只在 version==1.0.1 时自洽**

原报告称 A1b 是结构性结论（未真装一个伪造版本的 exe）。评审补齐了缺失的反证，链现在闭合：

| 待证 | 证据 |
| --- | --- |
| 自述版本恒等于 `desktop/package.json` | `desktop/main/index.js:242` `appVersion: app.getVersion()` → `:248` `clientVersion: authConfig.appVersion` → `desktop/main/authConfig.js:215` → `desktop/main/authController.js:1053`（登录）/ `:853`（注册） |
| 打包**不会**改写它 | `desktop/electron-builder.yml` 无 `extraMetadata`/`version` 覆盖（`:87` 只用 `${version}` 命名产物）；`desktop/scripts/build.js:446-448` 只**读**；全仓无回写脚本；现存产物 `desktop/release/Ecliptrix-Setup-1.0.1.exe` |
| 服务端从不核对包内版本 | `webserver/src/server/services/releaseUpload.ts:71-73` 只校验形状；全文无 PE/资源解析 |

**由此得到一个比原文更强的判断**：这套「目录版本 + 闸门」当前**只有在上传时手填 `1.0.1` 时才自洽**。
任何大于 1.0.1 的目录版本都是「装完仍报 1.0.1」的构建，闸门一旦设在该版本就是永久锁死；而 A1 的
读侧钳制**在数学上救不了它**（钳制结果＝在服版本＝1.0.536 > 自述 1.0.1）。这与 A1 同类，但触发条件
是「一次手滑」，不需要任何应急操作，**因此 A1b 必须由第二条独立改动解决，不能算进本次修复**（见“评审结论”四）。

顺带补一条产品缺口的引用：`/meta` 的 `latestClientVersion`（`settingsService.ts:319`）在桌面端
`normaliseServerMeta`（`desktop/main/authController.js:1237-1261`）**根本没有被保留**，返回对象里
没有这个键——所以第 7 节第 1 条「有新版本可用」的主动提示今天连数据通道都还没接上。

### R-4 新缺口 A1c（P0）：撤回**最后一个**已发布版本，写侧规则被读取侧绕过

| 步骤 | 行为 | 引用 |
| --- | --- | --- |
| 1 | 有已发布版本 + 闸门非空，状态合法 | `releaseService.ts:112-145`（C10 只在**设值**时管） |
| 2 | 撤回该版本 → 指针清空 | `releaseService.ts:391-394` → `releasesRepo.ts:194-200` `release_id = NULL` |
| 3 | 发布/撤回路径**不看闸门** | `releaseService.ts:385-407`（`retractRelease` 全文无 `minVersion`） |
| 4 | `listCurrent` 返回 `[]` → `latestPublishedVersion()` → `null` | `releaseService.ts:88-98`；`releasesRepo.ts:224-234` |
| 5 | 但 `authService` 只看存值，**没有「渠道为空」的分支** | `authService.ts:199-200` |
| 6 | 结果：全体桌面端 426；`/download` 空态；字节端点 404 | `releaseService.ts:236-239`；`download/page.tsx:81-92` |

写侧那条「没有已发布版本就不许设闸门」（`releaseService.ts:116-127`）**只在保存那一刻成立**——
这正是 A1 的同一条根因（护栏守入口、不守出口）在「撤回」动作上的第二个出口。
A1-1 的钳制天然覆盖它：渠道服务为空 ⇒ 视为不设闸门（fail-open，与既有 `parseVersion` 失败即放行的
哲学一致）。

### R-5 新缺口 A6（P2）：回滚掉的构建在历史表里被标成**「当前可用」**并带真链接

- 历史表的状态列只按 `status === 'published'` 上色：`webserver/src/app/(marketing)/download/page.tsx:206-210`；
- 文案 `webserver/src/lib/i18n.ts:76` `'download.state.published': '当前可用'`（en `:586` `'Available'`）；
- 行内链接对 published 行一律给出：`page.tsx:220-226`；
- 端点只校验 published + 平台：`releaseService.ts:251-262` `resolveExact`。

于是「回滚到 1.0.534」之后，`/download` 顶部写着 **当前版本 1.0.534**，下面的历史表里 1.0.535
仍标着 **「当前可用」**并可以下载。这解释了两件事：

1. `evidence/public-surfaces.txt` 里 `/download` 的 HTML **含 1.0.535**（不是页面在说谎，是历史行）；
2. A1 的死循环**不是绝对无路**——唯一的路是装回运营刚刚判定为「有问题」的那一版
   （`evidence/live-repro-transcript.txt` 末行：「a client on the withdrawn 1.0.535 gets in,
   which is the only way back inside」）。

这条把 A1 的描述从「永久 426、无路可走」修正为「**唯一出路是装回被判坏的构建**」——对用户是同一场事故，
但它同时说明：修复必须让「被服务的构建」成为可达的那个，而不是让用户去下被回滚的那一个。

### R-6 426 报文里的 `downloadUrl` **没有任何消费者**（证据的口径订正）

第 2.2 节把「点下载 → /download」写成 426 报文驱动，实际不是：

- 全仓 `downloadUrl` 在 `desktop/` 与 `src/` 的命中只有三处，全部是**合成**：
  `src/lib/api/authBridge.ts:703-705` `clientDownloadUrl(runtimeBaseUrl)` → `${origin}/download`；
  调用点 `src/components/auth/LoginScreen.tsx:125`、`src/components/auth/AuthBlocker.tsx:64`；
- 桌面端在**表单之前**就自己判了一次：`LoginScreen.tsx:51-55` `isClientOutdated()` 比较
  `status.appVersion` 与 `status.server.minClientVersion`（来自 `/meta`）；
- 登录失败时只出文案：`desktop/main/authController.js:1048-1056` 的登录体里没有 `downloadUrl`，
  426 只映射成 `client_outdated` 文案键。

**对修复的影响（本节最重要的一条）**：只改 `authService.ts:199` 会**修不完整**。
桌面端渲染进程独立从 `/meta` 读 `minClientVersion`（`settingsService.ts:318`）并在表单之前拦截，
所以钳制必须落在**两个读点**：登录权威（`authService.ts:199`）与 `publicMeta`（`settingsService.ts:318`）。
否则 API 已经允许登录，用户界面依旧停在「请升级到 1.0.535」——**症状不变，回归测试还会因为只测 API 而变绿**。
（这也解释了为什么 A1 的实时复现脚本只测 HTTP，永远看不到这一层。）

实现约束：`settingsService.ts:3` 已经 `import * as releaseService`，因此
`releaseService.effectiveMinVersion` **必须接收已读出的存值作参数**，不能在 releaseService 内反向
import settingsService（会形成循环依赖）。

### R-7 证据件的口径需要收紧（不推翻结论，但原文有两处引用过强）

| 证据件 | 实际能证明 | 不能证明 |
| --- | --- | --- |
| `evidence/unit-probe.txt` | 真实 vitest 输出（ANSI、banner、`Tests 6 passed`），A1/A1b 之外的 A1/A2/A3/A4 全部命中；用的是真服务与真路由，只有 HTTP 传输层被绕过 | 覆盖不到 A1b、A5；落盘文件名是 `tests/integration/zz-probe-client-release-gaps.test.ts`，与包内 `gate-and-channel.probe.test.ts` 不同名 |
| `evidence/live-repro-transcript.txt` | 是 `live-repro.mjs` 的**stdout**，能证明 426 + `details{minVersion,downloadUrl}` + 被回滚版本可登录 | 不是原始 HTTP 报文（无时间戳/头/令牌）；脚本**只断言** `blocked.status===426 && served.version===OLDER && allowed.status===200`，`details` 与两个 PATCH 状态只是打印、未断言 |
| `evidence/public-surfaces.txt` | `/meta` 与 `/releases/latest` 同时说出 535 与 534，矛盾真实存在（可由 `settingsService.ts:318-320` 直接推出） | `probe-public-surfaces.mjs` 的判定是 `min !== latest`（**不等**，不是「更高」），健康的 `1.0.2` vs `1.0.534` 也会让它「成立」——它的退出码只能说明两个数不同 |
| `evidence/beta-channel-leak.txt` | beta-only 构建出现在公开历史，且能从 `stable` 地址取到字节（200） | 文案说的「未登录访客」与「普通用户」都不成立（脚本带 owner cookie）；`sha256` 只是把 DB 里的值打印出来，脚本只比较**长度**，不比对内容 |

结论：A1/A2/A3/A4 的**第一手证据成立**（尤其 unit-probe 与 live-repro），但
`public-surfaces` 与 `beta-channel-leak` 两件的**叙述**要按上表降级；修复节点的验收应以
`gate-and-channel.probe.test.ts`（断言当前错误行为、绿灯即复现）为准，而不是以这两个 mjs 的退出码为准。

### R-8 A2 的「最小修复」被高估：`beta` 目前**没有消费者**

- 控制台只认 stable：`webserver/src/components/console/releases-panel.tsx:64,304`（`DEFAULT_RELEASE_CHANNEL`），
  UI 里**没有**渠道选择器；
- `/download`、`/meta`、426 报文、桌面端全部硬编码 stable（`download/page.tsx:47`、
  `settingsService.ts:318-320`、`releaseService.ts:73-75`）；
- `beta` 只在两处可达：CLI `webserver/scripts/release-publish.ts:57` 与裸 API
  （`schemas.ts:292` 的 `channel`）。

所以 A2-1（新建 `client_release_publications`）是为一个**没有客户端能订阅**的渠道加表 + 迁移 + 回填；
A2-3（删掉 beta）反而把一个 bug 类直接消灭。**这是产品决策而非代码决策**：
若要留 beta，A2-1 成立且必须做全（历史 + `resolveExact` 两处都过滤，只做一处就是原文批评的“搬到点击之后”）；
若不打算做 beta 订阅，A2-3 更诚实。两种选择都**不影响** A1 的修复内容。

### R-9 两处注释与实现相反，修复时必须一并改掉

| 位置 | 注释说的 | 实际做的 |
| --- | --- | --- |
| `webserver/src/server/services/releaseService.ts:55-56` | “a named build is still channel-scoped” | `:251-262` 的 `channel` 只进返回值，从不参与过滤（`docs/api.md:531-533` 也只承诺 published + 平台，所以是**注释**错、文档对） |
| `webserver/src/components/console/settings-form.tsx:85-87` | “the server only validates the shape” | `settingsService.ts:244-253` 已按发布目录校验（C10） |

第二条尤其重要：它正是 A5 长期没被发现的认知来源，也是运营以为「前端拦住了就没问题」的由来。

---

## 附录 A：证据文件清单

| 文件 | 内容 |
| --- | --- |
| `evidence/live-repro-transcript.txt` | A1 端到端实测（真实 HTTP 完整会话，退出码 0 = 缺陷复现） |
| `evidence/public-surfaces.txt` | 同一时刻 `/meta`、`/releases/latest`、`/download` 的自相矛盾 |
| `evidence/beta-channel-leak.txt` | A2 端到端实测 |
| `evidence/unit-probe.txt` | 6 个 vitest 断言，覆盖 **A1（含撤回变体）/A2/A3/A4（含 HEAD）**；**不含 A1b、A5**（见 R-7） |
| `repro/live-repro.mjs` | A1 实时复现（可重复运行，版本号按时间生成） |
| `repro/probe-public-surfaces.mjs` | 公开面矛盾取证 |
| `repro/probe-beta-leak.mjs` | A2 实时复现 |
| `repro/gate-and-channel.probe.test.ts` | 单测级复现（拷进 `webserver/tests/integration/` 即可跑） |

## 附录 B：复现脚本用法

```bash
# 1) 一次性数据库 + 开发服务器（不要用真实库）
cd webserver && npm run dev

# 2) 三个脚本，退出码 0 = 缺陷复现
#    ⚠️ 口径（R-7）：live-repro.mjs 与 probe-beta-leak.mjs 的退出码可信；
#       probe-public-surfaces.mjs 的判定是「两个数不相等」，健康状态也会返回 0，
#       只能当取证打印看，不要写进验收条件。
node docs/diagnoses/client-version-gate-lockout-after-rollback/repro/live-repro.mjs
node docs/diagnoses/client-version-gate-lockout-after-rollback/repro/probe-beta-leak.mjs
node docs/diagnoses/client-version-gate-lockout-after-rollback/repro/probe-public-surfaces.mjs

# 3) 单测级
cp docs/diagnoses/client-version-gate-lockout-after-rollback/repro/gate-and-channel.probe.test.ts \
   webserver/tests/integration/
cd webserver && npx vitest run tests/integration/gate-and-channel.probe.test.ts
```

## 附录 C：本机环境注记（不是产品缺陷，但会误导取证）

1. **`NODE_ENV=production` 串味 → 每个页面 500。**
   本会话的 shell 里 `NODE_ENV=production`，而 Next 的**真实环境变量优先于 `.env`**。
   于是 `next dev` 用生产 CSP 打包 middleware，首个页面请求抛
   `EvalError: Code generation from strings disallowed for this context`
   （`webserver/.next/server/middleware.js`），`/download` 变 `500`/`404`。
   `GET /api/v1/**` 不受影响（matcher 排除了 api），所以 API 取证是可信的；
   页面取证必须显式 `NODE_ENV=development`。
   我第一次跑出的 `/download → 500` 就是这个原因，**不是**产品缺陷，已排除。
2. **登录带上会话 Cookie 会被 CSRF 拒绝。**
   `auth/login/route.ts:33`：带 `ecs_session` 的登录按会话固定攻击处理（`csrf_failed`）。
   复现桌面端登录时必须先清空 cookie jar——桌面端本来就没有 cookie。
3. **`next dev` 的首次编译会让首个请求慢 1-2 秒**，看 `426` 时不要误判为超时。

---

## 评审结论

> 评审范围：第 1–7 节的根因证据、候选修复与验收清单；结论以「当前磁盘上的代码」为准，
> 每条都可用文中的 `path:line` 复核。评审只改本文档，不动产品代码、不 `git commit`。

### 一、证据链裁决（先说结论，再给唯一推荐）

| 编号 | 裁决 | 依据（本文档内已补齐引用） |
| --- | --- | --- |
| **A1** | **成立，且比原文描述更严重** | 写入侧只有 `settingsService.ts:244` 一处、且与写库不同事务（R-1）；读取侧 `authService.ts:199` 无上界、无「渠道为空」分支；`rollback`/`retract` 均不读闸门（`releaseService.ts:318-407`）。原文「无路可走」应订正为「**唯一出路是装回被回滚的那一版**」（R-5），并补上 A1c —— 撤回最后一个版本是**同一个**根因的第二个出口（R-4） |
| **A1b** | **成立，且是「当前只在 1.0.1 时自洽」** | 自述版本链 `index.js:242→:248→authConfig.js:215→authController.js:1053`（原文行号有误，已订正）；打包不改写（`electron-builder.yml` 无 `extraMetadata`）；服务端只校验形状（`releaseUpload.ts:71-73`）。**闸门钳制对它无效**（R-3） |
| **A2** | **成立，但「最小修复」被高估** | 制品行确实没有 channel 列，`listVisible` 与 `resolveExact` 都不按渠道过滤（`releasesRepo.ts:94-103`、`releaseService.ts:251-262`）。但 `beta` 今天**没有任何消费者**（控制台 / `/download` / `/meta` / 桌面端全硬编码 stable），所以 A2-1 与 A2-3 是产品取舍，不是技术高下（R-8） |
| **A3** | **成立，并在「闸门已武装」时升为 P0** | `retractRelease` 只清指针（`releaseService.ts:391-394`）；与 A1 叠加即为 A1c（R-4）。原 P2 的定级只适用于「未设闸门」的部署 |
| **A4** | **成立，定级合理（P2）** | `route.ts:131` 在响应产生处计数，`route.ts:115-117` HEAD 提前返回；续传按请求累加。修法就是 A4-1 那个 `if`，无争议 |
| **A5** | **成立，但表述要改** | 拒绝那一屏确实用状态文案（`settings-form.tsx:46-48` + `i18n.ts:462`）。但「没有半个字」不成立：`i18n.ts:414` 的正确文案存在，只是被放在**保存成功之后**且**不比较大小**（`settings-form.tsx:131`）（§3.6 订正） |
| **A1c / A6** | **新增（原报告漏项）** | 见 R-4 / R-5 |

A1/A2/A3/A4 的主证据（`live-repro.mjs` + `unit-probe.txt`）是**真跑出来的**；
但 `probe-public-surfaces.mjs` 的退出码不能作为证据（它判「不相等」而非「更高」），
`probe-beta-leak.mjs` 的「未登录访客」标签不实——两件的叙述已按 R-7 收紧，**结论不受影响**。

### 二、最终推荐修复：**唯一的 P0 修复 = 闸门的读取侧钳制（A1-1），落在两个读点**

```ts
// webserver/src/server/services/releaseService.ts —— 新增，纯函数，无新依赖
/**
 * 生效的闸门：min(存量值, 渠道当前服务的版本)；渠道无版本或值不可排序时返回 ''（= 不设闸门）。
 * 存量值必须由调用方传入：settingsService 已 import 本模块，反向 import 会成环。
 */
export function effectiveMinVersion(stored: string, channel = DEFAULT_RELEASE_CHANNEL): string
```

两个调用点，缺一不可：

1. `webserver/src/server/services/authService.ts:199` —— 换成 `effectiveMinVersion(settingsService.getString('client.minVersion'))`，
   `:215` 的比较与 `:227` 的 426 报文都用钳制后的值（用户被告知的「目标版本」必须是他真能下到的那个）；
2. `webserver/src/server/services/settingsService.ts:318` `publicMeta()` 的 `minClientVersion` —— **同一函数**。

**为什么是这一条，而不是别的：**

- **它把不变量变成结构性质**：无论写入者是控制台、CLI、手改库、还是未来某个新脚本，
  「生效闸门 > 在服版本」在读取时即被消解。写侧规则做不到（R-1：校验与写库不同事务）。
- **它一次覆盖三个出口**：回滚（A1）、撤回最后一个（A1c）、无发布（原文 C10 的空渠道分支）。
- **它保留运营意图**：存量值不被改写，重新发布更高版本后闸门自动恢复（R-2 反证了 A1-3 会丢这个性质）。
- **它是最小改动**：1 个纯函数 + 2 行调用 + 1 条 warn 日志（钳制发生时必须留痕，复用 `authService.ts:205` 那条 warn 形式）。
  0 迁移、0 新依赖、0 权限变更、0 契约变更，不触碰已正确的 Range/上传/权限实现。
- **两个读点不是「多做一步」而是必需**：桌面端渲染进程独立从 `/meta` 读 `minClientVersion` 并在表单之前拦截
  （`LoginScreen.tsx:51-55`）。只改服务端登录会让 **API 放行、界面照旧锁死**，而只测 API 的回归用例还会全绿（R-6）。

**明确否掉的两个候选：**

- **A1-2（发布侧拒绝 + 409）**：既不能 airtight（R-1），又恰好把「一键回滚」变成「先降闸门再回滚」，
  在最需要快的事故现场增加两步，运营会用「关掉闸门 → 回滚 → 忘了开回来」绕过它——把锁死换成静默失效。
- **A1-3（自动下调 + 审计 + `gateAdjusted`）**：会静默销毁运营意图（R-2 的三步序列），
  且让 `releaseService` 越过 `settingsService` 直写设置。它的价值（让人看见）用 **A1-4 的控制台只读告警**即可满足。

### 三、验收：新增 4 条 + 1 条对第 6.4 节的修订（否则「修好了」是假绿）

- [ ] **`/meta.minClientVersion` 与登录实际生效的闸门相等**：回滚后 `/meta` 返回 `1.0.534`
      （而不是只断言 `POST /auth/login` 返回 200 —— 这条才是渲染进程的判据）。
- [ ] **A1c**：撤回最后一个已发布版本后 `/meta.minClientVersion === ''` 且桌面端登录 200（fail-open）。
- [ ] **无循环依赖**：`releaseService.ts` 不出现 `import … settingsService`（`grep -c settingsService` 为 0）。
- [ ] **存量值未被改写**：回滚后 `GET /admin/settings` 里 `client.minVersion` 仍是 `1.0.535`；
      重新发布 1.0.535 后生效闸门恢复为 1.0.535（这是有意为之，用来防止后来者「顺手」把 A1-3 加回来）。
- [ ] 原 6.4 全部保留；其中 `probe-public-surfaces.mjs` 那条**删除**（R-7：它的判定不成立），
      改用 `gate-and-channel.probe.test.ts` 反向后全绿 + `live-repro.mjs` 退出码翻成 1。

### 四、这一条修复**覆盖不到**的（必须各自独立排期，不得并入本次改动）

| 项 | 为什么钳制救不了 | 最小做法 |
| --- | --- | --- |
| **A1b** | 数学上无效：钳制＝在服 1.0.536 > 自述 1.0.1，用户仍然过不去 | 写边界对账：上传/发布时要求 `appVersion` 且与 `version` 一致（迁移 + 控制台字段 + CLI 参数），并用已存在的 `sessions.app_version` 出「舰队自述版本」看板做运行期兜底 |
| **A2** | 与闸门无关 | 二选一：A2-3（删 beta，诚实且最小）或 A2-1（publications 表，历史与 `resolveExact` **两处都过滤**）；顺带修 `releaseService.ts:55-56` 的反向注释 |
| **A3** | 钳制让「空渠道」不再锁人，但 `/download` 仍是空态、用户仍无包可下 | `retractRelease` 同事务挑继任者（该 `(channel, platform)` 下最新 published），审计 `reason:'retract'` |
| **A4** | 无关 | `range.kind === 'full' \|\| range.start === 0` 才计数，列注释改为 downloads started |
| **A5** | 无关 | 拒绝路径改用 `admin.settings.minVersion.risk` 的语义（现成文案 `i18n.ts:414`），并把 `toast.warning` 改成**只在真冲突时**弹；同时删掉 `settings-form.tsx:85-87` 的过期注释 |
| **A6** | 无关 | 历史表状态列区分「当前服务中 / 仍可下载 / 已撤回」，不要对任何 published 行都写「当前可用」 |

**优先级建议（P0 → P2）**：本结论第二节（唯一 P0，立刻做）→ A1b 的写边界对账（第二个 P0，
与本次解耦但不要拖过下一轮）→ A5 + A4（半小时级，顺手清掉）→ A3 → A2（先做产品决策）→ A6。

### 五、残余风险（这条修复本身引入的）

- **fail-open 的方向性代价**：渠道服务为空、值不可排序、或存量高于在服时，闸门**退让**。
  这与既有 `parseVersion` 失败即放行、`assertMinVersionAllowed` 对不可排序值放行的哲学一致，
  但意味着「设了闸门却没发布对应版本」会**静默失效**。补偿手段必须是可观测的：
  钳制发生时打一条 warn（带 `stored` 与 `served`）+ 控制台红字（A1-4）。
- **不做 A1-3 的代价**：事故后库里会长期留着一个高于在服的存量值，运营在控制台看到的字段值
  与「实际生效」不一致。这是**有意选择**（保住意图 + 可自动恢复），必须由 A1-4 的只读告警
  把「字段值 ≠ 生效值」显式说出来，否则运维会以为自己改错了。
- **回滚方式**：改动集中在 1 个函数 + 2 行调用，`git revert` 一条提交即回到当前行为，无数据迁移需要回退。

### 六、本节点未做的事

- 未改任何产品代码、未 `git commit`（节点约束）；第 6 节与本节都只是**契约**。
- 未跑修复后的回归（`npm test` 基线 30 文件 / 333 用例仍是当前状态），验收勾选属于修复节点。
- 未做事故演练，也未触及第 7 节列出的产品化能力（beta 订阅、按日聚合统计、客户端校验和校验）。

## 实施过程发现的方案缺陷

> 修复节点（Subtask #2）落地的就是「评审结论」第二节那一条（A1-1 读取侧钳制，两个读点）。
> 下面只登记**实现时与原方案文本不一致的一处细节**，以及一处**与本次改动相邻、但按规矩没有碰**
> 的既有缺陷。方案的主结论（唯一 P0 = 读取侧钳制；A1-2 / A1-3 否决）在实现过程中**再次被证实**，
> 没有推翻。

### D-1（细节订正）「值不可排序时返回 `''`」应改为「原样返回」，否则会删掉既有的诊断路径

原方案（评审结论第二节代码块）写的是：

```ts
/** min(存量值, 渠道当前服务的版本)；渠道无版本或值不可排序时返回 ''（= 不设闸门） */
export function effectiveMinVersion(stored: string, channel?: string): string
```

照字面实现会有一个副作用：`authService.ts:201-207` 那条「值不可排序 ⇒ 闸门让开 + 打 warn」
的分支从此**永远走不到**（钳制函数已经先把它变成 `''`，`minVersion === ''` 直接 return），
于是「设了一个谁也解析不了的闸门」这件事从"有日志的静默失效"退化成"完全无痕"。
`publicMeta()` 也会把一个运营显式写下的值报成 `''`，控制台看到的字段值与生效值凭空变成两回事。

实现采用：**无法排序的值原样返回**（`compareVersions(...) === null` 时 `return trimmed`）。
两条读点的**行为**与返回 `''` 完全相同（都不会拦人，都是 fail-open），区别只在痕迹：

- 登录侧保留原有 warn `client.minVersion is not comparable; version gate skipped`；
- `/meta` 原样透出该值，与 `authService` 用的是同一个值，不存在"服务端认 X、界面认 Y"。

回归用例 `clamps numerically, leaves unorderable values to the caller and never widens` 断言了
这一条（`effectiveMinVersion('1.0.9-beta.1') === '1.0.9-beta.1'`）。若评审认为应严格按原文本返回
`''`，改动只有一行，但请同时决定那条 warn 是否保留。

### D-2（未修，告知后续节点）`webserver/scripts/smoke.mjs` 的闸门断言已过期，且比本轮更早

`scripts/smoke.mjs:353-408` 仍然按「闸门可以随便设」写：

```js
PATCH /admin/settings { 'client.minVersion': '9.9.9' }   // 期望 200
… outdated.json?.error?.details?.minVersion === '9.9.9'  // 期望 426 报文原样回报
```

其中「期望 200」**从上一轮 C10 落地起就已经不可能**（没有任何已发布版本时非空闸门一律 422），
与本轮无关；「期望 426 且 details 是 9.9.9」则被本轮钳制改成「在服版本」或直接不触发 426
（渠道没有版本时闸门为空）。该脚本不在 `npm test` 里、需要连着一个活服务器跑，且属于「相邻的
既有缺陷」，按本节点「不夹带无关清理」的约束**没有改**。建议在它所属的那次改动里改成
「先发布一个版本 → 在它上面武装闸门」的正规序列。

## 交付评审与提交（Subtask #3）

> 评审节点：只审 + 补 + 提交，不扩大范围。结论以磁盘上的 diff 为准，下列每条都可用
> `git show <fix 提交> -- <path>` 复核。

### 一、逐条对照（diff ↔ 评审结论第二节 / 第三节 / 第五节）

| 要求 | 落地情况 |
| --- | --- |
| 纯函数 `effectiveMinVersion(stored, channel = stable)`，无新依赖 | `releaseService.ts:130`，只复用既有 `compareVersions` / `isReleaseVersion`；`releaseService.ts` 里 `settingsService` 零命中（无环，验收第 3 条 ✅） |
| 读点 1：登录判定用钳制值，比较 / 审计 / 426 报文三处一起换 | `authService.ts:203-217`：`minVersion` 一个变量贯穿 `parseVersion` 判定、`auditService.record({ clientVersion, minVersion })`、`errors.clientOutdated(minVersion, downloadPageUrl())` |
| 读点 2：`/meta.minClientVersion` 用同一函数 | `settingsService.ts:325`；桌面渲染进程确实读它（`src/components/auth/LoginScreen.tsx:51-55` 的 `isClientOutdated`），所以两处必须相等 |
| 钳制必须留痕 | `authService.ts:213` 的 warn（带 `stored` / `effective`），实测每发生一次钳制就有一行，见第三、4 |
| 存量值永不被改写（R-2） | 只读不写：`effectiveMinVersion` 无任何 SQL，`app_settings` 的写入口仍只有 `settingsService.patch` |
| fail-open 不新增第二个规则 | 不可排序值原样返回（D-1 裁决见下），由 `authService` 既有的 `parseVersion` 分支继续「让开 + warn」 |
| 显式不做 A1b / A2 / A3 / A4 / A5 / A6 | 一个都没碰：提交只含 3 个源文件、1 个测试、4 份文档与本文档 |

**代码侧没有发现需要改的缺陷。** 复核要点：`compareVersions` 与 `parseVersion` 同源
（`webserver/src/lib/releases.ts`），钳制与被比较两侧「可比 / 不可比」的判据不可能分叉；闸门为空时
`effectiveMinVersion` 提前返回、不查库，未武装闸门的常规登录路径零额外查询；钳制只能**降低**闸门，
既不放宽也不改写运营意图。

### 二、D-1 裁决：保留「不可排序时原样返回」

按实现保留，不改回 `''`。复核确认：`parseVersion('1.0.9-beta.1')` 为 `null`（只收点分数字），
所以两个读点对同一个值的行为完全一致（都 fail-open），差别只在**痕迹**——登录侧保留
`client.minVersion is not comparable; version gate skipped` 那条既有 warn，`/meta` 原样透出运营
写下的值。改成 `''` 会静默删掉一条诊断路径，还让控制台字段值与生效值凭空分叉。

### 三、本次修掉的问题（全是「同一契约的残留陈述」，不是夹带清理）

代码没问题，但**四份文档仍在按修复前的契约描述闸门**，读者据此会得出错误结论：

1. `webserver/docs/api.md:58`（错误码表）：426 仍写「低于 `client.minVersion`」→ 改为「低于生效闸门，`details.minVersion` 永远是可下载的版本」。
2. `webserver/docs/api.md:138`（`/meta` 字段表）：`minClientVersion` 仍写「最低桌面客户端版本」→ 补上「存量值与 stable 在服版本取小，可能与 `/admin/settings` 的存量值不同」。
3. `webserver/README.md:229`（桌面端能力一节）：仍写「`client.minVersion` 非空时」→ 改为生效闸门公式，并点明渠道无版本 = 不设闸门（否则运维会误以为「清了发布就自然有闸门」）。
4. `webserver/docs/deployment-checklist.md:123-126`：仍要求运维「存量值高于当前发布版本就在下次保存时清掉」——**这现在是错的**：钳制之后该存量值正是「钉在刚发布的这版」这一意图本身，清掉才是丢意图。

其余钳制说明（`api.md:183`、`api.md:489` 的引用块、`docs/desktop-integration.md:306`、
`README.md:135-139`）由修复节点写过，评审确认与代码一致，未再改动。

### 四、独立验证（评审节点自己跑出来的，不是引用修复节点的记录）

1. **实时复现脚本反转**：`node docs/diagnoses/client-version-gate-lockout-after-rollback/repro/live-repro.mjs`
   → 回滚后 `clientVersion=1.0.752` 登录 **200**、`1.0.753` 登录 200、末行 `NOT REPRODUCED.`、
   **退出码 1**（脚本约定 0 = 缺陷复现）。一次性库 `.agentmesh/repro-run/repro.db`，`NODE_ENV=development`。
2. **两个读点相等 + 426 报的是可下载版本**（评审新写的 `.agentmesh/probe-readpoints.mjs`）：

   ```
   arm at 1.0.900 → 200; arm at 1.0.901 → 200
   rollback to 1.0.900 → 200
   stored client.minVersion = "1.0.901"
   /meta.minClientVersion = "1.0.900"
   /meta.latestClientVersion = "1.0.900"
   login 1.0.899 → 426 client_outdated
     details = {"minVersion":"1.0.900","downloadUrl":"http://127.0.0.1:8787/download"}
   login 1.0.900 (served) → 200
   login 1.0.901 (withdrawn, newer) → 200
   PASS
   ```

3. **A1c**：`node .agentmesh/probe-a1c.mjs` → 撤回唯一指针后 `/meta.minClientVersion=""`、
   `/meta.latestClientVersion=null`、存量值仍是 `1.0.753`、老客户端 `1.0.100` 登录 200。
4. **钳制留痕**（服务端日志原文）：
   `{"level":"warn","msg":"client.minVersion clamped to the version the channel serves","stored":"1.0.901","effective":"1.0.900"}`；
   撤回后同一行为 `"effective":""`。
5. **全量校验**：`npm test` → **30 文件 / 336 用例全绿**（基线 333 + 新增 3）；`npm run type-check`
   → 零输出 exit 0；`npm run lint`（`--max-warnings 0`）→ 零输出 exit 0。

### 五、已知残留（明确不在本次提交里）

- **A1b / A2 / A3 / A4 / A5 / A6**：评审结论第四节要求各自独立排期，本次一个都没碰。
- **A1-4（控制台只读告警）**：仍只有服务端 warn。运维在 `/admin/settings` 看到的仍是存量值，
  与生效值不一致时只有日志能说明——建议与 A5 的文案改动一起做。
- **D-2（`scripts/smoke.mjs` 闸门断言过期）**：仍未修。该脚本全文没有发布/下载步骤
  （`releases` 零命中），要修先得给它加一段「上传 + 发布」序列，属于它所属的那次改动。
- 桌面端 `desktop/` 零改动：钳制在服务端完成，渲染进程读的是 `/meta`，无需改客户端。
