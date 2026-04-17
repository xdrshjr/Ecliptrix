'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';

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
  placeholder,
}) => {
  const { t } = useLocale();
  return (
    <div className="p-4 border-t border-border bg-card">
      <div className="flex items-end space-x-3">
        <div className="flex-1">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyPress={onKeyPress}
            disabled={disabled}
            placeholder={placeholder ?? t.creativeBrainstorming.inputPlaceholder}
            rows={2}
            className={`
              w-full px-4 py-3 border border-border rounded-md resize-none focus:ring-2
              focus:ring-primary focus:border-transparent transition-colors text-sm
              ${disabled
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-card text-foreground'
              }
            `}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t.creativeBrainstorming.sendHint}
          </p>
        </div>
        
        <button
          onClick={onSend}
          disabled={disabled || !value.trim()}
          className={`
            px-4 py-3 rounded-md font-medium text-sm transition-colors flex-shrink-0
            ${!disabled && value.trim()
              ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
              : 'bg-accent text-muted-foreground cursor-not-allowed'
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