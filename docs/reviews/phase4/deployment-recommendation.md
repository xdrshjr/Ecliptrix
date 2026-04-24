# Phase 4 Delivery Recommendation — AI 分镜流水线 2×2 链式重构

> **Phase**: 4 (Code Review & Issue Resolution)
> **Date**: 2026-04-25
> **Reviewer**: Senior Code Reviewer

---

## 综合质量评级

**★★★★★ (Production-ready)**

- Phase 3 按 Phase 2 最终计划 T0–T11 完整交付，接口契约、并发策略、partial-failure 协议均与评审稿一致。
- 后端 30 / 前端 29 全绿，`tsc --noEmit` 零错误，本次 Phase 4 唯一修复（Issue #1）为一行默认值常量，不引入行为风险。
- 核心算法（链式参考图、末批占位裁剪、全局并发限流）既有纯函数单测覆盖也有驱动层端到端覆盖。

## 上线就绪度

- [x] 后端 Pydantic 合约收敛到 `"2x2"`（含参数化 8 种非法 grid 拒绝测试）
- [x] Driver 分层 + retry + partial envelope 路由集成
- [x] 前端 `SceneCountInput` / `StoryboardPreviewPanel` 全量替换 `GridSizeSelector` / `gridUtils`
- [x] 三层 timeout（BFF / API client / Agent tool）对齐 900_000 ms
- [x] 全局并发 `STORYBOARD_MAX_CONCURRENT_GENERATE` 生效，测试 peak ≤ limit 断言通过
- [x] i18n zh/en 齐全，未使用的 `gridSizeSelectorTab` key 保留以避免 scope 外 churn
- [x] Type-check、backend / frontend 测试全部通过
- [x] Phase 4 Issue #1 已修复并重新跑通全量测试

**结论：可进入 Phase 5（commit & deliver）后部署到生产环境。**

## 剩余已知问题与影响评估

| Observation | 严重度 | 影响评估 |
|-------------|-------|---------|
| obs-1: `_int_env` 或链不区分 `0` | 极低 | Pydantic `ge=1` 强制下限兜底，实际等价于 fallback；仅影响运维配错时的故障表达 |
| obs-2: 链参 prompt "previous scene 3/4" 歧义 | 低 | 端到端测试 Seedream 仍按 reference 延续风格；若 16 幕大批次观测到风格漂移再微调文案 |
| obs-3: `_get_generate_semaphore` 热更新窗口 | 极低 | 生产 config 变更伴随重启；瞬时 over-limit 不会触达 ARK 配额 |

三项 observation 均不阻塞发布，归档为 P2 backlog。

## 建议的上线 / 回归监控清单

### 部署前

1. **环境变量核对** — 生产 `.env`（Singapore-01: `47.245.126.128`）确认：
   - `ARK_API_KEY` 有效（驱动首次调用前显式校验）
   - `STORYBOARD_MAX_CONCURRENT_GENERATE` 与 ARK 账户的并发配额一致（默认 3；如 ARK 并发 ≥ 5 可调整）
   - `STORYBOARD_BATCH_MAX_RETRIES=2`、`STORYBOARD_BATCH_RETRY_BASE_DELAY=2.0` 保持默认；如 Seedream 抖动升级可上调
2. **BFF timeout 验证** — 确认 Nginx upstream timeout 仍为 3600 s（memory: post-refactor 已配置），Next.js BFF 是 900 s
3. **磁盘空间** — `storage.root` 下 `storyboard/<date>/<pack_id>/_intermediate/` 保留原始 2048² 网格作诊断用；16 幕 pack ≈ 4 × ~3 MB = 12 MB，按日巡检可用空间

### 上线后首日监控

1. **ARK 调用成功率** — 按 `seedream_task_id` 聚合 per-batch 成功 / 重试 / 最终失败占比；partial 率应 < 5%
2. **延迟分布** — `BatchInfo.duration_ms` → 单批 p50 / p95；端到端 p95（对 N=16）预期 ≤ 300 s
3. **并发等待** — grep 日志 "waited %.1fs for generation slot" 出现频率；若频繁且 waited > 30 s，考虑上调 `STORYBOARD_MAX_CONCURRENT_GENERATE`
4. **Partial 响应** — BFF 层应能区分 `data.partial === true` 并向用户展示"N 批完成、剩余失败"提示；前端 `toPack` 已映射 `partial/completedBatches/error`

### 回归覆盖

1. **Agent tool 回归** — `generate_storyboard` MCP tool 使用 `scene_count >= 1` / `<= 16`；手工触发 Agent flow 验证 16 幕不再被 120 s timeout 打断
2. **分镜面板 UX** — 打开 AiImageModal → 分镜 tab：初值 4 幕、1 批 2×2；关闭再开仍是 4（Issue #1 修复验证）
3. **生产环境真实生成** — R10 原计划的 1 次 N=7 手工试跑：验证 2 批串行、第二批 reference 正确、最终 pack 含 7 帧、`original_image_url` 指向 batch 1 的网格
4. **OSS 上传白名单** — 若 OSS_ENABLED=true，抽查新生成的 `_batch_*/` 与 `_intermediate/` 未进入 CDN；仅 `frame_*.png / original.png / reference.png / metadata.json` 上传

## 后续迭代建议（P1 Backlog）

1. **Partial 续传端点** — 支持从失败批 k 继续（无需重跑已完成批次）；Phase 2 Q2 遗留。
2. **生成进度 SSE / polling** — 当前 UI 为单一 spinner，`StoryboardPreviewPanel` 已具备批次脚手架；增加批次进度事件后即可点亮"第 k / M 批"。
3. **链参文案 A/B** — 针对 16 幕大批次收集风格一致性反馈，必要时改为 array-mode 多图协议（Phase 2 R-F2）。
4. **诊断清理策略** — `_intermediate/` 长期累积，可加入基于 `job_retention_seconds` 的 TTL 清理 cron。

---

**签字**：Phase 4 代码评审通过，推荐进入 Phase 5（commit & deliver）。
