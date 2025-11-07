# 转换视频脚本 API

## 概述

将聊天对话内容转换为视频脚本的 API，支持可选的视频理解功能。当启用视频理解时，会先分析选中的视频内容，然后结合对话内容生成更准确的脚本。

## 前端 API

### 路径
`POST /api/convert-to-script`

### 请求参数

```typescript
{
  taskId: string;                    // 任务ID
  chatContent: string;               // 聊天对话内容
  selectedVideos: MaterialItem[];    // 选中的视频素材列表（启用视频理解时必需）
  parameters: {                      // 脚本生成参数
    language: 'chinese' | 'english' | 'mixed';     // 脚本语言
    segmentCount: number;                           // 段落数量 (3-10)
    analysisDepth: 'basic' | 'detailed' | 'comprehensive';  // 分析深度
    includeVisualElements: boolean;                 // 是否包含视觉元素分析
    includeAudioAnalysis: boolean;                  // 是否包含音频分析
  };
  enableVideoUnderstanding: boolean; // 是否启用视频理解
}
```

### 响应格式

成功响应：
```typescript
{
  success: true;
  segments: ScriptSegment[];  // 生成的脚本段落
  metadata: {
    totalDuration: number;    // 总时长
    videoCount: number;       // 视频数量
    generatedAt: string;      // 生成时间
  };
}
```

失败响应：
```typescript
{
  success: false;
  error: string;    // 错误信息
  details?: any;    // 详细错误信息
}
```

## 后端 API

### 路径
`POST http://localhost:8000/api/convert-to-script`

**注意**: 此端点是 `/api/video-understanding-script` 的别名，两者功能完全相同。

### 请求参数

```python
class VideoItem(BaseModel):
    id: str                              # 视频唯一标识符
    name: str                            # 视频名称
    type: str                            # 视频类型
    url: Optional[str]                   # 视频 URL
    thumbnailUrl: Optional[str]          # 缩略图 URL
    duration: Optional[float]            # 视频时长（秒）
    format: Optional[str]                # 视频格式 (mp4, webm, etc.)
    width: Optional[int]                 # 视频宽度（像素）
    height: Optional[int]                # 视频高度（像素）
    analysisData: Optional[Dict]         # 视频分析数据（旧版）
    metadata: Optional[Dict]             # 视频元数据，包含 video_analysis

class ScriptGenerationParameters(BaseModel):
    language: Literal['chinese', 'english', 'mixed']  # 脚本语言
    segmentCount: int                    # 段落数量 (1-20)
    analysisDepth: Literal['basic', 'detailed', 'comprehensive']  # 分析深度
    includeVisualElements: bool          # 是否包含视觉元素分析
    includeAudioAnalysis: bool           # 是否包含音频分析

class VideoUnderstandingScriptRequest(BaseModel):
    taskId: str                          # 任务唯一标识符
    selectedVideos: List[VideoItem]      # 选中的视频列表（至少1个）
    referenceText: str                   # 参考文本（对话内容）
    parameters: ScriptGenerationParameters  # 生成参数
```

**重要说明**:
- `referenceText` 对应前端的 `chatContent`
- `selectedVideos` 包含视频的完整信息，包括已经分析的数据（在 `metadata.video_analysis` 或 `analysisData` 中）
- 后端会自动从 `metadata.video_analysis` 或 `analysisData` 中提取分析结果，无需前端单独传递
- 如果视频没有分析数据，后端会尝试从存储中获取或创建基础分析结果

### 处理流程

1. **接收请求**
   - 验证 `taskId`、`selectedVideos`（至少1个）、`parameters`
   - 验证 `referenceText`（可以为空）
   - 验证 `segmentCount` 范围（1-20）

2. **视频分析提取**
   - 遍历 `selectedVideos`，提取每个视频的分析数据
   - 优先级：
     1. `metadata.video_analysis`（推荐）
     2. `analysisData`（旧版兼容）
     3. 从存储中查询已有分析
     4. 创建基础分析结果（后备方案）
   - 提取帧分析、视觉元素、音频元素、关键主题等

3. **LLM 脚本生成**
   - 构建详细的 prompt，包含：
     - 用户要求（`referenceText`）
     - 视频分析结果（帧描述、内容描述、关键主题）
     - 生成参数（语言、段落数、分析深度等）
     - 输出格式示例（JSON）
   - 调用 Video Cut LLM API 生成脚本
   - 解析返回的 JSON 格式脚本

4. **脚本解析与后处理**
   - 解析 LLM 返回的 JSON
   - 为每个段落和句子生成唯一 ID
   - 根据 `video_ids` 关联视频到段落
   - 从原始 `selectedVideos` 中获取完整视频信息（URL、缩略图等）
   - 计算段落时长
   - 提取关键词

5. **返回结果**
   - 返回生成的脚本段落（包含完整视频信息）
   - 包含元数据（处理的视频数、生成的段落数、总时长等）

### 实现位置

后端实现已完成，位于：
- **Router**: `backend-services/basic-service/app/routers/video_understanding_script_router.py`
  - `/api/convert-to-script` - 主要端点
  - `/api/video-understanding-script` - 别名端点
- **Service**: `backend-services/basic-service/app/services/video_understanding_script_service.py`
  - `VideoUnderstandingScriptService.generate_script()` - 主要生成逻辑
- **Models**: `backend-services/basic-service/app/models/video_understanding_script_models.py`
  - 请求/响应模型定义

## 使用流程

### 1. 用户点击"转换视频脚本"按钮

在聊天对话气泡中点击"转换视频脚本"按钮，触发 `onConvertToScript` 回调。

### 2. 打开配置弹窗

显示左右布局的配置弹窗：
- **左侧**：参数设置（语言、段落数、分析深度等）
- **右侧**：视频理解开关 + 视频选择列表

### 3. 配置参数

用户可以：
- 调整生成参数
- 开启/关闭视频理解开关
- 如果开启视频理解，选择要分析的视频

### 4. 开始生成

点击"开始生成"按钮：
- 关闭配置弹窗
- 显示进度弹窗
- 如果启用视频理解：
  1. 并行分析选中的视频（快速模式：每个视频只提取1帧）
  2. 将分析结果存储到视频的 metadata 中
- 调用 API 生成脚本
- 将对话内容 + 视频分析结果发送给 LLM

### 5. 显示结果

生成成功后：
- 关闭进度弹窗
- 在"文本脚本"面板显示生成的脚本
- 每个段落显示关联的视频（如果有）

## 错误处理

### 常见错误

1. **视频理解未开启但没有选择视频**
   - 错误码：400
   - 提示："启用视频理解时必须选择至少一个视频"

2. **视频分析失败**
   - 部分视频分析失败时，仍会继续生成脚本
   - 显示警告："X 个视频分析失败，但将继续生成脚本"

3. **LLM 调用失败**
   - 错误码：500
   - 提示：具体的 LLM 错误信息

4. **参数验证失败**
   - 错误码：400
   - 提示：具体缺失的参数

## 性能优化

1. **视频分析并发**
   - 使用线程池并发分析多个视频
   - 默认最大并发数：5

2. **快速模式**
   - 每个视频只提取1帧（frameInterval = 9999）
   - 适合快速预览和对精度要求不高的场景

3. **缓存机制**
   - 视频分析结果缓存在 metadata 中
   - 避免重复分析相同视频

## 日志记录

### 前端日志

```javascript
// 打开弹窗
console.log('[VideoEditingInterface] 用户点击转换消息为视频脚本', {
  taskId,
  contentLength,
  timestamp
});

// 开始生成
console.log('[useConvertToScript] 开始转换视频脚本', {
  chatContentLength,
  videoCount,
  enableVideoUnderstanding,
  parameters
});

// 视频分析
console.log('[useConvertToScript] 开始并行视频分析（快速模式）', {
  videoCount,
  frameInterval: 9999
});

// 生成成功
console.log('[useConvertToScript] 转换视频脚本成功', {
  generatedSegmentCount,
  totalDuration,
  metadata
});
```

### 后端日志

```python
logger.info(f"[Convert To Script] 收到请求 - Task: {taskId}, "
           f"ChatLength: {len(chatContent)}, "
           f"Videos: {len(selectedVideos)}, "
           f"VideoUnderstanding: {enableVideoUnderstanding}")

logger.info(f"[Convert To Script] 脚本生成成功 - Task: {taskId}, "
           f"Segments: {len(segments)}")
```

## 相关文档

- [视频理解生成脚本 API](./video-script-generation-chat-support.md)
- [视频分析 API](./video-analysis-ui-improvements.md)
- [批量视频分析 API](./video-batch-analysis.md)

