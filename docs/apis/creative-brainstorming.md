# Creative Brainstorming API

## 端点
`POST /api/creative-brainstorming`

## 功能
提供多专家协作的创意讨论和内容生成服务，支持配置化的专家讨论和智能总结功能。

## 请求参数
```json
{
  "taskId": "string",
  "config": {
    "creationType": ["string"],
    "creationDomain": ["string"], 
    "creationGoal": ["string"],
    "contentStrategy": ["string"],
    "creativeExperts": ["string"]
  },
  "currentContent": "string",
  "messages": [
    {
      "type": "expert" | "user" | "moderator",
      "expertId": "string",
      "content": "string",
      "timestamp": "string"
    }
  ],
  "phase": "discussion" | "summary",
  "currentRound": "number",
  "userMessage": "string"
}
```

## 专家类型
- `creative-director`: 创意总监
- `marketing-strategist`: 营销策略师
- `content-writer`: 内容编剧
- `visual-designer`: 视觉设计师
- `ux-expert`: 用户体验专家

## 响应
返回Server-Sent Events (SSE)格式的流式响应：
```
data: {"content": "专家回应的部分内容"}
```

## 使用流程
1. `discussion`阶段：专家轮流讨论
2. `summary`阶段：主持人总结生成最终方案 