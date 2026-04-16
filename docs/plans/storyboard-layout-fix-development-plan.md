# 分镜生成面板修复开发计划

## 1. 代码分析总结 (Code Analysis Summary)

### 1.1 项目概况
- **项目名称**: Ecliptrix — AI 驱动的视频内容创作平台
- **技术栈**: Next.js 15 (App Router) + React 19 + TypeScript 5.9 + Tailwind CSS 3.4
- **状态管理**: Zustand + React 内置 useState
- **测试框架**: Vitest 4 + @testing-library/react + jsdom
- **架构模式**: 组件化模块化架构，按功能领域分层（`components/video/`, `lib/`, `stores/`, `app/api/`）

### 1.2 相关代码结构
本次需求涉及的核心文件位于 `src/components/video/components/AiImageModal/` 目录：

| 文件 | 职责 |
|------|------|
| `AiImageModal.tsx` | AI 图像生成弹窗容器，管理 4 个 Tab（基础生成 / 人物建模 / 场景建模 / 分镜生成） |
| `StoryboardTab.tsx` | **问题核心**：分镜生成 Tab 的业务逻辑与布局 |
| `StoryboardScriptReview.tsx` | 剧本审阅与 AI 对话修改组件（已在 `script` 步骤使用左右分栏） |
| `BasicGenerationTab.tsx` | 基础生成 Tab — 采用标准的左右分栏布局（左配置 / 右参考图面板） |
| `CharacterModelingTab.tsx` | 人物建模 Tab — 同样采用左右分栏布局 |
| `SceneModelingTab.tsx` | 场景建模 Tab — 同样采用左右分栏布局 |
| `ReferenceImagePanel.tsx` | 可复用的右侧参考图选择面板 |
| `MentionedImageInput.tsx` | 支持 `@` 提及语法关联参考图的输入组件（目前内嵌在 StoryboardTab 左侧） |
| `GridSizeSelector.tsx` | 分镜数量（宫格）选择器 |

### 1.3 问题诊断
**症状**: 用户反馈 "分镜生成" 面板显示混乱，没有正确显示。

**根因**:
1. **布局不一致**: `StoryboardTab` 在 `step === 'input'`（默认状态）下使用了单列垂直居中布局 (`min-h-full flex flex-col justify-center py-4`)，而同一弹窗内的其他 3 个 Tab 均使用稳定的左右分栏 (`flex gap-6 h-full`)。
2. **视觉漂移**: 当配置项较少时，单列居中导致内容在巨大的模态框中上下浮动，缺乏视觉锚点，用户感知为 "混乱"。
3. **空间利用率低**: 宽屏下大量右侧空白未被利用，而左侧配置区域（尤其是 `MentionedImageInput` 展开后的图片选择器）又显得拥挤。

### 1.4 现有约定
- 容器类名: `flex gap-6 h-full`
- 左栏: `flex-1 min-w-0 space-y-5 overflow-y-auto pl-2 pr-1`
- 右栏: `w-64 flex-shrink-0 border-l border-border pl-6`
- 焦点环安全区: `pl-2 pr-1`
- 已有结构测试: `layoutFixes.test.tsx` 通过读取源码字符串验证关键 Tailwind 类名存在性

---

## 2. 技术选型说明 (Technical Selection & Rationale)

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 布局方案 | **左右分栏 (Left-Right Split)** | 与 `Basic/Character/Scene` 3 个 Tab 保持一致，消除用户认知不一致；符合人机交互最佳实践（F-pattern 阅读、配置与预览/辅助左右对照） |
| 右侧面板内容 | **StoryboardPreviewPanel（分镜预览面板）** | `MentionedImageInput` 已内建 `@` 提及和参考图选择能力，若强行替换为 `ReferenceImagePanel` 会损失 `@` 语法特性或导致大量重构；最轻量且增值的方案是在右侧增加**实时宫格布局预览**，既解决分栏需求，又提升用户体验 |
| 响应式策略 | 桌面端固定左右分栏，移动端保持垂直堆叠 | 项目已有 `md:` 断点使用先例（`StoryboardTab` 的 `script` 步骤），延续此模式 |
| 样式方案 | 纯 Tailwind CSS，不引入新依赖 | 与项目现有技术栈完全一致，零额外包体积 |
| 状态管理 | 维持现有本地 useState | 无需引入全局状态，预览完全依赖 props 派生 |

### 2.1 右侧面板设计决策
右侧面板将包含：
1. **动态宫格预览图**: 根据 `frameCount` 实时绘制模拟网格（使用 CSS Grid + 占位色块），让用户在生成前即可感知最终布局。
2. **画面比例示意图**: 以可视化的边框矩形直观展示当前 `aspectRatio`。
3. **配置摘要**: 简洁的文字汇总（如 "3×3 宫格，16:9 横屏，共 9 帧"）。
4. **操作提示**: 针对分镜生成流程的简短引导文案。

---

## 3. 详细的任务分解 (Detailed Task Breakdown)

### 依赖关系图
```
Task 1 (创建 StoryboardPreviewPanel)
    |
    v
Task 2 (重构 StoryboardTab 输入步骤布局)
    |
    v
Task 3 (更新/新增结构测试)
    |
    v
Task 4 (回归测试与验证)
```

### Task 1: 创建 `StoryboardPreviewPanel` 组件
- **文件**: `src/components/video/components/AiImageModal/StoryboardPreviewPanel.tsx`
- **输入**: `frameCount: number`, `aspectRatio: StoryboardAspectRatio`
- **输出**: 一个无状态展示组件
- **具体要求**:
  1. 实现 `computeOptimalGrid(frameCount)`（可复用 `GridSizeSelector` 中的算法逻辑，或提取为公共工具函数到 `src/components/video/components/AiImageModal/gridUtils.ts`）。
  2. 使用 CSS Grid 渲染预览格子（背景使用 `bg-muted` / `bg-primary/10` 交替或统一，带圆角和细边框）。
  3. 限制预览区域最大尺寸（如 `max-w-[220px]`），防止格子过多时溢出。
  4. 添加 `aspectRatio` 的可视化图标（复用 `StoryboardTab.tsx` 中的 `ratioIcon` 逻辑，或独立抽离为 `AspectRatioIcon` 组件）。
  5. 展示配置摘要文本（中文）。
  6. 组件需为 `'use client'`。

### Task 2: 重构 `StoryboardTab` 的 `input` 步骤布局
- **文件**: `src/components/video/components/AiImageModal/StoryboardTab.tsx`
- **输出**: 修复后的 `input` 步骤渲染逻辑
- **具体要求**:
  1. 将当前 `step === 'input'` 的单列布局 (`h-full flex flex-col min-h-0` + `justify-center`) 改为与其他 Tab 一致的左右分栏：
     ```tsx
     <div className="flex gap-6 h-full">
       {/* Left */}
       <div className="flex-1 min-w-0 space-y-5 overflow-y-auto pl-2 pr-1">
         {renderConfigSection()}
         {/* buttons & hints */}
       </div>
       {/* Right */}
       <div className="w-64 flex-shrink-0 border-l border-border pl-6">
         <StoryboardPreviewPanel frameCount={frameCount} aspectRatio={aspectRatio} />
       </div>
     </div>
     ```
  2. 保留 `renderConfigSection()` 的调用，但移除其中为 `input` 步骤特制的垂直居中包裹层。
  3. `generating` / `success` / `error` 步骤可维持单列全宽居中（这些属于流程反馈状态，不适合左右分栏），或者置于左栏区域内展示。推荐：在左栏区域内展示，保持整体框架不变。
  4. 确保 `step === 'script'` 的现有左右分栏布局不受任何影响。
  5. 检查 `AiImageModal.tsx` 中 `storyboard` Tab 的容器尺寸（`max-w-4xl h-[85vh]`）是否足够容纳新的分栏；评估是否需要微调（现有尺寸已足够）。

### Task 3: 提取公共网格计算逻辑（可选但推荐）
- **文件**: 新建 `src/components/video/components/AiImageModal/gridUtils.ts`
- **输入**: `frameCount: number`
- **输出**: `{ rows: number; cols: number }`
- **要求**:
  1. 将 `GridSizeSelector.tsx` 中的 `computeOptimalGrid` 提取到此文件。
  2. `GridSizeSelector.tsx` 改为从 `gridUtils.ts` import。
  3. `StoryboardPreviewPanel.tsx` 同样从 `gridUtils.ts` import。
  4. 为 `gridUtils.ts` 编写单元测试（可复用已有测试风格）。

### Task 4: 更新结构测试
- **文件**: `src/components/video/components/AiImageModal/__tests__/layoutFixes.test.tsx`
- **要求**:
  1. 新增断言：验证 `StoryboardTab.tsx` 在 `input` 步骤也使用了左右分栏的关键类名（如 `flex gap-6 h-full` 与 `w-64 flex-shrink-0`）。
  2. 新增断言：验证 `StoryboardPreviewPanel.tsx` 源码中存在预览相关的关键类名（如 `grid`）。

### Task 5: 回归测试与验证
- **命令**: `npm run type-check`, `npm run test`
- **要求**:
  1. 确保 TypeScript 无错误。
  2. 确保所有现有测试通过，包括 `layoutFixes.test.tsx` 和 `mentionUtils.test.ts`。
  3. 手动代码审查：确认 `MentionedImageInput` 的 `@` 提及弹窗在新的左右布局下不会被右侧面板遮挡（z-index 检查）。

---

## 4. 时间估算表 (Time Estimation)

| 任务 | 预估工时 | 说明 |
|------|----------|------|
| Task 1: 创建 `StoryboardPreviewPanel` | 2h | 含预览网格绘制、比例图标、摘要文案 |
| Task 2: 重构 `StoryboardTab` 布局 | 1.5h | 修改输入步骤渲染，调整 generating/success/error 的嵌套层级 |
| Task 3: 提取 `gridUtils.ts` | 0.5h | 轻量重构 + 单元测试 |
| Task 4: 更新结构测试 | 0.5h | 新增源码字符串断言 |
| Task 5: 回归测试与验证 | 0.5h | type-check + test + 人工审查 |
| **缓冲时间** | **1h** | 处理意外的样式冲突或测试调整 |
| **总计** | **6h** | — |

---

## 5. 风险评估与缓解策略 (Risk Assessment & Mitigation)

| 风险编号 | 风险描述 | 严重程度 | 发生概率 | 缓解策略 |
|----------|----------|----------|----------|----------|
| R1 | `MentionedImageInput` 的 `@` 提及弹窗在左右分栏后可能被右侧 `w-64` 面板截断或视觉重叠 | 中 | 中 | 在 Task 2 完成后立即检查 z-index 与 overflow 设置；`MentionedImageInput` 的 picker 使用 `shadow-sm` 和相对定位，若右侧面板 `overflow-hidden` 导致裁剪，可将 picker 改为 `fixed` 或 `portal` 渲染，或调整右侧面板不使用 `overflow-hidden` |
| R2 | 结构测试 `layoutFixes.test.tsx` 对类名字符串敏感，布局修改后导致断言失败 | 低 | 高 | 这是预期行为；在 Task 4 中同步更新测试断言即可。已在估算中预留时间 |
| R3 | `step === 'generating/success/error'` 嵌套在左栏后，状态反馈（如成功大图、loading 动画）的视觉重心偏左，体验不佳 | 中 | 中 | 为这些状态保留全宽单列展示，仅在 `step === 'input'` 启用左右分栏。已在 Task 2 中明确此策略 |
| R4 | 宫格数量过大（如 64 格）时，右侧预览面板格子过小不可读 | 低 | 低 | 在 `StoryboardPreviewPanel` 中限制预览容器的最小格子尺寸（`min-w-2 min-h-2`），并为超大宫格（>36）显示文字提示 "高密度宫格，预览仅作示意" |
| R5 | 移动端（小屏）下左右分栏导致左侧输入区过窄 | 低 | 中 | 延续项目现有的响应式策略：在 `md:` 断点以下使用垂直堆叠（`flex-col`），`md:` 以上使用左右分栏。Tailwind 的 `md:` 前缀已成熟使用于本组件 |

---

## 6. 验收标准 (Acceptance Criteria)

1. 打开 AI 图像生成弹窗 → 切换到 "分镜生成" Tab → 默认 (`input` 步骤) 显示为**左右分栏**布局，与其他 3 个 Tab 风格一致。
2. 左侧包含：分镜数量选择、画面比例选择、提示词输入（含 `@` 提及功能）、生成按钮。
3. 右侧包含：动态宫格预览、画面比例示意图、配置摘要。
4. 点击 "下一步：生成分镜剧本" 后进入的 `script` 步骤布局**保持原有左右分栏不变**。
5. `npm run type-check` 0 错误。
6. `npm run test` 全部通过。
7. 在常见桌面分辨率（1920×1080、1440×900）和中等模态框尺寸下无明显的元素重叠、截断或异常滚动条。
