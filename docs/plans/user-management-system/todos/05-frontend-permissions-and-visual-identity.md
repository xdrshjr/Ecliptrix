# TODO 05: 前端权限与视觉标识

**对应 Spec**: `specs/05-frontend-permissions-and-visual-identity.md`

## Dependencies

- `depends_on: [01]` — 需要后端 is_root 字段支持
- `blocks: [04]` — UI 组件使用权限状态和类型
- `parallel_group: B`

## Tasks

### 类型定义
- [ ] 更新 `src/types/` 中的 User 接口：添加 `isRoot?: boolean`、`isAdmin?: boolean`
- [ ] 新增用户管理相关类型：UserListParams、UserListResponse、UserStats、LoginHistoryRecord、CreateUserData、ResetPasswordData

### AuthContext 增强
- [ ] 修改 `src/contexts/AuthContext.tsx`：
  - 从登录响应和 session 验证响应中读取 `is_root`
  - 新增派生值：isRoot, isAdmin, canManageUsers, canManageAdmins
  - 暴露这些值到 Context
- [ ] 确保 session 恢复时正确设置 isRoot 状态

### RoleBadge 组件
- [ ] 创建 `src/components/ui/RoleBadge.tsx`
- [ ] Props: role ('root' | 'admin' | 'premium' | 'regular'), size ('sm' | 'md')
- [ ] 颜色映射：root=红色, admin=紫色, premium=金色, regular=灰色

### 视觉标识应用
- [ ] 在用户菜单/头像区域显示 RoleBadge
- [ ] 登录通知增强：根用户显示"超级管理员"

### Session 失效处理
- [ ] 确保被强制下线时清除所有权限相关状态
- [ ] 显示"会话已失效"通知
