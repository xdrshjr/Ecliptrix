# TODO 02: 权限校验中间件

**对应 Spec**: `specs/02-permission-middleware.md`

## Dependencies

- `depends_on: [01]` — 需要 User 模型的 is_root 字段和 session 基础设施
- `blocks: [03]` — API 端点需要使用权限依赖
- `parallel_group: B`

## Tasks

### 依赖函数创建
- [ ] 创建 `app/dependencies/auth.py`（新建 `app/dependencies/` 目录和 `__init__.py`）
- [ ] 实现 `get_current_user(request, db)` — 从请求头提取 session token 并验证
- [ ] 实现 `require_admin(current_user)` — 检查 is_admin=True
- [ ] 实现 `require_root(current_user)` — 检查 is_root=True

### 错误处理
- [ ] 定义权限错误码：UNAUTHORIZED (401)、FORBIDDEN (403)、ACCOUNT_DISABLED (403)
- [ ] 确保错误响应遵循 ErrorResponse 模型格式

### Token 传递
- [ ] 确定 session token 在 HTTP 请求头中的传递格式（Authorization: Bearer <token>）
- [ ] 确保 Next.js 代理路由转发 session token 到后端

### 应用到现有路由
- [ ] 将 `require_admin` 应用到 `app/routers/user_router.py` 的管理端点
- [ ] 在 user_router 的操作端点中添加根用户保护逻辑（不可删除/禁用/修改根用户）
- [ ] 在 user_router 的操作端点中添加管理员保护逻辑（操作 admin 需 require_root）
