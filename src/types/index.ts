export interface Task {
  id: string;
  title: string;
  type: 'content' | 'video' | 'audio' | 'brainstorm' | 'chat';
  status: 'active' | 'completed' | 'draft';
  createdAt: Date;
  updatedAt: Date;
  content?: unknown;
}

export interface Tab {
  id: string;
  taskId: string;
  title: string;
  isActive: boolean;
  type: Task['type'];
}

export interface AppState {
  tasks: Task[];
  tabs: Tab[];
  activeTabId: string | null;
}

export type TaskType = Task['type'];
export type TaskStatus = Task['status'];

// Chat related types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatTaskContent {
  conversations: Conversation[];
  activeConversationId: string | null;
}

// Video Editing related types
export interface VideoTaskContent {
  markdownContent: string;
  rightPanelContent?: unknown; // 预留给未来的右侧面板内容
}

export interface LLMConfig {
  apiUrl: string;
  apiKey: string;
  model?: string;
} 