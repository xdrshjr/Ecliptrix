# AI 图像生成面板布局修复 — 开发计划文档（已评审修订版）

> 项目：Ecliptrix（Video Editing 任务）  
> 阶段：Phase 2 — 开发计划评审与修正  
> 日期：2025 年 6 月  
> 评审人：Senior Technical Lead（Phase 2 Agent）

---

## 评审结论（Executive Summary）

原 Phase 1 开发计划对根因的分析基本准确，技术选型合理，任务分解清晰。但在以下方面存在缺陷或遗漏：
1. **遗漏了 `StoryboardTab` 左列的 focus ring 截断问题**；
2. **T2.1 的 Grid 修复方案会破坏移动端响应式布局**（缺失 `md:` 断点前缀）；
3. **测试时间估算偏乐观**，未充分考虑首次在组件目录内补充 DOM 挂载测试的学习/调试成本；
4. **风险评估遗漏了响应式回归风险与多层 overflow 截断风险**；
5. **R1 的 Safari 14 假设与项目技术栈基线严重脱节**。

本评审已对所有上述问题进行修正，产出最终可执行版本。

---

## 第一部分：Review Findings & Comments（逐节评审意见）

### 1. 代码分析总结（Section 1）
- **准确性**：对 `StoryboardTab.tsx` flex/grid 混用问题的定位准确，对三个图像生成 Tab 的 focus ring 截断根因分析正确。
- **遗漏点**：`StoryboardTab.tsx` 在 `step === 'script'` 时的左列容器（`flex-1 min-h-0 overflow-y-auto pr-1`，内含 `MentionedImageInput`）同样紧贴模态框左边缘，`MentionedImageInput` 内部的 textarea 也使用了 `focus:ring-2`，因此 **该 Tab 也存在 focus ring 被截断的问题**，但原分析完全未提及。
- **遗漏点**：未评估移动端（< 768px）下的布局行为。原始代码在 `StoryboardTab` 中使用了 `flex flex-col md:grid`，说明移动端是单列堆叠的，任何修复必须保留这一行为。

### 2. 需求拆解（Section 2）
- **完整性**：FR-1 ~ FR-6 覆盖了主要功能需求，但 FR-3 ~ FR-5 仅覆盖了三个图像生成 Tab，**缺少对 `StoryboardTab` 左列 focus ring 的修复需求**。
- **非功能性需求**：合理，但建议增加一条「响应式兼容性」的显式声明，而非仅隐含在「兼容性」中。

### 3. 技术选型说明（Section 3）
- **合理性**：Tailwind CSS 纯方案与项目栈完全契合，零依赖增量。
- **可优化点**：关于 padding 修复，原计划在 `px-2` 与 `pl-2 pr-1` 之间摇摆，未给出基于设计约束的坚定推荐。经评审，考虑到左侧可用宽度本已紧张（模板卡片横向滚动、尺寸按钮 grid-cols-3），**建议采用 `pl-2 pr-1`**（仅增加左侧 8px 安全区），以最小化对内容宽度的影响。

### 4. 详细任务分解（Section 4）
- **T2.1 严重缺陷**：原方案提出改为 `h-full grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 min-h-0`，**完全移除了 `md:` 前缀**。这会导致在 768px 以下视口仍强制双列，破坏原有的移动端单列堆叠设计。
- **T3 任务缺失**：未包含对 `StoryboardTab` 左列的 padding 调整任务。
- **T4.1 时间偏乐观**：该目录下现有测试均为纯函数/逻辑测试（`mentionUtils.test.ts`、`referenceImageRegression.test.tsx`），尚无组件 DOM 挂载测试。首次编写 `@testing-library/react` 测试并处理 mocking（`MaterialLibraryGrid` 异步加载、`LocaleContext` 等）预计需要更多时间。
- **T4.3 检查清单缺失**：未包含 `StoryboardTab` 的 focus ring 检查项。

### 5. 时间估算（Section 5）
- **总体判断**：6 小时在理想条件下可行，但考虑 T3.4 新增任务与 T4.1 的调试成本，**建议调整为 7 小时**。

### 6. 风险评估（Section 6）
- **R1 问题**："Safari 14" 作为基线远低于 Next.js 15 + React 19 的实际运行环境（Safari 14 甚至不支持部分现代 JS 语法）。该风险描述不专业，应修正为一般性浏览器兼容性风险。
- **缺失风险**：
  - **响应式回归风险**：T2.1 的类名修改若误删 `flex flex-col md:` 前缀，会导致移动端布局崩坏。
  - **多层 overflow 截断风险**：若 `focus:ring-2` 与容器边缘之间还存在其他带有 `overflow-hidden` 的中间层，仅调整最外层 padding 可能仍无法完全解决。

### 7. 关键假设（Section 7）
- **Assumption 3**：Safari 基线描述（iOS 15+/macOS 12+）与 R1 的 Safari 14 风险自相矛盾，应统一修正。

### 8. 下游任务输入（Section 8）
- 清晰、可执行，无需修改。

---

## 第二部分：Revision Log（修正记录）

| 序号 | 原内容 | 修正原因 | 修订后内容 |
|------|--------|----------|------------|
| RL-1 | 1.4 问题 B 仅提及三个图像生成 Tab 的 focus ring 被遮挡 | 遗漏了 `StoryboardTab` 左列同样存在该问题 | 在 1.4 新增「问题 B-2」：StoryboardTab 的 script 步骤左列 `overflow-y-auto pr-1` 内含 `MentionedImageInput`，其 textarea 的 `focus:ring-2` 同样被截断 |
| RL-2 | FR-3 ~ FR-5 仅覆盖 Basic/Character/Scene Tab | 缺少 StoryboardTab 的 focus ring 修复需求 | 新增 **FR-7**：修复分镜生成 script 步骤左列输入框 focus ring 可见性 |
| RL-3 | T2.1 提议改为 `h-full grid grid-cols-[...] gap-6 min-h-0` | 移除 `md:` 前缀会破坏移动端响应式单列布局 | 修订为：**保留响应式断点** `h-full flex flex-col md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-6 gap-4 min-h-0` |
| RL-4 | T3 仅包含 T3.1 ~ T3.3（三个 Tab） | 遗漏 StoryboardTab 左列 | 新增 **T3.4**：StoryboardTab 左列 padding 调整（`pr-1` → `pl-2 pr-1`） |
| RL-5 | T3 推荐方案为 `px-2` | 左右均增会压缩本不宽裕的内容宽度，可能触发模板卡片/尺寸按钮换行 | 推荐方案改为 **`pl-2 pr-1`**，仅左侧增加 8px 安全区，最小化宽度影响 |
| RL-6 | T4.1 预估 1h | 首次在该目录编写 DOM 挂载测试，需处理多个 mock | 调整为 **1.5h** |
| RL-7 | T4.3 手动检查清单 7 项 | 未覆盖 StoryboardTab 的 focus ring | 新增检查项：「分镜生成 script 步骤：左列 MentionedImageInput textarea focus 时四边 ring 完整」 |
| RL-8 | 时间估算合计 6h | 新增 T3.4 与 T4.1 增量 | 合计调整为 **7h** |
| RL-9 | R1 描述包含 "Safari 14" | 与项目技术栈及 Assumption 3 严重脱节 | 修正为："Grid 重构后，在某些浏览器下 `minmax(0, xfr)` 计算异常导致列宽塌陷"，缓解策略不变 |
| RL-10 | 风险表无响应式回归风险 | T2.1 的断点处理失误会直接破坏移动端 | 新增 **R6**：Grid 重构误删 `md:` 前缀导致 <768px 视口下强制双列堆叠异常 |
| RL-11 | 风险表无多层 overflow 风险 | 仅改一级 padding 可能不够 | 新增 **R7**：textarea 与容器边缘之间存在中间 `overflow-hidden` 层，导致 ring 仍被截断 |

---

## 第三部分：Final Confirmed Development Plan（最终确认版）

### 1. 代码分析总结（修订后）

#### 1.1 项目技术栈
- **框架**：Next.js 15（App Router）+ React 19 + TypeScript 5.9
- **样式**：Tailwind CSS 3.4 + 自定义 CSS 变量主题（深色/浅色双模式）
- **状态管理**：Zustand（全局）+ React `useState`（组件本地）
- **动画**：Framer Motion、Tailwind `animate-*`
- **测试**：Vitest 4 + `@testing-library/react` + jsdom
- **架构模式**：组件化模块化，按功能域拆分（`src/components/video/components/AiImageModal/`）

#### 1.2 关键文件与模块关系

```
AiImageModal.tsx (入口)
├── BasicGenerationTab.tsx    ── 基础生成（双列：左侧表单 + 右侧参考图）
├── CharacterModelingTab.tsx  ── 人物建模（同上）
├── SceneModelingTab.tsx      ── 场景建模（同上）
├── StoryboardTab.tsx         ── 分镜生成（多步骤向导：input → script → generating → success/error）
│   └── StoryboardScriptReview.tsx  ── 剧本审核/聊天/确认（script 步骤右栏）
├── MentionedImageInput.tsx   ── 带 @ 提及的提示词输入框（分镜生成专用）
├── ReferenceImagePanel.tsx   ── 参考图选择面板（基础/人物/场景右侧共用）
└── GridSizeSelector.tsx      ── 分镜数量选择器
```

#### 1.3 现有布局模式
- **模态框容器**：`max-w-4xl`（≈ 896px），body 使用 `flex-1 px-8 py-6 min-h-0 overflow-hidden`
- **三个图像生成 Tab**：统一采用 `flex gap-6 h-full`
  - 左侧：`flex-1 min-w-0 space-y-5 overflow-y-auto pr-1`
  - 右侧：`w-64 flex-shrink-0 border-l border-border pl-6`
- **分镜生成 Tab（script 步骤）**：混用 `flex flex-col md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`，子项再用 `flex flex-col min-h-0 flex-1 md:flex-none md:h-full`
- **分镜生成 Tab 左列内容区**：`flex-1 min-h-0 overflow-y-auto pr-1`，内部渲染 `MentionedImageInput`

#### 1.4 发现的根因

##### 问题 A：分镜生成面板显示混乱
- **根因**：`StoryboardTab.tsx` 在 `step === 'script'` 时，外层同时声明了 `flex flex-col` 与 `md:grid`，且子容器残留 `flex-1 md:flex-none` 等过渡类名，导致 CSS 布局引擎在高度分配上存在二义性。
- **表现**：
  1. 两列高度无法稳健对齐，内容较少时可能出现空白不均；
  2. `flex-1` 在 grid 子项中不生效，但残留类名可能引发意外的 `min-height` 计算；
  3. `StoryboardScriptReview.tsx` 内部使用 `flex-1` 吸收剩余空间 + `max-h-[30%]` 限制聊天区，在消息较多时容易挤压底部的"确认并生成分镜"按钮，造成视觉拥挤。

##### 问题 B-1：三个图像生成 Tab 的左侧输入框 focus ring 被遮挡
- **根因**：`BasicGenerationTab.tsx`、`CharacterModelingTab.tsx`、`SceneModelingTab.tsx` 的左侧列均使用 `overflow-y-auto pr-1`，而父级 `AiImageModal` body 设置了 `overflow-hidden`。当 `textarea` 获得焦点时，`focus:ring-2` 会向外扩展 2px，但由于左侧列容器紧贴模态框内边距左边缘，没有足够的水平溢出空间，ring 被 `overflow-hidden` 截断。
- **表现**：用户点击提示词输入框后，最左侧的粉色高亮边框（focus ring）不可见或显示不完整，影响交互体验。

##### 问题 B-2：分镜生成 Tab 的左侧输入框 focus ring 被遮挡
- **根因**：`StoryboardTab.tsx` 在 `step === 'script'` 时，左列内容区同样使用 `overflow-y-auto pr-1`，内部嵌套 `MentionedImageInput`，该组件的 textarea 也使用了 `focus:ring-2 focus:ring-pink-500`，因此同样存在最左侧 ring 被截断的问题。
- **表现**：同问题 B-1。

---

### 2. 需求拆解（修订后）

#### 2.1 功能性需求

| 编号 | 需求描述 | 验收标准 |
|------|----------|----------|
| FR-1 | 修复分镜生成"剧本审核"步骤的布局稳定性 | 在 `script` 步骤下，左右两列始终等高、无内容截断、滚动条仅在需要时出现、底部确认按钮不被挤压 |
| FR-2 | 修复分镜生成各状态（input/generating/success/error）的单列布局兼容性 | 非 script 步骤时，内容垂直居中且滚动正常，无高度塌陷 |
| FR-3 | 修复基础生成 Tab 左侧输入框 focus ring 可见性 | 点击提示词 textarea 时，左右四边 ring 均完整可见，不被容器截断 |
| FR-4 | 修复人物建模 Tab 左侧输入框 focus ring 可见性 | 同 FR-3 |
| FR-5 | 修复场景建模 Tab 左侧输入框 focus ring 可见性 | 同 FR-3 |
| FR-6 | 修复分镜生成 script 步骤左列输入框 focus ring 可见性 | `MentionedImageInput` 获得焦点时，最左侧 ring 不被截断 |
| FR-7 | 保证修复不破坏参考图面板功能 | 参考图选择、@ 提及、模板卡片等交互保持原有行为 |
| FR-8 | 保证修复不破坏响应式布局 | < 768px 视口下，`StoryboardTab` script 步骤仍保持单列垂直堆叠 |

#### 2.2 非功能性需求
- **兼容性**：支持 Chrome/Edge/Firefox/Safari 最新两个主版本；Tailwind `md` 断点（≥ 768px）下必须表现正确。
- **响应式兼容性**：在 375px ~ 767px 的手机/平板视口下，布局不得崩坏，内容必须可滚动、无重叠。
- **可维护性**：仅修改 Tailwind 类名和必要的容器结构，不引入新的第三方库。
- **可测试性**：为布局修复补充至少 1 个渲染测试（验证 script 步骤下两列渲染且不溢出）。
- **性能**：不使用运行时 JavaScript 计算布局，纯 CSS 方案。

---

### 3. 技术选型说明（修订后）

| 维度 | 选择 | 理由 |
|------|------|------|
| 布局方案 | Tailwind CSS Grid + Flexbox（纯 CSS） | 与现有代码栈完全一致，零额外依赖；Grid 适合双列等高，Flex 适合内部内容流与移动端单列堆叠 |
| 截断修复 | 调整容器 `padding` + `overflow` 类名 | 无需改浏览器默认 focus 样式，通过增加 `pl-2 pr-1` 为 ring 预留绘制空间，最轻量且对内容宽度影响最小 |
| 测试框架 | Vitest + `@testing-library/react` | 项目已配置，可直接复用现有 `jsdom` 环境 |
| 构建验证 | `next build` + `tsc --noEmit` | 确保 TypeScript 类型和 Next.js 编译无回归 |

#### 3.1 不引入新技术的理由
- 问题本质为 **CSS 布局冲突** 与 **容器裁剪**，不需要新的组件库或状态管理方案。
- 现有项目已深度使用 Tailwind，追加自定义类或调整类名即可解决，符合团队现有规范。

---

### 4. 详细任务分解（修订后）

#### 任务结构图（DAG，有向无环图）

```
T1 代码审计与复现确认
│
├─→ T2 分镜生成布局修复
│   │
│   ├─→ T2.1 StoryboardTab 两列布局清理
│   └─→ T2.2 StoryboardScriptReview 内部高度分配优化
│
├─→ T3 左侧输入框 focus ring 修复
│   │
│   ├─→ T3.1 BasicGenerationTab padding 调整
│   ├─→ T3.2 CharacterModelingTab padding 调整
│   ├─→ T3.3 SceneModelingTab padding 调整
│   └─→ T3.4 StoryboardTab 左列 padding 调整
│
├─→ T4 回归测试与视觉验证
│   │
│   ├─→ T4.1 编写/更新单元测试
│   ├─→ T4.2 全量测试运行
│   └─→ T4.3 手动视觉检查清单执行
│
└─→ T5 开发总结与文档更新
```

*依赖关系验证：*
- T2 与 T3 均依赖 T1；
- T2.2 依赖 T2.1；
- T4 依赖 T2 与 T3（布局与样式修复完成后才进行回归验证）；
- T5 依赖 T4；
- **无环，DAG 有效。**

#### 任务详情

##### T1：代码审计与复现确认（0.5h）
- **范围**：确认 `StoryboardTab.tsx`、`StoryboardScriptReview.tsx`、`BasicGenerationTab.tsx`、`CharacterModelingTab.tsx`、`SceneModelingTab.tsx`、`AiImageModal.tsx` 的当前类名与嵌套结构。
- **交付物**：在本地 dev 环境打开 AI 图像生成弹窗，分别在 1920×1080、1366×768 及 375×812（移动端模拟）视口下截图，标记 layout 异常点。

##### T2.1：StoryboardTab 两列布局清理（1h）
- **具体改动**：
  1. 将 `step === 'script'` 的外层容器从混用 `flex flex-col md:grid` 改为 **保留响应式的纯 Grid**：  
     `h-full flex flex-col md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-6 gap-4 min-h-0`
  2. 左列、右列子容器移除多余的 `flex-1 md:flex-none` 与 `md:flex-none md:h-full`，统一为 `flex flex-col min-h-0 h-full overflow-hidden`。
  3. 左列内容区（`overflow-y-auto`）保留 `pr-1`（focus ring 修复由 T3.4 处理）；右列直接包裹 `StoryboardScriptReview` 并赋予 `h-full overflow-hidden`。
- **验收标准**：DevTools 中切换不同高度，确认两列 `clientHeight` 始终等于模态框 body 的可用高度；在 < 768px 视口下确认恢复为单列垂直堆叠。

##### T2.2：StoryboardScriptReview 内部高度分配优化（1h）
- **具体改动**：
  1. Shot cards 区域保持 `flex-1 min-h-0 overflow-y-auto`。
  2. 聊天面板由 `max-h-[30%]` 改为 **`shrink-0 max-h-[28%]`**，并增加 `overflow-hidden` 外层 + 内部 `overflow-y-auto`，确保自身不会弹性撑大。
  3. 错误提示与确认按钮保持 `shrink-0`。
- **验收标准**：即使 messages 数组很长，确认按钮始终可见且不被挤出视口。

##### T3.1 ~ T3.4：四 Tab 左侧输入框 focus ring 修复（1h）
- **统一改动**：
  - 将左侧列容器的 `overflow-y-auto pr-1` 改为 **`overflow-y-auto pl-2 pr-1`**。
- **推荐方案**：`pl-2 pr-1`（左侧增加 8px，右侧保持 4px），这样既能修复左侧 ring 截断，又最大化保留内容可用宽度，避免模板卡片/尺寸按钮因宽度压缩而换行。
- **影响文件**：`BasicGenerationTab.tsx`、`CharacterModelingTab.tsx`、`SceneModelingTab.tsx`、`StoryboardTab.tsx`（script 步骤左列内容区）。

##### T4.1：编写/更新单元测试（1.5h）
- **新增测试文件**：`src/components/video/components/AiImageModal/__tests__/layoutFixes.test.tsx`
- **测试用例**：
  1. `StoryboardTab` 在 `step='script'` 时，渲染左右两列容器且高度不为 0。
  2. `BasicGenerationTab` 渲染后，提示词 `textarea` 的 `focus` 状态类名存在（通过 `fireEvent.focus` 触发并断言类名包含 `focus:ring-pink-500` 对应的样式表现，或至少验证容器 padding 不为 0）。
  3. `StoryboardTab` 在 `step='script'` 时，`MentionedImageInput` 的容器具有左侧 padding。
  4. 三个 Tab 的参考图面板均正常渲染。
- **注意**：需对 `useLocale`、`listImagePacks` 等依赖进行适当 mock。

##### T4.2：全量测试运行（0.5h）
- 执行 `npm run test`（vitest run）确认现有回归测试通过。
- 执行 `npm run type-check` 确认 TypeScript 无报错。
- 执行 `npm run build`（或 `next build`）确认 Next.js 编译无报错。

##### T4.3：手动视觉检查清单（0.5h）
- [ ] 基础生成 Tab：textarea focus 时四边 ring 完整
- [ ] 人物建模 Tab：textarea focus 时四边 ring 完整
- [ ] 场景建模 Tab：textarea focus 时四边 ring 完整
- [ ] 分镜生成 script 步骤：左列 MentionedImageInput textarea focus 时四边 ring 完整
- [ ] 分镜生成 input 步骤：单列内容垂直居中，滚动正常
- [ ] 分镜生成 script 步骤：左右等高，左列可滚动，右列 shot cards 可滚动，聊天区不挤压按钮
- [ ] 分镜生成 generating/success/error 步骤：动画/结果区域无截断
- [ ] 窗口宽度 375px~767px：`StoryboardTab` script 步骤为单列堆叠，无布局崩坏
- [ ] 窗口宽度 768px~1024px：双列布局正常，无内容重叠

##### T5：开发总结与文档更新（0.5h）
- 输出变更摘要（含文件清单、类名变更对照表）。
- 更新本开发计划文档中的 "Completion Notes"。

---

### 5. 时间估算表（修订后）

| 任务编号 | 任务名称 | 预估工时 | 负责人角色 |
|----------|----------|----------|------------|
| T1 | 代码审计与复现确认 | 0.5h | 前端开发 |
| T2.1 | StoryboardTab 布局清理 | 1h | 前端开发 |
| T2.2 | StoryboardScriptReview 高度优化 | 1h | 前端开发 |
| T3.1 | BasicGenerationTab ring 修复 | 0.2h | 前端开发 |
| T3.2 | CharacterModelingTab ring 修复 | 0.2h | 前端开发 |
| T3.3 | SceneModelingTab ring 修复 | 0.2h | 前端开发 |
| T3.4 | StoryboardTab 左列 ring 修复 | 0.3h | 前端开发 |
| T4.1 | 单元测试编写 | 1.5h | 前端开发 |
| T4.2 | 全量测试运行 | 0.5h | 前端开发 |
| T4.3 | 手动视觉检查 | 0.5h | 前端开发 |
| T5 | 开发总结与文档 | 0.5h | 前端开发 |
| **合计** | | **7h** | |

*注：T3.1 ~ T3.4 结构高度雷同，实际并行修改可在 0.5h~0.7h 内完成；表中拆分是为了清晰追踪。*

---

### 6. 风险评估与缓解策略（修订后）

| 风险编号 | 风险描述 | 严重程度 | 发生概率 | 缓解策略 |
|----------|----------|----------|----------|----------|
| R1 | `StoryboardTab` Grid 重构后，在某些浏览器下 `minmax(0, xfr)` 计算异常，导致列宽塌陷 | 中 | 低 | 在 Grid 子项上保留 `min-w-0`；若测试发现异常，回退为固定比例 `md:grid-cols-2`（左）+ `md:grid-cols-3`（右）的明确类名 |
| R2 | 增加左侧列 `pl-2` 后，整体可用内容宽度略微缩小，导致模板卡片或尺寸按钮换行 | 低 | 中 | 模板卡片已使用 `flex gap-2 overflow-x-auto`，天然支持横向滚动；尺寸按钮使用 `grid-cols-3`，在 520px 左右宽度下仍可正常显示。若出现换行，可进一步将右侧面板从 `w-64` 微调为 `w-60` |
| R3 | 修改 Tailwind 类名时误删 `min-h-0`，导致 flex 子项在内容过多时撑破模态框高度 | 高 | 中 | **代码审查清单**：任何 `flex-col` + `overflow-y-auto` 的组合必须同时存在 `min-h-0`；T4 视觉检查覆盖内容填充场景 |
| R4 | 测试环境（jsdom）无法完全模拟真实视口布局，导致测试通过但实际浏览器仍有问题 | 中 | 高 | 除自动化测试外，必须在 Chrome 和 Edge 进行真实浏览器手动验证；若项目配置了 Playwright/Cypress，优先补一个截图测试 |
| R5 | `focus:ring-2` 的绘制被多层父级 `overflow-hidden` 截断，仅改一级 padding 仍无法解决 | 低 | 低 | 若 `pl-2 pr-1` 无效，可在 textarea 外层再包一层 `div` 并设置 `p-0.5`（4px）作为 "ring safe area"，保持视觉边界不变 |
| R6 | T2.1 误删 `md:` 前缀或响应式类名，导致 <768px 视口下仍强制双列，布局崩坏 | 高 | 中 | **代码审查清单**：任何对 `StoryboardTab` script 步骤外层容器的修改必须保留 `flex flex-col md:grid` 的断点结构；T4.3 必须包含移动端视口检查项 |
| R7 | 开发执行阶段遗漏对 `StoryboardTab` 左列的 focus ring 修复，导致需求未完全闭环 | 中 | 低 | T3.4 作为独立子任务纳入看板跟踪，并在 T4.3 检查清单中设置显式验收项 |

---

### 7. 关键假设（修订后）

1. **需求范围限定**：本次修复仅针对 "AI 图像生成" 弹窗（`AiImageModal` 及其子 Tab），不扩展到其他模态框或页面布局。
2. **设计规范不变**：不修改配色、字体、按钮样式，仅调整布局/间距类名。
3. **浏览器基线**：项目目标用户主要使用现代 Chromium 内核浏览器，Safari 兼容性以 iOS 16+/macOS 13+ 为基线（与 Next.js 15 + React 19 的运行要求一致）。
4. **测试覆盖**：Vitest + jsdom 足够验证组件渲染与交互；真实布局像素级问题依赖手动视觉检查。

---

### 8. 下游任务输入（修订后）

- **Subtask #1（阶段2：开发计划评审）**：✅ 已完成。重点审查项已全部闭环：T2.1 的响应式 Grid 方案、T3 的 `pl-2 pr-1` padding 方案、T3.4 的 StoryboardTab 遗漏修复、R6/R7 新增风险。
- **Subtask #2（阶段3：开发执行）**：按本计划 T1→T2→T3→T4→T5 顺序执行，严格遵循 "先修复分镜布局，再修复 focus ring，最后补测试" 的顺序，避免并行改动带来的冲突。特别注意：
  - T2.1 **必须保留** `flex flex-col md:grid` 的响应式结构；
  - T3.4 **不可遗漏**；
  - T4.2 必须执行 `next build`。
- **Subtask #3（阶段4：代码评审）**：依据本计划的验收标准（FR-1 ~ FR-8）与风险清单（R1 ~ R7）逐项检查代码 diff，重点关注 `min-h-0` 是否保留、`md:` 前缀是否完整、四 Tab 的左侧 padding 是否统一。
