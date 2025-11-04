'use client';

import React from 'react';
import { CreativeBrainstormingConfig, ConfigCategory } from '../types';
import { configCategories } from '../data/expertProfiles';
import { Translations } from '@/lib/i18n';

interface ConfigurationPanelProps {
  config: CreativeBrainstormingConfig;
  onConfigChange: (config: CreativeBrainstormingConfig) => void;
  onStartBrainstorming: () => void;
  isConfigValid: boolean;
  isDiscussing: boolean;
  translations: Translations['creativeBrainstormingModal'];
}

const ConfigurationPanel: React.FC<ConfigurationPanelProps> = ({
  config,
  onConfigChange,
  onStartBrainstorming,
  isConfigValid,
  isDiscussing,
  translations
}) => {
  const handleOptionToggle = (categoryId: keyof CreativeBrainstormingConfig, optionId: string) => {
    // 跳过字符串类型的字段
    if (categoryId === 'customCreativeInput') return;
    
    const currentValues = config[categoryId] as string[];
    const isSelected = currentValues.includes(optionId);
    
    let newValues: string[];
    if (isSelected) {
      newValues = currentValues.filter((id: string) => id !== optionId);
    } else {
      newValues = [...currentValues, optionId];
    }
    
    onConfigChange({
      ...config,
      [categoryId]: newValues
    });
  };

  const handleCustomCreativeInputChange = (value: string) => {
    onConfigChange({
      ...config,
      customCreativeInput: value
    });
  };

  const getCategoryTranslation = (categoryId: string) => {
    const categoryKey = categoryId as keyof typeof translations.categories;
    return translations.categories[categoryKey];
  };

  const getOptionTranslation = (categoryId: string, optionId: string) => {
    const categoryKey = categoryId as keyof typeof translations.categories;
    const category = translations.categories[categoryKey];
    
    // Convert option ID to camelCase for translation key
    const optionKey = optionId.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    return (category.options as any)[optionKey];
  };

  const renderConfigCategory = (category: ConfigCategory) => {
    const categoryTranslation = getCategoryTranslation(category.id);
    
    return (
      <div key={category.id} className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 mb-1">{categoryTranslation.title}</h4>
          <p className="text-xs text-gray-500">{categoryTranslation.description}</p>
        </div>
        
        <div className="space-y-2">
          {category.options.map(option => {
            const isSelected = config[category.id].includes(option.id);
            const optionTranslation = getOptionTranslation(category.id, option.id);
            
            return (
              <div
                key={option.id}
                onClick={() => handleOptionToggle(category.id, option.id)}
                className={`
                  p-3 rounded-lg border cursor-pointer transition-all duration-200
                  ${isSelected 
                    ? 'bg-blue-50 border-blue-200 shadow-sm' 
                    : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }
                `}
              >
                <div className="flex items-start space-x-3">
                  <div className={`
                    w-4 h-4 rounded border-2 flex items-center justify-center mt-0.5 transition-colors
                    ${isSelected 
                      ? 'bg-blue-500 border-blue-500' 
                      : 'border-gray-300 bg-white'
                    }
                  `}>
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 mb-1">{optionTranslation.label}</div>
                    <div className="text-xs text-gray-500 leading-relaxed">{optionTranslation.description}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col">
      {/* 配置选项区域 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {configCategories.map(renderConfigCategory)}
        
        {/* 自定义创意输入框 */}
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">{translations.configPanel.customCreativeTitle}</h4>
            <p className="text-xs text-gray-500">{translations.configPanel.customCreativeDescription}</p>
          </div>
          
          <div className="space-y-2">
            <textarea
              value={config.customCreativeInput}
              onChange={(e) => handleCustomCreativeInputChange(e.target.value)}
              placeholder={translations.configPanel.customCreativePlaceholder}
              className="w-full p-3 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
              rows={4}
              disabled={isDiscussing}
            />
          </div>
        </div>
      </div>

      {/* 底部按钮区域 */}
      <div className="p-6 bg-white border-t border-gray-200">
        <button
          onClick={onStartBrainstorming}
          disabled={!isConfigValid || isDiscussing}
          className={`
            w-full py-3 px-4 rounded-lg font-medium text-sm transition-all duration-200
            ${isConfigValid && !isDiscussing
              ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transform hover:scale-[1.02]'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }
          `}
        >
          {isDiscussing ? translations.configPanel.startButtonDiscussing : translations.configPanel.startButton}
        </button>
        
        {!isConfigValid && (
          <p className="text-xs text-red-500 mt-2 text-center">
            {translations.configPanel.validationError}
          </p>
        )}
      </div>
    </div>
  );
};

export default ConfigurationPanel; 