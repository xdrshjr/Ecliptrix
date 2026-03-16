# TODO 03: 用户管理 API

**对应 Spec**: `specs/03-user-management-api.md`

## Dependencies

- `depends_on: [01, 02]` — 需要模型和权限中间件
- `blocks: [04]` — 前端 UI 依赖 API
- `parallel_group: B`

## Tasks

### 邀请码注册
- [ ] 修改 `app/services/auth_service.py` 的 `register_user()`：添加邀请码校验
- [ ] 邀请码为空时返回"注册功能已关闭"
- [ ] 邀请码错误时返回"邀请码无效"
- [ ] 通过后创建 regular 用户（不可自选角色）

### 用户列表增强
- [ ] 修改 `app/services/user_service.py` 的 `get_all_users()`：支持分页、角色筛选、状态筛选、搜索、排序
- [ ] 添加权限过滤：admin 调用时不返回 admin/root 用户
- [ ] 更新 `app/routers/user_router.py` 的 `GET /user/list`：接收查询参数

### 用户创建增强
- [ ] 修改 `POST /user/create`：创建 admin 角色时 require_root，其他 require_admin
- [ ] 添加请求体验证（用户名 3-50 字符，密码 6-100 字符）

### 新增端点 — 启用/禁用
- [ ] 实现 `POST /user/toggle-status/{user_id}` 路由和服务
- [ ] 禁用时清除 session token
- [ ] 根用户不可禁用，admin 用户需 root 权限

### 新增端点 — 密码重置
- [ ] 实现 `POST /user/reset-password/{user_id}` 路由和服务
- [ ] 支持手动设置和自动生成临时密码
- [ ] 重置后清除 session token
- [ ] 根用户不可重置

### 新增端点 — 登录历史
- [ ] 实现 `GET /user/login-history/{user_id}` 路由和服务
- [ ] 支持分页
- [ ] admin 仅可查看 non-admin 用户历史

### 新增端点 — 强制下线
- [ ] 实现 `POST /user/force-logout/{user_id}` 路由和服务
- [ ] 清除目标用户 session token
- [ ] 根用户不可强制下线

### 新增端点 — 用户统计
- [ ] 实现 `GET /user/stats` 路由和服务
- [ ] 返回各类计数（总数、各角色数、启用/禁用数、在线数）

### 删除用户增强
- [ ] 修改 `DELETE /user/delete/{user_id}`：根用户不可删除，admin 用户需 root 权限
- [ ] 删除前清除 session token

### Next.js API 代理
- [ ] 创建/更新 `src/app/api/admin/users/` 下的代理路由
- [ ] 所有代理路由转发 Authorization 头
- [ ] 代理路由：list, create, stats, [userId]/toggle-status, reset-password, login-history, force-logout, delete
