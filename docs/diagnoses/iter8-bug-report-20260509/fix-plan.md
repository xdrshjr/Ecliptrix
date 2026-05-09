# Iter8 Fix Plan — 2026-05-09

> 来源 Bug 报告：`docs/diagnoses/iter8-bug-report-20260509/bug-report.md`
> 步骤 2 输出：代码定位 + 根因分析 + 修复方案。
> 后续步骤 3 将基于本文件实施代码修改。

## 总览

| Bug | 标题 | 主要文件 | 关键位置 | 类别 | 优先级 |
|---|---|---|---|---|---|
| #1 | 高级设置缺失 Next.js 代理路由 → 5×404 + 误导"未配置" | `src/app/api/model-settings/`<br>`src/components/AdminSettings/ModelSettingsPanel.tsx` | 缺 `resolve/[functionType]/route.ts`<br>L658–695 fetchEffectiveConfigs | 后端集成断裂 | P1 |
| #2 | Workflow Chat LLM 节点默认 model `'gpt-4'` 与下拉脱节 | `src/components/workflow/WorkflowCanvas.tsx`<br>`src/components/workflow/nodes/ChatLLMNode.tsx`<br>`src/components/workflow/ChatLLMConfigPanel.tsx` | L240–267 (handleAddChatLLMNode)<br>L17–23, L52–55<br>L33, L80–88 | 配置一致性 / 数据完整性 | P1 |
| #3 | Workflow 节点配置侧栏 i18n 泄漏 (8 个面板) | `src/components/workflow/{ChatLLM,VolcanoTTS,ToArray,ResultsCombine,PexelsVideoSearch,TavilySearch,AIVideoGenerate,VideoExport}ConfigPanel.tsx`<br>`src/components/workflow/nodes/{ToArray,ResultsCombine}Node.tsx`<br>`src/lib/i18n.ts` | 全文硬编码英文文案<br>i18n 缺失对应键 | i18n 完整性 | P2 |
| #4 | Workflow "编辑工作流详情"对话框完全未本地化 | `src/components/workflow/WorkflowEditModal.tsx`<br>`src/lib/i18n.ts` | L106–121 (typeMap), L207–365 视图层全英文<br>i18n 缺失键 | i18n 完整性 | P2 |
| #5 | 用户管理空状态文案错误（搜索无结果误显"暂无用户"） | `src/components/AdminSettings/UserManagement.tsx`<br>`src/lib/i18n.ts` | L1030–1036 空态分支不区分场景<br>缺 `noUsersMatchFilter` 键 | UX 文案 | P2 |
| #6 | 添加用户对话框校验错误缺 a11y 语义 | `src/components/AdminSettings/UserManagement.tsx` | L131–245 CreateUserDialog<br>L261–354 EditUserDialog<br>L367+ ResetPasswordDialog (类似问题) | a11y | P2 |
| #7 | Workflow 画布右键菜单缺 menu/menuitem ARIA 与键盘导航 | `src/components/workflow/WorkflowCanvas.tsx` | L1292–1462 contextMenu 渲染块<br>L508–520 全局点击关闭 effect | a11y | P3 |

---

## Bug #1 — 高级设置缺失 Next.js 代理路由

### 代码定位

- **缺失目录**：`src/app/api/model-settings/resolve/[functionType]/`
  - 同级已有 `assignments/[functionType]/route.ts`、`providers/[providerId]/`、`fetch-models/`、`test-connection/` —— 唯独 `resolve/` 没有。
- **调用方**：`src/components/AdminSettings/ModelSettingsPanel.tsx:664`
  ```ts
  const data = await http.get<ResolveConfigResponse>(`/api/model-settings/resolve/${ft}`);
  ```
  在 `fetchEffectiveConfigs`（L658–695）中针对 `FUNCTION_TYPES = ['chat','fast','video_cut','vision','coding']` 并发 5 次。每次 `catch` 静默返回 `{ source: 'none' }`，UI 全部渲染为 `未配置 / - / 未配置`。
- **后端真源**：`backend-services/basic-service/app/routers/model_settings_router.py:181`
  ```python
  @router.get("/resolve/{function_type}", response_model=ResolvedConfigResponse)
  async def resolve_config(function_type: ModelFunctionType): ...
  ```
  端点存在，被 `src/app/api/chat/route.ts` 服务器端调用 OK；浏览器侧因没经 Next 代理而 404。
- **代理工具**：`src/lib/api/server/backend-proxy.ts` 提供 `createPassthroughRoute(path | (params)=>path)`（参考 `assignments/[functionType]/route.ts`）。

### 根因

API 重构时，前 7 轮把 `model-settings` 多个子资源（providers/assignments/fetch-models/test-connection）补齐为 Next 代理，但遗漏了 `resolve/{ft}` —— 它直到"高级设置 → 当前生效配置"表格被使用才暴露。`fetchEffectiveConfigs` 的 `catch` 把网络错误降级为"未配置"，掩盖了 404 的存在。

### 修复方案

1. **新增** `src/app/api/model-settings/resolve/[functionType]/route.ts`：

   ```ts
   import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

   // GET /api/model-settings/resolve/{functionType} → backend
   export const { GET } = createPassthroughRoute(
     (p) => `/api/model-settings/resolve/${p.functionType as string}`,
   )
   ```

   - 与现有 `assignments/[functionType]/route.ts` 保持完全一致的文件结构。
   - 仅暴露 GET（后端只有 GET，POST/PUT/DELETE 不应代理过去）。

2. **不再静默吞 404**（防止类似回归）：在 `ModelSettingsPanel.tsx:fetchEffectiveConfigs` 的 `catch` 中区分网络错误与业务错误：
   - 422/404/5xx：写入 `source: 'error'`，并在 UI 行后面用 `t.adminSettings.fetchEffectiveConfigError` 显示一条警告徽章（仅本面板可见，不打扰其他 tab）。
   - 仍允许其他 ft 并行成功展示。
   - 使用 `console.error` 输出一次（非 dlog），便于将来诊断。

3. **i18n 新增键**（`src/lib/i18n.ts` 三处 locale 块对应位置）：
   - `adminSettings.effectiveConfigErrorBadge`: `'获取失败'` / `'Fetch failed'`
   - `adminSettings.effectiveConfigErrorDesc`: `'未能获取该功能类型的实际生效配置，请检查后端连接或刷新重试。'` / `'Failed to fetch effective config for this function type. Check backend or retry.'`

4. **测试覆盖**（关键 — 这是回归预防）：在 `src/app/api/model-settings/__tests__/` 下新增 `resolve.route.test.ts`：
   - mock `backendProxy.get`，验证 `GET /api/model-settings/resolve/chat` 转发到 `/api/model-settings/resolve/chat` 后端路径。
   - 简单 200 + 简单 5xx 透传。

### 风险与注意事项

- **不要**直接在前端读取 `LLM_*`/`AGENT_LLM_*` 环境变量来"绕过"——这些是服务端 only（无 `NEXT_PUBLIC_` 前缀）。必须经过 BFF 代理。
- 后端 `resolve` 端点对 `function_type` 参数用 Pydantic enum 校验（`ModelFunctionType`），当前 5 种 ft 均合法；若后端 enum 扩展，前端 `FUNCTION_TYPES` 需同步——但本修复范围不变。
- 修改 `catch` 行为时确保 `setLoadingEffectiveConfig(false)` 仍执行（保留 `finally` 块）。

### 测试建议

- **单元**：上面的 route 单测（防回归）。
- **集成**：在 dev 启动 backend + frontend，访问"高级设置"，验证：
  - DevTools Network 看到 5 次 `200 OK`。
  - 表格 5 行显示具体 `provider/api_url/model_name`，`source` 为 `database` 或 `environment`。
- **回归**：在没有 backend 的情况下访问该 tab，验证显示"获取失败"徽章，不再误导为"未配置"。

---

## Bug #2 — Workflow Chat LLM 节点默认 model `'gpt-4'` 与下拉脱节

### 代码定位

- **创建处**：`src/components/workflow/WorkflowCanvas.tsx:240–267`（`handleAddChatLLMNode`）
  ```ts
  config: {
    model: 'gpt-4',         // ← 硬编码、不在下拉选项内
    temperature: 0.7,
    maxTokens: 2000,
  }
  ```
- **节点卡片显示**：`src/components/workflow/nodes/ChatLLMNode.tsx:17–23`（`isConfigured` 判定包含 `config?.model`）、L52–55（显示 `config?.model || t.workflowNodes.status.notSet`）。
- **配置面板**：`src/components/workflow/ChatLLMConfigPanel.tsx`
  - L33：`useState(config.modelId || '')` —— 注意这里用的是 `modelId`，而 Canvas 创建时给的是 `model`（字符串名字），两个字段不一致是更深的根因。
  - L57–60：`if (!selectedModelId && models.length > 0) setSelectedModelId(models[0].id);` —— 当 `modelId` 缺失时静默选第一项，但未把"已隐式选择"回写给 `config.modelId`，导致用户不主动 Save 就走了。
  - L80–88：保存时同时写 `modelId` 与 `model = selectedModel?.name || ''`。
- **执行校验**：`src/components/workflow/WorkflowExecutor.ts`（节点执行前只查 `config.model` 非空，无效引用透传到后端）。
- **类型**：`src/types/index.ts` 中 `ChatLLMNodeConfig` 同时拥有 `model` 与 `modelId`（两套并存是 bug 温床）。

### 根因

历史演进留下两套字段：早期把 LLM 标识为字符串 `model`，后期改为查询/分发用的 `modelId`（来自后端 `AGENT_LLM_API_XX_*` 注册）。新增节点时把"占位 demo 字符串 `gpt-4`"塞进 `model`，但没填 `modelId`；下拉框只看 `modelId`。结果：

- 节点卡片信任 `model` → 显示 `gpt-4`。
- 配置面板信任 `modelId` → fallback 选第一项，但不回写 state。
- WorkflowExecutor 看 `model` 非空 → 通过校验。
- 真正发请求时后端认 `modelId` → 用第一项 / 报错。

### 修复方案

1. **取消硬编码占位**：`WorkflowCanvas.tsx:handleAddChatLLMNode` 创建节点时**不**预填 `model` 字段：
   ```ts
   config: {
     // model & modelId 留空 → 节点显示"未配置"
     temperature: 0.7,
     maxTokens: 2000,
   } as ChatLLMNodeConfig,
   ```
   - `ChatLLMNode.isConfigured` 因此变为 false（`systemPrompt`/`model`/`temperature`/`maxTokens` 任一存在 → 但因 temperature 也算 truthy，需收紧），故同步：
   - 把 `isConfigured` 收紧为：`!!(config?.modelId)` —— 必须有 model 选择才算"已配置"。
   - 节点卡片在未配置态显示 `t.workflowNodes.status.notConfigured` + `doubleClickToConfigure`（已存在键）。

2. **配置面板自动选择 + 回写**：`ChatLLMConfigPanel.tsx:loadModels` 内当 `selectedModelId` 为空且 `models.length > 0`：
   - 选 `models[0].id`（保留现状）。
   - **关键改动**：调用 `onSave` 不可（避免循环），但应把"自动选择"立即标记为脏，并在用户首次任何编辑或在 1.5s 自动保存中持久化。**最简方案**：`onSave` 后当面板打开未触碰也写一次（在 useEffect 中 detect "auto-selected default"，调用一次 `onSave({...config, modelId: models[0].id, model: models[0].name})`，再 onClose 否决）。
   - 实务最稳的做法：**保留打开后选择，但在 `handleSave` 阻断 `!selectedModelId` 提交**（已有 disabled 逻辑），并在打开面板时若发现 `!config.modelId` 显示一条提示横幅 "请选择模型并保存以激活节点"（i18n 新键 `t.workflowConfig.chatLLM.selectModelHint`）。

3. **WorkflowExecutor 校验加严**：把"`config.model` 非空"改为"`config.modelId` 非空且能在已注册模型中找到"。无效模型 → 抛 `ConfigurationError("Invalid Chat LLM modelId: <id>")`，由 WorkflowLogPanel 显示。

4. **统一字段**（小重构，可在后续步骤独立提交以缩小本 PR 范围）：删除 `ChatLLMNodeConfig.model`（人类可读 name）字段，改为按 `modelId` 在使用点 lookup display name。本次 fix-plan 中**仅在节点卡片显示层**做兼容：
   ```tsx
   <span>{config?.model || (config?.modelId ? config.modelId : t.workflowNodes.status.notSet)}</span>
   ```

5. **数据迁移**：旧工作流已经把 `model: 'gpt-4'` 落库（`AgentWorkflow.workflow_data`）的，加载时（`WorkflowSidebar` 或 `WorkflowExecutor` 反序列化路径）做软迁移：发现 `model === 'gpt-4'` 且无 `modelId` → 清空 `model`，让节点显示"未配置"，强制管理员重新选择。**不**在 DB 层迁移（避免破坏未启动的工作流）。

### 风险与注意事项

- 步骤 4（删除 `model` 字段）涉及面大，建议本次 PR **只做兼容**（步骤 1+2+3+5），删除字段留后续。
- 步骤 5 的"软迁移"需考虑：用户可能真的有名为 `gpt-4` 的 Agent 模型映射 —— 用 `'gpt-4'` 作为哨兵字符串风险低（默认值，不可能与实际 Agent name 冲突，因为 Agent 命名格式为 `glm-5-turbo (Agent NN)`）。但仍记录在 dlog 中以便排查。
- `ChatLLMConfigPanel` 的 useEffect 依赖数组保持原状，避免无限渲染。

### 测试建议

- **单元（新增）**：
  - `WorkflowCanvas.handleAddChatLLMNode` 创建的节点 `config.modelId` 为 `undefined`、`config.model` 不存在；`isConfigured` 为 false。
  - `ChatLLMNode` 渲染：未配置时显示 `notConfigured`；有 modelId 无 model 时显示 modelId；有 model 时显示 model。
  - `ChatLLMConfigPanel` 在 `loadModels` 完成后若打开时 modelId 为空，显示 `selectModelHint` 横幅；保存按钮在未选择时 disabled。
- **集成（手测）**：复现 bug 报告的步骤，验证节点卡片与配置面板始终显示同一模型；保存后画布更新；执行工作流不再出现 "Invalid model" 报错。

---

## Bug #3 — Workflow 节点配置侧栏 i18n 泄漏

### 代码定位

8 个 ConfigPanel + 2 个 Node 文件含硬编码英文文案。聚焦 `ChatLLMConfigPanel.tsx` 作样本：

- L111：`<h2>Chat LLM Configuration</h2>`
- L132：`nodeLabel="Chat LLM"`（传给 `NodeTestPanel`）
- L142：`<h3>Data Format</h3>`
- L146：`label="Input Format"` + L150 helpText
- L153–158：`Output Format` + helpText
- L165：`<label>System Prompt</label>` + L170 placeholder + L175 hint
- L182：`<label>Model</label>` + L201 Retry + L210 `No models available` + L221 hint
- L229–248：`Temperature`、`0.0 (Precise)` / `2.0 (Creative)`、helpText
- L255–273：`Max Tokens`、helpText
- L285：`Cancel` 按钮
- L292：`Save Configuration` 按钮

其他面板（VolcanoTTS/ToArray/ResultsCombine/PexelsVideoSearch/TavilySearch/AIVideoGenerate/VideoExport）按相同模式逐文件检查。

### 根因

8 个面板均早于 i18n 全面覆盖时期编写，开发者已引入 `useLocale()` 作为占位（如 `ChatLLMConfigPanel:29`），但 JSX 内仍写英文字面量，没有迁移完。`NodeTestPanel` 接收 `nodeLabel` 作为 prop（来自父级硬编码字符串），是次级泄漏。

### 修复方案

1. **i18n 增加分组** `workflowConfig`（`src/lib/i18n.ts` 三处 locale 块同步加入）：
   ```ts
   workflowConfig: {
     common: {
       cancel: string;
       saveConfiguration: string;
       inputFormat: string;
       outputFormat: string;
       inputFormatHelp: string;
       outputFormatHelp: string;
       dataFormat: string;
       testAndDebug: string;
       testThisNodeIndependently: string;
       plainText: string;
       jsonObject: string;
       arrayLabel: string;
       jsonObjectDesc: string;
     };
     chatLLM: {
       title: string;
       systemPrompt: string;
       systemPromptPlaceholder: string;
       systemPromptHelp: string;
       model: string;
       modelHelp: string;
       modelLoading: string;
       modelLoadError: string;
       retry: string;
       noModelsAvailable: string;
       temperature: string;
       temperatureLow: string;   // "0.0 (Precise)"
       temperatureHigh: string;  // "2.0 (Creative)"
       temperatureHelp: string;
       maxTokens: string;
       maxTokensHelp: string;
       selectModelHint: string;  // 来自 Bug #2
     };
     volcanoTTS: { /* 类似 */ };
     toArray: { /* 类似 */ };
     resultsCombine: { /* 类似 */ };
     pexelsSearch: { /* 类似 */ };
     tavilySearch: { /* 类似 */ };
     aiVideoGenerate: { /* 类似 */ };
     videoExport: { /* 类似 */ };
     // 新增 nodes 节点卡片新增的硬编码英文（ToArrayNode/ResultsCombineNode）
     nodes: {
       toArray: { title: string; ... };
       resultsCombine: { title: string; ... };
     };
   }
   ```

   先 zh-CN 与 en 各填一份；如有第三 locale（参考 `i18n.ts` 现状）同步更新。

2. **逐文件替换**：以 `ChatLLMConfigPanel.tsx` 为范本：
   - 在文件顶部已 `const { t } = useLocale();`。
   - 把所有英文字面量替换为 `t.workflowConfig.chatLLM.*` / `t.workflowConfig.common.*`。
   - `nodeLabel="Chat LLM"` 改为 `nodeLabel={t.workflowConfig.chatLLM.title}`。
3. **`NodeTestPanel`**：检查它是否还有内部硬编码（标题、按钮）。如有同步 i18n 化（`workflowConfig.common.testAndDebug` 等）。
4. **`FormatSelector`**：参数当前是 `label`/`helpText` 父传入。改造保持不动（因为父已 i18n 化），但确保它**自身**没有任何硬编码（如 "Plain Text" / "JSON" select option labels）—— 若有则用 `workflowConfig.common.{plainText,jsonObject,arrayLabel}`。
5. **覆盖单测**：每个 panel 已有 `__tests__/`（部分），新增/扩展 snapshot：在 zh-CN 上下文下渲染，断言不出现常见英文关键字（`/Save Configuration|System Prompt|Test & Debug|Data Format/`）。

### 风险与注意事项

- 8 个面板加 nodes 卡片字面量量大，避免一次提交"巨量"；可拆为两轮（先 ChatLLMConfigPanel 作范本走通流程，再批量套用）。
- `i18n.ts` 文件超 7000 行，三处 locale 都要同步，漏一处会编译报错（TS interface 强制）。先改 interface（顶部），再补 zh-CN，再补 en。
- 不要因 i18n 重命名而修改 prop 名（避免 churn）。

### 测试建议

- 静态 grep：`pnpm exec ripgrep -n 'Save Configuration|System Prompt|Test & Debug' src/components/workflow/` 应为空。
- Vitest snapshot：每个 panel 一个最小 render 测试，断言关键中文/英文文案。

---

## Bug #4 — Workflow "编辑工作流详情"对话框完全未本地化

### 代码定位

- `src/components/workflow/WorkflowEditModal.tsx`
  - **完全未引入** `useLocale`（与同目录 ChatLLMConfigPanel 形成对比）。
  - L106–121 `getNodeTypeDisplayName` 内 typeMap 全英文（`'Start'`/`'End'`/`'Chat LLM'`/...）。
  - L207 `<h2>Edit Workflow</h2>`、L210 副标题、L218 `aria-label="Close modal"`。
  - L232 `Workflow Name *`、L241 placeholder。
  - L244 `Workflow name is required` 校验文案。
  - L253 `Description`、L261 placeholder。
  - L268 `Workflow Nodes`、L272 `node` / `nodes`（单复数）。
  - L283 `No nodes in this workflow yet`、L286 `Add nodes in the workflow canvas`。
  - L337 `Unsaved changes`、L340 `No changes`、L348 `Cancel`、L361 `Saving...`、L364 `Save Changes`。

### 根因

WorkflowEditModal 是早期版本，i18n 全面覆盖前编写，从未补齐。文件没有引入 `useLocale` 是直接证据。

### 修复方案

1. **i18n 新增** `workflowEditModal` 分组（`src/lib/i18n.ts` 三处同步）：
   ```ts
   workflowEditModal: {
     title: string;             // '编辑工作流' / 'Edit Workflow'
     subtitle: string;          // '修改工作流详情并查看节点' / 'Modify workflow details and view nodes'
     closeAriaLabel: string;    // '关闭对话框' / 'Close modal'
     nameLabel: string;         // '工作流名称'
     namePlaceholder: string;
     nameRequired: string;
     descriptionLabel: string;
     descriptionPlaceholder: string;
     nodesLabel: string;        // '工作流节点'
     nodeCountSingular: string; // '{count} 个节点' / '{count} node'
     nodeCountPlural: string;   // '{count} 个节点' / '{count} nodes'
     emptyTitle: string;        // '此工作流暂无节点'
     emptyHint: string;         // '请在画布中添加节点'
     unsavedChanges: string;
     noChanges: string;
     cancel: string;
     saving: string;
     saveChanges: string;
   }
   ```

2. **节点类型显示名复用**：`getNodeTypeDisplayName` 改为读取已存在的 `t.workflowInterface.canvas.nodeDefaults`（已是中文）：
   ```ts
   const getNodeTypeDisplayName = (type: string): string => {
     const map: Record<string, string> = {
       'start': t.workflowInterface.canvas.nodeDefaults.start,
       'end': t.workflowInterface.canvas.nodeDefaults.end,
       'chat-llm': t.workflowInterface.canvas.nodeDefaults.chatLLM,
       // ...
     };
     return map[type] || type;
   };
   ```

3. **组件改造**：
   - 顶部 `import { useLocale } from '@/contexts/LocaleContext'`。
   - 函数体 `const { t } = useLocale();`。
   - 替换全部英文字面量为 `t.workflowEditModal.*`。
   - 单复数：用 `nodes.length === 1 ? t.workflowEditModal.nodeCountSingular : t.workflowEditModal.nodeCountPlural`，并在文案里以 `{count}` 占位 + 简单 replace。

### 风险与注意事项

- 不要触碰 `useEffect`/`onSave` 等业务逻辑，仅替换文案。
- `Saving...` 中的 `...` 三个点保留为 `…` 还是 `...`？两种 locale 都用 `...` 与现有项目其他 saving 文案保持一致。

### 测试建议

- 渲染快照（zh-CN）：标题为 `编辑工作流`；空 nodes 显示 `此工作流暂无节点`。
- 切换 locale 为 en：标题恢复 `Edit Workflow`。

---

## Bug #5 — 用户管理空状态文案错误

### 代码定位

- `src/components/AdminSettings/UserManagement.tsx:1030–1036`
  ```tsx
  ) : users.length === 0 ? (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <IconUsers className="w-16 h-16 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-muted-foreground">{t.adminSettings.noUsers}</p>
      </div>
    </div>
  ) : ( ... )
  ```
- `src/lib/i18n.ts:5631`（zh-CN）/ `:2872`（en）`noUsers: '暂无用户' / 'No users found'`
- 上方 L977–1018 表头 search/role/status filter 都接入 state；但**没有变量记录"是否处于筛选/搜索态"**——只能根据 `search.trim() !== ''` / `roleFilter !== ''` / `statusFilter !== ''` 推断。

### 根因

i18n 单字符串复用于"列表全空"和"筛选无结果"两种语义场景。组件层未做场景区分。

### 修复方案

1. **新增 i18n 键**（三处 locale）：
   - `noUsersMatchFilter`: `'未找到符合条件的用户'` / `'No users match your filters'`
   - 保持 `noUsers` 原义（系统真无用户场景）。

2. **组件层判断**：
   ```tsx
   const isFiltering =
     search.trim() !== '' || roleFilter !== '' || statusFilter !== '';
   ...
   <p className="text-muted-foreground">
     {isFiltering ? t.adminSettings.noUsersMatchFilter : t.adminSettings.noUsers}
   </p>
   ```

3. **可选 UX 增强**（可不做）：在筛选无结果文案下加一个"清除筛选"按钮：
   ```tsx
   {isFiltering && (
     <button onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); }}
             className="mt-3 text-sm text-primary hover:underline">
       {t.adminSettings.clearFilters}
     </button>
   )}
   ```
   若实施则同步 i18n 加 `clearFilters`。

### 风险与注意事项

- `users.length === 0` 是后端分页返回的结果集，不一定代表"系统真无"。但当 `search`/`roleFilter`/`statusFilter` 均空仍 0 → 客观就是真无（除非翻到末尾页）。当前判定可接受；进一步可结合 `total === 0` 才显示 noUsers。

### 测试建议

- 单测 `__tests__/UserManagement.test.tsx`（如已有则补充）：mock users=[], search=''+filters='' → 期 `noUsers`；search='xxx' → 期 `noUsersMatchFilter`。

---

## Bug #6 — 添加用户对话框校验错误缺 a11y 语义

### 代码定位

- `src/components/AdminSettings/UserManagement.tsx`
  - L177–178 `inputClass` 工厂只切换 border 颜色，未加 `aria-invalid`。
  - L200–204（username block）：
    ```tsx
    <input ... className={inputClass('username')} ... />
    {errors.username && <p className="text-destructive text-xs mt-1">{errors.username}</p>}
    ```
    `<p>` 缺 `id`、缺 `role="alert"`、`<input>` 缺 `aria-invalid`、`aria-describedby`。
  - 同模式重复 5 次：username（L200）、password（L206）、confirmPassword（L212）、email（L217）、fullName 无校验。
  - **EditUserDialog**（L300+）同模式：仅 email 一处。
  - **ResetPasswordDialog**（L367+）同模式：newPassword/confirmPassword。

### 根因

校验提示组件未按 WAI-ARIA Authoring Practices 标记。屏幕阅读器无法感知错误。

### 修复方案

1. **抽出小组件**（避免重复改 5+ 处）：
   ```tsx
   // 文件内本地组件，无需新建文件
   function FieldError({ id, message }: { id: string; message?: string }) {
     if (!message) return null;
     return (
       <p id={id} role="alert" className="text-destructive text-xs mt-1">
         {message}
       </p>
     );
   }
   ```

2. **每个字段使用模式**：
   ```tsx
   const usernameErrId = 'create-user-username-error';
   <input
     id="create-user-username"
     type="text"
     value={form.username}
     onChange={(e) => setForm({ ...form, username: e.target.value })}
     placeholder={t.adminSettings.usernamePlaceholder}
     className={inputClass('username')}
     disabled={submitting}
     autoComplete="off"
     aria-invalid={!!errors.username}
     aria-describedby={errors.username ? usernameErrId : undefined}
   />
   <FieldError id={usernameErrId} message={errors.username} />
   ```

3. **id 命名规范**：`{dialog}-{field}-error` 避免在多对话框同时挂载时冲突。已检查：3 个 Dialog 仅有一个能同时打开（互斥），但仍以 dialog 前缀稳健。

4. **focus 策略**（轻量增强）：`handleSubmit` 在 `validate()` 返回 false 时，用 `document.getElementById(firstErrorId)?.focus()` 把焦点送回首个错误字段。

5. **应用到全部 3 个 Dialog**：CreateUserDialog（usernameErr/passwordErr/confirmPasswordErr/emailErr）、EditUserDialog（emailErr）、ResetPasswordDialog（newPasswordErr/confirmPasswordErr/manualPwdErr）。

### 风险与注意事项

- `role="alert"` 会在元素出现时立即播报；若用户每输入一字符就触发 validate（当前 validate 仅在 submit 时调用），无频繁播报问题。**保留**当前 validate-on-submit 行为，不要在 onChange 上跑校验（否则用户每输入一字符都被打扰）。
- `aria-describedby` 仅在错误存在时设置；不存在时省略，避免引用空 id。

### 测试建议

- 单测：mock submit invalid，断言 input 的 `aria-invalid` 为 `'true'`、`<p>` 出现且 `role` 属性为 `'alert'`、`aria-describedby` 指向 `<p>` 的 id。
- 手测：用 NVDA / Edge 朗读器进入对话框、提交无效，确认错误被朗读。

---

## Bug #7 — Workflow 画布右键菜单缺 menu/menuitem ARIA 与键盘导航

### 代码定位

- `src/components/workflow/WorkflowCanvas.tsx`
  - L1292–1462 渲染 contextMenu 的 `<div>`，子项全是裸 `<button>`，外层 div 无 `role`。
  - L508–520（左近）有"点击外部关闭"effect：
    ```ts
    useEffect(() => {
      const handler = () => { if (contextMenu.visible) setContextMenu({...}); };
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }, [contextMenu.visible]);
    ```
  - **没有** keydown 监听处理 ArrowUp/Down/Esc。

### 根因

Context menu 是早期实现，纯视觉模拟菜单，没有遵循 WAI-ARIA Menu Pattern。键盘用户和屏幕阅读器无法操作。

### 修复方案

1. **DOM 结构 + ARIA**：
   ```tsx
   <div
     role="menu"
     aria-label={t.workflowInterface.canvas.contextMenu.menuAriaLabel}
     className="..."
     style={{ left, top }}
     onClick={(e) => e.stopPropagation()}
     onKeyDown={handleMenuKeyDown}
     ref={menuRef}
   >
     <button role="menuitem" tabIndex={focusedIndex === 0 ? 0 : -1} ...>
       ...
     </button>
     ...
     {/* 分隔条 */}
     <div role="separator" className="h-px bg-border my-1" />
     ...
   </div>
   ```
   - 11 个菜单项 + 4 处 separator 全部加 `role`。
   - `aria-label` 走新 i18n 键 `t.workflowInterface.canvas.contextMenu.menuAriaLabel`（`'添加节点菜单'` / `'Add node menu'`）。

2. **roving tabindex + 键盘导航**：
   - 新增 state：`const [focusedItemIndex, setFocusedItemIndex] = useState(0);` （仅在菜单可见时有意义）。
   - `useEffect` 在菜单首次显示时把 focus 转到第一个 menuitem：
     ```ts
     useEffect(() => {
       if (contextMenu.visible) {
         setFocusedItemIndex(0);
         requestAnimationFrame(() => {
           menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
         });
       }
     }, [contextMenu.visible]);
     ```
   - `handleMenuKeyDown`：
     - `ArrowDown`：focus 下一个 menuitem，wrap 到首项。
     - `ArrowUp`：上一个，wrap 到尾项。
     - `Home`：首项。`End`：尾项。
     - `Enter`/`Space`：触发 `click()`。
     - `Esc`：关闭菜单 (`setContextMenu({...visible:false})`)。
   - 用 `menuItemsRef = useRef<(HTMLButtonElement|null)[]>([])` 收集 11 个 button 引用。

3. **触发器关联**（轻量）：右键打开时给 `<div role="menu">` 加 `aria-orientation="vertical"`（默认就是 vertical，可省）。

4. **菜单项数量易变 → 抽出数组**（推荐重构）：当前 11 个 button 是手写 JSX（150+ 行），可抽为 `const items: { key, icon, labelKey, onClick }[]` 数组并 map 渲染。这样添加/删除菜单项不再四处对齐 separator。**本次只做 ARIA + 键盘**，重构留 follow-up。

### 风险与注意事项

- `role="menu"` 不被 axe-core 严格要求"必须有触发按钮 with `aria-haspopup`"，但右键唤起的 context menu 没有触发按钮——这是允许的（WAI-ARIA APG 把 context menu 列为单独模式）。
- 焦点交还：菜单关闭时（点击项触发 / Esc / 点击外部），把焦点送回 canvas（`canvasRef.current?.focus()`）。canvas 需 `tabIndex={-1}` 以接受程序化 focus。

### 测试建议

- 单测：渲染 contextMenu visible，断言 `getByRole('menu')`、`getAllByRole('menuitem')` 长度 11。
- 键盘：模拟 ArrowDown 三次后 Enter，断言对应 handler 被调用一次（chatLLM）。Esc → menu hidden。
- a11y 自动化：playwright + `@axe-core/playwright`，访问工作流右键打开菜单，期望 0 critical violations on menu pattern.

---

## 优先级与依赖

```
P1 修复（先做）：
  Bug #1 → 独立，最快收益（防回归测试一并补）。
  Bug #2 → 独立，依赖前端类型层，要小心向后兼容（旧工作流）。

P2 修复（其次）：
  Bug #3 → 大批量 i18n 增补，建议拆为子任务：
            (a) interface + zh-CN/en keys 骨架；
            (b) ChatLLMConfigPanel 范本；
            (c) 其余 7 个 panel 套用。
  Bug #4 → 依赖 Bug #3 中 nodeDefaults 复用，但本质独立。
  Bug #5 → 独立，最快收益。
  Bug #6 → 独立，3 个 Dialog 同时改。

P3：
  Bug #7 → 独立。可与 Bug #2/#3 并行（同一文件 WorkflowCanvas.tsx 不同区段，但避免冲突最好串行）。
```

### 推荐提交边界

- **PR-1**: Bug #1 + Bug #5（最小、独立、用户立即可见）。
- **PR-2**: Bug #6（a11y 单点）。
- **PR-3**: Bug #2（带兼容层 + 数据软迁移）。
- **PR-4**: Bug #3 + Bug #4 + Bug #7（workflow editor 区集中改动）。

或一次性巨型 PR（项目历史风格倾向于此）：所有 7 个 bug 合并为单一 commit，commit message 用项目约定 `[fix]` 前缀，描述按 bug 编号列出。

---

## 通用风险

- **i18n 编辑大文件 7000+ 行**：`src/lib/i18n.ts` 是大型单文件，TS interface 会强制三个 locale 的键完全一致；漏键会编译失败（这是好事）。
- **Vitest 测试覆盖率**：本次新增/修改的所有公开行为应有对应 vitest 用例（参考前几轮 fix-plan 末尾的"测试建议"模式）。
- **build 时 ESLint 被忽略**（项目约定 `next.config.js` 跳过 ESLint）：本地以 `npm run lint` 与 `npm run type-check` 跑通后再提交，避免引入 `no-explicit-any` 等告警。
- **dev 服务器**：dev 在 192.168.1.123:3010 上运行（per memory），实地复测时通过 SFTP 同步代码后重启 backend/frontend。

## 完成标准

- 所有 7 个 bug 报告所述复现路径不再触发。
- 新增/修改文件均带对应 vitest 测试。
- `npm run type-check` 无错。
- `npm run lint` 无新增警告。
- dev 实地手测通过 P1 两个 bug 的复测。
