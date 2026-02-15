# 数据库配置指南

Ecliptrix 后端使用 PostgreSQL 作为主数据库，通过 SQLAlchemy 异步引擎管理连接。

## 安装 PostgreSQL

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### macOS (Homebrew)
```bash
brew install postgresql@16
brew services start postgresql@16
```

### Windows
从 [PostgreSQL 官网](https://www.postgresql.org/download/windows/) 下载安装包，按向导安装。

## 创建数据库和用户

```sql
-- 以 postgres 超级用户登录后执行
CREATE USER ecliptrix WITH PASSWORD 'ecliptrix';
CREATE DATABASE ecliptrix OWNER ecliptrix;
GRANT ALL PRIVILEGES ON DATABASE ecliptrix TO ecliptrix;
```

## 环境变量配置

在 `backend-services/basic-service/.env` 中设置：

```env
DATABASE_URL=postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix
```

支持的连接参数（通过环境变量覆盖）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `postgresql+asyncpg://ecliptrix:ecliptrix@localhost:5432/ecliptrix` | 数据库连接 URL |
| `DB_POOL_SIZE` | `10` | 连接池大小 |
| `DB_MAX_OVERFLOW` | `20` | 最大溢出连接数 |
| `DB_POOL_TIMEOUT` | `30` | 连接超时（秒） |
| `DB_POOL_RECYCLE` | `1800` | 连接回收时间（秒） |

## 表结构

应用启动时会自动创建以下表：

### users 表
用户信息和会话管理。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| username | VARCHAR(50) | 用户名（唯一索引） |
| email | VARCHAR(255) | 邮箱（唯一） |
| password_hash | VARCHAR(255) | bcrypt 密码哈希 |
| is_active | BOOLEAN | 是否激活 |
| is_admin | BOOLEAN | 是否管理员 |
| user_role | VARCHAR(20) | 角色：admin / regular / premium |
| active_session_token | VARCHAR(255) | 当前活跃会话令牌 |
| created_at / updated_at | TIMESTAMP | 时间戳 |

### agent_workflows 表
工作流配置存储。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| user_id | VARCHAR(36) | 用户 ID（索引） |
| workflow_name | VARCHAR(200) | 工作流名称 |
| workflow_data | JSON | 工作流配置数据 |
| is_template | BOOLEAN | 是否为模板 |

## 初始管理员

应用首次启动时会自动创建管理员账号，使用以下环境变量控制：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
```

## 测试数据库

测试使用 SQLite 内存数据库，无需额外配置：

```bash
pip install aiosqlite
pytest tests/ -v
```
