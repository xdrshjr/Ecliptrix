# TODO 06 - UI 基础组件覆写

> 对应 Spec: `specs/06-ui-primitives.md`

## Toast.tsx
- [x] 替换 `rounded-xl` 为 `rounded-md`
- [x] 移除 `backdrop-blur-sm`
- [x] 更新各类型 Toast 背景为 `bg-card` + 对应功能色边框
- [x] 更新关闭按钮为 `text-muted-foreground hover:text-foreground`

## ConfirmationDialog.tsx (6 处)
- [x] 遮罩层改为 `bg-black/60`
- [x] 容器改为 `bg-card border border-border rounded-md shadow-xl`
- [x] 标题改为 `text-foreground`
- [x] 内容改为 `text-muted-foreground`
- [x] 确认按钮改为 `bg-destructive text-destructive-foreground` 或 `bg-primary`
- [x] 取消按钮改为 `bg-secondary text-secondary-foreground`

## MobileWarningDialog.tsx (9 处)
- [x] 与 ConfirmationDialog 保持一致的改造模式
- [x] 图标颜色改为 `text-muted-foreground`
- [x] 描述文字改为 `text-muted-foreground`
- [x] 按钮样式改为语义化

## shadcn/ui 全局覆写 (globals.css)
- [x] 添加 `[data-radix-popper-content-wrapper]` 圆角覆写
- [x] 添加 `[role="tooltip"]` 样式覆写（bg-popover, border, 小字号）
- [x] 确认 CSS 变量更新后 shadcn 组件自动适配

## 深色/亮色模式切换
- [x] 在 Header.tsx 工具栏添加主题切换按钮（太阳/月亮图标）
- [x] 实现 `toggleTheme()` 函数：切换 `<html>` 的 dark/light 类
- [x] 实现 `initTheme()` 函数：从 localStorage 读取并应用
- [x] 在 layout.tsx 中添加初始化脚本（内联 script 避免闪烁）
- [x] 在 `<html>` 添加 `style="color-scheme: dark"` 配合浏览器原生控件

## 全局交互状态一致性检查
- [x] 检查所有按钮 hover 状态使用语义变量
- [x] 检查所有禁用态使用 `opacity-50 cursor-not-allowed`
- [x] 检查所有加载态动画使用 `var(--primary)`
- [x] 检查所有选中/激活态使用 `bg-primary/10 text-primary`

## 最终验证
- [x] `npm run build` 构建成功
- [x] `npm run type-check` 类型检查通过
- [ ] 深色模式：所有页面视觉一致、无残留白色/浅色
- [ ] 亮色模式：所有页面视觉一致、无残留深色
- [ ] 主题切换：无闪烁、localStorage 持久化正常
- [ ] 所有功能交互不受影响（视频编辑、工作流、聊天等）
- [ ] 滚动条样式正常
- [ ] 焦点样式（Tab 导航）正常
- [ ] 响应式布局不受影响
