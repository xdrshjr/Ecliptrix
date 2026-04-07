# Spec 01: 后端模型变更与数据库迁移

## 1. 概述

扩展后端数据模型以支持 `api_format` 字段和 `default_models` 字段，修正 Coding Plan 提供商配置（GLM 端点、模型列表、Kimi region），并创建 Alembic 数据库迁移。

## 2. 涉及文件

| 文件 | 变更类型 |
|------|----------|
| `app/models/model_settings_models.py` | 修改：扩展 Pydantic 模型 |
| `app/models/db_models.py` | 修改：ORM 模型新增列 |
| `app/services/model_settings_service.py` | 修改：PROVIDERS 列表、常量重构、Service 方法 |
| `alembic/versions/005_add_api_format_to_providers.py` | 新增：数据库迁移 |

## 3. 变更范围

### 3.1 Pydantic 模型 (`app/models/model_settings_models.py`)

**`ProviderInfo` 扩展（静态参考数据，不入库）：**
```pseudo
class ProviderInfo:
    id: str
    name: str
    default_api_url: str
    region: str
    api_format: str = "auto"          # 新增: "auto" | "openai" | "anthropic"
    default_models: List[str] = []    # 新增: 预置模型列表
```

**`ModelProviderCreate` 扩展：**
```pseudo
class ModelProviderCreate:
    name: str
    provider_type: str
    api_url: str
    api_key: str
    api_format: str = "auto"          # 新增，需校验值为 "auto" | "openai" | "anthropic"
```

**`ModelProviderUpdate` 扩展：**
```pseudo
class ModelProviderUpdate:
    ...existing fields (name, provider_type, api_url, api_key)...
    api_format: Optional[str] = None  # 新增，非 None 时需校验值
```

**`ModelProviderResponse` 扩展：**
```pseudo
class ModelProviderResponse:
    ...existing fields (id, name, provider_type, api_url, api_key_masked, api_key_set, created_at, updated_at)...
    api_format: str                   # 新增，从 DB ModelProvider.api_format 读取
```

**字段校验：** `api_format` 的合法值为 `"auto"` / `"openai"` / `"anthropic"`，建议使用 Pydantic `Literal` 类型或自定义 validator 限制。

### 3.2 ORM 模型 (`app/models/db_models.py`)

**`ModelProvider` 表扩展：**
```pseudo
class ModelProvider(Base):
    ...existing columns...
    api_format = Column(String(20), default="auto", server_default="auto")
```

### 3.3 Alembic 迁移

现有迁移文件已到 `004_seed_default_settings.py`。在 `alembic/versions/` 创建新迁移文件 `005_add_api_format_to_providers.py`：

```pseudo
升级:
  - ALTER TABLE model_providers ADD COLUMN api_format VARCHAR(20) DEFAULT 'auto' NOT NULL

降级:
  - ALTER TABLE model_providers DROP COLUMN api_format
```

注意：`server_default="auto"` 确保现有记录自动获得默认值，不影响已有数据。

### 3.4 提供商配置更新 (`app/services/model_settings_service.py`)

**`PROVIDERS` 列表当前状态与目标变更：**

| Provider ID | 当前值 | 目标变更 |
|------------|--------|----------|
| `kimi_coding` | name="Kimi Coding", region="international", URL=".../coding" | name → "Kimi Coding Plan", region → **"domestic"**, +api_format="anthropic", +default_models=["kimi-k2.5"] |
| `glm_coding` | name="GLM (Zhipu)", URL=".../api/paas/v4" | name → "GLM Coding Plan", default_api_url → **"https://open.bigmodel.cn/api/coding/paas/v4"**, +api_format="openai", +default_models=**["glm-5.1", "glm-5-turbo"]** |
| `codex` | 无 api_format/default_models | +api_format="openai", +default_models=["codex-mini-latest"] |
| `claude_coding` | 无 api_format/default_models | +api_format="anthropic", +default_models=["claude-sonnet-4-20250514", "claude-opus-4-20250514"] |
| 通用提供商 (deepseek, alibaba, zhipu, openai, anthropic, google) | 无 api_format/default_models | +api_format="openai"（默认），default_models 留空 |

注意：`CODING_PROVIDER_MODELS` 当前 glm_coding 的模型为 `["glm-4-plus", "glm-4"]`，需更新为 `["glm-5.1", "glm-5-turbo"]`（基于 `docs/coding-plan` 测试结果）。

**移除 `CODING_PROVIDER_MODELS` 字典：**
- 将其内容合并到各 `ProviderInfo.default_models`
- `fetch_models` / `fetch_models_for_provider` 方法中 `if provider_type in CODING_PROVIDER_MODELS` 改为通过 provider_type 查找 `ProviderInfo.default_models`

**重构 `ANTHROPIC_FORMAT_TYPES` 常量：**
- 保留作为 fallback（当 `api_format = "auto"` 时使用）
- 新增辅助函数：

```pseudo
def _resolve_api_format(api_format: str, provider_type: str) -> str:
    """解析最终使用的 API 格式。
    
    Args:
        api_format: 用户配置值 ("auto" | "openai" | "anthropic")
        provider_type: 提供商类型 ID
    Returns:
        "openai" 或 "anthropic"
    """
    if api_format in ("openai", "anthropic"):
        return api_format
    # api_format == "auto": 根据 provider_type 推断
    return "anthropic" if provider_type in ANTHROPIC_FORMAT_TYPES else "openai"
```

### 3.5 Service 层变更

**`create_provider` 方法：** 从 `ModelProviderCreate.api_format` 读取并写入 `ModelProvider.api_format` 列
**`update_provider` 方法：** 支持更新 `api_format`（仅当请求字段非 None 时更新）
**`_provider_to_response` 方法：** 从 DB `ModelProvider.api_format` 列读取并映射到 `ModelProviderResponse.api_format`
**`get_providers` 方法：** 返回的静态 `ProviderInfo` 列表包含新增的 `api_format` 和 `default_models` 字段

**`fetch_models` / `fetch_models_for_provider` 方法：**
- 替换 `if provider.provider_type in CODING_PROVIDER_MODELS` 为通过 provider_type 查找 `ProviderInfo.default_models`
- 辅助函数 `_get_default_models(provider_type: str) -> List[str]`：遍历 PROVIDERS 列表匹配 id，返回 default_models

**`test_connection` 方法（本 spec 仅做格式解析适配，详细增强见 spec 02）：**
- 将 `if provider_type in ANTHROPIC_FORMAT_TYPES` 替换为调用 `_resolve_api_format()`

## 4. 接口契约

**输入：** `ModelProviderCreate` 和 `ModelProviderUpdate` 增加 `api_format` 字段
**输出：** `ModelProviderResponse` 增加 `api_format` 字段；`ProvidersResponse` 中的 `ProviderInfo` 包含 `api_format` 和 `default_models`
**API 端点：** 无新增端点，现有 CRUD 端点自动支持新字段
**向后兼容：** 前端不传 `api_format` 时默认为 `"auto"`，现有数据通过 DB 迁移的 server_default 获得默认值

## 5. 测试要点

- DB 迁移能正常执行（`alembic upgrade head`）和回滚（`alembic downgrade -1`）
- 创建提供商时不传 `api_format` 默认为 `"auto"`
- 创建提供商时传入非法 `api_format` 值应返回校验错误
- 更新提供商时可以修改 `api_format`
- `get_providers()` 返回的 ProviderInfo 包含 `api_format` 和 `default_models`
- GLM Coding Plan 的 `default_api_url` 为 `https://open.bigmodel.cn/api/coding/paas/v4`
- GLM Coding Plan 的 `default_models` 为 `["glm-5.1", "glm-5-turbo"]`
- Kimi Coding 的 `region` 为 `"domestic"`
- `_resolve_api_format("auto", "kimi_coding")` 返回 `"anthropic"`
- `_resolve_api_format("openai", "kimi_coding")` 返回 `"openai"`（用户覆盖）
- `fetch_models` 对 coding 提供商返回 `default_models` 而非调用 `/models` API
- `fetch_models` 对通用提供商（如 deepseek）仍调用 `/models` API

## 6. 依赖与前置条件

- 本 spec 为整个计划的第一步，无前置依赖
- 本 spec 完成后方可执行 spec 02（连接测试增强依赖 `_resolve_api_format` 函数）
- 本 spec 完成后方可执行 specs 03-05（前端依赖新增的 `api_format` 和 `default_models` 字段）
