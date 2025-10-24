# Workflow Chat Interface API Documentation

## Overview

The Workflow Chat Interface provides a ChatGPT-like conversational interface for interacting with workflow execution. It displays real-time workflow node execution status and results in a clean, elegant chat format.

## Features

### 1. Tab-Based Interface
- **Chat Tab**: Conversational interface showing workflow execution progress
- **Workflow Tab**: Visual workflow editor with nodes and connections

### 2. Real-Time Execution Tracking
- Live updates of node execution status (pending, executing, completed, error)
- Automatic conversion of execution logs to chat messages
- Final result display with formatted output

### 3. User Interaction
- Send messages to trigger workflow execution
- Stop/abort running workflows
- View execution history in chat format

### 4. Apple-Style Design
- Clean, minimalist interface
- Light theme with subtle shadows
- Smooth animations and transitions
- Responsive layout

## Component Architecture

### WorkflowChatInterface

**Location**: `src/components/workflow/WorkflowChatInterface.tsx`

**Props**:
```typescript
interface WorkflowChatInterfaceProps {
  executionState: WorkflowExecutionState;
  onRunWorkflow: () => void;
  onAbortWorkflow: () => void;
}
```

**State Management**:
- `messages`: Array of chat messages converted from execution logs
- `inputValue`: Current user input text
- Auto-scrolling to latest messages
- Real-time synchronization with execution state

### WorkflowInterface (Updated)

**Location**: `src/components/workflow/WorkflowInterface.tsx`

**New Features**:
- Tab switching between Chat and Workflow views
- State preservation when switching tabs
- Integrated workflow execution state management

**Tab System**:
```typescript
type RightPanelTab = 'chat' | 'workflow';
```

## Message Types

### WorkflowChatMessage
```typescript
interface WorkflowChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  nodeId?: string;
  nodeName?: string;
  executionStatus?: 'pending' | 'executing' | 'completed' | 'error';
  metadata?: any;
}
```

### Message Roles
- **user**: User-initiated messages (triggers workflow)
- **assistant**: Node execution results and outputs
- **system**: Workflow status updates and notifications

## Execution Flow

### 1. User Sends Message
```
User Input → Chat Message Created → Workflow Execution Triggered
```

### 2. Workflow Execution
```
Start Node → Process Nodes → End Node
     ↓             ↓            ↓
  Chat Log    Chat Log     Chat Log
```

### 3. Real-Time Updates
```
Execution Log → Message Conversion → Chat Display → Auto-scroll
```

## Log to Message Conversion

The system automatically converts execution logs to user-friendly chat messages:

| Log Type | Message Format |
|----------|---------------|
| Workflow Start | 🚀 工作流开始执行... |
| Node Executing | ⚙️ 正在执行节点: {nodeName} |
| Node Success | ✅ 节点 "{nodeName}" 执行成功 |
| Workflow Complete | ✅ 工作流执行完成！ |
| Error | ❌ 错误: {message} |
| Warning | ⚠️ {message} |

## UI Components

### Chat Header
- Icon and title
- Execution status indicator
- Running state badge

### Messages Area
- Scrollable message list
- Color-coded by role (blue for user, white for assistant, gray for system)
- Execution status badges
- Timestamp display
- Metadata collapse/expand

### Input Area
- Multi-line textarea with auto-resize
- Send button (disabled during execution)
- Stop button (visible during execution)
- Keyboard shortcuts (Enter to send, Shift+Enter for new line)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Enter | Send message and trigger workflow |
| Shift + Enter | New line in input |

## Styling Guidelines

### Apple Light Theme
- **Background**: `bg-gray-50`
- **Cards**: `bg-white` with `border-gray-200`
- **Buttons**: Rounded corners (`rounded-2xl`), subtle shadows
- **Colors**: Blue for primary actions, Red for destructive actions
- **Typography**: Clean, readable font sizes (14-16px for body)
- **Spacing**: Generous padding and margins
- **Animations**: Smooth transitions (`transition-all`)

### Message Styling
```css
User Message: bg-blue-500 text-white (right-aligned)
Assistant Message: bg-white border border-gray-200 (left-aligned)
System Message: bg-gray-100 text-gray-700 (center-aligned)
```

## State Preservation

When switching between Chat and Workflow tabs:
- Chat messages are preserved
- Workflow canvas state is maintained
- Execution state is shared across tabs
- No data loss occurs

## Error Handling

### Execution Errors
- Displayed as red error messages in chat
- Error details included in metadata
- Node name and error type indicated

### Input Validation
- Empty messages are blocked
- Cannot send during execution
- Visual feedback for disabled states

## Performance Optimizations

1. **Auto-scroll**: Only when messages are visible
2. **Message Rendering**: Efficient key-based React rendering
3. **State Updates**: Minimal re-renders with proper dependency arrays
4. **Event Handling**: Debounced where appropriate

## Integration Points

### WorkflowExecutor
- Consumes execution state from WorkflowExecutor
- Listens to log updates in real-time
- Triggers execution via callback

### WorkflowInterface
- Embedded as tab content
- Shares execution state
- Coordinated with workflow canvas

## Logging

All major actions are logged to console:
- Tab switching
- Message sending
- Workflow execution triggers
- State updates

**Log Format**:
```
[WorkflowChatInterface] {action}: {details}
```

## Future Enhancements

Potential improvements for future versions:
1. Message editing/deletion
2. Conversation history export
3. Rich media support (images, code blocks)
4. Markdown rendering
5. Custom message templates
6. Search/filter messages
7. Message reactions
8. Thread support for complex workflows

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile browsers: Responsive design supported

## Accessibility

- Keyboard navigation support
- ARIA labels where appropriate
- Semantic HTML structure
- High contrast color ratios
- Focus indicators

## Security Considerations

- Input sanitization (handled by React)
- No direct HTML injection
- Metadata properly escaped
- Safe JSON stringification with error handling

## Testing Recommendations

1. Test workflow execution with various node types
2. Verify message ordering and timestamps
3. Test tab switching during execution
4. Verify error message display
5. Test keyboard shortcuts
6. Verify auto-scroll behavior
7. Test with long messages
8. Test abort functionality

## Related Documentation

- [Workflow API](./workflow-api.md)
- [Workflow Executor](../../src/components/workflow/WorkflowExecutor.ts)
- [Workflow Types](../../src/types/index.ts)

