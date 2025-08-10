'use client';

import React, { useState } from 'react';
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
  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  
  // TTS相关状态
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('zh_female_wanqudashu_moon_bigtts');
  const [convertingSegments, setConvertingSegments] = useState<Set<string>>(new Set());
  const [ttsProgress, setTtsProgress] = useState<Record<string, number>>({});
  
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
      console.log('[ScriptPanel] 用户点击获取脚本按钮', {
        timestamp: new Date().toISOString()
      });
      onGenerateScript();
    }
  };

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
          const audioMaterial: MaterialItem = {
            id: `audio_${segment.id}_${Date.now()}`,
            name: `${segment.title} - 语音`,
            type: 'audio',
            format: 'mp3',
            size: response.data.file_size,
            duration: response.data.duration || Math.ceil(response.data.text_length * 0.15), // 使用服务器返回的实际时长，备用估算
            url: localUrl, // 使用本地URL
            serverUrl: response.data.audio_url, // 保存服务器URL，用于导出合成
            createdAt: new Date(),
            description: `由"${segment.title}"片段转换生成的语音`,
            metadata: {
              voice_type: selectedVoiceId,
              text_length: response.data.text_length,
              segment_id: segment.id,
              task_id: taskId,
              server_file_name: fileName, // 保存服务器文件名
              actual_duration: response.data.duration, // 保存实际时长
              duration_method: response.data.duration_method, // 保存时长获取方式
              originalUrl: response.data.audio_url // 保存原始URL
            }
          };

          onAddMaterial(audioMaterial);

          console.log('[ScriptPanel] 音频材料添加成功', {
            materialId: audioMaterial.id,
            materialName: audioMaterial.name,
            materialSize: audioMaterial.size,
            actualDuration: response.data.duration,
            durationMethod: response.data.duration_method,
            segmentId: segment.id
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
        <div className="script-panel-header">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-orange-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-900">文本脚本</h3>
            </div>
            {onGenerateScript && (
              <button
                onClick={handleGenerateScript}
                disabled={isGenerating}
                className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center space-x-1"
              >
                {isGenerating ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>生成中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>重新生成</span>
                  </>
                )}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            0 个片段 · 0 句话
          </p>
        </div>

        {/* 空状态内容 */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-gray-600">暂无脚本内容</p>
            <p className="text-xs text-gray-500 mt-1">
              {onGenerateScript ? '点击"获取脚本"按钮根据左侧内容生成脚本' : '文本脚本将显示在这里'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* 标题栏 - 与其他面板保持一致的样式 */}
      <div className="script-panel-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-orange-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900">文本脚本</h3>
          </div>
          <div className="flex items-center space-x-2">
            {/* 转换全部语音按钮 */}
            <button
              onClick={handleBatchConvertToSpeech}
              disabled={isBatchConverting || segments.length === 0}
              className="px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 hover:border-purple-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center space-x-1"
            >
              {isBatchConverting ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>转换中...</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M9 9a3 3 0 000 6 3 3 0 000-6zM9 9a3 3 0 000 6 3 3 0 000-6z" />
                  </svg>
                  <span>转换全部语音</span>
                </>
              )}
            </button>
            
            {/* 重新生成按钮 */}
            {onGenerateScript && (
              <button
                onClick={handleGenerateScript}
                disabled={isGenerating}
                className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center space-x-1"
              >
                {isGenerating ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>生成中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>重新生成</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-gray-500">
            {segments.length} 个片段 · {segments.reduce((sum, segment) => sum + segment.sentences.length, 0)} 句话
          </p>
          {/* 批量转换进度 */}
          {isBatchConverting && (
            <div className="text-xs text-purple-600">
              进度: {batchProgress.completed + batchProgress.failed}/{batchProgress.total}
              {batchProgress.currentSegment && (
                <span className="ml-1">({batchProgress.currentSegment})</span>
              )}
            </div>
          )}
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
                {/* 转换语音按钮 */}
                <button
                  onClick={() => handleConvertToSpeech(segment)}
                  disabled={convertingSegments.has(segment.id) || isBatchConverting}
                  className="flex items-center space-x-1 px-2 py-1 text-xs font-medium text-purple-600 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 hover:border-purple-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                >
                  {convertingSegments.has(segment.id) ? (
                    <>
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>转换中...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M9 9a3 3 0 000 6 3 3 0 000-6zM9 9a3 3 0 000 6 3 3 0 000-6z" />
                      </svg>
                      <span>转换语音</span>
                    </>
                  )}
                </button>
                
                {/* 时长显示 */}
                {segment.duration && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                    {segment.duration}s
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
    </div>
  );
};

export default ScriptPanel; 