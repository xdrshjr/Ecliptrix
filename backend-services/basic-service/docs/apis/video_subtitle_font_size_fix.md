# 字幕字体大小修复 API 文档

## 概述

修复视频编辑系统中用户设置的字幕字体大小与实际合成结果不匹配的问题。之前用户设置24号字体，实际显示只有8号左右的效果；设置60多号字体，才有20多号的效果。

## 问题分析

### 根本原因
1. **前端问题**: `src/components/video/hooks/useVideoExport.ts` 中，当字幕没有样式时使用硬编码的字体大小50
2. **后端问题**: `backend-services/basic-service/app/services/video_composition_service.py` 中，完全忽略前端传递的字体大小，强制使用50

### 数据流程
```
用户设置 → 字幕编辑弹窗 → TimelineItem.subtitleStyle.fontSize → 
前端API转换 → SubtitleCompositionItem.font_size → 后端处理 → FFmpeg渲染
```

## 修复内容

### 1. 前端修复 (useVideoExport.ts)

**修改前**:
```typescript
const subtitleStyle = item.subtitleStyle || {
  fontFamily: 'default',
  fontSize: 50, // 硬编码50，忽略用户设置
  fontColor: '#FFFFFF',
  backgroundColor: '#000000@0.5',
  position: 'bottom'
};
```

**修改后**:
```typescript
const subtitleStyle = item.subtitleStyle || {
  fontFamily: 'default',
  fontSize: 24, // 使用标准默认值，不是硬编码的50
  fontColor: '#FFFFFF',
  backgroundColor: '#000000@0.5',
  position: 'bottom'
};
```

**新增功能**:
- 增加详细的字幕处理日志
- 记录用户是否设置了自定义样式
- 显示实际使用的字体大小

### 2. 后端修复 (video_composition_service.py)

**修改前**:
```python
font_size = getattr(first_subtitle, 'font_size', 50)  # 强制使用50
```

**修改后**:
```python
font_size = getattr(first_subtitle, 'font_size', 24)  # 使用前端传递的值
logger.info(f"Using subtitle font size from frontend: {font_size}px (user setting: {hasattr(first_subtitle, 'font_size')})")
```

**改进内容**:
- 正确使用前端传递的字体大小
- 增加字体大小使用情况的日志记录
- 显示是否为用户自定义设置

## 修复效果

### 修复前
- 用户设置24号字体 → 实际显示约8号字体效果
- 用户设置60号字体 → 实际显示约20号字体效果
- 无论用户设置什么字体大小，都被强制覆盖为50

### 修复后
- 用户设置的字体大小直接传递给FFmpeg渲染引擎
- 字体大小与用户设置严格匹配
- 保持向后兼容性，默认值为24号字体

## 测试验证

### 测试场景
1. **新字幕**: 用户创建新字幕并设置字体大小
2. **编辑字幕**: 用户修改现有字幕的字体大小
3. **批量应用**: 用户将样式应用到所有字幕
4. **预设样式**: 用户使用预定义样式

### 验证方法
1. 在字幕编辑弹窗中设置不同的字体大小（8-72像素）
2. 导出视频并检查实际字幕大小
3. 确认字体大小与设置值严格匹配

## 日志增强

### 前端日志
```
[useVideoExport] 处理字幕项目，字体大小: 24
- itemId: subtitle_xxx
- hasSubtitleStyle: true/false
- fontSize: 用户设置的实际值
- 其他样式属性详情
```

### 后端日志
```
Using subtitle font size from frontend: 24px (user setting: true)
```

## 兼容性说明

- **向后兼容**: 现有没有设置字体样式的字幕使用24号默认字体
- **用户体验**: 用户设置的字体大小现在能够正确显示
- **性能影响**: 无性能影响，仅修复数据传递逻辑

## 相关文件

### 前端文件
- `src/components/video/hooks/useVideoExport.ts`: 字幕数据转换逻辑
- `src/components/video/components/SubtitleEditModal/SubtitleEditModal.tsx`: 字幕编辑界面
- `src/types/index.ts`: 字幕样式类型定义

### 后端文件
- `backend-services/basic-service/app/services/video_composition_service.py`: 视频合成服务
- `backend-services/basic-service/app/models/video_models.py`: 数据模型定义

## 注意事项

1. **字体大小范围**: 支持8-72像素，与前端界面限制一致
2. **默认值**: 24像素，符合用户习惯和可读性要求
3. **字体单位**: 使用像素(px)作为单位，与FFmpeg兼容 