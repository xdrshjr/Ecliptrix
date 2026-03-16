# TODO 01: 根用户与角色体系

**对应 Spec**: `specs/01-root-user-and-role-system.md`

## Dependencies

- `depends_on: []` — 无前置依赖，基础模块
- `blocks: [02, 03, 04, 05]` — 所有后续模块依赖此模块
- `parallel_group: A`

## Tasks

### 数据库模型
- [ ] 在 `app/models/db_models.py` 的 User 模型中添加 `is_root` 字段 (Boolean, default=False)
- [ ] 创建 `LoginHistory` 模型 (id, user_id, login_at, ip_address, device_info, login_result, failure_reason)
- [ ] 创建 Alembic 迁移脚本：新增 `is_root` 列 + `login_history` 表

### 环境变量与配置
- [ ] 更新 `env.template`：添加 `ROOT_USERNAME`、`ROOT_PASSWORD`、`INVITE_CODE`
- [ ] 修改 `app/config.py` 的 `get_settings()`：新增 `root_username`（回退 `ADMIN_USERNAME`）、`root_password`（回退 `ADMIN_PASSWORD`）、`invite_code`
- [ ] 添加启动校验：`ROOT_PASSWORD` 未设置时拒绝启动

### 根用户启动同步
- [ ] 修改 `app/database.py` 的 `init_db()`：实现根用户同步逻辑
  - 查找 is_root=True 用户
  - 不存在则创建，存在则同步用户名和密码
  - 确保 is_admin=True, is_active=True, user_role="admin"
  - 处理多个 is_root 的异常情况

### 认证模型更新
- [ ] 在 `app/models/auth_models.py` 的 `UserInfo` 中添加 `is_root: bool = False`
- [ ] 更新 `UserRegistration` 模型：添加 `invite_code: str` 字段

### 登录流程修改
- [ ] 修改 `app/services/auth_service.py` 的 `authenticate_user()`：根用户密码对比 .env
- [ ] 在 `authenticate_user()` 中添加登录历史记录逻辑（成功和失败都记录）
- [ ] 更新 session 验证响应包含 `is_root` 字段
