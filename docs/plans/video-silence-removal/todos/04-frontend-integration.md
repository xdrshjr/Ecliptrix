# TODO 04: 前端集成

**对应 Spec:** `specs/04-frontend-integration.md`

## Dependencies

- `depends_on: [01, 02, 03]` — 需要后端 API 全部就绪 + 前端弹窗组件就绪
- `blocks: []` — 最终集成，无后续依赖
- `parallel_group: C` — 必须在所有前置任务完成后执行

## Tasks

- [ ] 修改 `MaterialsPanel.tsx`
  - [ ] 新增 state: `isVideoProcessingOpen: boolean`
  - [ ] 在底部按钮区域新增"视频处理"按钮（与 AI视频/AI图片 按钮同区域）
  - [ ] 按钮图标 + 文字样式
  - [ ] 挂载 `<VideoProcessingModal>` 组件
  - [ ] 传递 props: isOpen, onClose, materials(video), onSilenceRemoved, taskId
  - [ ] 实现 `handleSilenceRemoved` 回调（参考 handleWatermarkRemoved 模式）
  - [ ] 构造同 ID 替换的 MaterialItem + metadata
  - [ ] 调用 `addOrReplaceMaterial(newMaterial)`

- [ ] 实现 `ProcessingProgress.tsx`
  - [ ] Props: taskId, videoName, onComplete, onError, onMinimize, loggingTaskId
  - [ ] 进度条（环形或条形，动画）
  - [ ] 当前阶段文字 + 进度百分比
  - [ ] 预估剩余时间
  - [ ] setInterval 每 1.5 秒轮询 `GET /api/silence/status/{taskId}`
  - [ ] 状态处理：completed → onComplete, failed → onError
  - [ ] 最小化按钮 → onMinimize
  - [ ] 取消按钮（停止轮询 + 关闭弹窗）
  - [ ] 组件卸载清除 interval
  - [ ] 轮询超时处理：超过 30 分钟仍未完成 → 提示可能失败（Spec 04 第 6 节）
  - [ ] 轮询网络错误重试：失败后重试 3 次，仍失败则暂停轮询 + 显示"网络异常"，网络恢复后自动重试
  - [ ] 完成状态展示：成功图标 + 统计卡片（原时长→新时长，移除N段，节省X秒）+ "完成"按钮触发素材替换并关闭弹窗

- [ ] 实现 MinimizedProgressIndicator 组件
  - [ ] 固定右下角浮动卡片（fixed 定位，高 z-index）
  - [ ] 宽度约 260px
  - [ ] 显示：视频名称(截断) + 小型进度条 + 百分比
  - [ ] 点击 → 重新打开弹窗
  - [ ] 完成变绿 / 失败变红
  - [ ] 最小化后继续轮询进度
  - [ ] State 提升到 MaterialsPanel（minimizedTask）

- [ ] 状态流转集成
  - [ ] 弹窗 processing → 最小化 → 浮动指示器出现 + 继续轮询
  - [ ] 浮动指示器点击 → 弹窗恢复 → 浮动指示器消失
  - [ ] 弹窗关闭时正在处理 → 自动切换到浮动指示器 + 提示
  - [ ] 处理完成 → 执行素材替换 + 关闭/更新 UI

- [ ] 边界情况处理
  - [ ] 素材列表为空 → 空状态提示
  - [ ] 选中视频在处理中被删除 → 作为新素材添加
  - [ ] 网络断开 → 重试 3 次后暂停轮询 + "网络异常"提示
  - [ ] 弹窗关闭时正在检测 → AbortController 取消请求
