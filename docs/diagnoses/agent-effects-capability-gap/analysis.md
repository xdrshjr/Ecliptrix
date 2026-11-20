# Agent 剪辑助手无法"生成特效 + 给素材设置特效"——能力缺口分析

> 类型：能力缺口（feature gap），按 Bug 流程诊断。本节点不写修复代码。
> 分支：`feat/remotion-effects-studio`，基线 HEAD `99e3f11c`（Agent/特效相关文件无未提交改动）。
> 结论先行：Agent **已经有一半**——Remotion 特效工作台的 9 个工具（`effects_tools`）已注册并有真实的按需披露；
> 缺的是 **(1) 片段级内置特效（运镜、淡入淡出/溶解转场）没有 Agent 入口**，以及 **(2) `effects_tools` 的"披露"只做了闸门，没做引导**
> （目录描述退化成 `Remotion FX.`，没有用法提示，系统提示词零提及），模型不知道什么时候、按什么顺序用它。

## 1. 问题描述

用户期望：视频剪辑 Agent 在剪辑时能调用软件内部的特效功能——
① **生成**特效（标题动画、镜头风格等），② **给素材/片段设置**特效（运镜、转场等），
并且工具必须**渐进式披露**，不能让 Agent 上下文过载。

现状（逐项核对代码）：

| 用户想要的 | 软件内部已有能力 | Agent 现在能做吗 |
|---|---|---|
| 生成动画/字幕条/镜头风格等特效成片 | Remotion 特效工作台：12 库 / 24 模板（`src/lib/effects/catalog.json`） | ✅ 能，9 个工具，按需加载 |
| 把特效成片替换/插入时间线 | `apply_effect`（replace / insert，带回执） | ✅ 能 |
| 给片段加**运镜**（推/拉/摇/3D 环绕…16 个预设，关键帧曲线） | `TimelineItem.cameraMotion`，预览+导出同数学，UI 有 `CameraMotionModal` | ❌ **没有任何 Agent 工具** |
| 给片段加**转场**（fade/dissolve 入/出） | `TimelineItem.transitionIn/Out`，预览 `TransitionLayer`、导出 `filtergraph_builder` 都实现 | ❌ **没有任何 Agent 工具**（UI 也没有写入口） |
| Agent 知道有这些能力并会主动用 | — | ⚠️ 披露只有闸门，没有引导（见 §3.3） |

## 2. 复现步骤

### 2.1 静态复现（无需启动应用，30 秒）

```bash
# a) Agent 工具集里没有任何写 cameraMotion / transition 的工具
grep -rn "cameraMotion\|transitionIn\|transitionOut" src/lib/video-editing-agent --include=*.ts \
  | grep -v __tests__
#   → 只有 getTimeline.ts（只读回显转场）、trackPatch.ts（撤销快照字段）、qualityLint.ts（注释）
#   → 没有一处 context.updateTimeline({... cameraMotion/transition ...})

# b) 代码自己承认缺口
sed -n 393,395p src/lib/video-editing-agent/tools/qualityLint.ts
#   "运镜只有 UI 通路（CameraMotionModal / store.setCameraMotion），没有 set_camera_motion 工具"

# c) TimelineOperation 联合类型里没有任何"更新片段属性"的变体
sed -n 195,246p src/lib/video-editing-agent/types.ts   # add/trim/delete/move/resize/add_subtitle_clips

# d) effects_tools 的模型可见描述与提示词
grep -n "effects_tools" -A3 src/lib/video-editing-agent/registry/categories.ts | sed -n 1,8p   # description: 'Remotion FX.'
grep -n -i "effect\|特效\|动画" src/lib/video-editing-agent/systemPrompt.ts src/lib/video-editing-agent/promptParts.ts
#   → systemPrompt.ts 只命中无关的 "effective plan"；promptParts.ts 无命中
```

### 2.2 行为复现（桌面端/`npm run dev`，开视频编辑 Agent）

1. 时间线放两段视频，对 Agent 说："给第一个镜头加一个缓慢推镜头，第二个镜头开头加淡入。"
2. 预期：Agent 调工具写入 `cameraMotion` / `transitionIn`。
   实际：L0 目录里没有对应类别；`explore_tools` 的合法 category 枚举（`ON_DEMAND_CATEGORY_IDS`）里没有；
   Agent 只能口头告诉用户"请在运镜面板手动设置"，或绕路 `image_to_video`（仅对静图有效）。
3. 对 Agent 说："给视频加一个标题动画特效并放到开头。"
   预期：Agent 走 effects 流程。实际：L0 只有一行 `- effects_tools: Remotion FX.`（11 字节），
   `explore_tools` 在激活模式下**不返回 usage_hints**，模型要自己猜 9 个工具的先后、`render_effect→get_effect_job` 轮询、
   `get_effect_target→apply_effect` 指纹链路，且要分两次 explore（≤4 个/次）。

### 2.3 基线测试（证明现有披露机制本身是好的）

```bash
npx vitest run src/lib/video-editing-agent/__tests__/effectsActivation.test.ts --environment node
#   2 passed（首轮无特效工具；explore 后仅下一轮可执行前 4 个；render 等需第二次 explore）
```

注：此环境下直接 `npx vitest run`（jsdom）会报 `No such built-in module: node:`，是环境问题，与本缺口无关；加 `--environment node` 即可。

## 3. 根因分析

### 3.1 根因 A：片段级特效没有"写"通路（主缺口）

- Agent 能下发的时间线操作集合是封闭联合 `TimelineOperation`：
  `add_clip | trim_clip | delete_clip | move_clip | resize_clip | add_subtitle_clips`
  （`src/lib/video-editing-agent/types.ts:195-246`）。**没有**"更新片段属性"变体。
- 服务端本地镜像 `applyOperationLocally`（`agent.ts:112-118`）与客户端 `OperationApplier.applyOperationToState`
  （`OperationApplier.ts:659-697`）的 `switch` 同样只处理这 6 种。
- 数据模型与渲染却都是现成的：
  - `TimelineItem.cameraMotion`、`transitionIn/Out`（`src/types/index.ts:838-885, 893-930`）。
  - 预览：`TransitionLayer.ts`（淡入/淡出 alpha）、`playback/camera/*`（运镜数学）。
  - 导出：`filtergraph_builder.py:17-21,277-280`（dissolve = 淡出+淡入，**无重叠、无 xfade**，所以和"同轨首尾相接"的剪辑模型兼容）；
    运镜数学与前端 1:1 镜像（CLAUDE.md 已声明）。
  - 持久化：`TimelineRepository.ts:426-431` 导入时对 `cameraMotion` 做 `sanitizeCameraMotion` 白名单+限幅，`transitionIn/Out` 直通。
  - 撤销：`trackPatch.ts:107-109` 的轨道快照键**已包含** `cameraMotion/transitionIn/transitionOut`，
    即撤销层已准备好，只是没有任何工具会改它们。
- UI 写入口：运镜只有 `setCameraMotionAction`（`store/actions/setCameraMotion.ts`，TimelinePanel 调用）；
  转场**连 UI 写入口都没有**（全仓只有读与导出，`transitionIn *[:=]` 仅出现在实体/仓储搬运处）。
  这意味着"转场"目前只在数据模型/渲染层存在，Agent 是第一个写入方。

### 3.2 根因 B：`apply_effect` 只覆盖"生成成片再替换"，不覆盖"给原素材挂特效"

`apply_effect`（`effectsApplyTool.ts:59-92`）的语义是：先 `render_effect` 得到 `output-video` 资产，
再 replace 目标片段（需 `expectedTargetFingerprint` 与来源 hash/trim/画布匹配）或 insert。
这对"标题动画/视频风格化（`video-cinematic`、`video-glitch`）"是对的，但：
- 它**渲染一遍视频**（耗时、占磁盘），对"推个镜头""淡入"这类零成本参数化特效是杀鸡用牛刀；
- 24 个模板里没有运镜/转场模板，库类别是 titles / typewriter / lower-thirds / image-reveal / slideshow / split-screen /
  product / callouts / counters / countdown / video-look / backgrounds。

所以"给素材设置对应的特效"在内置能力里**一半是渲染型（已有）、一半是参数型（缺）**。

### 3.3 根因 C：渐进式披露只实现了"闸门"，没有实现"引导"（与 spec 承诺相比有退化）

证据链：

1. **目录描述退化**：`categories.ts:99-103`
   `description: 'Remotion FX.'`。spec `docs/plans/remotion-effects-studio/spec.md` §9.1 承诺的是
   `Create local motion graphics from templates, text and images; render assets and apply to clips.`
   现版本测试 `effectsActivation.test.ts` 只断言 `≤160 字节`，所以退化没被测试拦住。
   L0 渲染格式是 `- ${id}: ${description}`（`systemPrompt.ts:76-78`），模型能看到的**只有**这一行。
   `name: '特效与动画'` 不进 L0。
2. **没有用法提示**：`promptParts.ts:236-339` 的 `CATEGORY_USAGE_HINTS` 里**没有** `effects_tools` 条目 → 落到
   `DEFAULT_USAGE_HINT = 'Call the tools in this category as needed for your task.'`（`promptParts.ts:336`）。
3. **激活模式下 `explore_tools` 根本不返回 usage_hints**：生产路径 `agent.ts:196` 构造了 `ToolActivationState`，
   `exploreTools.ts:67-88` 的激活分支返回 `{loaded, available, evicted, further_load, tools[{name, description≤180B}]}`，
   **没有** `usage_hints`。只有 `getCategoryUsageHints` 在 Layer B（`systemPrompt.ts:542`，后续轮回放）才出现，
   对 effects 又是默认句。
4. **系统提示词零提及**：spec §10.3 明确列了 "`systemPrompt.ts` 修改；一行制作流程提示"，现状 grep 为空（见 §2.1-d）。
   对比封面（`systemPrompt.ts:696`）、静图成片（`:698`）都有一行流程说明。
5. **分批加载且无提示**：`effects_tools` 共 9 个工具（catalog 2 + draft 2 + job 3 + apply 2，见 `tools/index.ts:480-483`），
   `ToolActivationState.load` 每次 ≤4 个、总活跃 ≤12。首次 `explore_tools({category})` 默认加载前 4 个
   （`ToolActivationState.ts:load` 的 `available.slice(0,4)`）；`render/get_job/cancel/get_target/apply` 要靠
   `tool_names` 再次加载。**机制是对的**（`effectsActivation.test.ts` 通过），但没有任何文字告诉模型"先做哪几步、
   何时再 explore 第二批"，只能靠 `further_load` 一句通用话。
6. 工具描述本身偏"协议化"（例如 `render_effect`: "Unknown: get_effect_job(requestId); only after 404 replay…"），
   这是对的（防重复付费/重放），但没有"面向任务"的入口句，模型难以把"用户要标题动画"映射到 `list_effect_templates`。

### 3.4 次要发现

- `getTimeline` 只回显 `transitionIn/Out`，**不回显 `cameraMotion`**（`getTimeline.ts:37-38`），
  Agent 即便能设置运镜，也无法读回已有运镜，容易重复叠加/覆盖。
- `qualityLint` 的 `static_image_too_long` 建议只有 `image_to_video`（`qualityLint.ts:393-406`），
  有了运镜工具后应改成可选 `set_camera_motion`（静图现在也允许运镜：`eligibility.ts` 头注释 camera-motion-stills）。
- 变更时间线的守卫清单是硬编码名单：`tools/index.ts:534` 与 `agent.ts:129-132`
  （`EFFECT_TIMELINE_RESYNC_REQUIRED`）。新增写时间线的工具必须加入，否则 `apply_effect` 未知结果后它仍可继续改时间线。
- `UNDOABLE_TOOL_NAMES`（`trackPatch.ts:36-45`）是撤销白名单，新增工具必须登记，否则"撤销 Agent 操作"漏掉它。
- 动画反馈映射 `ANIMATION_CLASS: Record<AgentTimelineOperation['type'], string>`（`clipAnimation.ts:9-17`）
  是**穷举 Record**，新增操作类型会直接 `tsc` 报错——这是好事，能防止漏改。

## 4. 影响面

| 面 | 影响 |
|---|---|
| 用户 | 让 Agent"加运镜/加淡入淡出/做个转场"无法执行；Agent 退回口头指引；"生成特效"类请求靠猜测走通，成功率不稳 |
| Agent 能力完整性 | "通用助手 + 剪辑专家"定位下，内置特效只开放了一类（渲染型） |
| 上下文预算 | 不是现状问题，而是**修复约束**：L0 目录有 2400B 总预算、每行 ≤160B、激活 ≤12 工具、schema ≤48KiB；新增能力必须在此内 |
| 代码 | 新增时间线操作类型会波及 6 处（types / guards / 服务端镜像 / 客户端 applier / 动画映射 / 撤销白名单） |
| 不受影响 | Remotion 渲染链路、`apply_effect` 回执与撤销、导出、后端（运镜/转场导出已具备） |

## 5. 候选修复方案

| 方案 | 内容 | 侵入性 | 风险 | 工作量 | 评价 |
|---|---|---|---|---|---|
| **A（推荐）**：补"引导层" + 新增按需类别 `clip_effects`（3 个小工具） | A1 恢复 effects 描述 + 加 usage hints + 一行系统提示 + 激活模式下 `explore_tools` 返回截断的 usage_hints；A2 新增 `clip_effects`：`list_clip_effect_presets` / `set_camera_motion` / `set_clip_transition`，对应一个新的 `update_clip_effects` 时间线操作 | 中（6 处联动，均有编译期/测试把关） | 低-中（数据模型、预览、导出、持久化、撤销键全部现成） | 中（约 1.5-2 天含测试） | 覆盖"生成 + 设置"两端，披露分层，满足上下文预算 |
| B：只做 A1（提示词/描述/hints） | 不加工具 | 极低 | 极低 | 小（半天） | 只解决"Remotion 特效不会用"，**不解决**"给素材设运镜/转场"，达不到需求 |
| C：一个通用 `update_clip_properties(props)` 工具 | 单工具改任意片段属性 | 中 | 高：参数面巨大、模型易乱改 volume/opacity/时间；schema 大，违背渐进式披露；难做精确校验与撤销语义 | 中 | 否决 |
| D：把 effects 与新工具全部设为常驻（alwaysAvailable） | 省去 explore | 低 | 高：常驻 schema 增大，违反既有 48KiB / 核心工具预算与"常驻最小化"，多数回合用不到 | 小 | 否决 |
| E：把运镜/转场做成 Remotion 模板，复用 render+apply | 零新操作类型 | 低 | 高：每次都要渲染一遍视频、落盘、替换原片段，丢失"零成本参数化"和与原素材的关联；运镜与现有预览/导出数学重复 | 大 | 否决 |

## 6. 推荐方案（A）及理由

### 6.1 A1：引导层（先做，独立可交付）

1. `categories.ts`：`effects_tools.description` 恢复为 spec 原句（≤160B），并紧邻视觉制作类别（保持已有排序）。
   给 `effectsActivation.test.ts` 增加**内容断言**（含 "motion graphics"/"render"/"apply" 关键词），防止再被缩成一句话。
2. `promptParts.ts`：给 `CATEGORY_IDS.EFFECTS_TOOLS` 增加 `CATEGORY_USAGE_HINTS` 条目（≤700B），写清**三段流程**与成本：
   `list_effect_templates → get_effect_template(只取 1 个) → create_effect_draft → render_effect(requestId=UUID) → get_effect_job(轮询到 succeeded) → [get_effect_target →] apply_effect`；
   第二批工具需 `explore_tools(effects_tools, tool_names:[render_effect,get_effect_job,get_effect_target,apply_effect])`；
   渲染要时间，不要说"已生成"直到 succeeded；unknown 不重试；"只想要结果入库"则不 apply。
3. `exploreTools.ts` 激活分支：在响应中加入 `usage_hints`（经 `utf8Slice` 限 ~800B，并纳入现有 8000B 截断循环），
   使"explore 当轮就拿到流程说明"，而不是依赖下一轮 Layer B。这对**所有**按需类别都是净改善。
4. `systemPrompt.ts`：加一行（与封面/静图同风格）："标题动画/镜头风格/字幕条 → effects_tools；运镜/淡入淡出 → clip_effects；先 explore_tools"。
   注意预算：`systemPrompt` 有 3500-token 天花板（`formatToolOverview` 注释），先跑现有 prompt 预算测试。

### 6.2 A2：`clip_effects` 按需类别（参数型特效，零渲染）

**披露设计（三层）**

- **L0（常驻）**：目录一行，≤160B：
  `- clip_effects: Set camera motion (push/pan/orbit…) and fade/dissolve transitions on existing clips. Instant, no render.`
- **L1（explore）**：只加载 3 个工具，schema 小（目标 <3 KiB 合计）；活跃总数不超过现有 12 的上限。
- **L2（按需读取）**：预设详情不进 schema，由 `list_clip_effect_presets` 返回紧凑表（16 个运镜预设：`id/mode/一句话`，
  约 1.2 KB；2 个转场类型 + 时长范围），模型想用哪个再传 `presetId`。**绝不**把 16 个预设写进 enum 常驻。

**工具签名（建议）**

| 工具 | 参数（`.strict()`） | 语义 |
|---|---|---|
| `list_clip_effect_presets` | `kind?: 'camera'\|'transition'` | 只读；紧凑预设表 + 范围；无副作用（⚠️ 评审 R-9：建议删除此工具，改为 `set_camera_motion` schema 内由 `CAMERA_PRESETS` 派生的 16 项 enum） |
| `set_camera_motion` | `clipIds: string[1..12]`（⚠️ 评审 R-3：多 clip 必须走 `result.operations` 批次契约，单个 `updateTimeline` 是 last-wins）；`presetId` (`'none'` 清除)；`intensity?` 0-2；`easing?`；`startOffset?/duration?` | 用 `applyPreset(presetId, mode)` 构造，再 `sanitizeCameraMotion` 校验；不接受模型手写关键帧 |
| `set_clip_transition` | `clipId`；`in?: {type:'fade'\|'dissolve', duration}\|null`；`out?: 同上` | `duration` 夹到 ≤ clip 一半（对齐 `_effective_transition_duration`）；`null` 清除 |

**落点（逐文件，均已核对存在）**

1. `types.ts`：`TimelineOperation` 增 `{ type:'update_clip_effects'; clipId; cameraMotion?: CameraMotion|null; transitionIn?: ClipTransition|null; transitionOut?: ClipTransition|null }`；`@/types` 的 `AgentTimelineOperation` 同步。
2. `operationGuards.ts`：校验 clip 存在、轨道未锁定、可视片段（复用 `canApplyCameraMotion` 谓词的语义，**不**再写第二份规则）、转场时长有限且 >0。
3. 服务端 `agent.ts#applyOperationLocally` 与客户端 `OperationApplier.applyOperationToState`：各加一个 `case`（共用一个纯函数，避免两份实现漂移——字幕已有先例 `applySubtitleClipsToState`）。
4. `clipAnimation.ts`：`ANIMATION_CLASS` 补条目（穷举 Record，漏了会 `tsc` 失败）；`targetClipId` 默认分支已兼容 `clipId`。
5. （⚠️ 评审 R-1/R-2/R-4 补充落点：`reconcile.ts#affectedTrackIds`、`operationGuards.ts#touchedTrackIds`、`AgentEventRouter.ts#isTimelineOperation` 三处必须同步，见 §评审结论）
5. `trackPatch.ts#UNDOABLE_TOOL_NAMES` 加 `set_camera_motion`、`set_clip_transition`（快照键已含这三个字段，**无需**改 diff 逻辑）。
6. `tools/index.ts:534` 的 `timelineWriters` 名单加入两个工具（⚠️ 评审 R-5：`agent.ts:129-132` 是 `recordOperation` 的名单；经 `updateTimeline` 的新操作已被 `agent.ts:116` 的 `assertCanMutateEffectsTimeline` 覆盖，不需要改），保持 `EFFECT_TIMELINE_RESYNC_REQUIRED` 的保护语义。
7. `categories.ts`：新增 `CLIP_EFFECTS` 类别 + 加入 `ON_DEMAND_CATEGORY_IDS`；`createDefaultCategories` 文档里的"22/19"计数同步（改为 23/20，测试里有该计数断言的同步改）。
8. `getTimeline.ts`：回显 `cameraMotion`（仅 `presetId/mode/intensity` 摘要，不回显关键帧），并更新工具描述。
9. `qualityLint.ts`：`static_image_too_long` 的修复建议补充 `set_camera_motion`，并删除/更新 `:393` 那条"没有工具"的过期注释。
10. 客户端落库路径无需新增：`OperationApplier` → `setTimelineState` → store 导入，
    `TimelineRepository` 已对 `cameraMotion` 做 `sanitizeCameraMotion`、`transitionIn/Out` 直通。

**为什么推荐**

- **满足渐进式披露**：常驻增量只有 ~150B 目录行；schema 只在 explore 后进入且体量小；预设表按需读取，不进常驻。
- **最小爆炸半径**：不是"万能改属性"，而是 2 个字段族、白名单预设、范围夹取；撤销快照键与导出/预览已现成。
- **与既有架构一致**：沿用 `TimelineOperation` → 本地镜像回执（F-AIEDIT-RV02 的 `TimelineApplyReceipt` 约定）→ 客户端 applier → 单工具撤销；
  不引入第二条时间线写路径。
- **互补而非重叠**：参数型（`clip_effects`，即时、零成本）与渲染型（`effects_tools`，24 模板，耗时）各管一类，
  系统提示用一行话划界，避免模型把"淡入"拿去 render。

### 6.3 验证要求（给 Subtask #2）

遵循仓库 Clean Code 规则（缺陷先有失败测试；高风险路径不 mock）：

- 单测：`set_camera_motion`/`set_clip_transition` 的正常路径 + 失败路径（锁定轨道、不存在的 clip、非可视片段、未知 presetId、转场时长越界、`null` 清除）；
  `update_clip_effects` 守卫；服务端镜像与客户端 applier **同输入同输出**。
- 披露测试：沿用 `effectsActivation.test.ts` 风格——首轮无 `clip_effects` 工具、explore 后下一轮才可执行、L0 行 ≤160B 且总目录 ≤2400B、
  常驻 schema 字节数相对基线**不增加**。
- 撤销测试：Agent 设置运镜后"撤销该工具"能还原；用户之后手改了同轨道则拒绝（既有语义）。
- 回归：`effectsApplyUncertain` 为 true 时两个新工具被 `EFFECT_TIMELINE_RESYNC_REQUIRED` 拦截。
- 手验：开发模式下对 Agent 说"第一段加缓慢推镜头，第二段开头淡入"，确认预览生效、导出一致（C-4 级长导出不强求）。

### 6.4 风险与待 Subtask #1 复核点

1. **转场语义**：已核实导出 dissolve = 淡出+淡入（无重叠），因此在"同轨首尾相接"的模型里两种类型都安全；
   但 UI 没有转场的写入口/徽标，用户看不到 Agent 设了什么——建议至少让 `getTimeline` 回显（已有）并在工具结果里给出人话摘要。
2. **运镜与撤销/分割**：`resizeItem.ts:95` 与 `SplitService` 对运镜窗口有重基准逻辑；Agent 之后再 `resize_clip`/分割时沿用同一路径，需用一个集成测试确认。
3. **`apply_effect` 指纹**：片段设了运镜/转场后，若再用 `video-cinematic` 之类的 replace，`fingerprintEffectTarget` 是否把这两个字段算进目标指纹需确认
   （算进去则会触发 `EFFECT_TARGET_CHANGED`，属预期保护；不算进去则 replace 会丢运镜，需在工具结果里提示）。
4. **提示词预算**：`systemPrompt` 加一行与 usage hints 都吃预算，必须先跑现有 prompt/目录预算测试，必要时压缩而不是放宽阈值。
5. **文件规模**：`tools/index.ts` 已 575 行、`OperationApplier.ts` 823 行（超过 800 行上限的棘轮文件）；
   新代码放新文件（`tools/clipEffectsTools.ts`、`clipEffectsOperation.ts`），不要继续往这两个文件里堆。

## 7. 一句话总结

Agent 已能"渲染一个特效并放上时间线"，但**不能给片段设置内置的运镜/转场**（缺 1 个时间线操作 + 3 个小工具），
并且**"怎么用特效"没有被告诉模型**（目录描述被缩成 `Remotion FX.`、无 usage hints、系统提示零提及）。
推荐 A：先补引导层（半天），再加按需类别 `clip_effects`（参数型、零渲染、3 个工具、预设按需读取），保持常驻上下文几乎不增长。

---

## 评审结论

> 评审视角：逐条回到代码核对 §3 的证据链与 §5/§6 的方案；本节只改本文件，未改任何源码。
> 基线：`feat/remotion-effects-studio`，HEAD `99e3f11c`。

### 一、根因证据复核

| 结论 | 核对结果 | 依据（本次亲自读过） |
|---|---|---|
| 根因 A：`TimelineOperation` 无"更新片段属性"变体 | ✅ 成立 | `types.ts:195-246` 仅 6 变体；`agent.ts` 的 `applyOperationLocally`（约 `:720-777`）与 `OperationApplier.ts:661-697` 的 `switch` 均只处理这 6 种 |
| 运镜/转场的数据、预览、导出、持久化、撤销键均现成 | ✅ 成立 | `trackPatch.ts:107-109` 快照含 `cameraMotion/transitionIn/transitionOut`；`useTimelineComposition.ts:56-70` 的播放签名含转场与 `cameraMotion`（预览会随之刷新）；`TimelineRepository.ts:431` 对 `cameraMotion` 走 `sanitizeCameraMotion` |
| 转场没有 UI 写入口 | ✅ 成立 | agent 目录外 `transitionIn/Out` 仅出现在读取/导出/实体搬运（`videoExportItems.ts:199`、`assembleLayers.ts:124`、`TimelineItem.ts`） |
| 根因 C：披露只有闸门没有引导 | ✅ 成立 | `categories.ts:99-103` 描述为 `Remotion FX.`；`promptParts.ts:328-339` 无 effects 条目，回落 `DEFAULT_USAGE_HINT`；`exploreTools.ts:67-71` 激活分支返回体无 `usage_hints`；`systemPrompt.ts:690-700` 规则段无 effects 一行 |
| 生产路径确实走激活分支 | ✅ 成立 | `agent.ts:196` 构造 `ToolActivationState`，`exploreTools.ts:66` 的 `if (activation)` 分支即生产路径 |
| `getTimeline` 不回显 `cameraMotion` | ✅ 成立 | `getTimeline.ts:37-39` 只回显 transition、opacity |
| `qualityLint` 注释自认缺口 | ✅ 成立；但注释里的 "§4.10 的 P1-8" 指向另一份 spec 的评审编号，与本任务无关，修复时只更新该注释，不要被它误导 | `qualityLint.ts:391-393` |

**反例/替代解释检查**
1. "Agent 能否靠 `apply_effect` 实现运镜/转场"——不能。`effectsTimeline.ts:39-60` 的 replace 只接受 `type==='video'` 且非图片、非 role 片段，并要求渲染产物与源哈希/trim/画布一致；24 个模板里没有运镜/转场模板，且每次都要渲染。§3.2 成立。
2. "`Remotion FX.` 是否为 L0 预算而故意缩短"——**预算压力是真实的**（见 R-6），所以 A1 恢复描述不能照搬 spec 原句，必须配预算断言。
3. 现有 `effectsActivation.test.ts:22` 只断言 `≤160B`，所以"退化没被测试拦住"成立。

**结论**：根因证据链成立、能解释症状。但 §6 的**落点清单有 3 处遗漏、2 处误导、1 处设计缺陷**；其中遗漏项会造成"工具回 `success:true`，时间线却没变 / 被重排"的静默失败，必须在实现前补进方案（下节）。

### 二、方案审计：发现的缺陷（均已读代码确认）

**R-1（P0，遗漏）`reconcile.ts#affectedTrackIds` 对新操作返回 `null` → 所有视频/音频轨被整体重新紧凑排列。**
服务端 `applyOperationLocally` 与客户端 `OperationApplier.applyToTimeline` / `findBatchRejection` 在**每个**操作后都调用 `reconcileOverlapsAfterAgentOp(state, operation)`。`reconcile.ts:140-165` 的 `affectedTrackIds` 对未知类型落到 `return null`，而 `packsWithoutOverlap(operation)`（`:181`）在有 operation 时恒为 `true`，`reconcileOverlapsAfterAgentOp`（`:215-216`）于是对**全部可整理轨道**执行 `packFlushTrack`。后果：Agent 只想加个淡入，用户或 Agent 刻意留的空隙、叠加片段位置会被悄悄挪动；服务端镜像与客户端同样挪动，所以两边"看起来一致"，很容易漏测。
→ 修复：对 `update_clip_effects` 在 `affectedTrackIds` 返回空集合 `new Set()`（或在函数顶部短路，仅重算 `totalDuration`）。必须有测试断言"设运镜/转场前后所有片段 `startTime/duration` 逐位不变（含刻意留空的轨）"。

**R-2（P0，遗漏）`AgentEventRouter.isTimelineOperation`（`:645-652`）是运行期字符串数组。**
源码注释已写明"漏加一个类型不会报 TS 错，只会让操作被静默忽略（字幕就踩过，RK-13）"。新类型不加进去，操作不进 `OperationApplier`，工具却已回成功。批次路径同样以 `isTimelineOperation(batchOps[0])` 判定（`:299`）。原 §6.2 落点清单完全没提，§3.4"漏改会被编译期拦住"对这一处**不成立**（只有 `clipAnimation.ts` 的 `Record` 有编译期保护）。
→ 修复：加入 `'update_clip_effects'`；测试必须走 `AgentEventRouter` 真实路径，不能只测 applier。

**R-3（P0，设计缺陷）`clipIds: string[1..12]` 与单 `clipId` 的操作类型不匹配。**
`agent.ts:123-124` 的 `operations` 是 `Map<toolCallId, op>`，**同一 toolCallId 后写覆盖前写**（`composeStoryboard.ts:161-163`、`autoFixOverlaps.ts:29-35` 的注释都写了 last-wins，因此 `compose_storyboard` 改用 `result.operations` 批次契约，客户端经 `AgentEventRouter:299-312 → applyBatch` 落地，撤销按 `toolCallId-batch-i` 前缀归并，见 `OperationApplier.recordsFor`）。按原设计，多 clip 调用只有最后一个生效，其余静默丢失。
→ 修复（推荐 a）：
  a. 工具对每个 clip 先在本地 `updateTimeline` 校验并镜像，再把**完整数组**放进 `result.operations`，走既有批次契约（`isTimelineOperation(batchOps[0])` 命中即可）；整批原子，任一 clip 校验失败则整批不落地（`findBatchRejection` 已具备该语义）。
  b. 把多个目标收进单个操作（`targets: [...]`）。改动更大，不推荐。

**R-4（P1，遗漏）`operationGuards.ts#touchedTrackIds`（`:208-232`）对新类型落 `default: return []`。**
`findLockedTrackId` 因此永远返回 `null`——**锁定轨上的片段会被写入**，违背"锁定表示布局归用户"的既有语义。原 §6.2 落点 2 写了"轨道未锁定"，却没指出必须改这个函数。
→ 加 `case 'update_clip_effects'`（返回该 clip 所在轨）；`validateOperationTargets`（`:177-197`）同步加 clip-not-found 校验，复用 `OperationRejectReason`（`src/types/index.ts:241`），不新增原因码。

**R-5（P1，误导）`agent.ts:129-132` 不需要改。**
该名单属于 `recordOperation`；新工具经 `context.updateTimeline` 写入，`agent.ts:116` 已对**所有**操作调用 `assertCanMutateEffectsTimeline`。真正要加的是 `tools/index.ts:534` 的 `timelineWriters`（按工具名包装，返回 `EFFECT_TIMELINE_RESYNC_REQUIRED`）。若按 R-3a 由工具直接构造 `result.operations`，则这一批次**不经** `agent.ts:116`，所以 `timelineWriters` 包装是必需而非可选。

**R-6（P1，被低估）L0 目录预算几乎用尽，新增一行会把排在末尾的类别静默挤出目录。**
`systemPrompt.ts:90-93`：每行截 160B，**整体再 `utf8Slice(…, 2400)`**，超出部分被静默截掉（可能切在半行）。按 `createDefaultCategories` 顺序实测（本次脚本统计，未含 `availabilitySuffix`）：19 个按需类别合计约 **2128B**，余量约 270B；`STORYBOARD_TOOLS` 一行已 182B（超 160 被截）。原 §6.1 把 effects 描述恢复为 spec 原句（约 +70B）、再加 `clip_effects` 一行（约 +125B），合计约 2320B，带 availability 后缀时会让 `material_tools` 等末尾类别掉出目录——模型从此不知道它存在，且不报错。
→ 修复：恢复后的 effects 描述 ≤100B；`clip_effects` 行 ≤90B（例：`Set camera motion and fade/dissolve on existing clips; instant, no render.`）；增加断言"每个 `ON_DEMAND_CATEGORY_IDS` 都出现在渲染后的目录中"（现有测试只测每行 ≤160B，是盲区）；`clip_effects` 紧邻 `effects_tools` 放置；**不要放宽 2400**。

**R-7（P1，验证原 §6.4-3）指纹与运镜/转场的交互——已查清。**
`provenance.ts:69-78` 的 `fingerprintEffectTarget` 对**整个 item**（去掉 `isSelected` 与内联缩略图）取哈希，故 `cameraMotion/transitionIn/Out` 都在指纹内；replace 路径 `effectsTimeline.ts:55` 以 `{...item, …}` 展开，运镜/转场**会被保留**。含义：`get_effect_target` 之后、`apply_effect` 之前设运镜，会触发 `EFFECT_TARGET_CHANGED`（预期保护）。
→ 使用顺序写进 usage hint 与 `clip_effects` 工具描述："先 apply_effect，再设运镜/转场"。无需改指纹逻辑。

**R-8（P2）可视性判定不能直接复用 `canApplyCameraMotion` 的签名。**
`eligibility.ts` 入参是 timeline 域类型 `TimelineItemData/TrackData`，agent 侧用的是 `@/types` 的 `TimelineItem/Track`。且 `agent.ts` 属服务端 Next 路由模块，引用 `components/video/playback/camera/*` 须确认无 DOM/React 依赖（`eligibility.ts`、`cameraPresets.ts`、`wire.ts` 的 import 仅为同目录纯函数与类型，已核实；同目录其他文件需逐个确认）。
→ 新增 agent 侧薄适配 `isCameraEligible(track, item)`，规则与 `cameraMotionIneligibleReason` **同值**（`track.type==='video' && item.type==='video' && !track.isLocked`），并加一致性测试，避免第二份规则漂移。
另：`applyPreset` 对未知 id **静默返回中性运镜**（`cameraPresets.ts:92-95`），工具必须先用 `findPreset` 校验并报错，否则 Agent 传错 id 会得到"成功但无效果"。

**R-9（P2，范围过大）`list_clip_effect_presets` 不必要。**
16 个预设 id 都是自解释短词（`push-in / pull-out / pan-left / orbit-left / dolly-in-3d …`，`cameraPresets.ts:32-58`），作为 `set_camera_motion` 的参数 enum 仅约 200B；该 schema 本来只在 `explore_tools` 之后才进入上下文，"绝不进 enum"的担忧不成立。删掉它：少一个工具、少一次往返、少一份需与 `CAMERA_PRESETS` 同步的表。enum 必须**由 `CAMERA_PRESETS` 派生**，不得手抄；转场类型 `fade|dissolve` 内联。

**R-10（P2）补充小项**
- `UNDOABLE_TOOL_NAMES`（`trackPatch.ts:34-45`）需要登记两个新工具。注意 `add_subtitles` 并不在名单中，说明"所有写时间线工具都可撤销"不是既有约定，这里登记是有意为之，要有测试固定。
- `categories.ts` 注释里的 "22" 与 `toolActivation.test.ts:136` 的 `toHaveLength(22)` 同步为 23。
- `clipAnimation.ts:8` 的 `ANIMATION_CLASS` 是穷举 `Record`，新类型会在 `tsc` 报错（唯一有编译期保护的一处）；值给 `''`（与字幕一致），不要新增 CSS。
- `getTimeline` 回显 `cameraMotion` 只输出 `presetId/mode/intensity`，不输出关键帧。

### 三、边界情况（对推荐方案提出的必测清单）

| 场景 | 要求 |
|---|---|
| 并发 | 同一回合并行调两次（不同 toolCallId）：各自独立落地；同一 toolCallId 多 clip 走批次（R-3） |
| 错误路径 | 未知 presetId / clip 不存在 / 锁定轨 / 非可视片段（音频、字幕）/ 转场时长 ≤0 或 NaN / 批内任一失败 → 整批不落地并返回结构化错误，**不**回 `success:true` |
| 边缘输入 | `presetId:'none'` 清除；转场传 `null` 清除；转场时长夹到 ≤ clip 时长一半（对齐 `filtergraph_builder._effective_transition_duration`）；图片片段（`type==='video'` 且 `originalMaterialType==='image'`）允许运镜 |
| 与既有保护交互 | `effectsApplyUncertain` 为 true 时被 `EFFECT_TIMELINE_RESYNC_REQUIRED` 拦截；撤销后布局逐位还原；用户在其后改了同轨则拒绝撤销（既有语义） |
| 不得回归 | 设运镜/转场前后所有 clip 的 `startTime/duration` 不变（R-1）；`resize_clip`/分割后运镜窗口重基准沿用 `resizeItem.ts:86-95`，补一条集成测试 |

### 四、各候选方案的最终评价

| 方案 | 评审意见 |
|---|---|
| A（原样） | 方向对，但落点清单有 R-1~R-5 的漏洞，按原文实施会产生"成功回执 + 无效/误重排"。**不可原样执行** |
| **A′（本评审推荐）** | A 的修订版，见下 |
| B 仅引导层 | 解决不了"给素材设运镜/转场"，达不到需求；但它是 A′ 的第一阶段，应独立先交付 |
| C 通用 `update_clip_properties` | 维持否决 |
| D 全部常驻 | 维持否决（R-6 表明目录预算已无余量） |
| E 做成 Remotion 模板 | 维持否决 |

### 五、最终推荐方案：A′（分两阶段交付的修订版 A）

**阶段 1（独立可交付，约半天）——引导层**
1. `categories.ts`：`effects_tools.description` 恢复为 **≤100B** 的任务导向一句话（含 motion graphics / render / apply 语义）；测试加内容断言，以及"所有按需类别都出现在渲染后的 L0"（R-6）。
2. `promptParts.ts`：新增 `CATEGORY_USAGE_HINTS[effects_tools]`（≤700B）：`list_effect_templates → get_effect_template(只取 1 个) → create_effect_draft → render_effect(requestId=UUID) → get_effect_job 轮询到 succeeded → [get_effect_target →] apply_effect`；第二批需 `explore_tools(effects_tools, tool_names:[render_effect,get_effect_job,get_effect_target,apply_effect])`；succeeded 前不得说"已生成"；unknown 不重试；运镜/转场在 apply 之后再设（R-7）。
3. `exploreTools.ts` 激活分支返回 `usage_hints`（`utf8Slice` ≤800B，并入现有 8000B 截断循环）——对所有按需类别都是净改善；保持 `loaded` / `truncated_tools` 一致（D-20）。
4. `systemPrompt.ts` 规则段加**一行**（≤120 字符，风格同封面/静图）：标题动画/镜头风格/字幕条 → effects_tools；运镜/淡入淡出 → clip_effects；先 explore_tools。先跑 `systemPrompt*.test.ts` 的 token 预算，必要时压缩别处，不放宽阈值。

**阶段 2（约 1.5 天）——`clip_effects` 按需类别（2 个工具，零渲染）**
- 工具：`set_camera_motion`（`clipIds` 1–12、`presetId` enum 由 `CAMERA_PRESETS` 派生并含 `'none'`、可选 `intensity` 0–2、`easing`）与 `set_clip_transition`（`clipId`、`in?/out?: {type:'fade'|'dissolve', duration}|null`）。**不要** `list_clip_effect_presets`（R-9），**不接受**模型手写关键帧。
- 操作：新增 `update_clip_effects`（单 clip）；多 clip 经 `result.operations` 批次（R-3a）。
- 必改落点（在原 §6.2 十项之上；带 R-x 的是评审补充）：`types.ts`（两处联合）、`operationGuards.ts`（含 `touchedTrackIds`，R-4）、`agent.ts#applyOperationLocally` 与 `OperationApplier.applyOperationToState`（共用一个纯函数，放新文件 `clipEffectsOperation.ts`）、`reconcile.ts#affectedTrackIds`（R-1）、`AgentEventRouter.isTimelineOperation`（R-2）、`clipAnimation.ts`、`trackPatch.ts#UNDOABLE_TOOL_NAMES`、`tools/index.ts` 的 `timelineWriters`（R-5，取代原 `agent.ts:129` 一项）、`categories.ts` + `ON_DEMAND_CATEGORY_IDS` + 计数测试、`getTimeline.ts`、`qualityLint.ts`。
- 文件规模：`tools/index.ts`（约 575 行）与 `OperationApplier.ts`（约 823 行，已超 800 棘轮）只做最小增量（注册一行 / 一个 `case`），新逻辑放新文件，行数不得上升。
- 披露：L0 仅增一行 ≤90B；工具 schema 合计目标 <2.5 KiB；常驻 schema 字节数不增加（沿用 `effectsActivation.test.ts` 风格加断言）。

### 六、判定理由（为什么是 A′）

1. **覆盖完整需求**："生成特效"由已有 `effects_tools` + 阶段 1 的引导补全；"给素材设置特效"由阶段 2 的两个参数型工具补全；一个渲染型、一个参数型，互补不重叠。
2. **渐进式披露预算可证**：常驻增量只有 L0 一行（≤90B）+ 系统提示一行；工具 schema 只在 explore 后出现；"所有类别可见"断言防止 L0 被静默截断（R-6）。
3. **最小爆炸半径**：只新增 1 个操作类型 + 2 个工具，不动导出/预览/持久化/撤销快照逻辑（均已现成，已逐项核实）；相对原 A 去掉 1 个工具、1 张预设表、1 处错误落点。
4. **把静默失败变成测试期失败**：R-1/R-2/R-4 是三处 `tsc` 发现不了的运行期联动，升格为必测项；这是方案能否安全落地的关键。
5. **风险可控**：转场导出语义（淡出+淡入、无重叠）与"同轨首尾相接"模型一致（原 §6.4-1 已核实）；指纹/replace 交互已在 R-7 查清，只需文案约束。

**给下一节点（实现）的一句话**：按阶段 1 → 阶段 2 实施；先为 R-1/R-2/R-3/R-4 写失败测试再改代码；多 clip 一律走 `result.operations` 批次；L0 新增行 ≤90B 并加"所有类别可见"断言；不要照抄原 §6.2 中的 `agent.ts:129` 与 `list_clip_effect_presets`。

---

## 实施过程发现的方案缺陷

> 实施节点（Subtask #2）按 A′（阶段 1 引导层 + 阶段 2 `clip_effects`）落地。以下是实现时发现、与 §五 / §六 文字不一致而采取修正做法的地方。

**I-1（P1，方案不可行）系统提示词没有余量，§五阶段 1 第 4 条「规则段加一行」做不到。**
`systemPrompt.yolo.test.ts` 钉着互动模式提示词 ≤ 18 500 字符（AC-A5，不得放宽）。实测基线只有约 18 480，余量不足 20 字符；
按方案加一行（80 字符）+ 恢复 effects 描述 + 新增 `clip_effects` 目录行共 +240 字符，直接把该测试打红。
→ 修正：不加规则行；任务导向的划界改由两行 L0 目录描述承担（`effects_tools`：“Rendered … templates; render, then apply.” /
`clip_effects`：“Camera motion and fade/dissolve on placed clips; instant, no render.”，渲染型 vs 参数型一眼可分），
并把**封面规则行**里与 `CATEGORY_USAGE_HINTS[cover_tools]` 重复的措辞压缩、把“罕见高级工具”一行压缩（语义保留：
默认 applyWhenReady、queued/applied 口径、先 explore_tools）。结果：`yolo` 预算测试通过，且 `subtitleDisclosure` /
`systemPrompt.toolkit` 的既有（基线已红）数字**没有变大**（1625→1623、18595→18593、19692→19690）。

**I-2（P2）单工具 `set_clip_transition` 的参数名沿用 `get_timeline` 的回显名。**
§6.2 表里写的是 `in? / out?`；实现用 `transitionIn / transitionOut`，与 `get_timeline` 返回字段、`TimelineItem` 字段同名，
模型读回即可原样使用，也避开把 `in` 当作属性名的 JSON/TS 歧义。语义与范围（`null` 清除、时长夹到 ≤ 片段一半）不变。

**I-3（P2）非视觉目标复用 `target-track-missing`，而不是新增拒绝原因码。**
评审 R-4 要求“不新增原因码”（`ToolStep.REJECT_REASON_KEYS` 文案表不改）。`update_clip_effects` 的守卫对
“clip 在非视频轨 / 非视频类片段”回 `target-track-missing`（并带 trackId），载荷非法回 `invalid-time`，clip 不存在回 `clip-not-found`；
锁定轨仍由 `findLockedTrackId` 给出 `locked-track`。工具层在**落地前**用同一批守卫预检整批，给模型可读的原因（`clip_effects_refused`）。

**I-4（P2）eligibility 判定放在新文件而不是 `operationGuards.ts`。**
`isClipEffectsEligible` 与 `applyClipEffectsToState` 一起放进 `clipEffectsOperation.ts`（两端共用纯函数，与 `subtitleClips.ts` 同构），
`operationGuards.ts` 只 import 它，避免该文件继续膨胀；与 `canApplyCameraMotion` 的同值性由测试逐个片段断言。

**I-5（信息）`OperationApplier.ts` 净增 4 行（1 条 import + 1 个 `case`）。**
该文件本就 > 800 行；方案要求“行数不得上升”无法做到零增长——`switch` 必须有这个 `case`。新逻辑全部在新文件，该文件只做最小接线。

### 实施结果与验证

- 阶段 1：`categories.ts`（effects 描述 ≤100B）、`promptParts.ts`（effects_tools / clip_effects 两条 usage hints，≤800B）、
  `exploreTools.ts`（激活分支当轮返回 `usage_hints`，`utf8Slice` ≤800B 并计入 8000B 截断）。
- 阶段 2：新增 `update_clip_effects` 操作（`@/types` 与 `types.ts`）；`clipEffectsOperation.ts`（共用纯函数）；
  `operationGuards.ts`（校验 + `touchedTrackIds`，R-4）；`reconcile.ts#affectedTrackIds` 返回空集合（R-1）；
  `AgentEventRouter.isTimelineOperation`（R-2）；`agent.ts` 与 `OperationApplier.ts` 各一个 `case`；`clipAnimation.ts`；
  `trackPatch.ts#UNDOABLE_TOOL_NAMES`；`tools/clipEffectsTools.ts`（`set_camera_motion`：clipIds ≤12、presetId enum 由 `CAMERA_PRESETS` 派生；
  `set_clip_transition`；多 clip 走 `result.operations` 批次，R-3a；整批预检、整批落地）；`tools/index.ts` 注册 + `timelineWriters`（R-5）；
  `getTimeline` 回显 `cameraMotion` 摘要；`qualityLint` 去掉过期注释并给出 `set_camera_motion` 建议。
- 未做（按评审）：`list_clip_effect_presets`（R-9）、`agent.ts:129` 的 `recordOperation` 名单（R-5）。
- 测试：`clipEffects.test.ts`（29：两端一致 + 位置逐位不变、守卫 7 类、批次原子、未知 preset、none/null 清除、夹取、真实 `AgentEventRouter` 批次路径与整体撤销、
  `EFFECT_TIMELINE_RESYNC_REQUIRED` 拦截）、`clipEffects.disclosure.test.ts`（L0 行预算 + “所有按需类别都在目录里” + explore 返回 usage_hints + schema < 2.5 KiB）、
  `clipEffects.agentLoop.test.ts`（复现 §2.2 场景：真实 agent 循环，首轮无 schema → explore → 运镜与淡入真实写入且位置不变）。
  变异检查：把 `reconcile` 改回 `null` / 去掉 router 名单，对应测试立即变红。
- 复现步骤复验：§2.1 的 grep 现在能找到 `update_clip_effects` 写通路；§2.2 行为场景由 `clipEffects.agentLoop.test.ts` 通过；
  `effectsActivation.test.ts`、`toolActivation.test.ts`（计数 22→23 / 19→20）通过；`npx tsc --noEmit` 除工作区内他人未提交的 skillrouter 测试类型错误外无新增错误。
- 基线对照：`src/lib/video-editing-agent` 全量 21 个失败在改动前后相同（cover*/scriptSegmentAssociation/autonomyStore/subtitleDisclosure/systemPrompt.toolkit，
  与本任务无关）；`toolkitTools` / `toolActivation` 的偶发红是整套并行时的时序抖动，单跑通过。
- 未做：桌面端手验（预览/导出实际画面）——本节点只有 Node 测试环境。
