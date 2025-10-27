# Workflow Chat Integration API

## Overview

This document describes the integration between AI Chat and Workflow features, allowing users to execute workflows through conversational interfaces with real-time execution feedback.

## Features

### 1. Workflow Selection Modal
- **Location**: AI Chat → New Chat button
- **Purpose**: Select a workflow when creating a new chat conversation
- **Design**: Apple light minimalist style with clean, elegant UI
- **Functionality**:
  - Displays all available user workflows
  - Shows workflow metadata (name, description, nodes count, version)
  - Provides visual feedback for active workflows
  - Responsive grid layout

### 2. Workflow-based Conversations
- Each conversation can be associated with a specific workflow
- Workflow information is displayed in:
  - Conversation list (with workflow badge)
  - Chat header (with workflow name tag)
- User input is passed directly to the workflow for execution

### 3. Real-time Execution Display
- Shows node-by-node execution progress
- Displays execution status for each node:
  - Pending (gray)
  - Executing (blue, animated)
  - Completed (green with checkmark)
  - Error (red with X)
- Collapsible execution details
- Timeline view of node execution
- Final result prominently displayed

## API Endpoints

### POST /api/chat/workflow

Execute a workflow with user input and stream execution results.

#### Request

```typescript
{
  workflowId: string;           // ID of the workflow to execute
  userInput: string;            // User's input message
  messages?: ChatMessage[];     // Optional chat history
}
```

#### Response (Server-Sent Events)

The endpoint returns a stream of events in SSE format:

##### Event Types

1. **Status Update**
```json
{
  "type": "status",
  "status": "loading",
  "message": "Loading workflow..."
}
```

2. **Execution Start**
```json
{
  "type": "execution_start",
  "workflowId": "workflow-123",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

3. **Node Update**
```json
{
  "type": "node_update",
  "nodeId": "node-1",
  "nodeName": "Start Node",
  "status": "executing" | "completed" | "error",
  "output": "Node execution result",
  "startTime": "2024-01-01T00:00:00.000Z",
  "endTime": "2024-01-01T00:00:01.000Z"
}
```

4. **Final Result**
```json
{
  "type": "final_result",
  "content": "Workflow execution result",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

5. **Error**
```json
{
  "type": "error",
  "error": "Error message"
}
```

6. **Completion**
```
data: [DONE]
```

#### Example Usage

```typescript
const response = await fetch('/api/chat/workflow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    workflowId: 'workflow-123',
    userInput: 'Process this text',
    messages: []
  })
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') break;
      
      const event = JSON.parse(data);
      // Handle event based on type
      console.log(event);
    }
  }
}
```

## Data Models

### Conversation Type Extension

```typescript
interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  workflowId?: string;        // NEW: Associated workflow ID
  workflowName?: string;      // NEW: Associated workflow name
}
```

### ChatMessage Type Extension

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  workflowExecution?: {       // NEW: Workflow execution metadata
    workflowId: string;
    workflowName: string;
    executionState?: WorkflowExecutionState;
  };
}
```

### WorkflowExecutionState

```typescript
interface WorkflowExecutionState {
  isRunning: boolean;
  currentNodeId: string | null;
  nodeStates: Record<string, WorkflowNodeExecutionState>;
  logs: WorkflowExecutionLog[];
  startTime?: Date;
  endTime?: Date;
}

interface WorkflowNodeExecutionState {
  nodeId: string;
  status: 'pending' | 'executing' | 'completed' | 'error';
  input?: any;
  output?: any;
  error?: string;
  startTime?: Date;
  endTime?: Date;
}

interface WorkflowExecutionLog {
  id: string;
  timestamp: Date;
  level: 'info' | 'success' | 'warning' | 'error';
  nodeId?: string;
  nodeName?: string;
  message: string;
  details?: any;
}
```

## Components

### WorkflowSelectionModal

**Path**: `src/components/chat/WorkflowSelectionModal.tsx`

**Props**:
```typescript
interface WorkflowSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWorkflow: (workflowId: string, workflowName: string) => void;
}
```

**Features**:
- Loads user workflows from API
- Grid display with workflow cards
- Loading, error, and empty states
- Apple-style design
- Responsive layout

### WorkflowExecutionMessage

**Path**: `src/components/chat/WorkflowExecutionMessage.tsx`

**Props**:
```typescript
interface WorkflowExecutionMessageProps {
  workflowName: string;
  executionState?: WorkflowExecutionState;
  finalResult?: string;
  isComplete: boolean;
}
```

**Features**:
- Displays workflow execution progress
- Collapsible node details
- Timeline visualization
- Status indicators
- Final result display

## User Flow

1. **Create New Chat with Workflow**:
   - User clicks "New Chat" button
   - Workflow selection modal appears
   - User selects a workflow
   - New conversation is created with workflow association

2. **Send Message**:
   - User types message in chat input
   - Message is sent to workflow execution endpoint
   - Workflow starts executing

3. **View Execution**:
   - Real-time node execution updates appear
   - User sees which node is currently executing
   - Node results are displayed as they complete
   - Progress is visualized with status indicators

4. **View Result**:
   - Final result is displayed prominently
   - Execution details can be collapsed
   - User can send another message to continue

## Logging

All components include detailed logging for:
- Workflow selection
- Conversation creation
- Message sending
- Execution streaming
- State updates
- Errors and warnings

Logs are prefixed with component names for easy filtering:
- `[WorkflowSelectionModal]`
- `[ConversationList]`
- `[ChatInterface]`
- `[Workflow Chat API]`

## Error Handling

### Frontend
- Network errors during workflow loading
- Streaming connection failures
- Invalid workflow data
- UI state recovery

### Backend
- Workflow not found
- Invalid user input
- Execution failures
- Stream errors

All errors are logged with context and displayed to users with helpful messages.

## Best Practices

1. **Performance**:
   - Workflows are loaded on-demand when modal opens
   - Execution state updates are debounced
   - Large outputs are truncated in UI

2. **User Experience**:
   - Clear visual feedback for all actions
   - Loading states prevent confusion
   - Error messages are actionable
   - Workflow association is always visible

3. **Maintainability**:
   - Components are modular and reusable
   - Types are well-defined
   - Logging is comprehensive
   - Code follows DDD principles

## Future Enhancements

- [ ] Workflow execution history
- [ ] Pause/resume workflow execution
- [ ] Retry failed nodes
- [ ] Save workflow execution results
- [ ] Share workflow conversations
- [ ] Workflow templates
- [ ] Advanced filtering in workflow selection
- [ ] Workflow execution metrics

## Related Documentation

- [Workflow API](./workflow-api.md)
- [AI Chat Interface](./ai-chat-interface.md)
- [Workflow Chat Interface](./workflow-chat-interface.md)


