/**
 * Video Editing Services
 * 视频编辑服务层的统一导出文件
 */

// AI Service
export type {
  AIService,
  AIServiceParams,
  AIServiceResponse
} from './aiService';

export {
  AIServiceImpl,
  createAIService
} from './aiService';

// Script Service
export type {
  ScriptService,
  ScriptGenerationResult,
  ValidationResult
} from './scriptService';

export {
  ScriptServiceImpl,
  createScriptService
} from './scriptService';

// Video Search Service
export type {
  VideoSearchService,
  VideoSearchResult,
  VideoSearchResponse
} from './videoSearchService';

export {
  VideoSearchServiceImpl,
  createVideoSearchService
} from './videoSearchService';

// Youtube Video Search Service
export type {
  YoutubeVideoSearchService
} from './youtubeVideoSearchService';

export {
  YoutubeVideoSearchServiceImpl,
  createYoutubeVideoSearchService
} from './youtubeVideoSearchService';

// AI Image Generation Service
export type {
  AIImageGenerationService
} from './aiImageGenerationService';

export {
  AIImageGenerationServiceImpl,
  createAIImageGenerationService
} from './aiImageGenerationService';

// AI Video Generation Service
export type {
  AIVideoGenerationService
} from './aiVideoGenerationService';

export {
  AIVideoGenerationServiceImpl,
  createAIVideoGenerationService
} from './aiVideoGenerationService';

// ComfyUI Health Service
export type {
  ComfyUIHealthService,
  ComfyUIHealthStatus
} from './comfyuiHealthService';

export {
  ComfyUIHealthServiceImpl,
  createComfyUIHealthService
} from './comfyuiHealthService';

// Prompt Optimization Service
export {
  PromptOptimizationService
} from './promptOptimizationService'; 