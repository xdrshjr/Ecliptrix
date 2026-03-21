# TODO 04: AI分镜脚本面板

**对应 Spec**: `specs/04-storyboard-script-tab.md`

## Dependencies

- `depends_on: [01, 02, 03]` — 需要类型定义、后端API、素材面板分镜包支持
- `blocks: [05]` — 视频合成功能集成在此面板中
- `parallel_group: C`

## Tasks

### 类型定义
- [ ] 在 `src/types/index.ts` 中添加 `StoryboardScriptSegment` 接口
- [ ] 扩展 `VideoEditingTaskContent` 添加 `storyboardScriptSegments` 和 `selectedStoryboardPackId`

### 核心 Hook
- [ ] 创建 `useStoryboardScriptGeneration.ts`
  - [ ] `loadPack()` — 加载分镜包 + 创建 segments
  - [ ] `generateDescriptions()` — 调用 describe API 批量生成描述
  - [ ] `regenerateDescription()` — 单帧重新描述
  - [ ] `generateVideo()` — 单帧视频生成 (复用 ARK Video 轮询逻辑)
  - [ ] `batchGenerateVideos()` — 批量生成 + 轮询
  - [ ] `composeVideo()` — 调用合成 API
  - [ ] 进度跟踪: overallProgress, totalDuration 计算

### UI 组件
- [ ] 创建 `PackSelector.tsx` — 分镜包下拉选择器
  - [ ] 列表显示: 名称 + 宫格规格 + 创建时间
  - [ ] 空状态: "暂无分镜包"
- [ ] 创建 `StoryboardSegmentCard.tsx` — 帧段卡片
  - [ ] 帧图片预览 (可点击放大)
  - [ ] 帧序号显示 "#1 / N"
  - [ ] 描述 textarea (自动填充 + 可编辑)
  - [ ] "重新生成描述" 按钮
  - [ ] "AI扩展" 按钮
  - [ ] 时长选择器 (5s/7s/10s/12s)
  - [ ] "生成视频" 单个按钮
  - [ ] "删除此帧" 按钮
  - [ ] 生成进度条
  - [ ] 视频预览播放器
- [ ] 创建 `StoryboardScriptTab.tsx` — 主面板
  - [ ] 顶部工具栏: PackSelector + 批量生成 + 一键合成
  - [ ] 帧段列表 (可滚动)
  - [ ] 底部状态栏: 总进度 + 总时长
  - [ ] 空状态: 引导选择分镜包

### 集成
- [ ] 修改 `ScriptPanel.tsx` — 添加第3个Tab "AI分镜"
- [ ] 传递 storyboardScriptSegments 等 props

### API 路由
- [ ] 创建 `src/app/api/storyboard/describe/route.ts`
- [ ] 创建 `src/app/api/storyboard/batch-video/route.ts`
- [ ] 创建 `src/app/api/storyboard/batch-video/status/[packId]/route.ts`
- [ ] 在 `src/lib/api/storyboard.ts` 中添加 `describeFrames()`, `batchGenerateVideos()`, `getBatchVideoStatus()` 方法

### 段操作
- [ ] 添加帧功能 (列表末尾+号)
- [ ] 删除帧功能 + 确认
- [ ] 帧序号重新计算
