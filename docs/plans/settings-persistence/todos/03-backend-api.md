# TODO 03 - 后端 API 端点

**对应规格:** `specs/03-backend-api.md`

## Dependencies

- `depends_on: [01, 02]` — 需要表结构和 service 层
- `blocks: [06]` — 前端 proxy 路由依赖后端 API 存在
- `parallel_group: C`

**Why:** 前端 proxy 路由是后端 API 的透传，后端 API 必须先就绪。

## Tasks

### Pydantic 模型
- [ ] 创建 `app/models/system_settings_models.py`
- [ ] 定义 `SettingsCategoryInfo`, `SystemSettingResponse`, `CategorySettingsResponse`
- [ ] 定义 `UpdateSettingRequest`, `BatchUpdateSettingsRequest`
- [ ] 定义 `AuditLogEntry`, `AuditLogResponse`

### Router
- [ ] 创建 `app/routers/system_settings_router.py`
- [ ] 实现 `GET /system-settings/categories` — 返回配置类别列表
- [ ] 实现 `GET /system-settings/{category}` — 获取类别全部设置
- [ ] 实现 `PUT /system-settings/{category}/{key}` — 更新单个设置
- [ ] 实现 `PUT /system-settings/{category}` — 批量更新类别设置
- [ ] 实现 `POST /system-settings/{category}/reset` — 恢复类别默认值
- [ ] 实现 `POST /system-settings/reset-all` — 恢复全部默认值
- [ ] 实现 `GET /system-settings/audit-log` — 查询审计日志

### 认证
- [ ] 创建管理员权限依赖 `get_admin_user` (或复用已有认证逻辑)
- [ ] 所有 system-settings 端点注入管理员权限检查

### 注册
- [ ] 在 `app/main.py` 注册 `system_settings_router`

### model_settings_router 更新
- [ ] 更新 provider_id 参数类型从 int 改为 str (UUID)
- [ ] 更新 `ModelProviderResponse.id` 类型
- [ ] 验证所有现有端点在 UUID 下正常工作
