'use client';

import React from 'react';
import { CreativeBrainstormingConfig, ConfigCategory } from '../types';
import { configCategories } from '../data/expertProfiles';

interface ConfigurationPanelProps {
  config: CreativeBrainstormingConfig;
  onConfigChange: (config: CreativeBrainstormingConfig) => void;
  onStartBrainstorming: () => void;
  isConfigValid: boolean;
  isDiscussing: boolean;
}

const ConfigurationPanel: React.FC<ConfigurationPanelProps> = ({
  config,
  onConfigChange,
  onStartBrainstorming,
  isConfigValid,
  isDiscussing
}) => {
  const handleOptionToggle = (categoryId: keyof CreativeBrainstormingConfig, optionId: string) => {
    const currentValues = config[categoryId];
    const isSelected = currentValues.includes(optionId);
    
    let newValues: string[];
    if (isSelected) {
      newValues = currentValues.filter(id => id !== optionId);
    } else {
      newValues = [...currentValues, optionId];
    }
    
    onConfigChange({
      ...config,
      [categoryId]: newValues
    });
  };

  const renderConfigCategory = (category: ConfigCategory) => (
    <div key={category.id} className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-1">{category.title}</h4>
        <p className="text-xs text-gray-500">{category.description}</p>
      </div>
      
      <div className="space-y-2">
        {category.options.map(option => {
          const isSelected = config[category.id].includes(option.id);
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
                  <div className="text-sm font-medium text-gray-900 mb-1">{option.label}</div>
                  <div className="text-xs text-gray-500 leading-relaxed">{option.description}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col">
      {/* 标题区域 */}
      <div className="p-6 border-b border-gray-200 bg-white">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">创意构思配置</h3>
            <p className="text-sm text-gray-600">设置您的创意讨论参数</p>
          </div>
        </div>
      </div>

      {/* 配置选项区域 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {configCategories.map(renderConfigCategory)}
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
          {isDiscussing ? '讨论进行中...' : '开始构思'}
        </button>
        
        {!isConfigValid && (
          <p className="text-xs text-red-500 mt-2 text-center">
            请至少选择一个创作类型和一位创意专家
          </p>
        )}
      </div>
    </div>
  );
};

export default ConfigurationPanel; 