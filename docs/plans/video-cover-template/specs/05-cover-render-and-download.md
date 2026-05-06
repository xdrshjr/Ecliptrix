# Spec 05 — Cover Render & Download

> 父：`master-plan.md` §5.4（渲染管线）, G7（PNG 1080p 下载）
> 范围：DOM → PNG 渲染、字体白名单、分辨率换算、下载触发、错误降级

## 1. Goals

- G5.1 调用 `useCoverRender.toPng()` 时，把当前 `CoverPreview` DOM 渲染为 PNG Blob
- G5.2 PNG 短边 = 1080，长边按 aspectRatio 换算
- G5.3 字体仅使用项目已加载或 web-safe 白名单（避免 PNG 字体回退）
- G5.4 渲染失败 → 自动降级到 720p 重试一次；仍失败 → 显示错误并保留弹窗
- G5.5 下载触发：浏览器 `<a download>` + 后台异步上传 PNG 缓存到后端

## 2. 依赖与第三方包

### 2.1 新增依赖

- `html-to-image`（npm 包名 `html-to-image`，约 9 KB gz）
- 通过 `npm install html-to-image` 安装；记录在 `package.json` `dependencies`

### 2.2 不引入

- 不引入 `dom-to-image-more`（已停止维护）
- 不引入 `puppeteer` / `playwright`（要后端）
- 不依赖 `<canvas>` 直接绘制（手撕 SVG 文字栅格化复杂度高）

## 3. 文件改动列表

### 3.1 新增

```
src/components/video/components/VideoCoverModal/
├── hooks/
│   └── useCoverRender.ts
├── utils/
│   ├── aspectRatioToDimensions.ts
│   └── coverFontWhitelist.ts
└── __tests__/
    ├── aspectRatioToDimensions.test.ts
    └── useCoverRender.test.tsx        # 主要测试 contract，渲染 mock 掉
```

## 4. 字体白名单

### 4.1 列表（v1）

```ts
// utils/coverFontWhitelist.ts
export const COVER_FONT_OPTIONS = [
  { value: 'Inter',           label: 'Inter (Sans)' },
  { value: 'system-ui',       label: 'System' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, serif',  label: 'Georgia (Serif)' },
  { value: 'Courier New, monospace', label: 'Courier (Mono)' },
  { value: 'Microsoft YaHei, PingFang SC, sans-serif', label: '微软雅黑 / 苹方' },
  { value: 'SimHei, Heiti SC, sans-serif', label: '黑体' },
  { value: 'KaiTi, 楷体, serif', label: '楷体' },
];
```

### 4.2 字体加载验证

启动时（弹窗 mount 时）执行：

```ts
async function ensureFontsLoaded() {
  if (!('fonts' in document)) return;
  const samples = COVER_FONT_OPTIONS.slice(0, 3);   // 验证主要字体
  await Promise.all(
    samples.map(f => document.fonts.load(`16px ${f.value}`))
  );
}
```

> **Inter 字体加载注意**：经核对 `src/app/layout.tsx`，项目目前 **未** 通过 `next/font` 或 `<link>` 显式加载 Inter；body 仅用 `font-sans`（Tailwind 默认 sans 栈，依赖系统字体）。两个选项：
>
> 1. **保持现状**：将白名单首项替换为更可靠的 `system-ui, -apple-system, sans-serif`，去掉 `Inter` 或将其作为可选项，让用户即使未安装 Inter 也不会回退到 Times；
> 2. **加载 Inter**：在 `src/app/layout.tsx` 内引入 `import { Inter } from 'next/font/google'` 并把 className 注入 `<body>`，使 PNG 渲染时 Inter 真实可用。
>
> 本 spec 推荐方案 1（最小变更），将默认模板字体改为 `system-ui` 栈；若后续要 Inter 再切方案 2。其它都是系统字体，不需要外网获取。

## 5. 分辨率换算

```ts
// utils/aspectRatioToDimensions.ts
export function aspectRatioToDimensions(
  ratio: '16:9' | '9:16' | '1:1' | '4:3' | '21:9'
): { width: number; height: number } {
  const [w, h] = ratio.split(':').map(Number);
  // 短边固定 1080
  if (w >= h) {
    const height = 1080;
    const width = Math.round((w / h) * height);
    return { width, height };
  } else {
    const width = 1080;
    const height = Math.round((h / w) * width);
    return { width, height };
  }
}
```

| 输入 | 输出 |
|----|------|
| 16:9 | 1920 × 1080 |
| 9:16 | 1080 × 1920 |
| 1:1 | 1080 × 1080 |
| 4:3 | 1440 × 1080 |
| 21:9 | 2520 × 1080 |

测试覆盖全部 5 个比例 + 数学一致性。

## 6. `useCoverRender` Hook

### 6.1 API

```ts
export interface CoverRenderResult {
  blob: Blob;                        // image/png
  dataUrl: string;                   // 用于即时下载
  width: number;
  height: number;
}

export function useCoverRender(opts: {
  previewRef: React.RefObject<HTMLElement>;     // 指向 .layers 容器
  aspectRatio: CoverAspectRatio;
}): {
  render: () => Promise<CoverRenderResult>;
  isRendering: boolean;
  lastError: Error | null;
};
```

### 6.2 实现（伪码）

```ts
import { toPng } from 'html-to-image';

export function useCoverRender({ previewRef, aspectRatio }) {
  const [isRendering, setIsRendering] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);

  const render = useCallback(async (): Promise<CoverRenderResult> => {
    if (!previewRef.current) throw new Error('preview not mounted');
    setIsRendering(true);
    setLastError(null);

    const { width, height } = aspectRatioToDimensions(aspectRatio);
    const node = previewRef.current;
    const rect = node.getBoundingClientRect();
    const pixelRatio = width / rect.width;        // 让 1080p 输出

    // 提示 CoverPreview 进入捕获模式 (suppressChrome=true) — 由调用方先触发 setIsCapturing(true)

    const tryRender = async (pr: number) => {
      const dataUrl = await toPng(node, {
        pixelRatio: pr,
        cacheBust: true,
        backgroundColor: undefined,
        // skip element-level CSS not needed for capture
        skipFonts: false,
        fontEmbedCSS: '',     // 字体已加载，无需嵌入
        filter: (n) => !(n instanceof HTMLElement && n.classList.contains('skip-capture')),
      });
      const blob = await (await fetch(dataUrl)).blob();
      return { blob, dataUrl, width: Math.round(rect.width * pr), height: Math.round(rect.height * pr) };
    };

    try {
      let result;
      try {
        result = await tryRender(pixelRatio);
      } catch (err) {
        // 降级 720p
        const fallbackPR = 720 / Math.min(rect.width, rect.height);
        result = await tryRender(fallbackPR);
      }
      // 校验输出维度 = 期望尺寸（允许 ±2 px）
      if (Math.abs(result.width - width) > 2 || Math.abs(result.height - height) > 2) {
        // 用 OffscreenCanvas 重采样到精确尺寸（可选）
        result = await resampleToExact(result, width, height);
      }
      return result;
    } catch (err) {
      setLastError(err as Error);
      throw err;
    } finally {
      setIsRendering(false);
    }
  }, [previewRef, aspectRatio]);

  return { render, isRendering, lastError };
}
```

### 6.3 `resampleToExact` 工具

```ts
async function resampleToExact(input: CoverRenderResult, w: number, h: number) {
  const img = new Image();
  img.src = input.dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/png');
  const blob = await (await fetch(dataUrl)).blob();
  return { blob, dataUrl, width: w, height: h };
}
```

## 7. 下载流程

`VideoCoverModal` 的 `handleDownload`：

```ts
async function handleDownload() {
  setIsCapturing(true);                  // 隐藏选中描边
  await waitNextFrame();
  let result;
  try {
    result = await render();
  } catch (err) {
    setIsCapturing(false);
    toast.error(t.videoCoverModal.errors.renderFailed);
    return;
  }
  setIsCapturing(false);

  // 即时下载
  const filename = buildDownloadFilename(projectName);
  triggerBrowserDownload(result.blob, filename);

  // 后台上传缓存（不阻塞 UI）
  uploadCoverPng(projectId, result.blob).catch(err => {
    // 上传失败仅日志；本地文件已保存
    console.warn('cover png cache upload failed', err);
  });
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildDownloadFilename(projectName: string) {
  const safe = projectName.replace(/[^\w一-龥-]/g, '_').slice(0, 40);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${safe}-cover-${ts}.png`;
}
```

`uploadCoverPng` 在 spec 07（API client）内实现。

## 8. 字号缩放

由于 `EditableTextLayer` 使用 `cqh` 单位（容器查询高度的百分比），渲染时 1080 高的画布上字号自动缩放。无需额外计算。

> 退路：若浏览器不支持 cqh，把 fontSize 在渲染时手动转换为 `${(fontSize / 1080) * containerHeightPx}px`。

## 9. i18n keys 增量

```ts
videoCoverModal: {
  actions: {
    download: '下载封面' | 'Download Cover',
    rendering: '生成中…' | 'Rendering…',
  },
  errors: {
    renderFailed: '封面生成失败，请重试' | 'Cover render failed, please retry',
    uploadFailed: '云端缓存失败（不影响本地下载）' | 'Cloud cache failed (local download unaffected)',
  },
}
```

## 10. 测试计划

### 10.1 单元

- `aspectRatioToDimensions.test.ts` — 5 比例输出表
- `buildDownloadFilename.test.ts` — 中文 / 特殊字符 / 长名字截断
- `useCoverRender.test.tsx` — mock `toPng` 验证：1) 调用 pixelRatio 计算正确；2) 第一次失败降级到 720p；3) 两次都失败抛错；4) 维度差异时调 resample

### 10.2 集成（手动 QA）

- 5 个比例都能下载到正确尺寸的 PNG
- 模板 4 种 + 自定义文字下，PNG 视觉与预览一致
- 抽帧背景 + 文字下，PNG 包含背景与文字
- 上传图背景 + 文字下，PNG 包含上传图与文字
- 字体在 PNG 中正常显示（无回退到 Times New Roman）

## 11. 边界与风险

| 风险 | 缓解 |
|----|------|
| `toPng` 在 Firefox / Safari 表现差异 | 添加浏览器 sniff，必要时切换 `toJpeg` 然后再封装 PNG（或直接降级到 720p） |
| 跨域图片 / 视频帧导致 PNG 透明 | 视频帧来源于 dataURL（已 inline），不存在跨域问题；上传图来自项目 storage（同源） |
| Web Font 未加载完成 → PNG 字体回退 | 渲染前 `await document.fonts.ready` |
| html-to-image 处理 SVG decoration 时尺寸偏差 | 装饰用 viewBox + preserveAspectRatio="none"，pixelRatio 一致缩放 |
| 1080p PNG 文件较大（~500KB-2MB） | 接受；后端缓存配额由现有 storage 管理 |
| 高分辨率渲染时浏览器内存峰值 | 失败自动降到 720p；同时一次只允许一个渲染（`isRendering` 锁） |
| iOS Safari 对 `URL.createObjectURL` + `<a download>` 的处理：可能在新标签打开 | 提供降级：在新标签打开图片，提示用户手动保存 |
| 下载文件名中文支持 | 多数浏览器 OK；Firefox 老版本可能丢失，已 ASCII 化的项目名作为 fallback 不影响功能 |

## 12. Dependencies

- 上游：spec 03（提供 `previewRef` 指向 `.layers` 容器）、spec 02（CoverConfig）、spec 04（背景层 dataURL 已注入）
- 下游：spec 07（`uploadCoverPng` 由 useCoverPersistence 提供）
- 第三方：`html-to-image`

## 13. 完成条件

- [ ] `aspectRatioToDimensions` 单测全绿
- [ ] `useCoverRender` 单测覆盖正常 / 降级 / 失败
- [ ] 5 比例渲染手动 QA 通过
- [ ] PNG 下载文件名正确
- [ ] 字体在 PNG 中正常显示
