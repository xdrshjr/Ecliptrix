# 剪辑 Agent 运行中插话、技能库与对话交互升级设计方案（agent-steering-and-skills）

> 版本 **v2**（v1 → v2：设计评审后修订，见下方「评审记录」；正文已吸收全部 P0/P1 修订，条目内以 〔评审 R-xx〕 标注）· 2026-10-27 · 设计基线 HEAD = `75a27492` · 本文只描述设计，不含实现代码。
> 前置方案（均已实现并提交，本文不重复其内容）：
> `agent-general-capabilities`（联网搜索/抓取/受控浏览器/素材下载）、`agent-general-toolkit`（工作区/文档/分析/计划/询问/记忆）、`agent-stop-and-resume`（停止与续跑）、`agent-visual-review`（视觉审阅与 15 条静态自检）。

---

## 评审记录

> 评审人：Anthropic 工程评审（设计评审节点）· 范围：对 v1 全文逐节核对，并与代码库现状交叉验证（`pi-agent-core` 源码、`chat/route.ts`、`SSEStreamManager.ts`、`systemPrompt.ts` 及其预算测试、`toolkitAdapter.ts`、`prepare-backend.js`、`researchUiOrigin.ts`）。
> 结论摘要：方案方向正确、与既有约定一致、可在现有技术栈内落地；v1 存在 **0 个 P0、10 个 P1、10 个 P2**。全部 P1 已在正文修订（状态「已修订」），P2 已择要吸收（状态「已吸收」）或明确为实施注意事项。

### 已核实无误（评审通过项）

- `Agent.steer()/followUp()`、默认 `steeringMode='one-at-a-time'`、工具完成后检查插话并**跳过同批剩余工具**、`prompt()` 运行中抛错：与 `agent.js:148-218`、`agent-loop.js:61-114,207-275` 一致。
- 插话在送达时以**同一对象引用**发出 `message_start`（`agent-loop.js:78`），§3.2.2 的引用相等匹配成立；`AgentEventRouter` 对 `message_start` 无状态副作用，不会把 user 消息误当 assistant 消息渲染。
- 路由结构：Agent 每请求新建；`triggerAbort` 为唯一幂等终止出口；`finally` 先 `[DONE]` 再关流；`conversationHistory.slice(0,-1)`（`agent.ts:142`）已把本轮用户消息排除在历史之外 → §3.3.5「技能块只进本次提示、不进历史」成立。
- `L0_PROMPT_CHAR_CEILING = 18_900`、既有断言（≤ 18 500，AC-19）、`RESULT_BYTE_CAP = 12 KiB`、`toolkitResult` 的头尾截断兜底、`prepare-backend.js` 整目录复制 `app`（仅滤 `__pycache__`/`.pyc`，`SKILL.md` 会随包）：均与 §2 事实表一致。
- 规模判断：与前四轮同量级；四批可独立合并；无 DDL；降级路径（技能服务失败 → 无技能；登记表缺失 → 排队）完整。

### 评审意见

| 编号 | 严重度 | 维度 | 问题 | 处置 |
|---|---|---|---|---|
| R-01 | **P1** | 一致性 / 完整性 | §3.2.3 声称「断线重连后是同一个 SSE 事件流的回放，`runId` 不变」，**与事实相反**：`SSEStreamManager.ts:11-17` 明确写明路由不能续跑，每次连接都**从头重跑 Agent**并重新从 0 编号，重连 = 新 `runId`（且仅在尚未出现任何工具调用时才会重连，`:266-272`）。按 v1 实现，重连后客户端仍拿旧 `runId` 去 `POST /steer`，得到 404 并被迫降级；或更糟，旧 `sent` 状态的插话永远停留在「待送达」。 | 已修订（§3.2.3、§3.2.4：`onRestart` 清空 `runId`，未送达插话回到 `local`，待新 `run_started` 后补发；新增 AC-A10） |
| R-02 | **P1** | 完整性（边界） | 技能 `id` 正则 `^[a-z][a-z0-9-]{2,39}$` 允许 `index`、`validate`，与 `GET /index`、`POST /validate` 路径**碰撞**（BFF 白名单正则里 `index` 同时是端点和合法 id）；同时允许 `con`、`nul`、`aux`、`prn`——桌面端主力平台是 Windows，这些是**设备保留名**，`mkdir` 会失败或行为异常。 | 已修订（§3.3.2 增保留字表；§3.3.4 路径安全；新增 AC-B11） |
| R-03 | **P1** | 可行性 | §3.3.1「3 500 × 3 字节 = 10 500 < 12 288」只对 ≤ 3 字节字符成立；emoji/CJK 扩展 B 为 4 字节，3 500 个这样的码点达 14 000 字节，`toolkitResult` 会头尾截断，**违背「正文未被截断」的保证**（AC-B6 也只测纯中文）。 | 已修订（§3.3.1、§3.3.2 增加 UTF-8 字节上限 10 240；AC-B6 增 4 字节字符夹具） |
| R-04 | **P1** | 一致性（安全面） | L0 索引里的 `description` 是用户可写文本，却进入**系统提示词**。v1 只说「当用户自有内容处理」，没有任何规范化：YAML 块标量可以带换行，使描述伪装出新的标题/规则行。另外数字不自洽：`id`（≤ 40）+ `description`（≤ 90）+ 分隔 > 110 的「行宽硬截」，会静默截断合法描述；`[unavailable: web]` 后缀还要再占位。 | 已修订（§3.3.2：`description` 必须单行、禁控制字符与 Markdown 标题前缀、≤ 60 码点；§3.3.1/§3.3.5：行宽 ≤ 130、总长 ≤ 1 300，含后缀） |
| R-05 | **P1** | 可行性 / 完整性 | AC-B8 的 `≤ 17 000` / `≤ 18 900` 是**未经实测的估算数**；现有 `systemPrompt.toolkit.test.ts:74-77` 已把最坏情形钉在 ≤ 18 500，可用余量只有 400 字符，而 v1 新增索引（≤ 1 100）+ 引导句 + 工具提示，仅靠删配方 1–3（实测约 1.2–1.4 K）抵消，余量薄。v1 把「净增 ≤ 400」当结论，没有给出验证手段。 | 已修订（§3.3.3、AC-B8：以**既有断言 ≤ 18 500 不放宽**为准，新增「净增量」断言并在实施记录里写实测数；实施首步先测基线） |
| R-06 | **P1** | 一致性 / 完整性 | AC-G2「所有新增/改动文件 ≤ 800 行」**无法满足**：`useAgentExecution.ts` 现 916 行、`i18n.ts` 现 10 753 行，均在改动清单中。DoD 因此不可达，或迫使实施者“悄悄忽略数字”（CLAUDE.md 明令禁止）。§3.2.4 只写“净减少或持平”，与 AC-G2 自相矛盾。 | 已修订（AC-G2 改为棘轮规则：基线 ≤ 800 的文件不得越线；基线已超的文件不得增长，`useAgentExecution.ts` 目标降到 ≤ 800，`i18n.ts` 作为数据文件豁免并写明理由） |
| R-07 | **P1** | 完整性（错误路径） | 请求带 `skillId` 但服务端取不到技能（不存在 / 已禁用 / `valid:false` / 后端超时 / 客户端缓存过期）时，v1 **没有定义行为**。静默忽略会让用户以为技能生效了；报错会让一次可降级的失败变成整轮失败。 | 已修订（§3.3.5 增降级规则 + 新 SSE 事件 `skill_skipped`；§5.3、§12 同步为 4 个新事件；新增 AC-B12） |
| R-08 | **P1** | 完整性（边界） | 回合因 `ask_user` 正常结束时，v1 的「回合 completed 且队列非空 → 自动发送」会把排队文本**当作对 Agent 提问的回答**自动提交，而用户排队时并不知道会有这个问题。这会静默触发一次可能计费的新回合。 | 已修订（§3.2.4：以 `ask_user` 收尾的回合不自动发送，队列回填输入框；AC-A5 补充） |
| R-09 | **P1** | 可行性 | 插话与 `close()` 的竞态窗口未收口：`triggerAbort`（停止/超时）路径下 Agent 已被中止，但 v1 的登记项直到 `finally` 才 `close()`，期间 `POST /steer` 仍返回 `202`——文本被「接受」后无人处理。另外 `steer_dropped` 在 `cancelled`/`error` 之后发出时，客户端（按 `SSEStreamManager` 约定）已停止读流，**收不到**。 | 已修订（§3.2.2：`close()` 同时挂到 `triggerAbort`，幂等；§3.2.3：明确 cancel/error 路径的“未送达”完全依赖客户端兜底，SSE `steer_dropped` 仅用于 completed 路径） |
| R-10 | **P1** | 完整性 | `steer` 端点的守卫顺序与既有 helper 不一致：`researchOriginAllowed(request, true)` 在 `write=true` 时已把 `content-type: application/json` 校验折进去（`researchUiOrigin.ts:20`），不先判 Content-Type 就会把「缺 JSON 头」报成 `403 origin_forbidden` 而不是规格里的 `415 json_required`，使状态码矩阵测试与实现必然对不上。 | 已修订（§3.2.2 表：先 Content-Type → 415，再以 `write=false` 调用 Origin 检查，或在测试矩阵中以 403 为准——本方案采用前者） |
| R-11 | P2 | 可行性 | `steeringMode` 默认 `one-at-a-time`：连发 2–3 条插话时每次模型回合只送达 1 条，后一条要等再一次工具/回合边界，用户看到的是“分次生效”。 | 已吸收（§3.2.2：`createVideoEditingAgent` 将 `steeringMode` 设为 `'all'`，同批插话一次送达，各自独立发 `steer_applied`，`afterToolCallId` 相同） |
| R-12 | P2 | 完整性 | 插话在**第一次**模型调用前到达时，pi 在循环起点即送达（`agent-loop.js:61-62`），此时 `afterToolCallId` 为 `null`；v1 的回放与 `SteerNoteNode` 定位只写了「找不到则…」。 | 已吸收（§3.2.5 明确 `null` ⇒ 追加在该回合第一条 assistant 消息之前；补测试用例） |
| R-13 | P2 | 完整性（安全） | `mentions` 的 `materialId` 未对照本轮 `materials` 校验；`label` 含换行时可在提示里伪造段落；技能正文含 `</skill>` 可提前闭合包裹标签。均仅影响用户自己的会话，但成本极低。 | 已吸收（§3.3.5：丢弃未知 `materialId`、`label` 折叠为单行、技能正文中的 `</skill>` 转义） |
| R-14 | P2 | 完整性（安全） | `yaml.safe_load` 对**别名炸弹**（`&a`/`*a` 嵌套展开）无防护，64 KiB 总上限不足以兜底；YAML 隐式类型会把 `name: yes` 解析成布尔、`id: 123` 解析成整数。 | 已吸收（§3.3.2：frontmatter ≤ 4 KiB、拒绝锚点/别名、所有字符串字段严格 `isinstance(str)` 不做类型转换） |
| R-15 | P2 | 完整性 | `SkillStore` 的「≤ 50 个」检查与创建之间无互斥；Windows 上 `os.replace` 目标被杀软/预览占用会抛 `PermissionError`。 | 已吸收（§3.3.4：写路径持 `asyncio.Lock`；`os.replace` 重试 3 次 × 50 ms，仍失败返回 `internal_error`） |
| R-16 | P2 | 完整性 | §5.2 引入 `use_skill` 后，既有测试 `systemPrompt.toolkit.test.ts:89` 的 `CORE_TOOLKIT_TOOL_NAMES.toHaveLength(18)` 必然失败，v1 的测试清单与 §12 契约登记未点名。 | 已吸收（§7.3、§12 补登该断言的同步修改） |
| R-17 | P2 | 一致性 | §3.2.2 `createRunHandle` 依赖里保留了 `triggerAbort: ... // 不使用` 的占位，属噪声，且与 R-09 的 `close()` 接线冲突。 | 已吸收（占位删除，改为 `route.ts` 在 `triggerAbort` 内调用 `handle.close()`） |
| R-18 | P2 | 适度性 | 范围偏大（约 60 个文件、4 批）。B4 中的 ↑ 回溯、消息复制、草稿保留、失败重试均为 P2 体验项，与 A/B/D 主线无依赖，却被纳入同一 DoD，任一项卡住都会阻塞整轮交付。 | 已吸收（§14：B4 的 P2 项设为「可裁剪」，裁剪须在实施记录登记，不阻塞 DoD；A/B/D 与总结卡、Esc、`@` 为必交付） |
| R-19 | P2 | 完整性 | 插话回放产生 `toolResult → user` 的相邻结构；不同 `api_type`（openai-completions / anthropic）对「连续 user 消息」的转换行为不同。实时路径由 pi 自己产生同样序列，风险低，但回放路径应有覆盖。 | 已吸收（§7.3：`messageConverter.steer.test.ts` 增 anthropic 与 openai 两种转换夹具） |
| R-20 | P2 | 一致性 | `agent-skills` 的 `GET /index` 与 `/{id}` 对 `x-tool-call-id` 的要求在表里写法不一，易被误读为“`loadSkillIndex` 无 call id 会 400”。 | 已吸收（§3.3.5：`loadSkillIndex` 与 `loadMemoryDigest` 一样自带 `Origin` 与 `callIdFor(projectId)`） |

---

## 1. 概述

前四轮已经让剪辑 Agent 具备"能上网找素材、能读文档、会列计划、能看图自检"的能力。把这些能力放在一起使用一周后，剩下的短板不再是"缺工具"，而是**人和 Agent 协作的方式**与**能力的沉淀方式**：

1. **Agent 一旦开跑，用户就只能干等或"停止"。** 现状：`VideoChatWindow.tsx:317` 的 `inputDisabled = isLoading || agentIsExecuting`，输入框整体禁用；`useAgentExecution.ts:610` 在 `agentIsExecutingRef.current` 为真时直接 `return`。而一次"做 60 秒资讯视频"的回合动辄 3–10 分钟（搜索、下载、TTS、生成），用户看到 Agent 选错方向时唯一的补救是停止并从头来过，已完成的搜索与下载白白浪费。参考实现 AragonAgent 的核心引擎早就有 `steer()`（在当前工具完成后插入用户消息）与 `followUp()`（回合结束后再处理）两条队列；本项目所用的 `@mariozechner/pi-agent-core@0.57` 同样提供（`node_modules/@mariozechner/pi-agent-core/dist/agent.d.ts:131,136`），但 Ecliptrix 一次都没有用过。
2. **好的剪辑套路只存在于一段写死的提示词里。** `promptParts.ts:109` 的 `WORKFLOW_RECIPES_MD` 是 4 条静态配方，每次对话都占约 1.7 K 字符的 L0 预算，用户既不能增删，也看不到、改不了。AragonAgent 用"技能（Skill）"解决同一问题：L0 只放名称与一句话说明，模型按需加载正文，用户可以自己写。本项目已有 18 个工具类别、`explore_tools` 渐进式披露，缺的只是"套路"这一层。
3. **对话区的反馈仍停在"工具卡片堆叠"。** 回合结束没有"本轮到底改了什么、有没有遗留问题、下一步做什么"的收束；忙碌条（`AgentBusyBar.tsx`）只显示"正在运行 xxx 工具"，不显示计划进度与已用时；输入区没有 `/` 技能、`@` 素材引用、↑ 历史回溯、草稿保留、Esc 停止这些现代对话产品的基本动作。
4. **联网素材缺少"授权账本"。** `web_media_download.py:80-90` 已为每个网络素材记录 `provenance.license_status`（现状几乎全为 `unknown`）、作者、来源页，但没有任何一处向用户或 Agent 暴露——Agent 把授权不明的网络素材直接上轨并导出，用户毫不知情。这是"能上网下素材"能力的最后一块安全与可信度缺口。

本方案的定位是**把前四轮的能力收束成一个顶级的协作产品**，分四条主线，互相独立可分批上线：

| 主线 | 一句话 | 对用户的可见变化 |
|---|---|---|
| **A 运行中插话（Steering）** | 回合运行时输入框保持可用：Enter＝插话（当前步骤结束后送达），Alt+Enter＝排队（回合结束后自动作为下一轮） | 看到 Agent 跑偏可以立刻纠正，不必停止重来 |
| **B 技能库（Skills）** | 把 4 条静态配方改造为 6 个内置技能 + 用户自建技能；三级渐进披露；`/` 菜单显式调用；设置中心管理 | 套路可见、可选、可改、可分享 |
| **C 对话交互升级** | 回合总结卡、进度化忙碌条、`@` 素材引用、↑ 回溯、草稿保留、Esc 停止、失败重试 | 每一轮有交代，输入更顺手 |
| **D 素材来源与授权账本** | 第 16 条静态自检 `web_material_license_unknown` + 新工具 `build_credits` 生成来源清单 | 联网素材授权不明会被提示，导出前可一键生成署名清单 |

**不做的事**（见 §13）：多模态直传图片给主模型、子代理、运镜工具化、云端技能市场。本轮坚持三条纪律：**① 零破坏性 DDL**（本轮不新增任何数据库表）；**② 每一项能力都是可选的、失败时降级为"现状行为"**（插话失败＝按排队处理；技能服务不可用＝回到无技能的 Agent）；**③ L0 提示词总量基本持平**（相对实测基线净增 ≤ 400 字符，且既有最坏情形断言 ≤ 18 500 不放宽、`L0_PROMPT_CHAR_CEILING = 18 900`（`systemPrompt.ts:359`）不抬高；〔评审 R-05〕核算方法见 §3.3.3）。

---

## 2. 现状基线（已核实事实）

| # | 事实 | 证据 |
|---|---|---|
| F-01 | Agent 在 Next.js 路由里**每个请求新建一个实例**（无状态），一次回合 = 一个 SSE 长连接，取消 = 客户端中断流 | `src/app/api/video-editing-agent/chat/route.ts:311-700`，`agent.prompt(lastUserMessage)` 在 `:641-653` |
| F-02 | 没有"运行句柄"登记：路由局部变量 `refs.agent` 只在 `start()` 闭包内可见，外部无法向运行中的 Agent 发消息 | `route.ts:439-470` |
| F-03 | pi-agent-core 的 `steer(m)`：当前**工具执行完成后**送达，且**跳过同批剩余工具调用**；`followUp(m)`：仅在无更多工具调用/插话时送达；`prompt()` 在运行中调用会抛错 | `agent.js:148-156,215-218`；`agent-loop.js:61-114,207-275` |
| F-04 | 插话消息在送达时会产生 `message_start`/`message_end` 事件（role=user），可用来确认"已送达" | `agent-loop.js:78-79` |
| F-05 | 客户端输入框在运行中整体禁用；发送函数在运行中直接 return | `VideoChatWindow.tsx:317`、`:158`；`useAgentExecution.ts:610` |
| F-06 | 回合级撤销已存在（`undoAllOperations`、`undoSingleOperation`），会话内保留 `OperationApplier` | `useAgentExecution.ts:756-854` |
| F-07 | L0 提示词静态配方段 `formatWorkflowRecipes()` 每次都注入；`WORKFLOW_RECIPES_MD` 无其他调用点 | `systemPrompt.ts:336,580`；`promptParts.ts:109-136` |
| F-08 | 常驻核心工具集 `CORE_TOOLKIT_TOOL_NAMES` 由 `promptParts.ts` 维护，`update_plan`/`ask_user`/`check_timeline` 属 `workflow_tools` 常驻类别 | `promptParts.ts:60-100`；`registry/categories.ts:15-60` |
| F-09 | 工具按需加载每次 ≤ 4 个、总活跃 ≤ 12、受模式字节预算约束；`ToolActivationState.load(category, names?)` 是唯一入口 | `registry/ToolActivationState.ts:50-76` |
| F-10 | 单条工具结果上限 `RESULT_BYTE_CAP = 12 KiB`；中文 3 字节/字，历史上因此踩过坑（toolkit D-21：`read_document` 8 000 字被截） | `tools/webToolAdapter.ts:12`；`agent-general-toolkit/spec.md` D-21 |
| F-11 | 服务端工具访问后端的统一出口 `executeToolkitTool(context, callId, call)`：写方法自动带 `Origin`，读带 `x-tool-call-id`，路径固定拼到 `/api/agent-toolkit` 后；`visionAdapter.ts` 复制了一份拼 `/api/agent-vision` | `tools/toolkitAdapter.ts:161-200`；`tools/visionAdapter.ts:287` |
| F-12 | 后端路由守卫模板：`validate_toolkit_origin` → `require_capability` → `_call_id`；错误信封 `error_response`；`main.py` 在 `:709-730` 为每个域注册路由与异常处理器 | `app/routers/agent_toolkit_router.py:61-156`；`main.py:709-730` |
| F-13 | BFF 采用**白名单代理**（方法 × 路径正则，未登记即 404），写方法强制 Origin | `src/app/api/agent-toolkit/[...path]/route.ts:15-24` |
| F-14 | 桌面打包 `prepare-backend.js:18` 的 `COPY_ENTRIES` 整目录复制 `app`，因此放在 `app/` 下的非 `.py` 资源（本方案的内置技能 `SKILL.md`）会随包发布 | `desktop/scripts/prepare-backend.js:18` |
| F-15 | 网络素材已携带 `metadata.provenance`（`license_status`: `unknown`/`declared`、`license_url`、`author`、`source_page_url`、`retrieved_at`） | `web_media_download.py:80-90`；`src/types/index.ts:652` |
| F-16 | 静态自检 15 条，规则表 `LINT_RULE_CODES`、纯函数 `lintTimeline`、`checked_rules` 回显全部规则码 | `tools/qualityLint.ts:39-57,544`；agent-visual-review §4.10 |
| F-17 | PyYAML 6.0.2 已在后端环境（配置本就读 YAML），解析 SKILL.md 的 frontmatter 不需要新增依赖 | `python -c "import yaml"` 实测 |
| F-18 | 输入法合成中的 Enter 已被拦截（`nativeEvent.isComposing`），新的键位逻辑必须保留这一行为 | `VideoChatWindow.tsx:178` |

---

## 3. 总体设计

### 3.1 分层与数据流

```
┌─────────────── Renderer（Next.js 页面）────────────────┐
│ VideoChatWindow（输入区）                              │
│   ├─ ComposerSkillPicker  ( / )   ─┐                  │
│   ├─ ComposerMentionPicker( @ )   ─┤→ 发送载荷 skillId / mentions
│   ├─ SteerQueue（待送达芯片）                           │
│   └─ Enter → useAgentSteering.submit()                 │
│        ├ 空闲 → sendAgentMessage（原路径）              │
│        └ 运行中 → POST /api/video-editing-agent/steer  │
│ TimelineChatPanel                                      │
│   ├─ SteerNoteNode（插话在回合时间线中的位置）           │
│   └─ TurnSummaryCard（回合总结与下一步）                 │
└──────────────┬─────────────────────────────────────────┘
               │ SSE: run_started / steer_applied / …
┌──────────────▼────── Next.js 服务端 ───────────────────┐
│ chat/route.ts ── 注册 ──> agentRunRegistry (globalThis) │
│ steer/route.ts ── 查表 ─> handle.steer(text) → agent.steer(msg)
│ skillContext.ts ── 读 ──> /api/agent-skills/index|{id}  │
│ tools: use_skill / build_credits                        │
└──────────────┬─────────────────────────────────────────┘
               │ loopback + BFF 白名单
┌──────────────▼────── FastAPI ──────────────────────────┐
│ /api/agent-skills  → agent_skills.store                 │
│   builtin: app/services/agent_skills/builtin/<id>/SKILL.md
│   user   : STORAGE_ROOT/agent_skills/<id>/SKILL.md      │
│   state  : STORAGE_ROOT/agent_skills/_state.json        │
└─────────────────────────────────────────────────────────┘
```

### 3.2 主线 A：运行中插话（Steering）

#### 3.2.1 语义：两种输入，一个入口

运行中用户可以做两件事，**键位固定**，避免模式切换的认知成本：

| 动作 | 键位 / 按钮 | 语义 | 实现 |
|---|---|---|---|
| **插话（steer）** | `Enter`；按钮文案"插话" | 当前正在执行的工具**完成后**送达，Agent 立即按新要求调整后续步骤；同批剩余工具调用被跳过（pi-agent-core 既有行为，F-03） | `POST /steer` → `agent.steer(msg)` |
| **排队（queue）** | `Alt+Enter`；输入区下拉"回合结束后发送" | 不打断；当前回合**正常完成**后自动作为下一轮用户消息发出 | **纯客户端**队列，不经服务端 |

空闲时 `Enter` 仍是普通发送，行为与现状完全一致。输入区 placeholder 在运行中改为：`补充说明或纠正方向，Enter 插话 · Alt+Enter 排队`（i18n，替换现有 `agentWorkingPlaceholder`）。

**重要的用户预期管理**：插话在"当前工具完成后"才生效。若当前是一个耗时工具（批量生成视频可达数分钟），芯片上必须诚实地显示"将在『{工具名}』完成后送达"，并提供"改为停止并重发"的次要动作（= `cancelByUser` 后以该文本发送新回合，复用 `agent-stop-and-resume` 的续跑注记）。

#### 3.2.2 服务端：运行登记表与 `steer` 端点

**`src/lib/server/agentRunRegistry.ts`（新建）**：进程内登记表，挂在 `globalThis[Symbol.for('ecliptrix.agentRuns')]`（Next 开发模式下各路由可能是独立模块实例，不能用模块级变量；打包后的 standalone 单进程同样适用）。

```ts
export interface SteerAcceptance {
  steerId: string;
  position: number;            // 1-based，当前待送达队列中的位置
}
export interface AgentRunHandle {
  readonly runId: string;      // crypto.randomUUID()，仅在本次 SSE 连接生命期内有效
  steer(input: { steerId: string; text: string }): SteerAcceptance; // 可抛 SteerError
  pendingCount(): number;
  close(): void;               // 回合结束时调用，之后 steer 一律 run_closed
}
export class SteerError extends Error {
  constructor(readonly code: 'run_not_found' | 'run_closed' | 'steer_queue_full'
    | 'invalid_steer' | 'duplicate_steer') { super(code); }
}
export function registerRun(handle: AgentRunHandle): void;
export function unregisterRun(runId: string): void;
export function getRun(runId: string): AgentRunHandle | undefined;
```

**限制（常量集中在该文件）**：`MAX_PENDING_STEERS = 3`；`STEER_MAX_CHARS = 2000`（按 Unicode 码点计，`Array.from(text).length`）；`STEER_TTL_MS`：登记项在 `close()` 后 30 秒才从表中删除（让迟到的请求拿到明确的 `run_closed` 而不是含糊的 404）。

**`createRunHandle`（在 `chat/route.ts` 之外的新模块 `src/app/api/video-editing-agent/chat/runLifecycle.ts`，使 `route.ts` 增量 ≤ 30 行，避免突破 800 行红线）**：

```ts
export function createRunHandle(deps: {
  agent: Agent;                         // pi-agent-core
  send: (event: SSEEvent) => void;
}): AgentRunHandle & { onAgentEvent(event: AgentEvent): void }
```

行为：
1. `steer({steerId, text})`：校验去空白后长度 1..2000、`steerId` 匹配 `^[A-Za-z0-9_-]{8,64}$`、未重复、`pending < 3`，否则抛 `SteerError`。构造消息对象
   `msg = { role: 'user', content: [{ type: 'text', text: STEER_WRAPPER(text) }], timestamp: nextTimestamp() }`，把 `msg` **引用**记入 `pending: Map<steerId, msg>`，调用 `agent.steer(msg)`。
2. `STEER_WRAPPER(text)` = `用户在你执行过程中补充了要求（优先于之前的计划，已完成的操作保留）：\n${text}`。常量定义在 `src/lib/video-editing-agent/promptParts.ts`，并在 `AGENT_TOOLKIT_GUIDANCE` 里加一句"收到执行中补充的要求时，先用一句话确认并调整计划（update_plan），再继续"。
3. `onAgentEvent`：监听 `message_start`，当 `event.message === msg`（引用相等；若 pi 在传递中克隆了对象，回退为 `timestamp` 相等且首个文本块相等）时，发出 SSE `steer_applied { steerId, afterToolCallId }`（`afterToolCallId` = 最近一次 `tool_execution_end` 的 `toolCallId`，没有则 `null`），并从 `pending` 删除。`timestamp` 由 `nextTimestamp()` 保证单调递增（`Math.max(Date.now(), last + 1)`），使回退匹配不会误中。
4. `close()`：**幂等**。把仍在 `pending` 的 `steerId` 一次性通过 SSE `steer_dropped { steerIds }` 告知客户端（客户端据此把它们转为"排队"，见 §3.2.4），然后标记关闭，此后 `steer()` 一律抛 `run_closed`。〔评审 R-09〕**两处调用**：（a）`finally` 中、`[DONE]` 之前（completed 路径）；（b）`triggerAbort` 内、发出 `cancelled` **之前**（停止/超时/断流路径），使 Agent 已被中止后到达的插话得到 `409 run_closed` 而不是被“接受”后无人处理。`route.ts` 的接线只有这两行调用，不新增分支。
5. 〔评审 R-11〕**同批送达**：`createVideoEditingAgent` 创建 `Agent` 后调用 `agent.setSteeringMode('all')`（`agent.d.ts` 已提供；默认 `one-at-a-time` 会让连发的多条插话每个模型回合只送 1 条，表现为"分次生效"）。同批送达的各条插话各自触发一次 `message_start`，因此各自发 `steer_applied`，`afterToolCallId` 相同。`followUpMode` 保持默认，本轮不使用 `followUp()`（排队是纯客户端行为）。
6. 〔评审 R-12〕插话在**第一次模型调用之前**到达时，pi 在循环起点即送达（`agent-loop.js:61-62`），此时 `afterToolCallId = null`，语义为"本回合开头"。

**`POST /api/video-editing-agent/steer`（`steer/route.ts`，新建）**：

| 项 | 规则 |
|---|---|
| 请求 | `Content-Type: application/json`，`{ runId: string, steerId: string, text: string }`，体上限 16 KiB |
| 鉴权 | 与其他 BFF 一致使用 `researchOriginAllowed`（`src/lib/server/researchUiOrigin.ts:5`）。〔评审 R-10〕守卫顺序固定为：**① Content-Type 非 `application/json` → 415 `json_required`；② `researchOriginAllowed(request, false)` 为假 → 403 `origin_forbidden`；③ 校验 `Origin` 头存在**（该 helper 在 `write=true` 时把 Content-Type 校验也折进去并返回 `false`，直接传 `true` 会把缺 JSON 头误报成 403，故不使用 `write=true`，而在②之外显式要求 `Origin` 头存在，缺失同样 403） |
| 成功 | `202 { success: true, data: { steerId, position } }` |
| 失败 | `404 run_not_found`、`409 run_closed`、`429 steer_queue_full`、`409 duplicate_steer`、`422 invalid_steer`（含文本为空/超长/steerId 非法）、`415 json_required`；统一 `{ success:false, error_code, message }` |
| 幂等 | 同一 `steerId` 重复提交 → `409 duplicate_steer`（客户端重试安全）；客户端把 409 视为"已受理" |
| 日志 | 只记 `runId` 前 8 位、`steerId`、字符数，**不记正文** |

**SSE 新事件**（追加到 `types.ts` 的 `SSEEvent` 联合，`AgentEventRouter` 与 `SSEStreamManager` 同步识别）：

```ts
| { type: 'run_started'; runId: string }                 // agent 创建并登记后立即发送，早于 agent_start
| { type: 'steer_applied'; steerId: string; afterToolCallId: string | null }
| { type: 'steer_dropped'; steerIds: string[] }          // 回合结束时仍未送达（仅 completed 路径可靠，见 §3.2.3）
| { type: 'skill_skipped'; skillId: string; reason: 'not_found' | 'disabled' | 'invalid' | 'unavailable' } // 〔评审 R-07〕§3.3.5
```

`run_started` 之前（思考阶段 `performThinkingPhase`，`route.ts:74-157`）客户端尚无 `runId`，此期间的插话先保存在客户端 `pending-local` 状态，收到 `run_started` 后统一补发（§3.2.4）。

#### 3.2.3 与既有机制的相容性

| 机制 | 相容方式 |
|---|---|
| **停止**（cancel） / **错误** / **超时** | 〔评审 R-09〕`triggerAbort` 先 `close()` 再发 `cancelled`；但客户端按 `SSEStreamManager` 约定**读到 `cancelled`/`error` 即停止读流**，随后的 `steer_dropped` 收不到。因此：在 cancelled/error 路径，"未送达"**完全由客户端兜底**——客户端把所有 `local`/`sent`/`queued` 的插话与排队文本**回填到输入框**（用空行连接），并 toast"未送达的补充已放回输入框"。SSE `steer_dropped` 只用于 completed 路径（把 `sent` 转为 `queued`）。绝不丢用户输入 |
| **看门狗/超时** | `steer` 被接受不重置看门狗（避免用插话"续命"一个卡死的回合）；但 `message_start` 触发的既有 `resetTimeout` 路径照常工作 |
| **断线重连**（`SSEStreamManager` 自动重试） | 〔评审 R-01，修正 v1 的错误断言〕路由**不能续跑**：重连 = 对同一条用户消息**从头重跑 Agent**，事件从 0 重新编号，**新的 `runId`**（`SSEStreamManager.ts:11-17`）；且仅在本轮尚未出现任何工具调用时才会重连（`:266-272`），因此重连前不可能有已 `applied` 的插话。处理：`SSEStreamManager.onRestart` 触发时，客户端 `useAgentSteering` 清空当前 `runId`，把所有 `sent` 状态的插话**退回 `local`**，待新 `run_started` 到达后统一补发；旧 run 因流被取消，其登记项由 `triggerAbort → close()` 关闭（旧 `runId` 之后到达的 `steer` 得 `409 run_closed`/`404`，客户端对这两码一律按"已转 `local`"处理，不再重复提交）。若服务端进程已重启，`steer` 得 `404 run_not_found`，客户端降级为排队 |
| **ask_user** | `ask_user` 使回合在提问后正常结束（既有"无中断-恢复协议"），此时无运行句柄，输入走普通发送，不是插话 |
| **回合级撤销** | 插话本身不产生时间线操作，不进入 `OperationApplier`；撤销整回合时插话文本保留在对话里（它是用户说过的话） |
| **时间线编辑锁** | 运行中编辑器已被锁定（round 2），因此服务端副本不会与用户手动编辑分叉；本方案不改变此点 |
| **工具跳过** | 插话使同批剩余工具被 pi 标为跳过；客户端卡片对该类结果已有"cancelled/skipped"呈现（沿用，不新增状态） |

#### 3.2.4 客户端状态机

新增类型（`src/types/agentSteering.ts`，新建）：

```ts
export type SteerStatus = 'local' | 'sent' | 'applied' | 'queued' | 'failed';
export interface SteerNote {
  id: string;                 // steerId，crypto.randomUUID().replace(/-/g,'')
  text: string;
  status: SteerStatus;
  createdAt: number;
  afterToolCallId?: string | null;   // 仅 applied 有意义
}
export interface QueuedFollowUp { id: string; text: string; createdAt: number }
```

`ChatMessage`（`src/types/index.ts:62`）追加可选字段 `steers?: SteerNote[]`（挂在**该回合的 agent 消息**上，随会话持久化；旧数据无此字段即视为空）。

状态转移：

```
Enter（运行中）
  ├─ runId 未知（思考阶段）         → local  ──run_started──→ sent
  └─ runId 已知                     → sent（POST /steer，202 即受理）
sent ──steer_applied──→ applied（附 afterToolCallId，芯片转为回合时间线节点）
sent ──steer_dropped / 回合结束 / 404 / 409 run_closed──→ queued（进入 QueuedFollowUp 队列；〔评审 R-01〕仅当该响应对应的 runId 仍是**当前** runId 时才套用，对已被 onRestart 作废的旧 runId 的迟到响应一律忽略）
sent ──429──→ failed（toast"待送达已满（3 条），请稍后"，文本放回输入框）
sent ──onRestart（SSE 自动重连，新 run）──→ local ──新 run_started──→ sent   〔评审 R-01〕
Alt+Enter                           → 直接入 QueuedFollowUp 队列
回合 completed 且队列非空且回合不以 ask_user 收尾 → 合并（以 "\n\n" 连接）为**一条**用户消息自动发送
回合 completed 但以 ask_user 收尾    → 队列回填输入框，不自动发送（toast"Agent 在等你回答，补充内容已放回输入框"）〔评审 R-08〕
回合 cancelled / error               → 队列全部回填输入框，不自动发送
```

〔评审 R-08〕**判定"以 ask_user 收尾"**：该回合最后一条 agent 消息的 `agentToolCalls` 末项为 `ask_user` 且 `answeredQuestionIds` 中尚无其 id（与 `VideoChatWindow.tsx:132` 的"未回答问题"扫描同源，复用同一个纯函数，不另写第二份判定）。原因：自动提交会把排队文本当成对提问的回答并静默触发一次可能计费的新回合，而用户排队时并不知道 Agent 之后会提问。

**总量上限**：待送达插话 + 排队 ≤ 3 条（与 `MAX_PENDING_STEERS` 对齐），超出时输入框抖动一次并提示。**自动发送**前再次检查"当前没有更新的运行"，且发送前等待既有 `eventChainRef` 排空（沿用 `sendAgentMessage` 开头逻辑，`useAgentExecution.ts:614`）。

**新 hook `src/components/video/hooks/useAgentSteering.ts`**：封装上述状态机，对外：
`{ steerNotes, queued, submit(text, mode: 'steer'|'queue'), cancelNote(id), promoteToStop(id), onRunStarted(runId), onRestart(), onSteerApplied(e), onSteerDropped(e), onTurnEnd({ reason, endedWithAskUser }), drainToDraft() }`。`useAgentExecution` 只负责把 SSE 事件转交给它，不内嵌状态机，以满足 CLAUDE.md "函数 ≤ 50 行 / 文件 ≤ 800 行"（〔评审 R-06〕`useAgentExecution.ts` 现 916 行，已超红线：**本轮目标降到 ≤ 800 行**，做法是把 `sealMessage`、`cancel*` 相关纯逻辑随新 hook 一并抽出到 `agentTurnLifecycle.ts`；若抽出后仍 > 800，则须"不高于基线 916"并在实施记录登记剩余债务，见 AC-G2 棘轮规则）。

**`cancelNote(id)`**：芯片的 ✕。`local` 状态直接删除；`sent` 状态无法从 pi 队列撤回（`agent.steer` 无取消接口），因此芯片 ✕ 只在 `local` 与 `queued` 状态可用；`sent` 状态的 ✕ 禁用并给 tooltip"已提交，将在当前步骤结束后送达"。这是诚实的取舍，不做"假撤回"。

#### 3.2.5 历史回放（让模型在后续回合看到插话）

`messageConverter.ts` 在把某个 agent 消息还原为 pi 消息序列时，对 `steers` 中 `status === 'applied'` 的条目，在 `afterToolCallId` 对应的 `toolResult` **之后**插入一条 user 消息（内容为 `STEER_WRAPPER(text)`）；`afterToolCallId` 为空（本回合开头送达，见 §3.2.2 第 6 点）或找不到则插在该回合**第一条** assistant 消息之前；〔评审 R-19〕转换结果必须同时在 `openai-completions` 与 `anthropic` 两种 `api_type` 的 pi 消息转换下不产生非法的消息序列（`toolResult` 之后紧跟 user 消息）。`queued`/`failed`/`local`/`sent` 状态**不回放**（前两者已作为独立用户消息存在，其余未送达）。`historyBudget`/`compactHistoryForModel` 对这类 user 消息按普通 user 消息处理，无需特判。

### 3.3 主线 B：技能库（Skills）

#### 3.3.1 概念与边界

**技能 = 一份带 frontmatter 的 Markdown 剪辑套路**（SKILL.md）。它不是工具，不授予任何新权限：技能只能（a）告诉模型"这类任务怎么做"，（b）预加载它声明的、**本来就存在的**工具。联网、下载、生成等能力的开关与确认仍由各自的设置与网关控制（`agent-general-capabilities` §3.4–3.7 不变）。

三级渐进披露（对齐 AragonAgent 与本项目既有 explore_tools 思路）：

| 级 | 内容 | 位置 | 预算 |
|---|---|---|---|
| L0 | 每个启用技能一行：`- {id}: {description}[ [unavailable: …]]`，最多 10 行 | 系统提示词"可用技能"段 | 〔评审 R-04〕≤ 1 300 字符（每行 ≤ 130，含不可用后缀）；`description` ≤ 60 码点 |
| L1 | 技能正文（步骤、注意事项） | `use_skill(id)` 工具结果，或用户 `/` 显式调用时注入本轮 user 提示 | 正文 ≤ 3 500 个码点 **且** ≤ 10 240 个 UTF-8 字节（两个上限同时生效） |
| L2 | 本轮不做（技能附带资源文件） | — | 见 §13 |

**为什么正文有两个上限**：工具结果硬上限 `RESULT_BYTE_CAP = 12 KiB`（F-10），超限时 `toolkitResult` 会头尾截断。中文 3 字节/字，3 500 × 3 = 10 500 字节，加 JSON 信封与 `note` 勉强 < 12 288——但这只对 ≤ 3 字节字符成立（〔评审 R-03〕emoji / CJK 扩展 B 为 4 字节，3 500 个即 14 000 字节，会被截断，破坏"正文完整送达"的保证）。因此把**字节**作为权威上限（10 240 字节 + 信封 ≤ 2 KiB < 12 288），码点上限只是对作者友好的提示值；解析器两者都校验，且 AC-B6 必须含 4 字节字符夹具。toolkit D-21 已经为"字数按字符、上限按字节"付过一次学费。

#### 3.3.2 SKILL.md 格式

```markdown
---
id: explainer-video            # 必填。^[a-z][a-z0-9-]{2,39}$ ，且必须等于所在目录名；不得为保留字（见下）
name: 解说视频                  # 必填。1..20 个码点，用于界面
description: 有主题/稿子，要做带旁白的解说视频   # 必填。1..60 个码点，单行，进入 L0（系统提示词），见下
version: 1                      # 选填，整数，默认 1
tools: [generate_video_script, batch_generate_tts, search_video, add_to_track]  # 选填，≤ 8
requires: [web]                 # 选填，取值 ⊂ {web, browser, vision, documents, tts}
---
（Markdown 正文，1..3500 个码点，第一行建议为一句话目标，其后是编号步骤与注意事项）
```

- 解析：`yaml.safe_load`（F-17）。**未知键直接拒绝**（`invalid_skill`，指出键名），防止拼写错误悄悄失效。
- `tools`：必须都是**当前注册表里存在**的工具名；按所属类别分组，每组 ≤ 4 个，组数 ≤ 2。写入时后端不知道前端注册表，因此后端只校验格式（`^[a-z][a-z0-9_]{2,47}$`）与数量；**存在性校验在 `use_skill` 执行时做**，不存在的工具记入结果的 `unavailable`，不使技能失败。
- `requires`：声明依赖的能力。执行时与能力快照（`WebCapabilitySnapshot`、视觉能力、文档能力）比对：不满足时 L0 行尾追加 `[unavailable: web]`（沿用 `systemPrompt.ts` 的 `availabilitySuffix` 风格），模型据此不会去选一个跑不通的技能。
- 正文不得含 NUL/控制字符（除 `\n\t`）；整个文件 ≤ 64 KiB（防止超大 YAML 注释）；正文 ≤ 3 500 码点且 ≤ 10 240 UTF-8 字节（〔评审 R-03〕）。
- 〔评审 R-02〕**`id` 保留字**（解析器拒绝，`invalid_skill`，消息列出保留字）：① 路由保留：`index`、`validate`（与 `GET /index`、`POST /validate` 碰撞）；② Windows 设备保留名：`con`、`prn`、`aux`、`nul`、`com1`–`com9`、`lpt1`–`lpt9`（桌面端主力平台为 Windows，`mkdir` 这些名字会失败或行为异常；`com1` 等因首字符为字母且长度合规，正则本身挡不住）。保留字表集中在 `limits.py`，测试遍历全部保留字断言被拒。
- 〔评审 R-04〕**`description` 进入系统提示词，必须按"不可信文本"规范化**：必须是单行（含 `\n`、`\r`、` `、` ` 一律拒绝，而不是替换——YAML 块标量 `|`/`>` 因此被挡住）；不得含控制字符；去除首尾空白后不得以 `#`、`-`、`*`、`>`、`` ` `` 开头（防止伪装成标题/列表项/引用/代码围栏）；`name` 同样套用单行与控制字符规则。
- 〔评审 R-14〕**YAML 安全与严格类型**：frontmatter（两条 `---` 之间）≤ 4 KiB；解析前拒绝含锚点/别名（`&x`、`*x`）的 frontmatter（防别名炸弹，`safe_load` 本身不防展开体积）；`id`/`name`/`description` 必须 `isinstance(str)`，**不做类型转换**（`name: yes` 会被 YAML 解析成布尔、`id: 123` 解析成整数，一律 `invalid_skill`）；`version` 必须是 `int` 且 `bool` 不算整数。

#### 3.3.3 内置技能（6 个，替换 `WORKFLOW_RECIPES_MD` 的配方 1–3，并新增 3 个）

| id | 名称 | 来源 | 要点 |
|---|---|---|---|
| `explainer-video` | 解说视频 | 原配方 1 | 脚本 → TTS（narration_text 强制）→ 检索素材 → 上轨 → BGM；保留"TTS 文本必须用 narration_text"的强制条款 |
| `storyboard-short` | AI 分镜短片 | 原配方 2 | 脚本 → 分镜 → 描述 → 批量生成视频 → 合成 |
| `quick-assemble` | 现有素材速剪 | 原配方 3 | 检索/本地素材 → 入轨 → 裁剪 → 重叠修复 |
| `news-digest-video` | 资讯速览视频 | **新** | `update_plan` → web_tools 搜索并读取 ≥ 3 个来源 → 要点写入工作区 → 脚本 → TTS → 配图（下载或 AI 生成）→ 上轨 → `check_timeline` → `build_credits`；强调引用来源 ID、区分检索时间与发布时间 |
| `web-footage-sourcing` | 联网找素材 | **新** | 先搜后下：确认画幅/时长/授权 → 下载到本地素材库 → `list_materials` 核对 → 再上轨；授权不明必须告知用户；失败如实汇报，不重试被阻断地址 |
| `final-qc-and-export` | 成片自检 | **新** | `check_timeline` → 逐条修 blocker → 视觉抽检（`review_frames`）→ 复查 → 汇报未运行的检查项；不自行导出 |

配方 4（"仅入库 vs 上轨"的判定规则）**保留在 L0**（约 250 字符）——它是每轮都用的判定规则，不是流程。

〔评审 R-05〕**L0 预算核算（实施首步必须先测基线，再动代码）**：现有 `systemPrompt.toolkit.test.ts:74-77` 已把"有计划 + 有记忆"的最坏情形钉在 ≤ 18 500（AC-19），余量只有 400 字符到 `L0_PROMPT_CHAR_CEILING = 18 900`。本方案的增减：**删** 配方 1–3（`promptParts.ts:109-136` 整段 1 665 字符含配方 4，配方 1–3 约 1.2–1.4 K）；**增** 技能段（≤ 1 300）+ 引导句（约 70）+ `AGENT_TOOLKIT_GUIDANCE` 两句（约 120）+ `use_skill` 类别提示（约 60）。理论净增 ≈ +150…+350，**但这是估算**。硬性做法：① 实施第一步在记录里写下当前最坏情形的实测字符数 `L0_BASE`；② 新增断言 `最坏情形长度 − L0_BASE ≤ 400`；③ **既有的 ≤ 18 500 断言不得放宽，`L0_PROMPT_CHAR_CEILING` 不得抬高**。若实测超限，削减顺序：先缩 L0 索引到 8 行，再压缩引导句，最后才考虑把配方 4 并入 `AGENT_TOOLKIT_GUIDANCE` 的已有句子。

内置技能的正文在实现时由现有 `WORKFLOW_RECIPES_MD` 与 `AGENT_TOOLKIT_GUIDANCE` 里相关句子**迁移**而来，不重新发明措辞；每个正文须通过 §3.3.2 的校验（由测试遍历目录保证，AC-B1）。

#### 3.3.4 后端：存储与服务

**目录**

```
backend-services/basic-service/app/services/agent_skills/
├── __init__.py
├── parser.py        # parse_skill(markdown) -> SkillDocument；纯函数，无 IO
├── store.py         # SkillStore：内置 + 用户 + 状态文件；mtime 缓存；原子写
├── limits.py        # 全部常量
└── builtin/
    ├── explainer-video/SKILL.md
    ├── storyboard-short/SKILL.md
    ├── quick-assemble/SKILL.md
    ├── news-digest-video/SKILL.md
    ├── web-footage-sourcing/SKILL.md
    └── final-qc-and-export/SKILL.md
```

**用户技能**：`{STORAGE_ROOT}/agent_skills/{id}/SKILL.md`。**状态**：`{STORAGE_ROOT}/agent_skills/_state.json` = `{"disabled": ["id", ...], "updated_at": "ISO8601"}`。**本轮不新增数据库表**（遵守 CLAUDE.md "只增不改 DDL"，且文件即真相，用户可直接备份/拷贝目录）。

`SkillStore` 规则：
- 列表 = 内置（只读）∪ 用户；`id` 冲突时**内置优先**，用户同名创建请求 → `409 skill_exists`；已存在的冲突用户目录（用户手动拷入）在列表中带 `shadowed: true` 且不生效。
- 写入：先写 `SKILL.md.tmp` 再 `os.replace`；`id` 目录名与 frontmatter 不一致 → `invalid_skill`；用户技能总数 ≤ 50（`skill_limit`）。
- 读缓存：按文件 `st_mtime_ns` + 大小失效，避免每次 L0 构建都读盘；目录扫描结果缓存 5 秒。
- 路径安全：`id` 先过正则**与保留字表**（〔评审 R-02〕`index`/`validate`/Windows 设备名）再拼路径；`Path.resolve()` 后必须仍在技能根下，否则 `invalid_parameters`（防 `..\`）。扫描用户目录时，名称命中保留字或不合正则的子目录一律忽略并记 warning（用户手工拷入的 `CON` 目录不得使扫描异常）。
- 〔评审 R-15〕并发与 Windows 文件占用：所有写路径（创建/更新/删除/启停/复制）持同一把 `asyncio.Lock`，"≤ 50 个"检查与落盘在锁内完成；`os.replace` 遇 `PermissionError`（杀软/预览占用）重试 3 次 × 50 ms，仍失败返回 `internal_error`，不留 `.tmp` 残件（`finally` 清理）。
- 所有 IO 经 `asyncio.to_thread`，不阻塞事件循环（沿用 research 域做法）。
- 损坏文件（YAML 错、超长）**不使列表失败**：该条目以 `valid: false` + `problem` 出现在管理列表，从 L0 索引与 `use_skill` 中排除。

**REST（前缀 `/api/agent-skills`，`APIRouter(prefix="/agent-skills", tags=["Agent Skills"])`，`main.py` 仿 `:709-730` 注册）**

| 方法 路径 | 用途 | 守卫 |
|---|---|---|
| `GET /index` | L0 索引：启用且 valid 的技能 `[{id,name,description,requires,builtin}]`，≤ 10 条（超出按"内置优先、用户技能按更新时间倒序"截断，并返回 `truncated:true`） | Origin + `x-tool-call-id` |
| `GET ` | 管理列表（含禁用、无效、`shadowed`、`body_chars`、`updated_at`） | Origin |
| `GET /{id}` | 单个技能完整内容（含 `markdown` 原文与解析结果） | Origin + `x-tool-call-id`（Agent 读）或 Origin（面板读，二者同一路径：call id 可选，缺省记为 `panel-<uuid>`） |
| `POST ` | 创建用户技能 `{markdown}` | Origin(write) + JSON |
| `PUT /{id}` | 更新用户技能 `{markdown}`；内置 → `403 builtin_readonly` | 同上 |
| `DELETE /{id}` | 删除用户技能；内置 → `403 builtin_readonly` | Origin(write) |
| `POST /{id}/enabled` | `{enabled: bool}` 启用/禁用（内置与用户均可） | Origin(write) + JSON |
| `POST /{id}/duplicate` | 把任意技能复制为用户技能 `{new_id}`（便于改内置的副本） | Origin(write) + JSON |
| `POST /validate` | 干跑校验 `{markdown}`，返回解析结果与 `warnings[]`，**不落盘**（面板实时校验） | Origin(write) + JSON |

**错误码闭集**（`AgentSkillsError.error_code`，沿用 `ErrorResponse` 信封与 `failure_class` 约定）：`invalid_skill`(422)、`invalid_parameters`(422)、`skill_not_found`(404)、`skill_exists`(409)、`builtin_readonly`(403)、`skill_limit`(409)、`skill_too_large`(413)、`origin_forbidden`(403)、`invalid_call_id`(400)、`internal_error`(500)。新增码即新增契约：必须同步 BFF、前端 `agentSkills.ts` 客户端与测试。

#### 3.3.5 Agent 侧：索引注入与 `use_skill` 工具

**索引注入**（`src/lib/video-editing-agent/skillContext.ts`，新建）：
- `loadSkillIndex(apiBaseUrl, projectId)`：仿 `loadMemoryDigest`（`route.ts:256`）——1.5 秒超时、进程内 60 秒缓存、**失败返回空数组且不阻塞回合**。〔评审 R-20〕与 `loadMemoryDigest` 一样，请求自带 `Origin: apiBaseUrl` 与 `x-tool-call-id: callIdFor(projectId)`，因此满足后端 `GET /index` 的"Origin + call id"守卫；面板读取（无 call id）走 `/{id}` 与管理列表的"call id 可选"分支。索引缓存只靠 60 秒 TTL 过期（面板里启停/编辑后，L0 索引最多滞后 60 秒，可接受）；**但用户显式指定的 `skillId` 不走该缓存，每次直接读 `/{id}`**，保证"刚启用/刚编辑"的技能在 `/` 调用时立即生效。
- `formatSkillIndex(index, availability)`：渲染为
  ```
  ## 可用技能
  遇到下列类型的任务，先 use_skill(id) 读取套路再动手；用户用 / 指定的技能已随消息给出，无需再读。
  - explainer-video: 有主题/稿子，要做带旁白的解说视频
  - news-digest-video: 联网查资料并做成资讯速览 [unavailable: web]
  ```
  〔评审 R-04〕行宽硬截 130 字符（含 `[unavailable: …]` 后缀；先截 `description`，后缀永远保留）、总长硬截 1 300 字符（`utf8Slice` 同 `systemPrompt.ts` 其余段落的做法）。渲染前对 `id`/`description` 再做一次与解析器相同的单行与控制字符清洗（深度防御：技能文件可能被用户在磁盘上手改，绕过解析器）。索引为空 → **整段不输出**（含引导句），零开销降级。
- `buildUserPrompt({ text, skill?, mentions? })`：最终交给 `agent.prompt()` 的字符串。顺序：`[技能块] + 用户原文 + [引用素材块]`。
  技能块：`<skill id="x" name="…">\n{body}\n</skill>\n以上是用户指定的剪辑套路，请按其步骤执行，并先 update_plan。\n\n`；〔评审 R-13〕`body` 中出现的 `</skill>`（大小写不敏感）转义为 `<\/skill>`，防止正文提前闭合包裹标签。
  引用素材块：`\n\n[用户引用的素材]\n- {label} → material_id={id}`（≤ 10 条，label 码点截到 40）。〔评审 R-13〕**服务端校验**：`materialId` 必须出现在本轮请求的 `materials` 中，否则丢弃该条（不报错）；`label` 折叠为单行（换行与控制字符替换为空格）。
- 〔评审 R-07〕**`skillId` 取不到时的降级（完整规则）**：路由在 `buildUserPrompt` 前用 1.5 秒超时读取 `/api/agent-skills/{skillId}`；`skillId` 先过 `^[a-z][a-z0-9-]{2,39}$`，不合规视同 `not_found`。任一失败——`skill_not_found`→`not_found`、已禁用→`disabled`、`valid:false`→`invalid`、超时/5xx/网络错误→`unavailable`——处理**完全一致**：① 不注入技能块，回合照常按用户原文运行；② 在 `run_started` 之后、`agent_start` 之前发 SSE `skill_skipped { skillId, reason }`；③ 服务端只记一条 warning（含 `skillId` 与 `reason`，不含正文）。客户端收到后在该回合 user 消息下显示一行次要提示"技能『{名称}』未能加载，已按普通请求处理"（i18n，名称取客户端缓存，缺省显示 `skillId`），并清除该消息上的 `skillId`，使 `messageConverter` 不再追加"（本轮使用技能）"注记（否则模型会被误导）。**不因技能失败而让回合失败。**
  **存储与显示的消息仍是用户原文**，技能块/引用块只存在于本次发往模型的提示里，所以不污染对话历史也不会在历史压缩中被重复背着走。后续回合模型仍能知道"这轮用过什么技能"：`messageConverter` 对带 `skillId` 的 user 消息追加一行轻量注记 `（本轮使用技能：{name}）`，不重复正文。

**`use_skill`（新工具，`tools/skillTools.ts`）**

```ts
parameters: Type.Object({
  id: Type.String({ pattern: '^[a-z][a-z0-9-]{2,39}$', description: 'Skill id from the 可用技能 list.' }),
})
// 返回 details：
{ success: true, id, name, version, body,                 // body ≤ 3500 码点
  loaded_tools: string[],                                  // 已预加载
  unavailable: Array<{ tool: string; reason: string }>,   // 不存在 / 类别不可用 / 超预算
  note: string }                                           // 如 'Tools above are callable on your NEXT response.'
```

- **常驻**：加入 `workflow_tools`（常驻类别）与 `CORE_TOOLKIT_TOOL_NAMES`，原因同 `update_plan`：按需加载会白费一个整回合（toolkit §3.2）。常驻工具数 +1，模式字节预算增量约 220 字节，在 `ToolActivationState` 的 `SCHEMA_LIMIT` 内（实现须以 `toolActivation.test.ts` 的实测余量为准，AC-B8）。
- 执行：`executeToolkitTool(context, callId, { basePath: '/api/agent-skills', path: '/' + id })`（见 §7：给 `ToolkitCall` 增加可选 `basePath`，默认 `/api/agent-toolkit`，**不复制第三份适配器**，并让 `visionAdapter` 也不必再维护自己的拼接——但 visionAdapter 的迁移不在本轮范围，避免扩大改动面）。
- 预加载：按技能 `tools` 的所属类别分组，对每组调用 `activation.load(category, names)`（F-09，≤ 4 个/组，≤ 2 组）；`load` 抛 `invalid_tool_selection`/`tool_schema_budget` 时把该组工具记入 `unavailable` 并**继续**返回正文，不让技能整体失败。已处于激活态的工具不重复计入。
- 取消/断流：沿用 `toolkitFailure('cancelled', …)`；`callId` 即幂等键。
- 对 `requires` 不满足的技能：**仍返回正文**，但 `note` 明确"web 能力当前不可用：{原因}；请告知用户并走本地素材路径"。

#### 3.3.6 前端：`/` 技能选择器与设置面板

**`/` 选择器（`ComposerSkillPicker.tsx`，新建）**
- 触发：输入框内容为空或光标所在行以 `/` 开头且 `/` 之后无空白时，在输入框**上方**弹出浮层（宽度＝输入区宽，最高 240px，可滚动）。
- 内容：启用的技能（`GET /api/agent-skills` 客户端缓存 30 秒，面板里改动后立即失效），每行：名称（粗）+ 描述（次要，单行省略）+ 右侧"内置"/"我的"小标；`requires` 不满足的行置灰并显示原因，仍可选择（选择后在芯片上提示）。输入 `/` 后的文字做 `id/name/description` 子串过滤（大小写不敏感）。
- 键盘：`↑/↓` 移动、`Enter`/`Tab` 选中、`Esc` 关闭（不清空输入）；`role="listbox"` + `role="option"` + `aria-activedescendant`；IME 合成中不响应（F-18）。
- 选中后：把 `/xxx` 文本从输入框移除，在输入框上方显示"技能芯片"：`技能：解说视频 ✕`；发送时载荷带 `skillId`；发送后芯片清空。运行中不可选择技能（技能是回合起点的概念；插话不带技能）。
- 空态："还没有可用的技能"+ 链接"去设置中心添加"。加载失败："技能暂不可用"（`role="status"`），输入照常。

**设置中心新增「Agent 技能」面板（`AgentSkillsSettingsPanel.tsx`，新建，注册到 `SettingsSidebar.tsx`/`SettingsPage.tsx`，位置紧随 `AgentToolkitSettingsPanel`）**
- 列表区：每个技能一张行卡——名称、id、描述、徽标（内置/我的/已禁用/无效/被内置覆盖）、启用开关（`role="switch"`）、"查看/编辑"、"复制为我的技能"、（用户技能）"删除"（二次确认）。
- 编辑区（用户技能与"新建"共用）：左侧 SKILL.md 文本域（等宽字体，行号可无），右侧"预览与校验"——调用 `POST /validate`（防抖 400ms），显示解析出的名称/描述/工具/依赖与逐条警告；校验未通过禁用"保存"。内置技能只读（顶部提示"内置技能不可修改，可复制为我的技能后编辑"）。
- "导入"：粘贴 SKILL.md 文本 → 同走 `validate` → 展示**完整正文预览**与"该技能将预加载这些工具：…"，用户确认后才创建（导入的外来文本是提示词注入的潜在载体，必须让用户看到再启用——风险 R3）。
- 错误：保存失败/加载失败用 `role="alert"`；成功用既有 `NotificationContext`。
- 所有文案走 `src/lib/i18n.ts`（en + zh-CN 两处，且接口类型同步），**不得在组件里写死中文**。

### 3.4 主线 C：对话交互升级

#### 3.4.1 忙碌条进度化（`AgentBusyBar.tsx` 重写）

现状只有"阶段文案 + 停止"（70 行）。新版仍是同一位置的一条细带，高度 22px → 28px，内容：

`● 步骤 2/5 · 搜索素材 · 1:12   ·  Enter 插话　　[停止]`

- 步骤进度来自该回合最新 `update_plan` 的结果（`scanLatestPlan` 已能从历史解析，`planScan.ts`；新增 `selectActiveStep(plan)` 返回 `{index,total,title}`，无计划时回退为原有"正在运行 xxx 工具/思考中"文案）。
- 已用时：客户端 `useElapsed(startedAt)`（1 秒 tick，`aria-hidden`，避免读屏器每秒播报；状态文案变化才 `aria-live="polite"` 播报）。
- 右侧提示"Enter 插话"仅在输入框为空且未聚焦时显示，聚焦后让位给 placeholder，避免重复。
- 颜色沿用现有 amber 语义（"进行中/需注意"），暗色模式变量保持；**不引入新色**。`prefers-reduced-motion` 下去掉 `animate-ping`。

#### 3.4.2 插话在对话中的呈现

- **输入区上方 `SteerQueue`（新建）**：每条待送达文本一个芯片，左侧状态点：`local`/`sent` 为脉冲琥珀点 + 文案"将在『{当前工具}』完成后送达"；`queued` 为灰点 + "回合结束后发送"。✕ 规则见 §3.2.4。最多 3 个，纵向堆叠，不遮挡消息区（容器 `flex-shrink-0`）。
- **回合时间线内 `SteerNoteNode`（新建，`timeline/` 下）**：`applied` 的插话作为一个"用户小节点"插入到 `afterToolCallId` 对应的执行步骤之后，样式沿用 `UserMessageNode` 的缩小版（右对齐气泡，标注"运行中补充"）。Agent 随后的 `AgentResponseNode` 自然接在其后，读者能看懂因果。

#### 3.4.3 回合总结卡（`TurnSummaryCard.tsx` + `turnSummary.ts`，新建）

**纯函数** `summarizeTurn(message: ChatMessage, materials: MaterialItem[]): TurnSummary | null`，输入只来自已落盘的 `agentToolCalls` 与 `timelineTrackPatches`，无网络、无副作用，可单测：

```ts
interface TurnSummary {
  clips:    { added: number; removed: number; moved: number; trimmed: number; resized: number };
  materials:{ imported: number; generated: { tts: number; image: number; video: number }; webDownloaded: number };
  check:    { ran: boolean; blockers: number; warnings: number; unlicensed: number } | null; // 取本回合最后一次 check_timeline
  failedTools: number;     // status==='error'
  hasUndoable: boolean;    // 与 undoAllOperations 的可用性一致
}
```

`null` 条件：本回合无任何已完成的工具调用，或消息处于流式/取消中（总结只在**完成**时出现）。取消/出错的回合显示精简版（只有"已完成 N 步，可撤销"）。

**展示**：回合最后一条 `AgentResponseNode` 下方一张低调的卡片（`border` + `bg-muted/40`，不抢文本）：
第一行三到四个"指标 chip"（如 `+5 片段`、`导入 3 素材`、`质检 ✓` 或 `质检 1 阻断 · 2 提醒`）；
第二行操作：**撤销本轮**（调用既有 `undoAllOperations(messageId)`，被运行中阻止时沿用 `agentUndo.blockedWhileRunning` 文案）、**让 Agent 修复**（仅当 blockers+warnings>0：以固定文案 `请修复上一轮自检发现的问题，并再次运行 check_timeline` 走普通发送）、**生成来源清单**（仅当 `webDownloaded>0`：固定文案 `请为时间线上的网络素材生成来源与授权清单`）。
文案固定为 i18n 键，不由模型生成，避免提示注入进入"一键发送"。无障碍：整卡 `role="group"` + `aria-label="本轮总结"`，按钮有可见文本。

#### 3.4.4 输入区增强

| 功能 | 规则 | 优先级 |
|---|---|---|
| **`@` 素材引用**（`ComposerMentionPicker.tsx`） | 输入 `@` 触发，列出项目素材（名称 + 类型图标 + 时长/尺寸），子串过滤，≤ 8 条可见；选中后在文本中插入 `@素材名`，并在载荷 `mentions:[{materialId,label}]` 记录；若用户事后删改了 `@素材名` 文本，发送前按文本过滤掉失效引用（只发送仍然出现在正文里的） | P1 |
| **Esc 停止** | 运行中，输入框内按 `Esc`：第一次显示轻提示"再按一次 Esc 停止"（1.5 秒），第二次调用 `cancelByUser`；选择器弹出时 `Esc` 先关选择器 | P1 |
| **↑ 回溯** | 输入框为空（或光标在首行首位）时按 `↑` 依次填入本会话最近 20 条用户消息，`↓` 反向；一旦用户修改内容即退出回溯模式 | P2 |
| **草稿保留** | 键 `ecliptrix.agentDraft.v1.{projectId}.{conversationId}`，`localStorage`，防抖 300ms，**所有读写 try/catch**，空串则删除键；切换会话/重开面板恢复；发送成功后清除 | P2 |
| **失败重试** | 错误/取消的回合底部"重试"按钮：以该回合原用户消息（含 `skillId`、`mentions`）重新发送；仅最后一个回合显示 | P2 |
| **消息复制** | 助手消息文本"复制"，复制后按钮文案 1.5 秒变"已复制" | P2 |

所有新增键盘行为遵守 F-18（IME 合成中不触发），并为 `Alt+Enter` 在 macOS/Windows 上无冲突做测试（Electron 默认菜单不占用 `Alt+Enter`）。

### 3.5 主线 D：素材来源与授权账本

**规则 16：`web_material_license_unknown`（`qualityLint.ts`）**
- 严重度 `warning`（不阻断导出：授权是否可商用由用户判断，工具只负责不让它被忽略）。
- 判定：时间线上任一 item 引用的素材满足 `metadata.source === 'web'`（或存在 `metadata.provenance`）且 `provenance.license_status !== 'declared'`。聚合为**一条**问题，`detail` 列出前 5 个素材名与总数；`suggested_tool: 'build_credits'`。
- `LINT_RULE_CODES` 15 → 16；所有断言"15 条"的测试、`check_timeline` 工具描述、`QualityReportCard` 的规则文案表与 i18n（en + zh-CN）同步更新。这是**契约变更**，因此在 PR 描述与 spec §12 中显式登记（CLAUDE.md "暴露的错误码即 API"）。

**`build_credits`（新工具，`tools/creditsTool.ts`，类别 `material_tools`，按需）**

```ts
parameters: Type.Object({
  scope: Type.Optional(Type.Union([Type.Literal('used'), Type.Literal('all')], { default: 'used' })),
  write_to_workspace: Type.Optional(Type.Boolean({ default: true })),
})
// details: { success, total, unlicensed, written: { name: 'credits.md' } | null, rows: Row[≤10], truncated }
```

- 数据来源：`context.materials` + `context.timelineState`（纯内存，零网络）。`scope='used'` 只含时间线引用的素材。
- 输出 Markdown 表：`素材 | 来源页面 | 作者 | 授权 | 获取时间 | 使用位置（轨道/起止秒）`；`授权` 列文案：`declared` → "已声明（见链接）"，其余 → "**未声明，商用前请确认**"。表头下方一句固定免责声明："授权状态来自来源页面的公开声明，不构成法律意见。"
- 写入：`write_to_workspace=true` 时经 `executeToolkitTool` 调 `/workspace/write` 写入 `credits.md`（覆盖写，幂等）；工作区功能关闭 → 不报错，`written:null` 并在 `note` 里提示"工作区未启用，已仅返回前 10 行"。
- 来源字段属不可信外部数据：写入 Markdown 前对 `|`、换行、反引号转义，长度各截 200 码点，防止注入表格或指令（R5）。

---

## 4. 一次典型任务的时序（"做一条 60 秒 AI 资讯视频"）

1. 用户输入 `/`，选"资讯速览视频"，补一句"主题：本周开源大模型进展"，Enter 发送。载荷 `{messages, skillId:'news-digest-video', …}`。
2. `chat/route.ts`：加载记忆摘要与技能索引 → `buildUserPrompt` 把技能正文拼到本轮提示前 → 创建 Agent → `registerRun` → 发 SSE `run_started{runId}`。
3. Agent 先 `update_plan`（5 步），忙碌条显示"步骤 1/5 · 搜索资料 · 0:08"。
4. 第 3 分钟，用户看到 Agent 在找英文素材，输入"配图尽量用竖版，9:16"，Enter。客户端 `POST /steer` → 202；芯片显示"将在『web_download_media』完成后送达"。
5. 下载工具结束，pi 送达插话：服务端 SSE `steer_applied{afterToolCallId}`；芯片消失，回合时间线在该步骤后出现"运行中补充：配图尽量用竖版"。Agent 回复"已调整：后续配图按 9:16"，`update_plan` 刷新。
6. 回合结束：`check_timeline` 报 1 条 `web_material_license_unknown` 警告；Agent 调 `build_credits` 写入 `credits.md`。
7. 总结卡出现：`+9 片段 · 导入 6 素材（网络 4）· 质检 0 阻断 1 提醒`，按钮"撤销本轮 / 让 Agent 修复 / 生成来源清单"。
8. 用户在第 4 分钟还按 Alt+Enter 排了一条"再做一个英文版"——它在步骤 7 之后作为新回合**自动**发出。

---

## 5. 接口设计汇总

### 5.1 HTTP

| 端点 | 说明 | 详见 |
|---|---|---|
| `POST /api/video-editing-agent/steer` | 运行中插话 | §3.2.2 |
| `POST /api/video-editing-agent/chat`（扩展） | 请求体新增可选 `skillId: string`、`mentions: {materialId:string,label:string}[]`；响应流新增 4 个事件（`run_started`/`steer_applied`/`steer_dropped`/`skill_skipped`） | §3.2.2、§3.3.5 |
| `/api/agent-skills/*`（BFF 白名单 → 后端） | 技能 CRUD / 启停 / 复制 / 校验 / 索引 | §3.3.4 |

**BFF `src/app/api/agent-skills/[...path]/route.ts` 白名单**（仿 F-13，未登记组合一律 404）：
```
GET    ^(index|[a-z][a-z0-9-]{2,39})?$          （空路径＝管理列表）
POST   ^(validate|[a-z][a-z0-9-]{2,39}/(enabled|duplicate))?$   （空路径＝创建）
PUT    ^[a-z][a-z0-9-]{2,39}$
DELETE ^[a-z][a-z0-9-]{2,39}$
```
转发头 `x-tool-call-id`、`origin`、`accept-language`；JSON 体上限 128 KiB；非 GET 必须 Origin 通过；带体的 POST/PUT 必须 `application/json`（DELETE 无体不要求，吸取 toolkit D-19 的教训，需有"无 content-type 的 DELETE 通过"的回归用例）。

### 5.2 模型可见工具（本轮 +2）

| 工具 | 类别 | 常驻 | 签名 |
|---|---|---|---|
| `use_skill` | `workflow_tools` | 是 | `{ id }` |
| `build_credits` | `material_tools` | 否 | `{ scope?, write_to_workspace? }` |

工具计数：18 个类别不变；常驻核心工具 +1；按需工具 +1。`CORE_TOOLKIT_TOOL_NAMES` 与 `workflow_tools` 授权必须**同批修改**（agent-visual-review C-3 的教训）。

### 5.3 前端事件契约

`SSEEvent` 增加 `run_started`/`steer_applied`/`steer_dropped`（§3.2.2）与 `skill_skipped`（§3.3.5，〔评审 R-07〕）。`SSEStreamManager.onRestart` 同时通知 `useAgentSteering.onRestart()`（〔评审 R-01〕）。`SSEStreamManager` 的解析与重试测试（`sseStreamManager.parse/retry.test.ts`）各补一条覆盖；未知事件类型的既有"忽略并继续"行为保持不变（向后兼容旧服务端）。

---

## 6. 数据模型

| 数据 | 形态 | 位置 | 说明 |
|---|---|---|---|
| 技能内容 | 文件 | 内置：`app/services/agent_skills/builtin/<id>/SKILL.md`；用户：`{STORAGE_ROOT}/agent_skills/<id>/SKILL.md` | 无 DDL |
| 技能启停 | JSON 文件 | `{STORAGE_ROOT}/agent_skills/_state.json` | `{disabled:string[], updated_at}`；损坏则视为空并记 warning，不阻断启动 |
| 运行登记 | 进程内 Map | `agentRunRegistry` | 不持久化；进程重启即丢失，客户端降级为排队 |
| 插话记录 | `ChatMessage.steers?: SteerNote[]` | 会话（既有 localStorage/会话持久化通道） | 可选字段，旧数据兼容 |
| 技能/引用 | `ChatMessage.skillId?: string`、`ChatMessage.mentions?: {materialId,label}[]` | 同上 | 仅用户消息 |
| 草稿 | `localStorage` | 键 `ecliptrix.agentDraft.v1.{projectId}.{conversationId}` | 只存文本；读写均 try/catch；无则不影响功能 |
| 来源清单 | 工作区文件 | `credits.md`（`agent-general-toolkit` 工作区） | 受既有配额与清理策略约束 |

**不新增 ORM 表、不改既有表**。如实现过程中发现必须新增表，须先回到本文件登记并确认仅为新增（无 DROP/ALTER）。

---

## 7. 文件 / 模块变更计划

### 7.1 后端（`backend-services/basic-service/`）

| 动作 | 文件 | 意图 |
|---|---|---|
| 新建 | `app/services/agent_skills/__init__.py` | 对外导出 `get_skill_store()` 单例 |
| 新建 | `app/services/agent_skills/limits.py` | 全部上限常量（3 500 码点、64 KiB、50 个、10 行索引、110 字符行宽等） |
| 新建 | `app/services/agent_skills/parser.py` | `parse_skill(markdown)`：frontmatter 解析 + 校验，纯函数 |
| 新建 | `app/services/agent_skills/store.py` | 内置+用户技能的读写、状态文件、mtime 缓存、原子写、路径安全 |
| 新建 | `app/services/agent_skills/builtin/<6 个目录>/SKILL.md` | 6 个内置技能正文（由 `WORKFLOW_RECIPES_MD` 等迁移） |
| 新建 | `app/models/agent_skills_models.py` | `AgentSkillsError`、`StrictRequest` 子类（create/update/enabled/duplicate/validate）、错误码→状态码/失败类映射 |
| 新建 | `app/routers/agent_skills_router.py` | §3.3.4 全部端点与守卫；复用 `agent_toolkit_router` 的 Origin/call-id 辅助（从中提取到共享模块或直接 import，**不得复制**） |
| 修改 | `app/main.py` | 注册路由与 `AgentSkillsError` 异常处理器（仿 `:709-730`） |
| 新建 | `tests/test_agent_skills_parser.py` | 解析/校验（见 §9） |
| 新建 | `tests/test_agent_skills_store.py` | 存储：原子写、遮蔽、损坏文件、路径穿越、上限 |
| 新建 | `tests/test_agent_skills_router.py` | 守卫矩阵、错误信封、`builtin_readonly`、`validate` 不落盘 |

### 7.2 前端 / Next.js 服务端（`src/`）

| 动作 | 文件 | 意图 |
|---|---|---|
| 新建 | `src/lib/server/agentRunRegistry.ts` | 运行登记表与 `SteerError`（§3.2.2） |
| 新建 | `src/app/api/video-editing-agent/chat/runLifecycle.ts` | `createRunHandle`：steer 队列、`steer_applied`/`steer_dropped` 生成 |
| 新建 | `src/app/api/video-editing-agent/steer/route.ts` | 插话端点 |
| 修改 | `src/app/api/video-editing-agent/chat/route.ts` | 登记/注销运行、发 `run_started`、读 `skillId`/`mentions` 并用 `buildUserPrompt`、`finally` 中 `close()`；**增量 ≤ 30 行**，其余逻辑落到上面两个新模块 |
| 新建 | `src/app/api/agent-skills/[...path]/route.ts` | BFF 白名单代理（§5.1） |
| 新建 | `src/lib/video-editing-agent/skillContext.ts` | `loadSkillIndex`/`formatSkillIndex`/`buildUserPrompt` |
| 新建 | `src/lib/video-editing-agent/tools/skillTools.ts` | `use_skill` |
| 新建 | `src/lib/video-editing-agent/tools/creditsTool.ts` | `build_credits` |
| 修改 | `src/lib/video-editing-agent/tools/toolkitAdapter.ts` | `ToolkitCall` 增加可选 `basePath`（默认 `/api/agent-toolkit`），`NEXT_STEPS` 增加技能相关错误码的下一步 |
| 修改 | `src/lib/video-editing-agent/tools/index.ts` | 构建并注册两个新工具 |
| 修改 | `src/lib/video-editing-agent/registry/categories.ts` | `workflow_tools` 增 `use_skill`；`material_tools` 增 `build_credits`；类别说明与工具计数注释同步 |
| 修改 | `src/lib/video-editing-agent/promptParts.ts` | `CORE_TOOLKIT_TOOL_NAMES` +`use_skill`；删除配方 1–3，保留配方 4；`AGENT_TOOLKIT_GUIDANCE` 增补插话/技能各一句；新增 `STEER_WRAPPER`；`CATEGORY_USAGE_HINTS` 增 `build_credits` 提示 |
| 修改 | `src/lib/video-editing-agent/systemPrompt.ts` | 渲染"可用技能"段；`formatWorkflowRecipes` 只输出保留的配方 4；`CategoryAvailability` 增技能依赖映射 |
| 修改 | `src/lib/video-editing-agent/agent.ts` | `VideoEditingAgentConfig` 增 `skillIndex`；传入 `buildSystemPrompt`；`createVideoEditingAgent` 返回 `activation`（供 `use_skill` 预加载，经 `ToolContext` 暴露一个窄接口 `loadTools(category,names)`，不暴露整个对象） |
| 修改 | `src/lib/video-editing-agent/types.ts` | 新 SSE 事件、`AgentChatRequest.skillId/mentions`、`ToolContext.loadTools`、`VideoEditingAgentConfig.skillIndex` |
| 修改 | `src/lib/video-editing-agent/tools/qualityLint.ts` | 规则 16、`LINT_RULE_CODES` |
| 修改 | `src/lib/video-editing-agent/messageConverter.ts` | 回放 `applied` 插话；`skillId` 注记 |
| 修改 | `src/lib/video-editing-agent/AgentEventRouter.ts`、`SSEStreamManager.ts` | 识别并转交三个新事件 |
| 新建 | `src/types/agentSteering.ts`、`src/types/agentSkills.ts` | 前端类型 |
| 修改 | `src/types/index.ts` | `ChatMessage` 增 `steers?`、`skillId?`、`mentions?` |
| 新建 | `src/lib/api/agentSkills.ts`、`src/lib/api/agentSteer.ts` | 类型化客户端（走 `http-client`；steer 客户端对 409/404 做语义化结果而非抛错） |
| 新建 | `src/components/video/hooks/useAgentSteering.ts` | 插话/排队状态机（§3.2.4） |
| 新建 | `src/components/video/hooks/useComposerDraft.ts`、`useInputHistory.ts` | 草稿保留、↑ 回溯 |
| 修改 | `src/components/video/hooks/useAgentExecution.ts` | 接入 steering；净行数不增（抽出 `sealMessage`/`cancel*` 纯逻辑到 `agentTurnLifecycle.ts`，该文件现 157 行） |
| 修改 | `src/components/video/hooks/useAgentExecutionState.ts` | 持有 `runId`、转交新事件、暴露 `turnStartedAt` |
| 新建 | `src/components/video/components/VideoChatWindow/ComposerSkillPicker.tsx`、`ComposerMentionPicker.tsx`、`SteerQueue.tsx`、`TurnSummaryCard.tsx`、`turnSummary.ts` | 见 §3.4 |
| 新建 | `src/components/video/components/VideoChatWindow/timeline/SteerNoteNode.tsx` | 回合内插话节点 |
| 修改 | `src/components/video/components/VideoChatWindow/AgentBusyBar.tsx` | 进度化忙碌条 |
| 修改 | `src/components/video/components/VideoChatWindow/VideoChatWindow.tsx` | 运行中输入框可用、键位、选择器与芯片接入；**该文件 564 行，新增逻辑一律落到上面的子组件/hook**，自身净增 ≤ 60 行 |
| 修改 | `src/components/video/components/VideoChatWindow/timeline/TimelineChatPanel.tsx`、`AgentExecutionNode.tsx` | 挂载 `SteerNoteNode`、`TurnSummaryCard` |
| 新建 | `src/components/settings/AgentSkillsSettingsPanel.tsx` | 技能管理面板 |
| 修改 | `src/components/settings/SettingsSidebar.tsx`、`SettingsPage.tsx` | 注册面板 |
| 修改 | `src/lib/i18n.ts` | en + zh-CN + 接口类型三处同步（约 60 个键：插话/排队/芯片/忙碌条/总结卡/选择器/技能面板/规则 16/重试/复制） |
| 修改 | `src/components/video/components/VideoChatWindow/QualityReportCard.tsx` | 规则 16 文案与图标 |

### 7.3 测试（属变更计划，不得省略）

| 文件 | 覆盖 |
|---|---|
| `src/lib/server/__tests__/agentRunRegistry.test.ts` | 上限/去重/TTL/`close` 后 `run_closed` |
| `src/app/api/video-editing-agent/chat/__tests__/runLifecycle.test.ts` | `steer_applied` 引用匹配与回退匹配、`close` 产生 `steer_dropped`、时间戳单调 |
| `src/app/api/video-editing-agent/steer/__tests__/route.test.ts` | 状态码矩阵、Origin、体上限、幂等、日志不含正文 |
| `src/app/api/agent-skills/__tests__/route.test.ts` | 白名单矩阵、"无 content-type 的 DELETE 通过"、无 Origin 的写仍 403 |
| `src/lib/video-editing-agent/__tests__/skillContext.test.ts` | 索引渲染/截断/空索引不输出、`buildUserPrompt` 顺序与不入历史 |
| `src/lib/video-editing-agent/__tests__/skillTools.test.ts` | 预加载分组、`unavailable` 容错、取消、正文 ≤ 12 KiB |
| `src/lib/video-editing-agent/__tests__/creditsTool.test.ts` | 表格转义、`used`/`all`、工作区关闭降级 |
| `src/lib/video-editing-agent/__tests__/qualityLint.licenseRule.test.ts` | 规则 16 正反例；同步修改既有"15 条"断言 |
| `src/lib/video-editing-agent/__tests__/systemPrompt.test.ts`（扩展） | L0 最坏情形长度、技能段在/不在、配方 4 仍在 |
| `src/lib/video-editing-agent/__tests__/messageConverter.steer.test.ts` | 插话回放位置（含 `afterToolCallId=null` → 第一条 assistant 之前）、`queued` 不回放、`skill_skipped` 后不追加技能注记、openai-completions 与 anthropic 两种 `api_type` 下序列均合法（〔评审 R-12/R-19〕） |
| `src/lib/video-editing-agent/__tests__/systemPrompt.toolkit.test.ts`（既有，**必须同步修改**） | `CORE_TOOLKIT_TOOL_NAMES.toHaveLength(18)` → 19；既有 ≤ 18 500 断言保持不变；新增"相对基线净增 ≤ 400"断言（〔评审 R-05/R-16〕） |
| `backend-services/basic-service/tests/test_agent_skills_parser.py`（补充用例） | 保留字全集被拒（`index`/`validate`/`con`/`nul`/`com1`…）、`description` 含换行/`#` 开头被拒、`name: yes`/`id: 123` 被拒、锚点/别名被拒、4 字节字符正文按字节上限判定、frontmatter > 4 KiB 被拒（〔评审 R-02/R-03/R-04/R-14〕） |
| `backend-services/basic-service/tests/test_agent_skills_store.py`（补充用例） | 用户手工拷入 `CON`/`index` 目录被忽略不崩溃；并发创建不突破 50 个上限；`os.replace` 抛 `PermissionError` 时重试并清理 `.tmp`（〔评审 R-15〕） |
| `src/app/api/video-editing-agent/chat/__tests__/skillSkipped.test.ts` | `skillId` 的 4 种失败原因均发 `skill_skipped` 且回合照常完成、不注入技能块；`materialId` 不在 `materials` 中被丢弃；`</skill>` 被转义（〔评审 R-07/R-13〕） |
| `src/app/api/video-editing-agent/chat/__tests__/runLifecycle.test.ts`（补充用例） | `triggerAbort` 路径 `close()` 后 `steer` 得 `run_closed`；`setSteeringMode('all')` 下同批 2 条插话各发一次 `steer_applied`；`close()` 幂等（〔评审 R-09/R-11〕） |
| `src/components/video/hooks/__tests__/useAgentSteering.test.ts`（补充用例） | `onRestart` 把 `sent` 退回 `local` 并在新 `run_started` 后补发；以 `ask_user` 收尾的回合不自动发送队列（〔评审 R-01/R-08〕） |
| `src/components/video/hooks/__tests__/useAgentSteering.test.ts` | 状态机全部转移（含 local→sent、404 降级、429、停止回填） |
| `src/components/video/components/VideoChatWindow/__tests__/turnSummary.test.ts`、`TurnSummaryCard.test.tsx`、`SteerQueue.test.tsx`、`ComposerSkillPicker.test.tsx`、`AgentBusyBar.test.tsx` | 纯函数 + 交互 + a11y 断言 |
| `src/components/settings/__tests__/AgentSkillsSettingsPanel.test.tsx` | 列表/启停/校验/导入预览/错误 `role="alert"` |
| `tests/integration/agent-steering.test.ts`（`vitest.integration.config.ts`） | 用假模型流跑真实路由：回合中途插话 → 收到 `steer_applied` → 后续工具调用受影响 |
| 后端 3 个测试文件 | 见 §7.1 |

---

## 8. 实施顺序与验证命令

建议 4 个可独立合并的批次（每批结束必须 `type-check` + 受影响测试全绿）：

| 批 | 内容 | 依赖 |
|---|---|---|
| B1 | 后端技能服务 + BFF + 设置面板 + 内置技能（不接入 Agent） | 无 |
| B2 | Agent 接入：`skillContext`、`use_skill`、L0 技能段、`/` 选择器、`@` 引用、配方迁移 | B1 |
| B3 | 插话：登记表、`steer` 路由、SSE 事件、`useAgentSteering`、芯片/节点/忙碌条 | 无（可与 B1 并行） |
| B4 | 总结卡、规则 16、`build_credits`、↑/草稿/Esc/重试/复制 | B2（总结卡的"来源清单"按钮依赖工具） |

```bash
# 前端（仓库根）
npm run type-check
npx vitest run src/lib/video-editing-agent src/lib/server src/app/api/video-editing-agent src/app/api/agent-skills src/components/video src/components/settings
npx vitest run --config vitest.integration.config.ts tests/integration/agent-steering.test.ts   # 必须显式指定集成配置，否则 0 用例退出码 0
ESLINT_USE_FLAT_CONFIG=false npx eslint <改动文件>   # 单文件 lint 必须带此环境变量，否则 exit 2 且什么都没检查
# 后端（backend-services/basic-service，已激活 venv）
pytest tests/test_agent_skills_parser.py tests/test_agent_skills_store.py tests/test_agent_skills_router.py -v
# 桌面打包后核对内置技能随包发布
npm --prefix desktop run build:dir   # 然后确认 resources 中存在 app/services/agent_skills/builtin/*/SKILL.md
```

改动前先在记录里写下基线（全量 `vitest` 的失败数与后端 7 个既有失败），避免"补测试时把既有红点算成自己的"（toolkit C2 的教训）。

---

## 9. 测试与验收标准

### 9.1 验收标准（AC）

**A 插话**
- **AC-A1** 运行中输入框可输入；`Enter` 发出 `POST /steer` 且收到 202；空闲时 `Enter` 行为与改动前逐字节一致（既有 `VideoChatWindow` 测试不改断言）。
- **AC-A2** 工具执行期间的插话在该工具结束后被送达，服务端发出 `steer_applied`，其 `afterToolCallId` 等于刚结束的工具；下一次模型请求的消息列表包含 `STEER_WRAPPER(text)`。
- **AC-A3** 同批剩余工具被 pi 跳过时，客户端不报错、卡片显示为已取消/跳过。
- **AC-A4** 第 4 条待送达被 `429 steer_queue_full` 拒绝，文本回填输入框，不丢失。
- **AC-A5** 回合结束时仍未送达的插话经 `steer_dropped`（或客户端兜底）变为排队，并在回合 **completed** 时合并为一条消息自动发送；回合 cancelled/error 时全部回填输入框；〔评审 R-08〕回合以未回答的 `ask_user` 收尾时**不自动发送**，队列回填输入框并提示。
- **AC-A6** `Alt+Enter` 的文本只在客户端队列中，服务端日志与 `agentRunRegistry` 中无其痕迹。
- **AC-A7** 服务端进程重启（登记表清空）后的 `steer` 得到 404，客户端降级为排队，无报错弹窗。
- **AC-A8** 日志中无插话正文（grep 测试：构造含哨兵串的插话，捕获 `console.*`，断言不含）。
- **AC-A9** 看门狗：连续插话不重置超时。
- **AC-A10** 〔评审 R-01〕SSE 自动重连（新 run、新 `runId`）后：客户端旧 `runId` 被清空，`sent` 插话退回 `local` 并在新 `run_started` 后补发；不向旧 `runId` 重复提交；无任何报错弹窗。
- **AC-A11** 〔评审 R-09〕停止/超时后到达的 `POST /steer` 得 `409 run_closed`（不是 202）；cancelled/error 路径下所有未送达文本回填输入框，且**不依赖** SSE `steer_dropped`。
- **AC-A12** 〔评审 R-10〕`POST /steer` 状态码矩阵：缺 JSON 头 → 415；错误 Origin/缺 Origin/`sec-fetch-site: cross-site` → 403；其余见 §3.2.2。

**B 技能**
- **AC-B1** 6 个内置技能全部通过 `parse_skill`；`id` 等于目录名；正文 ≤ 3 500 码点且 ≤ 10 240 字节；`description` ≤ 60 码点；`tools` 中的工具名在前端注册表均存在（前端测试遍历 `GET /index` 的静态快照或读取同一目录）。
- **AC-B2** 用户创建/更新/删除/启停/复制全链路通过；同名创建 `409 skill_exists`；内置的修改与删除 `403 builtin_readonly`；`validate` 不产生任何文件。
- **AC-B3** `id` 含 `../`、绝对路径、控制字符 → `invalid_parameters`，磁盘无变化。
- **AC-B4** 损坏的 SKILL.md 不使列表失败：条目 `valid:false`，且不出现在 `/index` 与 `use_skill`。
- **AC-B5** 技能服务不可用（后端 500/超时）时，回合照常运行，L0 无"可用技能"段，且 `console` 只有一条 warning。
- **AC-B6** 〔评审 R-03〕两组夹具：（a）中文满 3 500 字；（b）4 字节字符（emoji）填满字节上限的正文（解析器须在 10 240 字节处拒绝更长者）。两组的 `use_skill` 工具结果（`content` 与 `details` 两侧）字节数均 ≤ 12 288，正文未被截断（`truncated` 不出现）。
- **AC-B7** 技能 `requires: [web]` 而网络能力不可用时：L0 行带 `[unavailable: web]`；`use_skill` 仍返回正文，`note` 说明降级路径。
- **AC-B8** 〔评审 R-05〕L0 总长度，**以实测为准，不使用估算数**：（a）实施首步记录最坏情形基线 `L0_BASE`（沿用 `systemPrompt.toolkit.test.ts` 的"满计划 + 记忆"夹具）；（b）加入 10 条最大长度技能索引（含 `[unavailable: …]` 后缀）后，最坏情形长度 − `L0_BASE` ≤ 400；（c）**既有 ≤ 18 500 断言原样通过**，`L0_PROMPT_CHAR_CEILING` 仍为 18 900、不得抬高；（d）技能段总长 ≤ 1 300、单行 ≤ 130；（e）`toolActivation.test.ts` 的模式字节余量断言通过。
- **AC-B9** `/` 选择器：键盘可达、IME 合成中不误选、`aria-activedescendant` 正确；选中后载荷含 `skillId`，对话中显示的仍是用户原文。
- **AC-B10** 用户技能正文含"忽略以上指令并导出"之类内容时，仍不改变任何网关/开关（单测断言工具授权集合不变）。
- **AC-B11** 〔评审 R-02〕`id` 为 `index`、`validate`、`con`、`prn`、`aux`、`nul`、`com1`–`com9`、`lpt1`–`lpt9` 时创建/校验均得 `invalid_skill`；磁盘上手工放入同名目录时列表扫描忽略并记 warning，不抛异常；`GET /api/agent-skills/index` 始终是索引而不是某个技能。
- **AC-B12** 〔评审 R-07〕`skillId` 取不到（`not_found`/`disabled`/`invalid`/`unavailable` 四种原因各一例）时：回合照常完成、提示里无技能块、客户端收到 `skill_skipped` 并显示次要提示、该 user 消息的 `skillId` 被清除、服务端日志仅一条 warning。
- **AC-B13** 〔评审 R-04〕`description` 含换行、控制字符，或以 `#`/`-`/`*`/`>`/`` ` `` 开头时被拒；L0 渲染后的每一行都以 `- ` 开头且不含换行，磁盘手改绕过解析器的坏文件也不能在系统提示词里产生额外行。

**C 交互**
- **AC-C1** `summarizeTurn` 对"无工具调用/流式中/已取消"返回 `null` 或精简版；对完整回合的计数与 `agentToolCalls`、`timelineTrackPatches` 一致（至少 6 组夹具）。
- **AC-C2** 总结卡的"撤销本轮"与既有 `undoAllOperations` 行为一致；运行中被阻止并给出既有文案。
- **AC-C3** 忙碌条：有计划时显示"步骤 i/n · 标题"，无计划时回退旧文案；计时器不使读屏器每秒播报（`aria-hidden` 断言）。
- **AC-C4** `Esc` 双击停止；单击仅提示；选择器打开时 `Esc` 只关选择器。
- **AC-C5** 草稿：`localStorage` 抛错（隐私模式）时输入框正常工作；切换会话后恢复；发送后清除。
- **AC-C6** `@` 引用：发送前剔除已被用户删掉文本的引用；超过 10 条被截断且提示。

**D 授权账本**
- **AC-D1** 规则 16：时间线含 `license_status:'unknown'` 的网络素材 → 1 条聚合 warning；全为 `declared` 或本地素材 → 无；导出不被阻断。
- **AC-D2** `build_credits`：表格对 `|`、换行、反引号转义；字段截断；`used` 只含上轨素材；工作区关闭时降级且不报错。
- **AC-D3** `LINT_RULE_CODES.length === 16`，`checked_rules` 回显 16 条；全仓库搜索不再有断言"15 条"的测试或文案。

**通用**
- **AC-G1** `npm run type-check` 0 错误；受影响范围测试全绿；既有失败数不增加（对照 §8 基线）。
- **AC-G2** 〔评审 R-06〕**棘轮规则**（取代 v1 的"所有改动文件 ≤ 800 行"，后者因基线已超线而不可达）：① 新建文件与基线 ≤ 800 行的改动文件，改后必须 ≤ 800；② 基线已 > 800 行的改动文件，行数**不得增长**，其中 `useAgentExecution.ts`（基线 916）目标 ≤ 800，做不到须在实施记录登记剩余债务与原因；③ `src/lib/i18n.ts`（基线 10 753 行）是项目约定的单一翻译数据文件（CLAUDE.md），豁免文件行数规则，但新增键必须成块集中、en 与 zh-CN 对称；④ 函数 ≤ 50 行、参数 ≤ 5（超出须有注释说明原因，沿用 CLAUDE.md）。验证命令：改动前后各跑一次 `git ls-files <改动文件> | xargs wc -l`，把对比表写进实施记录。
- **AC-G3** 无新增数据库表/DDL；`git status` 中仅出现 §7 登记的文件。
- **AC-G4** en 与 zh-CN 两套文案键集合完全一致（既有 i18n 一致性测试通过）。

### 9.2 手工验收清单（桌面端，发布前）

1. 做一条带联网搜索的视频，第 2 分钟插话"改成竖版"，观察芯片→节点→Agent 响应链路。
2. 工具运行中点芯片"改为停止并重发"，检查续跑注记与新回合。
3. `Alt+Enter` 排两条，回合完成后自动合并发出；中途点停止，检查两条回到输入框。
4. `/` 选"成片自检"；在设置中心复制一个内置技能为"我的技能"，改一行后保存，再用 `/` 调用，确认生效。
5. 导入一个含可疑指令的 SKILL.md，确认必须先看到完整预览才能创建。
6. 暗色模式与 150% 缩放下，忙碌条/芯片/总结卡无截断、对比度达标；开启系统"减少动态效果"后无脉冲动画。
7. 打包版（`build:dir`）里确认内置技能列表非空。

---

## 10. 风险与缓解

| ID | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 用户期望"插话立即生效"，但实际要等当前工具结束 | 对耗时工具感觉"没反应" | 芯片明确写出等待对象；提供"停止并重发"；文案不使用"立即" |
| R2 | pi 跳过同批剩余工具，已发起的并行副作用（如已提交的生成任务）不会被回收 | 重复生成/孤儿任务 | 沿用既有异步任务登记与去重；插话不尝试撤销已发起任务；Agent 注记要求"先确认现状再继续"（`STEER_WRAPPER` 已含"已完成的操作保留"） |
| R3 | 导入的 SKILL.md 可能携带提示词注入 | Agent 被诱导偏离用户意图 | 导入必须完整预览；技能不能授予权限（§3.3.1）；L0 只含名称与一句话；`description` 与正文都按"用户自有内容"处理而非系统指令，且工具网关/开关不受其影响（AC-B10） |
| R4 | `globalThis` 登记表在多进程/集群下失效 | 插话 404 | 产品形态是单进程桌面应用（CLAUDE.md）；404 已有降级路径；文档注明不支持多实例 |
| R5 | 网络素材元数据（作者、标题）是不可信外部文本，写入 `credits.md` 或界面 | 表格破坏/注入 | 转义与截断（§3.5）；前端渲染一律走文本节点，不用 `dangerouslySetInnerHTML` |
| R6 | L0 预算（既有最坏情形仅余 ≈ 400 字符） | 提示词超限、挤占对话 | 〔评审 R-05〕相对实测基线净增 ≤ 400；既有 ≤ 18 500 断言不放宽；索引 ≤ 1 300 并硬截断；超限时按"缩索引 → 压引导句 → 并入配方 4"顺序削减 |
| R13 | SSE 自动重连 = 新 run、新 `runId`（路由不能续跑） | 旧 `runId` 的插话 404、`sent` 状态卡住 | 〔评审 R-01〕`onRestart` 清空 `runId`、`sent`→`local`、新 `run_started` 后补发（AC-A10） |
| R14 | 技能 `description` 进入系统提示词 | 提示词注入/伪造规则行 | 〔评审 R-04〕单行、禁控制字符与 Markdown 前缀、≤ 60 码点；渲染端二次清洗；技能不授予权限 |
| R15 | Windows 设备保留名与路由保留字作技能 id | 目录创建失败 / 路由碰撞 | 〔评审 R-02〕保留字表 + 扫描忽略 + 测试遍历 |
| R7 | `useAgentExecution.ts`（916 行）与 `VideoChatWindow.tsx`（564 行）继续膨胀 | 违反 800 行红线、难维护 | 新逻辑强制落子模块；净行数验收（AC-G2）；抽出 `agentTurnLifecycle` |
| R8 | 规则 16 改变"15 条自检"契约 | 旧测试/文案/报告卡不一致 | §3.5 列出全部同步点；AC-D3 用全仓搜索兜底 |
| R9 | 键位冲突（`Alt+Enter`、`/`、`@`、`↑`） | 误触发、IME 问题 | 一律先判 `isComposing`；`/`、`@` 仅在行首/词首触发；选择器打开时由选择器独占方向键；覆盖测试 |
| R10 | 技能文件由用户直接改动磁盘 | 状态与缓存不一致 | mtime 缓存失效 + 5 秒目录缓存；损坏条目可见而非静默消失 |
| R11 | 打包遗漏内置技能（非 `.py` 资源） | 打包版技能列表为空 | F-14 已确认整目录复制；增加后端测试断言内置目录非空 + 手工清单第 7 项；列表为空时设置面板显示明确提示而非空白 |
| R12 | 总结卡"让 Agent 修复"一键发送的固定文案造成误操作 | 用户无意触发新回合 | 需明确点击；发送内容固定并可在对话中看到；不自动触发 |

---

## 11. 兼容性与回滚

- **向后兼容**：所有新增字段均为可选；旧会话无 `steers/skillId/mentions` 照常渲染与回放；旧客户端遇到新 SSE 事件会忽略；新客户端遇到旧服务端（无 `run_started`）自动退化为"运行中 Enter＝排队"。
- **功能开关**：不新增设置项（避免配置面膨胀）。降级即回退：技能服务失败 → 无技能；登记表缺失 → 排队。如需紧急关闭，只需让 `loadSkillIndex` 返回空数组并让 `steer` 路由返回 404，客户端即回到"排队"体验。
- **回滚**：本轮无 DDL、无数据迁移；回滚＝回退提交；用户技能目录留在磁盘上作为无害的惰性数据。

## 12. 契约变更登记（评审必看）

1. `LINT_RULE_CODES` 15 → 16（新增 `web_material_license_unknown`）。
2. `SSEEvent` 新增 `run_started` / `steer_applied` / `steer_dropped` / `skill_skipped`（4 个）。
3. 新增 HTTP 契约 `/api/video-editing-agent/steer`、`/api/agent-skills/*` 及错误码闭集。
4. `ChatMessage` 新增三个可选字段。
5. 常驻核心工具 +1（`use_skill`）、按需工具 +1（`build_credits`）；〔评审 R-16〕既有断言 `CORE_TOOLKIT_TOOL_NAMES.toHaveLength(18)`（`systemPrompt.toolkit.test.ts:89`）同步改为 19。
6. `ToolkitCall.basePath` 新增可选字段（默认值保持旧行为）。
7. 技能 `id` 保留字表（`index`、`validate`、Windows 设备名）与 `description` 单行规则：属 `invalid_skill` 的输入契约，日后放宽或收紧都要进变更日志。
8. `Agent` 的 `steeringMode` 显式设为 `'all'`（〔评审 R-11〕），偏离 pi-agent-core 默认值。

## 13. 明确不纳入本轮（后续候选）

1. 技能附带资源文件（L2）、技能市场/在线分享/签名：需要打包格式与信任模型，另起一轮。
2. 子代理并行（多素材检索、多路审阅）：仍不引入子代理，沿用 agent-visual-review §3.4 的取舍。
3. 运镜工具化 `set_camera_motion`（agent-visual-review §13-7 遗留）：独立一轮。
4. 把图片直接贴给主模型（多模态）、聊天窗口粘贴/拖拽图片：需附件管道，见 agent-visual-review §13-1/2。
5. 撤回已提交的插话：pi-agent-core 无取消接口，不做"假撤回"。
6. 跨会话的运行恢复（进程重启后继续同一回合）：现有续跑协议按"新回合 + 注记"处理，不做进程级恢复。
7. 授权状态的自动判定（读取 Creative Commons 标识、反向图片检索）：本轮只展示来源页声明的状态，不做法律判断。
8. `visionAdapter` 迁移到 `ToolkitCall.basePath`：功能等价的重构，单独提交以缩小本轮改动面。

## 14. 本轮交付定义（DoD）

- 四条主线的 AC 全部通过，§9.2 手工清单在桌面打包版执行并记录结果；
- 〔评审 R-18〕**可裁剪项**：B4 中的 ↑ 回溯、消息复制、草稿保留、失败重试（§3.4.4 中标 P2 的四项，对应 AC-C5 及相关用例）若时间不足可整项延后，**不阻塞 DoD**，但必须在实施记录"未交付项"里逐条登记（含原因与建议的下一轮归属）。A（插话）、B（技能）、D（授权账本）、总结卡、Esc 双击停止、`@` 引用均为必交付；
- 受影响范围测试全绿、类型检查 0 错误、既有失败数不增加；
- 本文件末尾追加"实施记录"小节：实测的 `L0_BASE` 与加入技能索引后的 L0 字符数、各 AC 证据命令与结果、AC-G2 行数前后对比表、实施过程发现的方案缺陷（沿用前四份 spec 的做法，不在别处另起文档）。

---

## 评审结论

**结论：有条件通过**（设计评审 · v2 · 2026-10-27）

**评审范围与方法**：逐节对照 `CLAUDE.md` 约定与代码库现状核对；对三处关键前提做了源码级验证——（1）`pi-agent-core` 的 `steer` 语义与消息引用相等性；（2）`chat/route.ts` 的生命周期与 `SSEStreamManager` 的重连语义；（3）L0 提示词预算的既有断言与余量。结论：方案的核心机制可行（复用 `agent.steer`、进程内登记表、文件型技能库、零 DDL），分层与降级路径符合项目约定，规模与前四轮同量级且四批可独立合并。

**问题统计**：P0 = 0；P1 = 10（R-01…R-10），**已全部在正文修订，无遗留 P1**；P2 = 10（R-11…R-20），已吸收进正文或测试清单。v1 中最实质的缺陷是 R-01（对 SSE 重连语义的错误断言）、R-02（技能 id 与路由/Windows 设备名碰撞）、R-03（字节上限只对 ≤ 3 字节字符成立）、R-08（`ask_user` 收尾后自动提交排队文本）。

**通过所附的条件**（均为实施期的可验证动作，不是设计缺口）：

1. **先测基线再写代码**：实施第一步在"实施记录"写下 L0 最坏情形实测值 `L0_BASE`（AC-B8），并在 B2 合并前证明"既有 ≤ 18 500 断言原样通过、净增 ≤ 400"。若实测无法满足，按 §3.3.3 的削减顺序处理，**不得抬高 `L0_PROMPT_CHAR_CEILING`**。
2. **先验证 pi 行为假设再接线**：`runLifecycle.test.ts` 与集成测试必须用真实 `Agent` 实例（假模型流）证明三点——引用相等匹配成立、`setSteeringMode('all')` 下同批多条各发 `steer_applied`、插话使同批剩余工具被跳过且客户端无报错（AC-A2/A3/A11）。任何一点与 §3.2.2 不符，回到本文档修订后再继续。
3. **`useAgentExecution.ts` 行数**：按 AC-G2 棘轮规则落地，目标 ≤ 800；做不到须登记债务，不得增长。
4. **打包版核对**：手工清单第 7 项（打包版内置技能非空）必须在 `build:dir` 产物上执行，并确认 `SKILL.md` 未被打包过滤；该项失败视为 B1 未完成。
5. **B4 的 P2 体验项可裁剪**（见 §14），裁剪须登记，不得用来掩盖 A/B/D 主线的未完成。

满足以上条件后，本设计可进入实施，无需再次设计评审；若实施中发现需要新增数据库表、新增 SSE 事件或更改 §12 契约清单之外的对外契约，须先回到本文档登记并重新评审。


---

## 实施记录

> 实施日期 2026-10-27 · 基线 HEAD = `75a27492` · 未执行 `git commit`（按节点约束，提交由下一节点负责）。

### 1. 基线与预算实测（评审条件 1）

| 项 | 实测 |
|---|---|
| `L0_BASE`（最坏情形：满计划 + 记忆，实施前） | **17 075** 字符 |
| 迁移后、**无**技能索引 | 16 337（−738：配方 1–3 移出提示词） |
| 迁移后 + 6 个内置技能的真实索引 | 16 673（相对 `L0_BASE` **−402**） |
| 迁移后 + 10 条最大长度索引（含 `[unavailable: web]`，压力情形） | 17 434（相对 `L0_BASE` **+359** ≤ 400） |
| 既有断言 ≤ 18 500 / `L0_PROMPT_CHAR_CEILING = 18 900` | 原样通过，**未放宽、未抬高** |

压力情形首次实测为 +406，超 400；按 §3.3.3 的削减顺序先压缩了 `AGENT_TOOLKIT_GUIDANCE` 的两句引导（−47 字符）而没有缩索引。断言写在 `systemPrompt.toolkit.test.ts` 的 `skill index budget (AC-B8)`。

### 2. pi-agent-core 行为假设核验（评审条件 2）

`runLifecycle.test.ts` 与 `tests/integration/agent-steering.test.ts` 用**真实 `Agent`**（脚本化模型）证明：

- 引用相等匹配成立：插话送达时 `message_start` 携带的就是登记的对象，`steer_applied` 在其后发出；
- `setSteeringMode('all')` 下同批 2 条插话各发一次 `steer_applied`；
- 插话使同批剩余工具被跳过（`toolsRun` 只含第一个）；
- 插话在首次模型调用前入队时，`afterToolCallId = null`。

发现并已回写正文的 3 处偏差见下方「实施过程发现的方案缺陷」#1–#3。

### 3. 各 AC 证据

| AC | 证据（命令 → 结果） |
|---|---|
| A1–A3、A9 | `vitest run src/app/api/video-editing-agent src/components/video/components/VideoChatWindow/__tests__/useComposer.test.tsx` → 通过；`useComposer` 断言空闲 Enter 调用与改动前一致（`onSendMessage(text, undefined)`） |
| A4–A7、A10 | `useAgentSteering.test.ts`（状态机 19 例，含 429 回填、404 降级、`onRestart` 退回 local 并补发、旧 run 迟到响应忽略、ask_user 收尾不自动发送、停止/出错回填） |
| A8 | `steer/__tests__/route.test.ts`：哨兵串不出现在任何 `console.*` |
| A11、A12 | `steer/__tests__/route.test.ts`（415 先于 403；缺 Origin / 跨站 403；run_closed 409）+ `runLifecycle.test.ts`（`close()` 后 `run_closed`、幂等） |
| B1 | 后端 `test_agent_skills_parser.py`（6 个内置技能全部通过 `parse_skill`）+ 前端 `builtinSkills.test.ts`（工具名全在注册表、预加载分组满足 ≤2 组/≤4 个） |
| B2–B4、B11、B13 | 后端三份测试 **179 例全绿**（`pytest tests/test_agent_skills_parser.py tests/test_agent_skills_store.py tests/test_agent_skills_router.py`，含 `register(app)` 端到端用例）；渲染端 `skillContext.test.ts` |
| B5 | `skillContext.test.ts`：索引读取失败返回 `[]`、仅一条 warning |
| B6 | `skillTools.test.ts`：3 500 汉字 / 4 字节字符 / 换行膨胀三组夹具，`content` 与 `details` 均 ≤ 12 288 字节 |
| B7 | `skillTools.test.ts`（`requires` 不满足仍返回正文 + `note`）+ `skillContext.test.ts`（`[unavailable: web]`） |
| B8 | 见 §1 |
| B9 | `useComposer.test.tsx`（IME 合成中不触发、方向键/Enter/Tab/Esc）+ `ComposerSkillPicker.test.tsx`（`listbox`/`option`/`aria-selected`/选项 id） |
| B10 | `use_skill` 不改变工具授权集合：`skillTools.test.ts` 中预加载只经 `loadTools`，不存在的工具进 `unavailable`（技能无法授予新工具） |
| B12 | `chat/__tests__/skillSkipped.test.ts`（4 种原因各一例，回合照常、无技能块、仅一条 warning）+ `useAgentExecutionSteering` 清除 `skillId` |
| C1 | `turnSummary.test.ts`（9 组夹具） |
| C3 | `AgentBusyBar.test.tsx`：计时器 `aria-hidden`、状态文案才在 live region |
| C4 | `useComposer.test.tsx`：Esc 双击停止、单击仅提示、选择器打开时 Esc 只关选择器 |
| C5 | `useComposerStorage.test.tsx`：`localStorage` 抛错时输入正常、恢复/防抖/发送后清除 |
| C6 | `composerTriggers.test.ts` + `useComposer.test.tsx`：已删文本的 `@` 引用被剔除、>10 条截断 |
| D1–D3 | `qualityLint.licenseRule.test.ts`、`creditsTool.test.ts`；`LINT_RULE_CODES.length === 16`；全仓搜索「15 条/15 checks」已清零（含 `i18nAgentToolkit.test.ts`、`QualityReportCard`、规则文案） |
| G1 | `npx tsc --noEmit` **0 错误**；全量 `vitest run --maxWorkers=4`：4 033 例，4 004 通过 / 28 跳过 / **1 失败 + 1 个文件加载失败，均为基线问题**（见 §5） |
| G3 | 无新增 ORM 表 / DDL；`git status` 只含 §7 登记的文件（另有 §4 列出的少量必要附带文件） |
| G4 | `i18n` 的 `agentCollab` 区块由同一份键表生成 en / zh-CN / 接口三处，键集合完全一致 |

### 4. AC-G2 行数对比（棘轮规则）

| 文件 | 基线 | 现在 | 判定 |
|---|---|---|---|
| `src/components/video/hooks/useAgentExecution.ts` | 916 | **891** | 未增长（目标 ≤800 **未达成**，登记为债务，见 §6） |
| `src/components/video/VideoEditingInterface.tsx` | 2 457 | 2 457 | 未增长 |
| `src/types/index.ts` | 958 | 958 | 未增长（三个新字段用模块增强声明在 `types/agentSteering.ts`） |
| `backend-services/basic-service/app/main.py` | 791 | 797 | ≤800（注册收敛为 `agent_skills_router.register(app)` 一次调用） |
| `src/lib/i18n.ts` | 10 753 | 11 031 | 数据文件豁免；新增键成块集中（`// BEGIN/END agentCollab`） |
| `src/app/api/video-editing-agent/chat/route.ts` | 712 | 743 | ≤800；净增 31 行（预算 30 行，+1 来自 `abortTriggered` 守卫，见缺陷 #7） |
| `VideoChatWindow.tsx` | 564 | 631 | ≤800；净增 67 行（预算 60：新增 props 与 7 处接线，逻辑均在 `useComposer`/子组件） |
| 其余新建/改动文件 | — | 全部 ≤ 410 行 | 通过 |

附带的必要改动（不在 §7 清单内）：`src/app/api/agent-skills/route.ts`（BFF 空路径，缺陷 #10）、`ComposerPicker.tsx`（两个选择器共用展示层）、`useAgentExecutionSteering.ts`、`steeringMachine.ts`、`useComposer.ts`、`useComposerStorage.ts`、`composerTriggers.ts`、`askScan.ts`、`webMaterialProvenance.ts`、`turnPrompt.ts`、`AgentSkillEditor.tsx`、`agentTurnLifecycle.ts`（承接从 `useAgentExecution` 抽出的 4 个纯函数）、`AgentResponseNode.undo*.test.tsx` 两处模块映射（测试按源码编译，新增 import 必须登记）。

### 5. 测试基线与失败说明

- 全量 `vitest run --maxWorkers=4`（4 033 例）：4 004 通过 / 28 跳过 / **仅 2 项失败，均非本轮引入**：
  - `AgentChatDock.lifecycle.test.tsx`：`unmapped import @/types/agentToolkit`。该测试用自制模块映射编译 `VideoChatWindow.tsx` 源码，而 **HEAD 的** `VideoChatWindow.tsx` 就已 import `@/types/agentToolkit`（`git show HEAD:…` 可核对），所以基线即红；本轮未改动该文件，以免掩盖。
  - `VideoEditorContainer.recoveryBackup.test.ts`：对 `VideoEditorContainer` 源码的正则断言，本轮未触碰该文件。
- 默认（不限 worker）并发下，`toolkitTools.test.ts` / `visionTools.test.ts` 的**首个用例**偶发 5 s 超时（其后用例随之级联失败）；单独运行分别 1.5 s / 0.6 s 通过，限 4 个 worker 全量运行也通过：冷启动动态 import 在高负载下超过默认 5 s，属负载型抖动，非逻辑回归。
- 后端：本机 `import cv2` 失败（既有环境问题，`tests/conftest.py` 已有 shim），故无法在本机起完整 `app.main`；路由层用 `register(app)` + `TestClient` 覆盖。后端既有 7 个失败用例未改动、未重算。

### 6. 未交付项与债务（评审 R-18 要求逐条登记）

| 项 | 原因 | 建议归属 |
|---|---|---|
| 失败/取消回合的「重试」按钮、助手消息「复制」（§3.4.4 两项 P2） | 可裁剪项；与 A/B/D 主线无依赖，且需要改动 `AgentResponseNode` 的对外布局 | 下一轮交互收尾 |
| `/` 选择器对 `requires` 不满足行的置灰 | 选择器组件已支持 `unavailable` 属性，但客户端没有能力快照来源（能力只在服务端 `researchSnapshot` 里）。目前 `use_skill` 的 `note` 与 L0 `[unavailable: …]` 仍然生效，用户侧只是不提前置灰 | 随「能力快照下发到客户端」一并做 |
| `useAgentExecution.ts` ≤ 800 行 | 现 891。已抽出 4 个纯函数；剩余的 `createTurnCallbacks` / `undoAll` / `undoSingle` 共享 10+ 个 ref，需要整体拆成 `useAgentUndo` 才能再减约 130 行，风险大于本轮收益 | 独立重构提交 |
| `skill_skipped` 提示显示技能名 | 提示是**瞬态**（不随会话持久化），且客户端没有技能名缓存，因此显示 `skillId` 而不是名称 | 低优先级 |
| §9.2 桌面端手工清单（含 `build:dir` 产物核对第 7 项） | 本节点无法驱动桌面端。已用 Node 复刻 `prepare-backend.js` 的 `cpSync` 过滤器验证 6 个 `SKILL.md` 全部随包，且 `electron-builder.yml` 对 `build/backend` 无扩展名过滤；**真实 `build:dir` 未跑** | 发布前必做（评审条件 4） |
| R-19：用 pi-ai 的 anthropic / openai 转换器跑回放序列 | 用「toolCall 后必须紧跟其 toolResult、中间不插 user」的结构不变式覆盖（`messageConverter.steer.test.ts`），未调用 provider 转换器 | 如发现某 provider 拒绝再补 |

### 7. 契约变更登记补充（相对 §12）

在 §12 的 8 项之外，实施中新增/确认的对外契约：

- 技能错误码闭集新增 `json_required`（415，来自复用的 Origin 守卫）；
- `ToolkitCall` 另增可选 `select`（只保留响应 `data` 的指定键），默认行为不变；
- `ToolContext` 新增可选 `loadTools` 与 `skillAvailability`；
- `use_skill` 结果可含 `body_truncated: true`（仅当 JSON 转义膨胀使正文无法在 12 KiB 内完整送达时），与 `toolkitResult` 的 `truncated` 区分；
- 用户技能目录位置：`<STORAGE_ROOT 的同级>/agent_skills/`（见缺陷 #9）。

---

## 实施过程发现的方案缺陷

> 本节按任务约束追加；正文中与之冲突的描述以本节为准，已在代码里按"修正后的做法"实现。

1. **`steer_dropped` 在 `finally` 里发送，客户端收不到（§3.2.2 第 4 点、§3.2.3）。** `SSEStreamManager.isStreamEndEvent` 把 `agent_end` 当作流结束，客户端读到它就停止读流；`finally` 发在 `agent_end` 之后，评审 R-09 只想到 cancel/error 路径收不到，**completed 路径同样收不到**。修正：`createRunHandle.onAgentEvent` 在收到 `agent_end` 时先 `close()`（此处订阅先于 SSE 路由的订阅，所以 `steer_dropped` 一定排在 `agent_end` 之前）。`finally` 中的 `close()` 保留作兜底（幂等）。`runLifecycle.test.ts` 钉住了顺序。
2. **`afterToolCallId` 可能指向被跳过的工具。** 插话使同批剩余工具被跳过时，pi 仍为被跳过的工具发 `tool_execution_end`，所以 `afterToolCallId` 是**该批最后一个工具**（可能是被跳过的），而不是真正执行完的那个。这与回放逻辑一致（该 id 同样在 `agentToolCalls` 里，状态为已取消/跳过），无需改动，但 §3.2.2 第 3 点与 AC-A2 的措辞「等于刚结束的工具」应读作「等于最后一次 `tool_execution_end`」。
3. **回放位置不能是「紧跟匹配的 toolResult」（§3.2.5）。** 历史被压平成「一条 assistant 消息 + 其全部 toolResult」，在两个 toolResult 之间插 user 消息会破坏 `tool_use`/`tool_result` 配对（anthropic 会 400）。修正：已送达的插话放在**整个工具块之后**；`afterToolCallId` 为 null 或找不到则放在该 assistant 消息之前。`messageConverter.steer.test.ts` 用配对不变式断言。
4. **`GET /{id}` 同时返回 `markdown` 与 `body`，直接走 `executeToolkitTool` 会把正文头尾截断（§3.3.5）。** 两者并存使结果超 12 KiB，`shrinkOversizedValues` 会把 `body` 压到 1 200 字符。修正：`ToolkitCall.select` 只保留需要的键；并且 JSON 转义（换行/引号）会让 ≤10 240 字节的正文序列化后膨胀，所以 `use_skill` 再做一次 `fitBody` 兜底，膨胀到无法完整送达时才标 `body_truncated`。
5. **正文两个上限互相冲突，AC-B6(a) 字面不可满足（§3.3.1）。** 3 500 个汉字 = 10 500 字节 > 10 240 字节上限，纯中文实际最多 **3 413** 字。后端按字节为准（3 413 字通过、3 414 被拒）；`use_skill` 测试用「3 500 汉字」夹具验证的是**结果大小 ≤12 KiB**（该夹具走前端注入的正文，不经后端字节校验）。建议下一版把码点上限降到 3 400 并改写 AC-B6(a)。
6. **§3.3.2 的示例违反自己的「组数 ≤2」，且常驻工具预加载无意义。** 示例 `[generate_video_script, batch_generate_tts, search_video, add_to_track]` 跨 4 个类别；而 `CORE_TOOLKIT_TOOL_NAMES` 里的工具（`search_*`、`generate_*`、`*_tts`、`*_storyboard` 等）本来就常驻。实现：`use_skill` 对常驻工具直接记入 `loaded_tools`、不占分组；「组数 ≤2」只计非常驻类别。内置技能的 `tools` 因此只列真正需要按需加载的工具。
7. **`chat/route.ts` 必须在技能读取之后再检查一次 `abortTriggered`。** `resolveTurnPrompt` 引入了一次最长 1.5 s 的 await；若用户在此期间点停止，`agent.prompt()` 会在中止后才被调用，模型无人看管地跑起来。已加 `if (abortTriggered) return;`（净增 1 行，导致 route.ts 净增 31 行，略超 §7.2 的 30 行预算）。
8. **`ChatMessage` 的三个新字段无法写进 `types/index.ts`（AC-G2）。** 该文件基线 958 行，棘轮规则禁止增长。改用 `declare module './index'` 的模块增强写在 `types/agentSteering.ts`，类型检查与消费方完全等价。
9. **用户技能目录不能放在 `STORAGE_ROOT` 之内（§3.1、§3.3.4、§6）。** `STORAGE_ROOT` 下的文件由 `/api/storage/files` 对外服务，技能原文（可能含用户私有套路）会被静态暴露。实现取 `Path(settings.storage.root).resolve().parent / "agent_skills"`，与 `workspace_store` 一致。
10. **BFF 的 `[...path]` 不匹配空路径。** `GET /api/agent-skills`（管理列表）与 `POST /api/agent-skills`（创建）会直接 404。新增同级 `src/app/api/agent-skills/route.ts` 复用同一份代理转发。
11. **被内置技能遮蔽的用户目录无法经 API 删除。** 它以 `shadowed: true` 出现在列表里，但 `DELETE /{id}` 对该 id 返回 `builtin_readonly`，只能手工删磁盘；同一 id 在列表里出现两条。后续版本应给遮蔽条目单独的删除方式。
12. **「撤销本轮」与既有「撤销全部」重复（§3.4.3）。** `AgentResponseNode` 已有「撤销全部」按钮（同一个 `undoAllOperations`）。在紧邻处再放一个等价按钮是劣化体验，因此总结卡只承载指标与「让 Agent 修复 / 生成来源清单」，撤销由既有按钮承担；两个动作按钮按既有约定（`sendPrefilledMessage`：建议动作只预填、不直接执行）**预填**固定文案而非直接发送，用户按 Enter 才发出，满足风险 R12。
13. **`HEAD` 上 `AgentChatDock.lifecycle.test.tsx` 已经是红的**（见 §5）。这是需要在后续修的既有问题，不是本轮造成的。

### 评审节点（代码评审与提交）补充修复

1. **输入框被改成 `role="combobox"`。** 多行 textarea 不是合法的 combobox，且既有消费方（`AgentChatDock.lifecycle` 等）按 `textbox` 查找；去掉 `role` 与 `aria-expanded`，保留 `aria-controls` / `aria-activedescendant` / `aria-autocomplete` / `aria-haspopup`（textbox 均支持）。
2. **空闲发送多传了一个 `undefined` 参数**，违反 AC-A1「与改动前逐字节一致」：`useComposer` 现在无附加项时调用 `onSendMessage(text)`（单参数），断言同步更新。
3. **`AgentChatDock.lifecycle.test.tsx` 已转绿**（缺陷 #13 / §5 所述基线红点）：补齐测试对 `VideoChatWindow` 源码编译所需的模块映射（`planScan`、`askScan`、`@/types/agentToolkit`、`@/lib/api/agentToolkit`、`@/lib/agentToolkitStatus`、`AskUserCard`、`ComposerPicker`、`useComposer`，其余子组件用空桩）。全量范围内仅余 `VideoEditorContainer.recoveryBackup` 一项与本轮无关的基线失败。
