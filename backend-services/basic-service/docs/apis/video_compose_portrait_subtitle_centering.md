# Video Compose API - Portrait Video Subtitle Centering

## 概述

本文档描述了video-compose接口中针对竖屏视频的字幕居中优化功能。该功能确保竖屏视频中的多行字幕每一行都能水平居中显示，提供更好的视觉效果。

## 功能背景

### 问题描述
在竖屏视频（如9:16比例的抖音、Instagram Stories等短视频）中，由于水平空间有限，字幕文本经常需要换行显示。传统的FFmpeg drawtext滤镜在处理多行文本时，只能实现整体文本块的居中，而每一行内部仍然是左对齐的，这在视觉上显得不够美观。

### 解决方案
新功能通过自动检测竖屏视频（宽高比 < 1.0），并为每行字幕文本生成独立的drawtext滤镜，确保每一行都能单独水平居中。

## 技术实现

### 自动检测机制
```python
aspect_ratio = video_width / video_height
is_portrait = aspect_ratio < 1.0  # 竖屏视频检测
```

### 处理流程

1. **视频类型检测**
   - 计算视频宽高比
   - 自动识别竖屏视频（aspect_ratio < 1.0）

2. **文本换行处理**
   - 根据竖屏视频的限制计算最大行宽
   - 将长字幕文本智能换行

3. **独立行居中**
   - 为每行文本创建单独的drawtext滤镜
   - 每行使用 `x=(w-text_w)/2` 实现水平居中
   - 计算合适的垂直间距和位置

### 关键算法

#### 行高计算
```python
line_height = font_size + 5  # 字体大小 + 行间距
```

#### 总体定位
```python
total_text_height = num_lines * line_height

# 根据position参数计算起始Y坐标
if position == "top":
    start_y = margin_vertical
elif position == "center":
    start_y = (video_height - total_text_height) // 2
else:  # bottom
    start_y = video_height - total_text_height - margin_vertical
```

#### 单行定位
```python
for line_index, line_text in enumerate(wrapped_lines):
    line_y = start_y + (line_index * line_height)
    # 每行独立居中: x=(w-text_w)/2
```

## API使用

### 请求格式
无需特殊配置，现有的video-compose接口会自动处理：

```json
{
  "task_id": "portrait_video_task",
  "aspect_ratio": "9:16",
  "video_items": [...],
  "subtitle_items": [
    {
      "id": "subtitle_1",
      "name": "长字幕测试",
      "text": "这是一段比较长的字幕文本，在竖屏视频中会被自动换行并居中显示",
      "start_time": 0.0,
      "duration": 5.0,
      "track_id": "subtitle_track_1",
      "font_size": 50,
      "font_color": "#FFFFFF",
      "background_color": "#000000@0.5",
      "position": "bottom"
    }
  ]
}
```

### 响应特点
竖屏视频处理时会产生更详细的日志信息：

```json
{
  "success": true,
  "status": "completed",
  "message": "Video composition completed successfully",
  "composition_id": "comp_12345",
  "logs": [
    "Video aspect ratio: 0.56 (1080x1920)",
    "Portrait video detected - using multi-line centered subtitle rendering",
    "Portrait subtitle '这是一段比较长的字幕文本...' wrapped into 3 lines",
    "Generated 9 individual line filters for portrait video multi-line centering"
  ]
}
```

## 日志记录

### 详细日志示例
```
[2024-01-15 10:30:15] [INFO] [SubtitleService] Video aspect ratio: 0.56 (1080x1920)
[2024-01-15 10:30:15] [INFO] [SubtitleService] Portrait video detected - using multi-line centered subtitle rendering for optimal display
[2024-01-15 10:30:15] [INFO] [SubtitleService] Portrait video max line width: 6 characters
[2024-01-15 10:30:15] [INFO] [SubtitleService] Portrait subtitle '这是一段比较长的字幕文本...' wrapped into 3 lines
[2024-01-15 10:30:15] [INFO] [SubtitleService] Portrait subtitle positioning: start_y=1620, total_height=165, lines=3
[2024-01-15 10:30:15] [DEBUG] [SubtitleService] Portrait line 1/3: '这是一段' at y=1620
[2024-01-15 10:30:15] [DEBUG] [SubtitleService] Portrait line 2/3: '比较长的' at y=1675
[2024-01-15 10:30:15] [DEBUG] [SubtitleService] Portrait line 3/3: '字幕文本' at y=1730
[2024-01-15 10:30:15] [INFO] [SubtitleService] Generated 9 individual line filters for portrait video multi-line centering
```

## 性能影响

### 处理时间
- **竖屏视频**: 由于需要生成更多的drawtext滤镜，处理时间可能增加10-20%
- **横屏视频**: 无任何性能影响，使用原有标准处理流程

### 内存使用
- **滤镜数量**: 竖屏视频可能产生3-5倍的滤镜数量（取决于文本长度）
- **内存开销**: 每个额外滤镜的内存开销极小

### 优化建议
- 合理控制字幕文本长度
- 使用适当的字体大小（推荐50px）
- 避免在单个字幕中使用过长的文本

## 兼容性

### 向后兼容
- **横屏视频**: 完全兼容，处理逻辑不变
- **现有API**: 无需修改现有调用代码
- **参数保持**: 所有现有参数继续有效

### 自动检测
- **无需配置**: 系统自动检测视频类型
- **透明处理**: 用户无需关心内部实现差异
- **一致体验**: API调用方式保持一致

## 支持的视频格式

### 竖屏比例检测
以下宽高比会触发竖屏优化：
- 9:16 (Instagram Stories, TikTok)
- 3:4 (部分社交媒体)
- 任何 aspect_ratio < 1.0 的比例

### 字幕样式支持
竖屏优化支持所有现有字幕样式：
- **字体大小**: 8-72像素
- **字体颜色**: 任意十六进制颜色
- **背景颜色**: 支持透明度
- **边框样式**: 可配置边框宽度和颜色
- **位置设置**: top/center/bottom

## 故障排除

### 常见问题

1. **字幕显示异常**
   ```
   问题: 竖屏视频字幕未居中
   检查: 确认视频宽高比是否 < 1.0
   日志: 查看是否有"Portrait video detected"日志
   ```

2. **处理时间过长**
   ```
   问题: 竖屏视频处理速度较慢
   原因: 多行字幕生成更多滤镜
   优化: 减少字幕文本长度或调整字体大小
   ```

3. **内存使用过高**
   ```
   问题: 处理大量竖屏字幕时内存占用高
   解决: 分批处理或优化字幕数量
   ```

### 调试建议

1. **启用详细日志**
   - 设置日志级别为DEBUG
   - 检查aspect_ratio计算结果
   - 验证行数和位置计算

2. **验证输出**
   - 检查生成的drawtext滤镜数量
   - 确认每行的Y坐标计算
   - 测试不同字体大小的效果

## 相关接口

- **主接口**: `POST /api/video-compose`
- **状态查询**: `GET /api/video-compose/{compositionId}/status`
- **结果下载**: `GET /api/video-compose/{compositionId}/download`

## 参考资料

- [Video Composition API 主文档](./video_composition_api.md)
- [字幕样式配置文档](./video_subtitle_composition.md)
- [宽高比支持文档](./README_ASPECT_RATIOS.md) 