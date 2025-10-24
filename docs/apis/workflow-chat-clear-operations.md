# Workflow Chat Clear Operations API

## Overview
This document describes the new clear operations functionality added to the Workflow Chat Interface. These features allow users to manage their chat history and workflow execution context independently.

## Features

### 1. Clear Chat History (清空聊天记录)
Removes all chat messages for the current workflow while preserving the execution context.

**Location**: Workflow Chat Interface → Below the chat header, above the input area

**Button**: "清空聊天记录" (Clear Chat History)

**Icon**: Trash/Delete icon

**Behavior**:
- Displays a confirmation dialog before clearing
- Only enabled when there are messages to clear
- Disabled during workflow execution
- Clears all messages for the current workflow
- Preserves execution state and context

**Confirmation Dialog**:
```
确定要清空所有聊天记录吗？此操作不可撤销。
(Are you sure you want to clear all chat history? This action cannot be undone.)
```

**Use Cases**:
- Start a fresh conversation while maintaining workflow state
- Clean up the chat interface after testing
- Remove old messages to reduce visual clutter

---

### 2. Clear Context (清空上下文)
Resets the workflow execution context while preserving all chat messages.

**Location**: Workflow Chat Interface → Below the chat header, next to "Clear Chat History" button

**Button**: "清空上下文" (Clear Context)

**Icon**: Refresh/Reset icon

**Behavior**:
- Displays a confirmation dialog before clearing
- Always enabled except during workflow execution
- Resets all execution state (node states, logs, executor instance)
- Preserves all chat messages
- Does not affect the workflow configuration (nodes and connections)

**Confirmation Dialog**:
```
确定要清空当前工作流的上下文吗？聊天记录将保留。
(Are you sure you want to clear the current workflow context? Chat history will be preserved.)
```

**Use Cases**:
- Reset workflow state after an error
- Start a new execution session with fresh context
- Clear execution logs and node states without losing chat history

---

## UI Design

### Button Styling
Both buttons follow Apple's design language:
- White background with gray border
- Rounded corners (rounded-xl)
- Subtle shadow (shadow-sm)
- Hover effects:
  - Light gray background (hover:bg-gray-50)
  - Darker border (hover:border-gray-400)
  - Increased shadow (hover:shadow-md)
- Disabled state: 50% opacity
- Icon + Text layout with horizontal spacing

### Layout
```
┌─────────────────────────────────────────────────────────────┐
│  Workflow Chat Interface                                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [Chat Messages Area]                                        │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  [🗑️ 清空聊天记录]  [🔄 清空上下文]                          │
│                                                              │
│  ┌────────────────────────────────────────────┐  [发送]     │
│  │ Input area...                              │             │
│  └────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### State Management

#### WorkflowInterface.tsx
Manages per-workflow state using the `workflowChatStates` object:

```typescript
const [workflowChatStates, setWorkflowChatStates] = useState<Record<string, {
  messages: any[];
  contextCleared: boolean;
}>>({});
```

**Key Features**:
- Each workflow has its own independent chat state
- State persists when switching between workflows
- `contextCleared` flag tracks if context has been reset

#### Clear Chat History Handler
```typescript
const handleClearChatHistory = useCallback(() => {
  // Clears messages array for current workflow
  // Preserves contextCleared flag
}, [activeWorkflowId, activeChatState.messages.length]);
```

#### Clear Context Handler
```typescript
const handleClearContext = useCallback(() => {
  // Marks context as cleared
  // Resets executionState
  // Clears workflowExecutor instance
  // Preserves messages array
}, [activeWorkflowId, activeChatState.messages.length]);
```

### WorkflowChatInterface.tsx

**New Props**:
```typescript
interface WorkflowChatInterfaceProps {
  // ... existing props
  onClearChatHistory: () => void;
  onClearContext: () => void;
}
```

**Event Handlers**:
- `handleClearChatHistoryClick()`: Shows confirmation and calls parent handler
- `handleClearContextClick()`: Shows confirmation and calls parent handler

---

## Logging

All operations are logged with detailed context information:

### Clear Chat History Logs
```typescript
console.log('[WorkflowInterface] Clearing chat history for workflow:', {
  workflowId: activeWorkflowId,
  previousMessagesCount: activeChatState.messages.length,
  timestamp: new Date().toISOString()
});
```

### Clear Context Logs
```typescript
console.log('[WorkflowInterface] Clearing context for workflow:', {
  workflowId: activeWorkflowId,
  timestamp: new Date().toISOString()
});

console.log('[WorkflowInterface] Context cleared successfully:', {
  workflowId: activeWorkflowId,
  messagesPreserved: activeChatState.messages.length
});
```

### User Action Logs
```typescript
console.log('[WorkflowChatInterface] Clear chat history button clicked:', {
  currentMessagesCount: messages.length,
  timestamp: new Date().toISOString()
});

console.log('[WorkflowChatInterface] User confirmed clearing chat history');
console.log('[WorkflowChatInterface] User cancelled clearing chat history');
```

---

## Best Practices

### When to Use Clear Chat History
1. After completing a workflow testing session
2. When starting a new conversation topic
3. To reduce UI clutter from old messages
4. Before sharing the interface with others

### When to Use Clear Context
1. After encountering execution errors
2. When workflow state becomes inconsistent
3. To start fresh execution without losing conversation history
4. When switching between different execution scenarios

### Workflow Switching
- Both chat history and context are preserved per workflow
- Switching workflows maintains independent state for each
- No data loss when navigating between workflows

---

## Error Handling

### Empty Chat History
- "Clear Chat History" button is automatically disabled when no messages exist
- Prevents unnecessary confirmation dialogs

### During Execution
- Both buttons are disabled while workflow is running
- Prevents state corruption during active execution
- User must stop execution before clearing

### Confirmation Dialogs
- Native browser confirmation dialogs
- User can cancel at any time
- No action taken if user clicks "Cancel"

---

## Future Enhancements

Potential improvements for future versions:

1. **Undo Functionality**: Allow users to restore cleared chat history
2. **Selective Message Deletion**: Delete individual messages instead of all
3. **Auto-save Before Clear**: Backup data before clearing
4. **Export Chat History**: Save messages to file before clearing
5. **Context Snapshots**: Save and restore specific context states
6. **Keyboard Shortcuts**: Add hotkeys for quick clearing (e.g., Ctrl+Shift+D)

---

## Related Files

### Frontend Components
- `src/components/workflow/WorkflowInterface.tsx` - Main workflow interface and state management
- `src/components/workflow/WorkflowChatInterface.tsx` - Chat interface with clear buttons
- `src/components/workflow/WorkflowExecutor.ts` - Workflow execution engine

### Documentation
- `docs/apis/workflow-chat-interface.md` - Original workflow chat interface documentation
- `docs/apis/workflow-api.md` - Workflow API documentation

---

## Change Log

### Version 1.0.0 (2025-10-24)
- Initial implementation of clear chat history functionality
- Added clear context functionality
- Implemented per-workflow state management
- Added confirmation dialogs for user safety
- Comprehensive logging for all operations
- Apple-style UI design for buttons

---

## Support

For issues or questions regarding this feature:
1. Check the browser console for detailed logs
2. Verify workflow state in React DevTools
3. Ensure no workflow is running before clearing
4. Review confirmation dialog messages carefully

---

## Testing Checklist

- [ ] Clear chat history removes all messages
- [ ] Clear chat history preserves execution context
- [ ] Clear context preserves chat messages
- [ ] Clear context resets execution state
- [ ] Confirmation dialogs appear before clearing
- [ ] Buttons disabled during execution
- [ ] Clear chat history disabled when no messages
- [ ] State persists when switching workflows
- [ ] Logging captures all operations
- [ ] UI matches Apple design guidelines

