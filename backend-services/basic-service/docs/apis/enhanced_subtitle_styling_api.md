# Enhanced Subtitle Styling API

## 概述

增强字幕样式功能为视频编辑系统提供了丰富的字幕样式设置选项，支持多种字体类型、大小、颜色和位置设置。该功能在原有字幕合成基础上进行了扩展，提供更好的用户体验和跨平台兼容性。

## 功能特性

### 字幕样式设置
- **字体类型**：支持4种字体类型（默认、衬线、无衬线、等宽）
- **字体大小**：8-72像素可调节范围
- **字体颜色**：支持十六进制颜色代码
- **背景颜色**：可选的背景色设置
- **字幕位置**：顶部、居中、底部三种位置选择
- **样式预设**：提供4种预定义样式快速应用

### 跨平台字体支持
- **Windows**：支持微软雅黑、黑体、宋体、Arial等系统字体
- **Ubuntu/Linux**：支持DejaVu、Liberation、Noto CJK等开源字体
- **macOS**：支持PingFang、Helvetica、Times等系统字体

## 前端接口

### 字幕样式数据结构

#### SubtitleStyle
```typescript
interface SubtitleStyle {
  fontFamily: SubtitleFontFamily;  // 字体类型
  fontSize: number;                // 字体大小 (8-72px)
  fontColor: string;               // 字体颜色 (十六进制)
  backgroundColor?: string;        // 背景颜色 (可选)
  position: SubtitlePosition;      // 字幕位置
}
```

#### 字体类型枚举
```typescript
type SubtitleFontFamily = 'default' | 'serif' | 'sans-serif' | 'monospace';
```

#### 位置枚举
```typescript
type SubtitlePosition = 'top' | 'center' | 'bottom';
```

#### 样式预设
```typescript
interface SubtitleStylePreset {
  id: string;
  name: string;
  style: SubtitleStyle;
}
```

### 预定义样式预设

#### 1. 默认样式 (default)
```json
{
  "fontFamily": "default",
  "fontSize": 24,
  "fontColor": "#FFFFFF",
  "position": "bottom"
}
```
*注意：默认样式不包含背景颜色，字幕将显示为透明背景*

#### 2. 经典样式 (classic)
```json
{
  "fontFamily": "default",
  "fontSize": 24,
  "fontColor": "#FFFFFF",
  "backgroundColor": "#000000",
  "position": "bottom"
}
```

#### 3. 现代样式 (modern)
```json
{
  "fontFamily": "sans-serif",
  "fontSize": 28,
  "fontColor": "#FFFFFF",
  "position": "bottom"
}
```

#### 4. 优雅样式 (elegant)
```json
{
  "fontFamily": "serif",
  "fontSize": 26,
  "fontColor": "#F0F0F0",
  "backgroundColor": "#1A1A1A",
  "position": "center"
}
```

#### 5. 科技样式 (tech)
```json
{
  "fontFamily": "monospace",
  "fontSize": 22,
  "fontColor": "#00FF00",
  "backgroundColor": "#000000",
  "position": "top"
}
```

## 后端API接口

### 数据模型更新

#### SubtitleCompositionItem
```python
class SubtitleCompositionItem(BaseModel):
    id: str
    name: str
    text: str
    start_time: float
    duration: float
    track_id: str
    font_family: str = "default"           # 新增：字体类型
    font_size: int = Field(24, ge=8, le=72)
    font_color: str = "#FFFFFF"
    background_color: Optional[str] = None
    position: str = "bottom"
```

#### SubtitleAddRequest
```python
class SubtitleAddRequest(BaseModel):
    video_file_path: str
    subtitle_file_path: str
    font_family: str = "default"           # 新增：字体类型
    font_size: int = Field(24, ge=8, le=72)
    font_color: str = "#FFFFFF"
    background_color: Optional[str] = None
    border_width: int = 2
    border_color: str = "#000000"
    position: str = "bottom"
    margin_vertical: int = 50
    margin_horizontal: int = 50
    max_line_width: Optional[int] = None
```

### 字体映射表

#### Windows 字体映射
```python
"default": [
    "C:/Windows/Fonts/msyh.ttc",        # Microsoft YaHei (微软雅黑)
    "C:/Windows/Fonts/simhei.ttf",      # SimHei (黑体)
    "C:/Windows/Fonts/simsun.ttc",      # SimSun (宋体)
    "C:/Windows/Fonts/arial.ttf",       # Arial
],
"serif": [
    "C:/Windows/Fonts/simsun.ttc",      # SimSun (宋体)
    "C:/Windows/Fonts/times.ttf",       # Times New Roman
    "C:/Windows/Fonts/georgia.ttf",     # Georgia
],
"sans-serif": [
    "C:/Windows/Fonts/msyh.ttc",        # Microsoft YaHei
    "C:/Windows/Fonts/simhei.ttf",      # SimHei
    "C:/Windows/Fonts/arial.ttf",       # Arial
],
"monospace": [
    "C:/Windows/Fonts/consola.ttf",     # Consolas
    "C:/Windows/Fonts/cour.ttf",        # Courier New
]
```

#### Ubuntu/Linux 字体映射
```python
"default": [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
],
"serif": [
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSerifCJK-Regular.ttc",
],
"sans-serif": [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
],
"monospace": [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
]
```

## 使用流程

### 1. 前端字幕编辑
1. 用户点击时间轴上的"编辑字幕"按钮
2. 打开增强字幕编辑模态框（左右布局）
3. 左侧面板：样式设置
   - 选择预设样式或自定义设置
   - 调整字体类型、大小、颜色
   - 设置背景颜色和位置
   - 实时预览效果
4. 右侧面板：内容编辑
   - 编辑字幕文本内容
   - 查看时间信息
   - 预览单个字幕效果

### 2. 样式应用
- **单个字幕**：选中特定字幕后修改样式，仅应用到该字幕
- **批量应用**：点击"应用到所有字幕"按钮，将当前样式应用到所有字幕
- **预设快速应用**：点击预设样式按钮快速应用预定义样式

### 3. 视频导出
1. 前端收集时间轴数据，包含字幕样式信息
2. 调用 `/api/video-compose` 接口
3. 后端处理字幕样式，选择合适的字体文件
4. 使用FFmpeg渲染字幕到视频中
5. 返回包含字幕的最终视频

## API请求示例

### 视频合成请求
```json
{
  "task_id": "video_edit_123",
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
      "font_family": "sans-serif",
      "font_size": 28,
      "font_color": "#FFFFFF",
      "background_color": "#000000",
      "position": "bottom"
    }
  ],
  "total_duration": 60.0,
  "aspect_ratio": "16:9"
}
```

## 错误处理

### 字体不可用处理
- 如果指定字体类型不可用，自动降级到默认字体
- 记录详细的字体选择日志
- 确保字幕渲染不会因字体问题失败

### 背景颜色处理
- 当`backgroundColor`为`null`或`undefined`时，字幕将显示为透明背景
- 只有明确设置了背景颜色值时，才会在字幕后面添加背景
- 前端复选框控制背景颜色的启用/禁用状态
- 后端不会强制设置默认背景颜色

### 样式参数验证
- 字体大小限制在8-72像素范围内
- 颜色值必须为有效的十六进制格式
- 位置参数限制为预定义值

## 性能优化

### 字体缓存
- 系统启动时检测可用字体
- 缓存字体路径映射表
- 避免重复的文件系统检查

### 渲染优化
- 使用FFmpeg硬件加速（如可用）
- 批量处理多个字幕项目
- 优化字体文件加载

## 兼容性说明

### 系统要求
- Windows 10/11：支持所有字体类型
- Ubuntu 18.04+：需要安装中文字体包
- macOS 10.14+：支持所有字体类型

### 字体安装建议
#### Ubuntu系统
```bash
# 安装中文字体支持
sudo apt-get install fonts-noto-cjk
sudo apt-get install fonts-liberation
sudo apt-get install fonts-dejavu
```

## 日志记录

### 字幕处理日志
```
[SubtitleService] Using sans-serif font: /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
[VideoComposition] Subtitle request configuration: font_family=sans-serif, font_size=28, font_color=#FFFFFF, position=bottom
[SubtitleService] Processed 5 subtitles in 2.34s
```

### 错误日志
```
[SubtitleService] No serif font found, trying default fonts
[SubtitleService] Using default font: /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
```

## 更新历史

### v1.0.1 (当前版本)
- **Bug修复**：修复了不勾选背景颜色时仍显示背景的问题
- 添加"默认样式"预设，不包含背景颜色
- 改进后端背景颜色处理逻辑，正确处理`null`值
- 增强日志记录，便于调试背景颜色问题

### v1.0.0
- 新增字体类型支持（default, serif, sans-serif, monospace）
- 增强字幕编辑界面（左右布局）
- 添加4种预设样式
- 跨平台字体兼容性支持
- 完善API文档和错误处理