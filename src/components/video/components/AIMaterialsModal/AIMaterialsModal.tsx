'use client';

import React from 'react';
import { UseAIMaterialsReturn, AIMaterialCard, AIMaterialParameter } from '../../types';
import { VideoEditingLogger } from '../../utils';

interface AIMaterialsModalProps extends UseAIMaterialsReturn {}

const AIMaterialsModal: React.FC<AIMaterialsModalProps> = ({
  isModalOpen,
  closeModal,
  selectedCategory,
  selectedCard,
  setSelectedCategory,
  isParameterMode,
  parameters,
  setParameter,
  handleCardSelect,
  handleBackToCards,
  handleGenerate,
  getCardsForCategory,
  categories,
  taskId
}) => {
  const logger = new VideoEditingLogger({ taskId, component: 'AIMaterialsModal' });

  if (!isModalOpen) return null;

  const renderParameterInput = (param: AIMaterialParameter) => {
    const value = parameters[param.id] ?? param.defaultValue;

    switch (param.type) {
      case 'text':
        return (
          <textarea
            value={value || ''}
            onChange={(e) => setParameter(param.id, e.target.value)}
            placeholder={param.placeholder}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={param.id.includes('prompt') ? 3 : 1}
          />
        );

      case 'number':
        return (
          <input
            type="number"
            value={value || ''}
            onChange={(e) => setParameter(param.id, e.target.value ? Number(e.target.value) : null)}
            placeholder={param.placeholder}
            min={param.min}
            max={param.max}
            step={param.step}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        );

      case 'select':
        return (
          <select
            value={value || ''}
            onChange={(e) => {
              const selectedOption = param.options?.find(opt => String(opt.value) === e.target.value);
              setParameter(param.id, selectedOption?.value);
            }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
          >
            {param.options?.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case 'slider':
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>{param.min}</span>
              <span className="font-medium text-gray-900">{value}</span>
              <span>{param.max}</span>
            </div>
            <input
              type="range"
              value={value || param.min || 0}
              onChange={(e) => setParameter(param.id, Number(e.target.value))}
              min={param.min}
              max={param.max}
              step={param.step}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-thumb"
            />
            <style jsx>{`
              .slider-thumb::-webkit-slider-thumb {
                appearance: none;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: #3b82f6;
                cursor: pointer;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(59, 130, 246, 0.2);
                transition: all 0.2s ease;
              }
              
              .slider-thumb::-webkit-slider-thumb:hover {
                background: #2563eb;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15), 0 0 0 2px rgba(59, 130, 246, 0.3);
                transform: scale(1.1);
              }
              
              .slider-thumb::-moz-range-thumb {
                appearance: none;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: #3b82f6;
                cursor: pointer;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(59, 130, 246, 0.2);
                transition: all 0.2s ease;
              }
            `}</style>
          </div>
        );

      case 'file':
        return (
          <input
            type="file"
            onChange={(e) => setParameter(param.id, e.target.files?.[0] || null)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        );

      default:
        return null;
    }
  };

  const renderCardsList = () => {
    const cards = getCardsForCategory(selectedCategory);
    
    if (cards.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500">
          <div className="text-6xl mb-4">🚧</div>
          <p className="text-lg font-medium">即将推出</p>
          <p className="text-sm text-gray-400 mt-1">该类别的AI应用正在开发中</p>
        </div>
      );
    }

    return (
      <div className="space-y-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          {categories.find(cat => cat.id === selectedCategory)?.name} 应用
        </h3>
        <div className="space-y-3">
          {cards.map((card) => (
            <div
              key={card.id}
              onClick={() => handleCardSelect(card)}
              className="flex items-center p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all duration-200 bg-white"
            >
              <div className="flex-shrink-0 w-20 h-14 bg-gray-100 rounded-lg overflow-hidden mr-4">
                <img
                  src={card.thumbnailUrl}
                  alt={card.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDMwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxyZWN0IHg9IjEyNSIgeT0iODAiIHdpZHRoPSI1MCIgaGVpZ2h0PSI0MCIgZmlsbD0iIzlDQTNBRiIvPgo8L3N2Zz4K';
                  }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-gray-900 truncate">{card.name}</h4>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{card.description}</p>
                {card.isDefault && (
                  <span className="inline-block mt-2 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                    推荐
                  </span>
                )}
              </div>
              <div className="flex-shrink-0 ml-4">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderParameterPanel = () => {
    if (!selectedCard) return null;

    return (
      <div className="p-6 h-full flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleBackToCards}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{selectedCard.name}</h3>
              <p className="text-sm text-gray-500">{selectedCard.description}</p>
            </div>
          </div>
        </div>

        {/* 参数表单 */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6">
            {selectedCard.parameters.map((param) => (
              <div key={param.id} className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  {param.label}
                  {param.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                {renderParameterInput(param)}
              </div>
            ))}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end space-x-3 pt-6 border-t border-gray-200 mt-6">
          <button
            onClick={handleBackToCards}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            返回
          </button>
          <button
            onClick={handleGenerate}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            开始生成
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-[90vw] h-[85vh] max-w-7xl flex overflow-hidden">
        {/* 左侧类别面板 - 20% */}
        <div className="w-1/5 bg-gray-50 border-r border-gray-200 flex flex-col">
          {/* 头部 */}
          <div className="px-4 py-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">AI素材</h2>
              <button
                onClick={closeModal}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 transition-colors"
              >
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* 类别列表 */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-2">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`w-full flex items-center space-x-3 px-3 py-3 rounded-lg text-left transition-all duration-200 ${
                    selectedCategory === category.id
                      ? 'bg-blue-100 text-blue-700 shadow-sm'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="text-lg">{category.icon}</span>
                  <span className="text-sm font-medium">{category.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧内容面板 - 80% */}
        <div className="flex-1 flex flex-col bg-white">
          {isParameterMode ? renderParameterPanel() : renderCardsList()}
        </div>
      </div>
    </div>
  );
};

export default AIMaterialsModal;