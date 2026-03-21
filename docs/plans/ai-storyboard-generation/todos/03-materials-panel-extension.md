# TODO 03: 素材面板分镜包展示

**对应 Spec**: `specs/03-materials-panel-extension.md`

## Dependencies

- `depends_on: [01, 02]` — 需要前端类型定义 (TODO 01) 和后端 API (TODO 02)
- `blocks: [04]` — 分镜脚本面板需要从素材面板选择分镜包
- `parallel_group: B`

## Tasks

### 新增组件
- [ ] 创建 `StoryboardPackCard.tsx` — 分镜包文件夹卡片
  - [ ] 文件夹图标叠加
  - [ ] 原始大图缩略图封面
  - [ ] "NxN · M帧" 标签
  - [ ] 双击进入 + hover 操作
- [ ] 创建 `StoryboardPackView.tsx` — 分镜包内部视图
  - [ ] 面包屑导航 ("素材" > "包名称")
  - [ ] 分镜包信息栏 (提示词/规格/帧数)
  - [ ] 原始大图预览
  - [ ] "删除分镜包" 按钮
  - [ ] "在分镜脚本中使用" 按钮
- [ ] 创建 `FrameCard.tsx` — 帧缩略图卡片
  - [ ] 帧图片 + 序号标签
  - [ ] 描述文字预览

### 素材面板集成
- [ ] 修改 `MaterialsPanel.tsx`
  - [ ] 新增 `currentStoryboardPack` 状态
  - [ ] 新增 "分镜包" 类型筛选选项
  - [ ] 顶层视图: 分镜包与普通素材混合显示
  - [ ] 分镜包内部视图: 条件渲染 StoryboardPackView
  - [ ] 加载分镜包列表 (GET /api/storyboard/packs)
  - [ ] 删除分镜包功能 + 确认对话框

### API 路由
- [ ] 创建 `src/app/api/storyboard/packs/route.ts` — 列表代理
- [ ] 创建 `src/app/api/storyboard/packs/[packId]/route.ts` — 详情/删除代理
- [ ] 在 `src/lib/api/storyboard.ts` 中添加 `listPacks()`, `deletePack()` 方法
