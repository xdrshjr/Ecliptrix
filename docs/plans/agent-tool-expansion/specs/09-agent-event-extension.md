# Spec 09: Agent 事件系统扩展 (Agent Event Extension)

## 1. 概述

扩展 AgentEventRouter 和 OperationApplier 以支持所有新工具的 operation 类型。新工具的 tool_result 事件需要被正确路由到对应的 Zustand store，实现 Agent 操作 → UI 面板的响应链。

## 2. 新增 Operation 类型

在 `src/lib/video-editing-agent/types.ts` 中扩展 operation 类型：

```
// 现有类型
type TimelineOperation = AddClipOp | TrimClipOp | DeleteClipOp | MoveClipOp | ResizeClipOp;

// 新增类型
type MaterialOperation =
  | { type: 'add_material'; material: MaterialItem }
  | { type: 'add_materials'; materials: MaterialItem[] }
  | { type: 'remove_material'; materialId: string };

type ScriptOperation =
  | { type: 'set_script'; content: string; scriptType: string }
  | { type: 'append_script'; content: string };

type StoryboardOperation =
  | { type: 'set_storyboards'; storyboards: StoryboardItem[] }
  | { type: 'update_storyboard'; storyboardId: string; patch: Partial<StoryboardItem> };

type AsyncTaskOperation =
  | { type: 'start_async_task'; task: AsyncTask };

// 统一 operation 类型
type AgentOperation = TimelineOperation | MaterialOperation | ScriptOperation | StoryboardOperation | AsyncTaskOperation;
```

## 3. AgentEventRouter 扩展

### 3.1 现有路由逻辑

当前 `AgentEventRouter.handleEvent()` 处理 `tool_result` 事件时：
1. 检查 `event.operation` 是否存在
2. 如果是 timeline operation → 调用 `OperationApplier.applyOperation()`

### 3.2 扩展后的路由逻辑

```
AgentEventRouter.handleEvent(event):
  if event.type === 'tool_result' && event.operation:
    switch event.operation.type:
      // 现有 timeline operations
      case 'add_clip':
      case 'trim_clip':
      case 'delete_clip':
      case 'move_clip':
      case 'resize_clip':
        → operationApplier.applyOperation(event.operation)

      // 新增 material operations
      case 'add_material':
        → materialStore.addMaterial(event.operation.material)
      case 'add_materials':
        → materialStore.addMaterials(event.operation.materials)
      case 'remove_material':
        → materialStore.removeMaterial(event.operation.materialId)

      // 新增 script operations
      case 'set_script':
        → scriptStore.setScriptContent(event.operation.content)
        → scriptStore.setScriptType(event.operation.scriptType)
      case 'append_script':
        → scriptStore.appendScriptContent(event.operation.content)

      // 新增 storyboard operations
      case 'set_storyboards':
        → storyboardStore.setStoryboards(event.operation.storyboards)
      case 'update_storyboard':
        → storyboardStore.updateStoryboard(id, patch)

      // 新增 async task operations
      case 'start_async_task':
        → asyncTaskStore.addTask(event.operation.task)
```

### 3.3 Store 访问方式

AgentEventRouter 运行在非 React 环境中，需要通过 `getState()` 访问 Zustand store：

```
import { useVideoEditingStore } from '@/stores';

class AgentEventRouter {
  private getStore() {
    return useVideoEditingStore.getState();
  }

  handleMaterialOperation(op: MaterialOperation) {
    const store = this.getStore();
    if (op.type === 'add_material') store.addMaterial(op.material);
    if (op.type === 'add_materials') store.addMaterials(op.materials);
    if (op.type === 'remove_material') store.removeMaterial(op.materialId);
  }
}
```

## 4. OperationApplier 扩展

### 4.1 Undo 支持

现有 OperationApplier 支持 timeline operations 的 undo（通过 snapshot 恢复）。

新增 operations 的 undo 策略：
- `add_material` → 记录 materialId，undo 时 removeMaterial
- `add_materials` → 记录所有 materialIds，undo 时批量 remove
- `remove_material` → 记录完整 MaterialItem，undo 时 addMaterial
- `set_script` → 记录旧 scriptContent，undo 时恢复
- `set_storyboards` → 记录旧 storyboards，undo 时恢复
- `start_async_task` → **不可 undo**（任务已提交）

### 4.2 Operation 历史记录

每个 tool call 的 operation 记录在 AgentStateManager 中，支持：
- 按 message 级别 undo（恢复 timeline snapshot + 撤销 material/script 变更）
- 按 tool call 级别 undo（仅撤销单个操作）

## 5. SSE 事件流扩展

### 5.1 新的 SSE 事件字段

`tool_result` 事件的 `operation` 字段现在可以是任何 `AgentOperation` 类型。前端 `AgentEventRouter` 需要处理所有新类型。

### 5.2 流式脚本事件

对于脚本生成等流式工具，增加新的 SSE 事件类型：

```
{ type: 'script_delta', content: string }  // 脚本内容流式增量
```

AgentEventRouter 收到 `script_delta` 时调用 `scriptStore.appendScriptContent(content)`。

## 6. 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/video-editing-agent/types.ts` | 修改 | 新增 operation 类型定义 |
| `src/lib/video-editing-agent/AgentEventRouter.ts` | 修改 | 扩展路由逻辑，接入 Zustand store |
| `src/lib/video-editing-agent/OperationApplier.ts` | 修改 | 扩展 undo 支持 |
| `src/lib/video-editing-agent/AgentStateManager.ts` | 修改 | 记录新类型的 operations |
| `src/lib/video-editing-agent/agent.ts` | 修改 | subscribeAgentEvents 处理新 operation 类型 |

## 7. 接口契约

### Tool handler → SSE event
```
send({
  type: 'tool_result',
  toolCallId: '...',
  toolName: 'search_video',
  result: { success: true, materials: [...] },
  operation: { type: 'add_materials', materials: [...] }
})
```

### AgentEventRouter → Zustand Store
```
store.addMaterial(operation.material)
store.setScriptContent(operation.content)
store.setStoryboards(operation.storyboards)
store.addTask(operation.task)
```

## 8. 边界条件

- 未知 operation type → log warning，不崩溃
- Store 尚未初始化（竞态条件） → 使用 getState() 保证同步访问
- 快速连续的 operations → Zustand 自动批处理更新
- Undo 异步任务 → 显示提示"异步任务无法撤销"
