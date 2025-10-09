# 单设备登录功能文档

## 功能概述

单设备登录功能确保一个账号同时只能在一个设备上登录。当用户在新设备登录时，之前的登录会话会被自动失效，原设备的用户会被强制登出。

## 架构设计

### 1. 数据库层

在 `users` 表中添加了以下字段：

- `active_session_token` (VARCHAR(255)): 当前活跃的会话令牌
- `session_created_at` (TIMESTAMP): 会话创建时间
- `session_device_info` (TEXT): 设备信息（User-Agent）
- `session_ip_address` (VARCHAR(45)): IP地址

### 2. 后端服务（FastAPI）

#### 新增服务

**SessionService** (`app/services/session_service.py`):
- `create_session()`: 创建新会话，自动使旧会话失效
- `validate_session()`: 验证会话是否有效
- `invalidate_session()`: 手动注销会话

#### 更新的服务

**AuthService** (`app/services/auth_service.py`):
- `authenticate_user()` 方法现在会在登录成功后自动创建会话
- 接受 `device_info` 和 `ip_address` 参数用于记录登录设备

#### API端点

**POST /api/auth/login**
- 功能：用户登录，生成会话令牌
- 返回：包含 `session_token` 的用户信息
- 副作用：使该用户之前的所有会话失效

**POST /api/auth/validate-session**
- 功能：验证会话令牌是否有效
- 请求体：
  ```json
  {
    "user_id": "uuid",
    "session_token": "token_string"
  }
  ```
- 响应：
  ```json
  {
    "success": true,
    "valid": true/false,
    "reason": "失效原因（如果失效）"
  }
  ```

### 3. Next.js API层

#### 新增路由

**POST /api/auth/validate-session** (`src/app/api/auth/validate-session/route.ts`):
- 代理前端会话验证请求到后端
- 处理超时和错误

#### 更新的路由

**POST /api/auth/login** (`src/app/api/auth/login/route.ts`):
- 现在返回 `session_token` 字段

### 4. 前端（React）

#### 更新的组件

**AuthContext** (`src/contexts/AuthContext.tsx`):
- 存储和管理 `sessionToken`
- 在应用启动时验证会话
- 每5分钟自动验证一次会话
- 会话失效时自动登出并通知用户

#### 类型定义

**auth.ts** (`src/types/auth.ts`):
- 添加了 `sessionToken` 到 `AuthState`
- 新增 `SessionValidationRequest` 和 `SessionValidationResponse` 类型

## 实现流程

### 登录流程

1. 用户在前端输入凭据
2. 前端调用 `/api/auth/login`
3. Next.js API 转发请求到 FastAPI 后端
4. FastAPI 验证凭据
5. 验证成功后，`SessionService.create_session()` 生成新的会话令牌
6. 数据库中更新用户的 `active_session_token`（这会自动使之前的令牌失效）
7. 返回用户信息和会话令牌
8. 前端保存用户信息和会话令牌到 localStorage

### 会话验证流程

1. 应用启动时，`AuthContext` 检查 localStorage 中的会话令牌
2. 如果存在令牌，调用 `/api/auth/validate-session`
3. 后端检查数据库中的 `active_session_token` 是否匹配
4. 如果不匹配（说明在其他设备登录了），返回 `valid: false`
5. 前端收到失效响应后：
   - 清除 localStorage
   - 重置 AuthContext 状态
   - 显示通知："您的账号已在另一台设备上登录"

### 定期验证

- AuthContext 设置了5分钟的定时器
- 定期调用 `validateSession()` 检查会话状态
- 确保用户被及时登出

## 使用示例

### 数据库迁移

首先执行数据库迁移脚本：

```sql
-- 在 Supabase SQL Editor 中执行
-- 文件路径: backend-services/basic-service/sql/add_session_management.sql
```

### 前端使用

```typescript
import { useAuth } from '@/contexts/AuthContext';

function MyComponent() {
  const { user, isAuthenticated, sessionToken, validateSession, logout } = useAuth();

  // 手动验证会话
  const checkSession = async () => {
    const isValid = await validateSession();
    if (!isValid) {
      console.log('Session is invalid');
    }
  };

  return (
    <div>
      {isAuthenticated && (
        <>
          <p>Welcome {user?.username}</p>
          <button onClick={checkSession}>Check Session</button>
          <button onClick={logout}>Logout</button>
        </>
      )}
    </div>
  );
}
```

### 后端测试

```python
# 测试会话创建
from app.services.session_service import session_service

result = await session_service.create_session(
    user_id="user-uuid",
    device_info="Mozilla/5.0...",
    ip_address="192.168.1.1"
)
print(result["session_token"])

# 测试会话验证
validation = await session_service.validate_session(
    user_id="user-uuid",
    session_token="token-string"
)
print(validation["valid"])
```

## 安全考虑

1. **令牌生成**: 使用 `secrets.token_urlsafe(32)` 生成256位的安全令牌
2. **数据库约束**: `active_session_token` 字段有 UNIQUE 约束
3. **自动清理**: 新登录会自动覆盖旧会话，无需手动清理
4. **定期验证**: 前端每5分钟验证一次，及时发现会话失效
5. **设备信息记录**: 记录 User-Agent 和 IP 地址用于审计

## 日志记录

系统会详细记录以下事件：

- 会话创建（包括设备信息和IP）
- 会话验证请求和结果
- 会话失效事件
- 旧会话被新会话替代的情况

日志示例：

```
[SessionService] 创建新用户会话: user_id=xxx, device_info=Mozilla..., ip_address=192.168.1.1
[SessionService] 检测到现有会话，将被新会话替代: user_id=xxx, action=invalidate_old_session
[AuthContext] Session is invalid: 您的账号已在另一台设备上登录
```

## 故障处理

### 场景1：会话服务不可用

- 登录仍然可以成功，但不会生成会话令牌
- 用户可以正常使用系统
- 日志会记录警告

### 场景2：会话验证失败

- 前端自动登出用户
- 显示友好的错误提示
- 用户需要重新登录

### 场景3：网络问题导致验证超时

- 10秒超时设置
- 验证失败不会立即登出，等待下次定期验证

## 配置选项

### 前端配置

在 `src/contexts/AuthContext.tsx` 中修改：

```typescript
// 修改定期验证间隔（默认5分钟）
const interval = setInterval(() => {
  validateSession();
}, 5 * 60 * 1000); // 修改此值
```

### 后端配置

在 `app/services/session_service.py` 中修改：

```python
# 修改令牌长度（默认32字节）
token = secrets.token_urlsafe(32)  # 修改此值
```

## 未来增强

可能的功能扩展：

1. 多设备登录限制（如允许3个设备同时在线）
2. 会话过期时间设置
3. 主动踢出其他设备的功能
4. 登录设备管理界面
5. 可疑登录检测和通知

