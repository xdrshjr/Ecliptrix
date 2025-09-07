# AI创作工作流API文档

## 概述

AI创作工作流API提供了完整的AI内容生成流程，包括工作流执行、状态查询、结果获取和Supabase集成。该API支持文生图、文生视频等多种AI创作类型。

## 工作流程

```
1. 用户点击"开始创作" → 弹窗关闭
2. 系统执行工作流 → 返回runninghubTaskId
3. 添加"生成中"素材到素材面板
4. 每5秒轮询状态 → 检查生成进度
5. 生成完成后 → 下载素材到服务器
6. 上传素材到Supabase → 获取URL和缩略图
7. 更新素材面板 → 显示Supabase信息
```

## API端点

### 1. 执行AI创作工作流

**POST** `/api/workflow/execute`

启动AI创作工作流，支持文生图、文生视频等多种创作类型。

#### 请求体

```json
{
  "workflow_id": "1964363754437754881",
  "parameters": [
    {
      "node_id": "56",
      "field_name": "prompt",
      "field_value": "可爱的动漫女孩，有着巨大的蓬松耳廓狐耳朵..."
    },
    {
      "node_id": "52", 
      "field_name": "aspect_ratio",
      "field_value": "3:4 (Golden Ratio)"
    }
  ],
  "task_id": "video_editing_task_123"
}
```

#### 响应

```json
{
  "success": true,
  "message": "Workflow flux 文生图 execution queued successfully",
  "data": {
    "workflow_id": "1964363754437754881",
    "workflow_name": "flux",
    "status": "QUEUED",
    "task_id": "video_editing_task_123",
    "runninghub_task_id": "rh_task_456789",
    "parameters": {...},
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

#### 错误响应

- **400 Bad Request**: 参数验证失败
- **404 Not Found**: 工作流不存在
- **500 Internal Server Error**: 执行失败
- **503 Service Unavailable**: 任务队列已满 (TASK_QUEUE_MAXED)

### 2. 查询工作流状态

**GET** `/api/workflow/status/{runninghub_task_id}`

查询AI创作任务的执行状态，用于轮询检查生成进度。

#### 路径参数

- `runninghub_task_id`: RunningHub任务ID

#### 响应

```json
{
  "success": true,
  "message": "Status retrieved successfully",
  "data": {
    "runninghub_task_id": "rh_task_456789",
    "status": "RUNNING", // QUEUED, RUNNING, SUCCESS, FAILED
    "task_id": "video_editing_task_123"
  }
}
```

#### 状态说明

- `QUEUED`: 任务已排队等待执行
- `RUNNING`: 任务正在执行中
- `SUCCESS`: 任务执行成功，可获取结果
- `FAILED`: 任务执行失败
- `COMPLETED`: 任务完成（等同于SUCCESS）
- `FINISHED`: 任务完成（等同于SUCCESS）
- `DONE`: 任务完成（等同于SUCCESS）

### 3. 获取工作流结果

**GET** `/api/workflow/results/{runninghub_task_id}`

获取已完成的AI创作任务结果，包括生成的文件URL和元数据。

#### 路径参数

- `runninghub_task_id`: RunningHub任务ID

#### 响应

```json
{
  "success": true,
  "message": "Results retrieved successfully",
  "data": {
    "runninghub_task_id": "rh_task_456789",
    "status": "SUCCESS",
    "task_id": "video_editing_task_123",
    "results": [
      {
        "fileUrl": "https://runninghub.com/results/image_001.png",
        "fileType": "png",
        "nodeId": "output_node_1",
        "taskCostTime": 45.2,
        "width": 1024,
        "height": 1024
      }
    ]
  }
}
```

## 前端集成

### 工作流程实现

前端通过以下步骤实现完整的AI创作工作流：

#### 1. 启动创作任务

```typescript
const handleStartCreation = async (addMaterial: (material: MaterialItem) => boolean) => {
  // 1. 执行工作流
  const result = await workflowService.executeWorkflow({
    workflowId: selectedWorkflow.workflowId,
    parameters: workflowParameters,
    taskId: taskId
  });

  // 2. 立即关闭弹窗
  setIsModalOpen(false);

  // 3. 添加"生成中"素材
  const generatingMaterial: MaterialItem = {
    id: `generating_${result.runninghubTaskId}`,
    name: `正在生成 - ${selectedWorkflow.showNameCh}`,
    downloadStatus: 'generating',
    // ...其他属性
  };
  addMaterial(generatingMaterial);

  // 4. 开始状态轮询
  if (result.runninghubTaskId) {
    startPolling(result.runninghubTaskId, addMaterial);
  }
};
```

#### 2. 状态轮询机制

```typescript
const pollTaskStatus = async (runninghubTaskId: string, addMaterial: Function) => {
  // 检查任务状态
  const statusResult = await workflowService.checkTaskStatus(runninghubTaskId);
  
  // 如果任务完成，获取结果
  if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'FINISHED') {
    const resultsResponse = await workflowService.getTaskResults(runninghubTaskId);
    
    // 处理每个结果
    for (const result of resultsResponse.results) {
      // 上传到Supabase
      const supabaseResult = await uploadResultToSupabase(result, ...);
      
      // 创建素材项
      const material: MaterialItem = {
        id: materialId,
        name: `AI创作结果_${workflowName}`,
        url: supabaseResult.url, // 使用Supabase URL
        thumbnailUrl: supabaseResult.thumbnailUrl,
        // ...其他属性
      };
      
      // 添加到素材面板
      addMaterial(material);
    }
    
    // 停止轮询
    stopPolling();
  }
};

// 每5秒轮询一次
const startPolling = (runninghubTaskId: string, addMaterial: Function) => {
  pollingIntervalRef.current = setInterval(() => {
    pollTaskStatus(runninghubTaskId, addMaterial);
  }, 5000);
};
```

#### 3. Supabase集成

```typescript
const uploadResultToSupabase = async (result: any, workflowType: string, workflowName: string, runninghubTaskId: string) => {
  // 1. 下载文件到服务器
  const response = await fetch(result.fileUrl);
  const fileBuffer = await response.arrayBuffer();
  
  // 2. 上传到Supabase
  const fileName = `ai_creation_${runninghubTaskId}_${Date.now()}.${result.fileType}`;
  const uploadResult = await uploadFileToSupabase(fileBuffer, fileName, result.fileType);
  
  // 3. 生成缩略图（如果是视频）
  let thumbnailUrl = uploadResult.url;
  if (workflowType === 'TEXT-2-VIDEO') {
    thumbnailUrl = await generateVideoThumbnail(uploadResult.url);
  }
  
  return {
    url: uploadResult.url,
    thumbnailUrl: thumbnailUrl,
    size: fileBuffer.byteLength,
    // ...其他元数据
  };
};
```

## 素材面板集成

生成的AI创作结果会自动显示在素材管理面板中：

### 素材属性

```typescript
interface MaterialItem {
  id: string; // 素材唯一ID
  name: string; // 显示名称
  type: 'image' | 'video'; // 素材类型
  format: string; // 文件格式
  url: string; // Supabase存储URL
  thumbnailUrl?: string; // 缩略图URL
  downloadStatus: 'completed' | 'generating' | 'error'; // 下载状态
  metadata: {
    workflowId: string; // 工作流ID
    workflowName: string; // 工作流名称
    runninghubTaskId: string; // RunningHub任务ID
    isAIGenerated: true; // AI生成标识
    source: 'ai_creation'; // 来源标识
    // ...其他元数据
  };
}
```

### 显示特性

1. **生成中状态**: 显示紫色加载动画和"生成中..."文字
2. **完成状态**: 显示Supabase缩略图和完整信息
3. **错误状态**: 显示错误信息和重试按钮
4. **拖拽支持**: 可拖拽到时间轴进行编辑

## 错误处理

### 常见错误类型

1. **TASK_QUEUE_MAXED**: 任务队列已满
   - 显示友好提示："当前有用户正在生成内容，请稍后再试"
   - 建议用户等待几分钟后重试

2. **网络错误**: 轮询过程中的网络问题
   - 继续轮询，不中断流程
   - 记录错误日志但不影响用户体验

3. **文件上传失败**: Supabase上传错误
   - 重试上传机制
   - 显示具体错误信息

### 日志记录

系统会详细记录以下信息：

- 工作流执行开始和结束
- 状态轮询的每次请求和响应
- 文件下载和上传过程
- 错误发生的具体位置和原因
- 用户操作的完整流程

## 性能优化

1. **轮询间隔**: 5秒间隔平衡了响应速度和服务器负载
2. **文件缓存**: Supabase提供CDN加速
3. **缩略图生成**: 异步生成，不阻塞主流程
4. **错误重试**: 智能重试机制，避免无限循环

## 安全考虑

1. **文件类型验证**: 严格验证上传文件类型
2. **文件大小限制**: 防止过大文件影响性能
3. **访问控制**: Supabase RLS策略控制文件访问
4. **任务超时**: 防止长时间运行的任务占用资源

## 监控和调试

### 前端调试

浏览器控制台会显示详细的调试信息：

```
🚀 AI Creation - Workflow execution result: {...}
🔄 AI Creation - Starting task polling: {...}
🔍 AI Creation - Polling task status: {...}
🎯 AI Creation - Processing task results: {...}
✅ AI Creation - Material added successfully: {...}
```

### 后端监控

FastAPI后端提供详细的日志记录：

- 工作流执行请求和响应
- RunningHub API调用详情
- 错误堆栈和上下文信息
- 性能指标和执行时间

## 使用示例

### 完整的AI创作流程

```typescript
// 1. 用户选择工作流并设置参数
const workflow = await workflowService.getAvailableWorkflows();
const selectedWorkflow = workflow.find(w => w.workflowId === 'flux_text_to_image');

// 2. 设置参数
const parameters = {
  'prompt_node': '可爱的动漫女孩...',
  'aspect_ratio_node': '3:4 (Golden Ratio)'
};

// 3. 启动创作（弹窗会自动关闭）
await handleStartCreation(addMaterial);

// 4. 系统自动轮询状态，用户可以看到：
// - 素材面板中出现"正在生成"的项目
// - 5秒后状态更新
// - 生成完成后自动显示结果
// - 可以直接拖拽到时间轴使用
```

这个API设计确保了用户体验的流畅性，同时提供了完整的AI创作工作流程。