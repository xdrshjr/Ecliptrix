# Video Editing AI Auto-Mix Feature

## 概述

AI自动混剪功能允许用户将所有从文本脚本转换的音频素材和AI匹配的视频素材按照转换顺序自动添加到时间轴的对应轨道中。音频添加到音频轨道，视频添加到视频轨道，严格按照脚本段落的转换顺序进行排列。

## 前置条件

使用AI自动混剪功能前，需要确保：

1. **文本转语音完成**：脚本段落已转换为音频，音频素材包含 `segment_id` 和 `segment_number` 元数据
2. **AI视频匹配完成**：已对脚本段落执行"AI匹配视频"操作，匹配的视频已添加到素材管理并包含相应的段落元数据（重复匹配会自动替换同段落的现有视频）
3. **素材元数据正确**：音频和视频素材都必须包含正确的 `segment_id` 和 `segment_number` 元数据才能被识别和添加

## 功能特性

### 1. 素材识别

#### 1.1 音频素材识别
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

#### 1.2 视频素材识别
- **识别标准**：视频素材必须包含以下元数据：
  - `metadata.segment_id`：标识视频关联的文本段落ID
  - `metadata.segment_number`：标识关联顺序的段落编号
  - `metadata.video_index_in_segment`：段落内视频的索引（可选）

- **筛选逻辑**：
  ```typescript
  const scriptVideoMaterials = materials.filter(material => {
    const isVideo = material.type === 'video';
    const hasSegmentId = material.metadata?.segment_id;
    const hasSegmentNumber = typeof material.metadata?.segment_number === 'number';
    
    return isVideo && hasSegmentId && hasSegmentNumber;
  });
  ```

### 2. 排序规则
- **排序依据**：按照 `metadata.segment_number` 升序排列
- **目的**：确保音频和视频都按照文本脚本的转换顺序添加到时间轴
- **一致性**：音频和视频使用相同的排序逻辑，保证顺序一致

### 3. 时间轴添加

#### 3.1 音频添加
- **目标轨道**：自动添加到 `audio-track-1`（第一个音频轨道）
- **添加方式**：按顺序追加到轨道末尾，不覆盖现有内容
- **时间计算**：每个音频片段的开始时间 = 前一个音频片段的结束时间

#### 3.2 视频添加
- **目标轨道**：自动添加到 `video-track-1`（第一个视频轨道）
- **添加方式**：按顺序追加到轨道末尾，不覆盖现有内容
- **时间计算**：每个视频片段的开始时间 = 前一个视频片段的结束时间
- **执行顺序**：在音频添加完成后延迟200ms执行，确保不冲突

## 用户界面

### 按钮位置
- **位置**：素材管理面板头部，上传按钮左侧
- **样式**：紫色背景，区别于上传按钮的蓝色背景
- **图标**：使用AI/自动化相关的图标

### 按钮行为
- **点击效果**：立即执行自动混剪操作，同时处理音频和视频素材
- **反馈**：通过控制台日志提供详细的操作反馈
- **条件显示**：只有当存在可用的脚本音频或视频素材时才显示

## 技术实现

### 组件架构
```
VideoEditingInterface (主协调组件)
├── MaterialsPanel (包含AI自动混剪按钮)
│   └── onAutoMixAudio() -> 触发自动混剪
└── TimelinePanel (接收并处理素材添加请求)
    └── materialsToAdd prop -> 接收要添加的素材
```

### 数据流
1. **前置准备**：用户完成文本转语音和AI视频匹配，确保素材包含正确的段落元数据
2. **用户点击**：MaterialsPanel 中的"AI自动混剪"按钮
3. **素材筛选**：VideoEditingInterface 筛选和排序脚本音频和视频（基于 `segment_id` 和 `segment_number` 元数据）
4. **音频添加**：首先设置 `materialsToAddToTimeline` 状态添加音频
5. **视频添加**：延迟200ms后设置状态添加视频
6. **时间轴处理**：TimelinePanel 监听状态变化并分别添加音频和视频
7. **状态清理**：延迟清除请求状态，避免重复处理

### 关键函数

#### `handleAutoMixAudio()`
- **位置**：VideoEditingInterface
- **功能**：筛选、排序并触发音频和视频添加
- **日志记录**：详细记录操作过程和结果
- **执行逻辑**：先添加音频，延迟200ms后添加视频

#### `handleAddMaterialsToTimeline()`
- **位置**：TimelinePanel
- **功能**：程序化添加多个素材到指定轨道
- **特性**：支持指定目标轨道，自动计算时间位置

## 日志记录

### 操作日志
- **开始操作**：记录总素材数量和时间戳
- **素材筛选**：记录音频和视频筛选结果及素材详情
- **排序完成**：记录排序后的音频和视频素材列表及总时长
- **音频添加请求**：记录发送到音频轨道的请求详情
- **视频添加请求**：记录发送到视频轨道的请求详情
- **操作完成**：记录处理的素材总数和操作结果

### 错误处理
- **无可用素材**：当没有找到符合条件的音频或视频素材时发出警告
- **轨道兼容性**：确保音频只添加到音频轨道，视频只添加到视频轨道
- **时序控制**：通过延迟机制避免音频和视频添加冲突

## 使用场景

### 典型工作流
1. **脚本编写**：用户在文档面板中编写或生成脚本
2. **音频转换**：使用TTS功能将脚本段落转换为音频
3. **视频关联**：为脚本段落添加相关视频素材
4. **自动混剪**：点击"AI自动混剪"按钮，所有音频和视频自动按顺序添加到时间轴
5. **后续编辑**：用户可以在时间轴中进一步调整素材的位置和属性

### 优势
- **提高效率**：避免手动逐个拖拽音频和视频到时间轴
- **保持顺序**：确保音频和视频都按照脚本的逻辑顺序排列
- **减少错误**：自动化处理减少人工操作错误
- **同步处理**：音频和视频同时处理，保持内容一致性

## 兼容性说明

### 素材要求
- **音频素材**：必须是通过ScriptPanel的TTS功能生成的，包含完整的元数据信息（segment_id和segment_number）
- **视频素材**：必须通过ScriptPanel关联到脚本段落，包含完整的元数据信息（segment_id和segment_number）

### 时间轴要求
- 需要存在至少一个音频轨道（默认使用 `audio-track-1`）
- 需要存在至少一个视频轨道（默认使用 `video-track-1`）

## 后续扩展

### 可能的改进
- **轨道选择**：允许用户选择目标音频和视频轨道
- **插入模式**：支持在指定位置插入而非仅追加
- **批量操作**：支持选择性添加部分音频或视频素材
- **预览功能**：在添加前预览混剪结果
- **智能匹配**：自动匹配音频和视频的时长，优化播放效果
- **多轨道分布**：支持将素材分布到多个轨道以避免重叠 