# TODO 05: 视频合成

**对应 Spec**: `specs/05-video-composition.md`

## Dependencies

- `depends_on: [02, 04]` — 需要后端合成 API (TODO 02) 和分镜脚本面板 (TODO 04)
- `blocks: []` — 最终功能，无下游依赖
- `parallel_group: C` — 合成 API 在 TODO 02 中基础实现，此处聚焦前端集成和端到端测试

## Tasks

### 后端完善
- [ ] 完善 `compose_storyboard_video()` 实现
  - [ ] stream copy 尝试 + 重编码 fallback
  - [ ] 视频信息提取 (duration, resolution, size)
  - [ ] 缩略图生成
  - [ ] 临时文件清理
  - [ ] 错误处理和日志记录

### 前端集成
- [ ] 在 `StoryboardScriptTab.tsx` 中实现合成按钮逻辑
  - [ ] 按钮禁用状态: 未全部生成视频时灰色
  - [ ] 合成中状态: spinner
  - [ ] 合成成功: 视频预览 + 添加到素材
  - [ ] 合成失败: 错误信息 + 重试
- [ ] 在 `useStoryboardScriptGeneration.ts` 中实现 `composeVideo()`
  - [ ] 收集所有 generatedVideoUrl (按 frameIndex 排序)
  - [ ] 调用 POST /api/storyboard/compose
  - [ ] 返回合成视频 URL
  - [ ] 添加到素材面板

### API 路由
- [ ] 创建 `src/app/api/storyboard/compose/route.ts` — 代理路由
- [ ] 在 `src/lib/api/storyboard.ts` 中添加 `composeVideo()` 方法

### 端到端验证
- [ ] 验证完整流程: 分镜生成 → 裁剪 → 导入脚本 → 描述生成 → 视频生成 → 合成
- [ ] 验证不同宫格规格的合成结果
- [ ] 验证大量帧 (如 8x8=64帧) 的合成性能
