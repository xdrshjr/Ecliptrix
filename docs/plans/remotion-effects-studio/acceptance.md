# Remotion 特效工作台实施验收

环境：Windows 11（10.0.26200），Node 22.18.0，Electron 33.4.11，
React / ReactDOM 19.1.1，Remotion 4.0.544。日期：2026-11-17。

已完成 §10 源码、资源、测试和开发文档落地，分支为
`feat/remotion-effects-studio`；实现节点按约束未提交，最终审查与修复证据见
`final-review.md`。下表区分实际通过的
检查和仍需发行环境补验的内容；“部分验证”不表示完整 AC 通过。

## 已执行命令与证据

| 编号 | 命令 / 范围 | 实际结果 |
|---|---|---|
| E1 | `npm run type-check`；`npm run build` | 基线及实现后类型检查通过；Next 15 生产构建通过，90 个静态页面生成完成。构建沿用原配置跳过 lint，不据此宣称 lint 通过 |
| E2 | `npm test -- src/lib/effects src/components/video/effects` 加计划中的 planner / persistence / MaterialCard / Toolbar / BFF / storeSync，以及 camera golden vectors、materialDeleteHelpers、materialKey、history.syncCapture、historyCompanion、history.noopEntry；`--maxWorkers=4` | 18 文件、74 项通过。含 500ms 保存、保存期间编辑、409 后阻止覆盖、未保存关闭、提交中重复生成、3.37s 替换、新身份及保存 / 水合 |
| E3 | Agent 完整测试目录加 receipt route、useAgentExecution effects/ordering、provenance/effectsTimeline，`--maxWorkers=4` | 90 文件、794 项通过、0 跳过。先前高并发一次动态 import 超时，限并发后完整重跑通过；未改动该普通工具逻辑 |
| E4 | basic-service cwd：`python -m pytest tests/test_effects_contract.py tests/test_effects_jobs.py tests/test_effects_assets.py tests/test_effects_lifecycle.py -q --disable-warnings` | 22 通过、1 个真实 runtime 测试默认跳过。覆盖 SQLite 幂等、配额、CAS、取消、删项目、输入 staging、HTTP/ETag；新增最近优先 keyset 游标及取消与领取竞争回归 |
| E5 | 设置 `ECLIPTRIX_EFFECTS_RUNTIME_TEST=1` 后 `python -m pytest tests/test_effects_lifecycle.py -k real_worker -q` | 真实 Electron / Remotion / SQLite 发布、ffprobe、faststart、缩略图、完整文件恢复和 frames 取消通过；最新报告见 `desktop/build/effects/backend-smoke/537caa82-c792-4ad2-9a03-e55c1b05eb65/report.json` |
| E6 | `npm run effects:prepare`；`npm --prefix effects-runtime run build` | 两者实际成功。安装生产依赖后封存 manifest，24 模板、字体、native、浏览器及 runtime 依赖均校验；浏览器 Chrome Headless Shell 158.0.8127.2 |
| E7 | 设置 `EFFECTS_REAL_RUNTIME_TEST=1` 后 `npm --prefix effects-runtime test` | 3 项全部通过、0 跳过。实际 payload 的 controller 鉴权、单 renderer、重放、reset、强杀；中文空格工作路径五秒带文字 / 图 / 视频出片、取消、IPC 断开。controller 约 24.8s，render/cancel/disconnect 约 29.2s（含测试开销） |
| E8 | `node desktop/scripts/effects-smoke.js` | 协议错误、Range / HEAD / 416、capability 与伪造 Host 拒绝通过。`node --test desktop/main/effectsService.test.js desktop/main/processManager.spawn-error.test.js desktop/main/backendService.test.js`：5 项通过 |
| E9 | `node effects-runtime/scripts/generate-previews.mjs`；逐个 ffprobe 检查 | 24 模板全部真实渲染，48 个非空 jpg/mp4；视频均为 60 帧、30fps。报告 `desktop/build/effects/preview-report.json`，已查看联系表 `desktop/build/effects/smoke/template-contact-sheet.jpg`；正式预览在 `public/effects/previews/` |
| E10 | 隔离 backend 18780 / Next 18730 / runtime 18723，ego-browser TaskSpace 5 | 中文标题和副标题→自动保存→实际生成 5s/1080p→成品入库→新轨插入→Ctrl+Z / Ctrl+Shift+Z→刷新恢复成功；素材始终 1 条，片段恢复 1 条。时间线工具栏入口也实际打开成功；800px 窗口编辑 / 预览可达，文字溢出修正后 Player 恢复 |
| E11 | 全仓 `npm run lint`；新增 effects 范围 ESLint | 全仓退出 1，既有 `scriptSegmentAssociation.test.tsx` 等 `react/no-children-prop` 错误仍在。独立检查 43 个新增 effects 相关前端文件：0 错误、14 警告（图片优化、hook 依赖及未使用导入）；Agent 新文件也为 0 错误 |
| E12 | `npm run scan:secrets`；`git diff --check` | 2,943 个已跟踪文件凭据扫描通过；新增文件未暂存，不能把此扫描表述为覆盖全部新增文件。diff 空白检查通过；本节点未输出配置密钥 |

E2 精确文件清单：`src/lib/effects`、`src/components/video/effects`、
`src/components/video/timeline/store/actions/__tests__/applyEffects.test.ts`、
`src/components/video/projects/__tests__/effectsPersistence.integration.test.tsx`、
`src/components/video/components/MaterialsPanel/__tests__/MaterialCard.test.tsx`、
`src/components/video/timeline/__tests__/TimelineToolbar.comingSoon.test.ts`、
`src/app/api/effects/__tests__/route.test.ts`、
`src/components/video/hooks/__tests__/useMaterialManagement.storeSync.test.tsx`、
`src/components/video/playback/camera/__tests__/goldenVectors.test.ts`、
`src/components/video/hooks/__tests__/materialDeleteHelpers.test.ts`、
`src/components/video/lib/__tests__/materialKey.test.ts`、
`src/components/video/timeline/__tests__/history.syncCapture.test.ts`、
`src/components/video/timeline/store/__tests__/historyCompanion.test.ts`、
`src/components/video/timeline/store/slices/__tests__/history.noopEntry.test.ts`。

截图为忽略的本地证据：`.web-debugger/effects/studio-final-wide.png`、
`studio-narrow-edit.png`、`studio-narrow-preview.png`、`studio-generated.png`、
`timeline-applied.png`。测试使用独立 SQLite / 存储目录，未触碰已有 8000
后端的用户工程；浏览器 taskSpace 已 finish，测试 harness 已 drain / 关闭。
开发模式原有身份门禁提示遮挡顶部按钮时采用键盘撤销，未改动身份配置。

## 34 项验收状态

| 验收项 | 结果与实际证据 | 尚未执行的范围 |
|---|---|---|
| AC-01 | 通过：E2 目录 12/24/每库2；E9 每个模板全 60 帧实际出片和海报 | — |
| AC-02 | 部分验证：E7/E9 文字、图、视频、多图和各变体均真实出片；联系表已检查 | 三种画布全部模板的完整视觉矩阵 |
| AC-03 | 部分验证：E2/E4 Unicode / 超限契约；E10 中文和换行溢出恢复 | emoji / 组合字符等全部边界的实帧矩阵 |
| AC-04 | 通过：E2/E4 TS/Python 严格结构、kind、帧数、数值和范围边界 | — |
| AC-05 | 未执行严格验收；Player 与 renderer 已共用 compositions、字体和参数 | 双 PNG 字节比较、MP4/Player 五点像素 MAE 及带脉冲源的一帧同步容差 |
| AC-06 | 部分验证：四入口已接线；E2 素材菜单 / toolbar，E10 主入口 / toolbar | 右键、封面、多选和音画分离的完整桌面交互矩阵 |
| AC-07 | 部分验证：复用 Modal，E10 Esc、宽屏和 800px 操作可达 | 1100/900 断点两侧、焦点圈定 / 归还及 Windows 系统缩放全矩阵 |
| AC-08 | 部分验证：E2 保存、CAS、输入串行、关闭提示、生成等待及重复提交回归 | 保存 500 故障和局部历史全部人工路径 |
| AC-09 | 通过：E4 真实 SQLite 相同 requestId / 异体冲突 / 并发唯一及重放顺序 | — |
| AC-10 | 通过：E4 跨项目 20/21 与项目 5/6 配额；E7 单实际 renderer；取消领取竞争回归 | — |
| AC-11 | 部分验证：E7 输出 H.264/yuv420p/640×360/30fps/150帧/AAC；E5 probe/faststart/缩略图/发布 | 所有坏输出探测失败分支的故障注入 |
| AC-12 | 部分验证：E4 queued、E5/E7 frames 实际取消及独立终态 | 校验 / 最终发布瞬间的确定性取消交错 |
| AC-13 | 部分验证：E5 正式文件存在而 DB 回退后的恢复同一 asset/hash；E4 不完整任务 interrupted | 精确 rename→commit 窗口的真实杀进程注入 |
| AC-14 | 部分验证：E2 最新目标、store 锁 / 手势 / 项目检查和过期轮询；E3 过期租约不执行 | 生成过程中全部移动 / 删除 / 锁轨人工矩阵 |
| AC-15 | 部分验证：E2 trimStart=2、D=3.37，保留位置、时长、外层音量/透明度/转场/segment | camera / gain / transition 各一次的预览和最终导出实帧对照 |
| AC-16 | 部分验证：E7 AAC 真实输出；E5 无底视频出片；E2 保留 audioDetached | 脉冲音轨同步及分离轨道桌面听测 |
| AC-17 | 通过：E2 真实 aggregate 一次 history 与 undo/redo；E3 单工具 / 整轮撤销；E10 键盘往返 | — |
| AC-18 | 部分验证：E2 新素材 / clip 本地 URL 身份与删除 helper；effects namespace GC 明确保留 | 所有物理源 hash / redo 文件保留的端到端删除场景 |
| AC-19 | 部分验证：E2 项目 JSON 保存 / 水合；E10 实际刷新后素材和片段恢复可播放 | worker 缺失、草稿软删 / 未知旧版时的最终 FFmpeg 导出矩阵 |
| AC-20 | 通过：E3 首次只披露摘要，探索下一响应授权、分页/详情、schema 与 prompt 预算 | — |
| AC-21 | 部分验证：E3 真 Hook/事件/票据/store 链，queued、unknown、Stop 和回放守卫 | 使用真实 LLM 的 Electron create→render→apply 人工路径 |
| AC-22 | 部分验证：E4 真实本地复制、项目归属与远程拒绝；E7/E8 媒体 capability、鉴权、穿越与 Host | symlink、伪后缀及超大图所有组合的注入矩阵 |
| AC-23 | 部分验证：能力失败降级、资源 manifest 检查、controller 崩溃接线已实现 | 磁盘满及 browser/native/font 缺失全部桌面故障注入 |
| AC-24 | 未执行 Windows installer 离线验收；E6/E7 只证明真实 payload 能离线渲染和中文空格工作路径 | 完整 installer 安装、只读目录、断网制作 / 上轨 / 最终 FFmpeg 导出 |
| AC-25 | 部分验证：E7 taskkill 精确 controller PID 和 IPC disconnect，验证实际后代均退出 | 真实主窗口关闭 / main 强杀及重启后全部进程场景 |
| AC-26 | 通过：E4 项目 closing、事务回滚、删行和 commit 后清理；不占锁等待取消 | — |
| AC-27 | 通过：E4 改稿 / 软删 / runtime 不可用 / 配额之后原键重放，异体拒绝、并发唯一 | — |
| AC-28 | 通过：E2/E3 不可变 provenance、源 hash / trim / 时长 / 比例匹配和原位 noop；A 回执→B 旧片段替换回归 | — |
| AC-29 | 通过：E3 普通→effects→普通的真实 useAgentExecution/store、owner/ref 同步、单工具和整轮撤销、队列过期 | — |
| AC-30 | 通过：E2/E4 未完成草稿可保存，缺必填不得入队，未知字段 / kind / 越界仍拒绝 | — |
| AC-31 | 部分验证：E5 reset / 重连恢复、E7 父进程心跳 / cancel / force-kill；桌面独立监管 | 缺 runtime→安装就绪重试、版本变化及真实 main drain 的完整实包矩阵 |
| AC-32 | 部分验证：E4 staging 期间删项目不发布、closing 阻写、rollback 不删文件且可恢复写入 | 草稿保存和 recovery 扫描的全部精确并发插入点 |
| AC-33 | 部分验证：E2 BFF 合同 304 / ETag / Retry-After / HTML 统一错误 / 私有路由拒绝；E4 真 FastAPI 合同 | 非 mock 的同次 BFF→FastAPI 完整自动化链 |
| AC-34 | 部分验证：E2/E4 kind、当前模板 params、已知软删只读 / 未知版本拒绝，旧输出独立可播放 | 文档全部 JSON 示例替 UUID 的专门向量和旧版菜单人工矩阵 |

## 发行前仍需补验

本节点的实现交付不等同发行批准。`npm --prefix desktop run build:dir`、
完整 installer 安装和 `node desktop/scripts/smoke-test.js` 本轮未执行；
`effects-smoke.js --unpacked <win-unpacked目录>` 已实现真实路径选择和使用
包内 Electron / FFmpeg，执行时产物写开发证据目录，不写只读安装目录。
不能用本轮 `--packaged`（build payload）代替安装包漏件 / 路径验收。
严格逐帧一致性、实机内存 / 打字延迟 / 30s1080p 性能、最终时间线导出和
真实 LLM 桌面路径按上述未执行行补齐。Remotion 分发许可仍由负责人确认。

完整 manifest 当前约 715MB；实测校验约 8s、controller 独立就绪约 9s，
不是小体积渲染器。测试清理只处理自身持有 PID，不按浏览器进程名清理。
规格修正和评审中发现问题的处理见 spec.md 文末 IM-01–IM-07。

任务调度器：history / goal / get / put / progress / wait_async 在请求前
因缺少 `TASK_SERVER_URL` 退出。定位使用本次任务前序输出和任务板中
明确的 `docs/plans/remotion-effects-studio/spec.md`，不宣称已写入黑板。

## 补充最终复核

对功能提交 `5e663714` 再次核查后，修复了恢复读取旧任务状态、损坏
manifest 阻断启动、极大 PNG 的 500、输入回包乱序、项目比例默认值，
以及真实 IPC 断管道导致过早释放渲染槽的问题。详情和先失败后通过的
证据见 `final-review.md` 的 CR-07–CR-12；规格补充于 IM-09。

本次重新执行：前端/Agent 116 文件 1,124 项通过，模态/输入选择器
补充边界专项 22 项通过；后端 46 项通过、1 项真实 worker 默认跳过，
另单独开启真实 worker 后 1 项通过；runtime 重建后 5 项全部通过，
桌面服务 5 项通过。根项目类型检查、生产构建和修改文件专项 lint 通过。
第一次高并发真实测试出现启动超时与 EPIPE；后者已复现修复，完整真实
测试单独重跑通过。未据此宣称重负载启动性能通过。原 34 项中的未验
范围及安装包、精确像素/音频同步、最终导出和真实 LLM 门禁维持原状态。

## 第二轮工程验证（2026-11-17，Subtask #2）

本节对应 `spec.md` 第二轮评审 v2 的 §17，基线 `58dce2a7`。
上文首轮记录保持历史含义，不能用于证明本轮安装包或发行门禁。
本节点保留现有 12 库 / 24 模板，完成恢复、轮询、键盘、字体重试、
停止原因与验收工具增量；不执行 Git 提交，正式包须由下一节点提交后
按 §18.5 重建重验。实现过程修正见 spec.md 的 IM-R2 记录。

### 本轮已执行的工程检查

| 编号 | 命令与范围 | 实际结果 / 证据边界 |
|---|---|---|
| R2-E1 | `npm run effects:prepare` | 成功；重建共享组合、runtime、字体与生产依赖闭包，manifest 全量 hash 校验通过；Remotion 4.0.544、React 19.1.1 不变 |
| R2-E2 | `npm run build`；构建结束后 `npm run type-check` | 生产构建、90 页静态生成及类型检查通过；后续审查返修再执行构建，不以旧包替代最新源码 |
| R2-E3 | `node node_modules/vitest/vitest.mjs run`，范围为 `src/lib/effects`、`src/components/video/effects`、完整 `src/lib/video-editing-agent/__tests__`、effects BFF / receipt、Agent effects/ordering hook、applyEffects、effectsPersistence、项目删除、素材卡与工具栏；`--maxWorkers=4 --testTimeout=15000 --reporter=json --outputFile=desktop/build/effects/round2-vitest-final.json` | **104 文件、879 项通过，0 失败、0 跳过**。覆盖完整历史草稿屏障、失败退出内存留存、连续失败版本、另一编辑器 CAS、复制拒绝及一轮撤销 |
| R2-E4 | basic-service：`python -B -m pytest tests/test_effects_contract.py tests/test_effects_draft_replay.py tests/test_effects_jobs.py tests/test_effects_assets.py tests/test_effects_lifecycle.py tests/test_effects_paths.py tests/test_effects_runtime_client.py -q --disable-warnings --basetemp M:/takoAI/Ecliptrix/.pytest-workspace-import/round2-root-final` | **54 通过，1 个真实 worker 默认跳过**，30.05s；真实 SQLite / PK 并发、UUID 字符串、精确一次重放、异体 / 软删 / 跨项目、已有发布与删项目契约均覆盖；跳过项不算通过 |
| R2-E5 | 修改范围 ESLint，`ESLINT_USE_FLAT_CONFIG=false` | 无错误；工作台生命周期 ref 清理有 4 项 hook 提示，均为有意撤销当前代次的 ref，非 DOM ref。未据此声称全仓 lint 零告警 |
| R2-E6 | `git diff --check`、§17 计划文件逐项核对 | 空白检查通过；52 个计划路径均存在并有相关修改，前序定位 / 设计核查文件保留原版本；额外生命周期测试断言变更已在 IM-R2-01 明确说明 |
| R2-E7 | 设置 `ECLIPTRIX_EFFECTS_RUNTIME_TEST=1`，basic-service 执行 `python -B -m pytest tests/test_effects_lifecycle.py -k real_worker -q --disable-warnings --basetemp M:/takoAI/Ecliptrix/.pytest-workspace-import/round2-real-worker-final` | **1 通过**，30.29s；实际 Electron / Remotion / SQLite 发布、probe、重启恢复与取消，未用 mock 替代 |
| R2-E8 | 同时设置 `EFFECTS_REAL_RUNTIME_TEST=1` 与 `EFFECTS_MANIFEST_STARTUP_TEST=1`，`npm --prefix effects-runtime test` | **26 项通过，0 失败、0 跳过**，38.12s。含真实五秒带文字 / 图片 / 视频 / 音轨出片、取消 / IPC、全量 12,082 文件 Electron 校验、流式并发 / 关闭和停止门；本次全量校验 4.220s，controller smoke 7.558s |
| R2-E9 | 改动源码及新增文件使用现有 `scripts/scan-secrets.py` 的脱敏检测规则扫描 | **54 个改动文件、0 finding**，明确包含未跟踪的新实现 / 测试，未扫描既存测试临时目录或输出用户配置 |
| R2-E10 | `node node_modules/vitest/vitest.mjs run src/components/video/effects/__tests__/EffectsStudioModal.test.tsx --maxWorkers=1 --reporter=json --outputFile=desktop/build/effects/round2-studio-final.json` | 末次恢复交付守卫返修后 **32 项通过、0 失败 / 跳过**。新增先红后绿的断言：旧项目的失败退出恢复 GET 迟到，不得续写新项目 working；其余 31 项全部重跑通过 |
| R2-E11 | `node --test` 执行 `desktop/scripts/effects-smoke.test.js`、`desktop/scripts/lib/effects-release-evidence.test.js`、`desktop/main/effectsService.test.js`、`desktop/main/backendService.test.js`、`desktop/main/processManager.spawn-error.test.js`，JUnit 为 `desktop/build/effects/round2-desktop-verified.xml` | **31 项通过、0 失败 / 跳过**；覆盖真实子进程依赖边界、两进程独占封存、56 AC 分配、假媒体 / 假汇总拒绝、fixture 隔离，以及真实 Chromium 的 Response→disable→Request 恢复。新测试初始页未提交的竞态已确定性复现并修正，未放宽 CORS；原失败 JUnit `round2-desktop-final.xml` 保留 |
| R2-E12 | 新 payload 串行真实 `effects-smoke.js --controller --packaged` 与 `--render --packaged`，每次唯一报告路径 | 两者均通过，mode 为 **development**。最终 controller 见 `desktop/build/effects/evidence/94036f2e-fb46-4ae0-956a-9e860a09263b/smoke-report.json`，13 条所属 PID / 创建时间核验、强杀后 1368ms 无匹配残留；renderer 见 `26ace1d5-6b71-446c-9ae1-4c6b0be84554/smoke-report.json`，真实五秒带图视频、AAC、取消 3130ms、IPC 退出 2960ms，均在固定 12s 所属进程退出预算内；不能冒充 installed |

默认 5 秒测试预算的首批完整回归为 869 通过 / 4 失败，均在
`toolkitTools.test.ts` 的冷动态 import 或其初始化尚未完成的后续用例。
诊断记录为 `desktop/build/effects/round2-cold-import-diagnostic.json`：
15 秒驱动预算下这两份文件 31/31 通过，首项 import 实测约 5.9 秒。
随后默认预算单独重跑仍为 31/31 通过，首项约 4.3 秒，记录
`round2-warm-import-default.json`。最终 879 项使用明确的 15 秒测试驱动
预算，没有修改产品超时、测试断言或删除默认预算失败记录。

独立交叉复核已修正新增工具的场景 fixture 碰撞、错误依赖不存在的
undo 工具、AC-46 / 54 / 37 等归属、Response 拦截结束后的 Request
恢复，以及故障脚本与生产 UI 的接口。真实客户端撤销复用
`undoAllOperations`；没有为测试新增生产桥接或 Agent 工具。后续增加
的 close-keyboard、font-retry、editor-lease 具有真实 CDP 执行及固定
proof 校验，但本轮没有本次 installed 树，不能把这些实现或合同测试
表述为已经通过真实安装矩阵。性能作为六场景中的独立门禁，不能冒领
AC-46 的真实 LLM 证据；AC-38 / 51 绑定实际轮询故障回归测试名。

### AC-35–56 当前状态

“自动行为通过”只表示对应源码契约及回归通过；需要真实桌面 / 安装环境
的条目仍单独列出，不能据此派生 `release_ready=true`。

| 验收 | 本轮证据与当前边界 |
|---|---|
| AC-35 | 自动行为通过：先持久化再提交、丢回包后刷新原键查询 / 同体重放、存储失败不 POST、跨项目不领取 |
| AC-36 | 自动行为通过：本地拒绝写 / 配额 / 坏记录不 POST，内存输入保留可重试，同项目未确认提交不换键，其它项目隔离；退出写失败和顺序接管冲突亦保留输入 |
| AC-37 | 自动行为通过：真实 HTTP / SQLite create 重放与 PUT expected+1 精确例外、name/hash/项目/软删/并发 PK 及 Agent recovery |
| AC-38 | 自动行为通过：独立 10s 查询、局部失败即时合并、五 GET 上限、单向状态 / phase / progress、404 与 429 |
| AC-39 | 自动行为通过：确认层初始焦点、每次 Tab 独立循环、IME、保存失败摘要、继续编辑撤销异步关闭；系统缩放矩阵仍需实机 |
| AC-40 | 自动行为通过：字体失败缓存移除、并发共享、每个 delayRender 句柄释放、显式重挂载与实际播放状态复位 |
| AC-41 | 首次停止原因、deadline / parent_lost / user_cancel、迟到 result 丢弃与真实 exit 才释放槽已实现；真实运行时报告单独列出 |
| AC-42 | 目标目录入口解析、开发 override / 仓库依赖拒绝及包内版本探测有负向回归；本轮真实 installed 包尚无，完整项未通过 |
| AC-43 | **发行阻塞**：三画布视觉 / 音频 runner 与独立 verifier 已实现；随包字体集存在 emoji 缺字，完整 72 组矩阵未通过 |
| AC-44 | 桌面四入口、替换保留外层编辑、取消 / 撤销 / 重开 / 最终导出及退化场景的 runner 已实现；真实本轮 installed 闭环未执行 |
| AC-45 | 严格报告、附件 / 用例 / 输入 / 包身份绑定、同名真实进程竞争及假证据拒绝有测试；正式 all 六场景与全部 AC 的发行结果仍未通过 |
| AC-46 | Agent 原键恢复、按需 schema、真实回执和客户端整轮撤销有自动回归；真实 LLM 的 create→render→查询→apply / unknown / Stop / 撤销场景尚未执行，不计为通过 |
| AC-47 | 自动行为通过：稳定 ID 的 create 仍 POST，update 只 PUT / expected_version，不接受 create 字段；新旧 HTTP 参数兼容 |
| AC-48 | 自动行为通过：working-only、原基准冲突、不保存 / 切稿、缺失素材绑定与冻结 / working 资产并集；恢复不重授旧 target |
| AC-49 | 本地记录 / 编辑租约、revision CAS、丢租约晚回包、持久删除标记与顺序接管有回归；真实多窗口 / 浏览器崩溃矩阵仍需实机 |
| AC-50 | 自动行为通过：跨回合完整冻结 recovery、history 恢复、同稿 unknown 屏障、截断结果保守处理；真实 LLM 场景未执行 |
| AC-51 | 自动行为通过：取消失败恢复查询、旧 GET seq 作废、cursor 链 / 失败同页重试、历史列表局部失败及后台 5s 调度 |
| AC-52 | 自动行为通过：capture 处理 IME / Escape / Tab、保存中继续编辑与关闭意图失效；125% / 150% 实机矩阵待执行 |
| AC-53 | 停止门与终态回归已覆盖；进程 close / kill-main / kill-controller / restart-backend 的完整 installed 所有权矩阵待执行 |
| AC-54 | 测试子进程模块边界、只读 DOM / Player 采集、安装树与 override 拒绝已实现；当前没有本轮 installed 树通过结果 |
| AC-55 | 报告精确字段、必需角色 / 固定场景、源回归测试名、全 56 AC、附件流式 hash 与独占封存均实施；不得用自报 pass 代替正式实测 |
| AC-56 | 门禁保留：无 Git 提交，不用旧 installer / dirty manifest 证明本轮；下游提交后重建、安装、all 六场景通过后方可发行 |

### 本轮发行门禁

现有 `desktop/release` 清单来自 2026-11-15，source_head 为
`9cec48d78b8688a01b4f701975a960a5a4de64e8` 且 dirty=true，不能代表本轮。
当前实施分支未提交，这是本节点的明确约束。新工具对不匹配 / 缺件报告
失败，而不是回退仓库依赖或将开发 payload 标记为 installed。

已确认的字形问题见 IM-R2-06：U+1F3AC、U+1F600、U+2728 尚不能由
随包字体证明覆盖。完整视觉、真实安装 / 最终导出 / 性能与真实 LLM
仍须后续实际执行；此处不宣称发行通过。调度器缺少 TASK_SERVER_URL，
起始 history / get / put 与过程 progress 已实际尝试但未发送成功；
本地任务板回退及最终报告状态另按任务要求执行，不代表服务器确认。

## 第二轮最终代码审查（Subtask #3）

基线 `58dce2a7`，对照第二轮 v2 的 52 个计划路径完成审查，额外修复
CR-13 损坏工作稿模板结构导致恢复崩溃、CR-14 确认层撤销快捷键修改
背景草稿。均有准确的先红后绿回归；结构校验保留超长文字 / 越界值，
确认层保留按钮默认行为和 IME。规格补充 IM-R2-09 / 10，完整结论、
命令范围、初次失败与证据路径见 `final-review.md` 第二轮部分。

本节点重新执行：

- 完整前端 / Agent 104 文件 **911 项通过、0 失败 / 跳过**。
- 后端七专项 **54 通过 / 1 默认跳过**；单独开启真实 worker 后 **1 通过**，
  实际发布 / 恢复 / 取消均覆盖；未把默认跳过项计为通过。
- 最终串行真实 runtime **26/26 通过、无跳过**；全量新进程校验
  12,082 文件 / 4.491s，controller 9.183s。早期冷启动超时和取消
  超预算结果保留，未修改 30s 启动或 12s 退出门禁。
- 桌面 / 报告校验 **31/31 通过、无跳过**；文字与带视频模板的真实
  PNG / 布局开发切片成功，未据此冒领完整视觉矩阵。
- Next 生产构建、构建后根项目类型检查、runtime 类型 / 构建、
  Python AST、专项 ESLint（0 错误 / 7 提示）、diff 空白均通过。
  已跟踪文件凭据扫描通过；55 个交付文件另行扫描为 0 finding。

精确提交范围为 55 个功能源码 / 测试 / 文档文件；构建产物、依赖、
报告、原有测试临时目录和任务调度文件不暂存。真实安装、72 组视觉 /
音频、最终导出、性能和真实 LLM 的发行门禁继续按上表保留待验，
emoji 缺字继续为发行阻塞。此次工程通过不等于 `release_ready=true`。
调度器仍缺 TASK_SERVER_URL，服务端完成状态不能确认，仅按任务授权
更新 Subtask #3 的本地回退，不修改其它节点。
