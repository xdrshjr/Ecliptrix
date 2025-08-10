'use client';

import React, { useState, useEffect } from 'react';
import { VoiceType, getVoiceTypes } from '@/lib/api/tts';

interface VoiceSelectorProps {
  selectedVoiceId: string;
  onVoiceChange: (voiceId: string) => void;
  className?: string;
}

const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  selectedVoiceId,
  onVoiceChange,
  className = ''
}) => {
  const [voiceTypes, setVoiceTypes] = useState<Record<string, VoiceType>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    loadVoiceTypes();
  }, []);

  const loadVoiceTypes = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('[VoiceSelector] 加载音色列表');
      
      const response = await getVoiceTypes();
      if (response.success) {
        setVoiceTypes(response.data);
        console.log('[VoiceSelector] 音色列表加载成功', {
          count: Object.keys(response.data).length
        });
      } else {
        throw new Error(response.message || '获取音色列表失败');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '未知错误';
      console.error('[VoiceSelector] 加载音色列表失败', { error: errorMsg });
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceSelect = (voiceId: string) => {
    console.log('[VoiceSelector] 用户选择音色', {
      previousVoice: selectedVoiceId,
      newVoice: voiceId,
      voiceName: voiceTypes[voiceId]?.name
    });
    
    onVoiceChange(voiceId);
    setIsOpen(false);
  };

  const selectedVoice = voiceTypes[selectedVoiceId];
  const voiceList = Object.values(voiceTypes);

  // 按性别分组
  const femaleVoices = voiceList.filter(voice => voice.gender === 'female');
  const maleVoices = voiceList.filter(voice => voice.gender === 'male');

  if (isLoading) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className="w-4 h-4 bg-gray-300 rounded-full animate-pulse"></div>
        <span className="text-xs text-gray-500">加载音色中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className="w-4 h-4 bg-red-100 rounded-full flex items-center justify-center">
          <svg className="w-2 h-2 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <span className="text-xs text-red-600">音色加载失败</span>
        <button
          onClick={loadVoiceTypes}
          className="text-xs text-blue-600 hover:text-blue-700 underline"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* 当前选中的音色显示 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors duration-200 w-full text-left"
      >
        <div className="flex items-center space-x-2 flex-1">
          <div className={`w-3 h-3 rounded-full ${
            selectedVoice?.gender === 'female' ? 'bg-pink-400' : 'bg-blue-400'
          }`}></div>
          <span className="text-sm font-medium text-gray-700">
            {selectedVoice?.name || '选择音色'}
          </span>
          {selectedVoice && (
            <span className="text-xs text-gray-500">
              ({selectedVoice.gender === 'female' ? '女声' : '男声'})
            </span>
          )}
        </div>
        <svg 
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
            isOpen ? 'transform rotate-180' : ''
          }`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
          {femaleVoices.length > 0 && (
            <div className="p-2">
              <div className="text-xs font-medium text-gray-500 px-2 py-1 flex items-center">
                <div className="w-3 h-3 rounded-full bg-pink-400 mr-2"></div>
                女声音色
              </div>
              {femaleVoices.map((voice) => (
                <button
                  key={voice.id}
                  onClick={() => handleVoiceSelect(voice.id)}
                  className={`w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 transition-colors duration-150 ${
                    selectedVoiceId === voice.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{voice.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{voice.description}</div>
                    </div>
                    {selectedVoiceId === voice.id && (
                      <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {maleVoices.length > 0 && (
            <div className="p-2 border-t border-gray-100">
              <div className="text-xs font-medium text-gray-500 px-2 py-1 flex items-center">
                <div className="w-3 h-3 rounded-full bg-blue-400 mr-2"></div>
                男声音色
              </div>
              {maleVoices.map((voice) => (
                <button
                  key={voice.id}
                  onClick={() => handleVoiceSelect(voice.id)}
                  className={`w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 transition-colors duration-150 ${
                    selectedVoiceId === voice.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{voice.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{voice.description}</div>
                    </div>
                    {selectedVoiceId === voice.id && (
                      <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {voiceList.length === 0 && (
            <div className="p-4 text-center text-sm text-gray-500">
              暂无可用音色
            </div>
          )}
        </div>
      )}

      {/* 点击外部关闭下拉菜单 */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export default VoiceSelector; 