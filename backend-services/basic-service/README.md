# Basic Service

一个基于 FastAPI 的基础后台服务，提供完整的日志记录、配置管理和 API 功能。

## 功能特性

- ✅ FastAPI 框架，支持异步操作
- ✅ 完整的日志记录系统（控制台 + 文件）
- ✅ 环境变量配置管理
- ✅ 统一的 API 响应格式
- ✅ 全面的错误处理
- ✅ CORS 支持
- ✅ 自动 API 文档生成
- ✅ 完整的测试套件
- ✅ 请求/响应中间件
- ✅ 健康检查端点

## 项目结构

```
backend-services/basic-service/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 应用入口
│   ├── config.py            # 配置管理
│   ├── logger.py            # 日志配置
│   ├── models/              # 数据模型
│   │   ├── __init__.py
│   │   └── base_models.py
│   ├── routers/             # API 路由
│   │   ├── __init__.py
│   │   └── api_router.py
│   └── services/            # 业务逻辑服务
│       └── __init__.py
├── tests/                   # 测试文件
│   ├── __init__.py
│   ├── conftest.py
│   └── test_main.py
├── docs/                    # 文档目录
│   └── api_documentation.md # 接口文档说明
├── logs/                    # 日志文件目录（运行时创建）
├── requirements.txt         # Python 依赖
├── .env                     # 环境变量配置
├── .env.example             # 环境变量示例
└── README.md                # 项目说明文档
```

## 快速开始

### 1. 安装依赖

```bash
cd backend-services/basic-service
pip install -r requirements.txt
```

### 2. 配置环境变量

复制环境变量模板并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置必要的环境变量：

```env
# LLM Configuration
LLM_API_KEY=your_actual_api_key_here
LLM_API_URL=https://api.openai.com/v1

# Logging Configuration
LOG_LEVEL=INFO

# Server Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=false
```

### 3. 运行服务

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

服务启动后，可以访问：

- API 根路径: http://localhost:8000/
- 健康检查: http://localhost:8000/health
- API 文档 (Swagger): http://localhost:8000/docs
- API 文档 (ReDoc): http://localhost:8000/redoc

## 环境变量配置

| 变量名 | 描述 | 默认值 | 必需 |
|--------|------|--------|------|
| `LLM_API_KEY` | LLM 服务 API 密钥 | - | 是 |
| `LLM_API_URL` | LLM 服务 API 地址 | - | 是 |
| `LOG_LEVEL` | 日志记录级别 (DEBUG/INFO/WARNING/ERROR/CRITICAL) | INFO | 否 |
| `HOST` | 服务器主机地址 | 0.0.0.0 | 否 |
| `PORT` | 服务器端口 | 8000 | 否 |
| `DEBUG` | 调试模式 | false | 否 |

## 日志系统

服务实现了详细的日志记录功能：

- **控制台日志**: 彩色格式化输出，便于开发调试
- **文件日志**: 保存到 `logs/app.log`，包含详细的上下文信息
- **日志级别**: 通过 `LOG_LEVEL` 环境变量配置
- **日志格式**: 包含时间戳、模块名、级别、函数名、行号等信息

### 日志级别说明

- `DEBUG`: 详细的调试信息，包括请求头、配置信息等
- `INFO`: 一般信息，如请求日志、服务启动信息等
- `WARNING`: 警告信息，如配置缺失等
- `ERROR`: 错误信息，如请求失败、异常等
- `CRITICAL`: 严重错误，可能导致服务不可用

## API 接口

### 主要端点

- `GET /`: 获取 API 基本信息
- `GET /health`: 健康检查，返回服务状态和运行时间
- `GET /config`: 获取非敏感配置信息

### 详细接口文档

**📖 完整的接口文档说明请查看: [docs/api_documentation.md](docs/api_documentation.md)**

该文档包含：
- 详细的 API 端点说明
- 请求/响应示例
- 错误处理说明
- 环境变量配置
- 部署建议

## 测试

### 运行测试

```bash
# 运行所有测试
pytest tests/ -v

# 运行特定测试文件
pytest tests/test_main.py -v

# 运行测试并生成覆盖率报告
pytest tests/ --cov=app --cov-report=html
```

### 测试覆盖

测试套件包含：
- API 端点测试
- 错误处理测试
- 响应模型验证测试
- CORS 配置测试
- 中间件功能测试

## 开发指南

### 添加新的 API 端点

1. 在 `app/routers/` 目录下创建新的路由文件
2. 在 `app/models/` 目录下定义相应的数据模型
3. 在 `app/main.py` 中注册新的路由
4. 添加相应的测试用例

### 添加新的业务逻辑

1. 在 `app/services/` 目录下创建服务文件
2. 实现业务逻辑函数
3. 在路由中调用服务函数
4. 添加相应的测试用例

### 代码规范

- 遵循 PEP 8 Python 代码规范
- 使用类型注解
- 编写详细的文档字符串
- 实现适当的错误处理
- 添加详细的日志记录

## 生产部署

### 使用 Docker

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 使用 Gunicorn

```bash
pip install gunicorn
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

## 故障排除

### 常见问题

1. **服务无法启动**
   - 检查环境变量配置
   - 确认端口未被占用
   - 查看日志文件获取详细错误信息

2. **API 请求失败**
   - 检查服务状态（访问 `/health` 端点）
   - 查看日志文件中的错误信息
   - 确认请求格式正确

3. **日志文件过大**
   - 配置日志轮转
   - 调整日志级别
   - 定期清理旧日志文件

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。

## 更新日志

### v1.0.0
- 初始版本发布
- 基础 API 功能
- 完整的日志系统
- 环境变量配置
- 测试套件
- API 文档 