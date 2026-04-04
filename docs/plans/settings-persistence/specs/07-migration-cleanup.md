# 07 - SQLite 移除与迁移清理

## 概述

移除旧的 SQLite 存储，清理相关代码，确保向后兼容的平滑过渡。

## 移除清单

### 1. 删除 SQLite 相关依赖

**文件: `backend-services/basic-service/requirements.txt`**

移除:
```
aiosqlite
```

### 2. 重构 `model_settings_service.py`

**移除:**
- `import aiosqlite`
- `DB_DIR`, `DB_PATH` 常量
- `_connect()` 方法（SQLite 连接管理）
- `init_db()` 方法（SQLite 表创建 + 旧表迁移逻辑）
- 所有使用 `aiosqlite.connect` 和 `aiosqlite.Row` 的代码

**替换为:**
- `from app.database import async_session_factory`
- `from app.models.db_models import ModelProvider, ModelAssignment`
- 使用 SQLAlchemy async session 的查询方式

### 3. 更新 `app/main.py`

**移除:**
```python
from app.services.model_settings_service import model_settings_service
await model_settings_service.init_db()
```

**替换为:**
```python
from app.services.system_settings_service import system_settings_service
await system_settings_service.load_all()
```

### 4. 更新 `app/config.py`

**变更:**
- `get_settings()` 中 YAML 加载逻辑保留（用于默认值定义）
- 新增：启动后从 SystemSettingsService 缓存覆盖 Settings 对象的运行时值
- 使 Settings 对象的属性反映数据库中的值，而非 YAML 中的值

**具体改造:**

```
# 现有逻辑:
settings = get_settings()  # 读 .env + YAML -> 构建 Settings 对象

# 改造后:
settings = get_settings()                    # 读 .env + YAML -> 构建 Settings 对象（默认值）
# 在 lifespan 中:
await system_settings_service.load_all()     # 从 DB 加载
system_settings_service.sync_to_settings(settings)  # 覆盖 Settings 中可配置的属性
```

### 5. SQLite 数据文件处理

**`backend-services/basic-service/data/model_settings.db`:**

- 升级后首次启动：不需要读取旧 SQLite（用户选择不迁移旧数据）
- 文件可以保留（不会影响新逻辑）或手动删除
- `data/` 目录保留（可能有其他用途）

### 6. 前端类型更新

**`ModelSettingsPanel.tsx` 中的 provider_id:**

```
// 旧:
provider_id: number

// 新:
provider_id: string  // UUID
```

**受影响的前端文件：**
- `src/components/AdminSettings/ModelSettingsPanel.tsx`
- `src/components/AdminSettings/CodingPlanPanel.tsx`（如果引用了 provider_id）

## 向后兼容策略

### API 层面

| 端点 | 变更 | 兼容性 |
|------|------|--------|
| `GET /api/model-settings/resolve/{function_type}` | 内部实现改变，接口不变 | 完全兼容 |
| `GET /api/model-settings/providers/saved` | provider.id 从 int 变为 UUID string | 需前端适配 |
| `PUT /api/model-settings/assignments` | provider_id 从 int 变为 UUID string | 需前端适配 |
| `GET /api/model-settings/providers/known` | 不变 | 完全兼容 |
| 所有 system-settings 端点 | 全新 | 无兼容问题 |

### config 层面

- `settings.batch_tts.*` 等属性名不变，消费方代码无需修改
- 值的来源从 YAML 文件变为数据库，但通过 `sync_to_settings` 保持 Settings 接口一致

### 部署步骤

```
1. git pull                              # 获取新代码
2. pip install -r requirements.txt       # 更新依赖（安装新依赖，aiosqlite 保留也无害）
3. alembic upgrade head                  # 创建新表 + seed 默认值
4. 重启服务                               # 加载数据库设置到缓存
```

**注意：** 步骤 3 是关键 —— Alembic 迁移会创建新表并填充默认值。之后用户在 UI 中配置的值存入数据库，不会被后续的 git pull 覆盖。

## 注册新 Router

在 `app/main.py` 中注册新 router:

```python
from app.routers import system_settings_router
app.include_router(system_settings_router.router, prefix="/api")
```

## 测试影响

### 现有测试

- `model_settings_service` 的测试需要重写，从 SQLite mock 改为 PostgreSQL/SQLite in-memory（与现有测试策略一致）
- `ResolvedConfigResponse` 的测试保持不变（接口兼容）

### 新增测试

- `SystemSettingsService` 的 CRUD 测试
- 默认值初始化测试
- 恢复默认值测试
- 热重载缓存一致性测试
- API 端点集成测试
