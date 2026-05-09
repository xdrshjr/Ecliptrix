# Iter7 Bug Report — 2026-05-09

## 环境信息

- **浏览器**：Microsoft Edge (msedge) headed + persistent profile
- **目标 URL**：`http://192.168.1.123:3010`（dev 服务器）
- **登录账号**：admin（超级管理员）
- **Locale**：zh-CN（默认）
- **会话**：`ws-iter7-20260509-214609-54466`
- **测试时段**：2026-05-09 21:46–21:54

## 测试范围与方法

本轮探索性测试覆盖前 6 轮未深入触及的功能区域：

- 用户头像下拉菜单
- AI 对话「新对话」类型选择 Modal（聊天机器人 / 工作流 / 智能体）
- 项目列表（搜索、新建分类、项目操作菜单）
- 视频编辑器内文本脚本面板（解说脚本 / AI 视频脚本 / **AI 分镜**子标签）
- 视频编辑器素材面板模式切换（素材库 / AI 混剪 / AI 创建）
- AI 混剪模式选择 Modal
- 管理员系统设置入口

为每个 Bug 收集了快照（accessibility tree YAML）、截图与控制台/网络日志，证据保存在 `.web-debugger/`。

总计共发现 **9 个有效 Bug**（含至少 4 个 Medium 及以上）。

---

## Bug #1 — `<title>` 未按语言本地化（视频编辑页等）

- **位置**：视频编辑标签页 `?tab=video&task=...`，以及任何切换标题的子页面
- **严重程度**：Medium
- **优先级**：P2
- **复现步骤**
  1. 以 zh-CN 语言登录后进入任意项目，停留在「视频编辑」标签
  2. 观察浏览器标签页标题或执行 `document.title`
- **预期结果**：标题应当本地化，例如 `视频编辑 · Ecliptrix`
- **实际结果**：标题硬编码为英文 `Video Editing · Ecliptrix`，与页面其余完整中文化的 UI 不一致
- **证据**
  - 快照：`.web-debugger/snapshots/iter7-target-initial.png` 后多次快照均显示 `Page Title: Video Editing · Ecliptrix`
  - 控制台返回 `document.title === "Video Editing · Ecliptrix"`
- **影响**：浏览器标签、收藏夹、操作系统任务栏均显示英文，破坏 zh-CN 体验一致性，并影响 SEO/可访问性。
- **建议修复方向**：将各 tab 设置 `<title>` 的位置（疑似 `src/app/page.tsx` 内部根据 `tab` 切换的 `useEffect` 或 `Head`）改为通过 `i18n` 翻译键（如 `tabs.video.title`）输出。

## Bug #2 — 项目卡片操作按钮 aria-label 硬编码英文 `Project actions`

- **位置**：首页项目列表 → 任一项目卡右上角的 ⋯ 按钮；管理员页内项目列表同样存在
- **严重程度**：Medium
- **优先级**：P2
- **复现步骤**
  1. 进入项目列表
  2. 检查任一项目卡的操作按钮（三点图标）的 accessible name
- **预期结果**：aria-label 应使用本地化文案（例如「项目操作」或「`项目名称`的操作」）
- **实际结果**：所有 9 个项目卡的按钮 accessible name 均为英文 `Project actions`；展开后的菜单项 `重命名` / `删除` 是中文 — 形成英文触发器 + 中文菜单项的混合
- **证据**：快照 `.web-debugger/screenshots/iter7-project-list.png`；最近快照中 `button "Project actions"` 出现 9 次。
- **影响**：屏幕阅读器在 zh-CN 用户场景下读出英文，严重影响 a11y。
- **建议修复方向**：搜索 `aria-label="Project actions"` 字面量，替换为 `aria-label={t("project.actions", { name })}`。

## Bug #3 — 多处时间显示混合中英文（"更新于 22d ago" / "上次打开: 3m"）

- **位置**
  - 工作流选择列表（AI 对话 → 新对话 → 工作流）：`button "活跃 New Workflow 0 个节点 v1 编号 707387 更新于 22d ago"`
  - 项目卡：`generic [ref]: "上次打开: 3m"`、`"5h"`、`"1d"`、`"2d"` 等
- **严重程度**：Medium（多处出现，影响所有 zh-CN 用户）
- **优先级**：P2
- **复现步骤**
  1. AI 对话 → 点击「新对话」→ 选「工作流」分组 → 查看每条工作流右下角的「更新于 22d ago」/ "更新于 2026/3/19"
  2. 在项目列表内查看每个项目卡底部的 "上次打开: 3m"
- **预期结果**：相对时间应整体本地化为中文，例如 `更新于 22 天前`、`上次打开：3 分钟前`
- **实际结果**
  - "更新于 22d ago" — 中文 prefix + 英文相对时间
  - "上次打开: 3m" — 中文 prefix + 英文缩写单位 (m/h/d)
  - 同一列表内还有 "更新于 2026/3/19"（绝对日期）/ "更新于 22d ago"（相对短语）混用，更不一致
- **证据**：`.web-debugger/screenshots/iter7-new-chat-workflow-list.png`、`.web-debugger/screenshots/iter7-project-list.png`
- **影响**：本地化质量受损，日期格式不统一影响用户判断。
- **建议修复方向**：相对时间格式化（dayjs/relativeTime 或 date-fns formatDistance）使用 zh-CN locale；项目卡的 "上次打开" 文案改为 `t("project.lastOpened", { time })` 并在 zh-CN 下输出 `3 分钟前`。

## Bug #4 — 项目操作菜单缺少 ARIA `menu` / `menuitem` 角色

- **位置**：项目卡 ⋯ 按钮展开后的下拉菜单
- **严重程度**：Medium
- **优先级**：P2
- **复现步骤**
  1. 点击任一项目卡的「Project actions」按钮
  2. 检查弹出菜单的 accessibility tree
- **预期结果**：弹出容器应是 `role="menu"`，子项 `重命名`、`删除` 应是 `role="menuitem"`，且支持上下箭头键焦点循环
- **实际结果**：
  ```
  generic [ref=e2398]:
    - button "重命名" [ref=e2399]
    - button "删除" [ref=e2400]
  ```
  外层是普通 `div`，内层只是裸 `button`。屏幕阅读器无法识别这是一个菜单组，键盘用户无法用方向键在条目间移动。
- **影响**：a11y 不达标，键盘+屏幕阅读器用户难以使用项目重命名/删除。
- **建议修复方向**：将此菜单组件改为基于 Radix UI / shadcn 的 `DropdownMenu` （现项目已有该 lib），保证 menu/menuitem role 与方向键导航。

## Bug #5 — 「新建分类」与「新建项目」Modal 不是 ARIA dialog

- **位置**：项目列表侧栏「新建分类」按钮 / 顶部「新建项目」按钮所开启的对话框
- **严重程度**：Medium
- **优先级**：P2
- **复现步骤**
  1. 项目列表 → 点「新建分类」（或「新建项目」）
  2. 检查弹窗根节点
- **预期结果**：Modal 应有 `role="dialog"`、`aria-modal="true"`、`aria-labelledby` 关联标题；Esc 关闭；焦点陷阱
- **实际结果**：根节点是普通 `generic [ref=e401]` / `generic [ref=e412]`，无 dialog 角色，无显式 `aria-modal`。这与同一应用内其他正确实现的弹窗（如 `dialog "选择AI混剪模式" [ref=e2143]`）形成显著反差，说明实现规范在项目内不统一。
- **证据**：截图 `.web-debugger/screenshots/iter7-newcategory-dialog.png`，快照中两个 Modal 节点均无 `dialog` 角色
- **影响**：屏幕阅读器把这两个 Modal 视为普通区域，键盘焦点会泄漏到背景内容；与「选择AI混剪模式」的实现差距明显，造成体验不一致。
- **建议修复方向**：使用项目已有 `Dialog`（shadcn/Radix）组件统一封装；或至少加 `role="dialog" aria-modal="true" aria-labelledby="newCategoryTitle"`。

## Bug #6 — 「AI 分镜」空态指示语指向错误（"上方下拉菜单" 实际在下方）

- **位置**：视频编辑器 → 文本脚本面板 → 「AI 分镜」子标签
- **严重程度**：Medium
- **优先级**：P2
- **复现步骤**
  1. 进入任一项目的视频编辑标签
  2. 点击文本脚本面板顶部的「AI 分镜」按钮
  3. 阅读空态文案
- **预期结果**：文案与实际控件位置一致，例如「请在下方下拉菜单中选择已生成的分镜包」
- **实际结果**：当前文案为「在**上方**下拉菜单中选择已生成的分镜包」，但 combobox 与「刷新分镜包列表」按钮明显排在该提示**下方**。如下所示（截取自 accessibility tree）：

  ```
  paragraph: 请选择一个分镜包开始
  paragraph: 在上方下拉菜单中选择已生成的分镜包   ← 提示
  generic:
    combobox:
      option "暂无分镜包" [selected]              ← 下拉菜单实际位于下方
    button "刷新分镜包列表"
  ```
- **证据**：`.web-debugger/screenshots/iter7-ai-storyboard-empty.png`
- **影响**：用户按提示往上找不到下拉菜单；提示文字本身也具有误导性（既然「暂无分镜包」是唯一选项，下拉菜单也无法选出有效值，应直接引导用户去「分镜包」生成入口）。
- **建议修复方向**：将文案改为「在下方下拉菜单中选择已生成的分镜包，或前往「素材管理 → 分镜包」生成新的分镜包」。在视频编辑器源码中查找「上方下拉菜单」字符串定位翻译键并修正方向词；同时考虑在「暂无分镜包」时给出主动跳转链接。

## Bug #7 — AI 混剪模式 Modal 无默认选中态，但「开始 AI 混剪」按钮已可点

- **位置**：视频编辑器右下「AI 混剪」按钮 → 弹出 `dialog "选择AI混剪模式"`
- **严重程度**：Medium
- **优先级**：P2
- **复现步骤**
  1. 进入项目视频编辑器
  2. 点击素材面板的「AI 混剪」 模式切换按钮（或先前回路触发的 Modal）
  3. 不点击「快速混剪」 / 「专业混剪」中任意一张卡片，**直接**点底部的「开始 AI 混剪」
- **预期结果**：按钮在用户做出明确选择前应处于 disabled 状态；或显式高亮一个默认推荐项并在卡片上显示 `[selected]` / `aria-pressed=true`
- **实际结果**：
  - 两张模式卡片在 accessibility tree 中均无 `[selected]` / `[pressed]` 标记
  - 「开始 AI 混剪」按钮始终可点
  - 直接点击后系统**实际使用了某个隐藏默认值**进行混剪并提示「AI混剪已完成！导入了 3 个轨道和 3 个素材」
- **证据**：`.web-debugger/screenshots/iter7-aimix-modal.png`；快照里两个卡片节点 `generic [ref=e2158] [cursor=pointer]` 与 `generic [ref=e2173] [cursor=pointer]` 没有任何选中状态属性。
- **影响**：用户以为必须显式选择，但实际不选也能跑，且无法知晓走了哪种模式（耗时、效果差异巨大）；两种模式 + 隐藏默认 ≈ 用户体验信任度下降。
- **建议修复方向**：
  - 默认选中其中一张（建议「快速混剪」），并显式渲染 `aria-pressed`/`data-selected` 以供视觉与 a11y 工具识别；或
  - 在用户未选时禁用「开始 AI 混剪」按钮。

## Bug #8 — 「新对话」Modal 关闭按钮 aria-label 未本地化

- **位置**：AI 对话页 → 顶部「新对话」按钮触发的 Modal 右上角 X
- **严重程度**：Low
- **优先级**：P3
- **复现步骤**
  1. 进入「AI 对话」标签
  2. 点击对话列表面板顶部的「新对话」按钮
  3. 检查 Modal 头部的关闭按钮 accessible name
- **预期结果**：在 zh-CN 下应为「关闭」
- **实际结果**：accessible name 为英文 `Close`（节点：`button "Close" [ref=e1071]`）
- **影响**：a11y 与本地化一致性；与 Bug #2 同源——多处英文 aria-label 残留
- **建议修复方向**：检查 Modal 头部组件，统一使用 `aria-label={t("common.close")}`。

## Bug #9 — `ImageOverlay` 在每次容器尺寸变更时刷屏 console.log

- **位置**：浏览器开发者控制台（任意已加载视频组合面板的页面）
- **严重程度**：Low（影响调试与生产侧性能/隐私）
- **优先级**：P3
- **复现步骤**
  1. 进入有图片素材已添加到时间轴的项目（首次进入会自动渲染叠加层）
  2. 打开 DevTools → Console
  3. 调整窗口尺寸或切换面板让叠加容器尺寸变化
- **预期结果**：生产模式下不应有任何 `[LOG] [ImageOverlay] Rendering overlay …` / `[ImageOverlay] Image loaded` 等普通 console.log
- **实际结果**：每次 re-render 都会输出一条「Rendering overlay item-image-…」携带完整对象（含 OSS URL），单次切换标签会产生 8+ 条相同 LOG 行；首次渲染前还有一条「Container dimensions are zero, not rendering overlay」warning。
- **证据**：`.web-debugger/logs/console-baseline.log` 与之后 `playwright-cli console` 输出（22→94 条消息，多数为 ImageOverlay 系列）
- **影响**：
  - 控制台噪声极大，掩盖真实错误（前几轮已有 log hygiene 修复，这处仍然漏网）
  - 携带 OSS URL 的 LOG 在生产侧可能造成轻度信息泄露
  - 大量 console 输出会拖慢 React DevTools / 内存占用
- **建议修复方向**：
  - 将这些日志降级为 `if (process.env.NODE_ENV !== 'production') console.debug(...)`，或包入 `debug` lib
  - 「Container dimensions are zero」首帧 warning 应静默重试，不打 warning（或改 debug）

---

## 优先级汇总

| #  | 标题（简）                                  | 严重 | 优先 | 类别       |
|----|---------------------------------------------|------|------|------------|
| 1  | `<title>` 未本地化                          | Medium | P2 | i18n       |
| 2  | 「Project actions」aria-label 硬编码英文     | Medium | P2 | i18n / a11y |
| 3  | 时间显示混合中英 ("22d ago" / "上次打开 3m") | Medium | P2 | i18n       |
| 4  | 项目操作菜单缺 menu/menuitem 角色            | Medium | P2 | a11y       |
| 5  | 「新建分类/项目」Modal 不是 ARIA dialog      | Medium | P2 | a11y       |
| 6  | AI 分镜空态指向错误方向（上方/下方）         | Medium | P2 | UX         |
| 7  | AI 混剪 Modal 无选中态但可点开始             | Medium | P2 | UX         |
| 8  | 新对话 Modal 关闭按钮英文 aria-label         | Low    | P3 | i18n       |
| 9  | ImageOverlay 控制台刷屏 LOG                  | Low    | P3 | log hygiene |

## 证据目录

- 截图：`.web-debugger/screenshots/iter7-*.png`
- 快照：`.web-debugger/snapshots/`
- 控制台基线：`.web-debugger/logs/console-baseline.log`
- 会话：`ws-iter7-20260509-214609-54466`

下一步（Iter7 流程的步骤 2）将基于本报告进行代码探索与修复方案编写。
