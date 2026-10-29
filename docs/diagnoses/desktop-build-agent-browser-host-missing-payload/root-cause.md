# 诊断报告:桌面端打包中止于 `main/agentBrowserHost.js` 载荷断言

- **Bug 标识**: `desktop-build-agent-browser-host-missing-payload`
- **诊断日期**: 2026-10-29
- **主 Bug 状态**: 已修复并已验证(`npm run build` 退出码 0,产出安装包)
- **附带发现**: 五条,编号 A、B-1、B-2、C、D。其中 **A、B-1、B-2、C 已修复
  并在打包产物上验证**;**D(冒烟门禁把运行中的应用判成残留进程)代码已修在
  工作区,打包态门禁尚未重跑**,它是今天最后一条红灯,亮在门禁自身而不是
  产品上。
- **最终结论**: 打包链路已绿,打包态启动链路已绿(宿主健康 → 后端健康 →
  前端健康 → 窗口创建);冒烟门禁的绿灯待一次新的全流程冒烟(第 9 节)。

同目录下的 `pipeline-audit.md`(打包流水线「错了根目录」审计)、
`release-manifest-audit.md`(打包后收尾审计)与 `startup-audit.md`(打包态
启动路径的「无界 await」审计)是本次的审计输入。本文不与它们重复堆证据,只
记录结论、修复与验证,并指出它们被今日实测更新的那几条(见第 12 节)。

---

## 1. 问题描述

在 `desktop/` 下执行 `npm run build`,打包在**前置准备脚本全部跑完之后、
`electron-builder` 启动之前**中止,退出码 1(`build.ps1` 映射为 4)。前端
`next build` 与后端 CPython 安装都是成功的——失败点是一个自检断言:

```
[prepare-env] done
[assert] verifying build/ payloads...

[build] FAILED: build/ is missing required payloads:
  - main/agentBrowserHost.js
[FAILED][build] 命令失败(原始退出码 1):node ...\desktop\scripts\build.js
```

原始日志:`desktop/cache/build-logs/build-20261029-030656.log:42-48`
(另见 `e2e-run-1.log:477-479`)。注意时间成本:该断言位于
`prepare-frontend` / `prepare-backend`(嵌入式 CPython + pip install)/
`prepare-ffmpeg` / `prepare-env` **之后**,所以每次失败前都已经白跑了数分钟的
准备工作,而真正昂贵的 electron-builder 打包(数分钟到十几分钟)根本没开始。

---

## 2. 复现步骤

```powershell
# desktop/ 下(建议先 npm run clean,避免复用旧 build/ 掩盖问题)
npm run build          # 或 .\build.ps1 -NoPause
# 预期:在 [assert] verifying build/ payloads... 之后立即中止
node scripts/build.js --skip-frontend --skip-backend   # 仍需 build/ 已有工件
```

断言在正常打包入口下是确定性的、100% 必现的(不是文件锁那类间歇故障);
除非有人手工往 `build/main/` 里塞一份副本,否则它只会中止打包。原因见第 3 节。

---

## 3. 根因分析

### 3.1 断言把「生成产物」和「应用外壳源码」混在了同一个根目录下

修复前(`git show HEAD:desktop/scripts/build.js`)只有一份列表
`BUILD_ASSERTIONS`(`:53-69`),而 `assertBuildOutputs()`(`:212-221`)把它
**整个**按 `BUILD_DIR = desktop/build/` 解析:

```js
const missing = BUILD_ASSERTIONS.filter(
  (relative) => !fs.existsSync(path.join(BUILD_DIR, relative))
)
if (missing.length > 0) {
  throw new Error(
    `build/ is missing required payloads:\n  - ${missing.join(...)}`)
}
```

`main/agentBrowserHost.js` 的真实身份是**提交进版本库的应用外壳源码**,位于
`desktop/main/agentBrowserHost.js`,`electron-builder.yml:21` 的
`files: - main/**` 把它直接打进 `app.asar`;这条链路**不经过** `build/`。

而 `desktop/build/`(今日实测目录列表)只有:

```
backend/   env.template.desktop   ffmpeg/   frontend/   python/
```

没有任何 `prepare-*.js` 会创建 `build/main/`(`prepare-frontend.js`、
`prepare-backend.js`、`prepare-ffmpeg.js`、`prepare-env.js` 分别产出上述五项;
`build.js:361-374` 就是这四步 + 断言的全部顺序)。因此
`desktop/build/main/agentBrowserHost.js` **在结构上不可能存在**,这条断言从
写下的那一刻起就只有一种结局:中止打包。

### 3.2 引入提交

`git log -1 3b7b6ac6` → `feat: 为剪辑 Agent 补齐通用网络能力(搜索/抓取/
受控浏览器/媒体下载/资料整合)`。该提交同时新增了
`desktop/main/agentBrowserHost.js`
(浏览器宿主)和 `BUILD_ASSERTIONS` 里的 `'main/agentBrowserHost.js'` 条目:
新增文件的人按「app 里必须有的东西」把路径写成了相对 `desktop/` 的形式,而
断言函数按「相对 `build/`」解释它。自 3b7b6ac6 起,每一次打包运行都在
electron-builder 之前死在这里。

### 3.3 为什么不是 `--dir` / `--skip-*` 造成的

断言与 `--dir` / `--skip-frontend` / `--skip-backend` 无关:跳过只会让
`build/` 更缺东西,不会让 `build/main/` 出现。`npm run build` 与
`npm run build:dir` 走同一个 `scripts/build.js`,同样必挂。

---

## 4. 为什么这类 Bug 极易复发,以及现在靠什么拦住它

复发风险来自三点,都是结构性的:

1. **两个载荷主人,一个常量表**。桌面端有且只有两个「必须存在的文件」根:
   `desktop/build/`(由 prepare 脚本生成、经 `extraResources` 进包)和
   `desktop/`(`main/`、`preload/`、`assets/` 经 `files:` 进 `app.asar`)。
   只要还是「一张平坦列表 + 一个隐含根目录」,下一个新增 `main/*.js` 或
   `preload/*.js` 的人就会重犯同样的错误。
2. **失败很晚才出现**,而且报错只说「缺」、不说「本该在哪个根下」:
   修复前的消息 `build/ is missing required payloads:` 会把一个 app-shell 文件
   伪装成「生成步骤漏产出了」,把人往 `prepare-*` 里带。
3. **这条门禁不进 CI 也不会被日常命中**:`npm run build` 只跑到断言为止,
   `npm run dev` 完全不经过它,所以错误可以「绿着」存在很久,直到有人必须
   出安装包的那天才炸(本次就是这样被发现的)。

现在有两道防护:

- **显式的双根断言**(`desktop/scripts/build.js:59-86` + `:234-251`):

  - `BUILD_PAYLOADS` —— 生成产物,按 `build/` 校验;
  - `APP_PAYLOADS` —— 应用外壳源码,按 `desktop/` 校验
    (`main/agentBrowserHost.js`、`preload/preload.js`、`assets/icon.ico`);
  - 校验核心移到 `desktop/scripts/lib/build-payload-checks.js`
    (`checkPayloads` / `formatMissingPayloads`),每个缺失项都带
    `expected` 字段,**报错直接写出所属根**:`build/python/python.exe` 或
    `desktop/main/agentBrowserHost.js`。两个根都缺时两条都报,不短路。
  - 断言覆盖数从 14 条涨到 16 条:新增的是 `preload/preload.js` 与
    `assets/icon.ico`——同样是 `files:` 打进 asar、此前无人校验的外壳文件。

- **单元测试** `desktop/scripts/lib/build-payload-checks.test.js`(7 个用例),
  用纯函数式的 `existsSync` 注入锁定行为:
  app-shell 载荷**不得**被按 `build/` 探测;完整树必须全过;真缺失项必须带
  正确根名报出;两个根同时缺时都必须出现;`desktop/` 真文件系统下的嵌套路径
  必须解析正确。今日手工执行:`node scripts/lib/build-payload-checks.test.js`
  → `build-payload-checks tests passed`。

**仍然存在的缺口(未修,交由后续处理)**:这两道防护都不能阻止「违反规则」
本身——如果有人在 `BUILD_PAYLOADS` 里再写一条 app-shell 路径,断言会在
`build/` 下找不到它并报 `build/xxx`,错误信息会指向错误的方向;而单元测试
不会在 `scripts/build.js` 或 `build.ps1` 里自动跑(`desktop/package.json`
没有对应 `test:*` 脚本)。要真正闭环,应把该测试接进打包前置步骤或 CI。

---

## 5. 验证证据(修复后)

**当前这一轮**(`npm run build`,非 `--dir`,未跳步,今日最新):

| 项 | 值 | 出处 |
|---|---|---|
| 结果 | `[build] completed in 10.9 min`,`=== EXITCODE=0 ===` | `gate-build-1.log:575-576` |
| 断言 | `[assert] verifying build/ payloads...` → `[assert] all payloads present` | `gate-build-1.log:477-478` |
| 安装包 | `Ecliptrix-Setup-1.0.0.exe`,248,742,693 B | `dir desktop\release`(2026-10-29 04:53) |
| 安装包 sha256 | `bdb0b07e63853647aa6f5aa4591716cf2810c7f392a970de8a4bf41350e7a1e4` | `gate-build-1.log:573` |
| 解包目录 | `win-unpacked/` 0.85GB | `gate-build-1.log:574` |
| asar 内容 | `\main\index.js`、`\main\proxyProbe.js`(另有 `\main\proxyProbe.test.js`) | 今日执行 `node cache/build-logs/gate-asar-check.js`(共 34 条目) |
| 研究包清单 | `[research-manifest] package_id=b5e363c9764753e91b796245db5b3dbbf3190098e0a2b40279274a55dda539cd` | `gate-build-1.log:571`;`release/research-build-manifest.json` 2,340,795 B |

前一轮(`e2e-run-2.log`,保留作为对照):`[build] completed in 13.3 min`、
`EXITCODE=0`、`sha256=a0f86b55ae4f…`(`:571-576`)。

即:此前「必然中止」的门禁现在放行了,而且放行之后的下游步骤
(electron-builder / NSIS / 研究包清单)全部成功。修复代码本身仍在工作区
(`desktop/scripts/build.js`、`desktop/scripts/lib/build-payload-checks.js`、
`desktop/scripts/lib/build-payload-checks.test.js`),尚未提交。

---

## 6. 附带发现 A:冒烟门禁端口未透传(已修复,已在打包态验证)

- 症状:`node scripts/smoke-test.js` 在「应用内 CDP 浏览器宿主」这一段抛
  `TypeError: Cannot read properties of undefined (reading 'cdp')`。
- 根因:`smoke-test.js` 的外层 `researchBrowserSmoke()` 接收了第 4 个参数
  `researchPorts`(运行中 app 的 CDP/控制端口),却只把前 3 个参数转发给内层
  `runResearchBrowserSmoke()`;内层在 `new Promise` 执行体里读
  `researchPorts.cdp` / `researchPorts.control`(`:152-153`),于是拿到
  `undefined` 而抛错。抛出后 `finally` 仍会排空残留进程,异常继续向上传播,
  `runDesktopSmoke` 中止。
- 为什么长期没暴露:`npm run build` / `npm run build:dir`
  (`desktop/package.json:11-12`)只跑 `scripts/build.js`,**不跑冒烟测试**;
  而默认入口 `desktop/build.ps1:261-269` 在打包后**默认执行**冒烟测试
  (失败映射为退出码 5,`build.ps1:72`)。也就是说:走 `npm run build` 的人
  看不到它,走 `build.ps1` 的人必然被它挡在最后一步。
- 修复:把 `researchPorts` 作为第 4 个实参传下去
  (`desktop/scripts/smoke-test.js:210-211`)。
- 验证:**已在打包产物上跑通**。`gate-smoke-1.log:26` 出现内层检查的
  JSON 报告,首字段即 `"success": true, "skipped": false`(含
  `network_guard` / `isolation` / `actions` / `lifecycle` 各段),
  说明端口真的传到了包内 Python 子进程。
- 回归测试:`desktop/scripts/smoke-test.research-ports.test.js`,通过替换
  `child_process.spawn` 捕获子进程描述符,断言外层转发的是它收到的同一个
  端口对象,而不是重新推导的端口。
- 回退条件:只有当 `runResearchBrowserSmoke` 改为自己挑选/发现端口
  (例如从应用日志解析 CDP 端口)时,才可去掉这个参数转发;否则删掉它会立刻
  回到 `undefined` 崩溃。反过来说,只要端口仍由外层 `ensureResearchBrowserPorts`
  决定,这一行就是必须的。

---

## 7. 附带发现 B:看不见的失败 —— 宿主 `cwd`(B-1)与 spawn 错误无日志(B-2)

> **状态:B-1 与 B-2 都已修复,且 B-1 已在打包产物上验证通过。**

### 7.1 B-1:宿主 `cwd` 指向 `app.asar`,子进程必然起不来

- 症状:打包后的 app 启动日志里,浏览器宿主从未出现就报就绪失败:

  ```
  [2026-10-29T07:49:19.912Z] [INFO] [process] starting agent-browser-host:
    ...\release\win-unpacked\Ecliptrix.exe --agent-browser-host
    --cdp-port=38444 --control-port=38445
  [2026-10-29T07:49:40.460Z] [WARN] [process] agent-browser-host unavailable —
    browser capability degraded: agent-browser-host did not become healthy
    within 20s (http://127.0.0.1:38444/json/version)
  ```

  出处:`desktop/cache/build-logs/app-probe-userdata/logs/process.log:1-3`
  (`error.log:2` 同一行)。关键特征是**没有 child exit 行、也从未有过宿主
  进程**——不是「起来了但不健康」,而是根本没起来。
- 根因:`ManagedService` 的 spawn 配置里 `cwd: app.getAppPath()`。打包态下
  `app.getAppPath()` 返回 `...\resources\app.asar`,那是一个**文件**;
  `CreateProcess` 无法把文件当工作目录,子进程被立刻拒绝(ENOENT)。
- 修复:新增 `desktop/main/browserHostPaths.js`
  (`resolveBrowserHostCwd({ appRoot, resourcesPath })` /
  `isAsarArchive`)。规则是:**`appRoot` 以 `.asar` 结尾时返回
  `process.resourcesPath`,否则原样返回 `appRoot`**——所以 dev 态行为不变
  (`browserHostPaths.js:34-48`)。调用点
  `desktop/main/index.js:301-304`:
  `cwd: resolveBrowserHostCwd({ appRoot: app.getAppPath(),
  resourcesPath: process.resourcesPath })`。
- 验证(打包态实测,两次独立启动):宿主 spawn 到健康的时间从「20s 超时」
  变成 **1.46s**(`08:56:58.094` → `08:56:59.550`)和 **1.42s**
  (`09:00:37.802` → `09:00:39.220`),日志行是
  `agent-browser-host healthy at http://127.0.0.1:<port>/json/version`。
  出处:`.agentmesh/cover-finalization-runtime/ecliptrix-smoke-V9Bf1c/logs/
  process.log:1-2` 与 `...ecliptrix-smoke-AInRuT/logs/process.log:1-2`
  (即 `gate-smoke-1.log` / `gate-smoke-2.log` 两轮各自使用的 userData)。
  `did not become healthy within 20s` 这一行在两次启动里都不再出现。
- 回归测试:`desktop/main/browserHostCwd.test.js`。今日手工执行
  `node main/browserHostCwd.test.js` → `browserHostCwd tests passed`。
  用例锁定:打包态 cwd **绝不**等于 `app.asar` 本身(Windows 与 POSIX 布局
  各一条);`.ASAR` 后缀大小写不敏感;dev 的目录根原样返回;`resourcesPath`
  缺失时抛错;**接线断言**:`index.js` 里必须是
  `cwd: resolveBrowserHostCwd(`,且不得再出现 `cwd: app.getAppPath()`。
- 回退条件:**不要**回退到 `app.getAppPath()`。仅当打包方式改成
  `asar: false`(app 外壳以真实目录存在)时,这个间接层才失去意义;即便
  那时也应保留 `isAsarArchive` 判断,因为 `asarUnpack`/`app.asar.unpacked`
  的路径在不同 Electron 版本上有差异,硬编码更脆。

### 7.2 B-2:spawn 失败完全没有日志,把「立刻失败」伪装成「20s 超时」

- 症状:上一条里,20 秒超时告警是唯一线索;日志里既没有「失败了」,也没有
  「为什么失败」。一次瞬间的 ENOENT 与一次真的卡了 20 秒的服务,输出完全
  一样。
- 根因:`ManagedService.start()` 只监听 `'exit'`,**没有** `child.on('error')`。
  Node 的子进程契约是:ENOENT / EACCES / EPERM 这类「根本没起来」的错误只
  走 `'error'` 事件、永远不会走 `'exit'`。于是错误被静默丢掉,`this.child`
  仍然非空,`waitHealthy()` 的 `assertChildRunning()` 什么都不抛,轮询一直
  跑到 deadline,报出一条误导性的「健康超时」。
- 修复(`desktop/main/processManager.js`):
  - `start()` 增加
    `this.child.on('error', (error) => this.recordSpawnError(error))`(`:73`);
  - `recordSpawnError()`(`:94-102`)以 ERROR 级别记录
    `name failed to spawn (code=…): <command> <args> (cwd=<cwd>) — <message>`,
    把 command / args / cwd 三件套一行写全,并把错误存进 `this.spawnError`;
  - `waitHealthy()` 首行即 `assertChildRunning()`(`:120`),而
    `assertChildRunning()`(`:105-113`)优先抛 `spawnError`,因此**立刻失败就在
    第一次轮询时抛出**,不再等满超时。
- 回归测试:`desktop/main/processManager.spawn-error.test.js`。今日手工执行
  `node main/processManager.spawn-error.test.js` →
  `processManager spawn-error tests passed`。断言:spawn `'error'` 后
  `waitHealthy()` 立即 rejects(而不是等 `healthTimeoutMs`),且错误消息里
  同时出现 command、cwd 与 code;两个用例分别是「命令不存在」与「cwd 不存在」
  (后者直接复刻本事故);并断言一次 spawn 失败**不会**再额外触发
  `onUnexpectedExit`(不重复升级)。
- 回退条件:只有在「子进程改由 `spawnSync` / 第三方 supervisor 托管」时才
  可以移除这段;否则删掉 `'error'` 监听就等于重新把 ENOENT 变成一条
  「健康超时」,这正是第 9 节那条缺陷曾经掩盖 B-2 的机制。

---

## 8. 附带发现 C:`resolveProxy` 永不回调,启动永久挂起(已修并在包上验证)

- 症状:宿主健康之后,应用彻底停住——没有后端、没有前端、没有窗口,也不会
  自己恢复。事故当时的 `process.log` 最后一行的形态是 `processManager` 的
  `agent-browser-host healthy at http://127.0.0.1:<port>/json/version`,之后再
  无任何输出——「宿主健康」与「整条启动链卡死」在日志上完全无法区分。
  (本文没有引用这次挂死本身的 `process.log`;可复核的证据是下面的探针实测
  与修复后的对照日志。)
- 证据(两个层次):
  - **探针实测**:打包态探针脚本在同一环境里测到
    `resolveProxy callback DID NOT fire within 20s`
    (`desktop/cache/build-logs/proxy-probe-result.txt:3`),
    拉长窗口后 `still no callback after 150s`
    (`proxy-probe-latency.txt:3`),
    并且**加上 `--no-proxy-server` 仍然** `no callback after 30s`
    (`proxy-probe-direct.txt:3`)——所以不是用户的系统代理/PAC 慢,是这个
    API 在该打包环境里根本不回调。
  - **修复后的对照**:两次打包态启动的 `process.log` 里,
    `resolveProxy did not answer within 2500ms — continuing without a system
    proxy`(WARN)之后,**同一毫秒**就写下
    `agent-browser-host ready (cdp=http://127.0.0.1:<port>)`,然后
    `starting backend:` → `backend healthy` → `starting frontend:` →
    `frontend healthy`(`...ecliptrix-smoke-V9Bf1c/logs/process.log:4-9`、
    `...ecliptrix-smoke-AInRuT/logs/process.log:4-9`)。从宿主 spawn 到
    `frontend healthy` 分别是 20.7s 与 17.5s;`main window created` 落在
    启动后 21.9s(`...V9Bf1c/logs/main.log:1-2`)。
- 根因:`index.js` 的 `buildResearchBrowserEnv()` 无条件
  `await session.defaultSession.resolveProxy(...)`(回调式 API,包成 Promise),
  **没有任何 deadline**。这是「可选能力阻塞必需启动」这一类结构里最坏的一种:
  代理探测只影响 `WEB_RESEARCH_SYSTEM_PROXY` 一个环境变量,失败本来就该降级
  为直连,但它被写成了串行无界等待,而它前面还有一段串行等待(宿主健康),
  后面紧跟 `startServices()`——所以一次不回调就把整条启动链钉死。
- 修复:
  - 新增 `desktop/main/proxyProbe.js`:`probeSystemProxy({ resolveProxy,
    timeoutMs, logger })`,`DEFAULT_TIMEOUT_MS = 2500`(`:17`),内部用
    `Promise.race` 对阵一个 deadline(`:116-127`),超时打一条 WARN 并返回
    `null`(= 直连),**不重试、不抛**,resolver 自己抛错仍然照常上抛。
    解析规则只取第一条 `PROXY host:port`,DIRECT / SOCKS-only / 空答案一律
    落到直连(`:59-64`)。
  - `desktop/main/index.js:340-355` 的 `resolveSystemProxyUrl()` 改为调用它;
    `session.defaultSession.resolveProxy` 作为**包了一层的**依赖注入(必须包,
    否则 `this` 丢失,`:344-345`)。
  - `desktop/main/index.js:231-237` 在宿主健康之后补了一条**无条件 INFO**
    `agent-browser-host healthy — resolving research browser env`:事故当时
    正是卡在这个位置,而日志里没有任何一行能说明「走到了这里」。一行,
    不多写。
- 回归测试:`desktop/main/proxyProbe.test.js`(无需 Electron,resolver 全部
  注入)。今日手工执行 `node main/proxyProbe.test.js` →
  `proxyProbe tests passed`。9 个用例(7 个行为 + 2 个对 `index.js` 的接线断言):
  回调永不触发时在 `timeoutMs` 内解析为 `null` 且**只**告警一次;回调按期
  触发时不被延迟、也不告警;`PROXY h:p` 解析成 URL,`DIRECT` 与非字符串答案
  降级为 `null`;resolver 同步抛错照常上抛且不产生 unhandled rejection;
  `resolveProxy` 非函数时抛 `TypeError`。接线断言:index.js 必须
  `await probeSystemProxy({`,必须注入包了一层的 `resolveProxy`,且不得再出现
  裸 `new Promise(... session.defaultSession.resolveProxy`;健康标记必须写在
  一行 `logger.info('process', …)` 里,且位于 `await buildResearchBrowserEnv(`
  之前。
- 回退条件:只有当 Electron 在该打包环境里能证明确实回调(用
  `proxy-probe-result.txt` 同样的探针复测到首次回调耗时)时,才可以考虑放宽
  `DEFAULT_TIMEOUT_MS`;**不要**删掉 deadline 回到裸 `await`。这条探测永远
  只是「给代理用户的一个优化」,不是启动依赖——所以它的正确失败方式永远是
  「快速降级为直连」。
- 遗留:该缺陷在 `startup-audit.md` 里被归类为「(c) 无界可卡死」的唯一实例,
  并被建议用一个「可选能力总预算」(`Promise.race([startResearchBrowserHost(),
  sleep(BUDGET)])`,该文 §3 / S2)在结构上一次性封住。**这一层尚未实现**:
  今天封住的是具体那一行(`proxyProbe`),而不是那一类。下一个在
  `startResearchBrowserHost()` 里新增无界 await 的人仍会重演。

---

## 9. 附带发现 D:冒烟门禁把「仍在运行的应用」判成残留进程(代码已修,门禁待重跑)

> **状态:代码已修在工作区(未提交),门禁尚未重跑。** 本文写作期间
> `desktop/scripts/smoke-test.js` 从「枚举整个 `win-unpacked`」改成了
> 「检查前基线的差集」(`:199-227` + 新模块
> `desktop/scripts/lib/process-scope.js`)。所以本节记录的**失败日志是修复
> 前的**,不能反过来当作「门禁已绿」的证据;门禁是否真绿,只认一次新的
> `node scripts/smoke-test.js` 跑到 `[smoke-test] PASS`。

- 症状:打包态冒烟门禁跑完全部启动检查后,在浏览器检查这一步以
  `研究浏览器退出后残留进程（已清理）：<PID 列表>` 失败,退出码 1
  (`gate-smoke-1.log:29-32`、`gate-smoke-2.log:25-28`)。此时产品侧一切正常:
  两个服务健康、研究能力报浏览器可用、包内 Python 的 CDP 检查返回
  `{"success": true, "skipped": false, ...}`(`gate-smoke-1.log:4-5,26`)。
- 证据(为什么说是门禁错,不是产品泄漏):
  - 报出的 PID 里有 `49672`,而**同一轮的 app 自己的日志**写着
    `INFO:     Started server process [49672]`
    (`.agentmesh/cover-finalization-runtime/ecliptrix-smoke-AInRuT/logs/
    backend.log`、同目录 `error.log` 的 `[backend:stderr]` 行)。它就是在跑
    的后端,不是浏览器的遗留物。
  - 报错之后,`runDesktopSmoke` 自己的 `finally`(`smoke-test.js:1168-1192`)
    仍然正常走完「请求关闭 → 排空」并打印 `no residual processes`
    (`gate-smoke-1.log:27-28`)。也就是说,把门禁自己踢出去的那批进程,
    随后由正常退出路径清理得干干净净(残留 0)。
- 根因:两个缺陷 + 一个后果叠在一起。
  1. **作用域错了**。修复前 `researchBrowserSmoke()` 的 `finally`
     (`git show HEAD:desktop/scripts/smoke-test.js` 的 `:192-199`)调用
     `waitForNoProcessesUnder(unpackedDir)`。
     而 `unpackedDir` = `release/win-unpacked`,该函数按
     `ExecutablePath -like 'win-unpacked\*'` 枚举
     (`desktop/scripts/lib/process-cleanup.js:44-65`)——**这个前缀包含被测
     应用自己**:`win-unpacked\Ecliptrix.exe`,以及
     `win-unpacked\resources\python\python.exe` 起的后端。在浏览器检查这一步,
     应用是**故意仍然活着**的(关闭发生在整个 `runDesktopSmoke` 的 `finally`
     里,`:1173-1185`),所以这一步永远能「找到残留」。
  2. **误判还会动手**。`killPids(leftovers)` 在 `fail()` 之前执行
     (修复前 `:196-197`),于是门禁不但报错,还把被测应用的后端连同应用本身直接
     杀掉:证据是同一轮 `process.log` 末尾的
     `frontend exited (code=4294930435, signal=null)`
     (`...ecliptrix-smoke-V9Bf1c/logs/process.log:10`,时间点正好在浏览器
     检查之后)。后续检查(封面导出等)因此不可能再跑。
  3. **附带后果:真错误被顶掉**。`finally` 里的 `fail()` 会替换掉原本的异常。
     第 2 轮的真实错误其实是包内 Python 的一次 `MemoryError`
     (导入 `cv2`/`numpy` 途中,`gate-smoke-2.log:9-22`),但门禁报出来的是
     「残留进程」——同一类「错误伪装成另一个错误」,与 B-2 一模一样。
- 引入提交:该 `finally` 的代码路径来自 `3b7b6ac6`(与主 Bug 同一提交),
  在今天之前从未被执行到——因为门禁在更早的步骤(断言、端口透传、宿主
  `cwd`、`resolveProxy` 挂起)就已经死了。
- 修复(工作区,未提交):
  - 新增 `desktop/scripts/lib/process-scope.js`:
    `selectLeakedProcesses({ after, baseline })` 只把「检查后存在、检查前不在
    基线里」的 PID 判为泄漏(`:40-43`),`waitForNoLeakedProcesses()` 在
    宽限窗口内轮询这个差集(`:61-80`)。
  - `smoke-test.js` 在 spawn 之前先拍基线
    `const baseline = processesUnder(unpackedDir)`(`:206-207`),`finally`
    改为 `waitForNoLeakedProcesses(unpackedDir, { baseline, ... })`
    (`:219-226`)。这样受测应用自己的主进程/渲染器/后端 Python/宿主天然落在
    基线里,不会被判残留;而检查自己 spawn 的 Python 产生于快照之后,
    仍然抓得住。
  - 语义方向是 **fail-closed**:若应用在检查窗口内合法新建了子进程(例如宿主
    崩溃后重启),它会被判为泄漏并让检查失败——宁可指出一个可疑进程,也不
    静默放过真泄漏;关停之后那条「整目录零残留」检查
    (`runDesktopSmoke` 的 `finally`)继续兜底。
- 回归测试:`desktop/scripts/smoke-test.process-scope.test.js`。今日手工执行
  `node scripts/smoke-test.process-scope.test.js` →
  `smoke-test process scope tests passed`(注入假枚举器,无需真实进程)。
- 仍未验证:修复后的**真实**门禁全流程(跑到 `[smoke-test] PASS`)尚未重跑。
  验收标准就是那一条:一次 `node scripts/smoke-test.js` 在
  `gate-smoke-1.log:26` 之后继续往下走,最终打印 `[smoke-test] PASS`;在产品
  本身健康、浏览器检查返回 `success: true` 的轮次里,不再出现「残留进程」。
- 回退条件:不可回退。若将来浏览器检查改成独立于被测应用的进程(例如自带
  Chromium),则这一步的排空对象应当是那个独立进程树,而不是放宽成
  「不检查残留」。

---

## 10. 本次事故的教训 / what made this expensive

一句话:**一串缺陷纵向叠在一起,每一个都恰好遮住下一个的可见性**,而唯一
能暴露它们的门禁(`build.ps1` 的冒烟测试)恰好不在任何人日常敲的那条命令里。

1. **断言 → 宿主 cwd → spawn 错误不可见 → `resolveProxy` 挂死 → 门禁逻辑**,
   五层里前四层是「下一个必须等前一个修好才看得见」:
   断言挡住了打包,所以没人见过打包后的 app;`cwd` 修好后宿主仍然起不来,
   但因为没有 `'error'` 监听,「立刻 ENOENT」被写成「20s 超时」,于是一整天
   都在查「宿主为什么慢」;`'error'` 监听落地后,瞬间失败才变回瞬间失败,
   这才露出真正的第三层——`resolveProxy` 永久不回调;`resolveProxy` 有
   deadline 之后,启动链第一次真正跑到底,门禁才第一次走到浏览器检查那一
   步,才露出第五层(门禁自身)。
   **代价不是任何一个 bug 的修复,而是每一层之间的等待**:每一层都要一次
   10–13 分钟的打包(或一次 2 分钟的冒烟)才能被观测到。
2. **`npm run build` 从不在打包后跑冒烟门禁,而 `build.ps1` 默认跑**。
   `desktop/package.json:11` 的 `build` 只调 `scripts/build.js`;
   冒烟门禁只存在于 `build.ps1:261-269`。结果是:谁用 `npm run build`,
   谁就永远看不到「打包成功但应用起不来」这类问题(今天五条附带发现里有
   四条属于这一类);谁用 `build.ps1`,谁就在最后一步被门禁挡住。两条入口
   给出的是**两套不同的「绿」**,这是本次最贵的一条结构问题。
3. **打包态启动没有有序的锚点日志,卡住时无法定位阶段**。
   `resolveProxy` 挂死时,`process.log` 的最后一行是宿主健康,之后再无输出;
   「健康」与「卡住」在日志上不可区分,于是最初的判断方向是「宿主/后端慢」,
   而不是「下一行 await 不返回」。今天补了两类锚点:宿主健康后的无条件
   INFO(`index.js:234-237`)、代理探测超时的 WARN(`proxyProbe.js:39-46`),
   以及 B-2 的 spawn ERROR 行。**完整的「健康启动应当按顺序打印哪些行、
   缺哪行说明卡在哪一阶段」清单见 `startup-audit.md` §6**(含三诊表),
   此处不重复——那份清单是本次最该被复用的产物,下次遇到启动 hang,先比对
   最后一行,再去读代码。
4. 顺带一条方法论:**「超时 20s」不等于「慢了 20s」**。今天两次误判都出在
   把「从未启动」读成「启动太慢」。凡是有 deadline 的地方,都要有另一条
   「根本没开始」的日志与之区分(B-2),否则 deadline 只是把错误延后 20 秒。

---

## 11. 证据索引

- 主 Bug 失败日志:`desktop/cache/build-logs/build-20261029-030656.log:42-48`
- 主 Bug 失败日志(另一轮):`desktop/cache/build-logs/e2e-run-1.log:477-479`
- 修复前断言代码:`git show HEAD:desktop/scripts/build.js`(`:53-69`、`:212-221`)
- 修复后双根常量与断言:`desktop/scripts/build.js:59-86`、`:234-251`
- 校验核心与单测:`desktop/scripts/lib/build-payload-checks.js`、
  `desktop/scripts/lib/build-payload-checks.test.js`
- asar 外壳打包规则:`desktop/electron-builder.yml:20-24,40-48`
- `build/` 现况(仅五类产物):`desktop/build/`
- 成功对照(当前轮):`desktop/cache/build-logs/gate-build-1.log:477-478,571-576`
- 成功对照(前一轮):`desktop/cache/build-logs/e2e-run-2.log:571-576`
- asar 内含 `main/proxyProbe.js`:`desktop/cache/build-logs/gate-asar-check.js`
- 冒烟端口缺陷:`desktop/scripts/smoke-test.js:210-211`、
  `desktop/scripts/smoke-test.research-ports.test.js`、`desktop/build.ps1:261-269`
- 打包态宿主失败(修复前):
  `desktop/cache/build-logs/app-probe-userdata/logs/process.log:1-3`
- 打包态启动成功(修复后,两轮):
  `…/ecliptrix-smoke-V9Bf1c/logs/{process,main}.log`、
  `…/ecliptrix-smoke-AInRuT/logs/{process,main}.log`,均在
  `.agentmesh/cover-finalization-runtime/` 下
- 代理探测实测:`desktop/cache/build-logs/proxy-probe-result.txt:3`、
  `proxy-probe-latency.txt:3`、`proxy-probe-direct.txt:3`
- 宿主 `cwd` 修复点:`desktop/main/index.js:301-304`、
  `desktop/main/browserHostPaths.js`、`desktop/main/browserHostCwd.test.js`
- spawn 错误修复点:`desktop/main/processManager.js:73,94-102,105-113,120`、
  `desktop/main/processManager.spawn-error.test.js`
- 代理探测修复点:`desktop/main/proxyProbe.js`、
  `desktop/main/index.js:231-237`、`:340-355`、`desktop/main/proxyProbe.test.js`
- 门禁残留误判:`desktop/scripts/smoke-test.js:206-207,219-226`、
  `desktop/scripts/lib/process-scope.js`、
  `desktop/scripts/smoke-test.process-scope.test.js`、
  `desktop/scripts/lib/process-cleanup.js:44-65,78-96`、
  `desktop/cache/build-logs/gate-smoke-1.log:24-32`、
  `gate-smoke-2.log:9-28`

## 12. 说明与未确认项

- 本文只记录今日可复核的事实。第 6–9 节的每条 `file:line` 都在写作当时重新
  读过源码;第 7、8 节的「已验证」都指向上面列出的真实日志行,不是推断。
  三个回归测试均在写作当时手工执行并通过(输出见 7.1 / 7.2 / 8 节)。
  第 6 节的 `desktop/scripts/smoke-test.research-ports.test.js` **我没有执行**
  (它属于并行的另一个 agent),只核对了文件在工作区存在;那一处的行为证据
  是 `gate-smoke-1.log:26` 的真实通过记录。
- **第 9 节的日志是修复前的**:`gate-smoke-1.log` / `gate-smoke-2.log` 两轮真实
  冒烟都跑在「整目录枚举」那版代码上,因此本文**没有**任何「门禁已绿」的
  结论。修复(`process-scope.js` 基线差集 + 它的单测)在我读完源码、执行过
  单测之后由并行的 agent 确认为最终版;**打包态全流程冒烟仍未重跑**。
- **尚未定性**:`gate-smoke-2.log:9-22` 里包内 Python 在导入 `cv2`/`numpy`
  时抛 `MemoryError`(第 1 轮同一段代码正常返回 `success: true`)。
  更可能是并行打包/冒烟时的内存压力,但**没有测量过**,不作为结论。
- 门禁之后还有未跑到的检查(封面导出 `coverSmoke`、`PASS` 收尾),
  它们的状态在本文里一律记为未知——`gate-smoke-*` 从未走到那里。
- 与同目录审计报告的差异(我无权修改那三份,仅在此记录,便于下一轮更新):
  - `startup-audit.md` §7 把「`proxyProbe` 是否真的在打包态封住了
    `resolveProxy`」列为 UNVERIFIED,并提到 `release/win-unpacked` 是陈旧
    产物;**今天两者都已被实测更新**(第 8 节;本轮打包在 04:53–04:54 重写了
    `release/`,该目录现为 2026-10-29 的产物)。
  - `release-manifest-audit.md:60` 记的安装包是 214,909,149 B /
    2026-10-03;**当前产物是 248,742,693 B / 2026-10-29 04:53**。
  - `pipeline-audit.md` D1 的判断是「冒烟门禁永远无法通过(`smoke-test.js:184`)」;
    该处已于今日修复并在打包态跑通(第 6 节),现在挡住门禁的是 D1 之后的
    另一个位置(第 9 节)。
  - `pipeline-audit.md` D5 说的「`main/**` 把单测一并打进 asar」**成立**:
    今日实测 asar 内确有 `\main\proxyProbe.test.js`(第 5 节)。
- `desktop/scripts/build.js` 的当前状态包含修复(未提交),而
  `desktop/build/`、`desktop/release/` 的目录/大小是本文写作时刻的实测值。
