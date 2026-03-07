'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ExpertProfile } from '../types';
import { getExpertById } from '../data/expertProfiles';
import ExpertMessage from './ExpertMessage';
import UserInput from './UserInput';
import { Translations } from '@/lib/i18n';

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
  translations: Translations['creativeBrainstormingModal'];
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
  currentRound,
  translations
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
      const expert = getExpertById(message.expertId!, translations);
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
          <div className="max-w-xs lg:max-w-md bg-primary text-primary-foreground rounded-md px-4 py-2">
            <p className="text-sm">{message.content}</p>
            <p className="text-xs text-primary-foreground/70 mt-1">
              {message.timestamp.toLocaleTimeString()}
            </p>
          </div>
        </div>
      );
    }

    if (message.type === 'moderator') {
      return (
        <div key={message.id} className="flex justify-center mb-4">
          <div className="bg-muted text-foreground rounded-md px-4 py-2 text-sm">
            {message.content}
          </div>
        </div>
      );
    }

    return null;
  };

  const showControlButtons = !isDiscussing && !isSummarizing && messages.length > 0;

  return (
    <div className="flex-1 flex flex-col bg-card">
      {/* 标题区域 */}
      <div className="p-6 border-b border-border bg-muted">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary/10 rounded-md flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">{translations.chatInterface.title}</h3>
              <p className="text-sm text-muted-foreground">
                {currentRound > 0 && translations.chatInterface.roundLabel.replace('{round}', currentRound.toString())}
                {isDiscussing && translations.chatInterface.discussingStatus}
                {isSummarizing && translations.chatInterface.summarizingStatus}
              </p>
            </div>
          </div>
          
          {canExport && (
            <button
              onClick={onExportContent}
              className="flex items-center space-x-2 px-4 py-2 bg-muted hover:bg-accent
                       border border-border rounded-md transition-colors"
            >
              <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-sm font-medium text-foreground">{translations.chatInterface.exportButton}</span>
            </button>
          )}
        </div>
      </div>

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-lg font-medium">{translations.chatInterface.emptyStateTitle}</p>
              <p className="text-sm mt-1">{translations.chatInterface.emptyStateSubtitle}</p>
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
        <div className="p-4 border-t border-border bg-muted">
          <div className="flex items-center justify-center space-x-4">
            <button
              onClick={onContinueDiscussion}
              className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md
                       font-medium text-sm transition-colors"
            >
              {translations.chatInterface.continueButton}
            </button>
            <button
              onClick={onStartSummary}
              className="px-6 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-md
                       font-medium text-sm transition-colors"
            >
              {translations.chatInterface.summaryButton}
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
            ? translations.chatInterface.userInputPlaceholderDiscussing
            : isSummarizing 
              ? translations.chatInterface.userInputPlaceholderSummarizing
              : translations.chatInterface.userInputPlaceholder
        }
      />
    </div>
  );
};

export default ChatInterface; 