# 诊断报告：桌面端打包在 `addWinAsarIntegrity` 改写 `Ecliptrix.exe` 时 `writeFile` 失败

> Bug 标识：`desktop-build-asar-integrity-writefile-lock`
> 诊断节点：Subtask #0（问题定位与分析）
> 关联轮次：第 3 轮需求「最近的修改导致无法进行桌面端打包构建，需修复使后续打包稳健可靠」
> 约束：本节点**只产出分析，不写修复代码、不 commit**。

---

## 一、问题描述（Problem description）

第 1/2 轮对「时间线轨道面板」做了一系列前端（`src/`）改动后，用户报告**桌面端（Windows / Electron）打包构建失败，无法产出安装包**，并把原因归到「最近的修改」上。

实际失败发生在打包流水线的**最后一步**——`electron-builder` 把 Electron 预编译壳复制为 `Ecliptrix.exe` 后、向其注入 asar 完整性校验信息（`addWinAsarIntegrity`）时，对 `Ecliptrix.exe` 的 `writeFile` 抛错，整个 `node scripts/build.js` 以退出码 1 终止，`build.ps1` 映射为 `[FAILED][build]`（退出码 4）。

关键结论（详见第三节证据）：

- 失败步骤在 **electron-builder 打包阶段**，**不在前端 `next build` 阶段**；前端 standalone 产物完全正常。
- 该失败是**间歇性（flaky）的文件锁竞争**：同一份代码、同一套产物，**04:38 失败、02:04 成功、复现时再次成功**。
- 第 1/2 轮的 `src/` 改动**不可能**导致此失败：它们改的内容进入的是 `extraResources`（`build/frontend`），在出错的这一步**之后**才被拷贝，**既不在 asar 内、也不写入 `Ecliptrix.exe`**。用户的「最近改动导致打包失败」属于**相关性误判（correlation ≠ causation）**。
- 本轮真正应交付的是**让打包对这类瞬时文件锁具备韧性（robust/reliable）**，而非「回滚 src 改动」。

---

## 二、复现步骤（Reproduction steps）

### 环境
- OS：Windows 11（`10.0.26200`），仓库位于 `M:\takoAI\Ecliptrix`。
- Node `22.18.0`，electron `33.4.11`，electron-builder `25.1.8`（见 `desktop/package.json:18-20` 与失败日志头）。
- 打包入口：`desktop/build.ps1` →（透传）`desktop/scripts/build.js` → `npx electron-builder`。

### 触发打包（任一即可）
```powershell
# 完整打包（NSIS 安装包 + win-unpacked），desktop/ 目录下
powershell -NoProfile -ExecutionPolicy Bypass -File desktop/build.ps1 -NoPause

# 或只复现打包步骤（复用已有 build/ 产物，最快）：desktop/ 目录下
npx electron-builder --win --x64 --config electron-builder.yml --dir
```

### 失败现象
- 控制台/日志在打印到 `• packaging platform=win32 ...` 之后、**没有**出现 `• updating asar integrity executable resource` 这行成功日志，即抛出 `writeFile` 栈并以退出码 1 退出。
- `build.ps1` 输出 `[FAILED][build]`，退出码 4。

### 复现稳定性（重要）
该 Bug **不是 100% 必现**，而是**文件锁竞争**导致的间歇失败：
- 本次诊断中，**直接重跑** `npx electron-builder ... --dir` 即**成功**（`EXIT=0`，复现日志 `desktop/cache/repro-eb.log`）。
- 因此「复现」的本质是：在 `Ecliptrix.exe` 刚被写出、句柄尚被外部进程（杀软实时扫描 / 残留 app 实例 / 索引器）占用的瞬间，撞上 `addWinAsarIntegrity` 的回写。机器越「忙」、杀软越激进，命中概率越高。

---

## 三、根因分析（Root cause analysis，含证据）

### 3.1 失败点定位：`addWinAsarIntegrity` 的 `writeFile`

失败日志 `desktop/cache/build-logs/build-20260614-043831.log:40-53`：

```
=== 打包(scripts/build.js) ===
  > node M:\takoAI\Ecliptrix\desktop\scripts\build.js
    (cwd: M:\takoAI\Ecliptrix\desktop)
    at writeFile (node:internal/fs/promises:1213:14)
    at addWinAsarIntegrity (M:\takoAI\Ecliptrix\desktop\node_modules\app-builder-lib\src\electron\electronWin.ts:39:3)
    at beforeCopyExtraFiles (...\app-builder-lib\src\electron\ElectronFramework.ts:83:7)
    at WinPackager.doPack (...\platformPackager.ts:302:7)
    ...
[build] FAILED: npx exited with 1
[FAILED][build] 命令失败(原始退出码 1)：node ...\scripts\build.js
```

对应的 electron-builder 源码 `desktop/node_modules/app-builder-lib/out/electron/electronWin.js:8-35`：

```js
async function addWinAsarIntegrity(executablePath, asarIntegrity) {
    const buffer = await readFile(executablePath);          // 读 Ecliptrix.exe（成功）
    const executable = NtExecutable.from(buffer);
    ...
    resource.outputResource(executable);
    await writeFile(executablePath, Buffer.from(executable.generate())); // ← 第 34 行：回写 Ecliptrix.exe（失败点）
    log.info({ executablePath: ... }, "updating asar integrity executable resource"); // 第 35 行：成功才会打印
}
```

证据链：
1. 栈顶是 `writeFile`（`node:internal/fs/promises`），且失败日志中**缺少**紧随其后的 `updating asar integrity executable resource` 成功日志（该 `log.info` 在 `writeFile` **之后**第 35 行）——说明确实卡在**回写** `Ecliptrix.exe`，而非读取。
2. `readFile` 已成功（无报错），排除「文件不存在 / 还没生成」（ENOENT）类问题；失败专属于**写**，是典型的 Windows **文件被占用**（`EBUSY` / `EPERM` / `EACCES`）。
3. 该步骤的触发条件：`ElectronFramework.js:40-45`——仅当 `packager.platform === WINDOWS` 且 `options.asarIntegrity` 为真时调用 `addWinAsarIntegrity`；而 `asarIntegrity` 在我们 `electron-builder.yml:38` 设了 `asar: true` 且 electron 版本支持 Windows 完整性注入时由打包器自动计算。

> 注：失败日志只剩**半截栈**、缺失真正的一行错误消息（`EBUSY/EPERM: ...`）。原因是 `build.ps1` 的 transcript **不捕获 node/npm 子进程直写控制台的输出**（脚本头部已自述：`build-20260614-043831.log:26`「node/npm 子进程输出不在其中」）。这是**可观测性缺口**，下文作为附带建议处理。

### 3.2 时序与「闪现锁」机理

`ElectronFramework.js:40-45` 的 Windows 分支顺序是：

```js
// 1) 把 electron.exe 重命名为 Ecliptrix.exe（刚刚由复制 electron dist 产生，约 188MB）
await rename(path.join(appOutDir, `${electronBranding.projectName}.exe`), executable);
// 2) 立刻读 → 改 → 回写同一个 Ecliptrix.exe，注入 INTEGRITY 资源
if (options.asarIntegrity) {
    await addWinAsarIntegrity(executable, options.asarIntegrity);
}
```

「复制/重命名出一个 188MB 的新 exe」与「立刻回写它」之间窗口极短。在 Windows 上，新落盘的可执行文件会被 **Defender 实时保护 / 第三方杀软 / 搜索索引器**在创建瞬间打开扫描，短暂持有独占句柄；`addWinAsarIntegrity` 的回写恰好撞上 → `writeFile` 抛 `EBUSY/EPERM`。这是 electron-builder 在 Windows 上**已知的偶发性**问题，与被打包的业务代码无关。`M:` 盘若为映射/外部卷，写回大文件的句柄释放更慢，会进一步放大命中概率。

`Ecliptrix.exe` 落盘时间戳印证「exe 刚写出即被回写」：
```
desktop/release/win-unpacked/Ecliptrix.exe   188784128 字节   2026-06-14 04:45（失败那次打包留下的产物）
```

### 3.3 间歇性证据：同代码同产物，成功/失败交替

对 `desktop/cache/build-logs/` 全量日志统计，**只有 04:38 这一次**因 `addWinAsarIntegrity` 失败；前后多次打包均成功：

| 日志 | 结果 | 关键行 |
|---|---|---|
| `build-20260614-020421.log:40` | **成功** | `• updating asar integrity executable resource executablePath=release\win-unpacked\Ecliptrix.exe` → 产出 `Ecliptrix-Setup-1.0.0.exe`，冒烟测试通过（`:47-59`） |
| `build-20260614-043831.log:40-50` | **失败** | `at writeFile ... at addWinAsarIntegrity ...` → `[build] FAILED: npx exited with 1` |
| 本次诊断复现 `desktop/cache/repro-eb.log` | **成功** | `EXIT=0`，打到 `• updating asar integrity executable resource` |

> 其余历史失败均为**另类原因**，非本 Bug：`build-20260612-065230.log`（`npm exited with 2147483651`，前端构建崩）、`build-20260607-134543.log`（`[FAILED][smoke]` 冒烟阶段）、`build-20260607-04xxxx.log`（`未在 PATH 中找到命令「node」` 环境问题）。

「同输入下重跑即过」是**竞争/瞬时锁**的决定性特征——若是代码缺陷导致的确定性失败，重跑应当稳定复现。

### 3.4 为何与第 1/2 轮 `src/` 改动无关（排除误判）

1. **改动范围**：第 1/2 轮提交（`d9dfc98^..9a9ea10`）对 `desktop/` 的改动 diff 为**空**，全部落在 `src/` 与 `docs/`：
   ```
   git diff --stat d9dfc98^ 9a9ea10 -- desktop/   →  （空，未触碰 desktop/ 任何文件）
   ```
   而出错步骤操作的是 **asar**（由 `desktop/main`、`desktop/preload`、`desktop/assets`、`desktop/package.json` 打包而成，见 `electron-builder.yml:20-37`）与 **`Ecliptrix.exe` 二进制**——第 1/2 轮**一个都没改**。

2. **数据流隔离**：`src/` 改动经 `prepare-frontend.js` 的 `next build`（`DESKTOP_BUILD=1` standalone）产出，落到 `build/frontend`，再由 `electron-builder.yml:40-48` 作为 **`extraResources`**（asar **之外**）拷入包。`extraResources` 的拷贝发生在 `beforeCopyExtraFiles`（即出错步骤）**之后**，因此 `src/` 内容**不参与** asar 完整性计算、**不写入** exe。

3. **前端构建已自证健康**：本次诊断
   - `npm run type-check`（`tsc --noEmit`）**零错误**通过；
   - `DESKTOP_BUILD=1 npm run build` **成功**，`.next/standalone/server.js`、`.next/static`、`.next/standalone/node_modules/@mariozechner`（serverExternalPackages 追踪，`prepare-frontend.js:67-74` 的断言点）均生成正常；
   - `next.config.js:40-43` 仅 `eslint.ignoreDuringBuilds: true`、**未**设 `typescript.ignoreBuildErrors`，意味着若 `src/` 有类型错误会直接打断 `next build`——但它没有。

   结论：前端这一关稳过，失败纯在打包末端的文件锁。

---

## 四、影响面（Impact surface）

- **受影响功能**：仅 **Windows 桌面端打包**（`desktop/build.ps1` / `desktop/scripts/build.js`）。一旦命中，**无法产出 `release/Ecliptrix-Setup-<ver>.exe` 与 `win-unpacked/`**，阻断发版与 Subtask #2/#3 的「构建可启动」验收。
- **不影响**：Web 前端（`npm run dev` / `npm run build`）、后端服务、运行期功能、已安装到用户机器上的 app。
- **受影响人群**：执行桌面打包的开发/CI 机器，**杀软实时保护开启、磁盘较忙或工程位于映射/外部盘（如本机 `M:`）时命中率更高**。
- **可观测性副作用**：当前 `build.ps1` transcript 不收子进程输出（`build-20260614-043831.log:26`），导致失败时**丢失真正的错误消息**，每次都要靠半截栈猜，拖慢定位——这是「打包不稳健」的一部分。

---

## 五、候选修复方案（Candidate fixes，对比）

> 所有方案均落在 `desktop/scripts/build.js`（必要时 `build.ps1`），**不动业务 `src/` 代码**，不回滚第 1/2 轮成果。

| 方案 | 做法 | 侵入性 | 风险 | 工作量 | 能否根治本次失败 |
|---|---|---|---|---|---|
| **A. 打包重试** | 在 `build.js` 把 `run('npx', builderArgs, ...)`（`build.js:118`）包成 `runWithRetry`：非零退出时**最多重试 2~3 次**，每次间隔 3~5s（给杀软/索引器释放句柄的时间）。识别到瞬时锁（`EBUSY/EPERM/EACCES` 或 `addWinAsarIntegrity` 关键字）才重试，重试前删除上次残留的 `release/win-unpacked`。 | 低（仅 build.js） | 低-中（盲目重试可能掩盖确定性失败 → 限次数 + 仅瞬时错误重试 + 最终把原始错误抛全） | 低 | **能**（已证明同输入重跑即过） |
| **B. 打包前清场** | 打包前：①杀掉 `release/` 下仍在运行的 `Ecliptrix.exe` 进程（复用 `smoke-test.js:73-88` 的 `processesUnder` 逻辑）；②`fs.rmSync(release/win-unpacked)`。消除「残留实例占用旧 exe」与「陈旧 exe」两类锁源。 | 低 | 低 | 低 | **部分**（消除残留进程锁，但**挡不住**杀软对「新写出 exe」的实时扫描——而本次的主因正是后者） |
| **C. 关闭 Windows asar 完整性注入** | 设法跳过 `addWinAsarIntegrity`（25.1.8 无干净的公开开关：要么 `asar:false` 退化巨大、要么补丁 node_modules）。 | 中-高 | 中（丢失 asar 防篡改校验；改 node_modules 不持久，需 `patch-package`） | 中 | 能但**不推荐**（牺牲安全特性 + 维护负担） |
| **D（推荐）. B + A 组合** | 先 **B 清场**（删残留进程 + 删旧 win-unpacked），再用 **A 重试**包裹 electron-builder（仅瞬时锁重试、限次、带短退避）。两类锁源全覆盖：残留实例锁靠 B 根除，杀软实时扫描锁靠 A 退避重试化解。 | 低（集中在 build.js） | 低 | 低-中 | **能（最稳）** |

附带建议（独立于上述，强烈建议同时做，直接服务「稳健可靠」）：
- **E. 修复可观测性**：让 electron-builder 子进程的 **stdout/stderr 全量落盘**（如 `build.js` 把 electron-builder 输出 tee 到 `cache/build-logs/electron-builder-<stamp>.log`，或在 `build.ps1` 文档化的 `> full.log 2>&1` 基础上让 build.js 自己留底）。这样下次失败能直接看到 `EBUSY/EPERM: ... Ecliptrix.exe` 原文，而不是半截栈。
- **F. 文档/环境兜底（非代码）**：在 `desktop/README.md` 注明「为构建目录加杀软排除项」可显著降低命中率；CI 机器同理。作为补充，不作为主修复。

---

## 六、推荐方案（Recommended fix）

**采用方案 D（B 清场 + A 重试），并同时落实 E（全量构建日志）。**

理由：
1. **直击根因且已验证**：本次失败是 `Ecliptrix.exe` 回写时的瞬时文件锁；「同输入重跑即成功」已被复现日志（`repro-eb.log`，`EXIT=0`）证明——A 的重试能稳定化解；B 进一步根除可控的残留进程锁源，二者互补，覆盖全部已知锁向量，最贴合本轮「**后续打包稳健可靠**」的目标。
2. **零安全/功能回退**：保留 `asar: true` 与完整性注入（不取 C），不牺牲防篡改能力。
3. **爆炸半径最小**：改动集中在 `desktop/scripts/build.js`（必要时 `build.ps1`），**不碰 `src/`、不回滚第 1/2 轮**、不引入新依赖、不打 node_modules 补丁（不持久）。
4. **E 让未来失败可诊断**：本次定位被「半截栈」拖慢，补上全量日志能让后续任何打包异常一眼定位，是「稳健可靠」的必要配套。

实现要点提示（供 Subtask #2 落地，避免踩坑）：
- 重试**只针对瞬时锁**（匹配 `EBUSY|EPERM|EACCES` 或 `addWinAsarIntegrity`/`updating asar integrity` 上下文），**限 2~3 次**、**带 3~5s 退避**；超限后**把最后一次的完整错误原样抛出**，不得静默吞错（遵循 CLAUDE.md「错误显式传播」）。
- 每次重试前 `fs.rmSync(RELEASE_DIR/win-unpacked, {recursive:true,force:true})`；若 rm 因句柄占用失败，先杀 `processesUnder(release)` 再删。
- 清场的进程枚举/杀进程可直接复用 `smoke-test.js:73-88`（`processesUnder`）的实现，保持单一实现来源。
- 顺带把 electron-builder 子进程输出落盘到 `desktop/cache/build-logs/`，与现有 transcript 互补。

---

## 七、关键证据索引（便于评审复核）

- 失败栈与退出码：`desktop/cache/build-logs/build-20260614-043831.log:40-53`
- 成功对照（同代码）：`desktop/cache/build-logs/build-20260614-020421.log:40-59`
- 复现即过（间歇性铁证）：`desktop/cache/repro-eb.log`（`EXIT=0`）
- 失败步骤源码：`desktop/node_modules/app-builder-lib/out/electron/electronWin.js:8-35`（第 34 行 `writeFile` 为失败点）
- 触发条件：`desktop/node_modules/app-builder-lib/out/electron/ElectronFramework.js:40-45`（`asarIntegrity` → `addWinAsarIntegrity`）
- 打包调用点（待加重试/清场）：`desktop/scripts/build.js:115-121`
- asar 与 extraResources 边界：`desktop/electron-builder.yml:20-48`
- 前端产物与 src 隔离：`desktop/scripts/prepare-frontend.js:24-75`、`next.config.js:36-43`
- 改动范围隔离：`git diff --stat d9dfc98^ 9a9ea10 -- desktop/`（空）
- 残留进程清理可复用实现：`desktop/scripts/smoke-test.js:73-88`、`:228-237`
- 日志可观测性缺口：`desktop/cache/build-logs/build-20260614-043831.log:26`

---

## 八、实施过程发现的方案缺陷（Issues Found During Implementation）

> 由 Subtask #2（修复实现）在落地推荐方案 D 时发现并已修正。

### 缺陷：第六节「重试匹配」建议把 `updating asar integrity` 纳入瞬时锁特征是误判源

第六节实现要点建议「重试只针对瞬时锁（匹配 `EBUSY|EPERM|EACCES` 或
`addWinAsarIntegrity`/`updating asar integrity` 上下文）」。实测对照真实日志后发现
**`updating asar integrity` 这个 token 不能用于判定瞬时锁**：

- 它是**成功**日志行 `• updating asar integrity executable resource ...` 的原文
  （见成功对照 `build-20260614-020421.log`），即 **asar 完整性注入「成功」时才打印**；
- 真正的**失败**日志（`build-20260614-043831.log`）里**没有**这一行，只有错误栈帧
  `at addWinAsarIntegrity (...)`；并且因第三节所述的 transcript 可观测性缺口，
  连真正的 `EBUSY/EPERM` 错误消息都丢了，**唯一可靠的失败特征就是 `addWinAsarIntegrity` 栈帧**。

证据（对三份真实日志跑分类正则）：

| 日志 | 含 `addWinAsarIntegrity` | 含 `updating asar integrity` | 含 `EBUSY/EPERM/EACCES` |
|---|---|---|---|
| 成功（`...020421.log`） | 否 | **是** | 否 |
| 失败（`...043831.log`） | **是** | 否 | 否（被 transcript 吞掉） |

后果：若把 `updating asar integrity` 当作瞬时锁特征，则当 asar 步骤**成功**、但**之后**
某个**确定性**步骤（如 NSIS 打包）失败时，捕获到的全量输出里仍含成功行
`updating asar integrity`，会被误判为「瞬时锁」从而**对确定性失败白白重试 2 次**
（每次重试还要 ~30s 进程枚举 + 数分钟重打包），既浪费时间又掩盖真因。

### 修正

分类正则改为 `/EBUSY|EPERM|EACCES|addWinAsarIntegrity/i`——**移除** `updating asar integrity`，
仅保留「只在出错栈里出现」的 `addWinAsarIntegrity` 与三个 Windows 文件锁错误码。
这样：成功后再失败的确定性错误**不会**被误重试；本次记录在案的真实瞬时失败
（只剩 `addWinAsarIntegrity` 半截栈）仍能被正确识别为可重试。其余方案（B 清场 + A 限次退避重试 +
E 全量日志）按推荐原样落地。修正点见 `desktop/scripts/build.js` 的 `TRANSIENT_LOCK_RE`。

### 缺陷二：第六节「每次打包前都清场（同步 rmSync + 预先 processesUnder）」会把构建拖死

第五/六节方案 B 主张「打包前」就 `fs.rmSync(release/win-unpacked)` 并先 `processesUnder` 杀残留进程。
落地后实测发现，**对每一次打包都这么做**有两个严重副作用：

1. **同步删多 GB 阻塞事件循环**：`win-unpacked` 含嵌入式 Python（数千个小文件）+ electron
   188MB + ffmpeg/前端，约 0.7–2GB。`fs.rmSync(..., {recursive:true})` 是**同步**调用，在
   `M:` 这类盘上删完要数分钟，期间**整个 Node 事件循环被卡死**：实时输出停摆、连
   `createWriteStream` 的 feature-E 日志文件都因为 `_construct` 的 nextTick 排不上而**始终没被创建**，
   外观上「像挂死」。本次验证第一次跑就因此卡住，被迫中止。
2. **预先 `processesUnder` 恒定 ~30s 开销**：`Get-CimInstance Win32_Process` 枚举全机进程在本机
   约需 30s；而正常构建根本没有残留 `Ecliptrix.exe`（冒烟测试已在上轮清干净），这 30s 几乎纯属浪费，
   且×最多 3 次。

证据：中止前 `node` 进程 CPU 仅 0.3s、`win-unpacked` 完整未删——说明卡在 `processesUnder` 的
powershell CIM 子进程上，`rmSync` 还没轮到。

### 修正二

把清场改为 **「只在重试前做、且异步、且 rm 优先」**：

- **只在 `attempt > 1`（重试）时**清场。第一次打包**不**预清场，交给 electron-builder 自行覆盖
  输出目录——即本修复前的原始行为，成功路径零额外开销（实测整轮 `--dir` 仅 1.1 分钟）。
  两类锁向量仍全覆盖：杀软扫新 exe 的锁→A 退避重试化解；残留实例锁→首跑会以 EPERM 失败，
  重试前的清场把它清掉后即通过。
- 清场用 **`await fs.promises.rm(...)`（异步）**，多 GB 删除走线程池、不再卡事件循环。
- **rm 优先**：直接删；**仅当删除因句柄占用失败时**才 `processesUnder` + `killPids` 再删一次，
  把 ~30s 的进程枚举从「每次必付」降为「极少数失败路径才付」（与第六节「若 rm 因句柄占用失败，
  先杀 processesUnder 再删」的提示一致）。

修正点见 `desktop/scripts/build.js` 的 `cleanReleaseDir()` 与 `runElectronBuilder()`。
修正后实测：`--dir` 打包 1.1 分钟跑通，`addWinAsarIntegrity`（即原失败步）的
`updating asar integrity executable resource` 成功打印，feature-E 全量日志正常生成。
