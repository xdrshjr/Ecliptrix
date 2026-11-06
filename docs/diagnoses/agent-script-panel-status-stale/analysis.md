# Agent 生成配音、字幕后，文案脚本面板状态未更新

> 阶段说明（2026-11-05）：下文保留修复前的诊断和方案评审记录，
> 其中六项诊断及两份输出日志是历史证据。修复后的 `repro.test.ts`
> 已转为运行默认测试目录的行为回归；最终代码审查、补充修复和验证见
> [review.md](./review.md)。不要把历史“仍待修复”结论或 6 项计数当作当前结果。

## 1. 问题描述

用户通过 AI 剪辑助手生成解说脚本、配音和字幕后，素材库和时间轴已有产物，左侧文案脚本卡片仍显示“未生成配音”“字幕未生成”，画面也可能仍显示“未配置画面”。

**结论：已在真实工具、时间轴操作应用器、状态派生函数及卡片组件上复现。主因是 Agent 产物缺少脚本段落关联，并非仅仅缺少一次 React 刷新。另有一个独立的展示缺口：缩略图只读取 `segment.videos`，没有使用时间轴已关联的画面。**

正确状态应分别取决于实际产物：

- 本段配音成功生成并关联，且文本、音色和语速仍匹配时，显示“配音已生成”；不匹配时应显示待更新。未上轨时仍区分候选配音和时间轴当前配音。
- 本段时间范围内已有字幕片段时，显示“字幕已生成”。
- 只有实际为本段配置了画面或关联了视觉片段，才显示“画面已配置”。仅生成配音和字幕时，画面缺失是正确状态。
- 画面状态、缩略图、试听、时长和段落定位应使用一致的段落关联。

本报告包含定位节点的诊断与本轮评审补证；本轮仅修改本报告，未修改产品修复代码，未执行 `git commit`。最终实施范围以文末“评审结论”为准。

### 调查基线与边界

- 调查日期：2026-11-05；Windows / PowerShell；Node.js `v22.18.0`，npm `10.9.3`，Vitest `4.1.5`。
- 仓库 HEAD：`fd68c709888318146bbcba44b700430795c27b34`；所有引用针对调查时的工作区文件。
- 已阅读 `README.md`、`CLAUDE.md` 和 `.claude-index/index.md`：产品是 Electron + Next.js + 本地 FastAPI；脚本面板、Agent 操作和时间轴均在前端相关模块衔接。
- 工作区开始时已有大量未提交改动，包括 `VideoEditingInterface.tsx`、`ScriptPanel.tsx` 等。已检查这两个文件的既有差异，涉及 AI 视频生成等待和项目标识；本次保留全部既有改动。
- 本轮评审期间，共享工作区另有并行改动。复核发现 `useMaterialManagement.ts` 新增的是向素材生成 hook 传递 `materialsRef`，本报告引用的 `:103–119` 桥接逻辑未变；其他并行改动保留不动。本轮自身的产品文件写入为零，不能将整个工作区差异归于本次评审。
- 没有使用真实 LLM/TTS 服务，没有启动 Electron 端到端会话，也没有用户原始出错会话日志。确定性复现将生成接口替换为成功响应，其他关键逻辑使用仓库真实实现。下述结论证明当前代码足以造成症状，不推断用户当时具体选择了哪个工具分支。

## 2. 复现步骤

### 2.1 无凭证、可直接执行的最小复现（已执行）

前提：在已安装项目依赖的工作区执行。当前工作区已有 `node_modules`，不需要新依赖。

```powershell
Set-Location 'M:/takoAI/Ecliptrix'
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/agent-script-panel-status-stale/vitest.repro.config.ts --reporter=verbose --no-color
```

随报告提供：

| 文件 | 用途 |
| --- | --- |
| `repro.test.ts` | 六个诊断用例，含只改变关联字段的对照实验 |
| `vitest.repro.config.ts` | 复用根配置，仅运行此目录的诊断用例 |
| `repro-output.txt` | 实际执行日志：1 个文件、6 个用例通过 |
| `baseline-output.txt` | 现有相关测试日志：3 个文件、49 个用例通过 |

诊断用例顺序：

1. 调用真实 `generate_video_script`，返回一段“清晨的阳光照亮山谷。”；确认发出的脚本操作和返回值没有稳定段落 ID。
2. 按界面现有规则使用 `agent-segment-0` 作为面板段 ID。调用真实 `generate_tts`，以成功响应提供 3 秒音频，再调用真实 `add_to_track`、`add_subtitles`。操作经真实 `OperationApplier` 写入时间轴。
3. 重新执行 `deriveSegmentStatus`：音频、字幕片段均已存在，但段落时间范围为 `null`，配音和字幕仍为 `none`。渲染真实 `SegmentCard`，确认显示“未生成配音”“字幕未生成”。
4. 保持同一时间轴，仅在测试内存中给音频素材补 `metadata.segment_id = 'agent-segment-0'`；同一状态派生得到 `voice=ready`、`subtitle=ready`，重渲染的真实卡片显示“配音已生成”“字幕已生成”。
5. 验证批量 TTS 使用请求临时段 ID，产物同样没有面板关联；验证视频已上轨但未关联时 `visual=missing`，只补素材关联后变为 `configured`。
6. 补充边界：Agent 上轨快照会丢失已有段落元数据；卡片在 `visual=configured`、`segment.videos` 为空时仍显示“未配置画面”。

测试没有模拟时间轴聚合器或复制状态派生算法；脚本面板 ID 用固定夹具表达 `VideoEditingInterface.tsx:697` 的映射。测试上下文以真实前端 `OperationApplier` 应用工具操作，并校验每次操作确实 `applied`，未覆盖 SSE 网络传输和整个编辑器挂载过程。

**六个用例通过表示“成功复现缺陷并验证原因”，不表示 Bug 已修复。** 这些诊断断言刻意保留当前错误行为；修复节点应将相应断言改为期望行为并纳入默认测试目录。

### 2.2 界面复现路径（供修复节点端到端复核）

已有开发环境可从以下命令启动桌面应用；应先按 README 安装前后端依赖，并在设置中配置可用的 Agent 模型和 TTS：

```powershell
Set-Location 'M:/takoAI/Ecliptrix/desktop'
npm run dev
```

1. 创建一个空视频编辑工程，打开左侧“文案脚本”和 AI 剪辑助手。
2. 向助手发送：

   > 请调用 generate_video_script，生成关于清晨山谷的 30 秒中文解说脚本。然后按每段 narration_text 调用 generate_tts 生成配音，使用 add_to_track 将音频顺序放入 audio-track-1，并通过 add_subtitles 按实际音频时长将对应解说写入字幕轨。

3. 检查助手工具记录：脚本工具、TTS、上轨和字幕工具均成功；确认素材库有音频，时间轴存在音频及字幕片段。若生成失败，应先排除服务配置问题，不能把生成失败当成此 Bug。
4. 收起脚本段卡片以显示缩略图区域，检查配音和字幕状态。当前实现可保持“未生成配音”“字幕未生成”。
5. 若需复现画面部分，先导入一个本地视频，明确要求助手将该素材作为第一段画面并通过 `add_to_track` 上到视频轨；确认上轨后检查第一段的画面芯片及缩略图。
6. 若没有生成或指定画面，不将“未配置画面”计为失败。

模型可能选择不同工具，因此第 2.1 节是确定性复现依据；本节没有声称已经完成真实服务端到端验证。

## 3. 根因分析（含证据）

### 3.1 面板依赖段落关联，而 Agent 脚本操作没有共享段落身份

脚本工具的 `segmentsForDisplay` 只保存标题、画面脚本和解说；返回给模型的是 `index/title/narration_text`，没有真实面板段 ID：

- `src/lib/video-editing-agent/tools/generateVideoScript.ts:119`：构造不带 ID 的结构化段落。
- `src/lib/video-editing-agent/tools/generateVideoScript.ts:133`：记录 `set_script_with_narration`。
- `src/lib/video-editing-agent/tools/generateVideoScript.ts:154`：返回 1 起始索引和解说文本。
- `src/lib/video-editing-agent/types.ts:208`、`src/stores/slices/scriptSlice.ts:22`：操作及中间数据类型也没有段 ID。
- `src/lib/video-editing-agent/AgentEventRouter.ts:424`：将这些段落写入 store。
- `src/components/video/VideoEditingInterface.tsx:697`：界面随后自行构造 `id: agent-segment-${i}`。

因此，当前生成操作没有提供“脚本结果、TTS 输入、素材和时间轴共用的段落标识”。`batch_generate_tts` 的 `input_index` 能定位批量请求中的顺序，但不是持久化脚本段身份。

已有编辑上下文会传选中段的信息（`useAgentExecution.ts:700`、`editorContextPrompt.ts:11`），不能据此断言 Agent 完全不知道选中段。但 TTS 和上轨参数本身没有消费段 ID 的契约，选中段提示也不能解决新建多段脚本的绑定。

### 3.2 单段和批量 TTS 产物缺少段落元数据

单段 TTS 参数只有文本、音色、语速（`generateTts.ts:14`）；`createSpeechMaterial`（`generateTts.ts:128`）只生成音频素材基本字段，没有 `metadata.segment_id`、文本哈希、生成时间戳或 `sentenceSegments`。

批量 TTS 有两个断点：

```typescript
// src/lib/video-editing-agent/tools/batchGenerateTts.ts:45
segment_id: `${taskId}-seg-${input_index}`, input_index,
```

这里是后端请求结果匹配用的临时标识，不等于界面中的 `agent-segment-0`。随后 `createBatchMaterial`（同文件 `:135`）没有把任何脚本段身份写入素材。

面板查找配音的必要条件则是：

```typescript
// src/components/video/lib/segments/segmentLinks.ts:184
if (material.type !== 'audio' || material.metadata?.segment_id !== segmentId) return;
```

所以即便素材库确实新增了音频，`findLatestVoiceMaterial` 也找不到“本段音频”。`deriveSegmentStatus`（同文件 `:335`）在没有关联音频时保留 `voice='none'`。

**正常路径对照：**手动“生成本段配音”使用 `useSegmentVoiceGeneration.ts:167` 写入 `sentenceSegments`，并在 `:168` 的 metadata 中写入 `voice_type`、`voice_speed`、`segment_id`、`segment_assigned_at`、`segment_text_hash`。缺失的是 Agent 与手动路径之间的数据契约一致性。

### 3.3 上轨操作缺少段落归属，字幕因此无法取得段落时间范围

`add_to_track` 参数（`src/lib/video-editing-agent/tools/addToTrack.ts:8`）只有素材、轨道、时间和静态叠加选项。创建的片段（`:152`）没有段落字段，也不回写脚本段的画面内容。

`resolveItemSegmentId`（`segmentLinks.ts:114`）依次读取：

1. 片段 `sentenceSegments.segment_id`；
2. 源素材 `metadata.segment_id`；
3. 源素材或片段 `metadata.linkedSegmentId`。

Agent 生成的普通 TTS 素材和上述片段都没有这些字段。`computeSegmentTimeRange`（`:157`）先取本段所有关联音频的包围区间；没有关联音频时，才取关联视频的包围区间。因此本次无关联夹具得到 `null`，不是把音频、视频范围无条件合并。

字幕是否就绪依赖这个时间范围：

```typescript
// src/components/video/lib/segments/segmentLinks.ts:299
function hasOverlappingSubtitle(tracks, range) {
  if (!range) return false;
  // 后续才检查字幕轨与段落范围是否相交。
}
```

上面摘录省略类型，仅用于说明分支。最终 `deriveSegmentStatus`（`:343`）将结果转换成 `ready/none`。`add_subtitles` 已实际添加字幕也不能绕过缺失范围的分支。其 cue schema（`tools/addSubtitles.ts:71`）本身只有文字和时间，当前不会直接绑定脚本段。

实际日志（`repro-output.txt`）：

```text
单段配音与字幕已上轨：
{"types":["audio","subtitle"],"range":null,
 "status":{"visual":"missing","voice":"none",
 "voiceOnTimeline":"absent","subtitle":"none","candidate":null}}

仅补齐配音关联的对照组：
{"visual":"missing","voice":"ready","voiceOnTimeline":"current",
 "subtitle":"ready","candidate":null}
```

两组使用相同音频和字幕时间轴，只改变内存中的素材段 ID，已支持“缺少关联导致错误状态”的因果判断。

### 3.4 画面芯片和缩略图分别存在关联与展示缺口

画面芯片来自 `deriveSegmentStatus`（`segmentLinks.ts:340`）：段落 `videos` 非空，或者存在关联视频片段，才算 `configured`。普通 Agent 上轨没有段落关联，因此即使视频轨已有画面也可能显示 `missing`。

此外，缩略图有独立数据源：

```typescript
// src/components/video/components/SegmentCard/SegmentCard.tsx:87
const first = segment.videos?.[0];
```

找不到 `first` 时直接显示 `copy.noVisual`（同文件 `:106`）。即使补齐素材关联使画面芯片已经 `configured`，卡片也可能同时显示“画面已配置”和“未配置画面”。第六个诊断用例已通过真实组件渲染确认这一组合。

手动段落命令会回写 `videos`（`src/components/video/lib/segments/segmentCommands.ts:487`、`:504`），而 Agent 的 `add_clip` 没有这个脚本补丁。修复必须覆盖画面内容来源，不能只改芯片。评审进一步确认，展开的画面列表及切换按钮也读取 `segment.videos`，见第 8.3 节；只修收起态缩略图仍不完整。

### 3.5 快照丢字段是后续修复必须注意的边界

`toAgentClipMaterial`（`src/lib/video-editing-agent/tools/index.ts:310`）只保留 `storageKind/storageKey/localResolvedUrl` 这三个 metadata 字段。已有的 `segment_id`、`linkedSegmentId` 以及 `sentenceSegments` 不会进入片段素材快照。

`OperationApplier.ts:641` 的 `addClipToState` 及 `agent.ts:635` 的 `addClipLocally` 都不会补回段落关联。即使素材库中的元数据正确，当关联解析不再能查到该素材时，片段自身也无法表达归属。第五个用例仅用空素材查找表验证了这个边界，没有声称正常 UI 删除素材一定会保留该片段。

另须注意：当前 `resolveItemSegmentId` 不读取 `item.metadata.segment_id`。只把这一字段复制到片段，也不足以修复快照路径；应选择解析器已识别的字段，或一致地扩展读写协议。

### 3.6 为什么不是简单的界面刷新问题

代码已存在更新通路：

| 边界 | 证据 |
| --- | --- |
| Agent 素材操作 → store | `src/lib/video-editing-agent/AgentEventRouter.ts:396` |
| 新 store 素材 → 编辑器本地素材列表 | `src/components/video/hooks/useMaterialManagement.ts:103` |
| Agent 时间轴应用 → 外部更新 ID | `src/components/video/hooks/useAgentExecution.ts:365` |
| 外部更新 → 时间轴 store | `src/components/video/timeline/TimelinePanel.tsx:482` |
| 订阅轨道、按段落/素材/轨道重新派生 | `src/components/video/hooks/useSegmentLinks.ts:121`、`:129` |
| 将同一份段落和全部素材传入关联 hook | `src/components/video/VideoEditingInterface.tsx:2170` |
| 状态 → 中文芯片文案 | `src/components/video/components/SegmentCard/SegmentStatusChips.tsx:23`、`:45` |

复现中直接对最新完整数据重新派生，结果依旧错误；补充关联后真实卡片随 props 更新正确。强制刷新、加轮询或修改 `useMemo` 依赖不能生成缺失的段落身份。

补充风险：素材桥接（`useMaterialManagement.ts:108`）只合并“新 ID”素材，不传播任意已有素材的 metadata 更新。若后续方案打算先发无关联素材、再用同 ID 补标签，必须一并解决该桥接；优先在首次生成素材时就携带完整关联。

## 4. 影响面

| 功能/场景 | 影响与依据 |
| --- | --- |
| Agent 单段、批量生成脚本配音 | 配音已存在但段落状态、候选配音和版本关联缺失；由两个 TTS 工具及状态派生直接证明 |
| Agent 创建字幕 | 有字幕轨但缺少段落时间范围时，脚本卡片仍显示未生成；不代表字幕文件或字幕片段缺失 |
| Agent 为段落添加画面 | 未绑定段落时芯片仍缺失；即使完成绑定，缩略图仍可能因为 `segment.videos` 为空而缺失 |
| 试听、段落定位、联动高亮 | 同一关联数据缺失会影响这些入口；`SegmentCardList.tsx:188` 以 `latestVoice !== null` 控制试听，范围与高亮来自 `useSegmentLinks` |
| 重新生成、撤销和工程重载 | 新方案需要稳定段 ID、快照及持久化支持；本次未完成这些真实端到端场景验证，不将潜在风险记成已复现缺陷 |
| 手动逐段配音/段落画面命令 | 已有写入关联的实现可作对照；不能泛化为所有手动流程均无问题 |
| 普通背景音乐、无脚本配音、装饰叠加 | 允许没有段落归属；修复不应自动把所有音频/画面算到某一脚本段 |
| 播放与导出 | 本次证据是关联/展示问题，没有证据表明此次缺陷必然损坏音频文件、字幕片段或导出内容 |

以上路径由桌面和浏览器调试模式共用，不属于单独后端生成服务故障。

## 5. 候选修复方案对比

| 方案 | 具体做法 | 侵入性 | 风险 | 工作量 |
| --- | --- | --- | --- | --- |
| A：补齐明确的段落关联契约（推荐） | 脚本生成返回稳定段 ID，前端沿用；TTS 和上轨工具接收可选段 ID；产物首次写入时保存归属及配音版本信息；关联穿过片段快照；卡片缩略图使用一致的画面来源 | 中等：工具参数、操作类型、脚本映射、素材快照及卡片展示的有限改动 | 需要处理旧操作、脚本替换、异步结果与撤销；可通过可选字段及无归属旧行为兼容 | 中等 |
| B：前端按文本/索引/时间推断归属 | 在收到工具结果后匹配脚本文字或批次索引，补素材标签及画面内容，再重新派生 | 较低到中等 | 重复解说、同文多段、重排、部分失败及整篇音频易错绑；已存在的纯音频素材甚至没有完整文本；不能作为可靠通用修复 | 初期较小，长期维护较大 |
| C：让 Agent 使用统一段落命令 | 扩展段落级 Agent 工具，通过现有 segment command 统一更新脚本、素材、时间轴和撤销记录 | 高：增加 Agent 与前端段落事务桥接，调整工具执行路径 | 一致性较好，但需处理服务端工具与客户端命令边界、批量执行和历史兼容，超出此次缺陷最小修复范围 | 大 |

单纯把“工具成功”映射为三个绿色芯片，无法区分成功生成、实际关联、是否上轨和是否配置画面，不构成可接受方案。

## 6. 推荐方案及理由

推荐 **A：在保留现有状态派生机制的前提下，补齐生产数据的段落关联，并统一画面展示来源**。对照实验已证明现有状态派生在得到正确关联后可以工作，无需重写整个工作台状态系统。

建议修复节点按以下边界落实：

1. **先确定稳定段身份。** 生成脚本时一次分配段 ID，同时写入工具结果和操作；界面保留这个 ID。新脚本使用本次生成范围内唯一、跨次不复用的 ID；重排、重渲染、持久化及重载保留已有 ID。旧操作缺省 ID 的兼容归一化只能在接收操作时执行一次，不能在 React effect 每次运行时重新生成。已保存工程中的旧段 ID 原样保留，不批量重编号。评审已确认 `expand_video_script` 和 `understand_video_script` 实际走 `set_script` 文本路径（`src/lib/video-editing-agent/tools/expandVideoScript.ts:165–169`、`src/lib/video-editing-agent/tools/understandVideoScript.ts:141–145`），不是 `set_script_with_narration`；检查兼容即可，不必为本修复重写它们。
2. **TTS 接受明确归属。** 单段工具增加可选脚本段 ID；批量工具每项带脚本段 ID，保留原始 `input_index` 区分部分失败。批次请求 ID、脚本段 ID、素材 ID 必须分开：保留现有每次请求唯一的临时 ID，以它关联响应，再通过原始索引取脚本归属。成功素材在第一次 `add_material(s)` 前即写入 `segment_id`、`segment_assigned_at`、请求时文本哈希、实际音色和语速。普通无脚本 TTS 仍允许无归属。禁止把脚本段 ID 直接替换后端请求 ID，具体冲突证据见第 8.2 节。
3. **配音时序不能伪造。** 此次状态修复并不要求凭空增加句级时间信息；若需要 `sentenceSegments`，必须来自真实句级生成/对齐结果。文本编辑、音色回退、速度变化和删除段落后的迟到结果应遵循现有手动路径的 stale/丢弃语义。
4. **上轨支持明确的段落绑定。** 音频继承有效素材关联，视频可显式指定目标段。片段以 `metadata.linkedSegmentId` 保存有效归属，并由服务端本地副本和前端应用器一致写入。显式片段归属优先于素材兜底；已有真实 `sentenceSegments.segment_id` 保持兼容，若与显式目标冲突则拒绝绑定，不得伪造句级时序来覆盖冲突。同一素材跨段复用不原地重标素材。快照只透传需要的关联字段，序列化、撤销和重做应保留它们。
5. **同步画面内容。** 选定只读派生方案：在现有段落关联层提供画面展示列表，收起态缩略图、展开态轮播及其导航共用该列表。保留手动 `segment.videos` 候选来源；已关联时间轴画面使用素材库信息，素材缺席时可使用片段的媒体快照。仅缺少缩略图时显示有画面的占位，不显示“未配置画面”。不把派生列表回写脚本，不增加 Agent 脚本补丁事务；候选“应用”操作仍读取真实候选，不能把已上轨画面伪装成新候选。
6. **字幕状态继续反映实际落轨。** 对本次“配音和字幕均已上轨”路径，补齐音频归属即可恢复范围和状态。若产品还要求“只有字幕、没有关联音视频”的脚本段显示就绪，则应为字幕建立明确段关联并扩展派生；不能仅凭项目中存在任意字幕就标记所有段就绪。
7. **让工具实际获得并校验身份。** 将当前脚本段的最小快照（ID、配音文本、段级音色/语速）随 Agent 请求传入工具上下文，并在新脚本生成成功时更新同回合快照；在工具结果和提示中明确要求脚本配音/画面调用传递 ID。仅增加可选参数而不给模型提供可用 ID 不足以完成修复。显式未知 ID、空白 ID 或不匹配的整段配音文本应返回可理解的失败，不静默绑到选中段；缺省 ID 保持普通工具行为。结果写入时还须核验当前工程/段落，不能只依赖请求开始时快照。
8. **审查已有数据兼容。** 新契约不会自动修复所有旧的无标记产物。此次不新增猜测迁移或重新绑定界面；保留已有明确关联和无归属行为。旧产物需要有明确段 ID 的重新生成/上轨才可建立可靠关联，不能用序号或文件名批量猜测。

### 修复后的验收清单

- 单段 TTS 成功且文本/音色/语速匹配后，无需刷新即可显示配音就绪；生成但未上轨时不伪装成已应用。
- 批量请求第二段成功、第一段失败时，只更新成功段；相同文本的两段不互相串联。
- 关联音频及相交字幕上轨后，对应段显示字幕就绪；未建立段落范围或字幕完全在范围之外时不标就绪。
- 明确用于某段的视频上轨后，画面芯片、缩略图、展开态画面及导航一致；只做配音和字幕不将画面标记为已配置。
- 改脚本文字、音色、速度后，旧配音能显示待更新；重新生成脚本不沿用其他脚本的关联。
- 新关联通过片段撤销、重做、重载、素材复用与迟到回执检查，均不串段；旧操作及无脚本工具调用保持兼容。脚本整体撤销的现有边界另见第 8.4 节，不假定现有中间 store 已保证完整脚本撤销。
- 新增真实“工具 → 操作 → store/hook → 卡片”的集成回归，而不是只分别测试工具成功和预先标好的素材。

## 7. 已执行验证与交接

| 验证 | 结果 |
| --- | --- |
| 独立诊断复现 | `6 passed`；真实工具、前端操作应用器、派生函数和卡片渲染；完整日志见 `repro-output.txt` |
| 现有段落派生、TTS 默认音色和字幕工具测试 | `49 passed`，3 个测试文件；完整日志见 `baseline-output.txt` |
| 真实供应商调用、桌面端到端回放 | 未执行；需要修复节点按第 2.2 节验证 |
| 产品修复、全量构建、提交 | 本节点不执行；当前成果是定位报告及独立诊断附件 |

现有相关测试的复核命令：

```powershell
Set-Location 'M:/takoAI/Ecliptrix'
node node_modules/vitest/vitest.mjs run src/components/video/lib/segments/__tests__/segmentLinks.test.ts src/lib/video-editing-agent/__tests__/ttsTools.defaultVoice.test.ts src/lib/video-editing-agent/__tests__/addSubtitles.test.ts --reporter=dot --no-color
```

定位节点上报记录：其 `progress` 返回 `TASK_SERVER_URL is not set`，完成时按任务文件规定重试后使用指定任务板的 `Subtask #0` 文件回退。本轮为评审节点 `Subtask #1`，不修改前一节点的完成记录，也不把文件回退描述为调度服务器确认。

## 8. 评审补证与方案审计（2026-11-05）

### 8.1 真实执行路径与证据强度

已核对从 Agent 入口到卡片的生产调用链，并独立复跑诊断。第 2 节测试不是完整编辑器集成测试：素材直接来自工具上下文，脚本 ID 是夹具，未经过真实 SSE、router、素材桥接和 React effect。以下代码证据补足路径可达性，不能冒充用户会话日志或真实端到端执行。

| 边界 | 本轮核对的生产代码 | 结论 |
| --- | --- | --- |
| 编辑器 → Agent 路由 | `useAgentExecution.ts:685–705` 请求 `/api/video-editing-agent/chat`；`src/app/api/video-editing-agent/chat/route.ts:573–597` 构造 Agent | 本次检查的是编辑器实际使用的入口 |
| 路由 → 被诊断工具 | `agent.ts:171–188` 构造并加载工具；`tools/index.ts:411–415`、`:443–452` 注册上轨、字幕、单段/批量 TTS、脚本工具 | 复现调用的工厂与生产注册的是同一实现 |
| 工具操作 → SSE | `agent.ts:105–121` 保存操作；`:549–557` 取出操作；`:589–596` 随 `tool_result` 发送 | 没有另一层在传输前补齐脚本关联；取消时不发送操作 |
| SSE → 状态写入 | `AgentEventRouter.ts:255–270` 分流；`:396–425` 写素材/脚本；时间轴交 `OperationApplier` | TTS 的无关联素材原样进入 store；上轨的无关联片段进入时间轴 |
| 状态写入 → 面板 | `VideoEditingInterface.tsx:691–735` 构建脚本段；`useMaterialManagement.ts:103–119` 合并新素材；`TimelinePanel.tsx:482–513` 应用外部时间轴；`useSegmentLinks.ts:119–149` 订阅并派生 | 更新触发通路存在，但不会推断缺失的段 ID |
| 派生 → 展示 | `SegmentCardList.tsx:176–188` 传入状态和配音可用性；`SegmentCard.tsx:87–106` 单独读取画面 | 芯片与画面内容的数据来源确实不同 |

本表除完整路径外，简写文件均属于前文已经给出目录的同名文件。因果证据仍是本轮复跑得到的同数据对照：`range=null / voice=none / subtitle=none`，只补素材 `segment_id` 后变成 `voice=ready / voiceOnTimeline=current / subtitle=ready`。这证明当前代码中的充分致错条件；没有用户原始工具记录，不能断言所有同类投诉都走了这一分支。

**反例与替代解释的结论：**

- 不是所有 Agent 上轨都必然失联。若源素材已有匹配的 `metadata.segment_id`，且仍在面板素材列表中，`segmentLinks.ts:120–124` 可以恢复归属；第五个诊断用例也先断言了这种情况下配音为 `ready`。缺陷是生成/普通上轨不建立契约，不是解析器永远失效。
- 字幕目前只检查时间相交，既不比较文字，也不要求覆盖整段（`segmentLinks.ts:299–306`）。没有关联音视频时，即使字幕落轨也无法建立段范围；有范围时，任意相交字幕都可能使状态就绪。端点刚好相接不算相交。这里不能承诺“验证字幕文字正确”或“无关但相交的字幕不会计入”，也不为本次修复扩大字幕协议。
- 画面不是生成配音/字幕的附带结果。`visual=missing` 在没有配置或关联画面时正确；静态图上到视频轨后的项类型也可能是 `video`，应结合 `originalMaterialType` 展示图片，不能一律当视频播放。
- 配音已关联也未必为 `ready`：`segmentLinks.ts:224–231` 检查文本、实际音色及语速；`:332–337` 优先判断时间轴正在使用的音频。已有旧配音在轨时，新配音属于候选，不能强行把芯片改绿。
- 传输失败、上轨拒绝、实际生成失败仍是其他会话的可能原因；本次复现固定成功响应、检查 `applied` 且直接使用完整最新数据，因而这些因素不能解释此处对照差异。素材同 ID 更新桥接的缺口已在第 3.6 节单列，不应与缺少首次关联混为一谈。

### 8.2 身份、配音版本与错误路径的遗漏

1. **批次 ID 不能改成脚本 ID。** `batchGenerateTts.ts:43–48` 每次生成临时请求 ID；`ttsResponse.ts:170–202` 按该 ID 校验唯一响应，并生成 `material_id: tts-${request.segment_id}`。若直接用稳定脚本 ID 替换它，同段重复生成会得到相同素材 ID；同批同段重复项也无法一一对应。结合素材桥接仅接纳新 ID，这会造成新版本不显示或关联错误。必须保留每次请求唯一标识，以 `input_index` 查回请求项中的脚本 ID，部分失败只添加成功项。
2. **文本哈希不是任意字符串散列。** `src/components/video/lib/aiMix/segmentTextHash.ts:37–44` 调用真实句级请求转换器，以换行拼接句子后计算 FNV；`src/lib/api/tts.ts:204–219` 优先拆分解说文本，否则保留脚本句子边界。Agent 单段 TTS 则直接发送 `params.text.trim()`（`generateTts.ts:39`、`:120`）。修复应核对传入配音文本与请求时脚本快照一致，并复用现有规范化/哈希规则；不能对任意文本盖上当前脚本哈希。多句解说、空格和无解说的句子数组都要覆盖，避免新配音刚生成便误判 stale，或实际读错文案仍显示 ready。
3. **“最新”当前指成功写入时间。** `segmentLinks.ts:172–185` 按数值 `segment_assigned_at` 选择最新，时间相同取后遍历者；`:288` 也以该时间与用户应用时间比较。Agent 应与手动路径一样按成功结果写入毫秒时间，不能改成请求序号或秒时间。允许并发时，每份结果保留自己的文本/设置快照；旧文本迟到仍为 stale，不自动改写脚本或替换正在使用的音频。相同段的多个成功版本应有不同素材 ID。
4. **实际音色必须取最终结果。** `generateTts.ts:78–96` 可能回退音色；`:58` 已回显 `outcome.voiceType`。元数据须记录这一实际音色及裁剪后的实际语速（`:46`），不能写最初请求值。回退音色与工程/段落期望不同，出现 stale 是真实差异；本修复不静默改用户的音色设置来消除它。
5. **错误及取消不能产生成功关联。** 保留 `generateTts.ts:48–54` 和 `batchGenerateTts.ts:51–65` 的成功/取消检查，以及 `ttsResponse.ts:194–210` 对重复、未知、缺失响应的处理。ID 校验应在调用服务及产生操作前完成；响应到达时重新核对当前段落存在性。手动路径 `useSegmentVoiceGeneration.ts:212–216` 丢弃已删除段结果可作语义参考，但它只是单次检查，不等于已有全链路并发保证。
6. **现有选中段提示不足以实现新参数。** `editorContextPrompt.ts:34–38` 在有 `segmentLabel` 时只显示标签，不输出稳定 ID；`ToolContext`（`types.ts:21–124`）也没有当前脚本段快照。故第 6 节确定用最小脚本上下文贯通请求、路由、Agent 和工具，并把 ID 明确暴露给模型；新生成脚本须同回合可查。不得按“当前选中段”隐式绑定每个异步结果。

### 8.3 片段优先级与画面内容的遗漏

当前解析顺序是句级归属 → 素材 `segment_id` → 素材 `linkedSegmentId` → 片段 `linkedSegmentId`（`segmentLinks.ts:118–124`）。静态反例：素材属于 A，在新片段上只写 `metadata.linkedSegmentId=B`，仍会返回 A。因此“把可识别字段写进片段”不足以支持素材复用。第 6 节选定：显式片段关联置于素材兜底之前；保留句级数据优先语义并拒绝冲突，不改共享源素材。此优先级变更应增加手动片段和跨段复用回归。

`toAgentClipMaterial` 当前对白名单外元数据的过滤确实丢失关联，但最终时间轴实体并不会普遍丢弃 metadata：`src/components/video/timeline/domain/entities/TimelineItem.ts:309`、`:320` 从普通对象读 metadata/句级信息，`:538`、`:547` 写回。优先利用现有可持久化字段，只修改必要的操作类型、快照与两个应用器；没有证据要求数据库迁移或全局序列化重写。

画面展示的补证：

- `ScriptPanel.tsx:1630–1635` 把原始段交给 `SegmentVideoCarousel`；后者 `:215–217` 只读 `segment.videos`，空数组直接不渲染。
- `ScriptPanel.tsx:1146–1158` 的前后切换也在原始 `segment.videos` 为空时直接返回。只给缩略图或轮播组件补 props，按钮仍可能无效。
- `SegmentNotice.tsx:61–69` 把 `segment.videos[0]` 用作待应用候选。展示列表不能替换这一业务含义，否则会把已上轨画面再次当候选应用。

因此选定一份只读画面展示列表：真实手动候选优先保留，随后合并该段已关联的视频轨画面，按确定的时间/轨道/片段顺序去重；无候选时直接显示时间轴画面。缩略图、展开态列表和导航共同消费，列表变化时约束当前索引。对撤销/删除后既无候选也无关联片段的段，画面空态随派生恢复。这里补齐的是现有面板内容，不新增画面编辑工作流。

### 8.4 候选方案、最小范围与撤销审计

| 方案 | 并发、错误和边界审计 | 评审决定 |
| --- | --- | --- |
| A：明确关联契约 | 能解决主因，但必须加入请求/脚本/素材 ID 分离、真实请求快照、迟到结果校验、片段优先级及完整画面展示。只加三个可选参数仍不足以闭环 | 采用第 6 节收敛后的 A；保留现有派生、字幕和时间轴架构 |
| B：按文本/索引/时间推断 | 相同文本不同段无法确定身份；重排改变序号；批次部分失败改变成功数组位置；同一时间可有 BGM 和叠加。事后同 ID 补标签还遇到素材桥接缺口，重复重试可能覆盖用户新选择 | 不采用，不作为隐藏的兼容兜底 |
| C：统一段落命令 | 手动 `planSegmentVisualReplace` 已有段存在、锁轨和跨段复制检查（`segmentCommands.ts:453–480`），但不能直接替代远程 TTS、请求取消及 SSE 顺序。跨前后端引入事务与新的撤销桥接扩大变更面 | 不采用；可借用校验规则，不重构 Agent 成段落命令系统 |

还有两个必须明示的范围限制：

- **单工具调用只保存一个操作。** `agent.ts:119–121` 使用 `Map.set(toolCallId, operation)`，`generateVideoScript.ts:129–137` 已显式提醒。不能依次记录 `add_material` 和 `set_script_with_narration` 并期待都到前端；后者会覆盖前者。推荐方案把归属写入首次素材/片段操作，画面只读派生，不引入第二个操作或新的复合事务。
- **现有脚本撤销不是完整保证。** `OperationApplier.ts:385–395` 只快照临时 `store.scriptSegmentsData`，而 `VideoEditingInterface.tsx:729–735` 消费后会 `resetScript()`；撤销在 `OperationApplier.ts:486–488` 恢复这个临时值。仅凭这些代码不能证明持久化的 `content.scriptSegments` 会完整恢复；当前诊断也未实测这一场景。此次不得宣称修复了全量脚本撤销。本方案不新增画面脚本回写，避免扩大该边界；若实现改动脚本撤销，则须针对真实 content 快照另行验证，不能以补 ID 代替验证。

### 8.5 本轮实际验证

在未修改产品代码的当前工作区执行，均为退出码 0；不覆盖上一节点的日志文件，新增结果直接记录于本报告。

```powershell
node node_modules/vitest/vitest.mjs run --config docs/diagnoses/agent-script-panel-status-stale/vitest.repro.config.ts --reporter=verbose --no-color --no-cache
```

结果：`Test Files 1 passed (1)`，`Tests 6 passed (6)`，耗时 `3.90s`。再次得到缺少关联的错误状态、补齐关联后的就绪状态，以及“画面已配置 / 未配置画面”同时出现的组件证据。六项为诊断通过，不是修复通过。

```powershell
node node_modules/vitest/vitest.mjs run src/components/video/lib/segments/__tests__/segmentLinks.test.ts src/lib/video-editing-agent/__tests__/ttsTools.defaultVoice.test.ts src/lib/video-editing-agent/__tests__/addSubtitles.test.ts src/lib/video-editing-agent/__tests__/ttsTools.errorPropagation.test.ts --reporter=dot --no-color --no-cache
```

结果：`Test Files 4 passed (4)`，`Tests 90 passed (90)`，耗时 `4.04s`。包含原来的 49 项及 41 项 TTS 错误传播测试；“忽略无关或无效结果条数：1”来自重复/未知响应测试的预期告警，不是测试失败。

修复节点还须新增有意义的行为回归：真实 router/store/hook/card 串联；同段重复批量生成与乱序/部分失败；多句配音哈希；文本或设置变化后的迟到结果；相同素材用于两个段；显式 ID 无效、无 ID 普通调用；收起/展开画面及导航；关联字段经 JSON、时间轴实体、撤销/重做往返；脚本替换后旧结果不关联新段。此处列的是后续验收，不是本轮已经通过的测试。

## 评审结论

**最终只推荐方案 A：以稳定脚本段 ID 贯通生成结果、TTS 素材和上轨片段，并在现有关联派生层提供统一的只读画面展示列表。** 按第 6 节及第 8 节约束实施，不采用文本/序号猜测，不引入新的段落事务系统，也不只更新状态文案。

理由是确定性对照已证明：真实产物具备正确归属时，现有配音与字幕派生即可恢复；生产调用链中确实没有补齐归属的环节。同时，缩略图和展开态画面各自只读 `segment.videos`，必须一并接入派生内容才能满足“状态和内容更新”。批次 ID 分离、请求快照、片段优先级和首次完整写入，是避免该方案引入版本冲突、串段与迟到回写回归所必需的边界，并非附带重构。

**评审结果：根因成立，补证及方案收敛后可交修复节点实施。** 已明确撤销、旧无归属产物和字幕仅按时间相交的现有能力边界。此次交付是分析评审完成；产品 Bug 仍待后续节点修复及端到端验收。
