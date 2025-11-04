# Video Script Generation API - Chat Support Update

## 概述
视频脚本生成接口更新，新增支持基于聊天对话内容生成脚本。除了原有的Markdown内容生成方式外，现在可以根据用户与AI的聊天对话自动生成结构化的视频脚本片段。

## 更新日期
2024-01-XX

## 端点
`POST /api/video-script-generation`

## 主要更新

### 1. 新增聊天消息支持
- 支持基于聊天对话内容生成视频脚本
- 自动提取对话中的重点内容
- 优先使用聊天消息，如果没有聊天消息则使用Markdown内容

### 2. 请求参数更新

#### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| markdownContent | string | 条件必需 | 用户输入的Markdown内容（当无chatMessages时必需） |
| taskId | string | 是 | 任务唯一标识符 |
| scriptConfig | object | 否 | 脚本生成配置选项 |
| **chatMessages** | **array** | **条件必需** | **聊天对话消息数组（新增，当无markdownContent时必需）** |

**注意**: `markdownContent` 和 `chatMessages` 至少需要提供一个。如果两者都提供，优先使用 `chatMessages`。

#### ChatMessage 对象结构（新增）
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| id | string | 是 | 消息唯一标识符 |
| role | string | 是 | 消息角色：'user' 或 'assistant' |
| content | string | 是 | 消息内容 |
| timestamp | Date | 是 | 消息时间戳 |

### 3. 示例请求

#### 基于聊天消息生成脚本（新功能）
```json
{
  "taskId": "task_123456",
  "chatMessages": [
    {
      "id": "msg_1",
      "role": "user",
      "content": "我想制作一个关于AI技术发展的视频",
      "timestamp": "2024-01-15T10:00:00Z"
    },
    {
      "id": "msg_2",
      "role": "assistant",
      "content": "很好的想法！AI技术发展可以从以下几个方面展开：1. 早期发展历程 2. 关键技术突破 3. 当前应用场景 4. 未来发展趋势",
      "timestamp": "2024-01-15T10:00:05Z"
    },
    {
      "id": "msg_3",
      "role": "user",
      "content": "重点讲一下深度学习和大语言模型",
      "timestamp": "2024-01-15T10:00:30Z"
    }
  ],
  "scriptConfig": {
    "language": "chinese",
    "consistency": "moderate",
    "segmentCount": 5
  }
}
```

#### 同时提供聊天消息和Markdown内容（优先使用聊天消息）
```json
{
  "taskId": "task_123456",
  "markdownContent": "# AI技术\n\n一些补充内容...",
  "chatMessages": [
    {
      "id": "msg_1",
      "role": "user",
      "content": "重点是深度学习",
      "timestamp": "2024-01-15T10:00:00Z"
    }
  ],
  "scriptConfig": {
    "language": "chinese",
    "segmentCount": 4
  }
}
```

#### 传统Markdown方式（向后兼容）
```json
{
  "markdownContent": "# 产品介绍\n\n## 核心功能\n...",
  "taskId": "task_123456",
  "scriptConfig": {
    "language": "chinese",
    "consistency": "moderate",
    "segmentCount": 6
  }
}
```

## 内容处理逻辑

### 聊天消息处理（新增）
1. **对话分析**: 提取用户和助手的对话内容
2. **重点识别**: 自动识别讨论的关键主题和要点
3. **结构化**: 将对话内容组织成结构化的脚本段落
4. **优化表达**: 将对话式语言转换为适合视频旁白的表达方式

### 内容优先级
```
chatMessages (存在且非空) > markdownContent
```

如果同时提供两者，系统会：
1. 首先检查 `chatMessages` 是否存在且非空
2. 如果有聊天消息，使用聊天消息生成脚本
3. 如果没有聊天消息，使用 `markdownContent` 生成脚本

## 响应格式（不变）

成功响应与原有格式保持一致：

```json
{
  "success": true,
  "segments": [
    {
      "id": "segment_1",
      "title": "AI技术发展概述",
      "sentences": [
        {
          "id": "sentence_1",
          "text": "人工智能技术在近年来取得了突破性进展"
        },
        {
          "id": "sentence_2",
          "text": "深度学习和大语言模型成为最重要的发展方向"
        }
      ],
      "duration": 10
    }
  ],
  "metadata": {
    "segmentCount": 5,
    "totalSentences": 15,
    "totalDuration": 60,
    "averageSegmentDuration": 12
  }
}
```

## 错误处理

### 新增错误情况
- **400 Bad Request**: 既没有提供 `markdownContent` 也没有提供 `chatMessages`
  ```json
  {
    "error": "Either chat messages or markdown content is required"
  }
  ```

## 使用场景

### 场景1: 视频编辑聊天面板
用户在视频编辑界面的聊天面板中与AI讨论视频内容，点击"生成脚本"按钮时，系统自动基于聊天对话生成视频脚本。

```typescript
// 获取聊天消息
const chatMessages = conversation.messages;

// 调用API生成脚本
const response = await fetch('/api/video-script-generation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    taskId: taskId,
    chatMessages: chatMessages,
    scriptConfig: {
      language: 'chinese',
      segmentCount: 5
    }
  })
});
```

### 场景2: 传统文档方式（向后兼容）
用户在文档编辑器中编写Markdown内容，然后生成脚本。

```typescript
const response = await fetch('/api/video-script-generation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    taskId: taskId,
    markdownContent: markdownContent,
    scriptConfig: config
  })
});
```

## 前端集成示例

### VideoChatWindow 组件集成
```typescript
// 在 VideoEditingInterface 中
const handleScriptGenerate = useCallback((config: ScriptGenerationConfig) => {
  // 获取当前活动对话的消息
  const activeConversation = content?.conversations?.find(
    conv => conv.id === content?.activeConversationId
  );
  
  const chatMessages = activeConversation?.messages || [];
  
  // 调用脚本生成服务，传入聊天消息
  scriptGeneration.handleGenerateScriptWithConfig(config, chatMessages);
}, [content, scriptGeneration]);
```

### useScriptGeneration Hook 更新
```typescript
// 修改后的hook签名
export const useScriptGeneration = (
  taskId: string,
  markdownContent: string,
  onUpdateContent: (content: VideoEditingTaskContent) => void,
  currentContent: VideoEditingTaskContent | null  // 新增：保留原有数据
): UseScriptGenerationReturn
```

## 日志记录

### API 日志输出示例
```
[Video Script Generation API] Content Source: Chat Messages
[Video Script Generation API] Chat messages count: 5
[Video Script Generation API] Chat messages preview: user: 我想制作... | assistant: 很好的想法...
```

## 测试建议

### 测试用例
1. **仅提供聊天消息**: 验证能正常生成脚本
2. **仅提供Markdown**: 验证向后兼容性
3. **同时提供两者**: 验证优先使用聊天消息
4. **两者都不提供**: 验证返回400错误
5. **空聊天消息数组**: 验证回退到Markdown内容
6. **聊天内容保持**: 验证生成脚本后聊天内容不丢失

### 单元测试示例
```typescript
describe('Script Generation with Chat Messages', () => {
  test('should generate script from chat messages', async () => {
    const chatMessages = [
      { id: '1', role: 'user', content: 'Test content', timestamp: new Date() }
    ];
    
    const response = await fetch('/api/video-script-generation', {
      method: 'POST',
      body: JSON.stringify({
        taskId: 'test',
        chatMessages: chatMessages
      })
    });
    
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.segments).toBeDefined();
  });
  
  test('should preserve chat messages after generation', async () => {
    // 生成脚本前的对话数量
    const beforeCount = conversation.messages.length;
    
    // 生成脚本
    await generateScript(config, chatMessages);
    
    // 验证对话数量不变
    expect(conversation.messages.length).toBe(beforeCount);
  });
});
```

## 注意事项

1. **数据保留**: 生成脚本时必须保留原有的聊天对话数据，不能清空或覆盖
2. **优先级**: 优先使用聊天消息，确保用户在聊天面板的讨论能被正确使用
3. **向后兼容**: 保持对原有Markdown方式的完全兼容
4. **错误提示**: 当两者都不提供时，给出清晰的错误提示

## 相关文件

### 前端文件
- `src/components/video/VideoEditingInterface.tsx` - 主界面，处理脚本生成触发
- `src/components/video/hooks/useScriptGeneration.ts` - 脚本生成Hook，处理聊天消息传递
- `src/components/video/services/scriptService.ts` - 脚本服务，API调用
- `src/components/video/types/videoEditingTypes.ts` - 类型定义更新

### 后端文件
- `src/app/api/video-script-generation/route.ts` - API路由，处理请求

## 版本历史

### v1.3.0 (当前版本)
- **新增**: 支持基于聊天对话生成脚本
- **新增**: `chatMessages` 请求参数
- **优化**: 内容源优先级处理
- **修复**: 脚本生成后聊天内容丢失问题
- **改进**: 日志记录，区分内容来源

### v1.2.0
- 重构为服务层架构
- 添加脚本验证功能
- 改进内容处理规则

### v1.1.0  
- 添加时长估算功能
- 优化句子分割算法

### v1.0.0
- 初始版本发布
- 支持基础Markdown解析

