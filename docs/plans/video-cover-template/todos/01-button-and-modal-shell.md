# TODO 01 — Button & Modal Shell

> Spec: `specs/01-button-and-modal-shell.md`

## Dependencies

```yaml
depends_on: []
blocks: [02, 03, 04, 05]
parallel_group: A           # 与 06 并行（前端壳 + 后端表）
```

理由：本 todo 是所有前端子组件的容器。spec 02-05 需要它的左右栅格、`isOpen` 状态、`projectId` 传递。06 是后端独立工作，与之并行。

## Tasks

### A. 类型与目录骨架

- [ ] 创建 `src/components/video/components/VideoCoverModal/` 目录
- [ ] 写 `types.ts`：`CoverTemplateId` / `ImageSource` / `CoverAspectRatio` / `CoverState`（先列空 placeholder，spec 02-04 会扩展）
- [ ] 写 `icons.tsx`：内联 `<CoverIcon />`、`<CheckIcon />`、`<CloseIcon />`（项目无 lucide-react）
- [ ] 写 `index.ts` 导出 `VideoCoverModal` / `CoverButton`

### B. CoverButton 组件

- [ ] 写 `CoverButton.tsx`：图标 + 文字"封面"
- [ ] 视觉与 `aspect-ratio-btn` 一致（按高、padding、focus ring）
- [ ] disabled 态、aria-label、键盘 Enter/Space 触发
- [ ] 单测 `__tests__/CoverButton.test.tsx`：渲染 / disabled / 键盘 / aria

### C. 弹窗壳

- [ ] 写 `VideoCoverModal.module.css`：`.cover-modal-grid`（40/60）、`.cover-modal`（90vw × 85vh、CSS 变量主题）
- [ ] 写 `VideoCoverModal.tsx` 壳：`role="dialog" aria-modal`、Esc/遮罩/X 关闭、focus trap、`body { overflow:hidden }` while open
- [ ] 内联 `<Modal> / <ModalHeader> / <ModalBody> / <ModalFooter>` 子组件（参考 `ConfirmationDialog.tsx`）
- [ ] 子组件挂载 placeholder：`<TemplatePicker />`（未实现）/ `<TextStyleToolbar />` / `<CoverPreview />` / `<FrameScrubberOrUpload />`
- [ ] 单测 `__tests__/VideoCoverModal.shell.test.tsx`：isOpen=false / Esc / 焦点陷阱

### D. 接入 VideoPlayerPanel

- [ ] 修改 `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` 行 2300-2342：
  - 给 `.aspect-ratio-row` 加 `display: flex; gap: 12`
  - 包 `.aspect-ratio-group` 用 `style={{ flex: 4 }}` 包裹（80%）
  - 末尾插入 `<CoverButton style={{ flex: 1 }} disabled={!projectId} onClick={onOpenCoverModal} />`
- [ ] 给 `VideoPlayerPanelProps` 增加可选 `onOpenCoverModal?: () => void`（不传 → 不渲染按钮，向后兼容）
- [ ] 现有 `VideoPlayerPanel` 快照测试不受影响（验证）

### E. 接入 VideoEditingInterface

- [ ] 修改 `src/components/video/VideoEditingInterface.tsx`：
  - 增加 `coverModalOpen: boolean` 状态
  - `<VideoPlayerPanel ... onOpenCoverModal={() => setCoverModalOpen(true)} />`
  - 渲染 `<VideoCoverModal isOpen={coverModalOpen} onClose={() => setCoverModalOpen(false)} projectId aspectRatio timelineItems materials />`

### F. i18n keys

- [ ] 在 `src/lib/i18n.ts` 增加 `videoCoverModal.button` / `.title` / `common.close` / `common.cancel`（中/英）

### G. 验收

- [ ] 在浏览器中能看到按钮，点击弹出空壳弹窗
- [ ] Esc / 遮罩 / X 三种关闭路径均工作
- [ ] 深色 / 浅色主题切换视觉一致
- [ ] 1280px 屏左 40% ≈ 461px，模板 placeholder 区可显示
- [ ] 单测全绿
