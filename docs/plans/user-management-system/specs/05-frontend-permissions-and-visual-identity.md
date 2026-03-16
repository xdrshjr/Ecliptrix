# Spec 05: 前端权限与视觉标识

## 1. 概述

增强前端 AuthContext 以支持根用户识别，实现根用户视觉标识，并控制管理功能的可见性。

## 2. AuthContext 增强

### 2.1 User 类型更新

在 `src/types/auth.ts` 或 `src/types/index.ts` 中更新：

```
interface User {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  fullName?: string;
  avatarUrl?: string;
  userRole?: 'admin' | 'regular' | 'premium';
  isAdmin?: boolean;   // 新增（或已有）
  isRoot?: boolean;    // 新增
}
```

### 2.2 AuthContext 增强

在 `src/contexts/AuthContext.tsx` 中：

```
AuthState 新增派生值:
  isRoot: boolean          // user?.isRoot === true
  isAdmin: boolean         // user?.isAdmin === true (包含 root)
  canManageUsers: boolean  // isAdmin || isRoot
  canManageAdmins: boolean // isRoot only

AuthContext 暴露:
  ...现有属性
  isRoot: boolean
  isAdmin: boolean
  canManageUsers: boolean
  canManageAdmins: boolean
```

### 2.3 Session 恢复

session 验证响应中包含 `is_root` 字段，确保页面刷新后根用户状态正确恢复。

## 3. 根用户视觉标识

### 3.1 角色标签

在用户头像/用户名旁显示角色标签：

| 角色 | 标签文本 | 颜色 |
|------|---------|------|
| Root | 超级管理员 / Super Admin | 红色/深红背景 |
| Admin | 管理员 / Admin | 紫色背景 |
| Premium | 高级用户 / Premium | 金色背景 |
| Regular | 普通用户 / User | 灰色背景 |

### 3.2 显示位置

- **用户菜单/头像区域**：用户名下方或旁边显示角色标签
- **设置页**：用户信息区域显示角色标签

### 3.3 角色标签组件

创建可复用的 `RoleBadge` 组件：

```
props:
  role: 'root' | 'admin' | 'premium' | 'regular'
  size?: 'sm' | 'md'

根据角色返回对应颜色和文本的 Badge 组件
```

## 4. 管理功能可见性控制

### 4.1 设置页用户管理标签

```
条件: canManageUsers === true
行为: 标签页在标签栏中显示/隐藏
```

### 4.2 导航栏管理入口（可选）

如果导航栏有设置入口，可在旁边或下方添加"用户管理"快捷入口：

```
条件: canManageUsers === true
行为: 显示管理图标/链接
```

### 4.3 用户管理页内权限控制

在用户管理标签页内部，根据 `canManageAdmins` 控制：

- 创建用户时角色选项是否包含 "admin"
- 管理员用户行是否显示操作按钮
- 角色筛选是否包含 "admin" 选项

## 5. 登录通知增强

### 5.1 现有行为

登录成功时显示通知，包含角色标签（"管理员"、"高级用户"、"普通用户"）。

### 5.2 增强

新增根用户识别：
- 如果 `is_root === true`：显示 "超级管理员" 标签

## 6. 前端路由保护

### 6.1 当前方案

本次不添加全局路由守卫。仅在组件级别通过 `canManageUsers` 控制渲染。

### 6.2 安全边界

前端权限控制仅为 UI 层面的便利性控制，真正的安全依赖后端 API 权限校验。即使前端被绕过，后端也会拒绝未授权的请求。

## 7. 登出/Session 失效处理

### 7.1 被强制下线时

当 session 验证失败（5 分钟轮询或操作时）：

```
1. 清除 localStorage 中的 user 和 session token
2. 重置 AuthContext 状态
3. 显示通知："您的会话已失效，请重新登录"
4. 跳转到登录页
```

这个行为现有 AuthContext 已支持，确保新增的权限字段也被正确清除即可。

## 8. 类型定义

在 `src/types/` 中新增用户管理相关类型：

```
// 用户列表相关
interface UserListParams {
  page?: number;
  pageSize?: number;
  role?: string;
  status?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface UserListResponse {
  users: UserInfo[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface UserStats {
  totalUsers: number;
  adminCount: number;
  premiumCount: number;
  regularCount: number;
  activeCount: number;
  disabledCount: number;
  onlineCount: number;
}

interface LoginHistoryRecord {
  id: string;
  loginAt: string;
  ipAddress: string;
  deviceInfo: string;
  loginResult: 'success' | 'failed';
  failureReason?: string;
}

interface CreateUserData {
  username: string;
  password: string;
  email?: string;
  fullName?: string;
  userRole: 'admin' | 'regular' | 'premium';
}

interface ResetPasswordData {
  newPassword?: string;
}
```
