# TODO 02 - 外壳组件改造

> 对应 Spec: `specs/02-shell-components.md`

## Header.tsx
- [x] 替换 `bg-white/80 backdrop-blur-md` 为 `bg-card`
- [x] 替换 `border-gray-200` 为 `border-border`
- [x] 替换 `text-gray-900` 为 `text-foreground`
- [x] 替换 `text-gray-500` 为 `text-muted-foreground`
- [x] 替换所有 `bg-gray-100` 为 `bg-muted`
- [x] 替换所有 `hover:bg-gray-200` 为 `hover:bg-accent`
- [x] 替换图标按钮 `rounded-full` 为 `rounded-md`
- [x] 替换图标颜色 `text-gray-600` 为 `text-muted-foreground`
- [x] 替换下拉菜单 `bg-white rounded-lg shadow-lg` 为 `bg-popover rounded-md shadow-lg`
- [x] 替换下拉菜单 `border-gray-200` 为 `border-border`
- [x] 替换选中项 `text-blue-600 bg-blue-50` 为 `text-primary bg-primary/10`
- [x] 替换菜单项 `hover:bg-gray-50` 为 `hover:bg-accent`
- [x] 替换用户头像 gradient 为 `bg-primary`
- [x] 替换用户下拉菜单样式（同上述下拉菜单模式）
- [x] 替换 `text-red-600 hover:bg-red-50` 为 `text-destructive hover:bg-destructive/10`
- [x] 替换登录按钮 `text-gray-700` 为 `text-muted-foreground`

## VerticalTaskbar (globals.css)
- [x] `.vertical-taskbar` 背景改为 `var(--sidebar)`
- [x] 移除 `backdrop-filter: blur(20px)`
- [x] 移除 `-webkit-backdrop-filter: blur(20px)`
- [x] 边框改为 `border-right: 1px solid var(--sidebar-border)`
- [x] 移除 `box-shadow`
- [x] 移除 hover 背景变化
- [x] `.taskbar-button` color 改为 `var(--sidebar-foreground)`
- [x] `.taskbar-button:hover` background 改为 `var(--accent)`
- [x] `.taskbar-button.active` background 改为 `var(--primary)`，color 改为 `var(--primary-foreground)`
- [x] `.new-task-button` background 改为 `var(--primary)`
- [x] `.new-task-button:hover` background 改为 `var(--primary)` with opacity
- [x] `.taskbar-tab` color 改为 `var(--muted-foreground)`
- [x] `.taskbar-tab:hover` 改用 `var(--accent)` 和 `var(--foreground)`
- [x] `.taskbar-tab.active` 改用 `var(--primary)` 系列
- [x] `.task-menu` 去除 backdrop-filter，背景改为 `var(--popover)`
- [x] `.task-menu` 边框改为 `var(--border)`
- [x] `.task-menu` box-shadow 改为 `var(--shadow-lg)`
- [x] `.menu-item` 颜色改用语义变量
- [x] `.section-divider` 改为 `var(--border)`
- [x] `.vertical-taskbar.blurred` 保持不变（功能性模糊）
- [x] 替换所有硬编码 rgba 值为 CSS 变量

## LoginModal
- [x] 遮罩层背景改为 `rgba(0,0,0,0.6)`
- [x] 弹窗容器改为 `bg-card border border-border rounded-md`
- [x] 输入框改为 `bg-input border border-border`
- [x] 按钮改为 `bg-primary text-primary-foreground`
- [x] 移除可能的 backdrop-filter

## Container.tsx
- [x] 检查是否有硬编码颜色，替换为语义变量

## 验证
- [x] Header 在深色/亮色模式下显示正常
- [x] Taskbar 展开/折叠动画正常
- [x] 下拉菜单定位和交互正常
- [x] 登录弹窗显示正常
