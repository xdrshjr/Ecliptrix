# Iter8 Web Bug Report — 2026-05-09

## 探索环境

- **目标**: http://192.168.1.123:3010 (dev server)
- **浏览器**: Microsoft Edge (msedge), persistent profile
- **账号**: admin (管理员)
- **会话**: ws-iter8-20260509-223840-59118
- **Locale**: zh-CN (中文)
- **主题**: 暗色模式 (dark)

## 探索范围

本轮聚焦前 7 轮未深入触及的功能区域：

1. 项目重命名对话框 (Project rename)
2. 项目分类侧边栏过滤 + 新建分类对话框
3. 视频处理面板 (切气口/去除水印/视频帧提取 子标签)
4. 工作流编辑器右键菜单 + 节点配置侧栏 + 编辑工作流详情对话框 + 删除工作流确认
5. 管理员后台 — 用户管理列表搜索 + 添加用户对话框 + 模型设置(供应商管理/模型分配/高级设置)
6. 头脑风暴入口

## Bug 总览

| #  | 标题 | 模块 | 严重度 | 优先级 |
|----|------|------|--------|--------|
| 1  | 高级设置面板缺失 Next.js 代理导致 5×404 + 误导性"未配置"展示 | Admin/Model Settings | High | P1 |
| 2  | Workflow 聊天 LLM 节点默认 model "gpt-4" 与下拉选项不匹配，节点卡片与配置面板显示矛盾 | Workflow Editor | High | P1 |
| 3  | Workflow 节点配置侧栏 i18n 泄漏 — zh-CN 语言下显示英文 | Workflow Editor / i18n | Medium | P2 |
| 4  | Workflow "编辑工作流详情"对话框完全未本地化 | Workflow Editor / i18n | Medium | P2 |
| 5  | 用户管理搜索/筛选无结果时空状态文案错误（"暂无用户"误导） | Admin/User Management | Medium | P2 |
| 6  | 添加用户对话框校验错误缺乏 a11y 语义（无 role=alert / aria-describedby） | Admin/User Management | Medium | P2 |
| 7  | Workflow 画布右键菜单缺乏 menu/menuitem ARIA 语义 | Workflow Editor / a11y | Low-Medium | P3 |

---

## Bug #1 — 高级设置缺失 Next.js 代理路由导致 5×404 + 误导性展示

- **严重度**: High
- **优先级**: P1
- **位置**: 管理员设置 → 模型设置 → 高级设置 (`ModelSettingsPanel.tsx`)
- **环境**: msedge dev, admin

### 详细描述

进入"管理员设置 → 模型设置 → 高级设置"标签时，"当前生效配置"表格调用 `GET /api/model-settings/resolve/{chat,fast,video_cut,vision,coding}` 来填充每个功能类型的实际生效模型/URL/来源。但 Next.js 前端**根本没有该代理路由**：

```
src/app/api/model-settings/
├── providers/...
├── assignments/...
├── fetch-models/...
├── test-connection/...
└── (resolve/ 目录不存在)
```

虽然后端 FastAPI 有 `/api/model-settings/resolve/{ft}` 端点（被 `src/app/api/chat/route.ts` 服务端调用），浏览器侧通过 `http.get('/api/model-settings/resolve/chat')` 命中 Next.js 自身路由 → 404。

源码位置：`src/components/AdminSettings/ModelSettingsPanel.tsx:664`

```ts
const data = await http.get<ResolveConfigResponse>(`/api/model-settings/resolve/${ft}`);
```

每次切换到"高级设置"标签会触发 5 次 404，并被 `catch` 静默吞掉，结果"当前生效配置"表格的所有 5 行均渲染为「未配置 / - / 未配置」，**误导管理员认为系统没有任何配置**——而事实上系统是基于环境变量正常运行的（聊天功能可用）。

### 复现步骤

1. 以 admin 登录 dev (http://192.168.1.123:3010)
2. 点击右上角"管理员设置"
3. 左侧导航点击"模型设置"
4. 在中部子标签栏点击"高级设置"
5. 打开 DevTools Network 或 Console

### 预期结果

- 不应产生 404
- "当前生效配置"表格应反映实际生效的环境变量回退（聊天=`LLM_MODEL` 值，等等）

### 实际结果

- 控制台立即出现 5 条 `Failed to load resource: 404`：
  ```
  GET /api/model-settings/resolve/chat → 404
  GET /api/model-settings/resolve/fast → 404
  GET /api/model-settings/resolve/video_cut → 404
  GET /api/model-settings/resolve/vision → 404
  GET /api/model-settings/resolve/coding → 404
  ```
- 表格 5 行全部显示「未配置 / - / 未配置」
- 与"环境变量回退参考"表格的内容不一致（参考表显示存在 `LLM_API_URL/KEY/MODEL` 等变量）

### 证据

- 截图：(略 — DevTools 控制台 5 条 404)
- 快照：`.web-debugger/snapshots/advanced.yaml:154-194`

---

## Bug #2 — Workflow 聊天 LLM 节点默认 model 与下拉选项不匹配

- **严重度**: High
- **优先级**: P1
- **位置**: 工作流编辑器画布 → 添加聊天 LLM 节点
- **环境**: msedge dev, admin

### 详细描述

在工作流画布右键添加"聊天 LLM"节点时，`WorkflowCanvas.tsx:253` 把节点 `config.model` 硬编码为字符串 `'gpt-4'`：

```ts
config: {
  model: 'gpt-4',
  temperature: 0.7,
  maxTokens: 2000,
},
```

但 Model 下拉框的可选项来源于 `AGENT_LLM_API_XX_*` 配置（实际显示为 `glm-5-turbo (Agent 01)`、`glm-5-turbo (Agent 02)` 等）。`'gpt-4'` 并不在选项列表中，浏览器把 `<select>` 的 selected 回退到第一个 option，但 React 的 state 仍是 `'gpt-4'`。

结果：
- **画布上的节点卡片**（`ChatLLMNode.tsx:55`）通过 `{config?.model || ...}` 显示 "模型: gpt-4"
- **配置面板的下拉框**显示 "glm-5-turbo (Agent 01)"（首项）
- 两者**严重不一致**，用户根本不知道实际会用哪个模型
- 若用户**未触碰下拉**就点击 "Save Configuration"，保存的仍是 `'gpt-4'`，运行时传给后端会失败

源码位置：
- `src/components/workflow/WorkflowCanvas.tsx:253`
- `src/components/workflow/nodes/ChatLLMNode.tsx:55`
- `src/components/workflow/ChatLLMConfigPanel.tsx`（下拉选项来自 `AGENT_LLM_API_XX_*`）

### 复现步骤

1. 进入"工作流"标签
2. 选择或新建一个工作流，进入"工作流界面"
3. 在画布空白处右键
4. 点击"添加聊天 LLM"
5. 观察新节点卡片显示 "模型: gpt-4"
6. 双击节点打开配置侧栏，查看 Model 下拉

### 预期结果

- 新节点的 `config.model` 应初始化为下拉框的**第一个**有效 Agent 模型（与 UI 显示保持一致），或为空（强制用户选择）并将节点卡片显示为 "未设置 / 双击以配置"
- 节点卡片与配置面板的模型显示应始终一致

### 实际结果

- 节点卡片：`模型: gpt-4`
- 配置面板下拉：`glm-5-turbo (Agent 01)` (因为 `'gpt-4'` 不在选项中而 fallback)
- 用户的视觉认知与实际配置矛盾
- WorkflowExecutor.ts:639 的检查只验证 `config.model` 非空，无法检测到 `'gpt-4'` 是无效引用

### 证据

- 快照：`.web-debugger/snapshots/llm-config2.yaml:114-131,210-214`

---

## Bug #3 — Workflow 节点配置侧栏 i18n 泄漏（zh-CN 下显示英文）

- **严重度**: Medium
- **优先级**: P2
- **位置**: 工作流编辑器 → 双击任一节点打开配置侧栏

### 详细描述

虽然顶层导航/侧栏/画布右键菜单都使用本地化字符串，但所有节点的配置侧栏（`ChatLLMConfigPanel.tsx`、`VolcanoTTSConfigPanel.tsx`、`ToArrayConfigPanel.tsx`、`ResultsCombineConfigPanel.tsx`、`PexelsVideoSearchConfigPanel.tsx`、`TavilySearchConfigPanel.tsx`、`AIVideoGenerateConfigPanel.tsx`、`VideoExportConfigPanel.tsx` 共 8 个面板）以及 `nodes/ToArrayNode.tsx`、`nodes/ResultsCombineNode.tsx` 都包含**硬编码英文文案**。

聊天 LLM 配置面板观察到的英文文案：
- `Test & Debug` / `Test this node independently`
- `Data Format` / `Input Format` / `Output Format`
- `Plain Text` / `JSON Object` / `Array`
- `JSON object with key-value pairs`
- `System Prompt`
- `Enter system prompt for the Chat LLM...`
- `Define the behavior and context for the LLM conversation`
- `Model`
- `Select the LLM model to use for this node`
- `Temperature` / `Max Tokens`
- `0.0 (Precise)` / `2.0 (Creative)`
- `Controls randomness: lower values make output more focused and deterministic`
- `Maximum length of the generated response`
- `Cancel` / `Save Configuration`
- `Close panel`

源码确认：`src/components/workflow/ChatLLMConfigPanel.tsx:142, 165, 292`（hardcoded `<h3>Data Format</h3>`、`System Prompt`、`Save Configuration`）。

### 复现步骤

1. 切换 locale 为中文（默认）
2. 进入"工作流" → "工作流界面"
3. 右键画布 → 添加聊天 LLM
4. 双击新节点

### 预期结果

- 配置面板所有可见文案均使用 `t.workflow.*` 本地化字符串
- 中文界面下不应出现 "Test & Debug"、"System Prompt"、"Save Configuration" 等英文

### 实际结果

- 配置面板完全英文，与外层中文界面割裂

### 证据

- 快照：`.web-debugger/snapshots/llm-config2.yaml:155-235`

---

## Bug #4 — Workflow "编辑工作流详情"对话框完全未本地化

- **严重度**: Medium
- **优先级**: P2
- **位置**: 工作流列表 → 工作流卡片悬停 → 点击编辑图标 ("编辑工作流详情")

### 详细描述

工作流卡片右上角的"编辑工作流详情"按钮（其 aria-label 是中文）打开的对话框内部完全是英文：

- `Edit Workflow`（标题）
- `Modify workflow details and view nodes`（副标题）
- `Close modal`
- `Workflow Name *` / `Enter workflow name`
- `Description` / `Enter workflow description (optional)`
- `Workflow Nodes` / `0 nodes`
- `No nodes in this workflow yet` / `Add nodes in the workflow canvas`
- `No changes`（按钮态）
- `Cancel` / `Save Changes`

并且新创建的工作流也保留了创建时 locale 下的默认名（中文创建时为 "新工作流"，但本对话框打开时仍以英文 placeholder 显示）。

### 复现步骤

1. 切换到 zh-CN
2. "工作流"标签
3. 鼠标悬停任意工作流卡片
4. 点击"编辑工作流详情"图标

### 预期结果

- 对话框完全本地化为中文

### 实际结果

- 对话框完全英文

### 证据

- 快照：`.web-debugger/snapshots/edit-wf-detail.yaml:144-172`

---

## Bug #5 — 用户管理搜索/筛选无结果时空状态文案错误

- **严重度**: Medium
- **优先级**: P2
- **位置**: 管理员设置 → 用户管理

### 详细描述

在"用户管理"页面：
- 系统中存在 2 个用户（admin + 1 普通用户）
- 在搜索框输入不匹配的字符串（如 `xyz_nonexistent_user`）后，表格区域被替换为空状态：

```
[icon]
暂无用户
```

"暂无用户"的语义是 **"系统当前没有任何用户"**。但事实是只是搜索/筛选无匹配结果，仍有用户存在。这会误导管理员，特别是在用户量大时（"我筛选了一下，怎么所有用户都没了？"）。

i18n 同一字符串被同时用于"列表整体为空"和"筛选无结果"两个语义场景。

### 复现步骤

1. 管理员设置 → 用户管理（确保系统中至少有 2 个用户）
2. 在"搜索用户..."输入框输入一个不存在的用户名 `qwerty_nonsense`
3. 观察表格区域的空状态文案

### 预期结果

- 当筛选无结果时，文案应为 "无匹配用户" / "搜索无结果" / "未找到符合条件的用户"
- 当列表本身为空（系统真无用户）时，文案才是 "暂无用户"

### 实际结果

- 不论是真无用户还是筛选无结果，都显示 "暂无用户"

### 证据

- 快照：`.web-debugger/snapshots/user-search-empty.yaml:152`

---

## Bug #6 — 添加用户对话框校验错误缺乏 a11y 语义

- **严重度**: Medium
- **优先级**: P2
- **位置**: 管理员设置 → 用户管理 → 添加用户

### 详细描述

"添加用户"对话框对各字段做了客户端校验，违反规则时在字段下方插入红色提示段落。本轮观察到的提示包括：

- "用户名至少需要3个字符"
- "密码至少需要6个字符"
- "两次输入的密码不一致"
- "邮箱格式不正确"

通过 `eval` 直接读取 DOM：

```
{text:'用户名至少需要3个字符', role:null, id:'', tag:'P'}
{text:'密码至少需要6个字符',  role:null, id:'', tag:'P'}
{text:'两次输入的密码不一致', role:null, id:'', tag:'P'}
{text:'邮箱格式不正确',        role:null, id:'', tag:'P'}
```

这些 `<p>` 元素：
- 没有 `role="alert"` / `aria-live="polite|assertive"`
- 没有 `id`
- 关联的 `<input>` 没有 `aria-describedby` 指向它们
- 失败的输入框也没有 `aria-invalid="true"`

屏幕阅读器在错误出现时不会播报，残障用户无法感知校验失败。

### 复现步骤

1. 管理员设置 → 用户管理 → 点击"添加用户"
2. 填写：用户名 `ab`，密码 `123`，确认密码 `456`，邮箱 `not-an-email`
3. 点击"创建用户"
4. 用 DevTools 检查错误提示元素

### 预期结果

- 校验错误段落带 `role="alert"` 或 `aria-live="polite"`
- 输入框 `aria-invalid="true"` 并通过 `aria-describedby` 指向错误段落

### 实际结果

- 错误段落是普通 `<p>`，对屏幕阅读器透明

### 证据

- DOM eval 输出（见上）
- 快照：`.web-debugger/snapshots/user-validation.yaml:217-230`

---

## Bug #7 — Workflow 画布右键菜单缺乏 menu/menuitem ARIA 语义

- **严重度**: Low-Medium
- **优先级**: P3
- **位置**: 工作流编辑器 → 画布右键

### 详细描述

在工作流画布上右键弹出的"添加节点"菜单，包含 11 个项目：
"添加开始节点", "添加结束节点", "添加聊天 LLM", "添加文本输入", "添加 Pexels 视频搜索", "添加 Tavily 搜索", "添加火山 TTS", "添加转换为数组", "添加结果合并", "添加 AI 视频生成", "添加视频导出"

但在 a11y 树中所有项目都是普通 `<button>`，外层容器是普通 `<generic>` 而非：
- `role="menu"` 容器
- `role="menuitem"` 子项
- 缺少键盘导航（上/下箭头切换项，Esc 关闭）

WCAG ARIA Authoring Practices 对 context menu 的标准结构是 `menu`/`menuitem`，并支持方向键。当前实现只能用鼠标，不友好键盘用户与屏幕阅读器。

### 复现步骤

1. 进入工作流"工作流界面"
2. 在空白画布右键
3. 用 DevTools 检查弹出层结构 / 用键盘 Tab + 上下方向键尝试导航

### 预期结果

- 容器 `role="menu"`，每项 `role="menuitem"`
- 支持方向键 + Enter 选择 + Esc 关闭

### 实际结果

- 全部是裸 `<button>`，无菜单 ARIA 角色
- 仅 Tab 顺序遍历，方向键无效

### 证据

- 快照：`.web-debugger/snapshots/canvas-rclick3.yaml:108-143`

---

## 探索过程附记 — 不计入正式 Bug 但值得跟踪

- **项目重命名长度截断行为不透明**：在重命名对话框输入 500 个 'A' 字符（绕过 maxLength=200 的方式：粘贴/编程赋值），保存后实际只持久化 200 字符；服务端在直接 PUT 500 字符时会返回 422。这意味着 maxLength 在某些粘贴路径下被浏览器截断而 UI 不给反馈。重要性较低但可视为 UX 改进点。
- **新建分类**同样行为：粘贴 150 字符（max=100），落库 100 字符，无截断提示。
- **删除工作流**只展示了内联"确认删除"按钮，无危险操作的明显视觉警告（节点会一并丢失），但仍有一次确认，因此非阻塞。
- **头脑风暴 / 系统设置**仍是 "即将推出"占位（见 iter4 报告），本轮未重复。
- **新建会话/新建工作流的初始名"New Workflow"**始终是英文，即使 locale=zh-CN（前两个工作流名为 "New Workflow"，本轮新建的为 "新工作流"——不同时期创建的项目混合，本身是预期）。

## 总结

本轮在前 7 轮未深入触及的领域（管理员高级设置、工作流节点配置、用户管理校验）发现 **7 个有效 Bug**，覆盖：
- **后端集成断裂**（#1 缺路由）
- **配置一致性**（#2 model 与下拉脱节）
- **i18n 完整性**（#3、#4）
- **UX 文案准确性**（#5）
- **a11y**（#6、#7）

最严重的是 **#1（高级设置 5×404 + 误导信息）**和 **#2（节点 model 默认值与下拉项不匹配）**——两者都属于 P1，均为后续步骤优先修复的对象。
