# TODO 05 — Cover Render & Download

> Spec: `specs/05-cover-render-and-download.md`

## Dependencies

```yaml
depends_on: [03, 07]        # 需 previewRef + uploadCoverPng
blocks: []
parallel_group: D
```

## Tasks

### A. 安装依赖

- [ ] `npm install html-to-image`（约 9 KB gz）
- [ ] 确认 `package-lock.json` 同步提交

### B. 工具

- [ ] 写 `VideoCoverModal/utils/aspectRatioToDimensions.ts`：5 比例换算（短边 1080）
- [ ] 单测 `__tests__/aspectRatioToDimensions.test.ts`：5 个用例 + 数学一致性
- [ ] 写 `VideoCoverModal/utils/coverFontWhitelist.ts`：8 个字体（首项推荐 system-ui，因 Inter 未在 layout.tsx 加载；spec 03 的 toolbar 字体下拉消费）
- [ ] 写 `VideoCoverModal/utils/buildDownloadFilename.ts`：中文/特殊字符过滤 + 时间戳
- [ ] 单测 `__tests__/buildDownloadFilename.test.ts`：3+ 用例

### C. useCoverRender Hook

- [ ] 写 `VideoCoverModal/hooks/useCoverRender.ts`：
  - 调用 `toPng(node, { pixelRatio })`
  - 失败降级到 720p 重试
  - 维度差 > 2px 时调 `resampleToExact`
  - `isRendering` 锁 + `lastError`
- [ ] 渲染前 `await document.fonts.ready`
- [ ] 单测 `__tests__/useCoverRender.test.tsx`：mock toPng，验证 pixelRatio / 降级 / 双失败 / resample 触发

### D. 下载流程

- [ ] 写 `VideoCoverModal/utils/triggerBrowserDownload.ts`：`<a download>` + revokeObjectURL
- [ ] 在 `VideoCoverModal.tsx` `handleDownload`：
  - `setIsCapturing(true)` → 等下一帧 → 调 `render()`
  - 成功 → 触发下载 + 后台 `uploadPng(blob)`（来自 spec 07 hook）
  - 失败 → toast.error + 保留弹窗

### E. 字体加载

- [ ] 弹窗 mount 时调 `ensureFontsLoaded()`（取白名单前 3 项 `document.fonts.load`）

### F. i18n keys

- [ ] `videoCoverModal.actions.download / rendering`
- [ ] `videoCoverModal.errors.renderFailed / uploadFailed`

### G. 验收

- [ ] 5 比例都能下载到正确尺寸的 PNG（手测）
- [ ] 有装饰 + 文字 + 抽帧背景 / 上传图背景 两种场景下 PNG 视觉与预览一致
- [ ] 字体在 PNG 中正常显示（无回退）
- [ ] 下载文件名包含项目名 + 时间戳，不含非法字符
- [ ] 后台 uploadPng 失败时本地下载不受影响
- [ ] 单测全绿
