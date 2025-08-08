# Basic Service API 接口文档

## 概述

Basic Service 是一个基于 FastAPI 的后台服务，提供基础的 API 功能，包括健康检查、配置管理和详细的日志记录。

## 基础信息

- **服务名称**: Basic Service API
- **版本**: 1.0.0
- **基础URL**: `http://localhost:8000`
- **文档URL**: `http://localhost:8000/docs` (Swagger UI)
- **ReDoc URL**: `http://localhost:8000/redoc`

## 认证

目前该服务不需要认证，但在生产环境中建议添加适当的认证机制。

## 通用响应格式

所有 API 响应都遵循统一的格式：

```json
{
  "success": boolean,
  "message": string,
  "timestamp": string (ISO 8601),
  "data": object | null
}
```

### 错误响应格式

错误响应包含额外的错误信息：

```json
{
  "success": false,
  "message": string,
  "timestamp": string (ISO 8601),
  "error_code": string,
  "error_details": object | null
}
```

## API 端点

### 1. 根端点

获取 API 基本信息。

**端点**: `GET /`

**响应示例**:
```json
{
  "success": true,
  "message": "Basic Service API is running",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "data": {
    "name": "Basic Service API",
    "version": "1.0.0",
    "description": "Basic Service FastAPI Application",
    "endpoints": {
      "health": "/health",
      "docs": "/docs",
      "redoc": "/redoc"
    }
  }
}
```

### 2. 健康检查

检查服务健康状态和运行时间。

**端点**: `GET /health`

**响应示例**:
```json
{
  "success": true,
  "message": "Service is healthy",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "service_name": "Basic Service API",
  "version": "1.0.0",
  "status": "healthy",
  "uptime": "0:05:30"
}
```

### 3. 配置信息

获取非敏感的配置信息。

**端点**: `GET /config`

**响应示例**:
```json
{
  "success": true,
  "message": "Configuration retrieved successfully",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "data": {
    "app_name": "Basic Service API",
    "app_version": "1.0.0",
    "log_level": "INFO",
    "debug": false,
    "llm_api_url": "https://api.openai.com/v1",
    "host": "0.0.0.0",
    "port": 8000
  }
}
```

**注意**: 敏感信息如 API 密钥不会在此端点中暴露。

## HTTP 状态码

- `200 OK`: 请求成功
- `404 Not Found`: 端点不存在
- `405 Method Not Allowed`: HTTP 方法不被允许
- `500 Internal Server Error`: 服务器内部错误

## 响应头

所有响应都包含以下自定义头：

- `X-Process-Time`: 请求处理时间（秒）

## CORS 配置

该服务配置了 CORS 中间件，允许跨域请求。在生产环境中，建议限制允许的源。

## 日志记录

服务包含详细的日志记录功能：

- **控制台日志**: 带颜色的格式化输出
- **文件日志**: 保存到 `logs/app.log`
- **日志级别**: 可通过环境变量 `LOG_LEVEL` 配置

### 日志级别

- `DEBUG`: 详细的调试信息
- `INFO`: 一般信息（默认）
- `WARNING`: 警告信息
- `ERROR`: 错误信息
- `CRITICAL`: 严重错误

## 环境变量配置

服务通过以下环境变量进行配置：

| 变量名 | 描述 | 默认值 | 必需 |
|--------|------|--------|------|
| `LLM_API_KEY` | LLM 服务 API 密钥 | - | 是 |
| `LLM_API_URL` | LLM 服务 API 地址 | - | 是 |
| `LOG_LEVEL` | 日志记录级别 | INFO | 否 |
| `HOST` | 服务器主机地址 | 0.0.0.0 | 否 |
| `PORT` | 服务器端口 | 8000 | 否 |
| `DEBUG` | 调试模式 | false | 否 |

## 错误处理

服务实现了全面的错误处理机制：

1. **HTTP 异常处理**: 标准化 HTTP 错误响应
2. **通用异常处理**: 捕获未处理的异常
3. **请求日志**: 记录所有请求和响应
4. **错误日志**: 详细记录错误信息和堆栈跟踪

## 性能监控

- 每个请求都会记录处理时间
- 处理时间通过 `X-Process-Time` 响应头返回
- 所有请求和响应都会被记录到日志中

## 开发和测试

### 运行服务

```bash
cd backend-services/basic-service
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 运行测试

```bash
pytest tests/ -v
```

### 查看 API 文档

启动服务后，访问以下 URL：

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- OpenAPI JSON: http://localhost:8000/openapi.json

## 扩展说明

该服务设计为可扩展的基础框架，可以轻松添加新的功能模块：

1. **新的 API 路由**: 在 `app/routers/` 目录下添加新的路由文件
2. **业务逻辑服务**: 在 `app/services/` 目录下添加业务逻辑
3. **数据模型**: 在 `app/models/` 目录下添加新的 Pydantic 模型
4. **中间件**: 在 `app/main.py` 中添加新的中间件

## 生产部署建议

1. **安全性**: 
   - 配置适当的 CORS 源
   - 添加认证和授权机制
   - 使用 HTTPS

2. **性能**:
   - 配置适当的工作进程数量
   - 使用反向代理（如 Nginx）
   - 实现缓存策略

3. **监控**:
   - 集成应用性能监控（APM）
   - 配置日志聚合
   - 设置健康检查和告警 