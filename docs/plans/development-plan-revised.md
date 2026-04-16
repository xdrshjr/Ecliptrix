# 分镜生成面板修复开发计划（评审修订版）

> **阶段**: 阶段2 — 开发计划评审与修正  
> **评审依据**: Phase 1 原始计划、实际代码库结构、现有 UI 约定与工程实践  
> **输出状态**: 已确认，可直接进入阶段3执行

---

## 目录
1. [Review Findings & Comments（评审意见）](#1-review-findings--comments评审意见)
2. [Revision Log（修正记录）](#2-revision-log修正记录)
3. [Final Confirmed Development Plan（最终确认开发计划）](#3-final-confirmed-development-plan最终确认开发计划)

---

## 1. Review Findings & Comments（评审意见）

### 1.1 代码分析总结 — 总体准确，补充 3 项细节
- **准确**: 原始计划对 `StoryboardTab.tsx` 的 `input` 步骤单列居中布局与其他 Tab 左右分栏不一致的诊断完全正确。
- **补充**: 
  1. `StoryboardTab` 的 `script` 步骤已经采用 `md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]` 的左右分栏，但比例是 **2:3**（左窄右宽），而 `Basic/Character/Scene` Tab 使用的是 **flex 自适应左侧 + 固定 w-64 右侧**。这导致 `input` 步骤改造后，左右比例与 `script` 步骤仍不一致——这是合理且必要的，因为 `script` 步骤右侧需要更大的剧本编辑区，`input` 步骤右侧预览面板不需要那么宽。
  2. `MentionedImageInput` 的 `@` 提及弹窗是在 **左栏 DOM 内部 inline 渲染** 的，并非 portal/overlay 横跨到右侧面板。原始计划的 R1（z-index 截断风险）被高估。
  3. `AiImageModal.tsx` 中 storyboard 容器为 `max-w-4xl h-[85vh]`，比其他 Tab 的 `h-[80vh]` 更高，但 `input` 步骤当前内容紧凑居中。改为左右分栏后，左侧配置项垂直堆叠会变长，需验证在较小视口（如 1366×768）下左栏是否出现不必要的滚动或拥挤。

### 1.2 技术选型说明 — 方向正确，存在 2 项遗漏
- **正确**: 采用左右分栏 + `StoryboardPreviewPanel` 的决策轻量且增值，避免了强行替换 `MentionedImageInput` 导致 `@` 语法功能丢失的重构。
- **遗漏**:
  1. **i18n 遗漏**: 原始计划要求预览面板文案“中文”，但项目中 `ReferenceImagePanel` 和 `MentionedImageInput` 均使用 `useLocale()` 上下文实现多语言。新增组件应遵循同一约定，否则将引入技术债。
  2. **可访问性遗漏**: 动态宫格预览是纯视觉元素，未提及 ARIA 标注（如 `aria-label` 描述配置摘要），不符合人机交互最佳实践的完整定义。

### 1.3 任务分解 — 粒度合理，依赖关系需修正
- **优点**: 5 个任务覆盖实现、重构、测试、回归全链路，粒度适中。
- **问题**:
  1. **依赖图不准确**: Task 3（提取 `gridUtils.ts`）与 Task 1/2 无强依赖，可并行执行。原始计划未将其放入依赖图，且默认隐含串行，低估了调度灵活性。
  2. **Task 2 描述存在歧义**: 对 `generating/success/error` 步骤的处理建议前后矛盾——一边说“可维持单列全宽居中”，一边又说“推荐：在左栏区域内展示，保持整体框架不变”。需在计划中明确唯一策略，避免执行阶段理解分歧。

### 1.4 时间估算 — 总体合理，Task 5 偏乐观
- **评估**:
  - Task 1 (2h): 合理，含设计决策与组件实现。
  - Task 2 (1.5h): 合理，布局重构涉及条件分支拆分。
  - Task 3 (0.5h): 合理，轻量提取 + 单元测试。
  - Task 4 (0.5h): 合理。
  - **Task 5 (0.5h → 建议 1h)**: 结构测试对源码字符串敏感，一旦类名调整需反复修正；同时 `type-check` 在 Vitest + tsconfig `jsx: "preserve"` 环境下可能暴露隐式类型问题。0.5h 偏紧。
- **总计**: 建议从 6h 调整至 **6.5h**。

### 1.5 风险评估 — 5 项风险，1 项高估、1 项缺失
- **R1 高估**: `@` 提及弹窗截断风险实际概率为“低”而非“中”。弹窗在左栏内部渲染，右侧面板 `w-64` 不会对其造成遮挡。
- **R3 描述矛盾**: 同 1.3 所述，策略不统一导致风险定义模糊。
- **R4 过度设计**: 在 `max-w-[220px]` 预览区中，64 格宫格每格仍有约 27px，肉眼可读。增加“高密度提示”属于过度设计。
- **缺失风险 R6**: `AiImageModal` 容器高度与宽度在左右分栏后可能导致左栏内容溢出或右侧面板空白过多，需在开发中验证。

### 1.6 验收标准 — 完整，建议补充 2 条
- 建议补充:
  8. `StoryboardPreviewPanel` 应接入 `useLocale()` 或至少预留 i18n 接口，不硬编码中文。
  9. 桌面端常见分辨率（1920×1080、1440×900、1366×768）下左栏与右面板均不应出现水平滚动条或内容截断。

---

## 2. Revision Log（修正记录）

| # | 修正项 | 原始内容 | 修正原因 | 修订后内容 |
|---|--------|----------|----------|------------|
| 1 | 右侧面板 i18n | 原始计划要求“配置摘要文本（中文）” | 与项目 `useLocale` 约定冲突，会引入技术债 | `StoryboardPreviewPanel` 需使用 `useLocale()`（或接收 `locale` prop），摘要文案通过 i18n 键值获取，默认支持 zh/en |
| 2 | generating/success/error 布局策略 | 原始计划描述矛盾：一边说“可维持单列全宽居中”，一边“推荐在左栏区域内展示” | 执行阶段易产生歧义 | 统一策略：**所有步骤均保持在同一左右分栏外框架内**。`input` 步骤左右两栏均正常显示；`generating/success/error` 步骤右侧面板可简化显示（如仅保留配置摘要），状态反馈内容在左栏内垂直居中展示，避免整个模态框布局在步骤切换时发生跳动 |
| 3 | 依赖关系图 | Task 3 不在依赖图中，隐含在 Task 2 之后串行 | `gridUtils.ts` 提取是独立重构，可与 Task 1 并行 | 将 Task 3 标记为与 Task 1 并行，Dependency DAG 更新为：`Task 1 || Task 3 → Task 2 → Task 4 → Task 5` |
| 4 | Task 5 工时 | 0.5h | 结构测试敏感 + type-check 可能多次迭代 | **1h** |
| 5 | 风险 R1 | 严重程度“中”、发生概率“中” | 弹窗在左栏内部渲染，不会跨栏被截断 | 下调为 **严重程度“低”、发生概率“低”**，缓解策略简化为：检查左栏 `overflow` 设置即可 |
| 6 | 风险 R3/R4 | R3 策略矛盾；R4 认为 64 格不可读 | R3 因策略统一已消解；R4 在 220px 宽度下 27px/格足够可读 | **删除 R3、R4**，合并为一条新风险：步骤切换时视觉重心跳动 |
| 7 | 新增风险 R6 | 无 | 左右分栏后容器尺寸可能暴露新问题 | 新增 **R6: `AiImageModal` 容器在 1366×768 等较小桌面分辨率下出现左栏溢出或右侧面板空白过多**，严重度“中”，概率“中”，缓解策略：开发时在此分辨率下做快速视觉验证，必要时微调 `max-w` 或增加 `lg:` 断点 |
| 8 | 测试策略补充 | 仅提及新增类名字符串断言 | 字符串测试无法验证条件分支布局 | 补充说明：结构测试只能验证源码中存在目标类名字符串，无法区分 `step === 'input'` 与 `step === 'script'` 分支。建议新增 **渲染路径断言**（如通过正则确保 `input` 分支的 `flex gap-6 h-full` 与 `script` 分支的 `md:grid` 同时存在于文件中） |
| 9 | 图标复用 | 原始计划提到“复用 ratioIcon 逻辑，或独立抽离” | 避免 `StoryboardTab.tsx` 与 `StoryboardPreviewPanel.tsx` 各自维护一份 SVG | 明确要求：将 `ratioIcon` 从 `StoryboardTab.tsx` **提取为独立组件** `AspectRatioIcon.tsx`，两处共同引用 |
| 10 | 右侧面板 overflow | 未提及 | 右侧面板内容（摘要 + 预览 + 提示）可能超出高度 | 明确要求：右侧面板根容器使用 `overflow-y-auto` 以应对内容溢出 |
| 11 | 可访问性 | 未提及 | 符合“人机交互最佳实践”的验收要求 | 明确要求：`StoryboardPreviewPanel` 的宫格预览区需包含 `aria-label`，用自然语言描述当前配置（如“16:9 横屏，3×3 共 9 格分镜预览”） |
| 12 | 总工时 | 6h | 上述调整 | **6.5h**（含 1h 缓冲） |

---

## 3. Final Confirmed Development Plan（最终确认开发计划）

### 3.1 代码分析总结 (Code Analysis Summary)

#### 项目概况
- **项目名称**: Ecliptrix — AI 驱动的视频内容创作平台
- **技术栈**: Next.js 15 (App Router) + React 19 + TypeScript 5.9 + Tailwind CSS 3.4
- **状态管理**: Zustand + React 内置 useState
- **测试框架**: Vitest 4 + @testing-library/react + jsdom
- **i18n**: `useLocale()` from `@/contexts/LocaleContext`
- **架构模式**: 组件化模块化架构，按功能领域分层

#### 相关代码结构
| 文件 | 职责 |
|------|------|
| `AiImageModal.tsx` | AI 图像生成弹窗容器，管理 4 个 Tab |
| `StoryboardTab.tsx` | **问题核心**：`input` 步骤使用单列垂直居中 (`justify-center`)，与兄弟 Tab 的左右分栏 (`flex gap-6 h-full`) 不一致；`script` 步骤已使用 `md:grid` 左右分栏 |
| `StoryboardScriptReview.tsx` | 剧本审阅组件（`script` 步骤右侧内容） |
| `BasicGenerationTab.tsx` | 基础生成 Tab — 标准 `flex gap-6 h-full` + 左栏 `flex-1` + 右栏 `w-64` |
| `CharacterModelingTab.tsx` | 人物建模 Tab — 同上 |
| `SceneModelingTab.tsx` | 场景建模 Tab — 同上 |
| `ReferenceImagePanel.tsx` | 可复用的右侧参考图选择面板 |
| `MentionedImageInput.tsx` | 支持 `@` 提及语法关联参考图的输入组件 |
| `GridSizeSelector.tsx` | 分镜数量（宫格）选择器，内含 `computeOptimalGrid` |

#### 问题诊断
**症状**: 用户反馈“分镜生成”面板显示混乱，没有正确显示。

**根因**:
1. **布局不一致**: `StoryboardTab` 在 `step === 'input'`（默认状态）下使用单列垂直居中布局，而同一弹窗内其他 3 个 Tab 均使用稳定的左右分栏。
2. **视觉漂移**: 配置项较少时，单列居中导致内容在模态框中上下浮动，缺乏视觉锚点。
3. **空间利用率低**: 宽屏下右侧大量空白未被利用，左侧 `MentionedImageInput` 展开后又显得拥挤。

---

### 3.2 技术选型说明 (Technical Selection & Rationale)

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 布局方案 | **左右分栏 (Left-Right Split)** | 与其他 Tab 保持一致；F-pattern 阅读、配置与预览左右对照，符合人机交互最佳实践 |
| 右侧面板内容 | **StoryboardPreviewPanel（分镜预览面板）** | `MentionedImageInput` 内建了 `@` 提及和参考图选择，强行替换会损失核心功能或导致大量重构；右侧增加实时宫格预览是最轻量且增值的方案 |
| 响应式策略 | 桌面端固定左右分栏，移动端垂直堆叠 | 延续项目现有 `md:` 断点模式 |
| 样式方案 | 纯 Tailwind CSS，零新依赖 | 与现有技术栈完全一致 |
| 状态管理 | 维持现有本地 useState | 预览完全依赖 props 派生，无需全局状态 |
| i18n | 使用 `useLocale()` | 与 `ReferenceImagePanel`、`MentionedImageInput` 保持一致，避免硬编码 |

#### 右侧面板内容
1. **动态宫格预览图**: 根据 `frameCount` 与 `aspectRatio` 实时绘制模拟网格（CSS Grid + 占位色块）。
2. **画面比例示意图**: 复用/抽离的 `AspectRatioIcon` 组件。
3. **配置摘要**: 简洁文字汇总（通过 i18n）。
4. **操作提示**: 针对分镜生成流程的简短引导文案（通过 i18n）。
5. **无障碍支持**: `aria-label` 用自然语言描述当前配置。

---

### 3.3 详细的任务分解 (Detailed Task Breakdown)

#### 依赖关系图（DAG，无环）
```
Task 1 (创建 StoryboardPreviewPanel) ---------
                                              \
                                               v
Task 3 (提取 gridUtils.ts + AspectRatioIcon) ----> Task 2 (重构 StoryboardTab 布局)
                                              /
                                             /
                                            v
                                      Task 4 (更新结构测试)
                                            /
                                           v
                                      Task 5 (回归测试与验证)
```

> **说明**: Task 1 与 Task 3 可并行；Task 2 需等待 Task 1 和 Task 3 的输出；Task 4 依赖 Task 2；Task 5 依赖 Task 4。

---

#### Task 1: 创建 `StoryboardPreviewPanel` 组件
- **文件**: `src/components/video/components/AiImageModal/StoryboardPreviewPanel.tsx`
- **输入**: `frameCount: number`, `aspectRatio: StoryboardAspectRatio`, `locale?: 'zh' | 'en'`
- **输出**: 无状态展示组件
- **具体要求**:
  1. 从 `gridUtils.ts`（Task 3 产出）import `computeOptimalGrid`。
  2. 使用 CSS Grid 渲染预览格子（背景 `bg-muted` / `bg-primary/10` 交替，圆角、细边框）。
  3. 限制预览区域最大尺寸 `max-w-[220px]`，防止格子过多时溢出。
  4. 从 `AspectRatioIcon.tsx`（Task 3 产出）import 比例图标。
  5. 使用 `useLocale()` 获取摘要与提示文案；若 locale 上下文不便在测试环境挂载，可接收可选 `locale` prop 兜底。
  6. 根容器添加 `overflow-y-auto` 以处理内容溢出。
  7. 宫格预览区需有 `aria-label`，内容如 `"${aspectRatio} 分镜预览，${rows}×${cols} 共 ${frameCount} 格"`。
  8. 组件需为 `'use client'`。

---

#### Task 2: 重构 `StoryboardTab` 的 `input` 步骤布局
- **文件**: `src/components/video/components/AiImageModal/StoryboardTab.tsx`
- **输出**: 修复后的 `input` 步骤及统一的全步骤外框架
- **具体要求**:
  1. 将 `step === 'input'` 的单列布局改为与其他 Tab 一致的左右分栏：
     ```tsx
     <div className="flex gap-6 h-full">
       {/* Left */}
       <div className="flex-1 min-w-0 space-y-5 overflow-y-auto pl-2 pr-1">
         {renderConfigSection()}
         {/* buttons, hints, generating/success/error states */}
       </div>
       {/* Right */}
       <div className="w-64 flex-shrink-0 border-l border-border pl-6 overflow-y-auto">
         <StoryboardPreviewPanel
           frameCount={frameCount}
           aspectRatio={aspectRatio}
           locale={locale}
         />
       </div>
     </div>
     ```
  2. **统一策略**: `generating` / `success` / `error` 步骤不再跳出左右分栏框架，而是继续渲染同一框架，但右侧面板保持显示（提供连续性），状态反馈内容在左栏内部垂直居中展示。
  3. 保留 `renderConfigSection()` 调用，但移除 `input` 步骤专属的 `justify-center` 包裹层。
  4. `step === 'script'` 的现有 `md:grid` 布局**不受任何影响**。
  5. 检查 `AiImageModal.tsx` 中 `storyboard` Tab 的容器尺寸，必要时微调（现有 `max-w-4xl h-[85vh]` 预计足够）。
  6. 将 `ratioIcon` 的引用替换为从 `AspectRatioIcon.tsx` import。

---

#### Task 3: 提取公共工具与图标组件
- **子任务 3a — 提取 `gridUtils.ts`**:
  - **文件**: `src/components/video/components/AiImageModal/gridUtils.ts`
  - 将 `GridSizeSelector.tsx` 中的 `computeOptimalGrid` 提取到此文件。
  - `GridSizeSelector.tsx` 改为从 `gridUtils.ts` import。
  - 为 `gridUtils.ts` 编写单元测试（复用已有测试风格）。

- **子任务 3b — 提取 `AspectRatioIcon.tsx`**:
  - **文件**: `src/components/video/components/AiImageModal/AspectRatioIcon.tsx`
  - 将 `StoryboardTab.tsx` 中的 `ratioIcon` 函数提取为独立 React 组件。
  - 接口: `interface AspectRatioIconProps { variant: 'square' | 'landscape' | 'portrait'; active?: boolean; className?: string; }`
  - `StoryboardTab.tsx` 与 `StoryboardPreviewPanel.tsx` 均从此组件 import。

---

#### Task 4: 更新结构测试
- **文件**: `src/components/video/components/AiImageModal/__tests__/layoutFixes.test.tsx`
- **要求**:
  1. 新增断言：验证 `StoryboardTab.tsx` 源码中存在 `input` 步骤左右分栏的关键类名（`flex gap-6 h-full`、`w-64 flex-shrink-0`）。
  2. 新增断言：验证 `StoryboardPreviewPanel.tsx` 源码中存在预览相关的关键类名（如 `grid`、`overflow-y-auto`、`aria-label`）。
  3. 新增断言：验证 `AspectRatioIcon.tsx` 文件存在且被 `StoryboardTab.tsx` 引用（通过检查 import 语句或文件存在性）。
  4. **说明**: 由于现有测试采用“读取源码字符串”方式，无法验证条件分支级别的渲染路径，因此断言目标调整为**确认相关类名字符串存在于文件中**。

---

#### Task 5: 回归测试与验证
- **命令**: `npm run type-check`, `npm run test`
- **要求**:
  1. TypeScript 0 错误。
  2. 所有现有测试通过，包括 `layoutFixes.test.tsx`、`mentionUtils.test.ts`、`referenceImageRegression.test.tsx`。
  3. 手动代码审查：确认 `MentionedImageInput` 的 `@` 提及弹窗在新的左右布局下正常工作（左栏 `overflow-y-auto` 不会裁剪其内部 inline 弹窗）。
  4. 视觉验证：在 1920×1080、1440×900、1366×768 分辨率下检查无元素重叠、截断或异常滚动条。

---

### 3.4 时间估算表 (Time Estimation)

| 任务 | 预估工时 | 说明 |
|------|----------|------|
| Task 1: 创建 `StoryboardPreviewPanel` | 2h | 含预览网格、比例图标、i18n 摘要、aria-label |
| Task 2: 重构 `StoryboardTab` 布局 | 1.5h | 拆分 input/script 渲染分支，统一全步骤外框架 |
| Task 3a: 提取 `gridUtils.ts` | 0.3h | 轻量提取 + 单元测试 |
| Task 3b: 提取 `AspectRatioIcon.tsx` | 0.2h | 图标组件化 + 两处替换 |
| Task 4: 更新结构测试 | 0.5h | 新增源码字符串断言 |
| Task 5: 回归测试与验证 | **1h** | type-check + test + 多分辨率视觉审查 |
| **缓冲时间** | **1h** | 处理意外样式冲突或测试调整 |
| **总计** | **6.5h** | — |

---

### 3.5 风险评估与缓解策略 (Risk Assessment & Mitigation)

| 风险编号 | 风险描述 | 严重程度 | 发生概率 | 缓解策略 |
|----------|----------|----------|----------|----------|
| R1 | `MentionedImageInput` 的 `@` 提及弹窗被右侧面板截断 | 低 | 低 | 弹窗在左栏 DOM 内部 inline 渲染，不跨越到右侧面板；只需确认左栏未设置不合理的 `overflow-hidden` 即可 |
| R2 | 结构测试 `layoutFixes.test.tsx` 对类名字符串敏感，布局修改后断言失败 | 低 | 高 | 预期行为；Task 4 中同步更新断言即可，已预留工时 |
| R3 | 步骤切换（`input` → `generating` → `success`）时，若外框架不稳定会产生视觉跳动 | 中 | 中 | 统一策略：所有步骤共享同一 `flex gap-6 h-full` 外框架；仅左栏内容根据 `step` 切换，右侧面板始终显示 |
| R5 | 移动端（小屏）下左右分栏导致左侧输入区过窄 | 低 | 中 | 延续项目现有响应式策略：`md:` 以下使用垂直堆叠（`flex-col`），`md:` 以上使用左右分栏 |
| **R6** | `AiImageModal` 容器在较小桌面分辨率（如 1366×768）下出现左栏溢出或右侧面板空白过多 | 中 | 中 | 开发时在此分辨率下做快速视觉验证；必要时微调 `max-w` 或增加 `lg:` 断点适配 |

---

### 3.6 验收标准 (Acceptance Criteria)

1. 打开 AI 图像生成弹窗 → 切换到“分镜生成” Tab → 默认 (`input` 步骤) 显示为**左右分栏**布局，与其他 3 个 Tab 风格一致。
2. 左侧包含：分镜数量选择、画面比例选择、提示词输入（含 `@` 提及功能）、生成按钮。
3. 右侧包含：动态宫格预览、画面比例示意图、配置摘要（通过 i18n）。
4. 点击“下一步：生成分镜剧本”后进入的 `script` 步骤布局**保持原有左右分栏不变**。
5. `generating` / `success` / `error` 步骤不跳出左右分栏框架，右侧面板持续显示，状态反馈在左栏内展示。
6. `npm run type-check` 0 错误。
7. `npm run test` 全部通过。
8. `StoryboardPreviewPanel` 使用 `useLocale()` 或等效 i18n 机制，不硬编码中文。
9. 宫格预览区具备描述当前配置的 `aria-label`。
10. 在常见桌面分辨率（1920×1080、1440×900、1366×768）和中等模态框尺寸下无明显的元素重叠、截断或异常滚动条。

---

### 3.7 执行注意事项 (Execution Notes for Phase 3)

- **优先级**: 先并行完成 Task 1 与 Task 3，再进入 Task 2。
- **代码风格**: 新增组件遵循目录内现有命名（PascalCase 组件文件 + `use client` 指令）。
- **测试风格**: 单元测试复用 `vitest` + `describe/it/expect`；结构测试延续“读取源码字符串”模式。
- **commit 建议**: 按 Task 拆分 commit（Task 1 → Task 3 → Task 2 → Task 4 → Task 5），便于后续代码评审。
