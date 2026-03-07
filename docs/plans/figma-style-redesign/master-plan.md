# Ecliptrix Figma 风格界面改造 - 总体规划

## 项目概述

将 Ecliptrix 的整体界面风格从当前的 Apple 风格（白色毛玻璃、大圆角、blur 效果、阴影层次）改造为 Figma 风格（灰黑扁平、小圆角、线性分割、高密度紧凑布局）。

**核心原则：只做样式和风格调整，不改变任何功能逻辑和布局结构。**

## 目标

1. 建立灰黑色系的扁平化视觉体系，支持深色/亮色双模式（深色为默认）
2. 用 Figma 蓝 `#0D99FF` 作为交互反馈色（按钮、选中态、链接等）
3. 全局统一小圆角（4-6px）、高密度（12-13px 字号、8-12px 间距）
4. 去除装饰性阴影，改用 1px 细线分割区域
5. 极简微动效，只保留必要的 hover/focus 过渡
6. 字体切换为 Inter

## 范围

### 包含（In Scope）

- **全局样式**：CSS 变量、Tailwind 配置、globals.css、shadcn/ui 主题
- **全局组件**：Header、VerticalTaskbar、Container、LoginModal
- **视频编辑页**：VideoEditingInterface 及其所有子组件、Timeline、所有 Modal
- **工作流页**：WorkflowInterface、WorkflowCanvas、侧边栏、节点配置面板
- **聊天页**：ChatInterface、MessageBubble、ConversationList
- **落地页**：LandingPage 完整改造
- **管理/用户页**：AdminSettings、UserProfile
- **UI 基础组件**：所有 shadcn/ui 组件样式覆写

### 排除（Out of Scope）

- 任何功能逻辑变更
- 布局结构调整（保留现有的侧边栏+头部+内容区结构）
- 后端代码
- API 路由
- 第三方库内部样式（ReactFlow 节点除外）

## 设计规范

### 色彩体系

#### 深色模式（默认）

| 语义 | 用途 | 色值 |
|------|------|------|
| `--background` | 主画布背景 | `#1E1E1E` |
| `--foreground` | 主文本 | `#E0E0E0` |
| `--card` | 卡片/面板背景 | `#252525` |
| `--card-foreground` | 卡片文本 | `#E0E0E0` |
| `--popover` | 弹出层背景 | `#2C2C2C` |
| `--popover-foreground` | 弹出层文本 | `#E0E0E0` |
| `--primary` | 交互反馈色 | `#0D99FF` |
| `--primary-foreground` | 交互反馈文本 | `#FFFFFF` |
| `--secondary` | 次要背景 | `#333333` |
| `--secondary-foreground` | 次要文本 | `#B3B3B3` |
| `--muted` | 弱化背景 | `#2A2A2A` |
| `--muted-foreground` | 弱化文本 | `#8C8C8C` |
| `--accent` | 高亮/hover 背景 | `#383838` |
| `--accent-foreground` | 高亮文本 | `#E0E0E0` |
| `--destructive` | 错误/删除 | `#F24822` |
| `--border` | 分割线 | `#3A3A3A` |
| `--input` | 输入框背景 | `#2C2C2C` |
| `--ring` | 焦点环 | `#0D99FF` |
| `--sidebar` | 侧边栏背景 | `#2C2C2C` |
| `--sidebar-border` | 侧边栏分割线 | `#3A3A3A` |

#### 亮色模式

| 语义 | 用途 | 色值 |
|------|------|------|
| `--background` | 主画布背景 | `#F5F5F5` |
| `--foreground` | 主文本 | `#333333` |
| `--card` | 卡片/面板背景 | `#FFFFFF` |
| `--card-foreground` | 卡片文本 | `#333333` |
| `--popover` | 弹出层背景 | `#FFFFFF` |
| `--popover-foreground` | 弹出层文本 | `#333333` |
| `--primary` | 交互反馈色 | `#0C8CE9` |
| `--primary-foreground` | 交互反馈文本 | `#FFFFFF` |
| `--secondary` | 次要背景 | `#EBEBEB` |
| `--secondary-foreground` | 次要文本 | `#666666` |
| `--muted` | 弱化背景 | `#F0F0F0` |
| `--muted-foreground` | 弱化文本 | `#999999` |
| `--accent` | 高亮/hover 背景 | `#E8E8E8` |
| `--accent-foreground` | 高亮文本 | `#333333` |
| `--destructive` | 错误/删除 | `#F24822` |
| `--border` | 分割线 | `#E0E0E0` |
| `--input` | 输入框背景 | `#F0F0F0` |
| `--ring` | 焦点环 | `#0C8CE9` |
| `--sidebar` | 侧边栏背景 | `#F7F7F7` |
| `--sidebar-border` | 侧边栏分割线 | `#E0E0E0` |

### 排版

| 属性 | 值 |
|------|-----|
| 字体族 | `Inter, -apple-system, system-ui, sans-serif` |
| 基础字号 | `13px` |
| 小号文本 | `11-12px` |
| 标题 | `14-16px, font-weight: 600` |
| 行高 | `1.4` |
| 字重范围 | 400 (正文), 500 (标签), 600 (标题) |

### 间距

| 用途 | 值 |
|------|-----|
| 组件内边距 | `8px` |
| 面板内边距 | `12px` |
| 元素间距 | `4-8px` |
| 区块间距 | `12-16px` |

### 圆角

| 用途 | 值 |
|------|-----|
| 按钮/输入框 | `6px` |
| 卡片/面板 | `6px` |
| 弹出层/Modal | `6px` |
| 小元素（标签、徽章） | `4px` |
| 极小（头像） | `4px` |

### 阴影

- **去除**所有装饰性 box-shadow
- **保留**弹出层轻微阴影：`0 2px 8px rgba(0,0,0,0.15)`（仅深色模式下的浮层）
- **分割**全部用 `1px solid var(--border)` 实现

### 动效

- 全局过渡：`transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease`
- 去除 `transition: all` 通配
- 去除 `translateY` hover 位移效果
- 去除 `backdrop-filter: blur()`

## 关键设计决策

1. **深色优先**：`<html>` 默认添加 `dark` 类，用户可切换
2. **不改布局**：Header 高度、Taskbar 宽度、面板比例保持不变，只换颜色和视觉
3. **Inter 字体**：通过 `next/font/google` 加载 Inter 字体
4. **去除毛玻璃**：移除所有 `backdrop-filter: blur()` 和 `rgba` 半透明背景，改用纯色
5. **高对比分割线**：深色模式下分割线用 `#3A3A3A`（微亮于背景），亮色下用 `#E0E0E0`

## 依赖和假设

- Inter 字体通过 Google Fonts / next/font 加载，需网络或本地安装
- 现有 shadcn/ui 组件通过 CSS 变量控制样式，改变量即可影响大部分 UI
- 部分组件使用了硬编码颜色（如 `#3b82f6`、`rgba(0,0,0,0.04)` 等），需逐一替换

## 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 硬编码颜色散布在组件中 | 改造不彻底 | 通过全局搜索逐一替换 |
| 深色模式下部分组件对比度不足 | 可读性下降 | 按 WCAG AA 标准检查 |
| Timeline 组件样式复杂 | 改造耗时 | 优先处理外层容器，内部细节渐进优化 |
| ReactFlow 节点自定义样式 | 可能被覆盖 | 使用 CSS specificity 或 !important 处理 |

## Spec 文件规划

| 编号 | 文件 | 内容 |
|------|------|------|
| 01 | `global-theme.md` | 全局 CSS 变量、Tailwind 配置、globals.css、字体 |
| 02 | `shell-components.md` | Header、VerticalTaskbar、Container、LoginModal |
| 03 | `video-editing.md` | 视频编辑界面及所有子组件、Modal |
| 04 | `workflow-chat.md` | 工作流界面、聊天界面 |
| 05 | `landing-admin.md` | 落地页、管理页、用户设置页 |
| 06 | `ui-primitives.md` | shadcn/ui 组件样式覆写（Button、Input、Dialog 等） |
