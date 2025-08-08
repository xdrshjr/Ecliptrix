import { useState, useCallback, useMemo } from 'react';
import { ScriptSegment, VideoEditingTaskContent } from '@/types';
import { UseScriptGenerationReturn } from '../types';
import { VideoEditingLogger } from '../utils';
import { createScriptService, ScriptService } from '../services';

/**
 * useScriptGeneration Hook
 * 管理脚本生成功能
 * 
 * @param taskId - 任务ID，用于日志记录
 * @param markdownContent - Markdown内容
 * @param onUpdateContent - 内容更新回调
 * @returns 脚本生成相关的状态和方法
 */
export const useScriptGeneration = (
  taskId: string,
  markdownContent: string,
  onUpdateContent: (content: VideoEditingTaskContent) => void
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

  // 处理脚本生成
  const handleGenerateScript = useCallback(async () => {
    if (!markdownContent.trim() || isGeneratingScript) {
      logger.warn('脚本生成被跳过', {
        reason: !markdownContent.trim() ? 'empty_markdown' : 'already_generating',
        markdownLength: markdownContent.length,
        isGenerating: isGeneratingScript
      });
      return;
    }

    const startTime = performance.now();
    setIsGeneratingScript(true);
    setGenerationProgress(0);
    setGenerationError(null);

    try {
      // 模拟进度更新
      const progressInterval = setInterval(() => {
        setGenerationProgress(prev => {
          const newProgress = prev + Math.random() * 15;
          return newProgress >= 90 ? 90 : newProgress;
        });
      }, 500);

      // 使用脚本服务生成脚本
      const result = await scriptService.generateScript({
        markdownContent: markdownContent,
        taskId: taskId
      });

      clearInterval(progressInterval);
      setGenerationProgress(100);

      if (result.success && result.segments) {
        // 更新content，添加生成的脚本片段
        const updatedContent: VideoEditingTaskContent = {
          markdownContent: markdownContent,
          lastModified: new Date(),
          scriptSegments: result.segments,
        };

        onUpdateContent(updatedContent);
        
        logger.info('脚本内容已更新到任务中', {
          segmentCount: result.segments.length,
          totalSentences: result.segments.reduce((sum: number, segment: ScriptSegment) => sum + segment.sentences.length, 0),
          totalDuration: result.segments.reduce((sum: number, segment: ScriptSegment) => sum + (segment.duration || 0), 0),
          averageSegmentLength: result.segments.reduce((sum: number, segment: ScriptSegment) => sum + segment.sentences.length, 0) / result.segments.length,
          metadata: result.metadata
        });
      } else {
        throw new Error(result.error || 'Script generation failed');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('脚本生成失败', error as Error, {
        markdownLength: markdownContent.length,
        totalTime: performance.now() - startTime
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

      logger.info('脚本生成流程结束', {
        success: !generationError,
        totalTime: performance.now() - startTime
      });
    }
  }, [markdownContent, taskId, isGeneratingScript, onUpdateContent, logger, scriptService]);

  // 处理脚本片段更新
  const handleUpdateSegments = useCallback((updatedSegments: ScriptSegment[]) => {
    logger.userAction('更新脚本片段', 'segmentEditor', {
      segmentCount: updatedSegments.length,
      totalSentences: updatedSegments.reduce((sum, segment) => sum + segment.sentences.length, 0),
      totalDuration: updatedSegments.reduce((sum, segment) => sum + (segment.duration || 0), 0),
      changeType: 'manual_update'
    });

    const updatedContent: VideoEditingTaskContent = {
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
  }, [markdownContent, taskId, onUpdateContent, logger]);

  return {
    isGeneratingScript,
    handleGenerateScript,
    handleUpdateSegments,
    generationProgress,
    generationError
  };
}; 