import { useState, useCallback, useMemo } from 'react';
import { ScriptSegment, VideoEditingTaskContent, ScriptGenerationConfig, ChatMessage } from '@/types';
import { UseScriptGenerationReturn } from '../types';
import { VideoEditingLogger } from '../utils';
import { createScriptService, ScriptService } from '../services';
import { http, ApiError } from '@/lib/api/http-client';

// 为脚本段落生成关键词的函数
// 导出为共享工具：「解说直接生成」新链路复用同一已验证逻辑补跑关键词（评审决议 B1）。
// 取材为 segment.sentences[].text 拼接。
// 注意（反转前序诊断 R-4）：取材现可为「AI 视频脚本」——「解说直接生成」链路在覆写
// sentence.text 为画面脚本【之后】调用本函数，故 segmentContent 即画面脚本拼接，关键词
// 由画面描述生成而非解说原文；语言亦可选（options.language，缺省中文 / 'english' 输出英文，
// 经 /api/script-keywords-generation 的 language 参数透传）。旧脚本生成链路不传 options，
// 行为零变化。
export const generateKeywordsForSegments = async (
  segments: ScriptSegment[],
  taskId: string,
  logger: VideoEditingLogger,
  options?: { language?: 'chinese' | 'english' },
): Promise<ScriptSegment[]> => {
  logger.info('开始为脚本段落生成关键词', {
    segmentCount: segments.length,
    taskId
  });

  // 创建关键词生成的Promise数组，支持并发处理
  const keywordPromises = segments.map(async (segment, index) => {
    try {
      // 构建段落内容文本
      const segmentContent = segment.sentences.map(s => s.text).join(' ');
      
      logger.info(`开始为段落 ${index + 1} 生成关键词`, {
        segmentId: segment.id,
        segmentTitle: segment.title,
        contentLength: segmentContent.length
      });

      let result: any;
      try {
        result = await http.post<any>('/api/script-keywords-generation', {
          segmentTitle: segment.title,
          segmentContent: segmentContent,
          taskId: taskId,
          ...(options?.language ? { language: options.language } : {}),
        });
      } catch (httpError) {
        logger.warn(`段落 ${index + 1} 关键词生成失败`, {
          segmentId: segment.id,
          status: httpError instanceof ApiError ? httpError.status : undefined,
          error: httpError instanceof Error ? httpError.message : String(httpError)
        });
        return segment; // 返回原始段落，不包含关键词
      }

      if (result.success && result.keywords && Array.isArray(result.keywords)) {
        logger.info(`段落 ${index + 1} 关键词生成成功`, {
          segmentId: segment.id,
          keywords: result.keywords,
          keywordCount: result.keywords.length
        });

        return {
          ...segment,
          keywords: result.keywords
        };
      } else {
        logger.warn(`段落 ${index + 1} 关键词生成响应无效`, {
          segmentId: segment.id,
          result
        });
        return segment;
      }
    } catch (error) {
      logger.error(`段落 ${index + 1} 关键词生成异常`, error as Error, {
        segmentId: segment.id,
        segmentTitle: segment.title
      });
      return segment; // 返回原始段落，不包含关键词
    }
  });

  // 等待所有关键词生成完成
  const segmentsWithKeywords = await Promise.all(keywordPromises);

  const successCount = segmentsWithKeywords.filter(s => s.keywords && s.keywords.length > 0).length;

  logger.info('脚本段落关键词生成完成', {
    totalSegments: segments.length,
    successfulSegments: successCount,
    failedSegments: segments.length - successCount,
    taskId
  });

  return segmentsWithKeywords;
};

// 纯本地分词兜底（无网络）：从旁白原文派生检索词，保证搜索框永不为空。
// 含拉丁字母的词（英文旁白 / 已含英文术语）按空白与标点切分取前 3 个；
// 中文等无词边界文本则回退为「首句裁剪片段」，仍返回非空数组（评审 R4）。
const deriveOfflineKeywords = (narration: string): string[] => {
  const text = narration.trim();
  if (!text) return [];
  const latinWords = text
    .split(/[\s,，、;；:：.。!！?？"'“”‘’()（）\[\]{}\-—/\\|]+/)
    .map(word => word.trim())
    .filter(word => word.length > 1 && /[a-zA-Z]/.test(word));
  if (latinWords.length > 0) return latinWords.slice(0, 3);
  const firstSentence = text
    .split(/[。！？!?\n\r]+/)
    .map(sentence => sentence.trim())
    .find(sentence => sentence.length > 0) ?? text;
  return [firstSentence.slice(0, 30)];
};

// 关键词路径的本地兜底（评审 R4：真错可见 + 旁白本地兜底，搜索框永不为空）。
// 当主关键词路由 /api/script-keywords-generation 失败 / 返回空（桌面端 LLM 401 / 空内容是
// 常见诱因）时，从旁白原文派生可用检索词：
//   1) 复用 FAST_LLM 的 /api/translate-search-query（与在线视频搜索同一路由）把中文旁白
//      译成英文检索短语；
//   2) FAST_LLM 也不可用时，退化为纯本地分词（无网络），保证返回非空。
// 仅当旁白本身为空时返回 []（此时调用方才弹原报错——真错可见）。
export const deriveLocalKeywordsFromNarration = async (
  narration: string,
  taskId: string,
  logger: VideoEditingLogger,
): Promise<string[]> => {
  const text = (narration ?? '').trim();
  if (!text) return [];

  // 1) FAST_LLM 中→英翻译：整句译文作为检索短语（openSearchModal 会按空格拼成查询串）。
  try {
    const res = await http.post<{ success?: boolean; translatedQuery?: string }>(
      '/api/translate-search-query',
      { query: text, taskId },
    );
    const translated = res?.translatedQuery?.trim();
    if (res?.success && translated) {
      logger.info('关键词本地兜底：FAST_LLM 旁白翻译成功', { taskId, translated });
      return [translated];
    }
  } catch (error) {
    logger.warn('关键词本地兜底：FAST_LLM 旁白翻译失败，退化为本地分词', {
      taskId,
      status: error instanceof ApiError ? error.status : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 2) 纯本地分词兜底（无网络）。
  const offline = deriveOfflineKeywords(text);
  logger.info('关键词本地兜底：使用旁白本地分词', { taskId, keywords: offline });
  return offline;
};

/**
 * useScriptGeneration Hook
 * 管理脚本生成功能
 *
 * @param taskId - 任务ID，用于日志记录
 * @param markdownContent - Markdown内容
 * @param onUpdateContent - 内容更新回调
 * @param currentContent - 当前完整的内容对象，用于保留原有数据
 * @param enrichKeywords - 可选：片段落面板后触发的后台英文关键词富化（由父级注入，走 ref-safe 写回，
 *   诊断 narration-keywords-lazy-on-video-search-click 方案 A）。缺省时行为与旧版一致。
 * @returns 脚本生成相关的状态和方法
 */
export const useScriptGeneration = (
  taskId: string,
  markdownContent: string,
  onUpdateContent: (content: VideoEditingTaskContent) => void,
  currentContent: VideoEditingTaskContent | null,
  enrichKeywords?: (segments: ScriptSegment[]) => void
): UseScriptGenerationReturn => {
  // 初始化日志器和脚本服务
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useScriptGeneration'
  }), [taskId]);

  const scriptService = useMemo(() => createScriptService(taskId), [taskId]);

  // 脚本生成状态
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // 处理脚本生成（带配置）
  const handleGenerateScriptWithConfig = useCallback(async (config: ScriptGenerationConfig, chatMessages?: ChatMessage[], customPrompt?: string) => {
    // 优先使用聊天消息，如果没有聊天消息则使用markdown内容
    const hasChatMessages = chatMessages && chatMessages.length > 0;
    const hasMarkdownContent = markdownContent.trim().length > 0;
    const hasCustomPrompt = typeof customPrompt === 'string' && customPrompt.trim().length > 0;

    if (!hasChatMessages && !hasMarkdownContent && !hasCustomPrompt) {
      logger.warn('脚本生成被跳过', {
        reason: 'no_content_available',
        hasChatMessages,
        hasMarkdownContent,
        hasCustomPrompt,
        markdownLength: markdownContent.length,
        config
      });
      alert('无法生成脚本：请先在聊天面板中输入内容，在文档中添加内容，或填写自定义提示词');
      return;
    }
    
    if (isGeneratingScript) {
      logger.warn('脚本生成被跳过', {
        reason: 'already_generating',
        isGenerating: isGeneratingScript,
        config
      });
      return;
    }

    const startTime = performance.now();
    setIsGeneratingScript(true);
    setGenerationProgress(0);
    setGenerationError(null);

    try {
      logger.info('开始生成脚本（带配置）', {
        config,
        markdownLength: markdownContent.length,
        chatMessageCount: chatMessages?.length || 0,
        hasCustomPrompt,
        customPromptLength: customPrompt?.length || 0,
        usesChatMessages: hasChatMessages,
        usesMarkdownContent: !hasChatMessages && hasMarkdownContent,
        timestamp: new Date().toISOString()
      });

      // 模拟进度更新
      const progressInterval = setInterval(() => {
        setGenerationProgress(prev => {
          const newProgress = prev + Math.random() * 15;
          return newProgress >= 90 ? 90 : newProgress;
        });
      }, 500);

      // 使用脚本服务生成脚本（带配置、聊天消息和自定义提示词）
      const result = await scriptService.generateScriptWithConfig({
        markdownContent: markdownContent,
        taskId: taskId,
        config: config,
        chatMessages: chatMessages,
        customPrompt: customPrompt,
      });

      clearInterval(progressInterval);
      setGenerationProgress(100);

      if (result.success && result.segments) {
        logger.info('脚本生成成功，片段先落面板，随后后台异步生成英文关键词', {
          segmentCount: result.segments.length
        });

        // 片段先落面板（不再阻塞等待关键词），保留原有数据
        const updatedContent: VideoEditingTaskContent = {
          ...currentContent, // 保留所有原有数据（包括conversations等）
          markdownContent: markdownContent,
          lastModified: new Date(),
          scriptSegments: result.segments,
        };

        onUpdateContent(updatedContent);

        // 后台异步富化英文关键词并 ref-safe 回填（取代旧的「阻塞式 + 缺省中文」生成，
        // 诊断 narration-keywords-lazy-on-video-search-click 证据 B）。
        enrichKeywords?.(result.segments);

        logger.info('脚本内容已更新到任务中（带配置；关键词后台生成）', {
          segmentCount: result.segments.length,
          totalSentences: result.segments.reduce((sum: number, segment: ScriptSegment) => sum + segment.sentences.length, 0),
          totalDuration: result.segments.reduce((sum: number, segment: ScriptSegment) => sum + (segment.duration || 0), 0),
          metadata: result.metadata,
          appliedConfig: config
        });
      } else {
        throw new Error(result.error || 'Script generation failed');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('脚本生成失败（带配置）', error as Error, {
        markdownLength: markdownContent.length,
        totalTime: performance.now() - startTime,
        config
      });

      setGenerationError(errorMessage);
      setGenerationProgress(0);

      // 显示用户友好的错误消息
      alert(`脚本生成失败: ${errorMessage}`);
    } finally {
      setIsGeneratingScript(false);
      setTimeout(() => {
        setGenerationProgress(0);
      }, 2000);

      logger.info('脚本生成流程结束（带配置）', {
        success: !generationError,
        totalTime: performance.now() - startTime,
        config
      });
    }
  }, [markdownContent, taskId, isGeneratingScript, onUpdateContent, logger, scriptService, currentContent, enrichKeywords]);

  // 处理脚本生成（无配置，保持向后兼容）
  const handleGenerateScript = useCallback(async (chatMessages?: ChatMessage[]) => {
    // 使用默认配置
    const defaultConfig: ScriptGenerationConfig = {
      language: 'chinese',
      consistency: 'moderate',
      segmentCount: 5,
      customRequirements: ''
    };
    
    await handleGenerateScriptWithConfig(defaultConfig, chatMessages);
  }, [handleGenerateScriptWithConfig]);

  // 处理脚本片段更新
  const handleUpdateSegments = useCallback((updatedSegments: ScriptSegment[]) => {
    logger.userAction('更新脚本片段', 'segmentEditor', {
      segmentCount: updatedSegments.length,
      totalSentences: updatedSegments.reduce((sum, segment) => sum + segment.sentences.length, 0),
      totalDuration: updatedSegments.reduce((sum, segment) => sum + (segment.duration || 0), 0),
      changeType: 'manual_update'
    });

    // 更新脚本片段，同时保留原有数据（包括conversations等）
    const updatedContent: VideoEditingTaskContent = {
      ...currentContent, // 保留所有原有数据
      markdownContent: markdownContent,
      lastModified: new Date(),
      scriptSegments: updatedSegments,
    };

    onUpdateContent(updatedContent);

    logger.info('脚本片段手动更新完成', {
      segmentCount: updatedSegments.length,
      totalSentences: updatedSegments.reduce((sum, segment) => sum + segment.sentences.length, 0),
      lastModified: updatedContent.lastModified.toISOString()
    });
  }, [markdownContent, onUpdateContent, logger, currentContent]);

  // 处理从视频理解脚本生成的脚本（来自 useConvertToScript）
  const handleScriptGenerated = useCallback((generatedSegments: ScriptSegment[]) => {
    logger.userAction('接收视频理解生成的脚本', 'convertToScript', {
      segmentCount: generatedSegments.length,
      totalSentences: generatedSegments.reduce((sum, segment) => sum + segment.sentences.length, 0),
      totalDuration: generatedSegments.reduce((sum, segment) => sum + (segment.duration || 0), 0),
      hasVideos: generatedSegments.some(segment => segment.videos && segment.videos.length > 0)
    });

    // 更新脚本片段，同时保留原有数据（包括conversations等）
    const updatedContent: VideoEditingTaskContent = {
      ...currentContent, // 保留所有原有数据
      markdownContent: markdownContent,
      lastModified: new Date(),
      scriptSegments: generatedSegments,
    };

    onUpdateContent(updatedContent);

    // 后台异步富化英文关键词并 ref-safe 回填（LIVE 主 bug 面：此前该链路完全不生成关键词，
    // 片段以空 keywords 到达段落卡片，用户点「搜索在线视频」时才现场懒生成 —— 诊断
    // narration-keywords-lazy-on-video-search-click 证据 C）。
    enrichKeywords?.(generatedSegments);

    logger.info('视频理解生成的脚本已更新到任务中', {
      segmentCount: generatedSegments.length,
      totalSentences: generatedSegments.reduce((sum, segment) => sum + segment.sentences.length, 0),
      totalDuration: generatedSegments.reduce((sum, segment) => sum + (segment.duration || 0), 0),
      segmentsWithVideos: generatedSegments.filter(segment => segment.videos && segment.videos.length > 0).length,
      lastModified: updatedContent.lastModified.toISOString()
    });
  }, [markdownContent, onUpdateContent, logger, currentContent, enrichKeywords]);

  return {
    isGeneratingScript,
    handleGenerateScript,
    handleGenerateScriptWithConfig,
    handleUpdateSegments,
    handleScriptGenerated,
    generationProgress,
    generationError
  };
}; 