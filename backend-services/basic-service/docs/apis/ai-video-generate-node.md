# AI Video Generate Node API

## 概述

AI Video Generate 节点是一个 Workflow 工作流节点，用于从多种输入（文案、视频、音频、图片）生成视频编辑时间轴。该节点使用 VIDEO_CUT_LLM（与 AI混剪 相同的 LLM）将各种输入融合并转换为标准的 Video Editing JSON 格式。

## 特性

- **多输入支持**: 支持文案（text）、视频（video）、音频（audio）、图片（image）四种输入类型，全部为可选
- **灵活格式**: 每个输入支持三种格式：字符串（string）、JSON 对象（JSON）、数组（array）
- **智能融合**: LLM 自动理解并融合所有输入，生成合理的视频编辑方案
- **标准输出**: 输出符合 Video Editing 导出 JSON 格式，可直接导入到视频编辑任务
- **单节点调试**: 支持手动编辑输入输出，支持保存配置
- **优雅设计**: 灰黑系横向长条节点，符合人机交互最佳实践

## 节点设计

### 外观
- **形状**: 横向长条状（宽度 >> 高度）
- **尺寸**: 480px × 140px
- **颜色**: 灰黑系主题
- **布局**: 左侧多个输入端口，中间显示区域，右侧单个输出端口

### 端口配置

#### 输入端口（左侧）
- **文案 (Text Input)**: 接收文本内容、脚本、创作说明
- **视频 (Video Input)**: 接收视频 URL、JSON 对象或数组
- **音频 (Audio Input)**: 接收音频 URL、JSON 对象或数组
- **图片 (Image Input)**: 接收图片 URL、JSON 对象或数组

#### 输出端口（右侧）
- **Timeline**: 输出标准的视频编辑时间轴 JSON 数据

## API 端点

### Next.js API

**端点**: `POST /api/workflow/ai-video-generate`

**请求体**:
```json
{
  "nodeId": "node-1234567890",
  "taskId": "task-1234567890",
  "inputs": {
    "textInput": "创建一个30秒的产品介绍视频",
    "videoInput": "",
    "audioInput": "",
    "imageInput": "",
    "textInputFormat": "text/plain",
    "videoInputFormat": "text/plain",
    "audioInputFormat": "text/plain",
    "imageInputFormat": "text/plain"
  },
  "config": {
    "systemPrompt": "你是一个专业的视频剪辑AI助手...",
    "temperature": 0.7,
    "maxTokens": 2000
  }
}
```

**响应**:
```json
{
  "success": true,
  "message": "AI video generate completed successfully",
  "timelineData": {
    "metadata": {
      "exportedAt": "2024-01-01T00:00:00.000Z",
      "version": "1.0.0",
      "taskId": "task-1234567890",
      "totalDuration": 30.5,
      "trackCount": 3,
      "itemCount": 5
    },
    "timeline": { ... },
    "tracks": [ ... ],
    "materials": [ ... ]
  }
}
```

### Python Backend API

**端点**: `POST /api/workflow/ai-video-generate`

**请求模型**: `AIVideoGenerateRequest`
```python
{
  "nodeId": str,          # 节点 ID (必需)
  "taskId": str,          # 任务 ID (必需)
  "inputs": {             # 输入数据 (必需)
    "textInput": Optional[str],
    "videoInput": Optional[str],
    "audioInput": Optional[str],
    "imageInput": Optional[str],
    "textInputFormat": Optional[str],
    "videoInputFormat": Optional[str],
    "audioInputFormat": Optional[str],
    "imageInputFormat": Optional[str]
  },
  "config": {             # 配置 (可选)
    "systemPrompt": Optional[str],
    "temperature": Optional[float],  # 0.0 - 1.0
    "maxTokens": Optional[int]       # 100 - 8000
  }
}
```

**响应模型**: `AIVideoGenerateResponse`
```python
{
  "success": bool,
  "message": str,
  "timelineData": Optional[Dict[str, Any]],
  "nodeId": str,
  "taskId": str
}
```

## 工作流程

1. **输入解析**: 
   - 解析各个输入的格式（text/plain, application/json, array）
   - 将输入数据转换为对应的数据结构

2. **LLM 调用**:
   - 构建包含所有输入的结构化 prompt
   - 调用 VIDEO_CUT_LLM API（使用环境变量配置）
   - 生成简化的时间轴 JSON

3. **格式转换**:
   - 使用 `TimelineParserService` 将简化 JSON 转换为完整的时间轴格式
   - 验证数据结构的正确性

4. **结果返回**:
   - 返回标准的 Video Editing JSON 格式
   - 包含 metadata、timeline、tracks、materials 等完整信息

## 环境变量配置

需要在 `backend-services/basic-service/.env` 中配置以下变量：

```bash
# Video Cut LLM Configuration (AI混剪使用的同一套配置)
VIDEO_CUT_LLM_API_KEY=***REMOVED***
VIDEO_CUT_LLM_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VIDEO_CUT_LLM_MODEL=qwen3-next-80b-a3b-instruct
```

## 使用示例

### 基础文本输入

```javascript
// 在 Workflow Canvas 中右键点击，选择 "Add AI Video Generate"
// 双击节点打开配置面板，输入文案

const inputs = {
  textInput: "制作一个介绍公司产品的30秒视频，包含产品展示和介绍文字",
  textInputFormat: "text/plain"
};
```

### JSON 输入

```javascript
const inputs = {
  textInput: JSON.stringify({
    title: "产品介绍视频",
    duration: 30,
    sections: [
      { type: "intro", duration: 5, text: "欢迎了解我们的产品" },
      { type: "features", duration: 20, text: "产品特性介绍" },
      { type: "outro", duration: 5, text: "感谢观看" }
    ]
  }),
  textInputFormat: "application/json"
};
```

### 多输入组合

```javascript
const inputs = {
  textInput: "产品介绍视频脚本",
  videoInput: JSON.stringify([
    { id: "video_001", url: "https://example.com/video1.mp4", duration: 15 },
    { id: "video_002", url: "https://example.com/video2.mp4", duration: 10 }
  ]),
  audioInput: "https://example.com/background-music.mp3",
  imageInput: JSON.stringify({ 
    logo: "https://example.com/logo.png" 
  })
};
```

## 输出格式

节点输出的时间轴 JSON 格式与 Video Editing 的 "导出为JSON" 功能完全一致：

```json
{
  "metadata": {
    "exportedAt": "2024-01-01T00:00:00.000Z",
    "version": "1.0.0",
    "taskId": "workflow-execution",
    "totalDuration": 30.5,
    "trackCount": 3,
    "itemCount": 5
  },
  "timeline": {
    "currentTime": 0,
    "totalDuration": 30.5,
    "zoomLevel": 1.0,
    "selectedItems": [],
    "playbackRate": 1.0,
    "isPlaying": false,
    "snapToGrid": true,
    "gridSize": 0.1,
    "scrollLeft": 0
  },
  "tracks": [
    {
      "id": "video-track-1",
      "name": "Video Track 1",
      "type": "video",
      "height": 80,
      "isLocked": false,
      "isMuted": false,
      "isVisible": true,
      "volume": 100,
      "order": 0,
      "items": [...]
    },
    {
      "id": "audio-track-1",
      "name": "Audio Track 1",
      "type": "audio",
      "height": 60,
      "isLocked": false,
      "isMuted": false,
      "isVisible": true,
      "volume": 200,
      "order": 1,
      "items": [...]
    }
  ],
  "materials": [...]
}
```

## 节点配置

### LLM 参数

- **System Prompt**: 自定义系统提示词（可选，默认使用内置提示词）
- **Temperature**: 生成的随机性（0.0-1.0，默认 0.7）
- **Max Tokens**: 最大生成 token 数（100-8000，默认 2000）

### 输入格式

每个输入支持三种格式：
- `text/plain`: 纯文本字符串
- `application/json`: JSON 对象
- `array`: JSON 数组

## 调试功能

1. **双击节点**: 打开配置面板
2. **手动输入**: 在配置面板中直接编辑输入内容
3. **查看结果**: 在 "Execution Results" 标签页查看执行结果
4. **保存配置**: 点击 "Save Configuration" 保存设置

## 错误处理

### 常见错误

1. **至少需要一个输入**:
   ```
   Error: At least one input (text, video, audio, or image) is required
   ```
   解决: 至少填写一个输入字段

2. **LLM API 调用失败**:
   ```
   Error: LLM API error: 401 - Invalid API key
   ```
   解决: 检查环境变量中的 VIDEO_CUT_LLM_API_KEY 配置

3. **JSON 解析失败**:
   ```
   Error: Failed to parse LLM response as JSON
   ```
   解决: 检查 LLM 返回的内容，可能需要调整 system prompt

## 日志记录

### 前端日志
- 节点执行开始/结束
- API 调用成功/失败
- 输入输出数据摘要

### 后端日志
- 接收请求详情（包含 node ID 和 task ID）
- 输入解析过程
- LLM API 调用详情
- 时间轴转换过程
- 最终结果统计

## 性能优化

1. **输入截断**: 视频分析结果自动截断到 200 字符
2. **并发控制**: LLM API 调用使用 60 秒超时
3. **缓存机制**: 可复用已配置的节点设置

## 安全性

1. **输入验证**: 所有输入在后端进行严格验证
2. **API 密钥保护**: LLM API 密钥仅在后端使用，不暴露给前端
3. **错误处理**: 敏感信息不包含在错误消息中

## 版本历史

### v1.0.0 (2024-01-01)
- 初始版本
- 支持四种输入类型
- 支持三种数据格式
- 集成 VIDEO_CUT_LLM
- 输出标准 Video Editing JSON 格式

## 相关文档

- [AI Mixed Editing API](./ai_mixed_editing_api.md) - 使用相同的 LLM 配置
- [Timeline Export API](../timeline-export.md) - 了解输出 JSON 格式
- [Workflow API](./workflow-api.md) - 工作流系统整体架构

## 支持与反馈

如有问题或建议，请联系开发团队。

