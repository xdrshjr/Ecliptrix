# Spec 02: 中心化状态管理 (Zustand Store)

## 1. 概述

引入 Zustand 作为中心化状态管理方案，为 Agent 操作与 UI 面板之间提供统一的状态同步机制。创建 5 个独立的 store slice：materialStore、scriptStore、storyboardStore、timelineStore、asyncTaskStore。

## 2. 设计

### 2.1 Store 架构

采用 Zustand 的 slice pattern，每个功能域一个独立 slice，通过 `create` 组合为单个 store。

```
VideoEditingStore
├── materialSlice      — 素材库状态管理
├── scriptSlice        — 脚本面板状态管理
├── storyboardSlice    — 分镜面板状态管理
├── timelineSlice      — 时间线状态管理
├── asyncTaskSlice     — 异步任务追踪
└── agentSlice         — Agent 执行状态（可选，用于替代 useAgentExecutionState）
```

### 2.2 materialSlice

```
State:
  materials: MaterialItem[]           — 所有素材
  selectedMaterialId: string | null   — 当前选中素材
  filterType: string | null           — 当前筛选类型

Actions:
  addMaterial(item: MaterialItem): void
  addMaterials(items: MaterialItem[]): void    — 批量添加（搜索结果）
  removeMaterial(id: string): void
  updateMaterial(id: string, patch: Partial<MaterialItem>): void
  setSelectedMaterial(id: string | null): void
  setFilterType(type: string | null): void
```

**来源映射**：替代 `useMaterialManagement.ts` 中的本地 state，使 MaterialsPanel 读取 store 而非 prop drilling。

### 2.3 scriptSlice

```
State:
  scriptContent: string               — 脚本文本内容
  scriptType: 'video' | 'understanding' | 'ai_generated'  — 脚本类型
  isGenerating: boolean               — 是否正在生成
  generationProgress: number           — 生成进度 (0-100)

Actions:
  setScriptContent(content: string): void
  setScriptType(type: string): void
  appendScriptContent(content: string): void   — 流式追加
  setGenerating(generating: boolean): void
  setGenerationProgress(progress: number): void
  resetScript(): void
```

### 2.4 storyboardSlice

```
State:
  storyboards: StoryboardItem[]        — 分镜列表
  activeStoryboardId: string | null    — 当前活动分镜
  storyboardPacks: StoryboardPack[]    — 分镜包列表
  isGenerating: boolean

Actions:
  setStoryboards(items: StoryboardItem[]): void
  addStoryboard(item: StoryboardItem): void
  updateStoryboard(id: string, patch: Partial<StoryboardItem>): void
  removeStoryboard(id: string): void
  setActiveStoryboard(id: string | null): void
  setStoryboardPacks(packs: StoryboardPack[]): void
  addStoryboardPack(pack: StoryboardPack): void
  updateStoryboardPack(id: string, patch: Partial<StoryboardPack>): void
```

### 2.5 timelineSlice

```
State:
  timelineState: TimelineState | null
  externalUpdateId: string | null      — 触发 re-render 的 ID

Actions:
  setTimelineState(state: TimelineState | null): void
  triggerUpdate(updateId: string): void
```

**注意**：timelineSlice 是对现有 `timelineState` 状态的包装。现有的 `OperationApplier` 将改为写入此 store 而非直接调用 `setTimelineState` prop。

### 2.6 asyncTaskSlice

```
State:
  tasks: Map<string, AsyncTask>

AsyncTask:
  taskId: string
  type: 'ai_video' | 'ai_image' | 'image_to_video' | 'tts' | 'batch_tts' | 'storyboard_video'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number                     — 0-100
  result: unknown | null               — 完成后的结果数据
  error: string | null
  createdAt: number
  metadata: Record<string, unknown>    — 额外元数据（prompt, 参数等）

Actions:
  addTask(task: AsyncTask): void
  updateTask(taskId: string, patch: Partial<AsyncTask>): void
  removeTask(taskId: string): void
  getActiveTasks(): AsyncTask[]
  getTasksByType(type: string): AsyncTask[]
```

### 2.7 迁移策略

采用**并行运行**策略，分阶段迁移：

**阶段 1**：创建 Zustand store，新增功能（Agent 新工具）直接使用 store
**阶段 2**：现有组件通过 `useStore` hook 读取 store，同时保留原有 state 作为 fallback
**阶段 3**：确认稳定后，移除旧的 prop drilling 和 Context 状态

### 2.8 与 Agent 系统的集成点

```
AgentEventRouter
  └── 收到 tool_result 事件
      ├── operation.type === 'add_material'      → materialSlice.addMaterial()
      ├── operation.type === 'remove_material'    → materialSlice.removeMaterial()
      ├── operation.type === 'update_script'      → scriptSlice.setScriptContent()
      ├── operation.type === 'update_storyboard'  → storyboardSlice.setStoryboards()
      ├── operation.type === 'start_async_task'   → asyncTaskSlice.addTask()
      └── 原有 timeline operations                → timelineSlice.setTimelineState()
```

## 3. 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/stores/videoEditingStore.ts` | 新建 | 主 store 定义（组合所有 slice） |
| `src/stores/slices/materialSlice.ts` | 新建 | 素材 slice |
| `src/stores/slices/scriptSlice.ts` | 新建 | 脚本 slice |
| `src/stores/slices/storyboardSlice.ts` | 新建 | 分镜 slice |
| `src/stores/slices/timelineSlice.ts` | 新建 | 时间线 slice |
| `src/stores/slices/asyncTaskSlice.ts` | 新建 | 异步任务 slice |
| `src/stores/index.ts` | 新建 | Store 导出 + hooks |
| `package.json` | 修改 | 添加 zustand 依赖 |

## 4. 接口契约

### Store → UI Components
```
useVideoEditingStore.getState().materials
useVideoEditingStore(state => state.materials)
```

### AgentEventRouter → Store
```
import { useVideoEditingStore } from '@/stores';
const store = useVideoEditingStore.getState();
store.addMaterial(item);
store.setScriptContent(content);
```

### AsyncTaskPoller → Store
```
store.updateTask(taskId, { status: 'completed', result: data });
store.addMaterial(resultAsMaterial);  // 任务完成后自动入库
```

## 5. 边界条件

- Store 的 `subscribe` 用于非 React 环境（如 AgentEventRouter 中调用）
- 使用 Zustand 的 `getState()` 而非 hook 在 Agent 回调中访问/修改状态
- asyncTaskSlice 的 tasks 使用 Map 而非 Array 以支持 O(1) 查找
- 过期任务（>30min 且已完成/失败）应定期清理
