'use client';

import React from 'react';

interface UserInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (e: React.KeyboardEvent) => void;
  disabled?: boolean;
  placeholder?: string;
}

const UserInput: React.FC<UserInputProps> = ({
  value,
  onChange,
  onSend,
  onKeyPress,
  disabled = false,
  placeholder = "输入您的想法或问题..."
}) => {
  return (
    <div className="p-4 border-t border-gray-200 bg-white">
      <div className="flex items-end space-x-3">
        <div className="flex-1">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyPress={onKeyPress}
            disabled={disabled}
            placeholder={placeholder}
            rows={2}
            className={`
              w-full px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 
              focus:ring-blue-500 focus:border-transparent transition-colors text-sm
              ${disabled 
                ? 'bg-gray-100 text-gray-500 cursor-not-allowed' 
                : 'bg-white text-gray-900'
              }
            `}
          />
          <p className="text-xs text-gray-500 mt-1">
            按 Enter 发送，Shift+Enter 换行
          </p>
        </div>
        
        <button
          onClick={onSend}
          disabled={disabled || !value.trim()}
          className={`
            px-4 py-3 rounded-lg font-medium text-sm transition-all duration-200 flex-shrink-0
            ${!disabled && value.trim()
              ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-md hover:shadow-lg'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }
          `}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default UserInput; 