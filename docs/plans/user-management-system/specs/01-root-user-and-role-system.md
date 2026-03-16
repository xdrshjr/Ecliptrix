# Spec 01: 根用户与角色体系

## 1. 概述

修改现有 User 模型和启动流程，实现根用户机制和四级角色体系。

## 2. User 模型修改

### 2.1 新增字段

在现有 `User` 模型（`app/models/db_models.py`）中新增：

```
is_root: Boolean, default=False, nullable=False
```

- `is_root=True` 的用户始终只有一个，即根用户
- 根用户同时 `is_admin=True`、`user_role="admin"`
- 根用户不可被删除、不可被禁用、不可被降级

### 2.2 角色定义更新

现有 `UserRole` 类型保持不变：`Literal["admin", "regular", "premium"]`

角色层级从高到低：
1. **root**（通过 `is_root=True` 标识，`user_role="admin"`）
2. **admin**（`is_admin=True`，`user_role="admin"`，`is_root=False`）
3. **premium**（`is_admin=False`，`user_role="premium"`）
4. **regular**（`is_admin=False`，`user_role="regular"`）

### 2.3 数据库迁移

- 新增 `is_root` 列，Boolean 类型，默认 False
- 将现有种子管理员的 `is_root` 设为 True（如果其 username 匹配 ROOT_USERNAME）

## 3. 环境变量配置

### 3.1 .env 新增/修改变量

```
# 根用户配置（原 ADMIN_USERNAME/ADMIN_PASSWORD 重命名）
ROOT_USERNAME=admin
ROOT_PASSWORD=<强密码>

# 邀请码（空或不设置则关闭自助注册）
INVITE_CODE=

# 保留旧变量名向后兼容（读取优先级：ROOT_* > ADMIN_*）
# ADMIN_USERNAME=admin  (deprecated, 如果 ROOT_USERNAME 未设置则回退)
# ADMIN_PASSWORD=admin  (deprecated, 如果 ROOT_PASSWORD 未设置则回退)
```

### 3.2 Config 更新

在 `app/config.py` 的 `get_settings()` 中：
- 新增 `root_username`：优先读 `ROOT_USERNAME`，回退 `ADMIN_USERNAME`
- 新增 `root_password`：优先读 `ROOT_PASSWORD`，回退 `ADMIN_PASSWORD`
- 新增 `invite_code`：读 `INVITE_CODE`，默认空字符串

## 4. 根用户启动同步机制

### 4.1 同步流程（`app/database.py` 中 `init_db` 修改）

```
启动时执行：
1. 从 config 读取 root_username 和 root_password
2. 查询数据库中 is_root=True 的用户
3. 如果不存在：
   a. 查询是否有 username=root_username 的用户
   b. 如果有：将其标记为 is_root=True, is_admin=True, user_role="admin"，更新密码 hash
   c. 如果没有：创建新用户，设置 is_root=True, is_admin=True, user_role="admin"
4. 如果存在：
   a. 如果用户名不匹配 root_username：更新用户名
   b. 重新 hash root_password 并更新密码
   c. 确保 is_admin=True, is_active=True, user_role="admin"
5. 如果存在多个 is_root=True 的用户（异常情况）：保留第一个，其余设为 is_root=False
```

### 4.2 安全考虑

- .env 中的密码是明文，但启动同步后数据库中存储的是 bcrypt hash
- 根用户登录时，密码始终对比 .env 中的值（而非数据库中的 hash），确保 .env 是唯一真实来源
- 如果 .env 中 ROOT_PASSWORD 未设置，应用应拒绝启动并报错

## 5. 登录流程修改

### 5.1 认证逻辑（`auth_service.py` 修改）

```
authenticate_user(username, password):
1. 查询数据库中 username 匹配的用户
2. 如果用户 is_root=True：
   a. 从 config 读取 ROOT_PASSWORD
   b. 用 bcrypt 对比 password 与 ROOT_PASSWORD
   c. （不对比数据库中的 hash）
3. 如果用户 is_root=False：
   a. 用 bcrypt 对比 password 与数据库中的 password_hash（现有逻辑）
4. 验证通过后，创建 session（复用现有 session_service）
5. 返回 UserInfo，包含 is_root 字段
```

### 5.2 UserInfo 模型更新

在 `app/models/auth_models.py` 的 `UserInfo` 中新增：
```
is_root: bool = False
```

## 6. 登录历史表

### 6.1 新模型 `LoginHistory`

```
LoginHistory:
  id: UUID, 主键
  user_id: UUID, 外键 -> User.id
  login_at: DateTime, 登录时间
  ip_address: String, 登录 IP
  device_info: Text, User-Agent
  login_result: String, "success" | "failed"
  failure_reason: String, nullable (如 "invalid_password", "account_disabled")
```

### 6.2 记录时机

- 每次调用 `authenticate_user` 时记录，无论成功失败
- 根用户和普通用户都记录

## 7. 接口变更

### 7.1 登录响应增强

`UserLoginResponse` 中的 user 字段新增 `is_root` 属性，前端据此判断是否为超级管理员。

### 7.2 Session 验证响应增强

`SessionValidationResponse` 中也包含 `is_root` 信息，确保前端刷新后能恢复根用户状态。
