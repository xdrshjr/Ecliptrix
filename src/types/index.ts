export interface Task {
  id: string;
  title: string;
  type: 'content' | 'video' | 'brainstorm' | 'chat';
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
  videos?: MaterialItem[]; // 关联的视频素材
  keywords?: string[]; // 视频搜索关键词，用于自动填充搜索框
}

export interface VideoEditingTaskContent {
  markdownContent: string;
  lastModified: Date;
  scriptSegments?: ScriptSegment[]; // 文本脚本片段数据
  materials?: MaterialItem[]; // 素材数据
}

// Script Generation Configuration
export interface ScriptGenerationConfig {
  language: 'chinese' | 'english' | 'mixed';
  consistency: 'high' | 'moderate' | 'low';
  segmentCount: number; // 1-10
  customRequirements?: string;
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
  url: string; // 文件URL（本地blob URL或远程URL）
  serverUrl?: string; // 服务器上的文件URL，用于导出合成（主要用于TTS生成的音频文件）
  createdAt: Date;
  tags?: string[]; // 标签
  description?: string; // 描述
  metadata?: { // 额外元数据
    originalUrl?: string; // 原始远程URL
    fileName?: string; // 文件名
    isLocalFile?: boolean; // 是否为本地文件
    downloadError?: string; // 下载错误信息
    [key: string]: any; // 允许其他自定义属性
  };
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

// Timeline and Video Editing related types
export interface TimelineItem {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'subtitle';
  startTime: number; // 开始时间（秒）
  duration: number;  // 持续时间（秒）
  trackId: string;   // 所属轨道ID
  color: string;     // 显示颜色
  thumbnailUrl?: string; // 缩略图（视频用）
  waveformData?: number[]; // 波形数据（音频用）
  text?: string;     // 文本内容（字幕用）
  materialId?: string; // 关联的素材ID
  volume?: number;   // 音量 (0-1)
  opacity?: number;  // 透明度 (0-1)
  isSelected?: boolean; // 是否选中
  
  // 新增：视频剪辑属性，用于支持时间轴上的素材缩放
  clipStart?: number;      // 原始素材中的开始时间（秒）
  clipEnd?: number;        // 原始素材中的结束时间（秒）
  originalDuration?: number; // 原始素材的总时长（秒）
}

export interface Track {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'subtitle';
  height: number;    // 轨道高度（像素）
  isLocked: boolean; // 是否锁定
  isMuted: boolean;  // 是否静音（音频轨道）
  isVisible: boolean; // 是否可见
  items: TimelineItem[];
  order: number;     // 轨道顺序
}

export interface TimelineState {
  currentTime: number;    // 当前播放时间（秒）
  totalDuration: number;  // 总时长（秒）
  zoomLevel: number;      // 缩放级别 (0.1 - 5.0)
  selectedItems: string[]; // 选中的项目ID数组
  tracks: Track[];
  playbackRate: number;   // 播放速度
  isPlaying: boolean;     // 是否正在播放
  snapToGrid: boolean;    // 是否吸附到网格
  gridSize: number;       // 网格大小（秒）
}

export type TimelineToolType = 
  | 'select'     // 选择工具
  | 'cut'        // 剪切工具
  | 'copy'       // 复制工具
  | 'paste'      // 粘贴工具
  | 'delete'     // 删除工具
  | 'undo'       // 撤销
  | 'redo'       // 重做
  | 'effect'     // 特效
  | 'transition' // 转场
  | 'subtitle'   // 字幕
  | 'export';    // 导出

export interface TimelineAction {
  type: 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM' | 'MOVE_ITEM' | 'SELECT_ITEM' | 'DESELECT_ALL';
  payload?: any;
  timestamp: Date;
} 