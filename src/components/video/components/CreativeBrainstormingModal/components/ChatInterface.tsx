'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ExpertProfile } from '../types';
import { getExpertById } from '../data/expertProfiles';
import ExpertMessage from './ExpertMessage';
import UserInput from './UserInput';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  isDiscussing: boolean;
  isSummarizing: boolean;
  canExport: boolean;
  onSendMessage: (message: string) => void;
  onContinueDiscussion: () => void;
  onStartSummary: () => void;
  onExportContent: () => void;
  currentRound: number;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  isDiscussing,
  isSummarizing,
  canExport,
  onSendMessage,
  onContinueDiscussion,
  onStartSummary,
  onExportContent,
  currentRound
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [userInput, setUserInput] = useState('');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = () => {
    if (userInput.trim()) {
      onSendMessage(userInput.trim());
      setUserInput('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const renderMessage = (message: ChatMessage) => {
    if (message.type === 'expert') {
      const expert = getExpertById(message.expertId!);
      return (
        <ExpertMessage
          key={message.id}
          message={message}
          expert={expert}
        />
      );
    }

    if (message.type === 'user') {
      return (
        <div key={message.id} className="flex justify-end mb-4">
          <div className="max-w-xs lg:max-w-md bg-blue-500 text-white rounded-lg px-4 py-2">
            <p className="text-sm">{message.content}</p>
            <p className="text-xs text-blue-100 mt-1">
              {message.timestamp.toLocaleTimeString()}
            </p>
          </div>
        </div>
      );
    }

    if (message.type === 'moderator') {
      return (
        <div key={message.id} className="flex justify-center mb-4">
          <div className="bg-gray-100 text-gray-700 rounded-lg px-4 py-2 text-sm">
            {message.content}
          </div>
        </div>
      );
    }

    return null;
  };

  const showControlButtons = !isDiscussing && !isSummarizing && messages.length > 0;

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* 标题区域 */}
      <div className="p-6 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">创意讨论</h3>
              <p className="text-sm text-gray-600">
                {currentRound > 0 && `第 ${currentRound} 轮讨论`}
                {isDiscussing && ' - 专家讨论中...'}
                {isSummarizing && ' - 正在总结...'}
              </p>
            </div>
          </div>
          
          {canExport && (
            <button
              onClick={onExportContent}
              className="flex items-center space-x-2 px-4 py-2 bg-green-50 hover:bg-green-100 
                       border border-green-200 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-sm font-medium text-green-700">导出文案</span>
            </button>
          )}
        </div>
      </div>

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-lg font-medium">等待开始讨论</p>
              <p className="text-sm mt-1">配置完成后，专家们将开始创意构思</p>
            </div>
          </div>
        ) : (
          <>
            {messages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 控制按钮区域 */}
      {showControlButtons && (
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-center space-x-4">
            <button
              onClick={onContinueDiscussion}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg 
                       font-medium text-sm transition-colors"
            >
              继续讨论
            </button>
            <button
              onClick={onStartSummary}
              className="px-6 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg 
                       font-medium text-sm transition-colors"
            >
              开始总结
            </button>
          </div>
        </div>
      )}

      {/* 用户输入区域 */}
      <UserInput
        value={userInput}
        onChange={setUserInput}
        onSend={handleSendMessage}
        onKeyPress={handleKeyPress}
        disabled={isSummarizing}
        placeholder={
          isDiscussing 
            ? "专家讨论中，请稍后..." 
            : isSummarizing 
              ? "正在总结中，请稍后..."
              : "输入您的想法或问题..."
        }
      />
    </div>
  );
};

export default ChatInterface; 