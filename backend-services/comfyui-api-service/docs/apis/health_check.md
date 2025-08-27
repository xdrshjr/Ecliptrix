# ComfyUI Health Check API

## 概述

ComfyUI健康检查API提供了检测ComfyUI服务和后端API服务状态的功能。此接口用于确保AI图片生成服务的可用性，支持前端应用在使用AI生图功能之前验证服务状态。

## 端点信息

- **URL**: `/api/v1/health`
- **方法**: `GET`
- **认证**: 无需认证
- **超时**: 5秒

## 请求

### 请求示例

```bash
curl -X GET "http://localhost:8001/api/v1/health" \
  -H "Content-Type: application/json"
```

### 请求参数

此端点不需要任何参数。

## 响应

### 成功响应 (200 OK)

当ComfyUI服务和API服务都正常运行时返回：

```json
{
  "status": "healthy",
  "comfyui_status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0"
}
```

### 服务不可用响应 (503 Service Unavailable)

当ComfyUI服务不可用时返回：

```json
{
  "error": "Service unavailable",
  "detail": "Connection to ComfyUI failed"
}
```

### 响应字段说明

| 字段 | 类型 | 描述 |
|------|------|------|
| `status` | string | API服务整体状态：`healthy`, `unhealthy`, `error` |
| `comfyui_status` | string | ComfyUI服务状态：`healthy`, `unhealthy`, `error`, `timeout` |
| `timestamp` | string | 健康检查时间戳 (ISO 8601格式) |
| `version` | string | API服务版本号 |
| `error` | string | 错误信息（仅在出错时返回） |
| `detail` | string | 详细错误描述（仅在出错时返回） |

## 状态码

| 状态码 | 描述 |
|--------|------|
| 200 | 健康检查成功，服务正常 |
| 503 | 服务不可用 |
| 504 | 网关超时（健康检查超时） |
| 500 | 内部服务器错误 |

## 使用场景

### 1. 前端应用启动时检查

```javascript
// 在Video Editing界面加载时检查ComfyUI服务状态
const checkComfyUIHealth = async () => {
  try {
    const response = await fetch('/api/comfyui-health-check');
    const healthStatus = await response.json();
    
    if (healthStatus.status === 'healthy' && healthStatus.comfyui_status === 'healthy') {
      // 启用AI生图功能
      enableAIImageGeneration();
    } else {
      // 禁用AI生图功能，显示提示
      disableAIImageGeneration('AI生图服务不可用，请联系管理员');
    }
  } catch (error) {
    // 处理网络错误
    disableAIImageGeneration('无法连接到AI生图服务');
  }
};
```

### 2. 定期健康检查

```javascript
// 每5分钟检查一次服务状态
setInterval(checkComfyUIHealth, 5 * 60 * 1000);
```

### 3. 用户操作前验证

```javascript
// 在用户点击AI生图按钮时验证服务状态
const handleAIImageGeneration = async () => {
  const healthCheck = await checkComfyUIHealth();
  if (!healthCheck.isAvailable) {
    showError('AI生图服务当前不可用，请稍后重试');
    return;
  }
  
  // 继续AI生图流程
  openAIImageGenerationModal();
};
```

## 错误处理

### 常见错误场景

1. **ComfyUI服务未启动**
   - 状态码: 503
   - 建议: 检查ComfyUI服务是否正常运行

2. **网络连接问题**
   - 状态码: 504
   - 建议: 检查网络连接和防火墙设置

3. **服务配置错误**
   - 状态码: 500
   - 建议: 检查环境变量配置和服务配置

### 错误恢复策略

1. **自动重试**: 对于临时网络问题，可以实现指数退避重试机制
2. **降级处理**: 当服务不可用时，隐藏相关功能并提供用户友好的提示
3. **监控告警**: 在生产环境中设置监控，当健康检查失败时发送告警

## 集成示例

### React Hook集成

```typescript
import { useState, useEffect } from 'react';

interface HealthStatus {
  status: string;
  comfyui_status: string;
  timestamp: string;
  version?: string;
  error?: string;
}

export const useComfyUIHealth = () => {
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [isServiceAvailable, setIsServiceAvailable] = useState(false);
  
  const checkHealth = async () => {
    try {
      const response = await fetch('/api/comfyui-health-check');
      const status = await response.json();
      setHealthStatus(status);
      setIsServiceAvailable(
        status.status === 'healthy' && status.comfyui_status === 'healthy'
      );
    } catch (error) {
      setIsServiceAvailable(false);
    }
  };
  
  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 5 * 60 * 1000); // 每5分钟检查一次
    return () => clearInterval(interval);
  }, []);
  
  return { healthStatus, isServiceAvailable, checkHealth };
};
```

## 最佳实践

1. **缓存结果**: 避免频繁的健康检查请求，建议缓存结果5分钟
2. **超时设置**: 设置合理的请求超时时间（建议5秒）
3. **用户体验**: 在服务不可用时提供清晰的错误提示和可能的解决方案
4. **监控日志**: 记录健康检查结果用于问题排查和性能监控

## 相关文档

- [ComfyUI API服务总览](./comfyui_api.md)
- [AI图片生成接口](./image_generation.md)
- [错误处理指南](./error_handling.md) 