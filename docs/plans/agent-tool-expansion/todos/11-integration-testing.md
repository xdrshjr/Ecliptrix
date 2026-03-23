# TODO 11: 集成测试

**Spec**: `specs/11-integration-testing.md`

## Dependencies
- **depends_on**: [01, 02, 03, 04, 05, 06, 07, 08, 09, 10] (所有实现完成后)
- **blocks**: []
- **parallel_group**: F

## Tasks

- [ ] 工具注册系统测试
  - [ ] ToolRegistry 初始化/查询测试
  - [ ] explore_tools 加载/无效类别测试
- [ ] 搜索工具测试
  - [ ] search_video/search_image/search_audio 正常和异常场景
  - [ ] 搜索结果 → materialStore 注入验证
- [ ] AI 生成工具测试
  - [ ] 任务创建 → asyncTaskStore 注入
  - [ ] AsyncTaskPoller 轮询逻辑
  - [ ] 完成后自动入库验证
- [ ] 脚本/分镜工具测试
  - [ ] scriptStore 更新验证
  - [ ] storyboardStore 更新验证
  - [ ] 流式脚本生成验证
- [ ] 事件路由测试
  - [ ] 每种新 operation type 的路由正确性
  - [ ] Undo 操作正确性
- [ ] Zustand Store 单元测试
  - [ ] 每个 slice 的 CRUD 操作
  - [ ] 非 React 环境 getState() 测试
- [ ] System Prompt 测试
  - [ ] Token 预算验证 < 600
  - [ ] 格式完整性
- [ ] 端到端手动测试
  - [ ] 搜索素材并添加到时间线
  - [ ] AI 生成图片/视频
  - [ ] 生成脚本并转 TTS
  - [ ] 完整分镜工作流
