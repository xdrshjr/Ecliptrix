# 空格键播放/暂停控制 API 文档

## 概述

视频编辑界面的全局空格键播放/暂停功能，允许用户无论当前焦点在哪个面板，都能通过空格键从timeline游标位置开始播放/暂停视频预览。

## 功能特性

### 1. 全局空格键支持
- **触发条件**: 按下空格键
- **作用范围**: 整个视频编辑界面，不受当前面板焦点影响
- **智能过滤**: 自动排除输入框、文本域等编辑状态下的空格键

### 2. Timeline游标同步
- **播放起点**: 始终从当前timeline游标位置开始播放
- **自动跳转**: 如果视频播放器当前时间与timeline游标时间不同步（差异>0.1秒），会先自动跳转到游标位置
- **模式支持**: 支持预览模式和组合播放模式

## API 接口

### VideoPlayerPanelRef 接口扩展

```typescript
export interface VideoPlayerPanelRef {
  handleCompositionSeek: (
    compositionTime: number, 
    targetSequence: VideoSequenceItem, 
    videoTime: number, 
    source: 'timeline' | 'player'
  ) => Promise<void>;
  
  // 新增：从timeline游标位置播放/暂停
  handlePlayPauseFromTimeline: (timelineTime: number) => Promise<void>;
}
```

### handlePlayPauseFromTimeline 方法

**参数**:
- `timelineTime: number` - 当前timeline游标时间（秒）

**功能**:
1. 检查视频播放器当前时间与timeline时间是否同步
2. 如果不同步（差异>0.1秒），先跳转到timeline时间
3. 执行播放/暂停操作

**支持模式**:
- **预览模式**: 直接在当前视频上跳转和播放/暂停
- **组合模式**: 计算目标视频序列，跳转到正确的视频片段和时间点

## 实现架构

### 1. 全局键盘事件处理
- **位置**: `VideoEditingInterface.tsx`
- **监听器**: 文档级别的keydown事件
- **过滤逻辑**: 排除输入框等编辑状态

### 2. 视频播放器方法
- **位置**: `VideoPlayerPanel.tsx`
- **方法**: `handlePlayPauseFromTimeline`
- **接口**: 通过`useImperativeHandle`暴露给父组件

### 3. Timeline同步
- **状态**: `timelineCurrentTime`
- **同步**: 实时传递给视频播放器
- **精度**: 0.1秒误差容忍

## 日志记录

### 全局键盘事件日志
```javascript
console.log(`[VideoEditingInterface] 全局空格键触发播放/暂停`, {
  taskId,
  timelineCurrentTime: timelineCurrentTime.toFixed(2),
  focusedElement: target.tagName,
  focusedElementClass: target.className,
  action: 'spacebar_global_playpause',
  timestamp: new Date().toISOString()
});
```

### 播放/暂停操作日志
```javascript
logger.info('从Timeline游标位置播放/暂停', {
  timelineTime: timelineTime.toFixed(2),
  currentVideoTime: getCurrentTime().toFixed(2),
  currentlyPlaying: getCurrentlyPlaying(),
  playbackMode,
  action: 'spacebar_from_timeline',
  timestamp: new Date().toISOString()
});
```

### 时间同步日志
```javascript
logger.info('Timeline时间与视频时间不同步，先跳转', {
  timelineTime: timelineTime.toFixed(2),
  currentVideoTime: currentVideoTime.toFixed(2),
  timeDifference: timeDifference.toFixed(2),
  threshold: 0.1
});
```

## 使用场景

1. **脚本编辑**: 用户在脚本面板编辑文本时，可以随时按空格键预览当前timeline位置的视频
2. **素材管理**: 在素材面板选择素材时，可以快速预览timeline当前位置
3. **AI助手交互**: 与AI助手对话时，可以随时播放/暂停视频预览
4. **Timeline编辑**: 在timeline上调整素材时，可以即时预览效果

## 技术细节

### 输入框过滤逻辑
```javascript
const isInInputField = target.tagName === 'INPUT' || 
                      target.tagName === 'TEXTAREA' || 
                      target.contentEditable === 'true' ||
                      target.closest('input') ||
                      target.closest('textarea') ||
                      target.closest('[contenteditable="true"]');
```

### 时间同步阈值
- **阈值**: 0.1秒
- **原因**: 避免微小的时间差异导致不必要的跳转
- **精度**: 足够精确以保证用户体验

## 兼容性

- **浏览器**: 支持所有现代浏览器
- **设备**: 桌面端和移动端（如果支持键盘输入）
- **模式**: 预览模式和组合播放模式

## 更新历史

- **v1.0** (2024): 初始实现，支持全局空格键播放/暂停功能
- 移除了原有的仅在视频播放器面板焦点时才生效的空格键功能
- 新增timeline游标位置同步播放功能 