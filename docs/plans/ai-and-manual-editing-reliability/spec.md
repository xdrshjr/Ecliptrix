# AI 自动剪辑 + 手动剪辑 稳健性加固（第 1 轮）— 设计方案

| 项 | 值 |
|---|---|
| 文档版本 | **v2**（v1 = 方案设计节点产出；v2 = 「方案评审与修复」节点就地修订，修订点见「评审记录」，结论见文末「评审结论」） |
| 日期 | v1：2026-09-13；v2：2026-09-14 |
| 分支 / 基线 | `feat/remove-user-system` @ `01af364`（工作区干净） |
| 需求来源 | 任务板「AI自动剪辑 / 手动剪辑 更加完善稳健可靠，每轮 ≥10 个问题并逐一修复」 |
| 本轮范围 | 32 个已证实缺陷（P0×6 / P1×22 / P2×4），另 27 个已证实缺陷列入附录 A 供第 2、3 轮 |
| 适用产品形态 | 单用户 Electron 桌面端（FastAPI 127.0.0.1 + Next standalone），无鉴权、SQLite |

> 证据说明：本文每个缺陷都给出 `文件:行号`（基线 `01af364`）、复现路径与根因。
> 所有条目均经过「读代码 + 具体数值推演」确认；标注 *[实测]* 的条目额外做了运行验证
> （pytest / node 内存复现 / ffmpeg 探针）。实现节点必须先写回归测试再改代码。

---

## 评审记录

> 评审节点：方案评审与修复（v1 → v2）。评审方式：逐节对照 **可行性 / 完整性 / 一致性 / 规模适配** 四个维度审阅 v1 全文；
> 对 v1 依赖的关键前提逐一回到基线 `01af364` 源码核实（下表「证据」列均为本节点亲自读到的代码行），并实际运行
> `python -m pytest tests/test_timeline_validation_fix.py`（**8 failed / 2 passed**，8 个失败全部是
> `VideoSegmentModel` / `AudioSegmentModel` 的 `extra_forbidden`，确认 AM-05 的 `extra=ignore` 能让 A5 由 8 红变 0 红）。
>
> 严重度：**P0** = 按 v1 实施后修复本身在真实应用中失效，或引入时间轴损坏；**P1** = 实施后引入可感知回归、门禁无法通过
> 或关键遗漏；**P2** = 精确度、边界体验、可维护性。**所有 P0 / P1 已在正文就地修复**（正文中以「v2」「RV-xx」标注），
> P2 中成本低的一并修复，其余记录为实施注意事项或进入附录 A。

### R.1 问题清单（P0×2 / P1×7 / P2×14）

| ID | 级别 | 维度 | 位置 | 问题 | 证据 | 处理 |
|---|---|---|---|---|---|---|
| RV-01 | P0 | 完整性 | §3.6 AG-01 | v1 只在「已收到 tool_result」后禁止重连，**重连前**的路径仍然坏：① 客户端按 `_eventId <= lastReceivedEventId` 跳过事件、按 `completedToolCallIds` 跳过 tool_call，而服务端每次新连接事件 id 从 0 重新计数、LLM 输出也不同 → 重跑的前 N 个事件（含 tool_call 甚至 tool_result）被丢弃，客户端缺操作而服务端 Agent 本地状态认为已应用，双方分叉（AG-01 标题里「缺失」的一半没修）；② `AgentStateManager` 与 `accumulatedTextRef` 保留第一次的半截文本和工具卡片 → 重跑后文本重复、卡片永远「执行中」；③ 只看 `completedToolCallIds`：tool_call 已发出、结果未送达时，服务端工具（生成类、入库类，部分计费）可能已经执行，重连会再执行一次 | `SSEStreamManager.ts:265-268,316-337,498-520`；`chat/route.ts:298-308`；`useAgentExecutionState.ts:123,185`；`AgentStateManager.ts:61-72`（无重置方法） | **已修**：§3.6 AG-01 改为「观察到任一 tool_call 即不自动重连；重连 = 干净重启本轮」；新增 F46 / F47；T14、T16 用例更新 |
| RV-02 | P0 | 可行性 | §3.6 AG-02 | 补丁冲突判定比较的是「经 store 往返后的当前轨道」与「OperationApplier 产出的 after」，二者结构上必然不同：`Track` 实体构造时按 startTime 重排 items（applier 是 `push` 到末尾），`TimelineItem.fromPlainObject` 丢弃 `originalDuration: 0`、把 `duration<=0` 改为默认值、`Volume.create` 规整音量；v1 的 `semanticTrackKey`「items 保持数组顺序」→ 真实应用里插入/移动类操作的撤销几乎都会误报冲突，功能等于不可用；而不经 store 的单测会全绿，缺陷被隐藏 | `Track.ts:76,139,289-291,304-315`；`TimelineItem.ts:279-311`；`OperationApplier.ts:456-470`；`TimelinePanel.tsx:302-330,347-354` | **已修**：语义键先经领域层规整（`Track.fromPlainObject(...).toPlainObject()`，与 store 同一转换），items 按 `(startTime, id)` 排序，布尔字段取缺省；T12 / T13 增加真实往返用例 |
| RV-03 | P1 | 完整性 | §3.6 AG-02、§6.1 | ① 整轮补丁只在 `onComplete` 生成，用户停止（`sealMessage`）与出错（`onError`）的轮次没有补丁 → 这类轮次的「撤销本轮」按钮消失（今天可以整轮撤销）；② 补丁保存完整 Track 副本（含 `data:` 缩略图），随 `project_data.conversations` 持久化，而现有 `timelineSnapshot` 已在每条 Agent 消息里整表持久化、未剥离缩略图 → 项目 JSON 持续膨胀，与 `videoProjects.ts` 为缩略图体积做过的修复相悖；③ `OperationApplier.undoAll / getFullSnapshot / fullSnapshot` 全仓零调用，v1 仍写「若存在同样改为倒序补丁回退」 | `useAgentExecution.ts:221,255,290-314,341-367`；`AgentStateManager.ts:289-310`；`videoProjects.ts:214-250,272-277`（只剥离 materials 与 `uiState.currentTimelineState`）；grep `undoAll()` 仅定义处 | **已修**：三个终止路径都写补丁；补丁轨道瘦身；新消息不再写 `timelineSnapshot`；删除死代码 |
| RV-04 | P1 | 一致性 / 人机交互 | §3.2 S3、§3.7 TL-03 | `shouldGlobalSpaceTogglePlayback` 尊重 `defaultPrevented` 并把 button / role 控件当作「空格归属者」，会破坏剪辑软件最核心的快捷键：① `TimelineItem` 根节点 `tabIndex=0`，点选片段后焦点落在片段上，其 `onKeyDown` 对空格 `preventDefault()`（用于选中）→ **点选片段后空格不再播放**；② 点过任意工具栏按钮后，空格变成再次触发该按钮。还会打挂现有源码断言测试 `videoEditingInterface.spaceKey.test.tsx`（v1 文件清单未列） | `TimelineItem.tsx:335-367,608,622`；`VideoEditingInterface.tsx:422-433`；`__tests__/videoEditingInterface.spaceKey.test.tsx:35-67` | **已修**：全局空格只排除「文本编辑目标」与「模态框内」，不看 `defaultPrevented`、不看按钮；时间轴快捷键判定保留 `defaultPrevented`；T8 用例重写、新增 T26；键盘聚焦按钮上的空格取舍列入附录 A BL-29 |
| RV-05 | P1 | 完整性（S1 引入的新风险） | §3.2 S1 | v1 之前每次 Agent 操作都会 `clearHistory()`，执行期间 Ctrl+Z 实际无效；S1 让 Agent 操作进入撤销栈后，执行中的 Ctrl+Z / Ctrl+Y / Delete / S 等键盘改写（遮罩 `agent-timeline-lock-overlay` 只挡指针，挡不住 document 级快捷键）会改写时间轴，而服务端 Agent 仍按旧状态继续下发操作 → 状态分叉，整轮补丁也被污染 | `VideoEditingInterface.tsx:2800-2802`；`TimelinePanel.tsx:491-570`；`TimelineToolbar.tsx:150-176` | **已修**：新增 §3.2 S4「外部编辑锁」（F48），与 S1 同组落地 |
| RV-06 | P1 | 完整性 | §3.7 TL-01 | 「防重入」不完整：`isExtractingSubtitles` 在确认之后才置位；确认框打开期间焦点仍在时间轴（`ConfirmationDialog` 打开时不移动焦点），再按 S 会覆盖 `subtitleReplaceConfirm`，前一个 Promise 永不 resolve（处理函数悬挂，可能并发两次识别）；焦点不在框内，Esc / Enter 也无效，S3 的模态判定同样覆盖不到 | `ConfirmationDialog.tsx:31-60,127-128`（仅容器 `onKeyDown`，无初始焦点） | **已修**：TL-01 增加待确认守卫（F50 纯函数）；`ConfirmationDialog` 打开即聚焦「取消」、关闭后还原焦点、按钮上的 Enter 由按钮自身处理（F49、T27） |
| RV-07 | P1 | 可行性 | §3.5.1 AS-01 | 视频「取最新」按 `createdAt` 判定不成立：`ScriptPanel` 以 `{...video, metadata}` 复制源素材，`createdAt` 是**源素材**的创建/上传时间而不是匹配时间 → 重新匹配一个较早上传的本地素材时会选回旧视频。`addOrReplaceMaterial` 对新 id 追加到数组末尾，`allMaterials` 就是该数组本身，数组位置才是可靠的「最近写入」信号 | `ScriptPanel.tsx:749-765`；`useMaterialManagement.ts:354-381,512` | **已修**：音频与视频统一按 `allMaterials` 中的位置判新 |
| RV-08 | P1 | 一致性 | §7.2 A6 | 门禁自相矛盾：S1 第 5 点明确「项目水合路径不改」，而 `projects/hydrateTimeline.ts:72,103` 正是 `src/components/video` 下的非测试 `clearHistory()` 调用 → A6 按字面永远不通过（与历史轮次 F-20 / F-21 同一类门禁缺陷） | `hydrateTimeline.ts:71-72,102-103` | **已修**：A6 口径改为允许 historySlice 定义与 `hydrateTimeline.ts` |
| RV-09 | P1 | 完整性 | §4.5 | 文件清单只列新增测试，漏了必然被打挂的现有测试：`operationApplier.overlap.test.ts:108` 断言 `undoOperation(...)` 为 `true`（AG-02 改返回类型）；`videoEditingInterface.spaceKey.test.tsx` 以正则钉住空格处理器源码（TL-03 改写）。下游节点「严格按文件清单落代码」，A1 / A4 会失败 | 见左 | **已修**：新增 T25、T26（修改） |
| RV-10 | P2 | 可行性 | §3.3 AM-04 | 「按组回退」把 VIDEO_CUT 的 key 回退一并去掉：只配了 `VIDEO_CUT_LLM_API_URL`、沿用 `LLM_API_KEY` 的旧 `.env` 会从可用变成 401 | `model_settings_service.py:647-652` | 已修：组内 key 仍回退 `llm_api_key` |
| RV-11 | P2 | 可行性 | §3.3 AM-07 | `JSONResponse(content=ErrorResponse(...).model_dump())` 依赖 serializer 恰好把 datetime 转成字符串，脆弱 | `base_models.py:33` | 已修：`model_dump(mode="json")` |
| RV-12 | P2 | 一致性 | §3.3 AM-05 / AM-06 | 两段伪代码互相矛盾（重试循环返回 `simplified`，串联段又要求返回 `(simplified, report)`）；真实调用链是 `generate_mixed_editing → _convert_to_full_timeline → parse_simplified_timeline`，v1 直接写调用 parser | `ai_mixed_editing_service.py:434-480,599-625` | 已修：统一为一段伪代码，`_convert_to_full_timeline` 透传 `warnings` |
| RV-13 | P2 | 一致性 | §3.7 TL-02 | 说明有误：resize 预览**不**改写 store（`updateDrag` 的改写块受 `isDragging` 门控，resize 状态下为 false）；修复本身正确 | `dragSlice.ts:149-159,266-297` | 已修说明 |
| RV-14 | P2 | 人机交互 | §3.7 TL-04、§7.3 | 图片轨（type=video）同样被 `organizeVideoAudioTracks` 贴紧，非首个图片片段「向左扩展」提交后表现为「时长变长、位置重新贴紧」；v1 走查第 11 条「左边缘向左扩展生效」会被误判为失败 | `TimelineAggregate.ts:247-263`；`dragSlice.ts:205-214` | 已修走查表述 |
| RV-15 | P2 | 一致性 | §3.6 AG-01 | 保活定时器清理位置写成「与 `thinkingHeartbeatId` 同处」，但后者位于独立的 thinking 阶段函数内；正确位置是 `start()` 的 `finally` 与 `cancel()` | `chat/route.ts:69-80,132-134,293,560-570` | 已修说明 |
| RV-16 | P2 | 完整性 | §3.2 S1 | ① 外部更新 id 为 `agent-op-${Date.now()}`，两次不同渲染落在同一毫秒时第二次会被 `lastExternalUpdateIdRef` 守卫吞掉，而 S1 之后它是 Agent 写入 store 的唯一通道；② 内容未变化的外部写入也会压一条空历史 | `useAgentExecution.ts:242,405,429`；`TimelinePanel.tsx:348-350` | 已修：单调计数 id（F51）；规整后轨道一致则不记历史 |
| RV-17 | P2 | 人机交互 | §3.5.3 AS-02 | 先弹「替换确认」，用户确认后才发现目标轨锁定而被拒；`no-target-track` 没有文案 | — | 已修：锁定 / 缺轨检查前移到确认之前，补 i18n key |
| RV-18 | P2 | 可行性 | §3.4.3 AM-08 | `start` 的重入守卫读 React state（闭包可能过期），同帧双击会启动两次 | — | 已修：改用 `activeRunRef` |
| RV-19 | P2 | 可行性 | §4.5 T21 | 仓库内没有任何渲染 `<TimelinePanel>` 的测试先例（依赖 LocaleContext、NotificationContext、视频缓存等），T21 成本高且脆弱 | 在 `*.test.tsx` 中 grep `<TimelinePanel` 零命中 | 已修：键位解析抽为纯函数 `resolveTimelineShortcut`，字幕替换前置判定抽为 `getSubtitleReplacementBlocker`，T21 并入 T8 / T28 |
| RV-20 | P2 | 人机交互 | §3.7 TL-07 | v1 让 `TrackSelectionService` 在「显式目标锁定 / 不兼容」时一律回退到其他轨道：程序化添加合理，但用户把素材**拖到某条锁定轨上**时会静默落到别的轨道，违背直接操作预期 | `TimelinePanel.tsx:575-613` | 已修：取消该回退，改为程序化查找优先未锁定轨，拖到锁定轨时提示 |
| RV-21 | P2 | 人机交互 | §3.6 AG-02 | 单步撤销按钮按工具名显示，但记录只存在于**当前一次执行**的 `OperationApplier`（每次发送都新建），历史消息上的按钮点击后只能提示「不可撤销」 | `useAgentExecution.ts:235-246` | 记录：本轮以提示文案兜底，列入附录 A BL-28 |
| RV-22 | P2 | 完整性 | §3.6 AG-03 | `useAgentExecutionState` 在 SSE 结束时立即置 `completed`，早于事件链排空（数十毫秒），S4 锁会提前解除 | `useAgentExecutionState.ts:252-255` | 记录：窗口极短，列入附录 A BL-30 |
| RV-23 | P2 | 规模适配 | 全文 | 单轮 32 项、约 50 个前端文件，规模偏大，但与「每轮 ≥10 个问题并逐一修复」的需求一致，且已有 G1–G8 分组；需要明确遇阻时的取舍顺序，避免半成品提交 | — | 记录：见「评审结论」条件 C-5 |

### R.2 已核实成立的关键前提（后续节点无需重复论证）

- **S1 可行**：`recordAction` 先 `getSnapshot()` 再压栈；`importFromData` 只替换 `_aggregate`，`_historyService` 位于独立的 historySlice，不会被重置（`historySlice.ts:73-93`、`timelineSlice.ts:561-565`）。
- **S2 可行**：各 action 的 mutation 与 `autoOrganize` 都同步完成后才调度 capture；现有 5 个测试把 rAF stub 成 `setTimeout`，改为同步捕获不影响它们。
- **AM-05 基线**：实测 8 failed / 2 passed，失败原因全部是段模型的 `extra_forbidden`。
- **AM-08 精简 DTO 不丢信息**：后端提示词只读 `description / tags / metadata.segment_id / segment_number / video_analysis`，且视频分析另有按 `material.url` 的服务端存储回退（`ai_mixed_editing_service.py:104-176,177-276`）。
- **AM-07 链路**：BFF `createPassthroughRoute` 原样透传状态码与响应体（`backend-proxy.ts:313-338`）；`http-client` 读取 `message / error_code / error_details`（`http-client.ts:213-228`）。
- **AM-01 / AG-06 边界**：后端 parser 已为 video / image / audio 条目写 `originalMaterialType`（`timeline_parser_service.py:116,164,217`）；`timeline_import_models.py` 只为请求/响应建模，不会剥离条目字段。
- **TL-05 图片位置**：拖动过程只写 React 状态与合成（`VideoEditingInterface.tsx:2018-2047`），确认时 store 仍是旧值，「值未变化则不记录」判定正确。
- **EX-02**：`useTimelineComposition.ts` 确实没有 `isLocked` 过滤；轨道头有独立的显示/隐藏开关（`Track.tsx:188,494-518`），R9 的缓解成立。
- **AM-04**：`get_effective_config` 自建 session、无需注入；`LLMCallConfig(api_url, api_key, model, api_type)` 字段名与 v1 一致（`llm_client.py:28-35`）。

---

## 1. 概述

Ecliptrix 的剪辑能力由三条「AI 自动剪辑」链路与一条「手动剪辑」链路组成：
**① AI 混剪**（素材面板「AI混剪」→ 模式选择 → 批量视频解析 → 后端 `POST /api/ai-mixed-editing`
调用 VIDEO_CUT LLM 生成简化时间轴 → `POST /api/timeline-import` 转换 → 前端合并进时间轴）；
**② AI 自动混剪**（素材面板「AI自动混剪」按钮，按脚本段落把 TTS 配音和匹配视频排上轨道）；
**③ 剪辑 Agent**（浮动对话 Dock 中的自主 Agent，通过 SSE 下发 `add_clip/trim_clip/...`
操作由 `OperationApplier` 应用到时间轴）；以及 **④ 手动剪辑**（`TimelinePanel` + DDD 时间轴
领域层 + Zustand store + 画布预览 + FFmpeg 导出）。

本轮对四条链路做了系统排查（主线程亲自追踪 AI 混剪全链路，另派 4 个只读排查代理分别覆盖
时间轴领域/store、时间轴 UI 交互、Agent 操作应用、预览与导出一致性，主线程对其结论逐条抽查
代码复核），共确认 59 个缺陷。其中最严重的几类是：**AI 混剪静默清空用户已有的字幕与第二音轨、
并清空撤销历史**（用户手工成果不可恢复）；**合并逻辑把同一片段复制到用户新增的视频轨，产生重复
item ID**；**后端完全绕过「设置 → 模型设置」**导致只在设置页配置模型的桌面用户无法使用 AI 混剪；
**Agent 流式重连会让服务端从头重跑、客户端重复应用操作**；**Agent 撤销用整条旧快照覆盖时间轴，
抹掉之后的手工编辑**；**按 S 键会不经确认、不可撤销地替换整条字幕轨**；**导出时 item×轨道音量
超过 2 直接 422 整单失败**。

本轮目标是把这 32 个 P0/P1 为主的缺陷一次修到位，并以四个共享机制收敛同类问题（S4 为 v2 评审新增，见 RV-05）：
**S1 可撤销的整表替换**（所有外部写入时间轴的路径——AI 混剪、自动混剪、Agent 操作与撤销、
字幕替换、文件导入——统一走一个记录历史的 action，不再 `clearHistory`）；**S2 同步提交历史快照**
（消除 rAF 延迟快照导致的重做丢失）；**S3 快捷键归属判定**（模态框内、已被消费的按键不再触发
时间轴快捷键；模态框与文本输入内的空格不再触发全局播放）；**S4 外部编辑锁**（Agent 执行期间禁止键盘与工具栏改写时间轴，
避免 S1 把 Agent 操作接入撤销栈后，执行中的撤销造成客户端与 Agent 状态分叉）。交互层面遵循「破坏性操作先确认、长任务可取消、结果可撤销、
失败信息可读、全部文案双语」的人机交互原则。其余 27 个缺陷（以 FFmpeg 合成一致性为主，
需要独立的滤镜图重构与探针验证）列入附录 A，作为第 2 轮的输入。

---

## 2. 缺陷清单（本轮范围，32 项）

严重度定义：**P0** = 用户数据丢失 / 导出失败 / 时间轴损坏；**P1** = 用户可遇到的错误剪辑结果或
功能不可用；**P2** = 边界场景 / 可用性 / 可访问性。

### 2.1 AI 混剪（AM）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| AM-01 | P0 | AI 混剪清空字幕轨与音频轨 2+，并 `clearHistory()`，无确认、不可撤销 | `VideoEditingInterface.tsx:1802-1813,1836-1842`；`TimelinePanel.tsx:351-352` |
| AM-02 | P0 | 合并把 AI 视频片段复制到用户新增的视频轨，两个轨道出现相同 item ID | `VideoEditingInterface.tsx:1814-1819,1831-1834,2326`；`domain/entities/Track.ts:121` |
| AM-03 | P1 | 所有 AI 音频轨扁平化到音频轨 1，BGM 与旁白同轨重叠 | `VideoEditingInterface.tsx:1773-1800`；`ai_mixed_editing_service.py:317` |
| AM-04 | P1 | 后端只读 `VIDEO_CUT_LLM_*` 环境变量，忽略「模型设置」中的视频剪辑模型；未配置 env 时 500 | `ai_mixed_editing_service.py:25-34`；`model_settings_service.py:598-681` |
| AM-05 | P1 | LLM 输出解析脆弱：仅剥离 ```` ```json ````；segment `extra=forbid` 与 `volume:int` 让常见输出整单失败 *[实测：现有 8/10 用例红]* | `ai_mixed_editing_service.py:571-580`；`ai_mixed_editing_models.py:84,94,98,108`；`tests/test_timeline_validation_fix.py` |
| AM-06 | P1 | 校验生成 0 时长片段；不校验素材存在/类型/源时长/同轨重叠 | `timeline_parser_service.py:92-117,517,538,559` |
| AM-07 | P1 | 失败 toast 显示 Python dict 原文 `{'error': ..., 'taskId': ...}` | `ai_mixed_editing_router.py:49-147`；`main.py:342`；`VideoEditingInterface.tsx:2428` |
| AM-08 | P1 | 进度弹窗不可取消、随机伪进度、请求无中止（最长 15 分钟锁屏）、卸载后仍 setState；文案硬编码中文 | `VideoEditingInterface.tsx:2202-2209,2289-2292,2321-2327,2964-2968`；`AIMixingProgressModal.tsx:31-54,125,154,162,171` |
| AM-09 | P1 | AI 混剪默认 200% 音量（item 2.0 × 轨道 200）→ 爆音；与 EX-01 叠加导致导出 422 | `ai_mixed_editing_models.py:94`；`timeline_parser_service.py:212,348,366` |
| AM-10 | P2 | 模式选择弹窗焦点未进入对话框（Esc/Enter 无效）、关闭按钮无 aria-label、帧间隔输入无法清空重输 | `AIMixingModeSelectionModal.tsx:46-52,62-65,105-112` |

### 2.2 AI 自动混剪（AS）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| AS-01 | P1 | 重新生成 TTS 后同段落旧配音仍在素材库并一起上轨；重复匹配的视频全部上轨；重复点击叠加 | `ScriptPanel.tsx:1500,749-765`；`useMaterialManagement.ts:354-381`；`VideoEditingInterface.tsx:2067-2082` |
| AS-02 | P1 | 视频按素材全长上轨、音频按配音长度上轨 → 第 k 段起逐段音画错位；逐条 `setTimeout` 添加产生 N 条历史 | `VideoEditingInterface.tsx:2144-2151`；`TimelinePanel.tsx:606,633-654`；`store/actions/addItem.ts:41` |

### 2.3 剪辑 Agent（AG）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| AG-01 | P0 | SSE 自动重连重新 POST 同一请求，服务端从头重跑 Agent（事件 id 从 0 起），客户端按 id 跳过 → 操作重复/缺失 | `SSEStreamManager.ts:266-275,319-330`；`chat/route.ts:277-278,298,312-314`；`useAgentExecutionState.ts:262-267` |
| AG-02 | P0 | Agent 撤销恢复整条旧快照，抹掉之后的手工编辑、复活已撤销片段；批量工具与纯脚本轮次的撤销静默无效或误伤时间轴 | `OperationApplier.ts:129-130,164-186`；`useAgentExecution.ts:395-414`；`AgentEventRouter.ts:159-163` |
| AG-03 | P1 | `tool_result` 事件未串行处理（`delete_clip` 先等 rAF+50ms）→ 后续操作先落地、乱序；完成回调早于最后一次落盘 | `useAgentExecution.ts:284-297`；`OperationApplier.ts:132-139` |
| AG-04 | P1 | `delete_clip / trim_clip / resize_clip` 与 `move_clip` 源轨不检查锁定 | `tools/deleteClip.ts:20-30`；`tools/moveClip.ts:35-44` |
| AG-05 | P1 | `add_to_track / move_clip` 不校验轨道与素材类型兼容，音频落到视频轨后预览/导出都静默跳过 | `tools/addToTrack.ts:76-107`；`TrackType.ts:88-106` |
| AG-06 | P1 | Agent 添加的图片片段缺 `originalMaterialType`，预览不显示（导出显示） | `OperationApplier.ts:456-470`；`agent.ts:351-364`；`useCompositionPlayback.ts:172` |
| AG-07 | P1 | `resize_clip` 只改 `duration` 不改 `clipEnd`、无上界 → 违反 INV-3，预览与导出时长不一致 | `tools/resizeClip.ts:27-38`；`OperationApplier.ts:519-528`；`agent.ts:412-420` |
| AG-08 | P1 | 每次 Agent 操作都经外部同步 `clearHistory()`，用户手工编辑的 Ctrl+Z 历史被清空 | `TimelinePanel.tsx:348-353`；`VideoEditingInterface.tsx:2576-2579` |

### 2.4 手动剪辑 · 时间轴（TL）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| TL-01 | P0 | 按 S 键批量识别字幕直接替换整条字幕轨：无确认、无撤销、无进行中防重入 | `TimelinePanel.tsx:554-556,839-841,904-948` |
| TL-02 | P1 | 拖拽中按 Esc 不回退（预览帧已真实写入 startTime）；`pointercancel`/窗口失焦不取消 *[实测]* | `store/slices/dragSlice.ts:266-275,308-315`；`TimelinePanel.tsx:393-421` |
| TL-03 | P1 | Delete/Backspace、Ctrl+Z/Y、S/M/E/T 与全局空格在模态框内误触发（例：运镜弹窗内按 Delete 删掉正在编辑的片段） | `TimelinePanel.tsx:491-562`；`VideoEditingInterface.tsx:422-433`；`ui/Modal.tsx:76-77` |
| TL-04 | P1 | 图片片段无法拉长超过初始 5 秒，也无法向左扩展 *[实测]* | `ItemPlacementService.ts:196-199`；`TimelineItem.ts:400-412`；`dragMachine.ts:229,254-266` |
| TL-05 | P1 | 字幕文本、图片位置编辑不入撤销历史，Ctrl+Z 连带撤销上一步且无法重做 *[实测]* | `timelineSlice.ts:375-399`；`TimelineItem.tsx:313`；`TimelinePanel.tsx:1049`；`VideoEditingInterface.tsx:2050` |
| TL-06 | P1 | after 快照在下一帧写入「最后一条」历史，同帧连续操作后重做失效 *[实测]* | `HistoryService.ts:151-158`；10 个 action 文件 + `dragSlice.ts:185,201,216` |
| TL-07 | P2 | 被拒绝的编辑（锁定轨删除/拖拽、类型不兼容添加）仍写入历史并清空重做栈；锁定轨仍可复制粘贴 *[实测]* | `removeItem.ts:66-74`；`addItem.ts:30-37`；`TimelinePanel.tsx:684-747`；`TimelineToolbar.tsx:132,144` |
| TL-08 | P2 | Ctrl+Shift+Z 与 CapsLock 下撤销/重做失效；工具提示中的 Ctrl+X 无对应处理 | `TimelinePanel.tsx:522-527`；`i18n.ts:2985,5364` |
| TL-09 | P1 | `transitionIn/transitionOut` 在 `importFromData`/撤销快照往返中丢失；切分后两半都带内侧转场 *[实测]* | `TimelineItem.ts:112-140,279-311,456-490`；`SplitService.ts:84-101` |

### 2.5 导出一致性（EX）

| ID | 级别 | 标题 | 关键证据 |
|---|---|---|---|
| EX-01 | P0 | 导出音量 = item×track 未钳制，>2 时后端 `le=2` 校验 422 整单失败；0% 轨道被 `|| 100` 当成 100% | `useVideoExport.ts:341,407`；`video_models.py:356,415`；`CompositionAdapter.ts:152-156` |
| EX-02 | P1 | 锁定轨被预览与导出排除（锁定语义应为仅防编辑），字幕/图片与视音频规则不一致；导出不排除静音轨 | `useVideoExport.ts:192,204`；`CompositionAdapter.ts:125,219-223,289`；`useCompositionPlayback.ts:170` |
| EX-03 | P2 | 合成失败提示恒为 "Unknown error"（读 `error_details.error`，后端字段为 `error_summary`）；轮询不随卸载中止 | `videoComposition.ts:306-335`；`video_models.py:502-509`；`useVideoExport.ts:691` |

---

## 3. 技术设计

### 3.1 现状链路与问题定位

```
[AI 混剪 · 现状]
MaterialsPanel「AI混剪」→ VideoEditingInterface.handleAIMixedEditing
  → AIMixingModeSelectionModal.onConfirm(mode)
  → executeAIMixedEditing(mode)                      (VideoEditingInterface.tsx:2189)
      ├─ setInterval 随机伪进度 (≤90%)                  ← AM-08
      ├─ analyzeVideosInBatch(allVideos, mode)          (parallelVideoAnalysis.ts:477)
      ├─ http.post /api/ai-mixed-editing (600s, 无 signal) ← AM-08
      │     BFF passthrough → FastAPI ai_mixed_editing_router
      │       → AIMixedEditingService()  读 env VIDEO_CUT_LLM_*   ← AM-04
      │       → call_chat → 剥 ```json → json.loads → SimplifiedTimelineModel(forbid) ← AM-05
      │       → validate_simplified_timeline (0 时长保留)          ← AM-06
      │       → TimelineParserService.parse (volume/100, 轨道 200)  ← AM-09
      │       → 异常 HTTPException(detail=dict) → str(dict)         ← AM-07
      ├─ http.post /api/timeline-import (preserveIds)
      └─ handleImportComplete(materials, timelineState, true)
            ├─ 按轨道 ID 硬编码合并；字幕/音轨2 清空；通用分支复制   ← AM-01/02/03
            └─ setExternalTimelineUpdateId → TimelinePanel effect
                  → importFromData + clearHistory()                 ← AM-01/AG-08

[Agent · 现状]
useAgentExecution.sendAgentMessage → SSEStreamManager (重连=重 POST) ← AG-01
  → onEvent: router.handleEvent(e) 未串行                          ← AG-03
  → OperationApplier.apply → setCurrentTimelineState + setExternalTimelineUpdateId
  → TimelinePanel effect → importFromData + clearHistory()          ← AG-08
  撤销：restore preSnapshot / message.timelineSnapshot 整表覆盖      ← AG-02
```

### 3.2 共享机制（先落地，后续条目依赖）

#### S1 可撤销的整表替换 `replaceTimelineAction`

新文件 `src/components/video/timeline/store/actions/replaceTimeline.ts`：

```ts
import type { TimelineStore } from '../useTimelineStore';
import { TimelineAggregate } from '../../domain';
import type { TimelineData } from '../../domain';

/** 外部整表写入的来源，仅用于历史 payload 与日志，不影响行为。 */
export type ReplaceTimelineReason =
  | 'ai-mix' | 'auto-mix' | 'agent' | 'agent-undo' | 'import' | 'subtitles';

/**
 * 以一条可撤销历史记录替换整条时间轴。取代「importFromData + clearHistory」。
 * 0) 规整后轨道与当前一致时不写历史（v2 RV-16）；1) recordAction 捕获替换前快照；
 * 2) importFromData；3) 裁剪选区中已不存在的 id；4) 同步 captureNextState（S2）。
 * @returns 是否写入了一条历史。
 */
export function replaceTimelineAction(
  get: () => TimelineStore,
  data: TimelineData,
  reason: ReplaceTimelineReason,
): boolean {
  const state = get();
  const incomingTracks = TimelineAggregate.fromPlainObject(data).toPlainObject().tracks;
  if (JSON.stringify(incomingTracks) === JSON.stringify(state.exportToData().tracks)) {
    return false;
  }
  state.recordAction('REPLACE_TIMELINE', { reason });
  state.importFromData(data);
  get().pruneSelection();
  get().captureNextState();
  return true;
}
```

配套改动：
1. `domain/services/HistoryService.ts:31-47` 的 `TimelineAction['type']` 联合类型新增 `'REPLACE_TIMELINE'`。
2. `store/slices/selectionSlice.ts` 新增 `pruneSelection(): void`：
   `set({ selectedItems: get().selectedItems.filter(id => get()._aggregate.findItem(id) !== null) })`
   （`findItem` 返回 `{ track, item } | null`，见 `TimelineAggregate.ts:172-177`）；在 `TimelineStore`
   接口中声明。
3. `store/actions/` 无 barrel 文件，调用方直接 `import { replaceTimelineAction } from '.../store/actions/replaceTimeline'`。
4. `TimelinePanel.tsx:347-354` 外部同步 effect 改为：
   ```ts
   lastExternalUpdateIdRef.current = externalTimelineUpdateId;
   replaceTimelineAction(
     () => useTimelineStore.getState(),
     externalTimelineState as unknown as TimelineData,
     reasonFromExternalUpdateId(externalTimelineUpdateId),
   );
   ```
   删除 `clearHistory()` 调用。`reasonFromExternalUpdateId(id)` 放入新文件
   `src/components/video/timeline/lib/externalUpdateId.ts`（纯函数，F51）：
   `id.startsWith('agent-undo') → 'agent-undo'`；`id.startsWith('agent-op') → 'agent'`；其余 `'import'`。
   同文件导出 `nextExternalUpdateId(prefix: 'agent-op' | 'agent-undo' | 'agent-undo-single' | 'timeline-update'): string`，
   返回 `${prefix}-${Date.now()}-${++counter}`（模块级单调计数）；`useAgentExecution.ts:242,405,429` 与
   `VideoEditingInterface.tsx:1869` 改用它生成 id。v2 RV-16：S1 之后外部 id 是 Agent 写入 store 的唯一通道，
   同一毫秒内两次渲染产生相同的 `Date.now()` id，会被 `lastExternalUpdateIdRef` 守卫吞掉。
5. 项目打开的水合路径（`projects/hydrateTimeline.ts:71-72,102-103`）**不改**：打开项目不应产生可撤销记录，
   该文件保留 `clearHistory()`（§7.2 A6 已据此修订，RV-08）。
6. `replaceTimelineAction` 在「规整后轨道 JSON 与当前一致」时直接返回 `false`、不写历史（RV-16：内容未变化的外部
   写入不再压一条按 Ctrl+Z 毫无反应的空记录）；比较双方都经过同一领域规整，不会因字段缺省或顺序误判。

效果：AM-01、AG-08、TL-01、TL-05（字幕弹窗保存）以及文件导入都成为 1 步可撤销操作；
Agent 执行结束后 Ctrl+Z 可逐步回退 Agent 的操作（同一渲染批次内到达的多个操作可能合并为 1 条历史）；
执行期间的撤销由 S4 禁止。

#### S2 同步提交历史快照

所有 mutation 都是同步的（Zustand `set` 与 `_syncDerivedState` 均同步），rAF 延迟没有必要，
却会把 after 快照写到「最后一条」记录上（TL-06）。

1. 以下位置把
   ```ts
   if (typeof requestAnimationFrame !== 'undefined') { requestAnimationFrame(() => get().captureNextState()); }
   else { Promise.resolve().then(() => get().captureNextState()); }
   ```
   统一替换为同步的 `get().captureNextState();`：
   `store/actions/addItem.ts:44-53`、`detachAudio.ts:65-73`、`moveItem.ts:42-50`、
   `removeItem.ts:38-46,80-88`、`resizeItem.ts:54-62`、`setCameraMotion.ts:42-50`、
   `splitItem.ts:80-88`、`swapItems.ts:33-41`、`trackActions.ts:292-300`、
   `store/slices/dragSlice.ts:184-188,200-204,215-219`。
2. `HistoryService.captureAfterState`（`HistoryService.ts:151-158`）增加防御：仅当
   `this._historyIndex === this._history.length - 1`（最后一条未被撤销）时写入，否则直接返回。
3. 更新 `historySlice.ts:9-11,33` 与 `HistoryService.ts:143-150` 的注释，删去「next render frame」表述。

#### S3 快捷键归属判定

在 `src/components/video/timeline/shortcutOwnership.ts` 追加两个纯函数（与现有
`shouldTimelineHandleCopyShortcut` 并列，`__tests__/shortcutOwnership.test.ts` 扩展用例）：

```ts
const MODAL_SELECTOR = '[aria-modal="true"]';
/** 全局空格只让给文本编辑目标（与现有 VideoEditingInterface 空格处理器的排除语义一致）。 */
const SPACE_TEXT_EDITING_SELECTOR = 'input, textarea, [contenteditable="true"]';

/** 事件已被下层消费，或焦点/目标位于模态对话框内时，时间轴快捷键不处理。 */
export function shouldTimelineHandleKeyEvent(
  event: Pick<KeyboardEvent, 'defaultPrevented' | 'target'>,
  activeElement: Element | null,
): boolean {
  if (event.defaultPrevented) return false;
  const target = event.target instanceof Element ? event.target : null;
  return !activeElement?.closest(MODAL_SELECTOR) && !target?.closest(MODAL_SELECTOR);
}

/**
 * 全局空格播放/暂停：只把空格让给「文本编辑目标」与「模态对话框」。
 * 刻意不看 defaultPrevented、不把按钮/片段当作空格归属者（v2 RV-04）：片段根节点
 * tabIndex=0 且对空格 preventDefault 以完成选中，点选片段或点过工具栏按钮后按空格
 * 仍应播放——这是剪辑软件的核心约定，也是现有行为。
 */
export function shouldGlobalSpaceTogglePlayback(
  event: Pick<KeyboardEvent, 'target'>,
): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return false;
  return !target.closest(SPACE_TEXT_EDITING_SELECTOR) && !target.closest(MODAL_SELECTOR);
}

export type TimelineShortcut =
  | 'undo' | 'redo' | 'copy' | 'export' | 'toggle-cut'
  | 'camera-motion' | 'effect' | 'transition' | 'subtitles'
  | 'delete' | 'deselect';

/** 会改写时间轴的快捷键；S4 外部编辑锁生效时一律吞掉。 */
export const MUTATING_TIMELINE_SHORTCUTS: ReadonlySet<TimelineShortcut> = new Set<TimelineShortcut>([
  'undo', 'redo', 'toggle-cut', 'camera-motion', 'effect', 'transition', 'subtitles', 'delete',
]);

/**
 * 纯键位解析（TL-08 / v2 RV-19）：按 key.toLowerCase() 归一（CapsLock 不再影响字母键），
 * 裸字母键在交互控件聚焦或按键自动重复（repeat）时不触发。
 */
export function resolveTimelineShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'repeat'>,
  isInteractiveFocus: boolean,
): TimelineShortcut | null {
  const key = event.key.toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (ctrl && key === 'y') return 'redo';
  if (ctrl && key === 'c') return 'copy';
  if (ctrl && key === 'e') return 'export';
  if (ctrl && key === 'x') return 'toggle-cut';
  const isBareLetter = !ctrl && !event.shiftKey && !event.altKey && !isInteractiveFocus && !event.repeat;
  if (isBareLetter && key === 'm') return 'camera-motion';
  if (isBareLetter && key === 'e') return 'effect';
  if (isBareLetter && key === 't') return 'transition';
  if (isBareLetter && key === 's') return 'subtitles';
  if (key === 'delete' || key === 'backspace') return 'delete';
  if (key === 'escape') return 'deselect';
  return null;
}
```

说明：非模态的 Agent 浮窗（`AgentChatFloatingPanel.tsx:84` 仅 `role="dialog"`）不受影响；
AI 混剪两个弹窗、`ui/Modal` 与 `ui/ConfirmationDialog` 均带 `aria-modal="true"`。React 19 根容器监听先于
document 监听执行，因此**时间轴快捷键判定**能看到子组件的 `preventDefault()`：`TimelineItem` 对 Enter / 空格 / Escape
调用，对 Delete / Backspace 不调用，所以 Delete 删除片段不受影响（已核对 `TimelineItem.tsx:335-367`）。
**全局空格不使用 `defaultPrevented`**（见上方函数注释，RV-04）。`TimelinePanel.handleKeyDown` 的处理顺序改为：
`isTextInput` → `shouldTimelineHandleKeyEvent` → `resolveTimelineShortcut(e, isInteractive)` → S4 锁判定 →
`switch` 执行原有分支体。各分支体保持不变，例如复制前的 `shouldTimelineHandleCopyShortcut`、Delete 仅在有选中时
`preventDefault`。

#### S4 外部编辑锁（v2 新增，RV-05）

S1 之前每次 Agent 操作都会 `clearHistory()`，执行期间 Ctrl+Z 实际无效。S1 把 Agent 操作接入撤销栈后，执行中的
Ctrl+Z / Delete / S 等键盘改写（`agent-timeline-lock-overlay` 只挡指针，挡不住 document 级快捷键）会让客户端时间轴
与服务端 Agent 的本地状态分叉，并污染本轮补丁。因此 S4 必须与 S1 同组落地：

1. `store/slices/uiSlice.ts`（F48）新增 `externalEditLock: 'agent' | null`（初值 `null`）与
   `setExternalEditLock(lock: 'agent' | null): void`。
2. `store/slices/historySlice.ts`：`undo()` / `redo()` 开头 `if (get().externalEditLock !== null) return;`
   （行为保证放在 store 层，不只依赖 UI 置灰）。
3. `VideoEditingInterface.tsx`：
   `useEffect(() => { useTimelineStore.getState().setExternalEditLock(agent.agentIsExecuting ? 'agent' : null); }, [agent.agentIsExecuting]);`
   卸载清理中调用 `setExternalEditLock(null)`。
4. `TimelinePanel.tsx`：`resolveTimelineShortcut` 的结果属于 `MUTATING_TIMELINE_SHORTCUTS` 且锁生效时，
   `e.preventDefault()` 后返回。复制（Ctrl+C）、导出（Ctrl+E）、Escape 取消选择与空格播放不受影响。
5. `TimelineToolbar.tsx`：selector 增加 `isEditLocked: state.externalEditLock !== null`；撤销、重做、删除、剪切与添加字幕
   按钮的 `disabled` 追加 `|| isEditLocked`；锁定时这些按钮的 `title` 使用 `t.timeline.messages.editLockedByAgent`。
6. AI 混剪的 `blockedByAgent` 守卫与 Agent 遮罩保持不变；锁只在 `agentIsExecuting` 为 true 时存在。

### 3.3 AI 混剪 · 后端（AM-04 / AM-05 / AM-06 / AM-07 / AM-09）

#### AM-04 使用「模型设置」解析视频剪辑模型

**根因**：`AIMixedEditingService.__init__`（`ai_mixed_editing_service.py:25-34`）只读
`settings.video_cut_llm_*`；而 `model_settings_service.get_effective_config(VIDEO_CUT)`
（`model_settings_service.py:598`，DB 优先、env 回退）在全后端没有任何 service 调用
（仅 `config_router.py:62`、`model_settings_router.py:195`）。另外 env 回退时
`model_name=settings.video_cut_llm_model` 不回退到 `llm_model`；URL 回退到 `LLM_API_URL` 时
`api_type` 却仍取 `VIDEO_CUT_LLM_API_TYPE`（默认 openai）→ 可能以 openai 格式请求 anthropic 端点。

**修复**：
1. `ai_mixed_editing_service.py`：
   - 构造函数改为 `def __init__(self, llm_config: Optional[LLMCallConfig] = None) -> None`。
     `llm_config is None` 时保持旧行为（读 env，缺失抛 `ValueError`）——
     `tests/test_ai_mixed_editing_video_analysis.py:156`、`tests/test_video_analysis_data_flow.py:32`
     以无参方式构造，必须继续可用。实例属性统一为 `self.llm_config: LLMCallConfig`。
   - 新增异步工厂：
     ```python
     @classmethod
     async def create(cls) -> "AIMixedEditingService":
         resolved = await model_settings_service.get_effective_config(ModelFunctionType.VIDEO_CUT)
         config = LLMCallConfig(
             api_url=resolved.api_url or "",
             api_key=resolved.api_key or "",
             model=resolved.model_name or "",
             api_type=normalize_api_type(resolved.api_type),
         )
         if not (config.api_url and config.api_key and config.model):
             raise AIMixModelNotConfiguredError("No model is assigned to video editing")
         return cls(config)
     ```
     导入 `from app.services.model_settings_service import model_settings_service` 与
     `from app.models.model_settings_models import ModelFunctionType`（service→service，无环）。
   - `_generate_simplified_timeline` 中构造 `LLMCallConfig(...)` 处直接使用 `self.llm_config`。
2. `model_settings_service.py:647-652` 的 `ModelFunctionType.VIDEO_CUT` env 回退改为**按组整体回退**：
   ```python
   ModelFunctionType.VIDEO_CUT: (
       (settings.video_cut_llm_api_url,
        ***REMOVED*** or settings.llm_api_key,  # v2 RV-10：保留旧 .env 的 key 回退
        settings.video_cut_llm_model or settings.llm_model, settings.video_cut_llm_api_type)
       if settings.video_cut_llm_api_url
       else (settings.llm_api_url, settings.llm_api_key, settings.llm_model, settings.llm_api_type)
   ),
   ```
3. 异常类型（`ai_mixed_editing_service.py` 顶部定义，供 router 映射）：
   ```python
   class AIMixError(Exception):
       error_code = "AI_MIX_INTERNAL"
       status_code = 500

   class AIMixModelNotConfiguredError(AIMixError):
       error_code = "AI_MIX_MODEL_NOT_CONFIGURED"
       status_code = 503

   class AIMixUpstreamError(AIMixError):
       error_code = "AI_MIX_LLM_UPSTREAM_FAILED"
       status_code = 502

   class AIMixPlanUnparseableError(AIMixError):
       error_code = "AI_MIX_PLAN_UNPARSEABLE"
       status_code = 422
   ```
   `call_chat` 抛出的任何异常包装为 `AIMixUpstreamError(str(error)[:300])`；解析两次失败抛
   `AIMixPlanUnparseableError`；`generate_mixed_editing`（`:477-480`）改为
   `except AIMixError: raise`，其余异常 `logger.error(..., exc_info=True)` 后包装为 `AIMixError`。
4. `AIVideoGenerateService`（`ai_video_generate_service.py:21-31`）同样绕过模型设置，但前端零调用
   （`src/` 中 grep `ai-video-generate` 无结果），本轮不改，列入附录 A。

#### AM-05 稳健的 LLM JSON 提取 + 宽松 schema + 一次修复重试

1. 新文件 `backend-services/basic-service/app/services/llm_json.py`（仓库内无同类 helper）：
   ```python
   _THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
   _FENCE = re.compile(r"```[a-zA-Z]*\s*\n?(.*?)```", re.DOTALL)

   def extract_json_object(content: str) -> Dict[str, Any]:
       """Return the first complete JSON object in LLM text; raise ValueError if none."""
       text = _THINK_BLOCK.sub("", content or "").strip()
       fence = _FENCE.search(text)
       if fence:
           text = fence.group(1).strip()
       start = text.find("{")
       if start < 0:
           raise ValueError("no JSON object in LLM output")
       depth, in_string, escaped = 0, False, False
       for index in range(start, len(text)):
           char = text[index]
           if in_string:
               if escaped:
                   escaped = False
               elif char == "\\":
                   escaped = True
               elif char == '"':
                   in_string = False
               continue
           if char == '"':
               in_string = True
           elif char == "{":
               depth += 1
           elif char == "}":
               depth -= 1
               if depth == 0:
                   return json.loads(text[start:index + 1])
       raise ValueError("unterminated JSON object in LLM output")
   ```
2. `ai_mixed_editing_models.py`：
   - `VideoSegmentModel / AudioSegmentModel / ImageSegmentModel / SimplifiedTimelineModel` 的
     `model_config` 由 `{"extra": "forbid"}` 改为 `{"extra": "ignore"}`（`:84,98,108,119`）。
     `AIMixedEditingRequest / AIMixedEditingResponse` 保持 `forbid`（前后端自有契约）。
   - `AudioSegmentModel.volume` 改为 `float = Field(default=100.0, description="百分比 0-200，100=原音量")`，并加：
     ```python
     @field_validator("volume", mode="before")
     @classmethod
     def normalise_volume(cls, value: Any) -> float:
         try:
             volume = float(value)
         except (TypeError, ValueError):
             return 100.0
         if 0 < volume <= 3:  # LLM expressed a multiplier (1.0 = original loudness)
             volume *= 100
         return max(0.0, min(volume, 200.0))
     ```
3. `_generate_simplified_timeline`（`ai_mixed_editing_service.py:482-597`）改为最多 2 次尝试，
   签名改为 `-> Tuple[SimplifiedTimelineModel, SanitizeReport]`（v2 RV-12）：
   ```python
   # sanitize 在 try 内调用：「全部片段被丢弃」的 ValueError 同样触发一次修复重试。
   messages = [{"role": "user", "content": self._create_prompt(materials)}]
   last_error: Optional[Exception] = None
   for attempt in range(2):
       content = await self._call_llm(messages, task_id)  # call_chat + wrap into AIMixUpstreamError
       try:
           simplified = SimplifiedTimelineModel(**extract_json_object(content))
           if simplified.total_duration <= 0:
               raise ValueError("total_duration must be positive")
           report = self.timeline_parser.sanitize_simplified_timeline(simplified, materials)
           return simplified, report
       except (ValueError, json.JSONDecodeError) as error:  # pydantic ValidationError is a ValueError
           last_error = error
           logger.warning(
               "AI mix plan unparseable",
               extra={"task_id": task_id, "attempt": attempt + 1,
                      "error": str(error)[:300], "llm_content_head": content[:500]},
           )
           messages += [
               {"role": "assistant", "content": content},
               {"role": "user", "content": REPAIR_PROMPT.format(error=str(error)[:200])},
           ]
   raise AIMixPlanUnparseableError(str(last_error)[:300])
   ```
   常量 `REPAIR_PROMPT = "上一次输出无法解析为有效 JSON（错误：{error}）。请只输出一个符合示例结构的 JSON 对象，不要任何解释或代码块标记。"`。
   删除 `settings.debug` 下的 `print` 调试块（`:502-529,538-544,565-569,582-585,627-639`），
   改为 `logger.debug` 输出计数与截断内容（Clean Code：无 stray debug output）。
4. 规整与校验移到 AM-06 的 `sanitize_simplified_timeline`；`_generate_simplified_timeline` 不再调用
   `validate_simplified_timeline`（原 `:587-588`）。

#### AM-06 片段规整 `sanitize_simplified_timeline`

`timeline_parser_service.py` 新增（`validate_simplified_timeline` 保留，供 `AIVideoGenerateService` 使用）：

```python
MIN_SEGMENT_SECONDS = 0.1
OVERLAP_EPSILON = 1e-3

@dataclass
class SanitizeReport:
    dropped: List[str] = field(default_factory=list)
    adjusted: List[str] = field(default_factory=list)

    def warnings(self) -> List[str]:
        return [*self.dropped, *self.adjusted]

def sanitize_simplified_timeline(
    self, timeline: SimplifiedTimelineModel, materials: List[MaterialItemModel]
) -> SanitizeReport: ...
```

处理顺序（每一步向 report 追加一条可读描述，如 `"video_segments[2]: material xxx not found, dropped"`；
单个函数超过 60 行时拆为 `_reroute_by_material_type / _normalise_source_range / _clip_to_total /
_resolve_lane_overlaps` 四个私有方法）：

1. `by_id = {m.id: m for m in materials}`。
2. **重路由 / 丢弃**：`video_segments` 中引用 `type == "image"` 的片段移入 `image_segments`
   （`ImageSegmentModel(material_id=..., start_time=..., duration=...)`）；引用不存在素材或类型不符
   （video 段非 video、audio 段非 audio、image 段非 image）的片段丢弃。
3. **源区间规整**（video / audio）：
   `source = material.duration if material.duration and material.duration > 0 else None`；
   `clip_start = max(0.0, seg.clip_start or 0.0)`；若 `source is not None and clip_start >= source` → 丢弃；
   `clip_end = seg.clip_end if seg.clip_end is not None else clip_start + seg.duration`；
   `source is not None` 时 `clip_end = min(clip_end, source)`；
   `seg.duration = min(seg.duration, clip_end - clip_start)`；`seg.clip_start = clip_start`；
   `seg.clip_end = clip_start + seg.duration`（保证 INV-3：`duration == clipEnd - clipStart`）。
4. `seg.start_time = max(0.0, seg.start_time)`。
5. **总时长裁剪**：`start_time + duration > total_duration` 时 `seg.duration = total_duration - seg.start_time`
   并同步 `clip_end`；`seg.duration < MIN_SEGMENT_SECONDS` → 丢弃（取代原 `max(0.0, ...)` 保留 0 时长）。
6. **同道去重叠**：分道规则 = video 一道、image 一道、audio 按 `seg.track` 分道。每道按 `start_time`
   稳定排序，`seg.start_time < prev_end - OVERLAP_EPSILON` 时置 `seg.start_time = prev_end` 并记 adjusted；
   后移后再执行第 5 步的裁剪 / 丢弃。
7. 至少剩一个片段时 `timeline.total_duration = max(片段 end)`；全部被丢弃时抛
   `ValueError("no usable segments after sanitising")`，由 AM-05 的重试循环捕获（sanitize 需在循环内调用，
   见下方串联），第二次仍失败则 422。

`validate_simplified_timeline` 在 `:517 / :538 / :559` 的 `max(0.0, new_duration)` 之后，将时长
`< MIN_SEGMENT_SECONDS` 的片段从对应列表移除。`tests/test_timeline_validation_fix.py:184-224` 两个
`..._gets_zero_duration` 用例改名为 `..._is_removed` 并断言对应列表为空。

**串联**（v2 RV-12 统一口径）：`_generate_simplified_timeline` 按 AM-05 伪代码返回 `(simplified, report)`；
`generate_mixed_editing`（`:434-480`）改为 `simplified, report = await self._generate_simplified_timeline(materials, task_id)`，
再调用 `self._convert_to_full_timeline(simplified, materials, task_id, warnings=report.warnings())`。
`_convert_to_full_timeline`（`:599-625`）新增关键字参数 `warnings: Optional[List[str]] = None`，并透传给
`self.timeline_parser.parse_simplified_timeline(simplified_timeline=..., materials=..., task_id=..., warnings=warnings)`。
`parse_simplified_timeline` 新增关键字参数 `warnings: Optional[List[str]] = None`，写入
`timeline_data["metadata"]["warnings"]`（`timeline_import_models.py` 各模型 `ConfigDict(populate_by_name=True)`，
未禁止额外字段，导入端兼容）。

#### AM-07 可读的错误契约

`ai_mixed_editing_router.py` 所有 `raise HTTPException(detail=dict)`（`:49-65,74-81,123-130,140-147`）
改为返回 `ErrorResponse`（`app/models/base_models.py:33`，`timestamp` 已有 `field_serializer`；
v2 统一使用 `model_dump(mode="json")`，不依赖 serializer 的返回类型，RV-11）：

```python
def _error_response(status_code: int, error_code: str, message: str,
                    task_id: Optional[str], stage: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(
            success=False, message=message, error_code=error_code,
            error_details={"taskId": task_id, "stage": stage},
        ).model_dump(mode="json"),
    )
```

| 场景 | status | error_code | message（英文技术描述；前端按 code 显示本地化文案） | stage |
|---|---|---|---|---|
| taskId 为空 / materials 为空 | 400 | `AI_MIX_INVALID_REQUEST` | `taskId and at least one material are required` | `validate` |
| `AIMixModelNotConfiguredError` | 503 | `AI_MIX_MODEL_NOT_CONFIGURED` | `No model is assigned to video editing` | `configure` |
| `AIMixUpstreamError` | 502 | `AI_MIX_LLM_UPSTREAM_FAILED` | `The video editing model request failed: <截断 300 字>` | `plan` |
| `AIMixPlanUnparseableError` | 422 | `AI_MIX_PLAN_UNPARSEABLE` | `The model returned an unusable editing plan` | `plan` |
| 其他 `Exception` | 500 | `AI_MIX_INTERNAL` | `Unexpected error while generating the editing plan` | `internal` |

服务实例化改为 `service = await AIMixedEditingService.create()`（在 try 内，异常按上表映射，
`AIMixError` 子类直接读 `status_code / error_code`）；删除 router 中 `settings.debug` 的 `print` 块
（`:37-44,100-117`），以 `logger.debug` 记录素材数量。`AIMixedEditingErrorResponse`
（`ai_mixed_editing_models.py:122-129`）失去所有引用后删除。所有错误日志 `exc_info=True`，
且不得输出 `api_key`（不记录 `LLMCallConfig` 对象）。

#### AM-09 默认音量归一

1. 提示词 `ai_mixed_editing_service.py:318-319` 改为：
   `- volume 为百分比（0-200），100 表示原音量；旁白/配音用 100，背景音乐建议 20-40`；
   示例 `:67` 的 `200` → `100`，`:76` 的 `150` → `30`。
2. `timeline_parser_service.py:212` 改为 `"volume": round(max(0.0, min(segment.volume, 200.0)) / 100.0, 3)`；
   `:348` 与 `:366` 的轨道 `"volume": 200` → `100`。
3. 同类「自动建音频轨默认 200」一并归一为 `volume: 100`：`src/lib/video-editing-agent/OperationApplier.ts:442`、
   `src/lib/video-editing-agent/tools/addToTrack.ts:90` 自动建轨对象中的
   `volume: trackType === 'audio' ? 200 : 100`。

### 3.4 AI 混剪 · 前端（AM-01 / AM-02 / AM-03 / AM-08 / AM-10）

#### 3.4.1 目标链路

```
MaterialsPanel「AI混剪」→ aiMix.openModeModal()
  → AIMixingModeSelectionModal（显示「将替换的轨道 / 保留的轨道」提示）
  → aiMix.start(mode)                                  (新 hook useAIMixedEditing)
      stage=analyzing  analyzeVideosInBatch(videos, { mode, signal })
      stage=planning   http.post /api/ai-mixed-editing  { signal, timeoutMs: 600_000 }
      stage=applying   http.post /api/timeline-import   { signal, timeoutMs: 300_000 }
                       mergeAiMixTimeline({ current: store.exportToData(), imported, knownMaterialIds })
                       replaceTimelineAction(get, merged.timeline, 'ai-mix')   ← 1 步可撤销
      stage=done       toast「已生成剪辑方案，可按 Ctrl+Z 撤销」+ 丢弃片段警告
  取消：aiMix.cancel() → AbortController.abort() → stage=cancelled，时间轴零改动
```

AI 混剪不再经过 `handleImportComplete` 与 React `currentTimelineState` 往返；store 是唯一真相源，
`TimelinePanel` 的 store 订阅（`TimelinePanel.tsx:308-329`）会自动把新状态回推给
`onTimelineStateChange` 与 `timelineComposition.handleTimelineStateChange`。

#### 3.4.2 AM-01 / AM-02 / AM-03 纯函数合并 `mergeAiMixTimeline`

新文件 `src/components/video/lib/aiMix/mergeAiMixTimeline.ts`（纯函数，无 React、无 store 依赖）：

```ts
import type { TimelineData, TrackData, TimelineItemData } from '@/components/video/timeline/domain';
import type { TimelineState } from '@/types';

export const MIN_AI_CLIP_SECONDS = 0.1;

export interface AiMixMergeInput {
  current: TimelineData;                     // useTimelineStore.getState().exportToData()
  imported: TimelineState;                   // importResult.importedData.timelineState
  knownMaterialIds: ReadonlySet<string>;     // materialManagement.allMaterials 的 id
}

export type AiMixDropReason = 'unknown-material' | 'too-short';

export interface AiMixMergeResult {
  timeline: TimelineData;
  replacedTrackIds: string[];                // 内容被 AI 结果替换的轨道
  createdTrackIds: string[];                 // 为承载 AI 结果新建的轨道
  skippedLockedTrackIds: string[];           // 目标轨道被锁定，未替换
  droppedItems: Array<{ itemId: string; reason: AiMixDropReason }>;
  renamedItemIds: Record<string, string>;    // 与现有 id 冲突而改名的条目
}

export function mergeAiMixTimeline(input: AiMixMergeInput): AiMixMergeResult;
```

规则（每条对应一个单测，见 §7）：

- **R1 目标轨道解析**（只处理 `items.length > 0` 的导入轨道；导入的 subtitle 轨道忽略）：
  - 导入轨道 id 以 `image-track` 开头 → 当前 `image-track-1`；不存在则取第一个 id 以
    `image-track` 开头的轨道；仍无则新建（克隆导入轨道结构，`id='image-track-1'`、`type='video'`、
    `order = max(order)+1`、`volume=100`、`isLocked=false`）。
  - 导入轨道 `type==='video'`（非 image）→ 当前 `video-track-1`；不存在则取按 `order` 排序后第一个
    `type==='video' && !id.startsWith('image-track')` 的轨道；仍无则新建 `video-track-1`。
  - 导入轨道 `type==='audio'` → 从导入 id 解析序号 `n = /audio-track-(\d+)$/` 捕获值（缺省 1）；
    目标 = 当前 `audio-track-${n}`；不存在则取按 `order` 排序后第 n 个音频轨；仍无则新建
    `audio-track-${n}`（`volume=100`）。**不再把多条音频轨扁平化到音频轨 1**（修 AM-03）。
- **R2 只替换被命中的轨道**：未被任何导入轨道命中的当前轨道（字幕轨、未使用的音频轨、用户自建的
  其他视频轨）原样保留，**绝不清空、绝不复制**（修 AM-01 / AM-02）。
- **R3 锁定轨道**：目标轨道 `isLocked` 时不替换，记入 `skippedLockedTrackIds`。
- **R4 条目规整**：`trackId = 目标轨道 id`；`materialId` 存在但不在 `knownMaterialIds` → 丢弃
  (`unknown-material`)；`duration < MIN_AI_CLIP_SECONDS` → 丢弃 (`too-short`)；`startTime = max(0, startTime)`；
  `volume = clamp(volume ?? 1, 0, 2)`。
- **R5 ID 去重**：维护「保留轨道中所有 item id + 已放入的 id」集合；冲突时依次尝试 `${id}-2`、`${id}-3`…，
  记入 `renamedItemIds`。
- **R6 同轨去重叠**：目标轨道内按 `startTime` 稳定排序，`startTime < prevEnd - 1e-3` 时后移到 `prevEnd`。
- **R7 总时长**：`totalDuration = max(所有轨道 item 的 startTime + duration)`，无 item 为 0；
  `currentTime = 0`；`zoomLevel / scrollLeft / snapToGrid / gridSize / playbackRate` 取自 `current`，
  `isPlaying = false`。
- 文件 ≤ 200 行；每个函数 ≤ 60 行（R1 抽 `resolveTargetTrack`，R4-R6 抽 `normaliseItems`）。

`VideoEditingInterface.tsx` 中 `handleImportComplete` 的 AI 合并分支（`:1750-1861`）删除，
签名改回 `(importedMaterials: MaterialItem[], importedTimelineState: TimelineState) => void`
（与 `TimelinePanel.tsx:69` 的 prop 类型一致）；`isAIMixedEditing` 参数、`:1885-1892` 的分支日志一并删除。

#### 3.4.3 AM-08 hook `useAIMixedEditing` + 进度弹窗重做

新文件 `src/components/video/hooks/useAIMixedEditing.ts`：

```ts
export type AiMixStage = 'idle' | 'analyzing' | 'planning' | 'applying' | 'done' | 'error' | 'cancelled';

export interface AiMixRunState {
  stage: AiMixStage;
  videoCount: number;          // analyzing 阶段展示「正在分析 N 个视频」
  warningCount: number;        // done 阶段：丢弃/调整片段数
}

export interface UseAIMixedEditingOptions {
  taskId: string;
  getMaterials: () => MaterialItem[];     // () => materialManagement.allMaterials（通过 ref 读最新值）
  isAgentExecuting: boolean;
}

export interface UseAIMixedEditingReturn {
  runState: AiMixRunState;
  isModeModalOpen: boolean;
  timelineImpact: AiMixTimelineImpact;    // 供模式弹窗展示，见 AM-01 确认
  openModeModal: () => void;
  closeModeModal: () => void;
  start: (mode: AIMixingMode) => Promise<void>;
  cancel: () => void;
}

export interface AiMixTimelineImpact {
  replaceableItemCount: number;           // video-track-1 / image-track-1 / 所有音频轨 当前 item 数
  preservedTrackNames: string[];          // 字幕轨等不会被改动的非空轨道名
}
```

内部实现要点（`showSuccess/showError/showWarning/showInfo` 取自 `useNotification()`，`t` 取自 `useLocale()`）：

1. `openModeModal()`：`getMaterials().length === 0` → `showError(t.aiMixingProgress.errorNoMaterials)`；
   `isAgentExecuting` → `showWarning(t.aiMixingProgress.blockedByAgent)`；否则计算 `timelineImpact`
   （读 `useTimelineStore.getState().tracks`）并打开弹窗。
2. `start(mode)`：
   - 守卫：`activeRunRef.current === true` 时直接返回（v2 RV-18：不读可能过期的 React state，同帧双击不会启动两次）；
     `isAgentExecuting` 时提示并返回；通过守卫后立即 `activeRunRef.current = true`。
   - `const runId = ++runIdRef.current; const controller = new AbortController(); controllerRef.current = controller;`
     关闭模式弹窗，`setRunState({ stage: 'analyzing', videoCount, warningCount: 0 })`。
   - **analyzing**：`videos = materials.filter(m => m.type === 'video' && m.downloadStatus !== 'downloading')`；
     非空时 `await analyzeVideosInBatch(videos, { maxRetries, retryDelayMs, mode, signal: controller.signal }, taskId)`；
     分析失败只 `console.warn`（保持原「分析失败继续混剪」语义），但 `controller.signal.aborted` 时抛出中止。
   - **planning**：`http.post('/api/ai-mixed-editing', { taskId, materials: toAiMixMaterialDtos(materials) }, { timeoutMs: 600_000, signal })`；
     响应缺 `timelineData` → `throw new Error(t.aiMixingProgress.errorInvalidResponse)`。
   - **applying**：`http.post('/api/timeline-import', { taskId, fileContent: JSON.stringify(result.timelineData), fileName: \`ai-mixed-editing-${Date.now()}.json\`, mergeMode: 'replace', preserveIds: true }, { timeoutMs: 300_000, signal })`；
     校验 `importResult.success && importResult.importedData?.timelineState`；
     `if (runId !== runIdRef.current) return;`（过期结果丢弃）；
     `const merged = mergeAiMixTimeline({ current: useTimelineStore.getState().exportToData(), imported, knownMaterialIds: new Set(getMaterials().map(m => m.id)) })`；
     `replaceTimelineAction(() => useTimelineStore.getState(), merged.timeline, 'ai-mix')`；
     `useTimelineStore.getState().setCurrentTime(0)`。
   - **done**：`warningCount = merged.droppedItems.length + (result.timelineData.metadata?.warnings?.length ?? 0)`；
     `showSuccess(t.aiMixingProgress.success)`（文案含「可按 Ctrl+Z 撤销」）；`warningCount > 0` 时追加
     `showWarning(t.aiMixingProgress.partialWarning.replace('{count}', String(warningCount)))`；
     `merged.skippedLockedTrackIds.length > 0` 时 `showWarning(t.aiMixingProgress.lockedTracksSkipped)`；
     `doneTimerRef.current = window.setTimeout(() => setRunState(idle), 1200)`。
   - `catch (error)`：`controller.signal.aborted || isAbortError(error)` → `stage='cancelled'`，
     `showInfo(t.aiMixingProgress.cancelled)`，随即回 `idle`；否则 `stage='error'`、
     `showError(mapAiMixError(error, t))`、`console.error('[useAIMixedEditing] run failed', { taskId, stage, error })`，随即回 `idle`。
   - `finally`：`if (controllerRef.current === controller) { controllerRef.current = null; activeRunRef.current = false; }`。
3. `cancel()`：`controllerRef.current?.abort()`。
4. 卸载清理 `useEffect(() => () => { controllerRef.current?.abort(); runIdRef.current++; clearTimeout(doneTimerRef.current); }, [])`。
5. `mapAiMixError(error, t)`（同文件导出，便于测试）：
   `ApiError` 且 `code` ∈ {`AI_MIX_MODEL_NOT_CONFIGURED`→`t.aiMixingProgress.errorModelNotConfigured`，
   `AI_MIX_LLM_UPSTREAM_FAILED`→`errorUpstream`，`AI_MIX_PLAN_UNPARSEABLE`→`errorUnparseable`，
   `AI_MIX_INVALID_REQUEST`→`errorNoMaterials`}；`TimeoutError`→`errorTimeout`；
   其余 `ApiError`→`t.aiMixingProgress.errorGeneric.replace('{message}', error.message)`；其它 `Error`→同上。
6. `toAiMixMaterialDtos(materials)`（同文件导出）：只保留 `type ∈ {video,audio,image}`；字段
   `id,name,type,format: format || '',size: size ?? 0,duration,width,height,url,serverUrl,
   thumbnailUrl（以 data:/blob: 开头则置 undefined）,description,tags,createdAt: toIsoString(createdAt)`；
   `metadata` 只挑 `segment_id, segment_number, video_analysis`（避免把 `srt_content / sentence_timing /
   subtitles` 等大字段发给 LLM 服务；`MaterialItemModel` 必填字段 `format/size/createdAt/url` 均有值）。

`parallelVideoAnalysis.ts`：`ParallelAnalysisOptions`（`:65-71`）新增 `signal?: AbortSignal`；
`analyzeVideosInBatch` 在创建内部 `controller`（`:601`）后执行
`options.signal?.addEventListener('abort', () => controller.abort(), { once: true })`，
且 `options.signal?.aborted` 时立即 `controller.abort()`。

`VideoEditingInterface.tsx` 改动：
- 删除 `isAIMixing / aiMixingProgress / isAIMixingModeModalOpen` 三个 state（`:183-194`）及其在持久化
  effect 中的读写与比较（`:257-259,287-289,307-309,324-326,341-343`）。`normaliseUiState` 已剥离这些键
  （`src/lib/api/videoProjects.ts` 的 `normaliseUiState`），旧项目中残留值无害；`VideoEditingTaskContent['uiState']`
  类型字段保留为可选以兼容旧数据。
- 删除 `handleAIMixedEditing / executeAIMixedEditing / handleAIMixingModeConfirm / handleAIMixingModeClose`
  （`:2169-2451`），改为
  `const aiMix = useAIMixedEditing({ taskId, getMaterials: () => allMaterialsRef.current, isAgentExecuting: agent.agentIsExecuting });`
  （`allMaterialsRef` 为新 ref，每次渲染同步 `materialManagement.allMaterials`；hook 须声明在 `agent` 之后）。
- `MaterialsPanel` 的 `onAIMixedEditing={aiMix.openModeModal}`；
  弹窗渲染（`:2949-2968`）改为：
  ```tsx
  <AIMixingModeSelectionModal
    isOpen={aiMix.isModeModalOpen}
    impact={aiMix.timelineImpact}
    onClose={aiMix.closeModeModal}
    onConfirm={aiMix.start}
  />
  <AIMixingProgressModal runState={aiMix.runState} onCancel={aiMix.cancel} />
  ```
- 这使 `VideoEditingInterface.tsx` 净减约 300 行（文件仍超 1000 行上限，属历史存量，本轮不做额外拆分）。

**`AIMixingProgressModal.tsx` 重写**（props：`{ runState: AiMixRunState; onCancel: () => void }`）：
- `isOpen = stage ∈ {analyzing, planning, applying, done}`；保留现有 200ms 进出场动画。
- 结构：标题 `t.aiMixingProgress.title` + 三步步骤条（`stepAnalyze / stepPlan / stepApply`），
  已完成步骤显示勾选图标、当前步骤显示旋转指示器（`animate-spin`，尊重 `motion-reduce:animate-none`）、
  未开始步骤为灰色圆点；**不显示百分比**（后端无真实进度，杜绝伪进度）。
  analyzing 步骤副文本 `t.aiMixingProgress.analyzingVideos.replace('{count}', videoCount)`；
  planning 副文本 `t.aiMixingProgress.planningHint`（「通常需要 30-90 秒」）。
- 当前阶段文字容器 `role="status" aria-live="polite"`；对话框 `role="dialog" aria-modal="true"
  aria-labelledby aria-busy={stage !== 'done'}`。
- 「取消」按钮（`t.aiMixingProgress.cancel`，次要按钮样式）在 `stage ∈ {analyzing, planning, applying}` 时显示，
  打开时自动聚焦该按钮；Esc 触发 `onCancel`；背景点击不关闭（保持现状）。
- done 阶段显示成功图标与 `t.aiMixingProgress.done`，1.2s 后由 hook 关闭。
- 所有中文硬编码（`:47-53,125,154,162,171`）移除，改用 i18n。

#### 3.4.4 AM-10 模式选择弹窗（含 AM-01 影响提示）

`AIMixingModeSelectionModal.tsx`：
1. 新 prop `impact: AiMixTimelineImpact`。`impact.replaceableItemCount > 0` 时在内容区顶部渲染提示条
   （`role="note"`，warning 语义色 `bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300`）：
   标题 `t.aiMixingModal.replaceWarningTitle`，正文
   `t.aiMixingModal.replaceWarningBody.replace('{count}', ...)`，若 `preservedTrackNames` 非空追加
   `t.aiMixingModal.preservedTracks.replace('{tracks}', names.join('、'))`，末尾固定一句「完成后可按 Ctrl+Z 撤销」。
   确认按钮文案保持 `t.aiMixingModal.confirm`。
2. 焦点管理：`isAnimating` 变为 true 后 `requestAnimationFrame(() => (selectedMode === 'quick' ? quickRef : proRef).current?.focus())`；
   打开前记录 `document.activeElement`，关闭动画结束后恢复焦点。
3. 关闭按钮加 `aria-label={t.aiMixingModal.cancel}` 与 `type="button"`；两个底部按钮加 `type="button"`。
4. 帧间隔输入：新增 `frameIntervalInput` 字符串 state，`onChange` 只写字符串；`onBlur` 与 `handleConfirm`
   时 `clampFrameInterval(parseInt(input, 10))`（NaN → 5，范围 [1,30]）并回写字符串与数值 state。
   `clampFrameInterval` 作为同文件导出的纯函数。
5. `handleKeyDown` 中 Enter 仅当事件目标不是 `<input>` 时确认（避免输入框内回车直接开始长任务）。

### 3.5 AI 自动混剪（AS-01 / AS-02）

#### 3.5.1 纯函数排布器 `planScriptAutoMix`

新文件 `src/components/video/lib/aiMix/planScriptAutoMix.ts`：

```ts
export interface AutoMixPlacement {
  material: MaterialItem;
  lane: 'audio' | 'video';
  startTime: number;
  duration: number;
  clipStart: number;
  clipEnd: number;
  segmentNumber: number;
}

export interface AutoMixSegmentReport {
  segmentNumber: number;
  segmentId: string;
  status: 'placed' | 'skipped-no-audio' | 'video-reused' | 'video-looped';
  reusedFromSegment?: number;
}

export interface ScriptAutoMixPlan {
  placements: AutoMixPlacement[];
  segments: AutoMixSegmentReport[];
  ignoredDuplicateMaterialIds: string[];   // 被更新版本取代的旧 TTS / 旧匹配视频
  totalDuration: number;
}

export function planScriptAutoMix(materials: readonly MaterialItem[]): ScriptAutoMixPlan;
```

算法：

1. **分组**：只看 `metadata.segment_id` 为非空字符串且 `metadata.segment_number` 为 number 的
   `audio / video` 素材，按 `segment_id` 分组；组序按 `segment_number` 升序（相同时按首次出现顺序）。
2. **AS-01 去重（音频）**：每组音频取在输入数组（即 `allMaterials`）中**位置最靠后**的一条，其余 id 进
   `ignoredDuplicateMaterialIds`。依据：重新 TTS 产生新 id `audio_${segment.id}_${Date.now()}`
   （`ScriptPanel.tsx:1500`）；`addOrReplaceMaterial` 对新 id 追加到数组末尾、对同 id 原位替换
   （`useMaterialManagement.ts:354-381`），`allMaterials` 就是该数组本身（`:512`），因此数组位置即「最近一次写入」。
   **v2 起不使用 `createdAt`**（RV-07：视频素材由 `{...video, metadata}` 复制而来，`createdAt` 是源素材的创建/上传
   时间而非匹配时间；按它判新，会在重新匹配较早上传的本地素材时选回旧视频）。
3. **AS-01 去重（视频）**：每组视频按 `metadata.video_index_in_segment`（缺省视为 1）分桶，每桶取数组中
   位置最靠后的一条，按 index 升序得到该段视频序列；其余进 `ignoredDuplicateMaterialIds`。
   （`ScriptPanel.tsx:749-765` 为一个段落按序号添加多条视频，重新匹配会写入同序号的新素材。）
4. **计时主轴 = 配音**（AS-02）：
   - 若**所有**组都没有音频：退化为纯视频排布——各段视频按顺序首尾相接、全长上轨，
     段落状态 `placed`。
   - 否则：没有音频的组状态为 `skipped-no-audio`、不上轨（音/视频轨会被 `autoOrganize` 贴紧，
     留空洞必然在下一次手工编辑后错位，因此不允许产生空洞）。
   - 有音频的组：`segDuration = audio.duration > 0 ? audio.duration : 0`（为 0 则同样跳过）。
     音频放置：`startTime = cursor, duration = segDuration, clipStart = 0, clipEnd = segDuration`。
5. **视频覆盖**（仅有音频的组）：候选序列 = 本组视频；为空时复用「前一个有视频的段落」的序列，
   再无则复用「后一个有视频的段落」，状态 `video-reused` 并记 `reusedFromSegment`；仍为空（整个脚本没有视频）
   则只放音频。按序列填充 `remaining = segDuration`：每条 `take = min(video.duration, remaining)`，
   `video.duration` 缺失或 ≤0 的跳过；`take < 0.1` 结束；放置 `startTime = cursor + (segDuration - remaining)`、
   `duration = take`、`clipStart = 0`、`clipEnd = take`；序列用完而 `remaining ≥ 0.1` 时从头循环（状态
   `video-looped`，最多循环 20 条防死循环）。这样视频轨与音频轨在每个段落边界严格对齐且无空洞。
6. `cursor += segDuration`；`totalDuration = cursor`。
7. 纯函数、稳定输出（同输入同输出），文件 ≤ 220 行，函数 ≤ 60 行。

#### 3.5.2 应用到时间轴 `applyScriptAutoMixAction`

新文件 `src/components/video/timeline/store/actions/applyScriptAutoMix.ts`：

```ts
export type ApplyAutoMixResult =
  | { ok: true; replacedItemCount: number }
  | { ok: false; reason: 'no-target-track' | 'track-locked' | 'empty-plan' };

export function resolveAutoMixTargetTracks(tracks: readonly TrackData[]):
  { videoTrackId: string | null; audioTrackId: string | null };

export function applyScriptAutoMixAction(
  get: () => TimelineStore,
  plan: ScriptAutoMixPlan,
): ApplyAutoMixResult;
```

- 目标轨：`video-track-1`（不存在取 `order` 最小的非 image 视频轨）、`audio-track-1`（不存在取 `order`
  最小的音频轨）。只检查排布中实际用到的 lane（`audio` / `video`）：用到的 lane 没有目标轨 →
  `{ ok:false, reason:'no-target-track' }`；用到的目标轨 `isLocked` → `{ ok:false, reason:'track-locked' }`；两者都不写历史。
- 条目构造复用 `ItemPlacementService.createItemFromMaterial(materialData, trackEntity)`
  （`ItemPlacementService.ts:183-206`，保证颜色、url/cacheUrl/storageKey 快照、`originalMaterialType`、
  音频波形与手工拖入完全一致），再覆盖 `startTime / duration / clipStart / clipEnd`，
  `originalDuration = material.duration`；`MaterialData` 的构造与 `TimelinePanel.tsx:596-608` 一致
  （抽成 `toMaterialData(material: MaterialItem): MaterialData` 放入 `timeline/domain/services/ItemPlacementService.ts`
  并让 `TimelinePanel.handleMaterialDrop` 同样调用，避免第三份拷贝）。
- 以 `exportToData()` 为底，**只替换两条目标轨的 items**，其他轨道原样；随后
  `replaceTimelineAction(get, data, 'auto-mix')` —— 一条历史记录，不调用 `autoOrganize`（排布已无空洞）。

#### 3.5.3 `VideoEditingInterface.handleAutoMixAudio` 改写

1. 保留 `:2055-2058` 的无素材提示。
2. `const plan = planScriptAutoMix(materialManagement.allMaterials)`；`plan.placements.length === 0` →
   `showError(t.videoEditing.autoMix.noScriptMaterials, 6000)`。
3. 读 `useTimelineStore.getState().tracks`，**先**用 `resolveAutoMixTargetTracks` 检查（v2 RV-17）：缺目标轨 →
   `showError(t.videoEditing.autoMix.noTargetTrack)`；目标轨锁定 → `showWarning(t.videoEditing.autoMix.trackLocked)`；
   两种情况都直接返回、不弹确认。检查通过后，若两条目标轨当前共有 `n > 0` 个 item，打开
   `ConfirmationDialog`（`src/components/ui/ConfirmationDialog.tsx`，`type="warning"`）：
   title `t.videoEditing.autoMix.replaceConfirmTitle`，message
   `t.videoEditing.autoMix.replaceConfirmBody.replace('{count}', String(n))`（「将替换视频轨 1 与音频轨 1 中的
   {count} 个片段，其他轨道保持不变，可按 Ctrl+Z 撤销」），confirmText/cancelText 走 i18n。
   该弹窗状态为新的 `autoMixConfirmPlan: ScriptAutoMixPlan | null` 内存 state（不持久化）。
4. 确认（或无需确认）后 `applyScriptAutoMixAction`：
   - `ok` → `showSuccess(t.videoEditing.autoMix.applied.replace('{segments}', placedCount))`；
     若存在 `skipped-no-audio` 段 → `showWarning(t.videoEditing.autoMix.skippedNoAudio.replace('{list}', 段号列表))`；
     若 `ignoredDuplicateMaterialIds.length > 0` → `showInfo(t.videoEditing.autoMix.duplicatesIgnored.replace('{count}', ...))`。
   - `track-locked` / `no-target-track`（确认期间状态变化的兜底）→ 与第 3 步相同的提示。
5. 删除旧的「按段排序 + `setMaterialsToAddToTimeline`」实现（`:2066-2166`）。
   **保留** `materialsToAddToTimeline` state、`TimelinePanel` 的 `materialsToAdd` prop、`handleAddMaterialsToTimeline` 与处理 effect：它们仍被素材面板「添加到时间轴」主路径 `handleAddMaterialToTimeline`（`VideoEditingInterface.tsx:1228-1262`）使用；本条只删除自动混剪对它的调用。

---

### 3.6 剪辑 Agent（AG-01 ~ AG-08）

#### AG-01 重连不重放

> v2 根因补充（RV-01）：route 每次新连接都从头运行 Agent，事件 id 从 0 重新计数（`chat/route.ts:298-308`），
> **不存在续传**。因此客户端基于旧 id、旧 toolCallId 的去重（`SSEStreamManager.ts:316-337`）会在重连后丢弃重跑的
> 前 N 个事件（含 tool_call 甚至 tool_result），而 `AgentStateManager` 与 `accumulatedTextRef` 仍保留第一次的半截文本
> 和工具卡片。另外，tool_call 已发出而结果尚未送达时，服务端工具（生成类、入库类，部分计费）可能已经执行。
> 结论：**观察到任一 tool_call 后不再自动重连；重连 = 干净重启本轮**。

1. `SSEStreamManager.ts`：
   - 新增 `private hasObservedToolCall = false;`，`trackEvent` 遇到 `tool_call` 或 `tool_result` 时置 `true`。
   - 重试分支（`:210-235`）在 `shouldRetry(...)` 判断之前插入：
     ```ts
     if (this.hasObservedToolCall) {
       // route 不支持续传，工具可能已在服务端执行（含生成类计费工具）；重连会重复执行。
       this.config.onError(toNonRetryableAfterSideEffects(streamError));
       return;
     }
     ```
   - 决定重试后、`continue` 之前调用私有方法 `resetForRestart()`：`lastReceivedEventId = -1`、
     `completedToolCallIds = []`、`pendingToolCallIds = []`、`lastEvent = null`、`buffer = ''`，然后
     `this.config.onRestart?.(this.retryCount)`。
   - 删除 `doFetchAndRead` 中的两段客户端去重（`:316-337`）与 `Last-Event-ID` 请求头（`:265-268`）：
     服务端不续传，保留它们只会丢事件并误导排查。
   - `SSEStreamManagerConfig` 新增 `onRestart?: (attempt: number) => void`，注释写明
     「重连即重启本轮：调用方必须丢弃本轮已累积的文本、思考内容与工具卡片」。
2. `errorRecovery.ts` 新增并导出：
   ```ts
   export function toNonRetryableAfterSideEffects(error: StreamError): StreamError {
     return { ...error, recoverable: false,
       message: `${error.message} (not retried: tool calls already started)`,
       userMessage: INTERRUPTED_AFTER_TOOLS_MESSAGE };
   }
   ```
   `INTERRUPTED_AFTER_TOOLS_MESSAGE` 与该文件 `USER_MESSAGES`（`errorRecovery.ts:96`，zh-CN 文案 + 英文注释）同风格，放在其旁（v2：规则改为「观察到 tool_call 即不重连」，此时未必已有剪辑落地，文案随之调整）：
   「连接中断：Agent 已开始调用工具，为避免重复执行未自动重连。已完成的更改保留在时间轴上，可继续对话。」/
   "Connection lost after the agent started using tools. It was not retried to avoid running them twice;
   any completed edits stay on the timeline."）。
3. `src/app/api/video-editing-agent/chat/route.ts`：在 `start(controller)` 内、`: stream-start` 之后新增
   整条流生命周期的保活定时器，覆盖 LLM 生成长 tool-call 参数期间的静默：
   ```ts
   // start() 之外，与 triggerClientAbort 同一作用域：
   let keepAliveId: ReturnType<typeof setInterval> | null = null;
   // start(controller) 内、`: stream-start` 之后：
   keepAliveId = setInterval(() => {
     try { controller.enqueue(encoder.encode(': keepalive\n\n')); }
     catch { if (keepAliveId !== null) clearInterval(keepAliveId); }
   }, 15_000);
   ```
   `keepAliveId` 声明在 `start()` 之外，与 `triggerClientAbort`（`:293`）同一作用域，以便 `cancel` 访问；
   在 `start()` 的 `finally`（`send('[DONE]')` 之前，约 `:558`）与 `cancel(reason)`（约 `:566`）两处调用
   `clearInterval(keepAliveId)`。v1「与 `thinkingHeartbeatId` 同处」的写法有误：后者位于独立的 thinking 阶段函数
   （`:69-134`），RV-15。route 中 `Last-Event-ID` 的日志保留（客户端不再发送，日志自然不会出现），不实现续传。
4. `useAgentExecutionState.ts`（F47）：`StartExecutionParams` 新增 `onRestart?: () => void`；manager 的 `onRestart`
   中先 `accumulatedTextRef.current = ''`、`updateState({ pendingMessage: '' })`，再调用 `params.onRestart?.()`；
   `onRetry`（`:262-267`）保持返回 `true`。
5. `AgentStateManager.ts`（F46）新增 `resetForRestart(): void`：清空 `accumulatedContent / thinkingContent /
   toolCalls / pendingOperations / errorMessage`，置 `isThinking = false`，保留 `messageId` 与订阅者，随后 `flushNow()`。
6. `useAgentExecution.ts`：`startExecution({ ..., onRestart: () => stateManager.resetForRestart() })`。重启只可能发生在
   「尚未观察到任何 tool_call」时，此时 `OperationApplier` 没有记录、时间轴也未被改动，重置消息是安全的。

#### AG-02 Agent 撤销改为「轨道补丁 + 冲突检测」

新文件 `src/lib/video-editing-agent/trackPatch.ts`（纯函数）：

```ts
import type { TimelineState, Track } from '@/types';

export interface AgentTrackPatch {
  trackId: string;
  before: Track | null;     // null = 该轨道由本次操作新建
  after: Track | null;      // null = 该轨道被本次操作删除
}

/** 只比较语义字段，屏蔽 store 往返带来的默认值/浮点噪声。 */
export function semanticTrackKey(track: Track | null | undefined): string;

export function diffTimelineTracks(before: TimelineState, after: TimelineState): AgentTrackPatch[];

export type RevertResult =
  | { ok: true; state: TimelineState }
  | { ok: false; conflictTrackIds: string[] };

export function revertTrackPatches(current: TimelineState, patches: readonly AgentTrackPatch[]): RevertResult;
```

- **规整（v2 RV-02）**：`canonicalTrack(track: Track): Track` =
  `Track.fromPlainObject(track as unknown as TrackData).toPlainObject()`（`Track`、`TrackData` 自
  `@/components/video/timeline/domain` 导入，纯 TS；与 store `importFromData` 走同一条转换）。`try/catch` 失败时
  `console.warn('[trackPatch] canonicalise failed', { trackId, error })` 并退回原对象。这一步是必需的：store 往返会
  按 startTime 重排 items（`Track.ts:76,289-291`）、丢弃 `originalDuration: 0`、把 `duration<=0` 改为默认值、
  规整音量（`TimelineItem.ts:279-311`），而冲突判定比较的正是「往返后的当前轨道」与「applier 产出的 after」。
- `semanticTrackKey`：`null → 'null'`；否则对 `canonicalTrack(track)` 以 `JSON.stringify` 输出：
  `{ id, type, isLocked: !!isLocked, isVisible: isVisible !== false, isMuted: !!isMuted, volume: r(volume ?? 100), items }`。
  其中 `items` 先**按 `(startTime, id)` 排序**，再映射为 `{ id, materialId: materialId ?? '', startTime: r(startTime), duration: r(duration), clipStart: r(clipStart ?? 0), clipEnd: r(clipEnd ?? (clipStart ?? 0) + duration), volume: r(volume ?? 1), text: text ?? '' }`；
  `r(x) = Math.round(x * 1000) / 1000`。缩略图、波形、颜色等展示字段不参与比较。
- `slimTrackForPatch(track: Track): Track`（v2 RV-03）：深拷贝后删除以 `data:` / `blob:` 开头的 `thumbnailUrl`
  （与 `videoProjects.ts:214-250` 的持久化剥离规则一致）。补丁会随对话持久化，不得携带内联缩略图。
- `diffTimelineTracks`：两侧 track id 并集，`semanticTrackKey` 不同者产出补丁，`before / after` 为 `slimTrackForPatch` 的结果。
- `revertTrackPatches`：先检查——对每个补丁，`semanticTrackKey(current 中同 id 轨道) !== semanticTrackKey(patch.after)`
  即冲突；任一冲突返回 `{ ok:false, conflictTrackIds }` 且不修改任何东西。无冲突则在深拷贝上应用：
  `before === null` → 删除该轨道；否则替换（不存在时按 `before.order` 插回）；最后
  `totalDuration = max(item end)`。

`OperationApplier.ts` 改动：
1. `OperationRecord` 由 `{ toolCallId, operation, preSnapshot }` 改为 `{ toolCallId, operation, patches: AgentTrackPatch[] }`。
2. `apply()`（`:102-162`）：`const before = deepClone(current)`；应用 + reconcile 之后
   `const after = this.config.getTimelineState()!`；`patches = diffTimelineTracks(before, after)`；
   `patches.length === 0` 时不记录（未产生效果的操作不可撤销，也不再显示为可撤销）。
3. `undoOperation(toolCallId: string): AgentUndoResult`（返回类型由 boolean 改为
   `{ ok: true } | { ok: false; reason: 'not-found' | 'conflict' }`）：
   - 选中记录：`r.toolCallId === toolCallId || r.toolCallId.startsWith(\`${toolCallId}-batch-\`)`（修
     `compose_storyboard` 等批量工具，`AgentEventRouter.ts:159-163` 的 id 规则）；无记录 → `not-found`。
   - 按记录倒序依次 `revertTrackPatches(working, rec.patches)`（working 从 `getTimelineState()` 深拷贝开始）；
     任一 `ok:false` → 返回 `conflict`，不写状态。全部成功 → `setTimelineState(working)`、
     从 `this.operations` 删除这些记录、`onTimelineUpdate()`。
   - **不再**「恢复 preSnapshot 后重放后续操作」。
4. 新增 `hasUndoableRecord(toolCallId: string): boolean`。
5. 删除全仓零调用的 `undoAll()`、`getFullSnapshot()` 及构造函数中的 `fullSnapshot` 捕获（v2 RV-03，grep 仅定义处命中）；
   `getOperationHistory()` 保留，返回新的记录类型。

`useAgentExecution.ts` 改动（hook 内新增 `const { t } = useLocale();`）：
1. **所有终止路径都写整轮补丁**（v2 RV-03）。hook 内新增：
   `const computeTurnPatches = useCallback((): AgentTrackPatch[] => { const start = timelineSnapshotRef.current; const end = timelineStateRef.current; return start && end ? diffTimelineTracks(start, end) : []; }, []);`
   `onComplete`（`:290-304`）、`onError`（`:305-314`）与 `sealMessage`（`:341-367`，覆盖用户停止、切换对话、卸载）
   写入最终消息时，都用 `{ ...sm.toMessageUpdate(), timelineTrackPatches: computeTurnPatches() }`，并且都在事件链
   （AG-03 的 `eventChainRef.current`）排空后执行。
   同时，**新消息不再写入 `timelineSnapshot`**：`toMessageUpdate()` 不再传参（`:255,295,311,356` 四处），占位消息
   （`:221`）删去该字段。它唯一的消费者是被本条替换掉的整表撤销；继续持久化，只会让每条 Agent 消息都带一份含内联
   缩略图的整表副本（`videoProjects.ts` 只剥离 materials 与 `uiState.currentTimelineState`）。
   `timelineSnapshotRef` 仍在内存中保留，作为补丁基线。
2. `undoAllOperations(messageId)`（`:395-414`）：
   - `patches = agentMessage.timelineTrackPatches`；`!patches || patches.length === 0` → 直接返回
     （旧消息无补丁：不再整表覆盖，UI 同时隐藏按钮，见第 4 点）。
   - `const result = revertTrackPatches(timelineStateRef.current!, patches)`；冲突 →
     `onNotification?.('error', t.agentUndo.conflict)` 并返回（不标记 isUndone）。
   - 成功 → `setTimelineState(result.state)`、`timelineStateRef.current = result.state`、
     `onTimelineUpdate?.(\`agent-undo-${Date.now()}\`)`、标记 `isUndone: true`。
3. `undoSingleOperation`（`:420-...`）：`result.ok === false` 时
   `onNotification?.('error', result.reason === 'conflict' ? t.agentUndo.conflict : t.agentUndo.notUndoable)`。
4. 撤销按钮可见性：`components/VideoChatWindow/timeline/utils.ts:215,224` 的
   `canUndo: operationCount > 0 && !message.isUndone` 改为
   `canUndo: (message.timelineTrackPatches?.length ?? 0) > 0 && !message.isUndone`；
   `AgentResponseNode.tsx:79-81` 的单步撤销过滤条件改为
   `tc.status === 'completed' && UNDOABLE_TOOL_NAMES.has(tc.name)`，
   `UNDOABLE_TOOL_NAMES = new Set(['add_to_track','trim_clip','delete_clip','move_clip','resize_clip','compose_storyboard','auto_fix_overlaps'])`
   定义在 `src/lib/video-editing-agent/trackPatch.ts` 并导出（名称已与 `tools/*.ts` 的 `name:` 核对）。
5. `src/types/index.ts:63-80` 的 `ChatMessage` 新增 `timelineTrackPatches?: AgentTrackPatch[]`
   （类型从 `trackPatch.ts` 以 `import type` 引入，或把 `AgentTrackPatch` 接口直接定义在 `types/index.ts`
   并由 `trackPatch.ts` 引用——**采用后者**，避免 types → lib 的反向依赖）。

#### AG-03 事件串行

`useAgentExecution.ts:284-297`：

```ts
// hook 级（v2：sealMessage 也要等链排空）：const eventChainRef = useRef<Promise<void>>(Promise.resolve());
// sendAgentMessage 开头：eventChainRef.current = Promise.resolve();
onEvent: (event: SSEEvent) => {
  eventChainRef.current = eventChainRef.current
    .then(() => router.handleEvent(event))
    .catch((err) => { console.error('[useAgentExecution] Error handling event:', err); });
},
onComplete: () => {
  void eventChainRef.current.then(() => { /* 原 onComplete 函数体整体移入 */ });
},
```
`onError` 分支同样在 `eventChain.then(...)` 内执行收尾，保证已收到的操作先落盘。
`OperationApplier.ts:134-139` 的 `requestAnimationFrame(() => setTimeout(resolve, 50))` 改为
`setTimeout(resolve, 50)`（窗口最小化时 rAF 暂停会卡住整条链）。

#### AG-04 / AG-05 工具层校验

`src/lib/video-editing-agent/tools/index.ts` 新增并导出：

```ts
export function trackEditError(state: TimelineState, trackId: string): { success: false; error: string } | null {
  const track = findTrack(state, trackId);
  if (!track) return { success: false, error: `Track not found: ${trackId}` };
  if (track.isLocked) return { success: false, error: `Track is locked: ${trackId}. Ask the user to unlock it first.` };
  return null;
}

export function materialTrackMismatchError(
  track: Track, materialType: string,
): { success: false; error: string } | null {
  return TrackTypeUtils.canAcceptMaterial(track.type, materialType, track.id)
    ? null
    : { success: false, error: `A ${materialType} clip cannot be placed on ${track.id} (${track.type} track).` };
}
```
（`TrackTypeUtils` 自 `@/components/video/timeline/domain/value-objects/TrackType` 导入，纯 TS。）

- `deleteClip.ts`、`trimClip.ts`、`resizeClip.ts`：`findClip` 成功后 `const lockError = trackEditError(context.timelineState, found.trackId)`，非 null 即返回错误结果。
- `moveClip.ts`：对**源轨** `found.trackId` 与目标轨各做一次 `trackEditError`；再
  `materialTrackMismatchError(targetTrack, found.item.originalMaterialType ?? found.item.type)`。
- `addToTrack.ts`：`track.isLocked` 检查之后追加 `materialTrackMismatchError(track, material.type)`。
- `OperationApplier.applyToTimeline` 防御：`delete/trim/resize/move` 命中的轨道（move 含源与目标）为锁定时
  跳过该操作并 `console.warn('[OperationApplier] skipped operation on locked track', { type, trackId })`；
  `apply()` 中据此不记录补丁。

#### AG-06 图片片段类型

`OperationApplier.ts:456-470` 与 `agent.ts:351-364` 的 `add_clip` 条目新增
`originalMaterialType: (material.type as MaterialType) || undefined`（`AgentMaterialData` 仅有
`id/name/type/thumbnailUrl`，`types/index.ts:109-114`）。`OperationApplier` 中同时补
`opacity: 1`。

#### AG-07 `resize_clip` 语义 = 调整出点

1. `src/types/index.ts:121` 与 `src/lib/video-editing-agent/types.ts:85-89` 的 `resize_clip` 操作增加可选字段
   `clipEnd?: number`。
2. `tools/resizeClip.ts`：
   ```ts
   const isStill = found.item.originalMaterialType === 'image';
   const clipStart = found.item.clipStart ?? 0;
   const sourceDuration = found.item.originalDuration ?? 0;
   const maxDuration = !isStill && sourceDuration > 0 ? sourceDuration - clipStart : Number.POSITIVE_INFINITY;
   if (params.newDuration > maxDuration + 1e-3) {
     return error(`Clip ${params.clipId} can be at most ${maxDuration.toFixed(2)}s long (source ends there).`);
   }
   context.updateTimeline(toolCallId, {
     type: 'resize_clip', clipId: params.clipId, newDuration: params.newDuration,
     clipEnd: isStill ? undefined : clipStart + params.newDuration,
   });
   ```
   工具描述改为：`Change how long a clip plays by moving its out-point. The in-point stays fixed; the clip cannot run past the end of its source media. Images can be any length.`
3. `OperationApplier.ts:519-528` 与 `agent.ts:412-420`：`clip.duration = op.newDuration;`
   之后 `if (op.clipEnd !== undefined) clip.clipEnd = op.clipEnd;`。

#### AG-08

由 S1 解决：Agent 操作与撤销经 `setExternalTimelineUpdateId(nextExternalUpdateId('agent-op' | 'agent-undo'))` 进入
`replaceTimelineAction`，每个渲染批次写 1 条历史（通常即每次操作 1 条），用户手工历史不再被清空；
执行期间的撤销由 S4 禁止，执行结束后可以逐步 Ctrl+Z。

---

### 3.7 手动剪辑 · 时间轴（TL-01 ~ TL-09）

#### TL-01 S 键替换字幕：防重入 + 事前确认 + 可撤销

`TimelinePanel.tsx`：
1. S 键经 `resolveTimelineShortcut`（S3）解析，按键自动重复（`e.repeat`）时不触发。
2. 新文件 `src/components/video/timeline/lib/subtitleReplacement.ts`（F50，纯函数）：
   ```ts
   export type SubtitleReplacementBlocker = 'extracting' | 'confirm-pending' | 'track-locked';
   /** 按 extracting → confirm-pending → track-locked 的顺序判定；无阻塞返回 null。 */
   export function getSubtitleReplacementBlocker(input: {
     isExtracting: boolean;
     isConfirmPending: boolean;
     subtitleTrack: Pick<TrackData, 'isLocked'> | undefined;
   }): SubtitleReplacementBlocker | null;
   ```
   `handleAddSubtitle`（`:839`）开头如下（新增 `subtitleConfirmPendingRef = useRef(false)`。v2 RV-06：确认框打开期间
   `isExtractingSubtitles` 尚未置位，必须另有待确认守卫，否则再按 S 会覆盖待确认状态，前一个 Promise 永不 resolve）：
   ```ts
   const store = useTimelineStore.getState();
   const subtitleTrackBefore = store.tracks.find(t => t.type === 'subtitle');
   const blocker = getSubtitleReplacementBlocker({
     isExtracting: store.isExtractingSubtitles,
     isConfirmPending: subtitleConfirmPendingRef.current,
     subtitleTrack: subtitleTrackBefore,
   });
   if (blocker === 'track-locked') { showError(t.timeline.messages.subtitleTrackLocked); return; }
   if (blocker !== null) return;
   if (subtitleTrackBefore && subtitleTrackBefore.items.length > 0) {
     subtitleConfirmPendingRef.current = true;
     const confirmed = await confirmReplaceSubtitles(subtitleTrackBefore.items.length)
       .finally(() => { subtitleConfirmPendingRef.current = false; });
     if (!confirmed) return;
   }
   ```
   `confirmReplaceSubtitles(count): Promise<boolean>`：面板内新增 `subtitleReplaceConfirm` state
   （`{ count: number; resolve: (ok: boolean) => void } | null`），渲染 `ConfirmationDialog`
   （`type="warning"`，title `t.timeline.messages.replaceSubtitlesTitle`，message
   `t.timeline.messages.replaceSubtitlesBody.replace('{count}', ...)`「将用识别结果替换现有 {count} 条字幕，可按 Ctrl+Z 撤销」）；
   确认/取消分别 `resolve(true/false)` 并清空 state；面板卸载时若仍有待确认项，以 `resolve(false)` 结束。
   **确认发生在发起识别请求之前**，避免用户等待数分钟后才被询问。确认框的焦点行为见 F49：打开即聚焦「取消」，
   Esc 取消，按钮上的 Enter 由按钮自身处理。
   `setExtractingSubtitles(true)` 移到确认之后。
3. 识别完成后（`:904`）重新读取最新状态：`const fresh = useTimelineStore.getState(); const subtitleTrack = fresh.tracks.find(t => t.id === subtitleTrackBefore?.id) ?? fresh.tracks.find(t => t.type === 'subtitle');`
   若此时轨道被锁定 → `showError(subtitleTrackLocked)` 并返回。
4. `:940-948` 的 `importFromData` 改为
   `replaceTimelineAction(() => useTimelineStore.getState(), { ...currentData, tracks: updatedTracks }, 'subtitles')`。
5. 字幕编辑弹窗保存 `handleSaveSubtitleChanges`（`:1061-1069`）同样改为
   `replaceTimelineAction(..., 'subtitles')`（修 TL-05 的弹窗路径）。

#### TL-02 拖拽取消真正回退

`store/slices/dragSlice.ts:308-315` 的 `cancelDrag` 改为：
```ts
cancelDrag: () => {
  const actor = get()._dragActor;
  if (!actor) return;
  const snapshot = actor.getSnapshot();
  const { itemId, originalStartTime } = snapshot.context;
  const wasDragging = isDraggingQuery(snapshot);
  actor.send({ type: 'ESCAPE' });
  if (wasDragging && itemId) {
    const current = get().tracks.flatMap(track => track.items).find(item => item.id === itemId);
    if (current && Math.abs(current.startTime - originalStartTime) > 1e-6) {
      get().moveItem(itemId, originalStartTime, true);   // 预览模式：不写历史
    }
  }
  if (get().swapTargetItemId !== null) set({ swapTargetItemId: null } as Partial<TimelineStore>);
},
```
（`itemId / originalStartTime` 为 drag machine context 字段，`dragMachine.ts:61,72`。v2 更正说明（RV-13）：
`updateDrag` 的预览改写块受 `isDragging` 门控（`dragSlice.ts:266-297`），**只有 move 交互**会在预览阶段把 `startTime`
写入 store；resize 预览只存在于 machine context，不改 store。因此用 `wasDragging` 门控恢复 `originalStartTime`，
已覆盖所有需要回退的情形，取消 resize 无需额外处理。）

`TimelinePanel.tsx:393-433` 的拖拽监听 effect 中追加：
`window.addEventListener('pointercancel', handleCancel)` 与 `window.addEventListener('blur', handleCancel)`，
`handleCancel = () => useTimelineStore.getState().cancelDrag()`，cleanup 中对称移除。

#### TL-03 快捷键在模态框内不触发

1. `TimelinePanel.tsx:491` 的 `handleKeyDown` 在计算 `active` 之后、`isTextInput` 判断之前加：
   `if (!shouldTimelineHandleKeyEvent(e, active)) return;`
2. `VideoEditingInterface.tsx:422-433` 的空格处理：删去自写的 `isInInputField` 判断，改为
   `if (event.code !== 'Space' || !shouldGlobalSpaceTogglePlayback(event)) return;`（`ref` 为空时仍返回，
   `preventDefault()` 与播放/暂停分支保持不变）。语义为「原有的文本输入排除 + 模态框排除」，**不会**因为
   `defaultPrevented` 或按钮获得焦点而放弃播放（RV-04）。现有源码断言测试 `videoEditingInterface.spaceKey.test.tsx`
   同步更新（T26）。
3. 函数来自 S3，`shortcutOwnership.test.ts` 增加用例（§7）。

#### TL-04 图片片段自由伸缩

1. `domain/services/ItemPlacementService.ts:196-199`：`material.type === 'image'` 时不写 `originalDuration`
   （`clipStart: 0, clipEnd: duration` 保留）。
2. `domain/entities/TimelineItem.ts`：新增私有谓词 `private isStill(): boolean { return this._originalMaterialType === 'image'; }`
   （若实体字段名不同，以构造函数中保存 `originalMaterialType` 的字段为准）。
   - `resizeEndEdge`（`:400-412`）：`const upperBound = this.isStill() ? Number.POSITIVE_INFINITY : (this._originalDuration?.value ?? Number.POSITIVE_INFINITY);`
   - `resizeStartEdge`（`:377-392`）开头：
     ```ts
     if (this.isStill()) {
       const end = this.endTime().value;
       const start = Math.min(newPosition.value, end - MIN_DURATION_SECONDS);
       this._startTime = TimePosition.create(Math.max(0, start));
       this._duration = Duration.create(end - this._startTime.value);
       this._clipStart = TimePosition.create(0);
       this._clipEnd = TimePosition.create(this._duration.value);
       return;
     }
     ```
     `MIN_DURATION_SECONDS` 复用 `DurationCalculationService.ts:22` 的常量（改为 export）。
   - 已存盘的旧图片条目带 `originalDuration=5`，上述判断基于类型而非字段，兼容旧数据。
3. 拖拽预览：`TimelineItem.tsx:245-259` 的 `startDrag` 事件增加 `isStill: item.originalMaterialType === 'image'`，
   `originalMediaDuration: item.originalMaterialType === 'image' ? Number.POSITIVE_INFINITY : (item.originalDuration ?? Number.POSITIVE_INFINITY)`
   （旧数据 `undefined` 会让 `dragMachine.ts:229` 算出 NaN）。
   `dragMachine.ts` 的 `PointerDownEvent`（`:105-126`）与 context 增加 `isStill?: boolean`；
   `calculateResizeStartPreview`（`:241-266`）增加参数 `isStill: boolean`，为 true 时
   `maxLeftExtension = originalStartTime`（可一直扩展到 0）。

#### TL-05 字幕文本 / 图片位置入历史

新文件 `store/actions/updateItemFields.ts`：
```ts
export function updateSubtitleTextAction(get: () => TimelineStore, itemId: string, text: string): boolean;
export function updateImagePositionAction(get: () => TimelineStore, itemId: string, position: ImagePosition): boolean;
```
两者流程一致：`const found = get()._aggregate.findItem(itemId)`；`!found || found.track.isLocked` → `false`；
值未变化（文本严格相等；位置按 `x/y/width/height/zIndex` 逐字段 `Math.abs(a-b) < 1e-6`）→ `false`；
否则 `recordAction('UPDATE_ITEM', { itemId, field: 'text' | 'imagePosition' })` → 调用既有
`updateItemSubtitle / updateItemImagePosition`（`timelineSlice.ts:375-399`）→ `captureNextState()` → `true`。

调用方替换：`TimelineItem.tsx:313`（`updateItemSubtitle(item.id, nextText)` → `updateSubtitleTextAction(() => useTimelineStore.getState(), item.id, nextText)`）、
`TimelinePanel.tsx:1049`（`handleSubtitleEdit`）、`VideoEditingInterface.tsx:2050`（`handleImagePositionConfirm`）。
`handleImagePositionChange`（`VideoEditingInterface.tsx:2018-2047`，拖动过程中的实时预览）保持不入历史。

#### TL-06

由 S2 解决。

#### TL-07 被拒绝的编辑不写历史

1. `removeItem.ts` 的 `removeItemsAction`（`:59-90`）开头：
   ```ts
   const editableIds = itemIds.filter(id => { const f = get()._aggregate.findItem(id); return f !== null && !f.track.isLocked; });
   if (editableIds.length === 0) return;
   ```
   后续只处理 `editableIds`；单条 `removeItemAction`（`:20-48`）同样先查再记录。
2. `addItem.ts:30-37`：先 `const track = TrackSelectionService.selectTrackForMaterial(state._aggregate.tracks, material.type, trackId)`，
   `!track || track.isLocked || !TrackTypeUtils.canAcceptMaterial(track.type, material.type, track.id)` → `return null`（不记录）；
   记录与 `addItemToTrack` 使用 `track.id`。
3. ~~`TrackSelectionService` 在显式目标锁定时回退到其他轨道~~（v2 取消，RV-20：用户把素材拖到**某条**锁定轨上时，
   静默落到别的轨道违背直接操作预期）。改为：`TimelinePanel.handleMaterialDrop` 与 `handleAddMaterialsToTimeline`
   （`:580-596,639-647`）中「自动寻找兼容轨道」的 `find` 条件追加 `&& !t.isLocked`，让程序化添加优先落到未锁定轨；
   拖放到一条已存在的锁定轨时，`addItemAction` 返回 `null`（见第 2 点），`handleMaterialDrop` 提示
   `showWarning(t.timeline.track.trackLocked)`（`useNotification()` 解构中追加 `showWarning`）。`TrackSelectionService.ts` 不改。
4. `swapItems.ts:29-30`：记录前检查两条目同轨、轨道未锁定、非字幕轨，否则返回。
5. 拖拽：`TimelineItem.tsx` 在 `startDrag` 前 `if (isTrackLocked) return;`（选择仍生效），锁定轨条目鼠标样式
   `cursor-not-allowed`。
6. 复制：`TimelinePanel.tsx:684-747` 的 `handleCopy` 先过滤掉位于锁定轨道的选中项，为空时返回。
7. 工具栏：`TimelineToolbar.tsx:39-48` 的 selector 新增
   `editableSelectedCount: state.selectedItems.filter(id => state.tracks.some(tr => !tr.isLocked && tr.items.some(i => i.id === id))).length`，
   复制/删除按钮（`:132,144`）`disabled: editableSelectedCount === 0`。

#### TL-08 撤销/重做快捷键

`TimelinePanel.tsx:520-565` 的 if/else 链改为 `switch (resolveTimelineShortcut(e, isInteractive))`（S3；v2 RV-19 抽为纯函数）。
下列片段只说明键位语义，实现以 S3 的 `resolveTimelineShortcut` 为准：
```ts
const key = e.key.toLowerCase();
if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); useTimelineStore.getState().undo(); }
else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); useTimelineStore.getState().redo(); }
else if (ctrl && key === 'x') {
  e.preventDefault();
  const store = useTimelineStore.getState();
  store.setActiveTool(store.activeTool === 'cut' ? 'select' : 'cut');   // 与 TimelineToolbar.tsx:59-62 一致
}
```
`'toggle-cut'` 分支体为 `store.setActiveTool(store.activeTool === 'cut' ? 'select' : 'cut')`，与 `TimelineToolbar.tsx:59-62` 一致。

#### TL-09 转场字段往返保真

1. `domain/entities/TimelineItem.ts`：构造参数、`create`、`fromPlainObject`（`:279-311`）、`toPlainObject`
   （`:456-490`）加入 `transitionIn / transitionOut`（类型 `SequenceTransitionData`，与
   `domain/types.ts:89-91` 一致），`toPlainObject` 仅在非空时输出，并提供 getter。
2. `domain/services/SplitService.ts:84-101`：左半 `transitionOut: undefined`，右半 `transitionIn: undefined`
   （切点内侧不应出现淡入淡出）。

---

### 3.8 导出一致性（EX-01 ~ EX-03）

#### EX-01 统一音量计算

新文件 `src/components/video/timeline/infrastructure/effectiveVolume.ts`：
```ts
export const MAX_EFFECTIVE_VOLUME = 2;

/** item 音量（倍数，缺省 1）× 轨道音量（百分比，缺省 100），钳制到 [0, 2]；非有限值按缺省处理。 */
export function computeEffectiveVolume(itemVolume: number | undefined, trackVolume: number | undefined): number {
  const item = Number.isFinite(itemVolume) ? (itemVolume as number) : 1;
  const track = Number.isFinite(trackVolume) ? (trackVolume as number) : 100;
  return Math.max(0, Math.min(item * (track / 100), MAX_EFFECTIVE_VOLUME));
}
```
替换四处：`CompositionAdapter.ts:152-156`、`:248-251`，`useVideoExport.ts:341`、`:407`
（导出由 `(track.volume || 100)` 改为 `computeEffectiveVolume(item.volume, track.volume)`，0% 轨道导出为静音）。

#### EX-02 锁定 = 仅防编辑；静音轨导出一致

1. `useVideoExport.ts:192` 与 `:204`：去掉 `|| track.isLocked`；音频轨额外 `|| track.isMuted` 时跳过
   （与预览 `CompositionAdapter.ts:219-223` 一致）；同步修正 `:185-190` 的注释（删去「muted tracks are still exported」）。
   `expectedAudioItemCount` 计数条件与构建循环保持完全一致。
2. `CompositionAdapter.ts:125`：`track.type !== 'video' || !track.isVisible`；`:219-223`：
   `track.type !== 'audio' || !track.isVisible || track.isMuted`。字幕（`:289`）与图片叠加
   （`useCompositionPlayback.ts:170`）已不看锁定，无需改动。
3. `useTimelineComposition.ts` 已核实不含 `isLocked` 过滤，无需改动。
4. 现有测试若断言「锁定轨被排除」（`timeline/__tests__/*.test.ts`、`hooks/__tests__/useTimelineComposition.localPreview.test.ts`
   中含 `isLocked` 的用例），按新语义更新断言并在用例名中体现「locked tracks still render」。

#### EX-03 合成失败信息与轮询中止

1. `src/lib/api/videoComposition.ts` 中 `CompositionStatusResponse.error_details`（`:177,194`）类型由 `any` 改为
   `CompositionErrorDetails | undefined`（新接口：`error_summary: string; recovery_suggestions?: string[]; failed_videos?: unknown[]; composition_stage?: string; error?: string`）。
2. `pollCompositionStatus`（`:306-340`）签名改为
   `(compositionId, onProgress?, pollInterval = 2000, maxAttempts = 300, signal?: AbortSignal)`；
   失败分支消息 = `status.error_details?.error_summary ?? status.error_details?.error ?? status.message ?? 'Unknown error'`，
   若有 `recovery_suggestions[0]` 追加 `\n${suggestion}`；每次调度 `setTimeout` 前检查 `signal?.aborted`，
   中止时 `reject(new DOMException('Composition polling aborted', 'AbortError'))`；
   `signal` 的 abort 监听清除挂起的 timeout。
3. `useVideoExport.ts`：新增 `exportAbortRef = useRef<AbortController | null>(null)`；每次导出创建新 controller
   并把 `signal` 传给 `pollCompositionStatus`（`:691`）；hook 卸载 effect 中 `exportAbortRef.current?.abort()`；
   捕获到 `AbortError` 时不弹错误 toast、不调用 `setExportProgress`。

---

## 4. 文件 / 模块变更计划

路径前缀：前端相对仓库根；后端相对 `backend-services/basic-service/`。「新增」= 新建文件，「修改」= 既有文件。

### 4.1 前端 · 共享机制与时间轴

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F1 | `src/components/video/timeline/store/actions/replaceTimeline.ts` | 新增 | 可撤销整表替换 action | S1 |
| F2 | `src/components/video/timeline/domain/services/HistoryService.ts` | 修改 | 联合类型加 `REPLACE_TIMELINE`；`captureAfterState` 仅写未撤销的最后一条 | S1/S2 |
| F3 | `src/components/video/timeline/store/slices/selectionSlice.ts` | 修改 | 新增 `pruneSelection` | S1 |
| F4 | `src/components/video/timeline/store/useTimelineStore.ts` | 不改（v2） | `TimelineStore` 是各 slice 接口的交叉类型（`useTimelineStore.ts:37-42`），在 slice 接口中声明即可 | S1 |
| F5 | `src/components/video/timeline/TimelinePanel.tsx` | 修改 | 外部同步走 F1；S3 守卫 + `resolveTimelineShortcut`；S4 锁判定；TL-01 确认 + 待确认守卫（F50）+ F1；TL-02 pointercancel/blur；TL-07 复制过滤、兼容轨查找优先未锁定、拖到锁定轨提示；TL-08 Ctrl+X；TL-05 `handleSubtitleEdit` | S1/S3/S4/TL-01/02/05/07/08 |
| F6 | `store/actions/{addItem,detachAudio,moveItem,removeItem,resizeItem,setCameraMotion,splitItem,swapItems,trackActions}.ts` | 修改 | 同步 `captureNextState`；`addItem/removeItem/swapItems` 先校验再记录 | S2/TL-07 |
| F7 | `src/components/video/timeline/store/slices/dragSlice.ts` | 修改 | 同步快照；`cancelDrag` 回退 | S2/TL-02 |
| F8 | `src/components/video/timeline/store/slices/historySlice.ts` | 修改 | 注释更新；`undo/redo` 在外部编辑锁生效时直接返回（v2） | S2/S4 |
| F9 | `src/components/video/timeline/shortcutOwnership.ts` | 修改 | `shouldTimelineHandleKeyEvent`、`shouldGlobalSpaceTogglePlayback`（v2 语义）、`resolveTimelineShortcut`、`MUTATING_TIMELINE_SHORTCUTS` | S3/S4/TL-03/08 |
| F10 | `src/components/video/timeline/store/actions/updateItemFields.ts` | 新增 | 字幕文本 / 图片位置可撤销 action | TL-05 |
| F11 | `src/components/video/timeline/TimelineItem.tsx` | 修改 | 字幕编辑调用 F10；锁定轨不启动拖拽；`isStill` 与无穷媒体时长 | TL-04/05/07 |
| F12 | `src/components/video/timeline/domain/entities/TimelineItem.ts` | 修改 | 图片伸缩；转场字段往返 | TL-04/09 |
| F13 | `src/components/video/timeline/domain/services/ItemPlacementService.ts` | 修改 | 图片不写 `originalDuration`；导出 `toMaterialData` | TL-04/AS-02 |
| F14 | `src/components/video/timeline/domain/machines/dragMachine.ts` | 修改 | `isStill` 上下文与左扩展规则 | TL-04 |
| F15 | `src/components/video/timeline/domain/services/DurationCalculationService.ts` | 修改 | 导出 `MIN_DURATION_SECONDS` | TL-04 |
| F16 | `src/components/video/timeline/domain/services/TrackSelectionService.ts` | 不改（v2 取消） | 见 TL-07 第 3 点与 RV-20 | — |
| F17 | `src/components/video/timeline/domain/services/SplitService.ts` | 修改 | 切分清除内侧转场 | TL-09 |
| F18 | `src/components/video/timeline/TimelineToolbar.tsx` | 修改 | `editableSelectedCount` 控制复制/删除可用；外部编辑锁生效时禁用撤销/重做/删除/剪切/添加字幕 | TL-07/S4 |
| F19 | `src/components/video/timeline/infrastructure/effectiveVolume.ts` | 新增 | 统一音量计算 | EX-01 |
| F20 | `src/components/video/timeline/infrastructure/CompositionAdapter.ts` | 修改 | 用 F19；锁定不过滤；静音音频轨过滤 | EX-01/02 |
| F48 | `src/components/video/timeline/store/slices/uiSlice.ts` | 修改 | `externalEditLock` + `setExternalEditLock`（v2） | S4 |
| F50 | `src/components/video/timeline/lib/subtitleReplacement.ts` | 新增 | `getSubtitleReplacementBlocker` 纯函数（v2） | TL-01 |
| F51 | `src/components/video/timeline/lib/externalUpdateId.ts` | 新增 | `nextExternalUpdateId`、`reasonFromExternalUpdateId`（v2） | S1 |

### 4.2 前端 · AI 混剪 / 自动混剪 / 导出

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F21 | `src/components/video/lib/aiMix/mergeAiMixTimeline.ts` | 新增 | AI 结果按轨道精确合并的纯函数 | AM-01/02/03 |
| F22 | `src/components/video/lib/aiMix/planScriptAutoMix.ts` | 新增 | 脚本自动混剪排布纯函数 | AS-01/02 |
| F23 | `src/components/video/timeline/store/actions/applyScriptAutoMix.ts` | 新增 | 排布结果一次性、可撤销地写入两条目标轨 | AS-02 |
| F24 | `src/components/video/hooks/useAIMixedEditing.ts` | 新增 | AI 混剪编排：阶段状态、取消、过期结果丢弃、错误映射、DTO 精简 | AM-08 |
| F25 | `src/components/video/VideoEditingInterface.tsx` | 修改 | 接入 F24；删除旧编排与 3 个持久化 state；`handleImportComplete` 去掉 AI 分支、id 改用 F51；自动混剪改用 F22/F23 + 锁定前置检查 + 确认；空格用 S3；图片位置确认用 F10；S4 外部编辑锁 effect | AM-01/08、AS-01/02、TL-03/05、S4 |
| F26 | `src/components/video/components/AIMixingProgressModal/AIMixingProgressModal.tsx` | 修改（重写） | 步骤条、可取消、无伪进度、a11y、i18n | AM-08 |
| F27 | `src/components/video/components/AIMixingModeSelectionModal/AIMixingModeSelectionModal.tsx` | 修改 | 影响提示、焦点管理、aria、帧间隔输入 | AM-01/10 |
| F28 | `src/components/video/utils/parallelVideoAnalysis.ts` | 修改 | `ParallelAnalysisOptions.signal` 透传 | AM-08 |
| F29 | `src/components/video/hooks/useVideoExport.ts` | 修改 | F19；锁定不过滤；静音轨过滤；轮询中止 | EX-01/02/03 |
| F31 | `src/lib/api/videoComposition.ts` | 修改 | `error_summary`；`signal` 参数；错误详情类型 | EX-03 |
| F32 | `src/lib/i18n.ts` | 修改 | 新增 §6.4 所列 key（接口类型 + en + zh-CN 三处） | 全部 UI 文案 |
| F49 | `src/components/ui/ConfirmationDialog.tsx` | 修改 | 打开时聚焦「取消」、关闭后还原焦点；Enter 仅在目标不是按钮时确认；按钮 `type="button"`（v2） | TL-01/AS-02 |

### 4.3 前端 · 剪辑 Agent

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| F33 | `src/lib/video-editing-agent/trackPatch.ts` | 新增 | 轨道补丁 diff / 冲突检测 / 回退；`UNDOABLE_TOOL_NAMES`；v2：`canonicalTrack` 领域规整、items 排序的语义键、`slimTrackForPatch` | AG-02 |
| F34 | `src/lib/video-editing-agent/OperationApplier.ts` | 修改 | 记录补丁；批量撤销；锁定防御；图片类型；resize clipEnd；默认音量 100；去 rAF；删除零调用的 `undoAll/getFullSnapshot` | AG-02/03/04/06/07、AM-09 |
| F35 | `src/components/video/hooks/useAgentExecution.ts` | 修改 | 事件串行（hook 级 `eventChainRef`）；三个终止路径写轮次补丁；不再持久化 `timelineSnapshot`；冲突提示；`useLocale`；`onRestart` 重置消息；id 改用 F51 | AG-01/02/03 |
| F36 | `src/lib/video-editing-agent/SSEStreamManager.ts` | 修改 | 观察到 tool_call 后不重连；重连 = 干净重启（清空去重状态，删除客户端 id 去重与 `Last-Event-ID`，新增 `onRestart`） | AG-01 |
| F37 | `src/lib/video-editing-agent/errorRecovery.ts` | 修改 | `toNonRetryableAfterSideEffects` + 文案常量 | AG-01 |
| F38 | `src/app/api/video-editing-agent/chat/route.ts` | 修改 | 全程 15s keepalive | AG-01 |
| F39 | `src/lib/video-editing-agent/agent.ts` | 修改 | 服务端镜像：图片类型、resize clipEnd | AG-06/07 |
| F40 | `src/lib/video-editing-agent/tools/index.ts` | 修改 | `trackEditError`、`materialTrackMismatchError` | AG-04/05 |
| F41 | `src/lib/video-editing-agent/tools/{deleteClip,trimClip,resizeClip,moveClip,addToTrack}.ts` | 修改 | 锁定/类型校验；resize 上界与描述；自动建轨音量 100 | AG-04/05/07、AM-09 |
| F42 | `src/lib/video-editing-agent/types.ts` | 修改 | `resize_clip.clipEnd?` | AG-07 |
| F43 | `src/types/index.ts` | 修改 | `AgentTrackPatch`；`ChatMessage.timelineTrackPatches?`；`AgentTimelineOperation.resize_clip.clipEnd?` | AG-02/07 |
| F44 | `src/components/video/components/VideoChatWindow/timeline/utils.ts` | 修改 | `canUndo` 基于补丁 | AG-02 |
| F45 | `src/components/video/components/VideoChatWindow/timeline/AgentResponseNode.tsx` | 修改 | 单步撤销按 `UNDOABLE_TOOL_NAMES` 显示 | AG-02 |
| F46 | `src/lib/video-editing-agent/AgentStateManager.ts` | 修改 | `resetForRestart()`（v2） | AG-01 |
| F47 | `src/components/video/hooks/useAgentExecutionState.ts` | 修改 | `StartExecutionParams.onRestart` 透传，并清空累积文本（v2） | AG-01 |

### 4.4 后端

| # | 文件 | 类型 | 变更意图 | 关联 |
|---|---|---|---|---|
| B1 | `app/services/llm_json.py` | 新增 | `extract_json_object` | AM-05 |
| B2 | `app/services/ai_mixed_editing_service.py` | 修改 | `create()` 工厂 + 异常类型；重试解析；sanitize 串联；提示词音量；删 print | AM-04/05/06/07/09 |
| B3 | `app/services/timeline_parser_service.py` | 修改 | `sanitize_simplified_timeline`；0 时长移除；音量与轨道音量；`warnings` | AM-06/09 |
| B4 | `app/models/ai_mixed_editing_models.py` | 修改 | segment `extra=ignore`；`volume: float` + 归一；删 `AIMixedEditingErrorResponse` | AM-05/07 |
| B5 | `app/routers/ai_mixed_editing_router.py` | 修改 | `ErrorResponse` 错误契约；`await create()`；删 print | AM-04/07 |
| B6 | `app/services/model_settings_service.py` | 修改 | VIDEO_CUT env 按组回退 | AM-04 |

### 4.5 测试（新增 / 修改）

| # | 文件 | 类型 | 覆盖 |
|---|---|---|---|
| T1 | `tests/test_ai_mixed_editing_hardening.py` | 新增 | AM-04/05/06/07/09 |
| T2 | `tests/test_timeline_validation_fix.py` | 修改 | 两个 0 时长用例改为「被移除」 |
| T3 | `tests/test_model_settings_video_cut_fallback.py` | 新增 | AM-04 env 组回退 |
| T4 | `src/components/video/lib/aiMix/__tests__/mergeAiMixTimeline.test.ts` | 新增 | AM-01/02/03 |
| T5 | `src/components/video/lib/aiMix/__tests__/planScriptAutoMix.test.ts` | 新增 | AS-01/02 |
| T6 | `src/components/video/timeline/store/actions/__tests__/replaceTimeline.test.ts` | 新增 | S1 |
| T7 | `src/components/video/timeline/__tests__/history.syncCapture.test.ts` | 新增 | S2/TL-06 |
| T8 | `src/components/video/timeline/__tests__/shortcutOwnership.test.ts` | 修改 | S3/TL-03/TL-08（含 `resolveTimelineShortcut`） |
| T9 | `src/components/video/hooks/__tests__/useAIMixedEditing.test.tsx` | 新增 | AM-08 |
| T10 | `src/components/video/components/AIMixingProgressModal/__tests__/AIMixingProgressModal.test.tsx` | 新增 | AM-08 |
| T11 | `src/components/video/components/AIMixingModeSelectionModal/__tests__/AIMixingModeSelectionModal.test.tsx` | 新增 | AM-01/10 |
| T12 | `src/lib/video-editing-agent/__tests__/trackPatch.test.ts` | 新增 | AG-02 |
| T13 | `src/lib/video-editing-agent/__tests__/operationApplier.undo.test.ts` | 新增 | AG-02/06/07 |
| T14 | `src/lib/video-editing-agent/__tests__/sseStreamManager.retry.test.ts` | 新增 | AG-01 |
| T15 | `src/lib/video-editing-agent/__tests__/editingTools.guards.test.ts` | 新增 | AG-04/05/07 |
| T16 | `src/components/video/hooks/__tests__/useAgentExecution.ordering.test.ts` | 新增 | AG-01（重启重置）/AG-02（终止路径补丁）/AG-03 |
| T17 | `src/components/video/timeline/store/slices/__tests__/dragSlice.cancel.test.ts` | 新增 | TL-02 |
| T18 | `src/components/video/timeline/domain/entities/__tests__/TimelineItem.still.test.ts` | 新增 | TL-04/09 |
| T19 | `src/components/video/timeline/store/actions/__tests__/updateItemFields.test.ts` | 新增 | TL-05 |
| T20 | `src/components/video/timeline/store/actions/__tests__/rejectedEdits.test.ts` | 新增 | TL-07 |
| T21 | ~~`TimelinePanel.shortcuts.test.tsx`~~ → 并入 T8 与 T28（v2 RV-19：仓库没有渲染 `<TimelinePanel>` 的测试先例，改为测纯函数） | — | TL-01/08 |
| T22 | `src/components/video/timeline/infrastructure/__tests__/effectiveVolume.test.ts` | 新增 | EX-01 |
| T23 | `src/components/video/hooks/__tests__/useVideoExport.trackFilters.test.ts` | 新增 | EX-01/02 |
| T24 | `src/lib/api/__tests__/videoComposition.poll.test.ts` | 新增 | EX-03 |
| T25 | `src/lib/video-editing-agent/__tests__/operationApplier.overlap.test.ts` | 修改 | AG-02：`:108` 的 `toBe(true)` 改为 `toEqual({ ok: true })`（v2 RV-09） |
| T26 | `src/components/video/__tests__/videoEditingInterface.spaceKey.test.tsx` | 修改 | TL-03：源码断言改为钉住 `shouldGlobalSpaceTogglePlayback(event)` 与 `!ref` 早退（v2 RV-09） |
| T27 | `src/components/ui/__tests__/ConfirmationDialog.focus.test.tsx` | 新增 | TL-01/RV-06 |
| T28 | `src/components/video/timeline/lib/__tests__/subtitleReplacement.test.ts` | 新增 | TL-01 |
| T29 | `src/components/video/timeline/store/slices/__tests__/externalEditLock.test.ts` | 新增 | S4 |
| T30 | `src/components/video/timeline/lib/__tests__/externalUpdateId.test.ts` | 新增 | S1/RV-16 |

---

## 5. 接口设计

### 5.1 REST：`POST /api/ai-mixed-editing`（BFF 透传至 FastAPI，同路径）

请求（形状不变，前端改为发送精简 DTO）：
```json
{ "taskId": "task-123",
  "materials": [ { "id": "m1", "name": "段落1 - 城市", "type": "video", "format": "mp4", "size": 1048576,
                   "duration": 12.5, "width": 1920, "height": 1080,
                   "url": "/api/storage/files/cached_materials/pexels/1.mp4",
                   "createdAt": "2026-09-13T08:00:00.000Z",
                   "metadata": { "segment_id": "s1", "segment_number": 1 } } ] }
```

成功 `200`（形状不变，`metadata` 新增 `warnings`）：
```json
{ "success": true, "message": "AI mixed editing completed successfully", "taskId": "task-123",
  "timelineData": { "metadata": { "total_duration": 42.0, "warnings": ["video_segments[3]: material x not found, dropped"] },
                    "timeline": { "...": "..." }, "tracks": [], "materials": [] } }
```

失败（新契约，`ErrorResponse`）：
```json
{ "success": false, "message": "No model is assigned to video editing",
  "timestamp": "2026-09-13T08:00:01", "data": null,
  "error_code": "AI_MIX_MODEL_NOT_CONFIGURED",
  "error_details": { "taskId": "task-123", "stage": "configure" } }
```
状态码与 `error_code` 对照见 §3.3 AM-07 表。前端 `http-client` 已把 `error_code` 解析为 `ApiError.code`
（`http-client.ts:219-227`），无需改动。

### 5.2 SSE：`POST /api/video-editing-agent/chat`

- 新增：流存续期间每 15s 发送注释帧 `: keepalive\n\n`（客户端 SSE 解析器按注释行忽略，并据此刷新心跳计时）。
- 行为变更（v2）：客户端观察到任一 `tool_call` 后不再自动重连，错误 `userMessage` 为 AG-01 文案。在此之前的断线
  仍会自动重连，但语义是「重启本轮」：不再发送 `Last-Event-ID`，不做基于事件 id 的去重，并通过 `onRestart`
  让上层清空本轮已显示的文本、思考内容与工具卡片。
- 请求/事件结构无变化。

### 5.3 前端内部 API（签名汇总）

```ts
// S1
replaceTimelineAction(get: () => TimelineStore, data: TimelineData, reason: ReplaceTimelineReason): boolean   // v2：轨道未变化时返回 false 且不写历史
nextExternalUpdateId(prefix: 'agent-op' | 'agent-undo' | 'agent-undo-single' | 'timeline-update'): string
reasonFromExternalUpdateId(id: string): ReplaceTimelineReason
TimelineStore.pruneSelection(): void
// S3
shouldTimelineHandleKeyEvent(event: Pick<KeyboardEvent,'defaultPrevented'|'target'>, activeElement: Element | null): boolean
shouldGlobalSpaceTogglePlayback(event: Pick<KeyboardEvent,'target'>): boolean
resolveTimelineShortcut(event: Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'|'repeat'>, isInteractiveFocus: boolean): TimelineShortcut | null
// S4
TimelineStore.externalEditLock: 'agent' | null
TimelineStore.setExternalEditLock(lock: 'agent' | null): void
// TL-01
getSubtitleReplacementBlocker(input: { isExtracting: boolean; isConfirmPending: boolean; subtitleTrack?: Pick<TrackData,'isLocked'> }): SubtitleReplacementBlocker | null
// AI 混剪
mergeAiMixTimeline(input: AiMixMergeInput): AiMixMergeResult
useAIMixedEditing(options: UseAIMixedEditingOptions): UseAIMixedEditingReturn
mapAiMixError(error: unknown, t: Translations): string
toAiMixMaterialDtos(materials: readonly MaterialItem[]): AiMixMaterialDto[]
clampFrameInterval(value: number): number
// 自动混剪
planScriptAutoMix(materials: readonly MaterialItem[]): ScriptAutoMixPlan
resolveAutoMixTargetTracks(tracks: readonly TrackData[]): { videoTrackId: string | null; audioTrackId: string | null }
applyScriptAutoMixAction(get: () => TimelineStore, plan: ScriptAutoMixPlan): ApplyAutoMixResult
toMaterialData(material: MaterialItem): MaterialData
// Agent
semanticTrackKey(track: Track | null | undefined): string
diffTimelineTracks(before: TimelineState, after: TimelineState): AgentTrackPatch[]
revertTrackPatches(current: TimelineState, patches: readonly AgentTrackPatch[]): RevertResult
OperationApplier.undoOperation(toolCallId: string): AgentUndoResult
OperationApplier.hasUndoableRecord(toolCallId: string): boolean
toNonRetryableAfterSideEffects(error: StreamError): StreamError
SSEStreamManagerConfig.onRestart?: (attempt: number) => void
StartExecutionParams.onRestart?: () => void
AgentStateManager.resetForRestart(): void
canonicalTrack(track: Track): Track
slimTrackForPatch(track: Track): Track
trackEditError(state: TimelineState, trackId: string): ToolErrorResult | null
materialTrackMismatchError(track: Track, materialType: string): ToolErrorResult | null
// 时间轴
updateSubtitleTextAction(get, itemId: string, text: string): boolean
updateImagePositionAction(get, itemId: string, position: ImagePosition): boolean
computeEffectiveVolume(itemVolume: number | undefined, trackVolume: number | undefined): number
// 导出
videoCompositionAPI.pollCompositionStatus(id, onProgress?, pollInterval?, maxAttempts?, signal?: AbortSignal)
```

---

## 6. 数据模型

### 6.1 持久化与数据库

- **无数据库 schema 变更**，无启动期 DDL（遵守「禁止破坏性 DDL」约束）。
- 项目 `project_data` 结构：`uiState` 不再写入 `isAIMixing / aiMixingProgress / isAIMixingModeModalOpen`
  （读取端保持可选、`normaliseUiState` 本就剥离）。
- 对话消息（随 `project_data.conversations` 持久化）新增可选字段 `timelineTrackPatches`（轨道已瘦身，不含
  `data:` / `blob:` 缩略图）；旧消息缺省时「撤销本轮」按钮隐藏，不做数据迁移。
- v2：新写入的 Agent 消息**不再包含 `timelineSnapshot`**（类型字段保留为可选，旧消息中的值被忽略）；
  用户停止与出错的轮次同样写入 `timelineTrackPatches`。
- 时间轴条目：图片条目新写入时不含 `originalDuration`（旧数据保留该字段但被忽略）；`transitionIn/Out`
  从此在 store 往返中保留。

### 6.2 Pydantic 模型（后端）

| 模型 | 字段 / 配置变化 |
|---|---|
| `VideoSegmentModel` | `extra: forbid → ignore` |
| `AudioSegmentModel` | `extra: forbid → ignore`；`volume: int = 200 → float = 100.0` + `normalise_volume`（倍数 ≤3 ×100，钳制 [0,200]） |
| `ImageSegmentModel` | `extra: forbid → ignore` |
| `SimplifiedTimelineModel` | `extra: forbid → ignore` |
| `AIMixedEditingErrorResponse` | 删除（改用 `ErrorResponse`） |
| `SanitizeReport`（dataclass，`timeline_parser_service.py`） | 新增：`dropped: List[str]`、`adjusted: List[str]`、`warnings()` |
| 时间轴导出数据 `metadata` | 新增可选 `warnings: List[str]` |

### 6.3 TypeScript 形状（前端）

```ts
// src/types/index.ts
export interface AgentTrackPatch { trackId: string; before: Track | null; after: Track | null }   // before/after 均经 slimTrackForPatch
// timeline uiSlice（v2 S4）
externalEditLock: 'agent' | null
// SSEStreamManagerConfig（v2 AG-01）
onRestart?: (attempt: number) => void
export interface ChatMessage { /* ...既有字段 */ timelineTrackPatches?: AgentTrackPatch[] }
// AgentTimelineOperation 的 resize_clip 分支
| { type: 'resize_clip'; clipId: string; newDuration: number; clipEnd?: number }

// timeline HistoryService
type TimelineAction['type'] = /* 既有 16 种 */ | 'REPLACE_TIMELINE'

// lib/aiMix
interface AiMixMergeInput / AiMixMergeResult          // §3.4.2
interface AutoMixPlacement / AutoMixSegmentReport / ScriptAutoMixPlan   // §3.5.1
// hooks
type AiMixStage; interface AiMixRunState; interface AiMixTimelineImpact // §3.4.3
type AgentUndoResult = { ok: true } | { ok: false; reason: 'not-found' | 'conflict' }
interface AiMixMaterialDto {
  id: string; name: string; type: 'video' | 'audio' | 'image'; format: string; size: number;
  duration?: number; width?: number; height?: number; url: string; serverUrl?: string;
  thumbnailUrl?: string; description?: string; tags?: string[]; createdAt: string;
  metadata?: { segment_id?: string; segment_number?: number; video_analysis?: unknown };
}
interface CompositionErrorDetails {
  error_summary: string; recovery_suggestions?: string[]; failed_videos?: unknown[];
  composition_stage?: string; error?: string;
}
```

### 6.4 新增 i18n key（`src/lib/i18n.ts`：接口类型、`en`、`zh-CN` 三处同步）

| 命名空间 | key | zh-CN | en |
|---|---|---|---|
| `aiMixingProgress`（新，与 `aiMixingModal` 并列） | `title` | AI 混剪 | AI Auto Edit |
| | `stepAnalyze` / `stepPlan` / `stepApply` | 分析素材 / 生成剪辑方案 / 应用到时间轴 | Analyze footage / Plan the edit / Apply to timeline |
| | `analyzingVideos` | 正在分析 {count} 个视频 | Analyzing {count} videos |
| | `planningHint` | 通常需要 30–90 秒 | Usually takes 30–90 seconds |
| | `cancel` / `cancelled` | 取消 / 已取消 AI 混剪，时间轴未改动 | Cancel / AI auto edit cancelled; timeline unchanged |
| | `done` / `success` | 已完成 / AI 混剪已完成，可按 Ctrl+Z 撤销 | Done / AI auto edit applied. Press Ctrl+Z to undo |
| | `partialWarning` | 有 {count} 个片段无效，已忽略或调整 | {count} clips were invalid and were skipped or adjusted |
| | `lockedTracksSkipped` | 目标轨道已锁定，未被修改 | Locked target tracks were left unchanged |
| | `blockedByAgent` | Agent 正在编辑时间轴，请稍后再试 | The agent is editing the timeline. Try again when it finishes |
| | `errorNoMaterials` | 请先添加视频、音频或图片素材 | Add video, audio or image materials first |
| | `errorModelNotConfigured` | 尚未为「视频剪辑」指定模型，请在 设置 → 模型设置 中配置 | No model is assigned to video editing. Set one in Settings → Models |
| | `errorUpstream` | 剪辑模型请求失败，请检查网络或模型配置后重试 | The editing model request failed. Check your network or model settings and try again |
| | `errorUnparseable` | 模型返回的剪辑方案无法使用，请重试或更换模型 | The model returned an unusable plan. Try again or switch models |
| | `errorTimeout` | AI 混剪超时，请减少素材数量后重试 | AI auto edit timed out. Try again with fewer materials |
| | `errorInvalidResponse` | 剪辑方案数据不完整 | The editing plan was incomplete |
| | `errorGeneric` | AI 混剪失败：{message} | AI auto edit failed: {message} |
| `aiMixingModal` | `replaceWarningTitle` | 将替换时间轴上的部分内容 | This will replace part of your timeline |
| | `replaceWarningBody` | 视频轨、图片轨与音频轨上的 {count} 个片段将被 AI 方案替换 | {count} clips on the video, image and audio tracks will be replaced |
| | `preservedTracks` | 以下轨道保持不变：{tracks} | These tracks stay unchanged: {tracks} |
| | `undoHint` | 完成后可按 Ctrl+Z 撤销 | You can undo with Ctrl+Z afterwards |
| `videoEditing.autoMix` | `replaceConfirmTitle` | 替换现有片段？ | Replace existing clips? |
| | `replaceConfirmBody` | 将替换视频轨 1 与音频轨 1 中的 {count} 个片段，其他轨道保持不变，可按 Ctrl+Z 撤销 | {count} clips on Video 1 and Audio 1 will be replaced. Other tracks stay unchanged. Undo with Ctrl+Z |
| | `applied` | 已按 {segments} 个段落完成排布 | Arranged {segments} segments |
| | `skippedNoAudio` | 第 {list} 段尚未生成配音，已跳过 | Segments {list} have no voice-over yet and were skipped |
| | `duplicatesIgnored` | 已忽略 {count} 个旧版本素材 | Ignored {count} outdated material versions |
| | `trackLocked` | 视频轨 1 或音频轨 1 已锁定 | Video 1 or Audio 1 is locked |
| | `noTargetTrack`（v2） | 时间轴缺少视频轨或音频轨，无法自动排布 | Add a video track and an audio track before arranging automatically |
| | `confirm` / `cancel` | 替换 / 取消 | Replace / Cancel |
| `agentUndo`（新） | `conflict` | 时间轴在该操作之后已被修改，无法单独撤销，可使用 Ctrl+Z 逐步撤销 | The timeline changed after this step, so it can't be undone on its own. Use Ctrl+Z instead |
| | `notUndoable` | 该步骤没有可撤销的时间轴改动 | This step made no timeline change to undo |
| `timeline.messages` | `replaceSubtitlesTitle` | 替换现有字幕？ | Replace existing subtitles? |
| | `replaceSubtitlesBody` | 将用识别结果替换现有 {count} 条字幕，可按 Ctrl+Z 撤销 | {count} existing subtitles will be replaced by the transcription. Undo with Ctrl+Z |
| | `subtitleTrackLocked` | 字幕轨已锁定 | The subtitle track is locked |
| | `editLockedByAgent`（v2） | Agent 正在编辑时间轴，完成后可继续编辑 | The agent is editing the timeline. You can edit again when it finishes |

---

## 7. 测试与验收

### 7.1 回归测试用例（每条缺陷至少一个，用例名描述被钉住的行为）

**后端（pytest，SQLite 内存库，`tests/`）**

| 文件 | 用例 | 钉住 |
|---|---|---|
| T1 | `test_extract_json_object_accepts_plain_fence_and_leading_prose` | AM-05 |
| T1 | `test_extract_json_object_ignores_think_block_and_braces_inside_strings` | AM-05 |
| T1 | `test_segment_models_ignore_unknown_fields` | AM-05 |
| T1 | `test_audio_volume_multiplier_is_normalised_to_percent_and_clamped` | AM-05/09 |
| T1 | `test_generate_retries_once_with_repair_prompt_then_succeeds`（mock `call_chat` 首次返回垃圾） | AM-05 |
| T1 | `test_generate_raises_plan_unparseable_after_second_failure` | AM-05 |
| T1 | `test_sanitize_drops_unknown_material_and_wrong_type_segments` | AM-06 |
| T1 | `test_sanitize_reroutes_image_referenced_in_video_segments` | AM-06 |
| T1 | `test_sanitize_clamps_clip_end_to_source_duration_and_keeps_inv3` | AM-06 |
| T1 | `test_sanitize_shifts_same_lane_overlap_and_keeps_other_lanes` | AM-06 |
| T1 | `test_parser_default_audio_item_volume_is_unity_and_track_volume_100` | AM-09 |
| T1 | `test_parser_writes_sanitize_warnings_into_metadata` | AM-06 |
| T1 | `test_service_create_uses_database_assignment`（monkeypatch `get_effective_config`） | AM-04 |
| T1 | `test_service_create_raises_not_configured_when_model_missing` | AM-04 |
| T1 | `test_router_returns_readable_error_response_with_code`（`TestClient`；断言 `message` 不含 `{'error'`，`error_code == 'AI_MIX_MODEL_NOT_CONFIGURED'`，status 503） | AM-07 |
| T2 | `test_segment_starting_at_total_duration_is_removed` / `test_segment_starting_after_total_duration_is_removed` | AM-06 |
| T3 | `test_video_cut_env_fallback_uses_llm_group_when_video_cut_url_missing` | AM-04 |

**前端（Vitest + Testing Library）**

| 文件 | 用例 | 钉住 |
|---|---|---|
| T4 | `keeps subtitle and untouched audio tracks when merging an AI plan` | AM-01 |
| T4 | `never copies AI video items onto a user-added video track` | AM-02 |
| T4 | `maps imported audio-track-2 onto audio-track-2 instead of flattening` | AM-03 |
| T4 | `renames item ids that collide with preserved tracks` / `drops items whose material is unknown` / `skips locked target tracks` / `recomputes totalDuration across all tracks` | AM-01/02 |
| T5 | `uses the most recently added TTS audio per segment (array order, not createdAt)` | AS-01 |
| T5 | `keeps the most recently matched video per video_index_in_segment even when its createdAt is older` | AS-01 |
| T5 | `trims video to the segment voice-over so segment k+1 starts in sync` | AS-02 |
| T5 | `loops segment videos when they are shorter than the voice-over` / `reuses the previous segment video when a segment has none` / `skips segments without voice-over and reports them` | AS-02 |
| T5 | `produces the same plan for the same input` | AS-02 |
| T6 | `replaceTimelineAction is undoable and redoable as one step` / `prunes selection ids that no longer exist` / `replacing with identical tracks records no history` | S1 |
| T6 | `external agent update keeps prior undo history`（渲染 `TimelinePanel` 或直接调用 effect 同等逻辑） | AG-08 |
| T7 | `two addItemAction calls in the same tick are both redoable` / `capture after undo does not overwrite the undone entry` | S2/TL-06 |
| T8 | `ignores Delete while focus is inside an aria-modal dialog` / `timeline shortcuts ignore already default-prevented events` / `Space after clicking a clip still toggles playback even though the clip prevented default` / `Space on a focused toolbar button still toggles playback` / `Space inside an aria-modal dialog or a text input is left alone` / `resolveTimelineShortcut: Ctrl+Shift+Z redoes, CapsLock Ctrl+Z undoes, Ctrl+X toggles cut, repeated S is ignored` | S3/TL-03/TL-08 |
| T9 | `cancel aborts in-flight requests and leaves the timeline unchanged` | AM-08 |
| T9 | `unmount aborts the run and ignores late responses` | AM-08 |
| T9 | `applies the merged plan as a single undoable step` | AM-01/08 |
| T9 | `maps AI_MIX_MODEL_NOT_CONFIGURED to the settings hint` / `refuses to start while the agent is executing` | AM-07/08 |
| T9 | `toAiMixMaterialDtos strips blob thumbnails and heavy metadata` | AM-08 |
| T10 | `renders English stage labels in the en locale` / `Escape and the cancel button call onCancel` / `focuses the cancel button when opened` / `shows no percentage` | AM-08 |
| T11 | `moves focus into the dialog when opened` / `frame interval field can be cleared and retyped` / `shows the replace warning only when the timeline has clips` / `Enter inside the number input does not confirm` | AM-01/10 |
| T12 | `semanticTrackKey ignores default-valued fields and float noise` / `semanticTrackKey is stable across a store round-trip that re-sorts items` / `patches drop inline data: thumbnails without causing conflicts` / `revert refuses when the track changed after the patch` / `revert re-creates a deleted track at its order` | AG-02 |
| T13 | `undoOperation preserves clips the user added after the operation`（冲突 → 拒绝、状态不变） / `undoOperation succeeds after the state went through a TimelineAggregate round-trip`（add_clip 插入到已有片段之前，经 `fromPlainObject → toPlainObject` 往返后再撤销） | AG-02 |
| T13 | `undoOperation(parentId) reverts every compose_storyboard batch record` | AG-02 |
| T13 | `add_clip of an image material sets originalMaterialType` / `resize_clip keeps duration equal to clipEnd minus clipStart` / `operations on locked tracks are skipped` | AG-04/06/07 |
| T14 | `does not auto-retry after a tool_call was observed even without its result` / `does not auto-retry after a tool_result was delivered` / `still retries a disconnect before any tool_call` / `a restart delivers every rerun event although ids restart at 0` / `a restart calls onRestart and sends no Last-Event-ID header` | AG-01 |
| T15 | `delete_clip refuses a clip on a locked track` / `move_clip refuses a locked source track` / `add_to_track rejects audio material on a video track` / `resize_clip rejects a duration past the source end` / `resize_clip allows any length for images` | AG-04/05/07 |
| T16 | `applies tool results in arrival order when delete_clip precedes move_clip` / `finalizes only after the event chain drains` / `onRestart clears the partial agent message` / `cancelled and errored turns still record timelineTrackPatches` / `new agent messages no longer carry timelineSnapshot` | AG-01/02/03 |
| T17 | `cancelDrag restores the dragged clip start time and records no history` / `pointercancel cancels an active drag` | TL-02 |
| T18 | `image items can be lengthened past their initial duration` / `image items can be extended to the left` / `legacy image items with originalDuration still extend` / `transitions survive fromPlainObject and toPlainObject` / `split clears the inner transition edges` | TL-04/09 |
| T19 | `subtitle text edit is its own undo step and survives redo` / `image position confirm is undoable` / `edits on locked tracks record nothing` | TL-05 |
| T20 | `removeItemsAction on a locked-track selection records no history and keeps redo` / `addItemAction onto a locked or incompatible explicit track adds nothing and records nothing` | TL-07 |
| T28 | `blocks while extraction is running` / `blocks while a replace confirmation is pending` / `reports a locked subtitle track` / `allows replacement otherwise`（替换本身「一步撤销」由 T6 覆盖；键位由 T8 覆盖） | TL-01 |
| T22 | `clamps item x track volume to 2` / `treats a 0% track as silent` / `falls back to defaults for non-finite input` | EX-01 |
| T23 | `exports clips on locked tracks` / `skips muted audio tracks on export` | EX-02 |
| T24 | `pollCompositionStatus surfaces error_summary` / `stops polling when aborted` | EX-03 |
| T25 | `undoOperation restores pre-state (no overlap leak via reconcile)`：断言改为 `toEqual({ ok: true })` | AG-02 |
| T26 | 空格处理器源码断言改为钉住 `shouldGlobalSpaceTogglePlayback(event)`、`!ref` 早退、`preventDefault()` 与播放/暂停分支 | TL-03 |
| T27 | `focuses the cancel button when opened` / `Enter on the focused cancel button cancels` / `Escape cancels` / `restores focus after closing` | TL-01 |
| T29 | `undo and redo are no-ops while the agent edit lock is set` / `releasing the lock restores undo` | S4 |
| T30 | `nextExternalUpdateId never repeats within the same millisecond` / `reasonFromExternalUpdateId maps agent-undo-single to agent-undo` | S1 |

测试纪律：不使用 `sleep` 同步（Vitest 用 `vi.useFakeTimers()` / 手动 resolve promise）；每个用例一个断言主题。

### 7.2 验收门禁（实现节点必须实际运行并记录输出）

| # | 命令 / 检查 | 通过标准 |
|---|---|---|
| A1 | `npm run type-check` | 0 error |
| A2 | `npm run lint` | 不新增 error（与基线 `01af364` 的 error 集合比对） |
| A3 | `npx vitest run <T4–T30 所有新文件与修改文件>`，外加受影响的现有套件：`src/components/video/timeline`、`src/lib/video-editing-agent`、`src/components/video/__tests__`、`src/components/video/projects/__tests__` | 全部通过 |
| A4 | `npx vitest run` 全量 | 失败数 ≤ 基线失败数，且无新增失败用例（先在基线跑一次记录） |
| A5 | 后端：`python -m pytest tests/test_ai_mixed_editing_hardening.py tests/test_timeline_validation_fix.py tests/test_model_settings_video_cut_fallback.py tests/test_ai_mixed_editing_video_analysis.py tests/test_video_analysis_data_flow.py -q` | 全部通过（`test_timeline_validation_fix.py` 由 8 失败 → 0 失败；评审时已在基线实测 8 failed / 2 passed，失败原因均为段模型 `extra_forbidden`） |
| A6 | `grep -rn "clearHistory()" src/components/video --include=*.tsx --include=*.ts` | 非测试文件只允许 `store/slices/historySlice.ts`（定义）与 `projects/hydrateTimeline.ts`（打开项目，按 S1 第 5 点刻意保留）；`TimelinePanel.tsx` 与 `VideoEditingInterface.tsx` 零命中（v2 RV-08） |
| A7 | `grep -rn "requestAnimationFrame(() => get().captureNextState" src/components/video/timeline` | 0 命中 |
| A8 | `grep -rn "HTTPException" backend-services/basic-service/app/routers/ai_mixed_editing_router.py` | 0 命中 |
| A9 | `grep -n "AI混剪\|混剪处理中\|取消混剪" src/components/video/components/AIMixingProgressModal/AIMixingProgressModal.tsx` | 0 命中（文案全部走 i18n） |
| A10 | `git status --porcelain` | 仅包含 §4 表中文件；无 `__pycache__`、`*.pyc`、`tsconfig.tsbuildinfo`、`.next/` |
| A11 | `grep -n "Last-Event-ID" src/lib/video-editing-agent/SSEStreamManager.ts` | 0 命中（v2 RV-01：客户端不再发送续传头，也不做基于事件 id 的去重） |
| A12 | `grep -n "toMessageUpdate(timelineSnapshot" src/components/video/hooks/useAgentExecution.ts` | 0 命中（v2 RV-03：新消息不再持久化整表快照） |

### 7.3 桌面端走查（`cd desktop && npm run dev`，逐条勾选）

1. 时间轴放入字幕与音频轨 2 的 BGM → AI 混剪 → 弹窗显示替换提示与「保留轨道」→ 完成后字幕与 BGM 仍在；Ctrl+Z 一步恢复原时间轴。
2. 新增第二条视频轨并放一个片段 → AI 混剪 → 第二条视频轨内容不变、无重复片段。
3. 仅在「设置 → 模型设置」为视频剪辑指定模型（userData `.env` 无 `VIDEO_CUT_LLM_*`）→ AI 混剪可用；清空该指定且 env 无 LLM → 提示「尚未为视频剪辑指定模型…」。
4. AI 混剪进行中点「取消」/按 Esc → 弹窗 1 秒内关闭，时间轴无改动；切换为英文界面重复，全部文案为英文。
5. 某段重新生成 TTS 两次后点「AI自动混剪」→ 该段只有最新配音；每段视频与配音起止对齐；再次点击弹出替换确认，确认后不叠加。
6. 让 Agent 在已有片段**之前**插入 1 个片段、再添加 2 个 → 结束后对第 1 步点撤销 → 撤销成功，无误报冲突（RV-02）；
   再让 Agent 添加 1 个片段，结束后手动加 1 个片段 → 对该步点撤销 → 提示冲突、不丢失手动片段；Ctrl+Z 可逐步回退 Agent 操作。
7. 锁定音频轨 1 后让 Agent「删除所有短于 2 秒的片段」→ 锁定轨片段保留，Agent 回复说明轨道被锁定。
8. 断网模拟（DevTools offline）发生在 Agent 已发出工具调用之后 → 不自动重连、无重复片段，提示文案正确；
   断网发生在 Agent 只输出了思考/文字、尚未调用工具时，恢复网络 → 自动重连后消息无重复文字、无残留「执行中」卡片（RV-01）。
9. 选中片段按 S 且字幕轨已有内容 → 先弹确认；识别中再按 S 无反应；完成后 Ctrl+Z 恢复原字幕。
10. 拖动片段途中按 Esc → 片段回到原位；打开运镜弹窗按 Delete/空格 → 时间轴与播放不受影响；关闭弹窗后
    **点选一个片段再按空格 → 正常播放/暂停**；点一下工具栏按钮再按空格 → 仍然是播放/暂停（RV-04）。
11. 图片片段拖右边缘到 12 秒 → 生效；拖左边缘向左扩展 → 时长增加（图片轨同样被自动贴紧，非首个片段提交后位置会重新
    贴紧前一片段，这是既有排布规则，RV-14）；编辑字幕文字后 Ctrl+Z 只撤销文字、Ctrl+Y 恢复。
12. 音频轨音量 200%、片段音量 150% → 导出成功（不再 422）；锁定视频轨后预览与导出仍包含该轨；静音音频轨预览与导出均无声。
13. Agent 执行期间按 Ctrl+Z / Delete / S → 无反应，工具栏撤销/重做/删除置灰并提示「Agent 正在编辑时间轴」；执行结束后恢复，
    Ctrl+Z 可逐步回退（RV-05）。
14. 字幕轨已有内容时按 S → 弹出确认框，焦点在「取消」；此时再按 S 无反应；按 Esc 关闭，且未发起识别请求（RV-06）。

---

## 8. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | S1 让每次外部写入（尤其 Agent 高频操作）都产生完整快照历史，内存上升 | 长会话内存增加 | `HistoryService` 已有 50 条上限；快照为纯对象；T6 验证上限仍生效 |
| R2 | S2 改为同步捕获后，若某个 action 实际依赖异步后处理，after 快照会过早 | 重做结果不完整 | 所有 action 已核实为同步（Zustand `set` + `_syncDerivedState`）；T7 + 全量 vitest；dragSlice 三处提交路径各有用例 |
| R3 | AI 混剪行为变化：不再清空字幕/音轨 2，老用户可能期望「全量替换」 | 预期差异 | 模式弹窗明示「将替换 / 保留」的轨道；结果可 Ctrl+Z；需要清空的用户可手动删除 |
| R4 | `volume` 倍数判定（0<v≤3 视为倍数）对「3% 音量」等极小百分比产生误判 | 极端值偏差 | 提示词明确百分比；AI 混剪场景 3% 以下无实际意义；T1 固化边界 |
| R5 | 解析失败重试使 LLM 调用最多翻倍 | 耗时/费用 | 仅在解析失败时重试 1 次；成功路径不变；日志记录 attempt |
| R6 | Agent 补丁冲突判定过严，用户在无关轨道编辑也被拒；或 store 往返的结构差异导致误报 | 撤销不可用 | 补丁按轨道粒度，只比较被操作的轨道；v2 语义键先经领域层规整并对 items 排序，屏蔽默认值与浮点噪声，T12 / T13 用真实往返钉住；拒绝时提示改用 Ctrl+Z（S1 保证可用） |
| R7 | 旧对话消息无补丁，「撤销本轮」按钮消失 | 旧会话失去该按钮 | 可接受：旧实现会覆盖用户编辑，属于数据风险；Ctrl+Z 历史仍可用 |
| R8 | 观察到 tool_call 后不再自动重连，瞬时网络抖动会中断长任务 | 需要用户手动继续 | 全程 keepalive 大幅降低心跳误判；工具调用之前仍自动重连（干净重启）；已应用的更改保留；错误文案引导继续对话 |
| R9 | EX-02 锁定轨参与预览/导出，改变了「锁定=隐藏」的既有使用习惯 | 预期差异 | 锁定语义回归领域定义（`Track.ts:8`）；隐藏请用可见性开关；更新相关测试用例名体现新语义 |
| R10 | `i18n.ts` 体积大、三处同步易漏 | 类型错误或缺文案 | 先改接口类型，`npm run type-check` 会强制 en/zh 两处补齐 |
| R11 | `VideoEditingInterface.tsx`（~2990 行）改动面大，易与其他分支冲突 | 合并冲突 | 编排逻辑外移到 F24；按 §9 分组提交，每组独立可验证 |
| R12 | 中止前端请求不会停止后端 LLM 调用 | 后台多消耗 ≤120s | 结果被 `runIdRef` 丢弃；与现有 ARK 超时策略一致，文档化即可 |
| R13 | 自动混剪跳过无配音段落，部分画面不会上轨 | 用户困惑 | 明确 warning 列出段号；与「自动混剪需要配音」既有提示一致 |
| R14 | S4 外部编辑锁未解除（执行状态卡在 executing） | 时间轴长时间无法键盘编辑 | 锁只由 `agentIsExecuting` 驱动，执行状态已有完成、出错、取消、卸载四种终止路径；VEI 卸载时置 `null`；锁不影响播放、复制与导出 |
| R15 | 重连即重启，会清空用户已经看到的半截回复 | 视觉跳变 | 只在尚无工具调用时发生；状态条显示「重试中」（`useAgentExecutionState` 已有 `retrying`）；换来的是无重复文本、无幽灵卡片 |
| R16 | 新消息不再持久化 `timelineSnapshot` | 依赖该字段的外部逻辑失效 | 全仓唯一消费者是被替换的整表撤销（grep 核实）；类型字段保留为可选，旧数据不受影响 |

---

## 9. 实施顺序与提交分组

实现节点按下列顺序推进，每组完成后运行该组测试再进入下一组（最终由提交节点统一 `feat:` 提交，
暂存时逐文件 `git add <path>`，禁止 `git add -A`）：

1. **G1 共享机制**：F1–F3、F6–F9、F48、F51，以及 F5 / F18 / F25 中的 S4 部分；测试 T6–T8、T29、T30（S1/S2/S3/S4；S1 与 S4 必须同组）。先跑现有 `timeline` 全部测试，确认零回归。
2. **G2 时间轴手动剪辑**：F5、F10–F15、F17、F18、F49、F50、T17–T20、T26–T28（TL-01…TL-09）。
3. **G3 导出一致性**：F19、F20、F29、F31、T22–T24（EX-01…EX-03）。
4. **G4 AI 混剪后端**：B1–B6、T1–T3（AM-04/05/06/07/09）。
5. **G5 AI 混剪前端**：F21、F24–F28、F32（AI 部分）、T4、T9–T11（AM-01/02/03/08/10）。
6. **G6 自动混剪**：F22、F23、F25（自动混剪部分）、F32（autoMix 部分）、T5（AS-01/02）。
7. **G7 剪辑 Agent**：F33–F47、T12–T16、T25（AG-01…AG-08）。
8. **G8 全量门禁**：§7.2 A1–A10 + §7.3 桌面走查。

若实现中发现本方案缺陷，记录到本文件末尾「实施过程发现的方案缺陷」段（由实现节点新增）。

---

## 附录 A：已证实、未纳入本轮的缺陷（第 2、3 轮输入）

| ID | 级别 | 标题 | 证据 |
|---|---|---|---|
| BL-01 | P1 | 多视频轨导出：上层轨在片段前为黑、结束后冻结末帧覆盖下层（`tpad` 黑填充 + `overlay` 默认 `eof_action=repeat`） | `filtergraph_builder.py:262-275,321-334` |
| BL-02 | P2 | 同轨片段间空隙在导出中被压缩（concat 忽略 `start_time`）；UI 路径因 `autoOrganize` 贴紧而少见，Agent/导入数据可触发 | `video_composition_service.py:254-268`；`filtergraph_builder.py:312-314` |
| BL-03 | P1 | 导出总时长按片段时长求和而非时间轴最大结束时间 | `video_composition_service.py:1018-1040`；`useVideoExport.ts:321,629` |
| BL-04 | P1 | 连续 dissolve 的 `xfade` offset 计算错误，后续片段整体提前 | `filtergraph_builder.py:306-311` |
| BL-05 | P1 | 底层/单轨视频的淡入淡出与不透明度在 yuv420p 导出中无效 *[实测]* | `filtergraph_builder.py:171-182,327` |
| BL-06 | P1 | 导出字幕全部使用第一条字幕的样式；空文本字幕以 item 名导出 | `video_composition_service.py:2431-2438,2721-2726`；`useVideoExport.ts:465` |
| BL-07 | P1 | 图片叠加导出忽略 opacity（`|| 1.0` 使 0 变 1）与 zIndex 顺序 | `camera_motion.py:1279-1282`；`video_composition_service.py:2672-2674`；`useVideoExport.ts:275,517` |
| BL-08 | P1 | 图片/字幕/单条音频处理失败被吞掉，任务仍「completed」且无 warning | `video_composition_service.py:1633-1650,2028-2030,2258-2277` |
| BL-09 | P2 | 仅图片 + 音频的时间轴无法导出（`video_items` 必须非空） | `videoComposition.ts:218-222`；`video_router.py` |
| BL-10 | P2 | 导出轮询 10 分钟硬上限、无用户取消入口 | `videoComposition.ts:310`；`VideoPlayerPanel.tsx:732-737` |
| BL-11 | P1 | `move_clip / add_to_track` 结果返回请求位置而非重排后的实际位置；无法把片段移到最前 | `tools/moveClip.ts:46-65`；`reconcile.ts:90-99` |
| BL-12 | P2 | 客户端对已不存在的 clip/track 静默 no-op 仍报成功；目标轨缺失时片段被删除 | `OperationApplier.ts:496-516` |
| BL-13 | P2 | `get_timeline` 缺 `originalMaterialType / text / audioDetached / transitions / isVisible` | `tools/getTimeline.ts:18-38` |
| BL-14 | P2 | `AIVideoGenerateService` 同样绕过模型设置（当前无前端调用方） | `ai_video_generate_service.py:21-31` |
| BL-15 | P1 | 分离音频被 `organizeVideoAudioTracks` 贴紧到 0 或其他位置，与视频错位 *[实测]*；且 UI 无分离入口（`Track.tsx` 未传 `onDetachAudio`） | `TimelineAggregate.ts:257-263,698`；`detachAudio.ts:63` |
| BL-16 | P1 | 拖拽左边缘裁剪不平移运镜窗口（`resizeItemAction` 无调用方） *[实测]* | `dragSlice.ts:205-214`；`resizeItem.ts:39-48` |
| BL-17 | P2 | 撤销后选区保留已不存在 id，随后 Delete 清空重做栈 *[实测]* | `historySlice.ts:105-115` |
| BL-18 | P2 | 撤销/重做同时重置缩放、滚动、播放头与播放状态 *[实测]* | `TimelineAggregate.ts:602-613` |
| BL-19 | P2 | 左边缘裁剪在无 clip 信息的旧条目上裁错端、未固定右端 *[实测]* | `TimelineItem.ts:377-392` |
| BL-20 | P1 | 短片段（<16px）无法移动、未选中片段 8px 隐形边缘误触发裁剪 | `dragMachine.ts:24,42-54`；`TimelineItem.tsx:691-702` |
| BL-21 | P2 | Ctrl+滚轮缩放不以光标为锚点；React 被动监听使 `preventDefault` 无效 | `TrackContainer.tsx:276-284`；`TimelineRuler.tsx:278-286` |
| BL-22 | P2 | 点击轨道空白处无法取消选择 | `TrackContainer.tsx:130-134` |
| BL-23 | P2 | 时间显示浮点误差丢失 0.01 秒（2.3 → 0:02.29） *[实测]* | `timeFormat.ts:15` |
| BL-24 | P2 | 音量滑块拖动中按 Esc 仍提交拖动值 | `VolumeSlider.tsx:224-233,308-321` |
| BL-25 | P2 | 切分/裁剪后句子分段条不考虑 clipStart；「句」硬编码中文 | `SentenceSegmentBar.tsx:47-50`；`TimelineItem.tsx:464-471,494` |
| BL-26 | P2 | 工具栏状态恒显示「选择」、剪切按钮无 `aria-pressed`；标尺右键也会跳转 | `TimelineToolbar.tsx:297-326,394` |
| BL-27 | P2 | `OperationApplier` 默认时间轴与服务端 route 的默认时间轴重复定义 | `OperationApplier.ts:108-124`；`chat/route.ts:244-256` |
| BL-28 | P2 | 单步撤销记录只存在于当前一次执行的 `OperationApplier`，历史消息上的单步撤销按钮点击后只能提示「不可撤销」（v2 评审 RV-21） | `useAgentExecution.ts:235-246`；`AgentResponseNode.tsx:79-81` |
| BL-29 | P2 | 键盘聚焦（`:focus-visible`）的按钮上按空格仍触发全局播放而不是激活按钮，影响纯键盘用户（v2 评审 RV-04 的取舍） | `VideoEditingInterface.tsx:422-433` |
| BL-30 | P2 | `useAgentExecutionState` 在 SSE 结束时立即置 `completed`，早于事件链排空，S4 锁提前数十毫秒解除（v2 评审 RV-22） | `useAgentExecutionState.ts:252-255` |
| BL-31 | P2 | 合成状态接口的兜底分支可返回 `status: "error"`，而 `pollCompositionStatus` 只在 `failed` 时终止，会一直轮询到 300 次上限；TS 状态类型也不含 `'error'`（实现节点 IM-15） | `video_router.py:226-247`；`videoComposition.ts` `pollCompositionStatus` |
| BL-32 | P2 | 组件卸载路径只取消并销毁执行，不调用 `sealMessage`，卸载时仍在进行的轮次不写 `timelineTrackPatches`（RV-03 声称三个终止路径全覆盖，卸载实际不在其中；实现节点 IM-23） | `useAgentExecution.ts` 卸载清理 effect |
| BL-33 | P2 | 主题色以 `var(--x)` 原样定义（无 `<alpha-value>`），Tailwind 3.4 对 `bg-primary/15` 等透明度修饰不生成样式，仓库内此类 class 实际无效（如 `TimelineToolbar` 激活态、选中计数徽标）；本轮两个 AI 混剪弹窗已改用实色 token（实现节点 IM-36） | `tailwind.config.js:41-43`；`TimelineToolbar.tsx` |

---

## 附录 B：已核查为正确的项（后续评审无需重复）

- 剪辑时间单位全链路为秒（工具 schema、store、合成器、后端）；没有逐片段变速字段。
- 片段裁剪在预览（`clipStart + 偏移`）与导出（`-ss clip_start -t clip_end-clip_start`）一致；分离音频不会重复出声。
- 视频轨 z 序：`track.order` 升序 = 自下而上，预览与导出一致；隐藏轨道两端都排除。
- 导出请求不含 `blob:` / media-proxy / preview-proxy URL；输出宽高始终为偶数。
- 切分数学、`splitAction` 单条历史、跨轨移动先校验再移除、`totalDuration` 每次变更重算、`HistoryService` 截断逻辑、`swapItems` 校验、拖拽提交先回滚再记录、轨道音量手势单条历史——均正确且有测试。
- 快捷键：文本输入框内被忽略；监听只注册一次并通过 ref 读取最新处理器；播放头拖动与键盘移动均钳制在 `[0, totalDuration]`；缩放范围钳制 0.1–5；`VolumeSlider` 拖动中已实时写入预览值。
- Agent：重排跳过锁定与字幕轨且幂等；抛异常的工具 `operation: null` 不会被应用；用户点击停止时忙碌条正确消失；`messageConverter` 为每个历史工具调用补全结果。
- `AIMixingProgressModal` / `AIMixingModeSelectionModal` 已带 `aria-modal="true"`，适用 S3。
- `normaliseUiState`（`src/lib/api/videoProjects.ts`）已剥离 AI 混剪瞬态标志，重开项目不会恢复卡死的进度弹窗。

---

## 评审结论

**有条件通过**（v2）

v1 的缺陷定位扎实：抽查的 20 余处证据行号与基线代码一致，后端基线失败数经实测吻合；S1 / S2 的前提成立，范围与
「每轮 ≥10 个问题并逐一修复」的需求匹配。本次评审共提出 **23 项**问题（P0×2、P1×7、P2×14）。

- 两个 P0 属于同一类：修复在真实应用中失效，单测却会全绿。一是 AG-01 重连前的路径仍会丢事件或重复事件；
  二是 AG-02 的补丁冲突判定没有考虑 store 往返带来的结构规整。
- 7 个 P1 分别是：核心空格快捷键回归、S1 引入的执行中撤销导致状态分叉、字幕确认框可被重入、自动混剪「取最新」的
  判断依据有误、整轮撤销覆盖不全且持久化膨胀、A6 门禁自相矛盾、文件清单漏列必然失败的现有测试。

**全部 P0 / P1 已在正文就地修复**；P2 中 11 项一并修复，3 项记录为实施注意事项或附录 A（BL-28～BL-30）。

放行条件（实现节点与提交节点必须满足）：

| # | 条件 | 验证方式 |
|---|---|---|
| C-1 | S1（可撤销整表替换）与 S4（外部编辑锁）必须在同一提交组 G1 落地，任何中间状态都不得出现「S1 已生效而 S4 未生效」 | 对应提交同时包含 `store/actions/replaceTimeline.ts` 与 `uiSlice.ts` 的 `externalEditLock` |
| C-2 | AG-01 / AG-02 必须有「真实往返」测试：T12 / T13 至少一条经 `TimelineAggregate.fromPlainObject(...).toPlainObject()` 往返后撤销不误报冲突；T14 至少一条「事件 id 从 0 重启时，重跑事件全部送达」。只在未经 store 的内存状态上验证不算通过 | A3 输出中出现对应用例名且通过 |
| C-3 | 实现节点先在基线 `01af364` 记录 vitest 与 pytest 的失败集合，再按 v2 §7.2 A1–A12 比对；A6 按 v2 修订后的口径执行 | 基线与结果记录在「实施过程发现的方案缺陷」段或提交说明中 |
| C-4 | 桌面走查 §7.3 第 6、8、10、13、14 条为发布前必过项（覆盖 RV-01 / 02 / 04 / 05 / 06 这类单测无法完全证伪的交互） | 走查记录逐条勾选 |
| C-5 | 规模取舍：若实施受阻，按 G1 → G2 → G7 → G4 → G5 → G3 → G6 的优先级推进；任何一组不得半完成提交；未完成项写入「实施过程发现的方案缺陷」段并回填附录 A | 提交分组与文档记录 |
| C-6 | 不新增任何 `clearHistory()` 调用；新增文案一律「接口类型 / en / zh-CN」三处同步；不改数据库 schema、不引入启动期 DDL | A1、A6、`git diff --stat` |

---

## 实施过程发现的方案缺陷

> 记录节点：代码开发（实现节点）。每条均已按「采取的做法」落地，未静默偏离方案。
>
> **基线实测（条件 C-3，`01af364`，独立 worktree 运行）**：`vitest run` 204 个文件 / 1811 个用例全部通过；
> `tsc --noEmit` 0 error；`next lint` 8 个 error（均位于本轮未触及的文件）；
> `pytest tests/test_timeline_validation_fix.py tests/test_ai_mixed_editing_video_analysis.py tests/test_video_analysis_data_flow.py`
> 8 failed / 19 passed（与评审记录一致）。

### I.1 共享机制与手动剪辑（G1 / G2）

| ID | 方案位置 | 发现 | 采取的做法 |
|---|---|---|---|
| IM-01 | §3.2 S3 / S4 `MUTATING_TIMELINE_SHORTCUTS` | 漏了 `copy`：时间轴的 Ctrl+C（`handleCopy`）不是写剪贴板，而是把选中片段复制到轨道末尾并写历史，属于改写时间轴；Agent 执行中按下同样会让客户端与 Agent 状态分叉 | `copy` 纳入集合；键盘路径先判定 `shouldTimelineHandleCopyShortcut`（选中 DOM 文本时仍交给原生复制）再判锁；工具栏复制按钮在锁定时同样置灰并提示 |
| IM-02 | §3.2 S2 | 清单漏了 `TimelinePanel.handleCopy` 与 `handleOrganizeMaterials` 两处 `requestAnimationFrame(() => useTimelineStore.getState().captureNextState())`（A7 的 grep 模式匹配不到），存在同样的 TL-06 重做丢失 | 一并改为同步捕获 |
| IM-03 | §3.2 S1、§7.2 A6 | `TimelinePanel.handleImportJSON`（`:1010-1011`）同样是 `importFromData + clearHistory`；S1 只在「效果」里提到文件导入，没有列为改动点，不改则 A6「TimelinePanel 零命中」无法通过 | 改为 `replaceTimelineAction(..., 'import')`；随后 VEI `handleImportComplete` 触发的外部同步因规整后轨道一致返回 `false`，不会产生第二条历史 |
| IM-04 | §3.7 TL-01 | ① 「无音频条目 / 无字幕轨」的本地校验原在请求之后，按 v2 顺序会出现「先确认替换、再提示没有音频」；② 确认按钮需要动词文案，§6.4 未列 key；③ 把 `{ count, resolve }` 放进 state，关闭动画期间文案会闪回 0，且在 state updater 中 resolve 属于副作用 | ① 两项本地校验前移到确认之前；② 新增 `timeline.messages.replaceSubtitlesConfirm`（Replace / 替换，接口类型与 en、zh-CN 三处同步），取消文案复用 `t.common.cancel`；③ resolver 放入 ref（同时充当「确认待定」守卫，取代单独的 `subtitleConfirmPendingRef`），state 只存 `{ isOpen, count }`，面板卸载时以 `false` 结算 |
| IM-05 | §3.7 TL-07 第 5 点 | `computeItemStyles` 以内联 `cursor: grab` 设置鼠标样式，追加 `cursor-not-allowed` class 会被内联样式覆盖 | 锁定轨条目以内联样式覆盖为 `cursor: 'not-allowed'`；锁定轨的选中条目不再渲染裁剪手柄（手柄在锁定轨上不可用，显示即误导） |
| IM-06 | §3.7 TL-04 | `TimelineItem` 实体从 `DurationCalculationService` 导入 `MIN_DURATION_SECONDS`，而该服务运行时导入 `Track` → `TimelineItem`，形成 entity→service→entity 的 ESM 循环。常量只在方法调用时读取，当前安全；若日后在模块顶层使用会触发 TDZ | 按方案复用常量，风险记录于此；第 2 轮若调整领域分层，应把该常量下沉到 `value-objects` |
| IM-07 | §4.5 文件清单 | 两个现有源码断言测试必然被打挂而未列入：`timeline/__tests__/TimelineItem.localDownload.test.ts`（钉住 TimelinePanel 内联的 MaterialData 构造，F13 抽出 `toMaterialData` 后失效）；`video/__tests__/VideoEditingInterface.timelineStoreMirror.test.tsx`（钉住 `updateItemImagePosition` 直调，TL-05 后失效） | 断言改为钉住新的调用形态：`addItemAction(..., toMaterialData(material))` 与 `toMaterialData` 的字段映射；`updateImagePositionAction(() => useTimelineStore.getState(), itemId, position)` |
| IM-08 | §7.1 T17 / T27 测试环境 | 仓库 `tsconfig` 为 `jsx: preserve`，Vitest 的 esbuild 遵循该设置，无法直接 import `.tsx` 组件；jsdom 环境下 `fs` 被 Vite 外部化（加载即报 `No such built-in module: node:`） | T17 使用 `@vitest-environment node`（store 与状态机无需 DOM，`pointercancel` / `blur` 监听按项目惯例做源码断言）；T27 以 `?raw` 导入组件源码、经 TypeScript API 转译后用 Testing Library 真实渲染 |
| IM-09 | §3.5.3 AS-02、§3.2 S4 | S4 只覆盖键盘与工具栏，素材面板的「AI 自动混剪」按钮不在时间轴遮罩之下，Agent 执行中点击同样会整轨改写 | `handleAutoMixAudio` 与确认后的应用路径都先检查 `externalEditLock`，锁定时提示 `timeline.messages.editLockedByAgent` 并返回 |

### I.2 导出一致性（G3）

| ID | 方案位置 | 发现 | 采取的做法 |
|---|---|---|---|
| IM-10 | §3.8 EX-03 第 2 点 | `CompositionStatusResponse` 没有 `message` 字段；状态接口在 `error_details` 之外返回顶层 `error`（`video_router.py:226-247`） | 失败消息取值顺序改为 `error_summary → error_details.error → error → 'Unknown error'`，跳过空白串，保留原有 `Composition failed: ` 前缀；`CompositionStatusResponse` 增加 `error?: string` |
| IM-11 | §3.8 EX-03 第 1 点 | 异步异常路径只写 `{ error }`（`video_composition_service.py:997`），`error_summary` 并非必有字段 | `CompositionErrorDetails` 所有字段均为可选 |
| IM-12 | §3.8 EX-02 | 清单漏了 `useVideoExport.ts:43,65` 的 `calculateVideoTrackDuration / calculateAudioTrackDuration` 同样排除锁定轨；只改构建循环会让锁定视频轨按 0 秒计算，触发「视频轨过短」误拦截导出 | 统一走模块私有谓词 `isTrackExported`，并补回归用例 |
| IM-13 | §3.8 EX-02 第 1 点 | `expectedAudioItemCount` 只统计音频类型轨，而构建循环从所有通过过滤的轨道收集音频条目，两者口径不一 | 两处统一为 `isTrackExported(track) && item.type === 'audio'` |
| IM-14 | §3.8 EX-03 第 3 点 | `finally` 中 2 秒后的延迟重置会调用 `setExportProgress(0)`，中止路径同样需要跳过 | 只有「自身 signal 已中止且错误名为 `AbortError`」才视为中止并跳过提示与重置；`http-client` 自身的超时 `AbortError` 仍正常提示 |
| IM-15 | §3.8 EX-02 第 4 点 | 全仓核查后，现有 `isLocked: true` 用例都在测编辑行为（swap / organize / split / 运镜资格 / reconcile），没有断言「预览或导出排除锁定轨」的用例；另发现兜底状态 `status: "error"` 不终止轮询（范围外） | 无需修改现有测试；轮询问题列入附录 A BL-31 |

### I.3 AI 混剪后端（G4）

| ID | 方案位置 | 发现 | 采取的做法 |
|---|---|---|---|
| IM-16 | §4.4 文件清单 | `app/models/__init__.py` 同样导入并在 `__all__` 中导出 `AIMixedEditingErrorResponse`；只删类会导致应用启动失败 | 同步删除该文件中的两处引用（全仓无其他使用方） |
| IM-17 | §3.3 AM-07 表中 400 一行 | `AIMixedEditingRequest` 已要求非空 `taskId` 与至少一个素材，FastAPI 在进入路由前即以 422 `VALIDATION_ERROR` 拒绝；`AI_MIX_INVALID_REQUEST` 实际只会在 `taskId` 为纯空白时出现 | 保留该检查（覆盖纯空白 `taskId`）；前端错误映射不受影响 |
| IM-18 | B6 | `get_effective_config` 在基线已有 98 行，继续内联组回退会进一步超出 60 行上限 | VIDEO_CUT 组回退抽为 `_video_cut_env_group(settings)`，逻辑与方案一致（含 RV-10 的 key 回退） |
| IM-19 | §3.3 AM-06 | 方案列出的 4 个私有方法不足以把 `sanitize_simplified_timeline` 控制在 60 行内 | 另增 `_keep_matching_type / _normalise_segment_range / _shift_lane_overlaps`；`validate_simplified_timeline` 的三类片段共用一个「裁剪并移除」helper |
| IM-20 | §3.3 AM-05 / AM-06 未定细节 | 方案未规定的边界行为 | 同道重叠后移只改 `start_time`、保留列表顺序；`metadata.warnings` 恒写入（无警告为空列表）；`volume: 0` 视为静音而非倍数；上游异常文本为空（超时类）时回退为异常类型名；提示词音量行实际只在 `:318` |

### I.4 AI 混剪前端与自动混剪（G5 / G6）

| ID | 方案位置 | 发现 | 采取的做法 |
|---|---|---|---|
| IM-30 | §7.1 T10 / T11 | 与 IM-08 同因：`jsx: preserve` 下无法 import 弹窗组件，jsdom 拒绝 `fs` | T10 / T11 与 T27 统一以 `?raw` 导入源码、`typescript.transpileModule` 编译后真实渲染（每处 `?raw` 导入需 `@ts-expect-error`）；第 2 轮可评估在 Vitest 配置中把 JSX 设为 `automatic` 以去掉该变通 |
| IM-31 | §3.5.2 AS-02 | 方案只给出 `resolveAutoMixTargetTracks`，确认框前置检查（RV-17）与 action 内部检查若各写一套，拒绝理由可能不一致；另外排布未用到的 lane 不应被清空 | 新增 `checkAutoMixTargets(tracks, plan)`，确认框前与 action 内共用；只替换排布实际用到的 lane，未用到的轨道原样保留 |
| IM-32 | §3.4.2 合并规则 | 方案未覆盖的合并边界 | 某 lane 的 AI 片段全部被丢弃时保留用户原有片段；多个导入轨解析到同一目标轨时先合并再去重叠；模式弹窗的影响估算复用 `findAiMixTargetTrack`，与实际合并使用同一套目标轨规则 |
| IM-33 | §3.4.3 AM-08 | ① 只在 applying 之前丢弃过期结果不够，取消 / 卸载后分析或规划阶段的 resolve 仍会触发 setState；② 合并结果没有任何轨道变化时提示「已完成，可按 Ctrl+Z 撤销」会误导；③ `cancelled` / `error` 与回到 `idle` 在同一 tick 设置会被 React 批处理吞掉 | ① 每个 await 之后都检查 signal 与 runId；② 无变化时按 `errorInvalidResponse` 报错；③ 这两个阶段经 0 ms 定时器回到 `idle`（卸载时清除） |
| IM-34 | §3.4.3 F28 | 转发到内部 controller 的 abort 监听在请求结束后未移除，长会话中会累积 | 请求结束后移除该监听 |
| IM-35 | §3.4.4 AM-10 | ① 帧间隔输入位于「专业模式」单选卡片内部，在输入框里按方向键会切换模式；② 焦点进入对话框后缺少 Tab 焦点圈定；③ 按下发生在卡片内、松开在背景上时会误关闭；④ 关闭时无条件还原焦点，会抢走同时打开的进度弹窗的焦点；⑤ `Intl.ListFormat` 不在 TS `lib: es6` 中 | ① 输入框移出单选卡片；只保留一个字符串 state，提交时再派生数值；② 增加 Tab 焦点圈定，按钮获得焦点时 Enter 不再确认；③ 只有按下也发生在背景上时才关闭；④ 仅当焦点仍在对话框内时才还原；⑤ 轨道名分隔符 zh-CN 用「、」，其他语言用「, 」 |
| IM-36 | §3.4.4 样式 | 实现节点报告：主题色以 `var(--x)` 原样定义，Tailwind 3.4 对 `bg-primary/10` 这类透明度修饰不生成样式，原弹窗的此类 class 实际无效 | 两个弹窗改用不带透明度修饰的实色 token；方案指定的 amber 警示色按原样生效；仓库其他位置的同类 class 列入附录 A BL-33 待核实 |
| IM-37 | §3.5.1 AS-01 / AS-02 | 排布算法的未定细节 | 时长 < 0.1 s 的视频视为不可播放；段号取该段最新素材的 `segment_number`；既复用其他段视频又循环填充时报告 `video-reused`；段末不足 0.1 s 的余量按方案规则会留下极小空隙（`MIN_CLIP_SECONDS`） |

### I.5 剪辑 Agent（G7）

| ID | 方案位置 | 发现 | 采取的做法 |
|---|---|---|---|
| IM-21 | §3.6 AG-02 第 1 点（基线既有缺陷） | 执行中切换对话时，`sealMessage` 读取的 `activeConversationIdRef` 已指向新对话，被停止的轮次会写进新对话并覆盖其消息 | 发送时记录 `turnConversationIdRef`，停止/出错/完成都写回该轮所属的对话 |
| IM-22 | §3.6 AG-05 | `getDefaultTrackForType` 取「第一个未锁定的视频轨」，可能是 `image-track-1`；叠加 AG-05 的类型校验后，视频轨 1 锁定时添加视频会直接失败而不是自动建轨 | 默认轨只在「未锁定且 `canAcceptMaterial` 为真」的轨道中选取（同时影响 `compose_storyboard`）；`add_to_track` 在自动建轨之前先做类型校验 |
| IM-23 | §3.6 AG-02 / 评审 RV-03 | RV-03 称停止、出错、卸载三条终止路径都写补丁，但卸载清理只取消并销毁执行，不经过 `sealMessage` | 未改动（改动卸载时序风险高于收益），列入附录 A BL-32 |
| IM-24 | §3.6 AG-01 第 1 点 | 「观察到 tool_call 即不重连」若对所有错误生效，会把取消、4xx 等不可重试错误的原有文案替换掉 | 仅对本应重试的可恢复错误改为终止并使用 AG-01 文案（也覆盖重试次数耗尽的情形）；`resetForRestart` 放在退避等待之后执行，退避期间取消时保留已显示的内容 |
| IM-25 | §3.6 AG-04 防御 | 方案只列 delete / trim / resize / move；批量工具可能把 `add_clip` 下发到锁定轨 | `OperationApplier` 的锁定跳过同样覆盖 `add_clip`，且在删除动画延迟之前判定；没有产生时间轴变化的操作不记补丁、不再触发外部时间轴更新 |
| IM-26 | §3.6 AG-03 | ① 方案要求发送时重置 `eventChainRef`，但被停止的上一轮可能仍有已收到的操作在链上排队，重置会让新一轮与之并发；② `timelineSnapshotRef` 可能在排队写入执行前被新一轮覆盖 | ① 不重置事件链，新一轮排在上一轮之后；`onRestart` 同样经事件链串行；② `computeTurnPatches` 改为接收该轮起点作为参数，封口时先捕获再入链 |
| IM-27 | §3.6 AG-02 `slimTrackForPatch` | 补丁剔除内联缩略图后，撤销恢复出的片段会丢失缩略图 | 恢复时对仍在实时轨道上的片段回填其当前缩略图 |
| IM-28 | §3.6 AG-05 `move_clip` | 旧数据中的图片片段可能没有 `originalMaterialType`，同轨移动时按 `type='video'` 做类型校验会误拒 | 同轨移动跳过类型校验（同轨移动不可能产生类型不匹配）；跨轨移动照常校验 |
| IM-29 | 其他实现细节 | 方案未定或需要微调的细节 | `toMessageUpdate()` 去掉参数；`AgentUndoResult` 定义在 `OperationApplier.ts`；`tools/index.ts` 增加 `ToolErrorResult` 类型与 `toolErrorResponse` 封装（仅新调用点使用）；`trackPatch.ts` 直接从实体文件导入 `Track`；tsconfig 目标为 ES5，避免 `Set` / `Map` 迭代；类型不匹配文案按首字母选用 A / An（模型会读取该文案） |

### I.6 实施验证记录（§7.2 门禁，实现节点实际运行）

| # | 结果 | 说明 |
|---|---|---|
| A1 | 通过 | `tsc --noEmit` 0 error（基线 0） |
| A2 | 通过 | `next lint` error 集合与基线逐条一致（8 条，均位于本轮未触及的文件）；本轮新增 / 修改文件 0 error |
| A3 / A4 | 通过 | `vitest run` 全量 228 个文件 / 1967 个用例，0 失败（基线 204 / 1811 / 0），无新增失败；T4–T30 及受影响的现有套件均在其中通过；C-2 要求的 T12 / T13 store 真实往返用例与 T14「事件 id 从 0 重启时重跑事件全部送达」用例通过 |
| A5 | 通过 | 5 个后端测试文件 66 passed（基线其中 3 个文件为 8 failed / 19 passed） |
| A6 | 通过 | 非测试命中仅 `projects/hydrateTimeline.ts:72,103`（按 S1 第 5 点保留）与 `store/actions/historyActions.ts:29`（基线既有的 `clearHistoryAction` 薄封装定义，仅被 barrel 再导出、无调用方，不是调用点）；`TimelinePanel.tsx` 与 `VideoEditingInterface.tsx` 零命中 |
| A7 | 通过 | 0 命中（另含 IM-02 两处 TimelinePanel 内的延迟捕获，也已改为同步） |
| A8 | 通过 | `ai_mixed_editing_router.py` 中 `HTTPException` 0 命中 |
| A9 | 通过 | `AIMixingProgressModal.tsx` 硬编码中文 0 命中 |
| A10 | 通过 | `git status` 仅含 §4 文件、IM-07 / IM-16 所列文件与新增测试（含 G5 追加的 `applyScriptAutoMix.test.ts`）；无 `__pycache__`、`*.pyc`、`tsconfig.tsbuildinfo`、`.next/` |
| A11 | 通过 | `SSEStreamManager.ts` 中 `Last-Event-ID` 0 命中 |
| A12 | 通过 | `useAgentExecution.ts` 中 `toMessageUpdate(timelineSnapshot` 0 命中 |
| 构建 | 通过 | `npm run build`：Compiled successfully，83/83 静态页面生成 |

未在本节点完成、需后续节点确认的条件：

- **C-1**：S1（`replaceTimeline.ts`）与 S4（`uiSlice.ts` 的 `externalEditLock`）已在同一工作区落地，提交节点须放入同一提交。
- **C-4**：§7.3 桌面走查（尤其第 6、8、10、13、14 条）需要交互式 Electron 会话，本节点未执行，发布前必须由提交节点或人工逐条勾选。

---

## 代码评审记录（提交节点）

> 评审节点：代码 Review、修复与提交。评审方式：以 v2 §2–§9 与「实施过程发现的方案缺陷」为准，按五个切片——
> G1/G2（共享机制 + 手动剪辑）、G3（导出一致性）、G4（AI 混剪后端）、G5/G6（AI 混剪前端 + 自动混剪）、G7（剪辑 Agent）——
> 逐文件审阅 `git diff 01af364`，从 **覆盖度 / 回归风险 / 命名·风格·注释** 三个维度核对；每条发现都回到当前工作区代码核实
> （必要时写临时复现用例），**全部就地修复并补回归测试**，不留 TODO。未发现 P0。
>
> 严重度沿用评审记录口径：**P1** = 可感知的功能回归或修复在真实场景失效；**P2** = 边界场景、可用性、可维护性。

### RC.1 发现与处理

| ID | 级别 | 切片 | 位置 | 问题 | 处理 |
|---|---|---|---|---|---|
| RC-01 | P1 | G3 | `useVideoExport.ts` | EX-03 让导出轮询随组件卸载中止。编辑器只挂载当前任务（`page.tsx` 单个 `Container`，编辑器按 `projectId` 作为 key），导出途中切换任务 / 打开其他项目会卸载 `VideoPlayerPanel`：后端继续渲染，但文件永远不会下载，也没有任何提示；基线在卸载后仍会照常下载 | 回退「卸载即中止」：导出不再绑定组件生命周期，轮询完成后照常下载；`pollCompositionStatus` 的 `signal` 参数保留（附录 A BL-10 的用户取消入口会用到）。T23 改为「卸载后文件仍下载」。**有意偏离 §3.8 EX-03 第 3 点**，理由见左 |
| RC-02 | P2 | G3 | `useVideoExport.ts` | 以 `error.message.includes('timeout')` 判定超时；EX-03 之后失败文案携带后端真实原因，文本中含 "timeout" 的合成失败会被误报成「导出超时」、真实原因被吞掉 | 轮询超时改为抛出 `name = 'TimeoutError'` 的错误（与 `http-client` 一致），hook 只按 `name` 判定；T23 / T24 各补用例 |
| RC-03 | P2 | G3 | `effectiveVolume.ts`、`playback/AudioSyncPool.ts` | 出现两个同名导出 `computeEffectiveVolume`：一个是「item × 轨道百分比，钳制 [0, 2]」，一个是「媒体元素音量，钳制 [0, 1]」，签名相同，自动导入选错会差 100 倍（违反「一个概念一个名字」） | `AudioSyncPool` 中的版本按语义更名为 `computeMediaElementVolume`（含其测试） |
| RC-04 | P2 | G3 | `timeline/domain/ports.ts` | `ICompositionPort` 契约注释仍写「visible, unlocked」，与 EX-02 后的实现不符 | 注释改为「锁定只防编辑，锁定轨照常渲染 / 发声」 |
| RC-05 | P2 | G3 | `lib/api/videoComposition.ts` | 轮询循环中的 `else if (signal?.aborted)` 分支不可达（abort 监听同步触发，`settled` 已为真） | 删除 |
| RC-06 | P1 | G4 | `ai_mixed_editing_service.py` | 修复轮把模型原回复作为 assistant 消息回放；推理模型耗尽 `max_tokens` 时回复为空串，Anthropic 格式端点（本项目常用的智谱 anthropic 端点）拒绝空的非末尾 assistant 消息 → 本可修复的解析失败变成 502 上游错误 | 空回复以占位文本 `EMPTY_REPLY_PLACEHOLDER` 回放；T1 补用例 |
| RC-07 | P2 | G4 | `services/llm_json.py` | 只尝试第一个代码块、第一个平衡 `{…}`：「散文代码块 + JSON 代码块」「JSON + 无关代码块」「`Plan {draft}:` + JSON」三种常见输出都直接失败，白白多一次 120 s 的修复调用 | 依次尝试每个代码块与全文；跳过不是合法 JSON 的平衡片段；T1 参数化用例 |
| RC-08 | P2 | G4 | `services/llm_json.py` | `json.loads` 接受裸 `NaN` / `Infinity`：`duration: NaN` 穿过所有比较，`total_duration = nan`，到响应序列化时才 500，且没有 `AI_MIX_*` 错误码 | `parse_constant` 拒绝非有限数，进入修复轮；T1 补用例 |
| RC-09 | P2 | G4 | `timeline_parser_service.py` `_normalise_segment_range` | `clip_end <= clip_start` 时时长被算成 ≤ 0，片段在 `_clip_to_total` 以「短于 0.1 s」的错误原因被丢弃；源素材剩余不足 0.1 s 时同样误报原因 | 反向出点按「缺失出点」处理；源范围耗尽时直接以真实原因丢弃；T1 补两条用例 |
| RC-10 | P2 | G4 | `timeline_parser_service.py` | 后续步骤按「过滤 / 改道之后」的列表下标命名片段，前面有片段被丢弃后，警告里的 `video_segments[i]` 指向的并不是模型写的第 i 段 | `SanitizeReport` 记录每段的原始 `list[index]`（改道的图片沿用原 `video_segments[i]`）；T1 补用例 |
| RC-11 | P2 | G4 | 路由 / 服务 / `model_settings_service.py` | 路由对 `AIMixError` 再打一遍 traceback（服务层已记录）；`_video_cut_env_group` 返回类型未标 `Optional`；新增代码 9 处超过 80 列 | 路由只记错误码与消息；返回类型改为 `Tuple[Optional[str], …]`；逐处换行 |
| RC-12 | P1 | G7 | `trackPatch.ts` `toSemanticItem` | 冲突判定的语义键只含 id / 素材 / 时间 / 裁剪 / 音量 / 文本，而撤销会整轨换回 `before`：Agent 裁剪某轨片段后，用户在同一轨上分离音频、设置运镜 / 图片位置 / 不透明度 / 转场 / 字幕样式，「撤销本轮」不报冲突并静默抹掉这些编辑；分离音频的情况下视频原声复活而分离出的音频片段仍在 → 双重出声。正是 AG-02 要杜绝的「抹掉之后的手工编辑」 | 语义键补齐 `originalMaterialType / opacity / audioDetached / subtitleStyle / imagePosition / cameraMotion / transitionIn / transitionOut`，缺省值与 `TimelineItem.fromPlainObject → toPlainObject` 往返一致（C-2 仍成立）；T12 补「带这些字段的往返键稳定」「分离音频后拒绝」「运镜变化后拒绝」 |
| RC-13 | P2 | G7 | `useAgentExecution.ts` `undoSingleOperation` | 单步撤销成功后本轮补丁不变、`canUndo` 仍为真，随后「撤销本轮」必然因实时轨道 ≠ `patch.after` 报冲突（用户什么也没改） | 撤销前取该步影响的轨道（`OperationApplier.affectedTrackIds`，含批量子操作），成功后在同一次消息更新中用 `rebaseTrackPatches` 把这些轨道的 `after` 换成当前轨道（瘦身），前后一致的补丁剔除；T12 两条 + T16「单步撤销后仍可撤销本轮」 |
| RC-14 | P2 | G7 | `trackPatch.ts` `revertTrackPatches` | IM-27 的缩略图回填只查同 id 轨道：撤销跨轨 `move_clip` 时片段回到原轨，但原轨实时状态里没有它 → 本地素材的 `data:` / `blob:` 缩略图丢失 | 恢复前在全部实时轨道上建立 `itemId → thumbnail` 映射，恢复出的片段无论来自哪条轨道都能回填；被 Agent 删除的片段无法找回缩略图（注释说明）；T12 补用例 |
| RC-15 | P2 | G7 | `useAgentExecution.ts`、`SSEStreamManager.ts` | `sendAgentMessage`（约 70 行）与 `connectAndRead`（约 80 行）在本轮改动后超过 60 行上限且无说明 | 抽出 `createTurnRuntime`（每轮 applier / 状态管理 / 事件路由装配）与 `retryAfterBackoff`（重试分支，保持「工具调用后否决重连 → 退避期间取消 → `resetForRestart`」顺序），行为不变 |
| RC-16 | P1 | G2 | `domain/entities/TimelineItem.ts` `resizeEndEdge` | TL-04 只给左边缘做了图片分支，右边缘仍按 `_clipEnd` 计算；Agent 添加的图片 `clipStart = 0 / clipEnd = 0`（`OperationApplier`），拖拽预览显示 7 s、松手后变成 2 s，向内裁剪则抛 `Duration: value must be > 0` 而无变化（临时复现用例实测） | 图片右边缘与左边缘同样按类型判定：时长 = 起点到拖拽位置（不低于 `MIN_DURATION_SECONDS`），`clipStart = 0`、`clipEnd = duration`；T18 补「空裁剪区间的图片可拉长 / 可缩短」 |
| RC-17 | P1 | G2 | `ui/ConfirmationDialog.tsx` + S3 | `tabIndex={-1}` 在遮罩层、`aria-modal` 在内层：点击对话框文字时焦点落到遮罩（`[aria-modal]` 之外），S3 的模态判定失效——字幕替换确认框开着时按 Delete 会删掉背后选中的片段，Ctrl+Z、空格同样穿透；Tab 也能把焦点走出对话框 | `tabIndex` 移到 `role="dialog" aria-modal` 元素；Tab / Shift+Tab 在按钮间循环（焦点在对话框自身时同样生效）；T27 补三条用例 |
| RC-18 | P2 | G2 / S4 | `TimelinePanel.tsx` `handleAddSubtitle` | S4 只在按下 S 时判锁；识别（可达数分钟）或确认框等待期间 Agent 开始执行，结果仍经 `replaceTimelineAction` 写入 → 正是 S4 要避免的客户端 / Agent 分叉 | 新增纯函数 `getSubtitleCommitBlocker`（外部编辑锁 → 缺轨 → 锁定轨），在发起识别前与识别结束重读 store 后各判一次；T28 补 4 条 + 源码断言 |
| RC-19 | P2 | G2 / TL-07 | `TimelineItem.tsx` | 锁定轨上的字幕仍可双击进入行内编辑，而提交走 `updateSubtitleTextAction` 被锁定拒绝 → 用户输入后回车，文字无提示地还原（基线无锁判定，编辑能生效） | 锁定轨双击直接返回，不进入编辑态（与键盘 / 弹窗编辑一致）；新增用例 |
| RC-20 | P2 | G2 / TL-07 | `TimelinePanel.tsx` 两处兼容轨查找 | 「优先未锁定轨」后，兼容轨全部锁定时添加静默失败（仅 `console.error` 或 `tid` 为空），与 TL-07「拖到锁定轨时提示」不一致；兼容性判定在两处重复 | 兼容规则抽为 `lib/trackForMaterial.ts`（`isTrackCompatibleWithMaterial` / `findTrackForMaterial`，区分 `all-locked` 与 `no-compatible-track`），全部锁定时提示 `trackLocked`，批量添加每批只提示一次；新增 4 条用例 |
| RC-21 | P2 | G2 / TL-08 | `shortcutOwnership.ts` `resolveTimelineShortcut` | 新增的 Ctrl+X 在按住时随自动重复反复切换剪切工具，停在不确定状态；按住 Ctrl+C 会按重复频率不断复制片段 | 组合键中只有撤销 / 重做允许自动重复，Ctrl+X / C / E 的重复事件解析为空；T8 补三条用例 |
| RC-22 | P1 | G6 | `lib/aiMix/planScriptAutoMix.ts` | AS-01（RV-07）以「在 `allMaterials` 中的位置」判新，但重新匹配时若复用素材库里**已有**的素材 id，`addOrReplaceMaterial` 原地替换、位置不变：素材库 `[L, P]`，某槽先匹配 P 再改匹配 L → 仍选中 P，正是 RV-07 声称修复的场景；T5 只用了会被追加的新 id，未覆盖 | `ScriptPanel` 在每次视频匹配与 TTS 写入时于 metadata 写入 `segment_assigned_at`；`keepNewest` 取最大时间戳，相同或无时间戳（旧数据）时回退素材库顺序；不改素材面板排序；T5 补「复用已有 id 的重新匹配」用例 |
| RC-23 | P2 | G5 | `useAIMixedEditing.ts` `computeTimelineImpact` | 「保持不变的轨道」直接用 `track.name`，默认轨道名为空 → 提示行被隐藏或显示成「, 」 | 改用时间轴同款 `deriveTrackDisplayName`；T9 补无名轨道用例 |
| RC-24 | P2 | G5 | `lib/aiMix/mergeAiMixTimeline.ts` | 「按顺序第 n 条音频轨」的回退不排除已被其他 AI 音频道占用的轨道：时间轴只有 `audio-track-2` 时，导入的音频道 1 回退到它、音频道 2 又直接命中它 → 两道再次扁平到同一轨（AM-03 回归） | 记录「轨道 → AI 音频道」占用；回退目标已属于其他音频道时新建 `audio-track-n`；T4 补用例 |
| RC-25 | P2 | G5 | `useAIMixedEditing.ts` `applyAiMixPlan` | 未使用 `replaceTimelineAction` 的返回值：后端条目 id 是确定性的，同一方案再跑一次结果与当前时间轴一致、不写历史，却仍提示「已完成，可按 Ctrl+Z 撤销」→ 用户按下会撤销自己上一步编辑 | 以返回值判定是否写入；无可用片段仍报 `errorInvalidResponse`；结果与当前一致时提示新增的 `aiMixingProgress.noChanges`（接口类型 / en / zh-CN 三处）。**有意偏离 IM-33 ②**：`errorInvalidResponse` 的文案「方案不完整」不适用于「方案与现状相同」；T9 补用例 |
| RC-26 | P2 | G5 | `AIMixingModeSelectionModal.tsx` | IM-35 ② 的 Tab 圈定只在焦点恰好位于首 / 末控件时回绕；对话框容器 `tabIndex=-1`，点击其空白处后 Shift+Tab 走出到背后页面 | 焦点不在可聚焦控件上时同样回绕到首 / 末控件（进度弹窗唯一可聚焦元素是「取消」且始终持焦，无需改动）；T11 补用例 |
| RC-27 | P2 | G5 / S4 | `useAIMixedEditing.ts` | AI 混剪只在启动时判断 Agent 是否执行，而一次运行可达数分钟；期间 Agent 开始执行时结果仍会整轨写入（自动混剪已按 IM-09 在应用前复查） | 应用前复查 `externalEditLock`，被占用时不改时间轴并提示 `blockedByAgent`；T9 补用例 |
| RC-28 | P2 | G6 | `VideoEditingInterface.tsx` 自动混剪提示 | 跳过段号列表恒以「, 」连接，zh-CN 文案显示为「第 2, 4 段」 | 按 IM-35 约定 zh-CN 用「、」、其他语言用「, 」 |
| RC-29 | P2 | G5 | `useAIMixedEditing.ts`、两个 AI 混剪弹窗 | 新增函数 / 组件约 118、135、167 行，超过 60 行上限且无说明 | 抽出 `useAiMixRun` / `runAiMixStages` / `reportRunFailure` / `refuseToStart`，弹窗拆出 header / options / footer 子组件与 `describeSteps`；拆分后仍超限的三个单元各附一行原因注释；行为不变 |
| RC-30 | P2 | G4 / G5 | `useAIMixedEditing.ts` | 素材 DTO 只保留 video / audio / image，而入口只检查素材总数：仅有字幕 / 文档类素材时请求体 `materials: []`，后端在路由前以 422 `VALIDATION_ERROR` 拒绝，用户看到「Validation error」 | `openModeModal` 与 `start` 共用 `refuseToStart`，按与请求相同的过滤规则提前提示 `errorNoMaterials`，不发请求；T9 补两条用例 |
| RC-31 | P2 | G3 / EX-02 | `VideoEditingInterface.tsx` `calculateEffectiveVolume` | 仍按旧语义排除锁定轨（结果传给 `usePreviewTransport`，当前无消费方、不影响听感，但与 EX-02 规则矛盾） | 去掉锁定过滤，与「锁定只防编辑」一致，接口不变 |

### RC.2 评审后验证记录（提交节点实际运行，全部修复落地之后）

| # | 结果 | 说明 |
|---|---|---|
| A1 | 通过 | `tsc --noEmit` exit 0 |
| A2 | 通过 | `next lint` 的 error 仍为基线同一组 8 条（均位于未触及的文件）；另以 ESLint API（legacy 配置）逐文件对比 `HEAD` 与工作区：修改文件无新增 warning / error，新增文件 0 条 |
| A3 / A4 | 通过 | `vitest run` 全量 **231 个文件 / 2003 个用例，0 失败**（实现节点 228 / 1967；基线 204 / 1811） |
| A5 | 通过 | 5 个门禁文件，外加导入被改模块的 `test_config_llm_status.py`、`test_settings_services.py`：共 **140 passed** |
| A6 | 通过 | 非测试命中仅 `projects/hydrateTimeline.ts:72,103` 与 `store/actions/historyActions.ts:29`（同 I.6 口径） |
| A7 / A8 / A9 / A11 / A12 | 通过 | 均 0 命中；AI 混剪后端 `print(` 0 命中 |
| A10 | 通过 | 无 `__pycache__` / `*.pyc` / `tsbuildinfo` / `.next/` / 临时文件。变更集在 §4 与 IM 所列之外新增的文件均来自本节点修复：`playback/AudioSyncPool.ts` 及其测试（RC-03）、`timeline/domain/ports.ts`（RC-04）、`ScriptPanel.tsx`（RC-22）、`timeline/lib/trackForMaterial.ts` 及其测试（RC-20）、`timeline/__tests__/TimelinePanel.lockGuards.test.ts`（RC-18）、`timeline/__tests__/TimelineItem.lockedSubtitle.test.ts`（RC-19） |
| 构建 | 未重跑 | `npm run build` 已由实现节点通过；本节点改动均为 TS / Python 源码与测试，类型层面由 A1 覆盖 |

**评审结论**：共发现 **31 项（P1×6 / P2×25），全部就地修复并补回归测试**，无遗留 TODO。两处有意偏离方案（RC-01 偏离 §3.8 EX-03 第 3 点；RC-25 偏离 IM-33 ②）已在表中写明理由。

放行条件核对：

- **C-1** 满足：`store/actions/replaceTimeline.ts` 与 `uiSlice.ts` 的 `externalEditLock` 在同一个提交中。
- **C-2** 满足：T13 的 `TimelineAggregate` 真实往返用例、T14「事件 id 从 0 重启时重跑事件全部送达」用例通过；RC-12 扩充语义键后新增的「带可编辑字段的往返键稳定」用例同样通过。
- **C-4 仍未满足**：§7.3 桌面走查需要交互式 Electron 会话，本节点同样无法执行，**发布前必须人工逐条勾选**（重点第 6、8、10、13、14 条），并建议加走本节点修复涉及的三条交互：导出途中切换任务 / 项目后文件仍会下载（RC-01）；字幕替换确认框打开时点击框内文字再按 Delete / 空格，时间轴与播放不受影响（RC-17）；让 Agent 添加一张图片后拖拽右边缘拉长到 12 秒（RC-16）。

记录项（不改代码）：`TimelineParserService.validate_simplified_timeline` 在基线即只有测试调用方（`AIVideoGenerateService` 只调用 `parse_simplified_timeline`），本轮仅修正其 0 时长语义，是否删除留给第 2 轮。

