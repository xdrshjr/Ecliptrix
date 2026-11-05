# Agent 字幕能力设计文档（agent-subtitles）

> 状态：设计稿 **v2**（v1 → v2：评审节点逐条核对源码后修掉 2 个 P0 + 6 个 P1，见下方 §评审记录）· 作者：解决方案架构师节点 · 评审：资深评审节点 · 日期：2026-10-28
> 范围：剪辑 Agent（`src/lib/video-editing-agent/`）+ 时间线客户端应用层（`OperationApplier` / `AgentEventRouter` / `reconcile`）+ 提示词（`systemPrompt.ts` / `promptParts.ts`）。**不涉及后端**（无需改 FastAPI，也不新增路由）。
> 本文档只做设计，不含实现代码；下游工程师按 §5 文件表、§6–§8 的接口/数据/校验规则逐条落地即可，无需再做决策。

---

## 评审记录

> 评审轮次：v1 设计稿 · 依据：`CLAUDE.md`、`.claude-index/index.md`、逐文件核对源码（每条都带 `文件:行`）
> 维度：可行性 Feasibility / 完整性 Completeness / 一致性 Consistency / 尺寸 Right-sizing
> 结论摘要：**P0 × 2、P1 × 6 已在 v2 正文直接修好**（每条标「处置」并在正文对应章节落地）；**P2 × 9 记录在案，不阻塞实现**。
> 说明：v1 的整体判断（缺的是「工具面上的洞」而不是模型能力）经复核成立——`add_subtitles` 确实不存在、`add_to_track` 确实要求素材、`.srt` 确实被 `workspace_import_material` 拒绝、`add_clip` 确实不写 `text`/`subtitleStyle`。以下是需要修的部分。**注意：评审期间该目录有并发任务在改（`systemPrompt.ts` 665→765 行、注册表新增 `host_tools`/`egress_tools`），本文所有行号以 2026-10-28 评审时点的树为准，实现前请按符号名重新定位；不随树漂移的断言（「注册表里没有字幕工具」等）优先。**

### P0（会让用户以为「字幕加上了」而实际是错的，必须改）

| # | 维度 | 问题 | 证据 | 处置（v2 已改） |
|---|---|---|---|---|
| **P0-1** | 可行性 | **D-11 的「按 8 KB 分页读工作区 SRT」在现有 toolkit 通道上根本读不回来。** `executeToolkitTool` 的返回值必经 `toolkitResult`：一旦序列化后超过 `RESULT_BYTE_CAP`（12 KiB），`shrinkOversizedValues` 会把**任何 > 1200 字符的字符串字段截成 1200 字符 + `…`**。因此即使只用默认 4000 字节分页，`content` 也会被截断——SRT 少一半、cue 数与时间全错，而工具照样回 `success:true`。分页契约本身也写错了：真实查询键是 `name` / `offset` / `max_bytes`（默认 4000，上限 8000），EOF 判据是**返回的 `next_offset === null`**，后端没有任何「16 页 / 64 KB」限制（16 × 8 KB 是 128 KB，而且必须先 `total_bytes` 预判）。 | `tools/toolkitAdapter.ts:3`（`RESULT_BYTE_CAP` 来自 `webToolAdapter`=12 KiB）、`:76-89`（`toolkitResult`）、`:100-113`（> 1200 字符即截断）、`:231-236`（成功路径也走 `toolkitResult`）；`tools/workspaceTools.ts:27-33`（`name`/`offset`/`max_bytes`）；`routers/agent_toolkit_router.py:245-251`；`services/agent_toolkit/workspace_store.py:279-339`（`next_offset` / `total_bytes` / `invalid_offset` / `invalid_page_size`） | 新增 `executeToolkitRaw()`（不裁剪、只允许 `max_bytes ≤ 8000`、仅本工具使用）；D-11 重写为「`name` + `offset` + `max_bytes:8000`，**按返回的 `next_offset` 续读、`null` 即 EOF**，客户端 64 KB 硬上限，第一页用 `total_bytes` 预判」；§6.1 补齐直传错误码 `invalid_offset` / `invalid_page_size` / `toolkit_disabled` / `workspace_disabled`；§9.1 增加「≥ 6 KB SRT 两页读回、逐字节相等」用例 |
| **P0-2** | 完整性 + 可行性 | **D-4「两条应用层逐字段相同」没有任何机制保证，而且工具拿不到应用回执。** `ToolContext.updateTimeline` 返回 `void`，本地副本被拒时**静默丢弃**操作（`if (!applyOperationLocally(...)) return;`），工具无法区分「已写进本地副本」与「被丢掉」，仍然回 `success:true`；同时 `applyOperationLocally` 与 `OperationApplier` 对 `totalDuration` 的处理本来就不一致（客户端 `Math.max(computeTimelineEnd(state), old)`，服务端**完全不提升**）→ 同回合后续 `get_timeline` / `check_timeline` 看到的是另一份时间线。这正是历史黑板上 F-AIEDIT-RV02「模型说加上了、界面没有」的同一类风险。 | `types.ts:61`（`updateTimeline: (…) => void`）；`agent.ts:95-101`（拒绝即 `return`，无回执）；`agent.ts:630-690`（无 `totalDuration`）；`OperationApplier.ts:574`（有 `totalDuration`） | `updateTimeline` 改为返回 `{ applied: true } \| { applied: false; reason }`；**`totalDuration` 提升移入共享纯函数**（两处调用点都不再各自处理）；工具在 `applied:false` 时回 `subtitle_apply_refused`（带 `reason`），不回 `success`；§9.1 增加「两处产物 `deepEqual`」与「拒绝路径不得报成功」两条断言 |

### P1（会做出可用但错误/脆弱的结果，必须改）

| # | 维度 | 问题 | 证据 | 处置（v2 已改） |
|---|---|---|---|---|
| **P1-1** | 完整性 | **`lineBudget` 恒按 16:9 算，竖屏工程会算错一倍。** 工具没有画幅入参，`maxSubtitleChars(1920, 60) = 30`；同一个字号在 9:16（1080 宽）真实预算只有 **16 字/行**、`1:1` 也是 16。模型按 30 字写、工具回「不溢出」、`check_timeline` 换 `aspect_ratio:"9:16"` 一问全是 `subtitle_overflow` —— V10 这条护栏在最常见的竖屏短视频场景里直接失效。 | `tools/qualityTool.ts:32,60`（`aspect_ratio` 闭集 + 默认 `'16:9'`）；`lib/subtitleLayout.ts:26-38,47-50`（`OUTPUT_SIZE_BY_ASPECT`、`maxSubtitleChars`）；`lib/video-editing-agent` 全量无 `aspectRatio` 透传（`chat/route.ts` 请求体不含画幅，`types/index.ts:308` 的 `aspectRatioId` 属工程 `content`，不在 `timelineState` 里） | 新增决策 **D-13**：`add_subtitles` 增加 `aspect_ratio`（复用 `LINT_ASPECT_RATIOS` 闭集、同默认 `'16:9'`），`lineBudget` 一律由 `defaultTargetResolution(aspect_ratio)` 推，结果里回显 `assumedFrame`；§7.3 给出五种画幅的真实预算表；AC-11 增加竖屏用例 |
| **P1-2** | 一致性 | **`replaceTimelineAction(data, 'agent-op')` 与代码不符。** `ReplaceTimelineReason` 只有 `'agent'` / `'agent-undo'` / …，没有 `'agent-op'`；`'agent-op'` 是**外部更新 id 的前缀**，由 `reasonFromExternalUpdateId()` 映射成 `'agent'`。若下游真按文档新增 `'agent-op'` 这个 reason 而漏加进 `LOCK_EXEMPT_REASONS`，Agent 运行期间的编辑锁会把字幕写入**整条拒绝**——恰好是 Agent 该被放行的场景。 | `timeline/store/actions/replaceTimeline.ts:23-31`（reason 联合）、`:44-47`（`LOCK_EXEMPT_REASONS`）；`timeline/lib/externalUpdateId.ts:14-33`；`TimelinePanel.tsx:488-504`；`hooks/useAgentExecution.ts:333-335`（`nextExternalUpdateId('agent-op')`） | §4.1 图与 §4.2 第 7 步改为「applier 的 `onTimelineUpdate` 发 `nextExternalUpdateId('agent-op')` → 面板解析成 reason `'agent'`（已在豁免名单）→ **无需新增 reason、无需改 `TimelinePanel`**」 |
| **P1-3** | 完整性 | **幂等只做到「id 确定」，没做到「重复应用不重复插入」。** 纯函数只 `push`，同一 `toolCallId` 的操作若被重放（SSE 重试 / 同 turn 再来一次相同调用）会在字幕轨里插入**两条同 id** 的条目：React key 冲突、`diffTimelineTracks` 产生「有变化」的假补丁、用户看到双层字幕。D-10 声称的幂等因此不成立。 | `OperationApplier.ts:583-620`（`applyOperationToState` 无 `default`，写操作一律 push）、`:140-193`（重放同样走 `apply`）；历史板 AG-01「SSE 重试重复下发」是同类事故 | 新增决策 **D-15**：`applySubtitleClipsToState` 按 `clip.id` **upsert**（存在则原地覆盖 `text/startTime/duration/subtitleStyle/name`，不新建条目）；`replace` 仍先清空；§9.1 增加「同一操作应用两次 → 条目数与内容不变」 |
| **P1-4** | 一致性 | **熔断豁免（D-8）的前提没写清，照抄 stillGuard 的形式会静默失效。** `isStillGuardRejection` 只读 `details.error_code`；若工具**抛异常**，`event.isError === true` 且 `details` 不是对象 → 豁免判据不成立，用户连续两次字幕写错就会被「连续 5 次失败」中断（`MAX_CONSECUTIVE_TOOL_FAILURES = 5`）。另外 `agent.ts` 只认 `error_details.failure_class`（嵌套），文档写的是顶层 `failure_class`。 | `agent.ts:274`（5 次）、`:516-533`（`softFailure` / `expectedGuardRejection`）、`:522`（`details?.error_details?.failure_class`）；`tools/stillGuard.ts:80-83`；对照 `tools/toolkitAdapter.ts:142-147`（信封里用 `error_details`） | D-8 补两条硬约束：**① 校验失败必须 `return` 正常结果（`details.success:false`），禁止 `throw`；② `failure_class` 放 `error_details.failure_class`**；§9.1 的熔断用例必须走真实 `tool_execution_end` 路径 |
| **P1-5** | 一致性 + 尺寸 | **改动预算没算，且字幕颜色会出现两处来源。** `OperationApplier.ts` 现在 **785 行**，`CLAUDE.md §2` 上限 800：再加一个 switch 分支（+ 可能的 `CLIP_COLORS.subtitle`）+ `touchedTrackIds` case，会把文件顶到天花板；§9.3 的非功能门槛却只约束「新增文件 ≤ 800 行」。同时 §5#9 说「`CLIP_COLORS` 增 `subtitle`」而 §7.2 说颜色取 `TrackTypeUtils.getDefaultColor('subtitle')`——两条真相，迟早漂移。 | `wc -l` → `OperationApplier.ts` 785、`agent.ts` 690、`tools/index.ts` 522、`systemPrompt.ts` 765；`OperationApplier.ts:106-110`（`CLIP_COLORS` 只有 video/audio/image，回退 `#6b7280`）；`timeline/domain/value-objects/TrackType.ts:23,65`、`domain/entities/TimelineItem.ts:41-48,262` | 新增决策 **D-16**：字幕条目颜色**只有一个来源**——`TrackType.getDefaultColor('subtitle')`（=`#E67E22`），`CLIP_COLORS` **不加** subtitle（它不是素材类型）；§9.3 增加「`OperationApplier.ts` 提交后 ≤ 800 行，本次新增行数 ≤ 8（switch 分支 3 行 + case 3 行 + import 2 行）」的实测门槛，并要求字幕分支体一律留在 `subtitleClips.ts` |
| **P1-6** | 可行性（L0 预算） | **L0 常驻预算几乎已用尽，「+260 字符、上限不变」不成立。** `systemPrompt.toolkit.test.ts` 的「满技能索引」用例断言 `withIndex.length ≤ 18 500`，注释写明实测 **18 483**——只余 **17 字符**；而 `systemPrompt.ts:455-465` 记录的「最坏值 ≈ 18 100」是**不含技能索引**的场景。字幕的 3 处常驻改动（规则 + 工具目录一行 + 配方）≈ 260 字符，直接追加必然让该用例变红。这不是「改个注释就能过」的门槛：它是产品预算，只能靠腾位或改写。 | `__tests__/systemPrompt.toolkit.test.ts:153-160`（注释原文：实测 18 483，只比 18 500 宽 17 字符）、`:84`；`systemPrompt.ts:455-467` | 新增决策 **D-18**：L0 改动必须做到**净增 ≈ 0**，三条落地方式任选/叠加——① 把字幕规则**并进**已有 `rules` 的一行（不新增行）；② 压缩 `ALWAYS_AVAILABLE_TOOLS` 里 `check_timeline_overlaps` / `auto_fix_overlaps` 两条 desc 合计 ≥ 80 字符，给 `add_subtitles` 腾位；③ 新配方**替换**「仅入库 vs 上轨」配方里的冗余句而非追加。§9.3 增加「改动前后各实测 `prompt().length` 与带索引值」门槛 |

### P2（记录在案，不阻塞实现；实现时顺手处理）

| # | 维度 | 问题与建议 | 证据 |
|---|---|---|---|
| **P2-1** | 一致性（证据准确性） | §1.2 表里的取证细节有 5 处不准，v2 已订正：① **不要写死工具数**——评审时点实测 63（`tools/index.ts:369-494`，`explore_tools` 另计），但该目录正被并发任务持续扩展（评审期间又长出 `host_tools` / `egress_tools`，类别从 19 涨到 21），任何「58/63 个工具」的硬数字都会立刻过期，断言请用「注册表里没有字幕工具」这个不变量；② `rules` 不是数组而是模板串（`systemPrompt.ts:688-698`），「字幕」还出现在工具目录（`:45`/`:52`）与反编造规则（`:693`）里，不只在「视频轨必须最长」；③ `MAX_TOOL_CALLS` 这个常量**不存在**，上限是 `tools/index.ts:518` 的内联 `calls > 80`；④ L0 有两道闸门：`systemPrompt.toolkit.test.ts:84` 的 ≤ 18 500 与 `L0_PROMPT_CHAR_CEILING = 18 900`（`systemPrompt.ts:467`）；⑤ **余量远小于文档假设**，详见 P1-6。 | 见左 |
| **P2-2** | 一致性 | `registry/categories.ts:185` 的 `editing_tools.description` **逐字列出**了该类的工具名（`add_to_track, trim_clip, …`）。加 `add_subtitles` 后不改这行，模型看到的类别摘要就是错的。v2 已把该文件补进 §5 文件表。 | `registry/categories.ts:183-188` |
| **P2-3** | 一致性 | i18n 的「三处」实为**接口 + `en` + `'zh-CN'`**（`i18n.ts:1734-1770` / `:5549` / `:9737`，中文 locale 键名为 `'zh-CN'`）。`toolNames` 是 34 个必填 key 的扁平对象，漏一个 locale 就 `type-check` 失败——这是护栏，值得写进门槛。 | `lib/i18n.ts:1734-1770` |
| **P2-4** | 尺寸（右尺寸） | VTT/`WEBVTT` 头容忍属于**超范围**：工具的产物永远是 SRT 语义，模型也不会凭空生成 VTT 头。建议只保留「BOM / CRLF / 点号毫秒」三点容忍，把 `WEBVTT` 降级为可选（有测试就留，别为它加代码分支），减少测试面。 | §7.4 / RK-8 |
| **P2-5** | 一致性 | §6.3 手写条目字面量与 `TimelineItem.create()`（`toPlainObject()` **省略** `volume/opacity === 1`）会给出不同的字段集合。建议纯函数直接走实体工厂（**先校验再构造**，`TimePosition.create` 对负值会抛），或明确写「手写 + 为何不用实体」，否则两份默认值迟早漂移。 | `domain/entities/TimelineItem.ts:252-288,521-557` |
| **P2-6** | 完整性 | 预览有两道硬门槛必须写进契约（v2 已补）：`track.isVisible` 必须为真（`undefined` 视为隐藏 → **整轨不渲染**），且 `item.type === 'subtitle'` 且 `text` 非空；导出侧只看 `track.type + text`（不看 `item.type`），所以漏写 `item.type` 会出现「能导出、不能预览」。 | `infrastructure/CompositionAdapter.ts:284-293`；`infrastructure/renderableTimeline.ts:67-81`；`hooks/videoExportItems.ts:126-131` |
| **P2-7** | 完整性 | 只有「单次调用 ≤ 120 条」，没有「单轨总量」上限：`append` 循环可以把一条轨堆到几千条，拖垮渲染。建议 `MAX_TRACK_CUES = 1000`（超出回 `subtitle_track_full`）。 | §8 V2 |
| **P2-8** | 完整性 | `get_timeline` 不回报 `subtitleStyle`（`getTimeline.ts:23-41` 只回 `text`），所以「把第 3 句改成 48 号」这类指令本轮做不了。v2 已在 §1.3 非目标里明确写出，避免下游以为漏实现。 | `tools/getTimeline.ts:23-41` |
| **P2-9** | 一致性 | 人工 S 键流程写的是 `color: '#f59e0b'` + 一个**伪造** `materialId: 'subtitle_material_…'`，且**不写** `subtitleStyle`（于是按 24px 渲染/导出）。本文档选择「不写 materialId + 必写 style + 用 `#E67E22`」是对的（`isClipMaterialMissing` 对 `type:'subtitle'` 直接返回 false），但必须**明说这是有意的分歧**，否则后来者会「对齐」成伪造 id。 | `TimelinePanel.tsx:1192-1204`；`hooks/videoExportItems.ts:300-306` |

**评审已复核为「正确、无需改」的关键论断**（避免下游重复验证）：R2–R5 根因、D-5 的 reconcile 陷阱（`reconcile.ts:152-175` 未知 op 返回 `null` + `:190-192` `packAlways` → **确实会把所有视频/音频轨重排**）、D-6 的 `replace` 显式化、D-7 的「切句交给模型」、D-10 的确定性 id、D-12 的 `trim_clip` 无守卫（`tools/trimClip.ts` 当前对字幕完全放行）、`trackPatch` 的撤销能整轨删除（`before === null` → `splice`，所以 AC-4「字幕一次性消失」成立）、以及字幕条目确实不需要 `materialId`/`url`。

---

## 1. 概述

### 1.1 用户问题（原话与现场日志）

用户在「视频剪辑 → AI 剪辑助手」里对话，让 Agent 给 35 秒成片**加中文字幕**。Agent 规划得很好（读 `audio-track-1` 的四段配音时间 → 按字数比例切句 → 用 `add_subtitle` 逐条上字幕 → `check_timeline` 自检），执行到第 3 步崩了：

```
查看可用工具  {"categoryId":"workspace_tools","loaded":["workspace_list","workspace_read",...]}
写入文件      subtitle/yorkie.srt            1.1 KB
导入素材      subtitle/yorkie.srt  →  请求被拒绝，请检查参数。
列出素材      {"success":true,"count":0,"materials":[]}
```

Agent 最后只能如实告诉用户：「这个编辑环境里没有字幕工具……`workspace_import_material` 明确拒绝 `.srt` 扩展……所以时间线上的 `subtitle-track-1` 目前仍然是空的」。它甚至给了三个「收尾方案」让用户二选一（自己手动导入 SRT / 做成烧屏贴图 / 干脆不加）——这**不是模型能力不足，而是工具面上有一个洞**：Agent 在结构上无法创建任何一条字幕。

### 1.2 现状与根因（已逐条对代码核实）

| # | 根因 | 证据 |
|---|---|---|
| R1 | **根本没有字幕工具**：`categories.ts` 的工具类别（评审时点 21 个：3 常驻 + 18 按需；v1 写作 19 个）里没有任何一类能创建字幕 clip，`explore_tools` 无论怎么翻都翻不出「字幕」。模型日志里那一步「用 `add_subtitle`」是它**编出来的工具名**，实际不存在 | `registry/categories.ts:20-43,55-68,94-232`；`tools/index.ts:369-494`（`createToolRegistry` 注册的工具里没有字幕；`explore_tools` 另计） |
| R2 | `add_to_track` 是唯一「上轨」入口，但它要求素材库里已存在一条 `materialId` 对应素材；字幕素材在真实流程中为 0 条 | `tools/addToTrack.ts:80-87`；日志 `{"count":0,"materials":[]}` |
| R3 | 素材入库也不接受字幕：`add_material_to_library` 的 `type` 只允许 `video` / `image` / `audio` 三种 | `tools/addMaterialToLibrary.ts:8-13` |
| R4 | 工作区导入也不接受字幕：`workspace_import_material` → 后端只认 `MEDIA_EXTENSIONS`（mp4/mov/webm/mkv/mp3/wav/m4a/aac/png/jpg/jpeg/webp/gif/svg），`.srt` 直接 `invalid_argument`（前端界面显示为「请求被拒绝，请检查参数」）。这正是日志里那次失败 | `agent_toolkit_router.py:295-318`；`tools/workspaceTools.ts:50-59` |
| R5 | **即便**素材里真有一条 `type:'subtitle'` 的素材，`add_clip` 也写不出可渲染的字幕：客户端应用层 `addClipToState` 只拷 name/url/时间字段，**不写 `text` 与 `subtitleStyle`** | `OperationApplier.ts:622-664`；字幕渲染/导出靠 `item.text`，空文本直接 `return null`（导出静默丢弃）→ `hooks/videoExportItems.ts:130-135` |
| R6 | 提示词侧也没有**正向**指引：「字幕」在 L0 里出现 4 次，全部是约束或反编造（工具目录 `search_materials`/`auto_fix_overlaps` 的说明、`rules` 里的「不许编 `default-subtitle-*` 占位 ID」、`hardConstraints` 的「视频轨必须最长」），没有一条告诉模型「怎么把字幕加上去」；`ALWAYS_AVAILABLE_TOOLS` 的 10 条（`{name, desc}` 对象数组）里也没有字幕工具。于是模型只能自行发挥（写 SRT + 让用户手动导入） | `systemPrompt.ts:42-53`（工具目录）、`:592-602`（`rules`）、`:693`（反编造）、`:715`（`hardConstraints`）；`promptParts.ts:181-184`（配方只有「仅入库 vs 上轨」） |

结论：字幕在人工路径上是**一等能力**（S 键语音识别写字幕轨、`SubtitleEditModal` 改样式、预览 `SubtitleLayer`、导出 `subtitleItems`、`check_timeline` 三条字幕 lint 规则全都在），唯独 Agent 路径**没有入口**。本次修复 = 给 Agent 补一个「文本 + 时间 → 字幕轨」的一等工具，并把这条通路在两条应用层（服务端本地副本 / 浏览器 store）**做成同一份代码**。

### 1.3 目标与非目标

**目标**

1. 用户说「加字幕」「给配音配字幕」「把这句台词打上去」「导入这份 SRT」时，Agent 能在**一轮之内**把字幕写到 `subtitle-track-1` 上，且预览可见、导出可烧、可以被用户 Ctrl+Z 一步撤销。
2. 字幕**不需要素材**：文本 + 起止时间即可上轨，不再依赖素材库、也不再撞 `workspace_import_material` 的扩展名白名单。
3. 时间对齐可编程：Agent 能直接读 `get_timeline` 里配音片段的 `startTime/duration`，按句切分后批量下发（一次工具调用 ≤ 120 条）。
4. 结果**自证**：工具返回每条字幕的 `lines/lineBudget` 与溢出行数，溢出/重叠/超时长当场告警，Agent 用 `check_timeline` 复验（已有 `subtitle_overflow` / `subtitle_overlap` / `subtitle_style_drift` 三条规则），不再「说不出到底加没加上」。
5. 撤销、锁定、时长约束、编辑锁这些既有不变量**全部不变**（新增操作走同一套 `OperationApplier` 补丁撤销 + `reconcile` 跳过字幕轨）。

**非目标**

* 不做语音识别（ASR）。「听写出字幕」仍走人工 S 键 / `batch-transcribe`；Agent 若被要求「识别字幕」，回答提示用户按 S（可选后续立项让 Agent 触发该端点）。
* 不做烧屏贴图（把字幕做成图片压进画面）——用户日志里的备选方案 2 明确否决。
* 不改人工字幕 UI（`SubtitleEditModal`、S 键替换流程、`SentenceSegmentBar`）。
* 不改后端：字幕是时间线数据，导出侧 `subtitle_service.py` 早已支持。
* 不新增素材类型、不放开 `workspace_import_material` 的 `.srt`（避免「srt 素材」与「字幕 clip」两份真相）。
* **不做「改既有字幕样式」**：`get_timeline` 目前只回报 `item.text`，不回报 `subtitleStyle`（`tools/getTimeline.ts:23-41`），所以「把第 3 句改成 48 号」这类指令本轮做不到；要改就整轨 `mode:"replace"` 重写（文本 + 样式一起给）。补 `get_timeline` 的 style 回报属后续增量。
* **不以 VTT 为目标格式**：解读入参时容忍 BOM / CRLF / 点号毫秒即可，`WEBVTT` 头与 ASS 样式标签原样留作文本（RK-8），不为它们写专门分支。

---

## 2. 设计原则与决策表

| 编号 | 决策 | 理由（可回退条件） |
|---|---|---|
| **D-1** | 新增**独立工具 `add_subtitles`**，放在**常驻类别 `editing_tools`**，而不是塞进 `add_to_track` 或新增按需类别 | `add_to_track` 的语义是「素材上轨」，字幕没有素材；混进去会让该工具变慢、变杂，且要给它加一条 `text` 参数（素材与文本两条来源在一个 schema 里）。放 `editing_tools` 是因为它与 `resize_clip` 同级高频，`explore_tools` 会白费一整个回合（与 `update_plan` 常驻同一条理由）。若后续 schema 预算吃紧，可改为按需类别 `subtitle_tools`（toolActivation 预算测试会先报出来）。**注意：`registry/categories.ts:185` 的 `editing_tools.description` 逐字列出了该类的工具名，必须同步追加 `add_subtitles`**，否则模型看到的类别摘要与真实工具不符（P2-2）。 |
| **D-2** | 新增**批量操作 `add_subtitle_clips`**（一次工具调用 = 一个撤销步骤），而不是 N 次 `add_clip` | 18 句字幕 = 18 次工具调用，会撞「**每次执行**计数、上限 80」的 `tools/index.ts:518` 内联限流与「连续 5 次失败熔断」（`agent.ts:274`）的风险，并在聊天里刷 18 张工具卡片；一次批量下发也让「替换整轨」具备原子性。撤销仍是一个 `toolCallId` → 一条 `OperationRecord`（多轨补丁机制现成）。 |
| **D-3** | 字幕样式**必填**（由工具补默认值），不留给 `item.subtitleStyle` 缺省 | 缺 style 时导出按 24px、预览按 24px、`check_timeline` 报 `subtitle_style_drift`（note）。默认样式取**人工 UI 的 `default` 预设**（`fontSize: 60`、`#FFFFFF`、`bottom`、无背景，`SubtitleEditModal.tsx:33-44`），所以 Agent 加的字幕与用户手点「默认样式」后完全一致（`DEFAULT_AGENT_SUBTITLE_STYLE`）。**有意分歧（P2-9）**：S 键 ASR 流程并不写 `subtitleStyle`（`TimelinePanel.tsx:1192-1204`），它按 24px 渲染/导出，所以 Agent 的字幕会比 ASR 字幕大——这是预期行为，`subtitle_style_drift` 只在**缺** style 时报（`qualityLint.ts:270-275`），不会因为两者字号不同而报。 |
| **D-4** | **两条应用层共用一套纯函数**（`subtitleClips.ts`）：服务端 `agent.ts::applyOperationLocally`（同回合后续工具看到的副本）与浏览器 `OperationApplier`（真实时间线）必须产出逐字段相同的条目 | 项目历史上 F-AIEDIT-RV02 / RV-03 两次事故都是「两份实现漂移」。字幕涉及 text/style/name 三个新字段，漂移的代价是「模型说加上了、界面没有」。**「声明一致」不算机制（P0-2）**，所以本设计配三条硬约束：① `totalDuration` 提升写在纯函数里（今天只有浏览器侧在 `OperationApplier.ts:574` 做，服务端漏做）；② `ToolContext.updateTimeline` 改为回报 `{ applied }`，工具据此决定 success 或 `subtitle_apply_refused`；③ §9.1 用 `deepEqual` 断言两侧产物逐字段相同。 |
| **D-5** | 字幕轨**不参与 pack-flush**（沿用现规则），但必须在 `reconcile.affectedTrackIds` 里**显式返回字幕轨 id** | 这是本设计最容易踩的坑：`affectedTrackIds` 的 `switch` 对未知 op 落到 `return null`，而 `reconcileOverlapsAfterAgentOp` 在 `allowed === null && operation` 时 `packAlways = true` → **会把所有视频/音频轨重新紧凑排列**。加字幕就会悄悄挪动用户的视频片段。新增 case 返回字幕轨 id 后，`isReorganisable('subtitle') === false` 使该轨被跳过，其余轨不受影响。 |
| **D-6** | 模式 `append` / `replace`，默认 `append`；`replace` **只能显式传入**，且结果回报 `removedCount` | 对应 R1-TL-01（S 键静默替换整轨 = P0）的教训：整轨替换必须显式、可撤销（自动是一个 undo 步骤）、并且事后能被审计。 |
| **D-7** | 字幕切分**由模型负责，工具只校验并告警**（不自动断句/不自动缩短） | 断句是内容决策（重音、语气、画面节奏）。工具把「每行字数上限、行数、溢出条目」算准回给模型，模型改一次即可；工具静默改写文本会让「用户看到的字」与「模型以为的字」不一致。 |
| **D-8** | 校验失败返回 `success:false` + 稳定 `error_code` + `failure_class:'validation'`（**放在 `error_details.failure_class`**），并**豁免熔断** | 与 `stillGuard` 同构（`agent.ts` 的 `expectedGuardRejection`）。否则用户连续两句字幕写错就会触发「连续 5 次失败中断」，把一次可自纠的输入错误升级成整轮失败。**两条硬约束（P1-4）**：① 校验失败必须**正常 return** 结果对象（`details.success === false`），**禁止 throw**——异常会让 `event.isError === true` 且 `details` 不再是对象，`isSubtitleGuardRejection`（读 `details.error_code`，同 `stillGuard.ts:80-83`）就判不出来，豁免静默失效；② `failure_class` 必须写在 `error_details` 里，`agent.ts:522` 只读 `details?.error_details?.failure_class`。 |
| **D-9** | 时间坐标**只做次要校验**：`start >= 0`、`duration > 0`、同批不重叠、append 时不与既有字幕重叠；**不要求**落在视频轨范围内 | 字幕短暂越界（如片尾留白 0.3 秒）是常见且无害的；真正有害的「非视频轨超长」由既有 `checkTrackDurationConstraint` 告警覆盖（工具照 `add_to_track` 的做法回一条 `warning`）。 |
| **D-10** | ID 用**确定性** `subtitle-<toolCallId>-<index>`（清洗为 `[A-Za-z0-9_-]`），不用时间戳+随机 | SSE 重放/同 turn 重试时重复下发不会产生两批不同 id 的字幕（幂等，与 D7-幂等同一纪律），也便于在日志里从 clip id 反查是哪次工具调用产生的。**仅确定性 id 还不够**：见 D-15，纯函数必须 upsert 而不是无脑 push。 |
| **D-11** | SRT 支持**两条来源**：`srt` 内联文本 与 `srt_workspace_path`（读 `GET /api/agent-toolkit/workspace/read`，**`name` + `offset` + `max_bytes:8000` 逐页续读，`next_offset === null` 即 EOF**；客户端 64 KB 硬上限，首屏用 `total_bytes` 预判） | 正好是用户日志里的场景：Agent 已经把 `subtitle/yorkie.srt` 写进工作区。让工具自己读文件，比让模型把 1.1 KB 文本贴进工具参数（多花 token、易抄错）可靠得多。**必须走新增的 `executeToolkitRaw()`，不能走 `executeToolkitTool()`（P0-1）**：后者的返回值必经 `toolkitResult`，超过 12 KiB 时会把任何 > 1200 字符的字符串字段截成 1200 字符 + `…`（`toolkitAdapter.ts:100-113`），4000 字节一页也会被截断 → 静默错字幕。超限（> 64 KB）就报错并提示改用 `cues`。 |
| **D-12** | 边界防御：`trim_clip` 明确拒绝字幕片段（提示改用 `resize_clip`） | `trim_clip` 的文档语义是「源素材入出点」，字幕没有源素材；不拦就会写出 `clipStart/clipEnd` 毫无意义、duration 与文本窗口脱钩的字幕。`resize_clip` 是改字幕显示时长的正确工具。 |
| **D-13** | 工具**必须收 `aspect_ratio`**（复用 `LINT_ASPECT_RATIOS` 五值闭集，默认 `'16:9'`），`lineBudget` 一律由 `defaultTargetResolution(aspect_ratio).width` 推出，并在结果里回显 `assumedFrame` | 竖屏工程的真实预算是 16 字/行而 16:9 是 30（P1-1）：写死 16:9 会让 V10 这条「算准了再交给模型」的护栏在竖屏下完全失效。Agent 请求体里没有工程画幅（`chat/route.ts` 不传，`aspectRatioId` 在 `content` 而非 `timelineState`），所以只能由模型按 `check_timeline` 同样的口径显式给；回显让模型能自检「我按 30 字写，但你说这是 9:16」。 |
| **D-14** | 渲染/导出**不变量**写进纯函数契约：轨道 `type:'subtitle'` **且 `isVisible:true`**（`undefined` 视为隐藏），条目 `type:'subtitle'` 且 `text` 非空 | 预览按 `track.isVisible` + `item.type` 过滤（`CompositionAdapter.ts:284-293`），导出只看 `track.type` + `text`（`renderableTimeline.ts:67-81`）——两者口径不同：漏 `item.type` 会「能导出、不能预览」，漏 `isVisible` 会整轨消失。这类坑必须在纯函数里一次写死，而不是靠各调用方记得。 |
| **D-15** | `applySubtitleClipsToState` 按 `clip.id` **upsert**：已存在则原地覆盖 `text/startTime/duration/subtitleStyle/name`，不存在才 push | P1-3：SSE 重放 / 同 turn 重试会让同一操作再落一次，无脑 push 会得到**两条同 id** 的条目（React key 冲突、假补丁、双层字幕）。upsert 让「重复应用」真正变成 no-op，与 D-10 的确定性 id 才配得上一对。`mode:'replace'` 仍先清空整轨。 |
| **D-16** | 字幕条目颜色**只有一个来源**：`TrackType.getDefaultColor('subtitle')`（=`#E67E22`）；`OperationApplier` 的 `CLIP_COLORS` **不加** `subtitle` | P1-5：`CLIP_COLORS` 是「素材类型 → 颜色」表（只有 video/audio/image，`OperationApplier.ts:106-110`），字幕没有素材，塞进去就出现两处真相；而 `TrackType.getDefaultColor` 与 `TimelineItem.create` 已经就是规范来源（`TrackType.ts:23,65`、`TimelineItem.ts:41-48`）。 |
| **D-17** | 单轨条目上限 `MAX_TRACK_CUES = 1000`（`append` 后超限回 `subtitle_track_full`） | P2-7：V2 只管单次调用 ≤ 120 条，`append` 循环仍能把一条轨堆到几千条拖垮渲染与导出。上限放在纯函数入口，报错文案提示「先 `mode:'replace'` 或删除旧字幕」。 |
| **D-18** | L0 常驻文本**净增 ≈ 0**：字幕规则并进已有 `rules` 行、压缩两条 `ALWAYS_AVAILABLE_TOOLS` desc 腾位、配方替换而不追加 | P1-6：满技能索引的最坏提示词实测 18 483，离 ≤ 18 500 只剩 17 字符（`systemPrompt.toolkit.test.ts:153-160`）。任何「加一段就行」的写法都会把这条产品预算撑破；而这条预算正是「模型每轮都能看见工具目录」的保障。若实现时确实腾不出位，正确做法是**把字幕规则降级为工具 description（L1）**并接受模型第一次可能先 `explore_tools`——而不是放宽上限。 |

---

## 3. 渐进式披露分层

| 层 | 内容 | 落点 | 常驻成本 |
|---|---|---|---|
| **L0 常驻（净增 ≈ 0 字符，见 D-18）** | ① 字幕规则**并进**已有 `rules` 的一行（不新增行）：「加/改字幕用 `add_subtitles`，字幕不需要素材；SRT 可直接给文本或工作区路径；改时长用 `resize_clip`；加完用 `check_timeline` 复验」。② `ALWAYS_AVAILABLE_TOOLS` 增一条 `{ name: 'add_subtitles', desc: … }`（该数组是 `{name,desc}` 对象数组，不是字符串），**同时压缩 `check_timeline_overlaps` / `auto_fix_overlaps` 两条 desc 合计 ≥ 80 字符**腾位。③ `WORKFLOW_RECIPES_MD` 的「仅入库 vs 上轨」配方里**替换**冗余句而不是追加新配方 | `systemPrompt.ts` / `promptParts.ts` | **不能用「+260 字符」来算**：`__tests__/systemPrompt.toolkit.test.ts:159` 的满技能索引用例实测 18 483，只余 **17 字符**（`:84` 的另一道闸门是 ≤ 18 500；运行期告警线是 `L0_PROMPT_CHAR_CEILING = 18 900`，`systemPrompt.ts:467`）。见 P1-6 / D-18 |
| **L0 常驻 schema（+1 个工具）** | `add_subtitles` 进入 `editing_tools`（`alwaysAvailable`），其 schema 每轮随 core 一起发；`ToolActivationState` 的按需预算相应减少约 0.6–0.8 KB。同一处还要把 `registry/categories.ts:185` 的 `editing_tools.description` 补上 `add_subtitles`（该字符串逐字列了工具名，改漏就是「类别摘要与真实工具不符」） | `tools/index.ts` / `registry/categories.ts` | 常驻 schema ≈ +700 B；`toolActivation.test.ts` 的 48 KiB 断言必须仍绿 |
| **L1 按需** | 工具 description 全文（含 `cues`/`srt`/`srt_workspace_path`/`mode`/`aspect_ratio`/`style` 语义、行字数上限、重叠规则）；`explore_tools` 不需要额外说明（已在常驻类别） | `tools/addSubtitles.ts` 的 `description` | 0（已含在上面的 schema 里，不重复计入提示词正文） |
| **L-1 兜底闸（零提示词）** | 校验失败的具体原因（第几条 cue、字符数、溢出行数、与哪条既有字幕重叠）+ `next_step` | 工具结果 | 0（只在出错时出现） |
| **L0.5 就地提示** | 成功结果的 `lintHint` 一句：「调用 check_timeline 复核 subtitle_overflow / subtitle_overlap / subtitle_style_drift」 | 工具结果 | 0 |

---

## 4. 技术设计

### 4.1 架构（一条通路，两处应用）

```
                        ┌──────────────────────────── 浏览器（真实时间线）
用户消息 ──► LLM ──► add_subtitles 工具 ──┐   SSE tool_result{ operation }
                        │                 │            │
                        │                 │            ▼
                        │                 │     AgentEventRouter.handleToolResult
                        │                 │       isTimelineOperation → OperationApplier.apply
                        │                 │            │
                        │                 │            ▼
                        │                 │     applySubtitleClipsToState(state, op)   ← 纯函数（唯一实现）
                        │                 │            │
                        │                 │            ▼
                        │                 │     diffTimelineTracks → OperationRecord（撤销=一步）
                        │                 │            │
                        │                 │            ▼
                        │                 │     setTimelineState → onTimelineUpdate → nextExternalUpdateId('agent-op')
                        │                 ▼
                        └──► context.updateTimeline(toolCallId, op) → { applied }   ← 回执（P0-2）
                                    │
                                    ▼
                             agent.ts::applyOperationLocally
                               validateOperationTargets（同一份守卫）
                               applySubtitleClipsToState（同一份纯函数：upsert + totalDuration）
                               reconcileOverlapsAfterAgentOp（affectedTrackIds 显式返回字幕轨）
                                    │
                                    ▼
                    同回合后续 get_timeline / check_timeline 看到同样的字幕
```

关键点：**字幕不存在「服务端时间线」与「客户端时间线」两套语义** —— 工具先对本地副本应用，再经 SSE 让客户端对真实时间线应用同一操作；两份都调用 `applySubtitleClipsToState`。**`'agent-op'` 是外部更新 id 的前缀**（`timeline/lib/externalUpdateId.ts:14-18`），面板用 `reasonFromExternalUpdateId()` 把它解析成历史 reason **`'agent'`**（`replaceTimeline.ts:23-31`，且在 `LOCK_EXEMPT_REASONS`:44-47 里，Agent 运行期间的编辑锁会放行）——**不要新增 `ReplaceTimelineReason`，也不要改 `TimelinePanel`**（P1-2）。

### 4.2 关键代码路径（按调用顺序）

1. `tools/index.ts::createToolRegistry` → `editing_tools` 注册 `createAddSubtitlesTool(context)`。
2. `addSubtitles.ts::execute(toolCallId, params)`：
   1. **取来源（三选一）**：`cues` / `srt` / `srt_workspace_path`，多给或都不给 → `subtitle_source_ambiguous` / `subtitle_source_missing`。
   2. `srt_workspace_path` → **`executeToolkitRaw(context, toolCallId, { path:'/workspace/read', query:{ project_id, name, offset, max_bytes:8000 } })`**：按返回的 `next_offset` 续读、`next_offset === null` 即 EOF；第一页先看 `total_bytes > 64 KB` 就直接 `subtitle_workspace_too_large`（不是等读完才发现）。**禁止用 `executeToolkitTool`**（它会把 `content` 截到 1200 字符，P0-1）→ `parseSrtCues`。
   3. **规范化为 cue 列表**：trim 文本、`start`/`duration` 转数、按 `start` 稳定排序、`id = subtitle-<call>-<i>`。
   4. **静态校验**（§8）：非空文本、长度、时间合法性、批内重叠、条数上限、style 合法化（`normalizeSubtitleStyle`）。
   5. **解析目标轨**：`params.trackId` 或 `resolveSubtitleTrack(state)`（首个 `type==='subtitle'` 的轨）；不存在则在**操作里**带一个待创建描述（见 §7.3），由 `applySubtitleClipsToState` 真正建轨（服务端副本与客户端必须一致地建轨，所以建轨逻辑只能在那一个函数里）。
   6. **append 冲突检查**：与目标轨既有字幕的时间窗重叠 → `subtitle_conflicts_existing`（列出既有条目序号/时间/text 摘要）。
   7. `const applied = context.updateTimeline(toolCallId, op)` —— 成功时这一步同时把字幕写进本地副本（后续工具可见）；**返回 `{ applied:false, reason }` 时必须回 `subtitle_apply_refused`（带 reason），不许报 success**（P0-2）。
   8. **回算结果**：`addedCount / removedCount / cues[]（前 20 条）/ lineBudget / assumedFrame / overflows[] / warning / lintHint`；`lines` 用 `wrapSubtitleText(text, lineBudget).length` 算（与 `check_timeline` / 导出同一函数，`subtitleLayout.ts:122`），`warning` 复用 `checkTrackDurationConstraint` + `formatDurationWarning`（非视频轨不得长于视频轨）。
3. `agent.ts::applyOperationLocally(state, op)`：`validateOperationTargets`（新增分支）→ `applySubtitleClipsToState`（含 `totalDuration` 提升）→ `reconcileOverlapsAfterAgentOp(state, op)`；`ToolContext.updateTimeline` 的签名改为返回 `{ applied: true } | { applied: false; reason }`（`types.ts:61` + `agent.ts:95-101`，现有调用方忽略返回值即可）。
4. `agent.ts` 的 `tool_execution_end`：`operation` 随 SSE `tool_result` 下发；熔断器对 `isSubtitleGuardRejection(details)` 既不累加也不清零。
5. `AgentEventRouter.handleToolResult`：`isTimelineOperation` 白名单包含 `add_subtitle_clips` → `OperationApplier.apply(op, toolCallId)`。**注意这是运行期字符串数组**（`AgentEventRouter.ts:456-458`），漏加不会报 TS 错，只会让操作被静默忽略——必须有测试钉住。
6. `OperationApplier.apply`：`validateOperationTargets` → `findLockedTrackId`（字幕轨锁定 → `skipped: locked-track`，不写任何东西；UI 侧由既有 `reportRejectedApply` 提示用户）→ `applyToTimeline`（`applyOperationToState` 新分支）→ `reconcileOverlapsAfterAgentOp` → `diffTimelineTracks` 记录补丁 → `setTimelineState`。
7. `TimelinePanel` 的 external-sync effect：`reason = reasonFromExternalUpdateId(id)` → **`'agent'`** → `replaceTimelineAction(data, 'agent')`（**不改这个文件、不新增 reason**，P1-2）→ 时间线 store 载入后代实体（`TimelineItem` 已支持 `text`/`subtitleStyle`）→ 预览 `buildSubtitleLayers`（`playback/internal/assembleLayers.ts`）在 `track.isVisible` 且 `item.type === 'subtitle'` 且 `text` 非空时立刻可见（D-14）。
8. 用户点「撤销」→ `undoOperation(toolCallId)` 用补丁把字幕轨恢复（含 replace 前的旧字幕）；**本次操作新建的字幕轨会被整条删除**（`trackPatch.ts:270-272`：`patch.before === null` → `state.tracks.splice(index, 1)`），所以「一次性全部消失」不需要额外逻辑。

### 4.3 序列（典型一轮）

```
model: get_timeline                      → 读到 audio-track-1 四段 0/8.8/17.9/28.1 起，subtitle-track-1 空
model: add_subtitles(mode="append", aspect_ratio="9:16", cues=[{text,startTime,duration}×18])
       ├ 18 条全部合法 → operation 应用（服务端副本 + 客户端）→ 一步撤销点
       └ 第 7 条与第 6 条重叠 → success:false, error_code=subtitle_cues_overlap, index=6
         （不写任何东西；熔断器豁免；模型改正后重发一次即成功）
model: check_timeline                    → subtitle_overflow 0 / subtitle_overlap 0 / style_drift 0
model: 报告「18 条字幕已加到字幕轨，可在时间线字幕轨上直接改字/改样式」
```

---

## 5. 文件 / 模块变更计划

| # | 文件 | 动作 | 意图（一句话） |
|---|---|---|---|
| 1 | `src/types/index.ts` | 修改 | 新增 `AgentSubtitleCue` / `AgentSubtitleClipData`，`AgentTimelineOperation` 追加 `add_subtitle_clips` 分支（含 `trackId` / `mode` / `style` / `clips`） |
| 2 | `src/lib/video-editing-agent/types.ts` | 修改 | `TimelineOperation` 同步追加同一分支（`context.updateTimeline` 的类型来源）；`updateTimeline` 签名改为返回 `{ applied: true } \| { applied: false; reason }`（P0-2） |
| 3 | `src/lib/video-editing-agent/subtitleClips.ts` | **新建** | 唯一纯函数层：`DEFAULT_AGENT_SUBTITLE_STYLE`、`normalizeSubtitleStyle`、`SUBTITLE_CLIP_COLOR`（= `TrackType.getDefaultColor('subtitle')`，D-16）、`SUBTITLE_TRACK_ID_FALLBACK`、`MAX_TRACK_CUES`、`resolveSubtitleTrack`、`applySubtitleClipsToState`（upsert + `totalDuration`，D-4/D-15）、`collectSubtitleCues`、`findCueConflicts` |
| 4 | `src/lib/video-editing-agent/subtitleSrt.ts` | **新建** | 纯 SRT/VTT 解析器 `parseSrtCues(text)`（BOM/CRLF/毫秒逗号或点/多行文本/序号缺省），失败抛带行号的 `SubtitleParseError` |
| 5 | `src/lib/video-editing-agent/tools/subtitleGuard.ts` | **新建** | `subtitleRejection(code, extra, nextStep)` 与 `isSubtitleGuardRejection(details)`：给熔断器一个稳定判据（与 `stillGuard` 同构） |
| 6 | `src/lib/video-editing-agent/tools/addSubtitles.ts` | **新建** | 工具本体：来源三选一（含 `executeToolkitRaw` 分页读工作区）、`aspect_ratio` → `lineBudget`、规范化、校验、下发 `add_subtitle_clips`、**据 `updateTimeline` 回执定 success/`subtitle_apply_refused`**、回算行数/溢出/时长告警 |
| 7 | `src/lib/video-editing-agent/tools/index.ts` | 修改 | `editing_tools` 注册 `add_subtitles`；导出共享纯函数（必要时） |
| 8 | `src/lib/video-editing-agent/operationGuards.ts` | 修改 | 新增 `validateAddSubtitleClips`：clips 非空、时间为有限非负数、duration > 0、批内不重叠、style 结构合法 |
| 9 | `src/lib/video-editing-agent/OperationApplier.ts` | 修改 | `applyOperationToState` 新分支（3 行，只调 `applySubtitleClipsToState`）；`touchedTrackIds` 新 case；**`CLIP_COLORS` 不动**（D-16）。注意本文件已 785 行，上限 800（§9.3） |
| 10 | `src/lib/video-editing-agent/agent.ts` | 修改 | `applyOperationLocally` 新分支（同一纯函数）；`updateTimeline` 回传 `{ applied }`（P0-2）；熔断豁免并入 `expectedGuardRejection`（`isSubtitleGuardRejection`） |
| 11 | `src/lib/video-editing-agent/reconcile.ts` | 修改 | `affectedTrackIds` 新增 `add_subtitle_clips` → 返回字幕轨 id（阻止 `packAlways` 误打包全部视频/音频轨） |
| 12 | `src/lib/video-editing-agent/AgentEventRouter.ts` | 修改 | `isTimelineOperation` 白名单加 `add_subtitle_clips` |
| 13 | `src/lib/video-editing-agent/systemPrompt.ts` | 修改 | `ALWAYS_AVAILABLE_TOOLS` 增 `add_subtitles` 一行；`rules` 增一条字幕规则（不依赖素材 / SRT 两来源 / 改时长用 resize_clip / 加完复验） |
| 14 | `src/lib/video-editing-agent/promptParts.ts` | 修改 | `WORKFLOW_RECIPES_MD` 增「要字幕 → 取配音时间 → add_subtitles → check_timeline」配方 |
| 15 | `src/lib/video-editing-agent/tools/trimClip.ts` | 修改 | 字幕片段拒绝 trim（`use resize_clip`），D-12 |
| 16 | `src/lib/i18n.ts` | 修改 | `agentTimeline.toolNames.add_subtitles`（接口 + en + zh 三处），聊天卡片显示「添加字幕」 |
| 17 | `src/lib/video-editing-agent/tools/__tests__/subtitleSrt.test.ts` | **新建** | SRT/VTT 解析：合法/缺序号/CRLF/BOM/多行/毫秒点号/坏块报错 |
| 18 | `src/lib/video-editing-agent/__tests__/subtitleClips.test.ts` | **新建** | 纯函数：建轨、append/replace、排序、样式落地、锁轨、id 确定性 |
| 19 | `src/lib/video-editing-agent/__tests__/addSubtitles.test.ts` | **新建** | 工具：三来源、全部校验分支、行数/溢出、时长告警、工作区读取、错误码 |
| 20 | `src/lib/video-editing-agent/__tests__/operationApplier.subtitles.test.ts` | **新建** | 客户端应用：一步撤销、replace 还原旧字幕、锁轨 skipped、坏 payload rejected |
| 21 | `src/lib/video-editing-agent/__tests__/reconcile.subtitleOp.test.ts` | **新建** | 回归钉子：加字幕**不移动**任何视频/音频片段（D-5） |
| 22 | `src/lib/video-editing-agent/__tests__/agent.circuitBreaker.subtitles.test.ts` | **新建** | 连续 5 次字幕校验失败**不**触发熔断（D-8） |
| 23 | `src/lib/video-editing-agent/__tests__/subtitleDisclosure.test.ts` | **新建** | L0 含字幕规则与工具行；`CORE/alwaysAvailable` 里确有 `add_subtitles`；schema 预算仍 < 48 KiB |
| 24 | `docs/plans/agent-subtitles/spec.md` | **新建** | 本文件 |
| 25 | `src/lib/video-editing-agent/tools/toolkitAdapter.ts` | 修改 | 新增 `executeToolkitRaw()`：**不做** 12 KiB / 1200 字符裁剪的读取通道（复用同一 `toolFetch`、`x-tool-call-id`、错误信封），只给 SRT 读取用（P0-1） |
| 26 | `src/lib/video-editing-agent/registry/categories.ts` | 修改 | `editing_tools.description` 补 `add_subtitles`（该串逐字列了工具名，P2-2） |
| 27 | `src/lib/video-editing-agent/__tests__/subtitleDualApply.test.ts` | **新建** | 钉子（P0-2）：同一 op 经 `applyOperationLocally` 与 `OperationApplier` 后 `tracks` + `totalDuration` `deepEqual`；本地拒绝时工具回 `subtitle_apply_refused` 且不报 success |
| 28 | `src/lib/video-editing-agent/__tests__/subtitleSrtWorkspace.test.ts` | **新建** | 钉子（P0-1）：6 KB SRT 分两页读回逐字节相等；`next_offset === null` 判 EOF；总长 > 64 KB → `subtitle_workspace_too_large`；`invalid_offset` 原样透传 |
| 29 | `src/lib/video-editing-agent/__tests__/subtitleIdempotency.test.ts` | **新建** | 钉子（D-15）：同一 `add_subtitle_clips` 应用两次 → 条目数、顺序、文本不变；`replace` 后再 `append` 不残留 |

**不改**：任何后端文件、`TimelinePanel`、`replaceTimeline.ts`（reason `'agent'` 已存在）、`useAgentExecution.ts`（`agent-op` 前缀已在用）、`SubtitleEditModal`、`videoExportItems.ts`、`subtitleLayout.ts`（只调用，不加字段）、`qualityLint.ts`（字幕三条 lint 规则已存在且已按 item 计算）。

---

## 6. 接口设计

### 6.1 工具 `add_subtitles`

```ts
name: 'add_subtitles'
label: 'Add Subtitles'
parameters: {
  cues?: Array<{ text: string; startTime: number; duration: number }>   // 1..120 条
  srt?: string                                                         // ≤ 20 000 字符
  srt_workspace_path?: string                                          // 如 "subtitle/yorkie.srt"
  mode?: 'append' | 'replace'                                          // 默认 'append'
  trackId?: string                                                     // 缺省=首个字幕轨；无字幕轨则自动创建
  aspect_ratio?: '16:9' | '9:16' | '4:3' | '1:1' | '21:9'              // 默认 '16:9'（D-13）
  style?: {                                                            // 缺省=项目人工 UI 的 default 预设
    fontFamily?: 'default' | 'serif' | 'sans-serif' | 'monospace'
    fontSize?: number                                                  // 8..72
    fontColor?: string                                                 // #RRGGBB
    backgroundColor?: string                                           // #RRGGBB，省略 = 无背景
    position?: 'top' | 'center' | 'bottom' | 'upper-3/4' | 'lower-3/4'
  }
}
```

> `cues` / `srt` / `srt_workspace_path` **必须且只能给一个**。模型可以在同一轮先 `workspace_write` 再 `add_subtitles(srt_workspace_path)`，或直接给 `cues`。
> `aspect_ratio` 用 `LINT_ASPECT_RATIOS` 同一份闭集（`qualityLint.ts:66`）与同一默认值 `'16:9'`（`qualityTool.ts:60`），`lineBudget = maxSubtitleChars(defaultTargetResolution(aspect_ratio).width, fontSize)`。

**成功结果**

```jsonc
{
  "success": true,
  "trackId": "subtitle-track-1",
  "mode": "append",
  "addedCount": 18,
  "removedCount": 0,
  "lineBudget": 16,                      // maxSubtitleChars(outputWidth, fontSize)
  "assumedFrame": "9:16",                // 回显：lineBudget 是按哪个画幅算的（D-13）
  "cues": [ { "id": "subtitle-call_abc-0", "startTime": 0, "duration": 2.2,
              "text": "家人们谁懂啊！", "lines": 1 } ],   // 最多 20 条，其余 omitted
  "cuesOmitted": 0,
  "overflowWarnings": [ { "index": 3, "chars": 22, "lines": 4, "lineBudget": 16,
                          "text": "…" } ],               // 超过 3 行才出现
  "warning": "⚠️ 约束违规：subtitle轨道(35.0s) 超过了视频轨道时长(34.2s)…",  // 复用既有文案
  "lintHint": "调用 check_timeline({aspect_ratio}) 复核 subtitle_overflow / subtitle_overlap / subtitle_style_drift"
}
```

**失败结果**（全部带 `success:false` + `error_code` + `next_step`；返回**正常结果对象**，`failure_class` 写在 `error_details.failure_class = 'validation'`，**禁止 throw**——见 D-8/P1-4）

| `error_code` | 触发条件 | `next_step` 文案（给模型） |
|---|---|---|
| `subtitle_source_missing` | 三个来源都没给 | 给 `cues`，或 `srt`，或 `srt_workspace_path` |
| `subtitle_source_ambiguous` | 给了不止一个 | 只保留一个来源 |
| `subtitle_too_many_cues` | 单次 > 120 条 | 拆成多次调用，或缩短文本 |
| `subtitle_track_full` | append 后该轨 > `MAX_TRACK_CUES`（1000，D-17） | 先 `mode:"replace"` 重写整轨，或先 `delete_clip` 旧字幕 |
| `subtitle_source_too_large` | 内联 `srt` > 20 000 字符 | 改用 `srt_workspace_path`（工具自己分页读），或拆成 `cues` 分批 |
| `subtitle_text_invalid` | 某条 `text` trim 后为空 / > 200 字符（含 `index`） | 修正该条文本 |
| `subtitle_time_invalid` | `startTime` 非有限/负数，或 `duration <= 0`（含 `index`） | 给非负起始与正时长（秒） |
| `subtitle_cues_overlap` | 批内两条时间窗重叠（含 `index`/`previousIndex`/`overlapStart`/`overlapEnd`） | 缩短或顺延，使第 N 条在第 N-1 条结束后开始 |
| `subtitle_conflicts_existing` | `append` 时与目标轨既有字幕重叠（含既有条目 `existingIndex`/时间/text 摘要） | 改时间，或先 `mode:"replace"` 重写整轨 |
| `subtitle_style_invalid` | fontSize 越界 / position 不在枚举 / 颜色非 `#RGB`~`#RRGGBB` | 用合法值或省略 style |
| `subtitle_aspect_invalid` | `aspect_ratio` 不在五值闭集 | 省略它（默认 16:9）或用合法值 |
| `subtitle_parse_failed` | SRT 块结构坏（含 `line`/`snippet`） | 修正 SRT 文本，或改用 `cues` |
| `subtitle_workspace_too_large` | 工作区文件 `total_bytes` > 64 KB | 用 `cues` 分批给 |
| `subtitle_track_locked` | 目标轨 `isLocked` | 请用户解锁字幕轨 |
| `subtitle_track_wrong_type` | 显式 `trackId` 不是 `subtitle` 轨 | 省略 trackId 让工具自动选 |
| `subtitle_apply_refused` | `context.updateTimeline` 回 `{ applied:false, reason }`（本地副本拒绝了同一操作） | 按 `reason` 修正（`invalid-time`/`track-not-found`/…），**不要重复同一调用**；连续两次就向用户报告（P0-2） |

> 工作区读取失败（`workspace_not_found` / `workspace_disabled` / `toolkit_disabled` / `binary_file` / `invalid_offset` / `invalid_page_size`）**原样透传** toolkit 的错误码与 `next_step`（不新造第二套）。注意 `invalid_offset` 的含义是「offset 不在 UTF-8 字符边界或越界」——**永远用返回的 `next_offset` 续读，不要自己 `offset + page`**。

### 6.2 时间线操作 `add_subtitle_clips`

```ts
{
  type: 'add_subtitle_clips';
  trackId: string;                    // 目标字幕轨；不存在时由应用层创建
  trackName?: string;                 // 建轨时的显示名；缺省 ''（交给 trackDisplayName 本地化推导，见 §7.2）
  mode: 'append' | 'replace';
  style: SubtitleStyle;               // 已由工具规范化，必填
  clips: Array<{                      // 1..120，按 startTime 升序
    id: string;                       // subtitle-<toolCallId>-<i>，按 id upsert（D-15）
    name: string;                     // text 前 20 字（时间线轨上显示；`get_timeline` 无素材时回退用它）
    text: string;
    startTime: number;
    duration: number;
  }>;
}
```

### 6.3 客户端/服务端行为契约（同一份纯函数）

```ts
applySubtitleClipsToState(state: TimelineState, op: AddSubtitleClipsOperation): void
```

1. 找 `op.trackId` 的轨；找不到 → 新建 `{ id: op.trackId, type:'subtitle', height: TRACK_HEIGHT.subtitle (=50, `timeline/constants.ts:27-36`), isLocked:false, isMuted:false, **isVisible:true**, volume:100, order: state.tracks.length, name: op.trackName ?? '' }`（**两端一致**，故只在纯函数里做一次；`order` 追加到末尾与字幕组「排在音轨之后」的既有分组顺序一致）。
2. `mode === 'replace'` → `track.items = []`。
3. 逐条 **upsert**（D-15）：`track.items` 里已有同 `id` 的条目 → **原地覆盖** `name/text/startTime/duration/subtitleStyle` 并保留其余字段；否则 push
   `{ id, name, type:'subtitle', startTime, duration, trackId: op.trackId,
      color: SUBTITLE_CLIP_COLOR (= TrackType.getDefaultColor('subtitle') = '#E67E22'), 
      text, subtitleStyle: op.style, volume: 1, opacity: 1 }`
   （**不写** `materialId`、`url`、`originalDuration`、`originalMaterialType`：
   `isClipMaterialMissing` 对 `type==='subtitle'` 直接返回 false，导出/预览也不需要 URL）。
4. `track.items` 按 `startTime` 稳定排序。
5. **纯函数内**重算 `state.totalDuration = Math.max(computeTimelineEnd(state), state.totalDuration)`——两个调用方都不再各自处理（P0-2；`OperationApplier.ts:574` 的现状搬进这里，`agent.ts` 因此补齐）。
6. 走实体工厂也行（`TimelineItem.create` 已支持 `text`/`subtitleStyle` 且默认色就是 `#E67E22`），但**必须先校验再构造**（`TimePosition.create` 对负值抛异常）；无论走哪条路，字段集合以本节为准，§9.1 的 `deepEqual` 断言会把差异照出来。

### 6.4 校验（`operationGuards.validateAddSubtitleClips`）

边界防御（防 SSE 载荷被篡改/旧客户端）：`clips` 非空、`startTime` 有限且 ≥ 0、`duration` 有限且 > 0、同批不重叠（ε = `POSITION_EPSILON` 1e-6，从 `tools/index.ts:265` 导入，**不要**再写字面量——该文件已有一处 `qualityLint.ts:37` 与 `updateItemFields.ts:15` 的重复，别加第三处）、`style` 结构完整（fontSize 8..72、position 枚举、颜色 hex）。任一不满足 → `{ ok:false, reason:'invalid-time', clipId }`（复用既有 `OperationRejectReason`：`'clip-not-found' | 'track-not-found' | 'target-track-missing' | 'invalid-time'`（`types/index.ts:199-203`），**不新增枚举值**，UI 文案表 `ToolStep.tsx:207-215`（`REJECT_REASON_KEYS`）+ `agentApply.reasons.*` 无需改动）。

> 顺序要求：**校验必须先于构造**。`TimePosition.create` / `Duration.create` 对负值/零值抛异常，而 `reconcile` 之后 `TimelinePanel` 的 `replaceTimelineAction` 会在 `TimelineAggregate.fromPlainObject` 处再抛一次（`replaceTimeline.ts:81-83`）——那条路径已被面板的 `try/catch` 兜住并提示用户，但工具侧若先构造就会变成一次工具崩溃。另外 `validateOperationTargets` 的 `default` 分支返回 VALID（`operationGuards.ts:135-136`），所以**字幕分支必须显式加 case**，否则守卫对字幕载荷完全放行。

### 6.5 工作区 SRT 读取契约（`executeToolkitRaw`，P0-1）

工具读 `srt_workspace_path` 时**不能**用 `executeToolkitTool()`（它把结果压到 12 KiB，并把 > 1200 字符的字符串截断）。新增一条窄通道：

```ts
// tools/toolkitAdapter.ts（新增，与 executeToolkitTool 并列、共用 toolFetch / x-tool-call-id / 错误信封）
async function executeToolkitRaw(
  context: ToolContext, callId: string, call: ToolkitCall,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; code: string; nextStep?: string }>
```

| 项 | 值 |
|---|---|
| 端点 | `GET /api/agent-toolkit/workspace/read`（`agent_toolkit_router.py:245-251`） |
| 查询键 | `project_id`（`resolveProjectId(context)`）、`name`（相对路径）、`offset`（字节，**用上一页返回的 `next_offset`**）、`max_bytes: 8000`（默认 4000，上限 8000） |
| 成功响应 `data` | `{ success, project_id, name, encoding:'utf8', content, next_offset, total_bytes, truncated }` |
| EOF 判据 | **`next_offset === null`**（不是「页数」也不是「`content.length < max_bytes`」——CJK 会被字节边界切开，内容长度不等于字节数） |
| 总量上限 | 第一页 `total_bytes > 64 * 1024` → `subtitle_workspace_too_large`；`applied` 前先判断，不要读完再报 |
| 页数上限 | 循环保护 `MAX_PAGES = 16`（16 × 8 KB = 128 KB > 64 KB，故实际由字节上限先触发） |
| 错误直传 | `toolkit_disabled` / `workspace_disabled` / `workspace_not_found` / `binary_file` / `invalid_offset` / `invalid_page_size`（后两个是 `workspace_store.py:279-282,329-331`） |
| 幂等 | 每页用 `${toolCallId}-srt-${page}` 作 `x-tool-call-id`（读操作不产生副作用，但后端要求该头存在） |
| 不得进上下文 | `content` 只在工具内部拼接成 SRT 文本再解析；工具结果里绝不回传全文（只回 `parseSrtCues` 的统计与最多 20 条 cue） |

> 为什么不开「让模型自己 `workspace_read` 再贴 srt 参数」：`workspace_read` 走同一条 `toolkitResult`，同样被 1200 字符截断；模型要贴全 1.1 KB 得反复续读 + 抄写，反而更贵更容易错（与 D-11 的理由一致）。

---

## 7. 数据模型

### 7.1 新增类型（`src/types/index.ts`）

```ts
export interface AgentSubtitleCue {
  text: string;
  startTime: number;   // 秒，≥ 0
  duration: number;    // 秒，> 0
}

export interface AgentSubtitleClipData extends AgentSubtitleCue {
  id: string;
  name: string;
}

export type AddSubtitleClipsOperation = {
  type: 'add_subtitle_clips';
  trackId: string;
  trackName?: string;
  mode: 'append' | 'replace';
  style: SubtitleStyle;
  clips: AgentSubtitleClipData[];
};
```

`AgentTimelineOperation` 追加 `| AddSubtitleClipsOperation`；`src/lib/video-editing-agent/types.ts` 的 `TimelineOperation` 追加同构分支（工具侧调用 `updateTimeline` 时用）。

### 7.2 时间线条目（落在 `Track.items[]`）

| 字段 | 值 | 说明 |
|---|---|---|
| `id` | `subtitle-<call>-<i>` | 确定性；清洗非法字符；**按 id upsert**（D-15） |
| `name` | `text.slice(0, 20)` | 时间线轨上显示；`get_timeline` 在无素材时用它当 `materialName` 回退（`getTimeline.ts:63`） |
| `type` | `'subtitle'` | **必写**：预览按 `item.type` 过滤（`CompositionAdapter.ts:291`），漏写=能导出不能预览（D-14） |
| `trackId` | 目标字幕轨 id | |
| `startTime` / `duration` | 秒 | 工具与守卫都校验 |
| `text` | 原文本（可含 `\n`，导出侧按段落换行） | **渲染与导出的唯一真相**；空文本会被导出静默丢弃（`videoExportItems.ts:130`） |
| `subtitleStyle` | 规范化后的 `SubtitleStyle` | 必填（D-3） |
| `color` | `TrackType.getDefaultColor('subtitle')` = `#E67E22` | **单一来源**（`TrackType.ts:23,65`）；**不要**往 `CLIP_COLORS` 里加（D-16） |
| `volume` / `opacity` | `1` / `1` | 与人工字幕一致（走 `TimelineItem.create` 时这两项会被 `toPlainObject` 省略——等价，不算漂移） |
| `materialId` / `url` / `originalDuration` | **不写** | 字幕无素材；`isClipMaterialMissing` 对 `type:'subtitle'` 直接 false（`videoExportItems.ts:300-306`）。**有意分歧**：S 键流程写 `materialId: 'subtitle_material_…'`（伪造 id，`TimelinePanel.tsx:1201`），本文档不复制这个做法（P2-9） |

**轨道字段**（纯函数建轨时与 `timeline/constants.ts:27-36` 对齐，不要写字面量）：

| 字段 | 值 |
|---|---|
| `id` | `op.trackId`（缺省 `subtitle-track-1`，冲突则顺延，规则同 `trackActions.ts:221-226`） |
| `name` | `op.trackName ?? ''` —— 空串由 `trackDisplayName(track, i18n)` 在渲染/导出时本地化推导（与 `addTrackAction` 的 `trackName = ''` 一致，`trackActions.ts:227-232`） |
| `height` | `TRACK_HEIGHT.subtitle`（=50） |
| `isVisible` | **必须 true**：`undefined` 会被预览当成隐藏（`CompositionAdapter.ts:285`），整轨消失（D-14） |
| `order` | `state.tracks.length`（字幕组本来就排在音轨之后，`trackActions.ts:235` 的 `typeOrder`） |

### 7.3 默认样式（`DEFAULT_AGENT_SUBTITLE_STYLE`）

```ts
{ fontFamily: 'default', fontSize: 60, fontColor: '#FFFFFF', position: 'bottom' }   // 无 backgroundColor = 无背景
```

与 `SubtitleEditModal` 的 `default` 预设**逐字段相同**（`SubtitleEditModal.tsx:33-44`），因此「Agent 加的字幕」与「用户点默认预设」外观一致。`LINT_DEFAULTS.subtitleMaxLines = 3`（`qualityLint.ts:35`）。

`lineBudget` 不是常数——它随 `aspect_ratio` 变化（D-13）。`maxSubtitleChars(w, size) = floor((w - 2 × 50) / size)`（`subtitleLayout.ts:41-50`，`SUBTITLE_MARGIN_PX = 50`）：

| `aspect_ratio` | 输出宽（`OUTPUT_SIZE_BY_ASPECT`） | `lineBudget`（fontSize 60） | 单条建议上限（3 行） |
|---|---|---|---|
| `16:9`（默认） | 1920 | **30** 字/行 | 90 字 |
| `9:16` | 1080 | **16** 字/行 | 48 字 |
| `1:1` | 1080 | **16** 字/行 | 48 字 |
| `4:3` | 1440 | **22** 字/行 | 66 字 |
| `21:9` | 2560 | **41** 字/行 | 123 字 |

行数一律用 `wrapSubtitleText(text, lineBudget)`（`subtitleLayout.ts:122`，CJK 按字折行、西文按词折行）算，**与 `check_timeline` 的 `subtitle_overflow` 和导出折行是同一函数**——不要自己写 `Math.ceil(chars / budget)`，那会在中英混排和多行处算错。结果里的 `assumedFrame` 必须回显，模型才知道该按哪一列缩句。

### 7.4 SRT → cue 映射

| SRT | cue |
|---|---|
| 块序号行（可缺省） | 忽略 |
| `HH:MM:SS,mmm --> HH:MM:SS,mmm`（亦接受 `.` 毫秒） | `startTime = start 秒`，`duration = end - start` |
| 之后所有非空行 | 以 `\n` 连接的 `text` |
| 空行 | 块分隔 |
| 时间行缺失/乱序/`end <= start` | 抛 `SubtitleParseError(line, reason)` → 工具回 `subtitle_parse_failed` |

**不做**的事：不自动合并、不自动断句、不丢弃重复文本、不按字数重排时间（D-7）；**不专门支持 VTT**（`WEBVTT` 头与 `{\an8}` 一类样式标签原样当文本，属于非目标；只有带 BOM 的文件值得测一个用例，其余不为它加分支）。

---

## 8. 校验规则（确定性表）

| # | 规则 | 阈值/来源 | 违反时 |
|---|---|---|---|
| V1 | 来源必须且只能一个 | — | `subtitle_source_missing` / `subtitle_source_ambiguous` |
| V2 | 单次条数 ≤ 120；`append` 后该轨总量 ≤ 1000；内联 `srt` ≤ 20 000 字符 | `MAX_CUES_PER_CALL = 120`、`MAX_TRACK_CUES = 1000`（D-17）、`MAX_SRT_CHARS = 20 000` | `subtitle_too_many_cues` / `subtitle_track_full` / `subtitle_source_too_large` |
| V3 | 文本非空（trim 后） | — | `subtitle_text_invalid` |
| V4 | 文本长度 | `MAX_CUE_CHARS = 200` | `subtitle_text_invalid` |
| V5 | `startTime` 有限且 ≥ 0；`duration` 有限且 > 0 | — | `subtitle_time_invalid` |
| V6 | 批内不重叠 | `POSITION_EPSILON = 1e-6`（从 `tools/index.ts:265` 导入） | `subtitle_cues_overlap` |
| V7 | `append` 时与既有字幕不重叠 | 同上 | `subtitle_conflicts_existing` |
| V8 | 目标轨类型为 `subtitle` 且未锁定 | — | `subtitle_track_wrong_type` / `subtitle_track_locked` |
| V9 | style 合法（fontSize 8..72、position 枚举、hex 颜色） | `SubtitleStyle` 类型注释「8-72 pixels」（`types/index.ts:740-749`） | `subtitle_style_invalid` |
| V10 | 每行字数上限 | `maxSubtitleChars(defaultTargetResolution(aspect_ratio).width, fontSize)`；行数用 `wrapSubtitleText` | **不拒**，进 `overflowWarnings`（> `LINT_DEFAULTS.subtitleMaxLines`=3 行才报） |
| V11 | 非视频轨不得长于视频轨 | `checkTrackDurationConstraint` + `formatDurationWarning` | **不拒**，回 `warning`（与 `add_to_track` 同一文案，模型据此缩短） |
| V12 | 工作区读取 | `total_bytes ≤ 64 KB`；`max_bytes:8000` 逐页、`next_offset === null` 为 EOF；`MAX_PAGES = 16` 仅作循环保护 | `subtitle_workspace_too_large`；其余错误码直传（§6.5） |
| V13 | `aspect_ratio` 属于 `LINT_ASPECT_RATIOS` 闭集 | `qualityLint.ts:66` | `subtitle_aspect_invalid` |
| V14 | 应用回执 | `updateTimeline` 返回 `{ applied:false }` | `subtitle_apply_refused`（**不报 success**，P0-2） |
| V15 | 幂等 | 同 `id` 重复下发 → upsert，条目数不变（D-15） | 不报错，`addedCount` 记实际新增条数、`updatedCount` 记覆盖条数 |

---

## 9. 测试与验收标准

### 9.1 单元 / 集成测试（Vitest，纯函数优先，零网络）

| 目标 | 用例（文件名 → 断言要点） |
|---|---|
| SRT 解析 | `subtitleSrt.test.ts`：标准 3 块；缺序号；CRLF+BOM；多行文本；`00:00:01.500` 点号毫秒；坏块抛错带行号（VTT 头只测「不被当时间行」一个用例，不承诺解析） |
| 纯函数应用 | `subtitleClips.test.ts`：无字幕轨时新建（`TRACK_HEIGHT.subtitle`、`isVisible:true`、`order`=末尾、未写 `materialId`）；append 保序；replace 清空后写入；**`totalDuration` 由纯函数提升**（P0-2）；**同 id 二次应用 → 条目数不变、字段被覆盖**（D-15）；id 确定性（同 callId 两次生成相同 id） |
| 工具 | `addSubtitles.test.ts`：三来源各自成功；§6.1 表里每个错误码至少一例；`overflowWarnings` 在 4 行时出现、3 行时不出现；**`aspect_ratio:"9:16"` 时 `lineBudget === 16` 且 `assumedFrame` 回显**（P1-1）；`warning` 在字幕轨超长时出现；`x-tool-call-id` 透传；**`updateTimeline` 回 `{applied:false}` → `subtitle_apply_refused` 且 `success:false`**（P0-2） |
| 工作区读取（P0-1） | `subtitleSrtWorkspace.test.ts`：6 KB SRT 分两页（`max_bytes:8000`）读回拼出的文本与原文**逐字节相等**；`next_offset === null` 判 EOF；`total_bytes > 64 KB` → `subtitle_workspace_too_large` 且只发一次请求；`invalid_offset` 原样透传；**断言走的是 `executeToolkitRaw`（结果未被截到 1200 字符）** |
| 双端一致（P0-2） | `subtitleDualApply.test.ts`：同一 `add_subtitle_clips` 分别经 `applyOperationLocally` 与 `OperationApplier` → `tracks` 与 `totalDuration` `deepEqual`；本地拒绝时本地副本**一字不变**且工具不报 success |
| 客户端应用 | `operationApplier.subtitles.test.ts`：`apply` 后 `hasUndoableRecord` 为真；`undoOperation` 恢复空字幕轨（并**删掉本次新建的轨**）；`replace` 撤销后旧字幕逐字回来；锁轨 → `skipped`；`duration<=0` → `rejected` |
| 回归钉子（D-5） | `reconcile.subtitleOp.test.ts`：视频轨有 `a@0` `b@5`（中间留白 2s）、音频轨有同样留白；加 18 条字幕 → **所有视频/音频条目 `startTime` 一字不变**（这是不加 case 就会红的用例） |
| 熔断豁免（D-8） | `agent.circuitBreaker.subtitles.test.ts`：连续 5 次 `subtitle_cues_overlap` 后仍有 `error` 之外的正常收尾；第 6 次成功调用不被中断。**必须走真实的 `tool_execution_end` 路径**（构造 `details` 而不是 mock `isSubtitleGuardRejection`），并额外断言「抛异常的失败**会**计数」（把 P1-4 的两条约束钉死） |
| 披露与预算 | `subtitleDisclosure.test.ts`：`buildSystemPrompt` 含字幕规则串与 `add_subtitles` 行；`registry.getCategoryTools('editing_tools')` 含该工具；`categories.ts` 的 `editing_tools.description` 含 `add_subtitles`（P2-2）；core schema 字节 < 48 KiB；L0 真实注册表最坏值仍 ≤ 18 500 |
| 无回归 | 既有 `operationGuards.test.ts` / `operationApplier.undo.test.ts` / `agent.overlap.integration.test.ts` / `qualityLint.test.ts` / `toolActivation.test.ts` / `builtinSkills.test.ts` / `systemPrompt.toolkit.test.ts` 全绿 |

### 9.2 端到端验收（人工，桌面端）

| ID | 步骤 | 期望 |
|---|---|---|
| **AC-1** | 打开含 4 段配音（35s）+ 空 `subtitle-track-1` 的工程，对 Agent 说「按配音加中文字幕」 | 一轮内出现 `add_subtitles` 工具卡片且 `success:true`；字幕轨出现 18 条；**不再**出现「没有字幕工具 / 请手动导入 SRT」之类回复 |
| **AC-2** | 播放预览 | 每条字幕在其时间段内显示在画面底部，字号/白色/无背景与手动「默认预设」一致 |
| **AC-3** | 导出 | 导出请求含 18 条 `subtitle_items`（`text` 非空）；成片有字幕 |
| **AC-4** | 点该工具卡片的撤销 | 字幕一次性全部消失；Ctrl+Z 之后再 Ctrl+Y 可恢复（与 `add_to_track` 的单步撤销同感） |
| **AC-5** | 让 Agent「把第 3 句字幕重写成更短的版本」 | 通过 `mode:"replace"` 或 `delete_clip`+`add_subtitles` 达成；旧文本不残留、不重复 |
| **AC-6** | 先 `workspace_write subtitle/x.srt`（内容 ≥ 6 KB，验证分页不被截断），再说「导入这份 SRT」 | `add_subtitles(srt_workspace_path)` 成功且 cue 数与文件内块数一致（**不是 1200 字符就断**）；**不再**触发 `workspace_import_material` 的 `.srt` 拒绝 |
| **AC-7** | 说「字幕和配音对齐，第 2 段从 8.8 秒开始」 | `get_timeline` → 正确时间；`check_timeline` 显示 `subtitle_overlap` 0 条 |
| **AC-8** | 故意给重叠/超长句 | 工具返回可读错误与 `next_step`；**不触发**「连续 5 次工具失败中断」；模型改正后成功 |
| **AC-9** | 用户先锁定字幕轨再要求加字幕 | 工具返回 `subtitle_track_locked`；字幕轨不变；UI 不报「已添加」 |
| **AC-10** | 加字幕后让 Agent 继续改视频轨（删片段/重排） | 字幕时间点**不随视频轨 pack-flush 移动**（视频/音频轨的既有行为也不受影响 —— D-5 回归） |
| **AC-11** | 竖屏工程（画幅 9:16），给 20 字一句的字幕 | 工具回 `lineBudget:16 / assumedFrame:"9:16"` 并报 `overflowWarnings`；模型缩句到 ≤ 16 字后 `check_timeline({aspect_ratio:"9:16"})` 为 0 条 `subtitle_overflow`（P1-1） |
| **AC-12** | 同一轮里 Agent 因网络抖动重试同一 `add_subtitles` | 字幕轨条目数仍是 18（不出现同 id 两条、不出现双层字幕）（D-15） |
| **AC-13** | Agent 运行中（时间线被编辑锁占用）要求加字幕 | 写入**照常落地**（reason `'agent'` 在豁免名单）；用户此刻手动导入 JSON 仍被拒并提示（P1-2 回归） |

### 9.3 非功能门槛

* `npm run type-check` 干净；`npm run lint` 无新增 error。i18n 的 `agentTimeline.toolNames` 加 key 会让两个 locale（`en` 与 **`'zh-CN'`**）都被 type-check 强制补齐——这属于护栏，不算额外工作。
* 新增文件 ≤ 800 行、函数 ≤ 50 行、行宽 ≤ 80 列（CLAUDE.md §2）；`addSubtitles.ts` 预计 ~260 行、`subtitleClips.ts` ~120 行、`subtitleSrt.ts` ~110 行、`subtitleGuard.ts` ~40 行。
* **被改文件也要守住 800 行**（P1-5）：`OperationApplier.ts` 现状 **785 行**，本次只允许 +8 行以内（switch 分支 3 + `touchedTrackIds` case 3 + import 2），提交前实测 ≤ 800；超了就先把 `touchedTrackIds` 的字幕判断搬进 `subtitleClips.ts` 里的一个已导出断言函数。`agent.ts`（690）、`tools/index.ts`（522）、`systemPrompt.ts`（765）同样提交前量一次。
* **L0 净增 ≈ 0**（P1-6/D-18）：改动前后各测一次 `prompt().length`（无索引）与 `prompt(MAX_INDEX).length`（满索引），两组数字写进提交说明；`systemPrompt.toolkit.test.ts` 必须全绿。这不是「建议」——17 字符余量意味着任何追加都会被这条产品预算顶回来。
* 无新依赖（解析器手写，`subtitleLayout.ts` 已是本地纯函数）。
* 无 `any` 新增（用 `unknown` + 收窄）；工具错误文案英文（与其它工具一致，面向模型），`next_step` 是**字符串**（与 `askUserTool.ts:70`、`planTool.ts:128`、`visionAdapter.ts:230` 同一约定；`stillGuard` 的对象形态是那一条特例）。
* 字幕工具**不抛异常**：所有校验失败都 `return` 带 `success:false` 的结果（D-8），单测里用 `expect(...).resolves` 而不是 `rejects`。

---

## 10. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| RK-1 | **`reconcile` 误打包**：新 op 未在 `affectedTrackIds` 加 case → `allowed=null` + `packAlways` → 加字幕会重排**所有**可重排轨道，用户的视频片段被悄悄挪动 | P0（静默数据变形） | D-5 + 强制回归测试 `reconcile.subtitleOp.test.ts`（视频/音频留白不得被吃掉） |
| RK-2 | 两条应用层漂移（服务端副本有字幕、界面没有） | P1（模型谎报成功） | D-4 的三条机制：唯一纯函数 + `totalDuration` 落进纯函数 + `updateTimeline` 回执；`subtitleDualApply.test.ts` 用 `deepEqual` 断言两侧 `tracks` 与 `totalDuration` 完全一致 |
| RK-3 | 字幕写到错误轨道（用户自建多字幕轨/字幕轨被删） | P1 | 缺省选首个 `subtitle` 轨；不存在则**新建**；显式 `trackId` 校验类型；结果回报实际 `trackId` |
| RK-4 | 违规整轨替换（R1-TL-01 重演） | P1 | `replace` 只能显式；一步可撤销；结果回报 `removedCount`；UI 侧已有的 `replaceTimelineAction(reason)` 保留历史 |
| RK-5 | 工具结果过大（120 条 × 文本）撑爆上下文 | P2 | 结果只回前 20 条 + `cuesOmitted`；文本只在 `overflowWarnings` 里截断给出。**注意**：SSE 上的 `operation` 载荷本身也带全部 cue 文本（≤ 120 × 200 字符 ≈ 24 KB），属既有 `tool_result` 通道可承受范围，但别在结果里再回一遍全文 |
| RK-6 | L0 提示词超限 | **P1（不是 P2）** | P1-6/D-18：满技能索引实测 18 483，离 18 500 只剩 17 字符，所以字幕常驻文本必须**净增 ≈ 0**（并进 rules 行 + 压缩两条 desc 腾位 + 配方替换）；改动前后各实测 `prompt().length` 与带索引值写进提交说明；`systemPrompt.toolkit.test.ts` 必须全绿 |
| RK-7 | 常驻 schema 挤占按需预算（`ToolActivationState`） | P2 | 记录改动前后 core schema 字节；`toolActivation.test.ts` 48 KiB 断言作护栏；必要时改按需类别 `subtitle_tools`（D-1 已留退路） |
| RK-8 | SRT 变体（Windows 换行、VTT、带 `{\an8}` 样式标签）解析失败 | P2 | 解析器容忍 BOM/CRLF/点号毫秒/缺序号；**不**解析 ASS 样式标签（原样保留为文本）；失败给行号让模型改用 `cues`。VTT 明确不在范围（§7.4） |
| RK-9 | 模型把长句塞进一条字幕，靠 `check_timeline` 才发现 | P2 | 工具当场回 `lineBudget`（按 `aspect_ratio` 算）与溢出行数（V10），比事后 lint 更早；`lintHint` 提示带同一画幅复验 |
| RK-10 | 与「视频轨必须最长」约束冲突（字幕比画面长） | P2 | 复用 `checkTrackDurationConstraint` 告警（V11），L0 既有硬约束已要求模型立即修正 |
| RK-11 | **SRT 读取被结果上限截断**（P0-1 的原始风险） | P0（静默错字幕） | 专用 `executeToolkitRaw` + §6.5 契约 + `subtitleSrtWorkspace.test.ts`（6 KB 逐字节相等） |
| RK-12 | **重放导致重复条目**（D-15 的原始风险） | P1（双层字幕、React key 冲突） | 纯函数按 id upsert + `subtitleIdempotency.test.ts` + AC-12 |
| RK-13 | 下游把 `'agent-op'` 当成 `ReplaceTimelineReason` 新增，或忘了 `touchedTrackIds` / `isTimelineOperation` 的运行期数组 | P1（编辑锁期间写入被拒 / 操作被静默忽略） | P1-2 的正文订正（不要新增 reason）+ §5#9/#12（`touchedTrackIds` / `isTimelineOperation`）+ §9.1 的锁轨与白名单断言 |

---

## 11. 发布与回滚

* **发布**：纯前端包（Next.js renderer + 本仓库 lib），后端零改动，无需迁移、无版本错位。新增字段（工具参数、操作类型、结果字段）全部是**增量**：旧会话历史里的工具卡片照常渲染（`getToolDisplayName` 对未知工具名回退到原名，`timeline/utils.ts:30-35`）。
* **版本错位**：桌面端前后端同版本发布，正常不会出现「旧渲染器收到 `add_subtitle_clips`」。万一出现：`isTimelineOperation` 的白名单不包含它 → 落到非时间线分支 → 被忽略（不会崩、也不会写脏数据），代价只是「这一轮没加上字幕」。这是可接受的降级，不需要版本握手。
* **回滚**：还原提交即可。历史对话中已存的 `add_subtitle_clips` 操作不会在回滚后被重放（操作只在下发当轮应用）；已写入工程的字幕是普通 `type:'subtitle'` 时间线条目，人工 UI 完全可读可编辑，不产生孤儿数据。
* **观测**：沿用既有 `[VideoEditingAgent]` 日志；`add_subtitles` 成功/失败都带 `error_code` 与 `addedCount`，便于线上统计「字幕失败率」；`subtitle_apply_refused` 单独计数即可定位「本地副本拒绝」这类漂移。

---

## 12. 实施顺序（给下游工程师）

1. `src/types/index.ts` + `types.ts`（类型先行，让 TS 把所有需要改的 switch 报出来；`updateTimeline` 的返回类型一起改）。
2. `subtitleClips.ts`、`subtitleSrt.ts`、`subtitleGuard.ts`（纯函数 + 各自测试，先绿；`subtitleClips` 的 upsert / `totalDuration` / `isVisible` 三条先钉住）。
3. `tools/toolkitAdapter.ts` 的 `executeToolkitRaw()` + `subtitleSrtWorkspace.test.ts`（**先证明「6 KB 能读回来」再写工具本体**，否则 P0-1 会以「实现完了才发现截断」的形式返工）。
4. `operationGuards.ts` → `OperationApplier.ts` → `agent.ts` → `reconcile.ts` → `AgentEventRouter.ts`（应用链路，边改边跑 `operationGuards` / `operationApplier` / `reconcile` 既有测试；`subtitleDualApply.test.ts` 在这步就该绿）。
5. `tools/addSubtitles.ts` + `tools/index.ts` 注册 + `registry/categories.ts` 描述 + 工具测试。
6. `systemPrompt.ts` / `promptParts.ts` / `i18n.ts` / `trimClip.ts`（披露与边界；**L0 净增 ≈ 0**：改动前后各测 `prompt().length` 与满索引值，`systemPrompt.toolkit.test.ts` 全绿）。
7. 全量 `npx vitest run src/lib/video-editing-agent` + `npm run type-check` + `npm run lint`，人工跑 §9.2 的 AC-1…AC-13（AC-6 用 ≥ 6 KB 的 SRT，AC-11 用竖屏工程，AC-12 靠重试/重放，AC-13 在 Agent 运行中操作）。

---

## 评审结论

**有条件通过（approved with conditions）** —— v1 的问题定义、根因定位与主体方案经逐条核对源码后成立（唯一缺的确实是「工具面上的入口」，不是模型能力），v2 已修掉全部 **2 个 P0 + 6 个 P1**，文档可以交给下游实现。但下列 6 个条件**必须在实现提交时用证据满足**，否则本设计的存在意义（「用户说加字幕就真的加上去」）无法被证明：

1. **P0-1 证据**：`subtitleSrtWorkspace.test.ts` 必须证明「≥ 6 KB 的 SRT 经 `executeToolkitRaw` 两页读回后与原文逐字节相等」，且 `content` 没有被截到 1200 字符（断言长度与块数）。只测 1 KB 文件**不算**通过。
2. **P0-2 证据**：`subtitleDualApply.test.ts` 断言同一操作在 `agent.ts` 本地副本与 `OperationApplier` 上的 `tracks` + `totalDuration` `deepEqual`；并断言 `updateTimeline` 返回 `{applied:false}` 时工具走 `subtitle_apply_refused`、`success !== true`。
3. **P1-5 证据**：提交里附 `OperationApplier.ts` 改动后的行数实测（必须 ≤ 800，现状 785）。
4. **P1-6 证据**：提交里附 L0 两组实测（`prompt().length` 与 `prompt(MAX_INDEX).length`），且 `systemPrompt.toolkit.test.ts` 全绿——**只加文字不腾位的一律退回**。
5. **人证证据（AC）**：AC-1（一轮内 18 条上轨）、AC-4（一步撤销把轨删干净）、AC-6（SRT 路径）、AC-11（竖屏预算）、AC-13（编辑锁下仍能写）五条必须在桌面端实跑并截图/贴日志；**AC-1 是本轮用户报障的正面回归用例，缺它不算完成**。
6. **复核触发条件**：实现过程中若出现下列任一情况，必须回到本评审再看一遍而不是就地扩展设计——(a) 需要新增第二种时间线操作类型；(b) 需要改 `reconcile` / `trackPatch` 的通用语义；(c) 需要给 `add_subtitles` 增加第二个数据来源（如 ASR 触发）；(d) `executeToolkitRaw` 之外还要放开别的裁剪通道；(e) 为了让 L0 过关而打算放宽 `18 500` / `48 KiB` 这两条上限。

**未采纳的评审建议（记录理由，避免重复讨论）**：
* 「去掉 `style` 参数，先只支持文本 + 时间」——不采纳：`SubtitleStyle` 有 4 个必填字段，不给就得在两条应用层各写一份默认值，正好违反 D-4。
* 「把字幕做成素材（`type:'subtitle'` 的 material）走 `add_to_track`」——不采纳：会引入「素材真相 vs 条目真相」，且 `.srt` 素材在导出链路上仍然要二次解析。
* 「直接放开 `workspace_import_material` 的 `.srt`」——不采纳：那只会得到一堆没人上轨的字幕素材，正是日志里用户被卡住的那一步。

---

## 实施过程发现的方案缺陷

> 实现节点记录（2026-10-28）。每条都是**动手时才发现**的，按「原文怎么写 → 为什么不行 → 实际怎么做」记录，供复核节点逐条核对；不是重新设计，只是把设计的缺口补齐。

| # | 设计的哪一处 | 为什么做不到 / 不够 | 实际做法 |
|---|---|---|---|
| **I-1** | §5 文件表没有 `src/components/video/hooks/clipAnimation.ts`，且 §5#2 只说「`updateTimeline` 签名改成回执」 | 这两条都会让 TS 编译期**必然**报错，不是风格问题：`clipAnimation.ts` 的 `ANIMATION_CLASS` 是 `Record<AgentTimelineOperation['type'], string>`（新增联合分支即缺 key），`targetClipId` 用 `operation.clipId` 读末尾联合（字幕没有该字段）；回执类型则让 12 个测试桩的 `updateTimeline: () => undefined` 不再可赋值 | `clipAnimation.ts` 增一条 `add_subtitle_clips: ''`（字幕整批落轨，逐条闪一下没有信息量）并把 `targetClipId` 改成 `switch`；12 个既有测试桩 + `tests/integration/agent-toolkit.test.ts` + `lastCompositionId.test.ts` 改为 `() => ({ applied: true as const })`。这是 **P0-2 的必然连带改动**，不是范围扩张 |
| **I-2** | §6.4 要求 `ε` 从 `tools/index.ts:265` 的 `POSITION_EPSILON` 导入 | `operationGuards` 运行在**浏览器**（`OperationApplier` 的守卫），而 `tools/index` 会把每一个工具（含 Node-only 依赖）拉进模块图；为了一个 `1e-6` 付出这个代价不划算 | `operationGuards` 内新增 `OVERLAP_EPSILON = 1e-6` 并注明「与 `POSITION_EPSILON` 同值、刻意不 import」，与 `qualityLint.LINT_DEFAULTS.overlapEpsilon` 的处理方式一致（同一份理由已写在那个文件的注释里） |
| **I-3** | §D-15 只要求「按 id upsert」 | **重复下发时工具会先撞上自己写过的字幕**：同 `toolCallId` 重放得到的 id 与既有条目相同、时间窗也相同，`append` 的重叠检查于是回 `subtitle_conflicts_existing`，AC-12（重放后仍是 18 条）直接失败——upsert 根本没机会执行 | 工具在冲突检查前把「id 属于本批」的既有条目排除（`foreign`），它们既不参与重叠判定，也不计入 `addedCount`（记 `updatedCount`）。幂等因此真正成立：`subtitleIdempotency.test.ts` + `addSubtitles.test.ts` 的「counts a replayed call as an update」 |
| **I-4** | §6.1 的表把**所有**失败都写成 `failure_class:'validation'`，§D-8 让 `isSubtitleGuardRejection` 一律豁免熔断 | `subtitle_apply_refused` 的语义是「本地副本与客户端对同一操作判断不同」（P0-2 要防的漂移），把它也豁免就等于让漂移无限重试、永不报警 | 豁免名单 = 除 `subtitle_apply_refused` 之外的全部字幕码；它照常计入连续失败。`agent.circuitBreaker.subtitles.test.ts` 的最后一条用例钉住这一点 |
| **I-5** | §6.1 末段要求工作区错误码「原样透传」，但 `subtitleRejection(code, …)` 的入参是 `SubtitleErrorCode` 闭集 | 类型上根本传不进 `workspace_not_found` / `invalid_offset` | `subtitleRejection` 的 `code` 放宽为 `string`，`next_step` 先查字幕表再落到通用建议；`toolkitAdapter.NEXT_STEPS` 补 `invalid_offset` / `invalid_page_size` 两条可执行建议 |
| **I-6** | §9.1 的「6 KB SRT 分两页读回」与 §6.5 的「`max_bytes:8000` 逐页」 | 算术上不可能：6 KB < 8000 字节，一页就读完了，「两页」永远走不到 | 用 **约 9 KB**（100 条 cue）的文件跨两页，逐条比对 100 条 cue 的文本与 `startTime`（截断会立刻少 cue 或错文本），并断言每页 `max_bytes=8000`。`subtitleSrtWorkspace.test.ts` |
| **I-7** | §3 / D-18 要求 L0 净增 ≈ 0，可用手段只有「并进 rules + 压缩两条 desc + 配方替换」 | 三处加起来仍是**净增**（rules 那条本身就是新增内容），而满索引只剩 33 字符余量 | 额外腾出一处**真重复**：`## 智能结果处理` 的三条与 `WORKFLOW_RECIPES_MD` 的前两条逐字重复，删掉该段（无任何测试依赖它）。最终实测 **`plain=17370 / full=18467`，与改动前逐字符相同（净增 0）**，`systemPrompt.toolkit.test.ts` 全绿 |
| **I-8** | §6.3 第 5 条「`totalDuration` 提升搬进纯函数，两个调用方都不再各自处理」 | `OperationApplier.applyToTimeline` 的 `Math.max(computeTimelineEnd(state), totalDuration)` 是**所有**既有操作（add/move/trim…）的时长提升点，删掉它会改变既有行为，且 §9.3 只给本文件 +8 行的预算 | 纯函数里照设计提升（服务端副本因此补齐），浏览器侧那一行**保留**——两次 `Math.max` 幂等，既有操作行为零变化。本文件实际 785 → **792 行**（≤800） |
| **I-9** | §5#13 只说「`rules` 增一条字幕规则」 | 新增一条 bullet 会多出换行与缩进 | 规则**并入**已有的「图片先成片再上轨」那一行末尾（同一句号内），不新增 bullet，符合 D-18 的「并进已有行」 |

**实施后与设计预算的差异（供复核）**：`addSubtitles.ts` 实测 **481 行**（设计预估 ~260）——多出的部分是 §6.1 一整张错误码表所需的判据、分页读取与结果回算；仍在 800 行上限内，且函数均 ≤50 行。其余新增文件：`subtitleClips.ts` 351、`subtitleSrt.ts` 139、`subtitleGuard.ts` 128。被改文件：`OperationApplier.ts` 792、`agent.ts` 713、`tools/index.ts` 526、`systemPrompt.ts` 763。

**评审结论第 6 条（复核触发条件）未触发**：没有新增第二种时间线操作类型、没有改 `reconcile` / `trackPatch` 的通用语义、没有给 `add_subtitles` 加第二个数据来源、没有放开 `executeToolkitRaw` 之外的裁剪通道、也没有放宽 `18 500` / `48 KiB`（实测 0 净增）。唯一越出 §5 文件表的是 I-1 的 `clipAnimation.ts`，属类型变更的强制连带。
