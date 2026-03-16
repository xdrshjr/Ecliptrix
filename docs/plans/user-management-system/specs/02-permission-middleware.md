# Spec 02: 权限校验中间件

## 1. 概述

实现 FastAPI 依赖注入式的权限校验系统，提供 `get_current_user`、`require_admin`、`require_root` 三个核心依赖。

## 2. 依赖项设计

### 2.1 get_current_user

最基础的认证依赖，从请求中提取并验证 session token。

```
async def get_current_user(request: Request, db: AsyncSession) -> User:
    1. 从请求头提取 session token
       - Header 名称: "Authorization" 或 "X-Session-Token"
       - 格式: "Bearer <token>" 或直接 token
    2. 如果无 token → 抛出 401 HTTPException
    3. 调用 session_service.validate_session(token)
    4. 如果 session 无效 → 抛出 401 HTTPException
    5. 查询用户记录
    6. 如果用户 is_active=False → 抛出 403 HTTPException("账户已禁用")
    7. 返回 User 对象
```

### 2.2 require_admin

管理员级别权限，要求 `is_admin=True`（包含根用户）。

```
async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    1. 如果 current_user.is_admin == False → 抛出 403 HTTPException("需要管理员权限")
    2. 返回 current_user
```

### 2.3 require_root

根用户级别权限，仅允许根用户。

```
async def require_root(current_user: User = Depends(get_current_user)) -> User:
    1. 如果 current_user.is_root == False → 抛出 403 HTTPException("需要超级管理员权限")
    2. 返回 current_user
```

## 3. 文件位置

新建 `app/dependencies/auth.py`，包含以上三个依赖函数。

或者直接在 `app/services/auth_service.py` 中添加依赖函数（取决于现有项目结构偏好）。

建议：新建 `app/dependencies/` 目录，将认证依赖独立出来。

## 4. Session Token 传递方式

### 4.1 后端 API（FastAPI）

请求头方式：
```
Authorization: Bearer <session_token>
```

### 4.2 Next.js API 代理层

现有的 Next.js API 路由代理到后端时，需要将前端传来的 session token 转发到后端请求头中。

修改代理路由的通用模式：
```
从前端请求中获取 session token（Cookie 或 Header）
→ 添加到发往后端的请求头 Authorization 中
```

### 4.3 前端请求

前端 API 客户端（`src/lib/api/` 中的各个客户端）需要统一附带 session token。

建议：在现有的 fetch/axios 封装中添加拦截器，自动从 localStorage 获取 `ecliptrix-session-token` 并附加到请求头。

## 5. 错误响应格式

所有权限校验错误遵循现有 `ErrorResponse` 模型：

```
{
  "success": false,
  "message": "需要管理员权限",
  "error_code": "FORBIDDEN",
  "error_details": "当前用户角色不足以执行此操作"
}
```

错误码定义：
- `UNAUTHORIZED` (401): 未登录或 session 无效
- `FORBIDDEN` (403): 已登录但权限不足
- `ACCOUNT_DISABLED` (403): 账户已被禁用

## 6. 应用范围

### 6.1 需要 require_root 的端点
- `POST /user/create`（当创建 admin 角色时）
- `PUT /user/profile`（当修改 admin 用户时）
- `DELETE /user/delete/{user_id}`（当删除 admin 用户时）
- 系统配置相关端点（现有）

### 6.2 需要 require_admin 的端点
- `GET /user/list`
- `POST /user/create`（创建 regular/premium 用户时）
- `PUT /user/profile`（修改 regular/premium 用户时）
- `DELETE /user/delete/{user_id}`（删除 regular/premium 用户时）
- `GET /user/login-history/{user_id}`（新增）
- `POST /user/force-logout/{user_id}`（新增）
- `POST /user/reset-password/{user_id}`（新增）

### 6.3 需要 get_current_user 的端点
- `GET /user/profile`（获取自己的信息）
- 其他需要知道当前用户身份的端点

### 6.4 特殊权限逻辑

对于需要区分"操作 admin 用户"和"操作普通用户"的端点（如 /user/create、/user/delete），权限检查逻辑为：

```
if 目标用户 is admin:
    require_root(current_user)  # 只有根用户能管理管理员
elif 目标用户 is root:
    raise 403  # 任何人都不能通过 API 修改根用户
else:
    require_admin(current_user)  # 管理员可以管理普通用户
```

## 7. 向后兼容

- 现有无权限校验的端点逐步添加依赖注入
- 对于现有已在使用但未传 token 的前端调用，需要同步更新前端请求方式
- 过渡期可考虑在依赖中添加 `optional=True` 参数，使 token 可选（不推荐长期使用）
