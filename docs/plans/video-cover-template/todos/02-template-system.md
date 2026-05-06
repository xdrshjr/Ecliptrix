# TODO 02 — Template System

> Spec: `specs/02-template-system.md`

## Dependencies

```yaml
depends_on: [01]            # 复用 types.ts 与 icons.tsx
blocks: [03, 05]
parallel_group: B           # 与 04, 07 可并行
```

## Tasks

### A. 类型扩展

- [ ] 在 `VideoCoverModal/types.ts` 增加 `CoverTextLayer`、`CoverDecoration`、`CoverConfig`、`CoverTemplateDefinition` 完整定义（spec 02 §3.1）
- [ ] `CoverState` 增加 `templateId / config / imageSource / frameVirtualTimeMs / uploadedImageUrl / aspectRatio`

### B. 4 个模板

- [ ] 创建 `VideoCoverModal/templates/` 目录
- [ ] `titleTemplate.ts`：标题型（居中大标题 + 副标题 + 上下两条横线）
- [ ] `tutorialTemplate.ts`：教学型（左上 step + 大标题 + 左侧色块）
- [ ] `clickTemplate.ts`：点击型（粗体 outline + 黄色 badge）
- [ ] `minimalTemplate.ts`：极简型（左对齐 40px 标题）
- [ ] `templates/index.ts`：`COVER_TEMPLATES` / `COVER_TEMPLATE_ORDER` / `DEFAULT_COVER_TEMPLATE`
- [ ] `templates/thumbnails.tsx`：4 个 SVG 缩略图组件，使用 `currentColor` 与 `var(--card)`

### C. applyTemplate 工具

- [ ] 写 `VideoCoverModal/utils/applyTemplate.ts`
  - 切换时按 `key` 保留 prev 的 `text` 内容（非空时）
  - 其他字段重置为新模板默认
  - 用 `structuredClone` 深拷贝避免副作用
- [ ] 单测 `__tests__/applyTemplate.test.ts`：5+ 用例（保留/丢弃/未匹配 key/空文字/装饰重置）

### D. TemplatePicker 组件

- [ ] 写 `TemplatePicker.tsx`：2×2 grid、缩略图 + 标签、aria-pressed、键盘可达
- [ ] 写 `TemplatePicker.module.css`：选中态边框（`var(--primary)`）、悬停态、CSS 变量驱动
- [ ] 单测 `__tests__/TemplatePicker.test.tsx`：4 卡片渲染 / 选中态 / 切换触发 onChange / i18n

### E. 接入 VideoCoverModal

- [ ] 写 `VideoCoverModal/utils/makeDefaultState.ts`：`makeDefaultState(aspectRatio)` 返回 `{ templateId:'title', config: COVER_TEMPLATES.title.defaultConfig (structuredClone), imageSource:'frame', frameVirtualTimeMs:0, uploadedImageUrl:null, aspectRatio }`
- [ ] 在 `VideoCoverModal.tsx` 顶层引入 `coverState` 状态，初值 = `makeDefaultState(aspectRatio)`
- [ ] `<TemplatePicker selectedId={coverState.templateId} onChange={...applyTemplate(...)} />`

### F. i18n keys

- [ ] `videoCoverModal.templates.heading / title / tutorial / click / minimal`

### G. 验收

- [ ] 模板缩略图在深色 / 浅色下都可读
- [ ] 切换模板时已编辑的文字内容保留（手测 + 单测）
- [ ] 全部单测通过
