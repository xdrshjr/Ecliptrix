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
export interface ScriptSentence {
  id: string;
  text: string;
  startTime?: number; // 预留给未来的时间轴功能
  endTime?: number;
}

export interface ScriptSegment {
  id: string;
  title: string; // 视频片段标题
  sentences: ScriptSentence[];
  duration?: number; // 预留给未来的时长信息
  thumbnail?: string; // 预留给未来的缩略图
}

export interface VideoEditingTaskContent {
  markdownContent: string;
  lastModified: Date;
  scriptSegments?: ScriptSegment[]; // 文本脚本片段数据
  materials?: MaterialItem[]; // 素材数据
}

// Materials Management related types
export type MaterialType = 'video' | 'audio' | 'image';

export interface MaterialItem {
  id: string;
  name: string;
  type: MaterialType;
  format: string; // 文件格式 (mp4, mp3, jpg, etc.)
  size: number; // 文件大小（字节）
  duration?: number; // 时长（秒），仅用于视频和音频
  width?: number; // 宽度（像素），仅用于视频和图片
  height?: number; // 高度（像素），仅用于视频和图片
  thumbnailUrl?: string; // 缩略图URL
  url: string; // 文件URL
  createdAt: Date;
  tags?: string[]; // 标签
  description?: string; // 描述
}

export interface MaterialsData {
  items: MaterialItem[];
  totalSize: number; // 总大小（字节）
  totalCount: number; // 总数量
}

export interface LLMConfig {
  apiUrl: string;
  apiKey: string;
  model?: string;
} 