# TODO 02 - 后端服务层

**对应规格:** `specs/02-backend-services.md`

## Dependencies

- `depends_on: [01]` — 需要 ORM 模型和数据库表已创建
- `blocks: [03, 04, 07]` — API 路由和默认值初始化依赖 service 层
- `parallel_group: B`

**Why:** Service 层是数据层和 API 层之间的桥梁，API 端点的实现依赖 service 方法。

## Tasks

### ModelSettingsService 重构
- [ ] 移除 `aiosqlite` import 和 SQLite 相关代码（`DB_DIR`, `DB_PATH`, `_connect()`, `init_db()`）
- [ ] 引入 `async_session_factory` 和 ORM 模型
- [ ] 重写 `create_provider()` 使用 SQLAlchemy ORM
- [ ] 重写 `update_provider()` 使用 SQLAlchemy ORM（保留 `__KEEP__` sentinel 逻辑）
- [ ] 重写 `delete_provider()` 使用 SQLAlchemy ORM
- [ ] 重写 `get_all_providers()` 和 `get_provider()` 使用 SQLAlchemy ORM
- [ ] 重写 `get_provider_api_key()` 使用 SQLAlchemy ORM
- [ ] 重写 `get_all_assignments()` 和 `save_assignment()` 使用 SQLAlchemy ORM
- [ ] 重写 `delete_assignment()` 使用 SQLAlchemy ORM
- [ ] 重写 `get_effective_config()` 使用 SQLAlchemy ORM（保持返回值 shape 不变）
- [ ] 重写 `fetch_models_for_provider()` 和 `fetch_models()` 使用 SQLAlchemy ORM
- [ ] 更新 `_provider_row_to_response()` 和 `_assignment_row_to_response()` 适配 ORM 对象
- [ ] provider_id 类型从 int 改为 UUID（更新所有方法签名）

### SystemSettingsService 新增
- [ ] 创建 `app/services/system_settings_service.py`
- [ ] 实现内存缓存结构 `_cache: Dict[str, Dict[str, Any]]`
- [ ] 实现 `load_all()` — 从数据库加载全部设置到缓存
- [ ] 实现 `get(category, key)` — 同步缓存读取
- [ ] 实现 `get_category(category)` — 获取类别全部设置
- [ ] 实现 `get_settings_by_category(category)` — 含元信息返回
- [ ] 实现 `update_setting(category, key, value, updated_by)` — 写 DB + 刷新缓存 + 审计日志
- [ ] 实现 `update_category(category, settings, updated_by)` — 批量更新
- [ ] 实现 `reset_to_defaults(category, updated_by)` — 按类别恢复默认
- [ ] 实现 `reset_all_to_defaults(updated_by)` — 全部恢复默认
- [ ] 实现 `_log_audit()` — 审计日志写入
- [ ] 实现 `sync_to_settings(settings)` — 同步缓存值到 config.py Settings 对象
- [ ] 创建模块级实例 `system_settings_service`
