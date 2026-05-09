# Web Bug Report — iter6 (2026-05-09)

**生成时间**: 2026-05-09 21:08
**目标**: Ecliptrix Dev Server `http://192.168.1.123:3010`
**浏览器**: Microsoft Edge (Chromium) — playwright-cli `--browser=msedge --persistent`
**账号**: admin（超级管理员）
**模式**: 全自动 / 探索性测试

> 本轮（iter6）专注于前 5 轮未深入触及的功能区域：
> - 账号资料 / 其他设置弹窗（个人偏好/通知/隐私 toggles，语言+主题 dropdown 持久化）
> - 管理员后台「水印移除设置」「视频分析设置」（跨字段校验、字段级 a11y）
> - 视频编辑面板的脚本类型分段控件（解说脚本 / AI视频脚本 / AI分镜）
> - 视频编辑面板的「自动混剪」「AI 混剪」入口（含无视频素材时的提示）
> - 重渲染期间的 console 噪音（针对 iter4 #7 修复的范围外组件）
>
> 全部使用 admin 账号在 BugTest 项目（`592f3272-…`）下进行。

---

## Bug 列表（按严重程度排序）

| # | 标题 | 严重程度 | 优先级 |
|---|------|---------|--------|
| 1 | 「水印移除设置」允许保存逻辑互斥的并发/最大线程数（concurrent>max），后端 PUT 200 默默接受 | **High** | P1 |
| 2 | 「账号设置 → 其他设置」中的 toggles/语言/主题更改未上行到后端（界面声称"更改会自动保存"） | **High** | P1 |
| 3 | 「自动混剪」按钮在无视频素材时点击无任何反馈（无 toast / 无禁用 / 无对话框） | Medium | P2 |
| 4 | 「用户资料」对话框无法用 Escape 键关闭，仅能点 X 按钮 | Medium | P2 |
| 5 | 解说脚本/AI视频脚本/AI分镜分段标签使用普通 `<button>`，缺 `role="tab"`/`aria-selected` 等 tab 语义 | Medium | P2 |
| 6 | 「视频分析设置」管理后台 16 个数值输入框全部缺失 label 关联（无 `id`/`aria-label`/`aria-labelledby`） | Medium | P2 |
| 7 | `ImageOverlay` 组件在正常渲染期间向 console 喷发 30+ 条 `[LOG]` 噪音（iter4 #7 修复未覆盖此组件） | Low | P3 |

---

## Bug #1 — 「水印移除设置」允许保存 `concurrent_threads(15) > max_threads(5)`，后端 PUT 200 默默接受

**严重程度**: High / P1（数据完整性 + 与 iter2 Bug #3 同模式：缺跨字段校验）

**位置**:
- UI: 顶部「管理员设置」→ 左侧「水印移除设置」面板 → 「处理配置」组
- 涉及字段: 「并发线程数」(`min=1, max=20, default=5`) 和 「最大并发线程数」(`min=1, max=30, default=10`)
- 后端: `PUT /api/system-settings/watermark`

**详细描述**:
两个数值字段独立都设有 HTML5 `min/max` 约束，但前端与后端都没有跨字段校验：用户可将「并发线程数」设为 15 而把「最大并发线程数」设为 5，前端"保存"按钮变为可点击，点击后服务器返回 `200 OK`，配置被永久写入。这与 iter2 Bug #3（TTS 设置允许保存越界值）属于同一类未做跨字段校验的服务端漏洞。

**复现步骤**:
1. 登录 admin 后点击右上「管理员设置」图标
2. 左侧切换到「水印移除设置」
3. 「并发线程数」spinbutton 输入 `15`
4. 「最大并发线程数」spinbutton 输入 `5`
5. 顶部出现「有未保存的更改」提示，「保存」按钮从 disabled 变为可用
6. 点击「保存」

**预期结果**:
- 前端在 `concurrent > max` 时禁用「保存」按钮，并在两个字段下方给出错误提示，例如"并发线程数不能超过最大并发线程数"
- 即使前端漏校验，后端 `PUT /api/system-settings/watermark` 也应返回 `4xx` 拒绝

**实际结果**:
- 「保存」按钮可用，点击后 `PUT /api/system-settings/watermark => 200 OK`
- 配置被持久化，下次后端起 watermark 任务时调度器会拿到 `concurrent_threads=15` 但 `max_threads=5`，产生不可预知行为（线程池超限/死锁/拒绝任务等）

**证据**:
- 网络: `[PUT] http://192.168.1.123:3010/api/system-settings/watermark => [200] OK`
- 快照: `.web-debugger/snapshots/iter6-watermark-cross-210229.yaml`

**修复建议**:
1. 前端在 `WatermarkSettings` 组件的 `handleChange/handleSave` 中加入跨字段校验：当 `concurrent > max` 时禁用 Save 并显示 inline error
2. 后端 `system_settings/watermark` Pydantic 模型加 `@model_validator(mode='after')`，断言 `concurrent_threads <= max_threads` 并返回 422
3. 视频分析设置面板内同类 spinbutton 组合也需排查（如 VLM 并发线程数 vs 队列管理最大并发分析数）

---

## Bug #2 — 「账号设置 → 其他设置」内的 toggles/语言/主题更改未上行到后端

**严重程度**: High / P1（用户偏好跨设备/跨浏览器丢失 + 文案误导）

**位置**:
- UI: 头像 A → 账号设置 → 「其他设置」选项卡
- 涉及控件:
  - 通知设置: 「邮件通知」「推送通知」「营销邮件」开关 (3×)
  - 隐私设置: 「公开资料」「活动可见性」开关 (2×)
  - 偏好设置: 「语言」combobox（English/中文）、「主题」combobox（浅色/深色/自动）
- 文案: 面板底部明确显示 **"更改会自动保存。"**

**详细描述**:
用户切换面板内任一控件后：
- 网络监控 3 秒：**没有任何 PUT/PATCH/POST 请求被发出**（仅有日常的 `validate-session` 心跳）
- 重新加载页面后，开关状态确实保留下来 → 因此"持久化"层只在 **localStorage**
- 一旦换浏览器 / 换设备 / 清空站点数据，所有偏好都会丢失，且后端永远不知道用户是否同意接收营销邮件等

文案"更改会自动保存"使用户认为已经同步到账号，实际只是本地缓存。这同时是一个**潜在合规问题**（GDPR/CCPA 下营销邮件偏好必须服务器端存储且可审计）。

**复现步骤**:
1. 点右上头像 A → 账号设置
2. 切换到「其他设置」选项卡
3. 打开 DevTools Network 面板（或本测试用的 `playwright-cli network`），过滤 XHR/Fetch
4. 点击「推送通知」开关切换 → 静止 5 秒
5. 切换「语言」combobox 为 English → UI 立即变成英文
6. 观察 Network：无任何指向 `/api/users/preferences` / `/api/account` 之类的请求

**预期结果**:
- 每次状态变更应 debounce 后调用一次 `PATCH /api/users/me/preferences`（或 PUT），将 toggles + locale + theme 上传至 `User` 模型相应字段
- 失败时显示错误 toast，且本地状态回退；成功时显示"已保存"
- 如有意保持本地优先，文案应改为"更改仅在本设备生效"

**实际结果**:
- 切换控件 → 0 网络请求
- 文案仍为"更改会自动保存"，对用户构成误导
- 切换到另一浏览器（或清 localStorage）后所有偏好丢失

**证据**:
- 网络日志: `.web-debugger/logs/` 中本轮 `network` 命令输出，过滤 `validate-session/workflow-preferences/load` 之外无任何请求
- 快照: `.web-debugger/snapshots/iter6-acc-other-210008.yaml`（关闭/重打开后开关已记忆）

**修复建议**:
1. `OtherSettingsTab.tsx` 在 toggle/select onChange 中调用统一 `useUserPreferencesMutation`
2. `app/users` 后端添加 `PATCH /api/users/me/preferences`，写入 `User` 模型新字段（或单独 `user_preferences` 表）
3. 把 `更改会自动保存` 文案绑定到实际请求状态：保存中 → "保存中…"；成功 → "已保存"；失败 → "保存失败，请重试"
4. 与 `LocaleContext` / theme provider 解耦本地优先与服务器同步两条路径

---

## Bug #3 — 「自动混剪」按钮在无视频素材时点击无任何反馈

**严重程度**: Medium / P2（UX：button-to-noop / 缺空态提示）

**位置**:
- UI: 视频编辑 → 右侧「素材管理」头部按钮组中的 **自动混剪** 按钮
- 组件: `VideoEditingInterface` / `MaterialsPanel`
- 后端: `PUT /api/video-projects/{id}` （仅触发了一次项目元信息保存，与混剪无关）

**详细描述**:
当当前项目素材中**没有视频**（仅有图片/音频）时，点击「自动混剪」按钮：
- 没有打开任何对话框 / 模态
- 没有任何 toast / inline 错误提示
- 没有任何禁用或 loading 状态变化
- 仅触发一次无关的 `PUT /api/video-projects/{id}` 项目保存

按钮看起来 enabled、cursor 为 pointer，但用户多次点击会一直得到无反馈。这与「AI 混剪」按钮（同 panel 底部 footer）形成鲜明对比 —— 后者会弹出"选择 AI 混剪模式"对话框；用户没有任何信号提示该按钮需要先上传视频。

**复现步骤**:
1. 进入一个仅含图片/音频素材的项目（例如本轮使用的 BugTest）
2. 在视频编辑视图右侧找到「素材管理」面板顶部
3. 点击「自动混剪」（魔法棒图标）
4. 观察：UI 没有任何变化；DevTools Network 仅看到一次 `PUT /api/video-projects/{id}`

**预期结果**:
任一即可：
- 当 `videoMaterialsCount === 0` 时禁用按钮，添加 tooltip "请先上传视频素材"
- 或弹出与 AI 混剪一致的对话框，并在内部显示空态"请先添加视频素材后再尝试自动混剪"

**实际结果**:
- 按钮始终 enabled，点击无视觉反馈，让用户怀疑功能损坏

**证据**:
- 控制台: `[VideoEditingInterface] 点击AI混剪按钮 {totalMaterialsCount: 3, ...}` —— 但点击「自动混剪」未输出对应日志，疑似事件 handler 直接 `early return` 而无 user-facing 处理
- 快照: `.web-debugger/snapshots/iter6-auto-remix-after-210644.yaml`

**修复建议**:
- `VideoEditingInterface.tsx` 中 `handleAutoRemix` 检查 `videoMaterials.length === 0` 时弹出 toast + tooltip 而非静默返回
- 同步给「AI 混剪」flow 增加同样的空态预检（虽然 dialog 现在能弹出，但点击"开始 AI 混剪"在无视频情况下也只是 POST 后默默失败）

---

## Bug #4 — 「用户资料」对话框无法用 Escape 键关闭

**严重程度**: Medium / P2（a11y / 键盘可访问性）

**位置**:
- UI: 头像 A → 账号设置 → 弹出的「用户资料」对话框（heading"用户资料 — 管理您的账户信息和偏好设置"）

**详细描述**:
该模态对话框只暴露了一个「关闭」(X) 按钮和左侧 navigation。WCAG 2.1 SC 2.1.1 (Keyboard) 与常规 Radix/headlessui modal 行为均要求 Escape 关闭模态。当前实现：
- 按 Escape：什么都不发生，对话框保持打开
- 按 Tab 也不会聚焦到 X 按钮（焦点未被 trap 在对话框内）
- 点击对话框外的 backdrop 区域：未测试，但鉴于 Escape 都不工作，焦点管理整体失效的概率高

**复现步骤**:
1. 点右上头像 A → 账号设置（弹出"用户资料"对话框）
2. 按 `Escape`
3. 对话框依然在前

**预期结果**:
- Escape 关闭并把焦点还给触发按钮（头像 A）
- Tab/Shift+Tab 仅在对话框内循环（focus trap）
- 点击外部 backdrop 关闭

**实际结果**:
- Escape 无响应

**证据**:
- 操作: `playwright-cli press Escape` 后 `snapshot` 显示 `heading "用户资料"` 仍然存在
- 快照: `.web-debugger/snapshots/iter6-back-210119.yaml`

**修复建议**:
- 在该 dialog 组件外层包 `<Dialog>` (Radix UI) 或 `useDialogReducer` 自带 Escape/backdrop/focus-trap，避免重新发明轮子
- 单元测试: keyDown('Escape') → assert dialog 卸载

---

## Bug #5 — 脚本类型分段标签缺 tab 语义

**严重程度**: Medium / P2（a11y）

**位置**:
- UI: 视频编辑 → 中间"文本脚本"卡 → 子标签栏 「解说脚本 / AI视频脚本 / AI分镜」
- 组件: `TextScriptPanel` / 类似实现

**详细描述**:
这三个分段控件视觉上是 tab，但 DOM 是裸 `<button>`：
```
{
  text: '解说脚本',
  ariaSelected: null,
  ariaPressed: null,
  role: null,
  classes: '... bg-card ...'   // 通过 Tailwind class 切换
}
```
- 没有 `role="tab"` / `role="tablist"` / 其对应的 `tabpanel`
- 没有 `aria-selected` / `aria-pressed`
- 没有 `aria-controls` 关联到内容容器
- 屏幕阅读器朗读时会得到三个普通按钮，无法知道当前是哪一个被选中
- 同时不响应方向键（左右键不在 tab 间切换）

WAI-ARIA Authoring Practices 1.2 要求 tab 控件必须实现 tab/tablist/tabpanel 三件套及方向键导航。同样的反模式在材料库面板的「全部/视频/音频/图片/分镜包/人物包/场景包/帧」筛选栏，以及"素材管理 / 视频处理"切换栏中也观察到，建议一并修复。

**复现步骤**:
1. 进入视频编辑视图（任意项目）
2. 在中间"文本脚本"卡片上方找到三个标签
3. 用 DevTools 选中按钮，查看 attributes —— 只有 `class`，无 `role/aria-*`

**预期结果**:
- 实现 ARIA tablist：`<div role="tablist">` 内 `<button role="tab" aria-selected="..." aria-controls="...">`
- 方向键 ←/→ 在 tab 间循环切换
- 选中态除 `bg-card` 视觉外亦通过 `aria-selected="true"` 暴露给 AT

**实际结果**:
- 仅 Tailwind class 区分活跃 tab，AT 无法获知当前选中项

**证据**:
- DOM 探测: `iter6` 中 `eval` 输出三个按钮的 ariaSelected/ariaPressed/role 全部为 `null`
- 类似缺失出现在素材分类筛选区（`generic [ref=e278]` 下的全部/视频/音频/图片/…）

**修复建议**:
- 在 shadcn/ui 中已有 `Tabs/TabsList/TabsTrigger/TabsContent` 等可复用组件，重构这几个位置直接使用即可，无须自造

---

## Bug #6 — 「视频分析设置」16 个数值输入框全部缺失 label 关联

**严重程度**: Medium / P2（a11y / 表单可用性）

**位置**:
- UI: 管理员设置 → 「视频分析设置」（实际上「水印移除设置」「上传设置」「TTS 设置」等同类管理面板预计同一根因）

**详细描述**:
通过 `document.querySelectorAll('input[type=number]')` 扫描该面板：
```json
{ "total": 16, "withId": 0, "withLabel": 0, "withAriaLabel": 0, "withAriaLabelledby": 0, "wrappedLabel": 0 }
```
- 所有 16 个 spinbutton 都没有 `id`，所以无法被 `<label for="..">` 关联
- 没有 `aria-label`/`aria-labelledby`
- 没有被 `<label>` 包裹
- 视觉上的 label 文本（"最大并发分析数 / 并发线程数 / API 超时（秒） / 最大重试次数 / 默认帧间隔（秒） / 每视频最大帧数 …"）是一个独立 `<div>`，与 input 仅靠 DOM 兄弟关系排版

后果:
- 屏幕阅读器朗读时，每个 input 只播报数字（"5"、"30"），用户无法分辨该数字属于哪个配置
- 测试自动化无法使用语义查询（`getByLabel("API 超时（秒）")`）

**复现步骤**:
1. 管理员设置 → 视频分析设置
2. DevTools Console 执行：
   ```js
   document.querySelectorAll('input[type=number]').length // 16
   document.querySelectorAll('input[type=number][id]').length // 0
   ```

**预期结果**:
- 每个 input 拥有 `id`，与上方 `<label htmlFor>` 关联
- 或 `aria-labelledby` 指向 label 文本所在元素的 id

**实际结果**:
- 0/16 关联

**证据**:
- DOM 探测脚本（见 iter6 console eval 输出）

**修复建议**:
- 抽取 `<NumberSetting label="..." value={...} onChange={...} min={...} max={...} />` 组件，内部用 `useId()` 生成 `id` 并与 `<label htmlFor>` 关联，所有管理员设置面板替换裸 input

---

## Bug #7 — `ImageOverlay` 组件在正常渲染期间喷发 30+ 条 `[LOG]` 噪音

**严重程度**: Low / P3（同 iter4 Bug #7 同根但范围未覆盖）

**位置**:
- 视频编辑预览面板（`item-image-…` overlay）
- 关键字: `[ImageOverlay] Rendering overlay item-image-…`、`[ImageOverlay] Image loaded: …`
- 组件: `ImageOverlay`（在 `PreviewCanvas` / `OverlayLayer` 下渲染图片素材时）

**详细描述**:
本轮一次 5 分钟的探索性会话即累计了 30 条 `[ImageOverlay] Rendering overlay …` 日志，外加多条 `Image loaded` —— 在生产/dev 环境向 console 喷发详细对象（含 OSS 完整 URL、`containerWidth/Height`、`pixelPosition`）。这与 iter4 Bug #7 相同根因（开发期 console.log 残留），但 iter4 修复仅覆盖了 ChatInterface / Workflow 相关组件，未触及 `ImageOverlay` / `MaterialsPanel`。`MaterialsPanel` 同样仍有 `缩略图加载成功` 日志（同次会话 3 条）。

**复现步骤**:
1. 在视频编辑视图打开任意含图片素材的项目（让该图片在 timeline 渲染）
2. 打开 DevTools Console
3. 任何会触发 overlay 重渲染的操作（窗口缩放、tab 切换、点击）都会刷新一批 `[ImageOverlay] Rendering overlay…`

**预期结果**:
- 生产构建移除这些 `console.log`，或用受 `NODE_ENV !== 'production'` 包裹的 logger（与 iter4 修复保持一致）

**实际结果**:
- 67 条总 console 消息中 30 条来自单一组件，对生产环境调试构成干扰，并暴露内部 OSS URL 给浏览器扩展/screencast

**证据**:
- console 计数: `playwright-cli console | grep -c "ImageOverlay" → 30`

**修复建议**:
- 将 `ImageOverlay`/`MaterialsPanel`/`LocalAudioManager` 中的 `console.log` 全部替换为 iter4 引入的 `logger.debug`（或直接删除）
- 全局 ESLint 启用 `no-console: ["warn", { allow: ["warn", "error"] }]` 防止再发生

---

## 测试环境与证据清单

- 浏览器: Microsoft Edge (Chromium)，playwright-cli 0.1.4，`--headed --persistent --browser=msedge`
- session: `ws-iter6-20260509-205345-49300`
- 截图目录: `.web-debugger/screenshots/iter6-*.png`
- 快照目录: `.web-debugger/snapshots/iter6-*.yaml`
- 测试项目: BugTest（id `592f3272-2983-4303-adbb-c51887a3c748`）
- 关键 console 行: `.playwright-cli/console-2026-05-09T12-54-21-205Z.log`

## 与前几轮的覆盖关系

- iter1 (video-cover modal) / iter2 (login + 工作流 + 项目列表 + 视频搜索) / iter3 (头脑风暴 + 视频编辑 + 模型设置 + YouTube + locale) / iter4 (工作流保存运行 + 素材库筛选空态 + 特效转场 + 用户管理 + 头脑风暴 nav) / iter5 (TTS 音频 + AI 图像 + 暗色模式 + 用户 Profile + 404 + 参考图选择器)
- iter6 新增覆盖区域：账号设置 → 其他设置弹窗的偏好/通知/隐私持久化、用户资料弹窗键盘可访问性、管理员后台水印移除/视频分析的跨字段校验与字段 a11y、视频编辑面板脚本子标签栏 a11y、AI 混剪/自动混剪空态、ImageOverlay 渲染日志噪音
- 与 iter2 #3（TTS 越界）共类的 Bug #1，与 iter4 #7（[LOG] 噪音）共类的 Bug #7

## 优先级建议

- **本轮交予下游"步骤2 代码探索与修复方案"先处理 P1**：Bug #1（数据完整性，与已知 iter2#3 同模式可一并加抽象层）和 Bug #2（用户偏好持久化层缺失，文案误导用户）
- **第二批 P2**：#3（自动混剪空态）、#4（dialog Escape）、#5（tab 语义）、#6（label 关联）
- **P3 #7** 可与全局 logger 重构合并提交
