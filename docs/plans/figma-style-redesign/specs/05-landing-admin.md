# 05 - 落地页 + 管理页 + 用户设置页改造

## 概述

落地页样式在 `globals.css` 中以自定义 CSS 类定义（Apple 风格），管理页有 75 处硬编码颜色，用户设置页有 45 处。

## 涉及文件

| 文件 | 改动类型 |
|------|---------|
| `src/styles/globals.css` | 重写 `.landing-*` 系列 CSS 类 |
| `src/components/HomePage/LandingPage.tsx` | 替换内联类名（如有） |
| `src/components/AdminSettings/UserManagement.tsx` | 63 处硬编码 |
| `src/components/AdminSettings/AdminSettingsPage.tsx` | 6 处 |
| `src/components/AdminSettings/SettingsSidebar.tsx` | 6 处 |
| `src/components/UserProfile/OtherSettingsPanel.tsx` | 22 处 |
| `src/components/UserProfile/UserInfoPanel.tsx` | 13 处 |
| `src/components/UserProfile/UserProfileSidebar.tsx` | 8 处 |
| `src/components/UserProfile/UserProfilePage.tsx` | 2 处 |

## 详细设计

### 1. 落地页 (globals.css 中的 .landing-* 类)

当前是 Apple 风格：白色背景、大标题渐变、蓝色 CTA 按钮、毛玻璃卡片。
改为 Figma 扁平风格：深色背景、干净排版、蓝色点缀。

```pseudo
.landing-page:
  background-color: var(--background)
  去除: #f5f5f7 硬编码

.landing-background:
  去除整个背景图层效果
  或简化为: 纯色 var(--background)

.landing-background-overlay:
  去除渐变叠加层
  改为: 不需要（纯色背景即可）

.landing-hero:
  保持居中布局
  min-height 保持不变

.landing-title:
  color: var(--foreground)
  去除: background gradient + background-clip: text
  font-size: 保持 72px 或适当缩小
  font-weight: 700

.landing-subtitle:
  color: var(--muted-foreground)
  font-size: 保持 28px

.landing-description:
  color: var(--muted-foreground)

.landing-cta-primary:
  background: var(--primary)  /* 纯色，不用渐变 */
  color: var(--primary-foreground)
  border-radius: 6px  /* 小圆角，不用 980px 药丸形 */
  去除: box-shadow, translateY hover 效果
  hover: opacity 0.9

.landing-cta-secondary:
  background: transparent
  color: var(--primary)
  border: 1px solid var(--primary)
  border-radius: 6px
  去除: rgba 背景

.landing-feature-card:
  background: var(--card)
  border: 1px solid var(--border)
  border-radius: 6px
  去除: backdrop-filter, box-shadow, translateY hover
  hover: border-color: var(--foreground)/20

.landing-feature-icon:
  去除: box-shadow
  background: var(--primary)/10 或相关功能色/10
  color: var(--primary)
  border-radius: 6px（不用 14px）

.landing-feature-title:
  color: var(--foreground)

.landing-feature-description:
  color: var(--muted-foreground)

.landing-stat-value:
  color: var(--primary)
  去除: background gradient + background-clip

.landing-stat-label:
  color: var(--muted-foreground)
```

### 2. AdminSettingsPage

```pseudo
页面容器:
  背景: bg-background

侧边栏 (SettingsSidebar):
  背景: bg-card
  右边框: border-r border-border
  菜单项:
    text-foreground hover:bg-accent
    选中: bg-primary/10 text-primary border-l-2 border-primary
  标题: text-foreground text-sm font-semibold

内容区:
  背景: bg-background
  内边距: p-4
```

### 3. UserManagement (63 处硬编码)

```pseudo
表格容器:
  背景: bg-card
  边框: border border-border rounded-md

表头:
  背景: bg-muted
  文字: text-muted-foreground text-xs font-medium uppercase
  边框: border-b border-border

表格行:
  背景: bg-card
  hover: bg-accent
  边框: border-b border-border
  文字: text-foreground text-sm

单元格内容:
  用户名: text-foreground font-medium
  邮箱: text-muted-foreground
  角色标签:
    admin: bg-primary/10 text-primary text-xs rounded
    user: bg-muted text-muted-foreground text-xs rounded
  状态标签:
    active: bg-green-500/10 text-green-500 text-xs rounded
    inactive: bg-muted text-muted-foreground text-xs rounded

操作按钮:
  编辑: text-muted-foreground hover:text-foreground hover:bg-accent
  删除: text-destructive hover:bg-destructive/10

分页:
  按钮: bg-muted text-muted-foreground hover:bg-accent
  当前页: bg-primary text-primary-foreground

搜索栏:
  输入框: bg-input border border-border text-foreground
  搜索按钮: bg-primary text-primary-foreground
```

### 4. UserProfile 系列

```pseudo
UserProfilePage:
  与 AdminSettingsPage 布局一致

UserProfileSidebar:
  与 SettingsSidebar 一致

UserInfoPanel:
  表单布局:
    标签: text-muted-foreground text-xs font-medium
    输入框: bg-input border border-border text-foreground
    头像区域: bg-muted rounded-md
    保存按钮: bg-primary text-primary-foreground

OtherSettingsPanel:
  设置项:
    背景: bg-card
    边框: border border-border rounded-md
    标签: text-foreground text-sm font-medium
    描述: text-muted-foreground text-xs
  切换开关:
    关闭: bg-muted
    开启: bg-primary
  主题切换（如有）:
    深色/亮色选择项
```

## 注意事项

- 落地页 CSS 类定义在 `globals.css` 中，需要在同一个文件中改造
- 落地页的响应式 `@media` 查询保持不变，只改颜色和视觉效果
- UserManagement 是硬编码最多的管理组件（63 处），需逐一处理
- 管理页的表格布局结构不变，只改配色
