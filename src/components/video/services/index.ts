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