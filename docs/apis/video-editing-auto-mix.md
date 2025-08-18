# Video Editing AI Auto-Mix Feature

## 概述

AI自动混剪功能允许用户将所有从文本脚本转换的音频素材按照转换顺序自动添加到时间轴的音频轨道中。

## 功能特性

### 1. 音频素材识别
- **识别标准**：音频素材必须包含以下元数据：
  - `metadata.segment_id`：标识音频来源的文本段落ID
  - `metadata.segment_number`：标识转换顺序的段落编号

- **筛选逻辑**：
  ```typescript
  const scriptAudioMaterials = materials.filter(material => {
    const isAudio = material.type === 'audio';
    const hasSegmentId = material.metadata?.segment_id;
    const hasSegmentNumber = typeof material.metadata?.segment_number === 'number';
    
    return isAudio && hasSegmentId && hasSegmentNumber;
  });
  ```

### 2. 排序规则
- **排序依据**：按照 `metadata.segment_number` 升序排列
- **目的**：确保音频按照文本脚本的转换顺序添加到时间轴

### 3. 时间轴添加
- **目标轨道**：自动添加到 `audio-track-1`（第一个音频轨道）
- **添加方式**：按顺序追加到轨道末尾，不覆盖现有内容
- **时间计算**：每个音频片段的开始时间 = 前一个音频片段的结束时间

## 用户界面

### 按钮位置
- **位置**：素材管理面板头部，上传按钮左侧
- **样式**：紫色背景，区别于上传按钮的蓝色背景
- **图标**：使用AI/自动化相关的图标

### 按钮行为
- **点击效果**：立即执行自动混剪操作
- **反馈**：通过控制台日志提供详细的操作反馈
- **条件显示**：只有当存在可用的脚本音频素材时才显示

## 技术实现

### 组件架构
```
VideoEditingInterface (主协调组件)
├── MaterialsPanel (包含AI自动混剪按钮)
│   └── onAutoMixAudio() -> 触发自动混剪
└── TimelinePanel (接收并处理音频添加请求)
    └── materialsToAdd prop -> 接收要添加的素材
```

### 数据流
1. **用户点击**：MaterialsPanel 中的"AI自动混剪"按钮
2. **素材筛选**：VideoEditingInterface 筛选和排序脚本音频
3. **状态更新**：设置 `materialsToAddToTimeline` 状态
4. **时间轴处理**：TimelinePanel 监听状态变化并添加音频
5. **状态清理**：延迟清除请求状态，避免重复处理

### 关键函数

#### `handleAutoMixAudio()`
- **位置**：VideoEditingInterface
- **功能**：筛选、排序并触发音频添加
- **日志记录**：详细记录操作过程和结果

#### `handleAddMaterialsToTimeline()`
- **位置**：TimelinePanel
- **功能**：程序化添加多个素材到指定轨道
- **特性**：使用setTimeout确保顺序添加

## 日志记录

### 操作日志
- **开始操作**：记录总素材数量和时间戳
- **素材筛选**：记录筛选结果和素材详情
- **排序完成**：记录排序后的素材列表和总时长
- **添加请求**：记录发送到时间轴的请求详情
- **状态清理**：记录状态清除操作

### 错误处理
- **无音频素材**：当没有找到符合条件的音频时发出警告
- **轨道兼容性**：确保音频只添加到音频轨道

## 使用场景

### 典型工作流
1. **脚本编写**：用户在文档面板中编写或生成脚本
2. **音频转换**：使用TTS功能将脚本段落转换为音频
3. **自动混剪**：点击"AI自动混剪"按钮，所有音频自动按顺序添加到时间轴
4. **后续编辑**：用户可以在时间轴中进一步调整音频的位置和属性

### 优势
- **提高效率**：避免手动逐个拖拽音频到时间轴
- **保持顺序**：确保音频按照脚本的逻辑顺序排列
- **减少错误**：自动化处理减少人工操作错误

## 兼容性说明

### 素材要求
- 音频素材必须是通过ScriptPanel的TTS功能生成的
- 必须包含完整的元数据信息（segment_id和segment_number）

### 时间轴要求
- 需要存在至少一个音频轨道
- 默认使用 `audio-track-1` 作为目标轨道

## 后续扩展

### 可能的改进
- **轨道选择**：允许用户选择目标音频轨道
- **插入模式**：支持在指定位置插入而非仅追加
- **批量操作**：支持选择性添加部分音频素材
- **预览功能**：在添加前预览混剪结果 