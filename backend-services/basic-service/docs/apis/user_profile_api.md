# 用户资料管理 API 接口文档

## 概述

用户资料管理 API 提供用户个人信息的查询和更新功能，支持用户名、邮箱、全名和头像等信息的管理。该 API 与认证系统集成，确保用户数据的安全性。

## 基础信息

- **服务名称**: User Profile Management API
- **版本**: 1.0.0
- **基础URL**: `http://localhost:8000/api/user`
- **认证方式**: 暂时使用用户ID参数（生产环境中应使用JWT Token或Session）

## 通用响应格式

所有 API 响应都遵循统一的格式：

### 成功响应格式
```json
{
  "success": true,
  "message": "操作成功",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "user": {
    // 用户资料数据
  }
}
```

### 错误响应格式
```json
{
  "success": false,
  "message": "错误描述",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "error_code": "ERROR_CODE"
}
```

## API 端点

### 1. 获取用户资料

获取指定用户的个人资料信息。

**端点**: `GET /user/profile`

**查询参数**:
- `user_id` (string, 可选): 用户ID，默认为 "admin"

**请求示例**:
```bash
curl -X GET "http://localhost:8000/api/user/profile?user_id=admin" \
     -H "Content-Type: application/json"
```

**成功响应示例** (HTTP 200):
```json
{
  "success": true,
  "message": "用户资料获取成功",
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
  }
}
```

**错误响应示例**:

- **用户不存在** (HTTP 404):
```json
{
  "success": false,
  "message": "用户不存在",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "error_code": "USER_NOT_FOUND"
}
```

- **服务不可用** (HTTP 500):
```json
{
  "success": false,
  "message": "用户服务不可用",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "error_code": "SERVICE_UNAVAILABLE"
}
```

### 2. 更新用户资料

更新指定用户的个人资料信息。

**端点**: `PUT /user/profile`

**查询参数**:
- `user_id` (string, 可选): 用户ID，默认为 "admin"

**请求体**:
```json
{
  "username": "admin",
  "email": "admin@ecliptrix.com",
  "full_name": "System Administrator",
  "avatar_url": "https://example.com/avatar.jpg"
}
```

**请求参数说明**:
- `username` (string, 必需): 用户名，3-50字符，只能包含字母、数字、下划线和连字符
- `email` (string, 可选): 邮箱地址，必须符合邮箱格式
- `full_name` (string, 可选): 全名，最多100字符
- `avatar_url` (string, 可选): 头像URL，最多500字符，必须以http://或https://开头

**请求示例**:
```bash
curl -X PUT "http://localhost:8000/api/user/profile?user_id=admin" \
     -H "Content-Type: application/json" \
     -d '{
       "username": "admin",
       "email": "admin@ecliptrix.com",
       "full_name": "System Administrator",
       "avatar_url": "https://example.com/avatar.jpg"
     }'
```

**成功响应示例** (HTTP 200):
```json
{
  "success": true,
  "message": "用户资料更新成功",
  "timestamp": "2023-12-01T12:30:00.000Z",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "admin",
    "email": "admin@ecliptrix.com",
    "full_name": "System Administrator",
    "avatar_url": "https://example.com/avatar.jpg",
    "is_active": true,
    "is_admin": true,
    "created_at": "2023-12-01T10:00:00.000Z",
    "updated_at": "2023-12-01T12:30:00.000Z",
    "last_login_at": "2023-12-01T12:00:00.000Z"
  }
}
```

**错误响应示例**:

- **参数验证失败** (HTTP 400):
```json
{
  "success": false,
  "message": "用户名只能包含字母、数字、下划线和连字符",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "error_code": "VALIDATION_ERROR"
}
```

- **用户名已被使用** (HTTP 400):
```json
{
  "success": false,
  "message": "用户名已被使用",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "error_code": "USERNAME_TAKEN"
}
```

- **用户不存在** (HTTP 404):
```json
{
  "success": false,
  "message": "用户不存在",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "error_code": "USER_NOT_FOUND"
}
```

### 3. 用户服务健康检查

检查用户服务的运行状态和数据库连接。

**端点**: `GET /user/health`

**请求示例**:
```bash
curl -X GET "http://localhost:8000/api/user/health" \
     -H "Content-Type: application/json"
```

**成功响应示例** (HTTP 200):
```json
{
  "success": true,
  "message": "用户服务运行正常",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "service": "UserService",
  "status": "healthy",
  "database_connected": true
}
```

## 数据模型

### UserProfile 模型
```json
{
  "id": "string",              // 用户ID
  "username": "string",        // 用户名
  "email": "string",           // 邮箱地址（可选）
  "full_name": "string",       // 全名（可选）
  "avatar_url": "string",      // 头像URL（可选）
  "is_active": "boolean",      // 是否激活
  "is_admin": "boolean",       // 是否为管理员
  "created_at": "datetime",    // 创建时间
  "updated_at": "datetime",    // 更新时间
  "last_login_at": "datetime"  // 最后登录时间（可选）
}
```

### UserProfileUpdate 模型
```json
{
  "username": "string",        // 用户名（必需，3-50字符）
  "email": "string",           // 邮箱地址（可选）
  "full_name": "string",       // 全名（可选，最多100字符）
  "avatar_url": "string"       // 头像URL（可选，最多500字符）
}
```

## 错误代码说明

| 错误代码 | 描述 | HTTP状态码 |
|---------|------|-----------|
| `USER_NOT_FOUND` | 用户不存在 | 404 |
| `USERNAME_TAKEN` | 用户名已被使用 | 400 |
| `VALIDATION_ERROR` | 参数验证失败 | 400 |
| `SERVICE_UNAVAILABLE` | 服务不可用 | 500 |
| `QUERY_ERROR` | 数据查询错误 | 500 |
| `UPDATE_ERROR` | 数据更新错误 | 500 |
| `UPDATE_FAILED` | 数据更新失败 | 500 |

## 使用示例

### Python 示例

```python
import requests
import json

# 基础URL
BASE_URL = "http://localhost:8000/api/user"

# 获取用户资料
def get_user_profile(user_id="admin"):
    response = requests.get(f"{BASE_URL}/profile", params={"user_id": user_id})
    return response.json()

# 更新用户资料
def update_user_profile(user_data, user_id="admin"):
    response = requests.put(
        f"{BASE_URL}/profile",
        params={"user_id": user_id},
        headers={"Content-Type": "application/json"},
        data=json.dumps(user_data)
    )
    return response.json()

# 使用示例
if __name__ == "__main__":
    # 获取用户资料
    profile = get_user_profile()
    print("Current profile:", profile)
    
    # 更新用户资料
    updated_data = {
        "username": "admin",
        "email": "new-admin@ecliptrix.com",
        "full_name": "New Administrator",
        "avatar_url": "https://example.com/new-avatar.jpg"
    }
    
    result = update_user_profile(updated_data)
    print("Update result:", result)
```

### JavaScript 示例

```javascript
const BASE_URL = "http://localhost:8000/api/user";

// 获取用户资料
async function getUserProfile(userId = "admin") {
    const response = await fetch(`${BASE_URL}/profile?user_id=${userId}`);
    return await response.json();
}

// 更新用户资料
async function updateUserProfile(userData, userId = "admin") {
    const response = await fetch(`${BASE_URL}/profile?user_id=${userId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData)
    });
    return await response.json();
}

// 使用示例
(async () => {
    try {
        // 获取用户资料
        const profile = await getUserProfile();
        console.log("Current profile:", profile);
        
        // 更新用户资料
        const updatedData = {
            username: "admin",
            email: "new-admin@ecliptrix.com",
            full_name: "New Administrator",
            avatar_url: "https://example.com/new-avatar.jpg"
        };
        
        const result = await updateUserProfile(updatedData);
        console.log("Update result:", result);
    } catch (error) {
        console.error("Error:", error);
    }
})();
```

## 注意事项

1. **安全性**: 当前版本使用用户ID参数进行身份验证，生产环境中应实现基于JWT Token或Session的认证机制。

2. **数据验证**: 所有输入数据都会进行严格验证，确保数据格式正确和安全性。

3. **数据库**: 该服务使用 Supabase 作为数据存储，确保数据的持久性和一致性。

4. **日志记录**: 所有操作都会记录详细的日志，便于调试和监控。

5. **错误处理**: 提供详细的错误信息和错误代码，便于客户端处理各种异常情况。

## 更新历史

- **v1.0.0** (2023-12-01): 初始版本，支持用户资料的查询和更新功能 