export interface Task {
  id: string;
  title: string;
  type: 'video' | 'chat';
  status: 'active' | 'completed' | 'draft';
  createdAt: Date;
  updatedAt: Date;
  content?: unknown;
  /**
   * Currently-open video project for the Video Editing tab. When unset, the
   * tab renders the project list / cards landing instead of the editor.
   * Always cleared when the user navigates "Back to projects".
   */
  selectedProjectId?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Video Project (per-user persisted projects for the Video Editing tab)
// ───────────────────────────────────────────────────────────────────────────

export interface VideoProjectCategory {
  id: string;
  name: string;
  color?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface VideoProjectListItem {
  id: string;
  name: string;
  description?: string;
  category_id?: string;
  cover_url?: string;
  created_at: string;
  updated_at: string;
  last_opened_at?: string;
}

export interface VideoProjectRecord extends VideoProjectListItem {
  /** Full VideoEditingTaskContent payload — only present on detail/get/create/update responses. */
  project_data?: Record<string, unknown>;
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

// Chat related types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  metadata?: {
    type?: 'intent_detection' | 'intent_result';
    status?: string;
    intention?: any;
  };
  // Agent mode fields
  isAgentMessage?: boolean;
  agentToolCalls?: AgentToolCallRecord[];
  timelineSnapshot?: TimelineState;
  pendingOperations?: Array<AgentTimelineOperation | { type: string; [key: string]: unknown }>;
  isUndone?: boolean;
  /** True when the user explicitly stopped this agent turn (or it was sealed
   *  by the on-mount sweep after a hard refresh). Used by messageConverter to
   *  emit a "previous turn was stopped" system note on resume. */
  isCancelled?: boolean;
  // Agent thinking mode fields
  thinkingContent?: string;
  isThinking?: boolean;
}

export interface AgentToolCallRecord {
  id: string;
  name: string;
  params: Record<string, unknown>;
  status: 'executing' | 'completed' | 'error' | 'undone' | 'cancelled';
  result?: unknown;
}

export interface AgentClipData {
  id: string;
  trackId: string;
  startTime: number;
  duration: number;
  materialId: string;
  clipStart: number;
  clipEnd: number;
  originalDuration: number;
  volume: number;
}

export interface AgentMaterialData {
  id: string;
  name: string;
  type: string;
  thumbnailUrl?: string;
}

export type AgentTimelineOperation =
  | { type: 'add_clip'; clip: AgentClipData; material: AgentMaterialData }
  | { type: 'trim_clip'; clipId: string; clipStart: number; clipEnd: number; duration: number }
  | { type: 'delete_clip'; clipId: string; trackId: string }
  | { type: 'move_clip'; clipId: string; fromTrackId: string; toTrackId: string; newStartTime: number }
  | { type: 'resize_clip'; clipId: string; newDuration: number };

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  chatType?: 'chatbot' | 'agent'; // Chat type: chatbot (basic) or agent (AI agent)
}

export interface ChatTaskContent {
  conversations: Conversation[];
  activeConversationId: string | null;
  // UI state preservation
  uiState?: {
    isLoading?: boolean;
    isChatTypeModalOpen?: boolean;
    hasAutoInitialized?: boolean; // Track if auto-initialization has occurred
  };
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

// Video Editing related types
export interface ScriptSentence {
  id: string;
  text: string;
  narration?: string; // 解说文案（对应该句的旁白文本）
  // 「AI 视频脚本」专用字段（解说直接生成链路）：与 text/narration/aiVideoPrompt 语义分离。
  // text=旁白原文（TTS/ARK 兜底取文）；videoScript=画面/镜头描述（与旁白逐字不同）。
  // videoScriptStatus 是否存在 == 是否「解说直接生成句」的判别位（常规链路句恒 undefined）。
  videoScript?: string;
  videoScriptStatus?: 'idle' | 'generating' | 'succeeded' | 'failed';
  videoScriptError?: string;
  startTime?: number; // 预留给未来的时间轴功能
  endTime?: number;
  // 句子级 AI 视频生成关联字段（per-sentence narration AI video）
  linkedMaterialId?: string;
  generatedVideoUrl?: string;
  generatedVideoThumbnailUrl?: string;
  aiVideoStatus?: 'idle' | 'generating' | 'succeeded' | 'failed';
  // 句子级 AI 视频提示词：TTS 完成后自动生成 + 用户可手动刷新
  aiVideoPrompt?: string;
  aiVideoPromptStatus?: 'idle' | 'generating' | 'succeeded' | 'failed';
  aiVideoPromptError?: string;
  // 标记手动触发的结果，避免后到的自动结果覆盖用户确认版本
  aiVideoPromptManual?: boolean;
}

export interface ScriptSegment {
  id: string;
  title: string; // 视频片段标题
  sentences: ScriptSentence[];
  narrationText?: string; // 解说文案（整段的旁白文本，TTS优先使用）
  duration?: number; // 预留给未来的时长信息
  thumbnail?: string; // 预留给未来的缩略图
  videos?: MaterialItem[]; // 关联的视频素材
  keywords?: string[]; // 视频搜索关键词，用于自动填充搜索框
}

export interface AIVideoScriptSegment {
  id: string;
  title: string;
  scriptText: string;
  narrationText?: string; // 解说文案（对应该段的旁白文本）
  /** Video duration in seconds (4-12) */
  duration?: number;
  /** Generation mode: description (reference images with first/last frame roles), keyframe (first/last frame), reference (reference images with role="reference_image") */
  generationMode?: 'description' | 'keyframe' | 'reference';
  // Mode A (描述生成) — reference images with first_frame/last_frame roles
  characterImageUrl?: string;
  characterImageName?: string;
  sceneImageUrl?: string;
  sceneImageName?: string;
  // Mode B (关键帧生成) — keyframe images
  firstFrameUrl?: string;
  firstFrameName?: string;
  lastFrameUrl?: string;
  lastFrameName?: string;
  // Mode C (参考图生成) — reference images with role="reference_image" (official ARK API spec)
  referenceImageUrl?: string;
  referenceImageName?: string;
  referenceImage2Url?: string;
  referenceImage2Name?: string;
  autoTransition?: boolean;
  generationStatus?: 'idle' | 'generating' | 'succeeded' | 'failed';
  generationProgress?: number;
  arkTaskId?: string;
  generatedVideoUrl?: string;
  generatedVideoThumbnailUrl?: string;
  generatedVideoDuration?: number;
  generatedVideoWidth?: number;
  generatedVideoHeight?: number;
  generationError?: string;
}

export interface VideoEditingTaskContent {
  markdownContent: string;
  lastModified: Date;
  scriptSegments?: ScriptSegment[]; // 文本脚本片段数据
  aiVideoScriptSegments?: AIVideoScriptSegment[]; // AI视频脚本片段数据
  storyboardScriptSegments?: StoryboardScriptSegment[]; // 分镜脚本片段数据
  selectedStoryboardPackId?: string; // 当前选中的分镜包ID
  materials?: MaterialItem[]; // 素材数据
  pendingTimelineData?: any; // 待导入的时间轴数据
  pendingMaterials?: MaterialItem[]; // 待导入的素材数据
  // Chat conversations for AI assistant
  conversations?: Conversation[];
  activeConversationId?: string | null;
  // UI state preservation
  uiState?: {
    timelineCurrentTime?: number;
    currentTimelineState?: any; // TimelineState
    isPolishModalOpen?: boolean;
    isScriptGenerationModalOpen?: boolean;
    scriptGenerationStartTime?: number | null;
    isCreativeBrainstormingModalOpen?: boolean;
    isAIMixing?: boolean;
    aiMixingProgress?: number;
    isAIMixingModeModalOpen?: boolean;
    isBatchAnalysisModalOpen?: boolean;
    videoCutModal?: {
      isOpen: boolean;
      material: any | null; // MaterialItem
    };
    // Chat UI state
    isChatLoading?: boolean;
    agentMode?: boolean;
    hasAutoChatInitialized?: boolean;
  };
}

// Script Generation Configuration
export interface ScriptGenerationConfig {
  language: 'chinese' | 'english' | 'mixed';
  consistency: 'high' | 'moderate' | 'low';
  segmentCount: number; // 1-10
  customRequirements?: string;
}

// ========================
// AI Image Generation multi-reference types
// ========================

export interface MentionedImage {
  id: string;
  name: string;
  url: string;
  source?: {
    type: 'material' | 'storyboard' | 'character' | 'scene' | 'frame';
    packId?: string;
    frameIndex?: number;
    subView?: string | null;
  } | null;
}

export type ImageMentionMap = Record<string, string>;

// ========================
// Storyboard Generation types
// ========================

/** Supported storyboard grid sizes. Post-refactor the backend only emits
 *  ``'2x2'`` (via chained batches); legacy packs may still carry any NxM
 *  string, so the type stays widened to ``string`` in {@link StoryboardPack}.
 */
export type StoryboardGridSize = '2x2';

/** Scene-count bounds mirrored from the backend. The UI should clamp/validate
 *  against these rather than hardcoding numbers inline.
 */
export const STORYBOARD_MIN_SCENE_COUNT = 1;
export const STORYBOARD_MAX_SCENE_COUNT = 16;
export const STORYBOARD_BATCH_SIZE = 4;

/** Supported aspect ratios for storyboard frame cells */
export type StoryboardAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

/** A single frame within a storyboard pack */
export interface StoryboardFrame {
  index: number;
  filename: string;
  url: string;           // Accessible image URL
  row: number;
  col: number;
  description?: string;  // VL_LLM generated description (filled later)
  // ── AI-scripted pack fields (optional, backward compatible) ──
  shotId?: string;                   // Stable client-generated UUID
  script?: string;                   // Bound script paragraph (source of truth)
  visualPrompt?: string;             // Prompt passed to ARK for this shot
  referenceImageUrl?: string;        // https / /api/storage/files/... / data:
}

/** Per-batch accounting exposed by the new chained-2×2 backend pipeline.
 *  Legacy single-shot packs have no ``batches`` field and consumers MUST
 *  treat it as optional.
 */
export interface BatchInfo {
  index: number;
  seedreamTaskId?: string;
  frameIndices: number[];
  durationMs?: number;
  startedAt?: string;
  endedAt?: string;
}

/** A storyboard pack containing the original image and its cropped frames */
export interface StoryboardPack {
  packId: string;
  /** Owning project id. Optional for legacy pre-isolation packs that have no
   *  ownership row in the backend. New packs always carry one. */
  projectId?: string;
  prompt: string;
  gridSize: string;           // '2x2' for new packs; legacy packs may have '3x3' etc.
  aspectRatio?: StoryboardAspectRatio;
  frameCount: number;
  createdAt: string;
  originalImageUrl: string;   // Original full grid image URL
  referenceImageUrl?: string; // Reference image URL (if provided)
  frames: StoryboardFrame[];
  // ── AI-scripted pack fields (optional) ──
  scriptTitle?: string;
  scriptHistory?: { role: 'user' | 'assistant' | 'system'; content: string }[];
  // ── Chained-batch accounting (optional, backward compatible) ──
  batches?: BatchInfo[];
  partial?: boolean;
  completedBatches?: number;
  totalBatches?: number;
  discardedFrameCount?: number;
  /** Total scene count the user originally requested (1–16). On a partial
   *  run frameCount drops to what was completed, so this field stays at the
   *  requested value to support "N of M generated" UX. */
  requestedFrameCount?: number;
  error?: { code: string; message: string };
}

/** A single LLM-produced script shot bound to a frame index. */
export interface ScriptShot {
  index: number;
  script: string;
}

/** A chat message in the script-drafting dialogue. */
export interface ScriptMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Transient in-memory script draft owned by the StoryboardTab wizard. */
export interface StoryboardScriptDraft {
  frameCount: number;
  shots: ScriptShot[];
  messages: ScriptMessage[];
  locale: 'zh' | 'en';
}

/** Parameters for generating a storyboard.
 *  ``frameCount`` is the TOTAL number of scenes the user wants (1–16).
 *  The backend internally splits the request into ceil(frameCount/4) chained
 *  2×2 batches.
 */
export interface StoryboardGenerateParams {
  /** Owning project id — required by the backend (router rejects with 400
   *  PROJECT_ID_REQUIRED otherwise). */
  projectId: string;
  prompt: string;
  frameCount: number;
  aspectRatio?: StoryboardAspectRatio;
  referenceImage?: string;
  referenceImages?: string[];
  mentionedImages?: Record<string, string>;
  // ── Two-step script-bound flow (optional) ──
  frameScripts?: string[];
  scriptHistory?: ScriptMessage[];
  locale?: 'zh' | 'en';
  packId?: string;
}

/** A single candidate video generated for a storyboard segment */
export interface StoryboardVideoCandidate {
  id: string;                    // unique ID (frontend-generated UUID)
  arkTaskId: string;             // ARK task ID
  status: 'generating' | 'succeeded' | 'failed' | 'queued' | 'timeout';
  progress: number;              // 0-100
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  queuePosition?: number;
}

/** A storyboard script segment for AI video generation from storyboard frames */
export interface StoryboardScriptSegment {
  id: string;
  packId?: string;
  frameIndex: number;
  frameUrl: string;
  frameThumbnailUrl?: string;
  description: string;
  duration: number;            // seconds (4-12)
  generationStatus: 'idle' | 'generating' | 'succeeded' | 'failed' | 'queued' | 'timeout';
  generationProgress?: number;
  arkTaskId?: string;
  generatedVideoUrl?: string;
  generatedVideoThumbnailUrl?: string;
  generationError?: string;
  /** Queue position when status='queued' (1-based). */
  queuePosition?: number;
  // Multi-video candidates (only present for multi-video generation)
  videoCandidates?: StoryboardVideoCandidate[];
  // User-selected candidate video ID
  selectedCandidateId?: string;
  // Marks that description came from a script-bound pack (skip expand)
  boundFromPack?: boolean;
}

// ========================
// Frame Extraction types
// ========================

/** A single frame inside a frame pack — extends ImagePackFrame semantics with
 *  per-frame timestamp + dimensions captured from the source video. */
export interface FramePackFrame {
  index: number;
  filename: string;
  url: string;
  row?: number;
  col?: number;
  timestampSec?: number;
  width?: number;
  height?: number;
  subView?: string | null;
  description?: string | null;
}

/** A frame pack created by the Video Frame Extraction tab. Renders in the
 *  Materials Panel under the image-pack category alongside storyboard /
 *  character / scene packs. */
export interface FramePack {
  packId: string;
  packType: 'frame';
  prompt: string;
  gridSize: string;
  aspectRatio: string;
  frameCount: number;
  createdAt: string;
  originalImageUrl: string;
  sourceMaterialId?: string;
  sourceMaterialName?: string;
  sourceDurationSec?: number;
  frames: FramePackFrame[];
}

// Materials Management related types
export type MaterialType =
  | 'video'
  | 'audio'
  | 'image'
  | 'subtitle'
  | 'storyboard_pack'
  | 'character_pack'
  | 'scene_pack'
  | 'frame_pack';

// 下载状态类型
export type MaterialDownloadStatus = 'idle' | 'downloading' | 'generating' | 'completed' | 'error';

// 上传状态类型
export type MaterialUploadStatus = 'waiting' | 'uploading' | 'completed';

// 远程素材本地缓存状态（来自 /api/material/{ingest,lookup}）
// 与 downloadStatus 解耦：downloadStatus 表示前端可见的"用户行为"进度（生成/下载），
// cacheStatus 表示后端 cached_materials 表里的预下载流水线状态。
export type MaterialCacheStatus = 'idle' | 'pending' | 'downloading' | 'ready' | 'failed';

// 客户端「本地代理」整文件下载状态（纯前端内存态，不持久化到后端 DB）。
// 见 docs/plans/video-editor-client-preview-download/spec.md §3.1。
// 与 previewProxyStatus（服务端转码）、cacheStatus（服务端缓存）正交：
//   transcoding=仅视频，等待服务端 480p 代理就绪；downloading=fetch 整文件中；
//   ready=blob: object URL 就绪；error=可恢复下载失败；degraded=终态（无法本地化，
//   该片段走第 1 轮流式且不阻塞门控，v2 修复 C3）。
export type LocalProxyStatus =
  | 'idle'
  | 'transcoding'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'degraded';

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
  url: string; // 文件URL；桌面本地模式优先为同源 /api/storage/files/... 引用
  serverUrl?: string; // 兼容旧远程素材；本地素材可与 url/cacheUrl 相同
  createdAt: Date;
  tags?: string[]; // 标签
  description?: string; // 描述
  // 新增：下载状态相关字段
  downloadStatus?: MaterialDownloadStatus; // 下载状态
  downloadProgress?: number; // 下载进度 (0-100)
  downloadError?: string; // 下载错误信息
  youtubeUrl?: string; // 原始Youtube URL
  // 远程素材本地预缓存（cached_materials 表）状态。
  // 字节进度复用 downloadProgress（不重复字段），见 phase2-development-plan-revised.md Rev-2
  cacheStatus?: MaterialCacheStatus;
  cacheUrl?: string; // 同源相对路径，例如 /api/storage/files/cached_materials/pexels/<file>.mp4
  storageKey?: string; // 本地存储相对 key，不暴露 file:// 原始路径
  cacheError?: string; // 缓存失败时的简短错误信息
  // Phase 3 — backend preview-proxy + media-proxy mirror fields. Hydrated
  // from /api/material/{ingest,lookup} responses; consumed by selectPlaybackUrl
  // P1–P5 priority. See docs/plans/video-editor-playback-v2-phase3/spec.md §6.2.
  previewProxyStatus?: 'absent' | 'queued' | 'running' | 'cached' | 'failed';
  previewProxyProfile?: string;
  previewProxyLocalUrl?: string;
  previewProxyProgress?: number;
  proxyStatus?: 'absent' | 'partial' | 'cached' | 'error';
  bytes?: number;
  bitrate?: number;
  // 客户端「下载优先、本地播放」预览（第 2 轮，纯前端内存态，不入库）。
  // 见 docs/plans/video-editor-client-preview-download/spec.md §6.1。
  localProxyStatus?: LocalProxyStatus; // 本地下载状态机（§3.1）
  localProxyUrl?: string;              // URL.createObjectURL(blob) 结果（blob: 形态），播放时为 P0 源
  localProxyProgress?: number;         // 字节下载进度 (0-100)，驱动轨道「下载中 NN%」
  localProxyError?: string;            // 失败原因（轨道块「重试」用）
  localProxyBytes?: number;            // blob 字节数，供 LRU 预算统计
  // 新增：上传状态相关字段
  uploadStatus?: MaterialUploadStatus; // 上传状态
  uploadProgress?: number; // 上传进度 (0-100)
  metadata?: { // 额外元数据
    storageKind?: 'local' | 'cached_remote' | 'legacy_remote';
    storageKey?: string;
    localResolvedUrl?: string;
    originalUrl?: string; // 原始远程URL
    fileName?: string; // 文件名
    isLocalFile?: boolean; // 是否为本地文件
    downloadError?: string; // 下载错误信息
    // 缩略图来源：`undefined`（不写）＝后端落盘海报（默认，可持久、重载仍在）；
    // 'client'＝客户端 canvas 抽帧 dataURL（内存态，不持久化，见 (E) 持久化剥离）。
    thumbnailSource?: 'backend' | 'client';
    [key: string]: any; // 允许其他自定义属性
  };
  
  // 新增：句子段落信息，用于TTS生成的音频素材
  sentenceSegments?: AudioSentenceSegment; // 句子时间信息（仅TTS生成的音频使用）

  // AI自动解析结果（视频上传后自动触发）
  analysisResult?: {
    status: 'pending' | 'completed' | 'error';
    analysis?: string;       // 解析结果文本
    timestamp?: string;      // 解析完成时间
    errorMessage?: string;   // 错误信息
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

// 转场元数据——预览(02 TransitionLayer)与导出(05 ffmpeg fade/xfade)共用契约。
// 'fade' 自身淡入/淡出；'dissolve' 与相邻 clip 交叉溶解，重叠时长=duration（秒）。
export interface ClipTransition {
  type: 'fade' | 'dissolve';
  duration: number; // 转场时长（秒）
}

// 运镜（Camera Motion）——clip 级 2D / 3D 运镜配置。预览端（CanvasCompositor +
// Camera3DRenderer）与导出端（FFmpeg zoompan / perspective / rotate）共用同一份
// 数学契约，见 docs/plans/camera-motion-2d-3d/spec.md §4.2。
export type CameraMotionMode = '2d' | '3d';
export type CameraEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

// 单个运镜关键帧。2D 只用 scale/x/y/roll；3D 追加 rotateX/rotateY/dolly。
export interface CameraKeyframe {
  scale: number;    // 画面放大倍数，1 = 满画面，范围 [1,4]
  x: number;        // 取景中心归一化横坐标 [0,1]
  y: number;        // 取景中心归一化纵坐标 [0,1]
  roll: number;     // 画面内旋转角（度，顺时针为正），范围 [-45,45]
  rotateX: number;  // 俯仰（3D，度），范围 [-45,45]
  rotateY: number;  // 偏航 / 环绕（3D，度），范围 [-45,45]
  dolly: number;    // 推轨（3D），正值靠近相机，范围 [-0.6,0.6]
}

// 运镜曲线上的一个关键帧（camera-motion-keyframe-curves §7.1）：取景七分量 +
// 运镜窗口内的归一化时刻 + 出向缓动。
export interface CameraKeyframeStop extends CameraKeyframe {
  at: number;            // 运镜窗口内的归一化时刻 [0,1]；首帧恒 0、末帧恒 1（D31）
  easing?: CameraEasing; // 本帧到下一帧那一段的缓动（D34）；末帧无意义，规范化后为 undefined
}

export interface CameraMotion {
  version: 1;                 // 结构版本；sanitize 遇到未知版本直接丢弃
  mode: CameraMotionMode;
  presetId: string;           // 预设 id 或 'custom'，仅用于 UI 回显与徽标文案
  intensity: number;          // 起终点差值倍率 [0,2]，0 = 静止在起点
  easing: CameraEasing;
  startOffset?: number;       // 运镜窗口在 clip 内的起点（秒），缺省 0；分割后可为负
  duration?: number;          // 窗口时长（秒），缺省 = clip 剩余时长
  start: CameraKeyframe;
  end: CameraKeyframe;
  // 多关键帧曲线（camera-motion-keyframe-curves D30/D31），2–8 项，可选：
  //  · 缺省即今天的「两点一线」运镜，老代码读到的仍是一条起止正确的直线；
  //  · D31 不变量：keyframes[0] ≡ start、keyframes[n−1] ≡ end、at[0]=0、at[n−1]=1，
  //    由 normalizeCameraKeyframes() 在每一次写入处强制；
  //  · D38：恰为 start/end 的平凡 2 点镜像时该字段不落盘、不上线。
  keyframes?: CameraKeyframeStop[];
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
  url?: string; // Timeline snapshot playback URL fallback.
  serverUrl?: string; // Durable original/local server URL snapshot.
  cacheUrl?: string; // Same-origin local/cache URL snapshot.
  storageKey?: string; // Local storage key snapshot.
  metadata?: MaterialItem['metadata']; // Local playback provenance snapshot.
  volume?: number;   // 音量 (0-1)
  opacity?: number;  // 透明度 (0-1)
  isSelected?: boolean; // 是否选中
  
  // 新增：视频剪辑属性，用于支持时间轴上的素材缩放
  clipStart?: number;      // 原始素材中的开始时间（秒）
  clipEnd?: number;        // 原始素材中的结束时间（秒）
  originalDuration?: number; // 原始素材的总时长（秒）
  
  // 新增：原始素材类型，用于区分图片和视频素材
  originalMaterialType?: MaterialType;

  // 新增：音画分离标志——视频 item 的内嵌音轨是否已分离到独立 audio item。
  // 为 true 时合成/导出对该视频 item 静音，由派生的 audio item 单独贡献音频，
  // 避免重复出声（spec local-video-editing-refactor 01 §2.4）。
  audioDetached?: boolean;

  // 新增：转场元数据——预览(02)与导出(05)共用契约，均可选、向后兼容（缺省=无转场）。
  // type:'fade' 自身淡入/淡出；'dissolve' 与相邻 clip 交叉溶解，重叠时长=duration。
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;

  // 新增：运镜（camera-motion-2d-3d §4.6）。仅视频 item 可配置；缺省 = 无运镜，
  // 预览与导出都走与今天完全相同的代码路径（零回归）。
  cameraMotion?: CameraMotion;

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
  video_url?: string;
  source_ref?: string;
  material_id?: string;
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

// ========================
// System Settings types
// ========================

/** A single system setting with its current value, default, and metadata. */
export interface SystemSettingItem {
  key: string;
  value: any;
  default_value: any;
  value_type: string;
  description?: string;
  updated_at?: string;
  updated_by?: string;
}

/** Metadata for a settings category. */
export interface SettingsCategory {
  name: string;
  label: string;
  description: string;
}

/** A single audit log record for settings changes. */
export interface AuditLogEntry {
  id: string;
  setting_type: string;
  category?: string;
  key?: string;
  action: string;
  changed_by?: string;
  changed_at: string;
}
