'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ScriptSegment, ScriptSentence, MaterialItem, AIVideoScriptSegment, StoryboardScriptSegment } from '@/types';
import { SentenceTTSResult } from '@/lib/api/tts';
import {
  transcribeAudioFromPath,
  transcribeAudioFromFile,
  formatSubtitleTime,
  SubtitleItem,
  AudioTranscriptionResponse
} from '@/lib/api/audioTranscription';
import { AiGenerateMenu } from './components/AiGenerateMenu';
import { FileText, Loader2, Plus, Sparkles } from './components/SegmentCard/icons';
import {
  SegmentCardList, SegmentNarrationEditor, SegmentSentenceList, SegmentVideoCarousel,
} from './components/SegmentCard';
import type {
  NarrationEditState,
  SegmentListAvailability,
  SegmentListHandlers,
  SentenceActions,
  SentenceEditState,
  SentenceTiming,
  VideoCarouselHandlers,
} from './components/SegmentCard';
import DefaultVoiceBar from './components/SegmentCard/DefaultVoiceBar';
import FollowPlaybackSwitch from './components/SegmentCard/FollowPlaybackSwitch';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import VideoSearchModal from './components/VideoSearchModal/VideoSearchModal';
import { useVideoSearch } from './hooks/useVideoSearch';
import { useVideoAIMatch } from './hooks/useVideoAIMatch';
import { generateKeywordsForSegments, deriveLocalKeywordsFromNarration } from './hooks/useScriptGeneration';
import { VideoEditingLogger } from './utils';
import { stampMaterialForSegment } from './lib/segments/stampMaterialForSegment';
import localAudioManager from '@/lib/utils/localAudioManager';
import { useSegmentCommandsValue, useSegmentLinksValue } from './lib/segments/SegmentLinksContext';
import { useSegmentVoiceGeneration } from './hooks/useSegmentVoiceGeneration';
import { useScriptVoiceFlows } from './components/SegmentDialogs/useScriptVoiceFlows';
import SegmentVoiceOverride from './components/SegmentCard/SegmentVoiceOverride';
import { useNotification } from '@/contexts/NotificationContext';
import { VideoAnalysisResponse } from './services/videoAnalysisService';
import { useLocale } from '@/contexts/LocaleContext';
import { AIVideoScriptTab, createAIVideoSegment } from './components/AIVideoScriptTab';
import { StoryboardScriptTab } from './components/StoryboardScriptTab';
import AiVideoModal from './components/AiVideoModal/AiVideoModal';
import type { ArkVideoGenerateParams } from '@/lib/api/arkVideo';
import { mapSentenceDurationToArkBucket, ArkDurationBucket } from './utils/arkVideoDuration';
import {
  generateSentenceAiVideoPrompt,
  buildFullScriptContext,
  shouldAutoGeneratePrompt,
  runWithConcurrency,
} from '@/lib/api/sentenceAiVideoPrompt';

/** 全片默认音色的内置缺省值（旧工程没有 content.defaultVoiceId 时沿用，I-1）。 */
export const DEFAULT_VOICE_ID = 'zh_male_shaonianzixin_uranus_bigtts';

interface ScriptPanelProps {
  segments: ScriptSegment[];
  className?: string;
  /** 解说 tab「AI 生成」下拉菜单：解说直接生成入口（spec ai-generate-script-modes）。 */
  onSelectNarrationDirect?: () => void;
  /** 解说 tab「AI 生成」下拉菜单：视频理解生成入口（本期占位）。 */
  onSelectVideoUnderstanding?: () => void;
  isGenerating?: boolean;
  onUpdateSegments?: (segments: ScriptSegment[]) => void;
  onAddMaterial?: (material: MaterialItem) => void; // 添加素材到材料面板
  taskId?: string;
  /** Owning project id forwarded to StoryboardScriptTab for project-scoped
   *  pack listing/reads. */
  projectId?: string;
  materials?: MaterialItem[]; // 添加材料列表，用于查找音频文件
  getVideoAnalysisResult?: (videoUrl: string) => VideoAnalysisResponse | null; // 获取视频分析结果
  aiVideoScriptSegments?: AIVideoScriptSegment[];
  onUpdateAIVideoScriptSegments?: (segments: AIVideoScriptSegment[]) => void;
  onGenerateAIVideoScript?: () => void;
  isGeneratingAIVideoScript?: boolean;
  storyboardScriptSegments?: StoryboardScriptSegment[];
  onUpdateStoryboardScriptSegments?: (segments: StoryboardScriptSegment[]) => void;
  // 句子级 AI 视频生成入口：由父组件桥接 useMaterialManagement
  onGenerateAiVideoForSentence?: (
    params: ArkVideoGenerateParams,
    link: { segmentId: string; sentenceId: string },
  ) => void;
  // 「解说直接生成」句卡片「重新生成」AI 视频脚本：父级桥接 generateNarrationVideoScript。
  onRegenerateVideoScript?: (segmentId: string, sentenceId: string) => void;
  /** 段落试听开始前暂停成片预览（spec §3.5.2 useSegmentAudition）。 */
  onPauseComposition?: () => void;
  /** 段落卡 ⋯「定位到时间轴」：播放头移到该段起点。 */
  onLocateSegment?: (segmentId: string) => void;
  /** 段落卡 ⋯「在素材页中显示新配音」：切到素材页并选中该素材。 */
  onRevealMaterial?: (materialId: string) => void;
  /** 全片默认音色（持久化在 content.defaultVoiceId，spec R2 §3.5）。 */
  defaultVoiceId?: string;
  onDefaultVoiceChange?: (voiceId: string) => void;
}

const ScriptPanel: React.FC<ScriptPanelProps> = ({ 
  segments,
  className = '',
  onSelectNarrationDirect,
  onSelectVideoUnderstanding,
  isGenerating = false,
  onUpdateSegments,
  onAddMaterial,
  taskId,
  materials = [],
  getVideoAnalysisResult,
  aiVideoScriptSegments = [],
  onUpdateAIVideoScriptSegments,
  onGenerateAIVideoScript,
  isGeneratingAIVideoScript = false,
  storyboardScriptSegments = [],
  onUpdateStoryboardScriptSegments,
  onGenerateAiVideoForSentence,
  onRegenerateVideoScript,
  projectId,
  onPauseComposition,
  onLocateSegment,
  onRevealMaterial,
  defaultVoiceId = DEFAULT_VOICE_ID,
  onDefaultVoiceChange,
}) => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId: taskId || 'unknown',
    component: 'ScriptPanel'
  }), [taskId]);

  // 保持最新的 segments 引用，供异步批量 prompt 生成使用，避免闭包读到旧值
  const segmentsRef = useRef<ScriptSegment[]>(segments);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);

  /**
   * 增量修改单个 sentence 字段并向上同步，避免整批更新造成竞态覆盖。
   */
  const patchSentence = useCallback(
    (segmentId: string, sentenceId: string, patch: Partial<ScriptSentence>) => {
      if (!onUpdateSegments) return;
      const nextSegments = segmentsRef.current.map(seg => {
        if (seg.id !== segmentId) return seg;
        return {
          ...seg,
          sentences: seg.sentences.map(s => (s.id === sentenceId ? { ...s, ...patch } : s)),
        };
      });
      segmentsRef.current = nextSegments;
      onUpdateSegments(nextSegments);
    },
    [onUpdateSegments],
  );

  // 使用通知hook
  const { showSuccess, showError } = useNotification();
  
  // 获取国际化翻译
  const { t } = useLocale();
  const segmentCommands = useSegmentCommandsValue();
  const segmentLinks = useSegmentLinksValue();

  // Tab state
  const [activeTab, setActiveTab] = useState<'narration' | 'aiVideo' | 'storyboard'>('narration');

  // 句子级 AI 视频弹窗状态
  const [sentenceAiModal, setSentenceAiModal] = useState<{
    open: boolean;
    segmentId?: string;
    sentenceId?: string;
    initialPrompt?: string;
    initialDuration?: ArkDurationBucket;
    sentenceActualDuration?: number;
  }>({ open: false });

  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  // 解说文案编辑状态
  const [editingNarrationSegmentId, setEditingNarrationSegmentId] = useState<string | null>(null);
  const [editingNarrationText, setEditingNarrationText] = useState<string>('');
  // 视频脚本折叠状态（默认折叠）
  const [expandedScriptSegments, setExpandedScriptSegments] = useState<Set<string>>(new Set());

  // TTS相关状态
  const [completedSegments, setCompletedSegments] = useState<Set<string>>(new Set());
  const [keywordGeneratingSegments, setKeywordGeneratingSegments] = useState<Set<string>>(new Set());
  const keywordGenerationPromisesRef = useRef<Map<string, Promise<string[] | undefined>>>(new Map());
  
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

  // 字幕识别处理函数
  const handleSubtitleRecognition = useCallback(async (segmentId: string) => {
    if (transcribingSegments.has(segmentId)) {
      logger.warn('字幕识别已在进行中', { segmentId });
      return;
    }

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
       
       // S06 §4.3 Option A: the transcribe* helpers throw on backend/auth/network failures.
       // The outer try/catch below maps any thrown error into `setSubtitleErrors`.
       let transcriptionResult: AudioTranscriptionResponse;

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
         throw new Error(t.scriptPanel.errors.audioFileNotFound);
       }

             if (transcriptionResult.success) {
         const response = transcriptionResult;

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
               name: `${segment.title || t.scriptPanel.segments.segmentPrefix.replace('{index}', String(segments.indexOf(segment) + 1))}${t.scriptPanel.segments.subtitleSuffix}`,
               type: 'subtitle',
               format: 'srt',
               size: subtitleBlob.size,
               duration: totalDuration,
               url: subtitleUrl,
               createdAt: new Date(),
               description: t.scriptPanel.segments.generatedFrom.replace('{index}', segment.title || String(segments.indexOf(segment) + 1)),
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
                 fileName: `${segment.title || t.scriptPanel.segments.segmentPrefix.replace('{index}', String(segments.indexOf(segment) + 1))}_subtitle.srt`
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
        // The backend returned `success: false` inside a 200 envelope. Surface
        // the message via the same error sink that the catch block uses.
        const fallbackMsg = transcriptionResult.message || t.scriptPanel.errors.subtitleRecognitionFailed;
        logger.error('字幕识别失败', new Error(fallbackMsg), {
          segmentId,
        });

        setSubtitleErrors(prev => ({
          ...prev,
          [segmentId]: fallbackMsg,
        }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
             logger.error('字幕识别异常', new Error(errorMessage), {
         segmentId
       });

      setSubtitleErrors(prev => ({
        ...prev,
        [segmentId]: `${t.scriptPanel.errors.subtitleRecognitionFailed}: ${errorMessage}`
      }));
    } finally {
             setTranscribingSegments(prev => {
         const newSet = new Set(Array.from(prev));
         newSet.delete(segmentId);
         return newSet;
       });
    }
  }, [segments, taskId, logger, transcribingSegments, materials, onAddMaterial]);

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
    // 「解说直接生成」句（有 videoScriptStatus）编辑的是画面脚本 videoScript，而非旁白 text；
    // 常规链路句仍编辑 sentence.text（行为不变）。
    const isNarrationDirect = sentence.videoScriptStatus !== undefined;
    const initialEditText = isNarrationDirect ? (sentence.videoScript ?? '') : sentence.text;
    logger.info('开始编辑句子', {
      sentenceId: sentence.id,
      originalText: initialEditText,
      isNarrationDirect,
      timestamp: new Date().toISOString()
    });
    setEditingSentenceId(sentence.id);
    setEditingText(initialEditText);
  };

  const handleCancelEdit = () => {
    logger.info('取消编辑句子', {
      sentenceId: editingSentenceId,
      timestamp: new Date().toISOString()
    });
    setEditingSentenceId(null);
    setEditingText('');
  };

  const handleSaveEdit = () => {
    if (!editingSentenceId || !onUpdateSegments) {
      logger.warn('无法保存编辑：缺少必要参数', {
        editingSentenceId,
        hasUpdateCallback: !!onUpdateSegments,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const trimmedText = editingText.trim();
    if (!trimmedText) {
      logger.warn('无法保存编辑：文本为空', {
        sentenceId: editingSentenceId,
        timestamp: new Date().toISOString()
      });
      return;
    }

    logger.info('保存句子编辑', {
      sentenceId: editingSentenceId,
      newText: trimmedText,
      timestamp: new Date().toISOString()
    });

    // 更新segments数据。「解说直接生成」句把编辑写回 videoScript（与旁白 text 解耦，spec §7），
    // 并置 succeeded；常规链路句仍写 text。两路均 `{...sentence}` 展开既有字段（RV-1 字段保全）。
    const updatedSegments = segments.map(segment => ({
      ...segment,
      sentences: segment.sentences.map(sentence => {
        if (sentence.id !== editingSentenceId) return sentence;
        if (sentence.videoScriptStatus !== undefined) {
          return {
            ...sentence,
            videoScript: trimmedText,
            videoScriptStatus: 'succeeded' as const,
            videoScriptError: undefined,
          };
        }
        return { ...sentence, text: trimmedText };
      })
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

  // 解说文案编辑处理
  const handleStartNarrationEdit = (segmentId: string, narrationText: string) => {
    setEditingNarrationSegmentId(segmentId);
    setEditingNarrationText(narrationText);
  };

  const handleCancelNarrationEdit = () => {
    setEditingNarrationSegmentId(null);
    setEditingNarrationText('');
  };

  const handleSaveNarrationEdit = () => {
    if (!editingNarrationSegmentId || !onUpdateSegments) return;
    const trimmedText = editingNarrationText.trim();
    if (!trimmedText) return;

    const updatedSegments = segments.map(segment =>
      segment.id === editingNarrationSegmentId
        ? { ...segment, narrationText: trimmedText }
        : segment
    );
    onUpdateSegments(updatedSegments);
    setEditingNarrationSegmentId(null);
    setEditingNarrationText('');
  };

  const handleNarrationKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveNarrationEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelNarrationEdit();
    }
  };

  // 视频脚本折叠切换
  const toggleScriptExpanded = (segmentId: string) => {
    setExpandedScriptSegments(prev => {
      const next = new Set(prev);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
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
    if (segmentLinks.segmentRanges.has(segmentId)) useEditorFocusStore.getState().setPickedVisualSegmentId(segmentId);
    
    // 清除验证错误（如果有的话）
    videoSearch.setValidationError(null);

    // 将关联的视频添加到素材管理面板中
    if (onAddMaterial) {
      const segmentNumber = getSegmentNumber(segmentId);
      const segment = segments.find(s => s.id === segmentId);
      
      // Auto-mix keeps the latest assignment per slot by this stamp: a match
      // that reuses a library id is replaced in place, not appended.
      const assignedAt = Date.now();
      videos.forEach((video, index) => {
        // 创建带有段落信息的视频副本
        const videoWithSegmentInfo = stampMaterialForSegment(video, {
          segmentId,
          segmentNumber,
          segmentTitle: segment?.title,
          videoIndexInSegment: index + 1,
          assignedAt,
          segmentPrefix: t.scriptPanel.segments.segmentPrefix,
        });
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
  }, [segments, onUpdateSegments, logger, videoSearch, onAddMaterial, getSegmentNumber, segmentLinks.segmentRanges]);

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
      showError(t.scriptPanel.actions.aiMatchNotConfigured);
      return;
    }

    // 获取当前段落
    const segment = segments.find(s => s.id === segmentId);
    if (!segment) {
      logger.error('AI匹配视频失败', new Error('Segment not found'), { segmentId });
      showError(t.scriptPanel.errors.segmentTextEmpty);
      return;
    }

    // 获取段落文本
    const scriptText = segment.sentences.map(s => s.text).join(' ');
    if (!scriptText.trim()) {
      logger.warn('AI匹配视频跳过', { segmentId, reason: 'empty_script_text' });
      showError(t.scriptPanel.errors.segmentTextEmpty);
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
  const handleOpenVideoSearch = useCallback(async (segmentId: string) => {
    // 检查语音转换是否完成
    if (!completedSegments.has(segmentId)) {
      logger.warn('尝试打开视频搜索但语音转换未完成', { segmentId });
      return;
    }

    // 查找对应的段落，获取关键词
    const segment = segmentsRef.current.find(s => s.id === segmentId);
    const keywords = segment?.keywords?.filter(keyword => keyword.trim().length > 0);

    logger.userAction('打开视频搜索', 'videoSearchButton', { 
      segmentId,
      hasKeywords: !!keywords?.length,
      keywordCount: keywords?.length || 0,
      keywords
    });
    
    setCurrentSegmentId(segmentId);

    if (keywords && keywords.length > 0) {
      videoSearch.openSearchModal(keywords);
      return;
    }

    if (!segment) {
      videoSearch.openSearchModal();
      return;
    }

    let keywordPromise = keywordGenerationPromisesRef.current.get(segmentId);
    if (!keywordPromise) {
      setKeywordGeneratingSegments(prev => new Set(prev).add(segmentId));
      keywordPromise = (async () => {
        const currentSegment = segmentsRef.current.find(s => s.id === segmentId) || segment;
        const freshKeywords = currentSegment.keywords?.filter(keyword => keyword.trim().length > 0);
        if (freshKeywords && freshKeywords.length > 0) {
          return freshKeywords;
        }

        const [segmentWithKeywords] = await generateKeywordsForSegments(
          [currentSegment],
          taskId || 'unknown',
          logger,
          { language: 'english' },
        );
        let generatedKeywords = segmentWithKeywords?.keywords?.filter(keyword => keyword.trim().length > 0);

        // 桌面端 LLM 关键词不可用（401 / 空内容）时回退：从旁白原文本地派生检索词
        // （FAST_LLM 中→英翻译 → 失败再退化为本地分词），保证搜索框永不为空（评审 R4）。
        if (!generatedKeywords || generatedKeywords.length === 0) {
          const narrationText = currentSegment.sentences
            .map(sentence => (sentence.narration ?? sentence.text ?? '').trim())
            .filter(value => value.length > 0)
            .join(' ');
          const localKeywords = await deriveLocalKeywordsFromNarration(
            narrationText,
            taskId || 'unknown',
            logger,
          );
          if (localKeywords.length > 0) {
            generatedKeywords = localKeywords;
          }
        }

        if (generatedKeywords && generatedKeywords.length > 0 && onUpdateSegments) {
          const nextSegments = segmentsRef.current.map(s =>
            s.id === segmentId ? { ...s, keywords: generatedKeywords } : s,
          );
          segmentsRef.current = nextSegments;
          onUpdateSegments(nextSegments);
        }

        return generatedKeywords && generatedKeywords.length > 0 ? generatedKeywords : undefined;
      })().finally(() => {
        keywordGenerationPromisesRef.current.delete(segmentId);
        setKeywordGeneratingSegments(prev => {
          const next = new Set(prev);
          next.delete(segmentId);
          return next;
        });
      });
      keywordGenerationPromisesRef.current.set(segmentId, keywordPromise);
    }
    
    let generatedKeywords: string[] | undefined;
    try {
      generatedKeywords = await keywordPromise;
    } catch (error) {
      logger.warn('搜索打开时生成关键词失败', {
        segmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (generatedKeywords && generatedKeywords.length > 0) {
      videoSearch.openSearchModal(generatedKeywords);
      return;
    }

    showError('Search keywords could not be generated. Opening search without keywords.');
    videoSearch.openSearchModal();
  }, [completedSegments, logger, onUpdateSegments, showError, taskId, videoSearch]);

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

  /**
   * 为单个 sentence 生成/刷新 AI 视频提示词，写回 store。
   * isManual=true 代表用户主动触发（来自 modal），优先级最高，不会被自动批量生成覆盖。
   */
  const generatePromptForSentence = useCallback(
    async (
      segmentId: string,
      sentenceId: string,
      opts: { isManual?: boolean; fullScriptOverride?: string } = {},
    ): Promise<string | null> => {
      const { isManual = false, fullScriptOverride } = opts;
      const seg = segmentsRef.current.find(s => s.id === segmentId);
      const sentence = seg?.sentences.find(s => s.id === sentenceId);
      if (!seg || !sentence) return null;
      const text = (sentence.text || '').trim();
      if (!text) return null;

      patchSentence(segmentId, sentenceId, {
        aiVideoPromptStatus: 'generating',
        aiVideoPromptError: undefined,
      });

      const fullScript = fullScriptOverride ?? buildFullScriptContext(segmentsRef.current);
      const res = await generateSentenceAiVideoPrompt(text, fullScript);

      if (res.success && res.prompt) {
        patchSentence(segmentId, sentenceId, {
          aiVideoPrompt: res.prompt,
          aiVideoPromptStatus: 'succeeded',
          aiVideoPromptError: undefined,
          ...(isManual ? { aiVideoPromptManual: true } : {}),
        });
        return res.prompt;
      } else {
        patchSentence(segmentId, sentenceId, {
          aiVideoPromptStatus: 'failed',
          aiVideoPromptError: res.message || 'generate failed',
        });
        return null;
      }
    },
    [patchSentence],
  );

  /**
   * TTS 完成后并发生成整段所有句子的 AI 视频提示词（限制并发 2）。
   * - 已手动确认（aiVideoPromptManual=true）或已成功 / 生成中的句子会被跳过
   * - 失败不阻塞其他句
   */
  const autoGeneratePromptsForSegment = useCallback(
    async (segmentId: string) => {
      const seg = segmentsRef.current.find(s => s.id === segmentId);
      if (!seg) return;
      const fullScript = buildFullScriptContext(segmentsRef.current);
      const targets = seg.sentences.filter(shouldAutoGeneratePrompt);
      if (targets.length === 0) return;

      logger.info('开始批量生成句子 AI 视频提示词', {
        segmentId,
        total: targets.length,
      });

      await runWithConcurrency(targets, 2, async (s) => {
        // 在真正运行前再读一次最新状态，避免与手动触发竞态
        const current = segmentsRef.current
          .find(x => x.id === segmentId)?.sentences.find(x => x.id === s.id);
        if (!current || !shouldAutoGeneratePrompt(current)) return;
        try {
          await generatePromptForSentence(segmentId, s.id, {
            isManual: false,
            fullScriptOverride: fullScript,
          });
        } catch (err) {
          logger.warn('批量生成 AI 视频提示词单句失败', {
            segmentId,
            sentenceId: s.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      logger.info('批量生成句子 AI 视频提示词完成', { segmentId });
    },
    [generatePromptForSentence, logger],
  );

  // 逐段 TTS 已迁到 useSegmentVoiceGeneration（spec R2 §3.4.3）：只生成候选配音，
  // 不改时间轴；音色 / 语速取本段覆盖或全片默认，请求时刻的文案 hash 防过期。
  const voice = useSegmentVoiceGeneration({
    taskId, segmentsRef, defaultVoiceId, logger, onAddMaterial, onUpdateSegments, getSegmentNumber,
    onVoiceGenerated: (segmentId, results) => {
      setSentenceTimingInfo(prev => ({ ...prev, [segmentId]: results }));
      setCompletedSegments(prev => new Set([...Array.from(prev), segmentId]));
    },
    onVoiceReady: (segmentId) => { void autoGeneratePromptsForSegment(segmentId); },
  });
  const handleConvertToSpeech = voice.convert;
  const convertingSegments = voice.convertingIds;
  const isBatchConverting = voice.isBatchConverting;
  const voiceFlows = useScriptVoiceFlows({
    taskId, segmentsRef, voice, defaultVoiceId, onDefaultVoiceChange, onUpdateSegments,
  });
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
      showSuccess(t.scriptPanel.messages.sentenceDeleted);

    } catch (error) {
      logger.error('删除句子失败', error as Error, { segmentId, sentenceId });
      showError(t.scriptPanel.errors.sentenceDeleteFailed);
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
        text: t.scriptPanel.messages.newSentencePlaceholder
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
      showSuccess(t.scriptPanel.messages.sentenceAdded);

      // 自动开始编辑新添加的句子
      setTimeout(() => {
        setEditingSentenceId(newSentence.id);
        setEditingText(newSentence.text);
      }, 100);

    } catch (error) {
      logger.error('添加句子失败', error as Error, { segmentId });
      showError(t.scriptPanel.errors.sentenceAddFailed);
    }
  }, [segments, onUpdateSegments, logger, showSuccess, showError]);

  // 批量转换全部语音：逐段生成候选并统计真实成败（spec R2 §3.4.3-5）
  const handleBatchConvertToSpeech = async () => {
    const { ok, failed } = await voice.convertMany(segments.map(segment => segment.id));
    logger.info('批量语音转换处理完成', { totalSegments: segments.length, successCount: ok, failCount: failed, taskId });
    if (failed === 0) {
      showSuccess(t.scriptPanel.errors.batchConversionComplete.replace('{success}', String(ok)));
    } else if (ok > 0) {
      showSuccess(t.scriptPanel.errors.batchConversionPartial.replace('{success}', String(ok))
        .replace('{total}', String(segments.length)).replace('{failed}', String(failed)));
    } else {
      showError(t.scriptPanel.errors.batchConversionFailed.replace('{total}', String(segments.length)));
    }
  };

  // 删除段落：统一走段落命令（确认框列出关联片段，Ctrl+Z 一次恢复，spec R2 §3.7）
  const handleDeleteSegment = useCallback((segmentId: string) => {
    logger.userAction('删除脚本段落', 'segmentEditor', { segmentId, changeType: 'delete_segment' });
    segmentCommands?.requestRemove(segmentId);
  }, [logger, segmentCommands]);

  // 句子级 AI 视频弹窗：优先画面脚本 videoScript（narration-direct 句），其次 aiVideoPrompt，
  // 最后回退旁白兜底，避免 ARK 句级初始提示词取到旁白原文（spec §7 / R6）。
  const handleOpenSentenceAi = useCallback(
    (segment: ScriptSegment, sentence: ScriptSentence, sentenceTiming: SentenceTiming) => {
      const raw = (sentence.text || '').trim();
      const fallbackPrompt = raw.length < 8 && segment.narrationText
        ? `${raw}（上下文：${segment.narrationText.slice(0, 100)}）`
        : raw;
      const initialPrompt = (sentence.videoScript && sentence.videoScript.trim())
        ? sentence.videoScript
        : (sentence.aiVideoPrompt && sentence.aiVideoPrompt.trim())
          ? sentence.aiVideoPrompt
          : fallbackPrompt;
      setSentenceAiModal({
        open: true,
        segmentId: segment.id,
        sentenceId: sentence.id,
        initialPrompt,
        initialDuration: mapSentenceDurationToArkBucket(sentenceTiming.duration),
        sentenceActualDuration: sentenceTiming.duration,
      });
    },
    [],
  );

  const handleVideoPlayingChange = useCallback((videoKey: string, isPlaying: boolean) => {
    setPlayingVideos(prev => {
      const next = new Set(prev);
      if (isPlaying) next.add(videoKey);
      else next.delete(videoKey);
      return next;
    });
  }, []);

  // 重置加载状态并重新加载视频元素
  const handleVideoRetry = useCallback((videoKey: string) => {
    setVideoLoadingStates(prev => {
      const newState = { ...prev };
      delete newState[videoKey];
      return newState;
    });
    const videoElement = document.querySelector(`[data-video-key="${videoKey}"]`) as HTMLVideoElement;
    if (videoElement) {
      videoElement.load();
    }
  }, []);

  // 焦点仓库只读镜像逐段 TTS 状态，供顶栏任务中心计数（spec RV-03）
  const setFocusConvertingIds = useEditorFocusStore(state => state.setConvertingSegmentIds);
  useEffect(() => {
    setFocusConvertingIds(convertingSegments);
  }, [convertingSegments, setFocusConvertingIds]);
  useEffect(() => () => setFocusConvertingIds(new Set()), [setFocusConvertingIds]);

  const panelRef = useRef<HTMLDivElement>(null);

  const segmentListAvailability: SegmentListAvailability = {
    isVoiceBusy: (segmentId) => convertingSegments.has(segmentId) || isBatchConverting,
    replaceVisualBlockReason: (segmentId) => {
      if (keywordGeneratingSegments.has(segmentId)) return 'Generating search keywords...';
      if (!completedSegments.has(segmentId)) return t.workbench.segmentCard.replaceVisualDisabled;
      return null;
    },
    aiMatchBlockReason: (segmentId) => {
      if (!completedSegments.has(segmentId)) return t.scriptPanel.actions.completeConversionFirst;
      if (!getVideoAnalysisResult) return t.scriptPanel.actions.aiMatchNotConfigured;
      if (!hasAvailableAnalyzedVideos(segmentId)) return t.scriptPanel.actions.noAvailableAnalyzedVideos;
      if (videoAIMatch.matchState.isMatching) return t.scriptPanel.actions.aiMatching;
      return null;
    },
  };

  const segmentListHandlers: SegmentListHandlers = {
    onGenerateVoice: (segment) => { void handleConvertToSpeech(segment); },
    onReplaceVisual: (segmentId) => handleOpenVideoSearch(segmentId),
    onAiMatchVisual: (segmentId) => handleAIMatchVideos(segmentId),
    onDeleteSegment: handleDeleteSegment,
    onLocateSegment,
    onRevealMaterial,
    onPolishSegment: voiceFlows.openPolish,
  };

  const narrationEdit: NarrationEditState = {
    editingSegmentId: editingNarrationSegmentId,
    editingText: editingNarrationText,
    onChangeText: setEditingNarrationText,
    onKeyDown: handleNarrationKeyDown,
    onStartEdit: handleStartNarrationEdit,
    onSave: handleSaveNarrationEdit,
    onCancel: handleCancelNarrationEdit,
  };

  const sentenceEdit: SentenceEditState = {
    editingSentenceId,
    editingText,
    onChangeText: setEditingText,
    onKeyDown: handleKeyDown,
    onStartEdit: handleStartEdit,
    onSave: handleSaveEdit,
    onCancel: handleCancelEdit,
  };

  const sentenceActions: SentenceActions = {
    onDeleteSentence: handleDeleteSentence,
    onAddSentence: handleAddSentence,
    onOpenSentenceAi: onGenerateAiVideoForSentence ? handleOpenSentenceAi : undefined,
    onRegenerateVideoScript,
    formatTime,
  };

  const carouselHandlers: VideoCarouselHandlers = {
    onPlayPause: handleVideoPlayPause,
    onLoadStart: handleVideoLoadStart,
    onCanPlay: handleVideoCanPlay,
    onError: handleVideoError,
    onPlayingChange: handleVideoPlayingChange,
    onRetry: handleVideoRetry,
    onNavigate: handleVideoNavigation,
    getMediaErrorType,
  };

  // 选中展开态主体（spec §5.3 renderExpanded）：状态全部仍归 ScriptPanel 所有
  const renderSegmentDetails = (segment: ScriptSegment) => (
    <>
      {segment.narrationText && (
        <SegmentNarrationEditor
          segmentId={segment.id}
          narrationText={segment.narrationText}
          edit={narrationEdit}
        />
      )}
      <SegmentVoiceOverride
        segment={segment} defaultVoiceId={defaultVoiceId} disabled={convertingSegments.has(segment.id)}
        onPatch={(patch) => voiceFlows.patchSegment(segment.id, patch)}
        onRegenerate={() => { void handleConvertToSpeech(segment); }}
      />
      {voice.progress[segment.id] !== undefined && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">{t.scriptPanel.progress.conversionProgress}</span>
            <span className="text-xs text-muted-foreground ws-tabular">{voice.progress[segment.id]}%</span>
          </div>
          <div className="w-full bg-accent rounded-full h-1.5">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${voice.progress[segment.id]}%` }}
            ></div>
          </div>
        </div>
      )}
      <SegmentSentenceList
        segment={segment}
        isOpen={expandedScriptSegments.has(segment.id)}
        onToggle={() => toggleScriptExpanded(segment.id)}
        timings={getSentenceTimingDisplay(segment.id)}
        edit={sentenceEdit}
        actions={sentenceActions}
      />
      <SegmentVideoCarousel
        segment={segment}
        currentIndex={segmentVideoIndexes[segment.id] || 0}
        loadStates={videoLoadingStates}
        handlers={carouselHandlers}
        logger={logger}
      />
    </>
  );

  const narrationSummary = t.workbench.script.summary
    .replace('{segments}', String(segments.length))
    .replace('{sentences}', String(segments.reduce((sum, segment) => sum + segment.sentences.length, 0)));

  return (
    <div ref={panelRef} className={`script-panel flex flex-col h-full ${className}`}>
      {/* 标题栏 36px（spec §3.5.1） */}
      <div className="ws-panel-header">
        <h3 className="ws-panel-title">{t.workbench.script.title}</h3>
        <span className="ws-panel-subtitle ws-tabular flex-1 min-w-0">
          {activeTab === 'narration' ? narrationSummary : null}
        </span>
        {activeTab === 'narration' ? (
          <>
            <FollowPlaybackSwitch />
            {/* AI 生成下拉菜单：解说直接生成 / 视频理解生成 / 统一转换所有语音
                （后者由独立外部按钮收纳进下拉，spec script-panel-toolbar-and-draggable-chat-dock） */}
            {onSelectNarrationDirect && onSelectVideoUnderstanding && (
              <AiGenerateMenu
                onSelectNarrationDirect={onSelectNarrationDirect}
                onSelectVideoUnderstanding={onSelectVideoUnderstanding}
                isBusy={isGenerating || isBatchConverting}
                onConvertAllSpeech={handleBatchConvertToSpeech}
                convertAllSpeechDisabled={segments.length === 0}
                isConvertingAllSpeech={isBatchConverting}
                onBatchFill={segmentCommands ? voiceFlows.openBatchFill : undefined}
              />
            )}
          </>
        ) : activeTab === 'aiVideo' ? (
          /* AI视频脚本 tab - AI生成 + 添加场景按钮；AI分镜 tab 的操作在 tab 内容里 */
          <>
            {onGenerateAIVideoScript && (
              <button
                type="button"
                onClick={onGenerateAIVideoScript}
                disabled={isGeneratingAIVideoScript}
                className="ws-btn ws-btn--outline-primary ws-btn--sm"
                title={t.scriptPanel.aiVideoScript.aiGenerate}
              >
                {isGeneratingAIVideoScript
                  ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
                  : <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" />}
                <span>{isGeneratingAIVideoScript ? t.scriptPanel.aiVideoScript.aiGenerating : t.scriptPanel.aiVideoScript.aiGenerate}</span>
              </button>
            )}
            {onUpdateAIVideoScriptSegments && (
              <button
                type="button"
                onClick={() => {
                  const title = t.scriptPanel.aiVideoScript.segmentTitle.replace('{index}', String(aiVideoScriptSegments.length + 1));
                  onUpdateAIVideoScriptSegments([...aiVideoScriptSegments, createAIVideoSegment(title)]);
                }}
                className="ws-btn ws-btn--ghost ws-btn--sm"
                title={t.scriptPanel.aiVideoScript.addSegment}
              >
                <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>{t.scriptPanel.aiVideoScript.addSegment}</span>
              </button>
            )}
          </>
        ) : null}
      </div>

      {/* 分段控件：原三 tab，名称与键盘导航不变 */}
      <div className="script-panel__tabs">
        <div
          role="tablist"
          aria-label={t.scriptPanel.tabsLabel}
          className="ws-segmented w-full"
          onKeyDown={(e) => {
            const order: Array<typeof activeTab> = ['narration', 'aiVideo', 'storyboard'];
            const idx = order.indexOf(activeTab);
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              setActiveTab(order[(idx + 1) % order.length]);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setActiveTab(order[(idx - 1 + order.length) % order.length]);
            } else if (e.key === 'Home') {
              e.preventDefault();
              setActiveTab(order[0]);
            } else if (e.key === 'End') {
              e.preventDefault();
              setActiveTab(order[order.length - 1]);
            }
          }}
        >
          <button
            id="tab-narration"
            role="tab"
            aria-selected={activeTab === 'narration'}
            aria-controls="panel-narration"
            tabIndex={activeTab === 'narration' ? 0 : -1}
            className="flex-1"
            onClick={() => setActiveTab('narration')}
          >
            {t.scriptPanel.tabs.narrationScript}
          </button>
          <button
            id="tab-aivideo"
            role="tab"
            aria-selected={activeTab === 'aiVideo'}
            aria-controls="panel-aivideo"
            tabIndex={activeTab === 'aiVideo' ? 0 : -1}
            className="flex-1"
            onClick={() => setActiveTab('aiVideo')}
          >
            {t.scriptPanel.tabs.aiVideoScript}
          </button>
          <button
            id="tab-storyboard"
            role="tab"
            aria-selected={activeTab === 'storyboard'}
            aria-controls="panel-storyboard"
            tabIndex={activeTab === 'storyboard' ? 0 : -1}
            className="flex-1"
            onClick={() => setActiveTab('storyboard')}
          >
            {t.scriptPanel.actions.aiStoryboard}
          </button>
        </div>
      </div>

      {/* Tab 内容区域 */}
      <div
        role="tabpanel"
        id={`panel-${activeTab === 'aiVideo' ? 'aivideo' : activeTab}`}
        aria-labelledby={`tab-${activeTab === 'aiVideo' ? 'aivideo' : activeTab}`}
        className="flex-1 flex flex-col overflow-hidden min-h-0"
      >
      {activeTab === 'storyboard' ? (
        onUpdateStoryboardScriptSegments ? (
          <StoryboardScriptTab
            segments={storyboardScriptSegments}
            onUpdateSegments={onUpdateStoryboardScriptSegments}
            onAddMaterial={onAddMaterial}
            taskId={taskId}
            projectId={projectId}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">{t.scriptPanel.header.selectStoryboardPack}</p>
          </div>
        )
      ) : activeTab === 'aiVideo' ? (
        onUpdateAIVideoScriptSegments ? (
          <AIVideoScriptTab
            segments={aiVideoScriptSegments}
            onUpdateSegments={onUpdateAIVideoScriptSegments}
            onAddMaterial={onAddMaterial}
            materials={materials}
            taskId={taskId}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">{t.scriptPanel.aiVideoScript.emptyState}</p>
          </div>
        )
      ) : (!segments || segments.length === 0) ? (
        /* 解说脚本空状态 */
        <div className="ws-empty flex-1">
          <FileText size={32} strokeWidth={1.75} aria-hidden="true" />
          <p>{t.scriptPanel.emptyState.noScript}</p>
          <p className="text-xs">{t.scriptPanel.emptyState.scriptWillAppear}</p>
        </div>
      ) : (
      <>
      {/* 段落卡列表（spec §3.5.2） */}
      <div className="flex-1 overflow-y-auto script-panel__list">
        <SegmentCardList
          segments={segments}
          handlers={segmentListHandlers}
          availability={segmentListAvailability}
          renderSegmentDetails={renderSegmentDetails}
          onPauseComposition={onPauseComposition}
          panelRef={panelRef}
        />
      </div>

      {/* 全片默认音色底栏：TTS 转换中置灰（保持原行为） */}
      <DefaultVoiceBar
        selectedVoiceId={defaultVoiceId}
        onVoiceChange={voiceFlows.requestDefaultVoiceChange}
        disabled={isBatchConverting || convertingSegments.size > 0}
      />

      {/* 视频搜索模态框 */}
            <VideoSearchModal
        {...videoSearch}
        taskId={taskId || 'unknown'}
      />

      {voiceFlows.dialogs}

      {/* 句子级 AI 视频生成弹窗 */}
      <AiVideoModal
        isOpen={sentenceAiModal.open}
        onClose={() => setSentenceAiModal({ open: false })}
        onConfirm={(params) => {
          if (sentenceAiModal.segmentId && sentenceAiModal.sentenceId) {
            onGenerateAiVideoForSentence?.(params, {
              segmentId: sentenceAiModal.segmentId,
              sentenceId: sentenceAiModal.sentenceId,
            });
          }
          setSentenceAiModal({ open: false });
        }}
        materials={materials}
        projectId={projectId}
        initialPrompt={sentenceAiModal.initialPrompt}
        initialDuration={sentenceAiModal.initialDuration}
        initialMode="description"
        subtitle={t.scriptPanel.aiVideoScript.sentenceAiVideoModalSubtitle}
        sentenceActualDuration={sentenceAiModal.sentenceActualDuration}
        onGeneratePrompt={
          sentenceAiModal.segmentId && sentenceAiModal.sentenceId
            ? async () => {
                const segmentId = sentenceAiModal.segmentId!;
                const sentenceId = sentenceAiModal.sentenceId!;
                const result = await generatePromptForSentence(segmentId, sentenceId, {
                  isManual: true,
                });
                if (!result) {
                  const seg = segmentsRef.current.find(s => s.id === segmentId);
                  const sentence = seg?.sentences.find(s => s.id === sentenceId);
                  const reason = sentence?.aiVideoPromptError || 'unknown';
                  showError(
                    t.scriptPanel.aiVideoScript.aiPromptFailedToast.replace('{reason}', reason),
                  );
                }
                return result;
              }
            : undefined
        }
      />
      </>
      )}
      </div>
    </div>
  );
};

export default ScriptPanel;
