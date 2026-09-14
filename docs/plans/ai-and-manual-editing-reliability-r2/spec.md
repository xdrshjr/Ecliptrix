# AI 自动剪辑 + 手动剪辑 稳健性加固（第 2 轮）— 设计方案

| 项 | 值 |
|---|---|
| 文档版本 | **v2**（v1 由方案设计节点产出；v2 由「方案评审与修复」节点就地修订：见「评审记录」RV-01～RV-19，正文中以 **〔RV-xx〕** 标注修订处） |
| 日期 | 2026-09-14 |
| 分支 / 基线 | `feat/remove-user-system` @ `a7f46c5`（第 1 轮已提交，工作区干净） |
| 上一轮 | `docs/plans/ai-and-manual-editing-reliability/spec.md`：第 1 轮 32 项与代码评审 31 项已修复并提交；其附录 A（BL-01～BL-33）是本轮输入 |
| 需求来源 | 任务板「AI 自动剪辑 / 手动剪辑 更加完善稳健可靠，每轮 ≥10 个问题并逐一修复」 |
| 本轮范围 | **66 个已证实缺陷**（P0×3 / P1×33 / P2×30），分 6 组；另 27 个已证实缺陷列入附录 A，作为第 3 轮输入 |
| 本轮主题 | **数据不丢**、**所见即所得（预览 = 导出）**、**编辑结果稳定**（写入即稳定、编辑锁全覆盖、失败必可见） |
| 适用产品形态 | 单用户 Electron 桌面端（FastAPI 127.0.0.1 + Next standalone），无鉴权、SQLite |

> 证据说明：本文每个缺陷都给出 `文件:行号`（基线 `a7f46c5`）、复现数值与根因。标注 *[实测]* 的条目做过运行验证
> （ffmpeg lavfi 合成素材 + 调用真实 filtergraph builder 探针像素 / 时长；Vitest 临时复现用例；Python 直接调用服务函数；
> Tailwind 真实编译）。其余条目为「读代码 + 具体数值推演」。实现节点必须**先写回归测试再改代码**。
>
> 编号规则：沿用排查切片前缀，便于回溯证据——`EXV` 导出·视频合成、`EXO` 导出·叠加与失败上报、`ME` 手动剪辑外围、
> `TL2` 时间轴核心、`AG2` 剪辑 Agent、`AM2` AI 混剪、`AS2` AI 自动混剪。第 1 轮附录 A 条目在标题后注明原编号（BL-xx）。

---

## 评审记录

**评审方式**：按「可行性 / 完整性 / 一致性 / 规模适配」四个维度逐节审阅 v1，并回到基线 `a7f46c5` 源码核实关键前提（未改源码）。
严重度沿用 §2 定义。所有 P0 / P1 已在正文就地修复（正文以 **〔RV-xx〕** 标注）；P2 除 RV-17 记录不改外均已就地修复。

**已实测核实、成立的前提（后续节点无需重复）**：

- **S6 画布合成可行 *[实测，本机 ffmpeg 2025-05 git 构建]***：按 §3.2 规定的图形状（`color` 黑底 + 每段 `settb=AVTB,setpts=PTS+start/TB` +
  `overlay=0:0:eof_action=pass:format=auto`；段内 `concat` + `format=rgba,fade…:alpha=1,colorchannelmixer`）合成 64×36 lavfi 素材，7 例全部符合预期：
  EXV-01 底红 0–6 / 顶蓝 2–4 → t=1 (253,0,0)、t=3 (0,0,254)、t=5 (253,0,0)、时长 6.0；EXV-02 同轨红 0–2 / 蓝 4–6 → t=3 (0,0,0)、t=4.5 蓝、6.0；
  首段起点 3 s → t=1 黑、t=4 蓝、5.0；三段 dissolve 连续段 → 9.0 s、t=7.5 蓝；淡入 + 不透明度 0.5 → t=2 红 127；硬切 + dissolve 同段 → 编码成功（exit 0）；
  无任何 `-i` 的纯底图 → 2.0 s 黑。临时文件位于会话 scratchpad，未进入仓库。
- 其余：后端 `pydantic==2.11.7`（`Field(alias=…)` + `ConfigDict(populate_by_name=True)` 可用）；`ImagePosition.z_index` 现无别名（`video_models.py:100`）；
  `VideoCompositionRequest.video_items` 无最小长度约束，EXO-06 只需改路由校验（`video_router.py:158-163`）；`audio_models.py:68-69` 已有 `clip_start / clip_end`（ME-03 可行）；
  React 19.1（`inert` 布尔属性可用）、Electron 33；`shortcutOwnership.ts` 以 `[aria-modal="true"]` 判定模态（ME-04 加 `aria-modal` 即生效）；
  `reasonFromExternalUpdateId` 把 `agent-op*` → `agent`、`agent-undo*` → `agent-undo`（S9 允许名单不会误拦 Agent 写入）；`useAIMixedEditing.ts:338` 应用前已检查锁；
  `planScriptAutoMix` 的 `isPlayable` 保证视频时长 ≥ 0.1 s（`coverWithVideos` 上界有限）；`DEFAULT_OVERLAY_BASE_Z = 1_000_000`、字幕层在 `baseZ * 2`；
  §4.7 引用的 11 个既有后端测试文件均存在；`src/test/` 目录存在。

| # | 级别 | 维度 | 章节 | 问题 | 处置 |
|---|---|---|---|---|---|
| RV-01 | **P0** | 完整性 | §3.3 AG2-08 / §6.1 | **时间轴水合失败 → 自动保存永久抹掉时间轴**。`hydrateTimeline.ts:70-83` 捕获 `importFromData` 异常后以空时间轴打开；TimelinePanel 挂载即上报空状态（`TimelinePanel.tsx:311,345`）→ VEI 把 `currentTimelineState` 写回 `content.uiState`（`VideoEditingInterface.tsx:270-285`）→ 与水合基线不同 → 自动保存覆盖。AG2-08 修复前 Agent 负起点已经可能被卸载刷写落库，打开这些项目就会触发该链；v1 只防新增、不救存量。另：外部同步抛错 / 被锁拒绝后 VEI 仍持有被拒数据并被自动保存 | 已修：新增 `repairTimelineData` 修复可恢复条目后重试导入；仍失败时把原始数据备份到 `project_data.timelineRecoveryBackup` 并提示；外部同步抛错或拒绝后把 store 当前状态回写给所有者（§3.3 AG2-08 第 4、5 点，F78–F79、T62–T63） |
| RV-02 | P1 | 可行性 | §3.3 ME-08 | 服务异常退出对话框选「退出」→ `app.quit()` → `before-quit` 先 `stopChildren()`（`desktop/main/index.js:69-78,327`）→ 再触发窗口 `close` → 关闭守卫向已停止的服务刷写必然失败 → 再弹「部分修改尚未保存」；选「保持打开」后窗口留在服务已停止、`cleanupDone=true` 的僵死状态，与 R13 承诺相反。v1「菜单退出受保护」的前提也不成立（应用无菜单，退出路径只有 `index.js:56/66/76/327`） | 已修：`installCloseGuard` 增加 `shouldBypass: () => state.quitting`，退出流程已开始时不再请求刷写；更正路径说明；D4 增加用例 |
| RV-03 | P1 | 完整性 | §3.2 S9 / TL2-19 | S9 只在 action 层加锁，但 TimelinePanel 的复制（`:760-806`，`recordAction` + `state.importFromData` + `autoOrganize`）与整理素材（`:815-830`，`state.autoOrganize()`）直接调用 slice，不经任何 action，v1 却写「store / action 层拒绝」；T32 表驱动用例也未覆盖。另：JSON 导入 / 待处理时间轴数据以 `timeline-update` id 进入外部同步（`VideoEditingInterface.tsx:1726`）→ 原因 `import`，锁定时被静默拒绝，而 VEI 与 `timelineComposition` 已持有导入数据，预览 / 导出 / 保存与 store 分叉 | 已修：两处直接调用点加锁检查；外部同步在锁定且非 Agent 原因时提示并回写 store 状态；新增门禁 A17 钉住「slice 变更方法只在允许名单内被直接调用」 |
| RV-04 | P1 | 一致性 | §3.4 EXO-06 / §7.3 | v1 保留「视频轨长度 ≥ 音频轨长度」硬拦截（`useVideoExport.ts:97-106,166-182`），与 EXV-03 / ME-07「预览 = 导出」及走查第 7 条「10 s 视频 + 60 s BGM 预览与导出均为 60 s」直接矛盾——按 v1 实现该导出会被拒绝 | 已修（决策 D-12）：删除硬拦截，改为不阻断的黑尾提示 `blackTailNotice`；S5 新增 `computeVisualEnd`；删除 `videoTrackTooShort` 等无引用文案 |
| RV-05 | P1 | 可行性 / 健壮性 | §3.7 AG2-06 | `'finishing'` 让编辑锁依赖事件链排空；`runAfterQueuedEvents`（`useAgentExecution.ts:285-292`）只捕获拒绝，任何一个永不结束的环节都会让状态停在 `finishing`、时间轴永久锁定直至重载——这是本设计新引入的失败模式。另 `cancelExecution` 在 SSE 已结束时直接返回（`useAgentExecutionState.ts:293-296`），`finishing` 期间停止按钮点了无效 | 已修：`FINISHING_WATCHDOG_MS = 15000` 看门狗，超时记录错误、提示并解锁；`finishing` 期间停止按钮置灰并显示「正在应用最后的修改」 |
| RV-06 | P2 | 完整性 | §3.3 ME-08 | 关闭刷写等待在途保存，而在途保存可能正处于 5xx 重试的 3 s 等待中 → 超过 2.5 s 预算 → 误报「保存项目时出错」，用户选「仍然关闭」会丢掉本会成功的重试 | 已修：重试等待可提前结束，登记的刷写先跳过等待再保存最新内容 |
| RV-07 | P1 | 完整性 | §3.8 AS2-02 | Agent 路径的脚本段落 id 按下标生成且跨版本复用（`VideoEditingInterface.tsx:103,114,620` 均为 `agent-segment-${i}`）；重新生成脚本后旧版配音仍带相同 `segment_id`，v1 的「只保留在当前脚本中的 id」过滤不掉它们，新段尚未生成配音时 `keepNewest` 选中旧配音——AS2-02 在 Agent 脚本路径上未修复 | 已修：配音素材写入 `segment_text_hash`，规划时与当前段落文本的哈希比对，不一致即视为过期（旧素材无哈希时兼容保留）；新增 F80–F81、T56 用例 |
| RV-08 | P2 | 一致性 | §6.4 S7 | `degradedSubtitles` 把 ffmpeg stderr 原文（英文）拼进中文界面，违背 AM2-03「不把后端原文拼进界面」 | 已修：文案不含原因，原因只进日志 |
| RV-09 | P2 | 完整性 | §3.5 EXO-17 | 只改了字幕 enable；图片叠加 enable（`video_composition_service.py:2674`）仍为双闭区间 `between`，相邻图片边界帧仍同时显示 | 已修：图片叠加 enable 同样改为半开区间 |
| RV-10 | P2 | 一致性 | §3.5 EXO-02 | 预览新公式 `baseZ + zIndex * 1000 + index` 只有在 `zIndex < 1000` 时才低于字幕层（`baseZ * 2`）；`zIndex` 无上下界 | 已修：前后端都把 `zIndex` 钳制为 [0, 999] 整数 |
| RV-11 | P2 | 完整性 | §3.3 ME-01 | `repairDerivedMaterialIdentity` 判据「本地引用 ≠ url」会把「远程处理结果随后缓存到 `cached_materials/`」的合法缓存每次打开都剥掉 | 已修：`cached_materials/` 引用不修复 |
| RV-12 | P2 | 完整性 | §3.3 ME-02 | 先移除片段后删除素材；删除失败时片段已消失、素材仍在，用户不知道可撤销 | 已修：删除失败提示可按 Ctrl+Z 恢复片段 |
| RV-13 | P2 | 可行性 | §7.3 第 3 条 | 「结束 python 进程」会先触发主进程「服务异常退出」对话框（`index.js:312-329`），无法验证关闭提示 | 已修：改为 DevTools 网络请求拦截 |
| RV-14 | P2 | 一致性 | §3.6 ME-04 | 「T27 现有用例须保持通过」指第 1 轮 T27（`ConfirmationDialog` 焦点用例），与本轮 T27（`materialDeleteHelpers`）撞号 | 已修：改为明确的文件名 |
| RV-15 | P2 | 一致性 | §9 | 「统一 `feat:` 提交」与 CLAUDE.md 约定的 `[add]/[modify]/[update]/[refactor]/[fix]` 前缀不符 | 已修：按 CLAUDE.md 使用 `[fix]` 前缀 |
| RV-16 | P2 | 完整性 | §3.7 AG2-12 | `compactToolResult` 替换已存储的工具结果；若工具卡片从结果渲染缩略图，会出现 `src="[inline media omitted]"` 的破图 | 已修：实现节点须 grep 工具卡片渲染点，遇占位符显示通用图标 |
| RV-17 | P2 | 一致性 | §3.6 TL2-20 | 播放头按全部轨道的 `maxItemEnd` 钳制，而预览 / 导出终点为 S5 `renderEnd`（不含隐藏轨）；播放头可停在预览终点之后（黑屏） | 记录不改：属边界可用性，钳制目的（不越过时间轴内容）已达成；并入附录 A N-06 |
| RV-18 | P2 | 规模适配 | §9 | 66 项约为第 1 轮两倍；I-2 给出优先级但未说明延后时如何保持文档口径一致 | 已修：I-2 补充「延后须同步更新 §2 合计与附录 A」 |
| RV-19 | P2 | 完整性 | §3.3 ME-08 | 渲染进程 2.5 s 预算超时与「保存失败」共用同一文案，用户无法区分 | 已修：超时单独文案 `closeSaveSlowBody` |

**规模评估**：本轮 66 项、约 81 个前端文件 / 13 个后端文件 / 5 个桌面端文件，规模偏大但分组清晰、每组有独立门禁与回退顺序（I-2），
S6 已由探针证明可行，风险集中在 G4 / G5 的合成服务改动；不建议继续扩大范围，也无需削减——按 I-2 取舍即可。

---

## 0. 排查方式与基线

**排查方式**：6 路只读排查代理并行（导出·视频合成 / 导出·叠加音频与失败上报 / 时间轴核心 BL 复核 / 剪辑 Agent /
AI 混剪与自动混剪 / 手动剪辑外围），每条结论要求给出 HEAD 行号、复现数值、根因与修复设计；主线程随后**亲自读码复核**下列关键断言，
全部与排查结论一致：

1. `filtergraph_builder.py:262-275` 以 `tpad=start_duration` 定位上层轨、`:318-334` `overlay=0:0:format=auto`（默认 `eof_action=repeat`）；`:296-311` xfade offset 累计式多计一次过渡时长。
2. `video_composition_service.py:236-252` filtergraph 失败返回 `False`，`:1471-1475` 随即对**所有轨道**的归一化片段 `_concat_videos`。
3. `video_composition_service.py:1015-1040` 与 `useVideoExport.ts:333,645` 总时长为片段时长求和。
4. `useTimelineComposition.ts:207` 预览总时长 = `videoSequences.reduce(+duration)`；`VideoPlayerPanel.tsx:181-182,479` 仅在存在视频序列时进入合成预览。
5. `MaterialsPanel.tsx:1363-1380` 静音移除新素材 `...originalMaterial` 展开保留原 `cacheUrl / storageKey / metadata.localResolvedUrl`；`selectPlaybackUrl.ts:208-217` 先取 `metadata.localResolvedUrl`、`cacheUrl` 再取 `url`；`materialDeleteHelpers.ts:13` 删除键取 `storageKey`。
6. `useMaterialManagement.ts:209-259` 删除不检查时间轴引用，确认框文案硬编码中文。
7. `tools/addToTrack.ts:116` 起点无边界校验；`TimelinePanel.tsx:369-377` 外部同步直接调用 `replaceTimelineAction`，无 try/catch。
8. `messageConverter.ts:38-45,153-161` 只要历史中存在被停止的助手消息就注入「上一轮被停止」提示。
9. `desktop/main/windowControls.js:40-43` 关闭直接 `win.close()`；`window.js:129-138` close 事件只保存窗口尺寸；`useProjectAutosave.ts:114-123` 5xx 重试重发失败前捕获的 `payload`。
10. `TimelineAggregate.ts:247-268` `organizeVideoAudioTracks` 对**所有**未锁定 video/audio 轨（`image-track-*` 的 type 为 video，同样包含）按 startTime 排序后自 0 贴紧。
11. `mergeAiMixTimeline.ts:164-172` 只消除重叠、保留空隙，`:69` 新建轨道 `...source` 沿用后端轨道名；`planScriptAutoMix.ts:45,110-113,164-165` 每槽位独立取新、循环上限 20。
12. `replaceTimeline.ts:48` `importFromData(data)` 与 `TimelineAggregate.ts:602-613` `restore` 覆盖缩放 / 滚动 / 播放头；`dragSlice.ts:134` 仅 `committed && preview` 时发送 `COMMIT_COMPLETE`，resize 提交直调 `state.resizeItem`；`video_router.py:229,249-259` 状态兜底 `unknown` / `error`。

**实测环境与限制**：本机 OpenCV 二进制加载失败（`recursion is detected during loading of cv2 binary extensions`），
`VideoCompositionService` 无法整体导入；导出类实测以「直接加载 builder 文件 + 逐参数复制 `_normalize_video` /
`_compose_videos_filtergraph` / `_concat_videos` / 音频合流命令」完成，像素与时长均为真实 ffmpeg 输出。实现节点须在可导入
`cv2` 的环境运行 §7.2 A5（见风险 R14）。所有临时复现目录已删除，排查结束时 `git status --porcelain` 为空。

**基线（第 1 轮提交节点 RC.2 实测，`a7f46c5`）**：`tsc --noEmit` 0 error；`next lint` 8 个 error（均位于未触及文件）；
`vitest run` 231 个文件 / 2003 个用例 0 失败；第 1 轮后端门禁 140 passed；本轮排查复跑 `tests/test_ai_mixed_editing_hardening.py` 45 passed。

---

## 1. 概述

第 1 轮把「时间轴写入」这条主干修稳了：外部写入可撤销（S1）、历史同步捕获（S2）、快捷键归属（S3）、Agent 执行期编辑锁（S4），
并修复了 AI 混剪、自动混剪、Agent 撤销与重连的 32 个缺陷。第 1 轮明确把「以 FFmpeg 合成一致性为主、需要滤镜图重构与探针验证」
的问题留给本轮。本轮先在 `a7f46c5` 上逐条复核附录 A 的 33 个遗留项，再对第 1 轮新写的模块（`useAIMixedEditing`、
`mergeAiMixTimeline`、`planScriptAutoMix`、`trackPatch`、`replaceTimelineAction` 等）与此前未覆盖的手动剪辑外围
（素材派生与删除、字幕识别与编辑弹窗、图片叠加、预览时长、自动保存、拖拽状态机）做了系统排查，共确认 **93 个缺陷**。

最严重的四类问题：**数据丢失**——静音移除 / 去水印 / 视频切段得到的「新素材」其实仍指向原文件，删除它会删掉原片；删除正在使用的素材
不提示、片段残留且预览导出静默跳过；Agent `add_to_track` 负起点让时间轴 store 在 React effect 中抛错；关窗 0.8 秒内的编辑丢失。
**所见非所得**——多视频轨导出时上层轨在片段前变黑、结束后冻结遮挡下层；同轨空隙被压缩、视频轨上的图片让后续视频整体提前；
导出与预览的总时长都按片段时长求和；所有字幕用第一条的样式；图片不透明度与叠放顺序被忽略；「图片 + 配音」的时间轴既不能预览也不能导出。
**静默失败**——filtergraph 任一失败即把所有轨道串接成双倍时长的视频并报告成功；图片、字幕、单条音频失败被吞；Windows 下超过约 110 条字幕
命令行超长、字幕整体消失。**结果不稳定**——AI 方案与自动混剪的布局在「下一次无关编辑」时被整轨贴紧改写（图片跳到 0 秒、第 2 段起音画错位 18 秒）；
Agent 无法把片段移到最前且回报位置失真；S4 编辑锁只拦住了撤销/重做；快速甩动一次片段就让本会话内所有拖拽失效。

本轮以 **66 项**（全部 P0 / P1，以及与其共用代码路径、边际成本极低的 P2）为范围，并新增六个共享机制收敛同类问题：
**S5 渲染判定与时间轴终点单一来源**（预览与导出用同一套「哪些条目会被渲染、时间轴在哪结束」规则）；
**S6 导出画布合成**（黑色画布 + 每轨「连续片段段」按真实起点叠加，取代 tpad / xfade / 失败回退串接）；
**S7 合成降级上报**（任何未写入成片的图片、字幕、音频都以 `degradations` 返回并提示用户，导出不再「静默成功」）；
**S8 排布不变量「写入即稳定」**（所有外部写入者产出的布局必须是 `organizeVideoAudioTracks` 的不动点）；
**S9 编辑锁全覆盖**（S4 从 UI 层下沉到 store 层 + `inert`，并在事件链排空后才释放）；
**S10 素材身份与引用**（派生素材拥有独立存储身份；删除前检查时间轴引用；Agent 片段快照播放地址）。
交互层面继续遵循「破坏性操作先确认并说明后果、长任务结果可撤销、失败必可见且可读、全部文案双语、键盘与屏幕阅读器可达」。
其余 27 项（交互打磨与可访问性、可取消的后端任务、预览音量增益、分离音频功能补全、字幕排版一致性等）列入附录 A。

---

## 2. 缺陷清单（本轮范围，66 项）

严重度定义：**P0** = 用户数据丢失 / 时间轴损坏 / 渲染进程崩溃；**P1** = 用户可遇到的错误剪辑结果、导出与预览不一致或功能不可用；
**P2** = 边界场景 / 可用性 / 当前 UI 不可达但数据可达的缺陷 / 可访问性。

### 2.1 数据安全（DS，4 项）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| ME-01 | P0 | 静音移除 / 去水印 / 视频切段得到的素材仍指向原文件：预览与导出播放原片，删除该素材会删除原文件 *[实测]* | `MaterialsPanel.tsx:1317-1334,1363-1380`；`VideoEditingInterface.tsx:1350-1351,1411-1428`；`lib/selectPlaybackUrl.ts:208-217,248-250`；`materialManagement/materialDeleteHelpers.ts:13` |
| ME-02 | P0 | 删除时间轴正在使用的素材：不提示引用、删除源文件，片段残留在轨道上而预览 / 导出静默跳过，不可恢复 *[实测]* | `hooks/useMaterialManagement.ts:209-259`；`timeline/infrastructure/CompositionAdapter.ts:143,235`；`hooks/useVideoExport.ts:228-229,506-526` |
| AG2-08 | P0 | `add_to_track` 接受负起点；随后时间轴 store 在 React effect 中抛 `TimePosition: value must be >= 0`，无错误边界 *[实测]* | `tools/addToTrack.ts:116`；`domain/value-objects/TimePosition.ts:25-26`；`TimelinePanel.tsx:369-377`；`projects/hydrateTimeline.ts:70-83` |
| ME-08 | P1 | 关闭窗口不刷写自动保存（800 ms 防抖内的编辑丢失）；5xx 重试以失败前的旧载荷覆盖之后更新的保存 *[实测：重试顺序 v1→v2→v1]* | `projects/hooks/useProjectAutosave.ts:114-123,139-209`；`desktop/main/windowControls.js:40-43`；`desktop/main/window.js:129-138`；`desktop/main/index.js:65-78` |

### 2.2 导出与预览 · 画面合成（EXV，12 项）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| EXV-01（BL-01） | P1 | 多视频轨导出：上层轨在其片段开始前为黑、结束后冻结末帧，遮挡下层轨 *[实测：底红 0–6 s、顶蓝 2–4 s → t=1 黑、t=5 蓝]* | `composition/filtergraph_builder.py:262-275,318-334` |
| EXV-02（BL-02） | P1 | 同轨空隙与首段前空隙在导出中被压缩，后续片段整体提前、与其自带音频错位 *[实测：红 0–2、蓝 4–6 → 4.0 s，t=3 蓝]* | `video_composition_service.py:256-289,1471-1475`；`filtergraph_builder.py:271,312-314` |
| EXV-03（BL-03） | P1 | 导出总时长 = 片段时长之和而非时间轴终点：叠加轨时音频按 8 s 截取、视频 6 s，尾部 2 s 冻结 / 缺画 *[实测]* | `video_composition_service.py:1015-1040,1490,2154,2174,2323`；`useVideoExport.ts:333,645` |
| EXV-04（BL-04） | P2 | 连续 dissolve 的 xfade offset 累计错误：3 段 9 s 输出 5 s，第三段消失 *[实测；当前 UI 无法创建转场，仅导入 / 旧项目可达]* | `filtergraph_builder.py:296-311` |
| EXV-05（BL-05） | P2 | 底层 / 单轨片段的淡入淡出与不透明度在 yuv420p 导出中无效（alpha 被丢弃） *[实测；UI 不可达]* | `filtergraph_builder.py:171-182,325-328`；`composition/encode.py:107` |
| EXV-06 | P2 | 同轨「硬切 + dissolve」：concat 输出时间基 1/1000000 与 xfade 第二输入 1/15360 不一致，ffmpeg 配置失败 *[实测 exit −22；UI 不可达]* | `filtergraph_builder.py:307-313` |
| EXV-07 | P1 | filtergraph 任一失败即回退为「所有轨道片段首尾串接」：6 s 时间轴输出 12 s，透明度与转场丢失，任务仍报告成功 *[实测]* | `video_composition_service.py:247-252,1471-1475,1659-1667` |
| EXV-08 | P2 | 仅前一片段带 dissolve（另一侧无转场）时在硬切处生成 `xfade duration=0`，下一片段被丢弃 *[实测；UI 不可达]* | `filtergraph_builder.py:188-193,302-305` |
| EXV-09 | P1 | 视频轨上的图片在导出时被移出 `video_items` 留下空洞：后续视频整体提前、图片盖到错误片段、视频流比时间轴短 *[实测：时间偏移]* | `useVideoExport.ts:231-298`；`video_composition_service.py:2672-2675,2779,2868` |
| EXV-10 | P2 | 归一化 `-t d -r 30` 按整帧向上取整，串接后逐段累计漂移（7 段 +0.105 s，100 段约 1.5 s） *[实测]* | `video_composition_service.py:770-778` |
| EXO-06（BL-09） | P2 | 「图片 + 音频」时间轴无法导出（`video_items` 必须非空、总时长 0）；纯音频时间轴提示「视频轨道长度不足」误导 | `useVideoExport.ts:97-106,168-178,191,333`；`src/lib/api/videoComposition.ts:236-248`；`video_router.py:158-163`；`video_models.py:521` |
| ME-07 | P1 | 预览总时长 = 视频片段时长之和，且仅在存在视频片段时进入合成预览：图片 + 配音无法预览、10 s 视频 + 60 s BGM 预览停在 10 s、叠加轨预览超出终点 *[实测]* | `hooks/useTimelineComposition.ts:207,244`；`VideoPlayerPanel/VideoPlayerPanel.tsx:181-182,479`；`playback/MultiTrackPlaybackEngine.ts:323-329` |

### 2.3 导出 · 字幕 / 图片 / 音频 / 失败上报（EXO，12 项）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| EXO-01（BL-06） | P1 | 所有导出字幕使用第一条字幕的字号 / 颜色 / 背景 / 位置；空文本字幕以条目名（如「字幕 1」）烧录 *[实测]* | `video_composition_service.py:2430-2446,2721-2728`；`useVideoExport.ts:481`；`CompositionAdapter.ts:290-292` |
| EXO-02（BL-07） | P1 | 图片不透明度从不渲染（`opacity \|\| 1.0` 还把 0 变 1），`zIndex` 被 Pydantic 丢弃、叠放按开始时间 *[实测：50% 红图导出 (252,0,0)]* | `useVideoExport.ts:287,533`；`composition/camera_motion.py:1271-1282`；`app/models/video_models.py:94-101`；`playback/internal/assembleLayers.ts:193-195` |
| EXO-03（BL-08） | P1 | 图片 / 字幕 / 单条音频 / 视频原声处理失败被吞，任务 `completed` 且 `warnings=[]` *[实测：缺失图片与音频的端到端导出]* | `video_composition_service.py:1599-1614,1631-1650,1996-2043,2258-2277,2545-2556` |
| EXO-04 | P1 | 任一本地图片不存在即抛出 `FileNotFoundError`，整批图片叠加全部丢弃（跳过分支不可达） *[实测]* | `video_composition_service.py:1908-1910,2592-2601,2821-2823,2911-2913` |
| EXO-05 | P1 | Windows 下约 110 条以上字幕时 drawtext 参数使命令行超过 32767 字符（WinError 206），字幕整体消失 *[实测：110 条 41821 字符]* | `subtitle_service.py:650-660,751-777`；`video_composition_service.py:239,2321,2776-2781,2865-2870` |
| EXO-08（BL-31） | P2 | 状态接口兜底返回 `unknown` / `error`，前端只在 `failed` 时终止，轮询到 300 次上限；TS 状态类型不含 `error` | `video_router.py:229,249-259`；`videoComposition.ts:185,202,388-397` |
| EXO-10 | P2 | 未设置背景的字幕导出带 `#000000@0.5` 半透明黑框（预览无框） *[实测]* | `video_composition_service.py:2444-2446,2727-2728`；`useVideoExport.ts:460`；`playback/SubtitleLayer.ts:57-60` |
| EXO-11 | P2 | 字幕文本中空行之后的内容在导出中丢失（SRT 解析按空行切块、丢弃不足 3 行的块） *[实测]* | `composition/subtitle_prep.py:158-162`；`subtitle_service.py:104-110` |
| EXO-13 | P2 | 媒体解析 / 归一化失败时整体覆盖状态字典（丢 `task_id / start_time / warnings`）、不清理临时目录；缺失归一化索引时状态停在 `processing` *[实测]* | `video_composition_service.py:1272-1277,1313-1321,1432-1437,1581,1618,2536` |
| EXO-16 | P1 | 字幕单独烧录路径固定 `timeout=300`，长视频超时后返回 None → 「continuing without subtitles」 | `subtitle_service.py:976-997`；`video_composition_service.py:1646-1647,2508-2510` |
| EXO-17 | P2 | 相邻字幕 / 图片在边界帧同时显示：导出 `between(t,s,e)` 双闭区间，预览字幕闭区间、图片半开区间 | `subtitle_service.py:772`；`video_composition_service.py:2674`；`playback/SubtitleLayer.ts:94`；`playback/ImageOverlayLayer.ts:117` |
| EXO-18 | P2 | 图片路径对 http(s) URL 仍 `requests.get` 下载（跟随重定向、无大小上限），绕过本地导出策略 | `video_composition_service.py:1914-1927`；`composition/media_download.py` |

### 2.4 手动剪辑（ME / TL2，16 项）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| ME-03 | P1 | 按 S 识别字幕忽略片段裁剪区间（整文件转写、只按片段起点平移），且包含静音 / 隐藏轨 *[实测：源 10–14 s 的片段得到 intro+kept 两条错位字幕]* | `app/services/audio_transcription_service.py:659-770`；`TimelinePanel.tsx:925-988` |
| ME-04 | P1 | 字幕编辑弹窗不是模态（无 `role="dialog" aria-modal`）：弹窗内按 Delete 删除背后选中片段、空格播放、S 打开替换确认；全部文案硬编码中文 *[实测]* | `components/SubtitleEditModal/SubtitleEditModal.tsx:19-91,220,356-368`；`timeline/shortcutOwnership.ts`；`TimelinePanel.tsx:596,1181-1194` |
| ME-05 | P1 | 图片叠加拖动只在点 ✓ 时写入 store：导出 / 自动保存读到未入库位置，下一次时间轴编辑把位置冲回、且不可撤销 | `VideoEditingInterface.tsx:1842-1876`；`VideoPlayerPanel.tsx:325-341,503,549`；`ImageOverlay.tsx:95-105,316-335` |
| ME-09 | P2 | 切分只拒绝距边缘 1 ms 内的切点（可切出 1.5 ms 碎片）；切分 `clipEnd=0` 的图片得到 `clipStart 2 / clipEnd 0` 反向区间 *[实测]* | `domain/services/SplitService.ts:36-40,67`；`store/actions/splitItem.ts:22-26`；`ClipTimeMapping.ts:39` |
| ME-10 | P2 | 从素材面板拖到轨道：片段丢失 `serverUrl/cacheUrl/storageKey/metadata/sentenceSegments`（与「添加到时间轴」不一致）；`dragenter` 中 `getData` 恒为空，拖放高亮与提示永不出现；锁定 / 不兼容轨静默无效（合并 TL2-21） | `timeline/Track.tsx:101-163,562-630`；`TimelinePanel.tsx:640-683`；`ItemPlacementService.ts:34-48` |
| TL2-02（BL-16） | P1 | 拖动左边缘裁剪不平移运镜窗口（拖拽提交绕过 `resizeItemAction`） *[实测：clipStart 1、startOffset 仍 0]* | `store/slices/dragSlice.ts:197-208`；`store/actions/resizeItem.ts:39-48` |
| TL2-03（BL-17） | P2 | 撤销 / 重做后选区保留已不存在的 id，工具栏显示「已选 1」而画面上无选中片段（第 1 轮 TL-07 已消除「Delete 清空重做栈」部分） *[实测]* | `store/slices/historySlice.ts:105-129`；`TimelineToolbar.tsx:56,405-414` |
| TL2-04（BL-18） | P1 | 撤销 / 重做与外部整表写入把缩放、滚动、播放头复位（3 / 2000 / 4 → 1 / 0 / 0），DOM 仍滚动在 2000 px，标尺点击跳到错误时间、可见区刻度空白 *[实测]* | `domain/aggregates/TimelineAggregate.ts:602-613`；`store/slices/timelineSlice.ts:547-551,561-585`；`store/actions/replaceTimeline.ts:48`；`TimelineRuler.tsx:103,199-204` |
| TL2-06（BL-20） | P1 | 宽度 ≤16 px 的片段任意位置都进入裁剪、无法移动（10% 缩放下 <3.2 s 的片段全部拖不动）；8 px 边缘热区无光标反馈 *[实测]* | `domain/machines/dragMachine.ts:24,42-53`；`TimelineItem.tsx:253-270,705-716` |
| TL2-09（BL-23） | P2 | 时间显示浮点误差丢 0.01 秒（2.3 → `0:02.29`，4.35 → `0:04.34`） *[实测]* | `timeline/timeFormat.ts:15` |
| TL2-16 | P1 | 越过拖拽阈值的那一次移动不计算预览，随即松手 → 状态机停在 `committed` 且不再接受 `ESCAPE`；本会话内所有片段拖拽失效 *[实测]* | `dragMachine.ts:434-442,484-487,522-524,580-587`；`dragSlice.ts:134,216`；`TimelinePanel.tsx:396-415` |
| TL2-17 | P2 | 纯垂直拖动片段到另一轨无效（阈值与移动事件只看 `deltaX`） *[实测]* | `dragMachine.ts:132-145,306-310`；`TimelinePanel.tsx:408-414` |
| TL2-18 | P2 | 拖拽进行中仍接受撤销 / 重做 / 删除：撤销后松手，历史只剩 `MOVE_ITEM`、被撤销的添加永远无法重做 *[实测]* | `TimelinePanel.tsx:591-631`；`historySlice.ts:105-129`；`dragSlice.ts:160-196`；`timelineSlice.ts:258-263` |
| TL2-19 | P1 | S4 编辑锁有缺口：store 层只拦截撤销 / 重做（锁定时 `removeItemsAction`、`addItemAction` 仍成功）；素材面板「添加到时间轴」、图片叠加确认 / 拖动、工具栏整理与导入、轨道头键盘操作、执行前已打开的运镜 / 字幕弹窗都能在 Agent 执行中改写时间轴（合并 AG2-19） *[实测：store]* | `historySlice.ts:107,120`；`VideoEditingInterface.tsx:1204-1245,1873-1876,2329-2332`；`TimelineToolbar.tsx:107-120,196-206`；`Track.tsx:182-224`；`TrackContainer.tsx:437-493`；`store/actions/updateItemFields.ts:54-66`；`ui/Modal.tsx:69` |
| TL2-20 | P2 | 删除片段使时间轴变短后播放头停在终点之外（ruler `aria-valuenow` 8 > `aria-valuemax` 0） *[实测]* | `TimelineAggregate.ts:559-571,661-663`；`timelineSlice.ts:482-492`；`TimelineRuler.tsx:408-411` |
| TL2-23 | P2 | 锁定轨整条 `pointer-events: none`：片段无法点选、工具提示与 `not-allowed` 光标永不出现，与 `TimelineItem` 注释「锁定轨保留点选」矛盾 | `timeline/Track.tsx:567,632`；`TimelineItem.tsx:237-245` |

### 2.5 剪辑 Agent（AG2，11 项）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| AG2-01（BL-11） | P1 | `move_clip` / `add_to_track` 回报请求位置而非重排后的实际位置；同起点时被移动 / 新增的片段总排在已有片段之后，无法移到最前 *[实测：C→0 实际落在 5]* | `tools/moveClip.ts:64-70`；`tools/addToTrack.ts:148-156`；`reconcile.ts:90-105`；`OperationApplier.ts:563-566`；`agent.ts:398-401` |
| AG2-02（BL-12） | P2 | 客户端对不存在的片段 / 轨道静默 no-op 而工具卡片显示成功；`move_clip` 到不存在的轨道先 `splice` 再查找目标 → 片段被删除 *[实测]* | `OperationApplier.ts:121-161,474-488,556-567`；`agent.ts:403-409` |
| AG2-06（BL-30） | P2 | SSE 结束即置 `completed`，早于事件链排空：S4 锁提前释放、发送按钮提前可用，下一轮以缺少排队操作的时间轴起步，其补丁吞并上一轮改动 | `useAgentExecutionState.ts:258-266,296-304`；`useAgentExecution.ts:235-236,365-375,430-471`；`VideoEditingInterface.tsx:2101-2105` |
| AG2-07（BL-32） | P2 | 执行中卸载只取消与销毁、不经 `sealMessage`：该轮无 `timelineTrackPatches`，最后一次 rAF 批量更新丢失 | `useAgentExecution.ts:689-705`；`AgentStateManager.ts:339-342`；`VideoChatWindow/timeline/utils.ts:217,226` |
| AG2-09 | P1 | `auto_fix_overlaps` 重排所有可重排轨道（含无重叠的旁白轨），旁白从 3 s 移到 0 s 而字幕留在 3 s *[实测]* | `tools/autoFixOverlaps.ts:45,56-59`；`reconcile.ts:208-227` |
| AG2-10 | P1 | Agent 执行中「撤销本轮 / 单步撤销」按钮仍可用：本地回退而服务端继续按旧状态下发，后续操作落空或删除片段，本轮补丁反向包含回退 | `VideoChatWindow.tsx:149-168`；`timeline/AgentResponseNode.tsx:132-190`；`useAgentExecution.ts:551-633` |
| AG2-11 | P1 | 任一轮被停止后，之后每一次请求都在末尾附加「上一轮被用户停止、不要重跑工具」系统提示 *[实测]* | `messageConverter.ts:38-45,153-161`；`__tests__/messageConverter.cancelled.test.ts:62` |
| AG2-12 | P1 | 上传素材的 `data:` 内联缩略图进入工具结果、模型上下文与项目自动保存（单个 60 KB 缩略图序列化 60138 字符；10 个素材一次 `list_materials` ≈ 600 KB，之后每轮重放） *[实测]* | `tools/index.ts:201`；`tools/listMaterials.ts:36`；`tools/searchMaterials.ts:42`；`AgentStateManager.ts:119-123`；`messageConverter.ts:111-114`；`useAgentExecution.ts:469`；`src/lib/api/videoProjects.ts:252-290` |
| AG2-14 | P1 | `compose_storyboard` 不做轨道类型校验：音频素材落到 `video-track-1` 仍 `success:true`；全部跳过时服务端残留客户端从未收到的自动建轨 *[实测]* | `tools/composeStoryboard.ts:66-82,96-130` |
| AG2-15 | P1 | `trim_clip` 出点推导 `clipEnd ?? duration`：拉长到 20 s 的图片 `trim {clipStart:1}` 变成 4 s 且报成功；无 clipEnd 的旧片段裁到错误出点 *[实测]* | `tools/trimClip.ts:32-42`；`tools/resizeClip.ts:60`；`tools/addToTrack.ts:117-127` |
| AG2-16 | P1 | `remove_material` 描述称「不影响时间轴上的片段」，实际移除后 Agent 片段（无 url 快照）在预览、图片叠加与音频导出中全部失效，且无法撤销 | `tools/removeMaterial.ts:15,29-43`；`AgentEventRouter.ts:226-228`；`OperationApplier.ts:510-528`；`useVideoExport.ts:503-525` |

### 2.6 AI 混剪 / 自动混剪（AM2 / AS2，11 项）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| AS2-01 | P1 | 某段先匹配 3 个视频、再重新匹配 1 个：旧匹配的第 2、3 槽位视频仍参与自动混剪 *[实测：得到 v4,v2,v3]* | `ScriptPanel.tsx:731-765`；`lib/aiMix/planScriptAutoMix.ts:84-90,110-113` |
| AS2-02 | P1 | 自动混剪不参照当前脚本：已删除段落与重新生成前旧脚本的配音 / 视频按 `segment_number` 与新脚本交错上轨 *[实测：old-a, new-x, old-b, new-y]* | `ScriptPanel.tsx:1863-1897`；`hooks/useScriptGeneration.ts:352-368`；`VideoEditingInterface.tsx:1936`；`planScriptAutoMix.ts:83,93-94` |
| AS2-03 | P1 | 视频不足以覆盖长配音时视频道留下空洞（循环上限 20、段末 <0.1 s 余量），下一次无关编辑整轨贴紧后第 2 段起视频提前 18 s *[实测]* | `planScriptAutoMix.ts:43-45,155-173`；`store/actions/applyScriptAutoMix.ts:136`；`TimelineAggregate.ts:247-268` |
| AS2-04 | P2 | 替换确认框应用的是点击按钮时计算的排布：确认框打开期间完成的 TTS / 匹配被忽略，旧版本配音上轨 | `VideoEditingInterface.tsx:1926-1955`；`ScriptPanel.tsx:1541` |
| AM2-01 | P1 | AI 方案保留空隙（提示词示例本身即含空隙），下一次无关编辑触发整轨贴紧：`image_001` 从 55.5 s 跳到 0 s 盖住首段视频，`audio_002` 60 → 55.5 s *[实测]* | `lib/aiMix/mergeAiMixTimeline.ts:163-172`；`TimelineAggregate.ts:247-268`；`app/services/ai_mixed_editing_service.py:137-178` |
| AM2-02 | P2 | 音频段 `track` 字段不校验：`"video-track-1"` 使解析结果轨道 ID 重复、整单在规划之后失败；`"bgm"` 在前端回退为音频轨 1，与旁白压扁到同一轨；`null / 2` 触发一次 120 s 修复轮 *[实测]* | `app/models/ai_mixed_editing_models.py:101`；`timeline_parser_service.py:247,398-412`；`mergeAiMixTimeline.ts:72-75` |
| AM2-03 | P2 | `AI_MIX_INTERNAL / BACKEND_UNREACHABLE / BACKEND_TIMEOUT / VALIDATION_ERROR` 与导入阶段 `HTTP_400` 在中文界面显示英文原文或 Python dict；`timeline-import` BFF 默认 60 s 超时短于客户端 300 s *[实测]* | `hooks/useAIMixedEditing.ts:141-146`；`app/routers/timeline_import_router.py:140-148`；`src/lib/api/server/backend-proxy.ts:117,268-283`；`src/app/api/timeline-import/route.ts:5` |
| AM2-05 | P2 | 批量视频解析固定 120 s 超时（BFF 允许 600 s），超时后只 `console.warn`，方案在无解析信息时生成且用户无提示 | `utils/parallelVideoAnalysis.ts:10,183-188,605-616`；`useAIMixedEditing.ts:272-285`；`src/app/api/video/batch-analyze/route.ts:4` |
| AM2-06 | P2 | 提示词示例违反自身「视频轨最长」要求（视频止于 55.5 s、音频止于 90.5 s），sanitize 不告警 → 30 s 黑屏 *[实测]* | `ai_mixed_editing_service.py:137-178,426-430` |
| AM2-07 | P2 | 同道重叠后移后又按模型给出的 `total_duration` 二次裁剪，旁白尾部 5 s 被截掉 *[实测]* | `app/services/timeline_parser_service.py:800-846,625-627` |
| AM2-08 | P2 | 合并新建的轨道沿用后端硬编码英文名（"Image Track" / "Audio Track bgm"），中文界面轨道头显示英文 | `mergeAiMixTimeline.ts:63-70`；`timeline_parser_service.py:353,367,385,402`；`timeline/trackDisplayName.ts:24` |

合计：DS 4 + EXV 12 + EXO 12 + 手动剪辑 16 + Agent 11 + AI 11 = **66**（P0×3 / P1×33 / P2×30）。

---

## 3. 技术设计

### 3.1 现状链路与问题定位

```
[导出 · 现状]
VideoPlayerPanel「导出」→ useVideoExport.handleExport
  ├─ validateVideoExport：视频轨长度 ≥ 音频轨长度（图片计入视频）            ← EXO-06
  ├─ 构建 video_items：视频轨上的图片被移入 image_items，留下空洞            ← EXV-09
  ├─ subtitle_items：text || name；背景兜底 '#000000@0.5'                    ← EXO-01 / EXO-10
  ├─ image_items：opacity || 1.0；按 start_time 排序；zIndex 字段名 camelCase ← EXO-02
  ├─ total_duration = Σ clippedDuration                                      ← EXV-03
  └─ videoComposition.composeVideo：video_items 必须非空                     ← EXO-06
        FastAPI _compose_video_sync
          ├─ actual_total_duration = Σ(clip_end − clip_start)               ← EXV-03
          ├─ _normalize_video：-t d -r 30（整帧向上取整）                   ← EXV-10
          ├─ build_filtergraph：tpad 定位 / overlay(repeat) / concat / xfade ← EXV-01/02/04/05/06/08
          │     └─ 失败或单轨 → _concat_videos(全部归一化片段)               ← EXV-02/07
          ├─ 音频：-t actual_total_duration；逐条失败 continue                ← EXV-03 / EXO-03
          ├─ 图片：任一解析异常整批丢弃；http 直接下载；无 alpha / 无 z 序    ← EXO-04/18/02
          ├─ 字幕：first_subtitle 样式；SRT 往返丢空行后文本；argv 超长；300 s ← EXO-01/11/05/16
          └─ status=completed，warnings 不含上述失败；失败路径覆盖状态、不清理 ← EXO-03/13
  pollCompositionStatus：只在 failed 时终止                                   ← EXO-08

[预览 · 现状]
useTimelineComposition.rebuildCompositionPlayback
  ├─ totalCompositionDuration = Σ videoSequences.duration                    ← ME-07
  └─ isCompositionMode = videoSequences.length > 0 → 否则显示占位、空格无效  ← ME-07

[时间轴排布不变量 · 现状]
每次结构性编辑 → autoOrganize → organizeVideoAudioTracks：
  所有未锁定 video/audio 轨（含 image-track-*）按 startTime 排序并自 0 贴紧（「磁性」时间轴）
外部写入者若产出的不是该操作的不动点，布局就会在「下一次无关编辑」时被改写：
  AI 混剪 merge / 后端 sanitize 保留空隙                                      ← AM2-01 / AM2-06
  自动混剪覆盖不足留洞                                                        ← AS2-03
  Agent reconcile：同起点时被操作片段排在已有片段之后                         ← AG2-01

[编辑锁 · 现状（第 1 轮 S4）]
agent.agentIsExecuting（executing | retrying）→ uiSlice.externalEditLock = 'agent'
  已拦截：store 撤销 / 重做；时间轴键盘改写快捷键；工具栏撤销 / 删除 / 剪切 / 字幕；时间轴区域指针遮罩
  未拦截：其余全部 store 编辑 action；素材面板「添加到时间轴」；图片叠加；工具栏整理 / 导入；
          轨道头与添加轨道（键盘可达）；执行前已打开的弹窗；Agent 自身的撤销按钮      ← TL2-19 / AG2-10
  释放时机：SSE 结束即释放，早于事件链排空                                           ← AG2-06
```

### 3.2 共享机制（先落地，后续条目依赖）

#### S5 渲染判定与时间轴终点单一来源

**问题**：「哪些条目会进入成片」与「时间轴在哪结束」目前有四套口径——导出构建循环的私有谓词 `isTrackExported`
（`useVideoExport.ts:30`）、导出总时长求和（`:333`）、预览求和（`useTimelineComposition.ts:207`）、store 的
`calculateTotalDuration`（所有轨道含隐藏 / 静音 / 空字幕，`TimelineAggregate.ts:559-571`）。口径不一直接导致
EXV-03、EXV-09、EXO-06、ME-07。

**设计**：新增纯函数模块 `src/components/video/timeline/infrastructure/renderableTimeline.ts`（无 React、无 store）：

```ts
import type { MaterialItem, TimelineItem, Track } from '@/types';

export type RenderSpanKind = 'video' | 'image' | 'audio' | 'subtitle';

export interface RenderSpan {
  itemId: string;
  trackId: string;
  kind: RenderSpanKind;
  start: number; // seconds
  end: number;   // seconds, > start
}

/** 锁定只防编辑（第 1 轮 EX-02）：隐藏轨不渲染；静音只对音频轨生效。 */
export function isTrackRendered(track: Pick<Track, 'type' | 'isVisible' | 'isMuted'>): boolean {
  if (track.isVisible === false) return false;
  return !(track.type === 'audio' && track.isMuted === true);
}

export function collectRenderSpans(
  tracks: readonly Track[],
  materialsById: ReadonlyMap<string, Pick<MaterialItem, 'id' | 'type'>>,
): RenderSpan[];

/** 最晚的渲染条目结束时间；没有可渲染条目时为 0。 */
export function computeRenderEnd(spans: readonly RenderSpan[]): number;

/** 是否存在可见画面（视频或图片）。导出以此判定「有无可导出的画面」。 */
export function hasVisualSpan(spans: readonly RenderSpan[]): boolean;

/** 〔RV-04〕最晚的视频 / 图片条目结束时间；无画面条目时为 0。导出用于计算黑尾长度并提示。 */
export function computeVisualEnd(spans: readonly RenderSpan[]): number;
```

`collectRenderSpans` 规则（逐条，任一不满足即跳过该条目）：

1. `isTrackRendered(track)` 为真；`Number.isFinite(item.startTime) && item.startTime >= 0`；`Number.isFinite(item.duration) && item.duration > 0`。
2. 字幕轨：`typeof item.text === 'string' && item.text.trim() !== ''` → `kind: 'subtitle'`（与 `CompositionAdapter.ts:290-292` 的预览跳过规则一致）。
3. 视频轨：`material = materialsById.get(item.materialId)`；无素材跳过（ME-02 的导出前置检查负责提示）；
   `item.originalMaterialType === 'image' || material.type === 'image'` → `'image'`；`material.type === 'video'` → `'video'`；其他跳过。
4. 音频轨：有素材即 `'audio'`（分离出的音频条目引用视频素材 id，同样计入）。

**消费方**（全部改为调用本模块，删除各自的私有口径）：

| 消费方 | 改动 |
|---|---|
| `useVideoExport.ts` | 删除私有 `isTrackExported`，改为导入 `isTrackRendered`（`calculateVideoTrackDuration / calculateAudioTrackDuration / 构建循环 / expectedAudioItemCount` 四处同一谓词，保留第 1 轮 IM-12 / IM-13 的行为）；请求体 `total_duration = computeRenderEnd(collectRenderSpans(...))`；删除 `actualTotalDuration` 累加（日志改记 `renderEnd`） |
| `useTimelineComposition.ts` | `rebuildCompositionPlayback`：`totalDuration = computeRenderEnd(spans)`；`isCompositionMode = spans.length > 0`；`computeCompositionSignature` 追加 `spans` 中 image 条目的 `id:start:end` 与 `totalDuration`（图片增删改需要触发重建） |
| `VideoPlayerPanel.tsx:181-182,479` | `playbackMode = compositionPlayback?.isCompositionMode ? 'composition' : 'preview'`；渲染条件去掉 `videoSequences.length > 0` |
| 后端 `_compose_video_sync` | 以 `_timeline_end(request)`（video / image / audio / subtitle 条目 `start_time + duration` 的最大值）与 `request.total_duration` 取大，作为画布时长与音频 `-t`（见 S6） |

**不变量**：同一时间轴，预览 `totalCompositionDuration` 与导出请求 `total_duration` 相等（T 用例以同一 fixture 同时断言）。

#### S6 导出画布合成（Canvas Compositor）

**问题**：现有 builder 以「每轨先 concat / xfade 成一条流 → `tpad` 平移到首段起点 → 轨间 `overlay`（默认 `eof_action=repeat`）」合成，
并在单轨时退回「concat 演示器」路径。这条链同时造成 EXV-01（tpad 黑 + 冻结末帧）、EXV-02 / EXV-09（concat 忽略 start_time）、
EXV-04 / EXV-06 / EXV-08（xfade 语义与时间基）、EXV-05（无底图可混合，alpha 被丢弃），失败时再退回全部串接（EXV-07）。

**设计**：黑色画布 + 每轨「连续片段段（run）」按真实起点叠加。磁性时间轴下主视频轨通常是一个从 0 开始的连续段，
因此滤镜数量与现状同阶（输入个数不变，仍是每个归一化片段一个 `-i`）。

`app/services/composition/filtergraph_builder.py` 重写（保留 `TIME_EPSILON`、`ClipLike`、`TrackPlan`、`group_tracks`、`_clamp01`、
`_effective_transition_duration`；删除 `_position_track`、`_compose_track`、`_has_dissolve`、`_overlay_tracks`、`_track_needs_filtergraph`）：

```python
@dataclass(frozen=True)
class FiltergraphResult:
    can_use_concat: bool
    filter_complex: str
    output_label: str
    video_inputs: List[str]
    timeline_end: float          # 新增：画布时长（秒）


def build_filtergraph(
    clips: List[ClipLike],
    width: int,
    height: int,
    pre_trimmed: bool = False,
    fps: int = 30,
    timeline_end: Optional[float] = None,
) -> FiltergraphResult:
    visible = [c for c in clips if _clamp01(c.opacity) > TIME_EPSILON]      # 不透明度 0 的片段不作为输入
    last_end = max((c.start_time + c.duration for c in visible), default=0.0)
    end = max(last_end, timeline_end or 0.0)
    plans = group_tracks(visible)
    tolerance = 0.5 / fps                                                     # 半帧
    if _is_plain_contiguous_single_track(plans, end, tolerance):
        return FiltergraphResult(True, "", "", [c.id for c in visible], end)
    parts: List[str] = []
    inputs: List[str] = []
    run_labels: List[str] = []
    for plan in plans:                                                        # 自下而上（z 升序）
        for run in _contiguous_runs(plan.clips, tolerance):
            needs_alpha = any(_needs_alpha(c) for c in run)                   # 一个段内格式必须一致
            clip_labels = [
                _append_clip_chain(parts, len(inputs) + k, clip, width, height, pre_trimmed, needs_alpha)
                for k, clip in enumerate(run)
            ]
            inputs.extend(c.id for c in run)
            run_labels.append(_append_run_placement(parts, clip_labels, run[0].start_time, len(run_labels)))
    base = f"color=c=black:s={width}x{height}:r={fps}:d={end:.6f},format=yuv420p[base]"
    graph = ";".join([base, *parts, *_overlay_runs_on_base(run_labels)])
    return FiltergraphResult(False, graph, "[vout]", inputs, end)
```

私有函数精确语义：

| 函数 | 语义 |
|---|---|
| `_needs_alpha(clip)` | `_clamp01(opacity) < 1 − ε`，或 `transition_in` / `transition_out`（`fade` 与 `dissolve` 同等处理）有效时长 > ε |
| `_is_plain_contiguous_single_track(plans, end, tol)` | `len(plans) == 1` 且无片段 `_needs_alpha`，且首段 `start_time ≤ tol`，且相邻 `abs(start_k − end_{k−1}) ≤ tol`，且 `end − last_end ≤ tol` |
| `_contiguous_runs(clips, tol)` | 按 `start_time` 升序（`group_tracks` 已排序）；`abs(start_k − end_{k−1}) > tol` 时开新段（含重叠的异常数据：后者单独成段，叠在上面） |
| `_append_clip_chain(parts, i, clip, W, H, pre_trimmed, needs_alpha)` | `[i:v]` → 未预裁剪时 `trim=start=..:end=..,setpts=PTS-STARTPTS,scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2:black,setsar=1:1`；预裁剪时 `setpts=PTS-STARTPTS` → `,trim=duration={duration:.6f}` → `needs_alpha` 时 `,format=rgba` + `fade=t=in:st=0:d={fi}:alpha=1`（fi>ε）+ `fade=t=out:st={duration−fo}:d={fo}:alpha=1`（fo>ε）+ `colorchannelmixer=aa={opacity}`（<1−ε）→ `[c{i}]` |
| `_append_run_placement(parts, labels, start, n)` | 单片段：`[c{i}]settb=AVTB,setpts=PTS+{start:.6f}/TB[r{n}]`；多片段：`[c{a}][c{b}]…concat=n={k}:v=1:a=0,settb=AVTB,setpts=PTS-STARTPTS+{start:.6f}/TB[r{n}]` |
| `_overlay_runs_on_base(labels)` | 无段：`[base]null[vout]`；否则依次 `[cur][r{n}]overlay=0:0:eof_action=pass:format=auto[o{n}]`，最后一个输出标签为 `vout`。标签只用下标，不含轨道 id |

语义说明：`dissolve` 在磁性时间轴下两片段不重叠，导出为「前段淡出 + 后段淡入」两条 alpha 渐变，与预览
`TransitionLayer.ts:14-17`（每轨同一时刻只有一个片段、dissolve = 两段重叠 alpha 渐变）一致；
渐变窗口 `min(duration, clip.duration/2)` 与预览相同；带运镜的片段在归一化阶段已烘焙，不受影响。

**服务集成**（`app/services/video_composition_service.py`）：

1. 新增异常 `class CompositionStageError(Exception)`：属性 `stage: str`、`summary: str`（`summary` 为 ffmpeg stderr 最后一个非空行，截断 300 字符）。
2. `_compose_videos_filtergraph(self, request, normalized_videos, output_path, ffmpeg_path, output_resolution, timeline_end: float) -> bool`：
   `build_filtergraph(..., pre_trimmed=True, fps=NORMALIZE_FPS, timeline_end=timeline_end)`；`can_use_concat` → 返回 `False`（调用方走 concat 快速路径）；
   归一化路径缺失 → `raise CompositionStageError("compose", f"normalized clip missing for {clip_id}")`（原为返回 False → 串接）；
   ffmpeg `returncode != 0` → `raise CompositionStageError("compose", _last_stderr_line(result.stderr))`；成功返回 `True`。
   `NORMALIZE_FPS` 为模块常量，值取 `_normalize_video` 当前写入 `-r` 的帧率（30），两处共用。
3. `_compose_video_sync`：
   - 删除 `:1015-1040` 的求和（逐条 `clip_end <= clip_start` 的校验与 `ValueError` 保留）；新增 `timeline_end = max(request.total_duration or 0, self._timeline_end(request))`。
   - `:1471-1475` 改为 `if not self._compose_videos_filtergraph(..., timeline_end): self._concat_videos(...)`——只有快速路径会串接。
   - `_process_audio_tracks(request, temp_dir, ffmpeg_path, timeline_end, ...)`（参数名改为 `timeline_end`，`:2154,2174,2323` 的 `-t` 随之）。
   - `request.video_items` 为空（EXO-06）：跳过媒体解析与归一化，直接 `_compose_videos_filtergraph(request, [], ...)`（builder 无片段时生成 `color…[base];[base]null[vout]`，`video_inputs=[]`，ffmpeg 只有 `-filter_complex` 无 `-i`）。
   - `CompositionStageError` 由现有外层失败处理捕获，经 EXO-13 的 `_fail_composition` 写入 `error_details = {error_summary: summary, composition_stage: stage}`。
4. `_normalize_video`（`:770-778`）：在 `-t` 旁追加 `'-frames:v', str(max(1, round(clip_duration * NORMALIZE_FPS)))`（EXV-10）。

**必须同步改写的现有测试**：`tests/test_filtergraph_builder.py:111-120,146-153`、`tests/test_export_parity.py:109-114`（钉住 tpad / xfade 旧行为）。

#### S7 合成降级上报 `degradations`

**问题**：合成链中 10 余处 `except … continue / return None / return False` 把「内容没进成片」变成「任务成功」（EXO-03 / EXO-04 / EXO-05 / EXO-16 / EXO-18）。

**设计**：保留「非致命问题不让整单失败」的策略，但**每一次**降级都必须记录并返回给用户。

后端：

```python
# app/models/video_models.py
class CompositionDegradation(BaseModel):
    kind: Literal["image_overlay", "subtitles", "audio_item", "embedded_audio"]
    item_ids: List[str] = Field(default_factory=list)
    item_names: List[str] = Field(default_factory=list)
    reason: str

# app/services/video_composition_service.py
def _record_degradation(self, composition_id: str, kind: str, items: Sequence[Any], reason: str) -> None:
    """记录一次非致命降级：写入 compositions[cid]['degradations']，并以 warning 记录日志（不含 URL 查询串与密钥）。"""
```

- `reason` 取异常消息或 ffmpeg stderr 最后一行，截断 300 字符；`item_names` 取条目 `name`（无则 id）。同一次导出同一 `kind` + 同一 `item_ids` 只记一次。
- 状态接口 `video_router.py` 白名单（`:229-236`）追加 `"degradations": composition_info.get("degradations", [])`。
- 记录点（逐一替换吞异常）：图片单独叠加失败（`:1631-1634`）→ `image_overlay`（全部图片）；字幕单独烧录失败（`:1646-1650`）→ `subtitles`；
  合并叠加回退顺序处理（`:1599-1614`）与顺序处理内部失败（`:2545-2556`）→ 各自 kind；
  `_process_audio_tracks` 逐条跳过（`:2258-2264,2275-2277`）→ 返回 `AudioMixResult`，调用方逐条 `audio_item`；
  `_extract_video_audio_tracks` 探针 `returncode != 0`（`:1996-1998,2028-2030,2041-2043`）→ `embedded_audio`（`returncode == 0` 且无音频流仍视为正常无声）；
  EXO-04 单张图片解析失败、EXO-18 远程图片 → `image_overlay`（仅该图片）。

```python
@dataclass(frozen=True)
class DroppedAudio:
    item_id: str
    name: str
    reason: str

@dataclass(frozen=True)
class AudioMixResult:
    path: Optional[str]
    dropped: List[DroppedAudio]
```

前端：

- `src/lib/api/videoComposition.ts`：`interface CompositionDegradation { kind: 'image_overlay' | 'subtitles' | 'audio_item' | 'embedded_audio'; item_ids: string[]; item_names: string[]; reason: string }`；`CompositionStatusResponse.degradations?: CompositionDegradation[]`。
- 新增纯函数模块 `src/components/video/hooks/exportDegradations.ts`：
  `mergeDegradations(acc: readonly CompositionDegradation[], next: readonly CompositionDegradation[] | undefined): CompositionDegradation[]`（按 `kind + item_ids.join()` 去重）；
  `formatDegradationMessage(list: readonly CompositionDegradation[], t: Translations): string | null`（空列表返回 null；每类一行，名称最多列 3 个、其余以「等 N 个」概括；zh-CN 分隔符「、」，其他「, 」）。
- `useVideoExport.ts` 轮询回调中与 `warnings` 同处累积（`:720-724`），完成后 `const message = formatDegradationMessage(...)`，非空时 `showWarning(message, 15000)`；原 `compositionWarningsTitle`（运镜降级）保留。

#### S8 排布不变量「写入即稳定」

**决策（附录 C D-1）**：保留磁性时间轴规则（`organizeVideoAudioTracks` 对所有未锁定 video/audio 轨贴紧，含图片轨；第 1 轮附录 B 与 RV-14 已确认为既有规则）。
改变该规则（例如让图片轨自由定位）是产品模型变更，影响全部手动编辑路径，不在本轮范围（附录 A N-03）。

**不变量**：任何把条目写入时间轴的**外部写入者**（AI 混剪合并、自动混剪、Agent reconcile、后端 sanitize），其输出必须是
`organizeVideoAudioTracks` 的不动点——即写入后立即执行一次整轨贴紧，所有条目的 `startTime` 不变（容差 1e-6）。
这样「应用后看到的布局」与「下一次任意编辑之后的布局」永远一致。

**落地**：

- 测试工具 `src/test/organizeFixedPoint.ts`（仅测试使用）：
  ```ts
  export function findOrganizeDrift(data: TimelineData): Array<{ itemId: string; before: number; after: number }>;
  // TimelineAggregate.fromPlainObject(data) → organizeVideoAudioTracks() → 对比每个条目 startTime
  ```
- 适用断言：`mergeAiMixTimeline`（AM2-01）、`applyScriptAutoMixAction`（AS2-03）、`OperationApplier` 的 `add_clip / move_clip`（AG2-01）三处各至少一条「`findOrganizeDrift(result)` 为空数组」用例。
- 后端 sanitize 新增 `_pack_lanes`（AM2-01），与前端合并使用同一贴紧规则，使警告在后端产生、前端合并时不再移动任何条目。

#### S9 编辑锁全覆盖（扩展第 1 轮 S4）

**问题**：TL2-19 / AG2-10 / AG2-06。锁只在 UI 层与撤销 / 重做生效，且在事件链排空前释放。

**设计**：

1. 新增 `src/components/video/timeline/store/editLock.ts`：
   ```ts
   export function isEditLocked(state: Pick<TimelineStore, 'externalEditLock'>): boolean {
     return state.externalEditLock !== null;
   }
   ```
2. **store 层**：以下 action 在函数首行 `if (isEditLocked(get())) return <拒绝值>;`，拒绝时不记录历史、不改状态：
   `addItemAction`、`moveItemAction`、`resizeItemAction`、`removeItemAction / removeItemsAction`、`swapItemsAction`、`splitAction`、`detachAudioAction`、
   `setCameraMotionAction`、`trackActions.ts` 全部导出 action、`updateItemFields.ts` 的 `findEditableItem`（统一入口）、`applyScriptAutoMixAction`（返回新增拒绝原因 `'edit-locked'`）、
   `dragSlice` 的 `startDrag` 与提交分支。拒绝值沿用各 action 现有的「未执行」返回（`false / null / void`）。
   **〔RV-03〕不经 action、直接调用 slice 变更方法的 UI 调用点**同样必须在调用点首行检查锁（锁定时 `showWarning(t.timeline.messages.editLockedByAgent)` 并返回，不写历史）：
   `TimelinePanel.tsx` 的复制处理（`:760-806`，`recordAction('ADD_ITEM', {operation:'copy'})` + `state.importFromData` + `autoOrganize`）与
   `handleOrganizeMaterials`（`:815-830`，`recordAction` + `state.autoOrganize()`）。`TimelinePanel.tsx:274` 的挂载期 `initTimeline` 与
   `projects/hydrateTimeline.ts` 的 `importFromData / clearHistory` 不属于用户编辑，不加锁。门禁 A17 钉住允许名单，防止以后新增绕过锁的直接调用。
3. `replaceTimelineAction`：锁定时仅允许 `reason ∈ {'agent', 'agent-undo'}`，其余返回 `false` 并 `console.warn('[replaceTimelineAction] refused while edit-locked', { reason })`。
   该拒绝是**最后防线**：所有非 Agent 入口必须先在调用点检查锁并提示（AI 混剪 `useAIMixedEditing.ts:338` 已有；自动混剪经 `applyScriptAutoMixAction` 的 `'edit-locked'`；
   字幕识别经 `getSubtitleCommitBlocker`；JSON 导入 / 待处理时间轴数据经 TimelinePanel 外部同步——〔RV-03〕锁定且原因为 `import` 时提示并 `resyncOwnerFromStore()`，见 §3.3 AG2-08 第 4 点）。
   Agent 撤销在 hook 层另行禁止（AG2-10），`'agent-undo'` 仅供解锁后的撤销使用。
4. **UI 层**：`VideoEditingInterface.tsx:2329-2332` 的时间轴区域外层容器加 `inert={agent.agentIsExecuting ? true : undefined}`（React 19 原生支持），
   一次性移除该区域全部 Tab 路径；文档级快捷键（空格播放、Ctrl+E 导出等）不受影响。
   `TimelinePanel` 在锁定变为非空时把剪切工具切回选择工具；素材面板「添加到时间轴」、图片叠加确认 / 拖动、字幕编辑与运镜弹窗的保存 / 应用按钮在锁定时置灰并显示 `timeline.messages.editLockedByAgent`（第 1 轮已有 key）。
5. **释放时机**（AG2-06）：执行状态新增 `'finishing'`，锁在事件链排空后才释放（详见 §3.7 AG2-06）。
6. 项目水合（`projects/hydrateTimeline.ts`）不经过 action，不受锁影响（打开项目时 Agent 不可能在执行）。

#### S10 素材身份与引用

**问题**：派生素材复用原素材存储身份（ME-01）；删除不看引用（ME-02）；Agent 片段不快照播放地址、`remove_material` 使片段失效（AG2-16）。

**设计**（三个纯函数模块，详见 §3.3 / §3.7）：

| 模块 | 职责 |
|---|---|
| `src/components/video/lib/derivedMaterial.ts` | `buildDerivedMaterial`：派生素材只继承展示与业务元数据，存储字段一律由处理结果重建；`repairDerivedMaterialIdentity`：打开项目时修复已保存的错误身份 |
| `src/components/video/timeline/lib/materialUsage.ts` | `findTimelineUsages(tracks, materialIds)`：统计素材在时间轴上的引用（含锁定轨），供素材删除与 Agent `remove_material` 共用 |
| `src/lib/video-editing-agent/tools/index.ts` 新增 `toAgentClipMaterial` | Agent 添加片段时快照 `url / serverUrl / cacheUrl / storageKey / metadata`，与手动拖放的 `toMaterialData` 一致 |

`materialDeleteHelpers.sourcePathForDelete(material, siblings?)`：当 `siblings` 中存在另一个素材（id 不同）拥有相同存储键时返回 `undefined`，
防御「两个素材共享同一源文件」时删除其一连带删除另一个的文件。

---

### 3.3 数据安全（ME-01 / ME-02 / AG2-08 / ME-08）

#### ME-01 派生素材拥有独立存储身份

**复现**：本地上传 60 s `orig.mp4` → 静音移除得到 40 s 的「_静音移除」素材 → 该素材预览解析为
`/api/storage/files/video/orig.mp4`、导出引用同一路径（*[实测]*）；删除该素材时删除键为 `video/orig.mp4`，后端
`derived_gc_service.py:120-123` 删除原文件，原素材与所有使用它的片段随之失效。去水印（同 id 替换，只换 `url/serverUrl`）
导出仍带水印；视频切段（`VideoEditingInterface.tsx:1350-1351` 展开原 `metadata`）删除时同样删到原文件。

**根因**：派生素材以 `...originalMaterial` 展开，继承了 `cacheUrl / storageKey / metadata.localResolvedUrl / metadata.storageKey`，
而 `selectPlaybackUrl._directLocalStorageCandidate` 按 `metadata.localResolvedUrl → localResolvedUrl → cacheUrl → url` 取第一个本地引用。

**设计**：新增 `src/components/video/lib/derivedMaterial.ts`（纯函数）：

```ts
import type { MaterialItem } from '@/types';

export interface DerivedFileRef { url: string; thumbnailUrl?: string; duration?: number }
export interface DerivedIdentity { id: string; name: string; metadata: NonNullable<MaterialItem['metadata']> }

/** 顶层存储 / 缓存 / 代理字段：派生素材一律不继承。 */
const STORAGE_FIELDS = [
  'cacheStatus', 'cacheUrl', 'storageKey', 'cacheError',
  'previewProxyStatus', 'previewProxyProfile', 'previewProxyLocalUrl', 'previewProxyProgress', 'proxyStatus',
  'localProxyStatus', 'localProxyUrl', 'localProxyProgress', 'localProxyError', 'localProxyBytes',
] as const;
/** metadata 中与存储身份相关的字段：同样不继承。 */
const STORAGE_METADATA_FIELDS = [
  'storageKind', 'storageKey', 'localResolvedUrl', 'originalUrl', 'storageMetadata', 'isLocalFile', 'thumbnailSource',
] as const;

/** `/api/storage/files/<key>`（允许同源绝对地址前缀）→ `<key>`；`cached_materials/` 与非本地地址 → undefined。 */
export function storageKeyFromLocalUrl(url: string): string | undefined;

export function buildDerivedMaterial(
  original: MaterialItem, file: DerivedFileRef, identity: DerivedIdentity,
): MaterialItem;

/** metadata.isSilenceRemoved / isClip / isWatermarkRemoved 任一为 true。 */
export function isDerivedMaterial(material: MaterialItem): boolean;

/** 打开项目时修复已保存的派生素材：`metadata.localResolvedUrl ?? cacheUrl` 存在、≠ `url`，且**不是** `/api/storage/files/cached_materials/` 引用
 *  （〔RV-11〕远程处理结果随后缓存到本地是合法缓存，不得剥离）的派生素材按 `url` 重建身份。 */
export function repairDerivedMaterialIdentity(
  materials: readonly MaterialItem[],
): { materials: MaterialItem[]; repairedIds: string[] };
```

`buildDerivedMaterial` 规则：
1. 以 `original` 为底，删除 `STORAGE_FIELDS`；`identity.metadata` 删除 `STORAGE_METADATA_FIELDS`。
2. 写入 `id / name`、`url = serverUrl = file.url`；`file.duration`、`file.thumbnailUrl` 有值时覆盖；`createdAt = new Date()`（修复路径保留原值）。
3. `isLocalMediaReference(file.url)` 为真（复用 `selectPlaybackUrl.ts` 已使用的同一判定；未导出则从其定义处导出）时写 `cacheUrl = file.url`、`metadata.localResolvedUrl = file.url`、`metadata.storageKind = 'local'`。
4. `storageKeyFromLocalUrl(file.url)` 有值时写 `storageKey` 与 `metadata.storageKey`。
5. `metadata.derivedFrom = original.id`。

派生标志名（`isSilenceRemoved / isClip / isWatermarkRemoved`）以 `MaterialsPanel.tsx:1317-1380` 与 `VideoEditingInterface.tsx:1350-1428` 中实际写入的键为准。

**使用点**：

| 位置 | 改动 |
|---|---|
| `MaterialsPanel.tsx` 静音移除（`:1363-1380`） | `buildDerivedMaterial(originalMaterial, { url: processedVideoUrl, duration: result.new_duration }, { id: newId, name, metadata: { ...现有业务元数据 } })` |
| `MaterialsPanel.tsx` 去水印（`:1317-1334`，同 id） | 同上（`id` 不变） |
| `useMaterialManagement.addOrReplaceMaterial` | 替换既有 id 且 `url` 变化时调用 `evictMaterialCaches(id)`（本地下载、胶片带、波形缓存以 materialId 为键，不失效会继续显示旧文件） |
| `VideoEditingInterface.handleExportClips`（`:1321` 起） | 占位素材（`:1350-1351`）与最终素材（`:1411-1428`）都经 `buildDerivedMaterial` |
| `projects/VideoEditorContainer.tsx` 打开项目 | 在 `hydrateTimelineFromProjectData(record.project_data)` 之后、`setContent` 之前对 `project_data.materials` 执行 `repairDerivedMaterialIdentity`；`repairedIds.length > 0` 时 `console.info('[project] repaired derived material identity', { count })` |
| `materialDeleteHelpers.sourcePathForDelete(material, siblings?)` | `siblings` 中存在 id 不同且 `storageKey ?? metadata.storageKey` 相同的素材时返回 `undefined`；`cascadeDeleteMaterial` 传入 `materialsSnapshotRef.current` |

#### ME-02 删除正在使用的素材

**复现**：A.mp4 在轨道上 → 素材库删除 A 并确认 → 片段仍画在时间轴上，`extractVideoSequences` 返回 0 条（*[实测]*），预览空白、
导出静默少一段（音频则以「音频条目数量不符」失败），源文件已被删除，Ctrl+Z 无效。

**设计**：

```ts
// src/components/video/timeline/lib/materialUsage.ts
import type { TrackData } from '@/components/video/timeline/domain';

export interface MaterialUsage { materialId: string; itemIds: string[]; lockedItemIds: string[] }

/** 只返回存在引用的素材；锁定轨上的条目同时进入 itemIds 与 lockedItemIds；字幕条目无 materialId 自然排除。 */
export function findTimelineUsages(tracks: readonly TrackData[], materialIds: readonly string[]): MaterialUsage[];
```

`useMaterialManagement.handleMaterialDelete(materialIds)` 流程：

1. `const timeline = useTimelineStore.getState()`；`isEditLocked(timeline)` → `showWarning(t.timeline.messages.editLockedByAgent)`，返回。
2. `usages = findTimelineUsages(timeline.exportToData().tracks, materialIds)`；任一 `lockedItemIds` 非空 → `showWarning(t.materialsPanel.deleteBlockedLocked.replace('{count}', n))`，返回（锁定 = 防编辑，删除素材会间接删掉锁定轨片段）。
3. 打开 `danger` 确认框，文案全部改走 i18n（替换 `:254-259` 的硬编码中文）：标题 `deleteConfirmTitle`；无引用时正文 `deleteConfirmBody`（单个，`{name}`）/ `deleteConfirmBodyMany`（`{count}`）；
   有引用时 `deleteInUseBody`（`{name}`、`{count}`）/ `deleteInUseBodyMany`（`{materialCount}`、`{count}`）；确认按钮 `deleteConfirmAction`。
4. `onConfirm`：重新读取 store 并重新计算引用（确认期间时间轴可能变化，锁定检查同样重做）；`itemIds` 非空时先
   `removeItemsAction(() => useTimelineStore.getState(), itemIds)`（一条历史），再 `executeDelete(materialIds)`（保持原缓存失效与后端联动删除）。
   〔RV-12〕`executeDelete` 失败且本次已移除片段时：`console.error('[materials] delete failed after removing clips', { materialIds, error })`，
   `showError(t.materialsPanel.deleteFailedClipsRemoved)`（说明素材未删除、可按 Ctrl+Z 恢复片段）；未移除片段时沿用现有失败提示。
5. 导出前置检查（`useVideoExport.validateVideoExport`）：渲染轨上（`isTrackRendered`）、非字幕、`materialId` 不在素材库中的条目 →
   `showError(t.videoExport.missingMaterials.replace('{count}', n).replace('{names}', 前 3 个条目名))` 并中止导出。
   说明：删除后按 Ctrl+Z 仍可恢复片段（S1 快照），但素材已不存在——导出给出明确原因，而不是静默少一段（时间轴条目上的「素材缺失」标记列入附录 A N-01）。

#### AG2-08 Agent 负起点导致渲染进程崩溃

**复现**：`add_to_track {startTime: -3}` → `success: true`，服务端与客户端状态都含 `startTime: -3` 的片段 → `TimelinePanel` 外部同步
`TimelineAggregate.fromPlainObject` 抛 `TimePosition: value must be >= 0, got -3`（*[实测]*），effect 中未捕获，仓库无 ErrorBoundary / `app/error.tsx`。

**设计**：

1. `tools/addToTrack.ts`（`:116` 之前）：
   ```ts
   if (params.startTime !== undefined && !(Number.isFinite(params.startTime) && params.startTime >= 0)) {
     return toolErrorResponse({ success: false, error: 'startTime must be a non-negative number of seconds' });
   }
   ```
2. 防御纵深：`src/lib/video-editing-agent/operationGuards.ts` 的 `validateOperationTargets`（与 AG2-02 同一模块，§3.7）对
   `add_clip.clip.startTime / duration`、`move_clip.newStartTime`、`trim_clip.clipStart / clipEnd`、`resize_clip.newDuration` 做「有限、非负、duration > 0」检查，
   返回 `{ ok: false, reason: 'invalid-time' }`；客户端 `OperationApplier.apply` 与服务端 `agent.ts` 的本地应用在修改状态之前调用。
3. `TimelinePanel.tsx:369-377`：
   ```ts
   try {
     replaceTimelineAction(() => useTimelineStore.getState(), externalTimelineState as unknown as TimelineData, reason);
   } catch (error) {
     console.error('[TimelinePanel] external timeline update rejected', { reason, error });
     showError(t.timeline.messages.externalUpdateRejected);
   }
   ```
   `replaceTimelineAction` 必须保持「先 `TimelineAggregate.fromPlainObject(data)` 构造、后 `recordAction`」的顺序（TL2-04 改写时不得调换），构造抛错时尚未写入历史与状态。
4. **〔RV-01 / RV-03〕外部写入被拒后回写所有者**：VEI 在外部同步之前就已 `setCurrentTimelineState(被拒数据)`，而 `currentTimelineState` 会写入
   `content.uiState` 并被自动保存（`VideoEditingInterface.tsx:270-285`）。因此外部同步在以下两种情况下都必须把 store 当前状态回写给所有者：
   (a) 上面的 `catch`；(b) 锁定且原因不是 `agent / agent-undo`（S9 第 3 点）——此时**不调用** `replaceTimelineAction`，直接
   `showWarning(t.timeline.messages.editLockedByAgent)`。回写统一经 TimelinePanel 内新增的私有函数
   `resyncOwnerFromStore()`：`onTimelineStateChangeRef.current?.(<与 :311 相同的 store → TimelineState 转换>)`，并
   `onTimelineCompositionChange?.(同一状态)`，保证预览、导出与自动保存读到的都是 store 中实际存在的时间轴。
5. **〔RV-01〕存量损坏数据的水合修复（不再以空时间轴覆盖）**：
   - 新增纯函数模块 `src/components/video/projects/repairTimelineData.ts`：
     ```ts
     export interface TimelineRepairReport { clampedItemIds: string[]; droppedItemIds: string[] }
     /** 深拷贝后修复可恢复的条目：startTime 非有限或 < 0 → 0；clipStart 非有限或 < 0 → 0；
      *  duration 非有限或 ≤ 0、或 clipEnd ≤ clipStart 的条目整条删除。其余字段原样保留，不做贴紧。 */
     export function repairTimelineData(data: TimelineData): { data: TimelineData; report: TimelineRepairReport };
     ```
   - `projects/hydrateTimeline.ts`：`hydrateTimelineFromProjectData` 返回
     `HydrationResult = { status: 'loaded' } | { status: 'repaired'; report: TimelineRepairReport } | { status: 'failed' }`。
     流程：`importFromData(rest)` → 抛错则 `repairTimelineData(rest)` 后再导入 → 仍抛错才回退空时间轴并返回 `failed`（原有 `console.warn` 保留，追加 `status`）。
     `status === 'repaired'` 时导入的是修复后的数据（之后第一次保存自然写回修复结果）。
   - `projects/VideoEditorContainer.tsx`：
     `repaired` → `showWarning(t.videoProjects.timelineRepaired.replace('{count}', clamped + dropped))`；
     `failed` → 在 `setContent` 之前把**原始** `uiState.currentTimelineState` 写入顶层字段 `timelineRecoveryBackup: { savedAt: ISO 字符串, data: 原始值 }`
     （放在顶层而非 `uiState`：VEI 持久化 effect 会重建 `uiState` 并丢弃其中未知键，而顶层字段经 `...content` 与 `normaliseProjectDataForSave` 的 `...rest` 均保留），
     并 `showError(t.videoProjects.timelineUnreadable)`；已存在备份时不覆盖（保留最早的原始数据）。
   - 这样即使之后自动保存写入空 / 新时间轴，用户原始时间轴仍在项目数据中，可供第 3 轮的恢复入口或人工恢复使用（恢复 UI 列入附录 A N-07）。

#### ME-08 关窗与重试不丢编辑

**复现**：A. 删除一个片段后 0.8 s 内点标题栏关闭 → 重新打开项目片段仍在（防抖 800 ms，`windowControls.js:40-43` 直接 `win.close()`，
关闭最后一个窗口即退出并停止后端，渲染进程无任何刷写机会）。B. 保存 v1 返回 503 → 内容变为 v2 → 卸载刷写 v2 → 3 s 后重试发送 v1，
最终落库 v1（*[实测：调用顺序 ["v1","v2","v1"]]*）。

**设计 · 渲染进程**：

```ts
// src/components/video/projects/autosaveRegistry.ts
export function registerPendingFlush(key: string, flush: () => Promise<void>): () => void;
/** 并行执行全部已登记的刷写，与 timeoutMs 竞速；任何一个失败或超时即 ok=false。 */
export async function flushAllPending(timeoutMs: number): Promise<{ ok: boolean; failedKeys: string[]; timedOut: boolean }>;
```

`useProjectAutosave.ts`：

1. 新增 `mountedRef`（挂载 true、卸载 false）与 `inFlightPromiseRef: MutableRefObject<Promise<void> | null>`；`flush.current` 把整次保存（含重试）包成 promise 赋给它，结束置 `null`。
2. 抽出私有 `saveLatestIfDirty(pid: string): Promise<void>`：读 `contentRef.current` → `normaliseProjectDataForSave` → 与 `lastSavedJsonRef` 比较 → `updateVideoProject` → 成功写 `lastSavedJsonRef / lastSaveAtRef`；失败抛出。
3. 5xx 重试（`:114-123`）：等待 3 s 后 `if (!mountedRef.current || projectIdRef.current !== pid) { optsRef.current.onSaveError?.(err); return; }`，否则 `await saveLatestIfDirty(pid)`（发送**最新**内容而非失败前的 `payload`）。
   〔RV-06〕等待改为可提前结束：`retryWaitRef: MutableRefObject<(() => void) | null>` 保存等待 promise 的 resolve；登记的关闭刷写（第 5 点）先调用 `retryWaitRef.current?.()` 结束等待，
   使在途保存立即进入重试，而不是让 3 s 退避吃掉 2.5 s 关闭预算。
4. 卸载刷写（`:191-209`）：`void (inFlightPromiseRef.current ?? Promise.resolve()).then(() => saveLatestIfDirty(pid)).catch((error) => console.warn('[autosave] unmount flush failed', { projectId: pid, error }))`。
5. 登记：`useEffect(() => projectId ? registerPendingFlush(\`project:${projectId}\`, async () => { retryWaitRef.current?.(); await inFlightPromiseRef.current; await saveLatestIfDirty(projectId); }) : undefined, [projectId])`。
6. 〔RV-19〕`flushAllPending` 结果中 `timedOut === true` 时，`useDesktopCloseGuard` 的提示正文改用 `t.videoProjects.closeSaveSlowBody`（「项目仍在保存…」），
   其余失败沿用 `closeUnsavedBody`；两种情况按钮相同。

新增 `src/hooks/useDesktopCloseGuard.ts`，在 `src/app/page.tsx` 外壳挂载一次：

```ts
const CLOSE_FLUSH_BUDGET_MS = 2500;
export function useDesktopCloseGuard(): void {
  const { t } = useLocale();
  useEffect(() => {
    const bridge = window.ecliptrixDesktop?.app;
    if (!bridge) return undefined;                      // 浏览器调试路径不受影响
    return bridge.onBeforeClose(async (token) => {
      const result = await flushAllPending(CLOSE_FLUSH_BUDGET_MS);
      bridge.closeReady(token, result.ok ? { ok: true } : {
        ok: false,
        prompt: {
          title: t.videoProjects.closeUnsavedTitle, body: t.videoProjects.closeUnsavedBody,
          keepOpen: t.videoProjects.keepOpen, closeAnyway: t.videoProjects.closeAnyway,
        },
      });
    });
  }, [t]);
}
```

**设计 · 主进程**（新增 `desktop/main/closeGuard.js`，由 `desktop/main/window.js` 创建窗口后调用）：

```js
const CLOSE_FLUSH_TIMEOUT_MS = 3000
function installCloseGuard(win, { ipcMain, dialog, logger, timeoutMs = CLOSE_FLUSH_TIMEOUT_MS, shouldBypass = () => false }) {
  let approved = false
  let flushing = false
  win.on('close', (event) => {
    if (approved || shouldBypass()) return                 // 〔RV-02〕退出流程已开始（服务已停止）时不再请求刷写
    event.preventDefault()
    if (flushing) return                                   // 刷写期间重复点击关闭：等待同一次结果
    flushing = true
    requestRendererFlush(win, ipcMain, timeoutMs, logger).then((result) => {
      flushing = false
      if (win.isDestroyed()) return
      if (!result.ok && result.prompt) {
        const choice = dialog.showMessageBoxSync(win, {
          type: 'warning', buttons: [result.prompt.keepOpen, result.prompt.closeAnyway],
          defaultId: 0, cancelId: 0, title: result.prompt.title, message: result.prompt.body,
        })
        if (choice === 0) return                           // 保持打开
      }
      approved = true
      win.close()
    })
  })
}
// requestRendererFlush：生成 token；ipcMain.on('app:close-ready', handler) 只接受同 token 的回复；
// webContents 已销毁或崩溃 → 立即 { ok: true }；timeoutMs 到期 → logger.warn('[closeGuard] renderer flush timed out') 并 { ok: true, timedOut: true }；
// 结束时移除监听，避免泄漏。
module.exports = { installCloseGuard, CLOSE_FLUSH_TIMEOUT_MS }
```

- `window.js:129-138` 现有「保存窗口尺寸」close 回调保留（先注册，两次 close 各执行一次，结果相同）。
- 〔RV-02〕退出路径（应用无菜单，`app.quit()` 仅在 `index.js:56/66/76/327`）：标题栏关闭（`windowControls.js:40-43`）、Alt+F4、任务栏关闭都**先**触发窗口 `close`，
  此时 `state.quitting === false`，受保护；关闭完成后 `window-all-closed → app.quit → before-quit` 才停服务，顺序正确。
  服务异常退出对话框选「退出」（`:327`）与单实例锁失败（`:56`）则是 `before-quit` 先置 `state.quitting = true` 并 `stopChildren()`，
  随后窗口 `close` 经 `shouldBypass` 直接放行——不向已停止的服务刷写、不再弹第二个对话框、不会把用户留在服务已停止的窗口里。
  `window.js` 调用 `installCloseGuard(win, { ipcMain, dialog, logger, shouldBypass: () => state.quitting })`（`state` 由 `index.js` 经 `createMainWindow` 现有参数传入，
  若当前无此参数则新增 `isQuitting` 回调参数，D5）。`index.js` 的 `window-all-closed` 与 `before-quit` 逻辑不变。
- 渲染进程无响应时 3 s 后照常关闭（不把用户困在无法关闭的窗口里），并记录日志。
- `desktop/preload/preload.js` 在 `ecliptrixDesktop` 下新增：
  ```js
  app: {
    onBeforeClose: (cb) => { const listener = (_e, token) => cb(token); ipcRenderer.on('app:before-close', listener); return () => ipcRenderer.removeListener('app:before-close', listener) },
    closeReady: (token, result) => ipcRenderer.send('app:close-ready', token, result),
  },
  ```
- `src/types/desktop.d.ts` 同步类型（`app?: { onBeforeClose(cb: (token: string) => void): () => void; closeReady(token: string, result: CloseReadyResult): void }`）。

### 3.4 导出与预览 · 画面合成（EXV-01～EXV-10 / EXO-06 / ME-07）

本组以 S5（渲染判定与终点）+ S6（画布合成）为主体，下表给出各缺陷的落点与额外要求，机制细节见 §3.2。

| 缺陷 | 落点 | 额外要求 |
|---|---|---|
| EXV-01 | S6：每个 run `setpts=PTS+start/TB` + `overlay eof_action=pass` | 探针用例：底红 0–6、顶蓝 2–4 → t=1 红、t=3 蓝、t=5 红 |
| EXV-02 | S6：`_contiguous_runs` 按半帧容差断段；快速路径要求首段起点与段间无空隙 | 探针用例：红 0–2、蓝 4–6 → 6.0 s，t=3 黑、t=4.5 蓝；单片段起点 3 s → t=1 黑 |
| EXV-03 | S5 + S6：前端 `total_duration = renderEnd`；后端 `timeline_end = max(total_duration, _timeline_end(request))` 作为画布时长与音频 `-t` | 服务测试断言音频混流命令含 `-t 6.0`（底 0–6 + 顶 2–4） |
| EXV-04 / EXV-06 / EXV-08 | S6：删除 xfade 与 concat→transition 的组合，dissolve = 两条 alpha 渐变 | 字符串用例断言无 `xfade`、无 `duration=0`；探针：硬切 + dissolve 图编码成功 |
| EXV-05 | S6：黑色底图 | 探针：红 0–4、淡入 1 s、不透明度 0.5 → t=2 红通道 128±3 |
| EXV-07 | S6：`_compose_videos_filtergraph` 失败抛 `CompositionStageError`，只有 `can_use_concat` 才串接 | 服务测试：mock `subprocess.run` 使 `-filter_complex` 命令返回 1 → `_concat_videos` 未被调用、状态 `failed`、`error_details.composition_stage == 'compose'` |
| EXV-09 | S6 保证视频条目按真实 `start_time` 放置；前端 `video_items[].start_time` 保持 `item.startTime` | 前端用例：视频 A 0–3、图片 3–5、视频 B 5–8 → 请求中 B 的 `start_time == 5`、`total_duration == 8` |
| EXV-10 | `_normalize_video` 追加 `-frames:v max(1, round(d × NORMALIZE_FPS))` | 服务测试：d=2.345 → 命令含 `-frames:v 70` |
| EXO-06 | 见下 | — |
| ME-07 | 见下 | — |

**EXO-06（图片 + 音频时间轴可导出）**：

1. `useVideoExport.validateVideoExport`：`spans = collectRenderSpans(tracks, materialsById)`；`!hasVisualSpan(spans)` → `showError(t.videoExport.nothingVisibleToExport)`，返回 false（纯音频 / 纯字幕时间轴不再显示误导性的「视频轨道长度不足」）；随后执行 ME-02 缺失素材检查。
   〔RV-04 / D-12〕**删除**「视频轨长度 ≥ 音频轨长度」硬拦截（`useVideoExport.ts:97-106` 的 `validateVideoExport` 旧实现与 `:166-182` 的拒绝分支）：
   S6 画布合成下画面短于时间轴终点只会得到黑尾，而预览（ME-07）同样播放黑尾，继续拦截会让「预览 = 导出」失效（走查第 7 条）。
   改为不阻断的提示：`blackTail = computeRenderEnd(spans) − computeVisualEnd(spans)`，`blackTail > 0.5` 时导出照常开始并
   `showWarning(t.videoExport.blackTailNotice.replace('{seconds}', blackTail.toFixed(1)), 8000)`。
   随之无引用的 `videoExport.videoTrackTooShort / videoTrackDuration / audioTrackDuration / needToAdd` 与 `calculateVideoTrackDuration / calculateAudioTrackDuration`
   经 grep 确认无其他调用方后删除（接口类型、en、zh-CN 三处同步；有其他调用方则保留并在实施记录中注明）。
2. `src/lib/api/videoComposition.ts:236-248`：`video_items` 与 `image_items` 都必须是数组，且二者不同时为空；`total_duration` 必须为有限正数。
3. `app/routers/video_router.py:158-163`：同一规则，400 `message = "At least one video or image item is required"`。
4. 后端空 `video_items`：见 S6 服务集成第 3 点（跳过解析与归一化，builder 生成纯黑底图，随后正常混音、叠图、烧字幕）。

**ME-07（预览时长与合成预览门控）**：

1. `useTimelineComposition.rebuildCompositionPlayback`：`spans = collectRenderSpans(timelineState.tracks, materialsById)`（`materialsById` 由现有 `materials` 构建）；`totalDuration = computeRenderEnd(spans)`；`isCompositionMode = spans.length > 0`；签名 `computeCompositionSignature` 增加参数 `renderSignature = spans.filter(s => s.kind === 'image').map(s => \`${s.itemId}:${s.start}:${s.end}\`).join('|') + '#' + totalDuration`。
2. `VideoPlayerPanel.tsx:181-182`：`playbackMode = compositionPlayback?.isCompositionMode ? 'composition' : 'preview'`；`:479` 渲染条件改为 `playbackMode === 'composition' && compositionPlayback`。
3. 实现节点须 grep `videoSequences.length` 于 `VideoPlayerPanel/` 与 `hooks/`，凡用于「是否进入合成预览 / 是否可播放」判定的一律改用 `isCompositionMode`（仅用于序列下标的保留）。
4. `MultiTrackPlaybackEngine` 在视频轨组为空时仍须推进时钟、绘制图片 / 字幕、同步音频：新增引擎用例钉住（若现状不满足，在引擎 `tick` 中去掉对视频组非空的依赖，时钟终点取 `getTotalDuration()`）。

### 3.5 导出 · 字幕 / 图片 / 音频 / 失败上报（EXO 组）

#### EXO-01 / EXO-10 / EXO-11 / EXO-17 逐条字幕样式

**复现**：S1「FIRST」20 px 红色顶部无背景、S2「SECOND」40 px 黄色蓝底底部 → 两个 drawtext 均为 `fontsize=20:fontcolor=#FF0000:y=50:boxcolor=#000000@0.5`（*[实测]*）；
空文本条目烧录「字幕 1」；`"第一行\n\n第三行"` 导出只剩「第一行」。

**设计 · 后端**（`app/services/subtitle_service.py`）：

```python
@dataclass(frozen=True)
class SubtitleDrawStyle:
    font_family: str = "default"
    font_size: int = 24
    font_color: str = "#FFFFFF"
    background_color: Optional[str] = None      # 已转换为 ffmpeg 颜色；None = 不画背景框
    position: str = "bottom"


def to_ffmpeg_color(value: Optional[str]) -> Optional[str]:
    """None / '' / 'transparent' → None；#RGB → #RRGGBB；#RRGGBB 原样；#RRGGBBAA → 0xRRGGBB@<AA/255 保留 3 位>；
    已含 '@' 的 ffmpeg 颜色原样；其他值记录 warning（含原值）并返回 None。"""


def resolve_draw_style(item: Any) -> SubtitleDrawStyle:
    """逐条读取 font_family / font_size / font_color / background_color / position，缺省取 SubtitleDrawStyle 默认值。"""


class SubtitleService:
    def build_drawtext_filters_for_items(
        self, items: Sequence[Any], video_width: int, video_height: int, text_files_dir: str,
    ) -> List[str]:
        """逐条生成 drawtext；text.strip() 为空的条目跳过；不经 SRT。"""

    def _drawtext_filters_for_entry(
        self, index: int, text: str, start: float, end: float, style: SubtitleDrawStyle,
        video_width: int, video_height: int, text_files_dir: str, layout: str,
    ) -> List[str]:
        """由 _build_standard_drawtext_filters（:664）与 _build_multiline_centered_drawtext_filters（:783）的循环体抽出。"""

    def burn_drawtext_filters(
        self, video_path: str, output_path: str, filters: List[str], temp_dir: str, timeout: Optional[float],
    ) -> None:
        """执行烧录；失败抛 CompositionStageError('subtitles', <stderr 最后一行>)。"""
```

- `_drawtext_filters_for_entry` 保持现有换行（`_wrap_text`）、字体选择（`_get_font_path(style.font_family, text)`）、textfile 写入与位置计算；
  `layout ∈ {'standard', 'centered'}` 的选择条件沿用 `build_drawtext_filters`（`:562`）现有判断，两个旧函数改为薄封装或删除（无其他调用方时删除）。
- enable 表达式统一为 `enable='gte(t,{start:.3f})*lt(t,{end:.3f})'`（EXO-17，半开区间）。
  〔RV-09〕图片叠加的 overlay enable（`video_composition_service.py:2674` 的 `between(t,{start},{end})`）同样改为 `gte(t,s)*lt(t,e)`；
  `still_static_chain` 的逐字节契约只约束静态链本身，不受影响；断言 `between` 的现有用例同步更新（T6 新增 `test_adjacent_images_use_half_open_enable_window`）。
- `style.background_color is None` 时不输出 `box=1:boxcolor=…:boxborderw=…`（EXO-10）。
- 文本原样写入 textfile，空行保留（EXO-11）。
- `burn_drawtext_filters` 的滤镜参数经 EXO-05 的 `video_filter_args` 生成。

**设计 · 合成服务**（`video_composition_service.py`）：

- `_process_subtitle_tracks`（`:2392`）：删除 `:2431-2446` 的 `first_subtitle` 样式块与 SRT 生成；`filters = self.subtitle_service.build_drawtext_filters_for_items(...)`；
  空列表 → 返回 None（无可烧录字幕，不记降级）；否则 `burn_drawtext_filters(..., timeout=None)`（EXO-16）；异常由调用方记录 `subtitles` 降级（S7）。
- `_process_overlays_and_subtitles_combined`（`:2688`）：删除 `:2721-2728`，字幕滤镜同样来自 `build_drawtext_filters_for_items`。
- `composition/subtitle_prep.py` 中仅为合成 SRT 服务的函数，若改动后再无调用方则删除（独立 `/add-subtitles` 路由仍使用的保留）。

**设计 · 前端**：

- 新增 `src/components/video/hooks/videoExportItems.ts`（纯函数）：
  `toSubtitleCompositionItem(item: TimelineItem, track: Track): SubtitleCompositionItem | null`——`item.text?.trim()` 为空返回 `null`；`text: item.text`；
  样式取 `item.subtitleStyle`，不写背景兜底。`useVideoExport.ts:460` 删除 `'#000000@0.5'`，`:481` 改为调用本函数并过滤 `null`。
- 预览 `playback/SubtitleLayer.ts:94`：可见判定改为 `t >= start && t < end - TIME_EPSILON`，与 `ImageOverlayLayer.ts:117` 的半开区间一致（EXO-17）。

#### EXO-02 图片不透明度与叠放顺序

**设计 · 后端**：

1. `composition/camera_motion.py`：`still_static_chain(box_w, box_h, opacity: float = 1.0)`——`opacity >= 0.999` 时输出与现状**逐字节相同**（保持 D16 契约测试）；否则
   `scale=…,format=rgba,pad=…:color=black@0,colorchannelmixer=aa={opacity:.4f}`。`build_still_overlay_plan(..., opacity: float = 1.0)` 在 `pad` 之后、`setpts` 之前插入同一 `colorchannelmixer`。
2. `app/models/video_models.py` `ImagePosition`：`z_index: int = Field(10, alias="zIndex")`，`model_config = ConfigDict(populate_by_name=True)`（同时接受 `zIndex` 与 `z_index`）。
3. `_build_still_overlay_inputs`（`:2560`）：不透明度取 `_clamp01(item.opacity)`（None → 1）；`≤ 0.001` 的图片跳过（用户有意隐藏，不记降级）；
   布局输入前按 `(position.z_index if position else 10, 请求下标)` 稳定排序。

**设计 · 前端**：

1. `videoExportItems.ts` 新增 `toImageCompositionItem(item, track, material)`：`opacity: effectiveImageOpacity(item.opacity)`（复用 `playback/ImageOverlayLayer.ts:153` 的同名判定，未导出则导出），替换 `useVideoExport.ts:287` 的 `item.opacity || 1.0`。
2. 删除 `useVideoExport.ts:533` 对图片按 `start_time` 的排序，请求顺序 = `buildImageOverlayInputs` 的轨道顺序。
3. 预览 `playback/internal/assembleLayers.ts:193-195`：图片层 `z = baseZ + zIndex * 1000 + index`，使排序为「先 zIndex、后输入顺序」，与导出一致。
4. 〔RV-10〕`zIndex` 统一钳制为 `[0, 999]` 的整数（缺省 10）：前端新增并导出 `clampImageZIndex(value: unknown): number`（放在 `ImageOverlayLayer.ts`，预览与 `toImageCompositionItem` 共用），
   保证图片层 `z < baseZ * 2`（字幕层，`DEFAULT_OVERLAY_BASE_Z = 1_000_000`），字幕始终在图片之上——与导出「先叠图、后烧字幕」一致；
   后端排序键同样 `min(max(int(z_index), 0), 999)`，不加 Pydantic 范围校验（避免旧数据越界导致整单 422）。

#### EXO-03 失败上报

按 S7 在全部吞异常处记录降级。另需：

- `_process_audio_tracks` 返回 `AudioMixResult`；调用方（`:1490`）对 `dropped` 逐条 `_record_degradation(cid, 'audio_item', [item], reason)`；`path is None` 且存在音频条目时维持现有「唯一音源失败即整单失败」逻辑（`:2089-2096`）。
- `_extract_video_audio_tracks`：ffprobe `returncode != 0` → `embedded_audio` 降级（条目为该视频）；`returncode == 0` 且无音频流 → 正常无声，不记录。
- `_process_overlays_sequential` 返回 `(images_ok: bool, subtitles_ok: bool)`，失败部分由调用方记录。
- 前端提示见 S7；文案 key 见 §6.4。

#### EXO-04 / EXO-18 单张图片失败不连累整批、不下载远程图片

`_build_still_overlay_inputs` 循环内：

```python
try:
    local_path = self._convert_url_to_local_path(url)
except _IMAGE_RESOLVE_ERRORS as exc:
    skipped.append(SkippedImage(item=item, reason=str(exc)))
    continue
if local_path.startswith(("http://", "https://")):
    skipped.append(SkippedImage(item=item, reason="remote image is not available locally"))
    continue
```

- `_IMAGE_RESOLVE_ERRORS` 为模块级元组，列出 `_convert_url_to_local_path` 实际可能抛出的异常类型（`FileNotFoundError` 以及 `app/security/url_guard.py`、`local_media_resolver.py` 中定义的异常，实现节点以源码为准），不使用裸 `except Exception`。
- `SkippedImage` 为 `@dataclass(frozen=True)`（`item`、`reason`）。返回值由 `(cmd, entries, warnings)` 扩展为 `(cmd, entries, warnings, skipped)`；两个调用方（`_process_image_overlays`、`_process_overlays_and_subtitles_combined`）对 `skipped` 记录 `image_overlay` 降级；`entries` 为空时不运行 ffmpeg、原样返回视频。
- 远程图片不再进入 `download_image`（`requests.get`）；`test_camera_motion_stills.py` 的 `TestSinglePassAssembly` 4 个用例同步更新元组解包。

#### EXO-05 长滤镜图经脚本文件传递

新增 `app/services/composition/ffmpeg_args.py`：

```python
FILTER_ARG_INLINE_LIMIT = 8000   # 字符；Windows CreateProcess 命令行上限 32767

@functools.lru_cache(maxsize=4)
def supports_option_file_syntax(ffmpeg_path: str) -> bool:
    """一次性探测 ffmpeg 是否支持 `-/filter_complex <file>`（7.0+）：以 nullsrc + 写有 'null' 的临时脚本运行 `-f null -`，returncode==0 为真。"""

def filter_complex_args(graph: str, temp_dir: str, ffmpeg_path: str) -> List[str]:
    """len(graph) <= LIMIT → ['-filter_complex', graph]；否则写 UTF-8（无 BOM）脚本文件，
    支持新语法 → ['-/filter_complex', path]，否则 → ['-filter_complex_script', path]。"""

def video_filter_args(chain: str, temp_dir: str, ffmpeg_path: str) -> List[str]:
    """同上，对应 ['-vf', chain] / ['-/vf', path] / ['-filter_script:v', path]。"""
```

应用点：`_compose_videos_filtergraph`（`:239`）、音频混流（`:2321`）、`_process_overlays_and_subtitles_combined`（`:2776-2781`）、`_process_image_overlays`（`:2865-2870`）、
`subtitle_service.burn_drawtext_filters`（替代 `:650-660` 的 `-vf`）。脚本文件写入各自的 `temp_dir`，由 EXO-13 的 finally 统一清理。

#### EXO-08 状态终态收敛

- `video_router.py`：
  ```python
  _PUBLIC_COMPOSITION_STATUSES = frozenset({"processing", "completed", "failed"})

  def _public_status(info: Dict[str, Any]) -> Tuple[str, Optional[str]]:
      raw = info.get("status")
      if raw in _PUBLIC_COMPOSITION_STATUSES:
          return raw, None
      return "failed", f"Unexpected composition status: {raw!r}"
  ```
  `safe_info["status"]` 取 `_public_status` 结果，第二项非空时写入 `error`；`except` 兜底分支的 `"status": "error"` 改为 `"failed"`。
- `src/lib/api/videoComposition.ts`：`export type CompositionStatus = 'processing' | 'completed' | 'failed' | 'error'`（保留 `'error'` 兼容旧后端）；
  `pollCompositionStatus`：`completed` → resolve；`failed | error` → reject `buildCompositionFailureMessage(status)`；其他任意字符串 → reject `new Error(\`Unexpected composition status "${status}"\`)`。

#### EXO-13 失败路径就地更新状态并清理

- 新增 `_fail_composition(self, composition_id: str, *, error_details: Dict[str, Any], progress: float) -> None`：对 `self.compositions[composition_id]` 就地 `update(status="failed", progress=progress, error_details=error_details, error=error_details.get("error_summary"))`，保留 `task_id / start_time / warnings / degradations`。
- `:1272-1277`、`:1432-1437` 的整体覆盖改为调用它；`:1313-1321`（缺失归一化索引）在返回失败前调用它。
- `_compose_video_sync` 主体以 `try / finally` 包裹：`finally` 中 `shutil.rmtree(temp_dir, ignore_errors=True)`，并删除本次创建、且不是最终输出文件的中间产物（`_with_audio.mp4`、`_merged.mp4`、`_with_images.mp4`，创建时登记到局部列表 `intermediate_paths`）。

#### EXO-16 合成路径不设固定超时

`subtitle_service` 的执行函数新增参数 `timeout: Optional[float] = 300`；合成路径（`burn_drawtext_filters`）传 `None`；独立 `/add-subtitles` 路由保持 300 s。
超时或失败统一抛出，由合成服务记录 `subtitles` 降级（S7），不再静默继续。

---

### 3.6 手动剪辑（ME-03 / ME-04 / ME-05 / ME-09 / ME-10 / TL2 组）

#### ME-03 字幕识别按片段裁剪区间映射

**复现**：片段位于时间轴 5 s，源区间 10–14 s；源文件 0–2 s 为「intro」、12–14 s 为「kept」→ 输出
`[(5000,7000,'intro'),(17000,19000,'kept')]`，期望 `[(7000,9000,'kept')]`（*[实测，ASR 打桩]*）。切分后的两半各自转写整文件，产生重叠重复字幕；静音 BGM 轨的歌词也被识别。

**设计 · 后端**（`app/services/audio_transcription_service.py`）：

```python
def map_subtitles_to_timeline(
    subtitles: Sequence[Any],
    *,
    clip_start_s: float,
    clip_end_s: float,
    timeline_start_s: float,
    min_duration_ms: int = 100,
) -> List[Dict[str, Any]]:
    """源文件时间（毫秒）→ 时间轴时间：只保留与 [clip_start, clip_end) 相交的部分，裁剪到窗口后平移。"""
    window_start = round(clip_start_s * 1000)
    window_end = round(clip_end_s * 1000)
    offset = round((timeline_start_s - clip_start_s) * 1000)
    mapped = []
    for subtitle in subtitles:
        start = max(subtitle.start_time, window_start)
        end = min(subtitle.end_time, window_end)
        if end - start < min_duration_ms:
            continue
        mapped.append({**<现有输出字段>, "start_time": start + offset, "end_time": end + offset})
    return mapped
```

`_transcribe_single_item`（`:659`）从该条目请求字段读取 `clip_start`（缺省 0）、`clip_end`（缺省或 ≤ clip_start 时取 `clip_start + duration`），
以 `map_subtitles_to_timeline` 替换 `:728-734` 的「整段平移」。输出字典键名保持现状。

**设计 · 前端**：`timeline/lib/subtitleReplacement.ts` 新增 `collectTranscriptionItems(tracks, materials)`，从 `TimelinePanel.tsx:925-988` 的内联构造抽出，
请求字段名保持不变；只收集 `track.type === 'audio' && isTrackRendered(track)` 的条目；`clip_start: item.clipStart ?? 0`、
`clip_end: item.clipEnd ?? (clipStart + item.duration)`（修正 `:987` 的 `||`，避免 0 被当作缺失）。

#### ME-04 字幕编辑弹窗成为真正的模态框

**复现**：选中两个片段 → 打开「编辑字幕」→ 点一个样式预设 → 按 Delete：背后两个片段被删除；空格开始播放；S 弹出替换确认（*[实测：`shouldTimelineHandleKeyEvent → true`、`resolveTimelineShortcut(Delete) → 'delete'`]*）。

**设计**（`components/SubtitleEditModal/SubtitleEditModal.tsx`）：

1. 结构：遮罩 `div.fixed.inset-0`（`onMouseDown` 记录按下目标）→ 卡片 `div role="dialog" aria-modal="true" aria-labelledby="subtitle-edit-modal-title" tabIndex={-1} ref={dialogRef}`。
2. 焦点：打开时聚焦第一个 textarea（无字幕时聚焦「取消」）；关闭时仅当 `document.activeElement` 仍在对话框内才还原到打开前的焦点元素（第 1 轮 IM-35④ 规则）。
3. 键盘：`Escape` → `requestClose()`；`Tab` → `trapTabKey(event, dialogRef.current)`。
4. `requestClose()`：当前编辑内容与打开时快照（`JSON.stringify`）不同 → 打开 `ConfirmationDialog`（`discardChangesTitle / discardChangesBody / discardChangesConfirm`，取消文案 `t.common.cancel`）；相同 → `onClose()`。
5. 遮罩点击仅在 mousedown 与 mouseup 目标均为遮罩时关闭（IM-35③）。
6. 文案：全部可见文本与 `aria-label` 改走 `t.timeline.subtitleEditModal.*`（复用已存在但零引用的 `title / subtitle / noSubtitles / save / cancel / placeholder`，新增 key 见 §6.4）；预设 / 字体 / 位置的 zh-CN 值逐字沿用现有硬编码中文。
7. 保存：`TimelinePanel` 的保存处理（`:1181-1194`）先调用第 1 轮 `getSubtitleCommitBlocker`（外部编辑锁 → 缺轨 → 锁定轨），被阻止时提示原因并保持弹窗打开。

新增 `src/components/ui/focusTrap.ts`：

```ts
export function focusableElementsWithin(container: HTMLElement): HTMLElement[];
/** Tab / Shift+Tab 在容器内循环；焦点不在任何可聚焦元素上时同样回绕到首 / 末元素（RC-17 规则）。 */
export function trapTabKey(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>, container: HTMLElement | null,
): void;
```

`ConfirmationDialog.tsx` 改为调用 `trapTabKey`（行为不变，第 1 轮新增的 `ConfirmationDialog` 焦点 / Tab 圈定用例须保持通过——〔RV-14〕此处指第 1 轮 T27，不是本轮 T27）。

#### ME-05 图片叠加手势结束即入库

**设计**：

1. `VideoPlayerPanel/ImageOverlay.tsx`：鼠标事件改为 Pointer Events + `setPointerCapture`；新增 prop
   `onGestureEnd?: (itemId: string, position: ImagePosition) => void`；手势开始记录 `gestureStartRef`；`pointerup` 时位置与起点不同（`hasPositionChanged`，容差 1e-4）才调用；
   `pointercancel` 或手势中按 `Escape` → 回退到 `gestureStartRef` 并经 `onPositionChange` 更新本地预览（不入库）。
2. 按钮语义：✓ 改为「完成」（取消选中，`imageOverlay.done`），× 改为「还原到本次选中前的位置」（`imageOverlay.revert`）；两者 `aria-label` 同文案（替换 `:316-335` 的硬编码英文）。
3. `VideoPlayerPanel.tsx`：`onGestureEnd` → `onImagePositionConfirm(itemId, position)`（VEI 现有 `handleImagePositionConfirm` → `updateImagePositionAction`，值未变不记录）；
   选中叠加时把当前位置记入 `selectionEntryPositionRef`，× 调用 `onImagePositionConfirm(itemId, entryPosition)`。
4. 首次加载自动适配尺寸（`ImageOverlay.tsx:95-105`）：改为调用 store `updateItemImagePosition`（不写历史），锁定时跳过——保证 VEI 的 `currentTimelineState` 与 store 一致，导出与自动保存不再读到「只存在于组件状态」的位置。
5. S9：`externalEditLock` 非空时 `VideoPlayerPanel` 不渲染拖动 / 缩放手柄，`updateImagePositionAction` 在 store 层拒绝。

纯函数 `hasPositionChanged(a: ImagePosition, b: ImagePosition): boolean` 放在 `VideoPlayerPanel/imageOverlayGeometry.ts`。

#### ME-09 切分最小片段长度（含 TL2-15 常量归位）

1. `domain/value-objects/Duration.ts` 导出 `MIN_CLIP_DURATION_SECONDS = 0.1`；删除 `DurationCalculationService` 的 `MIN_DURATION_SECONDS` 与 `dragMachine.ts:30` 的重复常量，
   全部引用改为新常量；`DurationCalculationService.ts:14` 对 `Track` 改为 `import type`（消除 entity→service→entity 的类型级环）。
2. `domain/services/SplitService.ts`：切点须满足 `splitTime − start ≥ MIN_CLIP_DURATION_SECONDS` 且 `end − splitTime ≥ MIN_CLIP_DURATION_SECONDS`，否则该条目不切；
   静态图片（`originalMaterialType === 'image'`）两半的裁剪区间分别为 `[0, leftDuration]` 与 `[0, rightDuration]`。
3. `store/actions/splitItem.ts`：`splitAction` 返回 `SplitOutcome = 'split' | 'none' | 'too-close'`——至少一个条目被切分为 `'split'`；无条目被切分且至少一个因过近被跳过为 `'too-close'`；其余 `'none'`。`'too-close' / 'none'` 不写历史。
4. 调用方（剪切工具点击、切分快捷键）在 `'too-close'` 时 `showInfo(t.timeline.messages.splitTooCloseToEdge)`。

#### ME-10 素材拖放与「添加到时间轴」同一路径（合并 TL2-21）

1. 素材面板拖拽开始（现有 `dataTransfer.setData('application/json', …)` 处）追加 `dataTransfer.setData(\`${MATERIAL_DRAG_MIME_PREFIX}${material.type}\`, material.id)`。
2. 新增 `timeline/lib/materialDragTypes.ts`：`MATERIAL_DRAG_MIME_PREFIX = 'application/x-ecliptrix-material-'`；
   `readDraggedMaterialType(types: readonly string[]): MaterialItem['type'] | null`（`dragenter / dragover` 中 `DataTransfer.types` 可读而 `getData` 不可读）。
3. `timeline/Track.tsx`：`dragenter / dragover` → `type = readDraggedMaterialType(e.dataTransfer.types)`；`accepts = type !== null && !track.isLocked && isTrackCompatibleWithMaterial(...)`（RC-20 `lib/trackForMaterial.ts`，按其现有签名传入素材类型）；
   `accepts` 时 `preventDefault()`、`dropEffect = 'copy'`、显示高亮与「拖放到…」提示；否则 `dropEffect = 'none'`，锁定轨提示 `trackLocked`（RC-20 已用 key）、不兼容提示 `timeline.messages.incompatibleTrack`。
   `dragleave` 仅在 `relatedTarget` 不在轨道内容区内时清除高亮。删除 `:105` 在 dragenter 中调用 `getData` 的逻辑。
4. `drop`：解析 `application/json` 得到 `id` → 新 prop `onMaterialDrop(materialId: string, trackId: string)`（`TimelinePanel → TrackContainer → Track` 透传）。
5. `TimelinePanel`：新增 `handleMaterialDropById(materialId, trackId)`——在 `materials` 中查找；找不到 → `showError(t.timeline.messages.materialNotFound)`；找到 → 现有 `handleMaterialDrop(material, trackId)`（`:640`，含 `toMaterialData`、锁定提示、视频预加载与 S9 锁检查）。
6. `store/slices/dragSlice.ts` 的 `dropMaterial` 在改动后若无调用方则删除（实现节点 grep 确认）。

#### TL2-02 拖动左边缘裁剪平移运镜窗口

1. `dragSlice.ts:197-208` 的 resize 提交分支改为：`if (hasResizeChanged(preview, snapshot.context)) resizeItemAction(get, preview.itemId, edge, position);`（`resizeItemAction` 已包含锁定检查、记录历史、裁剪、平移运镜、autoOrganize、同步捕获）。
2. `store/actions/resizeItem.ts:39-48`：运镜窗口位移量改为以实体**实际** `clipStart` 变化量计算（`after.clipStart − before.clipStart`），被钳制的裁剪同样平移正确的距离；位移为 0 时不改运镜。
3. `hasResizeChanged(preview, context)`：`|preview.startTime − context.originalStartTime| > 1e-6 || |preview.duration − context.originalDuration| > 1e-6`，放在 `dragSlice.ts` 模块内（与 TL2-16 的 `hasMoveChanged` 并列）。

#### TL2-03 撤销 / 重做后修剪选区

`historySlice.ts:105-129` 的 `undo` 与 `redo` 在 `restoreFromSnapshot` 之后调用 `get().pruneSelection()`（第 1 轮 S1 已实现）；若存在正在行内编辑的字幕 id（`TimelineItem` 双击编辑态使用的 store 字段）且对应条目已不存在，一并清除。

#### TL2-04 历史与外部写入不改变视图状态

1. `TimelineAggregate.restore(snapshot)`（`:602-613`）：只恢复 `_tracks` 与 `_totalDuration`；保留 `_zoomLevel / _scrollLeft / _playbackRate / _isPlaying / _snapToGrid / _gridSize`；
   `_currentTime = Math.min(this._currentTime, maxItemEnd)`（与 TL2-20 同一钳制；无条目时为 0）。
2. `replaceTimelineAction`：
   ```ts
   const incoming = TimelineAggregate.fromPlainObject(data);          // 先构造（AG2-08：抛错时尚未写历史）
   const incomingTracks = incoming.toPlainObject().tracks;
   if (JSON.stringify(incomingTracks) === JSON.stringify(state.exportToData().tracks)) return false;
   state.recordAction('REPLACE_TIMELINE', { reason });
   const view = state.exportToData();
   const totalDuration = incoming.calculateTotalDuration().value;
   state.importFromData({ ...view, tracks: data.tracks, totalDuration, currentTime: Math.min(view.currentTime, totalDuration) });
   get().pruneSelection();
   get().captureNextState();
   return true;
   ```
3. 项目水合（`projects/hydrateTimeline.ts`）继续直接 `importFromData`，保存的视图设置照常加载。

#### TL2-06 片段热区：短片段可移动、边缘有光标反馈

**决策（附录 C D-4）**：保留「未选中片段也可直接拖边缘裁剪」（主流 NLE 惯例），缺陷在于热区不可见与短片段无移动区，而不是热区本身。

1. `domain/machines/dragMachine.ts`：
   ```ts
   export const MIN_MOVE_ZONE_PX = 12;
   export function edgeHandleWidthPx(itemWidth: number): number {
     return Math.min(RESIZE_HANDLE_WIDTH, Math.max(0, (itemWidth - MIN_MOVE_ZONE_PX) / 2));
   }
   ```
   `detectInteractionType(relativeX, itemWidth)`（`:42-53`）以 `edgeHandleWidthPx(itemWidth)` 代替固定的 `RESIZE_HANDLE_WIDTH`，宽度为 0 时一律为 `move`。
2. `TimelineItem.tsx`：非交互状态下 `onPointerMove` 计算热区，仅在变化时 `setHoverZone`；样式 `cursor = hoverZone === 'move' ? 'grab' : 'ew-resize'`（锁定轨仍为 `not-allowed`，IM-05）；
   裁剪手柄在 `isSelected || hoverZone !== 'move'` 时渲染，宽度取 `edgeHandleWidthPx(width)`（替代 `:705-716` 固定 6 px）；`pointerleave` 复位为 `'move'`。

#### TL2-09 时间显示精度

`timeFormat.ts:15`：`const totalCentiseconds = Math.floor(safe * 100 + 1e-6)`，由该整数派生百分秒、秒、分、时。保持 `0.999 → 0:00.99`（`timeFormat.test.ts:35-37`）。

#### TL2-16 / TL2-17 / TL2-18 拖拽状态机健壮性

1. **TL2-16**：`dragMachine.ts` 抽出 `previewFor(context, deltaX, targetTrackId)`（由 dragging 状态 `POINTER_MOVE` 的现有 assign 逻辑提取），在「detecting → dragging / resizing」越过阈值的那次转换中同样调用，保证进入交互态即有预览；
   `committed` 状态增加 `ESCAPE → idle`。`dragSlice.ts:134` 改为 `if (committed) { if (preview && hasChanged) { …现有提交… } actor.send({ type: 'COMMIT_COMPLETE' }); }`——
   只要进入 `committed` 就一定发送 `COMMIT_COMPLETE`；`hasChanged` 对移动为「跨轨 || 有交换目标 || `|preview.startTime − originalStartTime| > 1e-6`」，对裁剪为 `hasResizeChanged`。未变化时不回滚、不记录历史（拖回原位不再产生空历史）。
2. **TL2-17**：移动事件增加 `deltaY`（`TimelinePanel` 在 `dragStartXRef` 旁新增 `dragStartYRef`）；`move` 交互的阈值判定改为 `Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD`；
   裁剪交互仍只看水平位移（边缘上的垂直抖动不会开始裁剪）。
3. **TL2-18**：
   - `TimelinePanel` 键盘处理：`resolveTimelineShortcut` 结果属于 `MUTATING_TIMELINE_SHORTCUTS` 且 `useTimelineStore.getState().isInteracting` 为真时直接返回；
   - `historySlice.undo / redo`：`isInteracting` 为真时返回；
   - `replaceTimelineAction`：开头 `if (state.isInteracting) state.cancelDrag();`；
   - 拖拽提交：被拖条目已不存在时跳过记录并发送 `COMMIT_COMPLETE`；
   - `TimelineToolbar`：`isInteracting` 期间撤销 / 重做 / 删除按钮置灰。

#### TL2-19 编辑锁缺口

按 S9 落地。本条额外列出 UI 触点（实现时逐项核对）：

| 触点 | 行为 |
|---|---|
| 时间轴区域外层容器（`VideoEditingInterface.tsx:2329-2332`） | `inert={agent.agentIsExecuting ? true : undefined}` |
| 素材面板「添加到时间轴」（`VideoEditingInterface.tsx:1204-1245` → `TimelinePanel.tsx:688-715`） | 入口先检查锁，锁定时 `showWarning(editLockedByAgent)` 并返回 |
| 图片叠加手柄与确认（`VideoPlayerPanel`、VEI `:1873-1876`） | 锁定时不渲染手柄；store 层拒绝 |
| 工具栏整理（`TimelineToolbar.tsx:196-206`）与导入（`:107-120`） | 锁定时置灰；`handleOrganizeMaterials` 与导入路径 store / action 层拒绝 |
| 轨道头锁定 / 显示 / 删除 / 音量（`Track.tsx:182-224`）与添加轨道（`TrackContainer.tsx:437-493`） | `inert` 覆盖键盘；`trackActions` 在 store 层拒绝 |
| 执行前已打开的运镜 / 字幕编辑弹窗 | 保存 / 应用按钮在锁定时置灰并显示 `editLockedByAgent` |
| 剪切工具 | 锁定变为非空时切回选择工具 |
| 〔RV-03〕复制片段（`TimelinePanel.tsx:760-806`）与整理素材（`:815-830`） | 直接调用 slice，调用点首行检查锁并提示；工具栏整理按钮置灰 |
| 〔RV-03〕JSON 导入 / 待处理时间轴数据（`VideoEditingInterface.tsx:1716-1734` → 外部同步） | 锁定时不应用，提示 `editLockedByAgent` 并 `resyncOwnerFromStore()` |

#### TL2-20 播放头随时间轴变短而钳制

`TimelineAggregate.recalculateTotalDuration`（`:661-663`）在更新总时长后：`this._currentTime = Math.min(this._currentTime, maxItemEnd)`（无条目时为 0；`maxItemEnd` 为未加 0.001 下限前的最大结束时间）。
现有播放头订阅（`TimelinePanel.tsx:1240-1247`）随之把预览定位到新位置。

#### TL2-23 锁定轨保留点选

删除 `Track.tsx:567` 的 `pointerEvents: 'none'`。锁定轨条目已拒绝拖拽、裁剪、剪切、编辑与分离（`TimelineItem.tsx:230,245,289,304-308`），拖放处理同样拒绝（`Track.tsx:102,122,135`），点选、工具提示与 `not-allowed` 光标恢复可见。

### 3.7 剪辑 Agent（AG2 组）

#### AG2-01 回报实际位置、插入点语义

**复现**：A[0–5] B[5–10] C[10–15]，`move_clip C → 0` → 结果 `startTime: 0`，实际 C 落在 5（A@0, C@5, B@10）；
A[0–5] B[20–25] 上 `add_to_track` 4 s @22 → 结果 22，实际新片段 @10、B 20→5（*[实测]*）。

**决策（附录 C D-2）**：保留 reconcile「整轨自 0 贴紧」（与 UI `organizeVideoAudioTracks` 一致，S8），不引入只推开重叠片段的 ripple 规则；修复两点——同起点时被操作片段优先、结果回报实际位置。

1. `reconcile.ts`：`packFlushTrack(track, epsilon, anchorClipId?: string)` 的排序比较器：
   ```ts
   (a, b) => roundTo6(a.startTime) - roundTo6(b.startTime)
     || (a.id === anchorClipId ? -1 : b.id === anchorClipId ? 1 : 0)
     || originalIndex(a) - originalIndex(b)
   ```
   `reconcileOverlapsAfterAgentOp(state, operation)`：`anchorClipId = operation.type === 'move_clip' ? operation.clipId : operation.type === 'add_clip' ? operation.clip.id : undefined`。客户端与服务端共用此函数，布局一致。
2. `tools/index.ts` 新增：
   ```ts
   export function collectClipStarts(state: TimelineState, trackIds: readonly string[]): Map<string, { trackId: string; startTime: number }>;
   export function diffClipStarts(
     before: ReadonlyMap<string, { trackId: string; startTime: number }>,
     after: ReadonlyMap<string, { trackId: string; startTime: number }>,
     excludeClipId: string,
   ): Array<{ clipId: string; from: number; to: number }>;
   ```
3. `moveClip.ts` / `addToTrack.ts`：`updateTimeline` 之前 `before = collectClipStarts(context.timelineState, affectedTrackIds)`，之后读取实际位置，结果：
   ```json
   { "success": true,
     "clip": { "id": "c", "trackId": "video-track-1", "startTime": 5, "requestedStartTime": 3, "repositioned": true, "duration": 5 },
     "shiftedClips": [ { "clipId": "b", "from": 5, "to": 10 } ] }
   ```
   `repositioned = |实际 − 请求| > 1e-6`；`shiftedClips` 仅非空时出现；`add_to_track` 未指定起点时 `requestedStartTime` 省略。
4. 两个工具的 description 追加：「视频与音频轨上的片段首尾相接排列；startTime 是插入点——片段排在同一时刻开始的片段之前，随后整轨重排；结果中的 startTime 是实际位置。」

#### AG2-02 客户端应用结果可见（共享 `operationGuards.ts`）

```ts
// src/lib/video-editing-agent/operationGuards.ts
export type OperationRejectReason = 'clip-not-found' | 'track-not-found' | 'target-track-missing' | 'invalid-time';
export type OperationValidation =
  | { ok: true }
  | { ok: false; reason: OperationRejectReason; trackId?: string; clipId?: string };
export function validateOperationTargets(state: TimelineState, operation: AgentTimelineOperation): OperationValidation;

// src/lib/video-editing-agent/OperationApplier.ts
export type ApplyOutcome =
  | { status: 'applied' }
  | { status: 'noop'; reason: 'no-change' }
  | { status: 'skipped'; reason: 'locked-track'; trackId: string }
  | { status: 'rejected'; reason: OperationRejectReason; trackId?: string; clipId?: string };
// apply(toolCallId, operation): Promise<ApplyOutcome>   （原 Promise<void>）
```

- 校验规则：`add_clip` 目标轨存在且时间有效（AG2-08）；`delete_clip / trim_clip / resize_clip` 片段存在；`move_clip` 源轨含该片段、目标轨存在——**先校验后 `splice`**（修复 `:556-567`）；
  批量操作逐条校验，任一 `rejected` 则整批不应用（避免半个分镜）。
- 服务端 `agent.ts:403-409`「目标轨缺失时原地更新位置」兜底删除，改为同一 `validateOperationTargets`。
- `AgentEventRouter.handleToolResult`：`outcome.status === 'rejected'` → `stateManager.updateToolStatus(id, 'error', { ...result, success: false, clientApplyError: { reason, trackId, clipId } })`；
  `skipped / noop` 维持现状。Router 保持纯分发，本地化在 UI：`ToolStep.tsx` 读取 `clientApplyError.reason` 显示 `t.agentApply.notApplied` + `t.agentApply.reasons[reason]`。
- 无变化时不记补丁、不触发外部时间轴更新（与第 1 轮 IM-25 一致）。

#### AG2-06 事件链排空后才结束执行

1. `useAgentExecutionState.ts`：`AgentExecutionStatus` 增加 `'finishing'`。
   ```ts
   onComplete: async () => {
     updateState({ status: 'finishing' });
     try { await params.onComplete?.(); } finally { updateState({ status: 'completed' }); }
   },
   ```
   `onError` 同构（`finishing → error`）；`cancel()`：`updateState({ status: 'finishing' })` → `await params.onCancel?.()` → `updateState({ status: 'cancelled', error: null })`。
2. `useAgentExecution.ts`：`runAfterQueuedEvents(fn)` 返回链尾 promise；`onComplete / onError / onCancel` 回调返回它（封口在入链之前捕获本轮 ref，保持 IM-26）。
3. `agentIsExecuting = status === 'executing' || status === 'retrying' || status === 'finishing'`（`:235-236`）。
4. `sendAgentMessage`：开头 `if (sendingRef.current) return; sendingRef.current = true;`，`try { await eventChainRef.current; …捕获 turnStart 与请求体 timelineState… } finally { sendingRef.current = false; }`（重入保护覆盖到请求发出为止）。
5. 消费方：`TimelineChatPanel.tsx:95,180,194` 把 `'finishing'` 与 `'executing'` 同等对待；`AgentBusyBar`、`VideoChatWindow` 经 `agentIsExecuting` 自动覆盖；S9 锁（`VideoEditingInterface.tsx:2102`）跟随 `agentIsExecuting`，无需改动。
6. 〔RV-05〕**排空看门狗**：`runAfterQueuedEvents` 只捕获拒绝（`useAgentExecution.ts:285-292`），一个永不结束的环节会让状态停在 `finishing`、时间轴永久锁定。
   `useAgentExecutionState.ts` 新增模块常量 `FINISHING_WATCHDOG_MS = 15_000`，三个终止回调改为：
   ```ts
   const drained = await settleWithin(params.onComplete?.() ?? Promise.resolve(), FINISHING_WATCHDOG_MS);   // 'settled' | 'timed-out'
   if (drained === 'timed-out') {
     console.error('[useAgentExecutionState] event chain did not drain before the watchdog', { status: 'completed' });
     params.onFinishingTimeout?.();                    // useAgentExecution → showWarning(t.agentApply.finishingTimedOut)
   }
   updateState({ status: 'completed' });               // onError → 'error'，cancel → 'cancelled'
   ```
   `settleWithin(promise, ms)` 为同文件私有纯函数（`Promise.race` + 清理定时器）。超时后事件链继续运行：迟到的 Agent 操作仍以 `reason: 'agent'` 写入（该原因任何时候都允许），不会丢失。
7. 〔RV-05〕`finishing` 期间 `cancelExecution` 无效（SSE 已结束，`useAgentExecutionState.ts:293-296` 直接返回）：`TimelineChatPanel` 在 `status === 'finishing'` 时
   停止按钮 `disabled`，忙碌文案显示 `t.agentApply.finishing`（`aria-live="polite"` 沿用现有忙碌区域）。

#### AG2-07 执行中卸载也封口

`useAgentExecution.ts:700-705` 卸载清理改为：`if (agentIsExecutingRef.current) cancelAndSealRef.current(); else stateManagerRef.current?.destroy();`。
`cancelAndSealRef` 指向对话切换路径（`:689-694`）已使用的「封口 + 取消」函数；`agentIsExecutingRef` 每次渲染同步。
封口写入经 `updateConvMessagesRef`，其所有者生命周期长于 `VideoEditingInterface`；写入须按对话 id 合并（不得用卸载时闭包里的旧 `content` 整体覆盖）。

#### AG2-09 `auto_fix_overlaps` 只处理有重叠的轨道

`reconcile.ts` 新增并导出：

```ts
export function trackHasOverlap(track: Track, epsilon: number): boolean;
export function packOverlappingTracks(
  state: TimelineState, epsilon: number,
): { state: TimelineState; fixedTrackIds: string[] };   // 只处理 isReorganisable(track) && trackHasOverlap(track)
```

`isReorganisable` 一并导出。`tools/autoFixOverlaps.ts` 改用 `packOverlappingTracks`，结果 `{ success, fixedCount, fixedTrackIds, shiftedClips }`；
客户端应用 `auto_fix_overlaps` 对应操作的分支调用同一函数，两端一致。

#### AG2-10 执行中禁用 Agent 撤销

- `useAgentExecution.ts` 的 `undoTurn / undoSingleOperation`（`:551-633`）开头：`agentIsExecutingRef.current || useTimelineStore.getState().externalEditLock !== null` → `showWarning(t.agentUndo.blockedWhileRunning)` 并返回。
- `VideoChatWindow → TimelineChatPanel → AgentResponseNode` 透传 `undoDisabled={agentIsExecuting}`；按钮 `disabled` 且 `title` 显示同一文案。

#### AG2-11 「上一轮被停止」提示只针对最近一轮

`messageConverter.ts`：同时定位 `lastAssistantIndex`（最后一条助手消息）与 `lastCancelledAssistantIndex`；
仅当 `lastCancelledAssistantIndex !== -1 && lastCancelledAssistantIndex === lastAssistantIndex` 时追加提示（`:153-161`），注释同步修正。

#### AG2-12 内联媒体不进入模型上下文与项目数据

1. 新增 `src/lib/inlineUrl.ts`：`export function isInlineMediaUrl(value: unknown): boolean`（`typeof value === 'string' && /^(data:|blob:)/i.test(value)`）；删除 `trackPatch.ts:132` 的私有 `isInlineThumbnail` 并改用之。
2. `tools/index.ts:201` `serializeMaterial`：`thumbnailUrl` 仅在非内联时输出；不输出 `localProxyUrl`。
3. 新增 `src/lib/video-editing-agent/compactToolResult.ts`：
   ```ts
   /** 深拷贝工具结果，把内联 data:/blob: 字符串替换为占位文本；深度 > 8 的子树原样返回。 */
   export function compactToolResult(value: unknown, depth?: number): unknown;
   export const INLINE_MEDIA_PLACEHOLDER = '[inline media omitted]';
   ```
   `AgentStateManager.updateToolStatus`（`:119-123`）存储 `compactToolResult(result)`；`messageConverter`（`:111-114`）转换历史工具结果时同样调用（旧消息即时生效）。
   〔RV-16〕实现节点须 grep 工具卡片（`VideoChatWindow/timeline/ToolStep.tsx` 及其子组件）中从工具结果读取 `thumbnailUrl / url` 渲染图片的位置；
   值等于 `INLINE_MEDIA_PLACEHOLDER` 时渲染现有通用素材图标而不是 `<img>`，并以源码断言用例钉住（并入 T51）。
4. `useAgentExecution.ts:469` 请求体素材经 `stripInlineMediaForAgent(materials)`（同文件私有函数：移除内联 `thumbnailUrl` 与 `localProxyUrl`）。

#### AG2-14 `compose_storyboard` 类型校验与跳过报告

`tools/composeStoryboard.ts`：循环内 `const mismatch = materialTrackMismatchError(track, material.type); if (mismatch) { skipped.push({ scene_id, material_id, reason: mismatch.error }); continue; }`；
素材不存在同样进入 `skipped`；自动建轨（`:66-82`）延迟到第一个片段被接受时才加入状态；结果新增 `skipped: Array<{ scene_id: string; material_id: string; reason: string }>`（空数组时省略）。

#### AG2-15 `trim_clip` 出点推导与图片

1. `tools/trimClip.ts:32-42`：`currentStart = clip.clipStart ?? 0`；`currentEnd = clip.clipEnd ?? currentStart + clip.duration`；新值须有限且 `clipStart ≥ 0`、`clipEnd > clipStart`；
   上界检查 `clipEnd ≤ originalDuration + 1e-3`。
2. 图片片段（`originalMaterialType === 'image'` 或素材类型为 image）：拒绝，`error: 'Images have no source range; use resize_clip to change their duration'`。
3. `tools/resizeClip.ts:60`：图片同时下发 `clipEnd = (clip.clipStart ?? 0) + newDuration`，保持 `duration === clipEnd − clipStart`。
4. `tools/addToTrack.ts:117-127`：图片素材不写 `originalDuration`（与第 1 轮 TL-04「图片不含 originalDuration」一致）。

#### AG2-16 `remove_material` 不破坏时间轴

1. `tools/removeMaterial.ts`：执行前统计引用（复用 S10 `findTimelineUsages`；若 Agent `TimelineState.tracks` 与 `TrackData` 字段不兼容，则在 `tools/index.ts` 提供同语义的 `findClipIdsUsingMaterial(state, materialId)`，二者只保留一个实现）；
   有引用时返回 `{ success: false, error: 'Material is used by clips on the timeline; delete those clips first', usedByClipIds }`，不下发删除；description 改为「素材仍被时间轴片段使用时拒绝删除」。不提供 `force` 参数（附录 C D-5）。
2. `tools/index.ts` 新增 `toAgentClipMaterial(material)`：`{ id, name, type, url, serverUrl, cacheUrl, storageKey, thumbnailUrl（非内联时）, metadata: { storageKind, storageKey, localResolvedUrl }（存在时） }`；
   `addToTrack.ts:129-136` 与 `composeStoryboard.ts` 使用。
3. `OperationApplier.addClipToState` 与 `agent.ts` 的本地应用把 `url / serverUrl / cacheUrl / storageKey` 写到新条目（字段名与 `ItemPlacementService.toMaterialData` 一致），`AgentMaterialData` 类型同步扩展（§6.3）。

### 3.8 AI 混剪 / 自动混剪（AM2 / AS2 组）

#### AS2-01 / AS2-02 自动混剪以当前脚本为准

`lib/aiMix/planScriptAutoMix.ts`：

```ts
export interface ScriptSegmentRef {
  id: string;
  videos?: ReadonlyArray<Pick<MaterialItem, 'id'>>;
  textHash?: string;               // 〔RV-07〕segmentTextHash(当前段落)
}
export interface PlanScriptAutoMixOptions { segments?: readonly ScriptSegmentRef[] }

export interface ScriptAutoMixPlan {
  placements: AutoMixPlacement[];
  segments: AutoMixSegmentReport[];
  ignoredDuplicateMaterialIds: string[];
  orphanedMaterialIds: string[];   // 新增：带脚本标记但段落已不在当前脚本中的素材
  totalDuration: number;
}

export function planScriptAutoMix(
  materials: readonly MaterialItem[], options?: PlanScriptAutoMixOptions,
): ScriptAutoMixPlan;
```

1. **AS2-02**：`options.segments` 已提供时——只保留 `segment_id` 在其中的分组；段落顺序与 `segmentNumber` 取其在 `segments` 中的下标 + 1（不再使用写入时的 `segment_number`）；
   在脚本中但无任何素材的段落报告 `skipped-no-audio`；其余带脚本标记的素材 id 进入 `orphanedMaterialIds`。未提供 `segments`（`undefined`）时保持现有分组规则（兼容无脚本场景与现有测试）。
2. **AS2-01**：视频选取——提供 `segments` 且该段 `videos` 非空：视频列表 = `segment.videos` 的 id 按顺序映射到素材库中 `isPlayable` 且 `metadata.segment_id` 匹配的素材，其余该段视频进入 `ignoredDuplicateMaterialIds`；
   否则（无脚本或旧数据）：取该段视频 `assignedAt` 的最大值 `latest`，`latest` 有限时只保留 `assignedAt === latest` 的视频（按槽位排序），`latest` 无限（全无时间戳）时沿用现有逐槽取新。音频继续用 `keepNewest`。
3. `VideoEditingInterface` / `useScriptAutoMix`（AS2-04）调用 `planScriptAutoMix(materials, { segments: content?.scriptSegments })`；**不得**传入 `getMockScriptSegments`（`VideoEditingInterface.tsx:2257`）。
   `orphanedMaterialIds.length > 0` 时 `showInfo(t.videoEditing.autoMix.orphansIgnored.replace('{count}', n))`。
4. **〔RV-07〕过期配音按文本哈希排除**：Agent 路径的段落 id 按下标生成且跨脚本版本复用（`VideoEditingInterface.tsx:103,114,620` 均为 `agent-segment-${i}`），
   仅按 id 过滤无法排除旧版本配音。新增纯函数模块 `src/components/video/lib/aiMix/segmentTextHash.ts`：
   ```ts
   /** 段落配音文本的稳定哈希（FNV-1a 32 位，十六进制）：文本取 TTS 实际朗读的内容——narrationText.trim() 非空时用它，否则 sentences 文本按现有 TTS 拼接方式连接。 */
   export function segmentTextHash(segment: Pick<ScriptSegment, 'narrationText' | 'sentences'>): string;
   ```
   - `ScriptPanel.tsx` 创建配音素材处（`:1521-1527` 的 `metadata`）追加 `segment_text_hash: segmentTextHash(segment)`；拼接方式以该处 TTS 请求实际使用的文本为准（实现节点核对）。
   - `ScriptSegmentRef` 增加可选 `textHash?: string`；VEI / `useScriptAutoMix` 传入 `segments.map(s => ({ id: s.id, videos: s.videos, textHash: segmentTextHash(s) }))`。
   - 规划：提供 `segments` 且段落有 `textHash` 时，`metadata.segment_text_hash` 为字符串且 ≠ `textHash` 的配音视为过期，进入 `orphanedMaterialIds`；
     无 `segment_text_hash` 的旧配音照常参与（兼容已有项目）。该段因此无可用配音时报告 `skipped-no-audio`（提示用户重新生成配音）。视频匹配与文本无关，不做哈希比对。

#### AS2-03 视频道无空洞

`coverWithVideos`（`planScriptAutoMix.ts:155-173`）改写，删除 `MAX_LOOPED_CLIPS`：

```ts
function coverWithVideos(videos: readonly MaterialItem[], start: number, span: number, segmentNumber: number) {
  const placements: AutoMixPlacement[] = [];
  if (videos.length === 0) return { placements, looped: false, covered: span < MIN_CLIP_SECONDS };
  const shortest = Math.min(...videos.map((video) => video.duration ?? 0));   // isPlayable 保证 ≥ 0.1
  const maxClips = videos.length + Math.ceil(span / shortest) + 1;             // 有限上界
  let remaining = span;
  let looped = false;
  for (let index = 0; index < maxClips && remaining >= MIN_CLIP_SECONDS; index += 1) {
    looped = looped || index >= videos.length;
    const video = videos[index % videos.length];
    let take = Math.min(video.duration ?? 0, remaining);
    const leftover = remaining - take;
    if (leftover > 1e-9 && leftover < MIN_CLIP_SECONDS && remaining - MIN_CLIP_SECONDS >= MIN_CLIP_SECONDS) {
      take = remaining - MIN_CLIP_SECONDS;                                     // 为下一段留出完整的 0.1 s
    }
    placements.push(place(video, 'video', start + span - remaining, take, segmentNumber));
    remaining -= take;
  }
  const last = placements[placements.length - 1];
  if (remaining > 1e-9 && last && (last.material.duration ?? 0) - last.duration >= remaining) {
    last.duration = roundTime(last.duration + remaining);                     // 用最后一段的源余量补齐
    last.clipEnd = roundTime(last.clipEnd + remaining);
    remaining = 0;
  }
  return { placements, looped, covered: remaining <= 1e-9 };
}
```

- `AutoMixSegmentReport.status` 增加 `'video-short'`：`covered === false` 时该段报告 `video-short`（优先于 placed / looped / reused）；VEI（或 `useScriptAutoMix`）提示 `t.videoEditing.autoMix.videoShort.replace('{list}', 段号列表)`（zh-CN 用「、」，其他「, 」）。
- `applyScriptAutoMix.ts:136` 注释改为说明「由 planScriptAutoMix 保证每段视频覆盖其配音，布局是 organizeVideoAudioTracks 的不动点（S8）」。

#### AS2-04 确认时重新排布

新增 `src/components/video/hooks/useScriptAutoMix.ts`，从 `VideoEditingInterface.tsx:1926-1955` 抽出自动混剪编排：

```ts
export interface UseScriptAutoMixOptions {
  getMaterials: () => readonly MaterialItem[];
  getScriptSegments: () => readonly ScriptSegmentRef[] | undefined;
}
export interface UseScriptAutoMixReturn {
  requestAutoMix: () => void;                                   // 按钮入口：锁检查 → 排布 → 目标检查 → 需要替换时打开确认
  confirmState: { isOpen: boolean; replacedItemCount: number };
  confirmAutoMix: () => void;                                   // 以确认时的最新数据重新排布与检查
  cancelAutoMix: () => void;
}
```

- 确认框状态只存 `{ isOpen, replacedItemCount }`，不存 `plan`。
- `confirmAutoMix`：重新 `planScriptAutoMix(getMaterials(), { segments: getScriptSegments() })` 与 `checkAutoMixTargets(...)`（IM-31）；拒绝 → 沿用现有拒绝提示；
  `replacedItemCount` 与确认时展示的不同 → 以新数量重新打开确认框；相同 → 应用。
- `useLocale / useNotification` 在 hook 内获取；VEI 只渲染 `ConfirmationDialog` 并连接回调。

#### AM2-01 AI 方案写入即稳定（S8）

**前端**（`lib/aiMix/mergeAiMixTimeline.ts`）：以 `packLane` 取代 R6 `removeOverlaps`：

```ts
/** R6（S8）：按 startTime 排序（同值保持原顺序）后自 0 首尾相接，与 organizeVideoAudioTracks 规则一致。 */
function packLane(items: readonly TimelineItemData[], packedItemIds: string[]): TimelineItemData[] {
  let cursor = 0;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.startTime - b.item.startTime || a.index - b.index)
    .map(({ item }) => {
      const startTime = cursor;
      cursor += item.duration;
      if (Math.abs(startTime - item.startTime) > OVERLAP_TOLERANCE_SECONDS) packedItemIds.push(item.id);
      return startTime === item.startTime ? item : { ...item, startTime };
    });
}
```

`AiMixMergeResult` 新增 `packedItemIds: string[]`；`useAIMixedEditing.applyAiMixPlan` 的 `warningCount` 计入其长度（沿用 `partialWarning` 文案）。

**后端**（`app/services/timeline_parser_service.py`）：以 `_pack_lanes(timeline, report)` **取代** `_resolve_lane_overlaps` 与 `_shift_lane_overlaps`
（打包本身消除重叠，且不做二次裁剪——同时修复 AM2-07）：

```python
def _pack_lanes(self, timeline: SimplifiedTimelineModel, report: SanitizeReport) -> None:
    lanes = [("video_segments", timeline.video_segments), ("image_segments", timeline.image_segments)]
    lanes += [(f"audio_segments[{track}]", segs) for track, segs in _audio_segments_by_track(timeline.audio_segments)]
    for label, segments in lanes:
        cursor = 0.0
        ordered = sorted(enumerate(segments), key=lambda pair: (pair[1].start_time, pair[0]))
        for _, segment in ordered:
            if abs(segment.start_time - cursor) > 1e-3:
                report.adjusted.append(
                    f"{report.label_of(segment, label)}: moved from {segment.start_time:.2f}s to {cursor:.2f}s to close a gap"
                )
            segment.start_time = cursor
            cursor += segment.duration
```

`sanitize_simplified_timeline`（`:589`）步骤顺序：`_canonicalise_audio_tracks`（AM2-02）→ 现有改道 / 类型过滤 / 源区间规整 / `_clip_to_total` → `_pack_lanes` → `_warn_past_video_end`（AM2-06）；
随后沿用 `:625-627` 重算 `total_duration`。`_audio_segments_by_track` 为模块私有函数，按规整后的 `track` 分组并保持首次出现顺序。
第 1 轮 T1 用例 `test_sanitize_shifts_same_lane_overlap_and_keeps_other_lanes` 的断言按新警告文案更新。

**提示词**（`ai_mixed_editing_service.py`）：要求段追加「各轨道片段从 0 秒开始首尾相接、不留空隙」；示例改为 AM2-06 的一致示例。

**决策（附录 C D-3）**：图片轨同样贴紧（产品现有规则），AI 放在非 0 时刻的图片会被移到图片道前部并计入 `partialWarning`；
「图片轨自由定位」列入附录 A N-03。

#### AM2-02 规整音频段轨道名

1. `app/models/ai_mixed_editing_models.py:101`：`track: Optional[Union[str, int]] = "audio-track-1"`。
2. `_canonicalise_audio_tracks(timeline, report)`（sanitize 第一步）：
   - 字符串或整数中的末尾整数 n → `audio-track-{max(1, n)}`（`"Audio Track 2"`、`2`、`"audio-track-2"` 均为 `audio-track-2`）；
   - `None`、空串、以 `video-track` / `image-track` 开头 → `audio-track-1`，记录 adjusted；
   - 其他标签（如 `"bgm"`）→ 按首次出现顺序分配下一个未使用的 `audio-track-k`，记录 adjusted；
   - 超过 `MAX_AUDIO_LANES = 4` 的道并入 `audio-track-4`，记录 adjusted。
3. 前端防御（`mergeAiMixTimeline.ts:72-75` `audioNumberOf`）：不匹配 `/audio-track-(\d+)$/` 的导入音频轨分配「下一个未被导入轨占用的编号」而不是固定 1。

#### AM2-03 错误文案全覆盖

1. `useAIMixedEditing.ts:141-146` 错误映射在保留现有 4 个 `AI_MIX_*` 映射的基础上新增：

   | `ApiError.code` / 错误类型 | 文案 key |
   |---|---|
   | `AI_MIX_INTERNAL` | `aiMixingProgress.errorInternal` |
   | `BACKEND_TIMEOUT` | `aiMixingProgress.errorTimeout`（已有） |
   | `BACKEND_UNREACHABLE`、`NETWORK_ERROR` | `aiMixingProgress.errorBackendUnreachable` |
   | `VALIDATION_ERROR` | `aiMixingProgress.errorInvalidRequest` |
   | `AiMixImportError`（导入阶段任何 ApiError）/ `TIMELINE_IMPORT_INVALID` | `aiMixingProgress.errorImportFailed` |
   | 其他 `ApiError` | `aiMixingProgress.errorInternal`（不再把后端原文拼进界面） |
   | 非 ApiError 的客户端 `Error` | `aiMixingProgress.errorGeneric`（保留） |

   所有分支先 `console.error('[AI mix] run failed', { code, message })` 记录原始错误。
2. 导入阶段（`importPlan`）捕获 `ApiError` 后抛出命名错误 `class AiMixImportError extends Error`（`cause` 保留原错误）。
3. `app/routers/timeline_import_router.py:140-148`：以 `JSONResponse(status_code=400, content=ErrorResponse(message=result.message, error_code="TIMELINE_IMPORT_INVALID", error_details={"errors": validation_errors}).model_dump(mode="json"))` 替代 `HTTPException(detail=dict)`。
4. `src/app/api/timeline-import/route.ts`：`timeoutMs: 300_000`，与客户端一致。

#### AM2-05 批量解析超时随规模伸缩并提示

1. `utils/parallelVideoAnalysis.ts`：
   ```ts
   export function batchAnalysisTimeoutMs(videoCount: number, mode: 'quick' | 'professional'): number {
     const perVideo = mode === 'quick' ? 15_000 : 45_000;
     return Math.min(590_000, Math.max(120_000, 60_000 + videoCount * perVideo));   // BFF 上限 600 s
   }
   ```
   批量路径（`:605-616`）的 `setTimeout` 与 `http.post({ timeoutMs })` 共用该值。模式名以该文件现有模式枚举为准。
2. `useAIMixedEditing.analyzeFootage`（`:272-285`）返回 `{ failedCount }`；运行结果携带它；`announceAiMixResult` 在 `failedCount > 0` 时 `showWarning(t.aiMixingProgress.analysisIncomplete.replace('{count}', n))`。

#### AM2-06 提示词示例自洽 + 越界告警

1. 示例 JSON（`ai_mixed_editing_service.py:137-178`）替换为：视频 `v1` 0–30.5、`v2` 30.5–61；`audio_001`（旁白，`audio-track-1`）0–55.5，音量 100；
   `audio_002`（BGM，`audio-track-2`）0–61，音量 30；`image_001` 0–5；`total_duration` 61。各道从 0 开始首尾相接，视频道最长。
2. 新增 `_warn_past_video_end(timeline, report)`：视频道非空时，对结束时间超过视频道终点 1e-3 以上的音频 / 图片段追加 adjusted「`{label}: ends at X s after the video lane ends at Y s`」；数据不修改。

#### AM2-07 重叠后移不再二次裁剪

由 AM2-01 的 `_pack_lanes` 取代 `_resolve_lane_overlaps / _shift_lane_overlaps` 一并修复：只有 `_clip_to_total`（按模型给出的总时长做一次裁剪）会截断片段，打包后总时长由 `:625-627` 重算。

#### AM2-08 新建轨道不带硬编码名称

`mergeAiMixTimeline.ts:63-70` `createLaneTrack` 返回 `{ ...source, id, type, name: '', order, volume: 100, isLocked: false, items: [] }`，
轨道头由 `deriveTrackDisplayName` 按当前语言显示（「图片轨 1」/「Image 1」等）。

---

## 4. 文件 / 模块变更计划

路径前缀：前端相对仓库根；后端相对 `backend-services/basic-service/`。「新增」= 新建文件，「修改」= 既有文件。编号与第 1 轮独立。

### 4.1 前端 · 导出、预览与数据安全

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F1 | `src/components/video/timeline/infrastructure/renderableTimeline.ts` | 新增 | `isTrackRendered / collectRenderSpans / computeRenderEnd / hasVisualSpan` | S5 |
| F2 | `src/components/video/hooks/useVideoExport.ts` | 修改 | 删除私有 `isTrackExported` 改用 F1；`total_duration = renderEnd`；`validateVideoExport` 增加「无画面」与缺失素材检查，删除长度硬拦截改为黑尾提示〔RV-04〕；字幕 / 图片条目改用 F3；轮询累积 `degradations` 并提示 | EXV-03/09、EXO-01/02/03/06/10、ME-02 |
| F3 | `src/components/video/hooks/videoExportItems.ts` | 新增 | `toSubtitleCompositionItem`、`toImageCompositionItem` | EXO-01/02/10 |
| F4 | `src/components/video/hooks/exportDegradations.ts` | 新增 | `mergeDegradations`、`formatDegradationMessage` | S7 |
| F5 | `src/lib/api/videoComposition.ts` | 修改 | `CompositionDegradation` 与 `CompositionStatus` 类型；轮询终态；允许仅图片请求 | EXO-03/06/08 |
| F6 | `src/components/video/hooks/useTimelineComposition.ts` | 修改 | 预览总时长与合成模式改用 F1；签名纳入图片 | ME-07 |
| F7 | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 修改 | 合成预览门控；图片叠加手势提交 / 还原；锁定时隐藏手柄 | ME-07、ME-05、S9 |
| F8 | `src/components/video/playback/MultiTrackPlaybackEngine.ts` | 修改（按需） | 视频轨组为空时仍推进时钟并绘制图片 / 字幕（引擎用例 T24 失败时才改） | ME-07 |
| F9 | `src/components/video/playback/SubtitleLayer.ts` | 修改 | 可见区间改为半开 | EXO-17 |
| F10 | `src/components/video/playback/internal/assembleLayers.ts` | 修改 | 图片层 `z = baseZ + zIndex * 1000 + index` | EXO-02 |
| F11 | `src/components/video/playback/ImageOverlayLayer.ts` | 修改 | 导出 `effectiveImageOpacity`（若未导出）；〔RV-10〕新增 `clampImageZIndex` | EXO-02 |
| F12 | `src/components/video/lib/derivedMaterial.ts` | 新增 | `buildDerivedMaterial / repairDerivedMaterialIdentity / storageKeyFromLocalUrl / isDerivedMaterial` | ME-01 |
| F13 | `src/components/video/lib/selectPlaybackUrl.ts` | 修改（按需） | 导出 `isLocalMediaReference`（若其定义在此且未导出） | ME-01 |
| F14 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | 修改 | 静音移除 / 去水印改用 F12；拖拽开始写入类型 MIME | ME-01、ME-10 |
| F15 | `src/components/video/VideoEditingInterface.tsx` | 修改 | 切段改用 F12；自动混剪编排移入 F72；时间轴区域 `inert`；图片叠加 `onGestureEnd` 连线；「添加到时间轴」锁检查 | ME-01/05、AS2-02/04、S9 |
| F16 | `src/components/video/hooks/useMaterialManagement.ts` | 修改 | 删除前引用检查、锁检查、确认文案 i18n、先移除片段；同 id 换 url 时失效缓存；`sourcePathForDelete` 传 siblings | ME-01/02 |
| F17 | `src/components/video/hooks/materialManagement/materialDeleteHelpers.ts` | 修改 | `sourcePathForDelete(material, siblings?)` 共享存储键防御 | ME-01 |
| F18 | `src/components/video/timeline/lib/materialUsage.ts` | 新增 | `findTimelineUsages` | ME-02、AG2-16 |
| F19 | `src/components/video/projects/VideoEditorContainer.tsx` | 修改 | 打开项目时 `repairDerivedMaterialIdentity`；〔RV-01〕按 `HydrationResult` 提示修复 / 写入 `timelineRecoveryBackup` | ME-01、RV-01 |
| F20 | `src/components/video/projects/autosaveRegistry.ts` | 新增 | `registerPendingFlush / flushAllPending` | ME-08 |
| F21 | `src/components/video/projects/hooks/useProjectAutosave.ts` | 修改 | 在途 promise、重试发送最新内容、卸载刷写串行、登记刷写 | ME-08 |
| F22 | `src/hooks/useDesktopCloseGuard.ts` | 新增 | 响应主进程关闭请求并回报 | ME-08 |
| F23 | `src/app/page.tsx` | 修改 | 挂载 `useDesktopCloseGuard()` | ME-08 |
| F24 | `src/types/desktop.d.ts` | 修改 | `ecliptrixDesktop.app` 类型 | ME-08 |
| F25 | `src/lib/i18n.ts` | 修改 | §6.4 全部新增 key（接口类型 + en + zh-CN 三处）；删除无引用的 `videoTrackTooShort` 等长度拦截文案 | 全部文案 |
| F78 | `src/components/video/projects/repairTimelineData.ts` | 新增 | 〔RV-01〕`repairTimelineData`：修复负 / 非有限起点，删除无效时长条目 | AG2-08、RV-01 |
| F79 | `src/components/video/projects/hydrateTimeline.ts` | 修改 | 〔RV-01〕返回 `HydrationResult`；导入失败先修复重试 | AG2-08、RV-01 |

### 4.2 前端 · 时间轴与手动剪辑

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F26 | `src/components/video/timeline/store/editLock.ts` | 新增 | `isEditLocked` | S9 |
| F27 | `src/components/video/timeline/store/actions/{addItem,moveItem,removeItem,swapItems,detachAudio,setCameraMotion,trackActions,updateItemFields}.ts` | 修改 | 函数首行锁检查（拒绝不写历史） | S9 / TL2-19 |
| F28 | `src/components/video/timeline/store/actions/resizeItem.ts` | 修改 | 锁检查；运镜位移按实际 `clipStart` 变化量 | S9、TL2-02 |
| F29 | `src/components/video/timeline/store/actions/splitItem.ts` | 修改 | 锁检查；返回 `SplitOutcome` | S9、ME-09 |
| F30 | `src/components/video/timeline/store/actions/applyScriptAutoMix.ts` | 修改 | 锁检查（拒绝原因 `'edit-locked'`）；注释更新 | S9、AS2-03 |
| F31 | `src/components/video/timeline/store/actions/replaceTimeline.ts` | 修改 | 保留视图状态；锁定时仅允许 agent / agent-undo；拖拽中先取消；构造先于记录 | TL2-04、S9、TL2-18、AG2-08 |
| F32 | `src/components/video/timeline/store/slices/historySlice.ts` | 修改 | 撤销 / 重做后 `pruneSelection`；拖拽中忽略 | TL2-03、TL2-18 |
| F33 | `src/components/video/timeline/store/slices/dragSlice.ts` | 修改 | 进入 committed 必发 `COMMIT_COMPLETE`；无变化不记录；resize 提交走 `resizeItemAction`；条目消失跳过；锁检查；删除无调用方的 `dropMaterial` | TL2-02/16/18、S9、ME-10 |
| F34 | `src/components/video/timeline/domain/machines/dragMachine.ts` | 修改 | `edgeHandleWidthPx`；`previewFor` 在越过阈值时计算；committed 接受 ESCAPE；move 阈值用 `hypot`；改用共享最小时长常量 | TL2-06/16/17、ME-09 |
| F35 | `src/components/video/timeline/domain/aggregates/TimelineAggregate.ts` | 修改 | `restore` 只恢复轨道与总时长；`recalculateTotalDuration` 钳制播放头 | TL2-04、TL2-20 |
| F36 | `src/components/video/timeline/domain/value-objects/Duration.ts` | 修改 | 导出 `MIN_CLIP_DURATION_SECONDS` | ME-09 / TL2-15 |
| F37 | `src/components/video/timeline/domain/services/{DurationCalculationService,SplitService}.ts`、`domain/entities/TimelineItem.ts` | 修改 | 常量迁移与 `import type`；切分最小长度与图片区间 | ME-09 / TL2-15 |
| F38 | `src/components/video/timeline/TimelinePanel.tsx` | 修改 | 外部同步 try/catch；字幕识别条目改用 F41；字幕弹窗保存阻止检查；切分过近提示；`handleMaterialDropById`；拖拽 `deltaY`；拖拽中忽略改写快捷键；添加 / 整理 / 导入锁检查；锁定时切回选择工具；〔RV-03〕复制 / 整理直接调用点锁检查；外部同步抛错或拒绝后 `resyncOwnerFromStore` | AG2-08、ME-03/04/09/10、TL2-17/18/19 |
| F39 | `src/components/video/timeline/TimelineItem.tsx` | 修改 | 悬停热区光标与手柄宽度 | TL2-06 |
| F40 | `src/components/video/timeline/Track.tsx` | 修改 | 拖放类型判定与提示、`onMaterialDrop`；删除锁定轨 `pointer-events: none` | ME-10、TL2-23 |
| F41 | `src/components/video/timeline/lib/subtitleReplacement.ts` | 修改 | `collectTranscriptionItems` | ME-03 |
| F42 | `src/components/video/timeline/lib/materialDragTypes.ts` | 新增 | `MATERIAL_DRAG_MIME_PREFIX / readDraggedMaterialType` | ME-10 |
| F43 | `src/components/video/timeline/TrackContainer.tsx` | 修改 | 透传 `onMaterialDrop` | ME-10 |
| F44 | `src/components/video/timeline/TimelineToolbar.tsx` | 修改 | 拖拽中置灰撤销 / 重做 / 删除；锁定时置灰整理 / 导入 | TL2-18/19 |
| F45 | `src/components/video/timeline/timeFormat.ts` | 修改 | 整数百分秒 | TL2-09 |
| F46 | `src/components/video/components/SubtitleEditModal/SubtitleEditModal.tsx` | 修改 | 模态语义、焦点、Esc、放弃修改确认、i18n | ME-04 |
| F47 | `src/components/ui/focusTrap.ts` | 新增 | `focusableElementsWithin / trapTabKey` | ME-04 |
| F48 | `src/components/ui/ConfirmationDialog.tsx` | 修改 | 改用 F47（行为不变） | ME-04 |
| F49 | `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx` | 修改 | Pointer Events、`onGestureEnd`、取消回退、按钮 i18n、自动适配写 store | ME-05 |
| F50 | `src/components/video/components/VideoPlayerPanel/imageOverlayGeometry.ts` | 修改 | `hasPositionChanged` | ME-05 |
| F51 | `src/components/video/components/CameraMotionModal/CameraMotionModal.tsx` | 修改 | 锁定时应用按钮置灰并提示 | S9 / TL2-19 |

### 4.3 前端 · 剪辑 Agent

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F52 | `src/lib/video-editing-agent/reconcile.ts` | 修改 | 贴紧锚点优先；`trackHasOverlap / packOverlappingTracks / isReorganisable` 导出 | AG2-01/09 |
| F53 | `src/lib/video-editing-agent/operationGuards.ts` | 新增 | `validateOperationTargets` | AG2-02/08 |
| F54 | `src/lib/video-editing-agent/OperationApplier.ts` | 修改 | `apply` 返回 `ApplyOutcome`；先校验后变更；新条目写播放地址；auto_fix 分支改用 F52 | AG2-02/08/09/16 |
| F55 | `src/lib/video-editing-agent/agent.ts` | 修改 | 同一校验；删除「目标轨缺失原地更新」兜底；新条目写播放地址 | AG2-02/08/16 |
| F56 | `src/lib/video-editing-agent/AgentEventRouter.ts` | 修改 | `rejected` → 工具卡片 error + `clientApplyError` | AG2-02 |
| F57 | `src/lib/video-editing-agent/AgentStateManager.ts` | 修改 | 存储 `compactToolResult(result)` | AG2-12 |
| F58 | `src/lib/video-editing-agent/messageConverter.ts` | 修改 | 停止提示仅针对最近一轮；历史结果压缩 | AG2-11/12 |
| F59 | `src/lib/video-editing-agent/compactToolResult.ts` | 新增 | 内联媒体占位替换 | AG2-12 |
| F60 | `src/lib/inlineUrl.ts` | 新增 | `isInlineMediaUrl` | AG2-12 |
| F61 | `src/lib/video-editing-agent/trackPatch.ts` | 修改 | 改用 F60 | AG2-12 |
| F62 | `src/lib/video-editing-agent/tools/index.ts` | 修改 | `collectClipStarts / diffClipStarts / toAgentClipMaterial`；`serializeMaterial` 去内联 | AG2-01/12/16 |
| F63 | `src/lib/video-editing-agent/tools/{moveClip,addToTrack}.ts` | 修改 | 回报实际位置与 `shiftedClips`；负起点拒绝；图片不写 `originalDuration`；素材快照；描述更新 | AG2-01/08/15/16 |
| F64 | `src/lib/video-editing-agent/tools/autoFixOverlaps.ts` | 修改 | 只处理有重叠的轨道 | AG2-09 |
| F65 | `src/lib/video-editing-agent/tools/composeStoryboard.ts` | 修改 | 类型校验、`skipped`、延迟建轨、素材快照 | AG2-14/16 |
| F66 | `src/lib/video-editing-agent/tools/{trimClip,resizeClip}.ts` | 修改 | 出点推导、图片拒绝 / clipEnd 同步 | AG2-15 |
| F67 | `src/lib/video-editing-agent/tools/removeMaterial.ts` | 修改 | 有引用时拒绝 | AG2-16 |
| F68 | `src/components/video/hooks/useAgentExecution.ts` | 修改 | `finishing`；排空后发送；卸载封口；执行中禁用撤销；请求体去内联媒体 | AG2-06/07/10/12 |
| F69 | `src/components/video/hooks/useAgentExecutionState.ts` | 修改 | `'finishing'` 状态与异步终止回调；〔RV-05〕`FINISHING_WATCHDOG_MS` 看门狗与 `onFinishingTimeout` | AG2-06 |
| F70 | `src/components/video/components/VideoChatWindow/{VideoChatWindow.tsx,timeline/TimelineChatPanel.tsx,timeline/AgentResponseNode.tsx,timeline/ToolStep.tsx}` | 修改 | `finishing` 忙碌态；`undoDisabled`；`clientApplyError` 文案 | AG2-02/06/10 |
| F71 | `src/types/index.ts` | 修改 | `AgentMaterialData` 播放地址字段；`AgentToolCallRecord.result.clientApplyError?` | AG2-02/16 |

### 4.4 前端 · AI 混剪 / 自动混剪

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F72 | `src/components/video/hooks/useScriptAutoMix.ts` | 新增 | 自动混剪编排；确认时重新排布 | AS2-02/04 |
| F73 | `src/components/video/lib/aiMix/planScriptAutoMix.ts` | 修改 | `options.segments`；按批次选视频；无空洞覆盖；`orphanedMaterialIds`、`video-short` | AS2-01/02/03 |
| F74 | `src/components/video/lib/aiMix/mergeAiMixTimeline.ts` | 修改 | `packLane`；`packedItemIds`；非编号音频轨分配；新建轨道名为空 | AM2-01/02/08 |
| F75 | `src/components/video/hooks/useAIMixedEditing.ts` | 修改 | 警告计数；错误码映射；`AiMixImportError`；解析失败提示 | AM2-01/03/05 |
| F76 | `src/components/video/utils/parallelVideoAnalysis.ts` | 修改 | `batchAnalysisTimeoutMs` | AM2-05 |
| F77 | `src/app/api/timeline-import/route.ts` | 修改 | `timeoutMs: 300_000` | AM2-03 |
| F80 | `src/components/video/lib/aiMix/segmentTextHash.ts` | 新增 | 〔RV-07〕`segmentTextHash` | AS2-02 |
| F81 | `src/components/video/ScriptPanel.tsx` | 修改 | 〔RV-07〕配音素材 metadata 写入 `segment_text_hash` | AS2-02 |

### 4.5 桌面端（Electron）

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| D1 | `desktop/main/closeGuard.js` | 新增 | `installCloseGuard`：关闭前请求渲染进程刷写，超时 3 s | ME-08 |
| D2 | `desktop/main/window.js` | 修改 | 创建窗口后安装 D1 | ME-08 |
| D3 | `desktop/preload/preload.js` | 修改 | `ecliptrixDesktop.app.onBeforeClose / closeReady` | ME-08 |
| D4 | `desktop/main/closeGuard.test.js` | 新增 | Node 原生 assert 单测（风格同 `window-state.test.js`） | ME-08 |
| D5 | `desktop/main/index.js` | 修改（按需） | 〔RV-02〕把 `state.quitting` 以回调形式传给 D2 的 `installCloseGuard`（若 `createMainWindow` 现无可用参数） | ME-08 |

### 4.6 后端

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| B1 | `app/services/composition/filtergraph_builder.py` | 修改（重写） | 画布合成、连续段、快速路径判定、`timeline_end` | S6、EXV-01～08、EXO-06 |
| B2 | `app/services/video_composition_service.py` | 修改 | 画布集成与 `CompositionStageError`；时间轴终点；`-frames:v`；空视频请求；降级记录；逐条字幕；图片逐张容错；滤镜脚本参数；`_fail_composition` 与清理；字幕无固定超时；〔RV-09〕图片叠加 enable 半开区间；〔RV-10〕z 序钳制 | S6、S7、EXV-03/07/10、EXO-01/03/04/05/06/13/16/18 |
| B3 | `app/services/composition/ffmpeg_args.py` | 新增 | `filter_complex_args / video_filter_args / supports_option_file_syntax` | EXO-05 |
| B4 | `app/services/subtitle_service.py` | 修改 | `SubtitleDrawStyle / to_ffmpeg_color / resolve_draw_style / build_drawtext_filters_for_items / burn_drawtext_filters`；半开 enable；无背景不画框；超时参数 | EXO-01/05/10/11/16/17 |
| B5 | `app/services/composition/camera_motion.py` | 修改 | 静态图片链与叠加计划支持不透明度 | EXO-02 |
| B6 | `app/models/video_models.py` | 修改 | `ImagePosition.z_index` 别名；`CompositionDegradation` | EXO-02/03 |
| B7 | `app/routers/video_router.py` | 修改 | 状态白名单加 `degradations`；公开状态收敛；视频或图片二者其一即可 | EXO-03/06/08 |
| B8 | `app/services/composition/subtitle_prep.py` | 修改（按需） | 删除改动后无调用方的合成 SRT 函数 | EXO-01/11 |
| B9 | `app/services/audio_transcription_service.py` | 修改 | `map_subtitles_to_timeline` 按裁剪窗口映射 | ME-03 |
| B10 | `app/services/timeline_parser_service.py` | 修改 | `_canonicalise_audio_tracks`、`_pack_lanes`（取代重叠后移）、`_warn_past_video_end` | AM2-01/02/06/07 |
| B11 | `app/models/ai_mixed_editing_models.py` | 修改 | 音频段 `track: Optional[Union[str, int]]` | AM2-02 |
| B12 | `app/services/ai_mixed_editing_service.py` | 修改 | 提示词「首尾相接」要求与自洽示例 | AM2-01/06 |
| B13 | `app/routers/timeline_import_router.py` | 修改 | 校验失败返回 `ErrorResponse`（`TIMELINE_IMPORT_INVALID`） | AM2-03 |

### 4.7 测试（新增 / 修改）

**后端**（`backend-services/basic-service/tests/`）

| # | 文件 | 类型 | 覆盖 |
|---|---|---|---|
| T1 | `test_filtergraph_builder.py` | 修改（重写 `:111-120,146-153` 旧断言） | S6、EXV-01～08、EXO-06 |
| T2 | `test_export_parity.py` | 修改（`:109-114`） | S6 |
| T3 | `test_export_canvas_ffmpeg.py` | 新增（无 ffmpeg 时 skip，模式同 `test_waveform_service.py:29-33`） | EXV-01/02/04/05/06、EXO-06 |
| T4 | `test_video_composition_timeline.py` | 修改（追加） | EXV-03/07/10、EXO-06 |
| T5 | `test_subtitle_export_style.py` | 新增 | EXO-01/10/11/17 |
| T6 | `test_image_overlay_export.py` | 新增 | EXO-02 |
| T7 | `test_camera_motion_stills.py` | 修改 | EXO-02（透明链）、EXO-04（元组解包） |
| T8 | `test_composition_degradations.py` | 新增 | S7、EXO-03/04/16/18 |
| T9 | `test_filter_script_args.py` | 新增 | EXO-05 |
| T10 | `test_composition_failure_cleanup.py` | 新增 | EXO-13 |
| T11 | `test_video_router_status.py` | 新增 | EXO-06/08、S7 白名单 |
| T12 | `test_audio_transcription_service.py` | 修改（追加） | ME-03 |
| T13 | `test_ai_mixed_editing_hardening.py` | 修改（追加 + 重叠后移用例改为打包断言） | AM2-01/02/06/07 |
| T14 | `test_timeline_import_router.py` | 新增 | AM2-03 |
| T15 | `test_audio_mix.py`、`test_video_composition.py` | 修改（仅当 `_process_audio_tracks` 返回类型或 ffmpeg 参数构造变更打挂时） | EXO-03/05 |

**前端**（Vitest）

| # | 文件 | 类型 | 覆盖 |
|---|---|---|---|
| T16 | `src/components/video/timeline/infrastructure/__tests__/renderableTimeline.test.ts` | 新增 | S5 |
| T17 | `src/components/video/hooks/__tests__/useVideoExport.duration.test.ts` | 新增 | EXV-03/09、EXO-06 |
| T18 | `src/components/video/hooks/__tests__/videoExportItems.test.ts` | 新增 | EXO-01/02/10 |
| T19 | `src/components/video/hooks/__tests__/exportDegradations.test.ts` | 新增 | S7 |
| T20 | `src/components/video/hooks/__tests__/useVideoExport.degradations.test.ts` | 新增 | EXO-03 |
| T21 | `src/components/video/hooks/__tests__/useVideoExport.missingMaterial.test.ts` | 新增 | ME-02 |
| T22 | `src/lib/api/__tests__/videoComposition.poll.test.ts`（修改）、`videoComposition.validate.test.ts`（新增） | 修改 / 新增 | EXO-06/08 |
| T23 | `src/components/video/hooks/__tests__/useTimelineComposition.renderEnd.test.ts` | 新增 | ME-07 |
| T24 | `src/components/video/playback/__tests__/MultiTrackPlaybackEngine.visualOnly.test.ts` | 新增 | ME-07 |
| T25 | `src/components/video/playback/__tests__/SubtitleLayer.test.ts`、`playback/internal/__tests__/assembleLayers.test.ts` | 修改（不存在则新增） | EXO-17、EXO-02 |
| T26 | `src/components/video/lib/__tests__/derivedMaterial.test.ts` | 新增 | ME-01 |
| T27 | `src/components/video/hooks/materialManagement/__tests__/materialDeleteHelpers.test.ts` | 新增或追加 | ME-01 |
| T28 | `src/components/video/timeline/lib/__tests__/materialUsage.test.ts` | 新增 | ME-02 |
| T29 | `src/components/video/hooks/__tests__/useMaterialManagement.deleteInUse.test.tsx` | 新增 | ME-01/02 |
| T30 | `src/components/video/projects/__tests__/autosaveRegistry.test.ts` | 新增 | ME-08 |
| T31 | `src/components/video/projects/hooks/__tests__/useProjectAutosave.retry.test.ts`、`useProjectAutosave.flush.test.ts` | 新增 | ME-08 |
| T32 | `src/components/video/timeline/store/__tests__/editLock.test.ts` | 新增 | S9 / TL2-19 |
| T33 | `src/components/video/timeline/store/actions/__tests__/replaceTimeline.test.ts` | 修改 | TL2-04、S9、TL2-18、AG2-08 |
| T34 | `src/components/video/timeline/store/slices/__tests__/history.viewState.test.ts` | 新增 | TL2-03/04 |
| T35 | `src/components/video/timeline/store/slices/__tests__/{dragSlice.resizeCommit,dragSlice.flickCommit,dragSlice.historyDuringDrag}.test.ts` | 新增 | TL2-02/16/18 |
| T36 | `src/components/video/timeline/domain/machines/__tests__/{dragMachine.hitZones,dragMachine.threshold}.test.ts` | 新增 | TL2-06/16/17 |
| T37 | `src/components/video/timeline/store/actions/__tests__/removeItem.playheadClamp.test.ts` | 新增 | TL2-20 |
| T38 | `src/components/video/timeline/domain/services/__tests__/SplitService.test.ts`（修改）、`store/actions/__tests__/splitItem.test.ts`（新增）、`domain/__tests__/domainLayering.test.ts`（新增） | 修改 / 新增 | ME-09 / TL2-15 |
| T39 | `src/components/video/timeline/__tests__/timeFormat.test.ts` | 修改 | TL2-09 |
| T40 | `src/components/video/timeline/lib/__tests__/subtitleReplacement.test.ts` | 修改 | ME-03 |
| T41 | `src/components/video/timeline/lib/__tests__/materialDragTypes.test.ts`（新增）、`timeline/__tests__/Track.materialDrop.test.ts`（新增，源码断言） | 新增 | ME-10、TL2-23 |
| T42 | `src/components/video/components/SubtitleEditModal/__tests__/SubtitleEditModal.a11y.test.tsx`、`src/components/ui/__tests__/focusTrap.test.ts` | 新增 | ME-04 |
| T43 | `src/components/video/components/VideoPlayerPanel/__tests__/imageOverlayGesture.test.ts`（新增）、`timeline/store/actions/__tests__/updateItemFields.test.ts`（修改） | 新增 / 修改 | ME-05、S9 |
| T44 | `src/components/video/timeline/__tests__/TimelinePanel.externalSync.test.ts` | 新增（源码断言） | AG2-08 |
| T45 | `src/components/video/timeline/__tests__/TimelineItem.hoverZone.test.ts` | 新增（源码断言） | TL2-06 |
| T46 | `src/lib/video-editing-agent/__tests__/editingTools.guards.test.ts` | 修改 | AG2-08/14/15/16 |
| T47 | `src/lib/video-editing-agent/__tests__/operationApplier.undo.test.ts`（修改）、`operationGuards.test.ts`（新增） | 修改 / 新增 | AG2-02/08/16 |
| T48 | `src/lib/video-editing-agent/__tests__/reconcile.anchor.test.ts` | 新增 | AG2-01 |
| T49 | `src/lib/video-editing-agent/__tests__/autoFixOverlaps.test.ts` | 新增 | AG2-09 |
| T50 | `src/lib/video-editing-agent/__tests__/messageConverter.cancelled.test.ts` | 修改 | AG2-11 |
| T51 | `src/lib/video-editing-agent/__tests__/compactToolResult.test.ts`、`serializeMaterial.test.ts` | 新增 | AG2-12 |
| T52 | `src/components/video/hooks/__tests__/useAgentExecution.ordering.test.ts` | 修改 | AG2-06/07/10/12 |
| T53 | `src/lib/video-editing-agent/__tests__/agentEventRouter.applyOutcome.test.ts` | 新增 | AG2-02 |
| T54 | `src/components/video/components/VideoChatWindow/timeline/__tests__/AgentResponseNode.undoDisabled.test.tsx` | 新增（沿用 `?raw` + transpile 渲染） | AG2-10 |
| T55 | `src/components/video/lib/aiMix/__tests__/mergeAiMixTimeline.test.ts` | 修改 | AM2-01/02/08 |
| T56 | `src/components/video/lib/aiMix/__tests__/planScriptAutoMix.test.ts` | 修改 | AS2-01/02/03 |
| T57 | `src/components/video/timeline/store/actions/__tests__/applyScriptAutoMix.test.ts` | 修改 | AS2-03、S9 |
| T58 | `src/components/video/hooks/__tests__/useScriptAutoMix.test.tsx` | 新增 | AS2-02/04 |
| T59 | `src/components/video/hooks/__tests__/useAIMixedEditing.test.tsx` | 修改 | AM2-01/03/05 |
| T60 | `src/components/video/utils/__tests__/parallelVideoAnalysis.timeout.test.ts` | 新增 | AM2-05 |
| T61 | `src/test/organizeFixedPoint.ts` | 新增（测试工具，非用例） | S8 |
| T62 | `src/components/video/projects/__tests__/repairTimelineData.test.ts` | 新增 | RV-01 |
| T63 | `src/components/video/projects/__tests__/hydrateTimeline.repair.test.ts`、`VideoEditorContainer.recoveryBackup.test.ts`（源码断言或 hook 级） | 新增 | RV-01 |
| T64 | `src/components/video/lib/aiMix/__tests__/segmentTextHash.test.ts` | 新增 | RV-07 |

---

## 5. 接口设计

### 5.1 REST：合成状态（`video_router.py` 状态路由；BFF `src/app/api/video-compose/[compositionId]/status`）

- `status` 只会是 `processing | completed | failed`（EXO-08）；任何其他内部值以 `failed` + `error` 返回。
- 新增 `degradations`（S7），与 `warnings` 并列；`completed` 时也可能非空。

```json
{ "composition_id": "c-123", "task_id": "export_t1_1789", "status": "completed", "progress": 1.0,
  "start_time": 1789367327.2, "warnings": [],
  "degradations": [
    { "kind": "image_overlay", "item_ids": ["img-2"], "item_names": ["封面.png"],
      "reason": "remote image is not available locally" },
    { "kind": "audio_item", "item_ids": ["a2"], "item_names": ["bgm.mp3"],
      "reason": "No such file or directory: static/uploads/audio/bgm.mp3" } ] }
```

失败时（EXV-07 / EXO-13）：

```json
{ "composition_id": "c-123", "task_id": "export_t1_1789", "status": "failed", "progress": 0.6,
  "warnings": [], "degradations": [],
  "error": "Invalid argument",
  "error_details": { "error_summary": "Invalid argument", "composition_stage": "compose" } }
```

### 5.2 REST：发起合成（BFF `src/app/api/video-compose` → FastAPI 合成路由）

- 请求结构不变；**语义变化**：
  - `total_duration` = 时间轴渲染终点（S5），不再是片段时长之和；后端以 `max(total_duration, 请求条目最大结束时间)` 为画布时长。
  - `video_items` 可以为空，前提是 `image_items` 非空（EXO-06）；二者都为空 → 400 `"At least one video or image item is required"`。
  - `video_items[].start_time` 被严格遵守（同轨空隙与首段前空隙渲染为黑，EXV-02 / EXV-09）。
  - `image_items[].position.zIndex` 被接受（亦接受 `z_index`），`image_items[].opacity` 被渲染（EXO-02）。
  - `subtitle_items[]` 逐条样式生效；`background_color` 缺省或 `transparent` 不画背景框；空文本条目前端不再发送（EXO-01 / EXO-10）。

### 5.3 REST：时间轴导入校验失败（`timeline_import_router.py`）

```json
HTTP 400
{ "success": false, "message": "上传的文件格式不正确", "timestamp": "2026-09-14T10:00:00", "data": null,
  "error_code": "TIMELINE_IMPORT_INVALID",
  "error_details": { "errors": ["tracks[2].id duplicated: video-track-1"] } }
```

前端 `http-client` 已把 `error_code` 解析为 `ApiError.code`，无需改动。

### 5.4 REST：批量字幕识别（`POST /api/audio/batch-transcribe`）

请求字段不变（`clip_start / clip_end` 已由前端发送）。语义变化（ME-03）：返回的字幕只包含与 `[clip_start, clip_end)` 相交的部分，
并按 `timeline_start_time − clip_start` 平移；短于 100 ms 的片段被丢弃。前端只提交 `isTrackRendered` 的音频轨条目。

### 5.5 REST：AI 混剪（`POST /api/ai-mixed-editing`）

请求 / 响应结构不变。`timelineData.metadata.warnings` 可能出现新的调整说明：`moved from X to Y to close a gap`（AM2-01）、
`track "bgm" mapped to audio-track-2`（AM2-02）、`ends at X s after the video lane ends at Y s`（AM2-06）。

### 5.6 桌面 IPC（ME-08）

| 通道 | 方向 | 负载 | 说明 |
|---|---|---|---|
| `app:before-close` | main → renderer | `token: string` | 窗口即将关闭，请求刷写 |
| `app:close-ready` | renderer → main | `token: string, result: { ok: true } \| { ok: false, prompt: { title, body, keepOpen, closeAnyway } }` | 刷写结果；主进程只接受同 token 的回复，3 s 未回复视为可关闭 |

preload 暴露：`window.ecliptrixDesktop.app.onBeforeClose(cb) → unsubscribe`、`window.ecliptrixDesktop.app.closeReady(token, result)`。

### 5.7 Agent 工具结果（模型可见）

| 工具 | 变化 |
|---|---|
| `move_clip` / `add_to_track` | `clip.startTime` 为实际位置；新增 `clip.requestedStartTime`、`clip.repositioned`、可选 `shiftedClips[{clipId, from, to}]`；`add_to_track` 负起点 / 非有限值返回错误（AG2-01 / AG2-08） |
| `auto_fix_overlaps` | 只处理有重叠的轨道；结果新增 `fixedTrackIds`、`shiftedClips`（AG2-09） |
| `compose_storyboard` | 新增可选 `skipped[{scene_id, material_id, reason}]`（AG2-14） |
| `trim_clip` | 图片片段返回错误并提示改用 `resize_clip`（AG2-15） |
| `remove_material` | 素材仍被片段使用时 `{ success: false, error, usedByClipIds }`（AG2-16） |
| `list_materials` / `search_materials` | 不再输出内联 `data:` / `blob:` 缩略图与 `localProxyUrl`（AG2-12） |
| 历史工具结果（每轮重放） | 内联媒体字符串替换为 `[inline media omitted]`（AG2-12） |
| SSE 事件 | 结构不变 |

### 5.8 前端内部 API（签名汇总）

```ts
// S5
isTrackRendered(track: Pick<Track, 'type' | 'isVisible' | 'isMuted'>): boolean
collectRenderSpans(tracks: readonly Track[], materialsById: ReadonlyMap<string, Pick<MaterialItem, 'id' | 'type'>>): RenderSpan[]
computeRenderEnd(spans: readonly RenderSpan[]): number
hasVisualSpan(spans: readonly RenderSpan[]): boolean
computeVisualEnd(spans: readonly RenderSpan[]): number                            // 〔RV-04〕
clampImageZIndex(value: unknown): number                                         // 〔RV-10〕playback/ImageOverlayLayer.ts
// S7
mergeDegradations(acc: readonly CompositionDegradation[], next: readonly CompositionDegradation[] | undefined): CompositionDegradation[]
formatDegradationMessage(list: readonly CompositionDegradation[], t: Translations): string | null
toSubtitleCompositionItem(item: TimelineItem, track: Track): SubtitleCompositionItem | null
toImageCompositionItem(item: TimelineItem, track: Track, material: MaterialItem): ImageCompositionItem
// S9
isEditLocked(state: Pick<TimelineStore, 'externalEditLock'>): boolean
// S10 / 数据安全
buildDerivedMaterial(original: MaterialItem, file: DerivedFileRef, identity: DerivedIdentity): MaterialItem
repairDerivedMaterialIdentity(materials: readonly MaterialItem[]): { materials: MaterialItem[]; repairedIds: string[] }
storageKeyFromLocalUrl(url: string): string | undefined
isDerivedMaterial(material: MaterialItem): boolean
sourcePathForDelete(material: MaterialItem | undefined, siblings?: readonly MaterialItem[]): string | undefined
findTimelineUsages(tracks: readonly TrackData[], materialIds: readonly string[]): MaterialUsage[]
registerPendingFlush(key: string, flush: () => Promise<void>): () => void
flushAllPending(timeoutMs: number): Promise<{ ok: boolean; failedKeys: string[]; timedOut: boolean }>
useDesktopCloseGuard(): void
repairTimelineData(data: TimelineData): { data: TimelineData; report: TimelineRepairReport }          // 〔RV-01〕
hydrateTimelineFromProjectData(projectData: Record<string, unknown> | undefined): HydrationResult   // 〔RV-01〕原返回 void
// 手动剪辑
collectTranscriptionItems(tracks: readonly Track[], materials: readonly MaterialItem[]): TranscriptionItemRequest[]
focusableElementsWithin(container: HTMLElement): HTMLElement[]
trapTabKey(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>, container: HTMLElement | null): void
hasPositionChanged(a: ImagePosition, b: ImagePosition): boolean
ImageOverlayProps.onGestureEnd?: (itemId: string, position: ImagePosition) => void
splitAction(get, tCut: number, scope: SplitScope): SplitOutcome                 // 原返回 void
MATERIAL_DRAG_MIME_PREFIX = 'application/x-ecliptrix-material-'
readDraggedMaterialType(types: readonly string[]): MaterialItem['type'] | null
TrackProps.onMaterialDrop: (materialId: string, trackId: string) => void
edgeHandleWidthPx(itemWidth: number): number
MIN_CLIP_DURATION_SECONDS = 0.1                                                 // domain/value-objects/Duration.ts
// Agent
validateOperationTargets(state: TimelineState, operation: AgentTimelineOperation): OperationValidation
OperationApplier.apply(toolCallId: string, operation: AgentTimelineOperation): Promise<ApplyOutcome>   // 原 Promise<void>
packFlushTrack(track: Track, epsilon: number, anchorClipId?: string): ...        // 返回类型不变
trackHasOverlap(track: Track, epsilon: number): boolean
packOverlappingTracks(state: TimelineState, epsilon: number): { state: TimelineState; fixedTrackIds: string[] }
collectClipStarts(state: TimelineState, trackIds: readonly string[]): Map<string, { trackId: string; startTime: number }>
diffClipStarts(before, after, excludeClipId: string): Array<{ clipId: string; from: number; to: number }>
toAgentClipMaterial(material: MaterialItem): AgentMaterialData
compactToolResult(value: unknown, depth?: number): unknown
isInlineMediaUrl(value: unknown): boolean                                        // src/lib/inlineUrl.ts
// AI 混剪 / 自动混剪
planScriptAutoMix(materials: readonly MaterialItem[], options?: PlanScriptAutoMixOptions): ScriptAutoMixPlan
useScriptAutoMix(options: UseScriptAutoMixOptions): UseScriptAutoMixReturn
segmentTextHash(segment: Pick<ScriptSegment, 'narrationText' | 'sentences'>): string            // 〔RV-07〕
batchAnalysisTimeoutMs(videoCount: number, mode: 'quick' | 'professional'): number
```

---

## 6. 数据模型

### 6.1 持久化与数据库

- **无数据库 schema 变更**，无启动期 DDL（遵守「禁止破坏性 DDL」约束）。
- `project_data.materials`：派生素材的存储字段在打开项目时被 `repairDerivedMaterialIdentity` 修复（幂等），下一次自动保存写回；不做离线迁移。
- `project_data.conversations`：新写入的工具结果不含内联媒体字符串（替换为 `[inline media omitted]`）；旧消息在转换给模型时同样压缩，存储中的旧值在下一次保存该对话时自然变小。
- Agent 新增的时间轴条目开始携带 `url / serverUrl / cacheUrl / storageKey`（与手动拖放条目一致）；旧条目不迁移。
- 时间轴条目与轨道**不新增字段**；`TimelineData` 结构不变。
- 〔RV-01〕`project_data` 新增可选顶层字段 `timelineRecoveryBackup: { savedAt, data }`：仅在时间轴水合修复后仍失败时写入一次（已存在不覆盖），保存原始 `uiState.currentTimelineState`；
  不影响任何读取路径，旧项目无此字段。放在顶层是因为 VEI 的 uiState 持久化 effect（`VideoEditingInterface.tsx:270-292`）逐字段重建 `uiState`，未知键会被丢弃。
- 〔RV-07〕配音素材 `metadata` 新增可选 `segment_text_hash`（新生成的配音才有）。
- 合成任务状态仍为进程内字典（`self.compositions`），新增 `degradations: List[dict]`。

### 6.2 Python 模型与数据类（后端）

| 模型 / 类型 | 位置 | 变化 |
|---|---|---|
| `ImagePosition` | `app/models/video_models.py` | `z_index: int = Field(10, alias="zIndex")`；`model_config = ConfigDict(populate_by_name=True)` |
| `CompositionDegradation`（新） | `app/models/video_models.py` | `kind: Literal['image_overlay','subtitles','audio_item','embedded_audio']`、`item_ids: List[str]`、`item_names: List[str]`、`reason: str` |
| `AudioSegmentModel.track` | `app/models/ai_mixed_editing_models.py` | `str = "audio-track-1"` → `Optional[Union[str, int]] = "audio-track-1"`（sanitize 规整为 `audio-track-n`） |
| `FiltergraphResult` | `composition/filtergraph_builder.py` | 新增 `timeline_end: float` |
| `CompositionStageError`（新异常） | `video_composition_service.py` | `stage: str`、`summary: str` |
| `DroppedAudio` / `AudioMixResult`（新 dataclass） | `video_composition_service.py` | `item_id, name, reason` / `path: Optional[str], dropped: List[DroppedAudio]` |
| `SkippedImage`（新 dataclass） | `video_composition_service.py` | `item: Any, reason: str` |
| `SubtitleDrawStyle`（新 dataclass） | `subtitle_service.py` | `font_family, font_size, font_color, background_color: Optional[str], position` |

### 6.3 TypeScript 形状（前端）

```ts
// timeline/infrastructure/renderableTimeline.ts
export type RenderSpanKind = 'video' | 'image' | 'audio' | 'subtitle';
export interface RenderSpan { itemId: string; trackId: string; kind: RenderSpanKind; start: number; end: number }

// src/lib/api/videoComposition.ts
export type CompositionStatus = 'processing' | 'completed' | 'failed' | 'error';
export interface CompositionDegradation {
  kind: 'image_overlay' | 'subtitles' | 'audio_item' | 'embedded_audio';
  item_ids: string[]; item_names: string[]; reason: string;
}
// CompositionStatusResponse: status: CompositionStatus; degradations?: CompositionDegradation[]

// timeline/lib/materialUsage.ts
export interface MaterialUsage { materialId: string; itemIds: string[]; lockedItemIds: string[] }

// lib/derivedMaterial.ts
export interface DerivedFileRef { url: string; thumbnailUrl?: string; duration?: number }
export interface DerivedIdentity { id: string; name: string; metadata: NonNullable<MaterialItem['metadata']> }

// store/actions/splitItem.ts
export type SplitOutcome = 'split' | 'none' | 'too-close';

// projects/repairTimelineData.ts + hydrateTimeline.ts（〔RV-01〕）
export interface TimelineRepairReport { clampedItemIds: string[]; droppedItemIds: string[] }
export type HydrationResult =
  | { status: 'loaded' }
  | { status: 'repaired'; report: TimelineRepairReport }
  | { status: 'failed' };
// VideoEditingTaskContent 新增可选顶层字段 timelineRecoveryBackup?: { savedAt: string; data: unknown }

// src/types/desktop.d.ts
export type CloseReadyResult =
  | { ok: true }
  | { ok: false; prompt: { title: string; body: string; keepOpen: string; closeAnyway: string } };

// hooks/useAgentExecutionState.ts
export type AgentExecutionStatus = 'idle' | 'executing' | 'retrying' | 'finishing' | 'cancelled' | 'error' | 'completed';

// lib/video-editing-agent/operationGuards.ts + OperationApplier.ts
export type OperationRejectReason = 'clip-not-found' | 'track-not-found' | 'target-track-missing' | 'invalid-time';
export type OperationValidation = { ok: true } | { ok: false; reason: OperationRejectReason; trackId?: string; clipId?: string };
export type ApplyOutcome =
  | { status: 'applied' }
  | { status: 'noop'; reason: 'no-change' }
  | { status: 'skipped'; reason: 'locked-track'; trackId: string }
  | { status: 'rejected'; reason: OperationRejectReason; trackId?: string; clipId?: string };

// src/types/index.ts
export interface AgentMaterialData { /* 既有 id, name, type, url, thumbnailUrl */ serverUrl?: string; cacheUrl?: string; storageKey?: string;
  metadata?: { storageKind?: string; storageKey?: string; localResolvedUrl?: string } }
// AgentToolCallRecord.result 可含 clientApplyError?: { reason: OperationRejectReason; trackId?: string; clipId?: string }

// lib/aiMix/planScriptAutoMix.ts
export interface ScriptSegmentRef { id: string; videos?: ReadonlyArray<Pick<MaterialItem, 'id'>>; textHash?: string }   // 〔RV-07〕textHash
export interface PlanScriptAutoMixOptions { segments?: readonly ScriptSegmentRef[] }
// 配音素材 metadata 新增可选 segment_text_hash: string（〔RV-07〕）
// ScriptAutoMixPlan 新增 orphanedMaterialIds: string[]
// AutoMixSegmentReport.status 新增 'video-short'
// ApplyAutoMixResult 拒绝原因新增 'edit-locked'

// lib/aiMix/mergeAiMixTimeline.ts
// AiMixMergeResult 新增 packedItemIds: string[]
```

### 6.4 新增 i18n key（`src/lib/i18n.ts`：接口类型、`en`、`zh-CN` 三处同步）

插入位置：接口类型 `videoProjects :325 / timeline :385 / subtitleEditModal :600 / materialsPanel :626 / aiMixingProgress :812 / agentUndo :835 / videoExport :1056 / autoMix :1284`；
`en` 与 `zh-CN` 对应命名空间分别位于 `:2735 / :3033 / :3250 / :2795 / :2989 / :3012 / :3475 / :3700` 与 `:5159 / :5457 / :5672 / :5219 / :5413 / :5436 / :5897 / :6122`（行号为基线，实施时以 grep 为准）。
新命名空间 `imageOverlay`、`agentApply` 放在 `agentUndo` 之后。

| 命名空间 | key | zh-CN | en |
|---|---|---|---|
| `videoExport` | `nothingVisibleToExport` | 时间轴上没有可导出的画面，请先添加视频或图片 | There's nothing visible to export. Add a video or an image first |
| | `missingMaterials` | 有 {count} 个片段的素材已被删除（{names}），请先删除这些片段再导出 | {count} clips use deleted materials ({names}). Remove those clips before exporting |
| | `degradedTitle` | 导出已完成，但以下内容未写入视频： | Export finished, but some content is missing from the video: |
| | `degradedImageOverlay` | 图片未渲染：{names} | Images not rendered: {names} |
| | `degradedSubtitles`〔RV-08〕 | 字幕未能烧录到视频中 | Subtitles couldn't be burned into the video |
| | `blackTailNotice`〔RV-04〕 | 视频末尾 {seconds} 秒没有画面，将显示为黑屏 | The last {seconds} s of the video have no picture and will be black |
| | `degradedAudioItem` | 音频未混入：{names} | Audio not mixed in: {names} |
| | `degradedEmbeddedAudio` | 视频原声未混入：{names} | Original video sound not mixed in: {names} |
| | `moreItems` | 等 {count} 个 | and {count} more |
| `materialsPanel` | `deleteConfirmTitle` | 删除素材 | Delete material |
| | `deleteConfirmBody` | 确定删除素材「{name}」吗？素材文件删除后无法恢复。 | Delete "{name}"? The file can't be recovered afterwards. |
| | `deleteConfirmBodyMany` | 确定删除这 {count} 个素材吗？素材文件删除后无法恢复。 | Delete these {count} materials? The files can't be recovered afterwards. |
| | `deleteInUseBody` | 时间轴上有 {count} 个片段使用了「{name}」，删除素材会同时移除这些片段。素材文件删除后无法恢复。 | {count} clips on the timeline use "{name}". Deleting it also removes those clips. The file can't be recovered afterwards. |
| | `deleteInUseBodyMany` | 时间轴上有 {count} 个片段使用了这 {materialCount} 个素材，删除会同时移除这些片段。素材文件删除后无法恢复。 | {count} clips on the timeline use these {materialCount} materials. Deleting them also removes those clips. The files can't be recovered afterwards. |
| | `deleteBlockedLocked` | 有 {count} 个使用该素材的片段位于锁定轨道上，请先解锁轨道再删除 | {count} clips using this material are on locked tracks. Unlock those tracks first |
| | `deleteConfirmAction` | 删除 | Delete |
| | `deleteFailedClipsRemoved`〔RV-12〕 | 素材删除失败，文件仍保留；已移除的片段可按 Ctrl+Z 恢复 | Couldn't delete the material, so the file was kept. Press Ctrl+Z to bring the removed clips back |
| `timeline.messages` | `externalUpdateRejected` | 外部修改无法应用，时间轴保持不变 | An external change couldn't be applied. The timeline was left unchanged |
| | `splitTooCloseToEdge` | 离片段边缘太近，无法切分（每段至少 0.1 秒） | Too close to the clip edge to split. Each part needs at least 0.1 s |
| | `incompatibleTrack` | 这条轨道不能放置该类型的素材 | This track can't hold this type of material |
| | `materialNotFound` | 素材库中已找不到该素材 | This material is no longer in the library |
| `timeline.subtitleEditModal` | `styleSettings` / `editingSingle` / `editingAll` / `applyToAll` | 样式设置 / 编辑单条字幕 / 编辑全部字幕 / 应用到全部 | Style / Editing one subtitle / Editing all subtitles / Apply to all |
| | `presets.{default,classic,modern,elegant,tech}` | 逐字沿用 `SubtitleEditModal.tsx:19-72` 现有文案 | Default / Classic / Modern / Elegant / Tech |
| | `fonts.{default,serif,sansSerif,monospace}` | 逐字沿用现有文案 | Default / Serif / Sans serif / Monospace |
| | `positions.{top,upper34,center,lower34,bottom}` | 逐字沿用 `:85-90` 现有文案 | Top / Upper third / Center / Lower third / Bottom |
| | `closeAriaLabel` | 关闭 | Close |
| | `discardChangesTitle` / `discardChangesBody` / `discardChangesConfirm` | 放弃未保存的修改？ / 关闭后，本次对字幕的修改不会保存 / 放弃修改 | Discard unsaved changes? / Your subtitle changes won't be saved / Discard |
| `imageOverlay`（新） | `done` / `revert` | 完成 / 还原位置 | Done / Revert position |
| `videoProjects` | `closeUnsavedTitle` / `closeUnsavedBody` | 部分修改尚未保存 / 保存项目时出错。现在关闭，最近的修改可能会丢失。 | Some changes aren't saved yet / Saving the project failed. If you close now, your latest changes may be lost. |
| | `keepOpen` / `closeAnyway` | 保持打开 / 仍然关闭 | Keep open / Close anyway |
| | `closeSaveSlowBody`〔RV-19〕 | 项目仍在保存。现在关闭，最近的修改可能会丢失。 | The project is still saving. If you close now, your latest changes may be lost. |
| | `timelineRepaired`〔RV-01〕 | 项目中有 {count} 个片段的数据无效，已自动修复 | {count} clips in this project had invalid data and were repaired |
| | `timelineUnreadable`〔RV-01〕 | 时间轴数据无法读取，已保留原始数据的备份，并以空时间轴打开 | The timeline couldn't be read. A backup of the original data was kept and the project opened with an empty timeline |
| `agentApply`（新） | `notApplied` | 该步骤未能应用到时间轴 | This step couldn't be applied to the timeline |
| | `reasons.{clipNotFound,trackNotFound,targetTrackMissing,invalidTime}` | 片段不存在 / 轨道不存在 / 目标轨道不存在 / 时间值无效 | The clip no longer exists / The track no longer exists / The target track doesn't exist / The time value is invalid |
| | `finishing`〔RV-05〕 | 正在把最后的修改应用到时间轴… | Applying the last changes to the timeline… |
| | `finishingTimedOut`〔RV-05〕 | 部分修改应用超时，时间轴已解锁，请检查结果 | Some changes took too long to apply. The timeline is unlocked, so check the result |
| `agentUndo` | `blockedWhileRunning` | Agent 正在执行，完成后才能撤销 | The agent is still working. You can undo when it finishes |
| `videoEditing.autoMix` | `orphansIgnored` | 已忽略 {count} 个来自已删除或旧脚本段落的素材 | Ignored {count} materials from deleted or replaced script segments |
| | `videoShort` | 第 {list} 段的视频不足以覆盖配音 | Segments {list} don't have enough video to cover their voice-over |
| `aiMixingProgress` | `errorInternal` | 生成剪辑方案时出错，请重试 | Something went wrong while generating the edit. Try again |
| | `errorBackendUnreachable` | 无法连接本地服务，请重启应用后重试 | Can't reach the local service. Restart the app and try again |
| | `errorInvalidRequest` | 部分素材信息无效，无法发送给剪辑模型 | Some materials couldn't be sent to the editing model |
| | `errorImportFailed` | 剪辑方案无法应用到时间轴 | The editing plan couldn't be applied to the timeline |
| | `analysisIncomplete` | {count} 个视频未能完成解析，方案仅参考了名称与时长 | {count} videos couldn't be analyzed, so the plan used only their names and durations |

`OperationRejectReason`（kebab-case）到 `agentApply.reasons` key（camelCase）的映射在 `ToolStep.tsx` 内以常量表完成。

---

## 7. 测试与验收

### 7.1 回归测试用例（每条缺陷至少一个，用例名描述被钉住的行为）

**后端（pytest，SQLite 内存库；ffmpeg 探针用例在无 ffmpeg 时 skip）**

| 文件 | 用例 | 钉住 |
|---|---|---|
| T1 | `test_contiguous_single_track_uses_concat_fast_path` / `test_labels_use_indices_not_track_ids` / `test_zero_opacity_clip_is_not_an_input` | S6 |
| T1 | `test_upper_track_overlay_passes_through_before_and_after_clip`（无 `tpad`，含 `eof_action=pass` 与 `setpts=PTS+2.000000/TB`） | EXV-01 |
| T1 | `test_same_track_gap_keeps_clip_at_start_time` / `test_leading_gap_disables_concat_fast_path` | EXV-02 |
| T1 | `test_timeline_end_past_last_clip_disables_concat_and_sets_base_duration` | EXV-03 |
| T1 | `test_dissolve_renders_as_alpha_ramps_without_shortening_timeline`（无 `xfade`，底图 `d=9.000000`） | EXV-04 |
| T1 | `test_bottom_track_fade_and_opacity_composite_over_black_canvas` | EXV-05 |
| T1 | `test_hard_cut_then_dissolve_never_feeds_concat_into_a_transition` / `test_hard_cut_after_dissolve_clip_emits_no_zero_length_transition` | EXV-06 / EXV-08 |
| T1 | `test_no_clips_renders_black_base_of_timeline_end` | EXO-06 |
| T3 | `test_canvas_upper_track_shows_lower_track_outside_its_clip`（t=1、5 为红） / `test_canvas_gap_renders_black_and_keeps_later_clip_time` / `test_canvas_dissolve_keeps_total_duration`（9.0 s，t=7.5 蓝） / `test_canvas_bottom_fade_darkens_over_black`（t=2 红 128±3） / `test_hard_cut_then_dissolve_graph_encodes` / `test_black_base_only_graph_encodes_with_duration` | EXV-01/02/04/05/06、EXO-06 |
| T4 | `test_total_duration_is_timeline_max_end_not_clip_sum`（音频混流命令含 `-t 6.0`） | EXV-03 |
| T4 | `test_filtergraph_failure_marks_composition_failed_instead_of_concat` | EXV-07 |
| T4 | `test_normalized_clip_uses_exact_frame_count`（d=2.345 → `-frames:v 70`） | EXV-10 |
| T4 | `test_image_and_audio_only_request_skips_normalize_and_composes_base` | EXO-06 |
| T5 | `test_each_subtitle_keeps_its_own_style_in_drawtext` / `test_merged_overlay_pass_uses_per_item_subtitle_style` | EXO-01 |
| T5 | `test_subtitle_without_background_draws_no_box` / `test_hex_with_alpha_background_converts_to_ffmpeg_color` | EXO-10 |
| T5 | `test_blank_line_inside_subtitle_keeps_following_text` | EXO-11 |
| T5 | `test_adjacent_subtitles_use_half_open_enable_window` | EXO-17 |
| T6 | `test_image_position_accepts_camel_case_z_index` / `test_image_overlays_stack_by_z_index_then_input_order` / `test_zero_opacity_image_is_skipped` / `test_image_opacity_is_rendered`（ffmpeg，像素 128±12） / `test_adjacent_images_use_half_open_enable_window`〔RV-09〕 / `test_image_z_index_is_clamped_to_0_999`〔RV-10〕 | EXO-02 / EXO-17 |
| T7 | `TestZeroRegression::test_translucent_still_chain_multiplies_alpha` / `test_opaque_still_chain_is_byte_identical` | EXO-02 |
| T8 | `test_failed_subtitle_pass_reports_subtitles_degradation` / `test_missing_audio_item_is_reported_not_silently_dropped` / `test_unreadable_clip_audio_probe_failure_is_reported` | EXO-03 |
| T8 | `test_a_missing_local_image_does_not_drop_the_other_overlays`（真实转换函数，STORAGE_ROOT 指向 tmp） | EXO-04 |
| T8 | `test_remote_image_url_is_skipped_with_degradation_and_never_downloaded`（`requests.get` 打桩为抛错） | EXO-18 |
| T8 | `test_composition_subtitle_burn_in_has_no_fixed_timeout` | EXO-16 |
| T9 | `test_short_graph_stays_inline` / `test_long_graph_is_written_to_script_file`（argv 中无超过 8000 字符的元素） / `test_option_file_probe_falls_back_to_filter_complex_script` / `test_160_subtitles_burn_in_succeeds`（ffmpeg） | EXO-05 |
| T10 | `test_unresolvable_media_failure_removes_temp_dir_and_keeps_task_id` / `test_missing_video_index_marks_status_failed` | EXO-13 |
| T11 | `test_status_never_reports_unknown_or_error` / `test_status_endpoint_whitelists_degradations` / `test_compose_accepts_image_items_without_video_items` / `test_compose_rejects_request_without_video_or_image_items` | EXO-08、S7、EXO-06 |
| T12 | `test_subtitles_are_mapped_through_clip_window` / `test_split_halves_do_not_duplicate_subtitles` / `test_missing_clip_end_uses_clip_start_plus_duration` | ME-03 |
| T13 | `test_sanitize_packs_lanes_and_reports_closed_gaps` / `test_parse_output_is_contiguous_per_lane` | AM2-01 |
| T13 | `test_sanitize_canonicalises_audio_track_names`（参数化 `None`、`2`、`"Audio Track 2"`、`"video-track-1"`、`"bgm"`） / `test_parse_never_emits_duplicate_track_ids` | AM2-02 |
| T13 | `test_prompt_example_is_contiguous_and_video_lane_is_longest` / `test_sanitize_warns_when_audio_runs_past_video_end` | AM2-06 |
| T13 | `test_overlap_shift_extends_total_instead_of_trimming`（a2 → 30–60、duration 30、无 trimmed 警告） | AM2-07 |
| T14 | `test_upload_validation_failure_returns_readable_error_response` | AM2-03 |

**前端（Vitest + Testing Library）**

| 文件 | 用例 | 钉住 |
|---|---|---|
| T16 | `hidden tracks and muted audio tracks are not rendered` / `locked tracks are rendered` / `render end is the latest rendered item end, not the sum` / `clips whose material is missing are not rendered` / `blank subtitles are not rendered` / `image items on a video track become image spans` | S5 |
| T17 | `sends the render end as total_duration for overlapping tracks` | EXV-03 |
| T17 | `an image between two videos keeps the second video start_time` | EXV-09 |
| T17 | `an image and audio timeline exports with empty video_items` / `an audio-only timeline is refused with nothingVisibleToExport` | EXO-06 |
| T17 | 〔RV-04〕`a 10 s video with 60 s music exports 60 s and warns about the black tail` / `a black tail under half a second exports without a notice` | EXV-03 / D-12 |
| T17 | `preview composition end and export total_duration agree for the same timeline`（同一 fixture 同时调用 T23 的构建函数） | S5 不变量 |
| T18 | `skips subtitles with empty text instead of exporting the item name` / `omits the background when the style has none` / `exports image opacity 0 as 0` / `keeps track order instead of sorting images by start time` | EXO-01/10/02 |
| T19 | `formats image overlay degradations with at most three names` / `merges the same degradation reported across polls` / `returns null when nothing degraded` | S7 |
| T20 | `shows a warning naming the images that were not rendered` | EXO-03 |
| T21 | `export refuses when a clip's material is missing and names the clip` | ME-02 |
| T22 | `stops polling on error status` / `rejects an unknown status instead of polling to the cap` / `accepts image_items without video_items` | EXO-08/06 |
| T23 | `composition end follows the latest rendered item` / `image and audio timeline enters composition mode` / `adding an image changes the composition signature` | ME-07 |
| T24 | `plays to the total duration with only image and audio layers` | ME-07 |
| T25 | `a subtitle ending at t is not drawn at t` / `a higher zIndex image draws above a later lower zIndex image` / 〔RV-10〕`images stay below subtitles for any zIndex` | EXO-17/02 |
| T26 | `silence-removed material resolves preview and export to the processed file` / `derived material deletes only its own storage key` / `remote processed url keeps no storage key` / `repair rebuilds a saved derived material whose localResolvedUrl points at the original` / `repair leaves non-derived materials untouched` / 〔RV-11〕`repair keeps a derived material's own cached_materials copy` | ME-01 |
| T27 | `does not delete a source file shared by another material` | ME-01 |
| T28 | `counts clips on every track including locked ones` / `detached audio referencing the video material counts as usage` / `subtitles never count` | ME-02 |
| T29 | `deleting an in-use material removes its clips as one undo step` / `refuses when a using clip sits on a locked track` / `refuses while the agent holds the edit lock` / `replacing a material url under the same id evicts its caches` / 〔RV-12〕`a failed delete after removing clips tells the user to undo` | ME-02/01 |
| T30 | `flushAllPending runs every registered flush` / `reports failed keys` / `reports a timeout` / `unregister removes the flush` | ME-08 |
| T31 | `a 5xx retry never overwrites a newer save made after unmount`（最后一次载荷为 v2） / `a retry after a project switch does not save the old project` / `the registered flush waits for the in-flight save then saves the latest content` / 〔RV-06〕`the close flush skips the 5xx retry wait instead of consuming the close budget` | ME-08 |
| D4 | `close is deferred until close-ready arrives` / `close proceeds after the timeout` / `keep-open choice cancels the close` / `a second close click while flushing sends only one request` / 〔RV-02〕`a close while the app is already quitting bypasses the flush` | ME-08 |
| T32 | `every user edit action is refused while the agent holds the edit lock`（表驱动：add / move / resize / remove / swap / split / detach / camera / 全部 track action / subtitle text / image position / auto-mix / drag commit；轨道 JSON 与历史条数不变） / `the agent's own replace still applies while locked` / `import and ai-mix replaces are refused while locked` / 〔RV-03〕`copying clips is refused while locked and records no history` / `organize materials is refused while locked`（源码断言：两处调用点首行 `isEditLocked`） | S9 / TL2-19 |
| T33 | `an external replace keeps the current zoom, scroll and playhead` / `an external replace clamps the playhead to the new end` / `an external replace cancels an in-flight drag` / `a malformed timeline throws before any history is recorded` | TL2-04/18、AG2-08 |
| T34 | `undo restores clips but keeps zoom, scroll position and playhead` / `undo drops selected ids the restored snapshot no longer contains` / `undo keeps selected ids that still exist` | TL2-04/03 |
| T35 | `a left-edge trim drag shifts an explicit camera-motion window by the trim delta` / `a zero-delta trim records no history` | TL2-02 |
| T35 | `a pointerup right after the threshold-crossing move commits and returns to idle` / `a drag released at its origin records no history` | TL2-16 |
| T35 | `undo is ignored while a drag is in flight` / `a commit for a vanished clip records nothing` | TL2-18 |
| T36 | `a 12px clip moves from any point` / `a 40px clip trims only within 8px of each edge` / `a 20px clip shrinks its edge zones to keep a 12px move zone` | TL2-06 |
| T36 | `ESCAPE leaves committed` / `a purely vertical move past the threshold starts a move drag` / `vertical jitter on a trim handle does not start a resize` | TL2-16/17 |
| T37 | `deleting the last clip moves a playhead past the end back to the end` | TL2-20 |
| T38 | `rejects a cut that leaves a piece shorter than MIN_CLIP_DURATION_SECONDS` / `splitting a still keeps each clip interval equal to its duration` / `a too-close cut returns too-close and records no history` / `entities do not import from domain services` | ME-09 / TL2-15 |
| T39 | `does not lose a hundredth to float error (2.3, 0.29, 4.35)` | TL2-09 |
| T40 | `muted and hidden audio tracks are not transcribed` / `clip range falls back to clipStart plus duration` | ME-03 |
| T41 | `reads the material type from drag types without getData` / `track dragover uses readDraggedMaterialType` / `track drop routes through onMaterialDrop` / `locked lanes keep pointer events` | ME-10、TL2-23 |
| T42 | `dialog carries aria-modal and focuses the first field on open` / `Escape closes when there are no changes` / `Escape with unsaved changes asks before discarding` / `timeline shortcuts ignore keys inside the dialog` / `renders English labels in the en locale` / `trapTabKey wraps focus from the last to the first element` | ME-04 |
| T43 | `hasPositionChanged ignores sub-tolerance noise` / `image position edits are refused while the agent edit lock is set` | ME-05、S9 |
| T44 | `external sync catches and reports rejected timelines` / 〔RV-01 / RV-03〕`a rejected or lock-refused external update resyncs the owner from the store` | AG2-08 |
| T45 | `cursor and handle width come from edgeHandleWidthPx` | TL2-06 |
| T46 | `add_to_track rejects a negative start time` / `compose_storyboard skips non-video materials and reports them` / `trim_clip derives the out-point from clipStart plus duration when clipEnd is absent` / `trim_clip on an image is refused with a resize hint` / `resize_clip on an image keeps duration equal to clipEnd minus clipStart` / `remove_material refuses a material still used on the timeline` | AG2-08/14/15/16 |
| T47 | `move_clip to a missing track leaves the clip and reports target-track-missing` / `delete_clip of a missing clip reports clip-not-found` / `add_clip with a negative start leaves the timeline untouched` / `add_clip snapshots the material playback urls onto the item` / `a batch with one rejected operation applies nothing` | AG2-02/08/16 |
| T48 | `move_clip to 0 places the clip first on its track` / `move_clip reports the post-reconcile start time and shifted clips` / `client and server layouts match after the same operations` / `agent add and move results are organize fixed points`（`findOrganizeDrift` 为空） | AG2-01、S8 |
| T49 | `auto_fix_overlaps leaves tracks without overlaps untouched` | AG2-09 |
| T50 | `does not inject the stopped note when a later assistant turn completed` | AG2-11 |
| T51 | `compactToolResult replaces nested data urls` / `serializeMaterial omits inline data thumbnails` / `replayed tool results drop inline data urls` | AG2-12 |
| T52 | `agentIsExecuting stays true until queued tool results are applied` / `a turn sent right after completion snapshots the drained timeline` / `unmount during a turn writes timelineTrackPatches for the sealed message` / `undo is refused while a turn is executing` / `the request body carries no inline thumbnails` / 〔RV-05〕`a turn whose queued event never settles unlocks after the finishing watchdog`（fake timers） | AG2-06/07/10/12 |
| T53 | `the tool card turns error when the client could not apply` | AG2-02 |
| T54 | `undo buttons are disabled while the agent executes` / 〔RV-05〕`the stop button is disabled while finishing`（`TimelineChatPanel` 源码断言） | AG2-10 / AG2-06 |
| T55 | `packs every AI lane so a later auto-organize changes nothing`（`findOrganizeDrift` 为空） / `reports packed item ids` / `gives a non-numbered AI audio track its own lane` / `creates AI lanes without a hard-coded track name` | AM2-01/02/08 |
| T56 | `drops videos of an earlier larger match when the segment is re-matched with fewer videos` | AS2-01 |
| T56 | `orders segments by the current script and renumbers them` / `ignores materials of segments no longer in the script and reports them as orphaned` / `keeps the legacy grouping when no script is given` / 〔RV-07〕`ignores a voice-over whose text hash no longer matches the segment` / `keeps a legacy voice-over without a text hash` | AS2-02 |
| T56 | `covers a long voice-over with a short video without leaving a hole`（视频总时长 60、末端 60） / `leaves no sub-0.1 s residue at a segment end`（视频末端 10.05） / `reports video-short when the residue cannot be covered` | AS2-03 |
| T57 | `keeps segment boundaries aligned after an unrelated edit repacks the tracks` / `refuses with edit-locked while the agent holds the lock` | AS2-03、S9 |
| T58 | `applies the materials present at confirm time, not at click time` / `reopens the confirmation when the replaced clip count changed` / `passes the current script segments to the planner` | AS2-04/02 |
| T59 | `maps every AI_MIX_* and proxy error code to a localized message without backend text` / `maps import failures to errorImportFailed` / `counts packed items in the partial warning` / `warns when footage analysis failed` | AM2-03/01/05 |
| T60 | `scales the batch timeout with the video count and stays under the BFF limit` | AM2-05 |
| T62 | 〔RV-01〕`clamps a negative start time to zero` / `drops items with a non-finite or non-positive duration` / `leaves a valid timeline byte-identical` | RV-01 |
| T63 | 〔RV-01〕`a timeline with a negative start opens repaired instead of empty` / `an unreadable timeline is backed up before the editor opens empty` / `an existing recovery backup is never overwritten` | RV-01 |
| T64 | 〔RV-07〕`hashes narration text when present and sentences otherwise` / `the hash changes when one word changes` | RV-07 |

测试纪律：不使用 `sleep` 同步（Vitest 用 `vi.useFakeTimers()` / 手动 resolve promise；pytest 用打桩与事件）；每个用例一个断言主题；
`.tsx` 组件测试沿用第 1 轮 IM-30 的 `?raw` + `typescript.transpileModule` 渲染方式，或以源码断言钉住连线。

### 7.2 验收门禁（实现节点必须实际运行并记录输出）

| # | 命令 / 检查 | 通过标准 |
|---|---|---|
| A1 | `npm run type-check` | 0 error |
| A2 | `npm run lint` | error 集合与基线 `a7f46c5`（8 条，均在未触及文件）一致；新增 / 修改文件 0 error |
| A3 | `npx vitest run` 指定 T16–T61 全部新增与修改文件，外加受影响套件：`src/components/video/timeline`、`src/lib/video-editing-agent`、`src/components/video/hooks/__tests__`、`src/components/video/lib`、`src/components/video/playback`、`src/components/video/projects`、`src/components/ui/__tests__` | 全部通过 |
| A4 | `npx vitest run` 全量 | 0 失败（基线 231 文件 / 2003 用例 / 0 失败），用例数不减少 |
| A5 | 后端（`backend-services/basic-service`，**须在可导入 `cv2` 的环境**）：`python -m pytest tests/test_filtergraph_builder.py tests/test_export_parity.py tests/test_export_canvas_ffmpeg.py tests/test_video_composition_timeline.py tests/test_subtitle_export_style.py tests/test_image_overlay_export.py tests/test_camera_motion_stills.py tests/test_composition_degradations.py tests/test_filter_script_args.py tests/test_composition_failure_cleanup.py tests/test_video_router_status.py tests/test_audio_transcription_service.py tests/test_ai_mixed_editing_hardening.py tests/test_timeline_import_router.py tests/test_audio_mix.py tests/test_video_composition.py tests/test_timeline_validation_fix.py tests/test_model_settings_video_cut_fallback.py -q` | 全部通过；ffmpeg 探针用例在实现机器上**实际运行**（记录 `N passed, 0 skipped` 中探针用例未被 skip） |
| A6 | `grep -n "first_subtitle" backend-services/basic-service/app/services/video_composition_service.py` | 0 命中 |
| A7 | `grep -n "tpad=start_duration\|xfade=" backend-services/basic-service/app/services/composition/filtergraph_builder.py` | 0 命中 |
| A8 | `grep -n "\|\| 1.0\|item.text \|\| item.name\|#000000@0.5" src/components/video/hooks/useVideoExport.ts` | 0 命中 |
| A9 | `grep -n "videoSequences.reduce" src/components/video/hooks/useTimelineComposition.ts` 与 `grep -n "videoSequences.length > 0" src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 均 0 命中 |
| A10 | `grep -nP "[\x{4e00}-\x{9fa5}]" src/components/video/components/SubtitleEditModal/SubtitleEditModal.tsx`（排除注释行）与 `grep -n "确认删除素材\|此操作不可撤销" src/components/video/hooks/useMaterialManagement.ts` | 0 命中（文案全部走 i18n） |
| A11 | `grep -rn "MAX_LOOPED_CLIPS\|MIN_DURATION_SECONDS" src --include=*.ts --include=*.tsx` | 0 命中（常量已删除 / 迁移为 `MIN_CLIP_DURATION_SECONDS`） |
| A12 | `grep -rn "isInlineThumbnail" src` | 0 命中 |
| A13 | `grep -n "clearHistory()" src/components/video --include=*.ts --include=*.tsx -r`（非测试文件） | 与第 1 轮 A6 口径一致：只允许 `historySlice.ts`（定义）、`projects/hydrateTimeline.ts`、`store/actions/historyActions.ts`（既有薄封装）；不新增调用 |
| A14 | `node desktop/main/closeGuard.test.js` 与 `node desktop/main/window-state.test.js` | 均通过 |
| A15 | `npm run build` | Compiled successfully |
| A16 | `git status --porcelain` | 仅含 §4 所列文件；无 `__pycache__`、`*.pyc`、`tsconfig.tsbuildinfo`、`.next/`、ffmpeg 探针输出与临时脚本文件 |
| A17 | 〔RV-03〕`grep -rnE "(getState\(\)\|state)\.(importFromData\|autoOrganize\|initTimeline\|removeItem\|moveItem\|resizeItem\|addItemToTrack\|splitItemAtTime\|detachAudio\|swapItems\|removeTrack\|setTrackVolume\|toggleTrack\w*\|updateItem\w*)\(" src --include=*.ts --include=*.tsx`（排除 `timeline/store/` 与 `__tests__`） | 只命中允许名单：`TimelinePanel.tsx` 的挂载 `initTimeline`、复制与整理（二者首行已有锁检查）、`projects/hydrateTimeline.ts`；新增命中必须先加锁检查并更新本表 |
| A18 | 〔RV-04〕`grep -rn "videoTrackTooShort" src` | 0 命中（或实施记录说明保留原因） |

### 7.3 桌面端走查（`cd desktop && npm run dev`，逐条勾选）

1. 上传本地视频 → 静音移除 → 预览新素材时长为处理后时长、无原片静音段；删除新素材 → 原素材与使用原素材的片段仍可预览、导出（ME-01）。
2. 把素材 A 放上两条轨道 → 在素材库删除 A → 确认框写明「2 个片段将被移除」→ 确认后片段消失；Ctrl+Z 恢复片段后点导出 → 提示「素材已被删除」并列出片段名（ME-02）。
3. 删除一个片段后立即（<1 s）点击标题栏关闭 → 重新打开项目，片段确已删除；〔RV-13〕打开 DevTools → Network request blocking，拦截项目保存请求（`*video-projects*`）后编辑并关闭 →
   出现「部分修改尚未保存」对话框，可选择保持打开；取消拦截后再次关闭 → 正常关闭且修改已保存（ME-08）。不要用结束 python 进程来模拟：那会先触发主进程「服务异常退出」对话框。
4. 视频轨 1 放 0–6 s 视频、视频轨 2 放 2–4 s 视频 → 导出成片 6 s：0–2 s 与 4–6 s 为轨 1 画面，2–4 s 为轨 2 画面，无黑屏、无冻结（EXV-01/03）。
5. 同一视频轨：视频 A、图片、视频 B 依次排列 → 导出后 B 的画面与其原声同步出现在时间轴位置，图片只覆盖自身时间段（EXV-09）。
6. 仅放图片 + 配音 → 预览可以播放、进度条长度等于配音时长；导出成功且画面为图片；仅放配音 → 导出按钮提示「没有可导出的画面」（EXO-06 / ME-07）。
7. 10 s 视频 + 60 s BGM → 预览播放到 60 s（后 50 s 黑屏有声）；点击导出 → 不再被「视频轨道长度不足」拒绝，出现「视频末尾 50.0 秒没有画面」提示且导出继续，成片 60 s（ME-07 / EXV-03 / D-12）。
8. 两条字幕设置不同字号、颜色、位置（其一无背景）、其中一条含空行 → 导出后各自样式正确、无背景的没有黑框、空行后的文字存在（EXO-01/10/11）。
9. 一张图片不透明度 50%、zIndex 高于后出现的另一张 → 导出中半透明且叠在上方（EXO-02）。
10. 手动删除一张已上轨图片的源文件后导出 → 导出完成，出现「图片未渲染：xxx」提示，其余图片正常（EXO-03/04）。
11. 导入含 150 条字幕的项目（Windows）→ 导出成片包含全部字幕（EXO-05）。
12. 音频片段裁掉前 10 s → 按 S 识别字幕 → 字幕只对应保留部分，时间与画面同步；静音的 BGM 轨不参与识别（ME-03）。
13. 打开字幕编辑弹窗，点击预设后按 Delete / 空格 / S → 时间轴无变化、不播放；修改后按 Esc → 询问是否放弃；切换英文界面，弹窗全部为英文（ME-04）。
14. 拖动图片叠加到左上角后点击预览空白处 → 位置保留；接着裁剪任意片段 → 图片位置不变；Ctrl+Z 恢复图片位置（ME-05）。
15. 缩放到 10%，拖动 1 s 的短片段 → 可以移动；鼠标移到片段边缘时光标变为左右箭头；快速甩动片段后立即松手，再拖其他片段 → 仍可拖动（TL2-06/16）。
16. 放大到 300% 并滚动到 40 s 附近，执行一次编辑后按 Ctrl+Z → 缩放与滚动位置不变，点击标尺跳到点击处时间（TL2-04）。
17. 让 Agent 执行一个包含多次添加的任务，执行期间：点击素材面板「添加到时间轴」、拖动预览中的图片、Tab 到轨道头按空格、点击消息上的「撤销本轮」→ 全部无效并提示「Agent 正在编辑时间轴」；任务结束后以上操作恢复（TL2-19 / AG2-10 / AG2-06）。
18. 让 Agent「把最后一个片段移到最前面」→ 片段确实到最前，回复中的位置与时间轴一致；让 Agent 删除一个正被使用的素材 → Agent 说明需要先删除片段（AG2-01/16）。
19. 某段先匹配 3 个视频，再重新匹配 1 个；删除脚本中的另一段 → 「AI自动混剪」只使用新匹配的视频、不包含已删除段落；执行一次无关的字幕删除后，每段视频与配音仍对齐（AS2-01/02/03）。
20. AI 混剪完成后删除一条字幕 → 视频、图片、音频片段位置均不变化（AM2-01）。
21. 〔RV-01〕关闭应用，用 SQLite 工具把某项目 `uiState.currentTimelineState` 中一个片段的 `startTime` 改为 `-3` → 打开项目：出现「已自动修复 1 个片段」提示，其余片段完好；
    再把某轨道的 `items` 改为字符串 `"broken"` 使整体无法读取（〔IM2-29〕条目级无效值会被修复而不是失败）→ 打开项目：出现「已保留原始数据的备份」提示，数据库中 `timelineRecoveryBackup` 存在且等于修改后的原始值。
22. 〔RV-05 / RV-03〕Agent 执行期间：按 Ctrl+C 复制选中片段、点击工具栏「整理素材」→ 均无效并提示；执行结束后聊天区短暂显示「正在把最后的修改应用到时间轴…」，停止按钮置灰，随后解锁。
23. 〔RV-07〕用 Agent 生成脚本并为第 1 段生成配音 → 修改第 1 段文案、不重新生成配音 → 点「AI自动混剪」：第 1 段报告缺少配音并提示忽略了过期素材，而不是放入旧配音。

---

## 8. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 画布合成对长时间轴同时打开全部归一化片段作为输入 | 内存占用上升 | 输入个数与现有 filtergraph 路径相同；磁性主轨是从 0 开始的连续段，按「连续段」concat 后再叠加，滤镜数与现状同阶；连续单轨仍走 concat 快速路径；超长时间轴（>200 片段）预合并中间文件列入附录 A N-04 |
| R2 | 导出成片恒为时间轴终点长度，尾部可能出现黑屏 | 用户感知变化 | 与预览一致（S5）；属于修复错误的「冻结 / 截断」；走查第 4、7 条 |
| R3 | dissolve 从 xfade 交叉溶解改为「经黑渐变」 | 旧项目 / 导入数据的转场观感变化 | 与预览 `TransitionLayer` 语义一致；当前 UI 无法创建转场；`test_export_parity.py` 同步更新 |
| R4 | `-/filter_complex` 语法依赖 ffmpeg 版本 | 旧版 ffmpeg 报参数错误 | 运行时一次性探测并回退 `-filter_complex_script`；8000 字符以下保持内联；实现节点记录 `desktop/scripts/prepare-ffmpeg.js` 打包的 ffmpeg 版本 |
| R5 | `degradations` 让「以前静默成功」的导出出现提示 | 用户以为新问题 | 只在内容确实缺失时出现；文案点名缺失项与原因 |
| R6 | EXV-07 之后合成失败不再回退串接 | 以前「成功」（实为错误成片）的导出变为失败 | 期望行为；`error_summary` 可读；失败时状态就地更新并清理临时文件（EXO-13） |
| R7 | S9 store 层锁误拦 Agent 自身写入 | Agent 操作不生效 | Agent 写入只经 `replaceTimelineAction('agent' / 'agent-undo')`；实现节点 grep 确认 `OperationApplier` 不直接调用其他 store action；T32「the agent's own replace still applies while locked」钉住 |
| R8 | `inert` 使 Agent 执行期间时间轴区域不可聚焦 | 屏幕阅读器用户在执行期间无法浏览时间轴 | 只在执行期间生效；执行状态由 `AgentBusyBar` 展示；与「执行期间禁止编辑」的产品语义一致 |
| R9 | 新状态 `'finishing'` 遗漏消费方 | 忙碌指示闪烁或发送按钮提前可用 | §3.7 AG2-06 列出全部消费方（`TimelineChatPanel.tsx:95,180,194`、`agentIsExecuting`）；实现节点再以 `grep "status === '"` 核对 |
| R10 | TL2-04 之后撤销不再移动播放头 / 缩放 | 依赖旧行为的流程变化 | 与主流 NLE 一致（撤销只影响内容）；播放头超出新终点时仍被钳制 |
| R11 | TL2-06 悬停热区检测在 pointermove 上运行 | 渲染开销 | 仅热区变化时 setState；交互中不检测 |
| R12 | ME-02 删除素材后 Ctrl+Z 恢复出指向已删除素材的片段 | 片段在预览中不显示 | 导出前置检查阻止并点名片段；时间轴「素材缺失」标记列入附录 A N-01 |
| R13 | ME-08 关闭拦截在渲染进程异常时困住用户 | 无法关闭窗口 | 3 s 超时照常关闭并记录日志；`webContents` 已销毁 / 崩溃时直接关闭；重复点击不重复请求 |
| R14 | 排查环境无法导入 `cv2`，合成服务集成测试未能在本机运行 | 服务层改动缺少实跑证据 | A5 强制在可导入 `cv2` 的环境运行；若实现机器同样失败，按 `requirements` 修复 venv 中的 OpenCV（不改代码）并在实施记录中写明环境 |
| R15 | AM2-01 让 AI 放在非 0 时刻的图片被贴紧到图片道前部 | 图片出现时刻与模型意图不同 | 与手动编辑的既有规则一致（D-1 / D-3）；计入 `partialWarning`；提示词要求首尾相接；图片轨自由定位列入 N-03 |
| R16 | AS2-02 以当前脚本为准：用户清空脚本后自动混剪无内容可排 | 用户困惑 | 提示 `orphansIgnored` 与跳过段落；未传 `segments` 时保留旧规则，仅 VEI 入口传入 |
| R17 | AG2-01 插入点语义（同起点排前）改变模型的移动结果 | 模型预期差异 | 工具描述写明；结果回报实际位置与 `shiftedClips`，模型可自检；客户端与服务端同一函数 |
| R18 | `i18n.ts` 三处同步易漏 | 类型错误或缺文案 | 先改接口类型，`npm run type-check` 强制 en / zh-CN 补齐；A10 检查硬编码中文 |
| R19 | 规模：66 项，约 75 个前端文件、13 个后端文件、4 个桌面端文件 | 实施周期长、半成品风险 | §9 分组、每组独立可验证、受阻时按 I-2 优先级取舍，任何一组不得半完成提交 |
| R20 | `repairDerivedMaterialIdentity` 误改非派生素材 | 普通素材存储身份被改写 | 只处理三种派生标志且本地引用 ≠ `url` 的素材；T26「repair leaves non-derived materials untouched」钉住；修复幂等 |
| R21 | 〔RV-04〕删除「视频短于音频」硬拦截后，用户可能无意导出带长黑尾的成片 | 成片观感 | 与预览一致；导出开始即显示带秒数的黑尾提示；< 0.5 s 不打扰 |
| R22 | 〔RV-05〕看门狗在事件链未排空时解锁，用户编辑与迟到的 Agent 操作交错 | 迟到操作覆盖用户刚做的编辑 | 仅在 15 s 未排空（异常）时触发；记录错误日志并提示「请检查结果」；迟到操作仍是一步可撤销的外部写入 |
| R23 | 〔RV-07〕文本哈希拼接方式与 TTS 实际朗读文本不一致 | 新生成的配音被误判为过期 | 实现节点以 `ScriptPanel` TTS 请求实际使用的文本为准并在 T64 钉住；旧配音无哈希时照常参与 |
| R24 | 〔RV-01〕`repairTimelineData` 修复掉用户有意为之的数据 | 片段位置变化 | 只处理会让 `TimelineAggregate` 抛错的值（负 / 非有限起点、无效时长）；有效时间轴字节不变（T62）；修复数量明确提示 |

---

## 9. 实施顺序与提交分组

实现节点按下列顺序推进，每组完成后运行该组测试与 A1 再进入下一组（最终由提交节点统一提交，〔RV-15〕提交信息按 CLAUDE.md 约定使用 `[fix]` 前缀；暂存时逐文件 `git add <path>`，禁止 `git add -A`）：

| 组 | 内容 | 文件 | 测试 |
|---|---|---|---|
| G1 数据安全 + S10 | ME-01、ME-02、AG2-08、ME-08、〔RV-01 / RV-02 / RV-06〕 | F2（缺失素材检查）、F12–F25、F31（构造先于记录）、F38（外部同步 try/catch 与回写所有者）、F53、F63（负起点）、F78–F79、D1–D5 | T21、T26–T31、D4、T33（malformed）、T44、T46 / T47（负起点）、T62、T63 |
| G2 编辑锁 + 拖拽状态机 | S9、TL2-19、TL2-16、TL2-17、TL2-18、AG2-06、AG2-10 | F15（`inert` / 添加入口）、F26–F33、F34（拖拽部分）、F38（锁 / 快捷键 / deltaY）、F44、F51、F68–F70（finishing / 看门狗 / undoDisabled / 停止按钮，〔RV-05〕）、F38（复制 / 整理锁检查，〔RV-03〕） | T32、T33、T35（flick / historyDuringDrag）、T36（threshold）、T52（06 / 10）、T54、T57（edit-locked） |
| G3 时间轴核心 | TL2-02、TL2-03、TL2-04、TL2-06、TL2-09、TL2-20、TL2-23、ME-09、ME-10 | F14（拖拽 MIME）、F28、F29、F31–F43、F45 中对应部分 | T34、T35（resizeCommit）、T36（hitZones）、T37–T39、T41、T45 |
| G4 S5 + S6 导出画布 | EXV-01～EXV-10、EXO-06、ME-07 | F1、F2（S5 部分）、F5（请求校验）、F6–F8、B1、B2（S6 部分）、B7（EXO-06） | T1–T4、T11（compose 校验）、T16、T17、T22（validate）、T23、T24 |
| G5 S7 + 叠加 / 字幕 / 音频 | EXO-01、EXO-02、EXO-03、EXO-04、EXO-05、EXO-08、EXO-10、EXO-11、EXO-13、EXO-16、EXO-17、EXO-18 | F2（条目 / 降级）、F3、F4、F5（状态 / 降级）、F9–F11、B2（其余）、B3–B8 | T5–T11、T15、T18–T20、T22（poll）、T25 |
| G6 手动剪辑外围 | ME-03、ME-04、ME-05 | B9、F38（字幕识别 / 保存阻止）、F41、F46–F50、F7（叠加手势） | T12、T40、T42、T43 |
| G7 剪辑 Agent | AG2-01、AG2-02、AG2-07、AG2-09、AG2-11、AG2-12、AG2-14、AG2-15、AG2-16 | F52–F67（除 G1 / G2 已改部分）、F68（07 / 12）、F70（ToolStep）、F71、T61 | T46–T53 |
| G8 AI 混剪 / 自动混剪 | AS2-01～AS2-04、AM2-01、AM2-02、AM2-03、AM2-05、AM2-06、AM2-07、AM2-08 | F15（自动混剪移出）、F72–F77、F80–F81、B10–B13 | T13、T14、T55–T60 |
| G9 全量门禁 | §7.2 A1–A16 + §7.3 桌面走查 | — | — |

依赖说明：G1 先于 G7（`operationGuards.ts` 由 AG2-08 创建、AG2-02 扩展）；G2 先于 G3（`dragSlice.ts` / `dragMachine.ts` 先完成状态机修复再改热区与裁剪提交）；
G4 先于 G5（同一合成服务文件，先完成画布与终点再改叠加链路，降低冲突）；T61（`src/test/organizeFixedPoint.ts`）在 G7 首次使用、G8 复用。

**实施约束**（实现节点与提交节点必须满足）：

| # | 约束 | 验证方式 |
|---|---|---|
| I-1 | 先写回归测试并确认在基线上失败，再改代码；每组完成后运行该组测试与 A1 | 实施记录列出每组「先红后绿」的用例名 |
| I-2 | 受阻时按 G1 → G4 → G2 → G5 → G7 → G8 → G3 → G6 优先级推进；任何一组不得半完成提交；无法完成的缺陷整条移入附录 A，并在「实施过程发现的方案缺陷」段写明原因；〔RV-18〕同时更新 §1 / §2 的范围数字与各组计数，保持文档口径与提交一致 | 提交分组与文档记录 |
| I-3 | S6（新 builder）与 EXV-07（失败不回退串接）必须同组落地，不得出现「新图已生效而失败仍串接全部轨道」的中间状态 | G4 提交同时包含 B1 与 B2 的 `CompositionStageError` |
| I-4 | S9 store 层锁与 AG2-06 `'finishing'` 必须同组落地（锁提前释放会让排空阶段的 store 锁失效） | G2 提交同时包含 F26 与 F69 |
| I-5 | 不新增 `clearHistory()`；新增文案「接口类型 / en / zh-CN」三处同步；不改数据库 schema、不引入启动期 DDL | A1、A13、`git diff --stat` |
| I-6 | A5 在可导入 `cv2` 的环境运行，ffmpeg 探针用例实际执行（未被 skip） | A5 输出记录 |
| I-7 | 遵守 CLAUDE.md 规模限制：`VideoEditingInterface.tsx`（2527 行）、`TimelinePanel.tsx`（1359 行）、`video_composition_service.py`（约 2917 行）已超 1000 行，本轮新增逻辑一律进入新模块（F1 / F3 / F4 / F12 / F18 / F20 / F42 / F47 / F53 / F59 / F72 / F78 / F80、B3）；被改动的函数超过 60 行须拆分或附一行原因注释 | 代码评审节点逐文件核对 |

若实现中发现本方案缺陷，记录到本文件末尾「实施过程发现的方案缺陷」段（由实现节点新增）。

---

## 附录 A：已证实、未纳入本轮的缺陷（第 3 轮输入）

延后准则：当前 UI 不可达的功能补全（TL2-01）；会整体改变既有项目观感、需要视觉走查的改动（EXO-09、TL2-14）；
引入平台风险的新基础设施（ME-06 WebAudio 增益、EXO-07 / AM2-04 可取消的后端任务）；纯交互打磨与可访问性（TL2-07～TL2-13、AG2-20）。

| ID | 级别 | 标题 | 证据（基线 `a7f46c5`） |
|---|---|---|---|
| EXO-07（BL-10） | P2 | 导出轮询 10 分钟硬上限、无用户取消入口、无后端取消 / ffmpeg 终止；排队计入上限；进度在最长的合流阶段停在 88.5% | `videoComposition.ts:359-397`；`VideoPlayerPanel.tsx:732-737`；`video_composition_service.py:979,1478` 及全部 `subprocess.run` 调用点 |
| EXO-09 | P1 | 字幕字号、位置、换行在预览与导出间不一致（预览按画布像素、导出按成片像素；`upper-3/4 / lower-3/4` 预览无锚点；CJK 预览不换行） | `CanvasCompositor.ts:873-883`；`SubtitleLayer.ts:76-80,115-131`；`subtitle_service.py:163-173,719-732`；`SubtitleEditModal.tsx:85-90` |
| EXO-14 | P2 | 导出界面状态随编辑器重挂载丢失、可重复导出；下载失败仍显示「导出成功」；重复的兜底下载；整文件以 Blob 缓冲 | `useVideoExport.ts:131-133,762-782,835-841`；`VideoExportProgressModal.tsx:140-146,219-226`；`http-client.ts:614` |
| ME-06 | P1 | 音量 >100% 在预览中听不出（媒体元素钳制到 1），导出按最高 2 倍生效 | `playback/AudioSyncPool.ts:102-107,134-140`；`playback/VideoSourcePool.ts:166-171,240`；`infrastructure/effectiveVolume.ts` |
| ME-11 | P2 | 时长未知的视频上轨固定 5 s 且右边缘上限为 5 s | `ItemPlacementService.ts:43,192,230-232`；`TimelineItem.ts:448` |
| ME-12 | P2 | 轨道头没有静音按钮（`toggleTrackMuteAction` 无 UI 调用方）；锁定 / 显示切换进入撤销历史 | `Track.tsx:336-556`；`trackActions.ts:14-48` |
| TL2-01（BL-15） | P1 | 分离音频被整轨贴紧导致与视频错位、新分离轨排在字幕轨之后；UI 无分离入口（需 `linkedItemId` 模型、联动删除 / 切分 / 裁剪与右键菜单） | `TimelineAggregate.ts:257-263,677,698`；`detachAudio.ts:63`；`TrackContainer.tsx:333-344`；`Track.tsx:585-594` |
| TL2-05（BL-19） | P2 | 无裁剪信息的旧条目左边缘裁剪裁错端、破坏 INV-3 | `TimelineItem.ts:408-423`；`CompositionAdapter.ts:149-151` |
| TL2-07（BL-21） | P2 | Ctrl+滚轮缩放不以光标为锚点；React 被动监听使 `preventDefault` 无效 | `TrackContainer.tsx:276-284,306`；`TimelineRuler.tsx:278-286,416` |
| TL2-08（BL-22） | P2 | 点击轨道空白处无法取消选择 | `TrackContainer.tsx:130-134,156-168`；`Track.tsx:561-574` |
| TL2-10（BL-24） | P2 | 音量滑块拖动中按 Esc 仍提交；卸载后监听残留 | `VolumeSlider.tsx:144-162,224-235,301-324` |
| TL2-11（BL-25） | P2 | 句子分段条忽略 `clipStart`；「句」硬编码中文 | `SentenceSegmentBar.tsx:47-55`；`TimelineItem.tsx:480-485,508`；`SplitService.ts:86-105` |
| TL2-12（BL-26） | P2 | 工具栏状态恒为「选择」；剪切按钮无 `aria-pressed`；标尺任意鼠标键跳转且不聚焦滑块 | `TimelineToolbar.tsx:318-336,416-418`；`TimelineRuler.tsx:129-136,405-415` |
| TL2-13（BL-29） | P2 | 键盘聚焦的按钮上按空格触发全局播放而非激活按钮 | `VideoEditingInterface.tsx:415,420`；`shortcutOwnership.ts:46-53` |
| TL2-14（BL-33） | P2 | 主题色无 `<alpha-value>`，579 处 `bg-primary/15` 类修饰不生成样式；`hsl(var(--muted))` 为无效 CSS *[实测 Tailwind 编译]* | `tailwind.config.js:35-86`；`TrackContainer.tsx:407,415` |
| TL2-22 | P2 | Ctrl+C 复制已分离音频的视频得到无声副本；副本不被选中（依赖 TL2-01） | `TimelinePanel.tsx:770-791` |
| TL2-24 | P2 | 播放时视图不跟随播放头；刮擦 / 拖拽到视口边缘不自动滚动 | `TimelinePanel.tsx:475-503`；`TimelineRuler.tsx:138-144` |
| AG2-03（BL-13） | P2 | `get_timeline` 缺素材类型、字幕文本、分离标记、转场、可见性 | `tools/getTimeline.ts:18-39` |
| AG2-04（BL-27） | P2 | 默认时间轴在客户端与服务端重复定义；空时间轴起步的轮次无法整轮撤销 | `OperationApplier.ts:616-635`；`chat/route.ts:246-265`；`useAgentExecution.ts:430-434` |
| AG2-05（BL-28） | P2 | 单步撤销只对最近一轮有效，且只按 toolCallId 查找 | `useAgentExecution.ts:399-400,594-613`；`AgentResponseNode.tsx:79-83` |
| AG2-13 | P2 | 对话历史无体积预算（整轮重放、旧 `get_timeline` 快照、补丁含波形数据） | `agent.ts:79-80,107-108`；`messageConverter.ts:30,111-114`；`trackPatch.ts:144-150` |
| AG2-17 | P2 | 只有工具调用、没有文字的轮次不显示「撤销本轮」 | `VideoChatWindow/timeline/utils.ts:214`；`AgentStateManager.ts:177` |
| AG2-18 | P2 | 锁定 / 字幕轨上无法修复的重叠让每次编辑都带 `overlapWarning` | `tools/index.ts:162-164` |
| AG2-20 | P2 | Agent UI 硬编码英文；撤销菜单无 `role="menu"`、无键盘操作；同名步骤无法区分 | `AgentResponseNode.tsx:109-202`；`TimelineChatPanel.tsx:101,269`；`useAgentExecution.ts:333,378` |
| AG2-21 | P2 | 客户端 30 分钟绝对超时与服务端「无活动」超时语义不一致，长任务被客户端切断 | `SSEStreamManager.ts:133,198,580-586`；`chat/route.ts:466-478` |
| AM2-04 | P2 | AI 混剪取消只中止浏览器请求，后端 LLM（最长 240 s）与视频解析继续运行并计费 | `useAIMixedEditing.ts:498`；`backend-proxy.ts:256-257`；`ai_mixed_editing_router.py:126-130` |
| BL-14 | P2 | `AIVideoGenerateService` 仍绕过模型设置、示例音量 200，且全仓零调用方——建议连同路由、测试与仅测试调用的 `validate_simplified_timeline` 一并删除 | `ai_video_generate_service.py:21-31,56`；`ai_video_generate_router.py:57,130-141` |

本方案设计过程中产生的后续项：

| ID | 内容 | 来源 |
|---|---|---|
| N-01 | 时间轴条目显示「素材缺失」标记（素材被删除后 Ctrl+Z 恢复的片段、旧项目中的断链片段） | ME-02 / R12 |
| N-02 | 图片叠加键盘微调（方向键 1%，Shift 10%，停顿 400 ms 后入库） | ME-05 |
| N-03 | 图片轨（覆盖轨）自由定位：退出磁性贴紧规则，允许图片在任意时刻出现 | D-1 / D-3 / R15 |
| N-04 | 超长时间轴（>200 片段）先把连续段预合并为中间文件再做画布叠加 | R1 |
| N-05 | 浏览器调试路径的 `pagehide` 刷写（`keepalive` 请求体上限 64 KB，需分块或仅保存增量） | ME-08 |
| N-06 | 播放头钳制口径与 S5 `renderEnd` 统一（隐藏轨内容之后的播放头位置） | 评审 RV-17 |
| N-07 | 从 `timelineRecoveryBackup` 恢复时间轴的用户入口（项目菜单「恢复备份的时间轴」） | 评审 RV-01 |
| N-08 | 素材删除的后端异步清理失败时提示用户（当前只记日志；同步失败已提示可撤销） | 实施 IM2-27 |
| N-09 | 素材以同 id 替换（去水印）后刷新时间轴片段快照的 `url / cacheUrl`，或让预览 / 导出一律先按 `materialId` 解析 | 实施 IM2-31 |
| N-10 | Agent `delete_clip / trim_clip / resize_clip` 之后同样贴紧（S8 不动点），并在结果中回报被移动的片段；需同步调整单步撤销的冲突判定 | 实施 IM2-46 |
| N-11 | 修复 4 个基线即失败的后端用例：`test_video_composition.py` 三例改用现有 API 与可打桩的文件系统访问、URL 用例不依赖本机 DNS；静音音频识别用例的 ASR 最终帧等待改为可注入超时 | 实施 A5 记录 |
| N-12 | Agent 执行期间 `inert` 连带冻结已打开的弹窗：字幕编辑、运镜与字幕替换确认框在 TimelinePanel 内直接渲染（无 portal），执行期间取消 / 关闭 / 输入全部不可用，结束后恢复。改为 `createPortal` 渲染或收窄 `inert` 范围 | 代码评审 RC2（tl-ui） |
| N-13 | VEI 切段素材继承原片 `segment_id / segment_number / segment_assigned_at / video_index_in_segment`：无脚本（旧分组）时切片顶替该槽位的原视频，有脚本时计入忽略数量（本轮之前即存在） | 代码评审 RC2（aimix） |
| N-14 | `_extract_video_audio_tracks` 以 `_convert_url_to_local_path(url)` 重新解析路径，未复用已命中的本地缓存路径；旧远程素材可能联网探测原声（失败已记 `embedded_audio` 降级，不再静默） | 代码评审 RC2（be-compose） |
| N-15 | 字幕烧录边界：临时目录路径含 `'` 会破坏 `textfile='…'` 引号使字幕整体降级；msyh 字体无 emoji 字形；纯日文 / 韩文选到拉丁字体；`_get_font_path` 日志中的 ✓ / ❌ 在 GBK 控制台抛 `UnicodeEncodeError`（仅丢该条日志） | 代码评审 RC2（be-subtitle-router） |
| N-16 | 基线即失败的旧字幕测试：`test_portrait_subtitle_centering.py` 4 例（缺 `text_files_dir` 参数、断言已删除的日志）、`test_subtitle_add.py` 7 例（缺 `datas/merge/` 样例）——按新 API 重写或删除 | 代码评审 RC2（be-subtitle-router） |
| N-17 | `DragCalculationService.detectInteractionType` 仍按固定 8 px 判定热区，与状态机 `edgeHandleWidthPx` 不一致；生产代码无调用方，删除或改为共用热区函数 | 代码评审 RC2（tl-store） |
| N-18 | 图片叠加拖动进行中 Agent 恰好获得编辑锁：叠加层卸载时提交被拒并提示，本地预览停在拖动后的位置直至下一次 store 同步 | 代码评审 RC2（fe-export） |
| N-19 | `video-editing-agent/types.ts` 中 `TimelineOperation.add_clip.material` 缺 `serverUrl / cacheUrl / storageKey / metadata` 快照字段，`agent.ts` 以 `as AgentMaterialData` 强转、工具以 `url: material.url` 覆盖满足类型——扩展该类型 | 代码评审 RC2（agent） |
| N-20 | `compose_storyboard` 不检查目标轨是否锁定（既有）：客户端跳过应用，但工具卡片仍显示成功 | 代码评审 RC2（agent） |
| N-21 | `finishing` 看门狗超时后，卡住的那一轮消息保持 `isStreaming` 直至下次挂载清理（RV-05 设计所致） | 代码评审 RC2（agent） |

---

## 附录 B：已核查为正确的项（后续评审无需重复）

- **导出**：视频轨 z 序 `track.order → track_z → group_tracks` 与预览一致；隐藏轨排除、锁定轨导出；上层轨长于下层轨时不被截断；
  界面提供的全部宽高比在后端枚举中存在，输出宽高恒为偶数；所有条目创建路径都写 `clipStart / clipEnd`，`-ss / -t` 与 `ClipTimeMapping` 一致；
  分离音频的视频不提取原声；运镜在归一化阶段烘焙且有独立时长保护。
- **叠加与音频**：静音音频轨在预览与导出都跳过；`amix normalize=0` 且逐条音量钳制 ≤2；图片 contain 适配与预览 `_containRect` 一致；
  界面产生的图片位置已钳制在 [0,1]、最小 0.1；字幕字号 10–120 在 Pydantic 范围内；并发导出以 uuid 隔离输出与临时目录；
  `error_summary` 已展示给用户；RC-01「卸载后照常下载」完好；状态接口已白名单 `warnings`。
- **手动剪辑**：切分时运镜关键帧重定基正确、内侧转场被清除、只写一条 `SPLIT_ITEM`；项目保存 / 重开保留 `cameraMotion / transitions / imagePosition / subtitleStyle / audioDetached / opacity` 与轨道标志；
  `normaliseProjectDataForSave` 只剥离瞬态与内联缩略图；`updateSubtitleTextAction / updateImagePositionAction / setCameraMotionAction` 各一条历史、无变化不记录、锁定轨拒绝；
  `removeTrackAction` 保护最后一条轨道并清理选区；删除素材清理胶片带 / 波形 / 视频 / 本地下载缓存；字幕识别先确认后请求且提交前复查锁（RC-18）；
  第 1 轮 TL-02 拖拽取消、S2 同步捕获、S3 键位解析、TL-07 被拒绝的编辑不写历史、跨轨移动先校验后变更、TL-04 图片伸缩、缩放范围、轨道头宽度 224 px、播放中标尺定位、音量手势单条历史、`replaceTimelineAction` 无变化检测均正确。
- **Agent**：按 store 实际产生的排序输入，`auto_fix_overlaps` 客户端与服务端布局 0 / 2241 次分歧 *[实测]*；批量路径不重复应用最后一个片段；观察到 `tool_call` 后不自动重连、退避后才重置；
  keepalive 在 `finally` 与 `cancel` 中清理；停止会丢弃在途操作且工具请求随路由中止；锁定跳过判定先于删除动画延迟；`move_clip` 检查源轨与目标轨锁定、同轨移动跳过类型校验；
  `revertTrackPatches` 先检测冲突再变更并跨轨回填缩略图；封口先捕获本轮 ref；`resize_clip` 源时长上界两端一致；默认轨排除锁定与不兼容轨；消息转换为每个工具调用补全结果；补丁剥离内联缩略图。
- **AI 混剪 / 自动混剪**：`llm_json` 处理代码块、think 块、带花括号的散文与 NaN / Infinity，加固测试 45 passed；`_call_llm` 统一包装上游错误且空回复以占位回放；VIDEO_CUT 环境变量整组回退；
  600 s 客户端超时与 BFF 一致；50 个带解析的视频提示词 67304 字符 *[实测]*，无膨胀；合并对确定性 id 的重命名覆盖重复运行；AI 字幕轨被忽略、锁定目标轨跳过；同一方案再次运行不写历史并提示无变化；
  每个阶段检查中止信号与 runId；两个弹窗的焦点、Tab 圈定与背景点击规则正确；素材 DTO 剥离 `blob:` 与重型元数据；预览与导出按 `materialId` 解析 AI 条目；
  TTS 音频总有时长；`applyScriptAutoMixAction` 以 `createItemFromMaterial` 快照播放地址、拒绝时不写历史、只替换排布用到的轨道；段号列表分隔符按语言区分；`preserveIds` 导入保持 id。

---

## 附录 C：设计决策记录

| # | 决策 | 备选方案 | 理由 |
|---|---|---|---|
| D-1 | 保留磁性时间轴：`organizeVideoAudioTracks` 对所有未锁定 video / audio 轨（含图片轨）贴紧；以 S8「写入即稳定」约束外部写入者 | 让图片轨或所有轨道自由定位 | 贴紧是第 1 轮已确认的既有规则，改变它影响全部手动编辑路径；本轮目标是消除「下一次编辑改写布局」的不稳定，而不是改变产品模型（N-03） |
| D-2 | Agent reconcile 保持整轨自 0 贴紧，只增加「被操作片段同起点优先」与实际位置回报 | 只推开重叠片段的 ripple 规则 | 与 UI 贴紧规则一致；ripple 留下的空隙会在下一次手动编辑时被贴紧改写，违反 D-1 / S8 |
| D-3 | AI 方案的图片道同样贴紧，不修改第 1 轮 AM-06 的图片改道规则 | 把图片留在视频道作为补位 | 改道规则已有测试与评审结论；图片道贴紧与手动编辑一致，偏移以 `partialWarning` 告知 |
| D-4 | 未选中片段仍可直接拖边缘裁剪，补齐悬停光标与手柄，短片段保证 12 px 移动区 | 只允许选中片段裁剪 | 与主流 NLE 惯例一致；缺陷在于热区不可见与短片段无移动区 |
| D-5 | `remove_material` 不提供 `force` 参数，有引用即拒绝 | `force: true` 同时删除片段 | 行为确定；模型用 `delete_clip` 逐步删除，每步有补丁可撤销 |
| D-6 | 画布合成以「连续片段段」为单位 concat 后叠加；仅「单轨、无空隙、无透明 / 转场、终点吻合」走 concat 快速路径 | 每个片段单独叠加 | 滤镜数量与现状同阶；磁性主轨通常是一个连续段 |
| D-7 | 叠加 / 字幕 / 单条音频失败保持「非致命、任务完成」但必须以 `degradations` 上报；画面合成阶段失败为致命错误、不回退 | 任何失败都让整单失败 | 用户仍能得到可用的成片并知道缺了什么；画面合成失败没有正确的回退结果 |
| D-8 | 滤镜图超过 8000 字符才写脚本文件 | 一律写脚本文件 | 限制对现有断言命令参数的测试的冲击；长图路径有专门用例 |
| D-9 | 字幕识别按裁剪窗口映射结果，不在识别前裁剪音频 | 先用 ffmpeg 截取窗口再识别 | 纯函数、可测试、无新的 ffmpeg 依赖；预裁剪作为性能优化另议 |
| D-10 | 删除在用素材：确认后同一步移除片段、导出前置检查缺失素材 | 软删除 / 回收站 | 与现有删除模型一致、改动面小；缺失标记列入 N-01 |
| D-11 | 本轮范围 66 / 93 项 | 全部 93 项 | 见附录 A 延后准则；保证每组可在本轮独立验证 |
| D-12 | 〔RV-04〕删除「视频轨长度 ≥ 音频轨长度」导出硬拦截，改为不阻断的黑尾提示 | 保留拦截并修改走查；或弹确认框 | 画布合成后短画面只产生黑尾，与预览完全一致；硬拦截违背「预览 = 导出」；提示足以告知且不打断，确认框会给常见的「片尾音乐」场景增加一次无谓点击 |
| D-13 | 〔RV-01〕水合失败时把原始时间轴备份到项目数据顶层，而不是阻止自动保存 | 该项目禁用自动保存直至用户处理 | 禁用保存会让用户之后的所有编辑都有丢失风险；备份一次即可保证原始数据不丢，恢复入口列入 N-07 |
| D-14 | 〔RV-07〕以配音文本哈希识别过期配音，而不是改变段落 id 生成规则 | 段落 id 带版本号 / 内容哈希 | 改 id 会让已有项目的全部配音与视频失联；哈希只加在新配音上，旧数据自动兼容 |

---

## 评审结论

**有条件通过。**

v1 的问题定位扎实（93 项缺陷均带行号与复现），S5～S10 六个共享机制方向正确；其中风险最大的 S6 画布合成已由本评审用真实 ffmpeg 按规定图形状实测 7 例全部通过。
评审共提出 19 项问题（P0×1 / P1×5 / P2×13）：唯一的 P0（RV-01，水合失败后自动保存永久抹掉时间轴）与全部 P1（RV-02 关闭守卫僵死、RV-03 编辑锁绕过、RV-04 导出拦截与所见即所得矛盾、
RV-05 `finishing` 永久锁、RV-07 过期配音未排除）均已在正文修复；P2 中除 RV-17 记录进附录 A N-06 外均已修复。**本文档不存在未解决的 P0 / P1。**

实现与提交节点须满足以下条件：

| # | 条件 | 验证方式 |
|---|---|---|
| C-1 | G1 必须包含 RV-01 的全部三部分（`repairTimelineData` 修复重试、`timelineRecoveryBackup` 备份、外部写入被拒后回写所有者），不得只落地 AG2-08 的「防新增」部分 | T62、T63、T44；走查第 21 条 |
| C-2 | S6 探针用例（T3）在实现机器上实际运行且未被 skip；A5 在可导入 `cv2` 的环境运行（R14） | A5 输出记录中 T3 用例为 passed |
| C-3 | S9 锁的完整性以 A17 允许名单与 T32 表驱动用例双重钉住；新增直接调用 slice 变更方法的代码必须先加锁检查 | A17、T32 |
| C-4 | `finishing` 看门狗、停止按钮置灰与 S9 store 层锁同组（G2）落地（沿用 I-4） | G2 提交内容 |
| C-5 | 删除导出长度硬拦截时同步删除无引用的文案与计算函数，并以 T17 钉住黑尾提示 | A18、T17 |
| C-6 | `segmentTextHash` 的拼接方式以 `ScriptPanel` 实际 TTS 文本为准，在实施记录中写明所用字段 | T64、走查第 23 条 |
| C-7 | 走查 1～23 条在桌面端（`cd desktop && npm run dev`）逐条执行并记录结果；A1～A18 全部实际运行并记录输出 | 实施记录 |

---

## 实施过程发现的方案缺陷

> 由「代码开发」节点在实施 v2 时记录。每条给出问题、证据与实际采用的做法；编号 `IM2-xx`，与第 1 轮 `IM-xx` 独立。
> 实施方式：主线程先落地多组共用的底座（i18n 全部新增 key、`editLock.ts`、`renderableTimeline.ts`、`materialUsage.ts`、
> `materialDragTypes.ts`、`src/test/organizeFixedPoint.ts`、`VideoEditingTaskContent.timelineRecoveryBackup`），再按文件归属把 §4 拆成 8 个互不重叠的实施切片并行推进，最后由主线程统一集成与跑门禁。

| # | 章节 | 问题 | 证据 | 实际做法 |
|---|---|---|---|---|
| IM2-01 | §6.4 / A10 | §6.4 为字幕编辑弹窗列出的 key 不足以让 A10「非注释行 0 个中文」成立：弹窗另有「预设样式 / 字体类型 / 字体大小: Npx / 字体颜色 / 背景颜色 / 启用背景 / 字幕位置 / 样式预览 / 这是字幕预览文字 / 示例文字 / 字幕内容编辑 / 点击字幕片段进行编辑 / 共 N 个字幕片段 / 字幕预览 / 请先在时间轴上添加字幕后再进行编辑」等可见文案，以及中文 logger 字符串 | `SubtitleEditModal.tsx:363,386-387,395-397,405,423,432,449,467,487,495,518,534,546,558,566-567,599,605,615,620,640,660` | 在 `timeline.subtitleEditModal` 下额外新增 15 个 key（`noSubtitlesHint / presetsHeading / presetSample / fontFamily / fontSize / fontColor / backgroundColor / enableBackground / position / stylePreview / stylePreviewSample / contentHeading / contentHint / itemPreviewFallback / countSummary`），接口类型 / en / zh-CN 三处同步，zh-CN 值逐字沿用现有中文；条目名复用既有 `timeline.messages.subtitlePrefix`；logger 文案改为英文 |
| IM2-02 | §3.2 S5 | `collectRenderSpans(tracks: readonly Track[])` 只接受 UI `Track`，而字幕识别条目收集与导出 / 预览分别持有 UI `Track` 与领域 `TrackData`（`type: TrackType`），二者不可直接互换；各调用方还要各自构建 `materialsById` | `domain/types.ts:115-129`；`types/index.ts:776-787` | 参数改为结构类型 `RenderableTrack = Pick<Track,'id'|'type'|'isVisible'|'isMuted'> & { items: readonly Pick<TimelineItem, 'id'|'startTime'|'duration'|'materialId'|'text'|'originalMaterialType'>[] }`，两种形状都可传入；新增导出 `indexMaterialsById(materials)`；另把「起点为负 / 非有限、时长 ≤ 0」的条目排除写成独立用例 |
| IM2-03 | §3.3 ME-02 / §3.7 AG2-16 | `findTimelineUsages(tracks: readonly TrackData[], …)` 与 Agent `TimelineState.tracks` 字段不同，按 v2 写法 AG2-16 需要再写一份同语义实现 | `lib/video-editing-agent` 自有轨道类型 | 参数改为结构类型 `UsageTrack = Pick<TrackData,'isLocked'> & { items: readonly Pick<TimelineItemData,'id'|'materialId'>[] }`，素材删除与 `remove_material` 共用同一实现；返回顺序按传入 `materialIds`、去重 |
| IM2-04 | §3.6 TL2-17 | v2 要求 TimelinePanel 新增 `dragStartYRef` 并在事件中传 `deltaY`；而 `POINTER_MOVE` 事件现已携带 `clientY`（`TimelinePanel.tsx:408-414`），状态机上下文也有 `pointerDownPosition` | `TimelinePanel.tsx:393,408-414` | `PointerMoveEvent` 增加可选 `deltaY?: number`；状态机在缺省时以 `clientY − pointerDownPosition.y` 回退，TimelinePanel 照常传入 `deltaY`——两侧任一先落地都不破坏行为 |
| IM2-05 | §4.5 / R14 | 本机 anaconda Python 的用户 site-packages 同时装有 `opencv-python` 与 `opencv-python-headless`（均 4.11.0.86），`import cv2` 报「recursion is detected during loading of cv2 binary extensions」，`VideoCompositionService` 无法导入；仓库无 venv | `python -m pip list`；`python -s -c "import cv2"` → `No module named 'cv2'` | 不修改全局环境；A5 以隔离目录安装 `opencv-python-headless` 并经 `PYTHONPATH` 优先加载运行（结果见本节后续条目与实施记录） |
| IM2-06 | §3.8 AM2-01 | `_pack_lanes` 的警告文案只给了「moved from X to Y to close a gap」；打包同样会把重叠段**后移**，此时写「close a gap」与事实相反 | `timeline_parser_service.py` `_pack_lanes` | 前移写 `to close a gap`、后移写 `to clear an overlap`；每条警告与既有警告一致带素材 id |
| IM2-07 | §3.8 AM2-06 | 自洽示例要求 BGM `0–61`，而提示词自身规则是「视频轨应略长于音频轨」，61 s 的 BGM 与 61 s 视频道等长，示例仍与规则冲突 | `ai_mixed_editing_service.py` 提示词要求段 | BGM 改为 `0–60`；新增 `test_sanitizing_the_prompt_example_changes_nothing`（示例经 sanitize 不产生任何警告） |
| IM2-08 | §3.8 AM2-03 | v2 只改上传校验 400；`/import` 的 400 与三处 500 同样以 `HTTPException(detail=dict)` 返回 Python dict，中文界面仍会显示原文；500 的 `detail` 还拼接了异常文本（可能含本地路径） | `timeline_import_router.py` 各 `except` 分支 | 全部失败路径统一经 `_error_response` 返回 `ErrorResponse`：校验失败 `TIMELINE_IMPORT_INVALID`（存在时附服务 `details`），内部错误 `TIMELINE_IMPORT_INTERNAL`、`error_details={error_type}`，异常原文只进日志 |
| IM2-09 | §3.8 AM2-02 | 规整规则未覆盖：编号 > 4（如 `audio-track-7`）、自由标签与显式编号混用、布尔值 | `_canonicalise_audio_tracks` | 编号 > 4 并入 `audio-track-4`；自由标签取「未被显式编号占用」的下一条道（仅有 `"bgm"` 时为 `audio-track-1`）；布尔值按标签处理；每次改写记录 `track <value> mapped to audio-track-n` |
| IM2-10 | §3.8 AM2-01 / T13 | 第 1 轮用例 `test_sanitize_shifts_same_lane_overlap_and_keeps_other_lanes` 在打包语义下第 2 道片段移到 0 s，用例名失真 | `tests/test_ai_mixed_editing_hardening.py` | 更名为 `test_sanitize_packs_every_lane_independently` 并按打包断言；另增「跨裁剪窗口边界的字幕被截断、短于 100 ms 丢弃」「超过 4 条音频道合并」「已规范的 `audio-track-2` 不产生警告」「500 返回 ErrorResponse」用例 |
| IM2-11 | §3.6 ME-04 | 放弃修改确认框 `ConfirmationDialog` 为 `z-[200]`，字幕弹窗根为 `z-modal`（1000）；作为兄弟节点渲染会被弹窗遮住 | `ConfirmationDialog.tsx`；`SubtitleEditModal.tsx` | 确认框嵌套在弹窗遮罩内部渲染；确认框打开期间弹窗自身的键盘与鼠标处理不响应 |
| IM2-12 | §3.6 ME-09 | 「剪切工具点击、切分快捷键在 `'too-close'` 时提示」——实际 `splitAction` 只在 `TimelineItem.tsx` 调用，TimelinePanel 无切分快捷键 | `grep -rn "splitAction(" src` | 提示放在 `TimelineItem.tsx` 的调用点（由时间轴 store 切片实现） |
| IM2-13 | §3.2 S9 / TL2-19 | `CameraMotionModal.test.ts` 逐字断言 `handleApply` 函数体，无法在其首行加锁检查 | `CameraMotionModal.test.ts` | 锁定时「应用」按钮置灰并显示 `editLockedByAgent`，最终拒绝由 store 层 `setCameraMotionAction` 负责；新增 `isEditLocked` prop |
| IM2-14 | §3.6 ME-04 | 旧弹窗在渲染期间对 `editedSubtitles` 原地 `sort`（改写 state） | `SubtitleEditModal.tsx:572-573` | 改为 `useMemo` 排序副本 |
| IM2-15 | §3.6 ME-04 | v2 只让 Esc 询问放弃；× 与「取消」按钮同样会直接丢弃修改；保存被 `getSubtitleCommitBlocker` 阻止时弹窗需要知道「未保存」 | `SubtitleEditModal.tsx:365-368,664-669` | ×、取消、Esc、遮罩统一走 `requestClose`；`onSave` 返回 `boolean \| void`，返回 `false` 时弹窗保持打开；锁定期间保存按钮置灰并显示状态行 |
| IM2-16 | §3.6 ME-03 | 旧实现 `clip_end` 以 `originalDuration \|\| duration` 兜底，与 v2「`clipStart + duration`」不同；对裁剪过的片段会转写到源文件末尾 | `TimelinePanel.tsx:987`（基线） | 按 v2 `clipEnd ?? (clipStart + duration)`；转写条目在替换确认之后重新收集（确认期间时间轴可能变化） |
| IM2-17 | §3.6 ME-10 | `dragSlice.dropMaterial` 在 Track.tsx 改走 `onMaterialDrop` 后已无生产调用方，仅 `__tests__/autoOrganize.integration.test.ts` 两个用例使用 | `grep -rn "dropMaterial" src` | 集成阶段已删除 `DragSlice.dropMaterial`（接口 + 实现 + 随之无用的 `addItemAction` / `MaterialData` 导入）；`autoOrganize.integration.test.ts` 的两个 `dropMaterial` 用例合并为「`addItemAction` 写入撤销栈（轨道拖放经它落地）」 |
| IM2-18 | §3.4 EXO-06 / §3.3 ME-02 | v2 先判「无画面」再查缺失素材：被删素材恰是唯一画面时提示「没有可导出的画面」而不点名片段，与走查第 2 条矛盾 | `useVideoExport.validateVideoExport` 旧顺序 | 新纯函数 `planVideoExport`（`videoExportItems.ts`）先查缺失素材、再查无画面、最后算黑尾；`useVideoExport.ts` 由 850 行降到 285 行 |
| IM2-19 | §3.6 ME-05 / A17 | 「首次加载自动适配尺寸改为调用 store `updateItemImagePosition`」——从面板直接 `getState().updateItemImagePosition(...)` 会命中 A17 允许名单之外的直接 slice 调用 | A17 grep 规则 | 在 `updateItemFields.ts` 新增 `fitImagePositionAction(get, itemId, position)`：不写历史、锁定 / 锁定轨 / 位置未变时拒绝；VideoPlayerPanel 经该 action 写入 |
| IM2-20 | §3.5 EXO-17 / EXO-02 | 三个既有用例钉住旧行为但不在 §4.7 清单：`compositorLayerBoundaries.test.ts`（字幕闭区间）、`ImageOverlayLayer.test.ts`（无 zIndex 时按输入顺序）、`ImageOverlay.interaction.test.tsx`（鼠标事件与按钮名） | 对应测试文件 | 按新语义更新：字幕半开区间；缺省 zIndex 为 10（与后端一致）；Pointer Events 与「完成 / 还原位置」 |
| IM2-21 | §3.4 EXO-06 | 旧「音频条目数量不符」硬失败在缺失素材前置检查之后已不可触发，且含硬编码中文 | `useVideoExport.ts`（基线 `:506-526`） | 删除 |
| IM2-22 | §3.2 S7 | `formatDegradationMessage(list, t)` 签名无法得知语言，无法按 zh-CN 选择「、」分隔符 | §3.2 S7 前端签名 | 增加可选 `locale` 参数（`formatNameList` 同）；VEI 无需改动 |
| IM2-23 | §3.6 ME-05 | 手势进行中组件卸载时 v2 未定义行为 | `ImageOverlay.tsx` | 卸载时提交进行中的手势（与松手一致）；`pointercancel` / Esc 回退；锁定时不渲染手柄；VideoPlayerPanel 两处重复的叠加渲染块合并为 `renderImageOverlayHandles` |
| IM2-24 | §7.2 A18 | — | `grep -rn "videoTrackTooShort" src` → 0 | 四个长度拦截文案 key（`videoTrackTooShort / videoTrackDuration / audioTrackDuration / needToAdd`）已在接口类型、en、zh-CN 删除（共 12 行），`calculateVideoTrackDuration / calculateAudioTrackDuration` 已删除 |
| IM2-25 | §3.3 ME-01 / RV-11 | `repairDerivedMaterialIdentity` 判据「本地引用 ≠ `url`」漏掉一类存量错误：VEI 切段素材 `url / cacheUrl / localResolvedUrl` 已是切段文件，但展开原 `metadata` 继承了原片的 `metadata.storageKey`——删除切段素材仍会删到原文件 | `VideoEditingInterface.tsx:1350-1351,1411-1428`（基线） | 修复判据追加「派生素材的存储键与其自身 `url` 推导出的键不一致」；`cached_materials/` 键仍不修复（RV-11） |
| IM2-26 | §3.2 S10 | `cascadeDeleteMaterial` 传入完整 `materialsSnapshotRef.current` 作为 siblings：两个共享同一文件的素材被**一起**删除时，彼此都视对方为「仍在使用」，文件永远不删 | `materialDeleteHelpers.sourcePathForDelete` | `executeDelete` 只传「删除后仍留在素材库中的素材」作为 siblings |
| IM2-27 | §3.3 RV-12 | `executeDelete` 本地移除后以 fire-and-forget 清理后端，几乎不会同步抛错；`deleteFailedClipsRemoved` 只覆盖同步抛错，后端清理失败仍只记日志 | `useMaterialManagement.executeDelete` | 按 v2 实现同步失败提示；后端异步清理失败保持记录日志（行为与基线一致），列入附录 A N-08 |
| IM2-28 | §3.3 RV-01 | `HydrationResult` 未定义「无时间轴内容」的情况 | `hydrateTimeline.ts` | 仅当存在非空时间轴内容且修复后仍无法读取时返回 `failed`；新项目 / `null` 时间轴返回 `loaded`（没有可备份的原始数据） |
| IM2-29 | §7.3 走查第 21 条 | 「把条目 `duration` 改为字符串 `"abc"`」不会触发 `failed`：`repairTimelineData` 会删除该条目并以 `repaired` 打开 | `repairTimelineData.ts` | 走查第 21 条改为「把某轨道的 `items` 改为字符串 `"broken"`」使整体无法读取（本节同步修订 §7.3） |
| IM2-30 | §6.4 ME-02 | 删除确认按钮文案 `deleteConfirmAction` 需要写入 `ConfirmationDialogState`，其类型定义在 `types/videoEditingTypes.ts`，渲染处与「清空全部」对话框共用 | `MaterialsPanel.tsx` 确认框渲染处 | 在 MaterialsPanel 渲染确认框处设置确认 / 取消文案（`deleteConfirmAction` / `common.cancel`）；「清空全部」对话框按钮随之显示「删除」 |
| IM2-31 | §3.3 ME-01 | 去水印以同 id 替换素材，但时间轴上已有片段仍快照原 `url / cacheUrl`；只有预览 / 导出先按 `materialId` 解析素材时才会使用新文件 | `MaterialsPanel.tsx` 去水印；片段快照字段 | 超出本轮切片范围，列入附录 A N-09（片段播放地址在素材替换后刷新） |
| IM2-32 | §7.2 A10 | 既有日志字符串 `'用户确认删除素材'` 命中 A10 的中文检查 | `useMaterialManagement.ts` | 改为英文日志 |
| IM2-33 | §3.8 AS2-02 / RV-07 / C-6 | `segmentTextHash` 规定「`narrationText.trim()` 非空时用它，否则拼接 sentences」；实际 TTS 请求构造（`src/lib/api/tts.ts:201` `convertScriptSegmentToSentenceRequest`）只要有非空旁白就发送其**切分并逐句 trim 后**的句子，与整段 `trim()` 不同——按 v2 口径新生成的配音会被误判过期（R23） | `src/lib/api/tts.ts:201` | 哈希输入取 `convertScriptSegmentToSentenceRequest(segment).sentences[].text` 以 `\n` 连接后做 FNV-1a 32 位；ScriptPanel 在 `segment_assigned_at` 旁写入 `metadata.segment_text_hash`；T64 钉住（C-6：所用字段即 TTS 请求的 `sentences[].text`） |
| IM2-34 | §3.8 AS2-01 | 「`segment.videos` 的 id 映射到 `metadata.segment_id` 匹配的素材」：匹配按 id 替换素材库副本，同一视频被重新匹配到后一段时 `segment_id` 被覆盖，前一段仍列出它却会丢失该视频 | `ScriptPanel.tsx` 视频匹配写回 | 列出的视频只按 id 查找（仍要求 `isPlayable`） |
| IM2-35 | §3.8 AS2-02 / 走查第 23 条 | 过期配音被排除后该段若无其他配音，规划器会退回「纯视频模式」并报告 `placed`，与走查第 23 条「报告缺少配音」矛盾 | `planScriptAutoMix.ts` 模式判定 | 只要存在被判过期的配音即按配音模式规划，该段报告 `skipped-no-audio`；纯视频模式下无视频的脚本段同样报告 `skipped-no-audio`（原先全部报告 `placed`） |
| IM2-36 | §3.8 AS2-03 | 素材库完全没有视频时，按 v2 `coverWithVideos` 每个有配音的段都报告 `video-short` | `planScriptAutoMix.ts` | 保持 v2 语义，用户看到 `videoShort` 提示；T56 钉住 |
| IM2-37 | §3.8 AM2-03 | 导入接口返回 `success:false`（HTTP 200）时 v2 未归类，原先显示「方案数据不完整」 | `useAIMixedEditing.importPlan` | 同样抛 `AiMixImportError` → `errorImportFailed`；`TIMELINE_IMPORT_INVALID` 一并映射 |
| IM2-38 | §3.2 S8 / T57 | store `autoOrganize` 以浮点累加起点（9.95 + 0.1 = 10.049999…），已贴紧的布局也会被改写约 1e-15 | `TimelineAggregate.organizeVideoAudioTracks` | 无害；T57 以四舍五入后的值比较（`findOrganizeDrift` 容差 1e-6 不受影响） |
| IM2-39 | §3.8 AS2-04 | 确认框打开期间替换数量降为 0 时 v2 未定义 | `useScriptAutoMix.confirmAutoMix` | 直接应用而不再重开确认框；hook 另加 `taskId` 选项仅用于日志 |
| IM2-40 | §3.3 ME-02 / VEI 切段 | 切段失败的清理路径调用 `handleMaterialDelete` 删除临时占位素材——新删除流程会弹出危险确认框，而用户并未发起删除 | `VideoEditingInterface.tsx`（切段失败两处） | `useMaterialManagement` 新增 `discardPendingMaterials(ids)`（直接 `executeDelete`，无确认、无时间轴计划，占位素材从未上轨），接口类型 `videoEditingTypes.ts` 同步；VEI 两处改用它 |
| IM2-41 | §3.6 TL2-02 | 运镜窗口按「实际 `clipStart` 变化量」平移只对视频成立：静态图片 `clipStart` 恒为 0，左边缘裁剪时运镜窗口永远不动 | `resizeItem.ts`；`SplitService` 对图片按起点重定基 | 视频按 `clipStart` 变化量平移；静态图片按 `startTime` 变化量平移（与切分时的重定基一致） |
| IM2-42 | §3.6 ME-09 | 「≥ `MIN_CLIP_DURATION_SECONDS`」直接比较受浮点误差影响：起点 0.2 的片段在 0.3 处切分（恰好 0.1 s）会被拒绝 | `SplitService.ts` | 比较加 1e-9 容差 |
| IM2-43 | §3.6 TL2-20 | v2 只在 `recalculateTotalDuration` 钳制播放头；创建 / 导入时间轴时已保存的播放头同样可能超出内容终点 | `TimelineAggregate.ts` | 钳制同样作用于创建 / 导入：保存的播放头超出内容时打开在内容终点（无现有用例依赖旧行为） |
| IM2-44 | §3.6 TL2-06 | `edgeHandleWidthPx` 与热区判定在 v2 中是状态机私有；`TimelineItem.tsx` 的悬停光标与手柄宽度需要同一函数 | `dragMachine.ts` | 导出热区判定函数，TimelineItem 与状态机共用（`domain/index.ts`、`domain/machines/index.ts` 同步导出） |
| IM2-45 | §3.2 S9 | 轨道 action 的拒绝值 v2 写「沿用未执行返回」，但 `addTrackAction` 原返回 `{ trackId }`、`removeTrackAction` 返回结果枚举 | `trackActions.ts` | `addTrackAction` 锁定时返回 `{ trackId: null }`（TimelinePanel `setPendingScrollTrackId` 已接受 null）；`removeTrackAction` 新增结果 `EDIT_LOCKED`；拖拽进行中获得锁时回滚预览 |
| IM2-46 | §3.7 AG2-01 / S8 | reconcile 仅在「有重叠」时贴紧：把片段添加 / 移动到空隙中时结果不是 `organizeVideoAudioTracks` 的不动点，T48「agent add and move results are organize fixed points」无法成立 | `reconcile.ts` `reconcileOverlapsAfterAgentOp` | `add_clip / move_clip` 一律贴紧其涉及的轨道（锚点片段同起点优先）；`delete_clip / trim_clip / resize_clip` 仍只在重叠时贴紧——对删除贴紧会打破既有单步撤销用例，并移动删除结果未回报的片段。这三类操作的 S8 缺口列入附录 A N-10 |
| IM2-47 | §3.7 AG2-02 | `validateOperationTargets` 要求 `add_clip` 目标轨存在；服务端工具会自动建轨，客户端只能经该 `add_clip` 得知新轨 | `tools/addToTrack.ts` 自动建轨；`OperationApplier.addClipToState` | `add_clip` 只校验时间有效，不要求目标轨已存在（客户端按既有逻辑建轨）；其余操作按 v2 校验 |
| IM2-48 | §3.7 AG2-09 | `packOverlappingTracks` 只返回状态与 `fixedTrackIds`，客户端需逐条重放的操作无从得知 | `tools/autoFixOverlaps.ts`、`OperationApplier` | 额外返回 `operations`（客户端以批量方式重放，新增 `OperationApplier.applyBatch`），并接受可选 `trackIds` 过滤；工具结果保留旧字段 `noop / changedTrackIds`，新增 `fixedTrackIds / shiftedClips` |
| IM2-49 | §3.7 AG2-12 / RV-16 | 实测没有任何工具卡片从工具结果渲染 `<img>`，占位符分支无处可加 | `VideoChatWindow/timeline/ToolStep.tsx` 及子组件 | 不新增图标分支，以源码断言钉住「工具卡片只以文本渲染结果、不把结果喂给 `<img>`」（`compactToolResult.test.ts`） |
| IM2-50 | §3.7 AG2-07 | v2 要求「写入须按对话 id 合并」——VEI `updateConversationMessages` 已经经 `contentRef` 按对话 id 合并；另外 `finishing` 中的轮次若在卸载 / 切换对话时封口，会把已完成的工具调用标记为已取消 | `VideoEditingInterface.tsx` `updateConversationMessages`；`useAgentExecution.ts` 卸载清理 | VEI 无需改动；仅在流仍在进行时卸载 / 切换对话才封口，`finishing` 轮次自行排空；`cancelByUser / cancelByNavigation` 先封口再取消，`finishing` 等待封口写入 |
| IM2-51 | §3.7 AG2-15 | 「图片不写 `originalDuration`」与 Agent `TimelineOperation` 类型中 `originalDuration: number` 必填冲突 | `src/types/index.ts` `AgentClipData` | 图片下发 `originalDuration: 0`，客户端与服务端两个应用方都丢弃 ≤ 0 的值（条目上不出现该字段） |
| IM2-52 | §3.7 AG2-01 / AG2-14 | 贴紧后分镜转场留下的空隙被消除，`compose_storyboard` 结果中的 `total_duration` 仍按请求累加 | `tools/composeStoryboard.ts` | `total_duration` 取贴紧后轨道的实际终点；`remove_material` 素材不存在时结果字段由 `message` 统一为 `error` |
| IM2-53 | §3.7 AG2-06 / AG2-10 | VEI 的 `useAgentExecution({ onNotification })` 把非 `error` 一律显示为成功提示：新增的「Agent 正在执行，完成后才能撤销」「部分修改应用超时」会以绿色成功提示出现 | `VideoEditingInterface.tsx` `onNotification` | 集成阶段增加 `type === 'warning'` → `showWarning` 分支 |
| IM2-54 | §3.7 R9 | — | `grep "status === '"` | `finishing` 的消费方已核对：`TimelineChatPanel.tsx`（原 95/180/194 行）按执行中处理；`AgentBusyBar`、VEI 编辑锁、`useAIMixedEditing` 读取 `agentIsExecuting`（已含 `finishing`）；无其他直接比较状态值的消费方 |
| IM2-55 | §3.2 S6 / EXV-10 | `NORMALIZE_FPS` 定为模块常量 30 与现状不符：`_normalize_video` 按 `request.output_fps`（15–60）归一化 | `video_composition_service.py` `_normalize_video` | `-frames:v` 与 builder 的 `fps` 均取 `request.output_fps`；帧数计算放入新模块 `composition/composition_outcome.py` 的 `frame_count_for` |
| IM2-56 | §3.2 S6 | 「`can_use_concat` → 返回 False、调用方串接」时调用方串接的是**全部**归一化片段；不透明度为 0 的片段（builder 已排除出输入）或其他轨道片段会被一并串接 | `_compose_video_sync` 快速路径 | `_compose_videos_filtergraph` 在快速路径内只串接 plan 的 `video_inputs`，完成后返回 False；新增 `temp_dir` 参数供长滤镜图脚本文件使用 |
| IM2-57 | §3.5 EXO-01 / CLAUDE.md 规模限制 | v2 的 `_drawtext_filters_for_entry` 有 9 个参数，违反「参数 ≤ 5」 | §3.5 EXO-01 签名 | 改为 `(cue, style, canvas)` 三个 dataclass；`SubtitleDrawStyle` 增加描边、边距与 `max_line_width` 字段 |
| IM2-58 | §3.5 EXO-03 | `_process_overlays_sequential` 返回 `(images_ok, subtitles_ok)` 会打破运镜契约用例（钉住其返回 `List[str]`） | `test_camera_motion_stills.py` 契约用例 | 保持返回 `List[str]`；以关键字参数 `composition_id` 自行记录降级（`_process_image_overlays` 与合并叠加路径同样接收） |
| IM2-59 | §3.5 EXO-13 | 字幕 / 叠加输出写入 `temp_dir` 后 `os.replace` 到输出目录：系统临时目录在 C:、输出在 M:，跨盘替换失败 | Windows 本机 | 中间产物写在输出文件同目录；所有中间文件名预先确定，`finally` 统一删除（含顺序回退路径产生的文件） |
| IM2-60 | §3.5 EXO-01 / EXO-18 / B8 | `build_drawtext_filters(request, …)`、服务内 `_download_image` 与 `composition/subtitle_prep.py` 改动后无调用方 | `grep` 调用方 | 删除；独立 `/add-subtitles` 路由改用新的逐条构造器，同样获得半开区间与脚本文件参数；`composition/__init__.py` 模块说明同步更新（集成阶段） |
| IM2-61 | §3.5 | 合并叠加路径在「无图片、无字幕可渲染」时 v2 未定义 | `_process_overlays_and_subtitles_combined` | 返回 `(True, warnings)` 且不写文件 |
| IM2-62 | §3.5 EXO-02 / RV-10 | `z_index: int = Field(10, …)` 在旧数据传 `null` 时触发 422 | `video_models.py` `ImagePosition` | 保持 `Optional[int]`，排序时 `None` 视为 10 并钳制到 [0, 999] |
| IM2-63 | §7.1 T8 / T4 | EXO-04 用例以 `STORAGE_ROOT` URL 构造在本机受 URL 安全检查影响；`test_video_composition_timeline.py` 旧用例调用已不存在的 API；`test_subtitle_font_size_fix.py` 钉住已删除的 SRT 路径 | 对应测试 | EXO-04 用临时目录绝对路径经真实 `_convert_url_to_local_path`；两个旧测试文件按新 API 重写；`test_audio_volume_consistency.py`、`test_video_composition_enhanced.py` 按 `AudioMixResult` 返回类型与新增时长参数更新；共享假对象放在 `tests/composition_harness.py` |
| IM2-64 | CLAUDE.md 规模限制 | `_compose_video_sync` 仍超过 60 行 | `video_composition_service.py` | 附一行原因注释（阶段编排被契约用例钉住）；`_process_audio_tracks` 拆为 4 个辅助函数；服务文件 2917 → 2876 行 |

### 实施记录 · 验收门禁（代码开发节点实测）

| # | 结果 | 记录 |
|---|---|---|
| A1 | ✅ 通过 | `npx tsc --noEmit` exit 0，0 error |
| A2 | ✅ 通过 | `npm run lint` 6 个 error，全部位于本轮未触及文件（`AudioSearchModal` / `ImageSearchModal` / `VideoSearchModal` 各 1、`ImageUploadInput` 1、`WatermarkRemovalModal` 2；`git status --porcelain` 对这 5 个文件为空）。基线 8 个中 `MaterialsPanel.tsx:2777` 的 2 个 `react/no-unescaped-entities` 因该文件本轮被修改而一并修复（`&quot;`，显示不变） |
| A3 / A4 | ✅ 通过 | `npx vitest run` 全量 **275 个文件 / 2294 个用例 / 0 失败**（基线 231 / 2003） |
| A8 | ✅ 通过 | 0 命中 |
| A9 | ✅ 通过 | 两条 grep 均 0 命中 |
| A10 | ✅ 通过 | `SubtitleEditModal.tsx` 非注释行中文 0 处（本机 grep 不支持 `-P` 的 UTF-8，改用等价 Python 扫描）；`useMaterialManagement.ts` 0 命中 |
| A11 | ✅ 通过 | 0 命中 |
| A12 | ✅ 通过 | 0 命中 |
| A13 | ✅ 通过 | 非测试文件只命中 `projects/hydrateTimeline.ts:68` 与 `store/actions/historyActions.ts:29`（允许名单内），无新增 |
| A14 | ✅ 通过 | `closeGuard tests passed`、`window-state tests passed` |
| A17 | ✅ 通过 | 仅命中 `TimelinePanel.tsx` 挂载 `initTimeline`、复制（`importFromData` + `autoOrganize`）与整理（`autoOrganize`）；复制与整理首行均为 `isEditLocked` 检查（`TimelinePanel.editLock.test.ts` 钉住） |
| A18 | ✅ 通过 | 0 命中 |
| A15 | ✅ 通过 | `npm run build`：`✓ Compiled successfully in 48s`，exit 0；构建后 `git status --porcelain` 无 `.next/`、`tsconfig.tsbuildinfo` 等产物 |
| A5 | ⚠️ 4 个既有失败（与基线一致） | 本机 anaconda Python 的 `cv2` 因用户 site-packages 同时装有 `opencv-python` 与 `-headless` 无法导入（IM2-05）；未改全局环境，以 `pip install --no-deps --target <scratchpad>/pydeps opencv-python-headless==4.11.0.86` 并经 `PYTHONPATH` 优先加载运行。§7.2 A5 全部 18 个文件：**222 passed / 4 failed / 0 skipped**（ffmpeg 探针用例 T3 7 例、160 条字幕烧录、图片不透明度像素用例均实际执行）。4 个失败为 `test_video_composition.py::TestVideoCompositionService::{test_download_video_success, test_compose_video_success, test_compose_video_download_failure}`（调用已不存在的 `compose_video`、对只读 `WindowsPath.stat` 打桩、`example.com` 在本机解析为 198.18.x 被 URL 守卫拒绝）与 `test_audio_transcription_service.py::test_aprocess_silent_audio_returns_success_with_empty_subtitles`（等待 ASR 最终帧超时）。**以 `git worktree` 检出基线 `a7f46c5` 在同一环境复跑，这 4 个用例同样失败（4 failed / 16 passed）**，与本轮改动无关，未修改；列入附录 A N-11 |
| A6 | ✅ 通过 | 0 命中 |
| A7 | ✅ 通过 | 0 命中 |
| A5 补充 | ✅ 无新增失败 | 本轮改写的三个既有后端测试文件（`test_audio_volume_consistency.py`、`test_video_composition_enhanced.py`、`test_subtitle_font_size_fix.py`）：当前 **17 passed / 5 failed**；基线 `a7f46c5`（`git worktree` 同环境复跑）**2 passed / 10 failed / 3 errors**。当前 5 个失败（`test_single_audio_track_volume_application`、`test_audio_clipping_with_volume`、`test_convert_url_to_local_path_server_url`、`test_convert_url_to_local_path_http_url`、`test_process_audio_tracks_server_url`）全部属于基线失败集合，无新增；另有 8 个基线失败 / 错误变为通过。临时 worktree 已删除（`git worktree list` 仅剩主工作区） |
| A16 | ✅ 通过 | `git status --porcelain`：133 个修改、73 个未跟踪条目、1 个删除（`composition/subtitle_prep.py`，B8 按需删除）；全部位于 `src/`、`backend-services/`、`desktop/`、`docs/`；无 `__pycache__`、`*.pyc`、`tsconfig.tsbuildinfo`、`.next/`、`.pytest_cache`、探针输出或临时脚本（隔离依赖目录与日志均在会话 scratchpad） |

**未执行项**：§7.3 桌面端走查 1～23 条需要人工在 `cd desktop && npm run dev` 中操作，本节点未执行，由后续评审 / 提交节点或人工走查补记（C-7）。本节点未提交代码（提交由下一节点负责）。

---

## 代码评审记录（提交节点）

> 评审节点：代码 Review、修复与提交。评审方式：以 v2 §2–§9 与「实施过程发现的方案缺陷」为准，按文件归属把工作区改动拆成 8 个互不重叠的评审切片——
> be-compose（S6 / S7 合成服务）、be-subtitle-router（字幕烧录、滤镜脚本参数、状态路由）、aimix（AI 混剪 / 自动混剪前后端 + VEI）、fe-export（导出 / 预览一致、图片叠加手势）、
> data-safety（派生素材、删除在用素材、水合修复、关窗刷写）、tl-store（编辑锁、拖拽状态机、历史与视图）、tl-ui（时间轴 UI、拖放、字幕识别与弹窗）、agent（剪辑 Agent）——
> 逐文件审阅 `git diff a7f46c5`，从 **覆盖度 / 回归风险 / 命名·风格·注释 / 测试质量** 四个维度核对；每条发现都回到当前代码核实（读码推演具体数值，或写临时复现 / ffmpeg 探针），
> **全部就地修复并补回归测试**；切片之间的缺口与 `i18n.ts`、spec 由主线程统一处理。覆盖度结论：66 项与 RV-01～RV-19 均已实现，与设计一致或已在 IM2 记录偏离，未发现未实现且未记录的条目。未发现 P0。
>
> 严重度沿用 §2 口径。

### RC2.1 发现与处理

| ID | 级别 | 切片 | 位置 | 问题 | 处理（回归测试） |
|---|---|---|---|---|---|
| RC2-01 | P1 | be-subtitle-router | `subtitle_service.py` `_drawtext_line_filter` | drawtext 默认 `expansion=normal`：文本含 `%`（如「50% off」）时 ffmpeg 报 `Stray %`，该行字幕每帧都不绘制但 rc=0——导出静默缺字幕且不记降级；反斜杠同样被吞。基线既有，属于本轮「失败必可见」范围 | 追加 `:expansion=none` 并注释原因（`test_subtitle_text_is_drawn_literally_without_expansion`、`test_subtitle_text_with_percent_sign_is_burned_in` 真实 ffmpeg 像素检查；变异验证：去掉修复即失败） |
| RC2-02 | P1 | data-safety | `useProjectAutosave.ts` 卸载刷写 | 卸载刷写不在关窗刷写登记表中：卸载刷写正处于 5xx 重试的 3 s 退避或慢请求时，用户点「返回项目列表」后立即关窗 → `flushAllPending` 表为空立即放行 → 后端被停，最近一次保存丢失（ME-08 缺口） | 卸载刷写登记为 `project:<id>:unmount:<n>`、结束后自动注销，被关窗调用时先结束重试等待（`a close right after leaving the editor still waits for the unmount save`；撤掉修复实测保存序列 `['v1']`，期望 `['v1','v2']`） |
| RC2-03 | P2 | be-compose | `video_composition_service.py` `_concat_videos` | 快速路径已是唯一串接路径，失败时抛裸 `Exception`：状态 `composition_stage='finalization'`、`error_summary` 为含 ffmpeg 版本横幅的整段 stderr，与画布失败的 `compose` + 末行摘要不一致；`_ffmpeg_error_line` 与 `last_stderr_line` 是同一概念的两份实现 | 改抛 `CompositionStageError("compose", last_stderr_line(...))`；删除 `_ffmpeg_error_line`，4 处改用 `last_stderr_line`（`test_concat_fast_path_failure_reports_the_compose_stage_readably`） |
| RC2-04 | P2 | 主线程（be） | `composition_outcome.frame_count_for`、`_normalize_video` | EXV-10 只修了一半：`-frames:v = round(d × fps)` 在连续段内逐段累积取整误差——100 段 2.345 s @30 fps 共 7000 帧而非 7035（−1.17 s，音画渐进错位）；且片段终点（`start + duration`）与下一段起点分别计算，恰落半帧时浮点噪声会让两侧取整到不同帧 | 帧数改为取整后的时间轴边界之差 `round(end·fps) − round(start·fps)`（先 `round(x, 6)` 吸收浮点噪声），归一化任务携带 `timeline_start`；连续段总帧数恒为边界之差、误差 < 1 帧（`test_normalized_clip_counts_frames_between_rounded_timeline_boundaries`、`test_a_long_run_of_equal_clips_does_not_drift` 旧实现 7000≠7035、`test_a_clip_end_and_the_next_start_share_a_half_frame_boundary` 不吸收噪声时 85≠86） |
| RC2-05 | P2 | be-compose | `tests/test_audio_volume_consistency.py` | 改写后 5 处 `isinstance(result, AudioMixResult)` 恒真，丢失「混音成功」覆盖；实施记录列为基线失败的 2 例其实是过期断言（起点 > 0 时音量与剪辑参数在片段命令里）；`'-ss' in cmd` 为同义反复 | 用 `FakeFfmpeg` 写出输出文件并断言 `result.path is not None`；片段命令精确断言 `-ss 2.0` / `volume=1.5` / `-t 3.0`——这 2 个基线失败转为通过 |
| RC2-06 | P2 | be-compose | 合成测试 | 重写删掉了仍有效的「归一化任务携带剪辑窗口」覆盖；EXV-03 用例的 `total_duration` 等于条目终点，钉不住 `timeline_end_of` 一侧；降级缺「探针成功但无音轨不记降级」与 reason 截断 / 去查询串用例；`test_camera_motion_stills.py` 仍给已删除的 `_download_image` 打桩且不断言跳过上报；像素容差 ±10 / ±16 宽于 spec 的 ±3 / ±12；`test_video_composition_enhanced.py` 辅助函数夹在 import 之间且与 `FakeFfmpeg` 重复 | 补 `test_normalize_tasks_carry_each_clip_window`、`test_timeline_end_covers_items_past_a_shorter_total_duration`、`test_clip_without_an_audio_stream_is_silent_not_degraded`、`test_degradation_reason_is_one_short_line_without_url_query_strings`、`test_an_unresolvable_image_is_skipped_without_shifting_labels`；容差收紧到 spec 值；enhanced 用例改用 `FakeFfmpeg` 并清理未用 import |
| RC2-07 | P2 | 主线程（be） | `composition/media_download.py`、`video_models.ClipTransition`、`composition/__init__.py` | EXO-18 之后 `download_image` / `_image_extension_from_url` 已无调用方（死代码）；`ClipTransition` docstring 仍写导出用 `xfade`；合成包模块说明仍写叠加路径会下载图片 | 删除死代码并改写模块说明；docstring 按 S6「黑底画布 + alpha 渐变，dissolve = 前段淡出 + 后段淡入」改写 |
| RC2-08 | P2 | be-subtitle-router | 字幕 / 脚本参数 / 状态路由测试 | EXO-17 只有字符串断言、无渲染验证；脚本文件参数只做 mock；状态路由缺「已知状态不附加 error」「兜底分支返回 `failed` 而非 `error`」 | `test_adjacent_subtitles_never_share_the_boundary_frame_in_ffmpeg`（10 fps 读第 9 / 10 帧像素）、`test_script_file_args_chosen_by_probe_run_in_installed_ffmpeg`、`test_known_status_passes_through_without_an_invented_error`、`test_unreadable_status_info_reports_failed_not_error` |
| RC2-09 | P2 | aimix | `planScriptAutoMix.ts` | AI 匹配关联只改 `segment.videos`、不重写素材 `segment_id`：当前段仍在使用的视频因带着旧段标签被计入 ignored / orphaned，提示「已忽略 N 个素材」而该视频实际已上轨 *[复现：`orphaned=['shown-by-2']`、`ignored=['shown-by-3']`]* | 两个报告列表排除当前段实际选用的素材 id（`does not report a video a current segment still shows as ignored or orphaned`） |
| RC2-10 | P2 | aimix | 测试与注释 | IM2-39（确认时替换数降为 0 直接应用）无用例；IM2-08「所有失败路径返回 ErrorResponse」只测了 `/import/upload`；`parallelVideoAnalysis.ts` `REQUEST_TIMEOUT_MS` 注释仍写 batch | `applies without asking again when the clips to replace are gone at confirm time`、`test_json_import_validation_failure_returns_error_response`、`test_validation_crash_returns_error_response_without_exception_text`；注释更正 |
| RC2-11 | P2 | fe-export | `videoExportItems.buildExportCompositionItems` | 构建请求只看轨道可见性与 `item.type`，未按 S5 render spans：起点为负 / 时长为 0 的条目照发，后端 `ge=0 / gt=0` 校验失败使整单 422；视频轨上的音频素材（AG2-14 前的旧数据）预览跳过、导出却作为视频片段发送 | 按 `collectRenderSpans` 的 `kind` 分派，删除 `isStill`（`does not send items the preview does not render`） |
| RC2-12 | P2 | fe-export | `VideoPlayerPanel.handleImageAutoFit` | 本地状态无条件写入，而 `fitImagePositionAction` 在锁定轨拒绝：锁定轨图片的适配框只在 VEI 本地，导出用适配框、store 与自动保存仍是默认框，下一次同步被冲回（ME-05 症状） | 仅 action 返回 true 时写本地预览（`shows the auto-fit box only when the store accepted it`） |
| RC2-13 | P2 | 主线程（fe） | `useCompositionPlayback.buildImageOverlayInputs`、`VideoPlayerPanel/imageOverlays.selectActiveImageOverlays` | 预览只认 `originalMaterialType === 'image'`，S5 与导出同时认 `material.type === 'image'`：未打标签的图片片段（旧项目 / 手工导入数据）导出有画面而预览为空，违反 S5 不变量 | `renderableTimeline.ts` 新增 `isStillImageItem`，S5 `spanKindFor` 与两处预览选择共用（`shows an untagged clip backed by an image material, as export renders it`、`includes an untagged clip backed by an image material, as export renders it`；原「非图片条目」用例改用视频素材——原先把 video 标签配 image 素材，按 S5 口径本就是图片） |
| RC2-14 | P2 | fe-export | `useVideoExport.downloadComposedVideo`；两个测试 | 6 个参数超过 CLAUDE.md 上限；`imageOverlayGesture.test.ts` 锁定用例只检查标识符存在；`useVideoExport.trackFilters.test.ts` 注释说「不出现黑尾提示」却无断言 | 参数改为 `ExportReporter` 对象；用例改为断言 `isImageEditLocked ? null :` 分支与 store 选择器、断言 `showError / showWarning` 均未调用 |
| RC2-15 | P2 | data-safety | `VideoEditorContainer.tsx` 加载 effect | 注释写「不得因切换语言重新拉取」，但依赖数组含 `t.videoProjects.loadError`：切换语言 → 按服务端副本重新导入，撤销历史清空、防抖中的编辑丢失、修复 / 无法读取提示重复弹出 | 失败分支读 `translationsRef` 并移出依赖（`switching the language does not reload the open project`，旧依赖下实测失败） |
| RC2-16 | P2 | data-safety / 主线程 | `closeGuard.test.js`、`useDesktopCloseGuard` | R13「渲染进程崩溃直接关闭」与「仍然关闭」分支无用例；RV-19 慢 / 失败文案区分、卸载退订、浏览器调试路径无测试；新测试文件回调参数隐式 `any` 使 `tsc` 失败（主线程） | `testDeadRendererClosesWithoutWaiting`、`testCloseAnywayChoiceClosesTheWindow`；新增 `src/hooks/__tests__/useDesktopCloseGuard.test.ts` 5 例；回调参数补类型 |
| RC2-17 | P2 | tl-store | `TimelineAggregate.moveItem` | TL2-20 钳制也作用在拖拽预览上 *[复现：a 0–4、b 4–8、播放头 7.5，b 左拖到 1–5 → 播放头被拉到 5；拖回原位松手仍为 5 且无历史]* | `moveItem` 只更新总时长，提交路径经 `autoOrganize` 照常钳制（`a drag whose preview shortens the timeline leaves the playhead where it was`、`moving the last subtitle earlier moves a playhead past the new end back to the end`） |
| RC2-18 | P2 | tl-store | `trackActions.ts` 音量手势提交 | 手势跨过加锁：预览已写入的音量残留（如 40）、无历史，与 IM2-45「获得锁时回滚预览」不符 | 先恢复手势前音量再查锁（`a volume gesture the lock interrupts ends at its pre-gesture volume without history`） |
| RC2-19 | P2 | tl-store | `replaceTimeline.ts`；`dragMachine.ts`、`dragSlice.ts` | 先取消拖拽后构造：传入非法数据抛错时用户正在进行的拖拽已被取消（拒绝路径改了状态）；`previewFor / hasMoveChanged / hasResizeChanged` 无外部使用却导出 | 先构造、再取消拖拽与比较（`a malformed timeline leaves an in-flight drag running`）；三个函数改为模块私有 |
| RC2-20 | P2 | tl-ui | `SubtitleEditModal.handleBackdropMouseDown` | 在遮罩上按下、到卡片内松开：弹窗不关但焦点落到 body（`aria-modal` 之外），之后 Delete 删除背后选中片段、空格播放；放弃确认框关闭后同样把焦点还给 body | 按下目标为遮罩本身时 `preventDefault()`（`a press on the bare backdrop keeps focus inside the dialog`；补 ME-04 第 2 点缺失的 `closing hands focus back to the element that opened the dialog`） |
| RC2-21 | P2 | tl-ui | `timeline/lib/materialDragTypes.ts` | 可放置类型漏了 `subtitle`：素材库中的字幕（SRT）素材基线可拖到字幕轨，现在 dragover 返回 null、不 `preventDefault`，drop 不触发也无提示（「添加到时间轴」与 `isTrackCompatibleWithMaterial` 均支持） | 可放置集合加入 `'subtitle'`（`subtitle materials stay droppable onto subtitle lanes`） |
| RC2-22 | P2 | tl-ui | `TimelineItem.tsx` 悬停热区 | 冻结条件 `isDragging \|\| isResizing` 不含阈值前的 detecting 阶段：在手柄内侧按下、阈值内右移时热区被重算为 move，越过阈值后整个裁剪过程光标都是 grab；剪切工具下边缘仍显示裁剪手柄与 `ew-resize`，按下执行的却是切分 | 改用 store `isInteracting`；剪切工具下按 move 区显示（`the hover zone stays frozen from press to release`、`the cut tool never advertises a trim at the edges`） |
| RC2-23 | P2 | tl-ui | `Track.handleRemoveTrackClick` | `removeTrackAction` 新增的 `EDIT_LOCKED` 结果唯一调用方未处理：删除确认框打开期间 Agent 接管，点确认静默无效 | 提示 `timeline.messages.editLockedByAgent`（`a lane removal refused by the agent edit lock says why`） |
| RC2-24 | P1 | agent | `OperationApplier.ts`（新增 `applyRepack`）、`AgentEventRouter.ts` 批量分支 | IM2-48 的客户端以 `applyBatch` 逐条重放 `auto_fix_overlaps` 的移动；按 IM2-46 每次移动都贴紧整轨，而尚未移动的片段仍然重叠，排序被打乱 *[复现：a 0–5、b@2（2 s）、c@3（3 s）、d@4（5 s）→ 服务端 b 5 / c 7 / d 10，客户端 c 5 / d 8 / b 13]*——两端布局分叉，后续工具按错误位置操作，`shiftedClips` 与画面不符 | 回到 §3.7 AG2-09 原设计：Router 把 `auto_fix_overlaps` 交给 `applyRepack`，对涉及轨道执行同一个 `packOverlappingTracks`、一次写入、一条撤销记录（`the client lands on the layout auto_fix_overlaps reported`、`undoing auto_fix_overlaps restores the overlapping layout in one step`） |
| RC2-25 | P2 | agent | `useAgentExecution.ts` `onFinishingTimeout` | 看门狗超时后时间轴已解锁，但 `sendAgentMessage` 仍在 `await` 卡死的事件链，`sendingRef` 恒为 true——之后每次发送都静默无效，直到重载 | 超时时把事件链重置为 `Promise.resolve()`；卡住的环节留在旧链上，若之后完成仍会写入（与 R22 一致）（`a turn can be sent after the finishing watchdog gave up on a stuck event`） |
| RC2-26 | P2 | agent | `useAgentExecutionState.ts` `finishExecution` 与卸载清理 | 看门狗定时器卸载时不清理：`finishing` 期间卸载（或卸载清理中 `cancelByNavigation`）且事件链卡住，15 s 后在别的界面弹出超时警告 | 新增 `isMountedRef` 与挂起定时器集合，卸载时全部清除；卸载后发起的结束流程只执行终止回调、不写状态不提示（`unmounting while finishing leaves no watchdog to report a timeout`；两个 hook 用例撤掉修复实测 2 failed） |
| RC2-27 | P2 | agent | `TimelineChatPanel.tsx` | 本轮新加的 `aria-live` 逐个播报工具名，与 AgentBusyBar / finishing 状态条的播报区域重复（§3.7 要求沿用现有区域） | 删除该属性 |
| RC2-28 | P2 | agent | `tools/composeStoryboard.ts` `include_transitions` | 参数描述为「添加转场」，但 `add_clip` 总会贴紧整轨，0.5 s 间隔被抹掉——参数实际无效，误导模型 | 描述改为说明该参数不产生间隔，删除无效的间隔计算（布局不变） |
| RC2-29 | P2 | agent / 主线程 | `reconcile.ts`、`tools/{index,addToTrack,moveClip}.ts`、`OperationApplier.ts` | `packAllReorganisableTracks` 本轮删除了最后一个生产调用方（死代码）；同一个 1e-6 常量定义了三份；`applyRepack` 中 `[...new Set(...)]` 在当前 tsc target 下报 TS2802（主线程 `tsc` 发现） | 删除函数及其 3 个用例；统一从 `tools/index` 导出 `POSITION_EPSILON`；改为 `Array.from(new Set(...))` |

### RC2.2 记录更正与说明

- **IM2-48 更正**：客户端不再以 `applyBatch` 逐条重放 `auto_fix_overlaps` 的 `operations`（反例见 RC2-24），而是经 `OperationApplier.applyRepack` 对这些操作涉及的轨道执行与服务端相同的 `packOverlappingTracks`，一次写入、一条撤销记录；工具结果字段不变。
- **R9 核对**：全仓直接比较执行状态值的只有 `TimelineChatPanel`、`VideoChatWindow`、`useAgentExecution`，均已处理 `finishing`；其余消费方经 `agentIsExecuting` 覆盖；唯一取消入口 `VideoChatWindow.handleCancel` 已防护 `finishing`。

- **IM2-09 更正**：pydantic 会把 `track=True` 转成整数 `1`，布尔值实际落到 `audio-track-1`，并非「按标签处理」；行为无害。`track=2.5` 仍校验失败并触发一次修复轮（§3.8 规定的 `Union[str, int]` 所致），未改。
- **R4 记录**：安装包内 ffmpeg 由 `desktop/scripts/preflight.js` 指向 gyan.dev `ffmpeg-release-essentials.zip`（未钉版本，取最新 release，支持 `-/filter_complex` 选项文件语法）；本机 2025-05 git 构建实跑 `-/vf`、`-/filter_complex`、`-filter_script:v`、`-filter_complex_script` 四种写法均通过；更旧的 ffmpeg 经运行时探测回退到 `-filter_complex_script`，探测结果按 ffmpeg 路径缓存。
- **提交前缀**：§9 / RV-15 写「`[fix]` 前缀」，而本提交节点的任务定义要求 `feat:`，且与上一轮提交 `a7f46c5` 及近期历史一致——本轮使用 `feat:`。
- **ESLint 调用**：仓库为 ESLint 9 + `.eslintrc.json`，单文件检查须 `ESLINT_USE_FLAT_CONFIG=false npx eslint <files>`，否则因找不到 flat config 以退出码 2 退出而不检查任何代码（`npm run lint` 不受影响）。
- **本轮新增的残留风险**已列入附录 A N-12～N-21。

### RC2.3 验收门禁复跑（全部修复完成之后，提交前）

| # | 结果 | 记录 |
|---|---|---|
| A1 | ✅ 通过 | `npx tsc --noEmit` exit 0（评审途中 `tsc` 发现并已修复 2 处：新测试回调参数隐式 `any`、`[...new Set()]` TS2802，见 RC2-16 / RC2-29） |
| A2 | ✅ 通过 | `npm run lint` 6 个 error，全部位于本轮未触及文件：`AudioSearchModal` / `ImageSearchModal` / `VideoSearchModal` 各 1、`VideoCoverModal/components/ImageUploadInput.tsx` 1、`WatermarkRemovalModal` 2；`git status --porcelain` 对这 5 个文件为空，与实施记录一致 |
| A3 / A4 | ✅ 通过 | `npx vitest run` 全量 **277 个文件 / 2318 个用例 / 0 失败**（实施节点 275 / 2294；基线 231 / 2003） |
| A5 | ⚠️ 7 个既有失败 | 21 个文件（§7.2 的 18 个 + 本轮改写的 `test_subtitle_font_size_fix.py` / `test_audio_volume_consistency.py` / `test_video_composition_enhanced.py`），隔离 `cv2` 经 `PYTHONPATH` 加载：**259 passed / 7 failed / 0 skipped**。7 个失败全部属于实施记录的基线失败集合：N-11 的 4 例，以及 `test_video_composition_enhanced.py` 的 `test_convert_url_to_local_path_server_url` / `_http_url` / `test_process_audio_tracks_server_url`（前两类假设路径相对 CWD 而解析器锚定 `STORAGE_ROOT`，http 用例因本机 DNS 把 example.com 解析到 198.18.x 被 URL 守卫拒绝）。实施记录中这三个文件的 5 个失败里有 2 个（`test_single_audio_track_volume_application`、`test_audio_clipping_with_volume`）经 RC2-05 修正过期断言后转为通过。画布 ffmpeg 探针 7 例、字幕 `%` / 边界帧像素、图片不透明度像素、脚本文件参数实跑均实际执行 |
| A6～A12、A18 | ✅ 通过 | 均 0 命中（A9 两条；A10 非注释行中文 0 处、删除确认硬编码文案 0 处） |
| A13 | ✅ 通过 | 非测试文件只命中 `projects/hydrateTimeline.ts:68`、`store/actions/historyActions.ts:29` |
| A14 | ✅ 通过 | `close-guard tests passed`（8 例）、`window-state tests passed` |
| A15 | ✅ 通过 | `npm run build`：`✓ Compiled successfully`，exit 0 |
| A16 | ✅ 通过 | 提交前 `git status --porcelain -uall`：139 个修改、77 个未跟踪、1 个删除，全部位于 `src/`、`backend-services/basic-service/{app,tests}/`、`desktop/{main,preload}/`、本 spec 目录；无 `__pycache__`、`*.pyc`、`tsconfig.tsbuildinfo`、`.next/`、探针输出或临时脚本（评审临时文件均在会话 scratchpad）。相对 §4 新增的文件均为评审修复：`composition/media_download.py`、`hooks/useCompositionPlayback.ts`、`VideoPlayerPanel/imageOverlays.ts` 及其测试、`src/hooks/__tests__/useDesktopCloseGuard.test.ts`、`projects/__tests__/VideoEditorContainer.localeSwitch.test.ts` |
| A17 | ✅ 通过 | 只命中 `TimelinePanel.tsx` 挂载 `initTimeline`、复制（`importFromData` + `autoOrganize`）、整理（`autoOrganize`） |

**未执行项**：§7.3 桌面端走查 1～23 条需要交互式 Electron 会话，本节点未执行——C-7 仍未满足，发布前须人工在 `cd desktop && npm run dev` 中逐条勾选并补记结果。本节点以单个 `feat:` 提交落地全部改动（未按 §9 G1～G9 拆分：各组文件大量交叉，逐组提交无法保证每个中间提交可独立通过门禁）。
