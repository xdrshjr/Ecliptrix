# TODO 04 — 本地音频波形

> 对应 spec：[`specs/04-local-waveform.md`](../specs/04-local-waveform.md)

## Dependencies

- `depends_on: []` — 与 01 弱关联（波形按 clip 区间切片），可独立开工。
- `blocks: [06]` — 06 的删除联动清理与孤儿回收需 04 暴露的 `delete_by_material`。
- `parallel_group: A` — 第一批（与 01、03 并行）。
- 理由：波形后端生成 + 前端渲染自成一体；仅向 06 提供清理钩子。
- **同文件协调**：与 03 同改 `storage_router.py`/`storage_models.py`/`config.py`（端点/模型不重叠：waveform vs thumbnail-frame）。

## Tasks（按实现顺序）

### 后端 peaks 生成 + 持久化
- [ ] 写失败用例 `tests/test_waveform_service.py`：peaks 抽取（短样本）、归一、JSON 落盘、列举/删除、幂等
- [ ] `config.py`：`WaveformConfig`（peaksPerSecond、并发、超时）
- [ ] 新建 `services/waveform_service.py`：ffmpeg 抽 peaks + 归一降采样 + JSON 落 `static/audio/waveforms/{materialId}.json` + 按 materialId 列举/删除（暴露 `delete_by_material` 供 06）
- [ ] `storage_models.py`：波形生成请求/响应/状态模型（REST 用 snake_case；落盘 peaks JSON 另用 camelCase 供前端 canvas 直读，二者不混用）
- [ ] `storage_router.py`：`POST /storage/waveform/generate`（幂等）、`GET /storage/waveform/{materialId}`
- [ ] `storage_service.py`：音频/含音轨视频上传后入队波形生成（后台、QueueManager 限流）

### 前端从 peaks 渲染
- [ ] 写失败用例 `drawWaveform.test.ts`：peaks→列峰值映射、clip 区间切片、空/失败降级
- [ ] 写失败用例 `waveformCache.test.ts`：ensure 幂等、状态流转、区间切片
- [ ] 新建 `lib/waveform/waveformClient.ts`：调生成/查询端点
- [ ] 新建 `lib/waveform/waveformCache.ts`：peaks 内存缓存 + ensure/状态 + clip 区间切片
- [ ] 新建 `lib/waveform/drawWaveform.ts`：纯 canvas 按 peaks 绘制（无解码）
- [ ] `TimelineItem.tsx`：音频/已分离音频 item 渲染 canvas 波形（替代空置 waveformData）；占位/降级
- [ ] `components/VideoProcessingModal/WaveformPreview.tsx`：优先读持久化 peaks，无则回退 wavesurfer live 或触发生成

### 验收
- [ ] `npm run type-check` + 上述 vitest + `pytest test_waveform_service.py` 全绿
- [ ] 桌面走查：导入音频 → 波形（占位后出现）→ 重载命中持久化 → trim/split 后波形随 clip 切换；Network 仅同源
