# Video Export Node API

## 概述

Video Export Node（视频导出节点）用于将工作流中的视频 URL 转换为素材管理格式，以便在 Video Editing 任务中使用。该节点执行完成后，会在聊天界面显示"导出剪辑"按钮，用户点击后可将视频素材导入到 Video Editing 的素材管理面板。

## API 端点

### 导出视频到素材格式

**端点**: `/api/workflow/video-export`

**方法**: `POST`

**描述**: 将视频 URL(s) 转换为 Materials Management 格式，并返回可以直接导入的素材数据。

#### 请求体

```typescript
{
  nodeId: string;        // 工作流节点标识符
  taskId: string;        // 任务标识符
  videoUrls: string | string[];  // 视频 URL（单个字符串或数组）
  inputFormat?: string;  // 输入格式: 'text/plain', 'application/json', 或 'array' (默认: 'array')
}
```

#### 响应体

```typescript
{
  success: boolean;      // 操作是否成功
  message: string;       // 响应消息
  materials: MaterialItem[];  // 转换后的素材数据数组
  nodeId: string;        // 节点标识符
  taskId: string;        // 任务标识符
}
```

#### MaterialItem 格式

```typescript
{
  id: string;            // 唯一素材标识符
  name: string;          // 素材名称
  type: 'video';         // 素材类型（固定为 'video'）
  format: string;        // 文件格式（例如 'mp4'）
  url: string;           // 素材 URL
  thumbnailUrl?: string; // 缩略图 URL（可选）
  duration?: number;     // 时长（秒，可选）
  width?: number;        // 视频宽度（可选）
  height?: number;       // 视频高度（可选）
  size?: number;         // 文件大小（字节，可选）
  createdAt: string;     // 创建时间戳（ISO 格式）
  metadata: {            // 附加元数据
    source: 'workflow-video-export';
    workflowNodeId: string;
    workflowTaskId: string;
    originalUrl: string;
    exportedAt: string;
  }
}
```

## 使用示例

### 基本示例

#### 请求

```json
{
  "nodeId": "node-123",
  "taskId": "task-456",
  "videoUrls": "https://example.com/video1.mp4",
  "inputFormat": "text/plain"
}
```

#### 响应

```json
{
  "success": true,
  "message": "Successfully exported 1 video(s) to materials",
  "materials": [
    {
      "id": "video_export_task-456_0_1699876543210",
      "name": "video1.mp4",
      "type": "video",
      "format": "mp4",
      "url": "https://example.com/video1.mp4",
      "thumbnailUrl": null,
      "duration": null,
      "width": null,
      "height": null,
      "size": null,
      "createdAt": "2024-11-13T08:15:43.210Z",
      "metadata": {
        "source": "workflow-video-export",
        "workflowNodeId": "node-123",
        "workflowTaskId": "task-456",
        "originalUrl": "https://example.com/video1.mp4",
        "exportedAt": "2024-11-13T08:15:43.210Z"
      }
    }
  ],
  "nodeId": "node-123",
  "taskId": "task-456"
}
```

### 多个视频 URL

#### 请求

```json
{
  "nodeId": "node-123",
  "taskId": "task-456",
  "videoUrls": [
    "https://example.com/video1.mp4",
    "https://example.com/video2.mp4",
    "https://example.com/video3.mp4"
  ],
  "inputFormat": "array"
}
```

#### 响应

```json
{
  "success": true,
  "message": "Successfully exported 3 video(s) to materials",
  "materials": [
    {
      "id": "video_export_task-456_0_1699876543210",
      "name": "video1.mp4",
      "type": "video",
      "format": "mp4",
      "url": "https://example.com/video1.mp4",
      "createdAt": "2024-11-13T08:15:43.210Z",
      "metadata": {
        "source": "workflow-video-export",
        "workflowNodeId": "node-123",
        "workflowTaskId": "task-456",
        "originalUrl": "https://example.com/video1.mp4",
        "exportedAt": "2024-11-13T08:15:43.210Z"
      }
    },
    {
      "id": "video_export_task-456_1_1699876543215",
      "name": "video2.mp4",
      "type": "video",
      "format": "mp4",
      "url": "https://example.com/video2.mp4",
      "createdAt": "2024-11-13T08:15:43.215Z",
      "metadata": {
        "source": "workflow-video-export",
        "workflowNodeId": "node-123",
        "workflowTaskId": "task-456",
        "originalUrl": "https://example.com/video2.mp4",
        "exportedAt": "2024-11-13T08:15:43.215Z"
      }
    },
    {
      "id": "video_export_task-456_2_1699876543220",
      "name": "video3.mp4",
      "type": "video",
      "format": "mp4",
      "url": "https://example.com/video3.mp4",
      "createdAt": "2024-11-13T08:15:43.220Z",
      "metadata": {
        "source": "workflow-video-export",
        "workflowNodeId": "node-123",
        "workflowTaskId": "task-456",
        "originalUrl": "https://example.com/video3.mp4",
        "exportedAt": "2024-11-13T08:15:43.220Z"
      }
    }
  ],
  "nodeId": "node-123",
  "taskId": "task-456"
}
```

### JSON 数组格式

#### 请求

```json
{
  "nodeId": "node-123",
  "taskId": "task-456",
  "videoUrls": "[\"https://example.com/video1.mp4\", \"https://example.com/video2.mp4\"]",
  "inputFormat": "application/json"
}
```

#### 响应

与多个视频 URL 示例相同。

## 错误处理

### 无效的视频 URLs

#### 请求

```json
{
  "nodeId": "node-123",
  "taskId": "task-456",
  "videoUrls": "",
  "inputFormat": "text/plain"
}
```

#### 响应

```json
{
  "detail": "At least one valid video URL is required"
}
```

**状态码**: `400 Bad Request`

### 格式错误

#### 请求

```json
{
  "nodeId": "node-123",
  "taskId": "task-456",
  "videoUrls": 12345,
  "inputFormat": "text/plain"
}
```

#### 响应

```json
{
  "detail": "videoUrls must be a string or array"
}
```

**状态码**: `400 Bad Request`

### 服务器错误

#### 响应

```json
{
  "detail": "Video export failed: [错误详情]"
}
```

**状态码**: `500 Internal Server Error`

## 前端集成

### 工作流执行器中的使用

Video Export Node 在工作流执行器中自动执行：

```typescript
// 在 WorkflowExecutor.ts 中
private async executeVideoExportNode(node: WorkflowNode, input: any): Promise<any> {
  const config = node.data.config as any;
  
  // 从输入或配置获取视频 URLs
  let videoUrls: string | string[] = input || config?.videoUrls || '';
  
  // 调用 Video Export API
  const response = await fetch('/api/workflow/video-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      nodeId: node.id,
      taskId: 'workflow-execution',
      inputs: {
        videoUrls,
        inputFormat: config?.inputFormat || 'array',
      },
      config: {
        videoUrls,
        inputFormat: config?.inputFormat || 'array',
      },
    }),
  });
  
  const result = await response.json();
  
  // 返回素材数据
  return {
    success: true,
    materials: result.materials,
    message: `Exported ${result.materials?.length || 0} video(s) to materials`,
  };
}
```

### 聊天界面中的显示

当 Video Export 节点执行完成后，聊天界面会自动检测并显示"导出剪辑"按钮：

```typescript
// 在 WorkflowExecutionMessage.tsx 中
const videoExportMaterials = useMemo(() => {
  if (!executionState || !isComplete) return null;

  // 查找 Video Export 节点执行日志
  const videoExportLog = executionState.logs.find(
    log => log.level === 'success' && 
           log.message.includes('Successfully exported') && 
           log.message.includes('video(s) to materials')
  );

  if (!videoExportLog || !videoExportLog.nodeId) return null;

  // 获取节点状态中的素材数据
  const nodeState = executionState.nodeStates[videoExportLog.nodeId];
  if (!nodeState?.output?.materials || !Array.isArray(nodeState.output.materials)) {
    return null;
  }

  return nodeState.output.materials;
}, [executionState, isComplete]);
```

### 导航到 Video Editing

点击"导出剪辑"按钮后，系统会先切换到 Video Editing 任务，等任务完全加载后再导入素材：

#### 第一步：设置待导入素材并切换任务

```typescript
// 在 Container.tsx 中
const handleNavigateToVideoEditingWithMaterials = (materials: any[]) => {
  // 1. 查找 Video Editing 任务
  const videoTask = tasks.find(t => t.type === 'video');
  
  // 2. 设置待导入的素材（不直接合并）
  const updatedContent: VideoEditingTaskContent = {
    ...currentContent,
    pendingMaterials: materials  // 设置待导入的素材
  };
  
  onUpdateTask(videoTask.id, {
    content: updatedContent
  });
  
  // 3. 切换到 Video Editing 标签页
  const videoTab = tabs.find(t => t.taskId === videoTask.id);
  onSelectTab(videoTab.id);
};
```

#### 第二步：任务加载后自动导入素材

```typescript
// 在 VideoEditingInterface.tsx 中
useEffect(() => {
  if (content?.pendingMaterials && content.pendingMaterials.length > 0) {
    console.log('[VideoEditingInterface] Detected pending materials, importing...');

    // 获取现有素材
    const existingMaterials = materialManagement.materials;
    const existingUrls = new Set(existingMaterials.map(m => m.url));

    // 过滤掉已存在的素材（根据URL去重）
    const newMaterials = content.pendingMaterials.filter(m => !existingUrls.has(m.url));

    // 添加新素材到素材管理
    if (newMaterials.length > 0) {
      newMaterials.forEach(material => {
        materialManagement.addOrReplaceMaterial(material);
      });
      
      showSuccess(`成功导入 ${newMaterials.length} 个视频素材到素材管理面板`);
    } else {
      showSuccess('素材已存在，无需重复导入');
    }

    // 清除pending标记，避免重复导入
    const updatedContent: VideoEditingTaskContent = {
      ...content,
      pendingMaterials: undefined
    };
    onUpdateContent(updatedContent);
  }
}, [content?.pendingMaterials, materialManagement, showSuccess, onUpdateContent]);
```

## 工作流节点配置

### Video Export Node 配置

```typescript
interface VideoExportNodeConfig {
  // 输入：视频 URLs（字符串或数组）
  videoUrls?: string | string[];
  
  // 输入格式
  inputFormat?: DataFormat;  // 'text/plain' | 'application/json' | 'array'
  
  // 输出格式 - 总是输出素材数据
  outputFormat?: DataFormat;
  
  // 执行结果
  lastExecutionResult?: any;
  lastExecutionTime?: string;
  lastExecutionSuccess?: boolean;
  lastExecutionError?: string;
}
```

### 节点在工作流中的使用

1. **连接到其他节点**: Video Export Node 可以接收来自其他节点的视频 URL 输出
2. **独立配置**: 也可以在配置面板中直接输入视频 URLs
3. **多种输入格式**: 支持纯文本、JSON 数组或原生数组格式

## 日志记录

### 后端日志

```python
logger.info(
    f"[Video Export] Received request - Node ID: {request.nodeId}, Task ID: {request.taskId}",
    extra={
        "node_id": request.nodeId,
        "task_id": request.taskId,
        "input_format": request.inputFormat,
    }
)

logger.info(
    f"[Video Export] Processing {len(video_urls)} video URL(s)",
    extra={
        "node_id": request.nodeId,
        "task_id": request.taskId,
        "video_count": len(video_urls),
    }
)

logger.info(
    f"[Video Export] Successfully converted {len(materials)} video(s) to materials",
    extra={
        "node_id": request.nodeId,
        "task_id": request.taskId,
        "materials_count": len(materials),
    }
)
```

### 前端日志

```typescript
console.log('[WorkflowExecutor] Executing Video Export node', { 
  nodeId: node.id,
  input,
  timestamp: new Date().toISOString()
});

console.log('[WorkflowExecutionMessage] Video Export detected:', {
  nodeId: videoExportLog.nodeId,
  materialsCount: nodeState.output.materials.length,
  materials: nodeState.output.materials
});

console.log('[Container] Navigating to Video Editing with materials from Video Export:', {
  materialsCount: materials.length,
  timestamp: new Date().toISOString()
});
```

## 注意事项

1. **素材去重**: 导入素材时会自动检查 URL 是否已存在，避免重复导入
2. **URL 验证**: 后端会过滤空白 URL，确保至少有一个有效的视频 URL
3. **格式支持**: 支持多种输入格式，会自动进行格式转换
4. **错误处理**: 提供详细的错误信息和日志记录
5. **任务查找**: 自动查找并切换到 Video Editing 任务，如果任务不存在会记录错误
6. **异步导入**: 使用 `pendingMaterials` 机制，确保 Video Editing 任务完全加载后再导入素材，避免素材丢失
7. **用户反馈**: 导入完成后会显示成功提示，告知用户导入了多少个素材

## 相关文件

### 后端

- `backend-services/basic-service/app/routers/video_export_router.py` - API 路由实现

### 前端

- `src/components/workflow/WorkflowExecutor.ts` - 工作流执行器
- `src/components/workflow/nodes/VideoExportNode.tsx` - Video Export 节点组件
- `src/components/chat/WorkflowExecutionMessage.tsx` - 工作流执行消息组件
- `src/components/chat/MessageBubble.tsx` - 消息气泡组件
- `src/components/workflow/WorkflowChatInterface.tsx` - 工作流聊天界面
- `src/components/Container.tsx` - 主容器组件（处理导航）
- `src/types/index.ts` - TypeScript 类型定义

## 更新日志

### 2024-10-30 (v2)

- ✅ 优化素材导入流程：改为异步导入机制
- ✅ 添加 `pendingMaterials` 字段到 `VideoEditingTaskContent` 类型
- ✅ 实现先切换任务，等任务加载完成后再导入素材的逻辑
- ✅ 在 `VideoEditingInterface` 中添加 `useEffect` 监听 `pendingMaterials` 并自动导入
- ✅ 添加用户反馈提示，显示导入素材数量
- ✅ 更新 API 文档，说明异步导入机制

### 2024-10-30 (v1)

- ✅ 实现 Video Export Node API 端点
- ✅ 在聊天界面添加"导出剪辑"按钮检测逻辑
- ✅ 实现点击按钮后导航到 Video Editing 并导入素材
- ✅ 支持 Workflows 和 AI Chat 两个任务类型
- ✅ 添加详细的日志记录和错误处理
- ✅ 创建 API 文档

