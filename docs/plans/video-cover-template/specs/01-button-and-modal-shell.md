# Spec 01 — Button & Modal Shell

> 父：`master-plan.md`
> 范围：在 `VideoPlayerPanel` 的宽高比行右侧加"封面"按钮；新增 `VideoCoverModal` 弹窗壳；左右栅格布局；主题与可访问性

## 1. Goals

- G1.1 在 `aspect-ratio-row` 内拆分为左 80% / 右 20% 的两列，原宽高比按钮组保持不变，右列放新增 `CoverButton`
- G1.2 `CoverButton` 与现有 `aspect-ratio-btn` 视觉一致（圆角、字号、边距、active/inactive 状态）；图标 + 文字"封面" / "Cover"
- G1.3 点击 `CoverButton` → 打开 `VideoCoverModal`；关闭按钮、Esc、点遮罩均可关闭
- G1.4 弹窗尺寸 90vw × 85vh；左 40% / 右 60% 用 CSS Grid 实现
- G1.5 弹窗背景 / 边框 / 文字色完全用项目 CSS 变量；深色与浅色主题下视觉一致
- G1.6 项目素材中无可用视频时，按钮仍可点击但弹窗内的抽帧滑块禁用 + 自动切到"上传"模式（具体在 spec 04）

## 2. 文件改动列表

### 2.1 新增

```
src/components/video/components/VideoCoverModal/
├── VideoCoverModal.tsx           # 主组件（壳）
├── CoverButton.tsx                # 触发按钮
├── VideoCoverModal.module.css     # 壳布局 + 按钮样式（Tailwind 主，模块化补充）
├── types.ts                       # 公共类型（CoverTemplateId / ImageSource / CoverState）
├── index.ts                       # 导出 VideoCoverModal、CoverButton
└── __tests__/
    ├── CoverButton.test.tsx
    └── VideoCoverModal.shell.test.tsx
```

> 子组件（TemplatePicker、CoverPreview、FrameScrubber 等）由后续 spec 逐一定义。本 spec 只定义壳。

### 2.2 修改

- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx`
  - 在 `aspect-ratio-row`（行 2300-2342，已确认结构：`.aspect-ratio-row` → `.aspect-ratio-group` → `.info-label` + `.aspect-ratio-buttons`）内增加右列 `<CoverButton />`
  - 注入 `onClick` → 触发上层状态
  - `selectedAspectRatio` 状态需要可被 `VideoCoverModal` 通过 props 读取（已存在的 `selectedAspectRatio` 透传）
- `src/components/video/VideoEditingInterface.tsx`
  - 新增 `coverModalOpen: boolean` 状态
  - 在合适位置渲染 `<VideoCoverModal isOpen={coverModalOpen} ... />`
- `src/lib/i18n.ts` 增加 `videoCoverModal` 命名空间（中/英）

## 3. 接口契约

### 3.1 `<CoverButton />`

```tsx
interface CoverButtonProps {
  onClick: () => void;
  disabled?: boolean;        // 例：项目尚未保存（无 projectId）时禁用
  className?: string;
  // 可选：右列自带 flex 布局，外部不需要额外控制
}
```

视觉规则：

- 按钮高度 = `aspect-ratio-btn` 高度
- 内边距 8px / 12px
- 图标：内联 SVG（16px）。**注**：项目当前未安装 `lucide-react`（`package.json` 已确认无该依赖）；本功能避免新增图标库，统一使用内联 SVG（与现有项目保持一致）。可在 `VideoCoverModal/icons.tsx` 集中放 `<CoverIcon />`、`<CheckIcon />` 等小型 SVG 组件。
- 文字：`t.videoCoverModal.button`，紧跟图标，间距 6px
- 默认态：`bg-transparent text-foreground border border-border`
- 悬停态：`bg-accent`
- focus-visible：`ring-2 ring-ring`
- 禁用态：`opacity-50 cursor-not-allowed`

### 3.2 `<VideoCoverModal />`

```tsx
interface VideoCoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '21:9';   // 来自 VideoPlayerPanel
  timelineItems: TimelineItemData[];                        // 用于虚拟时间轴（spec 04）；类型来自 `@/components/video/timeline/domain/types`
  materials: MaterialItem[];                                // 用于源 URL 解析（`MaterialItem` 来自 `@/types`）
}
```

返回值：JSX。内部不暴露 imperative API。

### 3.3 弹窗壳布局

> **注意**：项目目前的 `src/components/ui/` 仅有 `ConfirmationDialog.tsx` / `MobileWarningDialog.tsx` / `Toast.tsx`，**没有**通用 `Modal` / `Button` / `Dialog` 等 shadcn 风格组件。下方 `<Modal>` / `<ModalHeader>` 等是本 spec 在 `VideoCoverModal/` 目录内自建的内联组件（参考 `ConfirmationDialog.tsx`：fixed overlay + 居中卡片 + Esc + 点击遮罩关闭）。`<Button>` 同理使用原生 `<button>` + Tailwind 样式即可（与现有项目按钮风格一致）。

```tsx
<Modal>                            {/* role="dialog" aria-modal="true" */}
  <ModalHeader>
    <Title>{t.videoCoverModal.title}</Title>
    <CloseButton aria-label={t.common.close} onClick={onClose} />
  </ModalHeader>
  <ModalBody>
    <div className="cover-modal-grid">
      <section className="cover-modal-left">  {/* 子组件由 spec 02-03 填充 */}
        <TemplatePicker ... />
        <TextStyleToolbar ... />
      </section>
      <section className="cover-modal-right"> {/* 子组件由 spec 03-04-05 填充 */}
        <CoverPreview ... />
        <FrameScrubberOrUpload ... />
      </section>
    </div>
  </ModalBody>
  <ModalFooter>
    <Button variant="ghost" onClick={onClose}>{t.common.cancel}</Button>
    <Button variant="primary" onClick={handleDownload}>{t.videoCoverModal.actions.download}</Button>
  </ModalFooter>
</Modal>
```

CSS Grid 关键规则（`VideoCoverModal.module.css`）：

```css
.cover-modal-grid {
  display: grid;
  grid-template-columns: 40% 60%;
  height: 100%;
  gap: 16px;
}

.cover-modal-left, .cover-modal-right {
  display: flex;
  flex-direction: column;
  min-height: 0;          /* 允许子元素 overflow */
}
```

弹窗尺寸通过 Modal 容器：

```css
.cover-modal {
  width: 90vw;
  height: 85vh;
  max-width: 1600px;
  max-height: 900px;
  background: var(--background);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: 12px;
}
```

### 3.4 与 `VideoPlayerPanel` 的耦合点

修改后的 `aspect-ratio-row`：

```tsx
<div className="aspect-ratio-row" style={{ display: 'flex', gap: 12 }}>
  <div className="aspect-ratio-group" style={{ flex: 4 }}>
    <span className="info-label">{t.videoPlayerPanel.info.aspectRatio}</span>
    <div className="aspect-ratio-buttons">
      {ASPECT_RATIOS.map(...)}
    </div>
  </div>
  <CoverButton style={{ flex: 1 }} onClick={onOpenCover} disabled={!projectId} />
</div>
```

新 props 传给 `VideoPlayerPanel`：

```tsx
interface VideoPlayerPanelProps {
  // ...existing props...
  onOpenCoverModal?: () => void;
}
```

> 若不提供 `onOpenCoverModal`，按钮不渲染（向后兼容），便于灰度。

## 4. 主题适配

| 元素 | CSS 变量 |
|----|---------|
| 弹窗底色 | `--background` |
| 边框 | `--border` |
| 主文字 | `--foreground` |
| 次文字 | `--muted-foreground` |
| 卡片底色（模板缩略图容器） | `--card` |
| 选中态边框 | `--ring` 或 `--primary` |
| 主按钮（下载） | `--primary` / `--primary-foreground` |

**禁止**写死 `#ffffff` / `#000000` / Tailwind 直连色（如 `bg-white`）。

预览容器内部图层（封面颜色）不受主题影响——预览背景固定使用 checker 棋盘表示透明区。

## 5. 可访问性

- 弹窗：`role="dialog" aria-modal="true" aria-labelledby={titleId}`
- 焦点：打开时聚焦关闭按钮；关闭时还焦到 `CoverButton`
- 焦点陷阱：Tab/Shift+Tab 在弹窗内循环
- Esc 关闭
- 关闭按钮：`aria-label={t.common.close}`
- 按钮：`aria-label={t.videoCoverModal.button}`

## 6. i18n keys 增量

```ts
// src/lib/i18n.ts
videoCoverModal: {
  button: '封面' | 'Cover',
  title: '封面设置' | 'Cover Settings',
  // 子组件 keys 由对应 spec 增加
}
common: {
  close: '关闭' | 'Close',
  cancel: '取消' | 'Cancel',
}
```

## 7. 测试计划

### 7.1 `CoverButton.test.tsx`

- 渲染图标 + 文字
- `disabled` 时点击不触发 onClick
- 键盘 Enter / Space 触发 onClick
- aria-label 正确

### 7.2 `VideoCoverModal.shell.test.tsx`

- `isOpen=false` 不渲染 dialog
- `isOpen=true` 渲染 dialog 且 aria-modal="true"
- 点击关闭按钮触发 onClose
- 按 Esc 触发 onClose
- 焦点陷阱在 dialog 内（Tab 循环）
- 关闭后焦点返回触发按钮（需要在调用方测）

> 子组件交互（模板切换、抽帧、文字编辑）的测试在各自 spec。

## 8. 边界与风险

| 风险 | 缓解 |
|----|------|
| `VideoPlayerPanel` 已 ~2360 行，新增 props 担心打破现有快照 | 使用可选 prop + 默认行为（不渲染按钮）；现有快照测试不变 |
| 90vw 在 1280px 屏 = 1152px，左 40% = 461px；模板 2x2 网格够用 | `max-width: 1600px` 上限，避免在 4K 屏过大；左侧 `min-width: 360px` 保证模板可读 |
| 项目主题切换瞬间弹窗内联组件颜色错位 | 全部走 CSS 变量；不引入 inline style 颜色 |
| Modal 滚动遮挡背景滚动 | `body { overflow: hidden }` while open，关闭时恢复 |
| Tablet/触屏（<1280px）布局过窄 | v1 限定桌面端使用；< 1280px 时 button 仍可点击但提示"建议使用更大屏幕"（沿用现有 `MobileWarningDialog` 模式） |

## 9. Dependencies

- 上游：master-plan §5.1
- 下游：spec 02（TemplatePicker）、spec 03（CoverPreview & TextStyleToolbar）、spec 04（FrameScrubber）、spec 05（下载行为绑定到 ModalFooter Download 按钮）
- 此 spec 不依赖后端

## 10. 完成条件

- [ ] `CoverButton` 组件单测通过
- [ ] `VideoCoverModal` 壳单测通过
- [ ] 在 `VideoPlayerPanel` 的 aspect-ratio-row 中能看到按钮，且 80/20 比例正确
- [ ] 弹窗在深色 / 浅色主题下视觉一致（手动 QA）
- [ ] Esc / 关闭按钮 / 点击遮罩三种关闭方式均工作
- [ ] aria 属性齐全
