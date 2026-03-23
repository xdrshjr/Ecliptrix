# TODO 09: Agent 事件系统扩展

**Spec**: `specs/09-agent-event-extension.md`

## Dependencies
- **depends_on**: [02, 03, 04, 05, 06, 07, 08] (需要所有 store 和工具实现完成)
- **blocks**: [10, 11]
- **parallel_group**: D

## Tasks

- [ ] 扩展 `types.ts` — 新增 operation 类型
  - [ ] MaterialOperation (add_material, add_materials, remove_material)
  - [ ] ScriptOperation (set_script, append_script)
  - [ ] StoryboardOperation (set_storyboards, update_storyboard)
  - [ ] AsyncTaskOperation (start_async_task)
  - [ ] 统一类型 AgentOperation
- [ ] 扩展 `AgentEventRouter.ts` — 路由新 operation 类型
  - [ ] 引入 Zustand store 的 getState() 访问
  - [ ] handleMaterialOperation() 方法
  - [ ] handleScriptOperation() 方法
  - [ ] handleStoryboardOperation() 方法
  - [ ] handleAsyncTaskOperation() 方法
  - [ ] 未知 operation type 的 fallback 处理
- [ ] 扩展 `OperationApplier.ts` — undo 支持
  - [ ] add_material undo: 记录 id → removeMaterial
  - [ ] add_materials undo: 记录 ids → 批量 remove
  - [ ] remove_material undo: 记录完整 item → addMaterial
  - [ ] set_script undo: 记录旧 content → restore
  - [ ] set_storyboards undo: 记录旧 storyboards → restore
  - [ ] start_async_task: 标记为不可 undo
- [ ] 扩展 `AgentStateManager.ts` — 记录新类型 operations
- [ ] 扩展 `agent.ts` subscribeAgentEvents — 处理新 operation 类型传输
- [ ] 新增 SSE 事件类型: script_delta 支持
