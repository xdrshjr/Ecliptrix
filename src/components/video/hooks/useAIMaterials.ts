'use client';

import { useState, useCallback } from 'react';
import { UseAIMaterialsReturn, AIMaterialCategory, AIMaterialCard } from '../types';
import { VideoEditingLogger } from '../utils';
import { aiMaterialCategories, getCardsForCategory } from '../data';
import { useNotification } from '@/contexts/NotificationContext';
import { FluxGenerationService } from '../services/fluxGenerationService';
import { MaterialItem } from '@/types';

export const useAIMaterials = (
  taskId: string,
  onAddMaterials: (materials: MaterialItem[]) => boolean
): UseAIMaterialsReturn => {
  const logger = new VideoEditingLogger({ taskId, component: 'useAIMaterials' });
  const { showNotification } = useNotification();
  
  // FLUX generation service
  const fluxService = new FluxGenerationService(taskId);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Category and card selection
  const [selectedCategory, setSelectedCategory] = useState<AIMaterialCategory>('text-to-image');
  const [selectedCard, setSelectedCard] = useState<AIMaterialCard | null>(null);
  
  // Parameter filling
  const [isParameterMode, setIsParameterMode] = useState(false);
  const [parameters, setParameters] = useState<Record<string, any>>({});
  
  const openModal = useCallback(() => {
    logger.info('打开AI素材弹窗', { category: selectedCategory });
    setIsModalOpen(true);
    setIsParameterMode(false);
    setSelectedCard(null);
    setParameters({});
  }, [logger, selectedCategory]);
  
  const closeModal = useCallback(() => {
    logger.info('关闭AI素材弹窗');
    setIsModalOpen(false);
    setIsParameterMode(false);
    setSelectedCard(null);
    setParameters({});
  }, [logger]);
  
  const handleCardSelect = useCallback((card: AIMaterialCard) => {
    logger.info('选择AI素材卡片', { 
      cardId: card.id, 
      cardName: card.name, 
      category: card.category 
    });
    
    setSelectedCard(card);
    setIsParameterMode(true);
    
    // 初始化参数默认值
    const defaultParams: Record<string, any> = {};
    card.parameters.forEach(param => {
      if (param.defaultValue !== undefined) {
        defaultParams[param.id] = param.defaultValue;
      }
    });
    setParameters(defaultParams);
    
    logger.debug('初始化参数默认值', { 
      cardId: card.id, 
      defaultParams 
    });
  }, [logger]);
  
  const handleBackToCards = useCallback(() => {
    logger.info('返回AI素材卡片列表');
    setIsParameterMode(false);
    setSelectedCard(null);
    setParameters({});
  }, [logger]);
  
  const setParameter = useCallback((parameterId: string, value: any) => {
    logger.debug('设置参数值', { 
      parameterId, 
      value, 
      cardId: selectedCard?.id 
    });
    
    setParameters(prev => ({
      ...prev,
      [parameterId]: value
    }));
  }, [logger, selectedCard?.id]);
  
  const clearParameters = useCallback(() => {
    logger.info('清空参数设置');
    setParameters({});
  }, [logger]);

  // FLUX文生图处理函数
  const handleFluxGeneration = useCallback(async (card: AIMaterialCard, params: Record<string, any>) => {
    try {
      logger.info('开始FLUX文生图生成', { 
        cardId: card.id, 
        cardName: card.name,
        parameters: params 
      });

      // 验证必要参数
      const prompt = params.prompt || params.positive_prompt || '';
      if (!prompt.trim()) {
        throw new Error('请输入生成提示词');
      }

      const aspectRatio = params.aspect_ratio || params.aspectRatio || '3:4 (Golden Ratio)';
      
      // 创建生成任务
      const createResponse = await fluxService.createGenerationTask({
        positive_prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
        task_id: `flux_${taskId}_${Date.now()}`
      });

      if (!createResponse.success) {
        throw new Error(createResponse.error || 'FLUX生成任务创建失败');
      }

      logger.info('FLUX生成任务创建成功', {
        task_id: createResponse.task_id,
        runninghub_task_id: createResponse.runninghub_task_id,
        status: createResponse.status
      });

      // 添加正在生成的素材到素材库
      const generatingMaterial: MaterialItem = {
        id: `flux-generating-${createResponse.task_id}`,
        name: `FLUX生成中: ${prompt.substring(0, 30)}...`,
        type: 'image',
        format: 'png',
        url: '', // 生成中暂无URL
        size: 0,
        duration: 0,
        width: 1024, // 默认尺寸，实际尺寸会在完成后更新
        height: 1024,
        thumbnailUrl: '',
        createdAt: new Date(),
        metadata: {
          source: 'flux-generating',
          generatingStatus: 'running',
          taskId: createResponse.task_id,
          runninghubTaskId: createResponse.runninghub_task_id,
          prompt: prompt,
          aspectRatio: aspectRatio,
          generatedAt: new Date().toISOString()
        }
      };

      // 添加到素材库
      const addSuccess = onAddMaterials([generatingMaterial]);
      if (!addSuccess) {
        logger.warn('添加生成中素材到素材库失败');
      }

      // 开始轮询生成结果
      logger.info('开始轮询FLUX生成结果');
      
      // 使用后台轮询，不阻塞UI
      fluxService.pollForCompletion(
        createResponse.task_id,
        createResponse.runninghub_task_id,
        {
          intervalMs: 5000,
          maxAttempts: 120, // 10分钟超时
          onStatusUpdate: (status) => {
            logger.debug('FLUX生成状态更新', { 
              task_id: createResponse.task_id, 
              status 
            });
            
            // 更新素材状态
            if (status === 'RUNNING') {
              // 可以在这里更新素材的状态显示
            }
          }
        }
      ).then(async (resultResponse) => {
        if (resultResponse.success && resultResponse.results.length > 0) {
          logger.info('FLUX生成完成', {
            task_id: createResponse.task_id,
            results_count: resultResponse.results.length
          });

          // 创建完成的素材
          const completedMaterials: MaterialItem[] = resultResponse.results.map((result, index) => ({
            id: `flux-completed-${createResponse.task_id}-${index}`,
            name: `FLUX生成: ${prompt.substring(0, 30)}${resultResponse.results.length > 1 ? `_${index + 1}` : ''}`,
            type: 'image' as const,
            format: result.fileType || 'png',
            url: result.fileUrl,
            size: 0, // 文件大小未知
            duration: 0,
            width: 1024, // 默认尺寸
            height: 1024,
            thumbnailUrl: result.fileUrl,
            createdAt: new Date(),
            metadata: {
              source: 'flux-generated',
              generatedAt: new Date().toISOString(),
              prompt: prompt,
              aspectRatio: aspectRatio,
              taskCostTime: result.taskCostTime,
              nodeId: result.nodeId,
              taskId: createResponse.task_id,
              runninghubTaskId: createResponse.runninghub_task_id
            }
          }));

          // 替换生成中的素材为完成的素材
          // 首先更新原有的生成中素材为完成状态
          if (completedMaterials.length > 0) {
            const firstCompletedMaterial = completedMaterials[0];
            // 使用原有的生成中素材ID，但更新为完成状态
            const updatedGeneratingMaterial: MaterialItem = {
              ...generatingMaterial,
              id: generatingMaterial.id, // 保持原ID
              name: firstCompletedMaterial.name,
              url: firstCompletedMaterial.url,
              thumbnailUrl: firstCompletedMaterial.thumbnailUrl,
              metadata: {
                ...generatingMaterial.metadata,
                source: 'flux-generated',
                generatingStatus: 'completed',
                ...firstCompletedMaterial.metadata
              }
            };

            // 替换生成中的素材
            const replaceSuccess = onAddMaterials([updatedGeneratingMaterial]);
            
            // 如果有多张图片，添加其余的
            if (completedMaterials.length > 1) {
              const additionalMaterials = completedMaterials.slice(1);
              onAddMaterials(additionalMaterials);
            }

            if (replaceSuccess) {
              showNotification(`FLUX生成完成！已生成 ${completedMaterials.length} 张图片`, 'success');
              logger.info('FLUX生成的图片已添加到素材库', {
                count: completedMaterials.length
              });
            } else {
              showNotification('更新生成的图片到素材库失败', 'error');
              logger.error('更新FLUX生成的图片到素材库失败');
            }
          }
        } else {
          logger.error('FLUX生成失败或无结果', {
            task_id: createResponse.task_id,
            error: resultResponse.error || '未知错误'
          });
          showNotification(`FLUX生成失败: ${resultResponse.error || '未知错误'}`, 'error');
        }
      }).catch((error) => {
        logger.error('FLUX生成轮询过程中发生错误', {
          task_id: createResponse.task_id,
          error: String(error)
        });
        showNotification(`FLUX生成过程中发生错误: ${String(error)}`, 'error');
      });

      showNotification('FLUX生成任务已启动，请在素材管理中查看进度', 'success');

    } catch (error) {
      logger.error('FLUX生成失败', { error: String(error) });
      showNotification(`FLUX生成失败: ${String(error)}`, 'error');
      throw error;
    }
  }, [taskId, fluxService, onAddMaterials, showNotification, logger]);
  
  const handleGenerate = useCallback(async () => {
    if (!selectedCard) {
      logger.warn('生成失败：未选择卡片');
      showNotification('请先选择一个AI应用', 'warning');
      return;
    }
    
    // 验证必填参数
    const missingParams = selectedCard.parameters
      .filter(param => param.required && !parameters[param.id])
      .map(param => param.label);
      
    if (missingParams.length > 0) {
      const message = `请填写必填参数: ${missingParams.join(', ')}`;
      logger.warn('生成失败：缺少必填参数', { 
        missingParams, 
        cardId: selectedCard.id 
      });
      showNotification(message, 'warning');
      return;
    }
    
    try {
      logger.info('开始AI素材生成', { 
        cardId: selectedCard.id, 
        cardName: selectedCard.name,
        category: selectedCard.category,
        parameters 
      });
      
      // 根据不同的category调用对应的生成接口
      switch (selectedCard.category) {
        case 'text-to-image':
          await handleFluxGeneration(selectedCard, parameters);
          break;
        case 'text-to-video':
          logger.info('调用文生视频接口', { parameters });
          // TODO: 调用文生视频API
          showNotification('文生视频功能开发中...', 'info');
          break;
        case 'image-to-image':
          logger.info('调用图生图接口', { parameters });
          // TODO: 调用图生图API
          showNotification('图生图功能开发中...', 'info');
          break;
        case 'image-to-video':
          logger.info('调用图生视频接口', { parameters });
          // TODO: 调用图生视频API
          showNotification('图生视频功能开发中...', 'info');
          break;
        case 'digital-human':
          logger.info('调用数字人接口', { parameters });
          // TODO: 调用数字人API
          showNotification('数字人功能开发中...', 'info');
          break;
        default:
          throw new Error(`不支持的AI素材类型: ${selectedCard.category}`);
      }
      
      showNotification(`正在生成${selectedCard.name}...`, 'info');
      
      // 关闭弹窗
      closeModal();
      
      logger.info('AI素材生成任务已提交', { 
        cardId: selectedCard.id,
        taskId
      });
      
    } catch (error) {
      logger.error('AI素材生成失败', { 
        error,
        cardId: selectedCard.id,
        parameters 
      });
      showNotification(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  }, [selectedCard, parameters, logger, showNotification, closeModal, taskId]);
  
  return {
    // Modal state
    isModalOpen,
    openModal,
    closeModal,
    
    // Category and card selection
    selectedCategory,
    selectedCard,
    setSelectedCategory,
    setSelectedCard,
    
    // Parameter filling
    isParameterMode,
    parameters,
    setParameter,
    clearParameters,
    
    // Actions
    handleCardSelect,
    handleBackToCards,
    handleGenerate,
    
    // Data
    getCardsForCategory,
    categories: aiMaterialCategories,
    
    taskId
  };
};