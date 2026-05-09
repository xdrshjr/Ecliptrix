# Iter9 Bug Report — Web 探索性测试

> 探索时间：2026-05-09 23:32 ~ 23:42 (本地时间)
> 浏览器：Microsoft Edge (msedge persistent profile)
> Dev URL：http://192.168.1.123:3010
> 账号：admin（持久化 session 已恢复，但当前 backend 不可达，因此进入未登录状态进行探索）
> 注：本轮聚焦于"登录入口 + 登录模态 + 首页 Hero/Feature 卡片 + 顶部任务栏（Vertical/Taskbar）"——这些区域在前 8 轮中未做系统的键盘可达性 / ARIA 语义 / 错误日志噪声审查。

---

## 探索范围与方法

1. 持久化登录态被恢复但 backend 502，因此 AuthContext 自动登出，用户回到未登录态。借此机会对**未登录态的入口 UX**进行聚焦测试（前几轮多在已登录态测试）。
2. 系统性测试登录模态 (LoginModal) 的弹出、键盘焦点、Escape、Tab、提交校验与日志输出。
3. 系统性测试 Landing Page（`LandingPage.tsx`）的 Hero CTA + 4 张 Feature 卡片（Video Editing / WorkFlow / AI Chat / Brainstorming）的键盘可达性与 a11y 角色。
4. 系统性测试 VerticalTaskbar（侧栏任务标签栏）的标签项与"关闭标签"按钮的键盘可达性 / 可访问名称。
5. 系统性测试在 backend 不可达时各组件控制台日志的噪声情况。
6. 切换语言 (英 / 中)、切换主题 (深 / 浅) 后观察 i18n 泄漏与文案错位。

证据保存路径：
- 截图：`.web-debugger/screenshots/iter9-*.png`
- 快照：`.web-debugger/snapshots/iter9-*.yaml`
- Console：`.web-debugger/logs/console-baseline-iter9.log`

---

## Bug 总览

| # | 标题 | 严重程度 | 优先级 | 文件:行 |
|---|---|---|---|---|
| 1 | LoginModal 缺失 `role="dialog"` / `aria-modal` / `aria-labelledby` 等核心对话框语义 | High | P1 | `src/components/LoginModal.tsx:99-118` |
| 2 | LoginModal 打开后焦点不进入对话框；Tab 焦点泄漏到背景元素（无 focus trap） | High | P1 | `src/components/LoginModal.tsx:13-44` |
| 3 | Landing Page 三张可点击 Feature 卡片是 `<div onClick>`，不可键盘聚焦 / 激活 | High | P1 | `src/components/HomePage/LandingPage.tsx:135-145` |
| 4 | 任务栏点击触发 toast `请先登录后再使用任务功能` 硬编码中文，英文 locale 下泄漏 | Medium | P2 | `src/components/Taskbar.tsx:133`, `src/components/VerticalTaskbar.tsx:136` |
| 5 | LoginModal 表单校验错误段落是普通 `<p>`，缺少 `role="alert"` / `aria-live`，AT 不会朗读 | Medium | P2 | `src/components/LoginModal.tsx:165-169` |
| 6 | VerticalTaskbar "关闭标签 (X)" 按钮无可访问名（仅 SVG icon） | Medium | P2 | `src/components/VerticalTaskbar.tsx:172-179` |
| 7 | VerticalTaskbar 标签整体使用 `<div onClick>`，键盘用户无法切换标签 | Medium | P2 | `src/components/VerticalTaskbar.tsx:161-183` |
| 8 | LoginModal 在生产构建中向控制台输出 3 处 `console.warn/error`（含用户名、时间戳） | Low–Medium | P3 | `src/components/LoginModal.tsx:56, 75, 85` |
| 9 | AuthContext 在 backend 不可达时 `console.error` 全栈打印，每轮校验/挂载都重复输出 | Low | P3 | `src/contexts/AuthContext.tsx:145` |

---

## Bug #1：LoginModal 缺失对话框 ARIA 语义

### 详细描述
点击 Header 的 "Login / Register" 按钮（或在未登录态点击任意 CTA / 任务卡片），弹出 LoginModal。但其根容器 `<div className="fixed inset-0 z-[9999] ...">` **不带 `role="dialog"` / `aria-modal="true"` / `aria-labelledby`**，关闭按钮 (`<button onClick={onClose}>` 内仅一个 SVG) 也**无 `aria-label`**。

辅助技术（屏幕阅读器、语音控制）无法识别这是一个模态对话框：
- 没有"对话框打开"的语义提示
- 标题 `<h2>欢迎回来</h2>` 没有被 `aria-labelledby="..."` 关联到容器
- 关闭按钮被读作"按钮"，没有"关闭"或"close"语义

### 复现步骤
1. 打开 http://192.168.1.123:3010/ （未登录态）
2. 点击右上角 "Login / Register"
3. 用 Playwright 抓 a11y 快照 / 用屏幕阅读器试听
4. 观察容器为 `generic` 而非 `dialog`，关闭按钮为 `button` 但无名字

### 预期 vs 实际
- **预期**：根容器 `role="dialog"` + `aria-modal="true"` + `aria-labelledby={id of welcomeBack heading}`；关闭按钮 `aria-label={t.common.close}`。
- **实际**：根容器无任何 dialog 语义；关闭按钮无可访问名。

### 证据
- a11y 快照：`.web-debugger/snapshots/iter9-login-modal-20260509-234030.yaml` —— 搜索 `[ref=e80]` (modal root) → `generic` not `dialog`，`button [ref=e81]` (close button) 仅有 `img` 子节点无文本
- 源码：`src/components/LoginModal.tsx:100-117`

### 修复方向（供 Subtask #1 参考）
- 容器加 `role="dialog"` `aria-modal="true"` `aria-labelledby="login-modal-title"`，h2 加 `id="login-modal-title"`。
- 关闭按钮加 `aria-label={t.common.close ?? 'Close'}` 与 `type="button"`。
- 同步加 `<div role="presentation">` 给 backdrop，避免 backdrop click 被 AT 解释为可激活。

---

## Bug #2：LoginModal 打开后焦点不进入对话框；无 focus trap

### 详细描述
LoginModal 打开时**不会自动把焦点移入对话框内**（例如用户名输入框）。焦点保留在触发按钮上。更严重的是，按 Tab 键焦点会**跳到对话框背后的元素**（实测点击 "Start Creating" 触发 modal 后按 Tab，焦点直接落在背后的 `Explore Workflows` 按钮上），完全没有 focus trap。

这意味着：
- 视障 / 键盘用户打开 modal 后无法直接输入凭据
- 键盘焦点可"穿透"模态层去操作背后内容（例如切换语言、点击 CTA）—— 既是 a11y 缺陷也是潜在的 UX bug（在 modal 期间触发其它路由跳转）

### 复现步骤
1. http://192.168.1.123:3010/ → 点击 "Start Creating" 触发 LoginModal
2. `eval("document.activeElement.textContent")` → `"Start Creating"`（焦点没进入 modal）
3. 按 Tab → `eval` 再查 → `"Explore Workflows"`（焦点跑到 modal 背后）

### 预期 vs 实际
- **预期**：modal 打开时调用 `usernameRef.current?.focus()`；Tab/Shift+Tab 在 modal 内的焦点链中循环（focus trap）。
- **实际**：焦点既不进入 modal，也不被 trap，可逃逸到背景。

### 证据
- 控制台输出（见上文 eval 结果）
- 源码：`src/components/LoginModal.tsx:13-44` —— 没有 `useEffect(() => { ref.focus() }, [isOpen])`，也没有引入 focus-trap 工具

### 修复方向
- `useRef<HTMLInputElement>` 绑定 username `<input>`，`useEffect(() => { if (isOpen) usernameRef.current?.focus(); }, [isOpen]);`
- focus trap：可手写一个 keydown 拦截器（监听 Tab，把焦点限制在 modal 容器内首/尾元素），或抽离到一个 `useFocusTrap(ref, isOpen)` Hook 复用到其它 modal。
- 关闭后将焦点归还触发元素。

---

## Bug #3：Landing Page 三张可点击 Feature 卡片不可键盘聚焦/激活

### 详细描述
首页 (`LandingPage.tsx`) Features 区有 4 张卡片：Video Editing / WorkFlow / AI Chat / Brainstorming。其中前 3 张是激活态卡片，渲染为：

```tsx
<div
  className="landing-feature-card relative ..."
  onClick={() => { if (...) return; handleGetStarted(feature.type); }}
  // role / tabIndex / aria-disabled 仅在 isComingSoon === true 时才设置
>
```

非"即将推出"卡片**完全没有 `role`、没有 `tabIndex`、没有键盘事件**。键盘 / AT 用户：
- Tab 跳过这 3 张卡片
- 即使聚焦到也按 Enter/Space 不会触发 onClick
- 只有 Brainstorming（disabled "Coming Soon"）反倒因为 `role="button"` 而被 AT 识别为按钮

逻辑反了：**可激活的反而没有 button 语义；不可激活的才是 button**。

### 复现步骤
1. http://192.168.1.123:3010/ （未登录或已登录均可）
2. a11y 快照查看：3 张 active 卡片为 `generic [cursor=pointer]`，Brainstorming 为 `button [disabled]`
3. 用 Tab 键从 "Explore Workflows" 出发，下一焦点直接跳到背后的 footer 链接 / Brainstorming，跳过 Video / WorkFlow / AI Chat

### 预期 vs 实际
- **预期**：3 张 active 卡片渲染为 `<button>` 或 `<div role="button" tabIndex={0}>` + onKeyDown(Enter/Space → handleGetStarted)，并加 `aria-label={feature.title}`。
- **实际**：仅 disabled 卡片有 button 语义，active 卡片完全不可键盘操作。

### 证据
- a11y 快照（首页根状态）：`generic [ref=e42]` (Video Editing), `[ref=e48]` (WorkFlow), `[ref=e54]` (AI Chat) 均为 `generic [cursor=pointer]`，无 button role
- `button "Brainstorming ... Coming Soon" [disabled] [ref=e60]` （唯一的 button）
- 源码：`src/components/HomePage/LandingPage.tsx:135-145`

### 修复方向
- 把 `<div>` 换成 `<button type="button">`（或 `<div role="button" tabIndex={0} onKeyDown={...}>`），统一处理 Enter/Space。
- 把 `role` / `aria-disabled` / `tabIndex` 三组属性都依据 `isComingSoon` & `isLoadingDisabled` 显式输出。
- `aria-label` 使用 `${feature.title} — ${feature.description}` 改善 AT 体验。

---

## Bug #4：任务栏未登录提示 toast 文案硬编码中文

### 详细描述
当未登录用户点击侧栏 Vertical/Taskbar 上的某个任务标签（例如已存在的 "AI 对话" / "AI Chat" 标签），代码会调用 `notification.showWarning('请先登录后再使用任务功能', 4000)`。该字符串**直接是中文字面量**，未走 `t.*` 国际化字典。在 LocaleContext 切换为 English 后，UI 整体已为英文，但这个 toast 仍弹出 `请先登录后再使用任务功能`。

### 复现步骤
1. 切换 Header → 语言为 🇺🇸 English（整页改为英文）
2. 点击侧栏任意已有任务标签（例如 "AI Chat"）
3. 屏幕底部 toast 显示中文 `请先登录后再使用任务功能`

### 预期 vs 实际
- **预期**：英文 locale 下 toast 显示 e.g. `Please log in before using task features`。
- **实际**：始终显示中文 `请先登录后再使用任务功能`。

### 证据
- a11y 快照：`alert [ref=e169]: ... generic [ref=e173]: 请先登录后再使用任务功能` —— 在 UI 全英文上下文中
- 源码：`src/components/Taskbar.tsx:133` 与 `src/components/VerticalTaskbar.tsx:136` 都硬编码 `'请先登录后再使用任务功能'`

### 修复方向
- `src/lib/i18n.ts` 在 `auth` 命名空间加 `loginRequiredForTasks: { 'zh-CN': '请先登录后再使用任务功能', en: 'Please sign in to use task features' }`。
- 两个文件改成 `notification.showWarning(t.auth.loginRequiredForTasks, 4000)`。

---

## Bug #5：LoginModal 表单错误段落不会被 AT 朗读

### 详细描述
当用户提交空表单，组件设置 `error` state 并渲染：
```tsx
{error && (
  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
    <p className="text-sm text-destructive">{error}</p>
  </div>
)}
```
该容器是普通 `<div>`/`<p>`，**没有 `role="alert"`、`aria-live="assertive"` / `aria-live="polite"`**。屏幕阅读器在错误出现时不会主动朗读"用户名和密码为必填项"，用户只能依靠目视感知错误。

### 复现步骤
1. 打开 LoginModal，username 与 password 都留空
2. 点 "Login" / "登录"
3. 红色提示 `用户名和密码为必填项 / Username and password are required` 出现，但屏幕阅读器静默

### 预期 vs 实际
- **预期**：错误容器 `role="alert"`（隐式 `aria-live="assertive"`，且 `aria-atomic="true"`），AT 立即朗读。
- **实际**：错误容器无任何 live region 语义。

### 证据
- a11y 快照（提交后）：`paragraph [ref=e113]: 用户名和密码为必填项` —— 仅是普通 paragraph
- 源码：`src/components/LoginModal.tsx:165-169`

### 修复方向
- `<div role="alert" className="...">` 即可让浏览器 AT 自动朗读；进一步可加 `aria-atomic="true"`。
- 同时考虑把 username 和 password 的 `<input>` 与该错误关联：`aria-describedby="login-error"` 或 `aria-invalid={!!error}`。

---

## Bug #6：VerticalTaskbar 关闭标签按钮无可访问名

### 详细描述
侧栏 VerticalTaskbar 的每个任务标签都带一个右上角"关闭" (X) 按钮：
```tsx
<button onClick={(e) => handleTabClose(e, tab.id)} className="tab-close">
  <svg .../>
</button>
```
**没有 `aria-label`、`title`、可见文本**。屏幕阅读器只能朗读为"按钮"，无法说明它的作用，也无法区分同一面板上的多个标签的关闭按钮。

### 复现步骤
1. 在已登录态创建几个任务标签
2. 用 Tab 键尝试聚焦 X 按钮（如果可达，见 Bug #7），AT 朗读为 "button"
3. 或在快照里观察 `button [ref=e29]: img [ref=e30]` 的结构（无文本子节点）

### 预期 vs 实际
- **预期**：`<button aria-label={t.common.closeTab.replace('{title}', tab.title)} title={...}>`，AT 朗读为 "Close tab AI 对话"。
- **实际**：纯图标按钮，无可访问名。

### 证据
- a11y 快照：`button [ref=e29]:\n  img [ref=e30]`（仅 img 子节点）
- 源码：`src/components/VerticalTaskbar.tsx:172-179`

### 修复方向
- 加 `aria-label` 和 `title`，并使用 `t.common.closeTab` 模板。
- 给 SVG 加 `aria-hidden="true"`，避免 AT 重复朗读。

---

## Bug #7：VerticalTaskbar 标签使用 div+onClick 不支持键盘切换

### 详细描述
每个任务标签的容器是：
```tsx
<div
  key={tab.id}
  className={`taskbar-tab ${tab.isActive ? 'active' : ''}`}
  onClick={(e) => handleTabClick(e, tab)}
  title={!isExpanded ? getTaskLabel(tab.type) : undefined}
>
  ...
</div>
```
**没有 `role`、没有 `tabIndex`、没有 onKeyDown**。键盘用户：
- Tab 跳过整组任务标签（无法聚焦）
- 无法用 Enter / Space 激活
- 仅鼠标用户可用

VerticalTaskbar 是产品的核心导航之一（多任务并行），完全键盘不可达对无障碍 / 高效用户都是回归。

### 复现步骤
1. 已登录态，确保左侧 VerticalTaskbar 有 ≥ 2 个标签
2. 仅用键盘 Tab 在页面中遍历所有可聚焦元素
3. 任务标签从未获得焦点

### 预期 vs 实际
- **预期**：标签是 `<button role="tab" aria-selected={tab.isActive} tabIndex={tab.isActive ? 0 : -1}>` 或在外层加 `<div role="tablist">` + 内部 `role="tab"`，并支持方向键 / Home / End / Enter 切换。
- **实际**：div + onClick，对键盘 / AT 完全不可见。

### 证据
- a11y 快照：`generic "AI Chat" [ref=e125]: ...` 全是 `generic`，无 button/tab role
- 源码：`src/components/VerticalTaskbar.tsx:161-183`

### 修复方向
- 最小修复：把外层 `<div>` 换成 `<button type="button">`（保留样式 className），加 `aria-current={tab.isActive ? 'page' : undefined}` 或 `aria-selected`。
- 完整修复：包一层 `role="tablist"` + 标签 `role="tab"` + 内容区 `role="tabpanel"`，遵循 WAI-ARIA tabs pattern。

---

## Bug #8：LoginModal 生产构建仍输出 3 处 console.warn/error

### 详细描述
`src/components/LoginModal.tsx` 在三个分支都打印日志，而且这些日志包含 username、错误对象、时间戳，**没有用 `process.env.NODE_ENV` 包裹**：
- 第 56 行：`console.warn('[LoginModal] Login validation failed:', { hasUsername, hasPassword, error: 'missing required fields', timestamp })`
- 第 75 行：`console.warn('[LoginModal] Login failed:', { username, error, timestamp })` — **包含明文 username**
- 第 85 行：`console.error('[LoginModal] Login error occurred:', { username, error, timestamp })` — 同样含 username

实测每次空表单提交即立刻产生 1 条 `[LoginModal] Login validation failed`。在生产部署里，这是：
- **隐私泄露**：username 写到浏览器控制台 / 任何远端日志收集器（Sentry breadcrumb 默认会捕获 console）
- **噪声**：用户每点一次空提交就刷一条 warn

### 复现步骤
1. 打开 LoginModal，留空提交
2. 控制台输出：`[WARNING] [LoginModal] Login validation failed: {hasUsername: false, hasPassword: false, error: missing required fields, timestamp: 2026-05-09T15:35:08.275Z}`

### 预期 vs 实际
- **预期**：删除这些 dev-only 日志；如确需保留，用 `if (process.env.NODE_ENV !== 'production') console.warn(...)` 守卫；username 字段从 payload 中移除（或哈希）。
- **实际**：3 处都裸调 console，含敏感字段。

### 证据
- 控制台样本：`.web-debugger/logs/console-baseline-iter9.log`
- 源码：`src/components/LoginModal.tsx:56-61, 75-79, 85-89`

### 修复方向
- 直接删除三处 `console.*`（错误已通过 `setError` + `notification.showError` 给到用户）。
- 或包 `if (process.env.NODE_ENV !== 'production') { ... }`，并移除 `username` 字段。

---

## Bug #9：AuthContext 在 backend 不可达时打全栈 error

### 详细描述
`AuthContext.tsx:145`：
```ts
} catch (error) {
  console.error('[AuthContext] Session validation error:', error);
  return false;
}
```

Session 校验在挂载（line 161）和每 5 分钟轮询（line 206）时都会调用，且**任何 error 都走 `console.error` 全栈打印**——包括 backend 502 / DNS 失败 / 网络断开等"网络问题"型错误。这些不是 bug 而是网络抖动，但产物是：
- 控制台被 6+ 条 `[AuthContext] Session validation error: ApiError: Backend unreachable: fetch failed` 刷屏（每条带 4 行 stack）
- 在生产 + Sentry 配置下会被上报为 ERROR 级，污染监控指标
- 实测页面挂载阶段 AuthContext 至少调用 4 次 validateSession（每点一次 tab、每次 reload）

### 复现步骤
1. 在 backend 不可达（实测今天 dev backend 502）的情况下打开 http://192.168.1.123:3010/
2. 控制台立即出现 ≥ 4 组 `[AuthContext] Session validation error: ApiError: Backend unreachable: fetch failed` + stack trace
3. 切几次语言 / 主题 / 重 reload，错误条数线性增长

### 预期 vs 实际
- **预期**：网络层不可达不应是 ERROR 级。要么 `console.warn` 单行汇总 `('[AuthContext] Session validation skipped:', error.code ?? 'network')`，要么完全静默（已在 returns false 中处理状态）。
- **实际**：每次都打全栈 error，noise 加 Sentry 误报。

### 证据
- 控制台抓取：见 `.web-debugger/logs/console-baseline-iter9.log`（10 个 errors，其中 5 个是这条）
- 源码：`src/contexts/AuthContext.tsx:140-148`

### 修复方向
- 在 catch 内区分错误类型：`if (error instanceof ApiError && error.code === 'BACKEND_UNREACHABLE')` 走 warn 单行；其它走 error。
- 同时考虑限速：连续相同 error 在 N 秒内只打一次（一个简单的 ref + Date.now() 比较）。

---

## 探索过程附记 — 不计入正式 Bug 但值得跟踪

| 现象 | 备注 |
|---|---|
| Header 上的 "切换到亮色模式 / Switch to light mode" 按钮无 `aria-pressed` | 按钮表达的是开关态，加 `aria-pressed={theme === 'dark'}` 更友好 |
| 语言下拉容器 `<div>` 是普通 generic，未用 `role="menu"` + `role="menuitem"` | 可参考 iter7 / iter8 已建议的菜单语义模式 |
| 未登录 + 旧持久化 tab 仍显示 → 点击触发 toast 但视觉上 tab 仍在 → 用户理解为"加载中" | UX 提示不一致，可在 logout 时清空持久化 tabs 或在 tab 上显示锁图标 |
| LoginModal CTA 按钮始终 cursor=pointer，包括 disabled 状态 | tailwind 有 `disabled:cursor-not-allowed`，可直接加 |

---

## 优先级汇总

- **P1**（影响 a11y/键盘用户的核心入口）：#1 #2 #3
- **P2**（i18n + a11y 中等问题）：#4 #5 #6 #7
- **P3**（噪声 / 隐私 / 日志）：#8 #9

P1 三条均涉及"页面入口"或"主对话框"，没有任何键盘 / 屏幕阅读器替代路径，建议本轮修复方案优先处理。

---

## 证据目录（截图 + 快照）

- `.web-debugger/screenshots/iter9-baseline-20260509-233205.png` — 初始已登录态主页（带持久化 brainstorm tab）
- `.web-debugger/screenshots/iter9-home-en-20260509-233818.png` — 切换到 English 后的主页
- `.web-debugger/screenshots/iter9-light-theme-20260509-233818.png` — 切换到 Light theme 主页
- `.web-debugger/screenshots/iter9-login-modal-20260509-234030.png` — LoginModal 打开状态
- `.web-debugger/snapshots/iter9-login-modal-20260509-234030.yaml` — LoginModal a11y 树
- `.web-debugger/logs/console-baseline-iter9.log` — 控制台 baseline（含 AuthContext 噪声）

---

## 总结

本轮聚焦"未登录态 + Header / Hero / 模态 / VerticalTaskbar"四个未深入的区域，发现 **9 个有效 Bug**，覆盖键盘可达性、ARIA 对话框语义、focus trap、i18n 泄漏、AT 朗读、关闭按钮可访问名、生产日志噪声 / 隐私泄露、网络错误的 error 级误用。其中 P1 三个 (LoginModal dialog 语义、focus 行为、Feature 卡片键盘可达) 直接阻塞键盘 / 屏幕阅读器用户进入产品，建议在 Subtask #1 / #3 优先修复。
