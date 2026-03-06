# TODO 05 - 落地页 + 管理页 + 用户设置页改造

> 对应 Spec: `specs/05-landing-admin.md`

## 落地页 (globals.css 中的 .landing-* 类)
- [x] `.landing-page` 背景改为 `var(--background)`，去除 `#f5f5f7`
- [x] 简化或移除 `.landing-background` 系列（纯色背景即可）
- [x] 移除 `.landing-background-overlay` 渐变叠加
- [x] `.landing-title` 改为 `color: var(--foreground)`，去除 gradient + background-clip
- [x] `.landing-subtitle` 改为 `color: var(--muted-foreground)`
- [x] `.landing-description` 改为 `color: var(--muted-foreground)`
- [x] `.landing-cta-primary` 改为纯色 `var(--primary)`，圆角改为 6px
- [x] `.landing-cta-primary` 去除 `box-shadow` 和 `translateY` hover 效果
- [x] `.landing-cta-primary:hover` 改为 `opacity: 0.9`
- [x] `.landing-cta-secondary` 改为 `border: 1px solid var(--primary)`，背景透明
- [x] `.landing-cta-secondary` 圆角改为 6px，去除 rgba 背景
- [x] `.landing-feature-card` 改为 `var(--card)`，边框 `var(--border)`，圆角 6px
- [x] `.landing-feature-card` 去除 `backdrop-filter`、`box-shadow`、`translateY` hover
- [x] `.landing-feature-card:hover` 改为 `border-color` 微变化
- [x] `.landing-feature-icon` 去除 `box-shadow`，改为 `var(--primary)/10` 背景
- [x] `.landing-feature-icon` 圆角改为 6px
- [x] `.landing-feature-title` 改为 `var(--foreground)`
- [x] `.landing-feature-description` 改为 `var(--muted-foreground)`
- [x] `.landing-stat-value` 改为 `color: var(--primary)`，去除 gradient
- [x] `.landing-stat-label` 改为 `var(--muted-foreground)`
- [x] 保留响应式 `@media` 查询，只改颜色

## LandingPage.tsx
- [x] 检查组件内是否有内联硬编码颜色，替换为语义类名

## AdminSettingsPage.tsx (6 处)
- [x] 替换页面容器背景为 `bg-background`
- [x] 替换其他硬编码颜色

## SettingsSidebar.tsx (6 处)
- [x] 替换侧边栏背景为 `bg-card`
- [x] 替换边框为 `border-border`
- [x] 替换菜单项颜色和选中态

## UserManagement.tsx (63 处)
- [x] 替换表格容器 `bg-white` 为 `bg-card`
- [x] 替换表头 `bg-gray-*` 为 `bg-muted`
- [x] 替换表头文字为 `text-muted-foreground`
- [x] 替换表格行 hover 为 `hover:bg-accent`
- [x] 替换表格行边框为 `border-border`
- [x] 替换单元格文字颜色为语义变量
- [x] 替换角色标签样式（admin: `bg-primary/10 text-primary`）
- [x] 替换状态标签样式
- [x] 替换操作按钮样式（编辑、删除）
- [x] 替换分页按钮样式
- [x] 替换搜索栏样式
- [x] 替换所有 `rounded-lg` 为 `rounded-md`
- [x] 移除装饰性阴影

## UserProfilePage.tsx (2 处)
- [x] 替换页面容器背景

## UserProfileSidebar.tsx (8 处)
- [x] 替换侧边栏样式，与 SettingsSidebar 保持一致

## UserInfoPanel.tsx (13 处)
- [x] 替换表单标签颜色为 `text-muted-foreground`
- [x] 替换输入框样式为 `bg-input border-border`
- [x] 替换头像区域背景
- [x] 替换保存按钮为 `bg-primary text-primary-foreground`

## OtherSettingsPanel.tsx (22 处)
- [x] 替换设置项容器样式
- [x] 替换切换开关颜色（开启: `bg-primary`，关闭: `bg-muted`）
- [x] 替换标签和描述文字颜色
- [x] 替换所有硬编码边框颜色

## 验证
- [x] 落地页在深色模式下视觉完整
- [x] 落地页在亮色模式下视觉完整
- [x] 落地页响应式布局正常
- [x] CTA 按钮点击跳转正常
- [x] 管理页表格渲染、分页、搜索正常
- [x] 用户设置表单编辑和保存正常
