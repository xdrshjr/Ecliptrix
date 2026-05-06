# TODO 04 — Frame Scrubber & Upload

> Spec: `specs/04-frame-scrubber-and-upload.md`

## Dependencies

```yaml
depends_on: [01]            # 仅需弹窗壳
blocks: [05]                # 渲染管线消费 backgroundUrl
parallel_group: B           # 与 02, 07 并行
```

## Tasks

### A. 算法层

- [ ] 写 `VideoCoverModal/utils/buildVirtualSegments.ts`
  - 入参 `TimelineItemData[]`（来自 `@/components/video/timeline/domain/types`）
  - 仅保留 `type === 'video'` 且 `(originalMaterialType === 'video' || undefined)` 且有 `materialId` 的条目
  - 跳过 `duration <= 0`
  - 按 `startTime` 排序，cumulative 拼接
  - `clipOffset = clipStart ?? 0`
- [ ] 写 `mapVirtualTimeToClip(virtualTime, vt)`，包括 `virtualTime === totalDuration` 的边界处理
- [ ] 单测 `__tests__/buildVirtualSegments.test.ts`：6+ 用例（空 / 单 / 多 / 含空档 / image 过滤 / audio 过滤 / 0 时长）
- [ ] 单测 `__tests__/mapVirtualTimeToClip.test.ts`：边界 0 / 中点 / totalDuration / 越界

### B. extractVideoFrameAt 工具

- [ ] 修改 `src/components/video/utils/extractVideoThumbnail.ts`：把内部 `proxiedVideoUrl` 改为 `export function proxiedVideoUrl(...)`（一行 diff，不破坏已有用法）
- [ ] 新增 `src/components/video/utils/extractVideoFrameAt.ts`：
  - 签名 `(videoUrl, timeSec, options?) → Promise<string>` JPEG dataURL
  - 复用 `proxiedVideoUrl`
  - `crossOrigin='anonymous' / muted / playsInline`
  - loadedmetadata + seeked 等待（带 timeoutMs）
  - canvas 抽帧、可选 maxWidth 缩放
- [ ] 单测：mock video 元素，验证 currentTime 设置 + canvas drawImage 调用 + 超时抛错

### C. useFrameExtraction Hook

- [ ] 写 `VideoCoverModal/hooks/useFrameExtraction.ts`
  - LRU(8) 缓存 (materialId@time)
  - inflight 去重
  - 错误向上抛
- [ ] 单测 `__tests__/useFrameExtraction.test.tsx`：缓存命中 / 并发去重 / null 路径 / 错误传递

### D. FrameScrubber 组件

- [ ] 写 `FrameScrubber.tsx`：range input + 时间显示 mm:ss / mm:ss + 5s 刻度
- [ ] disabled 态视觉
- [ ] onChange（实时）+ onCommit（mouseup/touchend）
- [ ] 单测：拖动 / commit / disabled

### E. ImageUploadInput 组件

- [ ] 写 `ImageUploadInput.tsx`：拖拽 / 点击触发 input[file]
- [ ] 校验 type ∈ {png, jpeg}，size ≤ 10MB
- [ ] 通过 BFF `POST /api/storage/upload-file`（已存在）上传，FormData 内联（项目无 `src/lib/api/storage.ts`，参考其他模块的直接 fetch 模式）
- [ ] 已上传缩略图 + "重新上传"按钮
- [ ] 单测：文件校验 / 上传成功 / 错误提示

### F. FrameScrubberOrUpload 容器

- [ ] 写 `FrameScrubberOrUpload.tsx`：源切换控件（抽帧/上传）+ 子组件分支渲染
- [ ] `useEffect`：`vt.totalDurationSec === 0` 时自动切到上传 + toast 提醒
- [ ] 单测：源切换 / 自动切换 / 状态清理

### G. 接入 VideoCoverModal

- [ ] `useMemo` 构建 `vt = buildVirtualSegments(timelineItems)`
- [ ] `useFrameExtraction(vt, materials)` 暴露 `extractAt`
- [ ] 200ms debounce 拖动 → `extractAt` → `setBackgroundUrl(dataUrl)`
- [ ] 上传成功 → `setBackgroundUrl(uploadedUrl)`，并 setCoverState({ imageSource:'upload', uploadedImageUrl })
- [ ] 切换源时清空对方状态

### H. i18n keys

- [ ] `videoCoverModal.source.frame / upload / autoSwitchedToUpload`
- [ ] `videoCoverModal.scrubber.tooltip / atTime / disabled`
- [ ] `videoCoverModal.upload.dropzone / formats / errors.tooLarge / wrongType / networkError`

### I. 验收

- [ ] 项目含 3 段视频 + 1 段空档时，滑块跳过空档
- [ ] 拖动产生 60fps 流畅，最多每 200ms 一次实际抽帧
- [ ] 跨域视频 URL 抽帧成功（手测）
- [ ] 项目无视频时自动切到上传
- [ ] 上传超大文件提示
- [ ] 单测全绿
