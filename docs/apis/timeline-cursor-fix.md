# Timeline游标跳转修复

## 问题描述

在Video Editing功能中，当timeline中添加同一个视频素材多次时，用户点击后面的相同视频素材时，游标会错误地自动跳转到第一个素材片段的位置。

## 问题根源

问题位于 `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx` 文件的 `handleTimeUpdate` 函数中：

```typescript
// 原始有问题的逻辑
for (let i = 0; i < compositionPlayback.videoSequences.length; i++) {
  const sequence = compositionPlayback.videoSequences[i];
  if (currentVideoSrc.includes(sequence.url) || sequence.url.includes(currentVideoSrc.split('/').pop() || '')) {
    actualSequenceIndex = i;
    currentSequence = sequence;
    foundSequence = true;
    break; // 问题关键：总是返回第一个匹配URL的序列
  }
}
```

**问题分析**：
- 当多个相同素材存在时，所有素材的URL都相同
- `find()` 和循环中的 `break` 总是返回第一个匹配的元素
- 导致系统错误地认为当前应该播放第一个素材
- 游标因此跳转到第一个素材片段的位置

## 解决方案

### 主要修改

1. **改进序列查找逻辑**：不仅基于URL匹配，还要考虑当前的时间位置
2. **优先验证状态序列**：首先检查当前状态中的序列是否正确
3. **基于时间范围重新定位**：如果状态序列不匹配，根据组合播放时间重新查找

### 修复后的逻辑

```typescript
// 改进的序列查找逻辑：基于当前组合时间和URL匹配找到正确的素材片段
// 避免相同视频素材多次使用时总是跳转到第一个素材的问题

// 首先尝试基于当前状态的序列索引进行验证
const stateSequenceIndex = compositionPlayback.currentSequenceIndex;
const stateSequence = compositionPlayback.videoSequences[stateSequenceIndex];

// 检查状态中的序列是否与当前播放的视频URL匹配
if (stateSequence && 
    (currentVideoSrc.includes(stateSequence.url) || 
     stateSequence.url.includes(currentVideoSrc.split('/').pop() || ''))) {
  // 状态序列匹配当前视频URL，直接使用
  actualSequenceIndex = stateSequenceIndex;
  currentSequence = stateSequence;
  foundSequence = true;
} else {
  // 状态序列不匹配，需要基于组合播放时间重新定位正确的序列
  let accumulatedTime = 0;
  
  for (let i = 0; i < compositionPlayback.videoSequences.length; i++) {
    const sequence = compositionPlayback.videoSequences[i];
    const sequenceStartTime = accumulatedTime;
    const sequenceEndTime = accumulatedTime + sequence.duration;
    
    // 检查URL匹配且当前组合时间落在这个序列的时间范围内
    if ((currentVideoSrc.includes(sequence.url) || 
         sequence.url.includes(currentVideoSrc.split('/').pop() || '')) &&
        compositionCurrentTime >= sequenceStartTime && 
        compositionCurrentTime < sequenceEndTime) {
      actualSequenceIndex = i;
      currentSequence = sequence;
      foundSequence = true;
      break;
    }
    accumulatedTime += sequence.duration;
  }
}
```

## 技术细节

### 修改文件
- `src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx`

### 核心改进
1. **双重验证机制**：
   - 首先验证状态中的序列是否正确
   - 如果不正确，基于时间范围重新查找

2. **时间范围匹配**：
   - 计算每个序列的时间范围
   - 确保当前组合时间落在正确的序列范围内
   - 同时验证URL匹配

3. **增强的日志记录**：
   - 详细记录序列匹配过程
   - 帮助调试相同素材的问题
   - 包含序列ID、名称、时间范围等信息

## 日志输出

### 正常匹配时
```
使用状态中的序列索引（验证匹配）
- sequenceIndex: 1
- sequenceName: "视频素材A_第2次"
- sequenceId: "item_abc123"
- reason: "状态序列与当前视频URL匹配"
```

### 重新定位时
```
重新定位到正确的序列（基于时间范围和URL匹配）
- sequenceIndex: 2
- sequenceName: "视频素材A_第3次"
- compositionTime: 15.30
- sequenceStartTime: 10.00
- sequenceEndTime: 20.00
- reason: "基于时间范围重新定位避免相同素材跳转问题"
```

## 测试场景

### 测试用例1：相同素材多次添加
1. 添加同一个视频素材3次到timeline
2. 点击第2个素材片段
3. **修复前**：游标跳转到第1个素材
4. **修复后**：游标正确定位在第2个素材

### 测试用例2：时间范围验证
1. 播放包含相同素材的组合
2. 在第2个相同素材播放期间
3. **修复前**：系统错误识别为第1个素材
4. **修复后**：正确识别当前播放的素材

## 兼容性

- ✅ 向后兼容：不影响现有功能
- ✅ 性能优化：优先验证当前状态，减少不必要的循环
- ✅ 错误处理：包含多层回退机制

## 相关功能

- Timeline面板素材选择
- 视频组合播放
- 游标时间同步
- 素材片段定位 