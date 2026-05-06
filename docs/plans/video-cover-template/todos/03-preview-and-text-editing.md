# TODO 03 — Preview & Text Editing

> Spec: `specs/03-preview-and-text-editing.md`

## Dependencies

```yaml
depends_on: [01, 02]        # 需要壳 + 模板/types
blocks: [05]                # 渲染管线消费 previewRef
parallel_group: C
```

## Tasks

### A. CoverPreview 容器

- [ ] 写 `CoverPreview.tsx`：`previewRef` 指向 `.layers`、`aspect-ratio` inline style、checker 棋盘背景
- [ ] 写 `CoverPreview.module.css`：`.cover-preview` flex 居中、`.layers` aspect-ratio + overflow hidden
- [ ] 渲染 `<BackgroundLayer src={backgroundUrl} />`（背景占位文案）+ `<DecorationLayer items={config.decorations} />` + 多个 `<EditableTextLayer />`

### B. DecorationLayer

- [ ] 写 `DecorationLayer.tsx`：SVG `viewBox="0 0 1 1" preserveAspectRatio="none"`，按 type 分支渲染 rect/badge（rect with rx）/line
- [ ] 单测 `__tests__/DecorationLayer.test.tsx`：每种 type 一个用例，检查 SVG 节点数与属性

### C. EditableTextLayer

- [ ] 写 `EditableTextLayer.tsx`：
  - 单击 → onSelectLayer
  - 双击 → 进入 contentEditable + 全选文字
  - Enter/blur → onCommit
  - Esc → 撤销 draft，onBlur
  - IME 兼容：onCompositionStart/End 跟踪，合成中不响应 Enter
  - 字号用 `cqh` 单位（容器查询）
  - `suppressChrome` 渲染态隐藏 outline
- [ ] 单测 `__tests__/EditableTextLayer.test.tsx`：单击 / 双击 / Enter / blur / Esc / IME / suppressChrome

### D. TextStyleToolbar

- [ ] 写 `TextStyleToolbar.tsx`：
  - 字体下拉（消费 `coverFontWhitelist.ts`，spec 05 D 项产出；若 05 未到则先内联占位）
  - 字号数字输入 + 滑块（12-200）
  - 颜色 input[type=color] + 8 格色板
  - 对齐 3 按钮（Left/Center/Right）
  - B/I/U 三个 toggle
  - selectedLayer=null 时整体禁用
- [ ] 写 `TextStyleToolbar.module.css`
- [ ] 单测 `__tests__/TextStyleToolbar.test.tsx`：禁用态 / 字号 / 颜色 / 粗体 toggle / 对齐

### E. 选择模型与状态

- [ ] `VideoCoverModal.tsx` 增加 `selectedLayerKey: string | null` 状态
- [ ] 点击预览空白 → `setSelectedLayerKey(null)`
- [ ] 点击 toolbar 不取消选中
- [ ] 文字编辑产生的 patch 通过 `setCoverState(prev => mergeLayer(prev, key, patch))` 写回

### F. i18n keys

- [ ] `videoCoverModal.preview.placeholderEmpty / selectHint`
- [ ] `videoCoverModal.textTools.heading / font / size / color / align / bold / italic / underline / disabledHint`

### G. 验收

- [ ] 5 种宽高比下预览渲染正确
- [ ] 双击编辑 → Enter 提交 / Esc 撤销 / blur 提交三路径通过
- [ ] 中文 IME 输入不会误触提交
- [ ] 工具栏样式调整实时反映在预览
- [ ] 单测全绿
