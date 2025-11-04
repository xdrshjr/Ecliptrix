'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { VideoEditingLogger } from '../../utils';
import { useLocale } from '@/contexts/LocaleContext';

interface ContentPolishModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContentSelect: (content: string) => void;
  originalContent: string;
  taskId: string;
}

interface PolishResult {
  content: string;
  style: string;
  description: string;
}

interface PolishGoal {
  id: string;
  name: string;
  description: string;
  category: string;
  color: string;
  hoverColor: string;
  selectedColor: string;
}

interface PolishConfig {
  polish_goals: PolishGoal[];
  config_info: {
    version: string;
    last_updated: string;
    description: string;
  };
}

const ContentPolishModal: React.FC<ContentPolishModalProps> = ({
  isOpen,
  onClose,
  onContentSelect,
  originalContent,
  taskId
}) => {
  const { t } = useLocale();
  const [selectedStyle, setSelectedStyle] = useState<string>('');
  const [polishResults, setPolishResults] = useState<PolishResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [polishGoals, setPolishGoals] = useState<PolishGoal[]>([]);
  const [configLoading, setConfigLoading] = useState<boolean>(true);
  const [configError, setConfigError] = useState<string>('');

  // 修改为支持多选的状态
  const [selectedStyles, setSelectedStyles] = useState<Set<string>>(new Set());

  const logger = new VideoEditingLogger({
    taskId,
    component: 'ContentPolishModal'
  });

  // 加载润色配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        setConfigLoading(true);
        setConfigError('');
        
        logger.info('开始加载润色配置', { timestamp: new Date().toISOString() });
        
        const response = await fetch('/api/polish-config');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const config: PolishConfig = await response.json();
        
        if (!config.polish_goals || !Array.isArray(config.polish_goals)) {
          throw new Error('Invalid config format: missing polish_goals array');
        }
        
        setPolishGoals(config.polish_goals);
        
        logger.info('成功加载润色配置', {
          totalGoals: config.polish_goals.length,
          configVersion: config.config_info?.version || 'unknown',
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setConfigError(errorMessage);
        
        logger.error('加载润色配置失败', 
          error instanceof Error ? error : new Error(String(error)),
          { timestamp: new Date().toISOString() }
        );
      } finally {
        setConfigLoading(false);
      }
    };

    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]); // 移除logger依赖，避免无限循环

  // 处理润色目标选择（支持多选）
  const handleStyleToggle = useCallback((styleId: string) => {
    setSelectedStyles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(styleId)) {
        newSet.delete(styleId);
      } else {
        newSet.add(styleId);
      }
      
      logger.info('润色目标选择变更', {
        styleId,
        action: newSet.has(styleId) ? 'selected' : 'deselected',
        totalSelected: newSet.size,
        selectedStyles: Array.from(newSet)
      });
      
      return newSet;
    });
  }, [logger]);

  // 记录润色按钮状态变化
  useEffect(() => {
    if (selectedStyles.size > 0) {
      logger.info('润色按钮状态更新', {
        selectedCount: selectedStyles.size,
        selectedGoals: Array.from(selectedStyles),
        hasContent: !!originalContent.trim(),
        isReady: selectedStyles.size > 0 && !!originalContent.trim() && !isLoading && !configLoading,
        timestamp: new Date().toISOString()
      });
    }
  }, [selectedStyles.size, originalContent, isLoading, configLoading, logger, selectedStyles]);

  // 处理润色请求
  const handlePolish = useCallback(async () => {
    if (!originalContent.trim()) {
      logger.warn('润色请求失败', { reason: '原始内容为空' });
      return;
    }

    if (selectedStyles.size === 0) {
      logger.warn('润色请求失败', { reason: '未选择润色目标' });
      return;
    }

    try {
      setIsLoading(true);
      setPolishResults([]);
      setSelectedResult('');

      const selectedStyleIds = Array.from(selectedStyles);
      const selectedGoals = selectedStyleIds.map(styleId => 
        polishGoals.find(goal => goal.id === styleId)
      ).filter(Boolean) as PolishGoal[];
      
      logger.info('开始多目标内容润色', {
        originalContentLength: originalContent.length,
        selectedStylesCount: selectedStyles.size,
        selectedGoals: selectedGoals.map(g => ({ 
          id: g.id, 
          name: t.contentPolishModal.polishGoals[g.id as keyof typeof t.contentPolishModal.polishGoals]?.name || g.name 
        })),
        contentPreview: originalContent.substring(0, 100) + '...'
      });

      // 生成5种不同强度的候选答案，每种都同时满足所有选中的润色目标
      const intensityLabels = [
        t.contentPolishModal.intensityLabels.light,
        t.contentPolishModal.intensityLabels.medium,
        t.contentPolishModal.intensityLabels.strong,
        t.contentPolishModal.intensityLabels.deep,
        t.contentPolishModal.intensityLabels.extreme
      ];
      const polishPromises = [1, 2, 3, 4, 5].map(async (intensity) => {
        try {
          logger.info(`开始强度${intensity}的多目标润色`, { 
            intensity,
            intensityLabel: intensityLabels[intensity - 1],
            selectedGoalsCount: selectedGoals.length,
            selectedGoals: selectedGoals.map(g => 
              t.contentPolishModal.polishGoals[g.id as keyof typeof t.contentPolishModal.polishGoals]?.name || g.name
            )
          });

          const response = await fetch('/api/content-polish-multiple', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              originalContent,
              polishStyles: selectedStyleIds,
              taskId,
              intensity
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No reader available');
          }

          let accumulatedContent = '';
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = new TextDecoder().decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  logger.info(`强度${intensity}润色调用完成`, { 
                    intensity,
                    intensityLabel: intensityLabels[intensity - 1],
                    contentLength: accumulatedContent.length 
                  });
                  break;
                }
                
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.content) {
                    accumulatedContent += parsed.content;
                  }
                } catch (e) {
                  logger.error(`解析SSE数据失败`, e instanceof Error ? e : new Error(String(e)), { line });
                }
              }
            }
          }

          return {
            content: accumulatedContent.trim(),
            style: intensityLabels[intensity - 1],
            description: t.contentPolishModal.multiGoalDescription
              .replace('{count}', selectedGoals.length.toString())
              .replace('{goals}', selectedGoals.map(g => 
                t.contentPolishModal.polishGoals[g.id as keyof typeof t.contentPolishModal.polishGoals]?.name || g.name
              ).join('、'))
          };
        } catch (error) {
          logger.error(`强度${intensity}润色调用失败`, 
            error instanceof Error ? error : new Error(String(error)), 
            { intensity, intensityLabel: intensityLabels[intensity - 1] }
          );
          return {
            content: t.contentPolishModal.errors.polishFailed.replace('{error}', error instanceof Error ? error.message : String(error)),
            style: intensityLabels[intensity - 1],
            description: t.contentPolishModal.errors.intensityPolishFailed.replace('{intensity}', intensity.toString())
          };
        }
      });

      const results = await Promise.all(polishPromises);
      
      // 过滤掉失败的结果
      const successfulResults = results.filter(result => 
        result.content && 
        !result.content.includes(t.contentPolishModal.errors.polishFailed.split(':')[0]) && 
        result.content.trim().length > 0
      );

      if (successfulResults.length === 0) {
        throw new Error(t.contentPolishModal.errors.allPolishFailed);
      }

      setPolishResults(successfulResults);
      
      // 默认选择第一个成功的结果
      if (successfulResults.length > 0) {
        setSelectedResult(successfulResults[0].content);
      }

      logger.info('多目标润色完成', {
        totalResults: successfulResults.length,
        selectedStylesCount: selectedStyles.size,
        selectedGoals: selectedGoals.map(g => 
          t.contentPolishModal.polishGoals[g.id as keyof typeof t.contentPolishModal.polishGoals]?.name || g.name
        ),
        resultsPreview: successfulResults.map(r => ({
          style: r.style,
          length: r.content.length,
          description: r.description
        }))
      });

    } catch (error) {
      logger.error('多目标润色过程失败', 
        error instanceof Error ? error : new Error(String(error)),
        { 
          selectedStylesCount: selectedStyles.size,
          originalContentLength: originalContent.length
        }
      );
      setPolishResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [originalContent, selectedStyles, taskId, logger, polishGoals]);

  // 处理确认选择
  const handleConfirm = useCallback(() => {
    if (selectedResult) {
      logger.info('用户确认选择润色结果', {
        selectedContentLength: selectedResult.length,
        originalContentLength: originalContent.length,
        contentDelta: selectedResult.length - originalContent.length
      });
      
      onContentSelect(selectedResult);
      onClose();
    }
  }, [selectedResult, originalContent.length, onContentSelect, onClose, logger]);

  // 处理关闭
  const handleClose = useCallback(() => {
    logger.info('用户关闭润色弹窗', {
      hadResults: polishResults.length > 0,
      hadSelection: !!selectedResult
    });
    
    setSelectedStyles(new Set());
    setPolishResults([]);
    setSelectedResult('');
    onClose();
  }, [polishResults.length, selectedResult, onClose, logger]);

  // 按分类分组润色目标
  const groupedGoals = polishGoals.reduce((acc, goal) => {
    const category = goal.category || 'other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(goal);
    return acc;
  }, {} as Record<string, PolishGoal[]>);

  // 分类名称映射 - 使用useCallback以确保依赖更新
  const getCategoryName = useCallback((category: string): string => {
    const mapping: Record<string, string> = {
      platform: t.contentPolishModal.categoryNames.platform,
      engagement: t.contentPolishModal.categoryNames.engagement,
      emotional: t.contentPolishModal.categoryNames.emotional,
      conversion: t.contentPolishModal.categoryNames.conversion,
      narrative: t.contentPolishModal.categoryNames.narrative,
      targeting: t.contentPolishModal.categoryNames.targeting,
      viral: t.contentPolishModal.categoryNames.viral,
      controversial: t.contentPolishModal.categoryNames.controversial,
      uniqueness: t.contentPolishModal.categoryNames.uniqueness,
      structure: t.contentPolishModal.categoryNames.structure,
      emphasis: t.contentPolishModal.categoryNames.emphasis,
      memorable: t.contentPolishModal.categoryNames.memorable,
      credibility: t.contentPolishModal.categoryNames.credibility,
      immersive: t.contentPolishModal.categoryNames.immersive,
      innovative: t.contentPolishModal.categoryNames.innovative,
      psychological: t.contentPolishModal.categoryNames.psychological,
      motivation: t.contentPolishModal.categoryNames.motivation,
      practical: t.contentPolishModal.categoryNames.practical,
      other: t.contentPolishModal.categoryNames.other
    };
    return mapping[category] || category;
  }, [t]);

  if (!isOpen) return null;

  return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full h-[85vh] flex flex-col overflow-hidden">
        {/* 标题栏 */}
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{t.contentPolishModal.title}</h2>
              <p className="text-sm text-gray-600 mt-1">{t.contentPolishModal.subtitle}</p>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label={t.contentPolishModal.close}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 主要内容区域 */}
        <div className="flex flex-1 min-h-0">
          {/* 左侧设置区域 */}
          <div className="w-1/3 bg-gray-50 border-r border-gray-200 flex flex-col">
            {/* 原始内容预览区域（固定高度） */}
            <div className="p-6 border-b border-gray-200">
              <div className="mb-0">
                <h3 className="text-sm font-medium text-gray-900 mb-3">{t.contentPolishModal.originalContent}</h3>
                <div className="bg-white rounded-lg border border-gray-200 p-4 max-h-24 overflow-y-auto">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {originalContent || t.contentPolishModal.noContent}
                  </p>
                </div>
              </div>
            </div>

            {/* 润色目标选择区域（占用约70%高度，内部可滚动） */}
            <div className="flex-1 px-6 py-4 flex flex-col min-h-0">
              {/* 选择润色目标标题和统计 */}
              <div className="flex-shrink-0 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-900">{t.contentPolishModal.selectPolishGoals}</h3>
                  {selectedStyles.size > 0 && (
                    <div className="flex items-center space-x-2">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                        {t.contentPolishModal.selectedCount.replace('{count}', selectedStyles.size.toString())}
                      </span>
                      <button
                        onClick={() => {
                          setSelectedStyles(new Set());
                          logger.info('用户清空润色目标选择', {
                            previousCount: selectedStyles.size,
                            timestamp: new Date().toISOString()
                          });
                        }}
                        className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        {t.contentPolishModal.clear}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              
              {/* 润色目标列表容器（可滚动区域） */}
              <div className="flex-1 overflow-y-auto pr-2 -mr-2">
                {configLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <svg className="w-6 h-6 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span className="ml-2 text-sm text-gray-600">{t.contentPolishModal.loadingConfig}</span>
                  </div>
                ) : configError ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-sm text-red-700">{t.contentPolishModal.configLoadError.replace('{error}', configError)}</p>
                  </div>
                ) : (
                  <div className="space-y-4 pb-2">
                    {Object.entries(groupedGoals).map(([category, goals]) => (
                      <div key={category}>
                        <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3 sticky top-0 bg-gray-50 py-1">
                          {getCategoryName(category)}
                        </h4>
                        {/* 使用网格布局，一行两个 */}
                        <div className="grid grid-cols-2 gap-2 mb-4">
                          {goals.map((goal) => {
                            const isSelected = selectedStyles.has(goal.id);
                            return (
                              <div
                                key={goal.id}
                                onClick={() => handleStyleToggle(goal.id)}
                                className={`relative p-3 rounded-lg border-2 cursor-pointer transition-all duration-200 hover:shadow-sm ${
                                  isSelected 
                                    ? 'border-blue-300 bg-blue-50 shadow-sm' 
                                    : 'border-gray-200 bg-white hover:border-gray-300'
                                }`}
                              >
                                {/* 选中状态指示器 */}
                                <div className={`absolute top-2 right-2 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
                                  isSelected 
                                    ? 'border-blue-500 bg-blue-500' 
                                    : 'border-gray-300 bg-white'
                                }`}>
                                  {isSelected && (
                                    <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </div>
                                
                                <div className="pr-6">
                                  <h5 className={`font-medium text-sm mb-1 transition-colors ${
                                    isSelected ? 'text-blue-900' : 'text-gray-900'
                                  }`}>
                                    {t.contentPolishModal.polishGoals[goal.id as keyof typeof t.contentPolishModal.polishGoals]?.name || goal.name}
                                  </h5>
                                  <p className={`text-xs leading-relaxed transition-colors ${
                                    isSelected ? 'text-blue-700' : 'text-gray-600'
                                  }`}>
                                    {t.contentPolishModal.polishGoals[goal.id as keyof typeof t.contentPolishModal.polishGoals]?.description || goal.description}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 下部分：开始润色按钮（固定在底部） */}
            <div className="p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0">
              <button
                onClick={handlePolish}
                disabled={selectedStyles.size === 0 || !originalContent.trim() || isLoading || configLoading}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center space-x-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>{t.contentPolishModal.polishing}</span>
                  </div>
                ) : (
                  t.contentPolishModal.startPolish.replace('{count}', selectedStyles.size > 0 ? selectedStyles.size.toString() : t.contentPolishModal.selectGoals)
                )}
              </button>
              
              {/* 添加详细的操作日志记录 */}
              {selectedStyles.size > 0 && (
                <div className="mt-2 text-xs text-gray-500 text-center">
                  {t.contentPolishModal.operationHint.replace('{count}', selectedStyles.size.toString())}
                </div>
              )}
            </div>
          </div>

          {/* 右侧结果展示区域 */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 p-6 overflow-y-auto">
              <h3 className="text-sm font-medium text-gray-900 mb-4">{t.contentPolishModal.polishResults}</h3>
              
              {polishResults.length > 0 ? (
                <div className="space-y-4">
                  {polishResults.map((result, index) => (
                    <div
                      key={index}
                      onClick={() => setSelectedResult(result.content)}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        selectedResult === result.content 
                          ? 'border-blue-300 bg-blue-50' 
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            {result.style}
                          </span>
                        </div>
                        {selectedResult === result.content && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">{t.contentPolishModal.selected}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mb-3">{result.description}</p>
                      <div className="bg-gray-50 rounded-lg p-3 max-h-64 overflow-y-auto">
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">
                          {result.content}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </div>
                  <p className="text-gray-500 text-sm">{t.contentPolishModal.emptyStateTitle}</p>
                  <p className="text-gray-400 text-xs mt-2">{t.contentPolishModal.emptyStateSubtitle}</p>
                </div>
              )}
            </div>

            {/* 底部操作栏（固定在底部） */}
            <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-end space-x-3 flex-shrink-0">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {t.contentPolishModal.cancel}
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selectedResult}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
              >
                {t.contentPolishModal.confirmApply}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContentPolishModal; 