# Video Compose API - Ubuntu中文字幕乱码修复

## 问题描述

在Ubuntu系统中，通过`/api/video-compose`接口合成视频时，中文字幕出现乱码问题。

## 问题原因

原因是在`SubtitleService`的字体处理逻辑中，Linux系统的字体优先级配置错误：
- 不支持中文的字体（如DejaVuSans.ttf）被优先使用
- 中文字体（如NotoSansCJK）排在后面，导致FFmpeg使用了错误的字体

## 修复方案

### 1. 智能字体选择

修改了`SubtitleService._get_font_path()`方法，增加了以下功能：

#### 1.1 中文字符检测
```python
def _contains_chinese(self, text: str) -> bool:
    """检测文本是否包含中文字符"""
    # 检查CJK统一汉字、扩展区等Unicode范围
```

#### 1.2 动态字体优先级
- **包含中文时**：优先使用中文字体（Noto CJK、文泉驿等）
- **纯英文时**：使用标准拉丁字体，中文字体作为备选

### 2. 完善的Ubuntu中文字体支持

增加了更多Ubuntu系统中常见的中文字体路径：

```python
chinese_fonts = [
    # Noto CJK 字体 - 最佳中文支持
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    # 文泉驿字体 - 常见的开源中文字体
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    # 思源字体
    "/usr/share/fonts/opentype/source-han-sans/SourceHanSansCN-Regular.otf",
    # AR PL 字体
    "/usr/share/fonts/truetype/arphic/uming.ttc",
    # Droid 字体
    "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
]
```

### 3. 增强的日志记录

添加了详细的字体查找日志：
- 记录是否检测到中文字符
- 记录字体搜索过程
- 提供字体安装建议

## API接口

### POST /api/video-compose

此修复对现有API接口无影响，保持完全向后兼容。

**请求示例：**
```json
{
  "task_id": "task_123",
  "video_items": [...],
  "audio_items": [...],
  "subtitle_items": [
    {
      "id": "sub_1",
      "text": "这是中文字幕测试",
      "start_time": 0.0,
      "duration": 3.0,
      "font_size": 24,
      "font_color": "#FFFFFF"
    }
  ],
  "total_duration": 30.0
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "Video composition started successfully",
  "composition_id": "comp_456",
  "status": "processing",
  "progress": 0.0
}
```

## 系统要求

### 推荐字体安装

为确保最佳的中文字幕支持，建议在Ubuntu系统上安装以下字体包：

```bash
# 安装Noto CJK字体（推荐）
sudo apt-get install fonts-noto-cjk

# 安装文泉驿字体（备选）
sudo apt-get install fonts-wqy-microhei fonts-wqy-zenhei

# 安装思源字体（可选）
sudo apt-get install fonts-source-han-sans-cn
```

### 字体检查

可以通过以下命令检查系统中可用的中文字体：

```bash
# 列出所有中文字体
fc-list :lang=zh

# 检查特定字体是否存在
ls /usr/share/fonts/opentype/noto/NotoSansCJK*
```

## 日志示例

修复后的字体选择过程会产生如下日志：

```
[INFO] Getting font path for system: linux, family: default, has_chinese: True
[INFO] Chinese characters detected, prioritizing Chinese fonts
[INFO] Searching for default fonts, checking 13 font paths
[INFO] Found suitable font (#1): /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
```

## 测试验证

### 1. 中文字幕测试
```json
{
  "subtitle_items": [
    {
      "text": "测试中文字幕显示效果",
      "start_time": 0.0,
      "duration": 5.0
    }
  ]
}
```

### 2. 混合文本测试
```json
{
  "subtitle_items": [
    {
      "text": "Mixed text 混合文本 test",
      "start_time": 0.0,
      "duration": 5.0
    }
  ]
}
```

### 3. 纯英文测试
```json
{
  "subtitle_items": [
    {
      "text": "Pure English subtitle",
      "start_time": 0.0,
      "duration": 5.0
    }
  ]
}
```

## 故障排除

### 1. 字幕仍然乱码

**可能原因：**
- 系统未安装中文字体
- 字体文件路径不正确

**解决方案：**
```bash
# 检查日志中的字体搜索过程
tail -f logs/app.log | grep "font"

# 安装推荐的中文字体
sudo apt-get update
sudo apt-get install fonts-noto-cjk fonts-wqy-microhei
```

### 2. 字体文件不存在

**日志表现：**
```
[ERROR] No suitable font found on the system!
[ERROR] Please install Chinese fonts: sudo apt-get install fonts-noto-cjk fonts-wqy-microhei
```

**解决方案：**
按照日志提示安装相应字体包。

## 技术细节

### 修改的文件
- `app/services/subtitle_service.py` - 主要修复逻辑

### 关键修改点
1. 新增`_contains_chinese()`方法检测中文字符
2. 改进`_get_font_path()`方法支持智能字体选择
3. 重新排列Ubuntu字体优先级
4. 增强日志记录和错误提示

### 性能影响
- 中文字符检测：O(n)时间复杂度，n为字符数量
- 字体查找：无性能影响，仍为顺序查找
- 内存占用：基本无增加

## 版本兼容性

此修复完全向后兼容，不影响现有API调用方式和响应格式。 