# Agent 特效能力第 2 轮：已落地能力的残余缺口分析

> 类型：能力缺口（feature gap），按 Bug 流程诊断。本节点不写修复代码、不提交。
> 分支：`feat/remotion-effects-studio`，基线 HEAD `0370cb34`（第 1 轮已提交）。
> 前置：第 1 轮报告 `docs/diagnoses/agent-effects-capability-gap/analysis.md`（根因 A/B/C、评审 R-1…R-10、实施 I-1…I-5）。
> 本轮不重复第 1 轮已修内容，只回答：**第 1 轮合入后，"Agent 生成特效 + 给素材设置特效"在产品层面还剩哪些缺口？**

## 1. 问题描述

用户目标（原话要点）：Agent 剪辑时要能用软件内部的特效功能——① 生成特效，② 给素材设置特效；工具要渐进式披露，Agent 上下文不能过载。目标是"顶级产品"。

第 1 轮已落地（已复验，见 §2）：
- 渲染型：`effects_tools` 9 个工具 + 恢复的 L0 描述 + usage hints + `explore_tools` 当轮返回 `usage_hints`。
- 参数型：按需类别 `clip_effects` = `set_camera_motion`（≤12 clip，批次原子）+ `set_clip_transition`（单 clip）→ 一个 `update_clip_effects` 操作，贯通守卫 / reconcile / router / 撤销 / `get_timeline` 回显。

第 2 轮核查"端到端是否像产品"，发现的残余缺口：

| # | 缺口 | 级别 |
|---|---|---|
| G-1 | Agent 设置的**转场在界面上完全不可见、用户无法清除**（运镜有徽标 + 面板，转场两者皆无）；工具栏转场入口还是"功能开发中"占位 | P1 |
| G-2 | `set_clip_transition` **只能一次改一个 clip**，"所有镜头加淡入淡出"需要 N 次往返，且受 80 次/会话工具调用上限约束；与 `set_camera_motion` 的批量能力不对称 | P1 |
| G-3 | `fade` 与 `dissolve` **在预览与导出里数学上完全相同**（各自只做本 clip 的 alpha 淡入淡出，无邻片重叠），但类型注释、工具枚举与 usage hint 都暗示 dissolve = 交叉溶解；Agent 会向用户承诺"交叉溶解" | P2 |
| G-4 | 桌面端真实画面验证（预览 / 导出）两轮都没做；Agent 设置后用户无任何"已生效"的视觉回执 | P2（流程） |

> 没有再发现"工具缺失 / 披露过载"类问题：L0 预算、schema 体量、按需加载均已由第 1 轮测试钉住。

## 2. 复现步骤

### 2.0 第 1 轮成果复验（证明基线健康，避免重复劳动）

```bash
npx vitest run src/lib/video-editing-agent/__tests__/clipEffects \
  src/lib/video-editing-agent/__tests__/effectsActivation.test.ts --environment node
# 本节点实测：4 个文件 / 38 个用例全部通过
git show --stat HEAD | head   # 0370cb34，23 个文件，仅 Agent/类型/测试/文档
```

### 2.1 G-1：转场不可见、不可清除（静态，30 秒）

```bash
# a) components 下没有任何一个 .tsx 渲染 transitionIn/Out（只有 1 个测试文件命中）
grep -rn "transitionIn\|transitionOut" src/components --include=*.tsx
#   → 仅 src/components/video/hooks/__tests__/useCompositionPlayback.test.tsx

# b) 运镜有徽标，转场没有
sed -n 864,895p src/components/video/timeline/TimelineItem.tsx     # {item.cameraMotion && <button …徽标…>}
grep -n "cameraMotion" src/components/video/timeline/TimelinePanel.tsx | head   # 面板 + 撤销单步 setCameraMotionAction

# c) 没有转场的 store 写入口（运镜有 updateItemCameraMotion + setCameraMotionAction）
grep -rn "updateItemTransition\|setClipTransition" src/components/video/timeline   # 无输出

# d) 工具栏转场按钮是占位
grep -n "transitionsRequireSelection" src/lib/i18n.ts
#   en: 'Select two adjacent clips first to add a transition. (Feature coming soon)'
#   zh: '请先选中两段相邻片段，再添加转场。（功能开发中）'
```

行为复现（`npm run dev` 开视频剪辑 Agent）：
1. 时间线放两段视频，对 Agent 说"给每个镜头加 0.5 秒淡入淡出"。
2. Agent 成功（`get_timeline` 回显 `transitionIn/Out`），预览里画面确实淡入淡出。
3. 回到时间线：**clip 上没有任何标记**；用户想去掉某个淡出，没有任何 UI 入口，只能再对 Agent 说一遍。

### 2.2 G-2：转场单 clip（静态）

```bash
sed -n 60,70p src/lib/video-editing-agent/tools/clipEffectsTools.ts
#   transitionParameters = { clipId: string, transitionIn?, transitionOut? }   ← 单个 clipId
sed -n 40,56p src/lib/video-editing-agent/tools/clipEffectsTools.ts
#   cameraParameters.clipIds: Array(minItems 1, maxItems 12)                    ← 批量
```

行为复现：10 个 clip 的时间线，"全部加 0.4s 淡入淡出" → Agent 需要 10 次 `set_clip_transition`（每次一轮模型往返 + 一次回执），
`agent.ts`/`tools/index.ts` 的 `calls > 80` 上限（`buildAllAgentTools`）会在长任务里被这类逐个调用吃掉；
且 `Type.Union([..., Type.Null()])` 的 `transitionIn/Out` 参数对弱模型本来就偏复杂，重复 10 次放大出错概率。

### 2.3 G-3：`dissolve` ≡ `fade`（静态，可直接比对）

```bash
# 预览：alphaFor 完全不读 transition.type
sed -n 40,100p src/components/video/playback/TransitionLayer.ts
grep -n "\.type" src/components/video/playback/TransitionLayer.ts      # 无输出

# 导出：_alpha_steps 同样只读 duration，type 不参与
sed -n 273,296p backend-services/basic-service/app/services/composition/filtergraph_builder.py
sed -n 17,22p backend-services/basic-service/app/services/composition/filtergraph_builder.py
#   "…two dissolving clips never overlap, so a dissolve is 'fade out + fade in'"

# 但类型契约与 usage hint 仍写"交叉溶解"
sed -n 855,857p src/types/index.ts
#   'dissolve' 与相邻 clip 交叉溶解，重叠时长=duration（秒）
sed -n 257,262p src/lib/video-editing-agent/promptParts.ts            # …type:fade|dissolve…
```

后果：模型选 `dissolve` 后向用户说"已做交叉溶解"，实际画面是"本 clip 淡出到下层/黑，再淡入"（dip），两个枚举值输出逐像素相同。

## 3. 根因分析

### 3.1 G-1 根因：转场是"只有 Agent 一个写入方"的数据，UI 层从未接线

- 数据模型 / 预览 / 导出 / 持久化 / 撤销快照键都有（第 1 轮 §3.1）；**唯一缺的是 UI 的读（徽标）与写（清除/编辑）**。
- 运镜的完整闭环是：`TimelineItem.tsx:867-896`（徽标）→ `TimelinePanel`（打开 `CameraMotionModal`）→ `setCameraMotionAction`
  （`store/actions/setCameraMotion.ts:30-52`：`recordAction` + 逐项 `updateItemCameraMotion` + `captureNextState`，整批一步撤销）→
  `timelineSlice.updateItemCameraMotion`（`slices/timelineSlice.ts:401`）。
- 转场对应的三层（徽标 / action / slice 方法）**全部不存在**；`i18n.ts:6167/10851` 的"功能开发中"说明这是已知占位，
  但 Agent 现在把它变成了真实写入方，于是出现"用户看不见也改不了 Agent 写进去的东西"。
- 这违背了本仓库对 Agent 写入的一贯约束：Agent 的每一种时间线写入都应能被用户在界面上**看见**并**撤销/改回**
  （撤销已有——`UNDOABLE_TOOL_NAMES`；"看见/改回"缺转场）。

### 3.2 G-2 根因：第 1 轮评审 R-3 只对运镜落实了批次，转场被当成"单 clip 低频操作"

- `set_clip_transition` 的参数是单个 `clipId`（`clipEffectsTools.ts:60-64`），实现里也只构造一个 `UpdateClipEffectsOperation`（`:222-228`）。
- 批次基础设施（`findRefusals` 整批预检、`commit`、`result.operations`）已经是通用的，运镜工具在用；
  转场没有复用，纯属设计时的取舍，没有技术障碍。
- 转场的典型用法恰恰是"全片统一风格"（所有镜头淡入淡出 / 首尾淡入淡出），比运镜更需要批量。

### 3.3 G-3 根因：`ClipTransition.type` 是为"将来的交叉溶解"预留的枚举，当前渲染两端都没实现

- 预览 `TransitionLayer.alphaFor` 与导出 `_alpha_steps` 都只用 `duration`；导出文件头自己写明"无重叠，dissolve = 淡出 + 淡入"。
- 时间线模型是"同轨首尾相接、不重叠"（`reconcile.packFlushTrack`），真实交叉溶解需要相邻 clip 在时间上重叠（或跨轨叠放），
  与现有排布模型冲突——这是**产品模型层面的限制**，不是 Agent 层 bug。
- Agent 层的责任只是别误导：第 1 轮工具描述已如实写 "Both types fade the clip's own alpha … (no overlap with neighbours)"，
  但 `promptParts.ts` 的 usage hint 与 `types.ts` 注释没同步，模型容易沿用字面理解。

### 3.4 G-4：验证缺口

- 第 1 轮报告末尾明确"未做：桌面端手验"。Node 测试覆盖了数据流与真实 `AgentEventRouter` 路径，
  但"预览确实刷新 / 导出确实淡入淡出"只靠代码阅读（`useTimelineComposition.ts:56-70` 的签名含转场；`videoExportItems.ts:199` 带 `transition_in`）。
- 本节点已核实两条链路在代码上都存在；缺的是运行证据。

## 4. 影响面

| 面 | 影响 |
|---|---|
| 用户（G-1） | 看不到、改不了 Agent 加的转场；只能再对话。对"我想手动微调/去掉"的用户是明显体验断点 |
| Agent 效率（G-2） | 批量加转场成本 O(N) 次往返；长剪辑任务里耗尽 80 次调用预算的风险 |
| 沟通准确性（G-3） | Agent 对用户承诺"交叉溶解"，交付的是 dip；属于"说一套做一套" |
| 不受影响 | 渲染型 effects 全流程、运镜（有徽标/面板）、导出链路、撤销语义、L0 预算 |
| 受影响文件规模 | `TimelineItem.tsx` 939 行、`TimelinePanel.tsx` 1610 行均已超 800 行上限（棘轮文件）：UI 增量必须放新文件 |

## 5. 候选修复方案

| 方案 | 内容 | 侵入性 | 风险 | 工作量 | 评价 |
|---|---|---|---|---|---|
| **A（推荐）**：补转场的 UI 读写 + 转场批量化 + 文案对齐 | A1 新增 `ClipTransitionBadge`（独立文件）显示入/出转场，点击弹小菜单可清除入/出；新增 `setClipTransitionAction` + `timelineSlice.updateItemTransition`（仿运镜，整批一步撤销）。A2 `set_clip_transition` 改为 `clipIds[1..12]`（复用 `findRefusals`/`commit`/批次契约，整批原子）。A3 usage hint / `types.ts` 注释 / 工具描述统一为"fade 与 dissolve 当前都是本 clip 的 alpha 淡入淡出，不是交叉溶解"，并加测试钉住 | 中（UI 新文件 + 1 个 slice 方法 + 工具参数变更） | 低-中：数据/预览/导出现成；参数从 `clipId` 改 `clipIds` 是对 1 天内新工具的 break，需同步测试与 hint | 中（约 1 天含测试） | 闭合"看得见、改得回、批量做"，且不动渲染模型 |
| B：只做 A2 + A3（不碰 UI） | 仅工具与文案 | 低 | 低 | 小（半天） | 解决效率与措辞，**不解决** G-1（用户不可见/不可清除），产品感不足 |
| C：实现真正的交叉溶解（相邻 clip 重叠 + xfade） | 改时间线排布模型、reconcile、预览合成、导出 filtergraph | 极大 | 高：破坏"同轨首尾相接"不变量、撤销/分割/吸附/导出全部受影响 | 大（>1 周） | 超出本需求，否决；留作路线图并在文案里诚实说明 |
| D：删除 `dissolve` 枚举，只保留 `fade` | 去掉误导 | 低-中 | 中：数据模型/导出/历史项目里已有 `dissolve` 取值，需兼容读取 | 小 | 否决：破坏契约且为将来交叉溶解留的口子被堵死；改文案足够 |
| E：转场并入 `set_camera_motion` 做成通用 `set_clip_effects` | 单工具 | 中 | 高：参数面变大，违背第 1 轮已定的渐进式披露/小 schema | 中 | 否决 |

## 6. 推荐方案（A）及理由

### 6.1 A2（先做，最小、收益最大）：`set_clip_transition` 批量化

- 参数：`clipIds: string[1..12]`（`minItems/maxItems` 与运镜一致）+ `transitionIn? / transitionOut?`（语义不变：对象设置、`null` 清除、省略不变）。同一组转场应用到全部 `clipIds`；**逐 clip 夹取到 ≤ 该 clip 时长一半**（各 clip 时长不同，夹取必须逐个算，结果里列出被夹取的 clip）。
- 实现沿用现有 `findRefusals → commit → result.operations`，整批原子；`clip` 回执字段改为 `clips: [{id,name,duration}]`。
- 去重 `clipIds`（与运镜同）。`clip_effects_empty` 等错误码不变。
- 不保留 `clipId` 别名：该工具 1 天内才提交、尚无外部调用者；留双参数会增大 schema 且让 `.strict()` 校验变模糊。同步更新 `clipEffects.test.ts` / `clipEffects.agentLoop.test.ts` 的调用与断言。

### 6.2 A3：措辞与契约对齐（同一提交）

- `promptParts.ts` 的 `CLIP_EFFECTS` hint 增加一句（控制 ≤ 现有 800B 上限）："fade and dissolve are both a per-clip alpha ramp (dip through the layer below/black), NOT a cross-dissolve between two clips."
- `types.ts`/`src/types/index.ts:855-857`、`TransitionLayer.ts` 头注释：改成"dissolve 为预留语义，当前与 fade 渲染相同"，避免下一位读者再被误导。
- 工具描述已正确，保持；测试新增"hint 含 NOT a cross-dissolve"断言，防止回退。

### 6.3 A1：转场的 UI 读 / 写（让用户看见并能改回）

- **读**：新文件 `src/components/video/timeline/ClipTransitionBadge.tsx`（`TimelineItem.tsx` 已 939 行，只允许加一行引用）：clip 左上/左右边缘显示入/出标记（小三角或"淡入 0.5s / 淡出 0.5s"tooltip），仅当 `item.transitionIn/Out` 存在时渲染；i18n 走 `t.timeline.transition.*`（en + zh 两份同步）。
- **写（最小）**：徽标点击 → 小弹层"清除淡入 / 清除淡出 / 全部清除"；调用新 `setClipTransitionAction(get, itemIds, {in?, out?})`（新文件 `store/actions/setClipTransition.ts`，结构照抄 `setCameraMotion.ts`：`isEditLocked` + 锁轨 + 可视片段预检 → `recordAction('UPDATE_ITEM', {kind:'TRANSITION'})` → 逐项 `updateItemTransition` → `captureNextState`，整批一步撤销）。
- `timelineSlice` 增 `updateItemTransition(itemId, {in?, out?})`（照 `:401` 的 `updateItemCameraMotion`）；领域聚合 `TimelineItem` 实体已有 `transitionIn/Out` 搬运（第 1 轮核实 `TimelineItem.ts`）。
- 工具栏"转场"占位按钮：保持现状（"功能开发中"文案不动），本轮不做"手动添加转场"的完整交互——只保证"Agent 写的可见、可清除"。
- 注意：`TimelinePanel.tsx` 1610 行，**不要**往里加逻辑；徽标自己持有菜单状态并直接调用 store action。

### 6.4 为什么推荐 A（而不是 B/C）

1. **闭环**：第 1 轮解决了"Agent 能写"，本轮补"用户能看、能改、批量高效"，否则功能对终端用户是"黑盒"。
2. **不增加上下文负担**：A2 用 `clipIds` 取代单 `clipId`，schema 体量基本不变（略增一个 array 约 +100B），L0 不变；A3 只在 hint 里 +1 句，仍在 ≤800B 与既有预算测试内。
3. **爆炸半径小**：不动渲染/导出/排布模型；UI 增量全在新文件；store 增量 2 个函数，且结构与运镜 1:1，可靠性有先例。
4. **诚实**：C（真交叉溶解）价值高但超范围，用文案如实限定，比保留误导好。

## 7. 给下一节点（评审 / 实现）的必测清单

遵循仓库 Clean Code 规则（缺陷先写失败测试；高风险路径不 mock）：

| 项 | 要求 |
|---|---|
| A2 正常 | 3 个 clip 一次设淡入淡出 → `result.operations` 长度 3、各 clip 的 `transitionIn/Out` 落地、`startTime/duration` 逐位不变（R-1 回归） |
| A2 失败 | 批内任一 clip 锁轨/不存在/音频 → 整批不落地且返回 `clip_effects_refused`；空 `clipIds`、>12、重复 id（去重） |
| A2 夹取 | 不同时长 clip 的夹取各自独立；回执 `note` 指明被夹取的 clip |
| A2 迁移 | 旧调用 `{clipId}` 被 `.strict()` 拒绝并给出可读错误（模型自纠） |
| A3 | usage hint 含"NOT a cross-dissolve"；hint 字节仍 ≤800；`clipEffects.disclosure.test.ts` 预算断言仍绿 |
| A1 读 | 有转场的 clip 渲染徽标；无转场不渲染；en/zh 文案齐全；不超出 `TimelineItem.tsx` 行数棘轮（仅加 1 行引用） |
| A1 写 | 清除入/出/全部：一次点击 = 一步撤销，撤销后还原；锁定轨拒绝；与 Agent 写入后的撤销（`UNDOABLE_TOOL_NAMES`）互不干扰 |
| 联动 | Agent 加转场 → UI 徽标出现 → 用户清除 → `get_timeline` 不再回显 → 导出请求（`videoExportItems.ts:199`）不再带 `transition_in` |
| 手验 | `npm run dev`：对 Agent 说"全部镜头加 0.5s 淡入淡出"，看预览淡入淡出、徽标出现、清除生效；导出一小段目测首尾淡入淡出（C-4 级长导出不强求）。**这是第 1 轮欠的验证，本轮必须补上或明确记录未做** |

## 8. 风险与待评审复核点

1. **`clipId`→`clipIds` 是破坏性变更**：全仓 grep `set_clip_transition` 的调用点（测试、skills 目录里的技能文本、docs）逐个核对；`agent-steering-and-skills` 的技能库若引用该工具名需同步。
2. **UI 文件行数棘轮**：`TimelineItem.tsx`(939)/`TimelinePanel.tsx`(1610) 已超限，仓库有"行数棘轮文件"测试（见记忆 `project_agent_steering_and_skills`）——新增行数不得上升到棘轮之上，必要时把徽标整块抽到新文件并净减行数。
3. **撤销与 `recordAction` 的 kind**：`recordAction('UPDATE_ITEM', {kind:'TRANSITION'})` 需确认历史面板/`UNDO` 对未知 kind 的处理与 `CAMERA_MOTION` 一致（运镜先例，预计无需改）。
4. **Agent 写 + 用户同时改**：用户清除转场与 Agent 回合并发时走既有 `isEditLocked`/回合租约；确认清除动作在 Agent 回合期间被锁（与运镜一致）。
5. **i18n 大文件**：`src/lib/i18n.ts` 已极大，只加最少键（`timeline.transition.{badgeIn,badgeOut,clearIn,clearOut,clearAll}`）。
6. **与本轮无关的工作区脏文件**：`git status` 里 skillrouter / desktop/build.ps1 等未提交改动与本任务无关，提交时用 `git add <具体路径>`，不要 `-A`。

## 9. 一句话总结

第 1 轮让 Agent"能给片段设运镜/转场"，但转场成了**用户看不见也改不了的隐形状态**（UI 零接线、工具栏仍是占位），
且 `set_clip_transition` **不能批量**、`dissolve` 文案**暗示了并不存在的交叉溶解**。
推荐 A：转场批量化 + 文案对齐（半天，先做）→ 转场徽标与清除（新文件，仿运镜 action，约半天）→ 补手验；真正的交叉溶解记为路线图，不在本轮。

## 评审结论

> 评审节点：逐条回到代码核对 §1–§8 的证据与方案。结论先行：**G-1/G-2/G-3 的症状与根因全部属实，推荐方案 A 成立**；但有 4 处证据需要纠正、3 处实现细节在原方案里漏了，下列均已用代码引用核实。

### R2-1 证据审计（症状是否被所引代码解释）

| 缺口 | 判定 | 复核证据 |
|---|---|---|
| G-1 转场不可见/不可清除 | ✅ 属实 | `grep transitionIn\|transitionOut src --include=*.tsx` 只命中测试；`TimelineItem.tsx:864-896` 仅有 `item.cameraMotion` 徽标（运镜徽标位于 `right-1 top-1`，`!` 徽标位于 `left-1 top-1`，见 `:858/:883`）；`timelineSlice` 只有 `updateItemCameraMotion`（`:401`），`store/index.ts:41` 只导出 `setCameraMotionAction`，没有任何转场写入口。Agent 写入走的是 `OperationApplier → clipEffectsOperation.applyClipEffectsToState` 对纯 `TimelineState` 的改写（`clipEffectsOperation.ts:88-101`），所以数据确实进了时间线，只是 UI 没读/没写 |
| G-2 单 clip | ✅ 属实 | `clipEffectsTools.ts:60-64` 为单 `clipId`；`:222-228` 只构造一个 operation；`tools/index.ts:575` `++calls > 80` 上限确实存在。`findRefusals/commit` 对 operation 数组通用（`:105-130`），批量化无技术障碍 |
| G-3 dissolve ≡ fade | ✅ 渲染事实属实，⚠️ **结论表述不严谨（见纠正 C-3）** | `_alpha_steps`（`filtergraph_builder.py:273-287`）与 `TransitionLayer.alphaFor` 都不读 `type` |
| G-4 手验缺失 | ✅ 属实（流程缺口，非代码缺陷） | 第 1 轮报告自述未做；本轮仍须补 |

没有发现被遗漏的"反例"使 G-1/G-2 失效：未找到任何隐藏的转场 UI 入口（`src/components` 全量检索）。

### R2-2 对原分析的 4 处纠正（实现者必须按此为准）

- **C-1（P1，方案漏项）`TimelineItem` 实体没有 `transitionIn/Out` 的 setter。** §6.3 写"领域聚合已有 `transitionIn/Out` 搬运"只对了一半：`domain/entities/TimelineItem.ts:242-243` 只有 **getter**（构造/`toPlainObject`/`fromPlainObject` 在 `:112/:177/:285/:326/:553` 搬运，但不可变），而运镜有 `set cameraMotion`（`:240`）。因此 A1 的 `timelineSlice.updateItemTransition` 不能照抄 `:401` 一行搞定——必须先在实体上补两个 setter（形如 `set transitionIn(value: SequenceTransitionData | undefined)`），或让 slice 经 `fromPlainObject` 重建。推荐前者（与 `cameraMotion` 对称，最小）。受影响文件由"新文件 + 1 个 slice 方法"变为"新文件 + 实体 2 个 setter + 1 个 slice 方法"，仍在小范围内。
- **C-2（P2，事实订正）§8.2 所谓"行数棘轮测试"不存在于 `TimelineItem.tsx / TimelinePanel.tsx`。** 全仓检索 `ratchet|棘轮|max-lines` 只命中 `useAgentExecution*.ts` 的注释与 `types/agentSteering.ts`，没有断言这两个文件行数的测试，ESLint 也无 `max-lines`。约束来源只是 CLAUDE.md Clean Code（≤800 行）这条**约定**。结论不变（`TimelineItem.tsx` 939 行，只允许加 1 行 import/引用，其余放新文件），但实现者不要去找一个并不存在的测试，也不要因为"没有测试拦住"就往大文件里加逻辑。
- **C-3（P2，G-3 表述收紧）"不是交叉溶解"过度绝对。** `TransitionLayer.ts:12-17` 的头注释明确写了跨 clip 溶解的实现方式：前一 clip 的 `transitionOut` 与后一 clip 的 `transitionIn` 在**时间上重叠**，合成器绘制两层、各带自己的 `alphaFor`，视觉叠加即溶解；导出端 `filtergraph_builder.py:17-20` 同样按轨道叠加（`overlay`）且每个 clip 自带 alpha 斜坡。所以**不同轨道上相互重叠的两个 clip**，预览与导出在构造上都会产出真实的交叉溶解；唯一被排除的是**同一磁吸轨道的相邻 clip**（它们从不重叠，`filtergraph_builder.py:17-20` 的注释说的正是这一种）。因此 A3 的措辞应为："fade 与 dissolve 当前渲染相同，都只对本 clip 做 alpha 斜坡；**同轨相邻 clip 之间不会产生交叉溶解**；只有把后一个 clip 放在上层轨道并与前一个重叠，才会出现叠化。" 不要写成"绝不是交叉溶解"，也不要让 Agent 对用户承诺叠化——该跨轨路径没有测试钉住，属"构造上成立、未验证"，本轮手验可顺带试一次并如实记录。
- **C-4（P3）`types/index.ts:855-857` 的注释也要改。** 现注释说"'dissolve' 与相邻 clip 交叉溶解，重叠时长=duration"，与上面的渲染事实不符，A3 应同时修正（原方案已列，补充具体措辞见 C-3）。

### R2-3 对方案 A 各子项的边界复核

**A2 批量化 `clipIds`**（采纳，附 3 个必须落实的细节）
1. `clampTransition` 现用单个 `found?.item.duration`（`:190-195, :213-216`）。批量后必须**逐 clip** 取夹取上限，并在 `result` 里列出被夹取的 clip id（原方案已提，保留）。注意 `findClipWithTrack` 找不到 clip 时 `duration = 0` → 夹取为 0 → 随后才被 `findRefusals` 以 `clip-not-found` 拒绝；顺序无害，但批量实现里要保证"先预检、后夹取/构造"，避免对不存在的 clip 构造出 `duration: 0` 的 operation 再被当成有效转场（Zod/`transitionProblem` 会拒 0，是第二道保险，不要依赖它）。
2. **整批原子性只在预检层成立。** `commit()`（`:117-130`）对本地镜像逐个 `updateTimeline`，若第 k 个被拒，前 k-1 个已落地而函数只返回错误——与运镜同构，既有行为，且 `findRefusals` 已用与客户端相同的守卫预检，实际极难触发。不要为此扩大本轮范围，但新测试应至少覆盖"预检失败 → 0 个落地"这条主路径（原 §7 已列）。
3. `clipIds` 取代 `clipId` 为破坏性变更：全仓引用点已核对，仅 `promptParts.ts:259`、`tools/clipEffectsTools.ts`、`trackPatch.ts:44`（仅工具名，无参数）、3 个测试文件（`clipEffects.test.ts` / `.agentLoop.test.ts` / `.disclosure.test.ts`）和两份诊断文档；`src` 内无技能库文本引用，故无外部调用者，直接改、不留别名（同意 §6.1）。

**A3 文案**：`CLIP_EFFECTS` hint 现 453 B，追加约 125 B 的订正句后约 580 B，仍 ≤800 B 预算（`clipEffects.disclosure.test.ts:75/88-89`）。同一个 hint 里的 `set_clip_transition(clipId, …)` 必须同步改成 `clipIds<=12`，否则 hint 与新 schema 冲突。

**A1 UI 读写**（采纳，附 4 个实现约束）
1. **徽标位置**：右上 `right-1 top-1` 已被运镜徽标占用、左上 `left-1 top-1` 被 `!` 徽标占用，转场徽标应放**底部**（`left-1 bottom-1`，入/出各一个小标记），避免与现有徽标重叠。
2. **弹层必须用 portal**：clip 容器带裁剪（`:200` 的 `overflow-hidden`，且已有 `createPortal` 先例 `:836` 的 `coverMenu`），徽标自带的清除小菜单不能渲染在 clip 内部，否则被裁掉；复用 `createPortal` 与 `PortalTooltip.tsx` 的做法，并 `onPointerDown` 阻止冒泡防止触发拖拽（运镜徽标已这样做，`:870`）。
3. **Agent 回合锁**：`setClipTransitionAction` 必须以 `isEditLocked(state)` 开头（照 `setCameraMotion.ts:34`），并用与运镜相同的可编辑谓词预检（`canApplyCameraMotion` 对应 `clipEffectsOperation.isClipEffectsEligible`，两者已有测试钉住一致）。徽标在锁定期间应禁用点击而不是点了无反应。
4. **拆分语义无需改动**：`SplitService.ts:102-126` 已规定"左半只留入场转场、右半只留出场转场"，所以用户清除后再分割不会再生成中段淡入淡出；撤销快照走 `getSnapshot/restoreFromSnapshot`，`recordAction('UPDATE_ITEM', {kind:'TRANSITION'})` 对未知 kind 与 `CAMERA_MOTION` 同样只作为 payload 透传（`historySlice.ts:103-114`），无需改历史面板。

### R2-4 回归风险

- **渲染/导出/排布模型：不动**，A 不改 `TransitionLayer.ts`、`filtergraph_builder.py`，只改其注释措辞（不触发 Python 测试）。
- **唯一的行为性变更是工具参数形状**（`clipId`→`clipIds`）。风险被"工具 1 天内才提交 + 无外部调用者 + `.strict()` 校验给模型可读错误"压低；必须有一条测试证明旧形状 `{clipId}` 得到可读的校验错误而不是静默成功。
- **新增 UI 的回归面**：`TimelineItem.tsx` 仅加 1 行引用；`updateItemTransition` 新增不改既有方法；实体 setter 为纯新增。`TimelineItem.*.test.ts(x)` 系列（audio/filmstrip/hoverZone/inlineSubtitleEdit/localDownload）需整体跑一遍确认无回归。
- **未验证项**（评审不替实现者假设）：跨轨重叠叠化在预览/导出的实际画面（C-3）；`ClipTransitionBadge` 在窄 clip（时长很短）上的可点击面积——短于约 24px 时应只显示图标或干脆不渲染，由实现时决定并测。

### R2-5 最终推荐修复（单一方案）

**采纳方案 A，按三个提交粒度顺序实施，并附 C-1…C-4 的修正：**

1. **提交 1（Agent 侧，先做）**：`set_clip_transition` → `clipIds[1..12]`（去重、逐 clip 夹取、整批预检后提交、回执 `clips[]` + 被夹取的 clip id）；`CLIP_EFFECTS` hint 改 `clipIds<=12` 并加入 C-3 措辞；`types/index.ts:855-857` 与 `TransitionLayer.ts` 头注释按 C-3/C-4 订正；更新并新增测试（§7 的 A2/A3 行 + 旧形状 `{clipId}` 被拒）。
2. **提交 2（UI 读写）**：实体 `set transitionIn/Out`（C-1）→ `timelineSlice.updateItemTransition` → 新文件 `store/actions/setClipTransition.ts`（+ `store/index.ts` 导出）→ 新文件 `timeline/ClipTransitionBadge.tsx`（底部定位、portal 小菜单、锁定禁用）→ `TimelineItem.tsx` 仅加 1 行 → i18n 最少键（en+zh）；测试覆盖 §7 的 A1 读/写/联动行。
3. **验证（不可省）**：`npm run dev` 手验 §7 末行（预览淡入淡出、徽标出现、清除后预览与导出请求不再带 `transition_in`），顺带试一次跨轨重叠叠化并如实记录；若环境无法手验，必须在交付记录里明确写"未做"，不得写"已验证"。

**为什么是 A 而不是 B/C/D/E**：B 不解决用户看不见/改不了 Agent 写入的"黑盒"，对"顶级产品"目标不够；C（真交叉溶解的排布模型改造）改动面与风险远超需求；D 破坏已持久化的 `dissolve` 取值并堵死未来口子；E 违背第 1 轮渐进式披露的小 schema 决定。A 在不触碰渲染/导出/排布的前提下闭合"看得见、改得回、批量做"，且每一块都有运镜先例可对照，评审认为这是满足目标的最小充分改动。

**不在本轮做**：工具栏"手动添加转场"交互、真正的同轨交叉溶解、转场预设库——记入路线图，文案如实限定能力。

## 实施过程发现的方案缺陷

> 实施节点按「最终推荐修复 A」落地（提交 1 Agent 侧 + 提交 2 UI 读写），未执行 `git commit`。以下是实施中发现的、与方案原文不一致或方案没提到的点。

- **I-1（P1，方案漏项）五个 `TimelineItem.*.test` 用 `?raw` + 显式模块表编译 `TimelineItem.tsx`**（`__tests__/test-utils/compileComponent.ts`：未映射的 import 直接抛 `unmapped import`）。评审说"`TimelineItem.tsx` 只加 1 行引用"，但实际是 1 行 import + 1 行使用，并且必须在这 5 个测试的模块表里各补一行 `'./ClipTransitionBadge': Nothing`，否则整组测试因新 import 变红。已补。
- **I-2（P2，基线已红）这 5 个套件在实施前就已经红**：`TimelineItem.tsx` 早已 import `./ClipContextMenu`（Remotion 特效提交 5e663714 引入），但 5 个模块表没映射它，报 `unmapped import ./ClipContextMenu`。若不处理，这 5 个套件无法证明"`TimelineItem` 改动无回归"。因此顺手各补一行 `'./ClipContextMenu': { ClipContextMenu: Nothing }`（纯测试替身，不动生产代码）；补完 `TimelineItem.*` 共 10 个文件 / 46 个用例全绿。这是为验证本改动而做的最小测试夹具修复，不是无关重构。
- **I-3（P3，方案取舍）清除菜单直接复用现成的 `ClipContextMenu`**（body portal、方向键/Esc/点外部关闭、焦点归还），而不是方案里说的"自建小弹层 + 仿 PortalTooltip"。收益：不新增弹层实现，也自带键盘可达性；`onPointerDown` 阻止冒泡已内置。
- **I-4（P3，方案细化）可编辑谓词用 `canApplyCameraMotion`**（与运镜动作同源，且 `clipEffects.test.ts` 已有测试钉住它与 Agent 侧 `isClipEffectsEligible` 同值），没有再造第二份规则。另外 `setClipTransitionAction` 对"补丁不会改变任何东西"的 clip 直接跳过，避免用户重复点击产生空撤销步（方案未写，运镜动作也没有这层）。
- **I-5（P3）窄 clip 处理**：评审留给实现者决定。取舍：clip 渲染宽度 < 40px 时徽标整体不渲染（两个 14px 标记会重叠且无法点中）；时间线缩放放大后即可见。该阈值与行为有测试。
- **I-6（P3，措辞）`CLIP_EFFECTS` hint 的订正句**避免了方案原文里 `clip's` 的撇号（该字符串用单引号字面量拼接，转义易错）：写作 "ramp the alpha of the clip itself (a dip through the layer below/black); same-track neighbours never overlap, so this is NOT a cross-dissolve between two clips"。没有按评审 C-3 写"跨轨叠放才会叠化"——该路径没有测试钉住，Agent 面向用户的文案不应暗示可用；只在 `types/index.ts` 与 `TransitionLayer.ts` 的开发者注释里按 C-3 如实记录"构造上成立、未验证"。
- **I-7（P2，验证缺口，如实记录）桌面端手验仍未做。** 本环境没有可交互的 Electron/浏览器会话，所以 §7 末行（`npm run dev` 里让 Agent 加 0.5s 淡入淡出 → 看预览/徽标 → 清除 → 导出目测）与"跨轨重叠叠化是否真有叠化画面"**都没有执行，不得写成已验证**。已验证的是它的可自动化替身：真实 store（`useTimelineStore`）里"写入→清除→一步撤销→重做"、锁定轨与 Agent 回合锁拒绝、真实 `buildExportCompositionItems` 清除后不再带 `transition_in`、真实 Agent 循环用 `clipIds` 写入并走 `AgentEventRouter`、旧形状 `{clipId}` 被同一个 `validateToolArguments` 拒绝并点名 `clipIds`。

### 实施结果（验证记录）

| 项 | 结果 |
|---|---|
| `clipEffects.*` 三个测试文件 | 44 通过（含新增：批量落地逐位不变、去重、逐 clip 夹取与 note 点名、整批原子拒绝、`{clipId}` 旧形状被拒、1..12 边界、hint 含 "NOT a cross-dissolve"） |
| 新增 `setClipTransition.test.ts`（node，真实 store） | 9 通过 |
| 新增 `ClipTransitionBadge.test.tsx`（真实组件 + 真实 store + 真实 ClipContextMenu） | 10 通过 |
| `src/components/video/{timeline,hooks,playback}` 全量 | 修复 I-2 后 `TimelineItem.*` 10 文件 / 46 用例全绿；其余此前即通过 |
| `src/lib/video-editing-agent` 全量 | 20 个失败来自 6 个文件（autonomyStore / coverCard / coverOperation / scriptSegmentAssociation / subtitleDisclosure / systemPrompt.toolkit）；其中 L0 预算两个文件已用 `git stash` 对照证明**不含本改动时同样 6 个断言失败**（19690/18593 > 18500 等），与本改动无关；其余四个文件与转场无关 |
| `tsc --noEmit` | 本改动涉及的文件零错误；仅剩工作区里 skillrouter 未提交改动的既有类型错误（`SkillRouterLastVerified.stale`） |
| ESLint（新/改的 4 个源文件） | 无输出 |
| 复现步骤复查 | G-1：`grep transitionIn src/components --include=*.tsx` 现在命中 `ClipTransitionBadge.tsx` / `TimelineItem.tsx`，且有 `setClipTransitionAction` + `updateItemTransition`；G-2：`set_clip_transition` 参数为 `clipIds[1..12]`；G-3：hint、工具描述、`types/index.ts`、`TransitionLayer.ts` 注释已统一为"fade ≡ dissolve，同轨相邻不会交叉溶解" |

### 改动清单

- Agent 侧：`tools/clipEffectsTools.ts`（`clipIds`、`planTransitions` 逐 clip 夹取）、`promptParts.ts`（hint）
- 契约注释：`src/types/index.ts`、`playback/TransitionLayer.ts`
- UI 读写：`timeline/domain/entities/TimelineItem.ts`（2 个 setter）、`domain/index.ts`（导出 `SequenceTransitionData` 类型）、`store/slices/timelineSlice.ts`（`updateItemTransition`）、新 `store/actions/setClipTransition.ts` + `store/index.ts` 导出、新 `timeline/ClipTransitionBadge.tsx`、`TimelineItem.tsx`（+3 行，仍为既有超限文件）、`lib/i18n.ts`（`timeline.transition.*` en+zh 六个键）
- 测试：上表三个测试文件 + 两个新文件 + 5 个 `TimelineItem.*` 夹具各补两行
