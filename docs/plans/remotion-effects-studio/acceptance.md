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
