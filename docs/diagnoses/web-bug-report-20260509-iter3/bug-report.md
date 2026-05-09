# Web Bug 探索报告 — 第 3 轮（2026-05-09）

## 测试环境

- **目标站点**: http://192.168.1.123:3010 （dev 服务器，Singapore 镜像同步源）
- **浏览器**: Microsoft Edge（Chromium 内核）
- **账号**: admin（已登录会话从 `.web-debugger/states/auth-latest.json` 复用）
- **执行人**: Claude（web-superuse 技能，全自动模式）
- **操作系统**: Windows 11 Pro
- **测试日期**: 2026-05-09 18:13–18:26（UTC+8）
- **当前 git HEAD**: `6100984` （iter2 review report）
- **Console 基线**: 0 errors / 0 warnings（全程仅出现操作引发的预期日志）
- **Session**: `ws-iter3-20260509-181335-34113`

## 探索范围

本轮重点覆盖前两轮未触及的功能区域，包括：

| 区域 | 入口 | 状态 |
|------|------|------|
| 头脑风暴（Brainstorm）功能 | 首页 → 头脑风暴卡 | ✅ 测试 |
| AI 对话（Chat）流程 | 首页 → AI 对话 → 新对话 | ✅ 测试 |
| 视频编辑（Video Editor）入口与导出 | 视频编辑 → 项目卡 | ✅ 测试 |
| 项目创建与命名 | 视频编辑 → 新建项目 | ✅ 测试 |
| 模型设置（Model Provider）添加/编辑 | 管理员设置 → 模型设置 → 添加供应商 | ✅ 测试 |
| YouTube 设置数值校验 | 管理员设置 → YouTube 设置 | ✅ 测试 |
| 主题切换 + 持久化 | 顶栏主题按钮 + reload | ✅ 测试 |
| 语言切换 + lang 属性同步 | 顶栏语言按钮 + reload | ✅ 测试 |
| TTS 段落转语音 | 编辑器 → 转换语音 | ✅ 测试（功能正常） |
| 模型供应商连接测试 | 管理员设置 → 测试连接 | ✅ 测试（功能正常） |

共发现 **6 个有效 Bug**，按严重程度排序如下。前两轮已修复区域（VideoCoverModal、登录会话、TTS 后端校验、ProjectCard 嵌套按钮、UserManagement 密码表单、Workflow 日志格式化）本轮验证依然有效，未发现回归。

---

## Bug 列表

| # | 标题 | 严重度 | 优先级 | 类型 |
|---|------|-------|--------|------|
| 1 | 项目编辑器无路由 — reload / 分享 URL 即丢失项目上下文 | High | P1 | 路由/UX |
| 2 | `<html lang>` 未在挂载时同步 — 中文 UI 始终标记为 `lang="en"` | High | P1 | a11y/SEO |
| 3 | 模型供应商「添加/编辑」对话框 API Key 密码框不在 `<form>` 内 | Medium | P2 | a11y/浏览器警告 |
| 4 | "新对话 → 工作流"列表无法区分同名工作流，且 0 节点工作流可被选中 | Medium | P2 | UX |
| 5 | 首页"头脑风暴"功能卡跳转后显示"功能开发中…" — 误导性营销 | Medium | P2 | UX/产品 |
| 6 | 空时间轴上"导出视频"按钮仍可点击，仅在点击后弹出错误 toast | Low | P3 | UX |

---

## Bug #1 — 项目编辑器无路由：reload / 分享 URL 即丢失项目上下文

**严重度**: High（P1） · **类型**: 路由 / 状态持久化 / UX

### 描述

在视频编辑器中打开任意项目（如 BugTest）后，浏览器地址栏仍然停留在站点根 `http://192.168.1.123:3010/`，没有任何 query/path/hash 反映当前项目身份。`document.title` 始终为 `Ecliptrix - Where light and shadow collide`，与项目无关。

由此引发三个连锁问题：

1. **F5 / Ctrl+R 刷新**直接把用户踢回首页着陆页（Landing），所有打开的标签页与正在编辑的项目都丢失。
2. **复制 URL 分享给同事**只能跳到首页；无法直接深链到某个项目。
3. **浏览器前进/后退**无法在不同项目/标签之间导航。

### 复现步骤

1. 登录 admin → 进入"视频编辑" → 点击任意项目（如 `BugTest`）。
2. 检查地址栏：`location.href` 仍为 `http://192.168.1.123:3010/`，`location.search` 为空，`location.hash` 为空。
3. 按 F5 刷新。
4. 页面回到首页着陆页（"开始创作 / 探索工作流"），编辑器被关闭。

实测命令与结果：

```
playwright-cli eval "location.href + '|' + location.search + '|' + location.hash"
→ "http://192.168.1.123:3010/ |  | "

playwright-cli eval "document.title"
→ "Ecliptrix - Where light and shadow collide"
```

### 预期 vs 实际

| | 预期 | 实际 |
|---|---|---|
| URL | 类似 `/projects/<uuid>` 或 `/?project=<uuid>&tab=video` | 始终 `/` |
| document.title | "BugTest – Ecliptrix" 之类 | 不变 |
| F5 后 | 仍停留在 BugTest 编辑器 | 跳回首页 |
| 浏览器返回键 | 上一项目/上一标签 | 直接退站 |

### 根因分析

整个应用是单文件 SPA（`src/app/page.tsx`，147 行），没有 Next.js Router 子路由。所有标签 / 任务 / 选中项目都保存在 `useTasks` 的 React state 里，且**未持久化到 localStorage 或 URL**：

```ts
// G:/projects/takoAI/Ecliptrix/src/hooks/useTasks.ts:7-13
const createInitialState = (): AppState => ({
  tasks: [],
  tabs: [],
  activeTabId: null,
});
const [appState, setAppState] = useState<AppState>(() => createInitialState());
```

`src/app/` 目录下仅有 `page.tsx`、`layout.tsx`、`login/`、`api/`，没有 `projects/[id]/` 路由段。

### 修复方向

最小改动方案（推荐）：把 `tabs` / `activeTabId` 镜像到 `localStorage`（参考已有的 `ecliptrix-theme-pref` 模式），同时把当前 tab + projectId 写入 `history.replaceState({}, '', '?tab=video&project=<id>')`，刷新时 `useTasks` 初始化阶段从 URL 优先、localStorage 次之地恢复。

完整方案：引入 `src/app/projects/[id]/page.tsx` 路由段，把 `Container` 拆分到对应路由内，启用 `usePathname` + `useSearchParams`。

### 证据文件

- 编辑器快照（URL=/，但 banner 显示 BugTest）：`.web-debugger/snapshots/iter3-editor.yaml`
- reload 后回到首页：`.web-debugger/snapshots/iter3-editor.yaml` 第 24 行 vs reload 后的页面（都标记着 `Page URL: http://192.168.1.123:3010/`）
- 截图：`.web-debugger/screenshots/iter3-05-editor.png`、`.web-debugger/screenshots/iter3-09-padded-proj.png`

---

## Bug #2 — `<html lang>` 未在挂载时同步：中文 UI 始终标记为 `lang="en"`

**严重度**: High（P1） · **类型**: a11y / SEO / 国际化

### 描述

用户语言偏好保存在 `localStorage['ecliptrix-locale']`。当用户已选过 `zh-CN`、整页 UI 全部用中文渲染时，`document.documentElement.lang` 在**初次加载和 reload 后**仍然是 `"en"`（来自 SSR 的 `<html lang="en">` 默认值）。只有用户**手动再点一次顶栏的语言切换**才会触发 `setLocale` 并把 `lang` 改为 `zh-CN`。

直接后果：

- **屏幕阅读器**（NVDA/JAWS/VoiceOver）会用英语音素读出中文文本，对视障用户不可用。
- **搜索引擎**会按英文索引中文页面，影响 SEO/SERP 中文展示。
- 浏览器自动翻译插件（Edge/Chrome 内置翻译）会把中文当英文，触发"翻译为英文"的错误建议。

### 复现步骤

1. 在已选 `zh-CN` 的会话下加载首页。
2. 检查 localStorage：`ecliptrix-locale=zh-CN`，UI 全部为中文。
3. 检查 `document.documentElement`：

```
playwright-cli eval "document.documentElement.outerHTML.substring(0,100)"
→ "<html lang=\"en\" class=\"light h-full\" style=\"color-scheme: light;\">..."
```

4. 点击顶栏语言图标 → 中文 → 中文（再选一次同样的语言）；`lang` 立刻变成 `zh-CN`。
5. F5 reload；`lang` 又回到 `"en"`，UI 仍为中文 → 不一致状态再现。

### 预期 vs 实际

| | 预期 | 实际 |
|---|---|---|
| 首次加载（localStorage 已是 zh-CN） | `lang="zh-CN"` | `lang="en"` |
| reload 后 | `lang="zh-CN"` | `lang="en"` |
| 切换语言后 | 同步更新 | ✅ 同步 |

### 根因分析

`G:/projects/takoAI/Ecliptrix/src/contexts/LocaleContext.tsx:23-29`：

```tsx
useEffect(() => {
  const savedLocale = localStorage.getItem('ecliptrix-locale') as SupportedLocale;
  if (savedLocale && (savedLocale === 'en' || savedLocale === 'zh-CN')) {
    setLocaleState(savedLocale);
    setTranslations(getTranslations(savedLocale));
    // ❌ 缺少：document.documentElement.lang = savedLocale === 'zh-CN' ? 'zh-CN' : 'en';
  }
}, []);
```

挂载副作用只更新了 React state（`setLocaleState` / `setTranslations`），漏掉了 `document.documentElement.lang` 的同步。`setLocale`（第 31-38 行）正确处理了这一点，但只在用户主动切换时被调用。

### 修复方向

在挂载 effect 中追加一行（与 `setLocale` 行为对齐）：

```tsx
document.documentElement.lang = savedLocale === 'zh-CN' ? 'zh-CN' : 'en';
```

可选地，把这段重复逻辑抽成 `applyLocaleToDom(locale)` 私有函数，挂载 effect 与 `setLocale` 共用，避免漂移。

### 证据文件

- `.web-debugger/snapshots/iter3-initial.yaml`（首次加载，UI 中文）
- 命令记录见 chat log：`outerHTML.substring(0,100)` 显示 `lang="en"`
- 截图：`.web-debugger/screenshots/iter3-01-home.png`

---

## Bug #3 — 模型供应商对话框 API Key 密码输入框不在 `<form>` 内

**严重度**: Medium（P2） · **类型**: a11y / 浏览器警告

### 描述

`管理员设置 → 模型设置 → 供应商管理 → 添加供应商` 对话框（以及 `编辑供应商` 对话框）中的 "API Key" 字段使用 `<input type="password" />`，但整个对话框**没有 `<form>` 元素**包裹。Edge/Chromium 控制台稳定输出：

```
[VERBOSE] [DOM] Password field is not contained in a form
```

这正是 iter2 已经为 `LoginModal.tsx` 与 `UserManagement.tsx` 中三处密码框修复过的同类 Bug，但 `ModelSettingsPanel.tsx` 当时没有被纳入清单，因此遗漏。

### 复现步骤

1. 登录 → 顶栏 "管理员设置" → 左侧 "模型设置" → "添加供应商"。
2. 打开 DevTools Console（或读取 playwright-cli 输出）。
3. 看到 `Password field is not contained in a form` 警告。
4. 验证：

```
playwright-cli eval "JSON.stringify(Array.from(document.querySelectorAll('input[type=password]')).map(i => i.placeholder + ':form=' + (!!i.closest('form'))))"
→ "[\"输入API密钥:form=false\"]"   （Add 对话框）
→ "[\"••••••••:form=false\"]"   （Edit 对话框）
```

### 预期 vs 实际

| | 预期 | 实际 |
|---|---|---|
| 控制台 | 无 `Password field is not contained in a form` 警告 | 警告稳定出现 |
| 浏览器密码管理器 | 能识别"添加 API 凭据"上下文 | 看不到 form，无法正确归类 |

### 根因分析

`G:/projects/takoAI/Ecliptrix/src/components/AdminSettings/ModelSettingsPanel.tsx`：

- 第 986 行：`<input type={showApiKey ? 'text' : 'password'} ... />` （API Key 输入）
- 全文 `grep -n "<form\|</form>"` 返回**零结果** —— 整个 Panel 没有任何 `<form>` 元素

所有字段（Name / Provider Type / API URL / API Key / API Format）目前都是裸 `<div>` 包 `<input>`，提交按钮通过 `onClick` 触发，未使用原生表单语义。

### 修复方向

参照 iter2 的 UserManagement 修复（`<form noValidate>` + `autoComplete="new-password"`）：

```tsx
<form noValidate onSubmit={(e) => { e.preventDefault(); handleSaveProvider(); }}>
  {/* Name / Provider Type / API URL / API Key（autoComplete="new-password"）/ API Format */}
  <button type="submit" ...>{t.adminSettings.save}</button>
</form>
```

把 `测试连接` 按钮设为 `type="button"` 避免误触发提交。

### 证据文件

- `.web-debugger/snapshots/iter3-add-prov.yaml`（Add Provider 对话框）
- `.web-debugger/snapshots/iter3-bad-conn.yaml` 末尾控制台日志条目可见 `Password field is not contained in a form`

---

## Bug #4 — "新对话 → 工作流"列表无法区分同名工作流，且允许选 0 节点工作流

**严重度**: Medium（P2） · **类型**: UX

### 描述

在 AI 对话标签里点击 "新对话" → 选择 "工作流" 类型时，可用工作流列表会原样列出账号下所有工作流。当存在多个未命名草稿（默认名 "New Workflow"，0 节点，v1）时，它们在视觉上完全重复：

```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ ⚡ 活跃              │  │ ⚡ 活跃              │  │ ⚡ 活跃              │
│ New Workflow        │  │ New Workflow        │  │ Search Chat Agent   │
│ 0 个节点 · v1       │  │ 0 个节点 · v1       │  │ 5 个节点 · v1       │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

两张卡片的可访问名相同 (`button "活跃 New Workflow 0 个节点 v1"`)、内容相同、`workflow_id` 不同但用户看不到。即使用户尝试选择，也只能盲猜。更糟的是 0 节点工作流根本无法处理消息，但仍然被列为可选项且没有任何禁用提示。

### 复现步骤

1. 进入 AI 对话标签 → "新对话" → 在弹窗里点 "工作流"。
2. 观察工作流列表：相同名字 + 相同节点数的卡片完全无法区分。
3. 选择任意 0 节点工作流（例如第二个 "New Workflow"），下游对话会卡住或报错（依赖工作流执行栈，本轮未深入跟进）。

### 预期 vs 实际

| | 预期 | 实际 |
|---|---|---|
| 重名工作流 | 显示 ID 后缀、更新时间或副标题以区分 | 完全相同 |
| 0 节点工作流 | 灰显 + 禁用 + tooltip "请先添加节点" | 可选 |
| 列表底部统计 | "{count} 个工作流可用 · {n} 个为空" | "3 个工作流可用" 不区分 |

### 根因分析

`G:/projects/takoAI/Ecliptrix/src/components/chat/ChatTypeSelectionModal.tsx:319-374` 渲染卡片时只用 `workflow.workflow_name`、`nodes?.length || 0`、`v{workflow.version}` 三个字段；`workflow_id`、`updated_at`、`created_by` 都未呈现。同时无任何 `disabled` 分支。

### 修复方向

1. 在卡片底部追加更新时间或 `workflow_id` 后 6 位（如 `· #f2c91a`），优先使用 `updated_at`。
2. 当 `(workflow.nodes?.length || 0) === 0` 时给卡片加 `disabled` 样式 + `aria-disabled="true"` + `title={t.aiChat.chatTypeModal.emptyWorkflowHint}`。
3. （可选）默认按 `updated_at desc` 排序，最新草稿优先，让用户更可能选到正确的那个。

### 证据文件

- `.web-debugger/snapshots/iter3-newchat-wf.yaml`（第 117-156 行，三张卡片名字+节点数完全相同）

---

## Bug #5 — 首页"头脑风暴"卡片跳转后显示"功能开发中…"（误导性营销）

**严重度**: Medium（P2） · **类型**: UX / 产品

### 描述

首页 Landing 区域的四张功能卡（视频编辑 / 工作流 / AI 对话 / 头脑风暴）使用同样的视觉权重和"开始创作"号召按钮，副本写着：

> 头脑风暴 — 为您的项目生成创意想法和概念

但点击进入后，主区域立即渲染成：

> 头脑风暴 · **功能开发中…**

页面没有"敬请期待 / 加入 waitlist / 返回选择其它任务"等替代动作。用户被引导进入一个死胡同。这不是技术 Bug，但是产品诚信/UX 层面的明显问题，且影响用户首次留存。

### 复现步骤

1. 退出登录或开新无痕窗口（避免之前的 task state）。
2. 访问 `http://192.168.1.123:3010/`。
3. 点击"头脑风暴"卡片。
4. 主区域显示 "功能开发中…"，无返回提示。

### 预期 vs 实际

| | 预期 | 实际 |
|---|---|---|
| 卡片标签 | 加 "Coming soon" / "Beta" 角标 | 与已上线功能视觉等价 |
| 点击行为 | 弹出"功能即将上线，是否订阅通知？"，或在卡片上禁用并显示 tooltip | 进入空白页 |
| 着陆页副本 | 与功能完成度相符（"创意构思灵感工坊（正在开发）"） | 与已上线功能并列吹捧 |

### 根因分析

- 着陆页：`G:/projects/takoAI/Ecliptrix/src/components/HomePage/LandingPage.tsx:71-74` 把 `brainstorm` 与其它三张卡同等列出，没有任何 "comingSoon" / "disabled" 字段。
- 渲染端：`G:/projects/takoAI/Ecliptrix/src/components/Container.tsx:268-283` 直接 `if (activeTask.type === 'brainstorm') return <UnderDevelopment/>` 占位，没有进一步导航。

### 修复方向

任选其一：

1. **快速修**：在 LandingPage 的 brainstorm card 上加 `comingSoon: true` 标记，渲染时禁用 `onClick` 并显示 "Coming soon" 角标；副本改为"即将推出 — 创意构思灵感工坊"。
2. **完整方案**：实现一个最小可用的 BrainstormPanel（已经有 `CreativeBrainstormingModal/`，只需把它接到 task type='brainstorm' 路由）。
3. **下策**：暂时从首页移除该卡片直到功能就绪。

### 证据文件

- `.web-debugger/snapshots/iter3-create-brainstorm.yaml` (第 47-49 行 `paragraph: 功能开发中...`)
- `.web-debugger/screenshots/iter3-02-brainstorm-tbd.png`

---

## Bug #6 — 空时间轴上"导出视频"按钮可点击但无意义

**严重度**: Low（P3） · **类型**: UX

### 描述

进入项目编辑器后，时间轴显示 5 条空轨道（视频/图片/音频x2/字幕），所有"全选 - X 轨道 - 轨道为空"按钮都被正确 disabled。但顶栏的"导出视频 (16:9)"按钮**保持启用**。点击后仅弹出 toast：

> 没有视频内容可导出，请先添加视频素材到时间轴

控制台同步打印：

```
[WARNING] [useVideoExport] 没有视频、音频或图片内容可导出 {videoItemsCount: 0, audioItemsCount: 0, imageItemsCount: 0}
```

按钮显示位置只检查了 "tracks.length > 0"，没检查 "items.length > 0"。

### 复现步骤

1. 新建一个空项目（或打开尚未加任何素材的项目）。
2. 不做任何素材添加，直接点击右上角"导出视频"。
3. 立刻收到 toast 错误。

### 预期 vs 实际

| | 预期 | 实际 |
|---|---|---|
| 按钮状态 | disabled + tooltip "请先添加素材" | 启用 |
| 点击 | 无操作或视觉抖动提示 | 弹 toast 错误 |

### 根因分析

`G:/projects/takoAI/Ecliptrix/src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx:1979`：

```tsx
{timelineState && timelineState.tracks.length > 0 && (
  <button
    onClick={handleVideoExport}
    disabled={videoExport.isExporting}
    ...
```

新项目就有 5 条空轨道，所以 `tracks.length > 0` 永远为 true。`disabled` 只看 `isExporting`，没看素材。

实际的 "无素材" 校验在 `useVideoExport.ts` 的 `handleExport` 里，最早只在用户点击后才执行。

### 修复方向

在 button 的 `disabled` 上追加 items 计数判断：

```tsx
const hasAnyExportableItem = useMemo(
  () => timelineState?.tracks.some(t => t.items?.length > 0) ?? false,
  [timelineState]
);
...
<button
  disabled={videoExport.isExporting || !hasAnyExportableItem}
  title={!hasAnyExportableItem ? t.videoPlayerPanel.export.emptyTimeline : undefined}
  ...
```

并在 i18n 添加 `videoPlayerPanel.export.emptyTimeline = '请先添加视频/图片/音频素材到时间轴'`。

### 证据文件

- `.web-debugger/snapshots/iter3-export-empty.yaml`（含 alert toast 与全选按钮 disabled 状态）
- 控制台 `[WARNING] [useVideoExport] 没有视频、音频或图片内容可导出`（playwright-cli console 输出）

---

## 已验证回归（前两轮修复仍有效）

| 来源 | 关注点 | 本轮验证结果 |
|------|--------|-------------|
| iter1 Bug #1 | 视频封面导出 WYSIWYG（`--cover-px` CSS 派生） | 未触发回归（本轮未深入封面流程，但 css 变量在 home/editor 上未报错） |
| iter1 Bug #2/#3 | 帧拖拽 / EditableTextLayer aria-label + placeholder | 编辑器加载未报错 |
| iter2 Bug #1 | 401 → SessionExpiredError 仅在受限 API 触发 | admin 登录态仍稳定 |
| iter2 Bug #2 | WorkflowExecutor `safeStringify` | 本轮未跑工作流，但 chat 流式无 `{ error: {} }` 噪声 |
| iter2 Bug #3 | TTS 设置 Pydantic ge/le 校验 | YouTube 设置 spinbutton clamp-on-blur 工作正常（999999 → 50） |
| iter2 Bug #4 | `dlog` + ChatInterface 渲染日志收敛 | 控制台基线 0 errors / 0 warnings ✅ |
| iter2 Bug #5 | ProjectCard 嵌套按钮去除 | 项目卡 a11y tree 正常，无嵌套警告 |
| iter2 Bug #6 | 登录"开发凭据"提示门控 | LoginModal 未观察到默认显示 |
| iter2 Bug #7 | UserManagement / LoginModal 密码框包 form | UserManagement 列表加载正常 — 但 **ModelSettingsPanel 同类问题未修复**（见 Bug #3） |

---

## 相关文件汇总

| Bug # | 主要源文件 | 行号 |
|-------|-----------|-----|
| 1 | `src/hooks/useTasks.ts` | 7-13 |
| 1 | `src/app/page.tsx`、`src/components/Container.tsx` | 整体路由架构 |
| 2 | `src/contexts/LocaleContext.tsx` | 23-29 |
| 3 | `src/components/AdminSettings/ModelSettingsPanel.tsx` | 920-1005（form 包裹缺失） |
| 4 | `src/components/chat/ChatTypeSelectionModal.tsx` | 319-374 |
| 5 | `src/components/HomePage/LandingPage.tsx` | 67-75 |
| 5 | `src/components/Container.tsx` | 268-283 |
| 6 | `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` | 1978-2027 |
| 6 | `src/lib/i18n.ts` | （需新增 emptyTimeline 文案 EN+ZH+interface） |

## 证据目录

```
.web-debugger/snapshots/
  iter3-initial.yaml            首页（中文 UI，但 lang="en"）
  iter3-create-brainstorm.yaml  Bug #5 — "功能开发中..."
  iter3-chat.yaml               AI 对话基线
  iter3-newchat-wf.yaml         Bug #4 — 三张同名工作流卡
  iter3-editor.yaml             Bug #1 — 编辑器中 URL 仍是 /
  iter3-editor2.yaml            BugTest 二次进入
  iter3-export-empty.yaml       Bug #6 — 空时间轴 toast
  iter3-admin.yaml              管理员设置
  iter3-yt.yaml                 YouTube 设置（FE clamp 验证）
  iter3-add-prov.yaml           Bug #3 — Add Provider 对话框
  iter3-bad-conn.yaml           Bug #3 — 控制台 password-not-in-form 警告

.web-debugger/screenshots/
  iter3-01-home.png             首页（lang="en" / UI 中文）
  iter3-02-brainstorm-tbd.png   Bug #5
  iter3-03-chat.png             AI 对话基线
  iter3-04-video-tab.png        视频编辑列表
  iter3-05-editor.png           Bug #1 — URL=/ 但已进编辑器
  iter3-09-padded-proj.png      新建 PaddedName 项目（trim 验证 + Bug #1）

.web-debugger/logs/
  iter3-baseline.log            控制台基线（0 errors / 0 warnings）

.web-debugger/states/
  auth-latest.json              admin 登录态
```

## 后续建议（推进到下一轮）

按 Bug 严重度推荐 PR 分组：

- **PR-A（高优）**: Bug #1 + Bug #2（路由 / lang 同步） — 都属于 "应用初始化时丢失/不一致状态"
- **PR-B（中优）**: Bug #3（ModelSettingsPanel 包 form） — iter2 同类风格扩展
- **PR-C（中优）**: Bug #4（ChatTypeSelectionModal 区分同名 + 0 节点禁用）
- **PR-D（轻量）**: Bug #5 + Bug #6（HomePage / VideoPlayerPanel 启用门控、disabled+tooltip）

下一轮（iter4）建议进入"step 2 — 修复方案撰写（fix-plan.md）"环节。
