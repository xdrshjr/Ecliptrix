# TODO 06 — 持久化与缓存治理

> 对应 spec：[`specs/06-persistence-and-cache-gc.md`](../specs/06-persistence-and-cache-gc.md)

## Dependencies

- `depends_on: [01, 02, 03, 04]` — 保存 01 的 split/trim/audioDetached、02 的转场/opacity；清理/回收复用 03/04 的 `delete_by_material` 与目录约定。
- `blocks: []` — 收尾。
- `parallel_group: D` — 第四批（01、02、03、04 完成后；可与 05 并行）。
- 理由：持久化字段来自 01/02，派生文件清理依赖 03/04 的服务；故必须在四者之后。

## Tasks（按实现顺序）

### 项目持久化（保存与恢复）
- [ ] 写失败用例 `TimelineRepository.persistence.test.ts`：含 split/trim/转场/音画分离/多轨 → export→import 完全恢复；旧数据 INV 规整；selection/历史不持久；新旧混合兼容
- [ ] `TimelineRepository.ts`：export/import 覆盖 split 产物、`audioDetached`、`transitionIn/out`、`opacity`、轨序；**停止内联写入 `waveformData`**（仍容忍读旧值作兜底）
- [ ] 写失败用例 `projectHydration.test.ts`：水合后 02 resolver 命中本地 URL 可预览；缺失派生触发重生成
- [ ] 新建 `lib/projectHydration.ts`（或并入 Repository）：materialId→live 素材 + 派生资源解析 + INV-3 规整（live 权威，快照仅兜底）

### 删除素材联动清理
- [ ] 写失败用例 `tests/test_derived_gc.py`：删素材联动清缩略图+波形；孤儿回收只删无引用、保留有引用；空引用集不误删（安全阈值）
- [ ] `thumbnail_service.py`/`waveform_service.py`：确保 `delete_by_material` 与枚举接口（`list_material_dirs()`/`list_material_files()`，供孤儿回收扫描）暴露（03/04 已建则复用）
- [ ] `storage_router.py`：**新增** `DELETE /storage/material/{material_id}`（删源 + 联动删派生；今无此端点）
- [ ] `useMaterialManagement.ts`：删素材流程串联后端联动删 + 前端缓存清键
- [ ] `LocalMediaCache.ts` 增 `evict(materialId)`；`VideoCacheAdapter.ts` 增 `drop(materialId)`；filmstrip/waveform 缓存清键

### 启动孤儿回收
- [ ] 派生文件归属用**目录约定（方案 A）**枚举（`thumbnails/{materialId}/`、`waveforms/{materialId}.json`），**不引入 DB 迁移**
- [ ] 新建 `services/derived_gc_service.py`：给定 referenced 集合扫描删无引用缩略图/波形；**空/异常引用集跳过**；dry-run 日志
- [ ] `storage_router.py`：（可选）`POST /storage/reclaim-orphans`（前端提供引用集 = 素材库 ∪ 项目引用）
- [ ] `main.py`：启动钩子后台调度回收（限流、非阻塞、报告回收量）

### 验收
- [ ] `npm run type-check` + 前端 vitest（persistence/hydration）+ `pytest test_derived_gc.py` 全绿
- [ ] 桌面走查：剪辑(trim/split/转场/音画分离/多轨) → 保存 → 关闭重开完全恢复且可预览、缩略图/波形命中持久化 → 删素材其派生随之消失 → 重启无孤儿堆积
