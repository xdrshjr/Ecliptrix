# Video Subtitle Composition API

## 概述

视频字幕合成功能是视频合成API的一部分，支持将时间轴上的字幕轨道自动渲染到最终视频中。该功能在视频和音频合成完成后自动执行，无需额外的API调用。

## 功能特性

### 自动字幕合成
- **时间轴集成**：直接从前端时间轴的字幕轨道获取字幕信息
- **SRT转换**：自动将字幕轨道项目转换为标准SRT格式
- **视频渲染**：使用FFmpeg将字幕直接渲染到视频中
- **样式支持**：支持字体大小、颜色、背景色、位置等样式设置

### 字幕样式配置
- **字体大小**：8-72像素，默认24像素
- **字体颜色**：十六进制颜色代码，默认白色(#FFFFFF)
- **背景颜色**：可选的背景色，默认黑色(#000000)
- **位置设置**：支持顶部(top)、居中(center)、底部(bottom)，默认底部
- **边框设置**：自动添加2像素黑色边框提高可读性

## 数据模型

### SubtitleCompositionItem

字幕合成项目的数据结构：

```json
{
  "id": "string",                    // 字幕项目唯一标识符
  "name": "string",                  // 字幕项目显示名称
  "text": "string",                  // 字幕文本内容
  "start_time": 0.0,                // 字幕开始时间（秒）
  "duration": 5.0,                  // 字幕显示时长（秒）
  "track_id": "string",             // 所属轨道ID
  "font_size": 24,                  // 字体大小（8-72像素）
  "font_color": "#FFFFFF",          // 字体颜色（十六进制）
  "background_color": "#000000",    // 背景颜色（可选）
  "position": "bottom"              // 字幕位置（top/center/bottom）
}
```

## 处理流程

### 1. 字幕数据收集
- 从视频合成请求的 `subtitle_items` 数组中获取所有字幕项目
- 按 `start_time` 对字幕项目进行排序
- 记录详细的字幕信息日志

### 2. SRT文件生成
- 将字幕项目转换为SubtitleService兼容的SRT格式
- 时间格式：MM:SS.mm --> MM:SS.mm（分钟:秒.厘秒）
- 自动生成序号和时间戳
- 保存到临时目录

### 3. 字幕渲染
- 使用SubtitleService进行字幕渲染
- 应用字体样式和位置设置
- 将字幕直接烧录到视频中
- 生成带字幕的最终视频文件

### 4. 错误处理
- 字幕处理失败时继续视频合成
- 详细的错误日志记录
- 优雅降级，确保视频输出

## 使用示例

### 基本字幕合成请求

```json
{
  "task_id": "export_video_001",
  "video_items": [...],
  "audio_items": [...],
  "subtitle_items": [
    {
      "id": "subtitle_001",
      "name": "开场字幕",
      "text": "欢迎观看我们的视频教程",
      "start_time": 0.0,
      "duration": 3.0,
      "track_id": "subtitle-track-1",
      "font_size": 28,
      "font_color": "#FFFFFF",
      "background_color": "#000000",
      "position": "bottom"
    },
    {
      "id": "subtitle_002", 
      "name": "中间字幕",
      "text": "这里是重要的知识点",
      "start_time": 10.5,
      "duration": 4.0,
      "track_id": "subtitle-track-1",
      "font_size": 24,
      "font_color": "#FFFF00",
      "position": "center"
    }
  ],
  "total_duration": 30.0,
  "aspect_ratio": "16:9",
  "output_fps": 30,
  "output_format": "mp4"
}
```

### 多样式字幕示例

```json
{
  "subtitle_items": [
    {
      "id": "title_subtitle",
      "text": "视频标题",
      "start_time": 0.0,
      "duration": 2.0,
      "font_size": 36,
      "font_color": "#FFD700",
      "position": "top"
    },
    {
      "id": "content_subtitle",
      "text": "正文内容说明",
      "start_time": 5.0,
      "duration": 8.0,
      "font_size": 24,
      "font_color": "#FFFFFF",
      "background_color": "#000000",
      "position": "bottom"
    },
    {
      "id": "highlight_subtitle",
      "text": "重点提示信息",
      "start_time": 15.0,
      "duration": 3.0,
      "font_size": 28,
      "font_color": "#FF0000",
      "position": "center"
    }
  ]
}
```

## 技术实现

### SRT时间格式转换

字幕时间从秒数转换为SRT标准格式：

```python
def _seconds_to_srt_time(self, seconds: float) -> str:
    """将秒数转换为SubtitleService兼容的时间格式 (MM:SS.mm)"""
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    centiseconds = int((seconds % 1) * 100)  # 使用厘秒（2位数字）
    
    return f"{minutes:02d}:{secs:02d}.{centiseconds:02d}"
```

### 字幕文件生成

生成的SRT文件格式示例：

```
1
00:00.00 --> 00:03.00
欢迎观看我们的视频教程

2
00:10.50 --> 00:14.50
这里是重要的知识点
```

## 日志记录

### 字幕处理日志

系统会记录详细的字幕处理日志：

```
[INFO] Starting subtitle processing for 2 subtitle items
[INFO] Subtitle 1: '欢迎观看我们的视频教程' at 0.0s for 3.0s
[INFO] Subtitle 2: '这里是重要的知识点' at 10.5s for 4.0s
[INFO] Creating SRT file with 2 subtitle entries
[INFO] SRT file created successfully: /tmp/video_compose_xxx/subtitles.srt
[INFO] Subtitle request configuration: font_size=28, font_color=#FFFFFF, position=bottom
[INFO] Subtitle addition successful: /path/to/output_with_subtitles.mp4
[INFO] Processed 2 subtitles in 3.45s
[INFO] Subtitles successfully added to video
```

### 错误处理日志

```
[ERROR] Subtitle processing error: Failed to create SRT file
[WARNING] Subtitle processing failed - continuing without subtitles
[WARNING] Continuing video composition without subtitles
```

## 性能考虑

### 处理时间
- 字幕渲染会增加视频处理时间
- 处理时间取决于字幕数量和视频长度
- 通常每个字幕项目增加1-2秒处理时间

### 文件大小
- 字幕烧录到视频中会略微增加文件大小
- 增加量通常在5-10%范围内
- 不会显著影响视频质量

## 限制和注意事项

### 字幕限制
- 最大字体大小：72像素
- 最小字体大小：8像素
- 支持的位置：top、center、bottom
- 字幕文本长度建议不超过100字符

### 兼容性
- 字幕直接烧录到视频中，无法后续编辑
- 输出的视频文件包含硬字幕
- 支持所有主流视频播放器

### 错误恢复
- 字幕处理失败不会影响视频合成
- 系统会继续生成不带字幕的视频
- 详细错误信息记录在日志中

## 相关API

- [Video Composition API](video_composition_api.md) - 主要的视频合成接口
- [Subtitle Add API](subtitle_add_api.md) - 独立的字幕添加接口

## 更新历史

- **2024-01**: 初始版本，支持基本字幕合成功能
- **2024-01**: 添加多样式字幕支持和错误处理优化 