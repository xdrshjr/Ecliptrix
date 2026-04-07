# Global Execution Context: coding-plan-model-settings

Accumulated context from all execution phases. Each agent MUST read this
file before starting work to understand the full project history.

---

## Phase 1 — completed 2026-04-07

### TODO 01: Backend Model Changes & DB Migration
- `ProviderInfo` 扩展了 `api_format` 和 `default_models` 字段
- `ModelProviderCreate/Update/Response` 新增 `api_format` 字段
- DB 迁移 005 添加 `api_format` 列
- PROVIDERS 列表修正：GLM 端点改为 `/api/coding/paas/v4`，模型改为 glm-5.1/glm-5-turbo，Kimi region 改为 domestic
- `CODING_PROVIDER_MODELS` 已移除，由 `_get_default_models_for_type()` 替代
- `_resolve_api_format()` 可用于 TODO 02 的连接测试

## Phase 2 — completed 2026-04-07

### TODO 02: Connection Test Enhancement & API Format Support
- `TestConnectionRequest` 新增 `api_format` 可选字段，允许用户手动指定 API 格式
- `TestConnectionResponse` 新增 `model_info` 可选字段，成功时返回 `{model, format_used}`
- 从 `test_connection` 提取 `_test_openai_connection` 独立方法，与 `_test_anthropic_connection` 对称
- `test_connection` 重构为三级格式解析：request.api_format > DB api_format > auto-infer
- 成功连接时自动填充 `model_info`
- Kimi `User-Agent: claude-code/1.0` 特殊处理已验证完好
- 所有变更向后兼容，不传 `api_format` 时行为与原有一致
- 后端全部变更（TODO 01+02）已完成，前端工作可安全开始

## Phase 3 — completed 2026-04-07

### TODO 03: Frontend Tab Layout + Provider Management
- ModelSettingsPanel 重构为三 Tab 布局（providers/assignments/advanced）
- 提供商管理卡片化，支持 api_format 选择和智能自动填充
- FunctionType 扩展到 5 个（含 coding），状态初始化完整
- 18+ i18n key 已添加

### TODO 04: Model Assignment Tab + Advanced Settings
- 5 个功能类型分配卡片完整实现（含 coding，默认 temp 1.0）
- 高级设置 Tab 包含环境变量说明表和生效配置概览
- 模型选择智能逻辑：cached > default_models > API fetch
- 跨 Agent 集成验证通过（Tab 1 未被破坏）
