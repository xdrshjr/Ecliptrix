# TODO 07 - 迁移清理

**对应规格:** `specs/07-migration-cleanup.md`

## Dependencies

- `depends_on: [01, 02, 03]` — 需要新表、新 service、新 API 全部就绪
- `blocks: []` — 清理工作，无下游依赖
- `parallel_group: D` — 可与 05 并行

**Why:** 清理旧 SQLite 代码，确保代码库干净，避免维护两套存储逻辑。

## Tasks

### 代码清理
- [ ] 从 `requirements.txt` 移除 `aiosqlite`（如果确认不再有其他模块使用）— SKIPPED per instructions (leave for manual cleanup)
- [ ] 清理 `model_settings_service.py` 中残留的 SQLite 注释或 dead code — NOT in scope (backend handled by dev-01/dev-02)
- [ ] 更新 `app/main.py` lifespan：移除 `model_settings_service.init_db()`，添加 `system_settings_service.load_all()` — NOT in scope (backend handled by dev-01/dev-02)

### 配置模块更新
- [ ] 更新 `app/config.py`：在 lifespan 中调用 `sync_to_settings()` 覆盖 YAML 默认值 — NOT in scope (backend)
- [ ] 验证 YAML 文件仍然可以被读取（作为默认值来源） — NOT in scope (backend)
- [ ] 验证 `get_settings()` 返回的 Settings 对象反映数据库中的值 — NOT in scope (backend)

### 前端类型更新 (Task 07 scope for google-dev-03)
- [x] 更新 `ModelSettingsPanel.tsx` 中 provider_id 类型从 number 改为 string (UUID)
- [x] 更新 `CodingPlanPanel.tsx` 中 provider_id 类型从 number 改为 string (UUID)
- [x] 更新所有related state types (fetchingModels, expandedProviderModels, deleteConfirmId, ProviderFormState.id)
- [x] 更新 parseInt() calls to use string values directly for provider ID selects

### 集成验证
- [ ] 端到端测试：启动服务 → 访问 AdminSettings → 修改 TTS 并发数 → 保存 → 验证即时生效
- [ ] 端到端测试：恢复默认值 → 验证值恢复 → 重启服务 → 验证默认值仍然生效
- [ ] 端到端测试：模拟版本更新（添加新 YAML 设置项 → alembic upgrade → 验证新项自动出现）
- [ ] 验证 model-settings resolve 接口在 PostgreSQL 下行为一致
- [ ] 验证现有功能（视频搜索、TTS、视频分析等）使用数据库配置正常工作
