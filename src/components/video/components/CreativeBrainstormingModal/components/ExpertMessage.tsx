'use client';

import React from 'react';
import { ChatMessage, ExpertProfile } from '../types';
import { formatTime } from '@/lib/utils/dateFormat';

interface ExpertMessageProps {
  message: ChatMessage;
  expert: ExpertProfile | undefined;
}

const ExpertMessage: React.FC<ExpertMessageProps> = ({ message, expert }) => {
  // 如果专家信息不存在，使用默认值
  if (!expert) {
    return (
      <div className="flex items-start space-x-3 mb-6">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 bg-accent text-muted-foreground">
          👤
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            <h4 className="text-sm font-semibold text-foreground">未知专家</h4>
            <span className="text-xs text-muted-foreground">
              {formatTime(message.timestamp)}
            </span>
          </div>
          <div className="bg-muted rounded-md p-4">
            <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {message.content}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start space-x-3 mb-6">
      {/* 专家头像 */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0"
        style={{ backgroundColor: `${expert.color}20`, color: expert.color }}
      >
        {expert.avatar}
      </div>

      {/* 消息内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2 mb-1">
          <h4 className="text-sm font-semibold text-foreground">{expert.name}</h4>
          <span className="text-xs text-muted-foreground">{expert.title}</span>
          <span className="text-xs text-muted-foreground">
            {formatTime(message.timestamp)}
          </span>
        </div>
        
        <div className="bg-muted rounded-md p-4">
          <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {message.isStreaming ? (
              <span className="inline-flex items-center">
                {message.content}
                <span className="ml-1 w-2 h-4 bg-primary animate-pulse"></span>
              </span>
            ) : (
              message.content
            )}
          </div>
        </div>
        
        {/* 专家专业领域标签 */}
        <div className="flex flex-wrap gap-1 mt-2">
          {expert.expertise.slice(0, 2).map((skill, index) => (
            <span
              key={index}
              className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
              style={{ 
                backgroundColor: `${expert.color}15`, 
                color: expert.color 
              }}
            >
              {skill}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ExpertMessage; 