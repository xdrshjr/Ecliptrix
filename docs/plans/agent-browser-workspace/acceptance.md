# Agent 浏览器工作台 · 验收记录（实施节点）

> 日期 2026-11-25，分支 `feat/remotion-effects-studio`，基线 HEAD `0c4744be`。未 commit。
> 本记录只写**本机已实际跑过**的命令与结果；打包安装包、真实桌面人工走查**未执行**，见末尾「未验证项」。

## 实测命令与输出

| 范围 | 命令 | 结果 |
|---|---|---|
| 主进程 | `cd desktop; npm run test:browser` | PASS，10 套 83 项（navigationGuard 7 / core 11 / cookiePersister 5 / hardening 8 / pageScripts 9 / cdpEngine 6 / control 10 / controlServer 7 / misc 5 / integration 15） |
| 主进程·真实 Electron 33 | `npm run spike:browser`（需先 unset `ELECTRON_RUN_AS_NODE`） | 13/13：窗口最小化后 click/fill/scroll 正常、自家端口封禁、会话 Cookie 续期 30 天（主进程线实测，本节点未重跑） |
| 主进程回归 | `npm run test:auth`、`window-state`、`backendService.test.js`、`build-payload-checks` | 全绿（主进程线实测；`test:auth` 134 项） |
| 后端 | `pytest tests -k "browser or workspace" --ignore=data` | **230 passed, 1 skipped**（本节点重跑）；改前同筛选基线 127 passed |
| 后端相邻 | research / agent_host / system_settings / media（后端线跑） | 213 + 356 全绿，无回归 |
| 前端 | `vitest run`：components/browser、settings、contexts、lib/__tests__/browserWorkspace*、browserWorkspace.surface、browserTools.schema、components/video/workbench | **47 文件 379 项全绿**（本节点重跑） |
| 类型 | `npm run type-check` | 17 个错误，与基线一致，**无一落在本次触碰文件** |
| Lint | `ESLINT_USE_FLAT_CONFIG=false npx eslint <全部触碰 src 文件>` | 0 error、2 warning（`video-editing-agent/types.ts` 第 1 行既有未用导入） |
| 全量 vitest | `npx vitest run` | 51 文件失败 / 21 用例失败 / 5462 通过。失败文件为 `effectApplyReceipts.ts` 的 `node:crypto` 在 jsdom 下收集失败（该文件未被本次触碰）及 `recoveryBackup` CRLF 断言；`--environment node` 跑 agent 目录：6 个失败文件，其中 `systemPrompt.toolkit`（5 条）与 `subtitleDisclosure`（1 条）为改前即红的提示词预算用例，其余为 DOM 依赖用例在 node 环境下的伪失败 |

## AC 对照

| AC | 状态 | 证据 |
|---|---|---|
| A1–A12 | 后端 + 主进程集成测试通过 | `test_browser_workspace_service/dispatch/policy/resources`、`integration.test.js`；A8 结构成立（crew 无 browser 工具，且设 isolated） |
| A13 超时链路 | 通过 | 后端假时钟 60–120 s 审批延迟后 open/act/request_user 成功；前端断言 WebCall `timeout:140000`，read/close 15000/5000 |
| B1–B9 | 单测 + spike | navigationGuard 向量（46 条，Python 端同向量一致）、hardening、controlServer（Bearer/Host/Origin） |
| B10 隐藏态 | spike 通过 | 最小化后 click/fill/scroll 成功；**spec 的 x=-32000 对 WebContentsView 无效，已改为停靠内容区最后 1 px**（见 spec 缺陷节）；最小化截图返回 `screenshot_unavailable`（降级路径） |
| C1–C9 | 主进程单测 + spike | profiles / cookiePersister / integration |
| C10 授权按用户 | 通过 | integration（授权存 `profiles.json`）；后端 `test_browser_token_never_leaks`/settings 测试：`system_settings` 无授权键 |
| C11 披露与留存 | 通过 | `browserWorkspaceCopy.test.ts`（中英含「发送给模型服务」）；artifact `retention_days=1` 且 `source:'workspace'` |
| D1–D14 | jsdom 组件测试通过；**真实视图边界/冻结帧未在 Electron 中验证** | 见「未验证项」 |
| D12 对比度 | 通过（有偏差） | 亮色 `--ws-agent` 改 `#B24F2C`（原 `#B8532F` 仅 4.46:1） |
| E1 提示词预算 | **部分** | 改前 W=18 593/19 690（均已超 18 500，spec 前提不成立）；改后 18 416/19 513，规则 132 字符；不增反减，无断言被放宽；带满索引情形仍超 18 500，改前即红 |
| E2–E5 | 通过 | `browserWorkspace.surface.test.ts`（19 项）；description 93 字节、L1 引导 1000 字节、目录行 ≤160 |
| F1–F7 | 通过 | integration（browser_busy、风险门禁、YOLO 拒绝、令牌不外泄） |
| F8 闸门锁定 | 通过 | integration：423、视图摘下、审批取消、解锁恢复 |
| G1 行数棘轮 | 通过 | 见下表 |
| G5 无 DDL | 通过 | 无数据库改动 |
| G6 文档 | 通过 | `CLAUDE.md` 新增「Agent browser workspace」小节；`desktop/README.md` 新增小节与走查清单 |

## 行数棘轮

| 文件 | 基线 | 现 | 预算 |
|---|---|---|---|
| `desktop/main/index.js` | 717 | 732 | ≤800（目标 +10，实际 +15，**略超目标**） |
| `browser_service.py` | 501 | 491 | 净增 ≤0 ✓ |
| `research_browser_router.py` | 93 | 118 | ≤150 ✓ |
| `FooterToolbar.tsx` | 226 | 230 | ≤240 ✓ |
| `EditorWorkbench.tsx` | 143 | 147 | ≤160 ✓ |
| `page.tsx` | 207 | 210 | ≤215 ✓ |
| `i18n.ts` | 13 649 | 13 653 | +≤6 ✓ |
| `VideoEditingInterface.tsx` | — | 零改动 | ✓ |
| `desktop/main/browserWorkspace/index.js` | — | 380 | spec 预算 240，**超出**（门面承担了锁定/授权/设置联动） |
| `browser_workspace/dispatch.py` | — | 192 | spec 预算 120，**超出** |

## 偏离 spec（详见 spec.md「实施过程发现的方案缺陷」）

快捷键 `Alt+B`→`Ctrl+Alt+B`；Dock 挂 `.ws-upper`；隐藏态停靠方式；空白 WebContents 先 `about:blank`；`scroll` wheel→`scrollBy` 回落；`screenshot_unavailable` 改 503/transient；`WebResearchError.sticky` 默认 `None`；`FooterToolbar` 等小改见各线记录。

## 未验证项（如实）

1. **未生成安装包、未跑打包态冒烟** `browser-workspace-smoke.js`（仅语法检查）；§8.3 ⑤⑥⑧ 与最后一道人工桌面走查（登录→重启保持→Agent 搜新闻取图入库→接管/交还→风险确认→遮挡场景→最小化后继续→闸门锁定后恢复）**待人工**，清单在 `desktop/README.md`。
2. 前端遮挡/冻结帧/边界同步只有 jsdom 测试；悬浮助手面板（`role=dialog`）盖住 Dock 视口、可拖动悬浮按钮被拖到视口上，需走查。
3. AC-D13 遍历测试是棘轮：现有 5 个 portal 文件未带遮挡标记，登记在已知名单，需人工复核。
4. `suggestComplete`（登录完成建议）未实现；favicon 内联缓存按 §2.3 裁剪。
5. 提示词预算：6 条既有断言在改前即红且仍红（见 E1），需另行压缩约 1 000 字符 L0 文本。
6. 后端控制客户端仅对本地 aiohttp 假服务与主进程线的假 Electron 集成测试验证过，未做「真后端 ↔ 真 Electron」联调。

---

# 迭代 2 · 收口与硬化验收记录

> 日期 2026-11-25，分支 `feat/remotion-effects-studio`，迭代 1 提交 `4e1ad78f` 之上，**未 commit**。设计依据 `spec.md`「迭代 2 增补（v2.2）」；偏差见 spec 末尾「实施过程发现的方案缺陷（迭代 2）」。只写本机实际跑过的命令与结果。

## I2-1 开工前基线（AC-H8 对照用）

| 项 | 命令 | 基线 |
|---|---|---|
| vitest 全量 | `npx vitest run --reporter=json`（jsdom 默认环境） | **666 文件 / 5483 用例；51 个文件失败、21 个用例失败**（`effectApplyReceipts.ts` 的 `node:crypto` 在 jsdom 下使一批文件整体加载失败，既有问题，不在本迭代修）。浏览器相关目录（`src/components/browser`、`src/contexts`、`desktop/main/browserWorkspace`）无一在失败集中 |
| 提示词两文件 | `npx vitest run --environment node src/lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts src/lib/video-editing-agent/__tests__/subtitleDisclosure.test.ts` | 6 条红：2 条工具数（19≠18）+ 4 条字符预算 |
| 主进程 | `npm run test:browser` | 10 套 / 83 项 |
| 后端 | `pytest tests -k "browser or workspace" --ignore=data` | 230 passed / 1 skipped |

## I2-2 完成后实测

| 范围 | 命令 | 结果 |
|---|---|---|
| 主进程 | `cd desktop; npm run test:browser` | **PASS：11 套 / 96 项**（新增 `loginHeuristics` 11 项；`misc` 5→7 项含 `forwardToRenderer` 2 项）。CLAUDE.md 计数已同步 |
| **真后端 ↔ 真 Electron（W7）** | `cd desktop; npm run test:browser:e2e` | **PASS 13/13**（见 I2-3） |
| 后端 | `pytest tests -k "browser or workspace" --ignore=data` | **231 passed / 1 skipped**（+1：`login:` 前缀契约） |
| 前端（浏览器相关） | `vitest run src/components/browser src/contexts src/lib/__tests__/browserWorkspace src/components/video/components/AgentChatDock src/hooks` | **25 文件 / 250 项全绿**（另 `useOpenSettingsEvent` 2 项全绿） |
| vitest 全量 vs 基线 | 同基线命令 | **668 文件 / 5501 用例；失败用例仍 21 条，失败文件 52**。相对基线「无新增失败」：多出的 1 个失败文件 `components/auth/__tests__/LoginScreen.test.tsx` 是**时间敏感用例在与 `build:dir`、vitest 并行的高负载下偶发**，单独运行 17/17 通过，与本次改动无关（未触碰 auth）；基线中的 `toolkitAdapter sends x-tool-call-id…` 同样是负载下偶发（本次反而通过）。新增文件 +2（`fabAvoid.test.ts`、`useOpenSettingsEvent.test.tsx`） |
| 类型 | `npm run type-check` | 17 个错误，**与基线一致，无一落在触碰文件**（16 个 `docs/diagnoses/**` 探针 + 1 个 `SkillRouterSettingsPanel.test.tsx`）。中途引入的 1 个（`testUtils.tsx` Set 展开）已修 |
| Lint | `ESLINT_USE_FLAT_CONFIG=false npx eslint <25 个触碰的 src 文件>` | **0 error**，2 个既有 warning（`StoryboardSegmentCard` 的 `<img>`） |
| 提示词两文件（node 环境） | 同基线命令 | W4a 后 **2 条工具数断言转绿**；4 条字符预算仍红（W4b 停止条件，见 I2-4） |

## I2-3 W7 联调记录（`npm run test:browser:e2e`，一次通过的运行）

隔离：Electron `userData`、后端 `DATABASE_URL`、`STORAGE_ROOT` 全在 `os.tmpdir()/ecliptrix-bw-e2e-<pid>-*`，应用退出后由脱离的子进程删除；后端为占位 `LLM_API_URL/KEY`（e2e 不调 LLM）；控制端点与令牌经环境注入、顺序与生产一致。私网放行**只在临时库里**打开，且第一项就是「关闭时必须被拒」的反例。

```
PASS - private-network guard refuses the loopback fixture while the switch is off (403 private_network_blocked)
PASS - consent approval is raised in the main process
PASS - open → session_id is a UUID, backend 200
PASS - read → page text reaches the backend contract (full_text / elements)     keys=snapshot_version,title,elements,viewport,truncated,frames_unsupported,text,session_id,final_url,snapshot_artifact_id,artifact_id,source_id,sources,mode,untrusted,profile,control
PASS - act(click) executes in the real page
PASS - save-to-library of a loopback image is refused by the hard egress rule (host_literal_non_global)
PASS - login handoff: suggestComplete is raised after a cross-host SSO sign-in (R3-3)
PASS - login handoff: approval granted >20 s after it was raised still completes (timeout chain)   200 after 21s
PASS - captcha handoff: the same sign-in flow never raises suggestComplete (R3-4)
PASS - close releases the session
PASS - Ctrl+L inside a page view hands keyboard focus back to the main window     (isFocused before=false → true)
PASS - …and the renderer receives browser:shortcut {focus-address}
PASS - control token never appears in backend output, database, storage or logs
[e2e] PASS — 13/13 checks
```

**覆盖边界（如实）**：直接打后端 `/api/web-research/browser/*`，**不经 Next BFF**，故 BFF 的 `140000` ms 超时与 `executeWebTool` 适配仍只由 vitest 覆盖；无真实 LLM / Agent 回路。「真后端 ↔ 真 Electron」指**控制服务契约**，不指整条用户链路。正向「字节 → 入库（`source:'workspace'`）」未在 e2e 中走通（回环主机被出口硬规则拒绝，这一点本身被当作反例断言），由 `test_browser_workspace_resources` 覆盖。`isFocused()` 依赖运行机器的窗口前台状态；本次真机通过，在无前台桌面的环境可能不稳，属手动门，不进默认套件。契约一致性：本次联调**未发现**任何字段偏差，`control_client` 无需改动。

## I2-4 W4 提示词预算（实测）

`npx vitest run --environment node …`：无索引最坏 **18 576**；满索引最坏 **19 673**；满索引相对无索引净增 **1 097**；AC-B8 净增（`满索引 − L0_BASE 17 075 − 通用层 992`）**1 606**。各段（满索引）：规则 1 354 / 常驻工具 406 / 按需目录 2 337 / 核心工作流工具 9 444 / 项目状态 49 / 配方 222 / **可用技能 1 093** / 视频轨道时长 239 / 同轨不可重叠 3 155 / 常驻通用 1 137 / 计划 77 / 记忆 74。与评审实测一致（无 160 字符量取口径差）。

- **W4a 完成**：`systemPrompt.toolkit.test.ts` 第 96、305 行 `toHaveLength(18)→(19)`（`use_skill` 在提交 `b0d59ef8` 入列时漏同步）；除这两处外该文件**零改动**。**应单独提交**。
- **W4b 触发停止条件，未做**：把满索引压到 ≤18 500 需削减 ≥1 173 字符，而索引段最多只能收回约 330（降单行上限到 ~70），其余 **>800 字符**须删 L0 规则文本，超过 600 字符线。**没有改任何断言、没有删任何规则**；浏览器规则 132 / YOLO 变体 119 字符及安全/授权规则原样保留。AC-B8（净增 ≤400）与「索引段 ≤1 300」两条既有断言自身矛盾，**需单独立项**取舍。

## I2-5 行数表

| 文件 | 迭代 1 | 迭代 2 | 预算 / 说明 |
|---|---|---|---|
| `desktop/main/browserWorkspace/index.js` | 380 | **387** | W1 ≤8 行（实 +6），W2 +1；`desktop/main/index.js` 732 零改动 |
| `desktop/main/browserWorkspace/loginHeuristics.js` | — | 110 | ≤120 ✓ |
| `backend … browser_workspace/dispatch.py` | 192 | 192 | 零改动 |
| `src/app/page.tsx` | 210 | **212** | ≤215 ✓（监听在新 hook） |

## I2-6 AC-H 对照

| AC | 状态 | 证据 |
|---|---|---|
| H1 登录完成建议 | **通过（自动化 + 真 Electron）** | `loginHeuristics.test.js` 11 项（含跨域 SSO、连续 2 次、captcha 不启动、`stopAll` 无残留）、`ApprovalBanner` 测试、后端 `login:` 前缀契约、e2e 的 SSO 与 captcha 反例。仍需走查⑪ 的真实站点确认 |
| H2 `Ctrl+L`/`Ctrl+Alt+B` | **通过（自动化 + 真 Electron `isFocused()`）** | Context / Dock / `viewShortcuts` 测试 + e2e 焦点断言；真实打字落点留走查⑩ |
| H3 打开设置 | **通过** | `BrowserDock` 测试（仅 `disabled` 出现、派发 `item:'browser'`）、`useOpenSettingsEvent` 测试；`page.tsx` 212 行 |
| H4 提示词护栏 | **部分**：W4a 完成；W4b 按停止条件标「未执行」并登记（I2-4），**未改任何预算断言** | `git diff` 仅 2 行 `18→19` |
| H5 遮挡盲区 | **部分通过** | `KNOWN_UNMARKED` 5→0（3 个直接加标记，2 个结构性委托给已带 `role="dialog"` 的 `Modal`/`ConfirmationDialog`）；冻结帧提示条带 `data-native-inflow` 并有「不被当作遮挡物」回归；FAB 拖动结束吸附。**未做**：悬浮助手面板首次默认位置避让（spec 缺陷 7b），走查⑦ 人工确认 |
| H6 真联调 | **通过** | I2-3 |
| H7 打包态冒烟 | 见 I2-7 | |
| H8 回归 | **通过（基线对照）** | I2-2 |
| H9 走查表 | 见 I2-8，**每行均有结论** | |

## I2-6.1 基线登记（迭代 3 动手前存档）

迭代 3 的所有回归结论都以本节为对照物。四条命令在**改任何源码之前**执行，输出原样记录（spec §6.1.1）。

| 量 | 命令（cwd = 仓库根） | 基线值 |
|---|---|---|
| 悬浮助手目录 | `npx vitest run src/components/video/components/AgentChatDock` | **7 files / 76 tests passed** |
| 浏览器目录 | `npx vitest run src/components/browser src/contexts` | **10 files / 98 tests passed** |
| `BrowserViewport.tsx` 工作区状态 | `git status --short src/components/browser/BrowserViewport.tsx` | **` M`**（该文件在迭代 2 就已修改且未提交，故 `git diff` 为空**不成立**；改用下面的内容哈希判定「本迭代零改动」） |
| `BrowserViewport.tsx` 内容哈希 | `python -c "import hashlib,pathlib;print(hashlib.sha256(pathlib.Path('src/components/browser/BrowserViewport.tsx').read_bytes()).hexdigest())"` | `f8186ed76213ec643c72c6a89f76311a8542791e70020ffe9dd457d9dc0f91a1` |
| 基线提交 | `git rev-parse --short HEAD` | `4e1ad78f` |

## I2-7 打包态冒烟记录（E2）

新增门禁 `desktop/scripts/lib/assert-fresh-build.js`（四项检查，任一失败即非 0 退出），并挂为 `browser-workspace-smoke.js` 的**第一步**：不新鲜就直接中止，不再可能对旧包报「通过」。

### 先红（改 `build.js` 白名单之前，本机真实旧产物）

```bash
# cwd = desktop
node scripts/lib/assert-fresh-build.js
```

```
[assert-fresh-build] M:\takoAI\Ecliptrix\desktop\release\win-unpacked
  PASS - packaged-main-modules: 9 modules present in desktop\release\win-unpacked
  FAIL - packaged-renderer-fresh: renderer 2026-11-25T17:30:55.980Z vs newest src 2026-11-26T08:03:28.452Z
  FAIL - page-scripts-not-excluded: not declared in APP_PAYLOADS: main/browserWorkspace/loginHeuristics.js
  PASS - no-secret-in-bundle: 80 script entries, no token literal
[assert-fresh-build] FAIL
```

### 后绿（补齐 `BROWSER_WORKSPACE_MODULES` 的 `loginHeuristics`）

同一命令、同一产物（未重新出包，故 `packaged-renderer-fresh` 仍红——它**本该**红）：

```
  PASS - packaged-main-modules: 9 modules present in desktop\release\win-unpacked
  FAIL - packaged-renderer-fresh: renderer 2026-11-25T17:30:55.980Z vs newest src 2026-11-26T08:03:28.452Z
  PASS - page-scripts-not-excluded: 28 runtime modules declared, 0 test files
  PASS - no-secret-in-bundle: 80 script entries, no token literal
```

`page-scripts-not-excluded` 断言成立，说明白名单缺口是**真实的**：`loginHeuristics.js`（迭代 2 的 W1 产物、`test:browser` 里有专属套件）此前根本不在发布载荷清单里。

### 未执行：`build:dir` + 打包态冒烟

- `npm run build:dir`（cwd = desktop）：**未执行**，原因 = 本节点打包耗时远超单次工具调用上限，且 `release/win-unpacked` 是迭代 2 的旧产物。
- `node scripts/smoke-test.js` 的 `browserWorkspaceSmoke`：**未执行**，原因同上（它现在会先跑新鲜性门禁，而旧包必然卡在 `packaged-renderer-fresh`）。
- 结论：**打包态通过与否尚无证据**。按 spec §2.2 的规矩，这里只写「未执行 + 缺什么」，**不拿源码级测试替代**。

### 门禁自身的证据（不依赖出包）

`desktop/scripts/lib/assert-fresh-build.test.js` 7 例，全部在 `os.tmpdir()` 的临时树上跑，其中 3 例是「先红」构造：

| 构造 | 断言 |
|---|---|
| 缺 `loginHeuristics.js` 的包 | 检查 1 红并**点名该文件** |
| `page.js` mtime 回拨到 `src/` 之前 | 检查 2 红（过期包识别） |
| 载荷清单混入 `misc.test.js` | 检查 3 红（包体膨胀） |
| 归档里硬编码 32 字节令牌字面值 | 检查 4 红（I-2） |
| 无 `resources/app.asar` | 四项记 `no build output` 并退 1（不是抛异常） |

## I2-8 人工走查表（E3）

已执行 0 / 未执行 11 / 阻塞 0（N+M+K=11）

> 档位说明：`已执行:` 其后写现象与证据；`未执行:` 必须写**缺什么**；`阻塞:` 必须写阻塞它的缺陷 ID。
> 本机无桌面安装包、无真实站点账号，故全部记为 `未执行` —— 按 AC-R3-6，**`已执行` 为 0 时本表只能算「格式合规、无实机证据」，不得计为「走查通过」**。

| 步骤 | 预期 | 实测 | 日期 | 执行人 |
|---|---|---|---|---|
| ① | 首次启用浏览器时弹出授权披露，未授权前不产生任何真实页面访问 | 未执行: 缺桌面安装包（`build:dir` 未产出）与一次全新 `profiles.json` | 2026-11-26 | node#2 |
| ② | 在 Dock 内登录某站点后，登录态写入 `persist:wb-<profile>` 分区 | 未执行: 缺真实站点账号（需可登录的第三方站点） | 2026-11-26 | node#2 |
| ③ | 重启应用后同一 profile 仍处于登录态，无需重登 | 未执行: 缺桌面安装包，无法跨进程重启验证 | 2026-11-26 | node#2 |
| ④ | 让 Agent 搜新闻 → 读正文 → 取图写入素材库，`source` 为 `workspace` | 未执行: 缺真实 LLM 凭据与公网站点；自动化侧只有回环夹具 | 2026-11-26 | node#2 |
| ⑤ | 用户接管后 Agent 命令被拒（`user_in_control`），交还后恢复 | 未执行: 缺真机前台窗口，`isFocused()` 无法在无桌面环境稳定复现 | 2026-11-26 | node#2 |
| ⑥ | 风险动作（提交表单等）先弹确认，拒绝后不执行 | 未执行: 缺桌面安装包，确认弹层与原生视图层级需真机观察 | 2026-11-26 | node#2 |
| ⑦ | 面板/弹层压住视口时显示冻结帧与「已被浮层遮挡 · 实时画面暂停」提示条 | 未执行: 缺桌面安装包；自动化已有覆盖（`portalOccluders.test.ts` 棘轮 + `BrowserDock` 冻结帧用例），但真机观感未验 | 2026-11-26 | node#2 |
| ⑧ | 最小化窗口后 Agent 命令继续执行（视图 1px 停靠，不 0×0） | 未执行: 缺桌面安装包，最小化行为无真机 | 2026-11-26 | node#2 |
| ⑨ | 身份闸门锁定时命令返回 423，解锁后恢复且审批不残留 | 未执行: 缺桌面安装包与账号登录态 | 2026-11-26 | node#2 |
| ⑩ | 焦点在页面内时 `Ctrl+L` 把键盘焦点交还主窗口地址栏 | 未执行: 缺桌面安装包；自动化已有 e2e 焦点断言（13/13），真实打字落点未验 | 2026-11-26 | node#2 |
| ⑪ | 真实站点登录完成后弹出「登录完成」建议，验证码流程不误报 | 未执行: 缺真实站点账号与桌面安装包 | 2026-11-26 | node#2 |


## I3 · 页面真实图片链路（`agent-browser-image-ingest`）

> 日期 2026-11-26，起点 HEAD `abe65563`。本轮只做「页面图片候选 → 带会话凭据取回 →
> 真实字节入库 → 可被时间线使用」这一条链路；未 `git commit`。
> 本节只写**本机已实际跑过**的命令与结果。

### 实测命令与输出

| 范围 | 命令 | 结果 |
|---|---|---|
| 后端·新增 | `pytest tests/test_browser_workspace_images.py -q` | **18 passed**（候选归一化 / 保存入库 / 8 条错误码 / provenance / 裁剪收敛 / 超时链 / 沙盒拒保存 / **复审新增 2 例**：挂载后重裁、读预算） |
| 后端·相邻回归 | `pytest tests -k "browser or workspace or web_image or web_research or line_budget" --ignore=data -q` | **314 passed, 1 skipped**（含 `web_image_service` 零回归，AC-I21） |
| 后端·行数棘轮 | `pytest tests/test_line_budgets_bw.py -q` | 全绿：`service.py` 347/350、`dispatch.py` 200/200、`images.py` 114（新文件无预算项） |
| 前端·提示词 | `vitest run systemPrompt.toolkit / subtitleDisclosure / promptBudgetRatchet / browserWorkspace.surface` | **4 文件 59 项全绿** |
| 前端·工具 | `vitest run tools/__tests__/browserSaveImage.test.ts` | **13 passed**（schema 闭集 / 恰好一次 `add_materials` / 60 000 ms / YOLO 仍注册 / **复审新增 3 例**：body 不含 `session_id`、可选字段缺省不发、带图读 25 000 ms） |
| 前端·BFF 白名单 | `vitest run src/app/api/web-research/__tests__/route.test.ts` | **6 passed**（`save-image` 可达；畸形路径仍 404） |
| 前端·渲染层回归 | `vitest run src/components/browser src/contexts` | **10 文件 98 项全绿** |
| 主进程回归 | `cd desktop; npm run test:browser` | **PASS，12 套 110 项**（pageScripts 9、integration 15、assertFreshBuild 7、checkWalkthroughTable 7 等） |
| 类型 | `npx tsc --noEmit -p tsconfig.json` | **17 个错误，与改前完全一致，无一落在本次触碰文件**（全部来自 `docs/diagnoses/**/repro` 引用 `webserver/` 服务端路径与 `SkillRouterSettingsPanel.test.tsx` 的既有问题） |

### AC 对照

| AC | 状态 | 证据 |
|---|---|---|
| AC-I1 候选链路 | 通过 | `-k candidates`：`image_id` 形如 `i1`、含 `og:image`、逐项补 `page_url`/`snapshot_version` |
| AC-I2 保存成功 | 通过 | 同源 `cached_materials` 本地 URL，`width/height` 由真实图片读出（64×48 夹具） |
| AC-I3 内联图拒绝 | 通过 | `data:`/`blob:` → `400 inline_image_unsupported`（**刻意拒绝，非能力缺失**） |
| AC-I4 两层各自可验证 | 通过 | 前端 `pattern` 拒 `http://…`、`i0`/`i100`/`e1`；后端未登记 id → `404 image_not_found` |
| AC-I5 双表登记 | 通过 | `set(STATUS) - set(FAILURE_CLASS_BY_CODE) == []`；`browser_budget_exceeded` 为 **413**、`browser_busy` 为 429 |
| AC-I6 非图片 | 通过 | HTML 错误页 → `422 resource_not_image` |
| AC-I7 超限 | 通过 | 10 MiB + 32 字节 → `422 resource_too_large` |
| AC-I8 provenance | 通过 | `source:'workspace'` / `via:'workspace_tab'` / `tab_id` / `source_page_url` / `sha256`；`material.metadata.source` 仍为 `'web'` |
| AC-I9 恰好发布一次 | 通过 | `recordOperation` 调用 1 次，`cacheStatus:'ready'` 与 `storageKind:'cached_remote'` 由 `localMaterial()` 填 |
| AC-I10 YOLO 仍注册 | 通过 | `browser_save_image` 在 YOLO 工具集内，`browser_request_user` 被移除 |
| AC-I11 快照新鲜度 | 通过 | 页面 URL 变化与新 `snapshot_version` 各自 → `409 stale_snapshot`；`read → act → save` 仍可用 |
| AC-I12 提示词自洽 | 通过 | 上述 4 个提示词套件全绿；L1 实测 **1 059 字节**（上限 1 200，改前 1 082，**净减 23**） |
| AC-I13 描述上限 | 通过 | `browser_save_image` description **118 字节** ≤120；L1 ≤1 200 |
| AC-I14 主进程页面脚本 | 通过 | `pageScripts` 套件 9 项（`collectImages` 的 `inline` 与 `og:image` 既有用例覆盖） |
| AC-I15 无回归 | 通过 | 见上表三处回归命令 |
| AC-I16 类型/lint | 通过 | 17 个错误与改前逐条一致，触碰文件 0 错误（未写死数字，按 spec P2-3 比对） |
| AC-I17 打包新鲜性门禁 | 通过（脚本自身） | `assertFreshBuild` 7 项全绿；**真打包未执行**，见下方未验证项 |
| AC-I18 走查表格式 | 通过（I2-8 由脚本校验，I3 表按同档位规矩人工记档） | `node desktop/scripts/check-walkthrough-table.js` PASS；该脚本契约是 I2-8 的 ①–⑪，本轮未改脚本，故 I3 的 12 条表不由它校验 |
| AC-I19 裁剪收敛 | 通过 | 41 条候选 × 长正文 × 120 元素 → 函数返回且总字节 ≤11 500、图片 ≤6 000；三类皆空时 `break` |
| AC-I20 超时链一致 | 通过 | 保存三处：60 000 ms / 55 s（`driver.FETCH_TIMEOUT_S`）/ 55 000 ms（`resourceFetch.js`）；读链路两处：带图读 25 000 ms（前端）与 `READ_IMAGES_TIMEOUT_S=25`（路由），普通读仍是 15 000 / 10。单测逐处断言 |
| AC-I21 `web_image_service` 零回归 | 通过 | 候选**只增字段不改名**，`width`/`height` 保留，`web_image` 用例全绿 |
| AC-I22 BFF 白名单可达 | 通过 | `ROUTES.POST` 加 `browser/<uuid>/save-image`；未登记与畸形路径仍 404 且不打后端 |

### 复审修复的三处接缝级缺陷（spec D-7 / D-8 / D-9）

共同点：**两侧各自的单测都绿，真实链路必炸**——因为没人测接缝。首版的「全绿」正是这么来的。

| ID | 症状（实测） | 修复 | 回归用例 |
|---|---|---|---|
| **D-7** | 前端 `body: params` 把 `session_id` 塞进 body，后端 `BrowserSaveImageRequest` 是 `extra="forbid"` → **必然 422 `extra_forbidden`**，保存端点一次都不会成功 | 新增 `saveImageBody()`，只发 `image_id`/`name`/`snapshot_version`，session 只走路径 | `browserSaveImage.test.ts` 两条：body 不含 `session_id`；可选字段缺省时不出现 |
| **D-8** | 候选在 `_finish_snapshot` 的 `fit_result` **之后**才挂载，首版没有再裁 → 100 条候选实测 **35 557 字节**，是 11 500 上限的三倍（沙盒分支同病，且它只裁增量） | `images.attach()` 挂载后补裁一次；沙盒走 `attach_isolated()` 在合并后统一裁；`fit_result` 真正落地独立图片预算 | `test_read_with_many_images_stays_within_max_result_bytes`：总字节 ≤ 11 500、`truncated` 为真、登记表仍是完整闭集 |
| **D-9** | `read(images:true)` 串行跑两条主进程命令（各 10 s），而路由动作预算写死 10 s、前端 15 000 ms → 最坏情形被自己的链掐成 `upstream_timeout` | 新增 `READ_IMAGES_TIMEOUT_S = 25` 与 `BROWSER_READ_IMAGES_TIMEOUT_MS = 25_000`，不带 images 的两条链路数值不变 | 后端 `test_read_images_budget_exceeds_snapshot_chain`；前端「带图读比普通读更宽」 |

### 本轮未执行项（如实记档，不用源码测试冒充）

- **`npm run build:dir` + 打包态冒烟**：**未执行**，缺 = 单次工具调用上限内无法完成整包构建，且 `release/win-unpacked` 仍是旧产物。
- 结论：**打包态通过与否仍无证据**；`assertFreshBuild` 只证明门禁脚本自身正确。

### I3 人工走查表（图片链路，12 条）

已执行 1 / 未执行 11 / 阻塞 0

> 档位规矩与 I2-8 相同：`未执行:` 必须写缺什么；`阻塞:` 必须写缺陷 ID。
> 其中 ⑫ 为**本机可执行**的一项：用仓库内回环夹具（不依赖公网与登录态）跑通了
> 「候选 → 带 Cookie 取字节 → 入库 → provenance」全链路，故记为 `已执行`。

| 步骤 | 预期 | 实测 | 日期 | 执行人 |
|---|---|---|---|---|
| ① | `browser_read {images:true}` 返回带 `image_id` 的候选，含 `og:image` 与大背景图 | 未执行: 缺桌面安装包（`build:dir` 未产出），无法在真实 Electron 窗口内取候选 | 2026-11-26 | node#3 |
| ② | `browser_save_image {image_id}` 把该图取回并落到 `cached_materials` | 未执行: 缺真实站点账号，防盗链/登录态站点无法复现 | 2026-11-26 | node#3 |
| ③ | 素材库即时出现该图，缩略图为本地文件而非远端 URL | 未执行: 缺真机 UI，`add_materials` 的 SSE 反馈需前台观察 | 2026-11-26 | node#3 |
| ④ | 拖进时间线可正常预览播放（非黑帧、`size` 不为 0） | 未执行: 缺真机预览播放器与桌面安装包 | 2026-11-26 | node#3 |
| ⑤ | 模型传裸 URL 给 `browser_save_image` 被 schema 拒绝，不产生任何请求 | 未执行: 缺真实 LLM 凭据，无法观察模型侧行为（自动化已覆盖 schema 层） | 2026-11-26 | node#3 |
| ⑥ | 候选为 `data:`/`blob:` 时回 `inline_image_unsupported` 并提示换图 | 未执行: 需真实页面构造内联图候选 | 2026-11-26 | node#3 |
| ⑦ | 保存前页面自行跳转 → `409 stale_snapshot` 并提示重新 `browser_read` | 未执行: 需真实站点自动跳转场景 | 2026-11-26 | node#3 |
| ⑧ | 沙盒模式（`mode:"isolated"`）能列候选但保存明确回「不支持」 | 未执行: 缺真机沙盒窗口 | 2026-11-26 | node#3 |
| ⑨ | 10 MiB 级大图在慢网下不被 30 s 掐断（三处 55 s 生效） | 未执行: 需限速网络环境与真实大图 | 2026-11-26 | node#3 |
| ⑩ | 素材入库后不受工作台 artifact 的 1 天留存影响 | 未执行: 需真机跨日观察留存清理 | 2026-11-26 | node#3 |
| ⑪ | 模型对浏览器图片不再误用 `add_material_to_library`（返回 `hint` 导流） | 未执行: 缺真实 LLM 凭据，导流效果须看模型实际选择 | 2026-11-26 | node#3 |
| ⑫ | 回环夹具下：候选 → 取字节 → 入库 → provenance 全链路成立，且 `image_id` 闭集生效 | 已执行: `pytest tests/test_browser_workspace_images.py -q` 16/16 通过（`save_ok`/`error_codes`/`provenance`/`snapshot_stale`） | 2026-11-26 | node#3 |
