# Phase 3 Digest — TODO 05 (本地导出对齐) + TODO 06 (持久化 + 缓存GC)

两任务并行（dev-01 → 05，dev-02 → 06，DISJOINT 文件），各过三权审/测；orchestrator 兼 inspector。
治理：三权分立 + Token 经济。无淘汰。

## Completed Tasks

| 任务 | Dev | Review | Test | 关键产出 |
|---|---|---|---|---|
| TODO 05 导出对齐 | google-dev-01 PASS WITH FIXES（audio_mix rework 后 wired） | PASS WITH FIXES | PASS WITH FIXES（parity mutation-proven） | 前端导出 URL 本地化（selectPlaybackUrl(export)，禁 blob/proxy）；后端 D10 拆分 `composition/{filtergraph_builder,encode,audio_mix,media_resolution}`；多轨叠加+转场 filter_complex（z-order/opacity/xfade 对齐预览）；去云下载回退（NonLocalMediaError）；预览↔导出 parity oracle |
| TODO 06 持久化+GC | google-dev-02 PASS（含 Phase-1 footgun 闭合） | PASS | ALL PASS（reclaim safety mutation-proven） | TimelineRepository 持久化（split/trim/转场/audioDetached/轨序）；projectHydration（live-material 权威，黑屏守卫）；停止内联 waveformData；DELETE /storage/material 联动清理 + derived_gc_service 孤儿回收（三层安全阈值）；4-cache eviction 串联 |

## Key Decisions
- **05 parity = 参数/语义对齐，非跨语言像素比对**（§6.7 允许）。`test_export_parity.py` 用 Python oracle 复刻 `TransitionLayer.alphaFor` 逐项算术；tester mutation-proven（扰动 oracle → 测试失败）。filtergraph 编码 z-order=轨序、opacity→colorchannelmixer aa、dissolve overlap==duration。
- **05 audio_mix 修复揭出真实潜藏 bug**：原 audio_mix.py 与 live pipeline **背离**（在 filtergraph 内施加 volume，而 live 管线 volume 已逐文件 bake、路由在上游）。verbatim wiring 会**双重施加 volume**。dev-01 重写为 inline 构造的字面提取 + 字节级 oracle 等价证明，再 wired（2747→2744）。
- **06 孤儿回收三层安全**：reclaim() 空/非-set 引用集 → 删 0；main.py 启动 dry-run + 空 provider；破坏性 POST 端点当前**无前端调用方**（dormant）。tester mutation-proven（弱化 guard → 安全测试捕获 mass-delete）。
- **06 poster-stem vs materialId footgun**：poster 落 `thumbnails/{stem}/`、filmstrip 落 `thumbnails/{materialId}/`；DELETE cascade 用 extra_keys 处理两套键空间；reclaim 的残余误删风险已文档化且**不可达**（无调用方）。

## Interfaces Established
- 扩展 `VideoCompositionRequest`：video_items 增 `track_z/transition_in/transition_out/audio_detached`（snake_case，可选，向后兼容）；前端 snake_case emit ↔ 后端 pydantic 解析，契约已验证。
- `DELETE /api/storage/material/{id}`（删源 + 联动删缩略图/波形）、`POST /api/storage/reclaim-orphans`（前端供引用集，dormant）；`derived_gc_service.reclaim(referenced)`；4-cache eviction 契约。
- 复用（未重实现）：`local_media_resolver.resolve_media_reference(allow_remote=False)`、`thumbnail_service/waveform_service.delete_by_material/list_*`、spec-02 `resolveSequencePlaybackUrl`。

## Quality Gates（Phase 3 末，已独立复核）
- `npm run type-check`：clean。
- 全量 `vitest run src`：**1240 passed / 2 failed**（2 = `backend-proxy.test.ts` BFF query-string，先于本期、与本期无关，vs main 零改动）。
- 后端 touched-area pytest（5 新文件 + thumbnail + waveform）：**78 passed / 0 failed**。
- 两位 dev 的并发 `src/types/index.ts` 编辑无冲突标记、coherent（已核）。

## 已知遗留（非阻断，后续清理）
- `video_composition_service.py` 仍 2744 行（>800）：D10 服务级拆分是更大的既有债，本期仅抽出 4 子模块。
- `useMaterialManagement.ts` 1295 行（>800）：既有债（HEAD 1209），非本期回归。
- 后端 `test_video_composition*` 15 项 + `_sanitize_filename` 2 项失败：dev-01 stash 验证为**先于本期**、与本期改动无关；本地 `app.main` 因 anaconda 环境 **cv2 二进制损坏**无法整体 boot（Phase-1 亦遇），pytest 直接 import service 不受影响。
- Phase 2 死常量残留（`playback/internal/constants.ts`）仍待清理。

## Context（项目收尾）
local-video-editing-refactor 三阶段（剪辑核心/缩略图/波形 → 统一预览合成器 → 导出对齐/持久化GC）**代码层全部完成**。
**⚠️ 强制门**：预览(canvas)、导出(真实 ffmpeg 多轨叠加/xfade/字幕烧录像素)、持久化(关闭重开恢复)、删除联动(磁盘文件消失)、孤儿回收(重启无堆积) 均**只能桌面走查验证**，单测/pytest 钉死的是接线与参数语义。05+06 桌面清单见各自 dev summary。
