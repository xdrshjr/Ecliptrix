import { VideoEditingTaskContent, ScriptSegment, MaterialItem, MaterialType } from '@/types';

// Video playback types
export type PreviewQuality = 'low' | 'medium' | 'high' | 'original';
export type SearchOrientation = 'landscape' | 'portrait' | 'mixed';

// Hook return types
export interface UseDocumentStateReturn {
  markdownValue: string;
  setMarkdownValue: (value: string) => void;
  handleMarkdownChange: (value: string) => void;
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
  handleSelectAll: () => void;
  handleMaterialPlay: (material: MaterialItem) => void;
  handleMaterialDownload: (material: MaterialItem) => void;
  handleMaterialDelete: (materialIds: string[]) => void;
  handleMaterialUpload: () => void;
  addMaterials: (materials: MaterialItem[]) => number;
}

export interface UseVideoSearchReturn {
  isModalOpen: boolean;
  searchQuery: string;
  searchOrientation: SearchOrientation;
  isSearching: boolean;
  searchResults: any[];
  selectedResults: Set<number>;
  previewVideo: any | null;
  openSearchModal: () => void;
  closeSearchModal: () => void;
  handleSearch: () => Promise<void>;
  handleSearchResultSelect: (videoId: number, isSelected: boolean) => void;
  handleVideoPreview: (video: any) => void;
  handleAddSelectedVideos: () => void;
  setSearchQuery: (query: string) => void;
  setSearchOrientation: (orientation: SearchOrientation) => void;
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