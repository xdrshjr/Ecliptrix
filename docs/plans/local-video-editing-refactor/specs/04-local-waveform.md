# Spec 04 — 本地音频波形

> 所属：`local-video-editing-refactor`　|　依赖：master-plan、（弱）spec 01/03
> 被依赖：06 持久化与缓存治理（追踪派生文件）
> 覆盖目标：G5（波形本地化）

## 1. 概述 (Overview)

把音频轨 clip 的波形图做成**本地生成 + 本地持久化**：素材导入/上传时由**后端 FFmpeg** 抽取
振幅 peaks，序列化为紧凑 JSON 落到本地存储；前端音频轨**从 peaks 渲染**波形，不再每次加载都
用 wavesurfer.js 在浏览器里 live decode 整段音频（中等性能、长音频会卡 5–10s）。

现状（已勘察）：
- 前端 `components/VideoProcessingModal/WaveformPreview.tsx` 用 **wavesurfer.js live decode**
  展示波形（仅 VideoProcessingModal 内，非时间轴音频轨；每次解码整段音频）。
- `TimelineItemData.waveformData?: number[]` 字段**存在但空置**：无后端生成、无持久化、时间轴音频轨
  未渲染波形。
- 后端**无任何波形生成**逻辑。

本 spec 让时间轴音频轨（及 detach 出的音频 item，spec 01）显示**持久化的本地波形**。

## 2. 技术设计 (Technical Design)

### 2.1 生成与存储总览

```mermaid
graph LR
  AUp[导入/上传音频<br/>或含音轨的视频] --> WF[后端 FFmpeg<br/>抽振幅 peaks]
  WF --> Norm[归一 + 降采样为<br/>定长 peaks 数组]
  Norm --> WDir[(STORAGE_ROOT/static/audio/waveforms/<br/>{materialId}.json)]
  Render[音频轨渲染] --> Have{本地已存?}
  Have -- 是 --> Draw[canvas 按 peaks 绘制波形]
  Have -- 否 --> Trigger[触发后端生成<br/>生成中显示占位]
  WDir --> Draw
```

### 2.2 后端 peaks 抽取

- 用内置 ffmpeg 把音频解码为单声道 PCM，按固定每秒采样点数（如 `PEAKS_PER_SECOND`）做**绝对值
  峰值降采样**，得到定长（与时长成比例）的 `peaks: number[]`（0..1 归一）。
- 方案：`ffmpeg -i <input> -ac 1 -f s16le ... | 降采样` 或用 `ffmpeg ... astats/aformat` 管道；
  实现择一稳定路径。生成在**导入/上传后台任务**进行（不阻塞上传响应），经队列限流（QueueManager）。
- 序列化为紧凑 JSON：`{ version, materialId, durationSec, peaksPerSecond, peaks: [...] }`，落到
  `STORAGE_ROOT/static/audio/waveforms/{materialId}.json`，经 `/api/storage/files` 服务。
- **含音轨的视频**：spec 01 的音画分离会派生音频 item（同 materialId），其波形复用同一 `{materialId}.json`。

### 2.3 生成触发与状态

```
ensureWaveform(materialId):
  if 本地存在 {materialId}.json: return ready
  else: enqueue 后端生成；返回 pending（前端显示占位/加载态）
```

- 触发时机：① 音频素材上传/导入完成后自动后台生成；② 音频 item 首次进入轨道渲染时按需触发
  （幂等，已存则跳过）。
- 状态查询：前端轮询或在素材元数据上读 `waveformStatus`（pending/ready/failed）。

### 2.4 前端从 peaks 渲染

```
drawWaveform(canvas, peaks, clip, zoom):
  visibleRange = clip 在轨道可视像素区间
  srcRange = [clipStart, clipEnd] 对应的 peaks 子区间（用 spec 01 区间语义切片）
  对每个像素列：取该列覆盖的 peaks 最大值 → 画对称竖条
```

- 渲染纯 canvas，**只读 peaks**，无音频解码；缩放/滚动只重画，不重解。
- clip 被 trim/split 后（spec 01），按 `clipStart/clipEnd` 切 peaks 子区间显示对应片段，与 clip 内容对齐。
- 降级：peaks 未就绪 → 显示占位条/加载态；失败 → 显示静态占位，不报错阻塞。
- **VideoProcessingModal 的 WaveformPreview**：可改为优先读持久化 peaks（命中则不再 live decode）；
  无 peaks 时回退现有 wavesurfer live（兼容），或触发后端生成。

### 2.5 与缓存治理（06）衔接

- `{materialId}.json` 归集于 `static/audio/waveforms/`，便于 06 按 materialId 清理与孤儿回收。

## 3. 文件 / 模块变更计划 (File / Module Change Plan)

| 文件 | 动作 | 意图 |
| --- | --- | --- |
| `backend-services/basic-service/app/services/waveform_service.py` | 新建 | ffmpeg 抽 peaks + 归一降采样 + JSON 落盘 + 按 materialId 列举/删除（供 06） |
| `backend-services/basic-service/app/routers/storage_router.py` | 修改 | 新增 `POST /storage/waveform/generate`（触发/幂等）与 `GET /storage/waveform/{materialId}`（取 peaks 或状态） |
| `backend-services/basic-service/app/models/storage_models.py` | 修改 | 波形生成请求/响应、状态模型 |
| `backend-services/basic-service/app/config.py` | 修改 | `WaveformConfig`：peaksPerSecond、并发、超时 |
| `backend-services/basic-service/app/services/storage_service.py` | 修改（小） | 音频/含音轨视频上传后入队波形生成（后台、限流） |
| `backend-services/basic-service/tests/test_waveform_service.py` | 新建 | peaks 抽取（用短样本）、归一、JSON 落盘、列举/删除、幂等 |
| `src/components/video/lib/waveform/waveformClient.ts` | 新建 | 调 `POST /storage/waveform/generate`、`GET /storage/waveform/{materialId}` |
| `src/components/video/lib/waveform/waveformCache.ts` | 新建 | peaks 内存缓存 + ensure/状态；clip 区间切片 |
| `src/components/video/lib/waveform/drawWaveform.ts` | 新建 | 纯 canvas 按 peaks 绘制（无解码） |
| `src/components/video/timeline/TimelineItem.tsx` | 修改 | 音频/已分离音频 item 渲染 canvas 波形（替代空置 waveformData）；占位/降级 |
| `src/components/video/components/VideoProcessingModal/WaveformPreview.tsx` | 修改 | 优先读持久化 peaks；无则回退 wavesurfer live 或触发生成 |
| `src/components/video/lib/waveform/__tests__/drawWaveform.test.ts` | 新建 | peaks→列峰值映射、clip 区间切片、空/失败降级 |
| `src/components/video/lib/waveform/__tests__/waveformCache.test.ts` | 新建 | ensure 幂等、状态流转、区间切片 |

## 4. 接口设计 (Interface Design)

新增后端 REST（同源本地）：

REST 响应字段沿用本项目 Pydantic **snake_case** 约定（与 spec 03 的 thumbnail 端点一致）；
落盘 peaks JSON 由前端 canvas 直接消费，用 **camelCase**（见下）。

```http
POST /api/storage/waveform/generate
  json: { material_id, audio_url }       # audio_url 为同源 /api/storage/files 本地引用；
                                         # 触发②（轨道按需）时由前端持有的 live material 提供
  → { status: "pending" | "ready", url?: "/api/storage/files/static/audio/waveforms/{material_id}.json" }

GET  /api/storage/waveform/{material_id}
  → { status, duration_sec?, peaks_per_second?, peaks?: number[], url? }
```

前端内存契约：

```
waveformCache.ensure(materialId, audioUrl): Promise<'ready'|'pending'|'failed'>
waveformCache.peaksFor(materialId, clip): number[] | null    // 已就绪则返回 clip 区间切片
```

落盘 peaks JSON 结构（前端直读）：`{ version:1, materialId, durationSec, peaksPerSecond, peaks: number[] }`。

## 5. 数据模型 (Data Model)

无 DB 迁移（波形为文件）。可选：素材元数据上携带 `waveformStatus`（pending/ready/failed）便于 UI；
持久化（06）项目保存只需 `materialId`，peaks 由 materialId 重新解析（不入项目 JSON）。
`TimelineItemData.waveformData` 字段保留但**不再作为权威**（避免把大数组塞进项目 JSON）；若历史项目
带有内联 `waveformData`，可作首屏兜底，随后以持久化 peaks 替换。

落盘约定：
```
STORAGE_ROOT/static/audio/waveforms/{materialId}.json
```

## 6. 测试与验收 (Testing & Acceptance)

先写失败用例。

后端：
1. 短音频样本 → peaks 抽取返回定长归一数组，长度 ≈ durationSec * peaksPerSecond。
2. JSON 落到 `static/audio/waveforms/{materialId}.json`，`GET` 可取。
3. 幂等：已存则不重抽，直接 ready。
4. `waveform_service` 按 materialId 列举/删除（供 06）。

前端：
5. `drawWaveform`：peaks → 列峰值映射正确；clip=[2,5] 切片只取对应区间；空 peaks 降级占位。
6. `waveformCache.ensure`：未就绪触发生成返回 pending；就绪返回切片。
7. `TimelineItem`：音频 item 渲染波形；detach 出的音频 item 复用同 materialId peaks；失败降级。

命令：
```bash
npm run type-check
npm run test -- src/components/video/lib/waveform/__tests__/drawWaveform.test.ts
npm run test -- src/components/video/lib/waveform/__tests__/waveformCache.test.ts
pytest backend-services/basic-service/tests/test_waveform_service.py -v
```

桌面手动走查：导入音频 → 音频轨显示波形（首次短暂占位后出现）→ 重载项目波形仍在（命中持久化，不重抽）
→ 对 clip trim/split 后波形随 clip 区间正确切换；Network 仅同源 `/api/storage/files` 与波形接口。

## 7. 风险与缓解 (Risks & Mitigations)

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| ffmpeg 抽 peaks 对长音频耗时 | 生成慢 | 后台任务 + 队列限流；前端占位非阻塞；只需一次（持久化） |
| peaks 精度 vs 体积权衡 | 太密体积大/太疏不准 | `peaksPerSecond` 取适中默认（如 100），紧凑数值序列化；可按 zoom 在前端做二次降采样显示 |
| 含音轨视频与独立音频共享 materialId 冲突 | 波形错配 | 以 materialId 为键；detach 音频复用同源 peaks（spec 01 同 materialId） |
| 历史项目内联 `waveformData` 与持久化 peaks 不一致 | 显示抖动 | 持久化 peaks 为权威；内联仅首屏兜底；就绪后替换 |
| 波形 JSON 膨胀（大量素材） | 占用增长 | 单素材单 JSON、紧凑编码；06 删素材联动清理 + 孤儿回收 |
| 与 spec 03 共用 storage_router/storage_models 改动冲突 | 合并冲突 | 03/04 对同文件的新增端点/模型互不重叠（thumbnail-frame vs waveform）；编排阶段标注同文件协调 |
