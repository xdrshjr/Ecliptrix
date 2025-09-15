import { useState, useCallback } from 'react';
import { MaterialItem, ScriptSegment } from '@/types';
import { VideoEditingLogger } from '../utils/logger';
import { useNotification } from '@/contexts/NotificationContext';

interface ScriptGenerationParameters {
  language: 'chinese' | 'english' | 'mixed';
  segmentCount: number;
  analysisDepth: 'basic' | 'detailed' | 'comprehensive';
  includeVisualElements: boolean;
  includeAudioAnalysis: boolean;
}

export interface UseVideoUnderstandingScriptReturn {
  isModalOpen: boolean;
  isGenerating: boolean;
  generationError: string | null;
  openModal: () => void;
  closeModal: () => void;
  generateScript: (
    selectedVideos: MaterialItem[], 
    referenceText: string, 
    parameters: ScriptGenerationParameters
  ) => Promise<void>;
}

export const useVideoUnderstandingScript = (
  taskId: string,
  onScriptGenerated?: (segments: ScriptSegment[]) => void
): UseVideoUnderstandingScriptReturn => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'useVideoUnderstandingScript'
  });
  
  const { showSuccess, showError } = useNotification();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const openModal = useCallback(() => {
    logger.userAction('打开视频理解生成脚本弹窗', 'openModal');
    setIsModalOpen(true);
    setGenerationError(null);
  }, [logger]);

  const closeModal = useCallback(() => {
    if (!isGenerating) {
      logger.userAction('关闭视频理解生成脚本弹窗', 'closeModal');
      setIsModalOpen(false);
      setGenerationError(null);
    }
  }, [isGenerating, logger]);

  const generateScript = useCallback(async (
    selectedVideos: MaterialItem[],
    referenceText: string,
    parameters: ScriptGenerationParameters
  ) => {
    setIsGenerating(true);
    setGenerationError(null);

    try {
      logger.info('开始视频理解生成脚本', {
        videoCount: selectedVideos.length,
        videoIds: selectedVideos.map(v => v.id),
        referenceTextLength: referenceText.length,
        parameters
      });

      // Mock API call - replace with actual implementation
      const response = await mockGenerateScriptFromVideos(
        selectedVideos,
        referenceText,
        parameters
      );

      if (response.success) {
        logger.info('视频理解生成脚本成功', {
          generatedSegmentCount: response.segments.length,
          totalDuration: response.segments.reduce((acc, seg) => acc + (seg.duration || 0), 0)
        });

        showSuccess('脚本生成成功！');
        
        // Call the callback with generated segments
        onScriptGenerated?.(response.segments);
        
        // Close modal
        setIsModalOpen(false);
      } else {
        throw new Error(response.error || '脚本生成失败');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      
      logger.error('视频理解生成脚本失败', {
        error: errorMessage,
        videoCount: selectedVideos.length,
        parameters
      });

      setGenerationError(errorMessage);
      showError(`脚本生成失败: ${errorMessage}`);
    } finally {
      setIsGenerating(false);
    }
  }, [logger, showSuccess, showError, onScriptGenerated]);

  return {
    isModalOpen,
    isGenerating,
    generationError,
    openModal,
    closeModal,
    generateScript
  };
};

// Mock API function - replace with actual implementation
async function mockGenerateScriptFromVideos(
  selectedVideos: MaterialItem[],
  referenceText: string,
  parameters: ScriptGenerationParameters
): Promise<{ success: boolean; segments: ScriptSegment[]; error?: string }> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));

  // Mock script generation based on parameters
  const mockSegments: ScriptSegment[] = [];
  
  for (let i = 0; i < parameters.segmentCount; i++) {
    const segmentId = `video-analysis-segment-${Date.now()}-${i}`;
    const segment: ScriptSegment = {
      id: segmentId,
      title: `视频片段 ${i + 1}`,
      sentences: [
        {
          id: `${segmentId}-sentence-1`,
          text: generateMockSentence(parameters, referenceText, i)
        },
        {
          id: `${segmentId}-sentence-2`, 
          text: generateMockSentence(parameters, referenceText, i, true)
        }
      ],
      duration: 15 + Math.random() * 10,
      videos: selectedVideos.length > i ? [selectedVideos[i]] : [],
      keywords: generateMockKeywords(parameters, i)
    };
    
    mockSegments.push(segment);
  }

  return {
    success: true,
    segments: mockSegments
  };
}

function generateMockSentence(
  parameters: ScriptGenerationParameters,
  referenceText: string,
  segmentIndex: number,
  isSecondSentence: boolean = false
): string {
  const baseContent = [
    '这个视频展现了精彩的内容',
    '通过深度分析，我们可以看到',
    '视频中的关键信息包括',
    '从画面内容来看',
    '结合音频分析结果'
  ];

  const visualElements = parameters.includeVisualElements ? [
    '，画面构图优美，色彩搭配和谐',
    '，视觉效果令人印象深刻',
    '，场景设置富有创意',
    '，人物表现自然生动'
  ] : [''];

  const audioElements = parameters.includeAudioAnalysis ? [
    '，背景音乐恰到好处',
    '，音效处理专业',
    '，语音清晰流畅',
    '，整体音频质量优秀'
  ] : [''];

  const referenceInfluence = referenceText.length > 0 ? 
    `，结合参考要求` : '';

  const base = baseContent[segmentIndex % baseContent.length];
  const visual = visualElements[Math.floor(Math.random() * visualElements.length)];
  const audio = audioElements[Math.floor(Math.random() * audioElements.length)];

  if (isSecondSentence) {
    return `这部分内容${referenceInfluence}${visual}${audio}，为整个视频增添了独特的魅力。`;
  }

  return `${base}${referenceInfluence}${visual}${audio}。`;
}

function generateMockKeywords(
  parameters: ScriptGenerationParameters,
  segmentIndex: number
): string[] {
  const baseKeywords = [
    ['视频制作', '创意内容', '专业拍摄'],
    ['视觉效果', '画面构图', '色彩搭配'],
    ['故事叙述', '情节发展', '主题表达'],
    ['技术实现', '后期制作', '特效处理'],
    ['观众体验', '互动元素', '情感共鸣']
  ];

  const visualKeywords = parameters.includeVisualElements ? 
    ['视觉分析', '画面解读', '场景描述'] : [];
    
  const audioKeywords = parameters.includeAudioAnalysis ? 
    ['音频分析', '声音设计', '音效处理'] : [];

  return [
    ...baseKeywords[segmentIndex % baseKeywords.length],
    ...visualKeywords,
    ...audioKeywords
  ];
} 