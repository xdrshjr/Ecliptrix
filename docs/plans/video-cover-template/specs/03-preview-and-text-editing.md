# Spec 03 — Preview & Text Editing

> 父：`master-plan.md` §5.4, §8.3, §6.4
> 范围：`CoverPreview` 渲染、双击编辑、`TextStyleToolbar`、装饰图层渲染

## 1. Goals

- G3.1 `CoverPreview` 按当前 `aspectRatio` 渲染封面：背景层（帧或上传图）+ 装饰层（SVG）+ 文字层
- G3.2 文字层双击 → 进入 contenteditable；提交后写回 `CoverConfig.textLayers[].text`
- G3.3 编辑态显示对应图层的 `TextStyleToolbar`（字体下拉、字号滑块、颜色选择器、对齐 4 选 1、B/I/U）
- G3.4 失焦 / Enter / Esc 退出编辑态；Esc 撤销本次编辑
- G3.5 预览容器尺寸自适应右侧 60% 内的可用空间，保持宽高比

## 2. 文件改动列表

### 2.1 新增

```
src/components/video/components/VideoCoverModal/
├── CoverPreview.tsx
├── CoverPreview.module.css
├── EditableTextLayer.tsx
├── DecorationLayer.tsx
├── TextStyleToolbar.tsx
├── TextStyleToolbar.module.css
└── __tests__/
    ├── CoverPreview.test.tsx
    ├── EditableTextLayer.test.tsx
    └── TextStyleToolbar.test.tsx
```

## 3. `<CoverPreview />`

### 3.1 Props

```tsx
interface CoverPreviewProps {
  config: CoverConfig;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '21:9';
  backgroundUrl: string | null;        // 帧 dataURL 或上传图 URL
  selectedLayerKey: string | null;     // 当前编辑中的文字图层 key
  onSelectLayer: (key: string | null) => void;
  onTextChange: (key: string, text: string) => void;
  isCapturing?: boolean;               // 渲染管线（spec 05）激活时为 true → 隐藏选中描边
}
```

### 3.2 渲染结构

```tsx
<div ref={previewRef} className="cover-preview" data-aspect={aspectRatio}>
  <div className="layers" style={{ aspectRatio: ratioToCss(aspectRatio) }}>
    <BackgroundLayer src={backgroundUrl} />
    <DecorationLayer items={config.decorations} />
    {config.textLayers.map(layer => (
      <EditableTextLayer
        key={layer.key}
        layer={layer}
        isEditing={selectedLayerKey === layer.key}
        onClick={() => onSelectLayer(layer.key)}
        onCommit={(newText) => onTextChange(layer.key, newText)}
        onBlur={() => onSelectLayer(null)}
        suppressChrome={isCapturing}
      />
    ))}
  </div>
</div>
```

### 3.3 比例 → CSS 映射

```ts
function ratioToCss(r: CoverAspectRatio): string {
  switch (r) {
    case '16:9': return '16 / 9';
    case '9:16': return '9 / 16';
    case '1:1': return '1 / 1';
    case '4:3': return '4 / 3';
    case '21:9': return '21 / 9';
  }
}
```

容器布局（`CoverPreview.module.css`）：

```css
.cover-preview {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 16px;
  background: linear-gradient(to right, transparent, transparent),
              repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 16px 16px;
  /* checker pattern - 透明区可视化 */
}

.layers {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  /* aspect-ratio 由 inline style 设置 */
  background: #000;       /* 在这层之上的子层负责真正的背景 */
  overflow: hidden;
}
```

> 注：宽高比通过 CSS `aspect-ratio` 完成，`max-width/max-height: 100%` 保证容器自适应。

### 3.4 背景层

```tsx
const BackgroundLayer = ({ src }: { src: string | null }) => (
  <div className="bg-layer" style={{ position: 'absolute', inset: 0 }}>
    {src ? (
      <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    ) : (
      <div className="bg-placeholder">{/* 引导文案：请先抽帧或上传 */}</div>
    )}
  </div>
);
```

## 4. `<DecorationLayer />`

```tsx
interface DecorationLayerProps {
  items: CoverDecoration[];
}

const DecorationLayer: React.FC<DecorationLayerProps> = ({ items }) => (
  <svg
    className="deco-layer"
    viewBox="0 0 1 1"
    preserveAspectRatio="none"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
  >
    {items.map((d, i) => {
      switch (d.type) {
        case 'rect':
        case 'badge':
          return <rect key={i} x={d.x} y={d.y} width={d.w} height={d.h}
                       fill={d.fill} stroke={d.stroke} rx={d.borderRadius ?? 0} />;
        case 'line':
          return <line key={i} x1={d.x} y1={d.y}
                       x2={d.x + d.w} y2={d.y + d.h}
                       stroke={d.fill ?? d.stroke ?? '#fff'}
                       strokeWidth={d.strokeWidth ?? 0.005} />;
      }
    })}
  </svg>
);
```

> 用 `viewBox="0 0 1 1"` + `preserveAspectRatio="none"` 让归一化坐标直接生效。

## 5. `<EditableTextLayer />`

### 5.1 Props

```tsx
interface EditableTextLayerProps {
  layer: CoverTextLayer;
  isEditing: boolean;
  onClick: () => void;          // 选中（不进入编辑）
  onCommit: (text: string) => void;
  onBlur: () => void;
  suppressChrome?: boolean;     // 渲染时隐藏边框
}
```

### 5.2 行为

```
单击  → onClick (选中, 显示边框，不进入编辑)
双击  → 进入编辑 (contenteditable=true, 自动 focus, 全选文字)
Enter / blur → onCommit + onBlur
Esc           → onBlur (不 commit, 撤销当前缓冲)
```

### 5.3 渲染

```tsx
const EditableTextLayer: React.FC<EditableTextLayerProps> = (p) => {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(p.layer.text);
  const editing = p.isEditing;

  useEffect(() => { setDraft(p.layer.text); }, [p.layer.text]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }, [editing]);

  const commit = () => {
    p.onCommit(draft);
    p.onBlur();
  };

  return (
    <div
      className={['text-layer', editing ? 'is-editing' : '', p.suppressChrome ? 'is-capture' : ''].filter(Boolean).join(' ')}
      /* 注：项目没有 `cn`/`clsx` 工具（已确认 `src/lib/utils` 中无 cn）；直接字符串拼接或自建 cls helper */
      style={{
        position: 'absolute',
        left: `${p.layer.x * 100}%`,
        top: `${p.layer.y * 100}%`,
        width: `${p.layer.width * 100}%`,
        textAlign: p.layer.align,
        color: p.layer.color,
        fontFamily: p.layer.fontFamily,
        fontSize: `${p.layer.fontSize / 1080 * 100}cqh`,  // container query height
        fontWeight: p.layer.fontWeight,
        fontStyle: p.layer.italic ? 'italic' : 'normal',
        textDecoration: p.layer.underline ? 'underline' : 'none',
      }}
      onClick={(e) => { e.stopPropagation(); p.onClick(); }}
      onDoubleClick={(e) => { e.stopPropagation(); /* 父组件感知 isEditing 变化 */ }}
    >
      <div
        ref={ref}
        contentEditable={editing}
        suppressContentEditableWarning
        onInput={(e) => setDraft((e.currentTarget.textContent ?? ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { setDraft(p.layer.text); p.onBlur(); }
        }}
        onBlur={commit}
      >
        {draft || <span className="placeholder">{/* layer.key 提示 */}</span>}
      </div>
    </div>
  );
};
```

> 字号用容器查询单位 `cqh`（容器高度的百分比，1080 等于满高）。
> 浏览器兼容：Container Queries 在 Safari 16+ / Chrome 105+ / Firefox 110+ 已支持，符合项目浏览器目标。
> 退路：若不支持，可改用 ResizeObserver + 计算 px。

### 5.4 选中态

`is-editing` 时：

- 1px 虚线边框（`outline: 1px dashed var(--primary)`）
- 角点 4 个小圆点（暗示尺寸，但**不**实现拖拽 — non-goal）
- `suppressChrome=true`（渲染管线时）禁用所有 outline / dotted

## 6. `<TextStyleToolbar />`

### 6.1 Props

```tsx
interface TextStyleToolbarProps {
  selectedLayer: CoverTextLayer | null;          // null 时整个工具栏 disabled
  onChange: (patch: Partial<CoverTextLayer>) => void;   // 部分更新
}
```

### 6.2 控件

| 控件 | 实现 |
|----|------|
| 字体下拉 | `<Select>`，选项=字体白名单（spec 05 第 4 节）|
| 字号 | 数字输入 + 滑块（12 - 200） |
| 颜色 | `<input type="color">` + 常用色色板 8 格 |
| 对齐 | 3 个图标按钮（Left / Center / Right） |
| 粗体 | toggle 按钮（B），影响 `fontWeight: 700 ↔ 400` |
| 斜体 | toggle 按钮（I），`italic` |
| 下划线 | toggle 按钮（U），`underline` |

### 6.3 状态联动

```ts
function handleBoldToggle() {
  const nextWeight = layer.fontWeight >= 700 ? 400 : 700;
  onChange({ fontWeight: nextWeight });
}
```

`selectedLayer == null` 时所有控件禁用 + 提示文案"双击预览中的文字以编辑"。

## 7. 选择模型

`VideoCoverModal` 维护 `selectedLayerKey: string | null`：

- 单击文字图层 → 选中（不进入 contenteditable）
- 双击 → 进入 contenteditable
- 点击预览空白 → 取消选中
- 点击工具栏 → 不取消选中

`TextStyleToolbar` 始终绑定 `selectedLayerKey` 对应的 layer；编辑文字内容走 contenteditable，编辑文字样式走 toolbar。

## 8. i18n keys 增量

```ts
videoCoverModal: {
  preview: {
    placeholderEmpty: '请先抽帧或上传图片' | 'Pick a frame or upload an image',
    selectHint: '双击文字以编辑' | 'Double-click text to edit',
  },
  textTools: {
    heading: '文字样式' | 'Text Style',
    font: '字体' | 'Font',
    size: '字号' | 'Size',
    color: '颜色' | 'Color',
    align: '对齐' | 'Align',
    bold: '粗体' | 'Bold',
    italic: '斜体' | 'Italic',
    underline: '下划线' | 'Underline',
    disabledHint: '双击预览中的文字以编辑' | 'Double-click the text to edit',
  },
}
```

## 9. 测试计划

### 9.1 `EditableTextLayer.test.tsx`

- 单击触发 onClick，不进入编辑
- 双击进入编辑（断言 contentEditable=true）
- Enter 触发 onCommit
- Esc 不触发 onCommit，恢复原文
- blur 触发 onCommit
- `suppressChrome=true` 时无 outline 类

### 9.2 `TextStyleToolbar.test.tsx`

- 无选中时所有控件禁用
- 修改字号触发 onChange({ fontSize })
- 粗体 toggle 在 400 ↔ 700 之间切换
- 颜色变化触发 onChange({ color })

### 9.3 `CoverPreview.test.tsx`

- 给定 config 渲染对应数量的文字图层 + 装饰
- 切换 selectedLayerKey 时对应图层有 `is-editing` 类
- 点击空白 → onSelectLayer(null)

## 10. 边界与风险

| 风险 | 缓解 |
|----|------|
| contenteditable 黏贴富文本带来 HTML 标签 | onInput 取 `textContent` 而非 `innerHTML`，自动剥离格式 |
| 移动端 / 触屏双击模拟差异 | v1 桌面端为主；触屏可改为长按选中 + 单击编辑作为后续增强 |
| 字号过大撑破容器 | 文字层 overflow: visible；spec 05 渲染管线在 1080p 画布上不会被裁剪；预览阶段允许溢出可见 |
| Enter 与 IME 输入冲突（中文输入法） | 加 `onCompositionStart/End` 跟踪：合成中不响应 Enter |
| Container Queries 浏览器兼容 | 浏览器目标 Chrome/Safari/Firefox 最新两年内版本支持；老版本浏览器降级 ResizeObserver |
| 文字图层 z-index 与装饰层冲突 | 装饰层固定 z-index 1，文字层 z-index 2 |

## 11. Dependencies

- 上游：spec 01（弹窗壳提供右侧容器）、spec 02（templates 提供 config）
- 下游：spec 04（背景层接收抽帧 dataURL）、spec 05（渲染管线消费同一 DOM 结构）

## 12. 完成条件

- [ ] CoverPreview 在所有 5 种宽高比下都能正确显示
- [ ] 双击编辑 / Enter 提交 / Esc 撤销 / blur 提交 4 路径单测通过
- [ ] TextStyleToolbar 全控件单测通过
- [ ] 选中态视觉与主题适配通过手动 QA
- [ ] IME 中文输入不会误触提交
