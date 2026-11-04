# 剪辑 Agent「YOLO 全自动模式」设计方案（agent-yolo-autonomous-mode）

> 版本 **v2**（v1 → v2：完成设计评审，1 个 P0 + 4 个 P1 已修订进正文，9 个 P2 已处置，见「评审记录」与文末「评审结论」）· 本轮设计节点 · 设计基线：本仓库当前工作树（`main`，含 `agent-steering-and-skills`、`agent-research-crew-and-context-memory` 两轮已落地改动）· **本文只描述设计，不含实现代码**，文中的代码片段是实现者照抄即可的契约示意（凡标注"示意片段"者只表示插入位置，不得整段替换既有数组）。
> 相关前序方案（均已实现，本文不重复其内容）：
> `agent-general-toolkit`（工作区/文档/分析沙箱/计划/询问/记忆）、`agent-steering-and-skills`（运行中插话 + 技能库）、`agent-research-crew-and-context-memory`（小队 + 会话记忆）、`agent-stop-and-resume`（停止与续跑）、`agent-visual-review`（视觉审阅 + 静态自检）。

---

## 评审记录

> 评审对象：本文 v1（731 行）。评审方式：逐节对照**可行性 / 完整性 / 一致性 / 合理性**四个维度，并把文中每一条「已核实事实」按当前工作树（HEAD，两轮改动已落地）重新对账，不采信 v1 自述。
> 先行结论：**方案主体成立**——"一个开关四层落实"的切面是对的（只改界面必然是假实现），"只减不增权限"的立场是对的，把既有断言写成"必须保持绿"的回归护栏也是本仓库此前两轮评审确立的正确做法。
> 计发现 **1 个 P0、4 个 P1、9 个 P2**；P0 与 P1 **已全部修订进正文并升版 v2**；P2 的 9 条也**全部在正文里处置完毕**（没有"留到实施时再说"的条目）。

### P0 / P1（必须修，已全部修订）

| # | 严重度 | 位置 | 问题（含证据） | 处置（v2 已落正文） |
|---|---|---|---|---|
| P0-1 | **P0** | §4.6 触发条件 C2、§7.2、AC-C6 | **自动续跑的发送时机不可用，功能会"看着正常但从不触发"。** v1 把触发点定义为"终态为 `onComplete`"。但 `onComplete` 是在 `finishExecution` 内部、`status='finishing'` 期间执行的（`useAgentExecutionState.ts:234` 先写 `finishing`，`:247` 才写终态），而 `agentIsExecuting = isStreamLive \|\| status === 'finishing'`（`useAgentExecution.ts:259`），`sendAgentMessage` 首行就是 `if (sendingRef.current \|\| agentIsExecutingRef.current) return;`（`:537`）。即：**在 `onComplete` 里发消息 100% 被静默丢弃**，且没有返回值可观测。这不是细节，是 B4 整批功能的死因。 | 触发点改为**执行态空闲边沿**（`agentIsExecuting` true→false，真相 `status` 已落到 `completed`），并由 `useAgentExecution` 暴露一个显式的**回合结束事实** `lastTurnEnd`（§4.6 / §6.4 / §7.2）；AC-C6 重写为可机检断言，并明令"不得依赖 `sendingRef` 兜底"。 |
| P1-1 | P1 | §4.6 C3、§4.10、AC-C6 | **"双发送者"竞态：YOLO 续跑与 steering 的排队自动发送会在同一个边沿各发一次。** 既有的回合结束边沿已经存在且**会自己发消息**：`useAgentExecutionSteering.ts:85-93` 在 `agentIsExecuting` true→false 时调 `steering.onTurnEnd(...)`，而 `onTurnEnd` 在 `reason==='completed' && !endedWithAskUser` 时把排队文本作为新一轮自动发出（`steeringMachine.ts:183-188`，出口是 `sendFollowUp` → `sendAgentMessage`，`useAgentExecution.ts:277`）。v1 的 C3 想读"队列非空"来避让，但 `onTurnEnd` **在同一个边沿里先 drain 掉 `notes`/`queued`**（`steeringMachine.ts:178-182`），所以 C3 在被求值时恒为真；两个 effect 的先后只由 hook 调用顺序决定，一旦顺序反过来，**用户排队的那句话会被静默丢掉**。 | 见 §4.6「唯一发送者」：回合结束事实里带 `steeredOrQueued` 与 `followUpSent`（在 `onTurnEnd` **之前**采样），C3 改读该事实；并明令"同一回合结束最多只有一个发送者，且 steering 优先"。新增 AC-C8。 |
| P1-2 | P1 | §5.2 行数列、§4.6、D-12、AC-E3 | **行数棘轮自相矛盾，且基线数字全部未实测。** 本仓库已在 `agent-steering-and-skills` AC-G2 定下规则：基线 > 800 行的文件**不得增长**。实测当前值：`useAgentExecution.ts` **855**（v1 写 916）、`AgentToolkitSettingsPanel.tsx` **818**（v1 写 876、且一边引用纪律一边给 +2）、`VideoEditingInterface.tsx` **2471**（v1 未提，却给 +8）、`src/types/index.ts` **1002**（v1 给 +1）、`i18n.ts` 11973（数据文件豁免）。按 v1 的写法，实施者要么违反规则，要么"悄悄忽略数字"——后者是 CLAUDE.md 明令禁止的。 | §5.2 末尾新增**实测基线表 + 逐文件预算**（其中 4 个超线文件要求净增 ≤ 0，并逐文件写明做法：同文件等量删减 / 抽到新文件 / `types/index.ts` 只改既有那一行联合类型——**模块增强拓宽不了既有联合类型**，那条路走不通）；AC-E3 重写为可执行命令。 |
| P1-3 | P1 | §4.2、§7.2、§9.2 步骤 6 | **"设置中心改一边、剪辑台另一边同步"在 v1 设计下不可达。** v1 明确"不做模块级缓存：一次 GET 成本可忽略"，但 GET 只发生在挂载时；设置中心与剪辑台是两个独立 hook 实例，**没有任何广播通道**，于是手工验收第 6 条（"改一边另一边同步"）永远失败，用户还会看到"设置里开了、面板里是关的"。 | §4.2 / §7.2 改为**模块级 store + 更新事件**（复用本仓库既有先例 `notifySetupConfigUpdated()` / `ecliptrix-llm-config-updated`）：`src/lib/video-editing-agent/autonomyStore.ts` 缓存一次 GET 结果，写入后广播；两个入口共用。新增 AC-C9。 |
| P1-4 | P1 | §2.3 映射表、§4.5.1、R-01、§12 | **"中途不停"的承诺边界没有落点。** C4 是自动续跑的唯一客观依据，而它要求模型**先发布计划**；模型完全不 `update_plan` 时，客户端兜底为零（只剩提示词一层）。v1 的 R-01 写着"残余风险在 §13 明确不承诺 100%"，但 §13 是决策登记表，**全文没有任何这句**；§2.3 把"开启后全自动、不停"映射到 AC 时也没写前提。评审要求：不承诺可以，**不许把前提藏起来**。 | §2.3 增补前提列；§4.5.1 指令增加"无计划时也要收敛到底"与能力缺失优先级两条；§12 新增「能力边界与不承诺」小节；R-01 的引用改为指向 §12。 |

### P2（已处置）

| # | 严重度 | 位置 | 问题 | 处置（v2） |
|---|---|---|---|---|
| P2-01 | P2 | §4.9.1、§5.2（`editor-workbench.css` +14） | 顶栏已有现成令牌与类：`.ws-chip` / `.ws-chip--warn`（`editor-workbench.css:400-416`，`--ws-warn: #E3A33B` 浅深两套），`BackupChip` 就是这么用的（`EditorTopBar.tsx:87`）。再造 `.ws-yolo-chip`/`.ws-yolo-dot` 属重复造轮子（+14 行、两套深色处理、一个新的视觉岛）。 | 改为直接复用 `ws-chip ws-chip--warn`，CSS 新增行数降为 **0**；聊天面板内的琥珀色沿用 Tailwind `amber-*`（与该面板既有的 `AgentBusyBar` 同源）。 |
| P2-02 | P2 | §7.2 `ready` 语义 | "`ready=false` 时按关渲染但可点，点击会先加载"——一次点击产生"先 GET 再写"两跳，且用户看到的是自己没按过的值翻转，属反直觉交互。 | 改为 `ready=false` 时**禁用**（`aria-busy="true"` + 同一 title 文案占位），加载失败即保持禁用并在 title 说明；首屏 GET 与面板挂载同时发生，用户感知不到。（顺带消除 P1-3 里的"发送与开关值不一致"窗口。） |
| P2-03 | P2 | §4.5.3 代码块 | 该块被声明为"照抄即可的契约示意"，但它序列里**漏掉了尾部 `if (planDigest) sections.push(planDigest)` 等三行**（`systemPrompt.ts:634-636`）。照抄会静默删掉「当前计划」「长期记忆」「已探索类别」三个区块——计划没了，C4 也就永远不成立。 | 标注为「示意片段，仅表示插入位置」，并显式写出"尾部三行 `if (…) sections.push(…)` 必须保留"。 |
| P2-04 | P2 | §6.1 契约表 | 两处与实现不符：① `PUT /api/system-settings/{category}` 的同源校验只在 `category==='web_research'` 时生效（`researchUiOrigin.ts:34-43`），`agent_toolkit` 不做 origin 门禁（`Origin` 头只是被转发）；② 422 错误体是 `{detail:{category,errors:[{msg}]}}`，**没有 `key` 字段**（`system_settings_router.py:266-283`）。 | 按实测改写 §6.1 的请求/错误契约。 |
| P2-05 | P2 | §4.7 E4 | `CATEGORY_USAGE_HINTS[ANALYSIS_TOOLS]` 的原文是"…tell the user where to enable it and **stop**"（`promptParts.ts:187-191`），与 YOLO 的"不许停"直接冲突；v1 只在表格里断言"改为换路径并记录"，正文指令里没有这条优先级。 | 在 `YOLO_DIRECTIVE` 增加一条显式优先级条款（能力缺失 → 记录并换路径，不得停下让用户去开启）；E4 行注明依据。 |
| P2-06 | P2 | §4.6 C4/C5 | 未绑定会话：C4 扫"最近一条 agent 消息"、C5 用 ref 计数，都没写必须锁定 `activeConversationId`。切换会话（`cancelByNavigation` 只停流不封消息）后可能对着新会话求值。 | C4/C5 补"绑定当前 `activeConversationId`，且该会话最后一条消息必须是本回合刚写的 agent 消息"。 |
| P2-07 | P2 | §5.1 新增测试文件 | `tests/test_system_settings_agent_yolo.py` 与套件既有约定不一致：本仓库同类测试叫 `test_agent_toolkit_settings.py`（138 行，且已有 `set(payload['agent_toolkit']) == set(AGENT_TOOLKIT_DEFAULTS)` 的 YAML 对账，天然覆盖新键）。 | 改为扩展既有文件 + 新文件命名 `test_agent_toolkit_settings_yolo.py`。 |
| P2-08 | P2 | §4.5.1 自检清单 | 提示词写"check_timeline 无 blocker；有重叠用 auto_fix_overlaps 直到 valid"，但重叠自检的专用工具是 `check_timeline_overlaps`（`tools/checkOverlaps.ts`），两个是不同工具；`check_timeline` 不返回重叠明细。 | 措辞改为 `check_timeline`（blocker）+ `check_timeline_overlaps`（valid=true）分工写清。 |
| P2-09 | P2 | §4.9.1 标签排版 | v1 给 YOLO 标签另定一套 `text-[10px] font-semibold tracking-[0.08em]`，而相邻「Agent」标签是 `text-xs font-medium text-muted-foreground`（`VideoChatWindow.tsx:391`）。同一个 40px 高的工具栏里出现两套标签排版，恰是"和当前界面统一"要避免的。 | 改为复用相邻标签的类；只对 `YOLO` 加 `tracking-[0.06em]` 以补齐"4 字母 vs 5 字母"的视觉等重；并把 360px 下的宽度预算重算成可核对的数字（≈238px / 328px 可用）。 |

---

## 1. 概述

剪辑 Agent 现在是一个**可以随时停下来问人**的协作者：`ask_user` 是常驻工具（`src/lib/video-editing-agent/tools/askUserTool.ts:40-88`），一次回合只允许问一次，工具立即返回 `awaiting_user` 信封并**结束本回合**，用户点选后前端把答案拼成一条普通用户消息（`VideoChatWindow.tsx:206-218` → `askAnswerMessage`）再起一轮全新的 SSE 请求。这套机制在"帮我找 5 个城市空镜"这类短任务上非常好用，但在"做一条 60 秒资讯视频"这类长链路上反而是**成本**：搜索、下载、TTS、生成、上轨、自检动辄 3–10 分钟，Agent 每遇到一个可左可右的分叉就停一次，用户离开工位就意味着一轮流程永远悬在半空。

与此同时，这个产品的用户里有相当一部分要的不是"被问"，而是"交给我，你去跑"。他们要的是**一句话下去，全流程跑完，中途零交互**：素材不够就自己换关键词、生成失败就换降级路径、时长不合就自己裁、重叠就自己修，最后交一条可导出的时间线。本次要加的正是这个开关：界面上叫 **YOLO**（全自动模式），开启后整个剪辑流程**不允许中途停下来问人**；关闭时保持今天的协作式行为，该问就问。

本方案的设计立场是三条：**① 一个开关、四层落实**（界面状态 → 请求协议 → 工具集 → 系统提示词），任何一层缺失都不算实现；**② 只减不增权限**（YOLO 唯一的权限变化是"移除提问"，不新增任何工具、不抬高调用上限、不绕过自检与导出前置检查）；**③ 永远保留逃生舱**（停止按钮、逐条撤销、整轮撤销、时间线锁与导出预检一条都不动）。界面层面要求它与现有工作台完全统一：沿用 shadcn/CSS 变量的视觉语汇、与相邻的「Agent」开关同尺寸同位置同交互、深色模式与中英文案都成立、键盘可达、不做打扰式弹窗。

---

## 2. 需求解读与交互契约

### 2.1 需求原文（用户）

> "需要增加一个开关，就是这个开关是**全自动剪辑模式**的开关，显示在上面的时候就显示为 **YOLO**。如果用户开启这个开关之后，剪辑的整个全流程都应该是全自动的，中间不能停下来，AI Agent 不能去咨询用户或者是问问题之类的，全部要靠它自己去解决。如果这个开关是关闭的情况下，Agent 在剪辑过程中遇到的一些问题、选项或不确定的，都可以去跟用户发起提问，让用户选择或输入回复。总而言之，添加一个全自动模式，并且要美观、和谐、优雅，符合人机交互最佳实践，和当前界面要统一。"

### 2.2 开关矩阵（实现必须逐格对上）

| # | Agent 模式（`agentMode`） | YOLO | Agent 运行中的行为 | 界面表现 |
|---|---|---|---|---|
| S1 | 开 | **关**（默认） | 与今天完全一致：`ask_user` 可用、单轮一次、回合以提问收尾 | YOLO 开关为关态，提示"遇到不确定会向你提问" |
| S2 | 开 | **开** | **零提问**：`ask_user` 不在工具集里，提示词禁止提问，自决 + 记录假设 + 跑完 | 开关为琥珀色"已武装"态；顶栏出现 `YOLO` 徽标；忙碌条带 `YOLO` 标记 |
| S3 | 关 | 任意 | 走普通聊天（`handleSendChatMessage` 的非 Agent 分支），不存在提问概念 | YOLO 开关置灰，提示"先打开 Agent 模式" |
| S4 | 开 | 开 → 用户在运行中想改 | 本轮**不变**（服务端在请求开始时已快照）；改动自下一回合生效 | 运行中开关禁用 + 明确提示"执行中不可切换" |

### 2.3 需求到机制的映射（每一条都要有落点）

| 需求 | 机制 | 验收 | 前提 / 边界（**不许藏起来**） |
|---|---|---|---|
| 开关显示为 YOLO | 聊天工具栏开关标签 + 顶栏徽标（§4.9） | AC-C1、AC-C3 | 主开关在聊天工具栏；顶栏只读不回写（D-02） |
| 开启后全自动、不停 | 工具层移除 `ask_user`（§4.4）+ 提示词禁令与完成契约（§4.5）+ 客户端一次有界自动续跑（§4.6） | AC-A2、AC-A4、AC-C6、AC-C8 | **第三层依赖模型先把计划发出来**（C4）。无计划时兜底只剩提示词一层——这是能力边界，写入 §12 |
| Agent 不能咨询用户 | 模型拿不到 `ask_user` 的 schema，提示词显式禁止，历史里的旧提问被声明作废 | AC-A2、AC-A4、AC-D1 | 工具层是硬保证（注册表里没有就 offer 不出来）；提示词层是软保证 |
| 全部靠它自己解决 | 降级优先、失败最多重试一次、预算内收敛、结束前自检、能力缺失换路径（§4.5 指令全文） | AC-A4 | 熔断（连续 5 次工具失败）与调用上限**照旧**触发，不自动重试（E5/E6） |
| 关闭时照常提问 | 互动模式路径**一行不改**（`AGENT_TOOLKIT_GUIDANCE` 与 `CORE_TOOLKIT_TOOL_NAMES` 保持原值） | AC-A1、AC-A3、AC-F1 | `autonomy` 缺省即为互动模式，两处（类型 + route）都写死 |
| 美观/和谐/优雅/统一 | 与相邻「Agent」开关同几何、同交互；琥珀色沿用既有"收尾中"色系与顶栏 `ws-chip--warn`；深色模式、窄面板、双语、键盘与读屏 | AC-C1、AC-C5、AC-E1 | 顶栏 48px 已拥挤：徽标只读、无交互、窄屏可隐藏 |
| 可逆、不惊吓 | 运行中禁用切换；停止/撤销/导出预检全部保留；首次开启只给一条自动消失的行内说明 | AC-C5、AC-D1、AC-D2 | 停止按钮永远是 YOLO 的人工出口（E10） |

### 2.4 明确不做

- 不做"多 Agent 并发抢同一条时间线"、不做云端排队、不做无人值守的定时任务（见 §12）。
- 不改 `ask_user` 的问题/选项语义，不改 `[[ask:<id>]]` 回答协议，不改 SSE 事件集。
- 不改模型调用上限（40 次）与工具调用上限（80 次），不改 30 分钟静默看门狗。

---

## 3. 现状基线（已核实事实）

| # | 事实 | 证据 |
|---|---|---|
| F-01 | 一次 Agent 回合 = 一次 `POST /api/video-editing-agent/chat` + 一条 SSE 长连接；每个请求**新建** Agent 实例，无跨回合状态 | `src/app/api/video-editing-agent/chat/route.ts:316-348`、`:543-562` |
| F-02 | `ask_user` 是常驻工具，注册在 `workflow_tools` 类别里 | `src/lib/video-editing-agent/tools/index.ts:456-462` |
| F-03 | `ask_user` 的三条硬约束：单轮一次（`turnState.askedQuestionId`）、确定性 `question_id`、必须"可答"（选项或自由输入） | `tools/askUserTool.ts:19-87`（`:52-60`、`:65-72`、`:73-74`） |
| F-04 | `turnState` 每个请求新建（`turnState: {}`），SSE 重试自然重置"单轮一次" | `agent.ts:101-104`、`types.ts:54-59` |
| F-05 | `awaiting_user` 只是**工具结果**，不挂起流；回合正常结束，答案作为下一条用户消息触发新请求 | `askUserTool.ts:75-85`、`VideoChatWindow.tsx:202-218` |
| F-06 | 提问卡片的"已回答/未回答"完全是只读派生，不写回 `ChatMessage` | `AskUserCard.tsx:1-16`、`askScan.ts:11-42`、`ToolkitToolCard.tsx:144-163` |
| F-07 | 系统提示词的常驻工具段（Layer A）按 `CORE_TOOLKIT_TOOL_NAMES` 从注册表取实时描述渲染，含 `ask_user` | `promptParts.ts:68-94`、`systemPrompt.ts:296-327` |
| F-08 | 工具集授权由 `ToolActivationState` 的 `coreNames` 与 `offer()/canExecute()` 决定，注册表里没有的工具不可能被 offer | `registry/ToolActivationState.ts:25-32`、`:84-94`、`tools/index.ts:495-509` |
| F-09 | 工具箱引导里唯一一句"可以问"的文案在 `AGENT_TOOLKIT_GUIDANCE` 第 5-6 行，被拼进 L0 尾部 | `promptParts.ts:26-49`、`systemPrompt.ts:627` |
| F-10 | L0 提示词有硬上限 `18 900` 字符，既有最坏情形断言 ≤ 18 500，余量约 400–800 字符 | `systemPrompt.ts:346-361`、`__tests__/systemPrompt.toolkit.test.ts` |
| F-11 | 运行期开关（沙箱、小队、自动压缩等）都在 `system_settings` 的 `agent_toolkit` 类别里，布尔键由 `models` 白名单校验、由 YAML + `AGENT_TOOLKIT_DEFAULTS` 播种 | `backend-services/basic-service/config/agent-toolkit-config.yaml:35-40`、`app/services/system_settings_service.py:73-95,166-182`、`app/models/system_settings_models.py:252-287` |
| F-12 | 前端已有成熟的读写通道：`getCategorySettings/updateCategorySettings` → `/api/system-settings/[category]` → FastAPI | `src/lib/api/systemSettings.ts:93,112`、`src/app/api/system-settings/[category]/route.ts` |
| F-13 | 聊天面板工具栏已有一个同款开关（「Agent」），几何为 `h-5 w-9`、旋钮 `h-3.5 w-3.5`、`translate-x-[18px]/[3px]`、`role="switch"` | `VideoChatWindow.tsx:389-409` |
| F-14 | 面板宽度 `clamp(360px, 32%, 520px)`，工具栏左右各有一簇控件，右侧只剩约 90px 余量 | `src/styles/video-editing.css:1352-1383`、`:1430` |
| F-15 | 顶栏 48px，右簇依次为 撤销/重做 │ 分隔线 │ 任务中心 │ AI 助手 │ 导出，左侧有 `flex:1` 弹性占位 | `workbench/EditorTopBar.tsx:157-185`、`src/styles/editor-workbench.css:198-221` |
| F-16 | 回合终止路径：`onComplete`（正常）、`onError`、`cancelled`（停止/超时/断线），全部经 `runAfterQueuedEvents` 串行收口 | `hooks/useAgentExecution.ts:386-461`、`SSEStreamManager.ts:592-598` |
| F-17 | 停止按钮始终可用；整轮撤销按 `timelineTrackPatches` 回滚，单步撤销按 toolCallId | `useAgentExecution.ts:691-745`、`:746-850`、`workbench` 的 `AgentBusyBar` |
| F-18 | 运行中插话（steering）已上线：Enter＝插话、Alt+Enter＝排队；以未回答 `ask_user` 收尾的回合**不会**自动发送排队文本 | `hooks/steeringMachine.ts:48`、`__tests__/useAgentSteering.test.ts:188` |

**由 F-01/F-02/F-08/F-09 得到的唯一正确切面**：YOLO 不是一个 UI 装饰，它必须在**请求 → 工具集 → 提示词**三处同时成立；只在界面上隐藏提问卡片是无效的（模型仍会调用 `ask_user`，回合仍会以提问收尾）。

---

## 4. 技术方案

### 4.1 总览：一个开关贯穿四层

```
┌──────────────────────────── 渲染进程（React） ────────────────────────────┐
│  useAgentYoloMode()             YoloToggle（聊天工具栏）/ ws-chip（顶栏徽标） │
│  ├ 读：autonomyStore → GET /api/system-settings/agent_toolkit → yolo_mode   │
│  ├ 写：PUT（乐观更新 + 失败回滚 + 通知）                                    │
│  └ 供：useAgentExecution({ yolo })  →  请求体 autonomy                      │
│  useYoloAutoContinue()  有界自动续跑（≤1 次，且必须"计划未跑完"）             │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │ POST /api/video-editing-agent/chat
                                    │ { …, autonomy: 'yolo' }
┌───────────────────────────────────▼───────────────────────────────────────┐
│  route.ts：readAutonomy(body) 严格校验 → createVideoEditingAgent({autonomy})│
├───────────────────────────────────────────────────────────────────────────┤
│  createToolRegistry(ctx)：yolo 时不注册 ask_user（类别里也没有）            │
│  buildSystemPrompt({autonomy})：YOLO_DIRECTIVE + 核心工具清单过滤 + 引导替换 │
│  agent.ts：coreNames 不含 ask_user；预算/看门狗/上限一律不变                │
└───────────────────────────────────────────────────────────────────────────┘
```

**为什么不是"给 `ask_user` 加一个 yolo 拦截就完事"**：拦截只能挡住模型"调用"这一种表现，挡不住它在正文里写"要不要我继续？"结束回合；也不能省下 schema 与提示词的 token。四层同时收口，才能同时满足"不问""不停""省预算""可解释"。

### 4.2 开关的归属与持久化

- **归属**：这是一个**全局偏好**（跨项目、跨会话），不是项目属性。理由：它描述的是"我这个人希望 Agent 怎么干活"，而项目数据（`project_data`）会被 `hydrateTimeline`/`repairTimelineData` 当作时间线快照解析（`projects/hydrateTimeline.ts`），塞进去只增加修复面的风险；同时用户在不同项目间的期望不会跳变。
- **存储位置**：复用既有 `system_settings` 类别 `agent_toolkit`（F-11），新增布尔键 `yolo_mode`，出厂 `false`。
  - 该类别已有 `crew_enabled`、`auto_compact` 这类"行为开关"先例，语义一致。
  - `ensure_defaults_seeded` 会把 `AGENT_TOOLKIT_DEFAULTS` 自动映射成 `YAML_TO_DB_MAPPING`（`system_settings_service.py:166-182`），因此只需改 **YAML + 默认字典 + 校验白名单** 三处，**不需要**新类别、不需要动 router 的 `_VALID_CATEGORIES`、不需要任何 DDL。
- **为什么不用 localStorage 一存了事**：需要跨进程可信（Agent 路由在 Next 服务端进程里），并且设置中心本来就应该能看到/管理它；`localStorage` 只用于**首次提示已读**这类纯 UI 记忆。
- **两个入口共用一个模块级 store（评审 P1-3）**：剪辑台工具栏与设置中心「自动化与交互」都会写同一个键，若各自 `useState + GET`，则"改一边另一边同步"不可能成立（两个 hook 实例之间没有任何通道）。因此新增 `src/lib/video-editing-agent/autonomyStore.ts`：一个 `useSyncExternalStore` 可订阅的小 store（`{ enabled, ready }`），**首次订阅才发一次 GET**，写入成功后同步更新本地值并广播；同时派发一个自定义事件供将来的非 React 消费者使用（复用本仓库既有先例 `notifySetupConfigUpdated()` / `ecliptrix-llm-config-updated`）。
  - 这不是"模块级缓存省流量"，而是**唯一真相**：两个入口读同一个对象，就不存在"设置里开了、面板里是关的"。
  - 生命周期：Electron 单进程单用户，store 与页面同寿；登出/多用户不存在（本项目无登录）。
- **`ready` 之前不允许发送 Agent 回合**：`ready === false` 时开关禁用（`aria-busy`），`autonomy` 恒为 `'interactive'`。这样"用户看到的开关值"与"请求体里的 autonomy"永远一致，不会出现"界面显示 YOLO 已开、模型却来提问"的窗口期（评审 P2-02）。
- **为什么不让服务端每回合都回查数据库**：请求体已显式携带 `autonomy`（客户端是唯一调用方，信任模型与 `projectId`/`skillId`/`mentions` 完全一致），多一次后端往返只会拉长首 token 延迟。缺省值明确为 `'interactive'`，**失败即回到旧行为**。此项作为决策 D-04 登记。
  - 已知替代方案（不采用但记录）：`loadCrewSettings` 已有"服务端并行读 `/api/agent-toolkit/capabilities`，2.5s 超时回落默认"的先例（`crewSettingsLoader.ts:14-35`），若将来出现第二个 `/chat` 调用方，就把 `yolo_mode` 挂进该能力响应做服务端兜底；本期只有一个调用方，不为此增加一次往返。

### 4.3 服务端协议：请求字段与严格校验

1. `AgentChatRequest` 增可选字段 `autonomy?: AgentAutonomy`（`'interactive' | 'yolo'`）。
2. `route.ts` 在解析 `body` 之后立刻规范化：

```ts
// route.ts —— 与 readCompositionId 同风格：只认白名单字面量，其余一律丢弃
function readAutonomy(value: unknown): AgentAutonomy {
  return value === 'yolo' ? 'yolo' : 'interactive';
}
```

3. 规范化结果一路透传：`createVideoEditingAgent({ …, autonomy })`。
4. **不做的事**：不认识的值不报错（旧客户端/被改过的客户端一律按互动模式），因为"多问一句"是可接受的降级，"整轮 400"不是。

### 4.4 工具层：YOLO 下 `ask_user` 根本不注册

```ts
// tools/index.ts:456-462 —— 唯一改动点（其余 57 个工具不受影响）
registry.registerToolsForCategory(CATEGORY_IDS.WORKFLOW_TOOLS, [
  createPlanTool(context),
  // YOLO：提问权限整类移除。不是"拦截"而是"不存在"——注册表里没有，
  // offer() 就不会发 schema，explore_tools 也列不出来，load() 会 invalid_tool_selection。
  ...(context.autonomy === 'yolo' ? [] : [createAskUserTool(context)]),
  createCheckTimelineTool(context),
  createSkillTool(context, registry),
]);
```

配套两处（否则会留下"半可用"的缝隙）：

1. **`agent.ts` 的 coreNames**：`CORE_TOOLKIT_TOOL_NAMES` 含 `ask_user`（`promptParts.ts:68-94`）。YOLO 时应从 coreNames 里剔除，避免 `canExecute('ask_user') === true` 却无工具可调用这种自相矛盾：
   ```ts
   const coreNames = [
     ...registry.getAlwaysAvailableTools().map(t => t.name),
     ...CORE_TOOLKIT_TOOL_NAMES.filter(n => autonomy === 'interactive' || n !== 'ask_user'),
     'explore_tools',
   ];
   ```
2. **`formatCoreToolkit` 的缺名处理**：现在找不到名字会打印"(currently unavailable)"存根（`systemPrompt.ts:308-318`）。必须增加一个**可选的**"计划内排除"入参（`exclude?: readonly string[]`，缺省空集），被排除的名字**整段跳过、且不 warn**，否则提示词会自曝"ask_user currently unavailable"，反而诱导模型去猜。保持可选是为了既有单参调用点（`__tests__/systemPrompt.test.ts:213`）零改动。

**为什么不保留一个"YOLO 版 ask_user"返回拒绝信封**：那样 schema 仍在上下文里（约 330 字符/请求），且每次拒绝都要浪费一次工具调用与一轮模型往返；"不存在"比"拒绝"既省又硬。若模型强行编造一个不可见工具名，pi-agent-core 只会产生一次工具错误事件，不改变回合状态。

**技能面**：内置技能不引用 `ask_user`（已核查 `src/lib/video-editing-agent/**` 与后端技能库，无一处），因此 `use_skill` 的预加载不受影响；`ToolActivationState.load()` 对不存在于类别的名字本就抛 `invalid_tool_selection`（`ToolActivationState.ts:50-56`），这是期望行为。

### 4.5 提示词层：从"可以问一次"换成"必须自己决定并跑完"

#### 4.5.1 新增常量（`promptParts.ts`）

```ts
/** YOLO 全自动模式的本轮强制条款（确定性前缀，放在 rules 之后）。 */
export const YOLO_DIRECTIVE = `## YOLO 全自动模式（本轮强制）
- 用户已开启 YOLO：本轮**禁止**向用户提问；ask_user 不在工具集中，不要尝试调用它。
- 每个分叉自行选择最稳妥的默认值，用一行「假设：…」写明依据，然后立刻继续，不要等待确认。
- 遇到失败先降级：换能力、换素材、换路径；同一失败最多重试 1 次，仍失败就记录限制并继续剩余步骤。
- 能力本回合不可用（analysis_disabled、凭据未配置的 409、搜索/研究关闭）时：记下限制、换一条还能走的路径继续；不要停下来建议用户去哪里开启——那是互动模式的做法。
- 3 步以上先 update_plan，全部步骤 completed 才算结束；能批量一次完成的不要拆成多轮。即使没有计划，也要把这条任务收敛到一个可交付的结果。
- 结束前必须自检：check_timeline 无 blocker；再用 check_timeline_overlaps 确认 valid=true，否则 auto_fix_overlaps 直到 valid；视频轨必须最长。
- 最后一条消息只报告「完成 / 未完成 + 关键假设 + 遗留风险」，不得以提问或「要我继续吗」结尾。
- 历史中未回答的提问一律视为作废，自行决定。
- 预算：模型调用 ≤40 次、工具调用 ≤80 次；接近上限时收敛到一个可交付的结果。`;
```

> 评审 P2-05：第 4 条是新加的**优先级条款**——它解决的是既有 `CATEGORY_USAGE_HINTS[ANALYSIS_TOOLS]` 那句"tell the user where to enable it and **stop**"（`promptParts.ts:187-191`）与 YOLO 的直接冲突。YOLO 不改那条 hint（它是互动模式的正确文案，且被既有测试锚定），而是用**更高层、更靠前**的常驻指令声明优先级：模式指令优先于类别提示。
>
> 评审 P2-08：`check_timeline` 只给 blocker 级结论，重叠明细由 `check_timeline_overlaps` 给（`tools/checkOverlaps.ts`），两者不可互换，故指令里分开写。

#### 4.5.2 工具箱引导的模式化（不复制粘贴、不漂移）

`AGENT_TOOLKIT_GUIDANCE` 保持原值（既有测试按字面断言，见 `systemPrompt.toolkit.test.ts:107-114`），新增：

```ts
// 单一来源：把"可以问一次"替换成"不许问，自决并记录假设"。
export const YOLO_TOOLKIT_GUIDANCE = AGENT_TOOLKIT_GUIDANCE.replace(
  'When a missing decision would change the result, call ask_user once instead of\n' +
  'guessing; otherwise pick the sensible default and say what you assumed.',
  'YOLO is on: never ask the user. Pick the most defensible default, state the\n' +
  'assumption in one line, and continue to completion.',
);
```

> 实施提示：`replace` 的锚点必须是**逐字**的两行（含换行）；实施时改成按行匹配（`split('\n')` → 找含 `call ask_user once` 的行 → 替换该行），并在单元测试里断言"替换后不再包含 `call ask_user once`"，避免未来改字导致静默失效。

#### 4.5.3 `buildSystemPrompt` 的输入与顺序

```ts
export interface BuildSystemPromptInput {
  // …既有字段…
  /** 'yolo' 时不渲染 ask_user 段、改用 YOLO 引导与指令。缺省视为互动模式。 */
  autonomy?: AgentAutonomy;
}

const autonomy = input.autonomy ?? 'interactive';
const isYolo = autonomy === 'yolo';

// ⚠️ 示意片段：只表示"指令插在哪、引导怎么切、coreToolkit 传什么"。
// 末尾三行 `if (planDigest) sections.push(...)` 等**必须原样保留**
// （systemPrompt.ts:634-636）。整段替换会静默删掉「当前计划」「长期记忆」
// 「已探索类别」三个区块，而「当前计划」正是自动续跑 C4 的依据之一。
const sections: string[] = [
  role,
  rules,
  ...(isYolo ? [YOLO_DIRECTIVE.trim()] : []),   // 确定性前缀，紧跟规则，先于可变段
  overview,
  coreToolkit,                                    // isYolo 时跳过 ask_user 段
  projectStatus,
  workflowRecipes,
  ...(skillSection ? [skillSection] : []),
  smartHandling,
  hardConstraints,
  (isYolo ? YOLO_TOOLKIT_GUIDANCE : AGENT_TOOLKIT_GUIDANCE).trim(),
  WEB_RESEARCH_GUIDANCE.trim(),
];
// ← 这里原本还有 if (planDigest) / if (memoryDigest) / if (exploredAppendix)
//   三行 push，一行都不能少。
```

> 评审 P2-03：v1 把这个块声明为"照抄即可的契约示意"，但块里没有那三行 `push`。照抄会**静默删掉计划与记忆注入**——不但功能回退，还会让模型看不到当前计划（`scanLatestPlan` 仍能从历史消息扫出计划，但提示词里的 `## 当前计划` 没了，收尾质量下降）。故本节改为"示意片段"并显式标注保留项。

**预算核算（v2 重算：能测的测，不能测的标明是估计）**：

| 项 | 变化 | 量级（v2 重算） |
|---|---|---|
| 移除 `### ask_user` 段（段头 12 + description 238 + 参数行 278 + 空行） | − | **≈ 530**（由 `askUserTool.ts` 的字符串与 `formatParamSignature` 的格式逐字拼出） |
| 新增 `YOLO_DIRECTIVE` | + | **584（已实测，≤ 700 上限）** |
| 工具箱引导替换（`replace` 两行 → 两行） | ± | ≈ +60（估计） |
| 净变化 | | **≈ +115**（v1 写 ≈ +150；无论哪版都远低于 AC-A5 的 +400 上限，余量约 285） |

验收：`isYolo` 的提示词长度 ≤ 互动模式长度 + 400，且 ≤ `L0_PROMPT_CHAR_CEILING`(18 900)；互动模式既有断言（≤ 18 500）**不得放宽**（AC-A5）。实施时必须把**实测**的四个数字（互动长度、YOLO 长度、指令长度、净差）写进实施记录，本表只保证量级正确。

#### 4.5.4 历史里的旧提问

YOLO 回合可能带着"上一轮问了没答"的历史。`messageConverter` 会把 `ask_user` 的 toolResult 原样回放给模型（`messageConverter.ts:29-179`）。处理方式**不加历史裁剪**（裁剪会破坏 assistant/toolResult 配对，风险高于收益），而是靠 `YOLO_DIRECTIVE` 的最后两条把它声明为"作废 + 自决"。理由：这是可解释的行为改变，而不是静默删数据。

### 4.6 客户端：一次有界自动续跑（"不能停"的最后一公里）

即使工具与提示词都到位，仍有一种残余情况：模型把"要我开始吗？"写进正文，回合正常结束，计划还有未完成步骤。纯靠提示词赌它不犯，不足以支撑"中间不能停下来"这个承诺。因此增加**一次**自动续跑，条件严格、可审计、可关闭。

#### 4.6.1 触发时机（评审 P0-1：必须精确到"哪一刻状态是什么"）

**不能用 `onComplete`。** `onComplete` 是在 `finishExecution` 内部、`status === 'finishing'` 期间执行的（`useAgentExecutionState.ts:234` 先写 `finishing`，等回调链结算完才在 `:247` 写终态），而 `agentIsExecuting = isStreamLive || status === 'finishing'`（`useAgentExecution.ts:259`），`sendAgentMessage` 的第一行是 `if (sendingRef.current || agentIsExecutingRef.current) return;`（`:537`）——**在 `onComplete` 里发消息会被静默丢掉，没有异常、没有返回值、没有日志**。若按 v1 的写法实施，B4 整批功能会"看着正常但从不触发"。

唯一可用的触发点是**执行态的空闲边沿**：`agentIsExecuting` 由 `true` 变 `false`，此刻 `executionState.status` 已落到 `completed | error | cancelled | idle`（`finishExecution` 在 `:247` 写入）。

这个边沿已存在使用者：`useAgentExecutionSteering.ts:85-93` 用它做"回合结束"决策（自动发送排队文本 / 回填输入框）。YOLO 复用它，但**不是再加一个各自为政的 effect**，而是让 `useAgentExecution` 在该边沿上**先同步采样一个回合结束事实**，再把它交给所有关心者（含 steering 与 YOLO），顺序由采样点保证，不由 hook 注册顺序保证。

#### 4.6.2 回合结束事实（`LastAgentTurnEnd`）

```ts
// 在既有 turn-end edge 上同步采样，先于任何发送动作；作为
// useAgentExecution 返回值的新字段 lastTurnEnd 暴露（契约见 §6.4）。
export interface LastAgentTurnEnd {
  /** 本次回合发起时快照的自主模式（请求体里发出去的那个值）。 */
  autonomy: AgentAutonomy;
  /** 终态：只有 completed 才算"正常结束"。 */
  reason: 'completed' | 'cancelled' | 'error';
  /**
   * 15s finishing 看门狗是否接管了本回合的收尾（`onFinishingTimeout`）。
   * 看门狗触发后 status 仍会写 `completed`，所以 reason 单独不足以排除它——
   * 事件链没排干就续跑，可能把同一次编辑写两遍。
   */
  finishingTimedOut: boolean;
  /** 采样时刻该回合是否有过插话或排队文本（在 onTurnEnd drain 之前取值）。 */
  steeredOrQueued: boolean;
  /** steering 是否已因排队文本自行发起了下一轮（唯一发送者仲裁用）。 */
  followUpSent: boolean;
  /** 本回合是否以未回答的 ask_user 收尾（YOLO 下应恒为 false）。 */
  endedWithAskUser: boolean;
  /** 绑定会话，防止切换会话后对着新会话求值。 */
  conversationId: string | null;
  /** 单调递增，用于"这条事实是否已被处理/是否已被新一轮覆盖"。 */
  turnSeq: number;
}
```

#### 4.6.3 触发条件

```
全部成立才续跑（逐条可机检，见 AC-C6）：
  C1. lastTurnEnd.autonomy === 'yolo'
  C2. lastTurnEnd.reason === 'completed' && lastTurnEnd.finishingTimedOut === false
      （cancelled / error / finishingTimeout 都不续跑：停止与失败是用户的意图，
        不是需要客户端弥补的疏忽；看门狗触发时事件链没排干，续跑可能把
        同一次编辑写两遍）
  C3. steeredOrQueued === false && followUpSent === false
      （用户在管，别抢方向盘；后半个条件即"唯一发送者"仲裁）
  C4. lastTurnEnd.conversationId === 当前 activeConversationId，且该会话最后一条消息是
      本回合刚写完的 agent 消息；其计划（scanLatestPlan）至少还有 1 个非 completed 步骤
  C5. 本"用户回合链"内自动续跑次数 < 1（计数器与会话绑定；切换会话时挂起而不是清零）
动作：sendAgentMessage(YOLO_CONTINUE_PROMPT, { automatic: 'yolo_continue' })
      该条用户消息 metadata.type = 'yolo_continue'（时间线渲染"YOLO 自动继续"
      小标记，绝不假装是用户打的字）
重置：用户自己发任何消息 → 计数清零；YOLO 关闭 → 计数清零并取消待发
```

#### 4.6.4 唯一发送者仲裁（评审 P1-1）

同一个回合结束边沿上**已经存在**一个会发消息的角色：`steering.onTurnEnd`（`steeringMachine.ts:175-190`）在 `reason === 'completed' && !endedWithAskUser` 且队列里有文本时，会**自己**把排队文本作为下一轮发出（出口 `sendFollowUp` → `sendAgentMessage`，`useAgentExecution.ts:277`）。若 YOLO 也在同一刻发，有两种后果，都不可接受：

- 后发的一方被 `sendingRef` 静默丢掉——若丢掉的是**用户排队的那句话**，就是丢用户输入；
- 反过来若 effect 顺序变化，一次回合结束会变成"用户的话 + 一句废话"两轮，费用翻倍。

因此规则写死，**不依赖 effect 注册顺序**：

1. 采样事实时就把"steering 是否会发"固化为 `followUpSent`，与 `steeredOrQueued` 一样在 `onTurnEnd` **之前**取值（`onTurnEnd` 会先把 `notes` 降级进队列再把 `queued` 清空——`steeringMachine.ts:178-182`，之后再读就永远是"没排队"）；
2. `followUpSent === true` → **YOLO 一律不续跑**（用户的话更值钱，且它本身就是"继续"）；
3. 发送前再校验一次事实没有被新一轮覆盖（`conversationId` 与 `turnSeq` 一致），不一致就放弃而不是重试；
4. 明令禁止把 `sendAgentMessage` 的静默 guard 当仲裁机制——那只是故障现象，不是设计。

#### 4.6.5 落地

- 常量与纯函数放新文件 `src/lib/video-editing-agent/yoloAutonomy.ts`（纯函数，可单测）：
  `YOLO_CONTINUE_LIMIT = 1`、`YOLO_CONTINUE_PROMPT = '继续：把计划里剩下的步骤自己做完，不要提问；只报告结果与假设。'`、`shouldAutoContinue(input): boolean`（入参＝`LastAgentTurnEnd` + 计划 + 已续跑次数）。
- hook `src/components/video/hooks/useYoloAutoContinue.ts`，由 `VideoEditingInterface` 调用一次（不给已经 855 行的 `useAgentExecution.ts` 继续加体重）。
- 实现要求：`useEffect` 观察 **`lastTurnEnd` 的引用/turnSeq 变化**（每次回合结束都是一个新事实），而不是观察 `agentIsExecuting` 的布尔跳变——前者天然幂等，后者会被任何一次重渲染重复触发。
- **为什么上限是 1**：自动续跑本质是"替用户按下回车"，每多一次都是不可预测的费用与时间；1 次足以覆盖"忘记收尾"这一类真实故障，又不可能形成无人监督的循环。
- **它不做什么（防止越权）**：不自动停止、不自动导出、不改开关、`error` 后不重试、用户插话后不追加。它只做一件事：把"继续"按一次。

### 4.7 其余"停下来"的出口逐项处置

| # | 停下来的方式 | YOLO 下的处置 | 依据 |
|---|---|---|---|
| E1 | `ask_user` 提问 | 工具不存在 + 提示词禁令 | §4.4、§4.5 |
| E2 | 正文反问 "要不要我…？" 并结束回合 | 提示词禁令 + 一次自动续跑（空闲边沿触发；若用户排队过文本则由 steering 发，YOLO 让位） | §4.6 |
| E3 | 工具返回 `success:false`（素材不足/生成失败/凭据 409） | 提示词要求降级换路径、最多重试 1 次后记录限制继续；不弹任何问题 | §4.5.1 |
| E4 | `run_analysis` 关闭（`analysis_disabled`） | 既有引导写的是"告诉用户在哪里开启并停止"，与 YOLO 直接冲突：**由 `YOLO_DIRECTIVE` 第 4 条声明优先级**（模式指令优先于类别提示）——记录限制、换路径继续，不停下来引导用户去开启 | `promptParts.ts:187-191`（`CATEGORY_USAGE_HINTS[CATEGORY_IDS.ANALYSIS_TOOLS]`）+ §4.5.1 第 4 条 |
| E5 | 连续 5 次工具失败触发熔断 | **保持**（这是防雪崩，不是提问）。回合以 `tool_failures` 错误收尾，界面照旧；不自动重试 | `agent.ts:509-553` |
| E6 | 模型 40 次 / 工具 80 次上限 | **保持**。提示词要求"接近上限时收敛"；超限以 `model_call_limit`/`tool_call_limit` 报错，不自动续跑（C2 不成立） | `agent.ts:182`、`tools/index.ts:505` |
| E7 | 30 分钟静默看门狗 | **保持**（网络卡死必须能被切断） | `AGENT_IDLE_TIMEOUT_MS` |
| E8 | 上下文溢出 | **保持**自动重试（`retryOnContextOverflow`），不需要人 | `agent.ts:207-224` |
| E9 | 导出预检（`ExportPreflightSheet`） | 属于**用户手动的导出动作**，不在 Agent 回合内；YOLO 不绕过、不自动导出 | `workbench/ExportPreflightSheet.tsx` |
| E10 | 停止按钮 | **永远可用**，是 YOLO 唯一的人工出口，不允许禁用 | `AgentBusyBar` |
| E11 | 封面作业 `queued/draft_ready` | 客户端自动接力（既有 `CoverAgentBridge`），无需提问 | `useCoverController` |
| E12 | 研究小队成员失败 | 既有成员状态机（`partial/failed/timeout`）已定义降级，提示词要求汇报而非询问 | `crew/*` |

### 4.8 一次 YOLO 回合的完整时序

```
用户点 YOLO（开）→ useAgentYoloMode：乐观置 true，PUT {settings:{yolo_mode:true}}
   ↓ 失败？回滚为 false + 通知（AC-C2），不发请求
用户输入"做一条 60 秒 AI 资讯视频"
   ↓ handleSendChatMessage → agent.sendAgentMessage（开关值随请求快照）
POST /api/video-editing-agent/chat  { messages, timelineState, materials, autonomy:'yolo' }
   ↓ route：readAutonomy → 'yolo'
   ↓ createVideoEditingAgent：注册表无 ask_user；coreNames 无 ask_user
   ↓ buildSystemPrompt：YOLO_DIRECTIVE + YOLO_TOOLKIT_GUIDANCE + 无 ask_user 段
SSE：run_started → thinking → tool_call/tool_result × N → text_delta → agent_end
   ↓ 计划（update_plan）随回合推进；忙碌条显示步骤与 YOLO 标记
finishing（落盘最终消息 + timelineTrackPatches，这些都在 onComplete 的回调链里）
   ↓ status 落定后 agentIsExecuting 由 true→false（唯一的"回合结束"边沿）
采样 LastAgentTurnEnd { autonomy, reason, steeredOrQueued, followUpSent, ... }
   ├ steering.onTurnEnd 先跑：有排队文本就在这一步发出（followUpSent=true）
   └ useYoloAutoContinue 判定（C1..C5，读同一份事实）
        ├ 计划未完 + 无插话 + 未续跑过 + 正常完成 → 发送"继续…"
        │   （metadata.type='yolo_continue'，时间线显示"YOLO 自动继续"）
        └ 否则停在"已完成/未完成"的报告上，用户可撤销或继续
```

### 4.9 UI / UX 设计

#### 4.9.1 位置与几何（"和当前界面统一"的硬要求）

- **主开关**：聊天面板工具栏右侧簇，紧跟既有「Agent」开关，前置 1px 分隔线：`Agent [○] │ YOLO [○]`。
  - 几何**逐像素复用**相邻开关：外层 `h-5 w-9 rounded-full`，旋钮 `h-3.5 w-3.5 rounded-full bg-white shadow-sm`，位移 `translate-x-[18px]/[3px]`（F-13）。
  - 面板宽 360–520px（F-14）：左簇两个 36×36 图标（80px）+ 右簇 `Agent` 标签+开关（约 77px）+ 分隔线（9px）+ `YOLO` 标签+开关（约 72px）≈ 238px，在 360px 面板（内边距 16px×2 → 328px 可用）下仍余 90px，**不会换行**。
  - **标签排版复用相邻开关（评审 P2-09）**：`text-xs font-medium text-muted-foreground dark:text-zinc-400`，与「Agent」标签**同字号同字重**；`YOLO` 四字母按 `tracking-[0.06em]` 轻微加宽即与 `Agent` 视觉等重。v1 写的 `text-[10px] font-semibold tracking-[0.08em]` 会让同一工具栏出现两套标签排版，与"和当前界面统一"的硬要求相冲突，已改。
- **顶栏徽标**：`EditorTopBar` 右簇、AI 助手按钮之前插入 YOLO 徽标（F-15）。因为左侧已有 `flex:1` 弹性占位，徽标出现/消失只压缩占位，**左侧项目名等信息不会跳动**。
  - **复用既有类，不新建视觉岛（评审 P2-01）**：`<span className="ws-chip ws-chip--warn" …>YOLO</span>`。`editor-workbench.css:400-416` 已定义 `.ws-chip`（inline-flex / 20px 高 / 12px 字）与 `.ws-chip--warn`（`--ws-warn: #E3A33B` + `--ws-warn-bg`，**浅深两套已分别定义**），`BackupChip` 就是这么用的（`EditorTopBar.tsx:87`）。因此**本方案不需要在 `editor-workbench.css` 里新增任何一行**；`--ws-warn` 与聊天面板的 Tailwind `amber-*` 是同一语义色系，两处观感一致。
  - 只读：不可点击（顶栏 48px 已拥挤，避免误触），`title` 说明"在 AI 面板工具栏切换"；窄窗口用 `ws-hide-narrow` 隐藏，状态在面板内仍可见。
- **忙碌条标记**：`AgentBusyBar` 在最左侧渲染 `YOLO` 小徽标（同一色系），让"为什么不问我"在运行中也是自解释的。

#### 4.9.2 视觉语汇（为什么是琥珀）

- 开态：`bg-amber-500 border-amber-600/70`，外加 `shadow-[0_0_0_3px_rgba(245,158,11,0.12)]` 的柔和光环；关态沿用既有中性色 `bg-border dark:bg-zinc-600`。
- 选琥珀不选红：红在本产品里是**错误/危险**语义（导出失败、工具失败），YOLO 是"已武装的自主性"而非故障；琥珀在既有界面里已经用于"收尾中"提示条（`VideoChatWindow.tsx:424-439` 的 `amber-50/amber-700`），语义一脉相承且深浅两色都已验证可读。
- 动效：只做 `transition-colors` + 旋钮 `transition-transform`，150ms，并显式加 `motion-reduce:transition-none`（减少动态偏好下瞬时切换）；不做弹跳、不做脉冲（脉冲只留给"正在发生"的忙碌态）。

#### 4.9.3 状态机与文案（五种状态，缺一不可）

| 状态 | 判定 | 视觉 | 文案（zh / en） |
|---|---|---|---|
| 可用-关 | agent 开、YOLO 关、未运行、已加载 | 中性轨道，标签 muted | title：`全自动模式已关闭：遇到不确定会向你提问` / `YOLO off: the agent will ask you when a decision changes the result` |
| 可用-开 | agent 开、YOLO 开、未运行 | 琥珀轨道 + 光环 + 标签 `text-amber-700 dark:text-amber-300` | title：`YOLO 已开启：AI 自行决策并跑完全程，不会向你提问` / `YOLO on: the agent decides everything and runs to the end` |
| 禁用-非 Agent 模式 | `agentMode === false` | 60% 不透明，仍可见（可发现性） | title：`先打开 Agent 模式` / `Turn on Agent mode first` |
| 禁用-执行中 | `agentIsExecuting` | 60% 不透明 + 保持开/关原色 | title：`执行中不可切换，结束或停止后可切换` / `Cannot switch while running; stop or wait for this turn` |
| **禁用-尚未加载**（评审 P2-02） | `ready === false`（首次 GET 未回） | 60% 不透明、`aria-busy="true"` | title：`正在读取全自动模式设置…` / `Loading the YOLO preference…` |

> 评审 P2-02：v1 写的是"`ready=false` 时按关渲染但可点，点击会先加载再切换"——一次点击产生两跳（先 GET 再 PUT），用户会看到自己没按过的值翻转，且期间"界面显示的开/关"与"请求体里的 `autonomy`"可能不一致。改为**加载完成前禁用**：面板挂载即发起 GET，用户开始打字时早已 `ready`，感知成本为零，换来"开关所见 = 请求所发"的不变式。

无障碍：`role="switch"`、`aria-checked`、`aria-label`（含当前态）、`aria-describedby` 指向 title 文本（隐藏 span）；焦点环 `focus-visible:outline-2 outline-offset-2 outline-amber-500`；`Space/Enter` 原生可用；不依赖颜色单独表意（开态同时改变旋钮位移 + 标签加粗 + aria-checked）。

#### 4.9.4 首次开启的一次性说明（不做打扰式弹窗）

- 开启瞬间在忙碌条位置插入 `YoloNotice`：22px 高、琥珀色淡底、一句 `YOLO 已开启：本轮全自动执行，可随时点停止`，右侧「知道了」按钮，8 秒后自动消失。
- 已读标记写 `localStorage['ecliptrix:yolo-notice-v1'] = '1'`；之后只在 title 里解释，不再出现。
- 为什么不是 `ConfirmationDialog`：这是一个**随时可逆、且不影响数据安全**的模式开关，用模态确认会制造"危险操作"的错误暗示，也打断"打开面板→立刻发任务"的连招；一句话行内说明 + 可随时停止，才是这一档风险的正确成本。

#### 4.9.5 设置中心（第二入口，非必需但应有）

- 新增小节「自动化与交互」放在 Agent 能力页（`AgentToolkitSettingsPanel`）靠前位置，复用 `SettingsFieldHelpers.SwitchField`（label + description + 保存反馈），保存走**只发改动键**的批量接口 `{settings:{yolo_mode}}`。
- 说明文案：`开启后 Agent 不再向你提问，自行决定并跑完整个剪辑流程；剪辑台工具栏也可随时切换。`
- 该小节实现为**新文件** `src/components/settings/components/AgentAutonomySection.tsx`，宿主文件只加一行渲染与一行 import。`AgentToolkitSettingsPanel.tsx` 实测 **818 行**（不是 v1 写的 876），已越过 800 行线，因此按 `agent-steering-and-skills` AC-G2 的棘轮规则"基线已超线者不得增长"，宿主行数必须在同一 PR 内**用等量删减抵掉**（把 `import` 与一行渲染压进既有 import 块/既有区块，或就近抽一小段进 `AgentAutonomySection`），净增 = 0。先例：上一轮把 crew/memory 三个分区整段抽成 `AgentCrewMemorySections.tsx`（52 行）后宿主净减 80 行——这才是本仓库认可的扩张方式。

#### 4.9.6 双语与文案长度

- `i18n.ts` 三处同步：类型接口（`videoChatWindow` 段，`i18n.ts:2642-2681` 附近）、英文对象（`6636` 附近）、中文对象（`10700` 附近）。
- 英文标签同样是 `YOLO`（品牌词不翻译），说明句控制在 ≤ 96 字符以免撑破 title 与设置行；`tracking-[0.08em]` 已保证 4 个字母与相邻 `Agent` 标签视觉等重。

### 4.10 与既有机制的交互

| 机制 | 交互结论 |
|---|---|
| **Steering（插话）** | 不变，且**反向优先**：YOLO 下用户仍可插话纠正；一旦本回合有过插话或排队文本，自动续跑放弃（C3）。排队文本由既有的 `onTurnEnd` 自动发出（`steeringMachine.ts:183-188`），YOLO 让位并计入 `followUpSent`，同一回合结束**最多只有一个发送者**（§4.6.4）。 |
| **回合结束边沿** | 复用既有的 `agentIsExecuting` true→false 边沿；YOLO 读的是同一份 `LastAgentTurnEnd` 事实，不新增第二个各自为政的 effect（§4.6.1）。 |
| **Plan（update_plan）** | 不变，且成为自动续跑的唯一客观依据（C4）。YOLO 不新增计划工具。 |
| **Skills（use_skill）** | 不变；内置技能不含 `ask_user`，预加载不受影响。 |
| **会话记忆 / 压缩** | 不变；`yolo_continue` 是与普通用户消息等价的文本，压缩照旧处理。 |
| **SSE 重试** | 不变。重试 = 新请求 = 同一 `autonomy`（请求体不变），`turnState` 归零（F-04），因此"单轮一次提问"的语义在互动模式下也照旧。 |
| **停止 / 撤销** | 不变。停止后不自动续跑（C2 不成立）；撤销按 track patches 精确回滚。 |
| **导出预检** | 不变。YOLO 不会自动导出，也不会跳过任何 advisory。 |
| **普通聊天（非 Agent）** | 不涉及；开关置灰（S3）。 |
| **其它 AI 弹窗**（脚本生成/剪口/封面） | 不涉及：它们是人主动打开的模态，不是 Agent 回合。 |

---

## 5. 文件 / 模块变更计划

> 说明：**本节点只产出本文档，不改任何源码**。下表是下游实施节点的清单；"新增"= 新文件，"改"= 既有文件。"行数"列为预估新增/净增，用于守住棘轮纪律（既有 >800 行的文件不得增长，`i18n.ts` 作为数据文件豁免并注明）。

### 5.1 后端（`backend-services/basic-service/`）

| 文件 | 动作 | 意图 | 行数 |
|---|---|---|---|
| `config/agent-toolkit-config.yaml` | 改 | 在 `auto_compact_ratio` 后增加 `yolo_mode: false` 与一行注释（出厂关闭） | +2 |
| `app/services/system_settings_service.py` | 改 | `AGENT_TOOLKIT_DEFAULTS` 增加 `"yolo_mode": False`（`YAML_TO_DB_MAPPING` 自动派生，无需另改） | +1 |
| `app/models/system_settings_models.py` | 改 | `agent_toolkit` 的 `booleans` 白名单加入 `yolo_mode`（`StrictBool` 校验） | +1 |
| `tests/test_agent_toolkit_settings_yolo.py` | **新增** | YOLO 专属用例：播种默认 false / 布尔写入 / 非布尔 422 / 未知键仍报错 | ≈ 55 |

> 评审 P2-07：v1 命名 `test_system_settings_agent_yolo.py` 与套件约定不一致——本类别既有测试叫 `test_agent_toolkit_settings.py`（138 行），且它已经写了 `set(payload["agent_toolkit"]) == set(AGENT_TOOLKIT_DEFAULTS)` 的 YAML 对账，**新键会被它自动覆盖**。因此：既有文件**不动**（它会因多出 `yolo_mode` 而自动通过，若变红说明 YAML 与默认字典不同步），YOLO 专属断言放同前缀新文件。后端没有"≤800 行"以外的行数纪律，55 行无风险。

### 5.2 前端 / Next 服务端（`src/`）

| 文件 | 动作 | 意图 | 行数 |
|---|---|---|---|
| `src/lib/video-editing-agent/types.ts` | 改 | 新增 `AgentAutonomy`；`ToolContext.autonomy`；`AgentChatRequest.autonomy`；`VideoEditingAgentConfig.autonomy`；`LastAgentTurnEnd` | +16 |
| `src/lib/video-editing-agent/promptParts.ts` | 改 | 新增 `YOLO_DIRECTIVE`、`YOLO_TOOLKIT_GUIDANCE`（按行替换，单一来源） | ≈ +26 |
| `src/lib/video-editing-agent/systemPrompt.ts` | 改 | `BuildSystemPromptInput.autonomy`；`formatCoreToolkit(registry, { exclude })`（第二参可选，缺省不排除）；sections 顺序插入指令；切换引导 | +14 |
| `src/lib/video-editing-agent/agent.ts` | 改 | 透传 `autonomy`；coreNames 剔除 `ask_user`；构建提示词时传入 | +9 |
| `src/lib/video-editing-agent/tools/index.ts` | 改 | YOLO 时不注册 `ask_user` | +2 |
| `src/lib/video-editing-agent/yoloAutonomy.ts` | **新增** | 纯函数：`YOLO_CONTINUE_PROMPT`、`YOLO_CONTINUE_LIMIT`、`shouldAutoContinue()`（入参 `LastAgentTurnEnd` + 计划 + 已续跑次数） | ≈ 70 |
| `src/lib/video-editing-agent/autonomyStore.ts` | **新增** | 模块级 store（`useSyncExternalStore`）：`getYoloMode()/subscribeYoloMode()/loadOnce()/setYoloMode()` + 更新事件；两个入口共用的唯一真相 | ≈ 60 |
| `src/app/api/video-editing-agent/chat/route.ts` | 改 | `readAutonomy()` 校验 + 传给 `createVideoEditingAgent` | +8（基线 748 → ≤ 756） |
| `src/components/video/hooks/useAgentYoloMode.ts` | **新增** | 读 store；`toggle()` 乐观更新 + 失败回滚 + 通知；`ready`、`saving` | ≈ 70 |
| `src/components/video/hooks/useYoloAutoContinue.ts` | **新增** | 有界自动续跑：读 `lastTurnEnd`，条件 C1–C5，ref 计数器绑定会话 | ≈ 85 |
| `src/components/video/hooks/useAgentExecutionSteering.ts` | 改 | 在既有 turn-end edge 上**先采样** `LastAgentTurnEnd`（`steeredOrQueued`/`followUpSent` 必须在 `onTurnEnd` 之前取）并暴露在返回值里 | +14（基线 121） |
| `src/components/video/hooks/useAgentExecution.ts` | 改 | `params.yolo`；请求体 `autonomy`；`SendAgentMessageOptions.automatic`;转发 `lastTurnEnd`；`yolo_continue` 元数据 | **净增 ≤ 0**（基线 855，已超线，见下） |
| `src/components/video/components/VideoChatWindow/YoloToggle.tsx` | **新增** | 开关本体（几何/配色/五种状态/无障碍/提示） | ≈ 85 |
| `src/components/video/components/VideoChatWindow/YoloNotice.tsx` | **新增** | 首次开启的一次性行内说明（8s 自动消失 + 已读标记） | ≈ 45 |
| `src/components/video/components/VideoChatWindow/VideoChatWindow.tsx` | 改 | 工具栏渲染 `YoloToggle` + 分隔线；`props` 增 `yolo/onYoloChange/ready`；`YoloNotice` 挂载 | +14（基线 658） |
| `src/components/video/components/VideoChatWindow/AgentBusyBar.tsx` | 改 | 新增 `yolo?: boolean`，渲染 `YOLO` 小徽标 | +8（基线 117） |
| `src/components/video/components/VideoChatWindow/timeline/types.ts` | 改 | `UserMessageNodeData.automaticLabel?: string` | +3（基线 152） |
| `src/components/video/components/VideoChatWindow/timeline/utils.ts` | 改 | 从 `metadata.type === 'yolo_continue'` 派生标记 | +4（基线 308） |
| `src/components/video/components/VideoChatWindow/timeline/UserMessageNode.tsx` | 改 | 渲染"YOLO 自动继续"小标记 | +8（基线 60） |
| `src/components/video/workbench/EditorTopBar.tsx` | 改 | `isYoloArmed?: boolean` + 右簇 `ws-chip ws-chip--warn` 徽标 | +9（基线 189） |
| `src/styles/editor-workbench.css` | **不改** | 复用既有 `.ws-chip--warn`（评审 P2-01） | **+0** |
| `src/components/video/VideoEditingInterface.tsx` | 改 | 调 `useAgentYoloMode` / `useYoloAutoContinue`；透传 `useAgentExecution({yolo})`、`chatProps`、`topBar` | **净增 ≤ 0**（基线 2471，已超线） |
| `src/components/settings/components/AgentAutonomySection.tsx` | **新增** | 设置中心小节（复用 `SwitchField`，只发改动键） | ≈ 65 |
| `src/components/settings/AgentToolkitSettingsPanel.tsx` | 改 | 挂载该小节 | **净增 = 0**（基线 818，已超线） |
| `src/types/index.ts` | 改 | `ChatMessage.metadata.type` 联合类型追加 `'yolo_continue'`——**改既有行，不新增行** | **净增 0**（基线 1002，已超线） |
| `src/lib/i18n.ts` | 改 | 类型 + en + zh：`videoChatWindow.yolo*`（11 个键）、`settings.agentAutonomy.*`（3 个键） | +33（数据文件豁免） |

#### 5.2.1 行数基线实测与棘轮（评审 P1-2，替换 v1 的一串未实测数字）

规则沿用 `agent-steering-and-skills` AC-G2（本仓库两次评审确立）：**① 新建文件与基线 ≤ 800 行的文件，改后 ≤ 800；② 基线已 > 800 行的文件行数不得增长；做不到的必须在实施记录登记债务与理由，不得静默超线；③ `src/lib/i18n.ts` 是单一翻译数据文件，豁免行数规则但新增键必须成块、en/zh 对称；④ 函数 ≤ 50 行、参数 ≤ 5。**

| 文件 | 实测基线（`wc -l`） | v2 预算 | 做法（写死，不留"看着办"） |
|---|---|---|---|
| `src/components/video/hooks/useAgentExecution.ts` | **855** | 净增 ≤ 0 | 采样逻辑落在 `useAgentExecutionSteering`（+14 那里）；本文件只加 `params.yolo` 类型（1 行）、请求体 `autonomy`（1 行）、`automatic` 选项与 `metadata`（3 行）、返回值转发（1 行）≈ +6，须在同文件内删掉或抽出等量 6 行（首选把 `describeStreamError`/`notifyAgentError` 附近的内联 helper 抽成 `agentErrorCopy.ts`）。抽不出就登记债务。 |
| `src/components/video/VideoEditingInterface.tsx` | **2471** | 净增 ≤ 0 | 两次 hook 调用 + 三处属性透传 ≈ +8；同文件内删掉等量行（该文件已有多个可抽的小内联块），或把 topBar 的 props 组装抽成 `workbench/topBarProps.ts`。**不允许"只加不减"**。 |
| `src/components/settings/AgentToolkitSettingsPanel.tsx` | **818** | 净增 = 0 | import 挤进既有 import 块、渲染行替换既有子元素；做不到就把一处内联块搬进 `AgentAutonomySection`。先例：上一轮抽 `AgentCrewMemorySections.tsx` 后宿主净减 80。 |
| `src/types/index.ts` | **1002** | 净增 = 0 | 只**改**既有那行联合类型（`type?: 'intent_detection' \| 'intent_result' \| 'compaction' \| 'yolo_continue';`，79 列，仍 ≤ 80），不新增 import、不新增行。**不要**走"`declare module` 增强"那条路：接口合并只能**新增成员**，无法拓宽既有成员的联合类型（`agent-steering-and-skills` 里那次增强是加字段，不是加字面量），硬走会编译失败。 |
| `src/lib/i18n.ts` | 11973 | +33（豁免） | 数据文件，理由同既往两轮；新增键成块、en/zh 对称。 |
| 其余改动/新增文件 | 均 ≤ 800 或未超线 | 按上表 | `chat/route.ts` 748 → ≤ 756；`VideoChatWindow.tsx` 658 → ≤ 672；其余都在 500 行以内或为新增。 |

> 实施首步（照抄进实施记录）：`git ls-files` 逐文件 `wc -l` 记录**开工前**基线，收尾再跑一次，把对比表写进实施记录。基线数字以那次实测为准，上表是 v2 评审时的实测快照。

### 5.3 测试（新增 + 必须同步修改）

| 文件 | 动作 | 覆盖 |
|---|---|---|
| `src/lib/video-editing-agent/__tests__/yoloAutonomy.test.ts` | 新增 | `shouldAutoContinue` 全真值表（C1–C5，含 `steeredOrQueued`/`followUpSent`/会话不匹配三种否决） |
| `src/lib/video-editing-agent/__tests__/toolkitTools.yolo.test.ts` | 新增 | YOLO 注册表无 `ask_user`；`workflow_tools` 只剩 3 个；互动模式仍为 4 个 |
| `src/lib/video-editing-agent/__tests__/systemPrompt.yolo.test.ts` | 新增 | 指令存在（逐条断言 §6.5 的五类断言）、`### ask_user` 段不存在、引导已替换、指令 ≤ 700 字符、长度上限 |
| `src/lib/video-editing-agent/__tests__/agent.yolo.test.ts` | 新增 | coreNames 与提示词一致；YOLO 下 offer 的工具名集合不含 `ask_user` |
| `src/lib/video-editing-agent/__tests__/autonomyStore.test.ts` | 新增 | **评审 P1-3**：同一 store 的两次订阅读到同一个值；`setYoloMode` 成功后所有订阅者立刻看到新值；并发 `loadOnce()` 只发一次 GET |
| `src/components/video/hooks/__tests__/useAgentYoloMode.test.tsx` | 新增 | 加载/切换/失败回滚/通知/`ready`；`ready===false` 时开关禁用且 `toggle` 不写 |
| `src/components/video/hooks/__tests__/useYoloAutoContinue.test.ts` | 新增 | **评审 P0-1/P1-1**：`agentIsExecuting` 仍在 `finishing` 时不发送；落回空闲且 `completed` 才发送恰一次；`followUpSent` 时不发送；停止/错误/插话/计划已完成/非 YOLO 各 0 次；同一 `lastTurnEnd` 重复渲染不重复发送；新用户消息后计数重置 |
| `src/components/video/hooks/__tests__/useAgentExecution.yolo.test.ts` | 新增 | 请求体带 `autonomy:'yolo'`；自动续跑消息带 `metadata.type`；`lastTurnEnd` 的 `steeredOrQueued` 在 `onTurnEnd` drain 之后仍为真（回归 P1-1） |
| `src/components/video/components/VideoChatWindow/__tests__/YoloToggle.test.tsx` | 新增 | 五种状态（含"尚未加载"）、aria、键盘、禁用原因 |
| `src/components/video/components/VideoChatWindow/__tests__/YoloNotice.test.tsx` | 新增 | 只出现一次、可关闭、自动消失 |
| `src/components/video/workbench/__tests__/EditorTopBar.yolo.test.tsx` | 新增 | 徽标出现/消失不改变左侧内容；徽标类名是 `ws-chip ws-chip--warn`（防回退成新类） |
| `src/lib/__tests__/i18nYolo.test.ts` | 新增 | en/zh 键齐、无空串 |
| `src/lib/video-editing-agent/__tests__/askUserTool.test.ts` | **保持绿 + 补用例** | 既有断言一字不改；新增一条"YOLO 上下文的注册表拿不到该工具" |
| `src/lib/video-editing-agent/__tests__/toolkitTools.test.ts` | **保持绿 + 补用例** | `makeContext()` 不带 `autonomy` ⇒ 默认互动 ⇒ `:155-179` 的 `ask_user` 断言必须继续绿；新增 YOLO 分支用例 |
| `src/lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts` | **保持绿 + 补用例** | `:82-94`（`### ask_user` 恰好一次、常量 18 项）与 `:238-246`（`workflow_tools` 四项）在默认路径下必须继续绿；新增 YOLO 用例断言相反事实 |

---

## 6. 接口设计

### 6.1 HTTP：设置读写（复用既有端点，无新增路由）

**读**（编辑器挂载时一次；也可在设置中心复用）

```http
GET /api/system-settings/agent_toolkit
→ 200 {
  "success": true,
  "category": "agent_toolkit",
  "settings": [
    { "key": "yolo_mode", "value": false, "default_value": false,
      "value_type": "scalar", "description": "全自动模式（YOLO）：开启后 Agent 不再提问，自行决定并跑完整个流程",
      "updated_at": "…", "updated_by": "local-owner" }
    // …其余既有键…
  ]
}
```

**写**（只发改动键，服务端按键合并，未提供的键保持原值）

```http
PUT /api/system-settings/agent_toolkit
Content-Type: application/json

{ "settings": { "yolo_mode": true } }

→ 200 { "success": true, "message": "Updated 1 settings in agent_toolkit", "settings": [ … ] }
```

错误（**按实测契约写**，评审 P2-04）：

| 场景 | 状态码 | 体 |
|---|---|---|
| `yolo_mode` 不是严格布尔（如 `"yes"`、`1`） | 422 | `{"detail":{"category":"agent_toolkit","errors":[{"msg":"…"}]}}`（`system_settings_router.py:266-283`；**没有 `key` 字段**） |
| 未知类别 | 404 | `{"detail":"Unknown settings category: …"}` |
| 未知键（不在白名单） | 422 | 同上 422 形状，`errors[0].msg === "unknown_toolkit_setting"` |

> 契约要点：
> 1. `StrictBool` 不接受 `1/0`（后端 `pydantic.StrictBool`），因此前端**必须**发 JSON 布尔；`autonomyStore.setYoloMode()` 里显式 `Boolean(next)`。
> 2. **不要**指望同源校验。`PUT /api/system-settings/{category}` 的 `protectedSettingsWrite` 只在 `category === 'web_research'` 时做 origin 门禁（`researchUiOrigin.ts:34-43`），`agent_toolkit` 不做；`Origin` 头只是被转发。本功能不依赖它，也不应假装依赖它（v1 在这里写了 `Origin: <同源页面>` 属误导，已删）。
> 3. 写入会追加一条 `settings_audit_log`（既有行为），单次切换一条，频率天然很低。

### 6.2 HTTP：Agent 聊天请求体（唯一新增字段）

```jsonc
POST /api/video-editing-agent/chat
{
  "messages": [ … ],              // 既有
  "timelineState": { … },         // 既有
  "materials": [ … ],             // 既有
  "projectId": "…",               // 既有
  "lastCompositionId": "…",       // 既有
  "skillId": "…",                 // 既有
  "mentions": [ … ],              // 既有
  "editorContext": { … },         // 既有
  "autonomy": "yolo"              // 新增：'interactive' | 'yolo'；非法值按 'interactive'
}
```

- 缺省（旧客户端）：`'interactive'`，行为与今天**逐字节一致**。
- 该字段只影响本请求；不写库、不参与 SSE、不参与历史回放。

### 6.3 SSE：不变（设计说明）

不新增事件。理由：

1. 客户端已经用"最后一条 agent 消息"派生一切（计划、提问、工具卡），YOLO 不需要新状态；
2. 自动续跑是**新的 POST**，天然可观测（时间线里有一条 `yolo_continue` 用户消息）；
3. 增加事件会牵动 `SSEStreamManager` 的重试/`last-event-id` 语义，风险与收益不成比例。

若后续需要"本回合为 YOLO"的客观回执，可让 `run_started` 追加可选字段 `autonomy`（向后兼容），但**本期不做**。

### 6.4 前端 TypeScript 契约

```ts
// types.ts
export type AgentAutonomy = 'interactive' | 'yolo';

export interface ToolContext {
  // …既有…
  /** 本请求的自主模式快照；缺省 'interactive'。工具据此决定是否可提问。 */
  autonomy?: AgentAutonomy;
}

export interface AgentChatRequest {
  // …既有…
  autonomy?: AgentAutonomy;
  // 注意：`editorContext` 并不在本接口里——route 用
  // `readEditorContext((body as { editorContext?: unknown }).editorContext)`
  // 单独白名单校验（route.ts:328）。加字段时不要顺手把它塞进来。
}

export interface VideoEditingAgentConfig {
  // …既有…
  autonomy?: AgentAutonomy;
}

/**
 * 回合结束事实（评审 P0-1/P1-1）：在既有 turn-end edge 上同步采样一次，
 * 供 steering 与 YOLO 共同消费。**只有它能决定"要不要续跑"**——
 * onComplete 回调期间 executionState.status 仍是 'finishing'。
 */
export interface LastAgentTurnEnd {
  autonomy: AgentAutonomy;
  reason: 'completed' | 'cancelled' | 'error';
  /** 看门狗（FINISHING_WATCHDOG_MS）是否接管收尾；true 时一律不续跑。 */
  finishingTimedOut: boolean;
  steeredOrQueued: boolean;
  followUpSent: boolean;
  endedWithAskUser: boolean;
  conversationId: string | null;
  turnSeq: number;
}

// types/index.ts —— 只改既有那一行联合类型，不新增行（评审 P1-2）
export interface ChatMessage {
  // …既有…
  metadata?: {
    type?: 'intent_detection' | 'intent_result' | 'compaction' | 'yolo_continue';
    // …
  };
}

// VideoChatWindowProps
yolo: boolean;
yoloReady: boolean;                       // 评审 P2-02：false 时开关禁用
onYoloChange: (enabled: boolean) => void;

// useAgentExecution params
yolo?: boolean;

// useAgentExecution return（新增一个字段）
lastTurnEnd: LastAgentTurnEnd | null;

// useAgentExecutionSteering return（新增一个字段，采样点在这里）
lastTurnEnd: LastAgentTurnEnd | null;

// SendAgentMessageOptions
automatic?: 'yolo_continue';

// autonomyStore.ts（评审 P1-3）
export interface YoloModeSnapshot {
  enabled: boolean;
  ready: boolean;
  saving: boolean;
}
export function getYoloModeSnapshot(): YoloModeSnapshot;
export function subscribeYoloMode(listener: () => void): () => void;
export function loadYoloModeOnce(): void;              // 幂等：并发调用只发一次 GET
export async function setYoloMode(next: boolean): Promise<void>;  // 乐观 + 失败回滚

// 组件契约（避免实施时再决定）
export interface YoloToggleProps {
  /** 当前是否已武装（全局偏好，由 useAgentYoloMode 提供）。 */
  yolo: boolean;
  onYoloChange(next: boolean): void;
  /** 是否处于 Agent 模式；false 时开关禁用并解释原因。 */
  agentMode: boolean;
  /** 运行中禁用切换（本回合已快照，改了也只在下一回合生效）。 */
  agentIsExecuting: boolean;
}

// AgentBusyBarProps
yolo?: boolean;          // true 时在忙碌条最左侧渲染 YOLO 徽标

// EditorTopBarProps
isYoloArmed?: boolean;   // true 时渲染 ws-chip ws-chip--warn 徽标（缺省 false，零布局影响）
```

### 6.5 提示词契约（下游实现逐字照抄）

`YOLO_DIRECTIVE`、`YOLO_TOOLKIT_GUIDANCE` 见 §4.5.1/§4.5.2。约束：

1. `YOLO_DIRECTIVE` 必须包含 `ask_user` 一词（告诉模型它不存在），但提示词里**不得出现** `### ask_user` 段头与 `call ask_user once` 字样。
2. 指令必须包含**五类**断言（v2 增加第 5 类）：
   - 禁止提问（`禁止` + `ask_user`）；
   - 自决并记录假设（`假设：`）；
   - 失败降级且最多重试一次；
   - 结束前自检（`check_timeline` + `check_timeline_overlaps` + `auto_fix_overlaps`）与不得以提问收尾（`不得以提问`）；
   - **能力缺失时的优先级**：出现 `analysis_disabled` / 凭据 409 / 搜索关闭时记录限制并换路径，不得停下建议用户去开启（评审 P2-05）。
3. 指令字符数 ≤ 700（当前实现 **584**，见 §4.5.3 预算表）。
4. 指令必须自洽于既有提示词：它**不重复** `## 强制约束` 里的硬约束全文（那是重复计费），只声明"结束前必须自检"。
5. 引导替换必须是**按行**匹配（`split('\n')` → 找含 `call ask_user once` 的行 → 替换），且单元测试断言"替换后不再包含 `call ask_user once`"，避免未来改字导致静默失效（§4.5.2 实施提示）。

---

## 7. 数据模型

### 7.1 持久化（无 DDL）

`system_settings` 表已存在（`app/models/db_models.py:56-72`），YOLO 只增加一行：

| category | key | value (JSON) | default_value | value_type | description |
|---|---|---|---|---|---|
| `agent_toolkit` | `yolo_mode` | `false` / `true` | `false` | `scalar` | `全自动模式（YOLO）：开启后 Agent 不再提问，自行决定并跑完整个流程` |

- 首次启动由 `ensure_defaults_seeded` 播种；`UPDATE` 只刷新 `default_value`/`description`，**保留用户值**（既有语义）。
- 每次切换追加一条 `settings_audit_log`（既有行为，不需要额外代码）；单次切换一条，频率天然很低。
- **零迁移、零破坏性 DDL**（本仓库明令禁止启动期破坏性 DDL）。

### 7.2 内存形状

```ts
// src/lib/video-editing-agent/autonomyStore.ts —— 唯一真相（评审 P1-3）
interface YoloModeSnapshot {
  enabled: boolean;   // 当前生效值（乐观更新）
  ready: boolean;     // 首次 GET 是否已回；false 时开关禁用（评审 P2-02）
  saving: boolean;    // 写入中（防连点；不做 spinner，仅禁用）
}
// 模块级：snapshot + listeners + inflight promise（loadYoloModeOnce 幂等）
// setYoloMode(next): 乐观写 → PUT → 成功广播 / 失败回滚 + 广播 + 通知

// 视图层（剪辑台工具栏、设置中心小节各持一份实例，但读的是同一个 store）
interface UseAgentYoloModeReturn extends YoloModeSnapshot {
  toggle(next: boolean): Promise<void>;
}

// 回合结束事实：由 useAgentExecutionSteering 采样，useAgentExecution 转发
// 形状见 §6.4 LastAgentTurnEnd；useYoloAutoContinue 只读它，不自己判断时机
```

- 读取失败（后端未起、路由 500）→ `enabled = false`、`ready = true`、不弹错误（与聊天可用性解耦）；写入失败 → 回滚 + 广播 + `onNotification('error', t.…yoloSaveFailed)`（AC-C2）。
- **`ready` 之前不允许发送**：`enabled` 天然为 `false`，请求体 `autonomy` 恒为 `'interactive'`，因此"开关所见 = 请求所发"是无条件成立的（评审 P2-02）。
- 计数器不做模块级：`useYoloAutoContinue` 用 `useRef` 记"本会话当前用户回合链已续跑次数"，`conversationId` 变化即挂起（评审 P2-06）；用户发消息或关掉 YOLO 时清零。

### 7.3 消息标记

- 自动续跑的**用户消息**：`metadata.type = 'yolo_continue'`，`content = YOLO_CONTINUE_PROMPT`。
- 时间线派生：`mapMessageToNodes()`（`timeline/utils.ts:172-188`）在 `UserMessageNodeData` 上写 `automaticLabel = t.videoChatWindow.yoloAutoContinue`，`UserMessageNode` 在时间戳旁渲染该小标记。
- 历史与模型视图：它就是一条普通用户消息，`messageConverter` 无需特殊处理；**不新增 role、不新增 agent 事件**。

---

## 8. 实施顺序（四批，每批可独立验证）

| 批次 | 内容 | 独立验证 |
|---|---|---|
| **B1 后端 + 契约** | YAML/默认值/校验白名单 + `AgentAutonomy` / `LastAgentTurnEnd` 类型 + route 解析 | pytest 绿；请求体带 `autonomy` 不报错 |
| **B2 服务端行为** | 注册表不注册 `ask_user` + coreNames 剔除 + 提示词指令/引导/过滤 | 单测：工具集、提示词、长度；`npm run type-check` |
| **B3 客户端开关** | `autonomyStore` + `useAgentYoloMode` + `YoloToggle` + `YoloNotice` + 顶栏徽标 + 忙碌条标记 + 设置中心小节 + i18n | 组件测试 + 手工：切换落库、刷新保持、**设置中心与剪辑台互相同步**（AC-C9） |
| **B4 自动续跑** | `yoloAutonomy.ts` + turn-end 事实采样（`useAgentExecutionSteering`）+ `useYoloAutoContinue` + 消息标记 + 时间线小标记 | hook 测试（真值表）+ 手工两个场景：①故意留尾巴的回合被续跑**一次**；②运行中排队一句话后正常收尾——**只发一轮**（用户那句），YOLO 不追加（AC-C8） |

每批结束都必须跑：`npm run type-check`、`npm run lint`、相关 vitest、后端 `pytest`。

> **B4 的开工前置（评审 P0-1）**：先用既有 `useAgentExecutionState` 的测试夹具确认"`onComplete` 期间 `agentIsExecuting === true`"这一事实（读代码即可：`useAgentExecutionState.ts:234` 与 `useAgentExecution.ts:259`）。若实施者坚持用 `onComplete` 触发，应能在 10 分钟内复现"续跑从不发生"——那是设计错误，不是实现 bug，不要改 guard 来迁就它。

---

## 9. 测试与验收标准

### 9.1 验收标准（AC）

| AC | 断言（可机检） |
|---|---|
| **AC-A1** | `POST /chat` 带 `autonomy:'yolo'` 时 `createVideoEditingAgent` 收到 `autonomy==='yolo'`；带 `autonomy:'YOLO'`/`'x'`/缺省时收到 `'interactive'` |
| **AC-A2** | YOLO 上下文中 `registry.getAllTools()`、`getCategoryTools('workflow_tools')`、`getAlwaysAvailableTools()` 均不含 `ask_user`；`explore_tools` 的类别清单也不出现该名字 |
| **AC-A3** | 互动模式（默认）的工具总数与改动前**实测基线**一致（实施首步先记录基线数字）；`workflow_tools` 仍为 4 个；既有 `ask_user` 单轮一次、确定性 id、可答性测试全绿 |
| **AC-A4** | YOLO 提示词同时包含 `YOLO 全自动模式`、`禁止`、`update_plan`、`check_timeline`、`check_timeline_overlaps`、`auto_fix_overlaps`、`不得以提问`、`analysis_disabled` 与 `YOLO is on: never ask the user`；**不含** `### ask_user` 段头、不含 `call ask_user once`；`YOLO_DIRECTIVE.length <= 700` |
| **AC-A5** | YOLO 提示词长度 ≤ 互动提示词长度 + 400，且 ≤ `L0_PROMPT_CHAR_CEILING`；互动提示词既有 ≤18 500 断言不放宽 |
| **AC-B1** | 全新库首启后 `GET /api/system-settings/agent_toolkit` 的 `yolo_mode.value === false`；`PUT {settings:{yolo_mode:true}}` 后为 `true`，重启后仍为 `true` |
| **AC-B2** | `PUT {settings:{yolo_mode:"yes"}}` 与 `{yolo_mode:1}` 返回 422，响应体为 `detail.errors[].msg` 形状（无 `key` 字段）；`{yolo_mode:true}` 返回 200；未知键仍按既有语义报错 |
| **AC-C1** | `YoloToggle` 渲染 `role="switch"`、`aria-checked` 随值变化；`agentIsExecuting=true`、`agentMode=false`、`ready=false` 三种情况均 `disabled` 且 `title` 为对应文案；键盘 Space/Enter 可切换 |
| **AC-C2** | 点击开关 → 发出 `PUT /api/system-settings/agent_toolkit`，体为 `{settings:{yolo_mode:<bool>}}`（JSON 布尔，不是 `1/0`）；失败时开关回到原值并弹出通知 |
| **AC-C3** | 开关开启后 `EditorTopBar` 出现 `YOLO` 徽标（`aria-label` 可读、类名为 `ws-chip ws-chip--warn`），关闭后消失；出现/消失不改变顶栏左侧文本内容 |
| **AC-C4** | YOLO 回合运行中，`AgentBusyBar` 显示 `YOLO` 标记；互动回合不显示 |
| **AC-C5** | 首次开启出现 `YoloNotice`，点「知道了」或 8 秒后消失；`localStorage` 置位后刷新不再出现 |
| **AC-C6** | 自动续跑真值表（评审 P0-1/P1-1 重写）：<br>① `agentIsExecuting` 仍为 `true`（`status==='finishing'`）时**一次都不发送**；<br>② `lastTurnEnd = {autonomy:'yolo', reason:'completed', finishingTimedOut:false, steeredOrQueued:false, followUpSent:false}` 且计划未完成 ⇒ 落回空闲后**恰好 1 次**；<br>③ `reason` 为 `cancelled`/`error` ⇒ 0 次；`finishingTimedOut===true` ⇒ 0 次；`steeredOrQueued` 或 `followUpSent` 为真 ⇒ 0 次；计划已全 completed ⇒ 0 次；`autonomy!=='yolo'` ⇒ 0 次；`conversationId` 与当前会话不一致 ⇒ 0 次；<br>④ 同一 `lastTurnEnd` 触发多次重渲染 ⇒ 仍只发 1 次；<br>⑤ 用户再发消息后计数重置（可再续跑 1 次） |
| **AC-C7** | 自动续跑消息 `metadata.type === 'yolo_continue'`，时间线渲染"YOLO 自动继续"标记，正文与 `YOLO_CONTINUE_PROMPT` 一致 |
| **AC-C8** | **唯一发送者（评审 P1-1）**：YOLO 回合中用户 Alt+Enter 排了一段文本，回合正常结束 ⇒ 只产生 1 个新回合（内容是用户那段文本），`followUpSent===true` 且 YOLO 不追加；再断言 `steeredOrQueued` 在 `onTurnEnd` 之后仍为 `true`（防止未来把采样点挪到 drain 之后） |
| **AC-C9** | **双入口同步（评审 P1-3）**：在设置中心把 YOLO 打开 → 剪辑台工具栏开关无需刷新即为开态、顶栏徽标出现；反向同理。断言两个组件读的是同一个 `autonomyStore` 快照，且 `loadYoloModeOnce()` 并发调用只发一次 GET |
| **AC-D1** | YOLO 回合的 SSE 中不存在 `tool_result.toolName === 'ask_user'`（集成或 hook 级夹具）；互动回合存在 |
| **AC-D2** | 停止按钮在 YOLO 回合中可用；停止后不触发自动续跑，`cancelled` 事件与既有断言一致 |
| **AC-E1** | `i18n.ts` 三处同步，`npm run type-check` 通过；en/zh 键集合一致且无空串 |
| **AC-E2** | `npm run type-check`、`npm run lint`（无新增 error）、后端 `pytest` 全绿 |
| **AC-E3** | **棘轮（评审 P1-2 重写，规则同 `agent-steering-and-skills` AC-G2）**：新增文件 ≤ 800 行、新函数 ≤ 50 行；基线 ≤ 800 的改动文件改后 ≤ 800；**基线已 > 800 的四个文件净增 ≤ 0**（`useAgentExecution.ts` 855、`VideoEditingInterface.tsx` 2471、`AgentToolkitSettingsPanel.tsx` 818、`types/index.ts` 1002），做不到须在实施记录登记债务与理由；`editor-workbench.css` 净增 = 0（复用 `ws-chip--warn`）；`i18n.ts` 豁免（数据文件）。验证：改动前后各跑一次 `git ls-files <改动文件> \| xargs wc -l`，把对比表写进实施记录 |
| **AC-F1** | §9.3 列出的既有断言全部保持绿色（默认路径一字不变）；新增 YOLO 用例分别落在 §5.3 的独立文件里 |
| **AC-F2** | 后端新测试 `tests/test_agent_toolkit_settings_yolo.py` 全绿；`tests/test_agent_toolkit_settings.py` 因新增键而自动通过（变红即 YAML 与默认字典不同步） |

### 9.2 手工验收脚本（产品视角，5 分钟）

1. 打开剪辑任务 → 展开右下 AI 面板 → 工具栏见 `Agent [开] │ YOLO [关]`，几何与相邻开关一致，深色模式下轨道/光环可辨。
2. 开 YOLO → 一次行内说明出现、8 秒消失；顶栏出现 `YOLO` 徽标（与「备份可恢复」徽标同一套视觉）；刷新页面后仍为开（已落库）。
3. 发"帮我做一条 60 秒 AI 资讯视频，素材不限" → 全程**不出现提问卡片**；忙碌条带 `YOLO` 标记；中途不等待输入。
4. 运行中点停止 → 立刻停在 `cancelled`，**无自动续跑**；再点开始则重新按 YOLO 跑。
5. 关 YOLO → 徽标消失；发一条信息不足的任务（如"做个视频"）→ Agent 正常抛出 `ask_user` 卡片，点选项后继续。
6. 设置中心 → Agent 能力页 → 「自动化与交互」开关与剪辑台**互相同步**（不刷新）：改一边，另一边的开关与顶栏徽标立刻跟着变。
7. **排队不双发**：开 YOLO 发一个长任务，运行中按 Alt+Enter 排一句"顺便把 BGM 调低"，让它自然收尾 → 时间线里只多出**一条**用户消息（你排的那句），没有"YOLO 自动继续"。

### 9.3 既有测试的影响面（默认路径必须一字不变）

**设计约束**：YOLO 是**新增分支**，不是改默认分支。因此下列既有断言在默认（`autonomy` 缺省 = `'interactive'`）下必须**全部保持绿色**，一个都不许改成条件分支或放宽数字——它们就是"没有污染旧行为"的回归护栏：

| 既有断言 | 位置 | 期望 |
|---|---|---|
| 默认提示词里 `### ask_user` 恰好一次 | `systemPrompt.toolkit.test.ts:82-94` | 绿 |
| `CORE_TOOLKIT_TOOL_NAMES` 仍为 18 项且含 `ask_user` | `systemPrompt.toolkit.test.ts:88-93` | 绿（常量不动，只在渲染时过滤） |
| 默认上下文 `workflow_tools` = `[update_plan, ask_user, check_timeline, use_skill]` | `systemPrompt.toolkit.test.ts:238-246` | 绿 |
| 默认上下文常驻工具含 `ask_user`、不含 `workspace_write`/`run_analysis` | `toolkitTools.test.ts:171-179` | 绿 |
| 12 个 toolkit 工具全注册且名字唯一 | `toolkitTools.test.ts:155-169` | 绿 |
| `formatCoreToolkit(registry)` 单参调用（漂移存根） | `systemPrompt.test.ts:204-213` | 绿（新参可选） |
| 提示词 ≤ 18 500 / 上限 18 900 | `systemPrompt.toolkit.test.ts:71-80` | 绿 |
| `ask_user` 单轮一次 / 确定性 id / 可答性 | `askUserTool.test.ts` | 绿（工具本身未改） |
| 以未回答 `ask_user` 收尾时不自动发送排队文本 | `useAgentSteering.test.ts:188` | 绿（steering 未改） |
| 顶栏既有渲染（保存态/导出禁用/撤销锁/重命名） | `workbench/__tests__/EditorTopBar.test.tsx` | 绿（`isYoloArmed` 为可选入参，缺省不渲染徽标） |
| 忙碌条既有渲染与耗时 clock | `AgentBusyBar` 相关断言（`agent-busy-elapsed` 等） | 绿（`yolo` 为可选入参，缺省无徽标） |

若其中任何一条变红，说明实现把 YOLO 泄漏进了默认路径，**必须回退实现，而不是改断言**。
新增的 YOLO 断言一律写在独立文件（§5.3）里，与默认路径互不干扰。

---

## 10. 风险与缓解

| 编号 | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-01 | 模型无视禁令，在正文里反问后结束回合 | 用户以为"卡住了" | 三层：工具缺失 + 指令禁令 + 一次有界自动续跑（§4.6）；**残余风险见 §12「能力边界与不承诺」**（v1 误指 §13，那里是决策登记表） |
| R-02 | 全自动做出用户不想要的剪辑 | 时间浪费 | 整轮撤销/单步撤销不变（F-17）；停止随时可用；YOLO 不自动导出、不跳过预检 |
| R-03 | 自动续跑带来额外费用/循环 | 成本 | 上限 1 次 + 必须有未完成计划（C4）+ 有插话则放弃（C3）+ 非正常终态不续跑（C2） |
| R-04 | 提示词超预算 | 请求失败/被截断 | 移除 ask_user 段抵消新增；AC-A5 双上限断言 + 实测基线先测后写 |
| R-05 | 设置写入失败但界面已显示开 | 行为与预期不符 | 乐观更新 + 失败回滚 + 通知（AC-C2）；请求体只发已验证值；写失败不阻断聊天 |
| R-06 | 旧会话里已有未回答提问 | 模型以为仍需等待 | `YOLO_DIRECTIVE` 声明"历史提问作废"；旧卡片仍可点（用户切回互动模式可继续答） |
| R-07 | 注册表移除 `ask_user` 波及技能预加载 | 技能加载失败 | 已核查内置技能不引用 `ask_user`；`load()` 的 `invalid_tool_selection` 是既有降级路径 |
| R-08 | 顶栏新增元素导致布局跳动 | 视觉不统一 | 徽标插在 `flex:1` 占位之后、助手按钮之前；只压缩占位，左侧不平移（AC-C3） |
| R-09 | i18n 三处漏改 | TS 编译失败 | 类型接口与两个 locale 同 PR 提交；AC-E1 有键集一致性测试 |
| R-10 | 文件继续膨胀（`VideoEditingInterface`/`useAgentExecution`） | 触碰 800 行纪律 | 新逻辑全部落新文件；四个超线文件的净增上限写进 AC-E3 与 §5.2.1（净增 ≤ 0，做不到登记债务） |
| R-11 | 运行中切换语义被误解（已开却仍被问） | 困惑 | 运行中禁用切换 + 明确 title（S4）；请求快照语义在 §4.3/§6.2 写死 |
| R-12 | 未来把 `yolo_mode` 迁到独立类别 | 技术债 | 键名与语义已解耦（布尔 + 描述）；迁移只需一条 `UPDATE`，本文 §7.1 记录来源 |
| R-13 | 实施者图省事，把 YOLO 做成默认分支或直接改既有断言 | 旧行为被悄悄改掉，回归护栏失效 | §9.3 把既有断言写成"必须保持绿"的硬约束；AC-F1 明令禁止改断言；`autonomy` 缺省值在类型与 route 两处都是 `'interactive'` |
| R-14 | **续跑在 `finishing` 期间发送，被 `sendAgentMessage` 的 guard 静默吞掉**（评审 P0-1 的原型） | 功能永不触发且无任何报错 | 触发点写死为空闲边沿 + `LastAgentTurnEnd` 事实；AC-C6 第 ① 条专门断言"`finishing` 期间一次都不发" |
| R-15 | **两个发送者抢同一个回合结束边沿**，静默丢掉用户排队的那句话（评审 P1-1） | 丢用户输入 / 费用翻倍 | `followUpSent` + `steeredOrQueued` 在 `onTurnEnd` 之前采样；steering 优先，YOLO 让位；AC-C8 |
| R-16 | 两个入口各持一份状态，设置中心与剪辑台互相不同步（评审 P1-3） | 用户看到矛盾的开关状态 | 单一 `autonomyStore` + 广播；AC-C9 |

---

## 11. 回滚方案

1. **功能级回滚（无需发版代码）**：设置中心把 YOLO 关掉，或在数据库把 `agent_toolkit.yolo_mode` 置 `false`；所有 YOLO 分支都有 `'interactive'` 缺省，等于回到今天。
2. **代码级回滚**：B3/B4 是纯增量文件，删除 import 即回到"只有服务端能力、无 UI 入口"；B2 的工具注册用一行三元表达式，改回常量即可。
3. **数据回滚**：`system_settings` 只多一行，置 `false` 即失效；无表结构变更，无数据迁移。

---

## 12. 明确不做（范围外）

- 无人值守的"定时/后台排队"剪辑；YOLO 仍然需要用户按下发送。
- 多 Agent 并发写同一条时间线、YOLO 专属的额外权限或更高调用上限。
- 绕过 `check_timeline`、导出预检、时间线锁或任何安全/授权检查。
- 在 YOLO 下自动导出成片（导出是明确的用户动作，含预检确认）。
- 对非 Agent 的 AI 弹窗（脚本生成、剪口、封面、批量解析）施加"不许问"的约束——那些是用户主动打开的模态。
- 把 `yolo_mode` 做成项目级属性（理由见 §4.2 / D-03）。

### 12.1 能力边界与不承诺（评审 P1-4）

这一节存在的唯一目的是**不许把前提藏起来**。R-01 与 §2.3 都指向这里。

- **不承诺"模型永不提问"（只承诺移除权限）**。硬保证只有一层：注册表里没有 `ask_user`，模型拿不到 schema，`canExecute` 永远 false。软保证是提示词，软保证可以被模型违反；被违反时的兜底是**一次**有界续跑，且该兜底**要求模型先发布计划**（C4）。
- **不承诺"永远跑到 100% 完成"**。以下情形会合法地停下来，且不会自动续跑：用户点停止（`cancelled`）、流式错误（`error`）、15s finishing 超时、连续 5 次工具失败熔断、模型 40 次 / 工具 80 次上限、30 分钟静默看门狗。这些是**保护**，不是缺陷（E5–E7）。
- **不承诺"自动续跑能救一切"**：上限 1 次；若用户在该回合插过话或排过队，YOLO 主动让位（§4.6.4）。
- **不承诺"YOLO 会替用户导出"**：导出仍是用户动作，含预检（E9）。
- **不承诺跨设备/跨进程一致**：`yolo_mode` 是本机 `system_settings` 的一行，随数据库走，不随账号同步（本项目无账号）。
- 以上边界应原样出现在实施记录里；若实施者发现某条在实际模型行为下明显不成立，**回来改文档，不要悄悄改实现去凑承诺**。

---

## 13. 决策登记（下游不得再重新决定）

| 编号 | 决策 | 理由 | 被否决的替代 |
|---|---|---|---|
| D-01 | 命名 `YOLO`（界面标签与文案主词），内部标识 `yolo` / `AgentAutonomy='yolo'` | 用户明确要求显示为 YOLO；短词在 360px 面板里不换行 | `Autopilot`（英文长、与中文"全自动"重复）、`Turbo`（语义不符） |
| D-02 | 开关放聊天工具栏（主）+ 顶栏徽标（状态）+ 设置中心（次） | 与任务发起处同屏，符合"就地控制"；顶栏解决面板收起时的状态可见性 | 只放设置中心（离操作太远）、只放顶栏（顶栏 48px 已拥挤） |
| D-03 | 全局偏好，落 `system_settings.agent_toolkit.yolo_mode` | 跨项目稳定期望；避开 `project_data` 的时间线解析面；复用既有开关先例 | 项目级（语义错、解析风险）、localStorage（不可跨进程可信、设置中心不可见） |
| D-04 | 请求体 `autonomy` 为准，缺省 `interactive`，服务端不回查数据库 | 客户端是唯一调用方；少一次往返；失败即旧行为 | 服务端每回合回查（延迟↑、与 crewSettings 一样只是"设置"而非"意图"） |
| D-05 | YOLO 下**不注册** `ask_user`，而非拦截 | 省 token、杜绝"拒绝-重试"往返；注册表是唯一授权源（F-08） | 注册但返回拒绝信封（白花 schema 与一轮模型调用） |
| D-06 | 提示词用**独立指令段** + 工具箱引导替换，不新写整份提示词 | 单点可读、可测、可回滚；保持确定性前缀稳定（缓存友好） | 复制一份 YOLO 专用 systemPrompt（双份维护必漂移） |
| D-07 | 自动续跑上限 = 1，且必须"计划未完成 + 无插话 + 正常完成" | 只覆盖"忘记收尾"这一真实故障，不制造无人监督循环 | 无限续跑（成本不可控）、完全不续跑（承诺落空） |
| D-08 | 运行中**禁用**开关 | 与相邻 Agent 开关一致；避免"我开了却还在被问"的误解 | 允许运行中切换（语义含糊、需额外 toast 解释） |
| D-09 | 琥珀色作为"已武装"色 | 红＝错误/危险是本产品既有语义；琥珀已用于"收尾中" | 红色（误读为故障）、主色 primary（与 Agent 开关撞色） |
| D-10 | 首次开启用行内说明（8s），不用模态确认 | 可逆、无数据风险；不打断"开面板→发任务" | `ConfirmationDialog`（把可逆开关暗示成危险操作） |
| D-11 | 不改 SSE 协议 | 客户端已可从消息派生一切；改流风险 > 收益 | 新增 `autonomy` 事件（牵动重试/断线语义） |
| D-12 | 新逻辑落新文件，宿主文件净增受 AC-E3 约束 | 仓库 800 行纪律 + 棘轮规则 | 就地堆在 `useAgentExecution`（实测 855 行） |
| D-13 | **自动续跑由"执行态空闲边沿 + `LastAgentTurnEnd` 事实"触发，不用 `onComplete`** | `onComplete` 期间 `status==='finishing'`，`sendAgentMessage` 的 guard 会静默吞掉发送（P0-1） | 在 `onComplete` 里发（功能永不触发，且无报错可查）、轮询 `status`（多一个定时器且仍有竞态） |
| D-14 | **两个入口共用单一 `autonomyStore` 模块（无 localStorage、无各自 GET）** | 否则"改一边另一边同步"不可达，用户会看到矛盾状态（P1-3） | 各自 `useState + GET`（不可同步）、`localStorage`（不可跨进程可信、设置中心不可见） |
| D-15 | **同一回合结束只允许一个发送者，steering 优先** | 用户排队的那句话比一句自动"继续"更值钱；`sendingRef` 的静默丢弃是故障现象而不是仲裁（P1-1） | 两个 effect 各自发（依赖执行顺序、可能丢用户输入） |

---

## 14. Definition of Done

1. `spec.md` 存在于 `docs/plans/agent-yolo-autonomous-mode/`，在 `git status` 中可见。
2. 本文包含：**评审记录**、**评审结论**、概述、技术设计、文件/模块变更计划（含测试文件与行数基线表）、接口设计、数据模型、测试与验收标准、风险与缓解、决策登记、DoD。
3. 实施侧 DoD（下一节点）：AC-A1…AC-F2 全部有测试或可复现手工步骤支撑；`npm run type-check` / `npm run lint` / 相关 vitest / 后端 `pytest` 全绿；未新增 DDL、未放宽任何既有上限；§5.2.1 的行数对比表与 §4.5.3 的提示词长度实测值写进实施记录。
4. 本文不含实现代码改动；本轮不修改 `docs/plans/agent-yolo-autonomous-mode/` 以外的任何文件，不执行 `git commit`。
5. v2 评审要求：**不允许存在未解决的 P0/P1**；新增 P2 必须在下一轮评审时给出处置（改正文或写明为什么不改）。

---

## 评审结论

**有条件通过**（v2）。

### 判定理由

- **可行性**：方案落在当前栈上都能实现——工具注册表是唯一授权源（`ToolActivationState` 只 offer `coreNames ∪ activeNames`），提示词是纯函数拼接，开关是既有的 `system_settings` 类别 + 既有 `SwitchField`，自动续跑走既有的 `sendAgentMessage` 通道。v2 修掉的 P0-1（在 `finishing` 期间发消息会被静默吞掉）正是"看起来能实现、实际永不触发"的那一类问题，现在有明确的触发点与可机检断言。
- **完整性**：边界（无计划、无凭据、`analysis_disabled`、熔断、上限、看门狗、停止、导出）逐项有处置；自动续跑与 steering 的竞态（P1-1）已有唯一发送者仲裁；两个设置入口的一致性（P1-3）已有单一 store；承诺的边界（P1-4）已写进 §12.1，不再把前提藏起来。
- **一致性**：默认路径"一行不改"的回归护栏（§9.3）与既有两轮评审的做法一致；行数棘轮（P1-2）与 `agent-steering-and-skills` AC-G2 逐条对齐，并且给出了逐文件的实测基线与净增上限；顶栏复用 `ws-chip--warn`（P2-01）符合"不做新视觉岛"；`autonomy` 缺省为 `'interactive'` 的失败语义与 `crewSettings`、`webCapabilities` 的既有"能力缺失即降级"一致。
- **合理性**：四层切面是必要的（少一层都是假实现或半可用），而权限只减不增、不新增 SSE 事件、不改调用上限、不自动导出的取舍是克制的。自动续跑的两处复杂度（触发点采样、发送仲裁）都是为了让"承诺"与"实际"不脱节，不是镀金；P2-01 反向减掉了 14 行 CSS 也说明没有过度设计。

### 通过条件（实施节点必须逐条满足，缺一不算完成）

1. **C-1**：自动续跑的触发点是执行态空闲边沿 + `LastAgentTurnEnd` 事实；`onComplete` 里不发送任何消息（AC-C6 第 ① 条必须真实存在并通过）。
2. **C-2**：`followUpSent` / `steeredOrQueued` 在 `steering.onTurnEnd` **之前**采样；`followUpSent === true` 时 YOLO 不发送（AC-C8）。
3. **C-3**：四个超线文件（`useAgentExecution.ts` 855、`VideoEditingInterface.tsx` 2471、`AgentToolkitSettingsPanel.tsx` 818、`types/index.ts` 1002）净增 ≤ 0；做不到必须在实施记录登记债务与理由，不得静默超线（AC-E3 + §5.2.1）。
4. **C-4**：`autonomyStore` 是唯一真相，设置中心与剪辑台互相同步、`loadYoloModeOnce()` 幂等（AC-C9）；`ready === false` 时开关禁用且不发请求（AC-C1）。
5. **C-5**：§9.3 的既有断言**一条都不许改**，全部保持绿色（AC-F1）；若变红，回退实现而不是改断言。
6. **C-6**：§12.1 的"不承诺"清单原样进入实施记录与（如产品要求）发布说明；不得在实现里悄悄扩大承诺。
7. **C-7**：`npm run type-check`、`npm run lint`（无新增 error）、相关 vitest、后端 `pytest` 全绿；提示词长度与文件行数的实测值写入实施记录。

### 评审者签名

- 角色：Anthropic 工程团队 资深评审（设计评审节点）
- 范围：仅 `docs/plans/agent-yolo-autonomous-mode/spec.md`；未修改任何源码，未执行 `git commit`
- 基线核对：全部"已核实事实"（F-01…F-18）与 §9.3 的既有断言位置，均已按当前工作树逐条对照；v1 中与实测不符的数字（`useAgentExecution` 916→855、`AgentToolkitSettingsPanel` 876→818、`i18n.ts` 10 753→11 973、提示词净增 ≈+150→≈+115）已在正文更正
---

## 实施过程发现的方案缺陷

> 本节由实施节点追加（任务要求：发现设计有误/不全时**不得静默偏离**）。每条都是「照抄会坏」或「照抄做不到」，实施已按修正后的做法落地，并有测试或实测数字支撑。

| # | 方案位置 | 缺陷（附证据） | 实施采用的修正 |
|---|---|---|---|
| I-1 | §4.5.2 `YOLO_TOOLKIT_GUIDANCE` 的替换写法 | 设计说「`split('\n')` → 找含 `call ask_user once` 的行 → 替换该行」。但该句在 `AGENT_TOOLKIT_GUIDANCE` 里是**两行**（`…call ask_user once instead of` / `guessing; otherwise pick the sensible default…`）。只换锚点行会留下孤立的半句 `guessing; otherwise …`，引导被拼坏且没有测试能发现。 | 锚点行**连同它的续行**（以 `guessing;` 开头）一起替换；`systemPrompt.yolo.test.ts` 断言替换后不含 `call ask_user once` **且**不含 `guessing; otherwise`。 |
| I-2 | §5.2.1 `types/index.ts` 的「只改既有那一行联合类型（79 列）」 | 实测该行加 `'yolo_continue'` 后是 **81 列**（超 80 一列）。照抄要么破 80 列纪律，要么净增 1 行破棘轮。 | 保留单行联合类型（81 列，已登记），并在**同一个 `metadata` 块内**把 `status?: string;` 与 `intention?: any;` 并成一行抵掉 1 行，文件净增仍为 **0**。棘轮优先于单行宽度，已在此登记。 |
| I-3 | §5.2 / §4.9.6 的 i18n 键位 `settings.agentAutonomy.*` | `i18n.ts` 里不存在 `settings` 顶层命名空间；本仓库设置文案统一挂在 `agentSettings`（`crew` / `memory` 已是这个形状，`AgentCrewMemorySections` 直接读它）。 | 落到 `agentSettings.autonomy.{title, description, saveFailed}`（与既有两节同构）；`videoChatWindow` 下新增 **12** 个 `yolo*` 键（不是 11：多一个时间线小标记 `yoloAutoContinue`），合计 **+59** 行（数据文件按 §5.2.1 ③ 豁免）。 |
| I-4 | §4.6.5 hook 入参 | 若 hook 逐个接收 `lastTurnEnd / plan / continueCount / activeConversationId / send`，`VideoEditingInterface` 侧要多出 5–6 行，与该文件「净增 ≤ 0」直接冲突。 | hook 取紧凑对象 `{ agent, yolo, conversation }`（`agent.lastTurnEnd` 与 `agent.sendAgentMessage` 同源），纯函数 `shouldAutoContinue` **保持设计签名**（`LastAgentTurnEnd + plan + continueCount`）；C4 的「最后一条必须是本回合刚写的 agent 消息」由 hook 校验。真值表测试仍按 C1–C5 逐条断言。 |
| I-5 | §5.2.1「首选把 `describeStreamError`/`notifyAgentError` 附近抽成 `agentErrorCopy.ts`」 | 实测这一处只能抵 −21 行，而 `useAgentExecution.ts` 的实际新增是 **+26 行**（`params.yolo`、请求体 `autonomy`、`metadata` 标记、看门狗标志、事实转发）。仅此一项无法做到净增 ≤ 0。 | 再抽出 `hooks/agentTurnContext.ts`（`AgentEditorContext` / `buildEditorContextField` / `SendAgentMessageOptions`），并在 `useAgentExecution` **原样再导出**这两个类型，三个既有导入点零改动。最终 855 → **848（−7）**。 |
| I-6 | §4.9.3 / §6.4 的 `VideoChatWindowProps` | 没有写「失败通知从哪来」。`useAgentYoloMode` 需要一个宿主注入的提示通道，否则 AC-C2 的「失败时弹出通知」无从实现。 | `useAgentYoloMode` 增加**可选** `onSaveFailed?: () => void`；`VideoEditingInterface` 注入 `() => showError(t.videoChatWindow.yoloSaveFailed)`（复用既有 toast，不新增 Provider）。 |
| I-7 | §5.2.1 表格里的实施预算 | 若干文件的实测净增大于预算：`chat/route.ts` +15（预算 ≤+8 / ≤756）、`VideoChatWindow.tsx` +23（估 +14）、`AgentBusyBar.tsx` +14（估 +8）、`EditorTopBar.tsx` +13（估 +9）、`useAgentExecutionSteering.ts` +37（估 +14）。原因都是**注释与空行**（设计要求的「为什么」说明不能省）。 | 全部文件仍满足 §5.2.1 ① 的硬规则（改后 ≤ 800，`route.ts` 763）。这些净增登记在下方实施记录里，不静默超线。 |

---

## 实施记录（本轮实现节点）

> 实施范围：§5.1 / §5.2 / §5.3 的全部条目（含新增测试）。未执行 `git commit`。

### A. 提示词长度实测（§4.5.3 / AC-A5）

| 项 | 实测 |
|---|---|
| 互动模式 L0 提示词 | **15 948** 字符（既有 ≤18 500 断言未放宽） |
| YOLO L0 提示词 | **15 980** 字符 |
| `YOLO_DIRECTIVE.length` | **584**（上限 700） |
| 净差 | **+32**（上限 +400，余量 368） |

### B. 行数对比表（§5.2.1 / AC-E3，开工前后各测一次）

| 文件 | 基线 | 现在 | 净增 |
|---|---|---|---|
| `src/components/video/hooks/useAgentExecution.ts` | 855 | 850 | **−5** |
| `src/components/video/VideoEditingInterface.tsx` | 2471 | 2471 | **0** |
| `src/components/settings/AgentToolkitSettingsPanel.tsx` | 818 | 817 | **−1** |
| `src/types/index.ts` | 1002 | 1002 | **0** |
| `src/styles/editor-workbench.css` | 1569 | 1569 | **0**（复用 `.ws-chip--warn`） |
| `src/lib/i18n.ts` | 11 973 | 12 032 | +59（数据文件豁免） |
| `src/lib/video-editing-agent/types.ts` | 448 | 495 | +47 |
| `src/lib/video-editing-agent/promptParts.ts` | 215 | 274 | +59 |
| `src/lib/video-editing-agent/systemPrompt.ts` | 639 | 665 | +26 |
| `src/lib/video-editing-agent/agent.ts` | 670 | 678 | +8 |
| `src/lib/video-editing-agent/tools/index.ts` | 509 | 513 | +4 |
| `src/app/api/video-editing-agent/chat/route.ts` | 748 | 763 | +15 |
| `src/components/video/hooks/useAgentExecutionSteering.ts` | 121 | 158 | +37 |
| `src/components/video/components/VideoChatWindow/VideoChatWindow.tsx` | 658 | 681 | +23 |
| `src/components/video/components/VideoChatWindow/AgentBusyBar.tsx` | 117 | 131 | +14 |
| `src/components/video/components/VideoChatWindow/timeline/types.ts` | 152 | 154 | +2 |
| `src/components/video/components/VideoChatWindow/timeline/utils.ts` | 308 | 313 | +5 |
| `src/components/video/components/VideoChatWindow/timeline/UserMessageNode.tsx` | 60 | 69 | +9 |
| `src/components/video/workbench/EditorTopBar.tsx` | 189 | 202 | +13 |
| `src/lib/video-editing-agent/yoloAutonomy.ts`（新） | — | 58 | +58 |
| `src/lib/video-editing-agent/autonomyStore.ts`（新） | — | 109 | +109 |
| `src/components/video/hooks/useAgentYoloMode.ts`（新） | — | 63 | +63 |
| `src/components/video/hooks/useYoloAutoContinue.ts`（新） | — | 89 | +89 |
| `src/components/video/components/VideoChatWindow/YoloToggle.tsx`（新） | — | 85 | +85 |
| `src/components/video/components/VideoChatWindow/YoloNotice.tsx`（新） | — | 92 | +92 |
| `src/components/settings/components/AgentAutonomySection.tsx`（新） | — | 55 | +55 |
| `src/components/video/hooks/agentErrorCopy.ts`（新，棘轮抵消） | — | 55 | +55 |
| `src/components/video/hooks/agentTurnContext.ts`（新，棘轮抵消） | — | 35 | +35 |

**债务登记（唯一未达预算项）**：`chat/route.ts` 748 → 763（+15，预算 ≤756）。多出的 7 行全部是 `readAutonomy` 的白名单注释与 import 展开；文件仍 ≤ 800，未静默超线。

### C. 校验结果

| 命令 | 结果 |
|---|---|
| `npm run type-check`（tsc --noEmit） | 通过，0 错误 |
| `npm run lint` | 无新增 error（本次新增/修改文件单独 `next lint --file` 全部 0 error；全仓既有 error 与本改动无关） |
| `npx vitest run` | 550 文件通过 / **2 文件失败**：`backend-proxy.test.ts`（需要 `BACKEND_URL=http://test-backend:8088`，本机 `.env` 是 localhost:8000，环境相关）与 `VideoEditorContainer.recoveryBackup.test.ts`（断言 `setContent((current) => withCurrentRecoveryBackup(current, next))`，而该文件已被上一轮封面 schema 版本化包成 `withCoverSchemaVersion(...)`，属既有陈旧断言）。两处都不涉及本次改动的文件（`git status` 对其为空） |
| `pytest tests/`（后端全量） | 2615 passed / 30 failed / 16 errors；失败集中在 voice config、main 端点夹具、subtitle/ffmpeg、`security/test_06_misc.py::test_V06A`（指向上一轮的 `app/services/agent_skills/parser.py:122`）——均为既有失败。`tests/test_agent_toolkit_settings.py` + 新文件 `tests/test_agent_toolkit_settings_yolo.py` **55 passed** |

### D. 能力边界与不承诺（§12.1 原样进入实施记录，C-6）

- **不承诺「模型永不提问」（只承诺移除权限）**：硬保证只有一层——注册表里没有 `ask_user`，模型拿不到 schema，`canExecute` 永远 false。软保证是提示词；被违反时的兜底是**一次**有界续跑，且该兜底**要求模型先发布计划**（C4）。
- **不承诺「永远跑到 100% 完成」**：用户点停止（`cancelled`）、流式错误（`error`）、15s finishing 超时、连续 5 次工具失败熔断、模型 40 次 / 工具 80 次上限、30 分钟静默看门狗都会合法停下，且不自动续跑（E5–E7）。
- **不承诺「自动续跑能救一切」**：上限 1 次；用户在该回合插过话或排过队时 YOLO 主动让位（§4.6.4）。
- **不承诺「YOLO 会替用户导出」**：导出仍是用户动作，含预检（E9）。
- **不承诺跨设备/跨进程一致**：`yolo_mode` 是本机 `system_settings` 的一行，随数据库走，不随账号同步（本项目无账号）。

### E. 逐条对应通过条件（评审结论 C-1…C-7）

| 条件 | 落点 | 证据 |
|---|---|---|
| C-1 | 触发点是空闲边沿 + `LastAgentTurnEnd`，`onComplete` 里不发任何消息 | `useAgentExecutionSteering.ts` 在既有 turn-end effect 内采样；`useYoloAutoContinue.test.tsx` 第 ① 条（无事实不发）与 `useAgentExecution.yolo.test.ts`「事实只在回合真正结束后出现」 |
| C-2 | `steeredOrQueued` / `followUpSent` 在 `onTurnEnd` **之前**采样；`followUpSent` 为真时 YOLO 不发送 | `useAgentExecution.yolo.test.ts`「samples steeredOrQueued before steering drains the queue」+ `useYoloAutoContinue.test.tsx`「yields to steering」 |
| C-3 | 四个超线文件净增 ≤ 0 | 见 B 表：−7 / 0 / 0 / 0 |
| C-4 | `autonomyStore` 唯一真相、`loadYoloModeOnce()` 幂等、`ready=false` 禁用 | `autonomyStore.test.ts`（并发只发一次 GET、广播、回滚）+ `useAgentYoloMode.test.tsx`（两实例共享快照）+ `YoloToggle.test.tsx`（`aria-busy` 且禁用时不写） |
| C-5 | §9.3 既有断言一条不改、全部保持绿 | `askUserTool` / `toolkitTools` / `systemPrompt.toolkit` 只**新增**用例，既有断言逐字未改；相关目录 1381 条既有用例全绿 |
| C-6 | §12.1 不承诺清单原样进入实施记录 | 本文 D 节 |
| C-7 | type-check / lint / vitest / pytest + 实测值写入实施记录 | 本文 A、B、C 三节 |

### F. 需求到界面的落点自查（§2.3 / §9.2 手工脚本）

1. 聊天工具栏 `Agent [○] │ YOLO [○]`：1px 分隔线 + 与相邻开关同几何的 `YoloToggle`（`h-5 w-9`、旋钮 `h-3.5 w-3.5`、`translate-x-[18px]/[3px]`），标签复用相邻 `text-xs font-medium` 排版，仅对 `YOLO` 加 `tracking-[0.06em]`。
2. 开 YOLO：琥珀轨道 + 柔和光环 + 首次一行说明（8s 自动消失、可点「知道了」、`localStorage` 置位）；顶栏出现 `ws-chip ws-chip--warn` 的只读 `YOLO` 徽标（`ws-hide-narrow`），出现/消失只压缩 `flex:1` 占位。
3. YOLO 回合运行中：`AgentBusyBar` 最左渲染 `YOLO` 小徽标，与琥珀色系一致。
4. 自动续跑的用户消息带 `metadata.type='yolo_continue'`，时间线渲染「YOLO 自动继续」小标记，正文为 `YOLO_CONTINUE_PROMPT`。
5. 设置中心「Agent 能力」页顶部新增「全自动模式（YOLO）」小节，与工具栏**共用同一个 store**，改一边另一边（含顶栏徽标）立刻跟着变。
6. 停止按钮、整轮/单步撤销、导出预检、时间线锁全部未动。

### G. 设计清单之外的必需接线（3 处，均为 1–4 行）

| 文件 | 净增 | 为什么设计表里没有它，但必须有 |
|---|---|---|
| `src/components/video/components/VideoChatWindow/timeline/TimelineChatPanel.tsx` | +3 | §7.3 说「`mapMessageToNodes()` 在 `UserMessageNodeData` 上写 `automaticLabel`」，但 `TimelineNodeLabels` 是由面板在调用处组装的（`{ emptyResponse }`）。不打这个补丁，`yoloAutoContinue` 标签永远传不进去。 |
| `src/components/video/components/AgentChatDock/__tests__/AgentChatDock.lifecycle.test.tsx` | +3 | 该用例用 `compileComponent` 直接编译 `VideoChatWindow.tsx` 源码，模块表是显式的；新增的 `./YoloToggle` / `./YoloNotice` 两个 import 必须映射（否则 `unmapped import`），与既有 `./AgentBusyBar` 的处理方式一致。 |
| `src/components/video/hooks/agentErrorCopy.ts` / `agentTurnContext.ts` | 新增 | 见缺陷 I-5：`useAgentExecution.ts` 的净增 ≤ 0 只能靠等量抽取实现，设计已把「抽到新文件」列为认可的扩张方式。 |

---

## 评审节点记录（最终评审 + 提交）

> 角色：资深评审（代码评审 + 提交节点）。范围：本节以下的改动均由本节点完成，其余实现保持实施节点原样。
> 评审方式：逐条对照 §4/§5/§6/§9.1/§9.3 读 diff，重跑 `npm run type-check`、`npm run lint <改动文件>`、全量 `npx vitest run`、后端 `pytest tests/test_agent_toolkit_settings*.py`。

### H. 评审发现与处置（7 条，全部已修，无遗留 TODO）

| # | 严重度 | 位置 | 问题（含证据） | 处置 |
|---|---|---|---|---|
| R-Y1 | **P0** | `useAgentExecution.ts` `sendAgentMessage` 的 `useCallback` 依赖数组 | **整个 YOLO 请求字段静默失效。** `yolo` 是渲染作用域常量，发送回调的依赖数组里没有它，`sendAgentMessage` 会一直闭包着**首次渲染**的 `yolo=false`；用户在面板里打开开关后，请求体仍不带 `autonomy`，服务端照旧注册 `ask_user`。ESLint 已报 `react-hooks/exhaustive-deps`（`600:6 missing dependency 'yolo'`），而既有测试用 `yolo:true` 挂载，恰好绕过该路径。 | 依赖数组补 `yolo`；新增回归用例 `useAgentExecution.yolo.test.ts`「picks up a switch turned on after mount (no stale closure)」——先以 `yolo=false` 挂载并发一轮，再 `rerender({yolo:true})` 发第二轮，断言第二轮请求体 `autonomy==='yolo'`。已验证：**移回缺依赖的写法该用例必红**，恢复即绿。 |
| R-Y2 | P2 | `YoloNotice.tsx` 自动消失分支 | 8 秒自动消失时**没有**写 `localStorage` 已读标记（只有点「知道了」才写），于是「首次开启的一次性说明」每次开启都会重播，与 AC-C5「只出现一次」相悖，且既有测试只断言了淡出、没断言持久化。 | 定时器回调先 `markSeen()` 再 `setDismissed(true)`；补用例「remembers the auto-dismissed notice, so it never comes back」。 |
| R-Y3 | P2 | `YoloToggle.tsx` | `aria-describedby` 指向**写死的 id** `yolo-toggle-description`。停靠面板与浮动面板可能同时存在两份实例，重复 id 会让读屏读到另一份实例的隐藏文案（同 id 在仓库里是既有反模式）。 | 改用 `useId()` 生成唯一 id；`YoloToggle.test.tsx` 的 `getElementById(described)` 断言不受影响。 |
| R-Y4 | P2 | `useAgentExecutionSteering.ts` 采样处 | 采样 `steeredOrQueued` 时**内联复制**了 `steeringMachine.ts` 的私有判定（`status === 'local' \| 'sent'`）。这条规则（哪些插话算「未送达」）一旦变化，两处会静默分叉，而 C3 是「不抢用户方向盘」的唯一依据。 | `SteeringMachine` 新增公开的 `hasPendingInput()`（委托既有 `totalPending()`），经 `useAgentSteering` 暴露；采样处改为调用它。副产品：`useAgentExecutionSteering.ts` 少两行。`useComposer.test.tsx` 的 steering 夹具补一行 `hasPendingInput`。 |
| R-Y5 | P2 | `useAgentYoloMode.ts` | 变量名 `onSaveFailedRef` 后缀 `Ref` 但**不是 ref**（是渲染作用域的回调），误导读者以为它跨渲染稳定。 | 改名为 `onSaveFailed`，依赖数组同步。 |
| R-Y6 | P2 | `AgentToolkitSettingsPanel.tsx`（`CapabilitySection` / `LimitsSection`） | 为抵消新增的 2 行，实施把两个接口成员压进了一行（`values: ToolkitSettings; update: UpdateSetting;`），属为凑行数而破坏「一行一语句」的既有排版。 | 两节同形，抽一个共用的 `type ToolkitSectionProps`（1 行）+ 两个单行签名：净 −2 行，面板 818 → **817**，排版回到仓库惯例。 |
| R-Y7 | P2 | `systemPrompt.yolo.test.ts`、`yoloAutonomy.test.ts`、`AgentBusyBar` 覆盖 | 三个测试质量问题：①「is byte-identical to today」实际只比较 `prompt(undefined)` 与 `prompt('interactive')`（实现自比实现），交互路径即使被 YOLO 污染也会绿；②「copies the prompt contract (AC-C7)」只断言常量子串，AC-C7 一条也没钉；③AC-C4（忙碌条 YOLO 标记）**无任何测试**。 | ①改名为「keeps the interactive path free of any YOLO wording (AC-F1)」，并补断言：互动提示词**仍含** `### ask_user` 与 `call ask_user once`（这正是被 YOLO 动过的两处）；②改名并在注释里指明 AC-C7 由哪两个用例钉住，只保留它真正断言的「续跑文案不得索要确认」；③`AgentBusyBar.test.tsx` 新增「marks a YOLO turn with a small badge, and nothing otherwise (AC-C4)」。 |

### I. 本节点的校验结果

| 命令 | 结果 |
|---|---|
| `npm run type-check` | 通过，0 错误 |
| `npx next lint --file <13 个改动/新增源文件>` | 无新增 error/warning；仅剩 `useAgentExecution.ts` 里既有的 `coverRoutersRef.current` 清理告警（非本次引入） |
| `npx vitest run`（全量） | **550 文件 / 4817 用例通过**；2 文件失败：`backend-proxy.test.ts`（期望 `BACKEND_URL=http://test-backend:8088`，本机 `.env` 为 localhost:8000，环境相关）与 `VideoEditorContainer.recoveryBackup.test.ts`（既有陈旧断言，上一轮封面 schema 版本化所致）。两者 `git status` 均为空，与本功能无关 |
| `pytest tests/test_agent_toolkit_settings.py tests/test_agent_toolkit_settings_yolo.py -q` | **55 passed** |
| 行数棘轮（§5.2.1 / AC-E3） | 四个超线文件：`useAgentExecution.ts` 855 → **850**、`VideoEditingInterface.tsx` 2471 → **2471**、`AgentToolkitSettingsPanel.tsx` 818 → **817**、`types/index.ts` 1002 → **1002**；其余改动/新增文件均 ≤ 800（最大 `chat/route.ts` 763） |

### J. 已知缺口（如实登记，不静默）

- **AC-A1 的 route 半边无自动化测试**：`readAutonomy` 是 `route.ts` 内部函数，Next.js 的 route 模块**不允许**额外具名导出（构建期会判为非法导出），因此无法单测；本仓库既有的 `readCompositionId` 采取同一约定，也没有 route 级用例。AC-A1 由 `agent.yolo.test.ts` 钉住下游（`createVideoEditingAgent` 收到的值），上游白名单靠代码评审与手工验收。
- **AC-C9 的双入口同步**目前是 store 级 + hook 级证据（`autonomyStore.test.ts` 并发只发一次 GET、广播、回滚；`useAgentYoloMode.test.tsx` 两个实例共享同一快照），没有「设置中心 + 剪辑台两个真实组件同时挂载」的集成用例。手工脚本 §9.2 第 6 条覆盖该场景。

### K. 提交（本节点）

按仓库约定 `feat:` 前缀提交（近三轮功能提交 `b0d59ef8` / `511f8136` / `5837895c` 均为 `feat:`）。只 `git add` 本功能相关文件，未包含构建产物、`.agentmesh/` 运行时文件或 `.task-prompt-*`。
