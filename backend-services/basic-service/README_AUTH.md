# 用户认证系统设置指南

## 概述

本项目已集成用户认证系统，支持用户登录、注册和管理功能。认证系统使用 Supabase 作为数据库，bcrypt 进行密码哈希，提供安全可靠的用户认证服务。

## 功能特性

- ✅ 用户登录认证
- ✅ 用户注册功能
- ✅ 密码安全哈希存储 (bcrypt)
- ✅ Supabase 数据库集成
- ✅ 完整的日志记录
- ✅ API 文档
- ✅ 健康检查端点

## 设置步骤

### 1. 环境变量配置

确保在 `.env` 文件中配置以下 Supabase 相关环境变量：

```env
# Supabase 配置
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_BUCKET=your-bucket-name
ENVIRONMENT=development

# 后端服务URL (前端需要)
BACKEND_URL=http://localhost:8000
```

### 2. 安装依赖

```bash
cd backend-services/basic-service
pip install -r requirements.txt
```

### 3. 创建数据库表

在 Supabase 控制台中执行以下 SQL 脚本：

```bash
# 在 Supabase SQL Editor 中执行
sql/create_users_table.sql
```

这将创建：
- `users` 表及其索引
- 自动更新时间戳的触发器
- 行级安全策略 (RLS)
- 默认管理员用户记录（需要后续初始化密码）

### 4. 初始化管理员用户

执行管理员用户初始化脚本：

```bash
cd backend-services/basic-service
python scripts/init_admin_user.py
```

该脚本将：
- 为默认管理员用户生成安全的密码哈希
- 更新数据库中的管理员用户记录
- 验证登录功能是否正常

### 5. 启动后端服务

```bash
cd backend-services/basic-service
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 6. 启动前端服务

```bash
# 在项目根目录
npm run dev
```

## 使用方法

### 默认管理员账户

- **用户名**: `admin`
- **密码**: `admin`
- **邮箱**: `admin@ecliptrix.com`

⚠️ **安全提醒**: 生产环境中请务必修改默认密码！

### 前端登录

1. 访问前端应用
2. 点击右上角的登录按钮
3. 输入用户名和密码
4. 成功登录后，用户头像将显示在右上角

### API 使用

#### 用户登录
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'
```

#### 用户注册
```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newuser",
    "email": "newuser@example.com",
    "password": "password123",
    "full_name": "New User"
  }'
```

#### 健康检查
```bash
curl http://localhost:8000/api/auth/health
```

## API 文档

详细的 API 文档请查看：
- 文档文件: `docs/apis/auth_api.md`
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## 数据库表结构

### users 表

| 字段名 | 类型 | 描述 |
|--------|------|------|
| id | UUID | 用户唯一标识符 (主键) |
| username | VARCHAR(50) | 用户名 (唯一) |
| email | VARCHAR(255) | 邮箱地址 (唯一) |
| password_hash | VARCHAR(255) | 密码哈希值 |
| full_name | VARCHAR(255) | 用户全名 |
| avatar_url | TEXT | 头像URL |
| is_active | BOOLEAN | 是否激活 |
| is_admin | BOOLEAN | 是否管理员 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |
| last_login_at | TIMESTAMP | 最后登录时间 |

## 安全特性

1. **密码哈希**: 使用 bcrypt 算法，加盐哈希存储密码
2. **输入验证**: 严格的参数验证，防止注入攻击
3. **行级安全**: Supabase RLS 策略保护用户数据
4. **日志安全**: 敏感信息不记录在日志中
5. **错误处理**: 统一错误处理，避免信息泄露

## 故障排除

### 常见问题

1. **环境变量未设置**
   ```
   错误: SUPABASE_URL environment variable is not set
   解决: 检查 .env 文件中的 SUPABASE_URL 配置
   ```

2. **数据库连接失败**
   ```
   错误: 认证服务不可用
   解决: 检查 Supabase URL 和密钥是否正确
   ```

3. **管理员用户不存在**
   ```
   错误: 用户名或密码错误
   解决: 运行 scripts/init_admin_user.py 初始化管理员用户
   ```

4. **bcrypt 模块未安装**
   ```
   错误: No module named 'bcrypt'
   解决: pip install bcrypt==4.0.1
   ```

### 日志查看

后端服务日志位置：
```
backend-services/basic-service/logs/
```

查看认证相关日志：
```bash
tail -f backend-services/basic-service/logs/app.log | grep -i auth
```

## 开发指南

### 添加新的认证功能

1. 在 `app/models/auth_models.py` 中添加新的数据模型
2. 在 `app/services/auth_service.py` 中实现业务逻辑
3. 在 `app/routers/auth_router.py` 中添加 API 端点
4. 更新 `docs/apis/auth_api.md` 文档

### 自定义密码策略

修改 `app/models/auth_models.py` 中的密码验证规则：

```python
password: str = Field(..., description="Password", min_length=8)  # 修改最小长度
```

### 扩展用户信息

1. 修改数据库表结构
2. 更新 `UserInfo` 模型
3. 修改认证服务中的用户创建和查询逻辑

## 生产部署注意事项

1. **修改默认密码**: 使用强密码替换默认的 admin/admin
2. **环境变量安全**: 使用安全的方式管理环境变量
3. **HTTPS**: 生产环境必须使用 HTTPS
4. **日志级别**: 设置适当的日志级别
5. **备份策略**: 定期备份用户数据
6. **监控**: 设置认证服务的监控和告警

## 更新日志

### v1.0.0 (当前版本)
- 初始版本发布
- 支持用户登录和注册
- 集成 Supabase 数据库
- 实现密码哈希和安全验证
- 完整的 API 文档
- 管理员用户初始化脚本 