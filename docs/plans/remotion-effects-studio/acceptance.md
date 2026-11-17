# Remotion 特效工作台实施验收

**当前轮次：第三轮实现交付，2026-11-17，基线 `8d53a66d`。**
本轮源码和开发验证已完成；未提交 Git。最新结果见文末「第三轮实现验收」，
以下前两轮实测保留为历史，不能替代新包的发行证据。

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

## 第三轮实现验收（2026-11-17，开发验证）

本轮严格沿用第三轮评审 v2 的 §23：68 个文件均已创建或更新，另按
IM-R3-01–03 纳入 3 个必要修复路径（后端游标、有效清单夹具、打包允许
清单）；48 个预览均由原生成脚本重新制作。没有增加依赖、业务表、
生产 CDP bridge 或新的用户配置；没有提交 Git。前序 plan-current.json、
round-3-verification.md 和原有 .pytest-workspace-import 保留。

| 检查 | 本轮实际结果与证据 |
|---|---|
| 根项目 | `npm run build` 退出 0，90 个页面；构建后 `npm run type-check` 退出 0。构建仍跳过 lint，未据此替代 lint 检查 |
| 标准资源准备 | 修复后重新执行完整 `npm run effects:prepare` 退出 0，包含依赖、浏览器 / native、固定字体、bundle 与全树校验；它会重新封存 runtime 身份，最终测试以本次指纹为准 |
| 前端 / Agent / 时间线 | 23 个测试文件、147 项通过、0 失败 / 跳过；`desktop/build/effects/r3-frontend-current.json`。含保存 / unknown / 停止 / 回执 / 一步撤销，以及新目录、隐藏字段、布局生命周期与原有光标闪烁 |
| 后端 effects 八专项 | 69 项通过、1 默认跳过；`r3-backend-final.xml`。默认跳过的真实 worker 另以 `ECLIPTRIX_EFFECTS_RUNTIME_TEST=1` 启用，1 项通过；没有将跳过算为通过 |
| 真实 runtime | 最终串行 39 项通过、0 跳过；`r3-runtime-final-identity.xml`，63.35s。显式启用 REAL_RUNTIME 与 MANIFEST_STARTUP 开关，controller 约 6.676s、独立全树扫描约 3.701s；包含浏览器实排、文字溢出不发布、停止优先级、真实出片 / 取消 / IPC、全清单校验和小文件缓冲预算 |
| 桌面工具与证据 verifier | 36 项通过、0 跳过；`r3-desktop-final.xml`。含源锁缺件 / 改字节、Player 旧字体混装、固定文案 / 帧拒绝、逐节点实际字体和 66 项映射 |
| 规则 golden | TS 与 Python 共读 333 个独立数值向量，覆盖 12 组件、三画布、Product 临界比例 / cardScale / scale 和 Callouts 锚点；三端规则原字节及 textLayoutHash 一致 |
| 字体 | Noto Emoji 来自官方完整提交 `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`；三种正文链的 emoji / ZWJ / 变体选择符 / 肤色 / combining 字形检查均无缺字。Headless Shell 与 Electron 33 的 4 字体×400/600 原始 CDP 探针均确认 isCustomFont；这不等于完整 27 组 Player 实帧验收 |
| 预览 | 24 对真实 MP4 / JPG 重制；逐个 ffprobe 确认 MP4 为 60 帧 / 30fps；目录恰为 catalog 的 48 路径。已查看本轮联系表，没有默认文案明显裁切；三画布完整视觉门禁仍待验 |
| lint / 静态检查 | 49 个本轮 JS/TS 文件的 ESLint 退出 0、0 错误 / 5 提示；使用项目既有 eslintrc 模式。7 个 Python AST、diff 空白检查通过。未修改全仓既有 lint 问题 |
| 凭据 / 打包范围 | 已跟踪 3119 文件扫描及所有本轮新增 / 修改文本另扫均为 0 finding；7 项 effects 打包允许模式覆盖实际 12091 个运行资源，测试媒体、profile、请求和旧版本夹具目录均被排除 |

本轮 runtime 身份：

```text
runtimeFingerprint=3d3a999da5f67eaa1d46cd815dea488a320144c7ccd3ba6830eb470f32cfb025
textLayoutHash=d684525e979730e2283870893760b14696782d1da7e98f019b935031f9954b8a
fontHash=9c8e3d6e1835ad6dc2a319a4296eedd6c0455a878df0b9d669e90abd5ac43611
```

本轮先红后绿复现了 LF / CR 的 raqm 异常、缺规则身份不被拒绝、文字
溢出被降级、缺分页模块及报告 v1 等问题。真实 13 稿 HTTP 又发现并修复
SQLite 整秒 / 微秒游标重复页。独立只读评审补充修复了计数器完整数值
测量、同字段单行空 glyph 漏检、AC 上限未升级、目录摘要回退、包内两份
字体混装和测试证据被打包的问题；具体边界见 final-review.md。

保留失败记录：第一次 prepare 的新 import 层级错误、首次 build 的 Map
迭代与 ES5 target 不兼容已修复；首次预览脚本的工作目录猜测已修复。
jsdom 测试最初误用空标题、真实空行断言误以 glyph Rect 高等于行高，均
纠正夹具 / 度量，未伪造浏览器几何。Remotion 错误事件会不 await cleanup，
已使取证 close 在错误路径只记录观测错误，正常路径仍严格重抛，最终无
unhandled rejection。完整 prepare 后曾再次出现 controller 首次启动触及
30s；按文件尺寸限制缓冲后，第一次冷启动仍超时，不能把缓冲修复视为
全部耗时的根因。该失败保留于 `r3-size-aware-cold-start.xml`；后续完整
39 项两次同预算通过，最后一次以本段新身份为准。仅诊断进程设置线程池
为 8 的一次全树扫描约 22.28s，也不能证明冷启动问题已修复；产品没有
修改线程池、缓存或启动期限。重负载冷启动仍列入发行性能门禁。
字体测试初次从 runtime cwd 生成的
临时目录已移入 ignored evidence 保留，并改为基于测试文件的绝对路径。

| 新 AC | 当前证据边界 |
|---|---|
| 57、63、64 | 三正文链字形、双端单字体 CDP、实际 renderer 与 verifier 负测通过；完整 27 组×3 帧的双端实帧与独立重算尚未执行 |
| 58 | 固定源 / 损坏 / 缺件 / 离线回归及当前开发 payload 的只读闭包通过；真实最终安装包及其前后资源身份仍待验 |
| 59、60 | HTTP 显式行、333 golden、Headless 实排 / 空行 / Callouts / 组 / 数值边界通过；真实安装 Player 三画布与外层 CSS 缩放矩阵仍待验 |
| 61、62 | 真实 HTTP 13 稿分页、hook 竞态、modal 选择 / 页外保留 / 末页焦点 / 保存重开通过；安装应用完整重启流程尚未执行 |
| 65 | 真实 child 文字失败不发布、controller 保码、取消 / deadline 优先及既有 Agent 屏障回归通过；正式安装闭环仍需重验 |
| 66 | 旧稿 / 旧输出回归工具与夹具身份门禁已接线；缺基线真实隔离夹具，当前 blocked，未以新生成视频代替 |

正式发行仍需最终节点审查与提交后，按新的 source_head 重建、真实安装，
执行 72 组主矩阵、27 组文字补充、校准音频、最终导出、性能、真实 LLM、
旧稿 / 旧输出及原许可门禁。当前 `release_ready=false`，本节点的完成仅
表示实现交付完成，不表示 66 个发行 AC 已全部通过。

### 第三轮实际预览路径与 SHA-256

下表由本次生成后重新读取字节得到；原始机器记录为
`desktop/build/effects/r3-preview-hashes.json`。

| path | bytes | SHA-256 |
|---|---:|---|
| `public/effects/previews/title-rise.jpg` | 8356 | `c1b4cfd029e106707073a25e23ae519a4dad2c8ece2067841c7a4895896c6ade` |
| `public/effects/previews/title-rise.mp4` | 10719 | `8596dc53ac73be9d6ad11809d60e097a4590a8bbc188b0650beb49792de0ee9f` |
| `public/effects/previews/title-mask.jpg` | 8347 | `65a489f2aba88a39e481a21c046a10366d55c50423fbaffe7a7e098e3bfbf117` |
| `public/effects/previews/title-mask.mp4` | 9921 | `9762275c857bd59898d23093bd8431de752b7a38d2488ecba5d9eee7ce80e215` |
| `public/effects/previews/type-cursor.jpg` | 6951 | `5c99c6977007f49944b4253db796a43055c4584f9b76e6c387fea2bf0ec9c656` |
| `public/effects/previews/type-cursor.mp4` | 9480 | `7f6328a3f1fc95f2aa6a2e3088a55af5fddd8c3f4ec02d59fffdb1e1a580a2f4` |
| `public/effects/previews/type-lines.jpg` | 6550 | `b4cacf061383acc3270a784c41a97424564931c7c636926f0d7247edc707a5ce` |
| `public/effects/previews/type-lines.mp4` | 7099 | `15159b77e2859e3d1c1eef20cdc865d68dc5ea1f50ad7789bfda7d42a968f9c2` |
| `public/effects/previews/lower-clean.jpg` | 8925 | `d04226b7dbf117d701b88d327add3adcc4c9f97c227bd8e1f2b7e6f13ca52851` |
| `public/effects/previews/lower-clean.mp4` | 15496 | `d1cf5091ccf51eab9645beaa18ec93ac0662d9f4aeef5c32f133ab52a41f9001` |
| `public/effects/previews/lower-block.jpg` | 9512 | `7704c031bcb1639f0161cf3bad846c52e2a3371cc0c451cc17d46b216eb06245` |
| `public/effects/previews/lower-block.mp4` | 14593 | `369a4a875f1d935f98a48c3d3e04471be843f93813ef8b25c11e49308e566289` |
| `public/effects/previews/image-zoom.jpg` | 5987 | `2bd42ea5a8e9f3939f65cf76cc437ad8c4b32a4a7849e0ad41ed1904e02a42e6` |
| `public/effects/previews/image-zoom.mp4` | 28538 | `a6cc4d27475857cb3d897b9501190573cc11637428b83d686980290ba2249111` |
| `public/effects/previews/image-wipe.jpg` | 5554 | `ae35935df61c4814df8eb9b2f64e4d1033561d700f1c7538e2f1de6789281d30` |
| `public/effects/previews/image-wipe.mp4` | 13154 | `ad4edbf8544a6ca9c74c556dd5d6d6e514ea0ba960ae368f75906752f4c7714e` |
| `public/effects/previews/slides-crossfade.jpg` | 5439 | `68b7cac86cf9aa35234e927092be2bf48b9790dcdf72755c342fc72363ac91c7` |
| `public/effects/previews/slides-crossfade.mp4` | 15526 | `7bb417ad527747492a1ddbd1a490a84fe064222fce611f2e08d9697b5785b97f` |
| `public/effects/previews/slides-stack.jpg` | 12231 | `fb2c151aaa82a42548022f775d5e16261df5ba6cce3c67ade54fc9185c72957f` |
| `public/effects/previews/slides-stack.mp4` | 29637 | `fb0464cd03069fe9ba9b6d0557e9e619aacc4468171334cfa97cc4fad6519535` |
| `public/effects/previews/split-horizontal.jpg` | 11911 | `6b660376cf8daf2f31bcd5958606a7d6ec7aad064462ca1b785a575ceb677daa` |
| `public/effects/previews/split-horizontal.mp4` | 14383 | `ab9e6f71af88f63e024eb8b5886882b53d2d75a49e867e41faf47f105ac5b874` |
| `public/effects/previews/split-vertical.jpg` | 11656 | `651caeb824a6a4b1c4b0b514ae3d08aadfb57b8979a7b84b31ac442aa4d2d250` |
| `public/effects/previews/split-vertical.mp4` | 13557 | `9719bdf8fef17b52b40ea0f26d3cccec71b27b7e8e40853495d94feb1425d04f` |
| `public/effects/previews/product-float.jpg` | 12243 | `2b682c24314caf17b943ae79137303e9dec21c8f0530d0e1b83091e44e03324d` |
| `public/effects/previews/product-float.mp4` | 22474 | `52df78c876432d8cd7362e80f244991781b7460d17d974f031f2eb6cb614ba5b` |
| `public/effects/previews/product-spotlight.jpg` | 13513 | `911915fd1baf4c6379b9cf23b35063ecc6f66e5cf7f900d411992b918c55a974` |
| `public/effects/previews/product-spotlight.mp4` | 24526 | `e5625c95986c7bf6693389aab5cb7f5c23bcd43b188f9977c2bb79459cee92c1` |
| `public/effects/previews/callout-line.jpg` | 6283 | `22b1c80b87efb075706d1e541e43d2dab50fc217b33eae3e367b39bfb4af23d3` |
| `public/effects/previews/callout-line.mp4` | 10179 | `84e90e9209907529867d4734cb74c057094611109ddcff97ffbd7f311ada299f` |
| `public/effects/previews/callout-ring.jpg` | 6099 | `f2c000b288360bbfecf83d04401a6142d1012ab5c93ae17f8fb0ec2168ef5c30` |
| `public/effects/previews/callout-ring.mp4` | 10155 | `e8bf8c17d029795b332adf8cf15c19f662953f7faa09431c48a569ff9bad92fc` |
| `public/effects/previews/counter-up.jpg` | 9426 | `0cfd02c0513ad5d2fa61eaf1d0157f38d1a642ac2f30786437e0cb9c2e3876e4` |
| `public/effects/previews/counter-up.mp4` | 12255 | `e56e940431051a6a8aa29305cd09096e8f38683a4eb9a3f4378ce55abbd6e7b0` |
| `public/effects/previews/counter-bars.jpg` | 10539 | `dc54aa5273e478bf51fb409d5d5cfbf95831a54df63851ea237cd15f1672f437` |
| `public/effects/previews/counter-bars.mp4` | 12884 | `f2637b247e93d4bd59fa8910c212f70e51150f637c80b2b65556ed954c9d3bf1` |
| `public/effects/previews/countdown-ring.jpg` | 10619 | `f793c087eecf0d3d84f9288997a09eb88c8fb07d875895f172270a6d0b720232` |
| `public/effects/previews/countdown-ring.mp4` | 15946 | `295b72a1147fae2775a016a8c4bfe3f36548497de921be29f470cf296797e22f` |
| `public/effects/previews/countdown-flip.jpg` | 8631 | `77e2c5e6f55888f75296dea3774ab884ab823105b80858465a8b041f6d8b8026` |
| `public/effects/previews/countdown-flip.mp4` | 13775 | `62361bd0ec67f3e58fb49766c2f99b1e991a434da84af6a523e191dd297b21ea` |
| `public/effects/previews/video-cinematic.jpg` | 28018 | `711a59f2a6e9241d7fa94c682f5f60165cf8191aa28a5f9add47ce85afe32b40` |
| `public/effects/previews/video-cinematic.mp4` | 370334 | `b8a276c621cb902755c6e45363981ab3f6d04be199314025ed11a4b523be3f1a` |
| `public/effects/previews/video-glitch.jpg` | 25738 | `62c89c30869038e07cef93de49ac3288e81e52bc319f4590ba4bf3a1da8058a8` |
| `public/effects/previews/video-glitch.mp4` | 398376 | `ffe80823a2bc2b38b9d003c4c7610d3ca94c99ad4c4fe7cea04c1a53c1aa39b8` |
| `public/effects/previews/background-orbit.jpg` | 10447 | `07b1ab029a508f3d91d9063004810f4b09c7f70597a1bb3ff7e184637ee56be5` |
| `public/effects/previews/background-orbit.mp4` | 76372 | `d58b6e7a5e17fb70aa6ba16ad38466df94ac91f770e9b1c279683a7c41fd686a` |
| `public/effects/previews/background-grid.jpg` | 11530 | `e267774491408096f71140243f2858a6b0bf6ff606458a146ce8ce68cf817fc9` |
| `public/effects/previews/background-grid.mp4` | 55775 | `f8b7120265e65578df1fe4d3092db12b3ee5770c47f230f5511842a90c6ceb5d` |

## 第三轮最终审查验证（2026-11-17）

最终节点重新执行：前端与相邻回归 105 文件 / 892 项通过；后端 69
通过 / 1 默认跳过，另显式真实 worker 1 通过；真实 runtime 37 + IPC 2
通过；桌面 37 通过。除注明的默认 worker 外均无跳过。生产构建 90 页面、
构建后类型检查、runtime 类型 / 构建、49 文件 lint（0 错误 / 5 提示）、
8 Python AST、121 个功能文件凭据扫描、48 预览 hash 与 24 视频探测通过。
原始 `review-r3-*` 报告、逐项路径清单及详细命令范围见 final-review.md。

CR-15 已修复：第 13 草稿验收必须真实重启 Electron，验证相同资料目录、
新进程、零残留、HTTP 12+1、UI 选择、文案和时间线；仅 Page.reload
不能代领 AC-61。新增验证器负测已先红后绿，独立代码复核通过；该场景
的最终安装实测仍待执行。精确提交范围为 68 个批准路径 + 3 个必要扩展
+ 48 个预览 + 2 个前序设计文档，共 121 文件。原有测试目录与新运行
证据保持未暂存。代码审查交付完成不改变上文发行门禁，仍为
`release_ready=false`。
