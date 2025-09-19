'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { ScriptSegment, ScriptSentence, MaterialItem, SentenceTimingInfo, AudioSentenceSegment } from '@/types';
import { 
  convertTextToSpeech, 
  convertBatchTextToSpeech,
  convertScriptSegmentsToBatchRequest,
  convertSentencesToSpeech,
  convertScriptSegmentToSentenceRequest,
  downloadAudioFile,
  TTSRequest, 
  BatchTTSResponse,
  SentenceBatchTTSResponse,
  SentenceTTSResult 
} from '@/lib/api/tts';
import { 
  transcribeAudioFromPath, 
  transcribeAudioFromFile,
  formatSubtitleTime,
  SubtitleItem,
  AudioTranscriptionResponse,
  AudioTranscriptionErrorResponse 
} from '@/lib/api/audioTranscription';
import VoiceSelector from './components/VoiceSelector';
import VideoSearchModal from './components/VideoSearchModal/VideoSearchModal';
import VideoUnderstandingScriptModal from './components/VideoUnderstandingScriptModal';
import { useVideoSearch } from './hooks/useVideoSearch';
import { useVideoAIMatch } from './hooks/useVideoAIMatch';
import { useVideoUnderstandingScript } from './hooks/useVideoUnderstandingScript';
import { VideoEditingLogger } from './utils';
import localAudioManager from '@/lib/utils/localAudioManager';
import { useNotification } from '@/contexts/NotificationContext';
import { VideoAnalysisResponse } from './services/videoAnalysisService';
import { useLocale } from '@/contexts/LocaleContext';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';

interface ScriptPanelProps {
  segments: ScriptSegment[];
  className?: string;
  onGenerateScript?: () => void;
  isGenerating?: boolean;
  onUpdateSegments?: (segments: ScriptSegment[]) => void;
  onAddMaterial?: (material: MaterialItem) => void; // 添加素材到材料面板
  taskId?: string;
  materials?: MaterialItem[]; // 添加材料列表，用于查找音频文件
  getVideoAnalysisResult?: (videoUrl: string) => VideoAnalysisResponse | null; // 获取视频分析结果
}

const ScriptPanel: React.FC<ScriptPanelProps> = ({ 
  segments, 
  className = '',
  onGenerateScript,
  isGenerating = false,
  onUpdateSegments,
  onAddMaterial,
  taskId,
  materials = [],
  getVideoAnalysisResult
}) => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId: taskId || 'unknown',
    component: 'ScriptPanel'
  }), [taskId]);

  // 使用通知hook
  const { showSuccess, showError } = useNotification();
  
  // 获取国际化翻译
  const { t } = useLocale();

  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  
  // TTS相关状态
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('zh_male_shaonianzixin_moon_bigtts');
  const [convertingSegments, setConvertingSegments] = useState<Set<string>>(new Set());
  const [ttsProgress, setTtsProgress] = useState<Record<string, number>>({});
  const [completedSegments, setCompletedSegments] = useState<Set<string>>(new Set());
  
  // 视频搜索相关状态
  const [currentSegmentId, setCurrentSegmentId] = useState<string | null>(null);
  const [segmentVideoIndexes, setSegmentVideoIndexes] = useState<Record<string, number>>({});
  
    // 新增：视频播放状态管理
  const [playingVideos, setPlayingVideos] = useState<Set<string>>(new Set());
  const [videoLoadingStates, setVideoLoadingStates] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({});

  // 字幕识别相关状态
  const [transcribingSegments, setTranscribingSegments] = useState<Set<string>>(new Set());
  const [segmentSubtitles, setSegmentSubtitles] = useState<Record<string, SubtitleItem[]>>({});
  const [subtitleErrors, setSubtitleErrors] = useState<Record<string, string>>({});

  // 句子级TTS相关状态
  const [sentenceTimingInfo, setSentenceTimingInfo] = useState<Record<string, SentenceTTSResult[]>>({});
  const [segmentConcatenatedAudio, setSegmentConcatenatedAudio] = useState<Record<string, string>>({});

  // 确认对话框状态
  const [confirmationDialog, setConfirmationDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'danger' as const
  });
  
  // 批量转换相关状态
  const [isBatchConverting, setIsBatchConverting] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
    currentSegment?: string;
  }>({
    total: 0,
    completed: 0,
    failed: 0
  });

  // 视频搜索hook
  const videoSearch = useVideoSearch(
    taskId || 'unknown', 
    (materials: MaterialItem[]) => {
      if (currentSegmentId) {
        return handleAddVideosToSegment(currentSegmentId, materials);
      }
      return false;
    },
    currentSegmentId,
    segments,
    materials || []
  );

  // 视频AI匹配hook
  const videoAIMatch = useVideoAIMatch(taskId || 'unknown');

  // 视频理解生成脚本hook
  const videoUnderstandingScript = useVideoUnderstandingScript(
    taskId || 'unknown', 
    onUpdateSegments,
    getVideoAnalysisResult
  );

  // 字幕识别处理函数
  const handleSubtitleRecognition = useCallback(async (segmentId: string) => {
    if (transcribingSegments.has(segmentId)) {
      logger.warn('字幕识别已在进行中', { segmentId });
      return;
    }

    // 查找对应的音频材料
    const audioMaterial = onAddMaterial ? null : null; // 需要从材料中找到对应的音频文件
    
    // 由于我们需要找到对应segment的音频文件路径，我们需要从本地音频管理器中获取
    // 根据segment的文本内容生成的音频文件
    const segment = segments.find(seg => seg.id === segmentId);
    if (!segment) {
             logger.error('找不到对应的段落', new Error('Segment not found'), { segmentId: segmentId });
      return;
    }

         setTranscribingSegments(prev => new Set(Array.from(prev).concat(segmentId)));
    setSubtitleErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[segmentId];
      return newErrors;
    });

         logger.info('开始字幕识别', {
       segmentId,
       segmentText: segment.sentences.map(s => s.text).join(' ').substring(0, 100)
     });

          try {
       // 查找对应segment的音频材料
       // 从材料管理中查找对应的音频材料，这样可以获取实际的文件信息
       let audioFile: File | null = null;
       let serverAudioPath: string | null = null;
       
       // 方法1: 从材料管理中查找对应的音频材料
       const audioMaterials = materials.filter(material => 
         material.type === 'audio' && 
         (material.metadata?.segmentId === segmentId || 
          material.name.includes(segmentId) ||
          material.id.includes(segmentId))
       );
       
       if (audioMaterials.length > 0) {
         // 使用最新的音频材料
         const latestAudioMaterial = audioMaterials.sort((a, b) => 
           new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
         )[0];
         
         logger.info('从材料管理中找到音频文件', { 
           segmentId, 
           materialId: latestAudioMaterial.id,
           materialName: latestAudioMaterial.name,
           serverUrl: latestAudioMaterial.serverUrl
         });
         
         if (latestAudioMaterial.serverUrl) {
           // 使用材料的服务器URL直接下载文件
           try {
             const response = await fetch(latestAudioMaterial.serverUrl);
             const audioBlob = await response.blob();
             audioFile = new File([audioBlob], latestAudioMaterial.name, { type: 'audio/mpeg' });
             logger.info('成功从材料服务器URL获取音频文件', { segmentId, fileName: audioFile.name });
           } catch (error) {
             logger.warn('从材料服务器URL获取音频文件失败', { 
               segmentId, 
               error: error instanceof Error ? error.message : String(error) 
             });
           }
         }
       }
       
       // 方法2: 尝试从本地音频管理器获取所有可能的音频文件
       // 基于TTS服务的实际文件命名规则：tts_{segment_id}_{timestamp}_{file_id}.mp3
       const possibleFileNames = [
         // 尝试最近可能的文件名模式
         `tts_${segmentId}_*.mp3`, // 通配符模式，需要特殊处理
         `${segmentId}_tts_*.mp3`,
         `${taskId}_${segmentId}.mp3`,
         `${segmentId}.mp3`,
         `segment_${segmentId}.mp3`,
         `audio_${segmentId}.mp3`
       ];
       
       // 由于本地音频管理器可能不支持通配符，我们需要尝试其他方法
       // 先尝试简单的文件名匹配
       for (const fileName of possibleFileNames.slice(2)) { // 跳过通配符模式
         const localAudioUrl = localAudioManager.getAudioFileUrl(fileName);
         if (localAudioUrl) {
           logger.info('找到本地音频文件', { segmentId, fileName, localAudioUrl });
           
           try {
             const response = await fetch(localAudioUrl);
             const audioBlob = await response.blob();
             audioFile = new File([audioBlob], fileName, { type: 'audio/mpeg' });
             break;
           } catch (error) {
             logger.warn('本地音频文件读取失败', { segmentId, fileName, error: error instanceof Error ? error.message : String(error) });
           }
         }
       }
       
       // 方法3: 如果没有找到本地文件，尝试构造服务器路径
       if (!audioFile) {
         logger.info('未找到本地音频文件，尝试使用服务器路径', { segmentId });
         
         // 基于TTS服务的实际存储路径构造可能的服务器端文件路径
         // 从日志可以看出，实际路径格式类似：static/audio/generated/tts_{segment_id}_{timestamp}_{file_id}.mp3
         const possibleServerPaths = [
           // 使用通配符让后端查找匹配的文件
           `../static/audio/generated/tts_${segmentId}_*.mp3`,
           `../static/audio/generated/${segmentId}_tts_*.mp3`,
           `../static/audio/generated/${taskId}_${segmentId}.mp3`,
           `../static/audio/generated/segment_${segmentId}.mp3`,
           `../static/audio/uploaded/${segmentId}.mp3`,
           `../datas/audio/${segmentId}.mp3`
         ];
         
         // 使用第一个可能的路径（后端需要支持通配符查找）
         serverAudioPath = possibleServerPaths[0];
       }
       
       let transcriptionResult: AudioTranscriptionResponse | AudioTranscriptionErrorResponse;
       
       if (audioFile) {
         // 使用本地音频文件
         logger.info('使用本地音频文件进行字幕识别', { segmentId, fileName: audioFile.name });
         
         transcriptionResult = await transcribeAudioFromFile(audioFile, {
           language: 'zh-CN',
           use_itn: true,
           use_punc: false,
           max_lines: 2,
           words_per_line: 15,
           generate_srt_file: true
         });
       } else if (serverAudioPath) {
         // 使用服务器路径
         logger.info('使用服务器路径进行字幕识别', { segmentId, serverAudioPath });
         
         transcriptionResult = await transcribeAudioFromPath({
           file_path: serverAudioPath,
           language: 'zh-CN',
           use_itn: true,
           use_punc: false,
           max_lines: 2,
           words_per_line: 15,
           generate_srt_file: true
         });
       } else {
         throw new Error('未找到对应的音频文件，请确保已完成语音转换');
       }

             if (transcriptionResult.success) {
         const response = transcriptionResult as AudioTranscriptionResponse;
         
         logger.info('字幕识别成功', {
           segmentId,
           jobId: response.job_id,
           subtitleCount: response.subtitles.length,
           processingTime: response.processing_time,
           audioDuration: response.audio_duration
         });

         setSegmentSubtitles(prev => ({
           ...prev,
           [segmentId]: response.subtitles
         }));

         // 自动添加字幕材料到素材管理面板
         if (onAddMaterial && response.subtitles.length > 0) {
           try {
             // 生成SRT格式的字幕内容
             const srtContent = response.subtitles.map((subtitle, index) => {
               const startTime = formatSubtitleTime(subtitle.start_time);
               const endTime = formatSubtitleTime(subtitle.end_time);
               return `${index + 1}\n${startTime} --> ${endTime}\n${subtitle.text}\n`;
             }).join('\n');

             // 创建字幕文件的Blob
             const subtitleBlob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
             const subtitleUrl = URL.createObjectURL(subtitleBlob);

             // 计算字幕总时长
             const totalDuration = response.subtitles.length > 0 
               ? response.subtitles[response.subtitles.length - 1].end_time / 1000 
               : 0;

             // 创建字幕材料项
             const subtitleMaterial: MaterialItem = {
               id: `subtitle_${segmentId}_${Date.now()}`,
               name: `${segment.title || `段落${segments.indexOf(segment) + 1}`} - 字幕`,
               type: 'subtitle',
               format: 'srt',
               size: subtitleBlob.size,
               duration: totalDuration,
               url: subtitleUrl,
               createdAt: new Date(),
               description: `从"${segment.title || `段落${segments.indexOf(segment) + 1}`}"语音识别生成的字幕`,
               metadata: {
                 segment_id: segmentId,
                 task_id: taskId,
                 job_id: response.job_id,
                 subtitle_count: response.subtitles.length,
                 processing_time: response.processing_time,
                 audio_duration: response.audio_duration,
                 srt_content: srtContent,
                 subtitles: response.subtitles,
                 isLocalFile: true,
                 fileName: `${segment.title || `段落${segments.indexOf(segment) + 1}`}_字幕.srt`
               }
             };

             onAddMaterial(subtitleMaterial);

             logger.info('字幕材料添加成功', {
               materialId: subtitleMaterial.id,
               segmentId,
               subtitleCount: response.subtitles.length,
               fileName: subtitleMaterial.metadata?.fileName,
               duration: totalDuration
             });

           } catch (error) {
             logger.error('字幕材料添加失败', new Error(error instanceof Error ? error.message : String(error)), {
               segmentId
             });
           }
         }
      } else {
        const errorResponse = transcriptionResult as AudioTranscriptionErrorResponse;
        
                 logger.error('字幕识别失败', new Error(errorResponse.error), {
           segmentId,
           errorCode: errorResponse.error_code
         });

        setSubtitleErrors(prev => ({
          ...prev,
          [segmentId]: errorResponse.error
        }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
             logger.error('字幕识别异常', new Error(errorMessage), {
         segmentId
       });

      setSubtitleErrors(prev => ({
        ...prev,
        [segmentId]: `字幕识别异常: ${errorMessage}`
      }));
    } finally {
             setTranscribingSegments(prev => {
         const newSet = new Set(Array.from(prev));
         newSet.delete(segmentId);
         return newSet;
       });
    }
  }, [segments, taskId, logger, transcribingSegments]);

  // 新增：视频播放/暂停处理
  const handleVideoPlayPause = useCallback(async (videoElement: HTMLVideoElement, video: MaterialItem, segmentId: string) => {
    const videoKey = `${segmentId}_${video.id}`;
    
    logger.userAction('视频播放控制', 'videoPlayPause', {
      segmentId,
      videoId: video.id,
      videoName: video.name,
      currentlyPlaying: playingVideos.has(videoKey)
    });

    try {
      if (playingVideos.has(videoKey)) {
        // 暂停视频
        videoElement.pause();
        setPlayingVideos(prev => {
          const newSet = new Set(prev);
          newSet.delete(videoKey);
          return newSet;
        });
        
        logger.info('视频暂停成功', {
          segmentId,
          videoId: video.id,
          currentTime: videoElement.currentTime
        });
      } else {
        // 播放视频
        await videoElement.play();
        setPlayingVideos(prev => new Set(prev).add(videoKey));
        
        logger.info('视频播放成功', {
          segmentId,
          videoId: video.id,
          duration: videoElement.duration
        });
      }
    } catch (error) {
      logger.error('视频播放操作失败', error as Error, {
        segmentId,
        videoId: video.id,
        action: playingVideos.has(videoKey) ? 'pause' : 'play'
      });
    }
  }, [playingVideos, logger]);

  // 新增：视频加载状态处理
  const handleVideoLoadStart = useCallback((videoKey: string, video: MaterialItem, segmentId: string) => {
    setVideoLoadingStates(prev => ({
      ...prev,
      [videoKey]: 'loading'
    }));
    
    logger.info('视频开始加载', {
      segmentId,
      videoId: video.id,
      videoUrl: video.url
    });
  }, [logger]);

  const handleVideoCanPlay = useCallback((videoKey: string, video: MaterialItem, segmentId: string) => {
    setVideoLoadingStates(prev => ({
      ...prev,
      [videoKey]: 'loaded'
    }));
    
    logger.info('视频可播放', {
      segmentId,
      videoId: video.id,
      duration: video.duration
    });
  }, [logger]);

  // 获取媒体错误类型描述
  const getMediaErrorType = useCallback((errorCode: number) => {
    switch (errorCode) {
      case 1: return 'MEDIA_ERR_ABORTED - 用户中止了视频加载';
      case 2: return 'MEDIA_ERR_NETWORK - 网络错误导致视频加载失败';
      case 3: return 'MEDIA_ERR_DECODE - 视频解码失败';
      case 4: return 'MEDIA_ERR_SRC_NOT_SUPPORTED - 视频格式不支持或URL无效';
      default: return `Unknown error code: ${errorCode}`;
    }
  }, []);

  const handleVideoError = useCallback((videoKey: string, video: MaterialItem, segmentId: string, error: any) => {
    setVideoLoadingStates(prev => ({
      ...prev,
      [videoKey]: 'error'
    }));
    
    logger.error('视频加载失败', new Error('Video load error'), {
      segmentId,
      videoId: video.id,
      videoUrl: video.url,
      error: error?.message || error,
      errorCode: error?.code,
      errorType: error?.errorType
    });
  }, [logger]);

  const handleStartEdit = (sentence: ScriptSentence) => {
    console.log('[ScriptPanel] 开始编辑句子', {
      sentenceId: sentence.id,
      originalText: sentence.text,
      timestamp: new Date().toISOString()
    });
    setEditingSentenceId(sentence.id);
    setEditingText(sentence.text);
  };

  const handleCancelEdit = () => {
    console.log('[ScriptPanel] 取消编辑句子', {
      sentenceId: editingSentenceId,
      timestamp: new Date().toISOString()
    });
    setEditingSentenceId(null);
    setEditingText('');
  };

  const handleSaveEdit = () => {
    if (!editingSentenceId || !onUpdateSegments) {
      console.warn('[ScriptPanel] 无法保存编辑：缺少必要参数', {
        editingSentenceId,
        hasUpdateCallback: !!onUpdateSegments,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const trimmedText = editingText.trim();
    if (!trimmedText) {
      console.warn('[ScriptPanel] 无法保存编辑：文本为空', {
        sentenceId: editingSentenceId,
        timestamp: new Date().toISOString()
      });
      return;
    }

    console.log('[ScriptPanel] 保存句子编辑', {
      sentenceId: editingSentenceId,
      newText: trimmedText,
      timestamp: new Date().toISOString()
    });

    // 更新segments数据
    const updatedSegments = segments.map(segment => ({
      ...segment,
      sentences: segment.sentences.map(sentence => 
        sentence.id === editingSentenceId 
          ? { ...sentence, text: trimmedText }
          : sentence
      )
    }));

    onUpdateSegments(updatedSegments);
    setEditingSentenceId(null);
    setEditingText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  const handleGenerateScript = () => {
    if (onGenerateScript && !isGenerating) {
      console.log('[ScriptPanel] 用户点击生成脚本按钮', {
        timestamp: new Date().toISOString()
      });
      onGenerateScript();
    }
  };

  // 获取段落索引号（从1开始）
  const getSegmentNumber = useCallback((segmentId: string): number => {
    const index = segments.findIndex(s => s.id === segmentId);
    return index >= 0 ? index + 1 : 0;
  }, [segments]);

  // 添加视频到指定段落
  const handleAddVideosToSegment = useCallback((segmentId: string, videos: MaterialItem[]): boolean => {
    if (!onUpdateSegments) return false;

    logger.info('为段落添加视频', {
      segmentId,
      videosCount: videos.length,
      videoIds: videos.map(v => v.id)
    });

    const updatedSegments = segments.map(seg => {
      if (seg.id === segmentId) {
        return {
          ...seg,
          videos: videos
        };
      }
      return seg;
    });

    onUpdateSegments(updatedSegments);
    setCurrentSegmentId(null);
    
    // 清除验证错误（如果有的话）
    videoSearch.setValidationError(null);

    // 将关联的视频添加到素材管理面板中
    if (onAddMaterial) {
      const segmentNumber = getSegmentNumber(segmentId);
      const segment = segments.find(s => s.id === segmentId);
      
      videos.forEach((video, index) => {
        // 创建带有段落信息的视频副本
        const videoWithSegmentInfo: MaterialItem = {
          ...video,
          name: `段落${segmentNumber} - ${video.name}`,
          description: `段落${segmentNumber}"${segment?.title || ''}"的关联视频 - ${video.description || video.name}`,
          metadata: {
            ...video.metadata,
            segment_id: segmentId,
            segment_number: segmentNumber,
            segment_title: segment?.title,
            video_index_in_segment: index + 1
          }
        };
        
        onAddMaterial(videoWithSegmentInfo);
        logger.info('视频已添加/替换到素材管理', {
          segmentId,
          segmentNumber,
          videoId: video.id,
          videoName: video.name,
          videoDuration: video.duration,
          videoIndexInSegment: index + 1,
          operation: 'addOrReplace'
        });
      });
    }

    // 初始化视频索引为0
    setSegmentVideoIndexes(prev => ({
      ...prev,
      [segmentId]: 0
    }));

    logger.info('视频添加成功', {
      segmentId,
      videosCount: videos.length,
      totalDuration: videos.reduce((total, video) => total + (video.duration || 0), 0),
      addedToMaterialsPanel: !!onAddMaterial
    });

    return true; // 返回成功状态
  }, [segments, onUpdateSegments, logger, videoSearch, onAddMaterial, getSegmentNumber]);

  // 关联AI匹配的视频到段落（不添加到素材管理）
  const handleAssociateVideosToSegment = useCallback((segmentId: string, matchedMaterials: MaterialItem[]): boolean => {
    if (!onUpdateSegments) return false;

    logger.info('关联AI匹配视频到段落', {
      segmentId,
      videosCount: matchedMaterials.length,
      videoIds: matchedMaterials.map(v => v.id)
    });

    // 验证视频总时长是否大于音频时长
    const segment = segments.find(s => s.id === segmentId);
    if (segment?.duration) {
      const totalVideoDuration = matchedMaterials.reduce((total, video) => total + (video.duration || 0), 0);
      
      if (totalVideoDuration < segment.duration) {
        const errorMessage = t.scriptPanel.errors.videoDurationInsufficient
          .replace('{videoDuration}', Math.ceil(totalVideoDuration).toString())
          .replace('{audioDuration}', Math.ceil(segment.duration).toString());
        logger.warn('AI匹配视频时长验证失败', {
          segmentId,
          totalVideoDuration,
          requiredDuration: segment.duration,
          errorMessage
        });
        showError(errorMessage);
        return false;
      }
    }

    // 只更新段落的视频关联，不添加到素材管理
    const updatedSegments = segments.map(seg => {
      if (seg.id === segmentId) {
        return {
          ...seg,
          videos: matchedMaterials
        };
      }
      return seg;
    });

    onUpdateSegments(updatedSegments);

    logger.info('AI匹配视频关联成功', {
      segmentId,
      videosCount: matchedMaterials.length,
      totalDuration: matchedMaterials.reduce((total, video) => total + (video.duration || 0), 0)
    });

    return true;
  }, [segments, onUpdateSegments, logger, showError]);

  // 获取已使用的视频ID列表
  const getUsedVideoIds = useCallback((excludeSegmentId?: string): Set<string> => {
    const usedVideoIds = new Set<string>();
    
    segments.forEach(seg => {
      // 排除当前段落（允许重新匹配当前段落）
      if (excludeSegmentId && seg.id === excludeSegmentId) {
        return;
      }
      
      if (seg.videos && seg.videos.length > 0) {
        seg.videos.forEach(video => {
          usedVideoIds.add(video.id);
        });
      }
    });
    
    return usedVideoIds;
  }, [segments]);

  // 检查是否有可用的（未使用的）已分析视频
  const hasAvailableAnalyzedVideos = useCallback((segmentId: string): boolean => {
    if (!getVideoAnalysisResult) return false;
    
    const usedVideoIds = getUsedVideoIds(segmentId);
    const availableMaterials = materials.filter(material => 
      material.type === 'video' && 
      material.url && 
      !usedVideoIds.has(material.id)
    );
    
    return videoAIMatch.hasAnalyzedVideos(availableMaterials, getVideoAnalysisResult);
  }, [materials, getVideoAnalysisResult, getUsedVideoIds, videoAIMatch]);

  // 处理AI匹配视频
  const handleAIMatchVideos = useCallback(async (segmentId: string) => {
    if (!getVideoAnalysisResult) {
      logger.error('AI匹配视频失败', new Error('Missing required functions'), { 
        segmentId,
        hasGetVideoAnalysisResult: !!getVideoAnalysisResult
      });
      showError('AI匹配视频功能未正确配置');
      return;
    }

    // 获取当前段落
    const segment = segments.find(s => s.id === segmentId);
    if (!segment) {
      logger.error('AI匹配视频失败', new Error('Segment not found'), { segmentId });
      showError('找不到指定的脚本段落');
      return;
    }

    // 获取段落文本
    const scriptText = segment.sentences.map(s => s.text).join(' ');
    if (!scriptText.trim()) {
      logger.warn('AI匹配视频跳过', { segmentId, reason: 'empty_script_text' });
      showError('脚本段落内容为空');
      return;
    }

    // 获取已使用的视频ID（排除当前段落）
    const usedVideoIds = getUsedVideoIds(segmentId);
    
    // 筛选出未使用的视频素材
    const availableMaterials = materials.filter(material => 
      material.type === 'video' && 
      material.url && 
      !usedVideoIds.has(material.id)
    );

    // 检查是否有可用的已分析视频
    if (!videoAIMatch.hasAnalyzedVideos(availableMaterials, getVideoAnalysisResult)) {
      const totalVideoCount = materials.filter(m => m.type === 'video').length;
      const usedVideoCount = usedVideoIds.size;
      const availableVideoCount = availableMaterials.length;
      
      logger.warn('AI匹配视频跳过', { 
        segmentId, 
        reason: 'no_available_analyzed_videos',
        totalVideoCount,
        usedVideoCount,
        availableVideoCount,
        materialCount: materials.length
      });
      
      if (usedVideoCount > 0) {
        showError(`没有找到可用的已解析视频。总计${totalVideoCount}个视频，${usedVideoCount}个已被使用，${availableVideoCount}个可用但未解析`);
      } else {
        showError('没有找到已完成AI解析的视频素材，请先对视频进行AI解析');
      }
      return;
    }

    logger.userAction('开始AI匹配视频', 'aiMatchVideos', {
      segmentId,
      segmentNumber: getSegmentNumber(segmentId),
      scriptTextLength: scriptText.length,
      scriptPreview: scriptText.substring(0, 100),
      totalMaterialCount: materials.length,
      availableMaterialCount: availableMaterials.length,
      usedVideoCount: usedVideoIds.size,
      analyzedVideoCount: videoAIMatch.getAnalyzedVideoCount(availableMaterials, getVideoAnalysisResult)
    });

    try {
      // 执行AI匹配（使用可用的素材）
      const matches = await videoAIMatch.matchVideos(scriptText, availableMaterials, getVideoAnalysisResult, segment.duration);
      
      if (matches.length === 0) {
        logger.info('AI匹配完成但无匹配结果', {
          segmentId,
          scriptTextLength: scriptText.length,
          availableMaterialCount: availableMaterials.length,
          usedVideoCount: usedVideoIds.size,
          analyzedVideoCount: videoAIMatch.getAnalyzedVideoCount(availableMaterials, getVideoAnalysisResult)
        });
        showError('未找到匹配的视频，请尝试调整脚本内容或添加更多未使用的视频素材');
        return;
      }

      // 从可用素材中找到匹配的视频
      const matchedMaterials: MaterialItem[] = [];
      for (const match of matches) {
        const material = availableMaterials.find(m => m.id === match.materialId);
        if (material) {
          matchedMaterials.push(material);
        } else {
          logger.warn('找不到匹配的可用素材', {
            materialId: match.materialId,
            videoName: match.videoName,
            availableMaterialCount: availableMaterials.length
          });
        }
      }
      
      if (matchedMaterials.length === 0) {
        logger.warn('没有找到有效的匹配素材', {
          segmentId,
          originalMatchCount: matches.length
        });
        showError('匹配的视频在可用素材中不存在，可能已被其他段落使用');
        return;
      }
      
      // 将匹配的视频添加到段落并同时添加到素材管理（用于AI自动混剪）
      const success = handleAddVideosToSegment(segmentId, matchedMaterials);
      
      if (success) {
        logger.info('AI匹配视频成功', {
          segmentId,
          matchCount: matches.length,
          addedVideoCount: matchedMaterials.length,
          addedToMaterialsPanel: true,
          matches: matches.map(m => ({
            materialId: m.materialId,
            videoName: m.videoName,
            matchScore: m.matchScore
          })),
          matchedMaterials: matchedMaterials.map(m => ({
            id: m.id,
            name: m.name,
            duration: m.duration
          }))
        });
        
        showSuccess(`成功为段落添加了 ${matchedMaterials.length} 个视频到素材管理 (共找到 ${matches.length} 个匹配项)，现在可以使用AI自动混剪功能`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'AI匹配视频失败';
      logger.error('AI匹配视频失败', error as Error, {
        segmentId,
        scriptTextLength: scriptText.length,
        totalMaterialCount: materials.length,
        availableMaterialCount: availableMaterials.length,
        usedVideoCount: usedVideoIds.size
      });
      showError(`AI匹配视频失败: ${errorMessage}`);
    }
  }, [
    segments, 
    materials, 
    getVideoAnalysisResult, 
    videoAIMatch, 
    handleAssociateVideosToSegment, 
    getUsedVideoIds,
    getSegmentNumber, 
    logger, 
    showSuccess, 
    showError
  ]);

  // 打开视频搜索模态框
  const handleOpenVideoSearch = useCallback((segmentId: string) => {
    // 检查语音转换是否完成
    if (!completedSegments.has(segmentId)) {
      logger.warn('尝试打开视频搜索但语音转换未完成', { segmentId });
      return;
    }

    // 查找对应的段落，获取关键词
    const segment = segments.find(s => s.id === segmentId);
    const keywords = segment?.keywords;

    logger.userAction('打开视频搜索', 'videoSearchButton', { 
      segmentId,
      hasKeywords: !!keywords,
      keywordCount: keywords?.length || 0,
      keywords
    });
    
    setCurrentSegmentId(segmentId);
    
    // 如果段落有关键词，传递给视频搜索模态框
    videoSearch.openSearchModal(keywords);
  }, [completedSegments, logger, videoSearch, segments]);

  // 切换视频预览
  const handleVideoNavigation = useCallback((segmentId: string, direction: 'prev' | 'next') => {
    const segment = segments.find(s => s.id === segmentId);
    if (!segment?.videos || segment.videos.length === 0) return;

    const currentIndex = segmentVideoIndexes[segmentId] || 0;
    const currentVideo = segment.videos[currentIndex];
    
    // 计算新的索引
    let newIndex: number;
    if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : segment.videos.length - 1;
    } else {
      newIndex = currentIndex < segment.videos.length - 1 ? currentIndex + 1 : 0;
    }

    // 如果新索引和当前索引相同，说明只有一个视频，无需切换
    if (newIndex === currentIndex) {
      logger.info('只有一个视频，无需切换', {
        segmentId,
        videoId: currentVideo?.id,
        totalVideos: segment.videos.length
      });
      return;
    }
    
    // 停止当前播放的视频（在状态更新之前）
    if (currentVideo) {
      const currentVideoKey = `${segmentId}_${currentVideo.id}`;
      if (playingVideos.has(currentVideoKey)) {
        // 立即查找并停止实际的视频元素播放
        const videoElement = document.querySelector(`video[data-video-key="${currentVideoKey}"]`) as HTMLVideoElement;
        if (videoElement) {
          try {
            if (!videoElement.paused) {
              videoElement.pause();
              logger.info('DOM视频元素已停止播放', {
                segmentId,
                videoId: currentVideo.id,
                currentTime: videoElement.currentTime,
                paused: videoElement.paused
              });
            }
          } catch (error) {
            logger.warn('停止视频播放时出错', {
              segmentId,
              videoId: currentVideo.id,
              error: (error as Error).message
            });
          }
        } else {
          logger.warn('未找到要停止的视频元素', {
            segmentId,
            videoId: currentVideo.id,
            videoKey: currentVideoKey
          });
        }
        
        // 立即更新播放状态
        setPlayingVideos(prev => {
          const newSet = new Set(prev);
          newSet.delete(currentVideoKey);
          return newSet;
        });
        
        logger.info('切换视频时停止当前播放', {
          segmentId,
          stoppedVideoId: currentVideo.id,
          stoppedVideoName: currentVideo.name
        });
      }
    }

    // 立即更新视频索引状态
    setSegmentVideoIndexes(prev => ({
      ...prev,
      [segmentId]: newIndex
    }));

    const newVideo = segment.videos?.[newIndex];
    logger.userAction('切换视频预览', 'videoNavigation', {
      segmentId,
      direction,
      currentIndex,
      newIndex,
      totalVideos: segment.videos?.length || 0,
      previousVideoId: currentVideo?.id,
      previousVideoName: currentVideo?.name,
      newVideoId: newVideo?.id,
      newVideoName: newVideo?.name
    });

  }, [segments, segmentVideoIndexes, playingVideos, logger]);

  // 格式化时间显示（秒转换为 mm:ss.s 格式）
  const formatTime = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toFixed(1).padStart(4, '0')}`;
  }, []);

  // 获取段落的句子时间信息
  const getSentenceTimingDisplay = useCallback((segmentId: string) => {
    const timingInfo = sentenceTimingInfo[segmentId];
    if (!timingInfo || timingInfo.length === 0) {
      return null;
    }

    const successfulSentences = timingInfo.filter(result => result.success && result.start_time !== undefined && result.end_time !== undefined);
    if (successfulSentences.length === 0) {
      return null;
    }

    return successfulSentences.map(result => ({
      sentenceId: result.sentence_id,
      order: result.order,
      startTime: result.start_time!,
      endTime: result.end_time!,
      duration: result.end_time! - result.start_time!
    })).sort((a, b) => a.order - b.order);
  }, [sentenceTimingInfo]);

  // 句子级TTS转换处理
  const handleConvertToSpeech = async (segment: ScriptSegment) => {
    if (convertingSegments.has(segment.id)) {
      console.warn('[ScriptPanel] 该片段正在转换中，忽略重复请求', {
        segmentId: segment.id
      });
      return;
    }

    try {
      console.log('[ScriptPanel] 开始句子级语音转换', {
        segmentId: segment.id,
        segmentTitle: segment.title,
        sentencesCount: segment.sentences.length,
        voiceId: selectedVoiceId,
        taskId
      });

      // 标记为转换中
      setConvertingSegments(prev => new Set([...Array.from(prev), segment.id]));
      setTtsProgress(prev => ({ ...prev, [segment.id]: 0 }));

      // 检查句子是否为空
      if (!segment.sentences || segment.sentences.length === 0) {
        throw new Error('片段中没有句子');
      }

      // 检查句子文本是否为空
      const hasValidText = segment.sentences.some(sentence => sentence.text.trim());
      if (!hasValidText) {
        throw new Error('片段中没有有效的文本内容');
      }

      // 模拟进度更新
      const progressInterval = setInterval(() => {
        setTtsProgress(prev => ({
          ...prev,
          [segment.id]: Math.min((prev[segment.id] || 0) + 8, 85)
        }));
      }, 300);

      // 准备句子级TTS请求
      const request = convertScriptSegmentToSentenceRequest(
        segment,
        selectedVoiceId,
        1.0,
        taskId,
        3 // 并发线程数
      );

      console.log('[ScriptPanel] 发送句子级TTS请求', {
        segmentId: request.segment_id,
        sentencesCount: request.sentences.length,
        concurrentThreads: request.concurrent_threads
      });

      const response = await convertSentencesToSpeech(request);

      clearInterval(progressInterval);
      setTtsProgress(prev => ({ ...prev, [segment.id]: 100 }));

      if (response.success && response.concatenated_audio_url && onAddMaterial) {
        // 存储句子级时间信息
        setSentenceTimingInfo(prev => ({
          ...prev,
          [segment.id]: response.sentence_results
        }));

        // 存储拼接音频URL
        setSegmentConcatenatedAudio(prev => ({
          ...prev,
          [segment.id]: response.concatenated_audio_url!
        }));

        // 获取和验证拼接音频URL
        const audioUrl = response.concatenated_audio_url;
        const cleanAudioUrl = audioUrl.includes('/object/sign/') ? audioUrl : audioUrl.split('?')[0];
        const fileName = audioUrl.split('/').pop()?.split('?')[0] || `audio_${segment.id}_${Date.now()}.mp3`;
        
        console.log('[ScriptPanel] 句子级语音转换成功，开始下载拼接音频到本地', {
          segmentId: segment.id,
          originalAudioUrl: audioUrl,
          cleanAudioUrl: cleanAudioUrl,
          fileName: fileName,
          totalDuration: response.total_duration,
          successfulSentences: response.successful_sentences,
          failedSentences: response.failed_sentences
        });

        // 标记段落转换完成
        setCompletedSegments(prev => new Set([...Array.from(prev), segment.id]));

        try {
          // 直接从Supabase URL下载拼接音频文件到本地
          console.log('[ScriptPanel] 开始从Supabase下载拼接音频', {
            url: cleanAudioUrl,
            segmentId: segment.id
          });
          
          const fetchResponse = await fetch(cleanAudioUrl);
          if (!fetchResponse.ok) {
            console.error('[ScriptPanel] Supabase拼接音频下载失败', {
              url: cleanAudioUrl,
              status: fetchResponse.status,
              statusText: fetchResponse.statusText,
              segmentId: segment.id
            });
            throw new Error(`Failed to fetch concatenated audio from Supabase: ${fetchResponse.status} ${fetchResponse.statusText}`);
          }
          const audioBlob = await fetchResponse.blob();
          const localUrl = await localAudioManager.storeAudioFile(fileName, audioBlob);

          console.log('[ScriptPanel] 拼接音频文件下载并存储成功', {
            segmentId: segment.id,
            fileName: fileName,
            localUrl: localUrl,
            blobSize: audioBlob.size
          });

          // 创建句子时间信息，用于时间轴可视化
          const sentenceTimingInfo: SentenceTimingInfo[] = response.sentence_results
            .filter(result => result.success && result.start_time !== undefined && result.end_time !== undefined)
            .map(result => ({
              sentence_id: result.sentence_id,
              text: segment.sentences.find(s => s.id === result.sentence_id)?.text || '',
              order: result.order,
              start_time: result.start_time!,
              end_time: result.end_time!,
              duration: result.duration || (result.end_time! - result.start_time!)
            }));

          const sentenceSegments: AudioSentenceSegment = {
            sentences: sentenceTimingInfo,
            total_duration: response.total_duration || 0,
            segment_id: segment.id
          };

          console.log('[ScriptPanel] 创建句子时间信息用于时间轴可视化', {
            segmentId: segment.id,
            sentencesCount: sentenceTimingInfo.length,
            totalDuration: sentenceSegments.total_duration,
            sentences: sentenceTimingInfo.map(s => ({
              id: s.sentence_id,
              text: s.text.substring(0, 20) + '...',
              startTime: s.start_time,
              endTime: s.end_time,
              duration: s.duration
            }))
          });

          // 创建音频材料项（使用本地URL）
          const segmentNumber = getSegmentNumber(segment.id);
          const audioMaterial: MaterialItem = {
            id: `audio_${segment.id}_${Date.now()}`,
            name: `段落${segmentNumber} - ${segment.title} - 语音`,
            type: 'audio',
            format: 'mp3',
            size: response.concatenated_file_size || audioBlob.size,
            duration: response.total_duration || Math.ceil(segment.sentences.reduce((sum, s) => sum + s.text.length, 0) * 0.15),
            url: localUrl, // 使用本地URL
            serverUrl: response.concatenated_audio_url, // 保存服务器URL，用于导出合成
            createdAt: new Date(),
            description: `由段落${segmentNumber}"${segment.title}"的${response.successful_sentences}个句子并发转换并拼接生成的语音`,
            sentenceSegments: sentenceSegments, // 新增：句子段落信息，用于时间轴可视化
            metadata: {
              voice_type: selectedVoiceId,
              text_length: segment.sentences.reduce((sum, s) => sum + s.text.length, 0),
              segment_id: segment.id,
              segment_number: segmentNumber,
              task_id: taskId,
              server_file_name: fileName,
              actual_duration: response.total_duration,
              duration_method: 'concatenated_sentences',
              originalUrl: response.concatenated_audio_url,
              sentence_count: response.total_sentences,
              successful_sentences: response.successful_sentences,
              failed_sentences: response.failed_sentences,
              processing_time: response.total_processing_time,
              sentence_timing: response.sentence_results // 保存句子时间信息
            }
          };

          onAddMaterial(audioMaterial);

          // 更新脚本段落的音频时长
          if (response.total_duration && onUpdateSegments) {
            const updatedSegments = segments.map(seg => {
              if (seg.id === segment.id) {
                console.log('[ScriptPanel] 更新脚本段落音频时长', {
                  segmentId: seg.id,
                  segmentTitle: seg.title,
                  oldDuration: seg.duration,
                  newDuration: response.total_duration,
                  durationMethod: 'concatenated_sentences',
                  timestamp: new Date().toISOString()
                });
                return {
                  ...seg,
                  duration: response.total_duration // 使用拼接音频的实际时长
                };
              }
              return seg;
            });
            onUpdateSegments(updatedSegments);
            
            console.log('[ScriptPanel] 脚本段落时长更新完成', {
              segmentId: segment.id,
              updatedDuration: response.total_duration,
              totalSegments: updatedSegments.length,
              timestamp: new Date().toISOString()
            });
          }

          console.log('[ScriptPanel] 句子级音频材料添加成功', {
            materialId: audioMaterial.id,
            materialName: audioMaterial.name,
            materialSize: audioMaterial.size,
            actualDuration: response.total_duration,
            durationMethod: 'concatenated_sentences',
            segmentId: segment.id,
            segmentDurationUpdated: !!response.total_duration,
            successfulSentences: response.successful_sentences,
            totalSentences: response.total_sentences
          });

          // 显示成功消息，包含时间信息
          showSuccess(`语音转换完成！成功转换 ${response.successful_sentences}/${response.total_sentences} 个句子，总时长 ${response.total_duration?.toFixed(1)}秒`);

        } catch (downloadError) {
          console.error('[ScriptPanel] 拼接音频下载或存储失败', {
            segmentId: segment.id,
            fileName: fileName,
            error: downloadError instanceof Error ? downloadError.message : String(downloadError)
          });
          throw new Error(`拼接音频下载失败: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`);
        }

      } else {
        const errorMsg = response.message || '句子级语音转换失败';
        console.error('[ScriptPanel] 句子级语音转换失败', {
          segmentId: segment.id,
          success: response.success,
          message: response.message,
          successfulSentences: response.successful_sentences,
          failedSentences: response.failed_sentences
        });
        throw new Error(errorMsg);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ScriptPanel] 句子级语音转换失败', {
        segmentId: segment.id,
        error: errorMessage,
        taskId
      });

      // 显示错误提示
      showError(`句子级语音转换失败: ${errorMessage}`);

    } finally {
      // 清理状态
      setConvertingSegments(prev => {
        const newSet = new Set(prev);
        newSet.delete(segment.id);
        return newSet;
      });
      
      setTimeout(() => {
        setTtsProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[segment.id];
          return newProgress;
        });
      }, 2000);
    }
  };

  // 删除句子
  const handleDeleteSentence = useCallback(async (segmentId: string, sentenceId: string) => {
    if (!onUpdateSegments) {
      logger.warn('无法删除句子：缺少更新回调', { segmentId, sentenceId });
      return;
    }

    try {
      logger.info('开始删除句子', { segmentId, sentenceId });

      const updatedSegments = segments.map(segment => {
        if (segment.id === segmentId) {
          const updatedSentences = segment.sentences.filter(sentence => sentence.id !== sentenceId);
          
          // 如果删除后没有句子了，至少保留一个空句子
          if (updatedSentences.length === 0) {
            updatedSentences.push({
              id: `sentence-${Date.now()}`,
              text: ''
            });
          }

          return {
            ...segment,
            sentences: updatedSentences
          };
        }
        return segment;
      });

      onUpdateSegments(updatedSegments);
      
      logger.info('句子删除成功', { segmentId, sentenceId });
      showSuccess('句子删除成功');

    } catch (error) {
      logger.error('删除句子失败', error as Error, { segmentId, sentenceId });
      showError('删除句子失败');
    }
  }, [segments, onUpdateSegments, logger, showSuccess, showError]);

  // 添加句子
  const handleAddSentence = useCallback(async (segmentId: string) => {
    if (!onUpdateSegments) {
      logger.warn('无法添加句子：缺少更新回调', { segmentId });
      return;
    }

    try {
      logger.info('开始添加句子', { segmentId });

      const newSentence: ScriptSentence = {
        id: `sentence-${Date.now()}`,
        text: '请输入新的句子内容...'
      };

      const updatedSegments = segments.map(segment => {
        if (segment.id === segmentId) {
          return {
            ...segment,
            sentences: [...segment.sentences, newSentence]
          };
        }
        return segment;
      });

      onUpdateSegments(updatedSegments);
      
      logger.info('句子添加成功', { segmentId, newSentenceId: newSentence.id });
      showSuccess('句子添加成功');

      // 自动开始编辑新添加的句子
      setTimeout(() => {
        setEditingSentenceId(newSentence.id);
        setEditingText(newSentence.text);
      }, 100);

    } catch (error) {
      logger.error('添加句子失败', error as Error, { segmentId });
      showError('添加句子失败');
    }
  }, [segments, onUpdateSegments, logger, showSuccess, showError]);

  // 批量转换全部语音 - 修改为依次点击每个片段的转换语音按钮
  const handleBatchConvertToSpeech = async () => {
    if (isBatchConverting || segments.length === 0) {
      logger.warn('无法开始批量转换', {
        isBatchConverting,
        segmentsCount: segments.length
      });
      return;
    }

    try {
      logger.info('开始批量语音转换（依次点击各片段转换按钮）', {
        segmentsCount: segments.length,
        voiceId: selectedVoiceId,
        taskId
      });

      setIsBatchConverting(true);
      setBatchProgress({
        total: segments.length,
        completed: 0,
        failed: 0
      });

      let successCount = 0;
      let failCount = 0;

      // 依次处理每个片段，调用各自的转换语音按钮处理函数
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        
        // 跳过已经在转换中的片段
        if (convertingSegments.has(segment.id)) {
          logger.warn('跳过正在转换中的片段', { segmentId: segment.id });
          continue;
        }

        try {
          logger.info('开始转换片段语音', {
            segmentIndex: i + 1,
            totalSegments: segments.length,
            segmentId: segment.id,
            segmentTitle: segment.title
          });

          setBatchProgress(prev => ({
            ...prev,
            currentSegment: segment.id
          }));

          // 调用单个片段的转换语音函数
          await handleConvertToSpeech(segment);
          
          successCount++;
          setBatchProgress(prev => ({
            ...prev,
            completed: successCount
          }));

          logger.info('片段语音转换成功', {
            segmentIndex: i + 1,
            segmentId: segment.id,
            segmentTitle: segment.title,
            successCount
          });

          // 添加延时避免请求过于频繁
          if (i < segments.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

        } catch (error) {
          failCount++;
          setBatchProgress(prev => ({
            ...prev,
            failed: failCount
          }));

          logger.error('片段语音转换失败', error as Error, {
            segmentIndex: i + 1,
            segmentId: segment.id,
            segmentTitle: segment.title,
            failCount
          });
        }
      }

      // 显示完成提示
      if (failCount === 0) {
        showSuccess(`批量语音转换完成！成功转换 ${successCount} 个片段`);
      } else if (successCount > 0) {
        showSuccess(`批量语音转换完成！成功: ${successCount}/${segments.length} 个片段，失败: ${failCount} 个片段`);
      } else {
        showError(`批量语音转换失败！所有 ${segments.length} 个片段都转换失败`);
      }

      logger.info('批量语音转换处理完成', {
        totalSegments: segments.length,
        successCount,
        failCount,
        taskId
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('批量语音转换失败', error as Error, {
        errorMessage,
        taskId
      });

      showError(`批量语音转换失败: ${errorMessage}`);

    } finally {
      setIsBatchConverting(false);
      setBatchProgress({
        total: 0,
        completed: 0,
        failed: 0
      });
    }
  };

  // 关闭确认对话框
  const handleCloseConfirmationDialog = useCallback(() => {
    setConfirmationDialog(prev => ({
      ...prev,
      isOpen: false
    }));
  }, []);

  // 处理删除段落
  const handleDeleteSegment = useCallback((segmentId: string, segmentTitle: string) => {
    // 显示确认对话框
    setConfirmationDialog({
      isOpen: true,
      title: '删除段落',
      message: `确定要删除段落"${segmentTitle}"吗？此操作不可撤销。`,
      type: 'danger',
      onConfirm: () => {
        logger.userAction('删除脚本段落', 'segmentEditor', {
          segmentId,
          segmentTitle,
          changeType: 'delete_segment'
        });

        // 过滤掉要删除的段落
        const updatedSegments = segments.filter(segment => segment.id !== segmentId);
        
        // 调用更新回调
        if (onUpdateSegments) {
          onUpdateSegments(updatedSegments);
        }
        
        logger.info('脚本段落删除完成', {
          deletedSegmentId: segmentId,
          deletedSegmentTitle: segmentTitle,
          remainingSegments: updatedSegments.length
        });

        showSuccess(`段落"${segmentTitle}"已删除`);
        
        // 关闭对话框
        handleCloseConfirmationDialog();
      }
    });
  }, [segments, onUpdateSegments, logger, showSuccess, handleCloseConfirmationDialog]);

  // 如果没有片段，显示空状态
  if (!segments || segments.length === 0) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        {/* 标题栏 - 与其他面板保持一致的样式 */}
        <div className="script-panel-header relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-orange-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">文本脚本</h3>
              <span className="text-xs text-gray-500 ml-3">0 个片段 · 0 句话</span>
            </div>
            {onGenerateScript && (
              <button
                onClick={handleGenerateScript}
                disabled={isGenerating}
                className="p-2 text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                title={t.scriptPanel.header.generateScript}
              >
                {isGenerating ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>

        {/* 空状态内容 */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-gray-600">{t.scriptPanel.emptyState.noScript}</p>
            <p className="text-xs text-gray-500 mt-1">
              {t.scriptPanel.emptyState.scriptWillAppear}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 标题栏 - 与其他面板保持一致的样式 */}
      <div className="script-panel-header relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-orange-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900">{t.scriptPanel.header.title}</h3>
            <span className="text-xs text-gray-500 ml-3">
              {t.scriptPanel.header.segmentsCount.replace('{count}', segments.length.toString())} · {t.scriptPanel.header.sentencesCount.replace('{count}', segments.reduce((sum, segment) => sum + segment.sentences.length, 0).toString())}
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {/* 统一转换所有语音按钮 - 恢复之前删除的功能 */}
            <button
              onClick={handleBatchConvertToSpeech}
              disabled={isBatchConverting || segments.length === 0}
              className="p-2 text-green-600 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 hover:border-green-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              title="统一转换所有语音"
            >
              {isBatchConverting ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M6 10l4-4v3h8v2H10v3l-4-4z" />
                </svg>
              )}
            </button>

            {/* 视频理解生成脚本按钮 */}
            <button
              onClick={videoUnderstandingScript.openModal}
              disabled={videoUnderstandingScript.isGenerating}
              className="p-2 text-purple-600 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              title="视频理解生成脚本"
            >
              {videoUnderstandingScript.isGenerating ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 002 2v8a2 2 0 002 2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6" />
                </svg>
              )}
            </button>
          </div>
        </div>

      </div>

      {/* 脚本内容区域 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {segments.map((segment, segmentIndex) => (
          <div 
            key={segment.id} 
            className="script-segment bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow duration-200"
          >
            {/* 片段标题 */}
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-800 flex items-center">
                <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full text-xs font-semibold flex items-center justify-center mr-2">
                  {segmentIndex + 1}
                </span>
                {segment.title}
              </h4>
              <div className="flex items-center space-x-2">
                {/* 转换语音按钮 - 修改为图标形式 */}
                <button
                  onClick={() => handleConvertToSpeech(segment)}
                  disabled={convertingSegments.has(segment.id) || isBatchConverting}
                  className="p-1.5 text-purple-600 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 hover:border-purple-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                  title={t.scriptPanel.actions.convertSpeech}
                >
                  {convertingSegments.has(segment.id) ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M9 9a3 3 0 000 6 3 3 0 000-6zM9 9a3 3 0 000 6 3 3 0 000-6z" />
                    </svg>
                  )}
                </button>

                {/* 搜索在线视频按钮 - 一直显示，但只有转换完成后才可点击 */}
                <button
                  onClick={() => handleOpenVideoSearch(segment.id)}
                  disabled={!completedSegments.has(segment.id)}
                  className={`p-1.5 border rounded transition-colors duration-200 ${
                    completedSegments.has(segment.id)
                      ? 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300'
                      : 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed opacity-50'
                  }`}
                  title={completedSegments.has(segment.id) ? t.scriptPanel.actions.searchOnlineVideos : t.scriptPanel.actions.completeConversionFirst}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>

                {/* AI匹配视频按钮 - 需要转换完成且有已分析的视频 */}
                <button
                  onClick={() => handleAIMatchVideos(segment.id)}
                  disabled={
                    !completedSegments.has(segment.id) || 
                    !getVideoAnalysisResult ||
                    !hasAvailableAnalyzedVideos(segment.id) ||
                    videoAIMatch.matchState.isMatching
                  }
                  className={`p-1.5 border rounded transition-colors duration-200 ${
                    completedSegments.has(segment.id) && 
                    getVideoAnalysisResult &&
                    hasAvailableAnalyzedVideos(segment.id) &&
                    !videoAIMatch.matchState.isMatching
                      ? 'text-purple-600 bg-purple-50 border-purple-200 hover:bg-purple-100 hover:border-purple-300'
                      : 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed opacity-50'
                  }`}
                  title={
                    !completedSegments.has(segment.id) 
                      ? "请先完成语音转换"
                      : !getVideoAnalysisResult
                        ? "AI匹配功能未配置"
                        : !hasAvailableAnalyzedVideos(segment.id)
                          ? "没有可用的已解析视频（可能已被其他段落使用）"
                          : videoAIMatch.matchState.isMatching
                            ? "AI匹配中..."
                            : "AI匹配视频"
                  }
                >
                  {videoAIMatch.matchState.isMatching ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  )}
                </button>

                {/* 删除段落按钮 */}
                <button
                  onClick={() => handleDeleteSegment(segment.id, segment.title)}
                  className="p-1.5 text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 hover:border-red-300 transition-colors duration-200"
                  title="删除段落"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>

              </div>
            </div>

            {/* 转换进度条 */}
            {ttsProgress[segment.id] !== undefined && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-600">转换进度</span>
                  <span className="text-xs text-gray-600">{ttsProgress[segment.id]}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div 
                    className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${ttsProgress[segment.id]}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* 句子列表 */}
            <div className="space-y-2">
              {segment.sentences.map((sentence, sentenceIndex) => (
                <div 
                  key={sentence.id}
                  className="script-sentence p-2 rounded border border-gray-100 hover:border-gray-200 transition-colors duration-150"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-2 flex-1">
                      <span className="text-xs text-gray-400 mt-1 font-mono">
                        {String(sentenceIndex + 1).padStart(2, '0')}
                      </span>
                      {editingSentenceId === sentence.id ? (
                        <div className="flex-1">
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="w-full p-2 text-sm border border-blue-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            rows={2}
                            autoFocus
                          />
                          <div className="flex items-center space-x-2 mt-2">
                            <button
                              onClick={handleSaveEdit}
                              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors duration-150"
                            >
                              {t.scriptPanel.editing.save}
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors duration-150"
                            >
                              {t.scriptPanel.editing.cancel}
                            </button>
                            <span className="text-xs text-gray-500">
                              {t.scriptPanel.editing.saveHint}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1">
                          <p 
                            className="text-sm text-gray-700 leading-relaxed cursor-pointer"
                            onClick={() => handleStartEdit(sentence)}
                          >
                            {sentence.text}
                          </p>
                          {/* 时间信息显示在句子下方 */}
                          {(() => {
                            // 优先显示句子级TTS生成的时间信息
                            const timingDisplay = getSentenceTimingDisplay(segment.id);
                            const sentenceTiming = timingDisplay?.find(t => t.sentenceId === sentence.id);
                            
                            if (sentenceTiming) {
                              return (
                                <div className="flex items-center space-x-2 mt-1">
                                  <span className="text-xs text-blue-600 font-mono bg-blue-50 px-1 py-0.5 rounded">
                                    {formatTime(sentenceTiming.startTime)}-{formatTime(sentenceTiming.endTime)}
                                  </span>
                                  <span className="text-xs text-gray-400">
                                    时长: {sentenceTiming.duration.toFixed(1)}s
                                  </span>
                                </div>
                              );
                            } else if (sentence.startTime !== undefined && sentence.endTime !== undefined) {
                              // 兼容旧的时间信息
                              return (
                                <div className="mt-1">
                                  <span className="text-xs text-gray-400 font-mono bg-gray-50 px-1 py-0.5 rounded">
                                    {sentence.startTime}s-{sentence.endTime}s
                                  </span>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}
                    </div>
                    {editingSentenceId !== sentence.id && (
                      <div className="flex items-center space-x-1 ml-2">
                        <button
                          onClick={() => handleStartEdit(sentence)}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors duration-150"
                          title={t.scriptPanel.actions.editSentence}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteSentence(segment.id, sentence.id)}
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors duration-150"
                          title={t.scriptPanel.actions.deleteSentence}
                          disabled={segment.sentences.length <= 1}
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {/* 添加句子按钮 */}
              <div className="mt-3 pt-2">
                <button
                  onClick={() => handleAddSentence(segment.id)}
                  className="w-full py-1.5 text-sm text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded transition-colors duration-150 flex items-center justify-center space-x-2"
                  title={t.scriptPanel.actions.addSentence}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span>{t.scriptPanel.actions.addSentence}</span>
                </button>
              </div>
            </div>

            {/* 视频预览区域 */}
            {segment.videos && segment.videos.length > 0 && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="text-xs font-medium text-gray-600 flex items-center">
                    关联视频
                    {segment.videos.length > 1 && (
                      <span className="ml-1 text-xs text-blue-600 bg-blue-100 px-1 py-0.5 rounded">
                        多个
                      </span>
                    )}
                  </h5>
                  <span className="text-xs text-gray-500">
                    {(segmentVideoIndexes[segment.id] || 0) + 1} / {segment.videos.length}
                  </span>
                </div>
                
                {(() => {
                  const currentIndex = segmentVideoIndexes[segment.id] || 0;
                  const currentVideo = segment.videos[currentIndex];
                  
                  if (!currentVideo) return null;
                  
                  return (
                    <div className="space-y-2">
                      {/* 视频预览 */}
                      <div className="relative bg-black rounded-md overflow-hidden aspect-video">
                        {currentVideo.type === 'video' && currentVideo.url ? (
                          // 检查是否为YouTube视频
                          currentVideo.metadata?.source === 'youtube' && currentVideo.metadata?.youtubeId ? (
                            // YouTube视频使用嵌入式播放器
                            <iframe
                              key={`${segment.id}_${currentVideo.id}`}
                              src={`https://www.youtube.com/embed/${currentVideo.metadata.youtubeId}?autoplay=0&controls=1&modestbranding=1&rel=0`}
                              className="w-full h-full"
                              frameBorder="0"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              onLoad={() => {
                                const videoKey = `${segment.id}_${currentVideo.id}`;
                                logger.info('YouTube视频预览加载完成', {
                                  segmentId: segment.id,
                                  videoId: currentVideo.id,
                                  youtubeId: currentVideo.metadata?.youtubeId,
                                  videoKey
                                });
                              }}
                              onError={(e) => {
                                const videoKey = `${segment.id}_${currentVideo.id}`;
                                logger.error('YouTube视频预览加载失败', new Error('YouTube iframe load error'), {
                                  segmentId: segment.id,
                                  videoId: currentVideo.id,
                                  youtubeId: currentVideo.metadata?.youtubeId,
                                  videoKey
                                });
                              }}
                            />
                          ) : (
                            // 其他视频使用video元素
                            <video
                              key={`${segment.id}_${currentVideo.id}`} // 强制重新创建元素
                              className="w-full h-full object-contain cursor-pointer"
                              poster={currentVideo.thumbnailUrl}
                              controls
                              preload="metadata"
                              crossOrigin="anonymous"
                              data-video-key={`${segment.id}_${currentVideo.id}`}
                              onClick={(e) => {
                                const videoElement = e.currentTarget;
                                handleVideoPlayPause(videoElement, currentVideo, segment.id);
                              }}
                              onLoadStart={() => {
                                const videoKey = `${segment.id}_${currentVideo.id}`;
                                handleVideoLoadStart(videoKey, currentVideo, segment.id);
                              }}
                              onCanPlay={() => {
                                const videoKey = `${segment.id}_${currentVideo.id}`;
                                handleVideoCanPlay(videoKey, currentVideo, segment.id);
                              }}
                              onLoadedMetadata={() => {
                                const videoKey = `${segment.id}_${currentVideo.id}`;
                                logger.info('视频元数据加载完成', {
                                  segmentId: segment.id,
                                  videoId: currentVideo.id,
                                  videoKey
                                });
                              }}
                              onError={(e) => {
                                const videoKey = `${segment.id}_${currentVideo.id}`;
                                const error = e.currentTarget.error;
                                const errorDetails = error ? {
                                  code: error.code,
                                  message: error.message,
                                  errorType: getMediaErrorType(error.code)
                                } : { message: 'Unknown video error' };
                                
                                handleVideoError(videoKey, currentVideo, segment.id, errorDetails);
                              }}
                              onPlay={() => {
                                const videoKey = `${segment.id}_${currentVideo.id}`;
                                setPlayingVideos(prev => new Set(prev).add(videoKey));
                                logger.info('视频开始播放', {
                                  segmentId: segment.id,
                                  videoId: currentVideo.id
                                });
                              }}
                              onPause={() => {
                                const videoKey = `${segment.id}_${currentVideo.id}`;
                                setPlayingVideos(prev => {
                                  const newSet = new Set(prev);
                                  newSet.delete(videoKey);
                                  return newSet;
                                });
                                logger.info('视频暂停播放', {
                                  segmentId: segment.id,
                                  videoId: currentVideo.id
                                });
                              }}
                            >
                              <source 
                                src={currentVideo.url} 
                                type={currentVideo.format ? `video/${currentVideo.format}` : 'video/mp4'} 
                              />
                              您的浏览器不支持视频播放。
                            </video>
                          )
                        ) : currentVideo.thumbnailUrl ? (
                          <img 
                            src={currentVideo.thumbnailUrl}
                            alt={currentVideo.name}
                            className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => {
                              logger.userAction('点击非视频素材预览', 'materialPreview', {
                                segmentId: segment.id,
                                materialId: currentVideo.id,
                                materialName: currentVideo.name,
                                materialType: currentVideo.type
                              });
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                        
                        {/* 加载状态指示器 */}
                        {(() => {
                          const videoKey = `${segment.id}_${currentVideo.id}`;
                          const loadingState = videoLoadingStates[videoKey];
                          if (loadingState === 'loading') {
                            return (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                <div className="flex flex-col items-center space-y-2">
                                  <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                  <div className="text-white text-xs">加载中...</div>
                                </div>
                              </div>
                            );
                          } else if (loadingState === 'error') {
                            return (
                              <div className="absolute inset-0 flex items-center justify-center bg-red-500/20 backdrop-blur-sm">
                                <div className="text-center p-4">
                                  <div className="text-red-400 mb-2">
                                    <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                    </svg>
                                  </div>
                                  <div className="text-white text-sm font-medium">视频加载失败</div>
                                  <div className="text-gray-300 text-xs mt-1">请检查网络连接或视频URL</div>
                                  <button 
                                    className="mt-2 px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded transition-colors"
                                    onClick={() => {
                                      // 重置加载状态，触发重新加载
                                      setVideoLoadingStates(prev => {
                                        const newState = { ...prev };
                                        delete newState[videoKey];
                                        return newState;
                                      });
                                      
                                      // 重新加载视频
                                      const videoElement = document.querySelector(`[data-video-key="${videoKey}"]`) as HTMLVideoElement;
                                      if (videoElement) {
                                        videoElement.load();
                                      }
                                    }}
                                  >
                                    重试
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      
                      {/* 视频信息 */}
                      <div className="text-xs text-gray-600">
                        <div className="font-medium truncate">{currentVideo.name}</div>
                        <div className="text-gray-500 mt-1">
                          {currentVideo.duration && `${Math.ceil(currentVideo.duration)}秒`}
                          {currentVideo.width && currentVideo.height && ` · ${currentVideo.width}x${currentVideo.height}`}
                        </div>
                      </div>
                      
                      {/* 导航按钮 */}
                      {segment.videos.length > 1 && (
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => handleVideoNavigation(segment.id, 'prev')}
                            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
                            title={t.scriptPanel.actions.previousVideo}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleVideoNavigation(segment.id, 'next')}
                            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
                            title={t.scriptPanel.actions.nextVideo}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 字幕显示区域 */}



          </div>
        ))}
      </div>

      {/* 音色选择器 */}
      <div className="border-t border-gray-200 p-3">
        <div className={`${isBatchConverting || convertingSegments.size > 0 ? 'opacity-50 pointer-events-none' : ''}`}>
          <VoiceSelector
            selectedVoiceId={selectedVoiceId}
            onVoiceChange={setSelectedVoiceId}
          />
        </div>
      </div>

      {/* 视频搜索模态框 */}
            <VideoSearchModal 
        {...videoSearch}
        taskId={taskId || 'unknown'}
      />

      {/* 视频理解生成脚本弹窗 */}
      <VideoUnderstandingScriptModal
        isOpen={videoUnderstandingScript.isModalOpen}
        onClose={videoUnderstandingScript.closeModal}
        materials={materials || []}
        taskId={taskId || 'unknown'}
        onGenerateScript={videoUnderstandingScript.generateScript}
        isGenerating={videoUnderstandingScript.isGenerating}
      />

      {/* 确认删除对话框 */}
      <ConfirmationDialog
        isOpen={confirmationDialog.isOpen}
        title={confirmationDialog.title}
        message={confirmationDialog.message}
        type={confirmationDialog.type}
        confirmText="删除"
        cancelText="取消"
        onConfirm={confirmationDialog.onConfirm}
        onCancel={handleCloseConfirmationDialog}
      />
    </div>
  );
};

export default ScriptPanel; 