# Workflow Preferences API

## 概述

Workflow Preferences API 用于保存和加载用户在 Video Editing 任务中工作流配置弹窗的展开/折叠状态。这使得用户的界面状态可以持久化，并在下次打开时恢复。

## 特性

- ✅ 用户特定的工作流偏好设置
- ✅ 保存工作流的展开/折叠状态
- ✅ 保存工作流的工具描述
- ✅ 自动加载用户的已保存状态
- ✅ 详细的日志记录
- ✅ 错误处理和验证

## API 端点

### 1. 保存工作流偏好设置

保存用户的工作流偏好设置（展开/折叠状态）。

**端点：** `POST /api/workflow-preferences/save`

**请求体：**

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "preferences": {
    "workflow-123": {
      "workflow_id": "workflow-123",
      "workflow_name": "Image Generation",
      "is_expanded": true,
      "tool_description": "Generate images using AI models"
    },
    "workflow-456": {
      "workflow_id": "workflow-456",
      "workflow_name": "Video Processing",
      "is_expanded": false,
      "tool_description": "Process videos with AI"
    }
  }
}
```

**响应：**

成功响应 (200 OK):
```json
{
  "success": true,
  "message": "工作流偏好设置保存成功",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "saved_count": 2
}
```

失败响应 (400 Bad Request):
```json
{
  "success": false,
  "message": "偏好设置不能为空"
}
```

**Next.js 代理端点：** `POST /api/workflow-preferences/save`

**Next.js 请求体：**

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "preferences": {
    "workflow-123": {
      "workflow_id": "workflow-123",
      "workflow_name": "Image Generation",
      "is_expanded": true,
      "tool_description": "Generate images using AI models"
    }
  }
}
```

### 2. 加载工作流偏好设置

加载用户的工作流偏好设置。

**端点：** `POST /api/workflow-preferences/load`

**请求体：**

```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**响应：**

成功响应 (200 OK):
```json
{
  "success": true,
  "message": "工作流偏好设置加载成功",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "preferences": {
    "workflow-123": {
      "workflow_id": "workflow-123",
      "workflow_name": "Image Generation",
      "is_expanded": true,
      "tool_description": "Generate images using AI models"
    }
  }
}
```

首次加载（无数据）响应 (200 OK):
```json
{
  "success": true,
  "message": "未找到已保存的偏好设置",
  "timestamp": "2023-12-01T12:00:00.000Z",
  "preferences": {}
}
```

**Next.js 代理端点：** `POST /api/workflow-preferences/load`

**Next.js 请求体：**

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 3. 清除工作流偏好设置

清除用户的工作流偏好设置。

**端点：** `DELETE /api/workflow-preferences/clear?user_id=550e8400-e29b-41d4-a716-446655440000`

**响应：**

成功响应 (200 OK):
```json
{
  "success": true,
  "message": "工作流偏好设置清除成功",
  "timestamp": "2023-12-01T12:00:00.000Z"
}
```

## 数据模型

### WorkflowPreference

单个工作流的偏好设置：

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| workflow_id | string | 是 | 工作流ID |
| workflow_name | string | 是 | 工作流名称 |
| is_expanded | boolean | 是 | 工作流是否展开（启用状态） |
| tool_description | string | 否 | 工具描述 |

## 使用示例

### Frontend (TypeScript/React)

```typescript
import { useAuth } from '@/contexts/AuthContext';

// 保存工作流偏好设置
const saveWorkflowPreferences = async (configs: Map<string, WorkflowConfig>) => {
  const response = await fetch('/api/workflow-preferences/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: user.id,
      preferences: Object.fromEntries(
        Array.from(configs.entries()).map(([id, config]) => [
          id,
          {
            workflow_id: config.workflowId,
            workflow_name: config.workflowName,
            is_expanded: config.enabled,
            tool_description: config.toolDescription
          }
        ])
      )
    }),
  });

  const result = await response.json();
  return result;
};

// 加载工作流偏好设置
const loadWorkflowPreferences = async () => {
  const response = await fetch('/api/workflow-preferences/load', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: user.id
    }),
  });

  const result = await response.json();
  return result.preferences;
};
```

### Backend (Python)

```python
from app.services.workflow_preferences_service import WorkflowPreferencesService
from app.models.workflow_preferences_models import WorkflowPreference

# 初始化服务
service = WorkflowPreferencesService()

# 保存偏好设置
preferences = {
    "workflow-123": WorkflowPreference(
        workflow_id="workflow-123",
        workflow_name="Image Generation",
        is_expanded=True,
        tool_description="Generate images using AI models"
    )
}

result = await service.save_preferences(
    user_id="550e8400-e29b-41d4-a716-446655440000",
    preferences=preferences
)

# 加载偏好设置
result = await service.load_preferences(
    user_id="550e8400-e29b-41d4-a716-446655440000"
)
preferences = result["preferences"]
```

## 架构说明

### 数据流

1. **用户操作** → 前端 WorkflowConfigModal 组件
2. **前端** → Next.js API Route (`/api/workflow-preferences/save` 或 `/api/workflow-preferences/load`)
3. **Next.js** → Python FastAPI Backend (`/api/workflow-preferences/save` 或 `/api/workflow-preferences/load`)
4. **Python Backend** → WorkflowPreferencesService → 内存存储（生产环境应使用数据库）
5. **响应** → 沿原路返回

### 存储机制

当前实现使用**内存存储**（字典）：

```python
self._preferences_store: Dict[str, Dict[str, WorkflowPreference]] = {}
```

**生产环境建议：**

- 使用数据库（PostgreSQL、MySQL、MongoDB 等）
- 添加缓存层（Redis）
- 实现数据持久化
- 添加数据备份机制

## 日志记录

所有操作都会记录详细的日志：

### 保存操作日志

```
[INFO] 开始保存工作流偏好设置 | user_id: 550e8400... | preferences_count: 2
[INFO] 工作流偏好设置保存成功 | user_id: 550e8400... | saved_count: 2 | expanded_workflows: ['workflow-123']
```

### 加载操作日志

```
[INFO] 开始加载工作流偏好设置 | user_id: 550e8400...
[INFO] 工作流偏好设置加载成功 | user_id: 550e8400... | preferences_count: 2 | expanded_count: 1
```

## 错误处理

### 常见错误

1. **用户ID缺失**
   - 状态码: 400
   - 消息: "User ID is required"

2. **无效的偏好设置数据**
   - 状态码: 400
   - 消息: "偏好设置不能为空"

3. **服务器内部错误**
   - 状态码: 500
   - 消息: "Internal server error"

## 性能考虑

- ✅ 偏好设置加载失败不会阻塞界面
- ✅ 保存操作异步执行
- ✅ 使用内存存储，响应速度快
- ⚠️ 需要在生产环境中替换为数据库存储

## 安全性

- ✅ 用户只能访问自己的偏好设置
- ✅ 输入验证（用户ID、偏好设置格式）
- ✅ 错误不会泄露敏感信息
- ⚠️ 生产环境需要添加身份验证和授权

## 未来改进

1. 添加数据库持久化
2. 实现偏好设置版本控制
3. 添加偏好设置导入/导出功能
4. 支持多设备同步
5. 添加偏好设置历史记录
6. 实现偏好设置共享（团队协作）

## 相关文件

### Backend (Python)

- `backend-services/basic-service/app/models/workflow_preferences_models.py` - 数据模型
- `backend-services/basic-service/app/services/workflow_preferences_service.py` - 业务逻辑
- `backend-services/basic-service/app/routers/workflow_preferences_router.py` - API 路由

### Frontend (Next.js/React)

- `src/app/api/workflow-preferences/save/route.ts` - Next.js API 保存路由
- `src/app/api/workflow-preferences/load/route.ts` - Next.js API 加载路由
- `src/components/video/components/WorkflowConfigModal/WorkflowConfigModal.tsx` - UI 组件

## 版本历史

- **v1.0.0** (2024-01-XX) - 初始版本
  - 基础的保存/加载功能
  - 内存存储实现
  - Next.js 代理路由
  - 详细日志记录

