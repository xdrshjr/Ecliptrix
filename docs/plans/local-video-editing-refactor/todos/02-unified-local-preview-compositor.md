# TODO 02 — 统一本地预览合成器

> 对应 spec：[`specs/02-unified-local-preview-compositor.md`](../specs/02-unified-local-preview-compositor.md)

## Dependencies

- `depends_on: [01]` — 合成器逐帧调度用 spec 01 `ClipTimeMapping`；音频同步消费 `audioDetached`。
- `blocks: [05, 06]` — 05 导出与 02 共享转场/z-order/opacity 合成语义契约；06 持久化转场/opacity 字段并验证重载可预览。
- `parallel_group: B` — 第二批（01 完成后）。
- 理由：必须先有 01 的 clip 契约与 audioDetached；02 的转场/合成语义又是 05 对齐的依据。

## Tasks（按实现顺序）

### 现状核对（实现前必读）
- [ ] 核对 `useTimelineComposition.ts` 当前 RC-A 落地（`computeCompositionSignature` + materials-change effect）——按差异补强签名字段，勿重造
- [ ] 核对 `VideoPlayerPanel.tsx` 当前 RC-B 落地（比对键改用 live-material 解析）——把"比对键==赋值"不变量带入新合成器
- [ ] 核对 `CanvasCompositor._drawOverlays` 已实现（缺的是数据注入 + 多视频源叠加）

### 合成器核心（新建/升级）
- [ ] 写失败用例 `TrackScheduler.test.ts`：多轨命中正确 clip、边界 epsilon
- [ ] 新建 `playback/TrackScheduler.ts`：按合成时间选各轨活动 clip + 预热（用 ClipTimeMapping）
- [ ] 新建 `playback/VideoSourcePool.ts`：每轨一组 A/B 解码源、seek 容差、预热下一段；源切换判定走「比对键==赋值」同一解析（带入 RC-B 不变量，根治 stale snapshot）
- [ ] 升级 `playback/CanvasCompositor.ts`：多源逐帧叠加（z-order、opacity）+ 接入 overlay 数据
- [ ] 新建 `components/VideoPlayerPanel/PreviewCanvas.tsx`：合成器宿主（canvas + 隐藏解码源容器）
- [ ] 修改 `playback/PlaybackEngine.ts`：移除单序列假设，编排多轨调度+合成+音频
- [ ] 修改 `playback/PlaybackClock.ts`：唯一合成时钟，驱动 audio tick

### 字幕 / 转场 / 图片层
- [ ] 写失败用例 `TransitionLayer.test.ts`：淡入/淡出/溶解 alpha 曲线、区间外恒 1
- [ ] 新建 `playback/TransitionLayer.ts`：alpha 计算（与 05 共享语义）
- [ ] 新建 `playback/SubtitleLayer.ts`：字幕换行/样式/layout 缓存，绘到 canvas
- [ ] 新建 `playback/ImageOverlayLayer.ts`：图片 item rasterize 到 canvas（替代 React `<ImageOverlay>`）

### 音频同步
- [ ] 新建 `playback/AudioSyncPool.ts`：音频轨 HTMLAudio 池，接合成时钟，DRIFT_EPSILON 去抖，消费 audioDetached

### 症状① 修复 & 序列扩展
- [ ] 写失败用例 `resolveSequencePlaybackUrl.test.ts`：空 seq.url + live 直接本地素材 → 返回本地 URL，`source==='localStorageUrl'`
- [ ] 修改 `lib/resolveSequencePlaybackUrl.ts`（仅按需）：保证 stale `seq.url` 不压过 live 直接本地 URL；与合成器锁定 options 一致（先核对现状，已满足则只补回归测试）
- [ ] 写失败用例 `useTimelineComposition.localPreview.test.ts`：patch-after-insert 刷新、仅 materials 变化重建、保 currentSequenceIndex
- [ ] 修改 `useTimelineComposition.ts`：签名纳入全部 live 字段 + subtitleSequences；先比签名再 extract
- [ ] `compositionPlayback` 增 `subtitleSequences`；序列增 trackZ/opacity/transition/audioDetached 透传
- [ ] 就绪门：`canPreviewDirectLocalMaterial` 即就绪

### 删除 v1 + flag + 死代码（分阶段，验证通过后）
- [ ] 新建 `hooks/useCompositionPlayback.ts`；`VideoPlayerPanel.tsx` 改挂 PreviewCanvas + useCompositionPlayback
- [ ] 删除 v1 内联播放分支、`hooks/useVideoPlayback.ts`(@deprecated)，以及恒返回 `[]` 的 `v2OverlaysProvider` 空 stub（由真实字幕/图片 overlay 注入替代；**勿删** `CanvasCompositor._drawOverlays` 真实实现）
- [ ] `src/lib/playbackFlags.ts`：移除 v2 flag/killswitch/variant（**勿删** 解耦的 preview-proxy/local-preview flag）
- [ ] 删除 `playback/components/PlaybackVariantSwitcher.tsx`、`playback/internal/killswitchMonitor.ts`（**勿删** `proxyHitMeter.ts`，被 selectPlaybackUrl/PlaybackEngine 引用）
- [ ] 移除 `playbackFlags.ts` 中对 `/api/config/playback-flag` 的前端远端消费（`SESSION_REMOTE_KEY`/`readSessionRemoteFlag`/`cacheRemotePlaybackFlag` 缓存层）；该端点为后端路由（`config_router.py`），无对应 Next.js 前端路由文件，后端是否下线由 06 收尾/单独提交决定
- [ ] `VideoPlayerPanel.tsx` 拆分到 ≤800 行/模块

### 验收
- [ ] `npm run type-check` + 上述 vitest 全绿；代码内无 `isPlaybackV2Enabled` 引用
- [ ] 组件用例：黑屏/不播修复、patch-after-insert、多轨叠加、字幕、音频不重复
- [ ] 桌面走查：导入 → 多轨叠加 + 字幕 + 转场预览，仅同源 `/api/storage/files`，中等素材不卡
