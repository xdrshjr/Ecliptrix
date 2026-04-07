# TODO 01: 后端模型变更与数据库迁移

**对应 Spec:** `specs/01-backend-model-changes.md`

## Dependencies

- **depends_on:** [] (无前置依赖，可首先执行)
- **blocks:** [02, 03, 04, 05] (所有其他任务依赖此后端基础变更)
- **parallel_group:** A

所有前后端任务均依赖此任务完成的数据模型扩展和 DB 迁移。

## Tasks

### Pydantic 模型扩展
- [ ] 在 `app/models/model_settings_models.py` 的 `ProviderInfo` 中新增 `api_format: str = "auto"` 和 `default_models: List[str] = []` 字段
- [ ] 在 `ModelProviderCreate` 中新增 `api_format: str = "auto"` 字段，添加 Literal 校验
- [ ] 在 `ModelProviderUpdate` 中新增 `api_format: Optional[str] = None` 字段
- [ ] 在 `ModelProviderResponse` 中新增 `api_format: str` 字段

### ORM 模型与迁移
- [ ] 在 `app/models/db_models.py` 的 `ModelProvider` 中新增 `api_format = Column(String(20), default="auto", server_default="auto")`
- [ ] 创建 Alembic 迁移 `alembic/versions/005_add_api_format_to_providers.py`，执行 `ALTER TABLE model_providers ADD COLUMN api_format VARCHAR(20) DEFAULT 'auto'`
- [ ] 验证迁移升级和降级均可正常执行

### 提供商配置更新
- [ ] 更新 `PROVIDERS` 列表中 `kimi_coding`：name → "Kimi Coding Plan", region → "domestic", api_format="anthropic", default_models=["kimi-k2.5"]
- [ ] 更新 `PROVIDERS` 列表中 `glm_coding`：name → "GLM Coding Plan", default_api_url → "https://open.bigmodel.cn/api/coding/paas/v4", api_format="openai", default_models=["glm-5.1", "glm-5-turbo"]
- [ ] 更新 `PROVIDERS` 列表中 `codex`：api_format="openai", default_models=["codex-mini-latest"]
- [ ] 更新 `PROVIDERS` 列表中 `claude_coding`：api_format="anthropic", default_models=["claude-sonnet-4-20250514", "claude-opus-4-20250514"]
- [ ] 为所有通用提供商补充 api_format="openai" 和 default_models=[]

### 常量与辅助函数重构
- [ ] 移除 `CODING_PROVIDER_MODELS` 字典
- [ ] 新增辅助函数 `_get_default_models_for_type(provider_type: str) -> List[str]`，从 PROVIDERS 列表中查找 default_models
- [ ] 保留 `ANTHROPIC_FORMAT_TYPES` 作为 `api_format="auto"` 时的 fallback
- [ ] 新增辅助函数 `_resolve_api_format(request_format, db_format, provider_type) -> str`

### Service 层更新
- [ ] `create_provider`：接受并保存 `api_format` 到数据库
- [ ] `update_provider`：支持更新 `api_format`
- [ ] `_provider_to_response`：在响应中包含 `api_format`
- [ ] `fetch_models_for_provider`：将 `CODING_PROVIDER_MODELS` 查找替换为 `_get_default_models_for_type`
- [ ] `fetch_models`：同上替换
