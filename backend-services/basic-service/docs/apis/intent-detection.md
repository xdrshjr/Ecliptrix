# Intent Detection API

## 概述
用户意图检测API，使用Fast LLM快速分析用户消息，判断是否需要调用特定工作流来处理用户请求。

**核心特性**:
- 使用Fast LLM (qwen-max-latest)进行快速意图分析
- 基于工作流描述和对话历史进行精准匹配
- 返回结构化的意图检测结果，包括置信度和理由
- 通常在500ms内完成意图检测

## 端点
```
POST /api/intent-detection/detect
```

## 请求格式

### Headers
```
Content-Type: application/json
```

### Body Parameters
| 参数名 | 类型 | 必需 | 描述 |
|-------|------|------|------|
| user_message | string | 是 | 用户的问题或消息 |
| enabled_workflows | array | 是 | 当前启用的工作流列表 |
| conversation_history | array | 否 | 对话历史（最近5条） |

#### enabled_workflows 结构
```json
{
  "workflow_id": "string",
  "workflow_name": "string",
  "tool_description": "string",
  "enabled": boolean
}
```

#### conversation_history 结构
```json
{
  "role": "user" | "assistant",
  "content": "string"
}
```

### 请求示例
```json
{
  "user_message": "帮我生成一段关于旅行的视频脚本",
  "enabled_workflows": [
    {
      "workflow_id": "script-generation-001",
      "workflow_name": "视频脚本生成",
      "tool_description": "根据用户需求生成视频脚本，包括场景描述、旁白文案等",
      "enabled": true
    },
    {
      "workflow_id": "video-search-002",
      "workflow_name": "视频素材搜索",
      "tool_description": "根据关键词搜索相关的视频素材",
      "enabled": true
    }
  ],
  "conversation_history": [
    {
      "role": "user",
      "content": "你好"
    },
    {
      "role": "assistant",
      "content": "你好！我是视频编辑AI助手，有什么可以帮您的吗？"
    }
  ]
}
```

## 响应格式

### 成功响应
```json
{
  "success": true,
  "message": "Intent detection completed successfully",
  "data": {
    "should_call_workflow": true,
    "workflow_id": "script-generation-001",
    "workflow_name": "视频脚本生成",
    "reasoning": "用户明确要求生成视频脚本，应该调用脚本生成工作流",
    "confidence": 0.95
  },
  "error": null
}
```

### 失败响应
```json
{
  "success": false,
  "message": "Fast LLM not configured",
  "data": null,
  "error": "FAST_LLM_API_KEY environment variable is not set. Please configure it in .env file."
}
```

### 无需调用工作流
```json
{
  "success": true,
  "message": "Intent detection completed successfully",
  "data": {
    "should_call_workflow": false,
    "workflow_id": null,
    "workflow_name": null,
    "reasoning": "用户只是简单的问候，不需要调用任何工作流",
    "confidence": 0.98
  },
  "error": null
}
```

## 响应字段说明

### IntentDetectionResponse
| 字段 | 类型 | 描述 |
|------|------|------|
| success | boolean | 请求是否成功 |
| message | string | 响应消息 |
| data | WorkflowIntention | 意图检测结果（成功时） |
| error | string | 错误信息（失败时） |

### WorkflowIntention
| 字段 | 类型 | 描述 |
|------|------|------|
| should_call_workflow | boolean | 是否需要调用工作流 |
| workflow_id | string | 建议调用的工作流ID（如果需要） |
| workflow_name | string | 工作流名称（如果需要） |
| reasoning | string | 判断理由 |
| confidence | float | 置信度 (0-1) |

## 置信度说明

- **0.8 - 1.0**: 完全匹配，强烈建议调用工作流
- **0.5 - 0.8**: 部分匹配，可以考虑调用工作流
- **0.0 - 0.5**: 不确定或不匹配，不建议调用工作流

## 环境变量配置

在 `backend-services/basic-service/.env` 文件中配置：

```env
# Fast LLM 配置（必需）
FAST_LLM_API_KEY=<redacted>
FAST_LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
FAST_LLM_MODEL=qwen-max-latest
```

**注意**: 
- 如果未配置 `FAST_LLM_API_KEY`，服务仍会启动，但意图检测功能不可用
- 系统会在日志中记录警告信息
- API会返回失败响应，但不会导致整个服务崩溃

## 使用场景

### 1. 视频脚本生成
用户说："帮我生成一个关于美食的视频脚本"
- Fast LLM识别意图 → 调用"视频脚本生成"工作流

### 2. 视频素材搜索
用户说："找一些海滩的视频素材"
- Fast LLM识别意图 → 调用"视频素材搜索"工作流

### 3. 普通对话
用户说："什么是视频剪辑？"
- Fast LLM识别为普通问答 → 不调用工作流，直接对话

## 技术实现

### 架构流程
```
前端 (Next.js)
  ↓ POST /api/intent-detection
Next.js 代理层
  ↓ POST /api/intent-detection/detect
Python FastAPI 后端
  ↓ 调用 IntentDetectionService
Fast LLM (qwen-max-latest)
  ↓ 返回意图分析结果
Python FastAPI 后端
  ↓ 返回结构化响应
Next.js 代理层
  ↓ 转发响应
前端 (Next.js)
```

### 意图检测逻辑

1. **系统提示词构建**: 包含所有启用的工作流描述
2. **对话历史**: 使用最近5条消息提供上下文
3. **Fast LLM调用**: 使用低温度(0.3)确保稳定输出
4. **JSON格式强制**: 要求返回结构化JSON
5. **结果解析**: 提取意图和置信度

## 日志记录

### 请求日志
```
[IntentDetectionRouter] 收到Fast LLM意图检测请求 - 
  消息: 帮我生成一段关于旅行的视频脚本..., 
  启用工作流数: 2, 
  工作流列表: ['视频脚本生成', '视频素材搜索']
```

### 成功响应日志
```
[IntentDetectionService] Fast LLM意图检测成功 - 
  需要调用工作流: True, 
  工作流名称: 视频脚本生成, 
  置信度: 0.95
```

### 错误日志
```
[IntentDetectionService] FAST_LLM_API_KEY 未配置 - 
  无法执行意图检测，请检查环境变量配置
```

## 性能指标

- **平均响应时间**: 300-500ms
- **成功率**: > 99% (配置正确时)
- **超时时间**: 30秒
- **并发处理**: 支持多个同时请求

## 错误处理

### 常见错误及解决方案

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| FAST_LLM_API_KEY not set | 环境变量未配置 | 在.env文件中配置FAST_LLM_API_KEY |
| LLM API调用失败 | API服务不可用或网络问题 | 检查API URL和网络连接 |
| JSON解析失败 | LLM返回格式不正确 | 检查模型配置，确保使用支持JSON输出的模型 |
| 超时 | LLM响应过慢 | 增加超时时间或更换更快的模型 |

## 最佳实践

1. **工作流描述要清晰**: 提供准确的工作流描述有助于提高检测准确度
2. **提供对话历史**: 有助于理解上下文，提高意图判断准确性
3. **监控置信度**: 对于低置信度结果，可以考虑不调用工作流
4. **优雅降级**: 如果意图检测失败，应回退到普通对话模式
5. **日志监控**: 定期检查日志，优化工作流描述

## 测试示例

### cURL 测试
```bash
curl -X POST http://localhost:8000/api/intent-detection/detect \
  -H "Content-Type: application/json" \
  -d '{
    "user_message": "帮我生成一个旅行视频脚本",
    "enabled_workflows": [
      {
        "workflow_id": "script-gen",
        "workflow_name": "脚本生成",
        "tool_description": "生成视频脚本",
        "enabled": true
      }
    ],
    "conversation_history": []
  }'
```

### Python 测试
```python
import requests

response = requests.post(
    "http://localhost:8000/api/intent-detection/detect",
    json={
        "user_message": "帮我找一些海滩的视频",
        "enabled_workflows": [
            {
                "workflow_id": "video-search",
                "workflow_name": "视频搜索",
                "tool_description": "搜索视频素材",
                "enabled": True
            }
        ],
        "conversation_history": []
    }
)

print(response.json())
```

## 版本历史

### v1.0.0 (当前版本)
- 初始版本发布
- 支持Fast LLM意图检测
- 集成工作流匹配功能
- 提供详细日志记录
- 支持置信度评分

