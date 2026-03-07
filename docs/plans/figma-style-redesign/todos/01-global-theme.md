# TODO 01 - 全局主题改造

> 对应 Spec: `specs/01-global-theme.md`

## 字体加载
- [ ] 在 `src/app/layout.tsx` 中导入 Inter 字体（`next/font/google`）
- [ ] 为 `<html>` 添加 `inter.variable` CSS 变量类
- [ ] 为 `<html>` 添加默认 `dark` 类
- [ ] 将 `<body>` 的 className 改为使用语义化类名 `bg-background text-foreground`

## CSS 变量
- [ ] 重写 `src/styles/globals.css` 中 `:root` 的所有 CSS 变量（深色模式值）
- [ ] 添加 `.dark` 选择器与 `:root` 相同值
- [ ] 添加 `.light` 选择器定义亮色模式变量
- [ ] 将所有 oklch 色值替换为 hex 色值
- [ ] 更新 `--radius` 从 `0.5rem` 为 `6px`
- [ ] 更新 `--font-sans` 为 `'Inter', -apple-system, system-ui, sans-serif`

## 阴影变量
- [ ] 将 `--shadow-2xs` 到 `--shadow-md` 设为 `none`
- [ ] 将 `--shadow-lg` 设为 `0 2px 8px rgba(0,0,0,0.15)`
- [ ] 将 `--shadow-xl` 设为 `0 4px 16px rgba(0,0,0,0.2)`
- [ ] 将 `--shadow-2xl` 设为 `0 8px 24px rgba(0,0,0,0.25)`

## 全局通配样式
- [ ] 移除 `* { transition: all 0.2s ... }` 通配过渡
- [ ] 添加针对交互元素的过渡：`button, a, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"]`
- [ ] 过渡属性限定为 `background-color, color, border-color, opacity`，持续 0.15s

## 滚动条
- [ ] 更新滚动条宽度从 8px 为 6px
- [ ] 更新 thumb 颜色为 `var(--border)`
- [ ] 更新 thumb hover 颜色为 `var(--muted-foreground)`

## 焦点样式
- [ ] 更新 `*:focus-visible` 的 outline-offset 为 1px
- [ ] 添加 `border-radius: var(--radius-sm)`

## Body 样式
- [ ] 更新 body font-family 为 `var(--font-sans)`
- [ ] 更新 body font-size 为 13px
- [ ] 更新 body line-height 为 1.4

## @theme inline 块
- [ ] 同步更新 `@theme inline` 块中的所有引用
- [ ] 更新 radius 变量引用

## Tailwind 配置
- [ ] 确认 `tailwind.config.js` 中 `darkMode: ["class"]` 保持不变
- [ ] 更新 fontFamily.sans 为 Inter
- [ ] 确认颜色、阴影等已通过 CSS 变量间接控制

## 验证
- [ ] 运行 `npm run build` 确保无编译错误
- [ ] 在浏览器中检查深色模式显示
- [ ] 在浏览器中切换 `dark`→`light` 类检查亮色模式
