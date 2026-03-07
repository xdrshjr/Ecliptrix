# 02 - 外壳组件改造

## 概述

改造应用的外壳组件：Header（顶部栏）、VerticalTaskbar（左侧任务栏）、Container（内容容器）、LoginModal（登录弹窗），将其从 Apple 风格转为 Figma 扁平风格。

**原则：保留布局结构和尺寸，只改颜色、边框、背景、阴影等视觉属性。**

## 涉及文件

| 文件 | 改动类型 |
|------|---------|
| `src/components/Header.tsx` | 替换 Tailwind 类名中的硬编码颜色 |
| `src/components/VerticalTaskbar.tsx` | 替换类名（组件用了 globals.css 中的自定义类） |
| `src/styles/globals.css` | 重写 `.vertical-taskbar` 等自定义 CSS 类 |
| `src/components/Container.tsx` | 极少改动，主要依赖全局变量 |
| `src/components/LoginModal.tsx` | 弹窗样式改造 |

## 详细设计

### 1. Header (`Header.tsx`)

当前样式特征：
- `bg-white/80 backdrop-blur-md` — 白色毛玻璃
- `border-gray-200` — 浅灰边框
- 硬编码 `text-gray-900`、`text-gray-500`、`bg-gray-100`、`hover:bg-gray-200` 等
- 下拉菜单用 `bg-white rounded-lg shadow-lg`

改造目标：

```pseudo
Header 容器:
  背景: bg-card (纯色，无 blur)
  下边框: border-b border-border
  去除: backdrop-blur-md, bg-white/80

Logo 区域:
  标题文字: text-foreground
  副标题: text-muted-foreground

图标按钮:
  背景: bg-muted hover:bg-accent
  图标色: text-muted-foreground hover:text-foreground
  圆角: rounded-md (6px), 不用 rounded-full

下拉菜单:
  背景: bg-popover
  边框: border border-border
  圆角: rounded-md
  阴影: shadow-lg (已在全局改为极轻阴影)
  选中项: text-primary bg-primary/10
  普通项: text-popover-foreground hover:bg-accent

用户头像按钮:
  背景: bg-primary (Figma 蓝)
  去除: gradient (from-blue-500 to-purple-600)
  改为: bg-primary 纯色

登录按钮:
  文字: text-muted-foreground hover:text-foreground
  背景: hover:bg-accent
  圆角: rounded-md
```

### 2. VerticalTaskbar (globals.css 中的自定义类)

当前样式特征：
- `rgba(255,255,255,0.95)` + `backdrop-filter: blur(20px)` — 白色毛玻璃
- `border-right: 1px solid rgba(0,0,0,0.06)` — 极淡边框
- 活跃按钮 `background: #3b82f6` — 硬编码蓝
- 新建按钮 `background: #3b82f6` — 硬编码蓝
- 硬编码灰色 `#374151`、`#6b7280`、`#1f2937`

改造目标：

```pseudo
.vertical-taskbar:
  background: var(--sidebar)     /* 纯色，无透明度 */
  border-right: 1px solid var(--sidebar-border)
  去除: backdrop-filter, box-shadow, rgba 背景
  hover 时: 不变色（去除 hover 背景变化）

.taskbar-button:
  color: var(--sidebar-foreground)
  hover: background: var(--accent)
  active: background: var(--primary), color: var(--primary-foreground)

.new-task-button:
  background: var(--primary)
  color: var(--primary-foreground)
  hover: 用 primary 的 hover 变体（如 opacity 0.9）

.taskbar-tab:
  color: var(--muted-foreground)
  hover: background: var(--accent), color: var(--foreground)
  active: background: var(--primary)/10, color: var(--primary)

.task-menu:
  background: var(--popover)
  border: 1px solid var(--border)
  去除: backdrop-filter, rgba 背景
  shadow: var(--shadow-lg)

.menu-item:
  color: var(--popover-foreground)
  hover: background: var(--accent)
```

### 3. Container (`Container.tsx`)

Container 组件主要是路由逻辑，极少直接样式。需检查是否有硬编码背景色或边框，替换为语义变量。

### 4. LoginModal

当前通常是白色背景 + 阴影卡片。

改造目标：

```pseudo
遮罩层:
  background: rgba(0,0,0,0.6)  /* 深色模式下半透明黑 */

弹窗容器:
  background: var(--card)
  border: 1px solid var(--border)
  border-radius: 6px
  shadow: var(--shadow-xl)
  去除: backdrop-filter

输入框:
  background: var(--input)
  border: 1px solid var(--border)
  color: var(--foreground)
  placeholder: var(--muted-foreground)
  focus: border-color: var(--ring)

按钮:
  主按钮: bg-primary text-primary-foreground hover:opacity-90
  次要按钮: bg-secondary text-secondary-foreground hover:bg-accent
```

## 硬编码颜色替换映射

以下是需要在外壳组件中搜索和替换的硬编码颜色值：

| 硬编码值 | 替换为 |
|---------|--------|
| `bg-white`, `bg-white/80` | `bg-card` |
| `text-gray-900` | `text-foreground` |
| `text-gray-700` | `text-foreground` |
| `text-gray-600` | `text-muted-foreground` |
| `text-gray-500` | `text-muted-foreground` |
| `bg-gray-100` | `bg-muted` |
| `bg-gray-200`, `hover:bg-gray-200` | `bg-accent`, `hover:bg-accent` |
| `hover:bg-gray-50` | `hover:bg-accent` |
| `border-gray-200` | `border-border` |
| `border-gray-100` | `border-border` |
| `text-blue-600` | `text-primary` |
| `bg-blue-50` | `bg-primary/10` |
| `text-red-600` | `text-destructive` |
| `hover:bg-red-50` | `hover:bg-destructive/10` |
| `shadow-lg` | `shadow-lg`（全局已重定义） |
| `backdrop-blur-md` | 移除 |
| `rounded-full`（按钮） | `rounded-md` |
| `from-blue-500 to-purple-600` | `bg-primary` |
| `#3b82f6` | `var(--primary)` |
| `#374151` | `var(--sidebar-foreground)` |
| `#6b7280` | `var(--muted-foreground)` |
| `rgba(0,0,0,0.04)` | `var(--accent)` |
| `rgba(255,255,255,0.95)` | `var(--sidebar)` |

## 注意事项

- VerticalTaskbar 的展开/折叠动画保留，只改视觉
- Header 高度 `h-14` 保持不变
- Taskbar 宽度 48px/240px 保持不变
- 下拉菜单的定位逻辑（absolute、z-index）不变
