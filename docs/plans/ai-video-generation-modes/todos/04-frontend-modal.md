# TODO 04: 素材弹窗模式切换

**对应 Spec:** `specs/04-frontend-modal.md`

## Dependencies

- depends_on: [02]
- blocks: []
- parallel_group: C

**原因：** 依赖后端接口变更完成。与 TODO 03 可并行开发（共享 arkVideo.ts 改动需协调）。

## Tasks

- [ ] 在 AiVideoModal 中添加模式 SegmentedControl（与脚本面板一致样式）
- [ ] 添加模式状态管理：mode, characterImageUrl, sceneImageUrl, firstFrameUrl, lastFrameUrl
- [ ] 实现模式A 表单：角色形象 URL + 场景形象 URL 输入（替代单一参考图）
- [ ] 实现模式B 表单：首帧 URL（*必填）+ 尾帧 URL（可选）输入
- [ ] 模式B 隐藏/禁用比例选择器
- [ ] 修改 handleGenerate 逻辑：根据模式构建不同的 API 请求
- [ ] 模式B 首帧为空时禁用生成按钮 + 错误提示
- [ ] 从素材面板触发时：自动设为关键帧模式 + 填入首帧 URL
