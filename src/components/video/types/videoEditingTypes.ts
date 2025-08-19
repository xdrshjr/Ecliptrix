import { VideoEditingTaskContent, ScriptSegment, MaterialItem, MaterialType, TimelineState, TimelineItem, ScriptGenerationConfig } from '@/types';

// Video playback types
export type PreviewQuality = 'low' | 'medium' | 'high' | 'original';
export type SearchOrientation = 'landscape' | 'portrait' | 'mixed';

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
}

export interface CompositionPlayback {
  isCompositionMode: boolean;
  videoSequences: VideoSequenceItem[];
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
  volume: number;
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
  // 新增的删除功能
  handleDeleteAllMaterials: () => void;
  confirmationDialog: ConfirmationDialogState;
  handleCloseConfirmationDialog: () => void;
}

export interface UseVideoSearchReturn {
  isModalOpen: boolean;
  searchQuery: string;
  searchOrientation: SearchOrientation;
  isSearching: boolean;
  searchResults: any[];
  selectedResults: Set<number>;
  previewVideo: any | null;
  validationError: string | null;
  openSearchModal: (initialKeywords?: string[]) => void;
  closeSearchModal: () => void;
  handleSearch: () => Promise<void>;
  handleSearchResultSelect: (videoId: number, isSelected: boolean) => void;
  handleVideoPreview: (video: any) => void;
  handleAddSelectedVideos: () => void;
  handleClearSelection: () => void;
  setSearchQuery: (query: string) => void;
  setSearchOrientation: (orientation: SearchOrientation) => void;
  setValidationError: (error: string | null) => void;
  taskId: string;
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
}

export interface AudioSearchResponse {
  success: boolean;
  message: string;
  audios: AudioSearchResult[];
  total_found: number;
  query: string;
}

export type AudioType = 'all' | 'music' | 'sound-effect' | 'speech' | 'ambient' | 'nature';

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
  setValidationError: (error: string | null) => void;
  taskId: string;
} 