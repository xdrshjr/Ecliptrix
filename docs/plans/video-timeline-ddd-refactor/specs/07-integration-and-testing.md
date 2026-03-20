# Spec 07: 集成策略与测试计划

## 1. 概述

定义重构过程中的集成策略（如何从旧架构过渡到新架构）和测试计划（Domain 层单元测试 + Store 集成测试）。

## 2. 集成策略：先提取后重组

### Phase 1: 提取 Domain 层 (无 UI 变更)

```
步骤:
1.1 创建 domain/ 目录结构
1.2 实现值对象 (TimePosition, Duration, Volume, ZoomLevel, TrackType)
1.3 实现实体 (TimelineItem, Track)
1.4 实现聚合根 (TimelineAggregate)
1.5 实现领域服务 (TrackSelectionService, ItemPlacementService,
    DragCalculationService, HistoryService, DurationCalculationService)
1.6 编写 Domain 层单元测试

验证: 所有单元测试通过
UI 影响: 无 — 这些都是新文件
```

### Phase 2: 建立 Zustand Store (并行运行)

```
步骤:
2.1 安装 zustand 依赖
2.2 创建 store/ 目录和 slice 骨架
2.3 实现 timelineSlice (调用 TimelineAggregate)
2.4 实现 historySlice (封装 HistoryService)
2.5 实现 selectionSlice
2.6 实现 uiSlice
2.7 编写 Store 集成测试

验证: Store 测试通过；现有 UI 不受影响
UI 影响: 无 — Store 创建但尚未接入 UI
```

### Phase 3: 引入 XState 拖拽状态机

```
步骤:
3.1 安装 xstate 依赖
3.2 实现 dragMachine 定义
3.3 实现 dragSlice (将状态机集成到 store)
3.4 编写拖拽状态机测试

验证: 状态机测试通过
UI 影响: 无 — 状态机创建但尚未接入 UI
```

### Phase 4: 瘦化 UI 组件 (逐组件切换)

```
切换顺序 (从叶子到根):
4.1 SentenceSegmentBar — 几乎无变化
4.2 VolumeSlider — 改为从 store 读取
4.3 TimelineItem — 去掉拖拽逻辑，使用 store
4.4 Track — 去掉 callback props，使用 store
4.5 TimelineRuler — 使用 store
4.6 TimelineToolbar — 使用 store
4.7 TrackContainer — 使用 store
4.8 TimelinePanel — 最后瘦化，去掉所有 useState

每个组件切换后:
  ✓ 手动验证 UI 行为不变
  ✓ 确认无 console 错误
  ✓ 如果出问题 → 回退该组件，保留旧代码
```

### Phase 5: 清理与验证

```
步骤:
5.1 删除旧的内联业务逻辑代码
5.2 删除不再使用的 callback props
5.3 更新 TimelinePanel 对外接口 (减少 props)
5.4 更新 VideoEditingInterface 的调用方式
5.5 移动/删除旧的 service 文件
5.6 Infrastructure 层适配器实现
5.7 最终集成验证
5.8 运行 npm run type-check 确认无类型错误
5.9 运行 npm run build 确认构建通过
```

## 3. 回退策略

每个 Phase 都可以独立回退：

```
Phase 1-3 回退: 删除新创建的 domain/、store/ 目录即可
Phase 4 回退: 恢复组件的旧版本（git checkout 对应文件）
Phase 5 回退: 不删除旧代码，两套代码并存
```

**关键原则：** 在 Phase 4 之前，不修改任何现有文件。所有新代码都是新增文件。

## 4. 测试计划

### 4.1 Domain 层单元测试

测试框架：使用项目现有测试框架（如 Jest / Vitest）

```
__tests__/domain/

# 值对象测试
TimePosition.test.ts:
  ✓ 创建有效的 TimePosition (正数)
  ✓ 拒绝负数 TimePosition
  ✓ TimePosition.zero() 返回 0
  ✓ fromPixels 正确转换
  ✓ add/subtract 运算正确
  ✓ 值相等性比较

Duration.test.ts:
  ✓ 创建有效的 Duration (正数)
  ✓ 拒绝 0 或负数
  ✓ Duration.default() 返回 5 秒
  ✓ 运算方法正确

Volume.test.ts:
  ✓ clamp 到 [0, 2.0] 范围
  ✓ fromPercentage 转换 (0-200 → 0-2.0)
  ✓ multiply 合成计算正确
  ✓ muted 判断

ZoomLevel.test.ts:
  ✓ clamp 到 [0.1, 5.0]
  ✓ toPixelsPerSecond 计算 (value * 50)
  ✓ zoomIn/zoomOut 步进

# 实体测试
TimelineItem.test.ts:
  ✓ create 生成有效 ID
  ✓ endTime = startTime + duration
  ✓ moveTo 更新 startTime
  ✓ resize 从左/右边缘
  ✓ overlaps 检测
  ✓ toPlainObject/fromPlainObject 往返序列化

Track.test.ts:
  ✓ addItem 成功添加兼容类型
  ✓ addItem 拒绝不兼容类型
  ✓ addItem 在 isLocked 时抛出异常
  ✓ removeItem 返回被删除的 item
  ✓ getNextAvailablePosition 返回正确位置
  ✓ canAcceptMaterial 兼容性规则完整
  ✓ image-track 特殊规则
  ✓ toggle 方法正确切换状态

# 聚合根测试
TimelineAggregate.test.ts:
  ✓ addItemToTrack 验证类型兼容性
  ✓ addItemToTrack 自动更新 totalDuration
  ✓ removeItemFromTrack 自动更新 totalDuration
  ✓ moveItem 更新位置和 totalDuration
  ✓ resizeItem 更新尺寸
  ✓ findItem 跨轨道查找
  ✓ getCompatibleTracks 返回正确轨道
  ✓ snapshot/restore 完整往返
  ✓ toPlainObject 序列化

# 领域服务测试
TrackSelectionService.test.ts:
  ✓ 指定 trackId 时返回对应轨道
  ✓ image 素材优先匹配 image-track
  ✓ image 素材回退到 video 轨道
  ✓ video 素材排除 image-track
  ✓ audio/subtitle 匹配正确类型
  ✓ 无兼容轨道返回 null

ItemPlacementService.test.ts:
  ✓ 空轨道放置在 0 位置
  ✓ 非空轨道放置在最后 item 后
  ✓ 默认时长 5 秒
  ✓ 颜色映射正确
  ✓ 素材属性正确复制

DragCalculationService.test.ts:
  ✓ calculateMovePosition 正确计算
  ✓ 不允许负 startTime
  ✓ snapToGrid 对齐
  ✓ calculateResizePosition 左边缘
  ✓ calculateResizePosition 右边缘
  ✓ 最小 duration 约束
  ✓ detectInteractionType 边缘检测 (8px)
  ✓ pixelsToTime/timeToPixels 转换

HistoryService.test.ts:
  ✓ addAction 追加记录
  ✓ 超过 50 条截断
  ✓ 中间位置添加时截断后续
  ✓ undo 返回 previousState
  ✓ redo 返回 nextState
  ✓ canUndo/canRedo 正确
  ✓ clear 清空

# 状态机测试
dragMachine.test.ts:
  ✓ idle → detecting (POINTER_DOWN)
  ✓ detecting → dragging (超过阈值, move 类型)
  ✓ detecting → resizingStart (超过阈值, resize-start)
  ✓ detecting → resizingEnd (超过阈值, resize-end)
  ✓ detecting → idle (未超阈值 POINTER_UP, 视为点击)
  ✓ dragging → committed (POINTER_UP)
  ✓ dragging → idle (ESCAPE)
  ✓ context 正确更新 (previewStartTime, previewDuration)
  ✓ committed → idle (COMMIT_COMPLETE)
```

### 4.2 Store 集成测试

```
__tests__/store/

timelineSlice.test.ts:
  ✓ initTimeline 创建正确的初始状态
  ✓ addItemToTrack 通过 store 添加 item
  ✓ removeItem 通过 store 删除 item
  ✓ moveItem 通过 store 移动 item
  ✓ resizeItem 通过 store 缩放 item
  ✓ toggleTrackLock/Mute/Visibility 正确切换
  ✓ exportToData/importFromData 往返
  ✓ 状态变更后 tracks 派生状态同步更新

historySlice.test.ts:
  ✓ recordAction + undo 恢复到之前状态
  ✓ recordAction + redo 前进到之后状态
  ✓ 连续 undo 多步
  ✓ undo 后新操作截断历史
  ✓ canUndo/canRedo 实时更新
  ✓ clearHistory 清空

selectionSlice.test.ts:
  ✓ selectItem 单选
  ✓ toggleItemSelection 切换
  ✓ selectAllTrackItems 全选轨道
  ✓ deselectAll 清空

dragSlice.test.ts:
  ✓ startDrag + updateDrag 产生正确的 dragPreview
  ✓ endDrag 触发 moveItem/resizeItem
  ✓ cancelDrag 恢复原始状态
  ✓ materialDragOver 设置和清除

actions.test.ts (跨 slice 集成):
  ✓ addItem + undo → item 被移除
  ✓ moveItem + undo → item 回到原位
  ✓ 多步操作 + 连续 undo/redo → 状态一致
```

### 4.3 测试工具

```
// test-utils/createTestStore.ts
创建预配置的测试 store，包含默认的轨道和 item

// test-utils/createTestTimeline.ts
创建测试用的 TimelineAggregate，包含:
  - 1 个 video track (2 个 items)
  - 1 个 audio track (1 个 item)
  - 1 个 subtitle track (1 个 item)

// test-utils/createTestMaterial.ts
创建不同类型的测试 MaterialData
```

## 5. 功能验证清单

重构完成后，逐项验证以下功能不变：

```
基础操作:
  □ 拖拽素材从面板到轨道 → 正确添加到对应轨道
  □ 拖拽视频到 video track → 成功
  □ 拖拽音频到 video track → 被拒绝
  □ 拖拽图片到 image-track → 成功
  □ 拖拽图片到普通 video track → 成功

时间线交互:
  □ 拖拽移动 item → 位置更新平滑
  □ 左边缘缩放 → 调整 startTime 和 duration
  □ 右边缘缩放 → 调整 duration
  □ 拖拽时 ESC → 恢复原位
  □ 点击 item → 选中（不触发拖拽）

Undo/Redo:
  □ 添加 item 后 Ctrl+Z → item 消失
  □ Ctrl+Y → item 恢复
  □ 多步操作后连续 Undo → 逐步恢复
  □ Undo 后执行新操作 → Redo 历史被截断

轨道控制:
  □ 锁定轨道 → 无法拖拽/添加/删除该轨道的 item
  □ 静音轨道 → 音量图标变化
  □ 隐藏轨道 → 视觉变化
  □ 轨道音量滑块 → 调节音量

工具栏:
  □ 工具切换正常
  □ 删除选中 item
  □ 导出 JSON → 下载正确文件
  □ 导入 JSON → 恢复完整时间线

标尺:
  □ 拖拽播放头 → 时间更新
  □ 缩放滑块 → 轨道缩放
  □ 时间刻度显示正确

字幕:
  □ 双击字幕 item → 进入编辑模式
  □ 编辑文本 → 保存更新

性能:
  □ 拖拽时无明显卡顿 (60fps)
  □ 大量 item (20+) 时滚动流畅
  □ 缩放操作响应迅速
```

## 6. 新增依赖安装

```bash
npm install zustand xstate @xstate/react
```

开发依赖（如果需要）：
```bash
npm install -D @testing-library/react  # 如果还没有
```
