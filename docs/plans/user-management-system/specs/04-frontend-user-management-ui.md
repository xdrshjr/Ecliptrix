# Spec 04: 前端用户管理 UI

## 1. 概述

在设置页中新增「用户管理」标签页，提供完整的用户 CRUD 管理界面，包括统计卡片、筛选、分页、以及各种用户操作。

## 2. 设置页标签集成

### 2.1 标签页添加

在设置页（`src/app/settings/` 或相关组件）的标签栏中新增：
- 标签名称：「用户管理」/ "User Management"
- 图标：Users 图标（lucide-react）
- 可见条件：当前用户 `is_admin=true` 或 `is_root=true`
- 位置：放在标签栏末尾或靠后位置

### 2.2 组件结构

```
UserManagementTab (主容器)
├── UserStatsCards (统计卡片区)
│   ├── TotalUsersCard
│   ├── AdminCountCard
│   ├── PremiumCountCard
│   ├── RegularCountCard
│   ├── ActiveCountCard
│   └── OnlineCountCard
├── UserFilters (筛选栏)
│   ├── SearchInput (搜索用户名/邮箱)
│   ├── RoleFilter (角色下拉筛选)
│   ├── StatusFilter (状态下拉筛选)
│   └── CreateUserButton
├── UserTable (用户列表表格)
│   ├── TableHeader (可点击排序)
│   ├── UserRow × N
│   │   ├── 用户名 + 头像
│   │   ├── 邮箱
│   │   ├── 角色标签 (带颜色)
│   │   ├── 状态标签
│   │   ├── 最后登录时间
│   │   └── 操作按钮组
│   └── Pagination
├── CreateUserDialog (创建用户弹窗)
├── EditUserDialog (编辑用户弹窗)
├── ResetPasswordDialog (重置密码弹窗)
├── LoginHistoryDrawer (登录历史抽屉)
└── ConfirmDialogs (确认弹窗: 删除/禁用/强制下线)
```

## 3. 统计卡片区

### 3.1 布局

6 个统计卡片横向排列（响应式：大屏 6 列，中屏 3 列，小屏 2 列）

### 3.2 卡片内容

| 卡片 | 数据源 | 颜色主题 |
|------|--------|----------|
| 总用户数 | stats.total_users | 蓝色 |
| 管理员 | stats.admin_count | 紫色 |
| 高级用户 | stats.premium_count | 金色 |
| 普通用户 | stats.regular_count | 灰色 |
| 已启用 | stats.active_count | 绿色 |
| 在线 | stats.online_count | 青色 |

### 3.3 数据加载

页面加载时调用 `GET /api/admin/users/stats` 获取统计数据。

## 4. 筛选与搜索

### 4.1 搜索框

- 防抖搜索（300ms 延迟）
- 支持按用户名或邮箱搜索
- 清空搜索恢复完整列表

### 4.2 角色筛选

下拉选项：全部 / 管理员 / 高级用户 / 普通用户
- admin 用户看不到"管理员"筛选选项（因为他们看不到管理员）
- root 用户可看到所有选项

### 4.3 状态筛选

下拉选项：全部 / 已启用 / 已禁用

### 4.4 筛选联动

多个筛选条件为 AND 关系，更改任一条件都重新请求列表并重置到第 1 页。

## 5. 用户列表表格

### 5.1 列定义

| 列 | 宽度 | 排序 | 说明 |
|----|------|------|------|
| 用户 | 自适应 | 按用户名 | 头像 + 用户名 + 邮箱（sub text） |
| 角色 | 100px | 否 | 彩色标签：Root(红) / Admin(紫) / Premium(金) / Regular(灰) |
| 状态 | 80px | 否 | 绿色"启用" / 红色"禁用" |
| 最后登录 | 150px | 按时间 | 相对时间格式（如"5分钟前"） |
| 创建时间 | 150px | 按时间 | 日期格式 |
| 操作 | 200px | 否 | 操作按钮/下拉菜单 |

### 5.2 操作按钮

根据当前用户角色和目标用户角色动态显示：

**root 用户可见操作（对所有用户）：**
- 编辑 / 重置密码 / 启用-禁用 / 查看登录历史 / 强制下线 / 删除

**admin 用户可见操作（仅对 regular/premium 用户）：**
- 编辑 / 重置密码 / 启用-禁用 / 查看登录历史 / 强制下线 / 删除

**对根用户行：** 不显示任何操作按钮（不可操作）

使用下拉菜单（DropdownMenu）承载操作项，避免按钮过多。

### 5.3 分页

- 底部分页栏：上一页 / 页码列表 / 下一页
- 显示"共 X 条，第 Y/Z 页"
- 每页数量可选：10 / 20 / 50

## 6. 创建用户弹窗

### 6.1 表单字段

| 字段 | 类型 | 必填 | 验证 |
|------|------|------|------|
| 用户名 | Input | 是 | 3-50字符，字母数字下划线 |
| 密码 | Input (password) | 是 | 6-100字符 |
| 确认密码 | Input (password) | 是 | 与密码一致 |
| 邮箱 | Input (email) | 否 | 邮箱格式 |
| 姓名 | Input | 否 | 无 |
| 角色 | Select | 是 | admin / premium / regular |

### 6.2 角色选择限制

- admin 用户创建时：角色选项仅显示 premium / regular
- root 用户创建时：角色选项显示 admin / premium / regular

### 6.3 提交行为

- 提交后关闭弹窗、刷新列表和统计
- 显示成功/错误通知

## 7. 编辑用户弹窗

### 7.1 可编辑字段

- 邮箱、姓名、角色（权限允许的范围内）
- 不显示密码字段（密码重置通过单独入口）
- 不显示用户名（创建后不可修改）

## 8. 重置密码弹窗

### 8.1 两种模式

- **自动生成**：点击"生成随机密码"按钮，调用 API 后显示临时密码供复制
- **手动设置**：输入新密码 + 确认密码

### 8.2 提示信息

重置后提示：用户将被强制登出，需要用新密码重新登录。

## 9. 登录历史抽屉

### 9.1 布局

从右侧滑出的抽屉面板，显示目标用户的登录历史记录。

### 9.2 内容

- 顶部显示用户信息（用户名、角色）
- 列表显示：登录时间、IP 地址、设备信息、结果（成功/失败）
- 失败记录用红色标注，显示失败原因
- 分页加载

## 10. 确认弹窗

### 10.1 删除确认

- 警告文案："确定要删除用户 {username} 吗？此操作不可恢复。"
- 需要输入用户名确认（防止误操作）

### 10.2 禁用确认

- 文案："确定要禁用用户 {username} 吗？该用户将无法登录。"
- 如果用户当前在线，额外提示："该用户当前在线，禁用后将被立即下线。"

### 10.3 强制下线确认

- 文案："确定要强制下线用户 {username} 吗？"

## 11. API 客户端

### 11.1 新建或扩展

在 `src/lib/api/` 中创建 `userManagement.ts`（或扩展现有客户端）：

```
getUserList(params: UserListParams): Promise<UserListResponse>
createUser(data: CreateUserData): Promise<User>
toggleUserStatus(userId: string): Promise<ToggleStatusResponse>
resetUserPassword(userId: string, data?: ResetPasswordData): Promise<ResetPasswordResponse>
getUserLoginHistory(userId: string, params: PaginationParams): Promise<LoginHistoryResponse>
forceLogout(userId: string): Promise<void>
deleteUser(userId: string): Promise<void>
getUserStats(): Promise<UserStatsResponse>
```

### 11.2 Token 附加

所有请求自动附加 `ecliptrix-session-token` 到请求头。

## 12. 国际化

所有 UI 文案需在 `src/lib/i18n.ts` 中添加中英文翻译条目。
