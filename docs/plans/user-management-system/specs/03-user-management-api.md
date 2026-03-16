# Spec 03: 用户管理 API

## 1. 概述

增强现有用户管理 API，添加邀请码注册、密码重置、登录历史查询、强制下线、用户筛选排序分页等功能。

## 2. API 端点总览

| 方法 | 路径 | 权限 | 描述 |
|------|------|------|------|
| POST | /auth/register | 公开（需邀请码） | 自助注册 |
| GET | /user/list | admin+ | 用户列表（分页/筛选/排序） |
| POST | /user/create | admin+（admin角色需root） | 创建用户 |
| GET | /user/profile | 登录用户 | 获取用户信息 |
| PUT | /user/profile | admin+（admin角色需root） | 修改用户信息 |
| DELETE | /user/delete/{user_id} | admin+（admin角色需root） | 删除用户 |
| POST | /user/toggle-status/{user_id} | admin+（admin角色需root） | 启用/禁用用户 |
| POST | /user/reset-password/{user_id} | admin+（admin角色需root） | 重置用户密码 |
| GET | /user/login-history/{user_id} | admin+（admin仅限non-admin用户） | 查询登录历史 |
| POST | /user/force-logout/{user_id} | admin+（admin仅限non-admin用户） | 强制下线 |
| GET | /user/stats | admin+ | 用户统计信息 |

## 3. 邀请码注册

### 3.1 修改 /auth/register

现有注册接口增加邀请码校验：

```
请求体新增字段:
  invite_code: str (必填)

校验逻辑:
1. 从 config 读取 INVITE_CODE
2. 如果 INVITE_CODE 为空或未设置 → 返回 400 "注册功能已关闭"
3. 如果请求中 invite_code != INVITE_CODE → 返回 400 "邀请码无效"
4. 校验通过 → 创建 regular 用户（is_admin=False, user_role="regular"）
5. 注册时不可指定角色，始终为 regular
```

### 3.2 注册模型更新

`UserRegistration` 模型新增：
```
invite_code: str
```

## 4. 用户列表增强

### 4.1 GET /user/list 查询参数

```
page: int = 1              # 页码
page_size: int = 20         # 每页数量（最大100）
role: str = None            # 角色筛选: "admin" | "premium" | "regular"
status: str = None          # 状态筛选: "active" | "disabled"
search: str = None          # 搜索关键词（匹配用户名/邮箱）
sort_by: str = "created_at" # 排序字段: "created_at" | "last_login_at" | "username"
sort_order: str = "desc"    # 排序方向: "asc" | "desc"
```

### 4.2 响应格式

```
{
  "success": true,
  "data": {
    "users": [...],
    "total": 100,
    "page": 1,
    "page_size": 20,
    "total_pages": 5
  }
}
```

### 4.3 权限过滤

- admin 用户调用时：列表中不包含其他 admin 和 root 用户
- root 用户调用时：列表包含所有用户（root 自己除外）

## 5. 用户创建增强

### 5.1 POST /user/create

```
请求体:
  username: str (必填, 3-50字符)
  password: str (必填, 6-100字符)
  email: str (可选)
  full_name: str (可选)
  user_role: "admin" | "regular" | "premium" (必填)
  is_active: bool = True

权限逻辑:
  if user_role == "admin":
      require_root  # 只有根用户能创建管理员
  else:
      require_admin  # 管理员可以创建普通/高级用户
```

## 6. 启用/禁用用户

### 6.1 POST /user/toggle-status/{user_id}

```
行为:
  1. 查询目标用户
  2. 如果目标用户 is_root=True → 403 "不能禁用根用户"
  3. 如果目标用户 is_admin=True → require_root
  4. 切换 is_active 状态
  5. 如果从启用→禁用：同时清除该用户的 session token（立即失效）
  6. 返回更新后的用户信息

响应:
  { "success": true, "data": { "user": {...}, "new_status": "active" | "disabled" } }
```

## 7. 密码重置

### 7.1 POST /user/reset-password/{user_id}

```
请求体:
  new_password: str (可选, 6-100字符)

行为:
  1. 如果目标用户 is_root=True → 403 "不能重置根用户密码，请修改 .env"
  2. 如果目标用户 is_admin=True → require_root
  3. 如果 new_password 未提供 → 生成随机临时密码 (12位字母数字)
  4. 更新数据库中的 password_hash
  5. 清除该用户的 session token（强制重新登录）
  6. 返回新密码（仅在自动生成时返回，手动设置时不返回）

响应:
  { "success": true, "data": { "temporary_password": "abc123..." } }  // 自动生成时
  { "success": true, "message": "密码已重置" }  // 手动设置时
```

## 8. 登录历史

### 8.1 GET /user/login-history/{user_id}

```
查询参数:
  page: int = 1
  page_size: int = 20

权限:
  admin 用户只能查看 non-admin 用户的历史
  root 用户可以查看所有用户的历史

响应:
  {
    "success": true,
    "data": {
      "records": [
        {
          "id": "uuid",
          "login_at": "2026-03-16T10:00:00Z",
          "ip_address": "192.168.1.1",
          "device_info": "Mozilla/5.0...",
          "login_result": "success" | "failed",
          "failure_reason": null | "invalid_password" | "account_disabled"
        }
      ],
      "total": 50,
      "page": 1,
      "page_size": 20
    }
  }
```

## 9. 强制下线

### 9.1 POST /user/force-logout/{user_id}

```
行为:
  1. 如果目标用户 is_root=True → 403 "不能强制下线根用户"
  2. 如果目标用户 is_admin=True → require_root
  3. 清除该用户的 active_session_token（设为 null）
  4. 用户当前操作不受影响，但下次 session 验证时（5分钟内）会失效
  5. 记录操作日志

响应:
  { "success": true, "message": "用户已被强制下线" }
```

## 10. 用户统计

### 10.1 GET /user/stats

```
权限: require_admin

响应:
  {
    "success": true,
    "data": {
      "total_users": 100,
      "admin_count": 5,
      "premium_count": 20,
      "regular_count": 75,
      "active_count": 90,
      "disabled_count": 10,
      "online_count": 15  // 有有效 session token 的用户数
    }
  }
```

## 11. 删除用户增强

### 11.1 DELETE /user/delete/{user_id}

```
增强逻辑:
  1. 如果目标用户 is_root=True → 403 "不能删除根用户"
  2. 如果目标用户 is_admin=True → require_root
  3. 清除 session token
  4. 删除用户记录（硬删除）
  5. 关联的 login_history 记录保留（user_id 设为 null 或级联删除，取决于审计需求）
```

## 12. Next.js API 代理层

对应后端每个新增/修改的端点，需要在 `src/app/api/admin/` 下创建或更新代理路由：

```
src/app/api/admin/users/
  list/route.ts          → GET /api/user/list
  create/route.ts        → POST /api/user/create
  stats/route.ts         → GET /api/user/stats
  [userId]/
    toggle-status/route.ts   → POST /api/user/toggle-status/{userId}
    reset-password/route.ts  → POST /api/user/reset-password/{userId}
    login-history/route.ts   → GET /api/user/login-history/{userId}
    force-logout/route.ts    → POST /api/user/force-logout/{userId}
    delete/route.ts          → DELETE /api/user/delete/{userId}
```

所有代理路由需要转发前端请求中的 session token 到后端 Authorization 头。
