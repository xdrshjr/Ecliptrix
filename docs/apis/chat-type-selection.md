# Chat Type Selection Feature

## Overview

The Chat Type Selection feature allows users to create different types of chat conversations in the AI Chat interface. Users can choose from three types: **Chatbot**, **Workflow**, and **Agent** (reserved for future).

## Feature Description

### Chat Types

1. **Chatbot** (Basic Chat)
   - Simple conversational AI interface
   - Uses the basic chat API endpoint (`/api/chat`)
   - Fast response times
   - No setup required
   - Perfect for quick questions and general discussions

2. **Workflow** (Workflow-based Chat)
   - Integrates with user-created workflows
   - Uses the workflow chat API endpoint (`/api/chat/workflow`)
   - Allows complex multi-step processing
   - Requires workflow selection from available workflows
   - Displays workflow execution state and logs

3. **Agent** (AI Agent - Coming Soon)
   - Reserved for future implementation
   - Will support advanced AI agent capabilities
   - Planned features:
     - Task planning and execution
     - Web search integration
     - Code execution
     - Tool usage

## User Interface

### Modal Design

The Chat Type Selection Modal follows Apple's light minimalist design principles:

- **Clean Layout**: Three-section tabbed interface
- **Visual Hierarchy**: Clear icons and typography
- **Color Coding**:
  - Chatbot: Blue gradient
  - Workflow: Purple gradient
  - Agent: Green gradient
- **Smooth Animations**: Fade-in and zoom effects
- **Responsive Design**: Adapts to different screen sizes

### User Flow

1. User clicks "New Chat" button in the conversation list
2. Chat Type Selection Modal opens
3. User selects one of three tabs: Chatbot, Workflow, or Agent
4. Based on selection:
   - **Chatbot**: Click "Start Chatbot Conversation" to create a basic chat
   - **Workflow**: Select a workflow from the grid of available workflows
   - **Agent**: See "Coming Soon" message (not yet functional)
5. Modal closes and new conversation is created with the selected type

## Technical Implementation

### Type Definitions

```typescript
// Conversation type with chatType field
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  chatType?: 'chatbot' | 'workflow' | 'agent'; // Chat type
  workflowId?: string; // For workflow type
  workflowName?: string; // For workflow type
}
```

### Components

#### ChatTypeSelectionModal

**Location**: `src/components/chat/ChatTypeSelectionModal.tsx`

**Props**:
```typescript
interface ChatTypeSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectChatbot: () => void;
  onSelectWorkflow: (workflowId: string, workflowName: string) => void;
  onSelectAgent: () => void;
}
```

**Features**:
- Three-section tabbed interface
- Lazy loading of workflows (only when workflow tab is selected)
- Error handling and retry functionality
- Empty state handling
- Loading states with animations

#### ChatInterface Updates

**Location**: `src/components/chat/ChatInterface.tsx`

**Key Changes**:
- Replaced `WorkflowSelectionModal` with `ChatTypeSelectionModal`
- Updated conversation creation to include `chatType` parameter
- Enhanced message routing logic to check `chatType` field
- Added handlers for all three chat types

#### ConversationList Updates

**Location**: `src/components/chat/ConversationList.tsx`

**Key Changes**:
- Added chat type badges with color-coded icons
- Displays appropriate icon and label based on `chatType`
- Backward compatibility for conversations without `chatType` field

### API Routing Logic

The system routes messages to different API endpoints based on the conversation's `chatType`:

```typescript
// Determine chat type and API endpoint
const chatType = activeConversation.chatType || 'chatbot';
const useWorkflow = chatType === 'workflow' && !!activeConversation.workflowId;

// Call appropriate API endpoint based on chat type
const apiEndpoint = useWorkflow ? '/api/chat/workflow' : '/api/chat';
```

- **Chatbot**: Routes to `/api/chat` (basic LLM chat)
- **Workflow**: Routes to `/api/chat/workflow` (workflow execution)
- **Agent**: Currently routes to `/api/chat` (reserved for future agent API)

### Logging

Comprehensive logging is implemented throughout the feature:

```typescript
// Conversation creation
console.log('[ChatInterface] Creating new conversation:', {
  conversationId,
  chatType,
  workflowId,
  workflowName,
  timestamp: now.toISOString()
});

// Message sending
console.log('[ChatInterface] Sending message:', {
  chatType,
  useWorkflow,
  workflowId,
  workflowName,
  messageLength: message.length
});

// Modal interactions
console.log('[ChatTypeSelectionModal] Chatbot type selected');
console.log('[ChatTypeSelectionModal] Workflow selected:', {
  workflow_id,
  workflow_name
});
```

## Backward Compatibility

The implementation maintains backward compatibility with existing conversations:

1. **Optional chatType field**: The `chatType` field is optional in the `Conversation` interface
2. **Fallback logic**: If `chatType` is not set, the system checks for `workflowId` to determine behavior
3. **Badge display**: ConversationList includes fallback rendering for conversations without `chatType`

## Future Enhancements

### Agent Type Implementation

When implementing the Agent type in the future:

1. Create new API endpoint: `/api/chat/agent`
2. Implement agent capabilities:
   - Task planning and decomposition
   - Tool usage (web search, code execution, etc.)
   - Memory and context management
3. Update routing logic in `ChatInterface`
4. Remove "Coming Soon" message from modal
5. Add agent-specific UI components for:
   - Task visualization
   - Tool execution logs
   - Agent reasoning display

### Additional Features

- **Chat Type Switching**: Allow users to convert existing conversations between types
- **Type-specific Settings**: Add configuration options for each chat type
- **Analytics**: Track usage patterns across different chat types
- **Templates**: Pre-configured chat templates for common use cases

## Best Practices

1. **User Experience**:
   - Keep modal interactions simple and intuitive
   - Provide clear visual feedback for all actions
   - Show loading states during async operations

2. **Error Handling**:
   - Display user-friendly error messages
   - Provide retry mechanisms for failed operations
   - Log errors for debugging

3. **Performance**:
   - Lazy load workflows only when needed
   - Optimize modal animations for smooth transitions
   - Cache workflow data when appropriate

4. **Accessibility**:
   - Use semantic HTML elements
   - Provide aria-labels for interactive elements
   - Ensure keyboard navigation support

## Testing Recommendations

1. **Unit Tests**:
   - Test conversation creation with different chat types
   - Test API routing logic
   - Test badge rendering in conversation list

2. **Integration Tests**:
   - Test complete user flow from modal to conversation
   - Test workflow selection and execution
   - Test error handling and recovery

3. **UI Tests**:
   - Test modal open/close behavior
   - Test tab switching
   - Test responsive layout

## Related Documentation

- [AI Chat Interface](./ai-chat-interface.md)
- [Workflow Chat Integration](./workflow-chat-integration.md)
- [Chat API](./auth-api.md)
- [Workflow API](./workflow-api.md)

