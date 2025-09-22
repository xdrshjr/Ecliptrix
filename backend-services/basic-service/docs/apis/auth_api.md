# 用户认证 API 接口文档

## 概述

用户认证 API 提供用户登录、注册和认证管理功能，使用 Supabase 数据库存储用户信息，支持密码哈希和安全验证。

## 基础信息

- **服务名称**: Authentication API
- **版本**: 1.0.0
- **基础URL**: `http://localhost:8000/api/auth`
- **认证方式**: 用户名密码认证

## 通用响应格式

所有 API 响应都遵循统一的格式：

### 成功响应格式
```json
{
  "success": true,
  "message": "操作成功",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "data": {
    // 具体数据内容
  }
}
```

### 错误响应格式
```json
{
  "success": false,
  "message": "错误描述",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "error_code": "ERROR_CODE",
  "error_details": {
    // 错误详细信息（可选）
  }
}
```

## API 端点

### 1. 用户登录

用户使用用户名和密码进行登录认证。

**端点**: `POST /auth/login`

**请求体**:
```json
{
  "username": "admin",
  "password": "admin"
}
```

**请求参数说明**:
- `username` (string, 必需): 用户名，长度3-50字符
- `password` (string, 必需): 密码，至少1个字符

**成功响应示例** (HTTP 200):
```json
{
  "success": true,
  "message": "登录成功",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "admin",
    "email": "admin@ecliptrix.com",
    "full_name": "System Administrator",
    "avatar_url": null,
    "is_active": true,
    "is_admin": true,
    "created_at": "2023-12-01T10:00:00.000Z",
    "updated_at": "2023-12-01T12:00:00.000Z",
    "last_login_at": "2023-12-01T12:00:00.000Z"
  },
  "token": null
}
```

**错误响应示例**:

- **无效凭据** (HTTP 401):
```json
{
  "success": false,
  "message": "用户名或密码错误",
  "error_code": "INVALID_CREDENTIALS"
}
```

- **缺少参数** (HTTP 400):
```json
{
  "success": false,
  "message": "用户名和密码是必需的",
  "error_code": "MISSING_CREDENTIALS"
}
```

- **服务不可用** (HTTP 503):
```json
{
  "success": false,
  "message": "认证服务不可用",
  "error_code": "SERVICE_UNAVAILABLE"
}
```

### 2. 用户注册

注册新用户账户。

**端点**: `POST /auth/register`

**请求体**:
```json
{
  "username": "newuser",
  "email": "newuser@example.com",
  "password": "password123",
  "full_name": "New User"
}
```

**请求参数说明**:
- `username` (string, 必需): 用户名，长度3-50字符，必须唯一
- `email` (string, 必需): 邮箱地址，必须是有效邮箱格式，必须唯一
- `password` (string, 必需): 密码，至少6个字符
- `full_name` (string, 可选): 用户全名，最多255字符

**成功响应示例** (HTTP 200):
```json
{
  "success": true,
  "message": "用户注册成功",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "username": "newuser",
    "email": "newuser@example.com",
    "full_name": "New User",
    "avatar_url": null,
    "is_active": true,
    "is_admin": false,
    "created_at": "2023-12-01T12:00:00.000Z",
    "updated_at": "2023-12-01T12:00:00.000Z",
    "last_login_at": null
  }
}
```

**错误响应示例**:

- **用户名已存在** (HTTP 409):
```json
{
  "success": false,
  "message": "用户名已存在",
  "error_code": "USERNAME_EXISTS"
}
```

- **邮箱已存在** (HTTP 409):
```json
{
  "success": false,
  "message": "邮箱已存在",
  "error_code": "EMAIL_EXISTS"
}
```

### 3. 认证服务健康检查

检查认证服务的健康状态和数据库连接。

**端点**: `GET /auth/health`

**成功响应示例** (HTTP 200):
```json
{
  "service": "AuthService",
  "status": "healthy",
  "message": "认证服务运行正常",
  "users_table_accessible": true
}
```

**错误响应示例**:
```json
{
  "service": "AuthService",
  "status": "unhealthy",
  "message": "数据库连接测试失败: connection timeout"
}
```

## 数据模型

### 用户信息模型 (UserInfo)

```json
{
  "id": "UUID",
  "username": "string (3-50字符)",
  "email": "string (邮箱格式)",
  "full_name": "string | null (最多255字符)",
  "avatar_url": "string | null",
  "is_active": "boolean",
  "is_admin": "boolean",
  "created_at": "datetime (ISO 8601)",
  "updated_at": "datetime (ISO 8601)",
  "last_login_at": "datetime | null (ISO 8601)"
}
```

## 错误代码说明

| 错误代码 | 描述 | HTTP状态码 |
|---------|------|-----------|
| `INVALID_CREDENTIALS` | 用户名或密码错误 | 401 |
| `MISSING_CREDENTIALS` | 缺少必需的登录凭据 | 400 |
| `SERVICE_UNAVAILABLE` | 认证服务不可用 | 503 |
| `USERNAME_EXISTS` | 用户名已存在 | 409 |
| `EMAIL_EXISTS` | 邮箱已存在 | 409 |
| `USER_CREATION_FAILED` | 用户创建失败 | 400 |
| `AUTHENTICATION_ERROR` | 认证过程异常 | 400 |
| `REGISTRATION_ERROR` | 注册过程异常 | 400 |
| `INTERNAL_SERVER_ERROR` | 内部服务器错误 | 500 |

## 安全注意事项

1. **密码安全**: 所有密码使用 bcrypt 算法进行哈希存储，不以明文形式保存
2. **输入验证**: 所有输入参数都经过严格验证，防止SQL注入和XSS攻击
3. **日志安全**: 日志记录中不包含敏感信息如密码
4. **数据库安全**: 使用 Supabase 行级安全策略 (RLS) 保护用户数据
5. **错误处理**: 统一的错误处理避免信息泄露

## 环境变量配置

认证服务需要以下环境变量：

```env
# Supabase 配置
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_BUCKET=your-bucket-name
ENVIRONMENT=development
```

## 数据库表结构

认证服务使用 `users` 表存储用户信息，详细表结构请参考 `sql/create_users_table.sql` 文件。

## 使用示例

### JavaScript/TypeScript 示例

```javascript
// 用户登录
const loginResponse = await fetch('/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    username: 'admin',
    password: 'admin'
  })
});

const loginResult = await loginResponse.json();
if (loginResult.success) {
  console.log('登录成功:', loginResult.user);
} else {
  console.error('登录失败:', loginResult.message);
}

// 用户注册
const registerResponse = await fetch('/api/auth/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    username: 'newuser',
    email: 'newuser@example.com',
    password: 'password123',
    full_name: 'New User'
  })
});

const registerResult = await registerResponse.json();
if (registerResult.success) {
  console.log('注册成功:', registerResult.user);
} else {
  console.error('注册失败:', registerResult.message);
}
```

### Python 示例

```python
import requests

# 用户登录
login_data = {
    "username": "admin",
    "password": "admin"
}

response = requests.post(
    "http://localhost:8000/api/auth/login",
    json=login_data
)

if response.status_code == 200:
    result = response.json()
    if result["success"]:
        print("登录成功:", result["user"])
    else:
        print("登录失败:", result["message"])
else:
    print("请求失败:", response.status_code)
```

## 更新日志

### v1.0.0 (2023-12-01)
- 初始版本发布
- 支持用户登录和注册功能
- 集成 Supabase 数据库
- 实现密码哈希和安全验证
- 添加健康检查端点 