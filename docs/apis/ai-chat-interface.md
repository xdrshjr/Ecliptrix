# AI Chat Interface API Documentation

## Overview
The AI Chat Interface provides a standalone chat task type with a clean, elegant conversation interface that follows Apple's design principles. Users can create multiple conversations, switch between them, and have AI-assisted conversations with streaming responses.

## Features

### 1. Task Management
- **Task Type**: `chat`
- **Independent Task**: Separate from workflow tasks, dedicated to AI conversations
- **Multi-conversation Support**: Create and manage multiple chat conversations within a single task

### 2. User Interface
- **Layout**: 
  - Left sidebar (15% width, min 200px): Conversation list
  - Right side (85% width): Active chat window
- **Design Style**: Clean, elegant, minimalist Apple light theme
- **Responsive**: Adapts to different screen sizes while maintaining usability

### 3. Conversation Management
- **Create**: New conversation with auto-generated title from first message
- **Switch**: Click conversations in the list to switch between them
- **Delete**: Remove conversations with confirmation dialog
- **State Preservation**: Each conversation maintains its own chat history and state

## API Endpoints

### Chat API Endpoint
**Endpoint**: `/api/chat`
**Method**: `POST`
**Content-Type**: `application/json`

#### Request Body
```json
{
  "messages": [
    {
      "role": "user" | "assistant",
      "content": "Message content"
    }
  ]
}
```

#### Response
Server-Sent Events (SSE) stream with format:
```
data: {"content": "streaming text chunk"}
data: {"content": "next chunk"}
data: [DONE]
```

#### Example Usage
```typescript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    messages: [
      { role: 'user', content: 'Hello!' },
    ],
  }),
});

const reader = response.body?.getReader();
let accumulatedContent = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = new TextDecoder().decode(value);
  const lines = chunk.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') break;
      
      const parsed = JSON.parse(data);
      if (parsed.content) {
        accumulatedContent += parsed.content;
        // Update UI with accumulated content
      }
    }
  }
}
```

## Configuration

### Environment Variables
The chat API requires the following environment variables:

```env
# LLM API Configuration
LLM_API_URL=https://api.openai.com/v1  # Or your custom LLM endpoint
LLM_API_KEY=your_api_key_here          # Required
LLM_MODEL=gpt-3.5-turbo               # Model to use

# Alternative naming (backwards compatible)
OPENAI_API_URL=https://api.openai.com/v1
OPENAI_API_KEY=your_api_key_here
```

## Data Types

### Task Content Structure
```typescript
interface ChatTaskContent {
  conversations: Conversation[];
  activeConversationId: string | null;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}
```

## User Interactions

### Creating a New Chat Task
1. Click "New Task" button in the taskbar
2. Select "AI Chat" from the menu
3. A new chat task is created and activated

### Managing Conversations
1. **New Conversation**: Click "New Chat" button in the left sidebar
2. **Switch Conversation**: Click any conversation in the list
3. **Delete Conversation**: Hover over conversation and click the delete icon
4. **Send Message**: Type in the input field and press Enter (Shift+Enter for new line)
5. **Clear Chat**: Click the clear button to delete all messages in current conversation

### Keyboard Shortcuts
- `Enter`: Send message
- `Shift + Enter`: New line in message input

## Component Architecture

### Main Components
1. **ChatInterface** (`src/components/chat/ChatInterface.tsx`)
   - Main container component
   - Manages conversation state
   - Handles API communication
   - Layout: 15% sidebar / 85% chat window

2. **ConversationList** (`src/components/chat/ConversationList.tsx`)
   - Displays list of conversations
   - Handles conversation selection and deletion
   - Shows conversation metadata (message count, date)

3. **ChatWindow** (`src/components/chat/ChatWindow.tsx`)
   - Main chat interface
   - Displays messages
   - Input area with auto-resize
   - Clear chat functionality

4. **MessageBubble** (`src/components/chat/MessageBubble.tsx`)
   - Individual message display
   - User messages (blue, right-aligned)
   - Assistant messages (gray, left-aligned)
   - Markdown rendering support

## Logging

### Frontend Logging
All chat operations are logged with structured information:
- Conversation creation, selection, deletion
- Message sending and streaming
- API communication status
- Error handling

Example log format:
```
[Chat] Updating messages for conversation conv-1234567890, message count: 5
[Chat] Last message - role: assistant, content length: 250, isStreaming: false
[Chat] Streaming update - accumulated content length: 150
[Chat] Streaming complete - final content length: 250
```

### Backend Logging
The chat API logs all requests and responses:
```
[Chat API] 2025-01-15T10:30:00.000Z - Incoming chat request
[Chat API] Model: gpt-3.5-turbo
[Chat API] Messages count: 3
[Chat API] Last message: Hello, how can you help me?...
[Chat API] Calling LLM API: https://api.openai.com/v1/chat/completions
[Chat API] 2025-01-15T10:30:05.000Z - Response completed successfully
```

## Error Handling

### Common Errors

1. **Missing API Key**
   - Error: `API key not configured`
   - Solution: Set `LLM_API_KEY` or `OPENAI_API_KEY` in environment variables

2. **LLM API Error**
   - Error: `LLM API error: {status_code}`
   - Solution: Check API endpoint, key validity, and network connectivity

3. **Invalid Request**
   - Error: `Messages array is required`
   - Solution: Ensure request body contains valid messages array

## Best Practices

1. **Authentication**: Users must be logged in to create and use chat tasks
2. **Conversation Management**: Regularly delete old conversations to maintain performance
3. **Message Length**: Consider implementing message length limits for optimal UX
4. **Error Recovery**: The UI gracefully handles API errors and allows retry
5. **State Persistence**: All conversations and messages are persisted in task content

## UI Design Principles

The AI Chat interface follows Apple's design language:
- **Clean & Minimal**: No unnecessary elements
- **Light Theme**: White backgrounds with subtle gray accents
- **Rounded Corners**: Consistent 12px-24px border radius
- **Smooth Animations**: Subtle transitions for state changes
- **Clear Typography**: SF Pro-inspired font stack
- **Intuitive Icons**: Clear, recognizable symbols
- **Proper Spacing**: Generous padding and margins
- **Focused Interactions**: Clear hover and active states

## Performance Considerations

1. **Streaming**: Messages are streamed in real-time for better UX
2. **Auto-scroll**: Smart scrolling that respects user interaction
3. **Lazy Loading**: Conversation list can be optimized for many conversations
4. **State Management**: Efficient React state updates during streaming
5. **Memory Management**: Message history is stored efficiently

## Future Enhancements

Potential improvements for future iterations:
- Conversation search functionality
- Message editing and deletion
- Conversation export (Markdown, PDF)
- Advanced model selection per conversation
- Custom system prompts
- File attachments support
- Code syntax highlighting in messages
- Voice input support

## Related Documentation
- [Auth API](./auth-api.md) - Authentication system
- [User Profile API](./user-profile-api.md) - User management
- [Workflow Chat Interface](./workflow-chat-interface.md) - Workflow-specific chat

