# TODO 04: 前端用户管理 UI

**对应 Spec**: `specs/04-frontend-user-management-ui.md`

## Dependencies

- `depends_on: [03, 05]` — 需要后端 API 和前端权限/类型定义
- `blocks: []` — 无后续依赖
- `parallel_group: C`

## Tasks

### API 客户端
- [ ] 创建 `src/lib/api/userManagement.ts`
- [ ] 实现所有 API 调用函数（getUserList, createUser, toggleUserStatus, resetUserPassword, getUserLoginHistory, forceLogout, deleteUser, getUserStats）
- [ ] 确保所有请求附带 session token

### 设置页集成
- [ ] 在设置页标签栏添加「用户管理」标签
- [ ] 条件渲染：仅 isAdmin 或 isRoot 时显示
- [ ] 添加 Users 图标（lucide-react）

### 统计卡片组件
- [ ] 创建 `UserStatsCards` 组件
- [ ] 6 个卡片：总用户、管理员、高级用户、普通用户、已启用、在线
- [ ] 响应式布局（6列/3列/2列）

### 筛选栏组件
- [ ] 创建 `UserFilters` 组件
- [ ] 搜索框（300ms 防抖）
- [ ] 角色下拉筛选（admin 用户隐藏"管理员"选项）
- [ ] 状态下拉筛选
- [ ] 创建用户按钮

### 用户列表表格
- [ ] 创建 `UserTable` 组件
- [ ] 表头可点击排序（用户名、最后登录、创建时间）
- [ ] 用户行：头像+用户名、邮箱、角色标签、状态标签、最后登录、操作
- [ ] 操作下拉菜单（根据权限动态显示选项）
- [ ] 根用户行不显示操作按钮

### 分页组件
- [ ] 创建或复用 Pagination 组件
- [ ] 上一页/页码/下一页
- [ ] 每页数量选择（10/20/50）
- [ ] 总条数和页数信息

### 创建用户弹窗
- [ ] 创建 `CreateUserDialog` 组件
- [ ] 表单字段：用户名、密码、确认密码、邮箱、姓名、角色
- [ ] 角色选项根据 canManageAdmins 动态调整
- [ ] 表单验证
- [ ] 提交后刷新列表和统计

### 编辑用户弹窗
- [ ] 创建 `EditUserDialog` 组件
- [ ] 可编辑：邮箱、姓名、角色
- [ ] 角色修改权限控制

### 重置密码弹窗
- [ ] 创建 `ResetPasswordDialog` 组件
- [ ] 两种模式：自动生成 / 手动设置
- [ ] 自动生成时显示临时密码供复制

### 登录历史抽屉
- [ ] 创建 `LoginHistoryDrawer` 组件
- [ ] 右侧滑出面板
- [ ] 用户信息 + 历史记录列表
- [ ] 分页加载
- [ ] 失败记录红色标注

### 确认弹窗
- [ ] 删除确认弹窗（需输入用户名确认）
- [ ] 禁用确认弹窗（提示在线状态）
- [ ] 强制下线确认弹窗

### 国际化
- [ ] 在 `src/lib/i18n.ts` 中添加所有用户管理相关的中英文翻译
