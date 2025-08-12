'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { ScriptSegment, ScriptSentence, MaterialItem } from '@/types';
import { 
  convertTextToSpeech, 
  convertBatchTextToSpeech,
  convertScriptSegmentsToBatchRequest,
  downloadAudioFile,
  TTSRequest, 
  BatchTTSResponse 
} from '@/lib/api/tts';
import VoiceSelector from './components/VoiceSelector';
import VideoSearchModal from './components/VideoSearchModal/VideoSearchModal';
import { useVideoSearch } from './hooks/useVideoSearch';
import { VideoEditingLogger } from './utils';
import localAudioManager from '@/lib/utils/localAudioManager';

interface ScriptPanelProps {
  segments: ScriptSegment[];
  className?: string;
  onGenerateScript?: () => void;
  isGenerating?: boolean;
  onUpdateSegments?: (segments: ScriptSegment[]) => void;
  onAddMaterial?: (material: MaterialItem) => void; // 添加素材到材料面板
  taskId?: string;
}

const ScriptPanel: React.FC<ScriptPanelProps> = ({ 
  segments, 
  className = '',
  onGenerateScript,
  isGenerating = false,
  onUpdateSegments,
  onAddMaterial,
  taskId
}) => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId: taskId || 'unknown',
    component: 'ScriptPanel'
  }), [taskId]);

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
  const videoSearch = useVideoSearch(taskId || 'unknown', (materials: MaterialItem[]) => {
    if (currentSegmentId) {
      return handleAddVideosToSegment(currentSegmentId, materials);
    }
    return false;
  });

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

  const handleVideoError = useCallback((videoKey: string, video: MaterialItem, segmentId: string, error: any) => {
    setVideoLoadingStates(prev => ({
      ...prev,
      [videoKey]: 'error'
    }));
    
    logger.error('视频加载失败', new Error('Video load error'), {
      segmentId,
      videoId: video.id,
      videoUrl: video.url,
      error: error?.message
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

    // 验证视频总时长是否大于音频时长
    const segment = segments.find(s => s.id === segmentId);
    if (segment?.duration) {
      const totalVideoDuration = videos.reduce((total, video) => total + (video.duration || 0), 0);
      
      if (totalVideoDuration < segment.duration) {
        const errorMessage = `视频总时长 (${Math.ceil(totalVideoDuration)}秒) 需要大于当前音频时长 (${Math.ceil(segment.duration)}秒)`;
        videoSearch.setValidationError(errorMessage);
        logger.warn('视频时长验证失败，弹窗保持开启等待用户调整', {
          segmentId,
          totalVideoDuration,
          requiredDuration: segment.duration,
          errorMessage,
          modalStaysOpen: true
        });
        return false; // 返回失败状态，弹窗不关闭
      }
    }

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
        logger.info('视频已添加到素材管理', {
          segmentId,
          segmentNumber,
          videoId: video.id,
          videoName: video.name,
          videoDuration: video.duration,
          videoIndexInSegment: index + 1
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

  // TTS转换处理
  const handleConvertToSpeech = async (segment: ScriptSegment) => {
    if (convertingSegments.has(segment.id)) {
      console.warn('[ScriptPanel] 该片段正在转换中，忽略重复请求', {
        segmentId: segment.id
      });
      return;
    }

    try {
      console.log('[ScriptPanel] 开始转换语音', {
        segmentId: segment.id,
        segmentTitle: segment.title,
        sentencesCount: segment.sentences.length,
        voiceId: selectedVoiceId,
        taskId
      });

      // 标记为转换中
      setConvertingSegments(prev => new Set([...Array.from(prev), segment.id]));
      setTtsProgress(prev => ({ ...prev, [segment.id]: 0 }));

      // 合并所有句子的文本
      const fullText = segment.sentences.map(sentence => sentence.text).join(' ');

      if (!fullText.trim()) {
        throw new Error('片段文本为空');
      }

      // 模拟进度更新
      const progressInterval = setInterval(() => {
        setTtsProgress(prev => ({
          ...prev,
          [segment.id]: Math.min((prev[segment.id] || 0) + 10, 90)
        }));
      }, 200);

      const request: TTSRequest = {
        text: fullText,
        voice_type: selectedVoiceId,
        speed_ratio: 1.0,
        segment_id: segment.id,
        task_id: taskId
      };

      const response = await convertTextToSpeech(request);

      clearInterval(progressInterval);
      setTtsProgress(prev => ({ ...prev, [segment.id]: 100 }));

      if (response.success && onAddMaterial) {
        // 获取和验证音频URL
        const audioUrl = response.data.audio_url;
        // 只对公共URL清理查询参数，保留签名URL的token
        const cleanAudioUrl = audioUrl.includes('/object/sign/') ? audioUrl : audioUrl.split('?')[0];
        const fileName = audioUrl.split('/').pop()?.split('?')[0] || `audio_${segment.id}_${Date.now()}.mp3`;
        
        console.log('[ScriptPanel] 语音转换成功，开始下载到本地', {
          segmentId: segment.id,
          originalAudioUrl: response.data.audio_url,
          cleanAudioUrl: cleanAudioUrl,
          fileName: fileName,
          fileSize: response.data.file_size
        });

        // 标记段落转换完成
        setCompletedSegments(prev => new Set([...Array.from(prev), segment.id]));

        try {
          // 直接从Supabase URL下载音频文件到本地
          console.log('[ScriptPanel] 开始从Supabase下载音频', {
            url: cleanAudioUrl,
            segmentId: segment.id
          });
          
          const fetchResponse = await fetch(cleanAudioUrl);
          if (!fetchResponse.ok) {
            console.error('[ScriptPanel] Supabase音频下载失败', {
              url: cleanAudioUrl,
              status: fetchResponse.status,
              statusText: fetchResponse.statusText,
              segmentId: segment.id
            });
            throw new Error(`Failed to fetch audio from Supabase: ${fetchResponse.status} ${fetchResponse.statusText}`);
          }
          const audioBlob = await fetchResponse.blob();
          const localUrl = await localAudioManager.storeAudioFile(fileName, audioBlob);

          console.log('[ScriptPanel] 音频文件下载并存储成功', {
            segmentId: segment.id,
            fileName: fileName,
            localUrl: localUrl,
            blobSize: audioBlob.size
          });

          // 创建音频材料项（使用本地URL）
          const segmentNumber = getSegmentNumber(segment.id);
          const audioMaterial: MaterialItem = {
            id: `audio_${segment.id}_${Date.now()}`,
            name: `段落${segmentNumber} - ${segment.title} - 语音`,
            type: 'audio',
            format: 'mp3',
            size: response.data.file_size,
            duration: response.data.duration || Math.ceil(response.data.text_length * 0.15), // 使用服务器返回的实际时长，备用估算
            url: localUrl, // 使用本地URL
            serverUrl: response.data.audio_url, // 保存服务器URL，用于导出合成
            createdAt: new Date(),
            description: `由段落${segmentNumber}"${segment.title}"转换生成的语音`,
            metadata: {
              voice_type: selectedVoiceId,
              text_length: response.data.text_length,
              segment_id: segment.id,
              segment_number: segmentNumber, // 添加段落号
              task_id: taskId,
              server_file_name: fileName, // 保存服务器文件名
              actual_duration: response.data.duration, // 保存实际时长
              duration_method: response.data.duration_method, // 保存时长获取方式
              originalUrl: response.data.audio_url // 保存原始URL
            }
          };

          onAddMaterial(audioMaterial);

          // 更新脚本段落的音频时长
          if (response.data.duration && onUpdateSegments) {
            const updatedSegments = segments.map(seg => {
              if (seg.id === segment.id) {
                console.log('[ScriptPanel] 更新脚本段落音频时长', {
                  segmentId: seg.id,
                  segmentTitle: seg.title,
                  oldDuration: seg.duration,
                  newDuration: response.data.duration,
                  durationMethod: response.data.duration_method,
                  timestamp: new Date().toISOString()
                });
                return {
                  ...seg,
                  duration: response.data.duration // 使用实际的音频时长
                };
              }
              return seg;
            });
            onUpdateSegments(updatedSegments);
            
            console.log('[ScriptPanel] 脚本段落时长更新完成', {
              segmentId: segment.id,
              updatedDuration: response.data.duration,
              totalSegments: updatedSegments.length,
              timestamp: new Date().toISOString()
            });
          }

          console.log('[ScriptPanel] 音频材料添加成功', {
            materialId: audioMaterial.id,
            materialName: audioMaterial.name,
            materialSize: audioMaterial.size,
            actualDuration: response.data.duration,
            durationMethod: response.data.duration_method,
            segmentId: segment.id,
            segmentDurationUpdated: !!response.data.duration
          });

        } catch (downloadError) {
          console.error('[ScriptPanel] 音频下载或存储失败', {
            segmentId: segment.id,
            fileName: fileName,
            error: downloadError instanceof Error ? downloadError.message : String(downloadError)
          });
          throw new Error(`音频下载失败: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`);
        }

      } else {
        throw new Error(response.message || '语音转换失败');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ScriptPanel] 语音转换失败', {
        segmentId: segment.id,
        error: errorMessage,
        taskId
      });

      // 显示错误提示
      alert(`语音转换失败: ${errorMessage}`);

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

  // 批量转换全部语音
  const handleBatchConvertToSpeech = async () => {
    if (isBatchConverting || segments.length === 0) {
      console.warn('[ScriptPanel] 无法开始批量转换', {
        isBatchConverting,
        segmentsCount: segments.length
      });
      return;
    }

    try {
      console.log('[ScriptPanel] 开始批量语音转换', {
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

      // 转换为批量请求格式
      const batchRequest = convertScriptSegmentsToBatchRequest(
        segments,
        selectedVoiceId,
        1.0,
        taskId,
        3 // 默认使用3个并发线程
      );

      console.log('[ScriptPanel] 发送批量TTS请求', {
        segmentsCount: batchRequest.segments.length,
        concurrentThreads: batchRequest.concurrent_threads,
        totalTextLength: batchRequest.segments.reduce((sum, seg) => sum + seg.text.length, 0)
      });

      // 调用批量转换API
      const response: BatchTTSResponse = await convertBatchTextToSpeech(batchRequest);

      console.log('[ScriptPanel] 批量转换完成', {
        success: response.success,
        totalSegments: response.total_segments,
        successfulSegments: response.successful_segments,
        failedSegments: response.failed_segments,
        processingTime: response.total_processing_time
      });

      // 处理转换结果
      let addedMaterials = 0;
      for (const result of response.results) {
        setBatchProgress(prev => ({
          ...prev,
          currentSegment: result.segment_id,
          completed: prev.completed + (result.success ? 1 : 0),
          failed: prev.failed + (result.success ? 0 : 1)
        }));

        if (result.success && result.audio_url && onAddMaterial) {
          try {
            // 找到对应的segment
            const segment = segments.find(seg => seg.id === result.segment_id);
            if (!segment) {
              console.warn('[ScriptPanel] 找不到对应的segment', { segmentId: result.segment_id });
              continue;
            }

            // 获取和验证音频URL
            const cleanAudioUrl = result.audio_url.includes('/object/sign/') ? result.audio_url : result.audio_url.split('?')[0];
            const fileName = result.audio_url.split('/').pop()?.split('?')[0] || `batch_audio_${result.segment_id}_${Date.now()}.mp3`;

            console.log('[ScriptPanel] 下载批量转换的音频文件', {
              segmentId: result.segment_id,
              fileName,
              originalAudioUrl: result.audio_url,
              cleanAudioUrl: cleanAudioUrl,
              fileSize: result.file_size
            });

            // 直接从Supabase URL下载音频文件到本地
            console.log('[ScriptPanel] 开始批量下载Supabase音频', {
              url: cleanAudioUrl,
              segmentId: result.segment_id
            });
            
            const fetchResponse = await fetch(cleanAudioUrl);
            if (!fetchResponse.ok) {
              throw new Error(`Failed to fetch audio from Supabase: ${fetchResponse.status} ${fetchResponse.statusText}`);
            }
            const audioBlob = await fetchResponse.blob();
            const localUrl = await localAudioManager.storeAudioFile(fileName, audioBlob);

            // 创建音频材料项
            const audioMaterial: MaterialItem = {
              id: `batch_audio_${result.segment_id}_${Date.now()}`,
              name: `${segment.title} - 批量语音`,
              type: 'audio',
              format: 'mp3',
              size: result.file_size || audioBlob.size,
              duration: result.duration || Math.ceil(segment.sentences.reduce((sum, s) => sum + s.text.length, 0) * 0.15),
              url: localUrl,
              createdAt: new Date(),
              description: `批量转换生成的"${segment.title}"语音`,
              metadata: {
                voice_type: selectedVoiceId,
                segment_id: result.segment_id,
                task_id: taskId,
                processing_time: result.processing_time,
                batch_conversion: true
              }
            };

            onAddMaterial(audioMaterial);
            addedMaterials++;

            console.log('[ScriptPanel] 批量音频材料添加成功', {
              materialId: audioMaterial.id,
              segmentId: result.segment_id,
              fileName
            });

          } catch (downloadError) {
            console.error('[ScriptPanel] 批量音频下载失败', {
              segmentId: result.segment_id,
              audioUrl: result.audio_url,
              error: downloadError instanceof Error ? downloadError.message : String(downloadError)
            });
          }
        } else if (!result.success) {
          console.error('[ScriptPanel] 段落转换失败', {
            segmentId: result.segment_id,
            error: result.error
          });
        }
      }

      // 显示完成提示
      const message = `批量语音转换完成！\n成功: ${response.successful_segments}/${response.total_segments} 个段落\n已添加: ${addedMaterials} 个音频文件到素材库`;
      alert(message);

      console.log('[ScriptPanel] 批量转换处理完成', {
        totalSegments: response.total_segments,
        successfulSegments: response.successful_segments,
        failedSegments: response.failed_segments,
        addedMaterials,
        processingTime: response.total_processing_time
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ScriptPanel] 批量语音转换失败', {
        error: errorMessage,
        taskId
      });

      alert(`批量语音转换失败: ${errorMessage}`);

    } finally {
      setIsBatchConverting(false);
      setBatchProgress({
        total: 0,
        completed: 0,
        failed: 0
      });
    }
  };

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
                className="p-2 text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 group relative"
                title="生成脚本"
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
                
                {/* Hover tooltip */}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-[9999]">
                  生成脚本
                </div>
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
            <p className="text-sm text-gray-600">暂无脚本内容</p>
            <p className="text-xs text-gray-500 mt-1">
              {onGenerateScript ? '点击"生成脚本"按钮根据左侧内容生成脚本' : '文本脚本将显示在这里'}
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
            <h3 className="text-sm font-semibold text-gray-900">文本脚本</h3>
            <span className="text-xs text-gray-500 ml-3">
              {segments.length} 个片段 · {segments.reduce((sum, segment) => sum + segment.sentences.length, 0)} 句话
            </span>
          </div>
          <div className="flex items-center space-x-2">
            {/* 转换全部语音按钮 - 修改为图标形式 */}
            <button
              onClick={handleBatchConvertToSpeech}
              disabled={isBatchConverting || segments.length === 0}
              className="p-2 text-purple-600 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 group relative"
              title="转换全部语音"
            >
              {isBatchConverting ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M9 9a3 3 0 000 6 3 3 0 000-6zM9 9a3 3 0 000 6 3 3 0 000-6z" />
                </svg>
              )}
              
                                            {/* Hover tooltip */}
               <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-[9999]">
                 转换全部语音
               </div>
            </button>
            
            {/* 生成脚本按钮 - 修改文本和图标 */}
            {onGenerateScript && (
              <button
                onClick={handleGenerateScript}
                disabled={isGenerating}
                className="p-2 text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 group relative"
                title="生成脚本"
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
                
                {/* Hover tooltip */}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-[9999]">
                  生成脚本
                </div>
              </button>
            )}
          </div>
        </div>
        {/* 批量转换进度 - 显示在标题栏内部，不增加高度 */}
        {isBatchConverting && (
          <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
            <div className="text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded">
              进度: {batchProgress.completed + batchProgress.failed}/{batchProgress.total}
              {batchProgress.currentSegment && (
                <span className="ml-1">({batchProgress.currentSegment})</span>
              )}
            </div>
          </div>
        )}
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
                  className="p-1.5 text-purple-600 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 hover:border-purple-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 group relative"
                  title="转换语音"
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
                  
                  {/* Hover tooltip */}
                  <div className={`absolute ${segmentIndex === 0 ? 'top-full mt-2' : 'bottom-full mb-2'} left-1/2 transform -translate-x-1/2 px-2 py-1 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-[9999]`}>
                    {convertingSegments.has(segment.id) ? '转换中...' : '转换语音'}
                  </div>
                </button>

                {/* 搜索在线视频按钮 - 一直显示，但只有转换完成后才可点击 */}
                <button
                  onClick={() => handleOpenVideoSearch(segment.id)}
                  disabled={!completedSegments.has(segment.id)}
                  className={`p-1.5 border rounded transition-colors duration-200 group relative ${
                    completedSegments.has(segment.id)
                      ? 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300'
                      : 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed opacity-50'
                  }`}
                  title={completedSegments.has(segment.id) ? "搜索在线视频" : "请先完成语音转换"}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  
                  {/* Hover tooltip */}
                  <div className={`absolute ${segmentIndex === 0 ? 'top-full mt-2' : 'bottom-full mb-2'} left-1/2 transform -translate-x-1/2 px-2 py-1 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-[9999]`}>
                    {completedSegments.has(segment.id) ? "搜索在线视频" : "请先完成语音转换"}
                  </div>
                </button>
                
                {/* 时长显示 */}
                {segment.duration && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                    {segment.duration.toFixed(2)}s
                  </span>
                )}
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
                              保存
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors duration-150"
                            >
                              取消
                            </button>
                            <span className="text-xs text-gray-500">
                              Enter保存 · Esc取消
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p 
                          className="text-sm text-gray-700 leading-relaxed flex-1 cursor-pointer"
                          onClick={() => handleStartEdit(sentence)}
                        >
                          {sentence.text}
                        </p>
                      )}
                    </div>
                    {editingSentenceId !== sentence.id && (
                      <div className="flex items-center space-x-1 ml-2">
                        {sentence.startTime !== undefined && sentence.endTime !== undefined && (
                          <span className="text-xs text-gray-400 font-mono">
                            {sentence.startTime}s-{sentence.endTime}s
                          </span>
                        )}
                        <button
                          onClick={() => handleStartEdit(sentence)}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors duration-150"
                          title="编辑句子"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* 视频预览区域 */}
            {segment.videos && segment.videos.length > 0 && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="text-xs font-medium text-gray-600">关联视频</h5>
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
                          <video
                            key={`${segment.id}_${currentVideo.id}`} // 强制重新创建元素
                            className="w-full h-full object-contain cursor-pointer"
                            poster={currentVideo.thumbnailUrl}
                            controls
                            preload="metadata"
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
                              handleVideoError(videoKey, currentVideo, segment.id, e.currentTarget.error);
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
                            <source src={currentVideo.url} type={`video/${currentVideo.format}`} />
                            您的浏览器不支持视频播放。
                          </video>
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
                                <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              </div>
                            );
                          } else if (loadingState === 'error') {
                            return (
                              <div className="absolute inset-0 flex items-center justify-center bg-red-500/20">
                                <div className="text-white text-sm">加载失败</div>
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
                            title="上一个视频"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleVideoNavigation(segment.id, 'next')}
                            className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
                            title="下一个视频"
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
    </div>
  );
};

export default ScriptPanel; 