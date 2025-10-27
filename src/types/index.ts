export interface Task {
  id: string;
  title: string;
  type: 'workflow' | 'video' | 'brainstorm' | 'chat';
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
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  workflowExecution?: {
    workflowId: string;
    workflowName: string;
    executionState?: WorkflowExecutionState;
  };
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  chatType?: 'chatbot' | 'workflow' | 'agent'; // Chat type: chatbot (basic), workflow (workflow-based), or agent (AI agent)
  workflowId?: string; // Associated workflow ID for workflow-based conversations
  workflowName?: string; // Associated workflow name for display
}

export interface ChatTaskContent {
  conversations: Conversation[];
  activeConversationId: string | null;
}

// Workflow related types
export interface WorkflowNodePosition {
  x: number;
  y: number;
}

// LLM Model related types
export interface LLMModel {
  id: string;
  name: string;
  api_url: string;
  api_key: string;
  display_name: string;
  description?: string;
}

export interface LLMModelsResponse {
  success: boolean;
  message: string;
  models: LLMModel[];
  total_count: number;
}

// Data format types for workflow nodes
export type DataFormat = 'text/plain' | 'application/json' | 'array';

// Chat LLM Node Configuration
export interface ChatLLMNodeConfig {
  systemPrompt?: string;
  model?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  inputFormat?: DataFormat;
  outputFormat?: DataFormat;
}

// Text Input Node Configuration
export interface TextInputNodeConfig {
  content?: string;
  inputFormat?: DataFormat;
  outputFormat?: DataFormat;
}

// Start Node Configuration
export interface StartNodeConfig {
  input?: string;
  outputFormat?: DataFormat; // Start node only has output
}

// Pexels Video Search Node Configuration
export interface PexelsVideoSearchNodeConfig {
  keywords?: string;
  count?: number;
  inputFormat?: DataFormat;
  outputFormat?: DataFormat;
}

// Tavily Search Node Configuration
export interface TavilySearchNodeConfig {
  keywords?: string;
  count?: number;
  inputFormat?: DataFormat;
  outputFormat?: DataFormat;
}

// Volcano TTS Node Configuration
export interface VolcanoTTSNodeConfig {
  text?: string;
  voiceType?: string;
  speedRatio?: number;
  inputFormat?: DataFormat;
  outputFormat?: DataFormat;
}

// End Node Configuration
export interface EndNodeConfig {
  inputFormat?: DataFormat; // End node only has input
}

// Array element type for To Array node
export type ArrayElementType = 'string' | 'number' | 'boolean' | 'object';

// Object schema field definition for To Array node
export interface ObjectSchemaField {
  name: string;
  type: ArrayElementType;
  required?: boolean;
  description?: string;
  // For nested objects
  objectSchema?: ObjectSchemaField[];
}

// To Array Node Configuration
export interface ToArrayNodeConfig {
  systemPrompt?: string;
  model?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  inputFormat?: DataFormat;
  outputFormat?: DataFormat; // Always outputs array format
  // New properties for schema definition
  elementType?: ArrayElementType;
  objectSchema?: ObjectSchemaField[];
}

export interface WorkflowNodeData {
  label: string;
  type: string;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  config?: ChatLLMNodeConfig | TextInputNodeConfig | StartNodeConfig | PexelsVideoSearchNodeConfig | TavilySearchNodeConfig | VolcanoTTSNodeConfig | EndNodeConfig | ToArrayNodeConfig | Record<string, any>;
}

export interface WorkflowNode {
  id: string;
  type: string;
  position: WorkflowNodePosition;
  data: WorkflowNodeData;
}

export interface WorkflowConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowData {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  name: string;
  description?: string;
}

// Workflow execution related types
export type WorkflowNodeExecutionStatus = 'pending' | 'executing' | 'completed' | 'error';

export interface WorkflowExecutionLog {
  id: string;
  timestamp: Date;
  level: 'info' | 'success' | 'warning' | 'error';
  nodeId?: string;
  nodeName?: string;
  message: string;
  details?: any;
}

export interface WorkflowNodeExecutionState {
  nodeId: string;
  status: WorkflowNodeExecutionStatus;
  input?: any;
  output?: any;
  error?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface WorkflowExecutionState {
  isRunning: boolean;
  currentNodeId: string | null;
  nodeStates: Record<string, WorkflowNodeExecutionState>;
  logs: WorkflowExecutionLog[];
  startTime?: Date;
  endTime?: Date;
}

export interface WorkflowTaskContent {
  activeWorkflowId: string | null;
  workflows: {
    id: string;
    name: string;
    data: WorkflowData;
  }[];
  executionState?: WorkflowExecutionState;
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
export type MaterialType = 'video' | 'audio' | 'image' | 'subtitle';

// 下载状态类型
export type MaterialDownloadStatus = 'idle' | 'downloading' | 'generating' | 'completed' | 'error';

// 上传状态类型
export type MaterialUploadStatus = 'uploading' | 'completed';

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
  // 新增：下载状态相关字段
  downloadStatus?: MaterialDownloadStatus; // 下载状态
  downloadProgress?: number; // 下载进度 (0-100)
  downloadError?: string; // 下载错误信息
  youtubeUrl?: string; // 原始Youtube URL
  // 新增：上传状态相关字段
  uploadStatus?: MaterialUploadStatus; // 上传状态
  uploadProgress?: number; // 上传进度 (0-100)
  metadata?: { // 额外元数据
    originalUrl?: string; // 原始远程URL
    fileName?: string; // 文件名
    isLocalFile?: boolean; // 是否为本地文件
    downloadError?: string; // 下载错误信息
    [key: string]: any; // 允许其他自定义属性
  };
  
  // 新增：句子段落信息，用于TTS生成的音频素材
  sentenceSegments?: AudioSentenceSegment; // 句子时间信息（仅TTS生成的音频使用）
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

// Subtitle styling related types
export type SubtitleFontFamily = 'default' | 'serif' | 'sans-serif' | 'monospace';
export type SubtitlePosition = 'top' | 'center' | 'bottom' | 'upper-3/4' | 'lower-3/4';

export interface SubtitleStyle {
  fontFamily: SubtitleFontFamily;
  fontSize: number; // 8-72 pixels
  fontColor: string; // hex color
  backgroundColor?: string; // optional hex color
  position: SubtitlePosition;
}

// Predefined subtitle style presets
export interface SubtitleStylePreset {
  id: string;
  name: string;
  style: SubtitleStyle;
}

// Timeline and Video Editing related types

// 新增：句子时间信息，用于TTS音频的句子级时间轴可视化
export interface SentenceTimingInfo {
  sentence_id: string;
  text: string;
  order: number;
  start_time: number; // 相对于音频开始的时间（秒）
  end_time: number;   // 相对于音频开始的时间（秒）
  duration: number;   // 句子时长（秒）
}

// 新增：音频句子段落信息，用于时间轴可视化
export interface AudioSentenceSegment {
  sentences: SentenceTimingInfo[];
  total_duration: number;
  segment_id: string; // 对应脚本段落的ID
}

// 新增：图片叠加位置信息
export interface ImagePosition {
  x: number; // X坐标（0-1，相对于视频宽度）
  y: number; // Y坐标（0-1，相对于视频高度）
  width: number; // 宽度（0-1，相对于视频宽度）
  height: number; // 高度（0-1，相对于视频高度）
  zIndex?: number; // 层级，用于多图片叠加时的前后顺序
}

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
  
  // 新增：原始素材类型，用于区分图片和视频素材
  originalMaterialType?: MaterialType;
  
  // 新增：字幕样式属性
  subtitleStyle?: SubtitleStyle; // 字幕样式（仅字幕类型使用）
  
  // 新增：图片位置信息，用于图片叠加定位
  imagePosition?: ImagePosition; // 图片在视频中的位置信息（仅图片类型使用）
  
  // 新增：句子段落信息，用于TTS音频的时间轴可视化
  sentenceSegments?: AudioSentenceSegment; // 句子时间信息（仅TTS生成的音频使用）
}

export interface Track {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'subtitle';
  height: number;    // 轨道高度（像素）
  isLocked: boolean; // 是否锁定
  isMuted: boolean;  // 是否静音（音频轨道）
  isVisible: boolean; // 是否可见
  volume: number;    // 音量大小（0-200，默认100，仅音频轨道有效）
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
  scrollLeft: number;     // 水平滚动位置（像素）
}

export type TimelineToolType = 
  | 'select'     // 选择工具
  | 'cut'        // 剪切工具
  | 'copy'       // 复制工具
  | 'delete'     // 删除工具
  | 'undo'       // 撤销
  | 'redo'       // 重做
  | 'effect'     // 特效
  | 'transition' // 转场
  | 'subtitle'   // 字幕
  | 'export';    // 导出

export interface TimelineAction {
  type: 'ADD_ITEM' | 'REMOVE_ITEM' | 'UPDATE_ITEM' | 'MOVE_ITEM' | 'SELECT_ITEM' | 'DESELECT_ALL' | 'SELECT_ALL_TRACK_ITEMS';
  payload?: any;
  timestamp: Date;
  // 新增：保存操作前的时间轴状态快照，用于撤销操作
  previousState?: TimelineState;
  // 新增：保存操作后的时间轴状态快照，用于重做操作
  nextState?: TimelineState;
} 

// Video Cut related types
export interface VideoCutClipRequest {
  id: string;
  name: string;
  start_time: number;
  end_time: number;
  duration: number;
}

export interface VideoCutRequest {
  task_id: string;
  video_url: string;
  clips: VideoCutClipRequest[];
  generate_thumbnails?: boolean;
}

export interface VideoCutClipResult {
  id: string;
  name: string;
  video_url: string;
  thumbnail_url?: string;
  file_size: number;
  duration: number;
  width: number;
  height: number;
  format: string;
}

export interface VideoCutResponse {
  success: boolean;
  message: string;
  clips: VideoCutClipResult[];
  total_clips: number;
  processing_time: number;
} 