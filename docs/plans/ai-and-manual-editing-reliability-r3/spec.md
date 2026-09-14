# AI 自动剪辑 + 手动剪辑 稳健性加固（第 3 轮）— 设计方案

| 项 | 值 |
|---|---|
| 文档版本 | **v2**（v1 由方案设计节点产出；v2 由「方案评审与修复」节点修订：新增「评审记录」与文末「评审结论」，P1×5 与 P2×18 已改入正文，见评审记录 RV3-01～RV3-24；提交节点代码评审追加文末「代码评审修复记录」RC3-01～RC3-40） |
| 日期 | 2026-09-14 |
| 分支 / 基线 | `feat/remove-user-system` @ `e06dca4`（第 2 轮已提交，工作区干净） |
| 上一轮 | `docs/plans/ai-and-manual-editing-reliability-r2/spec.md`：第 2 轮 66 项 + 评审 RV-01～19 + 代码评审 RC2-01～29 已修复并提交；其附录 A（27 项 + N-01～N-21）是本轮输入 |
| 需求来源 | 任务板「AI 自动剪辑 / 手动剪辑 更加完善稳健可靠，每轮 ≥10 个问题并逐一修复」；本轮为循环的**最后一轮（3/3）** |
| 本轮范围 | **87 个已证实缺陷**（P0×1 / P1×21 / P2×65），分 6 组；另 4 项整体延后、11 项的部分子项延后并写明原因（附录 A）；1 项经核查不可达后关闭（附录 B） |
| 本轮主题 | **预览即成片**（输出帧坐标单一来源）、**长任务可控**（阶段进度、取消、规模上限）、**Agent 可信**（事件流完整、错误如实、上下文有预算）、**编辑可预期**（无变化不入历史、拒绝即回滚）、**键盘与屏幕阅读器可达** |
| 适用产品形态 | 单用户 Electron 桌面端（FastAPI 127.0.0.1 + Next standalone），无鉴权、SQLite |

> 证据说明：本文每个缺陷都给出 `文件:行号`（基线 `e06dca4`）、复现数值与根因。标注 *[实测]* 的条目做过运行验证
> （真实 ffmpeg 7 / ffprobe 生成素材并检查像素、帧数、峰值内存与命令行长度；Vitest + RTL 临时复现用例；打包 Python 环境内的 FastAPI 断开探针；Tailwind 3.4.0 真实编译）。
> 其余条目为「读代码 + 具体数值推演」。实现节点必须**先写回归测试并确认在基线上失败，再改代码**。
>
> 编号规则：新发现沿用排查切片前缀——`PV3` 预览⇄导出一致、`EX3` 导出流程、`TL3` 时间轴核心、`UI3` 时间轴交互与可访问性、`AG3` 剪辑 Agent、`AM3` AI 混剪 / 自动混剪、`DS3` 数据安全；
> 第 2 轮附录 A 条目保留原编号（`EXO-xx`、`ME-xx`、`TL2-xx`、`AG2-xx`、`AM2-xx`、`BL-xx`、`N-xx`）。共享机制编号接续第 2 轮（S11～S16）。

---

## 评审记录

| 项 | 值 |
|---|---|
| 评审节点 | 方案评审与修复（第 3 轮，循环最后一轮） |
| 日期 / 基线 | 2026-09-14 / `feat/remove-user-system` @ `e06dca4`（工作区仅本目录未跟踪） |
| 评审范围 | v1 全文逐节：§0～§9、附录 A～C |
| 评审维度 | **可行性**（现有技术栈能否实现）、**完整性**（边界、错误路径、上线与门禁）、**一致性**（与 `CLAUDE.md` 约定及代码现状是否冲突）、**规模**（是否过度设计或欠规格） |
| 结论摘要 | P0×0、P1×5、P2×19。5 个 P1 与 18 个 P2 已改入正文；RV3-24 接受并补充说明。未改源码、未提交 |

### 评审方式与复核证据

v1 的缺陷定位质量高：主要断言带 `文件:行号`、多数关键路径做过实测，共享机制 S11～S16 把 87 项收敛为少数不变量，分组、依赖与回退顺序清楚。评审没有重复排查，而是回到基线源码只读复核**设计所依赖的前提**，并在基线上逐条执行 §7.2 的 grep 门禁，检查它们能否通过：

- **数据安全**：`repairTimelineData.ts:34-35,49-50` 与 `hydrateTimeline.ts:158` 与 v1 描述一致。但 Agent 工具 `tools/addToTrack.ts:133-136`、`tools/composeStoryboard.ts:86-89` 对图片发送的是 `clipStart: 0, clipEnd: duration`（`a7f46c5`、`01af364` 同样如此），`tools/resizeClip.ts:59-62` 对静态图同步 `clipEnd`，所以现行写入方不会产生 `clipEnd = 0`。`clipEnd = 0` 的图片是旧版本写入的存量数据，`TimelineItem.ts:434`、`SplitService.ts:106` 的注释记录了这一点 → RV3-01。
- **Agent**：`SSEStreamManager.parseSSEBuffer:416-417` 的 `currentData / currentId` 确为局部变量（AG3-01 成立）。pi-agent-core 的 `agent-loop.js:88`、`agent.js:389-390` 会产生 `stopReason: 'error' | 'aborted'` 与 `errorMessage`（AG3-03 可行）。熔断在 `agent.ts:328-331` 先发送自己的 `error` 再 `abort()`，所以「aborted 不再发空内容错误」不会让熔断变成静默。路由看门狗 `route.ts:468-476` 只在 `tool_execution_start / end` 时重置（`agent.ts:276,287`）；`: heartbeat` 与 `: keepalive` 是注释帧，不是事件。
- **导出**：画布合成 `video_composition_service.py:289-302` 是一次没有进度输出的 `subprocess.run`；`get_composition_status`（`:1782-1784`）直接返回状态字典；状态路由对字段做白名单（`video_router.py:246-259`）→ RV3-02。`filtergraph_builder.py:45-56` 的 `ClipLike` 只含时间、不透明度与转场字段（运镜在归一化阶段处理），因此 N-04 的连续段预合并可行。`video_scaling.py:82-84` 在宽高比差 < 0.01 时直接缩放、不补边；`:135-166` 的运镜位于 scale 与 pad 之间，与 PV3-01 的设计一致。后端没有任何代码读取 `status["request"]`，EX3-06 弹出它是安全的。桌面端 `STORAGE_ROOT = userData/storage`（`desktop/main/backendService.js:34`）。
- **字幕**：导出默认字号 24、边距 50（`subtitle_service.py:38-46`），与前端 `SubtitleLayer.ts:52` 的默认 24 一致。每行字数上限 `(W − 2×50) / fs`（`:255-265`）、CJK 逐码位换行（`:320-333`）、行高 `fs + 5` 与 `_block_start_y`（`:849-883`）均与 §3.3 EXO-09 一致；导出字号不随分辨率缩放。
- **时间轴**：`HistoryService.addAction`（`:106-120`，`MAX_HISTORY = 50`）、`historySlice.recordAction / captureNextState`（`:101-127`）、`dragSlice.commitMove` 先静默回滚再提交（`:160-191`）均已复核。`organizeVideoAudioTracks` 只处理 `video / audio` 类型；图片轨的类型是 `video`，同样按磁性排布。`Volume.create` 只钳制不抛错；聚合根导入只在轨道类型不接受素材或出现负时间时抛错。S12、TL3-01、N-07 `salvageTimelineData` 均可实现。`replaceTimelineAction`（`:53-86`）会整体替换轨道，包括 `isLocked / isMuted / isVisible` → RV3-05。
- **交互**：`TimelinePanel` 根节点（`:1366-1442`）没有 React 事件处理，N-12 改 portal 后事件冒泡是安全的。Tailwind `zIndex` 为 `dock 850 / dock-panel 860 / modal 1000`（`tailwind.config.js:121-131`）；共享 `Modal.tsx:69` 默认根类是 `z-50`，运镜、项目、分类三个弹窗没有覆盖它 → RV3-15。
- **门禁实跑**：A11 会命中陈旧的 `__pycache__/*.pyc`；A12 会命中仍在使用的 `_download_video_if_needed`（共 51 行）；A16 会命中范围之外的 `StoryboardTab.tsx:227`；A15 漏掉 JSX 文本节点；A18 命中 7 个测试文件，其中 5 个未列入 T13 → RV3-04 / RV3-18。A20 扫描 1048 个跟踪文件，只有 `videoExportItems.ts` 含 1 个 NUL；A21 恰好是 UI3-09 所列 4 个文件中的 14 处；A13、A14、A19 可以通过。

### 问题清单

严重度定义同 §2。「已改正文」表示本 v2 已修改所列小节。

| ID | 级别 | 维度 | 位置 | 问题与证据 | 处置 |
|---|---|---|---|---|---|
| RV3-01 | P1 | 一致性（证据） | §0 断言 7、§1、§2.6、§3.8 DS3-01、§7.3 第 27 条 | 唯一 P0 的根因描述有误。v1 称「Agent 写入的图片恒为 `clipEnd: 0`（`OperationApplier.ts:636-637`）」「受影响的恰是经 Agent 编辑过的项目」；实际上 `clip.clipEnd \|\| 0` 只有在工具发送 0 时才得到 0，而现行工具发送的是 `duration`（见上）。真正受影响的是旧版本写入的 `clipEnd = 0` 图片、零时长条目，以及经 JSON 导入写入的 `clipEnd ≤ clipStart` 条目。按 v1 的描述，实现节点可能去「修」写入方，却漏掉存量数据 | 已改正文：更正现状与受影响范围，写明只改读取侧、不改写入方；补充用例「keeps a legacy agent image …」；走查第 27 条注明是在模拟存量数据 |
| RV3-02 | P1 | 可行性 | §3.2 S15、§3.4 EXO-07、§5.2、§6.2/6.3 | 停滞超时只按 `progress / stage` 的变化重置，但画布合成、单个长片段归一化、合流、叠加 / 字幕烧录各自都是一次可能超过 10 分钟的 `subprocess.run`，整个阶段内进度不变。v1 自己的复现（20 分钟 1080p 多轨导出）仍会在 10 分钟时被客户端判为超时，而后端继续编码、留下孤儿文件；合成阶段进度条也会停在约 75% 十几分钟 | 已改正文：长命令追加 ffmpeg `-progress` 进度文件（仍用 `subprocess.run`，测试接缝不变），状态返回 `activity_at` 与合成阶段插值进度，客户端据此重置停滞计时；新增 B14、BT18、决策 D-32，走查第 11 条补长导出 |
| RV3-03 | P1 | 完整性 | §3.4 N-11、§7.1 BT11 | 删除 `_download_video*` 的清单漏掉两处耦合测试：`tests/test_video_composition_timeline_order.py` 有 4 处 `patch.object(self.service, '_download_video')`，删除后抛 AttributeError；`tests/test_pexels_functionality.py:19-48` 断言 `video_download_config / _download_video / _download_pexels_video_with_retry / _is_pexels_url` 存在。两者都会让 A5「全量无新增失败」失败。另漏掉 `composition/camera_motion.py:144` 引用被删方法的文档串，以及 `__init__` 中 `:208 _load_video_download_config()`、`:214 YouTubeService()` 两处调用 | 已改正文：补齐文件清单与处理方式 |
| RV3-04 | P1 | 可行性（门禁） | §7.2 A11、A12、A16 | 三条门禁在正确实现后仍无法通过：A12 的 `_download_video` 子串会匹配 `video_cut_service.py:117`、`watermark_removal_service.py:100,155`、`tests/test_video_cut_local_storage.py:114` 中仍在使用的 `_download_video_if_needed`（基线 51 行）；A11 用 `grep -rn` 会报告本地陈旧的 `__pycache__/*.pyc`「Binary file matches」；A16 会命中范围之外的 `AiImageModal/StoryboardTab.tsx:227` | 已改正文：A11 加 `-I`；A12 改为精确正则；A16 限定到运镜弹窗目录；`StoryboardTab` 记入附录 A「评审补充」 |
| RV3-05 | P1 | 完整性 | §3.2 S12 不变量 2、§3.5 ME-12、F35、F48 | S12 规定视图标志不入历史、撤销保留现值，但只覆盖了 `TimelineAggregate.restore`。「撤销 Agent 本轮」经 `replaceTimelineAction('agent-undo')` 写回轮次开始时的轨道 JSON（`replaceTimeline.ts:77-82` 整体替换，含标志）。复现：Agent 一轮后用户静音音乐轨 → 撤销本轮 → 音乐轨被静默取消静音，导出包含音乐（`isMuted` 轨在导出中被跳过）；锁定状态同样会被悄悄解除。F48 仅「按需」忽略冲突比较，并没有保留现值 | 已改正文：新增 `trackViewFlags.ts`（F100），`replaceTimelineAction` 在 `reason !== 'import'` 时把同 id 轨道的现行标志带入后再比较与写入；F48 改为必做；新增 T96、决策 D-31；走查第 17 条补充 |
| RV3-06 | P2 | 完整性 | §3.6 TL2-13 | 方向键 / Home / End / PageUp / PageDown 一律切到键盘模态。时间轴没有全局方向键快捷键，于是「鼠标点击片段或工具栏按钮 → 习惯性按方向键 → 按空格」时空格会让给聚焦的按钮（可能触发已聚焦的删除 / 剪切按钮），而不是播放 | 已改正文：只有 Tab 与复合控件内的方向类按键切到键盘模态；追加用例 |
| RV3-07 | P2 | 完整性 | §3.4 EXO-14 | 导出会话只按 `taskId` 隔离。同一任务内切换项目（编辑器 `key={projectId}`）时，项目 B 会显示项目 A 的导出进度并被禁止导出，在 B 中点取消会取消 A 的导出。`VideoPlayerPanel` 已持有 `projectId`（VEI `:2248`） | 已改正文：会话键改为 `taskId:projectId` |
| RV3-08 | P2 | 一致性 | §3.3 PV3-04 第 4 步 | 设计让 VEI 读取 `useTimelineStore.getState()._aggregate`，与附录 B「`timeline/store/` 之外无 `_aggregate` 访问」这一核实过的不变量冲突 | 已改正文：由 `updateItemFields.ts` 导出 `readImagePosition` |
| RV3-09 | P2 | 完整性 | §3.7 AG2-21 | 客户端与服务端的无活动超时都是 30 分钟，且都在工具开始 / 结束时重置，两个定时器几乎同时到期。客户端先到期时会中止连接，AG3-02 刚修好的带 `code: 'server_timeout'` 的服务端错误就到不了客户端 | 已改正文：客户端 = 服务端 + 60 s 宽限，常量共用 `timeouts.ts`（F101） |
| RV3-10 | P2 | 完整性 | §3.7 AG3-03 | 先匹配 `\b401\b` 再匹配上下文超长：像「maximum context length is 128000 … you requested 401 more tokens」这类消息会被误判为鉴权错误 | 已改正文：上下文超长 → 限流 → 鉴权，追加用例 |
| RV3-11 | P2 | 一致性 / 规模 | §3.3 PV3-01 | ① 导出在宽高比差 < 0.01 时直接铺满，不补边（`video_scaling.py:82-84`），`fitSourceInFrame` 却会补出 1～3 px 黑边；② 要求同步改写 `drawFrame`，但它在生产代码中没有调用方（只有测试使用），其 `_drawSubtitle` 单行路径同样是死路径，改它只是空转 | 已改正文：`fitSourceInFrame` 镜像 0.01 容差；不改 `drawFrame`，死代码清理记入附录 A「评审补充」 |
| RV3-12 | P2 | 完整性 | §3.4 EX3-07 | 修复方式是在源码里写 NUL 转义序列（反斜杠 + `u0000`）。经工具写入这类转义序列时，有被写成原始字节的已知陷阱，会复现同一缺陷 | 已改正文：键改为 `JSON.stringify([trackId, itemId])`，完全不含控制字符 |
| RV3-13 | P2 | 完整性 | §3.4 EXO-07 取消 | 排队中的任务阻塞在 `self._composition_semaphore.acquire()`（`:1169`），取消后要等到有空闲槽才会结束，状态长期停在 queued / cancelling | 已改正文：以带超时的 `acquire` 循环检查取消事件 |
| RV3-14 | P2 | 可行性 | §3.4 EX3-04、R6 | 分块合流的中间 WAV 若是 16 位，块内求和超过 0 dBFS 时会提前削波，而单次合流是在浮点域求和后才编码。「分块结果与单次一致」的论断因此不成立 | 已改正文：块文件以 `pcm_f32le` 写出，同步修改 R6 |
| RV3-15 | P2 | 完整性 | §3.6 UI3-08、A17 | 只把 `ConfirmationDialog` 提到 `z-modal`；共享 `Modal.tsx:69` 默认 `z-50`，运镜、项目、分类弹窗仍然低于 Agent 浮窗（850 / 860），N-12 portal 之后这一点更明显 | 已改正文：`Modal` 默认根类改为 `z-modal`，A17 追加检查 |
| RV3-16 | P2 | 一致性 | §9 I-7 | 超过 1000 行的文件名单漏了 `app/routers/video_router.py`（1370 行，B7 会新增取消接口）；`CanvasCompositor.ts`（921 行）与 `useAgentExecution.ts`（808 行）本轮改动后可能越线，但没有给出抽取去向 | 已改正文 |
| RV3-17 | P2 | 一致性 | §3.8 BL-14、D1 | 删除路由后 `CLAUDE.md`「registers 32 routers」会失真（基线 `app/main.py` 有 32 处 `include_router`） | 已改正文：D1 同步改为 31 |
| RV3-18 | P2 | 完整性（门禁） | §7.2 A15、A18、§7.1 T13 | A15 的正则带引号，漏掉 `AgentResponseNode.tsx:124,160` 这类 JSX 文本节点，门禁形同虚设；A18 会命中 `PreviewCanvas.test.tsx`、`useCompositionPlayback.probe.test.tsx`、`useCompositionPlayback.test.tsx`、`assembleLayers.camera.test.ts`、`multiTrackCompositorS2Boundaries.test.ts` 等测试，而 T13 只列了 2 个 | 已改正文 |
| RV3-19 | P2 | 可行性 | §3.8 N-13 | `Date.parse(createdAt)`：`MaterialItem.createdAt` 声明为 `Date`（`src/types/index.ts:588`），会出 tsc 类型错误；持久化之后它在运行时却是 ISO 字符串 | 已改正文：`new Date(createdAt).getTime()`，非有限值时跳过时间戳规则 |
| RV3-20 | P2 | 完整性 | §3.3 ME-06 | 已路由元素的最终音量依赖 UA 在 `MediaElementAudioSourceNode` 之前应用 `volume / muted`，而分离音频的视频元素靠 `muted` 静音，存在双份音频的风险 | 已改正文：已路由元素 `volume = 1`，音量与静音都由增益级承担，并监听 `volumechange` |
| RV3-21 | P2 | 完整性（交互） | §3.5 ME-11 | 拖放后最多静默等待 10 s，界面没有任何反馈 | 已改正文：超过 600 ms 时提示一次，新增文案 key |
| RV3-22 | P2 | 完整性 | §3.4 EX3-06 | `composed_output_dir()` 在 `STORAGE_ROOT` 之下，但 `initUserData()` 创建的是 `userData/static/video/composed`，新目录在首次导出时并不存在 | 已改正文：首次使用时 `mkdir(parents=True, exist_ok=True)` |
| RV3-23 | P2 | 完整性（上线） | §8 | 修复前已经被删除、又被自动保存的条目无法找回，v1 没有写入风险与发布说明 | 已改正文：新增 R28 |
| RV3-24 | P2 | 规模 | §3.7 AG2-13 | `HISTORY_CHAR_BUDGET = 120_000` 按字符计，没有说明它与 token 窗口的关系 | 接受，补充说明：按 `agent.ts:130-132` 既有的中文保守估算（约 2 字符 / token）约为 6 万 token，加上系统提示与 `maxTokens: 4096` 仍在 `contextWindow: 128000`（`agent.ts:80-81`）之内；超出时由 AG3-03 给出「对话过长」的准确提示 |

**v2 新增的文件、用例与决策**：F100 `timeline/domain/services/trackViewFlags.ts`、F101 `src/lib/video-editing-agent/timeouts.ts`、B14 `app/services/composition/ffmpeg_args.py`；T96、BT18；i18n `timeline.messages.probingDuration`；决策 D-31～D-33；附录 A「评审补充（v2）」2 条；风险 R28、R29。缺陷范围（87 项）与分组计数不变。

---

## 0. 排查方式与基线

**排查方式**：6 路只读排查代理并行（预览⇄导出一致 / 导出流程 / 时间轴核心 / 时间轴交互与可访问性 / 剪辑 Agent / AI 混剪·自动混剪·数据安全），
每路先在 HEAD 逐条复核第 2 轮附录 A 中归属本切片的条目（是否仍存在、当前行号、复现、根因、修复设计），再对第 2 轮新写或改动的代码（`git diff a7f46c5 e06dca4`）做系统排查；
每条结论要求 `文件:行号`、复现数值与可逐行实施的修复设计。临时复现文件位于 `src/__r3probe_<切片>__/` 或会话 scratchpad，排查结束后全部删除，`git status --porcelain` 为空。

主线程随后**亲自读码复核**了以下关键断言，全部与排查结论一致：

1. `playback/internal/fitContain.ts:54` `sourceRatio = input.targetAspectRatio ?? sourceWidth / sourceHeight`，`CanvasCompositor._drawVideoLayer` 恒传视口画幅（PV3-01）。
2. `VideoPlayerPanel/ImageOverlay.tsx` 为每张活动图片渲染不透明 `<img object-contain>`（`zIndex ≥ 10`），画布 `PreviewCanvas` 为 `zIndex: 2`（PV3-02）。
3. `usePreviewTransport.ts:30` 的 `masterVolume` 从未传给 `useCompositionPlayback`，音频组固定 `volume: 1`（`useCompositionPlayback.ts:136`）（PV3-03）。
4. `SSEStreamManager.parseSSEBuffer` 中 `currentData / currentId` 为每次调用的局部变量（AG3-01）；`agent.ts` `message_end` 不读 `stopReason / errorMessage`（AG3-03）。
5. `dragSlice.commitMove` 以 `moveItemAction(get, id, preview.startTime)` 提交，`TimelineAggregate.moveItem` 稳定排序后 `organizeVideoAudioTracks` 按起点贴紧（TL3-01）；`splitItem.collectTargets` 对 `'selected'` 同样跳过隐藏轨（TL3-05）。
6. `videoExportItems.ts` 字节偏移 7204 处存在原始 NUL，`git diff --numstat a7f46c5 e06dca4` 显示为二进制（EX3-07）；`video_composition_service.py:1450-1471` 对同源片段 `shutil.copy2`（EX3-03）。
7. `repairTimelineData.ts:34-35,49-50` 删除 `duration ≤ 0` 与 `clipEnd ≤ clipStart` 的条目，而聚合根接受这两类条目；`hydrateTimeline.ts:158` 只在 `failed` 时备份（DS3-01）。
   *（v2 评审 RV3-01 更正：`clipEnd = 0` 的 Agent 图片是旧版本写入的存量数据，见 `TimelineItem.ts:434`、`SplitService.ts:106` 的注释；现行工具 `addToTrack.ts:133-134` 发送 `clipEnd: duration`。）*
8. `useMaterialManagement.ts:100-108` 把 store 中「本地没有」的素材合并回来，`executeDelete` 不调用 `removeMaterial`（DS3-02）。
9. `shortcutOwnership.shouldGlobalSpaceTogglePlayback` 有意忽略聚焦按钮，VEI 空格处理无 `event.repeat` 检查（TL2-13 / UI3-11）。
10. `VideoEditingInterface.tsx:2275-2280` 的 `inert` 包住 `TimelinePanel`，其内弹窗无 portal（N-12）；`toggleTrackMuteAction` 无 UI 调用方（ME-12）；`ai_video_generate_router` 在前端零调用（BL-14）。

**更正第 2 轮记录**：
- N-11 中 `test_aprocess_silent_audio_returns_success_with_empty_subtitles` 的失败**不是**产品侧 ASR 等待超时：夹具只排入一帧，被服务的握手确认读取消费，最终 `recv` 触发假 WebSocket 超时（*[实测]* 先排入确认帧即通过）。
- 第 1 轮总结「空格不会被聚焦的片段 / 按钮抢走」与代码相反（TL2-13）。
- 第 2 轮附录 B「`setCameraMotionAction` 锁定轨拒绝」在 store 层不成立（TL3-06）。
- 第 2 轮附录 A N-20（`compose_storyboard` 不检查锁定轨）经核查不可达：分镜从不选择锁定轨，且 Agent 执行期间锁定切换被编辑锁阻止——关闭。

**实测环境与限制**：本机 anaconda Python 的 `cv2` 因 `opencv-python` 与 `-headless` 同时安装而无法导入；后端探针以隔离目录 `opencv-python-headless==4.11.0.86` 经 `PYTHONPATH` 加载或以桩替代 cv2，未修改全局环境。
AM2-04 断开探针使用打包内的 `desktop/build/python`（fastapi 0.104.1 / starlette 0.27.0 / uvicorn 0.24.0）。本机网络为 fake-ip DNS（外部域名解析到 198.18.x），这正是 N-11 / N-14 失败的触发条件之一。

**基线（第 2 轮提交节点 RC2.3 实测，`e06dca4`）**：`tsc --noEmit` 0 error；`npm run lint` 6 个 error（均位于未触及文件：`AudioSearchModal` / `ImageSearchModal` / `VideoSearchModal` 各 1、`ImageUploadInput` 1、`WatermarkRemovalModal` 2）；
`vitest run` **277 个文件 / 2318 个用例 / 0 失败**；后端第 2 轮门禁 21 个文件 **259 passed / 7 failed**（7 个均为 N-11 基线失败）；`npm run build` Compiled successfully。
第 2 轮 §7.3 桌面端走查 1～23 条**从未执行**（条件 C-7 未满足），本轮 §7.3 把它们与本轮条目合并为必做项。

---

## 1. 概述

前两轮把「时间轴写入」与「导出画面合成」两条主干修稳了：第 1 轮建立外部写入可撤销（S1）、同步历史捕获（S2）、快捷键归属（S3）、Agent 编辑锁（S4）；
第 2 轮建立渲染判定单一来源（S5）、画布合成（S6）、降级上报（S7）、写入即稳定（S8）、编辑锁全覆盖（S9）、素材身份与引用（S10），并修复了 66 个数据丢失、所见非所得与静默失败问题。
本轮是循环的最后一轮。我们先在 `e06dca4` 上逐条复核第 2 轮附录 A 的 48 个遗留项，再对第 2 轮新写的约 150 个文件做系统排查，共确认 **91 个问题**（遗留 48 项中 47 项仍存在、1 项不可达；新发现 44 项），其中 87 项纳入本轮。

最严重的几类问题：**数据丢失**——任一片段触发水合修复时，聚合根本来可以接受的条目（旧版本 Agent 写入的 `clipEnd = 0` 图片、零时长条目等）被当作「无效条目」删除，且不留备份（DS3-01，P0）；在素材库删除的素材在 Agent 添加任意素材后原样回来；「清空全部素材」让所有片段失联且无法撤销；
切段中间一段失败时文件被挂到错误的占位素材上。**预览不是成片**——与项目画幅不同的视频在预览中被拉伸 3 倍；每张图片在预览中被画两次，不透明的 DOM 副本遮住字幕、不透明度与运镜；
字幕在预览中大 3 倍、`upper-3/4` 与 `lower-3/4` 都画在底部、CJK 不换行；预览的音量滑块与静音按钮完全无效；音量超过 100% 在预览中听不出；锁定轨图片可以拖动，被拒绝的位置仍进入导出；手机竖拍视频导出被压扁。
**长任务失控**——超过约 100–250 个片段的时间轴导出吃掉 16 GB 内存，约 300 个片段在 Windows 上因命令行超长整单失败；同源切段把整个源文件复制几十份写满临时盘；导出无法取消、10 分钟后客户端放弃而后端继续编码；成片永不清理。
**Agent 不可信**——SSE 事件的结束空行落在下一个网络块时整条工具结果被丢弃，客户端时间轴与服务端分叉；401 / 429 / 上下文超长全部被报告为「模型返回空内容」；对话 10 轮后请求体超过 50 万字符、约 30 轮触及上下文上限；
看门狗之后才结束的步骤会把新一轮对话整段抹掉。**编辑不可预期**——把长片段拖到最前面松手后却排在第二；拖回原位、整理整齐的时间轴、未改变的音量都会写入撤销记录并清空重做栈；锁定 / 显示切换进入历史；
Agent 执行时已打开的弹窗整体冻结且遮罩可被点穿。**交互与可访问性**——Ctrl+滚轮缩放不锚定光标且 `preventDefault` 无效；键盘聚焦的按钮上按空格触发播放；按住空格每秒切换 30 次；工具栏按钮没有可见焦点环、提示从不显示；
Agent 界面在中文环境显示英文、撤销菜单无法用键盘操作。

本轮新增六个共享机制收敛同类问题：
**S11 输出帧坐标单一来源**（预览以「输出帧矩形 + 成片像素排版」绘制视频、图片与字幕，前后端共用黄金用例）；
**S12 无变化不入历史**（历史记录在捕获后态时比较轨道，未变化即撤回并恢复重做分支；锁定 / 静音 / 显示是视图标志，不入历史、撤销不回滚）；
**S13 拒绝即回滚所有者**（任何被 store 拒绝的提交都把所有者状态回写为 store 状态并说明原因，杜绝「预览 / 导出 / 保存与 store 分叉」）；
**S14 Agent 事件流完整性**（SSE 解析跨块保持状态、错误带错误码且先于取消发送、无活动超时语义统一、退役轮次只按 id 写回自身消息）；
**S15 长任务阶段化进度与取消**（导出与 AI 混剪有阶段、有停滞超时、可取消，后端在阶段边界或客户端断开时停止）；
**S16 鼠标手势生命周期**（文档级鼠标手势统一处理失焦、主键丢失与卸载清理）。
交互层面继续遵循「破坏性操作先确认并说明后果、长任务可见可取消、失败必可见且可读、全部文案双语、键盘与屏幕阅读器可达」。
整体延后的 4 项（分离音频联动模型、图片轨自由定位、浏览器调试路径卸载刷写、胶片带随素材替换刷新）与 11 项子项（真正终止 ffmpeg 进程、流式下载、主题色全局透明度迁移等）属于产品模型变更、调试路径或需要整体视觉走查的新基础设施，写入附录 A 并给出后续设计要点。

---

## 2. 缺陷清单（本轮范围，87 项）

严重度定义：**P0** = 用户数据丢失 / 时间轴损坏 / 渲染进程崩溃；**P1** = 用户可遇到的错误剪辑结果、导出与预览不一致、功能不可用或资源耗尽；
**P2** = 边界场景 / 可用性 / 可访问性 / 测试与代码债务。「来源」列：`R2-A` = 第 2 轮附录 A 遗留项；`新` = 本轮新发现。

### 2.1 预览 ⇄ 导出一致（PV，8 项）

| ID | 级别 | 来源 | 标题 | 设计 |
|---|---|---|---|---|
| PV3-01 | P1 | 新 *[实测]* | 预览按项目画幅拉伸异画幅视频（竖屏素材在 16:9 项目中横向拉伸 3.16 倍），导出为补边 | §3.3 |
| PV3-02 | P1 | 新 | 每张图片在预览中被画两次：不透明 DOM 副本遮住字幕、不透明度与静态图运镜 | §3.3 |
| PV3-03 | P1 | 新 | 预览音量滑块与静音按钮无效 | §3.3 |
| PV3-04 | P1 | 新 | 锁定轨图片可拖动；被拒绝的位置仍进入预览、导出与 uiState | §3.3 |
| N-18 | P2 | R2-A | 图片拖动中 Agent 获得编辑锁，预览与导出停在拖动位置（与 PV3-04 同修） | §3.3 |
| EXO-09 | P1 | R2-A *[实测]* | 字幕字号（预览大 3 倍）、位置（`upper-3/4 / lower-3/4` 画在底部）、换行（CJK 不换行）预览与导出不一致 | §3.3 |
| ME-06 | P1 | R2-A *[实测]* | 音量 >100% 在预览中听不出，导出按最高 2 倍生效 | §3.3 |
| N-06 | P2 | R2-A | 播放头可停在预览终点之后（黑屏、「00:15 / 00:10」、进度 150%） | §3.3 |

### 2.2 导出流程（EX，15 项）

| ID | 级别 | 来源 | 标题 | 设计 |
|---|---|---|---|---|
| EX3-01 | P1 | 新 *[实测]* | 带旋转元数据的竖拍视频导出被压扁 / 拉伸 | §3.4 |
| EX3-02 | P1 | 新 *[实测]* | 无容器时长的 WebM / 录屏无法导出（负帧数 → 裁剪参数无效，且重试 4 次） | §3.4 |
| EX3-03 | P1 | 新 *[实测]* | 同源切段的每个片段把整个源文件复制到临时目录（2 GB × 30 段 = 58 GB） | §3.4 |
| EX3-04 | P1 | 新 *[实测]* | 约 300 个片段在 Windows 上超出 32767 字符命令行上限，音频合流 / 画布合成整单失败 | §3.4 |
| N-04 | P1 | R2-A *[实测]* | 每个片段一个 ffmpeg 输入：241 输入峰值 16.4 GB / 4342 线程（真实内存耗尽） | §3.4 |
| N-14 | P1 | R2-A *[实测]* | 内嵌原声提取重新解析远程地址（已缓存素材导出无声）；请求守卫对从不访问的视频地址做 DNS 校验 | §3.4 |
| EX3-05 | P2 | 新 *[实测]* | 一张无法解码的图片让所有图片叠加一起丢失 | §3.4 |
| EX3-06 | P2 | 新 | 已完成导出的成片（在安装目录下）与请求体永不清理 | §3.4 |
| EX3-07 | P2 | 新 *[实测]* | `videoExportItems.ts` 含原始 NUL 字节，git 视其为二进制、评审看不到差异 | §3.4 |
| EX3-08 | P2 | 新 *[实测]* | 异步导出失败显示后端英文原文、从不点名失败片段 | §3.4 |
| EXO-07 | P2 | R2-A | 导出 10 分钟按次数硬上限、排队计入、进度停在 88.5%、无取消入口 | §3.4 |
| EXO-14 | P2 | R2-A | 导出会话随编辑器卸载丢失、可重复导出、下载失败仍显示成功、重复兜底下载 | §3.4 |
| N-11 | P2 | R2-A *[实测]* | 7 个基线即失败的后端用例（含 `_download_video*` 死代码与错误的 ASR 诊断） | §3.4 |
| N-15 | P2 | R2-A *[实测]* | 字幕烧录：路径含撇号整批降级、日文 / 韩文选拉丁字体且不换行、日志字形 | §3.4 |
| N-16 | P2 | R2-A *[实测]* | 11 个基线即失败的旧字幕测试 | §3.4 |

### 2.3 时间轴核心（TL，12 项）

| ID | 级别 | 来源 | 标题 | 设计 |
|---|---|---|---|---|
| TL3-01 | P1 | 新 *[实测]* | 把片段拖到磁性轨最前面，松手后排在第二（预览与结果矛盾） | §3.5 |
| TL3-02 | P2 | 新 *[实测]* | 不改变内容的编辑写入撤销记录并清空重做栈（弹回的拖动、整理、未变化的音量等） | §3.5 |
| TL3-03 | P2 | 新 *[实测]* | 字幕左边缘无法向前拖 | §3.5 |
| TL3-04 | P2 | 新 *[实测]* | 手动移动 / 裁剪字幕产生重叠字幕 | §3.5 |
| TL3-05 | P2 | 新 *[实测]* | 剪切工具点击隐藏轨上的片段静默无效 | §3.5 |
| TL3-06 | P2 | 新 *[实测]* | `setCameraMotionAction` 在 store 层不检查轨道锁 | §3.5 |
| TL2-05 | P2 | R2-A *[实测]* | 无裁剪信息的旧条目左边缘裁剪裁错端 | §3.5 |
| TL2-22 | P2 | R2-A | Ctrl+C 复制后副本不被选中（无声副本部分随 TL2-01 延后） | §3.5 |
| ME-11 | P2 | R2-A *[实测]* | 时长未知的视频上轨固定 5 s 且无法拉长 | §3.5 |
| ME-12 | P2 | R2-A *[实测]* | 轨道头无静音按钮；锁定 / 显示切换进入撤销历史并清空重做栈 | §3.5 |
| N-01 | P2 | R2-A | 片段素材缺失时时间轴无任何标记 | §3.5 |
| N-17 | P2 | R2-A | `DragCalculationService` 死代码与重复类型导出 | §3.5 |

### 2.4 时间轴交互、键盘与可访问性（UI，24 项）

| ID | 级别 | 来源 | 标题 | 设计 |
|---|---|---|---|---|
| N-12 | P1 | R2-A | Agent 执行时 `inert` 冻结已打开的弹窗（取消 / 关闭不可用，遮罩可被点穿） | §3.6 |
| TL2-07 | P2 | R2-A *[实测]* | Ctrl+滚轮缩放不以光标为锚点、`preventDefault` 无效、触控板捏合过快 | §3.6 |
| TL2-08 | P2 | R2-A *[实测]* | 点击轨道空白处无法取消选择 | §3.6 |
| TL2-10 | P2 | R2-A *[实测]* | 音量滑块拖动中按 Esc 仍提交；卸载后监听残留 | §3.6 |
| TL2-11 | P2 | R2-A *[实测]* | 句子分段条忽略 `clipStart`（切分后显示错位）；「句」硬编码 | §3.6 |
| TL2-12 | P2 | R2-A *[实测]* | 工具栏状态恒为「选择」、剪切无 `aria-pressed`、标尺右键跳转且不聚焦 | §3.6 |
| TL2-13 | P2 | R2-A *[实测]* | 键盘聚焦的按钮上按空格触发播放而非激活按钮 | §3.6 |
| TL2-14 | P2 | R2-A *[实测]* | 主题色透明度修饰不生成样式（工具栏无可见焦点环）——范围化修复 | §3.6 |
| TL2-24 | P2 | R2-A | 播放时视图不跟随播放头；拖拽中滚动使片段脱离光标 | §3.6 |
| N-02 | P2 | R2-A | 图片叠加无法用键盘选中与微调 | §3.6 |
| UI3-01 | P2 | 新 *[实测]* | 音量浮层中的手势会平移时间轴 | §3.6 |
| UI3-02 | P2 | 新 *[实测]* | 关闭音量浮层后焦点掉到 `<body>` | §3.6 |
| UI3-03 | P2 | 新 *[实测]* | 片段根节点吞掉内部按钮（运镜徽标、重试）的键盘激活 | §3.6 |
| UI3-04 | P2 | 新 *[实测]* | 行内字幕编辑器中按下即拖动片段、双击单词丢失输入 | §3.6 |
| UI3-05 | P2 | 新 | 工具栏提示被 `overflow: hidden` 裁掉从不显示；与原生 `title` 重复 | §3.6 |
| UI3-06 | P2 | 新 *[实测]* | 窗口失焦后鼠标手势仍在进行（未按键也在平移）→ S16 | §3.6 |
| UI3-07 | P2 | 新 *[实测]* | `onClose` 引用变化时 Modal 抢走焦点（运镜参数输入丢键）；原生 `window.confirm` | §3.6 |
| UI3-08 | P2 | 新 | 确认框层级低于 Agent 浮窗；默认按钮文案为中文 | §3.6 |
| UI3-09 | P2 | 新 | `hsl()` 包裹十六进制变量：时间轴滚动条滑块与边缘渐隐不可见 | §3.6 |
| UI3-10 | P2 | 新 | 横向滚动时轨道头（名称、锁定、音量）滚出视口 | §3.6 |
| UI3-11 | P2 | 新 | 按住空格按键盘重复速率切换播放 | §3.6 |
| UI3-12 | P2 | 新 | store `isPlaying` 从不写入，标尺「播放中」从不显示 | §3.6 |
| UI3-13 | P2 | 新 | 片段拖拽中按 Esc 同时清空选区 | §3.6 |
| UI3-14 | P2 | 新 | 时间轴面板根节点是无标签、不可见的 Tab 停靠点 | §3.6 |

### 2.5 剪辑 Agent（AG，17 项）

| ID | 级别 | 来源 | 标题 | 设计 |
|---|---|---|---|---|
| AG3-01 | P1 | 新 *[实测]* | SSE 事件的结束空行落在下一网络块时整条事件被丢弃，客户端与服务端时间轴分叉 | §3.7 |
| AG3-03 | P1 | 新 *[实测]* | 401 / 429 / 上下文超长被报告为「模型返回空内容，可能不支持工具调用」 | §3.7 |
| AG3-05 | P1 | 新 *[实测]* | 看门狗之后才结束的步骤整段覆盖新一轮对话 | §3.7 |
| AG2-13 | P1 | R2-A *[实测]* | 对话历史无预算：10 轮请求体 538k 字符、约 30 轮触及上下文上限 | §3.7 |
| AG3-02 | P2 | 新 *[实测]* | 服务端无活动超时的错误从未到达客户端，且本轮被记为「用户停止」 | §3.7 |
| AG3-04 | P2 | 新 *[实测]* | 终态错误卡片上的「取消」把已结束的一轮封口为「用户停止」 | §3.7 |
| AG3-06 | P2 | 新 *[实测]* | 撤销单步菜单列出未改变时间轴的步骤，点击报错 | §3.7 |
| AG2-03 | P2 | R2-A | `get_timeline` 缺类型、字幕文本、分离标记、转场、可见性 | §3.7 |
| AG2-04 | P2 | R2-A *[实测]* | 默认时间轴两处定义；从空时间轴开始的一轮无法整轮撤销 | §3.7 |
| AG2-05 | P2 | R2-A *[实测]* | 单步撤销只对最近一轮有效 | §3.7 |
| AG2-17 | P2 | R2-A | 只有工具调用、没有文字的轮次不显示「撤销本轮」 | §3.7 |
| AG2-18 | P2 | R2-A *[实测]* | 字幕 / 锁定轨上无法修复的重叠让每次编辑都带警告（模型陷入循环） | §3.7 |
| AG2-20 | P2 | R2-A | Agent 界面硬编码英文、撤销菜单无法键盘操作、同名步骤无法区分 | §3.7 |
| AG2-21 | P2 | R2-A | 客户端 30 分钟绝对超时切断工具持续活跃的长任务 | §3.7 |
| N-10 | P2 | R2-A *[实测]* | Agent 删除 / 裁剪 / 调整时长后不贴紧（违反 S8），不回报被移动的片段 | §3.7 |
| N-19 | P2 | R2-A | `add_clip.material` 类型缺播放快照字段（强转） | §3.7 |
| N-21 | P2 | R2-A *[实测]* | 看门狗超时后卡住的消息保持 streaming（与 AG3-05 同修） | §3.7 |

### 2.6 AI 混剪、自动混剪与数据安全（AM / DS，11 项）

| ID | 级别 | 来源 | 标题 | 设计 |
|---|---|---|---|---|
| DS3-01 | **P0** | 新 *[实测]* | 另一片段触发水合修复时，聚合根可接受的条目（旧版 Agent 图片 `clipEnd = 0`、零时长条目等）被永久删除，且不留备份 | §3.8 |
| DS3-02 | P1 | 新 *[实测]* | 在素材库删除的素材，Agent 一添加任意素材就回来 | §3.8 |
| DS3-03 | P1 | 新 | 「清空全部素材」让所有片段失联，导出被拒且无法撤销 | §3.8 |
| DS3-04 | P1 | 新 | 切段中一段失败时文件被挂到错误占位，另一占位永远「上传中」 | §3.8 |
| AM3-01 | P2 | 新 *[实测]* | 纯视频自动混剪把「没有匹配视频」报告为「尚无配音」 | §3.8 |
| AM3-02 | P2 | 新 | 导入阶段本地服务断开 / 超时被提示为「方案无法应用」 | §3.8 |
| AM2-04 | P2 | R2-A *[实测]* | AI 混剪取消只中止浏览器请求，后端 LLM 与视频解析继续运行 | §3.8 |
| BL-14 | P2 | R2-A | 无调用方的 `AIVideoGenerateService` 仍挂载（绕过模型设置、音量口径矛盾） | §3.8 |
| N-07 | P2 | R2-A | 没有从 `timelineRecoveryBackup` 恢复时间轴的入口 | §3.8 |
| N-08 | P2 | R2-A | 素材删除的后端清理失败只记日志 | §3.8 |
| N-13 | P2 | R2-A *[实测]* | 切段 / 静音移除得到的素材继承原片脚本段归属，顶替原片或被报告为过期 | §3.8 |

**合计**：P0×1、P1×21、P2×65，共 87 项（PV 8 / EX 15 / TL 12 / UI 24 / AG 17 / AM·DS 11）。

---

## 3. 技术设计

### 3.1 现状链路与问题定位

本轮缺陷分布在六条链路上。下图给出每条链路的关键调用顺序与本轮修改点（`★` 为缺陷所在）：

```
① 预览链路（S11 / S13）
  timeline store ──► TimelinePanel.onTimelineStateChange ──► VEI.currentTimelineState（所有者）
      │                                                        │
      └─► useTimelineComposition（S5 renderEnd） ──► useCompositionPlayback ──► MultiTrackPlaybackEngine
                                                                              ├─► VideoSourcePool / AudioSyncPool ★PV3-03 主音量 ★ME-06 >100%
                                                                              └─► CanvasCompositor ★PV3-01 帧矩形 ★EXO-09 字幕排版
  VideoPlayerPanel ─► ImageOverlay（DOM 手柄）★PV3-02 双绘 ★PV3-04 锁定轨 ─► VEI.handleImagePositionConfirm ★N-18 拒绝不回滚

② 导出链路（S15）
  useVideoExport ─► planVideoExport ─► POST /api/video-compose ─► video_router.compose ─► VideoCompositionService.start
      ─► [queued ★EXO-07] ─► resolve ★N-14 ─► 同源复制 ★EX3-03 ─► normalize ★EX3-01 旋转 ★EX3-02 无时长
      ─► canvas compose ★N-04 输入数 ★EX3-04 命令行 ─► audio mix ★EX3-04 ─► overlays ★EX3-05 ─► subtitles ★N-15
      ─► composed_{id}.mp4 ★EX3-06 永不清理
  客户端 pollCompositionStatus ★EXO-07 次数上限 ─► downloadComposedVideo ★EXO-14 ─► 失败文案 ★EX3-08

③ 时间轴编辑与历史（S12）
  UI 手势 ─► dragSlice / *Action ─► recordAction（无条件）★TL3-02 ─► aggregate 变更 ─► autoOrganize ─► captureNextState
      moveItem 稳定排序 ★TL3-01 ；字幕轨无规则 ★TL3-03/04 ；轨道标志入历史 ★ME-12 ；restore 整体替换标志 ★ME-12

④ 时间轴交互（S16）
  TrackContainer / TimelineRuler / VolumeSlider 文档级鼠标监听 ★UI3-06 ；React onWheel 被动 ★TL2-07 ；
  VEI 全局空格 ★TL2-13/UI3-11 ；inert 包住面板内弹窗 ★N-12

⑤ Agent 链路（S14）
  useAgentExecution.sendAgentMessage ─► POST /api/video-editing-agent/chat ─► agent.ts（pi-agent-core + tools）
      ─► SSE ─► SSEStreamManager.parseSSEBuffer ★AG3-01 ─► AgentEventRouter ─► OperationApplier ─► replaceTimelineAction('agent')
      message_end ★AG3-03 ；route 看门狗 ★AG3-02 ；finishing 看门狗 ★AG3-05/N-21 ；历史重放 ★AG2-13

⑥ 素材与项目数据
  useMaterialManagement（React 状态）◄─ 单向合并 ★DS3-02 ─ useVideoEditingStore ◄─ Agent
  clearAll ★DS3-03 ；VEI 切段按下标配对 ★DS3-04 ；hydrateTimeline ─► repairTimelineData ★DS3-01 ─► timelineRecoveryBackup（无入口 ★N-07）
  AI 混剪 cancel ─► BFF 不转发中止 ─► 后端不感知断开 ★AM2-04
```

### 3.2 共享机制（先落地，后续条目依赖）

#### S11 输出帧坐标单一来源

**不变量**：预览中所有图层都以「输出帧」为坐标系绘制——输出帧矩形 = 画布内按项目画幅 contain 的矩形（与视频是否就绪无关）；视频在帧内按**自身**宽高比 contain；图片按帧的相对坐标；
字幕按**成片像素**排版（与 `subtitle_service` 同一套换行、行高、块位置规则），再按 `frame.height / outputHeight` 缩放绘制。

**组成**：`fitContain.outputFrameRect / fitSourceInFrame`（PV3-01）；`lib/subtitleLayout.ts`（EXO-09，与 `video_scaling._ASPECT_RATIO_MAP`、`SubtitleDrawStyle` 默认值逐项一致）；
黄金用例 `backend-services/basic-service/tests/fixtures/subtitle_layout_golden.json` 由 TS 与 Python 测试同时读取——任何一侧改排版规则都会让另一侧用例失败。PV3-02 让画布成为图片的唯一可见栅格。

**使用方**：PV3-01、PV3-02、EXO-09、N-15（前端 `containsCjk` 同步假名 / 谚文）。

#### S12 无变化不入历史；视图标志不入历史

**不变量 1**：一次历史记录（`recordAction` … `captureNextState`）若轨道内容前后相同，则撤回该记录并恢复它截断的重做分支与被 `MAX_HISTORY` 挤掉的旧记录——用户看到的撤销 / 重做栈与「什么都没做」完全相同。
**不变量 2**：轨道的 `isLocked / isMuted / isVisible` 是视图与保护标志：切换不入历史；撤销 / 重做恢复内容时保留这些标志的现值；外部整轴写入（`replaceTimelineAction`，包括「撤销 Agent 本轮」的 `'agent-undo'`）同样保留同 id 轨道的现值，只有 `'import'`（JSON 导入、N-07 恢复备份）按写入数据中的标志生效（v2 评审 RV3-05）。

**组成**：`HistoryService.discardLastAction`、`historySlice.captureNextState` 的比较、`snapshotEquality.tracksEqual`（与 `replaceTimelineAction` 共用，删除重复实现）、`TimelineAggregate.restore` 的标志保留、`Track.applyViewFlags`、`trackViewFlags.VIEW_FLAG_KEYS / carryViewFlags`（由 `restore`、`replaceTimelineAction` 与 Agent 补丁冲突比较共用，RV3-05）。

**使用方**：TL3-02、ME-12、TL2-10（取消的音量手势不写历史）、TL3-01（序号不变不写历史）、TL3-04（钳制后不变不写历史）。所有新增的「提交型」action 必须经 `captureNextState`，不得自行判断。

#### S13 拒绝即回滚所有者

**不变量**：UI 在手势过程中写入所有者（VEI `currentTimelineState`）或本地预览的值，若最终提交被 store 拒绝（编辑锁、轨道锁、条目消失），必须在同一事件循环内把所有者与预览回写为 store 的当前值，并以一句可读的原因提示（缺失条目除外）。
「预览 / 导出 / 自动保存读到的值」永远等于 store 值或正在进行的手势值，不存在第三种状态。

**组成**：`updateItemFields.imageEditBlocker`、`lib/imagePositionCommit.resolveImagePositionCommit`、`ImageOverlay.readOnly`；第 2 轮 RV-03 的「外部同步被拒后回写」与 RC2-12「自动适配仅在接受时写本地」是同一原则的既有实例。

**使用方**：PV3-04、N-18、N-02（键盘微调提交经同一判定）、TL2-10（取消的音量手势回写预览前的值）。

#### S14 Agent 事件流完整性

**不变量**：
1. 服务端发出的每个完整 SSE 事件都恰好投递一次（与网络分块无关）；
2. 任何导致一轮终止的原因（服务错误、服务端超时、客户端停止）都以**带错误码**的事件或明确的取消原因到达客户端，且错误先于 `cancelled`；只有用户主动停止才记为「用户停止」；
3. 超时语义两端一致：以「无活动」计时，另设硬上限；
4. 一轮一旦被新一轮取代（退役），其迟到写入只能按消息 id 更新自身消息，永远不能整体替换对话。

**组成**：`SSEStreamManager` 跨块解析状态（AG3-01）、`formatProviderError` 与 `AgentStreamErrorCode`（AG3-03）、路由看门狗发送顺序与 `markCancelled({ byUser })`（AG3-02）、`idleTimeoutMs / maxDurationMs`（AG2-21）、`retired` 轮次与按 id 写回（AG3-05 / N-21）、`sealMessage` 的活跃流守卫（AG3-04）。

#### S15 长任务阶段化进度与取消

**不变量**：每个超过数秒的后端任务都有 (a) 可见的阶段；(b) 以「无进展」计时的客户端超时（进展 = 阶段、进度或底层 ffmpeg 活动任一变化，v2 评审 RV3-02），排队不计时；(c) 用户取消入口；(d) 后端在取消或客户端断开后的下一个阶段边界（或下一个 await）停止工作并清理中间文件。

**组成**：导出——状态字典 `stage`、阶段内细粒度 `progress`、长 ffmpeg 命令的 `-progress` 活动心跳 `activity_at`（RV3-02）、`pollCompositionStatus({ stallTimeoutMs, signal })`、`POST /api/video/compose/{id}/cancel` + `threading.Event` 阶段检查（EXO-07）、导出会话存储（EXO-14）；
AI 混剪 / 批量解析 / 时间轴导入——`run_until_client_disconnects`（以 `request.receive()` 监听断开）+ BFF `abortOnClientDisconnect`（AM2-04）。

**时序（导出取消）**：
```
用户点「取消导出」
  → useVideoExport: cancelComposition(id)  ──►  BFF /api/video-compose/{id}/cancel  ──►  video_router.cancel → _cancel_events[id].set() → 200 {status:'cancelling'}
  → controller.abort() → pollCompositionStatus 以 AbortError 结束 → endExportSession(taskId) → 关闭弹窗 → showInfo(exportCancelled)
后端工作线程（正在运行的 ffmpeg 子进程照常结束）
  → 下一个检查点 _raise_if_cancelled(id) 抛 CompositionCancelled
  → status: failed / composition_stage: cancelled / error_summary: 'cancelled by user'
  → finally: 删除临时目录与部分输出；_cancel_events.pop(id)
```

#### S16 鼠标手势生命周期

**不变量**：任何挂在 `document / window` 上的鼠标手势监听都由 `lib/mouseGesture.trackMouseGesture` 创建：窗口失焦取消、移动时主键已松开即结束、组件卸载时清理；清理函数幂等。
详细设计见 §3.6 UI3-06。使用方：TrackContainer 拖拽平移（TL2-08 / UI3-01）、TimelineRuler 刮擦（TL2-12）、VolumeSlider 拖动（TL2-10）。片段拖拽已有等价处理，不改。

### 3.3 预览 ⇄ 导出一致（PV 组：PV3-01～PV3-04、EXO-09、ME-06、N-06、N-18）

#### PV3-01 预览按项目画幅拉伸异画幅视频（S11）

**现状**：`playback/internal/fitContain.ts:54` `sourceRatio = input.targetAspectRatio ?? sourceWidth / sourceHeight`——只要传入视口画幅，源视频自身的宽高比就被丢弃；
`CanvasCompositor._drawVideoLayer`（`CanvasCompositor.ts:326-348`）与 `_baseFit`（`:289-305`）总是传 `targetAspectRatio: this._viewport?.aspectRatio`，
而视口恒存在（`useCompositionPlayback.ts:418`、`VideoPlayerPanel.tsx:159-162,184`）。导出按源宽高比缩放后补边（`video_scaling.py:88-120`、`filtergraph_builder.py:213-214`）。
*[实测]* 画布 1600×900、视口 16/9、源 1080×1920：`drawImage(src, 0, 0, 1600, 900)`（横向拉伸 3.16 倍）；导出为 608×1080 居中、`pad_x=656`（画布上应为 x≈546.9、w≈506.3）。
既有用例从不设置视口（`CanvasCompositor.test.ts:103-115`），因此未能发现。

**修复**：

1. `fitContain.ts` 新增两个纯函数，保留 `fitContain` 原签名供其他调用方使用：
   ```ts
   /** 输出帧在画布中的矩形：按项目画幅在画布内 contain（即现 targetAspectRatio 行为）。 */
   export function outputFrameRect(destWidth: number, destHeight: number, targetAspect: number): FitRect;
   /** 源在输出帧内按自身宽高比 contain，结果已加上 frame.x / frame.y 偏移；任一尺寸 ≤ 0 返回零矩形；
    *  源与帧的宽高比之差 < 0.01 时直接返回 frame（与 video_scaling.py:82-84「直接缩放、不补边」一致，v2 评审 RV3-11）。 */
   export function fitSourceInFrame(sourceWidth: number, sourceHeight: number, frame: FitRect): FitRect;
   ```
2. `CanvasCompositor`：
   - 以 `_frameRect(canvas): FitRect` 取代 `_baseFit(layers, canvas)`：`viewport ? outputFrameRect(canvas.width, canvas.height, viewport.aspectRatio) : { x: 0, y: 0, width: canvas.width, height: canvas.height }`，**与视频是否就绪无关**（消除「无就绪视频时叠加层跳位」）。
   - `_drawVideoLayer` 改为 `const frame = this._frameRect(canvas); const content = fitSourceInFrame(videoWidth || frame.width, videoHeight || frame.height, frame);`，绘制到 `content`；运镜分支 `_drawCameraVideoLayer` 同样接收 `content`（与导出「先缩放、后运镜、最后补边」一致，`video_scaling.py:136-160`）。
   - 图片层、字幕层一律使用 `frame`；黑底仍整画布填充。
   - `drawFrame`（`:191`）及其单行字幕路径 `_drawSubtitle`（`:795,826`）在生产代码中没有调用方（只有测试使用），**不改**；死代码清理记入附录 A「评审补充」PV3-01b（v2 评审 RV3-11）。
3. 不改导出。

**回归测试**：`src/components/video/playback/__tests__/CanvasCompositor.frameFit.test.ts`
「draws a portrait source pillarboxed inside a 16:9 output frame」「positions image layers against the output frame when no video layer is ready」；
`playback/internal/__tests__/fitContain.test.ts` 追加「fitSourceInFrame contains the source inside an offset frame」「a source within 0.01 of the frame ratio fills the frame like export」。

#### PV3-02 图片在预览中被画两次：不透明 DOM 副本遮住不透明度、静态图运镜与字幕

**现状**：`VideoPlayerPanel/ImageOverlay.tsx:289-297` 为**每一张**活动图片渲染完整、不透明、无运镜的 `<img object-contain>`，`zIndex ≥ 10`（`:272-277`），
压在 `PreviewCanvas`（`zIndex: 2`，`VideoPlayerPanel.tsx:553-561`）之上；而画布已按不透明度与运镜绘制同一张图（`CanvasCompositor.ts:528-559`），并把字幕画在图片之上（`assembleLayers.ts:199-210`）。
导出在图片叠加链之后烧录字幕。结果：默认图片（0.1–0.9 高度）遮住默认字幕（预览 0.853 高度处）；静态图运镜在预览中不动；不透明度 0.3 的图片在预览中完全不透明；Agent 执行期间手柄隐藏，预览观感突变。
历史诊断 `docs/diagnoses/image-overlay-drag-ghost-duplicate/analysis.md:41,168` 已记录双绘，但未修复。

**修复**：

1. `ImageOverlay.tsx` 的 `<img>` 增加 `className="… opacity-0"` 与 `aria-hidden="true"`：保留元素以维持 `naturalSize` / `onLoad`（自动适配尺寸依赖它），边框与手柄照常可见——画布成为唯一可见的图片栅格。
2. **加载后重绘**（原先由 DOM 副本掩盖：暂停状态下新加图片加载完成后画布不会重绘）：
   - `CanvasCompositor` 新增 `onAssetReady(cb: () => void): () => void`；`_loadImage` 设置 `img.onload = () => this._assetReadyListeners.forEach((l) => l())`；`detach()` 清空监听。
   - `MultiTrackPlaybackEngine.attach` 订阅：非播放状态下调用 `this._renderAt(this._lastRenderComp, false)`；`dispose()` 退订。
3. **图片来源与导出一致**：`useCompositionPlayback.buildImageOverlayInputs`（`:162-190`）与 `VideoPlayerPanel/imageOverlays.selectActiveImageOverlays`（`:52-90`）改为
   `toAbsolutePlaybackUrl(selectPlaybackUrl(material, { purpose: 'export' })) || material.url`（本地缓存优先，与导出发送的引用一致）。
4. `_loadImage` 在设置了 `crossOrigin` 且 `onerror` 时，去掉 `crossOrigin` 重试一次并替换缓存项（2D 绘制仍可用；3D 路径对被污染的图片已降级，`captureFrame` 已捕获异常）。

**回归测试**：`VideoPlayerPanel/__tests__/ImageOverlay.interaction.test.tsx` 追加「handle image is invisible so the canvas raster is the only visible copy」；
`playback/__tests__/MultiTrackPlaybackEngine.imageLoadRepaint.test.ts`「repaints once when an image finishes loading while paused」；
`hooks/__tests__/useCompositionPlayback.imageSource.test.ts`「image overlay input prefers the same-origin local reference export uses」。

#### PV3-03 预览音量滑块与静音按钮无效

**现状**：`usePreviewTransport.ts:30,57-59` 只保存 `masterVolume`；`VideoPlayerPanel.tsx:82,356-366,419,672-703` 仅用于 UI；
`useCompositionPlayback` 不接收音量（`:222-244`），音频组固定 `volume: 1`（`:136`）；`VideoSourcePool.ts:389,394` 与 `AudioSyncPool.ts:323-333` 每帧以片段音量覆盖 `el.volume`。
播放中点击静音或把滑块拖到 0，声音照常。根因：合成器重构遗漏了主音量链路。

**修复**：

1. `useCompositionPlayback` 新增选项 `masterVolume: number`（[0, 1]），存入 ref，变化不重新 attach。
2. `buildAudioSyncGroups(seqs, masterVolume = 1)` 以 `volume: masterVolume` 构造音频组（`computeAudioSyncActions` 已按「片段 × 组」相乘）。
3. `playback/types.ts` `VideoTrackGroup` 增加 `volumeScale?: number`，由 facade 的 `getVideoTrackGroups` 从 ref 填入；`computeSourcePlan` 中
   `desiredVolume = (clip.volume ?? 1) * (group.volumeScale ?? 1)`（与 ME-06 合并后交给 `applyVolume`，钳制在 ME-06 中处理）。
4. `VideoPlayerPanel` 把 `volume` 传给 `useCompositionPlayback`。
5. 不使用旧的 `effectiveVolume`（`VideoEditingInterface.tsx:530`，会重复乘轨道音量）。主音量只影响监听，不进入导出与项目数据。

**回归测试**：`hooks/__tests__/useCompositionPlayback.test.tsx`「audio sync groups carry the preview master volume」；
`playback/__tests__/VideoSourcePool.test.ts`「desiredVolume scales clip volume by the group master volume」；
`playback/__tests__/MultiTrackPlaybackEngine.test.ts`「master volume 0 silences every preview element」。

#### PV3-04 + N-18 锁定轨图片可拖动、被拒绝的位置仍进入预览 / 导出 / uiState（S13）

**现状**：
- 手柄不看 `track.isLocked`（`imageOverlays.ts:61-63`；`VideoPlayerPanel.tsx:312-313` 只看 Agent 锁）。
- 拖动过程把实时位置写入所有者 `currentTimelineState`（`VideoEditingInterface.tsx:1846-1875`）；确认时 `updateItemFields.ts:22-27,65-66` 返回 `false`，
  锁定轨无任何提示（`VideoEditingInterface.tsx:1877-1885`），Agent 锁仅提示、不回滚。
- 导出读所有者状态（`useVideoExport.ts:229,248`；`VideoEditingInterface.tsx:2242`），自动保存写 `uiState`（`:271`）。
- `TimelinePanel.resyncOwnerFromStore`（`:223-228`）只在外部同步路径调用（`:396,412`），store 只在形状变化时通知（`:339-363`）。

复现：锁定 `image-track-1` → 拖动其图片 → 预览显示新位置，导出成片也是新位置；store 与撤销栈无记录，下一次 store 变化静默弹回。N-18：拖动中 Agent 获得锁 → 卸载提交被拒 → 预览与导出停在拖动位置；若本轮 Agent 未改时间轴，分叉一直持续。

**修复（S13「拒绝即回滚所有者」的第一个应用点）**：

1. `store/actions/updateItemFields.ts` 导出
   ```ts
   export type ImageEditBlocker = 'agent-lock' | 'track-locked' | 'missing';
   export function imageEditBlocker(get: () => TimelineStore, itemId: string): ImageEditBlocker | null;
   export function readImagePosition(get: () => TimelineStore, itemId: string): ImagePosition | undefined;  // v2 评审 RV3-08
   ```
   `findEditableItem` 改为基于它实现（既有调用方行为不变）。
2. `imageOverlays.selectActiveImageOverlays` 返回值 `ActiveImageOverlay` 增加 `isLocked: boolean`（`track.isLocked`）；`ImageOverlay` 新增 `readOnly?: boolean`：
   `beginGesture` 直接返回、光标为 `default`、不渲染缩放手柄、边框改为虚线并带 `title={t.timeline.messages.trackLocked}`。
3. 新纯函数 `src/components/video/lib/imagePositionCommit.ts`：
   ```ts
   export type ImagePositionCommit =
     | { kind: 'apply' }
     | { kind: 'ignore' }                                   // 条目已不存在
     | { kind: 'revert'; position: ImagePosition; reason: 'agent-lock' | 'track-locked' };
   export function resolveImagePositionCommit(
     blocker: ImageEditBlocker | null,
     storePosition: ImagePosition | undefined,
   ): ImagePositionCommit;  // storePosition 缺省时 revert 到 DEFAULT_IMAGE_POSITION
   ```
4. `VideoEditingInterface.handleImagePositionConfirm` 改为：`apply` → `updateImagePositionAction(...)`；`ignore` → 返回；
   `revert` → `handleImagePositionChange(itemId, position)`（回写所有者与画布）+ `showWarning(reason === 'agent-lock' ? t.timeline.messages.editLockedByAgent : t.timeline.messages.trackLocked)`。
   `storePosition` 由第 1 步的 `readImagePosition(() => useTimelineStore.getState(), itemId)` 读取。它在 `timeline/store/` 内部访问 `_aggregate`，私有字段不离开 store，与附录 B「`timeline/store/` 之外无 `_aggregate` 访问」一致；只读，A9 不受影响（v2 评审 RV3-08）。
5. `trackLocked` 文案复用既有 key（`i18n.ts` 接口 `:461`、en `:3228`），实现节点确认 zh-CN 存在，缺失则补。

**回归测试**：`src/components/video/lib/__tests__/imagePositionCommit.test.ts`
「a refused confirm on a locked track reverts the owner position to the store value」「an agent-lock refusal mid-gesture reverts the owner position」「a missing item is ignored without a warning」；
`VideoPlayerPanel/__tests__/imageOverlays.test.ts`「overlays on a locked track are returned read-only」。

#### EXO-09 字幕字号、位置、换行在预览与导出间不一致（S11）

**现状 *[实测，两侧]***：预览按设备像素画布排版（`PreviewCanvas.tsx:218-224`）：`SubtitleLayer.ts:76-80` 的 `upper-3/4 / lower-3/4` 落到 0.9（同 bottom）；
`:117-131` 只按空白换行；最大宽 `canvas.width * 0.9`（`MultiTrackPlaybackEngine.ts:91,394`）；`CanvasCompositor.ts:864-902` 行高 1.25·fs、以 `fit.y + fit.height * vAnchor` 底对齐、无描边。
导出按成片像素（`subtitle_service.py:233-268` 每行字数 `int((W-100)/fs)`；`:306-334` CJK 逐字换行；`:849` 行高 fs+5；`:873-883` `_block_start_y`；`:899-913` `borderw=2`、`boxborderw=5`、逐行居中）。

输出 1080×1920（9:16）、预览画布 360×640（DPR 1）、字号 48：

| 位置 | 预览行中心（占高度） | 导出行顶（y / 占高度） |
|---|---|---|
| bottom | 0.853 | 1817 / 0.946 |
| upper-3/4 | **0.853**（同 bottom） | 454 / 0.236 |
| center | 0.453（块底对齐到 0.5） | 933 / 0.486 |
| lower-3/4 | **0.853** | 1414 / 0.736 |
| top | 0.073 | 50 / 0.026 |

字形高度：预览 48/640 = 7.5%，导出 48/1920 = 2.5%（预览大 3 倍，且随 DPR 与窗口大小变化）；40 字 CJK：预览 1 行宽 1920 px 被裁到中间约 7 字，导出折成 2 行各 20 字。

**修复（导出不变，预览对齐导出；S11 的字幕部分）**：

1. 新增 `src/components/video/lib/subtitleLayout.ts`（纯 TS，无 DOM）：
   ```ts
   export interface OutputSize { width: number; height: number }
   /** 与 backend video_scaling._ASPECT_RATIO_MAP（video_scaling.py:20-26）逐项一致；未知 id 回退 16:9（与后端默认一致）。 */
   export const OUTPUT_SIZE_BY_ASPECT: Readonly<Record<string, OutputSize>>;  // 16:9→1920×1080, 9:16→1080×1920, 4:3→1440×1080, 1:1→1080×1080, 21:9→2560×1080
   export function outputSizeForAspect(aspectId: string): OutputSize;
   export const SUBTITLE_MARGIN_PX = 50;       // subtitle_service.SubtitleDrawStyle 默认值
   export const SUBTITLE_LINE_GAP_PX = 5;
   export const SUBTITLE_BORDER_PX = 2;
   export const SUBTITLE_BOX_BORDER_PX = 5;
   export function maxSubtitleChars(outputWidth: number, fontSize: number): number;   // max(1, floor((W - 100) / fs))
   export function containsCjk(text: string): boolean;                                // 与 _contains_chinese 同码位区间；按码位迭代
   export function wrapSubtitleText(text: string, maxChars: number): string[];         // 见下
   export function subtitleBlockTop(position: string, outputHeight: number, blockHeight: number): number;
   export interface SubtitleLineLayout { text: string; topY: number }
   export function layoutSubtitle(
     text: string,
     style: { fontSize: number; position: string },
     output: OutputSize,
   ): { lines: SubtitleLineLayout[]; lineHeight: number };
   ```
   - `wrapSubtitleText`：按 `\n` 分段；空白段产出 `''` 并保留行位；CJK 段（含 N-15 新增的假名 / 谚文判定，见 §3.4 N-15）逐码位换行；其余段按 `split(/\s+/)` 贪心，`current.length + (current ? 1 : 0) + word.length <= max`，超长单词独占一行（与 `_wrap_english_text` 同义）。
   - `subtitleBlockTop`：`top` → 50；`upper-3/4` → `Math.trunc(H * 0.25 - Math.floor(blockH / 2))`；`center` → `Math.floor((H - blockH) / 2)`；
     `lower-3/4` → `Math.trunc(H * 0.75 - Math.floor(blockH / 2))`；其他（bottom / 未知）→ `H - blockH - 50`。与 Python 整数运算逐位一致。
   - `layoutSubtitle`：`lineHeight = fs + 5`；`blockH = lines.length * lineHeight`；`topY = blockTop + index * lineHeight`；文本先 `trim()`（同 `build_drawtext_filters_for_items`，`subtitle_service.py:676`）；空行保留 `topY`、绘制时跳过。
2. `playback/types.ts` 字幕层形状改为 `{ kind: 'subtitle'; id; lines: SubtitleLineLayout[]; style: { fontSize; color; background?; fontFamily }; outputHeight: number; opacity; z }`。
3. 管线：`assembleLayers.buildSubtitleLayers(items, t, output: OutputSize, baseZ)` 取代 `maxWidthPx / measure` 参数（`AssembleLayersInput` 增加 `output`、删除 `subtitleMaxWidthPx / measureSubtitle`）；
   `MultiTrackAttachDeps.outputSize: OutputSize`，`MultiTrackPlaybackEngine._assemble` 传入；`useCompositionPlayback` 新增 `outputSize` 选项（ref 读取）；
   `VideoPlayerPanel` 传 `outputSizeForAspect(selectedAspectRatio.id)`；`PreviewCanvas.measureSubtitle` 与其 handle 字段随之无用，删除。
4. `CanvasCompositor._drawSubtitleLines(ctx, frame, layer)`：`s = frame.height / layer.outputHeight`；`ctx.font = \`${fs * s}px ${fontStack(family)}\``；`textBaseline = 'top'`、`textAlign = 'center'`；
   `x = frame.x + frame.width / 2`、`y = frame.y + topY * s`；有背景时 `w = measureText(line).width`，`fillRect(x - w/2 - 5s, y - 5s, w + 10s, fs*s + 10s)`；
   描边 `lineJoin = 'round'`、`lineWidth = 4s`（drawtext `borderw` 向外扩，canvas 描边居中，故取 2 倍）、`strokeStyle = '#000000'`，先 `strokeText` 再 `fillText`。`frame` 来自 PV3-01 的 `_frameRect`。
5. 字体栈：默认 / sans-serif → `"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif`；serif → `"SimSun","Songti SC","Noto Serif CJK SC",serif`；monospace → `monospace`（与后端 `_get_font_path` 优先顺序一致）。
6. 删除 `SubtitleLayer.wrapText`、`positionToVAnchor` 与 `resolveSubtitleStyle.vAnchor`；排版缓存键改为 `text|fs|position|outW|outH`。
7. 剩余差异（写入模块头注释）：drawtext 的 `y` 是文本框顶、canvas `top` 是 em 框顶，垂直方向最多约 0.1 em；不同字体字形度量不同。
8. `SubtitleEditModal.tsx:300-306,409-415` 是样式色块（字号 ×0.4 / ×0.3），不是位置预览，不改。

**跨语言黄金用例**：新增 `backend-services/basic-service/tests/fixtures/subtitle_layout_golden.json`（5 种位置 × {1080×1920, 1920×1080} × {短拉丁文, 40 字 CJK, 含空行文本}，期望 `lines[].text` 与 `topY`），
由 `src/components/video/lib/__tests__/subtitleLayout.test.ts`（「matches the drawtext layout golden table」「wraps a 40-char CJK line into two 20-char lines at 1080px width and 48px」「places the upper-3/4 block centred at 25% of output height like drawtext」）
与 `backend-services/basic-service/tests/test_subtitle_layout_golden.py`（`test_drawtext_layout_matches_the_shared_golden_table`）同时读取。前端测试以相对路径读取该 JSON（`path.resolve(__dirname, '../../../../../backend-services/basic-service/tests/fixtures/subtitle_layout_golden.json')`）。
另 `playback/__tests__/CanvasCompositor.subtitleScale.test.ts`「subtitle font scales with frame height over output height」；既有 `SubtitleLayer.test.ts`、`assembleLayers.test.ts` 字幕用例按新形状更新。

#### ME-06 音量 >100% 在预览中听不出（WebAudio 增益，限同源）

**现状 *[实测钳制]***：`AudioSyncPool.ts:102-107,134-140,186` `computeMediaElementVolume(2, 1)` 返回 1；`VideoSourcePool.ts:166-171,240,389,394` 片段音量 2 时 `desiredVolume` 为 1；
`effectiveVolume.ts:11,21-32` 上限 2；导出 `-af volume=` 最高按 2 生效。`HTMLMediaElement.volume` 只接受 [0,1]，且无增益级。既有用例 `AudioSyncPool.test.ts:47,60` 钉住了钳制。

**预览元素实际使用的地址**（决定 WebAudio 是否安全）：音频轨取 `CompositionAdapter.selectCanonicalExportReference`（`:90-102,244`）——相对 `/api/storage/files/…` 或 `/api/audio/generated/…`（同源），
未缓存素材为远程 `serverUrl`（跨源），纯 blob 素材为 `''`；视频取 `resolveSequencePlaybackUrl.ts:110-158`——`blob:` 本地代理、同源预览代理、同源本地存储，或远程 `serverUrl / url`。
`/api/storage/files` 由 Next 路由同源提供；媒体元素未设置 `crossOrigin`（`PreviewCanvas.tsx:120-146`）；`desktop/main` 未配置 `autoplayPolicy`。

**修复**：

1. 新增 `src/components/video/playback/audio/PreviewGainRouter.ts`：
   ```ts
   export function splitPreviewVolume(volume: number): { elementVolume: number; gain: number };  // elementVolume=clamp01(v)；gain = v > 1 ? min(v, MAX_EFFECTIVE_VOLUME) : 1
   export function isBoostableSource(src: string, origin: string): boolean;                     // blob: 或 new URL(src, origin).origin === origin
   export type ApplyVolumeOutcome = 'element' | 'boosted' | 'unboostable';
   export class PreviewGainRouter {
     apply(element: HTMLMediaElement, volume: number): ApplyVolumeOutcome;
     isRouted(element: HTMLMediaElement): boolean;
     resume(): Promise<void>;
     dispose(): void;
   }
   ```
   - 每个 `PreviewCanvas` 宿主一个惰性 `AudioContext`；`WeakMap<HTMLMediaElement, { source: MediaElementAudioSourceNode; gain: GainNode }>`。
   - `apply`：未路由元素 `element.volume = elementVolume`；仅当 `gain > 1 + 1e-3`、`ctx.state === 'running'`、`isBoostableSource(element.currentSrc || element.src)` 时路由——
     对该元素**只调用一次** `createMediaElementSource`，连接 `→ GainNode → destination`。**已路由元素**固定 `element.volume = 1`，音量与静音都由增益级承担：`gain.gain.setTargetAtTime(element.muted ? 0 : v, ctx.currentTime, 0.01)`，路由时挂 `volumechange` 监听，`muted` 变化时重算（v2 评审 RV3-20：最终音量，以及分离音频视频元素的静音，都不再依赖 UA 是否在 `MediaElementAudioSourceNode` 之前应用 `volume / muted`）；
     不可增益返回 `'unboostable'`。`typeof AudioContext === 'undefined'`（jsdom）时整体空操作并返回 `'element'`。
   - `resume()` 由播放 effect 调用；`dispose()` 断开全部节点并 `ctx.close()`，在 `PreviewCanvas` 卸载清理（`:251-261`）中调用。
2. 池：`VideoSourcePool` 与 `AudioSyncPool` 不再钳制所携带的值（`TrackSourcePlan.desiredVolume`、`AudioSyncAction.volume` 为 [0,2] 有效音量）；
   写入经注入的 `applyVolume(el, v)`，缺省实现 `el.volume = clamp01(v)`（既有假对象与用例不受影响）；`MultiTrackAttachDeps.applyVolume?`、`PreviewCanvasHandle.applyVolume` 包装路由器。
3. **防止已路由元素接到跨源地址**：在 `VideoSourcePool._apply`（`:365-368`）、`_warm`（`:443-448`）、`AudioSyncPool._ensureSrc`（`:348-354`）赋 `src` 之前，
   若 `router.isRouted(el) && !isBoostableSource(url)`，调用宿主新方法 `recycleElement(trackId, role: 'active' | 'prewarm' | 'audio')`：暂停旧元素、`removeAttribute('src')` + `load()`、移出 DOM、
   创建新的（未路由）元素并替换池映射，之后池在新元素上赋值（音频适配器 memo `MultiTrackPlaybackEngine.ts:702-763` 与就绪绑定 `:435-463` 按元素建立，新元素下一次解析时重新绑定）。
4. 不可增益（远程未缓存）时按 1 播放，并在本会话首次出现时 `showWarning(t.videoPlayerPanel.playback.volumeBoostUnavailable)`（每会话一次，模块级标记）。
5. 回退开关：`@/lib/playbackFlags` 新增默认开启的 `previewVolumeBoost`（与现有两个标志同一模式）；关闭时 `applyVolume` 使用缺省钳制实现，其余代码不变。

**回归测试**：`playback/audio/__tests__/PreviewGainRouter.test.ts`「splits 1.6 into element volume 1 and gain 1.6」「never routes a cross-origin source」「does not route while the AudioContext is suspended」「a routed element carries volume and mute in the gain」；
`playback/__tests__/VideoSourcePool.test.ts`「a routed element is recycled before a cross-origin src is assigned」；`AudioSyncPool.test.ts:47,60` 的钳制断言迁移到缺省 `applyVolume`。

#### N-06 播放头可停在预览终点之后（黑屏）

**现状**：`timelineSlice.ts:482-491` 按 store `totalDuration`（`TimelineAggregate.maxItemEnd`，含隐藏轨、空白字幕、缺素材片段，`TimelineAggregate.ts:564-580,669-675`）钳制；
`TimelineRuler.tsx:104,120` 同口径；预览终点为 S5 `computeRenderEnd`（`useTimelineComposition.ts:229-231`）；`MultiTrackPlaybackEngine.seek`（`:249-265`）不钳制；
`useCompositionTransport.ts:244-251` 与 `VideoPlayerPanel.tsx:416-418` 以 `t / total` 算进度。复现：视频 0–10 s + 隐藏轨条目 10–20 s → 标尺拖到 15 → 黑屏、「00:15 / 00:10」、进度 150%，按播放从 0 开始。

**修复**：
1. `MultiTrackPlaybackEngine.seek(t)`：`const total = this._deps.timeline.getTotalDuration(); const target = total > 0 ? Math.min(Math.max(0, t), total) : Math.max(0, t);`，`playhead.forceSet(target)`（store 由既有回声守卫同步到渲染终点，`useCompositionPlayback.ts:502-534`）。
2. `useCompositionTransport.getCurrentTime` 在合成模式返回 `Math.min(t, total)`；`VideoPlayerPanel` 进度百分比钳制到 [0, 100]。
3. store 仍保留 `maxItemEnd`（隐藏条目仍可选中、编辑）。

**回归测试**：`playback/__tests__/MultiTrackPlaybackEngine.seekBeyondRenderEnd.test.ts`「seek past the render end paints the final frame and reports the render end」；
`VideoPlayerPanel/__tests__/useCompositionTransport.progress.test.ts`「progress never exceeds 100% when the playhead is after the render end」。

### 3.4 导出流程（EX 组：EX3-01～EX3-08、EXO-07、EXO-14、N-04、N-11、N-14、N-15、N-16）

路径前缀：后端相对 `backend-services/basic-service/`；行号为 HEAD `e06dca4`。

#### EX3-01 带旋转元数据的竖拍视频导出被压扁 / 拉伸

**现状 *[实测]***：`video_composition_service.py:530-545` `_get_video_properties` 以 cv2 `CAP_PROP_FRAME_WIDTH/HEIGHT` 取**编码尺寸**（忽略显示矩阵），`:869,897-902` 按它缩放；
ffmpeg 解码默认自动旋转（`:950-959` 未加 `-noautorotate`），运镜链帧尺寸同样来自它（`:914-915`）。源 1920×1080 H.264 + `rotation=90`（手机竖拍常见存储方式）：cv2 报 (1920,1080)，
归一化到 9:16 输出 1080×1920，画面是上下黑边的 1080×608 横条（压扁 3.16 倍）；16:9 时走同比例分支，对自动旋转后的 1080×1920 帧执行 `scale=1920:1080`（拉伸）。预览 `<video>` 遵循旋转——预览≠导出。

**修复**：
1. 新增 `app/services/composition/media_probe.py`：
   ```python
   @dataclass(frozen=True)
   class VideoStreamInfo:
       width: int          # 显示尺寸（已按旋转交换）
       height: int
       fps: float
       duration: Optional[float]   # 未知 / ≤0 时为 None
       rotation: int       # 0 / 90 / 180 / 270

   def probe_video_stream(path: str, ffprobe_path: str, timeout: float = 30.0) -> Optional[VideoStreamInfo]: ...
   def ffprobe_path_for(ffmpeg_path: str) -> str: ...   # 由 video_composition_service.py:2106 的推导逻辑抽出
   ```
   命令：`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,avg_frame_rate,r_frame_rate,duration,nb_frames:stream_side_data=rotation:stream_tags=rotate:format=duration -of json <path>`；
   旋转取 side data `rotation`，否则取旧 `tags.rotate`，归一化为 `(-r) % 360` 后取最近的 0/90/180/270；`rotation % 180 == 90` 时交换宽高；
   时长优先 stream `duration`，其次 `format.duration`，非有限或 ≤0 为 `None`；fps 取 `avg_frame_rate`，为 0 时取 `r_frame_rate`，仍无效时 30。进程失败 / 超时返回 `None`。
2. `_get_video_properties` 先调 `probe_video_stream`，返回 `None` 时回退 cv2（ffprobe 缺失的开发环境）；`:2106` 改用 `ffprobe_path_for`。

**回归测试**：`tests/test_media_probe.py::test_rotated_clip_reports_display_size`（真实 ffmpeg 生成 `-display_rotation:v:0 90` 素材，无 ffmpeg 时 skip）、`::test_legacy_rotate_tag_swaps_dimensions`（纯 JSON 解析）；
`tests/test_export_canvas_ffmpeg.py::test_rotated_portrait_clip_fills_vertical_frame`（9:16 导出第 100 行像素非黑）。

#### EX3-02 无容器时长的源（直播式 WebM、MediaRecorder 录屏）无法导出

**现状 *[实测]***：`:874-891` 以 cv2 帧数推导时长，此类文件帧数为负（-2.767e17）→ `actual_clip_end = min(负数, clip_end)` → 「Invalid clipping parameters: clip duration is -9223372036854776.00s」；
`_normalize_video_with_retry`（`:613-667`）对这一确定性失败再重试 4 次（1+2+4 s 退避）后整单失败。`.webm` 是允许上传的格式（`storage_router.py:81`），预览可正常播放。

**修复**：
1. `_normalize_video` 使用 EX3-01 的 `probe_video_stream`；`original_duration: Optional[float]`。
2. 源时长未知或 ≤0 时**不钳制** `clip_end`（仍要求 `clip_end > clip_start`），始终输出 `-t clip_duration`，帧数由既有 `-frames:v` 保证。
3. 归一化结果增加 `retryable: bool`；「裁剪窗口无效」「无法读取视频属性」返回 `retryable=False`，`_normalize_video_with_retry` 遇到即返回不重试。

**回归测试**：`tests/test_export_canvas_ffmpeg.py::test_webm_without_duration_normalizes_requested_window`（`-f webm -live 1` 4 s 素材截 0.5–1.5 s，帧数 == 30）；`tests/test_video_composition_timeline.py::test_invalid_clip_window_is_not_retried`。

#### EX3-03 同一源切出的每个片段都把整个源文件复制到临时目录

**现状 *[实测]***：`:1450-1471` 对同一 URL 的第 2 个及之后的片段 `shutil.copy2(original_path, copy_path)`；这些副本只作为归一化的只读输入。
一个 50 MB 文件切 12 段 → 11 次复制、550 MB；2 GB 录屏切 30 段 → 58 GB，写满临时盘后归一化失败。根因：已删除的逐片下载管线遗留。

**修复**：该循环改为对 `indices` 中每个下标 `downloaded_videos[i] = original_path`；删除复制分支与 `shutil` 相关日志；保留「缺失下标」检查。

**回归测试**：`tests/test_video_composition_timeline.py::test_split_clips_of_one_source_are_not_copied`（`shutil.copy2` 打桩为抛错；每个归一化任务的 `video_path` 均为源文件）。

#### N-04 + EX3-04 长时间轴：每个片段一个 ffmpeg 输入 → 内存耗尽 / Windows 命令行超长

**现状 *[实测，1080p30、2 轨、每段 0.5 s、ffmpeg 7]***：每个归一化片段都是独立 `-i`（`filtergraph_builder.py:304-315`、`video_composition_service.py:289-291`）：

| 变体 | 峰值 RSS | 线程 | 句柄 | 耗时 |
|---|---|---|---|---|
| 61 输入 | 6.6 GB | 1104 | 9025 | 8.4 s |
| 241 输入 | 16.4 GB | 4342 | 33792 | 56.7 s |
| 241 输入 + 每输入 `-threads 1` | 9.4 GB | 586 | 2774 | 18.7 s |
| 连续段先经 concat demuxer `-c copy` 预合并（1.7 s，包数 3600/3600 精确）+ 2 输入画布 | 0.99 GB | 152 | 898 | 14.7 s |

约 55 MB / 1080p 输入，8–16 GB 内存的桌面在约 100–250 个片段时抖动或 OOM。另：Windows `CreateProcess` 命令行上限 32767 字符，生产路径每个 `-i` 约 108 字符（`%TEMP%\video_compose_<uuid>\video_audio_123.wav`），
约 303 个输入即触发 `WinError 206`：音频合流 `:2326-2338` 抛错被 `:2201-2203` 吞为 `path=None` → `:2014-2021` RuntimeError 整单失败（单轨 concat 路径同样）；画布 `:289-302` 以普通异常失败于 `finalization`。
EXO-05 只把滤镜图文本移入脚本文件（`ffmpeg_args.py:64-72`），输入参数本身未受控。

**修复**：
1. **视频连续段预合并**（`filtergraph_builder.py` 新纯函数，builder 本身不改）：
   ```python
   @dataclass(frozen=True)
   class RunPlan:
       track_id: str
       z: int
       clips: Tuple[CanvasClip, ...]
       start: float
       duration: float
       needs_alpha: bool      # 段内任一片段有转场 / 不透明度 < 1

   def plan_runs(clips: Sequence[CanvasClip], fps: int) -> List[RunPlan]: ...  # 复用 group_tracks 与 _contiguous_runs
   ```
   `_compose_videos_filtergraph` 中：对 `needs_alpha=False` 且片段数 > 1 的段，用既有 `_concat_videos`（copy，失败回退重编码，失败抛 `CompositionStageError`）合并为 `temp_dir/run_{n}.mp4`，
   再以伪片段（id=段键、start、duration=段时长、opacity 1、无转场）喂给 `build_filtergraph`；`needs_alpha=True` 的段保持逐片段输入。归一化片段已按 `frame_count_for` 预算帧数，合并后帧数精确。
2. 输入数 > 16 时每个 `-i` 前加 `-threads 1`。
3. **音频分块合流**（`composition/audio_mix.py`）：
   ```python
   MAX_MIX_INPUTS = 64
   def chunk_sources(count: int, max_inputs: int = MAX_MIX_INPUTS) -> List[range]: ...
   ```
   `_mix_audio_sources` 在源数 > 64 时按块以 `build_audio_mix`（时间轴相对位置、`apad/atrim` 到 `timeline_end`、`normalize=0`）混成 `mix_part_{k}.wav`，再把各块以起点 0 合流；
   `amix normalize=0` 是线性求和，且各块都补齐到终点。块文件以 `-c:a pcm_f32le` 写出（v2 评审 RV3-14：16 位中间文件会在块内求和超过 0 dBFS 时提前削波，而单次合流是在浮点域求和后才编码），因此分块结果与单次合流一致；≤64 个源时命令不变。
4. **可读失败**：ffmpeg 调用处把 `OSError.winerror == 206` 映射为 `CompositionStageError(stage, "too many inputs for one FFmpeg command")`；预合并后画布输入仍 > 200（极端：数百个带转场 / 半透明的片段）时，在构建命令前直接抛同一错误（前端经 EX3-08 显示「合成视频时出错」并记录日志）。分层画布合成列入附录 A。

**回归测试**：`tests/test_filtergraph_builder_runs.py::test_plan_runs_merges_contiguous_alpha_free_clips`、`::test_plan_runs_keeps_alpha_runs_per_clip`；
`tests/test_composition_degradations.py::test_canvas_command_has_one_input_per_run`（FakeFfmpeg 统计 `-i` 个数）、`::test_400_clip_audio_inputs_keep_every_command_under_limit`（`subprocess.list2cmdline` 长度 < 32767 且无音频丢失）；
`tests/test_audio_mix.py::test_chunk_sources_plan`；`tests/test_export_canvas_ffmpeg.py::test_premerged_run_matches_per_clip_frame_count`（真实 ffmpeg）。

#### EX3-05 一张无法解码的图片让所有图片叠加一起丢失

**现状 *[实测]***：`_resolve_overlay_image`（`:2512-2527`）只检查文件存在；所有图片共用一条命令，失败时 `:2865-2869` 把每一张都记为降级；合并叠加路径与顺序回退（`:1690-1701,2494-2505`）同样。
`good.png` 单独 → 成功；`good.png` + `bad.png`（PNG 签名 + 64 个零字节）→ 失败，降级 `['good','bad']`。

**修复**：`_resolve_overlay_image` 在存在性检查后以 `PIL.Image.open(p).verify()` 校验可解码（PIL 不可用时 `cv2.imread(p) is not None`）；失败返回 `(None, "image file cannot be decoded")`，只把该图片记为 `SkippedImage`。

**回归测试**：`tests/test_image_overlay_export.py::test_corrupt_image_is_skipped_and_other_images_render`、`::test_corrupt_image_in_combined_pass_reports_only_that_image`。

#### EX3-06 已完成导出的成片与请求体永不清理

**现状**：`:204` `Path("static/video/composed")` 相对 CWD，桌面端 CWD 为 `resources/backend`（`desktop/main/backendService.js:26,62`，即安装目录）；`composed_{id}.mp4`（`:1310-1311`）从不删除，
状态字典中的 `request`（`:1138`）永久驻留内存；全文件无 pop / del / remove。开发机 `static/video/composed` 已有 9 个文件 / 40 MB；客户端超时（EXO-07）后留下无人下载的孤儿文件。

**修复**：
1. `app/services/local_media_resolver.py` 新增 `composed_output_dir() -> Path`（锚定 `STORAGE_ROOT`，与 `audio_generated_dir` 同模式），同步 `ROUTE_PREFIXES`（`:50`）与解析（`:118`）；合成服务输出目录改用它，下载路由按新目录解析。`composed_output_dir()` = `_storage_root() / 'static/video/composed'`，合成服务在写入前 `mkdir(parents=True, exist_ok=True)`（v2 评审 RV3-22：桌面端 `initUserData()` 创建的是 `userData/static/video/composed`，不在 `STORAGE_ROOT = userData/storage`（`backendService.js:34`）之下，首次导出时新目录并不存在）。
2. `_evict_settled_compositions(max_age_seconds: int = 3600) -> int`：在 `start_video_composition` 开头调用，弹出 `completed_at / failed_at` 早于 1 小时的状态项并删除其输出文件；服务首次实例化时额外清扫 `composed_*.mp4` 中修改时间早于 1 小时的文件。
3. `_compose_video_sync` 的 `finally` 中 `status.pop("request", None)`。

**回归测试**：`tests/test_composition_failure_cleanup.py::test_settled_composition_older_than_ttl_is_evicted_with_file`、`::test_recent_completed_composition_stays_downloadable`、`::test_settled_composition_drops_request_payload`。

#### EX3-07 `videoExportItems.ts` 含原始 NUL 字节，git 视其为二进制

**现状 *[实测]***：`src/components/video/hooks/videoExportItems.ts:201` 模板串 `${trackId}<0x00>${itemId}` 含字节偏移 7204 处的 NUL；`git diff --numstat a7f46c5 e06dca4` 显示 `- -`（二进制），第 2 轮代码评审看不到该文件的差异。

**修复**：`renderKey` 改为 `JSON.stringify([trackId, itemId])`。该键只用于 `Map` 查找，不含任何控制字符（v2 评审 RV3-12：v1 在源码中写 NUL 转义序列的做法，经工具写入时有被写成原始字节的已知陷阱，会复现同一缺陷）。

**回归测试**：`src/components/video/hooks/__tests__/videoExportItems.test.ts` 追加「source file has no raw control characters」（读取源文件，断言不匹配 `/[\x00-\x08\x0B\x0C\x0E-\x1F]/`）；门禁 A20 对 `src/` 全量扫描。

#### EX3-08 异步导出失败显示后端英文原文、从不点名失败片段

**现状 *[实测，vitest 临时复现]***：`src/lib/api/videoComposition.ts:295-303` 拼出 `"Composition failed: <error_summary>\n<suggestion>"`，`:422-424` 以普通 `Error` 拒绝并丢弃 `error_details.failed_videos`；
`useVideoExport.ts:110-127` 只从 `ApiError.details` 读 `failed_videos`，而合成 POST 恒返回 200 processing——该分支不可达。zh-CN 下显示
「视频导出失败： Composition failed: 1 out of 3 videos could not be resolved to a local file\nLocalize the material first (re-import or download it into the editor)」。

**修复**：
1. `videoComposition.ts`：
   ```ts
   export interface CompositionFailedVideo { video_name: string; stage?: string; error_message?: string }
   export interface CompositionErrorDetails { composition_stage?: string; failed_videos?: CompositionFailedVideo[] }
   export class CompositionFailedError extends Error {
     readonly details: CompositionErrorDetails;
     constructor(summary: string, details: CompositionErrorDetails);
   }
   ```
   轮询在 `status === 'failed'` 时以 `CompositionFailedError(error_summary, error_details)` 拒绝；`error_summary` 只写日志。
2. `useVideoExport.ts` 新纯函数（放入 `hooks/exportFailureMessage.ts`）：
   ```ts
   export function describeExportFailure(error: unknown, t: Translations, locale: Locale): string;
   ```
   `composition_stage` → `media_resolution`：`failedStageMediaResolution`；`normalization`：`failedStageNormalization`；`compose / finalization / cancelled 以外的其他`：`failedStageCompose`；
   名称经既有 `formatNameList`（最多 3 个 + 「等 N 个」）；`TimeoutError` → `exportTimeout`；其余 → 既有 `exportFailed`。删除因此无引用的 `failedVideos / recoverySuggestions` 文案与分支。
3. 文案见 §6.4。

**回归测试**：`hooks/__tests__/useVideoExport.failure.test.ts`「names clips whose material is not local」「never shows the backend English summary」；
`src/lib/api/__tests__/videoComposition.poll.test.ts`「failed status rejects with CompositionFailedError carrying error_details」。

#### EXO-07 导出：阶段化进度、停滞超时与协作式取消（S15）

**现状**：客户端按轮询次数放弃（`videoComposition.ts:395` `maxAttempts=300`，`:430-431`）；排队时间计入（`video_composition_service.py:223` `Semaphore(2)`，`:1169` 获取前状态已是 processing、进度 0）；
进度粗粒度（`:1326/1502/1629/1644` 为 0.1/0.4/0.7/0.9），音频合流、叠加、字幕（`:1652-1738`）全部停在 0.9，客户端映射为 30+0.9×65 = 88.5%（`useVideoExport.ts:144`）；
无取消入口（`VideoPlayerPanel.tsx:751-756` `allowCancel={false}`；`video_router.py` 只有 compose / status / download / health）；ffmpeg 调用均为无超时的 `subprocess.run`。
20 分钟 1080p 多轨导出：10 分钟后客户端报超时，后端继续编码并产出无人下载的文件（EX3-06）。

**修复**：
1. **后端阶段与进度**：状态字典增加 `stage: Literal['queued','resolving','normalizing','compositing','mixing','overlays','finalizing']`；
   `start_video_composition` 置 `queued`；`:1169` 获取信号量后置 `resolving`；归一化收集循环（`:1551-1582`）每完成一个置 `progress = 0.4 + 0.3 * done / total`、`stage='normalizing'`；
   画布合成 `compositing`（0.7）；合流开始 `mixing`（0.9）、结束 0.93；叠加 / 字幕 `overlays`（0.97）；成片移动 `finalizing`。状态路由白名单（`video_router.py:246-259`）加入 `stage`。
2. **客户端停滞超时**：
   ```ts
   export interface PollCompositionOptions { pollIntervalMs?: number; stallTimeoutMs?: number; signal?: AbortSignal }
   export function pollCompositionStatus(
     compositionId: string,
     onProgress: (status: CompositionStatus) => void,
     options?: PollCompositionOptions,   // 默认 2000 / 600_000
   ): Promise<CompositionStatus>;
   ```
   `progress`、`stage` 或 `activity_at`（见第 4 步）任一变化即重置停滞计时；`stage === 'queued'` 时不计时；`signal` 中止时以 `AbortError` 拒绝。唯一调用方 `useVideoExport.ts:143` 同步更新。
   `VideoExportProgressModal.getProgressStage` 优先使用 `stage`；新增 `progressStages.queued`；`exportTimeout` 文案改为「10 分钟没有进展」。
3. **协作式取消**（不终止正在运行的 ffmpeg 进程，只在阶段边界停止）：
   - 后端 `POST /api/video/compose/{composition_id}/cancel`（§5.1）：状态为 queued / processing 时在 `_cancel_events[composition_id]`（`threading.Event`）上 `set()`，返回 `{ success: true, data: { status: 'cancelling' } }`；已终态返回 409 `COMPOSITION_ALREADY_SETTLED`；未知 404。
   - 排队中的任务（v2 评审 RV3-13）：`_process_video_composition_async`（`:1164-1169`）把阻塞的 `self._composition_semaphore.acquire()` 改为带超时的循环——`acquire(timeout=0.5)` 失败后检查 `_cancel_events[composition_id]`，已取消则直接置 `failed / composition_stage='cancelled'` 并返回（不占并发槽、不进入 `_compose_video_sync`、不调用 `release()`）。否则已取消的排队任务要等到有空闲槽才会结束。
   - `_compose_video_sync` 在：获取信号量后、每个归一化任务提交前与收集循环每次迭代、画布合成前、合流前、叠加前检查 `_raise_if_cancelled(composition_id)`，抛 `CompositionCancelled`；
     捕获后状态置 `failed`、`composition_stage='cancelled'`、`error_summary='cancelled by user'`，`finally` 照常清理临时目录并删除部分输出。
   - BFF `src/app/api/video-compose/[compositionId]/cancel/route.ts`（POST，透传）。
   - 前端：`useVideoExport` 持有 `AbortController`；进度弹窗 `allowCancel`，点击「取消导出」→ 调用取消接口 → `abort()` 轮询 → 关闭弹窗并 `showInfo(t.videoExport.exportCancelled)`；取消接口失败仍中止客户端并记录日志。
     `describeExportFailure` 对 `composition_stage === 'cancelled'` 不再提示错误。
   - 真正终止 ffmpeg 进程（替换 18 个 `subprocess.run` 调用点）列入附录 A。
4. **长命令活动心跳（v2 评审 RV3-02）**：阶段进度只在阶段边界变化，而画布合成（`:289-302`）、单个长片段的归一化（`:977-1025`）、音画合成（`:2040,2274`）、音频合流（`:2338`）与图片叠加（`:2742,2839`）各自都是一次可能超过 10 分钟的 `subprocess.run`。只看阶段与进度，停滞超时会在正常的长导出中途触发。
   - `composition/ffmpeg_args.py` 新增 `progress_args(progress_path: str) -> List[str]`，返回 `['-progress', progress_path, '-nostats']`。上述命令（至少包括这些）在输出路径之前追加它，文件为 `temp_dir/progress_<stage>_<n>.txt`。
   - 新增 `_run_tracked_ffmpeg(composition_id: str, cmd: List[str], progress_path: str) -> subprocess.CompletedProcess`：调用前把路径加入 `status["progress_files"]`（`set`），`finally` 中移出。内部仍调用 `subprocess.run`，所以 `FakeFfmpeg` 按 `subprocess.run` 打补丁的测试接缝不变，与附录 A EXO-07c 的 `Popen` 改造无关。
   - `get_composition_status`（`:1782-1784`）返回状态字典的浅拷贝，并附加：
     - `activity_at`：`progress_files` 中现存文件的最大 `os.path.getmtime`，没有文件时不返回该字段。遍历前先 `list(...)` 拷贝，工作线程的增删不影响读取。
     - 合成阶段进度插值：`stage == 'compositing'` 时读取画布进度文件尾部（≤ 4 KB）的最后一个 `out_time_us=`，令 `progress = 0.7 + 0.2 × min(1, out_time_us / 1e6 / timeline_end)`，合成期间进度条持续前进。
   - 状态路由白名单（`video_router.py:246-259`）加入 `activity_at`。ffmpeg 默认约每 0.5 s 刷新一次进度文件；进度文件随临时目录在 `finally` 中删除。
   - 效果：只有 ffmpeg 连续 10 分钟没有写出进度（真实挂起）才会触发停滞超时。决策见 D-32。

**回归测试**：`src/lib/api/__tests__/videoComposition.poll.test.ts`「keeps polling past 300 attempts while progress advances」「rejects TimeoutError after the stall timeout without progress change」「queued stage does not arm the stall timer」「an aborted signal stops polling」；
`tests/test_video_router_status.py::test_status_reports_stage`、`tests/test_video_router_cancel.py::test_cancel_marks_running_composition_cancelled`、`::test_cancel_after_completion_returns_conflict`；
`tests/test_composition_degradations.py::test_normalization_progress_advances_per_clip`、`::test_cancel_between_stages_cleans_temp_dir`；`hooks/__tests__/useVideoExport.cancel.test.ts`「cancel calls the backend and closes the modal without an error」；
`src/lib/api/__tests__/videoComposition.poll.test.ts`「a changing activity_at keeps polling past the stall timeout」；`tests/test_composition_progress_activity.py::test_status_reports_activity_while_ffmpeg_writes_progress`、`::test_compositing_progress_interpolates_from_out_time`、`::test_cancelled_queued_composition_returns_without_taking_a_slot`（RV3-13）。

#### EXO-14 导出会话随编辑器卸载丢失、可重复导出、下载失败仍显示成功

**现状**：导出状态是组件局部状态（`useVideoExport.ts:192-194`）；`Container.tsx:134-176` 只渲染活动任务、编辑器 `key={projectId}`（`VideoEditorContainer.tsx:278`），切换任务 / 项目即卸载；
按钮只看局部 `isExporting`（`VideoPlayerPanel.tsx:456`）；兜底下载对同一 URL 重复 `http.download`（`useVideoExport.ts:159-180`）；两次下载都失败仍 `setExportProgress(100)`（`:265-268`），弹窗显示对勾与「导出成功」2 秒。
复现：开始长导出 → 切换任务再切回 → 无弹窗、按钮可用 → 再点开始第二次合成、之后两次下载。

**修复**：
1. 新增 `src/components/video/hooks/exportSessionStore.ts`：
   ```ts
   export interface ExportSession { status: 'running'; progress: number; startTime: number; compositionId?: string; controller: AbortController }
   export function getExportSession(taskId: string): ExportSession | undefined;
   export function beginExportSession(taskId: string, controller: AbortController): boolean;  // 已有 running 时返回 false
   export function updateExportSession(taskId: string, patch: Partial<Pick<ExportSession, 'progress' | 'compositionId'>>): void;
   export function endExportSession(taskId: string): void;
   export function subscribeExportSessions(listener: () => void): () => void;
   ```
   会话键 `sessionKey = projectId ? taskId + ':' + projectId : taskId`（v2 评审 RV3-07）。同一任务内切换项目时，编辑器以 `key={projectId}` 重挂载；只按 `taskId` 隔离会让项目 B 显示项目 A 的导出进度、被禁止导出，并能取消 A 的导出。`UseVideoExportProps` 增加 `projectId?: string`，由 `VideoPlayerPanel` 传入（VEI `:2248` 已向其传递）。上面签名中名为 `taskId` 的参数即 `sessionKey`。
   `useVideoExport` 以 `useSyncExternalStore` 读取 `isExporting / progress / startTime`；`handleExport` 首行 `if (!beginExportSession(sessionKey, controller)) return;`（同步守卫）。
   卸载时**不**中止会话（后台导出继续，重新挂载后弹窗恢复）；轮询回调在会话仍存在时照常下载。
2. `downloadComposedVideo(...) : Promise<boolean>` 只尝试一次（删除兜底分支）；返回 `false` 时 `showError(t.videoExport.exportCompletedButDownloadFailed)`、不设 100%、立即结束会话。
3. 整文件 Blob 缓冲（`http-client.ts:614`）需要新的下载 IPC（`webContents.downloadURL`），列入附录 A。

**回归测试**：`hooks/__tests__/useVideoExport.session.test.ts`「a remounted hook for the same task reports the running export」「a second handleExport while running starts no composition」「another project in the same task is not blocked by the running export」；
`hooks/__tests__/useVideoExport.download.test.ts`「a failed download never reaches 100%」「the download is attempted once」。

#### N-11 修复基线即失败的后端用例（含死代码删除）

**实测原因（HEAD，7 例全部失败）**：
- `test_video_composition.py::test_download_video_success`（`:131`）：`validate_external_url` 把 example.com 解析为 198.18.0.211（fake-ip DNS）并拒绝。`_download_video*` 整族（`video_composition_service.py:547-851`，含 `_load_video_download_config :479-520` 与 `youtube_service :214` 的使用）**无生产调用方**，仅内部互调（`:562,680,684`）——死代码。
- `test_compose_video_success`（`:232`）：`WindowsPath.stat` 只读不可打桩，且 `compose_video` 已不存在；`test_compose_video_download_failure`（`:247`）：`compose_video` 不存在。
- `test_video_composition_enhanced.py::test_convert_url_to_local_path_server_url` 假设路径相对 CWD，解析器锚定 `STORAGE_ROOT`（`:1924` FileNotFoundError）；`::_http_url` 同 fake-ip 拒绝（`:1958`）；`::test_process_audio_tracks_server_url` 同文件缺失致 `mix.path is None`（`:146`）。
- `test_audio_transcription_service.py::test_aprocess_silent_audio_returns_success_with_empty_subtitles`：**并非产品超时**（第 2 轮 N-11 诊断有误）——夹具只排入一帧，服务的握手确认读取（`audio_transcription_service.py:470-480`）把它消费掉，最终 `recv` 触发 `_FakeWS` 超时。*[实测]* 先排入确认帧后该用例立即 `success=True, subtitles=[]`。

**修复**：
1. 删除以下死代码：`_download_video*` 死代码族（`:547-851`）；`_load_video_download_config`（`:479-520`）及其在 `__init__` 中的调用（`:208`）；`self.youtube_service = YouTubeService()`（`:214`）；`_is_youtube_url / _is_pexels_url` 包装（`:522-527`）；以及随之无用的导入（`YoutubeVideoDownloadRequest`、`YouTubeService`、`random`、`composition.media_download` 中不再使用的名称）。
   同时删除 `tests/test_video_composition_pexels_retry.py`（21 处引用该代码）与 `test_download_video_success/failure`。
   **耦合测试与引用（v2 评审 RV3-03 补齐）**：
   - `tests/test_video_composition_timeline_order.py` 有 4 处 `patch.object(self.service, '_download_video')`（`:120,237,299,353`）。属性删除后 `patch.object` 会抛 AttributeError，所以删除这些补丁行，其余断言不变。
   - `tests/test_pexels_functionality.py` 整个文件只断言被删的 `video_download_config / _download_video / _download_pexels_video_with_retry / _is_pexels_url` 存在（`:19-48`），整文件删除。
   - `app/services/composition/camera_motion.py:144` 的文档串改为「Mirrors the repo's YAML convention (`yaml.safe_load` + defaults when the file is absent)」，不再点名被删方法。
   - `composition/media_download.py` 若删除后没有调用方，一并删除，并更新 `composition/__init__.py:19` 的模块说明。
   - 删除前用修订后的 A12 确认只剩上述位置；删除后 A12 为 0。不要用 `_download_video` 子串搜索——它会匹配 `video_cut_service.py:117`、`watermark_removal_service.py:100,155` 中仍在使用的 `_download_video_if_needed`。
2. 删除 `test_compose_video_success / _download_failure`（已由 `test_composition_failure_cleanup` / `test_video_composition_timeline` 覆盖）。
3. `test_video_composition_enhanced.py`：`monkeypatch` `app.services.video_composition_service.audio_generated_dir / legacy_audio_generated_dir` 指向 `tmp_path`；`_http_url` 打桩 `validate_external_url`。
4. ASR 夹具：`frames = [_full_server_response({"audio_info": {}, "result": {"utterances": []}}, seq=1), _full_server_response(silent_payload, seq=2)]`。

**验收**：A5 后端门禁 0 失败（第 2 轮 7 个基线失败清零）。

#### N-14 内嵌原声提取重新解析远程地址、请求守卫对从不访问的视频 / 图片地址做 DNS 校验

**现状 *[实测]***：`:2101` 以 `_convert_url_to_local_path(item.url)` 重新解析，而视频阶段已按缓存命中（`:1386-1392` `url_to_downloaded_path`）；
Pexels 已缓存素材（`source=pexels, source_id=12345`）视频阶段命中缓存，音频阶段拿远程 URL → 「URL rejected by security guard: host 'videos.pexels.com' resolves to disallowed address 198.18.0.224」→ `embedded_audio` 降级、成片无声；
开放网络下则 ffprobe 直接拉 CDN（ARK 签名过期 403 同样无声）。`_guard_request_urls`（`:1823-1851`）对视频 / 图片 URL 做 DNS 校验，在 fake-ip（Clash TUN）或离线网络下整单被拒，而管线从不远程打开这些地址（`:1394-1410` `NonLocalMediaError`、`:2523-2524`）。

**修复**：
1. `_extract_video_audio_tracks(..., composition_id=None, local_paths: Optional[Sequence[Optional[str]]] = None)` 与 `_extract_one_video_audio(index, item, temp_dir, ffmpeg_path, local_path: Optional[str])`：给定 `local_path` 时直接使用；`:1647` 调用处传 `downloaded_videos`。
2. `_guard_request_urls` 只校验 `audio_items`（唯一仍以 http 交给 ffmpeg 的类型）；视频 / 图片条目跳过 DNS 校验。

**回归测试**：`tests/test_video_composition_local_refs.py::test_embedded_audio_uses_cached_path_not_remote_url`（ffprobe 命令最后一个参数 == 缓存路径）、`::test_request_guard_skips_video_urls_resolved_locally`（`validate_external_url` 打桩为抛错，响应仍为 processing）。

#### N-15 字幕烧录边界：路径含撇号、日文 / 韩文字体与换行、日志字形

**现状 *[实测]***：
- 撇号：临时目录 `…\O'Neil\video_compose_x` 下 `burn_drawtext_filters` 失败（「Error opening output files: Invalid argument」）；`subtitle_service.py:894-898` 以 `'…'` 包裹路径且只转义 `\` 与 `:`。临时目录为 `%TEMP%`（`video_composition_service.py:1309`）——Windows 用户名含撇号即整批字幕降级。
- 字体：`_contains_chinese` 对 `'ありがとう'`、`'안녕하세요 여러분'` 为 False → 选 arial.ttf（`:373-400,444-465`），假名 / 谚文绘为方框；纯假名文本被当作一个「单词」不换行（'ありがとう'×3、每行 5 字 → 单行 15 字溢出，`:270-304`）。
- 日志：cp936 管道打印 ✓ 时出现「--- Logging error ---」；打包应用以 `-X utf8` 启动（`backendService.js:61`），仅开发环境受影响。

**修复**：
1. `subtitle_service.py` 新增 `escape_filter_option_value(value: str) -> str`：ffmpeg 两级转义、不加引号（第 1 级转义 `\ : '`，第 2 级转义 `\ ' [ ] , ;`）；`_drawtext_line_filter` 的 `textfile` 与 `fontfile` 改用它。
2. `_detect_script(text) -> Literal['cjk','kana','hangul','latin']`（假名 U+3040–30FF、U+31F0–31FF；谚文 U+AC00–D7AF、U+1100–11FF、U+3130–318F；含假名优先判 kana，否则含谚文判 hangul，否则含 CJK 判 cjk）；
   Windows 字体候选：kana → `YuGothM.ttc, meiryo.ttc, msgothic.ttc, msyh.ttc`；hangul → `malgun.ttf, gulim.ttc`；加入 `_is_cjk_capable_font` 的标记集合；`_wrap_text` 在 `script != 'latin'` 时逐字换行。
   前端 `subtitleLayout.containsCjk` 同步包含假名与谚文区间（EXO-09 黄金用例追加一条假名样本）。
3. `:586,595,605,612` 日志中的 ✓ / ✗ / ❌ 改为 ASCII（`[ok]` / `[fail]`）。
4. emoji 需要按字形切换字体，且预览绘制彩色 emoji（观感变化），列入附录 A。

**回归测试**：`tests/test_subtitle_export_style.py::test_drawtext_burns_when_temp_path_contains_apostrophe`（真实 ffmpeg，无 ffmpeg 时 skip）、`::test_kana_subtitle_selects_japanese_capable_font`、`::test_hangul_subtitle_selects_korean_font`、`::test_kana_only_text_wraps_by_character`。

#### N-16 基线即失败的旧字幕测试

**现状 *[实测]***：`tests/test_portrait_subtitle_centering.py` 4 例 TypeError（缺 `text_files_dir`，`:82,107,125,180`）；`tests/test_subtitle_add.py` 7 例（6 例依赖仓库中不存在的 `datas/merge/*`，`test_convert_time_to_seconds` 断言 SRT 从不使用的 `00:00.20` 格式，`:142`）。

**修复**：
1. `test_portrait_subtitle_centering.py` 改写为 pytest 函数 + `tmp_path`：`test_portrait_frame_uses_centered_builder`（经 `_build_ffmpeg_command(..., 1080, 1920, str(tmp_path))` 断言）、`test_every_wrapped_line_is_centered`（每行一个滤镜、`x=(w-text_w)/2`）、`test_landscape_frame_uses_standard_builder`；删除日志断言。
2. 删除 `test_subtitle_add.py`，新增 `tests/test_add_subtitles_service.py`：`tmp_path` 中生成 2 s 视频与 SRT（无 ffmpeg 时 skip），`test_add_subtitles_burns_srt_into_video`、`test_parse_srt_keeps_multiline_text`、`test_convert_time_to_seconds_accepts_comma_and_dot`；服务以 `object.__new__` 构造，避免在 CWD 创建目录。

### 3.5 时间轴核心（TL 组：TL3-01～TL3-06、TL2-05、TL2-22、ME-11、ME-12、N-01、N-17）

路径前缀 `src/components/video/timeline/`，行号为 HEAD `e06dca4`。

#### TL3-01 把片段拖到磁性轨最前面，松手后却排在第二（预览与结果矛盾）

**现状 *[实测]***：拖拽预览把起点钳制在 ≥ 0（`domain/machines/dragMachine.ts:230-237`）；提交以原始预览起点移动（`store/slices/dragSlice.ts:189` `moveItemAction(get, preview.itemId, preview.startTime)`）；
`TimelineAggregate.moveItem` 同轨 `moveTo` 后稳定排序（`domain/aggregates/TimelineAggregate.ts:207-208`），`organizeVideoAudioTracks` 按该顺序贴紧（`:251-271`）；
交换判定只看被拖片段中心落入目标片段中间 60% 区间（`domain/services/DragCalculationService.ts:293-311`）。
视频轨 A[0,2] B[2,4] C[4,14] D[14,16]，把 C 左拖 1000 px（预览 C 在 0）→ 松手 → `A@0 C@2 B@12 D@14`，`swapTargetItemId=null`。
根因：磁性轨没有「插入序号」概念；落点 0 与 A 起点相同，稳定排序保留 A 在前；长片段中心永远到不了短首片段的中间区间，只能反过来拖 A。

**修复**：
1. 新增 `domain/services/MagneticInsertion.ts`：
   ```ts
   export interface MagneticPeer { id: string; startTime: number; duration: number }
   /** 被拖片段在同轨其余片段（按起点排序、已排除 draggedId）中的插入序号：中点 ≤ previewStart + TIME_EPSILON 的片段个数。 */
   export function magneticInsertIndex(peers: readonly MagneticPeer[], draggedId: string, previewStart: number): number;
   ```
2. `TimelineAggregate.reorderMagneticItem(itemId: string, insertIndex: number): void`：轨道锁定抛 `TrackLockedError`、非 video/audio 轨抛错；取不含该条目的有序同伴，在 `insertIndex` 处插入，自 0 贴紧（与 organize 同一游标规则），`sortItems()`、`recalculateTotalDuration()`。
3. 新增 `store/actions/reorderItem.ts`：
   ```ts
   export function reorderItemAction(get: () => TimelineStore, itemId: string, insertIndex: number): boolean;
   ```
   先查 `isEditLocked` 与轨道锁；序号等于当前序号时返回 `false` 且不写历史；否则 `recordAction(MOVE_ITEM)` → `reorderMagneticItem` → `autoOrganize()` → `captureNextState()`，返回 `true`。
4. `dragSlice.commitMove`：同轨、非交换、目标为 video/audio 轨时改为 `reorderItemAction(get, id, magneticInsertIndex(trackItems, id, preview.startTime))`；字幕轨仍走 `moveItemAction`（受 TL3-04 约束）。
   `commitCrossTrackMove` 目标为磁性轨时，在同一条历史记录内转移后按目标轨同伴计算序号并重排（`reorderMagneticItem` 直接在 aggregate 上调用，不另记历史）。
5. 交换逻辑保持不变（等长片段交换已正确 *[实测]*）。

**回归测试**：`domain/services/__tests__/MagneticInsertion.test.ts`「a start before the first clip's midpoint inserts at index 0」「a start past a peer's midpoint inserts after it」；
`store/slices/__tests__/dragSlice.magneticInsert.test.ts`「dragging a clip to time 0 makes it the first clip」「a drag that keeps the same neighbours records no history」。

#### TL3-02 不改变任何内容的编辑仍写入撤销记录并清空重做栈（S12）

**现状 *[实测]***：`store/slices/historySlice.ts:101-127` 无条件记录，`domain/services/HistoryService.ts:579-593` `addAction` 截断重做分支；只有 `replaceTimelineAction` 做了变化比较。触发点：
被贴紧弹回的同轨拖动（`dragSlice.ts:189` → `store/actions/moveItem.ts:33`）；松手在不兼容 / 锁定轨（`dragSlice.ts:143-157` 回退为同轨移动，还会选中并滚动到片段）；
整齐时间轴上点「整理素材」（`TimelinePanel.tsx:914-921`，总是提示成功）；音量滑块未改变即松手（`VolumeSlider.tsx:312` → `trackActions.ts:112-121`）；锁定轨上的静音 / 显示切换（`trackActions.ts:33-37,47-51` + aggregate 空操作 `TimelineAggregate.ts:448-463`）。
复现：A[0,5] B[5,10] C[10,15] → 删除 C → 撤销（可重做）→ 把 B 右拖 25 px → 轨道不变、历史索引 −1→0、`canRedo=false`。

**修复（S12「无变化不入历史」）**：
1. `HistoryService`：
   ```ts
   private _lastAdd: { tail: TimelineAction[]; head: TimelineAction[]; index: number } | null = null;
   addAction(action: TimelineAction): void;       // 记录被截断的重做分支 tail、被 MAX_HISTORY 挤掉的 head 与原索引
   /** 撤回最近一次 addAction（它没有改变内容），恢复重做分支与被挤掉的旧记录。 */
   discardLastAction(): boolean;                 // _lastAdd 为空或当前索引不是末尾时返回 false
   ```
   `undo / redo / clear` 与一次成功的 `captureAfterState` 均把 `_lastAdd` 置空。实现见 tl-core 排查稿（`addAction` 保存 `tail = history.slice(index + 1)`、`head = 超出 MAX_HISTORY 的前缀`；`discardLastAction` 以 `[...head, ...history.slice(0,-1), ...tail]` 复原、索引回到原值）。
2. `historySlice.captureNextState`：`after = getSnapshot()`；`last = history.getHistory().at(-1)`；若 `last?.previousState` 且 `tracksEqual(last.previousState.tracks, after.tracks)` 则 `discardLastAction()`，否则 `captureAfterState(after)`；最后刷新 `canUndo / canRedo`。
   `tracksEqual` 放入 `domain/services/snapshotEquality.ts`，以 `JSON.stringify` 比较（与 `replaceTimelineAction` 现有比较口径一致，复用其实现并删除重复）。
3. `TimelinePanel.handleOrganizeMaterials`：比较前后轨道，未变化时 `showInfo(t.timeline.messages.organizeMaterialsAlreadyTidy)` 而非成功提示。
4. `commitCrossTrackMove`：只有片段确实到达目标轨（`findItem(id).track.id === targetTrackId`）时才 `selectItem` 与 `requestScrollItemIntoView`。
5. 既有 `timeline/__tests__/autoOrganize.integration.test.ts:201-225` 夹具含空隙，被记录的移动确有变化，保持通过。

**回归测试**：`store/slices/__tests__/history.noopEntry.test.ts` 表驱动「an edit that leaves the tracks unchanged records no history and keeps redo」（弹回的拖动 / 不兼容轨松手 / 整理 / 未变化的音量提交 / 锁定轨静音）、「discarding restores the entry trimmed by MAX_HISTORY」。

#### TL3-03 字幕左边缘无法向前拖

**现状 *[实测]***：`TimelineItem.tsx:265` `isStill = item.originalMaterialType === 'image'`，字幕发送 `isStill: false`、`clipStart: undefined`；`dragMachine.ts:281-283` 以 `originalClipStart`（= 0）限制左扩 → 最小起点即原起点。
字幕 start 5、duration 2，左边缘拖 −4 → 预览 start 5、duration 2（期望 4 / 3）。根因：字幕没有源媒体，却被当成「入点为 0 的源受限片段」。

**修复**：`TimelineItem.tsx` `handlePointerDown` 中 `const hasFreeEdges = isStill || item.type === 'subtitle';`，传 `isStill: hasFreeEdges`、`originalMediaDuration: hasFreeEdges ? Number.POSITIVE_INFINITY : (item.originalDuration ?? Number.POSITIVE_INFINITY)`。
提交走实体的字幕无裁剪分支（`domain/entities/TimelineItem.ts:420-422`，TL2-05 保留该分支仅供字幕使用）；与前一条字幕的重叠由 TL3-04 处理。

**回归测试**：`domain/machines/__tests__/dragMachine.subtitleEdges.test.ts`「a subtitle's left edge extends earlier like a still」；`store/slices/__tests__/dragSlice.subtitleTrim.test.ts`「a trim drag moves a subtitle's start earlier」。

#### TL3-04 手动移动 / 裁剪字幕产生重叠字幕

**现状 *[实测]***：字幕轨从不贴紧（`TimelineAggregate.ts:254`），`resizeItemAction / moveItemAction` / 跨轨提交都不钳制；预览绘制所有活动字幕（`playback/SubtitleLayer.ts:88-101`），导出按逐条窗口同样叠画。
S1[0,2] S2[2,4]，`resizeItemAction(S1, 'end', 3)` → `[["S1",0,3],["S2",2,4]]`；此后每次 Agent 编辑都带 `overlapWarning`（与 AG2-18 叠加）。

**修复**：
1. 新增 `domain/services/FreeLaneRules.ts`：
   ```ts
   export interface LanePeer { id: string; startTime: number; duration: number }
   /** 裁剪边缘钳制：起点边 ≥ 前一条的终点；终点边 ≤ 后一条的起点；始终保留 ≥ MIN_CLIP_DURATION_SECONDS。 */
   export function clampTrimEdge(peers: readonly LanePeer[], itemId: string, edge: 'start' | 'end', position: number, current: { startTime: number; duration: number }): number;
   /** 移动落点：空闲则原样返回；否则取能容纳的最近空隙起点（优先包含 start 的空隙，再按距离）；没有空隙返回 null。 */
   export function fitMove(peers: readonly LanePeer[], itemId: string, start: number, duration: number): number | null;
   ```
2. `store/actions/resizeItem.ts`：所属轨为 `subtitle` 时以 `clampTrimEdge` 替换 `newPosition`；结果与当前边缘相差 < 1e-6 时直接返回、不写历史。
3. `store/actions/moveItem.ts` 与 `dragSlice.commitCrossTrackMove` 目标为字幕轨时经 `fitMove`；`null` → 不写历史返回（拖拽已在 `commitMove` 回滚）。
4. 不修复既有重叠（旧数据 / AI / Agent 产生的），不做破坏性修复；拖拽预览仍显示未钳制位置，松手时对齐。

**回归测试**：`store/actions/__tests__/subtitleLane.test.ts`「trimming a subtitle past the next caption stops at its start」「moving a subtitle onto another caption is refused without history」；`domain/services/__tests__/FreeLaneRules.test.ts`「fitMove picks the nearest gap that fits」。

#### TL3-05 剪切工具点击隐藏轨上的片段静默无效

**现状 *[实测]***：`store/actions/splitItem.ts:59` `if (track.isLocked || !track.isVisible) continue;` 对 `scope === 'selected'` 同样生效；剪切点击（`TimelineItem.tsx:242-249`）只提示 `'too-close'`，结果 `'none'` 无反馈；隐藏轨仍可点击（`Track.tsx:588-593`，不透明度 0.3）。

**修复**：改为 `if (track.isLocked || (scope === 'playhead' && !track.isVisible)) continue;` 并更新 `:43-48` JSDoc；`TimelineItem.tsx` 剪切点击结果为 `'none'` 且轨道锁定时 `showWarning(t.timeline.messages.trackLocked)`。

**回归测试**：`store/actions/__tests__/splitItem.test.ts` 追加「cut tool splits a clip the user clicked on a hidden track」「playhead split still skips hidden tracks」。

#### TL3-06 `setCameraMotionAction` 在 store 层不检查轨道锁（加固）

**现状 *[实测]***：`store/actions/setCameraMotion.ts:35` 只过滤存在性；slice `updateItemCameraMotion`（`store/slices/timelineSlice.ts:401-412`）无锁检查；`TimelinePanel.tsx:252-264` `cameraMotionTargetIds` 总把打开者 id 放在首位（`:262`）且不复查资格。
第 2 轮附录 B「锁定轨拒绝」对该 action 在 store 层不成立。经 UI 仅在「弹窗打开期间轨道被锁定」时可达。

**修复**：`setCameraMotionAction` 以 `canApplyCameraMotion(found.item.toPlainObject(), found.track.toPlainObject())`（`playback/camera/eligibility`，先例 `resizeItem.ts:19` 引用 `playback/camera/splitRebase`）过滤目标；
全部被过滤时返回 `false` 且不写历史；`TimelinePanel.tsx:262` 仅在打开者仍符合资格时加入。

**回归测试**：`store/actions/__tests__/setCameraMotion.lock.test.ts`「camera motion is not written to a clip on a locked track」「an eligible clip in the same batch still receives the motion」。

#### TL2-05 无裁剪信息的旧条目：左边缘裁剪裁错端

**现状 *[实测]***：`domain/entities/TimelineItem.ts:420-422` 无裁剪分支只移动时间轴边缘，`clipStart` 保持 `undefined`；读取方把缺省视为 0（`CompositionAdapter.ts:148-150`、`ClipTimeMapping.ts:45-47`）；
打开项目 `projects/hydrateTimeline.ts:67` 不补齐，修复函数跳过无裁剪字段的条目（`lib/projectHydration.ts:116-118`、`TimelineRepository.ts:68-71`）。
`fromPlainObject({type:'video', startTime:0, duration:10, originalDuration:10})` → `resize('start', 2)` → `mapTimelineTimeToSourceTime(item, 2) === 0`（期望 2）；合成适配器报 clipEnd 10、duration 8（破坏 INV-3）。

**修复**：`resizeStartEdge` / `resizeEndEdge` 开头：若 `!this.isStill() && this._type !== 'subtitle' && this._clipStart == null`，先物化 `this._clipStart = TimePosition.create(0)`、`this._clipEnd = TimePosition.create(this._duration.value)`（与 `SplitService.resolveClipBounds` 缺省一致），再进入有裁剪分支（`originalDuration` 已知时以其为上界）。无裁剪分支只保留给字幕。

**回归测试**：`domain/entities/__tests__/TimelineItem.legacyTrim.test.ts`「left trim of a clip without clip info moves its in-point」「subtitle trim keeps no clip fields」。

#### TL2-22 Ctrl+C 复制后副本不被选中（选中部分；无声副本部分随 TL2-01 延后）

**现状**：`TimelinePanel.tsx:858` 构造 `newSelectedIds`、`:879` 写入，此后从未使用（`handleCopy` 于 `:895` 结束）；选区仍停在原片段。

**修复**：
1. 把复制逻辑移出 `TimelinePanel.tsx`（1446 行，I-7）到新文件 `lib/duplicateClips.ts`：
   ```ts
   export function duplicateSelectedClips(
     data: TimelineData,
     selectedIds: readonly string[],
     nameFor: (name: string) => string,
   ): { data: TimelineData; newIds: string[] };   // 跳过锁定轨；落点为轨道末尾（同现状）
   ```
2. `store/slices/selectionSlice.ts` 新增 `selectItems(itemIds: string[]): void`（`set({ selectedItems: [...itemIds] })`）。
3. `handleCopy`：`captureNextState()` 之后 `selectItems(newIds)` 并 `requestScrollItemIntoView(newIds[0])`。锁检查仍在首行（A17 允许名单不变）。
4. 不剥离 `audioDetached`（否则同时复制分离视频与其音频时会出现双份音频），无声副本随 TL2-01 处理。

**回归测试**：`lib/__tests__/duplicateClips.test.ts`「copies become the new selection」「copies land after the last clip of their track」。

#### ME-11 时长未知的视频上轨固定 5 s 且右边缘上限为 5 s

**现状 *[实测]***：`domain/services/ItemPlacementService.ts:43`（`material.duration || 5`）、`:192`、`:230-232`（非图片 `originalDuration = duration`）；实体上限 `TimelineItem.ts:447`、拖拽上限 `TimelineItem.tsx:281-283`。
ARK 状态时长可选（`src/lib/api/arkVideo.ts:28,48`）并被原样写入素材（`hooks/materialManagement/useMaterialGeneration.ts:136,161`）。无时长视频上轨后 `duration 5, originalDuration 5`，右拖到 12 仍为 5。

**修复**：
1. 新增 `src/components/video/lib/probeMediaDuration.ts`：
   ```ts
   export function probeMediaDuration(url: string, timeoutMs?: number): Promise<number | null>;  // 默认 10000
   ```
   分离的 `<video preload="metadata">`（音频同样可用），`loadedmetadata` 时时长有限且 > 0 则 resolve，错误 / 超时 resolve `null`；无论结果都 `removeAttribute('src')` + `load()` 清理。
2. `TimelinePanel.handleMaterialDrop` 与 VEI「添加到时间轴」入口：对 `video / audio` 且 `!(material.duration > 0)` 的素材，先 `await probeMediaDuration(selectPlaybackUrl(material, { purpose: 'preview' }) || material.serverUrl || material.url)`；
   await 之后**重新**检查 `isEditLocked`、重新解析并校验目标轨（可能已被锁定 / 删除）、组件仍挂载（mounted ref）；成功则 `addItemAction(…, { ...toMaterialData(material), duration: probed })`；
   探测失败保留 5 s 占位并 `showWarning(t.timeline.messages.durationUnknownFallback)`；探测超过 600 ms 仍未返回时 `showInfo(t.timeline.messages.probingDuration)`（每次拖放最多一次；v2 评审 RV3-21：最长 10 s 的等待不能没有反馈）。
3. 图片不受影响；连续快速拖放各自独立等待（可接受）。

**回归测试**：`lib/__tests__/probeMediaDuration.test.ts`「resolves the media element's duration」「times out to null」；`timeline/__tests__/materialDrop.unknownDuration.test.ts`「a video without a known duration is added with its probed length」「a drop is abandoned when the agent locks the timeline during the probe」。

#### ME-12 轨道头无静音按钮；锁定 / 显示切换进入撤销历史

**现状 *[实测]***：`Track.tsx:355-575` 轨道头有音量、编辑字幕、全选、锁定、显示、删除，无静音；`toggleTrackMuteAction` 无 UI 调用方。`store/actions/trackActions.ts:15-52` 的锁定 / 静音 / 显示均 `recordAction` + capture；
`TimelineAggregate.restore`（`:615-619`）整体替换轨道（含标志）。复现：撤销一次删除（可重做）→ 锁定轨道 → `canRedo === false`；Ctrl+Z → `isLocked === false`。
另：非历史的显示 / 锁定切换后撤销一次较早的内容编辑，标志也被快照改回——修复必须处理这一点。

**修复（S12 的「视图标志不入历史」部分）**：
1. `toggleTrackLockAction / toggleTrackVisibilityAction / toggleTrackMuteAction`：保留 `isEditLocked` 检查，直接调用 slice 方法，不 `recordAction / captureNextState`。
2. `TimelineAggregate.restore(snapshot)`：由快照构建后，对当前 `_tracks` 中同 id 的轨道，把现行 `isLocked / isMuted / isVisible` 复制到恢复出的轨道（新增内部方法 `Track.applyViewFlags(flags: { isLocked: boolean; isMuted: boolean; isVisible: boolean })`，绕过锁守卫）；仅存在于快照中的轨道保持快照标志。
   **外部整轴写入（v2 评审 RV3-05）**：「撤销 Agent 本轮」经 `replaceTimelineAction('agent-undo')` 写回轮次开始时的轨道 JSON，`replaceTimeline.ts:77-82` 会连同标志整体替换。复现：Agent 一轮后用户静音音乐轨 → 撤销本轮 → 音乐轨被静默取消静音，导出又包含音乐；锁定状态同样会被悄悄解除。新增纯模块 `domain/services/trackViewFlags.ts`：
   ```ts
   export const VIEW_FLAG_KEYS = ['isLocked', 'isMuted', 'isVisible'] as const;
   /** incoming 中与 current 同 id 的轨道复制 current 的三个标志；其余轨道原样返回；不修改入参。 */
   export function carryViewFlags(incoming: readonly TrackData[], current: readonly TrackData[]): TrackData[];
   ```
   `replaceTimelineAction`：`reason !== 'import'` 时先求 `tracks = carryViewFlags(data.tracks, get().exportToData().tracks)`，再以 `{ ...data, tracks }` 构造、比较（无变化不写历史）并 `importFromData({ ...view, tracks, … })`；`'import'` 保持写入数据的标志。`restore` 与 `trackPatch` 冲突比较使用同一 `VIEW_FLAG_KEYS`。
3. 决策 D-18：撤销 / 重做仍可改变「当前已锁定轨道」上的片段（属于历史回溯，不是新编辑）。
4. `Track.tsx`：`audio` 与非图片 `video` 轨在音量与锁定之间加入静音按钮：`onClick → toggleTrackMuteAction`、`aria-pressed={track.isMuted}`、`aria-label / title` 用既有 `t.timeline.track.mute / unmute`（`i18n.ts` 接口 `:451-452`、en `:3218-3219`、zh-CN `:5732-5733`）；
   锁定时禁用并在 title 追加 `trackLocked`；静音时轨道内容区 `opacity-60`。
5. Agent 撤销 `revertTrackPatches` 的冲突检测比较轨道 JSON：比较时忽略 `VIEW_FLAG_KEYS`。v2 评审 RV3-05 把此项由「按需」改为必做：标志不入历史之后，用户在 Agent 一轮之后切换锁定 / 静音 / 显示是常规操作，不应阻止撤销本轮。撤销写回经 `replaceTimelineAction('agent-undo')`，由上面的 `carryViewFlags` 保留现值，并以用例钉住。

**回归测试**：`store/actions/__tests__/trackActions.viewFlags.test.ts`「locking a track keeps the redo stack」「undoing an older edit keeps the track's current lock, mute and visibility」；
`timeline/__tests__/Track.muteButton.test.tsx`「mute button toggles isMuted and is disabled on a locked track」；`src/lib/video-editing-agent/__tests__/trackPatch.viewFlags.test.ts`「a user mute toggle does not block undoing an agent turn」；
`store/actions/__tests__/replaceTimeline.viewFlags.test.ts`（T96）「undoing an agent turn keeps the track the user muted afterwards muted」「a JSON import applies the imported track flags」「a write that differs only in view flags records no history」。

#### N-01 时间轴条目显示「素材缺失」标记

**现状**：`TimelineItem.tsx` 无缺失状态；预览静默跳过（`CompositionAdapter.ts:143-145`）；只有导出检测（`hooks/videoExportItems.ts:239-253` `findClipsWithMissingMaterial`）。删除在用素材后 Ctrl+Z 恢复片段 → 片段外观正常、预览不显示、导出拒绝。

**修复**：
1. 从 `findClipsWithMissingMaterial` 抽出并导出 `isClipMaterialMissing(item: TimelineItemData, materialsById: ReadonlyMap<string, MaterialItem>): boolean`（字幕除外；无 `materialId` 或 id 不在映射中即缺失），两处共用。
2. VEI 新增 `materialsLoaded: boolean`（素材库首次加载完成后置 true；现无此标志）传给 `TimelinePanel`；`TimelinePanel` `materialsById = useMemo(...)`，经 `TrackContainer → Track → TimelineItem` 传递 `isMaterialMissing?: (item) => boolean`（与 `localProxyStatusMap` 同模式），`materialsLoaded` 为 false 时不传。
3. `TimelineItem`：左上角红色「!」徽标（`z-10`、`role="img"`、`aria-label` 与 `title` 为 `t.timeline.track.materialMissing`），片段主体加红色虚线描边。

**回归测试**：`timeline/__tests__/TimelineItem.missingMaterial.test.tsx`「shows the missing-material badge when the clip's material is gone」「shows no badge before the material list has loaded」。

#### N-17 `DragCalculationService` 死代码与重复类型

**现状**：`domain/services/DragCalculationService.ts:244-255` 固定 8 px 热区；`calculateMovePosition / calculateResizePosition / snapToGrid / pixelsToTime / timeToPixels / detectInteractionType / RESIZE_HANDLE_WIDTH` 在 `src`（含测试）零调用，仅 `findSwapTarget` 被 `dragSlice.ts:314` 使用；
`domain/index.ts:52` 导出与状态机（`dragMachine.ts:41`）重名的 `InteractionType` 及 `ResizeResult`。

**修复**：删除上述无调用方法与常量；保留 `findSwapTarget`；删除 `domain/index.ts:52` 的重复导出；更新 `dragMachine.ts:11-12,21` 引用该服务常量的注释。

**回归测试**：`domain/__tests__/dragHitZones.singleSource.test.ts`「trim hot zones are defined only by the drag machine」（源码断言 `DragCalculationService` 不含 `detectInteractionType`）。

### 3.6 时间轴交互、键盘与可访问性（UI 组：UI3-01～UI3-14、TL2-07、TL2-08、TL2-10、TL2-11、TL2-12、TL2-13、TL2-14、TL2-24、N-02、N-12）

路径前缀 `src/components/video/timeline/`（除非另写），行号为 HEAD `e06dca4`。时间轴 `.tsx` 在 vitest 下无法直接导入（`jsx: "preserve"`），组件用例沿用 `ConfirmationDialog.focus.test.tsx` 的 `ts.transpileModule` 方式；
本组把第三份拷贝抽为共享助手 `__tests__/test-utils/compileComponent.ts`（含 `ResizeObserver` 桩与约 20 个模块映射，已由排查的 13 个探针验证）。

#### S16 鼠标手势生命周期（UI3-06，供 TL2-10 / TL2-12 / TL2-24 / UI3-01 共用）

**现状 *[实测]***：拖拽平移（`TrackContainer.tsx:211-241`）、标尺刮擦（`TimelineRuler.tsx:138-153`）、音量拖动（`VolumeSlider.tsx:301-324`）不处理窗口失焦、不检查 `buttons`；片段拖拽已处理（`TimelinePanel.tsx:483-492`）。
在空白轨道按下 → Alt+Tab 失焦 → 以 `buttons: 0` 移动鼠标 → 仍触发 `onScroll`、光标保持 `grabbing`（未按键也在平移）。

**修复**：新增 `lib/mouseGesture.ts`：
```ts
export interface MouseGestureHandlers {
  onMove: (event: MouseEvent) => void;
  onEnd: (event: MouseEvent | null) => void;   // 松开主键，或移动时发现主键已不再按下
  onCancel: () => void;                        // 窗口失焦
}
export function trackMouseGesture(handlers: MouseGestureHandlers, win?: Window): () => void;  // 返回幂等的清理函数
```
挂 `document` 的 `mousemove / mouseup` 与 `window` 的 `blur`；`(event.buttons & 1) === 0` 的移动视为结束；失焦取消；三个消费方全部改用它，并在卸载时调用清理函数。

**回归测试**：`lib/__tests__/mouseGesture.test.ts`「window blur cancels the gesture and detaches listeners」「a move without the primary button ends the gesture」「the disposer is idempotent」。

#### TL2-07 Ctrl+滚轮缩放不以光标为锚点、`preventDefault` 无效

**现状 *[实测]***：`TrackContainer.tsx:279-287,309`、`TimelineRuler.tsx:278-286,416` 使用 React `onWheel`——React 在根节点以被动监听注册 wheel，`preventDefault` 不生效（`defaultPrevented=false`）；
只改 `zoomLevel`、不改 `scrollLeft`，光标下内容滑走；步进只取 `deltaY` 符号，触控板捏合（大量极小事件）每个事件 ×1.15；标尺 `overflow-x-hidden`，其上的横向滚轮无效；缩放按钮（`TimelineRuler.tsx:259-276`）同样不锚定；
来自 portal（音量浮层）的 wheel 经 React 冒泡也会缩放时间轴。

**修复**：
1. `lib/zoomAnchor.ts`：`export function computeAnchoredScrollLeft(input: { timeAtAnchor: number; anchorOffsetPx: number; pixelsPerSecond: number }): number` → `Math.max(0, time * pps - offset)`。
2. `hooks/useTimelineWheel.ts`：以原生 `addEventListener('wheel', handler, { passive: false })` 挂到轨道滚动容器与标尺滚动容器：
   - Ctrl / Meta：`preventDefault()`；系数 `Math.exp(-clamp(deltaY * (deltaMode === 1 ? 16 : 1), -100, 100) * 0.002)`，结果钳制到 `[ZOOM_MIN, ZOOM_MAX]`；
     锚点：轨道容器 `clientX - rect.left - TRACK_HEADER_WIDTH`，标尺 `clientX - rect.left`，钳制 ≥ 0；`timeAtAnchor = (scrollLeft + anchor) / pps`；把 `{ timeAtAnchor, anchor }` 存入 `TimelinePanel` 的 `pendingZoomAnchorRef`。
   - 标尺上无修饰键：把 `deltaX`（按住 Shift 时为 `deltaY`）转发给轨道滚动容器。
3. `TimelinePanel`：`useLayoutEffect(() => { 取 pendingZoomAnchorRef，写 trackScrollRef.current.scrollLeft = computeAnchoredScrollLeft(...)，清空 ref }, [zoomLevel])`（既有 onScroll 同步标尺与 store）。
4. `TimelineRuler` 新增 `onZoomRequest?: (zoom: number, anchor: { timeAtAnchor: number; anchorOffsetPx: number }) => void`；缩放按钮在播放头可见时以播放头为锚、否则以视口中心为锚；未传入时回退 `setZoomLevel`。
5. 删除两处 React `onWheel`。

**回归测试**：`lib/__tests__/zoomAnchor.test.ts`「keeps the time under the cursor fixed when zooming in and out」「clamps scrollLeft at 0」；`hooks/__tests__/useTimelineWheel.test.ts`「ctrl+wheel is cancelled by a non-passive native listener」「a trackpad pinch delta of −4 changes zoom by less than 2%」。

#### TL2-08 点击轨道空白处无法取消选择

**现状 *[实测]***：`TrackContainer.tsx:133-137,305` 要求点击目标就是滚动容器本身，而轨道空白点击的目标是 `.track-content`（`Track.tsx:580-598`）。选中 `a1` 后在 `.track-content` 上按下 / 松开 / 点击 → `selectedItems` 仍为 `['a1']`。

**修复**：删除 `handleContainerClick` 与 `onClick`；`handleMouseDown` 记录 `pressRef = { x, y, onLane: !!target.closest('.track-content') && !target.closest('[data-timeline-item]') }`；
松开（经 S16 `onEnd`）时若 `onLane`、位移 < `CLICK_SLOP_PX = 4`、无 Ctrl / Meta / Shift → `deselectAll()`。

**回归测试**：`__tests__/TrackContainer.deselect.test.ts`「a still click on an empty lane clears the selection」「a drag-scroll pan on an empty lane keeps the selection」「Ctrl+click on an empty lane keeps the selection」。

#### TL2-10 音量滑块拖动中按 Esc 仍提交；卸载后监听残留

**现状 *[实测]***：Esc 处理（`VolumeSlider.tsx:224-235`）不看 `isDraggingRef`；拖动监听（`301-324`，触摸 `342-366`）只在 mouseup / touchend 移除；浮层关闭即卸载（`Track.tsx:394`），不清理监听。
拖到 40（实时预览把 40 写入 store）→ Esc（浮层消失）→ 松开 → 音量停在 40 且 `canUndo` 为 true。RC2-18 修了提交路径，但没有取消路径。

**修复**：
1. `store/actions/trackActions.ts` 新增 `revertTrackVolumePreviewAction(get, trackId: string, preGestureVolume: number): void`：`setTrackVolume(trackId, clampVolume(pre))`，不写历史、不查锁（恢复总是安全的，与提交 action 首行一致）。
2. `VolumeSlider`：拖动清理函数存入 `dragDisposeRef`（经 S16）；拖动中 Esc：`stopImmediatePropagation()` + `preventDefault()`、`cancelLivePreview()`、`revertTrackVolumePreviewAction`、`updateVolume(pre)`、清理，浮层保持打开（再按一次 Esc 才关闭）；
   拖动中卸载：恢复并清理；窗口失焦 / `touchcancel`：同样取消。

**回归测试**：`__tests__/VolumeSlider.gesture.test.ts`「Escape mid-drag restores the pre-gesture volume and records no history」「unmount mid-drag detaches document listeners and reverts the preview」「window blur mid-drag cancels the gesture」。

#### TL2-11 句子分段条忽略 `clipStart`；「句」硬编码中文

**现状 *[实测]***：`SentenceSegmentBar.tsx:47-55` 用绝对 `start_time / duration`、无 `clipStart` 参数；`TimelineItem.tsx:528-533` 只传 `duration`，`:556` 硬编码 `{n} 句`；`domain/services/SplitService.ts:108-127` 把 `sentenceSegments` 原样复制给两半。
切分后的右半（源 [10,15]、时长 5）：源 10 s 处的句子渲染在 `left:200%`，源 0–5 s 的句子渲染在 `0%`。

**修复**：
1. `lib/sentenceWindow.ts`：
   ```ts
   export interface ProjectedSentence<S> { sentence: S; leftPct: number; widthPct: number }
   export function projectSentencesOntoClip<S extends { start_time: number; end_time: number }>(sentences: readonly S[], clipStart: number, duration: number): ProjectedSentence<S>[];
   ```
   `visStart = max(start_time, clipStart)`、`visEnd = min(end_time, clipStart + duration)`；可见部分 ≤ 1e-3 s 跳过；`duration ≤ 0` 返回 `[]`；百分比相对 `clipStart`。
2. `SentenceSegmentBar` 新增 `clipStart = 0` 属性，序号标签阈值按可见宽度像素判断；删除被滚动容器裁剪、与 `title` 重复的 DOM 悬停卡片（`:107-138`）。
3. `TimelineItem` 传 `clipStart={item.clipStart ?? 0}`；数量徽标用可见句数与新 key `timeline.sentenceSegment.sentenceCount`；可见 0 句时回退波形分支。不改领域数据。

**回归测试**：`lib/__tests__/sentenceWindow.test.ts`「right half of a split shows only in-window sentences starting at 0%」「a sentence straddling clipStart is clipped to its visible part」「zero duration yields no blocks」。

#### TL2-12 工具栏状态恒为「选择」、剪切按钮无 `aria-pressed`、标尺任意鼠标键跳转且不聚焦

**现状**：`TimelineToolbar.tsx:424-426` 恒显示 `toolbar.select`；`renderIconButton`（`326-357`）无 `aria-pressed`；`TimelineRuler.tsx:129-136` 不检查按键，且 `preventDefault` 阻止滑块获得焦点。*[实测]* 右键按下跳到 2 s。
（原「卸载后刮擦监听继续跳转」子项 *[实测]* 不成立：残留监听因 ref 为 null 不再跳转——但仍按 S16 清理。）

**修复**：
1. 状态文字 `t.timeline.status.currentTool.replace('{tool}', isCutActive ? t.timeline.toolbar.cut : t.timeline.toolbar.select)`，所在元素 `aria-live="polite"`。
2. 以类型化 `interface ToolbarButtonConfig { id: string; icon: ReactNode; label: string; shortcut?: string; onClick: () => void; disabled?: boolean; toggle?: boolean; isActive?: boolean }` 取代 `button: any`；`cutButton` 设 `toggle: true`；渲染 `aria-pressed={button.toggle ? Boolean(button.isActive) : undefined}`。
3. 标尺：`if (e.button !== 0) return;` 放在 `preventDefault` 之前；未禁用时 `e.currentTarget.focus({ preventScroll: true })`；监听经 S16，卸载清理。

**回归测试**：`__tests__/TimelineRuler.scrub.test.ts`「right-button press does not seek」「left press focuses the ruler slider」「unmount mid-scrub disposes document listeners」；`__tests__/TimelineToolbar.toolState.test.ts`「status line names Cut when the cut tool is active」「cut toggle exposes aria-pressed」。

#### TL2-13 + UI3-11 空格：键盘聚焦的控件上应激活控件；按住空格按重复速率切换播放

**现状 *[实测]***：`shortcutOwnership.ts:39-53` 有意忽略聚焦的按钮与 `defaultPrevented`；`VideoEditingInterface.tsx:404-409` 在 keydown `preventDefault`，抑制了按钮原生激活——第 1 轮总结「空格不会被聚焦的片段 / 按钮抢走」与代码相反。
`shouldGlobalSpaceTogglePlayback({ target: 聚焦的 <button> })` 返回 true。UI3-11：该处理无 `event.repeat` 检查，按住空格约每秒 30 次播放 / 暂停。
根因：没有区分「鼠标聚焦」（应播放，NLE 惯例）与「键盘聚焦」（应激活控件）。

**修复**：
1. 新增 `inputModality.ts`：
   ```ts
   export type InputModality = 'keyboard' | 'pointer';
   export function getInputModality(): InputModality;
   export function installInputModalityTracking(doc: Document): () => void;
   ```
   捕获阶段：Tab（含 Shift+Tab）的 keydown 置 `'keyboard'`；方向键 / Home / End / PageUp / PageDown 只在事件目标位于复合控件内（`[role="menu"], [role="menubar"], [role="listbox"], [role="radiogroup"], [role="tablist"], [role="toolbar"], [role="grid"], [role="tree"], [role="slider"]`）时置 `'keyboard'`；pointerdown 置 `'pointer'`；空格本身不改变模态。
   *（v2 评审 RV3-06）* 时间轴没有全局方向键快捷键。若方向键一律切到键盘模态，「鼠标点击片段或工具栏按钮 → 习惯性按方向键 → 按空格」会把空格让给聚焦的按钮（可能触发已聚焦的删除 / 剪切按钮），而不是播放。决策见 D-33。
2. `shortcutOwnership.ts` 新增纯函数（保留旧函数一个版本后删除，调用方同时迁移）：
   ```ts
   export type GlobalSpaceAction = 'toggle' | 'swallow' | 'yield';
   export function resolveGlobalSpaceAction(event: Pick<KeyboardEvent, 'code' | 'target' | 'repeat'>, modality: InputModality): GlobalSpaceAction;
   ```
   非空格、文本编辑目标（现有选择器 / contentEditable）、模态框内，或 `modality === 'keyboard'` 且目标匹配
   `button, a[href], summary, select, input[type="checkbox"], input[type="radio"], [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"]` → `'yield'`；
   `repeat` → `'swallow'`；否则 `'toggle'`。
3. VEI 在既有空格 effect 中安装模态跟踪：`'swallow'` 只 `preventDefault`；`'yield'` 直接返回；`'toggle'` 执行现有逻辑。效果：Tab 到片段按空格只选中片段；鼠标点过片段或按钮后按空格照常播放。

**回归测试**：`__tests__/shortcutOwnership.test.ts` 追加「Space yields to a keyboard-focused toolbar button」「Space still plays after a button was clicked with the mouse」「auto-repeated Space is swallowed without toggling」；`__tests__/inputModality.test.ts`「arrow keys outside a composite widget keep pointer modality」。

#### TL2-14 + UI3-09 主题色透明度修饰无效、`hsl()` 包裹十六进制变量（范围化修复）

**现状 *[实测 Tailwind 3.4.0 编译]***：`tailwind.config.js:35-86` 以 `var(--x)` 定义颜色、无 `<alpha-value>`；`src/styles/globals.css:7-25,81-100,125-141` 以十六进制定义变量。
`bg-primary/10`、`/15`、`/90`、`border-primary/30`、`bg-muted/50`、`text-foreground/90`、`ring-foreground/15`、`bg-destructive/10`、`bg-card/20` 不生成任何 CSS（`bg-white/70` 正常）。
影响 116 个 `.tsx` 共 581 处；时间轴 / 播放器 / 运镜 / 字幕切片约 41 处；`ring-foreground/15`（`TimelineToolbar.tsx:336`）+ `focus-visible:outline-none` 使工具栏按钮**没有可见焦点环**（WCAG 2.4.7）。
UI3-09：`hsl(var(--muted-foreground))` 对十六进制变量在计算值阶段无效 → 透明：时间轴轨道滚动条滑块（`src/styles/video-editing.css:1122,1128`，时间轴唯一的横向位置提示）、`190,197`、`312,317`、`579,584`、`1304,1310`，
`TrackContainer.tsx:411,419` 边缘渐隐，`projects/ProjectSidebar.tsx:139`、`VideoChatWindow/timeline/TimelineConnector.tsx:42`。

**修复（全局修复会让 581 处从未显示过的着色同时出现，需要全应用视觉走查——列入附录 A；本轮只做范围化）**：
1. `tailwind.config.js` `extend.colors` 新增按需使用的别名（编译已验证裸类、`/NN`、`hover:`、`ring-`、`border-`、`text-` 均正确）：
   `'primary-a': 'color-mix(in srgb, var(--primary) calc(<alpha-value> * 100%), transparent)'`，同式 `muted-a / foreground-a / accent-a / background-a / destructive-a / border-a`。
2. 只迁移「唯一状态提示」的着色：剪切按钮激活 `bg-primary/15`（`TimelineToolbar.tsx:340`）、选中计数徽标 `bg-primary/10`（`:414`）、全选激活 / 悬停（`Track.tsx:466-467`）、可放置轨道高亮（`Track.tsx:583,644`）、
   字幕弹窗与运镜弹窗主按钮悬停 `hover:bg-primary/90`（`SubtitleEditModal.tsx:837`、`CameraMotionModal.tsx:544`）；工具栏焦点环改为 `focus-visible:ring-2 focus-visible:ring-ring`。
3. UI3-09 的 14 处 `hsl(var(--x))`：滚动条滑块 `color-mix(in srgb, var(--muted-foreground) 40%, transparent)`（悬停 60%）、边缘渐隐 `var(--muted)`、`ProjectSidebar` `var(--primary)`、`TimelineConnector` `color-mix(in srgb, var(--primary) 40%, transparent)`。

**回归测试**：`src/styles/__tests__/themeTokens.test.ts`（node 环境源码扫描）「no theme token is wrapped in hsl()」「timeline slice uses alpha-capable aliases for theme tints」；门禁 A21。

#### TL2-24 + UI3-12 播放时视图不跟随播放头；store `isPlaying` 从不写入；拖拽中滚动使片段脱离光标

**现状**：时间轴无跟随代码；`timelineSlice.ts:505-509` `setPlaying` 全仓零调用，播放状态只在 `VideoPlayerPanel.tsx:126` `isCompositionPlaying`，标尺「播放中」标识（`TimelineRuler.tsx:447-454`）从不显示，发给所有者的状态恒为 `isPlaying: false`；
片段拖拽 `deltaX`（`TimelinePanel.tsx:450`）不含滚动偏移，拖拽中 Shift+滚轮会让片段脱离光标。

**修复**：
1. **播放状态镜像**：`VideoPlayerPanel.tsx` 在 `:126` 之后 `useEffect(() => { useTimelineStore.getState().setPlaying(isCompositionPlaying); }, [isCompositionPlaying])`，卸载时置 false（`setPlaying` 为视图状态，不在 A17 名单的变更方法内）；
   从 `computeShapeJson`（`TimelinePanel.tsx:211`）移除 `isPlaying`，避免播放 / 暂停触发时间轴状态上报（自动保存与合成抖动）。
2. `lib/followPlayhead.ts`：
   ```ts
   export function computeFollowScrollLeft(input: { playheadPx: number; scrollLeft: number; laneViewportWidth: number; maxScrollLeft: number; marginPx?: number; leadRatio?: number }): number | null;
   ```
   播放头位于 `[scrollLeft, scrollLeft + lane - margin]` 内返回 `null`；否则返回 `clamp(playheadPx - lane * leadRatio, 0, maxScrollLeft)`（翻页式跳转；默认 margin 48、leadRatio 0.1）。
3. `hooks/useFollowPlayhead.ts({ trackScrollRef })`：订阅 `currentTime / isPlaying / zoomLevel`；播放中、非交互、未挂起时写 `el.scrollLeft`；车道宽 `clientWidth - TRACK_HEADER_WIDTH`；`playheadPx = currentTime * zoomLevel * 50`（与现有像素换算常量一致，实现时引用同一常量）；
   播放期间任一滚动容器上的原生 `wheel / pointerdown` 挂起跟随，直到下一次「暂停→播放」（不监听 `scroll`，程序化滚动不会挂起）。
4. **拖拽滚动补偿**：拖拽开始记录 `dragStartScrollLeftRef`；`deltaX = e.clientX - dragStartX + (trackScrollRef.current.scrollLeft - dragStartScrollLeft)`；滚动事件期间补发一次补偿后的 `POINTER_MOVE`；`endDrag` 前同样补发。
5. 刮擦 / 拖拽到视口边缘的自动滚动列入附录 A（需要 RAF 循环与重派发，单独走查）。

**回归测试**：`lib/__tests__/followPlayhead.test.ts`「pages the view when the playhead passes the right margin」「returns null while the playhead is inside the view」；`hooks/__tests__/useFollowPlayhead.test.ts`「does not move the view while paused」「a user wheel during playback suspends following until the next play」；
`VideoPlayerPanel/__tests__/playStateMirror.test.ts`「the ruler shows Playing while the compositor plays」；`__tests__/TimelinePanel.dragScroll.test.ts`「drag delta includes the scroll offset」。

#### N-02 图片叠加键盘微调

**现状**：`VideoPlayerPanel/ImageOverlay.tsx:269-288` 根节点无 `tabIndex / role / label`；键盘只处理手势中的 Esc（`226-236`）；选中只能用指针（`139`）。

**修复**：
1. 根节点 `tabIndex={0}`、`role="group"`、`aria-label={t.imageOverlay.overlayLabel}`、`onFocus → onSelect`、`focus-visible` 焦点环；PV3-04 `readOnly` 时仍可聚焦但不响应方向键。
2. `imageOverlayGeometry.ts` 新纯函数 `nudgeImagePosition(position: ImagePosition, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', large: boolean): ImagePosition`：步长 0.01（Shift 0.1）；x 钳制 `[0, 1 - width]`、y 钳制 `[0, 1 - height]`，再经 `clampImagePosition`。
3. `onKeyDown`（无 Alt / Ctrl / Meta、无进行中的指针手势）：`preventDefault()` + `stopPropagation()`；一串按键的第一个记录 `nudgeStartRef = safePosition`；实时 `onPositionChange(next)`，存 `nudgeLatestRef`，重置 `NUDGE_COMMIT_IDLE_MS = 400` 定时器；
   `flushNudge` 清定时器，`hasPositionChanged(start, latest)` 时 `onGestureEnd(imageId, latest)`（一条历史，经 PV3-04 的提交判定）；Esc 于一串按键中：`onPositionChange(start)`、不提交；Enter：先 flush 再 `onConfirm`；失焦 / 卸载 / 指针手势开始：flush。

**回归测试**：`VideoPlayerPanel/__tests__/ImageOverlay.keyboardNudge.test.ts`（fake timers）「ArrowRight moves 1% live and commits once after 400 ms idle」「Shift+ArrowDown moves 10% and clamps to the frame」「Escape during a nudge burst reverts without committing」。

#### N-12 Agent 执行时 `inert` 冻结已打开的弹窗

**现状**：`VideoEditingInterface.tsx:2275-2280` 在时间轴区域设置 `inert`；`TimelinePanel.tsx:1404-1441` 在该子树内（无 portal）渲染运镜弹窗（经 `components/ui/Modal.tsx:65-86`）、字幕编辑弹窗（`SubtitleEditModal.tsx:741-746`）、确认框（`components/ui/ConfirmationDialog.tsx:150-156`）。
打开字幕编辑后启动 Agent：取消、×、输入框都点不了；Esc 也失效（焦点被 `inert` 挪到 body，React `onKeyDown` 挂在遮罩上）；字幕替换确认框按钮不可用、promise 挂起，S 键被 `isConfirmPending`（`TimelinePanel.tsx:1014`）阻塞到执行结束；
inert 的遮罩可被点穿（命中测试忽略 inert），点击落到下面的编辑器上。

**修复**：`TimelinePanel` 中 `const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)`，挂载 effect 置为 `document.body`；三个弹窗包在 `portalHost && createPortal(<>…</>, portalHost)` 中。
VEI 中 TimelinePanel 的祖先无 React 事件处理（VEI 2080-2300 已核对），经 portal 的事件冒泡安全；保存 / 应用仍由既有 `isEditLocked` 属性置灰；焦点回到 inert 的打开者时回落 body（可接受）。全局为共享 `Modal / ConfirmationDialog` 加 portal 风险更高，列入附录 A。

**回归测试**：`__tests__/TimelinePanel.modalPortal.test.ts`「subtitle, camera-motion and replace-confirm dialogs render outside the timeline section」。

#### UI3-01 音量浮层中的手势会平移时间轴

**现状 *[实测]***：浮层是轨道头的 React 子节点（`Track.tsx:394`），但 portal 到 body（`VolumeSlider.tsx:545`）；React 事件经 portal 冒泡到 `TrackContainer.tsx:305-309`，`isPointerOverInteractiveArea`（`141-147`）用 DOM `closest` 对 portal 节点返回 null；只有滑轨本身阻止冒泡（`VolumeSlider.tsx:266-274`）。
在浮层「100%」标签上按下 → 滚动容器光标变为 `grabbing`，随后移动鼠标调用 `onScroll`。

**修复**：`handleMouseDown` 与 `handleMouseMove` 首行 `if (!(e.currentTarget as Node).contains(e.target as Node)) return;`；wheel 由 TL2-07 原生监听覆盖。

**回归测试**：`__tests__/TrackContainer.portalEvents.test.ts`「pressing inside the volume popover does not start drag-scroll」「an empty-lane press still starts drag-scroll」。

#### UI3-02 关闭音量浮层后焦点掉到 `<body>`

**现状 *[实测]***：「关闭时还原焦点」分支（`VolumeSlider.tsx:101-109`）从不执行，因为 `Track.tsx:394` 关闭即卸载组件。聚焦音量按钮 → 打开 → 聚焦滑块 → Esc → `document.activeElement === body`。

**修复**：挂载时 `useLayoutEffect(() => { openerRef.current = document.activeElement as HTMLElement | null; return () => { 若焦点在浮层内或为 body / null，且 openerRef.current?.isConnected，则 openerRef.current.focus({ preventScroll: true }) }; }, [])`（在打开时的 rAF 聚焦之前）；删除死分支。

**回归测试**：`__tests__/VolumeSlider.focusReturn.test.ts`「Escape returns focus to the track's volume button」「an outside click leaves focus where the user clicked」。

#### UI3-03 片段根节点吞掉内部按钮的键盘激活

**现状 *[实测]***：`TimelineItem.tsx:382-395` 对任何后代目标的 Enter / 空格 `preventDefault`，命中运镜徽标（`699-726`）与本地下载「重试」按钮（`TimelineItemDownloadOverlay.tsx:150-162`）；两者 keydown 均 `defaultPrevented = true`。

**修复**：`handleItemKeyDown` 首行 `if (e.target !== e.currentTarget) return;`。把按钮移出 `role=button`（嵌套交互 ARIA）列入附录 A。

**回归测试**：`__tests__/TimelineItem.nestedControls.test.ts`「Enter on the camera-motion badge is not default-prevented by the clip」「Space on the focused clip still selects it」。

#### UI3-04 行内字幕编辑器与片段手势冲突

**现状 *[实测 ×2]***：`handlePointerDown`（`TimelineItem.tsx:229-231`）与 `handleDoubleClick`（`312-323`）不检查 `isEditingSubtitle`，输入框是后代（`622-635`）。在输入框内按下即 `startDrag` 并 `preventDefault`——拖选文字会移动片段、无法放置光标；
输入「typed but unsaved」后双击单词，值被重置为存储的「hello」（`setEditingText(item.text)`）。

**修复**：两个处理函数首行 `if (isEditingSubtitle) { e.stopPropagation(); return; }`（不 `preventDefault`）；编辑时 `handleHoverMove` 直接返回、光标为 `text`、隐藏裁剪手柄。

**回归测试**：`__tests__/TimelineItem.inlineSubtitleEdit.test.ts`「pressing inside the inline editor does not start a clip drag」「double-clicking a word keeps the typed text」。

#### UI3-05 工具栏提示从不显示；与原生 `title` 重复

**现状**：提示 `div` 在 `<button>` 内（`TimelineToolbar.tsx:363-374`），而 `.timeline-toolbar button { overflow: hidden; position: relative }`（`video-editing.css:667-671`）把它裁到 32×32，区块本身也 `overflow: hidden`（`:18-22`）；
原生 `title` 与自定义提示重复：`TimelineToolbar.tsx:350-356`、`Track.tsx:375,418,455,496,525,561`、`TimelineRuler.tsx:307`。

**修复**：每个工具栏按钮包在既有 `PortalTooltip` 中，删除按钮内提示与 `title`（保留 `aria-label`）；提示文本只构造一次（现写了 3 遍）；有自定义提示处一律删除 `title`；焦点环见 TL2-14。

**回归测试**：`__tests__/TimelineToolbar.tooltip.test.ts`「hovering a toolbar button portals its tooltip to document.body」「no native title alongside a custom tooltip」。

#### UI3-07 `onClose` 引用变化时 Modal 抢走焦点；运镜弹窗用原生 `window.confirm`

**现状 *[实测]***：`components/ui/Modal.tsx:30-63` effect 依赖 `[isOpen, onClose]`，清理时把焦点给背后的打开者、建立时聚焦弹窗根；运镜弹窗传入的 `handleRequestClose` 依赖 `isDirty`（`CameraMotionModal.tsx:331-340,352`），参数控件每次变化都打补丁（`ParameterControls.tsx:98-191`）。
编辑已有运镜时，强度滑块第一次按方向键或窗口字段输入第一个数字即翻转 `isDirty`，焦点离开控件，后续按键丢失。放弃确认用原生阻塞、无主题的 `window.confirm`（`CameraMotionModal.tsx:336-337`）。

**修复**：
1. `Modal`：`onClose` 存入 ref（layout effect 更新），effect 只依赖 `[isOpen]`，按键处理调用 `onCloseRef.current()`。影响 6 个使用方（CameraMotionModal、NarrationDirectScriptModal、VideoUnderstandingModePlaceholderModal、SetupGuideDialog、CategoryFormDialog、ProjectFormDialog），均为严格改进。
2. 运镜放弃确认改用 `ConfirmationDialog`（嵌套在弹窗内渲染，确认框打开时弹窗自身按键不响应，同第 2 轮 IM2-11 做法），标题 `timeline.cameraMotion.discardTitle`、正文沿用 `discardConfirm`、确认按钮 `discardAction`、`variant="danger"`。

**回归测试**：`src/components/ui/__tests__/Modal.focus.test.ts`「re-rendering with a new onClose keeps focus in the focused field」「Escape invokes the latest onClose」；`CameraMotionModal/__tests__/CameraMotionModal.discard.test.tsx`「discarding edits asks with an in-app dialog, not window.confirm」。

#### UI3-08 确认框层级低于 Agent 浮窗；默认按钮文案为中文

**现状**：`ConfirmationDialog.tsx:151` `z-[200]` 低于 `z-dock`（850）与 `z-dock-panel`（860）（`AgentChatFloatingButton.tsx:58`、`AgentChatFloatingPanel.tsx:83`），与 `tailwind.config.js` 注释「所有固定模态根使用 `z-modal`」不符；默认 `confirmText='确认' cancelText='取消'`（`:22-23`）。
字幕替换确认框打开时，Agent 浮窗按钮与面板在遮罩之上仍可点击——可以在确认 promise 挂起期间启动 Agent。

**修复**：改为 `z-modal`；默认文案取 `useLocale()` 的 `t.common.confirm / t.common.cancel`（已存在）；字幕编辑弹窗内的嵌套使用仍叠在其卡片之上；既有测试的模块映射补 LocaleContext。
共享 `Modal.tsx:69` 的默认根类 `z-50` 同样改为 `z-modal`（v2 评审 RV3-15）：运镜、项目、分类弹窗没有传 `className`，同样低于 Agent 浮窗（`z-dock` 850 / `z-dock-panel` 860）；传了自定义 `className` 的 `SetupGuideDialog`、`NarrationDirectScriptModal`、`VideoUnderstandingModePlaceholderModal` 不受影响。

**回归测试**：扩展 `src/components/ui/__tests__/ConfirmationDialog.focus.test.tsx`「dialog root sits on the z-modal layer above the agent dock」「default button labels follow the active locale」；`src/components/ui/__tests__/Modal.focus.test.ts` 追加「the default modal root sits on the z-modal layer」。

#### UI3-10 横向滚动时轨道头滚出视口

**现状**：`.track-controls`（`Track.tsx:332-337`）位于横向滚动内容内（`TrackContainer.tsx:318-326`）；时间轴与 `video-editing.css:708-713` 无 `sticky`，而标尺控制区（`TimelineRuler.tsx:293-297`）固定。长时间轴右滚后轨道名称与锁定 / 音量 / 显示 / 删除按钮消失，与固定的标尺控制区错位。

**修复**：轨道头加 `sticky left-0 z-20`（`bg-muted` 不透明；片段 z ≤ 10，`timelineItemStyles.ts:60`；轨道播放头 z 5）；左侧渐隐移到 `left: TRACK_HEADER_WIDTH`；
抽出纯函数 `lib/clipVisibility.ts` `isClipVisibleInLane({ elLeft, elRight, scrollLeft, clientWidth, headerWidth }): boolean`，`TimelinePanel.tsx:532-537` 改用它（被轨道头遮住的片段视为不可见）。

**回归测试**：`__tests__/Track.stickyHeader.test.ts`「track header column is sticky at the left edge above clips」；`lib/__tests__/clipVisibility.test.ts`「a clip under the sticky header counts as hidden」。

#### UI3-13 片段拖拽中按 Esc 同时清空选区

**现状**：窗口 keydown（`TimelinePanel.tsx:477-481`）取消拖拽；文档监听（`631-677`）先执行，把 Esc 解析为 `'deselect'`（`625-627`），它不在 `MUTATING_TIMELINE_SHORTCUTS`（`shortcutOwnership.ts:73-83`）中，`isInteracting` 守卫（`671-674`）放行。

**修复**：`handleKeyDown` 解析后 `if (shortcut === 'deselect' && store.isInteracting) return;`（此时 Esc 归拖拽监听所有）；以纯谓词 `shouldShortcutRunDuringInteraction(shortcut)` 放入 `shortcutOwnership.ts`。

**回归测试**：`__tests__/shortcutOwnership.test.ts` 追加「Escape during a drag only cancels the drag」「Escape when idle deselects」。

#### UI3-14 时间轴面板根节点是无标签、不可见的 Tab 停靠点

**现状**：`TimelinePanel.tsx:1366-1369` `tabIndex={0}`，无角色、无可访问名称、无焦点样式。

**修复**：`tabIndex={-1}`（保留点击聚焦，使快捷键可用）、`role="region"`、`aria-label={t.timeline.panelAriaLabel}`。

**回归测试**：`__tests__/TimelinePanel.region.test.ts`（源码级）「the timeline panel is a labelled region outside the Tab order」。

### 3.7 剪辑 Agent（AG 组：AG3-01～AG3-06、AG2-03、AG2-04、AG2-05、AG2-13、AG2-17、AG2-18、AG2-20、AG2-21、N-10、N-19、N-21）

路径前缀 `src/lib/video-editing-agent/`（除非另写），行号为 HEAD `e06dca4`。

#### AG3-01 SSE 解析：事件的结束空行落在下一个网络块时整条事件被静默丢弃（S14）

**现状 *[实测]***：`SSEStreamManager.ts:406-453` `parseSSEBuffer` 中 `currentData / currentId` 是**每次调用的局部变量**，而 `id:` / `data:` 行在看到空行之前已从缓冲区移除；`flushBuffer`（`:459-492`）只在流结束时运行。
`parseSSEBuffer('id: 1\ndata: {...}\n')` 后 `parseSSEBuffer('\n')` → 0 个事件。端到端：块 `[id:3 data:{tool_result delete_clip}\n]`、`[\n]`、`[id:4 data:[DONE]\n\n]` 只投递 `agent_end`——服务端已删除片段，客户端从未应用，卡片停在「执行中」，后续操作基于不同布局。
大帧（`get_timeline`、`list_materials`、分镜操作）会被拆成多次读取，边界任意，因此并非理论问题。

**修复**：
1. 实例字段 `private pendingDataLines: string[] = []`、`private pendingId: number | null = null`。
2. 逐行：去掉结尾 `\r`；`:` 开头为注释跳过；`id:` 设置 `pendingId`（兼容 `id:` 后无空格）；`data:` 推入去掉**一个**前导空格后的值（多行 `data` 以 `\n` 连接，符合 SSE 规范）；空行在 `pendingDataLines.length > 0` 时派发并重置。
3. `flushBuffer` 先处理剩余的不完整行，再派发尚存的 pending；`resetForRestart` 清空 pending。

**回归测试**：`__tests__/sseStreamManager.parse.test.ts`「an event whose blank line arrives in the next chunk is delivered」「id and data lines split across chunks keep their event id」「a restart discards a half-received event」。

#### AG3-02 服务端无活动超时：错误从未到达客户端，且本轮被记为「用户停止」（S14）

**现状 *[实测]***：`src/app/api/video-editing-agent/chat/route.ts:395` `triggerAbort` 先发送 `cancelled`，`:470-476` 再拒绝，`:571-576` 之后才发送 `error`；
`SSEStreamManager.ts:367-372,547-553` 读到 `cancelled` 即停止；`AgentEventRouter.ts:110-120` 假定错误随后到达；`markCancelled` 设置 `isCancelled`，于是 `messageConverter.ts:51-52,160-168` 向下一轮注入「上一轮被用户停止」。
流 `[cancelled(server_timeout), error, DONE]` → 只投递 `['cancelled']`、`onError` 0 次、`onComplete` 1 次，无错误卡片。

**修复**：
1. 路由看门狗顺序改为：`send({ type: 'error', code: 'server_timeout', message })` → `triggerAbort('server_timeout')` → reject；catch 分支对 `'Agent timeout'` 不再重复发送。
2. SSE `error` 事件类型增加可选 `code?: AgentStreamErrorCode`（§5.3）。
3. `AgentEventRouter`：`cancelled` 且 `reason === 'server_timeout'` 时调用 `markCancelled({ appendMarker: false, byUser: false })`——工具仍降级为已取消，但 `isCancelled` 保持 false。`AgentStateManager.markCancelled` 增加 `byUser` 选项（默认 true）。
4. 文案 `agentStream.errors.serverTimeout`（§6.4）。

**回归测试**：`__tests__/agentEventRouter.cancelled.test.ts`「a server timeout is not recorded as stopped by the user」；`__tests__/chatRoute.timeoutOrder.test.ts`「the timeout error is sent before cancelled」（源码断言 `send({ type: 'error'` 出现在 `triggerAbort('server_timeout')` 之前）。

#### AG3-03 模型服务错误（401 / 429 / 上下文超长）被报告为「模型返回空内容，可能不支持工具调用」（S14）

**现状 *[实测]***：`agent.ts:218-259` `message_end` 只看文本 / 工具调用块，忽略 `msg.stopReason` 与 `msg.errorMessage`；pi-agent-core（`agent-loop.js:87-92`）在服务错误时发出 `stopReason: 'error'` + `errorMessage` 的助手 `message_end`，随后 `agent_end`，`prompt()` 正常 resolve；熔断触发的 `aborted` 同样产生该误导文案。
`message_end {stopReason:'error', errorMessage:'400 …maximum context length is 128000 tokens'}` → 「The model returned an empty response…」，完全不提上下文长度。结合 AG2-13，长对话必然触发，并把用户引向错误方向（与历史上多次 401 误诊同源）。

**修复**：
1. `agent.ts` 新增并导出：
   ```ts
   export type AgentStreamErrorCode = 'provider_auth' | 'provider_rate_limit' | 'context_overflow' | 'provider_error' | 'empty_response' | 'server_timeout';
   export function formatProviderError(raw?: string): { code: AgentStreamErrorCode; message: string };
   ```
   匹配顺序（v2 评审 RV3-10：先匹配语义最具体的上下文超长，避免「maximum context length is 128000 … requested 401 more tokens」被判为鉴权错误）：`/context.?length|maximum context|too many tokens|context_length_exceeded/i` → `context_overflow`；`/\b429\b|rate.?limit/i` → `provider_rate_limit`；`/\b401\b|invalid[_ ]api[_ ]key|unauthorized/i` → `provider_auth`；其余 → `provider_error`，`message` 为截断到 300 字符、去除 `sk-…` / `Bearer …` 形态令牌后的原文（CLAUDE.md：不把密钥写入消息）。
2. `message_end`：`stopReason === 'error'` → `send({ type: 'error', ...formatProviderError(msg.errorMessage) })` 并跳过空内容检查；`stopReason === 'aborted'` → 不发送错误；空内容错误带 `code: 'empty_response'`。
3. UI 按 `code` 显示 `agentStream.errors.*`（§6.4）；`provider_error` 以 `{detail}` 插入截断原文。

**回归测试**：`__tests__/agent.providerError.test.ts`「a provider error is reported with its cause, not as an empty response」「an aborted assistant message emits no empty-response error」「provider error details never contain an API key」「a context-length message that mentions 401 tokens is context_overflow」。

#### AG3-04 终态错误卡片上的「取消」把已结束的一轮重新封口为「用户停止」

**现状 *[实测]***：`components/video/components/VideoChatWindow/timeline/TimelineChatPanel.tsx:295-305` 对终态错误仍传 `onCancel`；`VideoChatWindow.tsx:175-178` 只防护 `finishing`；VEI `:2324` 接到 `cancelByUser`；
`components/video/hooks/useAgentExecution.ts:557-595` 无条件封口 `stateManagerRef.current` 并写 `[...messagesBeforeAgentRef, finalMsg]`。`onError` 后 `cancelExecution()` → `isCancelled` false→true，内容追加「_[Stopped by user]_」，下一轮收到错误的系统提示；由状态管理器重建消息还会把错误之后设置的 `isUndone` 改回。

**修复**：
1. `sealMessage` 首行 `if (!streamLiveRef.current) return;`。
2. 终态错误（`status === 'error'`）卡片改传 `onDismiss`；hook 返回 `dismissExecutionError`（即 `resetState`），经 VEI → VideoChatWindow → TimelineChatPanel 传递；按钮文案 `agentTimeline.dismiss`。

**回归测试**：`components/video/hooks/__tests__/useAgentExecution.ordering.test.ts` 追加「cancel after a turn ended does not mark it stopped by the user」；`VideoChatWindow/timeline/__tests__/TimelineChatPanel.errorCard.test.tsx`「a terminal error card offers dismiss, not cancel」。

#### AG3-05 + N-21 看门狗之后才结束的步骤覆盖新一轮对话；卡住的消息保持 streaming（S14）

**现状 *[实测]***：`useAgentExecution.ts:458-463` 以轮次开始时的快照 `[...turn.messagesWithUser, agentMessage]` **整体替换**对话；看门狗（`:433-436`）之后旧事件链仍会执行 `onComplete` 任务（`:406-416`）与订阅（`:381-383`），而 RC2-25 允许期间发起新一轮。
第 1 轮卡住 → 看门狗触发 → 第 2 轮「second」完成 → 第 1 轮步骤放行 → 对话中不再有 `user:second` 及其回复，第 2 轮补丁（撤销能力）丢失。
N-21：看门狗后状态为 `completed`，但最后写入的消息 `isStreaming: true`（光标、活动执行节点、150 ms 滚动定时器常驻）。可达性：窗口最小化时 Electron 定时器节流（未关闭 `backgroundThrottling`）+ 50 ms 删除动画延迟即可超过 15 s。

**修复**：
1. `createTurnCallbacks` 内 `let retired = false`，并把 `retire = () => { retired = true }` 存入 `retireTurnRef`；`sendAgentMessage` 开始新一轮前 `retireTurnRef.current?.()`。
2. `writeAgentMessage(update)`：未退役时行为不变；退役后改为按 id 就地替换——在 `conversationsRef.current` 中找到该对话与该消息，任一不存在（例如已清空聊天）则丢弃写入，否则只替换这一条消息。
3. `onFinishingTimeout`：`unsubscribe()` → `writeAgentMessage({ ...stateManager.toMessageUpdate(), isStreaming: false, timelineTrackPatches: computeTurnPatches(turnStart) })` → 标记退役 → 重置事件链 → 警告。

**回归测试**：`useAgentExecution.ordering.test.ts`「the finishing watchdog seals the stuck turn's message as not streaming」「a stuck step that settles after the next turn started updates only its own message」。

#### AG3-06 撤销单步菜单列出未改变时间轴的步骤，点击报错

**现状 *[实测]***：`components/video/components/VideoChatWindow/timeline/AgentResponseNode.tsx:94-96` 只按状态与工具名过滤；`OperationApplier.ts:185-188,232-239` 对 `noop / skipped` 不记录；`AgentEventRouter.ts:159` 需要 `operations.length > 0`。
`delete_clip` + 无操作的 `auto_fix_overlaps` → 菜单 2 项；`undoSingleOperation('tc-fix')` → `notUndoable` 错误。

**修复**：`src/types/index.ts` `AgentToolCallRecord.changedTimeline?: boolean`；`AgentStateManager.markTimelineChanged(toolCallId: string): void`；Router 在单条、批量、重排应用结果为 `applied` 时调用，`toMessageUpdate` 复制该字段；菜单过滤改为 `status === 'completed' && changedTimeline === true`。

**回归测试**：`__tests__/agentEventRouter.applyOutcome.test.ts` 追加「an applied operation marks its tool call as changing the timeline; a noop does not」；`VideoChatWindow/timeline/__tests__/AgentResponseNode.undoMenu.test.tsx`「the undo menu lists only steps that changed the timeline」。

#### AG2-03 `get_timeline` 缺少类型、字幕文本、分离标记、转场、可见性

**现状**：`tools/getTimeline.ts:18-39` 轨道无 `isVisible`，片段无 `originalMaterialType / text / audioDetached / transitionIn/Out / opacity`。视频轨上的图片片段模型无法区分，调用 `trim_clip` 后得到「Images have no source range」；字幕片段只有 `materialName`。

**修复**：轨道增加 `visible: track.isVisible !== false`；片段增加 `kind: item.originalMaterialType ?? item.type`、`text`（仅存在时，前 200 字符）、`audioDetached: true`（仅为 true 时）、`transitionIn / transitionOut: { type, duration }`（仅设置时）、`opacity`（仅 ≠ 1 时）；
输出改为紧凑 JSON（去掉 `null, 2`，同时服务 AG2-13）；工具描述同步说明新字段。

**回归测试**：`__tests__/getTimeline.fields.test.ts`「get_timeline tells image clips from video clips」「get_timeline returns subtitle text, detached and transition flags」。

#### AG2-04 默认时间轴两处定义；从空时间轴开始的一轮无法整轮撤销

**现状 *[实测]***：`OperationApplier.ts:544-551,772-791` 与 `src/app/api/video-editing-agent/chat/route.ts:246-265` 各有一份默认时间轴；`useAgentExecution.ts:487-491` 时间轴为 null 时 `turnStart` 为 undefined，`computeTurnPatches`（`:335-341`）返回 `[]`。
以 null 时间轴开始并 `add_clip` → `video-track-1` 有 1 个片段，但 `timelineTrackPatches=[]`、`canUndo=false`。

**修复**：新增纯模块 `defaultTimeline.ts` 导出 `createDefaultAgentTimelineState(): TimelineState`，路由与 `OperationApplier.ensureTimelineState` 共用；`sendAgentMessage` 中 `const baseline = currentTimeline ?? createDefaultAgentTimelineState(); turnStart = clone(baseline);` 并以 `baseline` 作为请求 `timelineState`。

**回归测试**：`useAgentExecution.ordering.test.ts`「a turn that starts from no timeline can be undone as a whole」；`__tests__/defaultTimeline.test.ts`「route and applier share one default timeline」（源码断言 `route.ts` 不再含 `subtitle-track-1` 字面量）。

#### AG2-05 单步撤销只对最近一轮有效

**现状 *[实测]***：`useAgentExecution.ts:450-451` 每轮替换 applier，`:667-687` 忽略 `messageId`；`AgentResponseNode.tsx:94-96,164-205` 每轮都显示「撤销单步」。第 1 轮 `delete_clip`、第 2 轮纯文本，再对第 1 轮单步撤销 → `notUndoable`。

**修复（会话内存级）**：`operationAppliersRef = useRef(new Map<string, OperationApplier>())`，按 Agent 消息 id 保存，切换对话时清空；`undoSingleOperation(messageId, toolCallId)` 取 `map.get(messageId)?.undoOperation(toolCallId)`；
hook 返回 `singleUndoMessageIds: ReadonlySet<string>`，经 VEI → VideoChatWindow → TimelineChatPanel 传入 `AgentResponseNode` 的 `canUndoSteps`，为 false 时隐藏单步菜单（整轮撤销不受影响）。重载后的单步撤销需持久化逐步补丁，与 AG2-13 冲突，列入附录 A。
单步撤销仍经既有冲突检测：较早一轮的片段已被后续轮次或手动编辑修改时拒绝并提示。

**回归测试**：`useAgentExecution.ordering.test.ts`「undo single works on a step of an earlier turn in the same session」「turns without live undo records hide undo single」。

#### AG2-13 对话历史无体积预算

**现状 *[实测]***：`messageConverter.ts:54-132` 重放每个工具结果；`tools/getTimeline.ts:69` 缩进输出；`trackPatch.ts:138-144` 只瘦身内联缩略图（保留 url、metadata、waveformData）；`useAgentExecution.ts:524` 请求携带含补丁的完整消息；`agent.ts:80-81` `contextWindow 128000` 且无压缩。
30 个视频 + 10 个音频片段、10 轮 ×（get_timeline、move_clip、无操作 auto_fix、check_overlaps）：模型重放 **105,731 字符 ≈ 35k token**（每次 get_timeline 7,821 字符）；**请求体 538,242 字符**，其中补丁 391,660（73%）。线性增长约 30–35 轮触及 128k 窗口，届时服务 400 被 AG3-03 掩盖。

**修复**：
1. 新增 `historyBudget.ts`：
   ```ts
   export const HISTORY_CHAR_BUDGET = 120_000;
   export function compactHistoryForModel(messages: readonly Message[], budget?: number): Message[];
   ```
   最近 2 轮原样保留；更早轮次中 `get_timeline / list_materials / search_materials / check_timeline_overlaps` 的结果替换为 `{"omitted":"stale <tool> snapshot; call it again"}`，`operations` 数组替换为 `operationsCount`；
   仍超预算时以整轮为单位丢弃最旧的轮次（保持 toolCall / toolResult 配对），并在最前插入用户消息 `[System note] N earlier turns omitted`。在 `agent.ts:111` 转换后调用。
   预算按字符计。按 `agent.ts:130-132` 既有的中文保守估算（约 2 字符 / token），12 万字符约为 6 万 token，加上系统提示与 `maxTokens: 4096` 仍在 `contextWindow: 128000`（`agent.ts:80-81`）之内；窗口更小的模型超限时，由 AG3-03 如实提示「对话过长」（v2 评审 RV3-24，接受）。
2. `useAgentExecution` 私有 `stripHistoryForRequest`：POST 的消息删除 `timelineTrackPatches`、`pendingOperations`、`thinkingContent`（服务端只读 `agentToolCalls`）。存储中的补丁瘦身列入附录 A。

**回归测试**：`__tests__/historyBudget.test.ts`「older timeline snapshots become stubs and every tool call keeps its result」「over budget drops whole oldest turns」；`useAgentExecution.ordering.test.ts`「the request body carries no timelineTrackPatches」。

#### AG2-17 只有工具调用、没有文字的轮次不显示「撤销本轮」

**现状**：`VideoChatWindow/timeline/utils.ts:214` 只在 `content` 非空时渲染响应节点（「撤销本轮」唯一入口）；`AgentStateManager.ts:182` 只在有内容时追加停止标记。`delete_clip` 结果后在文字前停止：补丁 `[v1]`，但只渲染执行节点，无法撤销。

**修复**：`mapMessageToNodes` 在 `!isStreaming && !content && hasToolCalls && patchCount > 0` 时推入 `content: ''`、`canUndo: !isUndone` 的响应节点；`AgentResponseNode` 在内容为空时跳过 `MarkdownRenderer`，只显示操作行。

**回归测试**：`VideoChatWindow/timeline/__tests__/utils.toolOnlyTurn.test.ts`「a stopped tool-only turn with track patches still offers undo this turn」。

#### AG2-18 锁定 / 字幕轨上无法修复的重叠让每次编辑都带 `overlapWarning`

**现状 *[实测]***：`tools/index.ts:169-171` 检查所有轨道；`domain/services/ItemPlacementService.ts:376-412` 无类型 / 锁过滤；`addToTrack:153`、`moveClip:77`、`trimClip:77`、`resizeClip:67`、`composeStoryboard:162` 附加警告。
字幕 s1[0-3] 与 s2[2-5] 重叠时对视频轨 `add_to_track` → 警告点名 `subtitle-track-1` 并要求 `auto_fix_overlaps`，而该工具跳过字幕（循环）。

**修复**：`runOverlapPostCheck(state, trackIds?: readonly string[])` 按 `trackIds` 与 `isReorganisable` 过滤，各工具传入受影响轨道 id；`check_timeline_overlaps` 与 `get_timeline` 仍返回完整列表，但每条重叠增加 `autoFixable: boolean`，摘要说明不可自动修复的（字幕 / 锁定）重叠除非用户要求否则忽略。

**回归测试**：`__tests__/editingTools.guards.test.ts`「an edit on the video track carries no warning for subtitle overlaps」「check_timeline_overlaps marks subtitle overlaps as not auto-fixable」。

#### AG2-20 Agent 界面硬编码英文、撤销菜单不可用键盘操作、同名步骤无法区分

**现状**：`AgentResponseNode.tsx` 120「AI」、124「(undone)」、155/160/177/200「Undo All/Single」、220；菜单 183-203 无 `role="menu"`、无键盘处理；`TimelineChatPanel.tsx:105-113,124`；`AgentExecutionNode.tsx:95,149,164-165,172`；`ToolStep.tsx:358,377`；
`ErrorStateCard.tsx:157,166`；`timeline/utils.ts:21-34`（英文且不完整的工具名）、`:238`；`useAgentExecution.ts:371,418`（`Agent error:`）；`errorRecovery.ts:96-105` 对所有语言返回中文。zh-CN 界面显示英文，en 界面收到中文流错误；3 次 `add_to_track` 显示 3 个相同的「Undo Add to Track」。

**修复**：
1. 文案全部改走 `agentTimeline.*` 与 `agentStream.*`（§6.4 完整列表）；`errorRecovery` 只保留错误 `type`，由 UI 取 `t.agentStream.errors[type]`；工具名取 `t.agentTimeline.toolNames[name] ?? name`。
2. 撤销单步菜单（ARIA menu 模式）：触发按钮 `aria-haspopup="menu"`、`aria-expanded`、`aria-controls`；面板 `role="menu"`、`aria-label={t.agentTimeline.undoStep}`；项 `role="menuitem"`、`tabIndex={-1}`；
   打开时聚焦第一项；↑/↓ 循环、Home/End 跳转；Esc 关闭并把焦点还给触发按钮；Tab 关闭；点击菜单外关闭。
3. 步骤标签：轮内 1 起序号 + 工具名（`undoStepItem`「撤销 {index}. {tool}」），`title` 为参数摘要（clipId / materialId）。

**回归测试**：`VideoChatWindow/timeline/__tests__/AgentResponseNode.undoMenu.test.tsx`「the undo step menu is a keyboard-operable ARIA menu」「same-name steps are numbered」；`__tests__/agentTimeline.noHardcodedText.test.ts`「agent timeline UI has no hardcoded English labels」（源码断言上述文件不含 `'Undo All'`、`'(undone)'`、`'Executing'` 等字面量）。

#### AG2-21 客户端 30 分钟绝对超时与服务端「无活动」超时语义不一致

**现状**：`SSEStreamManager.ts:133`（1,800,000 ms）、`:196-198` 绝对计时、`:603-618` 到期不可恢复；`route.ts:17,468-478,538` 每次工具开始 / 结束重置计时（无活动语义）。工具持续活跃超过 30 分钟的任务（批量分镜视频）被客户端切断，并把中止传播到服务端。

**修复**：总计时器改为 `idleTimeoutMs`（默认值见下），在 `trackEvent` 收到 `tool_call / tool_result / text_delta / thinking_delta` 时重置（keepalive / heartbeat 注释不重置）；保留 `maxDurationMs`（默认 7,200,000）作为硬上限；错误类型仍为 `TOTAL_TIMEOUT`，文案区分「长时间无进展」与「超过最长运行时间」。
*（v2 评审 RV3-09）* 两端常量抽到新模块 `src/lib/video-editing-agent/timeouts.ts`：`AGENT_IDLE_TIMEOUT_MS = 1_800_000`（`route.ts:17` 的 `AGENT_TIMEOUT` 改为引用它）、`CLIENT_IDLE_GRACE_MS = 60_000`、`AGENT_MAX_DURATION_MS = 7_200_000`；客户端 `idleTimeoutMs` 默认为 `AGENT_IDLE_TIMEOUT_MS + CLIENT_IDLE_GRACE_MS`。
原因：服务端计时器只在工具开始 / 结束时重置（`agent.ts:276,287`），两端同为 30 分钟时几乎同时到期；若客户端先中止连接，AG3-02 修好的、带 `code: 'server_timeout'` 的服务端错误就到不了客户端。

**回归测试**：`__tests__/sseStreamManager.timeout.test.ts`「tool activity keeps a stream alive past 30 minutes」「an idle stream is ended by the client only after the server timeout plus grace」（fake timers）。

#### N-10 Agent `delete_clip / trim_clip / resize_clip` 之后同样贴紧并回报被移动的片段（S8 补全）

**现状 *[实测]***：`reconcile.ts:189-191` 只对 add / move 贴紧，`:232` 跳过无重叠轨；`tools/deleteClip.ts:38-43` 不回报位移。A0-5、B5-10、C10-15 删除 B → C 仍在 10；下一次 UI 编辑 `organizeVideoAudioTracks` 把 C 移到 5，违反 S8「写入即稳定」。

**修复**：`packsWithoutOverlap` 对 delete / trim / resize 同样返回 true（无锚点）；三个工具以 `collectClipStarts / diffClipStarts` 收集前后起点并返回 `shiftedClips`；工具描述更新为「删除 / 缩短会让后续片段前移，shiftedClips 列出它们」。
单步撤销不变（补丁前后态已包含贴紧），`operationApplier.undo.test.ts` 期望值随之更新。决策 D-19：Agent 删除后空隙立即闭合（与手动删除一致），而不是等下一次手动编辑。

**回归测试**：`__tests__/reconcile.test.ts`「delete_clip leaves its track an organize fixed point」；`__tests__/editingTools.guards.test.ts`「delete_clip reports the clips it pulled earlier」；`__tests__/operationApplier.undo.test.ts`「undoing a packed delete restores original positions」。

#### N-19 `add_clip.material` 类型缺少播放快照字段

**现状**：`types.ts:58-64`（`url: string`，无 `serverUrl / cacheUrl / storageKey / metadata`）；`agent.ts:353-354` 强转；`tools/addToTrack.ts:145`、`tools/composeStoryboard.ts:92` 以 `url: material.url` 覆盖满足类型。运行时字段实际存在，仅类型失真。

**修复**：`TimelineOperation` 中 `add_clip.material: AgentMaterialData`；删除强转与 `url` 覆盖。

**回归测试**：A1 `tsc`；`__tests__/serializeMaterial.test.ts`「add_clip snapshot carries serverUrl, cacheUrl, storageKey」。

### 3.8 AI 混剪、自动混剪与数据安全（AM / DS 组：DS3-01～DS3-04、AM3-01、AM3-02、AM2-04、BL-14、N-07、N-08、N-13）

行号为 HEAD `e06dca4`。

#### DS3-01 水合修复在「另一个片段触发修复」时永久删除有效片段（P0）

**现状 *[实测]***：`src/components/video/projects/repairTimelineData.ts:34-35` 删除 `duration` 非有限或 ≤ 0 的条目，`:49-50` 删除 `clipEnd <= clipStart` 的条目（文档注释 `:70-72` 写明）；
而聚合根对二者都接受：`timeline/domain/entities/TimelineItem.ts:301` `duration > 0 ? … : Duration.default()`，`:310-311` 只要求 `clipEnd` 可构造（非负），静态图的两侧伸缩按类型判断、不依赖存储的裁剪字段（`:393-401,431-439`）。
*（v2 评审 RV3-01 更正）* 被误删的条目不是现行 Agent 写入的：`tools/addToTrack.ts:133-136`、`tools/composeStoryboard.ts:86-89` 对图片发送 `clipStart: 0, clipEnd: duration`（`a7f46c5`、`01af364` 同样如此），`tools/resizeClip.ts:59-62` 对静态图同步 `clipEnd`，而 `OperationApplier.ts:636-637` 的 `clip.clipEnd || 0` 只有在工具发送 0 时才得到 0。
`clipEnd = 0` 的图片是旧版本写入的存量数据（`TimelineItem.ts:434`、`SplitService.ts:106` 的注释为此保留了兼容分支）。另外两类同样会被误删：`duration` 为 0 的条目，以及经 JSON 导入（`replaceTimelineAction('import')` 只要求聚合根可构造）写入的 `clipEnd ≤ clipStart` 条目。
修复只在某个条目让 `importFromData` 抛错时对**整条时间轴**运行（`projects/hydrateTimeline.ts:72-93`），而 `'repaired'` 状态不写备份（`:158` 只在 `failed` 时备份）——下一次自动保存让丢失永久化。这违反该文件自身的契约（`repairTimelineData.ts:5-7`：只修复会让聚合根抛错的值）。
复现：单独一个图片轨条目 `{ clipStart: 0, clipEnd: 0, originalMaterialType: 'image', duration: 4 }` → `'loaded'`；再加一个 `startTime: -3` 的视频片段（AG2-08 存量数据）→ `'repaired'`，图片从 store 消失，任一编辑后保存即永久丢失。受影响的是同时含「需钳制的值」（如 AG2-08 的负起点）与上述三类「聚合根可接受、却被修复规则判为无效」条目的项目——典型是早期经 Agent 编辑过的项目。
因此本修复只改读取侧（修复规则与备份），不改写入方。

**修复**：
1. `repairItem` 逐字段只做「钳制」、不再因这两条规则删除：
   - 非对象条目：删除（不变）。
   - `startTime` 非有限或 < 0 → 0（不变）；`clipStart` 存在且非有限或 < 0 → 0（不变）。
   - `duration` 非有限或 ≤ 0：**不删除**，保持原值交给聚合根（`Duration.default()`）；若为 `NaN / Infinity` 等 JSON 中不可能出现但对象中可能出现的值，改为删除该键。
   - `clipEnd` 存在且非有限或 < 0：`originalMaterialType === 'image'` 且 `duration` 有限且 > 0 时设为 `duration`，否则删除该键（钳制）。
   - 删除 `clipEnd <= clipStart` 的删除规则；更新 `:5-7` 与 `:70-72` 注释。
   - 修复后仍逐条以 `TimelineItem.fromPlainObject` 试构造（N-07 的 `salvageTimelineData` 同样使用），只有构造抛错的条目才删除并记入 `droppedItemIds`。
2. `withTimelineRecoveryBackup`（`hydrateTimeline.ts:146-167`）：`hydration.status === 'repaired' && hydration.report.droppedItemIds.length > 0` 时同样写备份（沿用「不覆盖已有备份」规则）。

**回归测试**：`src/components/video/projects/__tests__/repairTimelineData.test.ts`「keeps a legacy agent image whose clipEnd is 0」「keeps a zero-duration item the aggregate itself accepts」「keeps an imported clip whose clipEnd is not after clipStart」「drops only the items that cannot be constructed」；
`src/components/video/projects/__tests__/hydrateTimeline.repair.test.ts`「a negative start elsewhere does not drop an agent-added image」「a repair that drops an item keeps a recovery backup」。

#### DS3-02 在素材库删除的素材，Agent 一添加任意素材就回来了（P1）

**现状 *[实测，真实 store 的 renderHook]***：`src/components/video/hooks/useMaterialManagement.ts:100-108` 在 store 每次变化时把「本地状态中没有的」store 素材合并进来；`executeDelete`（`:235-268`）只从 React 状态移除；
`src/stores/slices/materialSlice.ts:66-68` 有 `removeMaterial` 但面板从不调用（清空全部会调用 `clearMaterials()`）；Agent 经 `AgentEventRouter.ts:249-258` / `OperationApplier.ts:452-463` 写 store。
store `addMaterial(M)` → 删除 M 并确认（`deleteMaterialDerived` 以 `sourcePath: 'video/M.mp4'` 调用）→ store `addMaterial(N)` → 素材库 `[M, N]`：源文件已删除的 M 回到库中并被自动保存。根因：单向合并把「本地没有」当成「新的」。

**修复**：
1. `executeDelete`：`setMaterials` 之后 `const store = useVideoEditingStore.getState(); materialIds.forEach((id) => store.removeMaterial(id));`。
2. 同步 effect 纵深防御：`mergedStoreIdsRef = useRef(new Set<string>())`；只合并「既不在本地、也不在 ref 中」的 store 素材，合并后把 id 加入 ref；`executeDelete` 同时把删除的 id 保留在 ref 中（防止同 id 再次被合并）。
   清空全部时清空 ref。

**回归测试**：`src/components/video/hooks/__tests__/useMaterialManagement.storeSync.test.tsx`「a material deleted in the panel is not re-added when the agent adds another」「deleting a material removes it from the shared store」。

#### DS3-03 「清空全部素材」让所有时间轴片段失去素材，导出被拒且无法撤销（P1）

**现状**：`useMaterialManagement.ts:472-502` 确认后直接 `setMaterials([])` + `clearMaterials()`，不经 `planMaterialDelete`、不查锁、不清缓存；确认文案（`src/lib/i18n.ts:3066 / :5580`）不提片段；
随后导出 `videoExportItems.ts:239-252,264-265` 返回 `missing-materials`、预览丢弃这些片段；单个删除路径会把片段作为一步可撤销操作移除（`:283-303`），清空全部绕过了它。重新导入分配新 id，片段永远无法重新关联。

**修复**（`useMaterialManagement.ts`）：
1. 打开对话框时（`materials.length > 0`）：`plan = planMaterialDelete(materials.map((m) => m.id))`；`plan.kind !== 'ready'` → `warnIfDeleteBlocked(plan)` 并返回。
2. 文案：`plan.itemIds.length > 0` 时用 `t.materialsPanel.clearAllInUseMessage`（`{count}`、`{clipCount}`），否则沿用 `clearAllConfirmMessage`。
3. 确认时：以当前 id 重新规划，受阻则提示、关闭并返回；`plan.itemIds` 非空时 `removeItemsAction(() => useTimelineStore.getState(), plan.itemIds)`（一步可撤销）；`materials.forEach((m) => evictMaterialCaches(m.id))`；再执行既有 `setMaterials([])` 与 `clearMaterials()`。
4. 只清素材包（`extraCount`）的分支不变。

**回归测试**：`src/components/video/hooks/__tests__/useMaterialManagement.deleteInUse.test.tsx` 追加「clearing all materials removes their clips as one undo step」「clearing all materials is refused while a used clip is on a locked track」。

#### DS3-04 切段中一个片段失败时，文件被挂到错误的占位素材上（P1）

**现状**：后端 `backend-services/basic-service/app/services/video_cut_service.py:59-83` 对失败片段 `continue`，`:98-104` 以 `success=True` 只返回成功结果，每个结果带请求 `id`（`app/models/video_models.py:786-797`；前端类型 `src/types/index.ts:875-893`）；
前端 `src/components/video/VideoEditingInterface.tsx:1406-1407` 按**下标**把 `cutResponse.clips[index]` 配给 `tempClipMaterials[index]`；提示（`:1368,1446,1458,1471`）为硬编码中文，成功提示只按返回数量计数。
切 c1 0–5 s、c2 5–10 s（ffmpeg 失败）、c3 10–15 s → 返回 `[c1, c3]`：「… - c2」占位（`clipStartTime: 5`）拿到 c3 的文件；`…_clip_c3` 占位永远 `uploadStatus: 'uploading'`、`url: ''`，被自动保存、作为可规划素材提供给 AI 混剪、可被拖上时间轴；提示「完成 2 个」且不提失败。

**修复**：
1. 新增 `src/components/video/lib/clipCutResults.ts`（同时容纳 N-13 的占位构造，VEI 2478 行，I-7）：
   ```ts
   export interface PendingClip { clipId: string; material: MaterialItem }
   export function buildClipPlaceholder(original: MaterialItem, clip: VideoCutClipRequest, index: number, total: number): PendingClip;
   export function matchClipCutResults(
     pending: readonly PendingClip[],
     results: readonly VideoCutClipResult[],
   ): { matched: Array<{ pending: PendingClip; result: VideoCutClipResult }>; unmatched: PendingClip[] };
   ```
   以 `result.id === clipId` 匹配；未知 id 的结果忽略并 `console.warn('[clipCut] result for unknown clip id', { id })`。
2. VEI `handleExportClips`：以 id 匹配替换 `:1404-1438`；`matched.length === 0` → 既有失败路径；`unmatched.length > 0` → `discardPendingMaterials(unmatched ids)` + `showWarning(t.videoEditing.clipCut.partialFailed)`（`{failed}`、`{total}`）；
   四处提示改用 `videoEditing.clipCut.{processing, done, partialFailed, failed}`。
3. 后端响应增加 `failed_clips` 可选（不需要，前端按缺失 id 推断）——本轮不改后端。

**回归测试**：`src/components/video/lib/__tests__/clipCutResults.test.ts`「a failed middle clip leaves the other results on their own placeholders」「placeholders without a result are reported as unmatched」「a cut clip carries no script segment membership」（N-13）。

#### AM3-01 纯视频自动混剪把「没有匹配视频」的段报告为「尚无配音」

**现状 *[实测]***：`src/components/video/lib/aiMix/planScriptAutoMix.ts:275-277`（`planVideoOnly`）把无视频的段报告为 `'skipped-no-audio'`，`src/components/video/hooks/useScriptAutoMix.ts:109-114` 随即提示「第 {list} 段尚无配音，已跳过」（`i18n.ts:3886`）。
脚本 s1（v1）、s2（无视频）、s3（v3），全部无 TTS → 提示「已排布 2 段」与「第 2 段尚无配音」——1、3 段同样无配音，真正的问题是第 2 段没有视频。

**修复**：`AutoMixSegmentReport['status']` 增加 `'skipped-no-video'`，`planVideoOnly` 使用它；`announceApplied` 从已应用计数中同时扣除两种跳过状态，并对新状态以 `videoEditing.autoMix.skippedNoVideo`（`{list}`）提示。

**回归测试**：`src/components/video/lib/aiMix/__tests__/planScriptAutoMix.test.ts`「a video-only plan reports a segment without videos as skipped-no-video」；`src/components/video/hooks/__tests__/useScriptAutoMix.test.tsx`「a video-only mix warns about missing videos, not missing voice-over」。

#### AM3-02 导入阶段本地服务断开 / 超时被提示为「方案无法应用」

**现状**：`src/components/video/hooks/useAIMixedEditing.ts:376-381` 把 `/api/timeline-import` 的所有 `ApiError` 包成 `AiMixImportError`，`mapAiMixError`（`:189`）在查错误码表（`:162-173`）之前就返回 `errorImportFailed`；
而传输失败同样是 `ApiError`：BFF 504 `BACKEND_TIMEOUT`、502 `BACKEND_UNREACHABLE`（`src/lib/api/server/backend-proxy.ts:276-292`）、`NETWORK_ERROR`（`src/lib/api/http-client.ts:373-376,435-438`）。

**修复**：`const TRANSPORT_ERROR_CODES: ReadonlySet<string> = new Set(['BACKEND_TIMEOUT', 'BACKEND_UNREACHABLE', 'NETWORK_ERROR']);`；`importPlan` 中 `if (error instanceof ApiError && !TRANSPORT_ERROR_CODES.has(error.code)) throw new AiMixImportError(error); throw error;`（文案已存在）。

**回归测试**：`src/components/video/hooks/__tests__/useAIMixedEditing.test.tsx`「an unreachable backend during import reads as unreachable, not as an unusable plan」。

#### AM2-04 AI 混剪取消只中止浏览器请求，后端 LLM 与视频解析继续运行（S15）

**现状 *[实测，打包的 `desktop/build/python`：fastapi 0.104.1 / starlette 0.27.0 / uvicorn 0.24.0]***：
客户端 `useAIMixedEditing.ts:564` `cancel` 只中止 fetch；BFF `backend-proxy.ts:256-257,275` 上游 fetch 只用超时 `AbortController`，从不读取 `req.signal`（Next 15.4.5 在客户端关闭套接字时会中止 `req.signal`：`node_modules/next/dist/server/web/spec-extension/adapters/next-request.js:45-55`）；
路由 `src/app/api/ai-mixed-editing/route.ts:4-6`、`src/app/api/video/batch-analyze/route.ts` 超时 600 s；后端 `ai_mixed_editing_router.py:126-130` 无断开处理，服务最多 2 次 LLM 调用、每次 120 s（`ai_mixed_editing_service.py:607-608,666-672`）；`video_router.py:803-872` 批量解析同样。
探针（与 `app.main` 相同的两层 `BaseHTTPMiddleware`，客户端 1 s 超时）：普通处理函数断开后仍运行 4 s 至完成；每 200 ms 轮询 `request.is_disconnected()` **在 starlette 0.27 + BaseHTTPMiddleware 下看不到断开**；以 `await request.receive()` 监听的任务 1 s 内被取消；客户端保持连接时正常 200。

**修复**：
1. 新增 `backend-services/basic-service/app/utils/client_disconnect.py`：
   ```python
   class ClientDisconnectedError(Exception): ...

   async def run_until_client_disconnects(request: Request, work: Awaitable[T]) -> T:
       """在 FastAPI 已读取请求体（有 body 参数）之后调用。不要使用 is_disconnected()：
       starlette 0.27 + BaseHTTPMiddleware 下它看不到断开。"""
   ```
   以 `asyncio.ensure_future(work)` 启动；监听任务循环 `message = await request.receive()`，收到 `"http.disconnect"` 置标志并 `task.cancel()`；`try: return await task`；`except asyncio.CancelledError`：已置标志则 `raise ClientDisconnectedError from None`，否则重新抛出；
   `finally` 取消监听任务并在抑制 `CancelledError` 的情况下 await。
2. `ai_mixed_editing_router.py`：签名改为 `ai_mixed_editing(request: AIMixedEditingRequest, http_request: Request)`；把 `AIMixedEditingService.create()` 与 `generate_mixed_editing(...)` 包在一个协程中经助手运行；
   在 `except AIMixError / except Exception` 之前 `except ClientDisconnectedError: logger.info(f"AI mixed editing cancelled by the client for task {task_id}"); return Response(status_code=499)`。`CancelledError` 是 `BaseException`，服务内 `except Exception`（`:580,673`）不会吞掉；httpx `async with` 关闭上游连接。
3. `video_router.py:803` `batch_analyze_videos` 同样处理（`extract_frames` 为同步 cv2 代码，`video_analysis_service.py:205-277`，取消在下一个 await——VLM 调用——生效）。
4. `src/lib/api/server/backend-proxy.ts`：`ProxyOptions.abortOnClientDisconnect?: boolean`；`executeProxy` 在该选项开启时给 `req.signal` 挂 `'abort'` 监听调用 `abortCtrl.abort()`，fetch 结束后移除；catch 中先判断 `opts?.abortOnClientDisconnect && req.signal.aborted` 并返回 `new Response(null, { status: 499 })`，再做超时映射。
   `src/app/api/ai-mixed-editing/route.ts`、`src/app/api/video/batch-analyze/route.ts`、`src/app/api/timeline-import/route.ts` 开启该选项。
5. 限制（写入模块注释与 §8）：非流式补全在服务商侧已生成的 token 仍可能计费；本修复保证停止的是修复轮、剩余 VLM 帧调用与导入。

**回归测试**：`backend-services/basic-service/tests/test_client_disconnect.py::test_work_is_cancelled_when_client_disconnects`、`::test_result_is_returned_when_client_stays_connected`（以 `asyncio.Event` 控制的 `receive` 直接构造 `Request(scope, receive)`，不 sleep）；
`src/lib/api/server/__tests__/backend-proxy.clientAbort.test.ts`「aborts the upstream fetch when the client disconnects and the route opts in」。

#### BL-14 删除无调用方的 `AIVideoGenerateService`

**现状**：`backend-services/basic-service/app/services/ai_video_generate_service.py:21-31` 直读 `settings.video_cut_llm_*`、绕过模型设置；`:56` 示例音量 200、`:224` 提示词「音量（100-300，200为正常音量）」与 AI 混剪「100 为原始响度」矛盾；
`app/routers/ai_video_generate_router.py:57` 提供 `POST /api/workflow/ai-video-generate`，根挂载（`app/main.py:465-467`）、`app/routers/__init__.py:16,34` 导出。
全仓零调用方（`src/`、`desktop/`、后端 `tests/`、`scripts/`；`src/app/api/workflow/` 已删除）；`TimelineParserService.validate_simplified_timeline`（`timeline_parser_service.py:530-562`）、`_clip_segments_for_validation`（`:564-592`）、`CLIP_LOG_TOLERANCE_SECONDS`（`:27`）只被 `tests/test_timeline_validation_fix.py`（10 例）调用。

**修复**：删除 `app/services/ai_video_generate_service.py`、`app/routers/ai_video_generate_router.py`、`app/routers/__init__.py:16,34`、`app/main.py:464-467`、`timeline_parser_service.py:27` 与 `:530-592`、`tests/test_timeline_validation_fix.py`、`backend-services/basic-service/docs/apis/ai-video-generate-node.md`；
从 `backend-services/basic-service/env.template:249` 注释、`CLAUDE.md:64`（「except `ai_video_generate_router`」）、`.claude-index/index.md:193,204` 中移除该名称，并把 `CLAUDE.md` 的「registers 32 routers」改为 31（v2 评审 RV3-17）。删除前实现节点再 grep `ai_video_generate|AIVideoGenerate|validate_simplified_timeline` 确认零调用。

**回归测试**：`backend-services/basic-service/tests/test_removed_routes.py::test_workflow_ai_video_generate_is_not_mounted`（`app.routes` 中无该路径）。

#### N-07 从 `timelineRecoveryBackup` 恢复时间轴的用户入口

**现状**：`timelineRecoveryBackup` 只由 `projects/hydrateTimeline.ts:153-167` 写入（类型 `src/types/index.ts:293`），`src/` 中无读取方、无 UI；唯一的恢复方式是手工编辑 SQLite。

**修复**：
1. `projects/repairTimelineData.ts` 新增：
   ```ts
   export function salvageTimelineData(raw: unknown): { data: TimelineData; report: { droppedTrackIds: string[]; droppedItemIds: string[] } } | null;
   ```
   `raw` 不是含 `tracks` 数组的对象时返回 `null`；丢弃非对象或缺 `id / type` 的轨道；非数组 `items` 视为空；逐条 `repairItem`（DS3-01 规则）后以 `Track.fromPlainObject({ ...track, items: [item] })` 试构造，抛错则丢弃；最终 `TimelineAggregate.fromPlainObject(result)` 校验，抛错返回 `null`。
2. `projects/VideoEditorContainer.tsx` 顶部提示条（`:248-275`）：`content.timelineRecoveryBackup` 存在时显示「恢复备份的时间轴」与「丢弃备份」。
   - 恢复 → `ConfirmationDialog`（正文含备份日期）→ 确认：`isEditLocked(useTimelineStore.getState())` 时 `showWarning(t.timeline.messages.editLockedByAgent)`；`salvageTimelineData(backup.data)` 为 `null` 时 `showError(t.videoProjects.backupUnreadable)`；
     否则 `replaceTimelineAction(() => useTimelineStore.getState(), data, 'import')`（一步可撤销，经 TimelinePanel 订阅传给 VEI → content → 自动保存），并 `showSuccess(t.videoProjects.backupRestored)`（`{count}` = `droppedItemIds.length`）。备份保留直至丢弃。
   - 丢弃 → 确认（`variant="danger"`）→ `setContent(({ timelineRecoveryBackup: _removed, ...rest }) => rest)`。

**回归测试**：`src/components/video/projects/__tests__/repairTimelineData.test.ts`「salvage keeps readable clips and drops only the ones that cannot be built」；`src/components/video/projects/__tests__/VideoEditorContainer.recoveryBackup.test.ts`「restoring the backup replaces the timeline as one undoable step」「discarding the backup removes it from project data」。

#### N-08 素材删除的后端清理失败只记日志

**现状**：`useMaterialManagement.ts:217-232` 失败只 `logger.warn`；`src/components/video/lib/api/materialCacheClient.ts:71-76` 吞掉错误返回 `FAILED_RESULT` 且不记日志；后端 `storage_router.py:922-944` 只在异常时返回 `success: false`（文件不存在为无操作成功，无误报）。停掉后端删除未使用的上传素材 → 从库中消失、文件留在磁盘、无任何提示。

**修复**：`cascadeDeleteMaterial` 返回 `Promise<boolean>`；`executeDelete(materialIds: string[], options: { reportCleanupFailure?: boolean } = {})`（默认 true）：`void Promise.all(ids.map(cascade)).then((results) => …)`，有失败、选项开启且 `isMountedRef.current` 时
`showWarning(t.materialsPanel.deleteCleanupFailed)`（`{count}`）；`discardPendingMaterials` 传 `{ reportCleanupFailure: false }`；`deleteMaterialDerived` 的 catch 记录 `console.warn('[materials] delete request failed', { materialId: params.materialId, error })`。

**回归测试**：`useMaterialManagement.deleteInUse.test.tsx` 追加「warns once when the backend cleanup of a delete fails」「discarding placeholders never warns about cleanup」。

#### N-13 切段 / 静音移除得到的素材继承原片的脚本段归属

**现状 *[实测]***：`VideoEditingInterface.tsx:1337-1347` 以 `...originalMaterial.metadata` 构造切段占位，最终切片（`:1420`）复制占位的 metadata；`src/components/video/lib/derivedMaterial.ts:115-124` 只剥离存储字段。
规划器 `planScriptAutoMix.ts:107-111,118-134` 按 `segment_id` 分组旧素材，`keepNewest`（`:191-198`）以 `>=` 打破平局使后加入者胜出，`:201-209` 按 `video_index_in_segment` 选择；有脚本时 `:217-232` 把未列出的视频计为忽略（`useScriptAutoMix.ts:118-121` 提示）。
原片 V（20 s，s1 槽 1，`segment_assigned_at: 1000`）+ TTS A（10 s，s1）+ 按 VEI 方式构造的 3 s 切片：无脚本时每个视频位都放切片（循环）且 V 被列为忽略；有脚本 `[{ id: 's1', videos: [{ id: 'V' }] }]` 时切片被提示为「忽略了 1 个过期素材版本」。

**修复**：
1. `derivedMaterial.ts`：
   ```ts
   export const SCRIPT_SEGMENT_METADATA_FIELDS = ['segment_id', 'segment_number', 'segment_title', 'segment_assigned_at', 'video_index_in_segment', 'segment_text_hash'] as const;
   export function withoutScriptSegment(metadata: MaterialMetadata | undefined): MaterialMetadata;
   export function repairInheritedSegmentMembership(materials: readonly MaterialItem[]): { materials: MaterialItem[]; repairedIds: string[] };
   ```
2. `clipCutResults.buildClipPlaceholder`（DS3-04）使用 `withoutScriptSegment(original.metadata)`；静音移除（`MaterialsPanel.tsx` 展开 `...originalMaterial.metadata` 处）同样剥离（决策 D-25）；去水印保持同 id，不剥离。
3. 存量修复：`VideoEditorContainer.repairProjectMaterials`（`:74-80`）调用 `repairInheritedSegmentMembership`（幂等）。对 `metadata.isClip === true`（或 `isSilenceRemoved === true`）且带 `segment_id` 的素材，满足任一条件即剥离：
   `segment_assigned_at` 为有限数且小于 `new Date(material.createdAt).getTime()`（v2 评审 RV3-19：`MaterialItem.createdAt` 声明为 `Date`，持久化后运行时是 ISO 字符串，`Date.parse` 会出类型错误；该值非有限时跳过此条件、只用下一条）（归属是在切段之前继承来的；ScriptPanel 之后的匹配会写入 `Date.now()`，`ScriptPanel.tsx:752-766`，真实匹配得以保留）；或无时间戳且 `metadata.originalMaterialId` 指向的素材具有相同 `segment_id`。

**回归测试**：`src/components/video/lib/__tests__/derivedMaterial.test.ts`「strips segment membership a clip inherited at cut time」「keeps segment membership assigned after the cut」；`src/components/video/lib/aiMix/__tests__/planScriptAutoMix.test.ts`「a repaired cut clip does not take its original legacy slot」。

---

## 4. 文件 / 模块变更计划

路径前缀：前端相对仓库根；`timeline/` = `src/components/video/timeline/`；后端相对 `backend-services/basic-service/`。「新增」= 新建文件，「修改」= 既有文件，「删除」= 删除文件。编号与前两轮独立。

### 4.1 前端 · 预览与图片叠加（PV）

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F1 | `src/components/video/playback/internal/fitContain.ts` | 修改 | 新增 `outputFrameRect`、`fitSourceInFrame` | PV3-01 |
| F2 | `src/components/video/playback/CanvasCompositor.ts` | 修改 | `_frameRect` 取代 `_baseFit`；视频在帧内按自身比例 contain；字幕按输出像素排版绘制（描边 / 背景）；`onAssetReady`；`crossOrigin` 失败重试 | PV3-01、PV3-02、EXO-09 |
| F3 | `src/components/video/playback/types.ts` | 修改 | 字幕层新形状；`VideoTrackGroup.volumeScale`；`MultiTrackAttachDeps.outputSize / applyVolume` | EXO-09、PV3-03、ME-06 |
| F4 | `src/components/video/playback/internal/assembleLayers.ts` | 修改 | `buildSubtitleLayers(items, t, output, baseZ)` 经 `layoutSubtitle` | EXO-09 |
| F5 | `src/components/video/playback/SubtitleLayer.ts` | 修改 | 删除 `wrapText / positionToVAnchor / vAnchor`，只保留活动条目选择 | EXO-09 |
| F6 | `src/components/video/lib/subtitleLayout.ts` | 新增 | 输出尺寸表、字数上限、换行、块位置、`layoutSubtitle` | EXO-09、N-15 |
| F7 | `src/components/video/playback/MultiTrackPlaybackEngine.ts` | 修改 | 注入 `outputSize / applyVolume`；`seek` 钳制到渲染终点；图片加载后重绘 | EXO-09、ME-06、N-06、PV3-02 |
| F8 | `src/components/video/playback/VideoSourcePool.ts` | 修改 | 携带 [0,2] 有效音量、经 `applyVolume` 写入、乘 `volumeScale`、路由元素遇跨源地址先回收 | ME-06、PV3-03 |
| F9 | `src/components/video/playback/AudioSyncPool.ts` | 修改 | 同 F8；音频组音量取主音量 | ME-06、PV3-03 |
| F10 | `src/components/video/playback/audio/PreviewGainRouter.ts` | 新增 | WebAudio 增益路由（仅同源）、`splitPreviewVolume`、`isBoostableSource`；已路由元素的音量与静音由增益承担 | ME-06、RV3-20 |
| F11 | `src/components/video/components/VideoPlayerPanel/PreviewCanvas.tsx` | 修改 | 持有路由器、`recycleElement`、卸载 `dispose`；删除 `measureSubtitle` | ME-06、EXO-09 |
| F12 | `src/components/video/hooks/useCompositionPlayback.ts` | 修改 | `outputSize`、`masterVolume` 选项；播放时 `resume`；图片来源取导出引用 | EXO-09、PV3-02、PV3-03、ME-06 |
| F13 | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 修改 | 传 `outputSize / volume`；只读叠加；进度钳制；播放状态镜像到 store；导出弹窗 `allowCancel`；向 `useVideoExport` 传 `projectId` | EXO-09、PV3-03、PV3-04、N-06、UI3-12、EXO-07、RV3-07 |
| F14 | `src/components/video/components/VideoPlayerPanel/useCompositionTransport.ts` | 修改 | 合成模式时间与进度钳制 | N-06 |
| F15 | `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx` | 修改 | `<img>` 透明 + `aria-hidden`；`readOnly`；键盘微调与可聚焦分组 | PV3-02、PV3-04、N-02 |
| F16 | `src/components/video/components/VideoPlayerPanel/imageOverlays.ts` | 修改 | `isLocked`；来源取导出引用 | PV3-02、PV3-04 |
| F17 | `src/components/video/components/VideoPlayerPanel/imageOverlayGeometry.ts` | 修改（文件不存在则新增） | `nudgeImagePosition` | N-02 |
| F18 | `timeline/store/actions/updateItemFields.ts` | 修改 | 导出 `imageEditBlocker` 与 `readImagePosition`，`findEditableItem` 基于前者 | PV3-04、RV3-08 |
| F19 | `src/components/video/lib/imagePositionCommit.ts` | 新增 | `resolveImagePositionCommit` | PV3-04、N-18 |
| F20 | `src/lib/playbackFlags.ts` | 修改 | 新增默认开启的 `previewVolumeBoost` | ME-06 |

### 4.2 前端 · 导出流程（EX）

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F21 | `src/lib/api/videoComposition.ts` | 修改 | `pollCompositionStatus(id, onProgress, options)` 停滞超时 + `signal`；`stage` 类型；`CompositionFailedError`；`cancelComposition(id)` | EXO-07、EX3-08 |
| F22 | `src/components/video/hooks/useVideoExport.ts` | 修改 | 读导出会话存储（键 `taskId:projectId`）；同步防重入；单次下载、失败不显示成功；取消；失败文案 | EXO-07、EXO-14、EX3-08、RV3-07 |
| F23 | `src/components/video/hooks/exportSessionStore.ts` | 新增 | 按 taskId 的导出会话（`useSyncExternalStore`） | EXO-14 |
| F24 | `src/components/video/hooks/exportFailureMessage.ts` | 新增 | `describeExportFailure` | EX3-08 |
| F25 | `src/components/video/components/VideoPlayerPanel/VideoExportProgressModal.tsx` | 修改 | 按 `stage` 显示阶段；取消按钮 | EXO-07 |
| F26 | `src/components/video/hooks/videoExportItems.ts` | 修改 | 渲染键改为 `JSON.stringify([trackId, itemId])`，去掉 NUL 字节（RV3-12）；导出 `isClipMaterialMissing` | EX3-07、N-01 |
| F27 | `src/app/api/video-compose/[compositionId]/cancel/route.ts` | 新增 | BFF 透传取消（POST） | EXO-07 |

### 4.3 前端 · 时间轴核心（TL）

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F28 | `timeline/domain/services/MagneticInsertion.ts` | 新增 | `magneticInsertIndex` | TL3-01 |
| F29 | `timeline/domain/aggregates/TimelineAggregate.ts` | 修改 | `reorderMagneticItem`；`restore` 保留轨道视图标志 | TL3-01、ME-12 |
| F30 | `timeline/store/actions/reorderItem.ts` | 新增 | `reorderItemAction` | TL3-01 |
| F31 | `timeline/store/slices/dragSlice.ts` | 修改 | 磁性轨按插入序号提交；跨轨后重排；只在真正转移时选中滚动；字幕轨 `fitMove` | TL3-01、TL3-02、TL3-04 |
| F32 | `timeline/domain/services/HistoryService.ts` | 修改 | `_lastAdd`、`discardLastAction` | TL3-02 |
| F33 | `timeline/store/slices/historySlice.ts` | 修改 | 捕获后态时无变化即撤回 | TL3-02 |
| F34 | `timeline/domain/services/snapshotEquality.ts` | 新增 | `tracksEqual`（`replaceTimelineAction` 同步改用） | TL3-02 |
| F35 | `timeline/store/actions/replaceTimeline.ts` | 修改 | 改用 `tracksEqual`，删除重复比较；非 `'import'` 写入经 `carryViewFlags` 保留现行轨道标志 | TL3-02、ME-12（RV3-05） |
| F36 | `timeline/domain/services/FreeLaneRules.ts` | 新增 | `clampTrimEdge`、`fitMove` | TL3-04 |
| F37 | `timeline/store/actions/resizeItem.ts` | 修改 | 字幕轨边缘钳制、无变化不写历史 | TL3-04 |
| F38 | `timeline/store/actions/moveItem.ts` | 修改 | 字幕轨落点适配或拒绝 | TL3-04 |
| F39 | `timeline/store/actions/splitItem.ts` | 修改 | 隐藏轨跳过只作用于 `'playhead'` | TL3-05 |
| F40 | `timeline/store/actions/setCameraMotion.ts` | 修改 | 以 `canApplyCameraMotion` 过滤（含锁定轨） | TL3-06 |
| F41 | `timeline/domain/entities/TimelineItem.ts` | 修改 | 无裁剪信息的非字幕条目裁剪前物化裁剪区间 | TL2-05 |
| F42 | `timeline/domain/entities/Track.ts` | 修改 | `applyViewFlags` | ME-12 |
| F43 | `timeline/store/actions/trackActions.ts` | 修改 | 锁定 / 显示 / 静音切换不入历史；`revertTrackVolumePreviewAction` | ME-12、TL2-10 |
| F44 | `timeline/store/slices/selectionSlice.ts` | 修改 | `selectItems` | TL2-22 |
| F45 | `timeline/lib/duplicateClips.ts` | 新增 | 从 TimelinePanel 抽出的复制逻辑，返回新 id | TL2-22 |
| F46 | `src/components/video/lib/probeMediaDuration.ts` | 新增 | 媒体时长探测 | ME-11 |
| F47 | `timeline/domain/services/DragCalculationService.ts`、`timeline/domain/index.ts`、`timeline/domain/machines/dragMachine.ts` | 修改 | 删除死方法与重复类型导出、更新注释 | N-17 |
| F48 | `src/lib/video-editing-agent/trackPatch.ts` | 修改 | 冲突检测忽略 `VIEW_FLAG_KEYS`（v2 评审 RV3-05 改为必做） | ME-12 |
| F100 | `timeline/domain/services/trackViewFlags.ts` | 新增 | `VIEW_FLAG_KEYS`、`carryViewFlags` | ME-12（RV3-05） |

### 4.4 前端 · 时间轴界面与共享 UI（UI 与 TL 的界面部分）

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F49 | `timeline/TimelinePanel.tsx` | 修改（仅连线，新逻辑进 F45/F57–F61） | 复制后选中；整理无变化提示；探测时长后拖放；运镜打开者资格；缺失素材谓词；三个弹窗 portal；滚轮锚点应用；跟随播放头；拖拽滚动补偿；拖拽中 Esc 不取消选择；`role="region"`；`isPlaying` 移出形状 JSON；片段可见性助手 | TL2-22、TL3-02、ME-11、TL3-06、N-01、N-12、TL2-07、TL2-24、UI3-13、UI3-14、UI3-10 |
| F50 | `timeline/TrackContainer.tsx` | 修改 | 原生 wheel 钩子；空白处取消选择；忽略 portal 事件；S16；渐隐改有效颜色并偏移到轨道头之后；传递缺失素材谓词 | TL2-07、TL2-08、UI3-01、UI3-06、UI3-09、UI3-10、N-01 |
| F51 | `timeline/Track.tsx` | 修改 | 静音按钮；粘性轨道头；删除重复 `title`；透明度别名；传递缺失素材谓词 | ME-12、UI3-10、UI3-05、TL2-14、N-01 |
| F52 | `timeline/TimelineItem.tsx` | 修改 | 字幕自由边缘；剪切锁定提示；缺失素材徽标；句子条 `clipStart` 与 i18n；内部按钮键盘守卫；行内编辑器守卫 | TL3-03、TL3-05、N-01、TL2-11、UI3-03、UI3-04 |
| F53 | `timeline/TimelineRuler.tsx` | 修改 | 主键刮擦并聚焦；S16；缩放按钮锚点 `onZoomRequest`；横向滚轮转发；删除 React `onWheel` 与重复 `title` | TL2-07、TL2-12、UI3-05、UI3-06 |
| F54 | `timeline/TimelineToolbar.tsx` | 修改 | 工具状态实时文案；`aria-pressed`；`PortalTooltip`；类型化配置；有效焦点环；透明度别名 | TL2-12、UI3-05、TL2-14 |
| F55 | `timeline/SentenceSegmentBar.tsx` | 修改 | `clipStart` 窗口化；删除被裁剪的悬停卡片 | TL2-11 |
| F56 | `timeline/VolumeSlider.tsx` | 修改 | Esc / 失焦 / 卸载取消并回写；焦点归还；S16 | TL2-10、UI3-02、UI3-06 |
| F57 | `timeline/shortcutOwnership.ts` | 修改 | `resolveGlobalSpaceAction`；`shouldShortcutRunDuringInteraction` | TL2-13、UI3-11、UI3-13 |
| F58 | `timeline/inputModality.ts` | 新增 | 输入模态跟踪 | TL2-13 |
| F59 | `timeline/hooks/useTimelineWheel.ts` | 新增 | 非被动 wheel 缩放 / 转发 | TL2-07 |
| F60 | `timeline/hooks/useFollowPlayhead.ts` | 新增 | 播放时视图跟随 | TL2-24 |
| F61 | `timeline/lib/zoomAnchor.ts`、`timeline/lib/mouseGesture.ts`、`timeline/lib/sentenceWindow.ts`、`timeline/lib/followPlayhead.ts`、`timeline/lib/clipVisibility.ts` | 新增 | 纯函数助手 | TL2-07、UI3-06、TL2-11、TL2-24、UI3-10 |
| F62 | `timeline/__tests__/test-utils/compileComponent.ts` | 新增 | 共享 TSX 转译加载器（含 `ResizeObserver` 桩） | UI 组测试 |
| F63 | `src/components/video/VideoEditingInterface.tsx` | 修改（仅连线） | 图片位置提交回滚；空格动作与模态跟踪；`materialsLoaded`；切段改用 F86；切段 i18n 提示；Agent `dismissExecutionError / singleUndoMessageIds` 透传 | PV3-04、N-18、TL2-13、UI3-11、N-01、DS3-04、N-13、AG3-04、AG2-05 |
| F64 | `src/components/ui/Modal.tsx` | 修改 | `onClose` 存 ref，effect 只依赖 `isOpen`；默认根类 `z-50` 改为 `z-modal` | UI3-07、UI3-08（RV3-15） |
| F65 | `src/components/ui/ConfirmationDialog.tsx` | 修改 | `z-modal`；默认文案按语言 | UI3-08 |
| F66 | `src/components/video/components/CameraMotionModal/CameraMotionModal.tsx` | 修改 | 放弃确认改用 `ConfirmationDialog`；主按钮悬停别名 | UI3-07、TL2-14 |
| F67 | `src/components/video/components/SubtitleEditModal/SubtitleEditModal.tsx` | 修改 | 主按钮悬停别名 | TL2-14 |
| F68 | `tailwind.config.js` | 修改 | `*-a` 透明度别名 | TL2-14 |
| F69 | `src/styles/video-editing.css` | 修改 | 10 处 `hsl(var(--x))` 改为 `color-mix` | UI3-09 |
| F70 | `src/components/video/projects/ProjectSidebar.tsx`、`src/components/video/components/VideoChatWindow/timeline/TimelineConnector.tsx` | 修改 | 各 1 处无效 `hsl()` | UI3-09 |

### 4.5 前端 · 剪辑 Agent（AG）

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F71 | `src/lib/video-editing-agent/SSEStreamManager.ts` | 修改 | 跨块解析状态；无活动超时 + 硬上限 | AG3-01、AG2-21 |
| F72 | `src/app/api/video-editing-agent/chat/route.ts` | 修改 | 超时先发错误再取消；共享默认时间轴 | AG3-02、AG2-04 |
| F73 | `src/lib/video-editing-agent/defaultTimeline.ts` | 新增 | `createDefaultAgentTimelineState` | AG2-04 |
| F74 | `src/lib/video-editing-agent/historyBudget.ts` | 新增 | `compactHistoryForModel` | AG2-13 |
| F75 | `src/lib/video-editing-agent/agent.ts` | 修改 | `formatProviderError`、`stopReason` 处理；历史预算；删除强转 | AG3-03、AG2-13、N-19 |
| F76 | `src/lib/video-editing-agent/types.ts` | 修改 | `add_clip.material: AgentMaterialData`；SSE `error.code` | N-19、AG3-02、AG3-03 |
| F77 | `src/lib/video-editing-agent/reconcile.ts` | 修改 | delete / trim / resize 同样贴紧 | N-10 |
| F78 | `src/lib/video-editing-agent/tools/{index,getTimeline,addToTrack,moveClip,trimClip,resizeClip,deleteClip,composeStoryboard,checkOverlaps}.ts` | 修改 | 重叠警告限定受影响轨道 + `autoFixable`；`get_timeline` 字段；`shiftedClips`；类型 | AG2-03、AG2-18、N-10、N-19 |
| F79 | `src/lib/video-editing-agent/OperationApplier.ts` | 修改 | 共享默认时间轴 | AG2-04 |
| F80 | `src/lib/video-editing-agent/AgentEventRouter.ts`、`src/lib/video-editing-agent/AgentStateManager.ts` | 修改 | `markTimelineChanged`；`markCancelled({ byUser })`；服务端超时不记为用户停止 | AG3-06、AG3-02 |
| F81 | `src/lib/video-editing-agent/errorRecovery.ts` | 修改 | 只保留错误类型，文案由 UI 本地化 | AG2-20 |
| F82 | `src/types/index.ts` | 修改 | `AgentToolCallRecord.changedTimeline` | AG3-06 |
| F83 | `src/components/video/hooks/useAgentExecution.ts` | 修改 | 默认基线；按消息 id 的 applier 映射；请求体剥离补丁；封口守卫与 `dismissExecutionError`；看门狗封口与退役轮次按 id 写回；本地化提示 | AG2-04、AG2-05、AG2-13、AG3-04、AG3-05、N-21、AG2-20 |
| F84 | `src/components/video/components/VideoChatWindow/timeline/{utils.ts,AgentResponseNode.tsx,TimelineChatPanel.tsx,AgentExecutionNode.tsx,ToolStep.tsx,ErrorStateCard.tsx}` | 修改 | i18n；ARIA 菜单；纯工具轮次撤销；菜单过滤；终态错误「关闭」 | AG2-17、AG2-20、AG3-04、AG3-06、AG2-05 |
| F85 | `src/components/video/components/VideoChatWindow/VideoChatWindow.tsx` | 修改 | 透传 `onDismiss` 与单步撤销可用性 | AG3-04、AG2-05 |
| F101 | `src/lib/video-editing-agent/timeouts.ts` | 新增 | `AGENT_IDLE_TIMEOUT_MS`、`CLIENT_IDLE_GRACE_MS`、`AGENT_MAX_DURATION_MS`（路由与 `SSEStreamManager` 共用） | AG2-21（RV3-09） |

### 4.6 前端 · AI 混剪、自动混剪与数据安全（AM / DS）

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F86 | `src/components/video/lib/clipCutResults.ts` | 新增 | `buildClipPlaceholder`、`matchClipCutResults` | DS3-04、N-13 |
| F87 | `src/components/video/projects/repairTimelineData.ts` | 修改 | 只钳制不误删；逐条试构造；`salvageTimelineData` | DS3-01、N-07 |
| F88 | `src/components/video/projects/hydrateTimeline.ts` | 修改 | 有删除的修复同样备份 | DS3-01 |
| F89 | `src/components/video/projects/VideoEditorContainer.tsx` | 修改 | 恢复 / 丢弃备份入口；修复继承的脚本段归属 | N-07、N-13 |
| F90 | `src/components/video/hooks/useMaterialManagement.ts` | 修改 | 删除同步移出 store + 合并守卫；清空全部走引用计划；清理失败提示 | DS3-02、DS3-03、N-08 |
| F91 | `src/components/video/lib/api/materialCacheClient.ts` | 修改 | 删除请求失败记录日志 | N-08 |
| F92 | `src/components/video/lib/derivedMaterial.ts` | 修改 | `withoutScriptSegment`、`repairInheritedSegmentMembership` | N-13 |
| F93 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | 修改 | 静音移除结果剥离脚本段归属 | N-13 |
| F94 | `src/components/video/lib/aiMix/planScriptAutoMix.ts` | 修改 | `'skipped-no-video'` | AM3-01 |
| F95 | `src/components/video/hooks/useScriptAutoMix.ts` | 修改 | 提示 `skippedNoVideo` | AM3-01 |
| F96 | `src/components/video/hooks/useAIMixedEditing.ts` | 修改 | 传输错误不包装为导入错误 | AM3-02 |
| F97 | `src/lib/api/server/backend-proxy.ts` | 修改 | `abortOnClientDisconnect` | AM2-04 |
| F98 | `src/app/api/ai-mixed-editing/route.ts`、`src/app/api/video/batch-analyze/route.ts`、`src/app/api/timeline-import/route.ts` | 修改 | 开启客户端断开中止 | AM2-04 |
| F99 | `src/lib/i18n.ts` | 修改 | §6.4 全部新增 key（接口类型 + en + zh-CN 三处）；改写 `exportTimeout`；删除无引用的 `failedVideos / recoverySuggestions` 文案 | 全部文案 |

### 4.7 后端

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| B1 | `app/services/composition/media_probe.py` | 新增 | `VideoStreamInfo`、`probe_video_stream`、`ffprobe_path_for` | EX3-01、EX3-02 |
| B2 | `app/services/video_composition_service.py` | 修改 | 显示尺寸 / 未知时长；不复制同源文件；连续段预合并与 `-threads 1`；原声用本地路径；只校验音频 URL；`stage` 与细粒度进度；取消检查点；成片目录与 TTL 清理；弹出请求体；图片可解码校验；WinError 206 可读；删除 `_download_video*` 死代码；长命令经 `_run_tracked_ffmpeg` 写活动心跳、合成阶段进度插值；排队取消不占槽 | EX3-01～06、N-04、N-14、EXO-07、N-11、RV3-02、RV3-13 |
| B3 | `app/services/composition/filtergraph_builder.py` | 修改 | `RunPlan`、`plan_runs` | N-04 |
| B4 | `app/services/composition/audio_mix.py` | 修改 | `MAX_MIX_INPUTS`、`chunk_sources`、分块合流 | EX3-04 |
| B5 | `app/services/subtitle_service.py` | 修改 | 滤镜选项值转义；假名 / 谚文检测、字体、逐字换行；ASCII 日志 | N-15 |
| B6 | `app/services/local_media_resolver.py` | 修改 | `composed_output_dir`、路由前缀 | EX3-06 |
| B7 | `app/routers/video_router.py` | 修改 | 状态白名单 `stage`、`activity_at`；`POST /compose/{id}/cancel`；下载按新目录；批量解析断开取消 | EXO-07、EX3-06、AM2-04 |
| B8 | `app/utils/client_disconnect.py` | 新增 | `ClientDisconnectedError`、`run_until_client_disconnects` | AM2-04 |
| B9 | `app/routers/ai_mixed_editing_router.py` | 修改 | 断开即取消并返回 499 | AM2-04 |
| B10 | `app/services/ai_video_generate_service.py`、`app/routers/ai_video_generate_router.py`、`docs/apis/ai-video-generate-node.md` | 删除 | 无调用方的旧工作流 | BL-14 |
| B11 | `app/routers/__init__.py`、`app/main.py`、`env.template` | 修改 | 取消注册与挂载、删除注释中的名称 | BL-14 |
| B12 | `app/services/timeline_parser_service.py` | 修改 | 删除仅测试调用的 `validate_simplified_timeline` 等 | BL-14 |
| B13 | `app/models/video_models.py` | 修改（按需） | 状态模型若为 Pydantic 定义则增加 `stage`、`activity_at` 字段 | EXO-07 |
| B14 | `app/services/composition/ffmpeg_args.py` | 修改 | `progress_args` | EXO-07（RV3-02） |

### 4.8 文档

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| D1 | `CLAUDE.md` | 修改 | 删除「except `ai_video_generate_router`」；「registers 32 routers」改为 31（基线 `app/main.py` 有 32 处 `include_router`，RV3-17） | BL-14 |
| D2 | `.claude-index/index.md` | 修改 | 删除该服务与路由条目 | BL-14 |
| D3 | `docs/plans/ai-and-manual-editing-reliability-r3/spec.md` | 新增 | 本文 | — |

测试文件见 §7.1（前端 T1–T96，后端 BT1–BT18）。

---

## 5. 接口设计

### 5.1 REST：取消合成（新增）

- 后端：`POST /api/video/compose/{composition_id}/cancel`（`video_router.py`，与既有 `GET /compose/{composition_id}/status` 同一路由器与 `/api` 前缀）。
- BFF：`src/app/api/video-compose/[compositionId]/cancel/route.ts`，POST，按既有 `status/route.ts` 的写法以 `(p) => \`/api/video/compose/${p.compositionId as string}/cancel\`` 透传（无请求体）。
- 响应：

| 情况 | HTTP | 体 |
|---|---|---|
| 状态为 queued / processing | 200 | `BaseResponse`：`{ "success": true, "message": "cancelling", "data": { "composition_id": "<id>", "status": "cancelling" }, "timestamp": "…" }` |
| 已终态（completed / failed） | 409 | `ErrorResponse`：`error_code: "COMPOSITION_ALREADY_SETTLED"` |
| 未知 id | 404 | `ErrorResponse`：`error_code: "COMPOSITION_NOT_FOUND"` |

- 前端：`src/lib/api/videoComposition.ts` 新增 `export async function cancelComposition(compositionId: string): Promise<void>`（409 / 404 视为已无需取消，记录日志后正常返回；其他错误抛出，由调用方记录日志并仍中止客户端轮询）。

### 5.2 REST：合成状态（修改）

`GET /api/video/compose/{composition_id}/status` 的 `data` 在白名单中增加 `stage` 与 `activity_at`（Unix 秒，底层 ffmpeg 最近一次写进度文件的时间，无运行中的长命令时省略；v2 评审 RV3-02）；取消的任务以 `status: "failed"`、`composition_stage: "cancelled"` 结束：

```json
{ "success": true, "data": {
  "composition_id": "c-1", "status": "processing", "progress": 0.52,
  "stage": "normalizing", "activity_at": 1789400123.4, "warnings": [], "degradations": []
} }
```

```json
{ "success": true, "data": {
  "composition_id": "c-1", "status": "failed", "progress": 0.52,
  "stage": "normalizing", "composition_stage": "cancelled", "error_summary": "cancelled by user"
} }
```

失败时 `error_details.failed_videos: Array<{ video_name: string; stage?: string; error_message?: string }>` 保持既有形状，前端改为经 `CompositionFailedError.details` 读取（EX3-08）。

### 5.3 Agent SSE：错误事件与取消原因（修改）

- `error` 事件：`data: {"type":"error","message":"…","code":"provider_auth"}`；`code ∈ provider_auth | provider_rate_limit | context_overflow | provider_error | empty_response | server_timeout | tool_failures | agent_error`（后两个由代码评审 RC3-29、RC3-30 增加：连续工具失败熔断、路由未预期异常），旧客户端忽略 `code` 仍可显示 `message`。
- 服务端无活动超时的发送顺序固定为：`error(code=server_timeout)` → `cancelled(reason=server_timeout)` → `[DONE]`。客户端读到 `cancelled` 时 `error` 已被处理。
- `cancelled` 事件的 `reason` 为 `server_timeout` 时不记为用户停止；其他原因（用户停止、导航离开）保持现状。
- 解析层（AG3-01）按 SSE 规范：多行 `data:` 以 `\n` 连接，`id:` 后可无空格，行尾 `\r` 去除，空行派发。

### 5.4 REST：客户端断开即取消（修改）

| 接口 | 后端行为 | BFF |
|---|---|---|
| `POST /api/ai-mixed-editing` | 请求体解析后以 `run_until_client_disconnects` 运行服务；断开时取消任务、记录 `AI mixed editing cancelled by the client`、返回 499（空体） | `abortOnClientDisconnect: true` |
| `POST /api/video/batch-analyze` | 同上（同步抽帧在下一个 await 处生效） | 同上 |
| `POST /api/timeline-import` | 不变（导入耗时短） | 同上（中止上游 fetch） |

499 只用于日志：客户端已中止，不会读取该响应。

### 5.5 REST：删除的接口

`POST /api/workflow/ai-video-generate`（`ai_video_generate_router`）删除，请求返回 404。全仓零调用方（BL-14）。

### 5.6 Agent 工具结果（模型可见，修改）

| 工具 | 变化 |
|---|---|
| `get_timeline` | 轨道增加 `visible`；片段增加 `kind`、可选 `text`（≤200 字符）、`audioDetached`、`transitionIn / transitionOut`、`opacity`；输出紧凑 JSON；重叠项增加 `autoFixable` |
| `check_timeline_overlaps` | 每条重叠增加 `autoFixable`；摘要说明字幕 / 锁定轨上的重叠除非用户要求否则忽略 |
| `add_to_track`、`move_clip`、`trim_clip`、`resize_clip`、`compose_storyboard` | `overlapWarning` 只针对本次操作涉及且可自动修复的轨道 |
| `delete_clip`、`trim_clip`、`resize_clip` | 操作后贴紧所在轨道（N-10），结果增加 `shiftedClips: Array<{ clipId, from, to }>`；工具描述写明「删除 / 缩短会让后续片段前移」 |

历史重放（AG2-13）：更早轮次中 `get_timeline / list_materials / search_materials / check_timeline_overlaps` 的结果被替换为 `{"omitted":"stale <tool> snapshot; call it again"}`；系统提示同步说明「看到 omitted 时重新调用工具获取最新状态」。

### 5.7 前端内部 API（新增 / 变更签名汇总）

```ts
// 预览
outputFrameRect(destWidth: number, destHeight: number, targetAspect: number): FitRect
fitSourceInFrame(sourceWidth: number, sourceHeight: number, frame: FitRect): FitRect
layoutSubtitle(text: string, style: { fontSize: number; position: string }, output: OutputSize): { lines: SubtitleLineLayout[]; lineHeight: number }
outputSizeForAspect(aspectId: string): OutputSize
class PreviewGainRouter { apply(el, volume): ApplyVolumeOutcome; isRouted(el): boolean; resume(): Promise<void>; dispose(): void }
imageEditBlocker(get: () => TimelineStore, itemId: string): ImageEditBlocker | null
readImagePosition(get: () => TimelineStore, itemId: string): ImagePosition | undefined
resolveImagePositionCommit(blocker: ImageEditBlocker | null, storePosition: ImagePosition | undefined): ImagePositionCommit

// 导出
pollCompositionStatus(id: string, onProgress: (s: CompositionStatus) => void, options?: PollCompositionOptions): Promise<CompositionStatus>
cancelComposition(id: string): Promise<void>
describeExportFailure(error: unknown, t: Translations, locale: Locale): string
beginExportSession(sessionKey: string, controller: AbortController): boolean   // sessionKey = taskId 或 taskId:projectId（RV3-07）；+ get / update / end / subscribe

// 时间轴核心
magneticInsertIndex(peers: readonly MagneticPeer[], draggedId: string, previewStart: number): number
reorderItemAction(get: () => TimelineStore, itemId: string, insertIndex: number): boolean
HistoryService.discardLastAction(): boolean
tracksEqual(a: readonly TrackData[], b: readonly TrackData[]): boolean
clampTrimEdge(peers, itemId, edge, position, current): number
fitMove(peers, itemId, start, duration): number | null
duplicateSelectedClips(data: TimelineData, selectedIds: readonly string[], nameFor: (name: string) => string): { data: TimelineData; newIds: string[] }
probeMediaDuration(url: string, timeoutMs?: number): Promise<number | null>
revertTrackVolumePreviewAction(get: () => TimelineStore, trackId: string, preGestureVolume: number): void
isClipMaterialMissing(item: TimelineItemData, materialsById: ReadonlyMap<string, MaterialItem>): boolean

// 交互
trackMouseGesture(handlers: MouseGestureHandlers, win?: Window): () => void
computeAnchoredScrollLeft(input: { timeAtAnchor: number; anchorOffsetPx: number; pixelsPerSecond: number }): number
resolveGlobalSpaceAction(event: Pick<KeyboardEvent, 'code' | 'target' | 'repeat'>, modality: InputModality): GlobalSpaceAction
installInputModalityTracking(doc: Document): () => void
projectSentencesOntoClip(sentences, clipStart: number, duration: number): ProjectedSentence[]
computeFollowScrollLeft(input): number | null
isClipVisibleInLane(input: { elLeft: number; elRight: number; scrollLeft: number; clientWidth: number; headerWidth: number }): boolean
nudgeImagePosition(position: ImagePosition, key: ArrowKey, large: boolean): ImagePosition

// Agent
formatProviderError(raw?: string): { code: AgentStreamErrorCode; message: string }
createDefaultAgentTimelineState(): TimelineState
compactHistoryForModel(messages: readonly Message[], budget?: number): Message[]
AgentStateManager.markTimelineChanged(toolCallId: string): void
AgentStateManager.markCancelled(options?: { appendMarker?: boolean; byUser?: boolean }): void

// 数据安全 / AI 混剪
salvageTimelineData(raw: unknown): { data: TimelineData; report: { droppedTrackIds: string[]; droppedItemIds: string[] } } | null
matchClipCutResults(pending: readonly PendingClip[], results: readonly VideoCutClipResult[]): { matched; unmatched }
withoutScriptSegment(metadata: MaterialMetadata | undefined): MaterialMetadata
repairInheritedSegmentMembership(materials: readonly MaterialItem[]): { materials: MaterialItem[]; repairedIds: string[] }
executeDelete(materialIds: string[], options?: { reportCleanupFailure?: boolean }): void
```

```python
# 后端
probe_video_stream(path: str, ffprobe_path: str, timeout: float = 30.0) -> Optional[VideoStreamInfo]
plan_runs(clips: Sequence[CanvasClip], fps: int) -> List[RunPlan]
chunk_sources(count: int, max_inputs: int = MAX_MIX_INPUTS) -> List[range]
escape_filter_option_value(value: str) -> str
composed_output_dir() -> Path
async def run_until_client_disconnects(request: Request, work: Awaitable[T]) -> T
```

---

## 6. 数据模型

### 6.1 持久化与数据库

- **数据库 schema 不变**；不新增启动期 DDL（CLAUDE.md「No destructive DDL」）。
- `project_data`（JSON）：
  - `timelineRecoveryBackup`：写入条件由「仅 `failed`」扩展为「`failed`，或 `repaired` 且有被删除的条目」（DS3-01）；形状不变（`{ savedAt: string; data: unknown }`，以 `src/types/index.ts:293` 现有定义为准）；新增用户可见的恢复 / 丢弃入口（N-07）。
  - 素材 `metadata`：切段 / 静音移除结果不再携带 `segment_id / segment_number / segment_title / segment_assigned_at / video_index_in_segment / segment_text_hash`；打开项目时幂等修复存量（N-13）。
  - 时间轴条目：结构不变。TL2-05 在用户首次裁剪旧条目时才写入 `clipStart / clipEnd`（不做批量迁移）。
  - Agent 会话消息：`agentToolCalls[].changedTimeline?: boolean` 新增可选字段（AG3-06）；旧消息缺省视为 false（撤销单步菜单不列出——只影响旧消息的单步撤销入口，整轮撤销不受影响）。
- 合成状态（内存）：成片输出目录由 `static/video/composed`（CWD 相对）改为 `STORAGE_ROOT` 下的 `composed_output_dir()`；已终态状态项 1 小时后清理；旧目录中的历史文件不迁移、不删除（EX3-06）。

### 6.2 Python 模型与数据类（后端）

```python
# app/services/composition/media_probe.py
@dataclass(frozen=True)
class VideoStreamInfo:
    width: int
    height: int
    fps: float
    duration: Optional[float]
    rotation: int

# app/services/composition/filtergraph_builder.py
@dataclass(frozen=True)
class RunPlan:
    track_id: str
    z: int
    clips: Tuple[CanvasClip, ...]
    start: float
    duration: float
    needs_alpha: bool

# app/services/composition/audio_mix.py
MAX_MIX_INPUTS: int = 64

# app/services/video_composition_service.py —— 合成状态字典新增 / 变更字段
CompositionStage = Literal['queued', 'resolving', 'normalizing', 'compositing', 'mixing', 'overlays', 'finalizing']
# status["stage"]: CompositionStage
# status["composition_stage"] 取值新增 'cancelled'（失败阶段字段，既有）
# status 不再保留 "request"（_compose_video_sync 结束时弹出）
# status["progress_files"]: Set[str]  —— 长 ffmpeg 命令运行期间的 -progress 文件（RV3-02）
# get_composition_status 的返回附加 activity_at: float（进度文件最大 mtime）
class CompositionCancelled(Exception): ...
_cancel_events: Dict[str, threading.Event]

# app/utils/client_disconnect.py
class ClientDisconnectedError(Exception): ...
```

归一化结果字典增加 `retryable: bool`（EX3-02）；`_resolve_overlay_image` 返回 `(Optional[str], Optional[str])` 形状不变，新增原因字符串 `"image file cannot be decoded"`（EX3-05）。

### 6.3 TypeScript 形状（前端）

```ts
// src/components/video/lib/subtitleLayout.ts
export interface OutputSize { width: number; height: number }
export interface SubtitleLineLayout { text: string; topY: number }

// src/components/video/playback/types.ts
export interface SubtitleCompositorLayer {
  kind: 'subtitle';
  id: string;
  lines: SubtitleLineLayout[];
  style: { fontSize: number; color: string; background?: string; fontFamily?: string };
  outputHeight: number;
  opacity: number;
  z: number;
}
export interface VideoTrackGroup { /* 既有字段 */ volumeScale?: number }
export interface MultiTrackAttachDeps { /* 既有字段 */ outputSize: OutputSize; applyVolume?: (element: VideoElementLike, volume: number) => void }

// src/components/video/lib/imagePositionCommit.ts
export type ImagePositionCommit =
  | { kind: 'apply' }
  | { kind: 'ignore' }
  | { kind: 'revert'; position: ImagePosition; reason: 'agent-lock' | 'track-locked' };

// src/lib/api/videoComposition.ts
export type CompositionStage = 'queued' | 'resolving' | 'normalizing' | 'compositing' | 'mixing' | 'overlays' | 'finalizing';
export interface CompositionStatus { /* 既有字段 */ stage?: CompositionStage; activity_at?: number }
export interface PollCompositionOptions { pollIntervalMs?: number; stallTimeoutMs?: number; signal?: AbortSignal }
export class CompositionFailedError extends Error { readonly details: CompositionErrorDetails }

// src/components/video/hooks/exportSessionStore.ts
export interface ExportSession { status: 'running'; progress: number; startTime: number; compositionId?: string; controller: AbortController }

// src/components/video/timeline/domain/services/HistoryService.ts（私有）
interface LastAddedAction { tail: TimelineAction[]; head: TimelineAction[]; index: number }

// src/components/video/timeline/shortcutOwnership.ts / inputModality.ts
export type GlobalSpaceAction = 'toggle' | 'swallow' | 'yield';
export type InputModality = 'keyboard' | 'pointer';

// src/lib/video-editing-agent/agent.ts / types.ts
export type AgentStreamErrorCode = 'provider_auth' | 'provider_rate_limit' | 'context_overflow' | 'provider_error' | 'empty_response' | 'server_timeout';
// SSE error 事件：{ type: 'error'; message: string; code?: AgentStreamErrorCode }
// TimelineOperation.add_clip.material: AgentMaterialData

// src/types/index.ts
export interface AgentToolCallRecord { /* 既有字段 */ changedTimeline?: boolean }

// src/components/video/lib/aiMix/planScriptAutoMix.ts
// AutoMixSegmentReport['status'] 增加 'skipped-no-video'

// src/components/video/lib/clipCutResults.ts
export interface PendingClip { clipId: string; material: MaterialItem }
```

`get_timeline` 工具结果（模型可见，AG2-03）：轨道 `{ id, type, name, locked, visible, clips: [...] }`；片段在既有字段基础上增加 `kind`、可选 `text`（≤200 字符）、`audioDetached`、`transitionIn / transitionOut: { type, duration }`、`opacity`；
重叠项增加 `autoFixable: boolean`（AG2-18）；`delete_clip / trim_clip / resize_clip` 结果增加 `shiftedClips: Array<{ clipId: string; from: number; to: number }>`（N-10，与 `add_clip / move_clip` 既有字段同形）。

### 6.4 新增 / 修改 i18n key（`src/lib/i18n.ts`：接口类型、`en`、`zh-CN` 三处同步）

命名空间不存在时在接口与两种语言中新建子对象（经核查 `agentTimeline`、`agentStream`、`videoEditing.clipCut` 不存在；`imageOverlay`、`videoProjects`、`videoEditing.autoMix`、`timeline.sentenceSegment`、`videoExportProgressModal.progressStages` 已存在）。

| Key | en | zh-CN | 关联 |
|---|---|---|---|
| `videoPlayerPanel.playback.volumeBoostUnavailable` | Volume above 100% is not audible in preview until this clip is downloaded; the export applies it. | 该片段下载完成前，预览中听不出超过 100% 的音量；导出会按设置生效。 | ME-06 |
| `videoExport.exportCancelled` | Export cancelled | 已取消导出 | EXO-07 |
| `videoExport.exportTimeout`（改写） | The export made no progress for 10 minutes and was stopped. Try again, or export a shorter timeline. | 导出已 10 分钟没有进展，已停止。请重试，或先导出较短的时间轴。 | EXO-07 |
| `videoExport.failedStageMediaResolution` | {count} clips use materials that are not on this computer: {names}. Re-import or download them first | {count} 个片段的素材不在本地：{names}。请先重新导入或下载这些素材 | EX3-08 |
| `videoExport.failedStageNormalization` | {count} clips could not be processed: {names}. The files may be damaged or unsupported | {count} 个片段无法处理：{names}。文件可能已损坏或格式不受支持 | EX3-08 |
| `videoExport.failedStageCompose` | Something went wrong while rendering the video. Try again | 合成视频时出错，请稍后重试 | EX3-08 |
| `videoExportProgressModal.progressStages.queued` | Waiting for another export to finish | 正在等待其他导出完成 | EXO-07 |
| `timeline.messages.organizeMaterialsAlreadyTidy` | Clips are already packed. | 素材已经排列整齐 | TL3-02 |
| `timeline.messages.durationUnknownFallback` | Couldn't read this clip's length; it was added as 5 s | 无法读取片段时长，已按 5 秒添加 | ME-11 |
| `timeline.messages.probingDuration` | Reading the clip's length… | 正在读取片段时长… | ME-11（RV3-21） |
| `timeline.track.materialMissing` | Material deleted — this clip won't render | 素材已删除，此片段无法预览与导出 | N-01 |
| `timeline.sentenceSegment.sentenceCount` | {count} sentences | {count} 句 | TL2-11 |
| `timeline.panelAriaLabel` | Timeline | 时间轴 | UI3-14 |
| `timeline.cameraMotion.discardTitle` | Discard camera motion changes? | 放弃运镜修改？ | UI3-07 |
| `timeline.cameraMotion.discardAction` | Discard | 放弃 | UI3-07 |
| `imageOverlay.overlayLabel` | Image overlay. Drag, or use the arrow keys to move it (hold Shift for larger steps). | 图片叠加层。可拖动，或用方向键移动（按住 Shift 移动更多）。 | N-02 |
| `agentTimeline.responseAuthor` | AI | AI | AG2-20 |
| `agentTimeline.undoneTag` | (undone) | （已撤销） | AG2-20 |
| `agentTimeline.undoAll` | Undo all | 撤销本轮 | AG2-20 |
| `agentTimeline.undoAllTitle` | Undo every timeline change in this response | 撤销本轮回复对时间轴的全部修改 | AG2-20 |
| `agentTimeline.undoStep` | Undo a step | 撤销单步 | AG2-20 |
| `agentTimeline.undoStepItem` | Undo {index}. {tool} | 撤销 {index}. {tool} | AG2-20 |
| `agentTimeline.undoneNotice` | Changes undone | 修改已撤销 | AG2-20 |
| `agentTimeline.executing` | Executing | 执行中 | AG2-20 |
| `agentTimeline.executed` | Executed | 已执行 | AG2-20 |
| `agentTimeline.stop` | Stop | 停止 | AG2-20 |
| `agentTimeline.collapsedSummary` | {count} steps — click to expand | 共 {count} 步，点击展开 | AG2-20 |
| `agentTimeline.collapsedSummaryErrors` | {count} steps (with errors) — click to expand | 共 {count} 步（有失败），点击展开 | AG2-20 |
| `agentTimeline.cancelledNotice` | Stopped. Completed steps were kept. | 已停止，已完成的步骤已保留。 | AG2-20 |
| `agentTimeline.parameters` | Parameters | 参数 | AG2-20 |
| `agentTimeline.result` | Result | 结果 | AG2-20 |
| `agentTimeline.liveRetrying` | Retrying (attempt {n})… | 正在重试（第 {n} 次）… | AG2-20 |
| `agentTimeline.liveTool` | Running {tool}… | 正在执行 {tool}… | AG2-20 |
| `agentTimeline.liveProgress` | {count} steps done, continuing… | 已完成 {count} 步，继续执行中… | AG2-20 |
| `agentTimeline.liveWorking` | Agent is working… | Agent 执行中… | AG2-20 |
| `agentTimeline.cancel` | Cancel | 取消 | AG2-20 |
| `agentTimeline.retry` | Retry | 重试 | AG2-20 |
| `agentTimeline.dismiss` | Dismiss | 关闭 | AG3-04 |
| `agentTimeline.errorPrefix` | Agent error: {message} | Agent 出错：{message} | AG2-20 |
| `agentTimeline.toolNames.get_timeline` | Read timeline | 读取时间轴 | AG2-20 |
| `agentTimeline.toolNames.add_to_track` | Add to track | 添加到轨道 | AG2-20 |
| `agentTimeline.toolNames.trim_clip` | Trim clip | 裁剪片段 | AG2-20 |
| `agentTimeline.toolNames.delete_clip` | Delete clip | 删除片段 | AG2-20 |
| `agentTimeline.toolNames.move_clip` | Move clip | 移动片段 | AG2-20 |
| `agentTimeline.toolNames.resize_clip` | Change duration | 调整时长 | AG2-20 |
| `agentTimeline.toolNames.auto_fix_overlaps` | Fix overlaps | 修复重叠 | AG2-20 |
| `agentTimeline.toolNames.check_timeline_overlaps` | Check overlaps | 检查重叠 | AG2-20 |
| `agentTimeline.toolNames.compose_storyboard` | Compose storyboard | 合成分镜 | AG2-20 |
| `agentTimeline.toolNames.list_materials` | List materials | 列出素材 | AG2-20 |
| `agentTimeline.toolNames.search_materials` | Search materials | 搜索素材 | AG2-20 |
| `agentTimeline.toolNames.remove_material` | Remove material | 删除素材 | AG2-20 |
| `agentStream.errors.connectionLost` | Connection lost. Reconnecting… | 逐字沿用 `errorRecovery.ts:96-105` 现有中文 | AG2-20 |
| `agentStream.errors.stalled` | The agent stopped responding. Retrying… | 同上 | AG2-20 |
| `agentStream.errors.totalTimeout` | The run reached its maximum length and was stopped. | 执行时间超过最长限制，已停止。 | AG2-21 |
| `agentStream.errors.idleTimeout` | No progress for 30 minutes. The run was stopped. | 连续 30 分钟没有进展，已停止。 | AG2-21 |
| `agentStream.errors.parseError` | Could not read the response. Try again later. | 同上（沿用现有中文） | AG2-20 |
| `agentStream.errors.serverError` | The server hit an error. Try again later. | 同上 | AG2-20 |
| `agentStream.errors.toolError` | A tool failed. The agent is trying another way… | 同上 | AG2-20 |
| `agentStream.errors.cancelled` | Run cancelled. | 同上 | AG2-20 |
| `agentStream.errors.serverTimeout` | The agent made no progress for 30 minutes and was stopped. Finished steps were kept; try smaller steps. | Agent 连续 30 分钟无进展，已停止。已完成的步骤已保留，请拆分为更小的任务。 | AG3-02 |
| `agentStream.errors.providerAuth` | The model provider rejected the API key. Check Settings › Models. | 模型服务拒绝了 API Key，请在设置 › 模型中检查。 | AG3-03 |
| `agentStream.errors.providerRateLimit` | The model provider is rate limiting requests. Wait a moment and try again. | 模型服务请求过于频繁，请稍后重试。 | AG3-03 |
| `agentStream.errors.contextOverflow` | This conversation is too long for the model. Clear the chat or start a new one. | 对话内容超出模型上下文长度，请清空聊天或新建对话。 | AG3-03 |
| `agentStream.errors.providerError` | The model request failed: {detail} | 模型请求失败：{detail} | AG3-03 |
| `agentStream.errors.emptyResponse` | The model returned an empty response. It may not support tool calling. | 模型返回了空内容，可能不支持工具调用。 | AG3-03 |
| `videoProjects.restoreBackup` | Restore backed-up timeline | 恢复备份的时间轴 | N-07 |
| `videoProjects.restoreBackupConfirmTitle` | Restore the backed-up timeline? | 恢复备份的时间轴？ | N-07 |
| `videoProjects.restoreBackupConfirmBody` | The timeline backed up on {date} replaces the current one. Press Ctrl+Z to undo. | 将用 {date} 备份的时间轴替换当前时间轴，可按 Ctrl+Z 撤销。 | N-07 |
| `videoProjects.backupRestored` | Restored the backed-up timeline ({count} unreadable clips skipped) | 已恢复备份的时间轴（跳过 {count} 个无法读取的片段） | N-07 |
| `videoProjects.backupUnreadable` | The backed-up timeline still can't be read | 备份的时间轴仍无法读取 | N-07 |
| `videoProjects.discardBackup` | Discard backup | 丢弃备份 | N-07 |
| `videoProjects.discardBackupConfirmBody` | Delete the backed-up timeline for good? | 永久删除备份的时间轴？ | N-07 |
| `materialsPanel.deleteCleanupFailed` | {count} deleted materials couldn't be removed from disk. They're gone from this project, but their files still use space. | 有 {count} 个已删除素材的文件未能从磁盘清理。素材已从项目中移除，但文件仍占用空间。 | N-08 |
| `materialsPanel.clearAllInUseMessage` | Clear all {count} materials? {clipCount} clips on the timeline use them and will be removed too. Press Ctrl+Z to restore the clips; the materials can't be restored. | 确定要清除全部 {count} 个素材吗？时间轴上有 {clipCount} 个片段使用这些素材，将一并移除（按 Ctrl+Z 可恢复片段，素材不可恢复）。 | DS3-03 |
| `videoEditing.clipCut.processing` | Cutting {count} clips… | 正在处理 {count} 个视频切片，请稍候… | DS3-04 |
| `videoEditing.clipCut.done` | Saved {count} clips to the library | 已成功处理 {count} 个视频切片并保存到本地素材库 | DS3-04 |
| `videoEditing.clipCut.partialFailed` | {failed} of {total} clips couldn't be cut and were removed | {total} 个切片中有 {failed} 个切分失败，已移除 | DS3-04 |
| `videoEditing.clipCut.failed` | Couldn't cut the video: {message} | 视频切分失败：{message} | DS3-04 |
| `videoEditing.autoMix.skippedNoVideo` | Segments {list} have no matched video and were skipped | 第 {list} 段没有匹配的视频，已跳过 | AM3-01 |

**复用的既有 key**：`timeline.messages.trackLocked`、`timeline.messages.editLockedByAgent`、`timeline.track.mute / unmute`、`common.confirm / cancel`、`videoExport.exportCompletedButDownloadFailed`、`videoExportProgressModal.cancelExport`、`timeline.cameraMotion.discardConfirm`、`timeline.status.currentTool`、`timeline.toolbar.cut / select`。

**阶段 → 进度文案映射**（`VideoExportProgressModal.getProgressStage`，不新增其余阶段 key）：`queued` → `progressStages.queued`；`resolving` → `preparing`；`normalizing` → `processing`；`compositing` → `composing`；`mixing / overlays` → `generating`；`finalizing` → `almostDone`；无 `stage`（旧后端）→ 沿用按进度百分比的现有规则。

**删除的 key**：`videoExport` 下因 EX3-08 不再引用的 `failedVideos / recoverySuggestions` 相关文案（实现节点以 grep 确认无引用后删除，三处同步）。

**代码评审补充（RC3，均为接口类型 / en / zh-CN 三处同步）**：新增 `agentStream.errors.toolFailures`（RC3-29）、`agentStream.errors.agentError`（RC3-30）、`agentTimeline.thinking / thoughtProcess / analyzing / userAuthor`（RC3-31）、`agentTimeline.retriesUsed`（RC3-33）、`videoProjects.backupRestoredAll`（RC3-40）、`videoEditing.clipCut.clipDescription`（RC3-26）；删除无引用的 `agentTimeline.cancel`（RC3-34，改用 `agentTimeline.stop`）。拖放时目标轨已被删除的提示复用既有 `agentApply.reasons.trackNotFound`（RC3-19）。

---

## 7. 测试与验收

### 7.1 回归测试用例（每条缺陷至少一个，用例名描述被钉住的行为）

用例名以英文书写（沿用仓库惯例），各条目的完整用例名见 §3 对应小节。路径前缀：`timeline/` = `src/components/video/timeline/`，`agent/` = `src/lib/video-editing-agent/`，`hooks/` = `src/components/video/hooks/`，`vpp/` = `src/components/video/components/VideoPlayerPanel/`，`tests/` = `backend-services/basic-service/tests/`。

**前端 · 预览与导出（T1–T23）**

| # | 文件 | 类型 | 关联 |
|---|---|---|---|
| T1 | `src/components/video/playback/__tests__/CanvasCompositor.frameFit.test.ts` | 新增 | PV3-01 |
| T2 | `src/components/video/playback/internal/__tests__/fitContain.test.ts` | 修改 | PV3-01 |
| T3 | `vpp/__tests__/ImageOverlay.interaction.test.tsx` | 修改 | PV3-02 |
| T4 | `src/components/video/playback/__tests__/MultiTrackPlaybackEngine.imageLoadRepaint.test.ts` | 新增 | PV3-02 |
| T5 | `hooks/__tests__/useCompositionPlayback.imageSource.test.ts` | 新增 | PV3-02 |
| T6 | `hooks/__tests__/useCompositionPlayback.test.tsx` | 修改 | PV3-03 |
| T7 | `src/components/video/playback/__tests__/VideoSourcePool.test.ts` | 修改 | PV3-03、ME-06 |
| T8 | `src/components/video/playback/__tests__/MultiTrackPlaybackEngine.test.ts` | 修改 | PV3-03 |
| T9 | `src/components/video/lib/__tests__/imagePositionCommit.test.ts` | 新增 | PV3-04、N-18 |
| T10 | `vpp/__tests__/imageOverlays.test.ts` | 修改 | PV3-04 |
| T11 | `src/components/video/lib/__tests__/subtitleLayout.test.ts` | 新增 | EXO-09、N-15 |
| T12 | `src/components/video/playback/__tests__/CanvasCompositor.subtitleScale.test.ts` | 新增 | EXO-09 |
| T13 | `src/components/video/playback/__tests__/SubtitleLayer.test.ts`、`assembleLayers.test.ts`、`assembleLayers.camera.test.ts`、`multiTrackCompositorS2Boundaries.test.ts`；`vpp/__tests__/PreviewCanvas.test.tsx`；`hooks/__tests__/useCompositionPlayback.probe.test.tsx`（`useCompositionPlayback.test.tsx` 见 T6）。删除 `measureSubtitle / wrapText / positionToVAnchor` 之后 A18 会命中这些文件（v2 评审 RV3-18） | 修改 | EXO-09 |
| T14 | `src/components/video/playback/audio/__tests__/PreviewGainRouter.test.ts` | 新增 | ME-06 |
| T15 | `src/components/video/playback/__tests__/AudioSyncPool.test.ts` | 修改 | ME-06 |
| T16 | `src/components/video/playback/__tests__/MultiTrackPlaybackEngine.seekBeyondRenderEnd.test.ts` | 新增 | N-06 |
| T17 | `vpp/__tests__/useCompositionTransport.progress.test.ts` | 新增 | N-06 |
| T18 | `src/lib/api/__tests__/videoComposition.poll.test.ts` | 新增 | EXO-07、EX3-08 |
| T19 | `hooks/__tests__/useVideoExport.session.test.ts` | 新增 | EXO-14 |
| T20 | `hooks/__tests__/useVideoExport.download.test.ts` | 新增 | EXO-14 |
| T21 | `hooks/__tests__/useVideoExport.failure.test.ts` | 新增 | EX3-08 |
| T22 | `hooks/__tests__/useVideoExport.cancel.test.ts` | 新增 | EXO-07 |
| T23 | `hooks/__tests__/videoExportItems.test.ts` | 修改 | EX3-07 |

**前端 · 时间轴核心（T24–T41）**

| # | 文件 | 类型 | 关联 |
|---|---|---|---|
| T24 | `timeline/domain/services/__tests__/MagneticInsertion.test.ts` | 新增 | TL3-01 |
| T25 | `timeline/store/slices/__tests__/dragSlice.magneticInsert.test.ts` | 新增 | TL3-01 |
| T26 | `timeline/store/slices/__tests__/history.noopEntry.test.ts` | 新增 | TL3-02 |
| T27 | `timeline/domain/machines/__tests__/dragMachine.subtitleEdges.test.ts` | 新增 | TL3-03 |
| T28 | `timeline/store/slices/__tests__/dragSlice.subtitleTrim.test.ts` | 新增 | TL3-03 |
| T29 | `timeline/store/actions/__tests__/subtitleLane.test.ts` | 新增 | TL3-04 |
| T30 | `timeline/domain/services/__tests__/FreeLaneRules.test.ts` | 新增 | TL3-04 |
| T31 | `timeline/store/actions/__tests__/splitItem.test.ts` | 修改 | TL3-05 |
| T32 | `timeline/store/actions/__tests__/setCameraMotion.lock.test.ts` | 新增 | TL3-06 |
| T33 | `timeline/domain/entities/__tests__/TimelineItem.legacyTrim.test.ts` | 新增 | TL2-05 |
| T34 | `timeline/lib/__tests__/duplicateClips.test.ts` | 新增 | TL2-22 |
| T35 | `src/components/video/lib/__tests__/probeMediaDuration.test.ts` | 新增 | ME-11 |
| T36 | `timeline/__tests__/materialDrop.unknownDuration.test.ts` | 新增 | ME-11 |
| T37 | `timeline/store/actions/__tests__/trackActions.viewFlags.test.ts` | 新增 | ME-12 |
| T38 | `timeline/__tests__/Track.muteButton.test.tsx` | 新增 | ME-12 |
| T39 | `agent/__tests__/trackPatch.viewFlags.test.ts` | 新增 | ME-12 |
| T40 | `timeline/__tests__/TimelineItem.missingMaterial.test.tsx` | 新增 | N-01 |
| T41 | `timeline/domain/__tests__/dragHitZones.singleSource.test.ts` | 新增 | N-17 |
| T96 | `timeline/store/actions/__tests__/replaceTimeline.viewFlags.test.ts` | 新增 | ME-12（RV3-05） |

**前端 · 时间轴交互与共享 UI（T42–T67）**

| # | 文件 | 类型 | 关联 |
|---|---|---|---|
| T42 | `timeline/lib/__tests__/mouseGesture.test.ts` | 新增 | UI3-06 |
| T43 | `timeline/lib/__tests__/zoomAnchor.test.ts` | 新增 | TL2-07 |
| T44 | `timeline/hooks/__tests__/useTimelineWheel.test.ts` | 新增 | TL2-07 |
| T45 | `timeline/__tests__/TrackContainer.deselect.test.ts` | 新增 | TL2-08 |
| T46 | `timeline/__tests__/VolumeSlider.gesture.test.ts` | 新增 | TL2-10 |
| T47 | `timeline/lib/__tests__/sentenceWindow.test.ts` | 新增 | TL2-11 |
| T48 | `timeline/__tests__/TimelineRuler.scrub.test.ts` | 新增 | TL2-12 |
| T49 | `timeline/__tests__/TimelineToolbar.toolState.test.ts` | 新增 | TL2-12 |
| T50 | `timeline/__tests__/shortcutOwnership.test.ts` | 修改 | TL2-13、UI3-11、UI3-13 |
| T51 | `src/styles/__tests__/themeTokens.test.ts` | 新增 | TL2-14、UI3-09 |
| T52 | `timeline/lib/__tests__/followPlayhead.test.ts` | 新增 | TL2-24 |
| T53 | `timeline/hooks/__tests__/useFollowPlayhead.test.ts` | 新增 | TL2-24 |
| T54 | `vpp/__tests__/playStateMirror.test.ts` | 新增 | UI3-12 |
| T55 | `timeline/__tests__/TimelinePanel.dragScroll.test.ts` | 新增 | TL2-24 |
| T56 | `vpp/__tests__/ImageOverlay.keyboardNudge.test.ts` | 新增 | N-02 |
| T57 | `timeline/__tests__/TimelinePanel.modalPortal.test.ts` | 新增 | N-12 |
| T58 | `timeline/__tests__/TrackContainer.portalEvents.test.ts` | 新增 | UI3-01 |
| T59 | `timeline/__tests__/VolumeSlider.focusReturn.test.ts` | 新增 | UI3-02 |
| T60 | `timeline/__tests__/TimelineItem.nestedControls.test.ts` | 新增 | UI3-03 |
| T61 | `timeline/__tests__/TimelineItem.inlineSubtitleEdit.test.ts` | 新增 | UI3-04 |
| T62 | `timeline/__tests__/TimelineToolbar.tooltip.test.ts` | 新增 | UI3-05 |
| T63 | `src/components/ui/__tests__/Modal.focus.test.ts` | 新增 | UI3-07 |
| T64 | `src/components/video/components/CameraMotionModal/__tests__/CameraMotionModal.discard.test.tsx` | 新增 | UI3-07 |
| T65 | `src/components/ui/__tests__/ConfirmationDialog.focus.test.tsx` | 修改 | UI3-08 |
| T66 | `timeline/__tests__/Track.stickyHeader.test.ts`、`timeline/lib/__tests__/clipVisibility.test.ts` | 新增 | UI3-10 |
| T67 | `timeline/__tests__/TimelinePanel.region.test.ts` | 新增 | UI3-14 |

**前端 · 剪辑 Agent（T68–T84）**

| # | 文件 | 类型 | 关联 |
|---|---|---|---|
| T68 | `agent/__tests__/sseStreamManager.parse.test.ts` | 新增 | AG3-01 |
| T69 | `agent/__tests__/agentEventRouter.cancelled.test.ts` | 新增 | AG3-02 |
| T70 | `agent/__tests__/chatRoute.timeoutOrder.test.ts` | 新增 | AG3-02 |
| T71 | `agent/__tests__/agent.providerError.test.ts` | 新增 | AG3-03 |
| T72 | `hooks/__tests__/useAgentExecution.ordering.test.ts` | 修改 | AG3-04、AG3-05、N-21、AG2-04、AG2-05、AG2-13 |
| T73 | `src/components/video/components/VideoChatWindow/timeline/__tests__/TimelineChatPanel.errorCard.test.tsx` | 新增 | AG3-04 |
| T74 | `agent/__tests__/agentEventRouter.applyOutcome.test.ts` | 修改 | AG3-06 |
| T75 | `src/components/video/components/VideoChatWindow/timeline/__tests__/AgentResponseNode.undoMenu.test.tsx` | 新增 | AG3-06、AG2-20 |
| T76 | `agent/__tests__/getTimeline.fields.test.ts` | 新增 | AG2-03 |
| T77 | `agent/__tests__/defaultTimeline.test.ts` | 新增 | AG2-04 |
| T78 | `agent/__tests__/historyBudget.test.ts` | 新增 | AG2-13 |
| T79 | `src/components/video/components/VideoChatWindow/timeline/__tests__/utils.toolOnlyTurn.test.ts` | 新增 | AG2-17 |
| T80 | `agent/__tests__/editingTools.guards.test.ts` | 修改 | AG2-18、N-10 |
| T81 | `agent/__tests__/agentTimeline.noHardcodedText.test.ts` | 新增 | AG2-20 |
| T82 | `agent/__tests__/sseStreamManager.timeout.test.ts` | 新增 | AG2-21 |
| T83 | `agent/__tests__/reconcile.test.ts`、`agent/__tests__/operationApplier.undo.test.ts` | 修改 | N-10 |
| T84 | `agent/__tests__/serializeMaterial.test.ts` | 新增 | N-19 |

**前端 · AI 混剪与数据安全（T85–T95）**

| # | 文件 | 类型 | 关联 |
|---|---|---|---|
| T85 | `src/components/video/projects/__tests__/repairTimelineData.test.ts` | 修改 | DS3-01、N-07 |
| T86 | `src/components/video/projects/__tests__/hydrateTimeline.repair.test.ts` | 修改 | DS3-01 |
| T87 | `hooks/__tests__/useMaterialManagement.storeSync.test.tsx` | 新增 | DS3-02 |
| T88 | `hooks/__tests__/useMaterialManagement.deleteInUse.test.tsx` | 修改 | DS3-03、N-08 |
| T89 | `src/components/video/lib/__tests__/clipCutResults.test.ts` | 新增 | DS3-04、N-13 |
| T90 | `src/components/video/lib/aiMix/__tests__/planScriptAutoMix.test.ts` | 修改 | AM3-01、N-13 |
| T91 | `hooks/__tests__/useScriptAutoMix.test.tsx` | 修改 | AM3-01 |
| T92 | `hooks/__tests__/useAIMixedEditing.test.tsx` | 修改 | AM3-02 |
| T93 | `src/lib/api/server/__tests__/backend-proxy.clientAbort.test.ts` | 新增 | AM2-04 |
| T94 | `src/components/video/projects/__tests__/VideoEditorContainer.recoveryBackup.test.ts` | 新增 | N-07 |
| T95 | `src/components/video/lib/__tests__/derivedMaterial.test.ts` | 修改 | N-13 |

测试文件不存在而标为「修改」时，实现节点直接新建同名文件并在实施记录中说明。

**后端（BT1–BT17）**

| # | 文件 | 类型 | 关联 |
|---|---|---|---|
| BT1 | `tests/test_media_probe.py` | 新增 | EX3-01 |
| BT2 | `tests/test_export_canvas_ffmpeg.py` | 修改 | EX3-01、EX3-02、N-04 |
| BT3 | `tests/test_video_composition_timeline.py` | 修改 | EX3-02、EX3-03 |
| BT4 | `tests/test_filtergraph_builder_runs.py` | 新增 | N-04 |
| BT5 | `tests/test_composition_degradations.py` | 修改 | N-04、EX3-04、EXO-07 |
| BT6 | `tests/test_audio_mix.py` | 修改 | EX3-04 |
| BT7 | `tests/test_image_overlay_export.py` | 修改 | EX3-05 |
| BT8 | `tests/test_composition_failure_cleanup.py` | 修改 | EX3-06 |
| BT9 | `tests/test_video_router_status.py` | 修改 | EXO-07 |
| BT10 | `tests/test_video_router_cancel.py` | 新增 | EXO-07 |
| BT11 | `tests/test_video_composition.py`、`tests/test_video_composition_enhanced.py`、`tests/test_audio_transcription_service.py`、`tests/test_video_composition_timeline_order.py`（修改）；`tests/test_video_composition_pexels_retry.py`、`tests/test_pexels_functionality.py`（删除） | 修改 / 删除 | N-11（RV3-03） |
| BT12 | `tests/test_video_composition_local_refs.py` | 新增 | N-14 |
| BT13 | `tests/test_subtitle_export_style.py` | 修改 | N-15 |
| BT14 | `tests/test_portrait_subtitle_centering.py`（重写）、`tests/test_subtitle_add.py`（删除）、`tests/test_add_subtitles_service.py`（新增） | 修改 / 删除 / 新增 | N-16 |
| BT15 | `tests/test_subtitle_layout_golden.py`、`tests/fixtures/subtitle_layout_golden.json` | 新增 | EXO-09 |
| BT16 | `tests/test_client_disconnect.py` | 新增 | AM2-04 |
| BT17 | `tests/test_removed_routes.py`（新增）、`tests/test_timeline_validation_fix.py`（删除） | 新增 / 删除 | BL-14 |
| BT18 | `tests/test_composition_progress_activity.py` | 新增 | EXO-07（RV3-02、RV3-13） |

### 7.2 验收门禁（实现节点必须实际运行并记录输出）

| # | 命令 / 检查 | 通过标准 |
|---|---|---|
| A1 | `npm run type-check` | 0 error |
| A2 | `npm run lint` | error 集合与基线 `e06dca4` 一致（6 条，均在未触及文件）；新增 / 修改文件 0 error。单文件检查须 `ESLINT_USE_FLAT_CONFIG=false npx eslint <files>` |
| A3 | `npx vitest run` 指定 T1–T96 全部文件，外加受影响套件 `src/components/video/timeline`、`src/lib/video-editing-agent`、`src/components/video/hooks`、`src/components/video/playback`、`src/components/video/components/VideoPlayerPanel`、`src/components/video/projects`、`src/components/ui`、`src/lib/api` | 全部通过 |
| A4 | `npx vitest run` 全量 | 0 失败（基线 277 文件 / 2318 用例）；用例数不减少，删除的用例（N-17 死代码测试等）须在实施记录中逐条列出 |
| A5 | 后端（`backend-services/basic-service`，**须在可导入 `cv2` 的环境**，本机方法见第 2 轮 IM2-05）：`python -m pytest tests/ -q` 全量，并单列 BT1–BT18 与第 2 轮门禁 21 个文件的结果 | 第 2 轮门禁文件与 BT1–BT18 **0 失败**（N-11 / N-16 清零）；ffmpeg 真实用例实际运行（记录 skip 数为 0 或列出 skip 原因）；全量结果与基线对比无新增失败 |
| A6 | `node desktop/main/closeGuard.test.js` 与 `node desktop/main/window-state.test.js` | 均通过（本轮不改桌面主进程，作为回归） |
| A7 | `npm run build` | Compiled successfully |
| A8 | `git status --porcelain -uall` | 仅含 §4 与 §7.1 所列文件；无 `__pycache__`、`*.pyc`、`tsconfig.tsbuildinfo`、`.next/`、`.pytest_cache`、`src/__r3probe_*`、ffmpeg 探针输出 |
| A9 | 第 2 轮 A17：`grep -rnE "(getState\(\)\|state)\.(importFromData\|autoOrganize\|initTimeline\|removeItem\|moveItem\|resizeItem\|addItemToTrack\|splitItemAtTime\|detachAudio\|swapItems\|removeTrack\|setTrackVolume\|toggleTrack\w*\|updateItem\w*)\(" src --include=*.ts --include=*.tsx`（排除 `timeline/store/` 与 `__tests__`） | 允许名单不扩大：`TimelinePanel.tsx` 挂载 `initTimeline`；复制逻辑移入 `timeline/lib/duplicateClips.ts` 后，其调用点仍在锁检查之后（名单同步更新为该处）；整理；`projects/hydrateTimeline.ts` |
| A10 | `grep -rn "clearHistory()" src/components/video --include=*.ts --include=*.tsx`（非测试文件） | 与第 2 轮 A13 一致，不新增 |
| A11 | `grep -rnI "ai_video_generate\|AIVideoGenerate\|validate_simplified_timeline" backend-services/basic-service/app backend-services/basic-service/tests src CLAUDE.md`（`-I` 跳过本地陈旧的 `__pycache__/*.pyc`；v2 评审 RV3-04） | 0 命中 |
| A12 | `grep -rnI "_download_video\(_with_retry\|_with_ffmpeg\)\?\b\|_download_pexels_video_with_retry\|_load_video_download_config\|video_download_config" backend-services/basic-service/app backend-services/basic-service/tests`（GNU BRE；`\b` 排除在用的 `_download_video_if_needed`——v1 的子串写法在基线命中 51 行，永远无法为 0；v2 评审 RV3-04） | 0 命中 |
| A13 | `grep -n "shutil.copy2" backend-services/basic-service/app/services/video_composition_service.py` | 0 命中 |
| A14 | `grep -rn "onWheel=" src/components/video/timeline` | 0 命中 |
| A15 | `grep -rn "Undo All\|Undo Single\|(undone)\|'Executing'\|'Executed'\|Executing:" src/components/video/components/VideoChatWindow/timeline --include=*.ts --include=*.tsx --exclude-dir=__tests__`（v1 的正则带引号，漏掉 `AgentResponseNode.tsx:124,160` 的 JSX 文本节点；v2 评审 RV3-18） | 命中行只允许是注释（以 `*`、`//`、`{/*` 开头），逐条列出 |
| A16 | `grep -rn "window.confirm" src/components/video/components/CameraMotionModal` | 0 命中（范围外的 `AiImageModal/StoryboardTab.tsx:227` 记入附录 A「评审补充」UI3-07b；v2 评审 RV3-04） |
| A17 | `grep -n "z-\[200\]\|'确认'" src/components/ui/ConfirmationDialog.tsx` 与 `grep -n "z-50" src/components/ui/Modal.tsx` | 均 0 命中（后者见 v2 评审 RV3-15） |
| A18 | `grep -rn "measureSubtitle\|positionToVAnchor\|wrapText(" src/components/video` | 0 命中 |
| A19 | `grep -n "maxAttempts" src/lib/api/videoComposition.ts` | 0 命中 |
| A20 | 控制字符扫描：`python -c` 遍历 `git ls-files src backend-services/basic-service/app` 的文本文件，统计 `\x00-\x08\x0B\x0C\x0E-\x1F` 字节 | 0 个文件含控制字节（EX3-07） |
| A21 | `grep -rn "hsl(var(--" src` | 0 命中（UI3-09） |

### 7.3 桌面端走查（`cd desktop && npm run dev`，逐条勾选并在实施记录中写明结果）

**第一部分**：第 2 轮 §7.3 第 1～23 条（`docs/plans/ai-and-manual-editing-reliability-r2/spec.md`）逐条执行——第 2 轮未执行（C-7），本轮必须补齐，结果记入本轮实施记录。

**第二部分（本轮）**：

1. 9:16 项目放入 16:9 视频 → 预览上下黑边、不拉伸；16:9 项目放入手机竖拍（带旋转元数据）视频 → 预览与导出均为居中竖条、不压扁（PV3-01 / EX3-01）。
2. 图片（不透明度 50%、静态运镜推近）+ 默认底部字幕 → 预览中字幕在图片之上、图片半透明且有运镜动画；导出一致；暂停状态下新加图片加载完成即出现（PV3-02）。
3. 播放中把预览音量拖到 0、点击静音 → 立即无声；恢复后有声；导出成片音量不受影响（PV3-03）。
4. 某本地素材轨音量 200% → 预览明显更响、音画无可感知偏移；远程未缓存素材轨设 200% → 出现一次「预览中听不出超过 100%」提示（ME-06）。
5. 锁定图片轨 → 其图片显示只读虚线边框、无法拖动；未锁定图片拖动中让 Agent 开始执行 → 叠加层消失，图片回到原位并提示「Agent 正在编辑时间轴」（PV3-04 / N-18）。
6. 9:16 与 16:9 项目各放 5 种位置字幕（其中一条 40 字中文、一条日文、一条含空行）→ 预览中位置比例、字号比例、换行与导出逐一吻合（垂直允许约 0.1 em 差异）（EXO-09 / N-15）。
7. 视频 0–10 s + 隐藏轨条目 10–20 s → 标尺拖到 15 → 播放头回到 10、显示最后一帧、进度 100%（N-06）。
8. 导入含 300 个 0.5 s 片段的时间轴 → 导出成功；任务管理器中 ffmpeg 峰值内存 < 2 GB（N-04 / EX3-04）。
9. 一个大视频切 20 段全部上轨 → 导出期间 `%TEMP%\video_compose_*` 中不出现源文件副本（EX3-03）。
10. 导入 MediaRecorder 录制的 WebM → 可预览、可导出（EX3-02）。
11. 同时开始 3 个导出 → 第 3 个弹窗显示「正在等待其他导出完成」且不超时；进度在处理片段阶段持续前进；点「取消导出」→ 弹窗关闭并提示「已取消导出」，数秒内状态为 cancelled、临时目录被删除；排队中的第 3 个导出取消后立即结束、不等空闲槽（EXO-07 / RV3-13）。另导出一条 ≥ 12 分钟的多轨 1080p 时间轴 → 画布合成阶段进度条持续前进，超过 10 分钟不报超时，成片下载成功（RV3-02）。
12. 导出中切换到另一个任务再切回 → 进度弹窗恢复、导出按钮不可再点；DevTools 拦截下载请求 → 提示「导出完成但下载失败」，不出现成功对勾（EXO-14）。
13. 中文界面让导出因素材不在本地而失败 → 提示「1 个片段的素材不在本地：xxx」，无英文原文（EX3-08）。
14. 视频轨 A[0,2] B[2,4] C[4,14]：把 C 拖到最前 → 松手后 C 在最前；删除任一片段后撤销（可重做），把 B 右拖一点点松手（被弹回）→ 重做仍可用；整齐时间轴上点「整理素材」→ 提示「素材已经排列整齐」（TL3-01 / TL3-02）。
15. 字幕左边缘向前拖 → 可延长；把一条字幕裁剪越过下一条 → 停在下一条起点；拖到另一条字幕上 → 落到最近空隙或保持原位（TL3-03 / TL3-04）。
16. 隐藏某视频轨，剪切工具点击其片段 → 切分成功（TL3-05）。
17. 撤销一次删除（可重做）→ 锁定任一轨道 → 重做仍可用；撤销后轨道锁定状态不变；音频轨头静音按钮可切换并在预览中静音；让 Agent 执行一轮后静音音乐轨并锁定视频轨，再「撤销本轮」→ 本轮修改被撤销，音乐轨仍静音、视频轨仍锁定，导出不含音乐（ME-12 / RV3-05）。
18. 删除在用素材后 Ctrl+Z 恢复片段 → 片段显示红色「!」与「素材已删除」提示（N-01）；拖入无时长信息的 ARK 视频 → 以真实时长上轨（ME-11）。
19. 在 40 s 处 Ctrl+滚轮缩放 → 光标下时间不变、页面不缩放；触控板捏合平滑；点击轨道空白处取消选择；音量拖动中按 Esc → 音量恢复且无撤销记录；关闭音量浮层后焦点回到音量按钮；在音量浮层上拖动不平移时间轴（TL2-07 / TL2-08 / TL2-10 / UI3-01 / UI3-02）。
20. Tab 到工具栏按钮按空格 → 激活按钮而不播放；鼠标点击片段后按空格 → 播放；按住空格 → 只切换一次；拖拽片段中按 Esc → 只取消拖拽、选区保留（TL2-13 / UI3-11 / UI3-13）。
21. 播放长时间轴 → 视图随播放头翻页、标尺显示「播放中」；播放中滚动 → 停止跟随直到下次播放；横向滚动后轨道头保持可见；Tab 聚焦工具栏按钮有可见焦点环，悬停显示提示且无重复原生提示；时间轴滚动条滑块可见（TL2-24 / UI3-12 / UI3-10 / UI3-05 / TL2-14 / UI3-09）。
22. 打开字幕编辑弹窗后让 Agent 执行 → 弹窗可取消 / 关闭、保存置灰、遮罩不可点穿；编辑已有运镜时在强度输入框连续输入数字不丢键；放弃修改出现应用内确认框；字幕替换确认框与运镜弹窗都在 Agent 浮窗之上（N-12 / UI3-07 / UI3-08 / RV3-15）。
23. Tab 聚焦图片叠加 → 方向键移动 1%、Shift+方向键 10%，停顿后 Ctrl+Z 一步撤销；切分后的右半片段句子条从 0% 开始显示（N-02 / TL2-11）。
24. 在设置中填入无效 API Key 后向 Agent 发消息 → 显示「模型服务拒绝了 API Key」；与 Agent 连续对话 40 轮仍可继续；中文界面 Agent 卡片与撤销菜单全部为中文，撤销菜单可用方向键 / Esc 操作、同名步骤带序号、无操作步骤不列出（AG3-03 / AG2-13 / AG2-20 / AG3-06）。
25. Agent 一轮只调用工具即被停止 → 仍显示「撤销本轮」；对前一轮的步骤单步撤销成功；终态错误卡片只提供「关闭」（AG2-17 / AG2-05 / AG3-04）。
26. DevTools 网络限速（Slow 3G）执行含 `get_timeline` 与多次添加的任务 → 客户端时间轴与 Agent 回复中的位置一致、无卡在「执行中」的步骤（AG3-01）。
27. 关闭应用，用 SQLite 工具在某项目中构造「一个片段 `startTime=-3` + 一张 `clipStart=0, clipEnd=0` 的图片（模拟旧版本 Agent 写入的存量数据，RV3-01）」→ 打开项目：图片保留、提示已修复；再把某轨道 `items` 改为字符串 `"broken"` → 打开后顶部出现「恢复备份的时间轴」，恢复成功且 Ctrl+Z 可撤销，「丢弃备份」后提示条消失（DS3-01 / N-07）。
28. 素材库删除素材 M → 让 Agent 添加另一个素材 → M 不再出现；「清空全部素材」（有在用片段）→ 确认框写明片段数 → 确认后 Ctrl+Z 恢复片段（DS3-02 / DS3-03）。
29. 切段 3 段并让中间一段失败（区间设在源时长之外）→ 其余两段文件与名称一一对应、失败段被移除并提示「3 个切片中有 1 个切分失败」（DS3-04）；切段结果不影响「AI自动混剪」对原片的使用（N-13）。
30. AI 混剪分析阶段点「取消」→ 后端日志出现「cancelled by the client」，之后不再有 LLM 修复轮与导入请求（AM2-04）；导入阶段停掉后端 → 提示「无法连接本地服务」而非「方案无法应用」（AM3-02）。

---

## 8. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | EXO-09 之后预览字幕按成片像素缩放，明显比现在小 | 用户以为字幕「变小了」 | 与导出完全一致才是正确结果；走查第 6 条逐位置比对；字幕编辑弹窗的样式色块不变 |
| R2 | PV3-02 DOM 图片透明后，暂停状态下新图片加载完成前看不到图片 | 短暂空白 | `onAssetReady` 触发单帧重绘（T4）；`crossOrigin` 失败去掉后重试 |
| R3 | ME-06 WebAudio 路由：跨源来源路由后输出静音、挂起的 AudioContext 静音、元素只能路由一次、路由带来 10–40 ms 延迟 | 预览无声或音画不同步 | 仅同源来源、仅 `running` 才路由；路由元素遇跨源地址先回收；`previewVolumeBoost` 默认开启、可一键关闭；走查第 4 条测音画偏移，可感知时改为「有增益时同宿主全部元素路由」 |
| R4 | PV3-01 改变视频绘制矩形，影响运镜 2D / 3D 路径 | 预览运镜位置变化 | 运镜在 `content` 矩形上绘制，与导出「缩放 → 运镜 → 补边」一致；第 2 轮运镜既有用例必须保持通过（A3） |
| R5 | N-04 连续段 copy 合并在编码参数不一致时失败 | 导出失败 | 归一化片段编码参数一致；`_concat_videos` 失败回退重编码并抛 `CompositionStageError`；真实 ffmpeg 帧数用例（BT2） |
| R6 | EX3-04 分块混音与单次合流数值不同 | 音量差异 / 提前削波 | `amix normalize=0` 线性求和且全部补齐到终点；块文件为 `pcm_f32le`，块内求和不削波（RV3-14）；BT5 比较分块与单次结果样本（含求和超过 0 dBFS 的样本）；≤64 输入时命令完全不变 |
| R7 | EX3-01 / EX3-02 依赖 ffprobe | 无 ffprobe 的环境尺寸探测失败 | 返回 `None` 时回退 cv2（旧行为）；实现节点确认 `desktop/scripts/preflight.js` 下载的 ffmpeg 发行包包含 `ffprobe.exe` 并记录 |
| R8 | EXO-07 协作式取消不终止正在运行的 ffmpeg | 取消后当前阶段仍占用 CPU 至结束 | 弹窗立即关闭、下一检查点停止并清理；真正终止列入附录 A；文案只说「已取消导出」 |
| R9 | EX3-06 TTL 清理删掉用户尚未下载的成片 | 下载 404 | 仅清理已终态且超过 1 小时的项；客户端在完成后立即下载；「最近完成的仍可下载」用例（BT8） |
| R10 | EX3-06 输出目录迁移到 `STORAGE_ROOT` | 旧成片留在安装目录 | 旧文件不迁移不删除（无引用、无害）；下载路由只读新目录；升级后无进行中的合成 |
| R11 | S12 撤回记录与 `MAX_HISTORY` 截断交互出错 | 撤销栈错乱 | `head / tail` 完整复原；T26「discarding restores the entry trimmed by MAX_HISTORY」 |
| R12 | ME-12 标志不入历史后 Agent 补丁冲突检测把用户的锁定 / 静音切换判为冲突 | 无法撤销 Agent 轮次 | T39 钉住；失败时冲突比较忽略三个标志（F48） |
| R13 | TL3-01 磁性插入改为「中点规则」 | 拖拽结果与旧版本不同 | 与主流 NLE 一致；等长片段交换保持；序号不变不写历史；T24 / T25 |
| R14 | TL3-04 字幕钳制改变手动拖动行为 | 用户无法把字幕叠在一起 | 叠放字幕在预览与导出中本就互相遮挡；只约束手动编辑，不修复存量重叠 |
| R15 | TL2-13 输入模态判断错误导致空格不播放 | 播放快捷键失灵 | 只有「键盘模态 + 焦点在交互控件上」才让出；任意 pointerdown 立即恢复 pointer；T50 三例 |
| R16 | N-12 portal 改变事件冒泡路径 | 弹窗内事件触发 TimelinePanel 祖先处理 | VEI 中 TimelinePanel 祖先无 React 事件处理（已核对 VEI 2080-2300）；T57 |
| R17 | UI3-07 修改共享 `Modal` 影响 6 个使用方 | 其他弹窗焦点行为变化 | 仅移除「onClose 变化导致的重聚焦」，严格改进；T63 |
| R18 | AG2-13 历史压缩让模型丢失早期上下文 | 回复质量下降 | 最近 2 轮原样；旧快照替换为「请重新调用」的提示；丢弃整轮时插入系统说明 |
| R19 | N-10 Agent 删除后立即贴紧，改变模型对位置的预期 | 后续工具按旧位置操作 | 工具描述说明 + `shiftedClips` 回报；与手动删除一致（D-19）；客户端与服务端同一函数 |
| R20 | AG3-03 把服务错误原文展示给用户，可能含敏感信息 | 泄露 key | 截断 300 字符并去除 `sk-…` / `Bearer …` 形态；T71「provider error details never contain an API key」 |
| R21 | DS3-01 放宽修复规则后导入仍抛错 | 项目打不开 | 逐条试构造，抛错才删除并写备份；仍失败走既有 `failed` 路径 |
| R22 | DS3-02 合并守卫阻止同 id 素材被再次合并 | Agent 以相同 id 重新添加的素材不显示 | Agent 新增素材使用新 id；被阻止的合并记录 `console.warn` 便于诊断 |
| R23 | AM2-04 取消在服务商侧已生成的 token 仍计费 | 费用 | 在模块注释与本节写明；保证停止的是修复轮、剩余 VLM 调用与导入 |
| R24 | BL-14 删除路由 | 外部脚本调用失败 | 单用户桌面应用、全仓零调用方；BT17 钉住路由已移除 |
| R25 | TL2-14 `color-mix()` 兼容性 | 旧内核不显示着色 | Electron 33（Chromium 130）支持 `color-mix`（Chromium 111+）；浏览器调试路径同样支持 |
| R26 | i18n 三处同步易漏（本轮约 85 个 key） | 类型错误或缺文案 | 先改接口类型，A1 强制 en / zh-CN 补齐；A15 检查 Agent 界面硬编码 |
| R27 | 规模：87 项，约 100 个前端文件、13 个后端文件 | 实施周期长、半成品风险 | §9 分组与优先级；每组独立门禁；受阻时按 I-2 取舍，整条移入附录 A 并同步 §1 / §2 计数 |
| R28 | DS3-01 修复之前已被误删、又被自动保存的条目无法找回（v2 评审 RV3-23） | 用户以为升级后能找回 | 修复只能防止此后的丢失，发布说明写明；打开项目出现「已修复」提示时照常告知被钳制 / 删除的条目数（`VideoEditorContainer.tsx:128`）；此后发生删除时写备份，并提供 N-07 恢复入口 |
| R29 | RV3-02 的 `-progress` 进度文件与状态读取 | 额外 I/O；精确匹配 ffmpeg 命令的既有用例需要更新 | 每个命令一个几 KB 的文件，约 0.5 s 刷新一次；状态读取只读尾部 ≤ 4 KB；命令断言改为「包含 `-progress`」；进度文件随临时目录删除 |

---

## 9. 实施顺序与提交分组

实现节点按下列顺序推进，每组完成后运行该组测试与 A1 再进入下一组；最终由提交节点统一提交（暂存时逐文件 `git add <path>`，禁止 `git add -A`；提交信息前缀按提交节点的任务定义，与前两轮一致使用 `feat:`）。

| 组 | 内容 | 文件 | 测试 |
|---|---|---|---|
| G1 数据安全 | DS3-01、DS3-02、DS3-03、DS3-04、N-13、N-07、N-08 | F63（切段部分）、F86–F93、F99（对应 key） | T85–T90、T94、T95 |
| G2 Agent 事件流（S14） | AG3-01、AG3-02、AG3-03、AG3-05、N-21、AG3-04、AG2-21、AG2-13 | F71–F76、F80、F83（对应部分）、F84（错误卡片） | T68–T73、T78、T82 |
| G3 预览一致（S11 / S13） | PV3-01、PV3-02、PV3-03、PV3-04、N-18、EXO-09、N-06 | F1–F9、F11–F19、F63（图片提交部分） | T1–T13、T16、T17、BT15 |
| G4 导出流程（S15） | EX3-01～EX3-08、N-04、N-14、EXO-07、EXO-14、N-11、N-15、N-16 | F21–F27、B1–B7、B13 | T18–T23、BT1–BT14 |
| G5 时间轴核心（S12） | TL3-01～TL3-06、TL2-05、TL2-22、ME-11、ME-12、N-01、N-17 | F28–F48、F49–F52（对应部分） | T24–T41 |
| G6 AI 混剪与清理 | AM2-04、AM3-01、AM3-02、BL-14 | F94–F98、B8–B12、D1、D2 | T91–T93、BT16、BT17 |
| G7 Agent 完整性 | AG3-06、AG2-03、AG2-04、AG2-05、AG2-17、AG2-18、AG2-20、N-10、N-19 | F72（默认时间轴）、F77–F85 其余部分、F82 | T74–T77、T79–T81、T83、T84 |
| G8 时间轴交互（S16） | UI3-01～UI3-14、TL2-07、TL2-08、TL2-10、TL2-11、TL2-12、TL2-13、TL2-14、TL2-24、N-02、N-12 | F49–F70 其余部分、F15（键盘微调）、F17 | T42–T67 |
| G9 高风险预览音频 | ME-06 | F3（applyVolume）、F7–F11、F20 | T7、T14、T15 |
| G10 全量门禁 | §7.2 A1–A21 + §7.3 走查（第一部分 1–23 + 第二部分 1–30） | — | — |

依赖说明：G1 先于 G7（`clipCutResults` 与 VEI 切段改动先落地，避免 VEI 冲突）；G2 先于 G7（`useAgentExecution` 的封口 / 退役逻辑先完成再加按消息 id 的 applier 映射）；G3 先于 G9（S11 的 `MultiTrackAttachDeps` 形状先定）；
G3 的 `subtitleLayout` 黄金 JSON（BT15）先于 G4 的 N-15 字体 / 换行改动（N-15 同步追加假名样本）；G5 的 `trackActions.ts` 先于 G8 的 `revertTrackVolumePreviewAction`；G5 的 S12 先于 G8 的 TL2-10（取消的手势依赖「无变化不入历史」）。

**v2 评审修订的归组**：RV3-01、RV3-19 → G1；RV3-09、RV3-10 → G2；RV3-08、RV3-11 → G3；RV3-02、RV3-03、RV3-07、RV3-12、RV3-13、RV3-14、RV3-22 → G4（B14、BT18 随 G4）；RV3-05（F35、F48、F100、T96）、RV3-21 → G5（F48 的冲突比较与 G7 共用 `trackViewFlags.ts`，由 G5 先落地）；RV3-17 → G6；RV3-06、RV3-15 → G8；RV3-20 → G9；RV3-04、RV3-16、RV3-18 → G10 门禁与评审核对。

**实施约束**（实现节点与提交节点必须满足）：

| # | 约束 | 验证方式 |
|---|---|---|
| I-1 | 先写回归测试并确认在基线上失败，再改代码；每组完成后运行该组测试与 A1 | 实施记录列出每组「先红后绿」的用例名 |
| I-2 | 受阻时按 G1 → G2 → G3 → G4 → G5 → G6 → G7 → G8 → G9 优先级推进；任何一组不得半完成提交；无法完成的缺陷整条移入附录 A 并在「实施过程发现的方案缺陷」段写明原因，同时更新 §1 / §2 的范围数字与分组计数 | 提交内容与文档记录 |
| I-3 | S12（F32–F35）必须与 ME-12（F29 `restore`、F42、F43、F48、F100）同组落地：只做前者会让锁定切换在撤销（包括撤销 Agent 本轮，RV3-05）时仍被改回 | G5 提交内容 |
| I-4 | AG3-05 的退役写回与 N-21 的看门狗封口同时落地（同一段 `useAgentExecution` 代码） | G2 提交内容 |
| I-5 | 不新增 `clearHistory()`；新增文案「接口类型 / en / zh-CN」三处同步；不改数据库 schema、不引入启动期 DDL；源文件不得含控制字节（A20） | A1、A10、A20、`git diff --stat` |
| I-6 | A5 在可导入 `cv2` 的环境运行；ffmpeg 真实用例实际执行（未被 skip） | A5 输出记录 |
| I-7 | 遵守 CLAUDE.md 规模限制：`VideoEditingInterface.tsx`（2478 行）、`TimelinePanel.tsx`（1446 行）、`MaterialsPanel.tsx`（3071 行）、`video_composition_service.py`（2875 行）、`video_router.py`（1370 行，v2 评审 RV3-16 补入）、`subtitle_service.py`（1049 行）已超 1000 行；`CanvasCompositor.ts`（921 行）与 `useAgentExecution.ts`（808 行）若本轮改动后超过 1000 行，把字幕绘制抽到 `playback/internal/subtitleDraw.ts`、把轮次退役与请求剥离抽到 `hooks/agentTurnLifecycle.ts`；本轮新增逻辑一律进入新模块（F6、F10、F19、F23、F24、F28、F30、F34、F36、F45、F46、F57–F62、F73、F74、F86、B1、B8），这些文件只做连线；被改动的函数超过 60 行须拆分或附一行原因注释；参数超过 5 个改用选项对象 | 代码评审节点逐文件核对；`wc -l` 记录改动前后行数，超限文件不得净增超过 40 行（N-11 删除死代码后 `video_composition_service.py` 应净减少） |
| I-8 | 第 2 轮走查 1–23 与本轮走查 1–30 必须在桌面端实际执行并逐条记录；无法执行交互式 Electron 会话时，实施记录必须明确写「未执行」及原因，不得写「通过」 | 实施记录 |

若实现中发现本方案缺陷，记录到本文件末尾「实施过程发现的方案缺陷」段（由实现节点新增）。

---

## 附录 A：已证实、未纳入本轮的缺陷与子项（后续工作）

本轮是循环的最后一轮，以下条目不会有第 4 轮自动承接；每条给出延后理由与后续设计要点，供人工排期。

延后准则：改变产品模型、需要单独产品决策（TL2-01、N-03）；仅影响浏览器调试路径（N-05）；纯观感且不影响预览 / 导出正确性（N-09）；需要新基础设施或跨进程通道（EXO-07c、EXO-14b）；会整体改变既有界面观感、需要全应用视觉走查（TL2-14b）；极端规模（EX3-04b）。

| ID | 级别 | 内容 | 延后理由 | 后续设计要点 |
|---|---|---|---|---|
| TL2-01 | P1（当前不可达） | 分离音频被整轨贴紧导致与视频错位；新分离轨排在字幕轨之后；UI 无分离入口 | `detachAudioAction` 零调用、`Track.tsx:608-619` 未传 `onDetachAudio`，用户无法触发；完整修复是新功能（联动模型），牵涉 Agent、导出与持久化 | 双向 `linkedItemId`；`TrackData.layout: 'magnetic' \| 'anchored'`；organize 先贴紧视频道再令锚定道上关联片段 `startTime = partner.startTime`；删除 / 切分 / 裁剪联动、禁止跨轨移动关联音频、复制成对复制；右键菜单「分离音频 / 恢复原声」；排查稿测试名见 tl-core 报告（`detached audio stays aligned after an earlier clip is deleted` 等） |
| TL2-22b | P2 | 复制已分离音频的视频得到无声副本 | 依赖 TL2-01；现在剥离 `audioDetached` 会在同时复制视频与其音频时产生双份音频 | 随 TL2-01 成对复制并建立新链接 |
| N-03 | P2 | 图片轨（覆盖轨）自由定位：logo / 叠加图不能晚于该轨上一张图片出现 *[实测：图片右拖 10 s 松手回到 0]* | 推翻第 2 轮 D-1 / D-3 的磁性时间轴决策，需同步修改 Agent 客户端 / 服务端 reconcile、AI 混剪合并与后端 `_pack_lanes`、S8 不动点测试 | `TrackData.layout: 'free'`，`image-track-*` 默认 free；organize 跳过；free 道复用本轮 `FreeLaneRules`（TL3-04）；存量位置天然合法、无需迁移 |
| N-05 | P2 | 浏览器调试路径关闭标签页丢失 800 ms 内的编辑 | 产品只以 Electron 发布，浏览器路径仅用于调试（CLAUDE.md） | `useProjectAutosave` 在非桌面环境对 `beforeunload` 询问（`hasUnsavedEdits`：空闲定时器 / 在途保存 / 重试等待 / 内容与上次保存不同）；`pagehide` + `keepalive`（请求体 ≤ 60 KB）为可选 |
| N-09 | P2 | 去水印以同 id 替换素材后胶片带仍显示旧帧 | 预览与导出已按 `materialId` 解析新文件（本轮核实），只剩缩略图观感 | `filmstripCache` 以实时素材 `selectPlaybackUrl(material, { purpose: 'preview' })` 取地址，缓存键加 URL 指纹 `${materialId}::${hash(url)}::${tier}` |
| EXO-07c | P2 | 取消导出时终止正在运行的 ffmpeg 子进程 | 需替换 18 个 `subprocess.run` 调用点；`FakeFfmpeg` 测试桩按 `subprocess.run` 打补丁，全部降级 / 时间轴用例需重建接缝；Windows 进程终止语义 | `_run_ffmpeg(cmd, cancel_event)`：`Popen` + `communicate(timeout=0.5)` 循环 + `kill`；测试桩改为桩 `_run_ffmpeg` |
| EXO-14b | P2 | 成片下载以 Blob 整文件缓冲 | 需要新的 preload 下载桥（`webContents.downloadURL`），`desktop/preload/preload.js` 目前无下载通道 | 主进程 `will-download` 指定保存路径并回报进度；渲染进程经 IPC 发起 |
| EX3-04b | P2 | 预合并后画布输入仍超过 200（数百个带转场 / 半透明片段） | 极端规模；本轮以可读错误失败 | 以 64 输入为一层合成到无损中间文件（`libx264 -qp 0 ultrafast`），下一层以上一层结果为底图；PSNR > 50 dB 用例 |
| N-15b | P2 | 字幕中的 emoji 绘为方框 | 需按字形切分字体段；预览绘制彩色 emoji，导出单色，观感变化需决策 | drawtext 按字体可覆盖的码位分段、逐段 `fontfile`；或导出前把 emoji 光栅化为图片叠加 |
| TL2-14b | P2 | 主题色全局 `<alpha-value>`：581 处透明度修饰从未生效 | 全局修复会让 116 个文件中从未显示过的着色同时出现，需全应用视觉走查 | 把 `globals.css` 变量改为通道形式或统一 `color-mix` 别名，分批迁移并逐屏截图比对 |
| TL2-24b | P2 | 刮擦 / 拖拽片段到视口边缘时自动滚动 | 需要 RAF 循环与指针位置重派发，交互风险高，需单独走查 | `edgeScrollVelocity(clientX, laneLeft, laneRight, bandPx = 32, maxPxPerFrame = 18)` + RAF；标尺刮擦重派发 `setCurrentTime`、拖拽重派发 `POINTER_MOVE`；本轮已完成滚动补偿（前置条件） |
| N-12b | P2 | 共享 `Modal / ConfirmationDialog` 统一 portal 到 body | 全局修改影响所有弹窗的层级与事件路径 | 在两个共享组件内部 `createPortal`，逐个使用方核对焦点返回与嵌套确认框 |
| UI3-03b | P2 | 片段根节点 `role="button"` 内嵌交互按钮（ARIA 嵌套交互） | 需要重构片段 DOM 结构，影响拖拽热区与样式 | 片段根改为 `role="group"` + 独立的可聚焦标题按钮；徽标与重试按钮成为兄弟节点 |
| AG2-05b | P2 | 重新加载项目后单步撤销历史轮次 | 需持久化逐步补丁，与 AG2-13 的体积预算冲突 | 只持久化「轨道 id + 前后态哈希」并在撤销时从整轮补丁重算单步差异 |
| AG2-13b | P2 | 存储中的轮次补丁瘦身（去掉 `waveformData`、素材元数据） | 改变已存储的消息数据格式，旧消息兼容需设计 | 补丁写入时按白名单字段保留；读取旧补丁时容忍多余字段 |

**评审补充（v2）**：以下 2 条是评审节点在复核中发现的范围外事项，不计入本轮排查确认的 91 项，也不改变上文的延后计数。

| ID | 级别 | 内容 | 延后理由 | 后续设计要点 |
|---|---|---|---|---|
| UI3-07b | P2 | `AiImageModal/StoryboardTab.tsx:227` 仍使用原生阻塞、无主题的 `window.confirm`（与 UI3-07 同类） | 属于 AI 图片 / 分镜模块，不在本轮剪辑切片之内；A16 已限定范围（RV3-04） | 改用 `ConfirmationDialog`，做法同 UI3-07 的嵌套确认；之后把 A16 范围扩回 `src/components/video` |
| PV3-01b | P2 | `CanvasCompositor.drawFrame` 与 `_drawSubtitle` 单行字幕路径在生产代码中没有调用方，只被 `CanvasCompositor.test.ts`、`CanvasCompositor.metrics.test.ts`、`multiTrackCompositorS2Boundaries.test.ts` 与 `AbBufferController.test.ts` 的桩使用（RV3-11） | 删除需要把指标类用例迁移到 `renderFrame`，与本轮预览一致性修复无关 | 先迁移指标用例，再删除 `drawFrame`、`_drawSubtitle` 与 `types.ts:226` 的接口声明 |

**代码评审补充（RC3）**：以下是提交节点代码评审确认、但不在本轮修复的事项（不改变上文计数）。

| ID | 级别 | 内容 | 延后理由 | 后续设计要点 |
|---|---|---|---|---|
| ME-12b | P2 | 视频轨静音：预览（`renderableTimeline.isTrackRendered` 只对 `audio && isMuted` 生效，`VideoSourcePool` 无静音分支）与导出（`videoExportItems` 只取 `computeEffectiveVolume`）都不读 video 轨 `isMuted`，因此 RC3-04 把轨道头静音按钮收窄为只给音频轨 | 需同时修改预览池与导出条目两侧，并补齐一致性用例；§7.3 走查第 17 条本就只要求音频轨静音 | 预览 `buildVideoTrackGroups / VideoSourcePool` 按轨道 `isMuted` 把内嵌原声音量置 0，导出对 `isMuted` 的 video 轨条目 `volume: 0`（画面照常）；两侧用例通过后恢复 video 轨静音按钮 |
| N-07b | P2 | 水合时只要有一个轨道无法构造（如 `items` 不是数组），整条时间轴以空时间轴打开并写备份，需用户点「恢复备份的时间轴」才能找回其余轨道 | 与 N-07「用户主动恢复」设计一致（走查第 27 条），自动恢复改变打开项目的行为，需产品确认 | 水合失败时直接以 `salvageTimelineData` 打开可读轨道并提示丢弃了哪些轨道，备份照写、恢复入口保留 |
| AG2-20b | P2 | `AgentStateManager.markCancelled` 追加到消息正文的 `_[Stopped by user]_` 为英文标记（界面与模型历史都可见）；服务商未给错误文本时 `formatProviderError` 回退为英文句子并填入中文模板的 `{detail}` | 标记同时是模型侧历史语义，改动需同步 `messageConverter` 与既有持久化消息 | 以结构化字段 `isCancelled` 由界面本地化渲染，模型侧改为 `[System note]`；无原文时 `detail` 省略并使用不带详情的文案 |
| AG3-05b | P2 | 看门狗封口之后卡住的步骤迟到生效、且期间没有开始新一轮时，该步骤不进入「撤销本轮」的补丁；若它改的是同一条轨道，撤销本轮会提示冲突 | 触发需单步卡住超过 15 s 后又生效且用户未开始新一轮；实现注释已写明取舍 | 退役轮次的写入器在迟到的 `tool_result` 到达时把补丁追加回该消息，仍按消息 id 写回 |
| AG-legacy | P2 | `VideoChatWindow/AgentMessageBubble.tsx`、`AgentToolCallCard.tsx`（含英文「Parameters / Result」）与 `WelcomeGuide.tsx` 只被 `index.ts` 再导出、从不渲染 | 范围外旧组件，删除需确认无外部引用 | grep 确认零渲染后删除文件与 `index.ts` 导出 |
| EX3-02b | P2 | API 直调时请求 `clip_end=None` 且源时长未知，归一化以不可重试的「Invalid clipping parameters」失败；`_premerge_runs` 在 `MAX_CANVAS_INPUTS` 拒绝之前就先做 concat | 前端恒发送 `clip_end`（`videoExportItems.ts`），只有 API 直调可达；后者只在 > 200 输入的极端情况下浪费时间 | 未知时长且无 `clip_end` 时不带 `-t` 读到文件结束；输入上限检查前移到预合并之前 |

---

## 附录 B：已核查为正确的项（后续评审与实现无需重复）

- **预览 ⇄ 导出**：转场有效时长 `min(d, dur/2)`（`TransitionLayer.ts`）与 `_effective_transition_duration`（`filtergraph_builder.py:95-108`）一致，同轨 dissolve 两侧都是「经黑渐变」；
  不透明度两侧钳制，不透明度 0 的片段两侧都不绘制、其内嵌音频两侧都照常播放；字幕与图片两侧都是半开时间窗；分离音频的视频预览静音解码元素（`VideoSourcePool.ts:237`）、导出跳过提取（`video_composition_service.py:2076`）；
  视频轨 `isMuted` 两侧一致地忽略（无 UI）；预览终点与导出 `total_duration` 同源（`renderableTimeline`）；同 id 素材替换不继承原预览代理或本地 blob（`derivedMaterial.ts:32-36`）；输出帧矩形等于画布时图片坐标两侧一致。
- **导出流程**：cv2 可打开中文 / 非 ASCII 路径 *[实测]*；打包后端以 `-X utf8` 运行，子进程 stderr 解码与日志字形在产品中正常（GBK 问题仅开发环境）*[实测]*；分片 MP4（`frag_keyframe+empty_moov`）归一化正确 *[实测]*；
  `-/filter_complex` 脚本路径在 ffmpeg 7 下可用（14.9k 字符、241 输入的滤镜图 rc=0）*[实测]*；归一化片段经 concat demuxer copy 包级精确（3600/3600）*[实测]*；150 输入 amix 在命令行上限内混音正确 *[实测]*；
  临时目录与中间文件在成功与失败时均于 `finally` 删除（`:1776-1780`）；请求期本地 / 回环豁免与 `NonLocalMediaError` 保证视频 / 图片导出只用本地文件、不静默下载。
- **时间轴核心**：A17 允许名单成立——`timeline/store/` 之外的 slice 直接变更只有 `TimelinePanel.tsx`（挂载 `initTimeline`、复制、整理）与 `projects/hydrateTimeline.ts:67`，无 `useTimelineStore.setState` 与 `_aggregate` 外部访问；
  复制与整理在 `recordAction` 之前检查 `isEditLocked`；编辑锁或交互中拒绝撤销 / 重做；历史后态同步捕获、`restore` 保留缩放 / 滚动 / 播放头并钳制播放头、撤销 / 重做修剪选区并清理消失的 `editingSubtitleId`；
  `replaceTimelineAction` 先构造后记录、无变化跳过、取消进行中的拖拽、保留视图、修剪选区、仅 agent / agent-undo 豁免锁；拖拽状态机 `committed` 必跟 `COMMIT_COMPLETE`，Esc / 失焦 / pointercancel 回滚预览，甩动提交有预览，裁剪提交经 `resizeItemAction`，拖拽中消失的片段被跳过，编辑锁下拒绝 `startDrag`；
  交换在字幕轨与锁定轨上拒绝且先于记录检查，等长片段交换重排正确 *[实测]*；跨轨移动先校验锁与兼容性再变更；切分边缘 / 过近处理、内侧转场清除、单条 `SPLIT_ITEM`、跳过锁定轨；
  视频裁剪上下限在状态机与实体间一致，静态图两侧自由伸缩；`removeTrackAction` 保护最后一条轨道与组内最后一条；`addTrackAction` 分组插入与 `order` 重排与 `TrackContainer` 排序一致；`removeItemsAction` 先过滤锁定 / 不存在的 id 再记录；拖拽与 Agent 锁期间键盘删除 / 复制 / 撤销被阻止。
- **剪辑 Agent**：pi-ai 0.57 丢弃空文本块与空助手消息，并把工具调用 id 规范为 `[a-zA-Z0-9_-]{≤64}`（`providers/anthropic.js:533-577`），被停止的空轮次不会破坏下一次请求；
  客户端与服务端运行同一个 `validateOperationTargets` 与 `reconcileOverlapsAfterAgentOp`（epsilon 1e-6），`auto_fix_overlaps` 经 `applyRepack` 使用同一 `packOverlappingTracks`（RC2-24 修复在位）；
  N-20 不可达（分镜从不选择锁定轨，Agent 执行期间锁定切换被编辑锁阻止），关闭该项；`finishing` 期间所有停止控件已禁用或防护；外部写入 `agent / agent-undo` 通过锁、每次写入一条历史、畸形写入被捕获并回写所有者。
- **时间轴交互**：音量滑块的点击外部归属判定、键盘连续调整合并为一条历史、切换轨道时的待提交刷写；轨道拖放只对可接受 MIME 调用 `preventDefault`，锁定 / 不兼容轨道给出原因（`Track.tsx:136-177`）；
  标尺键盘刮擦修饰键与空时间轴守卫；`shortcutOwnership` 的模态 / `defaultPrevented` 门控、字母键重复与交互焦点守卫、有文本选区时的复制守卫；`ConfirmationDialog` 焦点返回、Tab 圈定、焦点在「取消」时 Enter 安全；
  `SubtitleEditModal` 遮罩按下与松开规则、放弃确认、Esc 阻止冒泡、初始焦点；`ImageOverlay` 指针捕获、`pointercancel` / Esc 回退、卸载时提交；片段拖拽在失焦 / `pointercancel` 时取消；编辑锁下剪切工具回退为选择；锁定字幕轨的行内编辑守卫；
  卸载后残留的标尺刮擦监听不会跳转 *[实测，TL2-12 子项不成立]*；标尺与轨道滚动范围保持对齐。
- **AI 混剪 / 自动混剪 / 数据安全**：切换项目不会把 A 的内容保存到 B（`Container.tsx:173-175` 以项目 id 为 key 重挂载，卸载刷写捕获项目 id、`saveLatestIfDirty` 校验）；
  `timelineRecoveryBackup` 作为顶层键在 VEI `...content` 展开与 `normaliseProjectDataForSave` 的 `...rest` 中保留（`src/lib/api/videoProjects.ts:250-263`）；关闭守卫退出中跳过、令牌匹配、渲染进程死亡不阻塞、渲染进程 2.5 s 预算小于主进程 3 s；
  素材删除接口对不存在的文件为无操作成功、上传键带 uuid 前缀不会误删其他项目的文件；批量解析结果按客户端发送的 `video_url` 存储、规划器以同一素材快照查找；`useConvertToScript / useVideoUnderstandingScript` 的 `metadata.video_analysis` 仅在请求内使用、不写回素材；
  Next 15.4.5 在客户端断开时中止 `req.signal`；切段失败 / 异常路径丢弃占位素材不弹确认、不删除任何源文件；自动混剪确认时重新规划、替换数量变化时重开确认框，过期配音哈希与 TTS 请求构造共用同一文本来源（`src/lib/api/tts.ts:192-228`）。

---

## 附录 C：设计决策记录

编号接续第 2 轮（D-1～D-14）。

| # | 决策 | 备选方案 | 理由 |
|---|---|---|---|
| D-15 | 字幕排版以导出为准，预览对齐导出（EXO-09） | 导出对齐预览；或两侧重写为同一渲染器 | 导出是成片且已有像素级用例与降级链路；改导出会改变所有已导出项目的观感；预览只是监看。黄金 JSON 保证两侧此后不再漂移 |
| D-16 | ME-06 的 WebAudio 增益只路由同源来源，并提供默认开启的 `previewVolumeBoost` 回退开关 | 所有元素设置 `crossOrigin` 后路由；或只提示不增益 | 跨源无 CORS 的来源一旦路由即静音；设置 `crossOrigin` 会让无 ACAO 的远程素材完全无法加载；桌面默认素材（本地上传、缓存、TTS、blob）均为同源；开关提供一键回退 |
| D-17 | 导出取消为「阶段边界协作式」，不终止正在运行的 ffmpeg | 立即终止子进程 | 终止需改 18 个调用点并重建测试接缝；协作式已满足「可取消、停止后续工作、清理中间文件」，残留时间以当前阶段为上限（EXO-07c 列入附录 A） |
| D-18 | 撤销 / 重做仍可改变已锁定轨道上的片段（ME-12） | 锁定轨拒绝撤销 | 历史回溯不是新编辑；拒绝会让撤销栈卡在锁定轨之前；与「锁定不入历史」配套 |
| D-19 | Agent `delete_clip / trim_clip / resize_clip` 之后立即贴紧（N-10） | 保留空隙直到下一次手动编辑 | S8「写入即稳定」；与手动删除行为一致；以 `shiftedClips` 如实回报 |
| D-20 | TL2-01（分离音频联动）与 N-03（图片轨自由定位）延后 | 本轮实现 | 属于产品模型变更：前者当前 UI 不可达，后者需推翻 D-1 / D-3 并联动 Agent、AI 混剪与后端；最后一轮以修复为主 |
| D-21 | TL2-14 采用范围化透明度别名，只修「唯一状态提示」的着色与焦点环 | 全局加 `<alpha-value>` | 全局修复会让 116 个文件中 581 处从未显示过的着色同时出现，需全应用视觉走查（TL2-14b） |
| D-22 | BL-14 删除 `AIVideoGenerateService` 与路由 | 接入模型设置、修正音量口径 | 全仓零调用方，功能已被 AI 混剪取代；保留死代码违反 CLAUDE.md |
| D-23 | N-11 删除 `_download_video*` 死代码族及其测试，而不是修复这些测试 | 修复 DNS 依赖与只读打桩 | 生产无调用方；修测试等于继续维护死代码 |
| D-24 | AM2-04 以 `request.receive()` 监听客户端断开 | 轮询 `request.is_disconnected()` | 打包的 starlette 0.27 在 `BaseHTTPMiddleware` 之后看不到断开 *[实测]* |
| D-25 | 静音移除结果与切段一样剥离脚本段归属；去水印（同 id 替换）保留 | 只处理切段 | 静音移除以同样的 `...originalMaterial.metadata` 继承归属；去水印是同一素材的替换，归属应保留 |
| D-26 | TL2-13 以输入模态区分空格归属 | 聚焦按钮一律让出空格 | 「鼠标点过片段或按钮后按空格播放」是 NLE 核心惯例；键盘用户需要空格激活控件 |
| D-27 | ME-12 锁定 / 显示 / 静音不进入撤销历史 | 仍入历史但不清空重做栈 | 主流 NLE 中轨道锁定与监听开关不是内容编辑；入历史会让撤销把保护状态改回 |
| D-28 | EXO-14 导出会话保存在按 taskId 隔离的模块级存储，编辑器卸载不中止导出 | 卸载即取消导出 | 切换任务 / 项目是常见操作，不应丢弃数分钟的导出结果；取消由用户显式发起 |
| D-29 | TL3-01 磁性轨插入以「同伴片段中点」判定序号 | 以同伴起点判定；或只允许交换 | 中点规则与主流 NLE 一致，长短片段都能插到任意位置；交换逻辑保留给等长片段 |
| D-30 | 本轮范围 87 / 91 项 | 全部 91 项 | 见附录 A 延后准则；保证每组可在本轮独立验证 |
| D-31 | 外部整轴写入（包括「撤销 Agent 本轮」）保留轨道现行的锁定 / 静音 / 显示标志，只有 `'import'` 按写入数据生效（RV3-05） | 撤销本轮时连同标志一起回退 | 与 D-27「标志不是内容编辑」一致；静音被悄悄取消会让导出包含用户已静音的轨道，锁定被悄悄解除会失去保护 |
| D-32 | 导出停滞判定加入 ffmpeg `-progress` 活动心跳，仍使用 `subprocess.run`（RV3-02） | 按时间轴时长放宽超时；或改用 `Popen` 读取 stderr | 放宽超时要么太短误杀、要么太长发现不了挂起；`Popen` 需要重建 `FakeFfmpeg` 接缝（EXO-07c）。进度文件能区分「真正挂起」与「正在编码」，并顺带给出合成阶段的平滑进度 |
| D-33 | 键盘模态只由 Tab 与复合控件内的方向类按键触发（RV3-06） | 所有导航键都触发 | 时间轴没有全局方向键快捷键，鼠标用户按方向键后，空格不应改为激活聚焦的按钮 |

---

## 评审结论

**结论：有条件通过。**

v1 缺陷定位准确、证据充分，共享机制 S11～S16 抓住了同类缺陷的根因，分组、依赖与回退策略可以执行。评审发现 P0×0、P1×5、P2×19：

- 5 个 P1 已全部改入正文：DS3-01 根因更正（RV3-01）、导出停滞判定补上 ffmpeg 活动心跳（RV3-02）、N-11 耦合测试补齐（RV3-03）、三条无法通过的门禁改正（RV3-04）、外部整轴写入保留轨道标志（RV3-05）。
- 19 个 P2 中，18 个已改入正文；RV3-24 接受，并补充了说明。

**文档中不再有未解决的 P0 / P1。**

通过条件（实现节点与提交节点必须满足，并逐条写入实施记录）：

| # | 条件 | 验证方式 |
|---|---|---|
| C-1 | 按 v2 正文实施，包括「评审记录」RV3-01～RV3-23 改入的内容；v1 与 v2 冲突处以 v2 为准 | 代码评审逐条对照「评审记录」的处置列 |
| C-2 | A11、A12、A15、A16、A17 以 v2 修订后的命令为准；§7.2 每条门禁都记录实际执行的命令与输出，不得以「目测通过」代替 | 实施记录 |
| C-3 | A5 后端全量在可导入 `cv2` 的环境运行；N-11 删除之后，`test_video_composition_timeline_order.py` 与 `test_pexels_functionality.py` 的处理结果单独列出。BT16（客户端断开）另在打包的 `desktop/build/python`（starlette 0.27.0）下运行一次：开发机的 starlette 版本与打包环境不同，行为曾经分叉 | 实施记录中的两份 pytest 输出 |
| C-4 | EXO-07 的活动心跳用一条 ≥ 12 分钟的多轨 1080p 时间轴做一次真实导出验证（走查第 11 条的补充项）；不得只用缩短 `stallTimeoutMs` 的单元测试代替 | 走查记录（耗时、进度曲线、是否误报超时） |
| C-5 | §7.3 走查（第 2 轮 1–23 + 本轮 1–30）在桌面端实际执行并逐条记录；无法执行时写「未执行」及原因（I-8），提交信息与总结不得称走查已通过 | 实施记录、提交信息 |
| C-6 | G9（ME-06 WebAudio 增益）排在最后。若 R3 的音画偏移可感知且本轮无法解决：已落地时把 `previewVolumeBoost` 默认值改为关闭，并在附录 A 记录后续；未落地时按 I-2 把 ME-06 整条移入附录 A，同步 §1 / §2 计数。不得半完成提交 | 提交内容与文档记录 |
| C-7 | 实施中发现的方案缺陷追加到本文末尾「实施过程发现的方案缺陷」段（由实现节点新增），并注明影响的 RV3 / 缺陷编号 | 文档 |

---

## 实施过程发现的方案缺陷

由实现节点新增（条件 C-7）。编号 IM3-xx，按发现顺序排列；「影响」列注明涉及的缺陷或评审编号。实现均按「处置」列的修正方案进行。

| ID | 影响 | 发现 | 处置 |
|---|---|---|---|
| IM3-01 | PV3-04 第 5 步、TL3-05 | 方案引用 `t.timeline.messages.trackLocked`，该 key 不存在。既有 key 是 `t.timeline.track.trackLocked`（方案给出的行号 `i18n.ts:461`、en `:3228` 本身就位于 `track` 命名空间） | 复用 `timeline.track.trackLocked`，不新增重复 key（CLAUDE.md「One concept, one name」） |
| IM3-02 | AG2-20、§6.4 | `agentTimeline.toolNames` 只列了 12 个工具，而 `src/lib/video-editing-agent/tools/` 注册了 28 个；其余 16 个在中文界面仍会显示 snake_case 标识 | 为全部 28 个工具补齐 en / zh-CN 名称；类型用显式键（不加字符串索引签名），保证两种语言同步 |
| IM3-03 | AG2-20 | `errorRecovery.ts` 的 `INTERRUPTED_AFTER_TOOLS_MESSAGE` 同样是只有中文的用户文案（en 界面也显示中文），§6.4 未列出 | 新增 `agentStream.errors.interruptedAfterTools`，文案沿用该常量的中文与其注释中的英文 |
| IM3-04 | DS3-01 第 1 步 | 方案只让 `NaN / Infinity` 的 `duration` 删除该键、其余非正值「保持原值」。但字符串等非数字值（如 `'5'`）保留下来会让聚合根构造抛错，条目随后被整体删除——正是本条要避免的误删 | `duration` 不是有限数字时一律删除该键（交给 `Duration.default()`）；有限且 ≤ 0 的数值保持原值 |
| IM3-05 | N-07 | ① 恢复 / 丢弃若只写在 `VideoEditorContainer.tsx` 中，T94 需要渲染整个编辑器才能测试；② §6.4 没有提示条说明文字的 key；③ `salvageTimelineData` 需要空时间轴常量 | ① 逻辑放入 `hydrateTimeline.ts` 的纯函数 `restoreTimelineBackup / withoutTimelineRecoveryBackup`，容器只做连线；② 提示条只放「恢复备份的时间轴 / 丢弃备份」两个按钮，不加说明文字；③ `EMPTY_TIMELINE_DATA` 移入 `repairTimelineData.ts` 共用。没有 id 的被丢弃轨道在报告中记为 `#<index>`；T94 保持 `@vitest-environment node`（jsdom 下该文件的 `fs` 读取不可用） |
| IM3-06 | DS3-04、I-7 | 方案只给出 `buildClipPlaceholder / matchClipCutResults`，切片成功后「由占位 + 结果构造最终素材」的逻辑仍会留在 VEI（2478 行） | `clipCutResults.ts` 增加 `buildCutClipMaterial`，VEI 只做连线。**残留**：切片素材的描述文本仍是硬编码中文（§6.4 无对应 key，属于素材数据而非界面提示），未改 |
| IM3-07 | N-13（RV3-19） | `segment_assigned_at` 或 `createdAt` 无法解析为有限数时，「只用下一条」的判定依据需要明确 | 此时只用「`metadata.originalMaterialId` 指向的原片具有相同 `segment_id`」判定是否剥离 |
| IM3-08 | DS3-03 | 确认框文案中的 `{count}` 是否包含素材包计数（`extraCount`） | 与既有 `clearAllConfirmMessage` 口径一致，包含素材包计数；「清空全部」仍不删除后端文件（与修复前一致，未扩大范围） |
| IM3-09 | AG3-03、§6.3 | 方案把 `AgentStreamErrorCode` 定义在 `agent.ts`；该文件依赖服务端模块，客户端（`AgentEventRouter`、UI）引入会把服务端依赖带进浏览器包 | 类型定义放在浏览器安全的 `src/lib/video-editing-agent/types.ts`，`agent.ts` 重新导出 |
| IM3-10 | AG3-03 | §3.7 只处理 `message_end` 的 `stopReason === 'error'`。请求在开始流式输出之前就抛错时（如 401 立即返回），pi-agent-core 只发 `agent_end`、不发 `message_end`，服务错误仍会被报告为空内容或不报告 | `agent_end` 同样检查最后一条助手消息的 `stopReason / errorMessage` 并经 `formatProviderError` 上报；以标志位避免与 `message_end` 重复发送 |
| IM3-11 | AG2-18 | 方案让 `runOverlapPostCheck(state, trackIds)` 按 `isReorganisable` 过滤，但 `get_timeline` / `check_timeline_overlaps` 仍要返回完整列表，两处需要同一描述 | 新增 `describeOverlaps`（完整列表 + `autoFixable`）供两个只读工具使用；编辑后的警告只含受影响且可自动修复的轨道。`check_timeline_overlaps` 摘要增加 `autoFixableCount` |
| IM3-12 | N-10 | `packsWithoutOverlap` 对 delete / trim / resize「同样返回 true」后，所有带触发条目的操作类型（add / move / delete / trim / resize）都会贴紧，与方案「只补这三种」等价，实现上合并为单一规则 | 按「有触发条目即贴紧」实现；三个工具返回 `shiftedClips`、描述写明后续片段会前移。附带更新了 `useAgentExecution.ordering.test.ts` 中依赖「删除后不贴紧」的夹具（由客户端切片处理） |
| IM3-13 | AG2-13 | 历史压缩按「轮」计数时，插入的 `[System note] N earlier turns omitted` 用户消息会被误算成新的一轮 | 以 `[System note]` 开头的用户消息不开启新轮次；`operations → operationsCount` 的改写对所有较早轮次的工具结果生效 |
| IM3-14 | AG2-13、§5.6、§4.5 | §5.6 要求系统提示说明「看到 omitted 时重新调用工具」，但文件计划 F71–F79 没有列出 `src/lib/video-editing-agent/systemPrompt.ts` | 修改 `systemPrompt.ts`：加入 omitted 说明，并把防循环规则改为以 `autoFixable` 为准 |
| IM3-15 | AG2-21 | 客户端需要区分「长时间无进展」与「超过最长运行时间」两种文案，但两者都以 `StreamErrorType.TOTAL_TIMEOUT` 上报，§3.7 未给出区分方式 | `SSEStreamManager.ts` 导出 `IDLE_TIMEOUT_ERROR_MESSAGE / MAX_DURATION_ERROR_MESSAGE`，客户端按 `StreamError.message` 映射到 `agentStream.errors.idleTimeout / totalTimeout`；旧的 `timeout` 选项保留为 `idleTimeoutMs` 的别名 |
| IM3-16 | EXO-14 | ① `ExportSession.status` 只有 `'running'`：导出成功后弹窗要显示 2 秒对勾，这期间会话若仍是 running 会挡住下一次导出，若提前结束弹窗又会消失；② 旧一次导出迟到的轮询回调或定时器可能写入同一键下的新会话 | ① 增加 `'finished'` 状态，finished 不阻止下一次导出；② `updateExportSession / endExportSession` 必须传入所属的 `AbortController`，与会话不符即忽略；另增加 `stage` 字段与 `exportSessionKey(taskId, projectId)` 助手 |
| IM3-17 | EX3-08 | ① 取消不是错误，`describeExportFailure` 返回 `string` 无法表达「不提示」；② 后端实际的归一化阶段名是 `video_normalization`，不是方案写的 `normalization`；③ 失败阶段已知但没有点名片段时无对应文案 | ① 返回 `string \| null`（null = 已取消，不提示），`locale` 改为可选；② 两个名称都识别为归一化阶段；③ 无点名片段时显示 `failedStageCompose` |
| IM3-18 | EX3-08、EXO-07 | 导出 hook 的测试整体 mock `@/lib/api/videoComposition`，`instanceof CompositionFailedError` 在测试中永远为 false；既有类型 `CompositionStatus` 是状态字符串联合而非状态对象，方案 §6.3 的写法与之冲突 | `exportFailureMessage` 按 `error.name === 'CompositionFailedError'` 识别；`stage / activity_at` 加在 `CompositionStatusResponse` 上，`CompositionStatus` 保持字符串联合；`cancelComposition` 同时提供类方法与导出函数 |
| IM3-19 | EXO-07 | 方案的取消时序是「先调用取消接口，再中止轮询、关闭弹窗」：取消接口慢或失败时弹窗会被卡住；合成 id 尚未返回时点击取消无接口可调；进入下载阶段（≥ 95%）后取消已无意义 | 先中止轮询并关闭弹窗，再调用后端取消（失败只记日志）；在 id 返回前点击的取消，待开始请求返回后立即取消；≥ 95% 时隐藏取消按钮（`canCancelExport`） |
| IM3-20 | EX3-08、§6.4 | 删除 `failedVideos / recoverySuggestions` 后，`videoExport.exportFailedWithError` 同样没有引用（普通错误改为显示 `exportFailed`） | 三个 key 在接口、en、zh-CN 中一并删除（删除前 grep 确认源码无引用；旧测试 mock 中残留的同名字符串无害） |
| IM3-21 | EXO-07、I-7 | `backend-proxy.ts` 的 `executeProxy` 在基线已超过 60 行，AM2-04 在其中新增断开监听 | 按 CLAUDE.md 附一行原因注释，不在本轮拆分；测试辅助 `useVideoExport.fixtures.ts`（不在文件计划中）供 4 个新增导出测试共用，避免 4 份重复夹具 |
| IM3-22 | AG2-20 | 方案要求 `errorRecovery` 「只保留错误类型」、删除用户文案，但 `SSEStreamManager` 的重试原因、`toNonRetryableAfterSideEffects` 及其重试测试都读取 `StreamError.userMessage` | `userMessage` 保留为英文兜底（不再是中文），界面只按 key 取文案；`StreamError` 增加 `sideEffectsStarted` 与 `timeoutKind`，新增 `streamErrorMessageKey / serverErrorMessageKey` 映射到 `agentStream.errors.*` |
| IM3-23 | AG2-21（与 IM3-15 衔接） | 客户端若直接导入 `SSEStreamManager.ts` 的 `IDLE_TIMEOUT_ERROR_MESSAGE` 做区分，会与 `errorRecovery.ts` 形成循环导入 | `classifyError` 以 "idle timeout" 关键字识别无活动超时并写入 `timeoutKind`；T73 导入两个导出常量断言映射结果，文案变动会让用例失败，避免静默漂移 |
| IM3-24 | AG2-20、§6.4 | 错误卡片原有标题（「Reconnecting…」「Execution Timed Out」「Execution Error」）在 §6.4 中没有对应 key | 删除这些标题，卡片以一行 `role="alert"` 显示 `agentTimeline.errorPrefix` + 本地化错误文案；重试计数只显示数字；空回复兜底节点复用 `agentStream.errors.emptyResponse` |
| IM3-25 | AG3-05 / N-21、I-4、I-7 | 退役轮次按 id 写回需要每轮独立的写入器；原先的 `messagesBeforeAgentRef / turnConversationIdRef` 与之重复 | 每轮创建自己的写入器，`sealMessage` 共用；删除这两个 ref。轮次退役与请求剥离抽到 `hooks/agentTurnLifecycle.ts`，`useAgentExecution.ts` 为 888 行（< 1000）。**残留风险**：消息 id 仍为 `Date.now()`，同一毫秒内的两轮会共用 id（实际轮次间隔为秒级） |
| IM3-26 | 门禁 A15 | A15 的 `Executing:` 子串会命中标识符 `ToolStep.tsx:126 isExecuting: boolean,`（不是界面文案），按字面判据无法为 0，也不属于「注释行」例外 | 该命中记为误报并在实施记录中列出；T81 `agentTimeline.noHardcodedText` 使用更严格的字面量匹配（带引号的文案与 JSX 文本节点） |
| IM3-27 | ME-11、N-01、I-7 | 方案把「探测时长 → 重新检查锁 / 目标轨 / 挂载 → 添加」与「素材缺失谓词（素材列表加载前不启用）」写进 `TimelinePanel.tsx` 连线，React 之外无法测试，且让已超 1000 行的文件净增 | 新增 `timeline/lib/dropMaterialWithDuration.ts`（T36 直接测试）与 `timeline/lib/missingMaterial.ts`；`TimelinePanel.tsx` 只做连线，行数 1446 → 1440（含 S6 的改动）。`TimelineItem.localDownload.test.ts`、`TimelinePanel.editLock.test.ts` 的源码断言随拖放逻辑迁移更新 |
| IM3-28 | ME-11（VEI 入口） | 方案要求 VEI「添加到时间轴」入口同样先探测时长；实际该入口经 `materialsToAdd` 进入 `TimelinePanel.handleMaterialDrop`，已被第 27 条覆盖 | VEI 不另加探测，只传 `materialsLoaded={content !== null}`（编辑器在内容加载完成后才挂载） |
| IM3-29 | N-17 | 方案只写删除 `domain/index.ts:52` 的重复导出，`timeline/index.ts` 同样再导出 `ResizeResult / InteractionType`，只删前者会让 tsc 失败 | 两处一并删除 |
| IM3-30 | TL3-02 第 4 步、TL3-01 | 松手在锁定 / 不兼容轨时，旧逻辑回退为同轨 `moveItemAction`，仍会写历史并选中滚动 | 此时按同轨松手处理（磁性轨走插入序号、字幕轨走 `fitMove`），经 S12 无变化不入历史；只有片段确实移动才选中并滚动。`autoOrganize.integration.test.ts` 的跨轨拖放用例改为松手越过长片段中点，保持「落在其后」的原意 |
| IM3-31 | TL3-04 | `fitMove` 的最后一个空隙没有终点，按方案「没有空隙返回 null」只有非法输入才会出现；用例「moving a subtitle onto another caption is refused without history」需要明确「拒绝」的含义 | 「拒绝」= 最近可容纳位置就是该字幕原位，经 S12 撤回历史；`null` 只用于非法输入 |
| IM3-32 | ME-12（RV3-05）、F48 | 冲突比较与 rebase 两处都要「忽略视图标志」地比较轨道；`restoreTrack` 写回时同样会覆盖现行标志 | 新增 `semanticTrackKey(track, { ignoreViewFlags })` 供冲突检测与 rebase 共用；`restoreTrack` 保留现行标志。`trackVolume.test.ts` 改为经 `commitTrackVolumeAction` 提交（S12 下「设为 store 中已有的值」不入历史，属预期变化） |
| IM3-33 | TL3-06、UI3-05 | `setCameraMotionAction` 需要让调用方知道是否全部被过滤；静音按钮的提示方式需与 UI3-05「有自定义提示处删除原生 title」一致 | `setCameraMotionAction` 改为返回 `boolean`；静音按钮文字为「M」，包在 `PortalTooltip` 中，不设原生 `title` |
| IM3-34 | BL-14、门禁 A11（RV3-04）、BT17 | ① §3.8 给出的用例名 `test_workflow_ai_video_generate_is_not_mounted` 本身含 `ai_video_generate`，会被 A11 命中，A11 永远无法为 0；② 若断言「不存在任何 `/api/workflow/*` 路由」是错的——`/api/workflow/video-export` 仍在使用 | ① 用例改名为 `test_workflow_video_generation_route_is_not_mounted`，文档串也不出现旧名称；② 断言改为「`/api/ai-mixed-editing` 已挂载、被删除的路径未挂载」 |
| IM3-35 | EXO-09 / N-15、BT15 黄金表 | 方案的黄金表只列「5 位置 × 2 尺寸 × 3 文本 + 假名样本」，没有写明几条会导致两侧分叉的细则 | 黄金表共 44 例（另含谚文带空格、换行拉丁句、需裁剪的首尾空白、增补平面 CJK、超长单词），期望值由 Python 助手生成，并由 pytest 对照真实 drawtext 构建的文本文件与 `y=` 校验；`expected` 另含 `maxChars`。细则：整段只 `trim` 一次、换行后的各行不再裁剪；CJK / 假名 / 谚文逐码位换行并保留行内与行首尾空格；按码位计数（增补平面字符算 1 个）；空行保留 `topY` 行位；超长拉丁单词独占一行 |
| IM3-36 | N-15 | 方案只给出 Windows 的假名 / 谚文字体候选；谚文逐字换行会让韩文单词在词中断开 | macOS / Linux 不新增字体表，非拉丁文字把既有 CJK 字体（Noto CJK、PingFang，覆盖假名与谚文）排到最前；谚文按方案逐字换行，由黄金表同时钉住两侧行为 |
| IM3-37 | 条件 C-3（BT16） | 打包解释器 `desktop/build/python` 的 `._pth` 忽略 `PYTHONPATH` 并指向陈旧的 `desktop/build/backend`；仓库 conftest 依赖该环境未安装的 `requests_toolbelt` | 在打包解释器下以 `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`、`-p pytest_asyncio.plugin`、`--noconftest` 并把 `sys.path` 指向源码树运行 BT16：2 passed；另以两层 `BaseHTTPMiddleware` + uvicorn 做端到端探针，客户端 1 s 超时后 1.01 s 内取消，保持连接时返回 200 |
| IM3-38 | 门禁 A5 基线 | §0 的后端基线只记录第 2 轮门禁 21 个文件（259 passed / 7 failed），没有全量基线，无法判定 A5「全量无新增失败」 | 在 scratchpad 中以 `e06dca4` 源码、同一 cv2 隔离环境实测全量：**63 failed / 1183 passed / 41 skipped / 16 errors**，作为 A5 全量对比基线（`tests/test_subtitle_simple.py` 的 4 个 error 为基线既有：测试函数参数被 pytest 当作缺失的 fixture） |
| IM3-39 | T2 路径 | §7.1 T2 写作 `playback/internal/__tests__/fitContain.test.ts`，既有用例实际位于 `playback/__tests__/fitContain.test.ts` | 在既有文件中追加用例，不新建重复文件 |
| IM3-40 | N-02、I-7 | 键盘微调的「一串按键 → 400 ms 空闲提交 → Esc 回退 / Enter 提交」定时逻辑若写在 `ImageOverlay.tsx` 内，vitest 下无法挂载该 `.tsx` 测试 | 新增 `VideoPlayerPanel/imageOverlayNudge.ts`（`ImageNudgeBurst`），组件只做连线；T56 直接测试该模块 |
| IM3-41 | ME-06（RV3-20）、§3.3 | ① 回收路由元素的时机需要在池赋 `src` 之前按「新地址能否增益」判断，方案的 `recycleElement(trackId, role)` 需要池把元素与地址一起交给宿主；② `WeakMap` 无法在 `dispose` 时遍历断开全部节点；③ VideoPlayerPanel 有 800 行测试上限 | ① `MultiTrackAttachDeps.prepareElementForSrc` + `PreviewCanvasHandle.prepareElementForSrc / resumeAudio`，池的音量钩子签名为 `(trackId, element, volume)`；② 路由器改用 `Map`，并增加 `release / needsRecycleFor`；③ 「每会话提示一次」的标记放在 `PreviewCanvas`。回退开关 `previewVolumeBoost` 按方案默认开启，可经 `localStorage['ecliptrix-preview-volume-boost']='false'` 关闭。**条件 C-6 未能验证**：R3 的音画偏移需在桌面端实测，本节点无法执行交互式 Electron 会话，未测量，也未据此改默认值 |
| IM3-42 | EXO-09 | 预览样式解析仍携带 `bold / italic / align`，而导出忽略这些字段；字号与背景的口径需与 Python 一致 | `ResolvedSubtitleStyle` 删除 `bold / italic / align`；字号按 Python `int()` 截断；`transparent` 视为无背景 |
| IM3-43 | PV3-03、EXO-09 | `useCompositionPlayback` 的 `outputSize / masterVolume` 若为可选项，漏传时会静默回退到错误的输出尺寸与满音量 | 两者为必填选项；`buildVideoTrackGroups` 增加 `volumeScale` 参数 |
| IM3-44 | PV3-04、N-02 | 只读叠加层只在选中时显示虚线边框，未选中时用户看不出该图片被锁定；Enter / Esc 处理会误响应来自子按钮（完成 / 还原）的按键 | 只读叠加层始终显示虚线边框；Enter / Esc 处理忽略来自子元素按钮的按键事件 |
| IM3-45 | UI3-07 | ① `ConfirmationDialog` 没有方案写的 `variant` 属性；② 放弃确认框嵌套在运镜 `Modal` 内时，同一次 Esc 会同时关闭确认框与外层弹窗 | ① 使用既有的 `type="danger"`；② `Modal` 忽略已被子元素处理（`defaultPrevented`）的 keydown，`ConfirmationDialog` 处理 Esc 时标记为已处理 |
| IM3-46 | TL2-07、I-7 | 方案把缩放锚点的 `useLayoutEffect` 写在 `TimelinePanel`（已超 1000 行） | 抽为 `useAnchoredZoom`（与 `useTimelineWheel` 同文件），`useTimelineWheel` 接收 `getZoomLevel / onZoom`，`TimelinePanel` 只做连线；该文件 1446 → 1482 行（+36，含 S5 改动，在 I-7 的 +40 以内） |
| IM3-47 | TL2-24 | ① 方案只在轨道滚动容器上监听用户滚轮 / 按下以挂起跟随，标尺上的操作不会挂起；② 「松手前补发一次补偿后的 POINTER_MOVE」在未发生滚动时是多余事件 | ① `useFollowPlayhead` 增加可选 `rulerScrollRef`；② 只有按下后车道确实滚动过才补发 |
| IM3-48 | UI3-10 | 隐藏轨道的半透明样式原本加在轨道头容器上；轨道头改为 `sticky` 后，半透明的轨道头会让滚到其下方的片段透出来 | 半透明只作用于轨道头内部内容，`sticky` 容器保持不透明背景 |
| IM3-49 | TL2-14、UI3-05 | 范围化迁移只列了「唯一状态提示」的着色；同一批被修改文件中还有从未生效的主题色透明度类（标尺时间读数、音量浮层 100% 刻度、`Track` 的 `hover:bg-accent/80`、`TrackContainer` 空状态按钮） | 在本切片自有文件中一并迁移到 `*-a` 别名（Tailwind 编译确认生成 `color-mix`）；两个弹窗中的其余着色不动（仍属附录 A TL2-14b）；缩放 +/−/重置按钮没有自定义提示，保留原生 `title` |
| IM3-50 | T55、T57、T66、T67 | `TimelinePanel` 依赖过重，vitest 下无法渲染；jsdom 不做布局，无法验证 `sticky` | 这 4 个用例改为源码级断言；焦点归还、粘性布局与滚轮锚点的真实效果依赖 §7.3 走查第 19～22 条 |
| IM3-51 | 集成（PV3-04 × 既有用例） | `src/components/video/__tests__/VideoEditingInterface.timelineStoreMirror.test.tsx`「commits confirmed image overlay positions」断言 `handleImagePositionConfirm` 直接调用 `updateImagePositionAction(...)`；PV3-04 改为先经 `resolveImagePositionCommit` 判定，该源码断言失效 | 由主线程在集成阶段按新的提交判定更新该用例（见实施记录） |
| IM3-52 | TL2-11、§6.4 | 删除 `SentenceSegmentBar` 被裁剪的悬停卡片后，`timeline.sentenceSegment.sentence` 不再有引用（`timeLabel / durationUnit` 仍被 `title` 文本使用）；§6.4 的删除清单未列出 | 主线程 grep 确认无引用后在接口、en、zh-CN 三处删除 |
| IM3-53 | N-11（RV3-03） | `tests/test_video_composition_timeline_order.py` 中除 4 处 `patch.object(_download_video)` 外，还有 4 个排序用例在基线即失败：它们调用已不存在的 `compose_video`，并断言后端会对条目排序（后端有意不排序，顺序由前端 `renderableTimeline` 决定） | 删除这 4 个用例（其断言与现行设计相反，修复等于重写成另一个测试）；其余用例只去掉补丁行 |
| IM3-54 | EXO-07、EX3-06、I-7 | 取消注册表、阶段写入、状态快照（`activity_at`、合成阶段插值）与 TTL 清理若写进 `video_composition_service.py`（2875 行），无法同时满足 I-7「新增逻辑进入新模块、该文件净减少」 | 新增 `app/services/composition/composition_lifecycle.py`（不在文件计划中）；服务 2875 → 2837 行 |
| IM3-55 | EXO-07（RV3-02） | 方案用 `status["progress_files"]` 集合登记进度文件，需要把合成 id 传进每个执行 ffmpeg 的工作线程 | `activity_at` 取合成临时目录中 `progress_*.txt` 的最新修改时间，与集合方案对客户端等价、线程无需知道合成 id；`_run_tracked_ffmpeg` 增加 `stage` 参数用于命名进度文件 |
| IM3-56 | EX3-05 | `PIL.Image.open().verify()` 会拒绝既有夹具中「PNG 签名 + 零字节」的假图片，导致叠加类既有用例误判为降级 | `composition_harness.py`、`test_image_overlay_export.py`、`test_camera_motion_stills.py` 改为写出真实 PNG。PIL 无法打开的格式（如 SVG）现在只跳过该图片（修复前 ffmpeg 同样无法解码，且会连带丢失全部图片） |
| IM3-57 | N-14 | `test_guard_request_urls_still_rejects_non_local_loopback_path` 把被拒绝的回环地址放在视频条目上；N-14 之后视频地址不再做 DNS 校验，该用例的前提不再成立 | 被拒绝的地址改放在音频条目上，继续钉住「音频 URL 仍受守卫」 |
| IM3-58 | §5.2、EX3-08 | §5.2 示例把 `composition_stage / error_summary` 放在状态 `data` 顶层，而服务把它们写在 `error_details` 内；前端既有类型只读 `error_details` | 状态路由在保留 `error_details` 的同时把这两个字段提升到顶层；前端按 `error_details.composition_stage ?? composition_stage` 读取，两种形状都可用 |
| IM3-59 | I-7（RV3-16）、EXO-07、AM2-04 | S1 的取消接口与状态白名单、S2 的批量解析断开处理合计让 `video_router.py` 净增 47 行（1370 → 1417），超过 I-7「超限文件净增 ≤ 40 行」。`main.py` 的 `HTTPException` 处理器固定输出 `error_code=HTTP_<status>`，无法承载 §5.1 的 `COMPOSITION_ALREADY_SETTLED / COMPOSITION_NOT_FOUND`，因此 `_composition_error` 助手必须保留 | 主线程集成时做不改变行为的收缩：以模块形式导入 `app.utils.client_disconnect`（−4）、注释合并为一行（−1）、取消日志两行（−1）、去掉新增的空行（−1），1410 行（+40）；路由相关用例 19 passed |
| IM3-60 | EXO-07（RV3-02） | 方案 RV3-02 列出的长命令（画布合成、长片段归一化、音画合成、音频合流、图片叠加）都已写进度文件，但字幕烧录 `SubtitleService.burn_drawtext_filters` 同样是一次重编码整条成片的 `subprocess.run`（长时间轴可超过 10 分钟），且位于 `subtitle_service.py`，没有进度心跳——导出会在字幕阶段被客户端误判为停滞 | `burn_drawtext_filters` 增加可选 `progress_path`，在输出参数之前追加 `progress_args`；`_process_subtitle_tracks` 传入 `progress_file_path(temp_dir, "subtitles")`，与 `activity_at` 扫描的目录一致。先写 `test_subtitle_burn_writes_progress_before_its_output`、`test_the_subtitle_burn_reports_into_the_composition_scratch_dir` 并确认失败，再实现；`subtitle_service.py` 1089 行（+40） |

---

## 实施记录（第 3 轮实现节点）

### 实施方式

主线程先在 `src/lib/i18n.ts` 一次性加入 §6.4 全部 key（接口类型 / en / zh-CN，锚点断言脚本，0 控制字节），再把 87 项按文件归属拆成 9 个互不重叠的切片并行实施，最后由主线程做集成修复与全量门禁：

| 切片 | 范围 | 结果 |
|---|---|---|
| S1 后端导出 | EX3-01～06、N-04、EX3-04、N-14、EXO-07（后端）、N-11 | 全部完成；新增用例在 `git archive e06dca4` 副本上先红后绿 |
| S2 后端杂项 | N-15、N-16、N-11 第 4 条、BT15 黄金表、AM2-04（后端）、BL-14、D1、D2 | 全部完成；C-3 打包解释器 BT16 2 passed |
| S3 预览一致 | PV3-01～04、N-18、EXO-09、ME-06、N-06、N-02、UI3-12 | 全部完成；TS 黄金表 44 例全部吻合 |
| S4 导出前端 + AI 混剪前端 | EX3-07、EX3-08、EXO-07（前端）、EXO-14、N-01（导出侧）、AM3-02、AM2-04（前端） | 全部完成 |
| S5 时间轴核心 | TL3-01～06、TL2-05、TL2-22、ME-11、ME-12、N-01、N-17 | 全部完成 |
| S6 时间轴交互 | UI3-01～11、UI3-13、UI3-14、TL2-07/08/10/11/12/13/14/24、N-12 | 全部完成 |
| S7 Agent 核心 | AG3-01、AG3-02（路由）、AG3-03、AG2-03、AG2-04（库）、AG2-13（压缩）、AG2-18、AG2-21、N-10、N-19 | 全部完成 |
| S8 Agent 客户端 | AG3-02（客户端）、AG3-04、AG3-05、N-21、AG3-06、AG2-04（客户端）、AG2-05、AG2-13（请求剥离）、AG2-17、AG2-20 | 全部完成 |
| S9 数据安全 | DS3-01～04、N-07、N-08、N-13、AM3-01 | 全部完成 |

**范围**：87 项全部实现，没有缺陷整条移入附录 A，§1 / §2 计数不变。主线程集成修复见 IM3-51、IM3-52、IM3-59、IM3-60；删除的无引用 i18n key 见 IM3-20、IM3-52。

### I-7 行数（基线 `e06dca4` → 现在）

| 文件 | 基线 | 现在 | 变化 |
|---|---|---|---|
| `src/components/video/VideoEditingInterface.tsx` | 2478 | 2400 | −78（代码评审 RC3-24、RC3-26 后；实现节点为 2420） |
| `src/components/video/timeline/TimelinePanel.tsx` | 1446 | 1485 | +39（代码评审 RC3-18、RC3-19 后；实现节点为 1482） |
| `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | 3071 | 3072 | +1 |
| `backend-services/basic-service/app/services/video_composition_service.py` | 2875 | 2862 | −13（代码评审 RC3-05～RC3-07 后；实现节点记为 2838） |
| `backend-services/basic-service/app/routers/video_router.py` | 1370 | 1410 | +40（IM3-59） |
| `backend-services/basic-service/app/services/subtitle_service.py` | 1049 | 1089 | +40（IM3-60） |
| `src/components/video/playback/CanvasCompositor.ts` | 921 | 968 | < 1000，未抽取 |
| `src/components/video/hooks/useAgentExecution.ts` | 808 | 891 | < 1000（代码评审 RC3-35、RC3-37 后）；轮次退役与请求剥离已抽到 `hooks/agentTurnLifecycle.ts` |

### 门禁 §7.2（全部由主线程在全部切片完成后实际执行）

| # | 实际命令 / 检查 | 结果 |
|---|---|---|
| A1 | `npx tsc --noEmit -p .` | **0 error** |
| A2 | `npm run lint` | exit 1，**恰好 6 个 error，与基线集合一致**：`AudioSearchModal.tsx:9`、`ImageSearchModal.tsx:8`、`VideoSearchModal.tsx:8`、`ImageUploadInput.tsx:61`、`WatermarkRemovalModal.tsx:629`×2；`git status --porcelain` 对这 5 个文件为 0 行（未触及）；各切片对自有文件的单文件 lint 均为 0 error |
| A3 | 各切片按受影响目录运行（timeline、video-editing-agent、hooks、playback、VideoPlayerPanel、projects、ui、lib/api），均 0 失败；主线程另跑已完成切片合并套件 89 文件 / 567 用例 0 失败 | 通过（并由 A4 全量覆盖） |
| A4 | `npx vitest run`（全量） | **347 文件 / 2585 用例 / 0 失败**（基线 277 / 2318，用例数增加） |
| A5 | 后端，cv2 以隔离目录 `opencv-python-headless==4.11.0.86` 经 `PYTHONPATH` 加载，`-p no:cacheprovider` | BT1～BT18 + 第 2 轮门禁文件共 29 个文件：**343 passed / 0 failed / 0 skipped**（ffmpeg 真实用例全部实际运行；`test_timeline_validation_fix.py` 已按 BL-14 删除）。全量（集成修复前）：**39 failed / 1261 passed / 33 skipped / 16 errors**；集成修复（IM3-59、IM3-60）后在最终代码上全量复跑：**39 failed / 1263 passed / 33 skipped / 16 errors**（失败与 error 所在文件集合不变，passed 多出的 2 个为新增的字幕烧录心跳用例），基线 `e06dca4` 为 63 / 1183 / 41 / 16；S1 把全部失败与 error 节点在基线副本上逐一复跑，结果相同，无新增失败，剩余失败均在本轮范围外（TTS、视频搜索、素材路由、数据库等；`test_main.py` 10 个 error、`test_subtitle_simple.py` 4 个 error 为基线既有） |
| A6 | `node desktop/main/closeGuard.test.js`、`node desktop/main/window-state.test.js` | 均通过 |
| A7 | `npm run build` | `Compiled successfully in 31.0s`，类型检查通过，静态页 83/83，exit 0 |
| A8 | `git status --porcelain -uall` | 302 条；无 `__pycache__`、`*.pyc`、`.pytest_cache`、`tsconfig.tsbuildinfo`、`.next/`、`.idea/`、`src/__r3probe_*`；`src/` 下 32 个新增非测试文件均对应 §4 或 IM3 条目，另有测试辅助 `VideoChatWindow/timeline/__tests__/test-utils/motionStub.ts`（S8，不在文件计划中）；新增前端测试文件 70 个 |
| A9 | v2 命令（排除 `timeline/store/` 与 `__tests__`） | 允许名单未扩大：`TimelinePanel.tsx` 挂载 `initTimeline`、复制（锁检查之后）`importFromData` + `autoOrganize`、整理 `autoOrganize`；`hydrateTimeline.ts` 不再命中 |
| A10 | `grep -rn "clearHistory()"`（非测试） | 2 处（`hydrateTimeline.ts:63`、`historyActions.ts:29`），与基线一致 |
| A11 | v2 命令（`-I`） | **0** |
| A12 | v2 精确正则 | **0** |
| A13 | `grep -n "shutil.copy2" …video_composition_service.py` | **0** |
| A14 | `grep -rn "onWheel=" src/components/video/timeline` | **0** |
| A15 | v2 命令 | 1 处：`ToolStep.tsx:126 isExecuting: boolean,`——标识符而非文案，误报（IM3-26）；其余 0 |
| A16 | `grep -rn "window.confirm" …/CameraMotionModal` | **0** |
| A17 | `ConfirmationDialog.tsx` 的 `z-[200]` / `'确认'`；`Modal.tsx` 的 `z-50` | **0 / 0** |
| A18 | `grep -rn` 旧字幕助手（`measureSubtitle`、`positionToVAnchor`、`wrapText(`）于 `src/components/video` | **0** |
| A19 | `grep -n "maxAttempts" src/lib/api/videoComposition.ts` | **0** |
| A20 | `git ls-files` + 未跟踪文件（`src`、后端 `app` 与 `tests`）逐字节扫描 C0 控制字符（除制表、换行、回车） | **0 个文件**（`videoExportItems.ts` 的 NUL 已去除；`git diff --numstat` 仍显示为二进制只因 HEAD 版本含 NUL） |
| A21 | `grep -rn "hsl(var(--" src` | **0** |

另：跨语言黄金表（S11）在真实工作区两侧同时通过——`tests/test_subtitle_layout_golden.py` 44 passed、`subtitleLayout.test.ts` 6 passed（遍历 44 例）。

### 删除 / 替换的用例（A4 要求逐条列出）

- 前端（S3）：`SubtitleLayer` 的 `wrapText` 4 例（「wraps words to fit the max width」「honors hard newlines」「keeps an oversized single word on its own line」「returns empty array for empty text」）由 `subtitleLayout` 用例覆盖；「re-wraps when the max width changes」→「lays out again when the output size changes」；「measureSubtitle measures via a real 2d context…」→「PreviewCanvas does not measure text」；「a real measureSubtitle wired through the engine…」→ 按输出尺寸换行用例；2 个钳制用例改名以反映 >1 的有效音量。
- 前端（S4）：「pollCompositionStatus surfaces error_summary」→ error_details 用例；「rejects with a TimeoutError once the attempts are used up」→ 无进展超时用例；「stops polling when aborted」与「rejects with an AbortError when aborted」合并为「an aborted signal stops polling」；trackFilters「keeps the backend reason…」改名并期望 `failed`。
- 前端（S5 / S6 / S9）：行为有意改变而更新的既有用例见 IM3-27、IM3-30、IM3-32（S5）；S6 更新 `TimelinePanel.editLock`、`TimelineItem.hoverZone`、`CameraMotionModal.test.ts`、`videoEditingInterface.spaceKey`、`SubtitleEditModal.a11y`；S9 改写 1 个断言旧误删行为的修复用例（未删除）。主线程更新 `VideoEditingInterface.timelineStoreMirror.test.tsx` 的源码断言（IM3-51）。
- 后端：按方案删除 `tests/test_video_composition_pexels_retry.py`、`tests/test_pexels_functionality.py`、`tests/test_subtitle_add.py`、`tests/test_timeline_validation_fix.py`，以及 `test_video_composition.py` 的 `test_download_video_success/failure`、`test_compose_video_success/_download_failure`；另删除 `test_video_composition_timeline_order.py` 中 4 个基线即失败的排序用例（IM3-53）。

### I-1「先红后绿」

- 在基线行为上确认失败：S1（`git archive e06dca4` 副本上 19 例失败、6 个文件导入失败）、S2（门禁文件 12 个基线失败 + 新增用例）、S4（19 例失败、3 个文件导入失败）、S5（源码断言先红，其余按基线行为推断）、S6（纯函数 7 例、钩子 2 文件、组件 / 源码 16 例；T60 / T61 / T63 / T64 以基线源码副本复跑，6 例中 5 例失败，余下为守护用例）、S9（20 例失败、2 个套件导入失败）、主线程 IM3-60（2 例先失败）。
- **未在基线上实际运行**（受「不得改变共享工作区 git 状态」约束）：S3 的新增预览用例、S7 的新增 Agent 用例、S8 的钩子与界面用例——按构造在基线上必然失败（缺失导出或旧行为），但没有运行记录。

### §7.3 桌面端走查与通过条件

- **第一部分（第 2 轮 1～23）与第二部分（本轮 1～30）：未执行。** 原因：本节点在非交互式自动化会话中运行，无法启动并操作 Electron 桌面窗口（I-8）。不得据此称走查通过；提交节点与后续人工必须补做。
- **C-4（≥ 12 分钟多轨 1080p 真实导出验证活动心跳）：未执行**，原因同上。已有自动化证据：`test_composition_progress_activity.py` 6 passed（含画布与字幕烧录的进度文件路径、合成阶段插值、排队取消）。
- **C-6（ME-06 音画偏移）：未测量。** `previewVolumeBoost` 按方案保持默认开启，回退方式为 `localStorage['ecliptrix-preview-volume-boost']='false'`；若走查发现可感知偏移，按 C-6 把默认值改为关闭。

| 条件 | 状态 |
|---|---|
| C-1 按 v2 实施 | 满足；与 v2 不一致之处全部记入 IM3-01～IM3-60 |
| C-2 门禁以 v2 命令为准并记录输出 | 满足（见上表） |
| C-3 cv2 环境全量 + 打包解释器 BT16 | 满足（A5；BT16 在 `desktop/build/python` 下 2 passed，IM3-37） |
| C-4 长导出真实验证 | **未执行** |
| C-5 走查实际执行 | **未执行**（原因见上） |
| C-6 ME-06 排最后、偏移可感知时回退 | 已实现并保留回退开关；偏移**未测量** |
| C-7 方案缺陷追加到本文 | 满足（IM3-01～IM3-60） |

### 残留风险（供代码评审与走查关注）

- ME-06 路由后的音画延迟未在桌面端测量（R3）。
- ~~Agent 消息 id 仍为 `Date.now()`，同一毫秒两轮会共用 id（IM3-25）。~~ 已由代码评审 RC3-35 修复。
- 谚文按码位换行会在词中断开（IM3-36）；~~切片素材描述仍为硬编码中文（IM3-06）~~ 已由代码评审 RC3-26 本地化。
- 导出取消在当前 ffmpeg 命令结束后才生效（EXO-07c，附录 A）。
- ~~「丢弃备份」与 VEI 的并发内容写入之间存在理论竞态（S9）。~~ 已由代码评审 RC3-39 以读取-合并-写入消除。
- `mouseGesture` 以 `buttons === 0` 结束手势，未设置 `buttons` 的合成鼠标事件会提前结束手势（S6）。代码评审核实：Electron 33（Chromium 130）的真实鼠标事件始终填写 `buttons`，只有脚本构造的合成事件受影响，不改。
- 焦点归还、`sticky` 轨道头与滚轮锚点只有 jsdom 用例，真实布局依赖走查第 19～22 条。

---

## 代码评审修复记录（第 3 轮提交节点）

| 项 | 值 |
|---|---|
| 评审节点 | 代码评审与提交（第 3 轮，循环最后一轮） |
| 日期 / 基线 | 2026-09-14 / `feat/remove-user-system` @ `e06dca4` + 第 3 轮实现节点的未提交改动（297 条） |
| 评审方式 | 按文件归属拆成 10 个互不重叠的审查切片并行：R1 后端导出、R2 后端杂项与文档、R3 预览、R4 导出前端与 AI 混剪前端、R5 时间轴核心、R6 时间轴交互、R7 共享 UI 与 VEI 连线、R8 Agent 核心、R9 Agent 客户端、R10 数据安全。每个切片对照本文正文、评审记录 RV3 处置列与 IM3 偏差，逐条核对**覆盖**、**回归风险**（读切片外调用方）与**命名 / 风格 / 注释**（CLAUDE.md 规模与错误处理约束）；发现即修，缺陷修复配以行为命名的回归用例，并在修复前确认失败。主线程审查 `src/lib/i18n.ts`，处理跨切片问题，最后在最终代码上运行全量门禁 |
| 结论 | 87 项全部实现，与方案不同之处均有 IM3 记录；代码评审发现并修复 **40 项（P0×0 / P1×4 / P2×36）**，无遗留的 P0 / P1 |

### 覆盖核对结论

- **PV（8）**：PV3-01～04、N-18、EXO-09、ME-06、N-06 已实现。`fitSourceInFrame` 的 0.01 容差与 `video_scaling.py` 一致；字幕排版与后端黄金表两侧通过（Python 44 例、TS 遍历 44 例）；锁定叠加只读且被拒位置回滚（S13）。ME-06 修复 RC3-03、RC3-10；UI3-12 补齐缺失的 T54（RC3-11）。
- **EX（15）**：EX3-01～08、N-04、N-14、EXO-07、EXO-14、N-11、N-15、N-16 已实现。复核确认：迟到的取消返回 409 且不泄漏取消事件；TTL 只清理终态且超过 1 h 的项；下载路由从状态字典取路径，无路径穿越面；两级滤镜转义可还原撇号路径。修复 RC3-01、RC3-02、RC3-05～07、RC3-09、RC3-12、RC3-13。
- **TL（12）**：TL3-01～06、TL2-05、TL2-22、ME-11、ME-12、N-01、N-17 已实现。S12 撤回在 `MAX_HISTORY` 截断与撤销后索引居中两种情况下都能完整复原；视图标志在 `restore`、`agent-undo`、trackPatch 冲突比较与 rebase、`restoreTrack` 中均保留现值，JSON 导入按数据生效。修复 RC3-04、RC3-14～19。
- **UI（24）**：S16 与 UI 组全部实现。共享 `Modal` 的 6 个使用方中，没有 Esc / Tab 因 `defaultPrevented` 失效，也没有弹层被 `z-modal` 遮住；`*-a` 别名与 `color-mix` 滚动条在 Electron 33（Chromium 130）中实测计算值生效，原 `hsl(var(--x) / 0.4)` 为透明（证实 UI3-09）。修复 RC3-20～22、RC3-25。
- **AG（17）**：S14 与 AG 组全部实现。SSE 在 CRLF 被拆到两块、多行 `data:`、结束 flush 时均正确；历史压缩按整轮丢弃，不拆分工具调用与结果；客户端空闲截止时间不早于服务端 + 60 s。修复 RC3-27～37。
- **AM / DS（11）**：已实现。DS3-01 实测：旧 Agent 图片 `clipStart = clipEnd = 0`、零时长、`clipEnd ≤ clipStart`、负起点、非数字时长全部保留或钳制，只有无法构造的条目才删除并写备份；已有备份不会被覆盖。修复 RC3-23、RC3-24、RC3-26、RC3-38～40。
- **i18n（主线程）**：实现节点新增 317 行（接口 105 / en 106 / zh-CN 106），en 段无中文、zh-CN 段无未翻译的英文值；删除的 `failedVideos / recoverySuggestions / exportFailedWithError / sentenceSegment.sentence` 在源码中无引用（`failedVideos` 的命中是进度字段，不是文案 key）。

### 修复清单

| ID | 级别 | 关联 | 位置 | 问题与证据 | 修复与回归用例 |
|---|---|---|---|---|---|
| RC3-01 | P1 | EXO-07 / RV3-02 | `app/services/composition/ffmpeg_args.py` `latest_progress_activity` | 用 `os.scandir` 的 `DirEntry.stat()` 取进度文件 mtime。Windows 上，写入方持有句柄时目录项的 mtime 不刷新，而 ffmpeg 全程开着 `-progress` 文件，于是 `activity_at` 冻结在首次写入。归一化、合流、叠加、字幕烧录阶段的健康长导出仍会被客户端判为停滞超时。*[实测]* 持句柄间隔 2.2 s 写入：`scandir` 差 0.0，`os.stat` 差 2.203；真实 `ffmpeg -re -progress` 9 s 探针同样只在打开句柄后刷新。实现节点的心跳用例用 `os.utime` 模拟写入，暴露不了这个问题 | 改为 `os.stat(entry.path).st_mtime` 并注释原因。`test_composition_progress_activity.py::test_activity_follows_a_progress_file_that_ffmpeg_keeps_open`（修复前 `activity == first_activity`） |
| RC3-02 | P1 | N-15（本轮引入的回归） | `app/services/subtitle_service.py` `_KANA_RANGES / _detect_script` | 假名区间包含片假名中点「・」（U+30FB）。「哈利・波特说这个」这类中文外文人名写法被判为日文，Windows 下选中 `YuGothM.ttc`。经 fontTools 读取本机字体确认缺少「说 / 这 / 们」，drawtext 不做字体回退 → 导出烧成缺字方框，预览却正常（基线选 `msyh.ttc`） | 假名区间排除 U+30FB，含汉字或中点的文本判为 `cjk`（与前端 `containsCjk` 换行口径一致，黄金表不变）。`test_subtitle_export_style.py::test_chinese_subtitle_with_katakana_middle_dot_keeps_a_hanzi_font`（修复前失败）+ 守护用例 `test_middle_dot_text_wraps_by_character_like_the_preview` |
| RC3-03 | P1 | ME-06（RV3-20） | `playback/audio/PreviewGainRouter.ts` `apply` | 用 `currentSrc \|\| src` 判定能否增益。池在同一帧先赋 `src` 再写音量，而 `currentSrc` 要等加载算法稳定后才更新。同一轨「本地片段 100% → 未缓存远程片段 150%」换源那一帧，按旧的同源地址判为可增益，`createMediaElementSource` 路由了跨源媒体；WebAudio 对无 CORS 的跨源来源输出静音且无法撤销，该片段整段无声 | 改为 `src \|\| currentSrc` 并注释。`PreviewGainRouter.test.ts :: judges the just-assigned src, not the previous currentSrc, before routing`（修复前 `{ outcome: 'boosted', routed: 1 }`） |
| RC3-04 | P1 | ME-12 | `timeline/Track.tsx` | 新增的轨道头静音按钮对非图片 video 轨同样可切换，车道也会变暗，但预览与导出都不读 video 轨的 `isMuted`（见附录 A ME-12b）→ 按钮显示已静音，预览与成片仍有原声 | 静音按钮与车道静音变暗只作用于 audio 轨，注释原因（方案偏差，见下）。`Track.muteButton.test.tsx :: a video track offers no mute button because its mute would not silence preview or export`（修复前失败） |
| RC3-05 | P2 | EXO-07 / N-04 | `video_composition_service.py` `_concat_videos` | 单轨 concat 与连续段预合并共用这个函数。stream copy 与失败后的整轴重编码回退都是未跟踪的 `subprocess.run`：回退可能超过 10 分钟且没有心跳；WinError 206 也不会转为可读的阶段错误 | 两条命令改走 `_run_tracked_ffmpeg`（`progress_concat_<输出名>.txt`）。`test_composition_progress_activity.py::test_concat_reencode_fallback_reports_progress`（修复前 `'-progress' is not in list`） |
| RC3-06 | P2 | EX3-01 / EX3-02 | `video_composition_service.py` `_get_video_properties / _describe_source` | 改写时 `except` 分支丢了 `return None, None, None`，异常时返回 `None`，两个调用方解包时抛 TypeError（归一化被重试 4 次才失败，字幕降级原因不可读）；ffprobe 失败后的回退又跑一次 ffprobe（最多多等 30 s） | 抽出 `_cv2_video_properties`（异常时返回三个 None，并记录路径与原因），`_describe_source` 直接回退到它。`test_video_composition.py::…::test_get_video_properties_is_empty_when_opencv_raises`、`::test_unprobeable_source_runs_ffprobe_once`（修复前均失败）；`test_video_composition_timeline.py` 两例的打补丁点同步修改 |
| RC3-07 | P2 | I-7 | `video_composition_service.py`、`app/routers/video_router.py` | 本轮改动的 10 个函数超过 60 行，既没拆分也没有原因注释（如 `_compose_videos_filtergraph` 53 → 74 行） | 抽出 `_run_canvas_composite`（两函数分别为 44 / 36 行，行为不变），其余函数各加一行原因注释；路由文件把原因写进既有文档串，不增行（仍为 1410 行）。由既有画布、输入上限与合成失败用例覆盖 |
| RC3-08 | P2 | BL-14 / D2 | `.claude-index/index.md` | 索引仍列出已删除的 `media_download` 和不存在的 `subtitle_prep`，漏掉 `media_probe / composition_lifecycle / app/utils/client_disconnect.py`，路由数写成 32 / 37 | 按实测改正：31 处 `include_router`、30 个路由模块 |
| RC3-09 | P2 | IM3-60 / 参数上限 | `subtitle_service.py` `burn_drawtext_filters` | 6 个参数（CLAUDE.md 上限 5），没有说明原因 | 在既有文档串行内写明原因：`progress_path` 是可选尾参数，调用方无需改动。不增行（仍为 1089 行，I-7 +40）；30 个烧录相关用例通过 |
| RC3-10 | P2 | ME-06 × 就绪重绘 | `playback/MultiTrackPlaybackEngine.ts` | `prepareElementForSrc` 回收路径在 `_apply` 中换上的新解码元素，要等下一次解析才绑定就绪重绘；暂停时没有下一帧，画面停在黑帧 | 回收出新元素时立即 `_bindReadinessRepaint`。`MultiTrackPlaybackEngine.test.ts :: a decode element recycled for a cross-origin src still repaints the paused frame when it loads (ME-06)`（修复前重绘次数为 0） |
| RC3-11 | P2 | UI3-12（T54 缺失） | `VideoPlayerPanel/VideoPlayerPanel.tsx` | §7.1 的 T54 不存在，UI3-12 没有任何回归用例；镜像逻辑内联在 vitest 无法挂载的面板中 | 抽出 `VideoPlayerPanel/usePlayStateMirror.ts`（行为不变）。`playStateMirror.test.ts :: the ruler shows Playing while the compositor plays` |
| RC3-12 | P2 | EXO-07 / 可访问性 | `VideoPlayerPanel/VideoExportProgressModal.tsx` | 弹窗根节点对 Escape 以外的所有按键 `preventDefault`，本轮开放的「取消导出」按钮上 Enter / Space 失效；另有一个不可达的进度分支 | 先 `stopPropagation`，只对 Tab / Escape `preventDefault`；删除死分支。`VideoExportProgressModal.keyboard.test.ts` 2 例（修复前失败） |
| RC3-13 | P2 | S15 / EX3-08 | `src/lib/api/videoComposition.ts`、`hooks/exportFailureMessage.ts` | 轮询中任意一次状态请求失败（30 s 请求超时、网络错误、502 / 504）都会结束整个导出，后端继续编码并留下孤儿成片；请求级超时与停滞超时同名，被提示为「导出已 10 分钟没有进展」 | `createStatusFailureBudget`：超时、网络错误、5xx 记录 warn 后重试，连续 3 次才放弃，404 立即结束，任一次成功即清零；停滞错误带 `code: 'COMPOSITION_STALLED'`，只有它显示超时文案。`videoComposition.poll.test.ts` 3 例 + `useVideoExport.failure.test.ts :: a status request timeout is not reported as ten minutes without progress`（修复前 4 例失败） |
| RC3-14 | P2 | TL3-01（命名） | `timeline/domain/services/MagneticInsertion.ts` | `MagneticPeer` 与 `FreeLaneRules.LanePeer` 字段完全相同，同一概念有两个名字 | 删除 `MagneticPeer`，统一使用 `LanePeer` |
| RC3-15 | P2 | ME-11 / RV3-21（用例缺口） | `timeline/lib/dropMaterialWithDuration.ts` | 「探测超过 600 ms 提示一次、快速返回不提示」没有用例 | `materialDrop.unknownDuration.test.ts` 2 例 |
| RC3-16 | P2 | ME-11（用例缺口） | `lib/probeMediaDuration.ts` | 超时后释放 `src`、`duration = Infinity` 时返回 null 均无用例 | `probeMediaDuration.test.ts` 2 例 |
| RC3-17 | P2 | TL3-01 / TL3-02 / TL3-04（用例缺口） | `timeline/store/slices/dragSlice.ts` | 跨轨落到磁性轨时的插入序号、一次撤销复原两条轨、字幕松手落到最近空隙均无用例 | 新增 `dragSlice.crossTrackCommit.test.ts` 4 例 |
| RC3-18 | P2 | TL3-06 / S13 | `timeline/TimelinePanel.tsx` `handleApplyCameraMotion` | 没有使用 `setCameraMotionAction` 的返回值：弹窗打开期间轨道被锁定（或 Agent 开始编辑）后点「应用」，操作静默无效 | 返回 false 时按原因提示 `timeline.messages.editLockedByAgent` 或 `timeline.cameraMotion.disabledTrackLocked`。`TimelinePanel.refusalFeedback.test.ts` 用例 1（修复前失败） |
| RC3-19 | P2 | ME-11 / S13 | `timeline/TimelinePanel.tsx` 拖放结果处理 | 探测期间目标轨被删除（`refused / 'track-missing'`）时没有任何反馈 | 复用 `agentApply.reasons.trackNotFound` 提示。`TimelinePanel.refusalFeedback.test.ts` 用例 2（修复前失败）；`TimelinePanel.tsx` 为 1485 行（+39，I-7 以内） |
| RC3-20 | P2 | UI3-02 / UI3-05 | `timeline/Track.tsx` | 音量浮层渲染在音量按钮的 `PortalTooltip` 包裹层内，焦点或鼠标进入浮层时，按钮提示一直压在上方 | 浮层移到提示包裹层之外。`Track.volumePopover.test.tsx :: focusing or hovering inside the open volume popover shows no track tooltip`（修复前失败） |
| RC3-21 | P2 | TL2-08（死代码） | `timeline/TrackContainer.tsx` | `pressRef` 只写不读 | 删除；由既有 `TrackContainer.deselect`、`TrackContainer.portalEvents` 用例覆盖 |
| RC3-22 | P2 | TL2-14 / UI3-05 | `src/styles/video-editing.css` | `.timeline-toolbar button:focus` 轮廓（特异性 0,2,1）压过 Tailwind 的 `focus-visible:outline-none`：鼠标点击也出轮廓，键盘聚焦时与本轮新加的焦点环叠成两圈 | 删除该规则，由 `focus-visible:ring` 单独承担。`themeTokens.test.ts :: toolbar buttons draw a single keyboard focus ring`（修复前失败） |
| RC3-23 | P2 | DS3-04（提示） | `VideoEditingInterface.tsx` `handleExportClips` | 所有片段都切分失败时，后端仍返回 `success=True` 与 "Successfully cut and saved 0 video clips locally"，VEI 把它当作失败原因，中文界面显示「视频切分失败：Successfully cut…」 | 新增 `lib/clipCutNotices.ts` `describeClipCutOutcome`，没有产出时提示「3 个切片中有 3 个切分失败，已移除」。`clipCutNotices.test.ts` 5 例 + `VideoEditingInterface.clipCut.test.ts` 2 例（修复前 1 例失败） |
| RC3-24 | P2 | I-7 | `VideoEditingInterface.tsx` `handleExportClips` | 改动后函数为 80 行，没有原因注释 | 随 RC3-23 收缩为 58 行（RC3-26 后为 59 行），行为不变 |
| RC3-25 | P2 | 测试卫生 | `src/components/ui/__tests__/ConfirmationDialog.focus.test.tsx` | 本轮新增用例产生 2 条 `no-unused-vars` 警告 | 改为显式传入 `undefined` |
| RC3-26 | P2 | IM3-06 残留 | `lib/clipCutResults.ts`、VEI | 切片素材描述是硬编码的中文模板，英文界面的素材库也显示中文 | `buildClipPlaceholder` 增加 `descriptionTemplate` 参数，VEI 传入新 key `videoEditing.clipCut.clipDescription`。`clipCutResults.test.ts :: the clip description follows the localized template it is given`（修复前失败） |
| RC3-27 | P2 | AG3-03 | `src/lib/video-editing-agent/agent.ts` `CONTEXT_OVERFLOW_PATTERN` | 只覆盖 OpenAI / DeepSeek 的写法。Anthropic（含智谱 anthropic 端点）的 `prompt is too long`、OpenAI Responses、Gemini、Kimi、DashScope、智谱的超长报错都被归为 `provider_error`，界面显示英文原文而不是「对话过长」 | 扩为 10 个短语，在截断之前分类，保持「上下文超长 → 限流 → 鉴权」顺序。`agent.providerError.test.ts :: context overflow wording of other providers is context_overflow` + 限流（TPM）守护用例 |
| RC3-28 | P2 | AG3-03 / R20 | `agent.ts` `SECRET_PATTERNS` | `?key=AIza…`、`access_token=…`、不带 scheme 或 Basic 的 `Authorization:` 原样显示给用户 | 增加三类形态的去除。`agent.providerError.test.ts :: query-string keys, access tokens and raw authorization headers are redacted`（修复前原文回显） |
| RC3-29 | P2 | AG2-20 | `agent.ts` 熔断 | 连续 5 次工具失败的错误没有 `code`，中文界面显示整句英文 | 加 `code: 'tool_failures'`，映射到 `agentStream.errors.toolFailures`。`agent.providerError.test.ts :: the circuit breaker error carries a code the UI can localise` |
| RC3-30 | P2 | AG2-20 / R20 | `src/app/api/video-editing-agent/chat/route.ts` catch | 发送 `Agent error: ${message}`：没有 code，没有去除凭据与截断，客户端再加前缀后变成「Agent error: Agent error: …」 | 改为 `code: 'agent_error'` + 新导出的 `formatErrorDetail`。`chatRoute.timeoutOrder.test.ts :: an unexpected route error carries a code the UI can localise` |
| RC3-31 | P2 | AG2-20 | `VideoChatWindow/timeline/AgentThinkingNode.tsx`、`UserMessageNode.tsx` | 「Thinking... / Thought Process / AI Analyzing... / User」硬编码英文；T81 门禁没有扫这两个文件 | 改走 i18n，T81 纳入这两个文件。`agentTimeline.noHardcodedText.test.ts`（修复前 2 处命中） |
| RC3-32 | P2 | AG2-20（键盘） | `AgentResponseNode.tsx` | 撤销单步后只剩一步时，菜单按钮卸载，焦点落到 `<body>` | 焦点移到「撤销本轮」。`AgentResponseNode.undoMenu.test.tsx :: undoing a step that leaves one moves focus to undo all` |
| RC3-33 | P2 | IM3-24（可访问性） | `ErrorStateCard.tsx` | 重试计数的 `aria-label` 挂在无角色的 `<span>` 上，屏幕阅读器读不出；「正在重试」文案与本轮已结束的状态矛盾 | 新 key `agentTimeline.retriesUsed`，以 `sr-only` 输出完整句子。`TimelineChatPanel.errorCard.test.tsx :: a connection error card states the retries it used as text` |
| RC3-34 | P2 | 一个概念一个名字 | `TimelineChatPanel.tsx` | 同一个 `cancelByUser` 动作在两处分别叫「取消」和「停止」 | 统一为 `agentTimeline.stop`，删除无引用的 `agentTimeline.cancel`。`TimelineChatPanel.errorCard.test.tsx :: the live indicator names its stop button like the execution card` |
| RC3-35 | P2 | IM3-25 残留 | `hooks/useAgentExecution.ts`、`hooks/agentTurnLifecycle.ts` | 消息 id 为 `msg-${Date.now()}`，同一毫秒发出的两轮 id 相同：applier 映射被覆盖、React key 重复、退役写回命中错误的消息 *[实测：冻结时钟发两轮，4 条消息只有 2 个 id]* | 新增 `createTurnMessageIds()`（时间戳 + 递增序号）。`useAgentExecution.ordering.test.ts :: two turns sent in the same millisecond get distinct message ids`（修复前 2 ≠ 4） |
| RC3-36 | P2 | 不做静默兜底 | `VideoChatWindow/timeline/utils.ts` | `labels` 是可选参数，漏传时空回复节点静默显示为空白 | 改为必填，由 tsc 强制 |
| RC3-37 | P2 | I-7 / 死代码 | `hooks/useAgentExecution.ts` | 死导入、从未读取的 `streamManagerRef`、`turnStart` 类型过宽、两个超过 60 行的函数没有原因注释 | 删除、收紧类型、补原因注释；891 行 |
| RC3-38 | P2 | DS3-01 | `projects/repairTimelineData.ts` `clampItemFields` | 聚合根把 `null` 的 `clipStart / clipEnd / duration` 当作缺省，修复规则却用 `!== undefined` 判断，把它们改写并计入「已修复」 | 守卫改为 `!= null`。`repairTimelineData.test.ts :: a null clip field the aggregate reads as absent is not reported as repaired`（修复前失败） |
| RC3-39 | P2 | N-07（实施记录残留竞态） | `projects/VideoEditorContainer.tsx`、`hydrateTimeline.ts` | 丢弃备份用函数式更新，而编辑器回写是整体覆盖；在丢弃之前构造的内容会把备份带回，并被自动保存重新持久化（后端整体替换 `project_data`） | `handleUpdateContent` 以 `withCurrentRecoveryBackup(current, next)` 读取-合并-写入，备份字段只归容器所有。`VideoEditorContainer.recoveryBackup.test.ts` 3 例（修复前失败） |
| RC3-40 | P2 | N-07（文案） | `projects/VideoEditorContainer.tsx` | 恢复时没有跳过任何片段，提示却显示「跳过 0 个无法读取的片段」 | 新 key `videoProjects.backupRestoredAll`。`VideoEditorContainer.recoveryBackup.test.ts :: a restore that skipped nothing does not mention skipped clips` |

### 代码评审产生的方案偏差

- **ME-12 第 4 步**：轨道头静音按钮只给 `audio` 轨（RC3-04），不再给「非图片 video 轨」——方案的前提（静音在预览与导出中生效）只对音频轨成立。视频轨静音记入附录 A ME-12b。§7.3 走查第 17 条本就只写「音频轨头静音按钮」，不受影响。
- **§5.3**：`error.code` 由 6 个取值扩为 8 个（`tool_failures`、`agent_error`），已同步正文；§6.4 的 key 增删已同步正文「代码评审补充」段。
- **S15 / §5.7**：`pollCompositionStatus` 在连续 3 次状态请求失败后才放弃（404 立即结束）；停滞超时错误仍名为 `TimeoutError`，附加 `code: 'COMPOSITION_STALLED'`（RC3-13）。
- **§5.7**：`buildClipPlaceholder` 增加第 5 个参数 `descriptionTemplate`（RC3-26）；`agent.ts` 导出 `formatErrorDetail`（RC3-30）；`useAgentExecution` 的消息 id 由 `createTurnMessageIds()` 生成（RC3-35）。
- **不在 §4 文件计划中的新增文件**：`VideoPlayerPanel/usePlayStateMirror.ts`（RC3-11）、`src/components/video/lib/clipCutNotices.ts`（RC3-23），以及上表列出的新增测试文件。

### 门禁（代码评审全部修复完成后，在最终代码上由主线程实际运行）

| # | 实际命令 / 检查 | 结果 |
|---|---|---|
| A1 | `npx tsc --noEmit -p .` | **exit 0** |
| A2 | `npm run lint` | exit 1，**恰好 6 个 error，与基线集合一致**（`AudioSearchModal.tsx:9`、`ImageSearchModal.tsx:8`、`VideoSearchModal.tsx:8`、`ImageUploadInput.tsx:61`、`WatermarkRemovalModal.tsx:629` ×2，均为未触及文件）；各切片对自有文件的单文件 lint 均为 0 error |
| A3 / A4 | `npx vitest run`（全量） | **354 个文件 / 2629 个用例 / 0 失败**（实现节点 347 / 2585；基线 277 / 2318） |
| A5 | 后端全量：`PYTHONPATH=<隔离 cv2> python -m pytest tests/ -q -p no:cacheprovider -rfE` | **39 failed / 1269 passed / 33 skipped / 16 errors**。与实现节点的最终结果（39 / 1263 / 33 / 16）相比，failed / skipped / errors 不变，passed 多出的 6 个是代码评审新增用例（基线 `e06dca4` 为 63 / 1183 / 41 / 16）。失败文件全部在本轮范围之外：`test_batch_tts` 7、`test_tts_router` 6、`test_video_search` 7、`test_material_router` 5、`test_database` 3、`test_media_proxy` 3、`test_voice_config` 3、`test_storage_service` 2、`test_video_understanding_script` 2、`test_video_cut_fix` 1；errors：`test_main` 10、`test_subtitle_simple` 4、`test_aspect_ratios` 1、`test_video_cut_fix` 1。切片复跑：R1 自有 17 个文件 188 passed / 0 skipped（ffmpeg 真实用例实际运行），R2 9 个文件 94 passed |
| A6 | `node desktop/main/closeGuard.test.js`、`node desktop/main/window-state.test.js` | 均通过 |
| A7 | `npm run build` | `Compiled successfully in 54s`，静态页 83/83，exit 0 |
| A8 | `git status --porcelain -uall` | 仅含本轮与代码评审的源码、测试与文档；无 `__pycache__`、`*.pyc`、`.pytest_cache`、`tsconfig.tsbuildinfo`、`.next/`、探针目录（提交时逐文件暂存核对） |
| A9 | v2 命令 | 允许名单未扩大：`TimelinePanel.tsx` 的 `initTimeline`、复制 `importFromData` + `autoOrganize`、整理 `autoOrganize` |
| A10 | `grep -rn "clearHistory()"`（非测试） | 2 处（`hydrateTimeline.ts:63`、`historyActions.ts:29`），与基线一致 |
| A11～A14 | v2 命令 | **0 / 0 / 0 / 0** |
| A15 | v2 命令 | 1 处：`ToolStep.tsx:126 isExecuting: boolean,`（标识符误报，IM3-26）；其余 0 |
| A16～A19 | v2 命令 | **0 / 0,0 / 0 / 0** |
| A20 | `git ls-files -co --exclude-standard` 覆盖 `src`、后端 `app` 与 `tests`，逐字节扫描 C0 控制字符 | 扫描 1286 个文本文件，**0 个**含控制字节 |
| A21 | `grep -rn "hsl(var(--" src` | **0** |

### §7.3 走查与通过条件（代码评审节点）

- **§7.3 第一部分（第 2 轮 1～23）与第二部分（本轮 1～30）：仍未执行。** 本节点同样在非交互式自动化会话中运行，无法启动并操作 Electron 窗口（I-8）；提交信息与总结不得称走查已通过，必须由人工在桌面端补做。
- **C-4（≥ 12 分钟多轨 1080p 真实导出）：未执行。** RC3-01 说明模拟写入的用例无法代替真实 Windows 句柄语义，该项尤其需要实测。
- **C-6（ME-06 音画偏移）：未测量。** `previewVolumeBoost` 保持默认开启，回退方式为 `localStorage['ecliptrix-preview-volume-boost']='false'`。
