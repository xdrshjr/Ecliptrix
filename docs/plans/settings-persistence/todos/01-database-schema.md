# TODO 01 - 数据库 Schema

**对应规格:** `specs/01-database-schema.md`

## Dependencies

- `depends_on: []` — 无前置依赖，可以第一个开始
- `blocks: [02, 03, 04, 07]` — 后端服务、API、默认值初始化、迁移清理都依赖表结构
- `parallel_group: A`

**Why:** 所有其他模块都需要数据库表存在才能工作。

## Tasks

- [ ] 在 `app/models/db_models.py` 中新增 `ModelProvider` ORM 模型（UUID PK, name, provider_type, api_url, api_key, timestamps）
- [ ] 在 `app/models/db_models.py` 中新增 `ModelAssignment` ORM 模型（UUID PK, function_type unique, provider_id FK, model_name, temperature, max_tokens, updated_at）
- [ ] 在 `app/models/db_models.py` 中新增 `SystemSetting` ORM 模型（UUID PK, category+key unique, value JSONB, default_value JSONB, value_type, description, updated_at, updated_by）
- [ ] 在 `app/models/db_models.py` 中新增 `SettingsAuditLog` ORM 模型（UUID PK, setting_type, category, key, action, changed_by, changed_at）
- [ ] 创建 Alembic 迁移文件 `add_settings_tables`：CREATE 4 个表 + 索引
- [ ] 创建 Alembic 迁移文件 `seed_default_settings`：读取 YAML 默认值并 INSERT（ON CONFLICT DO NOTHING）
- [ ] 本地运行 `alembic upgrade head` 验证迁移成功
