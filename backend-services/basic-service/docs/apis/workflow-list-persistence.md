# Workflow List Persistence API

## 概述

此 API 实现了工作流列表的持久化功能，允许用户创建、保存、加载和删除工作流。当用户新建或删除工作流后，系统会自动保存当前的工作流列表状态，下次进入时自动加载上次保存的状态。

## API 端点

### 1. 保存工作流

**端点**: `POST /api/workflow/agent/save`

**描述**: 保存或更新一个工作流到数据库。新建工作流后会自动调用此接口进行保存。

**请求参数**:

```json
{
  "user_id": "string",
  "workflow_id": "string",
  "workflow_name": "string",
  "workflow_description": "string (optional)",
  "nodes": [
    {
      "id": "string",
      "type": "string",
      "position": { "x": number, "y": number },
      "data": "object"
    }
  ],
  "connections": [
    {
      "id": "string",
      "source": "string",
      "target": "string",
      "sourceHandle": "string",
      "targetHandle": "string"
    }
  ]
}
```

**响应**:

```json
{
  "success": true,
  "message": "Workflow saved successfully",
  "data": {
    "id": "string",
    "user_id": "string",
    "workflow_id": "string",
    "workflow_name": "string",
    "workflow_description": "string",
    "nodes": [],
    "connections": [],
    "is_active": true,
    "is_template": false,
    "version": 1,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "last_executed_at": null
  }
}
```

**日志记录**:
- 保存前记录工作流ID、名称、节点数、连接数
- 保存成功后记录工作流ID和版本号
- 保存失败时记录错误信息

---

### 2. 加载工作流列表

**端点**: `GET /api/workflow/agent/load/{user_id}`

**描述**: 加载指定用户的所有工作流。用户登录后会自动调用此接口加载工作流列表。

**请求参数**:
- `user_id` (路径参数): 用户ID

**响应**:

```json
{
  "success": true,
  "message": "Successfully loaded 3 workflows",
  "data": [
    {
      "id": "string",
      "user_id": "string",
      "workflow_id": "string",
      "workflow_name": "string",
      "workflow_description": "string",
      "nodes": [],
      "connections": [],
      "is_active": true,
      "is_template": false,
      "version": 1,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "last_executed_at": null
    }
  ]
}
```

**日志记录**:
- 加载前记录用户ID
- 加载成功后记录工作流数量
- 加载失败时记录错误信息

---

### 3. 删除工作流

**端点**: `DELETE /api/workflow/agent/delete/{user_id}/{workflow_id}`

**描述**: 删除指定的工作流。删除工作流后，系统会自动更新本地状态并切换到另一个工作流。

**请求参数**:
- `user_id` (路径参数): 用户ID
- `workflow_id` (路径参数): 工作流ID

**响应**:

```json
{
  "success": true,
  "message": "Workflow deleted successfully",
  "data": {
    "workflow_id": "string"
  }
}
```

**错误响应**:

```json
{
  "success": false,
  "message": "Workflow not found",
  "error_code": "NOT_FOUND"
}
```

**日志记录**:
- 删除前记录用户ID和工作流ID
- 删除成功后记录工作流ID
- 删除失败时记录错误信息和错误类型

---

## 功能流程

### 新建工作流流程

1. 用户点击"新建工作流"按钮
2. 前端生成唯一的工作流ID (`workflow-{timestamp}`)
3. 创建默认工作流对象（名称: "New Workflow", 空节点和连接）
4. 更新本地状态，设置为当前活动工作流
5. **自动调用 `POST /api/workflow/agent/save` 保存到数据库**
6. 显示成功提示信息

**关键代码位置**: `src/components/workflow/WorkflowInterface.tsx` - `handleAddWorkflow`

**日志示例**:
```
[WorkflowInterface] Adding new workflow: { workflowId: 'workflow-1234567890', workflowName: 'New Workflow' }
[WorkflowInterface] Auto-saving new workflow to database
[WorkflowInterface] New workflow auto-saved successfully: { workflow_id: 'workflow-1234567890', version: 1 }
```

---

### 重命名工作流流程

1. 用户点击工作流右侧的编辑按钮（铅笔图标）或双击工作流名称
2. 进入编辑模式，显示输入框
3. 用户输入新名称后按 Enter 或点击外部区域
4. 验证用户身份和权限
5. 更新本地状态中的工作流名称
6. **自动调用 `POST /api/workflow/agent/save` 保存到数据库**
7. 显示成功提示信息

**关键代码位置**: 
- `src/components/workflow/WorkflowInterface.tsx` - `handleRenameWorkflow`
- `src/components/workflow/WorkflowSidebar.tsx` - 编辑按钮和输入框

**交互方式**:
- **方式一**: 点击工作流右侧的编辑图标（铅笔）
- **方式二**: 双击工作流名称

**日志示例**:
```
[WorkflowSidebar] Edit button clicked for workflow: { workflowId: 'workflow-1234567890' }
[WorkflowInterface] Renaming workflow: { workflowId: 'workflow-1234567890', newName: 'My Custom Workflow' }
[WorkflowInterface] Workflow renamed successfully in local state
[WorkflowInterface] Auto-saving renamed workflow to database: { old_name: 'New Workflow', new_name: 'My Custom Workflow' }
[WorkflowInterface] Renamed workflow auto-saved successfully: { workflow_id: 'workflow-1234567890', version: 2 }
```

---

### 删除工作流流程

1. 用户点击工作流旁的删除按钮
2. 显示确认对话框（两步确认：点击删除图标 → 点击确认按钮）
3. 验证用户身份和权限
4. 检查是否为最后一个工作流（不允许删除最后一个）
5. **调用 `DELETE /api/workflow/agent/delete/{user_id}/{workflow_id}` 从数据库删除**
6. 从本地状态中移除该工作流
7. 如果删除的是当前活动工作流，自动切换到第一个剩余工作流
8. 显示成功提示信息

**关键代码位置**: `src/components/workflow/WorkflowInterface.tsx` - `handleDeleteWorkflow`

**日志示例**:
```
[WorkflowSidebar] Delete button clicked for workflow: { workflowId: 'workflow-1234567890' }
[WorkflowSidebar] Delete confirmed for workflow: { workflowId: 'workflow-1234567890' }
[WorkflowInterface] Deleting workflow: { workflowId: 'workflow-1234567890', workflowName: 'My Workflow' }
[WorkflowInterface] Workflow deleted from backend successfully
[WorkflowInterface] Active workflow was deleted, switching to: { newActiveWorkflowId: 'workflow-0987654321' }
[WorkflowInterface] Workflow deleted successfully: { workflowId: 'workflow-1234567890', remainingWorkflows: 2 }
```

---

### 自动加载工作流流程

1. 用户登录成功
2. 进入 Workflow 任务界面
3. `WorkflowInterface` 组件挂载，检测用户认证状态
4. **自动调用 `GET /api/workflow/agent/load/{user_id}` 加载工作流列表**
5. 如果有保存的工作流，加载并设置第一个为活动工作流
6. 如果没有保存的工作流，初始化默认工作流
7. 显示加载成功提示信息

**关键代码位置**: `src/components/workflow/WorkflowInterface.tsx` - `useEffect` (line 70-145)

**日志示例**:
```
[WorkflowInterface] User authenticated, loading workflows for user: user123
[WorkflowInterface] Loading workflows for user: user123
[Workflow API] Loading agent workflows for user: user123
[Workflow Agent Load API] Workflows loaded successfully: { user_id: 'user123', count: 3 }
[WorkflowInterface] Loaded workflows: 3
[WorkflowInterface] Setting loaded workflows as content
```

---

## 前端实现

### WorkflowInterface 组件

**文件**: `src/components/workflow/WorkflowInterface.tsx`

**主要功能**:
- 管理工作流列表状态
- 处理工作流的创建、删除、重命名
- 自动加载和保存工作流
- 与后端 API 交互

**关键方法**:
- `handleAddWorkflow`: 新建工作流并自动保存
- `handleDeleteWorkflow`: 删除工作流
- `handleRenameWorkflow`: 重命名工作流
- `handleSaveWorkflow`: 手动保存当前工作流

---

### WorkflowSidebar 组件

**文件**: `src/components/workflow/WorkflowSidebar.tsx`

**主要功能**:
- 显示工作流列表
- 提供新建、重命名、删除工作流的 UI
- 工作流选择和活动状态显示

**UI 特性**:
- **新建按钮**：右上角 "+" 图标
- **重命名功能**：
  - 点击工作流右侧的编辑图标（铅笔）进入编辑模式
  - 或双击工作流名称进入编辑模式
  - 输入新名称后按 Enter 或点击外部确认
  - 按 Escape 取消编辑
  - 编辑后自动保存到数据库
- **删除功能**：每个工作流右侧的删除图标（需要二次确认）
- **删除限制**：当只剩一个工作流时，删除按钮不显示
- **操作按钮**：编辑和删除按钮在 hover 时高亮显示

---

## 后端实现

### FastAPI 路由

**文件**: `backend-services/basic-service/app/routers/workflow_router.py`

**端点实现**:
- `POST /workflow/agent/save`: 保存工作流 (line 360-414)
- `GET /workflow/agent/load/{user_id}`: 加载工作流列表 (line 417-466)
- `DELETE /workflow/agent/delete/{user_id}/{workflow_id}`: 删除工作流 (line 469-530)

**服务层**:
- `agent_workflow_service`: 处理工作流的数据库操作

---

## Next.js API 代理

### API 路由

**文件**: `src/app/api/workflow/agent/`

**代理端点**:
- `save/route.ts`: 代理保存请求到 FastAPI 后端
- `load/[userId]/route.ts`: 代理加载请求到 FastAPI 后端
- `delete/[userId]/[workflowId]/route.ts`: 代理删除请求到 FastAPI 后端

**功能**:
- 转发前端请求到 FastAPI 后端
- 添加超时控制（30秒）
- 错误处理和日志记录
- CORS 头设置

---

## API 客户端

**文件**: `src/lib/api/workflow.ts`

**导出函数**:
- `saveAgentWorkflow(request)`: 保存工作流
- `loadAgentWorkflows(userId)`: 加载工作流列表
- `deleteAgentWorkflow(userId, workflowId)`: 删除工作流

**特性**:
- 统一的错误处理
- 详细的日志记录
- TypeScript 类型支持

---

## 安全考虑

1. **身份验证**: 所有操作都需要用户登录
2. **权限检查**: 只能操作自己的工作流
3. **数据验证**: 后端验证所有输入参数
4. **防止误删**: 
   - 不允许删除最后一个工作流
   - 删除需要二次确认

---

## 错误处理

### 前端错误处理
- 网络错误：显示错误提示，建议重试
- 认证错误：提示用户登录
- 数据验证错误：显示具体错误信息

### 后端错误处理
- 工作流不存在：返回 404 状态码
- 数据库错误：返回 500 状态码，记录详细错误日志
- 参数错误：返回 400 状态码，说明错误原因

---

## 日志规范

### 日志级别
- **INFO**: 正常操作（创建、加载、删除、保存）
- **WARNING**: 非预期情况（删除最后一个工作流、未登录操作）
- **ERROR**: 操作失败（API 调用失败、数据库错误）

### 日志格式
```typescript
console.log('[ComponentName] Action description:', {
  key1: value1,
  key2: value2,
  timestamp: new Date().toISOString()
});
```

### 日志内容
- 操作类型和对象ID
- 操作前后的状态
- 错误信息（如果有）
- 时间戳

---

## 测试建议

### 功能测试
1. **新建工作流**
   - 点击新建按钮
   - 验证工作流是否添加到列表
   - 验证是否自动保存到数据库
   - 验证成功提示信息

2. **重命名工作流**
   - 点击编辑按钮（铅笔图标）
   - 输入新名称并确认
   - 验证名称是否更新
   - 验证是否自动保存到数据库
   - 验证成功提示信息
   - 测试双击名称进入编辑模式
   - 测试按 Escape 取消编辑

3. **删除工作流**
   - 点击删除按钮
   - 验证二次确认流程
   - 验证工作流是否从列表和数据库中删除
   - 验证活动工作流自动切换
   - 验证最后一个工作流不能删除

4. **自动加载**
   - 创建多个工作流
   - 刷新页面或重新登录
   - 验证所有工作流是否正确加载
   - 验证活动工作流是否正确设置

### 边界测试
- 只有一个工作流时的删除操作
- 网络断开时的操作
- 同时在多个标签页操作
- 大量工作流的性能测试

---

## 相关文件

### 前端
- `src/components/workflow/WorkflowInterface.tsx`
- `src/components/workflow/WorkflowSidebar.tsx`
- `src/lib/api/workflow.ts`
- `src/app/api/workflow/agent/save/route.ts`
- `src/app/api/workflow/agent/load/[userId]/route.ts`
- `src/app/api/workflow/agent/delete/[userId]/[workflowId]/route.ts`

### 后端
- `backend-services/basic-service/app/routers/workflow_router.py`
- `backend-services/basic-service/app/services/agent_workflow_service.py`
- `backend-services/basic-service/app/models/workflow_models.py`

---

## 版本历史

- **v1.0** (2024-10-24): 初始版本，实现工作流列表持久化功能
  - 新建工作流自动保存
  - 删除工作流功能
  - 自动加载工作流列表
  - 详细日志记录

