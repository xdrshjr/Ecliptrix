# Spec 02 — Template System

> 父：`master-plan.md` §5.5 (D3, D4, D8), §6.4
> 范围：4 个内置封面模板的数据模型、缩略图、切换语义、`TemplatePicker` 组件

## 1. Goals

- G2.1 提供 4 个内置模板：`title` / `tutorial` / `click` / `minimal`，前端硬编码
- G2.2 模板数据模型涵盖：文字图层（含位置、字体、字号、颜色、对齐、粗体/斜体）、矢量装饰（rect / line / badge）
- G2.3 `TemplatePicker` 组件以 2×2 网格展示，每格显示模板缩略图 + 标签
- G2.4 切换模板时**保留用户已修改的文字内容**（按 `key` 映射），仅替换字体/位置/装饰
- G2.5 模板缩略图为内联 SVG，可主题化（不依赖图片资源）

## 2. 文件改动列表

### 2.1 新增

```
src/components/video/components/VideoCoverModal/
├── TemplatePicker.tsx
├── TemplatePicker.module.css
├── templates/
│   ├── index.ts                  # COVER_TEMPLATES 常量
│   ├── titleTemplate.ts
│   ├── tutorialTemplate.ts
│   ├── clickTemplate.ts
│   ├── minimalTemplate.ts
│   └── thumbnails.tsx            # SVG 缩略图组件
└── __tests__/
    ├── TemplatePicker.test.tsx
    └── applyTemplate.test.ts
```

## 3. 数据模型

### 3.1 类型（已在 spec 01 types.ts 中预声明）

```ts
export type CoverTemplateId = 'title' | 'tutorial' | 'click' | 'minimal';

export interface CoverTextLayer {
  key: string;                          // 模板内置标识，e.g. 'title' / 'subtitle' / 'tag'
  text: string;                         // 用户可改
  fontFamily: string;
  fontSize: number;                     // 基于 1080p 短边的"逻辑像素"，渲染时按比例放大
  color: string;                        // hex
  fontWeight: 400 | 500 | 600 | 700 | 800 | 900;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  // 位置（归一化 0-1，相对于画布）
  x: number;
  y: number;
  width: number;                        // 文字框宽度归一化
  // 高度由内容决定，模板不锁定
}

export interface CoverDecoration {
  type: 'rect' | 'line' | 'badge';
  x: number; y: number;                 // 起点（归一化）
  w: number; h: number;                 // 尺寸（归一化）
  fill?: string;
  stroke?: string;
  strokeWidth?: number;                 // 像素，渲染时按比例
  borderRadius?: number;                // 像素
  rotation?: number;                    // 度
}

export interface CoverConfig {
  version: 1;
  textLayers: CoverTextLayer[];
  decorations: CoverDecoration[];
}

export interface CoverTemplateDefinition {
  id: CoverTemplateId;
  labelKey: string;                     // i18n key
  thumbnail: React.FC<{ className?: string }>;   // SVG 缩略图组件
  defaultConfig: CoverConfig;
}
```

### 3.2 4 个模板的设计意图

| ID | 中文标签 | 定位 | 文字图层 | 装饰 |
|----|---------|------|----------|------|
| `title` | 标题型 | 居中大标题 + 副标题 | `title`（72px、center）+ `subtitle`（28px、center） | 顶/底两条横线点缀 |
| `tutorial` | 教学型 | 左上角清单 | `step`（20px、left）+ `title`（48px、left） | 左侧色块 4×40 |
| `click` | 点击型 | YouTube 高对比 | `title`（96px、bold + outline） + `tag`（24px、绿色 badge） | 黄色 badge 矩形作为 tag 背景 |
| `minimal` | 极简型 | 资讯型 | `title`（40px、left） | 无装饰 |

### 3.3 示例：`titleTemplate.ts`

```ts
import type { CoverTemplateDefinition } from '../types';
import { TitleThumbnail } from './thumbnails';

export const titleTemplate: CoverTemplateDefinition = {
  id: 'title',
  labelKey: 'videoCoverModal.templates.title',
  thumbnail: TitleThumbnail,
  defaultConfig: {
    version: 1,
    textLayers: [
      {
        key: 'title',
        text: 'YOUR TITLE',
        fontFamily: 'Inter',
        fontSize: 72,
        color: '#ffffff',
        fontWeight: 800,
        italic: false,
        underline: false,
        align: 'center',
        x: 0.1, y: 0.42, width: 0.8,
      },
      {
        key: 'subtitle',
        text: '副标题',
        fontFamily: 'Inter',
        fontSize: 28,
        color: '#ffffff',
        fontWeight: 400,
        italic: false,
        underline: false,
        align: 'center',
        x: 0.1, y: 0.56, width: 0.8,
      },
    ],
    decorations: [
      { type: 'line', x: 0.3, y: 0.38, w: 0.4, h: 0.005, fill: '#ffffff' },
      { type: 'line', x: 0.3, y: 0.62, w: 0.4, h: 0.005, fill: '#ffffff' },
    ],
  },
};
```

### 3.4 `templates/index.ts`

```ts
import { titleTemplate } from './titleTemplate';
import { tutorialTemplate } from './tutorialTemplate';
import { clickTemplate } from './clickTemplate';
import { minimalTemplate } from './minimalTemplate';
import type { CoverTemplateDefinition, CoverTemplateId } from '../types';

export const COVER_TEMPLATES: Record<CoverTemplateId, CoverTemplateDefinition> = {
  title: titleTemplate,
  tutorial: tutorialTemplate,
  click: clickTemplate,
  minimal: minimalTemplate,
};

export const COVER_TEMPLATE_ORDER: CoverTemplateId[] =
  ['title', 'tutorial', 'click', 'minimal'];

export const DEFAULT_COVER_TEMPLATE: CoverTemplateId = 'title';
```

## 4. 切换语义：`applyTemplate`

```ts
// utils/applyTemplate.ts
export function applyTemplate(
  prevConfig: CoverConfig,
  nextTemplateId: CoverTemplateId
): CoverConfig {
  const next = structuredClone(COVER_TEMPLATES[nextTemplateId].defaultConfig);
  // 按 key 保留用户文字内容（D8）
  for (const layer of next.textLayers) {
    const prevLayer = prevConfig.textLayers.find(l => l.key === layer.key);
    if (prevLayer && prevLayer.text.trim() !== '') {
      layer.text = prevLayer.text;
    }
  }
  return next;
}
```

行为：

- 只有 `text` 字段从前一个 config 继承（前提是 key 匹配且非空）
- 字体、字号、颜色、对齐、位置、装饰**全部**重置为新模板默认
- 用户主动改过的样式被丢弃（接受这种行为，符合剪映模板切换体验）

> 注：若用户希望"不重置我已改的样式"，可作为后续增强，本版不实现。

## 5. `<TemplatePicker />` 组件

### 5.1 Props

```tsx
interface TemplatePickerProps {
  selectedId: CoverTemplateId;
  onChange: (id: CoverTemplateId) => void;
}
```

### 5.2 渲染

```tsx
<div className="template-picker">
  <h3 className="picker-title">{t.videoCoverModal.templates.heading}</h3>
  <div className="template-grid">  {/* 2×2 grid */}
    {COVER_TEMPLATE_ORDER.map(id => {
      const tpl = COVER_TEMPLATES[id];
      const Thumb = tpl.thumbnail;
      const isSelected = selectedId === id;
      return (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={['template-card', isSelected ? 'is-selected' : ''].join(' ').trim()}
          /* 注：项目没有 `cn`/`clsx` 工具（src/lib/utils 中确认无 cn.ts）；
             直接拼字符串或新建 VideoCoverModal/utils/cls.ts 都可。 */
          aria-pressed={isSelected}
          aria-label={t[tpl.labelKey]}
        >
          <Thumb className="thumb" />
          <span className="label">{t[tpl.labelKey]}</span>
        </button>
      );
    })}
  </div>
</div>
```

### 5.3 缩略图（SVG）

每个 thumbnail 组件接收 `className` 并以 `viewBox="0 0 160 90"` 渲染（16:9 比例）。

```tsx
// thumbnails.tsx
export const TitleThumbnail: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 160 90" className={className} aria-hidden="true">
    <rect width="160" height="90" fill="var(--card)" />
    <line x1="48" y1="34" x2="112" y2="34" stroke="currentColor" strokeWidth="0.7" />
    <text x="80" y="50" textAnchor="middle" fontSize="14" fontWeight="800" fill="currentColor">
      TITLE
    </text>
    <line x1="48" y1="56" x2="112" y2="56" stroke="currentColor" strokeWidth="0.7" />
  </svg>
);
// 其余三个同理，各自风格
```

颜色用 `currentColor` + CSS 变量背景，从而自动随主题变化。

### 5.4 选中态视觉

- 边框：2px solid `var(--primary)`
- 缩略图四角加发光（box-shadow）
- 标签前方有 ✓ 图标（内联 SVG `<CheckIcon />`，定义在 `VideoCoverModal/icons.tsx`；项目未安装 `lucide-react`，参见 spec 01 §3.1 注）

## 6. i18n keys 增量

```ts
videoCoverModal: {
  templates: {
    heading: '模板' | 'Templates',
    title: '标题型' | 'Title',
    tutorial: '教学型' | 'Tutorial',
    click: '点击型' | 'Click-bait',
    minimal: '极简型' | 'Minimal',
  },
}
```

## 7. 测试计划

### 7.1 `TemplatePicker.test.tsx`

- 渲染 4 个模板卡片
- 选中态正确（aria-pressed、视觉）
- 点击非选中卡片触发 onChange
- 标签 i18n 正确（中/英分别快照）
- 键盘 Enter / Space 触发 onChange

### 7.2 `applyTemplate.test.ts`

- 切换前 config 中有用户输入 → 切换后保留 `text` 内容
- 用户文字为空 → 使用新模板默认文字
- 切换前 key 在新模板中不存在 → 该图层丢弃（不报错）
- 字体 / 颜色 / 装饰均替换为新模板值
- 不修改入参对象（结构性深拷贝）

## 8. 边界与风险

| 风险 | 缓解 |
|----|------|
| 模板数量增长后 `templates/index.ts` 难维护 | v1 仅 4 个，后续如超 10 个迁移到 JSON 配置 |
| 字体 `Inter` 未在项目预加载 → PNG 渲染时回退到 sans-serif | 在 spec 05（渲染）声明字体白名单；模板默认字体仅用 web-safe + 项目已加载字体 |
| 缩略图与实际渲染差异大 | 缩略图刻意保持简化轮廓，标签上不夸张；视觉差异在可接受范围 |
| 装饰矩形/线条用归一化坐标，浮点精度可能产生 1px 错位 | 渲染时 `Math.round(x * canvasW)`；可接受 |

## 9. Dependencies

- 上游：spec 01（弹窗壳）— `TemplatePicker` 在左面板内
- 下游：spec 03（预览渲染消费 `defaultConfig` / 当前 `config`）、spec 05（渲染管线把 config 转 PNG）
- 不依赖后端

## 10. 完成条件

- [ ] 4 个模板常量文件存在且导出符合类型
- [ ] `TemplatePicker` 测试全绿
- [ ] `applyTemplate` 测试全绿
- [ ] 模板缩略图在深色 / 浅色主题下均可读
- [ ] 切换模板时若用户已编辑文字，文字保留
