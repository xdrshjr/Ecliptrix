# desktop/build.ps1 一键打包脚本 — 设计文档

> Feature: `desktop-build-ps1`
> Version: v2(已评审定稿 — P0/P1 已全部修复,见「评审记录」)
> Date: 2026-06-07
> Author: Subtask #0(方案设计节点)
> Reviewer: Subtask #1(设计评审节点,2026-06-07)
> 上游上下文: 第 1 轮已交付 Electron 桌面端打包体系(commit `a52bc01`,
> 设计见 `docs/plans/desktop-electron-packaging/spec.md`)

---

## 评审记录(Review Notes)

> 评审人:Subtask #1。按**可行性 / 完整性 / 一致性 / 体量**四维逐节评审,并对文档
> 引用的既有代码做了事实核对(`desktop/scripts/{preflight,build,prepare-frontend,smoke-test}.js`、
> `desktop/package.json`、`desktop/.gitignore`、根 `.gitignore`、`electron-builder.yml`、
> 根 `package.json`)——`MIN_NODE=[18,18]`、镜像 env 取值与「已存在不覆盖」语义、
> `--clean` 仅删 build/ 与 release/、`npx electron-builder` 调用、`cache/` 已 gitignore、
> 产物名 `${productName}-Setup-${version}.exe` 等引用全部属实。
> 下表 P0/P1 已在本版(v2)正文直接修复;P2 已修复或显式接受。

| # | 严重度 | 维度 | 问题 | 处置 |
|---|--------|------|------|------|
| R1 | P1 | 可行性 | PS 5.1 控制台宿主下 `Start-Transcript` **无法可靠捕获原生子进程(node/npm)直写控制台句柄的输出**,而本设计恰恰要求 `Invoke-Native` 不做任何 stdio 重定向——原 §5「全量控制台记录」与验收项 4「build.js 失败可在 transcript 中定位」的承诺不成立 | 已修复:§2.2 要点 5、§5、§6 验收 4、§7 风险 10 —— transcript 重新定位为「PS 编排层日志」,失败定位以 `[FAILED]` 消息(含完整命令行与退出码)为准;补充外层重定向收集全量日志的方法 |
| R2 | P1 | 完整性 | 原时序中 `-Clean`(步骤 2)先于 PS 层 preflight(步骤 3)执行:node 缺失时抛 CommandNotFoundException,无中文提示且退出码不在 §4.2 契约内;同时「-Clean 直接传播 build.js 退出码」(失败时为 1)与表中「4 = build.js 非零」并存,契约自相矛盾 | 已修复:§2.1 调整为 preflight 先行;§4.2 统一为「所有 build.js 非零(含 --clean)→ 4、node/npm 缺失 → 2」,消除特例 |
| R3 | P1 | 完整性 | 「catch 块按异常来源赋值」退出码的**机制未指定**,下游大概率退化为对异常消息做字符串匹配(脆弱、对中文消息敏感) | 已修复:§2.2 指定 `$script:phase` 阶段标记 + `$EXIT_BY_PHASE` 查表机制,禁止消息匹配 |
| R4 | P2 | 可行性 | `Start-Transcript` 失败后,finally 中 `Stop-Transcript` 会抛「尚未启动转录」异常,在 `$ErrorActionPreference='Stop'` 下污染退出码 | 已修复:§2.2 增加 `$transcriptStarted` 守卫 |
| R5 | P2 | 可行性 | `[Console]::OutputEncoding` 赋值在非控制台宿主(ISE 等)抛异常;且编码修改会泄漏到调用方终端会话 | 已修复:§2.2 要点 1 —— try/catch 包裹 + finally 恢复原编码 |
| R6 | P2 | 一致性 | §2.1 步骤 6/7 写作相对路径 `scripts/build.js`,与风险 8「全部路径经 Join-Path 组装」自相矛盾 | 已修复:统一为 `Join-Path $DESKTOP_ROOT ...` 绝对路径 |
| R7 | P2 | 完整性 | `-CnMirror` 的 `--registry` 在较老 npm 版本下可能不改写 package-lock 已固化的 resolved URL,个别包仍走官方源 | 接受不改:npmmirror 为透明镜像,失败由退出码 3 定位;已在 §7 风险 9 备注 |
| R8 | P2 | 体量 | `-SmokeTest` / transcript / explorer 暂停检测三项略超「直接运行就能打包」的最小需求 | 接受不改:三者均服务于双击场景的可观测性,且皆为可选开关;体量判定合理,未过度设计 |

**四维小结**:可行性——R1/R4/R5 修复后方案在 PS 5.1 与 7+ 下均可落地;完整性——
R2/R3 修复后退出码契约闭环、全部失败路径有中文定位;一致性——与 CLAUDE.md 的
PS 5.1 约定(禁 `&&`、防 NativeCommandError、UTF-8 BOM)及 build.js 单点编排
原则一致,R6 修复后文内自洽;体量——仅两文件增量、零 js 改动,边界克制。

---

## 1. Overview(概述)

第 1 轮已经在 `desktop/` 下落地了完整的 Electron 打包体系:`scripts/build.js`
负责 preflight → prepare-frontend → prepare-backend → prepare-ffmpeg →
electron-builder 的全部编排,用户通过 `cd desktop && npm install && npm run build`
产出 Windows 安装包。但本轮用户反馈指出缺口:**没有一个像
`desktop/build.ps1` 这样「直接运行就能打包」的 PowerShell 脚本**。当前入口
要求用户先知道并手敲两条 npm 命令,且首次打包前还必须在仓库根目录执行过
`npm install`(prepare-frontend 依赖根项目可构建)——这些前置步骤分散在
README 里,对 Windows 用户不是「一键」体验。

本方案新增 `desktop/build.ps1`:一个自包含的 Windows PowerShell 入口脚本,
双击(右键「使用 PowerShell 运行」)或在任意工作目录下执行
`powershell -ExecutionPolicy Bypass -File desktop/build.ps1` 即可完成
**环境检查 → 根项目与 desktop/ 依赖安装(缺失时) → 调用既有
`scripts/build.js` 打包 →(可选)冒烟测试**的全流程。脚本只做「编排与
兜底」,**不复制任何 build.js 已有的打包逻辑**——所有 prepare/断言/产物
输出仍由 build.js 单点负责,避免两份逻辑漂移。

设计基线:兼容 Windows PowerShell 5.1(系统自带)与 PowerShell 7+,因此
全文禁用 `&&`/`||` 管道链、三元运算符等 5.1 不支持的语法;脚本以
`$PSScriptRoot` 自我定位,与调用方的当前目录无关;所有失败路径给出中文
定位提示与独立退出码,并在「从资源管理器双击启动」的场景下结束前暂停,
防止窗口一闪而过看不到结果。

### 范围与非目标

- **目标**:仅新增 `desktop/build.ps1` 与对应 README 用法说明。
- **非目标**:不改动 `scripts/build.js` 及任何 prepare 脚本;不提供
  .sh / .bat 等其它 Shell 入口;不做代码签名、CI 集成;不改变
  `npm run build` 既有入口(build.ps1 是纯增量包装)。

---

## 2. Technical Design(技术设计)

### 2.1 执行时序

```
build.ps1(cwd 无关,$PSScriptRoot = desktop/)
 ├─ 0. Set-StrictMode 2.0;$ErrorActionPreference='Stop';UTF-8 输出编码
 ├─ 1. Start-Transcript → desktop/cache/build-logs/build-<时间戳>.log(非致命;
 │      仅记录 PS 编排层输出,能力边界见 §2.2 要点 5 — 评审 R1)
 ├─ 2. Preflight(PS 层,快速失败;置于 -Clean 之前,保证 -Clean 路径下
 │      node 缺失同样得到中文提示与退出码 2 — 评审 R2):
 │      node 在 PATH 且版本 ≥ 18.18(与 preflight.js MIN_NODE 同值)
 │      npm 在 PATH(npm.cmd)
 ├─ 3. [-Clean?] node (Join-Path $DESKTOP_ROOT 'scripts/build.js') --clean
 │      → 退出(非零时与主路径一致映射为退出码 4,消息保留原始码)
 ├─ 4. [-CnMirror?] 设置 ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR
 │      (必须在 npm install 之前 — electron 二进制在 postinstall 阶段下载,
 │       preflight.js 的 applyMirrorEnv 只覆盖 build 阶段,覆盖不到这里)
 ├─ 5. 依赖安装(均可被 -SkipInstall 跳过;-CnMirror 时追加
 │      --registry=https://registry.npmmirror.com):
 │      a. 仓库根 node_modules/ 缺失 → 在 <repoRoot> 执行 npm install
 │      b. desktop/node_modules/electron-builder 缺失 → 在 desktop/ 执行 npm install
 ├─ 6. 组装参数并调用:node (Join-Path $DESKTOP_ROOT 'scripts/build.js')
 │      [--dir] [--skip-frontend] [--skip-backend] [--cn-mirror](cwd=desktop/)
 ├─ 7. [-SmokeTest?] node (Join-Path $DESKTOP_ROOT 'scripts/smoke-test.js')
 │      (cwd=desktop/)
 ├─ 8. 摘要:总耗时 + release/ 路径提示(产物明细 build.js 已打印)
 └─ 9. finally:若 $transcriptStarted 则 Stop-Transcript;恢复控制台原编码;
        若从资源管理器双击启动且未 -NoPause → Read-Host 暂停;exit <code>
```

### 2.2 脚本内部结构(函数级,下游照此实现)

文件头:`<# .SYNOPSIS / .DESCRIPTION / .EXAMPLE #>` 注释块(含
ExecutionPolicy 受限时的 `-ExecutionPolicy Bypass` 调用示例),随后
`param(...)` 块(见 §4.1),随后常量:
`$MIN_NODE = @(18, 18)`(注释注明须与 `scripts/preflight.js` 的
`MIN_NODE` 保持同步)、`$NPM_CN_REGISTRY = 'https://registry.npmmirror.com'`、
`$DESKTOP_ROOT = $PSScriptRoot`、
`$REPO_ROOT = Split-Path $PSScriptRoot -Parent`。

| 函数 | 职责(一行) |
|------|-------------|
| `Write-Section([string]$Title)` | 打印 `=== <Title> ===` 分节横幅,统一视觉 |
| `Assert-CommandAvailable([string]$Name, [string]$Hint)` | `Get-Command -ErrorAction SilentlyContinue` 探测,缺失则 throw 带安装提示(node 给 nodejs.org 下载链接) |
| `Assert-NodeVersion()` | 解析 `node --version`(去 `v` 前缀按 `.` 拆分),低于 `$MIN_NODE` 则 throw,错误信息含实测版本号 |
| `Invoke-Native([string]$Exe, [string[]]$Argv, [string]$Cwd)` | `Push-Location $Cwd` + `& $Exe @Argv` + `try/finally Pop-Location`;**不重定向 stderr**(PS 5.1 下 `2>&1` 会把 npm 进度行包装成 ErrorRecord 触发误报);`$LASTEXITCODE -ne 0` 时 throw,异常消息含命令行与退出码 |
| `Install-NodeModulesIfMissing([string]$Dir, [string]$Probe, [string[]]$ExtraArgs)` | `Test-Path (Join-Path $Dir $Probe)` 命中即跳过并打印「已存在,跳过」;否则 `Invoke-Native npm @('install') + $ExtraArgs` |
| `Test-LaunchedFromExplorer()` | 两次 `Get-CimInstance Win32_Process` 查 `$PID` 的父进程名是否 `explorer.exe`;任何异常一律返回 `$false`(探测失败宁可不暂停) |
| 主流程 | 顶层 `try/catch/finally`:进入每个阶段前设置 `$script:phase = 'preflight' / 'install' / 'build' / 'smoke'`;catch 打印红色 `[FAILED][<phase>] ...`(含完整命令行与原始退出码)与 transcript 路径,并按 `$EXIT_BY_PHASE` 查表设置退出码(评审 R3,禁止对异常消息做字符串匹配);finally 在 `$transcriptStarted` 为真时才 Stop-Transcript(评审 R4)、恢复控制台编码、按需暂停、`exit $exitCode` |

要点:

1. **编码**:文件保存为 **UTF-8 with BOM**(PS 5.1 把无 BOM 的 UTF-8 当
   ANSI 解析,中文字符串必乱码);脚本开头执行
   `$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8`,
   使 node/npm 的 UTF-8 日志在默认 GBK 控制台正确显示。该赋值包 try/catch
   (非控制台宿主如 ISE 下取/赋 `[Console]::OutputEncoding` 会抛异常,失败
   不阻断);赋值前保存原编码,finally 中恢复,避免污染调用方终端会话
   (评审 R5)。
2. **依赖探测路径**:仓库根用 `node_modules`(目录存在即视为装过——
   prepare-frontend 内部会再跑 `npm run build`,坏依赖在那里报错);
   desktop/ 用 `node_modules/electron-builder`(build.js 通过
   `npx electron-builder` 调用,这是硬依赖)。
3. **参数透传是白名单制**:PS switch → build.js flag 一一映射(§4.1),
   不提供任意参数透传(防止拼写错误静默吞掉)。
4. **退出码常量化**:`$EXIT_BY_PHASE = @{ preflight = 2; install = 3;
   build = 4; smoke = 5 }`(§4.2),catch 块按 `$script:phase` 查表赋值
   (评审 R3);build.js / smoke-test.js 的原始非零退出码不直接透传,
   统一映射为契约码,并在异常消息中保留原始码。
5. **transcript 落在 `desktop/cache/build-logs/`**:`cache/` 已在
   `desktop/.gitignore` 中且不被 `--clean` 删除(build.js 的 clean 只删
   build/ 与 release/),日志可跨次保留;`Start-Transcript` 包 try/catch,
   失败(如宿主不支持)不阻断打包,成功后置位 `$transcriptStarted`,
   finally 仅在该标志为真时 Stop-Transcript(评审 R4)。
   **能力边界(评审 R1)**:PS 5.1 控制台宿主下,native 子进程(node/npm)
   直写控制台句柄的输出**不会进入 transcript**,而 `Invoke-Native` 又明确
   禁止 stdio 重定向(见上),因此 transcript 的定位是「PS 编排层日志」:
   分节横幅、每条 `Invoke-Native` 的完整命令行、`[FAILED][<phase>]` 消息
   与退出码。需要全量构建日志时,从 cmd / CI 在 powershell.exe 进程边界
   重定向:`powershell -NoProfile -ExecutionPolicy Bypass -File
   desktop\build.ps1 -NoPause > full.log 2>&1`(子进程继承文件句柄,
   不触发脚本内的 NativeCommandError;代价是看不到交互进度条)。
   README 的一键打包小节注明此方法。

### 2.3 与既有体系的边界

- PS 层 preflight 只做「node/npm 存在 + node 版本下限」两项,目的是在
  npm install 之前给出比 cmd 原生报错更友好的中文提示;磁盘空间、镜像
  URL 解析等仍由 build.js 内的 `runPreflight` 权威执行(允许重复检查,
  不允许逻辑分叉)。
- `-CnMirror` 在 PS 层只负责 build.js 覆盖不到的两件事:npm registry
  参数与 npm install 阶段的 Electron 二进制镜像环境变量;其余镜像逻辑
  仍走 `--cn-mirror` 透传。
- `npm run build` / `npm run build:dir` 等既有入口行为不变;README 将
  build.ps1 列为推荐入口、npm 命令列为等价备选。

---

## 3. File / Module Change Plan(文件 / 模块变更计划)

| 文件 | 操作 | 意图(一行) |
|------|------|-------------|
| `desktop/build.ps1` | 新建 | 一键打包入口:preflight → 依赖安装 → 调用 scripts/build.js →(可选)smoke-test;UTF-8 BOM,兼容 PS 5.1/7+ |
| `desktop/README.md` | 修改 | 「打包」节顶部新增「一键打包(推荐)」小节:`.\build.ps1` 用法、参数表、ExecutionPolicy 提示;原 npm 命令保留为等价方式 |

> 仅此两个文件。不触碰 `scripts/*.js`、`package.json`、根项目任何文件;
> `desktop/.gitignore` 已覆盖 `cache/`(transcript 目录),无需改动。

---

## 4. Interface Design(接口设计)

### 4.1 CLI 签名与参数映射

```powershell
# 在 desktop/ 下(或任意 cwd 用绝对/相对路径)执行:
.\build.ps1 [-Dir] [-SkipFrontend] [-SkipBackend] [-CnMirror] [-Clean]
            [-SkipInstall] [-SmokeTest] [-NoPause]

# 执行策略受限的机器:
powershell -NoProfile -ExecutionPolicy Bypass -File desktop/build.ps1 -Dir
```

| PS 参数(switch) | 行为 | 透传到 build.js |
|------------------|------|-----------------|
| `-Dir` | 跳过 NSIS,仅产出 win-unpacked(迭代快) | `--dir` |
| `-SkipFrontend` | 复用上次 build/frontend 工件 | `--skip-frontend` |
| `-SkipBackend` | 复用上次 build/backend + build/python 工件 | `--skip-backend` |
| `-CnMirror` | npm registry + Electron 下载镜像(PS 层)+ 全链路国内镜像 | `--cn-mirror` |
| `-Clean` | 只清理 build/ 与 release/ 后退出(互斥于其余打包参数,优先生效) | `--clean` |
| `-SkipInstall` | 跳过两处 npm install 探测(复用现有 node_modules) | — |
| `-SmokeTest` | 打包成功后追加 `node scripts/smoke-test.js` | — |
| `-NoPause` | 结束时不暂停(CI / 终端用户) | — |

无参数直接运行 = 完整打包(等价 `npm run build`),产出
`release/Ecliptrix-Setup-<ver>.exe` 与 `release/win-unpacked/`。

### 4.2 退出码契约

| 退出码 | 含义 |
|--------|------|
| `0` | 成功 |
| `2` | PS 层 preflight 失败(node/npm 缺失或 node < 18.18) |
| `3` | npm install 失败(根项目或 desktop/,异常消息区分目录) |
| `4` | build.js 非零退出(含 `-Clean` 路径;统一映射为 4,异常消息保留原始码) |
| `5` | smoke-test.js 非零退出(同上保留原始码) |

退出码由 catch 块按 `$script:phase` 查 `$EXIT_BY_PHASE` 表赋值(§2.2,评审
R3),全路径无特例:`-Clean` 下 node/npm 缺失同样退出 2、`build.js --clean`
失败同样退出 4(评审 R2)。

### 4.3 环境变量(仅 `-CnMirror` 时由脚本设置,已存在则不覆盖)

| 变量 | 值 |
|------|----|
| `ELECTRON_MIRROR` | `https://npmmirror.com/mirrors/electron/` |
| `ELECTRON_BUILDER_BINARIES_MIRROR` | `https://npmmirror.com/mirrors/electron-builder-binaries/` |

与 `scripts/preflight.js` 的 `applyMirrorEnv` 取值完全一致(双处出现是
因为生效时机不同:npm install 阶段 vs build 阶段;两处都遵循
「已存在则不覆盖」,用户自定义镜像优先)。

---

## 5. Data Model(数据模型)

本特性**不涉及数据库与任何业务数据结构**。唯一的新增磁盘产物是构建
transcript 日志:

```
desktop/cache/build-logs/build-<yyyyMMdd-HHmmss>.log   # Start-Transcript PS 编排层记录(评审 R1,边界见 §2.2 要点 5)
```

该目录由脚本以 `New-Item -ItemType Directory -Force` 惰性创建;位于已
gitignore 的 `cache/` 下,不进版本库、不被 `-Clean` 删除、无轮转策略
(单文件 KB~MB 级,由用户按需手动清理,README 注明)。脚本自身无任何
配置文件或持久状态;全部行为由命令行参数决定。

---

## 6. Testing & Acceptance Criteria(测试与验收)

桌面打包无现成自动化测试框架,验收以「脚本化检查 + 实际打包运行」为准
(与第 1 轮 build.js 的验收方式一致):

1. **双引擎语法解析通过**:
   `[System.Management.Automation.Language.Parser]::ParseFile(...)` 在
   Windows PowerShell 5.1 下零 error(打包机若有 pwsh 7 则同跑一遍);
   这是对「禁用 `&&`/三元」等 5.1 兼容约束的机械验证。
2. **一键全量打包**:删除 `desktop/build/` 后,在仓库根目录(非 desktop/)
   执行 `powershell -NoProfile -ExecutionPolicy Bypass -File desktop/build.ps1 -Dir -NoPause`
   全程无人值守成功,`release/win-unpacked/Ecliptrix.exe` 存在 —— 同时
   验证 cwd 无关性与 build.js 透传。(完整 NSIS 路径用
   `-SkipFrontend -SkipBackend` 复用工件验证一次,控制耗时。)
3. **依赖自举**:临时重命名 `desktop/node_modules/` 后运行,脚本自动
   `npm install` 并继续打包;恢复后再运行,打印「已存在,跳过」。
4. **失败路径**:`$env:PATH` 临时清空 node 后运行 → 中文错误提示 +
   退出码 2(`-Clean` 路径同样退出 2 — 评审 R2);构造 build.js 失败
   (如临时改坏 electron-builder.yml)→ 退出码 4,transcript 中可见
   `[FAILED][build]` 消息、完整命令行与原始退出码(build.js 自身的输出
   在控制台或外层重定向日志中查看 — 评审 R1)。
5. **-Clean**:运行后 `build/`、`release/` 被删除,`cache/` 保留,退出码 0。
6. **中文输出**:默认 GBK 控制台(chcp 936)下脚本自身与 node 子进程的
   中文日志均无乱码。
7. **暂停行为**:资源管理器右键「使用 PowerShell 运行」结束后窗口停在
   `按 Enter 退出`;终端内运行不暂停(手工验收)。
8. **零回归**:`cd desktop && npm run build:dir` 行为与改动前完全一致
   (本特性未触碰任何 js/json)。

### Definition of Done

- `desktop/build.ps1` 存在,上述 1–6、8 全部通过,7 人工确认;
- `desktop/README.md` 含一键用法与参数表;
- 除 §3 两个文件与本 spec 外无其它文件改动。

---

## 7. Risks & Mitigations(风险与缓解)

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| 1 | ExecutionPolicy(默认 Restricted)拦截脚本,双击/右键运行直接失败 | 高 | README 与脚本头注释给出 `-ExecutionPolicy Bypass -File` 标准调用;右键「使用 PowerShell 运行」在多数 Win10/11 上可用,失败时错误信息本身即指向该提示 |
| 2 | PS 5.1 / 7 语法差异(`&&`、三元、`Get-Process .Parent` 等)导致某一引擎下解析失败 | 高 | 全文限定 5.1 兼容子集;父进程探测用 CIM 而非 `.Parent`;验收项 1 双引擎机械解析 |
| 3 | 无 BOM 的 UTF-8 在 PS 5.1 下中文乱码甚至字符串解析错位 | 中 | 文件强制 UTF-8 with BOM;验收项 6 在 GBK 控制台实测 |
| 4 | PS 5.1 下重定向 native stderr 触发 NativeCommandError,npm 的进度输出被误判为失败 | 中 | `Invoke-Native` 不做任何 stderr 重定向,stdio 直通控制台,成败仅看 `$LASTEXITCODE` |
| 5 | PS 层 node 版本下限与 preflight.js 漂移 | 中 | 常量旁注释互指;PS 层仅此一处版本判断,且 build.js 仍会权威复检(双重检查容忍,单向漂移最多导致提示晚一步) |
| 6 | `-CnMirror` 下 electron postinstall 仍走官方源(镜像 env 设置时机晚) | 中 | §2.1 步骤 4 明确在任何 npm install 之前设置镜像 env;已存在则不覆盖 |
| 7 | 双击启动检测(explorer 父进程)在新式终端/快捷方式下误判 | 低 | 探测异常一律按 `$false` 处理(不暂停),并提供 `-NoPause` 显式关闭;误判后果仅是多/少一次 Enter |
| 8 | 仓库路径含空格/中文导致子进程调用失败 | 低 | 全部路径经 `Join-Path` 组装并由 `&` 调用符 + 数组参数传递(PowerShell 自动加引号),不手工拼接命令行字符串 |
| 9 | 根项目 npm install 体量大、网络失败率高 | 低 | 失败有独立退出码 3 与目录定位;`-CnMirror` 提供国内 registry(老 npm 可能不改写 lock 中固化的 resolved URL,个别包仍走官方源 — 已知边界,接受,评审 R7);`-SkipInstall` 支持复用 |
| 10 | PS 5.1 transcript 不含 native 子进程直写控制台的输出,失败排查信息不全 | 中 | transcript 定位为 PS 编排层日志(`[FAILED][<phase>]` 含命令行与退出码);全量日志用 powershell.exe 进程边界重定向收集(§2.2 要点 5,评审 R1) |

---

## 8. 实施顺序建议(供下游开发节点)

1. 编写 `desktop/build.ps1`(§2.2 函数骨架 → 主流程 → 退出码/暂停收尾),
   随手跑验收项 1 的双引擎解析。
2. 用 `-Clean`、`-Dir -SkipFrontend -SkipBackend`(秒级)快速联调参数
   透传与退出码,再跑一次真实 `-Dir` 全量(验收项 2)。
3. 补 README「一键打包(推荐)」小节,过一遍 §6 清单。

<!-- 实施过程发现的方案缺陷:由 Subtask #2 在此段下方追加记录 -->

## 实施过程发现的方案缺陷

> 实施人:Subtask #2(代码开发节点,2026-06-07)。
> **结论:未发现方案级缺陷,设计按 v2 原样落地,无任何偏离。**
> 以下为实施期验证中发现的一处既有代码的环境边界,记录备查(不属于本
> 方案的缺陷,也不在本方案允许的改动范围内,未做修复):

- **环境边界(继承自第 1 轮 `scripts/prepare-ffmpeg.js`)**:当调用方
  PATH 中 GNU tar(如 Git Bash / MSYS 的 `/usr/bin/tar`)排在
  `C:\Windows\System32\tar.exe`(bsdtar)之前时,prepare-ffmpeg 用
  `tar -xf M:\...\ffmpeg-release-essentials.zip` 解压会失败 ——
  GNU tar 把 `M:` 盘符前缀当作远程主机名(`tar: Cannot connect to M:
  resolve failed`),build.js 以非零退出,build.ps1 按契约正确映射为
  退出码 4 并打印 `[FAILED][build]`。从常规 PowerShell / cmd /
  资源管理器启动(System32 bsdtar 在前)不受影响,第 1 轮与本轮的
  实际打包验证均通过。如需修复应改 `prepare-ffmpeg.js`(固定调用
  `%SystemRoot%\System32\tar.exe` 或加 `--force-local`),属第 1 轮
  代码的后续迭代项,超出本方案「不改动 scripts/*.js」的边界。

---

## 评审结论(Review Verdict)

**通过**(v2)。

- **事实核对**:文档对既有代码的全部引用经逐项核实属实——`preflight.js` 的
  `MIN_NODE=[18,18]` 与 `applyMirrorEnv` 镜像取值及「已存在不覆盖」语义、
  `build.js --clean` 仅删 build/ 与 release/、经 `npx electron-builder` 打包、
  `prepare-frontend` 依赖仓库根可执行 `npm run build`(根 `package.json` 无
  postinstall 钩子,node_modules 目录探针成立)、`desktop/.gitignore` 与根
  `.gitignore` 均已覆盖 `cache/`、产物名 `${productName}-Setup-${version}.exe`
  与 §4.1 描述一致。
- **P0**:无。**P1**(R1 transcript 能力承诺失实、R2 -Clean 时序与退出码契约
  矛盾、R3 退出码归因机制缺失)已全部在 v2 正文修复,无遗留。
- **P2**:R4 / R5 / R6 已一并修复;R7 / R8 经评估显式接受,理由见「评审记录」。
- **对下游开发节点的非阻塞提醒**:① `build.ps1` 落盘必须为 UTF-8 **with BOM**
  (常用写文件工具默认产出无 BOM 的 UTF-8,交付前用字节头 `EF BB BF` 校验);
  ② 先跑 §6 验收项 1 的双引擎 `Parser::ParseFile` 机械检查,再进入真实打包验收。
