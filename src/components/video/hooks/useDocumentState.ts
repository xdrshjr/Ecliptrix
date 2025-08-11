import { useState, useCallback, useEffect, useMemo } from 'react';
import { VideoEditingTaskContent } from '@/types';
import { UseDocumentStateReturn } from '../types';
import { VideoEditingLogger } from '../utils';

/**
 * useDocumentState Hook
 * 管理 Markdown 文档状态和操作
 * 
 * @param content - 外部传入的任务内容
 * @param onUpdateContent - 更新内容的回调函数
 * @param taskId - 任务ID，用于日志记录
 * @returns 文档状态管理相关的状态和方法
 */
export const useDocumentState = (
  content: VideoEditingTaskContent | null,
  onUpdateContent: (content: VideoEditingTaskContent) => void,
  taskId: string
): UseDocumentStateReturn => {
  const defaultContent = '# Video Editing Project\n\nStart editing your video project documentation here...\n\n## Notes\n- Add your project notes\n- Document your editing workflow\n- Track your progress\n\n## Resources\n- List your video assets\n- Note important timestamps\n- Reference materials';
  
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useDocumentState'
  }), [taskId]);

  // 文档内容状态
  const [markdownValue, setMarkdownValue] = useState<string>(
    content?.markdownContent || defaultContent
  );

  // 上次保存时间
  const [lastSaved, setLastSaved] = useState<Date | null>(
    content?.lastModified || null
  );

  // 内容是否被修改
  const [isContentModified, setIsContentModified] = useState<boolean>(false);

  // 记录初始化日志
  useEffect(() => {
    logger.info('Hook初始化', {
      hasContent: !!content,
      markdownLength: markdownValue.length,
      isDefaultContent: markdownValue === defaultContent,
      lastSaved: lastSaved?.toISOString()
    });
  }, []);

  // 处理markdown内容变化
  const handleMarkdownChange = useCallback((value: string = '') => {
    const previousLength = markdownValue.length;
    const newLength = value.length;

    logger.stateChange('Markdown内容变化', 
      { length: previousLength }, 
      { length: newLength },
      {
        contentDelta: newLength - previousLength,
        isSignificantChange: Math.abs(newLength - previousLength) > 10
      }
    );

    setMarkdownValue(value);
    setIsContentModified(true);
    
    // 更新任务内容
    const updatedContent: VideoEditingTaskContent = {
      markdownContent: value,
      lastModified: new Date(),
      scriptSegments: content?.scriptSegments
    };
    
    onUpdateContent(updatedContent);
    setLastSaved(updatedContent.lastModified);
    
    // 短暂延迟后重置修改状态
    setTimeout(() => {
      setIsContentModified(false);
    }, 1000);

    logger.info('任务内容已更新', {
      contentLength: value.length,
      lastModified: updatedContent.lastModified.toISOString(),
      hasScriptSegments: !!updatedContent.scriptSegments?.length
    });
  }, [markdownValue.length, onUpdateContent, content?.scriptSegments, logger]);

  // 清空markdown内容
  const clearContent = useCallback(() => {
    const previousLength = markdownValue.length;
    
    logger.userAction('清空Markdown内容', 'clearButton', {
      previousContentLength: previousLength,
      timestamp: new Date().toISOString(),
      contentPreview: markdownValue.substring(0, 100) + (markdownValue.length > 100 ? '...' : '')
    });

    // 清空为空字符串
    const clearedContent = '';
    
    setMarkdownValue(clearedContent);
    setIsContentModified(true);
    
    // 更新任务内容
    const updatedContent: VideoEditingTaskContent = {
      markdownContent: clearedContent,
      lastModified: new Date(),
      scriptSegments: content?.scriptSegments
    };
    
    onUpdateContent(updatedContent);
    setLastSaved(updatedContent.lastModified);
    
    // 短暂延迟后重置修改状态
    setTimeout(() => {
      setIsContentModified(false);
    }, 1000);

    logger.info('Markdown内容已清空', {
      previousLength,
      newLength: 0,
      contentCleared: true,
      lastModified: updatedContent.lastModified.toISOString()
    });
  }, [markdownValue, onUpdateContent, content?.scriptSegments, logger]);

  // 当外部content变化时同步本地状态
  useEffect(() => {
    if (content?.markdownContent !== undefined && content.markdownContent !== markdownValue) {
      logger.info('同步外部内容变化', {
        externalContentLength: content.markdownContent.length,
        localContentLength: markdownValue.length,
        contentDifference: content.markdownContent.length - markdownValue.length
      });
      
      setMarkdownValue(content.markdownContent);
      setLastSaved(content.lastModified || null);
      setIsContentModified(false);
    }
  }, [content, markdownValue, logger]);

  // 自动保存功能（可选）
  useEffect(() => {
    if (isContentModified) {
      const autoSaveTimer = setTimeout(() => {
        logger.info('自动保存触发', {
          contentLength: markdownValue.length,
          lastModified: lastSaved?.toISOString()
        });
        // 这里可以添加自动保存逻辑
      }, 30000); // 30秒后自动保存

      return () => {
        clearTimeout(autoSaveTimer);
      };
    }
  }, [isContentModified, markdownValue.length, lastSaved, logger]);

  return {
    markdownValue,
    setMarkdownValue,
    handleMarkdownChange,
    clearContent,
    isContentModified,
    lastSaved
  };
}; 