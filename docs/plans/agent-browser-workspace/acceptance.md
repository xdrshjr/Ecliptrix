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
