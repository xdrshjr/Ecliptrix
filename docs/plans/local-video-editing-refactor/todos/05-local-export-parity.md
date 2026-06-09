# TODO 05 — 本地导出（特性对齐预览）

> 对应 spec：[`specs/05-local-export-parity.md`](../specs/05-local-export-parity.md)

## Dependencies

- `depends_on: [01, 02]` — 用 spec 01 clip 契约裁剪；与 spec 02 共享转场/z-order/opacity 合成语义（对齐）。
- `blocks: []` — 末端能力。
- `parallel_group: C` — 第三批（01、02 完成后）。
- 理由：导出 filtergraph 必须复现预览(02)的多轨/转场/opacity 视觉；clip 裁剪走 01 契约。可与 06 并行。

## Tasks（按实现顺序）

### 现状核对（实现前必读）
- [ ] 核对路由：前端连字符 `/api/video-compose`（BFF 代理）→ 后端斜杠 `/api/video/compose`（均不改名）
- [ ] 核对 `local_media_resolver.py` 已 `allow_remote=False` + 白名单——真正改动在去掉 `video_composition_service.py` ~963 行的下载回退
- [ ] 核对 `VideoCompositionItem` 已有 `opacity`/`volume`/`clip_*`（`opacity` 非新增）——仅 `track_z`/`transition_in/out`/`audio_detached` 为新增

### 前端导出本地化
- [ ] 写失败用例 `useVideoExport.localExport.test.ts`：导出 URL 全本地、含 track_z/opacity/transition/audio_detached
- [ ] `useVideoExport.ts`：URL 改用 `selectPlaybackUrl(export)`；clip 走 01 语义；传合成元数据
- [ ] `CompositionAdapter.ts`：`buildCompositionRequest` 透传 z/opacity/transition/audio_detached；与 selectPlaybackUrl(export) 收敛
- [ ] 加强 `CompositionAdapter.exportPath.test.ts`：导出 URL 必本地、含新字段
- [ ] `selectPlaybackUrl.ts`：确认 export 分支本地优先、排除 blob/proxy/preview-proxy（多为既有）

### 后端 filtergraph 多轨 + 转场（拆分巨型 service）
- [ ] 写失败用例 `tests/test_filtergraph_builder.py`：两轨叠加 overlay、相邻 clip dissolve→xfade、clip trim/setpts、字幕、无多轨回退 concat
- [ ] 写失败用例 `tests/test_local_media_resolver.py`：本地解析、越权拒绝、非本地报错
- [ ] 写失败用例 `tests/test_audio_mix.py`：amix 尊重音量/静音/audio_detached
- [ ] `models/video_models.py`（`VideoCompositionItem`）：增 `track_z`/`transition_in`/`transition_out`/`audio_detached`（snake_case）
- [ ] 新建 `services/composition/filtergraph_builder.py`：多轨叠加 + 转场 + clip + 字幕（与 02 语义对齐）
- [ ] 新建 `services/composition/media_resolution.py`：cache 命中 / 复用 `resolve_media_reference(allow_remote=False)` / 非本地报错（**调用** resolver，不重实现白名单与路径映射）
- [ ] `local_media_resolver.py`（修改，小、按需）：导出涉及 `static/video/thumbnails` 且不在 `_allowed_roots()` 时补入该目录，否则拒绝（防越权读盘 R7）；`allow_remote=False` 与既有白名单不改
- [ ] 新建 `services/composition/audio_mix.py`、`services/composition/encode.py`（GPU/参数）
- [ ] `video_composition_service.py`：编排（解析→filtergraph→编码）；**去掉 ~963 行本地未命中即下载的回退**；接新字段；filter_complex 失败回退 concat

### 对拍（特性对齐）
- [ ] 写失败用例 `tests/test_export_parity.py`：两视频轨叠加 + dissolve + 字幕，导出帧与预览同时刻输出容差内一致

### 验收
- [ ] `npm run type-check` + 前端 vitest + 后端 pytest（filtergraph/resolver/audio_mix/parity）全绿
- [ ] 桌面走查：多轨+转场+字幕时间轴 → 导出成片与预览一致；全程仅读本地、无网络下载；输出落本地可播
