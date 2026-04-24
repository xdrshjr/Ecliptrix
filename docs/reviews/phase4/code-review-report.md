# Phase 4 Code Review Report — AI 分镜流水线 2×2 链式重构

> **Reviewer**: Senior Code Reviewer
> **Scope**: Phase 3 交付物 — 仅 2×2 链式分镜生成流水线（退役 3×3/4×4），见 `artifacts/phase3_development_summary.md`
> **Date**: 2026-04-25

---

## 执行摘要

Phase 3 按 Phase 2 最终计划（T0–T11）完整落地，核心设计与实现质量高：

- `StoryboardGenerateRequest` 的 `grid_size` 被收敛到 `{"2x2", None}`，`frame_count` 在 `[1, 16]` 范围内校验；`compute_optimal_grid` 已完整移除，旧分支没有被遗留的 3×3/4×4 字面量污染。
- `storyboard_service._generate_storyboard_core` 以 `ceil(N/4)` 串行驱动 `_generate_single_2x2_batch`，批间用 `composite_references` 将前一批 `row=1` 的两帧拼成 1×2 参考图；推广 + 清理 `_batch_{k:02d}/` 子目录的逻辑幂等清晰。
- 失败模型分层清楚：批内 retry（`STORYBOARD_BATCH_MAX_RETRIES=2`，指数退避），401/403 直接向上抛；`batches_info` 空 ⇒ 整体失败清理目录；非空 ⇒ `PartialGenerationError` 挂载 partial pack，Router 将其翻译成 `HTTP 200 + success=True + data.partial=true` 包（与 R-F15 一致）。
- 前端 `SceneCountInput` / `StoryboardPreviewPanel` 完整替换了 `GridSizeSelector`，`gridUtils.ts` 及其测试已删除；BFF / API 客户端 / Agent 工具三层 timeout 统一为 900_000 ms；类型系统新增 `BatchInfo` / partial 字段，蛇形转驼峰映射完整。
- 模块级 `asyncio.Semaphore` 提供全局并发限流，test `test_concurrent_generations_capped` 覆盖 peak ≤ max_concurrent 不变量。

**测试**: 后端 `test_storyboard_grid.py`（7） + `test_storyboard_chained.py`（14） + `test_storyboard_multi_reference.py`（9）共 **30 通过**；前端 `AiImageModal` 3 个测试文件 **29 通过**；`npx tsc --noEmit` 无输出（0 错误）。

**发现问题**: 0 项 critical / 0 项 major / **1 项 minor 已修复** + 3 项文档级 observation（不修）。

**结论**: 代码质量达标，可进入 Phase 5（commit & deliver）。

---

## 评审范围清单

### 新增文件

| 文件 | 作用 |
|------|------|
| `src/components/video/components/AiImageModal/SceneCountInput.tsx` | 替代 `GridSizeSelector`；1–16 幕数字输入 + 批次提示 |
| `backend-services/basic-service/tests/test_storyboard_chained.py` | 链式 2×2 驱动端到端覆盖（分批 / 链参 / 占位 / 限流 / partial） |

### 修改文件

| 文件 | 关键改动 |
|------|--------|
| `backend-services/basic-service/app/models/storyboard_models.py` | `grid_size` 限 `"2x2"`、`frame_count 1..16`；新增 `BatchInfo` / `PartialGenerationError`；`StoryboardPack` 扩展 `partial / batches / completed_batches / total_batches / discarded_frame_count / error`；常量 `STORYBOARD_MAX_SCENE_COUNT=16`、`STORYBOARD_BATCH_SIZE=4` 单源 |
| `backend-services/basic-service/app/services/storyboard_service.py` | 新增 `_generate_storyboard_core` / `_generate_single_2x2_batch` / `_promote_batch_frames` / `_extract_chain_refs` / `_strip_position_blocks` / `_finalize_pack` / `_persist_user_reference`；模块级全局 semaphore；`list_packs` / `get_pack` 增 `_batches_from_meta` helper |
| `backend-services/basic-service/app/routers/storyboard_router.py` | 捕获 `PartialGenerationError` → HTTP 200 partial 信封 |
| `backend-services/basic-service/app/config.py` | 新增 `StoryboardGenerationConfig.max_concurrent`（env `STORYBOARD_MAX_CONCURRENT_GENERATE`） |
| `backend-services/basic-service/tests/test_storyboard_grid.py` | 重写为新合约（7 用例） |
| `backend-services/basic-service/tests/test_storyboard_multi_reference.py` | 移除旧 auto-grid 断言（9 用例） |
| `src/types/index.ts` | `StoryboardGridSize = '2x2'`；`BatchInfo`；`StoryboardPack.partial/batches/...`；常量导出 `STORYBOARD_MIN/MAX_SCENE_COUNT`、`STORYBOARD_BATCH_SIZE` |
| `src/lib/api/storyboard.ts` | `RawBatchInfo` / `toBatch`；`http.post timeoutMs: 900_000` |
| `src/app/api/storyboard/generate/route.ts` | `timeoutMs: 900_000`（对齐 Nginx 3600s） |
| `src/components/video/components/AiImageModal/StoryboardPreviewPanel.tsx` | 重写为 ceil(N/4) 批 × 2×2 预览，末批占位虚线单元格 |
| `src/components/video/components/AiImageModal/StoryboardTab.tsx` | 替换 `GridSizeSelector` → `SceneCountInput` |
| `src/components/video/components/AiImageModal/AiImageModal.tsx` | 默认 `frameCount 9 → 4`；Issue #1 后 `resetForm` 一致化 |
| `src/lib/i18n.ts` | 新增 `sceneCountInput.*`；`storyboardPreviewPanel.*` 重塑（`batchCount` / `batchCountValue` / `batchLabel`） |
| `src/lib/video-editing-agent/tools/generateStoryboard.ts` | `scene_count` max=16；`toolFetch timeout: 900_000`；描述更新为链式 2×2 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `src/components/video/components/AiImageModal/GridSizeSelector.tsx` | 被 `SceneCountInput` 替代 |
| `src/components/video/components/AiImageModal/gridUtils.ts` | `compute_optimal_grid` 前端镜像不再需要 |
| `src/components/video/components/AiImageModal/__tests__/gridUtils.test.ts` | 对应测试 |

---

## 评审发现（按维度）

### 1. 正确性 Correctness

- **幕数 ⇄ 批次映射** — 后端 `total_batches = (N + BATCH_SIZE - 1) // BATCH_SIZE`、前端 `Math.ceil(N / STORYBOARD_BATCH_SIZE)`，等价；`STORYBOARD_BATCH_SIZE=4` 两端同源（前端从 `@/types`、后端从 `storyboard_models.py`）。
- **链参语义** — `_extract_chain_refs(pack_dir, global_frames, b)` 筛选 `batch_index == b-1` 的帧后按 `(row, col)` 排序取末二（即 row=1 的两帧），与 `_chain_prompt_prefix` 文案"左半=上一批第3幕、右半=第4幕"一致。`composite_references(tail_paths)` 拼接 1×2 data URI 注入到 `reference_image`。
- **批内 retry 语义** — `_generate_single_2x2_batch` 在 `STORYBOARD_BATCH_MAX_RETRIES + 1` 次尝试内捕获 `httpx.HTTPStatusError`（401/403 透传）与通用异常；全部失败后抛最后一次异常供 driver 决策。
- **Partial 触发条件** — driver 仅当 `batches_info` 非空才走 `PartialGenerationError` 分支；`batches_info` 空 ⇒ `shutil.rmtree(pack_directory)` 清理后透传原异常（router 翻译为 500 或 400）。router 再次防御：`partial_err.pack is None` 仍然返回 500。
- **末批占位裁剪** — `_pad_scripts_to_batch` 仅补足到 4，后续 `_finalize_pack` 通过 `global_frames[:total_scene_count]` 裁剪并删除多余 PNG；`discarded_frame_count` 仅在非 partial 分支累加，与测试 `test_two_batches_truncates_when_n_7` 断言的 `discarded_frame_count == 1` 一致。
- **Batch-2+ 提示清洗** — `_strip_position_blocks` 三条正则/字面量：`[* reference image]` 标签、`Reference image is a ... .` 描述、`Please synthesize elements from all reference areas.` 句；`test_batch2_prompt_strips_reference_position_block` + `test_strip_position_blocks_removes_placeholders` 双重验证。
- **路径安全** — `_validate_pack_id` 限 `^[a-zA-Z0-9_-]+$`，`_download_to_local` 的 `/api/storage/files/` 分支用 `os.path.realpath + commonpath` 拒绝目录穿越；此处未改动但顺便复核，Phase 3 未引入回归。
- **Router 合约** — `generate_storyboard` → `StoryboardGenerateResponse`；partial 路径返回 `success=True, data.partial=True, data.error.code="PARTIAL_GENERATION_FAILED"`，前端 `toPack` 正确映射 `partial/error/batches`。
- **Agent 工具** — `generateStoryboard.ts` 的 `toolFetch` timeout 和 BFF route 的 `timeoutMs` 和 `http.post` 三层一致（900_000 ms），避免链路上任一环提前超时吞掉 partial。

### 2. 代码质量 Code Quality

- **风格对齐** — 后端沿用项目既有异步模式（async/await、`aiofiles`、`httpx.AsyncClient`），类型标注齐全；前端继承现有 `snake_case ⇄ camelCase` 边界模式（`toFrame` / `toBatch` / `toPack`）。
- **注释** — 仅在非显然处保留（Why）：`_chain_prompt_prefix` 的链参语义、`_strip_position_blocks` 的适用场景、router `partial_err` 的 HTTP 200 选择理由。没有装饰性注释、没有删除代码的墓碑。
- **常量单源** — `STORYBOARD_MAX_SCENE_COUNT` 后端定义在 `storyboard_models.py`（同时被 validator 和 service 引用），前端在 `types/index.ts` 导出供 `SceneCountInput` / `StoryboardPreviewPanel` 使用；两端值一致（16）。
- **纯函数化** — `_strip_position_blocks` / `_pad_scripts_to_batch` / `_build_batch_prompt` / `_chain_prompt_prefix` 均为纯函数，便于单测直接调用（测试已覆盖）。

### 3. 错误处理 Error Handling

- **退避策略** — `STORYBOARD_BATCH_RETRY_BASE_DELAY * 2^attempt`，`STORYBOARD_BATCH_MAX_RETRIES` / `STORYBOARD_BATCH_RETRY_BASE_DELAY` 都挂在环境变量下，便于运维调优；默认 2 次重试 / 2s 基数，匹配 Phase 2 计划。
- **路由层** — `generate_storyboard` 顺序捕获 `PartialGenerationError` → `ValueError`(400) → `Exception`(500)，日志中对 partial 保留 `exc_info=cause` 链。
- **前端 timeout** — `generateStoryboard.ts` 工具在 `DOMException.name === 'TimeoutError'` 时返回可读超时消息（"900s chained 2×2 batches"）。
- **OSS 失败软降级** — `_finalize_pack` 上传失败 `warning` 不抛；对本地已落盘 pack 无影响。

### 4. 安全 Security

- **路径穿越** — 已有保护（`_validate_pack_id`、`_download_to_local` realpath commonpath 检查），新代码路径没有引入用户控制的文件名。
- **OSS 过滤** — `_finalize_pack` 的 OSS 上传显式 `os.path.isdir` 跳过目录、`endswith(".png", ".json")` 白名单，因此 `_batch_*/` 与 `_intermediate/` 都不会上传到 CDN。
- **`ARK_API_KEY`** — `_call_ark_seedream` 正常注入到 Authorization header；driver 入口显式校验 key 存在。
- **无 secret 泄漏** — `logger.info` 只记录 prompt 长度 / task_id / batch 编号；完整 prompt 与 base64 reference 不会落日志。

### 5. 性能 Performance

- **串行批次** — 单次生成内部严格串行（必然：链式参考图依赖前一批完成）。单 pack N=16（4 批）时 ARK 调用 4 次 × ~80s 典型 ≈ 5–6 min 端到端，匹配 BFF 900 s 配额。
- **全局并发** — 模块级 semaphore 默认 3，避免单 pod 超过 ARK 并发配额；`_get_generate_semaphore` 惰性重建逻辑允许配置热更新（测试场景也依赖此）。
- **图像 I/O** — `crop_storyboard` 单次打开源 PNG 做所有 4 crop；`composite_references` 在内存内完成 1×2 拼接；`_promote_batch_frames` 只做 `shutil.move`（同驱动器 rename，无复制）。

### 6. 测试质量 Test Quality

| 文件 | 用例数 | 覆盖点 |
|------|------|------|
| `test_storyboard_grid.py` | 7 | 默认填充、显式 `"2x2"`、非法 grid rejected（参数化 8 case）、`frame_count` 越界、边界 1/16 |
| `test_storyboard_chained.py` | 14 | N≤4 单批、N=7 两批+截断（7 文件、`_batch_*/` 清理、`_intermediate/` 保留、`discarded=1`）、batch 1 无参考图、batch 2 携带 data URI 不同、末批占位提示注入、batch 2 剥离 reference 块、partial 失败 pack 含 4 帧 / `code=PARTIAL_GENERATION_FAILED`、并发 cap（peak ≤ 2）、`_strip_position_blocks` 单元 |
| `test_storyboard_multi_reference.py` | 9 | 多引用字段存在性、向后兼容、单 / 多引用优先级、mention 替换、grid 强制 `"2x2"`、默认单批、`composite_references` 与 `replace_mention_tags` 合成 |
| `src/components/video/components/AiImageModal/__tests__/` | 29 | mentionUtils、layoutFixes、storyboardTab 流程 |

关键断言粒度合理：既查 `pack.frame_count` 又查磁盘 `frame_files`，既断并发 peak 又用真正的 async lock 避免假阳。

### 7. 可维护性 Maintainability

- **分层清晰** — router → public `generate_storyboard` → `_generate_storyboard_core` → `_generate_single_2x2_batch` → ARK / 下载 / crop，四层职责单一，便于后续替换底层 API。
- **配置可观测** — `STORYBOARD_MAX_CONCURRENT_GENERATE` / `STORYBOARD_BATCH_MAX_RETRIES` / `STORYBOARD_BATCH_RETRY_BASE_DELAY` 都是环境变量，日志明确打印限流等待时长（"waited %.1fs for generation slot"）。
- **i18n** — 孤立的 `gridSizeSelectorTab` key 保留未动，显式在 Phase 3 Summary §2 第 T9 行说明了 "orphan, not used anywhere — 避免 scope 外的额外 churn"。

---

## 问题清单 Issue List

| # | 严重度 | 文件:行 | 问题 | 状态 |
|---|-------|--------|------|------|
| 1 | minor | `src/components/video/components/AiImageModal/AiImageModal.tsx:73` | `resetForm` 将 `frameCount` 重置为旧默认值 `9`，与初始 state（`frameCount: 4`）及后端默认（`STORYBOARD_BATCH_SIZE=4`）不一致 — 用户关闭弹窗后再次打开会看到 9 幕，并触发 2 批生成而非 1 批，违反"默认单批"直觉 | **已修复**（详见 Issue Fix Record #1） |
| obs-1 | doc | `backend-services/basic-service/app/config.py:582-584` | `_int_env("...") or _int_env("...") or yaml_default` 的"或"链在 env 变量被显式置 0 时会穿透到 YAML；但 Pydantic Field `ge=1`，0 本身是非法值 → 行为等价于 fallback，属可接受。 | 不改，已记录 |
| obs-2 | doc | `storyboard_service.py::_chain_prompt_prefix` | 英文文案 `left half = previous scene 3, right half = previous scene 4` 中的"scene 3/4"指"上一批 2×2 内的第 3、4 幕"（1-indexed），在大批次（第 3 批起）下对 LLM 可能略显歧义。当前文案足够产出视觉连续性（测试中 Seedream 依 reference 推断），未观测实际问题。 | 不改，记录为 P1 文案优化候选 |
| obs-3 | doc | `_get_generate_semaphore` | 当 `settings.storyboard.generation.max_concurrent` 在运行时变化，会重建模块级 semaphore；已在执行中的任务持有旧 semaphore 并不会被新 semaphore 计入，瞬时窗口内可能出现 `in_flight > new_limit`。生产场景 config 变更都在重启窗口内完成 → 可接受。 | 不改，记录 |

没有任何 critical / major 级别问题。

---

## 最终验证 Final Validation

```
$ cd backend-services/basic-service && python -m pytest tests/test_storyboard_grid.py tests/test_storyboard_chained.py tests/test_storyboard_multi_reference.py -v
====================== 30 passed, 23 warnings in 30.63s =======================

$ npx vitest run src/components/video/components/AiImageModal
 Test Files  3 passed (3)
      Tests  29 passed (29)

$ npx tsc --noEmit
# 无输出（0 错误）
```

全量测试通过。无回归。Issue #1 修复后再次全跑仍绿色。

