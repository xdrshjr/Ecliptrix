import { VideoEditingTaskContent, ScriptSegment, MaterialItem, MaterialType, TimelineState, TimelineItem, ScriptGenerationConfig } from '@/types';

// Video playback types
export type PreviewQuality = 'low' | 'medium' | 'high' | 'original';
export type SearchOrientation = 'landscape' | 'portrait' | 'mixed';

// 新增：视频库类型
export type VideoLibraryType = 'official' | 'youtube';

// Timeline Composition types
export interface VideoSequenceItem {
  id: string;
  name: string;
  url: string;
  startTime: number;
  duration: number;
  thumbnailUrl?: string;
  materialId?: string;
  trackId: string;
  
  // 新增：视频剪辑属性，用于支持时间轴上的素材缩放和裁剪播放
  clipStart?: number;      // 原始素材中的开始时间（秒）
  clipEnd?: number;        // 原始素材中的结束时间（秒）
  originalDuration?: number; // 原始素材的总时长（秒）
  
  // 新增：音量属性，用于支持视频轨道音量控制
  volume?: number;         // 音量 (0-1)，结合轨道音量和项目音量
}

// 新增：音频序列项目接口，用于组合播放时的音频同步
export interface AudioSequenceItem {
  id: string;
  name: string;
  url: string;
  startTime: number;
  duration: number;
  materialId?: string;
  trackId: string;
  volume?: number;         // 音量 (0-1)
  
  // 音频剪辑属性，用于支持时间轴上的音频素材缩放和裁剪播放
  clipStart?: number;      // 原始音频中的开始时间（秒）
  clipEnd?: number;        // 原始音频中的结束时间（秒）
  originalDuration?: number; // 原始音频的总时长（秒）
}

export interface CompositionPlayback {
  isCompositionMode: boolean;
  videoSequences: VideoSequenceItem[];
  audioSequences: AudioSequenceItem[]; // 新增：音频序列数据
  currentSequenceIndex: number;
  totalCompositionDuration: number;
  compositionCurrentTime: number;
}

export interface UseTimelineCompositionReturn {
  compositionPlayback: CompositionPlayback;
  handleTimelineStateChange: (timelineState: TimelineState) => void;
  handleCompositionPlay: () => void;
  handleCompositionPause: () => void;
  handleCompositionSeek: (time: number) => void;
  getVideoSequencesFromTimeline: (timelineState: TimelineState) => VideoSequenceItem[];
  getAudioSequencesFromTimeline: (timelineState: TimelineState) => AudioSequenceItem[]; // 新增：音频序列提取方法
  // 新增方法
  handleNextSequence: () => boolean;
  handleCompositionTimeUpdate: (currentTime: number) => void;
  handleSequenceIndexUpdate: (sequenceIndex: number) => void;
}

// 确认对话框状态接口
export interface ConfirmationDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  type: 'danger' | 'warning' | 'info';
}

// Hook return types
export interface UseDocumentStateReturn {
  markdownValue: string;
  setMarkdownValue: (value: string) => void;
  handleMarkdownChange: (value: string) => void;
  clearContent: () => void;
  isContentModified: boolean;
  lastSaved: Date | null;
}

export interface UseVideoPlaybackReturn {
  isPlaying: boolean;
  currentTime: number;
  volume: number; // 主音量，用于播放器控件显示
  effectiveVolume: number; // 有效音量，实际应用到video元素（轨道音量 × 主音量）
  playbackRate: number;
  previewQuality: PreviewQuality;
  isFullscreen: boolean;
  showVolumeSlider: boolean;
  handlePlayPause: () => void;
  handleTimeSeek: (time: number) => void;
  handleVolumeChange: (volume: number) => void;
  handlePlaybackRateChange: (rate: number) => void;
  handleQualityChange: (quality: PreviewQuality) => void;
  handleFullscreenToggle: () => void;
  formatTime: (seconds: number) => string;
  // Add composition support
  compositionPlayback?: CompositionPlayback;
  handleCompositionPlayPause?: () => void;
  handleCompositionSeek?: (time: number) => void;
}

export interface UseAIAssistantReturn {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  isLoading: boolean;
  handleSendMessage: (message: string) => Promise<void>;
  handleSubmit: (e: React.FormEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export interface UseScriptGenerationReturn {
  isGeneratingScript: boolean;
  handleGenerateScript: () => Promise<void>;
  handleGenerateScriptWithConfig: (config: ScriptGenerationConfig) => Promise<void>;
  handleUpdateSegments: (segments: ScriptSegment[]) => void;
  generationProgress: number;
  generationError: string | null;
}

export interface UseMaterialManagementReturn {
  materials: MaterialItem[];
  selectedMaterialType: MaterialType | 'all';
  selectedMaterials: Set<string>;
  isUploading: boolean;
  uploadProgress: number;
  handleMaterialTypeFilter: (type: MaterialType | 'all') => void;
  handleMaterialSelect: (id: string, selected: boolean) => void;
  handleMaterialBatchSelect: (materialIds: string[], isSelected: boolean) => void;
  handleMaterialDelete: (materialIds: string[]) => void;
  handleMaterialUpload: () => void;
  addMaterials: (materials: MaterialItem[]) => boolean;
  addOrReplaceMaterial: (material: MaterialItem) => boolean; // 新增：添加或替换单个素材
  // 新增的删除功能
  confirmationDialog: ConfirmationDialogState;
  handleCloseConfirmationDialog: () => void;
}

// 新增：Youtube视频搜索结果接口
export interface YoutubeVideoSearchResult {
  id: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnailUrl: string;
  videoUrl: string;
  duration: number; // 以秒为单位
  publishedAt: string;
  viewCount: number;
  likeCount?: number;
  width: number;
  height: number;
}

// 新增：Youtube视频搜索响应接口
export interface YoutubeVideoSearchResponse {
  success: boolean;
  videos?: YoutubeVideoSearchResult[];
  total_found?: number;
  message?: string;
  error?: string;
  nextPageToken?: string;
}

// YouTube时间范围类型
export interface YoutubeDurationRange {
  minDuration: number; // 最小时长（秒）
  maxDuration: number; // 最大时长（秒）
}

// YouTube时间范围预设选项
export type YoutubeDurationPreset = 'under_1min' | 'under_3min' | 'under_5min' | 'under_10min' | 'custom';

export interface UseVideoSearchReturn {
  isModalOpen: boolean;
  searchQuery: string;
  searchOrientation: SearchOrientation;
  isSearching: boolean;
  searchResults: any[];
  selectedResults: Set<number | string>; // 修改为支持string类型的ID
  previewVideo: any | null;
  validationError: string | null;
  // 新增：视频库相关状态
  activeLibrary: VideoLibraryType;
  youtubeSearchResults: YoutubeVideoSearchResult[];
  youtubeSelectedResults: Set<string>;
  youtubePreviewVideo: YoutubeVideoSearchResult | null;
  isYoutubeSearching: boolean;
  // 新增：YouTube时间范围相关状态
  youtubeDurationRange: YoutubeDurationRange;
  youtubeDurationPreset: YoutubeDurationPreset;
  // 新增：分页相关状态
  currentPage: number;
  totalPages: number;
  pageSize: number;
  openSearchModal: (initialKeywords?: string[]) => void;
  closeSearchModal: () => void;
  handleSearch: () => Promise<void>;
  handleSearchResultSelect: (videoId: number | string, isSelected: boolean) => void;
  handleVideoPreview: (video: any) => void;
  handleAddSelectedVideos: () => void;
  handleClearSelection: () => void;
  setSearchQuery: (query: string) => void;
  setSearchOrientation: (orientation: SearchOrientation) => void;
  setValidationError: (error: string | null) => void;
  // 新增：视频库切换和Youtube相关方法
  setActiveLibrary: (library: VideoLibraryType) => void;
  handleYoutubeSearch: () => Promise<void>;
  handleYoutubeVideoPreview: (video: YoutubeVideoSearchResult) => void;
  handleYoutubeResultSelect: (videoId: string, isSelected: boolean) => void;
  handleAddSelectedYoutubeVideos: () => void;
  handleClearYoutubeSelection: () => void;
  // 新增：YouTube时间范围相关方法
  setYoutubeDurationRange: (range: YoutubeDurationRange) => void;
  setYoutubeDurationPreset: (preset: YoutubeDurationPreset) => void;
  // 新增：分页相关方法
  goToPage: (page: number) => void;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  taskId: string;
  // 新增：重试下载功能
  retryVideoDownload: (material: MaterialItem) => Promise<void>;
}

// Video preview types
export interface VideoPreview {
  title: string;
  duration: number;
  resolution: { width: number; height: number };
  frameRate: number;
  format: string;
  fileSize: number;
  codec: string;
  bitrate: string;
  thumbnailUrl: string;
}

// Logger types
export interface LoggerConfig {
  taskId: string;
  component: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  taskId: string;
  component: string;
  action: string;
  data?: Record<string, any>;
  error?: Error;
}

// Audio Search Types
export interface AudioSearchResult {
  id: number;
  name: string;
  description: string;
  username: string;
  duration: number;
  download_url: string;
  preview_url: string;
  waveform_url?: string;
  license: string;
  tags: string[];
  filesize?: number;
  type?: string;
  channels?: number;
  bitrate?: number;
  samplerate?: number;
  downloads?: number;
}

export interface AudioSearchResponse {
  success: boolean;
  message: string;
  audios: AudioSearchResult[];
  total_found: number;
  query: string;
}

export type AudioType = 'all' | 'music' | 'sound-effect' | 'speech' | 'ambient' | 'nature';

export type SortBy = 'score' | 'downloads' | 'rating' | 'duration_desc' | 'duration_asc' | 'created_desc' | 'created_asc';

export interface UseAudioSearchReturn {
  isModalOpen: boolean;
  searchQuery: string;
  isSearching: boolean;
  searchResults: AudioSearchResult[];
  selectedResults: Set<number>;
  previewAudio: AudioSearchResult | null;
  validationError: string | null;
  durationMin: number | null;
  durationMax: number | null;
  audioType: AudioType;
  sortBy: SortBy;
  isAddingAudios: boolean;
  openSearchModal: () => void;
  closeSearchModal: () => void;
  handleSearch: () => void;
  handleSearchResultSelect: (resultIndex: number) => void;
  handleAudioPreview: (audio: AudioSearchResult) => void;
  handleAddSelectedAudios: () => void;
  handleClearSelection: () => void;
  setSearchQuery: (query: string) => void;
  setDurationMin: (duration: number | null) => void;
  setDurationMax: (duration: number | null) => void;
  setAudioType: (audioType: AudioType) => void;
  setSortBy: (sortBy: SortBy) => void;
  setValidationError: (error: string | null) => void;
  taskId: string;
} 

// AI Image Generation Types
export interface AIImageGenerationRequest {
  positive_prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  cfg?: number;
  guidance?: number;
  checkpoint?: string;
}

export interface AIImageGenerationResponse {
  prompt_id: string;
  status: string;
  message: string;
  estimated_time?: number;
}

export interface ImageInfo {
  filename: string;
  subfolder?: string;
  type?: string;
  url?: string;
  size_bytes?: number;
}

export interface AIImageGenerationStatus {
  prompt_id: string;
  status: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  images: ImageInfo[];
  error_message?: string;
  created_at?: string;
  completed_at?: string;
}

export interface UseAIImageGenerationReturn {
  // Modal state
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  
  // Generation state
  isGenerating: boolean;
  generationProgress: number;
  generatedImages: string[];
  generationError: string | null;
  generationStatus: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
  currentPromptId: string | null;
  
  // Generation parameters
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number | null;
  cfg: number;
  guidance: number;
  checkpoint: string;
  
  // Actions
  handleGenerate: () => Promise<void>;
  handleAddToMaterials: (imageUrls: string[]) => Promise<boolean>;
  handleAddSingleToMaterials: (imageUrl: string) => Promise<boolean>;
  setPositivePrompt: (prompt: string) => void;
  setNegativePrompt: (prompt: string) => void;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
  setSteps: (steps: number) => void;
  setSeed: (seed: number | null) => void;
  setCfg: (cfg: number) => void;
  setGuidance: (guidance: number) => void;
  setCheckpoint: (checkpoint: string) => void;
  clearError: () => void;
  
  taskId: string;
}

// Digital Human Generation Types
export interface DigitalHumanGenerationRequest {
  positive_prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  cfg?: number;
  shift?: number;
  reference_video_filename: string;
  audio_filename: string;
}

export interface DigitalHumanGenerationResponse {
  prompt_id: string;
  status: string;
  message: string;
  estimated_time?: number;
}

export interface VideoInfo {
  filename: string;
  subfolder: string;
  type: string;
  url?: string;
  size_bytes?: number;
  duration?: number;
}

export interface DigitalHumanGenerationStatus {
  prompt_id: string;
  status: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  videos: VideoInfo[];
  error_message?: string;
  created_at?: string;
  completed_at?: string;
}

export interface UseDigitalHumanGenerationReturn {
  // Modal state
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  
  // Generation state
  isGenerating: boolean;
  generationProgress: number;
  generatedVideos: VideoInfo[];
  generationError: string | null;
  generationStatus: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
  currentPromptId: string | null;
  
  // Upload state
  isUploadingVideo: boolean;
  isUploadingAudio: boolean;
  videoUploadProgress: number;
  audioUploadProgress: number;
  uploadError: string | null;
  uploadedVideoFilename: string | null;
  uploadedAudioFilename: string | null;
  
  // Generation parameters
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number | null;
  cfg: number;
  shift: number;
  referenceVideoFile: File | null;
  audioFile: File | null;
  
  // Actions
  handleGenerate: () => Promise<void>;
  handleAddToMaterials: () => boolean;
  handleAddSingleToMaterials: (videoInfo: VideoInfo) => boolean;
  setPositivePrompt: (prompt: string) => void;
  setNegativePrompt: (prompt: string) => void;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
  setSteps: (steps: number) => void;
  setSeed: (seed: number | null) => void;
  setCfg: (cfg: number) => void;
  setShift: (shift: number) => void;
  setReferenceVideoFile: (file: File | null) => void;
  setAudioFile: (file: File | null) => void;
  clearError: () => void;
  clearUploadError: () => void;
  
  taskId: string;
}

// AI Video Generation Types
export interface AIVideoGenerationRequest {
  positive_prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  steps?: number;
  seed?: number;
  enable_lora?: boolean;
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
}

export interface AIVideoGenerationResponse {
  prompt_id: string;
  status: string;
  message: string;
  estimated_time?: number;
}

export interface AIVideoGenerationStatus {
  prompt_id: string;
  status: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  videos: VideoInfo[];
  error_message?: string;
  created_at?: string;
  completed_at?: string;
  request_parameters?: AIVideoGenerationRequest;
}

export interface UseAIVideoGenerationReturn {
  // Modal state
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  
  // Generation state
  isGenerating: boolean;
  generationProgress: number;
  generatedVideos: VideoInfo[];
  generationError: string | null;
  generationStatus: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
  currentPromptId: string | null;
  
  // Generation parameters
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  durationSeconds: number;
  steps: number;
  seed: number | null;
  enableLora: boolean;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | null;
  
  // Actions
  handleGenerate: () => Promise<void>;
  handleAddToMaterials: () => boolean;
  handleAddSingleToMaterials: (videoInfo: VideoInfo) => boolean;
  setPositivePrompt: (prompt: string) => void;
  setNegativePrompt: (prompt: string) => void;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
  setDurationSeconds: (duration: number) => void;
  setSteps: (steps: number) => void;
  setSeed: (seed: number | null) => void;
  setEnableLora: (enable: boolean) => void;
  setAspectRatio: (ratio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | null) => void;
  clearError: () => void;
  
  taskId: string;
}

// AI Materials Types
export type AIMaterialCategory = 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video' | 'digital-human';

export interface AIMaterialCard {
  id: string;
  name: string;
  description: string;
  category: AIMaterialCategory;
  thumbnailUrl: string;
  parameters: AIMaterialParameter[];
  isDefault?: boolean;
}

export interface AIMaterialParameter {
  id: string;
  name: string;
  type: 'text' | 'number' | 'select' | 'slider' | 'file';
  label: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: any;
  options?: { value: any; label: string }[];
  min?: number;
  max?: number;
  step?: number;
}

export interface UseAIMaterialsReturn {
  // Modal state
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  
  // Category and card selection
  selectedCategory: AIMaterialCategory;
  selectedCard: AIMaterialCard | null;
  setSelectedCategory: (category: AIMaterialCategory) => void;
  setSelectedCard: (card: AIMaterialCard | null) => void;
  
  // Parameter filling
  isParameterMode: boolean;
  parameters: Record<string, any>;
  setParameter: (parameterId: string, value: any) => void;
  clearParameters: () => void;
  
  // Actions
  handleCardSelect: (card: AIMaterialCard) => void;
  handleBackToCards: () => void;
  handleGenerate: () => Promise<void>;
  
  // Data
  getCardsForCategory: (category: AIMaterialCategory) => AIMaterialCard[];
  categories: { id: AIMaterialCategory; name: string; icon: string }[];
  
  taskId: string;
} 