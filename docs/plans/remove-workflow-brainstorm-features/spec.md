# 移除「工作流」与「头脑风暴」功能 — 开发方案 (spec)

- **Feature**: `remove-workflow-brainstorm-features`
- **版本**: **v2（评审修复）** ｜ 上一版本：v1（方案设计）
- **作者**: Subtask #0 方案设计 Agent ｜ **评审/修复**: Subtask #1 方案评审 Agent
- **日期**: 2026-06-02
- **状态**: 已评审修复（交付 Subtask #2 代码开发）
- **关联任务板**: `.agentmesh/ta***REMOVED***/task-board.md`

---

## 评审记录（Review Notes — Subtask #1）

> 评审人：Subtask #1 方案评审 Agent ｜ 评审日期：2026-06-02 ｜ 评审维度：可行性 / 完整性 / 一致性 / 规模适配。
> 评审方式：对照**实际代码库**逐节核验（含动态 import、后端 router 挂载、当前分支 `feat/api-authz-rate-limiting` 新增的鉴权/限流代码与测试）。
> 下列 **P0 / P1 已在本 v2 正文就地修复**；P2 给出裁定或留待开发期顺手处理。

| # | 严重度 | 位置 | 问题（核验结论） | 处置 |
|---|--------|------|------------------|------|
| C1 | **P0** | §5.1 / §5.2 / §6.2 | 原文「🗑 `src/app/api/workflow/`（整目录）」会**连带删除** `ai-video-generate/` 与 `video-export/` 两个代理路由。核验：该目录实含 `agent/ ai-video-generate/ tavily-search/ test-node/ video-export/` 五个子目录；其中 `/api/workflow/ai-video-generate` 由 `ai_video_generate_router`、`/api/workflow/video-export` 由 `video_export_router` 提供（`main.py:517,522` **root 挂载**，与待删的 `workflow_router` 无关），且 `video-export` 被视频编辑器组件链路 `VideoPlayerPanel.tsx:580 → useVideoExport.ts` 使用。整目录删除将直接破坏「视频导出 / AI 视频生成」这两个**视频编辑核心能力**。 | 已修：§5.1 改为只删 `src/app/api/workflow/{agent,tavily-search,test-node}/`；§5.1/§5.4/§6.4 显式标注 `ai-video-generate/`、`video-export/` 代理与对应后端 router **保留**。 |
| C2 | **P0** | §2.4 / §5.3 / §8.3 | 删除 `intent_detection_router.py` 会令 `tests/security/test_01_auth.py` 在 **import 阶段**（`:66-74` 硬导入 `intent_detection_router`）即 `ImportError`，导致整个鉴权安全测试模块 collection 失败 —— 与 §8.3「pytest 全绿」**直接矛盾**。该测试由当前分支 `feat/api-authz-rate-limiting` 引入。 | 已修：§5.4 新增「更新 `tests/security/test_01_auth.py`」与「更新 `app/middleware/auth_middleware.py` 的 `HARD_PROTECT_PATHS`」；§8.1 增加该模块回归校验。 |
| C3 | **P1** | §2.4 | 交叉依赖核查不完整：`intent-detection`/`workflow` 还被 `app/middleware/auth_middleware.py`（`HARD_PROTECT_PATHS` 含 `/api/intent-detection`，`:116-120`）、`scripts/smoke-api-auth.sh`、`tests/integration/auth-flow.test.ts`、前端 `src/lib/__tests__/intent-detection-service.test.ts` 引用。原文「intent_detection 仅被 main.py 与自身引用」不成立。 | 已修：§2.4 补全引用点并修正结论；相关清理并入 §5.x。 |
| C4 | **P1** | §5.1 / §5.2 | 删除 `src/lib/intent-detection-service.ts` 与 `Taskbar.tsx` 时未列出其配套测试：`src/lib/__tests__/intent-detection-service.test.ts`（import 已删模块 → 测试失败）、`src/components/__tests__/VerticalTaskbar.a11y.test.ts`（`:16` 以 `fs` 读取 `Taskbar.tsx` 文件 + `:30` 断言其内容 → 读取/断言失败）。 | 已修：§5.1 增删前端 intent 测试；§5.2 增「更新 `VerticalTaskbar.a11y.test.ts` 移除 Taskbar.tsx 断言」。 |
| C5 | **P2** | §3 D3 | D3 标为「评审重点确认项」会阻塞 Subtask #2 落地。 | 评审裁定：依原始需求「**保留视频编辑功能**」，编辑器内 Creative Brainstorming 系视频编辑子工具 → **确认保留**；§3 去掉「待确认」语义。 |
| C6 | **P2** | §5.4 / §8.3 | `scripts/smoke-api-auth.sh`（`:162,169-171,182`）、`tests/integration/auth-flow.test.ts`（`:91-95,:339-340`）仍探测已删端点。因鉴权中间件 deny-by-default，匿名仍 401、不会 break，但属 stale 探测。 | 已修：§5.4 列为「可选清理」、§8.3 备注；非阻塞。 |
| C7 | **P2** | §6.4 | `/api/workflow/ai-video-generate`、`/api/workflow/video-export` 未列入「保持不变」，存在被误删风险。 | 已修：§6.4 显式补入。 |

**核验通过项（无需改动，记录备查）**：
- TaskType / `ChatMessage.workflowExecution` / `Conversation.chatType`(`:134`) / `VideoEditingTaskContent.uiState` 字段位置准确（`types/index.ts` 已核）。
- `Taskbar.tsx` 确为死代码（仅被自身+两处测试引用，`page.tsx` 实际挂载 `VerticalTaskbar`）。
- `tavily_*` 确仅被 workflow 链路引用（`workflow_router.py` / `tavily_models.py` / `tavily_search_service.py`），无其它消费方；`config.py` 无 `TAVILY` 引用。
- Alembic head 确为 `012_seed_rate_limiting_settings`，新增 `013` 的 `down_revision='012'` 正确；`012` 仅 seed 全局限流默认值（不按端点 keyed），删除工作流端点不产生孤儿配置。
- `routers/__init__.py` 仅含 `workflow_router`(`:11,:33`)，**不含** `intent_detection_router`/`workflow_preferences_router`（二者在 `main.py` 直接 `from app.routers import ...`），原文「若有」式核查表述正确；`ai_video_generate_router`(`:17,:39`) 保留。
- `useTasks` 持久键 `ecliptrix-tasks-state-v1`(`:7`)、`allTaskTypes`(`:193`)、`ChatInterface` `useWorkflow`(`:374`) / 执行块(`:389+`) 行号准确。

---

## 1. Overview（概述）

Ecliptrix 当前在左侧垂直功能栏（`VerticalTaskbar`）与着陆页（`LandingPage`）中提供四种任务类型：**AI 对话（chat）**、**视频编辑（video）**、**工作流（workflow）**、**头脑风暴（brainstorm）**。产品决策是下线「工作流」与「头脑风暴」两类功能，仅保留「AI 对话」与「视频编辑」，并要求**连带删除工作流相关的全部代码与逻辑**（前端可视化节点编辑器、客户端执行器、聊天与视频编辑器中对工作流的调用，以及后端工作流的 路由 / 服务 / 模型 / 数据表）。

本方案的核心难点不在于删除「工作流」这棵主功能树（`src/components/workflow/`、`app/routers/workflow_router.py` 等本身是自包含的），而在于**精确地把工作流从两个保留功能里"拆出来"**：① 「AI 对话」支持 `chatType: 'workflow'`，会在浏览器端用 `WorkflowExecutor` 直接跑工作流；② 「视频编辑器」内置 `WorkflowConfigModal`，允许把已保存工作流配置成 Agent 可调用的工具，并通过 `intent-detection`（意图识别）后端服务在对话中决定是否触发工作流。这两处必须做"外科手术式"解耦，保证拆除后 chat 退化为纯对话、视频编辑器对话退化为纯编辑建议，而不破坏其余能力。

此外需要处理三类"隐性逻辑"：**TaskType 联合类型收窄**会级联影响所有 `switch(type)` 穷尽分支（TypeScript 会对失效的 `case` 报 TS2678）；**localStorage 历史状态迁移**（`ecliptrix-tasks-state-v1` 中可能已持久化 workflow/brainstorm 的 tab/task，需在水合时清洗，否则保留功能会尝试渲染已删除的类型）；**数据库 `agent_workflows` 表**需新增 Alembic 迁移删除。一个明确的范围边界是：视频编辑器内的 **Creative Brainstorming（创意头脑风暴）弹窗**（`src/components/video/components/CreativeBrainstormingModal/` + `/api/creative-brainstorming`）是"视频编辑功能"的子工具，**不在删除范围内**——它与功能栏里的 brainstorm「任务占位」是两个东西（详见 §3 范围与决策）。

---

## 2. 现状与关键代码路径

### 2.1 前端任务类型骨架

- `src/types/index.ts:4` — `Task.type: 'workflow' | 'video' | 'brainstorm' | 'chat'`；`:60` 导出 `TaskType`。
- `src/hooks/useTasks.ts` — `buildTaskTypeLabel`(`:70`) 与 `LEGACY_TITLE_TO_TYPE`(`:59`) 含四类型；`createTask`(`:186`) 在"着陆页首个任务"分支会**一次性创建全部四种任务**：`const allTaskTypes: TaskType[] = ['chat','video','workflow','brainstorm']`(`:193`)。
- `src/app/page.tsx` — 顶层装配；仅挂载 `VerticalTaskbar`（**未**挂载 `Taskbar.tsx`）。
- `src/components/VerticalTaskbar.tsx` — `getTaskIcon`(`:30`)/`getTaskLabel`(`:59`) 的 `switch` 含 workflow/brainstorm 分支。
- `src/components/Container.tsx` — 按 `activeTask.type` 路由渲染：video(`:186`)、workflow(`:239` → `WorkflowInterface`)、chat(`:254`)、brainstorm(`:270` → "Coming Soon" 占位)；并含 `handleNavigateToVideoEditing`(`:44`，工作流→视频时间轴跳转) 与欢迎页四宫格卡片(`:142-179`)。
- `src/components/HomePage/LandingPage.tsx` — `features[]`(`:35`) 四张卡片 + "Explore Workflows" CTA(`:109`) + stats 中 `workflowTemplates`(`:180`)。
- `src/components/Taskbar.tsx` — **死代码**（除自身与测试外无引用），含 workflow/brainstorm 分支。

### 2.2 AI 对话 ↔ 工作流耦合

- `src/components/chat/ChatInterface.tsx`：`import { WorkflowExecutor }`(`:8`) 与 `WorkflowExecutionState`(`:4`)；`handleCreateConversation` 接收 `chatType` 与 `workflow*` 参数；`handleSendMessage` 中 `useWorkflow = chatType==='workflow' && !!workflowId`(`:374`)，命中后进入**客户端工作流执行块**(`:388-495`)，否则走 `/api/chat`(`:502`)。
- `src/components/chat/ChatTypeSelectionModal.tsx` — 三个分区 chatbot/workflow/agent；`import { loadAgentWorkflows, WorkflowRecord }`(`:6`)，打开 workflow 分区时拉取工作流列表；`onSelectWorkflow` 回调把 nodes/connections 传回。
- `src/components/chat/WorkflowSelectionModal.tsx`、`WorkflowExecutionMessage.tsx` — 工作流专用；`ChatWindow.tsx` 渲染 `WorkflowExecutionMessage`（消息带 `workflowExecution` 元数据时）。

### 2.3 视频编辑 ↔ 工作流 / 意图识别耦合

- `src/components/video/VideoEditingInterface.tsx`：`import { WorkflowConfigModal }`(`:56`)、`WorkflowExecutor`(`:59`)、`WorkflowNode/WorkflowConnection`(`:58`)；状态 `isWorkflowConfigModalOpen`(`:185`)、`workflowConfigs`(`:190`)；`handleViewWorkflowsClick`(`:2291`)/`handleWorkflowConfig{Close,Save}`；`loadWorkflowPreferences` effect(`:2381`，动态 `import('@/lib/api/workflow')` 与 `workflowPreferences`)；发送消息时构造 `enabledWorkflowConfigs` 并触发**意图识别**(`:2617-2672`)；渲染 `<WorkflowConfigModal/>`(`:3341`)。另有"接收来自工作流的时间轴/素材"导入逻辑(`:1752`,`:1802`)。
- `src/app/api/video-editing-chat/route.ts` — `callIntentDetectionBackend`(`:32`) 调用 `/api/intent-detection/detect`，依据 `enabled_workflows` 判定 `should_call_workflow`。
- `src/components/chat/MessageBubble.tsx:56` — 渲染 `metadata.type==='intent_detection'` 状态气泡（无害）。

### 2.4 后端工作流足迹

- 路由：`app/routers/workflow_router.py`（`/api/workflow/*`：agent save/load/delete、tavily-search、test-node）、`app/routers/workflow_preferences_router.py`（`/api/workflow-preferences/*`）、`app/routers/intent_detection_router.py`（`/api/intent-detection/detect`，root 挂载）。
- `app/main.py` 注册：workflow_router(`:485-487`)、intent_detection_router(`:545-547`)、workflow_preferences_router(`:550-552`)。
- 服务：`agent_workflow_service.py`、`workflow_preferences_service.py`、`tavily_search_service.py`（**仅** workflow_router 使用）、`intent_detection_service.py`。
- 模型：`models/workflow_models.py`、`workflow_preferences_models.py`、`tavily_models.py`、`intent_detection_models.py`；DB 模型 `db_models.py` `AgentWorkflow`(`:44-54`，表 `agent_workflows`)。
- 迁移：`alembic/versions/001_initial_schema.py` 创建 `agent_workflows`；当前 head = `012_seed_rate_limiting_settings`。
- 测试：`tests/test_agent_workflow_service.py`。
- 交叉依赖核查（v2 修正）：
  - `tavily_*` 仅被 workflow 链路引用（`workflow_router.py` / `tavily_models.py` / `tavily_search_service.py`），无其它消费方，可随工作流删除。
  - `intent_detection` 的**运行时**调用方确实只有 `video-editing-chat` 的工作流意图识别，删除后**不影响 chat / video 主运行链路**；但其**符号/路径**还被当前分支 `feat/api-authz-rate-limiting` 的鉴权代码与测试引用，必须一并处理（否则破坏测试 / 残留死配置）：
    - `app/middleware/auth_middleware.py` — `HARD_PROTECT_PATHS`(`:116-120`) 含 `"/api/intent-detection"`（与保留的 `/api/workflow/ai-video-generate`、`/api/workflow/video-export` 并列）。
    - `tests/security/test_01_auth.py` — `:66-74` **硬 import** `intent_detection_router` 并挂载；`:112-118` 断言 `HARD_PROTECT_PATHS` 常量；`:156-191` 两条 intent-detection 用例。删除 router 会令该模块 import 失败。
    - `scripts/smoke-api-auth.sh`(`:162,169-171,182`)、`tests/integration/auth-flow.test.ts`(`:91-95,:339-340`)、前端 `src/lib/__tests__/intent-detection-service.test.ts` —— 探测/单测已删端点或已删模块。
  - 结论：`intent-detection`/`tavily` 可随工作流删除，但**必须连带更新 §5.4 列出的鉴权中间件与测试**，否则 §8 的「pytest 全绿」不成立。

---

## 3. 范围与决策（Scope & Decisions）

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| D1 | 删除「工作流」任务类型及其全部 UI/执行器/后端 | **删除** | 需求明确。 |
| D2 | 删除「头脑风暴」任务类型（功能栏占位 tab，当前为 Coming Soon） | **删除** | 需求明确；当前仅为占位卡片。 |
| D3 | 视频编辑器内 **Creative Brainstorming 弹窗**（`CreativeBrainstormingModal` + `/api/creative-brainstorming`） | **保留**（v2 评审已裁定） | 它是"视频编辑功能"的子工具，挂在编辑器内部，非功能栏 brainstorm 任务；原始需求明确"保留视频编辑功能"。✅ **评审已确认保留**，不再作为待确认项；§9.1 的删除备选仅作历史记录，本次不执行。 |
| D4 | AI 对话的 `chatType: 'agent'` 分支 | **保留** | 与工作流无关，属于对话能力；仅删除 `'workflow'` 分支。 |
| D5 | 后端 `intent-detection` 与 `tavily` 服务 | **删除** | 经 grep 确认仅服务于工作流意图识别/节点；删除后无其它调用方。 |
| D6 | `agent_workflows` 数据表 | **新增迁移删除** | 彻底清理；新增 `013` 迁移 drop 表，保留 001 历史不改写。 |
| D7 | `Taskbar.tsx`（未挂载的旧组件） | **整文件删除** | 死代码且含 TaskType 穷尽 switch，删除最省事。 |

> **D3 评审裁定（v2）**：依原始需求"仅保留 AI 对话与视频编辑功能"，视频编辑器内的 Creative Brainstorming 属视频编辑子工具 → **确认保留**。§9.1 的"一并删除"备选**不执行**，仅留作历史参考。Subtask #2 无需就 D3 再行确认。

---

## 4. 技术设计（Technical Design）

### 4.1 总体策略：自顶向下三层拆除

1. **类型层（先改）**：收窄 `TaskType` 为 `'video' | 'chat'`，删除全部 `Workflow*` 类型与 chat/video content 中的 workflow 字段。这一步会让 `tsc --noEmit` 在所有失效分支处报错，从而成为后续"按编译错误清单逐个修复"的**驱动器**。
2. **功能栏与路由层**：清理 `VerticalTaskbar` / `Container` / `LandingPage` / `useTasks`，使功能栏仅余 chat、video；`createTask` 着陆页分支改为 `['chat','video']`；新增 localStorage 水合清洗。
3. **解耦层（最关键）**：从 `ChatInterface` 删除工作流执行块、从 `VideoEditingInterface` 删除 `WorkflowConfigModal` 与意图识别块、从 `video-editing-chat` route 删除意图识别调用；随后删除两个保留功能不再引用的工作流文件/目录。
4. **后端层**：删路由注册→删路由文件→删服务→删模型→删 DB 模型→加迁移 `013` drop 表。
5. **收尾**：删除/更新测试，清理 i18n 键、`index.ts` 再导出、（可选）env 模板里失效的 `TAVILY_API_KEYS`。

### 4.2 关键操作时序

- **AI 对话发送消息**（改后）：`handleSendMessage` 不再判定 `useWorkflow`，去掉 `:388-495` 整块，直接走 `/api/chat` 流式返回。新建会话弹窗仅提供 chatbot/agent 两个入口。
- **视频编辑器对话**（改后）：发送消息不再构造 `enabledWorkflowConfigs`、不再插入 `intent_detection` 状态消息；前端 `video-editing-chat` route 去掉 `callIntentDetectionBackend`，`formatMessages` 流程不变，退化为"纯编辑建议聊天"。视频编辑器顶栏移除"查看/配置工作流"入口。
- **着陆页 → 创建任务**：点击 video 或 chat 卡片 → `createTask` 仅创建这两类 tab，默认激活被点击者。
- **后端启动**：`main.py` 不再 `include_router` 三个路由；`Base.metadata.create_all`（`database.py` 混合建表）因 `AgentWorkflow` 模型移除而不再创建该表；Alembic `upgrade head` 执行到 `013` 时 drop 历史遗留表。

### 4.3 编译/类型驱动的安全网

由于 ESLint 在生产构建被忽略（`next.config.js`），**类型检查 `npm run type-check` 是主防线**。实施顺序必须"先收窄类型、再清引用"，并以 `tsc --noEmit` 零报错作为前端完成判据；后端以 `uvicorn app.main:app` 能正常 import 启动 + `pytest` 通过作为判据。

---

## 5. 文件 / 模块变更计划（File / Module Change Plan）

> 图例：🗑 删除整文件/目录 · ✏️ 修改 · ➕ 新增

### 5.1 前端 — 删除

| 操作 | 路径 | 意图（一句话） |
|---|---|---|
| 🗑 | `src/components/workflow/`（整目录，含 `nodes/`、`__tests__/`、`WorkflowExecutor.ts` 等） | 工作流可视化编辑器、节点、客户端执行器全部删除 |
| 🗑 | `src/components/chat/WorkflowSelectionModal.tsx` | 对话中选择工作流的弹窗 |
| 🗑 | `src/components/chat/WorkflowExecutionMessage.tsx` | 对话中工作流执行过程展示 |
| 🗑 | `src/components/video/components/WorkflowConfigModal/`（整目录） | 视频编辑器内工作流工具配置弹窗 |
| 🗑 | `src/lib/api/workflow.ts` | 工作流增删改查 API 客户端 |
| 🗑 | `src/lib/api/workflowPreferences.ts` | 工作流偏好（展开态）API 客户端 |
| 🗑 | `src/lib/intent-detection-service.ts` | 浏览器端工作流意图识别客户端 |
| 🗑 | `src/lib/__tests__/intent-detection-service.test.ts` | 上述客户端的单测（随源文件删除，否则 import 已删模块导致测试失败）【v2 补】 |
| 🗑 | `src/app/api/workflow/agent/`（proxy 子目录） | 转发 `/api/workflow/agent/*`（workflow_router）的 Next 路由【v2 收窄：仅删此子目录】 |
| 🗑 | `src/app/api/workflow/tavily-search/`（proxy 子目录） | 转发 `/api/workflow/tavily-search`（workflow_router）的 Next 路由【v2 收窄】 |
| 🗑 | `src/app/api/workflow/test-node/`（proxy 子目录） | 转发 `/api/workflow/test-node`（workflow_router）的 Next 路由【v2 收窄】 |
| ⚠️ **保留** | `src/app/api/workflow/ai-video-generate/`、`src/app/api/workflow/video-export/` | **不可删**：分别转发 `ai_video_generate_router`/`video_export_router`（视频编辑：AI 视频生成、时间轴/视频导出，`VideoPlayerPanel→useVideoExport` 依赖）【v2 C1 修复】 |
| 🗑 | `src/app/api/workflow-preferences/`（proxy 路由目录） | 转发工作流偏好的 Next 路由 |
| 🗑 | `src/app/api/intent-detection/`（proxy 路由目录） | 转发意图识别的 Next 路由 |
| 🗑 | `src/components/Taskbar.tsx` | 未挂载的旧任务栏（死代码，含 TaskType switch） |
| 🗑 | `src/components/__tests__/Taskbar.brainstorm.test.ts` | 旧任务栏 brainstorm 测试 |
| 🗑 | `src/components/HomePage/__tests__/LandingPage.brainstorm.test.tsx` | 着陆页 brainstorm "Coming Soon" 测试 |

### 5.2 前端 — 修改

| 操作 | 路径 | 意图 |
|---|---|---|
| ✏️ | `src/types/index.ts` | `TaskType` 收窄为 `'video' \| 'chat'`；删除 `WorkflowNode/Connection/Data/ExecutionState/TaskContent` 等全部 `Workflow*` 类型；`ChatMessage` 删 `workflowExecution`；`Conversation` 删 `chatType` 的 `'workflow'` 取值与 `workflowId/Name/Nodes/Connections`；`VideoEditingTaskContent.uiState` 删 `isWorkflowConfigModalOpen`、`workflowConfigs`（**保留** `isCreativeBrainstormingModalOpen`）；保留 `pendingTimelineData/pendingMaterials` 字段定义但注释去掉"来自 Workflow"语义 |
| ✏️ | `src/components/VerticalTaskbar.tsx` | `getTaskIcon`/`getTaskLabel` 删除 `case 'workflow'`、`case 'brainstorm'` |
| ✏️ | `src/components/Container.tsx` | 删 `WorkflowInterface`、`WorkflowTaskContent` import；删 `handleUpdateWorkflowContent`、`handleNavigateToVideoEditing`；删 `type==='workflow'`、`type==='brainstorm'` 渲染分支；欢迎四宫格删 workflow/brainstorm 两张卡片（保留 chat/video） |
| ✏️ | `src/components/HomePage/LandingPage.tsx` | `features[]` 删 workflow/brainstorm 两项；删 "Explore Workflows" CTA 按钮；stats 去掉/替换 `workflowTemplates` 项 |
| ✏️ | `src/hooks/useTasks.ts` | `createTask` 着陆页分支 `allTaskTypes = ['chat','video']`；`buildTaskTypeLabel`、`LEGACY_TITLE_TO_TYPE` 删 workflow/brainstorm；**新增水合清洗**：`reviveState` 后过滤 `type ∉ {'chat','video'}` 的 task 与对应 tab，并修正 `activeTabId` |
| ✏️ | `src/components/chat/ChatInterface.tsx` | 删 `WorkflowExecutor`、`WorkflowExecutionState` import；`handleCreateConversation` 删 workflow 参数与标题分支；删 `handleWorkflowSelect`；删工作流执行块（`:388-495`），`handleSendMessage` 统一走 `/api/chat`；删会话对象上的 workflow 字段写入 |
| ✏️ | `src/components/chat/ChatTypeSelectionModal.tsx` | 删 `loadAgentWorkflows/WorkflowRecord` import 与拉取逻辑；删 `selectedSection` 的 `'workflow'`、workflow 分区 UI 与 `onSelectWorkflow` prop；仅保留 chatbot/agent |
| ✏️ | `src/components/chat/ChatWindow.tsx` | 删 `WorkflowExecutionMessage` 渲染分支与 import |
| ✏️ | `src/components/chat/MessageBubble.tsx` | （可选）删除 `metadata.type==='intent_detection'` 渲染分支 |
| ✏️ | `src/components/chat/index.ts` | 删除已删组件的再导出 |
| ✏️ | `src/components/video/VideoEditingInterface.tsx` | 删 `WorkflowConfigModal`、`WorkflowExecutor`、`WorkflowNode/Connection` import；删 `isWorkflowConfigModalOpen`、`workflowConfigs` 状态及其 uiState 持久化读写；删 `handleViewWorkflowsClick`、`handleWorkflowConfig{Open,Close,Save}`；删 `loadWorkflowPreferences` effect；删发送消息中的 `enabledWorkflowConfigs`/意图识别消息块（`:2617-2672`）与 http body 里的 `workflowConfigs`；删 `<WorkflowConfigModal/>`(`:3341`) 与顶栏入口；删/简化"接收来自工作流的时间轴/素材"导入（`:1752`,`:1802`）。**保留** `CreativeBrainstormingModal`、`video-editing-agent`、`video-editing-chat` 链路 |
| ✏️ | `src/components/video/components/index.ts` | 删 `export { WorkflowConfigModal }` |
| ✏️ | `src/app/api/video-editing-chat/route.ts` | 删 `callIntentDetectionBackend`、`WorkflowConfig` 接口、`workflowConfigs` 入参与意图识别分支；route 退化为纯编辑聊天转发 |
| ✏️ | `src/lib/i18n.ts` | 删 `tasks.workflow`、`tasks.brainstorming`、`tasks.types.workflow`、`tasks.types.brainstorm`、`landing.{workflowDesc,exploreWorkflows,workflowTemplates,brainstormingDesc,brainstormingDescPreview}`、`welcome.{workflowDesc,brainstormingDesc}`，及 `workflowInterface/workflowChat/workflowConfigModal/workflowEditModal/workflowConfig/workflowNodes/chatWorkflowSelection/chatWorkflowExecution`、`detectingWorkflow/willCallWorkflow` 等区块；**en 与 zh 两套 locale 必须同步删除**（保留 `creativeBrainstorming*` 键） |
| ✏️ | `src/lib/api/index.ts`（若存在 workflow 再导出） | 删除 workflow 客户端再导出 |
| ✏️ | `src/components/__tests__/VerticalTaskbar.a11y.test.ts` | **【v2 C4 必改】** 该测试 `:16` 用 `fs.readFileSync` 读取 `Taskbar.tsx`、`:30` 断言其 i18n 内容；删 `Taskbar.tsx` 后须移除对 `Taskbar.tsx` 的读取与断言（仅保留对 `VerticalTaskbar.tsx` 的 Bug #4/#6/#7 断言） |
| ✏️ | `src/components/chat/__tests__/` 等 | 删除/更新引用工作流的测试 |

### 5.3 后端 — 删除

| 操作 | 路径 | 意图 |
|---|---|---|
| 🗑 | `app/routers/workflow_router.py` | 工作流 CRUD / tavily / test-node 路由 |
| 🗑 | `app/routers/workflow_preferences_router.py` | 工作流偏好路由 |
| 🗑 | `app/routers/intent_detection_router.py` | 工作流意图识别路由 |
| 🗑 | `app/services/agent_workflow_service.py` | 工作流持久化服务 |
| 🗑 | `app/services/workflow_preferences_service.py` | 工作流偏好服务 |
| 🗑 | `app/services/tavily_search_service.py` | 仅工作流使用的 Tavily 搜索服务 |
| 🗑 | `app/services/intent_detection_service.py` | 工作流意图识别服务 |
| 🗑 | `app/models/workflow_models.py` | 工作流请求/响应 schema |
| 🗑 | `app/models/workflow_preferences_models.py` | 工作流偏好 schema |
| 🗑 | `app/models/tavily_models.py` | Tavily 与节点测试 schema |
| 🗑 | `app/models/intent_detection_models.py` | 意图识别 schema |
| 🗑 | `tests/test_agent_workflow_service.py` | 工作流服务单测 |

### 5.4 后端 — 修改 / 新增

| 操作 | 路径 | 意图 |
|---|---|---|
| ✏️ | `app/main.py` | 删 `workflow_router`(`:485-487`)、`intent_detection_router`(`:545-547`)、`workflow_preferences_router`(`:550-552`) 的 import 与 `include_router` |
| ✏️ | `app/routers/__init__.py` | 删 `from . import workflow_router`(`:11`) 与 `__all__` 中 `"workflow_router"`(`:33`)（核查并清理 intent/preferences 若有） |
| ✏️ | `app/models/db_models.py` | 删 `AgentWorkflow` 类(`:44-54`) 及其 import 依赖 |
| ➕ | `alembic/versions/013_drop_agent_workflows.py` | `down_revision='012'`；`upgrade()` `op.drop_table('agent_workflows')`；`downgrade()` 重建该表（与 001 同构） |
| ✏️ | `app/database.py` | 核查启动 seeding/建表无 `AgentWorkflow` 残留引用（预期无需改动） |
| ✏️ | `app/middleware/auth_middleware.py` | **【v2 C2/C3 必改】** `HARD_PROTECT_PATHS`(`:116-120`) 删除 `"/api/intent-detection"` 一项；**保留** `"/api/workflow/ai-video-generate"`、`"/api/workflow/video-export"`（对应 router 保留）。删除后该常量应为二元组 |
| ✏️ | `backend-services/basic-service/tests/security/test_01_auth.py` | **【v2 C2 必改，否则鉴权测试模块 import 失败 → pytest 红】** ① `_build_root_router_app`(`:66-74`) 移除 `intent_detection_router` 的 import 与 `include_router`；② `test_V01A_hard_protect_paths_constant_matches_spec`(`:112-118`) 期望元组同步去掉 intent-detection；③ 删除 `test_V01A_intent_detection_anonymous_returns_401`(`:155-168`) 与 `test_V01A_authenticated_request_reaches_router`(`:171-191`)，或将后者改打 `/api/workflow/ai-video-generate`（仍保留的受保护端点）以维持「authed 请求穿过鉴权闸门」语义 |
| ✏️（可选，非阻塞） | `scripts/smoke-api-auth.sh`、`tests/integration/auth-flow.test.ts` | **【v2 C6】** 移除对 `/api/intent-detection/detect`、`/api/workflow-preferences/*`、`/api/workflow/agent/*` 的 stale 探测（中间件 deny-by-default 使匿名仍返回 401，不会 break，故为可选清理） |
| ✏️（可选） | `backend-services/basic-service/env.template`、根 `env.template` | 注释/移除失效的 `TAVILY_API_KEYS`、工作流相关说明 |

---

## 6. 接口设计（Interface Design）

### 6.1 被删除的后端 REST 端点

| Method | Path | 去向 |
|---|---|---|
| POST | `/api/workflow/agent/save` | 删除 |
| GET | `/api/workflow/agent/load/{user_id}` | 删除 |
| DELETE | `/api/workflow/agent/delete/{user_id}/{workflow_id}` | 删除 |
| POST | `/api/workflow/tavily-search` | 删除 |
| POST | `/api/workflow/test-node` | 删除 |
| POST/POST/DELETE | `/api/workflow-preferences/{save,load,clear}` | 删除 |
| POST | `/api/intent-detection/detect` | 删除 |

### 6.2 被删除/简化的前端 Next 代理路由

**【v2 C1 修正】** 仅删除 **workflow_router 对应的代理子路由**：`/api/workflow/agent/*`、`/api/workflow/tavily-search`、`/api/workflow/test-node`，以及 `/api/workflow-preferences/*`、`/api/intent-detection/*`。
**保留**：`/api/workflow/ai-video-generate`、`/api/workflow/video-export`（由 `ai_video_generate_router`/`video_export_router` 提供，属视频编辑能力，**不在删除范围**）。
`/api/video-editing-chat`（POST）保留但**请求体移除 `workflowConfigs` 字段**，响应不再产出 `intent_detection` 流式状态。

### 6.3 前端组件接口变化

- `ChatTypeSelectionModalProps`：移除 `onSelectWorkflow`，保留 `onSelectChatbot`、`onSelectAgent`。
- `ChatInterface.handleCreateConversation`：签名移除 `chatType==='workflow'` 相关重载参数（`workflowId/Name/Nodes/Connections`）。
- `Container` 不再向下传 `handleNavigateToVideoEditing`（工作流→视频）；保留 chat→视频的素材跳转 `handleNavigateToVideoEditingWithMaterials`。

### 6.4 保持不变

`/api/chat`、`/api/video-editing-agent/chat`、`/api/creative-brainstorming`、**`/api/workflow/ai-video-generate`、`/api/workflow/video-export`（v2 C7 显式补入——属视频编辑，保留）**、视频合成/TTS 等所有非「工作流节点编辑器」端点签名不变。

---

## 7. 数据模型（Data Model）

### 7.1 TypeScript 类型

- `TaskType = 'video' | 'chat'`（由 `Task.type` 推导）。
- 删除：`WorkflowNodePosition/Data/Node/Connection/Data/ExecutionLog/NodeExecutionState/ExecutionState/TaskContent` 等全部 `Workflow*` 接口。
- `ChatMessage`：删 `workflowExecution?`。
- `Conversation`：`chatType?: 'chatbot' | 'agent'`（删 `'workflow'`）；删 `workflowId/workflowName/workflowNodes/workflowConnections`。
- `VideoEditingTaskContent.uiState`：删 `isWorkflowConfigModalOpen`、`workflowConfigs`；**保留** `isCreativeBrainstormingModalOpen`。

### 7.2 数据库

- 删除 ORM 模型 `AgentWorkflow`（表 `agent_workflows`，列：`id` UUID PK、`user_id`、`workflow_name`、`workflow_data` JSON、`description`、`is_template`、`created_at`、`updated_at`）。
- 新增迁移 `013_drop_agent_workflows`：`upgrade` drop 表，`downgrade` 重建。**不改写** `001_initial_schema`（遵循 Alembic 不可变历史原则）。
- 影响评估：该表无外键被其它表引用，drop 安全；表内数据为工作流定义，本就随功能下线作废。

### 7.3 localStorage 迁移（关键）

`useTasks` 的持久键 `ecliptrix-tasks-state-v1` 可能含 workflow/brainstorm 的 task/tab。水合（`reviveState` 之后）须执行清洗：

```text
allowed = {'chat','video'}
tasks  = tasks.filter(t => allowed.has(t.type))
tabs   = tabs.filter(tab => allowed.has(tab.type) && tasks.some(t=>t.id===tab.taskId))
若 activeTabId 指向被删 tab → 重选剩余首个 tab 或置 null
```

否则 `VerticalTaskbar.getTaskLabel`/`Container` 对未知类型返回 `undefined`，导致渲染异常。视频编辑器 content 中的 `workflowConfigs`/`isWorkflowConfigModalOpen` 在反序列化后被忽略即可（类型已删，读取处一并移除）。

---

## 8. 测试与验收标准（Testing & Acceptance）

### 8.1 静态验证

- 前端：`npm run type-check`（`tsc --noEmit`）**零错误**——这是工作流引用被彻底清除的硬性判据；`npm run build` 成功。
- 后端：`python -c "import app.main"` / `uvicorn app.main:app` 正常导入启动，无 `ModuleNotFoundError`；`alembic upgrade head` 成功到 `013` 且 `agent_workflows` 表被删除（`alembic downgrade -1` 可回滚）。
- **【v2 C2 新增】** `pytest tests/security/test_01_auth.py -v` 必须可被正常 collection 且全绿——这是验证「删除 intent-detection 后未破坏当前分支鉴权测试」的硬性判据（须先按 §5.4 更新该测试与 `HARD_PROTECT_PATHS`，否则会因 import `intent_detection_router` 失败而整模块报错）。

### 8.2 功能验收

1. 功能栏（`VerticalTaskbar`）与着陆页仅显示 **AI 对话** 与 **视频编辑** 两项；无 workflow/brainstorm 卡片、无 "Explore Workflows" CTA。
2. 着陆页点击任一卡片后，仅创建 chat、video 两个 tab。
3. AI 对话：新建会话弹窗仅含 chatbot/agent；发送消息走 `/api/chat`，流式正常；无任何工作流执行入口。
4. 视频编辑：编辑器加载正常；无"工作流配置"入口；对话框正常给出编辑建议（无 intent_detection 气泡）；**Creative Brainstorming 弹窗仍可用**（D3）；时间轴/合成/TTS 功能不受影响。
5. 携带旧 localStorage（含 workflow/brainstorm tab）的浏览器刷新后，自动清洗为 chat/video，无白屏/控制台报错。
6. 后端 `/api/workflow/*`、`/api/intent-detection/detect`、`/api/workflow-preferences/*` 返回 404。

### 8.3 回归

- `pytest tests/ -v`（删除 workflow 单测后）全绿。
- 前端保留测试（chat/video 相关）全绿；brainstorm/workflow 测试随源文件删除。
- 冒烟：登录 → 视频编辑器打开项目 → AI 对话发送一条消息 → 创意头脑风暴弹窗打开。

---

## 9. 风险与缓解（Risks & Mitigations）

| 风险 | 等级 | 缓解 |
|---|---|---|
| **R1 类型收窄级联**：`TaskType` 改后多处穷尽 `switch` 报 TS2678 | 中 | 先改类型，再用 `tsc` 报错清单逐项修；`Taskbar.tsx` 直接删除以免遗漏。 |
| **R2 chat/video 误伤**：工作流执行块/意图识别块删除不净导致对话崩溃 | 高 | 严格按 §5.2 行号定位；以 §8 冒烟逐条验证 chatbot 与编辑器对话；保留 `/api/chat`、`/api/video-editing-chat` 主流程。 |
| **R3 localStorage 旧态**：历史 tab 渲染未知类型白屏 | 中 | 实现 §7.3 水合清洗；新增对应单测。 |
| **R4 i18n 双语不同步**：只删 en 未删 zh（或反之）导致类型不匹配/构建失败 | 中 | en/zh 同步删除；删除 t.* 引用先于删除键，`tsc` 兜底。 |
| **R5 DB 迁移破坏性**：drop 表在生产丢数据 | 低 | 数据为待下线工作流定义；`013` 提供 downgrade 重建；遵循部署 checklist（见项目记忆 deploy-pitfalls，确认 alembic head 推进到 013）。 |
| **R6 D3 范围误判**：产品其实想连视频内创意头脑风暴一起删 | 中 | 在 §3 显式标注为评审确认项；§9 备选给出删除清单。 |
| **R7 死代码/动态 import 漏网**：`VideoEditingInterface` 内 `await import('@/lib/api/workflow')` 动态引用，grep 易漏 | 中 | 全量 grep（含 `import(` 动态导入字符串）`workflow`/`intent`/`tavily`；以 `tsc` + 运行时启动双重验证。 |
| **R8 Tavily 复用诉求**：未来若需通用网络搜索 | 低 | Tavily 服务自包含，必要时可从 git 历史恢复；本次按需求删除。 |

### 9.1 D3 备选（若评审决定一并删除视频内创意头脑风暴）

追加删除：`src/components/video/components/CreativeBrainstormingModal/`、`src/components/video/components/CreativeBrainstormingModal/hooks/useBrainstormingChat.ts`、`src/app/api/creative-brainstorming/`，并在 `VideoEditingInterface` 移除其状态/按钮/渲染、`types` 移除 `isCreativeBrainstormingModalOpen`、`i18n` 移除 `creativeBrainstorming*` 键。

---

## 10. 实施顺序建议（供 Subtask #2 参考）

1. 改 `src/types/index.ts`（收窄 TaskType + 删 Workflow 类型/字段）。
2. 跑 `tsc --noEmit` 得到报错清单，按清单修：`useTasks` → `VerticalTaskbar` → `Container` → `LandingPage` → `ChatInterface`/`ChatTypeSelectionModal`/`ChatWindow` → `VideoEditingInterface`/`video-editing-chat route`。
3. 删除前端工作流文件/目录与代理路由（**仅** `src/app/api/workflow/{agent,tavily-search,test-node}/`，**勿删** `ai-video-generate`/`video-export`，C1）、`Taskbar.tsx`、相关测试（含 `intent-detection-service.test.ts`，并更新 `VerticalTaskbar.a11y.test.ts`，C4）。
4. 清理 i18n（en/zh）。
5. 后端：改 `main.py`/`__init__.py`/`db_models.py` → 删路由/服务/模型 → **同步更新 `auth_middleware.py` 的 `HARD_PROTECT_PATHS` 与 `tests/security/test_01_auth.py`（C2/C3，与删 intent-detection 同一提交）** → 加迁移 `013`。
6. 验证：`tsc`、`npm run build`、后端启动、`alembic upgrade head`、`pytest`（**务必含 `tests/security/test_01_auth.py`**）、§8 冒烟。

---

## 11. 实施过程发现的方案缺陷（Subtask #2 回填）

> 以下为代码开发阶段发现的、方案（v2）未覆盖或需就地修正之处。均已按"最小且与需求一致"的方式处理，`npm run type-check` 零错误，后端模块可正常导入，安全测试通过（除一项预存在失败，见 ④）。

1. **【方案漏列文件】`src/components/chat/ConversationList.tsx`** — 该文件渲染 `conversation.chatType === 'workflow'` 与 `conversation.workflowName` 徽章。`TaskType`/`Conversation` 收窄后 `tsc` 报 TS2367/TS2339（这是 type-check 报出的唯一一批方案外错误）。§5.2 未列此文件。**处置**：删除 workflow 徽章分支与"无 chatType 回退徽章"分支，保留 chatbot/agent 徽章。

2. **【方案漏列测试】两处测试随功能移除而失效，已更新（非删除）以保留其原校验意图**：
   - `src/components/HomePage/__tests__/LandingPage.a11y.test.ts`：断言 `tabIndex={isComingSoon ? -1 : 0}`、`aria-disabled={isComingSoon || isLoadingDisabled || undefined}`。移除头脑风暴"Coming Soon"卡片后 `comingSoon` 逻辑不复存在 → 改为断言 `tabIndex={0}`、`aria-disabled={isLoadingDisabled || undefined}`，键盘可达性校验意图不变。
   - `src/hooks/__tests__/useTasks.persistence.test.ts`：`createTask('workflow')` 在收窄后属非法 `TaskType`（tsc 报错），且 mock 的 `t.tasks.types` 含 workflow/brainstorm → 改 `createTask('video')`、mock `types` 收窄为 `{ video, chat }`。

3. **【i18n 取舍】`aiChat.chatTypeModal` 内的工作流子键予以保留** — §5.2 要求删 `chatWorkflowSelection/chatWorkflowExecution/workflowInterface/workflowChat/workflowConfigModal/workflowEditModal/workflowConfig/workflowNodes` 等**整块**（已全部删除：interface+en+zh 三处同步，共 8 块×3）。但 `aiChat.chatTypeModal.{workflowTab,loadingWorkflows,failedToLoadWorkflows,noWorkflows,createWorkflowFirst,workflowsAvailable,workflowsAvailableWithEmpty,emptyWorkflowHint}` 这些**子键**嵌于仍在使用的 `chatTypeModal` 对象中，逐键删除需精确改三处且风险高（R4 双语不同步）、收益低——它们已无任何代码引用（ChatTypeSelectionModal 工作流分区已删），属惰性死键，对编译/运行无影响。**本次保留这些死键**，仅移除全部引用；其余方案明列的 leaf 键（tasks.workflow/brainstorming、tasks.types.workflow/brainstorm、landing.exploreWorkflows/workflowDesc/workflowTemplates/brainstormingDesc/brainstormingDescPreview、welcome.workflowDesc/brainstormingDesc、chatMessageBubble.detectingWorkflow/willCallWorkflow、videoChatWindow.viewWorkflowsTooltip）已删。`creativeBrainstorming*` 按 D3 保留。

4. **【预存在失败，非本次引入】`tests/security/test_01_auth.py::test_V01D_admin_endpoint_blocks_anonymous`** — 用 `git stash` 在改动前的 HEAD 代码上复现，**同样失败**：根因是 `auth_enforce_default_deny` 默认 False 时匿名请求穿过中间件、由 `require_admin` 慢路径返回 `detail` 包裹的 401（测试断言顶层 `error_code`），与本次工作流/意图识别移除无关。本次按 §5.4/C2 改动的 4 个 intent/hard-protect 相关用例（hard_protect 常量、authed 穿闸改打 ai-video-generate、ai-video-generate/video-export 匿名 401）均通过；整模块 16 passed / 1 pre-existing failed，collection 正常。

5. **【保留 prop，无害死参】`MessageBubble` 的 `onNavigateToVideoEditing`** — 删除 `WorkflowExecutionMessage` 分支后该 prop 在 `MessageBubble` 内不再被消费（仍由 `ChatWindow` 透传）。保留其 props 定义以最小化对 `ChatWindow` 的改动；tsc 不报错（项目未开启 noUnusedLocals/Parameters）。

6. **【保留并中性化】`VideoEditingInterface` 的 `pendingTimelineData`/`pendingMaterials` 导入 effect** — 两个 effect 未删除，仅去掉注释/日志里的"来自 Workflow / from Workflow Video Export"措辞。原因：`pendingMaterials` 仍服务于"AI 对话 → 视频编辑"素材跳转（§6.3 保留链路），`pendingTimelineData` 字段仍经 `Container → VideoProjectListView` 的 incoming 流水线消费；删 effect 会破坏保留功能。`types/index.ts` 中两字段定义按 §5.2 保留、注释去 Workflow 语义。

> 结论：方案 v2 主体准确、可落地；上述 6 点为补充修正与取舍说明，均不偏离原始需求（仅保留 AI 对话与视频编辑、删除工作流与头脑风暴）。

---

## 评审结论（Review Verdict — Subtask #1）

**结论：有条件通过（Approved with Conditions）。**

方案整体方向正确、范围划定合理、"先收窄类型 → 以 tsc 报错为驱动器逐项清引用"的拆除策略可行，与项目既有约定（ESLint 在构建期被忽略故以 type-check 为主防线、Alembic 不可变历史、单设备会话鉴权）一致。本次评审在 v2 已就地修复全部 **P0×2 / P1×2**，P2 已给出裁定或非阻塞备注。

**放行条件（Subtask #2 必须严格遵守，对应 v2 修复点）**：

1. **(C1, P0)** 删除前端工作流代理路由时**只删** `src/app/api/workflow/{agent,tavily-search,test-node}/`；**保留** `src/app/api/workflow/{ai-video-generate,video-export}/` 及后端 `ai_video_generate_router`/`video_export_router`。误删将直接破坏视频导出 / AI 视频生成。
2. **(C2, P0)** 删除 `intent_detection_router` 的**同一提交**内，必须更新 `app/middleware/auth_middleware.py` 的 `HARD_PROTECT_PATHS`（去掉 `/api/intent-detection`、保留两个 workflow 生成/导出路径）与 `tests/security/test_01_auth.py`（去 import、改常量断言、删/改两条 intent 用例）。完成判据：`pytest tests/security/test_01_auth.py` 可 collection 且全绿。
3. **(C3/C4, P1)** 一并删除/更新 `src/lib/__tests__/intent-detection-service.test.ts` 与 `src/components/__tests__/VerticalTaskbar.a11y.test.ts`（移除其对 `Taskbar.tsx` 的读取/断言）。
4. **(C5)** Creative Brainstorming **保留**，不执行 §9.1 删除备选。
5. **(C6, 建议)** 顺手清理 `scripts/smoke-api-auth.sh` 与 `tests/integration/auth-flow.test.ts` 的 stale 端点探测（非阻塞，可留待开发期）。

满足上述条件即视为方案落地无阻。验收以 §8 的 `npm run type-check` 零错误、后端正常导入启动、`alembic upgrade head` 到 `013`、`pytest`（含 `tests/security/test_01_auth.py`）全绿为准。

---

*文档结束 — **v2**（评审修复完成）。交付 Subtask #2（代码开发）。所有 P0/P1 已在正文就地修复，无遗留阻塞项。*
