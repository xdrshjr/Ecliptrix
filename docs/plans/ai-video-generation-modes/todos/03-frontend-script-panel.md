# TODO 03: 前端脚本面板模式切换

**对应 Spec:** `specs/03-frontend-script-panel.md`

## Dependencies

- depends_on: [02]
- blocks: []
- parallel_group: C

**原因：** 依赖后端接口变更完成。与 TODO 04 可并行开发。

## Tasks

- [ ] 扩展 `AIVideoScriptSegment` 类型：添加 `generationMode`、`firstFrameUrl`、`firstFrameName`、`lastFrameUrl`、`lastFrameName`
- [ ] 修改 `src/lib/api/arkVideo.ts`：请求参数增加 `mode`、`first_frame_url`、`last_frame_url`
- [ ] 在 AIVideoScriptTab 中添加模式切换 SegmentedControl
- [ ] 实现模式A 条件渲染：显示角色/场景 ImagePickerSlot
- [ ] 实现模式B 条件渲染：显示首帧（*必填）/ 尾帧（可选）ImagePickerSlot
- [ ] 修改 `useAIVideoScriptGeneration` Hook：根据模式构建不同 API 请求
- [ ] 模式B 首帧为空时禁用生成按钮 + toast 提示
- [ ] 更新 `createAIVideoSegment()` 工厂函数：默认 `generationMode: "description"`
