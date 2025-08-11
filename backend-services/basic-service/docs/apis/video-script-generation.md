# Video Script Generation API

## 概述
视频脚本生成接口，基于用户提供的Markdown内容自动生成结构化的视频脚本片段。支持智能分析内容结构，生成适合视频制作的脚本段落和句子。

## 端点
`POST /api/video-script-generation`

## 请求格式

### Headers
```
Content-Type: application/json
```

### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| markdownContent | string | 是 | 用户输入的Markdown内容 |
| taskId | string | 是 | 任务唯一标识符 |
| scriptConfig | object | 否 | 脚本生成配置选项 |

#### ScriptConfig 对象结构
| 参数名 | 类型 | 必需 | 可选值 | 描述 |
|-------|------|------|-------|------|
| language | string | 否 | 'chinese', 'english', 'mixed' | 脚本语言设置，默认为 'chinese' |
| consistency | string | 否 | 'high', 'moderate', 'low' | 原文保持程度，默认为 'moderate' |
| segmentCount | number | 否 | 1-10 | 生成的段落数量，默认为 5 |
| customRequirements | string | 否 | - | 用户自定义要求，可选填 |

### 示例请求

#### 基础请求（使用默认配置）
```json
{
  "markdownContent": "# 产品介绍\n\n## 核心功能\n我们的产品具有以下特点：\n- 高效便捷\n- 安全可靠\n- 用户友好\n\n## 使用场景\n适用于各种业务场景...",
  "taskId": "task_123456"
}
```

#### 带配置的请求
```json
{
  "markdownContent": "# 产品介绍\n\n## 核心功能\n我们的产品具有以下特点：\n- 高效便捷\n- 安全可靠\n- 用户友好\n\n## 使用场景\n适用于各种业务场景...",
  "taskId": "task_123456",
  "scriptConfig": {
    "language": "chinese",
    "consistency": "moderate",
    "segmentCount": 6,
    "customRequirements": "请使用更加口语化的表达方式，适合年轻观众"
  }
}
```

## 响应格式

### 成功响应
- **状态码**: 200 OK
- **Content-Type**: application/json

```json
{
  "success": true,
  "segments": [
    {
      "id": "segment_1",
      "title": "产品介绍开场",
      "sentences": [
        {
          "id": "sentence_1",
          "text": "欢迎了解我们的创新产品"
        },
        {
          "id": "sentence_2", 
          "text": "让我们一起探索它的核心功能"
        }
      ],
      "duration": 8
    }
  ],
  "metadata": {
    "segmentCount": 3,
    "totalSentences": 12,
    "totalDuration": 45,
    "averageSegmentDuration": 15
  }
}
```

### 错误响应
- **状态码**: 400 Bad Request
```json
{
  "success": false,
  "error": "Invalid request parameters",
  "details": "markdownContent cannot be empty"
}
```

- **状态码**: 500 Internal Server Error
```json
{
  "success": false,
  "error": "Script generation service unavailable",
  "message": "请稍后重试"
}
```

## 脚本片段结构

### ScriptSegment 接口
```typescript
interface ScriptSegment {
  id: string;           // 片段唯一标识
  title: string;        // 片段标题
  sentences: ScriptSentence[]; // 句子数组
  duration?: number;    // 预估时长（秒）
  thumbnail?: string;   // 预留缩略图字段
}
```

### ScriptSentence 接口
```typescript
interface ScriptSentence {
  id: string;          // 句子唯一标识
  text: string;        // 句子文本内容
  startTime?: number;  // 预留时间轴字段
  endTime?: number;    // 预留时间轴字段
}
```

## 错误代码

### 状态码说明
| 状态码 | 说明 | 常见原因 |
|-------|------|---------|
| 400 | 请求参数错误 | Markdown内容为空或格式不正确 |
| 422 | 内容处理失败 | 内容过长或包含不支持的格式 |
| 429 | 请求过于频繁 | 超出API调用频率限制 |
| 500 | 服务器内部错误 | 脚本生成服务异常 |

### 错误处理建议
1. **400错误**: 验证Markdown内容的有效性
2. **422错误**: 简化内容结构或分批处理
3. **429错误**: 实现请求队列和重试机制
4. **500错误**: 提供降级方案或手动编辑选项

## 使用示例

### JavaScript/TypeScript 示例
```typescript
async function generateScript(markdownContent: string, taskId: string) {
  try {
    const response = await fetch('/api/video-script-generation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        markdownContent: markdownContent,
        taskId: taskId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.success && result.segments) {
      console.log('Script generated successfully:', result.metadata);
      return result.segments;
    } else {
      throw new Error('Invalid response format');
    }
  } catch (error) {
    console.error('Script generation failed:', error);
    throw error;
  }
}

// 使用示例
const markdownContent = `
# 产品演示

## 主要特性
- 功能A：提升效率
- 功能B：增强安全性
- 功能C：优化体验

## 应用场景
适用于企业和个人用户的各种需求...
`;

generateScript(markdownContent, 'task_123')
  .then(segments => {
    console.log(`Generated ${segments.length} script segments`);
    segments.forEach(segment => {
      console.log(`- ${segment.title}: ${segment.sentences.length} sentences`);
    });
  })
  .catch(error => {
    console.error('Failed to generate script:', error.message);
  });
```

### cURL 示例
```bash
curl -X POST http://localhost:3000/api/video-script-generation \
  -H "Content-Type: application/json" \
  -d '{
    "markdownContent": "# 产品介绍\n\n## 核心功能\n我们的产品具有以下特点：\n- 高效便捷\n- 安全可靠",
    "taskId": "task_123456"
  }'
```

## 内容处理规则

### Markdown 解析
1. **标题层级**: H1-H3标题自动转换为脚本片段
2. **列表项**: 无序/有序列表转换为独立句子
3. **段落**: 长段落自动分割为多个句子
4. **代码块**: 忽略代码块内容
5. **链接**: 提取链接文本，忽略URL

### 脚本生成策略
1. **片段划分**: 基于内容结构和语义相关性
2. **句子优化**: 调整语言风格适合口语表达
3. **时长估算**: 基于字数和语速计算预估时长
4. **连贯性**: 确保片段间的逻辑连接

## 测试

### 单元测试示例
```typescript
describe('Video Script Generation API', () => {
  test('should generate script for valid markdown', async () => {
    const mockRequest = {
      markdownContent: '# Test Title\n\nTest content with multiple sentences.',
      taskId: 'test_task'
    };

    const response = await fetch('/api/video-script-generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockRequest)
    });

    expect(response.status).toBe(200);
    
    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.segments).toBeInstanceOf(Array);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.metadata).toBeDefined();
  });

  test('should return 400 for empty markdown', async () => {
    const mockRequest = {
      markdownContent: '',
      taskId: 'test_task'
    };

    const response = await fetch('/api/video-script-generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockRequest)
    });

    expect(response.status).toBe(400);
    
    const result = await response.json();
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

### 集成测试示例
```typescript
describe('Script Generation Service Integration', () => {
  test('should validate generated script segments', async () => {
    const scriptService = createScriptService('test_task');
    
    const result = await scriptService.generateScript({
      markdownContent: '# Test\n\nContent with multiple paragraphs.\n\n## Section\n\nMore content here.',
      taskId: 'test_task'
    });

    expect(result.success).toBe(true);
    expect(result.segments).toBeDefined();
    
    // 验证脚本片段结构
    const validationResult = scriptService.validateScriptSegments(result.segments!);
    expect(validationResult.isValid).toBe(true);
    expect(validationResult.errors).toHaveLength(0);
  });
});
```

## 性能指标

### 处理能力
- **内容长度限制**: 最大 50,000 字符
- **生成速度**: 通常 2-8 秒（取决于内容复杂度）
- **并发处理**: 最大 50 个同时请求

### 质量指标
- **片段准确性**: > 95%
- **语义连贯性**: > 90%
- **时长估算精度**: ± 10%

## 最佳实践

### 输入内容建议
1. **结构清晰**: 使用标题和段落组织内容
2. **语言简洁**: 避免过于复杂的句式
3. **逻辑连贯**: 确保内容前后呼应
4. **适度长度**: 单个请求建议不超过 10,000 字符

### 错误处理
```typescript
const handleScriptGeneration = async (content: string, taskId: string) => {
  try {
    const result = await scriptService.generateScript({
      markdownContent: content,
      taskId: taskId
    });

    if (result.success) {
      return result.segments;
    } else {
      // 处理业务逻辑错误
      showUserError(`脚本生成失败: ${result.error}`);
      return null;
    }
  } catch (error) {
    // 处理网络或系统错误
    console.error('Script generation error:', error);
    showUserError('服务暂时不可用，请稍后重试');
    return null;
  }
};
```

## 更新日志

### v1.0.0 (2024-01-15)
- 初始版本发布
- 支持基础Markdown解析
- 实现脚本片段生成

### v1.1.0 (2024-01-20)
- 添加时长估算功能
- 优化句子分割算法
- 增强错误处理机制

### v1.2.0 (当前版本)
- 重构为服务层架构
- 添加脚本验证功能
- 改进内容处理规则
- 增加详细的性能监控 