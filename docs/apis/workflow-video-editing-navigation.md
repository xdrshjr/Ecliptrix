# Workflow to Video Editing Navigation API

## 概述

该功能实现了从 Workflow 中的 AI Video Generate 节点成功执行后，自动在工作流聊天界面显示"前往Video Editing查看结果"按钮，并支持一键跳转到 Video Editing 任务，自动导入生成的视频时间轴数据。

## 功能流程

### 1. AI Video Generate 节点执行

当 Workflow 中的 AI Video Generate 节点成功执行时：

1. 节点返回包含 `timelineData` 的结果对象
2. WorkflowExecutor 将结果存储在节点状态中
3. 执行状态包含完整的节点输出数据

### 2. 工作流聊天界面检测

WorkflowChatInterface 组件在工作流执行完成时：

1. 检测执行日志中是否有 "AI Video Generate completed successfully" 消息
2. 从对应节点的输出状态中提取 `timelineData`
3. 如果存在 timeline 数据，创建带有行动按钮的最终结果消息

### 3. 显示导航按钮

在聊天界面的最终结果消息中：

1. 显示"前往Video Editing查看结果"按钮
2. 按钮样式为成功主题（绿色渐变）
3. 按钮包含右箭头图标

### 4. 导航到 Video Editing

当用户点击按钮时：

1. WorkflowInterface 调用 `onNavigateToVideoEditing` 回调，传递 timeline 数据
2. Container 组件处理导航逻辑：
   - 查找 Video Editing 类型的任务
   - 更新任务的 content，设置 `pendingTimelineData`
   - 查找对应的标签页并切换
3. 用户界面切换到 Video Editing 任务

### 5. 自动导入时间轴数据

VideoEditingInterface 组件检测到 pending timeline 数据时：

1. 通过 useEffect 监听 `content.pendingTimelineData`
2. **规范化时间轴数据**，确保所有 TimelineState 必需字段都存在：
   - `currentTime`, `totalDuration`, `zoomLevel`
   - `selectedItems`, `tracks`
   - `playbackRate`, `isPlaying`
   - `snapToGrid`, `gridSize`, `scrollLeft`
3. 调用 `handleImportComplete` 导入规范化后的时间轴数据
4. 更新 content，清除 `pendingTimelineData` 标记
5. 时间轴面板显示导入的数据

## 数据结构

### WorkflowChatMessage

```typescript
export interface WorkflowChatMessage {
  id: string;
  type: 'user' | 'execution-process' | 'final-result';
  content: string;
  timestamp: Date;
  executionSessionId?: string;
  // 行动按钮配置
  actionButton?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'success' | 'info';
  };
  // AI Video Generate生成的时间轴数据
  timelineData?: any;
}
```

### VideoEditingTaskContent

```typescript
export interface VideoEditingTaskContent {
  markdownContent: string;
  lastModified: Date;
  scriptSegments?: ScriptSegment[];
  materials?: MaterialItem[];
  // 待导入的时间轴数据（从Workflow AI Video Generate节点）
  pendingTimelineData?: any;
}
```

### Timeline Data 结构

AI Video Generate 节点返回的 timeline 数据遵循标准的 TimelineState 格式：

```typescript
interface TimelineState {
  currentTime: number;
  totalDuration: number;
  zoomLevel: number;
  selectedItems: string[];
  tracks: Track[];
}

interface Track {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'subtitle';
  height: number;
  isLocked: boolean;
  isMuted: boolean;
  isVisible: boolean;
  volume: number;
  order: number;
  items: TimelineItem[];
}
```

## 组件接口

### WorkflowChatInterface Props

```typescript
interface WorkflowChatInterfaceProps {
  executionState: WorkflowExecutionState;
  onRunWorkflow: (userInput?: string | null) => void;
  onAbortWorkflow: () => void;
  messages: WorkflowChatMessage[];
  onMessagesChange: (messages: WorkflowChatMessage[]) => void;
  onClearChatHistory: () => void;
  onClearContext: () => void;
  // 导航到Video Editing的回调
  onNavigateToVideoEditing?: (timelineData: any) => void;
}
```

### WorkflowInterface Props

```typescript
interface WorkflowInterfaceProps {
  taskId: string;
  content: WorkflowTaskContent | null;
  onUpdateContent: (content: WorkflowTaskContent) => void;
  // 导航到Video Editing的回调
  onNavigateToVideoEditing?: (timelineData: any) => void;
}
```

### Container Props

```typescript
interface ContainerProps {
  activeTask: Task | null;
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => void;
  onChatModalStateChange?: (isOpen: boolean) => void;
  // 用于导航的任务和标签数据
  tasks?: Task[];
  tabs?: any[];
  onSelectTab?: (tabId: string) => void;
}
```

## 日志记录

### WorkflowChatInterface

- 检测到 AI Video Generate 完成时记录 timeline 数据信息
- 添加最终结果消息时记录是否包含 action button
- 点击导航按钮时记录导航动作

### Container

- 导航开始时记录 timeline 数据概况
- 查找 Video Editing 任务时记录结果
- 更新任务 content 时记录操作
- 切换标签页时记录目标标签信息

### VideoEditingInterface

- 检测到 pending timeline 数据时记录数据概况
- 导入时间轴数据时记录轨道数量
- 清除 pending 标记时记录完成状态

## 错误处理

### Container 导航逻辑

1. **缺少必需 props**：记录警告日志并返回
2. **未找到 Video Editing 任务**：记录错误日志并返回
3. **未找到对应标签页**：记录错误日志但已更新数据

### VideoEditingInterface 导入逻辑

1. **无效的 timeline 数据**：handleImportComplete 会进行验证
2. **导入失败**：错误会被 handleImportComplete 内部处理和记录

## 使用示例

### 在 Workflow 中使用 AI Video Generate 节点

1. 在 Workflow Canvas 中添加 AI Video Generate 节点
2. 配置节点输入（文案、视频、音频、图片等）
3. 连接节点到工作流
4. 运行工作流

### 查看和导入结果

1. 工作流执行完成后，在聊天界面查看最终结果
2. 如果 AI Video Generate 节点成功执行，会显示绿色的"前往Video Editing查看结果"按钮
3. 点击按钮自动切换到 Video Editing 任务
4. 时间轴面板自动显示生成的视频剪辑结果

## 技术要点

### 状态管理

- **Workflow 端**：timelineData 存储在 WorkflowChatMessage 中
- **传输阶段**：通过回调函数传递
- **Video Editing 端**：临时存储在 VideoEditingTaskContent.pendingTimelineData
- **导入后**：清除 pending 标记，数据进入正常的 timeline 状态管理

### 数据规范化

从 Workflow 传来的 `timelineData` 可能只包含部分字段（主要是 `tracks` 和 `totalDuration`），VideoEditingInterface 会自动补全所有 TimelineState 必需字段：

```typescript
const normalizedTimelineData: TimelineState = {
  currentTime: content.pendingTimelineData.currentTime || 0,
  totalDuration: content.pendingTimelineData.totalDuration || 0,
  zoomLevel: content.pendingTimelineData.zoomLevel || 1.0,
  selectedItems: content.pendingTimelineData.selectedItems || [],
  tracks: content.pendingTimelineData.tracks || [],
  playbackRate: content.pendingTimelineData.playbackRate || 1.0,
  isPlaying: content.pendingTimelineData.isPlaying || false,
  snapToGrid: content.pendingTimelineData.snapToGrid !== undefined 
    ? content.pendingTimelineData.snapToGrid 
    : true,
  gridSize: content.pendingTimelineData.gridSize || 1.0,
  scrollLeft: content.pendingTimelineData.scrollLeft || 0
};
```

### 防止重复导入

VideoEditingInterface 的 useEffect 仅在 `content.pendingTimelineData` 变化时触发，导入后立即清除该字段，确保不会重复导入。

### 依赖注入

从上到下的回调传递链：
1. page.tsx 传递 tasks, tabs, selectTab 给 Container
2. Container 创建 handleNavigateToVideoEditing 传给 WorkflowInterface
3. WorkflowInterface 传递给 WorkflowChatInterface
4. WorkflowChatInterface 在消息的 actionButton.onClick 中调用

## 相关文件

### 前端组件

- `src/components/workflow/WorkflowChatInterface.tsx` - 聊天界面和按钮显示
- `src/components/workflow/WorkflowInterface.tsx` - 工作流主界面
- `src/components/Container.tsx` - 容器组件，处理导航逻辑
- `src/app/page.tsx` - 主页面，传递必需 props
- `src/components/video/VideoEditingInterface.tsx` - 视频编辑界面，处理导入

### 类型定义

- `src/types/index.ts` - 添加了 pendingTimelineData 字段和 actionButton 配置

### 后端（无需修改）

- AI Video Generate API 已返回正确的 timeline 数据格式
- `backend-services/basic-service/app/routers/ai_video_generate_router.py`
- `backend-services/basic-service/app/services/ai_video_generate_service.py`

## 最佳实践

1. **日志记录**：在每个关键步骤记录详细日志，便于调试
2. **错误处理**：对缺失数据或组件进行检查和提示
3. **状态清理**：导入后及时清除 pending 标记
4. **用户体验**：按钮样式醒目，导航过程流畅

## 注意事项

1. AI Video Generate 节点必须成功执行才会显示导航按钮
2. 系统会自动查找第一个 Video Editing 类型的任务
3. 如果没有 Video Editing 任务，导航会失败（记录错误日志）
4. Timeline 数据格式必须符合 TimelineState 接口规范
5. 导入过程会清空当前的时间轴内容，替换为新的 timeline 数据

