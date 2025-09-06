'use client';

import { useState, useCallback } from 'react';
import { UseAIMaterialsReturn, AIMaterialCategory, AIMaterialCard } from '../types';
import { VideoEditingLogger } from '../utils';
import { aiMaterialCategories, getCardsForCategory } from '../data';
import { useNotification } from '@/contexts/NotificationContext';

export const useAIMaterials = (taskId: string): UseAIMaterialsReturn => {
  const logger = new VideoEditingLogger({ taskId, component: 'useAIMaterials' });
  const { addNotification } = useNotification();
  
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
  
  const handleGenerate = useCallback(async () => {
    if (!selectedCard) {
      logger.warn('生成失败：未选择卡片');
      addNotification('请先选择一个AI应用', 'warning');
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
      addNotification(message, 'warning');
      return;
    }
    
    try {
      logger.info('开始AI素材生成', { 
        cardId: selectedCard.id, 
        cardName: selectedCard.name,
        category: selectedCard.category,
        parameters 
      });
      
      // TODO: 根据不同的category调用对应的生成接口
      switch (selectedCard.category) {
        case 'text-to-image':
          logger.info('调用文生图接口', { parameters });
          // TODO: 调用文生图API
          break;
        case 'text-to-video':
          logger.info('调用文生视频接口', { parameters });
          // TODO: 调用文生视频API
          break;
        case 'image-to-image':
          logger.info('调用图生图接口', { parameters });
          // TODO: 调用图生图API
          break;
        case 'image-to-video':
          logger.info('调用图生视频接口', { parameters });
          // TODO: 调用图生视频API
          break;
        case 'digital-human':
          logger.info('调用数字人接口', { parameters });
          // TODO: 调用数字人API
          break;
        default:
          throw new Error(`不支持的AI素材类型: ${selectedCard.category}`);
      }
      
      addNotification(`正在生成${selectedCard.name}...`, 'info');
      
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
      addNotification(`生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  }, [selectedCard, parameters, logger, addNotification, closeModal, taskId]);
  
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