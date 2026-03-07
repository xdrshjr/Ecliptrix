# 01 - 全局主题改造

## 概述

改造全局 CSS 变量、Tailwind 配置、globals.css、字体加载，建立 Figma 风格的设计基础。这是所有后续改造的基础层。

## 涉及文件

| 文件 | 改动类型 |
|------|---------|
| `src/styles/globals.css` | 重写 CSS 变量、移除毛玻璃/阴影通配、更新滚动条 |
| `tailwind.config.js` | 更新圆角/阴影默认值、字体族 |
| `src/app/layout.tsx` | 加载 Inter 字体、默认 dark 类 |
| `src/styles/video-editing.css` | 如有硬编码色值需替换 |

## 详细设计

### 1. 字体加载 (`layout.tsx`)

```pseudo
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

// <html> 添加 inter.variable 和默认 dark 类
<html lang="en" className={`${inter.variable} dark h-full`}>
<body className="h-full bg-background text-foreground antialiased overflow-hidden font-sans">
```

### 2. CSS 变量重写 (`globals.css`)

#### 深色模式（`:root` 即深色，因为 dark 是默认）

实际实现方式：`:root` 定义深色变量，`.light` 类覆盖为亮色变量。

```pseudo
:root {
  --background: #1E1E1E;
  --foreground: #E0E0E0;
  --card: #252525;
  --card-foreground: #E0E0E0;
  --popover: #2C2C2C;
  --popover-foreground: #E0E0E0;
  --primary: #0D99FF;
  --primary-foreground: #FFFFFF;
  --secondary: #333333;
  --secondary-foreground: #B3B3B3;
  --muted: #2A2A2A;
  --muted-foreground: #8C8C8C;
  --accent: #383838;
  --accent-foreground: #E0E0E0;
  --destructive: #F24822;
  --destructive-foreground: #FFFFFF;
  --border: #3A3A3A;
  --input: #2C2C2C;
  --ring: #0D99FF;
  --sidebar: #2C2C2C;
  --sidebar-foreground: #E0E0E0;
  --sidebar-primary: #0D99FF;
  --sidebar-primary-foreground: #FFFFFF;
  --sidebar-accent: #383838;
  --sidebar-accent-foreground: #E0E0E0;
  --sidebar-border: #3A3A3A;
  --sidebar-ring: #0D99FF;
  --font-sans: 'Inter', -apple-system, system-ui, sans-serif;
  --font-mono: 'Fira Code', 'Courier New', monospace;
  --radius: 6px;
}

.dark {
  /* 与 :root 相同值，确保 dark 类显式匹配 */
}

.light {
  --background: #F5F5F5;
  --foreground: #333333;
  --card: #FFFFFF;
  --card-foreground: #333333;
  --popover: #FFFFFF;
  --popover-foreground: #333333;
  --primary: #0C8CE9;
  --primary-foreground: #FFFFFF;
  --secondary: #EBEBEB;
  --secondary-foreground: #666666;
  --muted: #F0F0F0;
  --muted-foreground: #999999;
  --accent: #E8E8E8;
  --accent-foreground: #333333;
  --destructive: #F24822;
  --destructive-foreground: #FFFFFF;
  --border: #E0E0E0;
  --input: #F0F0F0;
  --ring: #0C8CE9;
  --sidebar: #F7F7F7;
  --sidebar-foreground: #333333;
  --sidebar-primary: #0C8CE9;
  --sidebar-primary-foreground: #FFFFFF;
  --sidebar-accent: #E8E8E8;
  --sidebar-accent-foreground: #333333;
  --sidebar-border: #E0E0E0;
  --sidebar-ring: #0C8CE9;
}
```

### 3. 去除全局通配样式

**移除：**
```pseudo
/* 移除这个 - 会影响所有元素的性能 */
* {
  transition: all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1);
}
```

**替换为：**
```pseudo
/* 只对交互元素添加必要过渡 */
button, a, input, select, textarea,
[role="button"], [role="tab"], [role="menuitem"] {
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
```

### 4. 滚动条样式更新

```pseudo
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--muted-foreground);
}
```

### 5. 阴影变量替换

```pseudo
--shadow-2xs: none;
--shadow-xs: none;
--shadow-sm: none;
--shadow: none;
--shadow-md: none;
--shadow-lg: 0 2px 8px rgba(0,0,0,0.15);   /* 仅浮层用 */
--shadow-xl: 0 4px 16px rgba(0,0,0,0.2);    /* 仅大弹窗 */
--shadow-2xl: 0 8px 24px rgba(0,0,0,0.25);  /* 极少使用 */
```

### 6. Tailwind 配置更新 (`tailwind.config.js`)

主要变更：
- `--radius` 从 `0.5rem` 改为 `6px`
- 字体族改为 Inter
- 阴影变量引用新值
- 其余保持不变（颜色已通过 CSS 变量控制）

### 7. 焦点样式

```pseudo
*:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
  border-radius: var(--radius-sm);
}
```

### 8. 基础 body 样式

```pseudo
body {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

## 注意事项

- 当前使用 oklch 色值，改为 hex 值更直观且与 Figma 一致
- `@theme inline` 块需同步更新引用
- 确保 `darkMode: ["class"]` 在 Tailwind 配置中保持不变
- Inter 字体需要 `next/font/google` 加载，支持中文 fallback 到系统字体
