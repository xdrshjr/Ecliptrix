# Spec 03: 认证、会话、用户服务 SQLAlchemy 迁移

## 概述

将 `auth_service.py`、`session_service.py`、`user_service.py`、`agent_workflow_service.py` 从 Supabase Client 迁移到 SQLAlchemy 异步操作。移除双模式（local/supabase）分支，统一为基于数据库的实现。同时移除 `app/services/auth/` 下的内存模式提供者。

---

## 1. AuthService 重构 (`app/services/auth_service.py`)

### 1.1 当前状态分析

现有代码包含：
- Provider 模式（第28-43行）：根据 `AUTH_MODE` 选择 `LocalAuthProvider` 或 Supabase
- Supabase 分支（第45-79行）：创建 Supabase Client
- 每个方法内的 `if settings.auth.mode == "local"` 分支判断
- Supabase `self.client.table('users').select/insert/update` 调用

### 1.2 重构目标

- 移除 Provider 模式和所有 `auth.mode` 判断
- 移除 Supabase Client 初始化
- 所有数据库操作改用 SQLAlchemy
- 方法签名增加 `db: AsyncSession` 参数
- 保留 bcrypt 密码哈希逻辑

### 1.3 重构后的类结构

```
class AuthService:
    """用户认证服务（SQLAlchemy实现）。"""

    def __init__(self):
        logger.info("AuthService initialized")
        # 无需初始化任何客户端连接

    # 保留的工具方法（无变化）
    def _hash_password(password: str) -> str
    def _verify_password(password: str, hashed_password: str) -> bool

    # 重构的业务方法
    async def authenticate_user(db, login_data, device_info, ip_address) -> Dict
    async def register_user(db, registration_data) -> Dict
    async def get_user_by_id(db, user_id) -> Optional[UserInfo]
    def health_check(db) -> Dict
```

### 1.4 authenticate_user 重构

```
async def authenticate_user(
    self,
    db: AsyncSession,
    login_data: UserLogin,
    device_info: Optional[str] = None,
    ip_address: Optional[str] = None
) -> Dict[str, Any]:

    伪代码:
    1. 查询用户:
       stmt = select(User).where(
           User.username == login_data.username,
           User.is_active == True
       )
       result = await db.execute(stmt)
       user = result.scalar_one_or_none()

    2. 如果用户不存在 → 返回 INVALID_CREDENTIALS

    3. 验证密码:
       if not _verify_password(login_data.password, user.password_hash):
           返回 INVALID_CREDENTIALS

    4. 创建会话:
       session_result = await session_service.create_session(
           db, user.id, device_info, ip_address
       )

    5. 更新最后登录时间:
       user.last_login_at = datetime.now(timezone.utc)
       await db.flush()

    6. 构造 UserInfo 返回
```

### 1.5 register_user 重构

```
async def register_user(
    self,
    db: AsyncSession,
    registration_data: UserRegistration
) -> Dict[str, Any]:

    伪代码:
    1. 检查用户名是否已存在:
       stmt = select(User).where(User.username == registration_data.username)
       existing = await db.execute(stmt)
       if existing.scalar_one_or_none():
           返回 USERNAME_EXISTS

    2. 检查邮箱是否已存在:
       stmt = select(User).where(User.email == registration_data.email)
       ...

    3. 哈希密码:
       password_hash = _hash_password(registration_data.password)

    4. 创建用户:
       new_user = User(
           username=registration_data.username,
           email=registration_data.email,
           password_hash=password_hash,
           full_name=registration_data.full_name,
           is_active=True,
           is_admin=False,
           user_role="regular"
       )
       db.add(new_user)
       await db.flush()

    5. 构造 UserInfo 返回
```

### 1.6 get_user_by_id 重构

```
async def get_user_by_id(
    self,
    db: AsyncSession,
    user_id: str
) -> Optional[UserInfo]:

    伪代码:
    stmt = select(User).where(User.id == user_id, User.is_active == True)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        return None

    return UserInfo(
        id=str(user.id),
        username=user.username,
        ...
    )
```

---

## 2. SessionService 重构 (`app/services/session_service.py`)

### 2.1 当前状态分析

现有代码包含：
- `__init__` 中根据 `auth.mode` 创建 `LocalSessionProvider` 或 Supabase Client
- 每个方法内的 `if settings.auth.mode == "local"` 分支
- Supabase `self.client.table('users').select/update` 调用更新会话字段

### 2.2 重构后的类结构

```
class SessionService:
    """会话管理服务（SQLAlchemy实现）。"""

    def __init__(self):
        logger.info("SessionService initialized")

    def _generate_session_token() -> str  # 保留不变

    async def create_session(db, user_id, device_info, ip_address) -> Dict
    async def validate_session(db, user_id, session_token) -> Dict
    async def invalidate_session(db, user_id) -> Dict
```

### 2.3 create_session 重构

```
async def create_session(
    self,
    db: AsyncSession,
    user_id: str,
    device_info: Optional[str] = None,
    ip_address: Optional[str] = None
) -> Dict[str, Any]:

    伪代码:
    1. 生成新 session token

    2. 更新用户的会话字段:
       stmt = update(User).where(User.id == user_id).values(
           active_session_token=session_token,
           session_created_at=datetime.now(timezone.utc),
           session_device_info=device_info,
           session_ip_address=ip_address
       )
       result = await db.execute(stmt)

    3. 检查更新行数:
       if result.rowcount == 0:
           返回 SESSION_CREATION_FAILED

    4. 返回 session_token
```

### 2.4 validate_session 重构

```
async def validate_session(
    self,
    db: AsyncSession,
    user_id: str,
    session_token: str
) -> Dict[str, Any]:

    伪代码:
    1. 查询用户的会话信息:
       stmt = select(
           User.active_session_token,
           User.session_created_at,
           User.is_active
       ).where(User.id == user_id)
       result = await db.execute(stmt)
       user_data = result.one_or_none()

    2. 验证:
       - 用户不存在 → valid=False
       - 用户已禁用 → valid=False
       - 无活跃会话 → valid=False
       - token 不匹配 → valid=False（提示"另一台设备已登录"）
       - 全部通过 → valid=True
```

### 2.5 invalidate_session 重构

```
async def invalidate_session(
    self,
    db: AsyncSession,
    user_id: str
) -> Dict[str, Any]:

    伪代码:
    stmt = update(User).where(User.id == user_id).values(
        active_session_token=None,
        session_created_at=None,
        session_device_info=None,
        session_ip_address=None
    )
    await db.execute(stmt)
    返回成功
```

---

## 3. UserService 重构 (`app/services/user_service.py`)

### 3.1 当前状态分析

- 直接创建 Supabase Client（无 local 模式分支）
- 所有方法使用 `self.client.table('users')` 操作
- 包含：get_user_profile, update_user_profile, get_all_users, create_user, delete_user

### 3.2 重构后的方法签名

所有方法增加 `db: AsyncSession` 参数，移除 `_validate_client()` 检查。

### 3.3 get_user_profile 重构

```
async def get_user_profile(self, db: AsyncSession, user_id: str) -> Dict[str, Any]:

    伪代码:
    # 先按 ID 查询，再按 username 查询（向后兼容）
    stmt = select(User).where(User.id == user_id, User.is_active == True)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        stmt = select(User).where(User.username == user_id, User.is_active == True)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()

    if not user:
        返回 USER_NOT_FOUND

    返回用户资料字典
```

### 3.4 update_user_profile 重构

```
async def update_user_profile(
    self, db: AsyncSession, user_id: str, profile_data: UserProfileUpdate
) -> Dict[str, Any]:

    伪代码:
    1. 查询用户（按ID或username）
    2. 检查新用户名是否被其他用户占用
    3. 使用 SQLAlchemy update 更新字段
    4. await db.flush()
    5. 返回更新后的用户资料
```

### 3.5 get_all_users 重构

```
async def get_all_users(self, db: AsyncSession) -> Dict[str, Any]:

    伪代码:
    stmt = select(User).order_by(User.created_at.desc())
    result = await db.execute(stmt)
    users = result.scalars().all()

    返回用户列表
```

### 3.6 create_user 重构

```
async def create_user(self, db: AsyncSession, user_data: UserCreateRequest) -> Dict[str, Any]:

    伪代码:
    1. 检查用户名唯一性
    2. 检查邮箱唯一性
    3. 哈希密码
    4. 创建 User ORM 对象
    5. db.add(new_user)
    6. await db.flush()
    7. 返回创建的用户资料
```

### 3.7 delete_user 重构

```
async def delete_user(self, db: AsyncSession, user_id: str) -> Dict[str, Any]:

    伪代码:
    1. 查询用户是否存在
    2. stmt = delete(User).where(User.id == user_id)
    3. await db.execute(stmt)
    4. 返回成功
```

---

## 4. AgentWorkflowService 重构 (`app/services/agent_workflow_service.py`)

### 4.1 当前状态分析

- 使用 Supabase Client 操作 `agent_workflows` 表
- 包含：save_workflow, load_workflow, list_workflows, delete_workflow

### 4.2 重构模式

与其他服务相同：移除 Supabase Client，方法签名增加 `db: AsyncSession`。

```
class AgentWorkflowService:
    def __init__(self):
        logger.info("AgentWorkflowService initialized")

    async def save_workflow(db, request) -> Dict
    async def load_workflow(db, workflow_id) -> Dict
    async def list_workflows(db, user_id) -> Dict
    async def delete_workflow(db, workflow_id) -> Dict
```

---

## 5. 移除的文件

### 5.1 删除 `app/services/auth/` 目录

该目录下的 local 模式提供者不再需要：

- `app/services/auth/__init__.py` — 删除
- `app/services/auth/local_provider.py` — 删除（内存认证提供者）
- `app/services/auth/local_session_provider.py` — 删除（内存会话提供者）

**原因：**
- `LocalAuthProvider` 使用内存字典存储用户，重启后数据丢失
- `LocalSessionProvider` 使用内存字典存储会话，重启后所有用户被踢出
- 迁移后统一使用数据库持久化，解决了这些问题

### 5.2 删除 `app/models/supabase_models.py`

将其中通用的模型（如上传请求/响应模型）迁移到 `app/models/storage_models.py`。

---

## 6. 服务单例模式变更

### 6.1 当前模式

每个服务文件末尾创建全局单例：
```python
# 当前
auth_service = AuthService()         # __init__ 中创建 Supabase Client
session_service = SessionService()   # __init__ 中创建 Supabase Client
user_service = UserService()         # __init__ 中创建 Supabase Client
```

### 6.2 新模式

保留单例模式，但 `__init__` 不再创建连接：
```python
# 新
auth_service = AuthService()         # __init__ 仅日志记录
session_service = SessionService()   # __init__ 仅日志记录
user_service = UserService()         # __init__ 仅日志记录
```

数据库会话通过每次请求的依赖注入获取，不再由服务持有。

---

## 7. 错误处理模式

### 7.1 统一异常处理

保留现有的 try/except + logger 模式，但移除 `_validate_client()` 检查：

```
# Before:
if not self._validate_client():
    return {"success": False, "message": "服务不可用"}
try:
    response = self.client.table('users')...
except Exception as e:
    ...

# After:
try:
    stmt = select(User)...
    result = await db.execute(stmt)
except Exception as e:
    logger.error("操作失败", {"error": str(e)})
    return {"success": False, "message": "操作失败", "error_code": "DB_ERROR"}
```

### 7.2 UUID 类型处理

Supabase 返回的 `id` 是字符串，SQLAlchemy 中使用 UUID 类型。需要注意转换：

```
# User.id 是 UUID 类型，查询时可能需要转换
from uuid import UUID as PyUUID

user_uuid = PyUUID(user_id) if isinstance(user_id, str) else user_id
stmt = select(User).where(User.id == user_uuid)
```

---

## 8. 关键注意点

1. **session_service 和 auth_service 的依赖关系**：`auth_service.authenticate_user()` 内部调用 `session_service.create_session()`，重构后两者都需要接收同一个 `db` session
2. **事务边界**：一次认证操作中的所有数据库操作（查询用户、创建会话、更新登录时间）应在同一个事务内完成
3. **初始管理员用户**：从 `LocalAuthProvider._initialize_admin_user()` 迁移到 `database.py` 的 `init_db()` 中
4. **密码哈希**：bcrypt 逻辑完全保留不变，仅数据存取方式改变

---

## 9. 受影响文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/services/auth_service.py` | **重写** | 移除 Provider 模式和 Supabase 分支 |
| `app/services/session_service.py` | **重写** | 移除 Supabase Client，使用 SQLAlchemy |
| `app/services/user_service.py` | **重写** | 移除 Supabase Client，使用 SQLAlchemy |
| `app/services/agent_workflow_service.py` | **重写** | 移除 Supabase Client，使用 SQLAlchemy |
| `app/services/auth/__init__.py` | **删除** | |
| `app/services/auth/local_provider.py` | **删除** | 内存认证不再需要 |
| `app/services/auth/local_session_provider.py` | **删除** | 内存会话不再需要 |
| `app/models/supabase_models.py` | **删除** | 内容迁移到 storage_models.py |
