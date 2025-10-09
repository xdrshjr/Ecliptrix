# 用户角色管理功能实现文档

## 功能概述

本次更新为系统添加了用户角色管理功能，将用户分为三种类别：
- **管理员** (admin)
- **普通用户** (regular)
- **高级用户** (premium)

## 主要变更

### 1. 数据库层面

#### 新增字段
- 在 `users` 表中添加了 `user_role` 字段
- 字段类型：枚举类型 `user_role_enum`
- 可选值：'admin', 'regular', 'premium'
- 默认值：'regular'

#### 迁移脚本
- 文件位置：`backend-services/basic-service/sql/add_user_role_field.sql`
- 执行说明：
  ```sql
  -- 在 Supabase 或 PostgreSQL 中执行
  psql -U your_user -d your_database -f sql/add_user_role_field.sql
  ```
- 功能：
  - 创建枚举类型
  - 添加 user_role 字段
  - 自动将现有管理员用户设置为 'admin' 角色
  - 自动将现有非管理员用户设置为 'regular' 角色
  - 创建索引以提高查询性能

### 2. 后端 API 层面

#### 数据模型更新 (`app/models/auth_models.py`)
- 新增 `UserRole` 类型定义
- `UserInfo` 模型新增 `user_role` 字段
- 字段默认值：'regular'

#### 认证服务更新 (`app/services/auth_service.py`)
- 登录时返回用户角色信息
- 注册新用户时默认设置为 'regular' 角色
- 所有用户查询操作包含 user_role 字段
- 日志记录包含用户角色信息

#### 路由层更新 (`app/routers/auth_router.py`)
- 登录响应包含用户角色
- 日志记录包含用户角色信息

### 3. 前端层面

#### 类型定义 (`src/types/auth.ts`)
- 新增 `UserRole` 类型
- `User` 接口新增 `userRole` 字段

#### API 路由 (`src/app/api/auth/login/route.ts`)
- Next.js API 路由转发用户角色信息
- 日志记录包含用户角色

#### 认证上下文 (`src/contexts/AuthContext.tsx`)
- 存储和管理用户角色信息
- 登录成功后显示用户角色标签
- 本地存储包含用户角色

#### 界面组件 (`src/components/Header.tsx`)
- **权限控制实现**：设置图标仅对管理员用户显示
- 条件渲染：`{isAuthenticated && user?.userRole === 'admin' && (...)}`

## 使用说明

### 1. 数据库迁移

首先需要执行数据库迁移脚本：

```bash
# 连接到你的 Supabase 数据库或 PostgreSQL
psql -U your_user -d your_database -f backend-services/basic-service/sql/add_user_role_field.sql
```

或者在 Supabase Dashboard 的 SQL Editor 中直接执行脚本内容。

### 2. 设置用户角色

#### 方法 1：通过数据库直接修改
```sql
-- 设置用户为管理员
UPDATE users SET user_role = 'admin' WHERE username = 'your_admin_username';

-- 设置用户为高级用户
UPDATE users SET user_role = 'premium' WHERE username = 'your_premium_username';

-- 设置用户为普通用户
UPDATE users SET user_role = 'regular' WHERE username = 'your_username';
```

#### 方法 2：通过初始化脚本
可以在 `scripts/init_admin_user.py` 中添加角色设置功能。

### 3. 前端权限控制使用示例

#### 基于角色显示/隐藏组件
```tsx
import { useAuth } from '@/contexts/AuthContext';

function MyComponent() {
  const { user, isAuthenticated } = useAuth();
  
  // 仅管理员可见
  if (isAuthenticated && user?.userRole === 'admin') {
    return <AdminFeature />;
  }
  
  // 管理员和高级用户可见
  if (isAuthenticated && ['admin', 'premium'].includes(user?.userRole || '')) {
    return <PremiumFeature />;
  }
  
  // 所有已登录用户可见
  if (isAuthenticated) {
    return <UserFeature />;
  }
  
  return <PublicFeature />;
}
```

#### 条件渲染示例
```tsx
const { user, isAuthenticated } = useAuth();

return (
  <>
    {/* 管理员专属功能 */}
    {isAuthenticated && user?.userRole === 'admin' && (
      <button>管理员设置</button>
    )}
    
    {/* 高级用户和管理员可用 */}
    {isAuthenticated && (user?.userRole === 'admin' || user?.userRole === 'premium') && (
      <button>高级功能</button>
    )}
    
    {/* 所有用户可用 */}
    {isAuthenticated && (
      <button>基础功能</button>
    )}
  </>
);
```

## 日志记录

所有用户角色相关操作都包含详细的日志记录：

### 后端日志示例
```
[INFO] 用户查询成功 {
  "username": "testuser",
  "user_id": "uuid",
  "is_admin": false,
  "user_role": "regular"
}

[INFO] 用户认证成功 {
  "username": "admin",
  "user_id": "uuid",
  "is_admin": true,
  "user_role": "admin",
  "has_session_token": true,
  "login_time": "2024-10-09T..."
}
```

### 前端日志示例
```
[AuthContext] Login successful: admin {
  hasSessionToken: true,
  userRole: "admin"
}

[Auth API] 用户登录成功 {
  username: "admin",
  userId: "uuid",
  isAdmin: true,
  userRole: "admin",
  hasSessionToken: true,
  timestamp: "2024-10-09T..."
}
```

## 测试建议

### 1. 后端测试
```python
# 测试用户角色字段
async def test_user_role_in_login():
    response = await client.post("/api/auth/login", json={
        "username": "testuser",
        "password": "testpass"
    })
    assert response.status_code == 200
    data = response.json()
    assert "user_role" in data["user"]
    assert data["user"]["user_role"] in ["admin", "regular", "premium"]

# 测试新用户默认角色
async def test_new_user_default_role():
    response = await client.post("/api/auth/register", json={
        "username": "newuser",
        "email": "newuser@example.com",
        "password": "password123"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["user"]["user_role"] == "regular"
```

### 2. 前端测试
```typescript
// 测试管理员权限显示
test('settings icon visible for admin', () => {
  const { getByTestId } = render(<Header {...props} />);
  const settingsButton = getByTestId('settings-button');
  expect(settingsButton).toBeInTheDocument();
});

// 测试普通用户权限隐藏
test('settings icon hidden for regular user', () => {
  const { queryByTestId } = render(<Header {...props} />);
  const settingsButton = queryByTestId('settings-button');
  expect(settingsButton).not.toBeInTheDocument();
});
```

## 安全注意事项

1. **前端验证仅用于 UI 控制**
   - 前端的角色检查只控制界面显示
   - 不能依赖前端验证来保护敏感操作

2. **后端必须验证权限**
   - 所有敏感 API 端点必须在后端验证用户角色
   - 示例：
   ```python
   @router.post("/admin/sensitive-operation")
   async def sensitive_operation(user_id: str):
       user = await auth_service.get_user_by_id(user_id)
       if user.user_role != "admin":
           raise HTTPException(status_code=403, detail="仅管理员可以执行此操作")
       # 执行敏感操作
   ```

3. **会话验证**
   - 会话令牌中不包含角色信息
   - 每次需要验证权限时都应查询数据库获取最新角色信息

## 扩展建议

### 1. 添加更多角色
可以在枚举类型中添加更多角色：
```sql
ALTER TYPE user_role_enum ADD VALUE 'moderator';
ALTER TYPE user_role_enum ADD VALUE 'contributor';
```

### 2. 角色升级/降级 API
创建管理员专用的角色管理接口：
```python
@router.put("/admin/users/{user_id}/role")
async def update_user_role(user_id: str, new_role: UserRole):
    # 验证操作者是管理员
    # 更新用户角色
    pass
```

### 3. 基于角色的功能限制
在各个功能模块中添加角色检查：
```python
# 视频生成数量限制
GENERATION_LIMITS = {
    "admin": 9999,
    "premium": 100,
    "regular": 10
}
```

## 兼容性说明

- **向后兼容**：现有代码在未设置 user_role 时会默认使用 'regular'
- **数据库兼容**：现有用户数据会在迁移脚本中自动设置角色
- **前端兼容**：未登录用户或旧版本数据不会影响界面正常显示

## 总结

本次更新成功实现了用户角色管理功能，包括：
- ✅ 数据库层面的角色字段和索引
- ✅ 后端 API 完整的角色支持和日志记录
- ✅ 前端类型定义和状态管理
- ✅ 基于角色的 UI 权限控制
- ✅ 详细的日志记录和错误处理
- ✅ 向后兼容性保证

系统现在可以根据用户角色提供差异化的功能和权限控制。

