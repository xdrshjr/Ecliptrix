# 桌面端日志系统分类化改造 — 设计方案 (spec)

- **Feature**: `desktop-logging-categorization`
- **版本**: **v2**（评审节点 Subtask #1 修订；v1 为方案设计节点产出）
- **作者**: 方案设计 Agent（Subtask #0）；评审与修复 Agent（Subtask #1）
- **状态**: 已评审，**有条件通过**（详见文末「评审结论」）
- **关联代码**: `desktop/main/`（Electron 主进程）、`desktop/scripts/dev.js`（开发态编排）
- **关联文档**: `docs/plans/desktop-electron-packaging/spec.md`（桌面端打包总方案）

---

## 评审记录（Review Notes，Subtask #1）

> 评审维度：可行性（Feasibility）/ 完整性（Completeness）/ 一致性（Consistency）/
> 合理规模（Right-sizing）。评审已对照真实源码逐节核对：`desktop/main/logger.js`、
> `index.js`、`processManager.js`、`windowControls.js`、`window.js`、`scripts/dev.js`、
> `scripts/smoke-test.js`、`assets/error.html`、`README.md`、`.gitignore`。
> **所有 P0/P1 已在本 v2 文档正文就地修复**；P2 列为「评审结论」中的落地条件。

| # | 严重度 | 维度 | 问题 | 处理 |
|---|---|---|---|---|
| R1 | **P1** | 完整性 / 可行性 | **开发态根本不会产出 `process.log`/`backend.log`/`frontend.log`**。核对 `index.js:111-116`：`if (isDev)` 分支在 `startServices()` 之前 **提前 return**，因此 `npm run dev` 时 Electron 主进程从不 `spawn` 子进程、从不 `attachChild`；后端/前端的 stdout/stderr 由 `scripts/dev.js` 的 `console.log` 捕获，**不落任何文件**。原 §6.3「`npm run dev` 后 `desktop/logs/` 出现分类文件」对这三类文件不可达，验收会假绿。 | 已修复：§2.4 新增「两种运行时」澄清；**扩展既有 `dev.js` 改动**，把 `[backend]`/`[frontend]`/`[dev]` 输出同时 tee 到 `desktop/logs/{backend,frontend,dev}.log`，使开发态真正产出分类文件；§6.3 验收按运行时重写。 |
| R2 | **P1** | 可行性 / 一致性 | **结构化 `emit()` 可能污染原始子进程 sink，且未知类别会抛异常**。`LogCategory` 含 `BACKEND`/`FRONTEND`，但 §2.1 规定这两文件**只接原始透传**；§4 暴露的 `emit(level,category,msg)` 与兼容 `log(category,msg)` 未禁止把结构化行写进 `backend.log`/`frontend.log`。又：`processManager.js` 现状以服务 `name`(`'backend'`/`'frontend'`) 作 scope 调 `log()`，若迁移有遗漏，兼容 shim 会把格式化行注入原始日志；传入枚举外类别时 `path.join(dir, undefined)` 直接抛错。 | 已修复：§2.1 增加「原始 sink 保护」规则——`emit/info/warn/error/log` 对 `backend`/`frontend` 类别一律改投 `main.log`，对未知类别回退 `main.log`；§4 在 `emit` 契约中写明该解析顺序。 |
| R3 | P2 | 合理规模 | `ipc` 类别默认 `minLevel=INFO`、而 ipc 行为 DEBUG，**默认零产出**，`windowControls.js` 改动在默认配置下纯属空转。 | 列为落地条件：Subtask #2 可二选一——本期**只建枚举、不改 `windowControls.js`**（最省），或保留改动但在 README 注明「仅 `ECLIPTRIX_LOG_LEVEL=debug` 时产出」。 |
| R4 | P2 | 完整性 | `error.log` 仅镜像 **stderr**；子进程把错误打到 **stdout**（uvicorn/Next 常见）时会漏报（§8 设计者已自问）。 | 接受 v1 取舍（避免 stdout 全量污染 error.log），但需在 README/§7 显式记录此已知局限，并把「按内容启发式镜像」列入后续迭代。 |
| R5 | P2 | 完整性 | **升级存量清理**：旧版 logger 产出的单代 `main.log.old`/`backend.log.old`/`frontend.log.old` 不在新多代命名内，`sweepRetention` 若只扫 `*.log.<数字>` 会漏删。 | 已在 §2.3 注明：`sweepRetention` 的匹配需覆盖 `*.log.<数字>` **与** 旧式 `*.log.old`，保证升级后旧轮转代被按天回收。 |
| R6 | P2 | 一致性 | `.gitignore` 第 60 行已有全局 `*.log`，但它**只匹配以 `.log` 结尾的文件，不匹配轮转代 `*.log.1/.2/.3`**；故 §3 追加 `desktop/logs/` 是必要的（不可省）。 | 保留 §3 的 `.gitignore` 追加项，并在该行补注「`*.log` 不覆盖轮转代，故需整目录忽略」。 |
| R7 | P2 | 合理规模 | 新增 `scripts/test-logger.js` 位于 `scripts/`，会被打进应用包（`scripts/` 在 extraResources 内）。 | 无害（纯 dev、体积可忽略）；可选在 `electron-builder.yml` 的 files 排除，列为可选优化，不阻断。 |
| R8 | P2 | 可行性 | 打包态 GUI 无控制台，`emit()` 回显 `process.stdout` 在分离句柄上**可能 EPIPE**（现状 `log()` 已这么做、未见崩溃，但属隐患）。 | 加固建议：§2.2 注明 stdout 回显需 `try/catch` 包裹，失败静默（沿用现状语义，仅去除潜在崩溃面）。 |
| R9 | P2 | 一致性 | 提交风格冲突：`CLAUDE.md` 规定 `[fix]/[modify]` 方括号前缀，而 `desktop/` 区与 Subtask #3 要求 Conventional `feat:`。本 spec 不负责提交，仅提示下游 Subtask #3 以其指令为准，勿被 `CLAUDE.md` 通则绊住。 | 仅记录，无需在本 spec 修复。 |

---

## 1. Overview（概述）

Ecliptrix 桌面端是一个把 Next.js 前端、FastAPI 后端、CPython 运行时与 FFmpeg 打进一个
Windows 安装包的 Electron 应用。主进程（`desktop/main/`）负责进程托管、端口探测、配置
管理、窗口管理与**日志**。当前的日志实现（`desktop/main/logger.js`）非常简陋：所有主进程
事件——无论来自应用生命周期、子进程监管、端口/配置决策，还是渲染进程 IPC——都通过
`logger.log(scope, message)` 被一股脑写进**同一个** `main.log`；只有两个子进程的原始
stdout/stderr 被 `attachChild` 分别导向 `backend.log` 与 `frontend.log`。其结果是：排查
一次启动失败时，用户与开发者必须在一个混杂了七八种来源的大文件里大海捞针，且没有日志
级别、没有错误聚合、没有可靠的轮转保留策略（仅保留单个 `.old`）。

本方案的目标是**把桌面端日志系统分类化、合理化**：在桌面端的 `logs/` 目录下，按"来源/
职责"把不同类别的日志拆分到不同文件，并为主进程日志引入**级别（DEBUG/INFO/WARN/ERROR）**、
**错误聚合（error.log）**、**多代轮转**与**按天保留清理**。改造后，用户依据错误页给出的
日志目录，可一眼定位到 `process.log`（进程监管）、`config.log`（配置/端口）、`backend.log`
/`frontend.log`（子进程原始输出）、`error.log`（全局告警与错误汇总），而不是在一个
`main.log` 里翻找。

为同时照顾"打包产物"与"开发体验"两种场景，方案明确了日志目录的归属规则：打包态日志仍
落在可写且按用户隔离的 `userData/logs`（`%APPDATA%\Ecliptrix\logs`，因为安装目录位于
Program Files 下只读、且不应跨用户共享）；而开发态（`npm run dev`）通过新增的
`ECLIPTRIX_LOG_DIR` 环境变量把日志重定向到**项目内的 `desktop/logs/`**，从而真正实现需求
所述"放在桌面端的目录下的 logs 目录下"，让开发者无需进 AppData 即可查看分类日志。改造
不引入任何新的运行时 npm 依赖，仅用 Node 内置 `fs`/`path` 实现，保持与现有"极简、无重型
依赖"的工程风格一致。

---

## 2. Technical Design（技术设计）

### 2.1 日志分类（Category）模型

引入固定的**类别枚举**，每个类别对应 `logs/` 下的一个独立文件：

| Category 常量 | 文件名 | 内容来源 | 典型行 |
|---|---|---|---|
| `main` | `main.log` | 主进程应用生命周期 | 启动/版本/userData 路径/退出/窗口创建 |
| `process` | `process.log` | `ManagedService` 子进程监管事件（主进程视角） | spawn/healthy/exit/stop/restart |
| `config` | `config.log` | 配置、环境、端口决策 | initUserData、env 自愈、端口回退 |
| `ipc` | `ipc.log` | 渲染进程 IPC（默认 DEBUG，可关） | window 控制、bootstrap 凭证调用 |
| `backend` | `backend.log` | 后端（python）子进程**原始** stdout/stderr | 由 `attachChild` 透传，保留后端自有格式 |
| `frontend` | `frontend.log` | 前端（next）子进程**原始** stdout/stderr | 由 `attachChild` 透传 |
| （特殊汇聚） | `error.log` | 所有 ≥ WARN 的主进程行 + 子进程 stderr 行 | 排查问题的"第一落脚点" |

设计原则：
- **主进程结构化日志**（`main`/`process`/`config`/`ipc`）走带级别与统一格式的 `emit()`。
- **子进程原始日志**（`backend`/`frontend`）保持**原样透传**，不二次加工——后端 app.log /
  uvicorn / next 已有自己的格式，包一层只会破坏可读性；仅在 attach 时写一行会话分隔头。
- **原始 sink 保护（R2 修复）**：`backend`/`frontend` 是**只接原始透传的 sink**，只能由
  `attachChild` 写入；**结构化路径（`emit/info/warn/error/log`）一律不得把格式化行写进
  `backend.log`/`frontend.log`**。`emit()` 的类别解析规则固定为：
  1. 若 `category ∈ {backend, frontend}`（原始专属）→ **改投 `main.log`**（避免污染原始日志）；
  2. 若 `category ∈ {main, process, config, ipc}` → 写对应类别文件；
  3. 其余**未知类别** → **回退 `main.log`**（绝不允许 `path.join(dir, undefined)` 抛错）。
  兼容 shim `log(category,msg)` 等价 `info(category,msg)`，因而天然继承上述保护——即便
  `processManager.js` 迁移有遗漏、仍以 `name='backend'` 调 `log()`，也只会落到 `main.log`
  而非污染 `backend.log`。
- `error.log` 是**镜像汇聚 sink**，不是独立来源：任何 `emit(level≥WARN, ...)` 在写入其类别
  文件的同时**追加**一份到 `error.log`；子进程 **stderr** 数据块在写入 `backend.log`/
  `frontend.log` 的同时，以 `[<category>:stderr]` 前缀镜像一行到 `error.log`。
  （已知局限，R4：仅镜像 stderr；子进程打到 stdout 的错误不进 `error.log`，后续迭代再做内容启发式。）

### 2.2 日志级别（Level）与格式

级别：`DEBUG(10) < INFO(20) < WARN(30) < ERROR(40)`。默认 `minLevel = INFO`；低于
`minLevel` 的行直接丢弃（不开流、不落盘）。可通过环境变量 `ECLIPTRIX_LOG_LEVEL`
（`debug|info|warn|error`，大小写不敏感）覆盖。

结构化行格式（单行，UTF-8，`\n` 结尾）：

```
[2026-06-09T12:00:00.000Z] [INFO] [process] backend healthy at http://127.0.0.1:18321/api/health
```

即 `[ISO8601][LEVEL][category] message`。子进程原始输出**不套**该格式（保持透传）。

`emit()` 同时把行**回显到 `process.stdout`**（沿用现状：`npm run dev` 时 Electron 以
`stdio:'inherit'` 启动，开发者可在终端实时看到主进程日志）；子进程原始输出**不**回显
stdout（避免与后端自身控制台输出重复）。**stdout 回显必须 `try/catch` 包裹、失败静默**
（R8：打包态 GUI 无控制台，分离句柄上 `process.stdout.write` 可能 EPIPE；回显失败绝不能
影响落盘这一主职责）。

### 2.3 轮转（Rotation）与保留（Retention）

- **多代轮转**：单文件达到 `maxBytes`（默认 5MB，沿用现值）即轮转。轮转策略由"单一
  `.old`"升级为"N 代"（`maxGenerations` 默认 3）：删除最旧的 `<file>.3`，依次
  `<file>.2→<file>.3`、`<file>.1→<file>.2`，当前 `<file>→<file>.1`，再开新流写入。
- **按天保留清理**：`Logger` 构造时执行一次 `sweepRetention()`，删除 `logs/` 下 mtime 早于
  `retentionDays`（默认 7 天）的轮转文件。**匹配集合（R5 修复）**：既包含新式多代
  `*.log.<数字>`（`.1/.2/.3`），也包含**升级前旧式单代 `*.log.old`**，以便从旧版升级后遗留的
  `main.log.old`/`backend.log.old`/`frontend.log.old` 也能被按天回收。当前活动文件
  （`*.log`，无后缀代号）永不被清理。
- 轮转 rename 前**必须先关闭并从 `streams` Map 中移除该文件的写流**（Windows 对打开句柄
  的文件 rename 会失败）——沿用现有 `write()` 中"达阈值即 `end()` 并 `delete`，下次写入
  重新开流并触发轮转"的惰性机制，仅把轮转动作从单代改为多代。

### 2.4 关键代码路径（操作时序）

#### 2.4.0 两种运行时与各自的日志归属（R1 修复，务必先读）

桌面端有**两条不同的运行时路径**，日志产出差异巨大，方案与验收必须按运行时分别表述：

| 运行时 | 谁监管前后端 | Electron Logger 实际产出 | 子进程原始输出去向 |
|---|---|---|---|
| **打包态**（双击 exe / smoke-test） | Electron 主进程 `ManagedService.start()` + `attachChild` | **全套**：`main`/`process`/`config`/`error`(+可选`ipc`)，以及 `backend`/`frontend` 原始透传 | 经 `attachChild` → `backend.log`/`frontend.log` |
| **开发态**（`npm run dev`） | **`scripts/dev.js`** 自己 spawn 前后端；Electron 以 `--dev` 在 `index.js:111-116` 的 `if (isDev)` 分支**提前 return**，**从不** `startServices()`/`attachChild` | 仅少量**主进程 emit 行**：`main`（dev-attach 横幅）+ 个别 `process`/`config`/`ipc`（如 dev 前端不可达 → `warn('process')`）。**无 `attachChild` 原始透传，也无打包态完整的 spawn/healthy/exit 监管时序** | **不经** Electron Logger；由 `dev.js` 的 `console.log` 捕获 |

> 结论：**仅靠 `ECLIPTRIX_LOG_DIR` 重定向无法让开发态产出 `process/backend/frontend` 三类文件**，
> 因为开发态根本不走 `ManagedService`。要让 `npm run dev` 真正在 `desktop/logs/` 下产出分类文件
> （正是用户「放在桌面端的 logs 目录下、不同日志放在不同文件」的核心诉求所指向的、开发者每天会看的目录），
> 必须**在 `dev.js` 侧把已捕获的子进程输出 tee 到文件**（见 §2.4.1）。打包态则天然由 Electron Logger 产出全套。

#### 2.4.1 开发态 `dev.js` 的日志落盘（R1 修复）

`scripts/dev.js` 的既有 `spawnChild(name,...)` 已通过 `child.stdout/stderr.on('data', d => log(name, d))`
捕获子进程输出并 `console.log`。本期在**不改变编排逻辑**的前提下，扩展其 `log(tag,line)`：

1. 启动时 `fs.mkdirSync(path.join(DESKTOP_DIR,'logs'), {recursive:true})`，并把该路径作为
   `ECLIPTRIX_LOG_DIR` 注入 Electron 子进程的 env（使 Electron 主进程日志也落同一目录）。
2. `log(tag, line)` 在 `console.log` 之外，按 `tag` 追加到对应文件：
   `backend → desktop/logs/backend.log`、`frontend → desktop/logs/frontend.log`、
   `dev → desktop/logs/dev.log`（dev 编排自身的端口探测/启动/teardown 信息）。
   `electron` 子进程用 `stdio:'inherit'`，其输出本就不经 `dev.js`，由 Electron Logger 自行落
   `main.log`，故无需 tee。
3. 开发态文件采用**追加写、无轮转/无保留清理**（dev 会话短、文件已 gitignore，刻意从简，避免在
   编排脚本里重复实现 Logger 的轮转逻辑——保持右尺度）；每次 `npm run dev` 启动时在文件头写一行
   带时间戳的会话分隔。`backend.log`/`frontend.log` 仍是**原始透传**语义，与打包态一致。

> 净效果：`npm run dev` 后 `desktop/logs/` 至少出现 `dev.log`、`backend.log`、`frontend.log`、
> `main.log`（及 `ECLIPTRIX_LOG_LEVEL=debug` 时的 `ipc.log`），与打包态在「分类落盘」体验上对齐。

#### 2.4.2 打包态启动正常路径：

1. `index.js:main()` 计算 `state.logsPath = process.env.ECLIPTRIX_LOG_DIR || path.join(userData,'logs')`。
2. `new Logger(state.logsPath, { minLevel, maxBytes, maxGenerations, retentionDays })`
   → 构造函数 `mkdirSync(recursive)` + `sweepRetention()`。
3. `logger.info('main', 'Ecliptrix <ver> starting ...')` → 写 `main.log` + 回显 stdout。
4. 自愈/配置缺失/端口回退 → `logger.info|warn('config', ...)`（warn 同时进 `error.log`）。
5. `ManagedService.start()` → `logger.info('process', 'starting: ...')` 写 `process.log`；
   `logger.attachChild(child, 'backend')` 把后端原始输出导向 `backend.log`，stderr 镜像
   `error.log`。
6. 健康检查成功 → `logger.info('process', 'backend healthy at ...')`。
7. 子进程异常退出 → `logger.error('process', 'service backend exited ...')`（进 `process.log`
   且镜像 `error.log`）。
8. 退出 → `before-quit` 中 `logger.close()` 关闭所有写流。

### 2.5 与现有调用点的对齐（迁移映射）

所有现有 `logger.log(scope, msg)` 调用按下表重写为"类别 + 级别"形式（保留 `log()` 作为
`info()` 的**向后兼容浅封装**，避免遗漏调用点编译失败，但新代码一律用带级别的方法）：

| 文件:位置 | 现状 | 改造后 |
|---|---|---|
| `index.js` 启动横幅 | `log('main', 'starting')` | `info('main', ...)` |
| `index.js` dev attach | `log('main', 'dev mode ...')` | `info('main', ...)` |
| `index.js` env 自愈 | `log('main', 'self-healed ...')` | `info('config', ...)` |
| `index.js` 配置缺失 | `log('main', 'config incomplete ...')` | `warn('config', ...)` |
| `index.js` 端口回退 | `log('main', 'port fallback ...')` | `info('config', ...)` |
| `index.js` 启动失败 | `log('main', 'startup failed ...')` | `error('process', ...)` |
| `index.js` dev 前端不可达 | `log('main', 'dev frontend unreachable ...')` | `warn('process', ...)` |
| `index.js` 子进程异常退出 | `log('main', 'service ... exited ...')` | `error('process', ...)` |
| `index.js` 重启失败 | `log('main', 'restart failed ...')` | `error('process', ...)` |
| `index.js` stop 失败 | `log('main', 'stop failed ...')` | `warn('process', ...)` |
| `processManager.js` starting | `log(name, 'starting: ...')` | `info('process', ...)` |
| `processManager.js` exit | `log(name, 'exited ...')` | `info('process', ...)`（异常退出由 index 的回调记 error） |
| `processManager.js` healthy | `log(name, 'healthy ...')` | `info('process', ...)` |
| `processManager.js` stopping/stopped | `log(name, ...)` | `info('process', ...)` |
| `processManager.js` 强杀 | `log(name, 'grace period ...')` | `warn('process', ...)` |
| `processManager.js` attachChild | `attachChild(child, name)` | `attachChild(child, name)`（name=`backend`/`frontend`，签名不变，内部区分 stderr 镜像） |
| `windowControls.js` IPC | （无日志） | 可选 `debug('ipc', 'window:minimize')` |

> 注：`processManager.js` 不再用 `name`（backend/frontend）作为主进程日志的 scope；监管
> 事件统一归 `process` 类别，并在 message 文本里带上 `name`（如 `backend healthy at ...`），
> 这样 `process.log` 一处即可纵览两个子进程的生命周期，而 `backend.log`/`frontend.log` 仅
> 保留子进程自身的原始输出，职责清晰。

---

## 3. File / Module Change Plan（文件变更计划）

| 文件 | 动作 | 一句话意图 |
|---|---|---|
| `desktop/main/logger.js` | 重写 | 引入 `LogLevel`/`LogCategory` 常量、`CATEGORY_FILES` 映射、`emit/debug/info/warn/error` 级别方法、`error.log` 镜像、多代轮转、`sweepRetention()` 保留清理；`attachChild` 区分 stderr 并镜像；保留 `log()` 兼容封装 |
| `desktop/main/index.js` | 修改 | `logsPath` 支持 `ECLIPTRIX_LOG_DIR` 覆盖；`minLevel` 读 `ECLIPTRIX_LOG_LEVEL`；按迁移表把 `log('main',...)` 改为分类/分级调用 |
| `desktop/main/processManager.js` | 修改 | 监管事件统一归 `process` 类别并按语义分级；`attachChild(child,name)` 签名不变 |
| `desktop/main/windowControls.js` | 修改（可选，见 R3） | 接收 `logger` 并对四个 window 控制 IPC 记 `debug('ipc', ...)`；index.js 调用处传入 logger。**注意默认 `minLevel=INFO` 下 ipc 行全被丢弃、`ipc.log` 零产出**——本期可只建 `ipc` 枚举而暂不改本文件（更省），若改则需在 README 注明仅 `ECLIPTRIX_LOG_LEVEL=debug` 时产出 |
| `desktop/scripts/dev.js` | 修改 | （R1）在 launchElectron 的 env 注入 `ECLIPTRIX_LOG_DIR=<repo>/desktop/logs`，使 Electron 主进程日志落项目内；**并扩展 `log(tag,line)` 把 `backend`/`frontend`/`dev` 输出 tee 到 `desktop/logs/{backend,frontend,dev}.log`（追加写、无轮转）**，使开发态真正产出分类文件（见 §2.4.1） |
| `desktop/assets/error.html` | 修改 | 把"main.log / backend.log / frontend.log"提示更新为新文件集（强调先看 `error.log`、`process.log`） |
| `desktop/README.md` | 修改 | "目录结构"与"常见问题"补充新日志文件清单与级别/保留说明 |
| `desktop/scripts/test-logger.js` | 新建 | 纯 `node`（零新依赖）单测：验证类别路由、级别过滤、error.log 镜像、多代轮转、保留清理 |
| `desktop/package.json` | 修改 | 新增 `"test:logger": "node scripts/test-logger.js"` 脚本 |
| `desktop/scripts/smoke-test.js` | 修改（可选） | 退出前断言 `userData/logs` 至少包含 `main.log`/`process.log`/`backend.log`/`frontend.log` |
| `.gitignore` | 修改 | 追加 `desktop/logs/`（开发态日志目录，勿入版本库）。**必要性（R6）**：现有第 60 行 `*.log` 只匹配 `.log` 结尾文件，**不覆盖轮转代 `*.log.1/.2/.3`**，故需整目录忽略，不可省 |

> 约束遵守：本设计节点**不写实现代码**，上表仅为 Subtask #2 的逐项落地清单。

---

## 4. Interface Design（接口设计）

`Logger` 为主进程内部模块，无 REST/WebSocket 暴露；接口即其类方法签名。

```js
// desktop/main/logger.js（导出）
const LogLevel = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 }
const LogCategory = { MAIN:'main', PROCESS:'process', CONFIG:'config', IPC:'ipc', BACKEND:'backend', FRONTEND:'frontend' }

class Logger {
  /**
   * @param {string} logsDir 日志目录（已由调用方决定 userData/logs 或 ECLIPTRIX_LOG_DIR）
   * @param {object} [opts]
   * @param {number} [opts.minLevel=LogLevel.INFO]  低于此级别丢弃
   * @param {number} [opts.maxBytes=5*1024*1024]    单文件轮转阈值
   * @param {number} [opts.maxGenerations=3]         保留的轮转代数
   * @param {number} [opts.retentionDays=7]          轮转文件保留天数
   */
  constructor(logsDir, opts) {}

  debug(category, message) {}   // 便捷方法 → emit(DEBUG, ...)
  info(category, message)  {}   // → emit(INFO, ...)
  warn(category, message)  {}   // → emit(WARN, ...)；额外镜像 error.log
  error(category, message) {}   // → emit(ERROR, ...)；额外镜像 error.log

  /**
   * 统一出口：级别过滤 → 类别解析 → 格式化 → 写类别文件 → (≥WARN 时)镜像 error.log → 回显 stdout。
   * 类别解析顺序（R2，强约束）：
   *   - category ∈ {backend, frontend}  → 改投 main.log（结构化行不得污染原始 sink）
   *   - category ∈ {main, process, config, ipc} → 写对应类别文件
   *   - 其余未知类别                    → 回退 main.log（禁止 path.join(dir, undefined)）
   * 低于 minLevel 直接丢弃；stdout 回显以 try/catch 包裹、失败静默（R8）。
   */
  emit(level, category, message) {}

  /** 向后兼容：等价 info(category, message)（仅为不漏改调用点，新代码勿用）；
   *  继承 emit 的类别解析，故残留的 log('backend',...) 只会落 main.log 而非污染 backend.log。 */
  log(category, message) {}

  /** 透传子进程 stdout/stderr 到 <category>.log；stderr 同时镜像 error.log */
  attachChild(child, category) {}

  close() {}   // 关闭所有写流（before-quit 调用）
}

module.exports = { Logger, LogLevel, LogCategory }
```

环境变量接口：

| 变量 | 取值 | 作用 | 默认 |
|---|---|---|---|
| `ECLIPTRIX_LOG_LEVEL` | `debug`/`info`/`warn`/`error` | 主进程结构化日志最小级别 | `info` |
| `ECLIPTRIX_LOG_DIR` | 绝对路径 | 覆盖日志目录（dev.js 设为 `desktop/logs`） | `userData/logs` |

---

## 5. Data Model（数据模型）

无数据库参与。涉及的内存/磁盘结构：

- **内存**：`this.streams: Map<fileName, { stream: WriteStream, bytes: number }>`（沿用现状，
  键由 3 个固定文件扩展为最多 7 个类别文件 + `error.log`，仍受类别枚举上界约束，不会膨胀）。
- **磁盘布局**（打包态示例）：

```
%APPDATA%\Ecliptrix\logs\
├─ main.log            main.log.1 main.log.2 ...        # 应用生命周期
├─ process.log         process.log.1 ...                # 子进程监管
├─ config.log          config.log.1 ...                 # 配置/端口/env
├─ ipc.log             (可选, 默认 DEBUG 不产出)        # 渲染 IPC
├─ backend.log         backend.log.1 ...                # 后端原始输出
├─ frontend.log        frontend.log.1 ...               # 前端原始输出
└─ error.log           error.log.1 ...                  # 告警/错误/stderr 汇聚
```

- **日志行 schema**（结构化类别）：`timestamp(ISO8601) | level(枚举) | category(枚举) | message(string)`，
  以文本单行承载，便于 `findstr`/`Select-String`/`grep` 过滤，无需解析器。

---

## 6. Testing & Acceptance Criteria（测试与验收）

### 6.1 单元测试（`desktop/scripts/test-logger.js`，纯 node，零新依赖）

用临时目录构造 `Logger`，断言：
1. **类别路由**：`info('config','x')` 只写 `config.log`，不写 `main.log`。
2. **级别过滤**：`minLevel=WARN` 时 `info(...)` 不落盘，`warn(...)` 落盘。
3. **error 镜像**：`warn('process','x')`/`error(...)` 在类别文件与 `error.log` 各出现一次。
4. **stderr 镜像**：构造假 child（带 stdout/stderr 的 EventEmitter），向 stderr 推数据，断言
   `backend.log` 含原始内容且 `error.log` 含 `[backend:stderr]` 镜像行。
5. **多代轮转**：把 `maxBytes` 设极小并连续写入，断言生成 `<file>.1/.2/.3` 且不超过
   `maxGenerations`，最旧代被删除。
6. **保留清理**：预置一个 mtime 改早的 `main.log.2`，构造 Logger 后断言其被 `sweepRetention` 删除。
7. **格式**：行匹配 `^\[.+Z\] \[(DEBUG|INFO|WARN|ERROR)\] \[\w+\] `。

### 6.2 集成/冒烟（沿用 `desktop/scripts/smoke-test.js`）

- 完成一次正常启动后，断言 `userData/logs` 内 `main.log`/`process.log`/`backend.log`/
  `frontend.log` 均存在且非空；`process.log` 含 `backend healthy` 与 `frontend healthy`。

### 6.3 手工验收（**按运行时分别验收，R1**）

**开发态（`npm run dev`）**——此时前后端由 `dev.js` 监管，Electron 不 `attachChild`（§2.4.0）：
- `desktop/logs/` 出现 `dev.log`、`backend.log`、`frontend.log`、`main.log`（验证 `dev.js` tee 与
  `ECLIPTRIX_LOG_DIR` 同时生效）。
- `backend.log`/`frontend.log` 为子进程**原始输出**；`dev.log` 含端口探测/启动/teardown 行。
- **不保证**开发态产出**完整的 `process.log` 监管时序**（开发态无 `ManagedService`，至多有
  dev-前端-不可达这类零星 `warn('process')` 行，此乃预期，非缺陷）。

**打包态（双击 exe 或 `npm run smoke-test`）**——此时 Electron 全权监管：
- 正常启动后 `userData/logs` 内 `main.log`/`process.log`/`backend.log`/`frontend.log` 均存在且非空。
- 制造一次启动失败（占用端口 / 损坏 `.env`），错误页提示的目录中 `error.log` 含可定位的 ERROR 行；
  `config.log` 含端口/配置决策；`process.log` 含子进程 spawn/exit 时序。

### 6.4 Definition of Done

- 上述单测全绿（`npm run test:logger` 退出码 0）；smoke-test 仍通过。
- 不新增任何运行时 npm 依赖；`desktop/main/logger.js` 单文件 < 800 行、各方法 < 50 行。
- 现有调用点全部迁移，无残留把多来源混入单一 `main.log` 的写法。

---

## 7. Risks & Mitigations（风险与缓解）

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| 1 | 文件句柄数随类别增多 | 同时打开 ≤ 8 个写流 | 类别为**固定枚举**，上界确定；`close()` 统一回收 |
| 2 | Windows 对打开句柄文件 rename 失败导致轮转崩 | 轮转抛错 | 轮转前先 `stream.end()` 并从 Map 移除（沿用现有惰性轮转），rename 包 try/catch 降级为继续追加 |
| 3 | error.html / README 仍指向旧文件名 | 用户被误导 | 同批更新 `error.html` 与 `README.md`（见 §3） |
| 4 | 既有用户/外部工具假设 `main.log` 含后端行 | 兼容性 | 在 README"目录结构"显式说明类别迁移；`backend.log` 含义不变，仅主进程行被细分 |
| 5 | 子进程原始输出与 error.log 镜像交错 | 可读性 | 仅 **stderr** 镜像且带 `[cat:stderr]` 前缀；stdout 不镜像，量大也不污染 error.log |
| 6 | 多文件 × 多代轮转放大磁盘占用 | 磁盘 | `maxBytes(5MB)×maxGenerations(3)×文件数` 上界可估；叠加 `retentionDays` 按天清理 |
| 7 | `desktop/logs/` 误入版本库 | 仓库污染 | `.gitignore` 追加 `desktop/logs/`；提交节点用 `git add <具体路径>` 精确暂存 |
| 8 | `ECLIPTRIX_LOG_DIR` 指向不可写路径 | 启动即崩 | 构造函数 `mkdirSync(recursive)` 失败时回退 `userData/logs` 并记一条 stderr 提示 |
| 9 | 改动 dev.js env 影响既有 dev 流程 | 回归 | 仅**新增**一个环境变量注入，不改其余编排；未设置时行为与现状一致 |
| 10 | 级别误判把重要信息降级为 DEBUG 被吞 | 排障难 | 默认 `minLevel=INFO`；迁移表已逐条标注级别，评审节点（Subtask #1）复核分级合理性 |

---

## 8. 附：评审关注点与裁决（Subtask #1 已逐条裁决）

- **类别粒度（`ipc` 独立 vs 并入 `main`）** → 裁决：保留 `ipc` 枚举但**默认零产出**（R3）。
  本期可不改 `windowControls.js`；若改，须在 README 注明仅 `debug` 级产出。不过度拆分。
- **`error.log` 是否纳入 child stdout 疑似错误** → 裁决：**v1 仅镜像 stderr**（R4），避免把
  uvicorn/Next 的海量 stdout 污染汇聚文件；「按内容启发式镜像」列入后续迭代，已在 §2.1/§7 记录为已知局限。
- **轮转命名 `<file>.N` vs 按天文件名 `main-YYYYMMDD.log`** → 裁决：**保留 `<file>.N` 多代轮转**。
  桌面端单机、日志体量有界，`maxBytes×maxGenerations` + `retentionDays` 已能给出确定上界；
  「按天文件名」会引入日期切分、空文件、跨天句柄等额外复杂度，对本场景属过度设计，不采纳。
- **是否本期删除 `log()` 兼容 shim** → 裁决：**保留**。删除会在任一遗漏调用点造成 `TypeError`；
  而经 R2 的「原始 sink 保护 + 未知类别回退」加固后，shim 既安全又能兜住迁移遗漏。新代码仍一律用带级别方法。

---

## 评审结论（Review Verdict）

**结论：有条件通过（Approved with conditions）。**

总体评价：方案对桌面端日志的分类化、分级化、轮转与保留设计完整、贴合项目「极简、无重型依赖」
的工程风格，文件变更计划逐项可落地，测试与验收明确。两个 P1 缺陷（R1 开发态分类文件不可达、
R2 结构化日志可能污染原始 sink / 未知类别抛错）会直接导致「方案能用但用户看不到」或运行期异常，
**已在本 v2 文档正文就地修复**（§2.1 原始 sink 保护与类别解析、§2.4.0/§2.4.1 两运行时与 dev.js tee、
§4 `emit` 契约、§6.3 按运行时验收、§3 文件变更计划同步）。**当前无遗留 P0/P1。**

进入 Subtask #2（代码开发）前需满足以下落地条件（均为 P2，不阻断开工，但需在实现/Review 时核验）：

1. **C1（R1 验证）**：`dev.js` 必须真正把 `backend`/`frontend`/`dev` 输出 tee 到 `desktop/logs/` 下对应文件，
   并以 §6.3「开发态」清单手工验收通过——这是满足用户「桌面端 logs 目录下分类落盘」诉求的关键证据。
2. **C2（R2 验证）**：`test-logger.js` 须新增用例，断言 `emit('backend',...)` / `log('backend',...)`
   落到 `main.log` 而非 `backend.log`，且未知类别不抛错（回退 `main.log`）。
3. **C3（R3）**：`ipc`/`windowControls.js` 二选一——本期不改本文件，或改后在 README 注明默认零产出。
4. **C4（R4 / R8）**：README/§7 显式记录「`error.log` 仅镜像 stderr」这一已知局限；stdout 回显以 try/catch 包裹。
5. **C5（R5 / R6）**：`sweepRetention` 匹配集合覆盖 `*.log.<数字>` 与旧式 `*.log.old`；`.gitignore` 追加 `desktop/logs/`。
6. **C6（既有 DoD）**：`desktop/main/logger.js` < 800 行、各方法 < 50 行；不新增任何运行时 npm 依赖；
   现有 `logger.log(scope,…)` 调用点全部按 §2.5 迁移表迁移；`npm run test:logger` 与 `smoke-test` 全绿。

满足以上条件即视为方案落地达标，可推进至 Subtask #3（代码 Review 与提交）。

— 评审人：Subtask #1（方案评审与修复 Agent），评审日期 2026-06-09

---

## 实施过程发现的方案缺陷（Issues Found During Implementation，Subtask #2）

> 记录开发节点（Subtask #2）落码时发现、与方案文本不完全一致之处及其纠正方式，供 Subtask #3 复核。
> 这些都不是阻断性问题，已按「纠正后实现」处理，核心设计（分类/分级/镜像/轮转/保留）均按方案落地。

- **I1（§6.1 第 5 项「连续写入」测试配方不可靠）**：方案的轮转测试建议「把 `maxBytes` 设极小并
  **连续写入**，断言生成 `<file>.1/.2/.3`」。但本设计的轮转是**惰性**的——轮转只在「下次开流时
  `rotateIfOversized` 读取磁盘文件大小」触发，而 `WriteStream` 的落盘是**异步**的：在单个 Logger 内
  同步连续写入时，`statSync` 往往读到尚未 flush 的旧大小，导致轮转触发时机不确定，断言会偶发失败
  （实测首版即因此 `main.log` 断言失败）。**纠正后实现**：`test-logger.js` 改为「同步预写一个已落盘的
  超阈值 `main.log` → 构造新 Logger → 触发一次小写入使其重开并轮转 → `await logger.close()`」的确定性
  循环，验证目标不变（多代轮转上界 `maxGenerations`、最旧代被删除）。此为**测试配方**的修正，非运行时
  设计缺陷；惰性轮转机制本身按 §2.3 保留未改。
- **I2（`close()` 返回值，§4 接口微增强）**：§4 将 `close()` 标为无返回。为让单测能确定性地在断言前
  等待写流 flush，实现把 `close()` 改为**返回 `Promise.all(各流 end 回调)`**（调用方 `index.js`
  `before-quit` 仍可忽略返回值，行为不变）。属向后兼容的超集增强，不破坏契约。
- **I3（C3 取舍：已改 `windowControls.js`）**：C3 给出「本期不改 `windowControls.js`」或「改后在 README
  注明默认零产出」二选一。实现选择**后者**——`registerWindowControlIpc(logger)` 对四个窗口控制 IPC 记
  `debug('ipc', …)`，`index.js` 传入 `state.logger`；README「日志」一节已注明 `ipc.log` 仅
  `ECLIPTRIX_LOG_LEVEL=debug` 时产出、默认为空。如此 `ipc` 类别真正可用，且满足 C3/C4。

— 实施人：Subtask #2（代码开发 Agent），实施日期 2026-06-09
