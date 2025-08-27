# Prompt Optimization API

## 概述

提示词优化API是一个专门用于优化AI图像生成提示词的服务端点。通过LLM技术智能优化用户输入的正向和反向提示词，提高AI生成图像的质量。

## 端点信息

- **URL**: `/api/prompt-optimization`
- **方法**: POST
- **类型**: RESTful API

## 核心功能

1. **智能提示词优化**: 利用LLM对提示词进行专业优化
2. **双向优化**: 同时优化正向和反向提示词  
3. **质量增强**: 自动添加质量描述词和技术参数
4. **错误处理**: 完善的错误处理和回退机制

## 快速开始

### 请求示例
```json
POST /api/prompt-optimization
Content-Type: application/json

{
  "positivePrompt": "beautiful landscape",
  "negativePrompt": "blurry"
}
```

### 响应示例
```json
{
  "success": true,
  "data": {
    "positivePrompt": "beautiful landscape, high quality, detailed, professional photography, 4k resolution, natural lighting, scenic composition",
    "negativePrompt": "blurry, low quality, distorted, deformed, bad anatomy, poor composition, overexposed"
  }
}
```

## 集成说明

该API已集成到AI生图功能中：

1. 用户在AI生图弹窗中输入提示词
2. 点击"AI辅助生成"按钮触发优化
3. API返回优化后的提示词并自动填充到输入框
4. 用户可基于优化后的提示词生成更高质量的图像

## 技术架构

- **前端**: Next.js API Route (`/src/app/api/prompt-optimization/route.ts`)
- **服务层**: PromptOptimizationService (`/src/components/video/services/promptOptimizationService.ts`)
- **LLM集成**: 复用现有的Chat API配置和LLM服务连接

## 环境配置

需要配置LLM服务相关的环境变量：

```env
LLM_API_URL=https://your-llm-api-url/v1
LLM_API_KEY=your-llm-api-key  
LLM_MODEL=gpt-3.5-turbo
```

## 相关文档

- [详细API文档](../backend-services/basic-service/docs/apis/prompt_optimization_api.md)
- [AI图像生成功能](./comfyui-api.md)
- [视频编辑聊天功能](./video-compose-api.md)

## 更新日期

2024-08-27