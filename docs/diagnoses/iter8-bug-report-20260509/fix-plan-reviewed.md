# Iter8 Fix Plan — Reviewed (2026-05-09)

> 来源 Bug 报告：`docs/diagnoses/iter8-bug-report-20260509/bug-report.md`
> 上游方案：`docs/diagnoses/iter8-bug-report-20260509/fix-plan.md`
> 本文件为步骤 3 输出：对原方案进行**全面技术审查**并直接修正问题，可直接用于步骤 4 实施代码修改。

## 审查结论摘要

| Bug | 原方案技术正确性 | 关键修正点 |
|---|---|---|
| #1 | ✅ 主体正确 | ⚠️ 需澄清 `assignments/[functionType]/route.ts` 现状是仅 `DELETE`（pattern 仍适用 GET）；`catch` 修正必须只覆盖网络/HTTP 错误，不能影响 `data.success===false` 的合法回退分支 |
| #2 | ⚠️ **关键遗漏** | 🔴 WorkflowExecutor `config?.model` 校验出现在 **3 处**（L639 chat-llm / L902 to-array / L1008 results-combine），原方案只提到一处；ToArray 与 ResultsCombine 配置面板可能有同类 model/modelId 不一致问题，需顺带核查 |
| #3 | ✅ 主体正确 | ⚠️ FormatSelector 内含 `FormatDisplayNames` + `FormatDescriptions` 共 6 条硬编码英文，需一并 i18n 化（原方案只提到 DisplayNames） |
| #4 | ✅ 主体正确 | 💡 顺手修复同文件 L243 校验提示的 a11y（与 Bug #6 同型问题）能省一次接触；原方案未提，可作为低成本顺带项 |
| #5 | ✅ 完全正确 | — |
| #6 | ✅ 完全正确 | ⚠️ `aria-describedby` 仅在错误存在时设置，否则省略，避免引用不存在 id（原方案已注明） |
| #7 | ✅ 主体正确 | ⚠️ canvas 接受程序化 focus 需 `tabIndex={-1}`；需先确认 canvasRef 指向的元素是否已有该属性 |

总体：**方案 6/7 可直接执行**，Bug #2 需补充 WorkflowExecutor 多处校验同步修改 + 软迁移落点；Bug #3 范围需扩到 FormatSelector 内部常量。

---

## 已验证的代码现状（截止 2026-05-09）

以下为审查阶段实际读取代码后的现状记录，供下一步实施作权威基准。

### Bug #1 相关
- `src/app/api/model-settings/` 子目录确认存在：`assignments/`, `fetch-models/`, `providers/`, `test-connection/`；**`resolve/` 不存在**。
- `src/app/api/model-settings/assignments/[functionType]/route.ts` 当前**仅导出 `DELETE`**（不是 GET）。但 `createPassthroughRoute` 同时返回 GET/POST/PUT/DELETE 四个 handler，挑选 `export const { GET } = ...` 完全合法。
- `src/components/AdminSettings/ModelSettingsPanel.tsx:658-695` 确认 `fetchEffectiveConfigs` 实现：
  - L664: `http.get<ResolveConfigResponse>('/api/model-settings/resolve/${ft}')`
  - L677: 当 `data.success === false` 时返回 `source: 'environment'`（**这是合法的、非 bug 的回退**）
  - L678-681: `catch` 静默吞掉所有异常 → `source: 'none'`（**这是 bug，掩盖了 404**）
- `src/lib/api/server/backend-proxy.ts` 确认 `createPassthroughRoute` 接受 `(params) => string` builder。

### Bug #2 相关
- `WorkflowCanvas.tsx:240-267` 确认 `handleAddChatLLMNode` 内 `config: { model: 'gpt-4', temperature: 0.7, maxTokens: 2000 }` 硬编码。
- `nodes/ChatLLMNode.tsx:18-23` 确认 `isConfigured` 判定为 `!!(systemPrompt || model || temperature !== undefined || maxTokens)` —— 由于 `temperature: 0.7` 默认存在，**仅删 `model: 'gpt-4'` 而不收紧 `isConfigured` 仍会显示为已配置态**。这一点原方案 Bug#2 步骤 1 末段提到了"故同步收紧"，**必须执行**。
- `ChatLLMConfigPanel.tsx:33` 确认 `useState(config.modelId || '')` 使用 `modelId` 字段，与画布写入 `model` 字段不一致。
- `ChatLLMConfigPanel.tsx:289` 确认 Save 按钮已 `disabled={isLoadingModels || !!loadError || !selectedModelId}`，**已防止保存空 modelId**。
- **WorkflowExecutor.ts 校验出现在 3 处**（关键修正）：
  - L639 (`executeChatLLM`): `if (!config?.model || !config?.systemPrompt)`
  - L902 (`executeToArray`): `if (!config?.model || !config?.systemPrompt)`
  - L1008 (`executeResultsCombine`): `if (!config?.model || !config?.systemPrompt)`
  - 这意味着 ToArray / ResultsCombine 节点也使用 `model`+`systemPrompt`，但其配置面板 (`ToArrayConfigPanel.tsx`, `ResultsCombineConfigPanel.tsx`) 是否同样存在 `model`/`modelId` 字段不一致问题，**实施前必须 grep 确认**。

### Bug #3 相关
- `ChatLLMConfigPanel.tsx` 已含 `useLocale()` (L29)，但下列字面量仍硬编码：L111 (h2), L112 ("Node ID:"), L132 (`nodeLabel="Chat LLM"`), L142 ("Data Format"), L146 ("Input Format"), L150 (helpText), L154 ("Output Format"), L158 (helpText), L165 ("System Prompt"), L170 (placeholder), L175 (hint), L182 ("Model"), L200 ("Retry"), L210 ("No models available"), L221 (hint), L243-244 ("0.0 (Precise)" / "2.0 (Creative)"), L247 (hint), L255 ("Max Tokens"), L273 (hint), L285 ("Cancel"), L292 ("Save Configuration")。**注意 L63 错误文案 `'Failed to load models. Please try again.'` 也是硬编码英文**（原方案未列出）。
- `FormatSelector.tsx:45-58` 含两组硬编码常量：
  ```ts
  FormatDisplayNames: { 'text/plain': 'Plain Text', 'application/json': 'JSON Object', 'array': 'Array' }
  FormatDescriptions: { 'text/plain': 'Simple text string', 'application/json': 'JSON object with key-value pairs', 'array': 'Array of items' }
  ```
  **原方案只提到 DisplayNames，遗漏了 Descriptions 与 helpText 的本地化**。
- `NodeTestPanel.tsx`、`StartNodeConfigPanel.tsx`、`TextInputConfigPanel.tsx` 也在 workflow 目录下，原方案未列入但可能有英文泄漏，**实施前需统一 grep 验证**。
- 8 个 ConfigPanel 文件确认存在（`AIVideoGenerate / ChatLLM / PexelsVideoSearch / ResultsCombine / TavilySearch / ToArray / VideoExport / VolcanoTTS`）+ 起始/文本输入面板。

### Bug #4 相关
- `WorkflowEditModal.tsx` 确认完全未引入 `useLocale`（与 ChatLLMConfigPanel 不同）。
- L106-121 `getNodeTypeDisplayName` typeMap 11 项全英文。
- L207 (`Edit Workflow`) / L211 (`Modify workflow details and view nodes`) / L218 (`aria-label="Close modal"`) / L233 / L241 / L245 / L253 / L261 / L269 / L272 / L284 / L287 / L337 / L340 / L348 / L361 / L364 全部硬编码。
- L243-247 校验提示（`Workflow name is required`）的 `<p>` 也无 `role="alert"`、关联 `<input>` 无 `aria-invalid` —— **与 Bug #6 同型问题，建议本次顺带修复**（仅一处，零额外架构成本）。

### Bug #5/#6/#7 相关
- `UserManagement.tsx:1023-1037` 空状态分支确认（loading / empty / has-data 三态）。
- `i18n.ts` `noUsers` 现状：interface L141, en L2872, zh-CN L5631。
- `WorkflowCanvas.tsx:508-519` "click outside" effect 确认；**未发现 keydown 监听**。
- `WorkflowCanvas.tsx` 的 `<div className="canvas-content">`（容器）当前**没有 `tabIndex` 属性** —— 实施步骤需为其加 `tabIndex={-1}` 以接受 `canvasRef.current?.focus()`。

---

## Bug #1 — 高级设置缺失 Next.js 代理路由

### 现状（已校验）
后端 `/api/model-settings/resolve/{function_type}` 端点存在；前端缺 Next 代理。`fetchEffectiveConfigs.catch` 静默吞 404 → 表格全显"未配置"。

### 修复步骤（已修正）

1. **新增** `src/app/api/model-settings/resolve/[functionType]/route.ts`（与 `assignments/[functionType]/route.ts` 同结构，仅暴露 GET）：
   ```ts
   import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

   export const { GET } = createPassthroughRoute(
     (p) => `/api/model-settings/resolve/${p.functionType as string}`,
   )
   ```

2. **修正 `fetchEffectiveConfigs` 错误处理**（仅修改 catch 分支，不改 success-false 分支）：
   ```ts
   // L678-681 改为：
   } catch (err) {
     console.error('[ModelSettingsPanel] resolve config failed for', ft, err);
     return {
       ft,
       config: { function_type: ft, provider_name: null, api_url: null, model_name: null, source: 'error' as const },
     };
   }
   ```
   - **关键**：保留 L677 `data.success === false` 时返回 `source: 'environment'`（这是后端"DB 无配置但环境变量存在"的合法回退，非错误）。
   - 新增 `source: 'error'` 是 `ResolvedConfig.source` 类型的新成员。`ResolveConfigResponse` 类型定义需扩展（找文件 `src/types/index.ts` 或 `src/components/AdminSettings/ModelSettingsPanel.tsx` 顶部 type 定义；同步加 `'error'` 字面量）。

3. **UI 行渲染时区分 `source: 'error'`**（原方案略提，需补具体改动位置）：
   - 在表格行渲染处（搜索 `effectiveConfigs[ft]` 使用点），当 `cfg.source === 'error'` 时显示警告徽章（用新增 i18n 键 `t.adminSettings.effectiveConfigErrorBadge`）。
   - 其他来源 (`'database' | 'environment' | 'none'`) 行为不变。

4. **i18n 新增键**（`src/lib/i18n.ts` 三处 locale 块的 `adminSettings` 分组同步）：
   - `effectiveConfigErrorBadge`: `'获取失败'` / `'Fetch failed'`
   - `effectiveConfigErrorDesc`: `'未能获取该功能类型的实际生效配置，请检查后端连接或刷新重试。'` / `'Failed to fetch effective config for this function type. Check backend connection or retry.'`

5. **测试覆盖**：在 `src/app/api/model-settings/__tests__/` 下新增 `resolve.route.test.ts`：
   - mock `backendProxy.get`，验证 GET 透传到后端 `/api/model-settings/resolve/chat`。
   - 验证 200 + 5xx 透传。

### 风险与注意事项
- **不要**直接读取 `LLM_*` / `AGENT_LLM_*` 环境变量绕过 BFF（无 `NEXT_PUBLIC_` 前缀，服务端 only）。
- 后端 `function_type` 用 `ModelFunctionType` enum 校验；若后端扩展，前端 `FUNCTION_TYPES` 数组需同步（本次范围不变）。
- **保留 `finally` 块**：`setLoadingEffectiveConfig(false)` 必须仍执行。
- `ResolvedConfig.source` 类型扩展需检查所有消费点：可能在表格行 switch、徽章颜色映射等位置。

### 测试建议
- 单元：上述 route 单测。
- 集成：dev 启 backend+frontend，DevTools Network 看到 5×200 OK；表格 5 行显示具体 provider/model；
  无 backend 时复测：表格行显示"获取失败"徽章，不再误显"未配置"。

---

## Bug #2 — Workflow Chat LLM 节点默认 model 与下拉脱节

### 现状（已校验，含原方案遗漏）
- `WorkflowCanvas.tsx:253` 硬编码 `model: 'gpt-4'`，下拉选项实为 `glm-5-turbo (Agent NN)`。
- `ChatLLMNode.isConfigured` 因 `temperature: 0.7` 永远为 truthy，**即使删 `model` 字段仍判为已配置**。
- `ChatLLMConfigPanel` 用 `modelId` 字段；保存时 L83 同时写 `modelId` 与 `model = selectedModel?.name`。
- WorkflowExecutor 校验 `config?.model` 出现在 **3 处**（L639/L902/L1008），分别对应 chat-llm、to-array、results-combine 三种节点类型。
- `ChatLLMConfigPanel` Save 按钮 (L289) 已在 `!selectedModelId` 时 disabled。

### 修复步骤（已修正：补 WorkflowExecutor 3 处 + 明确软迁移落点 + 同型节点自查）

1. **取消硬编码占位**：`WorkflowCanvas.tsx:handleAddChatLLMNode` 创建节点时**不**预填 `model`：
   ```ts
   data: {
     label: t.workflowInterface.canvas.nodeDefaults.chatLLM,
     type: 'chat-llm',
     config: {
       temperature: 0.7,
       maxTokens: 2000,
     } as ChatLLMNodeConfig,
   },
   ```

2. **收紧 `ChatLLMNode.isConfigured`**（**必须执行**，否则节点显示态不变）：
   ```ts
   // nodes/ChatLLMNode.tsx:18-23 改为：
   const isConfigured = !!(config?.modelId);
   ```
   节点卡片在未配置态显示已存在的 `t.workflowNodes.status.notConfigured` + `doubleClickToConfigure`。

3. **节点卡片显示链兼容**：`nodes/ChatLLMNode.tsx:55` 改为：
   ```tsx
   <span>{config?.model || config?.modelId || t.workflowNodes.status.notSet}</span>
   ```
   保证旧工作流（仅含 model 字段）向后兼容显示。

4. **配置面板未选模型时显示提示横幅**：`ChatLLMConfigPanel.tsx` 在 `!selectedModelId && !isLoadingModels && !loadError && availableModels.length > 0` 时渲染：
   ```tsx
   <div role="status" className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-sm text-amber-700">
     {t.workflowConfig.chatLLM.selectModelHint}
   </div>
   ```
   位置：模型下拉框上方。Save 按钮 disabled 已存在，无需改。

5. **WorkflowExecutor 校验加严（3 处全改）**：
   - L639 (`executeChatLLM`)、L902 (`executeToArray`)、L1008 (`executeResultsCombine`) 三处：
     ```ts
     if (!config?.modelId || !config?.systemPrompt) {
       throw new Error(`<NodeType> node is not fully configured. Please select a model and set system prompt.`);
     }
     ```
   - 同时把后续 `model: config.model` 用法（L644/L680/L766/L924/L982/L1036/L1044/L1143）改为：先 `const modelId = config.modelId;` 再用 `modelId`。具体下游 LLM 调用需要 `model` name 还是 `modelId` —— **实施前需读 `src/lib/api/llm.ts` 的请求构建逻辑确认**。
   - **关键风险**：若下游 API 需要 `model.name`（人类可读 name），且 `modelId` 是 backend 注册 ID，需新增 `availableModels` 查找步骤。原方案 Bug #2 步骤 4 已建议保留兼容层，本次实施时**保留 `config.model` 字段为 display name**（在 ChatLLMConfigPanel.handleSave L83 保留写入），仅校验从 `model` 切换到 `modelId`。

6. **ToArray / ResultsCombine 同型问题排查**（原方案遗漏的关联点）：
   - **必须** grep `src/components/workflow/ToArrayConfigPanel.tsx` 和 `ResultsCombineConfigPanel.tsx`：
     - 是否使用 `modelId` 字段？
     - 上游创建处（`WorkflowCanvas.tsx` 中 `handleAddToArrayNode` / `handleAddResultsCombineNode`）是否也硬编码 `model: 'gpt-4'`？
   - 若同样存在硬编码，**本次一并修复**（同模式：删硬编码、收紧 isConfigured、Executor 校验切到 `modelId`）。
   - 若 ToArray/ResultsCombine 配置面板用的是不同字段（如直接 LLM API URL），范围不变，仅修 Executor 的 modelId 校验。

7. **数据软迁移**（向后兼容旧工作流）：
   - **落点**：`WorkflowEditorClient`（或加载工作流的入口组件 — 需 grep `useState<WorkflowNode[]>` 起源）从后端响应 `/api/agent-workflows/${id}` 反序列化时，对 chat-llm/to-array/results-combine 节点：
     ```ts
     if (n.data.config?.model === 'gpt-4' && !n.data.config?.modelId) {
       const { model: _drop, ...rest } = n.data.config;
       n.data.config = rest;
       dlog('[migration] cleared default gpt-4 placeholder for node', n.id);
     }
     ```
   - **不**改 DB（避免破坏未启动的工作流）。
   - 实施前先 grep 确认起源：`src/components/workflow/WorkflowSidebar.tsx` 或 `src/components/workflow/WorkflowEditorClient.tsx`（视项目结构）。

### 风险与注意事项
- 步骤 5 下游 LLM 调用可能需要 `model.name` 而非 `modelId`；**先读 `src/lib/api/llm.ts` 确认调用契约**。若需 name，则保留 `config.model` 写入并在 Executor 用之；校验仍只检查 `modelId`（防硬编码 `'gpt-4'` 通过校验）。
- 哨兵字符串 `'gpt-4'` 软迁移：实际 Agent 命名格式为 `glm-5-turbo (Agent NN)`，与 `'gpt-4'` 不冲突；用 dlog 记录迁移事件便于排查。
- `ChatLLMConfigPanel` 的 `useEffect` 依赖数组**保持不变**，避免无限渲染。
- ToArray / ResultsCombine 若有相同问题，PR 范围会扩大；可拆为独立 follow-up commit。

### 测试建议
- **单元（新增）**：
  - `WorkflowCanvas.handleAddChatLLMNode` 产出节点 `config.model`/`modelId` 均不存在；`ChatLLMNode.isConfigured` 为 false。
  - `ChatLLMNode` 渲染：未配置态显示 `notConfigured`；有 `modelId` 无 `model` 时显示 `modelId`；有 `model` 时显示 `model`。
  - `ChatLLMConfigPanel`：modelId 为空时渲染 `selectModelHint` 横幅；Save 按钮 `disabled`。
  - `WorkflowExecutor.executeChatLLM` / `executeToArray` / `executeResultsCombine`：缺 `modelId` → 抛错；存在 → 通过。
  - 软迁移：mock 加载含 `model: 'gpt-4'` 的旧节点 → 加载后 `config.model` 应为 undefined。
- **集成（手测）**：复现 bug-report 步骤；节点卡片与配置面板模型显示一致；执行不再 Invalid model；旧工作流加载后节点卡片显示"未配置"。

---

## Bug #3 — Workflow 节点配置侧栏 i18n 泄漏

### 现状（已校验，含原方案遗漏）
- 8 个 ConfigPanel + 2 个 Node 文件含硬编码英文。
- `ChatLLMConfigPanel.tsx` 已 `useLocale()` (L29) 但 JSX 全英文（L63 errorMessage 也是英文，原方案未列）。
- `FormatSelector.tsx` 内含 `FormatDisplayNames` (L45-49) 与 `FormatDescriptions` (L54-58) 共 6 条硬编码英文（原方案只提到前者）。
- `NodeTestPanel.tsx`、`StartNodeConfigPanel.tsx`、`TextInputConfigPanel.tsx` 也需检查（原方案未列）。

### 修复步骤（已修正：FormatSelector 范围扩 + grep 验证策略）

1. **i18n 新增分组** `workflowConfig`（`src/lib/i18n.ts` 三处 locale 块同步加；先改 interface 顶部，再补 zh-CN，再补 en）：
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
       plainTextDesc: string;     // 新增（FormatDescriptions）
       jsonObjectDesc: string;
       arrayDesc: string;
       loadFailed: string;        // 新增 ChatLLMConfigPanel L63 错误文案
       nodeIdLabel: string;       // 新增 "Node ID:"
     };
     chatLLM: {
       title: string;
       systemPrompt: string;
       systemPromptPlaceholder: string;
       systemPromptHelp: string;
       model: string;
       modelHelp: string;
       retry: string;
       noModelsAvailable: string;
       temperature: string;
       temperatureLow: string;
       temperatureHigh: string;
       temperatureHelp: string;
       maxTokens: string;
       maxTokensHelp: string;
       selectModelHint: string;   // Bug #2 用
     };
     volcanoTTS: { /* 类似 — 实施时按面板内字面量补全 */ };
     toArray: { /* 类似 */ };
     resultsCombine: { /* 类似 */ };
     pexelsSearch: { /* 类似 */ };
     tavilySearch: { /* 类似 */ };
     aiVideoGenerate: { /* 类似 */ };
     videoExport: { /* 类似 */ };
     nodes: {
       toArray: { /* ToArrayNode.tsx 内字面量 */ };
       resultsCombine: { /* ResultsCombineNode.tsx 内字面量 */ };
     };
   }
   ```

2. **逐文件替换硬编码英文**：以 `ChatLLMConfigPanel.tsx` 为范本：
   - 替换 L111/L132/L142/L146/L150/L154/L158/L165/L170/L175/L182/L200/L210/L221/L243-244/L247/L255/L273/L285/L292。
   - **新增**：L63 `'Failed to load models. Please try again.'` → `t.workflowConfig.common.loadFailed`。
   - **新增**：L112 `'Node ID:'` → `t.workflowConfig.common.nodeIdLabel`。
   - `nodeLabel="Chat LLM"` → `nodeLabel={t.workflowConfig.chatLLM.title}`。

3. **`FormatSelector.tsx` 改造**（**新增**，原方案遗漏）：
   - 把 `FormatDisplayNames` / `FormatDescriptions` 由模块级常量改为组件内通过 `useLocale()` 读取：
     ```tsx
     const { t } = useLocale();
     const formatDisplayNames: Record<DataFormat, string> = {
       'text/plain': t.workflowConfig.common.plainText,
       'application/json': t.workflowConfig.common.jsonObject,
       'array': t.workflowConfig.common.arrayLabel,
     };
     const formatDescriptions: Record<DataFormat, string> = {
       'text/plain': t.workflowConfig.common.plainTextDesc,
       'application/json': t.workflowConfig.common.jsonObjectDesc,
       'array': t.workflowConfig.common.arrayDesc,
     };
     ```

4. **`NodeTestPanel.tsx` / `StartNodeConfigPanel.tsx` / `TextInputConfigPanel.tsx`**：实施前 grep `/[A-Z][a-zA-Z ]+/` 与典型英文短语，按相同模式替换。
   - 使用 `t.workflowConfig.common.testAndDebug` / `testThisNodeIndependently` 等。

5. **统一验证 grep**：实施末尾运行：
   ```bash
   # PowerShell:
   Select-String -Path "src/components/workflow/*.tsx","src/components/workflow/nodes/*.tsx" -Pattern 'Save Configuration|System Prompt|Test & Debug|Data Format|Plain Text|JSON Object|No models available|Cancel'
   ```
   预期返回 0 条（除非在注释或 type 字符串中）。

6. **覆盖单测**：每个 panel 一个 vitest snapshot：在 zh-CN 上下文下渲染，断言不出现关键英文字符串。

### 风险与注意事项
- 8 + 多个面板 + FormatSelector + NodeTestPanel 范围大，**强烈建议拆 commit**：
  - commit a：i18n interface 骨架 + zh-CN/en 全键
  - commit b：ChatLLMConfigPanel + FormatSelector 范本
  - commit c：其余面板 + Node 卡片
- `i18n.ts` 7000+ 行，TS interface 强制 3 个 locale 完全一致；漏键会编译失败（防呆）。
- **不要**因 i18n 重命名而修改 prop 名（避免 churn）。
- FormatSelector 改造涉及移除模块级常量，需确认无外部 import（grep `FormatDisplayNames`/`FormatDescriptions`）。

### 测试建议
- 静态 grep 见上。
- Vitest snapshot：每个 panel 最小 render 测试。
- 手测：locale 切 zh-CN，逐个打开节点配置面板核对中文。

---

## Bug #4 — Workflow "编辑工作流详情"对话框完全未本地化

### 现状（已校验）
- `WorkflowEditModal.tsx` 完全未引入 `useLocale`；L106-121 typeMap、L207-365 视图层全英文。
- L243-247 校验提示与 Bug #6 同型 a11y 问题。

### 修复步骤（已修正：顺带修 a11y）

1. **i18n 新增** `workflowEditModal` 分组（`src/lib/i18n.ts` 三处同步）：
   ```ts
   workflowEditModal: {
     title: string;             // '编辑工作流' / 'Edit Workflow'
     subtitle: string;
     closeAriaLabel: string;
     nameLabel: string;
     namePlaceholder: string;
     nameRequired: string;
     descriptionLabel: string;
     descriptionPlaceholder: string;
     nodesLabel: string;
     nodeCount: string;         // '{count} 个节点' / '{count} nodes'（中文不分单复数；en 用单一字符串内含 {count}）
     nodeCountSingular: string; // '1 node'（仅 en；zh 复用 nodeCount）
     emptyTitle: string;
     emptyHint: string;
     unsavedChanges: string;
     noChanges: string;
     cancel: string;
     saving: string;
     saveChanges: string;
   }
   ```
   - 中文一律 `'X 个节点'` 不分单复数。en 区分 `node` / `nodes`。

2. **节点类型显示名复用**：`getNodeTypeDisplayName` 改为读 `t.workflowInterface.canvas.nodeDefaults`：
   ```ts
   const map: Record<string, string> = {
     'start': t.workflowInterface.canvas.nodeDefaults.start,
     'end': t.workflowInterface.canvas.nodeDefaults.end,
     'chat-llm': t.workflowInterface.canvas.nodeDefaults.chatLLM,
     'text-input': t.workflowInterface.canvas.nodeDefaults.textInput,
     'pexels-video-search': t.workflowInterface.canvas.nodeDefaults.pexelsVideoSearch,
     'tavily-search': t.workflowInterface.canvas.nodeDefaults.tavilySearch,
     'volcano-tts': t.workflowInterface.canvas.nodeDefaults.volcanoTTS,
     'to-array': t.workflowInterface.canvas.nodeDefaults.toArray,
     'results-combine': t.workflowInterface.canvas.nodeDefaults.resultsCombine,
     'ai-video-generate': t.workflowInterface.canvas.nodeDefaults.aiVideoGenerate,
     'video-export': t.workflowInterface.canvas.nodeDefaults.videoExport,
   };
   ```
   - **实施前 grep `nodeDefaults` 确认 11 项全部存在**；缺哪项就补哪项 i18n。

3. **组件改造**：
   - 顶部 `import { useLocale } from '@/contexts/LocaleContext'`。
   - 函数体 `const { t } = useLocale();`。
   - L207/L211/L218/L233/L241/L253/L261/L269/L284/L287/L337/L340/L348/L361/L364 全部替换为 `t.workflowEditModal.*`。
   - 单复数：
     - zh: `${nodes.length} ${t.workflowEditModal.nodeCount}` 一律相同
     - 或定义 `nodeCount: '{count} 个节点'` 然后 `.replace('{count}', String(nodes.length))`

4. **顺手修 L243-247 校验提示 a11y**（**新增**，原方案遗漏，与 Bug #6 同型）：
   ```tsx
   <input
     id="workflow-name"
     ...
     aria-invalid={!editedName.trim()}
     aria-describedby={!editedName.trim() ? 'workflow-name-error' : undefined}
   />
   {!editedName.trim() && (
     <p id="workflow-name-error" role="alert" className="text-xs text-red-500 mt-1.5">
       {t.workflowEditModal.nameRequired}
     </p>
   )}
   ```

### 风险与注意事项
- 不要触碰 `useEffect` / `onSave` 业务逻辑，仅替换文案。
- `Saving...` 三个点保留 ASCII `...` 与项目其他 saving 文案一致（已检查 i18n.ts 现有 saving 文案约定）。
- typeMap 若 `nodeDefaults` 缺项，**必须**先在 i18n 补全再修 modal（否则 TS 报错）。

### 测试建议
- Vitest 渲染：zh-CN 上下文 → 标题 `编辑工作流`；空 nodes → `此工作流暂无节点`；切 en → 恢复英文。
- a11y：模拟空 name → input `aria-invalid="true"`、`<p>` `role="alert"`、`aria-describedby` 指向正确 id。

---

## Bug #5 — 用户管理空状态文案错误

（**完全沿用原方案，无改动**。已校验 L1023-1037 现状、i18n.ts L141/L2872/L5631 `noUsers` 现状。）

### 修复步骤
1. i18n 三处 locale 加 `noUsersMatchFilter`: `'未找到符合条件的用户'` / `'No users match your filters'`。
2. 组件层：
   ```tsx
   const isFiltering = search.trim() !== '' || roleFilter !== '' || statusFilter !== '';
   ...
   <p>{isFiltering ? t.adminSettings.noUsersMatchFilter : t.adminSettings.noUsers}</p>
   ```
3. （可选 UX 增强）"清除筛选"按钮 — 若实施则 i18n 加 `clearFilters`。

### 测试建议
- Vitest：mock users=[], search='+filters=' → `noUsers`；search='xxx' → `noUsersMatchFilter`。

---

## Bug #6 — 添加用户对话框校验错误缺 a11y 语义

（**完全沿用原方案**，方案技术正确。）

### 修复步骤
1. 文件内本地组件 `FieldError({ id, message })` 渲染 `<p id role="alert">`。
2. 每个字段 `<input>` 加 `aria-invalid={!!errors.field}` + `aria-describedby={errors.field ? errorId : undefined}`（**条件 undefined 关键，避免悬空 id**）。
3. id 命名 `{dialog}-{field}-error` 防冲突。
4. `handleSubmit` validate 失败时 `document.getElementById(firstErrorId)?.focus()` 送回首个错误字段。
5. 全部应用到 CreateUserDialog（username/password/confirmPassword/email）、EditUserDialog（email）、ResetPasswordDialog（newPassword/confirmPassword）。

### 风险与注意事项
- **保留 validate-on-submit**，不要在 onChange 跑校验（否则 `role="alert"` 频繁播报）。

### 测试建议
- Vitest：mock submit invalid → `aria-invalid="true"`、`role="alert"`、`aria-describedby` 指向 `<p>` id。
- 手测 NVDA / Edge 朗读器。

---

## Bug #7 — Workflow 画布右键菜单缺 menu/menuitem ARIA 与键盘导航

（**主体沿用原方案**，补一个 canvas tabIndex 现状校验。）

### 现状（已校验）
- `WorkflowCanvas.tsx:508-519` 有 click-outside effect；**无 keydown 监听**。
- canvas 容器**无 `tabIndex`** —— 关闭菜单时 `canvasRef.current?.focus()` 程序化聚焦需先加 `tabIndex={-1}`。

### 修复步骤
1. **DOM 结构 + ARIA**：context menu `<div>` 加 `role="menu"`、`aria-label={t.workflowInterface.canvas.contextMenu.menuAriaLabel}`、`onKeyDown={handleMenuKeyDown}`；每个 button `role="menuitem"` + roving tabindex；分隔线 `<div role="separator">`。

2. **roving tabindex + 键盘导航**：
   - state `focusedItemIndex`, ref `menuItemsRef`, ref `menuRef`。
   - `useEffect(visible)` 首次显示 → focus 第一项。
   - `handleMenuKeyDown`: `ArrowDown/Up` (wrap)、`Home/End`、`Enter/Space` → click、`Esc` → 关闭。

3. **canvas tabIndex**：在 canvas 容器加 `tabIndex={-1}`，使关闭菜单时 `canvasRef.current?.focus()` 工作（**新增**：原方案提到但未明确该属性当前不存在）。

4. **菜单项数组化重构**留 follow-up（本次仅 ARIA + 键盘）。

5. **i18n 新增键** `t.workflowInterface.canvas.contextMenu.menuAriaLabel`: `'添加节点菜单'` / `'Add node menu'`。

### 风险与注意事项
- `role="menu"` 不需要触发按钮的 `aria-haspopup`（context menu 是单独 APG 模式）。
- 焦点交还：菜单关闭（点项 / Esc / 点外部）→ canvas focus。

### 测试建议
- Vitest：`getByRole('menu')`、`getAllByRole('menuitem')` 长度 11；ArrowDown 三次 + Enter → handler 触发；Esc → menu hidden。
- a11y：playwright + `@axe-core/playwright`，0 critical violations。

---

## 优先级与提交边界（保留原方案推荐）

```
P1（先做）：Bug #1（独立，最快收益）、Bug #2（注意 3 处 Executor + 软迁移）
P2：Bug #3（拆 commit）、Bug #4（含顺手 a11y）、Bug #5、Bug #6
P3：Bug #7
```

### 推荐提交边界
- **PR-1**: Bug #1 + Bug #5（最小、独立、立即可见）
- **PR-2**: Bug #6（a11y 单点）
- **PR-3**: Bug #2（含 Executor 3 处 + 软迁移 + ToArray/ResultsCombine 同型核查）
- **PR-4**: Bug #3 + Bug #4 + Bug #7（workflow editor 区集中）

或单一巨型 PR（项目历史风格倾向）：所有 7 个 bug 合并，commit 用 `[fix]` 前缀，按 bug 编号列出。

---

## 通用风险（保留 + 强化）

- **i18n.ts 7000+ 行**：TS interface 强制 3 locale 一致；漏键编译失败（防呆）。先改 interface，再补 zh-CN 与 en。
- **Vitest 覆盖**：所有新增/修改公开行为对应单测。
- **build 时 ESLint 跳过**：本地必跑 `npm run lint` + `npm run type-check`。
- **dev 服务器**：192.168.1.123:3010（per memory），通过 SFTP 同步代码后重启。
- **🆕 Bug #2 关联节点**：实施前必须 grep `ToArrayConfigPanel.tsx` / `ResultsCombineConfigPanel.tsx` 是否使用 `model`/`modelId`，以及 WorkflowCanvas 中对应 add 函数是否同样硬编码 `model: 'gpt-4'`。
- **🆕 Bug #2 LLM 调用契约**：实施前读 `src/lib/api/llm.ts` 与 `WorkflowExecutor` 调用点，确认下游 API 需要 `model` name 还是 `modelId`，决定是否保留 `config.model` 写入。

## 完成标准

- 7 个 bug 报告所述复现路径不再触发。
- 新增/修改文件均带对应 vitest 测试（含 Bug#1 route、Bug#2 Executor 3 处校验、Bug#3 i18n grep、Bug#4 modal 渲染、Bug#5 空态分支、Bug#6 a11y 属性、Bug#7 menu pattern）。
- `npm run type-check` 无错。
- `npm run lint` 无新增警告。
- dev 实地手测通过 P1 两个 bug 的复测；旧含 `model: 'gpt-4'` 工作流加载后节点显示"未配置"。
- 静态 grep `Save Configuration|System Prompt|Test & Debug|Data Format` 在 `src/components/workflow/` 下为空（除注释/type 字面量）。

---

## 审查日志（步骤 3 增补）

| 项目 | 原方案 | 审查发现 | 处置 |
|---|---|---|---|
| Bug#1 assignments 路由结构参照 | "保持完全一致" | 实际仅导出 DELETE | 改述为"同 `createPassthroughRoute` pattern，仅暴露 GET" |
| Bug#1 catch 修正 | 笼统 | 需明确仅改 catch 不动 success-false 分支 | 步骤改为精确行号修改 + 类型扩展提示 |
| Bug#2 Executor 校验 | 提及一处 | 实际 3 处（chat-llm / to-array / results-combine） | 列出全部行号；提示同步检查同型节点 |
| Bug#2 软迁移落点 | "WorkflowSidebar 或 WorkflowExecutor" | 模糊 | 改为入口 hydration（grep 确认起源） |
| Bug#2 ChatLLMNode.isConfigured | 提到收紧 | 必须收紧（temperature 默认 0.7 永真） | 标记为"必须执行"，提供精确 diff |
| Bug#3 FormatSelector | 仅 DisplayNames | 含 Descriptions + 同文件 6 个常量 | 范围扩到组件内常量改 hook 化 |
| Bug#3 ChatLLMConfigPanel L63 | 未列 | `'Failed to load models...'` 也是英文 | 加入 `t.workflowConfig.common.loadFailed` |
| Bug#3 NodeTestPanel/StartNode/TextInput | 未列 | 可能存在英文泄漏 | 加 grep 验证步骤 |
| Bug#4 nameRequired a11y | 未提 | 与 Bug#6 同型问题 | 顺手修复（仅一处零成本） |
| Bug#7 canvas tabIndex | 提到 focus 交还 | 当前容器无 tabIndex | 显式补 `tabIndex={-1}` 步骤 |
| 通用 | 无 | 关联检查与下游契约确认 | 通用风险新增 2 条 🆕 |
