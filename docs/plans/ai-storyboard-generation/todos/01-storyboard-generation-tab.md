# TODO 01: 分镜生成Tab

**对应 Spec**: `specs/01-storyboard-generation-tab.md`

## Dependencies

- `depends_on: []` — 无前置依赖，可以作为第一个开发任务
- `blocks: [02, 03, 04]` — 前端类型定义和 API 客户端被后续所有任务依赖
- `parallel_group: A` — 可以与 TODO 02 的后端基础设施并行开发

## Tasks

### 类型定义
- [ ] 在 `src/types/index.ts` 中添加 `StoryboardGridSize` 类型
- [ ] 在 `src/types/index.ts` 中添加 `StoryboardFrame` 接口
- [ ] 在 `src/types/index.ts` 中添加 `StoryboardPack` 接口
- [ ] 在 `src/types/index.ts` 中添加 `StoryboardGenerateParams` 接口
- [ ] 扩展 `MaterialItem` 类型支持 `type: 'storyboard_pack'`

### API 客户端
- [ ] 创建 `src/lib/api/storyboard.ts` — `generateStoryboard()` 函数
- [ ] 创建 `src/app/api/storyboard/generate/route.ts` — Next.js API 代理路由

### UI 组件
- [ ] 创建 `GridSizeSelector.tsx` — 宫格规格选择器 (按钮组)
- [ ] 创建 `StoryboardTab.tsx` — 分镜生成主组件
  - [ ] 集成 GridSizeSelector
  - [ ] 集成提示词 textarea
  - [ ] 集成 ImageUploadArea (复用)
  - [ ] 生成按钮 + 状态管理 (idle/generating/success/error)
  - [ ] 成功后显示原图缩略图和帧数提示

### 集成
- [ ] 修改 `AiImageModal.tsx` — 添加第4个 Tab "分镜生成"
- [ ] 修改 `useMaterialManagement.ts` — 添加 `handleStoryboardGenerate()` 方法
- [ ] 生成成功后将分镜包添加到 materials 列表
