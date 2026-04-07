# Spec 02: 连接测试增强与 API 格式支持

## 1. 概述

增强后端连接测试功能，支持用户手动选择 API 格式（OpenAI / Anthropic），扩展测试响应以包含模型信息摘要，并优化格式解析优先级逻辑。

## 2. 涉及文件

| 文件 | 变更类型 |
|------|----------|
| `app/models/model_settings_models.py` | 修改：扩展 TestConnectionRequest 和 TestConnectionResponse |
| `app/services/model_settings_service.py` | 修改：重构 test_connection、提取 _test_openai_connection、新增 _get_provider_db_format |

## 3. 变更范围

### 3.1 请求模型变更 (`app/models/model_settings_models.py`)

**`TestConnectionRequest` 扩展：**
```pseudo
class TestConnectionRequest:
    api_url: str
    api_key: str = ""
    model_name: str
    provider_id: Optional[str] = None
    provider_type: Optional[str] = None
    api_format: Optional[str] = None   # 新增: "openai" | "anthropic" | None (使用自动检测)
```

**`TestConnectionResponse` 扩展：**
```pseudo
class TestConnectionResponse:
    model_config = ConfigDict(protected_namespaces=())  # 新增: model_info 字段需要此配置（Pydantic v2 默认保护 model_ 前缀）
    success: bool
    message: str
    latency_ms: Optional[int] = None
    model_info: Optional[dict] = None  # 新增: {"model": "...", "format_used": "openai|anthropic"}
```

### 3.2 格式解析逻辑 (`app/services/model_settings_service.py`)

**扩展辅助函数 `_resolve_api_format`（替代 spec 01 中的 2 参数版本）：**

注意：spec 01 定义了 `_resolve_api_format(api_format, provider_type)` 的 2 参数签名。本 spec 将其扩展为 3 参数版本以支持三级优先级解析。实现时应直接使用本 spec 的 3 参数版本，spec 01 的版本无需单独实现。

```pseudo
def _resolve_api_format(
    request_format: Optional[str],     # 用户请求中指定的格式
    db_format: Optional[str],          # 提供商数据库中保存的格式
    provider_type: str                 # 提供商类型
) -> str:
    """解析 API 格式，优先级：请求参数 > 数据库 > 自动推断"""
    
    if request_format and request_format != "auto":
        return request_format
    
    if db_format and db_format != "auto":
        return db_format
    
    # 自动推断（保留 ANTHROPIC_FORMAT_TYPES 作为 fallback）
    if provider_type in ANTHROPIC_FORMAT_TYPES:
        return "anthropic"
    
    return "openai"
```

### 3.3 `test_connection` 方法重构

当前逻辑：
```pseudo
provider_type = await self._resolve_provider_type(request.provider_type, request.provider_id)
if provider_type in ANTHROPIC_FORMAT_TYPES:
    return await self._test_anthropic_connection(...)
else:
    # OpenAI format test (inline code, not extracted to method)
```

重构为：
```pseudo
provider_type = await self._resolve_provider_type(request.provider_type, request.provider_id)
db_format = await self._get_provider_db_format(request.provider_id)  # 从数据库获取保存的 api_format
api_format = _resolve_api_format(request.api_format, db_format, provider_type)

if api_format == "anthropic":
    result = await self._test_anthropic_connection(request.api_url, api_key, request.model_name, provider_type)
else:
    result = await self._test_openai_connection(request.api_url, api_key, request.model_name)

# 补充 model_info
if result.success:
    result.model_info = {"model": request.model_name, "format_used": api_format}

return result
```

### 3.4 新增辅助方法 `_get_provider_db_format`

注意：此方法为 `ModelSettingsService` 类的实例方法（与 `_test_anthropic_connection` 对称）。

```pseudo
async def _get_provider_db_format(self, provider_id: Optional[str]) -> Optional[str]:
    """从数据库获取提供商保存的 api_format"""
    if not provider_id:
        return None
    pid = _parse_uuid(provider_id)
    async with async_session_factory() as session:
        stmt = select(ModelProvider.api_format).where(ModelProvider.id == pid)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()
```

### 3.5 OpenAI 测试方法提取

将当前 `test_connection` 中的 OpenAI 格式测试逻辑提取为独立方法 `_test_openai_connection`，与 `_test_anthropic_connection` 对称：

```pseudo
async def _test_openai_connection(self, api_url, api_key, model_name) -> TestConnectionResponse:
    """测试 OpenAI Chat Completions 格式连接"""
    # 现有逻辑提取，无功能变更
    url = api_url.rstrip('/') + '/chat/completions'  (如果不以此结尾)
    headers = {"Authorization": f"Bearer {api_key}", ...}
    payload = {"model": model_name, "messages": [...], "max_tokens": 5}
    ...
```

### 3.6 Anthropic 测试方法更新

`_test_anthropic_connection` 本身无需修改（Kimi User-Agent 已处理）。`model_info` 字段由 `test_connection` 调用者统一填充（见 3.3），不在各子方法内部处理。

## 4. API 端点

**无新增端点。** 现有 `POST /api/model-settings/test-connection` 端点自动支持新的请求字段。

前端发送测试请求时，可选传入 `api_format` 参数：
```pseudo
POST /api/model-settings/test-connection
{
    "api_url": "https://open.bigmodel.cn/api/coding/paas/v4",
    "api_key": "sk-xxx",
    "model_name": "glm-5.1",
    "provider_type": "glm_coding",
    "api_format": "openai"          // 可选，手动覆盖
}
```

## 5. 接口契约

**输入变更：** `TestConnectionRequest` 新增可选 `api_format` 字段
**输出变更：** `TestConnectionResponse` 新增可选 `model_info` 字段
**行为变更：** 格式检测从硬编码 `ANTHROPIC_FORMAT_TYPES` 集合改为三级优先级解析
**向后兼容：** 不传 `api_format` 时行为与原有完全一致（通过 auto 推断）

## 6. 测试要点

- `_resolve_api_format` 优先级正确：请求参数 > 数据库 > 自动推断
- Kimi Coding Plan 测试连接成功（Anthropic 格式 + User-Agent 头）
- GLM Coding Plan 测试连接成功（OpenAI 格式，正确端点）
- 手动指定 `api_format="anthropic"` 可覆盖默认 OpenAI 格式
- 手动指定 `api_format="openai"` 可覆盖 Anthropic 自动推断
- 测试成功时 `model_info` 包含正确的模型名和格式信息
- 不传 `api_format` 时行为与现有一致
- `_get_provider_db_format` 在 `provider_id` 为 None 时返回 None（不查询 DB）
- `_get_provider_db_format` 在 `provider_id` 无效（非法 UUID）时应抛出或返回 None

## 7. 依赖与前置条件

- **前置依赖 spec 01**：本 spec 依赖 spec 01 完成以下内容：
  - `ModelProvider` ORM 模型新增 `api_format` 列（`_get_provider_db_format` 需要读取此列）
  - `ANTHROPIC_FORMAT_TYPES` 常量保留（本 spec 的 `_resolve_api_format` 在 auto 模式下使用）
  - `TestConnectionRequest` 已有 `model_config = ConfigDict(protected_namespaces=())` 配置
- **本 spec 的 `_resolve_api_format` 3 参数版本替代 spec 01 中定义的 2 参数版本**，实现时应直接采用本 spec 的版本
- 本 spec 完成后，specs 03-05（前端）可使用增强后的连接测试 API
