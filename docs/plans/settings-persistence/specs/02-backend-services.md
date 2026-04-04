# 02 - 后端服务层设计

## 概述

重构 `ModelSettingsService` 从 SQLite 迁移到 PostgreSQL async SQLAlchemy，新增 `SystemSettingsService` 管理功能配置，实现热重载缓存机制。

## ModelSettingsService 重构

### 文件: `app/services/model_settings_service.py`

**核心变更：**
- 移除所有 `aiosqlite` 依赖
- 使用 `async_session_factory` (来自 `app/database.py`) 替代 `aiosqlite.connect`
- 使用 SQLAlchemy ORM 模型替代原始 SQL
- Provider ID 类型从 `int` 改为 `UUID`
- 移除 `init_db()` 方法（表创建由 Alembic 管理）
- 移除 SQLite 旧表迁移逻辑

**保持不变的接口：**

```
create_provider(request: ModelProviderCreate) -> ModelProviderResponse
update_provider(provider_id: UUID, request: ModelProviderUpdate) -> Optional[ModelProviderResponse]
delete_provider(provider_id: UUID) -> bool
get_all_providers() -> List[ModelProviderResponse]
get_provider(provider_id: UUID) -> Optional[ModelProviderResponse]
get_provider_api_key(provider_id: UUID) -> Optional[str]

get_all_assignments() -> List[ModelAssignmentResponse]
save_assignment(request: ModelAssignmentRequest) -> Optional[ModelAssignmentResponse]
delete_assignment(function_type: ModelFunctionType) -> bool

get_effective_config(function_type: ModelFunctionType) -> ResolvedConfigResponse
fetch_models_for_provider(provider_id: UUID) -> FetchModelsResponse
fetch_models(request: FetchModelsRequest) -> FetchModelsResponse
test_connection(request: TestConnectionRequest) -> TestConnectionResponse
get_providers() -> List[ProviderInfo]  # 静态数据，不变
```

**实现模式（伪代码）：**

```
class ModelSettingsService:
    async def create_provider(self, request):
        async with async_session_factory() as session:
            provider = ModelProvider(
                name=request.name,
                provider_type=request.provider_type,
                api_url=request.api_url,
                api_key=request.api_key,
            )
            session.add(provider)
            await session.commit()
            await session.refresh(provider)
            return self._to_response(provider)

    async def get_effective_config(self, function_type):
        # 与现有逻辑完全一致：先查数据库，无结果则 fallback 到 env
        async with async_session_factory() as session:
            stmt = select(ModelAssignment, ModelProvider).join(
                ModelProvider, ModelAssignment.provider_id == ModelProvider.id
            ).where(ModelAssignment.function_type == function_type.value)
            result = await session.execute(stmt)
            row = result.first()

        if row:
            assignment, provider = row
            return ResolvedConfigResponse(
                success=True, source="database",
                api_url=provider.api_url, api_key=provider.api_key,
                model_name=assignment.model_name,
                temperature=assignment.temperature, max_tokens=assignment.max_tokens,
            )

        # env fallback（与当前逻辑完全相同）
        ...
```

## SystemSettingsService（新增）

### 文件: `app/services/system_settings_service.py`

**职责：**
1. CRUD 操作 `system_settings` 表
2. 维护内存缓存，实现热重载
3. 提供"恢复默认值"功能
4. 记录审计日志

**内存缓存结构：**

```
_cache: Dict[str, Dict[str, Any]]
# 示例:
# {
#   "tts": {
#     "concurrency": {"concurrent_threads": 3, ...},
#     "voices": [...],
#     ...
#   },
#   "youtube": {
#     "download": {"max_concurrent_downloads": 20, ...},
#     ...
#   }
# }
```

**核心接口：**

```
class SystemSettingsService:
    _cache: Dict[str, Dict[str, Any]]
    _loaded: bool

    async def load_all():
        """启动时从数据库加载所有设置到缓存"""

    def get(category: str, key: str) -> Any:
        """从缓存读取设置值（同步方法，供其他 service 调用）"""

    def get_category(category: str) -> Dict[str, Any]:
        """获取某个 category 下的全部设置"""

    async def get_all() -> Dict[str, Dict[str, Any]]:
        """获取全部设置（从缓存，如未加载则先加载）"""

    async def get_settings_by_category(category: str) -> List[SystemSettingResponse]:
        """获取某类别全部设置（含元信息，用于 API 返回）"""

    async def update_setting(category: str, key: str, value: Any, updated_by: str) -> SystemSettingResponse:
        """更新设置值 -> 写数据库 -> 刷新缓存 -> 记录审计日志"""

    async def update_category(category: str, settings: Dict[str, Any], updated_by: str) -> List[SystemSettingResponse]:
        """批量更新某类别的多个设置"""

    async def reset_to_defaults(category: str, updated_by: str) -> List[SystemSettingResponse]:
        """恢复某个类别到默认值：value = default_value"""

    async def reset_all_to_defaults(updated_by: str):
        """恢复全部设置到默认值"""
```

**热重载机制：**

```
async def update_setting(self, category, key, value, updated_by):
    async with async_session_factory() as session:
        # 1. 更新数据库
        stmt = update(SystemSetting).where(
            SystemSetting.category == category,
            SystemSetting.key == key,
        ).values(value=value, updated_by=updated_by)
        await session.execute(stmt)
        await session.commit()

    # 2. 立即刷新缓存
    self._cache[category][key] = value

    # 3. 通知 config 模块刷新（如果影响了 Settings 对象）
    await self._sync_to_settings(category, key, value)

    # 4. 记录审计日志
    await self._log_audit(category, key, 'update', updated_by)
```

**与 config.py Settings 对象的同步：**

现有的 `get_settings()` 返回一个 Settings 对象，很多 service 直接使用 `settings.batch_tts.*` 等属性。为实现热重载：

```
async def _sync_to_settings(self, category, key, value):
    """将数据库设置值同步回 Settings 对象的对应属性"""
    # 根据 category + key 映射到 Settings 对象的属性
    # 例如: ('tts', 'concurrency') -> settings.batch_tts.concurrent_threads = value['concurrent_threads']
    # 通过一个映射表实现
```

## SettingsAuditService（新增，轻量）

### 文件: 集成在 `SystemSettingsService` 中（不单独文件）

```
async def _log_audit(self, setting_type, category, key, action, changed_by):
    async with async_session_factory() as session:
        log = SettingsAuditLog(
            setting_type=setting_type,
            category=category,
            key=key,
            action=action,
            changed_by=changed_by,
        )
        session.add(log)
        await session.commit()
```

## 初始化流程

### `app/main.py` lifespan 事件中：

```
现有:
  await init_db()                              # PostgreSQL 表创建 + root 用户
  await model_settings_service.init_db()       # SQLite 初始化

改为:
  await init_db()                              # PostgreSQL 表创建 + root 用户
  await system_settings_service.load_all()     # 从数据库加载设置到缓存
  # model_settings_service.init_db() 移除 — 不再需要 SQLite
```

## 消费方改造

现有代码中通过 `settings.batch_tts.*`、`settings.youtube.*` 等读取 YAML 配置的地方，改为通过 `SystemSettingsService` 读取：

```
# 现有:
from app.config import settings
timeout = settings.batch_tts.request_timeout

# 改为:
from app.services.system_settings_service import system_settings_service
timeout = system_settings_service.get("tts", "concurrency")["request_timeout"]
```

或者保持 `settings` 对象的接口不变，通过 `_sync_to_settings` 把数据库值同步回 `settings` 对象 —— 这样消费方代码改动最小。

**推荐方案：** 保持 `settings` 接口，通过 `_sync_to_settings` 同步。这样只需改 `config.py` 的加载逻辑，不需要改所有消费方。
