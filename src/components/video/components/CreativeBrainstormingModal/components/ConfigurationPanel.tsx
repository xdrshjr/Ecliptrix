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
          <h4 className="text-sm font-semibold text-foreground mb-1">{categoryTranslation.title}</h4>
          <p className="text-xs text-muted-foreground">{categoryTranslation.description}</p>
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
                  p-3 rounded-md border cursor-pointer transition-all duration-200
                  ${isSelected
                    ? 'bg-primary/10 border-primary/30'
                    : 'bg-card border-border hover:border-border hover:bg-accent'
                  }
                `}
              >
                <div className="flex items-start space-x-3">
                  <div className={`
                    w-4 h-4 rounded border-2 flex items-center justify-center mt-0.5 transition-colors
                    ${isSelected
                      ? 'bg-primary border-primary'
                      : 'border-border bg-card'
                    }
                  `}>
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground mb-1">{optionTranslation.label}</div>
                    <div className="text-xs text-muted-foreground leading-relaxed">{optionTranslation.description}</div>
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
    <div className="w-80 bg-muted border-r border-border flex flex-col">
      {/* 配置选项区域 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {configCategories.map(renderConfigCategory)}
        
        {/* 自定义创意输入框 */}
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-1">{translations.configPanel.customCreativeTitle}</h4>
            <p className="text-xs text-muted-foreground">{translations.configPanel.customCreativeDescription}</p>
          </div>
          
          <div className="space-y-2">
            <textarea
              value={config.customCreativeInput}
              onChange={(e) => handleCustomCreativeInputChange(e.target.value)}
              placeholder={translations.configPanel.customCreativePlaceholder}
              className="w-full p-3 bg-card border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all duration-200"
              rows={4}
              disabled={isDiscussing}
            />
          </div>
        </div>
      </div>

      {/* 底部按钮区域 */}
      <div className="p-6 bg-card border-t border-border">
        <button
          onClick={onStartBrainstorming}
          disabled={!isConfigValid || isDiscussing}
          className="w-full py-3 px-4 rounded-md font-medium text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isDiscussing ? translations.configPanel.startButtonDiscussing : translations.configPanel.startButton}
        </button>
        
        {!isConfigValid && (
          <p className="text-xs text-destructive mt-2 text-center">
            {translations.configPanel.validationError}
          </p>
        )}
      </div>
    </div>
  );
};

export default ConfigurationPanel; 