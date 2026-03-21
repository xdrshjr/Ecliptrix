/**
 * Video Editing Services
 * 视频编辑服务层的统一导出文件
 */

// AI Service
export type {
  AIService,
} from './aiService';

export {
  createAIService
} from './aiService';

// Script Service
export type {
  ScriptService,
} from './scriptService';

export {
  createScriptService
} from './scriptService';

// Video Search Service
export type {
  VideoSearchService,
  VideoSearchResult,
} from './videoSearchService';

export {
  createVideoSearchService
} from './videoSearchService';

// Youtube Video Search Service
export type {
  YoutubeVideoSearchService
} from './youtubeVideoSearchService';

export {
  createYoutubeVideoSearchService
} from './youtubeVideoSearchService';
