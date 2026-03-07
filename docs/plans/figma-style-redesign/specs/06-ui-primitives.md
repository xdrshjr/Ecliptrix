# 06 - UI 基础组件覆写

## 概述

Ecliptrix 使用 shadcn/ui (new-york style) 作为 UI 组件库，大部分组件通过 CSS 变量控制样式。本 Spec 处理两部分：

1. **shadcn/ui 组件**：通过全局 CSS 变量改变即可影响（已在 Spec 01 处理），但部分组件可能需要额外调整圆角、间距等
2. **自定义 UI 组件**：`Toast`、`ConfirmationDialog`、`MobileWarningDialog` 共 17 处硬编码

## 涉及文件

| 文件 | 改动类型 |
|------|---------|
| `src/components/ui/Toast.tsx` | 2 处硬编码 |
| `src/components/ui/ConfirmationDialog.tsx` | 6 处硬编码 |
| `src/components/ui/MobileWarningDialog.tsx` | 9 处硬编码 |
| `src/styles/globals.css` | 添加 shadcn/ui 覆写（如需） |

## 详细设计

### 1. Toast 组件

当前：`rounded-xl shadow-lg backdrop-blur-sm`

```pseudo
改造:
  base: rounded-md shadow-lg border border-border
  去除: backdrop-blur-sm, rounded-xl

  成功: bg-card border-green-500/30 text-foreground
  错误: bg-card border-destructive/30 text-foreground
  信息: bg-card border-primary/30 text-foreground
  警告: bg-card border-yellow-500/30 text-foreground

  图标颜色保留功能色（绿/红/蓝/黄）
  关闭按钮: text-muted-foreground hover:text-foreground
```

### 2. ConfirmationDialog

```pseudo
遮罩: bg-black/60
容器: bg-card border border-border rounded-md shadow-xl
标题: text-foreground text-sm font-semibold
内容: text-muted-foreground text-sm
确认按钮: bg-destructive text-destructive-foreground（危险操作）或 bg-primary text-primary-foreground
取消按钮: bg-secondary text-secondary-foreground
按钮间距: gap-2
```

### 3. MobileWarningDialog

```pseudo
与 ConfirmationDialog 模式一致
图标: text-muted-foreground
描述: text-muted-foreground
```

### 4. shadcn/ui 全局覆写

shadcn/ui 组件已经通过 CSS 变量控制样式。当 Spec 01 的 CSS 变量更新后，以下组件会自动适应新主题。但可能需要微调：

#### 圆角调整

当前 `--radius: 0.5rem` (8px) → 改为 `6px`

这会影响所有 shadcn 组件的圆角：
- `radius-lg` = 6px
- `radius-md` = 4px
- `radius-sm` = 2px

#### 需要确认的 shadcn 组件

如果项目中通过 `npx shadcn@latest add` 安装了 shadcn 组件，它们的源码在 `src/components/ui/` 中。当前只有 4 个自定义组件。如果后续添加了 shadcn 组件（如 Button、Input、Dialog、Select 等），它们会自动使用新的 CSS 变量。

#### 额外 CSS 覆写（在 globals.css 中添加）

```pseudo
/* 确保 shadcn 组件使用新的圆角 */
[data-radix-popper-content-wrapper] {
  --radius: 6px;
}

/* Tooltip 样式 */
[role="tooltip"] {
  background: var(--popover);
  color: var(--popover-foreground);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  padding: 4px 8px;
  box-shadow: var(--shadow-lg);
}
```

### 5. 全局交互状态

确保所有可交互元素的状态一致：

```pseudo
按钮 hover:
  主按钮: opacity 降低或背景色加深
  次要按钮: bg-accent
  图标按钮: bg-accent

禁用态:
  opacity-50 cursor-not-allowed

加载态:
  动画指示器用 var(--primary)

选中/激活:
  bg-primary/10 text-primary 或 bg-primary text-primary-foreground
```

### 6. 深色/亮色模式切换

需要在应用中提供切换入口。建议方式：

```pseudo
位置: Header 右侧工具栏，在语言切换旁边
图标: 太阳/月亮图标
行为: 切换 <html> 上的 dark/light 类
持久化: localStorage 存储用户偏好
```

实现伪代码：

```pseudo
function toggleTheme():
  html = document.documentElement
  if html.classList.contains('dark'):
    html.classList.replace('dark', 'light')
    localStorage.setItem('theme', 'light')
  else:
    html.classList.replace('light', 'dark')
    localStorage.setItem('theme', 'dark')

// 初始化时读取
function initTheme():
  saved = localStorage.getItem('theme')
  if saved:
    html.className 设置为 saved
  else:
    默认 'dark'
```

## 注意事项

- shadcn/ui 组件大部分无需逐个修改，CSS 变量更新即可覆盖
- Toast 是全局唯一的通知组件，影响所有功能
- ConfirmationDialog 用于删除确认等关键操作，确保可读性
- 主题切换功能需要在 layout.tsx 中添加初始化逻辑，避免闪烁
- 考虑在 `<html>` 上添加 `style="color-scheme: dark"` 以配合浏览器原生控件
